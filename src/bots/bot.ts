// Rule-based bots for both sides. They only ever receive viewFor(state, side) and always
// return one of legalActions(view), so they cannot cheat or make an illegal move.
import { CARDS, cardOf, is, isHidden } from '../engine/cards';
import { legalActions } from '../engine/legal';
import { actor, available, breakerStrength, canBreak, currentIce, iceStrength, isSite, link, nodeOf, ramLimit, ramUsed, rigSum } from '../engine/state';
import type { Action, CardDef, CardId, GameState, NodeId, NodeState, Side } from '../engine/types';

/** How hard the bot plays. Hard is the full bot; lower levels drop some of its care. */
export type BotLevel = 'easy' | 'normal' | 'hard';

interface Style {
  /** the chance of being flatlined the Ghost accepts on a run */
  lethalOk: number;
  /** the Ghost keeps its hand out of reach of the Corp's damage directives */
  watchPunishment: boolean;
  /** the Corp keeps credits back to switch on the ICE guarding its projects */
  reserve: boolean;
  /** the Corp plays damage and credit-loss directives */
  punish: boolean;
  /** the Corp outbids the Ghost on traces */
  traceBid: boolean;
  /** share of ordinary turn decisions where the bot plays carelessly (Corp: takes a credit; Ghost: runs somewhere) */
  slack: number;
  /** credits the Ghost keeps before making low-value runs */
  bank: number;
}

export const LEVELS: Record<BotLevel, Style> = {
  easy: { lethalOk: 0.2, watchPunishment: false, reserve: false, punish: false, traceBid: false, slack: 0.3, bank: 0 },
  normal: { lethalOk: 0.08, watchPunishment: true, reserve: true, punish: true, traceBid: true, slack: 0.1, bank: 6 },
  hard: { lethalOk: 0.04, watchPunishment: true, reserve: true, punish: true, traceBid: true, slack: 0, bank: 10 },
};

/** Set at the start of each chooseAction call; the bot is synchronous, so this is never shared between calls. */
let style: Style = LEVELS.hard;

/** A stable number in [0, 1) from what the bot can see, so lazy moves replay exactly. */
function noise(v: GameState): number {
  let h = (v.seq * 2654435761) ^ (v.turnNumber * 40503) ^ (v.corp.credits * 97 + v.ghost.credits * 31);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return h / 4294967296;
}

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

function pick<T extends Action['type']>(legal: Action[], type: T, pred: (a: Of<T>) => boolean = () => true): Of<T> | undefined {
  return legal.find((a): a is Of<T> => a.type === type && pred(a as Of<T>));
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
  if (d.type === 'project') return 3;
  return d.trap ? 1 : 0;
}

/** Credits the Corp keeps back to switch on the inactive ICE guarding its projects during the Ghost's turn. */
function iceReserve(v: GameState): number {
  let most = 0;
  for (const n of v.corp.nodes) {
    const guarded = n.root ? cardOf(n.root.card).type === 'project' : n.id === 'command' || n.id === 'mainframe';
    if (!guarded) continue;
    const need = n.ice.filter((i) => !i.active).reduce((a, i) => a + (cardOf(i.card).cost ?? 0), 0);
    most = Math.max(most, n.root ? need : Math.min(need, 3));
  }
  return Math.min(most, 8);
}

