// End-of-game recap without AI: the events that moved the score or hurt.
import { eventText } from '../engine/view';
import type { GameState } from '../engine/types';

const KEY_TYPES = new Set(['steal', 'score', 'trap', 'heist', 'damage']);

export function recap(s: GameState, max = 5): string[] {
  const key = s.events.filter((e) => KEY_TYPES.has(e.type));
  const over = s.events.find((e) => e.type === 'gameOver');
  const picked = key.slice(-max).map((e) => eventText(e, s.human));
  return over ? [...picked, over.text] : picked;
}
