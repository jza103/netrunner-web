// One block per card: each does exactly what its text says.
import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/engine/cards';
import { legalActions } from '../src/engine/legal';
import { actor, maxHand, nodeOf, points, ramLimit } from '../src/engine/state';
import { viewFor } from '../src/engine/view';
import { act, blank, corpTurn, ghostTurn, hand, ice, rejects, rig, site, take } from './helpers';

const tested = new Set<string>();
function card(id: string, name: string, fn: () => void) {
  tested.add(id);
  it(`${id}: ${name}`, fn);
}

describe('projects', () => {
  card('skyhook-contract', 'needs 3 counters, 2 points, pays 4 credits when scored', () => {
    let s = corpTurn(blank(), 0);
    const { card: c } = site(s, 'skyhook-contract', { dev: 2 });
    rejects(s, { type: 'score', card: c });
    nodeOf(s, 'site1').root!.dev = 3;
    s = act(s, { type: 'score', card: c });
    expect(points(s, 'corp')).toBe(2);
    expect(s.corp.credits).toBe(4);
  });
  card('quiet-acquisition', 'needs 2 counters, 1 point, draws 2 when scored', () => {
    let s = corpTurn(blank());
    const { card: c } = site(s, 'quiet-acquisition', { dev: 2 });
    s = act(s, { type: 'score', card: c });
    expect(points(s, 'corp')).toBe(1);
    expect(s.corp.hand).toHaveLength(2);
  });
  card('orbital-mandate', 'needs 5 counters, 3 points, gives the Ghost 2 heat when scored', () => {
    let s = corpTurn(blank());
    const { card: c } = site(s, 'orbital-mandate', { dev: 4 });
    rejects(s, { type: 'score', card: c });
    s = act(s, { type: 'develop', card: c });
    s = act(s, { type: 'score', card: c });
    expect(points(s, 'corp')).toBe(3);
    expect(s.ghost.heat).toBe(2);
  });
  it('orbital-mandate: stealing it gives no heat', () => {
    let s = ghostTurn(blank());
    const { id } = site(s, 'orbital-mandate');
    s = act(s, { type: 'run', node: id });
    s = act(s, { type: 'steal' });
    expect(s.ghost.heat).toBe(0);
    expect(points(s, 'ghost')).toBe(3);
  });
  card('blacksite-ledger', 'costs the Ghost 3 credits to steal; otherwise it stays', () => {
    let s = ghostTurn(blank(), 2);
    const { id, card: c } = site(s, 'blacksite-ledger');
    s = act(s, { type: 'run', node: id });
    expect(legalActions(s)).toEqual([{ type: 'leave' }]);
    s = act(s, { type: 'leave' });
    expect(nodeOf(s, id).root!.card).toBe(c);
    s.ghost.credits = 3;
    s = act(s, { type: 'run', node: id });
    expect(legalActions(s)).toEqual([{ type: 'steal' }, { type: 'leave' }]);
    s = act(s, { type: 'steal' });
    expect(s.ghost.credits).toBe(0);
    expect(points(s, 'ghost')).toBe(2);
  });
});

/** Run into one active ICE with a hand of 4 and let every subroutine fire. */
function hit(def: string, setup: (s: ReturnType<typeof blank>) => void = () => {}) {
  let s = ghostTurn(blank(), 5);
  ice(s, 'command', def);
  hand(s, 'ghost', 'crowbar', 'crowbar', 'crowbar', 'fast-money');
  hand(s, 'corp', 'recall');
  setup(s);
  s = act(s, { type: 'run', node: 'command' });
  return act(s, { type: 'proceed' });
}

