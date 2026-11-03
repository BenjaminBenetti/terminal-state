// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): THE END CREDITS. User: "After about 30 seconds on
// the surface, credits should start playing in the top right side of the screen. Creative director: "Benjamin BenettI" Programming:
// "Claude Opus 5.5" Sound: <the sound model> Art: "Meshy T2.5" Product Manager: "Astra 6" And throw in a few funny ones [...] scroll them
// slow, at the very end it should say "Thank you for playing" with a button that says "Main Menu"" (Sound = Stable Audio 3 Small-SFX).
// Node only (no browser): the pure clock (creditsLogic.ts), the runtime on a fake host (credits.ts), the column on a small Node DOM
// (ui/credits.ts), and the REAL Game save methods on a minimal shell (commitEndingSave -> reason 'ending', returnToMenu).
import {afterEach, describe, expect, it, vi, type Mock} from 'vitest';
import type {StationLayout} from '../src/gen/stationTypes';
import {
  CREDITS, CREDITS_ENTRIES, CREDITS_LANE, CREDITS_SPEED_PX_S, CREDITS_TITLE, CREDITS_TRAVEL_PX, CREDIT_LINES, END_CARD, advanceCredits, creditsPhase,
  creditsRecord, emptyCreditsState, loadCreditsState, scrollProgress, stepCredits, stripOffsetPx, type CreditsGate,
} from '../src/world/reactor/creditsLogic';
import {ReactorCredits, installReactorCredits, reactorCreditsOf, type CreditsDeps, type EndingSaveResult} from '../src/world/reactor/credits';
import {CreditsView, mountCreditsView} from '../src/ui/credits';
import {REACTOR_LANE, emptyReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {createRun, type RunState} from '../src/run/runState';
import {FakeStorage, LEVELS_STUB, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';
import {SaveSlots, type CommitResult} from '../src/save/slots';
import {SAVE_POINTS, SAVE_REASONS, type RestoreHandoff, type TrainLocalPose} from '../src/save/serialize';
import {validateSaveFile} from '../src/save/validate';
import {checksumOf} from '../src/save/checksum';
import {STORAGE_KEYS} from '../src/campaign/types';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Survival} from '../src/player/survival';
import {installCanvasShim} from './helpers/canvas2d';
import {installMiniDom, type MiniDom, type MiniEl} from './helpers/paperMapDom';

/** An exact binary step (no float drift over hundreds of frames), under CREDITS.maxDtS. */
const DT = 1 / 16;
const ALL: CreditsGate = {playing: true, visible: true, surfaced: true, onSurface: true, messageClear: true};
const run = (s: ReturnType<typeof emptyCreditsState>, sec: number, g: Partial<CreditsGate> = {}) => {
  const ev: string[] = [];
  for (let i = 0; i < Math.round(sec / DT); i++) ev.push(...stepCredits(s, DT, {...ALL, ...g}));
  return ev;
};

// ---------------------------------------------------------------------------------------------------------------------
describe('the exact credit strings', () => {
  it('the five named credits, in order, exactly as given (Benjamin BenettI keeps the capital I)', () => {
    expect(CREDIT_LINES.slice(0, 5)).toEqual([
      {role: 'Creative Director', name: 'Benjamin BenettI'},
      {role: 'Programming', name: 'Claude Opus 5.5'},
      {role: 'Sound', name: 'Stable Audio 3 Small-SFX'},
      {role: 'Art', name: 'Meshy T2.5'},
      {role: 'Product Manager', name: 'Astra 6'},
    ]);
    expect(CREDIT_LINES[0].name.endsWith('I')).toBe(true);
  });

  it('a few light jokes flesh it out (Zombie #1 — Beth): short, ~10-14 lines in all, no wall of text', () => {
    expect(CREDIT_LINES).toContainEqual({role: 'Zombie #1', name: 'Beth'});
    const jokes = CREDIT_LINES.slice(5);
    expect(jokes.length).toBeGreaterThanOrEqual(3);
    expect(jokes.length).toBeLessThanOrEqual(7);
    expect(CREDITS_ENTRIES).toBeGreaterThanOrEqual(10);
    expect(CREDITS_ENTRIES).toBeLessThanOrEqual(14);
    for (const c of CREDIT_LINES) { expect(c.role.length).toBeLessThanOrEqual(24); expect(c.name.length).toBeLessThanOrEqual(24); }
    expect(CREDITS_TITLE).toBe('Terminal State');
  });

  it('the end card says "Thank you for playing" with a "Main Menu" button and says how to reach it', () => {
    expect(END_CARD.thanks).toBe('Thank you for playing');
    expect(END_CARD.button).toBe('Main Menu');
    expect(END_CARD.hint).toMatch(/Enter/);
    expect(END_CARD.hint).toMatch(/click/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the clock (pure)', () => {
  it('starts after exactly 30 s of active play on the surface', () => {
    const s = emptyCreditsState();
    expect(run(s, 29.9375)).toEqual([]);
    expect(s.started).toBe(false);
    expect(s.t).toBeCloseTo(29.9375, 9);
    expect(run(s, DT)).toEqual(['started']);
    expect([s.started, s.t, creditsPhase(s)]).toEqual([true, CREDITS.triggerS, 'scrolling']);
  });

  it('stepping off the surface pauses the count (never resets it); pause / hidden tab / menus / no surfaced record / the centre message never count', () => {
    const s = emptyCreditsState();
    run(s, 20);
    for (const g of [{onSurface: false}, {playing: false}, {visible: false}, {surfaced: false}, {messageClear: false}] as Partial<CreditsGate>[]) {
      expect(run(s, 50, g)).toEqual([]);
      expect(s.t).toBe(20);
    }
    expect(run(s, 9.9375)).toEqual([]);
    expect(run(s, DT)).toEqual(['started']);
  });

  it('no real-world time accumulates: a frame counts at most CREDITS.maxDtS; NaN / negative / infinite count nothing', () => {
    const s = emptyCreditsState();
    stepCredits(s, 5, ALL);
    expect(s.t).toBeCloseTo(CREDITS.maxDtS, 9);
    for (const dt of [NaN, -3, Infinity, 0]) stepCredits(s, dt, ALL);
    expect(s.t).toBeCloseTo(CREDITS.maxDtS, 9);
  });

  it('the scroll runs CREDITS.scrollS (120 s) of play anywhere at the station (the surface or below), held by pause / a hidden tab', () => {
    expect(CREDITS.triggerS).toBe(30);
    expect(CREDITS.scrollS).toBe(120);
    const s = emptyCreditsState();
    run(s, 30);
    expect(s.started).toBe(true);
    expect(run(s, 60, {onSurface: false, surfaced: false, messageClear: false})).toEqual([]); // off the surface: it keeps running
    expect(s.scroll).toBe(60);
    expect(run(s, 30, {playing: false})).toEqual([]);
    expect(run(s, 30, {visible: false})).toEqual([]);
    expect(s.scroll).toBe(60);
    expect(run(s, 59.9375)).toEqual([]);
    expect(scrollProgress(s)).toBeLessThan(1);
    expect(run(s, DT)).toEqual(['done']);
    expect([s.done, scrollProgress(s), creditsPhase(s)]).toEqual([true, 1, 'end']);
    expect(run(s, 30)).toEqual([]); // the end card stays: nothing more happens
  });

  it('a slow, readable speed: ~12 px/s over the standard 340 px window; the heading enters at the foot, the end card rests at the top inset', () => {
    expect(CREDITS_TRAVEL_PX).toBe(CREDITS.windowPx + CREDITS_ENTRIES * CREDITS.pitchPx - CREDITS.restPx);
    expect(CREDITS_SPEED_PX_S).toBeGreaterThan(8);
    expect(CREDITS_SPEED_PX_S).toBeLessThan(16);
    expect(stripOffsetPx(0)).toBe(CREDITS.windowPx); // the strip's top (the heading) at the window's foot
    expect(stripOffsetPx(1) + CREDITS_ENTRIES * CREDITS.pitchPx).toBe(CREDITS.restPx); // the end card (after the entries) at rest
    // every entry is on screen for ~ (window + pitch) / speed seconds
    expect((CREDITS.windowPx + CREDITS.pitchPx) / CREDITS_SPEED_PX_S).toBeGreaterThan(25);
  });

  it('advanceCredits (QA skip): the count first, the remainder goes on into the scroll, then the end', () => {
    const s = emptyCreditsState();
    expect(advanceCredits(s, 10)).toEqual([]);
    expect(advanceCredits(s, 25)).toEqual(['started']);
    expect(s.scroll).toBe(5);
    expect(advanceCredits(s, 500)).toEqual(['done']);
    expect(advanceCredits(s, 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('persistence (lane store reactor.credits)', () => {
  it('absent / malformed = defaults; ranges clamped; done => started => the count complete', () => {
    for (const raw of [undefined, null, 0, 'x', [], {}, {v: 2, t: 10}, {v: '1', t: 10}]) expect(loadCreditsState(raw)).toEqual(emptyCreditsState());
    expect(loadCreditsState({v: 1, t: 'a', started: 'yes', scroll: {}, done: 1})).toEqual(emptyCreditsState());
    expect(loadCreditsState({v: 1, t: -5})).toMatchObject({t: 0, started: false});
    expect(loadCreditsState({v: 1, t: 999})).toMatchObject({t: 30, started: false});
    expect(loadCreditsState({v: 1, t: 4, scroll: 50})).toMatchObject({t: 4, scroll: 0}); // no scroll before the start
    expect(loadCreditsState({v: 1, started: true, scroll: 1e9})).toEqual({v: 1, t: 30, started: true, scroll: 120, done: false});
    expect(loadCreditsState({v: 1, started: true, scroll: NaN})).toMatchObject({scroll: 0});
    expect(loadCreditsState({v: 1, done: true})).toEqual({v: 1, t: 30, started: true, scroll: 120, done: true});
  });

  it('the record is JSON-safe plain data, never aliased with the live state', () => {
    const s = emptyCreditsState();
    advanceCredits(s, 47.25);
    const rec = creditsRecord(s);
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
    expect(rec).toEqual({v: 1, t: 30, started: true, scroll: 17.25, done: false});
    s.scroll = 99;
    expect(rec.scroll).toBe(17.25);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The runtime on a fake host: a minimal Reactor layout (the surface storey 3 at y 30) and a REAL run (lane stores scoped per station).
const SURF = {level: 3, y: 30};
const reactorLayout = (): StationLayout => ({reactor: {generators: [{}, {}], zones: [{}], surface: {level: SURF.level, y: SURF.y}}}) as unknown as StationLayout;
const subwayLayout = (): StationLayout => ({}) as unknown as StationLayout;
const STATION = {level: 'reactor' as const, section: 'main', station: sid(39)};

/** The persisted ending record with the surface reached (the full restart chain: loadReactorState keeps `ending` only after it). */
function surfacedRecord(surfaced = true): ReactorRunState {
  return {...emptyReactorState(2, 1), fuses: [true, true], breaker: true, valve: true, pump: true, keyInserted: true, rods: true, restarted: true, restartedAt: 100,
    zoneClear: [1], ending: {doors: true, openedAt: 130, announced: true, surfaced}};
}

interface FakeHost {
  player: {x: number; y: number; z: number; alive: boolean};
  layout: StationLayout;
  levels: {levelAt(x: number, z: number, y: number): number};
  run: RunState;
  state: string;
  input: {pressed: Set<string>};
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  stateListeners: ((state: never, prev: never) => void)[];
  commitEndingSave: Mock<() => EndingSaveResult>;
  returnToMenu: Mock<() => void>;
  calls: string[];
}

function fakeHost(o: {save?: () => EndingSaveResult; surfaced?: boolean} = {}): FakeHost {
  const run = createRun({seeds: SEEDS, start: STATION, levels: LEVELS_STUB});
  run.setLaneStore(REACTOR_LANE, surfacedRecord(o.surfaced ?? true));
  const calls: string[] = [];
  const h: FakeHost = {
    player: {x: 0, y: SURF.y, z: 0, alive: true},
    layout: reactorLayout(),
    levels: {levelAt: (_x, _z, y) => (y > SURF.y - 1 ? SURF.level : 0)},
    run, state: 'loading', input: {pressed: new Set()},
    sectionHooks: [], frameHooks: [], stateListeners: [], calls,
    commitEndingSave: vi.fn(() => { calls.push(`save:${JSON.stringify(run.laneStore(CREDITS_LANE))}`); return o.save ? o.save() : {ok: true}; }),
    returnToMenu: vi.fn(() => { calls.push('menu'); setState(h, 'title'); }),
  };
  return h;
}
function setState(h: FakeHost, s: string): void {
  const prev = h.state;
  h.state = s;
  for (const l of h.stateListeners) (l as unknown as (a: string, b: string) => void)(s, prev);
}
function install(h: FakeHost, deps: CreditsDeps = {}): {c: ReactorCredits; clock: {ms: number}; vis: {on: boolean}} {
  const clock = {ms: 0}, vis = {on: true};
  const c = installReactorCredits(h as never, {view: () => null, visible: () => vis.on, now: () => clock.ms, ...deps});
  return {c, clock, vis};
}
const build = (h: FakeHost) => { for (const s of h.sectionHooks) s.build?.(h.layout); setState(h, 'playing'); };
const teardown = (h: FakeHost) => { for (const s of h.sectionHooks) s.teardown?.(); };
const frames = (h: FakeHost, sec: number) => { for (let i = 0; i < Math.round(sec / DT); i++) for (const f of h.frameHooks) f(DT); };
const enter = (h: FakeHost) => { h.input.pressed.add('Enter'); for (const f of h.frameHooks) f(DT); h.input.pressed.clear(); };

describe('the runtime (fake host)', () => {
  it('registers once (a section hook, a frame hook, a state listener) and is inert on a level without the Reactor surface', () => {
    const h = fakeHost();
    const {c} = install(h);
    expect([h.sectionHooks.length, h.frameHooks.length, h.stateListeners.length]).toEqual([1, 1, 1]);
    expect(reactorCreditsOf(h)).toBe(c);
    h.layout = subwayLayout();
    build(h);
    frames(h, 200);
    teardown(h);
    expect(c.info).toBeNull();
    expect(h.run.laneStore(CREDITS_LANE)).toBeUndefined();
    expect(c.counts).toMatchObject({builds: 0, started: 0, stores: 0});
  });

  it('30 s on the surface (the persisted surfaced record, the player on the surface storey) starts it; off the surface / paused / hidden hold the count', () => {
    const h = fakeHost();
    const {c, vis} = install(h);
    build(h);
    frames(h, 12);
    h.player.y = SURF.y - 8; // down the stair: off the surface storey
    frames(h, 40);
    setState(h, 'paused'); frames(h, 40); setState(h, 'playing');
    vis.on = false; frames(h, 40); vis.on = true;
    h.player.y = SURF.y;
    h.player.alive = false; frames(h, 40); h.player.alive = true;
    expect(c.state).toMatchObject({t: 12, started: false});
    frames(h, 17.9375);
    expect(c.state.started).toBe(false);
    frames(h, DT);
    expect(c.state.started).toBe(true);
    expect(c.counts.started).toBe(1);
    expect(h.run.laneStore(CREDITS_LANE)).toMatchObject({v: 1, started: true}); // stored at the start
  });

  it('never before the surface is reached: no surfaced record = no count, even standing at that height', () => {
    const h = fakeHost({surfaced: false});
    const {c} = install(h);
    build(h);
    frames(h, 90);
    expect(c.state.t).toBe(0);
    h.run.setLaneStore(REACTOR_LANE, surfacedRecord(true)); // ending.ts writes it when the player stands on the surface
    frames(h, 30.5);
    expect(c.state.started).toBe(true);
  });

  it('the end card after the scroll; Enter on it (while playing) saves then returns to the menu; the record is stored first', () => {
    const h = fakeHost();
    const {c} = install(h);
    build(h);
    enter(h); // Enter does nothing before the end card
    frames(h, 30);
    enter(h);
    frames(h, 100);
    h.player.y = SURF.y - 8; // the scroll keeps running below the surface
    frames(h, 20);
    expect(c.cardShown).toBe(true);
    expect(c.state.done).toBe(true);
    expect(h.commitEndingSave).not.toHaveBeenCalled();
    frames(h, 300); // it stays: no automatic return / reset
    expect([c.cardShown, h.state, h.returnToMenu.mock.calls.length]).toEqual([true, 'playing', 0]);
    enter(h);
    expect(h.calls).toEqual([`save:${JSON.stringify({v: 1, t: 30, started: true, scroll: 120, done: true})}`, 'menu']);
    expect(h.state).toBe('title');
    expect(c.counts).toMatchObject({presses: 1, saves: 1, left: 1, leftUnsaved: 0});
  });

  it('a failed save shows its error and leaves only on a second, separate press (WITHOUT saving again); one press never counts twice', () => {
    const h = fakeHost({save: () => ({ok: false, error: "Not saved: this browser's storage for the game is full. Slot 2 still holds its previous save."})});
    const {c, clock} = install(h);
    build(h);
    c.qa({end: true});
    c.press();
    expect(h.commitEndingSave).toHaveBeenCalledTimes(1);
    expect(h.returnToMenu).not.toHaveBeenCalled();
    expect([c.armed, h.state]).toEqual([true, 'playing']);
    expect(c.error).toMatch(/storage for the game is full/);
    expect(c.error).toContain(END_CARD.confirm);
    clock.ms += 100;
    c.press(); // the same press (a focused button's Enter + the key read): ignored
    expect(h.returnToMenu).not.toHaveBeenCalled();
    clock.ms += 1000;
    c.press();
    expect(h.commitEndingSave).toHaveBeenCalledTimes(1);
    expect(h.returnToMenu).toHaveBeenCalledTimes(1);
    expect(c.counts).toMatchObject({saveFailures: 1, leftUnsaved: 1, left: 1});
  });

  it('a save that throws is reported the same way; nothing to save (no campaign: null) leaves directly', () => {
    const a = fakeHost({save: () => { throw new Error('boom'); }});
    const ra = install(a);
    build(a);
    ra.c.qa({end: true});
    ra.c.press();
    expect(ra.c.error).toMatch(/^Not saved: boom/);
    expect(a.returnToMenu).not.toHaveBeenCalled();
    const b = fakeHost({save: () => null});
    const rb = install(b);
    build(b);
    rb.c.qa({end: true});
    rb.c.press();
    expect(b.returnToMenu).toHaveBeenCalledTimes(1);
  });

  it('the button is inert before the end card and outside play / pause (dead, title, inventory, map)', () => {
    const h = fakeHost();
    const {c, clock} = install(h);
    build(h);
    c.qa({skip: 60});
    c.press();
    expect(h.commitEndingSave).not.toHaveBeenCalled();
    c.qa({end: true});
    for (const s of ['dead', 'title', 'inventory', 'map', 'loading']) { setState(h, s); clock.ms += 1000; c.press(); }
    expect(h.commitEndingSave).not.toHaveBeenCalled();
    setState(h, 'paused'); // Esc released the pointer: the mouse reaches the card
    clock.ms += 1000;
    c.press();
    expect(h.commitEndingSave).toHaveBeenCalledTimes(1);
  });

  it('persistence round trip through the lane store: pending resumes its count, a started scroll resumes at its position, a finished one shows nothing again', () => {
    const h = fakeHost();
    const {c} = install(h);
    build(h);
    frames(h, 12.5);
    teardown(h); // travel / leave: stored
    expect(h.run.laneStore(CREDITS_LANE)).toEqual({v: 1, t: 12.5, started: false, scroll: 0, done: false});
    build(h);
    expect(c.state).toMatchObject({t: 12.5, started: false});
    frames(h, 17.5 + 41.25);
    teardown(h);
    expect(h.run.laneStore(CREDITS_LANE)).toEqual({v: 1, t: 30, started: true, scroll: 41.25, done: false});
    // a JSON round trip (the save file) then a rebuild: the scroll resumes at 41.25 s
    h.run.setLaneStore(CREDITS_LANE, JSON.parse(JSON.stringify(h.run.laneStore(CREDITS_LANE))));
    build(h);
    expect(c.state.scroll).toBe(41.25);
    frames(h, 78.75);
    expect(c.state.done).toBe(true);
    expect(c.cardShown).toBe(true);
    teardown(h);
    build(h);
    frames(h, 300);
    expect([c.state.done, c.cardShown, c.counts.ended]).toEqual([true, false, 1]); // no repeated credits, no second end card
    c.press();
    expect(h.commitEndingSave).not.toHaveBeenCalled();
  });

  it('its OWN lane store: reactor.state is never written by the credits; another station has no credits record', () => {
    const h = fakeHost();
    const {c} = install(h);
    const before = JSON.stringify(h.run.laneStore(REACTOR_LANE));
    build(h);
    frames(h, 45);
    teardown(h);
    expect(JSON.stringify(h.run.laneStore(REACTOR_LANE))).toBe(before);
    expect(h.run.laneStore(CREDITS_LANE)).toMatchObject({started: true});
    expect(h.run.laneStore(CREDITS_LANE, {level: 'reactor', section: 'main', station: sid(38)})).toBeUndefined();
    expect(c.counts.stores).toBeGreaterThan(0);
  });

  it('a malformed stored record starts clean (defaults)', () => {
    const h = fakeHost();
    h.run.setLaneStore(CREDITS_LANE, {v: 1, t: 'soon', started: 'maybe', done: null});
    const {c} = install(h);
    build(h);
    expect(c.state).toEqual(emptyCreditsState());
  });

  it('never overlaps the centre "External doors open" message: the count holds while it is centred / moving', async () => {
    const {ReactorEnding} = await import('../src/world/reactor/ending');
    const h = fakeHost();
    // a live ENDING runtime registered on this host first (as in game.ts), surfaced, its message centred (no ending build / frame here)
    const e = new ReactorEnding(h as never).install();
    h.sectionHooks.length = 0; h.frameHooks.length = 0; h.stateListeners.length = 0;
    e.surface = reactorLayout().reactor!.surface!;
    e.ending = {doors: true, openedAt: 0, announced: true, surfaced: true};
    let phase = 'centre';
    Object.defineProperty(e, 'messagePhase', {get: () => phase});
    const {c} = install(h);
    build(h);
    frames(h, 40);
    expect(c.state.t).toBe(0);
    expect(c.gate).toMatchObject({surfaced: true, onSurface: true, messageClear: false});
    phase = 'moving';
    frames(h, 5);
    expect(c.state.t).toBe(0);
    phase = 'docked';
    frames(h, 30);
    expect(c.state.started).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the column (ui/credits.ts on a small Node DOM)', () => {
  let dom: MiniDom | null = null;
  afterEach(() => { dom?.uninstall(); dom = null; });
  const mini = () => {
    dom = installMiniDom(1280, 720);
    const app = dom.doc.createElement('div');
    app.id = 'app';
    dom.doc.body.appendChild(app);
    return {dom, app};
  };
  const text = (el: MiniEl | null) => el?.textContent ?? '';

  it('mounts in #app (above the pause dim), the exact strings in order, hidden until play; CSS injected once', () => {
    const {dom, app} = mini();
    const onMainMenu = vi.fn();
    const v = mountCreditsView({onMainMenu})!;
    const root = dom.doc.querySelector('#reactor-credits')!;
    expect(root.parent).toBe(app);
    expect(root.getAttribute('aria-label')).toBe('Credits');
    expect(text(root.querySelector('.rc-title'))).toBe('Terminal State');
    const roles = root.querySelectorAll('.rc-role').map(text), names = root.querySelectorAll('.rc-name').map(text);
    expect(roles).toEqual(CREDIT_LINES.map(c => c.role));
    expect(names).toEqual(CREDIT_LINES.map(c => c.name));
    expect(text(root.querySelector('.rc-thanks'))).toBe('Thank you for playing');
    const btn = root.querySelector('button')!;
    expect([text(btn), btn.id, (btn as unknown as {type: string}).type]).toEqual(['Main Menu', 'btn-credits-menu', 'button']);
    expect(v.visible).toBe(false);
    v.setMode('play');
    expect(v.visible).toBe(true);
    const css = dom.doc.querySelector('#reactor-credits-css')!;
    expect(text(css)).toMatch(/#reactor-credits\{[^}]*z-index:21[^}]*top:calc\(env\(safe-area-inset-top,0px\) \+ 132px\);right:calc\(env\(safe-area-inset-right,0px\) \+ 24px\)/);
    expect(text(css)).toMatch(/pointer-events:none/);
    mountCreditsView({onMainMenu})!.dispose();
    expect(dom.doc.querySelectorAll('#reactor-credits-css').length).toBe(1);
  });

  it('progress drives --rc-k; paused shows only the end card; the button works only at the end; dispose removes it', () => {
    const {dom} = mini();
    const onMainMenu = vi.fn();
    const v = mountCreditsView({onMainMenu}) as CreditsView;
    v.setMode('play');
    v.setProgress(0.25);
    expect(v.root.style.getPropertyValue?.('--rc-k') ?? (v.root.style as unknown as Record<string, string>)['--rc-k']).toBe('0.25000');
    v.setMode('paused');
    expect(v.visible).toBe(false); // the scrolling lines never sit over the pause screen
    dom.click(v.button as unknown as MiniEl);
    expect(onMainMenu).not.toHaveBeenCalled();
    v.showEnd();
    expect(v.root.classList.contains('rc-end')).toBe(true);
    expect(v.visible).toBe(true); // paused + at the end: the card is clickable above the dim
    dom.click(v.button as unknown as MiniEl);
    expect(onMainMenu).toHaveBeenCalledTimes(1);
    v.setError('Not saved: full.');
    expect([text(v.error as unknown as MiniEl), v.error.hidden]).toEqual(['Not saved: full.', false]);
    v.setError(null);
    expect(v.error.hidden).toBe(true);
    for (const m of ['hidden'] as const) { v.setMode(m); expect(v.visible).toBe(false); }
    (v.button as unknown as MiniEl).focus();
    v.setMode('play'); // back in play: the focused button lets go (one Enter = one press)
    expect(dom.doc.activeElement).not.toBe(v.button);
    v.dispose();
    expect(dom.doc.querySelector('#reactor-credits')).toBeNull();
  });

  it('the runtime with the real column: mounted at the start, the end card by state, a click on the real button saves and returns; teardown removes it', () => {
    const {dom} = mini();
    const h = fakeHost();
    const {c} = install(h, {view: undefined}); // the default view (mountCreditsView)
    build(h);
    expect(dom.doc.querySelector('#reactor-credits')).toBeNull(); // nothing before the start
    frames(h, 30);
    const root = dom.doc.querySelector('#reactor-credits')!;
    expect(root).not.toBeNull();
    expect(c.view!.visible).toBe(true);
    setState(h, 'paused');
    expect(c.view!.visible).toBe(false);
    setState(h, 'playing');
    frames(h, 120);
    expect(root.classList.contains('rc-end')).toBe(true);
    setState(h, 'paused');
    expect(c.view!.visible).toBe(true);
    dom.click(root.querySelector('button'));
    expect(h.calls).toEqual([`save:${JSON.stringify({v: 1, t: 30, started: true, scroll: 120, done: true})}`, 'menu']);
    expect(c.view!.visible).toBe(false); // the title
    teardown(h);
    expect(dom.doc.querySelector('#reactor-credits')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the Main Menu save path (the REAL game.ts methods on a minimal shell): reason 'ending'", async () => {
  installCanvasShim(false);
  const {Game} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  type G = {
    run: RunState; inv: Inventory; currentSlot: number | null; saveRevision: number; saves: SaveSlots; world: unknown;
    wireRunLanes(): void; resetCarry(): void;
    commitSave(reason: 'departure' | 'arrival' | 'new-game' | 'ending', o?: {slot?: number; overwrite?: boolean; pose?: TrainLocalPose}): CommitResult;
    commitEndingSave(): CommitResult | null;
    returnToMenu(): void;
    applySave(file: unknown): ({ok: true} & RestoreHandoff) | {ok: false; error: string};
  };
  const campaign = () => fixtureCampaign({current: sid(39), known: [sid(0), sid(1), sid(38), sid(39)], visited: [sid(0), sid(39)]});
  function shell(storage: FakeStorage, o: {campaign?: boolean} = {}): G {
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const s = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [] as {id: string}[], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number) => battery.reset(c)},
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 0, trainPlacement: null, world: null,
      run: createRun({seeds: SEEDS, start: STATION, levels: LEVELS, ...(o.campaign === false ? {} : {campaign: campaign()})}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
    };
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as G;
    g.wireRunLanes();
    g.resetCarry();
    return g;
  }

  it("SAVE_POINTS / SAVE_REASONS gain 'ending' (the older points unchanged, in order)", () => {
    expect(SAVE_POINTS).toEqual(['departure', 'arrival', 'new-game', 'ending']);
    expect(SAVE_REASONS).toEqual(['departure', 'arrival', 'new-game', 'ending', 'import']);
  });

  it("commits the bound slot with reason 'ending' (valid, loads back with the credits record); the other slots untouched", () => {
    const storage = new FakeStorage();
    const g = shell(storage);
    expect(g.commitSave('new-game', {slot: 2})).toMatchObject({ok: true});
    const other = shell(storage);
    expect(other.commitSave('new-game', {slot: 3})).toMatchObject({ok: true});
    const slot3 = storage.map.get(STORAGE_KEYS.slot(3));
    expect(slot3).toMatch(/"slot":3/);
    g.run.setLaneStore(CREDITS_LANE, creditsRecord({v: 1, t: 30, started: true, scroll: 120, done: true}));
    g.run.setLaneStore(REACTOR_LANE, surfacedRecord(true));
    const r = g.commitEndingSave()!;
    expect(r).toMatchObject({ok: true, slot: 2, meta: {reason: 'ending', revision: 2}});
    const read = g.saves.read(2);
    if (!read.ok) throw new Error(read.error);
    expect(validateSaveFile(read.file, {}).ok).toBe(true);
    expect((read.file as {run: {point: string; player: {trainLocal: TrainLocalPose}}}).run.point).toBe('ending');
    const h = shell(new FakeStorage());
    const back = h.applySave(read.file);
    expect(back).toMatchObject({ok: true, point: 'ending', transit: null, key: STATION});
    expect(h.run.laneStore(CREDITS_LANE, STATION)).toEqual({v: 1, t: 30, started: true, scroll: 120, done: true});
    expect(h.run.laneStore(REACTOR_LANE, STATION)).toEqual(surfacedRecord(true));
    expect([h.currentSlot, h.saveRevision]).toEqual([2, 2]);
    expect(storage.map.get(STORAGE_KEYS.slot(3))).toBe(slot3); // slot 3 byte-identical
  });

  it('a full storage reports the accurate error; the slot keeps its previous save', () => {
    const storage = new FakeStorage();
    const g = shell(storage);
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    const before = new Map(storage.map);
    storage.quota = storage.used() + 10;
    g.run.setLaneStore(CREDITS_LANE, {v: 1, t: 30, started: true, scroll: 120, done: true, pad: 'x'.repeat(200)});
    const r = g.commitEndingSave()!;
    expect(r).toMatchObject({ok: false, code: 'quota', error: expect.stringMatching(/storage for the game is full.*Slot 1 still holds its previous save/)});
    expect(storage.map).toEqual(before);
    expect(g.saveRevision).toBe(1);
  });

  it('no campaign (a QA / legacy scratch run) = nothing to save (null); nothing written', () => {
    const storage = new FakeStorage();
    const g = shell(storage, {campaign: false});
    expect(g.commitEndingSave()).toBeNull();
    expect(storage.writes).toBe(0);
  });

  it('with a live world the station deltas are captured first (non-destructive: section memory + grounded bags), then the commit', () => {
    const storage = new FakeStorage();
    const g = shell(storage);
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    const order: string[] = [];
    const s = g as unknown as Record<string, unknown>;
    s.world = {};
    s.saveSectionMemory = () => order.push('memory');
    s.gear = {flush: () => order.push('bags')};
    const commit = Game.prototype.commitSave;
    s.commitSave = function (this: G, ...a: Parameters<G['commitSave']>) { order.push(`commit:${a[0]}`); return commit.apply(this as never, a as never); };
    expect(g.commitEndingSave()).toMatchObject({ok: true, meta: {reason: 'ending'}});
    expect(order).toEqual(['memory', 'bags', 'commit:ending']);
  });

  it('returnToMenu = the campaign return (the moving ride reset, then the title), as the pause / death "Main menu"', () => {
    const g = shell(new FakeStorage());
    const order: string[] = [];
    const s = g as unknown as Record<string, unknown>;
    s.trainRide = {reset: () => order.push('ride.reset')};
    s.setState = (st: string) => order.push(`state:${st}`);
    g.returnToMenu();
    expect(order).toEqual(['ride.reset', 'state:title']);
  });

  it("an 'ending' save during a journey is invalid (it is never taken in transit)", () => {
    const storage = new FakeStorage();
    const g = shell(storage);
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    const read = g.saves.read(1);
    if (!read.ok) throw new Error(read.error);
    const f = JSON.parse(JSON.stringify(read.file));
    f.run.point = 'ending';
    f.checksum = checksumOf(f.run);
    expect(validateSaveFile(f, {}).ok).toBe(true);
    f.run.campaign.transit = {from: sid(39), to: sid(38), phase: 'departing', cheat: false};
    f.checksum = checksumOf(f.run);
    const v = validateSaveFile(f, {});
    expect(v.ok).toBe(false);
    expect((v as {error: string}).error).toMatch(/an ending save during a journey/);
  });
});
