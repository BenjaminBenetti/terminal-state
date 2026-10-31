// Task studio-alpha-track2-round2-20261031 (lane MOTION, R2 water + R4 fan visuals): world/trackExt/motion.ts + machines.ts.
//  - every water / foam vertex carries its flow: channels gate -> culvert, chute steps toward the low end, falls down, basins drift and
//    are stirred near the inlet; the surfaces stay where they were;
//  - the shared water / foam materials read ONE game-clock uniform per WorldMaterials: MachineBuild.update(t) sets it, the same t keeps
//    the field still, and the CPU mirror of the height field changes over time and travels downstream;
//  - the wall fans' blades turn about their own hub axis (hub fixed, tips on a circle in the fan plane, inside the fan's collision
//    box), capped against strobing, while the guards / housing (merged static meshes) never change;
//  - dispose() releases the build's geometries and the rotor InstancedMesh; rebuilding adds no material / uniform; draws bounded.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {installCanvasShim} from './helpers/canvas2d';
import {MACHINE_DIMS, machineBoxes, type AnnexMachine} from '../src/gen/annexRooms';
import type {StationLayout} from '../src/gen/station';
import type {WorldMaterials as WM} from '../src/world/materials';
import {MOTION, flowHeightCpu, motionClock, wallFanRotor} from '../src/world/trackExt/motion';

