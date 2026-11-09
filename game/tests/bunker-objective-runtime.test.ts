// Task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): THE BUNKER's optional objective runtime (world/bunker/objective.ts) on a
// minimal Game shell (the registries, a camera, the real RunState / Inventory of the save fixture Harness) with a SYNTHETIC layout that has
// layout.bunker + matching props (the LEVEL lane generates the real one). Covers: the pour's fuel-cost atomicity (exactly one can on
// success; nothing on every cancel / refusal / missing source / double press / held left button), the input ownership while pouring, the
// turnkey start (a cancelled start leaves it fuelled and the next one is free; online once: no more fuel, no refund, no duplicate), the
// all-three gating of the core, the intel claim (priority, exactly once across repeated E / a save-load round trip / Retry, knowledge
// not visited, campaign-less runs), independent stations, the lane discipline (only 'bunker.state'; no layout.reactor), the views /
// warm-up pool, and the game.ts wiring (one installer line).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {Game} from '../src/game';
import type {StationLayout} from '../src/gen/stationTypes';
import {BUNKER_CORE_DIMS, BUNKER_CORE_KIND, BUNKER_GENERATOR_COUNT, BUNKER_GENERATOR_DIMS, BUNKER_GENERATOR_KIND, type BunkerInfo} from '../src/gen/bunker/bunkerTypes';
import {BUNKER_CORE, BUNKER_GEN, installBunkerObjective, type BunkerObjective} from '../src/world/bunker/objective';
import {BUNKER_LANE, type BunkerStateJSON} from '../src/world/bunker/objectiveState';
import {BUNKER_OBJECTIVE_MODELS, CORE_LAYOUT, CORE_USE, GEN_AIM, GEN_PANEL, GEN_USE, genNeckMouth, genToWorld} from '../src/world/bunker/objectiveViews';
import {FUEL_PORT} from '../src/world/fuelPort';
import {POUR_VIEW} from '../src/world/fuelPourView';
import {REACTOR_GEN} from '../src/world/reactor/generators';
import {FUEL} from '../src/fuel/fuel';
import type {ItemStack} from '../src/items/inventory';
import {restoreCarry} from '../src/run/snapshot';
import {restoreRun, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText} from '../src/save/validate';
import type {CampaignState} from '../src/campaign/types';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false); // canvases exist (the core screen redraws are counted); no document.body: the DOM close-up is skipped

const DT = 1 / 60;
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const BUNKER = sid(3);

/** The synthetic Bunker: three generators on three storeys (different yaws), the core on the lowest one. */
function fixtureLayout(): StationLayout {
  const G = BUNKER_GENERATOR_DIMS, C = BUNKER_CORE_DIMS;
  const gens = [
    {id: 'gen-0', level: 1, x: 12, y: -6, z: 14, rot: 0, area: 11, label: 'Habitation plant room'},
    {id: 'gen-1', level: 2, x: 44, y: -12, z: 18, rot: Math.PI / 2, area: 12, label: 'Services workshop'},
    {id: 'gen-2', level: 3, x: 20, y: -18, z: 46, rot: Math.PI, area: 13, label: 'Maintenance plant'},
  ];
  const core = {level: 4, x: 34, y: -24, z: 34, rot: -Math.PI / 2, area: 14};
  const props = [
    ...gens.map(g => ({kind: BUNKER_GENERATOR_KIND, x: g.x, y: g.y, z: g.z, rot: g.rot, level: g.level, hx: G.w / 2, hz: G.d / 2, h: G.h, variant: 0})),
    {kind: BUNKER_CORE_KIND, x: core.x, y: core.y, z: core.z, rot: core.rot, level: core.level, hx: C.w / 2, hz: C.d / 2, h: C.h, variant: 0},
  ];
  const bunker: BunkerInfo = {
    version: 1, name: 'Test Bunker',
    storeys: [0, 1, 2, 3, 4].map(l => ({level: l, baseY: -6 * l, label: l ? `Level ${l}` : 'Station', programme: l === 4 ? 'core' : 'services'})),
    vaultDoor: {prop: 0, level: 0, x: 2, z: 2, rot: 0},
    generators: gens.map((g, i) => ({...g, prop: i})),
    core: {...core, prop: 3},
    gasZones: [], damp: [], start: {x: 1, z: 1, yaw: 0, level: 0},
  };
  return {props, bunker} as unknown as StationLayout;
}

const keys = new Set<string>();

