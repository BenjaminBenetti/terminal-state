// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane NET): the paper map overlay (ui/paperMap.ts). Pure parts — the
// paper layout, label placement (no overlaps), the key scope, arrow picking — and the overlay on a small Node DOM
// (helpers/paperMapDom.ts): only known stations / edges printed, the Reactor hidden until known, select-then-confirm, cancel,
// non-adjacent stations not selectable, the 1337 capture + reveal with the REAL player/input.ts and the REAL Lockbox controller on
// the same window (no digit leak; the Lockbox's own 1337 still works when the map is closed), keyboard navigation, view mode,
// pan / zoom / fit on any screen size, hit areas and the paper texture hook. Node only (no browser).

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {archetypeLabel, generateNetwork} from '../src/campaign/network';
import {arrive, destinations, enableCheat, neighbors, newCampaign, reactorKnown, revealAround} from '../src/campaign/discovery';
import type {CampaignState, StationId, SubwayNetwork} from '../src/campaign/types';
import {DEFAULT_PAPER_TEXTURE, PAPER, PaperMap, buildMapModel, paperLayout, paperMapKeyAction, pickByDirection, rectsOverlap} from '../src/ui/paperMap';
import {Input} from '../src/player/input';
import {LockboxSystem} from '../src/ui/lockboxView';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {starterInventory} from '../src/run/starter';
import type {Game} from '../src/game';
import {installCanvasShim} from './helpers/canvas2d';
import {MiniEvent, installMiniDom, type MiniDom, type MiniEl} from './helpers/paperMapDom';

installCanvasShim(false);

const net = generateNetwork(424242);
const start = () => revealAround(newCampaign(net), net.start);
/** Travel along `ids` (arrive + console reveal at each). */
const walk = (s: CampaignState, ids: StationId[]) => ids.reduce((st, id) => revealAround(arrive(st, id), id), s);
function routeTo(n: SubwayNetwork, to: StationId): StationId[] {
  const prev = new Map<string, string>([[n.start, '']]);
  const q = [n.start];
  for (let i = 0; i < q.length; i++) for (const nb of neighbors(n, q[i])) if (!prev.has(nb)) { prev.set(nb, q[i]); q.push(nb); }
  const out: string[] = [];
  for (let c = to; c; c = prev.get(c)!) out.unshift(c);
  return out;
}
/** A mid-run state standing on a station with >= 3 neighbours (several destinations). */
function atHub(): CampaignState {
  const hub = net.nodes.find(n => neighbors(net, n.id).length >= 3 && n.id !== net.reactor && !neighbors(net, n.id).includes(net.reactor))!;
  const r = routeTo(net, hub.id);
  return walk(start(), r.slice(1));
}

