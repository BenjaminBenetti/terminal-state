// Task studio-refinement-batch-20261113-035659-01 (lane SAVE): THE SAVE TERMINAL in the player's train (world/trainSaveTerminal.ts +
// world/trainSaveTerminalPlace.ts + its 'save' owner in world/playerTrain.ts PlayerTrainRuntime). User: "Manual train save: small
// retro Fallout-esque CRT LEFT of the main drive terminal, labeled 'Save'. Interaction invokes the existing actual active-slot save
// path, truthfully reporting success/failure." On a generated Subway layout with the REAL parked train runtime, the real Player and
// (moving car) the real TrainRide; the save API is a recorded fake here (tests/save-manual.test.ts runs the real Game.saveNow):
//  - placement: left (-Z) of the driving desk as the operator faces the windshield (+X), in the dead strip beside the desk's -Z end;
//    task studio-scanner-console-refinements-20261114-031614-01 ("Turn the train's existing Save terminal so the screen faces INWARD
//    toward the cab/player at the drive controls. Keep its position/height"): its screen faces +Z, across the cab to the drive
//    controls (within 30 deg; it was 66 deg off), on the same wall, shelf height and pier; the monitor on the solid pier between two cab
//    windows (only its rounded sides reach ~2 cm past the pier's edges), the low parts under the sills; the keyboard's edge over the
//    desk's LOW -Z end (the desk model measured under it); one solid box in the parked colliders AND the ride's car-local model — a
//    fixed part of the car (the train's own box kind, never a prop kind);
//  - the view: on the car's view root (stand-in without the model; the reused P7 CRT when the library has it), a dynamic canvas
//    screen ("SAVE", the active slot, the slot's last save, the terminal's state), warm-up pool, model key, nothing pickable;
//  - aim + glow + prompt + [E]: the terminal (before the desk's coarse box, which covers its front corner) or the desk; aimed from the
//    drive controls it is the terminal's; [E] calls saveNow once (cooldown), success / failure
//    reported truthfully (toast + cue / warn toast + denied + the screen); blocked -> the prompt says why;
//  - riding: the terminal rides on the held view and is aimed in the moving car's frame; the prompt says it saves only when stopped.
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainSpawnPose, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {P7_FILES} from '../src/gen/props07';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, TRAIN_DOOR, installPlayerTrain, trainColliders} from '../src/world/playerTrain';
import {CONSOLE_PROMPT, consoleLocalRect, inCab} from '../src/world/trainConsole';
import {RIDE_FRAME, buildRideLocalModel, carToWorld} from '../src/world/trainRideLocal';
import {installTrainRide, type TrainRide} from '../src/world/trainRide';
import {benchFootprint, benchPlacement} from '../src/craft/trainFixtures';
import {
  SAVE_TERMINAL, SAVE_TERMINAL_MODEL, SAVE_TERMINAL_MODEL_KEY, saveTerminalPlacement, saveTerminalToLocal, screenGlassZ,
} from '../src/world/trainSaveTerminalPlace';
import {
  SAVE_RT, SAVE_TEXT, SCREEN_COLS, SaveTerminalSystem, clockText, installSaveTerminal, refusalShort, saveScreenModel, saveTerminalModelKeys,
  wrapText, type SaveNowResult, type SaveRefusal, type SaveTerminalOptions,
} from '../src/world/trainSaveTerminal';
import type {LastSaveStatus} from '../src/ui/loadingScreen';
import type {SaveMeta} from '../src/campaign/types';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
let cached: StationLayout | null = null;
const layout = (): StationLayout => (cached ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const P = saveTerminalPlacement(SPEC)!;
const CR = consoleLocalRect(SPEC);
/** The keyboard's top in the model frame (measured on the GLB: every vertex in front of z 0 is below it). */
const KEYBOARD_TOP = 0.054;

class Keys implements MoveInput {
  down() { return false; }
  hit() { return false; }
}

class FakeSfx {
  readonly calls: string[] = [];
  denied() { this.calls.push('denied'); }
  voice() { return {}; }
  play(_v: unknown, cue: string) { this.calls.push(`cue:${cue}`); return true; }
}

const MOVING: SaveRefusal = {ok: false, code: 'moving', error: 'Not saved: the train is moving — save while it stands at a station.'};
const meta = (o: Partial<SaveMeta> = {}): SaveMeta => ({slot: 2, savedAt: '2026-11-13T10:20:30.000Z', revision: 5, playtime: 600, station: 'Calder Park',
  archetype: 'subway', stationsVisited: 3, networkSeed: 1, won: false, reason: 'manual', build: 'test', ...o});

const live: {rt: PlayerTrainRuntime; ride: TrainRide}[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const {rt, ride} of live.splice(0)) { ride.reset(); rt.ride = null; if (rt.train) rt.teardown(); }
});