/** A Game shell with exactly what the objective touches; the run / inventory are the save fixture Harness's (real RunState / Inventory). */
function shell(o: {campaign?: CampaignState | null; layout?: StationLayout | null} = {}) {
  const campaign = o.campaign === undefined ? fixtureCampaign({current: BUNKER, known: [sid(0), sid(1), sid(2), sid(3), sid(4)], visited: [sid(0), sid(1), sid(2), BUNKER]}) : o.campaign;
  const h = new Harness(campaign);
  if (!campaign) h.run.current = {level: 'subway', section: 'main'};
  h.run.memory().visits = 1;
  const toasts: {text: string; warn: boolean}[] = [];
  const rings: (number | null)[] = [];
  const calls = {denied: 0, pour: 0, stopPour: 0, sync: 0, cues: 0, loops: 0, smoke: 0, registered: 0};
  const lanesWritten: string[] = [];
  const pools: Record<string, () => readonly THREE.Object3D[]> = {};
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 100);
  let clock = 0;
  keys.clear();
  const g = {
    scene: new THREE.Scene(), camera, state: 'playing',
    get clock() { return clock; },
    frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[],
    interactHandlers: [] as (() => boolean)[], pointerHandlers: [] as (() => boolean)[], promptProviders: [] as (() => string | null)[],
    inputOwners: [] as (() => boolean)[], hitListeners: [] as ((h: {amount: number}) => void)[], stateListeners: [] as ((s: string, prev: string) => void)[],
    sectionModelKeys: [] as ((l: StationLayout) => readonly string[])[],
    warmRegistry: {addPool: (n: string, f: () => readonly THREE.Object3D[]) => { pools[n] = f; }},
    player: {x: 0, y: 0, z: 0, alive: true, climbing: false, sprinting: false},
    input: {clears: 0, down: (code: string) => keys.has(code)},
    get inv() { return h.inv; },
    get run() { return h.run; },
    trainRide: {riding: false},
    levels: {raycast: () => ({kind: 'none', t: Infinity}), lineOfSight: () => true, list: [{baseY: 0}], count: 1},
    consumeView: {busy: false}, gasMask: {transitioning: false}, gear: {readied: false},
    zombies: [] as unknown[],
    hud: {toast: (text: string, warn = false) => { toasts.push({text, warn}); }, setHoldRing: (p: number | null) => { rings.push(p); }},
    sfx: {
      denied() { calls.denied++; }, fuelPour() { calls.pour++; return 2.58; }, stopFuelPour() { calls.stopPour++; },
      reactorCue() { calls.cues++; }, reactorLoop() { calls.loops++; return {stop() {}, playing: true}; },
    },
    syncHeld() { calls.sync++; },
    propModels: {get: () => undefined},
    world: {culler: {register: () => { calls.registered++; }}},
    atmosphere: {addSmokeEmitter: () => { calls.smoke++; return {id: 1, alive: true, emitting: true, setPos() {}, stop() {}}; }},
    fuelPort: {heldObj: null as THREE.Object3D | null},
  };
  const sys = installBunkerObjective(g as unknown as Game);
  // every lane write of the run (the objective must only ever write BUNKER_LANE)
  const spy = () => { const r = h.run, set = r.setLaneStore.bind(r); r.setLaneStore = (lane: string, data: unknown, key?: Parameters<typeof set>[2]) => { lanesWritten.push(lane); set(lane, data, key); }; };
  spy();
  const layout = o.layout === undefined ? fixtureLayout() : o.layout;
  const build = (l: StationLayout | null = layout) => { for (const s of g.sectionHooks) s.build?.(l ?? {props: []}); };
  const teardown = () => { for (const s of g.sectionHooks) s.teardown?.(); };
  build();
  const step = (seconds = DT) => { const n = Math.max(1, Math.round(seconds / DT)); for (let i = 0; i < n; i++) { clock += DT; for (const f of g.frameHooks) f(DT); } };
  const info = () => (layout as unknown as {bunker: BunkerInfo}).bunker;
  /** Stand at generator i's use point (eye 1.62 m), looking at its filler neck. */
  const standAtGen = (i: number, back = 0) => {
    const s = info().generators[i], feet = genToWorld(s, {x: GEN_USE.x, y: 0, z: GEN_USE.z + back});
    g.player.x = feet.x; g.player.y = feet.y; g.player.z = feet.z;
    camera.position.set(feet.x, feet.y + 1.62, feet.z);
    const m = genToWorld(s, genNeckMouth());
    camera.lookAt(m.x, m.y, m.z);
    camera.updateMatrixWorld(true);
  };
  const standAtCore = () => {
    const c = info().core, feet = genToWorld(c, {x: CORE_USE.x, y: 0, z: CORE_USE.z});
    g.player.x = feet.x; g.player.y = feet.y; g.player.z = feet.z;
    camera.position.set(feet.x, feet.y + 1.62, feet.z);
    const look = genToWorld(c, {x: 0, y: 1.3, z: 0.4});
    camera.lookAt(look.x, look.y, look.z);
    camera.updateMatrixWorld(true);
  };
  const lookAway = () => { const c = camera.position; camera.lookAt(c.x + 5, c.y + 3, c.z + 5); camera.updateMatrixWorld(true); };
  const press = () => { for (const f of g.interactHandlers) if (f()) return true; return false; };
  const click = () => g.pointerHandlers.some(f => f());
  const prompt = () => { for (const f of g.promptProviders) { const p = f(); if (p) return p; } return null; };
  const give = (n: number, where: 'pack' | 'hotbar' = 'pack', index = 0): ItemStack => {
    const st = h.inv.makeStack(FUEL.canItem, n);
    st.count = n;
    h.inv.set({bar: where, index}, st);
    return st;
  };
  const cans = () => h.inv.count(FUEL.canItem);
  const setState = (s: string) => { const prev = g.state; g.state = s; for (const f of g.stateListeners) f(s, prev); };
  const lane = () => h.run.laneStore<BunkerStateJSON>(BUNKER_LANE);
  /** Pour one can into generator i (E, the full pour). */
  const fuel = (i: number) => { standAtGen(i); step(); expect(press()).toBe(true); step(FUEL_PORT.pourS + 0.05); };
  /** Hold E on generator i through the turnkey start. */
  const startGen = (i: number) => { standAtGen(i); step(); keys.add('KeyE'); expect(press()).toBe(true); step(BUNKER_GEN.HOLD_S + 0.05); keys.delete('KeyE'); };
  return {g, h, sys: sys as BunkerObjective, toasts, rings, calls, pools, lanesWritten, build, teardown, step, standAtGen, standAtCore, lookAway, press, click, prompt, give, cans, setState, lane, fuel, startGen, info, layout};
}