describe('pure layout', () => {
  it('fits the whole network into the paper drawing box, uniformly (45-degree track stays 45 degrees)', () => {
    for (const seed of [1, 2, 3, 99, 424242]) {
      const n = generateNetwork(seed), lay = paperLayout(n);
      for (const p of lay.values()) {
        expect(p.x).toBeGreaterThanOrEqual(PAPER.draw.x0 - 1e-6); expect(p.x).toBeLessThanOrEqual(PAPER.draw.x1 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(PAPER.draw.y0 - 1e-6); expect(p.y).toBeLessThanOrEqual(PAPER.draw.y1 + 1e-6);
      }
      for (const [a, b] of n.edges) {
        const dx = Math.abs(lay.get(a)!.x - lay.get(b)!.x), dy = Math.abs(lay.get(a)!.y - lay.get(b)!.y);
        expect(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6).toBe(true);
      }
    }
  });

  it('labels never overlap each other or a station dot, stay inside the border and out of the title band', () => {
    let hidden = 0, total = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const n = generateNetwork(seed * 7919);
      for (const scale of [0.85, 1.4]) {
        const s = enableCheat(revealAround(newCampaign(n), n.start));
        const m = buildMapModel(s, 'travel', scale, null, null);
        const placed = [...m.labels.values()].filter(l => l !== null);
        for (const l of placed) {
          expect(l.box.x0).toBeGreaterThanOrEqual(PAPER.area.x0); expect(l.box.x1).toBeLessThanOrEqual(PAPER.area.x1);
          expect(l.box.y0).toBeGreaterThanOrEqual(PAPER.band.y1); expect(l.box.y1).toBeLessThanOrEqual(PAPER.area.y1);
          if (l.overlap) continue; // a forced label (current / Reactor) with nowhere free; counted below
          for (const o of placed) if (o !== l) expect(rectsOverlap(l.box, o.box), `${seed} ${l.id} vs ${o.id}`).toBe(false);
          for (const st of m.stations) if (st.node.id !== l.id) {
            const r = st.r;
            expect(rectsOverlap(l.box, {x0: st.p.x - r, y0: st.p.y - r, x1: st.p.x + r, y1: st.p.y + r})).toBe(false);
          }
        }
        expect(placed.filter(l => l.overlap).length).toBe(0);
        if (scale > 1) { hidden += [...m.labels.values()].filter(l => l === null).length; total += m.labels.size; }
      }
    }
    expect(hidden / total).toBeLessThan(0.02); // zoomed in, (almost) every station is named
  });

  it('picks arrow targets inside a 67.5-degree cone, nearest first', () => {
    const c = [{id: 'r', x: 10, y: 0}, {id: 'rr', x: 30, y: 2}, {id: 'u', x: 0, y: -10}, {id: 'diag', x: 10, y: 10}];
    expect(pickByDirection({x: 0, y: 0}, c, 'right')).toBe('r');
    expect(pickByDirection({x: 0, y: 0}, c, 'up')).toBe('u');
    expect(pickByDirection({x: 0, y: 0}, c, 'down')).toBe('diag');
    expect(pickByDirection({x: 0, y: 0}, c, 'left')).toBeNull();
  });

  it('the key scope: digits to the cheat, Esc closes, Enter selects (native on a button), browser shortcuts pass', () => {
    const k = (code: string, o: Record<string, unknown> = {}, onButton = false) => paperMapKeyAction({code, ...o}, onButton);
    expect([k('Digit1'), k('Numpad7'), k('Digit3', {repeat: true})]).toEqual([{kind: 'digit', digit: '1'}, {kind: 'digit', digit: '7'}, {kind: 'swallow'}]);
    expect([k('Escape'), k('Enter'), k('Enter', {}, true), k('Space', {}, true)]).toEqual([{kind: 'close'}, {kind: 'select'}, {kind: 'native'}, {kind: 'native'}]);
    // (task studio-alpha-survival-controls-20261107-060450-01) E and Tab close on a fresh press (Tab no longer cycles the stations)
    expect([k('Tab'), k('Tab', {shiftKey: true}), k('KeyE')]).toEqual([{kind: 'closeKey', code: 'Tab'}, {kind: 'closeKey', code: 'Tab'}, {kind: 'closeKey', code: 'KeyE'}]);
    expect([k('KeyE', {repeat: true}), k('Tab', {repeat: true})]).toEqual([{kind: 'swallow'}, {kind: 'swallow'}]);
    expect([k('ArrowLeft'), k('ArrowUp', {shiftKey: true})]).toEqual([{kind: 'arrow', dir: 'left', pan: false}, {kind: 'arrow', dir: 'up', pan: true}]);
    expect([k('Equal', {key: '+'}), k('NumpadSubtract'), k('KeyF'), k('Home'), k('Backspace')]).toEqual([{kind: 'zoom', dir: 1}, {kind: 'zoom', dir: -1}, {kind: 'fit'}, {kind: 'sheet'}, {kind: 'cancel'}]);
    expect([k('KeyR', {ctrlKey: true}), k('F5'), k('Digit1', {metaKey: true}), k('KeyA', {target: {tagName: 'INPUT'}})]).toEqual(new Array(4).fill({kind: 'pass'}));
    expect([k('ShiftLeft'), k('KeyW')]).toEqual([{kind: 'swallow'}, {kind: 'other'}]);
  });
});

