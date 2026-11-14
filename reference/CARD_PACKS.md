# Card packs

A card pack is a JSON file of your own cards. Load it from the start screen: **Cards → Change → Load a pack file** (or paste the JSON). The engine checks every card first, and nothing loads until the whole pack passes. New games then use the pack, and a saved game keeps the cards it started with, even if you load a different pack later.

The quickest start: on the same screen, **Download built-in set as a pack**, edit the file, and load it back. `packs/sample-pack.json` in the repo shows most of the features.

Custom cards are played by the same engine code as the built-in cards. A card's behaviour comes only from its fields and effects, listed below. Its `text` is what the player reads, so write it to match its effects exactly. The engine cannot check that for you.

## The file

```json
{
  "name": "My pack",
  "cards": [ ...card objects... ],
  "decks": { "corp": { "card-id": 3 }, "ghost": { "card-id": 2 } }
}
```

- **cards**: up to 200 cards. Each `id` is lowercase letters, digits and dashes, and unique in the pack.
- **A card with the same `id` as a built-in card replaces it.** To drop a built-in card from a deck, replace it with `"copies": 0`.
- **decks** (optional): a side's deck list, as card id → copies. Ids can be pack cards (looked up first) or built-in cards of that side.
  - A side you leave out uses the built-in deck, with your replacements, plus every new pack card for that side at its `copies`.
  - Each deck needs 15 to 120 cards. You get a warning, but can still play, if the Corp deck has fewer than 7 project points or the Ghost deck has no breakers.

Inside a game, pack cards get ids like `x1a2b3c4d-my-card`, where the hex is a hash of the card's content. That's why one id always means one definition and saved games replay exactly. You never need to write these ids yourself.

## Every card

| Field | |
|---|---|
| `id`, `name`, `text` | required. `text` may be `""` for ICE and breakers, whose subroutine and breaker lines are generated. |
| `side` | `"corp"` or `"ghost"` |
| `type` | Corp: `project`, `ice`, `asset`, `upgrade`, `directive`. Ghost: `program`, `gear`, `contact`, `stunt`. |
| `copies` | 0 to 20 |
| `cost` | credits to install, play or activate. Every type except `project` needs one. |

Numbers are whole numbers from 0 to 20. Any field not listed here is rejected, which catches typos.

## By type

**project**: `dev` (counters needed), `points`, optional `stealCost` (the Ghost must pay this to steal it), and optional `onScore` effects.

**ice**: `subtype` (`wall`, `cipher` or `hunter`), `strength`, and `subs`, a list of subroutine effects that fire top to bottom unless broken.

**asset**: `trash` (trash cost), and optionally:
- `onTurnStart`: fires at the start of the Corp's turn while the asset is active.
- `onActivateInRun`: fires when the Corp activates it during a run.
- `trap: true` with `onAccess`: it fires when accessed while installed and turns faceup. Traps cannot be activated.
- `developable: true`: it can take development counters.

**upgrade**: installs in any node. Takes `trash`, and optionally:
- `iceStrength`: while active, ICE protecting its node gets this much extra strength.
- `onApproachNode`: while active, fires when a run on its node gets past all the ICE.
- `onTurnStart`, `onActivateInRun`, and `trap` with `onAccess`, the same as for assets.

**directive** (Corp) and **stunt** (Ghost): `onPlay` effects, optional `playIf` (`"ghostHasHeat"` or `"ghostRanLastTurn"`). A directive can also have `removeAfterPlay: true`.

**program**: `ram`, and optionally `breaker`:
`{ "breaks": "wall" | "cipher" | "hunter" | "any", "strength": 1, "boostCost": 1, "boostBy": 1, "breakCost": 1 }`

**program, gear and contact** can also have:
- `ramBonus`: extra RAM.
- `handBonus`: extra maximum hand size.
- `prevent`: for example `{ "net": 1, "meat": 2 }`. Prevents the first N damage of each kind per turn.
- `mainframeAccess`: extra cards accessed from the Mainframe.
- `onTurnStart`: fires at the start of the Ghost's turn.
- `onFirstSuccessfulRun`: fires on the first successful run each turn.
- `ability`: `{ "cycles": 0 or 1, "credits": 0, "trashSelf": false, "if": "ghostHasHeat", "effects": [...] }`. The Ghost uses it on their turn. `credits`, `trashSelf` and `if` are optional.

