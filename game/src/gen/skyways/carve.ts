// Task studio-skyways-level-20261106-054448-01 (primary): carving of a Skyways level into ONE Kit (three storey grids), canvas cells,
// before the crop. Pure data (gen/skyways/index.ts crops, links, rails, dresses, populates, validates).
//
// Layout-variety pass (task studio-skyways-layout-variety-20261106-054448-01): every building is carved after its frame PLAN —
//  - court: a central lobby court (the atrium buildings), one public run on an edge;
//  - galleria: a long spine hall through the building (the station's: a wide concourse hall), its street doors at the spine's ends
//    (a through-passage), one or two runs along its long wall;
//  - offset: a court in the corner toward its bridges, entrance halls / lookouts aligned with its outer edges out to the far facades
//    (an L / T of public space);
//  - cross: a small central court with arms out to (almost) every facade.
// Then circulation that differs per building and storey: dead-end shop ARCADES off the lobbies, SERVICE CORRIDORS lined with back
// rooms (or an office suite), the FOOD COURT (food counters round a seated court), UNDERGROUND PEDWAYS from the station concourse
// (to the station row's neighbours and north under the street) that end in an open stair well inside the neighbour's lobby, the
// station transit well on either long edge of its hub, run lane make-ups from a single stair to a grand stair or escalator pairs,
// and the ONE add-on attached straight to its host's lobby or through a foyer, on the skyway level or (the convention) as a
// double-height street-level ballroom.
//
// Order:
//  1. per building: its hub after the plan, the atrium opening, its wells (the station transit well, the public run(s) 1 -> 2, the
//     pedway stair well 0 -> 1 of a pedway building);
//  2. the station: the pedway concourse round the transit well (storey 0), the station block (Kit.sideBlock: two side platforms on one
//     double bed) with wide openings from the north platform, the transit run;
//  3. the underground pedways (storey 0 tunnels to each pedway building's stair well; a pedway that does not fit is dropped before the
//     hubs are carved);
//  4. hub areas (street + skyway level) round the wells, the runs;
//  5. the BRIDGES (one deck per frame edge at the skyway level, laterally inside both hubs' spans after the frame's preference,
//     straight corridors from each hub to its facade, wide openings through both facade walls);
//  6. the ONE add-on hall (its host's lobby side, its storey, direct or through a foyer);
//  7. per building: street-level entrance halls / skyway lookouts after the plan, arcades, service corridors / the office suite;
//  8. the ramen restaurant; 9. storefront units (the food court's counters), washrooms, back of house, the pedways' kiosks;
//  10. the glazing records (bridge sides, entrance halls, lookouts, the add-on hall's facade: SkywaysWindow spans in solid wall runs).

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR, SOLID, VOID} from '../grid';
import {Kit, type TrackBlock} from '../stationKit';
import {layStairRun, transitSpecs, type StairFlight, type StairSpec} from '../traversal';
import {STORE_PURPOSES} from '../purposes';
import type {Area, Rect, ShopUse, Side, Storefront} from '../stationTypes';
import {BASES, CLEAR, STOREY, type FrameBuilding, type RunLanes, type SkywaysFrame} from './frame';
import type {SkywaysAddonId, SkywaysAnchorFormat, SkywaysBridgeRoof, SkywaysLandmarkFamily, SkywaysOfficeRole, SkywaysPlan, SkywaysShopFamily, SkywaysVenueRole} from './skywaysTypes';
import {SKYWAYS_RAMEN_PURPOSE} from './ramenPurposes';
import {decompose} from '../mall/skeleton';

const r2 = (v: number) => Math.round(v * 100) / 100;
export type CellRect = Rect;

/** Transit specs of one 5 m storey (the mall's / office's 30-degree pitch). */
export const RUN = transitSpecs(STOREY);
/** Cells of a stair run (pitch + top landing) for one storey. */
export const RUN_CELLS = RUN.cells;
// (layout version 3: a fixed stair lane is 3 m — the prize car's 2.6 m clear width between rails / balustrades; GAME77's were 2.5 m)
const LANE_W = {escalator: 3, stair: 6} as const;
/** (layout version 3) Straight run-out (cells) of flat hub floor kept beyond both ends of a public run where the hub allows: 6 m (a
 *  4.8 m prize car lines up with the flight; gen/skyways/index.ts holds it clear of props during the station dress). */
export const RUN_OUT = 12;
/** Open stair wells' ramp headroom (capped by the well's ceiling: Ramp.capCeil). */
const RUN_OPEN_HEADROOM = 40;
const lanesW = (l: RunLanes) => l.reduce((q, k) => q + LANE_W[k], 0);

export interface RunLaneCarve { kind: 'escalator' | 'stair'; rect: CellRect; flights: number[] }
/** A vertical run between storey `lower` and `lower + 1`. */
export interface RunCarve {
  id: string;
  lower: number;
  rect: CellRect;
  axis: 'x' | 'z';
  /** The TOP end of the run (layStairRun `from`). */
  from: 'lo' | 'hi';
  lanes: RunLaneCarve[];
  area: number;
  /** Enclosed core (walls both sides) vs an open well (railed). */
  enclosed: boolean;
  building: string;
}

export interface BridgeCarve { id: string; a: string; b: string; axis: 'x' | 'z'; rect: CellRect; area: number; breached: boolean; width: number; roof?: SkywaysBridgeRoof }

/** (task studio-skyways-rework-20261107-054512-01) a bridge's glazed roof: its own stream per bridge (no other roll moves), the cross-
 *  section weighted toward the faceted / vaulted glass tubes of the reference, heights (absolute) from the deck width (m). */
export function bridgeRoofOf(seed: number, id: string, widthM: number): SkywaysBridgeRoof {
  const r = new Rng(hashString(`skyways:bridge-roof:${id}`, seed >>> 0));
  const style = r.weighted([['faceted', 0.35], ['vault', 0.3], ['gable', 0.2], ['flat', 0.15]] as const);
  const spring = style === 'flat' ? 3.4 : style === 'gable' ? 2.8 : style === 'vault' ? 2.7 : 2.4;
  const rise = style === 'flat' ? 0.25 : style === 'gable' ? Math.min(widthM * 0.35, 1.8) : style === 'vault' ? Math.min(widthM / 2, 2.4) : Math.min(widthM * 0.45, 2.6);
  return {style, springY: r2(BASES[2] + spring), apexY: r2(BASES[2] + spring + rise), rib: style === 'flat' ? 2.4 : 1.8};
}

export interface WindowCarve {
  /** Wall cells (canvas) of the span and its outward side. */
  rect: CellRect;
  side: Side;
  level: number;
  sill: number;
  head: number;
  kind: 'window' | 'entrance';
  host: {bridge: string} | {building: string};
  breached?: boolean;
}

/** An open well inside a hub (rect, the axis it climbs along, its lanes, its lower storey, its top end). */
export interface WellPlan { id: string; rect: CellRect; axis: 'x' | 'z'; lanes: RunLanes; lower: number; from: 'lo' | 'hi' }

export interface BuildingCarve {
  b: FrameBuilding;
  plan: SkywaysPlan;
  /** Interior (inside the wall ring). */
  I: CellRect;
  hub: CellRect;
  /** Skyway-level atrium opening (inside the hub). */
  atrium: CellRect | null;
  /** Public areas per storey (hub pieces, corridors, halls). */
  publicAreas: Map<number, number[]>;
  /** The open public run(s) between the street and skyway levels inside the hub (the first is the main one). */
  runs12: WellPlan[];
  /** The station building's transit well (storey 0 -> 1) inside its hub, or null. */
  transit: WellPlan | null;
  /** A pedway building's stair well down to the underground pedway (storey 0 -> 1) inside its hub, or null. */
  down: WellPlan | null;
  /** The hub areas per storey (the food court's court: the largest). */
  hubAreas: Map<number, number[]>;
  /** The bridges' landing mouths on the hub (skyway level): the runs keep clear of them. */
  mouths: CellRect[];
}

export interface AddonCarve {
  id: SkywaysAddonId;
  building: string;
  level: number;
  approach: 'direct' | 'foyer';
  hall: CellRect;
  hallArea: number;
  areas: number[];
  entry: CellRect;
  /** The foyer between the lobby and the hall (approach 'foyer'). */
  foyer: CellRect | null;
  stage: CellRect | null;
  /** Prize car: the car's spot (cells, centre) and heading (rad, camera convention). */
  car: {cx: number; cy: number; yaw: number} | null;
  washrooms: number[];
  /** (layout version 3) the convention VENUE's areas by role (the host's whole skyway floor). */
  venue?: VenueRoomCarve[];
}

/** (layout version 3) A tenant's office wing (gen/skyways/officeWing.ts dresses it). */
export interface OfficeWingCarve { building: string; level: number; tenant: string; rooms: {role: SkywaysOfficeRole; area: number}[] }
/** Original tenant names of the office wings (fictional companies). */
export const OFFICE_TENANTS = ['Chinook Analytics', 'Bow River Mutual', 'Parkland Engineering', 'Foothills Legal Group', 'Prairie Sky Software', 'Elbow Valley Energy', 'Aspen & Coulee Architects', 'Nose Hill Logistics'];

/** (layout version 3) One area of the convention venue and what it is for. */
export interface VenueRoomCarve { role: SkywaysVenueRole; area: number }

export interface RamenCarve { building: string; level: number; dining: number; kitchen: number }

/** A destination ANCHOR shop as carved (cells). */
export interface AnchorCarve {
  id: string; family: SkywaysShopFamily; name: string; building: string; level: number; format: SkywaysAnchorFormat;
  floor: number; rect: CellRect; storefront: number; front: Side; upper: number | null; zones: number[]; stock: number[]; ceilY: number;
}
/** A LANDMARK court (cells): its centrepiece's spot and clearances. */
export interface LandmarkCarve {
  id: string; family: SkywaysLandmarkFamily; name: string; building: string; level: number; area: number; cx: number; cy: number;
  radius: number; height: number; atrium: boolean; axis: 'x' | 'z';
}

/** Per destination family: its printed name, the base purpose its front borrows (fascia colours / loot class), its formats
 *  (weights; tried in turn, then a plain hall) and its sales floor size range (cells: along the front x deep). */
export const ANCHOR_FAMILIES: Record<SkywaysShopFamily, {name: string; use: ShopUse; formats: [SkywaysAnchorFormat, number][]; along: [number, number]; deep: [number, number]; color: number}> = {
  books: {name: 'Paper Prairie Books', use: 'newsstand', formats: [['two-level', 0.65], ['hall', 0.35]], along: [26, 44], deep: [18, 28], color: 0x5b3a29},
  outfitter: {name: 'Coulee & Canoe Outfitters', use: 'convenience', formats: [['double-height', 0.7], ['hall', 0.3]], along: [28, 46], deep: [20, 30], color: 0x2e5d34},
  music: {name: 'Northern Groove Records', use: 'tech', formats: [['multi-zone', 0.7], ['hall', 0.3]], along: [26, 40], deep: [20, 28], color: 0x3a2c5c},
  hobby: {name: 'Grain Elevator Models', use: 'tech', formats: [['hall', 1]], along: [24, 38], deep: [18, 26], color: 0x8a5a1c},
  design: {name: 'Larch & Loom Home', use: 'florist', formats: [['two-level', 0.5], ['hall', 0.5]], along: [30, 48], deep: [20, 30], color: 0x6d6a5f},
  garden: {name: 'Glasshouse Garden Co.', use: 'florist', formats: [['double-height', 0.65], ['hall', 0.35]], along: [26, 42], deep: [18, 28], color: 0x3f7a4a},
  arcade: {name: 'Starfall Arcade', use: 'tech', formats: [['hall', 1]], along: [28, 44], deep: [18, 28], color: 0x7b1fa2},
  cinema: {name: 'Aurora Picture House', use: 'newsstand', formats: [['multi-zone', 1]], along: [30, 44], deep: [28, 36], color: 0x8e1c2b},
  science: {name: 'Big Sky Wonders', use: 'tech', formats: [['double-height', 0.6], ['hall', 0.4]], along: [26, 42], deep: [18, 28], color: 0x1f4e79},
  hockey: {name: 'Blue Line Sports', use: 'convenience', formats: [['hall', 1]], along: [24, 36], deep: [16, 24], color: 0x1d3f8f},
};
/** Clear heights (m) of the anchor formats' sales floors (double height: up through the skyway storey). */
export const ANCHOR_CLEAR = {hall: [4.3, 3.9], doubleHeight: 7.5} as const;

/** Per landmark family: the court's name, footprint clear radius (m), height above the floor (m), where it can stand. */
export const LANDMARK_FAMILIES: Record<SkywaysLandmarkFamily, {name: string; radius: number; height: number; atriumOnly: boolean; long?: number}> = {
  // (measured on the kit models: lane KITS; heights are the clear height they need, radii their floor footprint)
  clock: {name: 'Clock Court', radius: 1.2, height: 5.6, atriumOnly: true},
  dinosaur: {name: 'Badlands Court', radius: 1.3, height: 2.6, atriumOnly: false, long: 7.5},
  'fig-tree': {name: 'Fig Tree Court', radius: 2.8, height: 7.0, atriumOnly: true},
  fountain: {name: 'Fountain Court', radius: 2.4, height: 3.9, atriumOnly: false},
  geese: {name: 'Flight Court', radius: 1.2, height: 9.0, atriumOnly: true},
  orrery: {name: 'Orrery Court', radius: 1.2, height: 3.1, atriumOnly: false},
};

export interface SkywaysCarve {
  f: SkywaysFrame;
  block: TrackBlock;
  concourse: Area;
  runs: RunCarve[];
  bridges: BridgeCarve[];
  buildings: BuildingCarve[];
  windows: WindowCarve[];
  storefronts: Storefront[];
  addon: AddonCarve;
  ramen: RamenCarve | null;
  /** Buildings the underground pedways reach (carved). */
  pedways: string[];
  /** The food court (carved): building, storey, court area. */
  foodCourt: {building: string; level: number; area: number} | null;
  /** (destinations pass) The anchor shops and the landmark courts. */
  anchors: AnchorCarve[];
  landmarks: LandmarkCarve[];
  /** (layout version 3) a tenant's office wing, or null. */
  officeWing: OfficeWingCarve | null;
  /** Carved extent (canvas cells). */
  X0: number; Z0: number; X1: number; Z1: number;
  /** Atrium court roof height (absolute y). */
  roofY: number;
  fail?: string;
}

let FAIL = '';
/** Why the last carve returned null (QA / tests). */
export const lastSkywaysCarveFail = (): string => FAIL;
const fail = (why: string): null => { FAIL = why; return null; };