describe('ICE', () => {
  card('tripwire', 'wall 1/1: ends the run', () => {
    const s = hit('tripwire');
    expect(s.run).toBeNull();
    expect(s.flags.successfulRun).toBe(false);
  });
  card('bulkhead', 'wall, cost 3, strength 4: ends the run', () => {
    expect(CARDS.find((c) => c.id === 'bulkhead')).toMatchObject({ cost: 3, strength: 4, subtype: 'wall' });
    expect(hit('bulkhead').run).toBeNull();
  });
  card('monolith', 'wall 7/6: Corp gains 2, then ends the run (twice)', () => {
    const s = hit('monolith');
    expect(s.corp.credits).toBe(7);
    expect(s.run).toBeNull();
    // breaking only one "end the run" is not enough
    let t = ghostTurn(blank(), 20);
    const [sledge] = rig(t, 'sledge');
    ice(t, 'command', 'monolith');
    t = act(t, { type: 'run', node: 'command' });
    t = act(t, { type: 'boost', card: sledge });
    t = act(t, { type: 'break', card: sledge, sub: 1 });
    expect(act(t, { type: 'proceed' }).run).toBeNull();
    t = act(t, { type: 'break', card: sledge, sub: 2 });
    t = act(t, { type: 'proceed' });
    expect(t.run!.step).toBe('passed');
    expect(t.corp.credits).toBe(7); // the unbroken first subroutine still fired
  });
  card('riddlegate', 'cipher 2/2: Ghost loses 2 credits, then the run ends', () => {
    const s = hit('riddlegate');
    expect(s.ghost.credits).toBe(3);
    expect(s.run).toBeNull();
    const poor = hit('riddlegate', (x) => (x.ghost.credits = 1));
    expect(poor.ghost.credits).toBe(0);
  });
  card('prism-lock', 'cipher 5/4: Ghost loses 1 cycle if able, then the run ends', () => {
    const s = hit('prism-lock');
    expect(s.ghost.cycles).toBe(2); // 4, minus the run, minus 1
    expect(s.run).toBeNull();
    const last = hit('prism-lock', (x) => (x.ghost.cycles = 1));
    expect(last.ghost.cycles).toBe(0);
  });
  card('watchdog', 'hunter 2/2: 1 heat and 1 damage, and the run goes on', () => {
    const s = hit('watchdog');
    expect(s.ghost.heat).toBe(1);
    expect(s.ghost.hand).toHaveLength(3);
    expect(s.run!.step).toBe('passed');
  });
  card('razor-hound', 'hunter 4/3: 2 damage, then the Corp trashes a program of its choice', () => {
    const none = hit('razor-hound');
    expect(none.ghost.hand).toHaveLength(2);
    expect(none.run!.step).toBe('passed');
    const one = hit('razor-hound', (x) => rig(x, 'deep-probe'));
    expect(one.ghost.programs).toEqual([]);
    expect(one.ghost.discard).toHaveLength(3);
    let two = hit('razor-hound', (x) => rig(x, 'deep-probe', 'packet-skimmer'));
    expect(two.run!.step).toBe('corpTrash');
    expect(actor(two)).toBe('corp');
    const target = two.ghost.programs[1];
    two = act(two, { type: 'chooseTrash', card: target });
    expect(two.ghost.programs).toHaveLength(1);
    expect(two.ghost.discard).toContain(target);
    expect(two.run!.step).toBe('passed');
  });
  card('black-mamba', 'hunter 6/5: 3 damage, then the run ends', () => {
    const s = hit('black-mamba');
    expect(s.ghost.hand).toHaveLength(1);
    expect(s.run).toBeNull();
  });
});

describe('assets', () => {
  card('shell-company', 'activate for 1; pays 1 credit at the start of each Corp turn while active', () => {
    let s = corpTurn(blank(), 1);
    const { card: c } = site(s, 'shell-company');
    s.corp.cycles = 0;
    // inactive: no income
    let t = act(act(s, { type: 'endTurn' }), { type: 'credit' });
    t.ghost.cycles = 0;
    t = act(t, { type: 'endTurn' });
    expect(t.corp.credits).toBe(1);
    s = act(s, { type: 'activate', card: c });
    expect(s.corp.credits).toBe(0);
    s = act(s, { type: 'endTurn' });
    s.ghost.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.corp.credits).toBe(1);
    expect(viewFor(s, 'ghost').corp.nodes.at(-1)!.root!.card).toBe(c);
  });
  card('decoy-lab', 'accessed in a site: 2 damage plus 1 per counter; it can be developed; free to trash', () => {
    let s = corpTurn(blank());
    const { id, card: c } = site(s, 'decoy-lab');
    s = act(s, { type: 'develop', card: c });
    expect(nodeOf(s, id).root!.dev).toBe(1);
    rejects(s, { type: 'activate', card: c });
    s = ghostTurn(s);
    hand(s, 'ghost', 'crowbar', 'crowbar', 'crowbar', 'fast-money');
    s = act(s, { type: 'run', node: id });
    expect(s.ghost.hand).toHaveLength(1);
    expect(legalActions(s)).toEqual([{ type: 'trash' }, { type: 'leave' }]);
    s = act(s, { type: 'trash' });
    expect(s.ghost.credits).toBe(10);
    expect(s.corp.discard).toContain(c);
  });
  it('decoy-lab: enough counters flatlines a careless Ghost; from the hand it is harmless', () => {
    let s = ghostTurn(blank());
    const { id } = site(s, 'decoy-lab', { dev: 2 });
    hand(s, 'ghost', 'crowbar', 'crowbar', 'crowbar');
    expect(act(s, { type: 'run', node: id }).winner).toBe('corp');
    let t = ghostTurn(blank());
    hand(t, 'corp', 'decoy-lab');
    hand(t, 'ghost', 'crowbar');
    t = act(t, { type: 'run', node: 'command' });
    expect(t.ghost.hand).toHaveLength(1);
    expect(legalActions(t)).toContainEqual({ type: 'trash' });
  });
});

