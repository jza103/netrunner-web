// Builds the Operator prompts. Claude only ever sees the human side's view: the other hand, both
// decks and facedown cards the human has not looked at are hidden. Nothing here changes state.
import rulesRaw from '../../reference/RULES.md?raw';
import { CARDS, cardOf, fullText, isHidden, nameOf } from '../engine/cards';
import { breakerStrength, currentIce, link, maxHand, nodeName, points, ramLimit, ramUsed } from '../engine/state';
import { eventText, viewFor } from '../engine/view';
import type { CardDef, GameEvent, GameState, Installed, Side } from '../engine/types';

const sideName = (side: Side) => (side === 'corp' ? 'the Corp' : 'the Ghost');

function cardLine(c: CardDef, copies?: number): string {
  const stats = [
    c.cost !== undefined ? `cost ${c.cost}` : '',
    c.dev !== undefined ? `needs ${c.dev} counters, ${c.points} points` : '',
    c.strength !== undefined ? `${c.subtype}, strength ${c.strength}` : '',
    c.trash !== undefined ? `trash cost ${c.trash}` : '',
    c.ram !== undefined ? `${c.ram} RAM` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `- ${c.name} (${c.side} ${c.type}${copies ? `, ×${copies}` : ''}; ${stats}): ${fullText(c)}`;
}

/**
 * The player's own deck with copies, and every card the other side might have. Built from the
 * player's view, which does not contain the other side's deck list.
 */
function cardList(v: GameState): string {
  const me = v.human;
  const foe: Side = me === 'corp' ? 'ghost' : 'corp';
  const own = Object.entries(v.setup.decks[me]).map(([id, n]) => cardLine(cardOf(`${id}#1`), n));
  const replaced = new Set(v.setup.cards.map((c) => c.id.replace(/^x[0-9a-f]{8}-/, '')));
  const theirs = [...CARDS.filter((c) => c.side === foe && !replaced.has(c.id)), ...v.setup.cards.filter((c) => c.side === foe)].map((c) => cardLine(c));
  return [
    `Your identity: ${cardLine(cardOf(v[me].identity))}`,
    `${sideName(foe)}'s identity: ${cardLine(cardOf(v[foe].identity))}`,
    '',
    `Your deck${v.setup.packName ? ` (card pack: ${v.setup.packName})` : ''}:`,
    ...own,
    '',
    `Cards ${sideName(foe)} may have (their deck list is hidden):`,
    ...theirs.filter((l) => !l.includes(' identity')),
  ].join('\n');
}

export function systemPrompt(s: GameState): string {
  const human = s.human;
  const v = viewFor(s, human);
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
    '- Breachline plays by the Netrunner rules with original cards. The player is using it to learn Netrunner: in teaching notes,',
    '  give the Netrunner term in brackets the first time a Breachline term comes up, from "Netrunner terms" in the rules,',
    '  for example "cycle (click)". Never name cards from Netrunner or any other card game.',
    "- If the game uses a card pack, its cards are the player's own designs: read them exactly as written below.",
    '',
    'The rules of Breachline:',
    '',
    rulesRaw,
    '',
    'The cards:',
    cardList(v),
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
  const rec = (side: Side) => {
    const r = Object.entries(v[side].recurring).filter(([, n]) => n > 0);
    return r.length ? `, recurring credits: ${r.map(([k, n]) => `${nameOf(k)} ${n}`).join(', ')}` : '';
  };
  lines.push(`Corp: ${c.credits} credits${rec('corp')}, bad publicity ${c.badPublicity}, ${c.cycles} cycles left, ${hand('corp')}; Mainframe ${c.deck.length} cards; Dump ${c.discard.length} cards (${c.discard.filter((x) => !isHidden(x)).map(nameOf).join(', ') || 'none faceup'}).`);
  for (const n of c.nodes) {
    const ice = n.ice.length ? [...n.ice].reverse().map(inst).join(' → ') : 'no ICE';
    const root = n.id.startsWith('site') ? `; inside: ${n.root ? inst(n.root) : 'nothing'}` : '';
    const ups = n.upgrades.length ? `; upgrades: ${n.upgrades.map(inst).join(', ')}` : '';
    lines.push(`  ${nodeName(n.id)}: ICE outermost to innermost: ${ice}${root}${ups}`);
  }
  lines.push(
    `Ghost: ${g.credits} credits${rec('ghost')}, ${g.cycles} cycles left, link ${link(v)}, heat ${g.heat}${g.core ? `, core damage ${g.core}` : ''}, RAM ${ramUsed(v)}/${ramLimit(v)}, ${hand('ghost')}; ` +
      `programs: ${g.programs.map((p) => `${nameOf(p)}${g.hosted[p] ? ` (hosted on ${nameOf(g.hosted[p])})` : ''}${g.virus[p] ? ` [${g.virus[p]} virus]` : ''}`).join(', ') || '-'}; gear: ${g.gear.map(nameOf).join(', ') || '-'}; contacts: ${g.contacts.map(nameOf).join(', ') || '-'}; ` +
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
  if (v.trace)
    lines.push(
      `Trace in progress from ${v.trace.source}: base ${v.trace.base}` +
        (v.trace.corpBoost === null ? ', the Corp is choosing its boost.' : `, the Corp boosted it to ${v.trace.base + v.trace.corpBoost}; the Ghost is choosing how much link to buy.`),
    );
  if (v.run?.bpCredits) lines.push(`Bad publicity credits left for this run: ${v.run.bpCredits}.`);
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
