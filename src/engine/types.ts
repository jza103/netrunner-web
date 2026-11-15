// Shared types for the Breachline engine. Everything here is plain JSON so a game can be saved and resumed.

export type Side = 'corp' | 'ghost';
export type CardId = string; // "<defId>#<n>", or "?…" for a card hidden from the viewer
export type NodeId = string; // 'command' | 'mainframe' | 'dump' | 'site<n>'

export type IceType = 'wall' | 'cipher' | 'hunter';
export type CardType = 'project' | 'ice' | 'asset' | 'upgrade' | 'directive' | 'program' | 'gear' | 'contact' | 'stunt' | 'identity' | 'hidden';
export type DamageKind = 'net' | 'meat' | 'core';
export const DAMAGE_KINDS: DamageKind[] = ['net', 'meat', 'core'];

/**
 * One step of a card effect. Every card's behaviour is data built from these, for the built-in
 * set and for custom card packs alike. `who` defaults to the side that owns the card.
 */
export type Effect =
  | { op: 'gain'; n: number; who?: Side }
  | { op: 'draw'; n: number; who?: Side }
  /** damage to the Ghost: n, plus perHeat for each heat the Ghost has, plus perDev for each counter on this card */
  | { op: 'damage'; kind: DamageKind; n: number; perHeat?: number; perDev?: number }
  | { op: 'heat'; n: number }
  | { op: 'shedHeat'; n: number }
  /** the Ghost loses n credits (plus perHeat each), as many as they have */
  | { op: 'loseCredits'; n: number; perHeat?: number }
  /** the Corp loses up to n credits and the Ghost gains that many */
  | { op: 'drain'; n: number }
  | { op: 'loseCycle'; n: number }
  /** during a run: the Corp trashes 1 installed program of its choice */
  | { op: 'trashProgram' }
  /** during a run: end the run */
  | { op: 'endRun' }
  /** during a run: the Ghost loses n credits; if they have fewer, the run ends instead */
  | { op: 'payOrEndRun'; n: number }
  /** targets an installed Corp card that can be developed */
  | { op: 'develop'; n: number }
  /** shuffle the Dump into the Mainframe */
  | { op: 'recycleDump' }
  /** the Ghost makes a run; `instead` replaces accessing cards when it succeeds; `bypass`: the first N ICE encountered are bypassed */
  | { op: 'run'; node: 'command' | 'mainframe' | 'dump' | 'any'; extraAccess?: number; noActivate?: boolean; bypass?: number; instead?: Effect[]; ifSuccessful?: Effect[] }
  /** trace n: the Corp may pay to raise n, then the Ghost may pay to raise their link; if the trace ends higher, `success` resolves */
  | { op: 'trace'; n: number; success: Effect[] }
  | { op: 'badPublicity'; n: number }
  | { op: 'clearBadPublicity'; n: number }
  /** targets a node: the Ghost looks at every facedown card in or protecting it */
  | { op: 'reveal' }
  /** targets a card of one of these types in the Scrapheap: return it to hand */
  | { op: 'recover'; types: CardType[] };

/** ICE subroutines are effects. */
export type SubOp = Effect;

/** What recurring credits may pay for. */
export type RecurringUse = 'breakers' | 'activateIce' | 'trace' | 'any';

/** Why a side is paying; recurring and bad publicity credits only cover some payments. */
export type Purpose = 'install' | 'play' | 'develop' | 'activate' | 'activateIce' | 'boost' | 'break' | 'steal' | 'trashAccess' | 'trace' | 'other';

export type PlayCondition = 'ghostHasHeat' | 'ghostRanLastTurn';

export interface Breaker {
  /** the ICE types it can interface with: one, a list, or any ICE (CR 3.9.5h) */
  breaks: IceType | IceType[] | 'any';
  strength: number;
  boostCost: number;
  boostBy: number;
  /** boosts last for the rest of the run, not only this encounter (CR 3.9.5c) */
  boostForRun?: boolean;
  breakCost: number;
  /** "break up to N subroutines" for one breakCost (default 1) */
  breakN?: number;
  /** pay this to break every subroutine on the ICE at once */
  breakAllCost?: number;
}

