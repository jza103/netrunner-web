import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { describeTable, narrationPrompt, questionPrompt, skillSection, systemPrompt } from '../src/gm/prompt';
import { streamGm } from '../src/gm/client';
import { pickEvents } from '../src/ui/gm';
import { recap } from '../src/ui/recap';
import { soundFor } from '../src/ui/sound';
import { simulate } from '../src/bots/driver';
import { nameOf } from '../src/engine/cards';
import { A, J, act, blank, give, kick } from './helpers';

describe('GM prompts', () => {
  it('system prompt carries the skill’s narration, rules and rival sections, not its engine commands', () => {
    const sys = systemPrompt();
    expect(skillSection('Narration style')).toContain('⚖️');
    expect(sys).toContain('## Narration style');
    expect(sys).toContain('## Rules cheat sheet');
    expect(sys).toContain('## Playing the rivals');
    expect(sys).toContain('Never invent');
    expect(sys).not.toMatch(/munchkin\.py/);
  });

  it('never leaks rival hand contents, only counts', () => {
    let s = blank();
    const secret = give(s, A, 'Plutonium Dragon');
    give(s, A, 'Wishing Ring');
    const mine = give(s, J, 'Magic Missile');
    s = kick(s, 'Pit Bull');
    const text = narrationPrompt({ state: s, events: s.events, rejected: [], recent: [] }) + questionPrompt(s, 'what now?', s.events) + describeTable(s);
    expect(text).not.toContain(nameOf(secret));
    expect(text).not.toContain('Wishing Ring');
    expect(text).toContain(nameOf(mine));
    expect(text).toContain('2 cards (1 Door, 1 Treasure)');
    expect(text).toContain('Pit Bull');
  });

  it('includes rejected moves for a ⚖️ ruling', () => {
    const s = blank();
    const p = narrationPrompt({ state: s, events: [], rejected: ['Sell Huge Rock — engine says: no Gold value'], recent: [] });
    expect(p).toContain('rejected');
    expect(p).toContain('Huge Rock');
  });

  it('asks for the end-of-game recap when the game is over', () => {
    const { state } = simulate({ seed: 3, rivals: 2 });
    const p = narrationPrompt({ state, events: state.events, rejected: [], recent: [] });
    expect(p).toContain('3 or 4 moments');
  });
});

describe('when the GM speaks', () => {
  it('only when the game is waiting on the human, and only with new events', () => {
    let s = blank();
    expect(pickEvents(s, 0, false)?.length).toBeGreaterThan(0);
    expect(pickEvents(s, s.eventSeq, false)).toBeNull();
    s = act(s, { type: 'kickDoor', player: J });
    s.turn = A; // a bot is acting: wait
    s.phase = 'setup';
    s.combat = null;
    s.pending = null;
    expect(pickEvents(s, 0, false)).toBeNull();
  });

  it('"only my turns" skips events from rival turns', () => {
    const { state } = simulate({ seed: 5, rivals: 2 });
    const all = pickEvents(state, 0, false)!;
    const mine = pickEvents({ ...state, phase: 'setup', turn: state.human, pending: null, combat: null }, 0, true) ?? [];
    expect(mine.length).toBeLessThan(all.length);
  });
});

