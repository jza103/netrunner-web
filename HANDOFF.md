# Handoff

Read `SPEC.md` first. It explains the one big decision: this is **Breachline**, an original game in the Netrunner genre with its own cards, and not a port of System Gateway.

## State at handoff

All milestones in `SPEC.md` are built. `npm run typecheck` is clean and 101 tests pass, including 500 seeded bot-vs-bot games. The app was driven end to end in a headless browser as both sides, at desktop and phone widths, with no page errors.

**Not verified:**

- A live Operator call. There was no API key in the build environment. The provider code is the munchkin-web GM code with renamed strings, and its unit tests (fake client, fake fetch) pass.
- The GitHub Pages deploy. The workflow is copied from munchkin-web; Pages must be switched to "GitHub Actions" in the repo settings, and the workflow only runs on `main`. All work so far is on branch `claude/netrunner-web-app-y0a3da`.
- Balance against a human. Bot vs bot is roughly even (see below), which says little about how it feels to play.

## Tasks, in order

### 1. Decide the card set with Jason
The request was for System Gateway cards; what exists is an original 40-design set. Ask Jason whether he wants to keep Breachline as is, or change the card pool. Any new card must be an original design (see `CLAUDE.md`). Adding a card is: an entry in `data/cards.json`, its effect in `src/engine/actions.ts` (and `legal.ts` if it needs a target or a condition), a test block in `tests/cards.test.ts`, and a line of bot handling in `src/bots/bot.ts`.

### 2. Play it and fix what feels wrong
Play at least three full games as each side on a phone. Things to look at:
- Is the action bar too long as the Corp late in the game (one button per develop/score/activate)?
- Are run decisions clear? The run panel shows the ICE, its subroutines and breaker strengths; the buttons are in the action bar.
- Does the log read well from both sides?

### 3. Bot quality
`npx vite-node scripts/sim.ts 500` shows wins by reason. Known weaknesses:
- **Corp bot** always activates ICE when approached (except over a Decoy Lab or an empty site) and does not hold credits back for it. It never bluffs by leaving a real project undeveloped.
- **Ghost bot** treats every facedown ICE as a worst-case hunter, so it is cautious with a small hand. It does not use Salvage for gear, never scraps programs, and does not count the Corp's cycles to predict a score.
- Neither bot has difficulty levels. A simple "easy" level could skip the lethal Burn Notice check and the face-check maths.

### 4. Hardening
- The soak test takes about 30 seconds, mostly `structuredClone` of a growing event list. If it gets in the way, cap `events` or move the log out of the cloned state.
- Add a fuzz test with random (not bot) legal actions on both sides; the bots only reach the lines they like.
- Saved games have no version field beyond the storage key (`breachline:save:v1`). Bump the key if `GameState` changes shape.

### 5. Nice to have
- Card art placeholders and a little animation on runs.
- A guided first game (the Operator covers this when a key is set; an offline tutorial would help without one).
- Deck building or a second deck per side.

## Where things are

- Rules in words: `reference/RULES.md`. Rulings: `README.md`.
- Engine: `src/engine` (start with `legal.ts`, then `actions.ts`).
- Bots: `src/bots/bot.ts`. Driver and `simulate`: `src/bots/driver.ts`.
- Operator: prompts in `src/operator/prompt.ts`, providers in `src/operator/providers.ts`, the hook and panel in `src/ui/operator.tsx`.
- UI: `src/ui/App.tsx`, `src/ui/styles.css`.