function setup(o: {term?: SaveTerminalOptions; console?: boolean} = {}) {
  const L = layout();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(L);
  const toasts: [string, boolean][] = [];
  const shadows: THREE.Object3D[] = [];
  const sfx = new FakeSfx();
  /** The fake save API: `block` = why not now (the ride adds 'moving'), `next` = what saveNow returns. */
  const api = {block: null as SaveRefusal | null, next: {ok: true, slot: 2, meta: meta(), chars: 1234} as SaveNowResult, calls: 0,
    status: {ok: true, slot: 2, meta: meta({reason: 'arrival', savedAt: '2026-11-13T09:05:00.000Z', revision: 4})} as LastSaveStatus};
  const h = {
    scene, camera, player: new Player(), zombies: [] as never[],
    levels, layout: L, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L) as TrainPlacement | null,
    sfx, hud: {toast: (t: string, warn?: boolean) => { toasts.push([t, !!warn]); }}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: vi.fn()},
    atmosphere: {markShadows: (root: THREE.Object3D) => { shadows.push(root); }},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    sectionModelKeys: [] as ((l: StationLayout) => readonly string[])[],
    state: 'playing', world: {culler: {register: vi.fn(), release: vi.fn()}}, run: {current: {level: 'subway', section: 'main'}}, mats: null,
    trainRuntime: undefined as unknown as PlayerTrainRuntime, trainRide: undefined as unknown as TrainRide,
    currentSlot: 2 as number | null, saveRevision: 4,
    saveBlock: (): SaveRefusal | null => (h.trainRide?.riding ? MOVING : api.block),
    saveNow: (): SaveNowResult => { api.calls++; return h.saveBlock() ?? api.next; }, // (as Game.saveNow: a block refuses first)
    lastSaveStatus: (): LastSaveStatus => api.status,
  };
  const rt = installPlayerTrain(h);
  h.trainRuntime = rt;
  const ride = installTrainRide(h, rt);
  h.trainRide = ride;
  live.push({rt, ride});
  if (o.console !== false) rt.onConsoleInteract = () => {};
  const term = installSaveTerminal(h as never, o.term);
  for (const s of h.sectionHooks) s.build?.(L);
  return {h, rt, ride, term, api, toasts, sfx, shadows, p: h.trainPlacement!};
}
type S = ReturnType<typeof setup>;

const sync = (s: S) => {
  const Pl = s.h.player;
  s.h.camera.position.set(Pl.x, s.ride.riding ? Pl.eye : Pl.y + STAND_EYE, Pl.z);
  s.h.camera.rotation.set(Pl.pitch, Pl.yaw, 0);
  if (s.ride.riding) s.ride.tiltCamera(s.h.camera);
  s.h.camera.updateMatrixWorld(true);
};
/** Stand at a train-local floor point of the parked car, looking at a train-local point. */
function standLook(s: S, lx: number, lz: number, tx: number, ty: number, tz: number): void {
  const at = trainToWorld(s.p, lx, SPEC.floorY, lz), a = trainToWorld(s.p, tx, ty, tz);
  const Pl = s.h.player;
  Pl.spawn(at.x, at.z, 0, at.y);
  Pl.yaw = Math.atan2(-(a.x - at.x), -(a.z - at.z));
  Pl.pitch = Math.atan2(a.y - (at.y + STAND_EYE), Math.hypot(a.x - at.x, a.z - at.z));
  sync(s);
}
/** Frames: parked = the hooks only (the player stands still); riding = the ride steps the player first. */
const frames = (s: S, n = 1) => {
  for (let i = 0; i < n; i++) {
    if (s.ride.riding) s.ride.stepPlayer(DT, new Keys(), OPTS);
    sync(s);
    for (const f of s.h.frameHooks) f(DT);
  }
};
const prompt = (s: S) => s.h.promptProviders.map(f => f()).find(Boolean) ?? null;
/** The screen's centre (train-local). */
const SCREEN = P.screen;
/** Where the operator stands at the drive controls: behind the desk's middle (the spot the screen is turned to). */
const OPERATOR = P.driver;
const lookAtScreen = (s: S) => standLook(s, OPERATOR.x, OPERATOR.z, SCREEN.x, SCREEN.y, SCREEN.z);
/** The two -Z cab windows' pier (the solid lining between them). */
const PIER = (() => { const w = cabWindows(SPEC).sort((a, b) => a.x0 - b.x0); return {x0: w[0].x1, x1: w[1].x0}; })();
function cabWindows(spec: typeof SPEC) { return spec.windows.side.filter(w => w.side === -1 && w.zone === 'cab'); }
/** How much of [a0, a1] lies inside [b0, b1]. */
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Every vertex of a subtree in the train frame (the car's view root at the parked placement). */
function localVerts(s: S, root: THREE.Object3D): THREE.Vector3[] {
  root.updateWorldMatrix(true, true);
  const out: THREE.Vector3[] = [], v = new THREE.Vector3();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.highlightPrototype) return;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const q = worldToTrain(s.p, v.x, v.y, v.z);
      out.push(new THREE.Vector3(q.x, q.y, q.z));
    }
  });
  return out;
}
const CAB_WINDOWS = cabWindows(SPEC);

