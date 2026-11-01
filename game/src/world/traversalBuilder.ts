// Iteration 05 (Lane T): geometry for vertical traversal, built from the layout's grid ramps and
// traversal connectors — stair flights (terrazzo treads and risers with safety nosings, sloped
// tiled side walls and ceilings following the flight, steel handrails), steel rescue ladders on the
// platform faces (stiles, rungs, stand-off brackets, a hazard marking on the platform edge above
// each), the track-structure beams over the underpass crossing, and striped barricades at the
// tunnel mouths that mark the end of the walkable track bed. Everything uses the existing material
// keys (world/materials.ts) or world-mapped surface sets; merged per material (few draw calls).
//
// Iteration 08 (Lane G): flights of every level (a flight carved into two level grids is built once);
// their side walls are part of the builder's union-of-open-columns wall faces (they follow whatever is
// beside the flight on any level), and wall handrails only run where that wall really exists.
//
// Task office-overhaul-20261030 (lane STRUCT): the office TRANSIT HALL's stopped escalators (layout.office.transit: their flights
// keep the ceiling that follows the pitch but get escalator steps instead of terrazzo treads — grooved aluminium treads and cleated
// risers, comb plates and stainless landing plates at both ends, skirt panels, stainless decking, glass balustrade panels, black
// handrails looping round the newel ends) and the fixed stair's handrails between them (collision: hidden railings in the layout);
// the caged steel ROOF ACCESS ladder (stiles running on above the hatch, safety cage) and the ROOF fixtures (layout.office.roof:
// parapet coping, the elevator overrun's cap / louvre / door / mast, the hatch curb and open lid, plinths, vents, drains, cable
// trays). All geometry, merged per material, tagged with its storeys for the level culler; no Meshy, no runtime light.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {CELL, FLOOR, SOLID, rampHeight, type Grid, type Ramp} from '../gen/grid';
import type {Level} from '../gen/levels';
import type {StationLayout} from '../gen/station';
import type {LevelColumns} from './levelGeometry';
import {SurfaceNodeMaterial, surfaceMaterial, thinTrim, type MatKey, type WorldMaterials} from './materials';
import {canvasTexture} from './canvasTextures';
import {flightRailRuns} from '../gen/doorways';
import {shapeMaterial} from './shapeMaterials';
import type {StairFlight, Ladder} from '../gen/traversal';
import type {OfficeTowerInfo} from '../gen/stationTypes';
import {mallEscalatorFlights} from './mallArch'; // Task track3-eaton-centre-20261031 (lane ARCH)
import {continuedEnds, endKey} from './trackExt/view'; // Track 2 (VIS): no barricade where a tunnel continues the bed

/** The builder's per-material quad accumulator. */
export interface QuadSink { quad(p: number[][], n: readonly number[], uv: number[][]): void }

interface V3 { x: number; y: number; z: number }

/** Handrail height above the pitch line (m) and its stand-off from the wall face. */
const RAIL_Y = 0.9, RAIL_OFF = 0.07;

const yellowSteel = new WeakMap<WorldMaterials, THREE.Material>();
const hazardMats = new WeakMap<WorldMaterials, SurfaceNodeMaterial>();

/** Safety-yellow painted steel (rescue ladders), world-mapped like the other steel keys. */
function ladderMaterial(mats: WorldMaterials): THREE.Material {
  let m = yellowSteel.get(mats);
  // Iteration 08 (primary): thin rungs/stiles sample without anisotropy (see materials.ts thinTrim).
  if (!m) { m = thinTrim(surfaceMaterial('brushedSteel', {color: 0xd6a020, metalness: 0.35}, {grime: [0.3, 0.6], macro: 0.15})); m.name = 'ladder-steel'; yellowSteel.set(mats, m); }
  return m;
}