describe('directives', () => {
  card('quarterly-windfall', 'cost 4: gain 7', () => {
    let s = corpTurn(blank(), 4);
    const [c] = hand(s, 'corp', 'quarterly-windfall');
    s = act(s, { type: 'play', card: c });
    expect(s.corp.credits).toBe(7);
    expect(s.corp.cycles).toBe(2);
    expect(s.corp.discardSeen).toEqual([c]);
    s.corp.credits = 3;
    const [d] = hand(s, 'corp', 'quarterly-windfall');
    rejects(s, { type: 'play', card: d });
  });
  card('rapid-prototyping', 'cost 1: 2 counters on one installed developable card', () => {
    let s = corpTurn(blank(), 1);
    const [c] = hand(s, 'corp', 'rapid-prototyping');
    rejects(s, { type: 'play', card: c });
    const shell = site(s, 'shell-company');
    const proj = site(s, 'skyhook-contract');
    const decoy = site(s, 'decoy-lab');
    rejects(s, { type: 'play', card: c, target: shell.card });
    expect(act(s, { type: 'play', card: c, target: decoy.card }).corp.nodes.at(-1)!.root!.dev).toBe(2);
    s = act(s, { type: 'play', card: c, target: proj.card });
    expect(nodeOf(s, proj.id).root!.dev).toBe(2);
    expect(s.corp.credits).toBe(0);
  });
  card('burn-notice', 'needs heat; 1 damage plus 1 per heat', () => {
    let s = corpTurn(blank());
    const [c] = hand(s, 'corp', 'burn-notice');
    hand(s, 'ghost', 'crowbar', 'crowbar', 'crowbar', 'fast-money');
    expect(rejects(s, { type: 'play', card: c })).toMatch(/heat/);
    s.ghost.heat = 2;
    const hurt = act(s, { type: 'play', card: c });
    expect(hurt.ghost.hand).toHaveLength(1);
    expect(hurt.corp.credits).toBe(7);
    s.ghost.heat = 4;
    expect(act(s, { type: 'play', card: c }).winner).toBe('corp');
  });
  card('asset-freeze', 'needs heat; Ghost loses 3 credits per heat', () => {
    let s = corpTurn(blank());
    const [c] = hand(s, 'corp', 'asset-freeze');
    s.ghost.credits = 8;
    rejects(s, { type: 'play', card: c });
    s.ghost.heat = 2;
    expect(act(s, { type: 'play', card: c }).ghost.credits).toBe(2);
    s.ghost.heat = 3;
    expect(act(s, { type: 'play', card: c }).ghost.credits).toBe(0);
  });
  card('lockdown-audit', 'only after a successful Ghost run last turn: 1 heat', () => {
    let s = ghostTurn(blank());
    const [c] = hand(s, 'corp', 'lockdown-audit');
    ice(s, 'command', 'tripwire');
    // a failed run does not count
    s = act(s, { type: 'run', node: 'command' });
    s = act(s, { type: 'proceed' });
    s.ghost.cycles = 0;
    let t = act(s, { type: 'endTurn' });
    expect(rejects(t, { type: 'play', card: c })).toMatch(/successful/);
    // a successful one does
    s.ghost.cycles = 1;
    s = act(s, { type: 'run', node: 'mainframe' });
    s = act(s, { type: 'leave' });
    t = act(s, { type: 'endTurn' });
    t = act(t, { type: 'play', card: c });
    expect(t.ghost.heat).toBe(1);
    // and only for the turn right after
    for (let i = 0; i < 2; i++) t = act(t, { type: 'credit' });
    t = act(t, { type: 'endTurn' });
    for (let i = 0; i < 4; i++) t = act(t, { type: 'credit' });
    t = act(t, { type: 'endTurn' });
    const [d] = hand(t, 'corp', 'lockdown-audit');
    rejects(t, { type: 'play', card: d });
  });
  card('recall', 'shuffles the Dump into the Mainframe and leaves the game', () => {
    let s = corpTurn(blank());
    const [c] = hand(s, 'corp', 'recall');
    s.corp.discard.push(take(s, 'skyhook-contract'), take(s, 'tripwire'));
    s.corp.discardSeen.push(s.corp.discard[1]);
    const deck = s.corp.deck.length;
    s = act(s, { type: 'play', card: c });
    expect(s.corp.discard).toEqual([]);
    expect(s.corp.discardSeen).toEqual([]);
    expect(s.corp.deck).toHaveLength(deck + 2);
    expect(s.corp.removed).toEqual([c]);
  });
});