## Effects

An effect is an object with an `op`. Lists of effects resolve in order, and stop early if the run or the game ends. `who` defaults to the side that owns the card.

| op | fields | does |
|---|---|---|
| `gain` | `n`, `who`? | gain n credits |
| `draw` | `n`, `who`? | draw n cards |
| `damage` | `kind` (`net`, `meat`, `core`), `n`, `perHeat`?, `perDev`? | damage to the Ghost: n, plus perHeat for each heat the Ghost has, plus perDev for each counter on this card |
| `heat` | `n` | the Ghost gains n heat |
| `shedHeat` | `n` | the Ghost removes up to n heat |
| `loseCredits` | `n`, `perHeat`? | the Ghost loses that many credits (as many as they have) |
| `drain` | `n` | the Corp loses up to n credits and the Ghost gains that many |
| `loseCycle` | `n` | the Ghost loses n cycles, if able |
| `trashProgram` | | the Corp trashes 1 installed Ghost program of its choice |
| `endRun` | | end the run |
| `payOrEndRun` | `n` | the Ghost loses n credits; if they have fewer, the run ends instead |
| `develop` | `n` | put n counters on an installed card that can be developed (the player picks the target) |
| `recycleDump` | | shuffle the Dump into the Mainframe |
| `run` | `node` (`command`, `mainframe`, `dump`, `any`), `extraAccess`?, `noActivate`?, `instead`? | make a run. `any` lets the player pick the node. `noActivate`: the Corp cannot activate ICE. `instead`: effects that replace accessing cards if the run succeeds. Must be the last effect. |
| `reveal` | | the Ghost looks at every facedown card in or protecting one node (the player picks it) |
| `recover` | `types` | return a card of one of these types from the Scrapheap to hand (the player picks it) |

**Where each op is allowed.** The engine can only carry out some ops at certain moments:

- **Everywhere:** `gain`, `draw`, `damage`, `heat`, `shedHeat`, `loseCredits`, `drain`, `loseCycle`.
- **ICE `subs`:** also `endRun`, `trashProgram` and `payOrEndRun`.
- **`onApproachNode` and `onActivateInRun`:** also `endRun` and `payOrEndRun`.
- **Corp `onPlay`:** also `develop` and `recycleDump`.
- **Ghost `onPlay`:** also `run`, `reveal` and `recover`.
- **One target per card.** A card may have only one effect that needs a target: `develop`, `reveal`, `recover`, or a `run` on `any`.

## Examples

```json
{ "id": "toll-booth", "name": "Toll Booth", "side": "corp", "type": "upgrade", "copies": 2, "cost": 0, "trash": 2,
  "onApproachNode": [{ "op": "payOrEndRun", "n": 2 }],
  "text": "Upgrade. While active: when a run on this node gets past all its ICE, the Ghost loses 2 credits. If they have fewer than 2, the run ends instead." }
```

```json
{ "id": "smash-and-grab", "name": "Smash and Grab", "side": "ghost", "type": "stunt", "copies": 2, "cost": 1,
  "onPlay": [{ "op": "run", "node": "dump", "instead": [{ "op": "gain", "n": 4 }] }],
  "text": "Make a run on the Dump. If it succeeds, instead of accessing cards, gain 4 credits." }
```

## Limits

- **Effects are limited to the ops above.** A card that needs something else, such as a new trigger or a choice the engine doesn't offer, can't be written as a pack card yet. Adding it means adding an op to the engine (`src/engine/types.ts`, then `runEffect` in `src/engine/actions.ts`, then the checker in `src/engine/pack.ts`), with a test.
- **The bots play pack cards using their fields.** They know ICE, breakers, projects, upgrades and simple economy cards well. Unusual combinations may be played less cleverly than the built-in set, but always legally.
- **The Operator** sees your pack's cards exactly as written, and still only from your side's view.
