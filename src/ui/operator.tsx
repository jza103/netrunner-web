// Optional Operator mode. Reads engine events and the human's view; never changes game state.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameEvent, GameState } from '../engine/types';
import { actor } from '../engine/state';
import { DEFAULT_GM_MODEL, GM_MODELS, type GmModel } from '../operator/models';
import { eventsWithTurnPlayer, narrationPrompt, questionPrompt, systemPrompt } from '../operator/prompt';
import {
  GmError,
  type GmCall,
  type GmResult,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_FALLBACK_MODELS,
  type ProviderId,
  builtInClaude,
  openRouterModels,
  runAnthropic,
  runClaudeAi,
  runOpenRouter,
} from '../operator/providers';

const KEY = 'breachline:operator:v1';
const KEYS: Record<'anthropic' | 'openrouter', string> = {
  anthropic: 'breachline:operator-key:v1',
  openrouter: 'breachline:operator-openrouter-key:v1',
};

export interface GmSettings {
  enabled: boolean;
  /** 'auto': built-in Claude on claude.ai, else whichever key is set (OpenRouter first) */
  provider: ProviderId | 'auto';
  /** model for an Anthropic key */
  model: GmModel;
  /** model for OpenRouter */
  orModel: string;
  onlyMyTurns: boolean;
}

export interface GmEntry {
  id: number;
  kind: 'narration' | 'answer' | 'error' | 'question';
  text: string;
  streaming?: boolean;
}

interface GmMemory {
  seed: string;
  lastSeq: number;
  recapped: boolean;
  entries: GmEntry[];
}

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function loadKey(p: 'anthropic' | 'openrouter'): string {
  try {
    return localStorage.getItem(KEYS[p]) ?? '';
  } catch {
    return '';
  }
}
export function saveKey(p: 'anthropic' | 'openrouter', k: string) {
  try {
    if (k) localStorage.setItem(KEYS[p], k);
    else localStorage.removeItem(KEYS[p]);
  } catch {
    /* ignore */
  }
}

export const DEFAULT_GM: GmSettings = {
  enabled: false,
  provider: 'auto',
  model: DEFAULT_GM_MODEL,
  orModel: OPENROUTER_DEFAULT_MODEL,
  onlyMyTurns: false,
};
export function loadGmSettings(): GmSettings {
  return read(`${KEY}:settings`, DEFAULT_GM);
}
export function saveGmSettings(s: GmSettings) {
  write(`${KEY}:settings`, s);
}

/** Is the built-in claude.ai Claude available here? undefined while still checking. */
export function useBuiltIn(): boolean | undefined {
  const [ok, setOk] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    void builtInClaude().then((f) => setOk(!!f));
  }, []);
  return ok;
}

/** Which provider will actually answer, or null when none is set up. */
export function resolveProvider(s: GmSettings, builtIn: boolean | undefined, keys: { anthropic: string; openrouter: string }): ProviderId | null {
  const usable = (p: ProviderId) => (p === 'claude-ai' ? !!builtIn : !!keys[p]);
  if (s.provider !== 'auto') return usable(s.provider) ? s.provider : null;
  return (['claude-ai', 'openrouter', 'anthropic'] as const).find(usable) ?? null;
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  'claude-ai': 'Claude on claude.ai (your Claude plan, no key)',
  openrouter: 'OpenRouter API key',
  anthropic: 'Anthropic API key',
};

/** Events to narrate now, or null if it's not a good moment (bots mid-flow, nothing new). */
export function pickEvents(s: GameState, lastSeq: number, onlyMyTurns: boolean): GameEvent[] | null {
  const waitingOnHuman = actor(s) === s.human || s.phase === 'gameOver';
  if (!waitingOnHuman) return null;
  let fresh = s.events.filter((e) => e.seq > lastSeq);
  if (onlyMyTurns && s.phase !== 'gameOver')
    fresh = eventsWithTurnPlayer(s.events, 'corp')
      .filter(({ e, turnPlayer }) => e.seq > lastSeq && turnPlayer === s.human)
      .map(({ e }) => e);
  return fresh.length ? fresh : null;
}