describe('save terminal: where it stands', () => {
  it('LEFT of the driving desk (the operator faces +X: left = -Z), in the dead strip beside its -Z end, its screen turned INWARD to the drive controls', () => {
    expect(Math.abs(SPEC.console.yaw)).toBeLessThan(1e-6); // (the desk faces the windshield)
    expect(P).not.toBeNull();
    expect(P.side).toBe(-1);
    expect(P.z).toBeLessThan(CR.z0); // left of the desk
    expect(P.monitor.z1).toBeLessThan(CR.z0 - SAVE_TERMINAL.deskGap + 1e-9); // the monitor stands in the strip, never over the desk
    expect(P.box.z0).toBeGreaterThanOrEqual(-SPEC.interior.halfWidth - 1e-9); // against the -Z lining
    expect(P.aim.z0 - P.box.z0).toBeCloseTo(SAVE_TERMINAL.wallGap, 4); // its back at the lining
    for (const k of ['x0', 'z0'] as const) expect(P.aim[k]).toBeGreaterThanOrEqual(P.box[k]);
    for (const k of ['x1', 'z1'] as const) expect(P.aim[k]).toBeLessThanOrEqual(P.box[k]);
    // turned: the model's width runs along the car, its depth across it
    expect(P.aim.x1 - P.aim.x0).toBeCloseTo(SAVE_TERMINAL_MODEL.w * SAVE_TERMINAL.scale, 3);
    expect(P.aim.z1 - P.aim.z0).toBeCloseTo(SAVE_TERMINAL_MODEL.d * SAVE_TERMINAL.scale, 3);
    // only the keyboard's front edge reaches over the desk's -Z side, a few cm (the desk is low there: measured below)
    expect(P.overDesk).toBeCloseTo(P.aim.z1 - CR.z0, 3);
    expect(P.overDesk).toBeGreaterThan(0);
    expect(P.overDesk).toBeLessThanOrEqual(SAVE_TERMINAL.maxOverDesk);
    expect(inCab(SPEC, P.x, P.z)).toBe(true);
    expect(P.x).toBeGreaterThan(SPEC.cab.x0 + 0.3);
    // the screen faces +Z (yaw 0: model +Z, its front, is train +Z) — inward, across the cab
    expect(P.yaw).toBe(0);
    expect(P.facing).toEqual({x: 0, z: 1});
    const f = saveTerminalToLocal(P, 0, 0, 1), o = saveTerminalToLocal(P, 0, 0, 0);
    expect([f.x - o.x, f.z - o.z].map(v => +v.toFixed(9) + 0)).toEqual([0, P.scale]);
    const c = saveTerminalToLocal(P, 0, SAVE_TERMINAL.screen.yc, screenGlassZ(0, SAVE_TERMINAL.screen.yc) + SAVE_TERMINAL.screen.lift);
    expect([P.screen.x, P.screen.y, P.screen.z]).toEqual([c.x, c.y, c.z].map(v => Math.round(v * 1e4) / 1e4));
    // toward the operator at the drive controls (behind the desk's middle): within 30 deg of its axis — the old -X screen was 66 deg off
    expect(P.driver).toEqual({x: +(CR.x0 - SAVE_TERMINAL.driverBack).toFixed(4), z: (CR.z0 + CR.z1) / 2});
    const to = {x: P.driver.x - P.screen.x, z: P.driver.z - P.screen.z}, len = Math.hypot(to.x, to.z);
    const off = (fx: number, fz: number) => Math.acos((fx * to.x + fz * to.z) / len) * 180 / Math.PI;
    expect(off(P.facing.x, P.facing.z)).toBeLessThan(30);
    expect(off(-1, 0)).toBeGreaterThan(60); // (the old facing, for the record)
    expect(inCab(SPEC, P.driver.x, P.driver.z)).toBe(true);
    // small: 0.30 x 0.31 x 0.34 m (the scale-check render's numbers at the runtime scale); the same shelf height as before
    expect([P.width, P.height, P.depth]).toEqual([0.2985, 0.306, 0.34]);
    expect(P.shelfY - SPEC.floorY).toBeCloseTo(SAVE_TERMINAL.shelfY, 9);
    expect(SAVE_TERMINAL.shelfY).toBe(0.92);
    expect(P.top).toBeCloseTo(P.shelfY + P.height, 4);
  });

  it('the monitor is centred on the solid pier between the two -Z cab windows (its rounded sides ~2 cm past the pier); the low parts under the sill', () => {
    expect(CAB_WINDOWS.length).toBeGreaterThanOrEqual(2);
    expect((P.monitor.x0 + P.monitor.x1) / 2).toBeCloseTo((PIER.x0 + PIER.x1) / 2, 4);
    // the monitor (everything above the keyboard) is 0.30 m wide, the pier 0.26 m: at most 2.5 cm of it in front of either window's edge
    expect(PIER.x1 - PIER.x0).toBeCloseTo(0.26, 2);
    for (const w of CAB_WINDOWS) expect(overlap(P.monitor.x0, P.monitor.x1, w.x0, w.x1), `monitor vs window ${w.x0}..${w.x1}`).toBeLessThanOrEqual(0.025);
    // it stands where it stood (the same wall, shelf and pier): the old placement's monitor was in front of this pier too
    expect(overlap(P.aim.x0, P.aim.x1, 6.2131, 6.5531)).toBeGreaterThan(0.2); // (the old aim box's x span, task refinement-batch)
    // whatever lies in front of a window (the shelf + its lip, the keyboard) stays below that window's sill
    const lowTop = Math.max(P.shelfY + 0.025, P.shelfY + KEYBOARD_TOP * P.scale);
    for (const w of CAB_WINDOWS) if (w.x1 > P.box.x0 && w.x0 < P.box.x1) expect(lowTop, `under the sill of ${w.x0}..${w.x1}`).toBeLessThan(w.y0);
  });

  it('what reaches over the desk\'s -Z end clears the desk model there: the cooked desk is low under the shelf (measured, not its box)', async () => {
    const gl: GLTF = await loadStripped(SPEC.models.console.url);
    const root = gl.scene;
    root.updateMatrixWorld(true);
    // placed as world/playerTrainView.ts places it: centred on spec.console, standing on the floor (yaw 0, scale 1 here)
    expect([SPEC.console.yaw, SPEC.console.scale]).toEqual([0, 1]);
    const bb = new THREE.Box3().setFromObject(root), v = new THREE.Vector3();
    let under = 0, top = -Infinity, all = 0;
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const x = SPEC.console.x + v.x - (bb.min.x + bb.max.x) / 2, y = SPEC.floorY + v.y - bb.min.y, z = SPEC.console.z + v.z - (bb.min.z + bb.max.z) / 2;
        all++;
        if (x >= P.shelf.x0 - 0.02 && x <= P.shelf.x1 + 0.02 && z <= P.shelf.z1 + 0.02) { under++; top = Math.max(top, y); }
      }
    });
    expect(all).toBeGreaterThan(1000);
    expect(under).toBeGreaterThan(0); // (the desk's low left end IS there)
    // its highest point under the shelf (2 cm round) is far below the shelf's underside: the desk's coarse box (top 1.16 m) is not the desk
    expect(top - SPEC.floorY).toBeLessThan(0.75);
    expect(P.shelf.y0 - top).toBeGreaterThan(0.15);
    expect(CR.top - SPEC.floorY).toBeGreaterThan(1.1);
  }, 120000);

  it('one solid box (shelf + terminal, lining to the desk side, to its top) parked AND in the ride model — the train\'s own box kind', () => {
    const p = playerTrainPlacement(layout())!;
    const col = trainColliders(SPEC, p, null);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const find = (list: typeof col.statics) => list.find(b => {
      const q = worldToTrain(p, b.x - b.hx, 0, b.z - b.hz), r = worldToTrain(p, b.x + b.hx, 0, b.z + b.hz);
      return near(Math.min(q.x, r.x), P.box.x0) && near(Math.max(q.x, r.x), P.box.x1) && near(Math.min(q.z, r.z), P.box.z0) && near(Math.max(q.z, r.z), P.box.z1);
    });
    const box = find(col.statics);
    expect(box, 'the parked collider').toBeDefined();
    expect(box!.y + box!.h).toBeCloseTo(p.railTopY + P.top, 6);
    expect(find(col.shoot), 'hitscan stops at it too').toBeDefined();
    // the same kind as every other fixed part of the car (desk, bench): never a prop kind the acid / loot / cargo systems know
    const bench = benchPlacement(SPEC)!, bfp = benchFootprint(bench);
    const benchBox = col.statics.find(b => { const q = worldToTrain(p, b.x, 0, b.z); return near(q.x, (bfp.x0 + bfp.x1) / 2) && near(q.z, (bfp.z0 + bfp.z1) / 2); });
    expect(box!.kind).toBe(benchBox!.kind);
    expect(layout().props.some(q => String(q.kind).toLowerCase().includes('crt'))).toBe(false);
    // the moving car's own solid model
    const m = buildRideLocalModel(SPEC);
    const sv = m.named.saveTerminal;
    expect(sv).toBeDefined();
    const {ox, oz} = RIDE_FRAME; // (the ride's step frame: train-local + (ox, oz))
    expect([sv.x - sv.hx - ox, sv.x + sv.hx - ox, sv.z - sv.hz - oz, sv.z + sv.hz - oz].map(v => +v.toFixed(6))).toEqual([P.box.x0, P.box.x1, P.box.z0, P.box.z1].map(v => +v.toFixed(6)));
    // it reaches into the desk's box by the keyboard's overhang + the shelf's lip only (two solids, no gap between them)
    expect(sv.z + sv.hz - (m.named.console.z - m.named.console.hz)).toBeLessThanOrEqual(SAVE_TERMINAL.maxOverDesk + SAVE_TERMINAL.lip + 1e-9);
    expect(P.box.z1 - CR.z0).toBeCloseTo(P.overDesk + SAVE_TERMINAL.lip, 3);
  });

  it('no placement for a car whose desk is turned or whose strip beside it is too narrow (nothing built, nothing throws)', () => {
    expect(saveTerminalPlacement({...SPEC, console: {...SPEC.console, yaw: Math.PI / 2}})).toBeNull();
    expect(saveTerminalPlacement({...SPEC, interior: {...SPEC.interior, halfWidth: CR.z1 + 0.2}})).toBeNull();
    const s = setup();
    const spec = {...SPEC, console: {...SPEC.console, yaw: Math.PI}};
    const t = new SaveTerminalSystem({...s.h, trainRuntime: {...s.rt, spec, view: s.rt.view, carPoint: () => null, saveTerminal: null}} as never);
    expect(t.place).toBeNull();
    expect(t.attach()).toBe(false);
    expect(t.aimBox()).toBeNull();
    t.update();
    expect(t.qa()).toMatchObject({placed: false, attached: false});
  });
});

