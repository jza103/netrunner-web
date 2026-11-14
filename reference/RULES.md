# Breachline: rules reference

Breachline is a two-player card game. The **Corp** builds and scores secret projects behind layers of ICE. The **Ghost** breaks in and steals them. The engine in `src/engine` enforces everything below; this file is the plain-language version, and the Operator reads it too.

## Winning

- First to **7 project points** wins. The Corp scores projects; the Ghost steals them.
- The Ghost loses at once if they take more damage than they have cards in hand (**flatlined**).
- The Corp loses if it must draw at the start of its turn and the Mainframe is empty.

## Setup

Each side shuffles its own deck, takes 5 credits and draws 5 cards. Each side, Corp first, may take one mulligan (shuffle the hand back and draw 5 new cards). The Corp takes the first turn.

## The table

**Corp nodes.** Three central nodes always exist:

- **Command**: the Corp's hand. A successful run accesses 1 random card from it.
- **Mainframe**: the Corp's deck. A successful run accesses the top card.
- **Dump**: the Corp's discard pile. A successful run turns every card there faceup and accesses all of them.

**Sites** are extra nodes the Corp creates (up to 6). Each site holds at most one project or asset. Any node can be protected by up to 5 pieces of ICE in a row; the newest ICE is always outermost. **Upgrades** can be installed in any node, central or site, alongside whatever else is there, and a node can hold several. Corp cards are installed facedown and inactive.

**The Ghost's rig.** Installed programs (limited by RAM, 4 to start), gear and contacts. The Ghost's discard pile is the Scrapheap.

## Turns

The Corp gets **3 cycles** a turn and the Ghost gets **4**. Every cycle must be spent. At the end of your turn, discard down to your maximum hand size (5).

**Corp turn.** First draw 1 card (mandatory, no cycle). Then spend cycles:

- 1 cycle: gain 1 credit
- 1 cycle: draw 1 card
- 1 cycle: install a card. A project or asset goes into a site (new or existing; a project or asset already there is trashed). An upgrade goes into any node (new site or existing node) and replaces nothing. ICE goes on any node and costs 1 credit for each ICE already protecting that node.
- 1 cycle: play a directive, paying its cost
- 1 cycle and 1 credit: develop an installed project (or an asset that says it can be developed), adding 1 development counter
- 1 cycle and 2 credits, only while the Ghost has heat: trash one of the Ghost's contacts

Without spending a cycle, on its own turn the Corp may:

- **score** an installed project that has at least as many development counters as it requires
- **activate** an installed asset or upgrade by paying its cost (traps cannot be activated)

**Ghost turn.** Spend cycles:

- 1 cycle: gain 1 credit
- 1 cycle: draw 1 card
- 1 cycle: install a program, gear or contact, paying its cost. Programs need free RAM.
- 1 cycle: play a stunt, paying its cost
- 1 cycle: make a run on a node
- 1 cycle and 2 credits: shed 1 heat
- card abilities that say "spend 1 cycle"

Without spending a cycle, on their own turn the Ghost may scrap (trash) one of their installed programs, and use abilities that say "no cycle".

## Runs

The Ghost names a node and meets its ICE from the outermost inward.

1. **Approach.** If the ICE is inactive, the Corp may pay its cost to activate it. If the Corp does not (or cannot), the Ghost slips past it. In this window the Corp may also activate any of its assets and upgrades.
2. **Encounter.** Active ICE has a type (wall, cipher or hunter), a strength and one or more subroutines. The Ghost may use installed breaker programs: pay to boost a breaker's strength (boosts last for this one encounter), and once its strength is at least the ICE's strength, pay to break subroutines one at a time. A breaker only works on its own ICE type.
3. **Subroutines fire.** Every unbroken subroutine resolves in order. "End the run" stops the run right there.
4. **Passed.** After getting past a piece of ICE the Ghost may **jack out** (end the run with no penalty) or continue to the next one.
5. **Reach the node.** With no ICE left, the Corp gets one last window to activate assets and upgrades (anywhere), even mid-run. Then active upgrades in the node that trigger "when a run gets past all its ICE" resolve. This window always happens, so a pause here tells the Ghost nothing.
6. **Access.** If the run is still going it succeeds, and the Ghost accesses cards, one at a time:
   - a **project** is stolen (some projects charge a cost to steal; the Ghost may decline)
   - a card with a **trash cost** may be trashed by paying it; otherwise it stays
   - a **trap** fires when accessed while installed in a site
   - a facedown card the Ghost accessed and left stays known to the Ghost
   - upgrades in the node are accessed after the normal access, and can be trashed for their trash cost

## Damage and heat

- **Damage** comes in three kinds. Each makes the Ghost discard that many cards at random from hand, and more damage than cards in hand means the Ghost is flatlined and loses.
  - **Net damage** usually comes from hunter ICE and traps.
  - **Meat damage** usually comes from Corp directives that punish heat.
  - **Core damage** also lowers the Ghost's maximum hand size by 1 per point, for the rest of the game. If the Ghost's maximum hand size is below 0 at the end of their turn, they are flatlined.
  - Cards that prevent damage name the kind they prevent.
- **Heat**: a counter on the Ghost. Some Corp cards only work, or work harder, while the Ghost has heat. The Ghost sheds heat with 1 cycle and 2 credits each.

## Strategy notes

**Ghost**

- Get one breaker for each ICE type. Until then, an "End the run" you cannot break is a wasted cycle.
- Never run facedown ICE or a facedown site with an empty hand. Hunters deal up to 3 damage, and a developed card may be a Decoy Lab (2 damage plus 1 per counter).
- Count the Corp's credits before you commit to a run. Facedown upgrades and assets can be activated mid-run: a Choke Point makes the ICE stronger than you planned for, a Lockout Relay costs you 3 at the door, and a Watch Desk gives you heat.
- Core damage is permanent. Synapse Spike costs you a card and hand size for the rest of the game.
- Heat is how the Corp kills you. Burn Notice deals 1 plus your heat. Shed heat before you pass the turn.
- The Mainframe is always worth a look; the same top card stays there until the Corp draws it.
- A project with counters on it is about to be scored. Count: the Corp has 3 cycles a turn.
- Make the Corp pay. Running early forces it to spend credits activating ICE.

**Corp**

- ICE Command and the Mainframe early, then build one well-protected site to score in.
- Keep enough credits to activate your ICE. Facedown ICE you cannot afford is no protection.
- Keep credits back during the Ghost's turn. An upgrade or asset activated mid-run is a surprise the Ghost had to plan around without knowing it was there.
- A 2-counter project can be installed, developed twice and scored in a single turn.
- Rapid Prototyping lets a 3-counter project do the same, and makes Decoy Lab look like a real project.
- Punish heat: Lockdown Audit after a successful run, then Burn Notice or Asset Freeze.
- Do not discard projects into an unprotected Dump.

## Card list

See `data/cards.json` for exact data. The app shows the full text of every card.
