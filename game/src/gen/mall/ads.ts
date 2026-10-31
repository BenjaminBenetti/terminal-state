// Task mall-playtest-revision-20261031 (lane SHOPS, D06 — user: "there was no uh billboards or anything like certainly the stores would
// have like pictures of people wearing the clothes ... some ads and some billboards"): ad / fashion-merchandising PLACEMENT records of
// the shops. Pure data (no three.js), deterministic. Lane ARCH renders the faces (fictional vector art, generic dressed adult
// silhouettes, no real brands / photos) from these records; gallery / atrium billboards are ARCH's own (from geometry, not here).
// Records are not props: no collider, no physics / openables audit; they never block signs, entries or interactions.
//
// Contract with lane ARCH (lanes/ARCH.notes "Requests to other lanes"): `layout.mall.ads?: MallAd[]`, read loosely by ARCH.
//
// What goes where (placeMallAds, per shop sales floor, its own rng fork `ad:<shop id>` so one shop never shifts another):
//  - 'decal' on shopfront GLASS: centred on a `shopGlazing` span (>= DECAL_MIN_SPAN wide) of the unit — the glazing beside the entry
//    span, so never over the way in; any frontage whose glazing exists (corner units: both). Face 0.8-1.0 x 1.1-1.4 m, centre ~1.5 m
//    above the floor, ON the glazing's centre plane (both-faced: ARCH offsets the two faces off its glass), normal toward the walkway.
//    Fashion programs (FASHION) 1-2, other stores / food counters 0-1 (seeded chance DECAL_CHANCE), vacant units a 'For Lease'
//    decal at VACANT_DECAL_CHANCE, service rooms / kiosks (open fronts: no glass) none.
//  - 'lightbox' fashion merchandising: a backlit panel (0.12 m deep) on a SIDE wall of a fashion store near its window display (centre
//    depth LIGHTBOX_DEPTH_V from the frontage), face 0.9-1.2 x 1.6-2.0 m, bottom >= 0.6 m; anchors / department stores 2.
//  - 'poster' header graphics: one per store / food counter (2 for anchors and big units >= BIG_UNIT_M2) high on the back (else a side)
//    wall above its fixture run: bottom >= max(top of the props within WALL_BAND of that span) + 0.1 and >= 1.6 m, top <= the ceiling
//    - 0.2 m (the face shrinks to fit, never below 0.7 m tall).
// Every wall record is wall-backed over its width at its bottom AND at 1.0 m above the floor (gen/doorways.ts wallBacked: solid wall,
// apertures never count — so never over a door, a shopfront or a railing), inside the area's wall span (0.15 m from the corners),
// clear of every prop box (mounted ones too) in front of it, of the other records and of wall signs; face centre proud of the wall by
// 0.015 m (lightbox: half its depth, 0.06 m). Absolute y (storey floor from placeKit areaBase).

import type {Rng} from '../../core/rng';
import {CELL} from '../grid';
import {wallBacked} from '../doorways';
import {areaBase, areaLevel, levelGrid} from '../placeKit';
import type {PropPlacement} from '../props';
import type {Area, Side, StationLayout} from '../stationTypes';
import type {MallProgram, MallShop} from './mallTypes';
import {shopFit} from './shops';
import {frameOf, frontageSide, uvXZ, type ShopFrame} from './shopsDress';

export interface MallAd {
  /** decal = on shopfront glass (both faces); poster = flat on a wall; lightbox = 0.12 m deep backlit box on a wall; billboard = big panel. */
  kind: 'poster' | 'lightbox' | 'billboard' | 'decal';
  /** Theme (clothing / shoes / department -> dressed adult silhouettes, ...). */
  program: MallProgram | 'mall';
  /** MallShop.id (the brand is read from the shop); none = a gallery ad. */
  shop?: string;
  level: number;
  /** Centre of the FACE (world m, absolute y), on / proud of the wall. */
  x: number; y: number; z: number;
  /** Unit axis-aligned face normal (into the room it is seen from). */
  nx: number; nz: number;
  /** Face size (m). */
  w: number; h: number;
  /** Variant (motif / headline / palette). */
  seed: number;
}

export interface MallAdsReport {
  ads: number;
  byKind: Partial<Record<MallAd['kind'], number>>;
  byProgram: Partial<Record<string, number>>;
}

