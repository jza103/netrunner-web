# Handoff

Read `SPEC.md` first. It explains the one big decision: this is **Breachline**, an original game in the Netrunner genre with its own cards, and not a port of System Gateway.

## State at handoff

All milestones in `SPEC.md` are built, plus upgrades, damage kinds, Corp activation during runs and custom card packs. `npm run typecheck` is clean and the full suite passes (see `README.md` Status), including 500 seeded bot-vs-bot games. The app was driven end to end in a headless browser as both sides, at desktop and phone widths, with no page errors; the pack sheet and a game with the sample pack were checked the same way.

**Not verified:**

- A live Operator call. There was no API key in the build environment. The provider code is the munchkin-web GM code with renamed strings, and its unit tests (fake client, fake fetch) pass.
- The GitHub Pages deploy. The workflow is copied from munchkin-web; Pages must be switched to "GitHub Actions" in the repo settings, and the workflow only runs on `main`. All work so far is on branch `claude/netrunner-web-app-y0a3da`.
- Balance against a human. Bot vs bot is roughly even (see below), which says little about how it feels to play.

## Tasks, in order

### 1. Card set and mechanics (done, Nov 2026)
Jason asked for the real System Gateway cards. Claude declined to copy the published game (see `CLAUDE.md`). Jason then chose to close the biggest mechanical gaps and to be able to load his own cards. Done:
- **Cards are data.** Every effect is an `Effect` op (`src/engine/types.ts`), interpreted by `runEffect` in `src/engine/actions.ts`.
- **Upgrades:** Choke Point and Lockout Relay.
- **Corp activation during runs.** The Corp can activate assets and upgrades while the Ghost approaches ICE, and in a new window when the run reaches the node (Watch Desk).
- **Damage kinds:** net, meat and core (Synapse Spike, Flak Vest).
- **Custom card packs:** `src/engine/pack.ts`, the pack sheet on the start screen, `reference/CARD_PACKS.md`, `packs/sample-pack.json`.

Then, at Jason's request, the rest of the gap list was added: identities (Helix Dynamics, Vigil Systems, Wren "Static" Ortiz, Halcyon), traces and link (Scent Tracker, Records Request, Signal Booster), bad publicity (Grey Market Merger, Damage Control, Press Leak), recurring credits (Security Budget, Hot Cache), viruses and purging (Rot Crawler, Termite Script), bypass (Side Door), hosting (Exo Frame), and an in-app deck builder (Cards → Edit decks). All are in the pack format too. Bot-vs-bot after this: Corp about 57%, Ghost 43% (`scripts/sim.ts`).

Follow-ups:
- Decks grew to 61 Corp and 51 Ghost cards; deck size and copy counts are worth tuning together with the bots in task 3.
- The Ghost bot rarely hosts programs on Exo Frame (2 hosted installs in 100 bot games); it only does so when RAM is tight.
- The trace action bar shows one button per amount; with lots of credits that is a long row. A stepper may read better.
- The Ghost bot does not plan for facedown upgrades (it does count active Lockout Relays).
- A pack card that needs a new op cannot be written yet. Each new op needs: the type, `runEffect`, the slot table in `pack.ts`, `effectText`, a test.

### 2. Play it and fix what feels wrong
Play at least three full games as each side on a phone. Things to look at:
- Is the action bar too long as the Corp late in the game (one button per develop/score/activate)?
- Are run decisions clear? The run panel shows the ICE, its subroutines and breaker strengths; the buttons are in the action bar.
- Does the log read well from both sides?

### 3. Bot quality (done, Nov 2026)

**Method.** Each change was measured by playing it against a frozen copy of the previous bot on the same seeds, 300 to 800 games at a time. Single runs of 200 games vary by about ±3 points, and different seed sets by more, so small changes need large samples.

**Ghost:**
- Run planning models facedown ICE and site cards from the Corp pool it has not seen, instead of assuming the worst.
- Central and site runs are valued by the chance of a project.
- It saves up for or digs to missing breakers.
- It keeps a bank of 10 credits before low-value runs. This was the biggest win.
- It keeps its hand out of Burn Notice range. Burn Notice had caused most flatlines.

**Corp:**
- Keeps a reserve to activate the ICE guarding projects.
- Wants 3 ICE on a site with a project.

**Decks** trimmed to 50 Corp cards (22 points) and 45 Ghost cards; every design keeps at least one copy.

**Results:**
- Hard vs Hard, bot-vs-bot: the Ghost wins 56% to 58% (`scripts/sim.ts 500 hard`: 281 of 500). Before this work the Corp won 62% to 68%.
- The Hard Ghost beat the old Ghost's results by about 15 points against the same Corp.

**Levels.** `LEVELS` in `src/bots/bot.ts`; Normal is the default, set on the start screen.

| Hard bot plays | vs Easy | vs Normal | vs Hard |
|---|---|---|---|
| Ghost, wins | 73% | 59% | 58% |
| Corp, wins | 71% | 53% | 42% |

**Things tried that did not help:**
- a bigger Corp bank;
- 2 ICE on empty sites before a project goes in;
- a second central ICE earlier;
- requiring 2 ICE before installing a project, which stalls the Corp completely;
- a run-value bar of 4 or 8 instead of 6.

**Still open:**
- Normal and Hard Corp are close; a Normal Corp could get more careless turns.
- Hard vs Hard now leans Ghost. Whether to rebalance should wait for real games against Jason (task 2), since a human plays the Corp differently from the bot.
- The Corp still never bluffs by leaving a real project undeveloped.
- The Ghost does not count the Corp's cycles for a project installed and scored in one turn. About a third of scores are like that; only central pressure stops them.
- The Ghost rarely hosts programs, and never scraps programs to free RAM.

### 4. Hardening
- The soak test takes about 30 seconds, mostly `structuredClone` of a growing event list. If it gets in the way, cap `events` or move the log out of the cloned state.
- Done: `tests/fuzz.test.ts` plays 60 games of uniformly random legal actions on both sides. It checks the invariants after every step, that `apply` never mutates its input, and that every listed action applies.
- Saved games have no version field beyond the storage key (`breachline:save:v2`, bumped for upgrades, damage kinds and card packs). Bump the key if `GameState` changes shape again.

### 5. Nice to have
- Card art placeholders and a little animation on runs.
- A guided first game (the Operator covers this when a key is set; an offline tutorial would help without one).
- Deck building or a second deck per side.

## Where things are

- Rules in words: `reference/RULES.md`. Rulings: `README.md`. Card pack format: `reference/CARD_PACKS.md`.
- Engine: `src/engine` (start with `legal.ts`, then `actions.ts`; packs in `pack.ts`).
- Bots: `src/bots/bot.ts`. Driver and `simulate`: `src/bots/driver.ts`.
- Operator: prompts in `src/operator/prompt.ts`, providers in `src/operator/providers.ts`, the hook and panel in `src/ui/operator.tsx`.
- UI: `src/ui/App.tsx`, `src/ui/styles.css`.