/** Yellow/black hazard stripes (ladder edge markings, tunnel barricade planks); repeats along u. Track 2 (VIS): also the tunnel caps. */
export function hazardMaterial(mats: WorldMaterials): SurfaceNodeMaterial {
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
    m = new SurfaceNodeMaterial({map: tex, roughness: 0.8, metalness: 0.05}); // Iteration 13 (MAT-A): node material
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

/** Ramp headroom (m) from which a flight is an open well without a following ceiling (task track3-eaton-centre-20261031). */
export const OPEN_WELL_HEADROOM = 10;

/** Stair flight geometry for one grid ramp (`walls`: the union-aware wall lookup for handrails). */
function buildFlight(g: Grid, r: Ramp, layout: StationLayout, mats: WorldMaterials, acc: (k: MatKey) => QuadSink, steel: THREE.BufferGeometry[], walls: Grid, opts: {treads?: boolean; wallRails?: boolean} = {}): void {
  const area = layout.areas[g.area[g.idx(r.x, r.y)]];
  const pub = area?.publicSpace ?? true;
  const floorMat: MatKey = pub ? 'terrazzo' : 'concrete';
  const axisX = r.axis === 'x';
  const lo = (axisX ? r.x : r.y) * CELL, hi = lo + (axisX ? r.w : r.h) * CELL;
  const a0 = (axisX ? r.y : r.x) * CELL, a1 = a0 + (axisX ? r.h : r.w) * CELL;
  const H = (s: number) => rampHeight(r, s);
  const kinks = [...new Set([lo, hi, r.s0, r.s1].filter(s => s >= lo - 1e-6 && s <= hi + 1e-6).map(s => Math.round(s * 1e4) / 1e4))].sort((p, q) => p - q);
  // Ceiling following the flight (one quad per straight piece across the full width).
  const ceilMat: MatKey = pub ? 'ceiling' : 'ceilingService';
  // Task track3-eaton-centre-20261031 (lane GEN): an OPEN well (Ramp.headroom >= OPEN_WELL_HEADROOM: the mall's escalators / stairs,
  // capped by the cell ceiling, gen/levels.ts header) has no ceiling following the pitch. Every Subway / Office flight is < 3 m.
  if (r.headroom < OPEN_WELL_HEADROOM) for (let i = 0; i + 1 < kinks.length; i++) flatQuad(acc(ceilMat), mats.scale[ceilMat], axisX, kinks[i], kinks[i + 1], a0, a1, H(kinks[i]) + r.headroom, H(kinks[i + 1]) + r.headroom, false);
  // Task office-overhaul-20261030 (lane STRUCT): an escalator flight keeps only its ceiling (buildEscalators draws the rest).
  if (opts.treads === false) return;
  // Side walls: world/levelGeometry.ts wall faces (iteration 08).
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
  // Iteration 07 (Lane DW): only along solid side wall, stopping short of any opening in it
  // (gen/doorways.ts flightRailRuns), so a rail never crosses a doorway or an open join.
  for (const {side, s0: r0, s1: r1} of opts.wallRails === false ? [] : flightRailRuns(walls, r)) {
    const across = side < 0 ? a0 + RAIL_OFF : a1 - RAIL_OFF;
    const P = (s: number): V3 => (axisX ? {x: s, y: H(s) + RAIL_Y, z: across} : {x: across, y: H(s) + RAIL_Y, z: s});
    const ss = [r0, ...kinks.filter(k => k > r0 && k < r1), r1];
    for (let i = 0; i + 1 < ss.length; i++) beam(steel, P(ss[i]), P(ss[i + 1]), 0.045);
    for (let s = r0 + 0.25; s < r1 - 0.05; s += 1.2) {
      const p = P(s), off = side < 0 ? -0.04 : 0.04;
      const q = axisX ? {x: p.x, y: p.y - 0.06, z: p.z + off} : {x: p.x + off, y: p.y - 0.06, z: p.z};
      beam(steel, p, q, 0.025);
    }
  }
}

/**
 * Builds all traversal geometry into `group`. `acc(k, x, z, level)` is the builder's per-MatKey quad
 * accumulator for the chunk around (x, z) on a level (merged into the architecture meshes). Returns
 * the number of ladders built.
 */
export function buildTraversal(group: THREE.Group, layout: StationLayout, mats: WorldMaterials, acc: (k: MatKey, x: number, z: number, level: number) => QuadSink,
  ctx?: {levels: Level[]; cols: LevelColumns}): number {
  const levels = ctx?.levels ?? [{id: 0, role: 'main' as const, grid: layout.grid, baseY: 0}];
  const steel: THREE.BufferGeometry[] = [];
  const ladder: THREE.BufferGeometry[] = [];
  const stripes: THREE.BufferGeometry[] = [];
  const seen: Ramp[] = [];
  const same = (a: Ramp, b: Ramp) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.axis === b.axis && Math.abs(a.s0 - b.s0) < 1e-4 && Math.abs(a.h0 - b.h0) < 1e-4 && Math.abs(a.h1 - b.h1) < 1e-4;
  // Task office-overhaul-20261030 (lane STRUCT): transit hall flights (escalators: ceiling only; the fixed stair: no wall rails).
  const office = (layout as {office?: OfficeTowerInfo}).office;
  const escRamps = new Set<number>((office?.transit?.escalators ?? []).flatMap(e => e.flights.map(i => layout.traversal.stairs[i]?.ramp ?? -1)));
  // Task track3-eaton-centre-20261031 (lane ARCH): the mall's escalators (layout.mall.verticals) get the transit-hall escalator visuals.
  const mallEsc = mallEscalatorFlights(layout);
  const mallRamps = new Set<number>(mallEsc.map(e => e.flight.ramp));
  for (const rr of mallRamps) escRamps.add(rr);
  const transitRamps = new Set<number>(layout.traversal.stairs.filter(f => f.spec).map(f => f.ramp));
  for (const L of levels) {
    const g = L.grid;
    for (let ri = 0; ri < g.ramps.length; ri++) {
      const r = g.ramps[ri];
      // Level grids may share one ramps array: build from a grid the flight is actually carved into.
      if (g.rampIdx[g.idx(r.x, r.y)] !== ri) continue;
      if (seen.some(q => same(q, r))) continue;
      seen.push(r);
      const cx = (r.x + r.w / 2) * CELL, cz = (r.y + r.h / 2) * CELL;
      buildFlight(g, r, layout, mats, k => acc(k, cx, cz, L.id), steel, ctx ? unionWalls(r, ctx.cols) : g, {treads: !escRamps.has(ri), wallRails: !transitRamps.has(ri) && !mallRamps.has(ri)});
    }
  }

  // Rescue ladders: two stiles, rungs every 0.28 m, stand-off brackets; hazard marking on the edge above.
  for (const l of layout.traversal.ladders) {
    if (l.kind === 'roof') continue; // lane STRUCT: the caged roof access ladder (buildOfficeExtras)
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
  // Iteration 07 (Lane DW): set 0.12 m off the end wall so the planks lie inside the player's
  // collision radius (0.3 m) of that wall — the barricade really blocks (was 0.4 m: you could
  // step 0.16 m through the planks).
  const continued = continuedEnds(layout);
  for (const [ti, t] of layout.trenches.entries()) {
    for (const [x, end] of [[t.x0 + 0.12, 'x0'], [t.x1 - 0.12, 'x1']] as const) {
      if (continued.has(endKey(ti, end))) continue;
      const zc = (t.z0 + t.z1) / 2, w = t.z1 - t.z0 - 0.3;
      for (const zz of [t.z0 + 0.25, t.z1 - 0.25, zc]) box(steel, x, t.floorY + 0.65, zz, 0.08, 1.3, 0.08);
      for (const y of [0.55, 1.1]) box(stripes, x + (x < (t.x0 + t.x1) / 2 ? 0.06 : -0.06), t.floorY + y, zc, 0.03, 0.2, w, 0.6);
    }
  }

  addMerged(group, steel, mats.get('steel'), 'traversal-steel');
  addMerged(group, ladder, ladderMaterial(mats), 'traversal-ladders');
  addMerged(group, stripes, hazardMaterial(mats), 'traversal-hazard');
  if (office) buildOfficeExtras(group, layout, office, mats);
  if (mallEsc.length) buildMallEscalators(group, layout, mallEsc, mats); // task track3 (lane ARCH)
  return layout.traversal.ladders.length;
}

/**
 * A grid view for flightRailRuns: a side cell counts as wall (SOLID) only when no level is free there
 * at handrail height over the flight, so wall handrails never hang in front of an open side.
 */
function unionWalls(r: Ramp, cols: LevelColumns): Grid {
  const axisX = r.axis === 'x';
  return {
    get: (x: number, y: number) => {
      const s = ((axisX ? x : y) + 0.5) * CELL;
      return cols.freeAt(x, y, rampHeight(r, s) + RAIL_Y) ? FLOOR : SOLID;
    },
  } as unknown as Grid;
}

// ---------------------------------------------------------------------------------------------
// Task office-overhaul-20261030 (lane STRUCT): transit hall escalators + stair handrails, the roof access ladder, roof fixtures

/** Escalator balustrade width (m) each side of the step band (gen/office/transit.ts BALUSTRADE) and its newel overhangs. */
const ESC = {bal: 0.22, skirt: 0.28, deck: 0.34, glass: 0.95, rail: 0.985, loop: 0.4, newelTop: 0.1, newelBottom: 1.2};
const stepMats = new WeakMap<WorldMaterials, SurfaceNodeMaterial>();

/** Grooved aluminium escalator step (treads and cleated risers) with yellow demarcation at the sides and the nose. */
function escalatorStepMaterial(mats: WorldMaterials): SurfaceNodeMaterial {
  let m = stepMats.get(mats);
  if (!m) {
    const tex = canvasTexture(256, 256, 5077, (ctx, w, h, rnd) => {
      ctx.fillStyle = '#8f9396';
      ctx.fillRect(0, 0, w, h);
      // cleats / grooves running along the travel direction (v)
      for (let x = 0; x < w; x += 6) { ctx.fillStyle = '#4a4d50'; ctx.fillRect(x, 0, 2, h); ctx.fillStyle = '#b4b8bb'; ctx.fillRect(x + 3, 0, 1, h); }
      // yellow demarcation: both sides and the nose (v = 0)
      ctx.fillStyle = '#c99a1c';
      ctx.fillRect(0, 0, 14, h); ctx.fillRect(w - 14, 0, 14, h); ctx.fillRect(0, 0, w, 16);
      // grime / wear
      for (let i = 0; i < 420; i++) { ctx.fillStyle = `rgba(${rnd() < 0.6 ? '30,28,24' : '150,140,120'},${0.05 + rnd() * 0.18})`; ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 6, 1 + rnd() * 4); }
    });
    m = new SurfaceNodeMaterial({map: tex, roughness: 0.55, metalness: 0.55});
    m.name = 'escalator-steps';
    stepMats.set(mats, m);
  }
  return m;
}

/** Merged mesh of `list` tagged with its storeys (level culler: rendered while any of them is visible). */
function addTagged(group: THREE.Group, list: THREE.BufferGeometry[], mat: THREE.Material, name: string, levels: readonly number[]): void {
  if (!list.length) return;
  const merged = mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)), false);
  for (const g of list) g.dispose();
  if (!merged) return;
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  if (levels.length === 1) mesh.userData.level = levels[0]; else mesh.userData.levels = [...levels];
  group.add(mesh);
}

