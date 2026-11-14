// Bot-vs-bot statistics: npx vite-node scripts/sim.ts [GAMES]
import { simulate } from '../src/bots/driver';
import { points } from '../src/engine/state';

const games = Number(process.argv[2] ?? 200);
const wins: Record<string, number> = {};
let turns = 0;
let fallbacks = 0;
let unfinished = 0;
for (let seed = 1; seed <= games; seed++) {
  const r = simulate({ seed });
  if (r.state.phase !== 'gameOver') unfinished++;
  const key = `${r.state.winner}: ${r.state.winReason.replace(/\d+ project/, 'N project')}`;
  wins[key] = (wins[key] ?? 0) + 1;
  turns += r.state.turnNumber;
  fallbacks += r.fallbacks;
  void points;
}
console.log({ games, wins, avgTurns: (turns / games).toFixed(1), fallbacks, unfinished });
