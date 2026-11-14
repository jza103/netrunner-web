// apply(state, action): the only way the game changes. Pure: it never touches its input.
import { cardOf, is, nameOf } from './cards';
import { isLegal } from './legal';
import { randInt, shuffle } from './rng';
import { actor, count, currentIce, findInstalled, maxHand, nodeName, nodeOf, points } from './state';
import { CYCLES, POINTS_TO_WIN, type Action, type CardId, type GameState, type NodeId, type Result, type Side } from './types';

const other = (side: Side): Side => (side === 'corp' ? 'ghost' : 'corp');
const label = (side: Side) => (side === 'corp' ? 'The Corp' : 'The Ghost');

function emit(s: GameState, type: string, side: Side | undefined, text: string, priv?: { side: Side; text: string }) {
  s.events.push({ seq: ++s.seq, type, text, ...(side ? { side } : {}), ...(priv ? { priv } : {}) });
}

function win(s: GameState, side: Side, reason: string) {
  if (s.phase === 'gameOver') return;
  s.phase = 'gameOver';
  s.run = null;
  s.winner = side;
  s.winReason = reason;
  emit(s, 'gameOver', side, `${label(side)} wins: ${reason}`);
}

// ---------------------------------------------------------------------------
// Basic moves
// ---------------------------------------------------------------------------

function drawCards(s: GameState, side: Side, n: number): number {
  const p = s[side];
  const got = p.deck.splice(-n).reverse();
  p.hand.push(...got);
  if (got.length)
    emit(s, 'draw', side, `${label(side)} draws ${got.length} card${got.length === 1 ? '' : 's'}.`, {
      side,
      text: `You draw ${got.map(nameOf).join(', ')}.`,
    });
  return got.length;
}

function gain(s: GameState, side: Side, n: number) {
  s[side].credits += n;
}

/** Deal damage to the Ghost: random discards; more damage than cards in hand is fatal. */
export function damage(s: GameState, n: number, source: string) {
  const g = s.ghost;
  const shield = Math.max(0, Math.min(n, count(g.gear, 'padded-rig') - s.flags.prevented));
  if (shield) {
    s.flags.prevented += shield;
    n -= shield;
    emit(s, 'prevent', 'ghost', `Padded Rig prevents ${shield} damage.`);
  }
  if (n <= 0) return;
  if (n > g.hand.length) {
    g.discard.push(...g.hand.splice(0));
    emit(s, 'damage', 'corp', `${source} deals ${n} damage. The Ghost has too few cards to absorb it.`);
    win(s, 'corp', 'the Ghost is flatlined.');
    return;
  }
  const lost: CardId[] = [];
  for (let i = 0; i < n; i++) lost.push(...g.hand.splice(randInt(s, g.hand.length), 1));
  g.discard.push(...lost);
  emit(s, 'damage', 'corp', `${source} deals ${n} damage. The Ghost loses ${lost.map(nameOf).join(', ')}.`);
}

function addHeat(s: GameState, n: number) {
  s.ghost.heat += n;
  emit(s, 'heat', 'ghost', `The Ghost gains ${n} heat (now ${s.ghost.heat}).`);
}

function trashProgram(s: GameState, card: CardId) {
  const g = s.ghost;
  g.programs = g.programs.filter((c) => c !== card);
  g.discard.push(card);
  emit(s, 'trash', 'corp', `${nameOf(card)} is trashed.`);
}

/** Take a Corp card out of whatever zone it is in. */
function removeCorpCard(s: GameState, card: CardId) {
  const c = s.corp;
  c.hand = c.hand.filter((x) => x !== card);
  c.deck = c.deck.filter((x) => x !== card);
  c.discard = c.discard.filter((x) => x !== card);
  c.discardSeen = c.discardSeen.filter((x) => x !== card);
  for (const n of c.nodes) {
    if (n.root?.card === card) n.root = null;
    n.ice = n.ice.filter((i) => i.card !== card);
  }
  s.ghost.known = s.ghost.known.filter((x) => x !== card);
}