/** Fashion programs: window decals x1-2 + a lightbox by the window display (dressed adult silhouettes on ARCH's faces). */
export const FASHION: ReadonlySet<MallProgram> = new Set(['clothing', 'shoes', 'department', 'beauty', 'sports', 'jewelry', 'optical', 'outdoors', 'luggage']);
/** Chance of one window decal for the other stores / food counters (a sale / menu / new-arrivals sticker). */
export const DECAL_CHANCE = 0.55;
export const VACANT_DECAL_CHANCE = 0.5;
/** Narrowest glazing span that takes a decal (m). */
export const DECAL_MIN_SPAN = 1.2;
/** Sales floors at least this big (m²) get a second header poster. */
export const BIG_UNIT_M2 = 150;
/** Lightbox face centre depth band (m from the frontage): beside the window display. */
export const LIGHTBOX_DEPTH_V: readonly [number, number] = [1.2, 3.2];
/** Depth (m) of a lightbox box; props within WALL_BAND of the wall raise a poster above them. */
export const LIGHTBOX_DEPTH = 0.12;
const WALL_BAND = 0.4;
/** Depth of the wall-record clearance box checked against props / other records (m). */
const CLEAR_DEPTH = 0.3;
/** Wall records: face proud of the wall (m). */
const PROUD = 0.015;
const CORNER = 0.15;

/** The mall's ad records (empty before placeMallAds ran). */
export function mallAds(layout: StationLayout): MallAd[] {
  return ((layout.mall as {ads?: MallAd[]} | undefined)?.ads) ?? [];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const NORMAL: Record<Side, [number, number]> = {N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]};
const alongX = (s: Side) => s === 'N' || s === 'S';

/** World line coordinate of an area wall's face (z for N / S, x for W / E). */
function wallLine(a: Area, side: Side): number {
  return side === 'N' ? a.y * CELL : side === 'S' ? (a.y + a.h) * CELL : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
}
/** World along-wall span of an area wall. */
function wallSpan(a: Area, side: Side): [number, number] {
  return alongX(side) ? [a.x * CELL, (a.x + a.w) * CELL] : [a.y * CELL, (a.y + a.h) * CELL];
}

/** The axis-aligned box a record occupies (its clearance box for wall records: CLEAR_DEPTH into the room). */
export function adBox(ad: MallAd, depth = ad.kind === 'decal' ? 0.02 : CLEAR_DEPTH): {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number} {
  const wallX = ad.nz !== 0; // the face runs along x
  const back = ad.kind === 'lightbox' ? LIGHTBOX_DEPTH / 2 : ad.kind === 'decal' ? depth / 2 : PROUD;
  // the wall plane is `back` behind the face centre; the box spans from the wall `depth` into the room (decals: +-depth / 2)
  const p0 = ad.kind === 'decal' ? -depth / 2 : -back, p1 = ad.kind === 'decal' ? depth / 2 : depth - back;
  const along0 = (wallX ? ad.x : ad.z) - ad.w / 2, along1 = (wallX ? ad.x : ad.z) + ad.w / 2;
  const n = wallX ? ad.nz : ad.nx, c = wallX ? ad.z : ad.x;
  const a = c + n * p0, b = c + n * p1;
  const [d0, d1] = [Math.min(a, b), Math.max(a, b)];
  return wallX ? {x0: along0, x1: along1, z0: d0, z1: d1, y0: ad.y - ad.h / 2, y1: ad.y + ad.h / 2}
    : {x0: d0, x1: d1, z0: along0, z1: along1, y0: ad.y - ad.h / 2, y1: ad.y + ad.h / 2};
}
type Box = ReturnType<typeof adBox>;
const overlap = (a: Box, b: Box, e = 0.005) => a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e && a.z0 < b.z1 - e && b.z0 < a.z1 - e;
/** AABB of a prop (absolute y). */
export const propBox = (p: PropPlacement): Box => ({x0: p.x - p.hx, x1: p.x + p.hx, y0: p.y + (p.lift ?? 0), y1: p.y + p.h, z0: p.z - p.hz, z1: p.z + p.hz});

interface ShopCtx {
  layout: StationLayout;
  shop: MallShop;
  program: MallProgram;
  a: Area;
  level: number;
  base: number;
  ceil: number;
  fr: ShopFrame;
  /** Props of this sales area + every prop of the storey within 1 m of its rect (mounted ones too). */
  props: PropPlacement[];
  placed: MallAd[];
  rng: Rng;
}

/** Highest prop top within WALL_BAND of a wall span (absolute; the floor when none). */
function bandTop(c: ShopCtx, side: Side, t0: number, t1: number): number {
  const line = wallLine(c.a, side), [nx, nz] = NORMAL[side];
  let top = c.base;
  for (const p of c.props) {
    if (p.kind === 'shopGlazing' || p.kind === 'shopShutter') continue;
    const b = propBox(p);
    const along0 = alongX(side) ? b.x0 : b.z0, along1 = alongX(side) ? b.x1 : b.z1;
    if (along1 <= t0 || along0 >= t1) continue;
    // distance from the wall face into the room of the prop's near face
    const near = alongX(side) ? (nz > 0 ? b.z0 - line : line - b.z1) : (nx > 0 ? b.x0 - line : line - b.x1);
    if (near > WALL_BAND) continue;
    top = Math.max(top, b.y1);
  }
  return top;
}