/** An ability on an installed Ghost card, used with the 'use' action. */
export interface Ability {
  /** cycles spent: 0 or 1 */
  cycles: number;
  credits?: number;
  trashSelf?: boolean;
  if?: PlayCondition;
  /** only on the Ghost's own turn (including runs) */
  ownTurn?: boolean;
  effects: Effect[];
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
  onScore?: Effect[];
  // ice
  subtype?: IceType;
  strength?: number;
  subs?: SubOp[];
  /** ICE, while active: effects when the Ghost approaches it (before the Corp's window), encounters it, or passes it */
  onApproach?: Effect[];
  onEncounter?: Effect[];
  onPass?: Effect[];
  // asset and upgrade
  trash?: number;
  developable?: boolean;
  /** a trap fires its onAccess effects when accessed while installed */
  trap?: boolean;
  onAccess?: Effect[];
  /** effects when the Corp activates this during a run */
  onActivateInRun?: Effect[];
  /** upgrade, while active: ICE protecting this node gets this much extra strength */
  iceStrength?: number;
  /** upgrade, while active: effects when a run on this node passes all its ICE */
  onApproachNode?: Effect[];
  // directive and stunt
  playIf?: PlayCondition;
  onPlay?: Effect[];
  /** removed from the game after it is played */
  removeAfterPlay?: boolean;
  // installed cards: active Corp assets and upgrades, installed Ghost cards
  onTurnStart?: Effect[];
  // Ghost installed cards
  onFirstSuccessfulRun?: Effect[];
  /** Ghost installed cards and identity: effects after every successful run */
  onSuccessfulRun?: Effect[];
  /** Ghost installed cards and active Corp assets, upgrades and identities: effects when any run ends */
  onRunEnd?: Effect[];
  ability?: Ability;
  ramBonus?: number;
  handBonus?: number;
  /** each turn, prevent the first n damage of each listed kind */
  prevent?: Partial<Record<DamageKind, number>>;
  /** extra cards accessed from the Mainframe */
  mainframeAccess?: number;
  // program
  ram?: number;
  breaker?: Breaker;
  /** recurring credits: refilled to n at the start of the owner's turn while installed (Corp: while active) */
  recurring?: { n: number; for: RecurringUse };
  /** Ghost: link strength against traces */
  link?: number;
  /** virus program: place 1 virus counter on it after each successful run on these nodes */
  virusOn?: 'central' | 'mainframe' | 'command' | 'dump' | 'any';
  /** virus program: when accessing the Mainframe, 1 more card for every N virus counters on it */
  virusAccess?: number;
  /** virus program: spend 1 virus counter while encountering ICE: that ICE gets -1 strength for this encounter */
  virusSpend?: boolean;
  /** gear: can host up to `max` programs; hosted programs use no RAM, and hosted breakers get +breakerStrength */
  host?: { max: number; breakerStrength?: number };
  // identity
  /** Corp identity: effects whenever the Corp scores a project */
  onCorpScore?: Effect[];
  /** Corp identity: effects whenever the Ghost steals a project */
  onSteal?: Effect[];
  /** identity: the smallest deck it can be played with (CR 1.4.3); 40 when left out */
  minDeck?: number;
}

/** A set of custom cards, loaded from JSON. See reference/CARD_PACKS.md. */
export interface CardPack {
  name: string;
  cards: CardDef[];
  /**
   * deck lists by card id (pack card first, else built-in) and copies. A side left out uses the built-in
   * deck, where a pack card with a built-in card's id replaces it and other pack cards are added.
   */
  decks?: Partial<Record<Side, Record<string, number>>>;
}

/** Which cards this game uses. Saved with the game so it replays and resumes exactly. */
export interface GameSetup {
  packName: string | null;
  /** identity card ids, one per side */
  identities: Record<Side, string>;
  /** custom card definitions, with ids already namespaced */
  cards: CardDef[];
  decks: Record<Side, Record<string, number>>;
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
  /** upgrades installed in this node (any node) */
  upgrades: Installed[];
}

export interface CorpState {
  identity: CardId;
  credits: number;
  badPublicity: number;
  /** recurring credits left this turn, by card */
  recurring: Record<CardId, number>;
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
  identity: CardId;
  credits: number;
  recurring: Record<CardId, number>;
  /** virus counters, by program */
  virus: Record<CardId, number>;
  /** hosted program -> the gear hosting it */
  hosted: Record<CardId, CardId>;
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
  /** core damage taken: each point is -1 maximum hand size, for the rest of the game */
  core: number;
  /** facedown Corp cards the Ghost has looked at */
  known: CardId[];
}

/**
 * Run steps, after the Comprehensive Rules' run phases:
 * initiation (Corp window) → approach (Corp window, may activate this ICE) → encounter → corpTrash
 * (a subroutine needs the Corp's choice) → passed (movement: the Ghost may jack out) → moveIn (Corp
 * window after moving inward) → approach … → approachNode (the Corp's last window) → access.
 */
export type RunStep = 'initiation' | 'approach' | 'encounter' | 'passed' | 'corpTrash' | 'moveIn' | 'approachNode' | 'access';

