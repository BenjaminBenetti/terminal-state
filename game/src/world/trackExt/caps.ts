// Track 2 (Beyond the Station), lane VIS: the physical terminal of a track tunnel (TrackTunnel.cap) — a rubble heap,
// a concrete bulkhead or a closed steel service gate. Every kind closes the FULL cross-section with opaque geometry
// (a back plane / slab spanning wall to wall, floor to ceiling); the grid cells behind the cap are SOLID (GEN), so the
// front of the cap is placed at the end of the walkable cells (where the player and bullets stop).

import {CELL, FLOOR} from '../../gen/grid';
import type {StationLayout} from '../../gen/station';
import type {WorldMaterials} from '../materials';
import {Acc, basisOf, hashOf, prng, type V3} from './mesh';
import type {ShellSink} from './shell';
import type {TunnelView} from './view';

/** Arc span of a cap: front face (toward the player) and back (the shell is extended to it when past the path end). */
export interface CapSpan { front: number; back: number; walkEnd: number }

/** Depth (m) each cap kind needs behind its front face. */
export const CAP_DEPTH = {rubble: 0.25, bulkhead: 0.45, gate: 0.75} as const;
/**
 * How far a cap may extend the shell past the path end (m): inside the rock lane GEN reserves behind the cap plane
 * (gen/trackExt/config.ts TRACK_EXT.tunnel.capDepth = 1.5 m), less a 0.1 m skin.
 */
export const CAP_OVERHANG = 1.4;

/**
 * Where the walkable tunnel cells end (grid ground truth: far edge of the last walkable cell along the path) and the
 * cap's span from there. Rubble rises from its toe in front of the walkable end up to the ceiling at the path end.
 */
export function capSpan(v: TunnelView, layout: StationLayout): CapSpan {
  const g = layout.grid, f = v.f, L = f.length;
  const areas = new Set(v.t.areas);
  let walkEnd = -Infinity;
  const b = f.bounds;
  const x0 = Math.max(0, Math.floor(b.x0 / CELL)), x1 = Math.min(g.w - 1, Math.floor(b.x1 / CELL));
  const y0 = Math.max(0, Math.floor(b.z0 / CELL)), y1 = Math.min(g.h - 1, Math.floor(b.z1 / CELL));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * g.w + x;
    if (g.cells[i] !== FLOOR || !areas.has(g.area[i])) continue;
    // Far edge of the cell along the path (max over its corners).
    for (const [u, w] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const c = f.project((x + u) * CELL, (y + w) * CELL);
      if (c.s <= L + 0.5 && Math.abs(c.lat) < f.half) walkEnd = Math.max(walkEnd, c.s);
    }
  }
  if (!Number.isFinite(walkEnd)) walkEnd = L - 0.5;
  walkEnd = Math.min(walkEnd, L);
  const kind = v.t.cap.kind;
  // Rubble: ankle-high scree from 1 m in front of the walkable end, the heap itself in the reserved rock behind it.
  const front = kind === 'rubble' ? Math.max(0.5, walkEnd - 1.0) : Math.max(0.5, Math.min(walkEnd, L));
  const back = Math.min(L + CAP_OVERHANG, Math.max(kind === 'rubble' ? L + CAP_OVERHANG : L, front + CAP_DEPTH[kind]));
  return {front, back, walkEnd};
}

/** Build the cap of tunnel k into the sink. */
export function buildCap(sink: ShellSink, v: TunnelView, k: number, mats: WorldMaterials, span: CapSpan, seed: number): void {
  const kind = v.t.cap.kind;
  if (kind === 'bulkhead') bulkhead(sink, v, k, mats, span, seed);
  else if (kind === 'gate') gate(sink, v, k, span, seed);
  else rubble(sink, v, k, mats, span, seed);
}

/** Cross-section frame at arc s: origin on the centreline at floor height, axes t (along), up, left. */
function section(v: TunnelView, s: number) {
  const p = v.f.at(s), b = basisOf(p.tx, p.tz);
  const at = (d: number, lat: number, y: number): V3 => [p.x + p.tx * d + p.lx * lat, y, p.z + p.tz * d + p.lz * lat];
  return {p, b, at, left: [p.lx, 0, p.lz] as V3};
}

