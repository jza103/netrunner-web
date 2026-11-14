// Custom card packs: check a pack from JSON and turn it into a GameSetup. See reference/CARD_PACKS.md.
//
// A pack can only use the effect ops the engine already interprets, so every custom card is
// played by the same rules code as the built-in cards. Anything the engine could not carry out
// is rejected here, with a message that says which card and which field.
import { CARDS, defaultDeck, defaultIdentities, ensureCards } from './cards';
import { DAMAGE_KINDS, type CardDef, type CardPack, type CardType, type Effect, type GameSetup, type Side } from './types';

export type PackResult = { ok: true; setup: GameSetup; warnings: string[] } | { ok: false; errors: string[] };

const SIDE_TYPES: Record<Side, CardType[]> = {
  corp: ['project', 'ice', 'asset', 'upgrade', 'directive', 'identity'],
  ghost: ['program', 'gear', 'contact', 'stunt', 'identity'],
};
const INSTALLED_GHOST: CardType[] = ['program', 'gear', 'contact'];

/** Which fields each card type may have, beyond the common ones. */
const FIELDS: Record<string, CardType[]> = {
  cost: ['ice', 'asset', 'upgrade', 'directive', 'program', 'gear', 'contact', 'stunt'],
  recurring: ['asset', 'upgrade', ...INSTALLED_GHOST, 'identity'],
  link: [...INSTALLED_GHOST, 'identity'],
  virusOn: ['program'],
  virusAccess: ['program'],
  virusSpend: ['program'],
  host: ['gear'],
  onCorpScore: ['identity'],
  onSteal: ['identity'],
  dev: ['project'],
  points: ['project'],
  stealCost: ['project'],
  onScore: ['project'],
  subtype: ['ice'],
  strength: ['ice'],
  subs: ['ice'],
  trash: ['asset', 'upgrade'],
  developable: ['asset'],
  trap: ['asset', 'upgrade'],
  onAccess: ['asset', 'upgrade'],
  onActivateInRun: ['asset', 'upgrade'],
  iceStrength: ['upgrade'],
  onApproachNode: ['upgrade'],
  playIf: ['directive', 'stunt'],
  onPlay: ['directive', 'stunt'],
  removeAfterPlay: ['directive'],
  onTurnStart: ['asset', 'upgrade', ...INSTALLED_GHOST, 'identity'],
  onFirstSuccessfulRun: [...INSTALLED_GHOST, 'identity'],
  ability: INSTALLED_GHOST,
  ramBonus: [...INSTALLED_GHOST, 'identity'],
  handBonus: [...INSTALLED_GHOST, 'identity'],
  prevent: [...INSTALLED_GHOST, 'identity'],
  mainframeAccess: [...INSTALLED_GHOST, 'identity'],
  ram: ['program'],
  breaker: ['program'],
};
const COMMON = new Set(['id', 'name', 'side', 'type', 'copies', 'text']);

/** Where an effect list sits decides which ops it may use. */
type Slot = 'subs' | 'onApproachNode' | 'onActivateInRun' | 'onPlayCorp' | 'onPlayGhost' | 'instead' | 'plain' | 'traceInRun' | 'trace';

const ALWAYS = new Set(['gain', 'draw', 'damage', 'heat', 'shedHeat', 'loseCredits', 'drain', 'loseCycle', 'badPublicity', 'clearBadPublicity']);
const SLOT_OPS: Record<Slot, Set<string>> = {
  subs: new Set([...ALWAYS, 'endRun', 'trashProgram', 'payOrEndRun', 'trace']),
  onApproachNode: new Set([...ALWAYS, 'endRun', 'payOrEndRun']),
  onActivateInRun: new Set([...ALWAYS, 'endRun', 'payOrEndRun']),
  onPlayCorp: new Set([...ALWAYS, 'develop', 'recycleDump', 'trace']),
  onPlayGhost: new Set([...ALWAYS, 'run', 'reveal', 'recover']),
  instead: ALWAYS,
  plain: ALWAYS,
  /** what a trace may do when it succeeds: no nested traces or choices */
  traceInRun: new Set([...ALWAYS, 'endRun']),
  trace: ALWAYS,
};
const OP_KEYS: Record<string, string[]> = {
  gain: ['n', 'who'],
  draw: ['n', 'who'],
  damage: ['kind', 'n', 'perHeat', 'perDev'],
  heat: ['n'],
  shedHeat: ['n'],
  loseCredits: ['n', 'perHeat'],
  drain: ['n'],
  loseCycle: ['n'],
  trashProgram: [],
  endRun: [],
  payOrEndRun: ['n'],
  develop: ['n'],
  recycleDump: [],
  run: ['node', 'extraAccess', 'noActivate', 'bypass', 'instead'],
  trace: ['n', 'success'],
  badPublicity: ['n'],
  clearBadPublicity: ['n'],
  reveal: [],
  recover: ['types'],
};
const TARGETED = new Set(['develop', 'reveal', 'recover']);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isCount = (x: unknown, max = 99) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max;