const overlapsR = (a: CellRect, b: CellRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inRect = (r: CellRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const within = (outer: CellRect, r: CellRect) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;
const grow = (r: CellRect, d: number): CellRect => ({x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d});
const interiorOf = (b: FrameBuilding): CellRect => ({x: b.x + 1, y: b.y + 1, w: b.w - 2, h: b.h - 2});
const opposite = (s: Side): Side => (s === 'N' ? 'S' : s === 'S' ? 'N' : s === 'W' ? 'E' : 'W');
const alongXSide = (s: Side) => s === 'N' || s === 'S';

/** Rect beyond `r`'s side `s` (one wall cell between): `t` cells along from the side's start, `along` long, `deep` deep. */
function beyond(r: CellRect, s: Side, t: number, along: number, deep: number): CellRect {
  if (s === 'N') return {x: r.x + t, y: r.y - 1 - deep, w: along, h: deep};
  if (s === 'S') return {x: r.x + t, y: r.y + r.h + 1, w: along, h: deep};
  if (s === 'W') return {x: r.x - 1 - deep, y: r.y + t, w: deep, h: along};
  return {x: r.x + r.w + 1, y: r.y + t, w: deep, h: along};
}
/** Rect directly against `r`'s side `s` (no wall between: an open continuation): from absolute lateral `lat`, `width` wide, `len` long. */
function against(r: CellRect, s: Side, lat: number, width: number, len: number): CellRect {
  if (s === 'N') return {x: lat, y: r.y - len, w: width, h: len};
  if (s === 'S') return {x: lat, y: r.y + r.h, w: width, h: len};
  if (s === 'W') return {x: r.x - len, y: lat, w: len, h: width};
  return {x: r.x + r.w, y: lat, w: len, h: width};
}
/** The one-cell wall slice between `r` and a rect beyond it on side `s` (from `t`, `along` long). */
function gapOn(r: CellRect, s: Side, t: number, along: number): CellRect {
  if (s === 'N') return {x: r.x + t, y: r.y - 1, w: along, h: 1};
  if (s === 'S') return {x: r.x + t, y: r.y + r.h, w: along, h: 1};
  if (s === 'W') return {x: r.x - 1, y: r.y + t, w: 1, h: along};
  return {x: r.x + r.w, y: r.y + t, w: 1, h: along};
}
const sideLen = (r: CellRect, s: Side) => (alongXSide(s) ? r.w : r.h);
const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];

/** Carves the whole Skyways level. Null when the frame does not fit (the caller re-rolls the frame's free parameters). */
export function carveSkyways(k: Kit, rng: Rng, f: SkywaysFrame, opts: {legacy?: boolean} = {}): SkywaysCarve | null {
  FAIL = '';
  /** Layout version 1 (gen/skyways/layoutVersion.ts): GAME76's program exactly — no destinations, its arcade / shop / back-room rolls. */
  const legacy = !!opts.legacy;
  let shopSerial = 0;
  const shopName = (use: ShopUse): string => { const list = STORE_PURPOSES[use].names; return list[(shopSerial++ + f.seed) % list.length]; };
  const byId = new Map(f.buildings.map(b => [b.id, b]));
  const station = byId.get(f.station)!;
  const roofY = r2(BASES[2] + CLEAR.atriumRoof);
  const carves = new Map<string, BuildingCarve>();
  const runs: RunCarve[] = [];
  const storefronts: Storefront[] = [];
  const windows: WindowCarve[] = [];
  const addPublic = (bc: BuildingCarve, level: number, id: number) => { let l = bc.publicAreas.get(level); if (!l) bc.publicAreas.set(level, (l = [])); l.push(id); };
  const ceilOf = (level: number, clear: number) => r2(BASES[level] + clear);
  const opt = (level: number) => (level ? {level, floorY: BASES[level]} : {});
  const free = (r: CellRect, level: number, inside?: CellRect) => (!inside || within(inside, r)) && k.rectFree(r, level);
  /** The facade side of `b` toward building `o` across a bridge of `axis`. */
  const sideToward = (b: FrameBuilding, o: FrameBuilding, axis: 'x' | 'z'): Side => (axis === 'x' ? (o.x > b.x ? 'E' : 'W') : (o.y > b.y ? 'S' : 'N'));
  const bridgedSidesOf = (b: FrameBuilding) => new Set<Side>(f.bridges.filter(q => q.a === b.id || q.b === b.id).map(q => sideToward(b, byId.get(q.a === b.id ? q.b : q.a)!, q.axis)));
  /** Cells kept open air on the skyway level while carving (atrium openings, a street-level ballroom's double height): rock again at the end. */
  const airCells: number[] = [];
  const g2a = k.grid(2);
  /** Bridge landings of the current lateral try (committed to their buildings when the bridge is carved). */
  let pendingMouths: {bc: BuildingCarve; rect: CellRect}[] = [];
  /** The hub areas exist (before: a mouth is checked against the planned wells only). */
  let hubsCarved = false;
  const mouthRect = (hub: CellRect, side: Side, lat0: number, width: number): CellRect => side === 'E' ? {x: hub.x + hub.w - 4, y: lat0, w: 4, h: width} : side === 'W' ? {x: hub.x, y: lat0, w: 4, h: width}
    : side === 'N' ? {x: lat0, y: hub.y, w: width, h: 4} : {x: lat0, y: hub.y + hub.h - 4, w: width, h: 4};
  const keepAir = (r: CellRect) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = g2a.idx(x, y); if (g2a.cells[i] === SOLID) { g2a.cells[i] = VOID; airCells.push(i); } } };

  // --- 1. Hubs and wells (per building plan) -------------------------------------------------------------------------------------
  for (const b of f.buildings) {
    const I = interiorOf(b), isSt = b.id === station.id, host = b.id === f.addonHost;
    // (layout version 3) the prize display stands in the host's own skyway court: no hall beyond it, so the host's hub keeps its size
    const hostHall = host && (legacy || f.addon !== 'prize-car');
    const mg = isSt ? 8 : 10;
    const bridged = bridgedSidesOf(b);
    const hostSide = hostHall ? [...bridged][0] ?? null : null;
    let hub: CellRect;
    // (layout version 3: atria on most buildings) a galleria needs a long, wide enough interior; else the building takes a court plan
    if (!legacy && b.plan === 'galleria' && !isSt && !host) {
      const ax = b.axis === 'x', L = ax ? I.w : I.h, A = ax ? I.h : I.w;
      if (A - 2 * mg < (b.atrium ? 22 : 16) || L - 2 * (mg + 4) < RUN_CELLS + 14) b.plan = 'court';
    }
    if (b.plan === 'galleria') {
      // a long spine hall through the building (both storeys); the host's spine runs in from its one bridge and stops short of
      // the far end (the add-on hall takes it)
      const ax = b.axis === 'x', L = ax ? I.w : I.h, A = ax ? I.h : I.w, s0 = ax ? I.x : I.y, c00 = ax ? I.y : I.x;
      let len = L - 2 * rng.int(mg, mg + 4);
      // (layout version 3: an atrium galleria's spine is wider: walkways either side of its long glazed opening)
      const wid = Math.min(A - 2 * mg, isSt ? rng.int(36, 42) : b.atrium && !legacy ? rng.int(22, 28) : rng.int(17, 22));
      let a0 = s0 + Math.round((L - len) / 2);
      if (hostHall && hostSide) {
        len = Math.max(RUN_CELLS + 14, Math.round(L * rng.range(0.48, 0.58)));
        a0 = hostSide === (ax ? 'W' : 'N') ? s0 + mg : s0 + L - mg - len;
      }
      const c0 = Math.max(c00 + mg, Math.min(c00 + A - mg - wid, c00 + Math.round((A - wid) / 2) + rng.int(-3, 3)));
      hub = ax ? {x: a0, y: c0, w: len, h: wid} : {x: c0, y: a0, w: wid, h: len};
      if (wid < 16 || len < RUN_CELLS + 14) return fail(`hub-${b.id}`);
    } else {
      let hw: number, hd: number;
      if (b.plan === 'cross') { hw = Math.max(30, Math.round(I.w * rng.range(0.4, 0.48))); hd = Math.max(28, Math.round(I.h * rng.range(0.4, 0.48))); }
      else if (b.plan === 'offset') { hw = Math.round(I.w * rng.range(0.42, 0.52)); hd = Math.round(I.h * rng.range(0.42, 0.52)); }
      else { hw = Math.round(I.w * rng.range(0.48, 0.6)); hd = Math.round(I.h * rng.range(0.46, 0.58)); }
      if (b.atrium) { hw = Math.max(hw, 36); hd = Math.max(hd, 32); }
      if (hostHall) { hw = Math.min(hw, 30); hd = Math.min(hd, 28); }
      // a foyer approach: the host lobby is wider along its far side (the foyer beside the run, never onto it)
      if (hostHall && f.addonApproach === 'foyer' && hostSide) {
        if (hostSide === 'W' || hostSide === 'E') { hw = Math.min(hw, 28); hd = Math.min(Math.max(hd, 32), 34); } else { hw = Math.min(Math.max(hw, 32), 34); hd = Math.min(hd, 28); }
      }
      hw = Math.max(28, Math.min(hw, I.w - (isSt ? 16 : 20)));
      hd = Math.max(26, Math.min(hd, I.h - (isSt ? 16 : 20)));
      if (isSt) { hw = Math.max(hw, Math.min(I.w - 16, 46)); hd = Math.max(hd, Math.min(I.h - 16, 40)); } // both wells + a walkway
      let hx = I.x + Math.round((I.w - hw) / 2) + rng.int(-3, 3);
      let hy = I.y + Math.round((I.h - hd) / 2) + rng.int(-3, 3);
      if (b.plan === 'offset') {
        hx = b.corner & 1 ? I.x + I.w - mg - hw : I.x + mg;
        hy = b.corner & 2 ? I.y + I.h - mg - hd : I.y + mg;
      }
      if (hostHall && hostSide) {
        // the add-on hall takes the far side of the host: push the hub toward the host's bridge
        const m = f.addonApproach === 'foyer' ? 6 : 10;
        if (hostSide === 'W') hx = I.x + m; else if (hostSide === 'E') hx = I.x + I.w - m - hw;
        else if (hostSide === 'N') hy = I.y + m; else hy = I.y + I.h - m - hd;
      }
      const mh = hostHall ? 6 : mg;
      hx = Math.max(I.x + mh, Math.min(hx, I.x + I.w - mh - hw));
      hy = Math.max(I.y + mh, Math.min(hy, I.y + I.h - mh - hd));
      if (hw < 26 || hd < 24) return fail(`hub-${b.id}`);
      hub = {x: hx, y: hy, w: hw, h: hd};
    }
    let atrium: CellRect | null = null;
    if (b.atrium && b.plan === 'court') {
      const g = rng.int(7, 9);
      atrium = {x: hub.x + g, y: hub.y + g, w: hub.w - 2 * g, h: hub.h - 2 * g};
      if (atrium.w < 12 || atrium.h < 10) atrium = null;
    } else if (b.atrium && b.plan === 'galleria' && !legacy) {
      // (layout version 3) a GALLERIA atrium: the spine's long glazed opening, skyway walkways along both long sides, landings at its ends
      const ax = b.axis === 'x', gA = rng.int(5, 6), gL = rng.int(6, 10);
      atrium = ax ? {x: hub.x + gL, y: hub.y + gA, w: hub.w - 2 * gL, h: hub.h - 2 * gA} : {x: hub.x + gA, y: hub.y + gL, w: hub.w - 2 * gA, h: hub.h - 2 * gL};
      if (Math.min(atrium.w, atrium.h) < 8 || Math.max(atrium.w, atrium.h) < 18) atrium = null;
    }
    const edgeLen = (s: Side) => sideLen(hub, s);
    const wells: WellPlan[] = [];
    // (an atrium opening shrinks away from the runs below; only the wells keep apart)
    const clashes = (r: CellRect) => wells.some(w => overlapsR(grow(w.rect, 3), r));
    /** An open well hugging hub edge `s`: `len` along it from fraction `at`, `lw` deep, inside the hub, clear of the other wells. */
    const wellOn = (s: Side, lw: number, at: number, len = RUN_CELLS): CellRect | null => {
      const ax = alongXSide(s), L = edgeLen(s);
      // (layout version 3) a straight run-out of RUN_OUT cells of hub floor beyond both ends where the edge allows (the old 4 else)
      for (const m of legacy ? [4] : [RUN_OUT, 4]) {
        if (L < len + 2 * m) continue;
        const lo = (ax ? hub.x : hub.y) + m, hi = (ax ? hub.x : hub.y) + L - m - len;
        const tries = [at, 0.5, 0.15, 0.85, 0.3, 0.7, 0.02, 0.98];
        for (const t of tries) {
          const a0 = Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, t)));
          const atLow = s === 'N' || s === 'W';
          const r: CellRect = ax ? {x: a0, y: atLow ? hub.y : hub.y + hub.h - lw, w: len, h: lw} : {x: atLow ? hub.x : hub.x + hub.w - lw, y: a0, w: lw, h: len};
          if (!clashes(r)) return r;
        }
      }
      return null;
    };
    // the station's TRANSIT well: an open well along the hub's north or south edge (the mall's court escalators), climbing along X
    // from the pedway concourse under the hub (storey 0) to the lobby floor
    let transit: WellPlan | null = null;
    if (isSt) {
      const tr = wellOn(f.transitEdge, lanesW(f.transitLanes), f.transitAt);
      if (!tr || tr.x < hub.x + 4 || tr.x + tr.w > hub.x + hub.w - 4) return fail('transit-well');
      transit = {id: 'transit', rect: tr, axis: 'x', lanes: f.transitLanes, lower: 0, from: rng.chance(0.5) ? 'lo' : 'hi'};
      wells.push(transit);
    }
    carves.set(b.id, {b, plan: b.plan, I, hub, atrium, publicAreas: new Map(), runs12: [], transit, down: null, hubAreas: new Map(), mouths: []});
  }

  // --- 1b. Bridges (before the runs: a run fits round the bridges' landings, never the other way round) ---------------------------
  const bridges: BridgeCarve[] = [];
  for (const e of f.bridges) {
    const A = carves.get(e.a)!, B = carves.get(e.b)!;
    // a = west / north, b = east / south
    const [W0, E0] = e.axis === 'x' ? (A.b.x < B.b.x ? [A, B] : [B, A]) : (A.b.y < B.b.y ? [A, B] : [B, A]);
    // the lateral span both lobbies share (straight corridors) and the span both buildings share (a corridor may JOG along the
    // lobby side to a landing beyond the lobby's span)
    const lo = e.axis === 'x' ? Math.max(W0.hub.y, E0.hub.y) : Math.max(W0.hub.x, E0.hub.x);
    const hi = e.axis === 'x' ? Math.min(W0.hub.y + W0.hub.h, E0.hub.y + E0.hub.h) : Math.min(W0.hub.x + W0.hub.w, E0.hub.x + E0.hub.w);
    const ilo = (e.axis === 'x' ? Math.max(W0.I.y, E0.I.y) : Math.max(W0.I.x, E0.I.x)) + 3;
    const ihi = (e.axis === 'x' ? Math.min(W0.I.y + W0.I.h, E0.I.y + E0.I.h) : Math.min(W0.I.x + W0.I.w, E0.I.x + E0.I.w)) - 3;
    let width = e.width;
    if (Math.max(hi - lo - 2, ihi - ilo) < width) width = Math.max(hi - lo - 2, ihi - ilo);
    if (width < 10) return fail(`bridge-overlap-${e.id}`);
    // corridors of other bridges / the runs on these sides must not overlap: try lateral positions, the frame's preference first
    // (centred on the lobbies' shared span, or toward either end of the buildings' shared span: a jogged landing near a corner)
    let done: BridgeCarve | null = null;
    let why = 'none';
    const cands: number[] = [];
    for (let t = ilo; t + width <= ihi; t++) cands.push(t);
    const want = e.lateral === 'low' ? ilo + rng.int(0, 6) : e.lateral === 'high' ? ihi - width - rng.int(0, 6) : (hi - lo - 2 >= width ? (lo + hi - width) / 2 : (ilo + ihi - width) / 2);
    cands.sort((p, q) => Math.abs(p - want) - Math.abs(q - want) || p - q);
    const pickFrom = rng.shuffle(cands.slice(0, Math.min(4, cands.length))).concat(cands.slice(4));
    for (const lat of pickFrom) {
      const sa: Side = e.axis === 'x' ? 'E' : 'S', sb: Side = e.axis === 'x' ? 'W' : 'N';
      const deck: CellRect = e.axis === 'x'
        ? {x: W0.b.x + W0.b.w, y: lat, w: E0.b.x - (W0.b.x + W0.b.w), h: width}
        : {x: lat, y: W0.b.y + W0.b.h, w: width, h: E0.b.y - (W0.b.y + W0.b.h)};
      if (deck.w < 4 || deck.h < 4) return fail(`bridge-street-${e.id}`);
      if (!k.solid(deck, 2)) { why = 'deck'; continue; }
      const n0 = k.areas.length, made: Area[] = [];
      pendingMouths = [];
      const undo = () => { while (k.areas.length > n0) k.undoLast(k.areas[k.areas.length - 1]); };
      const ca = corridorTo(W0, 2, sa, lat, width, `Skyway concourse · ${bName(W0.b)}`, 'mall', made);
      if (!ca) { undo(); why = `corridor-${W0.b.id}`; continue; }
      const cb = corridorTo(E0, 2, sb, lat, width, `Skyway concourse · ${bName(E0.b)}`, 'mall', made);
      if (!cb) { undo(); why = `corridor-${E0.b.id}`; continue; }
      const wide = width >= 15;
      // (layout version 3) a glazed roof over the deck: the deck's ceiling is its apex
      const roof = legacy ? undefined : bridgeRoofOf(f.seed, e.id, width * CELL);
      const dk = k.addArea(deck, 'passage', 'passage', roof ? roof.apexY : ceilOf(2, CLEAR.bridge + (wide ? 0.4 : 0)), -1, {...opt(2), label: `${wide ? 'Skyway gallery bridge' : 'Skyway bridge'} · ${bName(W0.b)} – ${bName(E0.b)}`, publicSpace: true, role: 'crossover'});
      // wide openings through both facade walls (the full width less a pier each side)
      const ga: CellRect = e.axis === 'x' ? {x: W0.b.x + W0.b.w - 1, y: lat + 1, w: 1, h: width - 2} : {x: lat + 1, y: W0.b.y + W0.b.h - 1, w: width - 2, h: 1};
      const gb: CellRect = e.axis === 'x' ? {x: E0.b.x, y: lat + 1, w: 1, h: width - 2} : {x: lat + 1, y: E0.b.y, w: width - 2, h: 1};
      k.carveDoor(ga, ca, dk, CLEAR.wide, false);
      k.carveDoor(gb, dk, cb, CLEAR.wide, false);
      for (const a of made) addPublic(carves.get(a.label.endsWith(bName(W0.b)) ? W0.b.id : E0.b.id)!, 2, a.id);
      for (const m of pendingMouths) m.bc.mouths.push(m.rect);
      done = {id: e.id, a: e.a, b: e.b, axis: e.axis, rect: deck, area: dk.id, breached: e.breached, width, ...(roof ? {roof} : {})};
      break;
    }
    if (!done) return fail(`bridge-${e.id}-${why}-${cands.length}`);
    bridges.push(done);
    // glazing: both long sides of the deck, in spans of at most 16 cells (8 m) with a one-cell pier
    const along = e.axis === 'x' ? done.rect.w : done.rect.h;
    for (const s of (e.axis === 'x' ? ['N', 'S'] : ['W', 'E']) as Side[]) {
      for (const [t0, t1] of spans(1, along - 1, 16)) {
        const strip = e.axis === 'x' ? {x: done.rect.x + t0, y: s === 'N' ? done.rect.y - 1 : done.rect.y + done.rect.h, w: t1 - t0, h: 1}
          : {x: s === 'W' ? done.rect.x - 1 : done.rect.x + done.rect.w, y: done.rect.y + t0, w: 1, h: t1 - t0};
        // (layout version 3: the side glazing runs up to the roof's springing line)
        const head = done.roof ? r2(done.roof.springY - BASES[2] - 0.05) : 3.1;
        windows.push({rect: strip, side: s, level: 2, sill: 0.45, head, kind: 'window', host: {bridge: e.id}, ...(e.breached ? {breached: true} : {})});
      }
    }
  }

  // --- 1c. Wells: the public run(s) 1 -> 2 and a pedway building's stair well 0 -> 1, clear of the bridges' landings ---------------
  // (layout version 3) a building whose wells do not fit round its atrium opening keeps its runs and loses the opening
  for (const bc of carves.values()) if (!placeWells(bc) && (legacy || !bc.atrium || ((bc.atrium = null), !placeWells(bc)))) return fail(`hub-run-${bc.b.id}`);

  // the skyway-level cells of every atrium opening stay open air: no later room may be carved into them (rock again at the end)
  for (const bc of carves.values()) if (bc.atrium) keepAir(bc.atrium);

  // --- 2. Station: concourse, station block, transit run -------------------------------------------------------------------------
  const sc = carves.get(station.id)!;
  const T = sc.transit!.rect;
  // the pedway concourse (storey 0) under the station hub: round the transit well (both its mouths on concourse floor), on south to
  // the station block
  const cw = Math.max(T.w + 24, rng.int(64, 90)), Dc = rng.int(10, 14);
  const C0rect: CellRect = {x: T.x + Math.round(T.w / 2 - cw / 2) + rng.int(-6, 6), y: T.y - rng.int(6, 9), w: cw, h: 0};
  if (C0rect.x > T.x - 6) C0rect.x = T.x - 6;
  if (C0rect.x + C0rect.w < T.x + T.w + 6) C0rect.x = T.x + T.w + 6 - C0rect.w;
  C0rect.h = T.y + T.h + Dc - C0rect.y;
  const y0 = C0rect.y + C0rect.h + 1;
  // the platforms centred under the run where the canvas allows (a station building at the west / east edge shifts them)
  const px0 = Math.max(18, Math.min(k.g.w - f.Lp - 18, Math.round(T.x + T.w / 2 - f.Lp / 2) + rng.int(-10, 10)));
  if (px0 - 14 < 2 || px0 + f.Lp + 14 > k.g.w - 2 || y0 + 60 > k.g.h - 2) return fail('station-canvas');
  // carve the concourse before the block (the block's platforms are their own areas); its pieces leave the well's cells to the run
  const conPieces = decompose((x, y) => !inRect(T, x, y), C0rect).sort((p, q) => q.w * q.h - p.w * p.h);
  const concourse = k.addArea(conPieces[0], 'concourse', 'concourse', CLEAR.concourse, -1, {label: 'Pedway concourse', publicSpace: true, role: 'great-hall'});
  addPublic(sc, 0, concourse.id);
  for (const q of conPieces.slice(1)) addPublic(sc, 0, k.addArea(q, 'concourse', 'concourse', CLEAR.concourse, concourse.id, {label: 'Pedway concourse', publicSpace: true, role: 'great-hall'}).id);
  const block = k.sideBlock(px0, y0, f.Lp, CLEAR.platform, ['Platform 1', 'Platform 2']);
  const [P1, P2] = block.platforms;
  for (const t of k.trenches) t.columns = false;
  for (const P of block.platforms) delete P.paid;
  P1.platformNo = 1; P2.platformNo = 2;
  // openings from the north platform into the concourse (wide arches through the shared wall)
  {
    const x0 = Math.max(P2.x + 4, C0rect.x + 2), x1 = Math.min(P2.x + P2.w - 4, C0rect.x + C0rect.w - 2);
    if (x1 - x0 < 16) return fail('platform-concourse');
    const n = x1 - x0 >= 50 ? 3 : 2, ow = rng.int(6, 8);
    for (let i = 0; i < n; i++) {
      const cx = Math.round(x0 + (x1 - x0) * (i + 0.5) / n - ow / 2);
      k.carveDoor({x: cx, y: y0 - 1, w: ow, h: 1}, P2, concourse, CLEAR.wide + 0.6, true);
    }
  }
  const tw = sc.transit!;
  runs.push(carveRun(k, 'transit', station.id, 0, T, 'x', tw.from, tw.lanes, false));

  // --- 3. Underground pedways (storey 0) -----------------------------------------------------------------------------------------
  const pedways: string[] = [];
  const pedwayAreas: number[] = [], addonAreas: number[] = [];
  for (const id of f.lowerLinks) {
    const bc = carves.get(id);
    if (!bc?.down) continue;
    if (!lowerPedway(bc)) bc.down = null; // does not fit: no well in that lobby (it stays hub floor)
    else pedways.push(id);
  }

  // --- 4. Hub areas (street + skyway level), the runs ----------------------------------------------------------------------------
  hubsCarved = true;
  for (const bc of carves.values()) {
    const {b, hub} = bc;
    const isSt = b.id === station.id;
    const wells1 = [...bc.runs12, ...(bc.transit ? [bc.transit] : []), ...(bc.down ? [bc.down] : [])].map(w => w.rect);
    const name1 = isSt ? 'Station lobby' : bc.plan === 'galleria' ? 'Galleria' : 'Lobby';
    const g1 = k.grid(1);
    for (const q of decompose((x, y) => !wells1.some(w => inRect(w, x, y)), hub)) {
      const court = !!bc.atrium && overlapsR(q, bc.atrium);
      const h1 = k.addArea(q, 'concourse', 'concourse', court ? roofY : ceilOf(1, CLEAR.lobby), -1, {...opt(1), label: `${court ? 'Atrium court' : name1} · ${bName(b)}`, publicSpace: true, role: 'great-hall'});
      addPublic(bc, 1, h1.id); hubArea(bc, 1, h1.id);
      // the atrium court: the street-level band under the opening rises to the glass roof; the gallery ring keeps the lobby ceiling
      if (bc.atrium) for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) g1.ceil[g1.idx(x, y)] = inRect(bc.atrium, x, y) ? roofY : ceilOf(1, CLEAR.lobby);
    }
    // the public run(s) (both grids; an open well rising to the skyway ceiling), the pedway stair well
    for (const w of bc.runs12) runs.push(carveRun(k, w.id, b.id, 1, w.rect, w.axis, w.from, w.lanes, false));
    if (bc.down) runs.push(carveRun(k, bc.down.id, b.id, 0, bc.down.rect, bc.down.axis, bc.down.from, bc.down.lanes, false));
    // skyway level: the hub (or its gallery ring round the opening) minus the runs' wells
    const name2 = bc.atrium ? 'Atrium gallery' : bc.plan === 'galleria' ? 'Skyway galleria' : 'Skyway court';
    for (const q of decompose((x, y) => !bc.runs12.some(w => inRect(w.rect, x, y)) && !(bc.atrium && inRect(bc.atrium, x, y)), hub)) {
      const a = k.addArea(q, 'concourse', 'retail-arcade', ceilOf(2, CLEAR.skyway), -1, {...opt(2), label: `${name2} · ${bName(b)}`, publicSpace: true, role: 'mall'});
      addPublic(bc, 2, a.id); hubArea(bc, 2, a.id);
    }
  }

  // (layout version 3) the public runs' run-outs (RUN_OUT cells straight beyond both ends; the head on the upper storey, the foot on the
  // lower): kept plain by the storefronts below
  const runOuts: {level: number; rect: CellRect}[] = [];
  for (const rc of runs) {
    const r = rc.rect, M = RUN_OUT;
    const lo = rc.axis === 'x' ? {x: r.x - M, y: r.y, w: M, h: r.h} : {x: r.x, y: r.y - M, w: r.w, h: M};
    const hi = rc.axis === 'x' ? {x: r.x + r.w, y: r.y, w: M, h: r.h} : {x: r.x, y: r.y + r.h, w: r.w, h: M};
    // 'lo' = the top landing at the low end: the head (upper storey) there, the foot (lower storey) beyond the high end
    runOuts.push({level: rc.lower + 1, rect: rc.from === 'lo' ? lo : hi}, {level: rc.lower, rect: rc.from === 'lo' ? hi : lo});
  }

  // --- 6. The add-on hall --------------------------------------------------------------------------------------------------------
  const hostC = carves.get(f.addonHost)!;
  // (layout version 3) the convention takes its host's whole skyway floor (a VENUE: the bridges lead straight into it); the prize car
  // stands on a public PRIZE DISPLAY in the host's skyway court (no showroom room)
  const venue = !legacy && f.addon === 'convention';
  const addon = venue ? carveVenue(hostC) : !legacy && f.addon === 'prize-car' ? carvePrizeDisplay(hostC) : carveAddon(hostC, f.addon, f.addonLevel, f.addonApproach);
  if (!addon) return fail(`addon-${f.addon}-${f.addonLevel}`);
  addonAreas.push(...addon.areas, ...(addon.venue ?? []).map(v => v.area));

  // (layout version 3) the tenant's OFFICE WING, before the anchors take the hub sides: the frame's office building and storey (the
  // other storey when that one has no room)
  let officeWing: OfficeWingCarve | null = null;
  const offC = legacy ? undefined : [...carves.values()].find(bc => bc.b.offices > 0 && bc.b.id !== f.addonHost);
  if (offC) officeWing = carveOfficeWing(offC, offC.b.offices) ?? carveOfficeWing(offC, 3 - offC.b.offices);

  // --- 6a. DESTINATIONS: the landmark courts (atrium courts first) and the large ANCHOR shops ------------------------------------
  const landmarks = legacy ? [] : placeLandmarks();
  const anchors = legacy ? [] : carveAnchors();

  // --- 6b. The FOOD COURT (before the arms take the lobby walls): the frame's building / storey first, else any other non-host
  // building's (an atrium building's on its street-level court under the glass): the first lobby piece (largest first) that takes at
  // least three food counters round it, then labelled (seated by gen/skyways/greenery.ts)
  let foodCourt: SkywaysCarve['foodCourt'] = null;
  if (f.foodCourt) {
    const first = carves.get(f.foodCourt.building)!;
    const order: [BuildingCarve, number][] = [[first, first.atrium ? 1 : f.foodCourt.level]];
    for (const bc of rng.shuffle([...carves.values()])) if (bc.b.id !== f.addonHost && bc !== first) order.push([bc, bc.atrium ? 1 : f.foodCourt.level]);
    search: for (const [bc, lv] of order) {
      const pieces = (bc.hubAreas.get(lv) ?? []).map(id => k.areas[id]).filter(a => !addon.areas.includes(a.id) && !landmarks.some(m => m.area === a.id) && Math.max(a.w, a.h) >= 16 && Math.min(a.w, a.h) >= 14).sort((p, q) => q.w * q.h - p.w * p.h);
      for (const court of pieces.slice(0, 2)) {
        shopsOn(bc, lv, [court.id], 'food', rng.int(5, 7));
        if (storefronts.filter(sf => sf.hall === court.id && sf.food).length < 3) continue;
        court.label = `Food court · ${bName(bc.b)}`;
        foodCourt = {building: bc.b.id, level: lv, area: court.id};
        break search;
      }
    }
  }

  // --- 7. Facades and circulation after the plan: entrance halls, lookouts, arcades, service corridors / office suites ---------------
  for (const bc of carves.values()) {
    const {b, hub} = bc;
    const bridged = new Set<Side>(bridges.filter(q => q.a === b.id || q.b === b.id).map(q => sideToward(b, carves.get(q.a === b.id ? q.b : q.a)!.b, q.axis)));
    const host = b.id === f.addonHost;
    if (bc.plan === 'galleria') {
      // the spine's ENDS open to the street (a through-passage), its unbridged ends end in lookouts up on the skyway level
      const ends: Side[] = b.axis === 'x' ? ['W', 'E'] : ['N', 'S'];
      for (const s of ends) entranceHall(bc, s, 'centre', Math.min(14, sideLen(hub, s) - 4));
      if (rng.chance(0.4)) entranceHall(bc, rng.pick(SIDES.filter(s => !ends.includes(s))), 'random');
      if (!host) for (const s of ends.filter(q => !bridged.has(q))) lookout(bc, s, 'centre', Math.min(12, sideLen(hub, s) - 4));
    } else if (bc.plan === 'cross') {
      // arms out to (almost) every facade: entrance halls on three or four sides, lookouts on every unbridged side
      for (const s of rng.shuffle(SIDES.slice()).slice(0, rng.chance(0.5) ? 4 : 3)) entranceHall(bc, s, 'centre', rng.int(12, 14));
      if (!host) for (const s of SIDES.filter(q => !bridged.has(q))) lookout(bc, s, 'centre', rng.int(10, 12));
    } else if (bc.plan === 'offset') {
      // the court sits in a corner: its arms run out to the FAR facades along its outer edges (an L / T of public space)
      const east = (b.corner & 1) === 1, south = (b.corner & 2) === 2;
      const far: Side[] = [east ? 'W' : 'E', south ? 'N' : 'S'];
      const edge = (s: Side): 'low' | 'high' => (alongXSide(s) ? (east ? 'high' : 'low') : (south ? 'high' : 'low'));
      for (const s of far) entranceHall(bc, s, edge(s), rng.int(10, 13));
      if (!host) for (const s of far.filter(q => !bridged.has(q))) lookout(bc, s, edge(s), rng.int(10, 12));
    } else {
      // court: one or two entrance halls, a lookout lounge on one unbridged facade (not on the add-on host: its hall takes the far side)
      for (const s of rng.shuffle(SIDES.slice()).slice(0, rng.chance(0.55) ? 2 : 1)) entranceHall(bc, s, 'random');
      if (!host) {
        const open = rng.shuffle(SIDES.filter(s => !bridged.has(s)));
        if (open.length && rng.chance(0.75)) lookout(bc, open[0], 'random');
      }
    }
    // dead-end shop ARCADES off the lobby (a mall arm lined with units), on either storey — two in the roomier plans now and then
    // (destinations pass: more shops overall, the anchors took some lobby walls)
    for (const level of [1, 2]) {
      if (legacy) { if (rng.chance(bc.plan === 'court' || bc.plan === 'offset' ? 0.45 : 0.25)) arcade(bc, level); continue; }
      if (venue && host && level === f.addonLevel) continue; // (the venue floor: no shop arcade)
      const p = bc.plan === 'court' || bc.plan === 'offset' ? 0.75 : 0.5;
      if (rng.chance(p)) arcade(bc, level);
      if (rng.chance(p * 0.45)) arcade(bc, level);
    }
    // a SERVICE CORRIDOR lined with back rooms (or the office suite), on one storey or both
    for (const level of [1, 2]) {
      if (host && level === f.addonLevel) continue;
      const offices = b.offices === level;
      // (layout version 3; user: "occasional accessible office building floor") the building's tenant office: a real OFFICE WING (open
      // plan, meeting room, private offices, break room) instead of a corridor suite (that one when no wing fits)
      if (offices && officeWing?.building === bc.b.id) continue;
      if (offices || rng.chance(legacy ? 0.4 : 0.28)) serviceCorridor(bc, level, offices);
    }
  }

  // --- 8. Ramen restaurant ---------------------------------------------------------------------------------------------------------
  const ramen = carveRamen(carves.get(f.ramen)!);

  // --- 9. Storefront units (the food court's counters), washrooms, back of house ---------------------------------------------------
  // the station concourse first (storey 0: food counters + kiosks), the pedways' kiosks, then every building's street / skyway level
  const con0 = (sc.publicAreas.get(0) ?? [concourse.id]).filter(id => !pedwayAreas.includes(id));
  shopsOn(sc, 0, con0, 'food', legacy ? rng.int(5, 8) : rng.int(7, 10));
  if (pedwayAreas.length) shopsOn(sc, 0, pedwayAreas, 'food', legacy ? rng.int(1, 3) : rng.int(2, 4));
  for (const bc of carves.values()) {
    for (const level of [1, 2]) {
      const pub = (bc.publicAreas.get(level) ?? []).filter(id => !addon.areas.includes(id));
      const fc = foodCourt?.building === bc.b.id && foodCourt.level === level;
      if (venue && bc.b.id === f.addonHost && level === f.addonLevel) continue; // (the venue floor: its own washrooms / back of house, no shops)
      washroom(bc, level, pub);
      if (fc) shopsOn(bc, level, pub.filter(id => id !== foodCourt!.area), 'food', rng.int(2, 4));
      shopsOn(bc, level, pub, level === 1 ? 'mixed' : 'skyway', legacy ? (level === 1 ? rng.int(5, 8) : rng.int(6, 10)) : level === 1 ? rng.int(10, 14) : rng.int(11, 16));
      backOfHouse(bc, level, pub, legacy ? rng.int(3, 5) : rng.int(2, 4));
    }
  }
  // the station's own back of house off the concourse
  washroom(sc, 0, con0);
  backOfHouse(sc, 0, con0, rng.int(3, 4));

  for (const i of airCells) g2a.cells[i] = SOLID;

  // --- Extent ------------------------------------------------------------------------------------------------------------------------
  let X0 = Infinity, Z0 = Infinity, X1 = -Infinity, Z1 = -Infinity;
  for (const r of [...k.areas, ...f.buildings, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    X0 = Math.min(X0, r.x); Z0 = Math.min(Z0, r.y); X1 = Math.max(X1, r.x + r.w); Z1 = Math.max(Z1, r.y + r.h);
  }
  if (X0 - 4 < 1 || Z0 - 4 < 1 || X1 + 4 > k.g.w || Z1 + 4 > k.g.h) return fail('canvas');
  return {f, block, concourse, runs, bridges, buildings: [...carves.values()], windows, storefronts, addon, ramen, pedways, foodCourt, anchors, landmarks, officeWing, X0, Z0, X1, Z1, roofY};

  // ===========================================================================================================================
  // Local helpers (closures over the kit / records)

  function sc0(): BuildingCarve { return carves.get(station.id)!; }
  /** The public run(s) between the street and skyway levels and a pedway building's stair well, round the bridges' landings. */
  function placeWells(bc: BuildingCarve): boolean {
    const {b, hub} = bc;
    const isSt = b.id === station.id;
    const transit = bc.transit;
    let atrium = bc.atrium;
    const bridged = bridgedSidesOf(b);
    const hostSide = b.id === f.addonHost ? [...bridged][0] ?? null : null;
    const edgeLen = (s: Side) => sideLen(hub, s);
    const wells: WellPlan[] = transit ? [transit] : [];
    // (an atrium opening shrinks away from the runs; the wells keep apart from each other and from the bridges' landings)
    // (the pedway well is storey 0 -> 1: the skyway-level landings above it do not matter)
    const clashes = (r: CellRect, upper: boolean) => wells.some(w => overlapsR(grow(w.rect, 3), r)) || (upper && bc.mouths.some(m => overlapsR(grow(m, 3), r)));
    // the add-on host: its runs stay at the BRIDGE end of the lobby (the far side is the hall's entry / foyer)
    const hostLow = hostSide === 'W' || hostSide === 'N';
    const wellOn = (s: Side, lw: number, at: number, len = RUN_CELLS, upper = true, margins: readonly number[] = legacy ? [4] : [RUN_OUT, 4]): CellRect | null => {
      const ax = alongXSide(s), L = edgeLen(s);
      const flank = hostSide && alongXSide(s) === alongXSide(opposite(hostSide)) === false;
      const tries = flank ? [0, 0.1, 0.2, 0.3, 0.4].map(t => (hostLow ? t : 1 - t)) : [at, 0.5, 0.15, 0.85, 0.3, 0.7, 0.02, 0.98, 0.4, 0.6];
      // (layout version 3) a straight run-out of RUN_OUT cells of hub floor beyond both ends where the edge allows (the old 4 else)
      for (const m of margins) {
        if (L < len + 2 * m) continue;
        const lo = (ax ? hub.x : hub.y) + m, hi = (ax ? hub.x : hub.y) + L - m - len;
        for (const t of tries) {
          const a0 = Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, t)));
          const atLow = s === 'N' || s === 'W';
          const r: CellRect = ax ? {x: a0, y: atLow ? hub.y : hub.y + hub.h - lw, w: len, h: lw} : {x: atLow ? hub.x : hub.x + hub.w - lw, y: a0, w: lw, h: len};
          if (!clashes(r, upper)) return r;
        }
      }
      return null;
    };
    // the public run between the street and skyway levels: an OPEN well hugging one long edge of the hub (the mall's court runs),
    // never the transit's edge; an unbridged edge where it can (the corridors to the bridges then never meet its well)
    const usable = SIDES.filter(s => edgeLen(s) >= RUN_CELLS + 8 && !(transit && s === f.transitEdge));
    const depthOf = (s: Side) => (alongXSide(s) ? hub.h : hub.w) - (transit && alongXSide(s) ? lanesW(transit.lanes) + 2 : 0);
    // unbridged edges first; a galleria's run hugs one of its long walls (the spine's axis) where it can
    // (the add-on host: never the far side — its hall's entry goes there)
    const edgeKey = (q: Side) => (bridged.has(q) ? 2 : 0) + (b.plan === 'galleria' && alongXSide(q) !== (b.axis === 'x') ? 1 : 0) + (hostSide && q === opposite(hostSide) ? 4 : 0);
    const edgeOrder = rng.shuffle(usable.slice()).sort((p, q) => edgeKey(p) - edgeKey(q));
    let main: WellPlan | null = null;
    // (layout version 3) every edge with the full run-out first, then the old margin (legacy: one pass, the old margin)
    for (const margin of legacy ? [4] : [RUN_OUT, 4]) {
    if (main) break;
    for (const s of edgeOrder) {
      const depth = depthOf(s);
      const opts: [RunLanes, number][] = [[['stair'], 1]];
      if (depth - 12 >= 8) opts.push([['escalator', 'stair'], 1], [['stair', 'escalator'], 0.6]);
      if (depth - 12 >= 10) opts.push([['stair', 'stair'], 0.8]);
      if (depth - 12 >= 11 && depth >= 30) opts.push([['escalator', 'stair', 'escalator'], b.atrium || isSt ? 3 : 1]);
      const lanes: RunLanes = hostSide && f.addonApproach === 'foyer' ? ['stair'] : rng.weighted(opts);
      if (lanesW(lanes) > depth - 10) continue;
      // a bridged edge: the run at one end of it (the bridge takes the rest); a galleria: near one end of the spine
      const at = bridged.has(s) || b.plan === 'galleria' ? (rng.chance(0.5) ? 0.04 : 0.96) : isSt && !alongXSide(s) ? (f.transitEdge === 'S' ? 0.02 : 0.98) : rng.range(0.15, 0.85);
      const r = wellOn(s, lanesW(lanes), at, RUN_CELLS, true, [margin]);
      if (!r) continue;
      main = {id: `run-${b.id}`, rect: r, axis: alongXSide(s) ? 'x' : 'z', lanes, lower: 1, from: rng.chance(0.5) ? 'lo' : 'hi'};
      break;
    }
    }
    if (!main) return false;
    wells.push(main);
    const runs12 = [main];
    // a long galleria gets a second stair at the other end of its spine (the same long wall)
    if (b.plan === 'galleria' && !isSt && !bridged.has(main.axis === 'x' ? (main.rect.y === hub.y ? 'N' : 'S') : (main.rect.x === hub.x ? 'W' : 'E'))) {
      const s = main.axis === 'x' ? (main.rect.y === hub.y ? 'N' : 'S') : (main.rect.x === hub.x ? 'W' : 'E');
      const ax = alongXSide(s);
      const mainAtLow = (ax ? main.rect.x - hub.x : main.rect.y - hub.y) < edgeLen(s) / 2;
      if (edgeLen(s) >= 2 * RUN_CELLS + 24) {
        const lanes: RunLanes = depthOf(s) - 12 >= 8 && rng.chance(0.5) ? ['escalator', 'stair'] : ['stair'];
        const r = wellOn(s, lanesW(lanes), mainAtLow ? 0.97 : 0.03);
        if (r && Math.abs((ax ? r.x : r.y) - (ax ? main.rect.x : main.rect.y)) > RUN_CELLS + 10) {
          const w2: WellPlan = {id: `run-${b.id}-b`, rect: r, axis: ax ? 'x' : 'z', lanes, lower: 1, from: rng.chance(0.5) ? 'lo' : 'hi'};
          wells.push(w2); runs12.push(w2);
        }
      }
    }
    // the atrium opening keeps at least one gallery cell from any well (shrink it away from the run)
    if (atrium) for (const w of runs12) {
      const r = w.rect;
      if (!(r.x < atrium.x + atrium.w + 1 && atrium.x < r.x + r.w + 1 && r.y < atrium.y + atrium.h + 1 && atrium.y < r.y + r.h + 1)) continue;
      if (w.axis === 'x') { if (r.y === hub.y) { const y1 = atrium.y + atrium.h; atrium.y = r.y + r.h + 2; atrium.h = y1 - atrium.y; } else atrium.h = r.y - 2 - atrium.y; }
      else { if (r.x === hub.x) { const x1 = atrium.x + atrium.w; atrium.x = r.x + r.w + 2; atrium.w = x1 - atrium.x; } else atrium.w = r.x - 2 - atrium.x; }
      if (atrium.w < 10 || atrium.h < 8) atrium = null;
      if (!atrium) break;
    }
    // a pedway building: its stair well down to the underground pedway (storey 0 -> 1) on the hub edge facing the station
    let down: WellPlan | null = null;
    if (f.lowerLinks.includes(b.id)) {
      // on the hub edge facing the station, placed so its landing (beyond the bottom end) lines up with the concourse round the
      // transit well: a straight tunnel under the street (west / east neighbours along x, the building north of the station along z)
      const face0: Side = b.row < station.row ? 'S' : b.col < station.col ? 'E' : 'W';
      const Tr = sc0().transit!.rect;
      let best: {r: CellRect; from: 'lo' | 'hi'; d: number; face: Side} | null = null;
      // the facing edge first (a straight tunnel); else the edges either side of it (an L-shaped tunnel)
      for (const face of [face0, ...SIDES.filter(q => q !== face0 && q !== opposite(face0))]) {
      if (best) break;
      const target = alongXSide(face) ? Tr.x + Tr.w / 2 : Tr.y + Tr.h / 2 + 2;
      const ax = alongXSide(face), L = edgeLen(face), lw = LANE_W.stair;
      if (L >= RUN_CELLS + 8) for (let a0 = (ax ? hub.x : hub.y) + 4; a0 <= (ax ? hub.x : hub.y) + L - 4 - RUN_CELLS; a0++) {
        const atLow = face === 'W' || face === 'N';
        const r: CellRect = ax ? {x: a0, y: atLow ? hub.y : hub.y + hub.h - lw, w: RUN_CELLS, h: lw} : {x: atLow ? hub.x : hub.x + hub.w - lw, y: a0, w: lw, h: RUN_CELLS};
        if (clashes(r, false)) continue;
        for (const from of ['lo', 'hi'] as const) {
          const land = from === 'lo' ? a0 + RUN_CELLS + 3.5 : a0 - 3.5;
          const d = Math.abs(land - target) + rng.range(0, 2);
          if (!best || d < best.d) best = {r, from, d, face};
        }
      }
      }
      if (best) down = {id: `pedway-${b.id}`, rect: best.r, axis: alongXSide(best.face) ? 'x' : 'z', lanes: ['stair'], lower: 0, from: best.from};
      if (down) wells.push(down);
    }
    bc.runs12 = runs12; bc.down = down; bc.atrium = atrium;
    return true;
  }

  /**
   * The LANDMARK courts: every atrium court (the street-level court under the glass) takes the next family of the seeded rotation
   * (any family: the tall ones need the glass), then up to two large plain courts take the next families that fit their clear height
   * (a dry fountain, the orrery, the dinosaur on a long lobby court). Never the add-on's areas; one family per map.
   */
  function placeLandmarks(): LandmarkCarve[] {
    const out: LandmarkCarve[] = [];
    const left = f.landmarkFamilies.slice();
    const take = (ok: (fam: SkywaysLandmarkFamily) => boolean): SkywaysLandmarkFamily | null => { const i = left.findIndex(ok); return i < 0 ? null : left.splice(i, 1)[0]; };
    const fits = (a: Area, lv: number, fam: SkywaysLandmarkFamily, cx: number, cy: number, atrium: boolean): {axis: 'x' | 'z'} | null => {
      const F = LANDMARK_FAMILIES[fam];
      if (F.atriumOnly && !atrium) return null;
      const clear = (atrium ? roofY : a.ceil) - BASES[lv];
      if (F.height + 0.4 > clear) return null;
      const axis: 'x' | 'z' = a.w >= a.h ? 'x' : 'z';
      const g = k.grid(lv), R = Math.ceil((F.radius + 1.0) / CELL), L = Math.ceil(((F.long ?? 0) / 2 + 1.2) / CELL);
      for (let dy = -Math.max(R, axis === 'z' ? L : 0); dy <= Math.max(R, axis === 'z' ? L : 0); dy++) for (let dx = -Math.max(R, axis === 'x' ? L : 0); dx <= Math.max(R, axis === 'x' ? L : 0); dx++) {
        const x = Math.round(cx) + dx, y = Math.round(cy) + dy, i = g.idx(x, y);
        if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return null;
      }
      return {axis};
    };
    // atrium courts first, at the opening's centre (layout version 3: a court split by a stair well — the hero slides along its court
    // piece, still under the opening, until its walking ring and the lanes into it stay inside the piece)
    const slide = (a: Area, fam: SkywaysLandmarkFamily, cx: number, cy: number, at: CellRect): [number, number] => {
      if (legacy) return [cx, cy];
      const F = LANDMARK_FAMILIES[fam], m = (F.radius + 2.6) / CELL, ml = Math.max(m, ((F.long ?? 0) / 2 + 2.0) / CELL), alongX = a.w >= a.h;
      const mx = alongX ? ml : m, my = alongX ? m : ml;
      const cl = (v: number, lo: number, hi: number, inLo: number, inHi: number) => (lo > hi ? v : Math.max(Math.max(lo, inLo), Math.min(Math.min(hi, inHi), v)));
      return [cl(cx, a.x + mx, a.x + a.w - mx, at.x + 1, at.x + at.w - 1), cl(cy, a.y + my, a.y + a.h - my, at.y + 1, at.y + at.h - 1)];
    };
    for (const bc of rng.shuffle([...carves.values()])) {
      if (!bc.atrium || out.length >= 4) continue;
      const cx = bc.atrium.x + bc.atrium.w / 2, cy = bc.atrium.y + bc.atrium.h / 2;
      const g1 = k.grid(1), a = k.areas[g1.area[g1.idx(Math.floor(cx), Math.floor(cy))]];
      if (!a || addonAreas.includes(a.id)) continue;
      const fam = take(q => { const [x, y] = slide(a, q, cx, cy, bc.atrium!); return g1.area[g1.idx(Math.floor(x), Math.floor(y))] === a.id && !!fits(a, 1, q, x, y, true); });
      if (!fam) continue;
      const [x, y] = slide(a, fam, cx, cy, bc.atrium);
      out.push(landmark(fam, bc, 1, a, x, y, true, fits(a, 1, fam, x, y, true)!.axis));
    }
    // then up to two big plain courts (street or skyway level), the biggest first
    const plain: [BuildingCarve, number, Area][] = [];
    for (const bc of carves.values()) for (const lv of [1, 2]) for (const id of bc.hubAreas.get(lv) ?? []) {
      const a = k.areas[id];
      // (layout version 3: never the court holding the prize display)
      if (addonAreas.includes(a.id) || out.some(m => m.area === a.id) || Math.min(a.w, a.h) < 18 || (bc.atrium && overlapsR(a, bc.atrium)) || (addon?.car && overlapsR(grow(a, 2), addon.hall))) continue;
      if (out.some(m => m.building === bc.b.id)) continue;
      plain.push([bc, lv, a]);
    }
    plain.sort((p, q) => q[2].w * q[2].h - p[2].w * p[2].h);
    let extra = rng.int(1, 2);
    for (const [bc, lv, a] of plain) {
      if (extra <= 0 || out.length >= 5 || out.some(m => m.building === bc.b.id)) continue;
      const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
      const fam = take(q => !!fits(a, lv, q, cx, cy, false));
      if (!fam) continue;
      out.push(landmark(fam, bc, lv, a, cx, cy, false, fits(a, lv, fam, cx, cy, false)!.axis));
      extra--;
    }
    return out;
  }
  function landmark(fam: SkywaysLandmarkFamily, bc: BuildingCarve, lv: number, a: Area, cx: number, cy: number, atrium: boolean, axis: 'x' | 'z'): LandmarkCarve {
    const F = LANDMARK_FAMILIES[fam];
    a.label = `${F.name} · ${bName(bc.b)}`;
    return {id: `L${fam}`, family: fam, name: F.name, building: bc.b.id, level: lv, area: a.id, cx: r2(cx), cy: r2(cy), radius: F.radius, height: F.height, atrium, axis};
  }

  /**
   * The ANCHOR shops: the families of the seeded rotation in turn, each in the roomiest site beyond a lobby side that fits its size
   * (one per building and storey; a galleria may take one either side of its spine), up to 4-6 per map. Each gets a wide glazed
   * storefront onto the lobby, its format (two-level with an internal stair, double height, multi-zone, else a plain hall) and one or
   * two back rooms behind a staff door.
   */
  function carveAnchors(): AnchorCarve[] {
    const out: AnchorCarve[] = [];
    const target = rng.int(4, 6);
    const used = new Map<string, number>(); // building:level -> anchors there
    for (const fam of f.shopFamilies) {
      if (out.length >= target) break;
      const F = ANCHOR_FAMILIES[fam];
      const sites: [BuildingCarve, 1 | 2][] = [];
      for (const bc of rng.shuffle([...carves.values()])) for (const lv of rng.shuffle([1, 2] as (1 | 2)[])) {
        const n = used.get(`${bc.b.id}:${lv}`) ?? 0;
        if (n >= (bc.plan === 'galleria' ? 2 : 1)) continue;
        if (bc.b.id === f.addonHost && lv === f.addonLevel) continue;
        sites.push([bc, lv]);
      }
      const formats = [...F.formats.slice().sort((p, q) => rng.range(0, q[1]) - rng.range(0, p[1])).map(q => q[0]), 'hall' as const].filter((q, i, a) => a.indexOf(q) === i);
      let made: AnchorCarve | null = null;
      for (const fmt of formats) {
        for (const [bc, lv] of sites) {
          if ((fmt === 'two-level' || fmt === 'double-height') && lv !== 1 && !(fmt === 'two-level' && lv === 2)) continue;
          made = anchorAt(fam, fmt, bc, lv);
          if (made) { used.set(`${bc.b.id}:${lv}`, (used.get(`${bc.b.id}:${lv}`) ?? 0) + 1); break; }
        }
        if (made) break;
      }
      if (made) out.push(made);
    }
    return out;
  }

  function anchorAt(fam: SkywaysShopFamily, fmt: SkywaysAnchorFormat, bc: BuildingCarve, lv: 1 | 2): AnchorCarve | null {
    const F = ANCHOR_FAMILIES[fam], {I, hub, b} = bc;
    const g = k.grid(lv);
    const other = fmt === 'two-level' ? (lv === 1 ? 2 : 1) : null;
    const cands: {r: CellRect; s: Side; gap: CellRect; score: number}[] = [];
    for (const s of SIDES) {
      const deepMax = s === 'N' ? hub.y - 1 - I.y : s === 'S' ? I.y + I.h - (hub.y + hub.h + 1) : s === 'W' ? hub.x - 1 - I.x : I.x + I.w - (hub.x + hub.w + 1);
      if (deepMax < F.deep[0]) continue;
      const a0 = alongXSide(s) ? I.x : I.y, a1 = alongXSide(s) ? I.x + I.w : I.y + I.h;
      let got: (typeof cands)[number] | null = null;
      for (let deep = Math.min(deepMax, F.deep[1]); deep >= F.deep[0] && !got; deep -= 3) {
        for (let w = Math.min(a1 - a0, F.along[1]); w >= F.along[0] && !got; w -= 4) {
          for (let o = 0; o + w <= a1 - a0; o += 3) {
            const r: CellRect = s === 'N' ? {x: a0 + o, y: hub.y - 1 - deep, w, h: deep} : s === 'S' ? {x: a0 + o, y: hub.y + hub.h + 1, w, h: deep}
              : s === 'W' ? {x: hub.x - 1 - deep, y: a0 + o, w: deep, h: w} : {x: hub.x + hub.w + 1, y: a0 + o, w: deep, h: w};
            const ov0 = alongXSide(s) ? Math.max(r.x, hub.x) : Math.max(r.y, hub.y), ov1 = alongXSide(s) ? Math.min(r.x + r.w, hub.x + hub.w) : Math.min(r.y + r.h, hub.y + hub.h);
            if (ov1 - ov0 < 14) continue;
            if (!within(I, r) || !k.rectFree(r, lv)) continue;
            if (other !== null && !k.rectFree(r, other)) continue;
            if (fmt === 'double-height' && !k.solid(grow(r, 1), 2)) continue;
            // the storefront: a wide opening centred on the overlap, slid until flat lobby floor (never a run well) lies in front
            const ow = Math.min(ov1 - ov0 - 2, rng.int(12, 18));
            const hubSide = opposite(s);
            let gap: CellRect | null = null;
            for (const d of [0, 2, -2, 4, -4, 6, -6, 8, -8]) {
              const e0 = Math.round((ov0 + ov1 - ow) / 2) + d;
              if (e0 < ov0 + 1 || e0 + ow > ov1 - 1) continue;
              const gp: CellRect = hubSide === 'S' ? {x: e0, y: r.y + r.h, w: ow, h: 1} : hubSide === 'N' ? {x: e0, y: r.y - 1, w: ow, h: 1}
                : hubSide === 'E' ? {x: r.x + r.w, y: e0, w: 1, h: ow} : {x: r.x - 1, y: e0, w: 1, h: ow};
              if (!k.solid(gp, lv)) continue;
              let ok = true;
              for (let q = 0; q < ow && ok; q++) {
                const cx = gp.w > 1 ? gp.x + q : hubSide === 'E' ? gp.x + 1 : gp.x - 1, cy = gp.h > 1 ? gp.y + q : hubSide === 'S' ? gp.y + 1 : gp.y - 1;
                const i = g.idx(cx, cy);
                if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || addonAreas.includes(g.area[i])) ok = false;
              }
              if (ok) { gap = gp; break; }
            }
            if (!gap) continue;
            got = {r, s, gap, score: r.w * r.h};
            break;
          }
        }
      }
      if (got) cands.push(got);
    }
    if (!cands.length) return null;
    const top = Math.max(...cands.map(c => c.score));
    const {r, s, gap} = rng.weighted(cands.filter(c => c.score >= 0.7 * top).map(c => [c, c.score] as const));
    const hubSide = opposite(s), front: Side = hubSide; // the floor's front wall faces the lobby
    const P = k.areas[g.area[g.idx(...frontCell(gap, hubSide))]];
    if (!P) return null;
    const id = `A${fam}`;
    const ceilY = fmt === 'double-height' ? ceilOf(1, ANCHOR_CLEAR.doubleHeight) : ceilOf(lv, ANCHOR_CLEAR.hall[lv - 1]);
    if (fmt === 'double-height') keepAir(grow(r, 1));
    // multi-zone: the front hall + (the cinema) an auditorium behind it / (the music store) listening booths along a flank
    let floorRect = r;
    const zoneRects: [CellRect, string, Area['type'], number][] = [];
    if (fmt === 'multi-zone') {
      if (fam === 'cinema') {
        const fd = Math.max(11, Math.min(14, Math.floor(sideLen({x: 0, y: 0, w: r.w, h: r.h}, alongXSide(s) ? 'W' : 'N') * 0.4)));
        const D = alongXSide(s) ? r.h : r.w;
        if (D - fd - 1 < 12) return null;
        // the front (lobby) band lies against the lobby side
        floorRect = s === 'N' ? {x: r.x, y: r.y + r.h - fd, w: r.w, h: fd} : s === 'S' ? {x: r.x, y: r.y, w: r.w, h: fd} : s === 'W' ? {x: r.x + r.w - fd, y: r.y, w: fd, h: r.h} : {x: r.x, y: r.y, w: fd, h: r.h};
        const aud = s === 'N' ? {x: r.x + 2, y: r.y, w: r.w - 4, h: r.h - fd - 1} : s === 'S' ? {x: r.x + 2, y: r.y + fd + 1, w: r.w - 4, h: r.h - fd - 1}
          : s === 'W' ? {x: r.x, y: r.y + 2, w: r.w - fd - 1, h: r.h - 4} : {x: r.x + fd + 1, y: r.y + 2, w: r.w - fd - 1, h: r.h - 4};
        zoneRects.push([aud, 'Auditorium', 'shop', 4]);
      } else {
        // booths: a flank strip of 6-cell rooms
        const BW = 6, along = alongXSide(s);
        const flankLow = rng.chance(0.5);
        floorRect = along ? {x: flankLow ? r.x + BW + 1 : r.x, y: r.y, w: r.w - BW - 1, h: r.h} : {x: r.x, y: flankLow ? r.y + BW + 1 : r.y, w: r.w, h: r.h - BW - 1};
        const strip = along ? {x: flankLow ? r.x : r.x + r.w - BW, y: r.y, w: BW, h: r.h} : {x: r.x, y: flankLow ? r.y : r.y + r.h - BW, w: r.w, h: BW};
        const L = along ? strip.h : strip.w;
        const nb = Math.max(2, Math.min(4, Math.floor((L - 2) / 7)));
        for (let i = 0; i < nb; i++) {
          const t0 = 1 + i * 7;
          if (t0 + 6 > L - 1) break;
          zoneRects.push([along ? {x: strip.x, y: strip.y + t0, w: BW, h: 6} : {x: strip.x + t0, y: strip.y, w: 6, h: BW}, 'Listening booth', 'shop', 3]);
        }
        // the gap must still front the floor
        const g0 = alongXSide(hubSide) ? gap.x : gap.y, g1 = g0 + (alongXSide(hubSide) ? gap.w : gap.h);
        const h0 = alongXSide(hubSide) ? floorRect.x : floorRect.y, h1 = h0 + (alongXSide(hubSide) ? floorRect.w : floorRect.h);
        if (g0 < h0 || g1 > h1) return null;
      }
    }
    // two-level: an internal open stair along the far wall at one end (both storeys: the floor round it on each)
    let well: CellRect | null = null;
    if (fmt === 'two-level') {
      const far = s; // the wall opposite the front
      const L = sideLen(r, far), lw = LANE_W.stair;
      // (3 m of floor beyond either end: the landings)
      if (L < RUN_CELLS + 14) return null;
      const t = rng.chance(0.5) ? 7 : L - 7 - RUN_CELLS;
      well = far === 'N' ? {x: r.x + t, y: r.y, w: RUN_CELLS, h: lw} : far === 'S' ? {x: r.x + t, y: r.y + r.h - lw, w: RUN_CELLS, h: lw}
        : far === 'W' ? {x: r.x, y: r.y + t, w: lw, h: RUN_CELLS} : {x: r.x + r.w - lw, y: r.y + t, w: lw, h: RUN_CELLS};
    }
    // the sales floor (with its storefront): a whole rect, or the pieces round the stair well (the storefront fronts the largest)
    const an = {family: fam, name: F.name, ceil: ceilY, entryW: rng.int(4, 6)};
    let sf: Storefront;
    const pieces = well ? decompose((x, y) => !inRect(well!, x, y), floorRect).sort((p, q) => q.w * q.h - p.w * p.h) : [floorRect];
    const main = pieces.find(q => overlapsR(grow(q, 1), gap)) ?? pieces[0];
    sf = shopfront(lv, P, hubSide, gap, main, F.use, an);
    sf.color = F.color;
    storefronts.push(sf);
    const floor = k.areas[sf.unit];
    floor.purpose = F.use;
    for (const q of pieces) if (q !== main) { const a = k.addArea(q, 'room', 'shop', ceilY, floor.id, {...opt(lv), label: F.name, publicSpace: true}); a.purpose = F.use; }
    const zones: number[] = [];
    for (const [zr, label, type, dw] of zoneRects) {
      const a = k.addArea(zr, 'room', type, label === 'Auditorium' ? ceilOf(lv, ANCHOR_CLEAR.hall[lv - 1]) : ceilOf(lv, CLEAR.shop), floor.id, {...opt(lv), label: `${label} · ${F.name}`, publicSpace: true});
      a.purpose = F.use;
      // its door from the floor: through the shared wall, centred
      const side: Side = zr.x >= floorRect.x + floorRect.w ? 'E' : zr.x + zr.w <= floorRect.x ? 'W' : zr.y >= floorRect.y + floorRect.h ? 'S' : 'N';
      const L = alongXSide(side) ? zr.w : zr.h;
      const d0 = (alongXSide(side) ? zr.x - floorRect.x : zr.y - floorRect.y) + Math.floor((L - dw) / 2);
      k.carveDoor(gapOn(floorRect, side, d0, dw), floor, a, CLEAR.door + (dw >= 4 ? 0.4 : 0), false);
      zones.push(a.id);
    }
    let upper: number | null = null;
    if (fmt === 'two-level' && well) {
      const up = lv === 1 ? 2 : 1;
      const ups = decompose((x, y) => !inRect(well!, x, y), r).sort((p, q) => q.w * q.h - p.w * p.h);
      const ua = k.addArea(ups[0], 'room', 'shop', ceilOf(up, ANCHOR_CLEAR.hall[up - 1]), -1, {...opt(up), label: `${F.name} · ${up === 2 ? 'mezzanine' : 'lower floor'}`, publicSpace: true});
      ua.purpose = F.use;
      for (const q of ups.slice(1)) { const a = k.addArea(q, 'room', 'shop', ceilOf(up, ANCHOR_CLEAR.hall[up - 1]), ua.id, {...opt(up), label: `${F.name} · ${up === 2 ? 'mezzanine' : 'lower floor'}`, publicSpace: true}); a.purpose = F.use; }
      upper = ua.id;
      runs.push(carveRun(k, `shop-${fam}`, b.id, 1, well, alongXSide(s) ? 'x' : 'z', rng.chance(0.5) ? 'lo' : 'hi', ['stair'], false));
    }
    // back rooms: a stock room (and an office) beyond the far wall or a flank, staff doors from the floor
    const stock: number[] = [];
    const backs: [string, Area['type'], number, number][] = [['Stock room', 'stock-room', rng.int(10, 14), rng.int(7, 9)], ['Office', 'agent-office', rng.int(8, 10), rng.int(6, 8)]];
    for (const [label, type, along, deep] of backs) {
      let a: Area | null = null;
      for (const bs of [s, ...SIDES.filter(q => q !== s && q !== hubSide)]) {
        const n = sideLen(floorRect, bs) - along;
        for (let t = 2; t <= n - 2 && !a; t += 3) {
          const rr = beyond(floorRect, bs, t, along, deep);
          if (!within(I, rr) || !k.rectFree(rr, lv) || (fmt === 'double-height' && false)) continue;
          if (zoneRects.some(([zr]) => overlapsR(grow(zr, 1), rr))) continue;
          if (well && overlapsR(grow(well, 1), gapOn(floorRect, bs, t + Math.floor(along / 2) - 1, 3))) continue;
          a = k.addArea(rr, 'room', type, ceilOf(lv, CLEAR.back), floor.id, {...opt(lv), label: `${label} · ${F.name}`, publicSpace: false});
          k.carveDoor(gapOn(floorRect, bs, t + Math.floor(along / 2) - 1, 3), floor, a, CLEAR.door, false, {staff: true});
        }
        if (a) break;
      }
      if (a) stock.push(a.id);
    }
    return {id, family: fam, name: F.name, building: b.id, level: lv, format: fmt, floor: floor.id, rect: r, storefront: sf.id, front, upper, zones, stock, ceilY};
  }

  function hubArea(bc: BuildingCarve, level: number, id: number): void { let l = bc.hubAreas.get(level); if (!l) bc.hubAreas.set(level, (l = [])); l.push(id); }

  /** The hub cells along a mouth of `width` on `side` from `lat0` are flat hub floor, clear of every well (3 cells). */
  function mouthClear(bc: BuildingCarve, level: number, side: Side, lat0: number, width: number): boolean {
    const {hub} = bc, g = k.grid(level);
    // (the transit / pedway wells are storey 0 -> 1: they only matter on the street level)
    const wells = [...bc.runs12, ...(level <= 1 && bc.transit ? [bc.transit] : []), ...(level <= 1 && bc.down ? [bc.down] : [])].map(w => grow(w.rect, 3));
    const mouth = mouthRect(hub, side, lat0, width);
    if (wells.some(w => overlapsR(w, mouth))) return false;
    if (!hubsCarved) return true;
    for (let t = 0; t < width; t++) {
      const [x, y] = side === 'E' ? [hub.x + hub.w - 1, lat0 + t] : side === 'W' ? [hub.x, lat0 + t] : side === 'N' ? [lat0 + t, hub.y] : [lat0 + t, hub.y + hub.h - 1];
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) return false;
    }
    return true;
  }
  /** Every cell of `r` is rock, and so are the cells along its two long sides (the open ends may meet other rooms). */
  function rockBand(r: CellRect, level: number, alongX: boolean): boolean {
    if (!k.solid(r, level)) return false;
    const sides: CellRect[] = alongX ? [{x: r.x, y: r.y - 1, w: r.w, h: 1}, {x: r.x, y: r.y + r.h, w: r.w, h: 1}] : [{x: r.x - 1, y: r.y, w: 1, h: r.h}, {x: r.x + r.w, y: r.y, w: 1, h: r.h}];
    return sides.every(q => k.solid(q, level));
  }

  function corridorTo(bc: BuildingCarve, level: number, side: Side, lat0: number, width: number, label: string, role: 'mall' | 'great-hall' = 'mall', made?: Area[]): Area | null {
    // a straight corridor from the hub's side to the facade (exclusive of the wall ring), lateral span [lat0, lat0 + width); with
    // `made` (the bridges) a landing beyond the hub's lateral span is reached by a JOG: a connector along the hub side + a stub out
    const {I, hub} = bc;
    const inSpan = side === 'E' || side === 'W' ? lat0 >= hub.y && lat0 + width <= hub.y + hub.h : lat0 >= hub.x && lat0 + width <= hub.x + hub.w;
    if (!inSpan && made) return jogCorridor(bc, level, side, lat0, width, label, role, made);
    let r: CellRect;
    if (side === 'E') r = {x: hub.x + hub.w, y: lat0, w: I.x + I.w - (hub.x + hub.w), h: width};
    else if (side === 'W') r = {x: I.x, y: lat0, w: hub.x - I.x, h: width};
    else if (side === 'N') r = {x: lat0, y: I.y, w: width, h: hub.y - I.y};
    else r = {x: lat0, y: hub.y + hub.h, w: width, h: I.y + I.h - (hub.y + hub.h)};
    if (r.w < 1 || r.h < 1) return null;
    // must stay inside the hub's lateral span (straight join) and on rock
    const latOk = side === 'E' || side === 'W' ? lat0 >= hub.y && lat0 + width <= hub.y + hub.h : lat0 >= hub.x && lat0 + width <= hub.x + hub.w;
    if (!latOk) return null;
    const g = k.grid(level);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g.cells[g.idx(x, y)] !== SOLID) return null;
    if (!mouthClear(bc, level, side, lat0, width)) return null;
    const clear = level === 2 ? CLEAR.skyway : CLEAR.lobby;
    const a = k.addArea(r, 'concourse', level === 2 ? 'retail-arcade' : 'concourse', ceilOf(level, clear), -1, {...opt(level), label, publicSpace: true, role});
    if (made) { made.push(a); pendingMouths.push({bc, rect: mouthRect(hub, side, lat0, width)}); }
    return a;
  }

  /** The jogged landing: a FACADE GALLERY — the strip between the hub's `side` and the facade, running along the facade from the
   *  hub's last `width` cells (its mouth) to the bridge's landing at [lat0, lat0 + width). Returns the gallery (into `made`). */
  function jogCorridor(bc: BuildingCarve, level: number, side: Side, lat0: number, width: number, label: string, role: 'mall' | 'great-hall', made: Area[]): Area | null {
    const {I, hub} = bc;
    const ax = side === 'E' || side === 'W'; // the gallery's depth runs along x; its length along z
    const h0 = ax ? hub.y : hub.x, h1 = ax ? hub.y + hub.h : hub.x + hub.w;
    const past = lat0 + width > h1; // the landing lies past the hub span's far end (else before its start)
    if (h1 - h0 < width + 2) return null;
    const mouth = past ? h1 - width : h0;
    const j0 = past ? mouth : lat0, j1 = past ? lat0 + width : h0 + width;
    const depth = side === 'E' ? I.x + I.w - (hub.x + hub.w) : side === 'W' ? hub.x - I.x : side === 'S' ? I.y + I.h - (hub.y + hub.h) : hub.y - I.y;
    if (depth < 6) return null;
    const near = side === 'E' ? hub.x + hub.w : side === 'W' ? I.x : side === 'S' ? hub.y + hub.h : I.y;
    const gal: CellRect = ax ? {x: near, y: j0, w: depth, h: j1 - j0} : {x: j0, y: near, w: j1 - j0, h: depth};
    if (!within(I, gal)) return null;
    if (!k.solid(gal, level)) return null;
    // its two ends keep a wall (the gallery's long sides are the hub / the facade)
    const caps: CellRect[] = ax ? [{x: gal.x, y: gal.y - 1, w: gal.w, h: 1}, {x: gal.x, y: gal.y + gal.h, w: gal.w, h: 1}] : [{x: gal.x - 1, y: gal.y, w: 1, h: gal.h}, {x: gal.x + gal.w, y: gal.y, w: 1, h: gal.h}];
    if (!caps.every(q => k.solid(q, level))) return null;
    // beyond the hub's span the gallery's inner side is a wall (never another room's floor)
    const inner: CellRect = side === 'E' ? {x: near - 1, y: j0, w: 1, h: j1 - j0} : side === 'W' ? {x: near + depth, y: j0, w: 1, h: j1 - j0}
      : side === 'S' ? {x: j0, y: near - 1, w: j1 - j0, h: 1} : {x: j0, y: near + depth, w: j1 - j0, h: 1};
    { const g = k.grid(level); for (let y = inner.y; y < inner.y + inner.h; y++) for (let x = inner.x; x < inner.x + inner.w; x++) if (!inRect(hub, x, y) && g.cells[g.idx(x, y)] !== SOLID) return null; }
    if (!mouthClear(bc, level, side, mouth, width)) return null;
    const clear = level === 2 ? CLEAR.skyway : CLEAR.lobby;
    const a = k.addArea(gal, 'concourse', level === 2 ? 'retail-arcade' : 'concourse', ceilOf(level, clear), -1, {...opt(level), label, publicSpace: true, role});
    made.push(a);
    pendingMouths.push({bc, rect: mouthRect(hub, side, mouth, width)});
    return a;
  }

  /** A lateral start on hub side `s` for an arm `width` wide: centred, at either end of the span, or seeded. */
  function latOf(bc: BuildingCarve, s: Side, width: number, where: 'centre' | 'low' | 'high' | 'random'): number[] {
    const {hub} = bc, a = alongXSide(s) ? hub.x : hub.y, L = sideLen(hub, s);
    const lo = a + 2, hi = a + L - 2 - width;
    if (hi < lo) return [];
    const want = where === 'low' ? lo : where === 'high' ? hi : where === 'centre' ? Math.round((lo + hi) / 2) : rng.int(lo, hi);
    const out: number[] = [];
    for (let d = 0; d <= hi - lo; d++) for (const t of d ? [want + d, want - d] : [want]) if (t >= lo && t <= hi) out.push(t);
    return out.slice(0, 24);
  }

  function entranceHall(bc: BuildingCarve, s: Side, where: 'centre' | 'low' | 'high' | 'random', w0?: number): void {
    const {I, b} = bc;
    const width = w0 ?? rng.int(10, 12);
    if (width < 8) return;
    let c: Area | null = null, lat = 0;
    for (const t of latOf(bc, s, width, where)) { c = corridorTo(bc, 1, s, t, width, `Entrance hall · ${bName(b)}`, 'great-hall'); if (c) { lat = t; break; } }
    if (!c) return;
    addPublic(bc, 1, c.id);
    // the vestibule: widen the facade end along the facade (glazed both sides of the boarded street doors)
    const vlen = Math.min(sideLen(I, s) - 10, width + 2 * rng.int(5, 8)), vdeep = 6;
    const vlat = Math.max((alongXSide(s) ? I.x : I.y) + 4, Math.min(lat - Math.round((vlen - width) / 2), (alongXSide(s) ? I.x + I.w : I.y + I.h) - 4 - vlen));
    const parts: CellRect[] = [];
    if (alongXSide(s)) {
      const y = s === 'N' ? I.y : I.y + I.h - vdeep;
      if (vlat < lat) parts.push({x: vlat, y, w: lat - vlat, h: vdeep});
      if (vlat + vlen > lat + width) parts.push({x: lat + width, y, w: vlat + vlen - lat - width, h: vdeep});
    } else {
      const x = s === 'W' ? I.x : I.x + I.w - vdeep;
      if (vlat < lat) parts.push({x, y: vlat, w: vdeep, h: lat - vlat});
      if (vlat + vlen > lat + width) parts.push({x, y: lat + width, w: vdeep, h: vlat + vlen - lat - width});
    }
    const g1 = k.grid(1);
    for (const p of parts) {
      let ok = true;
      for (let y = p.y; y < p.y + p.h && ok; y++) for (let x = p.x; x < p.x + p.w; x++) if (g1.cells[g1.idx(x, y)] !== SOLID) { ok = false; break; }
      if (!ok) continue;
      const a = k.addArea(p, 'concourse', 'concourse', ceilOf(1, CLEAR.lobby), c.id, {...opt(1), label: `Entrance hall · ${bName(b)}`, publicSpace: true, role: 'great-hall'});
      addPublic(bc, 1, a.id);
    }
    // glazing along the facade: the boarded street doors in the middle (entrance), glass either side
    const f0 = Math.max(vlat, (alongXSide(s) ? I.x : I.y)), f1 = vlat + vlen;
    const d0 = lat + Math.round(width / 2) - 3, d1 = d0 + 6;
    const wall = (t0: number, t1: number): CellRect => s === 'N' ? {x: t0, y: b.y, w: t1 - t0, h: 1} : s === 'S' ? {x: t0, y: b.y + b.h - 1, w: t1 - t0, h: 1}
      : s === 'W' ? {x: b.x, y: t0, w: 1, h: t1 - t0} : {x: b.x + b.w - 1, y: t0, w: 1, h: t1 - t0};
    const onFloor = (t: number) => { const [x, y] = s === 'N' ? [t, I.y] : s === 'S' ? [t, I.y + I.h - 1] : s === 'W' ? [I.x, t] : [I.x + I.w - 1, t]; return g1.cells[g1.idx(x, y)] === FLOOR; };
    for (const [t0, t1] of [[f0 + 1, d0], [d1, f1 - 1]] as const) {
      for (const [u0, u1] of runsWhere(t0, t1, onFloor)) for (const [q0, q1] of spans(u0, u1, 14)) windows.push({rect: wall(q0, q1), side: s, level: 1, sill: 0.4, head: 3.3, kind: 'window', host: {building: b.id}});
    }
    if (onFloor(d0) && onFloor(d1 - 1)) windows.push({rect: wall(d0, d1), side: s, level: 1, sill: 0, head: 2.8, kind: 'entrance', host: {building: b.id}});
  }

  function lookout(bc: BuildingCarve, s: Side, where: 'centre' | 'low' | 'high' | 'random', w0?: number): void {
    const {b} = bc;
    const width = w0 ?? rng.int(8, 10);
    if (width < 8) return;
    let c: Area | null = null, lat = 0;
    for (const t of latOf(bc, s, width, where)) { c = corridorTo(bc, 2, s, t, width, `Lookout lounge · ${bName(b)}`); if (c) { lat = t; break; } }
    if (!c) return;
    addPublic(bc, 2, c.id);
    const wall = s === 'N' ? {x: lat, y: b.y, w: width, h: 1} : s === 'S' ? {x: lat, y: b.y + b.h - 1, w: width, h: 1}
      : s === 'W' ? {x: b.x, y: lat, w: 1, h: width} : {x: b.x + b.w - 1, y: lat, w: 1, h: width};
    windows.push({rect: wall, side: s, level: 2, sill: 0.5, head: 3.2, kind: 'window', host: {building: b.id}});
  }

  /** A short open arm off the lobby (no wall between) on rock, clear of the wells: `width` wide, `len` long. Null when it does not fit. */
  function armOff(bc: BuildingCarve, level: number, s: Side, lat: number, width: number, len: number): CellRect | null {
    const r = against(bc.hub, s, lat, width, len);
    if (!within(bc.I, grow(r, 0)) || !rockBand(r, level, !alongXSide(s))) return null;
    // the far end keeps a wall from whatever lies beyond
    const end: CellRect = s === 'N' ? {x: r.x, y: r.y - 1, w: r.w, h: 1} : s === 'S' ? {x: r.x, y: r.y + r.h, w: r.w, h: 1} : s === 'W' ? {x: r.x - 1, y: r.y, w: 1, h: r.h} : {x: r.x + r.w, y: r.y, w: 1, h: r.h};
    if (!k.solid(end, level) || !within(bc.I, end)) return null;
    if (!mouthClear(bc, level, s, lat, width)) return null;
    return r;
  }

  /** A dead-end shop ARCADE off the lobby (a mall arm lined by units later). */
  function arcade(bc: BuildingCarve, level: number): void {
    const width = rng.int(8, 10);
    for (const s of rng.shuffle(SIDES.slice())) {
      const room = s === 'N' ? bc.hub.y - bc.I.y : s === 'S' ? bc.I.y + bc.I.h - bc.hub.y - bc.hub.h : s === 'W' ? bc.hub.x - bc.I.x : bc.I.x + bc.I.w - bc.hub.x - bc.hub.w;
      const len = Math.min(legacy ? rng.int(14, 24) : rng.int(18, 30), room - 10);
      if (len < 10) continue;
      for (const lat of latOf(bc, s, width, 'random').slice(0, 10)) {
        const r = armOff(bc, level, s, lat, width, len);
        if (!r) continue;
        const a = k.addArea(r, 'concourse', level === 2 ? 'retail-arcade' : 'concourse', ceilOf(level, level === 2 ? CLEAR.skyway : CLEAR.lobby), -1,
          {...opt(level), label: `${level === 2 ? 'Skyway arcade' : 'Arcade'} · ${bName(bc.b)}`, publicSpace: true, role: 'mall'});
        addPublic(bc, level, a.id);
        return;
      }
    }
  }

  /** A SERVICE CORRIDOR off the lobby lined with back rooms (storage, utility, staff) — or the building's OFFICE SUITE. */
  function serviceCorridor(bc: BuildingCarve, level: number, offices: boolean): void {
    const width = rng.int(4, 5);
    for (const s of rng.shuffle(SIDES.slice())) {
      const room = s === 'N' ? bc.hub.y - bc.I.y : s === 'S' ? bc.I.y + bc.I.h - bc.hub.y - bc.hub.h : s === 'W' ? bc.hub.x - bc.I.x : bc.I.x + bc.I.w - bc.hub.x - bc.hub.w;
      const len = Math.min(rng.int(16, 26), room - 4);
      if (len < 14) continue;
      for (const lat of latOf(bc, s, width, 'random').slice(0, 10)) {
        const r = armOff(bc, level, s, lat, width, len);
        if (!r) continue;
        // the corridor is its own room behind a door from the lobby (a one-cell wall slice: the corridor starts a cell in)
        const body = s === 'N' ? {x: r.x, y: r.y, w: r.w, h: r.h - 1} : s === 'S' ? {x: r.x, y: r.y + 1, w: r.w, h: r.h - 1} : s === 'W' ? {x: r.x, y: r.y, w: r.w - 1, h: r.h} : {x: r.x + 1, y: r.y, w: r.w - 1, h: r.h};
        const door = s === 'N' ? {x: r.x, y: r.y + r.h - 1, w: r.w, h: 1} : s === 'S' ? {x: r.x, y: r.y, w: r.w, h: 1} : s === 'W' ? {x: r.x + r.w - 1, y: r.y, w: 1, h: r.h} : {x: r.x, y: r.y, w: 1, h: r.h};
        const hubAt = s === 'N' ? [door.x + 2, door.y + 1] : s === 'S' ? [door.x + 2, door.y - 1] : s === 'W' ? [door.x + 1, door.y + 2] : [door.x - 1, door.y + 2];
        const g = k.grid(level), H = k.areas[g.area[g.idx(hubAt[0], hubAt[1])]];
        if (!H) continue;
        const label = offices ? `Office suite · ${bName(bc.b)}` : 'Service corridor';
        const cor = k.addArea(body, 'passage', 'passage', ceilOf(level, CLEAR.corridor), H.id, {...opt(level), label, publicSpace: !offices});
        const dw = Math.min(3, width), d0 = Math.floor((width - dw) / 2);
        k.carveDoor(alongXSide(s) ? {x: door.x + d0, y: door.y, w: dw, h: 1} : {x: door.x, y: door.y + d0, w: 1, h: dw}, H, cor, CLEAR.door, false, offices ? {} : {staff: true});
        // rooms along both long sides of the corridor (each with its door from the corridor)
        const long: Side[] = alongXSide(s) ? ['W', 'E'] : ['N', 'S'];
        const L = alongXSide(s) ? body.h : body.w;
        let n = 0;
        for (const ls of long) {
          let t = 1;
          while (t < L - 5) {
            const along = offices ? rng.int(8, 11) : rng.int(6, 10), deep = offices ? rng.int(8, 11) : rng.int(6, 9);
            if (t + along > L - 1) break;
            const rr = beyond(body, ls, t, along, deep);
            const gap = gapOn(body, ls, t + Math.floor(along / 2) - 1, 3);
            if (!free(rr, level, bc.I) || !k.solid(gap, level)) { t += 2; continue; }
            const [type, kind, lab]: [Area['type'], 'room' | 'closet', string] = offices ? ['agent-office', 'room', 'Office']
              : rng.weighted([[['storage', 'room', 'Storage room'], 3], [['utility', 'room', 'Utility room'], 2], [['crew-room', 'room', 'Staff room'], 1.5], [['stock-room', 'room', 'Stock room'], 1.5], [['janitor-closet', 'closet', 'Janitor closet'], 1]] as const) as [Area['type'], 'room' | 'closet', string];
            const a = k.addArea(rr, kind, type, ceilOf(level, CLEAR.back), cor.id, {...opt(level), label: lab, publicSpace: false});
            k.carveDoor(gap, cor, a, CLEAR.door, false, offices ? {} : {staff: true});
            n++;
            t += along + 1;
          }
        }
        void n;
        return;
      }
    }
  }

  function carveAddon(bc: BuildingCarve, id: SkywaysAddonId, level: 1 | 2, approach: 'direct' | 'foyer'): AddonCarve | null {
    for (const appr of approach === 'foyer' ? ['foyer', 'direct'] as const : ['direct'] as const) {
      const got = tryAddon(bc, id, level, appr);
      if (got) return got;
    }
    return null;
  }

  function tryAddon(bc: BuildingCarve, id: SkywaysAddonId, lv: 1 | 2, appr: 'direct' | 'foyer'): AddonCarve | null {
    const {I, hub, b} = bc;
    const minAlong = id === 'convention' ? 52 : 34, minDeep = id === 'convention' ? 26 : 28;
    // a hall on rock beyond one hub side, inside the interior, on the add-on's storey (per side, the largest that fits) whose entry
    // faces flat lobby floor (never a run well) — straight off the lobby, or across a FOYER (a short open hall from the lobby)
    const g = k.grid(lv);
    const ewidth = id === 'prize-car' ? 14 : 10;
    const foy = appr === 'foyer' ? rng.int(5, 8) : 0;
    const fwide = ewidth + (id === 'prize-car' ? 6 : 8);
    const cands: {r: CellRect; s: Side; score: number; gap: CellRect; foyer: CellRect | null}[] = [];
    for (const s of SIDES) {
      const deepMax = (s === 'N' ? hub.y - 1 - I.y : s === 'S' ? I.y + I.h - (hub.y + hub.h + 1) : s === 'W' ? hub.x - 1 - I.x : I.x + I.w - (hub.x + hub.w + 1)) - foy;
      if (deepMax < minDeep) continue;
      const a0 = alongXSide(s) ? I.x : I.y, a1 = alongXSide(s) ? I.x + I.w : I.y + I.h;
      let got: (typeof cands)[number] | null = null;
      for (let deep = deepMax; deep >= minDeep && !got; deep -= 2) {
        for (let w = a1 - a0; w >= minAlong && !got; w -= 2) {
          for (let o = 0; o + w <= a1 - a0; o += 2) {
            const r: CellRect = s === 'N' ? {x: a0 + o, y: hub.y - 1 - foy - deep, w, h: deep} : s === 'S' ? {x: a0 + o, y: hub.y + hub.h + foy + 1, w, h: deep}
              : s === 'W' ? {x: hub.x - 1 - foy - deep, y: a0 + o, w: deep, h: w} : {x: hub.x + hub.w + foy + 1, y: a0 + o, w: deep, h: w};
            const ov0 = alongXSide(s) ? Math.max(r.x, hub.x) : Math.max(r.y, hub.y);
            const ov1 = alongXSide(s) ? Math.min(r.x + r.w, hub.x + hub.w) : Math.min(r.y + r.h, hub.y + hub.h);
            if (ov1 - ov0 < (foy ? fwide : ewidth) + 2) continue;
            if (!within(I, r) || !k.rectFree(r, lv)) continue;
            // a street-level ballroom rises through the skyway storey: nothing may be carved above it
            if (lv === 1 && !k.solid(grow(r, 1), 2)) continue;
            // the entry: centred on the overlap, slid along it until flat lobby floor lies in front of it (directly, or across the foyer)
            const hubSide: Side = opposite(s);
            let gap: CellRect | null = null, foyer: CellRect | null = null;
            for (const d of [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10]) {
              const e0 = Math.round((ov0 + ov1 - ewidth) / 2) + d;
              if (e0 < ov0 || e0 + ewidth > ov1) continue;
              const gp: CellRect = hubSide === 'S' ? {x: e0, y: r.y + r.h, w: ewidth, h: 1} : hubSide === 'N' ? {x: e0, y: r.y - 1, w: ewidth, h: 1}
                : hubSide === 'E' ? {x: r.x + r.w, y: e0, w: 1, h: ewidth} : {x: r.x - 1, y: e0, w: 1, h: ewidth};
              if (foy) {
                const f0 = Math.max(ov0, Math.min(ov1 - fwide, e0 - Math.round((fwide - ewidth) / 2)));
                if (f0 + fwide > ov1 || f0 > e0 || f0 + fwide < e0 + ewidth) continue;
                const fr = against(hub, s, f0, fwide, foy);
                if (!rockBand(fr, lv, !alongXSide(s)) || !mouthClear(bc, lv, s, f0, fwide)) continue;
                gap = gp; foyer = fr; break;
              }
              let ok = true;
              for (let q = 0; q < ewidth && ok; q++) {
                const cx = gp.w > 1 ? gp.x + q : hubSide === 'E' ? gp.x + 1 : gp.x - 1;
                const cy = gp.h > 1 ? gp.y + q : hubSide === 'S' ? gp.y + 1 : gp.y - 1;
                const i = g.idx(cx, cy);
                if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) ok = false;
              }
              if (ok) { gap = gp; break; }
            }
            if (!gap) continue;
            got = {r, s, score: r.w * r.h, gap, foyer};
            break;
          }
        }
      }
      if (got) cands.push(got);
    }
    if (!cands.length) return null;
    // a seeded pick among the sides that fit (only halls at least 70 % of the largest, the larger likelier): the side varies, the
    // hall stays roomy
    const top = Math.max(...cands.map(c => c.score));
    const {r: r0, s, gap, foyer} = rng.weighted(cands.filter(c => c.score >= 0.7 * top).map(c => [c, c.score * c.score] as const));
    // the convention keeps a support strip (green room, washrooms, storage) along the hall's flank, away from the entry
    let r = r0, strip: CellRect | null = null;
    if (id === 'convention') {
      const SW = 11;
      const along = alongXSide(s);
      const gapMid = along ? gap.x + gap.w / 2 : gap.y + gap.h / 2, mid = along ? r0.x + r0.w / 2 : r0.y + r0.h / 2;
      const atLow = gapMid > mid; // the strip at the end away from the entry
      if (along) { strip = {x: atLow ? r0.x : r0.x + r0.w - SW, y: r0.y, w: SW, h: r0.h}; r = {x: atLow ? r0.x + SW + 1 : r0.x, y: r0.y, w: r0.w - SW - 1, h: r0.h}; }
      else { strip = {x: r0.x, y: atLow ? r0.y : r0.y + r0.h - SW, w: r0.w, h: SW}; r = {x: r0.x, y: atLow ? r0.y + SW + 1 : r0.y, w: r0.w, h: r0.h - SW - 1}; }
      // the entry must still open onto the hall
      const g0x = along ? gap.x : gap.y, g1x = g0x + ewidth, h0 = along ? r.x : r.y, h1 = h0 + (along ? r.w : r.h);
      if (g0x < h0 || g1x > h1) return null;
    }
    // a street-level ballroom is double height (through the skyway storey: those cells stay open air while carving, rock after)
    if (lv === 1) keepAir(grow(r0, 1));
    const hallCeil = ceilOf(lv, id === 'convention' ? 5.6 : 6.0);
    const label = id === 'convention' ? (lv === 1 ? 'Ballroom' : 'Convention hall') : 'Grand prize atrium';
    const hall = k.addArea(r, 'concourse', 'concourse', hallCeil, -1, {...opt(lv), label, publicSpace: true, role: 'great-hall'});
    addPublic(bc, lv, hall.id);
    const hubSide: Side = opposite(s);
    const areas = [hall.id];
    let front: Area | undefined;
    if (foyer) {
      const fa = k.addArea(foyer, 'concourse', 'concourse', ceilOf(lv, lv === 2 ? CLEAR.skyway : CLEAR.lobby), -1,
        {...opt(lv), label: id === 'convention' ? 'Pre-function foyer' : 'Showroom approach', publicSpace: true, role: 'great-hall'});
      addPublic(bc, lv, fa.id);
      areas.push(fa.id);
      front = fa;
    } else front = k.areas[g.area[g.idx(...frontCell(gap, hubSide))]];
    if (!front) return null;
    k.carveDoor(gap, front, hall, id === 'prize-car' ? 3.4 : CLEAR.wide, false);
    const washrooms: number[] = [];
    // support rooms along the hall's flank sides (convention: green room, storage, washrooms; prize car: a sales office)
    const flank: Side[] = alongXSide(s) ? ['W', 'E'] : ['N', 'S'];
    const rooms: [string, 'room' | 'closet', Area['type'], number, number][] = id === 'convention'
      ? [['Green room', 'room', 'crew-room', 12, 10], ['Washrooms', 'room', 'washroom', 10, 9], ['Event storage', 'room', 'storage', 12, 10]]
      : [['Sales office', 'room', 'agent-office', 12, 10], ['Washrooms', 'room', 'washroom', 10, 9]];
    if (strip) {
      // the strip's rooms in a row along it, each with its door through the wall into the hall
      const stripSide: Side = alongXSide(s) ? (strip.x < r.x ? 'W' : 'E') : (strip.y < r.y ? 'N' : 'S');
      const len = alongXSide(s) ? strip.h : strip.w;
      let t = 0;
      for (const [label2, kind, type, along] of rooms) {
        const L = Math.min(along + 2, len - t);
        if (L < 7) break;
        const rr: CellRect = alongXSide(s) ? {x: strip.x, y: strip.y + t, w: strip.w, h: L} : {x: strip.x + t, y: strip.y, w: L, h: strip.h};
        const a = k.addArea(rr, kind, type, ceilOf(lv, CLEAR.back), hall.id, {...opt(lv), label: label2, publicSpace: type === 'washroom'});
        const d0 = t + Math.floor(L / 2) - 1;
        k.carveDoor(gapOn(r, stripSide, d0 - (alongXSide(s) ? r.y - strip.y : r.x - strip.x), 3), hall, a, CLEAR.door, false, type === 'washroom' ? {} : {staff: true});
        areas.push(a.id);
        if (type === 'washroom') washrooms.push(a.id);
        t += L + 1;
      }
    }
    for (const [label2, kind, type, along, deep] of strip ? [] : rooms) {
      let a: Area | null = null;
      for (const fs of [...flank, ...SIDES.filter(q => q !== s && q !== hubSide && !flank.includes(q))]) {
        const n = sideLen(r, fs) - along;
        for (let t = 2; t <= n - 2 && !a; t += 3) {
          const rr = beyond(r, fs, t, along, deep);
          if (!within(I, rr) || !k.rectFree(rr, lv)) continue;
          a = k.addArea(rr, kind, type, ceilOf(lv, CLEAR.back), hall.id, {...opt(lv), label: label2, publicSpace: type === 'washroom'});
          k.carveDoor(gapOn(r, fs, t + Math.floor(along / 2) - 1, 3), hall, a, CLEAR.door, false, type === 'washroom' ? {} : {staff: true});
        }
        if (a) break;
      }
      if (a) { areas.push(a.id); if (type === 'washroom') washrooms.push(a.id); }
    }
    if (id === 'convention' && !washrooms.length) return null; // the mascot points the way to them: they must exist
    // the stage: along the wall opposite the entry, 40-55 % of the hall's width, 7-9 cells deep (props render it; see addon.ts)
    let stage: CellRect | null = null;
    if (id === 'convention') {
      const sw = Math.round(sideLen(r, s) * rng.range(0.4, 0.55)), sd = rng.int(7, 9);
      const t = Math.round((sideLen(r, s) - sw) / 2);
      stage = s === 'N' ? {x: r.x + t, y: r.y + 1, w: sw, h: sd} : s === 'S' ? {x: r.x + t, y: r.y + r.h - 1 - sd, w: sw, h: sd}
        : s === 'W' ? {x: r.x + 1, y: r.y + t, w: sd, h: sw} : {x: r.x + r.w - 1 - sd, y: r.y + t, w: sd, h: sw};
    }
    // the prize car: in the middle of the hall, angled toward the entry
    let car: AddonCarve['car'] = null;
    if (id === 'prize-car') {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const ex = gap.x + gap.w / 2, ey = gap.y + gap.h / 2;
      // camera convention: forward = (-sin yaw, -cos yaw); face 35-50 degrees off the entry line (a showroom angle)
      const toward = Math.atan2(-(ex - cx), -(ey - cy));
      car = {cx, cy, yaw: toward + (rng.chance(0.5) ? 1 : -1) * rng.range(0.6, 0.9)};
    }
    // facade glazing where the hall meets the wall ring (a showroom / ballroom window wall)
    for (const fs of SIDES) {
      const touches = fs === 'N' ? r.y === I.y : fs === 'S' ? r.y + r.h === I.y + I.h : fs === 'W' ? r.x === I.x : r.x + r.w === I.x + I.w;
      if (!touches) continue;
      const t0 = alongXSide(fs) ? r.x + 2 : r.y + 2, t1 = alongXSide(fs) ? r.x + r.w - 2 : r.y + r.h - 2;
      for (const [q0, q1] of spans(t0, t1, 14)) {
        const rect = fs === 'N' ? {x: q0, y: b.y, w: q1 - q0, h: 1} : fs === 'S' ? {x: q0, y: b.y + b.h - 1, w: q1 - q0, h: 1}
          : fs === 'W' ? {x: b.x, y: q0, w: 1, h: q1 - q0} : {x: b.x + b.w - 1, y: q0, w: 1, h: q1 - q0};
        windows.push({rect, side: fs, level: lv, sill: id === 'prize-car' ? 0.3 : 0.9, head: id === 'prize-car' ? 4.6 : 3.4, kind: 'window', host: {building: b.id}});
      }
    }
    return {id, building: b.id, level: lv, approach: foyer ? 'foyer' : 'direct', hall: r, hallArea: hall.id, areas, entry: gap, foyer, stage, car, washrooms};
  }

  /**
   * (layout version 3, task studio-skyways-rework-20261107-054512-01; user: "a bridge should lead directly into the event building /
   * floor ... several connected event areas") The CONVENTION VENUE: the host's whole skyway floor is rented to the event —
   *  - the MAIN HALL (stage + audience) beyond a hub side with its back-of-house strip (green room = backstage, event storage,
   *    washrooms): the classic hall search (tryAddon), foyer approach and all;
   *  - the host's skyway court = the EXHIBITORS' FLOOR (artist alley, vendor tables, exhibits);
   *  - the corridors in from the bridges = REGISTRATION (welcome desks, badge queue);
   *  - two PANEL ROOMS and a PHOTO LOUNGE beyond the court's other sides (public doors);
   * every one of them in `venue` by role (the venue dresser fills them; the station's generic dresser keeps out). The street level
   * below stays the building's ordinary lobby, its stair the venue's second way in.
   */
  function carveVenue(bc: BuildingCarve): AddonCarve | null {
    const lv = 2;
    const main = carveAddon(bc, 'convention', lv, f.addonApproach);
    if (!main) return null;
    const venue: VenueRoomCarve[] = [];
    const hall = k.areas[main.hallArea];
    hall.label = 'Main stage hall';
    venue.push({role: 'main-hall', area: main.hallArea});
    for (const id of main.areas) {
      if (id === main.hallArea) continue;
      const t = k.areas[id].type;
      venue.push({role: t === 'washroom' ? 'washrooms' : t === 'crew-room' ? 'backstage' : t === 'storage' ? 'storage' : 'registration', area: id});
      if (t === 'concourse') k.areas[id].label = 'Main stage foyer';
    }
    const hubIds = bc.hubAreas.get(lv) ?? [];
    for (const id of hubIds) { k.areas[id].label = `Exhibitors' floor · ${bName(bc.b)}`; venue.push({role: 'exhibitors', area: id}); }
    // the corridors in from the bridges (and any other skyway-level public piece of the host): registration
    for (const id of bc.publicAreas.get(lv) ?? []) {
      if (hubIds.includes(id) || main.areas.includes(id)) continue;
      k.areas[id].label = `Registration · ${bName(bc.b)}`;
      venue.push({role: 'registration', area: id});
    }
    // panel rooms and a photo lounge beyond the court's free sides (public doors from the exhibitors' floor), largest pieces first
    const want: [SkywaysVenueRole, string][] = [['panel', 'Panel room A'], ['panel', 'Panel room B'], ['photo-lounge', 'Photo lounge']];
    const pieces = hubIds.map(id => k.areas[id]).sort((p, q) => q.w * q.h - p.w * p.h);
    for (const [role, label] of want) {
      let made: Area | null = null;
      for (const P of pieces) {
        for (const s of rng.shuffle(SIDES.slice())) {
          const along = role === 'panel' ? rng.int(16, 22) : rng.int(14, 20), deep = role === 'panel' ? rng.int(12, 16) : rng.int(10, 14);
          const N = sideLen(P, s) - along;
          for (let t = 1; t <= N - 1 && !made; t += 2) {
            const r = beyond(P, s, t, along, deep);
            const door = gapOn(P, s, t + Math.floor(along / 2) - 2, 4);
            if (!free(r, lv, bc.I) || !k.solid(door, lv)) continue;
            made = k.addArea(r, 'room', 'concourse', ceilOf(lv, CLEAR.skyway), P.id, {...opt(lv), label, publicSpace: true, role: 'great-hall'});
            k.carveDoor(door, P, made, CLEAR.door, false);
          }
          if (made) break;
        }
        if (made) break;
      }
      if (made) { venue.push({role, area: made.id}); addPublic(bc, lv, made.id); }
    }
    if (!venue.some(v => v.role === 'panel')) return null; // several connected event areas, never one hall
    return {...main, venue};
  }

  /**
   * (layout version 3; user: "prize car in public walkway / atrium, not separate room") The PRIZE DISPLAY: the car stands in its host's
   * skyway court like a real prize draw — the roomiest spot of the court's pieces (its stanchion ring + the board fit on flat floor,
   * clear of the run wells and the bridge landings), nose toward the nearest bridge landing (its clear way out onto the skyways).
   * No add-on rooms (`areas` empty: the court keeps its shops); `hall` = the display zone, `hallArea` = the court piece.
   */
  function carvePrizeDisplay(bc: BuildingCarve): AddonCarve | null {
    const lv = 2, g = k.grid(lv);
    const wells = [...bc.runs12, ...(bc.transit ? [bc.transit] : [])].map(w => grow(w.rect, 2));
    const mouths = bc.mouths.map(m => grow(m, 2));
    // (the zone may span the court's pieces round the wells: any court floor of the host's skyway level)
    const court = new Set(bc.hubAreas.get(lv) ?? []);
    // the court's openings so far (bridge corridors) and its walls (where the shopfronts go later): the zone keeps 2 cells of court
    // floor all round it, so the doors' strips stay walkable and the stanchions find their places
    const doors = k.doors.filter(d => court.has(d.a) || court.has(d.b)).map(d => grow({x: d.x, y: d.y, w: d.w, h: d.h}, 2));
    const M = 2;
    /** The roomiest spot for a display zone of half size R (cells), or null. */
    const find = (R: number): {cx: number; cy: number; score: number; area: number; R: number} | null => {
      let best: {cx: number; cy: number; score: number; area: number; R: number} | null = null;
      for (const id of court) {
        const P = k.areas[id];
        for (let cy = P.y + R; cy <= P.y + P.h - R; cy += 2) for (let cx = P.x + R; cx <= P.x + P.w - R; cx += 2) {
          const zone: CellRect = {x: cx - R, y: cy - R, w: 2 * R, h: 2 * R};
          if (wells.some(w => overlapsR(w, zone)) || mouths.some(m => overlapsR(m, zone)) || doors.some(d => overlapsR(d, zone))) continue;
          let ok = true;
          for (let y = zone.y - M; y < zone.y + zone.h + M && ok; y++) for (let x = zone.x - M; x < zone.x + zone.w + M && ok; x++) {
            const i = g.idx(x, y);
            if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || !court.has(g.area[i])) ok = false;
          }
          if (!ok) continue;
          const score = Math.min(cx - P.x, P.x + P.w - cx, cy - P.y, P.y + P.h - cy) - 0.05 * Math.hypot(cx - (P.x + P.w / 2), cy - (P.y + P.h / 2)) + rng.range(0, 0.5);
          if (!best || score > best.score) best = {cx, cy, score, area: id, R};
        }
      }
      return best;
    };
    // display zone half size (cells): the stanchion ring (~4.1 m radius) with room for its board beside it; tighter in a smaller court
    const best = find(10) ?? find(9) ?? find(8);
    if (!best) return null;
    const {cx, cy, R} = best;
    // nose toward the nearest bridge landing (else along the court's long axis)
    const P = k.areas[best.area];
    const mid = bc.mouths.map(m => ({x: m.x + m.w / 2, y: m.y + m.h / 2})).sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy))[0];
    const to = mid ?? (P.w >= P.h ? {x: cx + 1, y: cy} : {x: cx, y: cy + 1});
    const yaw = Math.atan2(-(to.x - cx), -(to.y - cy));
    const hall: CellRect = {x: cx - R, y: cy - R, w: 2 * R, h: 2 * R};
    // the stand point (a cell) on the display's edge toward the way out
    const ux = Math.sign(Math.round(to.x - cx)), uy = Math.sign(Math.round(to.y - cy));
    const entry: CellRect = {x: cx + ux * (R - 1), y: cy + uy * (R - 1), w: 1, h: 1};
    return {id: 'prize-car', building: bc.b.id, level: lv, approach: 'direct', hall, hallArea: best.area, areas: [], entry, foyer: null, stage: null, car: {cx, cy, yaw}, washrooms: []};
  }

  /**
   * (layout version 3, task studio-skyways-rework-20261107-054512-01) A tenant's OFFICE WING off a public lobby / court of its building:
   * the OPEN-PLAN office beyond a hub side (a wide public entrance from the lobby), and off its other sides a meeting room, two private
   * offices and a break room (doors from the open plan). Dressed with the office kit (gen/skyways/officeWing.ts); null when it cannot fit.
   */
  function carveOfficeWing(bc: BuildingCarve, level: number): OfficeWingCarve | null {
    const tenant = OFFICE_TENANTS[(f.seed >>> 0) % OFFICE_TENANTS.length];
    const pieces = (bc.hubAreas.get(level) ?? []).map(id => k.areas[id]).filter(a => !addonAreas.includes(a.id)).sort((p, q) => q.w * q.h - p.w * p.h);
    for (const P of pieces) {
      for (const s of rng.shuffle(SIDES.slice())) {
        const along = rng.int(20, 28), deep = rng.int(14, 18);
        const N = sideLen(P, s) - along;
        for (let t = 1; t <= N - 1; t += 2) {
          const r = beyond(P, s, t, along, deep);
          const door = gapOn(P, s, t + Math.floor(along / 2) - 2, 4);
          if (!free(r, level, bc.I) || !k.solid(door, level)) continue;
          const open = k.addArea(r, 'room', 'office-open', ceilOf(level, CLEAR.skyway), P.id, {...opt(level), label: `${tenant} · open office`, publicSpace: true});
          k.carveDoor(door, P, open, CLEAR.door, false);
          addPublic(bc, level, open.id);
          const rooms: {role: SkywaysOfficeRole; area: number}[] = [{role: 'open', area: open.id}];
          const want: [SkywaysOfficeRole, string, [number, number], [number, number]][] = [['meeting', 'meeting room', [11, 13], [9, 10]], ['office', 'office', [7, 8], [7, 8]],
            ['office', 'office', [7, 8], [7, 8]], ['break', 'break room', [10, 12], [8, 9]]];
          const back = opposite(s);
          for (const [role, lab, al, dp] of want) {
            let made: Area | null = null;
            for (const rs of [back, ...SIDES.filter(q => q !== back && q !== s)]) {
              const A = rng.int(al[0], al[1]), D = rng.int(dp[0], dp[1]), n = sideLen(open, rs) - A;
              for (let u = 1; u <= n - 1 && !made; u += 2) {
                const rr = beyond(open, rs, u, A, D);
                const g = gapOn(open, rs, u + Math.floor(A / 2) - 1, 3);
                if (!free(rr, level, bc.I) || !k.solid(g, level)) continue;
                made = k.addArea(rr, 'room', 'office-room', ceilOf(level, CLEAR.back), open.id, {...opt(level), label: `${tenant} · ${lab}`, publicSpace: true});
                k.carveDoor(g, open, made, CLEAR.door, false);
              }
              if (made) break;
            }
            if (made) rooms.push({role, area: made.id});
          }
          return {building: bc.b.id, level, tenant, rooms};
        }
      }
    }
    return null;
  }

  function carveRamen(bc: BuildingCarve): RamenCarve | null {
    // a compact dining room off a public edge with its kitchen beside it (skyway level, then street level, then the pedway concourse)
    const tries: [BuildingCarve, number][] = [[bc, 2], [bc, 1], [sc, 0]];
    for (const [B, level] of tries) {
      for (const pid of rng.shuffle((B.publicAreas.get(level) ?? []).filter(id => !addonAreas.includes(id) && !pedwayAreas.includes(id)))) {
        const P = k.areas[pid];
        for (const s of rng.shuffle(SIDES.slice())) {
          const along = rng.int(16, 20), kal = rng.int(7, 9), deep = rng.int(10, 12);
          const n = sideLen(P, s) - along - kal - 1;
          for (let t = 1; t <= n; t += 2) {
            const r = beyond(P, s, t, along, deep);
            const kr = beyond(P, s, t + along + 1, kal, deep);
            const inside = level ? B.I : undefined;
            if (!free(r, level, inside) || !free(kr, level, inside)) continue;
            const gap = gapOn(P, s, t + Math.floor(along / 2) - 3, 6);
            if (!k.solid(gap, level)) continue;
            const name = rng.pick(RAMEN_NAMES);
            const dining = k.addArea(r, 'room', 'eatery', ceilOf(level, CLEAR.shop), P.id, {...opt(level), label: name, publicSpace: true});
            dining.purpose = SKYWAYS_RAMEN_PURPOSE.dining;
            const kitchen = k.addArea(kr, 'room', 'eatery', ceilOf(level, CLEAR.back), dining.id, {...opt(level), label: `${name} kitchen`, publicSpace: false});
            kitchen.purpose = SKYWAYS_RAMEN_PURPOSE.kitchen;
            k.carveDoor(gap, P, dining, CLEAR.door + 0.2, false);
            // the kitchen door through the shared side wall (one cell between the two rooms)
            const side2: Side = alongXSide(s) ? 'E' : 'S';
            k.carveDoor(gapOn(r, side2, Math.max(1, Math.floor(deep / 2) - 1), 3), dining, kitchen, CLEAR.door, false, {staff: true});
            return {building: B.b.id, level, dining: dining.id, kitchen: kitchen.id};
          }
        }
      }
    }
    return null;
  }

  /**
   * An underground PEDWAY (storey 0) from the station concourse to a building's pedway stair well (inside its lobby, on the edge
   * facing the station): a landing at the well's bottom mouth and a straight or L-shaped tunnel to the concourse (rock all the way,
   * with a wall either side). False (nothing carved) when it does not fit.
   */
  function lowerPedway(bc: BuildingCarve): boolean {
    const w = bc.down!, R = w.rect;
    // the well's storey-0 half must be rock with walls along its sides
    if (!rockBand(R, 0, w.axis === 'x')) return false;
    // the landing beyond the well's bottom end (the end opposite its top)
    const bottomHi = w.from === 'lo'; // top at the low end -> the bottom mouth at the high end
    const LD = 7;
    const land: CellRect = w.axis === 'x'
      ? {x: bottomHi ? R.x + R.w : R.x - LD, y: R.y - 2, w: LD, h: R.h + 4}
      : {x: R.x - 2, y: bottomHi ? R.y + R.h : R.y - LD, w: R.w + 4, h: LD};
    if (!k.solid(grow(land, 1), 0)) return false;
    const C = C0rect; // the whole concourse (its pieces round the transit well)
    const BW = 9;
    const lx = Math.round(land.x + land.w / 2), ly = Math.round(land.y + land.h / 2);
    const inX = (x: number) => x >= C.x + 3 && x <= C.x + C.w - 3, inZ = (y: number) => y >= C.y + 3 && y <= C.y + C.h - 3;
    /** A horizontal band at z centre `zc` from x `xa` to `xb` (inclusive cells), a vertical band at x centre `xc` from z `za` to `zb`. */
    const hBand = (zc: number, xa: number, xb: number): CellRect => ({x: Math.min(xa, xb), y: zc - Math.floor(BW / 2), w: Math.abs(xb - xa) + 1, h: BW});
    const vBand = (xc: number, za: number, zb: number): CellRect => ({x: xc - Math.floor(BW / 2), y: Math.min(za, zb), w: BW, h: Math.abs(zb - za) + 1});
    const cEdgeX = (x: number) => (x < C.x ? C.x : C.x + C.w - 1), cEdgeZ = (y: number) => (y < C.y ? C.y : C.y + C.h - 1);
    const routes: CellRect[][] = [];
    const xc = Math.max(C.x + 3 + 4, Math.min(C.x + C.w - 3 - 5, lx)), zc = Math.max(C.y + 3 + 4, Math.min(C.y + C.h - 3 - 5, ly));
    // straight along x (the landing level with the concourse) / along z (the landing over the concourse's span)
    if (inZ(ly) && !inX(lx)) routes.push([hBand(zc, lx, cEdgeX(lx) + (lx < C.x ? -1 : 1))]);
    if (inX(lx) && !inZ(ly)) routes.push([vBand(xc, ly, cEdgeZ(ly) + (ly < C.y ? -1 : 1))]);
    // L-shaped: along x to the concourse's column then along z into it, or along z first then along x
    if (!inX(lx) && !inZ(ly)) {
      routes.push([hBand(ly, lx, xc), vBand(xc, ly, cEdgeZ(ly) + (ly < C.y ? -1 : 1))]);
      routes.push([vBand(lx, ly, zc), hBand(zc, lx, cEdgeX(lx) + (lx < C.x ? -1 : 1))]);
    }
    for (const route of routes) {
      // each band rock with walls along its long sides (its ends meet the landing / the other band / the concourse)
      const ok = route.every(r => r.w > 0 && r.h > 0 && rockBand(r, 0, r.w >= r.h));
      if (!ok) continue;
      // (k.solid keeps the main-level rock under other storeys' landings: never under the station block)
      const la = k.addArea(land, 'concourse', 'concourse', CLEAR.concourse - 0.6, concourse.id, {label: `Pedway to ${bName(bc.b)}`, publicSpace: true, role: 'transfer'});
      addPublic(sc, 0, la.id); pedwayAreas.push(la.id);
      for (const r of route) {
        const body = trimTo(r);
        if (body.w < 1 || body.h < 1) continue;
        const a = k.addArea(body, 'concourse', 'concourse', CLEAR.concourse - 0.6, concourse.id, {label: `Pedway to ${bName(bc.b)}`, publicSpace: true, role: 'transfer'});
        addPublic(sc, 0, a.id); pedwayAreas.push(a.id);
      }
      return true;
    }
    return false;
    // the band minus cells already carved (the landing / the first band) — areas never overlap
    function trimTo(r: CellRect): CellRect {
      const out = {...r};
      const g = k.grid(0);
      const free0 = (x: number, y: number) => g.cells[g.idx(x, y)] === SOLID;
      if (out.w >= out.h) { while (out.w > 0 && !free0(out.x, out.y + 1)) { out.x++; out.w--; } while (out.w > 0 && !free0(out.x + out.w - 1, out.y + 1)) out.w--; }
      else { while (out.h > 0 && !free0(out.x + 1, out.y)) { out.y++; out.h--; } while (out.h > 0 && !free0(out.x + 1, out.y + out.h - 1)) out.h--; }
      return out;
    }
  }

  function shopsOn(bc: BuildingCarve, level: number, publicIds: number[], mix: 'food' | 'mixed' | 'skyway', target: number): void {
    let n = 0;
    const useCount = new Map<ShopUse, number>();
    const pool = mix === 'food' ? FOOD_POOL : mix === 'mixed' ? STREET_POOL : SKYWAY_POOL;
    for (const pid of mix === 'food' && level ? publicIds.slice() : rng.shuffle(publicIds.slice())) {
      const P = k.areas[pid];
      for (const s of rng.shuffle(SIDES.slice())) {
        let t = 1 + rng.int(0, 2);
        while (t < sideLen(P, s) - 6 && n < target) {
          const min = Math.min(...pool.map(([u]) => useCount.get(u) ?? 0));
          const use = rng.weighted(pool.filter(([u]) => (useCount.get(u) ?? 0) === min));
          const info = STORE_PURPOSES[use];
          const w = Math.min(rng.int(info.w[0], info.w[1]), sideLen(P, s) - t - 1);
          if (w < 6) break;
          let d = rng.int(Math.max(8, info.d[0]), Math.max(10, info.d[1]));
          let r = beyond(P, s, t, w, d);
          const inside = level === 0 ? null : bc.I;
          while (!free(r, level, inside ?? undefined) && d - 2 >= 7) { d -= 2; r = beyond(P, s, t, w, d); }
          const gap = gapOn(P, s, t, w);
          if (!free(r, level, inside ?? undefined) || !k.solid(gap, level)) { t += 2; continue; }
          // (layout version 3) the walls alongside a public run's run-outs stay plain (a car lines up there, no shopfront glazing)
          if (!legacy && runOuts.some(q => q.level === level && overlapsR(grow(q.rect, 1), gap))) { t += 2; continue; }
          const sf = shopfront(level, P, s, gap, r, use);
          storefronts.push(sf);
          useCount.set(use, (useCount.get(use) ?? 0) + 1);
          n++;
          t += w + 1;
        }
      }
    }
  }

  function shopfront(level: number, P: Area, s: Side, gap: CellRect, r: CellRect, use: ShopUse, an?: {family: string; name: string; ceil: number; entryW: number}): Storefront {
    const info = STORE_PURPOSES[use];
    const isFood = info.category === 'food';
    // glazed retail fronts stand open (glass either side of the entry); counter fronts may have their shutter stuck part-way
    // (a destination anchor: always a glazed open front with a wide entry)
    const shutter = info.glazed || an ? 'open' as const : rng.weighted([['open', 0.65], ['partial', 0.35]] as const);
    const head = r2(rng.range(2.55, 2.8)), fasciaTop = r2(Math.min(head + rng.range(0.55, 0.75), (P.ceil - BASES[level]) - 0.15));
    const glazed = (info.glazed || !!an) && gap.w + gap.h - 1 >= 6;
    const ow = gap.w + gap.h - 1;
    const entryW = Math.min(ow - 2, an ? an.entryW : rng.int(2, 3));
    const e0 = !glazed ? 0 : an ? Math.floor((ow - entryW) / 2) : rng.chance(0.5) ? 1 : Math.floor((ow - entryW) / 2);
    const sf: Storefront = {
      id: storefronts.length, hall: P.id, side: s, unit: -1, ox: gap.x, oy: gap.y, ow: gap.w, oh: gap.h, ux: r.x, uy: r.y, uw: r.w, uh: r.h,
      use, food: isFood, name: an ? an.name : shopName(use), shutter, head, shutterY: shutter === 'partial' ? r2(rng.range(1.95, 2.2)) : head, fasciaTop,
      sign: shutter === 'open' ? rng.weighted([['lit', 0.5], ['dim', 0.3], ['dead', 0.2]] as const) : rng.weighted([['dim', 0.4], ['dead', 0.6]] as const),
      glazed, entry: glazed ? [e0, e0 + entryW] : [0, ow], color: rng.pick(info.colors), backDoor: -1,
      style: 'slat',
      ...(level ? {level, baseY: BASES[level]} : {}),
      ...(an ? {anchor: an.family} : {}),
    };
    // every unit has an interior (an abandoned network: a closed shutter is a grille you can see through, or reached via a partial)
    const unit = k.addArea(r, 'room', isFood ? 'eatery' : 'shop', an ? an.ceil : ceilOf(level, CLEAR.shop), P.id, {...opt(level), label: sf.name, publicSpace: true});
    unit.storefront = sf.id;
    unit.purpose = use;
    sf.unit = unit.id;
    k.carveDoor(gap, P, unit, sf.shutter === 'partial' ? sf.shutterY : head, false, {shopfront: true});
    k.reserve(gap.h === 1 ? {x: gap.x - 1, y: gap.y, w: gap.w + 2, h: 1} : {x: gap.x, y: gap.y - 1, w: 1, h: gap.h + 2});
    return sf;
  }

  function washroom(bc: BuildingCarve, level: number, publicIds: number[]): void {
    for (const pid of rng.shuffle(publicIds.slice())) {
      const P = k.areas[pid];
      for (const s of rng.shuffle(SIDES.slice())) {
        const along = 10, deep = rng.int(8, 10), n = sideLen(P, s) - along;
        for (let t = 1; t <= n - 1; t += 2) {
          const r = beyond(P, s, t, along, deep);
          if (!free(r, level, level ? bc.I : undefined) || !k.solid(gapOn(P, s, t + 3, 3), level)) continue;
          const a = k.addArea(r, 'room', 'washroom', ceilOf(level, CLEAR.back), P.id, {...opt(level), label: 'Washrooms', publicSpace: true});
          k.carveDoor(gapOn(P, s, t + 3, 3), P, a, CLEAR.door, false);
          return;
        }
      }
    }
  }

  function backOfHouse(bc: BuildingCarve, level: number, publicIds: number[], target: number): void {
    let n = 0;
    const types: [Area['type'], 'room' | 'closet', string, number][] = [['storage', 'room', 'Storage room', 3], ['utility', 'room', 'Utility room', 2], ['crew-room', 'room', 'Staff room', 1.5],
      ['stock-room', 'room', 'Stock room', 2], ['supply-closet', 'closet', 'Supply closet', 1], ['janitor-closet', 'closet', 'Janitor closet', 1]];
    for (const pid of rng.shuffle(publicIds.slice())) {
      const P = k.areas[pid];
      for (const s of rng.shuffle(SIDES.slice())) {
        if (n >= target) return;
        const [type, kind, label] = rng.weighted(types.map(q => [q, q[3]] as const));
        const along = kind === 'closet' ? rng.int(5, 7) : rng.int(9, 14), deep = kind === 'closet' ? rng.int(5, 6) : rng.int(8, 12);
        const N = sideLen(P, s) - along;
        for (let t = 1; t <= N - 1; t += 3) {
          const r = beyond(P, s, t, along, deep);
          const door = gapOn(P, s, t + 1, 3);
          if (!free(r, level, level ? bc.I : undefined) || !k.solid(door, level)) continue;
          const a = k.addArea(r, kind, type, ceilOf(level, CLEAR.back), P.id, {...opt(level), label, publicSpace: false});
          k.carveDoor(door, P, a, CLEAR.door, false, {staff: true});
          n++;
          break;
        }
      }
    }
  }
}

