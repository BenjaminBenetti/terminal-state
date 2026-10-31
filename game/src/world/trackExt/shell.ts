// Track 2 (Beyond the Station), lane VIS: the smooth tunnel shell that continues a track bed beyond its old black end
// wall (DESIGN §3): vertical concrete walls at ±width/2 from TrackTunnel.path, a flat ceiling at ceilY, a ballast floor
// over the full width, running rails + third rail + coverboard swept along each track and instanced sleepers, a cable
// tray, dead bulkhead lamps, the annex door frames + SERVICE plates, and the floors / ceilings of door-passage cells
// cut by a shell wall. Everything merges per (material, tunnel, <= 48 m of arc length): bounded draws.
//
// UV continuity at the mouth: walls continue the bed walls' wallQuad mapping (u along the wall from the mouth's world X,
// v from the floor), the floor uses the bed's world-planar ballast mapping and the ceiling a "developed" mapping (the
// tunnel unrolled straight from the mouth) that equals the bed ceiling's world mapping at the mouth and follows bends.

import * as THREE from 'three';
import {CELL, FLOOR, type Grid} from '../../gen/grid';
import type {StationLayout} from '../../gen/station';
import type {TrackTunnel} from '../../gen/trackExt/types';
import {HATCH_CLUE_KEEPOUT} from '../../gen/trackExt/art';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {signPlate} from '../canvasTextures';
import {cellCeil, type BuiltFace} from '../levelGeometry';
import type {MatKey, WorldMaterials} from '../materials';
import {TunnelFrame, renderStations} from './frame';
import {Acc, basisOf, hashOf, prng, type V3} from './mesh';
import {CELL_BUILDER, type TrackExtView, type TunnelView} from './view';
import {buildCap, capSpan, type CapSpan} from './caps';

/** Shell layout constants (m). */
export const SHELL = {
  /** Arc-length chunk of the merged meshes (= the architecture's CHUNK_M). */
  chunk: 48,
  /** Running rails: gauge offset from the track centre, top-of-rail height above the bed, profile. Same as the bed's. */
  gauge: 0.72, railY: 0.22, railH: 0.15, railW: 0.07,
  /** Third rail + coverboard (bed: tc + side * 1.4). */
  third: 1.4, thirdY: 0.3, thirdH: 0.12, thirdW: 0.08, coverY: 0.46, coverH: 0.035, coverW: 0.32,
  /** Sleepers (bed: every 0.65 m, 0.24 x 0.14 x 2.5). */
  sleeperStep: 0.65, sleeper: [0.24, 0.14, 2.5] as const,
  /** Cable tray height above the bed and bracket spacing; dead bulkhead lamps every `lampStep` at `lampY`. */
  trayY: 3.25, trayStep: 2.4, lampY: 2.85, lampStep: 14,
} as const;

/** A wall opening of the shell: arc span on one side, head height (absolute). */
export interface ShellOpening { door: number; side: 1 | -1; s0: number; s1: number; head: number }

export interface TunnelShellStats {
  id: number; length: number; meshes: number; draws: number; triangles: number; instances: number;
  openings: ShellOpening[];
  cap: CapSpan & {kind: TrackTunnel['cap']['kind']};
}

export interface ShellBuild {
  /** Meshes added to the group (one draw each). */
  meshes: THREE.Object3D[];
  perTunnel: TunnelShellStats[];
}

type ShellMat = MatKey | 'sign' | 'lens' | 'void' | 'hazard';

const signMats = new WeakMap<WorldMaterials, THREE.Material>();
const lensMats = new WeakMap<WorldMaterials, THREE.Material>();

/** The tunnel door plate face ("SERVICE · STAFF ONLY", the station's service-plate style), shared. */
export function serviceSignMaterial(mats: WorldMaterials): THREE.Material {
  let m = signMats.get(mats);
  if (!m) {
    const mm = new MeshStandardNodeMaterial({map: signPlate('SERVICE · STAFF ONLY', 'service', 2203), roughness: 0.6});
    mm.name = 'track-ext-sign';
    signMats.set(mats, (m = mm));
  }
  return m;
}

