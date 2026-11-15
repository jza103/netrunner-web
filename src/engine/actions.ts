// apply(state, action): the only way the game changes. Pure: it never touches its input.
// Card behaviour is data (see Effect in types.ts); runEffect() below is the one interpreter for it.
import { cardOf, ensureCards, nameOf } from './cards';
import { conditionHolds, corpRunOptions, isLegal } from './legal';
import { randInt, shuffle } from './rng';
import { actor, cloneState, corpSources, currentIce, findInstalled, ghostSources, iceStrength, link, maxHand, nodeName, nodeOf, points, recurringFor, rigOf, rigSum } from './state';
import {
  CYCLES,
  POINTS_TO_WIN,
  type Action,
  type CardId,
  type DamageKind,
  type Effect,
  type GameState,
  type Installed,
  type Purpose,
  type NodeId,
  type Result,
  type Side,
} from './types';

const other = (side: Side): Side => (side === 'corp' ? 'ghost' : 'corp');
const label = (side: Side) => (side === 'corp' ? 'The Corp' : 'The Ghost');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function emit(s: GameState, type: string, side: Side | undefined, text: string, priv?: { side: Side; text: string }) {
  s.events.push({ seq: ++s.seq, type, text, ...(side ? { side } : {}), ...(priv ? { priv } : {}) });
}

function win(s: GameState, side: Side, reason: string) {
  if (s.phase === 'gameOver') return;
  s.phase = 'gameOver';
  s.run = null;
  s.winner = side;
  s.winReason = reason;
  emit(s, 'gameOver', side, `${label(side)} wins: ${reason}`);
}

// ---------------------------------------------------------------------------
// Basic moves
// ---------------------------------------------------------------------------

function drawCards(s: GameState, side: Side, n: number): number {
  const p = s[side];
  const got = p.deck.splice(-n).reverse();
  p.hand.push(...got);
  if (got.length)
    emit(s, 'draw', side, `${label(side)} draws ${plural(got.length, 'card')}.`, {
      side,
      text: `You draw ${got.map(nameOf).join(', ')}.`,
    });
  return got.length;
}

function gain(s: GameState, side: Side, n: number) {
  s[side].credits += n;
}

/**
 * Pay a cost: recurring credits that may cover it first, then (the Ghost, during a run) bad
 * publicity credits, then the credit pool. legalActions only offers what can be paid.
 */
function pay(s: GameState, side: Side, n: number, purpose: Purpose) {
  for (const r of recurringFor(s, side, purpose)) {
    if (n <= 0) return;
    const k = Math.min(n, r.n);
    s[side].recurring[r.card] -= k;
    n -= k;
  }
  if (side === 'ghost' && s.run && n > 0) {
    const k = Math.min(n, s.run.bpCredits);
    s.run.bpCredits -= k;
    n -= k;
  }
  s[side].credits -= n;
}

/** Take an installed Ghost card off the table into the Scrapheap, with anything it hosts. */
function trashGhostCard(s: GameState, card: CardId) {
  const g = s.ghost;
  g.programs = g.programs.filter((c) => c !== card);
  g.gear = g.gear.filter((c) => c !== card);
  g.contacts = g.contacts.filter((c) => c !== card);
  g.discard.push(card);
  delete g.recurring[card];
  delete g.virus[card];
  delete g.hosted[card];
  for (const [prog, host] of Object.entries(g.hosted)) if (host === card) trashGhostCard(s, prog);
}

/**
 * Deal damage to the Ghost: random discards; more damage than cards in hand is fatal.
 * Core damage also lowers the Ghost's maximum hand size by 1 per point, for good.
 */
export function damage(s: GameState, n: number, source: string, kind: DamageKind = 'net') {
  const g = s.ghost;
  // "each turn, prevent the first N": all such cards together cover the first N of this kind per turn
  const total = rigSum(s, (d) => d.prevent?.[kind]);
  const shield = Math.max(0, Math.min(n, total - s.flags.prevented[kind]));
  if (shield) {
    s.flags.prevented[kind] += shield;
    n -= shield;
    const by = rigOf(s).filter((c) => cardOf(c).prevent?.[kind]).map(nameOf);
    emit(s, 'prevent', 'ghost', `${[...new Set(by)].join(' and ')} prevent${by.length === 1 ? 's' : ''} ${shield} ${kind} damage.`);
  }
  if (n <= 0) return;
  if (n > g.hand.length) {
    g.discard.push(...g.hand.splice(0));
    emit(s, 'damage', 'corp', `${source} deals ${n} ${kind} damage. The Ghost has too few cards to absorb it.`);
    win(s, 'corp', 'the Ghost is flatlined.');
    return;
  }
  const lost: CardId[] = [];
  for (let i = 0; i < n; i++) lost.push(...g.hand.splice(randInt(s, g.hand.length), 1));
  g.discard.push(...lost);
  if (kind === 'core') g.core += n;
  const tail = kind === 'core' ? ` Their maximum hand size is now ${maxHand(s, 'ghost')}.` : '';
  emit(s, 'damage', 'corp', `${source} deals ${n} ${kind} damage. The Ghost loses ${lost.map(nameOf).join(', ')}.${tail}`);
}

