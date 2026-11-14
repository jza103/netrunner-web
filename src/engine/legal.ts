// The single source of truth for what may be done. apply() accepts exactly these actions.
import { cardOf, ensureCards, targetedEffect } from './cards';
import { actor, breakerStrength, canBreak, canDevelop, currentIce, iceStrength, isSite, ramLimit, ramUsed } from './state';
import { MAX_ICE, MAX_SITES, type Action, type CardDef, type CardId, type GameState, type NodeId, type PlayCondition } from './types';

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

function canOpenSite(s: GameState): boolean {
  const all = sites(s);
  return all.length < MAX_SITES && !all.some((n) => !n.root && n.ice.length === 0 && n.upgrades.length === 0);
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
      if ((d.type === 'asset' || d.type === 'upgrade') && !d.trap && !inst.active && s.corp.credits >= (d.cost ?? 0)) out.push(inst.card);
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
  for (const n of sites(s)) {
    if (!n.root) continue;
    const d = cardOf(n.root.card);
    if (d.type === 'project' && n.root.dev >= (d.dev ?? 99)) out.push({ type: 'score', card: n.root.card });
  }
  for (const card of activatable(s)) out.push({ type: 'activate', card });
  if (c.cycles <= 0) {
    out.push({ type: 'endTurn' });
    return out;
  }
  out.push({ type: 'credit' });
  if (c.deck.length) out.push({ type: 'draw' });
  for (const card of c.hand) {
    const d = cardOf(card);
    if (d.type === 'ice') {
      for (const n of c.nodes) if (n.ice.length < MAX_ICE && c.credits >= n.ice.length) out.push({ type: 'install', card, node: n.id });
      if (canOpenSite(s)) out.push({ type: 'install', card, node: 'new' });
    } else if (d.type === 'project' || d.type === 'asset') {
      for (const n of sites(s)) out.push({ type: 'install', card, node: n.id });
      if (canOpenSite(s)) out.push({ type: 'install', card, node: 'new' });
    } else if (d.type === 'upgrade') {
      for (const n of c.nodes) out.push({ type: 'install', card, node: n.id });
      if (canOpenSite(s)) out.push({ type: 'install', card, node: 'new' });
    } else if (d.type === 'directive' && c.credits >= (d.cost ?? 0) && directiveReady(s, card)) out.push(...playOptions(s, card, d));
  }
  if (c.credits >= 1) for (const card of developTargets(s)) out.push({ type: 'develop', card });
  if (s.ghost.heat > 0 && c.credits >= 2) for (const card of s.ghost.contacts) out.push({ type: 'trashContact', card });
  return out;
}

/** Nodes worth running: the three central nodes and any site with something there. */
export function runTargets(s: GameState): NodeId[] {
  return s.corp.nodes.filter((n) => !isSite(n.id) || n.root || n.ice.length || n.upgrades.length).map((n) => n.id);
}

function abilityReady(s: GameState, card: CardId): boolean {
  const a = cardOf(card).ability;
  if (!a) return false;
  if (a.cycles > s.ghost.cycles || (a.credits ?? 0) > s.ghost.credits || !conditionHolds(s, a.if)) return false;
  // an ability that only draws needs cards to draw
  if (a.effects.every((e) => e.op === 'draw') && !s.ghost.deck.length) return false;
  return true;
}

function ghostTurn(s: GameState): Action[] {
  const g = s.ghost;
  const out: Action[] = [];
  const rig = [...g.programs, ...g.gear, ...g.contacts];
  for (const card of rig) if (cardOf(card).ability?.cycles === 0 && abilityReady(s, card)) out.push({ type: 'use', card });
  for (const card of g.programs) out.push({ type: 'scrap', card });
  if (g.cycles <= 0) {
    out.push({ type: 'endTurn' });
    return out;
  }
  out.push({ type: 'credit' });
  if (g.deck.length) out.push({ type: 'draw' });
  for (const card of g.hand) {
    const d = cardOf(card);
    if (g.credits < (d.cost ?? 0)) continue;
    if (d.type === 'program') {
      if (ramUsed(s) + (d.ram ?? 1) <= ramLimit(s)) out.push({ type: 'install', card });
    } else if (d.type === 'gear' || d.type === 'contact') out.push({ type: 'install', card });
    else if (d.type === 'stunt' && directiveReady(s, card)) out.push(...playOptions(s, card, d));
  }
  for (const node of runTargets(s)) out.push({ type: 'run', node });
  if (g.heat > 0 && g.credits >= 2) out.push({ type: 'shedHeat' });
  for (const card of rig) if ((cardOf(card).ability?.cycles ?? 0) > 0 && abilityReady(s, card)) out.push({ type: 'use', card });
  return out;
}

function runActions(s: GameState): Action[] {
  const run = s.run!;
  const g = s.ghost;
  switch (run.step) {
    case 'approach': {
      // the ICE itself (the Corp can afford it, or there would be no window), then other cards
      const ice = currentIce(s)!.card;
      return [{ type: 'activate', card: ice }, ...activatable(s).map((card): Action => ({ type: 'activate', card })), { type: 'decline' }];
    }
    case 'approachNode':
      return [...activatable(s).map((card): Action => ({ type: 'activate', card })), { type: 'decline' }];
    case 'encounter': {
      const ice = currentIce(s)!;
      const def = cardOf(ice.card);
      const out: Action[] = [];
      for (const card of g.programs) {
        if (!canBreak(card, ice.card)) continue;
        const b = cardOf(card).breaker!;
        if (breakerStrength(s, card) < iceStrength(s, ice.card)) {
          if (g.credits >= b.boostCost) out.push({ type: 'boost', card });
        } else if (g.credits >= b.breakCost) {
          def.subs!.forEach((_, sub) => {
            if (!run.broken.includes(sub)) out.push({ type: 'break', card, sub });
          });
        }
      }
      out.push({ type: 'proceed' });
      return out;
    }
    case 'passed':
      return [{ type: 'continue' }, { type: 'jackOut' }];
    case 'corpTrash':
      return g.programs.map((card) => ({ type: 'chooseTrash', card }));
    case 'access': {
      const d = cardOf(run.accessing!);
      if (d.type === 'project') {
        if (!d.stealCost) return [{ type: 'steal' }];
        return g.credits >= d.stealCost ? [{ type: 'steal' }, { type: 'leave' }] : [{ type: 'leave' }];
      }
      const out: Action[] = [];
      // only cards with a trash cost can be trashed, and not once they are already in the Dump
      if (d.trash !== undefined && g.credits >= d.trash && !s.corp.discard.includes(run.accessing!)) out.push({ type: 'trash' });
      out.push({ type: 'leave' });
      return out;
    }
  }
}

export function legalActions(s: GameState): Action[] {
  ensureCards(s);
  const who = actor(s);
  if (!who) return [];
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
