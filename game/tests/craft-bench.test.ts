// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE CRAFTING BENCH's runtime (world/craftBench.ts) on a generated
// Subway layout with the REAL parked train runtime (world/playerTrain.ts), the real Player body and Inventory, the run's real train
// record (its Lockbox) and a FAKE equipment system (tests/helpers/craftBenchFakes.ts: the real one is another lane's):
//  - the fixture: opposite the Lockbox in the rear compartment, on the car's view root, the stand-in of the measured size while there
//    is no cooked model (this test never needs the GLB), swapped for the model when the library has it; it survives a ride;
//  - aim + prompt + [E]: only parked, playing, alive, hands free, the eye in the car, no partition in between, no loose item aimed;
//  - the recipe list opens without pausing, owns the mouse and its keys, crafts through the atomic craft, redraws on changes, and
//    closes on the user, a hit, walking away, any other state, death, the ride starting, teardown.
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {installFakeDom} from './helpers/fakeDom';
import {fakeEquipment, fakeUnit, worldSnapshot} from './helpers/craftBenchFakes';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain, trainColliders, type TrainRideLink} from '../src/world/playerTrain';
import {lockboxFootprint} from '../src/world/trainLockbox';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Inventory} from '../src/items/inventory';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {TRAIN_BENCH_MEASURED} from '../src/assets/trainEquipment.generated';
import {BENCH_AISLE_MIN, benchFootprint, benchPlacement, benchToLocal} from '../src/craft/trainFixtures';
import {RECIPES} from '../src/craft/recipes';
import {CRAFT_TEXT} from '../src/craft/crafting';
import {BENCH_RT, BENCH_TEXT, CraftBenchSystem, craftBenchQaApi, craftedHint, installCraftBench, type CraftBenchOptions} from '../src/world/craftBench';
import {EquipmentChestStore} from '../src/world/equipmentChestStore';
import {EQUIPMENT} from '../src/craft/equipment';

// the train's view needs the canvas shim, the recipe list a (tiny, fake) DOM: one document that serves both
installCanvasShim(false);
const canvasDoc = (globalThis as unknown as {document: {createElement(tag: string): unknown}}).document;
const dom = installFakeDom();
const fakeCreate = dom.doc.createElement;
dom.doc.createElement = ((tag: string) => (tag === 'canvas' ? canvasDoc.createElement(tag) : fakeCreate(tag))) as typeof fakeCreate;
afterAll(() => dom.uninstall());

const DT = 1 / 60;
const B = benchPlacement(SPEC)!;
const FP = benchFootprint(B);
/** The model's +Z front in the car frame (toward the aisle). */
const FRONT = benchToLocal(B, 0, 0, 1).z - B.z;

let layoutCache: StationLayout | null = null;
const layout = (): StationLayout => (layoutCache ??= LEVELS.subway.generate(LEVELS.subway.entry, {levelSeed: 4242}));

class FakeInput implements MoveInput {
  held = new Set<string>();
  locked = true;
  calls = {lock: 0, unlock: 0, lockChange: [] as boolean[]};
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
  /** The game's own handler (an unlock while playing pauses): the views wrap it. */
  onLockChange = (locked: boolean): void => { this.calls.lockChange.push(locked); };
  lock(): Promise<boolean> { this.calls.lock++; this.locked = true; return Promise.resolve(true); }
  unlock(): void { this.calls.unlock++; this.locked = false; }
}

class FakeSfx {
  readonly calls: string[] = [];
  pickup() { this.calls.push('pickup'); }
  denied() { this.calls.push('denied'); }
  voice() { return {}; }
  play(_v: unknown, cue: string) { this.calls.push(`cue:${cue}`); return true; }
  count(k: string) { return this.calls.filter(c => c === k).length; }
}

const live: {rt: PlayerTrainRuntime; bench: CraftBenchSystem}[] = [];
afterEach(() => { for (const {rt, bench} of live.splice(0)) { bench.teardown(); if (rt.train) rt.teardown(); } });

function setup(o: {placement?: TrainPlacement; bench?: CraftBenchOptions; equipment?: boolean} = {}) {
  const lay = layout();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(lay);
  const player = new Player();
  const toasts: string[] = [];
  const sfx = new FakeSfx(), input = new FakeInput(), eq = fakeEquipment();
  const shadows: THREE.Object3D[] = [];
  let held = 0;
  const host = {
    scene, camera, player, zombies: [] as never[], levels, layout: lay, propIndex: new PropIndex(levels, lay.props),
    trainPlacement: (o.placement ?? playerTrainPlacement(lay)) as TrainPlacement | null,
    sfx, hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: () => {}},
    atmosphere: {markShadows: (root: THREE.Object3D) => { shadows.push(root); }},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    sectionModelKeys: [] as ((l: StationLayout) => readonly string[])[],
    hitListeners: [] as ((hit: {amount: number}) => void)[], inputOwners: [] as (() => boolean)[],
    state: 'playing', world: null, input, qa: false, run: {current: {level: 'subway', section: 'main'}, campaign: null},
    playerTrain: new PlayerTrainRecord(), trainRide: {riding: false},
    trainRuntime: undefined as unknown as PlayerTrainRuntime,
    trainEquipment: (o.equipment === false ? null : eq) as ReturnType<typeof fakeEquipment> | null,
    inv: new Inventory(), gear: {session: null as unknown, cancelReady: (_r: boolean) => {}, showResume: () => {}},
    use: null as unknown, currentTarget: null as unknown,
    syncHeld: () => { held++; },
  };
  const rt = installPlayerTrain(host);
  host.trainRuntime = rt;
  const trainHandlers = {interact: host.interactHandlers.length, prompt: host.promptProviders.length};
  const bench = installCraftBench(host as never, o.bench);
  live.push({rt, bench});
  for (const s of host.sectionHooks) s.build?.(lay);
  const setState = (st: string) => { const prev = host.state; host.state = st; for (const f of host.stateListeners) (f as (s: string, p: string) => void)(st, prev); };
  /** The roots the bench marked for shadows (the train marks its own). */
  const benchShadows = () => shadows.filter(o => o.name.startsWith('train-bench'));
  return {host, rt, bench, eq, sfx, input, toasts, benchShadows, trainHandlers, p: rt.train!.placement, syncs: () => held, setState};
}
type Setup = ReturnType<typeof setup>;