/** Dead bulkhead-lamp lens (dark, grimy glass), shared. */
export function deadLensMaterial(mats: WorldMaterials): THREE.Material {
  let m = lensMats.get(mats);
  if (!m) {
    const mm = new MeshStandardNodeMaterial({color: 0x2a2b26, roughness: 0.35, metalness: 0.1});
    mm.name = 'track-ext-lens';
    lensMats.set(mats, (m = mm));
  }
  return m;
}

/** Broad surfaces split into arc-length chunks (frustum culling); trim, caps and doors merge into one mesh per tunnel. */
const CHUNKED = new Set<ShellMat>(['tunnel', 'ceiling', 'ballast']);

/** Accumulators keyed by material and (tunnel, chunk). */
export class ShellSink {
  readonly accs = new Map<string, {mat: ShellMat; tunnel: number; chunk: number; acc: Acc}>();
  /** Per tunnel: chunk count and length (equal chunks of <= SHELL.chunk m over the shell: no sliver chunk at the end). */
  private readonly chunks = new Map<number, {n: number; len: number}>();
  setShell(tunnel: number, length: number): void {
    const n = Math.max(1, Math.ceil(length / SHELL.chunk - 1e-6));
    this.chunks.set(tunnel, {n, len: length / n});
  }
  get(mat: ShellMat, tunnel: number, s: number): Acc {
    const c = this.chunks.get(tunnel) ?? {n: Infinity, len: SHELL.chunk};
    const chunk = CHUNKED.has(mat) ? Math.max(0, Math.min(c.n - 1, Math.floor(s / c.len))) : 0;
    const key = `${mat}|${tunnel}|${chunk}`;
    let e = this.accs.get(key);
    if (!e) this.accs.set(key, (e = {mat, tunnel, chunk, acc: new Acc()}));
    return e.acc;
  }
}

/**
 * Build every tunnel's shell into `group`. `matOf` resolves the shell's material keys (WorldMaterials keys plus the
 * track-ext materials); `hazard` / `void` come from the caller (traversal hazard stripes, the black backing).
 */
export function buildShells(group: THREE.Group, view: TrackExtView, layout: StationLayout, mats: WorldMaterials, extra: {hazard: THREE.Material; void: THREE.Material}): ShellBuild {
  const sink = new ShellSink();
  const sleepers = new Map<string, {tunnel: number; list: THREE.Matrix4[]}>();
  const perTunnel: TunnelShellStats[] = [];
  view.tunnels.forEach((v, k) => {
    const openings = doorOpenings(v, layout);
    const span = capSpan(v, layout);
    sink.setShell(k, span.back);
    perTunnel.push({id: v.t.id, length: v.f.length, meshes: 0, draws: 0, triangles: 0, instances: 0, openings, cap: {...span, kind: v.t.cap.kind}});
    buildTunnel(sink, sleepers, v, k, layout, mats, openings, span.back);
    buildCap(sink, v, k, mats, span, layout.seed >>> 0);
  });
  straddleCells(sink, view, layout, mats);

  const meshes: THREE.Object3D[] = [];
  const matOf = (m: ShellMat): THREE.Material => m === 'sign' ? serviceSignMaterial(mats) : m === 'lens' ? deadLensMaterial(mats) : m === 'hazard' ? extra.hazard : m === 'void' ? extra.void : mats.get(m);
  for (const [key, e] of sink.accs) {
    const geo = e.acc.geometry();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, matOf(e.mat));
    mesh.name = `track-ext-${key.replace(/\|/g, '-')}`;
    mesh.userData.level = 0;
    mesh.userData.trackExt = {tunnel: view.tunnels[e.tunnel]?.t.id ?? -1, part: e.mat};
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    meshes.push(mesh);
  }
  const box = new THREE.BoxGeometry(...SHELL.sleeper);
  for (const [key, e] of sleepers) {
    if (!e.list.length) continue;
    const im = new THREE.InstancedMesh(box, mats.get('sleeper'), e.list.length);
    e.list.forEach((m, i) => im.setMatrixAt(i, m));
    im.name = `track-ext-sleepers-${key}`;
    im.userData.level = 0;
    im.userData.trackExt = {tunnel: view.tunnels[e.tunnel].t.id, part: 'sleeper'};
    im.computeBoundingSphere();
    im.matrixAutoUpdate = false;
    group.add(im);
    meshes.push(im);
  }
  for (const o of meshes) {
    const st = perTunnel.find(p => p.id === o.userData.trackExt.tunnel);
    if (!st) continue;
    const m = o as THREE.Mesh, im = o as THREE.InstancedMesh;
    const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    st.meshes++; st.draws++;
    st.triangles += tris * (im.isInstancedMesh ? im.count : 1);
    if (im.isInstancedMesh) st.instances += im.count;
  }
  return {meshes, perTunnel};
}

