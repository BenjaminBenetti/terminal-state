// Task studio-surface-map-tent-cab-20261119-025201-01 (lead): the command tent as an up-crossing's preparation space
// (world/surface/tentStage.ts) — its parts, without a Game (tests/surface-lift-ride.test.ts and the connector walks drive the real one):
//  - the tent's box round each real version-2 district's arrival (the Subway car's gate, the Office / Mall tube's mouth): the arrival
//    inside it, the flap's exit just outside it, facing out (the game's yaw);
//  - scanTent: a large mesh belongs by its triangles (not its bounding sphere), an instanced pool by an instance, a small one by its
//    centre; drawSealed draws only what the tent admits and gives every layer back; a small loose object carried in is admitted;
//  - the held flap (world/surface/air.ts holdTentFlap): shut at once (also one saved open), [E] / a push / QA refused with the street's
//    real progress, the record saved meanwhile the one from before the hold, released: a flap that was open opens again (its gas age),
//    a shut one stays shut and works as before;
//  - FrameBudget.run(only): the planning map's frames run the stage's steps, nothing else.
import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import {connectorToWorld} from '../src/gen/surface/connectorShape';
import type {StationLayout} from '../src/gen/stationTypes';
import {STAND_EYE} from '../src/player/player';
import {CULL_LAYER} from '../src/world/levelCulling';
import {FrameBudget} from '../src/core/frameBudget';
import {SURFACE_DOORS_LANE, doorBoxes, fitDoorBoxes, planSurfaceDoors, type SurfaceDoorState} from '../src/world/surface/airDoors';
import {SurfaceAirRuntime} from '../src/world/surface/air';
import {SurfaceTentStage, TENT_STAGE, scanTent, tentFlapExit, tentStageBox, tentStageKey} from '../src/world/surface/tentStage';

const SEAL = (1 << CULL_LAYER) >>> 0;
const firstSeed = (host: 'subway' | 'office' | 'mall'): number => {
  for (let s = 1; s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) return s;
  throw new Error(`no ${host} seed with a Surface Run`);
};
const district = (host: 'subway' | 'office' | 'mall', s: number): StationLayout => LEVELS[host].generate('surface', {levelSeed: s, surfaceVersion: SURFACE_VERSION});
const doorsOf = (L: StationLayout): SurfaceDoorState[] => planSurfaceDoors(L.surface!, L.levels?.[0]?.grid ?? L.grid, L.levels).map(plan => {
  const t = plan.gen === 'closed' ? 0 : 1;
  const d: SurfaceDoorState = {plan, t, target: t as 0 | 1, auto: false, openedAt: NaN, clear: 0, push: 0, blocked: false, boxes: doorBoxes(plan), gas: false};
  fitDoorBoxes(d);
  return d;
});
/** The arrival's eye in the tent: the car's gate (Subway) / just past the tube's tent mouth (Office, Mall) — as the runtimes' exitPoint. */
const arrival = (L: StationLayout): {x: number; y: number; z: number} => {
  const P = L.surface!.portal;
  if (P.lift) return {x: P.lift.door.x, y: P.lift.y + STAND_EYE, z: P.lift.door.z};
  const c = P.connector!, [x, z] = connectorToWorld(c, c.len + 0.35, 0);
  return {x, y: c.y + STAND_EYE, z};
};

const mesh = (geo: THREE.BufferGeometry, name: string, at?: [number, number, number]): THREE.Mesh => {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  m.name = name;
  if (at) m.position.set(...at);
  return m;
};
/** One triangle (world-sized) with its corners given. */
const tri = (a: number[], b: number[], c: number[]): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  return g;
};
const drain = <T>(g: Generator<void, T, void>): {value: T; yields: number} => { let n = 0; for (;;) { const r = g.next(); if (r.done) return {value: r.value, yields: n}; n++; } };

describe('the tent stage: the tent\'s box and the flap\'s exit on real version-2 districts', () => {
  for (const host of ['subway', 'office', 'mall'] as const) {
    it(`${host}: the arrival is in the tent's box; the flap's exit just outside it, facing out`, () => {
      const L = district(host, firstSeed(host)), at = arrival(L);
      const box = tentStageBox(L, at.y - STAND_EYE)!;
      expect(box, 'the district has a tent').toBeTruthy();
      expect(box.containsPoint(new THREE.Vector3(at.x, at.y, at.z)), `the arrival ${JSON.stringify(at)} in the tent ${JSON.stringify(box)}`).toBe(true);
      const flap = doorsOf(L).find(d => d.plan.tent)!;
      expect(flap, 'the tent has its flap').toBeTruthy();
      const ex = tentFlapExit(flap.plan);
      expect(box.containsPoint(new THREE.Vector3(ex.x, ex.y, ex.z)), 'the flap exit is outside the tent').toBe(false);
      expect(Math.hypot(ex.x - flap.plan.x, ex.z - flap.plan.z)).toBeCloseTo(TENT_STAGE.flapOut, 6);
      // (the game's forward: -Z turned by yaw) facing out through the flap
      const fx = -Math.sin(ex.yaw!), fz = -Math.cos(ex.yaw!);
      expect(fx * flap.plan.n[0] + fz * flap.plan.n[1]).toBeGreaterThan(0.999);
      // the flap leaves inside the box (its mesh is the tent's)
      expect(box.containsPoint(new THREE.Vector3(flap.plan.x, flap.plan.floor + 1, flap.plan.z))).toBe(true);
    });
  }
});

