// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's OUTDOOR DRESSING — the deliberate ruin and the street
// furniture of a district, after the interiors (doorway fronts are known and kept clear) and the checkpoint.
//
//  - BLOCKED SPANS: 3-5 ordinary street segments are cut for vehicles by a rubble PILE-UP (a raised debris mound across the carriageway
//    and both sidewalks, wrecks piled against it) that leaves a 1 m FOOT GAP along each building line. A span is only cut when the road
//    graph (junctions / segments) stays connected without it, never beside the portal / depot blocks or on an avenue / the perimeter road,
//    and only where both sidewalks end at a building wall (no bypass through a lot).
//  - RUIN: collapsed buildings spill debris over the sidewalk / road / lot beside them; some damaged / gutted shells lose a CORNER (LOOK
//    draws the broken corner from SurfaceBuilding.collapse) with a spill below it.
//  - An ABANDONED ROADBLOCK on an avenue (a barrier line with a 6 m gap, an army truck, sandbags, cones) and a BUS wreck at a kerb.
//  - Wrecks: parked along kerbs (traffic side, quarter-turn yaws), a few abandoned in junction corners, rows in parking lots.
//  - Furniture: street lamps / hydrants / signals / street-name signs (lane KIT kinds) and the existing benches, bins, news boxes, payphones,
//    bicycles, shopping carts, trash piles and wheelie bins (p7 kinds), all in the sidewalks' kerb zone / lots / service lanes.
//
// Mounds are street-level FLOOR cells raised above their ground (edge +0.6 m, crown +1.0 m: more than a step for feet, far more than the
// vehicle controller's floor tolerance), listed in SurfaceInfo.rubble for LOOK. Every draw is from forks of the district seed.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import type {Kit} from '../stationKit';
import type {Side} from '../stationTypes';
import type {SRect, SurfaceRubble} from './surfaceTypes';
import {crH, crW, type CR, type CityFrame, type FrameBlock, type FrameSegment} from './cityFrame';
import {KERB, type BlockPlans, type BuildingPlan} from './cityBlocks';
import {G, sidewalkStrips, type GroundMap} from './cityCarve';
import {FACE_ROT, OutdoorProps, SR_CAR_WRECKS, halfExtents, streetSignVariant, type PlannedProp} from './outdoorKinds';
import {sideCells} from './cityInteriors';

/** Mound heights above the ground they cover (m). */
export const MOUND = {edge: 0.6, crown: 1.0} as const;
/**
 * Dressing budget (a whole district; follow-up 1, the draw-call budget). Every wreck kind draws one instanced mesh per model part per
 * 18 m cohort, every drawn kit kind one per material per 64 m cohort (world/surface/kit.ts, world/builder.ts addInstancedModel), so the
 * counts stay where they read: wrecks dense where deliberate (pile-ups, the roadblock, the bus, junction corners, a few parked ROWS,
 * parking-lot stalls) and at most `wrecks` in all; lamps one row per lit street (avenues and the core's streets), 30-40 m apart.
 */
export const DRESS_CAP = {wrecks: 90, parkedRows: 12, parked: 36, lots: 24, junction: 8, lampGap: [30, 40] as const} as const;
const isWreck = (k: string) => k.startsWith('srWreck');

export interface Collapse { corner: 'NW' | 'NE' | 'SW' | 'SE'; w: number; d: number }

export interface DressOut {
  /** Blocked spans: segment id -> the mound rects (m). */
  blocked: Map<number, SRect[]>;
  rubble: SurfaceRubble[];
  roadblock: {segment: number; rect: SRect} | null;
  bus: {segment: number; x: number; z: number} | null;
  /** Building id -> its collapsed corner (cells). */
  collapse: Map<number, Collapse>;
  counts: Record<string, number>;
}

export interface DressCtx {
  kit: Kit;
  f: CityFrame;
  gm: GroundMap;
  plans: BlockPlans;
  op: OutdoorProps;
  rng: Rng;
  /** The checkpoint's no-clutter box (m) and street ids per segment (SurfaceStreet ids). */
  safe: SRect;
  streetOfSegment: number[];
}

const toM = (r: CR): SRect => ({x0: r.x0 * CELL, z0: r.y0 * CELL, x1: r.x1 * CELL, z1: r.y1 * CELL});
const rectsTouch = (a: CR, b: CR, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
const inSafe = (s: SRect, r: CR) => r.x0 * CELL < s.x1 && s.x0 < r.x1 * CELL && r.y0 * CELL < s.z1 && s.z0 < r.y1 * CELL;
const SIDES: readonly Side[] = ['N', 'S', 'W', 'E'];
const OPP: Record<Side, Side> = {N: 'S', S: 'N', W: 'E', E: 'W'};

/** Raises the given cells into a mound (edge ring / crown, above each cell's own ground) and takes them. */
function raise(kit: Kit, op: OutdoorProps, r: CR, ok: (i: number) => boolean): number {
  const g = kit.g;
  let n = 0;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const i = g.idx(x, y);
    if (!ok(i)) continue;
    const ring = x === r.x0 || y === r.y0 || x === r.x1 - 1 || y === r.y1 - 1;
    g.floor[i] = Math.round((g.floor[i] + (ring ? MOUND.edge : MOUND.crown)) * 1000) / 1000;
    op.taken[i] = 1;
    n++;
  }
  return n;
}