describe('bunker objective: inert elsewhere, the views, the warm-up, the wiring', () => {
  it('without layout.bunker: no views, no prompt, E / left click not taken, no lane writes', () => {
    const s = shell({layout: {props: []} as unknown as StationLayout});
    s.give(2, 'hotbar', 0);
    s.h.inv.select(0);
    s.step();
    expect(s.sys.info).toBeNull();
    expect(s.g.scene.children.length).toBe(0);
    expect(s.prompt()).toBeNull();
    expect(s.press()).toBe(false);
    expect(s.click()).toBe(false);
    s.teardown();
    expect(s.lanesWritten).toEqual([]);
    expect(s.pools['bunker-objective']()).toEqual([]);
    expect(s.g.sectionModelKeys[0]({props: []} as unknown as StationLayout)).toEqual([]);
  });

  it('a Bunker build draws three generators + the core cluster; the warm-up pool carries the hidden pour view; model keys are the Reactor kit\'s', () => {
    const s = shell();
    expect(BUNKER_GENERATOR_COUNT).toBe(3);
    expect(s.sys.gens.length).toBe(3);
    expect(s.sys.core).not.toBeNull();
    expect(s.g.scene.children).toContain(s.sys.root);
    expect(s.calls.registered).toBe(4); // three generator bodies + the core with the level culler
    expect(s.g.sectionModelKeys[0](s.layout!)).toEqual([BUNKER_OBJECTIVE_MODELS.generator, BUNKER_OBJECTIVE_MODELS.switchgear, BUNKER_OBJECTIVE_MODELS.console]);
    expect(Object.values(BUNKER_OBJECTIVE_MODELS)).toEqual(['reactor-generator', 'reactor-switchgear', 'reactor-controlConsole']);
    const roots = s.pools['bunker-objective']();
    expect(roots).toEqual([s.sys.root]);
    let pour = false;
    roots[0].traverse(o => { if (o.name === 'fuel-pour') pour = true; });
    expect(pour).toBe(true);
    expect(s.sys.pourView!.root.visible).toBe(false);
    // every generator part sits inside the generator's footprint; the core's parts inside BUNKER_CORE_DIMS (no models in Node)
    for (const v of s.sys.gens) {
      v.root.updateMatrixWorld(true);
      const b = new THREE.Box3();
      v.body.traverse(o => { if ((o as THREE.Mesh).isMesh) b.expandByObject(o); });
      const local = b.clone().applyMatrix4(v.root.matrixWorld.clone().invert());
      expect(local.max.z).toBeLessThan(BUNKER_GENERATOR_DIMS.d / 2 + 0.15);
      expect(local.max.x).toBeLessThan(BUNKER_GENERATOR_DIMS.w / 2);
      expect(local.min.y).toBeGreaterThan(1);
      v.root.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(typeof o.userData.level).toBe('number'); });
    }
    const core = s.sys.core!;
    core.root.updateMatrixWorld(true);
    const cb = new THREE.Box3().setFromObject(core.root).applyMatrix4(core.root.matrixWorld.clone().invert());
    expect(cb.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(cb.max.y).toBeLessThanOrEqual(BUNKER_CORE_DIMS.h + 1e-6);
    expect(Math.max(-cb.min.x, cb.max.x)).toBeLessThanOrEqual(BUNKER_CORE_DIMS.w / 2 + 1e-6);
    expect(Math.max(-cb.min.z, cb.max.z)).toBeLessThanOrEqual(BUNKER_CORE_DIMS.d / 2 + 1e-6);
    expect(CORE_LAYOUT.screen.y + CORE_LAYOUT.screen.h / 2).toBeLessThan(BUNKER_CORE_DIMS.h);
    // the panel is left of the model's control box (x 1.54 .. 2.35), on the body face
    expect(GEN_PANEL.cx + GEN_PANEL.w / 2).toBeLessThan(1.54);
    expect(GEN_AIM.x1).toBeGreaterThan(2.35);
    // the hold / reach / noise are the Reactor generator's
    expect(BUNKER_GEN.HOLD_S).toBe(REACTOR_GEN.HOLD_S);
    expect(BUNKER_GEN.MOVE_CANCEL_M).toBe(REACTOR_GEN.MOVE_CANCEL_M);
    expect(BUNKER_GEN.REACH_M).toBe(REACTOR_GEN.REACH_M);
    expect(BUNKER_GEN.ALERT_START_M).toBe(REACTOR_GEN.ALERT_START_M);
    // teardown removes it all and saves the record
    s.teardown();
    expect(s.g.scene.children.length).toBe(0);
    expect(s.lane()).toEqual({v: 1, gens: {'gen-0': 'off', 'gen-1': 'off', 'gen-2': 'off'}});
  });

  it('game.ts installs it with one line; the runtime never touches the Reactor\'s state, visuals or win', () => {
    const game = src('../src/game.ts');
    expect(game.match(/installBunkerObjective\(this\)/g)?.length).toBe(1);
    for (const f of ['../src/world/bunker/objective.ts', '../src/world/bunker/objectiveViews.ts', '../src/world/bunker/objectiveState.ts', '../src/world/bunker/coreScreen.ts']) {
      const code = src(f).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
      expect(code, f).not.toMatch(/reactorVisuals|REACTOR_LANE|'reactor\.state'|layout\.reactor|\.reactor\s*\?|setTierPower|reactorClearAll|onCampaignWin|WinSequence|milestone|registerReactorArchVisuals/);
    }
  });
});

