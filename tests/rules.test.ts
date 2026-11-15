import { describe, expect, it } from 'vitest';
import { CARDS, cardOf, deckList } from '../src/engine/cards';
import { legalActions } from '../src/engine/legal';
import { actor, maxHand, newGame, nodeOf, points } from '../src/engine/state';
import { viewFor } from '../src/engine/view';
import { act, actRaw, blank, corpTurn, ghostTurn, hand, ice, passWindows, rejects, rig, site, take, upgrade } from './helpers';
import { loadPack } from '../src/engine/pack';

describe('card data', () => {
  it('every card has the fields its type needs', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.name && c.copies > 0, c.id).toBeTruthy();
      if (c.type === 'project') expect(c.dev! > 0 && c.points! > 0, c.id).toBe(true);
      else if (c.type !== 'identity') expect(c.cost, c.id).toBeTypeOf('number');
      if (c.type === 'ice') expect(c.subs!.length > 0 && c.strength! > 0 && !!c.subtype, c.id).toBe(true);
      if (c.type === 'asset' || c.type === 'upgrade') expect(c.trash, c.id).toBeTypeOf('number');
      if (c.type === 'program') expect(c.ram, c.id).toBeTypeOf('number');
      expect(c.type === 'ice' || !!c.breaker || c.text.length > 0, `${c.id} has rules text`).toBe(true);
      expect(['corp', 'ghost']).toContain(c.side);
    }
  });
  it('decks: 50 Corp cards with 22 project points, 45 Ghost cards', () => {
    expect(deckList('corp')).toHaveLength(50);
    expect(deckList('ghost')).toHaveLength(45);
    expect(deckList('corp').reduce((n, c) => n + (cardOf(c).points ?? 0), 0)).toBe(22);
  });
});

describe('setup and turns', () => {
  it('deals 5 cards and 5 credits each; Corp decides its mulligan first, then the Ghost', () => {
    let s = newGame({ seed: 7, human: 'ghost' });
    expect(s.corp.hand).toHaveLength(5);
    expect(s.ghost.hand).toHaveLength(5);
    expect([s.corp.credits, s.ghost.credits]).toEqual([5, 5]);
    expect(actor(s)).toBe('corp');
    const before = [...s.corp.hand];
    s = act(s, { type: 'mulligan' });
    expect(s.corp.hand).toHaveLength(5);
    expect(s.corp.hand).not.toEqual(before);
    expect(actor(s)).toBe('ghost');
    s = act(s, { type: 'keep' });
    // Corp's first turn: mandatory draw, 3 cycles
    expect(s.turn).toBe('corp');
    expect(s.corp.cycles).toBe(3);
    expect(s.corp.hand).toHaveLength(6);
  });
  it('the same seed gives the same game', () => {
    expect(newGame({ seed: 'abc', human: 'ghost' })).toEqual(newGame({ seed: 'abc', human: 'ghost' }));
  });
  it('apply never changes its input', () => {
    const s = blank();
    const copy = structuredClone(s);
    act(s, { type: 'credit' });
    expect(s).toEqual(copy);
  });
  it('every cycle must be spent before ending the turn; the Ghost then gets 4', () => {
    let s = blank();
    expect(rejects(s, { type: 'endTurn' })).toMatch(/cycles/);
    for (let i = 0; i < 3; i++) s = act(s, { type: 'credit' });
    expect(s.corp.credits).toBe(8);
    expect(rejects(s, { type: 'credit' })).toMatch(/no cycles/);
    s = act(s, { type: 'endTurn' });
    expect(s.turn).toBe('ghost');
    expect(s.ghost.cycles).toBe(4);
    // the Ghost does not draw for free
    expect(s.ghost.hand).toHaveLength(0);
  });
  it('over the hand limit at end of turn: discard down to 5', () => {
    let s = blank();
    hand(s, 'corp', 'tripwire', 'tripwire', 'tripwire', 'bulkhead', 'bulkhead', 'bulkhead', 'monolith');
    s.corp.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.phase).toBe('discard');
    expect(actor(s)).toBe('corp');
    s = act(s, { type: 'discard', card: s.corp.hand[0] });
    expect(s.phase).toBe('discard');
    s = act(s, { type: 'discard', card: s.corp.hand[0] });
    expect(s.turn).toBe('ghost');
    expect(s.corp.discard).toHaveLength(2);
    // discards from hand are facedown to the Ghost
    expect(s.corp.discardSeen).toHaveLength(0);
  });
  it('the Corp loses when it must draw from an empty Mainframe', () => {
    let s = ghostTurn(blank());
    s.corp.discard.push(...s.corp.deck.splice(0));
    s.ghost.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe('ghost');
  });
});

