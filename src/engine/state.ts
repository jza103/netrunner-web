// Game setup and read-only helpers shared by the rules, the bots and the UI.
import { cardOf, deckList, is } from './cards';
import { seedFrom, shuffle } from './rng';
import { BASE_RAM, HAND_SIZE, type CardId, type GameState, type Installed, type NodeId, type NodeState, type Side } from './types';

export interface NewGameOptions {
  seed: number | string;
  human: Side;
}

export function newGame(opts: NewGameOptions): GameState {
  const s: GameState = {
    rngState: seedFrom(opts.seed),
    human: opts.human,
    turn: 'corp',
    turnNumber: 0,
    phase: 'mulligan',
    mulligan: 'corp',
    corp: {
      credits: 5,
      cycles: 0,
      hand: [],
      deck: deckList('corp'),
      discard: [],
      discardSeen: [],
      scored: [],
      removed: [],
      nodes: [
        { id: 'command', ice: [], root: null },
        { id: 'mainframe', ice: [], root: null },
        { id: 'dump', ice: [], root: null },
      ],
      siteCount: 0,
    },
    ghost: { credits: 5, cycles: 0, hand: [], deck: deckList('ghost'), discard: [], scored: [], programs: [], gear: [], contacts: [], heat: 0, known: [] },
    run: null,
    flags: { successfulRun: false, skimmed: false, prevented: 0 },
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
  if (s.phase === 'run' && s.run) return s.run.step === 'approach' || s.run.step === 'corpTrash' ? 'corp' : 'ghost';
  return s.turn;
}

export function points(s: GameState, side: Side): number {
  return s[side].scored.reduce((n, c) => n + (cardOf(c).points ?? 0), 0);
}

export function count(list: CardId[], def: string): number {
  return list.filter((c) => is(c, def)).length;
}

export function ramLimit(s: GameState): number {
  return BASE_RAM + 2 * count(s.ghost.gear, 'ram-brick');
}

export function ramUsed(s: GameState): number {
  return s.ghost.programs.reduce((n, c) => n + (cardOf(c).ram ?? 1), 0);
}

export function maxHand(s: GameState, side: Side): number {
  return side === 'ghost' ? HAND_SIZE + count(s.ghost.gear, 'padded-rig') : HAND_SIZE;
}

/** The installed Corp card with this id, and where it is. */
export function findInstalled(s: GameState, card: CardId): { node: NodeState; inst: Installed; isIce: boolean } | null {
  for (const node of s.corp.nodes) {
    if (node.root?.card === card) return { node, inst: node.root, isIce: false };
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
