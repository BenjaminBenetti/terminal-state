// Task reactor-build-20261101 (lane GEN): carving of THE REACTOR into ONE Kit (rim station + 4 walkway tiers + the core floor), canvas
// cells, before the crop. Pure data (gen/reactor/index.ts crops, links, rails, dresses, populates, validates).
//
// Everything is laid out in the CANONICAL frame of gen/reactor/frame.ts (stair wall west, organ wall east, route-2 wall south, the
// station north) in pit-local cells (px, pz); the 'E' variants mirror x when stamping (cx / rectC).
//
// Order:
//  1. the rim station (one platform beside a single / double track bed along x, behind the pit's north rim wall; a small back of house);
//  2. the straight stair runs (wall switchbacks: two lanes zig-zagging down the stair wall; the route-2 flight set on the south wall),
//     each carved into both storeys' grids (open wells: the flights' bands are capped by the column stack below);
//  3. the decks per storey: the rim gallery (most of the mouth), the generator / stair landings, the south outer galleries, the north
//     b-half galleries, the organ-wall ladder terraces, the tower decks and the bridges; the core floor round the vessel;
//  4. the platform openings onto the rim gallery;
//  5. the rooms cut into the rock behind the decks (rim office, stores, switchgear, pump hall, control room, side rooms);
//  6. the COLUMN STACK: every open column's bands get their ceilings (pit air to the pit roof, capped one slab under the next deck up).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, VOID, rampHeight, type Grid} from '../grid';
import {Kit, type TrenchCells, TUN} from '../stationKit';
import {STAIR, layStairRun, type StairFlight, type StairSpec} from '../traversal';
import {SLAB} from '../levelGen';
import {TRENCH_DEPTH, type Area, type AreaKind, type AreaRole, type Rect, type RoomType} from '../stationTypes';
import type {ReactorDeck} from './reactorTypes';
import {BANK_CELLS, BED, CLEAR, CORE_LEVEL, GEN_LANDING, LANE, ORG, REACTOR_LEVELS, ROOM_MARGIN, TIERS, VESSEL, reactorStoreyLabel, type ReactorFrame} from './frame';
// task reactor-expansion-20261101 (lane HOST): the side-complex slots (planned before the rooms) and their canvas margin
import {COMPLEX_MARGIN, planComplexSlots, slotBlocks} from './complex/host';
import type {ComplexSlot} from './complex/types';

export type CellRect = Rect;
/** A pit wall in the canonical frame: 'stair' (west), 'organ' (east), 'N', 'S'. */
export type WallId = 'stair' | 'organ' | 'N' | 'S';

/** Ramp headroom of the open-air flights (the band is capped by the cell ceiling = the column stack). */
export const OPEN_HEADROOM = 40;
const OPEN_STAIR: StairSpec = {...STAIR, headroom: OPEN_HEADROOM};

export interface DeckRec { kind: ReactorDeck['kind']; level: number; area: number; rect: CellRect; y: number; wall?: WallId; label: string }
export interface RunRec { route: 'stairs' | 'bridge'; lower: number; area: number; rect: CellRect; axis: 'x' | 'z'; flights: number[]; lane: 'A' | 'B' }
export interface RoomRec {
  key: string; level: number; area: number; rect: CellRect; wall: WallId;
  /** Canonical along start / width / depth (cells). */
  a0: number; w: number; d: number;
  door: CellRect; doorA0: number; doorW: number;
}
export interface GenRec { zone: number; level: number; area: number; foot: CellRect; use: {px: number; pz: number; yaw: number} }
export interface TowerRec { line: number; px: number; pz: number; legs: [number, number][]; tiers: number[] }

