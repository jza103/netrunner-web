// The single source of truth for what may be done. apply() accepts exactly these actions.
import { cardOf, ensureCards, targetedEffect } from './cards';
import { actor, available, breakerStrength, canBreak, canDevelop, currentIce, hostsWithRoom, iceStrength, isSite, ramLimit, ramUsed, rigOf } from './state';
import { type Action, type CardDef, type CardId, type GameState, type NodeId, type PlayCondition, type PriorityWindow, type Side } from './types';

export function conditionHolds(s: GameState, c: PlayCondition | undefined): boolean {
  if (c === 'ghostHasHeat') return s.ghost.heat > 0;
  if (c === 'ghostRanLastTurn') return s.ghostSuccessLastTurn;
  return true;
}

/** Whether a directive or stunt's play condition holds (cost aside). */
export function directiveReady(s: GameState, card: CardId): boolean {
  return conditionHolds(s, cardOf(card).playIf);
}

function sites(s: GameState) {
  return s.corp.nodes.filter((n) => isSite(n.id));
}

/** Cards the installer may trash as part of installing this card here (CR 8.5.6). */
export function trashOptions(s: GameState, card: CardId, node?: NodeId | 'new'): CardId[] {
  const d = cardOf(card);
  if (d.side === 'ghost') return d.type === 'program' ? [...s.ghost.programs] : [];
  if (!node || node === 'new') return [];
  const n = s.corp.nodes.find((x) => x.id === node)!;
  if (d.type === 'ice') return n.ice.map((i) => i.card);
  // a project or asset replaces the one already there anyway; the choice is about the rest of the root
  const root = [...(n.root && d.type === 'upgrade' ? [n.root.card] : []), ...n.upgrades.map((u) => u.card)];
  return root;
}

/** Whether an install with these cards trashed as part of it can be finished now. */
export function installReady(s: GameState, card: CardId, node: NodeId | 'new' | undefined, host: CardId | undefined, trash: CardId[]): boolean {
  const d = cardOf(card);
  if (d.side === 'corp') {
    const n = node && node !== 'new' ? s.corp.nodes.find((x) => x.id === node)! : null;
    const cost = d.type === 'ice' && n ? n.ice.filter((i) => !trash.includes(i.card)).length : 0;
    return available(s, 'corp', 'install') >= cost;
  }
  if (available(s, 'ghost', 'install') < (d.cost ?? 0)) return false;
  if (d.type !== 'program' || host) return true;
  const used = s.ghost.programs.filter((c) => !s.ghost.hosted[c] && !trash.includes(c)).reduce((k, c) => k + (cardOf(c).ram ?? 1), 0);
  return used + (d.ram ?? 1) <= ramLimit(s);
}

function developTargets(s: GameState): CardId[] {
  return sites(s)
    .filter((n) => n.root && canDevelop(n.root.card))
    .map((n) => n.root!.card);
}

/** Inactive assets and upgrades the Corp could activate now (not traps). */
export function activatable(s: GameState): CardId[] {
  const out: CardId[] = [];
  for (const n of s.corp.nodes)
    for (const inst of [...(n.root ? [n.root] : []), ...n.upgrades]) {
      const d = cardOf(inst.card);
      if ((d.type === 'asset' || d.type === 'upgrade') && !d.trap && !inst.active && available(s, 'corp', 'activate') >= (d.cost ?? 0)) out.push(inst.card);
    }
  return out;
}

/** Play actions for a directive or stunt, one per possible target. */
function playOptions(s: GameState, card: CardId, d: CardDef): Action[] {
  const t = targetedEffect(d);
  if (!t) {
    const run = d.onPlay?.find((e) => e.op === 'run');
    return [run && run.op === 'run' ? { type: 'play', card, node: run.node as NodeId } : { type: 'play', card }];
  }
  switch (t.op) {
    case 'develop':
      return developTargets(s).map((target) => ({ type: 'play', card, target }));
    case 'run':
      return runTargets(s).map((node) => ({ type: 'play', card, node }));
    case 'reveal':
      return s.corp.nodes
        .filter((n) => [...n.ice, ...n.upgrades, ...(n.root ? [n.root] : [])].some((i) => !i.active))
        .map((n) => ({ type: 'play', card, node: n.id }));
    case 'recover':
      return s.ghost.discard.filter((x) => t.types.includes(cardOf(x).type)).map((target) => ({ type: 'play', card, target }));
    default:
      return [];
  }
}