/** A short stable hash, so one id always names one definition. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function checkEffects(list: unknown, slot: Slot, where: string, errs: string[]): Effect[] {
  if (!Array.isArray(list)) {
    errs.push(`${where}: must be a list of effects`);
    return [];
  }
  let targeted = 0;
  list.forEach((e, i) => {
    const at = `${where}[${i}]`;
    if (!isObj(e) || typeof e.op !== 'string' || !(e.op in OP_KEYS)) {
      errs.push(`${at}: unknown effect${isObj(e) && e.op ? ` "${String(e.op)}"` : ''}. Known ops: ${Object.keys(OP_KEYS).join(', ')}`);
      return;
    }
    const op = e.op;
    if (!SLOT_OPS[slot].has(op)) {
      errs.push(`${at}: "${op}" cannot be used here (allowed: ${[...SLOT_OPS[slot]].join(', ')})`);
      return;
    }
    for (const k of Object.keys(e)) if (k !== 'op' && !OP_KEYS[op].includes(k)) errs.push(`${at}: "${op}" has no field "${k}"`);
    if (OP_KEYS[op].includes('n') && !isCount(e.n, 20)) errs.push(`${at}: n must be a whole number from 0 to 20`);
    if (op === 'trace') checkEffects(e.success, slot === 'subs' ? 'traceInRun' : 'trace', `${at}.success`, errs);
    for (const k of ['perHeat', 'perDev', 'extraAccess', 'bypass'] as const) if (e[k] !== undefined && !isCount(e[k], 10)) errs.push(`${at}: ${k} must be a whole number from 0 to 10`);
    if (e.who !== undefined && e.who !== 'corp' && e.who !== 'ghost') errs.push(`${at}: who must be "corp" or "ghost"`);
    if (op === 'damage' && !DAMAGE_KINDS.includes(e.kind as never)) errs.push(`${at}: kind must be one of ${DAMAGE_KINDS.join(', ')}`);
    if (op === 'run') {
      if (!['command', 'mainframe', 'dump', 'any'].includes(e.node as string)) errs.push(`${at}: node must be command, mainframe, dump or any`);
      if (e.noActivate !== undefined && typeof e.noActivate !== 'boolean') errs.push(`${at}: noActivate must be true or false`);
      if (e.instead !== undefined) checkEffects(e.instead, 'instead', `${at}.instead`, errs);
      if (i !== list.length - 1) errs.push(`${at}: a run must be the last effect`);
      if (e.node === 'any') targeted++;
    }
    if (op === 'recover') {
      const ok = Array.isArray(e.types) && e.types.length > 0 && e.types.every((t) => [...SIDE_TYPES.ghost].includes(t as CardType));
      if (!ok) errs.push(`${at}: types must list Ghost card types (${SIDE_TYPES.ghost.join(', ')})`);
    }
    if (TARGETED.has(op)) targeted++;
  });
  if (targeted > 1) errs.push(`${where}: at most one effect may need a target (develop, reveal, recover, or a run on "any" node)`);
  return list as Effect[];
}

function checkCard(raw: unknown, i: number, errs: string[]): CardDef | null {
  if (!isObj(raw)) {
    errs.push(`cards[${i}]: must be an object`);
    return null;
  }
  const at = `card "${typeof raw.id === 'string' ? raw.id : `#${i + 1}`}"`;
  const n0 = errs.length;
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(raw.id)) errs.push(`${at}: id must be lowercase letters, digits and dashes`);
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 60) errs.push(`${at}: name is required (up to 60 characters)`);
  if (raw.side !== 'corp' && raw.side !== 'ghost') {
    errs.push(`${at}: side must be "corp" or "ghost"`);
    return null;
  }
  const side = raw.side as Side;
  const type = raw.type as CardType;
  if (!SIDE_TYPES[side].includes(type)) {
    errs.push(`${at}: type must be one of ${SIDE_TYPES[side].join(', ')} for the ${side}`);
    return null;
  }
  if (!isCount(raw.copies, 20)) errs.push(`${at}: copies must be a whole number from 0 to 20`);
  if (typeof raw.text !== 'string') errs.push(`${at}: text is required (use "" for ICE and breakers, whose text is generated)`);
  for (const k of Object.keys(raw)) {
    if (COMMON.has(k)) continue;
    if (!(k in FIELDS)) errs.push(`${at}: unknown field "${k}"`);
    else if (!FIELDS[k].includes(type)) errs.push(`${at}: a ${type} cannot have "${k}"`);
  }
  for (const k of ['cost', 'dev', 'points', 'stealCost', 'strength', 'trash', 'iceStrength', 'ram', 'ramBonus', 'handBonus', 'mainframeAccess'])
    if (raw[k] !== undefined && !isCount(raw[k], 20)) errs.push(`${at}: ${k} must be a whole number from 0 to 20`);
  for (const k of ['developable', 'trap', 'removeAfterPlay']) if (raw[k] !== undefined && typeof raw[k] !== 'boolean') errs.push(`${at}: ${k} must be true or false`);
  if (raw.playIf !== undefined && raw.playIf !== 'ghostHasHeat' && raw.playIf !== 'ghostRanLastTurn') errs.push(`${at}: playIf must be "ghostHasHeat" or "ghostRanLastTurn"`);

  // what each type needs
  if (type === 'project') {
    if (!(Number(raw.dev) > 0) || !(Number(raw.points) > 0)) errs.push(`${at}: a project needs dev and points above 0`);
  } else if (raw.cost === undefined && type !== 'identity') errs.push(`${at}: a ${type} needs a cost`);
  for (const k of ['link', 'virusAccess'] as const) if (raw[k] !== undefined && !isCount(raw[k], 10)) errs.push(`${at}: ${k} must be a whole number from 0 to 10`);
  if (raw.virusSpend !== undefined && typeof raw.virusSpend !== 'boolean') errs.push(`${at}: virusSpend must be true or false`);
  if (raw.virusOn !== undefined && !['central', 'mainframe', 'command', 'dump', 'any'].includes(raw.virusOn as string)) errs.push(`${at}: virusOn must be central, mainframe, command, dump or any`);
  if ((raw.virusAccess !== undefined || raw.virusSpend !== undefined) && raw.virusOn === undefined) errs.push(`${at}: a virus program needs virusOn, or it never gets counters`);
  if (raw.recurring !== undefined) {
    const r = raw.recurring;
    if (!isObj(r) || !isCount(r.n, 10) || !['breakers', 'activateIce', 'trace', 'any'].includes(r.for as string) || Object.keys(r).some((k) => k !== 'n' && k !== 'for'))
      errs.push(`${at}: recurring needs n (0 to 10) and for (breakers, activateIce, trace or any)`);
  }
  if (raw.host !== undefined) {
    const h = raw.host;
    if (!isObj(h) || !isCount(h.max, 5) || Number(h.max) < 1 || (h.breakerStrength !== undefined && !isCount(h.breakerStrength, 10)) || Object.keys(h).some((k) => k !== 'max' && k !== 'breakerStrength'))
      errs.push(`${at}: host needs max (1 to 5) and optionally breakerStrength`);
  }
  if (type === 'ice') {
    if (!['wall', 'cipher', 'hunter'].includes(raw.subtype as string)) errs.push(`${at}: subtype must be wall, cipher or hunter`);
    if (raw.strength === undefined) errs.push(`${at}: ICE needs a strength`);
    if (!Array.isArray(raw.subs) || !raw.subs.length) errs.push(`${at}: ICE needs at least one subroutine in "subs"`);
  }
  if ((type === 'asset' || type === 'upgrade') && raw.trash === undefined) errs.push(`${at}: a ${type} needs a trash cost`);
  if (type === 'program' && raw.ram === undefined) errs.push(`${at}: a program needs ram`);
  if (raw.trap && !Array.isArray(raw.onAccess)) errs.push(`${at}: a trap needs onAccess effects`);
  if ((type === 'directive' || type === 'stunt') && !Array.isArray(raw.onPlay)) errs.push(`${at}: a ${type} needs onPlay effects`);
  if (raw.breaker !== undefined) {
    const b = raw.breaker;
    const ok =
      isObj(b) &&
      ['wall', 'cipher', 'hunter', 'any'].includes(b.breaks as string) &&
      ['strength', 'boostCost', 'boostBy', 'breakCost'].every((k) => isCount(b[k], 20)) &&
      Number(b.boostBy) > 0 &&
      Object.keys(b).every((k) => ['breaks', 'strength', 'boostCost', 'boostBy', 'breakCost'].includes(k));
    if (!ok) errs.push(`${at}: breaker needs breaks (wall, cipher, hunter or any), strength, boostCost, boostBy (above 0) and breakCost`);
  }
  if (raw.prevent !== undefined) {
    const p = raw.prevent;
    if (!isObj(p) || !Object.entries(p).every(([k, v]) => DAMAGE_KINDS.includes(k as never) && isCount(v, 10))) errs.push(`${at}: prevent maps damage kinds (net, meat, core) to amounts`);
  }
  if (raw.ability !== undefined) {
    const a = raw.ability;
    if (!isObj(a) || (a.cycles !== 0 && a.cycles !== 1) || (a.credits !== undefined && !isCount(a.credits, 20)) || (a.trashSelf !== undefined && typeof a.trashSelf !== 'boolean'))
      errs.push(`${at}: ability needs cycles (0 or 1), and optionally credits, trashSelf and if`);
    else {
      if (a.if !== undefined && a.if !== 'ghostHasHeat' && a.if !== 'ghostRanLastTurn') errs.push(`${at}: ability.if must be "ghostHasHeat" or "ghostRanLastTurn"`);
      for (const k of Object.keys(a)) if (!['cycles', 'credits', 'trashSelf', 'if', 'effects'].includes(k)) errs.push(`${at}: ability has no field "${k}"`);
      checkEffects(a.effects, 'plain', `${at} ability.effects`, errs);
    }
  }

  const slots: [string, Slot][] = [
    ['subs', 'subs'],
    ['onApproachNode', 'onApproachNode'],
    ['onActivateInRun', 'onActivateInRun'],
    ['onPlay', side === 'corp' ? 'onPlayCorp' : 'onPlayGhost'],
    ['onScore', 'plain'],
    ['onAccess', 'plain'],
    ['onTurnStart', 'plain'],
    ['onFirstSuccessfulRun', 'plain'],
    ['onCorpScore', 'plain'],
    ['onSteal', 'plain'],
  ];
  for (const [k, slot] of slots) if (raw[k] !== undefined) checkEffects(raw[k], slot, `${at} ${k}`, errs);
  return errs.length === n0 ? (raw as unknown as CardDef) : null;
}

/** Check a pack and build the setup for a game with it. */
export function loadPack(raw: unknown): PackResult {
  const errs: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['A pack must be a JSON object with "name" and "cards".'] };
  for (const k of Object.keys(raw)) if (!['name', 'cards', 'decks'].includes(k)) errs.push(`unknown top-level field "${k}"`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) errs.push('the pack needs a "name"');
  if (!Array.isArray(raw.cards)) return { ok: false, errors: [...errs, 'the pack needs a "cards" list (it may be empty if "decks" uses only built-in cards)'] };
  if (raw.cards.length > 200) errs.push('a pack can have at most 200 cards');

  const defs: CardDef[] = [];
  const seen = new Set<string>();
  raw.cards.forEach((c, i) => {
    const d = checkCard(c, i, errs);
    if (!d) return;
    if (seen.has(d.id)) errs.push(`card "${d.id}": the id is used twice`);
    seen.add(d.id);
    defs.push(d);
  });

  // namespace each card by its content
  const idMap = new Map<string, string>();
  const cards = defs.map((d) => {
    const id = `x${hash(JSON.stringify(d))}-${d.id}`;
    idMap.set(d.id, id);
    return { ...d, id };
  });
  const builtIn = new Map(CARDS.map((c) => [c.id, c]));
  const sideOf = (id: string): Side | undefined => defs.find((d) => d.id === id)?.side ?? builtIn.get(id)?.side;

  const decks = {} as Record<Side, Record<string, number>>;
  const given = isObj(raw.decks) ? raw.decks : undefined;
  if (raw.decks !== undefined && !given) errs.push('"decks" must be an object with "corp" and/or "ghost" lists');
  if (given) for (const k of Object.keys(given)) if (k !== 'corp' && k !== 'ghost') errs.push(`decks: unknown side "${k}"`);
  for (const side of ['corp', 'ghost'] as const) {
    const list = given?.[side];
    if (list === undefined) {
      // the built-in deck, with pack cards replacing built-in cards of the same id, plus new pack cards
      decks[side] = defaultDeck(side);
      for (const d of defs) {
        if (d.side !== side || d.type === 'identity') continue;
        delete decks[side][d.id];
        if (d.copies > 0) decks[side][idMap.get(d.id)!] = d.copies;
      }
      continue;
    }
    if (!isObj(list)) {
      errs.push(`decks.${side}: must map card ids to copies, like { "my-card": 3 }`);
      continue;
    }
    decks[side] = {};
    for (const [id, copies] of Object.entries(list)) {
      const s = sideOf(id);
      const isId = (defs.find((d) => d.id === id) ?? builtIn.get(id))?.type === 'identity';
      if (!s) errs.push(`decks.${side}: no card "${id}" in this pack or the built-in set`);
      else if (isId) errs.push(`decks.${side}: "${id}" is an identity; identities are chosen when a game starts, not put in decks`);
      else if (s !== side) errs.push(`decks.${side}: "${id}" is a ${s} card`);
      else if (!isCount(copies, 20)) errs.push(`decks.${side}: copies of "${id}" must be a whole number from 0 to 20`);
      else if ((copies as number) > 0) decks[side][idMap.get(id) ?? id] = copies as number;
    }
  }
  if (errs.length) return { ok: false, errors: errs };

  const problems = deckProblems(decks, cards);
  warnings.push(...problems.warnings);
  if (problems.errors.length) return { ok: false, errors: problems.errors };

  // the pack's first identity for each side, else the built-in default
  const identities = defaultIdentities();
  for (const side of ['corp', 'ghost'] as const) {
    const own = cards.find((c) => c.side === side && c.type === 'identity');
    const replacedDefault = defs.find((d) => d.id === identities[side]);
    if (own) identities[side] = own.id;
    else if (replacedDefault) identities[side] = idMap.get(replacedDefault.id)!;
  }
  return { ok: true, setup: { packName: (raw.name as string).trim(), identities, cards, decks }, warnings };
}

