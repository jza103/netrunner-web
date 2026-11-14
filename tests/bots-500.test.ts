// 500 seeded bot-vs-bot games with no illegal states.
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/bots/driver';
import { violations } from '../src/engine/invariants';
import { isLegal, legalActions } from '../src/engine/legal';
import { apply } from '../src/engine/actions';

describe.each([0, 1, 2, 3, 4])('seed block %i (100 games)', (block) => {
  it('every game ends with a winner and no illegal state', () => {
    let fallbacks = 0;
    for (let i = 0; i < 100; i++) {
      const seed = block * 100 + i + 1;
      const r = simulate({
        seed,
        maxSteps: 5000,
        onStep: (x) => {
          const v = violations(x.state);
          if (v.length) throw new Error(`seed ${seed}: ${x.actor} ${x.action.type}: ${v.join('; ')}`);
        },
      });
      expect(r.state.phase, `seed ${seed}`).toBe('gameOver');
      expect(r.state.winner).not.toBeNull();
      fallbacks += r.fallbacks;
    }
    expect(fallbacks).toBe(0);
  });
});

describe('legalActions and apply agree', () => {
  it('every listed action applies, and the state always offers a move', () => {
    for (let seed = 900; seed < 920; seed++) {
      simulate({
        seed,
        onStep: (x) => {
          if (x.state.phase === 'gameOver') return;
          const legal = legalActions(x.state);
          expect(legal.length, `seed ${seed}: no legal action`).toBeGreaterThan(0);
          for (const a of legal) {
            const r = apply(x.state, a);
            expect(r.ok, `seed ${seed}: ${JSON.stringify(a)}`).toBe(true);
            if (r.ok) expect(violations(r.state)).toEqual([]);
          }
          expect(isLegal(x.state, { type: 'run', node: 'nowhere' })).toBe(false);
        },
      });
    }
  });
});

describe('bot levels', () => {
  it.each(['easy', 'normal'] as const)('%s bots finish 60 games with no illegal state or fallback', (level) => {
    let fallbacks = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = simulate({
        seed: `${level}-${seed}`,
        level,
        maxSteps: 6000,
        onStep: (x) => {
          const v = violations(x.state);
          if (v.length) throw new Error(`seed ${seed}: ${v.join('; ')}`);
        },
      });
      expect(r.state.phase).toBe('gameOver');
      fallbacks += r.fallbacks;
    }
    expect(fallbacks).toBe(0);
  });
  it('the same view and level always give the same choice', () => {
    const r = simulate({ seed: 'repeat', level: 'easy', maxSteps: 300 });
    const again = simulate({ seed: 'repeat', level: 'easy', maxSteps: 300 });
    expect(again.state).toEqual(r.state);
  });
});
