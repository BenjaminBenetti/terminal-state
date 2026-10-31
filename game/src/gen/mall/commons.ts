// Task track3-eaton-centre-20261031 (lane SHOPS): THE GALLERY COMMONS of The Eaton's Center — pure data (no three.js), called by
// dressMallShops after the shop interiors (same place contexts, same absolute-height lift). Two lane ASSETS batch-1 models furnish
// the public galleries:
//  - a KIOSK CART (`mallKioskCart`, M17: a 2-door lower cabinet = an openable container, an open double-sided display box) on at most
//    one spot per retail ring, long side along the walkway, its doors toward the shops (away from the void);
//  - FOOD-HALL SEATING (`foodCourtTableSet`, M20: a table + four stools on one floor-fixed frame) in the gallery of the food-court
//    ring, nearest the food counters, up to COMMONS.seat.max sets ("its seating is the common food hall": gen/mall/shops.ts);
//  - MALL BENCHES (`mallBench`, batch 2 resume M37: 1.70 m, seat 0.45, slim backrest; bolted down) — up to COMMONS.bench.perRing per
//    ring, spaced apart, long side along the walkway, the seat facing the atrium.
// A spot is taken only where it is clearly out of the way: the footprint AND a clear ring around it (kiosk 1.8 m, seating 0.9 m)
// are walkable GALLERY floor (never a bridge deck, a shop, a door zone, a stair approach / link landing (placeKit edge mask), a
// void / aperture setback or a ramp), a set distance from every railing run (void edges, escalator balustrades), every run mouth
// (escalator / stair foot and head, level-link landings), every elevator shaft and every shopfront entry zone; tryPlaceProp then
// keeps the storey connected. A walkable ring round a convex footprint cannot cut the gallery. Candidates are scanned in a seeded
// order (own fork per storey), so a seed always furnishes the same commons.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import {propBlocksDoorway, tryPlaceProp, type PlaceCtx} from '../placeKit';
import type {Area, StationLayout} from '../stationTypes';

/** Clearances (m) of the gallery pieces: walkable ring, railing / run-mouth / elevator / shopfront-entry distances. */
export const COMMONS = {
  kiosk: {ring: 1.8, rail: 1.6, mouth: 4.5, lift: 2.5, entry: 2.0, front: 0.9, perRing: 1},
  seat: {ring: 0.9, rail: 1.2, mouth: 3.0, lift: 1.5, entry: 1.5, gap: 3.4, max: 6},
  bench: {ring: 0.8, rail: 1.0, mouth: 3.5, lift: 1.5, entry: 1.5, gap: 6.0, perRing: 3},
} as const;

export interface CommonsReport {
  kiosks: {level: number; x: number; z: number; rot: number}[];
  seats: {level: number; x: number; z: number}[];
  benches: {level: number; x: number; z: number; rot: number}[];
  rejects: Record<string, number>;
}

type V = {x: number; z: number};
type Box = {x0: number; z0: number; x1: number; z1: number};

/** Distance from a point to a box (0 inside). */
function pointBox(px: number, pz: number, b: Box): number {
  const dx = Math.max(b.x0 - px, 0, px - b.x1), dz = Math.max(b.z0 - pz, 0, pz - b.z1);
  return Math.hypot(dx, dz);
}
/** Distance from a point to a segment. */
function pointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
/** Whether a segment crosses a box (Liang-Barsky clip). */
function segHitsBox(ax: number, az: number, bx: number, bz: number, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - b.x0], [dx, b.x1 - ax], [-dz, az - b.z0], [dz, b.z1 - az]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
/** Distance between a segment and a box (two convex shapes: 0 when they cross, else a vertex-to-edge minimum). */
function segBox(ax: number, az: number, bx: number, bz: number, b: Box): number {
  if (segHitsBox(ax, az, bx, bz, b)) return 0;
  return Math.min(pointBox(ax, az, b), pointBox(bx, bz, b),
    pointSeg(b.x0, b.z0, ax, az, bx, bz), pointSeg(b.x1, b.z0, ax, az, bx, bz), pointSeg(b.x0, b.z1, ax, az, bx, bz), pointSeg(b.x1, b.z1, ax, az, bx, bz));
}
const boxBox = (a: Box, b: Box) => Math.hypot(Math.max(b.x0 - a.x1, 0, a.x0 - b.x1), Math.max(b.z0 - a.z1, 0, a.z0 - b.z1));

