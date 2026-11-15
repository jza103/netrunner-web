# netrunner-web (Breachline): working rules

Single-player cyber-heist card game on GitHub Pages: the human plays the Ghost or the Corp against a rule-based bot, fully playable offline. An optional Claude "Operator" only narrates and teaches. Read `SPEC.md` (decisions, scope), `README.md` (engine model, rulings) and `reference/RULES.md` (the rules) first.

## Non-negotiables
- **This is an original game.** Do not add card names, card text, identities, factions or art from Netrunner or any other published game. New cards are new designs.
- **The rules are Netrunner's rules.** The point of this app is for Jason to learn and play Netrunner. Only the cards are original; every rule must match the Null Signal Games Netrunner Comprehensive Rules (see `HANDOFF.md` task 2 for the version and the audit). Do not simplify or change a rule. Better-game ideas go to a separate 2.0 project. Describe rules in our own words; do not copy CR text.
- **The engine decides everything.** All state changes go through `apply(state, action)` in `src/engine`. It is pure: no DOM, no mutation of its input, all randomness from the seeded `rngState`.
- **`legalActions` is the single source of truth.** `apply` accepts exactly what it lists. Add a move there first.
- **The Operator never changes game state** and only ever sees `viewFor(state, human)`. Keep the tests that check this.
- **Every card does exactly what its text says.** If a card deviates from its text, fix the engine or fix the text; do not document a shortcut.
- **No AI in rules or bot decisions.** The bot chooses from `legalActions` using only its own view.
- The player is one person (Jason). No multiplayer, accounts or backend. API keys stay in the browser's localStorage and go straight to the provider.

## Workflow
- Run `npm run typecheck && npm test` before every commit (about 20s; includes 500 seeded bot games).
- Every rule or card change gets a unit test. `tests/cards.test.ts` fails if a card in `data/cards.json` has no test block.
- Reproduce engine or bot bugs with `npx vite-node scripts/debug-seed.ts SEED`. Check balance with `npx vite-node scripts/sim.ts 500`.
- Work one task at a time from `HANDOFF.md`, in order. Commit per task with a clear message.
- When a rule is ambiguous, pick the reading closest to the card text and add it to "Rulings and interpretations" in `README.md`. Keep `reference/RULES.md` in step with the engine: the Operator reads it.
- Docker and non-Docker run instructions in `README.md` must stay accurate.
