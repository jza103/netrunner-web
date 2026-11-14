// The single source of truth for what may be done. apply() accepts exactly these actions.
import { cardOf, is } from './cards';
import { actor, breakerStrength, canBreak, canDevelop, currentIce, isSite, ramLimit, ramUsed } from './state';
import { MAX_ICE, MAX_SITES, type Action, type CardId, type GameState, type NodeId } from './types';

/** Whether a Corp directive's play condition holds (cost aside). */
export function directiveReady(s: GameState, card: CardId): boolean {
  if (is(card, 'burn-notice') || is(card, 'asset-freeze')) return s.ghost.heat > 0;
  if (is(card, 'lockdown-audit')) return s.ghostSuccessLastTurn;
  return true;
}

function sites(s: GameState) {
  return s.corp.nodes.filter((n) => isSite(n.id));
}

function canOpenSite(s: GameState): boolean {
  const all = sites(s);
  return all.length < MAX_SITES && !all.some((n) => !n.root && n.ice.length === 0);
}

function developTargets(s: GameState): CardId[] {
  return sites(s)
    .filter((n) => n.root && canDevelop(n.root.card))
    .map((n) => n.root!.card);
}

function corpTurn(s: GameState): Action[] {
  const c = s.corp;
  const out: Action[] = [];
  for (const n of sites(s)) {
    if (!n.root) continue;
    const d = cardOf(n.root.card);
    if (d.type === 'project' && n.root.dev >= (d.dev ?? 99)) out.push({ type: 'score', card: n.root.card });
    if (d.type === 'asset' && !d.trap && !n.root.active && c.credits >= (d.cost ?? 0)) out.push({ type: 'activate', card: n.root.card });
  }
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
    } else if (d.type === 'directive' && c.credits >= (d.cost ?? 0) && directiveReady(s, card)) {
      if (is(card, 'rapid-prototyping')) for (const target of developTargets(s)) out.push({ type: 'play', card, target });
      else out.push({ type: 'play', card });
    }
  }
  if (c.credits >= 1) for (const card of developTargets(s)) out.push({ type: 'develop', card });
  if (s.ghost.heat > 0 && c.credits >= 2) for (const card of s.ghost.contacts) out.push({ type: 'trashContact', card });
  return out;
}

/** Nodes worth running: the three central nodes and any site with something there. */
export function runTargets(s: GameState): NodeId[] {
  return s.corp.nodes.filter((n) => !isSite(n.id) || n.root || n.ice.length).map((n) => n.id);
}

function ghostTurn(s: GameState): Action[] {
  const g = s.ghost;
  const out: Action[] = [];
  if (g.heat > 0) for (const card of g.gear) if (is(card, 'burner-phone')) out.push({ type: 'use', card });
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
    else if (d.type === 'stunt') {
      if (is(card, 'payroll-heist')) out.push({ type: 'play', card, node: 'command' });
      else if (is(card, 'deep-dive')) out.push({ type: 'play', card, node: 'mainframe' });
      else if (is(card, 'blackout')) for (const node of runTargets(s)) out.push({ type: 'play', card, node });
      else if (is(card, 'recon-sweep')) {
        for (const n of s.corp.nodes) if ((n.root && !n.root.active) || n.ice.some((i) => !i.active)) out.push({ type: 'play', card, node: n.id });
      } else if (is(card, 'salvage')) {
        for (const target of g.discard) if (['program', 'gear'].includes(cardOf(target).type)) out.push({ type: 'play', card, target });
      } else out.push({ type: 'play', card });
    }
  }
  for (const node of runTargets(s)) out.push({ type: 'run', node });
  if (g.heat > 0 && g.credits >= 2) out.push({ type: 'shedHeat' });
  for (const card of g.contacts) if (is(card, 'safehouse') && g.deck.length) out.push({ type: 'use', card });
  return out;
}

function runActions(s: GameState): Action[] {
  const run = s.run!;
  const g = s.ghost;
  switch (run.step) {
    case 'approach':
      return [{ type: 'activate', card: currentIce(s)!.card }, { type: 'decline' }];
    case 'encounter': {
      const ice = currentIce(s)!;
      const def = cardOf(ice.card);
      const out: Action[] = [];
      for (const card of g.programs) {
        if (!canBreak(card, ice.card)) continue;
        const b = cardOf(card).breaker!;
        if (breakerStrength(s, card) < (def.strength ?? 0)) {
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
