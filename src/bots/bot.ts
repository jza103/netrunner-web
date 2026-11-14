// Rule-based bots for both sides. They only ever receive viewFor(state, side) and always
// return one of legalActions(view), so they cannot cheat or make an illegal move.
import { CARDS, cardOf, is, isHidden } from '../engine/cards';
import { legalActions } from '../engine/legal';
import { actor, breakerStrength, canBreak, count, currentIce, isSite, nodeOf, ramLimit, ramUsed } from '../engine/state';
import type { Action, CardDef, CardId, GameState, NodeId, NodeState, Side } from '../engine/types';

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

function pick<T extends Action['type']>(legal: Action[], type: T, pred: (a: Of<T>) => boolean = () => true): Of<T> | undefined {
  return legal.find((a): a is Of<T> => a.type === type && pred(a as Of<T>));
}

function totalDamage(d: CardDef): number {
  return (d.subs ?? []).reduce((n, s) => n + (s.op === 'damage' ? s.n : 0), 0);
}

// ---------------------------------------------------------------------------
// Corp
// ---------------------------------------------------------------------------

function corpDiscardValue(v: GameState, card: CardId): number {
  const d = cardOf(card);
  const dupes = v.corp.hand.filter((c) => cardOf(c).id === d.id).length - 1;
  const base = d.type === 'project' ? 9 : d.id === 'quarterly-windfall' ? 7 : d.type === 'ice' ? 6 : d.type === 'asset' ? 4 : 3;
  return base - dupes;
}

/** How much ICE the Corp bot wants on a node. */
function wantedIce(v: GameState, n: NodeState): number {
  const late = v.turnNumber > 12 ? 1 : 0;
  if (n.id === 'command' || n.id === 'mainframe') return 1 + late;
  if (n.id === 'dump') return v.corp.discard.some((c) => cardOf(c).type === 'project') ? 1 : 0;
  if (!n.root) return 1;
  const d = cardOf(n.root.card);
  if (d.type === 'project') return 2;
  return d.trap ? 1 : 0;
}

