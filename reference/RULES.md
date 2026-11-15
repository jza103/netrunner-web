# Breachline: rules reference

Breachline is a two-player card game. The **Corp** builds and scores secret projects behind layers of ICE. The **Ghost** breaks in and steals them. The engine in `src/engine` enforces everything below; this file is the plain-language version, and the Operator reads it too.

## Winning

- First to **7 project points** wins. The Corp scores projects; the Ghost steals them.
- The Ghost loses at once if they take more damage than they have cards in hand (**flatlined**).
- The Corp loses if it must draw at the start of its turn and the Mainframe is empty.

## Setup

Each side picks an **identity**: a card that starts in play, is never in the deck, and whose ability works all game. The Corp's is public, and so is the Ghost's. The Ghost's identity also sets their base **link** (see Traces).

Each side shuffles its own deck, takes 5 credits and draws 5 cards. Each side, Corp first, may take one mulligan (shuffle the hand back and draw 5 new cards). The Corp takes the first turn.

## The table

**Corp nodes.** Three central nodes always exist:

- **Command**: the Corp's hand. A successful run accesses 1 random card from it.
- **Mainframe**: the Corp's deck. A successful run accesses the top card.
- **Dump**: the Corp's discard pile. A successful run turns every card there faceup and accesses all of them.

**Sites** are extra nodes the Corp creates (any number). Each site holds at most one project or asset. A site with nothing left in it or protecting it is gone. Any node can be protected by any number of ICE in a row; new ICE always goes outermost. **Upgrades** can be installed in any node, central or site, alongside whatever else is there, and a node can hold several. Corp cards are installed facedown and inactive.

**The Ghost's rig.** Installed programs (limited by RAM, 4 to start), gear and contacts. The Ghost's discard pile is the Scrapheap.

## Turns

The Corp gets **3 cycles** a turn and the Ghost gets **4**. Every cycle must be spent. At the end of your turn, discard down to your maximum hand size (5).

**Turn order.** Each turn: gain your cycles; a window for both sides (yours first); your recurring credits refill and "when your turn begins" abilities resolve; the Corp then draws 1 card (mandatory, no cycle; the Corp loses if it cannot); then you spend cycles, and before each action the other side gets a window; at the end, discard down to your maximum hand size, one last window for both sides, and the turn ends.

**Windows.** In a window the Corp may activate assets and upgrades (and, on its own turn before its draw, score projects); the Ghost may use abilities that cost no cycle. A side with nothing it could do skips its window. During your own action phase you may do these things at any time between actions anyway.

**Corp turn.** Spend cycles:

- 1 cycle: gain 1 credit
- 1 cycle: draw 1 card
- 1 cycle: install a card. A project or asset goes into a site (new or existing; a project or asset already there is trashed). An upgrade goes into any node (new site or existing node). ICE goes on any node and costs 1 credit for each ICE already protecting that node. As part of installing, the Corp may first trash any of the ICE protecting that node (installing ICE; trashed ICE does not count toward the cost) or any cards in that node's root (installing a project, asset or upgrade). Trashed cards go to the Dump faceup if they were active, facedown if not.
- 1 cycle: play a directive, paying its cost
- 1 cycle and 1 credit: develop an installed project (or an asset that says it can be developed), adding 1 development counter
- 1 cycle and 2 credits, only while the Ghost has heat: trash one of the Ghost's contacts
- all 3 cycles (so only with all 3 left): **purge** every virus counter from the Ghost's programs

Without spending a cycle, the Corp may:

- **score** an installed project that has at least as many development counters as it requires (on its own turn only)
- **activate** an installed asset or upgrade by paying its cost (traps cannot be activated): on its own turn, in any window on the Ghost's turn, and in the run windows

**Ghost turn.** Spend cycles:

- 1 cycle: gain 1 credit
- 1 cycle: draw 1 card
- 1 cycle: install a program, gear or contact, paying its cost. Programs need free RAM, unless they are installed onto a card that can **host** them (the hosted program uses no RAM; if the host is trashed, what it hosts goes with it). As part of installing a program, the Ghost may first trash any installed programs, and must trash enough to fit the new one. This is the only way to trash your own programs. If RAM ever drops below what installed programs use, the Ghost trashes programs at once until they fit.
- 1 cycle: play a stunt, paying its cost
- 1 cycle: make a run on a node
- 1 cycle and 2 credits: shed 1 heat
- card abilities that say "spend 1 cycle"

Without spending a cycle, the Ghost may use abilities that say "no cycle", in any window (see Windows).

## Runs

The Ghost names a node and works through its ICE from the outermost inward. These steps follow the Netrunner run phases.