function bulkhead(sink: ShellSink, v: TunnelView, k: number, mats: WorldMaterials, span: CapSpan, seed: number): void {
  const {floorY: y0, ceilY: y1} = v.t, half = v.f.half, H = y1 - y0;
  const d = span.back - span.front;
  const S = section(v, span.front);
  const conc = sink.get('platformFace', k, span.front), steel = sink.get('steel', k, span.front), haz = sink.get('hazard', k, span.front);
  const ms = mats.scale.platformFace;
  // The wall: wall to wall, floor to ceiling (slightly into the shell so no seam shows).
  conc.box(S.at(d / 2, 0, y0 + H / 2), [d / 2, H / 2 + 0.02, half + 0.04], S.b.x, S.b.y, S.b.z, ms);
  const rnd = prng(hashOf('cap-bulkhead', seed, v.t.id));
  // Steel personnel door (closed) in a frame, toward one side.
  const dl = (rnd() < 0.5 ? -1 : 1) * Math.min(half - 1.0, half * 0.45);
  steel.box(S.at(-0.03, dl, y0 + 1.06), [0.03, 1.06, 0.5], S.b.x, S.b.y, S.b.z);
  for (const s of [-1, 1]) steel.box(S.at(-0.04, dl + s * 0.55, y0 + 1.12), [0.04, 1.12, 0.05], S.b.x, S.b.y, S.b.z);
  steel.box(S.at(-0.04, dl, y0 + 2.24), [0.04, 0.05, 0.6], S.b.x, S.b.y, S.b.z);
  steel.box(S.at(-0.075, dl - 0.36 * Math.sign(dl || 1), y0 + 1.05), [0.02, 0.02, 0.09], S.b.x, S.b.y, S.b.z); // handle
  // Structural steel: two columns and a header beam, bolted to the face.
  for (const s of [-1, 1]) steel.box(S.at(-0.06, s * (half - 0.35), y0 + H / 2), [0.06, H / 2, 0.11], S.b.x, S.b.y, S.b.z);
  steel.box(S.at(-0.06, 0, y0 + Math.min(3.6, H - 0.5)), [0.06, 0.13, half - 0.25], S.b.x, S.b.y, S.b.z);
  // Hazard band along the foot.
  haz.box(S.at(-0.012, 0, y0 + 0.16), [0.012, 0.14, half - 0.47], S.b.x, S.b.y, S.b.z, {u: 0.6, v: 0.3});
}

function gate(sink: ShellSink, v: TunnelView, k: number, span: CapSpan, seed: number): void {
  const {floorY: y0, ceilY: y1} = v.t, half = v.f.half, H = y1 - y0;
  const S = section(v, span.front + 0.12);
  const steel = sink.get('steel', k, span.front), haz = sink.get('hazard', k, span.front), dark = sink.get('void', k, span.front);
  const B = section(v, span.back - 0.04);
  // Opaque black backing: the darkness behind the bars, closing the whole section.
  dark.box(B.at(0, 0, y0 + H / 2), [0.03, H / 2 + 0.02, half + 0.04], B.b.x, B.b.y, B.b.z);
  const top = y0 + Math.min(3.3, H - 0.9);
  const box = (d: number, lat: number, y: number, hd: number, hl: number, hy: number, a: Acc = steel) => a.box(S.at(d, lat, y), [hd, hy, hl], S.b.x, S.b.y, S.b.z);
  // Fixed frame: posts at the walls, a beam over the leaves, a head beam under the ceiling.
  for (const s of [-1, 1]) box(0, s * (half - 0.1), y0 + H / 2, 0.1, 0.1, H / 2);
  box(0, 0, top + 0.09, 0.1, half, 0.09);
  box(0, 0, y1 - 0.08, 0.08, half, 0.08);
  // Grille above the leaves.
  for (let lat = -half + 0.32; lat < half - 0.25; lat += 0.22) box(0, lat, (top + 0.18 + y1 - 0.16) / 2, 0.015, 0.015, (y1 - 0.16 - top - 0.18) / 2);
  box(0, 0, (top + y1) / 2, 0.02, half - 0.2, 0.025);
  // Two closed sliding leaves meeting at the centre: tube frames, bars, mid rails, a solid kick plate.
  const rnd = prng(hashOf('cap-gate', seed, v.t.id));
  const lh = (top - y0) / 2;
  for (const s of [-1, 1]) {
    const a = s < 0 ? -half + 0.2 : 0.01, b = s < 0 ? -0.01 : half - 0.2, c = (a + b) / 2, w = (b - a) / 2;
    const d = s < 0 ? -0.02 : 0.06; // the leaves overlap on two tracks
    box(d, a + 0.04, y0 + lh, 0.04, 0.04, lh); box(d, b - 0.04, y0 + lh, 0.04, 0.04, lh);
    box(d, c, top - 0.04, 0.04, w, 0.04); box(d, c, y0 + 0.04, 0.04, w, 0.04);
    for (const yy of [y0 + 1.25, y0 + 2.3]) if (yy < top - 0.2) box(d, c, yy, 0.03, w, 0.03);
    for (let lat = a + 0.16; lat < b - 0.1; lat += 0.15) box(d, lat, y0 + lh, 0.014, 0.014, lh - 0.04);
    box(d - 0.02, c, y0 + 0.4, 0.012, w - 0.04, 0.33);
    box(d - 0.035, c, y0 + 0.62, 0.006, w - 0.08, 0.07, haz);
    // Diagonal brace (a slanted box in the leaf plane).
    const len = Math.hypot(2 * w, top - y0 - 0.9), ang = Math.atan2(top - y0 - 0.9, 2 * w) * (rnd() < 0.5 ? 1 : -1);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ax: V3 = [S.b.z[0] * ca, sa, S.b.z[2] * ca];
    const ay: V3 = [-S.b.z[0] * sa, ca, -S.b.z[2] * sa];
    steel.box(S.at(d, c, y0 + 0.8 + (top - y0 - 0.9) / 2), [len / 2, 0.025, 0.02], ax, ay, S.b.x);
  }
  // Chain and padlock where the leaves meet.
  for (let i = 0; i < 6; i++) box(-0.07, (i % 2 ? 0.03 : -0.03), y0 + 1.15 - i * 0.05, 0.012, 0.03, 0.022);
  box(-0.08, 0, y0 + 0.82, 0.02, 0.04, 0.05);
}