function corpTurn(v: GameState, legal: Action[]): Action {
  const c = v.corp;
  const g = v.ghost;
  const sites = c.nodes.filter((n) => isSite(n.id));
  const inHand = (def: string) => c.hand.find((x) => is(x, def));

  const score = pick(legal, 'score');
  if (score) return score;
  const shell = pick(legal, 'activate');
  if (shell) return shell;
  if (c.cycles <= 0) return pick(legal, 'endTurn')!;

  // lethal or heavy Burn Notice
  const rigs = Math.max(0, count(g.gear, 'padded-rig') - v.flags.prevented);
  const burn = pick(legal, 'play', (a) => is(a.card, 'burn-notice'));
  if (burn && 1 + g.heat - rigs > g.hand.length) return burn;

  // finish a project this turn if the cycles and credits are there
  for (const n of sites) {
    if (!n.root || cardOf(n.root.card).type !== 'project') continue;
    const rem = cardOf(n.root.card).dev! - n.root.dev;
    const proto = pick(legal, 'play', (a) => is(a.card, 'rapid-prototyping') && a.target === n.root!.card);
    if (proto && rem >= 2 && (rem - 2 <= c.cycles - 1 && c.credits - 1 >= rem - 2)) return proto;
    if (rem > 0 && rem <= c.cycles && rem <= c.credits) return pick(legal, 'develop', (a) => a.card === n.root!.card)!;
  }

  const windfall = pick(legal, 'play', (a) => is(a.card, 'quarterly-windfall'));
  if (windfall) return windfall;

  if (burn && 1 + g.heat - rigs >= 2) return burn;
  const freeze = pick(legal, 'play', (a) => is(a.card, 'asset-freeze'));
  if (freeze && g.credits >= 3) return freeze;
  const audit = pick(legal, 'play', (a) => is(a.card, 'lockdown-audit'));
  if (audit && c.cycles >= 2 && ((inHand('burn-notice') && c.credits >= 5) || (inHand('asset-freeze') && c.credits >= 3 && g.credits >= 3))) return audit;

  // fast track: a 2-counter project can be installed and scored in one turn
  const quick = c.hand.find((x) => cardOf(x).type === 'project' && cardOf(x).dev === 2);
  if (quick && c.cycles === 3 && c.credits >= 2) {
    const spot = sites.find((n) => !n.root);
    const a = pick(legal, 'install', (x) => x.card === quick && x.node === (spot ? spot.id : 'new'));
    if (a) return a;
  }

  // ICE where it is most needed
  const ice = c.hand.filter((x) => cardOf(x).type === 'ice');
  if (ice.length) {
    const needs = c.nodes
      .map((n) => ({ n, lack: wantedIce(v, n) - n.ice.length }))
      .filter((x) => x.lack > 0 && c.credits >= x.n.ice.length)
      .sort((a, b) => b.lack - a.lack || a.n.ice.length - b.n.ice.length);
    // keep enough credits to switch the ICE on later
    const card = [...ice].sort((a, b) => (cardOf(a).cost ?? 0) - (cardOf(b).cost ?? 0))[needs[0]?.n.ice.length ? ice.length - 1 : 0];
    if (needs.length) {
      const a = pick(legal, 'install', (x) => x.card === card && x.node === needs[0].n.id);
      if (a) return a;
    }
    // no protected empty site for a project in hand: start one
    const project = c.hand.some((x) => cardOf(x).type === 'project');
    if (project && !sites.some((n) => !n.root && n.ice.length)) {
      const a = pick(legal, 'install', (x) => x.card === card && x.node === 'new');
      if (a) return a;
    }
  }

  // a project into the best protected empty site
  const project = c.hand.find((x) => cardOf(x).type === 'project');
  const open = sites.filter((n) => !n.root && n.ice.length).sort((a, b) => b.ice.length - a.ice.length)[0];
  if (project && open) {
    const a = pick(legal, 'install', (x) => x.card === project && x.node === open.id);
    if (a) return a;
  }

  // keep developing an installed project
  for (const n of sites) {
    if (!n.root || cardOf(n.root.card).type !== 'project') continue;
    const dev = pick(legal, 'develop', (a) => a.card === n.root!.card);
    if (dev && n.root.dev < cardOf(n.root.card).dev! && c.credits >= 2) return dev;
  }

  // assets: Shell Company on its own, Decoy Lab somewhere it looks like a project
  const shellCard = inHand('shell-company');
  if (shellCard) {
    const a = pick(legal, 'install', (x) => x.card === shellCard && x.node === 'new');
    if (a) return a;
  }
  const decoy = inHand('decoy-lab');
  if (decoy && !project) {
    const a = pick(legal, 'install', (x) => x.card === decoy && x.node === (open ? open.id : 'new'));
    if (a) return a;
  }
  for (const n of sites) {
    if (n.root && is(n.root.card, 'decoy-lab') && n.root.dev < 2 && c.credits >= 6) {
      const dev = pick(legal, 'develop', (a) => a.card === n.root!.card);
      if (dev) return dev;
    }
  }

  const hunt = pick(legal, 'trashContact');
  if (hunt && c.credits >= 6) return hunt;
  const recall = pick(legal, 'play', (a) => is(a.card, 'recall'));
  if (recall && c.deck.length <= 6 && c.discard.length >= 5) return recall;

  const draw = pick(legal, 'draw');
  if (draw && c.hand.length <= 2 && c.deck.length > 4) return draw;
  if (c.credits < 7) return pick(legal, 'credit')!;
  if (draw && c.hand.length < 5 && c.deck.length > 4) return draw;
  return pick(legal, 'credit')!;
}

function corpRun(v: GameState, legal: Action[]): Action {
  const run = v.run!;
  if (run.step === 'corpTrash') {
    const best = [...v.ghost.programs].sort((a, b) => Number(!!cardOf(b).breaker) - Number(!!cardOf(a).breaker) || (cardOf(b).cost ?? 0) - (cardOf(a).cost ?? 0))[0];
    return pick(legal, 'chooseTrash', (a) => a.card === best)!;
  }
  // approach: switch the ICE on unless letting the Ghost in is better
  const node = nodeOf(v, run.node);
  const trapInside = node.root && cardOf(node.root.card).trap;
  const nothingInside = isSite(node.id) && !node.root;
  if (trapInside || nothingInside) return pick(legal, 'decline')!;
  return pick(legal, 'activate')!;
}

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