/** Quad geometry from 4 corners (counter-clockwise seen from the front) with UVs. */
function quadGeo(out: THREE.BufferGeometry[], p: V3[], uv: [number, number][]): void {
  const g = new THREE.BufferGeometry();
  const pos = [p[0], p[1], p[2], p[0], p[2], p[3]].flatMap(v => [v.x, v.y, v.z]);
  const u = [uv[0], uv[1], uv[2], uv[0], uv[2], uv[3]].flat();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  g.computeVertexNormals();
  out.push(g);
}

/** Both faces of a quad (glass panels). */
function quad2(out: THREE.BufferGeometry[], p: V3[], uv: [number, number][]): void {
  quadGeo(out, p, uv);
  quadGeo(out, [p[3], p[2], p[1], p[0]], [uv[3], uv[2], uv[1], uv[0]]);
}

function cyl(out: THREE.BufferGeometry[], x: number, y0: number, z: number, r: number, h: number, seg = 12): void {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y0 + h / 2, z);
  out.push(g);
}

interface OfficeLists { steel: THREE.BufferGeometry[]; stainless: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[]; black: THREE.BufferGeometry[]; steps: THREE.BufferGeometry[]; yellow: THREE.BufferGeometry[]; concrete: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[]; grille: THREE.BufferGeometry[] }
const lists = (): OfficeLists => ({steel: [], stainless: [], glass: [], black: [], steps: [], yellow: [], concrete: [], dark: [], grille: []});

