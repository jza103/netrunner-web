// Steps bots against the real engine state. A bot only ever sees viewFor(state, its side).
import { apply } from '../engine/actions';
import { isLegal, legalActions } from '../engine/legal';
import { actor, newGame } from '../engine/state';
import { viewFor } from '../engine/view';
import type { Action, GameState, Side } from '../engine/types';
import { chooseAction } from './bot';

export interface StepResult {
  state: GameState;
  actor: Side;
  action: Action;
  /** true when the bot's own choice was illegal or it crashed, and a safe default was used */
  fallback: boolean;
}

const SAFE: Action['type'][] = ['endTurn', 'proceed', 'jackOut', 'leave', 'steal', 'decline', 'keep', 'credit'];

export function botStep(s: GameState, isBot: (side: Side) => boolean = () => true): StepResult | null {
  const who = actor(s);
  if (!who || !isBot(who)) return null;
  let action: Action | undefined;
  let fallback = false;
  try {
    action = chooseAction(viewFor(s, who));
  } catch {
    action = undefined;
  }
  if (!action || !isLegal(s, action)) {
    fallback = true;
    const legal = legalActions(s);
    action = SAFE.map((t) => legal.find((a) => a.type === t)).find(Boolean) ?? legal[0];
  }
  const r = apply(s, action);
  if (!r.ok) throw new Error(`No legal fallback for ${who}: ${r.error}`);
  return { state: r.state, actor: who, action, fallback };
}

export interface SimOptions {
  seed: number | string;
  maxSteps?: number;
  onStep?: (r: StepResult) => void;
}

/** Play a whole game with both seats run by bots. */
export function simulate(opts: SimOptions): { state: GameState; steps: number; fallbacks: number } {
  let s = newGame({ seed: opts.seed, human: 'ghost' });
  let steps = 0;
  let fallbacks = 0;
  const max = opts.maxSteps ?? 20000;
  while (s.phase !== 'gameOver' && steps < max) {
    const r = botStep(s)!;
    s = r.state;
    steps++;
    if (r.fallback) fallbacks++;
    opts.onStep?.(r);
  }
  return { state: s, steps, fallbacks };
}