describe('Corp actions', () => {
  it('installs ICE outermost, paying 1 per ICE already there', () => {
    let s = blank();
    const [a, b, c] = hand(s, 'corp', 'tripwire', 'bulkhead', 'monolith');
    s.corp.credits = 1;
    s = act(s, { type: 'install', card: a, node: 'command' });
    expect(s.corp.credits).toBe(1);
    s = act(s, { type: 'install', card: b, node: 'command' });
    expect(s.corp.credits).toBe(0);
    expect(nodeOf(s, 'command').ice.map((i) => i.card)).toEqual([a, b]);
    expect(nodeOf(s, 'command').ice.every((i) => !i.active)).toBe(true);
    // a third would cost 2
    rejects(s, { type: 'install', card: c, node: 'command' });
    s = act(s, { type: 'install', card: c, node: 'new' });
    expect(nodeOf(s, 'site1').ice).toHaveLength(1);
  });
  it('installs projects and assets only in sites; replacing trashes the old card', () => {
    let s = blank();
    const [p, q] = hand(s, 'corp', 'skyhook-contract', 'shell-company');
    rejects(s, { type: 'install', card: p, node: 'command' });
    s = act(s, { type: 'install', card: p, node: 'new' });
    s = act(s, { type: 'install', card: q, node: 'site1' });
    expect(nodeOf(s, 'site1').root!.card).toBe(q);
    expect(s.corp.discard).toEqual([p]);
  });
  it('develops for 1 cycle and 1 credit, and scores only with enough counters', () => {
    let s = corpTurn(blank());
    const { card } = site(s, 'quiet-acquisition');
    rejects(s, { type: 'score', card });
    s = act(s, { type: 'develop', card });
    s = act(s, { type: 'develop', card });
    expect(s.corp.credits).toBe(8);
    expect(s.corp.cycles).toBe(1);
    s = act(s, { type: 'score', card });
    expect(points(s, 'corp')).toBe(1);
    expect(s.corp.cycles).toBe(1); // scoring is free
  });
  it('cannot develop ICE or a plain asset', () => {
    const s = corpTurn(blank());
    const { card } = site(s, 'shell-company');
    const w = ice(s, 'command', 'tripwire', false);
    rejects(s, { type: 'develop', card });
    rejects(s, { type: 'develop', card: w });
  });
  it('7 points wins for the Corp', () => {
    let s = corpTurn(blank());
    s.corp.scored.push(take(s, 'orbital-mandate'), take(s, 'blacksite-ledger'));
    const { card } = site(s, 'skyhook-contract', { dev: 3 });
    s = act(s, { type: 'score', card });
    expect(s.winner).toBe('corp');
    expect(legalActions(s)).toEqual([]);
  });
  it('with heat on the Ghost, the Corp may pay a cycle and 2 credits to trash a contact', () => {
    let s = corpTurn(blank());
    const [fence] = rig(s, 'street-fence');
    rejects(s, { type: 'trashContact', card: fence });
    s.ghost.heat = 1;
    s = act(s, { type: 'trashContact', card: fence });
    expect(s.ghost.contacts).toEqual([]);
    expect(s.ghost.discard).toEqual([fence]);
    expect(s.corp.credits).toBe(8);
  });
});

describe('Ghost actions', () => {
  it('programs need free RAM; programs can be trashed only while installing a program (CR 8.5.6c)', () => {
    let s = ghostTurn(blank(), 20);
    const installed = rig(s, 'crowbar', 'crowbar', 'skeleton-key');
    const [knife, probe] = hand(s, 'ghost', 'jackknife', 'deep-probe');
    expect(rejects(s, { type: 'install', card: knife })).toMatch(/RAM/);
    s = act(s, { type: 'install', card: probe });
    rejects(s, { type: 'install', card: knife });
    expect(legalActions(s).some((a) => a.type === ('scrap' as string))).toBe(false);
    // install, trashing programs as part of it: the cycle is spent when the install finishes
    s = act(s, { type: 'install', card: knife, trash: true });
    expect(s.ghost.cycles).toBe(3);
    expect(legalActions(s)).not.toContainEqual({ type: 'confirmInstall' }); // not enough RAM yet
    s = act(s, { type: 'pickTrash', card: installed[0] });
    expect(legalActions(s)).not.toContainEqual({ type: 'confirmInstall' });
    s = act(s, { type: 'pickTrash', card: installed[1] });
    s = act(s, { type: 'confirmInstall' });
    expect(s.ghost.cycles).toBe(2);
    expect(s.ghost.programs).toContain(knife);
    expect(s.ghost.discard).toEqual(expect.arrayContaining([installed[0], installed[1]]));
    // taking an install back costs nothing
    const [blade] = hand(s, 'ghost', 'stiletto');
    let t = act(s, { type: 'install', card: blade, trash: true });
    t = act(t, { type: 'cancelInstall' });
    expect(t.ghost.cycles).toBe(2);
    expect(t.ghost.hand).toContain(blade);
  });
  it('programs over the RAM limit must be trashed at once (CR 3.9.3c)', () => {
    let s = ghostTurn(blank(), 20);
    const [brick] = rig(s, 'ram-brick');
    const progs = rig(s, 'crowbar', 'crowbar', 'crowbar', 'skeleton-key', 'stiletto');
    s = structuredClone(s);
    s.ghost.gear = s.ghost.gear.filter((g) => g !== brick); // RAM drops from 6 to 4
    s.ghost.discard.push(brick);
    expect(actor(s)).toBe('ghost');
    expect(legalActions(s).every((a) => a.type === 'shedProgram')).toBe(true);
    s = actRaw(s, { type: 'shedProgram', card: progs[0] });
    expect(legalActions(s).every((a) => a.type !== 'shedProgram')).toBe(true);
  });
  it('shedding heat costs a cycle and 2 credits', () => {
    let s = ghostTurn(blank(), 3);
    rejects(s, { type: 'shedHeat' });
    s.ghost.heat = 2;
    s = act(s, { type: 'shedHeat' });
    expect([s.ghost.heat, s.ghost.credits, s.ghost.cycles]).toEqual([1, 1, 3]);
    rejects(s, { type: 'shedHeat' });
  });
  it('cannot afford: rejected with a reason', () => {
    const s = ghostTurn(blank(), 1);
    const [c] = hand(s, 'ghost', 'sledge');
    expect(rejects(s, { type: 'install', card: c })).toMatch(/costs 4/);
  });
});