function addHeat(s: GameState, n: number) {
  s.ghost.heat += n;
  emit(s, 'heat', 'ghost', `The Ghost gains ${n} heat (now ${s.ghost.heat}).`);
}

function trashProgram(s: GameState, card: CardId) {
  trashGhostCard(s, card);
  emit(s, 'trash', 'corp', `${nameOf(card)} is trashed.`);
}

/** Take a Corp card out of whatever zone it is in. */
function removeCorpCard(s: GameState, card: CardId) {
  const c = s.corp;
  c.hand = c.hand.filter((x) => x !== card);
  c.deck = c.deck.filter((x) => x !== card);
  c.discard = c.discard.filter((x) => x !== card);
  c.discardSeen = c.discardSeen.filter((x) => x !== card);
  delete c.recurring[card];
  for (const n of c.nodes) {
    if (n.root?.card === card) n.root = null;
    n.ice = n.ice.filter((i) => i.card !== card);
    n.upgrades = n.upgrades.filter((i) => i.card !== card);
  }
  s.ghost.known = s.ghost.known.filter((x) => x !== card);
}

function checkPoints(s: GameState, side: Side) {
  if (points(s, side) >= POINTS_TO_WIN) win(s, side, `${points(s, side)} project points.`);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

interface Ctx {
  /** whose card this is */
  owner: Side;
  /** the card's name, for the log */
  source: string;
  /** a chosen target card or node, when the card needs one */
  target?: CardId;
  node?: NodeId;
  /** development counters on the card, for perDev amounts */
  dev?: number;
}

/** 'stop': nothing more resolves (the run or the game ended). 'pause': the Corp must choose a program to trash. */
type Flow = 'ok' | 'stop' | 'pause';

function scaled(s: GameState, e: { n: number; perHeat?: number; perDev?: number }, ctx: Ctx): number {
  return e.n + (e.perHeat ?? 0) * s.ghost.heat + (e.perDev ?? 0) * (ctx.dev ?? 0);
}

export function runEffect(s: GameState, e: Effect, ctx: Ctx): Flow {
  const src = ctx.source;
  switch (e.op) {
    case 'gain': {
      const who = e.who ?? ctx.owner;
      gain(s, who, e.n);
      emit(s, 'gain', who, `${src}: ${who === 'corp' ? 'the Corp' : 'the Ghost'} gains ${plural(e.n, 'credit')}.`);
      return 'ok';
    }
    case 'draw':
      drawCards(s, e.who ?? ctx.owner, e.n);
      return 'ok';
    case 'damage':
      damage(s, scaled(s, e, ctx), src, e.kind);
      return s.phase === 'gameOver' ? 'stop' : 'ok';
    case 'heat':
      addHeat(s, e.n);
      return 'ok';
    case 'shedHeat': {
      const n = Math.min(e.n, s.ghost.heat);
      s.ghost.heat -= n;
      emit(s, 'heat', 'ghost', `${src}: the Ghost sheds ${n} heat (now ${s.ghost.heat}).`);
      return 'ok';
    }
    case 'loseCredits': {
      const n = Math.min(scaled(s, e, ctx), s.ghost.credits);
      s.ghost.credits -= n;
      emit(s, 'sub', 'corp', `${src}: the Ghost loses ${plural(n, 'credit')}.`);
      return 'ok';
    }
    case 'drain': {
      const n = Math.min(e.n, s.corp.credits);
      s.corp.credits -= n;
      gain(s, 'ghost', n);
      emit(s, 'heist', 'ghost', `${src}: the Ghost takes ${plural(n, 'credit')} from the Corp.`);
      return 'ok';
    }
    case 'loseCycle': {
      const n = Math.min(e.n, s.ghost.cycles);
      s.ghost.cycles -= n;
      if (n) emit(s, 'sub', 'corp', `${src}: the Ghost loses ${plural(n, 'cycle')}.`);
      return 'ok';
    }
    case 'trashProgram':
      if (s.ghost.programs.length === 1) trashProgram(s, s.ghost.programs[0]);
      else if (s.ghost.programs.length > 1) return 'pause';
      return 'ok';
    case 'endRun':
      endRun(s, false, `${src} shuts the Ghost out.`);
      return 'stop';
    case 'payOrEndRun':
      if (s.ghost.credits < e.n) {
        endRun(s, false, `${src} locks the Ghost out (they cannot pay ${e.n}).`);
        return 'stop';
      }
      s.ghost.credits -= e.n;
      emit(s, 'sub', 'corp', `${src}: the Ghost pays ${plural(e.n, 'credit')} to get through.`);
      return 'ok';
    case 'develop': {
      const t = findInstalled(s, ctx.target!)!;
      t.inst.dev += e.n;
      emit(s, 'develop', 'corp', `The card in ${nodeName(t.node.id)} now has ${plural(t.inst.dev, 'development counter')}.`);
      return 'ok';
    }
    case 'recycleDump': {
      const c = s.corp;
      c.deck.push(...c.discard.splice(0));
      c.discardSeen = [];
      shuffle(s, c.deck);
      emit(s, 'recycle', 'corp', `${src}: the Corp shuffles the Dump into the Mainframe.`);
      return 'ok';
    }
    case 'run':
      startRun(s, e.node === 'any' ? ctx.node! : e.node, { noActivate: e.noActivate, extraAccess: e.extraAccess, bypass: e.bypass, instead: e.instead, source: src });
      return 'stop';
    case 'trace':
      s.trace = { base: e.n, corpBoost: null, success: e.success, source: src, owner: ctx.owner, rest: [], then: 'none' };
      emit(s, 'trace', 'corp', `${src}: trace ${e.n}. The Ghost's link is ${link(s)}.`);
      return 'pause';
    case 'badPublicity':
      s.corp.badPublicity += e.n;
      emit(s, 'badPublicity', 'corp', `${src}: the Corp takes ${e.n} bad publicity (now ${s.corp.badPublicity}).`);
      return 'ok';
    case 'clearBadPublicity': {
      const n = Math.min(e.n, s.corp.badPublicity);
      s.corp.badPublicity -= n;
      emit(s, 'badPublicity', 'corp', `${src}: the Corp removes ${n} bad publicity (now ${s.corp.badPublicity}).`);
      return 'ok';
    }
    case 'reveal': {
      const g = s.ghost;
      const n = nodeOf(s, ctx.node!);
      const seen = [...n.ice, ...n.upgrades, ...(n.root ? [n.root] : [])].filter((i) => !i.active).map((i) => i.card);
      for (const c of seen) if (!g.known.includes(c)) g.known.push(c);
      emit(s, 'recon', 'ghost', `The Ghost scans ${nodeName(n.id)}.`, { side: 'ghost', text: `You scan ${nodeName(n.id)} and see: ${seen.map(nameOf).join(', ')}.` });
      return 'ok';
    }
    case 'recover': {
      const g = s.ghost;
      g.discard = g.discard.filter((x) => x !== ctx.target);
      g.hand.push(ctx.target!);
      emit(s, 'salvage', 'ghost', `The Ghost recovers ${nameOf(ctx.target!)} from the Scrapheap.`);
      return 'ok';
    }
  }
}

/** Resolve a list of effects in order until one stops or pauses. */
function runEffects(s: GameState, list: Effect[] | undefined, ctx: Ctx): Flow {
  const all = list ?? [];
  for (let i = 0; i < all.length; i++) {
    const f = runEffect(s, all[i], ctx);
    if (f === 'pause' && s.trace) s.trace.rest = all.slice(i + 1);
    if (f !== 'ok') return f;
  }
  return 'ok';
}

/** Both sides have boosted: resolve the trace, then carry on where it paused. */
function finishTrace(s: GameState, ghostBoost: number) {
  const t = s.trace!;
  s.trace = null;
  const strength = t.base + (t.corpBoost ?? 0);
  const ghostLink = link(s) + ghostBoost;
  const ctx: Ctx = { owner: t.owner, source: t.source };
  if (strength > ghostLink) {
    emit(s, 'trace', 'corp', `${t.source}: trace ${strength} against link ${ghostLink}. The trace succeeds.`);
    if (runEffects(s, t.success, ctx) !== 'ok') return;
  } else emit(s, 'trace', 'ghost', `${t.source}: trace ${strength} against link ${ghostLink}. The Ghost evades it.`);
  if (runEffects(s, t.rest, ctx) !== 'ok') return;
  if (t.then === 'subs' && s.run?.step === 'encounter') resolveSubs(s);
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function startTurn(s: GameState, side: Side) {
  s.turn = side;
  s.turnNumber++;
  s.phase = 'action';
  s.flags = { successfulRun: false, prevented: { net: 0, meat: 0, core: 0 } };
  s[side].cycles = CYCLES[side];
  emit(s, 'turn', side, `Turn ${s.turnNumber}: ${label(side)} begins with ${CYCLES[side]} cycles.`);
  if (side === 'corp') {
    if (!s.corp.deck.length) return win(s, 'ghost', 'the Corp must draw from an empty Mainframe.');
    drawCards(s, 'corp', 1);
    for (const c of corpSources(s)) {
      const r = cardOf(c).recurring;
      if (r) s.corp.recurring[c] = r.n;
      runEffects(s, cardOf(c).onTurnStart, { owner: 'corp', source: nameOf(c) });
    }
  } else {
    for (const c of ghostSources(s)) {
      const r = cardOf(c).recurring;
      if (r) s.ghost.recurring[c] = r.n;
      runEffects(s, cardOf(c).onTurnStart, { owner: 'ghost', source: nameOf(c) });
    }
  }
}

function passTurn(s: GameState) {
  if (s.turn === 'ghost') s.ghostSuccessLastTurn = s.flags.successfulRun;
  startTurn(s, other(s.turn));
}

function endTurn(s: GameState) {
  const side = s.turn;
  if (side === 'ghost' && maxHand(s, 'ghost') < 0) return win(s, 'corp', 'the Ghost is flatlined: core damage left them a maximum hand size below 0.');
  if (s[side].hand.length > maxHand(s, side)) {
    s.phase = 'discard';
    emit(s, 'discardDown', side, `${label(side)} must discard down to ${maxHand(s, side)} cards.`);
  } else passTurn(s);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------
// The run follows the Comprehensive Rules' phases: initiation, then for each ICE from the outside
// in: approach (the Corp may activate it), encounter (if it is active), movement (the Ghost may jack
// out, then moves inward); then the Corp's last window, the approach to the node, success and access.
// A Corp window with nothing the Corp could do is skipped; the UI plays a declined window with no
// delay, so a skipped one looks the same.

interface RunOpts {
  noActivate?: boolean;
  extraAccess?: number;
  bypass?: number;
  instead?: Effect[];
  source?: string;
}

function startRun(s: GameState, node: NodeId, opts: RunOpts = {}) {
  s.phase = 'run';
  s.run = {
    node,
    pos: nodeOf(s, node).ice.length - 1,
    step: 'initiation',
    boost: {},
    broken: [],
    subQueue: [],
    candidates: [],
    zoneLeft: 0,
    accessed: [],
    accessing: null,
    noActivate: !!opts.noActivate,
    extraAccess: opts.extraAccess ?? 0,
    bypass: opts.bypass ?? 0,
    iceMinus: 0,
    bpCredits: s.corp.badPublicity,
    instead: opts.instead?.length ? opts.instead : null,
    source: opts.source ?? null,
  };
  emit(s, 'run', 'ghost', `The Ghost runs on ${nodeName(node)}.`);
  if (s.run.bpCredits) emit(s, 'badPublicity', 'ghost', `Bad publicity: the Ghost has ${s.run.bpCredits} extra credit${s.run.bpCredits === 1 ? '' : 's'} for this run.`);
  corpRunWindow(s, 'initiation');
}

/** Open one of the Corp's run windows, or skip it when the Corp has nothing it could do there. */
function corpRunWindow(s: GameState, step: 'initiation' | 'approach' | 'moveIn' | 'approachNode') {
  s.run!.step = step;
  if (!corpRunOptions(s).length) closeCorpWindow(s);
}

/** The Corp is done with its window: the run moves on. */
function closeCorpWindow(s: GameState) {
  const run = s.run!;
  switch (run.step) {
    case 'initiation':
      return run.pos >= 0 ? approachIce(s) : movement(s);
    case 'moveIn':
      return approachIce(s);
    case 'approach': {
      const ice = currentIce(s)!;
      if (ice.active) return beginEncounter(s);
      emit(s, 'pass', 'ghost', 'The Ghost passes inactive ICE.');
      return movement(s);
    }
    case 'approachNode':
      return approachNode(s);
  }
}

function approachIce(s: GameState) {
  corpRunWindow(s, 'approach');
}

/** Movement: the Ghost has passed the ICE at its position (or there was none) and may jack out. */
function movement(s: GameState) {
  const run = s.run!;
  run.step = 'passed';
  run.iceMinus = 0;
}

/** The Ghost goes on: to the next ICE inward, or to the Corp's last window before the node. */
function moveInward(s: GameState) {
  const run = s.run!;
  run.pos--;
  if (run.pos >= 0) return corpRunWindow(s, 'moveIn');
  emit(s, 'approachNode', 'ghost', `The Ghost reaches ${nodeName(run.node)}.`);
  corpRunWindow(s, 'approachNode');
}

/** The Ghost approaches the node: active upgrades there trigger, then the run succeeds. */
function approachNode(s: GameState) {
  const run = s.run!;
  for (const u of [...nodeOf(s, run.node).upgrades]) {
    if (!u.active) continue;
    if (runEffects(s, cardOf(u.card).onApproachNode, { owner: 'corp', source: nameOf(u.card), node: run.node }) !== 'ok') return;
  }
  beginAccess(s);
}

function beginEncounter(s: GameState) {
  const run = s.run!;
  run.step = 'encounter';
  run.boost = {};
  run.broken = [];
  run.iceMinus = 0;
  const ice = currentIce(s)!;
  const d = cardOf(ice.card);
  if (run.bypass > 0) {
    run.bypass--;
    emit(s, 'bypass', 'ghost', `The Ghost bypasses ${d.name}.`);
    return movement(s);
  }
  const str = iceStrength(s, ice.card);
  emit(s, 'encounter', 'ghost', `The Ghost encounters ${d.name} (${d.subtype}, strength ${str}${str !== d.strength ? `, boosted from ${d.strength}` : ''}).`);
}

function endRun(s: GameState, success: boolean, why = '') {
  if (s.phase === 'gameOver') return;
  s.run = null;
  s.phase = 'action';
  if (!success) emit(s, 'runEnd', 'ghost', `The run ends${why ? `: ${why}` : '.'}`);
}

function resolveSubs(s: GameState) {
  const run = s.run!;
  const ice = currentIce(s)!;
  const d = cardOf(ice.card);
  while (run.subQueue.length) {
    const f = runEffect(s, d.subs![run.subQueue.shift()!], { owner: 'corp', source: d.name });
    if (f === 'stop') return;
    if (f === 'pause') {
      if (s.trace) s.trace.then = 'subs';
      else run.step = 'corpTrash';
      return;
    }
  }
  emit(s, 'passed', 'ghost', `The Ghost gets past ${d.name}.`);
  movement(s);
}

/** The run succeeds: success triggers, then the Ghost breaches the node and accesses cards one at a time. */
function beginAccess(s: GameState) {
  const run = s.run!;
  const c = s.corp;
  const first = !s.flags.successfulRun;
  s.flags.successfulRun = true;
  emit(s, 'success', 'ghost', `The run on ${nodeName(run.node)} succeeds.`);
  if (first) for (const card of ghostSources(s)) runEffects(s, cardOf(card).onFirstSuccessfulRun, { owner: 'ghost', source: nameOf(card) });
  // virus programs grow on successful runs
  for (const card of s.ghost.programs) {
    const on = cardOf(card).virusOn;
    if (!on) continue;
    const central = run.node === 'command' || run.node === 'mainframe' || run.node === 'dump';
    if (on === 'any' || on === run.node || (on === 'central' && central)) {
      s.ghost.virus[card] = (s.ghost.virus[card] ?? 0) + 1;
      emit(s, 'virus', 'ghost', `${nameOf(card)} gains a virus counter (now ${s.ghost.virus[card]}).`);
    }
  }
  if (run.instead) {
    runEffects(s, run.instead, { owner: 'ghost', source: run.source ?? 'The run' });
    return endRun(s, true);
  }
  const node = nodeOf(s, run.node);
  run.candidates = [...(node.root ? [node.root.card] : []), ...node.upgrades.map((u) => u.card)];
  if (run.node === 'command') run.zoneLeft = 1 + run.extraAccess;
  else if (run.node === 'mainframe') {
    const viral = s.ghost.programs.reduce((k, p) => k + (cardOf(p).virusAccess ? Math.floor((s.ghost.virus[p] ?? 0) / cardOf(p).virusAccess!) : 0), 0);
    run.zoneLeft = 1 + run.extraAccess + rigSum(s, (d) => d.mainframeAccess) + viral;
  } else if (run.node === 'dump') {
    // every card in the Dump turns faceup and is accessed. Cards there that are not projects
    // cannot be trashed or stolen and nothing reacts to them, so they are accessed at once.
    c.discardSeen = [...c.discard];
    const rest = c.discard.filter((x) => cardOf(x).type !== 'project');
    run.accessed.push(...rest);
    run.candidates.push(...c.discard.filter((x) => cardOf(x).type === 'project'));
    emit(s, 'access', 'ghost', `The Ghost breaches the Dump: ${plural(c.discard.length, 'card')} turn faceup.`);
  }
  if (!run.candidates.length && !zoneCard(s)) emit(s, 'access', 'ghost', 'There is nothing to access there.');
  run.step = 'access';
  nextAccess(s);
}

/** The next card the Ghost would access from Command (at random) or the Mainframe (from the top), if any are left. */
function zoneCard(s: GameState, pickRandom = false): CardId | null {
  const run = s.run!;
  if (run.zoneLeft <= 0) return null;
  if (run.node === 'command') {
    const pool = s.corp.hand.filter((x) => !run.accessed.includes(x));
    if (!pool.length) return null;
    return pickRandom ? pool[randInt(s, pool.length)] : pool[0];
  }
  if (run.node === 'mainframe') {
    for (let i = s.corp.deck.length - 1; i >= 0; i--) if (!run.accessed.includes(s.corp.deck[i])) return s.corp.deck[i];
  }
  return null;
}

/** Between accesses: the run ends when nothing is left; a single choice is taken at once. */
function nextAccess(s: GameState) {
  const run = s.run!;
  run.accessing = null;
  const options = run.candidates.length + (zoneCard(s) ? 1 : 0);
  if (!options) return endRun(s, true);
  if (options === 1) return run.candidates.length ? accessCard(s, run.candidates[0]) : accessCard(s, zoneCard(s, true)!, true);
}

function accessCard(s: GameState, card: CardId, fromZone = false) {
  const run = s.run!;
  run.candidates = run.candidates.filter((x) => x !== card);
  if (fromZone) run.zoneLeft--;
  run.accessed.push(card);
  run.accessing = card;
  const d = cardOf(card);
  const inst = findInstalled(s, card);
  emit(s, 'access', 'ghost', inst?.inst.active || s.corp.discard.includes(card) ? `The Ghost accesses ${d.name}.` : 'The Ghost accesses a card.', { side: 'ghost', text: `You access ${d.name}.` });
  if (inst && d.onAccess?.length) {
    if (d.trap) {
      emit(s, 'trap', 'corp', `It is a trap: ${d.name}!`);
      inst.inst.active = true;
    }
    runEffects(s, d.onAccess, { owner: 'corp', source: d.name, dev: inst.inst.dev });
  }
}

// ---------------------------------------------------------------------------
// Playing and installing cards
// ---------------------------------------------------------------------------

function playCard(s: GameState, a: Extract<Action, { type: 'play' }>) {
  const side = cardOf(a.card).side;
  const p = s[side];
  const d = cardOf(a.card);
  p.cycles--;
  pay(s, side, d.cost ?? 0, 'play');
  p.hand = p.hand.filter((x) => x !== a.card);
  if (d.removeAfterPlay) {
    if (side === 'corp') s.corp.removed.push(a.card);
    else s.ghost.discard.push(a.card);
  } else {
    p.discard.push(a.card);
    if (side === 'corp') s.corp.discardSeen.push(a.card);
  }
  emit(s, 'play', side, `${label(side)} plays ${d.name}.`);
  runEffects(s, d.onPlay, { owner: side, source: d.name, target: a.target, node: a.node });
}

function corpInstall(s: GameState, a: Extract<Action, { type: 'install' }>) {
  const c = s.corp;
  const d = cardOf(a.card);
  let node = a.node === 'new' ? null : nodeOf(s, a.node!);
  if (!node) {
    node = { id: `site${++c.siteCount}`, ice: [], root: null, upgrades: [] };
    c.nodes.push(node);
  }
  c.cycles--;
  c.hand = c.hand.filter((x) => x !== a.card);
  const where = nodeName(node.id);
  if (d.type === 'ice') {
    pay(s, 'corp', node.ice.length, 'install');
    node.ice.push({ card: a.card, active: false, dev: 0 });
    emit(s, 'install', 'corp', `The Corp installs ICE protecting ${where}.`, { side: 'corp', text: `You install ${d.name} protecting ${where}.` });
  } else if (d.type === 'upgrade') {
    node.upgrades.push({ card: a.card, active: false, dev: 0 });
    emit(s, 'install', 'corp', `The Corp installs a card in ${where}.`, { side: 'corp', text: `You install ${d.name} (upgrade) in ${where}.` });
  } else {
    if (node.root) {
      const old = node.root;
      delete c.recurring[old.card];
      c.discard.push(old.card);
      if (old.active) c.discardSeen.push(old.card);
      s.ghost.known = s.ghost.known.filter((x) => x !== old.card);
      emit(s, 'trash', 'corp', `The Corp trashes the card already in ${where}.`);
    }
    node.root = { card: a.card, active: false, dev: 0 };
    emit(s, 'install', 'corp', `The Corp installs a card in ${where}.`, { side: 'corp', text: `You install ${d.name} in ${where}.` });
  }
}

function ghostInstall(s: GameState, a: Extract<Action, { type: 'install' }>) {
  const g = s.ghost;
  const d = cardOf(a.card);
  g.cycles--;
  pay(s, 'ghost', d.cost ?? 0, 'install');
  g.hand = g.hand.filter((x) => x !== a.card);
  (d.type === 'program' ? g.programs : d.type === 'gear' ? g.gear : g.contacts).push(a.card);
  if (d.recurring) g.recurring[a.card] = d.recurring.n;
  if (a.host) {
    g.hosted[a.card] = a.host;
    emit(s, 'install', 'ghost', `The Ghost installs ${d.name} on ${nameOf(a.host)}.`);
  } else emit(s, 'install', 'ghost', `The Ghost installs ${d.name}.`);
}

function useAbility(s: GameState, card: CardId) {
  const g = s.ghost;
  const d = cardOf(card);
  const ab = d.ability!;
  g.cycles -= ab.cycles;
  pay(s, 'ghost', ab.credits ?? 0, 'other');
  if (ab.trashSelf) trashGhostCard(s, card);
  emit(s, 'use', 'ghost', `The Ghost ${ab.trashSelf ? 'trashes' : 'uses'} ${d.name}.`);
  runEffects(s, ab.effects, { owner: 'ghost', source: d.name });
}

function activate(s: GameState, card: CardId) {
  const t = findInstalled(s, card)!;
  const d = cardOf(card);
  pay(s, 'corp', d.cost ?? 0, t.isIce ? 'activateIce' : 'activate');
  t.inst.active = true;
  if (d.recurring) s.corp.recurring[card] = d.recurring.n;
  emit(s, 'activate', 'corp', `The Corp activates ${d.name} (${t.isIce ? 'protecting' : 'in'} ${nodeName(t.node.id)}) for ${d.cost ?? 0}.`);
  const run = s.run;
  if (!run) return;
  if (!t.isIce && runEffects(s, d.onActivateInRun, { owner: 'corp', source: d.name, node: run.node }) !== 'ok') return;
  // the window stays open while the Corp has more it could do
  if (s.run && ['initiation', 'approach', 'moveIn', 'approachNode'].includes(s.run.step) && !corpRunOptions(s).length) closeCorpWindow(s);
}

function score(s: GameState, card: CardId) {
  const c = s.corp;
  const d = cardOf(card);
  const inst: Installed | undefined = findInstalled(s, card)?.inst;
  removeCorpCard(s, card);
  c.scored.push(card);
  emit(s, 'score', 'corp', `The Corp scores ${d.name} for ${plural(d.points ?? 0, 'point')} (${points(s, 'corp')} total).`);
  runEffects(s, d.onScore, { owner: 'corp', source: d.name, dev: inst?.dev });
  runEffects(s, cardOf(c.identity).onCorpScore, { owner: 'corp', source: nameOf(c.identity) });
  checkPoints(s, 'corp');
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

function step(s: GameState, a: Action) {
  const side = actor(s)!;
  const p = s[side];
  switch (a.type) {
    case 'keep':
    case 'mulligan':
      if (a.type === 'mulligan') {
        p.deck.push(...p.hand.splice(0));
        shuffle(s, p.deck);
        p.hand = p.deck.splice(-5);
        emit(s, 'mulligan', side, `${label(side)} takes a mulligan.`);
      } else emit(s, 'keep', side, `${label(side)} keeps their hand.`);
      if (side === 'corp') s.mulligan = 'ghost';
      else {
        s.mulligan = null;
        startTurn(s, 'corp');
      }
      return;
    case 'credit':
      p.cycles--;
      p.credits++;
      emit(s, 'credit', side, `${label(side)} takes 1 credit.`);
      return;
    case 'draw':
      p.cycles--;
      drawCards(s, side, 1);
      return;
    case 'install':
      return side === 'corp' ? corpInstall(s, a) : ghostInstall(s, a);
    case 'play':
      return playCard(s, a);
    case 'develop': {
      const t = findInstalled(s, a.card)!;
      s.corp.cycles--;
      pay(s, 'corp', 1, 'develop');
      t.inst.dev++;
      emit(s, 'develop', 'corp', `The Corp develops the card in ${nodeName(t.node.id)} (${t.inst.dev} counter${t.inst.dev === 1 ? '' : 's'}).`);
      return;
    }
    case 'score':
      return score(s, a.card);
    case 'activate':
      return activate(s, a.card);
    case 'decline':
      return closeCorpWindow(s);
    case 'trashContact':
      s.corp.cycles--;
      pay(s, 'corp', 2, 'other');
      trashGhostCard(s, a.card);
      emit(s, 'trash', 'corp', `The Corp follows the heat and trashes ${nameOf(a.card)}.`);
      return;
    case 'run':
      s.ghost.cycles--;
      return startRun(s, a.node);
    case 'shedHeat':
      s.ghost.cycles--;
      pay(s, 'ghost', 2, 'other');
      s.ghost.heat--;
      emit(s, 'heat', 'ghost', `The Ghost lies low and sheds 1 heat (now ${s.ghost.heat}).`);
      return;
    case 'use':
      return useAbility(s, a.card);
    case 'scrap':
      trashGhostCard(s, a.card);
      emit(s, 'trash', 'ghost', `The Ghost scraps ${nameOf(a.card)}.`);
      return;
    case 'boost': {
      const b = cardOf(a.card).breaker!;
      pay(s, 'ghost', b.boostCost, 'boost');
      s.run!.boost[a.card] = (s.run!.boost[a.card] ?? 0) + b.boostBy;
      emit(s, 'boost', 'ghost', `The Ghost pays ${b.boostCost} to boost ${nameOf(a.card)} to strength ${b.strength + s.run!.boost[a.card]}.`);
      return;
    }
    case 'break': {
      const b = cardOf(a.card).breaker!;
      pay(s, 'ghost', b.breakCost, 'break');
      s.run!.broken.push(a.sub);
      emit(s, 'break', 'ghost', `The Ghost pays ${b.breakCost}: ${nameOf(a.card)} breaks subroutine ${a.sub + 1} of ${nameOf(currentIce(s)!.card)}.`);
      return;
    }
    case 'proceed': {
      const run = s.run!;
      const d = cardOf(currentIce(s)!.card);
      run.subQueue = d.subs!.map((_, i) => i).filter((i) => !run.broken.includes(i));
      return resolveSubs(s);
    }
    case 'chooseTrash':
      trashProgram(s, a.card);
      return resolveSubs(s);
    case 'continue':
      return moveInward(s);
    case 'jackOut':
      return endRun(s, false, 'the Ghost jacks out.');
    case 'access': {
      const run = s.run!;
      return a.zone ? accessCard(s, zoneCard(s, true)!, true) : accessCard(s, run.candidates[a.i!]);
    }
    case 'steal': {
      const card = s.run!.accessing!;
      const d = cardOf(card);
      pay(s, 'ghost', d.stealCost ?? 0, 'steal');
      removeCorpCard(s, card);
      s.ghost.scored.push(card);
      emit(s, 'steal', 'ghost', `The Ghost steals ${d.name} for ${d.points} point${d.points === 1 ? '' : 's'} (${points(s, 'ghost')} total).`);
      checkPoints(s, 'ghost');
      if ((s.phase as string) === 'gameOver') return;
      if (runEffects(s, cardOf(s.corp.identity).onSteal, { owner: 'corp', source: nameOf(s.corp.identity) }) !== 'ok') return;
      if (s.phase !== 'gameOver') nextAccess(s);
      return;
    }
    case 'trash': {
      const card = s.run!.accessing!;
      const d = cardOf(card);
      pay(s, 'ghost', d.trash ?? 0, 'trashAccess');
      removeCorpCard(s, card);
      s.corp.discard.push(card);
      s.corp.discardSeen.push(card);
      emit(s, 'trash', 'ghost', `The Ghost pays ${d.trash ?? 0} to trash ${d.name}.`);
      return nextAccess(s);
    }
    case 'leave': {
      const card = s.run!.accessing!;
      const inst = findInstalled(s, card);
      if (inst && !inst.inst.active && !s.ghost.known.includes(card)) s.ghost.known.push(card);
      return nextAccess(s);
    }
    case 'discard':
      p.hand = p.hand.filter((c) => c !== a.card);
      p.discard.push(a.card);
      emit(s, 'discard', side, `${label(side)} discards a card.`, { side, text: `You discard ${nameOf(a.card)}.` });
      if (p.hand.length <= maxHand(s, side)) passTurn(s);
      return;
    case 'traceBoost': {
      const t = s.trace!;
      if (t.corpBoost === null) {
        pay(s, 'corp', a.n, 'trace');
        t.corpBoost = a.n;
        emit(s, 'trace', 'corp', `The Corp pays ${a.n} to raise the trace to ${t.base + a.n}.`);
        return;
      }
      pay(s, 'ghost', a.n, 'trace');
      if (a.n) emit(s, 'trace', 'ghost', `The Ghost pays ${a.n} to raise their link to ${link(s) + a.n}.`);
      return finishTrace(s, a.n);
    }
    case 'spendVirus':
      s.ghost.virus[a.card]--;
      s.run!.iceMinus++;
      emit(s, 'virus', 'ghost', `${nameOf(a.card)} eats into ${nameOf(currentIce(s)!.card)}: strength ${iceStrength(s, currentIce(s)!.card)} for this encounter.`);
      return;
    case 'purge': {
      s.corp.cycles = 0;
      const total = Object.values(s.ghost.virus).reduce((x, y) => x + y, 0);
      s.ghost.virus = {};
      emit(s, 'purge', 'corp', `The Corp spends its whole turn purging viruses${total ? `: ${total} virus counter${total === 1 ? '' : 's'} removed` : ''}.`);
      return;
    }
    case 'endTurn':
      return endTurn(s);
  }
}

export function apply(state: GameState, action: Action): Result {
  ensureCards(state);
  if (state.phase === 'gameOver') return { ok: false, error: 'The game is over.' };
  if (!isLegal(state, action)) return { ok: false, error: explain(state, action) };
  const s = cloneState(state);
  step(s, action);
  return { ok: true, state: s };
}

/** Why an action is not legal right now, in plain words. */
export function explain(s: GameState, a: Action): string {
  const side = actor(s);
  if (!side) return 'The game is over.';
  const p = s[side];
  if (s.phase === 'action' && p.cycles <= 0 && !['endTurn', 'score', 'activate', 'use', 'scrap'].includes(a.type)) return 'You have no cycles left this turn.';
  if ('card' in a && a.card && !a.card.startsWith('?')) {
    const d = cardOf(a.card);
    if ((a.type === 'install' || a.type === 'play' || a.type === 'activate') && p.credits < (d.cost ?? 0)) return `${d.name} costs ${d.cost} and you have ${p.credits}.`;
    if (a.type === 'install' && d.type === 'program') return `Not enough free RAM for ${d.name}.`;
    if (a.type === 'play' && !conditionHolds(s, d.playIf))
      return d.playIf === 'ghostHasHeat' ? `${d.name} needs the Ghost to have heat.` : `${d.name} needs a successful Ghost run last turn.`;
    if (a.type === 'score') return `${d.name} needs ${d.dev} development counters.`;
    if (a.type === 'break') return 'That breaker is too weak or cannot break this ICE.';
  }
  if (a.type === 'endTurn') return 'Spend all your cycles before ending the turn.';
  return 'That is not a legal move right now.';
}