function syncCamera(s: Setup): void {
  const P = s.host.player;
  s.host.camera.position.set(P.x, P.y + STAND_EYE, P.z);
  s.host.camera.rotation.set(P.pitch, P.yaw, 0);
  s.host.camera.updateMatrixWorld(true);
}

/** Stand at a train-local floor point, looking at a train-local point. */
function standLooking(s: Setup, lx: number, lz: number, ax: number, ay: number, az: number): void {
  const at = trainToWorld(s.p, lx, SPEC.floorY, lz), aim = trainToWorld(s.p, ax, ay, az);
  const P = s.host.player;
  P.spawn(at.x, at.z, 0, at.y);
  P.yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
  P.pitch = Math.atan2(aim.y - (at.y + STAND_EYE), Math.hypot(aim.x - at.x, aim.z - at.z));
  syncCamera(s);
}

/** Stand `back` m in front of the bench in the aisle, looking at the middle of its worktop. */
function standAtBench(s: Setup, back = 0.45): void {
  standLooking(s, B.x, B.z + FRONT * (B.depth / 2 + back), B.x, B.floorY + B.worktopY, B.z);
}

const frames = (s: Setup, seconds: number) => { for (let i = 0, n = Math.round(seconds / DT); i < n; i++) s.bench.update(DT); };
const key = (code: string, o: Partial<{repeat: boolean}> = {}) => {
  const e = {code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: {tagName: 'BODY'} as never, prevented: 0, stopped: 0,
    preventDefault() { e.prevented++; }, stopPropagation() { e.stopped++; }, ...o};
  return e;
};
const give = (s: Setup, scrap: number, elec: number) => {
  if (scrap) expect(s.host.inv.add(s.host.inv.makeStack(SCRAP_METAL, scrap))).toBe(0);
  if (elec) expect(s.host.inv.add(s.host.inv.makeStack(ELECTRICAL_PARTS, elec))).toBe(0);
};
/** Open the list from in front of the bench (through the game's E handler list). */
function openBench(s: Setup): void {
  standAtBench(s);
  s.bench.update(DT);
  expect(s.host.interactHandlers.some(h => h())).toBe(true);
  expect(s.bench.isOpen).toBe(true);
}

