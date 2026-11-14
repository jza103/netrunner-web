// Seeded randomness. All of it flows from state.rngState, so games replay exactly.
import type { GameState } from './types';

export function seedFrom(seed: number | string): number {
  if (typeof seed === 'number') return seed >>> 0 || 1;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

/** mulberry32: returns a float in [0, 1) and advances the state. */
export function rand(s: { rngState: number }): number {
  s.rngState = (s.rngState + 0x6d2b79f5) >>> 0;
  let t = s.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s: { rngState: number }, n: number): number {
  return Math.floor(rand(s) * n);
}

export function shuffle<T>(s: GameState | { rngState: number }, list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
}