function rubble(sink: ShellSink, v: TunnelView, k: number, mats: WorldMaterials, span: CapSpan, seed: number): void {
  const {floorY: y0, ceilY: y1} = v.t, half = v.f.half, H = y1 - y0;
  const L = v.f.length;
  const rnd = prng(hashOf('cap-rubble', seed, v.t.id));
  const conc = sink.get('platformFace', k, L), gravel = sink.get('ballast', k, L), slabs = sink.get('ceiling', k, L), panels = sink.get('tunnel', k, L), bars = sink.get('rail', k, L);
  const ms = mats.scale.platformFace, gs = mats.scale.ballast;
  // Toe ~1 m in front of the walkable end (only ankle-high scree there), crest against the ceiling at the back.
  const toe = Math.max(0.3, span.front), back = span.back, sW = Math.max(toe + 0.2, Math.min(span.walkEnd, back - 0.6));
  const D = back - toe;
  // Back plane: closes the section behind the heap.
  const B = section(v, back - 0.05);
  conc.box(B.at(0, 0, y0 + H / 2), [0.05, H / 2 + 0.02, half + 0.04], B.b.x, B.b.y, B.b.z, ms);
  // Heap surface: a rough height field over (depth u, lateral l) — scree at the toe, a steep lumpy face, the crest
  // jammed against the ceiling at the back; one side a little higher (the collapse came down askew).
  const skew = (rnd() - 0.5) * 0.35;
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  const noise = (u: number, l: number) =>
    Math.sin(u * 7.3 + l * 3.1 + ph[0]) * 0.5 + Math.sin(u * 13.7 - l * 6.3 + ph[1]) * 0.3 + Math.sin(u * 23.1 + l * 11.9 + ph[2]) * 0.2;
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const heightAt = (u: number, l: number) => {
    const s = toe + u * D;
    if (s < sW) {
      // Scree in front of the walkable end: knee-high at most where the player can stand.
      const k = (s - toe) / (sW - toe);
      return y0 + Math.max(0.03, Math.min(0.3, 0.05 + 0.22 * k + noise(u, l) * 0.04));
    }
    const t = (s - sW) / Math.max(0.2, back - 0.05 - sW);
    const body = 0.055 + 0.945 * Math.pow(smooth(0, 1, t), 0.75);
    const h = body + skew * l * t + noise(u, l) * 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.1));
    return y0 + Math.max(0.055, Math.min(1, h)) * H;
  };
  const NU = 14, NL = 18;
  const grid: number[][] = [];
  for (let iu = 0; iu <= NU; iu++) {
    const row: number[] = [];
    const u = iu / NU;
    for (let il = 0; il <= NL; il++) {
      const l = il / NL * 2 - 1;
      // Jitter along the tunnel (not at the edges: the heap meets the walls and the ceiling cleanly).
      const edge = il === 0 || il === NL || iu === NU;
      const du = edge ? 0 : (noise(l * 2.1, u * 3.3) * 0.18) / D;
      const s = toe + Math.max(0, Math.min(1, u + du)) * D, lat = l * (half + 0.03);
      const p = v.f.at(s);
      const y = iu === NU ? y1 + 0.02 : heightAt(u, l);
      const x = p.x + p.lx * lat, z = p.z + p.lz * lat;
      // UV along the surface: lateral x (height + depth) — the face is steep, a plan projection would streak.
      row.push(gravel.v([x, y, z], [0, 1, 0], lat / gs.u, (y - y0 + (s - toe)) / gs.v));
    }
    grid.push(row);
  }
  // Normals from the height field's finite differences.
  const P = gravel.pos, N = gravel.nor;
  const vec = (a: number, b: number): V3 => [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
  for (let iu = 0; iu <= NU; iu++) for (let il = 0; il <= NL; il++) {
    const i = grid[iu][il];
    const du = vec(grid[Math.max(0, iu - 1)][il], grid[Math.min(NU, iu + 1)][il]);
    const dl = vec(grid[iu][Math.max(0, il - 1)], grid[iu][Math.min(NL, il + 1)]);
    let n = norm3(cross3(dl, du));
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    N[i * 3] = n[0]; N[i * 3 + 1] = n[1]; N[i * 3 + 2] = n[2];
  }
  for (let iu = 0; iu < NU; iu++) for (let il = 0; il < NL; il++) gravel.quad(grid[iu][il], grid[iu][il + 1], grid[iu + 1][il + 1], grid[iu + 1][il]);
  // Concrete blocks bedded in the slope (half buried), bigger higher up; small scree at the toe.
  const n = Math.round(70 + half * 9);
  for (let i = 0; i < n; i++) {
    const u = Math.pow(rnd(), 0.8) * 0.97, l = rnd() * 2 - 1;
    const s = toe + u * D, lat = l * (half - 0.1);
    const r = s < sW ? 0.06 + rnd() * 0.1 : (0.18 + rnd() * 0.42) * (0.7 + u * 0.6);
    const p = v.f.at(s);
    const cy = heightAt(u, l) - r * (0.25 + rnd() * 0.35);
    rock(conc, [p.x + p.lx * lat, Math.max(y0 + r * 0.45, cy), p.z + p.lz * lat], r, rnd, ms);
  }
  // Fallen ceiling slabs and wall panels jammed into the face at steep angles (bedded, never floating).
  const slab = (a: Acc, u: number, l: number, len: number, wid: number, tilt: number, yaw: number, scale: {u: number; v: number}) => {
    const s = toe + u * D, lat = l * half;
    const p = v.f.at(s), b = basisOf(p.tx, p.tz);
    const ax = rotY(b.x, yaw), az = rotY(b.z, yaw);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const tx: V3 = [ax[0] * ct, st, ax[2] * ct], ty: V3 = [-ax[0] * st, ct, -ax[2] * st];
    a.box([p.x + p.lx * lat, heightAt(u, l) - 0.12, p.z + p.lz * lat], [len, 0.075, wid], tx, ty, az, scale);
  };
  const uHeap = (sW - toe) / D; // where the heap proper starts (scree before it)
  const nSlab = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < nSlab; i++) {
    const u = uHeap + 0.08 + rnd() * (0.85 - uHeap), l = rnd() * 1.7 - 0.85;
    slab(i % 3 === 2 ? panels : slabs, u, l, 0.5 + rnd() * 0.5, 0.35 + rnd() * 0.35, -(0.55 + rnd() * 0.6), (rnd() - 0.5) * 0.9, i % 3 === 2 ? mats.scale.tunnel : mats.scale.ceiling);
  }
  // Broken ceiling hanging down over the crest.
  for (let i = 0; i < 3; i++) {
    const l = (i - 1) * 0.6 + (rnd() - 0.5) * 0.3, s = back - 0.3 - rnd() * 0.5;
    const p = v.f.at(s), b = basisOf(p.tx, p.tz);
    const tilt = 0.5 + rnd() * 0.5, ct = Math.cos(tilt), st = Math.sin(tilt);
    const tx: V3 = [b.x[0] * ct, -st, b.x[2] * ct], ty: V3 = [b.x[0] * st, ct, b.x[2] * st];
    const len = 0.45 + rnd() * 0.3;
    slabs.box([p.x + p.lx * l * half - p.tx * len * ct, y1 - 0.02 - len * st, p.z + p.lz * l * half - p.tz * len * ct], [len, 0.07, 0.4 + rnd() * 0.3], tx, ty, b.z, mats.scale.ceiling);
  }
  // Bent reinforcement sticking out of the face.
  const nBar = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < nBar; i++) {
    const u = uHeap + 0.1 + rnd() * (0.9 - uHeap), l = rnd() * 1.6 - 0.8, s = toe + u * D, lat = l * half;
    const p = v.f.at(s);
    const a = Math.atan2(-p.tz, -p.tx) + (rnd() - 0.5) * 1.6, e = 0.2 + rnd() * 0.9;
    const dx = Math.cos(a) * Math.cos(e), dy = Math.sin(e), dz = Math.sin(a) * Math.cos(e);
    const len = 0.5 + rnd() * 0.8;
    const c: V3 = [p.x + p.lx * lat + dx * len / 2, heightAt(u, l) + dy * len / 2 - 0.05, p.z + p.lz * lat + dz * len / 2];
    const ax: V3 = [dx, dy, dz];
    const side = norm3(cross3(ax, [0, 1, 0.0001]));
    bars.box(c, [len / 2, 0.009, 0.009], ax, norm3(cross3(side, ax)), side);
  }
}

