// Iteration 05 (Lane T): geometry for vertical traversal, built from the layout's grid ramps and
// traversal connectors — stair flights (terrazzo treads and risers with safety nosings, sloped
// tiled side walls and ceilings following the flight, steel handrails), steel rescue ladders on the
// platform faces (stiles, rungs, stand-off brackets, a hazard marking on the platform edge above
// each), the track-structure beams over the underpass crossing, and striped barricades at the
// tunnel mouths that mark the end of the walkable track bed. Everything uses the existing material
// keys (world/materials.ts) or world-mapped surface sets; merged per material (few draw calls).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {CELL, SOLID, rampHeight, type Grid, type Ramp} from '../gen/grid';
import type {StationLayout} from '../gen/station';
import {surfaceMaterial, type MatKey, type WorldMaterials} from './materials';
import {canvasTexture} from './canvasTextures';

/** The builder's per-material quad accumulator. */
export interface QuadSink { quad(p: number[][], n: readonly number[], uv: number[][]): void }

interface V3 { x: number; y: number; z: number }

/** Handrail height above the pitch line (m) and its stand-off from the wall face. */
const RAIL_Y = 0.9, RAIL_OFF = 0.07;

const yellowSteel = new WeakMap<WorldMaterials, THREE.Material>();
const hazardMats = new WeakMap<WorldMaterials, THREE.MeshStandardMaterial>();

/** Safety-yellow painted steel (rescue ladders), world-mapped like the other steel keys. */
function ladderMaterial(mats: WorldMaterials): THREE.Material {
  let m = yellowSteel.get(mats);
  if (!m) { m = surfaceMaterial('brushedSteel', {color: 0xd6a020, metalness: 0.35}, {grime: [0.3, 0.6], macro: 0.15}); m.name = 'ladder-steel'; yellowSteel.set(mats, m); }
  return m;
}