/** Subroutines the Ghost bot insists on breaking. */
function mustBreak(v: GameState, ice: CardId, broken: number[] = []): number[] {
  const out: number[] = [];
  cardOf(ice).subs!.forEach((s, i) => {
    if (broken.includes(i)) return;
    if (s.op === 'endRun' || s.op === 'damage' || (s.op === 'trashProgram' && v.ghost.programs.length > 0)) out.push(i);
  });
  return out;
}

/** Cheapest way to break `n` subroutines of this ICE with an installed breaker. */
function breakPlan(v: GameState, ice: CardId, n: number): { card: CardId; cost: number } | null {
  let best: { card: CardId; cost: number } | null = null;
  for (const card of v.ghost.programs) {
    if (!canBreak(card, ice)) continue;
    const b = cardOf(card).breaker!;
    const need = Math.max(0, (cardOf(ice).strength ?? 0) - breakerStrength(v, card));
    const cost = Math.ceil(need / b.boostBy) * b.boostCost + n * b.breakCost;
    if (!best || cost < best.cost) best = { card, cost };
  }
  return best;
}

/** Worst damage a facedown ICE could do, given what the Corp can afford to switch on. */
function faceCheckDamage(v: GameState): number {
  return Math.max(0, ...CARDS.filter((d) => d.type === 'ice' && (d.cost ?? 0) <= v.corp.credits).map(totalDamage));
}

interface Path {
  cost: number;
  unknown: number;
  blocked: boolean;
  damage: number;
}

function pathCost(v: GameState, nodeId: NodeId, fromPos: number, noActivate = false): Path {
  const node = nodeOf(v, nodeId);
  const p: Path = { cost: 0, unknown: 0, blocked: false, damage: 0 };
  for (let pos = fromPos; pos >= 0; pos--) {
    const inst = node.ice[pos];
    if (!inst.active && noActivate) continue;
    if (isHidden(inst.card)) {
      if (v.corp.credits >= 1) p.unknown++;
      continue;
    }
    const d = cardOf(inst.card);
    if (!inst.active && v.corp.credits < (d.cost ?? 0)) continue;
    const must = mustBreak(v, inst.card);
    const plan = breakPlan(v, inst.card, must.length);
    if (plan) p.cost += plan.cost;
    else if (d.subs!.some((s) => s.op === 'endRun')) p.blocked = true;
    else p.damage += totalDamage(d);
  }
  return p;
}

/** Damage the card inside a site might do if it is a trap. */
function trapRisk(v: GameState, node: NodeState): number {
  if (!node.root) return 0;
  if (isHidden(node.root.card)) return 2 + node.root.dev;
  return cardOf(node.root.card).trap ? 99 : 0;
}

function runsThisTurn(v: GameState, name: string): number {
  let n = 0;
  for (let i = v.events.length - 1; i >= 0 && v.events[i].type !== 'turn'; i--) if (v.events[i].type === 'run' && v.events[i].text.includes(name)) n++;
  return n;
}

function nodeValue(v: GameState, n: NodeState): number {
  const g = v.ghost;
  if (n.id === 'mainframe') return runsThisTurn(v, 'Mainframe') ? 0 : 5 + 2 * count(g.programs, 'deep-probe');
  if (n.id === 'command') return runsThisTurn(v, 'Command') >= 2 || !v.corp.hand.length ? 0 : 4 + (v.corp.hand.length >= 4 ? 1 : 0);
  if (n.id === 'dump') {
    const unseen = v.corp.discard.filter(isHidden).length;
    return unseen >= 3 ? 2 + unseen : 0;
  }
  if (!n.root) return 0;
  if (isHidden(n.root.card)) return 8 + 3 * n.root.dev;
  const d = cardOf(n.root.card);
  if (d.type === 'project') return 20;
  if (d.trap) return 0;
  return g.credits >= (d.trash ?? 0) + 4 ? 3 : 0;
}

interface RunChoice {
  node: NodeId;
  score: number;
  blackout: boolean;
}