export interface ReactorCarve {
  f: ReactorFrame;
  bases: number[];
  /** Canvas cell of the pit's NW corner, the pit size; the core crop (cells). */
  PX0: number; PZ0: number; PW: number; PD: number;
  coreW: number; coreH: number;
  /** Station: bed / platform canvas rects, the platform area, openings (door rects), back of house. */
  bed: CellRect;
  platform: Area;
  openings: CellRect[];
  stationBoh: number[];
  decks: DeckRec[];
  runs: RunRec[];
  rooms: RoomRec[];
  gens: GenRec[];
  towers: TowerRec[];
  /** Organ terraces (ladder decks) per storey (index = level): pz length from the south corner. */
  terraces: number[];
  /** Vessel cells (canvas = grid cells) on the core grid. */
  vessel: [number, number][];
  /** The core floor's sector areas. */
  coreAreas: number[];
  /** Task reactor-expansion-20261101 (lane HOST): the side-complex slots (canvas cells; gen/reactor/complex/host.ts). */
  slots: ComplexSlot[];
  /** Mirror: canonical px -> canvas x. */
  cx: (px: number) => number;
  rectC: (px: number, pz: number, w: number, h: number) => CellRect;
}

/** Why the last attempts failed (QA / tests). */
export const REACTOR_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { REACTOR_CARVE_FAILS[why] = (REACTOR_CARVE_FAILS[why] ?? 0) + 1; return null; };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Canvas size (cells) for a frame: the core crop + room east / south for Track2's growth. */
export function reactorCanvas(f: ReactorFrame): {W: number; H: number; coreW: number; coreH: number; PX0: number; PZ0: number; minPx: number; maxPx: number} {
  const bedRows = f.double ? BED.double : BED.single;
  const PZ0 = ORG + 3 + bedRows + f.Pd + 1;
  // task reactor-expansion-20261101 (lane HOST): rock for the side complexes beyond the stair / organ / south walls (COMPLEX_MARGIN)
  const M = Math.max(ROOM_MARGIN, COMPLEX_MARGIN);
  const minPx = Math.min(-M, -f.shift - TUN - 2), maxPx = Math.max(f.PW + M, -f.shift + f.Lp + TUN + 2);
  const PX0 = f.stairWall === 'W' ? ORG - minPx : ORG + maxPx - f.PW + 1;
  const coreW = ORG + (maxPx - minPx) + ORG + 1, coreH = PZ0 + f.PD + M + ORG;
  return {W: coreW + 150, H: coreH + 110, coreW, coreH, PX0, PZ0, minPx, maxPx};
}