describe('the tent stage: scanTent and the sealed draw', () => {
  const box = new THREE.Box3(new THREE.Vector3(0, -1, 0), new THREE.Vector3(10, 6, 8));
  const build = () => {
    const scene = new THREE.Scene();
    const ground = mesh(tri([-50, 0, -50], [50, 0, -50], [0, 0, 60]), 'ground'); // (a 100 m chunk under the tent)
    // a large mesh whose sphere covers the tent but no triangle of it meets the tent's box (two far triangles)
    const far = new THREE.BufferGeometry();
    far.setAttribute('position', new THREE.Float32BufferAttribute([-40, 0, -40, -38, 0, -40, -40, 2, -40, 50, 0, 50, 52, 0, 50, 50, 2, 50], 3));
    const hollow = mesh(far, 'hollow');
    const street = mesh(new THREE.BoxGeometry(20, 10, 20), 'street', [40, 5, 40]);
    const small = mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), 'crate-stock', [5, 0.9, 4]);
    const outside = mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), 'litter', [14, 0.2, 4]);
    // a rotated large mesh (the tube, a canvas wall): its local triangle crosses the box only once turned
    const turned = mesh(tri([-20, 1, 0], [20, 1, 0], [20, 1.2, 0.5]), 'turned', [5, 0, -12]);
    turned.rotation.y = Math.PI / 2; // (local x -> world -z: the triangle runs along z through x = 5)
    const pool = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial(), 3);
    pool.name = 'pool-in';
    const m4 = new THREE.Matrix4();
    pool.setMatrixAt(0, m4.makeTranslation(-80, 0, 0)); pool.setMatrixAt(1, m4.makeTranslation(80, 0, 0)); pool.setMatrixAt(2, m4.makeTranslation(3, 1, 3));
    pool.computeBoundingSphere();
    const pool2 = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial(), 2);
    pool2.name = 'pool-out';
    pool2.setMatrixAt(0, m4.makeTranslation(-80, 0, 0)); pool2.setMatrixAt(1, m4.makeTranslation(80, 0, 0));
    pool2.computeBoundingSphere();
    const sky = mesh(new THREE.SphereGeometry(500), 'sky');
    sky.frustumCulled = false;
    const fx = new THREE.Group();
    const flash = mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), 'fx-flash', [60, 1, 60]);
    fx.add(flash);
    for (const o of [ground, hollow, street, small, outside, turned, pool, pool2, sky, fx]) scene.add(o);
    return {scene, ground, hollow, street, small, outside, turned, pool, pool2, sky, fx, flash};
  };

  it('a large mesh by its triangles, an instanced pool by an instance, a small one by its centre; in steps', () => {
    const w = build();
    const {value: scan} = drain(scanTent(w.scene, box));
    const names = [...scan.set].map(o => o.name).sort();
    expect(names).toEqual(['crate-stock', 'ground', 'pool-in', 'turned']);
    expect(scan.stats.triangleTested, 'the large meshes touching the box tested by triangles').toBeGreaterThanOrEqual(3);
    expect(scan.stats.inTent).toBe(4);
    // a slow clock: one step per slice
    let t = 0;
    const r = drain(scanTent(w.scene, box, () => (t += 5)));
    expect(r.yields, 'the scan yields when its slice is used').toBeGreaterThan(0);
    expect([...r.value.set].map(o => o.name).sort()).toEqual(names);
  });

  it('drawSealed: only what the tent admits is on the camera\'s layers for the draw; every layer back after; a small one carried in is admitted', () => {
    const w = build();
    const stage = new SurfaceTentStage({sectionHooks: []} as never);
    (stage as unknown as {box: THREE.Box3; phase: string}).box = box;
    (stage as unknown as {phase: string}).phase = 'street';
    stage.adopt(drain(scanTent(w.scene, box)).value);
    w.street.layers.mask = SEAL; // (one the level culler culled: stays as it was)
    const before = new Map<THREE.Object3D, number>();
    w.scene.traverse(o => before.set(o, o.layers.mask));
    let drawn: string[] = [];
    const draw = () => { drawn = []; w.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && o.layers.mask !== SEAL) drawn.push(o.name); }); };
    stage.drawSealed(w.scene, [w.fx], draw);
    expect(drawn.sort()).toEqual(['crate-stock', 'fx-flash', 'ground', 'pool-in', 'sky', 'turned']);
    w.scene.traverse(o => expect(o.layers.mask, `${o.name}'s layers back`).toBe(before.get(o)));
    // the player drops / throws a small item into the tent after the scan: drawn; one outside: not
    const dropped = mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), 'dropped', [6, 0.1, 2]);
    w.scene.add(dropped);
    w.scene.updateMatrixWorld(true);
    stage.drawSealed(w.scene, [w.fx], draw);
    expect(drawn).toContain('dropped');
    expect(drawn).not.toContain('litter');
    expect(stage.record).toBeNull(); // (no record without begin(): counted only in a staged crossing)
  });
});