/** Break every subroutine of one ICE with one breaker and report what it cost. */
function breakThrough(breaker: string, iceDef: string): number {
  let s = ghostTurn(blank(), 30);
  const [b] = rig(s, breaker);
  ice(s, 'command', iceDef);
  s = act(s, { type: 'run', node: 'command' });
  for (;;) {
    const a = legalActions(s).find((x) => x.type === 'boost') ?? legalActions(s).find((x) => x.type === 'break');
    if (!a) break;
    expect('card' in a && a.card).toBe(b);
    s = act(s, a);
  }
  s = act(s, { type: 'proceed' });
  expect(s.run?.step).toBe('passed');
  return 30 - s.ghost.credits;
}

describe('breakers', () => {
  card('crowbar', 'wall breaker, strength 1, +1 for 1, break for 1', () => {
    expect(breakThrough('crowbar', 'tripwire')).toBe(1);
    expect(breakThrough('crowbar', 'bulkhead')).toBe(4);
    expect(breakThrough('crowbar', 'monolith')).toBe(8);
  });
  card('sledge', 'wall breaker, strength 3, +3 for 2, break for 1', () => {
    expect(breakThrough('sledge', 'tripwire')).toBe(1);
    expect(breakThrough('sledge', 'bulkhead')).toBe(3);
    expect(breakThrough('sledge', 'monolith')).toBe(5);
  });
  card('skeleton-key', 'cipher breaker, strength 2, +1 for 1, break for 1', () => {
    expect(breakThrough('skeleton-key', 'riddlegate')).toBe(2);
    expect(breakThrough('skeleton-key', 'prism-lock')).toBe(4);
  });
  card('stiletto', 'hunter breaker, strength 2, +2 for 2, break for 1', () => {
    expect(breakThrough('stiletto', 'watchdog')).toBe(2);
    expect(breakThrough('stiletto', 'razor-hound')).toBe(4);
    expect(breakThrough('stiletto', 'black-mamba')).toBe(6);
  });
  card('mirrorshade', 'hunter breaker, strength 4, +1 for 1, break for 1', () => {
    expect(breakThrough('mirrorshade', 'razor-hound')).toBe(2);
    expect(breakThrough('mirrorshade', 'black-mamba')).toBe(3);
  });
  card('jackknife', 'breaks any ICE, strength 1, 2 RAM', () => {
    expect(breakThrough('jackknife', 'tripwire')).toBe(1);
    expect(breakThrough('jackknife', 'riddlegate')).toBe(3);
    expect(breakThrough('jackknife', 'black-mamba')).toBe(6);
    expect(CARDS.find((c) => c.id === 'jackknife')!.ram).toBe(2);
  });
});