/** The cell in front of a one-cell wall gap on its `side` (toward that side's area). */
function frontCell(gap: CellRect, toward: Side): [number, number] {
  const cx = gap.x + Math.floor(gap.w / 2), cy = gap.y + Math.floor(gap.h / 2);
  return toward === 'N' ? [cx, gap.y - 1] : toward === 'S' ? [cx, gap.y + gap.h] : toward === 'W' ? [gap.x - 1, cy] : [gap.x + gap.w, cy];
}

/** [t0, t1) split into spans of at most `max` cells with a one-cell pier between them. */
function spans(t0: number, t1: number, max: number): [number, number][] {
  const len = t1 - t0;
  if (len < 3) return [];
  const n = Math.ceil((len + 1) / (max + 1));
  const each = (len - (n - 1)) / n;
  const out: [number, number][] = [];
  let a = t0;
  for (let i = 0; i < n; i++) {
    const b = i === n - 1 ? t1 : Math.round(a + each);
    if (b - a >= 2) out.push([a, b]);
    a = b + 1;
  }
  return out;
}
/** Maximal runs of t in [t0, t1) where pred(t). */
function runsWhere(t0: number, t1: number, pred: (t: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let t = t0; t <= t1; t++) {
    const on = t < t1 && pred(t);
    if (on && s < 0) s = t;
    if (!on && s >= 0) { out.push([s, t]); s = -1; }
  }
  return out;
}