describe('crafting bench: the fixture in the car', () => {
  it('stands in the rear compartment opposite the Lockbox, its front to the aisle, at the measured size', () => {
    const lb = SPEC.lockbox!, lfp = lockboxFootprint(lb), rear = SPEC.rear!;
    const s = setup();
    expect(s.bench.place).toEqual(B);
    expect(Math.sign(B.z)).toBe(-Math.sign(lb.z)); // the other side of the car
    expect(B.side).toBe(Math.sign(B.z));
    expect(FP.x0).toBeGreaterThanOrEqual(rear.x0);
    expect(FP.x1).toBeLessThanOrEqual(rear.x1);
    expect(FP.x1).toBeGreaterThan(lfp.x0); // side by side along the car: they face each other across the aisle
    expect(FP.x0).toBeLessThan(lfp.x1);
    expect(Math.abs(FRONT)).toBe(1);
    expect(Math.sign(FRONT)).toBe(-Math.sign(B.z)); // the front looks at the aisle (and the Lockbox beyond it)
    const benchFront = B.z + FRONT * B.depth / 2, lockFront = lb.z - Math.sign(lb.z) * lb.depth / 2;
    expect(Math.abs(lockFront - benchFront)).toBeGreaterThanOrEqual(BENCH_AISLE_MIN);
    // sizes come from the cook's measurements (whatever they are): never a literal here
    expect([B.length, B.height, B.depth, B.worktopY]).toEqual([TRAIN_BENCH_MEASURED.size.l, TRAIN_BENCH_MEASURED.size.h, TRAIN_BENCH_MEASURED.size.d, TRAIN_BENCH_MEASURED.worktopY]);
    // the fixture group sits at the placement on the car's view root
    expect(s.bench.group.parent).toBe(s.rt.view!.root);
    expect(s.bench.fixture.parent).toBe(s.bench.group);
    expect(s.bench.fixture.position.toArray()).toEqual([B.x, B.floorY, B.z]);
    expect(s.bench.fixture.rotation.y).toBe(B.yaw);
    expect(s.host.warmRegistry.names.pools).toContain('train-bench');
    expect(s.host.warmRegistry.poolRoots()).toContain(s.bench.group);
    expect(s.bench.counts.attached).toBe(1);
    expect(s.bench.qa()).toMatchObject({placed: true, attached: true, model: false, standIn: true, parked: true, at: {x: B.x, z: B.z, side: B.side}});
  });

  it('without the cooked model a stand-in of exactly the measured size stands there; it matches the solid box the train gives it', () => {
    const s = setup();
    const st = s.bench.standIn!;
    expect(st).toBeTruthy();
    expect(s.bench.model).toBeNull();
    s.rt.view!.root.updateMatrixWorld(true);
    // model frame: bottom centre origin
    const local = new THREE.Box3();
    st.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.computeBoundingBox(); local.union(m.geometry.boundingBox!); } });
    expect(local.min.toArray().map(v => +v.toFixed(6))).toEqual([-B.length / 2, 0, -B.depth / 2].map(v => +v.toFixed(6)));
    expect(local.max.toArray().map(v => +v.toFixed(6))).toEqual([B.length / 2, B.height, B.depth / 2].map(v => +v.toFixed(6)));
    const top = st.getObjectByName('train-bench-standin-worktop') as THREE.Mesh;
    expect(top.geometry.boundingBox!.max.y).toBeCloseTo(B.worktopY, 6);
    // in the world: the same footprint as the train's static box for the bench (solid to the worktop), standing on the car floor
    const world = new THREE.Box3().setFromObject(st);
    const a = worldToTrain(s.p, world.min.x, world.min.y, world.min.z), c = worldToTrain(s.p, world.max.x, world.max.y, world.max.z);
    expect(Math.min(a.x, c.x)).toBeCloseTo(FP.x0, 6); expect(Math.max(a.x, c.x)).toBeCloseTo(FP.x1, 6);
    expect(Math.min(a.z, c.z)).toBeCloseTo(FP.z0, 6); expect(Math.max(a.z, c.z)).toBeCloseTo(FP.z1, 6);
    expect(a.y).toBeCloseTo(SPEC.floorY, 6); expect(c.y).toBeCloseTo(SPEC.floorY + B.height, 6);
    const col = trainColliders(SPEC, s.p, null);
    const box = col.statics.find(b => {
      const q = worldToTrain(s.p, b.x - b.hx, 0, b.z - b.hz), r = worldToTrain(s.p, b.x + b.hx, 0, b.z + b.hz);
      return Math.abs(Math.min(q.x, r.x) - FP.x0) < 1e-6 && Math.abs(Math.max(q.x, r.x) - FP.x1) < 1e-6 && Math.abs(Math.min(q.z, r.z) - FP.z0) < 1e-6 && Math.abs(Math.max(q.z, r.z) - FP.z1) < 1e-6;
    });
    expect(box, 'the train collider for the bench').toBeDefined();
    expect(box!.y + box!.h).toBeCloseTo(s.p.railTopY + SPEC.floorY + B.worktopY, 6);
    // plain materials (no textures), nothing ray-pickable, the car's level tag, shadows marked once
    st.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.map).toBeNull();
      expect(m.userData.level).toBe(s.p.level);
      const hits: THREE.Intersection[] = [];
      m.raycast(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)), hits);
      expect(hits).toEqual([]);
    });
    expect(s.benchShadows()).toEqual([st]);
    // no light is added by the bench
    let lights = 0;
    s.bench.group.traverse(o => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
  });

  it('the cooked model replaces the stand-in when the library has it (cloned, shared geometry, shadows marked, never disposed)', () => {
    let src: THREE.Object3D | null = null;
    const s = setup({bench: {model: () => src}});
    expect(s.bench.standIn).toBeTruthy();
    const geo = new THREE.BoxGeometry(1, 1, 0.6), mat = new THREE.MeshStandardMaterial();
    const disposed = vi.fn();
    geo.addEventListener('dispose', disposed);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geo, mat));
    src = scene; // the library loaded it after the first build
    const oldStandIn = s.bench.standIn!;
    s.bench.update(DT);
    expect(s.bench.model).toBeTruthy();
    expect(s.bench.model).not.toBe(scene);
    expect(s.bench.model!.parent).toBe(s.bench.fixture);
    expect(s.bench.standIn).toBeNull();
    expect(oldStandIn.parent).toBeNull();
    const mesh = s.bench.model!.children[0] as THREE.Mesh;
    expect(mesh.geometry).toBe(geo);
    expect(mesh.userData.level).toBe(s.p.level);
    expect(s.benchShadows()).toEqual([oldStandIn, s.bench.model]);
    expect(s.bench.qa()).toMatchObject({model: true, standIn: false});
    // the same source again: nothing is re-cloned
    const m = s.bench.model;
    frames(s, 0.2);
    expect(s.bench.model).toBe(m);
    expect(s.benchShadows().length).toBe(2);
    s.bench.teardown();
    expect(disposed).not.toHaveBeenCalled(); // the library owns the geometry
  });

  it('is detached with the world — but rides with the car: a riding teardown keeps it for the next station\'s build', () => {
    const s = setup();
    const root = s.rt.view!.root;
    // a plain teardown (travel by menu, retry): gone with the view
    for (const h of s.host.sectionHooks) h.teardown?.();
    expect(s.bench.group.parent).toBeNull();
    expect(s.host.warmRegistry.poolRoots()).not.toContain(s.bench.group);
    for (const h of s.host.sectionHooks) h.build?.(layout());
    expect(s.bench.group.parent).toBe(s.rt.view!.root);
    expect(s.bench.counts.attached).toBe(2);
    void root;
    // the ride: the car keeps its view through the teardown
    const p = s.p;
    const link: TrainRideLink = {
      toWorld: (x, y, z) => trainToWorld(p, x, y, z), toLocal: (x, y, z) => worldToTrain(p, x, y, z),
      dirToLocal: (x, y, z) => ({x: x * p.front, y, z: z * p.front}), doorsLocked: true, holdView: true,
    };
    s.rt.ride = link;
    s.host.trainRide.riding = true;
    const riding = s.rt.view!.root;
    for (const h of s.host.sectionHooks) h.teardown?.();
    expect(s.rt.train).toBeNull();
    expect(s.rt.view!.root).toBe(riding);
    expect(s.bench.group.parent).toBe(riding);
    frames(s, 0.5); // frames between the stations: it stays where it is, nothing is usable
    expect(s.bench.group.parent).toBe(riding);
    expect(s.bench.aimed).toBe(false);
    // arrival: the next build adopts the held view; the bench is still on it (not attached a second time)
    for (const h of s.host.sectionHooks) h.build?.(layout());
    s.rt.ride = null;
    s.host.trainRide.riding = false;
    expect(s.rt.view!.root).toBe(riding);
    expect(s.bench.group.parent).toBe(riding);
    expect(s.bench.counts.attached).toBe(2);
    standAtBench(s);
    s.bench.update(DT);
    expect(s.bench.prompt()).toBe(BENCH_TEXT.open);
  });

  it('no bench in a car without a rear compartment: nothing is built, nothing throws', () => {
    const s = setup();
    const spec = {...SPEC, rear: undefined};
    expect(benchPlacement(spec)).toBeNull();
    const bench = new CraftBenchSystem({...s.host, trainRuntime: {...s.rt, spec, view: s.rt.view, carLocal: () => null, carDir: () => null, carPoint: () => null}} as never);
    expect(bench.place).toBeNull();
    expect(bench.attach()).toBe(false);
    bench.update(DT);
    expect(bench.prompt()).toBeNull();
    expect(bench.interact()).toBe(false);
    expect(bench.open()).toBe(false);
    expect(bench.qa()).toMatchObject({placed: false, attached: false, materials: null});
  });
});