function checkPoints(s: GameState, side: Side) {
  if (points(s, side) >= POINTS_TO_WIN) win(s, side, `${points(s, side)} project points.`);
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

function startTurn(s: GameState, side: Side) {
  s.turn = side;
  s.turnNumber++;
  s.phase = 'action';
  s.flags = { successfulRun: false, skimmed: false, prevented: 0 };
  s[side].cycles = CYCLES[side];
  emit(s, 'turn', side, `Turn ${s.turnNumber}: ${label(side)} begins with ${CYCLES[side]} cycles.`);
  if (side === 'corp') {
    if (!s.corp.deck.length) return win(s, 'ghost', 'the Corp must draw from an empty Mainframe.');
    drawCards(s, 'corp', 1);
    const shells = s.corp.nodes.filter((n) => n.root?.active && is(n.root.card, 'shell-company')).length;
    if (shells) {
      gain(s, 'corp', shells);
      emit(s, 'income', 'corp', `Shell Company pays the Corp ${shells} credit${shells === 1 ? '' : 's'}.`);
    }
  } else {
    const fences = count(s.ghost.contacts, 'street-fence');
    if (fences) {
      gain(s, 'ghost', fences);
      emit(s, 'income', 'ghost', `Street Fence pays the Ghost ${fences} credit${fences === 1 ? '' : 's'}.`);
    }
  }
}

function passTurn(s: GameState) {
  if (s.turn === 'ghost') s.ghostSuccessLastTurn = s.flags.successfulRun;
  startTurn(s, other(s.turn));
}

function endTurn(s: GameState) {
  const side = s.turn;
  if (s[side].hand.length > maxHand(s, side)) {
    s.phase = 'discard';
    emit(s, 'discardDown', side, `${label(side)} must discard down to ${maxHand(s, side)} cards.`);
  } else passTurn(s);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function startRun(s: GameState, node: NodeId, opts: { noActivate?: boolean; extraAccess?: number; heist?: boolean } = {}) {
  s.phase = 'run';
  s.run = {
    node,
    pos: nodeOf(s, node).ice.length - 1,
    step: 'approach',
    boost: {},
    broken: [],
    subQueue: [],
    accessQueue: [],
    accessing: null,
    noActivate: !!opts.noActivate,
    extraAccess: opts.extraAccess ?? 0,
    heist: !!opts.heist,
  };
  emit(s, 'run', 'ghost', `The Ghost runs on ${nodeName(node)}.`);
  advanceRun(s);
}

/** Move inward until someone has a decision to make. */
function advanceRun(s: GameState) {
  const run = s.run!;
  for (;;) {
    if (run.pos < 0) return beginAccess(s);
    const ice = nodeOf(s, run.node).ice[run.pos];
    if (ice.active) return beginEncounter(s);
    if (!run.noActivate && s.corp.credits >= (cardOf(ice.card).cost ?? 0)) {
      run.step = 'approach';
      return;
    }
    emit(s, 'pass', 'ghost', 'The Ghost slips past inactive ICE.');
    run.pos--;
  }
}

function beginEncounter(s: GameState) {
  const run = s.run!;
  run.step = 'encounter';
  run.boost = {};
  run.broken = [];
  const ice = currentIce(s)!;
  const d = cardOf(ice.card);
  emit(s, 'encounter', 'ghost', `The Ghost encounters ${d.name} (${d.subtype}, strength ${d.strength}).`);
}

function endRun(s: GameState, success: boolean, why = '') {
  if (s.phase === 'gameOver') return;
  s.run = null;
  s.phase = 'action';
  if (!success) emit(s, 'runEnd', 'ghost', `The run ends${why ? `: ${why}` : '.'}`);
}

function resolveSubs(s: GameState) {
  const run = s.run!;
  const ice = currentIce(s)!;
  const d = cardOf(ice.card);
  while (run.subQueue.length) {
    const sub = d.subs![run.subQueue.shift()!];
    switch (sub.op) {
      case 'endRun':
        return endRun(s, false, `${d.name} shuts the Ghost out.`);
      case 'damage':
        damage(s, sub.n, d.name);
        if (s.phase === 'gameOver') return;
        break;
      case 'loseCredits': {
        const n = Math.min(sub.n, s.ghost.credits);
        s.ghost.credits -= n;
        emit(s, 'sub', 'corp', `${d.name}: the Ghost loses ${n} credit${n === 1 ? '' : 's'}.`);
        break;
      }
      case 'corpGain':
        gain(s, 'corp', sub.n);
        emit(s, 'sub', 'corp', `${d.name}: the Corp gains ${sub.n} credits.`);
        break;
      case 'heat':
        addHeat(s, sub.n);
        break;
      case 'loseCycle': {
        const n = Math.min(sub.n, s.ghost.cycles);
        s.ghost.cycles -= n;
        if (n) emit(s, 'sub', 'corp', `${d.name}: the Ghost loses ${n} cycle.`);
        break;
      }
      case 'trashProgram':
        if (s.ghost.programs.length === 1) trashProgram(s, s.ghost.programs[0]);
        else if (s.ghost.programs.length > 1) {
          run.step = 'corpTrash';
          return;
        }
        break;
    }
  }
  run.step = 'passed';
  emit(s, 'passed', 'ghost', `The Ghost gets past ${d.name}.`);
}

function beginAccess(s: GameState) {
  const run = s.run!;
  const c = s.corp;
  s.flags.successfulRun = true;
  emit(s, 'success', 'ghost', `The run on ${nodeName(run.node)} succeeds.`);
  if (!s.flags.skimmed && count(s.ghost.programs, 'packet-skimmer')) {
    s.flags.skimmed = true;
    gain(s, 'ghost', 2);
    emit(s, 'income', 'ghost', 'Packet Skimmer pays the Ghost 2 credits.');
  }
  if (run.heist) {
    const n = Math.min(4, c.credits);
    c.credits -= n;
    gain(s, 'ghost', n);
    emit(s, 'heist', 'ghost', `Payroll Heist: the Ghost takes ${n} credit${n === 1 ? '' : 's'} from the Corp.`);
    addHeat(s, 1);
    return endRun(s, true);
  }
  if (run.node === 'command') {
    const pool = [...c.hand];
    for (let i = 0; i < 1 + run.extraAccess && pool.length; i++) run.accessQueue.push(...pool.splice(randInt(s, pool.length), 1));
  } else if (run.node === 'mainframe') {
    const n = 1 + run.extraAccess + count(s.ghost.programs, 'deep-probe');
    run.accessQueue = c.deck.slice(-n).reverse();
  } else if (run.node === 'dump') {
    c.discardSeen = [...c.discard];
    run.accessQueue = c.discard.filter((x) => cardOf(x).type === 'project');
    if (!run.accessQueue.length) emit(s, 'access', 'ghost', `The Ghost sifts the Dump (${c.discard.length} cards) and finds no projects.`);
  } else {
    const root = nodeOf(s, run.node).root;
    if (root) run.accessQueue = [root.card];
    else emit(s, 'access', 'ghost', 'There is nothing installed there.');
  }
  run.step = 'access';
  nextAccess(s);
}

function nextAccess(s: GameState) {
  const run = s.run!;
  const card = run.accessQueue.shift();
  if (!card) return endRun(s, true);
  run.accessing = card;
  const d = cardOf(card);
  const inst = findInstalled(s, card);
  emit(s, 'access', 'ghost', inst?.inst.active ? `The Ghost accesses ${d.name}.` : 'The Ghost accesses a card.', { side: 'ghost', text: `You access ${d.name}.` });
  if (d.trap && inst) {
    emit(s, 'trap', 'corp', `It is a trap: ${d.name}!`);
    inst.inst.active = true;
    damage(s, 2 + inst.inst.dev, d.name);
  }
}

// ---------------------------------------------------------------------------
// Card effects
// ---------------------------------------------------------------------------

function playDirective(s: GameState, a: Extract<Action, { type: 'play' }>) {
  const c = s.corp;
  const d = cardOf(a.card);
  c.cycles--;
  c.credits -= d.cost ?? 0;
  c.hand = c.hand.filter((x) => x !== a.card);
  emit(s, 'play', 'corp', `The Corp plays ${d.name}.`);
  if (is(a.card, 'recall')) {
    c.removed.push(a.card);
    c.deck.push(...c.discard.splice(0));
    c.discardSeen = [];
    shuffle(s, c.deck);
    return;
  }
  c.discard.push(a.card);
  c.discardSeen.push(a.card);
  if (is(a.card, 'quarterly-windfall')) gain(s, 'corp', 7);
  else if (is(a.card, 'rapid-prototyping')) {
    const t = findInstalled(s, a.target!)!;
    t.inst.dev += 2;
    emit(s, 'develop', 'corp', `The card in ${nodeName(t.node.id)} now has ${t.inst.dev} development counters.`);
  } else if (is(a.card, 'burn-notice')) damage(s, 1 + s.ghost.heat, d.name);
  else if (is(a.card, 'asset-freeze')) {
    const n = Math.min(s.ghost.credits, 3 * s.ghost.heat);
    s.ghost.credits -= n;
    emit(s, 'freeze', 'corp', `The Ghost loses ${n} credit${n === 1 ? '' : 's'}.`);
  } else if (is(a.card, 'lockdown-audit')) addHeat(s, 1);
}

function playStunt(s: GameState, a: Extract<Action, { type: 'play' }>) {
  const g = s.ghost;
  const d = cardOf(a.card);
  g.cycles--;
  g.credits -= d.cost ?? 0;
  g.hand = g.hand.filter((x) => x !== a.card);
  g.discard.push(a.card);
  emit(s, 'play', 'ghost', `The Ghost plays ${d.name}.`);
  if (is(a.card, 'fast-money')) gain(s, 'ghost', 5);
  else if (is(a.card, 'cram-session')) drawCards(s, 'ghost', 3);
  else if (is(a.card, 'payroll-heist')) startRun(s, 'command', { heist: true });
  else if (is(a.card, 'deep-dive')) startRun(s, 'mainframe', { extraAccess: 2 });
  else if (is(a.card, 'blackout')) startRun(s, a.node!, { noActivate: true });
  else if (is(a.card, 'recon-sweep')) {
    const n = nodeOf(s, a.node!);
    const seen = [...n.ice, ...(n.root ? [n.root] : [])].filter((i) => !i.active).map((i) => i.card);
    for (const c of seen) if (!g.known.includes(c)) g.known.push(c);
    emit(s, 'recon', 'ghost', `The Ghost scans ${nodeName(a.node!)}.`, { side: 'ghost', text: `You scan ${nodeName(a.node!)} and see: ${seen.map(nameOf).join(', ')}.` });
  } else if (is(a.card, 'salvage')) {
    g.discard = g.discard.filter((x) => x !== a.target);
    g.hand.push(a.target!);
    emit(s, 'salvage', 'ghost', `The Ghost recovers ${nameOf(a.target!)} from the Scrapheap.`);
  }
}

function corpInstall(s: GameState, a: Extract<Action, { type: 'install' }>) {
  const c = s.corp;
  const d = cardOf(a.card);
  let node = a.node === 'new' ? null : nodeOf(s, a.node!);
  if (!node) {
    node = { id: `site${++c.siteCount}`, ice: [], root: null };
    c.nodes.push(node);
  }
  c.cycles--;
  c.hand = c.hand.filter((x) => x !== a.card);
  const where = nodeName(node.id);
  if (d.type === 'ice') {
    c.credits -= node.ice.length;
    node.ice.push({ card: a.card, active: false, dev: 0 });
    emit(s, 'install', 'corp', `The Corp installs ICE protecting ${where}.`, { side: 'corp', text: `You install ${d.name} protecting ${where}.` });
  } else {
    if (node.root) {
      const old = node.root;
      c.discard.push(old.card);
      if (old.active) c.discardSeen.push(old.card);
      s.ghost.known = s.ghost.known.filter((x) => x !== old.card);
      emit(s, 'trash', 'corp', `The Corp trashes the card already in ${where}.`);
    }
    node.root = { card: a.card, active: false, dev: 0 };
    emit(s, 'install', 'corp', `The Corp installs a card in ${where}.`, { side: 'corp', text: `You install ${d.name} in ${where}.` });
  }
}

function ghostInstall(s: GameState, a: Extract<Action, { type: 'install' }>) {
  const g = s.ghost;
  const d = cardOf(a.card);
  g.cycles--;
  g.credits -= d.cost ?? 0;
  g.hand = g.hand.filter((x) => x !== a.card);
  (d.type === 'program' ? g.programs : d.type === 'gear' ? g.gear : g.contacts).push(a.card);
  emit(s, 'install', 'ghost', `The Ghost installs ${d.name}.`);
}

function score(s: GameState, card: CardId) {
  const c = s.corp;
  const d = cardOf(card);
  removeCorpCard(s, card);
  c.scored.push(card);
  emit(s, 'score', 'corp', `The Corp scores ${d.name} for ${d.points} point${d.points === 1 ? '' : 's'} (${points(s, 'corp')} total).`);
  if (is(card, 'skyhook-contract')) gain(s, 'corp', 4);
  else if (is(card, 'quiet-acquisition')) drawCards(s, 'corp', 2);
  else if (is(card, 'orbital-mandate')) addHeat(s, 2);
  checkPoints(s, 'corp');
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

function step(s: GameState, a: Action) {
  const side = actor(s)!;
  const p = s[side];
  switch (a.type) {
    case 'keep':
    case 'mulligan':
      if (a.type === 'mulligan') {
        p.deck.push(...p.hand.splice(0));
        shuffle(s, p.deck);
        p.hand = p.deck.splice(-5);
        emit(s, 'mulligan', side, `${label(side)} takes a mulligan.`);
      } else emit(s, 'keep', side, `${label(side)} keeps their hand.`);
      if (side === 'corp') s.mulligan = 'ghost';
      else {
        s.mulligan = null;
        startTurn(s, 'corp');
      }
      return;
    case 'credit':
      p.cycles--;
      p.credits++;
      emit(s, 'credit', side, `${label(side)} takes 1 credit.`);
      return;
    case 'draw':
      p.cycles--;
      drawCards(s, side, 1);
      return;
    case 'install':
      return side === 'corp' ? corpInstall(s, a) : ghostInstall(s, a);
    case 'play':
      return side === 'corp' ? playDirective(s, a) : playStunt(s, a);
    case 'develop': {
      const t = findInstalled(s, a.card)!;
      s.corp.cycles--;
      s.corp.credits--;
      t.inst.dev++;
      emit(s, 'develop', 'corp', `The Corp develops the card in ${nodeName(t.node.id)} (${t.inst.dev} counter${t.inst.dev === 1 ? '' : 's'}).`);
      return;
    }
    case 'score':
      return score(s, a.card);
    case 'activate': {
      const t = findInstalled(s, a.card)!;
      const d = cardOf(a.card);
      s.corp.credits -= d.cost ?? 0;
      t.inst.active = true;
      emit(s, 'activate', 'corp', `The Corp activates ${d.name} (${t.isIce ? 'protecting' : 'in'} ${nodeName(t.node.id)}) for ${d.cost ?? 0}.`);
      if (s.run?.step === 'approach') beginEncounter(s);
      return;
    }
    case 'decline':
      emit(s, 'pass', 'ghost', 'The Corp leaves its ICE inactive; the Ghost slips past.');
      s.run!.pos--;
      return advanceRun(s);
    case 'trashContact':
      s.corp.cycles--;
      s.corp.credits -= 2;
      s.ghost.contacts = s.ghost.contacts.filter((c) => c !== a.card);
      s.ghost.discard.push(a.card);
      emit(s, 'trash', 'corp', `The Corp follows the heat and trashes ${nameOf(a.card)}.`);
      return;
    case 'run':
      s.ghost.cycles--;
      return startRun(s, a.node);
    case 'shedHeat':
      s.ghost.cycles--;
      s.ghost.credits -= 2;
      s.ghost.heat--;
      emit(s, 'heat', 'ghost', `The Ghost lies low and sheds 1 heat (now ${s.ghost.heat}).`);
      return;
    case 'use':
      if (is(a.card, 'burner-phone')) {
        const g = s.ghost;
        g.gear = g.gear.filter((c) => c !== a.card);
        g.discard.push(a.card);
        const n = Math.min(2, g.heat);
        g.heat -= n;
        emit(s, 'heat', 'ghost', `The Ghost burns a Burner Phone and sheds ${n} heat (now ${g.heat}).`);
      } else {
        s.ghost.cycles--;
        emit(s, 'use', 'ghost', 'The Ghost checks in at the Safehouse.');
        drawCards(s, 'ghost', 2);
      }
      return;
    case 'scrap':
      s.ghost.programs = s.ghost.programs.filter((c) => c !== a.card);
      s.ghost.discard.push(a.card);
      emit(s, 'trash', 'ghost', `The Ghost scraps ${nameOf(a.card)}.`);
      return;
    case 'boost': {
      const b = cardOf(a.card).breaker!;
      s.ghost.credits -= b.boostCost;
      s.run!.boost[a.card] = (s.run!.boost[a.card] ?? 0) + b.boostBy;
      emit(s, 'boost', 'ghost', `The Ghost pays ${b.boostCost} to boost ${nameOf(a.card)} to strength ${b.strength + s.run!.boost[a.card]}.`);
      return;
    }
    case 'break': {
      const b = cardOf(a.card).breaker!;
      s.ghost.credits -= b.breakCost;
      s.run!.broken.push(a.sub);
      emit(s, 'break', 'ghost', `The Ghost pays ${b.breakCost}: ${nameOf(a.card)} breaks subroutine ${a.sub + 1} of ${nameOf(currentIce(s)!.card)}.`);
      return;
    }
    case 'proceed': {
      const run = s.run!;
      const d = cardOf(currentIce(s)!.card);
      run.subQueue = d.subs!.map((_, i) => i).filter((i) => !run.broken.includes(i));
      return resolveSubs(s);
    }
    case 'chooseTrash':
      trashProgram(s, a.card);
      return resolveSubs(s);
    case 'continue':
      s.run!.pos--;
      return advanceRun(s);
    case 'jackOut':
      return endRun(s, false, 'the Ghost jacks out.');
    case 'steal': {
      const card = s.run!.accessing!;
      const d = cardOf(card);
      s.ghost.credits -= d.stealCost ?? 0;
      removeCorpCard(s, card);
      s.ghost.scored.push(card);
      emit(s, 'steal', 'ghost', `The Ghost steals ${d.name} for ${d.points} point${d.points === 1 ? '' : 's'} (${points(s, 'ghost')} total).`);
      checkPoints(s, 'ghost');
      if (s.phase !== 'gameOver') nextAccess(s);
      return;
    }
    case 'trash': {
      const card = s.run!.accessing!;
      const d = cardOf(card);
      s.ghost.credits -= d.trash ?? 0;
      removeCorpCard(s, card);
      s.corp.discard.push(card);
      s.corp.discardSeen.push(card);
      emit(s, 'trash', 'ghost', `The Ghost pays ${d.trash ?? 0} to trash ${d.name}.`);
      return nextAccess(s);
    }
    case 'leave': {
      const card = s.run!.accessing!;
      const inst = findInstalled(s, card);
      if (inst && !inst.inst.active && !s.ghost.known.includes(card)) s.ghost.known.push(card);
      return nextAccess(s);
    }
    case 'discard':
      p.hand = p.hand.filter((c) => c !== a.card);
      p.discard.push(a.card);
      emit(s, 'discard', side, `${label(side)} discards a card.`, { side, text: `You discard ${nameOf(a.card)}.` });
      if (p.hand.length <= maxHand(s, side)) passTurn(s);
      return;
    case 'endTurn':
      return endTurn(s);
  }
}

export function apply(state: GameState, action: Action): Result {
  if (state.phase === 'gameOver') return { ok: false, error: 'The game is over.' };
  if (!isLegal(state, action)) return { ok: false, error: explain(state, action) };
  const s = structuredClone(state);
  step(s, action);
  return { ok: true, state: s };
}

/** Why an action is not legal right now, in plain words. */
export function explain(s: GameState, a: Action): string {
  const side = actor(s);
  if (!side) return 'The game is over.';
  const p = s[side];
  if (s.phase === 'action' && p.cycles <= 0 && !['endTurn', 'score', 'activate', 'use', 'scrap'].includes(a.type)) return 'You have no cycles left this turn.';
  if ('card' in a && a.card && !a.card.startsWith('?')) {
    const d = cardOf(a.card);
    if ((a.type === 'install' || a.type === 'play' || a.type === 'activate') && p.credits < (d.cost ?? 0)) return `${d.name} costs ${d.cost} and you have ${p.credits}.`;
    if (a.type === 'install' && d.type === 'program') return `Not enough free RAM for ${d.name}.`;
    if (a.type === 'play' && (is(a.card, 'burn-notice') || is(a.card, 'asset-freeze'))) return `${d.name} needs the Ghost to have heat.`;
    if (a.type === 'play' && is(a.card, 'lockdown-audit')) return 'Lockdown Audit needs a successful Ghost run last turn.';
    if (a.type === 'score') return `${d.name} needs ${d.dev} development counters.`;
    if (a.type === 'break') return 'That breaker is too weak or cannot break this ICE.';
  }
  if (a.type === 'endTurn') return 'Spend all your cycles before ending the turn.';
  return 'That is not a legal move right now.';
}
