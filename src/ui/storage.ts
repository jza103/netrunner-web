// Save and resume in the browser. Every read and write is guarded: storage can be unavailable.
import { ensureCards } from '../engine/cards';
import type { BotLevel } from '../bots/bot';
import type { GameSetup, GameState } from '../engine/types';

const KEY = 'breachline:save:v2'; // v2: upgrades, damage kinds, card packs
const SETTINGS = 'breachline:settings:v1';
const PACK = 'breachline:pack:v1';

export interface Settings {
  speed: 'slow' | 'normal' | 'fast' | 'instant';
  /** how well the bot plays */
  level: BotLevel;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = { speed: 'normal', sound: true, level: 'normal' };

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (!(s && s.corp && s.ghost && s.setup && typeof s.gameId === 'string')) return null;
    ensureCards(s);
    return s;
  } catch {
    return null;
  }
}

export function saveGame(s: GameState | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
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
