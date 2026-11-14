# Breachline Web App Spec

## What this is, and one decision to know about

The request was a fully playable web app of Netrunner with Null Signal Games' System Gateway cards, built the way `munchkin-web` was built, with an AI game-master mode under a more fitting name.

**What was built instead:** *Breachline*, an original two-player cyber-heist card game in the same genre, with the same kind of play (an asymmetric hacker against a corporation, nodes protected by ICE, runs, projects to score or steal). The card set, card names, card text, factions, numbers and terminology are all original to this repo. It is **not** a port of System Gateway: no Netrunner card names, text, identities or art are used.

Why: the assistant that built this does not recreate a specific existing game (its name, cards, text or look), and it does build original games with similar mechanics. Everything else in the request (static site, pure engine, rule-based bot opponent, optional AI narrator, tests, spec and handoff) was followed. If Jason wants different cards or rules, the card data is one JSON file and the rules are small; see `HANDOFF.md`.

## Decisions

- **Repo:** `jza103/netrunner-web`, deployable to GitHub Pages at `/netrunner-web/`.
- **Players:** one person (Jason) against one bot. The human picks a side: the **Ghost** (hacker) or the **Corp**.
- **AI layer:** the **Operator**, the voice in your ear. Optional, off by default, bring-your-own-key. It narrates and teaches and never changes the game.
- **No AI in rules or bot decisions.** The bot picks from `legalActions`.
- **Card accuracy:** every card does exactly what its text says. No simplified cards.

## Goal and scope

**In v1**

- Full rules of Breachline (see `reference/RULES.md`): turns, cycles, credits, installing, ICE, upgrades, runs with approach / encounter / break / jack out / reaching the node / access, Corp activation during runs, net, meat and core damage, heat, scoring and stealing, all win conditions
- All 45 card designs (93 cards: a 52-card Corp deck and a 41-card Ghost deck)
- Custom card packs: Jason's own cards as JSON, checked by the engine and played by the same rules code (`reference/CARD_PACKS.md`)
- A rule-based bot for each side
- Save and resume in the browser
- Phone-first layout that also works on tablet and desktop
- The Operator (optional AI narration, rulings, teaching notes, end-of-game recap)

**Not in v1**

- Deck building in the app (deck lists can be set in a card pack), more factions or identities
- Human-vs-human play, accounts, a backend
- Bot difficulty levels or personalities

## Architecture

Same model as `munchkin-web`. Everything runs in the browser from static files. The engine is the only thing that changes game state.

```
Browser (static files from GitHub Pages)
  UI   <-> actions / state  <-> Game engine: apply(state, action), legalActions(state)
  Bot  <-> actions / view   <-> Game engine
  Game engine  -> events    ->  Operator (optional, never changes state) <-> Claude (your key)
  Game engine <-> save / resume <-> localStorage
```

With the Operator off, nothing leaves the browser.

## Engine

Pure TypeScript in `src/engine`, no DOM, no mutation of its input, all randomness from the seeded `rngState`.

- `legalActions(state)` lists every action the acting side may take. It is the single source of truth: `apply` accepts exactly those actions and rejects everything else with a plain-language reason (`explain`).
- `actor(state)` says who must act: during a run the Corp decides whether to activate ICE and which program to trash; the Ghost decides everything else.
- `viewFor(state, side)` hides what that side may not know (the other hand, both decks, facedown Corp cards the Ghost has not looked at, unseen Dump cards). Bots and the Operator only get views.
- Events carry a public text plus an optional private text for one side, so a log line can say "The Corp installs a card in Site 1" to the Ghost and "You install Skyhook Contract in Site 1" to the Corp.
- `violations(state)` checks invariants (card conservation, no negative resources, RAM, zone types).

**Phases:** `mulligan` → (`action` ↔ `run`) → `discard` → next turn … → `gameOver`.

**Run steps:** `approach` (Corp: activate or decline) → `encounter` (Ghost: boost, break, proceed) → subroutines fire (`corpTrash` if the Corp must choose a program) → `passed` (Ghost: continue or jack out) → … → `access` (Ghost: steal, trash, leave, one card at a time).

## Card data

`data/cards.json`, one entry per design: `id`, `name`, `side`, `type`, `copies`, `text`, plus structured fields by type. Every effect is a list of `Effect` ops (`src/engine/types.ts`), interpreted by `runEffect` in `src/engine/actions.ts`; no card has its own code. The fields and ops are documented for pack authors in `reference/CARD_PACKS.md`, and the built-in set uses the same format, so it doubles as a template.

## Bots

`src/bots/bot.ts`: `chooseAction(view)` for whichever side must act. Heuristic priority lists, no randomness, no hidden information.

- **Corp:** score when able, finish projects in one turn when the cycles allow, ICE the central nodes then a scoring site, burst economy, punish heat (Burn Notice, Asset Freeze), bait with Decoy Lab.
- **Ghost:** shed heat, build economy, one breaker per ICE type, estimate the cost and risk of each run from what it can see, never face-check with too few cards in hand, jack out when the rest of the path is unaffordable.

Test: 500 seeded bot-vs-bot games must end with a winner, no invariant violations and no illegal bot choices.

## The Operator (optional AI)

Works like the munchkin GM: after each batch of engine events the app sends the new events (as the human's side reads them) plus the human's view of the table. The Operator answers in a few short lines: narration, a ruling when a move was rejected, at most one teaching note. It can also answer questions and give an end-of-game recap. Providers: built-in Claude when running as a claude.ai artifact, an OpenRouter key, or an Anthropic key. Keys stay in localStorage and go straight to the provider.

## UI

One screen, phone-first: opponent strip, the board (central nodes and sites with ICE stacks), the run panel, your rig or your installed cards, your hand, an action bar with only legal actions, the log, and the Operator panel.

## Repo layout

```
SPEC.md, HANDOFF.md, README.md, CLAUDE.md
reference/RULES.md     # the rules of Breachline (also fed to the Operator)
data/cards.json        # structured card data
packs/                 # sample custom card pack
reference/CARD_PACKS.md  # the card pack format
src/engine/            # state, legal actions, apply, view, invariants, rng
src/bots/              # both bots and the bot driver
src/operator/          # optional Claude narration client
src/ui/                # Preact UI
tests/                 # Vitest
scripts/               # sim.ts, debug-seed.ts, artifact-page.mjs
Dockerfile, compose.yaml, .github/workflows/deploy.yml
```

## Milestones

1. Data and engine core: cards, state, legal actions, apply, views
2. Bots for both sides; 500 seeded games pass
3. Unit tests for every rule and every card
4. UI: a playable game in the browser with save and resume
5. The Operator
6. Docs, Docker, Pages deploy
7. Polish: sound, recap, bot tuning