function emitLists(group: THREE.Group, L: OfficeLists, mats: WorldMaterials, name: string, levels: readonly number[]): void {
  addTagged(group, L.steel, mats.get('steel'), `${name}-steel`, levels);
  addTagged(group, L.stainless, shapeMaterial(mats, 'kitchenSteel'), `${name}-stainless`, levels);
  addTagged(group, L.glass, shapeMaterial(mats, 'glassShopfront'), `${name}-glass`, levels);
  addTagged(group, L.black, shapeMaterial(mats, 'black'), `${name}-black`, levels);
  addTagged(group, L.steps, escalatorStepMaterial(mats), `${name}-steps`, levels);
  addTagged(group, L.yellow, ladderMaterial(mats), `${name}-yellow`, levels);
  addTagged(group, L.concrete, shapeMaterial(mats, 'concrete'), `${name}-concrete`, levels);
  addTagged(group, L.dark, shapeMaterial(mats, 'steelDark'), `${name}-dark`, levels);
  addTagged(group, L.grille, shapeMaterial(mats, 'grille'), `${name}-grille`, levels);
}

/** The office level's extra traversal geometry (transit hall, roof access ladder, roof fixtures). */
function buildOfficeExtras(group: THREE.Group, layout: StationLayout, office: OfficeTowerInfo, mats: WorldMaterials): void {
  const t = office.transit;
  if (t) {
    const L = lists();
    for (const e of t.escalators) {
      const q = layout.traversal.stairs[e.flights[0]];
      if (q) buildEscalator(L, layout.grid.ramps[q.ramp], q);
    }
    const st = t.stairLinks.map(id => layout.traversal.stairs[layout.levelLinks[id]?.traversalId ?? -1]).filter((f): f is StairFlight => !!f);
    for (const q of st) buildTransitStairRails(L, layout.grid.ramps[q.ramp], q, t.escalators.length > 0);
    emitLists(group, L, mats, 'transit', [0, 1]);
  }
  const lad = layout.traversal.ladders.find(l => l.kind === 'roof');
  if (lad) {
    const L = lists();
    buildRoofLadder(L, lad);
    emitLists(group, L, mats, 'roof-ladder', [lad.level ?? 0, lad.topLevel ?? 0]);
  }
  if (office.roof) {
    const L = lists();
    buildRoofFixtures(L, office);
    emitLists(group, L, mats, 'roof', [office.roof.level]);
  }
}

/**
 * Task track3-eaton-centre-20261031 (lane ARCH): the mall's stopped escalators, merged per storey pair (every bank between two rings
 * is one mesh per material: ~6 pairs x 5 materials instead of 5 draw calls per escalator) and tagged with those two storeys.
 */
function buildMallEscalators(group: THREE.Group, layout: StationLayout, flights: ReturnType<typeof mallEscalatorFlights>, mats: WorldMaterials): void {
  const pairs = new Map<string, {L: OfficeLists; lower: number; upper: number}>();
  for (const {flight, lower, upper} of flights) {
    const q = layout.traversal.stairs.find(f2 => f2.ramp === flight.ramp);
    const r = layout.grid.ramps[flight.ramp];
    if (!q || !r) continue;
    const key = `${lower}-${upper}`;
    let e = pairs.get(key);
    if (!e) pairs.set(key, (e = {L: lists(), lower, upper}));
    buildEscalator(e.L, r, q, true);
  }
  for (const [key, e] of pairs) emitLists(group, e.L, mats, `mall-escalators-${key}`, [e.lower, e.upper]);
}