describe('bunker objective: the fuel pour (exactly one can, only on success)', () => {
  it('aim + prompt; one press pours; nothing is used before the end; exactly one can, then FUELLED (saved at once)', () => {
    const s = shell();
    s.give(2);
    s.standAtGen(0);
    s.step();
    expect(s.sys.target).toMatchObject({kind: 'gen', index: 0});
    expect(s.prompt()).toBe('<b>[E]</b> Pour a fuel can · auxiliary generator A (Habitation plant room) · 2 cans');
    expect(s.press()).toBe(true);
    expect(s.sys.pour).not.toBeNull();
    expect(s.calls.pour).toBe(1);
    expect(s.g.inputOwners.some(f => f())).toBe(true); // no fire / ADS / use while pouring
    expect(s.click()).toBe(true); // every left press is the pour's (Game consumes + latches it)
    expect(s.press()).toBe(true); // a second E on the generator: consumed, nothing new
    s.step(FUEL_PORT.pourS * 0.5);
    expect(s.prompt()).toMatch(/^<b>Pouring fuel…<\/b> (49|50) %$/);
    expect(s.sys.gens[0].uncapped).toBe(true);
    expect(s.sys.pourView!.root.visible).toBe(true);
    expect(s.cans()).toBe(2);
    expect(s.sys.genState(0)).toBe('off');
    s.step(FUEL_PORT.pourS * 0.5 + 0.05);
    expect(s.sys.pour).toBeNull();
    expect(s.cans()).toBe(1);
    expect(s.sys.genState(0)).toBe('fuelled');
    expect(s.lane()!.gens['gen-0']).toBe('fuelled');
    expect(s.sys.counts.pours).toBe(1);
    expect(s.calls.pour).toBe(1);
    expect(s.sys.gens[0].uncapped).toBe(false);
    expect(s.sys.pourView!.root.visible).toBe(false);
    expect(s.g.inputOwners.some(f => f())).toBe(false);
    expect(s.toasts.at(-1)!.text).toBe('Fuel in — auxiliary generator A fuelled · hold [E] to turn the key · 1 can left');
    expect(s.h.inv.invariants()).toEqual([]);
  });

  it('the visible pour runs in the pouring generator\'s frame: the can lifts from the hand, its stream goes into the panel\'s filler neck, the can stays in front of the body', () => {
    const s = shell();
    s.give(1);
    s.fuel(0); // (generator 0 first: the pour view then moves to generator 1's frame)
    s.give(1);
    s.standAtGen(1);
    s.step();
    expect(s.press()).toBe(true);
    const v = s.sys.pourView!, gen = s.sys.gens[1];
    expect(v.root.parent).toBe(gen.pourFrame);
    s.step(POUR_VIEW.liftS + POUR_VIEW.tiltS + 0.4);
    expect(v.qa()).toMatchObject({active: true, phase: 'pour', visible: true, stream: true});
    const ends = v.streamEnds()!;
    const mouth = genNeckMouth();
    // pour frame -> generator frame: (x, y, z) -> (-x, y, -z); the stream ends just inside the neck's mouth
    expect(-ends.to.x).toBeCloseTo(mouth.x, 2);
    expect(ends.to.y).toBeCloseTo(mouth.y, 2);
    expect(-ends.to.z).toBeLessThan(mouth.z);
    expect(-ends.to.z).toBeGreaterThan(mouth.z - 0.02);
    expect(ends.from.y).toBeGreaterThan(mouth.y); // from the spout above
    gen.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(v.can).applyMatrix4(gen.root.matrixWorld.clone().invert());
    expect(b.min.z).toBeGreaterThan(GEN_PANEL.bodyZ - 0.01);
    expect((b.min.z + b.max.z) / 2).toBeGreaterThan(GEN_PANEL.frontZ + 0.04);
    s.step(FUEL_PORT.pourS);
    expect(v.qa().visible).toBe(false);
    expect(s.sys.genState(1)).toBe('fuelled');
  });

  it('a can in the hand + left click pours; the hand\'s can is the one used (a pocket can stays)', () => {
    const s = shell();
    const pocket = s.give(1, 'pack', 0);
    s.give(1, 'hotbar', 2);
    s.standAtGen(1);
    s.step();
    s.h.inv.select(0); // empty hand: not ours
    expect(s.click()).toBe(false);
    s.h.inv.select(2);
    expect(s.click()).toBe(true);
    s.step(FUEL_PORT.pourS + 0.05);
    expect(s.sys.genState(1)).toBe('fuelled');
    expect(s.h.inv.hotbar[2]).toBeNull();
    expect(pocket.count).toBe(1);
    expect(s.calls.sync).toBe(1);
  });

  it('refusals (no can, a can only in the worn backpack, hands busy, riding): a toast, nothing used, no pour', () => {
    const s = shell();
    s.standAtGen(0);
    s.step();
    expect(s.prompt()).toBe('<b>[E]</b> Auxiliary generator A (Habitation plant room) · no fuel — needs one fuel can');
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)).toEqual({text: 'No fuel can', warn: true});
    const bag = s.h.inv.makeStack('backpack', 1);
    expect(s.h.inv.add(bag)).toBe(0);
    const inBag = s.h.inv.makeStack(FUEL.canItem, 2);
    inBag.count = 2;
    bag.bag![0] = inBag;
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)!.text).toBe('No fuel can at hand — the ones in your backpack need it set down');
    s.give(1);
    s.g.gear.readied = true;
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)!.text).toBe('Hands busy');
    s.g.gear.readied = false;
    s.g.trainRide.riding = true;
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)!.text).toBe('Not while moving');
    s.g.trainRide.riding = false;
    expect(s.sys.pour).toBeNull();
    expect(s.calls.pour).toBe(0);
    expect(s.calls.denied).toBe(4);
    expect(s.cans()).toBe(1);
    expect(inBag.count).toBe(2);
    expect(s.sys.genState(0)).toBe('off');
    // with the pocket can: poured, the bag's stay
    expect(s.press()).toBe(true);
    s.step(FUEL_PORT.pourS + 0.05);
    expect(s.sys.genState(0)).toBe('fuelled');
    expect(inBag.count).toBe(2);
    expect(s.cans()).toBe(0);
  });

  it('every cancel (hit, sprint, walking off, looking away, a menu, input cleared, riding, the generator fuelled meanwhile, teardown) uses NOTHING', () => {
    const cases: [string, (s: ReturnType<typeof shell>) => void][] = [
      ['hit', s => { for (const f of s.g.hitListeners) f({amount: 12}); }],
      ['sprint', s => { s.g.player.sprinting = true; }],
      ['away', s => { s.standAtGen(0, 2.5); }],
      ['away', s => { s.lookAway(); }],
      ['menu', s => { s.setState('paused'); }],
      ['menu', s => { s.g.input.clears++; }],
      ['riding', s => { s.g.trainRide.riding = true; }],
      ['busy', s => { s.g.player.climbing = true; }],
      ['state', s => { s.sys.state!.gens['gen-0'] = 'fuelled'; }],
      ['teardown', s => { s.teardown(); }],
    ];
    for (const [why, act] of cases) {
      const s = shell();
      s.give(2);
      s.standAtGen(0);
      s.step();
      expect(s.press(), why).toBe(true);
      s.step(0.8);
      act(s);
      s.step(FUEL_PORT.awayGraceS + 0.1);
      s.step(FUEL_PORT.pourS);
      expect(s.sys.pour, why).toBeNull();
      expect(s.sys.lastCancel, why).toBe(why);
      expect(s.cans(), why).toBe(2);
      expect(s.calls.stopPour, why).toBe(1);
      expect(s.sys.counts.pours, why).toBe(0);
      if (why !== 'state') expect(s.lane()?.gens['gen-0'] ?? 'off', why).toBe('off');
      if (['hit', 'away', 'sprint'].includes(why)) expect(s.toasts.at(-1)!.text, why).toBe('Pour stopped — nothing used');
    }
    // a glance off shorter than the grace does not cancel
    const s = shell();
    s.give(1);
    s.standAtGen(0);
    s.step();
    s.press();
    s.step(0.4);
    s.lookAway();
    s.step(FUEL_PORT.awayGraceS - 0.1);
    s.standAtGen(0);
    s.step(FUEL_PORT.pourS);
    expect(s.sys.genState(0)).toBe('fuelled');
    expect(s.cans()).toBe(0);
  });

  it('no source at completion (the can dropped mid-pour): refused, nothing taken, still OFF; double presses never start a second pour', () => {
    const s = shell();
    s.give(1);
    s.standAtGen(0);
    s.step();
    s.press();
    s.step(0.6);
    expect(s.h.inv.take(FUEL.canItem, 1)).toBe(1); // e.g. dropped from the inventory screen
    s.step(FUEL_PORT.pourS);
    expect(s.sys.pour).toBeNull();
    expect(s.toasts.at(-1)).toEqual({text: 'No fuel can', warn: true});
    expect(s.sys.genState(0)).toBe('off');
    expect(s.sys.counts.pours).toBe(0);
    // double press / held LMB: one pour, one can
    s.give(2);
    s.give(1, 'hotbar', 1);
    s.h.inv.select(1);
    s.step();
    expect(s.press()).toBe(true);
    for (let i = 0; i < 20; i++) { expect(s.click()).toBe(true); expect(s.press()).toBe(true); s.step(0.05); }
    s.step(FUEL_PORT.pourS);
    expect(s.calls.pour).toBe(2); // the first (dropped) attempt + this one
    expect(s.sys.counts.pours).toBe(1);
    expect(s.cans()).toBe(2);
    expect(s.sys.genState(0)).toBe('fuelled');
    // the button still held with another can in the hand: a refusal at the fuelled generator, never a second pour / debit
    s.give(1, 'hotbar', 1);
    expect(s.cans()).toBe(3);
    expect(s.click()).toBe(true);
    expect(s.toasts.at(-1)!.text).toBe('Auxiliary generator A is already fuelled — hold [E] to turn the key');
    expect(s.sys.pour).toBeNull();
    s.step(FUEL_PORT.pourS);
    expect(s.cans()).toBe(3);
    expect(s.sys.counts.pours).toBe(1);
  });
});