1. **Initiation.** Bad publicity credits are added for this run. The Corp gets a window to activate assets and upgrades (anywhere).
2. **Approach** each ICE. The Corp gets a window: it may activate *this* ICE by paying its cost, and may activate assets and upgrades. ICE can only be activated while it is being approached. If the ICE stays inactive, the Ghost passes it (step 4).
3. **Encounter** active ICE. Active ICE has a type (wall, cipher or hunter), a strength and subroutines. The Ghost may use installed breakers: pay to boost a breaker's strength (boosts last for this encounter), and once its strength is at least the ICE's strength, pay to break subroutines. A breaker works on the ICE type it names, or on any ICE if it says so. Then every unbroken subroutine resolves in order. "End the run" stops the run right there.
4. **Movement.** After passing a piece of ICE (encountered, bypassed, or left inactive), and also on a node with no ICE, the Ghost may **jack out** (end the run, no access). If they go on and there is more ICE, the Corp gets a window to activate assets and upgrades, then the Ghost approaches the next ICE (step 2).
5. **Reach the node.** After the last ICE (or none), the Corp gets one last window to activate assets and upgrades. Then the Ghost approaches the node: active upgrades there that trigger "when the Ghost approaches this node" resolve.
6. **Success and access.** The run is successful. The Ghost then accesses cards one at a time, **choosing the order**: any card in the node's root (a site's project or asset, and upgrades in any node), and for central nodes the next card from that zone:
   - **Command**: a random card from the Corp's hand (1 per run, more with some cards)
   - **Mainframe**: the next card from the top of the deck (1, more with some cards)
   - **Dump**: every card there turns faceup and is accessed. Cards there cannot be trashed; the app accesses the ones that are not projects at once, since there is nothing to decide about them.

   For each accessed card:
   - a **project** is stolen (some projects charge a cost to steal; the Ghost may then decline)
   - a card with a **trash cost** may be trashed by paying it, unless it is in the Dump
   - a **trap** fires when accessed while installed in a site
   - a facedown card the Ghost accessed and left stays known to the Ghost
   - the Corp does not get to see cards the Ghost accesses from the Mainframe

A Corp window where the Corp has nothing it could activate is skipped; the app makes a declined window look the same.

## Traces

Some ICE subroutines and Corp directives say **Trace N**. The Corp first pays any number of credits to raise N. Then the Ghost pays any number to raise their **link** (from their identity and gear). If the trace ends higher than the link, its "if successful" effect happens; a tie goes to the Ghost. The app only offers the Ghost as much as it takes to match the trace.

## Bad publicity

Some Corp cards give the Corp **bad publicity**. At the start of every run, the Ghost gets 1 extra credit for each bad publicity, usable only during that run and spent before their own credits. Whatever is left disappears when the run ends. Some cards remove bad publicity.

## Recurring credits

A card with **recurring credits** refills to its number at the start of its owner's turn (a Corp card only while active; it also fills when installed or activated). They can only pay for what the card says, they are spent before the pool, and unspent ones do not pile up.

## Viruses

**Virus** programs gain virus counters as the Ghost makes successful runs, and get stronger with them. The Corp's answer is to **purge**: it costs the Corp's whole turn (all 3 cycles) and removes every virus counter.

## Bypass

Some Ghost cards **bypass** ICE: when the Ghost would encounter that ICE, they get past it instead, with no subroutines and no breaking. Only ICE that would actually be encountered counts; inactive ICE the Ghost passes does not use up a bypass. After a bypass the Ghost is in the movement step and may jack out.

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
- Link matters against traces. Each point of link is a credit you do not have to pay every time a trace comes at you.
- Bad publicity is free money on every run: run more often against a Corp that has it.
- Virus counters snowball. If the Corp spends a whole turn purging, that is a turn it did not score.
- Heat is how the Corp kills you. Burn Notice deals 1 plus your heat. Shed heat before you pass the turn.
- The Mainframe is always worth a look; the same top card stays there until the Corp draws it.
- A project with counters on it is about to be scored. Count: the Corp has 3 cycles a turn.
- Make the Corp pay. Running early forces it to spend credits activating ICE.

**Corp**

- ICE Command and the Mainframe early, then build one well-protected site to score in.
- Keep enough credits to activate your ICE. Facedown ICE you cannot afford is no protection.
- A trace is a bidding war you lead: raise it just past what the Ghost can pay to match, or not at all.
- Purge when the Ghost's virus counters start to bite, and before they turn one Mainframe run into four.
- Keep credits back during the Ghost's turn. An upgrade or asset activated mid-run is a surprise the Ghost had to plan around without knowing it was there.
- A 2-counter project can be installed, developed twice and scored in a single turn.
- Rapid Prototyping lets a 3-counter project do the same, and makes Decoy Lab look like a real project.
- Punish heat: Lockdown Audit after a successful run, then Burn Notice or Asset Freeze.
- Do not discard projects into an unprotected Dump.

## Card list

See `data/cards.json` for exact data. The app shows the full text of every card.
