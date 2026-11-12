// Task studio-first-player-onboarding-20261111-234657-01: the first-player onboarding at the player's train (world/trainOnboarding.ts)
// and its browser-global record (ui/onboardingStore.ts) + the "Reset tutorials" button (ui/mainMenu.ts mountTutorialReset), on generated
// stations of every level with a parked train (the registry) with the REAL train runtime (world/playerTrain.ts) and a fake Game host:
//  - the record: completion persists once across reloads / tabs, garbage reads as not done, a reset removes ONLY its own key (save slots,
//    the last-slot pointer, settings, milestones untouched), storage failures keep it for the session, the save code never reads it;
//  - placement: seven markers in order — the four fixture labels above the fuel cap / console / chipper hopper / ORIGINAL Lockbox, inside
//    their compartments (or outside the skin, the fuel cap) at every yaw they can turn to, arrows aimed at the fixtures; the three platform
//    labels on walkable platform floor with headroom, clear of props (never the unchecked fallback spot), above head height, near the car;
//  - activation / dismissal: shown at a parked train; walking anywhere inside the car never completes it; only after being presented
//    (active play, near, on screen, in sight: walls / partitions / props block, the car's window glass does not; no lane owning the
//    input) does the first walk 10 m from the car complete it — all seven go together (materials disposed) and stay gone for new
//    runtimes / stores over the same storage; menus / loading / an import far from the train / looking away / riding never consume it;
//  - reset re-arms the current train at once; another tab's completion hides them here, its reset shows them again; a reload that
//    changes nothing keeps the presentation progress;
//  - nonblocking: no layout.props / propIndex change, no shadows, no raycast hits, the console / Lockbox aim still works through them;
//  - the label atlas: one font size for all, opaque plates with transparent corners, keycaps for keys.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ShimCanvas, installCanvasShim} from './helpers/canvas2d';
import {MiniEl, MiniEvent, installMiniDom} from './helpers/paperMapDom';
import {FakeStorage} from './helpers/saveFixture';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import type {LevelId} from '../src/levels/types';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import type {PropPlacement} from '../src/gen/props';
import {playerTrainPlacement, trainSpawnPose, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PARTITION_HALF, PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {installPlayerTrain, type PlayerTrainRuntime, type TrainHost} from '../src/world/playerTrain';
import {fuelPortLocal} from '../src/fuel/trainPort';
import {consoleLocalRect} from '../src/world/trainConsole';
import {chipperFootprint, chipperPlacement} from '../src/world/chipperPlace';
import {lockboxFootprint} from '../src/world/trainLockbox';
import {ONBOARDING, ONBOARDING_MARKERS, TrainOnboarding, arrowGeometry, arrowPose, drawLabelAtlas, installTrainOnboarding, labelRuns, labelYaw,
  trainAreaDistance, type MarkerPose, type OnboardingHost} from '../src/world/trainOnboarding';
import {OnboardingStore, parseOnboarding, serializeOnboarding} from '../src/ui/onboardingStore';
import {mountTutorialReset} from '../src/ui/mainMenu';
import {STORAGE_KEYS} from '../src/campaign/types';
import {MILESTONES_KEY} from '../src/run/milestones';

installCanvasShim(false);

const DT = 1 / 30;
const KEY = STORAGE_KEYS.onboarding;
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const layouts = new Map<string, StationLayout>();
const layoutOf = (level: LevelId, levelSeed = 4242): StationLayout => {
  const k = `${level}:${levelSeed}`;
  let l = layouts.get(k);
  if (!l) layouts.set(k, (l = LEVELS[level].generate(LEVELS[level].entry, {levelSeed})));
  return l;
};

/** Every built world: torn down after each test (the layouts / levels are cached). */
const live: {host: Host}[] = [];
afterEach(() => { for (const w of live.splice(0)) for (const s of [...w.host.sectionHooks].reverse()) s.teardown?.(); });

function makeHost(layout: StationLayout) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(layout);
  const host = {
    scene, camera, player: new Player(), zombies: [] as TrainHost['zombies'], levels, layout, propIndex: new PropIndex(levels, layout.props),
    trainPlacement: playerTrainPlacement(layout) as TrainPlacement | null, sfx: null, hud: {toast: () => {}}, warmRegistry: new WarmupRegistry(),
    physics: {propsChanged: () => {}}, interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[],
    stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    state: 'playing', world: {culler: {register: () => {}}}, input: {down: () => false}, run: {current: {level: 'subway', section: 'main'}},
    trainRuntime: null as PlayerTrainRuntime | null, inputOwners: [] as (() => boolean)[],
  } satisfies TrainHost & OnboardingHost;
  return host;
}
type Host = ReturnType<typeof makeHost>;

/** A built station: the real train + the onboarding over `storage`, the player spawned inside the car facing the platform door. */
function world(level: LevelId = 'subway', storage: FakeStorage = new FakeStorage()) {
  const layout = layoutOf(level);
  const host = makeHost(layout);
  const p = host.trainPlacement!;
  expect(p, `${level}: the train is placed`).not.toBeNull();
  host.trainRuntime = installPlayerTrain(host);
  const store = new OnboardingStore(storage);
  const ob = installTrainOnboarding(host, store);
  live.push({host});
  for (const s of host.sectionHooks) s.build?.(layout);
  const sp = trainSpawnPose(layout, p);
  host.player.spawn(sp.x, sp.z, sp.yaw, sp.y);
  sync(host);
  return {host, p, store, ob, storage, layout};
}