// ---------------------------------------------------------------------------------------------------------------------

/** `areaType` of the wall-treatment faces published for the shell's straight walls (shellDetailFaces). */
export const SHELL_FACE_TYPE = 'track-tunnel-shell';

/**
 * Wall-treatment faces (lane W, world/wallDetail.ts) for the AXIS-ALIGNED straight runs of the shell walls — the first
 * straight in line with the bed, and any later straight that happens to be axis-aligned — so the tunnel continues the
 * bed's treatment (stains, streaks, soot, damp, cables, joints) past the mouth. Zone 'trackbed', finish 'tunnel', the
 * tunnel's (extension) area: planned in the extension partition with its own budget. Door openings are keep-outs; the
 * cap's last metres are left plain. Not drawn by the builder (the shell draws the wall); cut features find no grid wall
 * quad to cut there and are dropped by the pass.
 */
export function shellDetailFaces(view: TrackExtView, layout: StationLayout): BuiltFace[] {
  const out: BuiltFace[] = [];
  for (const v of view.tunnels) {
    const {t, f} = v;
    const area = t.areas[0] ?? -1;
    const openings = doorOpenings(v, layout);
    const end = Math.min(f.length, capSpan(v, layout).front - 0.5);
    const st = renderStations(f, [], 1e9).filter(s => s < end - 1e-6).concat(end);
    // Maximal axis-aligned runs [a, b].
    const runs: [number, number, 'x' | 'z'][] = [];
    for (let j = 0; j + 1 < st.length; j++) {
      const m = f.at((st[j] + st[j + 1]) / 2);
      const ax = Math.abs(m.tx) > 0.99999 ? 'x' : Math.abs(m.tz) > 0.99999 ? 'z' : null;
      if (!ax) continue;
      const r = runs[runs.length - 1];
      if (r && r[2] === ax && Math.abs(r[1] - st[j]) < 1e-6) r[1] = st[j + 1];
      else runs.push([st[j], st[j + 1], ax]);
    }
    for (const [a, b, ax] of runs) {
      if (b - a < 2) continue;
      for (const side of [1, -1] as const) {
        const pa = f.point(a, side * f.half), pb = f.point(b, side * f.half), m = f.at((a + b) / 2);
        const nx = Math.round(-side * m.lx), nz = Math.round(-side * m.lz);
        const alongX = ax === 'x';
        const c0 = alongX ? Math.min(pa[0], pb[0]) : Math.min(pa[1], pb[1]), c1 = alongX ? Math.max(pa[0], pb[0]) : Math.max(pa[1], pb[1]);
        const plane = alongX ? (pa[1] + pb[1]) / 2 : (pa[0] + pb[0]) / 2;
        // Door openings, and the graffiti patches (kept clean of stains / cables: keep-outs up to above the marks).
        const marks = t.clues.filter(c => c.side === side).map(c => ({side, s0: c.s - HATCH_CLUE_KEEPOUT.half, s1: c.s + HATCH_CLUE_KEEPOUT.half, head: t.floorY + HATCH_CLUE_KEEPOUT.y1}));
        const ops = [...openings, ...marks].filter(o => o.side === side && o.s1 > a && o.s0 < b).map(o => {
          const qa = f.point(o.s0, side * f.half), qb = f.point(o.s1, side * f.half);
          const u0 = (alongX ? Math.min(qa[0], qb[0]) : Math.min(qa[1], qb[1])) - c0, u1 = (alongX ? Math.max(qa[0], qb[0]) : Math.max(qa[1], qb[1])) - c0;
          return {s0: Math.max(0, u0), s1: Math.min(c1 - c0, u1), top: o.head};
        });
        out.push({
          level: 0, area, areaType: SHELL_FACE_TYPE, zone: 'trackbed',
          x0: alongX ? c0 : plane, z0: alongX ? plane : c0, x1: alongX ? c1 : plane, z1: alongX ? plane : c1, nx, nz,
          y0: t.floorY, y1: t.ceilY, finish: 'tunnel', openings: ops, seed: hashOf('shell-face', layout.seed >>> 0, t.id, side, Math.round(a * 100)),
          kind: 'tunnel', vb0: t.floorY, vb1: t.floorY,
        });
      }
    }
  }
  return out;
}

