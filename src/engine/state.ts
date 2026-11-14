// Game setup and read-only helpers shared by the rules, the bots and the UI.
import { cardOf, defaultSetup, deckList, ensureCards, is } from './cards';
import type { Purpose, RecurringUse } from './types';
import { seedFrom, shuffle } from './rng';
import { BASE_RAM, HAND_SIZE, type CardId, type GameSetup, type GameState, type Installed, type NodeId, type NodeState, type Side } from './types';

export interface NewGameOptions {
  seed: number | string;
  human: Side;
  /** which cards to play with; defaults to the built-in set */
  setup?: GameSetup;
  /** identity choices, overriding the setup's */
  identities?: Partial<Record<Side, string>>;
}

export function newGame(opts: NewGameOptions): GameState {
  const base = opts.setup ?? defaultSetup();
  const setup: GameSetup = { ...base, identities: { ...base.identities, ...opts.identities } };
  ensureCards({ setup });
  const s: GameState = {
    rngState: seedFrom(opts.seed),
    human: opts.human,
    gameId: String(opts.seed),
    setup,
    turn: 'corp',
    turnNumber: 0,
    phase: 'mulligan',
    mulligan: 'corp',
    trace: null,
    corp: {
      identity: `${setup.identities.corp}#1`,
      credits: 5,
      badPublicity: 0,
      recurring: {},
      cycles: 0,
      hand: [],
      deck: deckList('corp', setup),
      discard: [],
      discardSeen: [],
      scored: [],
      removed: [],
      nodes: [
        { id: 'command', ice: [], root: null, upgrades: [] },
        { id: 'mainframe', ice: [], root: null, upgrades: [] },
        { id: 'dump', ice: [], root: null, upgrades: [] },
      ],
      siteCount: 0,
    },
    ghost: { identity: `${setup.identities.ghost}#1`, recurring: {}, virus: {}, hosted: {}, credits: 5, cycles: 0, hand: [], deck: deckList('ghost', setup), discard: [], scored: [], programs: [], gear: [], contacts: [], heat: 0, core: 0, known: [] },
    run: null,
    flags: { successfulRun: false, prevented: { net: 0, meat: 0, core: 0 } },
    ghostSuccessLastTurn: false,
    winner: null,
    winReason: '',
    events: [],
    seq: 0,
  };
  for (const side of ['corp', 'ghost'] as const) {
    shuffle(s, s[side].deck);
    s[side].hand = s[side].deck.splice(-HAND_SIZE);
  }
  s.events.push({ seq: ++s.seq, type: 'start', text: 'A new game begins. Both sides look at their opening hands.' });
  return s;
}

export const CENTRAL: NodeId[] = ['command', 'mainframe', 'dump'];

export function isSite(id: NodeId): boolean {
  return id.startsWith('site');
}

export function nodeName(id: NodeId): string {
  if (id === 'command') return 'Command';
  if (id === 'mainframe') return 'the Mainframe';
  if (id === 'dump') return 'the Dump';
  return `Site ${id.slice(4)}`;
}

export function nodeOf(s: GameState, id: NodeId): NodeState {
  const n = s.corp.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`No node ${id}`);
  return n;
}

/** Who must act now, or null when the game is over. */
export function actor(s: GameState): Side | null {
  if (s.phase === 'gameOver') return null;
  if (s.trace) return s.trace.corpBoost === null ? 'corp' : 'ghost';
  if (s.phase === 'mulligan') return s.mulligan;
  if (s.phase === 'run' && s.run) return s.run.step === 'approach' || s.run.step === 'approachNode' || s.run.step === 'corpTrash' ? 'corp' : 'ghost';
  return s.turn;
}

export function points(s: GameState, side: Side): number {
  return s[side].scored.reduce((n, c) => n + (cardOf(c).points ?? 0), 0);
}

export function count(list: CardId[], def: string): number {
  return list.filter((c) => is(c, def)).length;
}

/** Every installed Ghost card: programs, gear and contacts. */
export function rigOf(s: GameState): CardId[] {
  return [...s.ghost.programs, ...s.ghost.gear, ...s.ghost.contacts];
}

/** The Ghost's identity and installed cards: everything whose abilities are in play. */
export function ghostSources(s: GameState): CardId[] {
  return [s.ghost.identity, ...rigOf(s)];
}

/** Sum of a numeric field over the Ghost's identity and installed cards. */
export function rigSum(s: GameState, f: (c: ReturnType<typeof cardOf>) => number | undefined): number {
  return ghostSources(s).reduce((n, c) => n + (f(cardOf(c)) ?? 0), 0);
}

