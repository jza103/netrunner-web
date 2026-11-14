// Saved games: a format number, a shape check, and a guard that the format is bumped when GameState changes.
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/engine/state';
import { SAVE_FORMAT, parseSave, setCurrentShape, stateShape } from '../src/ui/storage';
import { act, blank } from './helpers';

/** The shape that SAVE_FORMAT describes. If this test fails, GameState changed: bump SAVE_FORMAT in src/ui/storage.ts and update both lines. */
const FORMAT = 3;
const SHAPE =
  'state:corp,events,flags,gameId,ghost,ghostSuccessLastTurn,human,mulligan,phase,rngState,run,seq,setup,trace,turn,turnNumber,winReason,winner | corp:badPublicity,credits,cycles,deck,discard,discardSeen,hand,identity,nodes,recurring,removed,scored,siteCount | ghost:contacts,core,credits,cycles,deck,discard,gear,hand,heat,hosted,identity,known,programs,recurring,scored,virus | flags:prevented,successfulRun | setup:cards,decks,identities,packName | node:ice,id,root,upgrades';

describe('saved games', () => {
  setCurrentShape(stateShape(newGame({ seed: 0, human: 'ghost' })));

  it('GameState has the shape this save format describes', () => {
    expect(SAVE_FORMAT, 'bump SAVE_FORMAT and FORMAT together').toBe(FORMAT);
    expect(stateShape(newGame({ seed: 0, human: 'ghost' })), 'GameState changed shape: bump SAVE_FORMAT in src/ui/storage.ts, then update FORMAT and SHAPE here').toBe(SHAPE);
  });
  it('a save in the current format resumes exactly', () => {
    const s = act(blank(), { type: 'credit' });
    const r = parseSave(JSON.stringify({ format: SAVE_FORMAT, state: s }));
    expect(r.discarded).toBeUndefined();
    expect(r.state).toEqual(s);
  });
  it('a save in another format, broken text, or the wrong shape is set aside with a message', () => {
    const s = blank();
    expect(parseSave(JSON.stringify({ format: SAVE_FORMAT - 1, state: s })).discarded).toMatch(/older version/);
    expect(parseSave('{ not json').discarded).toMatch(/could not be read/);
    const old = structuredClone(s) as unknown as { ghost: Record<string, unknown> };
    delete old.ghost.virus;
    expect(parseSave(JSON.stringify({ format: SAVE_FORMAT, state: old })).state).toBeNull();
    expect(parseSave(null)).toEqual({ state: null });
  });
  it('an old save without a format field is carried over only when it still has the current shape', () => {
    const s = blank();
    expect(parseSave(JSON.stringify(s), true).state).toEqual(s);
    const old = structuredClone(s) as unknown as { corp: Record<string, unknown> };
    delete old.corp.identity;
    expect(parseSave(JSON.stringify(old), true).discarded).toMatch(/older version/);
  });
});