describe('installing (CR 8.5.6)', () => {
  it('ICE: the Corp may trash ICE on that node first, and those do not count toward the cost', () => {
    let s = corpTurn(blank(), 0);
    const old = [ice(s, 'command', 'bulkhead'), ice(s, 'command', 'tripwire', false)];
    const [wall] = hand(s, 'corp', 'bulkhead');
    expect(legalActions(s)).not.toContainEqual({ type: 'install', card: wall, node: 'command' }); // costs 2
    s = act(s, { type: 'install', card: wall, node: 'command', trash: true });
    expect(legalActions(s)).toEqual([{ type: 'pickTrash', card: old[0] }, { type: 'pickTrash', card: old[1] }, { type: 'cancelInstall' }]);
    s = act(s, { type: 'pickTrash', card: old[0] });
    s = act(s, { type: 'pickTrash', card: old[1] });
    s = act(s, { type: 'confirmInstall' });
    expect(nodeOf(s, 'command').ice.map((i) => i.card)).toEqual([wall]);
    expect(s.corp.discard).toEqual(old);
    expect(s.corp.discardSeen).toEqual([old[0]]); // the active one goes faceup, the facedown one stays facedown
    expect(s.corp.cycles).toBe(2);
  });
  it('root: an upgrade or a new root card may trash cards in that root; a project or asset always replaces the old one', () => {
    let s = corpTurn(blank());
    const { id, card: shell } = site(s, 'shell-company');
    const up = upgrade(s, id, 'choke-point');
    const [lab, relay] = hand(s, 'corp', 'decoy-lab', 'lockout-relay');
    s = act(s, { type: 'install', card: relay, node: id, trash: true });
    expect(legalActions(s)).toContainEqual({ type: 'pickTrash', card: shell });
    s = act(s, { type: 'pickTrash', card: up });
    s = act(s, { type: 'confirmInstall' });
    expect(nodeOf(s, id).upgrades.map((u) => u.card)).toEqual([relay]);
    s = act(s, { type: 'install', card: lab, node: id });
    expect(nodeOf(s, id).root!.card).toBe(lab);
    expect(s.corp.discard).toEqual([up, shell]);
  });
  it('no limit on ICE per node or on sites; a site with nothing left in it is gone', () => {
    let s = corpTurn(blank(), 50);
    for (const def of ['tripwire', 'bulkhead', 'monolith', 'riddlegate', 'prism-lock', 'watchdog', 'razor-hound']) ice(s, 'command', def);
    const [w] = hand(s, 'corp', 'bulkhead');
    s = act(s, { type: 'install', card: w, node: 'command' });
    expect(nodeOf(s, 'command').ice).toHaveLength(8);
    for (const def of ['shell-company', 'shell-company', 'decoy-lab', 'decoy-lab', 'watch-desk', 'skyhook-contract', 'quiet-acquisition']) site(s, def);
    const [x] = hand(s, 'corp', 'skyhook-contract');
    expect(legalActions(s)).toContainEqual({ type: 'install', card: x, node: 'new' });
    let t = ghostTurn(blank(), 10);
    t.corp.credits = 0;
    const { id } = site(t, 'shell-company');
    t = act(t, { type: 'run', node: id });
    t = act(t, { type: 'trash' });
    expect(t.corp.nodes.some((n) => n.id === id)).toBe(false);
  });
});