type Machines = typeof import('../src/world/trackExt/machines');
let mats: WM, M: Machines;
beforeAll(async () => {
  installCanvasShim(false);
  const {WorldMaterials} = await import('../src/world/materials');
  const {TEXTURE_FILES} = await import('../src/assets/manifest');
  M = await import('../src/world/trackExt/machines');
  const tex: Record<string, THREE.Texture> = {};
  for (const k of Object.keys(TEXTURE_FILES)) tex[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  mats = new WorldMaterials(tex as never, 7, {w: 1.2, h: 0.19, d: 0.17});
});

const FLOOR = -6;
let seq = 0;
const rec = (kind: AnnexMachine['kind'], rot: number, w: number, d: number, h: number, p?: number[], x = 20, z = 20): AnnexMachine =>
  ({kind, area: 0, x, z, y: FLOOR, rot, w, d, h, seed: 1000 + 37 * ++seq, ...(p ? {p} : {})});
/** A minimal layout holding `recs` in annex 0's one area (all buildAnnexMachines reads). */
const layoutOf = (recs: AnnexMachine[], annexes = 1): StationLayout => ({
  areas: Array.from({length: annexes}, (_, i) => ({id: i, ceil: FLOOR + 4.2, floorY: FLOOR})),
  extensions: {tunnels: [], annexes: Array.from({length: annexes}, (_, i) => ({id: i, areas: [i]})), machines: recs},
} as unknown as StationLayout);

const meshOf = (b: ReturnType<Machines['buildAnnexMachines']>, k: string) => b.meshes.filter(m => m.name.endsWith(`-${k}`));
/** Per-vertex (position, normal, flow dir, speed, turbulence) of a flow mesh. */
function flowVerts(m: THREE.Mesh) {
  const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, F = g.attributes.flow, U = g.attributes.uv, out = [];
  for (let i = 0; i < P.count; i++) out.push({p: [P.getX(i), P.getY(i), P.getZ(i)], n: [N.getX(i), N.getY(i), N.getZ(i)], d: [F.getX(i), F.getY(i), F.getZ(i)], v: F.getW(i), turb: U.getX(i)});
  return out;
}
const near = (a: readonly number[], b: readonly number[], e = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < e);

describe('R2: the annex water and foam flow (per-vertex flow, unchanged surfaces)', () => {
  it('sewage channels flow gate -> culvert at a slow seeded speed; the water under the crossings flows the same; surfaces in place', () => {
    for (const [rot, dir] of [[0, [1, 0, 0]], [Math.PI / 2, [0, 0, 1]], [Math.PI, [1, 0, 0]], [-Math.PI / 2, [0, 0, 1]]] as const) {
      const m = rec('channel', rot, 8, 2, MACHINE_DIMS.curbH, [-0.75, 0.75]);
      const b = M.buildAnnexMachines(new THREE.Group(), layoutOf([m]), mats);
      const water = flowVerts(meshOf(b, 'water')[0]), foam = flowVerts(meshOf(b, 'foam')[0]);
      for (const v of [...water, ...foam]) {
        expect(near(v.d, dir), `rot ${rot}: ${v.d}`).toBe(true);
        expect(v.v).toBeGreaterThanOrEqual(MOTION.channel.speed[0]);
        expect(v.v).toBeLessThanOrEqual(MOTION.channel.speed[1]);
      }
      expect(new Set(water.map(v => v.v)).size).toBe(1);
      // the water stays at its two heights (open channel 0.03, under the grated crossing 0.01) inside the channel's collision boxes
      expect([...new Set(water.map(v => Math.round((v.p[1] - FLOOR) * 1000)))].sort((a, c) => a - c)).toEqual([10, 30]);
      const boxes = machineBoxes(m);
      for (const v of water) expect(boxes.some(x => Math.abs(v.p[0] - x.x) <= x.hx + 1e-6 && Math.abs(v.p[2] - x.z) <= x.hz + 1e-6) || Math.abs(v.p[1] - FLOOR - 0.01) < 1e-6).toBe(true);
    }
  });

  it('spillway chutes run toward their low end, the falls pour down faster, the inlet weir pours down', () => {
    for (const [p1, dir] of [[0, [1, 0, 0]], [1, [-1, 0, 0]]] as const) {
      const m = rec('chute', 0, 8, 1.75, MACHINE_DIMS.chuteWall, [3, p1, p1 ? 0 : 1, p1 ? 1 : 0]);
      const b = M.buildAnnexMachines(new THREE.Group(), layoutOf([m]), mats);
      const water = flowVerts(meshOf(b, 'water')[0]), foam = flowVerts(meshOf(b, 'foam')[0]);
      for (const v of water) { expect(near(v.d, dir)).toBe(true); expect(v.v).toBeCloseTo(MOTION.chute.speed, 6); }
      // water level of each step descends along the flow
      const byX = [...water].sort((a, c) => (a.p[0] - c.p[0]) * dir[0]);
      expect(byX[0].p[1]).toBeGreaterThan(byX[byX.length - 1].p[1]);
      const falls = foam.filter(v => Math.abs(v.n[1]) < 0.5), landings = foam.filter(v => v.n[1] > 0.5);
      expect(falls.length).toBeGreaterThan(0);
      for (const v of falls) { expect(near(v.d, [0, -1, 0])).toBe(true); expect(v.v).toBeGreaterThan(MOTION.chute.speed); }
      for (const v of landings) expect(near(v.d, dir)).toBe(true);
    }
  });

  it('overflow basins drift slowly away from the inlet and are stirred near the pour, calm far from it', () => {
    const m = rec('basin', 0, 5.5, 4, MACHINE_DIMS.parapet, [1]);
    const b = M.buildAnnexMachines(new THREE.Group(), layoutOf([m]), mats);
    const water = flowVerts(meshOf(b, 'water')[0]);
    const T = MACHINE_DIMS.parapetT, hw = m.w / 2, hd = m.d / 2;
    for (const v of water) {
      expect(near(v.d, [0, 0, 1])).toBe(true);
      expect(v.v).toBeCloseTo(MOTION.basin.drift, 6);
      expect(v.p[1] - FLOOR).toBeCloseTo(0.05, 6);
      expect(v.p[0]).toBeGreaterThanOrEqual(m.x - hw + T - 1e-6); expect(v.p[0]).toBeLessThanOrEqual(m.x + hw - T + 1e-6);
      expect(v.p[2]).toBeGreaterThanOrEqual(m.z - hd - 1e-6); expect(v.p[2]).toBeLessThanOrEqual(m.z + hd - T + 1e-6);
      expect(v.turb).toBeGreaterThanOrEqual(MOTION.basin.turb[0] - 1e-6); expect(v.turb).toBeLessThanOrEqual(MOTION.basin.turb[1] + 1e-6);
    }
    const ix = m.x + 1, lz = m.z - hd + 1.3, d = (v: {p: number[]}) => Math.hypot(v.p[0] - ix, v.p[2] - lz);
    const nearest = water.reduce((a, c) => (d(c) < d(a) ? c : a)), farthest = water.reduce((a, c) => (d(c) > d(a) ? c : a));
    expect(nearest.turb).toBeGreaterThan(0.6);
    expect(farthest.turb).toBeCloseTo(MOTION.basin.turb[0], 6);
    const pour = flowVerts(meshOf(b, 'foam')[0]).filter(v => Math.abs(v.n[1]) < 0.5 && v.v > 1);
    expect(pour.length).toBeGreaterThan(0);
    for (const v of pour) expect(near(v.d, [0, -1, 0])).toBe(true);
  });
});

/** Whether node graph `root` reaches node `target` (three Node.getChildren; TSL proxies compare by node id). */
function reaches(root: unknown, target: unknown, seen = new Set<number>()): boolean {
  const n = root as {id?: number; isNode?: boolean; getChildren?: () => Iterable<unknown>} | null;
  if (!n || typeof n !== 'object' || !n.isNode || seen.has(n.id!)) return false;
  if (n.id === (target as {id: number}).id) return true;
  seen.add(n.id!);
  if (typeof n.getChildren !== 'function') return false;
  for (const c of n.getChildren()) if (reaches(c, target, seen)) return true;
  return false;
}

describe('R2: the flow materials run on the game clock', () => {
  it('update(t) sets the one shared clock uniform; the same t changes nothing; dispose stops it', () => {
    const b = M.buildAnnexMachines(new THREE.Group(), layoutOf([rec('channel', 0, 8, 2, 0.22, [-0.75, 0.75]), rec('basin', 0, 5, 4, 0.92, [0])]), mats);
    const clock = motionClock(mats), water = meshOf(b, 'water')[0].material as THREE.Material & Record<string, unknown>;
    const foam = meshOf(b, 'foam')[0].material as THREE.Material & Record<string, unknown>;
    expect(water).toBe(M.machineMaterial(mats, 'water'));
    for (const m of [water, foam]) {
      expect(m.userData.motion.clock).toBe('game');
      expect(reaches(m.normalNode, clock), `${m.name} normal reads the clock`).toBe(true);
    }
    expect(reaches(water.roughnessNode, clock)).toBe(true);
    b.update(12.5);
    expect(clock.value).toBe(12.5);
    b.update(12.5); // paused: the game clock did not move
    expect(clock.value).toBe(12.5);
    b.update(13);
    expect(clock.value).toBe(13);
    b.dispose();
    b.update(99);
    expect(clock.value).toBe(13);
  });

  it('the water, foam and rotor materials build into real shaders (GLSL backend builder, no GPU): flow attribute, clock uniform', async () => {
    const {compileNodeMaterial} = await import('./helpers/nodeCompile');
    const b = M.buildAnnexMachines(new THREE.Group(), layoutOf([rec('chute', 0, 8, 1.75, 0.8, [3, 0, 1, 1]), rec('fanWall', 0, 2.2, 0.75, 2.35, [1.9])]), mats);
    for (const k of ['water', 'foam']) {
      const sh = compileNodeMaterial(new THREE.Mesh(meshOf(b, k)[0].geometry, meshOf(b, k)[0].material), [new THREE.PointLight()]);
      expect(sh.vertex, k).toMatch(/\bflow\b/); // the per-vertex flow attribute
      expect(sh.fragment, k).toMatch(/annexMotionTime/); // the shared game-clock uniform
      expect(sh.fragment, k).toMatch(/wmNoise/); // the advected value-noise layers
      expect(sh.fragmentMain, k).toMatch(/dFdx/); // the slope bump of the height field
    }
    const rotor = b.rotors!.mesh, sh = compileNodeMaterial(new THREE.InstancedMesh(rotor.geometry, rotor.material, rotor.count), [new THREE.PointLight()]);
    expect(sh.vertex.length).toBeGreaterThan(0);
    b.dispose();
  });

  it('the height field (CPU mirror) changes over time, is still for a repeated t, and travels DOWNSTREAM at the flow speed', () => {
    const v = 0.22, dir = [1, 0, 0], n = [0, 1, 0], pts: number[][] = [];
    for (let i = 0; i < 400; i++) pts.push([3 + (i % 40) * 0.07, FLOOR + 0.03, 7 + Math.floor(i / 40) * 0.05]);
    const at = (t: number, dx = 0) => pts.map(p => flowHeightCpu('water', [p[0] + dx, p[1], p[2]], n, dir, v, 0.55, t));
    const a = at(20), a2 = at(20), b = at(20.5);
    expect(a.map(x => x.h)).toEqual(a2.map(x => x.h));
    const diff = a.reduce((s, x, i) => s + Math.abs(x.h - b[i].h), 0) / a.length;
    expect(diff).toBeGreaterThan(5e-4); // ~0.5 mm mean height change in half a second (slopes are what show)
    // the advected streak layer: the pattern at x and time t is found at x + v dt later (downstream), not at x - v dt
    const dt = 1.5, corr = (p: number[], q: number[]) => {
      const mp = p.reduce((s, x) => s + x, 0) / p.length, mq = q.reduce((s, x) => s + x, 0) / q.length;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < p.length; i++) { sxy += (p[i] - mp) * (q[i] - mq); sxx += (p[i] - mp) ** 2; syy += (q[i] - mq) ** 2; }
      return sxy / Math.sqrt(sxx * syy);
    };
    const now = at(20).map(x => x.n1), down = at(20 + dt, v * dt).map(x => x.n1), up = at(20 + dt, -v * dt).map(x => x.n1);
    expect(corr(now, down)).toBeGreaterThan(0.9);
    expect(corr(now, down)).toBeGreaterThan(corr(now, up) + 0.1);
  });
});

