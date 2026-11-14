// Builds the Operator prompts. Claude only ever sees the human side's view: the other hand, both
// decks and facedown cards the human has not looked at are hidden. Nothing here changes state.
import rulesRaw from '../../reference/RULES.md?raw';
import { CARDS, cardOf, fullText, isHidden, nameOf } from '../engine/cards';
import { breakerStrength, currentIce, maxHand, nodeName, points, ramLimit, ramUsed } from '../engine/state';
import { eventText, viewFor } from '../engine/view';
import type { GameEvent, GameState, Installed, Side } from '../engine/types';

const sideName = (side: Side) => (side === 'corp' ? 'the Corp' : 'the Ghost');

function cardList(): string {
  return CARDS.map((c) => {
    const stats = [
      c.cost !== undefined ? `cost ${c.cost}` : '',
      c.dev !== undefined ? `needs ${c.dev} counters, ${c.points} points` : '',
      c.strength !== undefined ? `${c.subtype}, strength ${c.strength}` : '',
      c.trash !== undefined ? `trash cost ${c.trash}` : '',
      c.ram !== undefined ? `${c.ram} RAM` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return `- ${c.name} (${c.side} ${c.type}, ×${c.copies}; ${stats}): ${fullText(c)}`;
  }).join('\n');
}

export function systemPrompt(human: Side): string {
  return [
    'You are the Operator: the calm, dry voice in the player\'s ear in Breachline, a single-player cyber-heist card game',
    `web app. The player is ${sideName(human)}; a rule-based bot plays ${sideName(human === 'corp' ? 'ghost' : 'corp')}. A rules engine runs the game: it shuffles,`,
    'enforces every rule and moves every card. You never change the game. You describe what the engine reports and you teach.',
    '',
    'Hard rules:',
    '- Narrate only what appears in the events you are given. Never invent a card, a result, a choice or an outcome.',
    '- You see the player\'s view only. Facedown cards, the other hand and both decks are hidden; never guess what they are',
    '  as if you knew. You may reason aloud about what they could be from public information.',
    '- The app already shows the legal moves; do not ask the player questions or offer menus. Speak in second person.',
    '- Be brief and mobile-friendly: 2 to 5 short lines, light cyberpunk flavour, no purple prose.',
    '- When the events include a move the player tried that the engine rejected, open with "⚖️ Not valid:" and explain the rule.',
    '- Add at most one "🎓" teaching note, only when there is a real lesson (a missed line, a risk, a rule interaction).',
    '- This is Breachline, an original game. Do not use terms or card names from other card games.',
    '',
    'The rules of Breachline:',
    '',
    rulesRaw,
    '',
    'Every card in the game:',
    cardList(),
  ].join('\n');
}

function inst(i: Installed): string {
  const name = isHidden(i.card) ? 'facedown card' : `${nameOf(i.card)}${i.active ? '' : ' (facedown, known to you)'}`;
  return `${name}${i.dev ? ` with ${i.dev} development counter${i.dev === 1 ? '' : 's'}` : ''}`;
}

/** A compact description of the table from the human's side. */
export function describeTable(s: GameState): string {
  const me = s.human;
  const v = viewFor(s, me);
  const c = v.corp;
  const g = v.ghost;
  const lines: string[] = [];
  lines.push(`Turn ${v.turnNumber}, ${v.turn === me ? 'your' : `${sideName(v.turn)}'s`} turn, phase: ${v.phase}. You are ${sideName(me)}.`);
  lines.push(`Score: Corp ${points(v, 'corp')}, Ghost ${points(v, 'ghost')} (7 wins).`);
  const hand = (side: Side) =>
    side === me
      ? `hand [${v[side].hand.length}/${maxHand(v, side)}]: ${v[side].hand.map((x) => `${nameOf(x)} (${fullText(cardOf(x))})`).join('; ') || 'empty'}`
      : `hand: ${v[side].hand.length} cards (hidden)`;
  lines.push(`Corp: ${c.credits} credits, ${c.cycles} cycles left, ${hand('corp')}; Mainframe ${c.deck.length} cards; Dump ${c.discard.length} cards (${c.discard.filter((x) => !isHidden(x)).map(nameOf).join(', ') || 'none faceup'}).`);
  for (const n of c.nodes) {
    const ice = n.ice.length ? [...n.ice].reverse().map(inst).join(' → ') : 'no ICE';
    const root = n.id.startsWith('site') ? `; inside: ${n.root ? inst(n.root) : 'nothing'}` : '';
    lines.push(`  ${nodeName(n.id)}: ICE outermost to innermost: ${ice}${root}`);
  }
  lines.push(
    `Ghost: ${g.credits} credits, ${g.cycles} cycles left, heat ${g.heat}, RAM ${ramUsed(v)}/${ramLimit(v)}, ${hand('ghost')}; ` +
      `programs: ${g.programs.map(nameOf).join(', ') || '-'}; gear: ${g.gear.map(nameOf).join(', ') || '-'}; contacts: ${g.contacts.map(nameOf).join(', ') || '-'}; ` +
      `deck ${g.deck.length}; Scrapheap ${g.discard.length}.`,
  );
  if (v.run) {
    const ice = currentIce(v);
    lines.push(
      `Run in progress on ${nodeName(v.run.node)}, step: ${v.run.step}` +
        (ice && v.run.step !== 'access' ? `, at ${inst(ice)}; broken subroutines: ${v.run.broken.map((i) => i + 1).join(', ') || 'none'}` : '') +
        (v.run.step === 'encounter' ? `; breaker strengths now: ${g.programs.filter((p) => cardOf(p).breaker).map((p) => `${nameOf(p)} ${breakerStrength(v, p)}`).join(', ') || 'no breakers'}` : '') +
        (v.run.accessing && me === 'ghost' ? `; accessing ${nameOf(v.run.accessing)}` : '') +
        '.',
    );
  }
  if (v.winner) lines.push(`Winner: ${sideName(v.winner)} (${v.winReason})`);
  return lines.join('\n');
}

/** Whose turn each event happened in, from the 'turn' markers in the event stream. */
export function eventsWithTurnPlayer(events: GameEvent[], fallback: Side): { e: GameEvent; turnPlayer: Side }[] {
  let current = fallback;
  return events.map((e) => {
    if (e.type === 'turn' && e.side) current = e.side;
    return { e, turnPlayer: current };
  });
}

export interface NarrationInput {
  state: GameState;
  events: GameEvent[];
  rejected: string[];
  recent: string[];
}

export function narrationPrompt({ state, events, rejected, recent }: NarrationInput): string {
  return [
    recent.length ? `Your last narration (for continuity, do not repeat it):\n${recent.join('\n---\n')}\n` : '',
    'New engine events since you last spoke:',
    ...events.map((e) => `- ${eventText(e, state.human)}`),
    ...(rejected.length ? ['', 'Moves the player tried that the engine rejected:', ...rejected.map((r) => `- ${r}`)] : []),
    '',
    'The table now (your view):',
    describeTable(state),
    '',
    state.phase === 'gameOver'
      ? 'The game is over. Announce the result, then give the debrief: the 3 or 4 moments that decided it, each as a 🎓 lesson.'
      : 'Narrate these events as the Operator.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function questionPrompt(state: GameState, question: string, recentEvents: GameEvent[]): string {
  return [
    'Recent engine events:',
    ...recentEvents.map((e) => `- ${eventText(e, state.human)}`),
    '',
    'The table now (your view):',
    describeTable(state),
    '',
    `The player asks you, as the Operator: ${question}`,
    'Answer briefly and accurately from the rules. If it is about a move, rule on it with ⚖️ Valid / Not valid / Valid but….',
  ].join('\n');
}