function bestRun(v: GameState, legal: Action[]): RunChoice | null {
  const g = v.ghost;
  const hasBlackout = !!pick(legal, 'play', (a) => is(a.card, 'blackout'));
  let best: RunChoice | null = null;
  for (const n of v.corp.nodes) {
    if (!pick(legal, 'run', (a) => a.node === n.id)) continue;
    const value = nodeValue(v, n);
    if (value <= 0) continue;
    for (const blackout of hasBlackout ? [false, true] : [false]) {
      const p = pathCost(v, n.id, n.ice.length - 1, blackout);
      const extra = blackout ? 2 : 0;
      if (blackout && !n.ice.some((i) => !i.active)) continue;
      if (p.blocked || p.cost + extra + p.unknown > g.credits) continue;
      const risk = p.damage + (p.unknown ? faceCheckDamage(v) : 0);
      if (g.hand.length < risk + 1 || g.hand.length - risk < trapRisk(v, n)) continue;
      const score = value - 0.5 * (p.cost + extra) - p.unknown;
      if (!best || score > best.score) best = { node: n.id, score, blackout };
    }
  }
  return best;
}

function ghostDiscardValue(v: GameState, card: CardId): number {
  const d = cardOf(card);
  const g = v.ghost;
  if (d.breaker) {
    const covered = g.programs.some((p) => cardOf(p).breaker && (cardOf(p).breaker!.breaks === d.breaker!.breaks || cardOf(p).breaker!.breaks === 'any'));
    return covered ? 1 : 9;
  }
  if (d.id === 'fast-money') return 7;
  if (d.id === 'burner-phone') return g.heat ? 8 : 3;
  const dupes = g.hand.filter((c) => cardOf(c).id === d.id).length - 1;
  return 5 - dupes;
}

function ghostTurn(v: GameState, legal: Action[]): Action {
  const g = v.ghost;
  const install = (def: string) => pick(legal, 'install', (a) => is(a.card, def));
  const play = (def: string) => pick(legal, 'play', (a) => is(a.card, def));

  // heat gets people killed: shed it first
  const phone = pick(legal, 'use', (a) => is(a.card, 'burner-phone'));
  if (phone) return phone;
  if (g.cycles <= 0) return pick(legal, 'endTurn')!;
  const shed = pick(legal, 'shedHeat');
  if (shed) return shed;

  const money = play('fast-money');
  if (money) return money;
  if (v.turnNumber <= 14 && install('street-fence')) return install('street-fence')!;

  // one breaker per ICE type
  const covers = (t: string) => g.programs.some((p) => cardOf(p).breaker?.breaks === t || cardOf(p).breaker?.breaks === 'any');
  const breakers = legal
    .filter((a): a is Of<'install'> => a.type === 'install' && !!cardOf(a.card).breaker)
    .filter((a) => {
      const b = cardOf(a.card).breaker!;
      return b.breaks === 'any' ? !(covers('wall') && covers('cipher') && covers('hunter')) : !covers(b.breaks);
    })
    .sort((a, b) => (cardOf(a.card).cost ?? 0) - (cardOf(b.card).cost ?? 0));
  if (breakers.length) return breakers[0];

  const run = bestRun(v, legal);
  const go = (r: RunChoice): Action => {
    if (r.blackout) return pick(legal, 'play', (a) => is(a.card, 'blackout') && a.node === r.node)!;
    if (r.node === 'mainframe' && play('deep-dive') && g.credits >= 3) return play('deep-dive')!;
    if (r.node === 'command' && play('payroll-heist') && v.corp.credits >= 4 && g.heat === 0) return play('payroll-heist')!;
    return pick(legal, 'run', (a) => a.node === r.node)!;
  };
  if (run && run.score >= 6) return go(run);

  // look before leaping into a developed card
  const suspect = v.corp.nodes.find((n) => n.root && isHidden(n.root.card) && n.root.dev > 0);
  const recon = suspect && pick(legal, 'play', (a) => is(a.card, 'recon-sweep') && a.node === suspect.id);
  if (recon) return recon;

  if (install('padded-rig')) return install('padded-rig')!;
  const freeRam = ramLimit(v) - ramUsed(v);
  const allCovered = covers('wall') && covers('cipher') && covers('hunter');
  if (freeRam >= 2 || allCovered) {
    if (install('packet-skimmer')) return install('packet-skimmer')!;
    if (install('deep-probe')) return install('deep-probe')!;
  }
  if (freeRam <= 0 && !allCovered && install('ram-brick')) return install('ram-brick')!;
  if (install('safehouse')) return install('safehouse')!;
  if (install('burner-phone') && g.credits >= 4) return install('burner-phone')!;
  const salvage = pick(legal, 'play', (a) => is(a.card, 'salvage') && !!cardOf(a.target!).breaker);
  if (salvage) return salvage;

  if (g.hand.length <= 3 && play('cram-session')) return play('cram-session')!;
  const safehouse = pick(legal, 'use', (a) => is(a.card, 'safehouse'));
  if (safehouse && g.hand.length <= 2) return safehouse;

  if (run && run.score > 0) return go(run);

  const draw = pick(legal, 'draw');
  if (g.credits < 4) return pick(legal, 'credit')!;
  if (draw && g.hand.length < 5) return draw;
  return pick(legal, 'credit')!;
}