describe('R4: wall-fan rotors', () => {
  const fans = () => [rec('fanWall', -Math.PI / 2, 2.2, 0.75, 2.35, [1.9], 10, 30), rec('fanWall', Math.PI, 2.9, 0.75, 3.05, [2.6], 30, 10), rec('fanWall', 0, 2.15, 0.75, 2.3, [1.85], 50, 50)];
  const apply = (im: THREE.InstancedMesh, k: number, p: readonly number[]) => { const m = new THREE.Matrix4(); im.getMatrixAt(k, m); return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m); };

  it('turn about the hub axis: hub fixed, blade tips on a circle in the fan plane, inside the fan box; guards / housing static', () => {
    const recs = [...fans(), rec('fanUnit', Math.PI / 2, 2.0, 1.5, 3.4, undefined, 70, 20)];
    const g = new THREE.Group(), b = M.buildAnnexMachines(g, layoutOf(recs), mats), R = b.rotors!;
    expect(R).not.toBeNull();
    expect(b.motion.fans).toBe(3); // the inline unit keeps no rotor (no blades show through its casing)
    expect(R.mesh.count).toBe(R.blades);
    expect(R.blades).toBe(R.specs.reduce((n, f) => n + f.blades, 0));
    const statics = b.meshes.filter(m => m !== R.mesh), snap = statics.map(m => Float32Array.from(m.geometry.attributes.position.array as Float32Array));
    const tipX = MOTION.rotor.blade.at + MOTION.rotor.blade.hl;
    b.update(10);
    const tipsAt = () => { const out: THREE.Vector3[] = []; let k = 0; for (const f of R.specs) { for (let j = 0; j < f.blades; j++) out.push(apply(R.mesh, k++, [tipX, 0, 0])); } return out; };
    const t0 = tipsAt();
    b.update(10.05);
    const t1 = tipsAt();
    b.update(10.05); // paused
    expect(tipsAt().map(v => v.toArray())).toEqual(t1.map(v => v.toArray()));
    let k = 0;
    R.specs.forEach((f, i) => {
      const hub = new THREE.Vector3(...f.hub), axis = new THREE.Vector3(...f.axis), m = recs[i], box = machineBoxes(m)[0];
      // the record's hub: local (0, 0.30 + R, -d / 2 + 0.38), axis local +Z = (sin rot, 0, cos rot)
      expect(f).toMatchObject(wallFanRotor(m));
      [Math.sin(m.rot), 0, Math.cos(m.rot)].forEach((c, j) => expect(axis.getComponent(j)).toBeCloseTo(c, 9));
      expect(hub.y - FLOOR).toBeCloseTo(0.3 + f.R, 6);
      const expectStep = Math.min(2 * Math.PI * f.rps * 0.05, MOTION.rotor.maxStep * 2 * Math.PI / f.blades);
      for (let j = 0; j < f.blades; j++, k++) {
        expect(apply(R.mesh, k, [0, 0, 0]).distanceTo(hub)).toBeLessThan(1e-5); // pivot = hub
        for (const tip of [t0[k], t1[k]]) {
          const r = tip.clone().sub(hub);
          expect(r.length()).toBeCloseTo(tipX * f.R, 5); // on the tip circle
          expect(Math.abs(r.dot(axis))).toBeLessThan(1e-5); // in the fan plane
          // inside the fan's own collision box (footprint x height): visual only, no collider needed
          expect(Math.abs(tip.x - box.x)).toBeLessThanOrEqual(box.hx + 1e-6);
          expect(Math.abs(tip.z - box.z)).toBeLessThanOrEqual(box.hz + 1e-6);
          expect(tip.y - FLOOR).toBeGreaterThan(0); expect(tip.y - FLOOR).toBeLessThanOrEqual(box.h);
        }
        const a0 = t0[k].clone().sub(hub), a1 = t1[k].clone().sub(hub);
        const ang = Math.atan2(a0.clone().cross(a1).dot(axis), a0.dot(a1));
        expect(ang).toBeCloseTo(expectStep, 5); // turns forward about +axis by its speed x dt
      }
      expect(f.rps).toBeGreaterThanOrEqual(MOTION.rotor.rps[0]); expect(f.rps).toBeLessThanOrEqual(MOTION.rotor.rps[1]);
      expect(f.blades).toBeGreaterThanOrEqual(5); expect(f.blades).toBeLessThanOrEqual(7);
    });
    // the guards, shroud, hub, motor and supports never move or change
    statics.forEach((m, i) => { expect(m.matrixAutoUpdate).toBe(false); expect(Array.from(m.geometry.attributes.position.array as Float32Array)).toEqual(Array.from(snap[i])); });
    // seeded per fan: different phases / speeds
    expect(new Set(R.specs.map(f => f.rps)).size).toBe(3);
  });

  it('a long frame never strobes backwards (step capped below half the blade spacing); a time jump back is ignored', () => {
    const b = M.buildAnnexMachines(new THREE.Group(), layoutOf(fans()), mats), R = b.rotors!;
    b.update(1);
    const before = R.specs.map((_, i) => R.angleOf(i));
    b.update(2); // a 1 s hitch
    R.specs.forEach((f, i) => {
      const step = (R.angleOf(i) - before[i] + 2 * Math.PI) % (2 * Math.PI);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(MOTION.rotor.maxStep * 2 * Math.PI / f.blades + 1e-9);
      expect(step).toBeLessThan(Math.PI / f.blades);
    });
    const mid = R.specs.map((_, i) => R.angleOf(i));
    b.update(0.5); // a new game clock (never happens in play): no backwards spin
    expect(R.specs.map((_, i) => R.angleOf(i))).toEqual(mid);
  });
});