describe('bunker objective: the turnkey start', () => {
  it('hold [E] on a FUELLED generator -> ONLINE (saved): the ring, the key turns, the start clip, one alert, cranking then running', () => {
    const s = shell();
    s.give(1);
    s.fuel(0);
    s.step();
    expect(s.prompt()).toBe('<b>Hold [E]</b> Turn the key — start auxiliary generator A');
    keys.add('KeyE');
    expect(s.press()).toBe(true);
    expect(s.g.inputOwners.some(f => f())).toBe(true);
    s.step(1);
    expect(s.sys.holdProgress).toBeCloseTo(0.5, 1);
    expect(s.sys.gens[0].qa().key).toBeGreaterThan(0.4);
    expect(s.rings.some(r => r !== null && r > 0.4)).toBe(true);
    s.step(BUNKER_GEN.HOLD_S - 1 + 0.05);
    keys.delete('KeyE');
    expect(s.sys.genState(0)).toBe('online');
    expect(s.lane()!.gens['gen-0']).toBe('online');
    expect(s.sys.counts.starts).toBe(1);
    expect(s.calls.cues).toBe(1);
    expect(s.rings.at(-1)).toBeNull();
    expect(s.sys.gens[0].qa().key).toBe(1);
    expect(s.sys.gens[0].qa().vibrating).toBe(true);
    expect(s.toasts.at(-1)!.text).toBe('Auxiliary generator A started — auxiliary power 1/3. The noise will draw the infected.');
    s.step(BUNKER_GEN.LOOP_AFTER_S + 0.6);
    expect(s.sys.gens[0].qa().lamp).toBe(`#${new THREE.Color(0.2, 1.0, 0.32).getHexString()}`);
    expect(s.calls.loops).toBe(1);
    expect(s.calls.smoke).toBe(1);
    expect(s.prompt()).toBe('Auxiliary generator A running · auxiliary power 1/3');
  });

  it('a cancelled start leaves it FUELLED and costs nothing; the next start is free; ONLINE takes no more fuel (no refund, no duplicate)', () => {
    const s = shell();
    s.give(3);
    s.fuel(0);
    expect(s.cans()).toBe(2);
    for (const cancel of [() => keys.delete('KeyE'), () => s.lookAway(), () => { s.g.player.x += 0.6; }, () => s.setState('paused'), () => { s.g.input.clears++; }]) {
      if (s.g.state !== 'playing') s.setState('playing');
      s.standAtGen(0);
      s.step();
      keys.add('KeyE');
      expect(s.press()).toBe(true);
      s.step(1);
      cancel();
      s.step(BUNKER_GEN.HOLD_S);
      keys.delete('KeyE');
      expect(s.sys.hold).toBeNull();
      expect(s.sys.genState(0)).toBe('fuelled');
      expect(s.cans()).toBe(2);
      expect(s.sys.gens[0].qa().key).toBe(0);
    }
    if (s.g.state !== 'playing') s.setState('playing');
    expect(s.sys.counts.holdCancels).toBe(5);
    s.startGen(0);
    expect(s.sys.genState(0)).toBe('online');
    expect(s.cans()).toBe(2); // the start never charges anything
    // online: E and a held can refuse; nothing used, nothing changes
    s.standAtGen(0);
    s.step();
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)).toEqual({text: 'Auxiliary generator A is running — it needs no more fuel', warn: true});
    s.give(1, 'hotbar', 0);
    s.h.inv.select(0);
    expect(s.click()).toBe(true);
    s.step(FUEL_PORT.pourS + 0.1);
    expect(s.cans()).toBe(3);
    expect(s.sys.counts.pours).toBe(1);
    expect(s.sys.counts.starts).toBe(1);
    expect(s.lane()).toEqual({v: 1, gens: {'gen-0': 'online', 'gen-1': 'off', 'gen-2': 'off'}});
    expect(s.sys.start(0)).toBe(false); // no second start
    expect(s.calls.cues).toBe(1);
  });
});

