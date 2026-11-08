// Storefront bays built INTO hall walls (iteration 04), pure data (no three.js).
//
// Research (reference/tasks/vertical-slice-iteration04-20261026/research/REFERENCES.md): food-court
// and passage retail in North American stations/underground cities is a run of recessed units
// along the perimeter walls, 4–7 m frontages separated by ~0.5 m piers, each with a sign band
// (fascia) above a 2.4–2.8 m opening, food units open over a 1.05 m counter with backlit menu
// boards over the back counter, retail units glazed from a low plinth with mullions every ~1.2 m,
// rear service doors into a service corridor, and (abandoned) many units behind roll-down slat
// shutters or rod grilles, some stuck part-way, some behind "space available" hoardings.
//
// This module: (1) carves units along hall walls (`carveStorefronts`), (2) dresses each unit from
// modular blocks — counter / display case / back counter / cooler holders, shelving, glazing and
// shutter blockers (`dressStorefront`), (3) emits the architectural building blocks of every
// storefront as world-space boxes + sign/menu faces for the renderer (`storefrontParts`), and
// (4) procedural shapes for the four furniture holders when no generated model exists.

import type {Rng} from '../core/rng';
import {CELL} from './grid';
import {
  PROP_DEFS, PURPOSE_PROP_KINDS, SHOP_BACKBAR_Y, SHOP_COOLER_TIER_Y, SHOP_COUNTER_TOP_Y, SHOP_DISPLAY_CASE, SHOP_DISPLAY_TRAY_Y,
  type PropKind, type PropPlacement,
} from './props';
import {STORE_PURPOSES, storeChoices, type FrontageMix, type PropRule, type StorePurpose} from './purposes';
import {stockVariant} from './purposeShapes';
import type {Kit} from './stationKit';
import type {Area, Rect, ShopUse, ShutterState, Side, StationLayout, Storefront} from './stationTypes';

// ---------------------------------------------------------------------------------------
// Catalogue: the store purposes of gen/purposes.ts (names, colours, sizes, layout recipe, menus,
// loot). Iteration 05 (Lane R): a unit's name, sign, menu, fixtures and stock all come from ONE
// purpose, so "Corner Mart" has aisles + coolers + snacks and "Volt Mobile" has device displays.

export type {FrontageMix};
/** Back-compat view (iteration 04 name): store purposes by use. */
export const SHOP_USES: Readonly<Record<ShopUse, StorePurpose>> = STORE_PURPOSES;
const FOOD_USES: ShopUse[] = Object.values(STORE_PURPOSES).filter(p => p.category === 'food' && (p.mixes.food ?? 0) > 0).map(p => p.id);

export interface Frontage {
  hall: Area;
  sides: Side[];
  mix: FrontageMix;
  /** Max units on this frontage. */
  max: number;
  /** Side whose units share a service corridor behind them (uniform depth). */
  service?: Side;
}

const SHUTTER_ODDS: Record<FrontageMix, [ShutterState, number][]> = {
  food: [['open', 0.56], ['partial', 0.2], ['closed', 0.24]],
  retail: [['open', 0.46], ['partial', 0.24], ['closed', 0.3]],
  kiosk: [['open', 0.55], ['partial', 0.2], ['closed', 0.25]],
};

// ---------------------------------------------------------------------------------------
// Carving

interface WallRun { side: Side; row: number; t0: number; t1: number }

function wallRun(h: Rect, side: Side): WallRun {
  if (side === 'S') return {side, row: h.y + h.h, t0: h.x, t1: h.x + h.w};
  if (side === 'N') return {side, row: h.y - 1, t0: h.x, t1: h.x + h.w};
  if (side === 'E') return {side, row: h.x + h.w, t0: h.y, t1: h.y + h.h};
  return {side, row: h.x - 1, t0: h.y, t1: h.y + h.h};
}

function unitRect(run: WallRun, c: number, w: number, d: number): Rect {
  if (run.side === 'S') return {x: c, y: run.row + 1, w, h: d};
  if (run.side === 'N') return {x: c, y: run.row - d, w, h: d};
  if (run.side === 'E') return {x: run.row + 1, y: c, w: d, h: w};
  return {x: run.row - d, y: c, w: d, h: w};
}

function gapRect(run: WallRun, c: number, w: number): Rect {
  return run.side === 'S' || run.side === 'N' ? {x: c, y: run.row, w, h: 1} : {x: run.row, y: c, w: 1, h: w};
}

/** Back wall row/col of a unit carved at depth d and the corridor rect behind a run. */
function behind(run: WallRun, a0: number, a1: number, d: number, cw: number): Rect {
  const len = a1 - a0;
  if (run.side === 'S') return {x: a0, y: run.row + d + 2, w: len, h: cw};
  if (run.side === 'N') return {x: a0, y: run.row - d - 1 - cw, w: len, h: cw};
  if (run.side === 'E') return {x: run.row + d + 2, y: a0, w: cw, h: len};
  return {x: run.row - d - 1 - cw, y: a0, w: cw, h: len};
}

export interface CarveResult { storefronts: Storefront[]; corridors: Area[] }

