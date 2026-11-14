// Test helpers: build exact table positions by moving real card instances between zones.
import { expect } from 'vitest';
import { apply } from '../src/engine/actions';
import { defaultDeck, defId } from '../src/engine/cards';
import { violations } from '../src/engine/invariants';
import { legalActions } from '../src/engine/legal';
import { newGame, nodeOf } from '../src/engine/state';
import { loadPack } from '../src/engine/pack';
import type { Action, CardId, GameSetup, GameState, NodeId, Side } from '../src/engine/types';

/** Apply one action exactly. */
export function actRaw(s: GameState, a: Action): GameState {
  const r = apply(s, a);
  if (!r.ok) throw new Error(`${JSON.stringify(a)} rejected: ${r.error}`);
  expect(violations(r.state)).toEqual([]);
  return r.state;
}

/**
 * Apply one action; then, if a run has reached its node and the Corp has nothing it could
 * activate, pass the Corp's window for it. Tests of that window use actRaw.
 */
export function act(s: GameState, a: Action): GameState {
  let next = actRaw(s, a);
  if (next.run?.step === 'approachNode') {
    const legal = legalActions(next);
    if (legal.length === 1 && legal[0].type === 'decline') next = actRaw(next, legal[0]);
  }
  return next;
}

export function rejects(s: GameState, a: Action): string {
  const r = apply(s, a);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
}

/**
 * The built-in cards (at least 3 of each) with identities that do nothing, so each test sees only the cards it sets up.
 * Tests of the real identities pass them to newGame themselves.
 */
const plain = loadPack({
  name: 'test identities',
  cards: [
    { id: 'plain-corp', name: 'Plain Corp', side: 'corp', type: 'identity', copies: 1, text: 'Identity. No ability.' },
    { id: 'plain-ghost', name: 'Plain Ghost', side: 'ghost', type: 'identity', copies: 1, link: 0, text: 'Identity. Link 0. No ability.' },
  ],
  // at least 3 of every built-in card, so a test can always pull the copies it needs
  decks: {
    corp: Object.fromEntries(Object.entries(defaultDeck('corp')).map(([id, n]) => [id, Math.max(n, 3)])),
    ghost: Object.fromEntries(Object.entries(defaultDeck('ghost')).map(([id, n]) => [id, Math.max(n, 3)])),
  },
});
if (!plain.ok) throw new Error(plain.errors.join('; '));
export const PLAIN: GameSetup = plain.setup;

/** A game past the mulligans: Corp's turn 1, with empty hands so tests control every card. */
export function blank(human: Side = 'ghost', identities?: Partial<Record<Side, string>>): GameState {
  let s = newGame({ seed: 42, human, setup: PLAIN, identities });
  s = act(s, { type: 'keep' });
  s = act(s, { type: 'keep' });
  s = structuredClone(s);
  for (const side of ['corp', 'ghost'] as const) s[side].deck.push(...s[side].hand.splice(0));
  return s;
}

/** Pull one instance of a card out of its owner's deck or hand. */
export function take(s: GameState, def: string): CardId {
  for (const side of ['corp', 'ghost'] as const)
    for (const zone of [s[side].deck, s[side].hand]) {
      const i = zone.findIndex((c) => defId(c) === def);
      if (i >= 0) return zone.splice(i, 1)[0];
    }
  throw new Error(`no ${def} left`);
}

export function hand(s: GameState, side: Side, ...defs: string[]): CardId[] {
  return defs.map((d) => {
    const c = take(s, d);
    s[side].hand.push(c);
    return c;
  });
}

export function ice(s: GameState, node: NodeId, def: string, active = true): CardId {
  const c = take(s, def);
  nodeOf(s, node).ice.push({ card: c, active, dev: 0 });
  return c;
}

/** Create a site holding this card. */
export function site(s: GameState, def: string, opts: { dev?: number; active?: boolean } = {}): { id: NodeId; card: CardId } {
  const card = take(s, def);
  const id = `site${++s.corp.siteCount}`;
  s.corp.nodes.push({ id, ice: [], root: { card, active: !!opts.active, dev: opts.dev ?? 0 }, upgrades: [] });
  return { id, card };
}

/** Install an upgrade in a node. */
export function upgrade(s: GameState, node: NodeId, def: string, active = false): CardId {
  const c = take(s, def);
  nodeOf(s, node).upgrades.push({ card: c, active, dev: 0 });
  return c;
}

export function rig(s: GameState, ...defs: string[]): CardId[] {
  return defs.map((d) => {
    const c = take(s, d);
    const zone = ['ram-brick', 'padded-rig', 'burner-phone', 'flak-vest', 'exo-frame', 'hot-cache', 'signal-booster'].includes(d) ? s.ghost.gear : ['street-fence', 'safehouse'].includes(d) ? s.ghost.contacts : s.ghost.programs;
    zone.push(c);
    return c;
  });
}

/** Make it the Ghost's turn with full cycles. */
export function ghostTurn(s: GameState, credits = 10): GameState {
  s.turn = 'ghost';
  s.phase = 'action';
  s.ghost.cycles = 4;
  s.corp.cycles = 0;
  s.ghost.credits = credits;
  return s;
}

export function corpTurn(s: GameState, credits = 10): GameState {
  s.turn = 'corp';
  s.phase = 'action';
  s.corp.cycles = 3;
  s.corp.credits = credits;
  return s;
}
