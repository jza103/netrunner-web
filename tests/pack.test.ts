// Custom card packs: checking, deck building, and full games played with custom cards.
import { describe, expect, it } from 'vitest';
import sample from '../packs/sample-pack.json';
import { simulate } from '../src/bots/driver';
import { apply } from '../src/engine/actions';
import { cardOf, deckList, defaultDeck, nameOf } from '../src/engine/cards';
import { violations } from '../src/engine/invariants';
import { legalActions } from '../src/engine/legal';
import { builtInPack, deckPool, deckProblems, exportPack, loadPack, parsePack } from '../src/engine/pack';
import { newGame, nodeOf } from '../src/engine/state';
import type { GameSetup } from '../src/engine/types';
import { viewFor } from '../src/engine/view';
import { systemPrompt } from '../src/operator/prompt';
import { act, actRaw, ghostTurn } from './helpers';

function setupOf(raw: unknown): GameSetup {
  const r = loadPack(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.setup;
}

function errorsOf(raw: unknown): string {
  const r = loadPack(raw);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.errors.join('\n');
}

const counts = (setup: GameSetup, side: 'corp' | 'ghost') => {
  const out: Record<string, number> = {};
  for (const c of deckList(side, setup)) out[nameOf(c)] = (out[nameOf(c)] ?? 0) + 1;
  return out;
};

/** A tiny valid card for building error cases. */
const stunt = (extra: Record<string, unknown> = {}) => ({ id: 'x', name: 'X', side: 'ghost', type: 'stunt', copies: 1, cost: 0, text: 'X.', onPlay: [{ op: 'gain', n: 1 }], ...extra });

describe('loading packs', () => {
  it('the built-in set, exported as a pack, loads back as the same decks', () => {
    const r = loadPack(builtInPack());
    expect(r.ok && r.warnings).toEqual([]);
    const setup = setupOf(builtInPack());
    const base = setupOf({ name: 'empty', cards: [] });
    expect(counts(setup, 'corp')).toEqual(counts(base, 'corp'));
    expect(counts(setup, 'ghost')).toEqual(counts(base, 'ghost'));
  });
  it('the sample pack loads: new cards are added, a card with a built-in id replaces it', () => {
    const setup = setupOf(sample);
    expect(setup.packName).toBe('Sample pack: Night Market');
    const ghost = counts(setup, 'ghost');
    expect(ghost['Fast Money']).toBe(2); // replaced: 3 copies became 2
    expect(ghost['Pry Bar']).toBe(2);
    expect(counts(setup, 'corp')['Toll Booth']).toBe(2);
    expect(counts(setup, 'corp')['Tripwire']).toBe(defaultDeck('corp').tripwire);
  });
  it('ids are namespaced by content, so the same card always gets the same id', () => {
    const a = setupOf(sample).cards.find((c) => c.name === 'Pry Bar')!;
    const b = setupOf(structuredClone(sample)).cards.find((c) => c.name === 'Pry Bar')!;
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^x[0-9a-f]{8}-pry-bar$/);
    const changed = structuredClone(sample);
    changed.cards.find((c) => c.id === 'pry-bar')!.cost = 3;
    expect(setupOf(changed).cards.find((c) => c.name === 'Pry Bar')!.id).not.toBe(a.id);
  });
  it('explicit deck lists can mix pack and built-in cards', () => {
    const setup = setupOf({ ...sample, decks: { ghost: { 'pry-bar': 3, 'skeleton-key': 3, stiletto: 3, 'fast-money': 3, 'market-stall': 3 } } });
    expect(deckList('ghost', setup)).toHaveLength(15);
    expect(counts(setup, 'ghost')['Fast Money']).toBe(3);
    expect(counts(setup, 'corp')['Toll Booth']).toBe(2); // the Corp side was left out: built-in plus pack
  });
  it('says exactly what is wrong', () => {
    expect(parsePack('{ nope').ok).toBe(false);
    expect(errorsOf({ cards: [] })).toMatch(/needs a "name"/);
    expect(errorsOf({ name: 'p', cards: [stunt({ onPlay: [{ op: 'teleport' }] })] })).toMatch(/unknown effect "teleport"/);
    expect(errorsOf({ name: 'p', cards: [stunt({ onPlay: [{ op: 'endRun' }] })] })).toMatch(/"endRun" cannot be used here/);
    expect(errorsOf({ name: 'p', cards: [stunt({ colour: 'red' })] })).toMatch(/unknown field "colour"/);
    expect(errorsOf({ name: 'p', cards: [stunt({ type: 'ice' })] })).toMatch(/type must be one of/);
    expect(errorsOf({ name: 'p', cards: [stunt({ subs: [] })] })).toMatch(/a stunt cannot have "subs"/);
    expect(errorsOf({ name: 'p', cards: [stunt({ onPlay: [{ op: 'damage', kind: 'brain', n: 1 }] })] })).toMatch(/kind must be/);
    expect(errorsOf({ name: 'p', cards: [stunt({ onPlay: [{ op: 'run', node: 'any' }, { op: 'gain', n: 1 }] })] })).toMatch(/run must be the last/);
    expect(errorsOf({ name: 'p', cards: [stunt(), stunt()] })).toMatch(/used twice/);
    expect(errorsOf({ name: 'p', cards: [], decks: { ghost: { 'no-such': 20 } } })).toMatch(/no card "no-such"/);
    expect(errorsOf({ name: 'p', cards: [], decks: { ghost: { tripwire: 20 } } })).toMatch(/"tripwire" is a corp card/);
    expect(errorsOf({ name: 'p', cards: [], decks: { ghost: { crowbar: 3 } } })).toMatch(/needs at least 15/);
    expect(errorsOf({ name: 'p', cards: [{ id: 'w', name: 'W', side: 'corp', type: 'ice', copies: 1, cost: 1, text: '' }] })).toMatch(/subtype.*\n.*strength.*\n.*subroutine/);
  });
  it('edited decks export as a pack that loads back to the same decks', () => {
    const setup = setupOf(sample);
    const edited = { ...setup, packName: 'Edited', decks: structuredClone(setup.decks) };
    const pry = setup.cards.find((c) => c.name === 'Pry Bar')!.id;
    edited.decks.ghost[pry] = 4;
    delete edited.decks.ghost.crowbar;
    expect(deckProblems(edited.decks, edited.cards).errors).toEqual([]);
    const back = setupOf(JSON.parse(JSON.stringify(exportPack(edited))));
    expect(counts(back, 'ghost')).toEqual(counts(edited, 'ghost'));
    expect(counts(back, 'corp')).toEqual(counts(edited, 'corp'));
    // the deck pool offers replacements, not the cards they replace, and no identities
    const pool = deckPool(setup, 'ghost');
    expect(pool.filter((c) => c.name === 'Fast Money')).toHaveLength(1);
    expect(pool.some((c) => c.type === 'identity')).toBe(false);
  });
  it('warns about decks that cannot be won on points', () => {
    const r = loadPack({ name: 'p', cards: [], decks: { corp: { tripwire: 3, bulkhead: 3, riddlegate: 3, 'shell-company': 3, 'quarterly-windfall': 3 } } });
    expect(r.ok && r.warnings.join(' ')).toMatch(/project points/);
  });
});