export function carveStorefronts(k: Kit, fronts: Frontage[], usedNames: Set<string>, streets: readonly string[]): CarveResult {
  const rng = k.rng;
  const out: Storefront[] = [];
  const corridors: Area[] = [];
  const g = k.g;
  const foodUsed = new Set<ShopUse>();
  // Variety ("deck"): a store purpose repeats only once every purpose allowed on that frontage has
  // been used as often; purpose weights decide among the least-used ones.
  const useCount = new Map<ShopUse, number>();
  const leastUsed = (rows: [ShopUse, number][]): ShopUse => {
    const min = Math.min(...rows.map(([u]) => useCount.get(u) ?? 0));
    return rng.weighted(rows.filter(([u]) => (useCount.get(u) ?? 0) === min));
  };
  const choose = (mix: FrontageMix): ShopUse => leastUsed(storeChoices(mix));
  const pickName = (use: ShopUse): string => {
    const free = SHOP_USES[use].names.filter(n => !usedNames.has(n));
    const name = free.length ? rng.pick(free) : `${rng.pick(streets)} ${SHOP_USES[use].names[0].split(' ').slice(-1)[0]}`;
    usedNames.add(name);
    return name;
  };
  for (const f of fronts) {
    const H = f.hall;
    let count = 0;
    let enterableFood = 0;
    for (const side of f.sides) {
      if (count >= f.max) break;
      const run = wallRun(H, side);
      const isService = f.service === side;
      // Doors already in this wall (and their surroundings) stay clear.
      const blocked = new Uint8Array(run.t1 - run.t0 + 6);
      for (let t = run.t0; t < run.t1; t++) {
        const [x, y] = side === 'S' || side === 'N' ? [t, run.row] : [run.row, t];
        if (g.get(x, y) !== 0) for (let q = t - 2; q <= t + 2; q++) if (q >= run.t0 && q < run.t1) blocked[q - run.t0] = 1;
      }
      const runDepth = f.mix === 'food' ? rng.int(8, 11) : 0;
      // One datum per wall run (research R15/R21: continuous bulkhead / sign-band line).
      const runCeil = Math.round(rng.range(3.0, 3.3) * 20) / 20;
      const runHead = Math.round(Math.min(runCeil - 0.25, rng.range(2.5, 2.8)) * 20) / 20;
      const runFascia = Math.round(Math.min(H.ceil - 0.15, runHead + rng.range(0.55, 0.8)) * 20) / 20;
      const sideUnits: {sf: Storefront; unit: Area | null; c: number; w: number; d: number}[] = [];
      let t = run.t0 + 1 + rng.int(0, 3);
      while (t < run.t1 - 1 && count < f.max) {
        if (blocked[t - run.t0]) { t++; continue; }
        let free = 0;
        while (t + free < run.t1 - 1 && !blocked[t + free - run.t0]) free++;
        // Use for this bay.
        let use: ShopUse;
        if (f.mix === 'food') {
          const opts = FOOD_USES.filter(u => !foodUsed.has(u));
          use = rng.pick(opts.length ? opts : FOOD_USES);
        } else use = choose(f.mix);
        const info = SHOP_USES[use];
        const minW = f.mix === 'kiosk' ? Math.min(5, info.w[0]) : info.w[0];
        if (free < minW) {
          // Try a smaller use before skipping the stretch.
          if (free >= 5 && f.mix !== 'food') use = leastUsed((['newsstand', 'keys', 'florist', 'phone', 'hotdog'] as ShopUse[]).map(u => [u, 1] as [ShopUse, number]));
          else { t += Math.max(1, free); continue; }
        }
        const info2 = SHOP_USES[use];
        let w = Math.min(free, rng.int(info2.w[0], info2.w[1]));
        if (f.mix === 'kiosk') w = Math.min(w, 9);
        if (w < 5) { t += Math.max(1, free); continue; }
        let d = runDepth || rng.int(info2.d[0], info2.d[1]);
        if (f.mix === 'kiosk') d = Math.min(d, rng.int(5, 8));
        let rect = unitRect(run, t, w, d);
        const isFood = info2.category === 'food';
        const minD = isFood ? 7 : 5;
        while (!k.rectFree(rect) && d - 2 >= minD) { d -= 2; rect = unitRect(run, t, w, d); }
        const gap = gapRect(run, t, w);
        if (!k.rectFree(rect) || !k.solid(gap)) { t += 2; continue; }
        // Shutter state (abandoned station: plenty shut). Keep at least three food counters enterable.
        let shutter = rng.weighted(SHUTTER_ODDS[f.mix]);
        if (f.mix === 'food' && shutter === 'closed' && enterableFood < 3) shutter = rng.chance(0.75) ? 'open' : 'partial';
        const interior = shutter !== 'closed' || isService;
        const unitCeil = runCeil, head = runHead, fasciaTop = runFascia;
        const glazed = info2.glazed && w >= 6;
        const entryW = Math.min(w - 2, rng.int(2, 3));
        const e0 = !glazed ? 0 : rng.chance(0.5) ? 1 : rng.chance(0.5) ? w - 1 - entryW : Math.floor((w - entryW) / 2);
        const sf: Storefront = {
          id: out.length, hall: H.id, side, unit: -1,
          ox: gap.x, oy: gap.y, ow: gap.w, oh: gap.h,
          ux: rect.x, uy: rect.y, uw: rect.w, uh: rect.h,
          use, food: isFood, name: pickName(use), shutter,
          head, shutterY: shutter === 'partial' ? Math.round(rng.range(1.95, 2.2) * 20) / 20 : head,
          fasciaTop,
          sign: shutter === 'open' ? rng.weighted([['lit', 0.6], ['dim', 0.25], ['dead', 0.15]] as const) : shutter === 'partial' ? rng.weighted([['dim', 0.5], ['dead', 0.5]] as const) : rng.weighted([['dim', 0.3], ['dead', 0.7]] as const),
          glazed, entry: glazed ? [e0, e0 + entryW] : [0, w],
          color: rng.pick(info2.colors), backDoor: -1,
          style: shutter === 'closed' ? (interior ? (rng.chance(0.5) ? 'grille' : 'slat') : (rng.chance(0.25) ? 'hoarding' : 'slat')) : 'slat',
        };
        let unit: Area | null = null;
        if (interior) {
          unit = k.addArea(rect, 'room', isFood ? 'eatery' : 'shop', unitCeil, H.id, {label: sf.name, publicSpace: true, paid: H.paid});
          unit.storefront = sf.id;
          unit.purpose = use;
          sf.unit = unit.id;
          k.carveDoor(gap, H, unit, sf.shutter === 'partial' ? sf.shutterY : head, false, {shopfront: true});
        }
        // The storefront's wall slice and its piers stay intact (no later doors through them).
        k.reserve(run.side === 'S' || run.side === 'N' ? {x: gap.x - 1, y: gap.y, w: gap.w + 2, h: 1} : {x: gap.x, y: gap.y - 1, w: 1, h: gap.h + 2});
        if (isFood) { foodUsed.add(use); if (shutter !== 'closed') enterableFood++; }
        useCount.set(use, (useCount.get(use) ?? 0) + 1);
        out.push(sf);
        sideUnits.push({sf, unit, c: t, w, d});
        count++;
        t += w + 1;
      }
      // Service corridor behind a uniform-depth run, with back doors into the units.
      if (isService && sideUnits.length) {
        let C: Area | null = null;
        // Whole run first, then shorter stretches (something else may sit behind part of it).
        const spans: [number, number][] = [[0, sideUnits.length]];
        for (let n = sideUnits.length - 1; n >= 2; n--) for (let i = 0; i + n <= sideUnits.length; i++) spans.push([i, i + n]);
        for (const [i0, i1] of spans) {
          const a0 = sideUnits[i0].c - 1, a1 = sideUnits[i1 - 1].c + sideUnits[i1 - 1].w + 1;
          for (const shrink of [0, 1]) {
            const r = behind(run, a0 + shrink, a1 - shrink, runDepth, 6);
            if (k.rectFree(r)) { C = k.addArea(r, 'service', 'service-corridor', 2.8, sideUnits[i0].unit?.id ?? H.id, {label: `${H.label} service corridor`}); break; }
          }
          if (C) break;
        }
        if (C) {
          k.wing.set(C.id, 'food');
          corridors.push(C);
          const withUnit = sideUnits.filter(s => s.unit && s.d === runDepth);
          const backDoor = (s: (typeof withUnit)[number]) => {
            const door = k.connect(C!, s.unit!, 3, 2.3, {arch: false, pick: rng.chance(0.5) ? 0.15 : 0.85, extra: {staff: true}});
            if (door) s.sf.backDoor = door.id;
            return !!door;
          };
          // Shuttered units are reached from the back; open ones often have a back door too.
          for (const s of withUnit) if (s.sf.shutter === 'closed' || rng.chance(0.55)) backDoor(s);
          // The corridor needs a public way in: one enterable unit with a back door.
          if (!withUnit.some(s => s.sf.shutter !== 'closed' && s.sf.backDoor >= 0)) {
            const cand = withUnit.find(s => s.sf.shutter !== 'closed' && s.sf.backDoor < 0 && backDoor(s));
            if (!cand) { const s = withUnit.find(q => q.sf.backDoor >= 0); if (s) reopen(k, s.sf, rng); }
          }
        }
        // Closed units that could not get a back door stay reachable: shutter stuck part-way.
        for (const s of sideUnits) if (s.unit && s.sf.shutter === 'closed' && s.sf.backDoor < 0) reopen(k, s.sf, rng);
      }
    }
  }
  return {storefronts: out, corridors};
}