/** Carves the whole reactor into a fresh kit (levels 0..CORE_LEVEL); null when the program does not fit (the caller re-rolls). */
export function carveReactor(k: Kit, rng: Rng, f: ReactorFrame): ReactorCarve | null {
  const {PW, PD, bases, roofY, R, u0, r0, gwR, gwN, gwS} = f;
  const cv = reactorCanvas(f);
  const {PX0, PZ0} = cv;
  const W = k.g.w;
  const mirror = f.stairWall === 'E';
  const cx = (px: number) => (mirror ? PX0 + PW - 1 - px : PX0 + px);
  const rectC = (px: number, pz: number, w: number, h: number): CellRect => ({x: mirror ? PX0 + PW - px - w : PX0 + px, y: PZ0 + pz, w, h});
  const grids = Array.from({length: REACTOR_LEVELS}, (_, i) => k.grid(i));
  /** Open-air cells (pit decks / runs / the core floor) per level: their bands rise to the pit roof (column stack). */
  const air = grids.map(() => new Uint8Array(W * k.g.h));
  /** Canonical pit cells kept SOLID on every level (organ bank, tower legs). */
  const reserved = new Uint8Array(PW * PD);
  const isRes = (px: number, pz: number) => px >= 0 && pz >= 0 && px < PW && pz < PD && reserved[pz * PW + px] === 1;

  // --- 1. The rim station ------------------------------------------------------------------------------------------------------
  const g0 = grids[0];
  const bedRows = f.double ? BED.double : BED.single;
  const zBed = ORG + 3, zPlat = zBed + bedRows;
  const plat0 = -f.shift;
  const bed = rectC(plat0 - TUN, zBed - PZ0, f.Lp + 2 * TUN, bedRows);
  for (let y = bed.y; y < bed.y + bed.h; y++) for (let x = bed.x; x < bed.x + bed.w; x++) {
    const i = g0.idx(x, y);
    g0.cells[i] = VOID; g0.ceil[i] = CLEAR.station; g0.floor[i] = -TRENCH_DEPTH;
  }
  g0.voidFloor = -TRENCH_DEPTH;
  const y1 = bed.y + bed.h;
  const pRect = rectC(plat0, zPlat - PZ0, f.Lp, f.Pd);
  const trench: TrenchCells = {
    x0: bed.x, x1: bed.x + bed.w, y0: bed.y, y1, px0: pRect.x, px1: pRect.x + pRect.w,
    tracks: f.double ? [y1 * CELL - 6.0, y1 * CELL - 2.0] : [y1 * CELL - 2.0], third: f.double ? [-1, -1] : [-1], columns: false, ceil: CLEAR.station,
  };
  k.trenches.push(trench);
  const platform = k.addArea(pRect, 'platform', 'platform', CLEAR.station, -1, {label: 'Platform'});
  platform.edge = 'N';
  platform.platformNo = 1;

  // --- helpers --------------------------------------------------------------------------------------------------------------------
  const levelOpt = (lv: number) => (lv ? {level: lv, floorY: bases[lv]} : {});
  /** A pit-air area stamped only on still-rock cells of `lv` (never reserved / runs / earlier decks); null when nothing was free. */
  const addPitArea = (lv: number, r: CellRect, label: string, role: AreaRole, y = bases[lv], kind: AreaKind = 'concourse', type: RoomType = 'concourse'): Area | null => {
    const g = grids[lv];
    const a: Area = {...r, id: k.areas.length, kind, type, label, ceil: r2(bases[lv] + CLEAR.hall), parent: -1, depth: 0, publicSpace: false, lighting: 'lit', role};
    if (lv) { a.level = lv; a.floorY = bases[lv]; }
    let n = 0;
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
      if (!g.inBounds(xx, yy)) continue;
      const px = mirror ? PX0 + PW - 1 - xx : xx - PX0, pz = yy - PZ0;
      if (px < 0 || pz < 0 || px >= PW || pz >= PD || isRes(px, pz)) continue;
      const i = g.idx(xx, yy);
      if (g.cells[i] !== SOLID) continue;
      g.cells[i] = FLOOR; g.area[i] = a.id; g.floor[i] = y; g.ceil[i] = roofY; air[lv][i] = 1;
      n++;
    }
    if (!n) return null;
    k.areas.push(a);
    return a;
  };
  const decks: DeckRec[] = [];
  const deck = (lv: number, kind: DeckRec['kind'], px: number, pz: number, w: number, h: number, label: string, role: AreaRole, wall?: WallId): DeckRec | null => {
    const x0 = Math.max(0, px), z0 = Math.max(0, pz), x1 = Math.min(PW, px + w), z1 = Math.min(PD, pz + h);
    if (x1 <= x0 || z1 <= z0) return null;
    const rect = rectC(x0, z0, x1 - x0, z1 - z0);
    const a = addPitArea(lv, rect, `${label} · ${reactorStoreyLabel(lv)}`, role);
    if (!a) return null;
    const d: DeckRec = {kind, level: lv, area: a.id, rect, y: bases[lv], label: a.label, ...(wall ? {wall} : {})};
    decks.push(d);
    return d;
  };

  // --- Reserved columns: the organ bank(s) and the tower legs (SOLID on every storey, core floor to the roof) ----------------------
  for (const [b0, b1] of f.banks) for (let pz = b0; pz < b1; pz++) for (let px = PW - BANK_CELLS; px < PW; px++) reserved[pz * PW + px] = 1;
  const towers: TowerRec[] = f.lines.map((l, li) => {
    const tx = l.px - 3, tz = l.tz;
    const legs: [number, number][] = [[tx, tz], [tx + 9, tz], [tx, tz + 9], [tx + 9, tz + 9]];
    // task reactor-expansion-20261101 (lane PATHS): a leg stands on its corner POINT (the deck's outer corner): reserve the 2 x 2 cells
    // round it, so the leg, its foot plate and the bracing never stand in the core floor's / a deck's walkable cells
    for (const [lx, lz] of legs) {
      const ox = lx === tx ? -1 : 1, oz = lz === tz ? -1 : 1;
      for (const [ax, az] of [[0, 0], [ox, 0], [0, oz], [ox, oz]]) { const qx = lx + ax, qz = lz + az; if (qx >= 0 && qz >= 0 && qx < PW && qz < PD) reserved[qz * PW + qx] = 1; }
    }
    return {line: li, px: tx, pz: tz, legs, tiers: l.tiers};
  });

  // --- 2. Stair runs ------------------------------------------------------------------------------------------------------------
  const runs: RunRec[] = [];
  const carveRun = (route: RunRec['route'], lower: number, rect: CellRect, axis: 'x' | 'z', from: 'lo' | 'hi', lane: 'A' | 'B'): RunRec => {
    const hi = lower + 1;
    const label = `${route === 'stairs' ? 'Wall stairs' : 'South stairs'} · ${reactorStoreyLabel(lower)} – ${reactorStoreyLabel(hi)}`;
    const area = k.addArea(rect, 'passage', 'stair-core', r2(bases[lower] + 3), -1, {...levelOpt(lower), also: [hi], role: 'stair', publicSpace: false, label});
    const fl: StairFlight[] = layStairRun([grids[lower], grids[hi]], rect, area.id, axis, from, bases[lower], bases[hi], OPEN_STAIR);
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; ids.push(q.id); k.flights.push(q); }
    for (const g of [grids[lower], grids[hi]]) for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = g.idx(x, y);
      air[g === grids[lower] ? lower : hi][i] = 1;
      g.ceil[i] = roofY;
    }
    const rr: RunRec = {route, lower, area: area.id, rect, axis, flights: ids, lane};
    runs.push(rr);
    return rr;
  };
  const u1 = u0 + R, r1 = r0 + R;
  if (PD - u1 < GEN_LANDING.along + 1 || u0 < GEN_LANDING.along || r1 > PW - 12) return fail('runs-fit');
  for (let lv = 0; lv <= TIERS; lv++) {
    const laneA = lv % 2 === 0;
    // route 1 (wall switchbacks): along z on the stair wall; lane A runs top at the A end (south, high z), lane B at the B end
    carveRun('stairs', lv, rectC(laneA ? 0 : LANE, PD - u1, LANE, R), 'z', laneA ? 'hi' : 'lo', laneA ? 'A' : 'B');
    // route 2 (south wall flight set): along x; lane A' top at the near (stair-corner) end
    const near: 'lo' | 'hi' = mirror ? 'hi' : 'lo', far: 'lo' | 'hi' = mirror ? 'lo' : 'hi';
    carveRun('bridge', lv, rectC(r0, laneA ? PD - LANE : PD - 2 * LANE, R, LANE), 'x', laneA ? near : far, laneA ? 'A' : 'B');
  }

  // --- 3. Decks -----------------------------------------------------------------------------------------------------------------
  // Organ terraces: the stepped ladder decks at the organ wall's south corner (rim = the south rim gallery's depth, +1.5 m per tier).
  const L0 = 3 + gwR;
  const terraces = Array.from({length: REACTOR_LEVELS}, (_, lv) => (lv === CORE_LEVEL ? PD : L0 + 3 * lv));
  const bridgeTiers = new Set(f.lines.flatMap(l => l.tiers));
  // The rim (level 0): the rim gallery round most of the mouth (north, stair wall, south, the organ wall's north part).
  {
    deck(0, 'gallery', 0, 0, PW, gwR, 'Rim gallery', 'reactor-gallery', 'N');
    deck(0, 'landing', 0, PD - u0, LANE + gwR, u0, 'Rim landing', 'reactor-landing', 'stair');
    deck(0, 'gallery', 0, gwR, LANE + gwR, PD - u0 - gwR, 'Rim gallery', 'reactor-gallery', 'stair');
    deck(0, 'gallery', 0, PD - L0, PW, L0, 'Rim gallery', 'reactor-gallery', 'S');
    deck(0, 'gallery', PW - BANK_CELLS - gwR, gwR, BANK_CELLS + gwR, PD - gwR - L0 - 12, 'Rim gallery', 'reactor-gallery', 'organ');
  }
  // Walkway tiers 1..4.
  for (let lv = 1; lv <= TIERS; lv++) {
    const even = lv % 2 === 0;
    // stair-wall landings: the A end (south) on even tiers (generator landings on 2 / 4), the B end (north) on odd tiers (tier 1: G1)
    if (even) deck(lv, 'landing', 0, PD - u0, GEN_LANDING.deep, u0, 'Generator landing', 'reactor-landing', 'stair');
    else deck(lv, lv === 1 ? 'landing' : 'stair-landing', 0, 0, lv === 1 ? GEN_LANDING.deep : 8, PD - u1, lv === 1 ? 'Generator landing' : 'Stair landing', 'reactor-landing', 'stair');
    // tower decks (before the bridges: a bridge cell inside a tower deck belongs to the tower)
    f.lines.forEach((l, li) => { if (l.tiers.includes(lv)) deck(lv, 'tower', l.px - 3, l.tz, 10, 10, `Lattice tower ${li + 1}`, 'reactor-tower'); });
    // the south wall: route-2 end landing (near on even tiers, far on odd), the continuous outer gallery
    if (even) deck(lv, 'stair-landing', GEN_LANDING.deep, PD - 2 * LANE - gwS, r0 - GEN_LANDING.deep, 2 * LANE + gwS, 'South landing', 'reactor-landing', 'S');
    else deck(lv, 'stair-landing', r1, PD - 2 * LANE - gwS, PW - 6 - r1, 2 * LANE + gwS, 'South landing', 'reactor-landing', 'S');
    deck(lv, 'gallery', 0, PD - 2 * LANE - gwS, PW, gwS, 'South gallery', 'reactor-gallery', 'S');
    // organ terrace (ladder deck)
    deck(lv, 'landing', PW - 6, PD - terraces[lv], 6, terraces[lv], 'Pipe terrace', 'reactor-landing', 'organ');
    // the north b-half: odd tiers and bridge tiers
    if (!even || bridgeTiers.has(lv)) {
      const reach = Math.max(0, ...f.lines.filter(l => l.tiers.includes(lv)).map(l => l.px + 12));
      const len = Math.min(PW, Math.max(Math.round(f.lenN[lv] * PW), reach));
      deck(lv, 'gallery', 0, 0, len, gwN, 'North gallery', 'reactor-gallery', 'N');
    }
    // bridges (north gallery -> tower -> south gallery)
    f.lines.forEach((l, li) => { if (l.tiers.includes(lv)) deck(lv, 'bridge', l.px, gwN, 4, PD - 2 * LANE - gwS - gwN, `Bridge ${li + 1}`, 'reactor-bridge'); });
  }
  // The core floor: the whole pit round the vessel (raised, blocked after the crop) at the bottom.
  // (six sectors: the spawn / loot caps act per area, and the floor round the vessel is big)
  const coreAreas: number[] = [];
  for (let sz = 0; sz < 2; sz++) for (let sx = 0; sx < 3; sx++) {
    const x0 = Math.round(PW * sx / 3), x1 = Math.round(PW * (sx + 1) / 3), z0 = Math.round(PD * sz / 2), z1 = Math.round(PD * (sz + 1) / 2);
    const a = addPitArea(CORE_LEVEL, rectC(x0, z0, x1 - x0, z1 - z0), `Core floor · ${sz ? 'south' : 'north'} ${['west', 'centre', 'east'][mirror ? 2 - sx : sx]}`, 'reactor-floor');
    if (a) coreAreas.push(a.id);
  }
  if (!coreAreas.length) return fail('core-floor');
  const vessel: [number, number][] = [];
  {
    const g = grids[CORE_LEVEL], vr = VESSEL.r / CELL, ccx = PW / 2, ccz = PD / 2;
    for (let pz = 0; pz < PD; pz++) for (let px = 0; px < PW; px++) {
      if (Math.hypot(px + 0.5 - ccx, pz + 0.5 - ccz) > vr) continue;
      const i = g.idx(cx(px), PZ0 + pz);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) continue;
      g.floor[i] = r2(bases[CORE_LEVEL] + VESSEL.h);
      vessel.push([cx(px), PZ0 + pz]);
    }
  }

  // --- 4. Platform openings onto the rim gallery ----------------------------------------------------------------------------------
  const rimN = decks.find(d => d.level === 0 && d.wall === 'N');
  if (!rimN) return fail('rim-gallery');
  const openings: CellRect[] = [];
  {
    const n = f.openings, w = 10;
    for (let i = 0; i < n; i++) {
      const c = Math.round(PW * (i + 0.5) / n + rng.int(-4, 4));
      const px = Math.max(2, Math.min(PW - 2 - w, c - w / 2));
      const r = rectC(px, -1, w, 1);
      if (r.x < pRect.x + 2 || r.x + r.w > pRect.x + pRect.w - 2) continue;
      k.carveDoor(r, platform, k.areas[rimN.area], CLEAR.portal, false);
      openings.push(r);
    }
    if (openings.length < 2) return fail('openings');
  }

  // --- 4b. A little station back of house: a staff room off the platform's stair-side end (south of the platform) ---------------
  const stationBoh: number[] = [];
  {
    const wAlong = f.shift - 7, deep = 9;
    if (wAlong >= 8) {
      const r = rectC(plat0 + 2, 0, wAlong, deep);
      if (k.rectFree(r, 0)) {
        const a = k.addArea(r, 'room', 'crew-room', CLEAR.store, platform.id, {label: 'Station staff room', publicSpace: false});
        a.purpose = 'staff-room';
        const dr = rectC(plat0 + 2 + Math.floor(wAlong / 2) - 2, -1, 4, 1);
        k.carveDoor(dr, platform, a, CLEAR.door, false, {staff: true});
        stationBoh.push(a.id);
      }
    }
  }

  // --- 4c. Task reactor-expansion-20261101 (lane HOST): the side-complex slots (free rock beside the pit; same-storey rooms avoid them)
  const slots = planComplexSlots({k, rng: rng.fork('complex-slots'), bases, PX0, PZ0, PW, PD, coreW: cv.coreW, coreH: cv.coreH, decks, terraces, cx, rectC});

  // --- 5. Rooms cut into the rock behind the decks ----------------------------------------------------------------------------
  const rooms: RoomRec[] = [];
  const deckIds = new Set(decks.map(d => d.area));
  for (const id of coreAreas) deckIds.add(id);
  type Spec = {key: string; level: number; type: RoomType; label: string; purpose: string; along: [number, number]; depth: [number, number]; walls: WallId[]; door: number; doorH: number; required: boolean};
  const specs: Spec[] = [
    {key: 'switchgear', level: TIERS, type: 'utility', label: 'Switchgear room', purpose: 'electrical-room', along: [18, 20], depth: [12, 14], walls: ['S', 'stair', 'organ', 'N'], door: 4, doorH: CLEAR.door, required: true},
    {key: 'control', level: CORE_LEVEL, type: 'utility', label: 'Reactor control room', purpose: 'signal-room', along: [22, 24], depth: [12, 14], walls: ['N', 'S', 'organ', 'stair'], door: 12, doorH: 2.8, required: true},
    {key: 'pumpHall', level: CORE_LEVEL, type: 'utility', label: 'Pump hall', purpose: 'pump-room', along: [18, 20], depth: [14, 16], walls: ['stair', 'organ', 'S', 'N'], door: 4, doorH: CLEAR.door, required: true},
    {key: 'rimOffice', level: 0, type: 'agent-office', label: 'Rim control office', purpose: 'agent-office', along: [14, 16], depth: [10, 12], walls: ['organ', 'stair', 'S'], door: 4, doorH: CLEAR.door, required: true},
    {key: 'store3', level: 3, type: 'storage', label: 'Maintenance store', purpose: 'storage', along: [12, 14], depth: [9, 10], walls: ['N', 'S', 'organ', 'stair'], door: 4, doorH: CLEAR.door, required: true},
    {key: 'store4', level: TIERS, type: 'storage', label: 'Maintenance store', purpose: 'storage', along: [10, 14], depth: [8, 10], walls: ['organ', 'stair', 'S', 'N'], door: 4, doorH: CLEAR.door, required: true},
    {key: 'storeCore', level: CORE_LEVEL, type: 'storage', label: 'Maintenance store', purpose: 'storage', along: [10, 14], depth: [8, 10], walls: ['S', 'organ', 'stair', 'N'], door: 4, doorH: CLEAR.door, required: true},
    {key: 'crew1', level: 1, type: 'crew-room', label: 'Crew room', purpose: 'staff-room', along: [12, 16], depth: [8, 10], walls: ['N', 'stair', 'S', 'organ'], door: 4, doorH: CLEAR.door, required: false},
    {key: 'work2', level: 2, type: 'utility', label: 'Workshop', purpose: 'workshop', along: [12, 16], depth: [9, 11], walls: ['S', 'organ', 'stair', 'N'], door: 4, doorH: CLEAR.door, required: false},
    {key: 'side3', level: 3, type: 'utility', label: 'Valve gallery', purpose: 'pump-room', along: [12, 14], depth: [9, 10], walls: ['S', 'stair', 'organ', 'N'], door: 4, doorH: CLEAR.door, required: false},
  ];
  for (const s of specs) {
    const rr = placeRoom(s);
    if (!rr && s.required) return fail(`room-${s.key}`);
  }

  function wallLen(w: WallId): number { return w === 'stair' || w === 'organ' ? PD : PW; }
  /** Canonical (px, pz) of a room-local cell (a along from a0, d inward from the front wall: d = -1 the wall itself, d = -2 the deck). */
  function roomCanon(w: WallId, a: number, d: number): [number, number] {
    switch (w) {
      case 'stair': return [-2 - d, a];
      case 'organ': return [PW + 1 + d, a];
      case 'N': return [a, -2 - d];
      default: return [a, PD + 1 + d];
    }
  }
  function roomRect(w: WallId, a0: number, wd: number, d0: number, dd: number): CellRect {
    const [pa, pb] = roomCanon(w, a0, d0), [qa, qb] = roomCanon(w, a0 + wd - 1, d0 + dd - 1);
    const x0 = Math.min(pa, qa), x1 = Math.max(pa, qa), z0 = Math.min(pb, qb), z1 = Math.max(pb, qb);
    return rectC(x0, z0, x1 - x0 + 1, z1 - z0 + 1);
  }
  function placeRoom(s: Spec): RoomRec | null {
    const lv = s.level, g = grids[lv];
    for (const w of s.walls) {
      const L = wallLen(w);
      const wd = rng.int(s.along[0], s.along[1]), dd = rng.int(s.depth[0], s.depth[1]);
      const starts: number[] = [];
      for (let a = 1; a + wd <= L - 1; a++) starts.push(a);
      rng.shuffle(starts);
      for (const a0 of starts) {
        const r = roomRect(w, a0, wd, 0, dd);
        if (r.x < ORG + 1 || r.y < ORG + 1 || r.x + r.w > cv.coreW - ORG - 1 || r.y + r.h > cv.coreH - ORG - 1) continue;
        if (!k.rectFree(r, lv)) continue;
        if (slotBlocks(slots, r, lv)) continue; // lane HOST: never in a side complex's region of this storey
        // a door span whose front cells (just inside the pit) are flat deck of this storey
        const dw = Math.min(s.door, wd - 2);
        const offs: number[] = [];
        for (let o = 1; o + dw <= wd - 1; o++) offs.push(o);
        offs.sort((p, q) => Math.abs(p + dw / 2 - wd / 2) - Math.abs(q + dw / 2 - wd / 2));
        for (const o of offs) {
          let ok = true, front = -1;
          for (let t = 0; t < dw && ok; t++) {
            const [fx, fz] = roomCanon(w, a0 + o + t, -2);
            const i = g.idx(cx(fx), PZ0 + fz);
            if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || Math.abs(g.floor[i] - bases[lv]) > 0.01 || !deckIds.has(g.area[i])) ok = false;
            else front = g.area[i];
          }
          // keep the door off a deck corner (one more deck cell each side)
          for (const t of [-1, dw]) {
            const [fx, fz] = roomCanon(w, a0 + o + t, -2);
            const i = g.idx(cx(fx), PZ0 + fz);
            if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) ok = false;
          }
          if (!ok) continue;
          const A = k.addArea(r, 'room', s.type, r2(bases[lv] + (s.type === 'storage' ? CLEAR.store : s.type === 'utility' ? CLEAR.hall : CLEAR.room)), front, {...levelOpt(lv), label: s.label, publicSpace: false, role: 'reactor-room'});
          A.purpose = s.purpose;
          const door = roomRect(w, a0 + o, dw, -1, 1);
          k.carveDoor(door, k.areas[front], A, s.doorH, false, s.door > 4 ? {} : {staff: true});
          const rec: RoomRec = {key: s.key, level: lv, area: A.id, rect: r, wall: w, a0, w: wd, d: dd, door, doorA0: a0 + o, doorW: dw};
          rooms.push(rec);
          return rec;
        }
      }
    }
    return null;
  }

  // --- Generators: G1 on tier 1's north landing, G2 / G3 on the south generator landings of tiers 2 / 4 --------------------------
  const gens: GenRec[] = [];
  {
    const landing = (lv: number) => decks.find(d => d.level === lv && d.wall === 'stair');
    const at = (zone: number, lv: number, pz0: number, usePz: number, yaw: number) => {
      const dk = landing(lv);
      if (!dk) return false;
      gens.push({zone, level: lv, area: dk.area, foot: rectC(6, pz0, 4, 8), use: {px: 8, pz: usePz, yaw}});
      return true;
    };
    if (!at(0, 1, 2, 11, 0) || !at(1, 2, PD - 9, PD - 11, Math.PI) || !at(2, TIERS, PD - 9, PD - 11, Math.PI)) return fail('generators');
  }

  // --- 6. The column stack: ceilings of every open band in the pit (air to the roof, one slab under the next band up) -----------
  stackColumns(grids, air, PX0, PZ0, PW, PD, roofY);

  return {
    f, bases, PX0, PZ0, PW, PD, coreW: cv.coreW, coreH: cv.coreH, bed, platform, openings, stationBoh, decks, runs, rooms, gens, towers, terraces,
    vessel, coreAreas, cx, rectC, slots,
  };
}

