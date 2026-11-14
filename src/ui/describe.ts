// Words and icons for cards and actions.
import { cardOf, effectText, isHidden, nameOf } from '../engine/cards';
import { findInstalled, nodeName, nodeOf } from '../engine/state';
import type { Action, CardDef, CardId, GameState } from '../engine/types';

export function icon(d: CardDef): string {
  switch (d.type) {
    case 'project':
      return '📁';
    case 'ice':
      return d.subtype === 'wall' ? '🧱' : d.subtype === 'cipher' ? '🔐' : '🐺';
    case 'asset':
      return d.trap ? '🪤' : '🏢';
    case 'upgrade':
      return '🛡️';
    case 'identity':
      return '🪪';
    case 'directive':
      return '📜';
    case 'program':
      return d.breaker ? '🗝️' : '💾';
    case 'gear':
      return '🔧';
    case 'contact':
      return '🤝';
    case 'stunt':
      return '⚡';
    default:
      return '▒';
  }
}

export function typeLabel(d: CardDef): string {
  if (d.type === 'ice') return `ICE · ${d.subtype}`;
  if (d.type === 'program' && d.breaker) return `program · breaks ${d.breaker.breaks === 'any' ? 'any ICE' : d.breaker.breaks}`;
  if (d.type === 'hidden') return 'facedown';
  return d.type;
}

/** The numbers that matter on a card, as short chips. */
export function stats(d: CardDef): string[] {
  const out: string[] = [];
  if (d.type === 'project') out.push(`${d.dev} to score`, `${d.points} pt${d.points === 1 ? '' : 's'}`);
  else if (d.cost !== undefined) out.push(`${d.cost}¢`);
  if (d.strength !== undefined) out.push(`str ${d.strength}`);
  if (d.breaker) out.push(`str ${d.breaker.strength}`);
  if (d.trash !== undefined) out.push(`trash ${d.trash}¢`);
  if (d.ram !== undefined) out.push(`${d.ram} RAM`);
  if (d.stealCost) out.push(`steal ${d.stealCost}¢`);
  return out;
}

function where(s: GameState, card: CardId): string {
  const t = findInstalled(s, card);
  return t ? nodeName(t.node.id) : '';
}

function label(card: CardId): string {
  return isHidden(card) ? 'facedown card' : nameOf(card);
}

export function describeAction(s: GameState, a: Action): string {
  switch (a.type) {
    case 'keep':
      return '✅ Keep this hand';
    case 'mulligan':
      return '🔄 Mulligan (new 5 cards)';
    case 'credit':
      return '💰 Take 1 credit';
    case 'draw':
      return '🃏 Draw 1 card';
    case 'install': {
      const d = cardOf(a.card);
      if (d.side === 'ghost') return a.host ? `⬇️ Install ${d.name} on ${label(a.host)} (${d.cost}¢, no RAM)` : `⬇️ Install ${d.name} (${d.cost}¢)`;
      const cost = d.type === 'ice' && a.node && a.node !== 'new' ? nodeOf(s, a.node).ice.length : 0;
      const spot = a.node === 'new' ? 'a new site' : nodeName(a.node!);
      const swap = d.type !== 'ice' && d.type !== 'upgrade' && a.node !== 'new' && nodeOf(s, a.node!).root ? ' (trashes what is there)' : '';
      if (d.type === 'upgrade') return `⬇️ Install upgrade in ${spot}`;
      return d.type === 'ice' ? `⬇️ Install protecting ${spot}${cost ? ` (${cost}¢)` : ''}` : `⬇️ Install in ${spot}${swap}`;
    }
    case 'play': {
      const d = cardOf(a.card);
      const on = a.node ? ` on ${nodeName(a.node)}` : a.target ? `: ${label(a.target)}${where(s, a.target) ? ` in ${where(s, a.target)}` : ''}` : '';
      return `▶️ Play ${d.name}${on} (${d.cost}¢)`;
    }
    case 'develop':
      return `🔨 Develop ${label(a.card)} in ${where(s, a.card)} (1¢)`;
    case 'score':
      return `🏆 Score ${label(a.card)}`;
    case 'activate':
      return `💡 Activate ${label(a.card)} (${cardOf(a.card).cost ?? 0}¢)`;
    case 'decline':
      return s.run?.step === 'approachNode' ? '🙈 Activate nothing: let the Ghost in' : '🙈 Leave it inactive';
    case 'trashContact':
      return `🔥 Trash their ${label(a.card)} (2¢)`;
    case 'run':
      return `🏃 Run on ${nodeName(a.node)}`;
    case 'shedHeat':
      return '🧊 Shed 1 heat (2¢)';
    case 'use':
    {
      const d = cardOf(a.card);
      const ab = d.ability!;
      const cost = [ab.cycles ? `${ab.cycles} cycle` : 'no cycle', ab.credits ? `${ab.credits}¢` : '', ab.trashSelf ? 'trash it' : ''].filter(Boolean).join(', ');
      return `✨ ${d.name}: ${ab.effects.map((e) => effectText(e, 'ghost')).join(' ')} (${cost})`;
    }
    case 'scrap':
      return `🗑️ Scrap ${label(a.card)} (free)`;
    case 'boost': {
      const b = cardOf(a.card).breaker!;
      return `⬆️ Boost ${label(a.card)} +${b.boostBy} (${b.boostCost}¢)`;
    }
    case 'break':
      return `🗝️ ${label(a.card)}: break subroutine ${a.sub + 1} (${cardOf(a.card).breaker!.breakCost}¢)`;
    case 'proceed':
      return '➡️ Let the remaining subroutines fire';
    case 'continue':
      return '➡️ Continue the run';
    case 'jackOut':
      return '🚪 Jack out';
    case 'steal': {
      const cost = s.run?.accessing ? cardOf(s.run.accessing).stealCost : 0;
      return `🏆 Steal it${cost ? ` (${cost}¢)` : ''}`;
    }
    case 'trash':
      return `🗑️ Trash it (${s.run?.accessing ? (cardOf(s.run.accessing).trash ?? 0) : 0}¢)`;
    case 'leave':
      return '👋 Leave it';
    case 'chooseTrash':
      return `🗑️ Trash ${label(a.card)}`;
    case 'discard':
      return `🗑️ Discard ${label(a.card)}`;
    case 'traceBoost':
      if (s.trace?.corpBoost === null) return a.n ? `📡 Raise the trace by ${a.n} (${a.n}¢) → ${s.trace.base + a.n}` : `📡 Trace at ${s.trace.base} (pay nothing)`;
      return a.n ? `📶 Raise your link by ${a.n} (${a.n}¢)` : '📶 Pay nothing for link';
    case 'spendVirus':
      return `🦠 ${label(a.card)}: spend a virus counter, -1 ICE strength`;
    case 'purge':
      return '🧹 Purge viruses (all 3 cycles)';
    case 'endTurn':
      return '⏭️ End turn';
  }
}