export function link(s: GameState): number {
  return rigSum(s, (d) => d.link);
}

/** Corp cards whose abilities are in play: the identity and active installed assets and upgrades. */
export function corpSources(s: GameState): CardId[] {
  const out = [s.corp.identity];
  for (const n of s.corp.nodes) for (const i of [...(n.root ? [n.root] : []), ...n.upgrades]) if (i.active) out.push(i.card);
  return out;
}

const RECURRING_FOR: Record<RecurringUse, Purpose[]> = {
  breakers: ['boost', 'break'],
  activateIce: ['activateIce'],
  trace: ['trace'],
  any: ['install', 'play', 'develop', 'activate', 'activateIce', 'boost', 'break', 'steal', 'trashAccess', 'trace', 'other'],
};

/** Recurring credits on these cards that may pay for this purpose. */
export function recurringFor(s: GameState, side: Side, purpose: Purpose): { card: CardId; n: number }[] {
  return Object.entries(s[side].recurring)
    .filter(([c, n]) => n > 0 && !isHiddenId(c) && RECURRING_FOR[cardOf(c).recurring?.for ?? 'any'].includes(purpose))
    .map(([card, n]) => ({ card, n }));
}

function isHiddenId(c: CardId) {
  return c.startsWith('?');
}

/** Everything a side can spend on this purpose now: credits, matching recurring credits, and bad publicity credits during a run. */
export function available(s: GameState, side: Side, purpose: Purpose): number {
  const rec = recurringFor(s, side, purpose).reduce((a, r) => a + r.n, 0);
  const bp = side === 'ghost' && s.run ? s.run.bpCredits : 0;
  return s[side].credits + rec + bp;
}

export function ramLimit(s: GameState): number {
  return BASE_RAM + rigSum(s, (d) => d.ramBonus);
}

export function ramUsed(s: GameState): number {
  return s.ghost.programs.filter((c) => !s.ghost.hosted[c]).reduce((n, c) => n + (cardOf(c).ram ?? 1), 0);
}

/** Gear that can host another program now. */
export function hostsWithRoom(s: GameState): CardId[] {
  return s.ghost.gear.filter((g) => {
    const h = cardOf(g).host;
    return h && Object.values(s.ghost.hosted).filter((x) => x === g).length < h.max;
  });
}

export function maxHand(s: GameState, side: Side): number {
  return side === 'ghost' ? HAND_SIZE + rigSum(s, (d) => d.handBonus) - s.ghost.core : HAND_SIZE;
}

/** The installed Corp card with this id, and where it is. */
export function findInstalled(s: GameState, card: CardId): { node: NodeState; inst: Installed; isIce: boolean } | null {
  for (const node of s.corp.nodes) {
    if (node.root?.card === card) return { node, inst: node.root, isIce: false };
    const up = node.upgrades.find((i) => i.card === card);
    if (up) return { node, inst: up, isIce: false };
    const inst = node.ice.find((i) => i.card === card);
    if (inst) return { node, inst, isIce: true };
  }
  return null;
}

/** The ICE the current run is approaching or encountering. */
export function currentIce(s: GameState): Installed | null {
  if (!s.run || s.run.pos < 0) return null;
  return nodeOf(s, s.run.node).ice[s.run.pos] ?? null;
}

/** Strength of an installed ICE, with active upgrades in its node. */
export function iceStrength(s: GameState, card: CardId): number {
  const base = cardOf(card).strength ?? 0;
  const where = findInstalled(s, card);
  if (!where) return base;
  const minus = s.run && currentIce(s)?.card === card ? s.run.iceMinus : 0;
  return Math.max(0, base + where.node.upgrades.reduce((n, u) => n + (u.active ? (cardOf(u.card).iceStrength ?? 0) : 0), 0) - minus);
}

export function breakerStrength(s: GameState, card: CardId): number {
  const host = s.ghost.hosted[card];
  const hosted = host ? (cardOf(host).host?.breakerStrength ?? 0) : 0;
  return (cardOf(card).breaker?.strength ?? 0) + hosted + (s.run?.boost[card] ?? 0);
}

export function canBreak(card: CardId, ice: CardId): boolean {
  const b = cardOf(card).breaker;
  return !!b && (b.breaks === 'any' || b.breaks === cardOf(ice).subtype);
}

export function canDevelop(card: CardId): boolean {
  const d = cardOf(card);
  return d.type === 'project' || !!d.developable;
}