describe('save terminal: the fixture in the car', () => {
  it('on the car\'s view root: a stand-in until the model comes, the steel shelf, the screen; warm-up pool, model key; nothing pickable, no light', () => {
    const s = setup();
    expect(s.rt.saveTerminal).toBe(s.term);
    expect(s.term.group.parent).toBe(s.rt.view!.root);
    expect(s.term.fixture.position.toArray()).toEqual([P.x, P.shelfY, P.z]);
    expect(s.term.fixture.rotation.y).toBeCloseTo(P.yaw, 12);
    expect(s.term.fixture.scale.toArray()).toEqual([P.scale, P.scale, P.scale]);
    expect(s.term.model).toBeNull();
    expect(s.term.standIn).toBeTruthy();
    expect(s.term.screen.parent).toBe(s.term.fixture);
    expect(s.h.warmRegistry.names.pools).toContain('train-save-terminal');
    expect(s.h.warmRegistry.poolRoots()).toContain(s.term.group);
    expect(s.h.sectionModelKeys.flatMap(f => f(layout()))).toContain(SAVE_TERMINAL_MODEL_KEY);
    expect(saveTerminalModelKeys(layout())).toEqual([SAVE_TERMINAL_MODEL_KEY]);
    expect(P7_FILES[SAVE_TERMINAL_MODEL_KEY]?.url).toBe(SAVE_TERMINAL_MODEL.url); // the reused P7 CRT GLB (no new model)
    let lights = 0;
    s.term.group.traverse(o => {
      if ((o as THREE.Light).isLight) lights++;
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      expect(m.userData.level).toBe(s.p.level);
      const hits: THREE.Intersection[] = [];
      m.raycast(new THREE.Raycaster(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0)), hits);
      expect(hits).toEqual([]);
    });
    expect(lights).toBe(0);
    // shadows: the shelf and the stand-in — never the screen
    expect(s.shadows.filter(o => o.name.startsWith('train-save'))).toEqual(expect.arrayContaining([s.term.shelf, s.term.standIn]));
    expect(s.shadows).not.toContain(s.term.screen);
    expect(s.term.screen.castShadow).toBe(false);
    // the shelf stays inside the solid box, under the terminal
    const sv = localVerts(s, s.term.shelf!);
    const e = 1e-6;
    for (const v of sv) {
      expect(v.x).toBeGreaterThanOrEqual(P.box.x0 - e); expect(v.x).toBeLessThanOrEqual(P.box.x1 + e);
      expect(v.z).toBeGreaterThanOrEqual(P.box.z0 - e); expect(v.z).toBeLessThanOrEqual(P.box.z1 + e);
      expect(v.y).toBeLessThanOrEqual(P.shelfY + 0.025 + e);
      expect(v.y).toBeGreaterThan(SPEC.floorY);
    }
    // the stand-in stands on the shelf inside the aim box (the placement's numbers are rounded to 0.1 mm)
    const r = 2e-4;
    for (const v of localVerts(s, s.term.standIn!)) {
      expect(v.y).toBeGreaterThanOrEqual(P.shelfY - r);
      expect(v.z).toBeGreaterThanOrEqual(P.aim.z0 - r); expect(v.z).toBeLessThanOrEqual(P.aim.z1 + r);
    }
  });

  it('the screen is a dynamic canvas labelled SAVE: the active slot, the slot\'s real last save, [E] SAVE GAME; redrawn only on a change', () => {
    const s = setup();
    expect(s.term.texture).toBeInstanceOf(THREE.CanvasTexture);
    const shown = s.term.shown!;
    expect(shown.title).toBe('SAVE');
    expect(shown.lines.map(l => l.text)).toEqual(['SLOT 2 · ACTIVE', `LAST ${clockText('2026-11-13T09:05:00.000Z')} ARRIVAL`, '', '> [E] SAVE GAME_']);
    const mat = s.term.screen.material as THREE.MeshBasicMaterial;
    expect(mat.map).toBe(s.term.texture);
    // near the car, nothing changed: no redraw per frame
    lookAtScreen(s);
    frames(s);
    const n = s.term.counts.redraws;
    frames(s, 10);
    expect(s.term.counts.redraws).toBe(n);
    // the slot's state changed (another save): one redraw
    s.h.saveRevision = 5;
    s.api.status = {ok: true, slot: 2, meta: meta({reason: 'departure'})};
    frames(s, 3);
    expect(s.term.counts.redraws).toBe(n + 1);
    expect(s.term.shown!.lines[1].text).toMatch(/ DEPARTURE$/);
    // a block (here: the lift moving) shows why instead of the invitation
    s.api.block = {ok: false, code: 'lift', error: 'Not saved: the lift is moving — save once it stops.'};
    frames(s);
    expect(s.term.shown!.lines.slice(3).map(l => [l.text, l.tone])).toEqual([['WAIT FOR THE LIFT TO', 'warn'], ['STOP', 'warn']]);
  });

  it('with the cooked CRT (the reused P7 model, its own maps): fits its box, glass flush with the desk edge, clear of the windows, the screen in front of the glass', async () => {
    const gl: GLTF = await loadStripped(SAVE_TERMINAL_MODEL.url);
    const s = setup({term: {model: () => gl.scene}});
    expect(s.term.model).toBeTruthy();
    expect(s.term.standIn).toBeNull();
    const verts = localVerts(s, s.term.model!);
    expect(verts.length).toBeGreaterThan(100);
    const e = 2e-3;
    const box = new THREE.Box3().setFromPoints(verts);
    // grounded on the shelf, inside the aim box (= the solid box above the shelf)
    expect(box.min.y).toBeCloseTo(P.shelfY, 2);
    expect(box.max.y).toBeLessThanOrEqual(P.aim.y1 + e);
    expect(box.min.x).toBeGreaterThanOrEqual(P.aim.x0 - e); expect(box.max.x).toBeLessThanOrEqual(P.aim.x1 + e);
    expect(box.min.z).toBeGreaterThanOrEqual(P.aim.z0 - e); expect(box.max.z).toBeLessThanOrEqual(P.aim.z1 + e);
    expect(box.min.z).toBeGreaterThan(-SPEC.interior.halfWidth); // never through the lining
    expect(box.max.z - CR.z0).toBeLessThanOrEqual(SAVE_TERMINAL.maxOverDesk); // only a few cm over the desk's side
    // the monitor (above the keyboard) stands in the strip: its glass front faces +Z, short of the desk's side; only the keyboard reaches over
    const kbTop = P.shelfY + KEYBOARD_TOP * P.scale + 1e-4;
    const mon = verts.filter(v => v.y > kbTop);
    expect(Math.max(...mon.map(v => v.z))).toBeCloseTo(P.monitor.z1, 2);
    expect(Math.max(...mon.map(v => v.z))).toBeLessThan(CR.z0);
    for (const v of verts) if (v.z > CR.z0) expect(v.y).toBeLessThanOrEqual(kbTop);
    // above a cab window's sill only the monitor's rounded sides, within 2.5 cm of that window's edge
    for (const w of CAB_WINDOWS) {
      const bad = verts.filter(v => v.x > w.x0 && v.x < w.x1 && v.y >= w.y0 && Math.min(v.x - w.x0, w.x1 - v.x) > 0.025);
      expect(bad.length, `vertices in front of window ${w.x0}..${w.x1} above its sill, past its edge`).toBe(0);
    }
    // the screen patch lies in front of the glass (model frame): no model vertex inside the patch rect stands in front of it
    const S = SAVE_TERMINAL.screen, inv = new THREE.Matrix4();
    s.term.fixture.updateWorldMatrix(true, true);
    inv.copy(s.term.fixture.matrixWorld).invert();
    let inside = 0;
    const front: number[][] = [];
    s.term.model!.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        if (v.x < S.x0 || v.x > S.x1 || v.y < S.y0 || v.y > S.y1) continue;
        inside++;
        const patch = screenGlassZ(v.x, v.y) + S.lift;
        if (v.z >= patch) front.push([v.x, v.y, v.z, patch].map(n => +n.toFixed(4)));
      }
    });
    expect(inside).toBeGreaterThan(10); // (a 4 k-triangle model: the glass is a few big triangles)
    expect(front, 'model vertices in front of the screen patch (x, y, z, patch z)').toEqual([]);
    expect(s.shadows).toContain(s.term.model);
  }, 120000);
});