describe('other programs, gear and contacts', () => {
  card('packet-skimmer', '2 credits on the first successful run each turn only', () => {
    let s = ghostTurn(blank(), 0);
    rig(s, 'packet-skimmer');
    ice(s, 'dump', 'tripwire');
    s = act(s, { type: 'run', node: 'dump' });
    s = act(s, { type: 'proceed' }); // failed: nothing
    expect(s.ghost.credits).toBe(0);
    s = act(s, { type: 'run', node: 'command' });
    expect(s.ghost.credits).toBe(2);
    s = act(s, { type: 'run', node: 'command' });
    expect(s.ghost.credits).toBe(2);
  });
  card('deep-probe', 'one more Mainframe card per Probe, top first; not for other nodes', () => {
    let s = ghostTurn(blank());
    rig(s, 'deep-probe', 'deep-probe');
    const deck = s.corp.deck;
    const top3 = [deck.at(-1)!, deck.at(-2)!, deck.at(-3)!];
    s = act(s, { type: 'run', node: 'mainframe' });
    expect([s.run!.accessing, ...s.run!.accessQueue]).toEqual(top3);
    let t = ghostTurn(blank());
    rig(t, 'deep-probe');
    hand(t, 'corp', 'tripwire', 'bulkhead');
    t = act(t, { type: 'run', node: 'command' });
    expect(t.run!.accessQueue).toEqual([]);
  });
  card('ram-brick', '+2 RAM', () => {
    let s = ghostTurn(blank());
    const [c] = hand(s, 'ghost', 'ram-brick');
    expect(ramLimit(s)).toBe(4);
    s = act(s, { type: 'install', card: c });
    expect(ramLimit(s)).toBe(6);
    expect(s.ghost.credits).toBe(7);
  });
  card('padded-rig', '+1 hand size and prevents the first 1 damage each turn', () => {
    let s = ghostTurn(blank());
    rig(s, 'padded-rig');
    expect(maxHand(s, 'ghost')).toBe(6);
    ice(s, 'command', 'watchdog');
    hand(s, 'ghost', 'crowbar', 'crowbar');
    s = act(s, { type: 'run', node: 'command' });
    s = act(s, { type: 'proceed' });
    expect(s.ghost.hand).toHaveLength(2); // prevented
    s = act(s, { type: 'jackOut' });
    s = act(s, { type: 'run', node: 'command' });
    s = act(s, { type: 'proceed' });
    expect(s.ghost.hand).toHaveLength(1); // only the first each turn
    // it resets on the Corp's turn too
    s = act(s, { type: 'jackOut' });
    s = corpTurn(s);
    s.flags.prevented = 0;
    s.ghost.heat = 1;
    const [burn] = hand(s, 'corp', 'burn-notice');
    expect(act(s, { type: 'play', card: burn }).ghost.hand).toHaveLength(0); // 2 damage, 1 prevented
  });
  card('burner-phone', 'trash on your turn, no cycle: remove up to 2 heat', () => {
    let s = ghostTurn(blank());
    const [a, b] = rig(s, 'burner-phone', 'burner-phone');
    rejects(s, { type: 'use', card: a });
    s.ghost.heat = 3;
    s = act(s, { type: 'use', card: a });
    expect([s.ghost.heat, s.ghost.cycles]).toEqual([1, 4]);
    s = act(s, { type: 'use', card: b });
    expect(s.ghost.heat).toBe(0);
    expect(s.ghost.gear).toEqual([]);
  });
  card('street-fence', '1 credit at the start of each Ghost turn', () => {
    let s = corpTurn(blank());
    rig(s, 'street-fence', 'street-fence');
    s.ghost.credits = 0;
    s.corp.cycles = 0;
    s = act(s, { type: 'endTurn' });
    expect(s.ghost.credits).toBe(2);
  });
  card('safehouse', 'spend 1 cycle: draw 2', () => {
    let s = ghostTurn(blank());
    const [c] = rig(s, 'safehouse');
    s = act(s, { type: 'use', card: c });
    expect(s.ghost.hand).toHaveLength(2);
    expect(s.ghost.cycles).toBe(3);
    expect(s.ghost.contacts).toEqual([c]);
  });
});