function corpTurn(s: GameState): Action[] {
  const c = s.corp;
  const out: Action[] = [];
  out.push(...scorable(s));
  for (const card of activatable(s)) out.push({ type: 'activate', card });
  if (c.cycles <= 0) {
    out.push({ type: 'endTurn' });
    return out;
  }
  out.push({ type: 'credit' });
  if (c.deck.length) out.push({ type: 'draw' });
  for (const card of c.hand) {
    const d = cardOf(card);
    if (d.type === 'ice' || d.type === 'project' || d.type === 'asset' || d.type === 'upgrade') {
      const where = d.type === 'project' || d.type === 'asset' ? sites(s) : c.nodes;
      for (const n of where) {
        if (installReady(s, card, n.id, undefined, [])) out.push({ type: 'install', card, node: n.id });
        if (trashOptions(s, card, n.id).length) out.push({ type: 'install', card, node: n.id, trash: true });
      }
      out.push({ type: 'install', card, node: 'new' });
    } else if (d.type === 'directive' && available(s, 'corp', 'play') >= (d.cost ?? 0) && directiveReady(s, card)) out.push(...playOptions(s, card, d));
  }
  if (available(s, 'corp', 'develop') >= 1) for (const card of developTargets(s)) out.push({ type: 'develop', card });
  if (s.ghost.heat > 0 && available(s, 'corp', 'other') >= 2) for (const card of s.ghost.contacts) out.push({ type: 'trashContact', card });
  // purging viruses takes the whole turn
  if (c.cycles >= 3) out.push({ type: 'purge' });
  return out;
}

/** Nodes worth running: the three central nodes and any site with something there. */
export function runTargets(s: GameState): NodeId[] {
  return s.corp.nodes.filter((n) => !isSite(n.id) || n.root || n.ice.length || n.upgrades.length).map((n) => n.id);
}

function abilityReady(s: GameState, card: CardId): boolean {
  const a = cardOf(card).ability;
  if (!a) return false;
  if (a.ownTurn && s.turn !== 'ghost') return false;
  if (a.cycles > s.ghost.cycles || (a.credits ?? 0) > available(s, 'ghost', 'other') || !conditionHolds(s, a.if)) return false;
  // an ability that only draws needs cards to draw
  if (a.effects.every((e) => e.op === 'draw') && !s.ghost.deck.length) return false;
  return true;
}

/** Abilities on the Ghost's installed cards that cost no cycle and could be used now: in any paid ability window (CR 9.2). */
export function freeAbilities(s: GameState): Action[] {
  return rigOf(s)
    .filter((card) => cardOf(card).ability?.cycles === 0 && abilityReady(s, card))
    .map((card): Action => ({ type: 'use', card }));
}

/** Scorable projects: the Corp may score in paid ability windows on its own turn (CR 1.17.3). */
function scorable(s: GameState): Action[] {
  const out: Action[] = [];
  for (const n of sites(s)) {
    if (!n.root) continue;
    const d = cardOf(n.root.card);
    if (d.type === 'project' && n.root.dev >= (d.dev ?? 99)) out.push({ type: 'score', card: n.root.card });
  }
  return out;
}

/** What a side could do in a priority window outside a run (empty: it is skipped for that side). */
export function windowOptions(s: GameState, side: Side, at: PriorityWindow['at']): Action[] {
  if (side === 'ghost') return freeAbilities(s);
  const out: Action[] = [];
  if (s.turn === 'corp' && at === 'turnStart') out.push(...scorable(s));
  out.push(...activatable(s).map((card): Action => ({ type: 'activate', card })));
  return out;
}

function ghostTurn(s: GameState): Action[] {
  const g = s.ghost;
  const out: Action[] = [];
  const rig = [...g.programs, ...g.gear, ...g.contacts];
  out.push(...freeAbilities(s));
  if (g.cycles <= 0) {
    out.push({ type: 'endTurn' });
    return out;
  }
  out.push({ type: 'credit' });
  if (g.deck.length) out.push({ type: 'draw' });
  for (const card of g.hand) {
    const d = cardOf(card);
    const cost = d.type === 'stunt' ? available(s, 'ghost', 'play') : available(s, 'ghost', 'install');
    if (cost < (d.cost ?? 0)) continue;
    if (d.type === 'program') {
      if (installReady(s, card, undefined, undefined, [])) out.push({ type: 'install', card });
      if (s.ghost.programs.length && installReady(s, card, undefined, undefined, s.ghost.programs)) out.push({ type: 'install', card, trash: true });
      for (const host of hostsWithRoom(s)) out.push({ type: 'install', card, host });
    } else if (d.type === 'gear' || d.type === 'contact') out.push({ type: 'install', card });
    else if (d.type === 'stunt' && directiveReady(s, card)) out.push(...playOptions(s, card, d));
  }
  for (const node of runTargets(s)) out.push({ type: 'run', node });
  if (g.heat > 0 && available(s, 'ghost', 'other') >= 2) out.push({ type: 'shedHeat' });
  for (const card of rig) if ((cardOf(card).ability?.cycles ?? 0) > 0 && abilityReady(s, card)) out.push({ type: 'use', card });
  return out;
}

/** What the Corp could do in its current run window (empty: the window is skipped). */
export function corpRunOptions(s: GameState): Action[] {
  const run = s.run!;
  const out: Action[] = [];
  if (run.step === 'approach') {
    const ice = currentIce(s)!;
    if (!ice.active && !run.noActivate && available(s, 'corp', 'activateIce') >= (cardOf(ice.card).cost ?? 0)) out.push({ type: 'activate', card: ice.card });
  }
  out.push(...activatable(s).map((card): Action => ({ type: 'activate', card })));
  return out;
}

