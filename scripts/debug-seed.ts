// Print one bot-vs-bot game: npx vite-node scripts/debug-seed.ts SEED
import { simulate } from '../src/bots/driver';
import { violations } from '../src/engine/invariants';

const seed = Number(process.argv[2] ?? 1);
const r = simulate({
  seed,
  onStep: (x) => {
    const v = violations(x.state);
    if (v.length) console.log('!! VIOLATION', v, JSON.stringify(x.action));
    if (x.fallback) console.log('!! FALLBACK', x.actor, JSON.stringify(x.action));
  },
});
for (const e of r.state.events) console.log(`${e.seq}. ${e.priv ? e.priv.text.replace(/^You/, e.priv.side) : e.text}`);
console.log({ steps: r.steps, fallbacks: r.fallbacks, winner: r.state.winner, reason: r.state.winReason });
