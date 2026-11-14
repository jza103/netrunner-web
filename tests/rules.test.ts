import { describe, expect, it } from 'vitest';
import { CARDS, cardOf, deckList } from '../src/engine/cards';
import { legalActions } from '../src/engine/legal';
import { actor, newGame, nodeOf, points } from '../src/engine/state';
import { viewFor } from '../src/engine/view';
import { act, actRaw, blank, corpTurn, ghostTurn, hand, ice, rejects, rig, site, take, upgrade } from './helpers';

describe('card data', () => {
  it('every card has the fields its type needs', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.name && c.copies > 0, c.id).toBeTruthy();
      if (c.type === 'project') expect(c.dev! > 0 && c.points! > 0, c.id).toBe(true);
      else expect(c.cost, c.id).toBeTypeOf('number');
      if (c.type === 'ice') expect(c.subs!.length > 0 && c.strength! > 0 && !!c.subtype, c.id).toBe(true);
      if (c.type === 'asset' || c.type === 'upgrade') expect(c.trash, c.id).toBeTypeOf('number');
      if (c.type === 'program') expect(c.ram, c.id).toBeTypeOf('number');
      expect(c.type === 'ice' || !!c.breaker || c.text.length > 0, `${c.id} has rules text`).toBe(true);
      expect(['corp', 'ghost']).toContain(c.side);
    }
  });
  it('decks: 52 Corp cards with 21 project points, 41 Ghost cards', () => {
    expect(deckList('corp')).toHaveLength(52);
    expect(deckList('ghost')).toHaveLength(41);
    expect(deckList('corp').reduce((n, c) => n + (cardOf(c).points ?? 0), 0)).toBe(21);
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
  it('programs need free RAM; scrapping one frees it', () => {
    let s = ghostTurn(blank(), 20);
    const installed = rig(s, 'crowbar', 'crowbar', 'skeleton-key');
    const [knife, probe] = hand(s, 'ghost', 'jackknife', 'deep-probe');
    expect(rejects(s, { type: 'install', card: knife })).toMatch(/RAM/);
    s = act(s, { type: 'install', card: probe });
    rejects(s, { type: 'install', card: knife });
    s = act(s, { type: 'scrap', card: installed[0] });
    s = act(s, { type: 'scrap', card: installed[1] });
    expect(s.ghost.cycles).toBe(3); // scrapping costs no cycle
    s = act(s, { type: 'install', card: knife });
    expect(s.ghost.programs).toContain(knife);
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

describe('runs', () => {
  it('no ICE: straight to access; Mainframe shows the top card', () => {
    let s = ghostTurn(blank());
    const top = take(s, 'quarterly-windfall');
    s.corp.deck.push(top);
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
    expect(actor(s)).toBe('corp');
    const declined = act(s, { type: 'decline' });
    expect(declined.run).toBeNull(); // empty hand: nothing to access
    expect(declined.flags.successfulRun).toBe(true);
    s = act(s, { type: 'activate', card: w });
    expect(s.corp.credits).toBe(0);
    expect(s.run!.step).toBe('encounter');
    expect(actor(s)).toBe('ghost');
  });
  it('ICE the Corp cannot afford is passed without asking', () => {
    let s = ghostTurn(blank());
    ice(s, 'command', 'bulkhead', false);
    s.corp.credits = 2;
    hand(s, 'corp', 'tripwire');
    s = act(s, { type: 'run', node: 'command' });
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
    expect(nodeOf(s, id).root).toBeNull();
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
  it('comes after all ICE is passed, even with nothing to activate, so it gives nothing away', () => {
    let s = ghostTurn(blank());
    s.corp.credits = 0;
    s = actRaw(s, { type: 'run', node: 'mainframe' });
    expect(s.run!.step).toBe('approachNode');
    expect(actor(s)).toBe('corp');
    expect(legalActions(s)).toEqual([{ type: 'decline' }]);
    s = actRaw(s, { type: 'decline' });
    expect(s.run!.step).toBe('access');
  });
  it('offers every inactive non-trap asset and upgrade the Corp can afford, anywhere', () => {
    let s = ghostTurn(blank());
    s.corp.credits = 1;
    const { card: shell } = site(s, 'shell-company');
    site(s, 'decoy-lab');
    upgrade(s, 'command', 'choke-point'); // costs 2: too much
    const relay = upgrade(s, 'dump', 'lockout-relay');
    s = actRaw(s, { type: 'run', node: 'mainframe' });
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
    expect(s.run!.step).toBe('approachNode');
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
