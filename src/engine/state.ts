// Game setup and read-only helpers shared by the rules, the bots and the UI.
import { cardOf, defaultSetup, deckList, ensureCards, is } from './cards';
import { seedFrom, shuffle } from './rng';
import { BASE_RAM, HAND_SIZE, type CardId, type GameSetup, type GameState, type Installed, type NodeId, type NodeState, type Side } from './types';

export interface NewGameOptions {
  seed: number | string;
  human: Side;
  /** which cards to play with; defaults to the built-in set */
  setup?: GameSetup;
}

export function newGame(opts: NewGameOptions): GameState {
  const setup = opts.setup ?? defaultSetup();
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
    corp: {
      credits: 5,
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
    ghost: { credits: 5, cycles: 0, hand: [], deck: deckList('ghost', setup), discard: [], scored: [], programs: [], gear: [], contacts: [], heat: 0, core: 0, known: [] },
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

/** Sum of a numeric field over the Ghost's installed cards. */
export function rigSum(s: GameState, f: (c: ReturnType<typeof cardOf>) => number | undefined): number {
  return rigOf(s).reduce((n, c) => n + (f(cardOf(c)) ?? 0), 0);
}

export function ramLimit(s: GameState): number {
  return BASE_RAM + rigSum(s, (d) => d.ramBonus);
}

export function ramUsed(s: GameState): number {
  return s.ghost.programs.reduce((n, c) => n + (cardOf(c).ram ?? 1), 0);
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
  return base + where.node.upgrades.reduce((n, u) => n + (u.active ? (cardOf(u.card).iceStrength ?? 0) : 0), 0);
}

export function breakerStrength(s: GameState, card: CardId): number {
  return (cardOf(card).breaker?.strength ?? 0) + (s.run?.boost[card] ?? 0);
}

export function canBreak(card: CardId, ice: CardId): boolean {
  const b = cardOf(card).breaker;
  return !!b && (b.breaks === 'any' || b.breaks === cardOf(ice).subtype);
}

export function canDevelop(card: CardId): boolean {
  const d = cardOf(card);
  return d.type === 'project' || !!d.developable;
}
