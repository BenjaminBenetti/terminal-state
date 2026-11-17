// Task studio-mall-layout-variety-20261117-005520-01: the Mall's parking-lot WINDOW WALLS (rendering). User: "suggest larger outside windows
// with views of a parking lot". Lane GEN's records (gen/mall/windows.ts: layout.mall.windows, layout version >= 2) are drawn here, like
// the locked street exits (world/mallStreetExit.ts): the SOLID cells behind the glazing are the collision, nothing outside is walkable,
// no Travel. Task studio-mall-parking-glass-followup-20261117-043548-01 made the glass the Office's BREAKABLE windows: the panes (one per
// mullion bay per storey, on paneGrid below) are world/mallWindowPanes.ts's runtime meshes on the Office's window contracts (shots,
// breaches, the outside toxic gas through a broken pane, persistence); this renderer draws everything else.
//
// Per window wall, in its local frame (u along the glazing, w outward from the inner plane, y above the lot), three meshes + the cars:
//  1. FRAME (lit, opaque; the street exits' frame material): a floor-to-ceiling aluminium curtain wall on every glazed storey — sill,
//     head, jambs, mullions every ~1.6 m, a transom rail — and the dark spandrel cladding on the outer face between / below / above the
//     glazed bands (what a glance up or down through the glass meets);
//  2. LOT (the street exits' unlit outdoor shading and the Office's green height fog toward the roof sky's murk): a paved apron and curb
//     along the facade, a fire lane, double rows of striped stalls with drive aisles (stripes are thin quads of the atlas's white texel
//     in a faded paint tint: no new texture), landscaped end islands with dead planting, tall twin-head light poles, rubble and — when
//     the view is deep enough — a perimeter road, a three-level parking deck and the town's facades beyond; a backdrop box in the roof's
//     own sky colour closes the volume;
//  3. FOG CARDS (the street exits' drifting murk layers) at increasing depths over the lot;
//  4. CARS: the abandoned cars (some burnt out) on the stalls, aisles and deck are the game's cooked wreck models (world/mallVehicles.ts:
//     one instanced mesh per model part, the lot's outdoor shading), never a block stand-in.
// Every mesh carries userData.levels (the glazed storeys) and userData.aperture (the whole glazed wall: world/levelCulling.ts draws it
// only while that opening may be seen). Everything outside stays inside lane GEN's view volume and under the mall's roof deck (capY).
// Provenance: procedural geometry over the street exits' existing atlas cells (asphalt, lane, curb, paving, dirt, paint, roof, the
// facades, white), the Office's procedural rubble and the existing cooked wreck models. No new texture, model, image or provider job.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mulberry32} from '../core/rng';
import {EXT_FOG, exteriorFogOpacity, fallbackPropGeometry} from './exterior';
import {MALL_EXT_ORDER} from './mallExterior';
import {
  Acc, STREET_CELLS, STREET_SLAB, box, cellRect, exitFrame, faceUv, localBox, streetExitFrameMaterial, streetExitMaterial,
  streetFogCardMaterial, vehicleMeshes, type ExitFrame, type StreetCell, type StreetExitAperture,
} from './mallStreetExit';
import {MALL_VEHICLE, placeVehicles, type VehicleSpot} from './mallVehicles'; // task studio-mall-parking-glass-followup-20261117-043548-01

type V3 = [number, number, number];
type Box = {x0: number; z0: number; x1: number; z1: number; y0: number; y1: number};

/** A window wall as this renderer needs it (world metres, absolute y), from lane GEN's record (windowWallSpecs). */
export interface WindowWallSpec {
  id: string;
  /** Task studio-mall-parking-glass-followup-20261117-043548-01: the record's index in layout.mall.windows (part of its pane ids) and side. */
  index: number;
  side: 'N' | 'S' | 'E' | 'W';
  /** Outward unit normal (axis-aligned): from the walkway to the lot. */
  nx: number;
  nz: number;
  /** The inner glazing plane (x for E / W walls, z for N / S) and the glazed span along it (s0 < s1). */
  plane: number;
  s0: number;
  s1: number;
  /** The lot's ground (absolute y). */
  streetY: number;
  /** Glazed storeys bottom-up: the storey (layout.levels index), its floor y and the glazing head y. */
  bands: {level: number; y0: number; y1: number}[];
  /** Curtain-wall depth (m): the outer face lies at plane + n * depth. */
  depth: number;
  collider: Box;
  view: Box;
  /** Highest world y of the exterior (the roof deck less a margin): never seen through the roof glazing. */
  capY: number;
  seed: number;
}