describe('crafting bench: aim, prompt and [E]', () => {
  it('registers after the train: the train\'s doors / Lockbox keep their own [E] and prompt', () => {
    const s = setup();
    expect(s.host.interactHandlers.length).toBe(s.trainHandlers.interact + 1);
    expect(s.host.promptProviders.length).toBe(s.trainHandlers.prompt + 1);
    expect(s.bench.chestStore).toBeInstanceOf(EquipmentChestStore);
    expect(s.eq.uses.chest).toBe(s.bench.chestStore!.use);
  });

  it('looking at the bench from the aisle: "[E] Crafting bench"; E opens the recipe list', () => {
    const s = setup();
    standAtBench(s);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(true);
    expect(s.bench.aim()).toBeGreaterThan(0);
    expect(s.bench.aim()!).toBeLessThan(BENCH_RT.reach);
    expect(BENCH_TEXT.open).toBe('<b>[E]</b> Crafting bench');
    expect(s.host.promptProviders.map(f => f()).filter(Boolean)).toEqual([BENCH_TEXT.open]);
    // the carcass counts too (crouching players look at its front), and the back panel above the worktop
    standLooking(s, B.x, B.z + FRONT * (B.depth / 2 + 0.6), B.x, B.floorY + 0.3, B.z + FRONT * B.depth / 2);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(true);
    standLooking(s, B.x, B.z + FRONT * (B.depth / 2 + 0.6), B.x, B.floorY + (B.worktopY + B.height) / 2, B.z - FRONT * B.depth / 2);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(true);
    // E
    expect(s.host.interactHandlers.some(h => h())).toBe(true);
    expect(s.bench.isOpen).toBe(true);
    expect(s.host.state).toBe('playing'); // not paused
    expect(s.input.calls.unlock).toBe(1); // the pointer is released for the list
    expect(s.host.inputOwners.some(f => f())).toBe(true); // ... and the mouse buttons are the view's
    expect(s.bench.view.visible).toBe(true);
    expect(s.bench.view.last!.rows.map(r => r.kind)).toEqual(RECIPES.map(r => r.kind));
    expect(s.toasts).toEqual([]);
    expect(s.bench.prompt()).toBeNull(); // (the open list has its own Close)
  });

  it('not aimed: looking away, out of reach, through a partition wall, from outside the car', () => {
    const s = setup();
    // looking the other way (at the Lockbox)
    standLooking(s, B.x, B.z + FRONT * (B.depth / 2 + 0.45), B.x, B.floorY + 0.4, -B.z);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(false);
    expect(s.bench.prompt()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    expect(s.bench.isOpen).toBe(false);
    // out of reach: from the saloon through the open doorway, more than BENCH_RT.reach from the box
    const far = SPEC.rear!.x1 + 2.2, dw = SPEC.rear!.doorway;
    const frontZ = B.z + FRONT * B.depth / 2;
    /** Where a sight line from (x, z) to the bench front at (tx) crosses the partition plane (z there). */
    const crossZ = (x: number, z: number, tx: number) => z + (frontZ - z) * ((x - SPEC.rear!.x1) / (x - tx));
    expect(crossZ(far, FRONT * 0.3, B.x)).toBeGreaterThan(dw.z0);
    expect(crossZ(far, FRONT * 0.3, B.x)).toBeLessThan(dw.z1); // (the line passes the open doorway: only the distance refuses it)
    standLooking(s, far, FRONT * 0.3, B.x, B.floorY + B.worktopY, frontZ);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(false);
    // ... and from just outside the doorway, through it, it IS in reach (the partition's opening passes the aim)
    const near = SPEC.rear!.x1 + 0.4;
    expect(crossZ(near, FRONT * 0.2, FP.x1 - 0.1)).toBeGreaterThan(dw.z0 + 0.02);
    expect(crossZ(near, FRONT * 0.2, FP.x1 - 0.1)).toBeLessThan(dw.z1 - 0.02);
    standLooking(s, near, FRONT * 0.2, FP.x1 - 0.1, B.floorY + B.worktopY - 0.1, frontZ);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(true);
    expect(s.bench.prompt()).toBe(BENCH_TEXT.open);
    // through the partition's wall (beside the doorway): close enough, but the wall is in between
    const wallZ = B.z; // the bench's own side of the car, well outside the doorway
    expect(Math.abs(wallZ)).toBeGreaterThan(Math.max(Math.abs(SPEC.rear!.doorway.z0), Math.abs(SPEC.rear!.doorway.z1)));
    standLooking(s, SPEC.rear!.x1 + 0.5, wallZ, FP.x1 - 0.05, B.floorY + B.worktopY + 0.1, B.z);
    expect(SPEC.rear!.x1 + 0.5 - FP.x1).toBeLessThan(BENCH_RT.reach);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(false);
    expect(s.bench.interact()).toBe(false);
    // from the platform side outside the car, looking in at it
    standLooking(s, B.x, B.z - FRONT * (B.depth / 2 + 0.9), B.x, B.floorY + B.worktopY, B.z);
    s.bench.update(DT);
    expect(s.bench.aimed).toBe(false);
    expect(s.bench.interact()).toBe(false);
  });

  it('only parked, playing, alive, hands free — and a loose item under the crosshair keeps its own prompt and [E]', () => {
    const s = setup();
    standAtBench(s);
    const ok = () => { s.bench.update(DT); return s.bench.prompt(); };
    expect(ok()).toBe(BENCH_TEXT.open);
    // the train moving (v1: no prompt, no [E])
    s.host.trainRide.riding = true;
    expect(ok()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    expect(s.bench.open()).toBe(false);
    s.host.trainRide.riding = false;
    expect(ok()).toBe(BENCH_TEXT.open);
    // another lane has the hands (a carried body / chest, a grabbed cart, an open Lockbox …)
    let busy = true;
    s.host.inputOwners.push(() => busy);
    expect(ok()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    busy = false;
    expect(ok()).toBe(BENCH_TEXT.open);
    // an item use in progress, a bag view, a ladder climb
    s.host.use = {itemId: 'bandage'};
    expect(ok()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    s.host.use = null;
    s.host.gear.session = {};
    expect(ok()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    s.host.gear.session = null;
    s.host.player.climb = {} as never;
    expect(ok()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    s.host.player.climb = null;
    // dead / not playing
    s.host.player.alive = false;
    expect(ok()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    s.host.player.alive = true;
    s.host.state = 'paused';
    expect(s.bench.prompt()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    s.host.state = 'playing';
    // a loose item on the worktop under the crosshair: the game's pickup prompt / [E] win
    s.host.currentTarget = {stack: {itemId: SCRAP_METAL, count: 1}};
    expect(ok()).toBeNull();
    expect(s.bench.interact()).toBe(false);
    s.host.currentTarget = null;
    expect(ok()).toBe(BENCH_TEXT.open);
    expect(s.bench.isOpen).toBe(false);
    expect(s.bench.counts.opens).toBe(0);
  });

  it('far from the bench the frame costs one distance test: no aim maths, no car-frame calls', () => {
    const s = setup();
    standAtBench(s);
    s.bench.update(DT);
    const P = s.host.player, away = trainToWorld(s.p, B.x + BENCH_RT.near + 1.5, SPEC.floorY, 0);
    P.spawn(away.x, away.z, 0, away.y);
    syncCamera(s);
    const local = vi.spyOn(s.rt, 'carLocal'), dir = vi.spyOn(s.rt, 'carDir'), point = vi.spyOn(s.rt, 'carPoint');
    frames(s, 1);
    expect(s.bench.aimed).toBe(false);
    expect(local).not.toHaveBeenCalled();
    expect(dir).not.toHaveBeenCalled();
    expect(point).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('crafting bench: the recipe list — keys, crafting, redraws', () => {
  it('1–4 craft through the atomic craft: one real unit, the exact cost gone, the toast + note + cue, the list redrawn', () => {
    const s = setup();
    give(s, 9, 4);
    openBench(s);
    const renders = s.bench.view.renders;
    expect(s.bench.view.last!.rows.map(r => r.can)).toEqual([true, true, false, false]);
    // 2 = the route radar (4 scrap / 3 electrical)
    const e = key('Digit2');
    s.bench.onKeyCapture(e);
    expect([e.prevented, e.stopped]).toEqual([1, 1]); // never reaches the quick slots
    expect(s.eq.made.map(u => u.kind)).toEqual(['radar']);
    expect(s.eq.calls.craft).toEqual(['radar']);
    expect(s.host.inv.count(SCRAP_METAL)).toBe(5);
    expect(s.host.inv.count(ELECTRICAL_PARTS)).toBe(1);
    expect(s.toasts).toEqual(['Crafted: Route radar — roll it to a free plug']);
    expect([s.bench.view.note, s.bench.view.noteBad]).toEqual(['Crafted: Route radar — roll it to a free plug', false]);
    expect(s.sfx.calls).toEqual(['pickup', 'cue:clank']); // existing cues only
    expect(s.bench.view.renders).toBeGreaterThan(renders);
    expect(s.bench.view.last!.rows[1].costs.map(c => c.text)).toEqual(['Scrap metal 4 · have 5', 'Electrical parts 3 · have 1 — need 2 more']);
    expect(s.bench.view.last!.totals.map(t => t.text)).toEqual([
      'Scrap metal 5 — carried 5 · backpack 0 · Lockbox 0 · chests 0', 'Electrical parts 1 — carried 1 · backpack 0 · Lockbox 0 · chests 0',
    ]);
    expect(s.syncs()).toBe(1);
    expect(s.bench.isOpen).toBe(true); // crafting does not close the list
    // 1 = the storage chest (2 scrap): the carry hint
    s.bench.onKeyCapture(key('Digit1'));
    expect(s.eq.made.map(u => u.kind)).toEqual(['radar', 'chest']);
    expect(s.toasts[1]).toBe('Crafted: Storage chest — hold E to carry it');
    expect(s.host.inv.count(SCRAP_METAL)).toBe(3);
    // a held key crafts once; 5 / 6 / 0 are swallowed, never a quick slot; W passes (walking)
    for (const code of ['Digit5', 'Digit6', 'Digit0']) { const k = key(code); s.bench.onKeyCapture(k); expect([k.prevented, k.stopped], code).toEqual([1, 1]); }
    const rep = key('Digit1', {repeat: true});
    s.bench.onKeyCapture(rep);
    expect(rep.prevented).toBe(1);
    const w = key('KeyW');
    s.bench.onKeyCapture(w);
    expect([w.prevented, w.stopped]).toEqual([0, 0]);
    expect(s.eq.made.length).toBe(2);
    expect(s.host.inv.count(SCRAP_METAL)).toBe(3);
    expect(s.bench.counts).toMatchObject({crafted: 2, refused: 0});
    expect(s.host.inv.invariants()).toEqual([]);
  });

  it('the hints come from the unit\'s traits', () => {
    expect(craftedHint(EQUIPMENT.chest)).toBe('hold E to carry it');
    for (const k of ['radar', 'sentry', 'scanner'] as const) expect(craftedHint(EQUIPMENT[k])).toBe('roll it to a free plug');
    expect(craftedHint({move: 'dolly', plug: false})).toBe('');
    expect(BENCH_TEXT.crafted('Thing', '')).toBe('Crafted: Thing');
  });

  it('refusals change nothing: missing materials, the equipment system refusing, a failed build (refunded)', () => {
    const s = setup();
    give(s, 3, 0);
    s.host.playerTrain.lockbox.slots[4] = s.host.inv.makeStack(ELECTRICAL_PARTS, 2);
    openBench(s);
    const snap = () => worldSnapshot(s.host.inv, [s.host.playerTrain.lockbox.slots]);
    const before = snap();
    // missing
    const r1 = s.bench.craftIndex(1)!;
    expect(r1).toMatchObject({ok: false, reason: 'missing', text: 'Need 1 more Scrap metal and 1 more Electrical parts'});
    expect([s.bench.view.note, s.bench.view.noteBad]).toEqual(['Need 1 more Scrap metal and 1 more Electrical parts', true]);
    expect(s.sfx.calls).toEqual(['denied']);
    expect(s.eq.calls.craft).toEqual([]);
    // the equipment system refuses (its text is shown on the row and in the note)
    s.eq.block = 'No room on the car floor — move something first';
    frames(s, BENCH_RT.refreshS + 0.05);
    expect(s.bench.view.last!.rows.map(r => r.reason)).toEqual(new Array(4).fill('No room on the car floor — move something first'));
    const r2 = s.bench.craftKind('chest')!;
    expect(r2).toEqual({ok: false, reason: 'blocked', text: 'No room on the car floor — move something first'});
    expect(s.bench.view.noteBad).toBe(true);
    expect(s.eq.calls.craft).toEqual([]);
    // craftBlock allows it but craft() gives nothing: the materials are put back exactly
    s.eq.block = null;
    s.eq.failCraft = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r3 = s.bench.craftKind('chest')!;
    expect(r3).toEqual({ok: false, reason: 'failed', text: CRAFT_TEXT.failed});
    expect(s.bench.view.note).toBe(CRAFT_TEXT.failed);
    expect(s.eq.calls.craft).toEqual(['chest']);
    s.eq.failCraft = false;
    s.eq.throwCraft = true;
    expect(s.bench.craftKind('chest')).toMatchObject({ok: false, reason: 'failed'});
    expect(warn).toHaveBeenCalledTimes(1); // (only the thrown error is logged)
    warn.mockRestore();
    const after = snap();
    expect(after.json).toBe(before.json);
    after.refs.forEach((st, i) => expect(st, `slot ${i}`).toBe(before.refs[i]));
    expect(s.eq.made).toEqual([]);
    expect(s.toasts).toEqual([]);
    expect(s.sfx.count('denied')).toBe(4);
    expect(s.sfx.count('pickup')).toBe(0);
    expect(s.bench.counts).toMatchObject({crafted: 0, refused: 4});
    expect(s.bench.isOpen).toBe(true);
  });

  it('counts and draws from the four sources: carried first, then the worn backpack, the Lockbox, the chests standing in the car', () => {
    const s = setup();
    const inv = s.host.inv, box = s.host.playerTrain.lockbox;
    give(s, 1, 0);
    const bag = inv.makeStack('backpack', 1);
    expect(inv.wearBag(bag)).toBe(true);
    bag.bag![0] = inv.makeStack(SCRAP_METAL, 1);
    box.slots[0] = inv.makeStack(SCRAP_METAL, 1);
    const chest = fakeUnit('chest', 'eq-90'), away = fakeUnit('chest', 'eq-91');
    chest.slots![0] = inv.makeStack(SCRAP_METAL, 5);
    away.slots![0] = inv.makeStack(SCRAP_METAL, 20); // carried about / left on the platform: not aboard
    away.mode = 'held';
    s.eq.list.push(chest, away);
    s.eq.seq = 100;
    openBench(s);
    expect(s.bench.view.last!.totals[0].text).toBe('Scrap metal 8 — carried 1 · backpack 1 · Lockbox 1 · chests 5');
    const v0 = {inv: inv.version, box: box.version, chest: chest.storeVersion};
    // the scanner needs 5 scrap + 5 electrical: short on electrical -> nothing moves
    expect(s.bench.craftKind('scanner')).toMatchObject({ok: false, reason: 'missing'});
    expect([inv.count(SCRAP_METAL), bag.bag![0]!.count, box.slots[0]!.count, chest.slots![0]!.count]).toEqual([1, 1, 1, 5]);
    // two chests (2 scrap each): the first from the pockets + the backpack, the second from the Lockbox + the chest aboard
    expect(s.bench.craftKind('chest')).toMatchObject({ok: true});
    expect([inv.count(SCRAP_METAL), bag.bag![0], box.slots[0]!.count, chest.slots![0]!.count]).toEqual([0, null, 1, 5]);
    expect(s.bench.craftKind('chest')).toMatchObject({ok: true});
    expect([box.slots[0], chest.slots![0]!.count]).toEqual([null, 4]);
    expect(away.slots![0]!.count).toBe(20);
    expect(inv.version).toBeGreaterThan(v0.inv);
    expect(box.version).toBeGreaterThan(v0.box);
    expect(chest.storeVersion).toBe(v0.chest + 1);
    expect(away.storeVersion).toBe(0);
    expect(s.bench.view.last!.totals[0].text).toBe('Scrap metal 4 — carried 0 · backpack 0 · Lockbox 0 · chests 4');
    // (the two new, empty chests are aboard now too: they add nothing)
    expect(s.eq.made.map(u => u.kind)).toEqual(['chest', 'chest']);
    expect(s.eq.made.every(u => u.slots!.every(x => x === null))).toBe(true);
  });

  it('redraws when something it shows changes — at once for the inventory / Lockbox, within the refresh period for the chests', () => {
    const s = setup();
    const chest = fakeUnit('chest', 'eq-5');
    s.eq.list.push(chest);
    s.eq.seq = 5;
    openBench(s);
    let n = s.bench.view.renders;
    frames(s, 1);
    expect(s.bench.view.renders).toBe(n); // nothing changed: nothing is redrawn
    give(s, 2, 0);
    s.bench.update(DT);
    expect(s.bench.view.renders).toBe(n + 1);
    expect(s.bench.view.last!.rows[0].can).toBe(true);
    n = s.bench.view.renders;
    s.host.playerTrain.lockbox.load({v: 1, slots: []}); // (a version bump of the Lockbox)
    s.bench.update(DT);
    expect(s.bench.view.renders).toBe(n + 1);
    n = s.bench.view.renders;
    // a chest's contents changed without any version this view watches: seen within refreshS
    chest.slots![3] = s.host.inv.makeStack(ELECTRICAL_PARTS, 3);
    frames(s, BENCH_RT.refreshS + 0.05);
    expect(s.bench.view.renders).toBe(n + 1);
    expect(s.bench.view.last!.totals[1].text).toBe('Electrical parts 3 — carried 0 · backpack 0 · Lockbox 0 · chests 3');
    n = s.bench.view.renders;
    frames(s, 1);
    expect(s.bench.view.renders).toBe(n);
  });

  it('without an equipment system every row is disabled with the reason; crafting refuses', () => {
    const s = setup({equipment: false});
    give(s, 20, 20);
    openBench(s);
    expect(s.bench.view.last!.rows.map(r => [r.can, r.reason])).toEqual(new Array(4).fill([false, BENCH_TEXT.unavailable]));
    expect(s.bench.craftKind('chest')).toEqual({ok: false, reason: 'blocked', text: BENCH_TEXT.unavailable});
    expect(s.host.inv.count(SCRAP_METAL)).toBe(20);
  });

  it('a closed bench crafts nothing', () => {
    const s = setup();
    give(s, 20, 20);
    expect(s.bench.craftKind('chest')).toBeNull();
    expect(s.bench.craftIndex(0)).toBeNull();
    const e = key('Digit1');
    s.bench.onKeyCapture(e); // closed: the key is the game's (a quick slot)
    expect([e.prevented, e.stopped]).toEqual([0, 0]);
    expect(s.eq.made).toEqual([]);
    expect(s.host.inv.count(SCRAP_METAL)).toBe(20);
  });
});

describe('crafting bench: the recipe list closes', () => {
  it('E / Close: the player closes it and gets the mouse back; Esc / Tab / I close and go on to their own meaning', () => {
    const s = setup();
    openBench(s);
    const e = key('KeyE');
    s.bench.onKeyCapture(e);
    expect([e.prevented, e.stopped]).toEqual([1, 1]); // never the game's interact (it would open it again)
    expect(s.bench.isOpen).toBe(false);
    expect(s.bench.lastClose).toBe('user');
    expect(s.input.calls.lock).toBe(1);
    expect(s.bench.view.visible).toBe(false);
    expect(s.host.inputOwners.some(f => f())).toBe(false);
    // E on the bench through the game's handler while open (the fallback path) closes too
    openBench(s);
    expect(s.bench.interact()).toBe(true);
    expect(s.bench.isOpen).toBe(false);
    for (const code of ['Escape', 'Tab', 'KeyI']) {
      openBench(s);
      const locks = s.input.calls.lock;
      const k = key(code);
      s.bench.onKeyCapture(k);
      expect([k.prevented, k.stopped], code).toEqual([0, 0]); // goes on: pause / inventory
      expect(s.bench.isOpen, code).toBe(false);
      expect(s.bench.lastClose).toBe('state');
      expect(s.input.calls.lock).toBe(locks); // (the next screen owns the pointer)
    }
    expect(s.toasts).toEqual([]);
  });

  it('a hit, walking away, another state, death, the ride starting, teardown', () => {
    const s = setup();
    // a hit (a zero-damage event does not)
    openBench(s);
    for (const f of s.host.hitListeners) f({amount: 0});
    expect(s.bench.isOpen).toBe(true);
    for (const f of s.host.hitListeners) f({amount: 12});
    expect([s.bench.isOpen, s.bench.lastClose]).toEqual([false, 'hit']);
    expect(s.toasts.pop()).toBe(BENCH_TEXT.hit);
    // walking away: still open within closeRange of the footprint, closed beyond it
    openBench(s);
    const P = s.host.player;
    const stand = (lx: number, lz: number) => { const w = trainToWorld(s.p, lx, SPEC.floorY, lz); P.spawn(w.x, w.z, 0, w.y); syncCamera(s); };
    stand(FP.x1 + BENCH_RT.closeRange - 0.1, B.z);
    s.bench.update(DT);
    expect(s.bench.isOpen).toBe(true);
    stand(FP.x1 + BENCH_RT.closeRange + 0.1, B.z);
    s.bench.update(DT);
    expect([s.bench.isOpen, s.bench.lastClose]).toEqual([false, 'distance']);
    expect(s.toasts.pop()).toBe(BENCH_TEXT.far);
    // any state but playing (pause, the inventory, a menu)
    openBench(s);
    s.setState('paused');
    expect([s.bench.isOpen, s.bench.lastClose]).toEqual([false, 'state']);
    s.setState('playing');
    // death
    openBench(s);
    P.alive = false;
    s.bench.update(DT);
    expect([s.bench.isOpen, s.bench.lastClose]).toEqual([false, 'state']);
    P.alive = true;
    // the ride starting
    openBench(s);
    s.host.trainRide.riding = true;
    s.bench.update(DT);
    expect([s.bench.isOpen, s.bench.lastClose]).toEqual([false, 'travel']);
    s.host.trainRide.riding = false;
    // teardown
    openBench(s);
    for (const h of s.host.sectionHooks) h.teardown?.();
    expect([s.bench.isOpen, s.bench.lastClose]).toEqual([false, 'travel']);
    expect(s.toasts).toEqual([]); // only the hit and the distance say something
    expect(s.bench.counts).toMatchObject({opens: 6, closes: 6});
  });

  it('while it is open, losing pointer lock does not pause the game (the wrapped handler is not reached)', () => {
    const s = setup();
    s.input.onLockChange(false); // closed: the game's own handler (it pauses)
    expect(s.input.calls.lockChange).toEqual([false]);
    openBench(s);
    s.input.onLockChange(false); // the view released the pointer itself
    expect(s.input.calls.lockChange).toEqual([false]);
    s.input.onLockChange(true);
    expect(s.input.calls.lockChange).toEqual([false, true]);
  });

  it('the QA hooks drive the same paths (stand, open, craft, close)', () => {
    const s = setup();
    give(s, 2, 0);
    const api = craftBenchQaApi({craftBench: s.bench, player: s.host.player, trainEquipment: s.eq});
    expect(api.benchGo()).toBe(true);
    syncCamera(s);
    s.bench.update(DT);
    expect(api.bench()).toMatchObject({aimed: true, usable: true, prompt: BENCH_TEXT.open, open: false,
      materials: {[SCRAP_METAL]: {total: 2, carried: 2, backpack: 0, lockbox: 0, chests: 0}}});
    expect(api.benchOpen()).toBe(true);
    expect(api.benchCraft('chest')).toMatchObject({ok: true, kind: 'chest'});
    expect(api.benchCraft('sentry')).toMatchObject({ok: false, reason: 'missing'});
    expect(api.bench()).toMatchObject({open: true, noteBad: true, lastCraft: {ok: false, reason: 'missing'}});
    api.benchClose();
    expect(api.bench()).toMatchObject({open: false, lastClose: 'user'});
    expect(api.chestStore()).toMatchObject({open: false, registered: true});
  });
});