/**
 * Newel-to-newel extent of the escalator over flight `r` along its axis: the top newel at the lane rect's start (the box mouth) +
 * ESC.newelTop, the bottom newel ESC.newelBottom beyond the flight's end (buildEscalator; the mall's balustrade trimming, task
 * mall-round3-20261031 lane FIX R1).
 */
export function escalatorExtent(r: Ramp): {sTop: number; sBot: number} {
  const axisX = r.axis === 'x';
  const dir = Math.sign(r.s1 - r.s0) || 1;
  const rectLo = (axisX ? r.x : r.y) * CELL;
  const lead = Math.abs(r.s0 - (dir > 0 ? rectLo : rectLo + (axisX ? r.w : r.h) * CELL));
  return {sTop: r.s0 - dir * Math.max(0.2, lead - ESC.newelTop), sBot: r.s1 + dir * ESC.newelBottom};
}

/** Height of the escalator's outer cladding above the pitch line (its top = the balustrade decking), for the mall's rail trimming. */
export const ESCALATOR_DECK = ESC.deck;

const UP = new THREE.Vector3(0, 1, 0);
/**
 * Box from a to b with its WIDTH `w` kept level (perpendicular to the run and to world up) and thickness `t` square to the run.
 * `beam` turns +Z onto the run with the shortest rotation, which rolls the cross-section on a pitched run along X (~30 deg on the
 * mall's escalators); task mall-round3-20261031 (lane FIX R1): the mall's escalators use this one.
 */
function beamLevel(out: THREE.BufferGeometry[], a: V3, b: V3, w: number, t: number): void {
  const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = d.length();
  if (len < 1e-4) return;
  d.divideScalar(len);
  const x = new THREE.Vector3().crossVectors(UP, d);
  if (x.lengthSq() < 1e-8) { beam(out, a, b, w, t); return; } // vertical: no level width direction
  x.normalize();
  const y = new THREE.Vector3().crossVectors(d, x);
  const g = new THREE.BoxGeometry(w, t, len);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, d).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
  out.push(g);
}

/**
 * One stopped escalator over its flight: steps between the comb plates, landing plates, skirts, decking, glass and handrails over
 * the whole newel-to-newel length (flat over the top landing, the pitch, flat into the lower hall). Built for runs along Z (the
 * transit hall's); beam cross-sections (width, thickness) assume the width stays horizontal, which holds for Z runs.
 * Task mall-round3-20261031 (lane FIX R1 — user: "z-fighting appears on escalators where they connect slopped walls under them"),
 * `mall` only (the Office transit hall is unchanged): the outer cladding starts AT the pitch line instead of 5 cm below it — the
 * level geometry's sloped wall under a flight ends exactly on the pitch line in the same plane (world/levelGeometry.ts: the
 * neighbour's band minus the flight's), so that 5 cm strip was two coplanar faces (stainless vs the wall finish) along the whole
 * run; and the beams keep their width level on the mall's X runs (beamLevel).
 */