describe('save terminal: aim, prompt, [E]', () => {
  it('aimed from the drive controls -> its glow + "[E] Save game · slot N" (before the desk\'s coarse box); the desk beside it keeps its own', async () => {
    const gl: GLTF = await loadStripped(SAVE_TERMINAL_MODEL.url);
    const s = setup({term: {model: () => gl.scene}});
    const meshes = s.term.meshes();
    expect(meshes.length).toBeGreaterThan(0);
    const bases = new Map(meshes.map(m => [m, m.material as THREE.Material]));
    // the premise: from the drive controls a ray to the screen's lower right (and to the keyboard) crosses the desk's coarse box FIRST
    // (it covers the terminal's front corner) — so the terminal is tested before the desk, else the desk would take its [E] there
    const S = SAVE_TERMINAL.screen, lowRight = saveTerminalToLocal(P, 0.1, 0.14, screenGlassZ(0.1, 0.14) + S.lift);
    const eye = new THREE.Vector3(OPERATOR.x, SPEC.floorY + STAND_EYE, OPERATOR.z), dir = new THREE.Vector3(lowRight.x, lowRight.y, lowRight.z).sub(eye).normalize();
    const ray = new THREE.Ray(eye, dir), hitAt = (b: THREE.Box3) => ray.intersectBox(b, new THREE.Vector3())?.distanceTo(eye) ?? Infinity;
    const deskBox = new THREE.Box3(new THREE.Vector3(CR.x0, SPEC.floorY, CR.z0), new THREE.Vector3(CR.x1, CR.top, CR.z1));
    const termBox = new THREE.Box3(new THREE.Vector3(P.aim.x0, P.aim.y0, P.aim.z0), new THREE.Vector3(P.aim.x1, P.aim.y1, P.aim.z1));
    expect(hitAt(deskBox)).toBeLessThan(hitAt(termBox));
    expect(hitAt(termBox)).toBeLessThan(TRAIN_DOOR.reach);
    standLook(s, OPERATOR.x, OPERATOR.z, lowRight.x, lowRight.y, lowRight.z);
    frames(s);
    expect([s.rt.saveAimed, s.rt.consoleAimed]).toEqual([true, false]);
    // aimed at the screen's centre from the drive controls: the terminal's
    lookAtScreen(s);
    frames(s);
    expect(s.rt.saveAimed).toBe(true);
    expect(s.rt.consoleAimed).toBe(false);
    expect(prompt(s)).toBe(SAVE_TEXT.prompt(2));
    expect(prompt(s)).toBe('<b>[E]</b> Save game · slot 2');
    for (const m of meshes) {
      expect(m.material).not.toBe(bases.get(m));
      expect((m.material as THREE.MeshStandardMaterial).emissive.r).toBeGreaterThan(0.02);
    }
    expect(s.rt.qa().saveTerminal).toMatchObject({aimed: true, linked: true, box: P.aim});
    // the desk (its middle): the desk's prompt, the terminal dark again
    standLook(s, OPERATOR.x, 0, (CR.x0 + CR.x1) / 2, (SPEC.floorY + CR.top) / 2, 0);
    frames(s);
    expect(s.rt.consoleAimed).toBe(true);
    expect(s.rt.saveAimed).toBe(false);
    expect(prompt(s)).toBe(CONSOLE_PROMPT);
    for (const m of meshes) expect(m.material).toBe(bases.get(m));
    // the desk's controls left of its middle, past the terminal: still the desk's
    standLook(s, OPERATOR.x, OPERATOR.z, CR.x0 + 0.5, SPEC.floorY + 1.05, CR.z0 + 0.3);
    frames(s);
    expect([s.rt.consoleAimed, s.rt.saveAimed]).toEqual([true, false]);
    // from beside the desk's left end (the old operator spot) the screen is the terminal's too
    standLook(s, CR.x0 - 0.75, -0.6, SCREEN.x, SCREEN.y, SCREEN.z);
    frames(s);
    expect(s.rt.saveAimed).toBe(true);
    // from the saloon, through the partition wall: nothing
    standLook(s, SPEC.cab.x0 - 0.45, -0.95, SCREEN.x, SCREEN.y, SCREEN.z);
    frames(s);
    expect(s.rt.saveAimed).toBe(false);
    // too far (3 m back, through the doorway): nothing
    standLook(s, SPEC.cab.x0 - 2.6, 0, SCREEN.x, SCREEN.y, SCREEN.z);
    frames(s);
    expect(s.rt.saveAimed).toBe(false);
    expect(s.api.calls).toBe(0); // aiming never saves
  }, 120000);

  it('[E] saves once through saveNow: success -> "Game saved · slot N" + the click cue + the screen; presses inside the cooldown are ignored', () => {
    const s = setup();
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    lookAtScreen(s);
    frames(s);
    expect(s.rt.saveAimed).toBe(true);
    expect(s.h.interactHandlers.some(f => f())).toBe(true);
    expect(s.api.calls).toBe(1);
    expect(s.rt.counts.save).toBe(1);
    expect(s.toasts).toEqual([['Game saved · slot 2', false]]);
    expect(s.sfx.calls).toEqual(['cue:click']);
    expect(s.term.result).toEqual({ok: true, slot: 2, at: '2026-11-13T10:20:30.000Z'});
    expect(s.term.shown!.lines.slice(3).map(l => l.text)).toEqual([`SAVED ${clockText('2026-11-13T10:20:30.000Z', true)}`, '> [E] SAVE AGAIN']);
    // a second press 0.3 s later: ignored (one save per press)
    t += 300;
    expect(s.h.interactHandlers.some(f => f())).toBe(true);
    expect(s.api.calls).toBe(1);
    expect(s.term.counts.ignored).toBe(1);
    // after the cooldown: a second save; the commit's own warning is shown too
    t += SAVE_RT.cooldownMs;
    s.api.next = {ok: true, slot: 2, meta: meta({revision: 6}), chars: 1300, warning: 'Saved, but the Continue pointer could not be updated.'};
    expect(s.h.interactHandlers.some(f => f())).toBe(true);
    expect(s.api.calls).toBe(2);
    expect(s.toasts.slice(1)).toEqual([['Game saved · slot 2', false], ['Saved, but the Continue pointer could not be updated.', true]]);
  });

  it('a failed save reports the commit\'s OWN error (warn toast + denied + "SAVE FAILED" on the screen); a block is named in the prompt', () => {
    const s = setup();
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const quota = 'Not saved: the storage for the game is full (5.0 MB). Slot 2 still holds its previous save.';
    s.api.next = {ok: false, code: 'quota', error: quota};
    lookAtScreen(s);
    frames(s);
    expect(s.h.interactHandlers.some(f => f())).toBe(true);
    expect(s.toasts).toEqual([[quota, true]]);
    expect(s.sfx.calls).toEqual(['denied']);
    expect(s.term.result).toEqual({ok: false, error: quota});
    const lines = s.term.shown!.lines.slice(3);
    expect(lines[0]).toEqual({text: 'SAVE FAILED', tone: 'warn'});
    expect(lines.slice(1).map(l => l.text).join(' ')).toBe(wrapText('the storage for the game is full (5.0 MB). Slot 2 still holds its previous save.', SCREEN_COLS).slice(0, 3).join(' '));
    // blocked (no slot bound to this run): the prompt says why and promises no [E] save; [E] still answers truthfully
    t += SAVE_RT.cooldownMs + 1;
    const unbound: SaveRefusal = {ok: false, code: 'bad-slot', error: 'Not saved: choose a save slot for this run first.'};
    s.api.block = unbound;
    s.api.next = unbound;
    s.h.currentSlot = null;
    frames(s);
    expect(prompt(s)).toBe('Save terminal · this run has no save slot');
    expect(prompt(s)).not.toMatch(/\[E\]/);
    expect(s.term.shown!.lines[0]).toEqual({text: 'NO SAVE SLOT', tone: 'warn'});
    expect(s.h.interactHandlers.some(f => f())).toBe(true);
    expect(s.toasts.at(-1)).toEqual([unbound.error, true]);
    expect(s.sfx.calls).toEqual(['denied', 'denied']);
  });

  it('a new station (build) forgets the last attempt; a plain teardown detaches it, the next build re-attaches it', () => {
    const s = setup();
    vi.spyOn(performance, 'now').mockImplementation(() => 5000);
    lookAtScreen(s);
    frames(s);
    s.h.interactHandlers.some(f => f());
    expect(s.term.result).not.toBeNull();
    for (const h of s.h.sectionHooks) h.teardown?.();
    expect(s.term.group.parent).toBeNull();
    expect(s.h.warmRegistry.poolRoots()).not.toContain(s.term.group);
    for (const h of s.h.sectionHooks) h.build?.(layout());
    expect(s.term.group.parent).toBe(s.rt.view!.root);
    expect(s.term.result).toBeNull();
    expect(s.term.shown!.lines.at(-1)!.text).toBe('> [E] SAVE GAME_');
  });
});

