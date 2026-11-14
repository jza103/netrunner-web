// Bring-your-own-key Claude client. The browser calls the API directly; the key stays on this device.
import Anthropic from '@anthropic-ai/sdk';

import type { GmModel } from './models';
export { DEFAULT_GM_MODEL, GM_MODELS, type GmModel } from './models';

export interface GmResult {
  text: string;
  /** set when Claude declined (stop_reason "refusal") */
  refused: boolean;
}

export type MakeClient = (apiKey: string) => Anthropic;

export const makeClient: MakeClient = (apiKey) => new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

/** Stream one Operator reply. `onText` receives the reply so far as it grows. */
export async function streamGm(
  client: Anthropic,
  opts: { model: GmModel; system: string; user: string; signal?: AbortSignal },
  onText: (soFar: string) => void,
): Promise<GmResult> {
  // Opus/Sonnet 5.5 can fall back server-side if a safety classifier declines; Haiku has no fallback.
  const fallback = opts.model !== 'claude-haiku-5-5';
  const stream = client.beta.messages.stream(
    {
      model: opts.model,
      max_tokens: 4000,
      // effort low: short narration, cheap and fast (thinking stays adaptive)
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: opts.user }],
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    },
    { signal: opts.signal },
  );
  let text = '';
  stream.on('text', (delta) => {
    text += delta;
    onText(text);
  });
  const msg = await stream.finalMessage();
  return { text, refused: msg.stop_reason === 'refusal' };
}

/** A short, human message for an API failure. */
export function explainError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in Operator settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model.";
  if (e instanceof Anthropic.NotFoundError) return 'That model is not available to this key.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Narration will resume on the next event.';
  if (e instanceof Anthropic.BadRequestError) return `The API rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API (offline?).';
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ''}: ${e.message}`;
  if (e instanceof Error && e.name === 'AbortError') return 'Cancelled.';
  return String(e);
}