describe('MachineBuild lifecycle and budget', () => {
  it('dispose releases every geometry and the rotor InstancedMesh; a rebuild reuses the materials / clock; nothing accumulates', () => {
    const recs = () => [rec('channel', 0, 8, 2, 0.22, [-0.75, 0.75]), rec('chute', 0, 8, 1.75, 0.8, [3, 0, 1, 1]), rec('basin', 0, 5, 4, 0.92, [0]), rec('fanWall', 0, 2.2, 0.75, 2.35, [1.9]), rec('boiler', 0, 2, 4, 2.2)];
    const g = new THREE.Group(), a = M.buildAnnexMachines(g, layoutOf(recs()), mats);
    const n = g.children.length, R = a.rotors!;
    expect(n).toBe(a.meshes.length);
    const freed = new Set<unknown>();
    for (const m of a.meshes) m.geometry.addEventListener('dispose', () => freed.add(m.geometry));
    let imFreed = 0;
    R.mesh.addEventListener('dispose', () => imFreed++);
    const matsA = new Map(a.meshes.map(m => [m.name.replace(/^annex-machines-\d+-/, ''), m.material]));
    a.dispose();
    expect(freed.size).toBe(n);
    expect(imFreed).toBe(1);
    expect(g.children.length).toBe(0);
    expect(a.meshes.length).toBe(0);
    a.dispose(); // idempotent
    const b = M.buildAnnexMachines(g, layoutOf(recs()), mats);
    expect(g.children.length).toBe(n);
    for (const m of b.meshes) expect(m.material, m.name).toBe(matsA.get(m.name.replace(/^annex-machines-\d+-/, '')));
    expect(b.rotors!.mesh.material).toBe(R.mesh.material);
    expect(motionClock(mats)).toBe(motionClock(mats));
    b.dispose();
  });

  it('no records: an empty build whose update / dispose are no-ops', () => {
    const g = new THREE.Group(), b = M.buildAnnexMachines(g, layoutOf([]), mats);
    expect(b.meshes.length + b.draws + b.motion.blades).toBe(0);
    expect(b.rotors).toBeNull();
    b.update(3); b.dispose();
    expect(g.children.length).toBe(0);
  });

  it('draws stay one per annex x material + ONE rotor draw per level; rotor triangles = blades x 12; update is cheap', () => {
    const recs = [0, 1].flatMap(an => [rec('channel', 0, 8, 2, 0.22, [-0.75, 0.75]), rec('basin', 0, 5, 4, 0.92, [0]), rec('fanWall', 0, 2.2, 0.75, 2.35, [1.9]), rec('fanWall', 0, 2.2, 0.75, 2.35, [1.9])].map(m => ({...m, area: an})));
    const g = new THREE.Group(), b = M.buildAnnexMachines(g, layoutOf(recs, 2), mats);
    const perAnnex = new Map<number, number>();
    for (const m of b.meshes) if (m !== b.rotors!.mesh) perAnnex.set(m.userData.trackExt.annex, (perAnnex.get(m.userData.trackExt.annex) ?? 0) + 1);
    expect([...perAnnex.keys()].sort()).toEqual([0, 1]);
    for (const c of perAnnex.values()) expect(c).toBeLessThanOrEqual(M.MACHINE_MATS.length);
    expect(b.draws).toBe(b.meshes.length);
    expect(b.meshes.filter(m => (m as THREE.InstancedMesh).isInstancedMesh).length).toBe(1);
    expect(b.motion).toMatchObject({water: 2, foam: 2, fans: 4});
    expect(b.rotors!.mesh.geometry.index!.count / 3).toBe(12);
    const t0 = performance.now();
    for (let i = 1; i <= 600; i++) b.update(i / 60);
    expect((performance.now() - t0) / 600).toBeLessThan(0.5); // ms per frame (CI-safe bound; ~0.01 ms measured locally)
    b.dispose();
  });
});

