# Handoff

Read `SPEC.md` first (it explains why this is an original game, *Breachline*, and not a System Gateway port).

## State right now

- Done: card data (`data/cards.json`), the engine (`src/engine`), both bots (`src/bots`), sim scripts, the 500-game soak test.
- Not done yet: UI, the Operator (files copied from munchkin-web's GM are in `src/operator` and `src/ui/operator.tsx` but not yet adapted, so `npm run typecheck` fails on them), unit tests per card, README, rules reference.

## Next, in order

1. `reference/RULES.md`: write the rules out.
2. Unit tests for every card and rule (`tests/`).
3. UI in `src/ui` (Preact), with save and resume.
4. Adapt the Operator from the munchkin GM files.
5. README with Docker and non-Docker run steps; check the Pages workflow.