/** Wall openings of a tunnel's entry doors: where the door rect crosses the shell wall line (grid ground truth). */
export function doorOpenings(v: TunnelView, layout: StationLayout): ShellOpening[] {
  const out: ShellOpening[] = [];
  const g = layout.grid, f = v.f, half = f.half;
  for (const d of v.t.doors) {
    const r = layout.doors[d.door];
    if (!r) continue;
    const inRect = (x: number, z: number) => {
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      return cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
    };
    const open = (s: number) => {
      const [xi, zi] = f.point(s, d.side * (half - 0.06));
      const [xo, zo] = f.point(s, d.side * (half + 0.06));
      return inRect(xi, zi) || inRect(xo, zo);
    };
    // Scan around the recorded arc position, then refine both edges.
    const lo = Math.max(0, d.s - 5), hi = Math.min(f.length, d.s + 5);
    let best: [number, number] | null = null, cur: number | null = null;
    const step = 0.05;
    for (let s = lo; s <= hi + 1e-9; s += step) {
      const o = open(s);
      if (o && cur === null) cur = s;
      if ((!o || s + step > hi) && cur !== null) {
        const e = o ? s : s - step;
        if (!best || Math.abs((cur + e) / 2 - d.s) < Math.abs((best[0] + best[1]) / 2 - d.s)) best = [cur, e];
        cur = null;
      }
    }
    let s0: number, s1: number;
    if (best) {
      const refine = (a: number, b: number) => { for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (open(m)) b = m; else a = m; } return (a + b) / 2; };
      const refineUp = (a: number, b: number) => { for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (open(m)) a = m; else b = m; } return (a + b) / 2; };
      s0 = best[0] > lo + 1e-6 ? refine(best[0] - step, best[0]) : best[0];
      s1 = best[1] < hi - 1e-6 ? refineUp(best[1], best[1] + step) : best[1];
    } else {
      // Fallback: the rect's extent projected onto the path.
      const cs = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => f.project(x * CELL, y * CELL).s);
      s0 = Math.min(...cs); s1 = Math.max(...cs);
    }
    let head = Infinity;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * g.w + x;
      if (g.cells[i] === FLOOR) head = Math.min(head, cellCeil(g, i));
    }
    if (!Number.isFinite(head)) head = v.t.floorY + 2.3;
    head = Math.min(head, v.t.ceilY - 0.2);
    out.push({door: d.door, side: d.side, s0, s1, head});
  }
  return out;
}

