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
- Decks grew to 61 Corp and 51 Ghost cards; deck size and copy counts are worth tuning together with the bots in task 4.
- The Ghost bot rarely hosts programs on Exo Frame (2 hosted installs in 100 bot games); it only does so when RAM is tight.
- The trace action bar is now a stepper (task 2.11).
- The Ghost bot does not plan for facedown upgrades (it does count active Lockout Relays).
- A pack card that needs a new op cannot be written yet. Each new op needs: the type, `runEffect`, the slot table in `pack.ts`, `effectText`, a test.

### 2. Match the Netrunner rules (audit done Nov 2026; fixes pending)

**Goal change.** This app exists so Jason can learn and play Netrunner. Only the cards are original: the rules must match the Null Signal Games *Netrunner Comprehensive Rules* (CR), v26.03, public at https://nullsignal.games/rules/comp-rules/. Breachline keeps its own names for things (see the glossary item below), but every rule must work the way the CR says. Write rules in our own words; never paste CR text into the repo. Rule changes that might make a better game go to a separate 2.0 project, not here.

The audit compared the CR with `src/engine` (`legal.ts`, `actions.ts`, `state.ts`), `reference/RULES.md` and the README rulings. Fix the items below in order, one commit each, each with a unit test; update `reference/RULES.md`, the README rulings that encode the old behaviour, and the bots as needed; rerun `scripts/sim.ts 500` after each run-structure change. CR numbers are given so each fix can be checked against the source.

**Runs**