describe('runs', () => {
  it('no ICE: the Ghost may still jack out before the node (CR 6.9.4); then the Mainframe shows the top card', () => {
    let s = ghostTurn(blank());
    const top = take(s, 'quarterly-windfall');
    s.corp.deck.push(top);
    const out = actRaw(s, { type: 'run', node: 'mainframe' });
    expect(out.run!.step).toBe('passed');
    expect(legalActions(out)).toEqual([{ type: 'continue' }, { type: 'jackOut' }]);
    expect(actRaw(out, { type: 'jackOut' }).flags.successfulRun).toBe(false);
    s = act(s, { type: 'run', node: 'mainframe' });
    expect(s.run!.step).toBe('access');
    expect(s.run!.accessing).toBe(top);
    expect(legalActions(s)).toEqual([{ type: 'leave' }]);
    s = act(s, { type: 'leave' });
    expect(s.run).toBeNull();
    expect(s.corp.deck.at(-1)).toBe(top);
    expect(s.flags.successfulRun).toBe(true);
  });
  it('Command: accesses one random card from the hand; projects are stolen', () => {
    let s = ghostTurn(blank());
    const [p] = hand(s, 'corp', 'skyhook-contract');
    s = act(s, { type: 'run', node: 'command' });
    expect(s.run!.accessing).toBe(p);
    expect(legalActions(s)).toEqual([{ type: 'steal' }]);
    s = act(s, { type: 'steal' });
    expect(points(s, 'ghost')).toBe(2);
    expect(s.corp.hand).toEqual([]);
  });
  it('the Dump: everything turns faceup and every project there is stolen', () => {
    let s = ghostTurn(blank());
    s.corp.discard.push(take(s, 'quiet-acquisition'), take(s, 'tripwire'), take(s, 'skyhook-contract'));
    expect(viewFor(s, 'ghost').corp.discard.every((c) => c.startsWith('?'))).toBe(true);
    s = act(s, { type: 'run', node: 'dump' });
    // the Ghost picks the order of the two projects; the tripwire is accessed with no decision to make
    expect(legalActions(s)).toEqual([{ type: 'access', i: 0 }, { type: 'access', i: 1 }]);
    expect(s.run!.accessed).toHaveLength(1);
    s = act(s, { type: 'access', i: 1 });
    expect(cardOf(s.run!.accessing!).id).toBe('skyhook-contract');
    s = act(s, { type: 'steal' });
    s = act(s, { type: 'steal' });
    expect(points(s, 'ghost')).toBe(3);
    expect(s.run).toBeNull();
    expect(viewFor(s, 'ghost').corp.discard).toEqual(s.corp.discard);
  });
  it('approach: the Corp may activate inactive ICE by paying its cost, or decline', () => {
    let s = ghostTurn(blank());
    const w = ice(s, 'command', 'bulkhead', false);
    s.corp.credits = 3;
    s = act(s, { type: 'run', node: 'command' });
    expect(s.run!.step).toBe('approach');
    expect(actor(s)).toBe('corp');
    expect(legalActions(s)).toEqual([{ type: 'activate', card: w }, { type: 'decline' }]);
    let declined = act(s, { type: 'decline' });
    // passing inactive ICE is still a movement step: the Ghost may jack out (CR 6.9.4c)
    expect(declined.run!.step).toBe('passed');
    declined = act(declined, { type: 'continue' });
    expect(declined.run).toBeNull(); // empty hand: nothing to access
    expect(declined.flags.successfulRun).toBe(true);
    s = act(s, { type: 'activate', card: w });
    expect(s.corp.credits).toBe(0);
    expect(s.run!.step).toBe('encounter');
    expect(actor(s)).toBe('ghost');
  });
  it('ICE the Corp cannot afford is passed without a Corp prompt, and the Ghost may jack out after it', () => {
    let s = ghostTurn(blank());
    ice(s, 'command', 'bulkhead', false);
    s.corp.credits = 2;
    hand(s, 'corp', 'tripwire');
    s = act(s, { type: 'run', node: 'command' });
    expect(s.run!.step).toBe('passed');
    expect(legalActions(s)).toEqual([{ type: 'continue' }, { type: 'jackOut' }]);
    s = act(s, { type: 'continue' });
    expect(s.run!.step).toBe('access');
  });
  it('encounter: boost to match strength, then break; boosts end with the encounter', () => {
    let s = ghostTurn(blank(), 10);
    const [bar] = rig(s, 'crowbar');
    ice(s, 'command', 'tripwire');
    ice(s, 'command', 'bulkhead'); // outermost
    hand(s, 'corp', 'recall');
    s = act(s, { type: 'run', node: 'command' });
    // Crowbar is strength 1, Bulkhead 4: cannot break yet
    rejects(s, { type: 'break', card: bar, sub: 0 });
    for (let i = 0; i < 3; i++) s = act(s, { type: 'boost', card: bar });
    rejects(s, { type: 'boost', card: bar });
    s = act(s, { type: 'break', card: bar, sub: 0 });
    expect(s.ghost.credits).toBe(6);
    rejects(s, { type: 'break', card: bar, sub: 0 });
    s = act(s, { type: 'proceed' });
    expect(s.run!.step).toBe('passed');
    s = act(s, { type: 'continue' });
    // Tripwire is strength 1: the boost from before is gone, but Crowbar is already strong enough
    expect(s.run!.boost).toEqual({});
    s = act(s, { type: 'break', card: bar, sub: 0 });
    s = act(s, { type: 'proceed' });
    s = act(s, { type: 'continue' });
    expect(s.run!.step).toBe('access');
  });
  it('a breaker only works on its own ICE type; Jackknife works on any', () => {
    let s = ghostTurn(blank(), 10);
    const [bar, knife] = rig(s, 'crowbar', 'jackknife');
    ice(s, 'command', 'riddlegate');
    s = act(s, { type: 'run', node: 'command' });
    const legal = legalActions(s);
    expect(legal.some((a) => 'card' in a && a.card === bar)).toBe(false);
    expect(legal).toContainEqual({ type: 'boost', card: knife });
  });
  it('an unbroken "end the run" ends it: no access, not a successful run', () => {
    let s = ghostTurn(blank());
    ice(s, 'command', 'tripwire');
    hand(s, 'corp', 'skyhook-contract');
    s = act(s, { type: 'run', node: 'command' });
    s = act(s, { type: 'proceed' });
    expect(s.run).toBeNull();
    expect(s.phase).toBe('action');
    expect(s.flags.successfulRun).toBe(false);
    expect(s.ghost.cycles).toBe(3);
  });
  it('jacking out after passing ICE ends the run without access', () => {
    let s = ghostTurn(blank());
    ice(s, 'command', 'watchdog');
    hand(s, 'corp', 'skyhook-contract');
    hand(s, 'ghost', 'crowbar', 'crowbar');
    s = act(s, { type: 'run', node: 'command' });
    s = act(s, { type: 'proceed' });
    expect(s.run!.step).toBe('passed');
    s = act(s, { type: 'jackOut' });
    expect(s.run).toBeNull();
    expect(points(s, 'ghost')).toBe(0);
  });
  it('a site: accesses the installed card; assets can be trashed for their cost', () => {
    let s = ghostTurn(blank(), 3);
    const { id, card } = site(s, 'shell-company', { active: true });
    s = act(s, { type: 'run', node: id });
    expect(legalActions(s)).toEqual([{ type: 'trash' }, { type: 'leave' }]);
    s = act(s, { type: 'trash' });
    expect(s.ghost.credits).toBe(0);
    expect(s.corp.discard).toEqual([card]);
    expect(s.corp.discardSeen).toEqual([card]);
    expect(s.corp.nodes.some((n) => n.id === id)).toBe(false); // an empty site is gone (CR 8.5.8)
  });
  it('a facedown card the Ghost accessed and left stays known to the Ghost', () => {
    let s = ghostTurn(blank(), 0);
    const { id, card } = site(s, 'shell-company');
    s.corp.credits = 0; // so the Corp cannot activate it as the run reaches the site
    expect(viewFor(s, 'ghost').corp.nodes.at(-1)!.root!.card).toMatch(/^\?/);
    s = act(s, { type: 'run', node: id });
    expect(legalActions(s)).toEqual([{ type: 'leave' }]); // cannot afford the trash cost
    s = act(s, { type: 'leave' });
    expect(viewFor(s, 'ghost').corp.nodes.at(-1)!.root!.card).toBe(card);
  });
  it('7 points wins for the Ghost, even mid-access', () => {
    let s = ghostTurn(blank());
    s.ghost.scored.push(take(s, 'orbital-mandate'), take(s, 'orbital-mandate'));
    const a = take(s, 'quiet-acquisition');
    s.corp.deck.push(a);
    s = act(s, { type: 'run', node: 'mainframe' });
    s = act(s, { type: 'steal' });
    expect(s.winner).toBe('ghost');
    expect(s.phase).toBe('gameOver');
    expect(s.run).toBeNull();
  });
});