function buildTunnel(sink: ShellSink, sleepers: Map<string, {tunnel: number; list: THREE.Matrix4[]}>, v: TunnelView, k: number, layout: StationLayout, mats: WorldMaterials, openings: ShellOpening[], shellEnd: number): void {
  const {t, f} = v;
  const y0 = t.floorY, y1 = t.ceilY, half = f.half;
  const end = f.length;
  const cuts = openings.flatMap(o => [o.s0, o.s1]);
  // Track members run to the path end; the shell (walls / ceiling / floor) on to the back of the cap.
  const tr = renderStations(f, cuts, SHELL.chunk);
  const st = shellEnd > end + 1e-6 ? [...tr, shellEnd] : tr;
  const m0 = f.first;

  // --- Walls (both sides), openings cut with a lintel above ------------------------------------------------------
  const wm = mats.scale.tunnel;
  for (const side of [1, -1] as const) {
    const lat = side * half;
    const inward: [number, number] = [-side * m0.lx, -side * m0.lz];
    // Bed wall mapping (builder wallQuad, faces along X): u = x / m.u facing +Z, -x / m.u facing -Z.
    const uSign = inward[1] >= 0 ? 1 : -1;
    const mouth = f.point(0, lat);
    let wl = 0;
    let prev = f.point(st[0], lat);
    for (let j = 0; j + 1 < st.length; j++) {
      const sa = st[j], sb = st[j + 1];
      const pa = prev, pb = f.point(sb, lat);
      const seg = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      const ua = uSign * (mouth[0] + m0.tx * wl) / wm.u, ub = uSign * (mouth[0] + m0.tx * (wl + seg)) / wm.u;
      wl += seg;
      prev = pb;
      const mid = (sa + sb) / 2;
      const op = openings.find(o => o.side === side && mid > o.s0 && mid < o.s1);
      const yb = op ? op.head : y0;
      if (y1 - yb < 0.01) continue;
      const a = sink.get('tunnel', k, mid);
      const na = f.at(sa), nb = f.at(sb);
      const nA: V3 = [-side * na.lx, 0, -side * na.lz], nB: V3 = [-side * nb.lx, 0, -side * nb.lz];
      const vb = (yb - y0) / wm.v, vt = (y1 - y0) / wm.v;
      const i0 = a.v([pa[0], yb, pa[1]], nA, ua, vb), i1 = a.v([pb[0], yb, pb[1]], nB, ub, vb);
      const i2 = a.v([pb[0], y1, pb[1]], nB, ub, vt), i3 = a.v([pa[0], y1, pa[1]], nA, ua, vt);
      a.quad(i0, i1, i2, i3);
    }
  }

  // --- Ceiling (developed mapping) and ballast floor (world-planar, as the bed) ----------------------------------
  const cm = mats.scale.ceiling, bm = mats.scale.ballast;
  const dev = (s: number, lat: number): [number, number] => [m0.x + m0.tx * s + m0.lx * lat, m0.z + m0.tz * s + m0.lz * lat];
  for (let j = 0; j + 1 < st.length; j++) {
    const sa = st[j], sb = st[j + 1], mid = (sa + sb) / 2;
    const corners: [number, number][] = [[sa, -half], [sb, -half], [sb, half], [sa, half]];
    const c = sink.get('ceiling', k, mid), fl = sink.get('ballast', k, mid);
    const ci: number[] = [], fi: number[] = [];
    for (const [s, lat] of corners) {
      const [x, z] = f.point(s, lat), [dx, dz] = dev(s, lat);
      ci.push(c.v([x, y1, z], [0, -1, 0], dx / cm.u, dz / cm.v));
      fi.push(fl.v([x, y0, z], [0, 1, 0], x / bm.u, -z / bm.v));
    }
    c.quad(ci[0], ci[1], ci[2], ci[3]);
    fl.quad(fi[0], fi[1], fi[2], fi[3]);
  }

  // --- Track: rails, third rail + coverboard per track; sleepers continuing the bed's rhythm ------------------------
  const trench = v.trench;
  const thirdOf = (r: number): number => {
    // The bed's third-rail side of the track this rail continues (world ±Z at the mouth) as a lateral offset.
    if (!trench) return r + SHELL.third;
    const zr = m0.z + m0.lz * r;
    let bi = 0;
    trench.tracks.forEach((tz, i) => { if (Math.abs(tz - zr) < Math.abs(trench.tracks[bi] - zr)) bi = i; });
    const side = trench.third[bi] ?? 1;
    return r + side * SHELL.third * (Math.abs(m0.lz) > 0.5 ? Math.sign(m0.lz) : 1);
  };
  for (const r of t.rails) {
    for (const g of [-SHELL.gauge, SHELL.gauge]) sweep(sink, 'rail', k, f, tr, r + g, SHELL.railW / 2, y0 + SHELL.railY - SHELL.railH / 2, y0 + SHELL.railY + SHELL.railH / 2, false);
    const r3 = thirdOf(r);
    sweep(sink, 'rail', k, f, tr, r3, SHELL.thirdW / 2, y0 + SHELL.thirdY - SHELL.thirdH / 2, y0 + SHELL.thirdY + SHELL.thirdH / 2, false);
    sweep(sink, 'coverboard', k, f, tr, r3, SHELL.coverW / 2, y0 + SHELL.coverY - SHELL.coverH / 2, y0 + SHELL.coverY + SHELL.coverH / 2, true);
  }
  const first = sleeperPhase(t, trench);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  for (let s = first; s < end - 0.35; s += SHELL.sleeperStep) {
    const p = f.at(s);
    const key = `${k}`; // one instanced mesh per tunnel (12-triangle boxes; per-chunk meshes would only add draws)
    let e = sleepers.get(key);
    if (!e) sleepers.set(key, (e = {tunnel: k, list: []}));
    q.setFromAxisAngle(UP, Math.atan2(-p.tz, p.tx));
    for (const r of t.rails) {
      pos.set(p.x + p.lx * r, y0 + SHELL.sleeper[1] / 2, p.z + p.lz * r);
      e.list.push(m4.compose(pos, q, one).clone());
    }
  }

  // --- Cable tray + cables on one wall, dead bulkhead lamps on the other ------------------------------------------
  const rnd = prng(hashOf('track-ext-dress', layout.seed >>> 0, t.id));
  const doorSides = openings.map(o => o.side);
  const traySide: 1 | -1 = doorSides.filter(s => s === 1).length > doorSides.filter(s => s === -1).length ? -1 : doorSides.length ? (doorSides[0] === 1 ? -1 : 1) : (rnd() < 0.5 ? 1 : -1);
  const trayY = y0 + Math.min(SHELL.trayY, y1 - y0 - 0.6);
  sweep(sink, 'steel', k, f, tr, traySide * (half - 0.2), 0.15, trayY - 0.025, trayY + 0.025, true);
  sweep(sink, 'rail', k, f, tr, traySide * (half - 0.14), 0.035, trayY + 0.025, trayY + 0.085, false);
  sweep(sink, 'rail', k, f, tr, traySide * (half - 0.25), 0.025, trayY + 0.025, trayY + 0.07, false);
  for (let s = 1.2; s < end - 0.5; s += SHELL.trayStep) {
    const p = f.at(s), b = basisOf(p.tx, p.tz);
    const c = f.point(s, traySide * (half - 0.18));
    sink.get('steel', k, s).box([c[0], trayY - 0.06, c[1]], [0.025, 0.035, 0.18], b.x, b.y, b.z);
  }
  const lampSide = -traySide as 1 | -1;
  for (let s = 6 + rnd() * 4; s < end - 3; s += SHELL.lampStep * (0.8 + rnd() * 0.4)) {
    if (openings.some(o => o.side === lampSide && s > o.s0 - 1.5 && s < o.s1 + 1.5)) continue;
    const p = f.at(s), b = basisOf(p.tx, p.tz);
    const inward: V3 = [-lampSide * p.lx, 0, -lampSide * p.lz];
    const wall = f.point(s, lampSide * half);
    const ly = y0 + Math.min(SHELL.lampY, y1 - y0 - 0.8);
    const c = (d: number): V3 => [wall[0] + inward[0] * d, ly, wall[1] + inward[2] * d];
    sink.get('steel', k, s).box(c(0.06), [0.2, 0.12, 0.06], b.x, b.y, b.z);
    sink.get('lens', k, s).box(c(0.13), [0.15, 0.075, 0.012], b.x, b.y, b.z);
    // Conduit stub up to the tray level.
    sink.get('steel', k, s).box([wall[0] + inward[0] * 0.03, (ly + 0.12 + trayY) / 2, wall[1] + inward[2] * 0.03], [0.012, (trayY - ly - 0.12) / 2, 0.012], b.x, b.y, b.z);
  }

  // --- Annex door frames + SERVICE plates (tunnel side, at the shell wall) -----------------------------------------
  for (const o of openings) doorFrame(sink, k, f, o, y0, mats);
}

