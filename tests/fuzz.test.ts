// Fuzz: both seats pick uniformly random legal actions, so the engine sees lines the bots never choose.
import { describe, expect, it } from 'vitest';
import { apply } from '../src/engine/actions';
import { violations } from '../src/engine/invariants';
import { legalActions } from '../src/engine/legal';
import { newGame } from '../src/engine/state';

/** A separate PRNG for the fuzzer, so its choices never touch the game's rngState. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('random legal play', () => {
  it('never reaches an illegal state, a dead end, or a rejected listed action', () => {
    let finished = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const pick = mulberry(seed * 7919);
      let s = newGame({ seed: `fuzz-${seed}`, human: seed % 2 ? 'ghost' : 'corp' });
      for (let step = 0; step < 1500 && s.phase !== 'gameOver'; step++) {
        const legal = legalActions(s);
        expect(legal.length, `seed ${seed} step ${step}: no legal action`).toBeGreaterThan(0);
        const action = legal[Math.floor(pick() * legal.length)];
        const before = JSON.stringify(s);
        const r = apply(s, action);
        expect(JSON.stringify(s), `seed ${seed}: apply mutated its input`).toBe(before);
        if (!r.ok) throw new Error(`seed ${seed} step ${step}: listed action rejected: ${JSON.stringify(action)}: ${r.error}`);
        const v = violations(r.state);
        if (v.length) throw new Error(`seed ${seed} step ${step}: ${JSON.stringify(action)}: ${v.join('; ')}`);
        s = r.state;
      }
      if (s.phase === 'gameOver') {
        expect(s.winner).not.toBeNull();
        finished++;
      }
    }
    // random play is aimless, but some games should still end
    expect(finished).toBeGreaterThan(0);
  });
});
