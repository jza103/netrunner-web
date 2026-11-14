// Card lookup. Card instances are "<defId>#<n>"; ids starting with "?" are hidden from the viewer.
import raw from '../../data/cards.json';
import type { CardDef, CardId, Side, SubOp } from './types';

export const CARDS: CardDef[] = raw as CardDef[];
const byId = new Map(CARDS.map((c) => [c.id, c]));

export const HIDDEN: CardDef = { id: 'hidden', name: 'Facedown card', side: 'corp', type: 'hidden', copies: 0, text: '' };

export function isHidden(id: CardId): boolean {
  return id.startsWith('?');
}

export function defId(id: CardId): string {
  return id.split('#')[0];
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

/** Every card instance for one side's deck, unshuffled. */
export function deckList(side: Side): CardId[] {
  const out: CardId[] = [];
  for (const c of CARDS) if (c.side === side) for (let i = 1; i <= c.copies; i++) out.push(`${c.id}#${i}`);
  return out;
}

export function subText(sub: SubOp): string {
  switch (sub.op) {
    case 'endRun':
      return 'End the run.';
    case 'damage':
      return `Deal ${sub.n} damage.`;
    case 'loseCredits':
      return `The Ghost loses ${sub.n} credits.`;
    case 'corpGain':
      return `The Corp gains ${sub.n} credits.`;
    case 'heat':
      return `The Ghost gains ${sub.n} heat.`;
    case 'loseCycle':
      return `The Ghost loses ${sub.n} cycle, if able.`;
    case 'trashProgram':
      return 'The Corp trashes 1 installed program.';
  }
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
