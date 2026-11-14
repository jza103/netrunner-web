// Model choices for GM mode (kept apart from the SDK so the game loads without it).
export const GM_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fast, cheapest — default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best, priciest)' },
] as const;
export type GmModel = (typeof GM_MODELS)[number]['id'];
export const DEFAULT_GM_MODEL: GmModel = 'claude-haiku-5-5';