/** Turns a closed unit with an interior into a partially shuttered one (lowered door lintel). */
function reopen(k: Kit, sf: Storefront, rng: Rng): void {
  sf.shutter = 'partial';
  sf.shutterY = Math.round(rng.range(1.95, 2.2) * 20) / 20;
  sf.style = sf.style === 'hoarding' ? 'slat' : sf.style;
  const d = k.doors.find(q => q.shopfront && q.b === sf.unit);
  if (!d) return;
  d.height = sf.shutterY;
  for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) k.g.ceil[k.g.idx(x, y)] = sf.shutterY;
}

// ---------------------------------------------------------------------------------------
// Unit frame: `a` runs along the hall wall (world X for N/S walls, world Z for E/W walls),
// `n` is the distance from the hall-side wall surface toward the hall (negative = into the unit).

export interface ShopFrame {
  alongX: boolean;
  /** World coordinate of the hall-side wall surface on the normal axis, and the normal sign. */
  wall: number;
  sign: number;
  /** Opening span along the wall (world m). */
  a0: number; a1: number;
  /** Unit depth (m) behind the opening row. */
  depth: number;
  /** Yaw that makes a prop's local +Z face the hall. */
  faceRot: number;
}

export function shopFrame(sf: Storefront): ShopFrame {
  const alongX = sf.side === 'N' || sf.side === 'S';
  const a0 = (alongX ? sf.ox : sf.oy) * CELL, a1 = a0 + (alongX ? sf.ow : sf.oh) * CELL;
  const depth = (alongX ? sf.uh : sf.uw) * CELL;
  switch (sf.side) {
    case 'S': return {alongX, wall: sf.oy * CELL, sign: -1, a0, a1, depth, faceRot: Math.PI};
    case 'N': return {alongX, wall: (sf.oy + 1) * CELL, sign: 1, a0, a1, depth, faceRot: 0};
    case 'E': return {alongX, wall: sf.ox * CELL, sign: -1, a0, a1, depth, faceRot: -Math.PI / 2};
    default: return {alongX, wall: (sf.ox + 1) * CELL, sign: 1, a0, a1, depth, faceRot: Math.PI / 2};
  }
}

/** World XZ of a point `a` along the wall, `n` toward the hall. */
export function frameXZ(fr: ShopFrame, a: number, n: number): [number, number] {
  const c = fr.wall + fr.sign * n;
  return fr.alongX ? [a, c] : [c, a];
}

/** Interior point: u metres from the opening's start along the wall, v metres deep behind the opening row. */
function interiorXZ(fr: ShopFrame, u: number, v: number): [number, number] {
  return frameXZ(fr, fr.a0 + u, -CELL - v);
}

/** Yaw facing +u (along the wall, increasing a). */
function rotPlusU(fr: ShopFrame): number { return fr.alongX ? Math.PI / 2 : 0; }

// ---------------------------------------------------------------------------------------
// Dressing (unit interiors from modular blocks)

export interface ShopDressApi {
  rng: Rng;
  /** front: clear access strip (m); ring: walkway kept clear around an island (m). */
  place(area: Area, kind: PropKind, x: number, z: number, rot: number, opts?: {variant?: number; front?: number; ring?: number}): PropPlacement | null;
  /** Collision-only blocker placed regardless of door zones (glazing, shutter). */
  force(area: Area, kind: PropKind, x: number, z: number, hx: number, hz: number, h: number, blocksSight: boolean): PropPlacement;
  light(area: Area, x: number, z: number, rot: number, breakChance: number): void;
}

const q4 = (v: number) => Math.round(v * 1000) / 1000;
/** Width of the cell-aligned slot a module of width w occupies (placement footprints shrink 4 cm per side). */
const slot = (w: number) => Math.ceil((w - 0.08) / CELL) * CELL;

/**
 * Dresses one storefront unit from its PURPOSE (gen/purposes.ts STORE_PURPOSES): the layout
 * recipe decides where fixtures stand (counter run across the front with a staff gap, kitchen
 * line / shelving / coolers along the back wall, side-wall bays, centre islands with walkways),
 * the purpose decides WHICH fixtures (kitchen line per cuisine, stock theme, extras) and, via
 * items/loot.ts, what is on them.
 */