function sync(h: Host): void {
  const P = h.player;
  h.camera.position.set(P.x, P.y + STAND_EYE, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  h.camera.updateMatrixWorld(true);
}
/** Frames of the lane hooks (the player stays put unless `move` places it). */
function run(h: Host, seconds: number, move?: (t: number) => void): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) { move?.(t); sync(h); for (const f of h.frameHooks) f(DT); }
}
/** Stand at a train-local point (feet at local y, default the car / platform floor) looking at another (level look, or pitch). */
function standAt(h: Host, p: TrainPlacement, at: {x: number; z: number; y?: number}, look: {x: number; z: number}, pitch = 0): void {
  const w = trainToWorld(p, at.x, at.y ?? SPEC.floorY, at.z), l = trainToWorld(p, look.x, 0, look.z);
  h.player.x = w.x; h.player.y = w.y; h.player.z = w.z;
  h.player.yaw = Math.atan2(-(l.x - w.x), -(l.z - w.z));
  h.player.pitch = pitch;
  sync(h);
}
const onboardingRoots = (s: THREE.Scene) => s.children.filter(o => o.name === 'train-onboarding');
/** A solid crate box (pushed into layout.props by a test, removed again in its finally). */
const solidBox = (p: TrainPlacement, x: number, y: number, z: number, hx: number, hz: number, h: number): PropPlacement =>
  ({kind: 'crate', x, z, y, rot: 0, area: -1, hx, hz, h, blocksSight: true, variant: 0, level: p.level});
/** In the saloon aisle, looking at the chipper's label (in plain sight). */
function lookAtChipper(h: Host, ob: TrainOnboarding): void {
  const p = h.trainPlacement!, q = ob.view!.markers.find(m => m.pose.id === 'chipper')!.pose;
  standAt(h, p, {x: q.label.x - 3, z: -0.4}, {x: q.label.x, z: q.label.z}, Math.atan2(q.label.y - SPEC.floorY - STAND_EYE, 3) * 0.9);
}

// =============================================================================================
describe('onboarding record (browser-global, never in a save)', () => {
  it('completion persists once and is seen by every later store over the same storage (reloads, tabs, new saves)', () => {
    const st = new FakeStorage();
    const a = new OnboardingStore(st);
    expect(a.isDone('train')).toBe(false);
    expect(a.complete('train', new Date('2026-11-12T01:02:03Z'))).toBe(true);
    expect(a.complete('train', new Date('2027-01-01T00:00:00Z')), 'a second completion keeps the first').toBe(false);
    expect(JSON.parse(st.getItem(KEY)!)).toEqual({v: 1, done: {train: '2026-11-12T01:02:03.000Z'}});
    const b = new OnboardingStore(st);
    expect(b.isDone('train')).toBe(true);
    expect(b.completedAt('train')).toBe('2026-11-12T01:02:03.000Z');
    expect(KEY).toBe('terminal-state.onboarding.v1');
    expect(KEY.startsWith('terminal-state.')).toBe(true);
    for (let n = 1; n <= 3; n++) expect(KEY).not.toBe(STORAGE_KEYS.slot(n));
  });

  it('garbage / unknown ids / bad dates read as not done; serialize round-trips', () => {
    for (const t of [null, '', '{', '[]', '"x"', '{"done":[]}', '{"done":{"train":5}}', '{"done":{"train":"not a date"}}', '{"done":{"other":"2026-01-01T00:00:00Z"}}']) {
      expect(parseOnboarding(t), String(t)).toEqual({});
    }
    expect(parseOnboarding(serializeOnboarding({train: '2026-11-12T00:00:00.000Z'}))).toEqual({train: '2026-11-12T00:00:00.000Z'});
    const st = new FakeStorage();
    st.setItem(KEY, '{"v":9,"done":{"train":"garbage"}}');
    expect(new OnboardingStore(st).isDone('train')).toBe(false);
  });

  it('a reset removes ONLY the onboarding key: save slots, last slot, settings, milestones and other keys stay byte-identical', () => {
    const st = new FakeStorage();
    const others: [string, string][] = [
      [STORAGE_KEYS.slot(1), '{"slot":1,"data":"a"}'], [STORAGE_KEYS.slot(2), '{"slot":2}'], [STORAGE_KEYS.slot(3), '{"broken":'],
      [STORAGE_KEYS.lastSlot, '2'], [STORAGE_KEYS.settings, '{"v":1,"fov":90}'], [MILESTONES_KEY, '{"reactorRestarted":{"at":"2026-11-01T00:00:00Z","levelSeed":1}}'],
      ['unrelated.app.key', 'keep me'],
    ];
    for (const [k, v] of others) st.setItem(k, v);
    const s = new OnboardingStore(st);
    s.complete('train');
    const events: string[] = [];
    s.subscribe(e => events.push(e.kind));
    s.reset();
    expect(st.map.has(KEY)).toBe(false);
    expect(s.isDone('train')).toBe(false);
    for (const [k, v] of others) expect(st.getItem(k), k).toBe(v);
    expect(st.map.size).toBe(others.length);
    expect(events).toEqual(['reset']);
    // no removeItem: an empty record instead (still not done)
    const map = new Map<string, string>([[KEY, serializeOnboarding({train: '2026-11-12T00:00:00.000Z'})]]);
    const noRemove = new OnboardingStore({getItem: k => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); }});
    noRemove.reset();
    expect(parseOnboarding(map.get(KEY)!)).toEqual({});
  });

  it('storage that throws: the state applies for the session (persistent false), never a crash', () => {
    const st = new FakeStorage();
    st.disabled = true;
    const s = new OnboardingStore(st);
    expect(s.persistent).toBe(false);
    expect(s.complete('train')).toBe(true);
    expect(s.isDone('train')).toBe(true);
    s.reset();
    expect(s.isDone('train')).toBe(false);
    const none = new OnboardingStore(null);
    expect(none.complete('train')).toBe(true);
    expect(none.persistent).toBe(false);
  });

  it('the save files never read or write it (browser-global, not part of an exported save)', () => {
    for (const f of ['../src/save/serialize.ts', '../src/save/slots.ts', '../src/save/validate.ts']) expect(src(f), f).not.toMatch(/onboarding/i);
    // the train runtime / game read the store, never the run state
    expect(src('../src/world/trainOnboarding.ts')).not.toMatch(/\brun\.(current|campaign|save)/);
  });
});