describe('damage', () => {
  it('discards that many cards at random', () => {
    let s = ghostTurn(blank());
    ice(s, 'command', 'razor-hound');
    hand(s, 'ghost', 'crowbar', 'crowbar', 'crowbar');
    s = act(s, { type: 'run', node: 'command' });
    s = act(s, { type: 'proceed' });
    expect(s.ghost.hand).toHaveLength(1);
    expect(s.ghost.discard).toHaveLength(2);
    expect(s.phase).not.toBe('gameOver');
  });
  it('exactly as much damage as cards is survivable; more is a flatline', () => {
    let s = ghostTurn(blank());
    ice(s, 'command', 'razor-hound');
    hand(s, 'ghost', 'crowbar', 'crowbar');
    s = act(s, { type: 'run', node: 'command' });
    const lived = act(s, { type: 'proceed' });
    expect(lived.ghost.hand).toHaveLength(0);
    expect(lived.winner).toBeNull();
    s.ghost.discard.push(s.ghost.hand.pop()!);
    const died = act(s, { type: 'proceed' });
    expect(died.winner).toBe('corp');
    expect(died.winReason).toMatch(/flatlined/);
  });
});

describe('hidden information', () => {
  it('the Ghost view hides the Corp hand, deck, facedown cards and the rng; events lose private text', () => {
    let s = blank();
    const [w, p] = hand(s, 'corp', 'bulkhead', 'skyhook-contract');
    hand(s, 'corp', 'burn-notice');
    s = act(s, { type: 'install', card: w, node: 'command' });
    s = act(s, { type: 'install', card: p, node: 'new' });
    const v = viewFor(s, 'ghost');
    const text = JSON.stringify(v);
    expect(text).not.toContain('bulkhead');
    expect(text).not.toContain('skyhook');
    expect(text).not.toContain('Skyhook');
    expect(text).not.toContain('burn-notice');
    expect(v.corp.hand).toHaveLength(1);
    expect(v.corp.deck).toHaveLength(s.corp.deck.length);
    expect(v.rngState).toBe(0);
    // the Corp reads its own private log lines
    expect(JSON.stringify(viewFor(s, 'corp').events)).toContain('You install Skyhook Contract');
  });
  it('the Corp view hides the Ghost hand and deck', () => {
    const s = blank();
    hand(s, 'ghost', 'jackknife');
    const text = JSON.stringify(viewFor(s, 'corp'));
    expect(text).not.toContain('jackknife');
    expect(viewFor(s, 'corp').ghost.hand).toHaveLength(1);
  });
  it('activated ICE is public', () => {
    const s = blank();
    const w = ice(s, 'command', 'bulkhead', true);
    expect(viewFor(s, 'ghost').corp.nodes[0].ice[0].card).toBe(w);
  });
});

