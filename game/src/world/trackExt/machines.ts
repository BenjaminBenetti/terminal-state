// Task track2-playtest-revision-20261031 (lane ROOMS): presentation of the service annexes' anchored MACHINERY
// (layout.extensions.machines, gen/annexRooms.ts AnnexMachine) — boiler banks with pipe headers and flue stacks, generator sets on
// plinths, switchgear lineups, sewage channels with curbs / handrails / grated crossings, overflow basins behind parapets, stepped
// spillway chutes, turbine-generator sets with an overhead crane, wall fans / inline fan units / ducts, louvres, pipe runs.
//
// Locally authored procedural geometry only (zero provider / model / texture generation): boxes and cylinders in each record's
// local frame (origin = footprint centre on the floor, local X along w, local Z along d, front +Z, yawed by rot), merged into ONE
// mesh per (annex, material) — about a dozen draws per annex, bounded triangles (stats). Materials are value-only clones of the
// shared world-mapped shape materials (world/shapeMaterials.ts: painted / brushed steel, panel, concrete, grille, black) — the
// same programs, no texture loads; the water / foam are motion.ts's animated flow materials (same colour / roughness values as the
// old glossy dark clone of the black surface / the panel foam). Built into the station group at build
// time (warm-up discoverable, docs/rendering-warmup.md). The solid parts match the collision boxes (gen machineBoxes): visual-only
// parts stay within 0.28 m of a wall, above 2.2 m, flat on the floor or over a blocked footprint.
//
// Task track2-round2 (lane MOTION, world/trackExt/motion.ts): the water and foam move (each vertex carries its flow: channels
// gate -> culvert, chute steps toward the low end, falls down, basins drift / stir; two animated materials shared by every annex)
// and the wall fans' blades turn (one InstancedMesh per level, a blade per instance, about each fan's hub axis). MachineBuild
// .update(t) advances both on the game clock (Game.update), .dispose() releases what the build made (Game.leaveSection).

import * as THREE from 'three';
import type {StationLayout} from '../../gen/station';
import {CELL} from '../../gen/grid';
import {MACHINE_DIMS, channelSegments, chuteStepLevel, chuteSteps, type AnnexMachine} from '../../gen/annexRooms';
import {cloneSurfaceMaterial, type WorldMaterials} from '../materials';
import {shapeMaterial} from '../shapeMaterials';
import {Acc, hashOf, prng} from './mesh';
import {FlowAcc, MOTION, RotorSet, flowMaterial, motionClock, rotorMaterial, wallFanRotor, type FlowState, type RotorSpec} from './motion';

/** Machinery material keys. */
export type MachineMat = 'boiler' | 'genset' | 'turbine' | 'grey' | 'galv' | 'dark' | 'yellow' | 'concrete' | 'water' | 'foam' | 'grate' | 'black' | 'lagging';
export const MACHINE_MATS: readonly MachineMat[] = ['boiler', 'genset', 'turbine', 'grey', 'galv', 'dark', 'yellow', 'concrete', 'water', 'foam', 'grate', 'black', 'lagging'];

/** Base shape material, colour, roughness / metalness overrides of each machinery material (value-only clones: shared programs). */
const SPEC: Readonly<Record<MachineMat, {base: string; color?: number; rough?: number; metal?: number}>> = {
  boiler: {base: 'accent', color: 0x7e2e22, rough: 0.8, metal: 0.25},
  genset: {base: 'accent', color: 0xb98d26, rough: 0.75, metal: 0.2},
  turbine: {base: 'accent', color: 0x4a627a, rough: 0.7, metal: 0.3},
  grey: {base: 'panel', color: 0x949a96, rough: 0.8, metal: 0.2},
  galv: {base: 'steelBright', color: 0xb4b8ba, rough: 0.55, metal: 0.55},
  dark: {base: 'steelDark', color: 0x45484b, metal: 0.35},
  yellow: {base: 'accent', color: 0xd2a419, rough: 0.7, metal: 0.15},
  concrete: {base: 'concrete'},
  water: {base: 'black', color: 0x34443a, rough: 0.1, metal: 0.05},
  foam: {base: 'panel', color: 0x8fa39b, rough: 0.35, metal: 0},
  grate: {base: 'grille', color: 0x707476, metal: 0.45},
  black: {base: 'black', color: 0x0b0b0b, rough: 0.95},
  lagging: {base: 'panel', color: 0xcfc8b6, rough: 0.95, metal: 0},
};