function corpTurn(v: GameState, legal: Action[]): Action {
  const c = v.corp;
  const reserve = style.reserve ? iceReserve(v) : 0;
  /** Can the Corp spend this much and still switch its ICE on later? */
  const spare = (n: number) => c.credits - n >= reserve;
  const g = v.ghost;
  const sites = c.nodes.filter((n) => isSite(n.id));
  const inHand = (def: string) => c.hand.find((x) => is(x, def));

  const score = pick(legal, 'score');
  if (score) return score;
  // on its own turn, only switch on cards that pay over time; the rest wait for a run
  const econ = pick(legal, 'activate', (a) => !!cardOf(a.card).onTurnStart?.length || !!cardOf(a.card).recurring);
  if (econ) return econ;
  if (c.cycles <= 0) return pick(legal, 'endTurn')!;

  // viruses snowball: purge once they add up
  const viruses = Object.values(g.virus).reduce((a, b) => a + b, 0);
  const purge = pick(legal, 'purge');
  if (purge && viruses >= 3 && !pick(legal, 'develop')) return purge;

  // lethal or heavy Burn Notice
  const rigs = Math.max(0, rigSum(v, (d) => d.prevent?.meat) - v.flags.prevented.meat);
  const burn = style.punish ? pick(legal, 'play', (a) => is(a.card, 'burn-notice')) : undefined;
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
  if (freeze && style.punish && g.credits >= 3) return freeze;
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
      .filter((x) => x.lack > 0 && (spare(x.n.ice.length) || x.n.ice.length === 0))
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
    if (dev && n.root.dev < cardOf(n.root.card).dev! && spare(1)) return dev;
  }

  // assets: Shell Company on its own, Decoy Lab somewhere it looks like a project
  const shellCard = c.hand.find((x) => cardOf(x).type === 'asset' && !cardOf(x).trap && (cardOf(x).onTurnStart?.length || cardOf(x).recurring));
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
    if (n.root && is(n.root.card, 'decoy-lab') && n.root.dev < 2 && spare(4)) {
      const dev = pick(legal, 'develop', (a) => a.card === n.root!.card);
      if (dev) return dev;
    }
  }

  // upgrades: on the scoring site, else the Mainframe or Command
  const up = c.hand.find((x) => cardOf(x).type === 'upgrade');
  if (up && c.cycles >= 2) {
    const target = sites.find((n) => n.root && cardOf(n.root.card).type === 'project') ?? open ?? nodeOf(v, cardOf(up).iceStrength ? 'command' : 'mainframe');
    const crowded = target.upgrades.length >= 1;
    const a = !crowded && pick(legal, 'install', (x) => x.card === up && x.node === target.id);
    if (a) return a;
  }
  const desk = c.hand.find((x) => cardOf(x).onActivateInRun?.length && cardOf(x).type === 'asset');
  if (desk && c.cycles >= 2) {
    const a = pick(legal, 'install', (x) => x.card === desk && x.node === 'new');
    if (a) return a;
  }
  // custom directives that only make money or draw
  const plain = pick(legal, 'play', (a) => {
    const fx = cardOf(a.card).onPlay ?? [];
    return fx.length > 0 && fx.every((e) => e.op === 'gain' || e.op === 'draw') && !is(a.card, 'quarterly-windfall');
  });
  if (plain && c.credits >= (cardOf(plain.card).cost ?? 0) + 2) return plain;

  const cleanup = pick(legal, 'play', (a) => !!cardOf(a.card).onPlay?.some((e) => e.op === 'clearBadPublicity'));
  if (cleanup && c.badPublicity > 0 && c.credits >= 5) return cleanup;
  const traced = pick(legal, 'play', (a) => !!cardOf(a.card).onPlay?.some((e) => e.op === 'trace'));
  if (traced && spare((cardOf(traced.card).cost ?? 0) + 3)) return traced;

  const hunt = pick(legal, 'trashContact');
  if (hunt && spare(4)) return hunt;
  const recall = pick(legal, 'play', (a) => is(a.card, 'recall'));
  if (recall && c.deck.length <= 6 && c.discard.length >= 5) return recall;

  const draw = pick(legal, 'draw');
  if (draw && c.hand.length <= 2 && c.deck.length > 4) return draw;
  if (c.credits < 7 || !spare(2)) return pick(legal, 'credit')!;
  if (draw && c.hand.length < 5 && c.deck.length > 4) return draw;
  return pick(legal, 'credit')!;
}