// =============================================================================================
/** The plate's two ends (train-local x / z) at a yaw. */
const ends = (q: MarkerPose, yaw: number) => {
  const w = ONBOARDING.label.w / 2, c = Math.cos(yaw), s = Math.sin(yaw);
  return [{x: q.label.x - w * c, z: q.label.z + w * s}, {x: q.label.x + w * c, z: q.label.z - w * s}];
};
const yawsOf = (q: MarkerPose) => Array.from({length: 13}, (_, i) => q.facing - q.swing + (2 * q.swing * i) / 12);

describe('onboarding placement (every level with a parked train)', () => {
  const placed: LevelId[] = [];
  for (const level of LEVEL_IDS) {
    it(`${level}: seven markers — four above the actual fixtures inside their compartments, three on the platform beside the car`, () => {
      if (!playerTrainPlacement(layoutOf(level))) return; // (no parked train at this level's entry: nothing to place — the count is checked below)
      placed.push(level);
      const {host, p, ob} = world(level);
      const poses = ob.view!.markers.map(m => m.pose);
      expect(poses.map(q => q.id)).toEqual(ONBOARDING_MARKERS.map(d => d.id));
      const by = Object.fromEntries(poses.map(q => [q.id, q])) as Record<string, MarkerPose>;
      const F = SPEC.floorY, I = SPEC.interior, H = ONBOARDING.label.h;
      // the fixture labels: under the ceiling, their ends inside their compartment at EVERY yaw they can turn to (seen from behind they
      // turn about the reversed facing: the same span of plate positions)
      const inside = (id: string, x0: number, x1: number) => {
        const q = by[id];
        expect(q.label.y + H / 2, `${id}: below the ceiling`).toBeLessThan(SPEC.ceilingY - 0.05);
        for (const yaw of yawsOf(q)) for (const e of ends(q, yaw)) {
          expect(e.x, `${level} ${id}: x in [${x0}, ${x1}] at yaw ${yaw.toFixed(2)}`).toBeGreaterThanOrEqual(x0 - 1e-6);
          expect(e.x).toBeLessThanOrEqual(x1 + 1e-6);
          expect(Math.abs(e.z), `${level} ${id}: inside the lining`).toBeLessThanOrEqual(I.halfWidth + 1e-6);
        }
      };
      inside('console', SPEC.cab.x0 + PARTITION_HALF, I.x1);
      inside('chipper', SPEC.rear!.x1 + PARTITION_HALF, SPEC.cab.x0 - PARTITION_HALF);
      inside('lockbox', I.x0, SPEC.rear!.x1 - PARTITION_HALF);
      // ... aimed at the actual fixtures: the arrow points at its target, stopping short of it; the targets are the fixtures
      const cr = consoleLocalRect(SPEC, host.trainRuntime!.consoleRect), ch = chipperPlacement(SPEC)!, cf = chipperFootprint(ch), lf = lockboxFootprint(SPEC.lockbox!);
      const within = (t: {x: number; z: number}, r: {x0: number; x1: number; z0: number; z1: number}) => t.x >= r.x0 && t.x <= r.x1 && t.z >= r.z0 && t.z <= r.z1;
      expect(within(by.console.target, cr) && Math.abs(by.console.target.y - cr.top) < 1e-3, 'the console desk top').toBe(true);
      expect(within(by.chipper.target, cf) && Math.abs(by.chipper.target.y - (F + 0.784)) < 0.01, 'the chipper hopper mouth').toBe(true);
      expect(within(by.lockbox.target, lf) && Math.abs(by.lockbox.target.y - (F + SPEC.lockbox!.height)) < 1e-3, 'the Lockbox lid').toBe(true);
      const cap = fuelPortLocal(SPEC);
      expect(by.fuel.target).toEqual(cap);
      for (const q of poses) {
        const a = arrowPose(q), toT = {x: q.target.x - a.tip.x, y: q.target.y - a.tip.y, z: q.target.z - a.tip.z}, d = Math.hypot(toT.x, toT.y, toT.z);
        expect(d, `${q.id}: the tip stops short of its target`).toBeGreaterThanOrEqual(ONBOARDING.arrow.gap - 1e-6);
        expect((toT.x * a.dir.x + toT.y * a.dir.y + toT.z * a.dir.z) / d, `${q.id}: aimed at it`).toBeGreaterThan(0.999);
        expect(a.len).toBeGreaterThanOrEqual(ONBOARDING.arrow.min - 1e-9);
        expect(a.len).toBeLessThanOrEqual(ONBOARDING.arrow.max + 1e-9);
        expect(a.tip.y, `${q.id}: the arrow hangs under its label`).toBeLessThan(q.label.y - H / 2);
      }
      // the fuel label: outside the platform-side skin at every yaw it can turn to, its plate above a standing eye on the platform and
      // its bottom below the head of the saloon window over the cap (it reads through the glass from inside)
      for (const yaw of yawsOf(by.fuel)) for (const e of ends(by.fuel, yaw)) expect(e.z, `fuel label outside the skin`).toBeLessThan(-SPEC.width / 2);
      expect(by.fuel.label.x).toBeCloseTo(cap.x, 6);
      expect(by.fuel.label.y - H / 2 - F, 'fuel label clears a standing eye').toBeGreaterThan(STAND_EYE + 0.05);
      const win = SPEC.windows.side.find(w => w.side < 0 && w.zone === 'saloon' && cap.x >= w.x0 && cap.x <= w.x1)!;
      expect(win, 'a saloon window over the fuel cap').toBeTruthy();
      expect(by.fuel.label.y - H / 2, 'fuel label bottom within the window').toBeLessThan(win.y1 - 0.05);
      // the platform markers: on walkable platform floor (the car floor's height) with headroom, clear of props, near the car, apart
      const plat = ['inventory', 'hotbar', 'controls'].map(id => by[id]);
      for (const q of plat) {
        const w = trainToWorld(p, q.label.x, q.label.y, q.label.z);
        expect(q.label.z, `${level} ${q.id}: on the platform side, beyond the edge`).toBeLessThan(worldToTrain(p, p.x, 0, p.platformEdgeZ).z);
        const floor = q.label.y - ONBOARDING.platformY;
        const band = host.levels.bands(w.x, w.z).find(b => Math.abs(b.floor - (p.railTopY + floor)) < 0.05);
        expect(band, `${level} ${q.id}: walkable floor under it`).toBeTruthy();
        expect(Math.abs(floor - F), `${level} ${q.id}: at the platform (= car floor) height`).toBeLessThan(0.36);
        expect(band!.ceil - band!.floor, `${level} ${q.id}: headroom`).toBeGreaterThanOrEqual(ONBOARDING.platform.headroom);
        expect(arrowPose(q).tip.y - floor, `${level} ${q.id}: above head height`).toBeGreaterThan(STAND_EYE + 0.25);
        const y0 = w.y - H / 2 - ONBOARDING.arrow.max, y1 = w.y + H / 2, R = ONBOARDING.label.w / 2 + 0.1;
        const hit = host.layout.props.filter(o => (o.level ?? 0) === p.level && o.y < y1 && o.y + o.h > y0 && Math.abs(o.x - w.x) < o.hx + R && Math.abs(o.z - w.z) < o.hz + R);
        expect(hit.map(o => o.kind), `${level} ${q.id}: clear of props`).toEqual([]);
        expect(q.fallback, `${level} ${q.id}: a probed spot, not the unchecked fallback`).toBeUndefined();
        const d = trainAreaDistance(p, w.x, p.railTopY + floor, w.z);
        expect(d, `${level} ${q.id}: beside the car`).toBeGreaterThan(1);
        expect(d).toBeLessThan(ONBOARDING.departDistance - 3);
      }
      for (let i = 0; i < plat.length; i++) for (let j = i + 1; j < plat.length; j++) {
        expect(Math.hypot(plat[i].label.x - plat[j].label.x, plat[i].label.z - plat[j].label.z)).toBeGreaterThanOrEqual(ONBOARDING.platform.minGap - 1e-6);
      }
    });
  }
  it('the registry walk covered the train levels (Subway / Office / Mall at least)', () => {
    expect(placed).toEqual(expect.arrayContaining(['subway', 'office', 'mall']));
  });

  it('the train-area distance is 0 anywhere in / on the car and grows outside its outer box', () => {
    const p = playerTrainPlacement(layoutOf('subway'))!;
    for (const [lx, ly, lz] of [[0, SPEC.floorY, 0], [SPEC.interior.x0 + 0.1, SPEC.floorY, 1.2], [SPEC.interior.x1 - 0.1, SPEC.floorY, -1.2], [6.8, 2.4, 0]]) {
      const w = trainToWorld(p, lx, ly, lz);
      expect(trainAreaDistance(p, w.x, w.y, w.z)).toBe(0);
    }
    const w = trainToWorld(p, SPEC.length / 2 + 6, SPEC.floorY, -(SPEC.width / 2 + 8));
    expect(trainAreaDistance(p, w.x, w.y, w.z)).toBeCloseTo(10, 6);
  });

  it('labels turn toward the eye only within their swing', () => {
    const q: MarkerPose = {id: 'lockbox', label: {x: 0, y: 2, z: 0}, target: {x: 0, y: 1, z: 0}, facing: Math.PI / 2, swing: Math.PI / 5};
    expect(labelYaw(q, 3, 0)).toBeCloseTo(Math.PI / 2, 9); // straight on
    expect(labelYaw(q, 3, 1)).toBeCloseTo(Math.atan2(3, 1), 9); // within the swing: faces the eye
    expect(labelYaw(q, 3, 3)).toBeCloseTo(Math.PI / 2 - Math.PI / 5, 9); // beyond it: clamped
    expect(labelYaw(q, 0, -3)).toBeCloseTo(Math.PI / 2 + Math.PI / 5, 9); // clamped
    const free: MarkerPose = {...q, facing: 0, swing: Math.PI};
    expect(Math.abs(Math.sin(labelYaw(free, -2, -2) - Math.atan2(-2, -2)))).toBeLessThan(1e-9);
    // seen from behind: the plate turns about its reversed facing (its front toward the eye, the lettering the right way round)
    const same = (a: number, b: number) => Math.abs(Math.sin(a - b)) < 1e-9 && Math.cos(a - b) > 0;
    expect(same(labelYaw(q, -3, 0), -Math.PI / 2)).toBe(true);
    expect(same(labelYaw(q, -3, 1), Math.atan2(-3, 1))).toBe(true);
    expect(same(labelYaw(q, -3, 5), -Math.PI / 2 + Math.PI / 5)).toBe(true);
  });
});