/** Wall record at along-wall centre t on `side` with face w x h and bottom y0 (absolute) — null when it does not qualify. */
function wallRecord(c: ShopCtx, kind: 'poster' | 'lightbox', side: Side, t: number, w: number, h: number, y0: number): MallAd | null {
  const [s0, s1] = wallSpan(c.a, side);
  if (t - w / 2 < s0 + CORNER - 1e-6 || t + w / 2 > s1 - CORNER + 1e-6) return null;
  if (y0 < c.base + 0.55 || y0 + h > c.ceil - 0.2 + 1e-6) return null;
  const g = levelGrid(c.layout, c.level);
  // solid wall behind the whole width at its bottom AND at 1.0 m above the floor: never over a door / shopfront / railing / aperture
  if (!wallBacked(g, c.a, side, t - w / 2, t + w / 2, y0) || !wallBacked(g, c.a, side, t - w / 2, t + w / 2, c.base + 1.0)) return null;
  const [nx, nz] = NORMAL[side], line = wallLine(c.a, side), off = kind === 'lightbox' ? LIGHTBOX_DEPTH / 2 : PROUD;
  const fx = alongX(side) ? t : line + nx * off, fz = alongX(side) ? line + nz * off : t;
  // (rounded to mm with the bottom never below y0: the bottom / clearance rules hold on the stored numbers)
  const hr = r3(h);
  let yc = r3(y0 + hr / 2);
  if (yc - hr / 2 < y0) yc = r3(yc + 0.001);
  const ad: MallAd = {kind, program: c.program, shop: c.shop.id, level: c.level, x: r3(fx), y: yc, z: r3(fz), nx, nz, w: r3(w), h: hr, seed: c.rng.int(0, 0x7fffffff)};
  const box = adBox(ad);
  for (const p of c.props) if (overlap(box, propBox(p))) return null;
  for (const q of c.placed) if (overlap(box, adBox(q))) return null;
  for (const s of c.layout.signs) {
    if ((s.level ?? 0) !== c.level || s.hang) continue;
    const sw = (s.w ?? 1.4) / 2;
    const sb: Box = {x0: s.x - (alongX(side) ? sw : 0.2), x1: s.x + (alongX(side) ? sw : 0.2), z0: s.z - (alongX(side) ? 0.2 : sw), z1: s.z + (alongX(side) ? 0.2 : sw), y0: s.y - 0.35, y1: s.y + 0.35};
    if (overlap(box, sb)) return null;
  }
  return ad;
}

/** Window decals on the unit's glazing spans. */
function decals(c: ShopCtx, n: number): void {
  if (n <= 0) return;
  const spans = c.props.filter(p => p.kind === 'shopGlazing' && p.area === c.a.id)
    .map(p => {
      // which wall of the area the glazing line belongs to (nearest), its along-wall span
      const ax = p.hx >= p.hz;
      const side: Side = ax ? (Math.abs(p.z - c.a.y * CELL) <= Math.abs(p.z - (c.a.y + c.a.h) * CELL) ? 'N' : 'S') : (Math.abs(p.x - c.a.x * CELL) <= Math.abs(p.x - (c.a.x + c.a.w) * CELL) ? 'W' : 'E');
      return {p, side, len: 2 * (ax ? p.hx : p.hz)};
    })
    .filter(s => s.len >= DECAL_MIN_SPAN)
    .sort((a, b) => b.len - a.len || a.p.x - b.p.x || a.p.z - b.p.z);
  for (const s of spans.slice(0, n)) {
    const [nx, nz] = NORMAL[s.side];
    // the walkway is outside the unit: the face looks out (-room normal)
    const w = r3(Math.min(1.0, Math.max(0.8, s.len - 0.4))), h = r3(c.rng.range(1.1, 1.4));
    const yc = c.base + 1.5;
    if (yc + h / 2 > s.p.y + s.p.h - 0.05 || yc - h / 2 < c.base + 0.3) continue;
    c.placed.push({kind: 'decal', program: c.program, shop: c.shop.id, level: c.level, x: r3(s.p.x), y: r3(yc), z: r3(s.p.z), nx: -nx, nz: -nz, w, h, seed: c.rng.int(0, 0x7fffffff)});
  }
}