describe('upgrades', () => {
  it('install for 1 cycle in any node, central or site, without replacing what is there', () => {
    let s = corpTurn(blank());
    const [a, b, p] = hand(s, 'corp', 'choke-point', 'lockout-relay', 'skyhook-contract');
    s = act(s, { type: 'install', card: a, node: 'command' });
    expect(nodeOf(s, 'command').upgrades.map((u) => u.card)).toEqual([a]);
    expect(nodeOf(s, 'command').root).toBeNull();
    expect(s.corp.credits).toBe(10);
    s = act(s, { type: 'install', card: p, node: 'new' });
    s = act(s, { type: 'install', card: b, node: 'site1' });
    expect(nodeOf(s, 'site1').root!.card).toBe(p);
    expect(nodeOf(s, 'site1').upgrades.map((u) => u.card)).toEqual([b]);
    // replacing the project leaves the upgrade
    s = corpTurn(s);
    const [q] = hand(s, 'corp', 'shell-company');
    s = act(s, { type: 'install', card: q, node: 'site1' });
    expect(nodeOf(s, 'site1').upgrades).toHaveLength(1);
  });
  it('are facedown to the Ghost until active; activated on the Corp turn for their cost', () => {
    let s = corpTurn(blank());
    const u = upgrade(s, 'command', 'choke-point');
    expect(viewFor(s, 'ghost').corp.nodes[0].upgrades[0].card).toMatch(/^\?/);
    s = act(s, { type: 'activate', card: u });
    expect(s.corp.credits).toBe(8);
    expect(viewFor(s, 'ghost').corp.nodes[0].upgrades[0].card).toBe(u);
  });
  it('are accessed with the node: after the normal access, and can be trashed for their cost', () => {
    let s = ghostTurn(blank(), 10);
    s.corp.credits = 0;
    const top = take(s, 'tripwire');
    s.corp.deck.push(top);
    const u = upgrade(s, 'mainframe', 'lockout-relay');
    s = act(s, { type: 'run', node: 'mainframe' });
    // the Ghost chooses the order: the upgrade, or the top of the Mainframe (CR 7.3.4)
    expect(legalActions(s)).toEqual([{ type: 'access', i: 0 }, { type: 'access', zone: true }]);
    s = act(s, { type: 'access', zone: true });
    expect(s.run!.accessing).toBe(top);
    s = act(s, { type: 'leave' });
    expect(s.run!.accessing).toBe(u);
    expect(legalActions(s)).toEqual([{ type: 'trash' }, { type: 'leave' }]);
    s = act(s, { type: 'trash' });
    expect(s.ghost.credits).toBe(7);
    expect(nodeOf(s, 'mainframe').upgrades).toEqual([]);
    expect(s.corp.discard).toContain(u);
  });
  it('a site holding only an upgrade can be run', () => {
    let s = corpTurn(blank());
    const [a] = hand(s, 'corp', 'choke-point');
    s = act(s, { type: 'install', card: a, node: 'new' });
    s = ghostTurn(s);
    expect(legalActions(s)).toContainEqual({ type: 'run', node: 'site1' });
  });
});

describe('the Corp window when a run reaches its node', () => {
  it('comes after the Ghost passes all ICE and declines to jack out; it is skipped when the Corp has nothing to do', () => {
    let s = ghostTurn(blank());
    s.corp.credits = 1;
    const { card: shell } = site(s, 'shell-company');
    s = actRaw(s, { type: 'run', node: 'mainframe' });
    expect(s.run!.step).toBe('initiation');
    s = actRaw(s, { type: 'decline' });
    expect(s.run!.step).toBe('passed');
    s = actRaw(s, { type: 'continue' });
    expect(s.run!.step).toBe('approachNode');
    expect(actor(s)).toBe('corp');
    expect(legalActions(s)).toEqual([{ type: 'activate', card: shell }, { type: 'decline' }]);
    s = actRaw(s, { type: 'decline' });
    expect(s.run!.step).toBe('access');
    let t = ghostTurn(blank());
    t.corp.credits = 0;
    t = actRaw(t, { type: 'run', node: 'mainframe' });
    t = actRaw(t, { type: 'continue' });
    expect(t.run!.step).toBe('access');
  });
  it('offers every inactive non-trap asset and upgrade the Corp can afford, anywhere', () => {
    let s = ghostTurn(blank());
    s.corp.credits = 1;
    const { card: shell } = site(s, 'shell-company');
    site(s, 'decoy-lab');
    upgrade(s, 'command', 'choke-point'); // costs 2: too much
    const relay = upgrade(s, 'dump', 'lockout-relay');
    s = actRaw(s, { type: 'run', node: 'mainframe' });
    expect(s.run!.step).toBe('initiation');
    expect(legalActions(s)).toEqual([{ type: 'activate', card: relay }, { type: 'activate', card: shell }, { type: 'decline' }]);
  });
  it('spending on another card while approaching ICE it can then not afford: the Ghost slips past', () => {
    let s = ghostTurn(blank());
    s.corp.credits = 3;
    const wall = ice(s, 'mainframe', 'bulkhead', false);
    const cp = upgrade(s, 'mainframe', 'choke-point');
    s = actRaw(s, { type: 'run', node: 'mainframe' });
    s = actRaw(s, { type: 'activate', card: cp });
    expect(s.corp.credits).toBe(1);
    // nothing more it could do: the window closes, the approach window is skipped, the Ghost passes
    expect(s.run!.step).toBe('passed');
    expect(nodeOf(s, 'mainframe').ice[0]).toMatchObject({ card: wall, active: false });
  });
  it('Blackout stops ICE activation only; the Corp still gets its window', () => {
    let s = ghostTurn(blank());
    const [b] = hand(s, 'ghost', 'blackout');
    const { card: desk } = site(s, 'watch-desk');
    s = actRaw(s, { type: 'play', card: b, node: 'mainframe' });
    expect(legalActions(s)).toContainEqual({ type: 'activate', card: desk });
  });
});