export function dressStorefront(api: ShopDressApi, layout: StationLayout, sf: Storefront): void {
  if (sf.unit < 0) return;
  const unit = layout.areas[sf.unit];
  const P = STORE_PURPOSES[sf.use];
  unit.purpose = P.id;
  const fr = shopFrame(sf);
  const rng = api.rng;
  const W = fr.a1 - fr.a0, D = fr.depth;
  const tagged = (p: PropPlacement | null) => { if (p) p.shop = sf.id; return p; };
  const put = (kind: PropKind, u: number, v: number, rot: number, variant = 0, o: {front?: number; ring?: number} = {}) => {
    const [x, z] = interiorXZ(fr, u, v);
    return tagged(api.place(unit, kind, q4(x), q4(z), rot, {variant, ...o}));
  };
  const face = fr.faceRot, plusU = rotPlusU(fr), minusU = plusU + Math.PI;
  // Shopfront blockers in the opening row: glazing beside the entry, or a rolled-down shutter.
  if (sf.shutter === 'closed') {
    const [x, z] = frameXZ(fr, (fr.a0 + fr.a1) / 2, -0.25);
    const half = W / 2;
    tagged(api.force(unit, 'shopShutter', q4(x), q4(z), fr.alongX ? half : 0.06, fr.alongX ? 0.06 : half, sf.head, sf.style !== 'grille'));
  } else if (sf.glazed) {
    const cells = Math.round(W / CELL);
    const spans: [number, number][] = [];
    if (sf.entry[0] > 0) spans.push([0, sf.entry[0]]);
    if (sf.entry[1] < cells) spans.push([sf.entry[1], cells]);
    for (const [s0, s1] of spans) {
      const [x, z] = frameXZ(fr, fr.a0 + (s0 + s1) / 2 * CELL, -0.25);
      const half = (s1 - s0) * CELL / 2;
      tagged(api.force(unit, 'shopGlazing', q4(x), q4(z), fr.alongX ? half : 0.06, fr.alongX ? 0.06 : half, sf.head, false));
    }
  }
  // (task studio-skyways-destinations-20261106-170011-01) a Skyways destination anchor: its own dresser furnishes the interior
  // (task studio-skywalk-encounters-20261108-074144-01, lane STORES: + a Skyways Mall store family, layout version >= 5 — the Mall
  // programme's own recipe furnishes it: gen/skyways/skywaysMallStores.ts)
  if (sf.anchor || sf.mall) return;
  const themeV = P.stock ? stockVariant(P.stock) : 0;
  const variantOf = (r: PropRule) => (r.variant === 'stock' ? themeV : r.variant ?? 0);
  const cw = PROP_DEFS.shopCounter.w;
  /** Counter run across the front with a 1 m+ access gap at one end; returns the gap side. */
  const counterRun = (front: number, maxSeg: number, displayP: number): boolean => {
    // Modules sit in cell-aligned slots so neighbours never share a grid cell (contiguous run).
    const sw = slot(cw);
    const n = Math.max(1, Math.min(maxSeg, Math.floor((W - 1.0) / sw)));
    const gapLeft = rng.chance(0.5);
    const u0 = gapLeft ? W - n * sw : 0;
    let displays = 0;
    for (let i = 0; i < n; i++) {
      // Display cases (deli / donut / pizza by the slice …) take one or two of the modules.
      const disp = displays < 2 && n > 1 && rng.chance(displayP);
      const kind: PropKind = disp ? 'shopDisplay' : 'shopCounter';
      if (put(kind, u0 + sw * (i + 0.5), front + PROP_DEFS[kind].d / 2, face, i) && disp) displays++;
    }
    return gapLeft;
  };
  /**
   * Modules side by side along the back wall (cycling `mods`), sliding past a rear door or
   * fixtures already there; returns how many fit.
   */
  const backLine = (fromU: number, toU: number, mods: readonly (readonly [PropKind, number])[], max = 99): number => {
    let n = 0, k = 0;
    for (let u = Math.ceil(fromU / CELL - 1e-6) * CELL; n < max;) {
      const [kind, variant] = mods[k % mods.length];
      const def = PROP_DEFS[kind];
      const sw = slot(def.w);
      if (u + sw > toU + 0.1) break;
      if (put(kind, u + sw / 2, D - 0.03 - def.d / 2, face, variant, {front: 0.8})) { n++; k++; u += sw; } else u += CELL;
    }
    return n;
  };
  const backRow = (fromU: number, toU: number, kind: PropKind, variant = 0) => backLine(fromU, toU, [[kind, variant]]);
  /** Modules along a side wall (L: u = 0, R: u = W), facing into the unit, between depths v0..v1. */
  const sideRow = (side: 'L' | 'R', kind: PropKind, variant: number, v0: number, v1: number, max = 99, front = 0.8): number => {
    const def = PROP_DEFS[kind], sw = slot(def.w);
    let n = 0;
    for (let v = Math.ceil(v0 / CELL - 1e-6) * CELL; v + sw <= v1 + 1e-6 && n < max; v += CELL) {
      const u = side === 'L' ? 0.03 + def.d / 2 : W - 0.03 - def.d / 2;
      if (put(kind, u, v + sw / 2, side === 'L' ? plusU : minusU, variant, {front})) { n++; v += sw - CELL; }
    }
    return n;
  };
  /** Purpose extras: far (back wall) or side walls (`avoid` = the counter's staff-gap side). */
  const extras = (which: 'far' | 'side', v0: number, v1: number, avoid?: 'L' | 'R') => {
    for (const r of P.extras ?? []) {
      const wall = r.wall ?? 'any';
      if (which === 'far' ? wall !== 'far' : wall === 'far') continue;
      if (r.chance !== undefined && !rng.chance(r.chance)) continue;
      const n = rng.int(r.n[0], r.n[1]);
      if (which === 'far') { backLine(0.08, W - 0.08, [[r.kind, variantOf(r)]], n); continue; }
      const sides: ('L' | 'R')[] = avoid ? [avoid === 'L' ? 'R' : 'L'] : rng.shuffle(['L', 'R'] as ('L' | 'R')[]);
      let left = n;
      for (const s of sides) left -= sideRow(s, r.kind, variantOf(r), v0, v1, left, r.front ?? 0.8);
    }
  };
  const lights = (n: number) => {
    for (let i = 0; i < n; i++) {
      const [x, z] = interiorXZ(fr, W * (i + 0.5) / n, D * 0.55);
      api.light(unit, x, z, fr.alongX ? 0 : Math.PI / 2, 0.25);
    }
  };
  const coolerPut = (atRight: boolean) => {
    const c = PROP_DEFS.shopCooler;
    return !!put('shopCooler', atRight ? W - 0.05 - c.w / 2 : 0.05 + c.w / 2, D - 0.03 - c.d / 2, face, 0, {front: 0.8});
  };

  switch (P.layout) {
    case 'food': {
      // Counter run (display cases per cuisine), cooler in a back corner, the cuisine's kitchen
      // line (grill / pizza oven / espresso bar / wok range / deli rail / blenders) on the back wall.
      const gapLeft = counterRun(0.56, 6, P.display ?? 0);
      const coolW = PROP_DEFS.shopCooler.w;
      const placed = rng.chance(P.cooler ?? 0) && W >= 3.2 && coolerPut(gapLeft);
      extras('far', 0, D);
      const bars = backLine(placed && !gapLeft ? 0.05 + coolW + 0.05 : 0.08, placed && gapLeft ? W - 0.1 - coolW : W - 0.08, P.kitchen ?? [['shopBackbar', 0]]);
      // Narrow units (or a rear door in the way): a cooler wherever it fits along the back wall,
      // else against a side wall at the back.
      if (!bars && !placed && !backRow(0.08, W - 0.08, 'shopCooler')) {
        const cd = PROP_DEFS.shopCooler.d, cwid = PROP_DEFS.shopCooler.w;
        if (!put('shopCooler', 0.03 + cd / 2, D - 0.05 - cwid / 2, plusU)) put('shopCooler', W - 0.03 - cd / 2, D - 0.05 - cwid / 2, minusU);
      }
      extras('side', 0.56 + 0.75 + 0.9, D - 0.75 - 0.5, gapLeft ? 'L' : 'R');
      lights(W > 5.2 ? 2 : 1);
      break;
    }
    case 'aisles': {
      // Checkout counter just inside beside the entry with an impulse rack; coolers (or the
      // purpose's stock) on the back wall; stock shelving on the side walls; back-to-back
      // gondolas down the middle with >= 1.1 m aisles.
      const entryMid = (sf.entry[0] + sf.entry[1]) / 2 * CELL;
      const left = entryMid > W / 2;
      const n = W >= 6 ? 2 : 1;
      const u0 = left ? Math.max(0.05, entryMid - 1.0 - n * cw) : Math.min(W - 0.05 - n * cw, entryMid + 1.0);
      for (let i = 0; i < n; i++) put('shopCounter', u0 + cw * (i + 0.5), 1.0 + PROP_DEFS.shopCounter.d / 2, face, i);
      if (P.loot.snackRack) put('snackRack', left ? u0 - 0.36 : u0 + n * cw + 0.36, 1.0 + PROP_DEFS.snackRack.d / 2, face);
      extras('far', 0, D);
      const coolerRow = rng.chance(P.cooler ?? 0);
      if (coolerRow) backRow(0.1, W - 0.1, 'shopCooler'); else backRow(0.1, W - 0.1, 'stockShelf', themeV);
      const backD = coolerRow ? PROP_DEFS.shopCooler.d : PROP_DEFS.stockShelf.d;
      const sd = PROP_DEFS.stockShelf, sw = slot(sd.w), AISLE = 1.0;
      let sides = 0;
      for (const sSide of ['L', 'R'] as const) sides += sideRow(sSide, 'stockShelf', themeV, 2.1, D - backD - 0.05) ? 1 : 0;
      // Back-to-back gondola runs in the free band between the till and the back wall, oriented
      // whichever way fits more shelving, with >= 1.1 m aisles all round.
      const gv = P.id === 'convenience' ? stockVariant('snacks') : themeV;
      const pairD = 2 * sd.d + 0.02;
      const uL = (sides ? sd.d + 0.03 : 0) + AISLE, uR = W - (sides ? sd.d + 0.03 : 0) - AISLE;
      const vF = 1.0 + PROP_DEFS.shopCounter.d + AISLE, vB = D - backD - 0.03 - AISLE;
      const fit = (span: number, unit: number) => Math.max(0, Math.floor((span + AISLE) / (unit + AISLE)));
      const rowsU = fit(vB - vF, pairD), slotsU = Math.floor((uR - uL) / sw);
      const linesV = fit(uR - uL, pairD), slotsV = Math.floor((vB - vF) / sw);
      if (rowsU * slotsU >= linesV * slotsV && rowsU * slotsU > 0) {
        // Runs parallel to the shopfront (shallow units): one face toward the entry, one toward the back.
        const u0 = uL + (uR - uL - slotsU * sw) / 2;
        // Aisles actually left in front of / behind a run whose back-to-back halves meet on grid
        // line B (each half owns its own cells): from the till's back and to the back wall's fronts.
        const front0 = 1.0 + PROP_DEFS.shopCounter.d, back1 = D - backD - 0.03;
        const aisles = (B: number, a: boolean, b: boolean): number => Math.min(B - (a ? sd.d + 0.01 : 0.01) - front0, back1 - (B + (b ? sd.d + 0.01 : 0.01)));
        const lines = (lo: number, hi: number) => { const out: number[] = []; for (let B = Math.ceil(lo / CELL) * CELL; B <= hi + 1e-6; B += CELL) out.push(B); return out; };
        for (let r = 0; r < rowsU; r++) {
          const ideal = rowsU === 1 ? (vF + vB) / 2 : vF + pairD / 2 + r * (vB - vF - pairD) / (rowsU - 1);
          const cands = lines(ideal - 0.5, ideal + 0.5);
          let B = cands.reduce((m, q) => (Math.abs(q - ideal) < Math.abs(m - ideal) ? q : m), cands[0]);
          let halves: [boolean, boolean] = [true, true];
          if (rowsU === 1) {
            // Best grid line for a pair; else a single-sided run (facing the entry) with >= 1 m both sides.
            const best = cands.map(q => ({q, h: [true, true] as [boolean, boolean], m: aisles(q, true, true)}))
              .concat(cands.flatMap(q => [{q, h: [true, false] as [boolean, boolean], m: aisles(q, true, false)}, {q, h: [false, true] as [boolean, boolean], m: aisles(q, false, true)}]))
              .sort((x, y) => (y.m >= 1.0 ? 1 : 0) - (x.m >= 1.0 ? 1 : 0) || Number(y.h[0] && y.h[1]) - Number(x.h[0] && x.h[1]) || y.m - x.m)[0];
            if (!best || best.m < 0.95) continue;
            B = best.q; halves = best.h;
          }
          for (let i = 0; i < slotsU; i++) {
            if (halves[0]) put('stockShelf', u0 + sw * (i + 0.5), B - sd.d / 2 - 0.01, face, gv);
            if (halves[1]) put('stockShelf', u0 + sw * (i + 0.5), B + sd.d / 2 + 0.01, halves[0] ? face + Math.PI : face, gv);
          }
        }
      } else if (linesV * slotsV > 0) {
        // Runs from front to back (deep units), lines spread across the width.
        const step = (uR - uL - pairD) / Math.max(1, linesV - 1);
        for (let k = 0; k < linesV; k++) {
          const cu = Math.round((linesV === 1 ? (uL + uR) / 2 : uL + pairD / 2 + k * step) / CELL) * CELL;
          const v0 = vF + (vB - vF - slotsV * sw) / 2;
          for (let i = 0; i < slotsV; i++) {
            put('stockShelf', cu - sd.d / 2 - 0.01, v0 + sw * (i + 0.5), minusU, gv);
            put('stockShelf', cu + sd.d / 2 + 0.01, v0 + sw * (i + 0.5), plusU, gv);
          }
        }
      }
      lights(W > 6 ? 3 : 2);
      break;
    }
    case 'newsstand': {
      // Counter across the front; magazine racks and snack shelving behind; a drinks cooler.
      const gapLeft = counterRun(0.56, 4, 0);
      const cooler = rng.chance(P.cooler ?? 0) && W >= 4 && coolerPut(!gapLeft);
      const cW = PROP_DEFS.shopCooler.w + 0.1;
      backLine(cooler && gapLeft ? 0.08 : cooler ? cW : 0.08, cooler && gapLeft ? W - cW : W - 0.08, rng.chance(0.5) ? [['magazineRack', 0], ['stockShelf', themeV]] : [['stockShelf', themeV], ['magazineRack', 0]]);
      const avoid = gapLeft ? 'L' : 'R';
      if (sideRow(avoid === 'L' ? 'R' : 'L', 'magazineRack', 0, 1.4, D - 0.5 - 0.9, 1) === 0) sideRow(avoid === 'L' ? 'R' : 'L', 'snackRack', 0, 1.4, D - 0.5 - 0.7, 1);
      lights(1);
      break;
    }
    case 'showroom': {
      // Electronics: till + glass showcases on the back wall, accessory walls on the side walls,
      // device tables down the middle with walkways all round.
      backLine(0.2, W - 0.2, rng.chance(0.5) ? [['showcase', 0], ['shopCounter', 0], ['showcase', 0]] : [['shopCounter', 0], ['showcase', 0]], W >= 5.5 ? 3 : 2);
      for (const s of ['L', 'R'] as const) sideRow(s, 'deviceWall', 0, 0.9, D - 0.75 - 1.1, 99, 0.9);
      const tl = PROP_DEFS.techDisplay.w;
      let islands = 0;
      for (let v = 1.2 + tl / 2; v + tl / 2 <= D - 0.75 - 1.1 && islands < 3; v += tl + 1.2) {
        if (put('techDisplay', W / 2, v, plusU, 0, {ring: 1.0})) islands++;
      }
      if (!islands) put('techDisplay', W / 2, Math.max(1.2 + tl / 2, (D - 0.75) / 2), plusU, 0, {ring: 0.9});
      lights(W > 5 ? 3 : 2);
      break;
    }
    case 'service': {
      // Phone repair / key cutting: a short counter, the work bench on the back wall, accessory
      // walls or stock shelving beside it.
      const gapLeft = counterRun(sf.glazed ? 1.0 : 0.56, 2, 0);
      extras('far', 0, D);
      backRow(0.08, W - 0.08, 'stockShelf', themeV);
      extras('side', (sf.glazed ? 1.0 : 0.56) + 0.75 + 0.9, D - 0.6 - 0.9, gapLeft ? 'L' : 'R');
      lights(1);
      break;
    }
    case 'florist': {
      // Buckets of flowers on stepped stands along the walls (and an island in bigger units).
      counterRun(sf.glazed ? 1.0 : 0.56, 1, 0);
      backRow(0.08, W - 0.08, 'flowerStand');
      for (const s of rng.shuffle(['L', 'R'] as ('L' | 'R')[])) sideRow(s, 'flowerStand', 0, 2.0, D - 0.7 - 0.9, 1, 0.9);
      if (W >= 5 && D >= 5.5) put('flowerStand', W / 2, D / 2 + 0.3, face, 0, {ring: 1.0});
      lights(1);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Architectural building blocks for rendering (world space)

/** Storefront material keys (lane contract; world/shapeMaterials.ts textures them). */
export type ShopMat =
  | 'shopFrame' | 'signBand' | 'menuBoard' | 'menuBoardNoodle' | 'menuBoardCoffee' | 'menuBoardPizza'
  | 'shutterSteel' | 'kitchenSteel' | 'laminate' | 'tileShop' | 'quarryTile'
  | 'woodVeneer' | 'plasticSeat' | 'glassShopfront' | 'grille' | 'black' | 'accent' | 'steelDark' | 'steelBright' | 'panel';

/** Lane C's face-mapped menu graphics per cuisine (world/shapeMaterials.ts): fallback only. */
export const MENU_MAT: Partial<Record<ShopUse, ShopMat>> = {
  burger: 'menuBoard', shawarma: 'menuBoard', deli: 'menuBoard', juice: 'menuBoard', hotdog: 'menuBoard',
  noodles: 'menuBoardNoodle', sushi: 'menuBoardNoodle',
  coffee: 'menuBoardCoffee', donut: 'menuBoardCoffee', bakery: 'menuBoardCoffee',
  pizza: 'menuBoardPizza',
};
/**
 * Iteration 05: per-purpose menu boards — `menuBoard:<use>` keys are drawn from the purpose's
 * MenuSpec (world/purposeTextures.ts), so a hot-dog stand shows hot dogs and a bakery bread.
 */
export type MenuKey = `menuBoard:${ShopUse}`;
export const menuKey = (use: ShopUse): MenuKey | ShopMat => (STORE_PURPOSES[use]?.menu ? `menuBoard:${use}` : MENU_MAT[use] ?? 'menuBoard');

/** Axis-aligned world box. tint: instance colour for `accent` parts (brand colour). */
export interface ShopBox { m: ShopMat | MenuKey; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; tint?: number }
/** Textured face (sign lettering, leasing hoarding) — centre, yaw of its normal, size. */
export interface ShopFace { kind: 'fascia' | 'hoarding'; sf: number; x: number; y: number; z: number; rot: number; w: number; h: number }

export function storefrontParts(layout: StationLayout, sf: Storefront, opts: {anchorSign?: boolean} = {}): {boxes: ShopBox[]; faces: ShopFace[]} {
  const fr = shopFrame(sf);
  // (task studio-alpha-skyways-shops-20261107-054512-01, user: "major-store signs face inward / reverse") an older station's Skyways anchor
  // record has its shop's own front wall as `side` (Storefront.outward absent), so its frame is mirrored into the shop. For the renderer
  // (opts.anchorSign) the SIGN BAND, its lettering and the bulkhead over it are drawn from the hall side's frame: they face the lobby.
  // The jambs / glazing stay where that station's collision is; the generator's own calls (no option) are unchanged.
  const flipSign = !!opts.anchorSign && !!sf.anchor && !sf.outward;
  const frS = flipSign ? shopFrame({...sf, side: ({N: 'S', S: 'N', E: 'W', W: 'E'} as const)[sf.side]}) : fr;
  const boxes: ShopBox[] = [];
  const faces: ShopFace[] = [];
  // task studio-skyways-level-20261106-054448-01: a bay on another storey (sf.baseY) — every height below is relative to its floor
  const by = sf.baseY ?? 0;
  const box = (m: ShopMat | MenuKey, a0: number, a1: number, y0: number, y1: number, n0: number, n1: number, tint?: number) => {
    const [p0, q0] = frameXZ(fr, a0, n0), [p1, q1] = frameXZ(fr, a1, n1);
    boxes.push({m, x0: Math.min(p0, p1), y0: y0 + by, z0: Math.min(q0, q1), x1: Math.max(p0, p1), y1: y1 + by, z1: Math.max(q0, q1), tint});
  };
  const face = (kind: ShopFace['kind'], a: number, y: number, n: number, w: number, h: number, F: ShopFrame = fr) => {
    const [x, z] = frameXZ(F, a, n);
    faces.push({kind, sf: sf.id, x, y: y + by, z, rot: F.faceRot, w, h});
  };
  const boxS = (m: ShopMat | MenuKey, a0: number, a1: number, y0: number, y1: number, n0: number, n1: number) => {
    const [p0, q0] = frameXZ(frS, a0, n0), [p1, q1] = frameXZ(frS, a1, n1);
    boxes.push({m, x0: Math.min(p0, p1), y0: y0 + by, z0: Math.min(q0, q1), x1: Math.max(p0, p1), y1: y1 + by, z1: Math.max(q0, q1)});
  };
  const {a0, a1} = fr;
  const W = a1 - a0, mid = (a0 + a1) / 2;
  const hall = layout.areas[sf.hall];
  const head = sf.head;
  // Pier cladding (half of the 0.5 m pier on each side), head frame and jambs.
  box('shopFrame', a0 - 0.25, a0, 0, sf.fasciaTop, 0, 0.025);
  box('shopFrame', a1, a1 + 0.25, 0, sf.fasciaTop, 0, 0.025);
  box('shopFrame', a0, a0 + 0.07, 0, head, -0.12, 0.035);
  box('shopFrame', a1 - 0.07, a1, 0, head, -0.12, 0.035);
  box('shopFrame', a0, a1, head - 0.08, head, -0.14, 0.035);
  // Sign band (fascia) across the frontage, lettering face, and the bulkhead above it in tall halls.
  boxS('signBand', a0 - 0.25, a1 + 0.25, head, sf.fasciaTop, 0, 0.16);
  boxS('black', a0 - 0.25, a1 + 0.25, head - 0.01, head + 0.012, 0.0, 0.165);
  if (sf.shutter !== 'closed' || sf.style !== 'hoarding') face('fascia', mid, (head + sf.fasciaTop) / 2, 0.163, Math.max(1, W - 0.1), Math.max(0.2, sf.fasciaTop - head - 0.1), frS);
  const hallCeil = hall.ceil - by; // (relative to the bay's floor)
  const bulkTop = Math.min(hallCeil - 0.02, sf.fasciaTop + (hallCeil > 4.2 ? 0.9 : 0.4));
  if (bulkTop > sf.fasciaTop + 0.05) boxS('shopFrame', a0 - 0.25, a1 + 0.25, sf.fasciaTop, bulkTop, 0, 0.06);

  const cells = Math.round(W / CELL);
  if (sf.shutter === 'closed') {
    if (sf.unit < 0) {
      // Facade-only: shutter (or leasing hoarding) on the wall face.
      if (sf.style === 'hoarding') {
        box('signBand', a0 + 0.04, a1 - 0.04, 0.02, head - 0.08, 0, 0.04);
        face('hoarding', mid, (head - 0.06) / 2, 0.042, W - 0.12, head - 0.14);
      } else {
        box('shutterSteel', a0 + 0.07, a1 - 0.07, 0.0, head - 0.08, 0, 0.05);
        box('shopFrame', a0 + 0.07, a1 - 0.07, 0.0, 0.06, 0, 0.07);
        box('black', mid - 0.08, mid + 0.08, 0.06, 0.16, 0.05, 0.08);
      }
    } else if (sf.style === 'grille') rodGrille(box, a0 + 0.07, a1 - 0.07, 0, head - 0.08, -0.28, -0.22);
    else {
      box('shutterSteel', a0 + 0.07, a1 - 0.07, 0, head - 0.08, -0.28, -0.22);
      box('shopFrame', a0 + 0.07, a1 - 0.07, 0, 0.06, -0.3, -0.2);
    }
  } else if (sf.shutter === 'partial') {
    // The grid lintel drops to the shutter's bottom edge, so the hall-side wall face starts there:
    // the stuck curtain hangs just proud of it, up into the sign band.
    box('shutterSteel', a0 + 0.07, a1 - 0.07, sf.shutterY, head, 0.004, 0.04);
    box('shopFrame', a0 + 0.07, a1 - 0.07, sf.shutterY - 0.03, sf.shutterY + 0.04, 0.0, 0.055);
    box('black', mid - 0.08, mid + 0.08, sf.shutterY - 0.05, sf.shutterY, 0.01, 0.05);
  }
  if (sf.glazed && sf.shutter !== 'closed') {
    // Glazed retail front: plinth, glass, mullions every ~1.2 m, transom; open entry.
    const spans: [number, number][] = [];
    if (sf.entry[0] > 0) spans.push([0, sf.entry[0]]);
    if (sf.entry[1] < cells) spans.push([sf.entry[1], cells]);
    const top = Math.min(head - 0.08, sf.shutter === 'partial' ? sf.shutterY - 0.03 : head - 0.08);
    for (const [s0, s1] of spans) {
      const g0 = a0 + s0 * CELL + (s0 === 0 ? 0.07 : 0), g1 = a0 + s1 * CELL - (s1 === cells ? 0.07 : 0);
      box('shopFrame', g0, g1, 0, 0.3, -0.3, -0.18);
      box('glassShopfront', g0, g1, 0.3, top, -0.255, -0.235);
      const n = Math.max(1, Math.round((g1 - g0) / 1.25));
      for (let i = 0; i <= n; i++) {
        const m = g0 + (g1 - g0) * i / n;
        box('shopFrame', m - 0.03, m + 0.03, 0.3, top, -0.28, -0.21);
      }
      box('shopFrame', g0, g1, top - 0.05, top, -0.28, -0.21);
    }
    // Entry door frame.
    const e0 = a0 + sf.entry[0] * CELL, e1 = a0 + sf.entry[1] * CELL;
    box('shopFrame', e0 - 0.04, e0 + 0.04, 0, Math.min(2.25, top), -0.3, -0.18);
    box('shopFrame', e1 - 0.04, e1 + 0.04, 0, Math.min(2.25, top), -0.3, -0.18);
    box('shopFrame', e0, e1, Math.min(2.25, top) - 0.06, Math.min(2.25, top), -0.3, -0.18);
  }
  if (sf.unit >= 0 && sf.food) {
    // Backlit menu boards on the back wall over the back counter, kept clear of the back door.
    const unit = layout.areas[sf.unit];
    const back = -CELL - fr.depth;
    // With a rear door the boards go above its lintel (2.3 m) instead of beside it.
    const bd = sf.backDoor >= 0 ? layout.doors[sf.backDoor] : null;
    const y0 = bd ? bd.height + 0.1 : 2.05, y1 = Math.min(y0 + 0.68, unit.ceil - by - 0.1);
    // Lane C's menus are designed for ~2:1 faces: panel width ≈ 2 × height.
    const n = Math.max(1, Math.min(4, Math.round((W - 0.5) / (2 * (y1 - y0)))));
    const pw = (W - 0.5 - (n - 1) * 0.06) / n;
    const mat = menuKey(sf.use);
    for (let i = 0; i < n; i++) {
      const p0 = a0 + 0.25 + i * (pw + 0.06), p1 = p0 + pw;
      box('shopFrame', p0 - 0.02, p1 + 0.02, y0 - 0.02, y1 + 0.02, back, back + 0.05);
      box(mat, p0, p1, y0, y1, back + 0.05, back + 0.065);
    }
    // Stainless backsplash / hood band over the back counter.
    // Iteration 07 (Lane DW): the panel stops at a rear door instead of boarding it across.
    const holes = backWallOpenings(layout, sf, fr, back);
    let from = a0 + 0.05;
    for (const [h0, h1] of [...holes, [a1, Infinity] as [number, number]]) {
      if (h0 - 0.05 - from > 0.1) box('kitchenSteel', from, Math.min(h0 - 0.05, a1 - 0.05), 0.95, 1.95, back, back + 0.015);
      from = Math.max(from, h1 + 0.05);
    }
  }
  return {boxes, faces};
}

/**
 * Iteration 07 (Lane DW): spans (along the frontage, world m, sorted) of the unit's doors that lie
 * in its back wall (rear service doors), so wall-wide parts stop at them.
 */
function backWallOpenings(layout: StationLayout, sf: Storefront, fr: ShopFrame, back: number): [number, number][] {
  const plane = fr.wall + fr.sign * back;
  const out: [number, number][] = [];
  for (const d of layout.doors) {
    if (d.shopfront || (d.a !== sf.unit && d.b !== sf.unit)) continue;
    const n0 = (fr.alongX ? d.y : d.x) * CELL, n1 = (fr.alongX ? d.y + d.h : d.x + d.w) * CELL;
    if (plane < n0 - 1e-6 || plane > n1 + 1e-6) continue;
    out.push(fr.alongX ? [d.x * CELL, (d.x + d.w) * CELL] : [d.y * CELL, (d.y + d.h) * CELL]);
  }
  return out.sort((p, q) => p[0] - q[0]);
}

function rodGrille(box: (m: ShopMat, a0: number, a1: number, y0: number, y1: number, n0: number, n1: number) => void, a0: number, a1: number, y0: number, y1: number, n0: number, n1: number): void {
  for (let y = y0 + 0.05; y < y1 - 0.02; y += 0.14) box('grille', a0, a1, y, y + 0.018, n0, n1);
  const n = Math.max(2, Math.round((a1 - a0) / 0.6));
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; box('grille', a - 0.012, a + 0.012, y0, y1, n0 - 0.01, n1 + 0.01); }
  box('shopFrame', a0, a1, y0, y0 + 0.05, n0 - 0.02, n1 + 0.02);
}

// ---------------------------------------------------------------------------------------
// Procedural furniture holders (used when no generated model exists). Local frame: origin bottom
// centre, front +Z, metres. `accent` takes the brand colour per instance.

export interface ShopShapePart { m: ShopMat; s: [number, number, number]; p: [number, number, number] }
const bx = (m: ShopMat, s: [number, number, number], p: [number, number, number]): ShopShapePart => ({m, s, p});

export function shopPropShape(kind: PropKind): ShopShapePart[] | null {
  switch (kind) {
    case 'shopCounter': {
      const {w, d} = PROP_DEFS.shopCounter;
      const top = SHOP_COUNTER_TOP_Y;
      return [
        bx('black', [w - 0.02, 0.12, d - 0.1], [0, 0.06, -0.02]),
        bx('accent', [w - 0.02, top - 0.16, 0.04], [0, 0.12 + (top - 0.16) / 2, d / 2 - 0.05]),
        bx('woodVeneer', [w - 0.02, top - 0.16, d - 0.14], [0, 0.12 + (top - 0.16) / 2, -0.02]),
        bx('laminate', [w, 0.04, d], [0, top - 0.02, 0]),
        bx('steelBright', [w - 0.02, 0.02, 0.03], [0, top - 0.05, d / 2 - 0.01]),
      ];
    }
    case 'shopDisplay': {
      // Procedural fallback of the counter + countertop display unit: case base = counter top.
      const {w, d, h} = PROP_DEFS.shopDisplay;
      const deck = SHOP_DISPLAY_CASE.baseY;
      return [
        bx('black', [w - 0.02, 0.12, d - 0.1], [0, 0.06, -0.02]),
        bx('accent', [w - 0.02, deck - 0.16, 0.04], [0, 0.12 + (deck - 0.16) / 2, d / 2 - 0.05]),
        bx('kitchenSteel', [w - 0.02, deck - 0.16, d - 0.14], [0, 0.12 + (deck - 0.16) / 2, -0.02]),
        bx('kitchenSteel', [w, 0.03, d], [0, deck - 0.015, 0]),
        // Glass case: sloped front approximated by a front pane + top, steel end cheeks.
        bx('glassShopfront', [w - 0.06, h - deck - 0.04, 0.012], [0, deck + (h - deck) / 2, d / 2 - 0.04]),
        bx('glassShopfront', [w - 0.06, 0.012, d - 0.1], [0, h - 0.02, -0.01]),
        bx('steelBright', [0.03, h - deck, d - 0.06], [-w / 2 + 0.015, deck + (h - deck) / 2, 0]),
        bx('steelBright', [0.03, h - deck, d - 0.06], [w / 2 - 0.015, deck + (h - deck) / 2, 0]),
        bx('signBand', [w - 0.08, 0.025, 0.05], [0, h - 0.05, -d / 2 + 0.06]),
        // Iteration 05: the two trays the loot stands on (SHOP_DISPLAY_SURFACES).
        ...SHOP_DISPLAY_TRAY_Y.map(y => bx('kitchenSteel', [Math.min(w, 1.04) - 0.04, 0.012, 0.48], [0, y - 0.006, -0.005])),
      ];
    }
    case 'shopBackbar': {
      const {w, d, h} = PROP_DEFS.shopBackbar;
      const [top, shelfY] = SHOP_BACKBAR_Y;
      const parts: ShopShapePart[] = [
        bx('kitchenSteel', [w - 0.02, top - 0.04, d - 0.04], [0, (top - 0.04) / 2, 0]),
        bx('black', [w - 0.06, 0.012, 0.01], [0, top * 0.55, d / 2 - 0.015]),
        bx('kitchenSteel', [w, 0.04, d], [0, top - 0.02, 0]),
        bx('kitchenSteel', [w, 0.03, 0.36], [0, shelfY - 0.015, -d / 2 + 0.18]),
        bx('steelDark', [0.04, h - top, 0.04], [-w / 2 + 0.03, top + (h - top) / 2, -d / 2 + 0.03]),
        bx('steelDark', [0.04, h - top, 0.04], [w / 2 - 0.03, top + (h - top) / 2, -d / 2 + 0.03]),
        bx('steelDark', [w, 0.03, 0.03], [0, h - 0.015, -d / 2 + 0.03]),
      ];
      return parts;
    }
    case 'shopCooler': {
      const {w, d, h} = PROP_DEFS.shopCooler;
      const parts: ShopShapePart[] = [
        bx('steelDark', [w, h, 0.04], [0, h / 2, -d / 2 + 0.02]),
        bx('steelDark', [0.04, h, d], [-w / 2 + 0.02, h / 2, 0]),
        bx('steelDark', [0.04, h, d], [w / 2 - 0.02, h / 2, 0]),
        bx('steelDark', [w, 0.16, d], [0, 0.08, 0]),
        bx('accent', [w, 0.2, d], [0, h - 0.1, 0]),
        bx('signBand', [w - 0.1, 0.12, 0.01], [0, h - 0.1, d / 2 + 0.002]),
        bx('panel', [w - 0.1, h - 0.4, 0.01], [0, h / 2, -d / 2 + 0.05]),
        bx('glassShopfront', [w - 0.08, h - 0.4, 0.012], [0, 0.18 + (h - 0.4) / 2, d / 2 - 0.02]),
        bx('steelBright', [0.025, 0.5, 0.04], [w / 2 - 0.1, 1.0, d / 2 + 0.01]),
      ];
      for (const y of SHOP_COOLER_TIER_Y) parts.push(bx('steelBright', [w - 0.1, 0.018, d - 0.14], [0, y - 0.009, -0.03]));
      return parts;
    }
    default: return null;
  }
}

/** Storefront furniture HOLDERS (counter / display case / back counter / cooler). */
export const SHOP_HOLDERS: readonly PropKind[] = ['shopCounter', 'shopDisplay', 'shopBackbar', 'shopCooler'];
/**
 * Every prop kind rendered by world/storefrontBuilder.ts (world/builder.ts skips these): the
 * storefront holders plus the iteration-05 purpose props (store fixtures, kitchen lines,
 * back-of-house furniture — wherever they stand).
 */
export const SHOP_FURNITURE: readonly PropKind[] = [...SHOP_HOLDERS, ...PURPOSE_PROP_KINDS];
export const SHOP_BLOCKERS: readonly PropKind[] = ['shopGlazing', 'shopShutter'];

/** Food court seating "rug": inlaid floor with a border band (research R13/R15). */
export function rugBoxes(x0: number, z0: number, x1: number, z1: number): ShopBox[] {
  const b = 0.5, y = 0.004;
  return [
    {m: 'quarryTile', x0: x0 + b, y0: 0, z0: z0 + b, x1: x1 - b, y1: y, z1: z1 - b},
    {m: 'tileShop', x0, y0: 0, z0, x1, y1: y * 0.75, z1: z0 + b},
    {m: 'tileShop', x0, y0: 0, z0: z1 - b, x1, y1: y * 0.75, z1},
    {m: 'tileShop', x0, y0: 0, z0: z0 + b, x1: x0 + b, y1: y * 0.75, z1: z1 - b},
    {m: 'tileShop', x0: x1 - b, y0: 0, z0: z0 + b, x1, y1: y * 0.75, z1: z1 - b},
  ];
}