/** Index of each card the Ghost may choose to access next, and whether the next Command or Mainframe card is on offer. */
function accessChoices(s: GameState): Action[] {
  const run = s.run!;
  const out: Action[] = run.candidates.map((_, i) => ({ type: 'access', i }));
  const zone = run.zoneLeft > 0 && (run.node === 'command' ? s.corp.hand.some((x) => !run.accessed.includes(x)) : run.node === 'mainframe' && s.corp.deck.some((x) => !run.accessed.includes(x)));
  if (zone) out.push({ type: 'access', zone: true });
  return out;
}

function runActions(s: GameState): Action[] {
  const run = s.run!;
  const g = s.ghost;
  switch (run.step) {
    case 'initiation':
    case 'approach':
    case 'moveIn':
    case 'approachNode':
      return [...corpRunOptions(s), { type: 'decline' }];
    case 'encounter': {
      const ice = currentIce(s)!;
      const def = cardOf(ice.card);
      const out: Action[] = [];
      const unbroken = def.subs!.map((_, i) => i).filter((i) => !run.broken.includes(i));
      // the rest of a "break up to N" payment: more breaks with that breaker, or stop
      const pending = Object.entries(run.freeBreaks).find(([, n]) => n > 0);
      if (pending && unbroken.length) return [...unbroken.map((sub): Action => ({ type: 'break', card: pending[0], sub })), { type: 'doneBreaking' }];
      for (const card of g.programs) {
        if (!canBreak(card, ice.card)) continue;
        const b = cardOf(card).breaker!;
        if (available(s, 'ghost', 'boost') >= b.boostCost) out.push({ type: 'boost', card });
        if (breakerStrength(s, card) < iceStrength(s, ice.card) || !unbroken.length) continue;
        if (available(s, 'ghost', 'break') >= b.breakCost) for (const sub of unbroken) out.push({ type: 'break', card, sub });
        if (b.breakAllCost !== undefined && available(s, 'ghost', 'break') >= b.breakAllCost) out.push({ type: 'breakAll', card });
      }
      if (iceStrength(s, ice.card) > 0) for (const card of g.programs) if (cardOf(card).virusSpend && (g.virus[card] ?? 0) > 0) out.push({ type: 'spendVirus', card });
      out.push(...freeAbilities(s));
      out.push({ type: 'proceed' });
      return out;
    }
    case 'passed':
      return [...freeAbilities(s), { type: 'continue' }, { type: 'jackOut' }];
    case 'corpTrash':
      return g.programs.map((card) => ({ type: 'chooseTrash', card }));
    case 'access': {
      if (!run.accessing) return accessChoices(s);
      const d = cardOf(run.accessing);
      if (d.type === 'project') {
        if (!d.stealCost) return [{ type: 'steal' }];
        return available(s, 'ghost', 'steal') >= d.stealCost ? [{ type: 'steal' }, { type: 'leave' }] : [{ type: 'leave' }];
      }
      const out: Action[] = [];
      // only cards with a trash cost can be trashed, and not once they are already in the Dump
      if (d.trash !== undefined && available(s, 'ghost', 'trashAccess') >= d.trash && !s.corp.discard.includes(run.accessing)) out.push({ type: 'trash' });
      out.push({ type: 'leave' });
      return out;
    }
  }
}

/** Each side may pay any amount it can toward a trace: the Corp first, then the Ghost (CR 10.8). */
function traceActions(s: GameState, who: 'corp' | 'ghost'): Action[] {
  const most = available(s, who, 'trace');
  return Array.from({ length: most + 1 }, (_, n) => ({ type: 'traceBoost', n }));
}

export function legalActions(s: GameState): Action[] {
  ensureCards(s);
  const who = actor(s);
  if (!who) return [];
  if (s.trace) return traceActions(s, who);
  if (s.window) return [...windowOptions(s, who, s.window.at), { type: 'pass' }];
  if (s.pendingInstall) {
    const p = s.pendingInstall;
    const out: Action[] = trashOptions(s, p.card, p.node)
      .filter((c) => !p.trash.includes(c))
      .map((card): Action => ({ type: 'pickTrash', card }));
    if (installReady(s, p.card, p.node, p.host, p.trash)) out.push({ type: 'confirmInstall' });
    out.push({ type: 'cancelInstall' });
    return out;
  }
  if (s.phase !== 'mulligan' && ramUsed(s) > ramLimit(s)) return s.ghost.programs.filter((c) => !s.ghost.hosted[c]).map((card) => ({ type: 'shedProgram', card }));
  if (s.phase === 'mulligan') return [{ type: 'keep' }, { type: 'mulligan' }];
  if (s.phase === 'discard') return s[who].hand.map((card) => ({ type: 'discard', card }));
  if (s.phase === 'run') return runActions(s);
  return who === 'corp' ? corpTurn(s) : ghostTurn(s);
}

export function sameAction(a: Action, b: Action): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
}

export function isLegal(s: GameState, a: Action): boolean {
  return legalActions(s).some((l) => sameAction(l, a));
}
