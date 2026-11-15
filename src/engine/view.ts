// What one side may know. Bots and the Operator only ever get a view, never the real state.
import { cloneState } from './state';
import type { CardId, GameState, Installed, Side } from './types';

/** The state as `side` sees it: the other side's hidden cards become "?…" placeholders. */
export function viewFor(state: GameState, side: Side): GameState {
  const v = cloneState(state);
  v.rngState = 0;
  // the other side's deck list is private; card definitions stay so revealed cards can be shown
  v.setup = { ...v.setup, decks: { ...v.setup.decks, [side === 'corp' ? 'ghost' : 'corp']: {} } };
  const hide = (list: CardId[], tag: string) => list.map((_, i) => `?${tag}${i}`);
  v.corp.deck = hide(v.corp.deck, 'deck');
  v.ghost.deck = hide(v.ghost.deck, 'gdeck');
  if (side === 'ghost') {
    v.corp.hand = hide(v.corp.hand, 'hand');
    v.corp.discard = v.corp.discard.map((c, i) => (v.corp.discardSeen.includes(c) ? c : `?dump${i}`));
    const mask = (inst: Installed, tag: string) => {
      if (!inst.active && !v.ghost.known.includes(inst.card)) inst.card = `?${tag}`;
    };
    for (const n of v.corp.nodes) {
      if (n.root) mask(n.root, `${n.id}root`);
      n.ice.forEach((i, k) => mask(i, `${n.id}ice${k}`));
      n.upgrades.forEach((i, k) => mask(i, `${n.id}up${k}`));
    }
    // facedown cards the Ghost may choose to access stay hidden until accessed
    if (v.run) {
      const run = v.run;
      run.candidates = run.candidates.map((c, i) => {
        const inst = state.corp.nodes.flatMap((n) => [...(n.root ? [n.root] : []), ...n.upgrades]).find((x) => x.card === c);
        return inst && !inst.active && !v.ghost.known.includes(c) ? `?cand${i}` : c;
      });
    }
  } else {
    v.ghost.hand = hide(v.ghost.hand, 'ghand');
    v.ghost.known = [];
    // the Corp does not see cards the Ghost accesses from the Mainframe (CR 7.1.2)
    if (v.run) {
      const deck = new Set(state.corp.deck);
      v.run.accessed = v.run.accessed.map((c, i) => (deck.has(c) ? `?acc${i}` : c));
      if (v.run.accessing && deck.has(v.run.accessing)) v.run.accessing = '?accessing';
    }
  }
  v.events = v.events.map((e) => (e.priv && e.priv.side !== side ? { seq: e.seq, type: e.type, text: e.text, ...(e.side ? { side: e.side } : {}) } : e));
  return v;
}

/** The text of an event as `side` reads it. */
export function eventText(e: { text: string; priv?: { side: Side; text: string } }, side: Side): string {
  return e.priv && e.priv.side === side ? e.priv.text : e.text;
}
