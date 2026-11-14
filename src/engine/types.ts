// Shared types for the Breachline engine. Everything here is plain JSON so a game can be saved and resumed.

export type Side = 'corp' | 'ghost';
export type CardId = string; // "<defId>#<n>", or "?…" for a card hidden from the viewer
export type NodeId = string; // 'command' | 'mainframe' | 'dump' | 'site<n>'

export type IceType = 'wall' | 'cipher' | 'hunter';
export type CardType = 'project' | 'ice' | 'asset' | 'directive' | 'program' | 'gear' | 'contact' | 'stunt' | 'hidden';

export type SubOp =
  | { op: 'endRun' }
  | { op: 'damage'; n: number }
  | { op: 'loseCredits'; n: number }
  | { op: 'corpGain'; n: number }
  | { op: 'heat'; n: number }
  | { op: 'loseCycle'; n: number }
  | { op: 'trashProgram' };

export interface Breaker {
  breaks: IceType | 'any';
  strength: number;
  boostCost: number;
  boostBy: number;
  breakCost: number;
}

export interface CardDef {
  id: string;
  name: string;
  side: Side;
  type: CardType;
  copies: number;
  text: string;
  cost?: number;
  // project
  dev?: number;
  points?: number;
  stealCost?: number;
  // ice
  subtype?: IceType;
  strength?: number;
  subs?: SubOp[];
  // asset
  trash?: number;
  developable?: boolean;
  trap?: boolean;
  // program
  ram?: number;
  breaker?: Breaker;
}

/** A Corp card on the table. */
export interface Installed {
  card: CardId;
  active: boolean;
  dev: number;
}

export interface NodeState {
  id: NodeId;
  /** index 0 is innermost; the last entry is the outermost ICE */
  ice: Installed[];
  /** sites only: the one project or asset installed here */
  root: Installed | null;
}

export interface CorpState {
  credits: number;
  cycles: number;
  hand: CardId[];
  /** the Mainframe; the last entry is the top card */
  deck: CardId[];
  /** the Dump */
  discard: CardId[];
  /** cards in the Dump the Ghost has seen (faceup) */
  discardSeen: CardId[];
  scored: CardId[];
  removed: CardId[];
  nodes: NodeState[];
  siteCount: number;
}

export interface GhostState {
  credits: number;
  cycles: number;
  hand: CardId[];
  deck: CardId[];
  /** the Scrapheap */
  discard: CardId[];
  scored: CardId[];
  programs: CardId[];
  gear: CardId[];
  contacts: CardId[];
  heat: number;
  /** facedown Corp cards the Ghost has looked at */
  known: CardId[];
}

export type RunStep = 'approach' | 'encounter' | 'passed' | 'corpTrash' | 'access';

export interface RunState {
  node: NodeId;
  /** index into node.ice of the ICE being approached or encountered */
  pos: number;
  step: RunStep;
  /** temporary strength per breaker for this encounter */
  boost: Record<CardId, number>;
  broken: number[];
  /** unbroken subroutines still to fire */
  subQueue: number[];
  accessQueue: CardId[];
  accessing: CardId | null;
  noActivate: boolean;
  extraAccess: number;
  heist: boolean;
}

export type Phase = 'mulligan' | 'action' | 'discard' | 'run' | 'gameOver';

export interface GameEvent {
  seq: number;
  type: string;
  /** what everyone sees */
  text: string;
  side?: Side;
  /** a fuller version only one side may read (it can name hidden cards) */
  priv?: { side: Side; text: string };
}

export interface GameState {
  rngState: number;
  human: Side;
  /** identifies this game (from the seed); used to key saved Operator memory */
  gameId: string;
  turn: Side;
  turnNumber: number;
  phase: Phase;
  /** who still has to decide on their opening hand */
  mulligan: Side | null;
  corp: CorpState;
  ghost: GhostState;
  run: RunState | null;
  /** this turn */
  flags: { successfulRun: boolean; skimmed: boolean; prevented: number };
  ghostSuccessLastTurn: boolean;
  winner: Side | null;
  winReason: string;
  events: GameEvent[];
  seq: number;
}

export type Action =
  | { type: 'keep' }
  | { type: 'mulligan' }
  | { type: 'credit' }
  | { type: 'draw' }
  | { type: 'install'; card: CardId; node?: NodeId | 'new' }
  | { type: 'play'; card: CardId; node?: NodeId; target?: CardId }
  | { type: 'develop'; card: CardId }
  | { type: 'score'; card: CardId }
  | { type: 'activate'; card: CardId }
  | { type: 'decline' }
  | { type: 'trashContact'; card: CardId }
  | { type: 'run'; node: NodeId }
  | { type: 'shedHeat' }
  | { type: 'use'; card: CardId }
  | { type: 'scrap'; card: CardId }
  | { type: 'boost'; card: CardId }
  | { type: 'break'; card: CardId; sub: number }
  | { type: 'proceed' }
  | { type: 'continue' }
  | { type: 'jackOut' }
  | { type: 'steal' }
  | { type: 'trash' }
  | { type: 'leave' }
  | { type: 'chooseTrash'; card: CardId }
  | { type: 'discard'; card: CardId }
  | { type: 'endTurn' };

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

export const POINTS_TO_WIN = 7;
export const HAND_SIZE = 5;
export const BASE_RAM = 4;
export const CYCLES: Record<Side, number> = { corp: 3, ghost: 4 };
export const MAX_SITES = 6;
export const MAX_ICE = 5;