/** First sleeper's arc position: the bed's 0.65 m rhythm continued across the mouth. */
export function sleeperPhase(t: TrackTunnel, trench: {x0: number; x1: number} | undefined): number {
  const step = SHELL.sleeperStep;
  if (!trench) return 0.3;
  if (t.from === 'x0') return step - 0.3; // bed sleepers start 0.3 m in from x0
  const per = Math.floor((trench.x1 - trench.x0) / step);
  let s = trench.x0 + 0.3 + per * step - trench.x1;
  while (s < 0.05) s += step;
  return s;
}

/**
 * Rectangular profile swept along the path at lateral offset `c` (half width hw) from y0 to y1: top + both sides
 * (+ bottom when `bottom`), no end caps (the rails continue the bed's at the mouth; the cap hides the far end).
 */
export function sweep(sink: ShellSink, mat: ShellMat, k: number, f: TunnelFrame, st: readonly number[], c: number, hw: number, y0: number, y1: number, bottom: boolean): void {
  for (let j = 0; j + 1 < st.length; j++) {
    const sa = st[j], sb = st[j + 1], mid = (sa + sb) / 2;
    const a = sink.get(mat, k, mid);
    const A = f.at(sa), B = f.at(sb);
    const L0 = f.point(sa, c - hw), L1 = f.point(sb, c - hw), R0 = f.point(sa, c + hw), R1 = f.point(sb, c + hw);
    // top
    const up: V3 = [0, 1, 0], dn: V3 = [0, -1, 0];
    a.quad(a.v([L0[0], y1, L0[1]], up, 0, 0), a.v([L1[0], y1, L1[1]], up, 1, 0), a.v([R1[0], y1, R1[1]], up, 1, 1), a.v([R0[0], y1, R0[1]], up, 0, 1));
    if (bottom) a.quad(a.v([L0[0], y0, L0[1]], dn, 0, 0), a.v([R0[0], y0, R0[1]], dn, 0, 1), a.v([R1[0], y0, R1[1]], dn, 1, 1), a.v([L1[0], y0, L1[1]], dn, 1, 0));
    // +lat side (normal = left) and -lat side (normal = -left)
    const nPa: V3 = [A.lx, 0, A.lz], nPb: V3 = [B.lx, 0, B.lz], nMa: V3 = [-A.lx, 0, -A.lz], nMb: V3 = [-B.lx, 0, -B.lz];
    a.quad(a.v([R0[0], y0, R0[1]], nPa, 0, 0), a.v([R1[0], y0, R1[1]], nPb, 1, 0), a.v([R1[0], y1, R1[1]], nPb, 1, 1), a.v([R0[0], y1, R0[1]], nPa, 0, 1));
    a.quad(a.v([L0[0], y0, L0[1]], nMa, 0, 0), a.v([L0[0], y1, L0[1]], nMa, 0, 1), a.v([L1[0], y1, L1[1]], nMb, 1, 1), a.v([L1[0], y0, L1[1]], nMb, 1, 0));
  }
}

