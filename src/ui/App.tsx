import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import rulesRaw from '../../reference/RULES.md?raw';
import { apply } from '../engine/actions';
import { cardOf, defaultSetup, deckList, fullText, identitiesFor, isHidden, poolOf, subText } from '../engine/cards';
import { builtInPack, deckPool, deckProblems, exportPack, parsePack } from '../engine/pack';
import { legalActions } from '../engine/legal';
import { actor, breakerStrength, currentIce, findInstalled, iceStrength, link, maxHand, newGame, nodeName, points, ramLimit, ramUsed } from '../engine/state';
import { eventText, viewFor } from '../engine/view';
import { CYCLES, POINTS_TO_WIN, type Action, type CardDef, type CardId, type GameSetup, type GameState, type Installed, type NodeState, type Side } from '../engine/types';
import { botStep } from '../bots/driver';
import { describeAction, icon, stats, typeLabel } from './describe';
import { SPEED_MS, type Settings, loadGame, loadPackSetup, loadSettings, saveGame, savePackSetup, saveSettings } from './storage';
import { type GmSettings, GmPanel, GmSettingsSheet, ProviderFields, loadGmSettings, loadKey, saveGmSettings, saveKey, useBuiltIn, useGm } from './operator';
import { recap } from './recap';
import { play, soundFor } from './sound';

const sideName = (side: Side) => (side === 'corp' ? 'Corp' : 'Ghost');

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export function App() {
  const [state, setState] = useState<GameState | null>(() => loadGame());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [screen, setScreen] = useState<'new' | 'game'>(() => (loadGame() ? 'game' : 'new'));
  const [gmSettings, setGmSettings] = useState<GmSettings>(() => loadGmSettings());

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveGmSettings(gmSettings), [gmSettings]);
  useEffect(() => saveGame(state), [state]);

  if (screen === 'new' || !state)
    return (
      <NewGame
        settings={settings}
        setSettings={setSettings}
        canContinue={!!state && state.phase !== 'gameOver'}
        onContinue={() => setScreen('game')}
        gmSettings={gmSettings}
        setGmSettings={setGmSettings}
        onStart={(s) => {
          setState(s);
          setScreen('game');
        }}
      />
    );
  return <Game state={state} setState={setState} settings={settings} setSettings={setSettings} gmSettings={gmSettings} setGmSettings={setGmSettings} onNew={() => setScreen('new')} />;
}

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------

