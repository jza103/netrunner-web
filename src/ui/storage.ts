// Save and resume in the browser. Every read and write is guarded: storage can be unavailable.
import { ensureCards } from '../engine/cards';
import type { BotLevel } from '../bots/bot';
import type { GameSetup, GameState } from '../engine/types';

/**
 * Saves are { format, state }. Bump SAVE_FORMAT whenever GameState changes shape; tests/save.test.ts
 * fails until you do. A save in another format, or whose state does not have the current shape,
 * is set aside instead of crashing the app.
 */
export const SAVE_FORMAT = 3;
const KEY = 'breachline:save';
/** where saves lived before the format field (format 2) */
const LEGACY_KEY = 'breachline:save:v2';
const SETTINGS = 'breachline:settings:v1';
const PACK = 'breachline:pack:v1';

export interface Settings {
  speed: 'slow' | 'normal' | 'fast' | 'instant';
  /** how well the bot plays */
  level: BotLevel;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = { speed: 'normal', sound: true, level: 'normal' };

/** The field names that make up a state's shape, for checking saves. Maps keyed by card id are not looked into. */
export function stateShape(s: unknown): string {
  const o = s as Record<string, Record<string, unknown>> | null;
  if (!o || typeof o !== 'object') return '';
  const keys = (x: unknown) => (x && typeof x === 'object' ? Object.keys(x).sort().join(',') : '-');
  const nodes = (o.corp?.nodes as unknown[] | undefined) ?? [];
  return [
    `state:${keys(o)}`,
    `corp:${keys(o.corp)}`,
    `ghost:${keys(o.ghost)}`,
    `flags:${keys(o.flags)}`,
    `setup:${keys(o.setup)}`,
    `node:${keys(nodes[0])}`,
  ].join(' | ');
}

let currentShape = '';
/** Set once from a fresh game, so the check always matches the code that is running. */
export function setCurrentShape(shape: string) {
  currentShape = shape;
}

export type LoadResult = { state: GameState | null; discarded?: string };

/** Read a saved game from its stored text. Pure, so it can be tested. */
export function parseSave(raw: string | null, legacy = false): LoadResult {
  if (!raw) return { state: null };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: null, discarded: 'The saved game could not be read.' };
  }
  const box = data as { format?: number; state?: GameState };
  const state = legacy ? (data as GameState) : box.state;
  if (!legacy && box.format !== SAVE_FORMAT) return { state: null, discarded: 'Your saved game is from an older version of Breachline and cannot be resumed.' };
  if (!state || typeof state.gameId !== 'string' || (currentShape && stateShape(state) !== currentShape))
    return { state: null, discarded: 'Your saved game is from an older version of Breachline and cannot be resumed.' };
  ensureCards(state);
  return { state };
}

export function loadGame(): LoadResult {
  try {
    const now = localStorage.getItem(KEY);
    if (now) return parseSave(now);
    const old = localStorage.getItem(LEGACY_KEY);
    if (!old) return { state: null };
    // carry an old save over when it still fits; either way the old key goes
    const r = parseSave(old, true);
    localStorage.removeItem(LEGACY_KEY);
    if (r.state) saveGame(r.state);
    return r;
  } catch {
    return { state: null };
  }
}

export function saveGame(s: GameState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify({ format: SAVE_FORMAT, state: s }));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked: the game still works, it just won't resume */
  }
}

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const SPEED_MS: Record<Settings['speed'], number> = { slow: 1500, normal: 800, fast: 300, instant: 0 };

/** The card pack chosen for new games (already checked), or null for the built-in set. */
export function loadPackSetup(): GameSetup | null {
  try {
    const raw = localStorage.getItem(PACK);
    if (!raw) return null;
    const p = JSON.parse(raw) as GameSetup;
    if (!p || !Array.isArray(p.cards) || !p.decks) return null;
    ensureCards({ setup: p });
    return p;
  } catch {
    return null;
  }
}

export function savePackSetup(p: GameSetup | null) {
  try {
    if (p) localStorage.setItem(PACK, JSON.stringify(p));
    else localStorage.removeItem(PACK);
  } catch {
    /* ignore: the pack still works for this session */
  }
}