/** Centre offset so a footprint of extent e sits on whole cells (odd cell count: cell centre; even: cell boundary). */
const centreOff = (e: number) => (Math.ceil((e - 0.08) / CELL - 1e-9) % 2 === 1 ? CELL / 2 : 0);

/** Furnishes the gallery commons (see the header). `ctxOf`: the shop dresser's per-storey place contexts. */
export function dressMallCommons(layout: StationLayout, ctxOf: (level: number) => PlaceCtx, rng: Rng, placed?: PropPlacement[]): CommonsReport {
  const rep: CommonsReport = {kiosks: [], seats: [], benches: [], rejects: {}};
  const why = (r: string) => { rep.rejects[r] = (rep.rejects[r] ?? 0) + 1; };
  const m = layout.mall;
  if (!m) return rep;
  // (a synthetic test mall may carry no void record: the kiosk doors then face +z / +x)
  const vb = (m.void as typeof m.void | null)?.bounds, vc: V = vb ? {x: (vb.x0 + vb.x1) / 2, z: (vb.z0 + vb.z1) / 2} : {x: -Infinity, z: -Infinity};
  for (const gl of m.galleries) {
    const lv = gl.level;
    if (lv < 1) continue;
    const ctx = ctxOf(lv), g = ctx.g;
    const galleries = new Set(gl.areas);
    const mouths: V[] = [];
    for (const v of m.verticals) { if (v.lower === lv) mouths.push(v.foot); if (v.upper === lv) mouths.push(v.head); }
    for (const k of layout.levelLinks ?? []) { if (k.lower === lv) mouths.push(k.bottom); if (k.upper === lv) mouths.push(k.top); }
    const rails = (layout.rails ?? []).filter(r => r.level === lv);
    const lifts: Box[] = m.elevators.filter(e => e.stops.some(s => s.level === lv)).map(e => e.shaft);
    const shops = m.shops.filter(s => s.level === lv);
    /**
     * Shopfront entry zones `depth` m out into the gallery: the entry span of a glazed front (shop.fit.entry; the glazing beside it
     * is a wall), the whole frontage of an open front (food / kiosk counters serve over it); 0.5 m extra along the frontage.
     */
    const entries = (depth: number): Box[] => shops.flatMap(s => {
      const f = s.frontage, a = layout.areas[s.area], fit = s.fit;
      if (fit?.shutter === 'closed') return [];
      const alongX = Math.abs(f.x1 - f.x0) >= Math.abs(f.z1 - f.z0);
      const acx = a ? (a.x + a.w / 2) * CELL : 0, acz = a ? (a.y + a.h / 2) * CELL : 0;
      // outward (gallery side) sign: away from the unit's centre
      const sg = alongX ? Math.sign((f.z0 + f.z1) / 2 - acz) || 1 : Math.sign((f.x0 + f.x1) / 2 - acx) || 1;
      let x0 = Math.min(f.x0, f.x1), x1 = Math.max(f.x0, f.x1), z0 = Math.min(f.z0, f.z1), z1 = Math.max(f.z0, f.z1);
      if (fit?.front === 'glazed' && fit.entry) {
        if (alongX) { const s0 = x0; x0 = s0 + fit.entry[0]; x1 = Math.min(x1, s0 + fit.entry[1]); } else { const s0 = z0; z0 = s0 + fit.entry[0]; z1 = Math.min(z1, s0 + fit.entry[1]); }
      }
      return [alongX ? {x0: x0 - 0.5, x1: x1 + 0.5, z0: sg < 0 ? z0 - depth : z0, z1: sg > 0 ? z1 + depth : z1}
        : {x0: sg < 0 ? x0 - depth : x0, x1: sg > 0 ? x1 + depth : x1, z0: z0 - 0.5, z1: z1 + 0.5}];
    });
    const base = layout.levels[lv]?.baseY ?? 0;
    const lrng = rng.fork(`commons:${lv}`);
    // every gallery cell of the storey, in a seeded order
    const cells: number[] = [];
    for (const id of gl.areas) {
      const a = layout.areas[id];
      if (!a) continue;
      for (let cy = a.y; cy < a.y + a.h; cy++) for (let cx = a.x; cx < a.x + a.w; cx++) {
        if (!g.inBounds(cx, cy)) continue;
        const i = g.idx(cx, cy);
        if (g.area[i] === id && g.cells[i] === FLOOR) cells.push(i);
      }
    }
    if (!cells.length) continue;

    /** Footprint + ring clear on gallery floor, out of the masks; distances to rails / mouths / lifts / entries / doors. */
    const fits = (kind: PropKind, x: number, z: number, rot: number, c: {ring: number; rail: number; mouth: number; lift: number}, ent: readonly Box[], tag: string): Area | null => {
      const {hx, hz} = footprint(kind, rot);
      const b: Box = {x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz};
      if (mouths.some(q => pointBox(q.x, q.z, b) < c.mouth)) { why(`${tag}-mouth`); return null; }
      if (lifts.some(s => boxBox(s, b) < c.lift)) { why(`${tag}-lift`); return null; }
      if (ent.some(e => b.x0 < e.x1 - 1e-6 && b.x1 > e.x0 + 1e-6 && b.z0 < e.z1 - 1e-6 && b.z1 > e.z0 + 1e-6)) { why(`${tag}-entry`); return null; }
      for (const r of rails) {
        if (Math.min(r.x0, r.x1) - b.x1 > c.rail || b.x0 - Math.max(r.x0, r.x1) > c.rail || Math.min(r.z0, r.z1) - b.z1 > c.rail || b.z0 - Math.max(r.z0, r.z1) > c.rail) continue;
        if (segBox(r.x0, r.z0, r.x1, r.z1, b) < c.rail) { why(`${tag}-rail`); return null; }
      }
      const x0 = Math.floor((b.x0 + 0.04) / CELL), x1 = Math.floor((b.x1 - 0.04) / CELL), y0 = Math.floor((b.z0 + 0.04) / CELL), y1 = Math.floor((b.z1 - 0.04) / CELL);
      const rc = Math.ceil(c.ring / CELL - 1e-6);
      let area = -1;
      for (let cy = y0 - rc; cy <= y1 + rc; cy++) for (let cx = x0 - rc; cx <= x1 + rc; cx++) {
        if (!g.inBounds(cx, cy)) { why(`${tag}-bounds`); return null; }
        const i = g.idx(cx, cy);
        // the ring: open, walkable gallery floor (never a bridge deck, a shop, a ramp, another prop) ...
        if (!galleries.has(g.area[i]) || g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || g.blocked[i]) { why(`${tag}-ring`); return null; }
        const inside = cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
        if (!inside) continue;
        // ... the footprint also out of door zones, stair approaches / link landings, aperture setbacks and reserved cells
        if (ctx.zone[i] || ctx.edge[i] || ctx.aperture[i] || ctx.keep[i]) { why(`${tag}-zone`); return null; }
        if (area < 0) area = g.area[i]; else if (area !== g.area[i]) { why(`${tag}-split`); return null; }
      }
      if (propBlocksDoorway(layout, x, z, hx + 0.6, hz + 0.6, base, 2.2)) { why(`${tag}-door`); return null; }
      return layout.areas[area] ?? null;
    };
    const put = (kind: PropKind, x: number, z: number, rot: number, a: Area, ring: number, front?: number): PropPlacement | null => {
      const p = tryPlaceProp({...ctx, rng: lrng}, a, kind, Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000, rot, {ring, ...(front ? {front} : {})});
      if (p) placed?.push(p); else why(`${kind}-place`);
      return p;
    };
    const order = lrng.shuffle(cells.slice());

    // --- food-hall seating on the food-court ring: nearest the food counters first, spaced apart -------------------------------
    const food = shops.filter(s => s.kind === 'food');
    if (food.length) {
      const S = COMMONS.seat, def = PROP_DEFS.foodCourtTableSet;
      const ox = centreOff(def.w), oz = centreOff(def.d);
      const counters = food.map(s => ({x: (s.frontage.x0 + s.frontage.x1) / 2, z: (s.frontage.z0 + s.frontage.z1) / 2}));
      const near = (x: number, z: number) => Math.min(...counters.map(q => Math.hypot(q.x - x, q.z - z)));
      const cand = order.map(i => { const cx = i % g.w, cy = (i - cx) / g.w; const x = cx * CELL + ox, z = cy * CELL + oz; return {x, z, d: near(x, z)}; })
        .sort((p, q) => p.d - q.d || p.x - q.x || p.z - q.z);
      const ent = entries(S.entry);
      const got: V[] = [];
      for (const c of cand) {
        if (got.length >= S.max) break;
        if (got.some(q => Math.hypot(q.x - c.x, q.z - c.z) < S.gap)) continue;
        const a = fits('foodCourtTableSet', c.x, c.z, 0, S, ent, 'seat');
        if (!a) continue;
        if (put('foodCourtTableSet', c.x, c.z, 0, a, S.ring)) { got.push(c); rep.seats.push({level: lv, x: c.x, z: c.z}); }
      }
    }

    // --- the kiosk cart: one per ring, long side along the walkway, doors toward the shops ---------------------------------------
    const K = COMMONS.kiosk, kd = PROP_DEFS.mallKioskCart;
    const ent = entries(K.entry);
    let kiosks = 0;
    const runAlong = (cx: number, cy: number, dx: number, dy: number) => {
      let n = 0;
      for (const s of [1, -1]) for (let k = 1; k <= 8; k++) { const x = cx + dx * k * s, y = cy + dy * k * s; if (!g.inBounds(x, y) || !galleries.has(g.area[g.idx(x, y)]) || !g.walkable(x, y)) break; n++; }
      return n;
    };
    for (const i of order) {
      if (kiosks >= K.perRing) break;
      const cx = i % g.w, cy = (i - cx) / g.w;
      const alongX = runAlong(cx, cy, 1, 0) >= runAlong(cx, cy, 0, 1);
      const x = cx * CELL + centreOff(alongX ? kd.w : kd.d), z = cy * CELL + centreOff(alongX ? kd.d : kd.w);
      const rot = alongX ? (z >= vc.z ? 0 : Math.PI) : (x >= vc.x ? Math.PI / 2 : -Math.PI / 2);
      const a = fits('mallKioskCart', x, z, rot, K, ent, 'kiosk');
      if (!a) continue;
      if (put('mallKioskCart', x, z, rot, a, K.ring, K.front)) { kiosks++; rep.kiosks.push({level: lv, x, z, rot}); }
    }

    // --- mall benches (lane ASSETS M37, bolted down): a few per ring, long side along the walkway, the seat facing the atrium ---------
    const B = COMMONS.bench, bd = PROP_DEFS.mallBench;
    const bent = entries(B.entry);
    const got: V[] = [];
    for (const i of order) {
      if (got.length >= B.perRing) break;
      const cx = i % g.w, cy = (i - cx) / g.w;
      const alongX = runAlong(cx, cy, 1, 0) >= runAlong(cx, cy, 0, 1);
      const x = cx * CELL + centreOff(alongX ? bd.w : bd.d), z = cy * CELL + centreOff(alongX ? bd.d : bd.w);
      if (got.some(q => Math.hypot(q.x - x, q.z - z) < B.gap)) continue;
      // the seat (+Z) toward the void centre (a synthetic mall without a void: +z / +x)
      const rot = alongX ? (z <= vc.z || !Number.isFinite(vc.z) ? 0 : Math.PI) : (x <= vc.x || !Number.isFinite(vc.x) ? Math.PI / 2 : -Math.PI / 2);
      const a = fits('mallBench', x, z, rot, B, bent, 'bench');
      if (!a) continue;
      if (put('mallBench', x, z, rot, a, B.ring)) { got.push({x, z}); rep.benches.push({level: lv, x, z, rot}); }
    }
  }
  return rep;
}