function ghostRun(v: GameState, legal: Action[]): Action {
  const run = v.run!;
  const g = v.ghost;
  const node = nodeOf(v, run.node);
  if (run.step === 'encounter') {
    const ice = currentIce(v)!.card;
    const d = cardOf(ice);
    const must = mustBreak(v, ice, run.broken);
    const act = (plan: { card: CardId }, sub: number): Action | undefined =>
      pick(legal, 'boost', (a) => a.card === plan.card) ?? pick(legal, 'break', (a) => a.card === plan.card && a.sub === sub);
    if (must.length) {
      const plan = breakPlan(v, ice, must.length);
      if (plan && plan.cost <= g.credits) {
        const a = act(plan, must[0]);
        if (a) return a;
      }
      // cannot get through: at least stop damage that would land before the run ends
      const firstEnd = d.subs!.findIndex((s, i) => s.op === 'endRun' && !run.broken.includes(i));
      const hits = must.filter((i) => d.subs![i].op === 'damage' && (firstEnd < 0 || i < firstEnd));
      const hurt = hits.reduce((n, i) => n + (d.subs![i] as { n: number }).n, 0);
      const soft = breakPlan(v, ice, hits.length);
      if (hits.length && soft && soft.cost <= g.credits && hurt >= g.hand.length) {
        const a = act(soft, hits[0]);
        if (a) return a;
      }
      return pick(legal, 'proceed')!;
    }
    // optional: stop heat and credit loss when it is cheap
    for (let i = 0; i < d.subs!.length; i++) {
      if (run.broken.includes(i)) continue;
      const s = d.subs![i];
      const worth = s.op === 'heat' ? 2 : s.op === 'loseCredits' ? Math.min(s.n, g.credits) : 0;
      const plan = breakPlan(v, ice, 1);
      if (plan && worth > plan.cost && g.credits >= plan.cost + 1) {
        const a = act(plan, i);
        if (a) return a;
      }
    }
    return pick(legal, 'proceed')!;
  }
  if (run.step === 'passed') {
    const p = pathCost(v, run.node, run.pos - 1, run.noActivate);
    const risk = p.damage + (p.unknown ? faceCheckDamage(v) : 0);
    const trap = run.heist ? 0 : trapRisk(v, node);
    if (p.blocked || p.cost > g.credits || g.hand.length < risk || g.hand.length - risk < trap) return pick(legal, 'jackOut')!;
    return pick(legal, 'continue')!;
  }
  // access
  const steal = pick(legal, 'steal');
  if (steal) return steal;
  const trash = pick(legal, 'trash');
  if (trash) {
    const d = cardOf(run.accessing!);
    if ((d.trash ?? 0) === 0 || g.credits >= (d.trash ?? 0) + 3) return trash;
  }
  return pick(legal, 'leave')!;
}

// ---------------------------------------------------------------------------

/** Choose an action for whoever must act in this view. */
export function chooseAction(v: GameState): Action {
  const side = actor(v) as Side;
  const legal = legalActions(v);
  if (v.phase === 'mulligan') {
    const hand = v[side].hand.map(cardOf);
    const bad =
      side === 'corp'
        ? !hand.some((d) => d.type === 'ice') || hand.filter((d) => d.type === 'project').length >= 3
        : !hand.some((d) => d.breaker) && !hand.some((d) => d.id === 'fast-money' || d.id === 'street-fence');
    return { type: bad ? 'mulligan' : 'keep' };
  }
  if (v.phase === 'discard') {
    const value = side === 'corp' ? corpDiscardValue : ghostDiscardValue;
    const worst = [...v[side].hand].sort((a, b) => value(v, a) - value(v, b))[0];
    return { type: 'discard', card: worst };
  }
  if (v.phase === 'run') return side === 'corp' ? corpRun(v, legal) : ghostRun(v, legal);
  return side === 'corp' ? corpTurn(v, legal) : ghostTurn(v, legal);
}
