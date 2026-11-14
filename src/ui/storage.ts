// Save and resume in the browser. Every read and write is guarded: storage can be unavailable.
import type { GameState } from '../engine/types';

const KEY = 'breachline:save:v1';
const SETTINGS = 'breachline:settings:v1';

export interface Settings {
  speed: 'slow' | 'normal' | 'fast' | 'instant';
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = { speed: 'normal', sound: true };

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    return s && s.corp && s.ghost && typeof s.gameId === 'string' ? s : null;
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