// =============================================================================================
describe('onboarding activation / dismissal', () => {
  it('shows all seven at the parked train; walking anywhere inside never completes; once presented, 10 m from the car completes it for good', () => {
    const {host, p, store, ob, storage} = world('subway');
    expect(onboardingRoots(host.scene).length).toBe(1);
    expect(ob.status()).toMatchObject({armed: true, built: true, visible: true, presented: false});
    expect(ob.view!.markers.length).toBe(7);
    // spawn: inside, facing the closed platform door — the platform labels' centres are behind the door leaf (only their edges show
    // through its window), so turning to the car's fixtures (the chipper's label in plain sight) presents it
    lookAtChipper(host, ob);
    run(host, ONBOARDING.presentSeconds + 0.2);
    expect(ob.presented).toBe(true);
    // walk the whole car: rear compartment, saloon, cab, both sides — 20 s, never complete (one train-area distance, not per-marker)
    const I = SPEC.interior;
    run(host, 20, t => {
      const x = I.x0 + 0.3 + ((I.x1 - I.x0 - 0.6) * (0.5 + 0.5 * Math.sin(t * 0.7)));
      standAt(host, p, {x, z: Math.sin(t * 1.3) * (I.halfWidth - 0.3)}, {x: x + 1, z: 0});
    });
    expect(ob.distance).toBe(0);
    expect(store.isDone('train')).toBe(false);
    expect(ob.status().visible).toBe(true);
    // out onto the platform among the markers, and along it (still inside 10 m)
    run(host, 5, t => standAt(host, p, {x: -4 + t, z: -(SPEC.width / 2 + 3)}, {x: 0, z: 0}));
    expect(store.isDone('train')).toBe(false);
    expect(ob.distance).toBeLessThan(ONBOARDING.departDistance);
    // the first departure: 10 m from the car -> all seven go together, completed in storage, their materials / atlas disposed
    const disposed: string[] = [];
    const mesh = ob.view!.markers[0].label as THREE.Mesh, arrow = ob.view!.markers[0].arrow as THREE.Mesh;
    for (const m of [mesh.material as THREE.Material, arrow.material as THREE.Material]) m.addEventListener('dispose', () => disposed.push(m.name || m.type));
    standAt(host, p, {x: SPEC.length / 2 + 10.2, z: -(SPEC.width / 2 + 2)}, {x: 0, z: 0});
    run(host, DT);
    expect(store.isDone('train')).toBe(true);
    expect(disposed.length).toBe(2);
    expect(JSON.parse(storage.getItem(KEY)!).done.train).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(ob.view).toBeNull();
    expect(onboardingRoots(host.scene).length).toBe(0);
    expect(ob.counts.completed).toBe(1);
    // coming back: nothing (this station, a rebuild, and a fresh store / runtime over the same storage = a reload / another save)
    standAt(host, p, {x: 0, z: -0.4}, {x: 0, z: -2});
    run(host, 3);
    expect(ob.view).toBeNull();
    for (const s of host.sectionHooks) s.teardown?.();
    for (const s of host.sectionHooks) s.build?.(host.layout);
    expect(ob.view).toBeNull();
    const again = world('office', storage);
    expect(again.ob.armed).toBe(false);
    expect(again.ob.view).toBeNull();
    expect(onboardingRoots(again.host.scene).length).toBe(0);
  });

  it('never consumed unseen: menus / loading frames, an import far from the train, looking away — only presented play counts', () => {
    const {host, p, store, ob} = world('mall');
    const far = {x: SPEC.length / 2 + 14, z: -(SPEC.width / 2 + 3)};
    // a save imported / continued far from the train: markers are there, but 15 s of play away from it neither presents nor completes
    standAt(host, p, far, {x: 0, z: 0});
    run(host, 15);
    expect(ob.distance).toBeGreaterThanOrEqual(ONBOARDING.departDistance);
    expect(ob.status()).toMatchObject({armed: true, built: true, presented: false, presentedSeconds: 0});
    // menus / loading / title: even near the train, looking at it, nothing is counted (and nothing completes when far)
    for (const state of ['paused', 'inventory', 'loading', 'title', 'map', 'dead']) {
      host.state = state;
      standAt(host, p, {x: 0, z: -0.4}, {x: 0, z: -3});
      run(host, 3);
      standAt(host, p, far, {x: 0, z: 0});
      run(host, 1);
    }
    host.state = 'playing';
    expect(ob.presentedT).toBe(0);
    expect(store.isDone('train')).toBe(false);
    // near the train but looking at the floor (no label in view) -> not presented; walking off then does not complete
    standAt(host, p, {x: 0, z: -(SPEC.width / 2 + 1.2)}, {x: 0, z: -3}, -Math.PI / 2 + 0.02);
    run(host, 5);
    expect(ob.presented).toBe(false);
    standAt(host, p, far, {x: 0, z: 0}, -Math.PI / 2 + 0.02);
    run(host, 1);
    expect(store.isDone('train')).toBe(false);
    // dead player: nothing counts either
    host.player.alive = false;
    standAt(host, p, {x: 0, z: -0.4}, {x: 0, z: -3});
    run(host, 3);
    expect(ob.presentedT).toBe(0);
    host.player.alive = true;
    // finally seen in play: presented, then the walk away completes it
    lookAtChipper(host, ob);
    run(host, ONBOARDING.presentSeconds + 0.1);
    expect(ob.presented).toBe(true);
    standAt(host, p, far, {x: 0, z: 0});
    run(host, DT);
    expect(store.isDone('train')).toBe(true);
  });

  it('a rebuilt station starts presentation over; riding the moving train hides them and never completes', () => {
    const {host, p, store, ob} = world('subway');
    lookAtChipper(host, ob);
    run(host, ONBOARDING.presentSeconds + 0.1);
    expect(ob.presented).toBe(true);
    for (const s of host.sectionHooks) s.teardown?.();
    for (const s of host.sectionHooks) s.build?.(host.layout);
    expect(ob.presented).toBe(false);
    expect(ob.view).not.toBeNull();
    // the moving car (TrainRide's link set): hidden, nothing counts, no completion even far from the parked pose
    host.trainRuntime!.ride = {toWorld: (x, y, z) => trainToWorld(p, x, y, z), toLocal: (x, y, z) => worldToTrain(p, x, y, z),
      dirToLocal: (x, y, z) => ({x: x * p.front, y, z: z * p.front}), doorsLocked: true, holdView: true};
    run(host, 3);
    expect(ob.view!.root.visible).toBe(false);
    expect(ob.presentedT).toBe(0);
    standAt(host, p, {x: SPEC.length / 2 + 20, z: 0}, {x: 0, z: 0});
    run(host, 2);
    expect(store.isDone('train')).toBe(false);
    host.trainRuntime!.ride = null;
    standAt(host, p, {x: 0, z: -0.4}, {x: 0, z: -3});
    run(host, DT);
    expect(ob.view!.root.visible).toBe(true);
  });

  it('Reset tutorials re-arms the current train at once (no new campaign) and touches nothing else; another tab completing hides them', () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEYS.slot(1), '{"slot":1}');
    storage.setItem(STORAGE_KEYS.settings, '{"v":1,"fov":80}');
    const {host, p, store, ob} = world('subway', storage);
    lookAtChipper(host, ob);
    run(host, ONBOARDING.presentSeconds + 0.1);
    standAt(host, p, {x: SPEC.length / 2 + 11, z: -3}, {x: 0, z: 0});
    run(host, DT);
    expect(store.isDone('train')).toBe(true);
    expect(ob.view).toBeNull();
    // reset (e.g. from the pause menu while far away): the markers are back at once, presentation starts over
    store.reset();
    expect(ob.view).not.toBeNull();
    expect(ob.view!.markers.length).toBe(7);
    expect(ob.status()).toMatchObject({armed: true, presented: false, presentedSeconds: 0});
    expect(ob.counts.rearmed).toBe(1);
    expect(storage.getItem(STORAGE_KEYS.slot(1))).toBe('{"slot":1}');
    expect(storage.getItem(STORAGE_KEYS.settings)).toBe('{"v":1,"fov":80}');
    // still far: walking around there does not complete it again until it has been presented
    run(host, 5);
    expect(store.isDone('train')).toBe(false);
    // another tab completes it: this tab's storage event -> reload -> hidden here
    const other = new OnboardingStore(storage);
    other.complete('train');
    store.reload();
    expect(ob.view).toBeNull();
    expect(onboardingRoots(host.scene).length).toBe(0);
    // ... and resetting there: this tab's reload shows them again, presentation from scratch
    other.reset();
    store.reload();
    expect(ob.view).not.toBeNull();
    expect(ob.status()).toMatchObject({armed: true, presented: false, presentedSeconds: 0});
  });

  it('a reload that changes nothing keeps the presentation progress (another tab writing unrelated keys)', () => {
    const {host, store, ob} = world('subway');
    lookAtChipper(host, ob);
    run(host, 0.9);
    const t = ob.presentedT;
    expect(t).toBeGreaterThan(0.8);
    store.reload();
    expect(ob.presentedT).toBe(t);
    run(host, ONBOARDING.presentSeconds - t + 0.1);
    expect(ob.presented).toBe(true);
    store.reload();
    expect(ob.presented).toBe(true);
    expect(ob.counts.shown).toBe(1);
  });

  it('in sight only: the car walls / partitions and solid props block a label, its window glass does not', () => {
    const {host, p, ob} = world('subway');
    const F = SPEC.floorY, at = (x: number, y: number, z: number) => { const w = trainToWorld(p, x, y, z); return new THREE.Vector3(w.x, w.y, w.z); };
    const by = Object.fromEntries(ob.view!.markers.map(m => [m.pose.id, m])), cap = fuelPortLocal(SPEC), L = (id: string) => by[id].world;
    // the fuel label from the saloon aisle, through the window over the cap
    expect(ob.inSight(at(cap.x, F + STAND_EYE, -0.4), L('fuel')), 'fuel label through the saloon window glass').toBe(true);
    // ... and from the same aisle 2.5 m along, the ray crossing the solid skin beside the window
    expect(ob.inSight(at(cap.x - 2.6, F + STAND_EYE, 0.6), L('fuel')), 'fuel label behind the skin').toBe(false);
    // the Lockbox label: through the rear compartment's doorway from the saloon; not through the partition / from the cab
    expect(ob.inSight(at(SPEC.rear!.x1 + 1.3, F + STAND_EYE, -0.25), L('lockbox')), 'Lockbox label through the doorway').toBe(true);
    expect(ob.inSight(at(SPEC.rear!.x1 + 1.0, F + STAND_EYE, 1.2), L('lockbox')), 'Lockbox label behind the partition').toBe(false);
    expect(ob.inSight(at(6.0, F + STAND_EYE, 1.0), L('lockbox')), 'Lockbox label from the cab').toBe(false);
    // the chipper label from the saloon: in plain sight; then a solid prop between (a crate box), then gone again
    const eye = at(-1.5, F + STAND_EYE, -0.4);
    expect(ob.inSight(eye, L('chipper'))).toBe(true);
    const mid = eye.clone().lerp(L('chipper'), 0.5);
    const crate = solidBox(p, mid.x, mid.y - 0.5, mid.z, 0.5, 0.5, 1);
    host.layout.props.push(crate);
    try {
      expect(ob.inSight(eye, L('chipper')), 'a crate between').toBe(false);
    } finally {
      host.layout.props.splice(host.layout.props.indexOf(crate), 1);
    }
    expect(ob.inSight(eye, L('chipper'))).toBe(true);
  });

  it('a label in the frustum but behind solid cover is not presented; a lane owning the input (Lockbox view, carried corpse) is not either', () => {
    const {host, p, ob} = world('subway');
    // a slab in front of the eye covering the whole view: labels in the frustum, none in sight -> nothing counts
    lookAtChipper(host, ob);
    const e = new THREE.Vector3().setFromMatrixPosition(host.camera.matrixWorld), f = new THREE.Vector3(0, 0, -1).applyQuaternion(host.camera.quaternion);
    const c = e.clone().addScaledVector(f, 0.3);
    const slab = solidBox(p, c.x, c.y - 3, c.z, 0.25 + 3 * Math.abs(f.z), 0.25 + 3 * Math.abs(f.x), 6);
    host.layout.props.push(slab);
    try {
      run(host, 3);
      expect(ob.presentedT, 'covered').toBe(0);
    } finally {
      host.layout.props.splice(host.layout.props.indexOf(slab), 1);
    }
    // an input owner (e.g. the open Lockbox view over the screen)
    let owned = true;
    host.inputOwners = [() => false, () => owned];
    run(host, 3);
    expect(ob.presentedT, 'owned').toBe(0);
    owned = false;
    run(host, ONBOARDING.presentSeconds + 0.1);
    expect(ob.presented).toBe(true);
  });

  it('nonblocking: no colliders / layout props / shadows / raycast hits, and the console + Lockbox aim through them as before', () => {
    const layout = layoutOf('subway');
    const host = makeHost(layout);
    const p = host.trainPlacement!;
    host.trainRuntime = installPlayerTrain(host);
    // build the train alone, snapshot its colliders, then the onboarding: nothing may change
    host.sectionHooks[0].build!(layout);
    const props = [...layout.props], index = host.propIndex, volumes = [...host.levels.dynamicVolumes];
    const ob = new TrainOnboarding(host, new OnboardingStore(new FakeStorage())).install();
    live.push({host});
    ob.build();
    expect(ob.view).not.toBeNull();
    expect(layout.props).toEqual(props);
    expect(host.propIndex).toBe(index);
    expect(host.levels.dynamicVolumes).toEqual(volumes);
    const meshes: THREE.Mesh[] = [];
    ob.view!.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(14);
    for (const m of meshes) {
      expect(m.castShadow || m.receiveShadow).toBe(false);
      expect((m.material as THREE.Material).side).toBe(THREE.FrontSide);
      expect((m.material as THREE.Material).transparent).toBe(false);
    }
    const ray = new THREE.Raycaster();
    for (const m of ob.view!.markers) {
      const w = m.world;
      ray.set(new THREE.Vector3(w.x, w.y, w.z + 3), new THREE.Vector3(0, 0, -1));
      expect(ray.intersectObject(ob.view!.root, true)).toEqual([]);
    }
    expect(host.warmRegistry.names.pools).toContain('train-onboarding');
    expect(host.warmRegistry.poolRoots()).toContain(ob.view!.root);
    // the console: from the cab (behind the label, looking at the desk through its arrow) the train still aims it
    const rt = host.trainRuntime!, cr = consoleLocalRect(SPEC, rt.consoleRect);
    rt.onConsoleInteract = () => {}; // (the game wires it to the paper map: an unwired console is not an interactable)
    standAt(host, p, {x: SPEC.cab.x0 + 0.5, z: 0}, {x: (cr.x0 + cr.x1) / 2, z: 0});
    host.player.pitch = -0.35;
    run(host, 0.2);
    expect(rt.consoleAimed, 'console aimed with the onboarding shown').toBe(true);
    // the Lockbox: from just inside the rear compartment, below its label
    const lb = SPEC.lockbox!;
    standAt(host, p, {x: SPEC.rear!.x1 - 0.2, z: -0.25}, {x: lb.x, z: lb.z});
    host.player.pitch = -0.72;
    run(host, 0.2);
    expect(rt.lockboxAimed, 'Lockbox aimed with the onboarding shown').toBe(true);
  });

  it('wired into the game after the train / chipper; the pause + main-menu Settings mount Reset tutorials', () => {
    const game = src('../src/game.ts'), main = src('../src/main.ts');
    const chip = game.indexOf('this.chipper = installChipper(this);'), onb = game.indexOf('this.trainOnboarding = installTrainOnboarding(this, this.onboarding);');
    expect(chip).toBeGreaterThan(0);
    expect(onb).toBeGreaterThan(chip);
    expect(main).toMatch(/mountTutorialReset\(\$\('#pause-settings'\), game\.onboarding, \{idPrefix: 'set-'\}\)/);
    expect(main).toMatch(/settings: box => \{ mountSettingsForm\(box, settings, [^}]*\}\); mountTutorialReset\(box, game\.onboarding, \{idPrefix: 'mm-set-'\}\);/);
    expect(main).toMatch(/e\.key === game\.onboarding\.key\) game\.onboarding\.reload\(\)/);
  });
});

