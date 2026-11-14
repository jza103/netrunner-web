// Replay a debug report copied from the app's "The game hit a bug" screen:
//   npx vite-node scripts/debug-report.ts report.json
// Prints the error, whose move it is, the legal moves, and runs the bot's next step with a full stack.
import { readFileSync } from 'node:fs';
import { botStep } from '../src/bots/driver';
import { ensureCards } from '../src/engine/cards';
import { violations } from '../src/engine/invariants';
import { legalActions } from '../src/engine/legal';
import { actor } from '../src/engine/state';
import type { GameState } from '../src/engine/types';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { error: string; state: GameState };
const s = report.state;
ensureCards(s);
console.log('reported error:', report.error.split('\n')[0]);
console.log(`game ${s.gameId}, turn ${s.turnNumber}, phase ${s.phase}${s.run ? `, run step ${s.run.step}` : ''}, to act: ${actor(s)}`);
console.log('last events:', s.events.slice(-6).map((e) => e.text));
console.log('invariant problems:', violations(s));
try {
  console.log('legal moves:', legalActions(s));
  const r = botStep(s);
  console.log('bot step:', r ? r.action : 'none (game over)');
} catch (e) {
  console.error('reproduced:', e);
}