describe('bunker objective: the core and the intel claim', () => {
  it('gated by all three: low power reads the diagnostic (no claim); all online -> alive screen, E claims the Reactor\'s location ONCE', () => {
    const s = shell();
    s.give(3);
    for (let i = 0; i < 2; i++) { s.fuel(i); s.startGen(i); }
    s.standAtCore();
    s.step();
    expect(s.sys.target).toMatchObject({kind: 'core'});
    expect(s.prompt()).toBe('<b>[E]</b> Read the core terminal · auxiliary power 2/3');
    expect(s.sys.core!.brightness).toBeCloseTo(0.5);
    expect(s.press()).toBe(true);
    expect(s.sys.readOpen).toBe(true);
    expect(s.sys.state!.intel).toBeUndefined();
    expect(s.prompt()).toBe('<b>[E]</b> Close the core terminal');
    expect(s.press()).toBe(true);
    expect(s.sys.readOpen).toBe(false);
    expect(s.sys.counts.claims).toBe(0);
    s.fuel(2);
    s.startGen(2);
    expect(s.sys.alive).toBe(true);
    expect(s.toasts.at(-1)!.text).toMatch(/auxiliary power 3\/3: the core is powered/);
    const c0 = s.h.run.campaign!, visited = c0.visited.slice(), current = c0.current;
    expect(c0.known.includes(c0.network.reactor)).toBe(false);
    s.standAtCore();
    s.step();
    expect(s.sys.core!.brightness).toBeCloseTo(0.95);
    expect(s.prompt()).toBe('<b>[E]</b> Retrieve map intel from the core');
    expect(s.press()).toBe(true);
    const c1 = s.h.run.campaign!;
    expect(s.sys.state!.intel).toMatchObject({kind: 'reactor', nodeId: c1.network.reactor});
    expect(c1.known).toEqual([...c0.known, c1.network.reactor]);
    expect(c1.visited).toEqual(visited); // knowledge only: never visited / current / transit
    expect(c1.current).toBe(current);
    expect(c1.transit).toBeNull();
    expect(s.lane()!.intel).toEqual(s.sys.state!.intel);
    expect(s.toasts.at(-1)!.text).toMatch(/^Map intel retrieved — Reactor located: .+ is now on your map$/);
    // repeated E: open / close the read, never a second claim
    for (let i = 0; i < 10; i++) { s.press(); s.step(); }
    expect(s.sys.counts.claims).toBe(1);
    expect(s.h.run.campaign!.known.length).toBe(c0.known.length + 1);
    expect(s.sys.claim()).toEqual(s.sys.state!.intel);
    expect(s.sys.counts.claims).toBe(1);
  });

  it('the next tier when the Reactor is known (no Markets on this network: an unknown other node); charted when all is known', () => {
    const net = fixtureCampaign().network;
    const s = shell({campaign: fixtureCampaign({current: BUNKER, known: [sid(0), BUNKER, net.reactor], visited: [sid(0), BUNKER]})});
    s.give(3);
    for (let i = 0; i < 3; i++) { s.fuel(i); s.startGen(i); }
    s.standAtCore();
    s.step();
    s.press();
    const intel = s.sys.state!.intel!;
    expect(intel.kind).toBe('node');
    expect([sid(0), BUNKER, net.reactor]).not.toContain(intel.nodeId);
    expect(s.h.run.campaign!.known).toContain(intel.nodeId);
    const all = shell({campaign: fixtureCampaign({current: BUNKER, known: net.nodes.map(n => n.id), visited: [sid(0), BUNKER]})});
    all.give(3);
    for (let i = 0; i < 3; i++) { all.fuel(i); all.startGen(i); }
    all.standAtCore();
    all.step();
    all.press();
    expect(all.sys.state!.intel).toMatchObject({kind: 'charted'});
    expect(all.sys.state!.intel!.nodeId).toBeUndefined();
    expect(all.toasts.at(-1)!.text).toMatch(/already charted/);
  });

  it('a campaign-less run: "No network uplink", nothing claimed, no crash', () => {
    const s = shell({campaign: null});
    s.give(3);
    for (let i = 0; i < 3; i++) { s.fuel(i); s.startGen(i); }
    s.standAtCore();
    s.step();
    expect(s.prompt()).toBe('<b>[E]</b> Core terminal · no network uplink');
    expect(s.press()).toBe(true);
    expect(s.toasts.at(-1)).toEqual({text: 'No network uplink — the core cannot reach a station network', warn: true});
    expect(s.sys.state!.intel).toBeUndefined();
    expect(s.sys.counts.noUplink).toBe(1);
    expect(s.sys.readOpen).toBe(true);
  });
});