/** Steel door frame (jambs + head) proud of the shell wall at an opening, and the SERVICE plate above it. */
function doorFrame(sink: ShellSink, k: number, f: TunnelFrame, o: ShellOpening, y0: number, mats: WorldMaterials): void {
  const half = f.half, lat = o.side * half;
  const jw = 0.1, depth = 0.12;
  const mid = (o.s0 + o.s1) / 2;
  const steel = sink.get('steel', k, mid);
  for (const s of [o.s0 - jw / 2, o.s1 + jw / 2]) {
    const p = f.at(s), b = basisOf(p.tx, p.tz);
    const w = f.point(s, lat - o.side * (depth / 2 - 0.03));
    steel.box([w[0], (y0 + o.head + 0.08) / 2, w[1]], [jw / 2, (o.head + 0.08 - y0) / 2, depth / 2], b.x, b.y, b.z);
  }
  // Head: a straight member between the jamb tops (chord of a curved wall; inside the jambs).
  const pa = f.point(o.s0 - jw, lat - o.side * (depth / 2 - 0.03)), pb = f.point(o.s1 + jw, lat - o.side * (depth / 2 - 0.03));
  const dx = pb[0] - pa[0], dz = pb[1] - pa[1], len = Math.hypot(dx, dz);
  const hb = basisOf(dx / len, dz / len);
  steel.box([(pa[0] + pb[0]) / 2, o.head + 0.04, (pa[1] + pb[1]) / 2], [len / 2, 0.06, depth / 2], hb.x, hb.y, hb.z);
  // Plate: steel backing + sign face, centred over the opening (or beside it when the lintel is too low).
  const p = f.at(mid), b = basisOf(p.tx, p.tz);
  const inward: V3 = [-o.side * p.lx, 0, -o.side * p.lz];
  const w = f.point(mid, lat);
  const py = Math.min(o.head + 0.42, o.head + 0.15 + 0.25);
  const pw = Math.min(1.25, Math.max(0.8, o.s1 - o.s0)), ph = pw * 220 / 1024 * 1.05;
  steel.box([w[0] + inward[0] * 0.012, py, w[1] + inward[2] * 0.012], [pw / 2 + 0.02, ph / 2 + 0.02, 0.012], b.x, b.y, b.z);
  const sign = sink.get('sign', k, mid);
  // The face reads left-to-right for a viewer facing the wall: u along `right` = cross(view, up), view = -inward.
  const right: V3 = [inward[2], 0, -inward[0]];
  const rx = right[0] * pw / 2, rz = right[2] * pw / 2;
  const cx = w[0] + inward[0] * 0.026, cz = w[1] + inward[2] * 0.026;
  const ids = [
    sign.v([cx - rx, py - ph / 2, cz - rz], inward, 0, 0), sign.v([cx + rx, py - ph / 2, cz + rz], inward, 1, 0),
    sign.v([cx + rx, py + ph / 2, cz + rz], inward, 1, 1), sign.v([cx - rx, py + ph / 2, cz - rz], inward, 0, 1),
  ];
  sign.quad(ids[0], ids[1], ids[2], ids[3]);
  void mats;
}