describe('save terminal: the moving car', () => {
  it('rides on the held view, is aimed in the car\'s frame far from the placement, and says it saves only while the train is stopped', async () => {
    const s = setup();
    vi.spyOn(performance, 'now').mockImplementation(() => 9000);
    const pose = trainSpawnPose(s.h.layout, s.p);
    s.h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
    sync(s);
    void s.ride.depart();
    for (let t = 0; t < 80 && s.ride.phase !== 'transit'; t += DT) frames(s);
    expect(s.ride.phase).toBe('transit');
    expect(s.term.group.parent).toBe(s.rt.view!.root); // carried along with the car's view
    // stand in the cab (car-local) and look at the screen through the car's pose
    s.ride.local.x = OPERATOR.x; s.ride.local.z = OPERATOR.z;
    s.ride.writePlayer();
    const Pl = s.h.player, a = carToWorld(s.ride.pose, SCREEN.x, SCREEN.y, SCREEN.z);
    Pl.yaw = Math.atan2(-(a.x - Pl.x), -(a.z - Pl.z));
    Pl.pitch = Math.atan2(a.y - Pl.eye, Math.hypot(a.x - Pl.x, a.z - Pl.z));
    sync(s);
    frames(s, 2);
    expect(Math.hypot(Pl.x - s.p.x, Pl.z - s.p.z)).toBeGreaterThan(100); // far from the parked placement
    expect(s.rt.saveAimed).toBe(true);
    expect(prompt(s)).toBe(SAVE_TEXT.blocked(refusalShort(MOVING)));
    expect(prompt(s)).toBe('Save terminal · saves only while the train is stopped');
    expect(s.term.shown!.lines.slice(3).map(l => l.text)).toEqual(['SAVES ONLY WHILE THE', 'TRAIN IS STOPPED']);
    // [E]: the refusal, reported (nothing written by the fake either way)
    expect(s.h.interactHandlers.some(f => f())).toBe(true);
    expect(s.toasts.at(-1)).toEqual([MOVING.error, true]);
    // the section's teardown while riding keeps it on the riding view
    const riding = s.rt.view!.root;
    for (const h of s.h.sectionHooks) h.teardown?.();
    expect(s.term.group.parent).toBe(riding);
  });
});