export function useGm(s: GameState, settings: GmSettings) {
  const builtIn = useBuiltIn();
  const [keys, setKeys] = useState({ anthropic: loadKey('anthropic'), openrouter: loadKey('openrouter') });
  const provider = resolveProvider(settings, builtIn, keys);
  const [mem, setMem] = useState<GmMemory>(() => {
    const m = read<GmMemory>(`${KEY}:memory`, { seed: s.gameId, lastSeq: 0, recapped: false, entries: [] });
    return m.seed === s.gameId ? m : { seed: s.gameId, lastSeq: Math.max(0, s.seq - 12), recapped: false, entries: [] };
  });
  const [busy, setBusy] = useState(false);
  // after an error, automatic narration waits for the player's next move (never retries by itself)
  const [paused, setPaused] = useState(false);
  const rejected = useRef<string[]>([]);
  const [tick, setTick] = useState(0);
  const nextId = useRef(Date.now());

  useEffect(() => write(`${KEY}:memory`, { ...mem, entries: mem.entries.filter((e) => !e.streaming).slice(-40) }), [mem]);
  useEffect(() => {
    if (mem.seed !== s.gameId) setMem({ seed: s.gameId, lastSeq: Math.max(0, s.seq - 12), recapped: false, entries: [] });
  }, [s.gameId]);
  const wasOn = useRef(settings.enabled);
  useEffect(() => {
    if (settings.enabled && !wasOn.current) setMem((m) => ({ ...m, lastSeq: Math.max(m.lastSeq, s.seq - 12) }));
    wasOn.current = settings.enabled;
  }, [settings.enabled]);

  const call = async (c: GmCall): Promise<GmResult> => {
    if (provider === 'claude-ai') {
      const sample = await builtInClaude();
      if (!sample) throw new GmError('Built-in Claude is not available on this page.');
      return runClaudeAi(sample, c);
    }
    if (provider === 'openrouter') return runOpenRouter(keys.openrouter, settings.orModel || OPENROUTER_DEFAULT_MODEL, c);
    if (provider === 'anthropic') return runAnthropic(keys.anthropic, settings.model, c);
    throw new GmError('Set up the Operator first (Operator settings).');
  };

  const run = async (kind: 'narration' | 'answer', user: string, after: (m: GmMemory) => GmMemory) => {
    const id = ++nextId.current;
    setBusy(true);
    setMem((m) => after({ ...m, entries: [...m.entries, { id, kind, text: '', streaming: true }] }));
    const update = (text: string, done = false, errKind?: GmEntry['kind']) =>
      setMem((m) => ({ ...m, entries: m.entries.map((e) => (e.id === id ? { ...e, text, streaming: !done, kind: errKind ?? e.kind } : e)) }));
    try {
      const r = await call({ system: systemPrompt(s), user, kind, onText: (t) => update(t) });
      update(r.refused && !r.text ? '(The Operator declined to narrate this one.)' : r.text, true);
    } catch (e) {
      const ge = e instanceof GmError ? e : new GmError(String(e));
      if (ge.pause) setPaused(true);
      update(`⚠️ ${ge.message}`, true, 'error');
    } finally {
      setBusy(false);
    }
  };

  const recent = () => mem.entries.filter((e) => e.kind === 'narration' && e.text).slice(-1).map((e) => e.text);

  // Narrate when the game is waiting on the player (or is over) and something new happened.
  useEffect(() => {
    if (!settings.enabled || !provider || busy || paused) return;
    if (s.phase === 'gameOver') {
      if (mem.recapped) return;
      void run('answer', narrationPrompt({ state: s, events: s.events.slice(-250), rejected: [], recent: recent() }), (m) => ({
        ...m,
        recapped: true,
        lastSeq: s.seq,
      }));
      return;
    }
    const events = pickEvents(s, mem.lastSeq, settings.onlyMyTurns);
    const rej = rejected.current;
    if (!events && !rej.length) return;
    rejected.current = [];
    void run('narration', narrationPrompt({ state: s, events: events ?? [], rejected: rej, recent: recent() }), (m) => ({
      ...m,
      lastSeq: s.seq,
    }));
  }, [s, settings.enabled, provider, busy, paused, tick]);

  return {
    provider,
    builtIn,
    keys,
    setKey: (p: 'anthropic' | 'openrouter', k: string) => {
      saveKey(p, k);
      setKeys((x) => ({ ...x, [p]: k }));
      setPaused(false);
    },
    entries: mem.entries,
    busy,
    paused,
    /** The player made a move: resume narration if an error had paused it. */
    notifyAction: () => setPaused(false),
    /** Report a move the engine rejected, for a ⚖️ ruling. */
    reportRejected: (text: string) => {
      if (!settings.enabled) return;
      rejected.current.push(text);
      setPaused(false);
      setTick((t) => t + 1);
    },
    ask: (question: string) => {
      if (!provider || busy || !question.trim()) return;
      const qid = ++nextId.current;
      setMem((m) => ({ ...m, entries: [...m.entries, { id: qid, kind: 'question', text: question }] }));
      void run('answer', questionPrompt(s, question, s.events.slice(-15)), (m) => m);
    },
    clear: () => setMem((m) => ({ ...m, entries: [] })),
  };
}