describe('playing with a pack', () => {
  const setup = setupOf(sample);
  it('custom cards follow their data: Market Stall, Smash and Grab, Toll Booth', () => {
    let s = newGame({ seed: 5, human: 'ghost', setup, identities: { ghost: 'halcyon' } });
    s = act(act(s, { type: 'keep' }), { type: 'keep' });
    s = ghostTurn(structuredClone(s), 3);
    const id = (name: string) => setup.cards.find((c) => c.name === name)!.id;
    const pull = (def: string) => {
      const i = s.ghost.deck.findIndex((c) => c.startsWith(`${def}#`));
      return s.ghost.deck.splice(i, 1)[0];
    };
    const stall = pull(id('Market Stall'));
    s.ghost.contacts.push(stall);
    s = act(s, { type: 'use', card: stall });
    expect(s.ghost.credits).toBe(5);
    const grab = pull(id('Smash and Grab'));
    s.ghost.hand.push(grab);
    s = act(s, { type: 'play', card: grab, node: 'dump' });
    expect(s.ghost.credits).toBe(8); // 5 - 1 + 4
    // a Toll Booth on the Mainframe charges 2 at the door
    const booth = s.corp.deck.find((c) => c.startsWith(`${id('Toll Booth')}#`))!;
    s.corp.deck = s.corp.deck.filter((c) => c !== booth);
    nodeOf(s, 'mainframe').upgrades.push({ card: booth, active: true, dev: 0 });
    s.corp.credits = 0;
    s = act(s, { type: 'run', node: 'mainframe' });
    expect(s.ghost.credits).toBe(6);
    expect(cardOf(booth).name).toBe('Toll Booth');
  });
  it('the card definitions travel with the state, so a saved game resumes with them', () => {
    const s = newGame({ seed: 9, human: 'corp', setup });
    const round = JSON.parse(JSON.stringify(s));
    expect(round.setup.cards.length).toBe(setup.cards.length);
    expect(legalActions(round)).toEqual(legalActions(s));
    // the Ghost cannot read the Corp deck list from its view
    expect(viewFor(s, 'ghost').setup.decks.corp).toEqual({});
  });
  it('bots play 40 full games with the sample pack, with no illegal state', () => {
    let fallbacks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulate({
        seed: `pack-${seed}`,
        setup,
        maxSteps: 6000,
        onStep: (x) => {
          const v = violations(x.state);
          if (v.length) throw new Error(`seed ${seed}: ${x.actor} ${x.action.type}: ${v.join('; ')}`);
        },
      });
      expect(r.state.phase, `seed ${seed}`).toBe('gameOver');
      fallbacks += r.fallbacks;
    }
    expect(fallbacks).toBe(0);
  });
  it('random legal play with the sample pack never breaks the rules', () => {
    for (let seed = 1; seed <= 15; seed++) {
      let s = newGame({ seed: `pack-fuzz-${seed}`, human: 'ghost', setup });
      let x = seed * 2654435761;
      for (let step = 0; step < 1200 && s.phase !== 'gameOver'; step++) {
        const legal = legalActions(s);
        x = (Math.imul(x ^ (x >>> 13), 0x5bd1e995) + step) >>> 0;
        const r = apply(s, legal[x % legal.length]);
        if (!r.ok) throw new Error(`seed ${seed}: rejected ${JSON.stringify(legal[x % legal.length])}`);
        expect(violations(r.state)).toEqual([]);
        s = r.state;
      }
    }
  });
  it('the Operator reads the pack cards but not the bot deck list', () => {
    const sys = systemPrompt(newGame({ seed: 4, human: 'ghost', setup }));
    expect(sys).toContain('card pack: Sample pack: Night Market');
    expect(sys).toMatch(/- Market Stall \(ghost contact, ×2/);
    expect(sys).toContain('Toll Booth'); // a card the Corp may have
    expect(sys).not.toMatch(/Toll Booth \(corp upgrade, ×/); // but not how many
  });
  it('actRaw and act agree on pack games', () => {
    const s = newGame({ seed: 3, human: 'ghost', setup });
    expect(actRaw(s, { type: 'keep' })).toEqual(act(s, { type: 'keep' }));
  });
});