// =============================================================================================
describe('onboarding labels + menu button', () => {
  it('copy: the requested lines, the words in order; keys as keycaps, the hotbar phrase accented', () => {
    const words = (s: string) => s.split(/\s+/).filter(w => w && w !== '·');
    expect(ONBOARDING_MARKERS.map(d => d.text)).toEqual([
      'Scavenge fuel. Refuel to travel.', 'Drive the train. Explore the network.', 'Low on fuel? Grind zombie corpses.',
      'Your storage travels with the train.', 'Tab: open / close inventory.', 'Bottom hotbar: switch weapons & gear.', 'F: flashlight · Shift: sprint · C: crouch.',
    ]);
    for (const d of ONBOARDING_MARKERS) {
      expect(words(d.lines.join(' ')), d.id).toEqual(words(d.text));
      expect(d.lines.length).toBeGreaterThanOrEqual(2);
      expect(d.lines.length).toBeLessThanOrEqual(3);
    }
    const keyRuns = (id: string) => ONBOARDING_MARKERS.find(d => d.id === id)!.lines.flatMap(l => labelRuns(ONBOARDING_MARKERS.find(d => d.id === id)!, l)).filter(r => r.style === 'key').map(r => r.text);
    expect(keyRuns('inventory')).toEqual(['Tab']);
    expect(keyRuns('controls')).toEqual(['F', 'Shift', 'C']);
    expect(keyRuns('fuel')).toEqual([]);
    const hot = ONBOARDING_MARKERS.find(d => d.id === 'hotbar')!;
    expect(labelRuns(hot, hot.lines[0])).toEqual([{text: 'Bottom hotbar:', style: 'accent'}]);
    expect(labelRuns(ONBOARDING_MARKERS[4], 'Tab:')).toEqual([{text: 'Tab', style: 'key'}, {text: ':', style: 'text'}]);
  });

  it('the atlas: one font size for every label, opaque plates with transparent corners, text drawn in each row', () => {
    const c = new ShimCanvas(true);
    c.width = 1024; c.height = 256 * ONBOARDING_MARKERS.length;
    const ctx = c.getContext() as unknown as CanvasRenderingContext2D;
    const {font} = drawLabelAtlas(ctx);
    expect(font).toBeGreaterThanOrEqual(52);
    const px = (x: number, y: number) => { const i = (y * c.width + x) * 4; return [c.data[i], c.data[i + 1], c.data[i + 2], c.data[i + 3]]; };
    ONBOARDING_MARKERS.forEach((d, i) => {
      const y0 = i * 256;
      expect(px(2, y0 + 2)[3], `${d.id}: corner transparent`).toBe(0);
      expect(px(14, y0 + 128)[3], `${d.id}: the border opaque`).toBe(255);
      let text = 0;
      for (let y = y0 + 40; y < y0 + 216; y += 3) for (let x = 60; x < 964; x += 3) { const q = px(x, y); if (q[3] === 255 && q[0] > 150) text++; }
      expect(text, `${d.id}: lettering drawn`).toBeGreaterThan(200);
    });
  });

  it('the arrow template: a closed mesh along +Y, its tip at the origin, flat-shaded mustard vertex colours', () => {
    const g = arrowGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(ONBOARDING.arrow.len, 6);
    expect(b.max.x).toBeCloseTo(ONBOARDING.arrow.headR, 3);
    const col = g.getAttribute('color');
    expect(col.count).toBe(g.getAttribute('position').count);
    let lo = 1, hi = 0;
    for (let i = 0; i < col.count; i++) { lo = Math.min(lo, col.getX(i)); hi = Math.max(hi, col.getX(i)); expect(col.getX(i)).toBeGreaterThan(col.getZ(i)); }
    expect(hi - lo, 'shaded facets').toBeGreaterThan(0.15);
    // outward faces (the FrontSide material shows the outside): side facets' normals point away from the axis, the tip faces down
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    for (let t = 0; t < pos.count; t += 3) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += pos.getX(t + k) / 3; cy += pos.getY(t + k) / 3; cz += pos.getZ(t + k) / 3; }
      const nx = nor.getX(t), ny = nor.getY(t), nz = nor.getZ(t);
      if (Math.abs(ny) < 0.999) expect(nx * cx + nz * cz, `facet ${t / 3} outward`).toBeGreaterThan(0);
      if (cy < ONBOARDING.arrow.headLen - 0.02) expect(ny, 'the head faces down').toBeLessThan(0);
    }
    g.dispose();
  });

  it('Reset tutorials (the settings box button): clears only the onboarding record and says so', () => {
    const dom = installMiniDom();
    const P = MiniEl.prototype as unknown as object, had = Object.getOwnPropertyDescriptor(P, 'ownerDocument');
    Object.defineProperty(P, 'ownerDocument', {configurable: true, get(this: MiniEl) { return this.doc; }});
    try {
      const storage = new FakeStorage();
      storage.setItem(STORAGE_KEYS.slot(2), 'save');
      storage.setItem(STORAGE_KEYS.settings, '{"v":1}');
      const store = new OnboardingStore(storage);
      store.complete('train');
      for (const prefix of ['mm-set-', 'set-']) {
        const box = dom.doc.createElement('div');
        dom.doc.body.appendChild(box);
        const off = mountTutorialReset(box as unknown as HTMLElement, store, {idPrefix: prefix});
        const btn = box.querySelector(`#${prefix}reset-tutorials`)!;
        expect(btn.textContent).toBe('Reset tutorials');
        btn.dispatchEvent(new MiniEvent('click'));
        expect(store.isDone('train')).toBe(false);
        expect(storage.map.has(KEY)).toBe(false);
        expect(box.querySelector(`#${prefix}tutorials-note`)!.textContent).toMatch(/Tutorials reset/);
        expect(storage.getItem(STORAGE_KEYS.slot(2))).toBe('save');
        expect(storage.getItem(STORAGE_KEYS.settings)).toBe('{"v":1}');
        store.complete('train');
        off();
      }
    } finally {
      dom.uninstall();
      if (had) Object.defineProperty(P, 'ownerDocument', had); else delete (P as {ownerDocument?: unknown}).ownerDocument;
    }
  });
});