/** A rough boulder: a jittered, flat-shaded octahedron-capped block (planar UVs in metres). */
function rock(a: Acc, c: V3, r: number, rnd: () => number, ms: {u: number; v: number}): void {
  const sx = r * (0.8 + rnd() * 0.5), sy = r * (0.55 + rnd() * 0.4), sz = r * (0.8 + rnd() * 0.5);
  const yaw = rnd() * Math.PI;
  const cy = Math.cos(yaw), syw = Math.sin(yaw);
  const pts: V3[] = [];
  // 6 axis tips + 8 corners pulled in: a chunky 14-point hull approximated by fixed faces.
  const tip = (x: number, y: number, z: number): V3 => {
    const j = 0.82 + rnd() * 0.3;
    const lx = x * sx * j, ly = y * sy * j, lz = z * sz * j;
    return [c[0] + lx * cy - lz * syw, c[1] + ly, c[2] + lx * syw + lz * cy];
  };
  for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) pts.push(tip(x, y, z));
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push(tip(x * 0.62, y * 0.62, z * 0.62));
  // Faces: each corner with its three adjacent tips (8 x 3 triangles) = a closed 24-triangle hull.
  const tipIdx = (axis: number, s: number) => axis * 2 + (s > 0 ? 0 : 1);
  let ci = 6;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const C = pts[ci++], X = pts[tipIdx(0, x)], Y = pts[tipIdx(1, y)], Z = pts[tipIdx(2, z)];
    for (const [p, q] of [[X, Y], [Y, Z], [Z, X]] as [V3, V3][]) {
      const n = norm3(cross3(sub3(p, C), sub3(q, C)));
      // Outward: away from the rock centre.
      const m: V3 = [(C[0] + p[0] + q[0]) / 3 - c[0], (C[1] + p[1] + q[1]) / 3 - c[1], (C[2] + p[2] + q[2]) / 3 - c[2]];
      const o = dot3(n, m) >= 0 ? n : [-n[0], -n[1], -n[2]] as V3;
      const uvOf = (q3: V3): [number, number] => Math.abs(o[1]) > 0.6 ? [q3[0] / ms.u, -q3[2] / ms.v] : Math.abs(o[0]) > Math.abs(o[2]) ? [q3[2] / ms.u, q3[1] / ms.v] : [q3[0] / ms.u, q3[1] / ms.v];
      const ids = [C, p, q].map(q3 => { const [u, w] = uvOf(q3); return a.v(q3, o, u, w); });
      a.tri(ids[0], ids[1], ids[2]);
    }
  }
}

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rotY = (a: V3, ang: number): V3 => { const c = Math.cos(ang), s = Math.sin(ang); return [a[0] * c - a[2] * s, a[1], a[0] * s + a[2] * c]; };