const SIDE_N: Record<string, [number, number]> = {N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0]};
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Lane GEN's window records (layout.mall.windows, read loosely: nothing breaks before / without them) -> normalized specs. */
export function windowWallSpecs(layout: {mall?: unknown}, capY = Infinity): WindowWallSpec[] {
  const raw = ((layout.mall as {windows?: unknown[]} | undefined)?.windows ?? []) as Record<string, unknown>[];
  const out: WindowWallSpec[] = [];
  raw.forEach((r, k) => {
    const n = SIDE_N[String(r.side ?? '')];
    const view = r.view as Box | undefined, collider = r.collider as Box | undefined;
    const bands = (Array.isArray(r.bands) ? r.bands as Record<string, unknown>[] : [])
      .map(b => ({level: num(b.level, NaN), y0: num(b.y0, NaN), y1: num(b.y1, NaN)}))
      .filter(b => [b.level, b.y0, b.y1].every(Number.isFinite) && b.y1 - b.y0 > 1)
      .sort((p, q) => p.y0 - q.y0);
    const plane = num(r.plane, NaN), s0 = Math.min(num(r.s0, NaN), num(r.s1, NaN)), s1 = Math.max(num(r.s0, NaN), num(r.s1, NaN));
    if (!n || !view || !collider || !bands.length || ![plane, s0, s1].every(Number.isFinite) || s1 - s0 < 2) return;
    const facade = num(r.facade, plane + (n[0] + n[1]) * 0.5);
    out.push({
      id: String(r.id ?? `W${k + 1}`), index: k, side: String(r.side) as WindowWallSpec['side'], nx: n[0], nz: n[1], plane, s0, s1, streetY: num(r.streetY, bands[0].y0), bands,
      depth: Math.max(0.3, Math.abs(facade - plane)), collider: {...collider}, view: {...view}, capY, seed: num(r.seed, 104729 * (k + 1)) >>> 0,
    });
  });
  return out;
}

/** The wall-face cuts of a window wall: one glazed opening per storey band (world/mallStreetExit.ts cutExitOpenings). */
export function windowCuts(specs: readonly WindowWallSpec[]): {level: number; nx: number; nz: number; plane: number; s0: number; s1: number; y0: number; y1: number}[] {
  return specs.flatMap(s => s.bands.map(b => ({level: b.level, nx: s.nx, nz: s.nz, plane: s.plane, s0: s.s0, s1: s.s1, y0: b.y0, y1: b.y1})));
}

/** The culler aperture of a window wall: the whole glazed wall on its inner plane, with its bands (the culler's sight-ray heights). */
export const windowApertureOf = (s: WindowWallSpec): StreetExitAperture =>
  ({nx: s.nx, nz: s.nz, plane: s.plane, s0: s.s0, s1: s.s1, y0: s.bands[0].y0, y1: s.bands[s.bands.length - 1].y1, bands: s.bands.map(b => ({y0: b.y0, y1: b.y1}))});

// ---------------------------------------------------------------------------------------------------------------------------
// The lot plan (pure data, local frame; tests check it stays inside the view volume)

/** Parking geometry (m): stall width / depth, drive aisle, fire lane along the facade, a deck storey. */
export const LOT = {stall: 2.6, stallDepth: 5.4, aisle: 7, fireLane: 6.5, deckStorey: 3.1, poleH: 9, curbY: -0.15} as const;

export interface LotRow { w0: number; w1: number; facing: -1 | 1 }
export interface LotPlan {
  /** Local view volume (u, w outward from the inner plane, y above the lot). */
  vol: {u0: number; u1: number; w0: number; w1: number; y0: number; y1: number};
  /** Outer face of the curtain wall (w), the apron and the end of the striped lot (w). */
  B: number;
  apron: [number, number];
  lotEnd: number;
  /** Stall rows (a double row = two rows facing apart), the u positions of the stall lines, the islands' u spans. */
  rows: LotRow[];
  lines: number[];
  islands: [number, number][];
  cars: {u: number; w: number; yaw: number; kind: 'car' | 'bus'; burnt: boolean}[];
  poles: {u: number; w: number}[];
  rubble: {u: number; w: number; s: number}[];
  /** Beyond the lot (deep views only): the perimeter road band, the parking deck and the town's facades. */
  road: [number, number] | null;
  deck: {u0: number; u1: number; w0: number; w1: number; levels: number} | null;
  buildings: {u0: number; u1: number; w0: number; w1: number; h: number; cell: StreetCell; tone: number}[];
  cards: {w: number; opacity: number}[];
  ground: {y: number; opacity: number};
}

/** The lot's local view volume and the curtain wall's outer face B (w) — planLot's and the pane grid's (paneGrid) shared numbers. */
function lotVolume(s: WindowWallSpec): {vol: LotPlan['vol']; B: number} {
  const f = exitFrame(s);
  const lb = localBox(f, s.view, s.streetY);
  const vol = {u0: lb.u0, u1: lb.u1, w0: Math.max(lb.w0, 0), w1: lb.w1, y0: Math.max(lb.y0, -STREET_SLAB), y1: Math.min(lb.y1, (Number.isFinite(s.capY) ? s.capY : Infinity) - s.streetY)};
  return {vol, B: Math.min(Math.max(s.depth, vol.w0), vol.w1 - 2)};
}