/**
 * The union-of-bands contract in the pit (gen/levels.ts): in every column the open bands are sorted by floor; each band's ceiling is
 * capped one SLAB under the lowest point of the next band up (a stair flight's lower cell edge); the top band of an open-air column
 * reaches the pit roof. Shared stair cells (a run carved into two storey grids) are one band.
 */
export function stackColumns(grids: readonly Grid[], air: readonly Uint8Array[], x0: number, z0: number, w: number, h: number, roofY: number): void {
  const nl = grids.length;
  const fl: number[] = [], lo: number[] = [], lv: number[] = [];
  const order: number[] = [];
  for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) {
    const i = grids[0].idx(x, z);
    fl.length = lo.length = lv.length = order.length = 0;
    for (let L = 0; L < nl; L++) {
      const g = grids[L], c = g.cells[i];
      if (c !== FLOOR && c !== VOID) continue;
      const f = g.floorOf(i);
      let m = f;
      const ri = g.rampIdx[i];
      if (ri >= 0) {
        const Rm = g.ramps[ri], a = (Rm.axis === 'x' ? x : z) * CELL;
        m = Math.min(rampHeight(Rm, a), rampHeight(Rm, a + CELL));
      }
      if (air[L][i]) g.ceil[i] = roofY;
      fl.push(f); lo.push(m); lv.push(L); order.push(order.length);
    }
    if (fl.length < 2) continue;
    order.sort((a, b) => fl[a] - fl[b]);
    for (let q = 0; q < order.length; q++) {
      const a = order[q];
      // next band up: the first entry whose floor differs from this one (a shared stair cell is one band)
      let nxt = -1;
      for (let t = q + 1; t < order.length; t++) if (Math.abs(fl[order[t]] - fl[a]) > 1e-3) { nxt = order[t]; break; }
      if (nxt < 0) continue;
      const cap = lo[nxt] - SLAB - 0.01;
      const g = grids[lv[a]];
      if (g.ceil[i] > cap) g.ceil[i] = Math.round(cap * 1000) / 1000;
    }
  }
}
