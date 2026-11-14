// Tiny synthesized sound effects (no audio files). Silent until the player has interacted with the page.
import type { GameEvent } from '../engine/types';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqs: number[], step = 0.09, type: OscillatorType = 'triangle', vol = 0.07) {
  const a = audio();
  if (!a) return;
  freqs.forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = f;
    const t = a.currentTime + i * step;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + step * 1.8);
  });
}

export const SOUNDS: Record<string, () => void> = {
  run: () => tone([220, 330, 440], 0.05, 'square', 0.04),
  ice: () => tone([180, 140], 0.08, 'sawtooth', 0.04),
  break: () => tone([880, 1175], 0.04, 'square', 0.03),
  success: () => tone([523, 784], 0.07),
  points: () => tone([523, 659, 784], 0.08),
  damage: () => tone([300, 220, 150], 0.09, 'sawtooth', 0.05),
  heat: () => tone([494, 466], 0.08, 'sine', 0.06),
  gameOver: () => tone([523, 659, 784, 1047], 0.13),
};

const BY_TYPE: Record<string, string> = {
  gameOver: 'gameOver',
  damage: 'damage',
  trap: 'damage',
  steal: 'points',
  score: 'points',
  success: 'success',
  heat: 'heat',
  encounter: 'ice',
  runEnd: 'ice',
  break: 'break',
  run: 'run',
};
const RANK = ['gameOver', 'damage', 'points', 'heat', 'success', 'ice', 'break', 'run'];

/** Which sound (if any) a batch of events makes: the most dramatic wins. */
export function soundFor(events: GameEvent[]): string | null {
  let best: string | null = null;
  for (const e of events) {
    const k = BY_TYPE[e.type];
    if (k && (!best || RANK.indexOf(k) < RANK.indexOf(best))) best = k;
  }
  return best;
}

export function play(name: string | null) {
  if (name) SOUNDS[name]?.();
}