describe('the tent stage: the held tent flap (air.ts)', () => {
  const L = district('subway', firstSeed('subway'));
  const make = (open: boolean) => {
    const saved: Record<string, unknown> = {};
    const toast = vi.fn();
    const host = {scene: new THREE.Scene(), clock: 1000, sfx: {play: () => undefined, playAt: () => undefined}, hud: {toast}, physics: null, player: {x: 0, y: 0, z: 0, alive: true, radius: 0.3}, zombies: [],
      run: {laneStore: (k: string) => saved[k] ?? null, setLaneStore: (k: string, v: unknown) => { saved[k] = v; }}};
    const rt = new SurfaceAirRuntime(host as never);
    const doors = doorsOf(L), flap = doors.find(d => d.plan.tent)!;
    if (open) { flap.t = 1; flap.target = 1; flap.auto = false; flap.openedAt = host.clock - 30; } else { flap.t = 0; flap.target = 0; }
    rt.air = {doors, viewIndex: doors.map(() => -1), doorView: null, field: null} as never;
    return {rt, host, flap, saved, toast};
  };

  it('a shut flap: held shut, [E] / a push / QA refused with the street\'s progress, the record unchanged; released: works as before', () => {
    const {rt, flap, saved, toast} = make(false);
    const why = () => 'The tent flap stays shut — preparing the street 3 / 9';
    expect(rt.holdTentFlap(why)).toBe(true);
    expect(rt.tentFlapHeld).toBe(true);
    expect(rt.open(flap, 'enemy'), 'no push opens it').toBe(false);
    expect(rt.open(flap, 'qa')).toBe(false);
    rt.target = flap;
    expect(rt.prompt()).toBe(why());
    expect(rt.interact(), '[E] taken').toBe(true);
    expect(toast).toHaveBeenCalledWith(why());
    expect(flap.target).toBe(0);
    expect(rt.counts.heldRefusals).toBe(1);
    rt.flush();
    expect((saved[SURFACE_DOORS_LANE] as {doors: Record<string, unknown>}).doors.tent).toEqual({open: 0});
    rt.releaseTentFlap();
    expect(rt.tentFlapHeld).toBe(false);
    expect(flap.target, 'released shut: it stays shut').toBe(0);
    expect(rt.prompt()).toBe('<b>[E]</b> Open the tent flap');
    expect(rt.open(flap, 'player'), 'opens again once released').toBe(true);
  });

  it('a flap saved open: shut at once while held, saved OPEN with its age meanwhile; released: open again, its gas age kept', () => {
    const {rt, host, flap, saved} = make(true);
    expect(rt.holdTentFlap(() => 'held')).toBe(true);
    expect(flap.t, 'shut at once (no frame runs in the transit gap)').toBe(0);
    expect(flap.target).toBe(0);
    expect(Number.isNaN(flap.openedAt)).toBe(true);
    host.clock += 12;
    rt.flush();
    expect((saved[SURFACE_DOORS_LANE] as {doors: Record<string, unknown>}).doors.tent, 'saved as before the hold: open, aged').toEqual({open: 1, age: 42});
    rt.releaseTentFlap();
    expect(flap.target, 'open again').toBe(1);
    expect(flap.auto).toBe(false);
    expect(host.clock - flap.openedAt).toBeCloseTo(42, 6);
    rt.flush();
    expect((saved[SURFACE_DOORS_LANE] as {doors: Record<string, unknown>}).doors.tent).toEqual({open: 1, age: 42});
  });

  it('no tent flap: not held (the crossing is not staged)', () => {
    const {rt} = make(false);
    (rt.air as unknown as {doors: SurfaceDoorState[]}).doors = rt.air!.doors.filter(d => !d.plan.tent);
    expect(rt.holdTentFlap(() => '')).toBe(false);
    expect(rt.tentFlapHeld).toBe(false);
  });
});

describe('FrameBudget.run(only): the map\'s frames run the stage\'s steps only', () => {
  it('runs the accepted keys, keeps the others queued', () => {
    let t = 0;
    const fb = new FrameBudget({now: () => t});
    const ran: string[] = [];
    for (const key of ['render.journey-compile.view', 'crossing.plan', 'loot.refresh']) {
      fb.request({key, kind: key, priority: 1, maxStaleMs: 0, initialEstimateMs: 1, generation: fb.generation, step: () => { ran.push(key); return true; }});
    }
    fb.hold(null);
    fb.beginFrame(16, 0);
    fb.run(tentStageKey);
    expect(ran.sort()).toEqual(['crossing.plan', 'render.journey-compile.view']);
    expect(fb.diagnostics().jobs.map(j => j.key)).toEqual(['loot.refresh']);
    t = 20;
    fb.beginFrame(32, 20);
    fb.run();
    expect(ran).toContain('loot.refresh');
  });
});