export type Gm = ReturnType<typeof useGm>;

export function GmPanel({ gm, settings, onSettings }: { gm: Gm; settings: GmSettings; onSettings: () => void }) {
  const [q, setQ] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [gm.entries]);
  if (!settings.enabled) return null;
  return (
    <section class="panel gm" aria-label="Operator">
      <header class="row">
        <span>
          🎧 Operator {gm.busy && <span class="muted small">· narrating…</span>}
          {gm.paused && !gm.busy && <span class="muted small">· paused until your next move</span>}
        </span>
        <button class="ghost small" onClick={onSettings}>
          Settings
        </button>
      </header>
      {!gm.provider ? (
        <p class="muted small">
          {gm.builtIn === undefined ? 'Checking for built-in Claude…' : 'Add an OpenRouter or Anthropic API key in '}
          {gm.builtIn !== undefined && (
            <button class="linkish" onClick={onSettings}>
              Operator settings
            </button>
          )}
          {gm.builtIn !== undefined && ' to hear the Operator.'}
        </p>
      ) : (
        <>
          <ol ref={list}>
            {gm.entries.map((e) => (
              <li key={e.id} class={`gm-${e.kind}`}>
                {e.kind === 'question' ? <b>You: {e.text}</b> : e.text || (e.streaming ? 'Thinking…' : '')}
              </li>
            ))}
            {!gm.entries.length && <li class="muted small">The Operator speaks when it's your move.</li>}
          </ol>
          <form
            class="ask"
            onSubmit={(ev) => {
              ev.preventDefault();
              gm.ask(q);
              setQ('');
            }}
          >
            <input id="gm-ask" aria-label="Ask the Operator" placeholder="Ask the Operator a rules question…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <button disabled={gm.busy || !q.trim()}>Ask</button>
          </form>
        </>
      )}
    </section>
  );
}

