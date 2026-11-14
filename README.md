# Breachline

A single-player cyber-heist card game in the browser. You play the **Ghost** (a hacker running the Corp's nodes to steal its projects) or the **Corp** (hiding projects behind ICE and scoring them) against a rule-based bot. It runs entirely from static files and works offline. An optional AI voice, the **Operator**, narrates and teaches; it never changes the game.

Breachline is an original game with its own cards and rules. It is in the same genre as asymmetric hacking card games, but it is not a port of any of them. `SPEC.md` explains that decision.

- Rules: `reference/RULES.md` (also in the app under 📖)
- Cards: `data/cards.json` (40 designs; 45-card Corp deck, 40-card Ghost deck)
- Decisions and scope: `SPEC.md`
- What is left: `HANDOFF.md`

## Run it

**With Docker**

```
docker compose up
# open http://localhost:5173/netrunner-web/
```

**Without Docker**

1. Install Node 22 LTS
2. `npm ci`
3. `npm run dev` and open http://localhost:5173/netrunner-web/
4. `npm test` runs every test (about 35 seconds; it includes 500 bot-vs-bot games)
5. `npm run build` writes the static site to `dist/`

**Deploy.** `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` (it runs the tests first). In the repo settings, set Pages → Source to "GitHub Actions". The site lands at `https://jza103.github.io/netrunner-web/`.

**As a claude.ai artifact.** `npm run build:artifact` writes the artifact page and its assets to `dist-artifact/`. Published as an artifact with the `sample` capability, the Operator can use the viewer's own Claude plan with no key.

## How to play (short version)

- First to 7 project points wins. The Corp scores projects by developing them; the Ghost steals them by running.
- The Corp has 3 cycles a turn, the Ghost 4. A cycle buys a credit, a card, an install, a card play or (for the Ghost) a run.
- ICE protects nodes. The Corp installs it facedown and pays to activate it when the Ghost runs into it. The Ghost needs a breaker of the matching type (wall, cipher, hunter) to break its subroutines.
- Damage makes the Ghost discard at random; more damage than cards in hand is a loss. Heat on the Ghost powers the Corp's nastiest cards.

In the app: tap any card to read it and see what you can do with it. The bar at the bottom lists every other legal move. The engine only ever offers legal moves.

## The Operator (optional AI)

Off by default. Turn it on from the new-game screen or the 🎧 button. It can use:

- **Claude on claude.ai**, when the app runs as a claude.ai artifact (no key)
- **An OpenRouter API key**
- **An Anthropic API key**

Keys are stored only in this browser's localStorage and are sent only to the provider you pick. The Operator gets the engine's event log and *your side's view* of the table. It never sees the other hand, the decks or facedown cards you have not looked at (there are tests for this), and it has no way to change the game.

## Engine model

```
src/engine/
  types.ts       state, actions, events (plain JSON)
  cards.ts       card lookup; instances are "<defId>#<n>"
  state.ts       newGame and read-only helpers (actor, points, ramLimit, …)
  legal.ts       legalActions(state): the single source of truth for what may be done
  actions.ts     apply(state, action) → { ok, state } | { ok: false, error }
  view.ts        viewFor(state, side): hides what that side may not know
  invariants.ts  violations(state): card conservation and other must-holds
  rng.ts         seeded randomness (state.rngState)
```

- `apply` is pure. It clones the state, never touches its input, and takes all randomness from `rngState`, so a seed replays exactly.
- `apply` accepts exactly the actions `legalActions` lists. Anything else returns a plain-language reason.
- `actor(state)` says whose decision it is. Runs interleave both sides: the Corp chooses whether to activate ICE (and which program a subroutine trashes); the Ghost chooses everything else.
- The UI draws only from `viewFor(state, human)`, and the bot is only ever handed `viewFor(state, botSide)`.

Debugging: `npx vite-node scripts/debug-seed.ts SEED` prints a full bot-vs-bot game; `npx vite-node scripts/sim.ts 500` prints win statistics.

## Rulings and interpretations

Where the rules or a card could be read two ways, this is what the engine does.

1. **Every cycle must be spent.** You cannot end the turn early; taking a credit is always available.
2. **Activation timing.** The Corp activates ICE only when the Ghost approaches it during a run. It activates assets and upgrades (not traps) on its own turn (no cycle), or during a run: in the window when the Ghost approaches a piece of ICE it could activate, and in the window when the run gets past all ICE and reaches the node. The node window always happens, even when the Corp has nothing it could activate, so its existence gives nothing away.
3. **Unaffordable ICE.** If the Corp cannot pay for inactive ICE (or Blackout is in effect) the Ghost passes it with no prompt to either side and no jack-out point.
4. **Jack-out points.** The Ghost may jack out only right after getting past ICE it encountered, including the last one before access.
5. **Boosts** last for one encounter. They do not carry to the next ICE.
6. **Subroutine order.** Unbroken subroutines fire top to bottom; an "end the run" stops the rest.
7. **"The Corp trashes 1 installed program"**: the Corp chooses. With one program there is no choice; with none nothing happens.
8. **Command access** is one random card from the Corp's hand. **Mainframe access** is the top card; with more accesses, the next cards down, in order. Cards not stolen or trashed stay where they are in the same order.
9. **Dump access** turns the whole Dump faceup, and every project in it is stolen. Cards already in the Dump cannot be trashed again.
10. **Trash costs.** Only cards with a trash cost (assets) can be trashed on access, from anywhere except the Dump.
11. **Decoy Lab** fires only when accessed while installed in a site, not from Command or the Mainframe. Its damage lands before the Ghost decides whether to trash it. It cannot be activated; it turns faceup when it fires.
12. **Blacksite Ledger.** If the Ghost cannot or will not pay 3, the card stays exactly where it was (and, if it was facedown in a site, the Ghost now knows what it is).
13. **Padded Rig** prevents the first 1 net damage in each turn, the Ghost's and the Corp's alike. Two Rigs prevent 2 per turn. **Flak Vest** works the same way for meat damage. Prevention never applies to core damage.
14. **Packet Skimmer** pays on the first successful run of the turn even when Payroll Heist replaces the access. Each installed copy pays (the text is on each card).
15. **Payroll Heist** gives its heat only if the run succeeds.
16. **Lockdown Audit** checks only the Ghost's most recent turn.
17. **Recall** also removes the Ghost's knowledge of what was in the Dump, since those cards are shuffled away.
18. **Installing over a card in a site** trashes the old card facedown (faceup if it was active). ICE cannot be replaced or removed, and a node holds at most 5.
19. **Empty sites** are reused before a new site can be opened; there can be at most 6 sites.
20. **Mulligan** is once per side, decided Corp first.
21. **Damage kinds.** Net, meat and core damage all discard at random, and more than the Ghost's hand flatlines them. Core damage also lowers the Ghost's maximum hand size by 1 per point for the rest of the game. A maximum hand size below 0 at the end of the Ghost's turn flatlines them; exactly 0 means discarding everything.
22. **Upgrades** install for 1 cycle in any node, central or site, alongside whatever is there; a node may hold any number. Installing a project or asset over a site's root card does not touch its upgrades. A site holding only an upgrade can be run.
23. **Accessing upgrades.** A successful run on a node accesses its upgrades after the normal access (Command, Mainframe, Dump or the site's root card), one at a time. They can be trashed for their trash cost.
24. **Lockout Relay** charges when the run gets past all ICE, after the Corp's node window (so one activated in that window charges at once). It does not charge if the run never gets that far.
25. **Choke Point** raises strength only while active. If the Corp activates it while the Ghost approaches ICE in that node, the boost applies to that ICE's encounter.
26. **Watch Desk** gives heat only when activated during a run, not when activated on the Corp's turn.
27. **Running out of money mid-approach.** If the Corp spends credits on another card while the Ghost approaches inactive ICE and can no longer afford that ICE, the Ghost slips past it.

## Status

- Engine, all 40 card designs, both bots, UI with save/resume, the Operator, Docker and the Pages workflow are done.
- 101 tests pass: every rule, one test block per card (with a check that no card is untested), hidden-information and Operator-leak tests, and 500 seeded bot-vs-bot games with invariant checks after every action.
- Not verified here: a live Operator call (no API key in the build environment) and the GitHub Pages deploy (it needs Pages switched on in the repo settings).