/** Lays out the parking lot outside a window wall inside its view volume (deterministic per seed). */
export function planLot(s: WindowWallSpec): LotPlan {
  const {vol, B} = lotVolume(s);
  const r = mulberry32(s.seed ^ 0x9a4c);
  const D = vol.w1 - B;
  const apron: [number, number] = [B, B + Math.min(4.5, Math.max(2.5, 0.08 * D))];
  // the far zone (perimeter road, deck, town) only when the view is deep; else the striped lot runs on into the murk
  const far = D >= 50 ? Math.min(32, Math.max(22, 0.38 * D)) : 0;
  const lotEnd = vol.w1 - (far || 1);
  // stall rows: the fire lane along the facade, then double rows (facing apart) with a drive aisle after each
  const rows: LotRow[] = [];
  let w = apron[1] + 0.25 + LOT.fireLane;
  while (w + 2 * LOT.stallDepth <= lotEnd) {
    rows.push({w0: w, w1: w + LOT.stallDepth, facing: -1}, {w0: w + LOT.stallDepth, w1: w + 2 * LOT.stallDepth, facing: 1});
    w += 2 * LOT.stallDepth + LOT.aisle;
  }
  // stall lines across the width, an end island every 9-12 stalls (and at both ends)
  const lines: number[] = [], islands: [number, number][] = [];
  const uA = vol.u0 + 1.5, uB = vol.u1 - 1.5;
  let u = uA, k = 0, run = 9 + Math.floor(r() * 4);
  islands.push([u - 1.2, u]);
  while (u + LOT.stall <= uB) {
    lines.push(u);
    u += LOT.stall; k++;
    if (k >= run && u + LOT.stall + 2.4 <= uB) { lines.push(u); islands.push([u, u + 2.4]); u += 2.4; k = 0; run = 9 + Math.floor(r() * 4); }
  }
  lines.push(u);
  islands.push([u, Math.min(u + 1.2, vol.u1 - 0.2)]);
  const inIsland = (a: number, b: number) => islands.some(([i0, i1]) => a < i1 - 1e-6 && b > i0 + 1e-6);
  // abandoned cars: a seeded fraction of the stalls (never the stalls right in front of the glass centre on the near row), a few
  // left across the aisles, some burnt out
  const cars: LotPlan['cars'] = [];
  const fill = 0.18 + r() * 0.2;
  for (const row of rows) for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i], b = lines[i + 1];
    if (b - a < LOT.stall - 0.01 || inIsland(a, b) || r() >= fill || cars.length >= 70) continue;
    const askew = r() < 0.2;
    cars.push({u: (a + b) / 2 + (r() - 0.5) * 0.3, w: (row.w0 + row.w1) / 2 + row.facing * (0.2 + r() * 0.3), yaw: (askew ? (r() - 0.5) * 0.7 : (r() - 0.5) * 0.08) + (r() < 0.5 ? Math.PI : 0), kind: 'car', burnt: r() < 0.12});
  }
  for (let i = 0; i < rows.length; i += 2) {
    const aw = rows[i + 1].w1 + LOT.aisle / 2;
    if (aw > lotEnd - 1 || r() < 0.4) continue;
    const cu = uA + 6 + r() * Math.max(0, uB - uA - 12);
    cars.push({u: cu, w: aw, yaw: Math.PI / 2 + (r() - 0.5) * 1.2, kind: 'car', burnt: r() < 0.3});
  }
  // light poles on the double rows' centre lines: in the islands and every ~30 m
  const poles: LotPlan['poles'] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const cw = rows[i].w1;
    for (const [i0, i1] of islands) if (i1 - i0 >= 2) poles.push({u: (i0 + i1) / 2, w: cw});
  }
  const rubble: LotPlan['rubble'] = [];
  for (let i = 0; i < 2; i++) if (r() < 0.55) rubble.push({u: uA + r() * (uB - uA), w: apron[1] + 1 + r() * Math.max(1, lotEnd - apron[1] - 2), s: 0.35 + r() * 0.35});
  // the far zone: a planted strip, the perimeter road, a parking deck (when wide enough) and the town's facades
  let road: [number, number] | null = null, deck: LotPlan['deck'] = null;
  const buildings: LotPlan['buildings'] = [];
  if (far) {
    road = [lotEnd + 2.5, lotEnd + 2.5 + 8];
    const bw0 = road[1] + 2.5, bw1 = vol.w1 - 0.5;
    const yTop = Math.max(6, vol.y1 - 0.6);
    if (bw1 - bw0 >= 10) {
      const width = vol.u1 - vol.u0;
      if (width >= 46) {
        const dw = Math.min(64, Math.max(36, width * 0.45));
        const du0 = vol.u0 + 3 + r() * Math.max(0, width - dw - 6);
        deck = {u0: du0, u1: du0 + dw, w0: bw0, w1: Math.min(bw1, bw0 + 18 + r() * 10), levels: Math.max(2, Math.min(4, Math.floor((yTop - 1.2) / LOT.deckStorey)))};
      }
      const kinds: StreetCell[] = ['facadeOffice', 'facadeBrick', 'facadeGlass', 'facadeRender'];
      let bu = vol.u0 + 0.5;
      while (bu < vol.u1 - 3) {
        const bwid = Math.min(vol.u1 - 0.5 - bu, 9 + r() * 12);
        if (bwid < 3) break;
        if (deck && bu + bwid > deck.u0 - 2 && bu < deck.u1 + 2) { bu = deck.u1 + 2 + r() * 4; continue; }
        const set = r() * 4;
        buildings.push({u0: bu, u1: bu + bwid, w0: Math.min(bw1 - 1, bw0 + 2 + set), w1: bw1, h: Math.min(yTop, 7 + r() * Math.max(0, yTop - 7)), cell: kinds[Math.floor(r() * 4)], tone: r()});
        bu += bwid + (r() < 0.35 ? 3 + r() * 6 : 0.4);
      }
    }
  }
  // fog cards: parallax murk layers over the lot (the Office fog opacity of each slice, like the street exits') — from the first
  // stall row out, at half the exits' patch strength: the lot is seen from up to three storeys above it, through the material's own
  // distance fog (a street-level eye's near cards / ground sheet buried the near rows under green murk in the browser check)
  const cards: LotPlan['cards'] = [];
  let prev = B;
  for (const d of [12, 22, 32, 45, 60, 76]) {
    const cw = B + d;
    if (cw > vol.w1 - 1) break;
    cards.push({w: cw, opacity: exteriorFogOpacity(cw - prev, 1.6, 1.6) * EXT_FOG.noise});
    prev = cw;
  }
  // the low ground murk: its path through the 0.45 m layer for a view ~20 degrees down (not a street-level eye's grazing 8 m)
  const ground = {y: 0.45, opacity: Math.min(0.8, exteriorFogOpacity(1.3, 0.45, 0.45) * EXT_FOG.noise * 2)};
  return {vol, B, apron, lotEnd, rows, lines, islands, cars, poles, rubble, road, deck, buildings, cards, ground};
}