/** Provider choice + key fields, shared by the settings sheet and the new-game screen. */
export function ProviderFields(props: {
  settings: GmSettings;
  setSettings: (s: GmSettings) => void;
  builtIn: boolean | undefined;
  keys: { anthropic: string; openrouter: string };
  onKey: (p: 'anthropic' | 'openrouter', k: string) => void;
}) {
  const { settings, setSettings, builtIn } = props;
  const [models, setModels] = useState<string[]>(OPENROUTER_FALLBACK_MODELS);
  const choices: ProviderId[] = builtIn ? ['claude-ai', 'openrouter', 'anthropic'] : ['openrouter', 'anthropic'];
  const effective = settings.provider === 'auto' || !choices.includes(settings.provider) ? choices[0] : settings.provider;
  useEffect(() => {
    if (effective === 'openrouter') void openRouterModels().then(setModels);
  }, [effective]);
  return (
    <>
      <label for="gm-provider">
        Who answers
        <select id="gm-provider" value={effective} onChange={(e) => setSettings({ ...settings, provider: (e.target as HTMLSelectElement).value as ProviderId })}>
          {choices.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      {effective === 'claude-ai' && (
        <p class="small muted">Uses your own Claude plan. The first narration asks you to allow it.</p>
      )}
      {effective === 'openrouter' && (
        <>
          <label for="gm-or-key">
            OpenRouter API key <span class="muted small">(stored only in this browser)</span>
            <input id="gm-or-key" type="password" autocomplete="off" placeholder="sk-or-…" value={props.keys.openrouter} onInput={(e) => props.onKey('openrouter', (e.target as HTMLInputElement).value.trim())} />
          </label>
          <label for="gm-or-model">
            Model
            <select id="gm-or-model" value={settings.orModel} onChange={(e) => setSettings({ ...settings, orModel: (e.target as HTMLSelectElement).value })}>
              {[...new Set([settings.orModel, ...models])].map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === OPENROUTER_DEFAULT_MODEL ? ' (fast, cheapest — default)' : ''}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {effective === 'anthropic' && (
        <>
          <label for="gm-an-key">
            Anthropic API key <span class="muted small">(stored only in this browser)</span>
            <input id="gm-an-key" type="password" autocomplete="off" placeholder="sk-ant-…" value={props.keys.anthropic} onInput={(e) => props.onKey('anthropic', (e.target as HTMLInputElement).value.trim())} />
          </label>
          <label for="gm-an-model">
            Model
            <select id="gm-an-model" value={settings.model} onChange={(e) => setSettings({ ...settings, model: (e.target as HTMLSelectElement).value as GmModel })}>
              {GM_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </>
  );
}

export function GmSettingsSheet(props: { gm: Gm; settings: GmSettings; setSettings: (s: GmSettings) => void; close: () => void }) {
  const { gm, settings, setSettings } = props;
  const [keys, setKeys] = useState(gm.keys);
  const save = () => {
    gm.setKey('openrouter', keys.openrouter);
    gm.setKey('anthropic', keys.anthropic);
    props.close();
  };
  return (
    <div class="overlay" onClick={props.close}>
      <div class="sheet" role="dialog" aria-label="Operator settings" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>🎧 Operator settings</b>
          <button class="ghost" onClick={props.close} aria-label="Close">
            ✕
          </button>
        </header>
        <p class="small muted">
          The Operator narrates, rules on moves and teaches. It never changes the game, and it only sees your side's view: the other hand and facedown cards stay
          hidden. Keys stay in this browser and go only to the service you pick.
        </p>
        <label class="chip">
          <input type="checkbox" checked={settings.enabled} onChange={() => setSettings({ ...settings, enabled: !settings.enabled })} /> Operator mode on
        </label>
        <ProviderFields settings={settings} setSettings={setSettings} builtIn={gm.builtIn} keys={keys} onKey={(p, k) => setKeys((x) => ({ ...x, [p]: k }))} />
        <label class="chip">
          <input type="checkbox" checked={settings.onlyMyTurns} onChange={() => setSettings({ ...settings, onlyMyTurns: !settings.onlyMyTurns })} /> Narrate
          only my turns (cheaper)
        </label>
        <div class="buttons">
          <button class="primary" onClick={save}>
            Save
          </button>
          <button
            onClick={() => {
              setKeys({ anthropic: '', openrouter: '' });
              gm.setKey('openrouter', '');
              gm.setKey('anthropic', '');
            }}
          >
            Forget keys
          </button>
          <button class="ghost" onClick={gm.clear}>
            Clear Operator log
          </button>
        </div>
      </div>
    </div>
  );
}