/** A lightbox on a side wall beside the window display. */
function lightbox(c: ShopCtx): boolean {
  const w = r3(c.rng.range(0.9, 1.2)), h = r3(c.rng.range(1.6, 2.0));
  const sides: ('L' | 'R')[] = c.rng.chance(0.5) ? ['L', 'R'] : ['R', 'L'];
  for (const which of sides) {
    const side = which === 'L' ? c.fr.L : c.fr.R;
    for (const v of [2.0, 1.6, 2.6, 3.0, 1.3]) {
      if (v < LIGHTBOX_DEPTH_V[0] || v > Math.min(LIGHTBOX_DEPTH_V[1], c.fr.D - 0.6)) continue;
      const [x, z] = uvXZ(c.fr, which === 'L' ? 0 : c.fr.W, v);
      const t = alongX(side) ? x : z;
      const bottom = Math.max(c.base + 0.6, bandTop(c, side, t - w / 2, t + w / 2) + 0.1);
      const ad = wallRecord(c, 'lightbox', side, t, w, h, bottom);
      if (ad) { c.placed.push(ad); return true; }
    }
  }
  return false;
}

/** A header graphic high on the back wall (else a side wall) above the fixture run. */
function poster(c: ShopCtx): boolean {
  const walls: Side[] = [c.fr.back, ...(c.rng.chance(0.5) ? [c.fr.L, c.fr.R] : [c.fr.R, c.fr.L])];
  for (const side of walls) {
    const [s0, s1] = wallSpan(c.a, side);
    const len = s1 - s0 - 2 * CORNER;
    if (len < 1.2) continue;
    const w = r3(Math.min(len, c.rng.range(1.6, 2.4)));
    // candidate centres along the wall: the middle first, then quarter points (posters spread out on the same wall)
    const frac = [0.5, 0.3, 0.7, 0.2, 0.8];
    for (const f of frac) {
      const t = s0 + CORNER + w / 2 + (len - w) * f;
      const top = bandTop(c, side, t - w / 2, t + w / 2);
      const bottom = Math.max(c.base + 1.6, top + 0.1);
      const h = Math.min(1.2, c.ceil - 0.2 - bottom);
      if (h < 0.7) continue;
      const ad = wallRecord(c, 'poster', side, t, w, r3(h), bottom);
      if (ad) { c.placed.push(ad); return true; }
    }
  }
  return false;
}

/** Places the shops' ad / merchandising records into layout.mall.ads (call after the shop interiors, absolute prop heights). */
export function placeMallAds(layout: StationLayout, rng: Rng): MallAdsReport {
  const ads: MallAd[] = [];
  const mall = layout.mall;
  if (!mall) return {ads: 0, byKind: {}, byProgram: {}};
  (mall as {ads?: MallAd[]}).ads = ads;
  // props per storey, bucketed by area for the cheap per-shop pick
  for (const shop of mall.shops) {
    const fit = shopFit(shop);
    const a = layout.areas[shop.area];
    if (!fit || !a) continue;
    if (fit.kind === 'service' || fit.kind === 'kiosk') continue;
    const level = areaLevel(a), base = areaBase(layout, a);
    const side = frontageSide(a, shop);
    const fs = side === 'N' || side === 'S' ? Math.min(shop.frontage.x0, shop.frontage.x1) : Math.min(shop.frontage.z0, shop.frontage.z1);
    const fr = frameOf(a, side, fit.entry, fs);
    const x0 = a.x * CELL - 1, x1 = (a.x + a.w) * CELL + 1, z0 = a.y * CELL - 1, z1 = (a.y + a.h) * CELL + 1;
    const props = layout.props.filter(p => (p.level ?? 0) === level && (p.area === a.id || (p.x + p.hx > x0 && p.x - p.hx < x1 && p.z + p.hz > z0 && p.z - p.hz < z1)));
    const c: ShopCtx = {layout, shop, program: fit.program, a, level, base, ceil: a.ceil, fr, props, placed: [], rng: rng.fork(`ad:${shop.id}`)};
    if (fit.kind === 'vacant') {
      if (c.rng.chance(VACANT_DECAL_CHANCE)) decals(c, 1);
    } else if (FASHION.has(fit.program)) {
      decals(c, c.rng.chance(0.6) ? 2 : 1);
      lightbox(c);
      if (fit.program === 'department' || fit.kind === 'anchor') lightbox(c);
      poster(c);
      if (fit.kind === 'anchor' || shop.salesArea >= BIG_UNIT_M2) poster(c);
    } else {
      if (c.rng.chance(DECAL_CHANCE)) decals(c, 1);
      poster(c);
      if (fit.kind === 'anchor' || shop.salesArea >= BIG_UNIT_M2) poster(c);
    }
    ads.push(...c.placed);
  }
  const byKind: MallAdsReport['byKind'] = {}, byProgram: MallAdsReport['byProgram'] = {};
  for (const ad of ads) { byKind[ad.kind] = (byKind[ad.kind] ?? 0) + 1; byProgram[ad.program] = (byProgram[ad.program] ?? 0) + 1; }
  return {ads: ads.length, byKind, byProgram};
}