/** The built-in set written as a pack: a template to copy and change. */
export function builtInPack(): CardPack {
  return { name: 'Breachline core set', cards: CARDS.map((c) => ({ ...c })) };
}

/** Parse pack JSON text, with a friendly message for syntax errors. */
export function parsePack(text: string): PackResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`That is not valid JSON: ${(e as Error).message}`] };
  }
  return loadPack(raw);
}

/** Deck size limits, and warnings for decks that cannot be won on points or have no breakers. */
export function deckProblems(decks: Record<Side, Record<string, number>>, custom: CardDef[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map([...CARDS, ...custom].map((c) => [c.id, c]));
  for (const side of ['corp', 'ghost'] as const) {
    const size = Object.values(decks[side]).reduce((a, b) => a + b, 0);
    if (size < 15) errors.push(`the ${side} deck has ${size} cards; it needs at least 15`);
    if (size > 120) errors.push(`the ${side} deck has ${size} cards; the most is 120`);
  }
  const pts = Object.entries(decks.corp).reduce((n, [id, k]) => n + (byId.get(id)?.points ?? 0) * k, 0);
  if (pts < 7) warnings.push(`the Corp deck has only ${pts} project points, so no one can win on points (the game ends when the Mainframe runs out)`);
  const breakers = Object.entries(decks.ghost).filter(([id, k]) => k > 0 && byId.get(id)?.breaker);
  if (!breakers.length) warnings.push('the Ghost deck has no breakers, so any active "end the run" stops every run');
  return { errors, warnings };
}

const strip = (id: string) => id.replace(/^x[0-9a-f]{8}-/, '');

/** Cards a deck for this side can be built from: built-in cards the pack does not replace, plus the pack's. No identities. */
export function deckPool(setup: GameSetup, side: Side): CardDef[] {
  ensureCards({ setup });
  const replaced = new Set(setup.cards.map((c) => strip(c.id)));
  return [...CARDS.filter((c) => !replaced.has(c.id)), ...setup.cards].filter((c) => c.side === side && c.type !== 'identity');
}

/** A setup written back out as a pack file, with plain ids, so it can be shared, edited and loaded again. */
export function exportPack(setup: GameSetup, name = setup.packName ?? 'My decks'): CardPack {
  const decks: Record<Side, Record<string, number>> = { corp: {}, ghost: {} };
  for (const side of ['corp', 'ghost'] as const) for (const [id, n] of Object.entries(setup.decks[side])) if (n > 0) decks[side][strip(id)] = n;
  return { name, cards: setup.cards.map((c) => ({ ...c, id: strip(c.id) })), decks };
}