function NewGame(props: { settings: Settings; setSettings: (s: Settings) => void; canContinue: boolean; onContinue: () => void; onStart: (s: GameState) => void; gmSettings: GmSettings; setGmSettings: (s: GmSettings) => void }) {
  const [side, setSide] = useState<Side>('ghost');
  const [help, setHelp] = useState(false);
  const gm = props.gmSettings.enabled;
  const builtIn = useBuiltIn();
  const [keys, setKeys] = useState({ anthropic: loadKey('anthropic'), openrouter: loadKey('openrouter') });
  const [pack, setPack] = useState<GameSetup | null>(() => loadPackSetup());
  const [packSheet, setPackSheet] = useState(false);
  const [deckSheet, setDeckSheet] = useState(false);
  const setup = pack ?? defaultSetup();
  const [myId, setMyId] = useState('');
  const [botId, setBotId] = useState('random');
  const foeSide: Side = side === 'corp' ? 'ghost' : 'corp';
  const mine = identitiesFor(setup, side);
  const theirs = identitiesFor(setup, foeSide);
  const choosePack = (p: GameSetup | null) => {
    setPack(p);
    savePackSetup(p);
  };
  const start = () => {
    if (gm) {
      saveKey('openrouter', keys.openrouter);
      saveKey('anthropic', keys.anthropic);
    }
    const myPick = mine.find((d) => d.id === myId)?.id ?? setup.identities[side];
    const botPick = botId === 'random' ? theirs[Math.floor(Math.random() * theirs.length)]?.id : botId;
    const identities = { [side]: myPick, [foeSide]: botPick ?? setup.identities[foeSide] } as Record<Side, string>;
    props.onStart(newGame({ seed: `${Date.now()}-${Math.random()}`, human: side, setup: pack ?? undefined, identities }));
  };
  return (
    <main class="newgame">
      <h1>
        <span class="glitch">BREACHLINE</span>
      </h1>
      <p class="muted">A cyber-heist card game for one. Break in as the Ghost, or lock it down as the Corp. First to {POINTS_TO_WIN} project points wins.</p>
      {props.canContinue && (
        <button class="primary wide" onClick={props.onContinue}>
          ▶️ Continue saved game
        </button>
      )}
      <section class="panel form">
        <fieldset>
          <legend>Your side</legend>
          <div class="sidepick">
            <button class={`side ghost-side ${side === 'ghost' ? 'on' : ''}`} onClick={() => setSide('ghost')} aria-pressed={side === 'ghost'}>
              <b>🕶️ The Ghost</b>
              <span class="small">4 cycles a turn. Build a rig of breaker programs, run the Corp's nodes and steal its projects. Recommended first.</span>
            </button>
            <button class={`side corp-side ${side === 'corp' ? 'on' : ''}`} onClick={() => setSide('corp')} aria-pressed={side === 'corp'}>
              <b>🏙️ The Corp</b>
              <span class="small">3 cycles a turn. Hide projects behind ICE, develop and score them, and punish a Ghost who runs hot.</span>
            </button>
          </div>
        </fieldset>
        <label class="chip">
          <input type="checkbox" checked={gm} onChange={() => props.setGmSettings({ ...props.gmSettings, enabled: !gm })} /> 🎧 Operator: AI voice in your ear{' '}
          <span class="muted small">(optional)</span>
        </label>
        {gm && <ProviderFields settings={props.gmSettings} setSettings={props.setGmSettings} builtIn={builtIn} keys={keys} onKey={(p, k) => setKeys((x) => ({ ...x, [p]: k }))} />}
        <label class="field">
          <span>🪪 Your identity</span>
          <select value={mine.some((d) => d.id === myId) ? myId : setup.identities[side]} onChange={(e) => setMyId((e.target as HTMLSelectElement).value)}>
            {mine.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}: {d.text.replace(/^Identity\.\s*/, '')}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>🤖 Bot's identity</span>
          <select value={theirs.some((d) => d.id === botId) ? botId : 'random'} onChange={(e) => setBotId((e.target as HTMLSelectElement).value)}>
            <option value="random">Random</option>
            {theirs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}: {d.text.replace(/^Identity\.\s*/, '')}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>🤖 Bot difficulty</span>
          <select value={props.settings.level} onChange={(e) => props.setSettings({ ...props.settings, level: (e.target as HTMLSelectElement).value as Settings['level'] })}>
            <option value="easy">Easy: careless, takes big risks, never punishes heat</option>
            <option value="normal">Normal: plays carefully, with some lazy turns</option>
            <option value="hard">Hard: the full bot</option>
          </select>
        </label>
        <div class="row packrow">
          <span>
            🃏 Cards: <b>{pack?.packName ?? 'Breachline core set'}</b>{' '}
            <span class="muted small">
              ({deckList('corp', pack ?? defaultSetup()).length} Corp, {deckList('ghost', pack ?? defaultSetup()).length} Ghost)
            </span>
          </span>
          <span class="row">
            <button class="small" onClick={() => setDeckSheet(true)}>
              Edit decks
            </button>
            <button class="small" onClick={() => setPackSheet(true)}>
              Change
            </button>
          </span>
        </div>
        <button class="primary wide" onClick={start}>
          ⚡ Start a new game
        </button>
        <button class="wide" onClick={() => setHelp(true)}>
          📖 Rules and cards
        </button>
      </section>
      {help && <HelpSheet setup={pack ?? defaultSetup()} close={() => setHelp(false)} />}
      {packSheet && <PackSheet current={pack} choose={choosePack} close={() => setPackSheet(false)} />}
      {deckSheet && <DeckSheet setup={setup} save={choosePack} close={() => setDeckSheet(false)} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

type Sheet = { kind: 'card'; card: CardId } | { kind: 'help' } | { kind: 'operator' } | { kind: 'pile'; title: string; cards: CardId[] } | null;

function Game(props: {
  state: GameState;
  setState: (s: GameState) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  gmSettings: GmSettings;
  setGmSettings: (s: GmSettings) => void;
  onNew: () => void;
}) {
  const { state, setState, settings } = props;
  const me = state.human;
  const foe: Side = me === 'corp' ? 'ghost' : 'corp';
  // everything drawn comes from the human's view, so hidden cards never reach the page
  const v = useMemo(() => viewFor(state, me), [state]);
  const who = actor(state);
  const myMove = who === me;
  const legal = useMemo(() => (myMove ? legalActions(state) : []), [state]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [notice, setNotice] = useState('');
  const gm = useGm(state, props.gmSettings);

  // the bot plays the other side, one step at a time
  useEffect(() => {
    if (!who || myMove) return;
    const t = setTimeout(() => {
      const r = botStep(state, (side) => side !== me, settings.level);
      if (r) setState(r.state);
    }, SPEED_MS[settings.speed]);
    return () => clearTimeout(t);
  }, [state, settings.speed]);

  // sound for whatever just happened
  const lastSeq = useRef(state.seq);
  useEffect(() => {
    if (settings.sound) play(soundFor(state.events.filter((e) => e.seq > lastSeq.current)));
    lastSeq.current = state.seq;
  }, [state.seq]);

  const act = (a: Action) => {
    const r = apply(state, a);
    setSheet(null);
    if (!r.ok) {
      setNotice(r.error);
      gm.reportRejected(`${describeAction(state, a)} — engine says: ${r.error}`);
      return;
    }
    setNotice('');
    gm.notifyAction();
    setState(r.state);
  };

  const about = (card: CardId) => legal.filter((a) => ('card' in a && a.card === card) || ('target' in a && a.target === card));
  const hot = (card: CardId) => about(card).length > 0;
  const open = (card: CardId) => setSheet({ kind: 'card', card });
  const barActions = legal.filter((a) => !['install', 'play', 'discard', 'scrap'].includes(a.type));

  return (
    <div class={`app me-${me}`}>
      <div class="topbar">
        <b class="glitch">BREACHLINE</b>
        <span class="muted small">Turn {Math.max(1, v.turnNumber)}</span>
        <span class="spacer" />
        <select aria-label="Bot speed" value={settings.speed} onChange={(e) => props.setSettings({ ...settings, speed: (e.target as HTMLSelectElement).value as Settings['speed'] })}>
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
          <option value="instant">Instant</option>
        </select>
        <button class="ghost" aria-label="Sound" onClick={() => props.setSettings({ ...settings, sound: !settings.sound })}>
          {settings.sound ? '🔊' : '🔇'}
        </button>
        <button class="ghost" aria-label="Operator settings" onClick={() => setSheet({ kind: 'operator' })}>
          🎧
        </button>
        <button class="ghost" aria-label="Rules and cards" onClick={() => setSheet({ kind: 'help' })}>
          📖
        </button>
        <button class="ghost" onClick={props.onNew}>
          New
        </button>
      </div>

      <Scoreboard v={v} me={me} who={who} open={open} />

      <div class="layout">
        <div class="col main">
          <Prompt v={v} me={me} myMove={myMove} who={who} />
          {notice && <p class="notice">⚠️ {notice}</p>}
          {state.phase === 'gameOver' && <GameOver s={state} onNew={props.onNew} />}

          <section class="panel">
            <header class="row">
              <b>🏙️ Corp nodes</b>
              <span class="muted small">ICE is listed outermost first</span>
            </header>
            <div class="nodes">
              {v.corp.nodes.map((n) => (
                <NodeCol key={n.id} v={v} node={n} open={open} hot={hot} onPile={(title, cards) => setSheet({ kind: 'pile', title, cards })} />
              ))}
            </div>
          </section>

          {v.run && <RunPanel v={v} open={open} />}

          <section class="panel">
            <header class="row">
              <b>🕶️ Ghost rig</b>
              <span class="muted small">
                RAM {ramUsed(v)}/{ramLimit(v)} · link {link(v)} · heat {v.ghost.heat}
              </span>
            </header>
            <Rig v={v} open={open} hot={hot} onPile={(title, cards) => setSheet({ kind: 'pile', title, cards })} />
          </section>

          <section class="panel">
            <header class="row">
              <b>
                ✋ Your hand [{v[me].hand.length}/{maxHand(v, me)}]
              </b>
              <span class="muted small">Tap a card to read it and play it</span>
            </header>
            <div class="tiles">
              {v[me].hand.map((c) => (
                <Tile key={c} card={c} hot={hot(c)} onClick={() => open(c)} />
              ))}
              {!v[me].hand.length && <span class="muted">No cards in hand.</span>}
            </div>
          </section>

          {myMove && (
            <div class="actionbar" role="group" aria-label="Your moves">
              {barActions.map((a, i) => (
                <button key={i} class={primary(a) ? 'primary' : ''} onClick={() => act(a)}>
                  {describeAction(v, a)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div class="col side">
          <GmPanel gm={gm} settings={props.gmSettings} onSettings={() => setSheet({ kind: 'operator' })} />
          <Log v={v} me={me} foe={foe} />
        </div>
      </div>

      {sheet?.kind === 'card' && <CardSheet v={v} card={sheet.card} actions={about(sheet.card)} act={act} close={() => setSheet(null)} />}
      {sheet?.kind === 'pile' && <PileSheet title={sheet.title} cards={sheet.cards} close={() => setSheet(null)} />}
      {sheet?.kind === 'help' && <HelpSheet setup={state.setup} close={() => setSheet(null)} />}
      {sheet?.kind === 'operator' && <GmSettingsSheet gm={gm} settings={props.gmSettings} setSettings={props.setGmSettings} close={() => setSheet(null)} />}
    </div>
  );
}

function primary(a: Action): boolean {
  return ['endTurn', 'steal', 'score', 'keep', 'continue'].includes(a.type);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Pips({ n, of }: { n: number; of: number }) {
  return (
    <span class="pips" aria-label={`${n} of ${of} cycles left`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} class={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

function Scoreboard({ v, me, who, open }: { v: GameState; me: Side; who: Side | null; open?: (c: CardId) => void }) {
  const box = (side: Side) => {
    const p = v[side];
    return (
      <div class={`score ${side} ${who === side ? 'active' : ''}`}>
        <div class="row">
          <b>
            {side === 'corp' ? '🏙️ Corp' : '🕶️ Ghost'} {side === me && <span class="you">you</span>}
          </b>
          <span class="big">
            {points(v, side)}
            <span class="of">/{POINTS_TO_WIN}</span>
          </span>
        </div>
        <button class="linkish small ident" onClick={() => open?.(p.identity)} title="identity">
          🪪 {cardOf(p.identity).name}
        </button>
        <div class="stats">
          <span title="credits">💰 {p.credits}</span>
          <span title="cards in hand">✋ {p.hand.length}</span>
          <span title="deck">📚 {p.deck.length}</span>
          {side === 'ghost' && <span class={v.ghost.heat ? 'heat' : ''}>🔥 {v.ghost.heat}</span>}
          {side === 'ghost' && <span title="link (against traces)">📶 {link(v)}</span>}
          {side === 'corp' && v.corp.badPublicity > 0 && <span title="bad publicity: the Ghost gets this many extra credits on every run">📰 {v.corp.badPublicity}</span>}
          {side === 'ghost' && v.ghost.core > 0 && <span title="core damage: maximum hand size is lowered by this much">🧠 −{v.ghost.core}</span>}
          {v.turn === side && v.phase !== 'gameOver' && v.phase !== 'mulligan' && <Pips n={p.cycles} of={CYCLES[side]} />}
        </div>
      </div>
    );
  };
  return (
    <div class="scores">
      {box('corp')}
      {box('ghost')}
    </div>
  );
}

function Prompt({ v, me, myMove, who }: { v: GameState; me: Side; myMove: boolean; who: Side | null }) {
  if (v.phase === 'gameOver') return null;
  let text = '';
  if (!myMove) text = `The ${sideName(who!)} is thinking…`;
  else if (v.trace) {
    const t = v.trace;
    text =
      t.corpBoost === null
        ? `${t.source}: trace ${t.base} against the Ghost's link ${link(v)}. Pay to raise the trace; the Ghost answers after you.`
        : `${t.source}: the trace is ${t.base + t.corpBoost} against your link ${link(v)}. Pay to raise your link to match it, or let it land.`;
  } else if (v.phase === 'mulligan') text = 'Opening hand: keep it, or shuffle it back for 5 new cards (once).';
  else if (v.phase === 'discard') text = `Discard down to ${maxHand(v, me)} cards: tap a card in your hand.`;
  else if (v.phase === 'run' && v.run) {
    const ice = currentIce(v);
    const name = ice ? (isHidden(ice.card) ? 'facedown ICE' : cardOf(ice.card).name) : '';
    if (v.run.step === 'approach') text = `The Ghost is running on ${nodeName(v.run.node)} and approaches your ${name}. Activate it (or an asset or upgrade)?`;
    else if (v.run.step === 'corpTrash') text = `${name} fires: choose a Ghost program to trash.`;
    else if (v.run.step === 'encounter') text = `You encounter ${name}. Boost and break with a matching breaker, or let the subroutines fire.`;
    else if (v.run.step === 'passed') text = `You are past ${name}. Continue inward, or jack out?`;
    else if (v.run.step === 'approachNode')
      text = me === 'corp' ? `The Ghost has reached ${nodeName(v.run.node)}. Last chance to activate assets or upgrades.` : `You reach ${nodeName(v.run.node)}. The Corp may activate cards.`;
    else if (v.run.step === 'access') text = `You access ${v.run.accessing ? cardOf(v.run.accessing).name : 'a card'}.`;
  } else {
    const n = v[me].cycles;
    text = n > 0 ? `Your turn: ${n} cycle${n === 1 ? '' : 's'} left. Tap a card, or pick a move below.` : 'No cycles left. End your turn.';
  }
  return (
    <section class={`panel prompt ${myMove ? 'mine' : ''}`} aria-live="polite">
      {text}
    </section>
  );
}

function Chip({ inst, v, open, hot, current }: { inst: Installed; v: GameState; open: (c: CardId) => void; hot?: boolean; current?: boolean }) {
  const hidden = isHidden(inst.card);
  const d = cardOf(inst.card);
  const known = !hidden && !inst.active;
  return (
    <button class={`chipcard ${d.type} ${inst.active ? 'active' : 'facedown'} ${hot ? 'hot' : ''} ${current ? 'current' : ''}`} onClick={() => open(inst.card)}>
      <span>
        {hidden ? '▒ facedown' : `${icon(d)} ${d.name}`}
        {known && <span class="muted small"> {v.human === 'corp' ? '(inactive)' : '(seen)'}</span>}
      </span>
      <span class="small muted">
        {!hidden && d.type === 'ice' && `${d.subtype} · str ${iceStrength(v, inst.card)} · ${d.cost}¢`}
        {inst.dev > 0 && <b class="dev"> ●{inst.dev}</b>}
        {v.corp.recurring[inst.card] !== undefined && ` 💳 ${v.corp.recurring[inst.card]}`}
      </span>
    </button>
  );
}

function NodeCol(props: { v: GameState; node: NodeState; open: (c: CardId) => void; hot: (c: CardId) => boolean; onPile: (title: string, cards: CardId[]) => void }) {
  const { v, node } = props;
  const c = v.corp;
  const running = v.run?.node === node.id;
  const central = !node.id.startsWith('site');
  const info =
    node.id === 'command' ? `${c.hand.length} cards in hand` : node.id === 'mainframe' ? `${c.deck.length} cards in deck` : node.id === 'dump' ? `${c.discard.length} discarded` : '';
  const title = nodeName(node.id).replace(/^the /, '');
  return (
    <div class={`node ${running ? 'running' : ''}`}>
      <div class="node-head">
        <b>
          {node.id === 'command' ? '🎛️' : node.id === 'mainframe' ? '🗄️' : node.id === 'dump' ? '🗑️' : '🏗️'} {title}
        </b>
        {node.id === 'dump' ? (
          <button class="linkish small" onClick={() => props.onPile('The Dump', c.discard)}>
            {info}
          </button>
        ) : (
          central && <span class="muted small">{info}</span>
        )}
      </div>
      <div class="ice">
        {[...node.ice].reverse().map((i, k) => (
          <Chip key={i.card} inst={i} v={v} open={props.open} hot={props.hot(i.card)} current={running && v.run!.pos === node.ice.length - 1 - k && v.run!.step !== 'access'} />
        ))}
        {!node.ice.length && <span class="muted small noice">no ICE</span>}
      </div>
      {!central && <div class="root">{node.root ? <Chip inst={node.root} v={v} open={props.open} hot={props.hot(node.root.card)} current={running && v.run!.step === 'access'} /> : <span class="muted small">empty</span>}</div>}
      {node.upgrades.length > 0 && (
        <div class="upgrades">
          <span class="muted small">upgrades</span>
          {node.upgrades.map((u) => (
            <Chip key={u.card} inst={u} v={v} open={props.open} hot={props.hot(u.card)} current={running && v.run!.accessing === u.card} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunPanel({ v, open }: { v: GameState; open: (c: CardId) => void }) {
  const run = v.run!;
  const ice = currentIce(v);
  const showIce = ice && !isHidden(ice.card) && ice.active && run.step !== 'access';
  const d = showIce ? cardOf(ice.card) : null;
  const breakers = v.ghost.programs.filter((p) => cardOf(p).breaker);
  return (
    <section class="panel runpanel" aria-label="Run in progress">
      <header class="row">
        <b>🏃 Run on {nodeName(run.node)}</b>
        <span class="muted small">{run.noActivate ? 'Blackout: ICE cannot be activated' : run.instead ? (run.source ?? 'special run') : run.step}</span>
      </header>
      {d && (
        <div class="encounter">
          <button class="linkish" onClick={() => open(ice!.card)}>
            {icon(d)} <b>{d.name}</b>
          </button>{' '}
          <span class="muted">
            {d.subtype} · strength {iceStrength(v, ice!.card)}
            {iceStrength(v, ice!.card) !== d.strength && ` (printed ${d.strength})`}
          </span>
          <ol class="subs">
            {d.subs!.map((s, i) => (
              <li key={i} class={run.broken.includes(i) ? 'broken' : ''}>
                ↳ {subText(s)} {run.broken.includes(i) && <span class="small">(broken)</span>}
              </li>
            ))}
          </ol>
          {run.step === 'encounter' && (
            <div class="small muted">
              Breakers:{' '}
              {breakers.length
                ? breakers.map((p) => `${cardOf(p).name} (${cardOf(p).breaker!.breaks}, str ${breakerStrength(v, p)})`).join(' · ')
                : 'none installed'}
            </div>
          )}
        </div>
      )}
      {run.step === 'access' && run.accessing && (
        <div class="encounter">
          Accessing: <Tile card={run.accessing} onClick={() => open(run.accessing!)} />
        </div>
      )}
    </section>
  );
}

function Rig(props: { v: GameState; open: (c: CardId) => void; hot: (c: CardId) => boolean; onPile: (title: string, cards: CardId[]) => void }) {
  const g = props.v.ghost;
  const group = (title: string, cards: CardId[]) => (
    <div class="rig-group">
      <span class="muted small">{title}</span>
      {cards.map((c) => (
        <button key={c} class={`chipcard active ${props.hot(c) ? 'hot' : ''}`} onClick={() => props.open(c)}>
          <span>
            {icon(cardOf(c))} {cardOf(c).name}
          </span>
          {cardOf(c).breaker && (
            <span class="small muted">
              {cardOf(c).breaker!.breaks} · str {breakerStrength(props.v, c)}
            </span>
          )}
          {(g.hosted[c] || g.virus[c] || g.recurring[c] !== undefined) && (
            <span class="small muted">
              {g.hosted[c] && `on ${cardOf(g.hosted[c]).name}`} {g.virus[c] ? `🦠 ${g.virus[c]}` : ''} {g.recurring[c] !== undefined ? `💳 ${g.recurring[c]} recurring` : ''}
            </span>
          )}
        </button>
      ))}
      {!cards.length && <span class="muted small">—</span>}
    </div>
  );
  return (
    <div class="rig">
      {group('Programs', g.programs)}
      {group('Gear', g.gear)}
      {group('Contacts', g.contacts)}
      <div class="rig-group">
        <span class="muted small">Piles</span>
        <button class="linkish small" onClick={() => props.onPile('The Scrapheap', g.discard)}>
          Scrapheap ({g.discard.length})
        </button>
        <button class="linkish small" onClick={() => props.onPile('Stolen and scored projects', [...g.scored, ...props.v.corp.scored])}>
          Projects ({g.scored.length} stolen, {props.v.corp.scored.length} scored)
        </button>
      </div>
    </div>
  );
}

function Tile({ card, hot, onClick }: { card: CardId; hot?: boolean; onClick?: () => void }) {
  const d = cardOf(card);
  return (
    <button class={`tile ${d.side} ${d.type} ${hot ? 'hot' : ''}`} onClick={onClick}>
      <span class="tile-top">
        <span class="tile-name">
          {icon(d)} {d.name}
        </span>
      </span>
      <span class="tile-kind">
        {typeLabel(d)} · {stats(d).join(' · ')}
      </span>
      <span class="tile-text">{fullText(d)}</span>
    </button>
  );
}

function CardBody({ d }: { d: CardDef }) {
  return (
    <>
      <p class="muted">
        {typeLabel(d)}
        {stats(d).length ? ` · ${stats(d).join(' · ')}` : ''}
      </p>
      {d.subs && (
        <ol class="subs">
          {d.subs.map((s, i) => (
            <li key={i}>↳ {subText(s)}</li>
          ))}
        </ol>
      )}
      {d.breaker && (
        <p class="fulltext">
          Breaks {d.breaker.breaks === 'any' ? 'any ICE' : `${d.breaker.breaks} ICE`}. {d.breaker.breakCost}¢: break 1 subroutine. {d.breaker.boostCost}¢: +{d.breaker.boostBy} strength for this
          encounter.
        </p>
      )}
      {d.text && <p class="fulltext">{d.text}</p>}
    </>
  );
}

function CardSheet(props: { v: GameState; card: CardId; actions: Action[]; act: (a: Action) => void; close: () => void }) {
  const d = cardOf(props.card);
  const inst = findInstalled(props.v, props.card);
  return (
    <div class="overlay" onClick={props.close}>
      <div class="sheet" role="dialog" aria-label={d.name} onClick={(e) => e.stopPropagation()}>
        <header>
          <b class="sheet-title">
            {icon(d)} {d.name}
          </b>
          <button class="ghost" onClick={props.close} aria-label="Close">
            ✕
          </button>
        </header>
        {d.type === 'hidden' ? <p class="muted">A facedown Corp card. Run it, or scan it with Recon Sweep, to find out what it is.</p> : <CardBody d={d} />}
        {inst && (
          <p class="small muted">
            {inst.isIce ? 'Protecting' : 'Installed in'} {nodeName(inst.node.id)} · {inst.inst.active ? 'active' : 'facedown, inactive'}
            {inst.inst.dev ? ` · ${inst.inst.dev} development counter${inst.inst.dev === 1 ? '' : 's'}` : ''}
          </p>
        )}
        <div class="buttons column">
          {props.actions.map((a, i) => (
            <button key={i} class="primary" onClick={() => props.act(a)}>
              {describeAction(props.v, a)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PileSheet(props: { title: string; cards: CardId[]; close: () => void }) {
  const [pick, setPick] = useState<CardId | null>(null);
  const hidden = props.cards.filter(isHidden).length;
  return (
    <div class="overlay" onClick={props.close}>
      <div class="sheet" role="dialog" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <header>
          <b class="sheet-title">{props.title}</b>
          <button class="ghost" onClick={props.close} aria-label="Close">
            ✕
          </button>
        </header>
        {!props.cards.length && <p class="muted">Empty.</p>}
        {hidden > 0 && (
          <p class="muted">
            {hidden} facedown card{hidden === 1 ? '' : 's'} you have not seen.
          </p>
        )}
        <div class="tiles">
          {props.cards
            .filter((c) => !isHidden(c))
            .map((c) => (
              <Tile key={c} card={c} onClick={() => setPick(c)} />
            ))}
        </div>
        {pick && (
          <div class="picked">
            <b>{cardOf(pick).name}</b>
            <CardBody d={cardOf(pick)} />
          </div>
        )}
      </div>
    </div>
  );
}

function Log({ v, me, foe }: { v: GameState; me: Side; foe: Side }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [v.seq]);
  return (
    <section class="panel log" aria-label="Game log">
      <header>
        <b>📟 Log</b>
      </header>
      <ol ref={list}>
        {v.events.slice(-200).map((e) => (
          <li key={e.seq} class={`ev ev-${e.type} ${e.side === me ? 'mine' : e.side === foe ? 'theirs' : ''}`}>
            {eventText(e, me)}
          </li>
        ))}
      </ol>
    </section>
  );
}

function GameOver({ s, onNew }: { s: GameState; onNew: () => void }) {
  const won = s.winner === s.human;
  return (
    <section class={`panel prompt gameover ${won ? 'won' : 'lost'}`}>
      <h2>{won ? '🏆 You win' : '💀 You lose'}</h2>
      <p>
        The {sideName(s.winner!)} wins: {s.winReason}
      </p>
      <ol class="recap">
        {recap(s).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ol>
      <button class="primary" onClick={onNew}>
        ⚡ New game
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Help: rules and the card list
// ---------------------------------------------------------------------------

/** Just enough markdown for RULES.md: headings, lists and paragraphs with **bold**. */
function Markdown({ text }: { text: string }) {
  const bold = (line: string) => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part.replace(/`/g, '')));
  const out: preact.JSX.Element[] = [];
  let list: preact.JSX.Element[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`l${out.length}`}>{list}</ul>);
    list = [];
  };
  text.split('\n').forEach((line, i) => {
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)/.exec(line);
    if (item) return void list.push(<li key={i}>{bold(item[1])}</li>);
    flush();
    if (line.startsWith('# ')) out.push(<h2 key={i}>{line.slice(2)}</h2>);
    else if (line.startsWith('## ')) out.push(<h3 key={i}>{line.slice(3)}</h3>);
    else if (line.trim()) out.push(<p key={i}>{bold(line)}</p>);
  });
  flush();
  return <div class="md">{out}</div>;
}

function HelpSheet({ close, setup }: { close: () => void; setup: GameSetup }) {
  const [tab, setTab] = useState<'rules' | 'corp' | 'ghost'>('rules');
  const pool = poolOf({ setup });
  return (
    <div class="overlay" onClick={close}>
      <div class="sheet tall" role="dialog" aria-label="Rules and cards" onClick={(e) => e.stopPropagation()}>
        <header>
          <div class="tabs" role="tablist">
            {(['rules', 'ghost', 'corp'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'rules' ? '📖 Rules' : t === 'ghost' ? '🕶️ Ghost cards' : '🏙️ Corp cards'}
              </button>
            ))}
          </div>
          <button class="ghost" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        {tab === 'rules' ? (
          <Markdown text={rulesRaw.split('## Card list')[0]} />
        ) : (
          <div class="gallery">
            {pool.filter((c) => c.side === tab).map((d) => (
              <div key={d.id} class={`entry ${d.side}`}>
                <b>
                  {icon(d)} {d.name} <span class="muted small">×{setup.decks[d.side][d.id]}</span>
                </b>
                <CardBody d={d} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card packs
// ---------------------------------------------------------------------------

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PackSheet({ current, choose, close }: { current: GameSetup | null; choose: (p: GameSetup | null) => void; close: () => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState('');
  const check = (json: string) => {
    const r = parsePack(json);
    if (!r.ok) {
      setErrors(r.errors);
      setWarnings([]);
      setLoaded('');
      return;
    }
    setErrors([]);
    setWarnings(r.warnings);
    setLoaded(`Loaded "${r.setup.packName}": ${r.setup.cards.length} custom cards. New games use it.`);
    choose(r.setup);
  };
  const onFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const t = await f.text();
    setText(t);
    check(t);
  };
  return (
    <div class="overlay" onClick={close}>
      <div class="sheet tall" role="dialog" aria-label="Card pack" onClick={(e) => e.stopPropagation()}>
        <header class="row">
          <b>🃏 Card pack</b>
          <button class="ghost" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        <p class="small">
          Now using: <b>{current?.packName ?? 'Breachline core set (built in)'}</b>. A pack is a JSON file of your own cards, written with the same effects the
          built-in cards use. The engine checks every card before it can be played, and a saved game keeps the cards it started with.
        </p>
        <p class="small muted">
          The easiest start: download the built-in set as a pack, change or add cards, and load it back. A card with the same id as a built-in card replaces it.
          The format is in <code>reference/CARD_PACKS.md</code>.
        </p>
        <div class="row wrap">
          <label class="button">
            📂 Load a pack file
            <input type="file" accept=".json,application/json" onChange={onFile} hidden />
          </label>
          <button onClick={() => download('breachline-core-set.json', JSON.stringify(builtInPack(), null, 2))}>⬇️ Download built-in set as a pack</button>
          {current && (
            <button
              onClick={() => {
                choose(null);
                setLoaded('Back to the built-in cards.');
                setErrors([]);
                setWarnings([]);
              }}
            >
              ↩️ Use built-in cards
            </button>
          )}
        </div>
        <label class="small">
          Or paste pack JSON:
          <textarea rows={8} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} spellcheck={false} />
        </label>
        <button class="primary" disabled={!text.trim()} onClick={() => check(text)}>
          ✅ Check and use this pack
        </button>
        {loaded && <p class="ok">{loaded}</p>}
        {warnings.length > 0 && (
          <ul class="small warn">
            {warnings.map((w, i) => (
              <li key={i}>⚠️ {w}</li>
            ))}
          </ul>
        )}
        {errors.length > 0 && (
          <div class="errors">
            <b>The pack was not loaded:</b>
            <ul class="small">
              {errors.slice(0, 40).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            {errors.length > 40 && <p class="small">…and {errors.length - 40} more.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deck builder
// ---------------------------------------------------------------------------

function DeckSheet({ setup, save, close }: { setup: GameSetup; save: (p: GameSetup) => void; close: () => void }) {
  const [tab, setTab] = useState<Side>('ghost');
  const [decks, setDecks] = useState<Record<Side, Record<string, number>>>(() => structuredClone(setup.decks));
  const [name, setName] = useState(setup.packName ?? 'My decks');
  const [saved, setSaved] = useState('');
  const pool = deckPool(setup, tab);
  const { errors, warnings } = deckProblems(decks, setup.cards);
  const size = (side: Side) => Object.values(decks[side]).reduce((a, b) => a + b, 0);
  const pts = Object.entries(decks.corp).reduce((n, [id, k]) => n + (cardOf(`${id}#1`).points ?? 0) * k, 0);
  const set = (id: string, n: number) => {
    setSaved('');
    setDecks((d) => {
      const next = structuredClone(d);
      if (n <= 0) delete next[tab][id];
      else next[tab][id] = Math.min(n, 9);
      return next;
    });
  };
  const result = (): GameSetup => ({ ...setup, packName: name.trim() || 'My decks', decks });
  const types = [...new Set(pool.map((d) => d.type))];
  return (
    <div class="overlay" onClick={close}>
      <div class="sheet tall" role="dialog" aria-label="Deck builder" onClick={(e) => e.stopPropagation()}>
        <header>
          <div class="tabs" role="tablist">
            {(['ghost', 'corp'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'ghost' ? `🕶️ Ghost (${size('ghost')})` : `🏙️ Corp (${size('corp')})`}
              </button>
            ))}
          </div>
          <button class="ghost" onClick={close} aria-label="Close">
            ✕
          </button>
        </header>
        <p class="small muted">
          {tab === 'corp' ? `${pts} project points (7 to win). ` : ''}Decks need 15 to 120 cards; up to 9 copies of a card. Identities are picked when a game starts.
        </p>
        <div class="deckgrid">
          {types.map((type) => (
            <div key={type}>
              <h4 class="small muted">{type}</h4>
              {pool
                .filter((d) => d.type === type)
                .map((d) => {
                  const n = decks[tab][d.id] ?? 0;
                  return (
                    <div key={d.id} class={`deckrow ${n ? '' : 'off'}`}>
                      <span title={fullText(d)}>
                        {icon(d)} {d.name} <span class="muted small">{stats(d).join(' · ')}</span>
                      </span>
                      <span class="stepper">
                        <button aria-label={`fewer ${d.name}`} disabled={!n} onClick={() => set(d.id, n - 1)}>
                          −
                        </button>
                        <b>{n}</b>
                        <button aria-label={`more ${d.name}`} disabled={n >= 9} onClick={() => set(d.id, n + 1)}>
                          +
                        </button>
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
        {errors.length > 0 && (
          <ul class="small errors">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul class="small warn">
            {warnings.map((w, i) => (
              <li key={i}>⚠️ {w}</li>
            ))}
          </ul>
        )}
        <label class="field">
          <span>Name</span>
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row wrap">
          <button
            class="primary"
            disabled={errors.length > 0}
            onClick={() => {
              save(result());
              setSaved('Saved. New games use these decks.');
            }}
          >
            💾 Use these decks
          </button>
          <button onClick={() => setDecks(structuredClone(setup.decks))}>↩️ Undo changes</button>
          <button disabled={errors.length > 0} onClick={() => download(`${(name.trim() || 'my-decks').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, JSON.stringify(exportPack(result()), null, 2))}>
            ⬇️ Export as a pack file
          </button>
        </div>
        {saved && <p class="ok">{saved}</p>}
      </div>
    </div>
  );
}