describe('save terminal: the screen model (pure)', () => {
  it('lines for the slot / last save / block / result; refusal reasons short; words wrapped to the screen width', () => {
    const ok = {ok: true, slot: 1, meta: meta({slot: 1, reason: 'new-game'})} as LastSaveStatus;
    expect(saveScreenModel({slot: 1, status: ok, block: null, result: null}).lines.map(l => l.text)).toEqual(['SLOT 1 · ACTIVE', `LAST ${clockText(meta().savedAt)} NEW GAME`, '', '> [E] SAVE GAME_']);
    const manual = {ok: true, slot: 3, meta: meta({slot: 3, reason: 'manual'})} as LastSaveStatus;
    expect(saveScreenModel({slot: 3, status: manual, block: null, result: null}).lines[1].text).toMatch(/ MANUAL$/);
    const empty = {ok: false, reason: 'empty', message: 'Save slot 3 is empty.'} as LastSaveStatus;
    expect(saveScreenModel({slot: 3, status: empty, block: null, result: null}).lines[1].text).toBe('SAVE SLOT 3 IS EMPTY.');
    expect(saveScreenModel({slot: null, status: null, block: null, result: null}).lines[0]).toEqual({text: 'NO SAVE SLOT', tone: 'warn'});
    for (const l of saveScreenModel({slot: 3, status: manual, block: MOVING, result: {ok: false, error: 'x'.repeat(80)}}).lines) expect(l.text.length).toBeLessThanOrEqual(SCREEN_COLS);
    expect(refusalShort({ok: false, code: 'busy', error: 'Not saved: busy — try again in a moment.'})).toBe('busy — try again in a moment');
    expect(refusalShort({ok: false, code: 'outside', error: 'Not saved: step inside the train to save.'})).toBe('step inside the train');
    expect(wrapText('one two three', 7)).toEqual(['ONE TWO', 'THREE']);
    expect(wrapText('abcdefghij', 4)).toEqual(['ABCD', 'EFGH', 'IJ']);
    expect(clockText('not a date')).toBe('--:--');
  });
});

beforeAll(() => { layout(); }, 120000);
