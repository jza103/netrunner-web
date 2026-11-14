// Where Operator narration comes from. Three options:
//  - 'claude-ai'  : Claude built into claude.ai, when the app runs as a claude.ai artifact.
//                   Uses the viewer's own Claude plan; no key. (Not available on GitHub Pages.)
//  - 'openrouter' : an OpenRouter API key, called straight from the browser.
//  - 'anthropic'  : an Anthropic API key (SDK loaded on first use).
// None of them can change the game: they only receive text and return text.
import type { GmModel } from './models';

export type ProviderId = 'claude-ai' | 'openrouter' | 'anthropic';

export interface GmCall {
  system: string;
  user: string;
  /** narration is short and frequent; answers/recaps can think a little more */
  kind: 'narration' | 'answer';
  signal?: AbortSignal;
  onText: (soFar: string) => void;
}

export interface GmResult {
  text: string;
  refused: boolean;
}

/** A failure to show the player. `pause` stops automatic narration until the player acts again. */
export class GmError extends Error {
  constructor(
    message: string,
    public pause = true,
  ) {
    super(message);
  }
}

// ---------------- claude.ai built-in Claude (artifact `sample` capability) ----------------

interface SampleError {
  code: string;
  message: string;
  text?: string;
}
type SampleFn = (
  input: string | { role: 'user' | 'assistant'; content: string }[],
  options?: {
    onText?: (u: { text: string; delta: string }) => void;
    signal?: AbortSignal;
    modelTier?: 'quick' | 'default' | 'complex';
    cache?: boolean;
  },
) => Promise<{ text: string; truncated: boolean }>;

let samplePromise: Promise<SampleFn | null> | null = null;

/** Resolves the built-in Claude function, or null when the page is not running as a claude.ai artifact. */
export function builtInClaude(): Promise<SampleFn | null> {
  if (samplePromise) return samplePromise;
  const c = (globalThis as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  samplePromise = c?.use ? c.use('sample').then((f) => (typeof f === 'function' ? (f as SampleFn) : null)).catch(() => null) : Promise.resolve(null);
  return samplePromise;
}

export function sampleErrorText(e: SampleError): string {
  switch (e.code) {
    case 'not_granted':
      return 'You did not allow this page to use Claude. Reload the page to be asked again, or turn Operator mode off.';
    case 'sampling_disabled':
      return 'Claude is not available for this account here.';
    case 'rate_limited':
      return 'Claude usage limit or too many requests. Narration pauses until your next move.';
    case 'session_expired':
      return 'Your claude.ai session expired. Sign in again.';
    case 'refused':
      return '(The Operator declined to narrate this one.)';
    case 'cancelled':
      return 'Cancelled.';
    case 'prompt_too_large':
      return 'Too much to narrate at once.';
    default:
      return `Claude could not answer (${e.code}). Try again after your next move.`;
  }
}

export async function runClaudeAi(sample: SampleFn, call: GmCall): Promise<GmResult> {
  try {
    // No system prompt on this surface: the instructions lead the input.
    const { text } = await sample(`${call.system}\n\n=====\n\n${call.user}`, {
      modelTier: call.kind === 'narration' ? 'quick' : 'default',
      signal: call.signal,
      cache: false,
      onText: ({ text: t }) => call.onText(t),
    });
    return { text, refused: false };
  } catch (err) {
    const e = err as SampleError;
    if (e?.code === 'refused') return { text: '', refused: true };
    throw new GmError(sampleErrorText(e), e?.code !== 'cancelled');
  }
}

// ---------------- OpenRouter ----------------

export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';
export const OPENROUTER_FALLBACK_MODELS = [
  'anthropic/claude-haiku-5.5',
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-opus-5.5',
];

/** Public model list (no key needed); Claude models first. Falls back to a short built-in list. */
export async function openRouterModels(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const r = await fetchImpl('https://openrouter.ai/api/v1/models');
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { data: { id: string }[] };
    const ids = j.data.map((m) => m.id).filter((id) => !id.endsWith(':batch'));
    const claude = ids.filter((id) => id.startsWith('anthropic/'));
    return claude.length ? claude : OPENROUTER_FALLBACK_MODELS;
  } catch {
    return OPENROUTER_FALLBACK_MODELS;
  }
}

function openRouterHttpError(status: number, message: string): GmError {
  if (status === 401) return new GmError('OpenRouter rejected the API key. Check it in Operator settings.');
  if (status === 402) return new GmError('Your OpenRouter account is out of credits.');
  if (status === 403) return new GmError(`OpenRouter refused the request: ${message}`);
  if (status === 404) return new GmError('That model is not available on OpenRouter. Pick another in Operator settings.');
  if (status === 429) return new GmError('OpenRouter rate limit. Narration pauses until your next move.');
  return new GmError(`OpenRouter error ${status}: ${message}`);
}

export async function runOpenRouter(apiKey: string, model: string, call: GmCall, fetchImpl: typeof fetch = fetch): Promise<GmResult> {
  let res: Response;
  try {
    res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: call.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Breachline web app',
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: call.kind === 'narration' ? 1500 : 3000,
        reasoning: { effort: 'low' },
        messages: [
          // cache_control keeps the long, unchanging Operator instructions cached on Claude models
          { role: 'system', content: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }] },
          { role: 'user', content: call.user },
        ],
      }),
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new GmError('Cancelled.', false);
    throw new GmError('Could not reach OpenRouter (offline?).');
  }
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* keep statusText */
    }
    throw openRouterHttpError(res.status, msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let refused = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue; // comments like ": OPENROUTER PROCESSING"
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j: { error?: { message?: string; code?: number }; choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (j.error) throw openRouterHttpError(Number(j.error.code) || 500, j.error.message ?? 'stream error');
      const ch = j.choices?.[0];
      if (ch?.delta?.content) {
        text += ch.delta.content;
        call.onText(text);
      }
      if (ch?.finish_reason === 'content_filter' || ch?.finish_reason === 'refusal') refused = true;
    }
  }
  return { text, refused };
}

// ---------------- Anthropic API key ----------------

export async function runAnthropic(apiKey: string, model: GmModel, call: GmCall): Promise<GmResult> {
  const { makeClient, streamGm, explainError } = await import('./client');
  try {
    return await streamGm(makeClient(apiKey), { model, system: call.system, user: call.user, signal: call.signal }, call.onText);
  } catch (e) {
    throw new GmError(explainError(e));
  }
}