describe('the overlay', () => {
  let dom: MiniDom;
  let map: PaperMap;
  const calls = {confirm: [] as string[], close: 0, cheat: 0};
  beforeEach(() => {
    dom = installMiniDom(1280, 720);
    map = new PaperMap();
    calls.confirm = []; calls.close = 0; calls.cheat = 0;
  });
  afterEach(() => { map.destroy(); dom.uninstall(); });

  const root = () => dom.doc.querySelector('#papermap')!;
  const hits = () => dom.doc.querySelectorAll('.pm-hit').map(e => e.getAttribute('data-station')!);
  const hit = (id: string) => dom.doc.querySelector(`.pm-hit[data-station="${id}"]`);
  const inkText = () => dom.doc.querySelector('.pm-ink')!.textContent;
  const panel = () => dom.doc.querySelector('.pm-panel')!;
  const open = (state: CampaignState, mode: 'travel' | 'view' = 'travel', onCheat?: () => CampaignState | void) =>
    map.open({state, mode, onConfirm: to => calls.confirm.push(to), onClose: () => calls.close++, onCheat: onCheat ?? (() => { calls.cheat++; })});

  it('prints only the known stations and edges; the Reactor (mark, name, key) is hidden until known', () => {
    const s = start();
    open(s);
    expect(map.isOpen).toBe(true);
    expect(root().classList.contains('pm-hidden')).toBe(false);
    expect(hits().sort()).toEqual([...s.known].sort());
    const text = inkText();
    for (const n of net.nodes) expect([n.id, text.includes(n.name)]).toEqual([n.id, s.known.includes(n.id)]);
    expect(dom.doc.querySelector('.pm-reactor')).toBeNull();
    expect(text).not.toMatch(/reactor/i);
    expect(dom.doc.querySelectorAll('.pm-track polyline').length).toBeGreaterThan(0);
    expect(dom.doc.querySelector('.pm-mode')!.textContent).toContain(net.nodes.find(n => n.id === net.start)!.name);
    expect(dom.doc.querySelector('.pm-you')).not.toBeNull();
    expect(text).toMatch(/YOU ARE HERE/);
    // walk to the Reactor: its mark appears exactly when it becomes known (standing one hop away)
    const route = routeTo(net, net.reactor);
    let st = s;
    for (let i = 1; i < route.length; i++) {
      map.update(st);
      expect([i, !!dom.doc.querySelector('.pm-reactor'), inkText().includes(net.nodes.find(n => n.id === net.reactor)!.name)]).toEqual([i, reactorKnown(st), reactorKnown(st)]);
      st = walk(st, [route[i]]);
    }
    map.update(st);
    expect(dom.doc.querySelector('.pm-reactor')).not.toBeNull();
    expect(inkText()).toMatch(/Reactor/);
  });

  it('a click SELECTS (details panel); only the explicit Depart travels; the map then closes', () => {
    const s = atHub();
    open(s);
    const dest = destinations(s)[0];
    dom.click(hit(dest));
    expect([map.selected, calls.confirm]).toEqual([dest, []]);
    const n = net.nodes.find(x => x.id === dest)!;
    expect(panel().classList.contains('pm-hidden')).toBe(false);
    expect(panel().textContent).toContain(n.name);
    expect(panel().textContent).toContain(archetypeLabel(n.archetype));
    const depart = panel().querySelector('.pm-depart');
    expect(depart).not.toBeNull();
    expect(dom.doc.activeElement).toBe(depart);
    expect(dom.doc.querySelector('.pm-selected')).not.toBeNull();
    dom.click(depart);
    expect([calls.confirm, map.isOpen, calls.close]).toEqual([[dest], false, 0]);
    expect(root().classList.contains('pm-hidden')).toBe(true);
  });

  it('hover never selects; Cancel clears the selection; Esc closes (onClose), nothing travels', () => {
    const s = atHub();
    open(s);
    const dest = destinations(s)[0];
    hit(dest)!.dispatchEvent(new MiniEvent('pointermove', {pointerId: 1}));
    hit(dest)!.dispatchEvent(new MiniEvent('mouseover'));
    expect(map.selected).toBeNull();
    dom.click(hit(dest));
    dom.click(panel().querySelector('.pm-cancel'));
    expect([map.selected, panel().classList.contains('pm-hidden'), calls.confirm]).toEqual([null, true, []]);
    const esc = dom.key('Escape');
    expect([esc.defaultPrevented, map.isOpen, calls.close, calls.confirm]).toEqual([true, false, 1, []]);
  });

  it('known stations that are not one stop away (and never visited) are printed but not selectable (unless the cheat is on)', () => {
    const a = neighbors(net, net.start)[0], b = neighbors(net, a).find(x => x !== net.start && !neighbors(net, x).includes(net.start))!;
    const s = walk(start(), [a, b]);
    // campaign-polish (lane MAP): a VISITED station two stops back IS a destination (over the visited route; the card names it)
    open(s);
    expect(hit(net.start)!.classList.contains('pm-can')).toBe(true);
    dom.click(hit(net.start));
    expect(map.selected).toBe(net.start);
    expect(panel().textContent).toMatch(/2 stops via/);
    expect(dom.doc.querySelector('.pm-route')).not.toBeNull();
    map.cancel();
    expect(dom.doc.querySelector('.pm-route')).toBeNull();
    const far = s.known.find(k => k !== s.current && !neighbors(net, s.current).includes(k) && !s.visited.includes(k))!;
    expect(far).toBeDefined();
    open(s);
    expect(hits()).toContain(far);
    expect(hit(far)!.classList.contains('pm-can')).toBe(false);
    dom.click(hit(far));
    expect(map.selected).toBeNull();
    expect(map.note).toMatch(/not one stop from here/);
    dom.click(hit(s.current));
    expect(map.selected).toBeNull();
    map.update(enableCheat(s));
    dom.click(hit(far));
    expect(map.selected).toBe(far);
    expect(panel().querySelector('.pm-depart')).not.toBeNull();
  });

  it('1337 (Digit / Numpad) reveals everything once; the host state is used; repeats are idempotent; wrong key / blur / close reset it', () => {
    const s = start();
    let host = s;
    open(s, 'travel', () => { calls.cheat++; host = enableCheat(host); return host; });
    for (const c of ['Digit1', 'Digit3', 'Numpad3', 'Digit7']) expect(dom.key(c).defaultPrevented).toBe(true);
    expect(calls.cheat).toBe(1);
    expect(map.shownState).toBe(host);
    expect(hits().length).toBe(net.nodes.length);
    expect(dom.doc.querySelector('.pm-reactor')).not.toBeNull();
    expect(inkText()).toMatch(/ALL STATIONS OPEN/);
    dom.type('1337');
    expect(calls.cheat).toBe(1);
    // resets (fresh state each time)
    for (const breakIt of [() => dom.key('KeyX'), () => dom.win.dispatchEvent(new MiniEvent('blur')), () => { map.close(); open(s); }]) {
      map.close();
      calls.cheat = 0;
      open(s);
      dom.type('13');
      breakIt();
      dom.type('37');
      expect(calls.cheat).toBe(0);
      dom.type('1337');
      expect(calls.cheat).toBe(1);
    }
  });

  it('without a host state the map applies the cheat to its own copy', () => {
    open(start(), 'travel', () => undefined);
    dom.type('1337');
    expect(map.shownState!.cheat).toBe(true);
    expect(hits().length).toBe(net.nodes.length);
  });

  // Task studio-alpha-survival-controls-20261107-060450-01 (user: "E again or Tab close the train map"): edge-safe with the REAL input
  it('E again / Tab close it like Esc: never the press that opened it, never a repeat; the closing key never reaches the game', () => {
    const input = new Input({addEventListener() {}} as unknown as HTMLCanvasElement, true);
    input.active = true;
    const seen: string[] = [];
    input.onKey = c => seen.push(c);
    const keys: (string | undefined)[] = [];
    const body = dom.doc.body;
    const down = (code: string, repeat = false) => { const e = new MiniEvent('keydown', {code, key: code, repeat, cancelable: true}); (dom.doc.activeElement ?? body).dispatchEvent(e); return e; };
    const up = (code: string) => (dom.doc.activeElement ?? body).dispatchEvent(new MiniEvent('keyup', {code, key: code}));
    // the console's E opened it and is still held: its repeats and the held key itself never close it
    map.open({state: atHub(), heldKeys: ['KeyE'], onClose: key => { keys.push(key); if (key) input.suppressUntilRelease(key); }});
    for (let i = 0; i < 5; i++) down('KeyE', true);
    down('KeyE'); // (a stray non-repeat while still held)
    expect(map.isOpen).toBe(true);
    up('KeyE'); // released: armed
    const e = down('KeyE'); // a fresh press closes
    expect([map.isOpen, keys, e.defaultPrevented]).toEqual([false, ['KeyE'], true]);
    // the closing press never reached the game (no interact), and its held repeats are ignored until it is released
    for (let i = 0; i < 3; i++) down('KeyE', true);
    expect([seen, [...input.pressed], input.down('KeyE')]).toEqual([[], [], false]);
    up('KeyE');
    dom.key('KeyE');
    expect(seen).toEqual(['KeyE']); // released: E is the game's again
    // Tab: closes, and never opens the inventory on the way out (nor on its repeats)
    seen.length = 0;
    map.open({state: atHub(), onClose: key => { keys.push(key); if (key) input.suppressUntilRelease(key); }});
    down('Tab');
    expect([map.isOpen, keys.at(-1)]).toEqual([false, 'Tab']);
    down('Tab', true);
    expect([seen, input.down('Tab')]).toEqual([[], false]);
    up('Tab');
    // Esc still closes (no key passed); digits still go to the 1337 matcher, never the game
    map.open({state: atHub(), onClose: key => keys.push(key)});
    dom.type('13');
    expect(seen).toEqual([]);
    dom.key('Escape');
    expect([map.isOpen, keys.at(-1)]).toEqual([false, undefined]);
  });

  it('digits never leak to the game; the Lockbox keeps its own 1337 when the map is closed', () => {
    // the REAL input listener (window, bubble) and the REAL Lockbox controller (window, capture), as in the game
    const input = new Input({addEventListener() {}} as unknown as HTMLCanvasElement, true);
    input.active = true;
    const seen: string[] = [];
    input.onKey = c => seen.push(c);
    const train = {onLockboxInteract: null as null | (() => void), lockboxAimed: true, setLockboxOpen() {}, lockboxWorld: () => ({x: 0, y: 0.55, z: 0})};
    const shell = {
      inv: starterInventory('pistol'), playerTrain: new PlayerTrainRecord(), trainRuntime: train, player: {x: 0.6, y: 0, z: -0.7, alive: true}, state: 'playing', qa: true, input,
      hud: {toast() {}}, sfx: {pickup() {}, denied() {}}, gear: {session: null, cancelReady() {}, showResume() {}},
      frameHooks: [] as (() => void)[], hitListeners: [] as unknown[], stateListeners: [] as unknown[], sectionHooks: [] as unknown[], inputOwners: [] as unknown[], syncHeld() {},
    };
    const box = new LockboxSystem(shell as unknown as Game).install();
    expect(dom.win.count('keydown', true)).toBe(1); // the Lockbox's
    open(start());
    expect(dom.win.count('keydown', true)).toBe(2);
    dom.type('1234567890');
    dom.type('1337');
    expect([...input.pressed].filter(c => /Digit|Numpad/.test(c))).toEqual([]);
    expect(seen).toEqual([]);
    expect([calls.cheat, box.lastGrant]).toEqual([1, null]);
    dom.key('Escape');
    expect([map.isOpen, dom.win.count('keydown', true)]).toEqual([false, 1]); // the map's listener is gone
    train.onLockboxInteract!();
    expect(box.isOpen).toBe(true);
    dom.type('1337');
    expect(box.lastGrant?.ok).toBe(true);
    expect(calls.cheat).toBe(1);
    box.close('user');
    dom.key('Digit2');
    expect(seen).toContain('Digit2'); // with both closed the quick slot key reaches the game again
  });

  it('keyboard: arrows pick by direction, Enter selects, Enter on Depart is the button\'s', () => {
    const s = atHub();
    const dests = destinations(s);
    expect(dests.length).toBeGreaterThanOrEqual(2);
    open(s);
    dom.key('ArrowRight'); // nothing focused yet: the first destination
    expect(dests).toContain(map.focused);
    expect(dom.doc.querySelector('.pm-focused')).not.toBeNull();
    // arrows (travel mode): the destination in the arrow's direction from the train's station
    const lay = paperLayout(net), here = lay.get(s.current)!;
    let moved = 0;
    for (const [code, axis, sign] of [['ArrowRight', 'x', 1], ['ArrowLeft', 'x', -1], ['ArrowDown', 'y', 1], ['ArrowUp', 'y', -1]] as const) {
      const from = map.focused!;
      dom.key(code);
      const to = map.focused!;
      if (to !== from) { moved++; expect(Math.sign(lay.get(to)![axis] - here[axis])).toBe(sign); }
      expect(dests).toContain(to);
    }
    expect(moved).toBeGreaterThan(0);
    const target = map.focused!;
    const enter = dom.key('Enter');
    expect([enter.defaultPrevented, map.selected, calls.confirm]).toEqual([true, target, []]);
    const depart = panel().querySelector('.pm-depart')!;
    expect(dom.doc.activeElement).toBe(depart);
    const onButton = dom.key('Enter');
    expect([onButton.defaultPrevented, onButton.stopped, calls.confirm]).toEqual([false, true, []]); // the browser clicks the focused button
    dom.click(depart);
    expect(calls.confirm).toEqual([target]);
  });

  it('view mode is read-only: details without Depart; the current station is not selectable', () => {
    const s = atHub();
    open(s); // travel first: a reopen at the same view must re-print, not keep the travel marks
    expect(dom.doc.querySelectorAll('.pm-hints circle').length).toBe(destinations(s).filter(d => neighbors(net, s.current).includes(d)).length); // one stop away
    map.close();
    open(s, 'view');
    expect(dom.doc.querySelector('.pm-mode')!.textContent).toMatch(/View only/);
    expect(dom.doc.querySelectorAll('.pm-hints circle').length).toBe(0);
    const other = s.known.find(k => k !== s.current)!;
    dom.click(hit(other));
    expect(map.selected).toBe(other);
    expect(panel().querySelector('.pm-depart')).toBeNull();
    expect(panel().textContent).toMatch(/View only/);
    expect(map.confirm()).toBe(false);
    dom.click(hit(s.current));
    expect(map.selected).toBe(other);
    dom.key('Escape');
    expect([map.isOpen, calls.close, calls.confirm]).toEqual([false, 1, []]);
  });

  it('hit areas are at least 28 px across on screen, at any zoom', () => {
    open(start());
    for (const f of [1, 0.5, 3]) {
      map.zoomBy(f);
      const s = map.viewState.s;
      for (const c of dom.doc.querySelectorAll('.pm-hit')) expect(2 * Number(c.getAttribute('r')) * s).toBeGreaterThanOrEqual(28);
    }
  });

  it('pan / zoom: wheel zooms at the cursor (and is consumed), buttons zoom and fit, a drag pans and is not a click', () => {
    const s = atHub();
    open(s);
    const stage = dom.doc.querySelector('.pm-stage')!;
    const v0 = map.viewState;
    const wheel = new MiniEvent('wheel', {deltaY: -240, clientX: 400, clientY: 300});
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(map.viewState.s).toBeGreaterThan(v0.s);
    // the paper point under the cursor stays put
    const px = (400 - v0.tx) / v0.s, v1 = map.viewState;
    expect(Math.abs(px * v1.s + v1.tx - 400)).toBeLessThan(1);
    dom.click(dom.doc.querySelector('.pm-zoom-out'));
    expect(map.viewState.s).toBeLessThan(v1.s);
    dom.click(dom.doc.querySelector('.pm-zoom-in'));
    dom.key('Equal', {key: '+'});
    expect(map.viewState.s).toBeGreaterThan(v1.s);
    dom.click(dom.doc.querySelector('.pm-fit'));
    expect(map.viewState.s).toBeCloseTo(v0.s, 5);
    // drag
    const t0 = map.viewState.tx;
    stage.dispatchEvent(new MiniEvent('pointerdown', {button: 0, pointerId: 7, clientX: 300, clientY: 300}));
    dom.win.dispatchEvent(new MiniEvent('pointermove', {pointerId: 7, clientX: 340, clientY: 310}));
    dom.win.dispatchEvent(new MiniEvent('pointerup', {pointerId: 7, clientX: 340, clientY: 310}));
    expect(map.viewState.tx - t0).toBeCloseTo(40, 5);
    dom.click(hit(destinations(s)[0])); // the click that ends a drag selects nothing
    expect(map.selected).toBeNull();
    const sheet = dom.doc.querySelector('.pm-sheet')!;
    expect(String(sheet.style.transform)).toMatch(/^translate\(.+px, .+px\) scale\(.+\)$/);
  });

  it('fits on any screen: the whole sheet, or every known station, is on screen', () => {
    for (const [w, h] of [[360, 640], [1280, 720], [2560, 1440], [800, 1280]]) {
      dom.win.innerWidth = w; dom.win.innerHeight = h;
      const s = enableCheat(start());
      open(s);
      map.fitSheet();
      let v = map.viewState;
      expect(v.tx).toBeGreaterThanOrEqual(-0.5); expect(v.tx + PAPER.w * v.s).toBeLessThanOrEqual(w + 0.5);
      expect(v.ty).toBeGreaterThanOrEqual(0); expect(v.ty + PAPER.h * v.s).toBeLessThanOrEqual(h + 0.5);
      map.fitKnown();
      v = map.viewState;
      for (const p of paperLayout(net).values()) {
        const sx = p.x * v.s + v.tx, sy = p.y * v.s + v.ty;
        expect(sx).toBeGreaterThanOrEqual(0); expect(sx).toBeLessThanOrEqual(w);
        expect(sy).toBeGreaterThanOrEqual(0); expect(sy).toBeLessThanOrEqual(h);
      }
      map.close();
    }
  });

  it('the paper texture is hookable (default asset, custom url, or the flat placeholder colour)', () => {
    open(start());
    expect(String(dom.doc.querySelector('.pm-sheet')!.style.backgroundImage)).toBe(`url("${DEFAULT_PAPER_TEXTURE}")`);
    map.destroy();
    map = new PaperMap({paperTexture: 'x/custom.jpg'});
    open(start());
    expect(String(dom.doc.querySelector('.pm-sheet')!.style.backgroundImage)).toBe('url("x/custom.jpg")');
    map.destroy();
    map = new PaperMap({paperTexture: ''});
    open(start());
    expect(dom.doc.querySelector('.pm-sheet')!.style.backgroundImage).toBeUndefined();
    expect(dom.doc.querySelectorAll('#papermap').length).toBe(1);
  });

  it('station names from an imported save are escaped (never markup)', () => {
    const evil = JSON.parse(JSON.stringify(net)) as SubwayNetwork;
    evil.nodes.find(n => n.id === evil.start)!.name = '<img src=x onerror=alert(1)>';
    open(revealAround(newCampaign(evil), evil.start));
    expect(dom.doc.querySelectorAll('img').length).toBe(0);
    expect(inkText()).toContain('<img src=x onerror=alert(1)>');
    const el: MiniEl | null = dom.doc.querySelector('.pm-label');
    expect(el).not.toBeNull();
  });
});