/**
 * One vertical run between storey `lower` and `lower + 1` (carved into both grids): `lanes` side by side across the rect (a shared
 * pitch, like the mall's / office's transit hall), top end at `from`.
 */
function carveRun(k: Kit, id: string, building: string, lower: number, rect: CellRect, axis: 'x' | 'z', from: 'lo' | 'hi', lanes: RunLanes, enclosed: boolean): RunCarve {
  const hi = lower + 1;
  const clear = hi === 1 ? CLEAR.lobby : CLEAR.corridor;
  const ceil = r2(BASES[hi] + clear + (enclosed ? 0.4 : 0));
  const kinds = lanes.includes('escalator') ? (lanes.includes('stair') ? 'Escalators & stairs' : 'Escalators') : 'Stairs';
  const label = id === 'transit' ? `${kinds} · Concourse – Street level` : id.startsWith('pedway') ? 'Stairs · Pedway – Street level' : `${kinds} · Street level – +15`;
  const area = k.addArea(rect, 'passage', 'stair-core', ceil, -1, {...(lower ? {level: lower, floorY: BASES[lower]} : {}), also: [hi], role: 'stair', publicSpace: true, label});
  const out: RunLaneCarve[] = [];
  let off = 0;
  // (task studio-skyways-rework-20261107-054512-01, user bug: a low bulkhead hung over the stair approach) an OPEN well: the flights'
  // band rises to the well's ceiling (capCeil: capped by ceil[i] below), never a 2.5 m soffit following the flight
  const spec = (kind: 'escalator' | 'stair'): StairSpec => ({...(kind === 'escalator' ? RUN.escalator : RUN.stair), headroom: RUN_OPEN_HEADROOM});
  for (const kind of lanes) {
    const w = LANE_W[kind];
    const r: CellRect = axis === 'x' ? {x: rect.x, y: rect.y + off, w: rect.w, h: w} : {x: rect.x + off, y: rect.y, w, h: rect.h};
    off += w;
    const fl: StairFlight[] = layStairRun([k.grid(lower), k.grid(hi)], r, area.id, axis, from, BASES[hi], BASES[lower], spec(kind));
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; q.spec = kind === 'escalator' ? 'escalator' : 'transit'; ids.push(q.id); k.flights.push(q); k.grid(lower).ramps[q.ramp].capCeil = true; }
    out.push({kind, rect: r, flights: ids});
  }
  // an open well: both storeys' bands rise to the upper storey's ceiling over the whole run
  for (const g of [k.grid(lower), k.grid(hi)]) for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) g.ceil[g.idx(x, y)] = ceil;
  return {id, lower, rect, axis, from, lanes: out, area: area.id, enclosed, building};
}

// ---------------------------------------------------------------------------------------------
// Names and shop pools

const bName = (b: FrameBuilding): string => b.name;

const RAMEN_NAMES = ['Menya Hoshi', 'Ramen Kumo', 'Hoshi Noodle Bar', 'Shoyu House'];

const FOOD_POOL: [ShopUse, number][] = [['coffee', 3], ['bakery', 2], ['noodles', 1.5], ['sushi', 1.5], ['deli', 1.5], ['juice', 1], ['donut', 1], ['pizza', 1], ['burger', 1], ['shawarma', 1]];
const STREET_POOL: [ShopUse, number][] = [['coffee', 2], ['convenience', 2], ['pharmacy', 1.5], ['newsstand', 1.5], ['florist', 1], ['bakery', 1], ['phone', 1], ['keys', 0.6]];
const SKYWAY_POOL: [ShopUse, number][] = [['coffee', 2.5], ['convenience', 1.5], ['phone', 1.2], ['tech', 1.2], ['newsstand', 1], ['pharmacy', 1], ['juice', 1], ['deli', 1], ['bakery', 1], ['florist', 0.8]];

export {inRect, CELL};