// Opt-in CPU preview (never in CI): MOTION_PICTURES=1 ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1
// --no-file-parallelism game/tests/annex-motion.test.ts — writes qa-artifacts/r2r4-motion/ (git-ignored): a wall fan at t and
// t + 0.5 s (helpers/meshPreview.ts, albedo + flashlight approximation) and the channel water's shaded slope field (the CPU mirror of
// the shader's height field, top-down) at the same two times. CPU approximations, not the game's GPU look.
describe.runIf(!!process.env.MOTION_PICTURES)('R2 / R4 motion preview pair (MOTION_PICTURES=1)', () => {
  it('renders t and t + 0.5 s', async () => {
    const {renderMeshes} = await import('./helpers/meshPreview');
    const sharp = (await import('sharp')).default;
    const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'qa-artifacts', 'r2r4-motion');
    fs.mkdirSync(out, {recursive: true});
    const fan = rec('fanWall', 0, 2.2, 0.75, 2.35, [1.9], 0, 0);
    const g = new THREE.Group(), b = M.buildAnnexMachines(g, layoutOf([fan]), mats), hub = b.rotors!.specs[0].hub;
    const W = 480, H = 360, notes: string[] = [];
    for (let f = 0; f <= 60 * 30.5; f++) {
      const t = f / 60;
      b.update(t); // played frames at 60 fps
      if (Math.abs(t - 30) > 1e-9 && Math.abs(t - 30.5) > 1e-9) continue;
      const i = t < 30.25 ? 0 : 1;
      const px = renderMeshes(g, {pos: [hub[0] + 0.6, hub[1] + 0.2, hub[2] + 2.6], target: hub, fov: 60, far: 20}, {width: W, height: H, flashlight: true, ambient: 0.35, fog: 0.01});
      await sharp(px, {raw: {width: W, height: H, channels: 3}}).png().toFile(path.join(out, `fan-${i}-t${t}.png`));
      notes.push(`fan t=${t}: angle ${b.rotors!.angleOf(0).toFixed(3)} rad (rps ${b.rotors!.specs[0].rps.toFixed(2)}, ${b.rotors!.specs[0].blades} blades)`);
    }
    // the channel water's height field from above (4 x 2 m, 100 px / m): relief shading of its slopes (what bumps the normal) over
    // the streak layer (what tints the albedo) — exaggerated so the CPU picture shows the pattern and how far it moved
    const S = 200, buf = Buffer.alloc(S * 2 * S * 3), e = 0.004;
    for (const [i, t] of [[0, 30], [1, 30.5]] as const) {
      for (let y = 0; y < S; y++) for (let x = 0; x < 2 * S; x++) {
        const p = [x / S * 2, 0, y / S * 2], at = (dx: number, dz: number) => flowHeightCpu('water', [p[0] + dx, 0, p[2] + dz], [0, 1, 0], [1, 0, 0], 0.22, 0.55, t);
        const sx = (at(e, 0).h - at(-e, 0).h) / (2 * e), sz = (at(0, e).h - at(0, -e).h) / (2 * e), n1 = at(0, 0).n1;
        const c = Math.max(0, Math.min(255, 255 * (0.25 + 0.3 * n1 + 2.2 * (sx * 0.7 + sz * 0.7))));
        buf.set([c * 0.8, c * 0.9, c * 0.85], (y * 2 * S + x) * 3);
      }
      await sharp(buf, {raw: {width: 2 * S, height: S, channels: 3}}).png().toFile(path.join(out, `channel-water-${i}-t${t}.png`));
    }
    notes.push('channel water: 4 x 2 m top-down, flow +X at 0.22 m/s, turbulence 0.55 (CPU mirror of the shader height field)');
    b.dispose();
    // census on real generated Subway levels: draws / triangles / animated parts / update cost per frame
    const {generateStation} = await import('../src/gen/station');
    for (const seed of [2563024239, 774566179]) {
      const L = generateStation(seed), gg = new THREE.Group(), mb = M.buildAnnexMachines(gg, L, mats), an = L.extensions!.annexes.length;
      const t0 = performance.now();
      for (let i = 1; i <= 3600; i++) mb.update(i / 60);
      const ms = (performance.now() - t0) / 3600;
      const flowTris = mb.meshes.filter(m => /-(water|foam)$/.test(m.name)).reduce((n, m) => n + m.geometry.index!.count / 3, 0);
      notes.push(`subway ${seed}: ${an} annexes, ${mb.records} records, ${mb.draws} draws (${mb.motion.water} water + ${mb.motion.foam} foam meshes, 1 rotor), ${mb.triangles} triangles (flow ${flowTris}, rotor ${mb.motion.blades * 12}), ${mb.motion.fans} wall fans / ${mb.motion.blades} blades, update ${(ms * 1000).toFixed(1)} us / frame`);
      mb.dispose();
    }
    fs.writeFileSync(path.join(out, 'notes.txt'), notes.join('\n') + '\n');
  }, 300000);
});
