import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { describeTable, narrationPrompt, questionPrompt, systemPrompt } from '../src/operator/prompt';
import { streamGm } from '../src/operator/client';
import { GmError, runClaudeAi, runOpenRouter } from '../src/operator/providers';
import { DEFAULT_GM, pickEvents, resolveProvider } from '../src/ui/operator';
import { recap } from '../src/ui/recap';
import { soundFor } from '../src/ui/sound';
import { botStep, simulate } from '../src/bots/driver';
import { CARDS } from '../src/engine/cards';
import { act, blank, ghostTurn, hand, ice, site } from './helpers';

describe('Operator prompts', () => {
  it('the system prompt carries the rules, every card and the hard limits', () => {
    const sys = systemPrompt('ghost');
    expect(sys).toContain('You are the Operator');
    expect(sys).toContain('Never invent');
    expect(sys).toContain('## Runs');
    for (const c of CARDS) expect(sys).toContain(c.name);
    expect(systemPrompt('corp')).toContain('The player is the Corp');
  });

  it('as the Ghost: never leaks the Corp hand, facedown cards or the deck', () => {
    let s = blank('ghost');
    const [w, p] = hand(s, 'corp', 'black-mamba', 'orbital-mandate');
    hand(s, 'corp', 'burn-notice');
    const [mine] = hand(s, 'ghost', 'mirrorshade');
    void mine;
    s = act(s, { type: 'install', card: w, node: 'command' });
    s = act(s, { type: 'install', card: p, node: 'new' });
    const text = narrationPrompt({ state: s, events: s.events, rejected: [], recent: [] }) + questionPrompt(s, 'what now?', s.events) + describeTable(s);
    for (const secret of ['Black Mamba', 'Orbital Mandate', 'Burn Notice']) expect(text).not.toContain(secret);
    expect(text).toContain('Mirrorshade');
    expect(text).toContain('hand: 1 cards (hidden)');
    expect(text).toContain('facedown card');
  });

  it('as the Corp: sees its own cards, never the Ghost hand', () => {
    let s = blank('corp');
    const [w] = hand(s, 'corp', 'black-mamba');
    hand(s, 'ghost', 'jackknife');
    s = act(s, { type: 'install', card: w, node: 'command' });
    const text = narrationPrompt({ state: s, events: s.events, rejected: [], recent: [] }) + describeTable(s);
    expect(text).toContain('You install Black Mamba protecting Command');
    expect(text).not.toContain('Jackknife');
  });

  it('describes a run in progress', () => {
    let s = ghostTurn(blank('ghost'));
    ice(s, 'command', 'bulkhead');
    s = act(s, { type: 'run', node: 'command' });
    expect(describeTable(s)).toMatch(/Run in progress on Command, step: encounter, at Bulkhead/);
  });

  it('includes rejected moves for a ⚖️ ruling', () => {
    const p = narrationPrompt({ state: blank(), events: [], rejected: ['Install Sledge — engine says: Sledge costs 4 and you have 1.'], recent: [] });
    expect(p).toContain('rejected');
    expect(p).toContain('Sledge costs 4');
  });

  it('asks for the debrief when the game is over', () => {
    const { state } = simulate({ seed: 3 });
    expect(narrationPrompt({ state, events: state.events, rejected: [], recent: [] })).toContain('3 or 4 moments');
  });
});

describe('when the Operator speaks', () => {
  it('only when the game is waiting on the human, and only with new events', () => {
    let s = blank('corp');
    expect(pickEvents(s, 0, false)?.length).toBeGreaterThan(0);
    expect(pickEvents(s, s.seq, false)).toBeNull();
    s = ghostTurn(s); // the bot is acting: wait
    expect(pickEvents(s, 0, false)).toBeNull();
  });

  it('"only my turns" skips events from the bot\'s turns', () => {
    let s = blank('corp');
    for (let i = 0; i < 3; i++) s = act(s, { type: 'credit' });
    s = act(s, { type: 'endTurn' });
    while (s.turn === 'ghost') s = botStep(s)!.state;
    const all = pickEvents(s, 0, false)!;
    const mine = pickEvents(s, 0, true)!;
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.some((e) => e.side === 'ghost' && e.type === 'credit')).toBe(false);
  });
});

describe('recap and sound', () => {
  it('the recap ends with the result and lists at most 5 key moments before it', () => {
    const { state } = simulate({ seed: 11 });
    const r = recap(state);
    expect(r.length).toBeGreaterThan(1);
    expect(r.length).toBeLessThanOrEqual(6);
    expect(r.at(-1)).toMatch(/wins/);
  });
  it('plays the most dramatic sound for a batch of events', () => {
    const ev = (type: string) => ({ seq: 1, type, text: '' });
    expect(soundFor([ev('run'), ev('encounter'), ev('damage')])).toBe('damage');
    expect(soundFor([ev('credit')])).toBeNull();
    expect(soundFor([ev('steal'), ev('gameOver')])).toBe('gameOver');
  });
  it('a trap in a site is described to both sides', () => {
    let s = ghostTurn(blank());
    const { id } = site(s, 'decoy-lab');
    hand(s, 'ghost', 'crowbar', 'crowbar', 'crowbar');
    s = act(s, { type: 'run', node: id });
    expect(s.events.some((e) => e.type === 'trap' && /Decoy Lab/.test(e.text))).toBe(true);
  });
});

describe('Operator client', () => {
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

describe('Operator providers', () => {
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