describe('GM client', () => {
  function fakeClient(chunks: string[], stop = 'end_turn') {
    const calls: unknown[] = [];
    const client = {
      beta: {
        messages: {
          stream(params: unknown) {
            calls.push(params);
            let cb: (d: string) => void = () => {};
            return {
              on(_ev: string, f: (d: string) => void) {
                cb = f;
                return this;
              },
              async finalMessage() {
                for (const c of chunks) cb(c);
                return { stop_reason: stop };
              },
            };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  it('streams text and uses the cheap model at low effort with a cached system prompt', async () => {
    const { client, calls } = fakeClient(['🚪 You kick ', 'the door.']);
    const seen: string[] = [];
    const r = await streamGm(client, { model: 'claude-haiku-5-5', system: 'SYS', user: 'U' }, (t) => seen.push(t));
    expect(r).toEqual({ text: '🚪 You kick the door.', refused: false });
    expect(seen).toEqual(['🚪 You kick ', '🚪 You kick the door.']);
    expect(calls[0]).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
    });
    expect(calls[0]).not.toHaveProperty('fallbacks');
  });

  it('opts Opus/Sonnet into server-side fallbacks and reports refusals', async () => {
    const { client, calls } = fakeClient([], 'refusal');
    const r = await streamGm(client, { model: 'claude-opus-5-5', system: 'S', user: 'U' }, () => {});
    expect(r.refused).toBe(true);
    expect(calls[0]).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  });
});

describe('end-of-game recap and sound', () => {
  it('recap picks at most 4 moments, ending with the winning kill', () => {
    const { state } = simulate({ seed: 11, rivals: 3 });
    const r = recap(state);
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(4);
    expect(r.at(-1)!.text).toContain('defeat');
    expect(recap(blank())).toEqual([]);
  });

  it('plays the most dramatic sound for a batch of events', () => {
    const ev = (type: string, text = '', data?: Record<string, unknown>) => ({ seq: 1, turn: 1, type, text, data });
    expect(soundFor([ev('door'), ev('death', 'Jason is DEAD.')])).toBe('death');
    expect(soundFor([ev('level', '', { from: 2, to: 3 })])).toBe('levelUp');
    expect(soundFor([ev('note')])).toBeNull();
  });
});

import { GmError, runClaudeAi, runOpenRouter } from '../src/gm/providers';
import { DEFAULT_GM, resolveProvider } from '../src/ui/gm';

describe('GM providers', () => {
  const call = (kind: 'narration' | 'answer' = 'narration') => {
    const seen: string[] = [];
    return { seen, c: { system: 'SYS', user: 'USER', kind, onText: (t: string) => seen.push(t) } };
  };

  it('OpenRouter: streams SSE deltas, sends the system prompt cached and low reasoning effort', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const body = [
      ': OPENROUTER PROCESSING\n\n',
      'data: {"choices":[{"delta":{"content":"🚪 The door"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" creaks."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    ];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(new ReadableStream({ start(c) { for (const b of body) c.enqueue(new TextEncoder().encode(b)); c.close(); } }), { status: 200 });
    }) as unknown as typeof fetch;
    const { seen, c } = call();
    const r = await runOpenRouter('sk-or-x', 'anthropic/claude-haiku-5.5', c, fetchImpl);
    expect(r).toEqual({ text: '🚪 The door creaks.', refused: false });
    expect(seen).toEqual(['🚪 The door', '🚪 The door creaks.']);
    expect(sent!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-x');
    const req = JSON.parse(sent!.init.body as string);
    expect(req).toMatchObject({ model: 'anthropic/claude-haiku-5.5', stream: true, reasoning: { effort: 'low' } });
    expect(req.messages[0].content[0]).toMatchObject({ text: 'SYS', cache_control: { type: 'ephemeral' } });
    expect(req.messages[1]).toEqual({ role: 'user', content: 'USER' });
  });

  it('OpenRouter: explains a bad key and an empty balance', async () => {
    const err = (status: number) =>
      (async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status })) as unknown as typeof fetch;
    await expect(runOpenRouter('k', 'm', call().c, err(401))).rejects.toThrow(/rejected the API key/);
    await expect(runOpenRouter('k', 'm', call().c, err(402))).rejects.toThrow(/out of credits/);
  });

  it('built-in Claude: one prompt with the instructions first, quick tier for narration, errors pause narration', async () => {
    const calls: { input: unknown; opts: Record<string, unknown> }[] = [];
    const sample = (async (input: unknown, opts: Record<string, unknown>) => {
      calls.push({ input, opts });
      (opts.onText as (u: { text: string; delta: string }) => void)({ text: 'Hi', delta: 'Hi' });
      return { text: 'Hi', truncated: false };
    }) as never;
    const { seen, c } = call();
    expect(await runClaudeAi(sample, c)).toEqual({ text: 'Hi', refused: false });
    expect(seen).toEqual(['Hi']);
    expect(calls[0].input).toMatch(/^SYS[\s\S]*USER$/);
    expect(calls[0].opts).toMatchObject({ modelTier: 'quick', cache: false });
    await runClaudeAi(sample, call('answer').c);
    expect(calls[1].opts.modelTier).toBe('default');

    const denied = (async () => Promise.reject({ code: 'not_granted', message: 'x' })) as never;
    const e = await runClaudeAi(denied, c).catch((x) => x);
    expect(e).toBeInstanceOf(GmError);
    expect(e.pause).toBe(true);
    const refused = (async () => Promise.reject({ code: 'refused', message: 'x' })) as never;
    expect(await runClaudeAi(refused, c)).toEqual({ text: '', refused: true });
  });

  it('auto picks built-in Claude on claude.ai, else OpenRouter, else Anthropic', () => {
    const none = { anthropic: '', openrouter: '' };
    expect(resolveProvider(DEFAULT_GM, true, { anthropic: 'a', openrouter: 'o' })).toBe('claude-ai');
    expect(resolveProvider(DEFAULT_GM, false, { anthropic: 'a', openrouter: 'o' })).toBe('openrouter');
    expect(resolveProvider(DEFAULT_GM, false, { anthropic: 'a', openrouter: '' })).toBe('anthropic');
    expect(resolveProvider(DEFAULT_GM, false, none)).toBeNull();
    expect(resolveProvider({ ...DEFAULT_GM, provider: 'claude-ai' }, false, none)).toBeNull();
  });
});