/** Yellow/black hazard stripes (ladder edge markings, tunnel barricade planks); repeats along u. */
function hazardMaterial(mats: WorldMaterials): THREE.MeshStandardMaterial {
  let m = hazardMats.get(mats);
  if (!m) {
    const tex = canvasTexture(256, 128, 5051, (ctx, w, h, rnd) => {
      ctx.fillStyle = '#d9a21c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1c1c1a';
      for (let x = -h; x < w + h; x += 64) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 32, h); ctx.lineTo(x + 32 + h, 0); ctx.lineTo(x + h, 0); ctx.closePath(); ctx.fill(); }
      // wear: scuffs and grime specks
      for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(${rnd() < 0.5 ? '40,36,30' : '120,110,90'},${0.08 + rnd() * 0.2})`; ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 5, 1 + rnd() * 3); }
    });
    m = new THREE.MeshStandardMaterial({map: tex, roughness: 0.8, metalness: 0.05});
    m.name = 'hazard-stripes';
    hazardMats.set(mats, m);
  }
  return m;
}

/** Box from a to b (any direction) with a square cross-section t. */
function beam(out: THREE.BufferGeometry[], a: V3, b: V3, t: number, t2 = t): void {
  const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = d.length();
  if (len < 1e-4) return;
  const g = new THREE.BoxGeometry(t, t2, len);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  out.push(g);
}

function box(out: THREE.BufferGeometry[], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, uScale = 0): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (uScale > 0) {
    // Repeat the texture along the box's longest horizontal side (striped planks).
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const reps = Math.max(sx, sz) / uScale;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * reps);
  }
  g.translate(cx, cy, cz);
  out.push(g);
}

function addMerged(group: THREE.Group, list: THREE.BufferGeometry[], mat: THREE.Material, name: string): void {
  if (!list.length) return;
  const merged = mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)), false);
  for (const g of list) g.dispose();
  if (!merged) return;
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
}

/**
 * Vertical quad along a wall line. `alongX`: the wall runs along X at z = line (normal ±Z), else
 * along Z at x = line (normal ±X). Bottom/top heights may differ at the two ends (sloped walls).
 */
function wallQuad(sink: QuadSink, m: {u: number; v: number}, alongX: boolean, line: number, sign: 1 | -1, a0: number, a1: number,
  yA0: number, yB0: number, yA1: number, yB1: number, vA0: number, vB0: number, vA1: number, vB1: number): void {
  if (alongX) {
    if (sign > 0) sink.quad([[a0, yA0, line], [a1, yB0, line], [a1, yB1, line], [a0, yA1, line]], [0, 0, 1], [[a0 / m.u, vA0], [a1 / m.u, vB0], [a1 / m.u, vB1], [a0 / m.u, vA1]]);
    else sink.quad([[a1, yB0, line], [a0, yA0, line], [a0, yA1, line], [a1, yB1, line]], [0, 0, -1], [[-a1 / m.u, vB0], [-a0 / m.u, vA0], [-a0 / m.u, vA1], [-a1 / m.u, vB1]]);
  } else {
    if (sign > 0) sink.quad([[line, yB0, a1], [line, yA0, a0], [line, yA1, a0], [line, yB1, a1]], [1, 0, 0], [[-a1 / m.u, vB0], [-a0 / m.u, vA0], [-a0 / m.u, vA1], [-a1 / m.u, vB1]]);
    else sink.quad([[line, yA0, a0], [line, yB0, a1], [line, yB1, a1], [line, yA1, a0]], [-1, 0, 0], [[a0 / m.u, vA0], [a1 / m.u, vB0], [a1 / m.u, vB1], [a0 / m.u, vA1]]);
  }
}

/** Horizontal (or along-axis sloped) quad; y0 at s0, y1 at s1 along the ramp axis. */
function flatQuad(sink: QuadSink, m: {u: number; v: number}, axisX: boolean, s0: number, s1: number, a0: number, a1: number, y0: number, y1: number, up: boolean): void {
  const [sa, sb, ya, yb] = s0 <= s1 ? [s0, s1, y0, y1] : [s1, s0, y1, y0];
  // corners in x/z order like the builder's floorQuad / ceilQuad
  const x0 = axisX ? sa : a0, x1 = axisX ? sb : a1, z0 = axisX ? a0 : sa, z1 = axisX ? a1 : sb;
  const yAt = (x: number, z: number) => ((axisX ? x : z) === sa ? ya : yb);
  const k = (yb - ya) / Math.max(1e-6, sb - sa);
  if (up) {
    const n = axisX ? [-k, 1, 0] : [0, 1, -k];
    const l = Math.hypot(n[0], n[1], n[2]);
    sink.quad([[x0, yAt(x0, z0), z0], [x0, yAt(x0, z1), z1], [x1, yAt(x1, z1), z1], [x1, yAt(x1, z0), z0]], [n[0] / l, n[1] / l, n[2] / l],
      [[x0 / m.u, -z0 / m.v], [x0 / m.u, -z1 / m.v], [x1 / m.u, -z1 / m.v], [x1 / m.u, -z0 / m.v]]);
  } else {
    const n = axisX ? [k, -1, 0] : [0, -1, k];
    const l = Math.hypot(n[0], n[1], n[2]);
    sink.quad([[x0, yAt(x0, z0), z0], [x1, yAt(x1, z0), z0], [x1, yAt(x1, z1), z1], [x0, yAt(x0, z1), z1]], [n[0] / l, n[1] / l, n[2] / l],
      [[x0 / m.u, z0 / m.v], [x1 / m.u, z0 / m.v], [x1 / m.u, z1 / m.v], [x0 / m.u, z1 / m.v]]);
  }
}

/** Stair flight geometry for one grid ramp. */
function buildFlight(g: Grid, r: Ramp, layout: StationLayout, mats: WorldMaterials, acc: (k: MatKey) => QuadSink, steel: THREE.BufferGeometry[]): void {
  const area = layout.areas[g.area[g.idx(r.x, r.y)]];
  const pub = area?.publicSpace ?? true;
  const floorMat: MatKey = pub ? 'terrazzo' : 'concrete';
  const axisX = r.axis === 'x';
  const lo = (axisX ? r.x : r.y) * CELL, hi = lo + (axisX ? r.w : r.h) * CELL;
  const a0 = (axisX ? r.y : r.x) * CELL, a1 = a0 + (axisX ? r.h : r.w) * CELL;
  const H = (s: number) => rampHeight(r, s);
  const kinks = [...new Set([lo, hi, r.s0, r.s1].filter(s => s >= lo - 1e-6 && s <= hi + 1e-6).map(s => Math.round(s * 1e4) / 1e4))].sort((p, q) => p - q);
  const TILE = mats.tileLowerHeight;
  // Ceiling following the flight (one quad per straight piece across the full width).
  const ceilMat: MatKey = pub ? 'ceiling' : 'ceilingService';
  for (let i = 0; i + 1 < kinks.length; i++) flatQuad(acc(ceilMat), mats.scale[ceilMat], axisX, kinks[i], kinks[i + 1], a0, a1, H(kinks[i]) + r.headroom, H(kinks[i + 1]) + r.headroom, false);
  // Side walls (sheared tile bands follow the pitch line) where the neighbour across is rock.
  const n = axisX ? r.w : r.h;
  for (const side of [-1, 1] as const) {
    const line = side < 0 ? a0 : a1;
    const sign: 1 | -1 = side < 0 ? 1 : -1; // wall faces into the flight
    for (let c = 0; c < n; c++) {
      const cx = axisX ? r.x + c : side < 0 ? r.x - 1 : r.x + r.w, cy = axisX ? (side < 0 ? r.y - 1 : r.y + r.h) : r.y + c;
      if (g.get(cx, cy) !== SOLID) continue;
      const cs = lo + c * CELL, ce = cs + CELL;
      const pts = [cs, ...kinks.filter(k => k > cs + 1e-6 && k < ce - 1e-6), ce];
      for (let i = 0; i + 1 < pts.length; i++) {
        const sa = pts[i], sb = pts[i + 1], fa = H(sa), fb = H(sb);
        const top = r.headroom;
        if (pub) {
          const ml = mats.scale.tileLower, mu = mats.scale.tileUpper;
          wallQuad(acc('tileLower'), ml, axisX, line, sign, sa, sb, fa - 0.35, fb - 0.35, fa + TILE, fb + TILE, -0.35 / ml.v, -0.35 / ml.v, TILE / ml.v, TILE / ml.v);
          wallQuad(acc('tileUpper'), mu, axisX, line, sign, sa, sb, fa + TILE, fb + TILE, fa + top, fb + top, 0, 0, (top - TILE) / mu.v, (top - TILE) / mu.v);
        } else {
          const mp = mats.scale.paint;
          wallQuad(acc('paint'), mp, axisX, line, sign, sa, sb, fa - 0.35, fb - 0.35, fa + top, fb + top, -0.35 / mp.v, -0.35 / mp.v, top / mp.v, top / mp.v);
        }
      }
    }
  }
  // Treads, risers and safety nosings. Riser k sits at u = k + 0.5 of N (pitch line through tread centres).
  const N = r.risers, dirS = Math.sign(r.s1 - r.s0) || 1;
  const startS = dirS > 0 ? lo : hi, endS = dirS > 0 ? hi : lo;
  const riserS = Array.from({length: N}, (_, k) => r.s0 + (r.s1 - r.s0) * (k + 0.5) / N);
  const tread = (k: number) => r.h0 + (r.h1 - r.h0) * k / N;
  const bounds = [startS, ...riserS, endS];
  const fm = mats.scale[floorMat], nm = mats.scale.safetyEdge;
  for (let k = 0; k <= N; k++) {
    const sa = bounds[k], sb = bounds[k + 1];
    if (Math.abs(sb - sa) > 1e-4) flatQuad(acc(floorMat), fm, axisX, sa, sb, a0, a1, tread(k), tread(k), true);
  }
  const descending = r.h1 < r.h0;
  for (let k = 0; k < N; k++) {
    const s = riserS[k], yA = tread(k), yB = tread(k + 1);
    const y0 = Math.min(yA, yB), y1 = Math.max(yA, yB);
    // Riser faces the lower side of the step.
    const toward = (descending ? dirS : -dirS) as 1 | -1;
    wallQuad(acc(floorMat), fm, !axisX, s, toward, a0, a1, y0, y0, y1, y1, y0 / fm.v, y0 / fm.v, y1 / fm.v, y1 / fm.v);
    // Nosing strip on the upper tread's front edge.
    const upperDir = -toward;
    flatQuad(acc('safetyEdge'), nm, axisX, s, s + upperDir * 0.055, a0 + 0.03, a1 - 0.03, y1 + 0.003, y1 + 0.003, true);
  }
  // Handrails on both walls: steel rail along the pitch line + wall brackets.
  for (const side of [-1, 1] as const) {
    const mid = Math.floor(n / 2);
    const cx = axisX ? r.x + mid : side < 0 ? r.x - 1 : r.x + r.w, cy = axisX ? (side < 0 ? r.y - 1 : r.y + r.h) : r.y + mid;
    if (g.get(cx, cy) !== SOLID) continue;
    const across = side < 0 ? a0 + RAIL_OFF : a1 - RAIL_OFF;
    const P = (s: number): V3 => (axisX ? {x: s, y: H(s) + RAIL_Y, z: across} : {x: across, y: H(s) + RAIL_Y, z: s});
    const ss = [lo + 0.15, ...kinks.filter(k => k > lo + 0.15 && k < hi - 0.15), hi - 0.15];
    for (let i = 0; i + 1 < ss.length; i++) beam(steel, P(ss[i]), P(ss[i + 1]), 0.045);
    for (let s = lo + 0.4; s < hi - 0.2; s += 1.2) {
      const p = P(s), off = side < 0 ? -0.04 : 0.04;
      const q = axisX ? {x: p.x, y: p.y - 0.06, z: p.z + off} : {x: p.x + off, y: p.y - 0.06, z: p.z};
      beam(steel, p, q, 0.025);
    }
  }
}

/**
 * Builds all traversal geometry into `group`. `acc` is the builder's per-MatKey quad accumulator
 * (merged into the architecture meshes). Returns the number of ladders built.
 */
export function buildTraversal(group: THREE.Group, layout: StationLayout, mats: WorldMaterials, acc: (k: MatKey) => QuadSink): number {
  const g = layout.grid;
  const steel: THREE.BufferGeometry[] = [];
  const ladder: THREE.BufferGeometry[] = [];
  const stripes: THREE.BufferGeometry[] = [];
  for (const r of g.ramps) buildFlight(g, r, layout, mats, acc, steel);

  // Rescue ladders: two stiles, rungs every 0.28 m, stand-off brackets; hazard marking on the edge above.
  for (const l of layout.traversal.ladders) {
    const z = l.faceZ - l.dir * 0.075;
    const y0 = l.bottomY + 0.02, y1 = l.topY - 0.03;
    for (const sx of [-0.21, 0.21]) {
      box(ladder, l.x + sx, (y0 + y1) / 2, z, 0.055, y1 - y0, 0.022);
      for (const by of [y0 + 0.25, y1 - 0.12]) box(ladder, l.x + sx, by, l.faceZ - l.dir * 0.035, 0.04, 0.04, 0.07);
    }
    for (let y = l.bottomY + 0.28; y < l.topY - 0.08; y += 0.28) box(ladder, l.x, y, z, 0.42, 0.028, 0.028);
    // Marking lies on the platform safety edge, 0.9 m wide, from the edge 0.5 m in.
    box(stripes, l.x, l.topY + 0.003, l.faceZ + l.dir * 0.27, 0.9, 0.004, 0.5, 0.45);
  }

  // Underpass crossing: steel beams of the track structure overhead, across the passage.
  for (const u of layout.traversal.underpasses) {
    const a = layout.areas[u.bar];
    const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL, z0 = a.y * CELL, z1 = (a.y + a.h) * CELL;
    for (let zz = z0 + 0.8; zz < z1 - 0.4; zz += 1.6) box(steel, (x0 + x1) / 2, a.ceil - 0.11, zz, x1 - x0, 0.22, 0.16);
    box(steel, x0 + 0.25, a.ceil - 0.05, (z0 + z1) / 2, 0.14, 0.1, z1 - z0);
    box(steel, x1 - 0.25, a.ceil - 0.05, (z0 + z1) / 2, 0.14, 0.1, z1 - z0);
  }

  // Tunnel mouths: striped barricades (posts + planks) mark the end of the walkable track bed.
  for (const t of layout.trenches) {
    for (const x of [t.x0 + 0.4, t.x1 - 0.4]) {
      const zc = (t.z0 + t.z1) / 2, w = t.z1 - t.z0 - 0.3;
      for (const zz of [t.z0 + 0.25, t.z1 - 0.25, zc]) box(steel, x, t.floorY + 0.65, zz, 0.08, 1.3, 0.08);
      for (const y of [0.55, 1.1]) box(stripes, x + (x < (t.x0 + t.x1) / 2 ? 0.06 : -0.06), t.floorY + y, zc, 0.03, 0.2, w, 0.6);
    }
  }

  addMerged(group, steel, mats.get('steel'), 'traversal-steel');
  addMerged(group, ladder, ladderMaterial(mats), 'traversal-ladders');
  addMerged(group, stripes, hazardMaterial(mats), 'traversal-hazard');
  return layout.traversal.ladders.length;
}