function buildEscalator(L: OfficeLists, r: Ramp, q: StairFlight, mall = false): void {
  const axisX = r.axis === 'x';
  const H = (s: number) => rampHeight(r, s);
  const dir = Math.sign(r.s1 - r.s0) || 1;
  const {sTop, sBot} = escalatorExtent(r);
  const clad = mall ? 0 : 0.05;
  const bm = mall ? (out: THREE.BufferGeometry[], a: V3, b: V3, w: number, t = w) => beamLevel(out, a, b, w, t) : beam;
  const P = (s: number, a: number, y: number): V3 => (axisX ? {x: s, y, z: a} : {x: a, y, z: s});
  const a0 = q.a0, a1 = q.a1, b0 = a0 + ESC.bal, b1 = a1 - ESC.bal;
  const pieces: [number, number][] = [[sTop, r.s0], [r.s0, r.s1], [r.s1, sBot]];
  // Steps (treads + cleated risers) between the comb plates.
  const N = r.risers;
  const riserS = Array.from({length: N}, (_, k) => r.s0 + (r.s1 - r.s0) * (k + 0.5) / N);
  const tread = (k: number) => r.h0 + (r.h1 - r.h0) * k / N;
  const bounds = [r.s0, ...riserS, r.s1];
  const w = b1 - b0;
  for (let k = 0; k <= N; k++) {
    const sa = bounds[k], sb = bounds[k + 1], y = tread(k) + 0.004;
    if (Math.abs(sb - sa) < 1e-4) continue;
    const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
    // upward-facing tread: corners (x0, z0) (x0, z1) (x1, z1) (x1, z0); u across the band, v along the tread (0 = the nose)
    const [x0, z0, x1, z1] = axisX ? [lo, b0, hi, b1] : [b0, lo, b1, hi];
    const v = (hi - lo) / 0.4;
    quadGeo(L.steps, [{x: x0, y, z: z0}, {x: x0, y, z: z1}, {x: x1, y, z: z1}, {x: x1, y, z: z0}],
      axisX ? [[0, 0], [1, 0], [1, v], [0, v]] : [[0, 0], [0, v], [1, v], [1, 0]]);
  }
  for (let k = 0; k < N; k++) {
    const s = riserS[k], yA = tread(k) + 0.004, yB = tread(k + 1) + 0.004;
    const y0 = Math.min(yA, yB), y1 = Math.max(yA, yB);
    // cleated riser (both faces: only the downhill one is ever seen)
    quad2(L.steps, [P(s, b0, y0), P(s, b1, y0), P(s, b1, y1), P(s, b0, y1)], [[0, 0.5], [1, 0.5], [1, 0.9], [0, 0.9]]);
  }
  // Comb plates (yellow) at both flight ends, stainless landing plates beyond them.
  for (const [s, y] of [[r.s0, r.h0], [r.s1, r.h1]] as const) {
    const out = s === r.s0 ? -dir : dir;
    bm(L.yellow, P(s, (b0 + b1) / 2, y + 0.012), P(s + out * 0.16, (b0 + b1) / 2, y + 0.012), w, 0.024);
  }
  const plate = (sa: number, sb: number, y: number) => box(L.stainless, ...((): [number, number, number, number, number, number] => {
    const sc = (sa + sb) / 2, len = Math.abs(sb - sa);
    return axisX ? [sc, y + 0.006, (b0 + b1) / 2, len, 0.012, w] : [(b0 + b1) / 2, y + 0.006, sc, w, 0.012, len];
  })());
  plate(r.s0 - dir * 0.16, sTop, r.h0);
  plate(r.s1 + dir * 0.16, sBot, r.h1);
  // Skirts (inside the step band), decking, outer cladding, glass panels, handrails — along the three pieces of the profile.
  for (const [pa, pb] of pieces) {
    if (Math.abs(pb - pa) < 1e-3) continue;
    const ya = H(pa), yb = H(pb);
    for (const [aIn, aOut, aMid] of [[b0, a0, a0 + ESC.bal / 2], [b1, a1, a1 - ESC.bal / 2]] as const) {
      // skirt: a vertical stainless panel on the step band's edge
      quadGeo(L.stainless, [P(pa, aIn, ya - 0.02), P(pb, aIn, yb - 0.02), P(pb, aIn, yb + ESC.skirt), P(pa, aIn, ya + ESC.skirt)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      quadGeo(L.stainless, [P(pb, aIn, yb - 0.02), P(pa, aIn, ya - 0.02), P(pa, aIn, ya + ESC.skirt), P(pb, aIn, yb + ESC.skirt)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      // decking: a stainless strip over the balustrade base
      const across = Math.abs(aOut - aIn);
      bm(L.stainless, P(pa, (aIn + aOut) / 2, ya + ESC.deck - 0.02), P(pb, (aIn + aOut) / 2, yb + ESC.deck - 0.02), across, 0.05);
      // outer cladding: the balustrade's side toward the wall / the stair, floor to decking
      quadGeo(L.stainless, [P(pa, aOut, ya - clad), P(pb, aOut, yb - clad), P(pb, aOut, yb + ESC.deck), P(pa, aOut, ya + ESC.deck)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      quadGeo(L.stainless, [P(pb, aOut, yb - clad), P(pa, aOut, ya - clad), P(pa, aOut, ya + ESC.deck), P(pb, aOut, yb + ESC.deck)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      // glass balustrade panel (both faces) and the black handrail on top of it
      quad2(L.glass, [P(pa, aMid, ya + ESC.deck), P(pb, aMid, yb + ESC.deck), P(pb, aMid, yb + ESC.glass), P(pa, aMid, ya + ESC.glass)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      bm(L.black, P(pa, aMid, ya + ESC.rail), P(pb, aMid, yb + ESC.rail), 0.08, 0.035);
      bm(L.stainless, P(pa, aMid, ya + ESC.glass), P(pb, aMid, yb + ESC.glass), 0.03, 0.02);
    }
  }
  // Handrail loops round both newel ends (a vertical half circle bulging out beyond the end).
  for (const [s, outDir] of [[sTop, -dir], [sBot, dir]] as const) {
    const y = H(s) + ESC.rail - ESC.loop;
    for (const aMid of [a0 + ESC.bal / 2, a1 - ESC.bal / 2]) {
      let prev: V3 | null = null;
      for (let i = 0; i <= 8; i++) {
        const th = Math.PI / 2 - Math.PI * i / 8;
        const p = P(s + outDir * ESC.loop * Math.cos(th), aMid, y + ESC.loop * Math.sin(th));
        if (prev) bm(L.black, prev, p, 0.08, 0.035);
        prev = p;
      }
      // the newel's glass end panel below the loop
      quad2(L.glass, [P(s, aMid - 0.001, H(s) + ESC.deck), P(s + outDir * 0.3, aMid - 0.001, H(s) + ESC.deck), P(s + outDir * 0.3, aMid - 0.001, y + 0.1), P(s, aMid - 0.001, y + 0.1)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      box(L.stainless, ...((): [number, number, number, number, number, number] => {
        const sc = s + outDir * 0.2;
        return axisX ? [sc, H(s) + ESC.deck / 2, aMid, 0.4, ESC.deck, ESC.bal] : [aMid, H(s) + ESC.deck / 2, sc, ESC.bal, ESC.deck, 0.4];
      })());
    }
  }
}

/** Stainless handrails of the fixed transit stair: along both balustrades on the stair side and a centre rail on posts. */
function buildTransitStairRails(L: OfficeLists, r: Ramp, q: StairFlight, balustrades: boolean): void {
  const axisX = r.axis === 'x';
  const H = (s: number) => rampHeight(r, s);
  const dir = Math.sign(r.s1 - r.s0) || 1;
  const P = (s: number, a: number, y: number): V3 => (axisX ? {x: s, y, z: a} : {x: a, y, z: s});
  const sa = r.s0 - dir * 0.3, sb = r.s1 + dir * 0.3;
  const ss = [sa, r.s0, r.s1, sb];
  const run = (a: number, posts: boolean, side: number) => {
    for (let i = 0; i + 1 < ss.length; i++) beam(L.stainless, P(ss[i], a, H(ss[i]) + 0.9), P(ss[i + 1], a, H(ss[i + 1]) + 0.9), 0.045);
    const len = Math.abs(sb - sa);
    for (let d = 0.2; d < len - 0.1; d += posts ? 1.5 : 1.2) {
      const s = sa + dir * d, y = H(s);
      if (posts) beam(L.stainless, P(s, a, y), P(s, a, y + 0.9), 0.045);
      else beam(L.stainless, P(s, a, y + 0.9), P(s, a + side * 0.07, y + 0.82), 0.025);
    }
  };
  if (balustrades) { run(q.a0 + 0.06, false, -1); run(q.a1 - 0.06, false, 1); }
  run((q.a0 + q.a1) / 2, true, 0);
}

/** The caged galvanised roof access ladder: stiles running 1.1 m above the deck (grab rails), rungs, brackets, the safety cage. */
function buildRoofLadder(L: OfficeLists, l: Ladder): void {
  const z = l.faceZ - l.dir * 0.075, y0 = l.bottomY + 0.02, yTop = l.topY + 1.1;
  for (const sx of [-0.21, 0.21]) {
    box(L.steel, l.x + sx, (y0 + yTop) / 2, z, 0.06, yTop - y0, 0.024);
    for (let by = y0 + 0.3; by < l.topY - 0.2; by += 1.2) box(L.steel, l.x + sx, by, l.faceZ - l.dir * 0.035, 0.04, 0.04, 0.07);
  }
  for (let y = l.bottomY + 0.28; y < l.topY + 0.05; y += 0.28) box(L.steel, l.x, y, z, 0.42, 0.03, 0.03);
  // Cage: hoops round the climbing space from 2.3 m up into the hatch, three vertical straps.
  const zc = l.faceZ - l.dir * (0.075 + 0.35), R = 0.36;
  const hoops: number[] = [];
  for (let y = l.bottomY + 2.3; y < l.topY - 0.15; y += 0.8) hoops.push(y);
  for (const y of hoops) {
    let prev: V3 | null = null;
    for (let i = 0; i <= 10; i++) {
      const th = Math.PI * i / 10;
      const p = {x: l.x + R * Math.cos(th), y, z: zc - l.dir * R * Math.sin(th)};
      if (prev) beam(L.steel, prev, p, 0.03, 0.05);
      prev = p;
    }
    for (const sx of [-1, 1]) beam(L.steel, {x: l.x + sx * R, y, z: zc}, {x: l.x + sx * 0.21, y, z}, 0.03, 0.05);
  }
  if (hoops.length > 1) for (const th of [Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]) {
    const x = l.x + R * Math.cos(th), zz = zc - l.dir * R * Math.sin(th);
    beam(L.steel, {x, y: hoops[0], z: zz}, {x, y: hoops[hoops.length - 1], z: zz}, 0.04, 0.012);
  }
  // Hazard marking on the deck beyond the step-off edge.
  box(L.yellow, l.x, l.topY + 0.004, l.faceZ + l.dir * 0.3, 0.9, 0.006, 0.4);
}

/** Roof fixtures: parapet coping, the overrun cap and its fittings, the hatch curb + lid, plinths, vents, drains, cable trays. */
function buildRoofFixtures(L: OfficeLists, office: OfficeTowerInfo): void {
  const roof = office.roof!, ext = office.exterior, base = roof.baseY, top = base + roof.parapet;
  // Parapet coping over the wall ring (slight overhang both sides).
  const c = 0.04, ring = CELL;
  const cap = (x0: number, z0: number, x1: number, z1: number) => box(L.concrete, (x0 + x1) / 2, top - 0.01, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0);
  cap(ext.x0 - c, ext.z0 - c, ext.x1 + c, ext.z0 + ring + c);
  cap(ext.x0 - c, ext.z1 - ring - c, ext.x1 + c, ext.z1 + c);
  cap(ext.x0 - c, ext.z0 + ring + c, ext.x0 + ring + c, ext.z1 - ring - c);
  cap(ext.x1 - ring - c, ext.z0 + ring + c, ext.x1 + c, ext.z1 - ring - c);
  for (const st of roof.structures as (typeof roof.structures[number] & {w?: number; d?: number; h?: number; len?: number; y?: number})[]) {
    const y = st.y ?? base;
    switch (st.kind) {
      case 'plinth': box(L.concrete, st.x, y + (st.h ?? 0.2) / 2, st.z, st.w ?? 1, st.h ?? 0.2, st.d ?? 1); break;
      case 'overrun': {
        const w = st.w ?? 3, d = st.d ?? 3, h = st.h ?? 2.8;
        box(L.concrete, st.x, y + h + 0.03, st.z, w + 0.1, 0.12, d + 0.1);
        box(L.grille, st.x, y + h * 0.62, st.z - d / 2 - 0.025, Math.min(1.4, w * 0.45), 0.8, 0.05); // louvre (north wall)
        box(L.dark, st.x - w / 2 - 0.02, y + 1.0, st.z, 0.04, 2.0, Math.min(0.95, d * 0.4)); // access door (west wall)
        box(L.dark, st.x + w * 0.2, y + h + 0.35, st.z + d * 0.15, 0.8, 0.5, 0.8); // exhaust fan housing
        cyl(L.steel, st.x - w * 0.3, y + h + 0.09, st.z - d * 0.3, 0.04, 3.4, 8); // mast
        box(L.steel, st.x - w * 0.3, y + h + 2.9, st.z - d * 0.3, 0.6, 0.03, 0.03);
        box(L.steel, st.x - w * 0.3, y + h + 3.3, st.z - d * 0.3, 0.03, 0.03, 0.5);
        break;
      }
      case 'hatch': {
        const w = st.w ?? 1, d = st.d ?? 1, x0 = st.x - w / 2, x1 = st.x + w / 2, z0 = st.z - d / 2, z1 = st.z + d / 2, ch = 0.35, t = 0.1;
        box(L.dark, st.x, y + ch / 2, z0 - t / 2, w + 2 * t, ch, t);
        box(L.dark, st.x, y + ch / 2, z1 + t / 2, w + 2 * t, ch, t);
        box(L.dark, x0 - t / 2, y + ch / 2, st.z, t, ch, d);
        box(L.dark, x1 + t / 2, y + ch / 2, st.z, t, ch, d);
        // the lid, hinged on the far edge and standing open
        box(L.grille, st.x, y + ch + d / 2, z1 + 0.05, w + 0.08, d, 0.05);
        beam(L.steel, {x: x1 - 0.06, y: y + ch, z: z1 - 0.02}, {x: x1 - 0.06, y: y + ch + d * 0.6, z: z1 + 0.04}, 0.025);
        break;
      }
      case 'mushroomVent':
        cyl(L.steel, st.x, y, st.z, 0.09, 0.32);
        cyl(L.steel, st.x, y + 0.3, st.z, 0.25, 0.16);
        cyl(L.dark, st.x, y, st.z, 0.16, 0.05);
        break;
      case 'ventStack':
        cyl(L.dark, st.x, y, st.z, 0.07, st.h ?? 1.1, 10);
        cyl(L.steel, st.x, y + (st.h ?? 1.1) - 0.04, st.z, 0.1, 0.08, 10);
        cyl(L.dark, st.x, y, st.z, 0.13, 0.06, 10);
        break;
      case 'drain': box(L.black, st.x, y + 0.004, st.z, 0.36, 0.008, 0.36); break;
      case 'cableTray': {
        const len = st.len ?? 4, alongX = Math.abs(Math.sin(st.yaw)) < 0.5;
        const x0 = st.x, z0 = st.z, x1 = alongX ? st.x + len : st.x, z1 = alongX ? st.z : st.z + len, ty = st.y ?? base + 0.32;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, lx = alongX ? len : 0.3, lz = alongX ? 0.3 : len;
        box(L.steel, mx, ty, mz, lx, 0.012, lz);
        for (const o of [-0.14, 0.14]) box(L.steel, alongX ? mx : mx + o, ty + 0.04, alongX ? mz + o : mz, alongX ? len : 0.012, 0.08, alongX ? 0.012 : len);
        for (let d = 0.3; d < len - 0.1; d += 1.5) box(L.steel, alongX ? x0 + d : x0, (base + ty) / 2, alongX ? z0 : z0 + d, 0.04, ty - base, 0.04);
        // a few cables lying in it
        for (const o of [-0.06, 0, 0.07]) box(L.black, alongX ? mx : mx + o, ty + 0.025, alongX ? mz + o : mz, alongX ? len - 0.05 : 0.03, 0.03, alongX ? 0.03 : len - 0.05);
        break;
      }
    }
  }
}