export interface RunState {
  node: NodeId;
  /** index into node.ice of the ICE being approached, encountered or just passed; -1 once inside the ICE, or on a node with none */
  pos: number;
  step: RunStep;
  /** temporary strength per breaker for this encounter */
  boost: Record<CardId, number>;
  /** strength per breaker for the rest of the run (boostForRun breakers) */
  runBoost: Record<CardId, number>;
  /** subroutines a breaker may still break from its last payment ("break up to N") */
  freeBreaks: Record<CardId, number>;
  broken: number[];
  /** unbroken subroutines still to fire */
  subQueue: number[];
  /** cards the Ghost may still choose to access by name: the node's root cards and upgrades, and projects in the Dump */
  candidates: CardId[];
  /** accesses left from the Corp's hand (Command) or deck (Mainframe), chosen at random or from the top */
  zoneLeft: number;
  /** cards already accessed in this breach */
  accessed: CardId[];
  accessing: CardId | null;
  noActivate: boolean;
  extraAccess: number;
  /** ICE still to bypass on this run */
  bypass: number;
  /** strength removed from the current ICE for this encounter (virus counters) */
  iceMinus: number;
  /** bad publicity credits for this run: spent first, gone when the run ends */
  bpCredits: number;
  /** effects that replace accessing cards, and the card they come from */
  instead: Effect[] | null;
  /** in a Corp run window, the Ghost has priority first and may use no-cycle abilities before the Corp acts (CR 9.2) */
  ghostWindow?: boolean;
  /** effects when this run succeeds, before access (a stunt's "if successful") */
  ifSuccessful: Effect[] | null;
  source: string | null;
}

/** A trace waiting for the Corp's and then the Ghost's boost. */
export interface TraceState {
  base: number;
  corpBoost: number | null;
  success: Effect[];
  source: string;
  owner: Side;
  /** effects still to resolve after the trace, and what to resume after them */
  rest: Effect[];
  then: 'subs' | 'none';
}

export interface PendingInstall {
  card: CardId;
  node?: NodeId | 'new';
  host?: CardId;
  /** chosen so far */
  trash: CardId[];
}

export type Phase = 'mulligan' | 'action' | 'discard' | 'run' | 'gameOver';

/**
 * A paid ability window outside a run (CR 5.6, 5.7): the side named may activate cards (the Corp)
 * or use abilities that cost no cycle (the Ghost), then passes; `rest` get it next.
 * turnStart: after gaining cycles, before recurring credits refill and the turn begins.
 * beforeAction: before each action of the side whose turn it is (for the other side).
 * turnEnd: after discarding, before the turn ends.
 */
export interface PriorityWindow {
  at: 'turnStart' | 'beforeAction' | 'turnEnd';
  who: Side;
  rest: Side[];
}

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
  setup: GameSetup;
  turn: Side;
  turnNumber: number;
  phase: Phase;
  /** who still has to decide on their opening hand */
  mulligan: Side | null;
  corp: CorpState;
  ghost: GhostState;
  run: RunState | null;
  trace: TraceState | null;
  window: PriorityWindow | null;
  /** an install waiting while its player picks cards to trash as part of it */
  pendingInstall: PendingInstall | null;
  /** the side whose turn it is is in the middle of an action (a run, a trace…); the other side's window opens when it completes */
  inAction: boolean;
  /** this turn */
  flags: { successfulRun: boolean; prevented: Record<DamageKind, number> };
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
  /** install; with `trash`, first choose cards to trash as part of installing it (CR 8.5.6) */
  | { type: 'install'; card: CardId; node?: NodeId | 'new'; host?: CardId; trash?: true }
  /** while choosing what to trash for an install: add a card, finish the install, or take it back */
  | { type: 'pickTrash'; card: CardId }
  | { type: 'confirmInstall' }
  | { type: 'cancelInstall' }
  /** the Ghost's programs need more RAM than they have: trash one (CR 3.9.3c) */
  | { type: 'shedProgram'; card: CardId }
  | { type: 'play'; card: CardId; node?: NodeId; target?: CardId }
  | { type: 'develop'; card: CardId }
  | { type: 'score'; card: CardId }
  | { type: 'activate'; card: CardId }
  | { type: 'decline' }
  /** close a priority window outside a run */
  | { type: 'pass' }

  | { type: 'trashContact'; card: CardId }
  | { type: 'run'; node: NodeId }
  | { type: 'shedHeat' }
  | { type: 'use'; card: CardId }
  | { type: 'boost'; card: CardId }
  | { type: 'break'; card: CardId; sub: number }
  | { type: 'breakAll'; card: CardId }
  /** stop using the rest of a "break up to N" payment */
  | { type: 'doneBreaking' }
  | { type: 'proceed' }
  | { type: 'continue' }
  | { type: 'jackOut' }
  /** during access: choose the next card, by its index in run.candidates, or (zone) the next card from Command or the Mainframe */
  | { type: 'access'; i?: number; zone?: true }
  | { type: 'steal' }
  | { type: 'trash' }
  | { type: 'leave' }
  | { type: 'chooseTrash'; card: CardId }
  | { type: 'discard'; card: CardId }
  | { type: 'traceBoost'; n: number }
  | { type: 'spendVirus'; card: CardId }
  | { type: 'purge' }
  | { type: 'endTurn' };

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

export const POINTS_TO_WIN = 7;
export const HAND_SIZE = 5;
export const BASE_RAM = 4;
export const CYCLES: Record<Side, number> = { corp: 3, ghost: 4 };