/**
 * Floors / ceilings of open cells the shell took from the builder but that reach beyond a shell wall (a door passage
 * on a bend): the part outside the wall line, clipped against it, in the builder's materials.
 */
function straddleCells(sink: ShellSink, view: TrackExtView, layout: StationLayout, mats: WorldMaterials): void {
  const g: Grid = layout.grid;
  const fm = mats.scale.concrete, cmS = mats.scale.ceilingService;
  for (let i = 0; i < view.mode.length; i++) {
    if (view.mode[i] === CELL_BUILDER) continue;
    const v = view.tunnels[view.owner[i]];
    if (!v) continue;
    const x = i % g.w, y = (i - x) / g.w;
    const area = layout.areas[g.area[i]];
    const floorKey: MatKey = area?.publicSpace ? 'terrazzo' : 'concrete';
    const ceilKey: MatKey = area?.publicSpace ? 'ceiling' : 'ceilingService';
    const fy = g.floorOf(i), cy = cellCeil(g, i);
    const fs = mats.scale[floorKey] ?? fm, cs = mats.scale[ceilKey] ?? cmS;
    // Quarter cells, each clipped at the wall's tangent there (a curved wall line within ~2 mm), overlapping the shell's
    // strip by 4 mm so no crack opens along the wall line.
    const h = CELL / 2;
    for (const [qx, qz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x0 = x * CELL + qx * h, z0 = y * CELL + qz * h, x1 = x0 + h, z1 = z0 + h;
      const poly = clipOutside(v.f, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 0.004);
      if (!poly || polyArea(poly) < 1e-5) continue;
      const s = v.f.project(x0 + h / 2, z0 + h / 2).s;
      const fl = sink.get(floorKey, view.owner[i], s), ce = sink.get(ceilKey, view.owner[i], s);
      fl.fan(poly.map(([px, pz]) => fl.v([px, fy, pz], [0, 1, 0], px / fs.u, -pz / fs.v)));
      ce.fan(poly.map(([px, pz]) => ce.v([px, cy, pz], [0, -1, 0], px / cs.u, pz / cs.v)));
    }
  }
}

/**
 * The part of a convex polygon outside the corridor, clipped at the nearest shell wall's local tangent line (null if
 * none). `bias` (m) moves the cut that far INTO the corridor (a small overlap with the shell's floor / ceiling strip).
 */
export function clipOutside(f: TunnelFrame, poly: [number, number][], bias = 0): [number, number][] | null {
  let cx = 0, cz = 0;
  for (const [x, z] of poly) { cx += x; cz += z; }
  cx /= poly.length; cz /= poly.length;
  const c = f.project(cx, cz);
  const side = c.lat >= 0 ? 1 : -1;
  const p = f.at(Math.max(0, Math.min(f.length, c.s)));
  const ox = side * p.lx, oz = side * p.lz;
  const wx = p.x + ox * f.half, wz = p.z + oz * f.half;
  const d = (q: [number, number]) => (q[0] - wx) * ox + (q[1] - wz) * oz + bias;
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = d(a), db = d(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const u = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
  }
  return out.length >= 3 ? out : null;
}

function polyArea(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
  return Math.abs(a) / 2;
}