describe('stunts', () => {
  card('fast-money', 'cost 2: gain 5', () => {
    let s = ghostTurn(blank(), 2);
    const [c] = hand(s, 'ghost', 'fast-money');
    s = act(s, { type: 'play', card: c });
    expect(s.ghost.credits).toBe(5);
    expect(s.ghost.discard).toEqual([c]);
  });
  card('cram-session', 'cost 1: draw 3', () => {
    let s = ghostTurn(blank(), 1);
    const [c] = hand(s, 'ghost', 'cram-session');
    s = act(s, { type: 'play', card: c });
    expect(s.ghost.hand).toHaveLength(3);
    expect(s.ghost.credits).toBe(0);
  });
  card('payroll-heist', 'run Command; on success take up to 4 credits instead of accessing, and gain 1 heat', () => {
    let s = ghostTurn(blank(), 2);
    const [c] = hand(s, 'ghost', 'payroll-heist');
    hand(s, 'corp', 'skyhook-contract');
    s.corp.credits = 3;
    const rich = structuredClone(s);
    s = act(s, { type: 'play', card: c, node: 'command' });
    expect(s.run).toBeNull();
    expect([s.corp.credits, s.ghost.credits, s.ghost.heat]).toEqual([0, 3, 1]);
    expect(points(s, 'ghost')).toBe(0); // no access
    rich.corp.credits = 9;
    const r = act(rich, { type: 'play', card: c, node: 'command' });
    expect([r.corp.credits, r.ghost.credits]).toEqual([5, 4]);
    rejects(rich, { type: 'play', card: c, node: 'mainframe' });
  });
  it('payroll-heist: nothing happens if the run fails', () => {
    let s = ghostTurn(blank(), 2);
    const [c] = hand(s, 'ghost', 'payroll-heist');
    ice(s, 'command', 'tripwire');
    s = act(s, { type: 'play', card: c, node: 'command' });
    s = act(s, { type: 'proceed' });
    expect([s.corp.credits, s.ghost.credits, s.ghost.heat]).toEqual([5, 0, 0]);
  });
  card('deep-dive', 'run the Mainframe and access 2 additional cards', () => {
    let s = ghostTurn(blank());
    const [c] = hand(s, 'ghost', 'deep-dive');
    s.corp.deck.push(take(s, 'tripwire'), take(s, 'skyhook-contract'), take(s, 'quiet-acquisition'));
    s = act(s, { type: 'play', card: c, node: 'mainframe' });
    s = act(s, { type: 'steal' });
    s = act(s, { type: 'steal' });
    s = act(s, { type: 'leave' });
    expect(s.run).toBeNull();
    expect(points(s, 'ghost')).toBe(3);
    expect(s.ghost.credits).toBe(8);
  });
  card('blackout', 'run any node; the Corp cannot activate ICE, but active ICE still works', () => {
    let s = ghostTurn(blank());
    const [c, d] = hand(s, 'ghost', 'blackout', 'blackout');
    const { id } = site(s, 'skyhook-contract');
    ice(s, id, 'bulkhead', false);
    ice(s, id, 'black-mamba', false);
    ice(s, 'command', 'tripwire', true);
    s = act(s, { type: 'play', card: c, node: id });
    expect(s.run!.step).toBe('access');
    expect(nodeOf(s, id).ice.every((i) => !i.active)).toBe(true);
    s = act(s, { type: 'steal' });
    s = act(s, { type: 'play', card: d, node: 'command' });
    expect(s.run!.step).toBe('encounter');
  });
  card('recon-sweep', 'shows the Ghost every facedown card in and protecting one node', () => {
    let s = ghostTurn(blank(), 0);
    const [c] = hand(s, 'ghost', 'recon-sweep');
    const { id, card: root } = site(s, 'decoy-lab', { dev: 2 });
    const w = ice(s, id, 'black-mamba', false);
    const other = ice(s, 'command', 'bulkhead', false);
    s = act(s, { type: 'play', card: c, node: id });
    const v = viewFor(s, 'ghost');
    expect(v.corp.nodes.at(-1)!.root!.card).toBe(root);
    expect(v.corp.nodes.at(-1)!.ice[0].card).toBe(w);
    expect(v.corp.nodes[0].ice[0].card).not.toBe(other);
    expect(JSON.stringify(viewFor(s, 'corp').events)).not.toContain('Decoy Lab');
    expect(nodeOf(s, id).ice[0].active).toBe(false);
  });
  card('salvage', 'returns a program or gear from the Scrapheap to hand', () => {
    let s = ghostTurn(blank(), 1);
    const [c] = hand(s, 'ghost', 'salvage');
    rejects(s, { type: 'play', card: c });
    const key = take(s, 'skeleton-key');
    const stunt = take(s, 'fast-money');
    s.ghost.discard.push(key, stunt);
    rejects(s, { type: 'play', card: c, target: stunt });
    s = act(s, { type: 'play', card: c, target: key });
    expect(s.ghost.hand).toEqual([key]);
    expect(s.ghost.discard).toEqual([stunt, c]);
  });
});

describe('coverage', () => {
  it('every card in data/cards.json has a test', () => {
    expect(CARDS.map((c) => c.id).filter((id) => !tested.has(id))).toEqual([]);
  });
});
