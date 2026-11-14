// Card lookup. Card instances are "<defId>#<n>"; ids starting with "?" are hidden from the viewer.
//
// Built-in cards come from data/cards.json. Custom cards travel inside GameState.setup and are
// added to the lookup by ensureCards(). Their ids are namespaced with a hash of their content
// ("x1a2b3c4d-<id>"), so one id always means one definition and the lookup never changes what a
// state means: apply() stays a function of its input.
import raw from '../../data/cards.json';
import type { CardDef, CardId, Effect, GameSetup, GameState, Side, SubOp } from './types';

export const CARDS: CardDef[] = raw as CardDef[];
const byId = new Map(CARDS.map((c) => [c.id, c]));

export const HIDDEN: CardDef = { id: 'hidden', name: 'Facedown card', side: 'corp', type: 'hidden', copies: 0, text: '' };

/** Make the custom cards of this game known to cardOf(). Safe to call any number of times. */
export function ensureCards(s: { setup?: GameSetup }) {
  for (const d of s.setup?.cards ?? []) if (!byId.has(d.id)) byId.set(d.id, d);
}

export function isHidden(id: CardId): boolean {
  return id.startsWith('?');
}

export function defId(id: CardId): string {
  return id.split('#')[0];
}

export function hasDef(id: string): boolean {
  return byId.has(id);
}

export function cardOf(id: CardId): CardDef {
  if (isHidden(id)) return HIDDEN;
  const d = byId.get(defId(id));
  if (!d) throw new Error(`Unknown card ${id}`);
  return d;
}

export function nameOf(id: CardId): string {
  return cardOf(id).name;
}

export function is(id: CardId, def: string): boolean {
  return defId(id) === def;
}

/** The built-in decks, by card id and copies. */
export function defaultDeck(side: Side): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CARDS) if (c.side === side) out[c.id] = c.copies;
  return out;
}

export function defaultSetup(): GameSetup {
  return { packName: null, cards: [], decks: { corp: defaultDeck('corp'), ghost: defaultDeck('ghost') } };
}

/** Every card instance for one side's deck, unshuffled. */
export function deckList(side: Side, setup: GameSetup = defaultSetup()): CardId[] {
  ensureCards({ setup });
  const out: CardId[] = [];
  for (const [id, copies] of Object.entries(setup.decks[side])) for (let i = 1; i <= copies; i++) out.push(`${id}#${i}`);
  return out;
}

/** Every card definition this game can show: built-in plus custom. */
export function poolOf(s: Pick<GameState, 'setup'>): CardDef[] {
  ensureCards(s);
  const ids = new Set([...Object.keys(s.setup.decks.corp), ...Object.keys(s.setup.decks.ghost)]);
  return [...ids].map((id) => byId.get(id)!).filter(Boolean);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function amount(n: number, per: { perHeat?: number; perDev?: number }): string {
  const parts: string[] = [];
  if (n || (!per.perHeat && !per.perDev)) parts.push(String(n));
  if (per.perHeat) parts.push(`${per.perHeat} for each heat the Ghost has`);
  if (per.perDev) parts.push(`${per.perDev} for each development counter on this card`);
  return parts.join(' plus ');
}

const nodeWord = { command: 'Command', mainframe: 'the Mainframe', dump: 'the Dump', any: 'any node' } as const;

/** Plain words for one effect. `owner` is the side whose card it is. */
export function effectText(e: Effect, owner: Side = 'corp'): string {
  const who = (w: Side | undefined) => ((w ?? owner) === 'corp' ? 'The Corp' : 'The Ghost');
  switch (e.op) {
    case 'gain':
      return `${who(e.who)} gains ${plural(e.n, 'credit')}.`;
    case 'draw':
      return `${who(e.who)} draws ${plural(e.n, 'card')}.`;
    case 'damage':
      return `Deal ${amount(e.n, e)} ${e.kind} damage.`;
    case 'heat':
      return `The Ghost gains ${e.n} heat.`;
    case 'shedHeat':
      return `The Ghost removes up to ${e.n} heat.`;
    case 'loseCredits':
      return `The Ghost loses ${amount(e.n, e)} credits.`;
    case 'drain':
      return `The Corp loses up to ${plural(e.n, 'credit')} and the Ghost gains that many.`;
    case 'loseCycle':
      return `The Ghost loses ${plural(e.n, 'cycle')}, if able.`;
    case 'trashProgram':
      return 'The Corp trashes 1 installed program.';
    case 'endRun':
      return 'End the run.';
    case 'payOrEndRun':
      return `The Ghost loses ${plural(e.n, 'credit')}; if they have fewer, end the run.`;
    case 'develop':
      return `Place ${plural(e.n, 'development counter')} on one installed card that can be developed.`;
    case 'recycleDump':
      return 'Shuffle the Dump into the Mainframe.';
    case 'run': {
      const bits = [`Make a run on ${nodeWord[e.node]}.`];
      if (e.noActivate) bits.push('The Corp cannot activate ICE during this run.');
      if (e.extraAccess) bits.push(`If it succeeds, access ${e.extraAccess} additional card${e.extraAccess === 1 ? '' : 's'}.`);
      if (e.instead?.length) bits.push(`If it succeeds, instead of accessing cards: ${e.instead.map((x) => effectText(x, 'ghost')).join(' ')}`);
      return bits.join(' ');
    }
    case 'reveal':
      return 'Look at every facedown card installed in or protecting one node.';
    case 'recover':
      return `Return 1 ${e.types.join(' or ')} from the Scrapheap to hand.`;
  }
}

export function subText(sub: SubOp): string {
  return effectText(sub, 'corp');
}

/** Full rules text for display, including generated ICE and breaker lines. */
export function fullText(def: CardDef): string {
  const parts: string[] = [];
  if (def.subs) parts.push(def.subs.map((s) => `↳ ${subText(s)}`).join(' '));
  if (def.breaker) {
    const b = def.breaker;
    const what = b.breaks === 'any' ? 'any ICE' : `${b.breaks} ICE`;
    parts.push(`Breaks ${what}. ${b.breakCost}¢: break 1 subroutine. ${b.boostCost}¢: +${b.boostBy} strength for this encounter.`);
  }
  if (def.text) parts.push(def.text);
  return parts.join(' ');
}

/** The one effect on a card that needs a target chosen when it is played, if any. */
export function targetedEffect(def: CardDef): Effect | undefined {
  return (def.onPlay ?? []).find((e) => e.op === 'develop' || e.op === 'reveal' || e.op === 'recover' || (e.op === 'run' && e.node === 'any'));
}