- [x] **2.1 Jack out at every movement step** (CR 6.6.3, 6.9.4c). The Runner may jack out after passing *any* ICE position, including ICE the Corp did not or could not rez, and also on a run with no ICE at all, before the Corp's last rez window and the approach to the server. Now: `advanceRun` slips past inactive or unaffordable ICE with no stop, and a run with no ICE goes straight to `approachNode` (README rulings 3 and 4). Fix: after every position, go to a `passed` step offering continue or jack out; drop rulings 3 and 4.
- [x] **2.2 Corp rez windows during a run** (CR 6.9.1e, 6.9.2b, 6.9.4e). The Corp may rez assets and upgrades in the initiation window, in every approach window whether or not it can pay for that ICE, and after the Runner moves inward. Now: no initiation window, and no approach window at all when the ICE is unaffordable (`advanceRun`). Fix: open the window every time (the Corp's ICE option appears only if it can pay). This also keeps the windows from leaking whether the Corp can pay.
- [x] **2.3 Corp rezzes outside its own turn** (CR 5.6.3b, 5.7.1b, 5.7.1e, 5.7.2b). The Corp may rez non-ICE cards at the start of the Runner's turn, before each Runner action and in both discard phases. Now: only in its own action phase and the two run windows (ruling 2). Fix: add Corp windows to the Runner's turn. To keep play quick, the app can skip the prompt when the Corp has nothing it could rez, as long as that tells the Ghost nothing it could not already see.
- [x] **2.4 Runner paid abilities in every paid ability window** (CR 9.2, 6.9.x windows, 5.6.x and 5.7.x). Abilities that cost no cycle can be used on either turn and during runs. Now: no-cycle abilities only on the Ghost's own turn, outside runs (`ghostTurn`). Today only one card has one, but packs will have more.

**Access**

- [x] **2.5 The Runner chooses the access order** (CR 7.3.4, 7.4.1). In a breach, each card in the node's root (upgrades included) and the central-zone candidates are chosen one at a time by the Runner: a specific root card, or "a random card from hand" for Command, or the next card down for Mainframe. Now: the central cards first, then upgrades, in a fixed order (`beginAccess`, ruling 23).
- [x] **2.6 Every card in the Dump is accessed** (CR 7.3.2, 7.4.1d). All cards there are turned faceup and each one is accessed, not only projects. Cards in the Dump still cannot be trashed (CR 7.1.5b). Now: only projects are queued (ruling 9). This matters for "when accessed" abilities and any card that counts accesses.

**Installing**

- [x] **2.7 Trashing ICE when installing ICE** (CR 8.5.6b). Before paying, the Corp may trash any number of ICE protecting that node, and those do not count toward the install cost. Now: impossible (ruling 18).
- [x] **2.8 Trashing root cards when installing** (CR 8.5.6a). When installing into a site's root (or an upgrade into any node), the Corp may first trash any cards in that root; a new project or asset must replace any old project or asset. Now: only the forced replacement exists; upgrades can never be trashed this way.
- [x] **2.9 No ICE or site limits** (CR 3.6.2, 4.6, 8.5.2a). Any number of ICE per node and any number of sites. Now: `MAX_ICE = 5`, `MAX_SITES = 6` in `types.ts` (rulings 18 and 19). The board UI must handle long ICE stacks and many sites on a phone.
- [x] **2.10 Programs are trashed only while installing a program** (CR 8.5.6c, 3.9.3b-c). The Runner may trash any installed programs as part of installing a program, and must if RAM would be exceeded. If RAM ever drops below what is in use, the Runner trashes programs at the next checkpoint. There is no free "scrap" action. Now: `scrap` any time on the Ghost's turn, and installing needs free RAM first. Fix: replace `scrap` with an install option that names the programs to trash; add the RAM-drop rule (today no card lowers RAM, but packs can).

**Traces**

- [x] **2.11 No trace limits** (CR 10.8.2-3). The Corp may spend any amount and so may the Runner. Now: the Corp is capped at 15 and the Ghost is offered only enough to match (`traceActions`, ruling 29). Use a stepper in the UI (see the task 1 follow-up) so large amounts stay usable.

**Turn structure**

- [x] **2.12 Corp turn order** (CR 5.6.1). Gain clicks, a paid ability window, refill recurring credits, the turn formally begins (start-of-turn abilities), then the mandatory draw; the Runner wins if that draw cannot happen. Now: `startTurn` checks for an empty Mainframe and draws *before* refills and start-of-turn effects. Fix the order and test that a start-of-turn effect resolves before the draw.

**Damage and wording**

- [x] **2.13 Damage trashes cards** (CR 10.4.2, 1.19.3, 5.5.2b). Damage *trashes* random cards from the grip; it is not a discard, and the difference matters to card text. Now: `reference/RULES.md` and the log say "discard". Fix the wording, and make sure any "when trashed" or "when discarded" effect sees the right one.
- [x] **2.14 Breaker types in `reference/RULES.md`** (CR 3.9.5h). A breaker that names no ICE type works on any ICE. The engine already does this (Jackknife), but RULES.md says a breaker only works on its own type. Docs fix only.

**Deck construction** (CR 1.4)

- [x] **2.15 Deck limits.** At most 3 copies of a card; the identity sets the minimum deck size (usually 40 or 45); a Corp deck needs 2 × (deck size ÷ 5, rounded down) + 2 or + 3 project points, e.g. 22 or 23 for 50 to 54 cards. Factions and influence stay out of scope (SPEC). Now: 15 to 120 cards and up to 9 copies, with only a warning for points. The built-in decks already fit (50 Corp cards with 22 points, 45 Ghost cards, at most 3 copies). Add a minimum deck size to identities, enforce the limits in the deck builder and in pack checks, and update `reference/CARD_PACKS.md`.

**Engine limits that block faithful card designs** (not rule differences, but they keep pack cards from working like real Netrunner cards)

- [ ] **2.16 Breaker abilities.** Support the usual patterns: break up to N subroutines for a cost, break all, boost by N, boosts that last for the rest of the run (CR 3.9.5b-c), and several abilities on one breaker. Now: one fixed boost and a fixed per-subroutine break (`breaker` in `types.ts`).
- [ ] **2.17 ICE and run triggers.** "When approached", "when encountered", "when passed", "when the run ends" and "when a run is successful" abilities (CR 6.4.2, 6.5.2, 6.9.4a, 6.8.5), ICE with no subroutines (CR 6.5.7c), and "if successful" run effects. Add `Effect` hooks for them in the pack format.

**Glossary**

- [ ] **2.18 In-app glossary.** A Help page that maps Breachline terms to the Netrunner terms Jason will meet at a real table: cycle → click, activate → rez, develop → advance, project → agenda, Command → HQ, Mainframe → R&D, Dump → Archives, site → remote server, Ghost → Runner, heat → tag, contact → resource, gear → hardware, stunt → event, directive → operation, Scrapheap → heap, wall / cipher / hunter → barrier / code gate / sentry, trap → ambush, core damage → core (brain) damage. Give the Operator the same table so it can teach both names.

**Checked and already matching:** 3 and 4 clicks with every click spent; basic actions and their costs, including purge for 3 clicks and trashing a resource or removing a tag for 1 click and 2 credits while tagged; ICE install cost; rez ICE only on approach; strength rule for breakers and encounter-long boosts; subroutines resolve in order and end the run stops the rest; bypass; access of Command (random), Mainframe (from the top) and stealing; steal costs; trash costs and no trashing from the Dump; scoring only on the Corp's own turn, for no click; advancing; mulligans (Corp first); 5 credits and 5 cards to start; maximum hand size 5 and discarding at the end of each turn, Corp discards facedown; win at 7 points, by flatline, or when the Corp cannot draw; core damage and a maximum hand size below 0; bad publicity credits for one run; recurring credits; virus counters and purging; traces won only by exceeding link.

### 3. Play it and fix what feels wrong (after task 2)
Play at least three full games as each side on a phone. Things to look at:
- Is the action bar too long as the Corp late in the game (one button per develop/score/activate)?
- Are run decisions clear? The run panel shows the ICE, its subroutines and breaker strengths; the buttons are in the action bar.
- Does the log read well from both sides?

### 4. Bot quality (done, Nov 2026)

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
- Hard vs Hard now leans Ghost. Whether to rebalance should wait for real games against Jason (task 3), since a human plays the Corp differently from the bot.
- The Corp still never bluffs by leaving a real project undeveloped.
- The Ghost does not count the Corp's cycles for a project installed and scored in one turn. About a third of scores are like that; only central pressure stops them.
- The Ghost rarely hosts programs, and never scraps programs to free RAM.

### 5. Hardening (done, Nov 2026)
- **Speed.** `npm test` went from about 49 to 18 seconds. Copies of the state now share the event log and the card setup, which are never changed once written; each copy gets its own events array. A test pins this down, and the fuzz test still checks that `apply` never changes its input.
- **Fuzzing.** `tests/fuzz.test.ts` plays 60 games of random legal actions with the built-in set; `tests/pack.test.ts` does the same with the sample pack.
- **Saves.** Saves are `{ format, state }` under `breachline:save`, with `SAVE_FORMAT` in `src/ui/storage.ts`.
  - Loading checks the format and the state's shape. A save that does not fit is set aside, with a notice on the start screen.
  - An old `breachline:save:v2` save is carried over if it still fits, and the old key is removed.
  - `tests/save.test.ts` fails when `GameState` changes shape without a `SAVE_FORMAT` bump.
- **Crashes.** An engine, bot or render error now shows a recovery screen instead of a blank page. It has a copyable debug report (error plus full state) and a new-game button.
  - `npx vite-node scripts/debug-report.ts report.json` replays a report.

### 6. Nice to have
- Card art placeholders and a little animation on runs.
- A guided first game (the Operator covers this when a key is set; an offline tutorial would help without one).
- Deck building or a second deck per side.

## Where things are

- Rules in words: `reference/RULES.md`. Rulings: `README.md`. Card pack format: `reference/CARD_PACKS.md`.
- Engine: `src/engine` (start with `legal.ts`, then `actions.ts`; packs in `pack.ts`).
- Bots: `src/bots/bot.ts`. Driver and `simulate`: `src/bots/driver.ts`.
- Operator: prompts in `src/operator/prompt.ts`, providers in `src/operator/providers.ts`, the hook and panel in `src/ui/operator.tsx`.
- UI: `src/ui/App.tsx`, `src/ui/styles.css`.