/** Is cell i open street-level outdoor ground nobody has claimed (no doorway front, driveway, prop, mound)? */
function freeGround(c: DressCtx, i: number): boolean {
  const g = c.kit.g;
  return g.cells[i] === FLOOR && c.op.outdoor.has(g.area[i]) && !c.op.taken[i] && !c.op.reserve[i] && g.rampIdx[i] < 0 && g.floor[i] < KERB + 0.01;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Blocked spans

/** Is the road graph (merged junction groups, segments not in `cut`) connected? */
export function roadGraphConnected(f: CityFrame, gm: GroundMap, cut: ReadonlySet<number>): boolean {
  const N = gm.groupRect.length;
  const adj: number[][] = Array.from({length: N}, () => []);
  for (const s of f.segments) {
    if (cut.has(s.id)) continue;
    const a = gm.junctionGroup[s.a], b = gm.junctionGroup[s.b];
    if (a !== b) { adj[a].push(b); adj[b].push(a); }
  }
  const seen = new Uint8Array(N);
  const q = [0];
  seen[0] = 1;
  let n = 1;
  while (q.length) for (const o of adj[q.pop()!]) if (!seen[o]) { seen[o] = 1; n++; q.push(o); }
  return n === N;
}

interface Span { mound: CR; gaps: CR[] }

/** The pile-up band of a segment (cells), or null when no position has building walls behind both sidewalks. */
function findSpan(c: DressCtx, s: FrameSegment, rng: Rng): Span | null {
  const g = c.kit.g, cls = c.gm.cls;
  const runZ = s.run === 'z';
  const L = runZ ? crH(s.r) : crW(s.r), start = runZ ? s.r.y0 : s.r.x0;
  const Lb = rng.int(8, 12);
  const at = (along: number, across: number) => (runZ ? g.idx(across, along) : g.idx(along, across));
  const isWalk = (i: number) => cls[i] === G.sidewalk || cls[i] === G.driveway;
  // across extent of the sidewalks at one along-coordinate: [lo, hi) with SOLID walls just outside, or null
  const across = (a: number): [number, number] | null => {
    let lo = runZ ? s.r.x0 : s.r.y0, hi = runZ ? s.r.x1 : s.r.y1;
    while (lo > 0 && isWalk(at(a, lo - 1))) lo--;
    while (hi < (runZ ? g.w : g.h) - 1 && isWalk(at(a, hi))) hi++;
    if (lo === (runZ ? s.r.x0 : s.r.y0) || hi === (runZ ? s.r.x1 : s.r.y1)) return null; // no sidewalk on a side
    if (g.cells[at(a, lo - 1)] === FLOOR || g.cells[at(a, hi)] === FLOOR) return null; // a lot / gangway behind the sidewalk
    return [lo, hi];
  };
  for (let tries = 0; tries < 10; tries++) {
    const t0 = start + Math.floor(L * rng.range(0.25, 0.75)) - (Lb >> 1);
    if (t0 < start + 6 || t0 + Lb > start + L - 6) continue;
    let ext: [number, number] | null = null, bad = false;
    for (let a = t0 - 3; a < t0 + Lb + 3 && !bad; a++) {
      const e = across(a);
      if (!e || (ext && (e[0] !== ext[0] || e[1] !== ext[1]))) bad = true;
      else ext = e;
    }
    if (bad || !ext) continue;
    const [lo, hi] = ext;
    if (hi - lo - 4 < 12) continue;
    const mk = (a0: number, a1: number, b0: number, b1: number): CR => (runZ ? {x0: b0, x1: b1, y0: a0, y1: a1} : {x0: a0, x1: a1, y0: b0, y1: b1});
    const mound = mk(t0, t0 + Lb, lo + 2, hi - 2);
    const gaps = [mk(t0 - 1, t0 + Lb + 1, lo, lo + 2), mk(t0 - 1, t0 + Lb + 1, hi - 2, hi)];
    if (c.op.busy(mound.x0, mound.y0, mound.x1, mound.y1) || gaps.some(q => c.op.busy(q.x0, q.y0, q.x1, q.y1))) continue;
    let open = true;
    for (let y = mound.y0; y < mound.y1 && open; y++) for (let x = mound.x0; x < mound.x1; x++) if (!freeGround(c, g.idx(x, y))) { open = false; break; }
    if (!open) continue;
    return {mound, gaps};
  }
  return null;
}

function blockedSpans(c: DressCtx, out: DressOut): void {
  const rng = c.rng.fork('blocked-spans');
  const {f, plans} = c;
  const P = f.blocks[plans.portal], D = f.blocks[plans.depot];
  const cand = f.segments.filter(s => s.line.rank === 'street' && !s.line.perimeter && (s.run === 'z' ? crH(s.r) : crW(s.r)) >= 60
    && !rectsTouch(s.r, P.kerb, 2) && !rectsTouch(s.r, D.kerb, 2) && !inSafe(c.safe, s.r) && !c.gm.rail.some(r => rectsTouch(r, s.r)));
  rng.shuffle(cand);
  const target = rng.int(3, 5);
  const cut = new Set<number>();
  for (const s of cand) {
    if (cut.size >= target) break;
    const next = new Set(cut).add(s.id);
    if (!roadGraphConnected(f, c.gm, next)) continue;
    const span = findSpan(c, s, rng);
    if (!span) continue;
    cut.add(s.id);
    const g = c.kit.g;
    raise(c.kit, c.op, span.mound, i => g.cells[i] === FLOOR);
    for (const q of span.gaps) c.op.reserveRect(q.x0, q.y0, q.x1, q.y1);
    const m = toM(span.mound);
    out.blocked.set(s.id, [m]);
    out.rubble.push({...m, edge: MOUND.edge, crown: MOUND.crown, kind: 'pile-up', street: c.streetOfSegment[s.id]});
    // wrecks piled against the mound on the carriageway (pending until lane KIT's kinds land)
    const runZ = s.run === 'z';
    for (const end of [0, 1] as const) {
      const n = rng.int(1, 2);
      for (let k = 0; k < n; k++) {
        const kind = rng.chance(0.15) ? 'srWreckArmyTruck' : rng.pick(SR_CAR_WRECKS);
        const rot = (runZ ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0);
        const e = halfExtents(kind, rot)!;
        const a0 = (runZ ? span.mound.y0 : span.mound.x0) * CELL, a1 = (runZ ? span.mound.y1 : span.mound.x1) * CELL;
        const along = end === 0 ? a0 - (runZ ? e.hz : e.hx) - 0.1 - k * 0.2 : a1 + (runZ ? e.hz : e.hx) + 0.1 + k * 0.2;
        const lo = (runZ ? s.r.x0 : s.r.y0) * CELL + (runZ ? e.hx : e.hz) + 0.3, hi = (runZ ? s.r.x1 : s.r.y1) * CELL - (runZ ? e.hx : e.hz) - 0.3;
        if (hi <= lo) continue;
        for (let t = 0; t < 4; t++) {
          const acr = rng.range(lo, hi);
          if (c.op.place(kind, runZ ? acr : along, runZ ? along : acr, rot, {role: 'blocked'})) break;
        }
      }
    }
  }
  out.counts.blocked = cut.size;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Ruin: spills beside collapsed buildings, collapsed corners of damaged shells

function spills(c: DressCtx, out: DressOut): void {
  const rng = c.rng.fork('ruin');
  const g = c.kit.g, cls = c.gm.cls;
  const spillOk = (i: number) => freeGround(c, i) && (cls[i] === G.sidewalk || cls[i] === G.road || (cls[i] === G.lot && (() => {
    const l = c.gm.lotOfArea.get(g.area[i]);
    return !!l && (l.use === 'rubble' || l.use === 'vacant');
  })()));
  const spill = (b: BuildingPlan, s: Side, a0: number, a1: number, depth: number, kind: SurfaceRubble['kind']): boolean => {
    const r = b.r;
    const rect: CR = s === 'N' ? {x0: a0, x1: a1, y0: r.y0 - depth, y1: r.y0} : s === 'S' ? {x0: a0, x1: a1, y0: r.y1, y1: r.y1 + depth}
      : s === 'W' ? {x0: r.x0 - depth, x1: r.x0, y0: a0, y1: a1} : {x0: r.x1, x1: r.x1 + depth, y0: a0, y1: a1};
    if (inSafe(c.safe, rect)) return false;
    let n = 0;
    for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) if (g.inBounds(x, y) && spillOk(g.idx(x, y))) n++;
    if (n < Math.max(6, (crW(rect) * crH(rect)) * 0.6)) return false;
    raise(c.kit, c.op, rect, i => spillOk(i));
    out.rubble.push({...toM(rect), edge: MOUND.edge, crown: MOUND.crown, kind, building: b.id});
    return true;
  };
  let nSpill = 0, nCorner = 0;
  for (const b of c.plans.buildings) {
    if (b.host) continue;
    if (b.condition === 'collapsed') {
      for (const s of SIDES) {
        if (!rng.chance(0.55)) continue;
        const cells = sideCells(b.r, s);
        if (cells.length < 8) continue;
        const len = rng.int(8, Math.min(26, cells.length));
        const k0 = rng.int(0, cells.length - len);
        const a0 = s === 'N' || s === 'S' ? cells[k0].x : cells[k0].y;
        if (spill(b, s, a0, a0 + len, rng.int(4, 9), 'spill')) nSpill++;
      }
      continue;
    }
    // a damaged / gutted closed shell loses a corner now and then (exposed on at least one of its two sides)
    if (b.destination || b.walk > 0 || (b.condition !== 'damaged' && b.condition !== 'gutted') || !rng.chance(0.3)) continue;
    const corner = rng.pick(['NW', 'NE', 'SW', 'SE'] as const);
    const sn: Side = corner[0] as Side, sw: Side = corner[1] as Side;
    const w = Math.max(6, Math.round(crW(b.r) * rng.range(0.25, 0.45))), d = Math.max(6, Math.round(crH(b.r) * rng.range(0.25, 0.45)));
    const ax0 = sw === 'W' ? b.r.x0 + 1 : b.r.x1 - 1 - w, ay0 = sn === 'N' ? b.r.y0 + 1 : b.r.y1 - 1 - d;
    const okA = spill(b, sn, ax0, ax0 + w, rng.int(3, 7), 'corner');
    const okB = spill(b, sw, ay0, ay0 + d, rng.int(3, 7), 'corner');
    if (okA || okB) { out.collapse.set(b.id, {corner, w, d}); nCorner++; }
  }
  out.counts.spills = nSpill;
  out.counts.corners = nCorner;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Roadblock, bus

function roadblockAndBus(c: DressCtx, out: DressOut): void {
  const rng = c.rng.fork('roadblock');
  const sc = {x: (c.safe.x0 + c.safe.x1) / 2, z: (c.safe.z0 + c.safe.z1) / 2};
  const avs = c.f.segments.filter(s => s.line.rank === 'avenue' && (s.run === 'z' ? crH(s.r) : crW(s.r)) >= 80 && !inSafe(c.safe, s.r) && !out.blocked.has(s.id));
  const far = avs.filter(s => Math.hypot((s.r.x0 + s.r.x1) / 2 * CELL - sc.x, (s.r.y0 + s.r.y1) / 2 * CELL - sc.z) > 110);
  const rb = far.length ? rng.pick(far) : null;
  if (rb) {
    const runZ = rb.run === 'z';
    const A0 = runZ ? rb.r.y0 : rb.r.x0, A1 = runZ ? rb.r.y1 : rb.r.x1, B0 = (runZ ? rb.r.x0 : rb.r.y0) * CELL, B1 = (runZ ? rb.r.x1 : rb.r.y1) * CELL;
    const a = (A0 + Math.floor((A1 - A0) * rng.range(0.35, 0.65))) * CELL;
    const gapC = rng.range(B0 + 4.5, B1 - 4.5), gap = 6;
    const P = (along: number, acr: number) => (runZ ? {x: acr, z: along} : {x: along, z: acr});
    const rot = runZ ? 0 : Math.PI / 2; // a barrier's long axis across the carriageway
    let n = 0;
    for (let b = B0 + 0.3; b + 2.0 <= B1 - 0.2;) {
      const cc = b + 1.0;
      if (cc + 1.0 > gapC - gap / 2 && cc - 1.0 < gapC + gap / 2) { b = gapC + gap / 2; continue; }
      const p = P(a, cc);
      if (c.op.place('srJerseyBarrier', p.x, p.z, rot, {role: 'roadblock'})) n++;
      b += 2.05;
    }
    for (const side of [0, 1]) {
      const p = P(a + (side ? 1.1 : -1.1), side ? B1 - 1.2 : B0 + 1.2);
      c.op.place('srSandbagWall', p.x, p.z, rot + Math.PI / 2, {role: 'roadblock'});
    }
    for (let k = 0; k < 3; k++) { const p = P(a - 3 - k * 2.2, gapC + (k - 1) * 1.6); c.op.place('srTrafficCone', p.x, p.z, 0, {role: 'roadblock'}); }
    const truckRot = (runZ ? -Math.PI / 2 : 0) + (rng.chance(0.5) ? Math.PI : 0);
    const te = halfExtents('srWreckArmyTruck', truckRot)!;
    const tp = P(a + 6 + (runZ ? te.hz : te.hx), rng.chance(0.5) ? B0 + 0.3 + (runZ ? te.hx : te.hz) : B1 - 0.3 - (runZ ? te.hx : te.hz));
    c.op.place('srWreckArmyTruck', tp.x, tp.z, truckRot, {role: 'roadblock'});
    const r0 = P(a - 1.5, B0), r1 = P(a + 1.5, B1);
    out.roadblock = {segment: rb.id, rect: {x0: Math.min(r0.x, r1.x), z0: Math.min(r0.z, r1.z), x1: Math.max(r0.x, r1.x), z1: Math.max(r0.z, r1.z)}};
    out.counts.roadblock = n;
  }
  // the bus: at a kerb of another avenue / street segment, nose along the traffic side
  const busRng = c.rng.fork('bus');
  const pool = c.f.segments.filter(s => s !== rb && (s.run === 'z' ? crH(s.r) : crW(s.r)) >= 70 && !inSafe(c.safe, s.r) && !out.blocked.has(s.id) && s.line.rank === 'avenue');
  for (const s of busRng.shuffle([...pool])) {
    const runZ = s.run === 'z';
    const hiSide = busRng.chance(0.5);
    const rot = runZ ? (hiSide ? Math.PI / 2 : -Math.PI / 2) : (hiSide ? 0 : Math.PI);
    const e = halfExtents('srWreckBus', rot)!;
    const A0 = (runZ ? s.r.y0 : s.r.x0) * CELL, A1 = (runZ ? s.r.y1 : s.r.x1) * CELL;
    const acr = hiSide ? (runZ ? s.r.x1 : s.r.y1) * CELL - 0.2 - (runZ ? e.hx : e.hz) : (runZ ? s.r.x0 : s.r.y0) * CELL + 0.2 + (runZ ? e.hx : e.hz);
    const along = busRng.range(A0 + 14, A1 - 14);
    const p = runZ ? {x: acr, z: along} : {x: along, z: acr};
    if (c.op.place('srWreckBus', p.x, p.z, rot, {role: 'bus'})) { out.bus = {segment: s.id, x: p.x, z: p.z}; break; }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Wrecks: parked at kerbs, in junction corners, in parking lots

function wrecks(c: DressCtx, out: DressOut): void {
  const rng = c.rng.fork('wrecks');
  const car = () => rng.pick(SR_CAR_WRECKS);
  let parked = 0, inLots = 0, inJunctions = 0, rows = 0;
  // the district-wide wreck cap (pile-ups, the roadblock's truck and the bus are placed before this pass)
  let total = c.op.planned.filter(p => isWreck(p.kind)).length;
  const room = () => total < DRESS_CAP.wrecks;
  const place = (kind: string, x: number, z: number, rot: number, role: string): boolean => {
    if (!room() || !c.op.place(kind, x, z, rot, {role})) return false;
    total++;
    return true;
  };
  // junction corners (the middle stays clear)
  const groups = c.gm.groupRect.map((r, k) => ({r, k})).filter(q => !inSafe(c.safe, q.r) && crW(q.r) >= 20 && crH(q.r) >= 20);
  for (const q of rng.shuffle(groups).slice(0, rng.int(5, DRESS_CAP.junction))) {
    const kind = car(), rot = rng.int(0, 3) * Math.PI / 2;
    const e = halfExtents(kind, rot)!;
    const east = rng.chance(0.5), south = rng.chance(0.5);
    const x = east ? q.r.x1 * CELL - 0.6 - e.hx : q.r.x0 * CELL + 0.6 + e.hx;
    const z = south ? q.r.y1 * CELL - 0.6 - e.hz : q.r.y0 * CELL + 0.6 + e.hz;
    if (place(kind, x, z, rot, 'junction')) inJunctions++;
  }
  // parked ROWS: a few kerbs (avenues and the core's streets first) each hold one row of 2-4 abandoned cars nose to tail, right-hand
  // traffic (east-bound on the south kerb nose +X, south-bound on the west kerb nose +Z), now and then one turned round
  const segs = c.f.segments.filter(s => !inSafe(c.safe, s.r) && !out.blocked.has(s.id) && (s.run === 'z' ? crH(s.r) : crW(s.r)) * CELL >= 30);
  const coreSeg = (s: FrameSegment) => c.f.blocks.some(b => b.core && rectsTouch(b.kerb, s.r, 1));
  const order = [...rng.shuffle(segs.filter(s => s.line.rank === 'avenue' || coreSeg(s))), ...rng.shuffle(segs.filter(s => s.line.rank !== 'avenue' && !coreSeg(s)))];
  for (const s of order) {
    if (rows >= DRESS_CAP.parkedRows || parked >= DRESS_CAP.parked || !room()) break;
    if (!rng.chance(coreSeg(s) || s.line.rank === 'avenue' ? 0.55 : 0.2)) continue;
    const runZ = s.run === 'z', hiSide = rng.chance(0.5);
    const A0 = (runZ ? s.r.y0 : s.r.x0) * CELL + 5, A1 = (runZ ? s.r.y1 : s.r.x1) * CELL - 5;
    const n = rng.int(2, 4);
    let a = rng.range(A0, Math.max(A0, A1 - n * 5.6)), k = 0;
    for (let t = 0; t < n && a + 5 <= A1 && parked < DRESS_CAP.parked; t++) {
      const kind = car();
      let rot = runZ ? (hiSide ? Math.PI / 2 : -Math.PI / 2) : (hiSide ? 0 : Math.PI);
      if (rng.chance(0.15)) rot += Math.PI;
      const e = halfExtents(kind, rot)!;
      const acr = hiSide ? (runZ ? s.r.x1 : s.r.y1) * CELL - 0.15 - (runZ ? e.hx : e.hz) : (runZ ? s.r.x0 : s.r.y0) * CELL + 0.15 + (runZ ? e.hx : e.hz);
      const along = a + (runZ ? e.hz : e.hx);
      if (place(kind, runZ ? acr : along, runZ ? along : acr, rot, 'parked')) { parked++; k++; }
      a += 2 * (runZ ? e.hz : e.hx) + rng.range(0.6, 1.6);
    }
    if (k) rows++;
  }
  // parking lots: stalls along the long edges (perpendicular), the aisle clear
  // (a few lots, a handful of stalls each: shuffled so the cap does not fill the first lots only)
  for (const l of rng.shuffle(c.plans.lots.filter(q => q.use === 'parking' && !inSafe(c.safe, q.r)))) {
    if (inLots >= DRESS_CAP.lots || !room()) break;
    const r = l.r;
    const alongX = crW(r) >= crH(r);
    const depth = alongX ? crH(r) : crW(r);
    const sides: Side[] = alongX ? ['N', 'S'] : ['W', 'E'];
    const use = depth >= 34 ? sides : [sides.find(s => !l.driveways.includes(s)) ?? sides[0]];
    const lotCap = inLots + rng.int(3, 8);
    for (const s of use) {
      for (let a = (alongX ? r.x0 : r.y0) * CELL + 1.6; a + 1.4 <= (alongX ? r.x1 : r.y1) * CELL - 1.0 && inLots < Math.min(DRESS_CAP.lots, lotCap); a += 2.7) {
        if (!rng.chance(0.3)) continue;
        const kind = car();
        const rot = alongX ? (s === 'N' ? Math.PI / 2 : -Math.PI / 2) : (s === 'W' ? 0 : Math.PI);
        const e = halfExtents(kind, rot)!;
        const x = alongX ? a : s === 'W' ? r.x0 * CELL + 0.4 + e.hx : r.x1 * CELL - 0.4 - e.hx;
        const z = alongX ? (s === 'N' ? r.y0 * CELL + 0.4 + e.hz : r.y1 * CELL - 0.4 - e.hz) : a;
        if (place(kind, x, z, rot, 'lot')) inLots++;
      }
    }
  }
  out.counts.parked = parked;
  out.counts.parkedRows = rows;
  out.counts.lotWrecks = inLots;
  out.counts.junctionWrecks = inJunctions;
  out.counts.wrecks = total;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Street furniture

/** One sidewalk strip with its kerb side (the carriageway beyond it). */
interface Walk { r: CR; kerb: Side; area: number; core: boolean; avenue: boolean; block: FrameBlock | null; line: string }

function walks(c: DressCtx): Walk[] {
  const out: Walk[] = [];
  for (const b of c.f.blocks) {
    const st = sidewalkStrips(b);
    for (const s of SIDES) {
      const r = st[s];
      if (crW(r) <= 0 || crH(r) <= 0) continue;
      out.push({r, kerb: s, area: c.gm.sidewalk.get(`${b.id}${s}`) ?? -1, core: b.core, avenue: b.lines[s].rank === 'avenue', block: b, line: b.lines[s].name});
    }
  }
  // the cordon-side sidewalks: their kerb faces inward (N strip -> the road south of it)
  const kerbs: Side[] = ['S', 'N', 'E', 'W'];
  c.f.outer.forEach((r, k) => out.push({r, kerb: kerbs[k], area: c.gm.outerArea[k], core: false, avenue: false, block: null, line: ''}));
  return out;
}

/** World point at `along` (m) on a walk, `inset` metres in from its kerb line. */
function onWalk(w: Walk, along: number, inset: number): {x: number; z: number} {
  const r = w.r;
  switch (w.kerb) {
    case 'N': return {x: along, z: r.y0 * CELL + inset};
    case 'S': return {x: along, z: r.y1 * CELL - inset};
    case 'W': return {x: r.x0 * CELL + inset, z: along};
    default: return {x: r.x1 * CELL - inset, z: along};
  }
}
const walkRange = (w: Walk): [number, number] => (w.kerb === 'N' || w.kerb === 'S' ? [w.r.x0 * CELL, w.r.x1 * CELL] : [w.r.y0 * CELL, w.r.y1 * CELL]);
const walkWidth = (w: Walk): number => (w.kerb === 'N' || w.kerb === 'S' ? crH(w.r) : crW(w.r)) * CELL;
/** The long axis of a piece along the walk (rot 0 = local X along world X). */
const alongRot = (w: Walk) => (w.kerb === 'N' || w.kerb === 'S' ? 0 : Math.PI / 2);

function furniture(c: DressCtx, out: DressOut): void {
  const rng = c.rng.fork('furniture');
  const op = c.op;
  const n: Record<string, number> = {};
  const put = (kind: string, x: number, z: number, rot: number, role: string): PlannedProp | null => {
    const p = op.place(kind, x, z, rot, {role});
    if (p) n[kind] = (n[kind] ?? 0) + 1;
    return p;
  };
  const inSafeP = (x: number, z: number) => x > c.safe.x0 && x < c.safe.x1 && z > c.safe.z0 && z < c.safe.z1;
  // --- junction corners: traffic signals at avenue crossings, a street-name sign at every crossing -------------------------------
  c.gm.groupRect.forEach((r, k) => {
    const segs = c.f.segments.filter(s => c.gm.junctionGroup[s.a] === k || c.gm.junctionGroup[s.b] === k);
    const sx = segs.find(s => s.run === 'x'), sz = segs.find(s => s.run === 'z');
    const avenue = segs.some(s => s.line.rank === 'avenue');
    const corners = [[r.x0 * CELL - 0.7, r.y0 * CELL - 0.7, 0], [r.x1 * CELL + 0.7, r.y0 * CELL - 0.7, 0], [r.x0 * CELL - 0.7, r.y1 * CELL + 0.7, Math.PI], [r.x1 * CELL + 0.7, r.y1 * CELL + 0.7, Math.PI]] as const;
    // (two diagonal corners: one signal mast per approach pair, as at a real crossing)
    if (avenue) { const d = rng.chance(0.5) ? [0, 3] : [1, 2]; for (const k2 of d) { const [x, z, rot] = corners[k2]; put('srTrafficSignal', x, z, rot, 'signal'); } }
    // (a street-name sign where the streets are lit: the core's crossings and the avenues' — the outer ring reads by the map)
    const lit = avenue || c.f.blocks.some(b => b.core && rectsTouch(b.kerb, r, 2));
    if ((sx || sz) && lit) {
      const variant = streetSignVariant(sx ? c.streetOfSegment[sx.id] : c.streetOfSegment[sz!.id], sx && sz ? c.streetOfSegment[sz.id] : -1);
      for (const k2 of rng.shuffle([1, 2, 0, 3])) {
        const [x, z] = corners[k2];
        if (op.place('srStreetSign', x + (k2 & 1 ? 0.45 : -0.45), z, 0, {role: 'sign', variant})) { n.srStreetSign = (n.srStreetSign ?? 0) + 1; break; }
      }
    }
  });
  // --- lit streets: the avenues and the core's streets carry ONE lamp row per street line (on one kerb: the core side of a core-edge
  // line, else seeded per line); every other street, the lanes and the perimeter road stay without lamps ---------------------------
  const all = walks(c);
  const lineKey = (w: Walk) => `${w.line}|${w.kerb === 'N' || w.kerb === 'S' ? 'x' : 'z'}`;
  const litKerbs = new Map<string, Set<Side>>();
  for (const w of all) {
    if (!w.block || !(w.avenue || w.core) || w.block.lines[w.kerb].perimeter) continue;
    const k = lineKey(w);
    let s = litKerbs.get(k);
    if (!s) litKerbs.set(k, (s = new Set()));
    s.add(w.kerb);
  }
  const litSide = new Map<string, Side>();
  const lineRng = c.rng.fork('lamp-lines');
  for (const k of [...litKerbs.keys()].sort()) {
    const s = [...litKerbs.get(k)!].sort();
    litSide.set(k, s.length > 1 ? lineRng.pick(s) : s[0]);
  }
  // --- along every sidewalk: lamps (lit rows only, kerb zone, 30-40 m apart), hydrants, then the core's benches / bins / news boxes /
  // payphones ----------------------------------------------------------------------------------------------------------------------
  for (const w of all) {
    const [a0, a1] = walkRange(w);
    const faceRoad = FACE_ROT[w.kerb], faceIn = FACE_ROT[OPP[w.kerb]];
    const width = walkWidth(w);
    const lampAt: number[] = [];
    const lit = !!w.block && litSide.get(lineKey(w)) === w.kerb && (w.avenue || w.core) && !w.block.lines[w.kerb].perimeter;
    if (lit) {
      for (let a = a0 + rng.range(4, 14); a < a1 - 4; a += rng.range(DRESS_CAP.lampGap[0], DRESS_CAP.lampGap[1])) {
        const p = onWalk(w, a, 0.5);
        if (inSafeP(p.x, p.z)) continue;
        if (put('srStreetLamp', p.x, p.z, faceRoad, 'lamp')) lampAt.push(a);
      }
    }
    if (rng.chance(lit ? 0.35 : w.block && w.core ? 0.15 : 0)) { const p = onWalk(w, rng.range(a0 + 6, a1 - 6), 0.5); if (!inSafeP(p.x, p.z)) put('srFireHydrant', p.x, p.z, faceRoad, 'hydrant'); }
    if (!w.block) continue;
    if (w.core && width >= 3) {
      if (rng.chance(0.3)) { const p = onWalk(w, rng.range(a0 + 8, a1 - 8), 0.55); if (!inSafeP(p.x, p.z)) put('bench', p.x, p.z, faceIn, 'bench'); }
      for (const a of lampAt) if (rng.chance(0.4)) { const p = onWalk(w, a + 1.2, 0.5); put('bin', p.x, p.z, faceIn, 'bin'); }
      if (rng.chance(0.25)) { const p = onWalk(w, rng.chance(0.5) ? a0 + 4.5 : a1 - 4.5, 0.55); put('newspaperVendingBox', p.x, p.z, faceIn, 'news'); }
      if (w.avenue && rng.chance(0.3)) { const p = onWalk(w, rng.range(a0 + 8, a1 - 8), 0.45); put('payphone', p.x, p.z, faceIn, 'payphone'); }
    }
    // loose clutter near the building line (never in the middle of the walk)
    if (rng.chance(w.core ? 0.12 : 0.08)) { const p = onWalk(w, rng.range(a0 + 6, a1 - 6), width - 0.5); put('bicycle', p.x, p.z, alongRot(w), 'bicycle'); }
    if (rng.chance(w.core ? 0.1 : 0.14)) { const p = onWalk(w, rng.range(a0 + 6, a1 - 6), width - 0.55); put('trashBagPile', p.x, p.z, faceRoad, 'trash'); }
    if (rng.chance(0.04)) { const p = onWalk(w, rng.range(a0 + 6, a1 - 6), width - 0.6); put('shoppingCart', p.x, p.z, alongRot(w), 'cart'); }
  }
  // --- service lanes / yards: trash piles and wheelie bins along the walls; parks / plazas: benches and bins; centre parking: carts
  for (const l of c.plans.lots) {
    const r = l.r;
    if (inSafe(c.safe, r)) continue;
    const alongX = crW(r) >= crH(r);
    const lr = c.rng.fork(`lot-dress-${l.id}`);
    if (l.use === 'alley' || l.use === 'court') {
      const k = lr.int(1, 3);
      for (let t = 0; t < k; t++) {
        const kind = lr.chance(0.55) ? 'wheelieBin' : 'trashBagPile';
        const hi = lr.chance(0.5);
        const a = alongX ? lr.range(r.x0 * CELL + 2, r.x1 * CELL - 2) : lr.range(r.y0 * CELL + 2, r.y1 * CELL - 2);
        const x = alongX ? a : hi ? r.x1 * CELL - 0.5 : r.x0 * CELL + 0.5, z = alongX ? (hi ? r.y1 * CELL - 0.5 : r.y0 * CELL + 0.5) : a;
        put(kind, x, z, alongX ? (hi ? FACE_ROT.N : FACE_ROT.S) : (hi ? FACE_ROT.W : FACE_ROT.E), 'service');
      }
    } else if (l.use === 'park' || (l.use === 'plaza' && l.label !== 'Military checkpoint')) {
      const k = l.use === 'park' ? lr.int(2, 4) : lr.int(1, 2);
      for (let t = 0; t < k; t++) {
        const s = lr.pick(SIDES);
        const inset = 1.6;
        const x = s === 'W' ? r.x0 * CELL + inset : s === 'E' ? r.x1 * CELL - inset : lr.range(r.x0 * CELL + 3, r.x1 * CELL - 3);
        const z = s === 'N' ? r.y0 * CELL + inset : s === 'S' ? r.y1 * CELL - inset : lr.range(r.y0 * CELL + 3, r.y1 * CELL - 3);
        if (put('bench', x, z, FACE_ROT[OPP[s]], 'park-bench') && lr.chance(0.5)) put('bin', x + (s === 'N' || s === 'S' ? 1.5 : 0), z + (s === 'W' || s === 'E' ? 1.5 : 0), FACE_ROT[OPP[s]], 'park-bin');
      }
    } else if (l.use === 'parking' && l.label === 'Customer parking') {
      for (let t = lr.int(1, 3); t > 0; t--) put('shoppingCart', lr.range(r.x0 * CELL + 2, r.x1 * CELL - 2), lr.range(r.y0 * CELL + 2, r.y1 * CELL - 2), lr.int(0, 3) * Math.PI / 2, 'cart');
    }
  }
  Object.assign(out.counts, n);
}

/** Every outdoor dressing pass, in order (after the checkpoint's own dressing). */
export function dressOutdoors(c: DressCtx): DressOut {
  const out: DressOut = {blocked: new Map(), rubble: [], roadblock: null, bus: null, collapse: new Map(), counts: {}};
  blockedSpans(c, out);
  spills(c, out);
  roadblockAndBus(c, out);
  wrecks(c, out);
  furniture(c, out);
  return out;
}

/** Keeps every kept doorway's front (3 m out, 1 m either side), every driveway (and 4 m of road / lot beyond it) and the yards clear. */
export function reserveFronts(c: {kit: Kit; gm: GroundMap; plans: BlockPlans; op: OutdoorProps}, doorways: readonly {cells: readonly number[]; side: Side}[]): void {
  const g = c.kit.g, op = c.op;
  for (const d of doorways) {
    if (!d.cells.length) continue;
    const xs = d.cells.map(i => i % g.w), ys = d.cells.map(i => Math.floor(i / g.w));
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    if (d.side === 'N') op.reserveRect(x0 - 2, y0 - 6, x1 + 2, y0);
    else if (d.side === 'S') op.reserveRect(x0 - 2, y1, x1 + 2, y1 + 6);
    else if (d.side === 'W') op.reserveRect(x0 - 6, y0 - 2, x0, y1 + 2);
    else op.reserveRect(x1, y0 - 2, x1 + 6, y1 + 2);
  }
  for (const r of c.gm.driveways) {
    // across the walk both ways: the road on one side, the lot on the other
    if (r.side === 'N' || r.side === 'S') op.reserveRect(r.x0, r.y0 - 8, r.x1, r.y1 + 8);
    else op.reserveRect(r.x0 - 8, r.y0, r.x1 + 8, r.y1);
  }
  for (const l of c.plans.lots) if (l.use === 'loading' || l.use === 'yard' || l.use === 'rail') op.reserveRect(l.r.x0, l.r.y0, l.r.x1, l.r.y1);
  for (const r of c.gm.rail) op.reserveRect(r.x0, r.y0, r.x1, r.y1);
}