const matCache = new WeakMap<WorldMaterials, Map<MachineMat, THREE.Material>>();
/** The machinery material `k` (one per WorldMaterials). */
export function machineMaterial(mats: WorldMaterials, k: MachineMat): THREE.Material {
  let c = matCache.get(mats);
  if (!c) matCache.set(mats, (c = new Map()));
  let m = c.get(k);
  if (!m && (k === 'water' || k === 'foam')) c.set(k, (m = flowMaterial(mats, k, SPEC[k]))); // (lane MOTION) animated, same values
  if (!m) {
    const s = SPEC[k], src = shapeMaterial(mats, s.base);
    m = s.color === undefined && s.rough === undefined && s.metal === undefined ? src : cloneSurfaceMaterial(src);
    const sm = m as THREE.MeshStandardMaterial;
    if (m !== src) {
      if (s.color !== undefined && sm.color) sm.color.setHex(s.color);
      if (s.rough !== undefined) sm.roughness = s.rough;
      if (s.metal !== undefined) sm.metalness = s.metal;
      m.name = `annex-machine-${k}`;
    }
    c.set(k, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Geometry: a record-local builder over per-material accumulators

type V = [number, number, number];

class Build {
  private ox = 0; private oy = 0; private oz = 0; private c = 1; private s = 0;
  /** (lane MOTION) The flow every water / foam vertex takes (world direction, m/s, turbulence); see flow(). */
  private readonly fs: FlowState = {dx: 1, dy: 0, dz: 0, speed: 0, turb: 0.4};
  constructor(private readonly accs: Map<MachineMat, Acc>) {}
  /** Record frame: origin (x, y, z), yaw rot (local X -> (cos, 0, -sin), local Z -> (sin, 0, cos)). */
  frame(m: AnnexMachine): void { this.ox = m.x; this.oy = m.y; this.oz = m.z; this.c = Math.cos(m.rot); this.s = Math.sin(m.rot); this.flow([1, 0, 0], 0, 0.4); }
  private acc(k: MachineMat): Acc {
    let a = this.accs.get(k);
    if (!a) this.accs.set(k, (a = k === 'water' || k === 'foam' ? new FlowAcc(this.fs) : new Acc()));
    return a;
  }
  /** (lane MOTION) Flow of the next water / foam vertices: LOCAL direction (unit), speed (m/s), turbulence 0..1. */
  flow(dir: V, speed: number, turb: number): void {
    const d = this.d(...dir);
    Object.assign(this.fs, {dx: d[0], dy: d[1], dz: d[2], speed, turb});
  }
  /**
   * (lane MOTION) Horizontal quad at height y split into cells of about `cell` m, each vertex with its own turbulence `turb(x, z)`
   * (local) — an overflow basin stirred near its inlet and calm far from it. The current flow direction and speed.
   */
  flowGrid(k: MachineMat, x0: number, z0: number, x1: number, z1: number, y: number, cell: number, turb: (x: number, z: number) => number): void {
    const a = this.acc(k), n: V = [0, 1, 0], nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell)), ids: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      this.fs.turb = turb(x, z);
      ids.push(a.v(this.p(x, y, z), n, 0, 0));
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const q = j * (nx + 1) + i;
      a.quad(ids[q], ids[q + 1], ids[q + nx + 2], ids[q + nx + 1]);
    }
  }
  private p(x: number, y: number, z: number): V { return [this.ox + x * this.c + z * this.s, this.oy + y, this.oz - x * this.s + z * this.c]; }
  private d(x: number, y: number, z: number): V { return [x * this.c + z * this.s, y, -x * this.s + z * this.c]; }
  /** Local axis-aligned box. */
  box(k: MachineMat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    this.acc(k).box(this.p((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], this.d(1, 0, 0), [0, 1, 0], this.d(0, 0, 1));
  }
  /** Box rotated by `a` about the local Z axis through its centre (fan blades, slats). */
  boxRotZ(k: MachineMat, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, a: number, tilt = 0): void {
    // long axis in the local X-Y plane at angle a; width axis w beside it; pitched by `tilt` about the long axis
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(tilt), st = Math.sin(tilt);
    const ax: V = [ca, sa, 0], w: V = [-sa, ca, 0];
    const ay: V = [w[0] * ct, w[1] * ct, st], az: V = [-w[0] * st, -w[1] * st, ct];
    this.acc(k).box(this.p(cx, cy, cz), [hx, hy, hz], this.d(...ax), this.d(...ay), this.d(...az));
  }
  /** Horizontal quad (top face only) at height y. */
  plane(k: MachineMat, x0: number, z0: number, x1: number, z1: number, y: number): void {
    const a = this.acc(k), n: V = [0, 1, 0];
    const i0 = a.v(this.p(x0, y, z0), n, 0, 0), i1 = a.v(this.p(x1, y, z0), n, 1, 0), i2 = a.v(this.p(x1, y, z1), n, 1, 1), i3 = a.v(this.p(x0, y, z1), n, 0, 1);
    a.quad(i0, i1, i2, i3);
  }
  /** Vertical quad facing local +X or -X / +Z or -Z (water falls). `axis` = the plane's normal axis. */
  wall(k: MachineMat, axis: 'x' | 'z', at: number, a0: number, a1: number, y0: number, y1: number, sign: 1 | -1): void {
    const A = this.acc(k), n = axis === 'x' ? this.d(sign, 0, 0) : this.d(0, 0, sign);
    const P = (u: number, y: number) => (axis === 'x' ? this.p(at, y, u) : this.p(u, y, at));
    const i0 = A.v(P(a0, y0), n, 0, 0), i1 = A.v(P(a1, y0), n, 1, 0), i2 = A.v(P(a1, y1), n, 1, 1), i3 = A.v(P(a0, y1), n, 0, 1);
    A.quad(i0, i1, i2, i3);
  }
  /**
   * Cylinder along a local axis from t0 to t1 through (u, v) (axis 'x': u = y, v = z; 'y': u = x, v = z; 'z': u = x, v = y);
   * `caps` closes the ends; `open` draws the inside too (shrouds).
   */
  cyl(k: MachineMat, axis: 'x' | 'y' | 'z', u: number, v: number, t0: number, t1: number, r: number, seg = 14, caps = true): void {
    const a = this.acc(k);
    const at = (t: number, ang: number, rr: number): V => {
      const cu = Math.cos(ang) * rr, sv = Math.sin(ang) * rr;
      return axis === 'x' ? this.p(t, u + cu, v + sv) : axis === 'y' ? this.p(u + cu, t, v + sv) : this.p(u + cu, v + sv, t);
    };
    const nrm = (ang: number): V => {
      const cu = Math.cos(ang), sv = Math.sin(ang);
      return axis === 'x' ? this.d(0, cu, sv) : axis === 'y' ? this.d(cu, 0, sv) : this.d(cu, sv, 0);
    };
    const ring0: number[] = [], ring1: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2, n = nrm(ang);
      ring0.push(a.v(at(t0, ang, r), n, 0, 0));
      ring1.push(a.v(at(t1, ang, r), n, 0, 0));
    }
    for (let i = 0; i < seg; i++) a.quad(ring0[i], ring0[i + 1], ring1[i + 1], ring1[i]);
    if (!caps) return;
    for (const [t, sg] of [[t0, -1], [t1, 1]] as const) {
      const n = axis === 'x' ? this.d(sg, 0, 0) : axis === 'y' ? this.d(0, sg, 0) : this.d(0, 0, sg);
      const ids: number[] = [];
      for (let i = 0; i < seg; i++) ids.push(a.v(at(t, (i / seg) * Math.PI * 2, r), n, 0, 0));
      a.fan(ids);
    }
  }
  /** Open tube (both faces) — fan shrouds, guard rings. */
  tube(k: MachineMat, axis: 'x' | 'y' | 'z', u: number, v: number, t0: number, t1: number, r: number, seg = 18): void {
    this.cyl(k, axis, u, v, t0, t1, r, seg, false);
    // inner face: the same ring wound the other way (normals inward)
    const a = this.acc(k);
    const at = (t: number, ang: number): V => {
      const cu = Math.cos(ang) * r * 0.985, sv = Math.sin(ang) * r * 0.985;
      return axis === 'x' ? this.p(t, u + cu, v + sv) : axis === 'y' ? this.p(u + cu, t, v + sv) : this.p(u + cu, v + sv, t);
    };
    const nrm = (ang: number): V => { const cu = -Math.cos(ang), sv = -Math.sin(ang); return axis === 'x' ? this.d(0, cu, sv) : axis === 'y' ? this.d(cu, 0, sv) : this.d(cu, sv, 0); };
    const r0: number[] = [], r1: number[] = [];
    for (let i = 0; i <= seg; i++) { const ang = (i / seg) * Math.PI * 2, n = nrm(ang); r0.push(a.v(at(t0, ang), n, 0, 0)); r1.push(a.v(at(t1, ang), n, 0, 0)); }
    for (let i = 0; i < seg; i++) a.quad(r0[i], r0[i + 1], r1[i + 1], r1[i]);
  }
  /** Railing along local X at z: posts every `step` m from y0 to y1, top + mid rails. */
  railX(k: MachineMat, x0: number, x1: number, z: number, y0: number, y1: number, step = 1.25): void {
    const n = Math.max(1, Math.round((x1 - x0) / step));
    for (let i = 0; i <= n; i++) this.cyl(k, 'y', x0 + ((x1 - x0) * i) / n, z, y0, y1, 0.024, 6, false);
    this.cyl(k, 'x', y1, z, x0, x1, 0.026, 6, false);
    this.cyl(k, 'x', y0 + (y1 - y0) * 0.5, z, x0, x1, 0.02, 6, false);
  }
  /** Railing along local Z at x. */
  railZ(k: MachineMat, z0: number, z1: number, x: number, y0: number, y1: number, step = 1.25): void {
    const n = Math.max(1, Math.round((z1 - z0) / step));
    for (let i = 0; i <= n; i++) this.cyl(k, 'y', x, z0 + ((z1 - z0) * i) / n, y0, y1, 0.024, 6, false);
    this.cyl(k, 'z', x, y1, z0, z1, 0.026, 6, false);
    this.cyl(k, 'z', x, y0 + (y1 - y0) * 0.5, z0, z1, 0.02, 6, false);
  }
}

