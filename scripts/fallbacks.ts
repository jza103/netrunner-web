// Lists what makes the bots fall back to a safe default (an illegal choice or a crash), by kind. Usage: npx vite-node scripts/fallbacks.ts [GAMES]
import { botStep } from '../src/bots/driver';
import { chooseAction } from '../src/bots/bot';
import { viewFor } from '../src/engine/view';
import { actor, newGame } from '../src/engine/state';
const seen: Record<string, number> = {};
for (let seed = 0; seed < Number(process.argv[2] ?? 20); seed++) {
  let s = newGame({ seed, human: 'ghost' });
  for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
    const who = actor(s)!;
    const r = botStep(s)!;
    if (r.fallback) {
      let a: unknown; try { a = chooseAction(viewFor(s, who)); } catch (e) { a = String(e); }
      const k = who + ' ' + String(JSON.stringify(a)).slice(0, 120) + ' step=' + (s.run?.step ?? s.phase) + ' win=' + JSON.stringify(s.window) + ' pend=' + !!s.pendingInstall;
      seen[k] = (seen[k] ?? 0) + 1;
    }
    s = r.state;
  }
}
console.log(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 15));