// ---------------------------------------------------------------------------------------------------------------------------
// The curtain wall's glazing grid (local frame): the frame build below and the live breakable panes (world/mallWindowPanes.ts) share it

/** Curtain-wall members (m): sill / head rails, the end jambs, the mullion / transom-rail half widths; the transom height rule. */
export const CURTAIN = {sill: 0.1, head: 0.12, jamb: 0.1, mullion: 0.04, rail: 0.04, railMax: 2.7, railFrac: 0.62, bay: 1.6} as const;

/** One pane's clear glass between the frame members (local u, y above the lot): bay `col` (0 at u = -hs), `row` 0 below the transom. */
export interface PaneRect { col: number; row: number; u0: number; u1: number; y0: number; y1: number }
export interface PaneBand { level: number; y0: number; y1: number; rail: number; panes: PaneRect[] }
/** The glazing of a window wall: half span, bays and their width, the glass plane's depth w beyond the inner plane, per storey band. */
export interface PaneGrid { hs: number; bays: number; bw: number; wg: number; bands: PaneBand[] }

/** The window wall's glazing grid (deterministic: only the record's numbers). */
export function paneGrid(s: WindowWallSpec): PaneGrid {
  const {B} = lotVolume(s);
  const C = CURTAIN, hs = (s.s1 - s.s0) / 2, wg = Math.min(0.12, B * 0.3);
  const bays = Math.max(1, Math.round((2 * hs) / C.bay)), bw = (2 * hs) / bays;
  const bands = s.bands.map(b => {
    const y0 = b.y0 - s.streetY, y1 = b.y1 - s.streetY;
    const rail = y0 + Math.min(C.railMax, (y1 - y0) * C.railFrac);
    const panes: PaneRect[] = [];
    for (let i = 0; i < bays; i++) {
      const u0 = -hs + i * bw + (i ? C.mullion : C.jamb), u1 = -hs + (i + 1) * bw - (i < bays - 1 ? C.mullion : C.jamb);
      ([[y0 + C.sill, rail - C.rail], [rail + C.rail, y1 - C.head]] as const).forEach(([p0, p1], row) => {
        if (u1 - u0 >= 0.05 && p1 - p0 >= 0.05) panes.push({col: i, row, u0, u1, y0: p0, y1: p1});
      });
    }
    return {level: b.level, y0, y1, rail, panes};
  });
  return {hs, bays, bw, wg, bands};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Build

export interface WindowWallStats {
  id: string; meshes: number; triangles: number; panes: number; bays: number; stalls: number; cars: number; storeys: number;
  /** Task studio-mall-parking-glass-followup-20261117-043548-01: the plan's car spots, the cooked-model instances drawn (lot + deck), their
   *  instanced draws (besides `meshes`) and triangles (instances x model triangles). */
  carSpots: number; vehicleDraws: number; vehicleTriangles: number; vehicleModels: Record<string, number>;
}
export interface WindowWallView { meshes: THREE.Mesh[]; stats: WindowWallStats; plan: LotPlan; aperture: StreetExitAperture; frame: ExitFrame }

const ALU: V3 = [0.5, 0.51, 0.5];
const SPANDREL: V3 = [0.2, 0.21, 0.22];
const PAINT: V3 = [0.62, 0.6, 0.52];

/**
 * Builds one window wall's three meshes (frame, lot, fog cards) and its parked cars (the cooked wreck models: one instanced mesh per model
 * part, world/mallStreetExit.ts vehicleMeshes; none without loaded `models`) in world space, tagged with its storeys and aperture. The
 * glass is the live breakable panes' (world/mallWindowPanes.ts: task studio-mall-parking-glass-followup-20261117-043548-01).
 */
export function buildWindowWall(s: WindowWallSpec, models: Readonly<Record<string, GLTF | undefined>> = {}): WindowWallView {
  const f = exitFrame(s);
  const plan = planLot(s);
  const grid = paneGrid(s);
  const r = mulberry32(s.seed ^ 0x51ab);
  const exitAttr = [s.nx, s.nz, s.nx * f.origin.x + s.nz * f.origin.z, s.streetY];
  const hs = (s.s1 - s.s0) / 2, B = plan.B, V = plan.vol;
  const atlasUv = (c: StreetCell, corners: [number, number][]) => { const [x, y, w, h] = cellRect(c); return corners.map(([a, b]) => [x + a * w, y + b * h] as [number, number]); };
  const whiteUv = atlasUv('white', [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]);
  // ---- FRAME (heights relative to the lot; the glass = the live panes, world/mallWindowPanes.ts, on the same grid) -----------
  const frame = new Acc({position: 3, normal: 3, uv: 2, color: 3, aGlow: 1});
  const fbox = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, col: V3) =>
    box(frame, u0, u1, y0, y1, w0, w1, () => ({uv: whiteUv, extra: {color: col, aGlow: [0]}}));
  const C = CURTAIN, wg = grid.wg, t = 0.05, J = C.jamb, bays = grid.bays, bw = grid.bw;
  let panes = 0;
  for (const b of grid.bands) {
    const {y0, y1, rail} = b;
    fbox(-hs, hs, y0, y0 + C.sill, -0.02, wg + t + 0.06, ALU); // sill
    fbox(-hs, hs, y1 - C.head, y1, -0.02, wg + t, ALU); // head
    fbox(-hs, -hs + J, y0, y1, -0.02, wg + t, ALU); // jambs
    fbox(hs - J, hs, y0, y1, -0.02, wg + t, ALU);
    fbox(-hs + J, hs - J, rail - C.rail, rail + C.rail, wg - t, wg + t, ALU); // transom rail
    for (let i = 1; i < bays; i++) { const u = -hs + i * bw; fbox(u - C.mullion, u + C.mullion, y0 + C.sill, y1 - C.head, wg - t, wg + t + 0.05, ALU); } // mullions
    panes += b.panes.length;
  }
  // the spandrel cladding on the outer face (between / below / above the glazed bands): what a look up or down through the glass meets
  {
    const wo0 = Math.max(wg + t + 0.02, B - 0.12), wo1 = B;
    const gaps: [number, number][] = [];
    let y = Math.max(V.y0, -0.3);
    for (const b of s.bands) { const y0 = b.y0 - s.streetY, y1 = b.y1 - s.streetY; if (y0 - y > 0.02) gaps.push([y, y0]); y = y1; }
    gaps.push([y, Math.min(V.y1, y + 1.2)]);
    for (const [g0, g1] of gaps) if (g1 - g0 > 0.02) fbox(-hs - 0.3, hs + 0.3, g0, g1, wo0, wo1, SPANDREL);
    for (const u of [-hs - 0.3, hs]) fbox(u, u + 0.3, Math.max(V.y0, -0.3), y + 1.2, wo0 - 0.2, wo1, SPANDREL); // the wall's end fins
  }
  // ---- LOT ----------------------------------------------------------------------------------------------------------------
  const street = new Acc({position: 3, normal: 3, uv: 2, color: 3, aCell: 4, aExit: 4, aView: 4}, {aView: [s.view.x0, s.view.z0, s.view.x1, s.view.z1]});
  const sx = (c: StreetCell): number[] => cellRect(c);
  const white = sx('white'), sky = [0, 0, -1, -1];
  const ground = (cell: StreetCell, u0: number, u1: number, w0: number, w1: number, y: number, col: V3 = [1, 1, 1]) => {
    if (u1 - u0 < 1e-3 || w1 - w0 < 1e-3) return;
    const [tu, tw] = STREET_CELLS[cell].tile;
    street.quad([[u0, y, w0], [u1, y, w0], [u1, y, w1], [u0, y, w1]], [0, 1, 0], [[u0 / tu, w0 / tw], [u1 / tu, w0 / tw], [u1 / tu, w1 / tw], [u0 / tu, w1 / tw]], {color: col, aCell: sx(cell), aExit: exitAttr});
  };
  const vquad = (cell: StreetCell, a: [number, number], b: [number, number], y0: number, y1: number, n: V3, col: V3 = [1, 1, 1], s0 = 0) => {
    const [tu, tv] = STREET_CELLS[cell].tile;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    street.quad([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], n,
      [[s0 / tu, y0 / tv], [(s0 + len) / tu, y0 / tv], [(s0 + len) / tu, y1 / tv], [s0 / tu, y1 / tv]], {color: col, aCell: sx(cell), aExit: exitAttr});
  };
  const sbox = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, col: V3) =>
    box(street, u0, u1, y0, y1, w0, w1, () => ({uv: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], extra: {color: col, aCell: white, aExit: exitAttr}}));
  /** A textured box (the cell stretched per face by size: facades / deck concrete). */
  const tbox = (cell: StreetCell, u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, col: V3) =>
    box(street, u0, u1, y0, y1, w0, w1, (n, c) => {
      const [tu, tv] = STREET_CELLS[cell].tile, fu = faceUv(n, c);
      const su = Math.abs(n[1]) > 0.5 ? (u1 - u0) / tu : Math.abs(n[2]) > 0.5 ? (u1 - u0) / tu : (w1 - w0) / tu;
      const sv = Math.abs(n[1]) > 0.5 ? (w1 - w0) / tv : (y1 - y0) / tv;
      return {uv: fu.map(([a, b]) => [a * Math.max(su, 0.05), b * Math.max(sv, 0.05)] as [number, number]), extra: {color: col, aCell: sx(cell), aExit: exitAttr}};
    });
  const cy = LOT.curbY;
  // apron + curb along the facade, the asphalt from the curb to the lot's end
  ground('paving', V.u0, V.u1, B, plan.apron[1], 0);
  ground('curb', V.u0, V.u1, plan.apron[1], plan.apron[1] + 0.25, 0);
  vquad('curb', [V.u1, plan.apron[1] + 0.25], [V.u0, plan.apron[1] + 0.25], cy, 0, [0, 0, 1]);
  ground('asphalt', V.u0, V.u1, plan.apron[1] + 0.25, plan.lotEnd, cy);
  // stall lines (faded paint quads just above the asphalt), the centre line of each double row, the islands (curb + dead planting)
  const paint = (u0: number, u1: number, w0: number, w1: number, k = 1) => street.quad([[u0, cy + 0.012, w0], [u1, cy + 0.012, w0], [u1, cy + 0.012, w1], [u0, cy + 0.012, w1]], [0, 1, 0], [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], {color: [PAINT[0] * k, PAINT[1] * k, PAINT[2] * k], aCell: white, aExit: exitAttr});
  let stalls = 0;
  for (const row of plan.rows) {
    for (const u of plan.lines) paint(u - 0.06, u + 0.06, row.w0 + 0.2, row.w1 - (row.facing > 0 ? 0.3 : 0), 0.85 + r() * 0.2);
    stalls += Math.max(0, plan.lines.length - 1);
  }
  for (let i = 0; i + 1 < plan.rows.length; i += 2) paint(V.u0 + 1.5, V.u1 - 1.5, plan.rows[i].w1 - 0.06, plan.rows[i].w1 + 0.06, 0.8);
  for (let i = 0; i + 1 < plan.rows.length; i += 2) {
    const w0 = plan.rows[i].w0 + 0.3, w1 = plan.rows[i + 1].w1 - 0.3;
    for (const [i0, i1] of plan.islands) {
      if (i1 - i0 < 0.6) continue;
      sbox(i0 + 0.05, i1 - 0.05, cy, 0.0, w0, w1, [0.5, 0.49, 0.46]);
      ground('dirt', i0 + 0.2, i1 - 0.2, w0 + 0.2, w1 - 0.2, 0.012, [0.9, 0.85, 0.75]);
      if (r() < 0.6) sbox((i0 + i1) / 2 - 0.35, (i0 + i1) / 2 + 0.35, 0, 0.6 + r() * 0.6, (w0 + w1) / 2 - 1.6, (w0 + w1) / 2 - 0.8, [0.16, 0.15, 0.11]); // a dead shrub
    }
  }
  // the far zone: a planted strip, the perimeter road, the deck, the town
  if (plan.road) {
    const [r0, r1] = plan.road, rm = (r0 + r1) / 2;
    vquad('curb', [V.u0, plan.lotEnd], [V.u1, plan.lotEnd], cy, 0, [0, 0, -1]);
    ground('dirt', V.u0, V.u1, plan.lotEnd, r0, 0);
    vquad('curb', [V.u1, r0], [V.u0, r0], cy, 0, [0, 0, 1]);
    ground('asphalt', V.u0, V.u1, r0, rm - 1, cy);
    ground('lane', V.u0, V.u1, rm - 1, rm + 1, cy);
    ground('asphalt', V.u0, V.u1, rm + 1, r1, cy);
    vquad('curb', [V.u0, r1], [V.u1, r1], cy, 0, [0, 0, -1]);
    ground('paving', V.u0, V.u1, r1, V.w1, 0, [0.85, 0.85, 0.82]);
  } else ground('asphalt', V.u0, V.u1, plan.lotEnd, V.w1, cy);
  if (plan.deck) {
    const d = plan.deck, H = LOT.deckStorey;
    for (let k = 1; k <= d.levels; k++) {
      const y = k * H;
      tbox('paint', d.u0, d.u1, y - 0.3, y, d.w0, d.w1, [0.78, 0.77, 0.73]); // deck slab
      tbox('paint', d.u0, d.u1, y, y + 1.0, d.w0, d.w0 + 0.25, [0.7, 0.69, 0.66]); // parapet facing the mall
      tbox('paint', d.u0, d.u0 + 0.25, y, y + 1.0, d.w0, d.w1, [0.66, 0.65, 0.62]);
      tbox('paint', d.u1 - 0.25, d.u1, y, y + 1.0, d.w0, d.w1, [0.66, 0.65, 0.62]);
    }
    ground('roof', d.u0, d.u1, d.w0, d.w1, d.levels * H + 0.01, [0.9, 0.9, 0.9]);
    for (let cu = d.u0 + 0.3; cu <= d.u1 - 0.3; cu += Math.max(6, (d.u1 - d.u0 - 0.6) / Math.ceil((d.u1 - d.u0 - 0.6) / 8))) {
      for (const cw of [d.w0 + 0.5, d.w1 - 0.5]) sbox(cu - 0.25, cu + 0.25, 0, d.levels * H - 0.3, cw - 0.25, cw + 0.25, [0.6, 0.59, 0.56]);
    }
    vquad('facadeRender', [d.u1, d.w1], [d.u0, d.w1], 0, d.levels * H + 1, [0, 0, -1], [0.55, 0.54, 0.52]); // the deck's back wall (closes it)
  }
  for (const b of plan.buildings) {
    const tone = 0.75 + b.tone * 0.35, col: V3 = [tone, tone * 0.98, tone * 0.95];
    vquad(b.cell, [b.u1, b.w0], [b.u0, b.w0], 0, b.h, [0, 0, -1], col, -b.u1);
    vquad(b.cell, [b.u0, b.w0], [b.u0, b.w1], 0, b.h, [-1, 0, 0], [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85]);
    vquad(b.cell, [b.u1, b.w1], [b.u1, b.w0], 0, b.h, [1, 0, 0], [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85]);
    const [tu, tw] = STREET_CELLS.roof.tile;
    street.quad([[b.u0, b.h, b.w0], [b.u1, b.h, b.w0], [b.u1, b.h, b.w1], [b.u0, b.h, b.w1]], [0, 1, 0], [[b.u0 / tu, b.w0 / tw], [b.u1 / tu, b.w0 / tw], [b.u1 / tu, b.w1 / tw], [b.u0 / tu, b.w1 / tw]], {color: col, aCell: sx('roof'), aExit: exitAttr});
  }
  // the parked cars (task studio-mall-parking-glass-followup-20261117-043548-01): the cooked wreck models (world/mallVehicles.ts),
  // instanced below on the lot plan's spots and the deck's. This stream (r) is drawn exactly as when they were tinted block stand-ins,
  // so the deck spots, the rubble and the light poles keep their places
  const spots: VehicleSpot[] = [];
  for (const c of plan.cars) { if (!c.burnt) r(); spots.push({u: c.u, y: cy, w: c.w, yaw: c.yaw, kind: 'car', burnt: c.burnt}); }
  if (plan.deck) {
    const d = plan.deck;
    for (let k = 1; k <= d.levels; k++) for (let i = 0; i < 3; i++) if (r() < 0.5) {
      const u = d.u0 + 2 + r() * (d.u1 - d.u0 - 4), w = d.w0 + 2.8 + r() * Math.max(0.5, d.w1 - d.w0 - 5.6), yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.1;
      r(); // (the stand-in's tint)
      spots.push({u, y: k * LOT.deckStorey, w, yaw, kind: 'car'});
    }
  }
  const vehicles = placeVehicles(spots, s.seed, sp => sp.w - B > MALL_VEHICLE.near);
  // rubble (the Office's procedural stand-in mound, vertex coloured) where no car stands, light poles
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const rubG = fallbackPropGeometry('rubble');
  const place = (g: THREE.BufferGeometry, u: number, y: number, w: number, yaw: number, sc: V3) => {
    m4.compose(new THREE.Vector3(u, y, w), qq.setFromAxisAngle(UP, yaw), new THREE.Vector3(...sc));
    street.geometry(g, m4, {aCell: white, aExit: exitAttr}, true);
  };
  for (const rb of plan.rubble) {
    const yaw = r() * 6.28, rad = 2.3 * 1.3 * rb.s; // (the mound's reach: fallbackPropGeometry's 2.3 m x its 0.7-1.3 jitter)
    if (vehicles.some(v => Math.abs(v.y - cy) < 1 && Math.hypot(v.u - rb.u, v.w - rb.w) < rad + v.len / 2)) continue;
    place(rubG, rb.u, cy, rb.w, yaw, [rb.s, rb.s * 0.8, rb.s]);
  }
  rubG.dispose();
  const steel: V3 = [0.17, 0.17, 0.16];
  for (const p of plan.poles) {
    const h = Math.min(LOT.poleH, V.y1 - 0.4);
    sbox(p.u - 0.3, p.u + 0.3, cy, 0.5, p.w - 0.3, p.w + 0.3, [0.5, 0.49, 0.46]); // footing
    sbox(p.u - 0.08, p.u + 0.08, 0.5, h, p.w - 0.08, p.w + 0.08, steel);
    sbox(p.u - 1.1, p.u + 1.1, h - 0.12, h, p.w - 0.05, p.w + 0.05, steel);
    for (const e of [-1, 1]) sbox(p.u + e * 1.1 - 0.35, p.u + e * 1.1 + 0.35, h - 0.28, h - 0.1, p.w - 0.22, p.w + 0.22, [0.09, 0.09, 0.09]);
  }
  // backdrop box (back / sides / lid), facing the glass: the roof's own sky colour along each ray
  const bk = (c: V3[], n: V3) => street.quad(c, n, [[0, 0], [1, 0], [1, 1], [0, 1]], {color: [1, 1, 1], aCell: sky, aExit: exitAttr});
  const yb = V.y0, yt = V.y1 - 0.05, wb = V.w1 - 0.05, wn = B;
  bk([[V.u0, yb, wb], [V.u1, yb, wb], [V.u1, yt, wb], [V.u0, yt, wb]], [0, 0, -1]);
  bk([[V.u0 + 0.05, yb, wn], [V.u0 + 0.05, yb, wb], [V.u0 + 0.05, yt, wb], [V.u0 + 0.05, yt, wn]], [1, 0, 0]);
  bk([[V.u1 - 0.05, yb, wb], [V.u1 - 0.05, yb, wn], [V.u1 - 0.05, yt, wn], [V.u1 - 0.05, yt, wb]], [-1, 0, 0]);
  bk([[V.u0, yt, wn], [V.u1, yt, wn], [V.u1, yt, wb], [V.u0, yt, wb]], [0, -1, 0]);
  // ---- FOG CARDS ----------------------------------------------------------------------------------------------------------
  const fog = new Acc({position: 3, normal: 3, uv: 2, aExit: 4, aCard: 2});
  const cardTop = Math.min(V.y1 - 0.3, 16);
  for (const c of [...plan.cards].reverse()) {
    fog.quad([[V.u0 + 0.1, cy, c.w], [V.u1 - 0.1, cy, c.w], [V.u1 - 0.1, cardTop, c.w], [V.u0 + 0.1, cardTop, c.w]], [0, 0, -1], [[0, 0], [1, 0], [1, 1], [0, 1]], {aExit: exitAttr, aCard: [c.opacity, 0]});
  }
  const gw0 = B + 0.4, gw1 = V.w1 - 1;
  if (gw1 > gw0 + 1) fog.quad([[V.u0 + 0.1, plan.ground.y, gw0], [V.u1 - 0.1, plan.ground.y, gw0], [V.u1 - 0.1, plan.ground.y, gw1], [V.u0 + 0.1, plan.ground.y, gw1]], [0, 1, 0], [[0, 0.5], [1, 0.5], [1, 0.5], [0, 0.5]], {aExit: exitAttr, aCard: [plan.ground.opacity, 1]});
  // ---- meshes -------------------------------------------------------------------------------------------------------------
  const aperture = windowApertureOf(s);
  const levels = s.bands.map(b => b.level);
  const out: THREE.Mesh[] = [];
  const named = (m: THREE.Mesh | null, part: string, order?: number) => {
    if (!m) return;
    m.name = `mall-window-${s.id}-${part}`;
    m.userData.levels = levels;
    m.userData.aperture = aperture;
    m.userData.windowWall = s.id;
    if (order !== undefined) m.renderOrder = order;
    out.push(m);
  };
  named(frame.mesh(f, streetExitFrameMaterial(), 'frame'), 'frame');
  named(street.mesh(f, streetExitMaterial(), 'lot'), 'lot');
  named(fog.mesh(f, streetFogCardMaterial(), 'fog'), 'fog', MALL_EXT_ORDER.gas);
  const triangles = out.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  const views = out.length;
  const vd = vehicleMeshes(f, vehicles, models, exitAttr, s.view);
  for (const m of vd.meshes) named(m, m.name);
  return {
    meshes: out, plan, aperture, frame: f,
    stats: {id: s.id, meshes: views, triangles, panes, bays, stalls, cars: vd.drawn, storeys: s.bands.length, carSpots: spots.length, vehicleDraws: vd.meshes.length, vehicleTriangles: vd.triangles, vehicleModels: vd.byKey},
  };
}