describe('bunker objective: persistence (save / load, Retry, revisit, other stations)', () => {
  it('only ever writes BUNKER_LANE; teardown + rebuild (a revisit) restores generators and the claim without re-claiming', () => {
    const s = shell();
    s.give(3);
    s.fuel(0);
    s.startGen(0);
    s.fuel(1);
    s.teardown();
    expect(new Set(s.lanesWritten)).toEqual(new Set([BUNKER_LANE]));
    s.build();
    expect([0, 1, 2].map(i => s.sys.genState(i))).toEqual(['online', 'fuelled', 'off']);
    expect(s.sys.gens[0].qa().key).toBe(1); // restored running: no re-crank
    expect(s.calls.cues).toBe(1);
    s.startGen(1);
    s.fuel(2);
    s.startGen(2);
    s.standAtCore(); s.step(); s.press();
    const intel = structuredClone(s.sys.state!.intel);
    s.teardown();
    s.build();
    expect(s.sys.state!.intel).toEqual(intel);
    s.standAtCore(); s.step(); s.press(); s.press(); s.press();
    expect(s.sys.counts.claims).toBe(1);
    expect(new Set(s.lanesWritten)).toEqual(new Set([BUNKER_LANE]));
    expect((s.layout as {reactor?: unknown}).reactor).toBeUndefined();
  });

  it('save -> text -> load round trip: generators + claim exact; the knowledge re-unioned on build; no re-claim, no re-roll', () => {
    const s = shell();
    s.give(4);
    for (let i = 0; i < 3; i++) { s.fuel(i); s.startGen(i); }
    s.standAtCore(); s.step(); s.press();
    const intel = structuredClone(s.sys.state!.intel!);
    s.teardown();
    const file = s.h.file('arrival', 1);
    const p = parseSaveText(saveFileText(file));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    const data = structuredClone((p as {value: SaveFileV1Like}).value.run);
    // a loaded campaign that (somehow) lost the revealed station gets it back on the build (the claim is the record of it)
    data.campaign!.known = data.campaign!.known.filter(k => k !== intel.nodeId);
    restoreRun(data, s.h.target());
    s.h.run.current = {level: 'subway', section: 'main', station: BUNKER};
    expect(s.cans()).toBe(1);
    expect(s.h.run.campaign!.known).not.toContain(intel.nodeId);
    s.build();
    expect(s.h.run.campaign!.known).toContain(intel.nodeId);
    expect([0, 1, 2].map(i => s.sys.genState(i))).toEqual(['online', 'online', 'online']);
    expect(s.sys.state!.intel).toEqual(intel);
    s.standAtCore(); s.step(); s.press(); s.press(); s.press();
    expect(s.sys.counts.claims).toBe(1);
    expect(s.sys.state!.intel).toEqual(intel);
  });

  it('Retry: the entry snapshot\'s memory + inventory come back together (cans back, generators off); the claim stays (no re-claim / farm)', () => {
    const s = shell();
    s.give(3);
    s.h.takeEntry(); // as Game.levelEntrySnapshot right after the build: 3 cans, everything off
    const known0 = s.h.run.campaign!.known.length;
    for (let i = 0; i < 3; i++) { s.fuel(i); s.startGen(i); }
    expect(s.cans()).toBe(0);
    s.standAtCore(); s.step(); s.press();
    const intel = structuredClone(s.sys.state!.intel!);
    expect(intel.kind).toBe('reactor');
    // Retry (game.ts retryLevel): teardown, the station's memories from the snapshot, the carry state from the snapshot, rebuild
    const retry = () => {
      const snap = s.h.run.entry!;
      s.teardown();
      s.h.run.restoreScopeMemories(s.h.run.current, snap.memories);
      const inv = restoreCarry(snap, {player: s.h.player, survival: s.h.survival, battery: s.h.battery, stats: s.h.stats});
      s.h.inv.loadJSON(inv.toJSON());
      s.build();
    };
    retry();
    expect(s.cans()).toBe(3); // the pair is consistent: every can poured after the entry is back ...
    expect([0, 1, 2].map(i => s.sys.genState(i))).toEqual(['off', 'off', 'off']); // ... and so is every generator
    expect(s.sys.state!.intel).toEqual(intel); // the claim (knowledge, which Retry never takes back) stays
    expect(s.h.run.campaign!.known.length).toBe(known0 + 1);
    // power it again: the core shows the claim; E never re-claims (no second reveal, no reroll)
    for (let i = 0; i < 3; i++) { s.fuel(i); s.startGen(i); }
    s.standAtCore(); s.step(); s.press();
    expect(s.sys.counts.claims).toBe(1);
    expect(s.sys.state!.intel).toEqual(intel);
    expect(s.h.run.campaign!.known.length).toBe(known0 + 1);
    // and a second Retry still keeps it
    retry();
    expect(s.sys.state!.intel).toEqual(intel);
    expect(s.cans()).toBe(3);
  });

  it('Bunker stations are independent: another station starts fresh and its claim takes the next tier; no cross-station leakage', () => {
    const s = shell();
    s.give(6);
    for (let i = 0; i < 3; i++) { s.fuel(i); s.startGen(i); }
    s.standAtCore(); s.step(); s.press();
    const a = structuredClone(s.sys.state!.intel!);
    s.teardown();
    const other = {level: 'subway' as const, section: 'main', station: sid(4)};
    s.h.run.current = other;
    s.build();
    expect([0, 1, 2].map(i => s.sys.genState(i))).toEqual(['off', 'off', 'off']);
    expect(s.sys.state!.intel).toBeUndefined();
    for (let i = 0; i < 3; i++) { s.fuel(i); s.startGen(i); }
    s.standAtCore(); s.step(); s.press();
    const b = s.sys.state!.intel!;
    expect(a.kind).toBe('reactor');
    expect(b.kind).toBe('node');
    expect(b.nodeId).not.toBe(a.nodeId);
    s.teardown();
    expect(s.h.run.laneStore<BunkerStateJSON>(BUNKER_LANE, {level: 'subway', section: 'main', station: BUNKER})!.intel).toEqual(a);
    expect(s.h.run.laneStore<BunkerStateJSON>(BUNKER_LANE, other)!.intel).toEqual(b);
    expect(s.cans()).toBe(0);
  });

  it('a pause mid-hold cancels it; the read closes when walking off; the core screen redraws only on change / near', () => {
    const s = shell();
    s.give(1);
    s.fuel(0);
    s.standAtGen(0);
    s.step();
    keys.add('KeyE');
    s.press();
    s.step(0.5);
    s.setState('paused');
    expect(s.sys.hold).toBeNull();
    keys.delete('KeyE');
    s.setState('playing');
    expect(s.sys.genState(0)).toBe('fuelled');
    s.standAtCore();
    s.step();
    s.press();
    expect(s.sys.readOpen).toBe(true);
    s.standAtGen(0);
    s.step();
    expect(s.sys.readOpen).toBe(false);
    // far from the core: a static face (no animation redraws)
    s.g.player.x += 200;
    s.step(0.1);
    const r0 = s.sys.core!.redraws;
    s.step(3);
    expect(s.sys.core!.redraws).toBe(r0);
    // near (low power): the cursor blinks once a second
    s.standAtCore();
    s.step(3);
    const r1 = s.sys.core!.redraws;
    expect(r1 - r0).toBeGreaterThanOrEqual(2);
    expect(r1 - r0).toBeLessThanOrEqual(5);
    expect(BUNKER_CORE.ALIVE_FPS).toBe(4);
  });
});
