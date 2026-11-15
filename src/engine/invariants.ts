// Checks that must hold after every action. Used by the soak tests.
import { cardOf, deckList } from './cards';
import { corpSources, ghostSources, maxHand } from './state';
import type { CardId, GameState } from './types';

export function allCards(s: GameState): CardId[] {
  const c = s.corp;
  const g = s.ghost;
  const out = [...c.hand, ...c.deck, ...c.discard, ...c.scored, ...c.removed, ...g.hand, ...g.deck, ...g.discard, ...g.scored, ...g.programs, ...g.gear, ...g.contacts];
  for (const n of c.nodes) {
    if (n.root) out.push(n.root.card);
    for (const i of n.ice) out.push(i.card);
    for (const i of n.upgrades) out.push(i.card);
  }
  return out;
}

const expectedCache = new Map<string, string>();
function expected(s: GameState): string {
  const key = JSON.stringify(s.setup.decks);
  let e = expectedCache.get(key);
  if (!e) {
    e = [...deckList('corp', s.setup), ...deckList('ghost', s.setup)].sort().join(',');
    expectedCache.set(key, e);
  }
  return e;
}

export function violations(s: GameState): string[] {
  const v: string[] = [];
  const c = s.corp;
  const g = s.ghost;
  if (allCards(s).sort().join(',') !== expected(s)) v.push('cards are not conserved (a card is missing or duplicated)');
  if (c.credits < 0 || g.credits < 0) v.push('negative credits');
  if (c.cycles < 0 || g.cycles < 0) v.push('negative cycles');
  if (g.heat < 0) v.push('negative heat');
  // programs over RAM are allowed only while the Ghost must trash one (legalActions offers nothing else)
  if (g.core < 0) v.push('negative core damage');
  if (c.badPublicity < 0) v.push('negative bad publicity');
  if (cardOf(c.identity).type !== 'identity' || cardOf(g.identity).type !== 'identity') v.push('a side has no identity');
  for (const [card, host] of Object.entries(g.hosted)) {
    if (!g.programs.includes(card)) v.push(`${card} is hosted but not installed`);
    if (!g.gear.includes(host)) v.push(`${card} is hosted on ${host}, which is not installed`);
  }
  for (const [card, n] of Object.entries(g.virus)) if (!g.programs.includes(card) || n < 0) v.push(`bad virus counters on ${card}`);
  for (const card of Object.keys(g.recurring)) if (!ghostSources(s).includes(card)) v.push(`recurring credits on ${card}, which is not in play`);
  for (const card of Object.keys(c.recurring)) if (!corpSources(s).includes(card)) v.push(`recurring credits on ${card}, which is not in play`);
  if (s.run && s.run.bpCredits < 0) v.push('negative bad publicity credits');
  for (const n of c.nodes) {
    for (const i of n.ice) if (cardOf(i.card).type !== 'ice') v.push(`${i.card} is installed as ICE`);
    if (n.root && !['project', 'asset'].includes(cardOf(n.root.card).type)) v.push(`${n.root.card} cannot be in a site`);
    if (n.root && !n.id.startsWith('site')) v.push(`central node ${n.id} has a root card`);
    for (const u of n.upgrades) if (cardOf(u.card).type !== 'upgrade') v.push(`${u.card} is installed as an upgrade`);
  }
  for (const x of c.discardSeen) if (!c.discard.includes(x)) v.push(`${x} is marked seen but is not in the Dump`);
  for (const x of [...c.scored, ...g.scored]) if (cardOf(x).type !== 'project') v.push(`${x} is in a score area`);
  for (const x of g.programs) if (cardOf(x).type !== 'program') v.push(`${x} is installed as a program`);
  if (s.phase === 'run' && !s.run) v.push('run phase without a run');
  if (s.phase !== 'run' && s.run) v.push('run outside the run phase');
  if (s.phase === 'gameOver' && !s.winner) v.push('game over without a winner');
  // at the start of a turn the previous player is at or under their hand limit
  const last = s.events[s.events.length - 1];
  if (s.phase === 'action' && last?.type === 'turn') {
    const prev = s.turn === 'corp' ? 'ghost' : 'corp';
    if (s[prev].hand.length > maxHand(s, prev)) v.push(`${prev} ended the turn over the hand limit`);
  }
  return v;
}