describe('priority windows outside runs (CR 5.6, 5.7)', () => {
  it('the Corp may activate at the start of its turn, before the turn begins: a start-of-turn card then pays at once', () => {
    let s = corpTurn(blank(), 1);
    const { card: shell } = site(s, 'shell-company');
    s.corp.cycles = 0;
    s = act(s, { type: 'endTurn' });
    // the Ghost's turn: the Corp gets windows, but has nothing worth doing; pass them
    s = passWindows(s);
    s.ghost.cycles = 0;
    s = act(s, { type: 'endTurn' });
    while (s.window && s.turn === 'ghost') s = actRaw(s, { type: 'pass' });
    // the Corp's turn starts: its window comes before the draw and before Shell Company could trigger
    expect(s.turn).toBe('corp');
    expect(s.window).toMatchObject({ at: 'turnStart', who: 'corp' });
    expect(legalActions(s)).toEqual([{ type: 'activate', card: shell }, { type: 'pass' }]);
    const deck = s.corp.deck.length;
    s = actRaw(s, { type: 'activate', card: shell });
    expect(s.window).toBeNull();
    expect(s.corp.credits).toBe(1); // paid 1, then gained 1 when the turn began
    expect(s.corp.deck.length).toBe(deck - 1); // the draw comes after
  });
  it('the Corp may score in its start-of-turn window', () => {
    let s = corpTurn(blank());
    const { card } = site(s, 'skyhook-contract', { dev: 9 });
    s.corp.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.window).toBeNull();
    s.ghost.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.window).toMatchObject({ at: 'turnStart', who: 'corp' });
    expect(legalActions(s)).toContainEqual({ type: 'score', card });
  });
  it('before each Ghost action the Corp may activate assets and upgrades; not after the last cycle', () => {
    let s = ghostTurn(blank(), 5);
    s.corp.credits = 1;
    const { card: shell } = site(s, 'shell-company');
    s = act(s, { type: 'credit' });
    expect(s.window).toMatchObject({ at: 'beforeAction', who: 'corp' });
    expect(actor(s)).toBe('corp');
    s = actRaw(s, { type: 'pass' });
    expect(actor(s)).toBe('ghost');
    // a run is one action: the window opens once it is over
    s = actRaw(s, { type: 'run', node: 'command' });
    expect(s.window).toBeNull();
    s = actRaw(s, { type: 'decline' }); // the run's initiation window
    s = actRaw(s, { type: 'continue' });
    s = actRaw(s, { type: 'decline' }); // the Corp's last window before the node
    expect(s.run).toBeNull();
    expect(s.window).toMatchObject({ at: 'beforeAction', who: 'corp' });
    s = actRaw(s, { type: 'activate', card: shell });
    expect(s.window).toBeNull(); // nothing more it could do
    s = act(s, { type: 'credit' });
    s = act(s, { type: 'credit' });
    expect(s.ghost.cycles).toBe(0);
    expect(s.window).toBeNull();
  });
  it('after discarding at the end of a turn, both sides get one last window', () => {
    let s = ghostTurn(blank(), 5);
    s.corp.credits = 1;
    site(s, 'shell-company');
    s.ghost.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.window).toMatchObject({ at: 'turnEnd', who: 'corp' });
    s = actRaw(s, { type: 'pass' });
    expect(s.turn).toBe('corp');
  });
  it('Ghost abilities that cost no cycle work in run windows; "on your turn" ones only on the Ghost turn', () => {
    let s = ghostTurn(blank(), 5);
    s.ghost.heat = 2;
    const [phone] = rig(s, 'burner-phone');
    ice(s, 'command', 'bulkhead', true);
    s = act(s, { type: 'run', node: 'command' });
    expect(s.run!.step).toBe('encounter');
    expect(legalActions(s)).toContainEqual({ type: 'use', card: phone });
    let t = corpTurn(blank());
    t.ghost.heat = 2;
    rig(t, 'burner-phone');
    t = act(t, { type: 'credit' });
    expect(t.window).toBeNull();
  });
});

describe('damage kinds', () => {
  it('net, meat and core damage all discard at random; only core lowers hand size', () => {
    for (const [def, core] of [['watchdog', 0], ['synapse-spike', 1]] as const) {
      let s = ghostTurn(blank());
      hand(s, 'ghost', 'crowbar', 'crowbar');
      ice(s, 'command', def);
      s = act(s, { type: 'run', node: 'command' });
      s = act(s, { type: 'proceed' });
      expect(s.ghost.hand).toHaveLength(1);
      expect(s.ghost.core).toBe(core);
    }
  });
  it('a maximum hand size below 0 at the end of the Ghost turn flatlines them', () => {
    let s = ghostTurn(blank());
    s.ghost.core = 6;
    s.ghost.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.winner).toBe('corp');
    expect(s.winReason).toMatch(/flatlined/);
    // exactly 0 is survivable: discard everything
    let t = ghostTurn(blank());
    t.ghost.core = 5;
    t.ghost.cycles = 0;
    hand(t, 'ghost', 'crowbar');
    t = act(t, { type: 'endTurn' });
    expect(t.phase).toBe('discard');
    t = act(t, { type: 'discard', card: t.ghost.hand[0] });
    expect(t.turn).toBe('corp');
  });
});