function corpRun(v: GameState, legal: Action[]): Action {
  const run = v.run!;
  if (run.step === 'corpTrash') {
    const best = [...v.ghost.programs].sort((a, b) => Number(!!cardOf(b).breaker) - Number(!!cardOf(a).breaker) || (cardOf(b).cost ?? 0) - (cardOf(a).cost ?? 0))[0];
    return pick(legal, 'chooseTrash', (a) => a.card === best)!;
  }
  const node = nodeOf(v, run.node);
  const valuable = !isSite(node.id) || (!!node.root && cardOf(node.root.card).type === 'project');
  {
    // punish the run, or lock the node, with cards that work mid-run
    const iceCost = run.step === 'approach' ? (cardOf(currentIce(v)!.card).cost ?? 0) : 0;
    for (const a of legal) {
      if (a.type !== 'activate' || (run.step === 'approach' && a.card === currentIce(v)?.card)) continue;
      const d = cardOf(a.card);
      const spare = v.corp.credits - (d.cost ?? 0) >= iceCost;
      const here = node.upgrades.some((u) => u.card === a.card);
      if (d.onActivateInRun?.length && spare) return a;
      if (here && valuable && spare && d.iceStrength && run.step === 'approach') return a;
      if (here && valuable && spare && d.onApproachNode?.length && run.step === 'approachNode') return a;
    }
    if (run.step !== 'approach') return pick(legal, 'decline')!;
  }
  // approach: switch the ICE on unless letting the Ghost in is better
  const trapInside = node.root && cardOf(node.root.card).trap;
  const nothingInside = isSite(node.id) && !node.root;
  if (trapInside || nothingInside) return pick(legal, 'decline')!;
  return pick(legal, 'activate', (a) => a.card === currentIce(v)?.card) ?? pick(legal, 'decline')!;
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
    const need = Math.max(0, iceStrength(v, ice) - breakerStrength(v, card));
    const cost = Math.ceil(need / b.boostBy) * b.boostCost + n * b.breakCost;
    if (!best || cost < best.cost) best = { card, cost };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ghost run planning: what facedown cards probably are, and what a run probably costs
// ---------------------------------------------------------------------------

/** Corp cards of a type the Ghost has not seen yet, weighted by printed copies (the Corp deck list is hidden). */
function unseenPool(v: GameState, types: string[]): { def: CardDef; w: number }[] {
  const replaced = new Set(v.setup.cards.map((c) => c.id.replace(/^x[0-9a-f]{8}-/, '')));
  const pool = [...CARDS.filter((c) => !replaced.has(c.id)), ...v.setup.cards].filter((d) => d.side === 'corp' && types.includes(d.type));
  const seen: Record<string, number> = {};
  const note = (c: CardId) => {
    if (!isHidden(c)) seen[cardOf(c).id] = (seen[cardOf(c).id] ?? 0) + 1;
  };
  for (const n of v.corp.nodes) for (const i of [...n.ice, ...n.upgrades, ...(n.root ? [n.root] : [])]) note(i.card);
  [...v.corp.discard, ...v.corp.scored, ...v.ghost.scored].forEach(note);
  return pool.map((def) => ({ def, w: Math.max(0, def.copies - (seen[def.id] ?? 0)) })).filter((x) => x.w > 0);
}

/** Damage taken, as a probability distribution. */
type Dist = Map<number, number>;
function addTo(d: Dist, k: number, p: number) {
  if (p > 0) d.set(k, (d.get(k) ?? 0) + p);
}

interface Plan {
  /** chance the run gets past every ICE */
  through: number;
  /** expected credits spent breaking */
  cost: number;
  /** damage taken on the way, over every outcome */
  damage: Dist;
}

/** One ICE: what happens if the Ghost meets it, given the credits it has left. */
function meet(v: GameState, def: CardDef, iceId: CardId | null, budget: number): { through: boolean; cost: number; damage: number } {
  const subs = def.subs ?? [];
  const must = subs.map((s, i) => (s.op === 'endRun' || s.op === 'damage' || (s.op === 'trashProgram' && v.ghost.programs.length > 0) ? i : -1)).filter((i) => i >= 0);
  let best: number | null = null;
  for (const card of v.ghost.programs) {
    const b = cardOf(card).breaker;
    if (!b || (b.breaks !== 'any' && b.breaks !== def.subtype)) continue;
    const strength = iceId ? iceStrength(v, iceId) : (def.strength ?? 0);
    const need = Math.max(0, strength - breakerStrength(v, card));
    const cost = Math.ceil(need / b.boostBy) * b.boostCost + must.length * b.breakCost;
    if (best === null || cost < best) best = cost;
  }
  if (best !== null && best <= budget) return { through: true, cost: best, damage: 0 };
  // cannot break it all: the subroutines fire in order until one ends the run
  let damage = 0;
  for (const s of subs) {
    if (s.op === 'endRun') return { through: false, cost: 0, damage };
    if (s.op === 'damage') damage += s.n + (s.perHeat ?? 0) * v.ghost.heat;
  }
  return { through: true, cost: 0, damage };
}

function plan(v: GameState, nodeId: NodeId, fromPos: number, opts: { noActivate?: boolean; bypass?: number; budget: number }): Plan {
  const node = nodeOf(v, nodeId);
  // states still running: [probability, damage so far, credits left]
  let alive: [number, number, number][] = [[1, 0, opts.budget]];
  const damage: Dist = new Map();
  let cost = 0;
  let bypass = opts.bypass ?? 0;
  const iceGuess = unseenPool(v, ['ice']);
  for (let pos = fromPos; pos >= 0; pos--) {
    const inst = node.ice[pos];
    if (!inst.active && opts.noActivate) continue;
    // candidates for what this ICE is: [probability, def]
    let cands: [number, CardDef][];
    if (isHidden(inst.card)) {
      const total = iceGuess.reduce((a, x) => a + x.w, 0) || 1;
      cands = iceGuess.map((x) => [x.w / total, x.def]);
    } else cands = [[1, cardOf(inst.card)]];
    const next: [number, number, number][] = [];
    for (const [p, dmg, left] of alive) {
      for (const [q, def] of cands) {
        const pq = p * q;
        // inactive ICE the Corp cannot afford is passed; affordable ICE is assumed switched on
        if (!inst.active && v.corp.credits < (def.cost ?? 0)) {
          next.push([pq, dmg, left]);
          continue;
        }
        if (bypass > 0) {
          next.push([pq, dmg, left]);
          continue;
        }
        const r = meet(v, def, isHidden(inst.card) ? null : inst.card, left);
        cost += pq * r.cost;
        if (r.through) next.push([pq, dmg + r.damage, left - r.cost]);
        else addTo(damage, dmg + r.damage, pq);
      }
    }
    if (bypass > 0 && (inst.active || !opts.noActivate)) bypass--;
    // merge identical states to keep this small
    const merged = new Map<string, [number, number, number]>();
    for (const [p, d, l] of next) {
      const k = `${d}:${l}`;
      const m = merged.get(k);
      if (m) m[0] += p;
      else merged.set(k, [p, d, l]);
    }
    alive = [...merged.values()];
  }
  // tolls at the node
  let toll = 0;
  for (const u of node.upgrades) if (u.active) for (const e of cardOf(u.card).onApproachNode ?? []) if (e.op === 'payOrEndRun') toll += e.n;
  let through = 0;
  for (const [p, d, left] of alive) {
    if (left < toll) addTo(damage, d, p);
    else {
      through += p;
      addTo(damage, d, p);
    }
  }
  return { through, cost: cost + through * toll, damage };
}

/** Chance that this much damage, or more, flatlines the Ghost. */
function lethal(v: GameState, d: Dist, extra = 0): number {
  let p = 0;
  for (const [k, q] of d) if (k + extra > v.ghost.hand.length) p += q;
  return p;
}

function expected(d: Dist): number {
  let e = 0;
  for (const [k, q] of d) e += k * q;
  return e;
}

/** What a facedown card in a site might be: chance it is a project, a trap, and the trap's damage. */
function rootGuess(v: GameState, node: NodeState): { project: number; trap: number; trapDamage: number } {
  const root = node.root!;
  if (!isHidden(root.card)) {
    const d = cardOf(root.card);
    return { project: d.type === 'project' ? 1 : 0, trap: d.trap ? 1 : 0, trapDamage: d.trap ? trapDamage(d, root.dev) : 0 };
  }
  // counters only go on projects and developable assets
  const pool = unseenPool(v, ['project', 'asset']).filter((x) => root.dev === 0 || x.def.type === 'project' || x.def.developable);
  const total = pool.reduce((a, x) => a + x.w, 0) || 1;
  let project = 0;
  let trap = 0;
  let trapDmg = 0;
  for (const x of pool) {
    if (x.def.type === 'project') project += x.w / total;
    if (x.def.trap) {
      trap += x.w / total;
      trapDmg = Math.max(trapDmg, trapDamage(x.def, root.dev));
    }
  }
  return { project, trap, trapDamage: trapDmg };
}

function trapDamage(d: CardDef, dev: number): number {
  return (d.onAccess ?? []).reduce((a, e) => a + (e.op === 'damage' ? e.n + (e.perDev ?? 0) * dev : 0), 0);
}

function runsThisTurn(v: GameState, name: string): number {
  let n = 0;
  for (let i = v.events.length - 1; i >= 0 && v.events[i].type !== 'turn'; i--) if (v.events[i].type === 'run' && v.events[i].text.includes(name)) n++;
  return n;
}

function nodeValue(v: GameState, n: NodeState): number {
  const g = v.ghost;
  // the chance a card the Ghost has not seen is a project, and what a project is worth
  const all = unseenPool(v, ['project', 'ice', 'asset', 'upgrade', 'directive']);
  const total = all.reduce((a, x) => a + x.w, 0) || 1;
  const pProject = all.filter((x) => x.def.type === 'project').reduce((a, x) => a + x.w, 0) / total;
  const steal = 16;
  if (n.id === 'mainframe') {
    if (runsThisTurn(v, 'Mainframe')) return 0;
    const viral = g.programs.reduce((k, p) => k + (cardOf(p).virusAccess ? Math.floor(((g.virus[p] ?? 0) + 1) / cardOf(p).virusAccess!) : 0), 0);
    const cards = 1 + rigSum(v, (d) => d.mainframeAccess) + viral;
    return 1 + cards * pProject * steal;
  }
  if (n.id === 'command') {
    if (runsThisTurn(v, 'Command') >= 2 || !v.corp.hand.length) return 0;
    // the Corp holds projects it has no safe place for: a full hand is richer
    return 1 + pProject * steal * (v.corp.hand.length >= 5 ? 1.3 : 1);
  }
  if (n.id === 'dump') {
    const unseen = v.corp.discard.filter(isHidden).length;
    return unseen >= 3 ? 2 + unseen : 0;
  }
  if (!n.root) return n.upgrades.some((u) => isHidden(u.card) || !cardOf(u.card).trap) ? 1 : 0;
  const guess = rootGuess(v, n);
  // a project with counters on it is close to being scored: stealing it now matters more
  const project = guess.project * (14 + 3 * n.root.dev);
  const d = isHidden(n.root.card) ? null : cardOf(n.root.card);
  const asset = d && d.type === 'asset' && !d.trap && g.credits >= (d.trash ?? 0) + 4 ? 3 : 0;
  return project + asset + (isHidden(n.root.card) ? 1 : 0);
}

/**
 * The most meat or net damage the Corp could deal on its next turn with directives it has not
 * shown yet, given heat now and credits it could have (its own plus about 2 more), minus prevention.
 */
function punishment(v: GameState): number {
  const g = v.ghost;
  const credits = v.corp.credits + 2;
  const hits: number[] = [];
  for (const { def, w } of unseenPool(v, ['directive'])) {
    if (def.playIf === 'ghostHasHeat' && g.heat === 0) continue;
    if (def.playIf === 'ghostRanLastTurn' && !v.flags.successfulRun) continue;
    const dmg = (def.onPlay ?? []).reduce((a, e) => a + (e.op === 'damage' ? e.n + (e.perHeat ?? 0) * g.heat : 0), 0);
    for (let k = 0; k < Math.min(w, 2); k++) if (dmg > 0) hits.push(dmg * 100 + (def.cost ?? 0));
  }
  // the Corp has 3 cycles; play the biggest ones it can pay for
  hits.sort((a, b) => b - a);
  let total = 0;
  let left = credits;
  let plays = 0;
  for (const h of hits) {
    const dmg = Math.floor(h / 100);
    const cost = h % 100;
    if (plays < 3 && cost <= left) {
      total += dmg;
      left -= cost;
      plays++;
    }
  }
  const prevent = rigSum(v, (d) => d.prevent?.meat);
  return Math.max(0, total - prevent);
}

/** How much damage the Ghost bot will risk: the chance of being flatlined it accepts. */

interface RunChoice {
  node: NodeId;
  score: number;
  /** expected credits it costs */
  cost: number;
  blackout: boolean;
  sideDoor?: boolean;
}

function bestRun(v: GameState, legal: Action[]): RunChoice | null {
  const hasBlackout = !!pick(legal, 'play', (a) => is(a.card, 'blackout'));
  const hasSideDoor = !!pick(legal, 'play', (a) => !!cardOf(a.card).onPlay?.some((e) => e.op === 'run' && !!e.bypass));
  const budget = available(v, 'ghost', 'break') + v.corp.badPublicity;
  let best: RunChoice | null = null;
  for (const n of v.corp.nodes) {
    if (!pick(legal, 'run', (a) => a.node === n.id)) continue;
    const value = nodeValue(v, n);
    if (value <= 0) continue;
    const options: [boolean, boolean][] = [[false, false]];
    if (hasBlackout && n.ice.some((i) => !i.active)) options.push([true, false]);
    if (hasSideDoor && n.ice.length) options.push([false, true]);
    for (const [blackout, sideDoor] of options) {
      const extra = blackout || sideDoor ? 2 : 0;
      const p = plan(v, n.id, n.ice.length - 1, { noActivate: blackout, bypass: sideDoor ? 1 : 0, budget: budget - extra });
      if (p.through < 0.25) continue;
      const trap = n.root ? rootGuess(v, n) : { trap: 0, trapDamage: 0 };
      const risk = lethal(v, p.damage) + p.through * trap.trap * lethal(v, p.damage, trap.trapDamage);
      if (risk > style.lethalOk) continue;
      const hurt = expected(p.damage) + p.through * trap.trap * trap.trapDamage;
      // money is worth more to a poor Ghost
      const weight = v.ghost.credits < 6 ? 1 : 0.5;
      const score = p.through * value - weight * (p.cost + extra) - 1.5 * hurt - (1 - p.through) * 2;
      if (!best || score > best.score) best = { node: n.id, score, cost: p.cost + extra, blackout, sideDoor };
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
  // heat plus a thin hand is how the Corp kills: get out of reach of its punishment cards
  if (style.watchPunishment && punishment(v) >= g.hand.length) {
    const draw = pick(legal, 'draw');
    if (draw && g.credits >= 2 && g.cycles <= 1 && g.heat > 0) return pick(legal, 'credit')!;
    const cram = pick(legal, 'play', (a) => !!cardOf(a.card).onPlay?.every((e) => e.op === 'draw'));
    if (cram) return cram;
    if (draw) return draw;
  }

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

  // a breaker type is still missing: save up for the one in hand, or dig for one
  const missing = (['wall', 'cipher', 'hunter'] as const).filter((t) => !covers(t));
  const wanted = g.hand.filter((c) => {
    const b = cardOf(c).breaker;
    return b && (b.breaks === 'any' ? missing.length > 0 : missing.includes(b.breaks as 'wall'));
  });
  const saving = missing.length > 0 && wanted.length > 0;
  const digging = missing.length > 0 && !wanted.length && g.deck.length > 0;

  const run = bestRun(v, legal);
  const go = (r: RunChoice): Action => {
    if (r.blackout) return pick(legal, 'play', (a) => is(a.card, 'blackout') && a.node === r.node)!;
    if (r.sideDoor) return pick(legal, 'play', (a) => a.node === r.node && !!cardOf(a.card).onPlay?.some((e) => e.op === 'run' && !!e.bypass))!;
    if (r.node === 'mainframe' && play('deep-dive') && g.credits >= 3) return play('deep-dive')!;
    if (r.node === 'command' && play('payroll-heist') && v.corp.credits >= 4 && g.heat === 0) return play('payroll-heist')!;
    return pick(legal, 'run', (a) => a.node === r.node)!;
  };
  if (run && run.score >= 6) return go(run);
  if (saving) {
    const fast = pick(legal, 'play', (a) => !!cardOf(a.card).onPlay?.every((e) => e.op === 'gain'));
    if (fast) return fast;
    return pick(legal, 'credit')!;
  }
  if (digging && g.credits >= 5) {
    const cram = pick(legal, 'play', (a) => !!cardOf(a.card).onPlay?.every((e) => e.op === 'draw'));
    if (cram) return cram;
    const house = pick(legal, 'use', (a) => !!cardOf(a.card).ability?.effects.every((e) => e.op === 'draw') && cardOf(a.card).ability!.cycles > 0);
    if (house) return house;
    const draw = pick(legal, 'draw');
    if (draw) return draw;
  }

  // look before leaping into a developed card
  const suspect = v.corp.nodes.find((n) => n.root && isHidden(n.root.card) && n.root.dev > 0);
  const recon = suspect && pick(legal, 'play', (a) => is(a.card, 'recon-sweep') && a.node === suspect.id);
  if (recon) return recon;

  if (install('padded-rig')) return install('padded-rig')!;
  const frame = pick(legal, 'install', (a) => !!cardOf(a.card).host);
  if (frame && ramLimit(v) - ramUsed(v) <= 1) return frame;
  const cache = pick(legal, 'install', (a) => !!cardOf(a.card).recurring);
  if (cache && g.programs.some((p) => cardOf(p).breaker) && g.credits >= 4) return cache;
  const virus = pick(legal, 'install', (a) => !!cardOf(a.card).virusOn && !a.host);
  if (virus && ramLimit(v) - ramUsed(v) >= 2) return virus;
  const booster = pick(legal, 'install', (a) => !!cardOf(a.card).link && cardOf(a.card).type === 'gear');
  if (booster && g.credits >= 5 && v.turnNumber > 8) return booster;
  const leak = pick(legal, 'play', (a) => !!cardOf(a.card).onPlay?.some((e) => e.op === 'badPublicity'));
  if (leak && g.credits >= 6) return leak;
  if (install('flak-vest') && (g.heat > 0 || v.turnNumber > 6)) return install('flak-vest')!;
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

  // low-value runs only with money in the bank: credits win more games than speculative runs
  if (run && run.score > 0 && g.credits >= style.bank && (missing.length === 0 || g.credits - run.cost >= 3)) return go(run);

  const plain = pick(legal, 'play', (a) => {
    const fx = cardOf(a.card).onPlay ?? [];
    return fx.length > 0 && fx.every((e) => e.op === 'gain' || e.op === 'draw');
  });
  if (plain && g.credits >= (cardOf(plain.card).cost ?? 0)) return plain;

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
    // virus counters lower the ICE before paying to boost
    const termite = pick(legal, 'spendVirus');
    if (termite && must.length && g.programs.some((p) => canBreak(p, ice) && breakerStrength(v, p) < iceStrength(v, ice))) return termite;
    const act = (plan: { card: CardId }, sub: number): Action | undefined =>
      pick(legal, 'boost', (a) => a.card === plan.card) ?? pick(legal, 'break', (a) => a.card === plan.card && a.sub === sub);
    if (must.length) {
      const plan = breakPlan(v, ice, must.length);
      if (plan && plan.cost <= available(v, 'ghost', 'break')) {
        const a = act(plan, must[0]);
        if (a) return a;
      }
      // cannot get through: at least stop damage that would land before the run ends
      const firstEnd = d.subs!.findIndex((s, i) => s.op === 'endRun' && !run.broken.includes(i));
      const hits = must.filter((i) => d.subs![i].op === 'damage' && (firstEnd < 0 || i < firstEnd));
      const hurt = hits.reduce((n, i) => n + (d.subs![i] as { n: number }).n, 0);
      const soft = breakPlan(v, ice, hits.length);
      if (hits.length && soft && soft.cost <= available(v, 'ghost', 'break') && hurt >= g.hand.length) {
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
    const p = plan(v, run.node, run.pos - 1, { noActivate: run.noActivate, bypass: run.bypass, budget: available(v, 'ghost', 'break') + run.bpCredits });
    const trap = run.instead || !node.root ? { trap: 0, trapDamage: 0 } : rootGuess(v, node);
    const risk = lethal(v, p.damage) + p.through * trap.trap * lethal(v, p.damage, trap.trapDamage);
    if (p.through < 0.2 || risk > style.lethalOk) return pick(legal, 'jackOut')!;
    return pick(legal, 'continue')!;
  }
  // access: the order rarely matters; take root cards and upgrades before the Command or Mainframe card
  if (!run.accessing) return pick(legal, 'access')!;
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

/** How hard to push a trace, or how much link to buy. */
function traceChoice(v: GameState, side: Side, legal: Action[]): Action {
  const t = v.trace!;
  const most = legal.length - 1;
  if (side === 'corp') {
    // win it outright if the Ghost cannot match, without emptying the bank
    const target = link(v) + available(v, 'ghost', 'trace') + 1 - t.base;
    const n = !style.traceBid ? Math.min(most, 1) : target <= 0 ? 0 : target <= Math.min(most, Math.max(0, v.corp.credits - 2), 6) ? target : 0;
    return { type: 'traceBoost', n };
  }
  // the Ghost is offered exactly up to what it takes to evade
  const need = most;
  return { type: 'traceBoost', n: need <= 4 && need <= available(v, 'ghost', 'trace') ? need : 0 };
}

/** Choose an action for whoever must act in this view. */
export function chooseAction(v: GameState, level: BotLevel = 'hard'): Action {
  style = LEVELS[level];
  const side = actor(v) as Side;
  // the bots never trash cards as part of an install
  const legal = legalActions(v).filter((a) => !(a.type === 'install' && a.trash));
  if (v.pendingInstall) return pick(legal, 'confirmInstall') ?? pick(legal, 'cancelInstall')!;
  const over = legal.filter((a) => a.type === 'shedProgram');
  if (over.length) return [...over].sort((a, b) => Number(!!cardOf((a as { card: CardId }).card).breaker) - Number(!!cardOf((b as { card: CardId }).card).breaker))[0];
  // lower levels sometimes waste a cycle on a credit instead of thinking
  if (style.slack && v.phase === 'action' && !v.run && !v.trace && v[side].cycles > 0 && noise(v) < style.slack) {
    const runs = legal.filter((a) => a.type === 'run');
    if (side === 'ghost' && runs.length) return runs[Math.floor(noise({ ...v, seq: v.seq + 1 }) * runs.length)];
    const credit = pick(legal, 'credit');
    if (credit) return credit;
  }
  if (v.trace) return traceChoice(v, side, legal);
  if (v.window) {
    // the Corp scores at once, and switches on cards that pay at the start of its turn before the turn begins
    if (side === 'corp') {
      const score = pick(legal, 'score');
      if (score) return score;
      if (v.turn === 'corp' && v.window.at === 'turnStart') {
        const early = pick(legal, 'activate', (a) => !!cardOf(a.card).onTurnStart?.length || !!cardOf(a.card).recurring);
        if (early) return early;
      }
    }
    return pick(legal, 'pass')!;
  }
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