/** Small seeded PRNG per record (variation only). */
function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Assemblies (local frame; `ceil` = the room's ceiling above the floor)

function boiler(b: Build, m: AnnexMachine, ceil: number): void {
  const hw = m.w / 2, hd = m.d / 2, D = m.p?.[0] ?? 1.45, R = D / 2, cy = 0.38 + R, z0 = -hd + 0.3, z1 = hd - 0.5, r = rnd(m.seed);
  // saddles + base rails
  for (const z of [z0 + 0.45, z1 - 0.45]) b.box('dark', -R + 0.08, 0, z - 0.16, R - 0.08, cy - R * 0.55, z + 0.16);
  b.box('dark', -R + 0.05, 0, z0, -R + 0.2, 0.12, z1); b.box('dark', R - 0.2, 0, z0, R - 0.05, 0.12, z1);
  // the shell, its bands, the front tube sheet and the rear smoke box
  b.cyl('boiler', 'z', 0, cy, z0, z1, R, 22);
  for (let k = 1; k <= 3; k++) { const z = z0 + ((z1 - z0) * k) / 4; b.cyl('dark', 'z', 0, cy, z - 0.035, z + 0.035, R + 0.025, 22); }
  b.cyl('grey', 'z', 0, cy, z1, z1 + 0.06, R + 0.03, 22);
  b.cyl('dark', 'z', 0, cy, z0 - 0.08, z0, R * 0.92, 22);
  // burner: housing, blower drum, fuel train, control box
  b.box('grey', -0.36, cy - 0.38, z1 + 0.06, 0.36, cy + 0.32, hd - 0.04);
  b.cyl('grey', 'y', 0.42, z1 + 0.28, cy - 0.3, cy + 0.15, 0.2, 12);
  b.cyl('yellow', 'x', cy - 0.48, z1 + 0.2, -R * 0.8, -0.36, 0.035, 6);
  b.box('grey', R * 0.55, cy + 0.2, z1 + 0.06, R * 0.55 + 0.32, cy + 0.62, z1 + 0.26);
  b.box('black', R * 0.55 + 0.04, cy + 0.32, z1 + 0.26, R * 0.55 + 0.28, cy + 0.5, z1 + 0.27);
  // gauges / sight glass on the front, safety valves and a manway on top
  b.cyl('black', 'z', -R * 0.45, cy + R * 0.55, z1 + 0.06, z1 + 0.1, 0.07, 10);
  b.box('black', -R * 0.75, cy - 0.1, z1 + 0.06, -R * 0.68, cy + 0.35, z1 + 0.1);
  for (const x of [-0.25, 0.25]) b.cyl('yellow', 'y', x, z0 + 0.9 + r() * 0.3, cy + R - 0.02, cy + R + 0.28, 0.055, 8);
  b.cyl('dark', 'y', 0, (z0 + z1) / 2, cy + R - 0.03, cy + R + 0.1, 0.24, 14);
  // flue stack from the rear top into the ceiling (inside the footprint), a breeching collar
  const fz = z0 + 0.35;
  b.cyl('dark', 'y', 0, fz, cy + R * 0.7, Math.max(cy + R + 0.2, ceil - 0.01), 0.21, 12, false);
  b.cyl('dark', 'y', 0, fz, cy + R + 0.25, cy + R + 0.33, 0.25, 12);
  // feed / blowdown pipe low at the side
  b.cyl('lagging', 'z', -R - 0.02 + 0.12, 0.42, z0, z1 - 0.1, 0.06, 8);
  void hw;
}

function header(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, y = m.p?.[0] ?? 2.4, z = -hd + 0.16;
  b.cyl('lagging', 'x', y, z, -hw, hw, 0.13, 14);
  b.cyl('dark', 'x', y - 0.24, -hd + 0.09, -hw, hw, 0.06, 8);
  for (let x = -hw + 0.4; x <= hw - 0.3; x += 1.5) b.box('dark', x - 0.03, y - 0.32, -hd, x + 0.03, y + 0.16, z + 0.02);
  // branch drops toward each boiler (offsets p[1..]): a valve and a stub over the boiler footprint
  for (const ox of (m.p ?? []).slice(1)) {
    b.cyl('lagging', 'y', ox, z, y - 0.55, y, 0.08, 10);
    b.cyl('dark', 'y', ox, z, y - 0.42, y - 0.3, 0.12, 10);
    b.cyl('yellow', 'z', ox, y - 0.36, z + 0.12, z + 0.16, 0.12, 10);
    b.cyl('lagging', 'z', ox, y - 0.55, z, hd + 0.35, 0.08, 10);
  }
}

function genset(b: Build, m: AnnexMachine, ceil: number): void {
  const hw = m.w / 2, hd = m.d / 2, top = m.h;
  b.box('concrete', -hw, 0, -hd, hw, 0.15, hd);
  for (const s of [-1, 1]) b.box('yellow', -hw, 0.15, s * hd - (s > 0 ? 0.05 : 0), hw, 0.165, s * hd + (s < 0 ? 0.05 : 0));
  b.box('dark', -hw + 0.1, 0.15, -hd + 0.12, hw - 0.1, 0.28, hd - 0.12);
  // radiator end (-X), engine block, rocker covers, turbo / air filter, alternator (+X), control box
  const rx0 = -hw + 0.12, rx1 = rx0 + 0.42;
  b.box('genset', rx0, 0.28, -hd + 0.15, rx1, top, hd - 0.15);
  b.box('grate', rx0 - 0.02, 0.4, -hd + 0.22, rx0, top - 0.12, hd - 0.22);
  const ex0 = rx1 + 0.12, ex1 = hw - 1.25;
  b.box('genset', ex0, 0.28, -hd + 0.28, ex1, 1.08, hd - 0.28);
  b.box('genset', ex0 + 0.1, 1.08, -0.3, ex1 - 0.1, 1.28, 0.3);
  for (let x = ex0 + 0.25; x < ex1 - 0.15; x += 0.42) b.cyl('dark', 'y', x, 0, 1.28, 1.36, 0.07, 8);
  b.cyl('dark', 'z', ex0 + 0.3, 1.25, hd - 0.28, hd - 0.05, 0.16, 12);
  b.cyl('dark', 'y', ex1 - 0.3, -hd + 0.4, 1.08, 1.42, 0.17, 12);
  b.cyl('grey', 'x', 0.28 + 0.44, 0, ex1, hw - 0.2, 0.44, 18);
  b.cyl('dark', 'x', 0.28 + 0.44, 0, hw - 0.2, hw - 0.12, 0.34, 18);
  b.box('grey', ex1 + 0.2, 0.28 + 0.9, hd - 0.38, hw - 0.3, 0.28 + 1.38, hd - 0.12);
  b.box('black', ex1 + 0.28, 0.28 + 1.02, hd - 0.12, hw - 0.38, 0.28 + 1.3, hd - 0.11);
  // exhaust: silencer on a frame over the engine, riser into the ceiling (inside the footprint)
  const sy = Math.min(top + 0.25, ceil - 0.5);
  b.cyl('lagging', 'x', sy, -hd + 0.42, ex0, ex1, 0.2, 14);
  b.box('dark', ex0 + 0.1, 1.08, -hd + 0.36, ex0 + 0.16, sy, -hd + 0.48); b.box('dark', ex1 - 0.16, 1.08, -hd + 0.36, ex1 - 0.1, sy, -hd + 0.48);
  b.cyl('dark', 'y', ex1 - 0.1, -hd + 0.42, sy, ceil - 0.01, 0.11, 10, false);
}

function switchgear(b: Build, m: AnnexMachine, ceil: number): void {
  const hw = m.w / 2, hd = m.d / 2, n = Math.max(1, Math.round(m.p?.[0] ?? m.w / 0.8)), pw = m.w / n, h = m.h, r = rnd(m.seed);
  b.box('dark', -hw, 0, -hd, hw, 0.08, hd);
  for (let k = 0; k < n; k++) {
    const x0 = -hw + k * pw, x1 = x0 + pw;
    b.box('grey', x0 + 0.005, 0.08, -hd, x1 - 0.005, h, hd - 0.03);
    b.box('grey', x0 + 0.05, 0.2, hd - 0.03, x1 - 0.05, h - 0.12, hd - 0.01);
    b.box('dark', x1 - 0.12, h * 0.45, hd - 0.01, x1 - 0.09, h * 0.6, hd + 0.02);
    b.box('grate', x0 + 0.12, 0.14, hd - 0.012, x1 - 0.12, 0.34, hd);
    // meters / lamps / a mimic strip
    b.box('black', x0 + 0.15, h - 0.5, hd - 0.012, x1 - 0.15, h - 0.3, hd);
    for (let j = 0; j < 3; j++) b.cyl(r() < 0.5 ? 'yellow' : 'black', 'z', x0 + 0.2 + j * (pw - 0.4) / 2, h - 0.64, hd - 0.012, hd + 0.01, 0.025, 6);
    b.box('yellow', x0 + 0.05, h - 0.12, hd - 0.012, x1 - 0.05, h - 0.09, hd);
  }
  // cable tray from the lineup top into the ceiling, along the wall (inside the footprint)
  if (ceil - h > 0.15) {
    b.box('dark', -hw + 0.1, h, -hd + 0.05, hw - 0.1, h + 0.04, -hd + 0.4);
    b.box('dark', -hw + 0.1, h + 0.04, -hd + 0.05, -hw + 0.4, ceil - 0.01, -hd + 0.15);
  }
}

function channel(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, D = MACHINE_DIMS, r = rnd(m.seed);
  const segs = channelSegments(m.w, m.p);
  // (lane MOTION) the flow runs from the sluice gate (world -X / -Z end, gen sewageLayout) toward the culvert: along local X, signed
  // so it points to world +X (along-X channels) / +Z; a seeded slow sewage speed. The water under the crossings flows the same.
  const C = MOTION.channel, fx = Math.cos(m.rot) - Math.sin(m.rot) >= 0 ? 1 : -1;
  const speed = C.speed[0] + prng(hashOf('channel-flow', m.seed))() * (C.speed[1] - C.speed[0]);
  for (const [s0, s1] of segs) {
    b.flow([fx, 0, 0], speed, C.turb);
    b.plane('water', s0, -hd + D.curb, s1, hd - D.curb, 0.03);
    for (const sg of [-1, 1] as const) {
      const za = sg < 0 ? -hd : hd - D.curb, zb = za + D.curb;
      b.box('concrete', s0, 0, za, s1, D.curbH, zb);
      b.box('yellow', s0, D.curbH, za, s1, D.curbH + 0.012, zb);
      b.railX('yellow', s0 + 0.1, s1 - 0.1, sg * (hd - D.curb / 2), D.curbH, 1.05);
    }
    // grated covers over part of the segment (visual: the water stays blocked under them)
    const len = s1 - s0;
    if (len > 2.5) { const c = s0 + 0.6 + r() * (len - 1.8); b.box('grate', c, D.curbH - 0.03, -hd + D.curb, c + 0.9, D.curbH, hd - D.curb); }
    // flow scum streaks (carried at the water's speed)
    b.flow([fx, 0, 0], speed, C.scumTurb);
    b.plane('foam', s0 + 0.2, -0.08, s1 - 0.2, 0.06, 0.035);
  }
  // crossings: grated plates over the channel, flush (walkable), with kick plates
  const p = m.p ?? [];
  b.flow([fx, 0, 0], speed, C.turb);
  for (let i = 0; i + 1 < p.length; i += 2) {
    b.plane('water', p[i], -hd + D.curb, p[i + 1], hd - D.curb, 0.01);
    // bearing bars across the channel (the water shows between them), edge angles and kick plates
    for (let x = p[i] + 0.08; x < p[i + 1] - 0.05; x += 0.1) b.box('galv', x - 0.012, 0.005, -hd, x + 0.012, 0.03, hd);
    for (const z of [-hd + D.curb, hd - D.curb - 0.04]) b.box('dark', p[i], 0, z, p[i + 1], 0.032, z + 0.04);
    for (const x of [p[i], p[i + 1] - 0.05]) b.box('dark', x, 0, -hd, x + 0.05, 0.08, hd);
  }
  void hw;
}

function basin(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, D = MACHINE_DIMS, t = D.parapetT, h = D.parapet, r = rnd(m.seed);
  b.box('concrete', -hw, 0, hd - t, hw, h, hd);
  b.box('concrete', -hw, 0, -hd, -hw + t, h, hd - t);
  b.box('concrete', hw - t, 0, -hd, hw, h, hd - t);
  b.box('yellow', -hw, h, hd - t, hw, h + 0.012, hd);
  // guard rail on the parapet
  b.railX('yellow', -hw + 0.12, hw - 0.12, hd - t / 2, h, h + 0.32, 1.4);
  b.railZ('yellow', -hd + 0.15, hd - t, -hw + t / 2, h, h + 0.32, 1.4);
  b.railZ('yellow', -hd + 0.15, hd - t, hw - t / 2, h, h + 0.32, 1.4);
  // the water, a scum line, a submerged weir wall and a depth staff
  // (lane MOTION) a slow drift away from the inlet (local +Z), stirred where the pour lands and calm far from it; the scum line idles
  const ix = m.p?.[0] ?? 0, iy = h + 0.42, B = MOTION.basin, lz = -hd + 1.3;
  b.flow([0, 0, 1], B.drift, B.turb[0]);
  b.flowGrid('water', -hw + t, -hd, hw - t, hd - t, 0.05, B.grid, (x, z) => B.turb[0] + (B.turb[1] - B.turb[0]) * Math.max(0, 1 - Math.hypot(x - ix, z - lz) / B.stirR));
  b.flow([1, 0, 0], 0, B.scumTurb);
  b.box('foam', -hw + t, 0.05, hd - t - 0.05, hw - t, 0.06, hd - t);
  const wz = -hd + (hd * 2 - t) * (0.55 + r() * 0.15);
  b.box('concrete', -hw + t, 0, wz - 0.1, hw - t, 0.12, wz + 0.1);
  for (let k = 0; k < 8; k++) b.box(k % 2 ? 'yellow' : 'black', hw - t - 0.02, 0.06 + k * 0.1, hd - t - 0.5, hw - t, 0.16 + k * 0.1, hd - t - 0.38);
  // inlet: a big pipe out of the back wall pouring into the basin (inside the footprint)
  b.cyl('dark', 'z', ix, iy, -hd, -hd + 0.75, 0.3, 16);
  b.cyl('dark', 'z', ix, iy, -hd + 0.68, -hd + 0.75, 0.36, 16);
  for (const sx of [-0.18, 0.18]) b.box('dark', ix + sx - 0.04, 0.05, -hd + 0.3, ix + sx + 0.04, iy - 0.28, -hd + 0.38);
  b.flow([0, -1, 0], MOTION.fall.inlet, 1);
  b.wall('foam', 'z', -hd + 0.8, ix - 0.22, ix + 0.22, 0.05, iy - 0.22, 1);
  b.flow([0, 0, 1], MOTION.landing.basin, 1);
  b.plane('foam', ix - 0.7, -hd + 0.75, ix + 0.7, -hd + 1.9, 0.055);
}

function chute(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, D = MACHINE_DIMS, t = D.chuteT, n = chuteSteps(m), H = D.chuteWall;
  const zi0 = -hd, zi1 = hd - t;
  // (lane MOTION) the water runs down the steps toward the low end (p[1] = 1: the high inlet is +X, so it flows to -X), falls pour down
  const fx = m.p?.[1] ? -1 : 1, U = MOTION.chute;
  b.box('concrete', -hw, 0, hd - t, hw, H, hd);
  b.box('yellow', -hw, H, hd - t, hw, H + 0.012, hd);
  b.railX('yellow', -hw + 0.12, hw - 0.12, hd - t / 2, H, H + 0.3, 1.5);
  for (let k = 0; k < n; k++) {
    const s0 = -hw + (k * m.w) / n, s1 = -hw + ((k + 1) * m.w) / n, lv = chuteStepLevel(m, k);
    if (lv > 0.06) b.box('concrete', s0, 0, zi0, s1, lv - 0.02, zi1);
    b.flow([fx, 0, 0], U.speed, U.turb);
    b.plane('water', s0, zi0, s1, zi1, lv);
    // the fall onto the next (lower) step: a foaming face, and white water where it lands
    if (k + 1 < n) {
      const lv2 = chuteStepLevel(m, k + 1), x = s1;
      b.flow([0, -1, 0], MOTION.fall.chute, 1);
      if (lv > lv2) b.wall('foam', 'x', x, zi0, zi1, lv2, lv, 1);
      else b.wall('foam', 'x', x, zi0, zi1, lv, lv2, -1);
      const lo = Math.min(lv, lv2), xl = lv > lv2 ? x : x - 0.45;
      b.flow([fx, 0, 0], U.speed, 1);
      b.plane('foam', xl, zi0, xl + 0.45, zi1, lo + 0.006);
    }
  }
  // ends: an inlet weir (opening + sluice frame) at the high end, a culvert mouth at the low end, else a concrete end wall
  const high = m.p?.[1] ? 1 : -1, onNeg = !!m.p?.[2], onPos = !!m.p?.[3];
  for (const sg of [-1, 1] as const) {
    const onWall = sg < 0 ? onNeg : onPos, x = sg * hw, isHigh = sg === high;
    if (!onWall) { b.box('concrete', sg < 0 ? -hw : hw - t, 0, zi0, sg < 0 ? -hw + t : hw, H, zi1); continue; }
    const xi = x - sg * 0.02;
    if (isHigh) {
      const lv = D.chuteTop;
      b.box('black', Math.min(xi, xi - sg * 0.01), lv, zi0 + 0.15, Math.max(xi, xi - sg * 0.01), lv + 0.55, zi1 - 0.15);
      for (const z of [zi0 + 0.08, zi1 - 0.08]) b.box('dark', Math.min(x, x - sg * 0.18), lv - 0.05, z - 0.06, Math.max(x, x - sg * 0.18), lv + 1.15, z + 0.06);
      b.box('dark', Math.min(x, x - sg * 0.12), lv + 0.35, zi0 + 0.14, Math.max(x, x - sg * 0.12), lv + 0.9, zi1 - 0.14);
      b.box('dark', Math.min(x, x - sg * 0.22), lv + 1.1, zi0, Math.max(x, x - sg * 0.22), lv + 1.22, zi1);
      b.flow([0, -1, 0], MOTION.fall.weir, 1);
      b.wall('foam', 'x', x - sg * 0.2, zi0 + 0.2, zi1 - 0.2, lv, lv + 0.34, (-sg) as 1 | -1);
    } else {
      b.box('black', Math.min(xi, xi - sg * 0.01), 0.04, zi0 + 0.12, Math.max(xi, xi - sg * 0.01), 0.75, zi1 - 0.12);
      b.box('concrete', Math.min(x, x - sg * 0.08), 0.75, zi0, Math.max(x, x - sg * 0.08), 0.95, zi1);
    }
  }
}

/** Floor grating (walkway): bearing bars across the walk every 0.12 m on two edge angles and cross bars (the floor shows through). */
function catwalk(b: Build, m: AnnexMachine): void {
  // (playtest revision, primary) a floor grating stays under 2 cm: doorway clear volumes start 2 cm above the floor
  // (gen/doorways.ts DOOR_CLEAR.floor), so a catwalk running up to a door never pokes into its walk-through volume
  const hw = m.w / 2, hd = m.d / 2;
  b.box('dark', -hw, 0, -hd, hw, 0.018, -hd + 0.04); b.box('dark', -hw, 0, hd - 0.04, hw, 0.018, hd);
  for (let x = -hw + 0.06; x < hw - 0.03; x += 0.12) b.box('galv', x - 0.012, 0.003, -hd + 0.04, x + 0.012, 0.016, hd - 0.04);
  for (let x = -hw + 1.2; x < hw - 0.2; x += 1.2) b.box('dark', x - 0.025, 0, -hd, x + 0.025, 0.017, hd);
}

function gate(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, h = m.h;
  for (const x of [-hw + 0.06, hw - 0.06]) b.box('dark', x - 0.07, 0, -hd, x + 0.07, h, -hd + 0.2);
  b.box('dark', -hw, h - 0.14, -hd, hw, h, -hd + 0.24);
  b.box('boiler', -hw + 0.1, 0.35, -hd + 0.04, hw - 0.1, 1.15, -hd + 0.12);
  for (let y = 0.45; y < 1.1; y += 0.22) b.box('dark', -hw + 0.1, y, -hd + 0.12, hw - 0.1, y + 0.04, -hd + 0.15);
  b.cyl('dark', 'y', 0, -hd + 0.1, 1.15, h - 0.14, 0.03, 6, false);
  b.cyl('yellow', 'z', 0, h + 0.05, -hd + 0.1, -hd + 0.14, 0.22, 14);
  b.box('black', -hw + 0.12, 0.03, -hd - 0.01, hw - 0.12, 0.34, -hd + 0.005);
}

function culvert(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, h = m.h;
  b.box('black', -hw, 0.02, -hd, hw, h, -hd + 0.02);
  b.box('concrete', -hw - 0.15, h, -hd, hw + 0.15, h + 0.18, hd);
  for (const x of [-hw - 0.15, hw]) b.box('concrete', x, 0, -hd, x + 0.15, h, hd);
  for (let x = -hw + 0.12; x < hw - 0.05; x += 0.16) b.box('dark', x, 0.02, -hd + 0.03, x + 0.025, h - 0.02, -hd + 0.06);
}

function turbine(b: Build, m: AnnexMachine, ceil: number): void {
  const hw = m.w / 2, hd = m.d / 2, fromCeil = !!m.p?.[0], r = rnd(m.seed);
  const pen = fromCeil ? 0 : 0.9, x0 = -hw + pen, ph = 0.4;
  const R = Math.min(hd - 0.2, (m.h - ph) / 2), cy = ph + R;
  b.box('concrete', x0, 0, -hd, hw, ph, hd);
  for (const s of [-1, 1]) b.box('yellow', x0, ph, s * hd - (s > 0 ? 0.06 : 0), hw, ph + 0.015, s * hd + (s < 0 ? 0.06 : 0));
  // turbine casing (ribbed, split flange), a cone to the coupling, the generator with cooling bands and end bell, the exciter
  const c0 = x0 + 0.15, c1 = c0 + Math.min(3.4, (hw - x0) * 0.42);
  b.cyl('turbine', 'x', cy, 0, c0, c1, R, 24);
  b.box('turbine', c0 - 0.05, cy - 0.06, -R - 0.1, c1 + 0.05, cy + 0.06, R + 0.1);
  for (let x = c0 + 0.35; x < c1 - 0.2; x += 0.55) b.cyl('dark', 'x', cy, 0, x - 0.04, x + 0.04, R + 0.04, 24);
  for (let x = c0 + 0.5; x < c1 - 0.3; x += 0.7) for (const z of [-R - 0.06, R + 0.06]) b.cyl('dark', 'y', x, z, cy + 0.05, cy + 0.12, 0.05, 6);
  const k1 = c1 + 0.5;
  b.cyl('turbine', 'x', cy, 0, c1, k1, R * 0.55, 18);
  b.box('yellow', k1, cy - R * 0.45, -R * 0.45, k1 + 0.5, cy + R * 0.45, R * 0.45);
  const g0 = k1 + 0.5, g1 = Math.min(hw - 0.75, g0 + 2.6), Rg = Math.min(R * 0.95, hd - 0.25);
  b.cyl('grey', 'x', ph + Rg + 0.05, 0, g0, g1, Rg, 24);
  for (let x = g0 + 0.25; x < g1 - 0.15; x += 0.32) b.cyl('dark', 'x', ph + Rg + 0.05, 0, x - 0.03, x + 0.03, Rg + 0.035, 24);
  b.cyl('dark', 'x', ph + Rg + 0.05, 0, g1, g1 + 0.12, Rg * 0.8, 20);
  b.cyl('turbine', 'x', ph + Rg * 0.6, 0, g1 + 0.12, hw - 0.12, Rg * 0.42, 16);
  // bearing pedestals, oil lines
  for (const x of [c0 + 0.2, c1 + 0.25, g0 + 0.1, g1 - 0.1]) b.box('dark', x - 0.18, ph, -0.4, x + 0.18, cy - R * 0.6, 0.4);
  b.cyl('yellow', 'x', ph + 0.12, hd - 0.18, c0, g1, 0.03, 6, false);
  b.cyl('lagging', 'x', ph + 0.12, -hd + 0.18, c0, g1, 0.045, 6, false);
  // penstock: from the wall (with a valve body and handwheel) or down from the ceiling
  if (!fromCeil) {
    b.cyl('dark', 'x', cy, 0, -hw, c0 + 0.1, R * 0.5, 18);
    b.cyl('dark', 'x', cy, 0, -hw + 0.3, -hw + 0.62, R * 0.62, 18);
    b.cyl('yellow', 'z', -hw + 0.46, cy + R * 0.62 + 0.25, -0.03, 0.03, 0.3, 14);
    b.cyl('dark', 'y', -hw + 0.46, 0, cy + R * 0.6, cy + R * 0.62 + 0.25, 0.04, 6);
  } else {
    b.cyl('dark', 'y', c0 + 0.7, 0, cy + R * 0.7, ceil - 0.01, R * 0.42, 18, false);
    b.cyl('dark', 'y', c0 + 0.7, 0, cy + R * 0.95, cy + R * 1.05, R * 0.52, 18);
  }
  void r;
}

function crane(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, y = m.p?.[0] ?? 3.2, len = m.p?.[1] ?? 10, off = m.p?.[2] ?? 0;
  // runway rails high on the two long walls (local X = across the hall: rails at x = +-hw), the girder, end trucks, the trolley + hook
  for (const s of [-1, 1]) b.box('dark', s * hw - (s > 0 ? 0.22 : 0), y - 0.12, off - len / 2, s * hw + (s < 0 ? 0.22 : 0), y, off + len / 2);
  b.box('yellow', -hw + 0.2, y - 0.22, -0.18, hw - 0.2, y + 0.18, 0.18);
  for (const s of [-1, 1]) b.box('yellow', s * (hw - 0.2) - 0.18, y - 0.05, -0.45, s * (hw - 0.2) + 0.18, y + 0.22, 0.45);
  const tx = (m.seed % 1000) / 1000 * (hw - 1) * 0.8;
  b.box('dark', tx - 0.4, y + 0.18, -0.35, tx + 0.4, y + 0.5, 0.35);
  const hookY = Math.max(2.45, y - 1.2);
  b.box('dark', tx - 0.015, hookY + 0.25, -0.015, tx + 0.015, y - 0.22, 0.015);
  b.box('yellow', tx - 0.14, hookY, -0.1, tx + 0.14, hookY + 0.25, 0.1);
}

function fanWall(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, dia = m.p?.[0] ?? 1.6, R = dia / 2, cy = 0.25 + R + 0.05;
  // dark opening behind, the shroud (open tube), a square mounting frame on the wall, two feet
  b.cyl('black', 'z', 0, cy, -hd, -hd + 0.03, R, 24);
  b.tube('galv', 'z', 0, cy, -hd + 0.03, hd - 0.12, R + 0.04, 24);
  b.cyl('dark', 'z', 0, cy, hd - 0.16, hd - 0.1, R + 0.1, 24, false);
  b.box('galv', -hw, cy - R - 0.12, -hd, hw, cy - R - 0.04, -hd + 0.12);
  b.box('galv', -hw, cy + R + 0.04, -hd, hw, cy + R + 0.12, -hd + 0.12);
  for (const s of [-1, 1]) { b.box('galv', s * hw - (s > 0 ? 0.08 : 0), 0, -hd, s * hw + (s < 0 ? 0.08 : 0), cy + R + 0.12, -hd + 0.12); b.box('dark', s * (R * 0.7) - 0.06, 0, -0.1, s * (R * 0.7) + 0.06, cy - R, 0.1); }
  // motor + hub (static: a plain cylinder looks the same turning); (lane MOTION) the pitched blades are the level's rotor
  // InstancedMesh (motion.ts RotorSet / wallFanRotor: blade plane hz + 0.13, turning about local Z through (0, cy))
  const hz = -hd + 0.25;
  b.cyl('dark', 'z', 0, cy, -hd + 0.05, hz + 0.05, R * 0.24, 14);
  b.cyl('genset', 'z', 0, cy, hz + 0.05, hz + 0.22, R * 0.16, 14);
  // guard: concentric bands and four spokes at the front
  const gz = hd - 0.12;
  for (const f of [0.35, 0.68, 1]) b.tube('dark', 'z', 0, cy, gz - 0.02, gz, R * f, 20);
  for (let k = 0; k < 4; k++) b.boxRotZ('dark', 0, cy, gz - 0.01, R, 0.012, 0.012, (k / 4) * Math.PI + Math.PI / 4);
}

function fanUnit(b: Build, m: AnnexMachine, ceil: number): void {
  const hw = m.w / 2, hd = m.d / 2, cy = 0.95, R = 0.58, zc = -hd + 0.85;
  // stand, the fan casing (flanged drum along local X), inlet bell + guard, motor on top, a duct riser into the ceiling
  for (const x of [-hw + 0.25, hw - 0.95]) b.box('dark', x, 0, zc - 0.45, x + 0.08, cy - R + 0.02, zc + 0.45);
  b.box('dark', -hw + 0.25, cy - R - 0.04, zc - 0.5, hw - 0.9, cy - R + 0.02, zc + 0.5);
  b.cyl('galv', 'x', cy, zc, -hw + 0.3, hw - 0.95, R, 20);
  for (const x of [-hw + 0.3, hw - 0.95]) b.cyl('dark', 'x', cy, zc, x - 0.04, x + 0.04, R + 0.06, 20);
  b.cyl('galv', 'x', cy, zc, -hw + 0.05, -hw + 0.3, R * 0.8, 20);
  for (const f of [0.4, 0.78]) b.tube('dark', 'x', cy, zc, -hw + 0.04, -hw + 0.06, R * f, 16);
  b.box('genset', -0.35, cy + R - 0.05, zc - 0.3, 0.35, cy + R + 0.35, zc + 0.3);
  b.box('galv', hw - 1.0, cy - 0.45, zc - 0.42, hw - 0.1, Math.max(cy + 0.5, ceil - 0.01), zc + 0.42);
  for (let y = cy + 0.4; y < ceil - 0.2; y += 0.6) b.box('dark', hw - 1.02, y, zc - 0.44, hw - 0.08, y + 0.04, zc + 0.44);
}

function duct(b: Build, m: AnnexMachine, ceil: number): void {
  const hw = m.w / 2, hd = m.d / 2, hh = m.h / 2, y = m.p?.[0] ?? ceil - hh - 0.05, k: 'galv' | 'dark' = m.p?.[1] ? 'dark' : 'galv';
  b.box(k, -hw, y - hh, -hd, hw, y + hh, hd);
  for (let x = -hw + 0.6; x < hw - 0.2; x += 1.2) b.box('dark', x - 0.025, y - hh - 0.02, -hd - 0.02, x + 0.025, y + hh + 0.02, hd + 0.02);
  for (let x = -hw + 0.9; x < hw - 0.3; x += 1.8) for (const z of [-hd + 0.05, hd - 0.05]) b.box('dark', x - 0.01, y + hh, z - 0.01, x + 0.01, ceil - 0.005, z + 0.01);
}

function louvre(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, y0 = m.p?.[0] ?? 0.9, h = m.h;
  b.box('black', -hw, y0, -hd, hw, y0 + h, -hd + 0.01);
  b.box('galv', -hw - 0.05, y0 - 0.05, -hd, hw + 0.05, y0, hd); b.box('galv', -hw - 0.05, y0 + h, -hd, hw + 0.05, y0 + h + 0.05, hd);
  for (const x of [-hw - 0.05, hw]) b.box('galv', x, y0, -hd, x + 0.05, y0 + h, hd);
  for (let y = y0 + 0.08; y < y0 + h - 0.04; y += 0.1) b.boxRotZ('galv', 0, y, 0, hw, 0.006, hd * 0.9, 0, 0.7);
}

function pipeRun(b: Build, m: AnnexMachine): void {
  const hw = m.w / 2, hd = m.d / 2, y = m.p?.[0] ?? 2.4, n = Math.max(1, Math.round(m.p?.[1] ?? 2)), r = rnd(m.seed);
  const cols: ('lagging' | 'dark' | 'yellow' | 'boiler' | 'galv')[] = ['lagging', 'dark', 'yellow', 'boiler', 'galv'];
  for (let k = 0; k < n; k++) {
    const rr = 0.05 + r() * 0.025, z = -hd + 0.08 + (k % 2) * 0.11, py = y - Math.floor(k / 2) * 0.22 - (k % 2) * 0.06;
    b.cyl(cols[Math.floor(r() * cols.length)], 'x', py, z, -hw + 0.05, hw - 0.05, rr, 8);
    for (let x = -hw + 0.6; x < hw - 0.4; x += 2.4) b.cyl('dark', 'x', py, z, x, x + 0.06, rr + 0.02, 8);
  }
  for (let x = -hw + 0.3; x < hw - 0.2; x += 1.6) b.box('dark', x - 0.02, y - 0.3, -hd, x + 0.02, y + 0.08, -hd + 0.26);
}

function tank(b: Build, m: AnnexMachine): void {
  const R = Math.min(m.w, m.d) / 2 - 0.08, h = m.h;
  for (const [x, z] of [[-R * 0.6, -R * 0.6], [R * 0.6, -R * 0.6], [-R * 0.6, R * 0.6], [R * 0.6, R * 0.6]]) b.box('dark', x - 0.03, 0, z - 0.03, x + 0.03, 0.25, z + 0.03);
  b.cyl('boiler', 'y', 0, 0, 0.25, h - 0.18, R, 18);
  b.cyl('boiler', 'y', 0, 0, h - 0.18, h - 0.06, R * 0.75, 18);
  b.cyl('dark', 'y', 0, 0, h - 0.06, h, 0.06, 8);
  b.box('black', R * 0.7, 0.45, -0.03, R + 0.02, h - 0.4, 0.03);
  for (const y of [0.6, h - 0.5]) b.cyl('dark', 'y', 0, 0, y - 0.03, y + 0.03, R + 0.02, 18);
}

// ---------------------------------------------------------------------------------------------------------------------------------

export interface MachineBuild {
  /** Every mesh the build added to the group (merged per annex x material, + the level's fan-rotor InstancedMesh). */
  meshes: THREE.Mesh[];
  /** Draws (one per annex x material, + 1 for the rotors) and triangles (the rotors: blades x 12). */
  draws: number;
  triangles: number;
  records: number;
  /** (lane MOTION) Animated parts: water / foam meshes (per annex), wall fans with a rotor, their blade instances. */
  motion: {water: number; foam: number; fans: number; blades: number};
  /** (lane MOTION) The wall-fan rotors (null without wall fans): their specs (hub / axis / speed) and per-rotor angles. */
  rotors: RotorSet | null;
  /**
   * (lane MOTION) Advance the water flow and the fan rotors to GAME time `t` (s; Game.update's clock — menus / pause / loading do
   * not advance it, so the same t keeps everything still). Cheap: one uniform + one 64 B matrix per blade. No-op after dispose().
   */
  update(t: number): void;
  /**
   * (lane MOTION) Release what this build made: every merged geometry, the rotor InstancedMesh and its blade geometry (removed from
   * the group). Idempotent. The materials and the clock uniform are shared per WorldMaterials (reused by the next level's build).
   */
  dispose(): void;
}

/** Builds every annex's machinery records into `group` (one merged mesh per annex and material). Empty without records. */
export function buildAnnexMachines(group: THREE.Group, layout: StationLayout, mats: WorldMaterials): MachineBuild {
  const recs = layout.extensions?.machines ?? [];
  const clock = motionClock(mats);
  let rotors: RotorSet | null = null, disposed = false;
  const out: MachineBuild = {
    meshes: [], draws: 0, triangles: 0, records: recs.length, motion: {water: 0, foam: 0, fans: 0, blades: 0}, rotors: null,
    update(t: number): void {
      if (disposed) return;
      clock.value = t;
      rotors?.update(t);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const m of out.meshes) { m.removeFromParent(); if (m !== rotors?.mesh) m.geometry.dispose(); }
      rotors?.dispose();
      out.meshes.length = 0;
    },
  };
  if (!recs.length) return out;
  const fans: RotorSpec[] = [];
  // annex of each record (by its area), so each annex's machinery culls on its own
  const annexOf = new Map<number, number>();
  for (const n of layout.extensions?.annexes ?? []) for (const id of n.areas) annexOf.set(id, n.id);
  const groups = new Map<number, AnnexMachine[]>();
  for (const m of recs) { const k = annexOf.get(m.area) ?? -1; let l = groups.get(k); if (!l) groups.set(k, (l = [])); l.push(m); }
  for (const [annex, list] of groups) {
    const accs = new Map<MachineMat, Acc>(), b = new Build(accs);
    for (const m of list) {
      const a = layout.areas[m.area], ceil = a ? a.ceil - (a.floorY ?? m.y) : 2.6;
      b.frame(m);
      switch (m.kind) {
        case 'boiler': boiler(b, m, ceil); break;
        case 'header': header(b, m); break;
        case 'genset': genset(b, m, ceil); break;
        case 'switchgear': switchgear(b, m, ceil); break;
        case 'channel': channel(b, m); break;
        case 'basin': basin(b, m); break;
        case 'chute': chute(b, m); break;
        case 'catwalk': catwalk(b, m); break;
        case 'gate': gate(b, m); break;
        case 'culvert': culvert(b, m); break;
        case 'turbine': turbine(b, m, ceil); break;
        case 'crane': crane(b, m); break;
        case 'fanWall': fanWall(b, m); fans.push(wallFanRotor(m)); break;
        case 'fanUnit': fanUnit(b, m, ceil); break;
        case 'duct': duct(b, m, ceil); break;
        case 'louvre': louvre(b, m); break;
        case 'pipeRun': pipeRun(b, m); break;
        case 'tank': tank(b, m); break;
      }
    }
    for (const k of MACHINE_MATS) {
      const acc = accs.get(k), geo = acc?.geometry();
      if (!acc || !geo) continue;
      const mesh = new THREE.Mesh(geo, machineMaterial(mats, k));
      mesh.name = `annex-machines-${annex}-${k}`;
      mesh.userData.level = 0;
      mesh.userData.trackExt = {tunnel: -1, part: 'machines', annex};
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      out.meshes.push(mesh);
      out.draws++;
      out.triangles += acc.triangleCount;
      if (k === 'water' || k === 'foam') out.motion[k]++;
    }
  }
  // (lane MOTION) every wall fan's blades: one InstancedMesh for the level (one draw, a blade per instance)
  if (fans.length) {
    rotors = out.rotors = new RotorSet(fans, rotorMaterial(mats));
    const im = rotors.mesh;
    im.name = 'annex-machines-fan-rotors';
    im.userData.level = 0;
    im.userData.trackExt = {tunnel: -1, part: 'machines', annex: -1};
    group.add(im);
    out.meshes.push(im);
    out.draws++;
    out.triangles += rotors.blades * 12;
    out.motion.fans = fans.length;
    out.motion.blades = rotors.blades;
  }
  return out;
}

/** (QA) Cell size the machinery is laid out on (records snap to it). */
export const MACHINE_GRID = CELL;