describe('traces and link', () => {
  it('the Corp boosts first, then the Ghost; a tie goes to the Ghost; the Ghost is only offered what beating it takes', () => {
    let s = corpTurn(blank(), 20);
    s.ghostSuccessLastTurn = true;
    const [c] = hand(s, 'corp', 'records-request');
    s = act(s, { type: 'play', card: c });
    expect(legalActions(s)).toHaveLength(16); // 0..15
    s = act(s, { type: 'traceBoost', n: 0 }); // trace 4, link 0
    s.ghost.credits = 10;
    expect(legalActions(s).map((a) => (a as { n: number }).n)).toEqual([0, 1, 2, 3, 4]);
    s = act(s, { type: 'traceBoost', n: 4 }); // link 4 ties: the Ghost evades
    expect(s.ghost.heat).toBe(0);
    expect(s.trace).toBeNull();
    expect(actor(s)).toBe('corp');
  });
  it('link from identity and gear counts', () => {
    let s = corpTurn(blank('ghost', { ghost: 'wren-ortiz' }), 0);
    rig(s, 'signal-booster');
    s.ghost.credits = 0;
    s.ghostSuccessLastTurn = true;
    s.corp.credits = 1;
    const [c] = hand(s, 'corp', 'records-request');
    s = act(s, { type: 'play', card: c });
    s = act(s, { type: 'traceBoost', n: 0 }); // 4 against link 3
    expect(legalActions(s)).toEqual([{ type: 'traceBoost', n: 0 }]); // the Ghost has no money
    s = act(s, { type: 'traceBoost', n: 0 });
    expect(s.ghost.heat).toBe(1);
  });
});

describe('bad publicity', () => {
  it('gives the Ghost that many credits for each run, spent before their own and gone when the run ends', () => {
    let s = ghostTurn(blank(), 1);
    s.corp.badPublicity = 2;
    const [key] = rig(s, 'skeleton-key');
    ice(s, 'command', 'riddlegate');
    s = act(s, { type: 'run', node: 'command' });
    expect(s.run!.bpCredits).toBe(2);
    s = act(s, { type: 'break', card: key, sub: 0 });
    s = act(s, { type: 'break', card: key, sub: 1 });
    expect(s.ghost.credits).toBe(1); // both breaks paid from bad publicity credits
  });
  it('unspent bad publicity credits do not carry over', () => {
    let s = ghostTurn(blank(), 0);
    s.corp.badPublicity = 3;
    s.corp.credits = 0;
    s = act(s, { type: 'run', node: 'command' });
    expect(s.run).toBeNull();
    expect(s.ghost.credits).toBe(0);
  });
});

describe('viruses and purging', () => {
  it('purging takes all 3 Corp cycles and removes every virus counter', () => {
    let s = corpTurn(blank());
    const [t] = rig(s, 'termite-script');
    s.ghost.virus[t] = 3;
    s = act(s, { type: 'credit' });
    expect(legalActions(s)).not.toContainEqual({ type: 'purge' });
    s = corpTurn(s);
    s = act(s, { type: 'purge' });
    expect(s.ghost.virus).toEqual({});
    expect(s.corp.cycles).toBe(0);
  });
});

describe('recurring credits and hosting', () => {
  it('recurring credits go away with the card; a trashed host takes its hosted programs with it', () => {
    const r = loadPack({
      name: 'host test',
      cards: [
        { id: 'plain-corp', name: 'Plain Corp', side: 'corp', type: 'identity', copies: 1, text: 'Identity.' },
        { id: 'plain-ghost', name: 'Plain Ghost', side: 'ghost', type: 'identity', copies: 1, text: 'Identity.' },
        { id: 'flimsy-rack', name: 'Flimsy Rack', side: 'ghost', type: 'gear', copies: 1, cost: 0, host: { max: 1 },
          recurring: { n: 1, for: 'any' }, ability: { cycles: 0, trashSelf: true, effects: [{ op: 'gain', n: 1 }] },
          text: 'Can host 1 program, which uses no RAM. 1 recurring credit. Trash this (no cycle): gain 1 credit.' },
      ],
    });
    if (!r.ok) throw new Error(r.errors.join());
    let s = newGame({ seed: 2, human: 'ghost', setup: r.setup });
    s = act(act(s, { type: 'keep' }), { type: 'keep' });
    s = ghostTurn(structuredClone(s));
    for (const side of ['corp', 'ghost'] as const) s[side].deck.push(...s[side].hand.splice(0));
    const rack = take(s, r.setup.cards[2].id);
    s.ghost.hand.push(rack);
    s = act(s, { type: 'install', card: rack });
    expect(s.ghost.recurring[rack]).toBe(1);
    const [knife] = hand(s, 'ghost', 'stiletto');
    s = act(s, { type: 'install', card: knife, host: rack });
    s = act(s, { type: 'use', card: rack });
    expect(s.ghost.programs).toEqual([]);
    expect(s.ghost.discard).toEqual(expect.arrayContaining([rack, knife]));
    expect(s.ghost.recurring).toEqual({});
    expect(s.ghost.hosted).toEqual({});
  });
});

describe('identities', () => {
  it('are public, start in play, and are not part of any deck', () => {
    const s = newGame({ seed: 1, human: 'ghost', identities: { corp: 'vigil-systems', ghost: 'halcyon' } });
    expect(s.corp.identity).toBe('vigil-systems#1');
    expect(viewFor(s, 'ghost').corp.identity).toBe('vigil-systems#1');
    expect(deckList('corp')).not.toContain('helix-dynamics#1');
    expect(maxHand(s, 'ghost')).toBe(6);
  });
});

describe('state copies', () => {
  it('apply and viewFor share the event log and setup but never change them', () => {
    const s = blank();
    const events = s.events.slice();
    const decks = JSON.stringify(s.setup.decks);
    const next = act(s, { type: 'credit' });
    expect(s.events).toEqual(events);
    expect(next.events.length).toBe(events.length + 1);
    expect(next.events[0]).toBe(s.events[0]); // shared, not copied
    const v = viewFor(s, 'ghost');
    expect(v.setup.decks.corp).toEqual({});
    expect(JSON.stringify(s.setup.decks)).toBe(decks); // the hidden deck list was removed from the view only
  });
});
