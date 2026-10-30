// Seamless Office Space (lane GEN): carving the office tower into the generator canvas (gen/stationKit.ts Kit, one level grid
// per storey) — the core shared by the lobby and every office floor (scissor stair landing, washrooms, closets; the elevator
// shaft stays SOLID), the corridor rings, the seeded room program of an office floor, and the scissor stair runs that join
// consecutive storeys. Pure data.
//
// Everything is carved at a canvas offset (ox, oy) = canvas cell of tower-local (0, 0), on the storey's level grid (`level`,
// absolute floor `base`): the lobby is level 1 at the lobby height, office floor n is level n at lobby + 4.4 (n - 1). The level
// crop later puts tower-local (0, 0) at grid cell (MARGIN, MARGIN) on every storey.

//
// Task office-overhaul-20261030 (lane TENANTS): every office floor 2..8 belongs to a company (gen/office/tenants.ts) and is carved by
// its FLOOR PROGRAM (gen/office/companies.ts): the company's reception off the elevator lobby (first floor of each tenant, centred on
// the elevator door), its themed rooms (trading floor, law library, labs, game lounge, gym, clinic exam rooms …), its open-plan
// style, office runs and an executive suite on its top floor (floor 8 always has one). The frame / core / corridors / stairwell /
// shaft are untouched; every area of a tenant floor carries `Area.tenant`, its meta the program key the company dresser reads.

import type {Rng} from '../../core/rng';
import {Kit, type AreaOpts} from '../stationKit';
import {layStairRun, type StairFlight} from '../traversal';
import type {Area, AreaKind, Door, Rect, RoomType} from '../stationTypes';
import {CEIL, SCISSOR_STAIR, WELL, landingEnd, landingRect, laneOf, type TowerFrame} from './frame';
import {BASE_ROOMS, COMPANIES, OPEN_STYLES, ROOMS, RUNS, roomLabel, type Company, type OpenStyle, type RoomKey, type RunKind} from './companies';
import {tenantOf} from './tenants';
import type {TenantFloor} from './overhaulTypes';

export interface TowerAt { ox: number; oy: number; level: number; base: number }

/** What the office dresser needs to know about a carved area. */
export interface OfficeAreaMeta {
  /** Program role (signage / dressing / spawns). */
  role: 'open' | 'bay' | 'private' | 'exec' | 'meeting' | 'break' | 'copy' | 'storage' | 'server' | 'corridor' | 'lobby' | 'reception'
    | 'security' | 'transit' | 'wc' | 'closet' | 'landing' | 'collapsed' | 'amenity';
  /** Facade sides of the area (perimeter walls = window walls). */
  facade: ('N' | 'S' | 'E' | 'W')[];
  /** TENANTS: company room / open-plan style / office-run room this area is (gen/office/companies.ts keys; company dressing). */
  program?: RoomKey | OpenStyle | RunKind;
}

export interface CoreAreas {
  /** The storey's scissor-stair landing and its doorway onto the north host (N corridor / lobby hall). */
  landing: Area; landingDoor: Door;
  wcM: Area; wcW: Area; closets: Area[];
}

export interface CarvedTower {
  at: TowerAt;
  floor: number;
  core: CoreAreas;
  meta: Map<number, OfficeAreaMeta>;
  /** Areas north / south of the core the core doors open onto (N corridor / lobby hall, S corridor / transit hall). */
  north: Area; south: Area;
  /** TENANTS: the company occupying this floor (office floors 2..8). */
  tenant?: TenantFloor;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
export const storeyLabel = (floor: number): string => (floor === 1 ? 'L' : String(floor));

function add(k: Kit, at: TowerAt, r: Rect, kind: AreaKind, type: RoomType, clear: number, parent: number, opts: AreaOpts & {purpose?: string} = {}): Area {
  const rect = {x: at.ox + r.x, y: at.oy + r.y, w: r.w, h: r.h};
  const {purpose, ...o} = opts;
  const a = k.addArea(rect, kind, type, r2(at.base + clear), parent, at.level ? {...o, level: at.level, floorY: at.base} : o);
  if (purpose) a.purpose = purpose;
  return a;
}

/** Door through a one-cell wall at tower-local cells (gap rect), `a` = the side whose level / floor it uses. */
function door(k: Kit, at: TowerAt, gap: Rect, a: Area, b: Area, height: number, extra: Partial<Door> = {}): Door {
  return k.carveDoor({x: at.ox + gap.x, y: at.oy + gap.y, w: gap.w, h: gap.h}, a, b, height, false, extra);
}

/**
 * The core of one storey: the scissor-stair landing at this storey's end of the well (doorway onto the north host), the
 * washrooms and closets of the core's south strip (doors onto the south host). The elevator shaft and the well's lanes are NOT
 * carved here (shaft: solid on every storey; lanes: the stair runs, carveScissor). Same cells on every storey.
 */
export function carveCore(k: Kit, f: TowerFrame, at: TowerAt, floor: number, north: Area, south: Area, meta: Map<number, OfficeAreaMeta>): CoreAreas {
  const lr = landingRect(f, floor), end = landingEnd(f, floor);
  const landing = add(k, at, lr, 'room', 'office-stair', CEIL.stair, north.id,
    {label: `Stairwell · ${floor === 1 ? 'Lobby' : `Floor ${floor}`}`, publicSpace: false, purpose: 'office-stair', role: 'landing'});
  meta.set(landing.id, {role: 'landing', facade: []});
  // Doorway in the core's north wall; the pier stays on the side of the well's end wall / the shaft.
  const landingDoor = door(k, at, {x: lr.x + (end === 'W' ? 1 : 0), y: f.cy0 - 1, w: 3, h: 1}, north, landing, CEIL.door);
  const closets: Area[] = [];
  let wcM: Area | null = null, wcW: Area | null = null;
  const h = f.cy1 - f.sy0;
  for (const u of f.units) {
    const r: Rect = {x: u.x0, y: f.sy0, w: u.x1 - u.x0, h};
    if (u.kind === 'wc-m' || u.kind === 'wc-w') {
      const a = add(k, at, r, 'room', 'washroom', CEIL.core, south.id, {label: u.kind === 'wc-m' ? "Men's washroom" : "Women's washroom", publicSpace: true});
      meta.set(a.id, {role: 'wc', facade: []});
      door(k, at, {x: u.x0 + 2, y: f.cy1, w: 3, h: 1}, south, a, CEIL.door);
      if (u.kind === 'wc-m') wcM = a; else wcW = a;
      continue;
    }
    const spec = u.kind === 'janitor' ? {type: 'janitor-closet' as const, label: 'Janitor closet', purpose: 'janitor-closet'}
      : u.kind === 'supply' ? {type: 'supply-closet' as const, label: 'Supply closet', purpose: 'supply-closet'}
      : {type: 'supply-closet' as const, label: 'Electrical riser', purpose: 'electrical-closet'};
    const a = add(k, at, r, 'closet', spec.type, CEIL.core, south.id, {label: spec.label, purpose: spec.purpose});
    meta.set(a.id, {role: 'closet', facade: []});
    door(k, at, {x: u.x0 + 1, y: f.cy1, w: 2, h: 1}, south, a, CEIL.door, {staff: false});
    closets.push(a);
  }
  return {landing, landingDoor, wcM: wcM!, wcW: wcW!, closets};
}

// ---------------------------------------------------------------------------------------------
// Scissor stair runs

export interface ScissorRun {
  lower: number; upper: number; lane: 'A' | 'B';
  area: Area;
  /** Flights of the run (canvas coordinates until the crop; indices into kit.flights). */
  flights: number[];
}

/**
 * The scissor stair: for every storey L = 1..7 one straight run L → L+1 in lane A (odd L) or lane B (even L), carved into BOTH
 * storey grids (layStairRun, 24 risers of 4.4/24 m), rising from storey L's landing end toward storey L+1's landing end.
 * `bases[n]` = absolute floor of storey n; `landings[n]` = storey n's landing area (the run's parent).
 */
export function carveScissor(k: Kit, f: TowerFrame, ox: number, oy: number, bases: readonly number[], landings: readonly Area[]): ScissorRun[] {
  const out: ScissorRun[] = [];
  for (let L = 1; L < bases.length - 1; L++) {
    const lane = laneOf(L), rows = lane === 'A' ? f.laneA : f.laneB;
    const rect: Rect = {x: ox + f.rx0, y: oy + rows.y, w: WELL.run, h: rows.h};
    const from = landingEnd(f, L) === 'W' ? 'lo' : 'hi';
    const area = k.addArea(rect, 'room', 'stair-core', r2(bases[L] + SCISSOR_STAIR.headroom), landings[L].id,
      {level: L, floorY: bases[L], also: [L + 1], role: 'stair', publicSpace: false, label: `Stairs · ${storeyLabel(L)} – ${storeyLabel(L + 1)}`});
    const fl: StairFlight[] = layStairRun([k.grid(L), k.grid(L + 1)], rect, area.id, 'x', from, bases[L], bases[L + 1], SCISSOR_STAIR);
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; ids.push(q.id); k.flights.push(q); }
    out.push({lower: L, upper: L + 1, lane, area, flights: ids});
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Office floors

type SegType = 'open' | 'run' | 'meeting' | 'break' | 'copy' | 'storage' | 'server' | 'exec' | 'collapsed';
interface Seg { type: SegType; w: number; n?: number; ow?: number }

const SEG_W: Record<Exclude<SegType, 'open' | 'run' | 'collapsed'>, [number, number]> = {
  meeting: [10, 14], break: [10, 13], copy: [7, 9], storage: [6, 8], server: [7, 9], exec: [13, 17],
};

/** Seeded segment list filling a band of length L (cells, 1-cell walls between segments). */
function fillBand(rng: Rng, L: number, template: SegType[]): Seg[] {
  const segs: Seg[] = template.map(type => {
    if (type === 'open' || type === 'collapsed') return {type, w: 0};
    if (type === 'run') { const n = rng.int(2, 4), ow = rng.int(7, 8); return {type, w: n * ow + n - 1, n, ow}; }
    const [a, b] = SEG_W[type];
    return {type, w: rng.int(a, b)};
  });
  const flex = segs.filter(s => s.type === 'open' || s.type === 'collapsed');
  const fixed = () => segs.reduce((s, q) => s + (flex.includes(q) ? 0 : q.w), 0) + segs.length - 1;
  // Shrink office runs until every open area gets at least 16 cells.
  for (let guard = 0; guard < 12 && L - fixed() < flex.length * 16; guard++) {
    const run = segs.find(s => s.type === 'run' && (s.n ?? 0) > 2) ?? segs.find(s => s.type !== 'open' && s.type !== 'collapsed' && s.type !== 'run' && s.w > (SEG_W[s.type as keyof typeof SEG_W]?.[0] ?? 6));
    if (!run) break;
    if (run.type === 'run') { run.n!--; run.w = run.n! * run.ow! + run.n! - 1; } else run.w--;
  }
  let rest = L - fixed();
  if (!flex.length) {
    // No open area: the last segment absorbs the remainder (runs grow their offices).
    const last = segs[segs.length - 1];
    last.w += rest;
    return segs;
  }
  for (let i = 0; i < flex.length; i++) {
    const share = i === flex.length - 1 ? rest : Math.round(rest / (flex.length - i) * rng.range(0.85, 1.15));
    flex[i].w = share;
    rest -= share;
  }
  return segs;
}

const BAND_TEMPLATES: SegType[][] = [
  ['run', 'open', 'meeting'], ['meeting', 'open', 'run'], ['open', 'run', 'open'], ['run', 'open', 'copy', 'run'],
  ['open', 'meeting', 'open'], ['run', 'storage', 'open'], ['open', 'run'], ['run', 'open'],
];

const ROOM_INFO: Record<Exclude<SegType, 'open' | 'run' | 'collapsed'>, {purpose: string; label: string; role: OfficeAreaMeta['role']}> = {
  meeting: {purpose: 'office-meeting', label: 'Meeting room', role: 'meeting'},
  break: {purpose: 'office-break', label: 'Break room', role: 'break'},
  copy: {purpose: 'office-copy', label: 'Copy & mail room', role: 'copy'},
  storage: {purpose: 'office-storage', label: 'Supply storage', role: 'storage'},
  server: {purpose: 'office-server', label: 'Server room', role: 'server'},
  exec: {purpose: 'office-exec', label: 'Executive office', role: 'exec'},
};

/**
 * One office floor: corridors (N = elevator lobby, S, W, E), the core, both end zones and both bands, by a seeded program.
 * Returns the carved tower storey (areas + their dressing meta).
 */
export function carveOfficeFloor(k: Kit, f: TowerFrame, at: TowerAt, floor: number, top: boolean, rng: Rng): CarvedTower {
  // TENANTS: a company floor is carved by its program (the generic program below stays for floors without a tenant).
  const tenant = tenantOf(f.levelSeed, floor);
  if (tenant) return carveTenantFloor(k, f, at, floor, top, rng, tenant);
  const meta = new Map<number, OfficeAreaMeta>();
  const {TW, TD, K, nB, sB, eW, eE, cy0, cy1, cx0, cx1} = f;
  const corr = (r: Rect, label: string, parent: number) => {
    const a = add(k, at, r, 'passage', 'office-corridor', CEIL.corridor, parent, {label, publicSpace: false, purpose: 'office-corridor'});
    meta.set(a.id, {role: 'corridor', facade: r.x === 0 ? (r.x + r.w === TW ? ['W', 'E'] : ['W']) : r.x + r.w === TW ? ['E'] : []});
    return a;
  };
  const N = corr({x: 0, y: nB + 1, w: TW, h: K}, 'Elevator lobby', -1);
  const S = corr({x: 0, y: cy1 + 1, w: TW, h: K}, 'Corridor', N.id);
  const Wc = corr({x: cx0 - 1 - K, y: cy0 - 1, w: K, h: cy1 - cy0 + 2}, 'Corridor', N.id);
  const Ec = corr({x: cx1 + 1, y: cy0 - 1, w: K, h: cy1 - cy0 + 2}, 'Corridor', N.id);
  const core = carveCore(k, f, at, floor, N, S, meta);

  // --- End zones (rooms between the corridors at both ends) --------------------------------------
  const endTypes: SegType[] = top ? rng.shuffle(['break', 'server'] as SegType[]) : rng.shuffle([rng.chance(0.6) ? 'break' : 'meeting', rng.pick(['server', 'copy', 'storage', 'server'])] as SegType[]);
  const ends: [Rect, Area, 'W' | 'E'][] = [[{x: 0, y: cy0, w: eW, h: cy1 - cy0}, Wc, 'W'], [{x: TW - eE, y: cy0, w: eE, h: cy1 - cy0}, Ec, 'E']];
  ends.forEach(([r, side, face], i) => {
    const t = endTypes[i] as keyof typeof ROOM_INFO;
    const info = ROOM_INFO[t];
    const a = add(k, at, r, 'room', 'office-room', CEIL.office, side.id, {label: info.label, publicSpace: false, purpose: info.purpose});
    meta.set(a.id, {role: info.role, facade: [face]});
    // Door onto the side corridor (or the N / S corridor when that wall is busier).
    const host = rng.chance(0.65) ? side : rng.chance(0.5) ? N : S;
    if (!k.connect(a, host, 3, CEIL.door, {arch: false, margin: 2})) k.connect(a, side, 3, CEIL.door, {arch: false, margin: 1});
  });

  // --- Bands --------------------------------------------------------------------------------------
  const programs = (): [SegType[], SegType[]] => {
    if (top) return [rng.chance(0.5) ? ['exec', 'run', 'exec'] : ['exec', 'meeting', 'exec'], rng.chance(0.5) ? ['collapsed', 'run', 'copy'] : ['run', 'collapsed']];
    for (let t = 0; t < 20; t++) {
      const a = rng.pick(BAND_TEMPLATES), b = rng.pick(BAND_TEMPLATES);
      const all = [...a, ...b];
      if (all.includes('open') && all.includes('run') && (all.includes('meeting') || endTypes.includes('meeting'))) return rng.chance(0.5) ? [a, b] : [b, a];
    }
    return [['run', 'open', 'meeting'], ['open', 'run']];
  };
  const [nt, st] = programs();
  carveBand(k, f, at, rng, meta, {x: 0, y: 0, w: TW, h: nB}, 'N', N, nt);
  carveBand(k, f, at, rng, meta, {x: 0, y: TD - sB, w: TW, h: sB}, 'S', S, st);
  return {at, floor, core, meta, north: N, south: S};
}

/** Carves one band's segments; `face` = the facade side ('N' band: facade north, corridor south). */
function carveBand(k: Kit, f: TowerFrame, at: TowerAt, rng: Rng, meta: Map<number, OfficeAreaMeta>, band: Rect, face: 'N' | 'S', corridor: Area, template: SegType[]): void {
  const segs = fillBand(rng, band.w, template);
  // Adjacent open areas merge (no wall between them).
  const merged: Seg[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.type === 'open' && s.type === 'open') last.w += s.w + 1; else merged.push({...s});
  }
  const facadeOf = (x0: number, x1: number): OfficeAreaMeta['facade'] => [face, ...(x0 === 0 ? ['W' as const] : []), ...(x1 === f.TW ? ['E' as const] : [])];
  let x = band.x;
  for (const s of merged) {
    const x0 = x, x1 = x + s.w;
    x = x1 + 1;
    if (s.w < 3) continue;
    if (s.type === 'open' || s.type === 'collapsed') {
      const a = add(k, at, {x: x0, y: band.y, w: s.w, h: band.h}, 'room', 'office-open', CEIL.office, corridor.id,
        {label: s.type === 'collapsed' ? 'Collapsed office' : 'Open-plan office', publicSpace: false, purpose: 'office-open'});
      meta.set(a.id, {role: s.type === 'collapsed' ? 'collapsed' : 'open', facade: facadeOf(x0, x1)});
      openings(k, at, a, corridor, face, x0, x1);
      continue;
    }
    if (s.type === 'run') {
      // Private offices along the facade, an admin bay (filing, assistants' desks) between them and the corridor.
      const dO = Math.min(band.h - 5, rng.int(9, 10));
      const offY = face === 'N' ? band.y : band.y + band.h - dO;
      const bayY = face === 'N' ? band.y + dO + 1 : band.y;
      const bayH = band.h - dO - 1;
      const bay = add(k, at, {x: x0, y: bayY, w: s.w, h: bayH}, 'room', 'office-open', CEIL.office, corridor.id, {label: 'Admin bay', publicSpace: false, purpose: 'office-open'});
      meta.set(bay.id, {role: 'bay', facade: facadeOf(x0, x1).filter(q => q !== face)});
      openings(k, at, bay, corridor, face, x0, x1, 1);
      const n = s.n ?? 2;
      const ow = Math.floor((s.w - (n - 1)) / n);
      let ox = x0;
      for (let i = 0; i < n; i++) {
        const w = i === n - 1 ? x1 - ox : ow;
        const o = add(k, at, {x: ox, y: offY, w, h: dO}, 'room', 'office-room', CEIL.office, bay.id, {label: 'Private office', publicSpace: false, purpose: 'office-private'});
        meta.set(o.id, {role: 'private', facade: facadeOf(ox, ox + w)});
        k.connect(o, bay, 2, CEIL.door, {arch: false, margin: 1});
        ox += w + 1;
      }
      continue;
    }
    const info = ROOM_INFO[s.type];
    const a = add(k, at, {x: x0, y: band.y, w: s.w, h: band.h}, 'room', 'office-room', CEIL.office, corridor.id, {label: info.label, publicSpace: false, purpose: info.purpose});
    meta.set(a.id, {role: info.role, facade: facadeOf(x0, x1)});
    k.connect(a, corridor, s.type === 'exec' || s.type === 'meeting' ? 4 : 3, CEIL.door, {arch: false, margin: 2});
  }
}

/** Wide openings (no door leaf) from an open area into the corridor: one per ~12 m of shared wall. */
function openings(k: Kit, at: TowerAt, a: Area, corridor: Area, face: 'N' | 'S', x0: number, x1: number, max = 3): void {
  const w = x1 - x0;
  const n = Math.max(1, Math.min(max, Math.round(w / 24)));
  const row = face === 'N' ? a.y + a.h - at.oy : a.y - 1 - at.oy;
  for (let i = 0; i < n; i++) {
    const width = Math.min(6, Math.max(3, Math.floor(w / (n * 3))));
    const c = x0 + Math.round(w * (i + 0.5) / n) - Math.floor(width / 2);
    const gx = Math.max(x0 + 1, Math.min(x1 - 1 - width, c));
    k.carveDoor({x: at.ox + gx, y: at.oy + row, w: width, h: 1}, a, corridor, CEIL.wide, false);
  }
}

// ---------------------------------------------------------------------------------------------
// Task office-overhaul-20261030 (lane TENANTS): company floors

/** Smallest open-plan area (cells along the band). */
const OPEN_MIN = 16;
/** Sub-bands narrower than this beside a reception are absorbed by it (cells). */
const SIDE_MIN = 12;

type TSegType = 'open' | 'run' | 'collapsed' | RoomKey;
interface TSeg { type: TSegType; w: number; n?: number; style?: OpenStyle }
interface Item { key: RoomKey | 'run'; min: number; max: number; prio: number }

/**
 * A company floor: the shared corridors + core, both end zones from the program, the reception off the elevator lobby (the
 * company's first floor: centred on the elevator door in the N band, one wide opening on the door axis), then the program's
 * themed rooms / office runs / executive suite packed into the remaining band lengths around its open-plan areas.
 */
function carveTenantFloor(k: Kit, f: TowerFrame, at: TowerAt, floor: number, top: boolean, rng: Rng, t: TenantFloor): CarvedTower {
  const c = COMPANIES[t.company], P = c.program, part = t.part > 0 ? 1 : 0;
  const meta = new Map<number, OfficeAreaMeta>();
  const {TW, TD, K, nB, sB, eW, eE, cy0, cy1, cx0, cx1} = f;
  const corr = (r: Rect, label: string, parent: number) => {
    const a = add(k, at, r, 'passage', 'office-corridor', CEIL.corridor, parent, {label, publicSpace: false, purpose: 'office-corridor'});
    meta.set(a.id, {role: 'corridor', facade: r.x === 0 ? (r.x + r.w === TW ? ['W', 'E'] : ['W']) : r.x + r.w === TW ? ['E'] : []});
    return a;
  };
  const N = corr({x: 0, y: nB + 1, w: TW, h: K}, 'Elevator lobby', -1);
  const S = corr({x: 0, y: cy1 + 1, w: TW, h: K}, 'Corridor', N.id);
  const Wc = corr({x: cx0 - 1 - K, y: cy0 - 1, w: K, h: cy1 - cy0 + 2}, 'Corridor', N.id);
  const Ec = corr({x: cx1 + 1, y: cy0 - 1, w: K, h: cy1 - cy0 + 2}, 'Corridor', N.id);
  const core = carveCore(k, f, at, floor, N, S, meta);

  // --- End zones -------------------------------------------------------------------------------
  const endKeys: RoomKey[] = rng.shuffle([...P.ends[part]]);
  if (top && !endKeys.includes('server')) endKeys[rng.int(0, 1)] = 'server';
  const ends: [Rect, Area, 'W' | 'E'][] = [[{x: 0, y: cy0, w: eW, h: cy1 - cy0}, Wc, 'W'], [{x: TW - eE, y: cy0, w: eE, h: cy1 - cy0}, Ec, 'E']];
  ends.forEach(([r, side, face], i) => {
    const key = endKeys[i], info: {label: string; purpose: string; role: OfficeAreaMeta['role']; open?: boolean} = ROOMS[key];
    const a = add(k, at, r, 'room', 'office-room', CEIL.office, side.id, {label: roomLabel(c, key), publicSpace: false, purpose: info.purpose});
    meta.set(a.id, {role: info.role, facade: [face], program: key});
    const host = rng.chance(0.65) ? side : rng.chance(0.5) ? N : S;
    const w = info.open ? 4 : 3;
    if (!k.connect(a, host, w, CEIL.door, {arch: false, margin: 2})) k.connect(a, side, 3, CEIL.door, {arch: false, margin: 1});
  });

  // --- Band items: themed rooms first, the executive suite, office runs, base rooms last ---------
  const rooms: RoomKey[] = [...P.rooms[part]];
  if ((P.exec && t.part === t.parts - 1) || top) { if (!rooms.includes('exec')) rooms.push('exec'); }
  const items: Item[] = rooms.map((key, i) => {
    const w = ROOMS[key].w;
    const prio = key === 'exec' ? (top ? 95 : 80) : BASE_ROOMS.has(key) ? 40 - i : 100 - i;
    return {key, min: w[0], max: w[1], prio};
  });
  for (let r = 0; r < P.runs; r++) items.push({key: 'run', min: 15, max: 35, prio: 60 - r});

  // --- Bands (the reception splits the N band on its first floor) -------------------------------
  const bands: {rect: Rect; face: 'N' | 'S'; corridor: Area}[] = [];
  if (t.part === 0) {
    const {x0, x1} = carveReception(k, f, at, meta, N, c, rng);
    if (x0 > 1) bands.push({rect: {x: 0, y: 0, w: x0 - 1, h: nB}, face: 'N', corridor: N});
    if (x1 < TW - 1) bands.push({rect: {x: x1 + 1, y: 0, w: TW - x1 - 1, h: nB}, face: 'N', corridor: N});
  } else bands.push({rect: {x: 0, y: 0, w: TW, h: nB}, face: 'N', corridor: N});
  bands.push({rect: {x: 0, y: TD - sB, w: TW, h: sB}, face: 'S', corridor: S});
  const plans = packBands(rng, bands.map(b => b.rect.w), items, P.open, top && rng.chance(0.5));
  bands.forEach((b, i) => carveTenantBand(k, f, at, rng, meta, b.rect, b.face, b.corridor, plans[i], c));
  for (const id of meta.keys()) k.areas[id].tenant = t.company;
  return {at, floor, core, meta, north: N, south: S, tenant: t};
}

/** The company reception: N band, centred on the elevator door (absorbing a narrow remainder on either side), one wide opening. */
function carveReception(k: Kit, f: TowerFrame, at: TowerAt, meta: Map<number, OfficeAreaMeta>, N: Area, c: Company, rng: Rng): {x0: number; x1: number} {
  const {TW, nB} = f;
  const dc = f.door.x + f.door.w / 2;
  const W = rng.int(ROOMS.reception.w[0], ROOMS.reception.w[1]);
  let x0 = Math.max(0, Math.min(TW - W, Math.round(dc - W / 2)));
  let x1 = x0 + W;
  if (x0 - 1 < SIDE_MIN) x0 = 0;
  if (TW - x1 - 1 < SIDE_MIN) x1 = TW;
  const a = add(k, at, {x: x0, y: 0, w: x1 - x0, h: nB}, 'room', 'office-room', CEIL.office, N.id, {label: roomLabel(c, 'reception'), publicSpace: false, purpose: ROOMS.reception.purpose});
  meta.set(a.id, {role: 'reception', facade: ['N', ...(x0 === 0 ? ['W' as const] : []), ...(x1 === TW ? ['E' as const] : [])], program: 'reception'});
  const ow = 6, gx = Math.max(x0 + 1, Math.min(x1 - 1 - ow, Math.round(dc - ow / 2)));
  k.carveDoor({x: at.ox + gx, y: at.oy + nB, w: ow, h: 1}, a, N, CEIL.wide, false);
  return {x0, x1};
}

/**
 * Packs the program's items into the band lengths (cells, 1-cell walls): the longest band gets the floor's main open-plan area,
 * items go by priority to the band with the most room at their minimum width (an item that fits nowhere is dropped — base rooms
 * and runs first), a band with room to spare gets a second open area (the top floor's may be the collapsed office), an empty
 * narrow band becomes a meeting room / copy room. Widths: seeded within each item's range, shrunk until the open areas get
 * OPEN_MIN, the remainder to the open areas (else the rooms widen). Returns each band's segments in order.
 */
function packBands(rng: Rng, lens: readonly number[], items: readonly Item[], styles: readonly [OpenStyle, OpenStyle], collapsed: boolean): TSeg[][] {
  const plans = lens.map(L => ({L, items: [] as Item[], opens: [] as (OpenStyle | 'collapsed')[]}));
  const main = lens.indexOf(Math.max(...lens));
  plans[main].opens.push(styles[0]);
  const used = (p: (typeof plans)[number]) => p.items.reduce((s, q) => s + q.min, 0) + p.opens.length * OPEN_MIN + Math.max(0, p.items.length + p.opens.length - 1);
  const segsOf = (p: (typeof plans)[number]) => p.items.length + p.opens.length;
  for (const it of [...items].sort((a, b) => b.prio - a.prio)) {
    let best: (typeof plans)[number] | null = null, room = -1;
    for (const p of plans) {
      const free = p.L - used(p) - (segsOf(p) ? 1 : 0) - it.min;
      if (free >= 0 && free > room) { best = p; room = free; }
    }
    if (best) best.items.push(it);
  }
  let second = false;
  for (const p of plans) {
    const free = p.L - used(p) - (segsOf(p) ? 1 : 0);
    if (!segsOf(p)) {
      if (p.L >= 26) p.opens.push(styles[1]);
      else p.items.push(p.L >= 10 ? {key: 'meeting', min: 10, max: p.L, prio: 0} : p.L >= 7 ? {key: 'copy', min: 7, max: p.L, prio: 0} : {key: 'storage', min: Math.min(6, p.L), max: p.L, prio: 0});
      continue;
    }
    if (!p.opens.length && free >= OPEN_MIN + 6) { p.opens.push(collapsed && !second ? 'collapsed' : styles[1]); second = true; }
  }
  if (collapsed && !second) {
    // The top floor's collapsed office replaces the main open area's style when no band had room for a second one.
    const p = plans[main];
    if (p.items.length) p.opens[0] = 'collapsed';
  }
  return plans.map(p => bandSegs(rng, p.L, p.items, p.opens));
}

function bandSegs(rng: Rng, L: number, items: readonly Item[], opens: readonly (OpenStyle | 'collapsed')[]): TSeg[] {
  const segs: TSeg[] = items.map(it => ({type: it.key, w: rng.int(it.min, Math.max(it.min, it.max))}));
  const mins = new Map(segs.map((s, i) => [s, items[i].min]));
  const walls = segs.length + opens.length - 1;
  const fixed = () => segs.reduce((s, q) => s + q.w, 0) + walls;
  for (let guard = 0; guard < 400 && L - fixed() < opens.length * OPEN_MIN; guard++) {
    let q: TSeg | null = null;
    for (const s of segs) if (s.w > mins.get(s)! && (!q || s.w > q.w)) q = s;
    if (!q) break;
    q.w--;
  }
  let rest = L - fixed();
  if (!opens.length && segs.length) {
    // No open area: the rooms widen (runs keep their office count; other rooms first).
    const pool = segs.some(s => s.type !== 'run') ? segs.filter(s => s.type !== 'run') : segs;
    for (let i = 0; rest > 0; i++, rest--) pool[i % pool.length].w++;
    for (let i = 0; rest < 0 && i < 400; i++) { const s = segs[i % segs.length]; if (s.w > 3) { s.w--; rest++; } }
  }
  for (const s of segs) if (s.type === 'run') s.n = Math.max(2, Math.min(4, Math.floor((s.w + 1) / 8)));
  const order = rng.shuffle(segs.slice());
  const os: TSeg[] = opens.map(o => (o === 'collapsed' ? {type: 'collapsed', w: 0} : {type: 'open', w: 0, style: o}));
  for (let i = 0; i < os.length; i++) {
    const share = i === os.length - 1 ? rest : Math.round(rest / (os.length - i) * rng.range(0.85, 1.15));
    os[i].w = share;
    rest -= share;
  }
  if (!os.length) return order;
  if (os.length === 1) {
    const mid = order.length <= 1 ? rng.int(0, order.length) : Math.max(1, Math.min(order.length - 1, Math.round(order.length / 2)));
    return [...order.slice(0, mid), os[0], ...order.slice(mid)];
  }
  // Two open areas: rooms between them (never adjacent), the rest on the outside.
  const a = Math.floor(order.length / 3), b = Math.max(a + 1, Math.floor(order.length * 2 / 3));
  return [...order.slice(0, a), os[0], ...order.slice(a, b), os[1], ...order.slice(b)];
}

/** Carves one band's company segments (as carveBand, with the company's room labels / purposes / programs). */
function carveTenantBand(k: Kit, f: TowerFrame, at: TowerAt, rng: Rng, meta: Map<number, OfficeAreaMeta>, band: Rect, face: 'N' | 'S', corridor: Area, segs: TSeg[], c: Company): void {
  const facadeOf = (x0: number, x1: number): OfficeAreaMeta['facade'] => [face, ...(x0 === 0 ? ['W' as const] : []), ...(x1 === f.TW ? ['E' as const] : [])];
  let x = band.x;
  for (const s of segs) {
    const x0 = x, x1 = x + s.w;
    x = x1 + 1;
    if (s.w < 3) continue;
    if (s.type === 'open' || s.type === 'collapsed') {
      const style = s.type === 'open' ? s.style ?? 'cubicles' : undefined;
      const a = add(k, at, {x: x0, y: band.y, w: s.w, h: band.h}, 'room', 'office-open', CEIL.office, corridor.id,
        {label: style ? roomLabel(c, style) : 'Collapsed office', publicSpace: false, purpose: style ? OPEN_STYLES[style].purpose : 'office-open'});
      meta.set(a.id, style ? {role: 'open', facade: facadeOf(x0, x1), program: style} : {role: 'collapsed', facade: facadeOf(x0, x1)});
      openings(k, at, a, corridor, face, x0, x1);
      continue;
    }
    if (s.type === 'run') {
      const run = RUNS[c.program.run];
      const dO = Math.min(band.h - 5, rng.int(9, 10));
      const offY = face === 'N' ? band.y : band.y + band.h - dO;
      const bayY = face === 'N' ? band.y + dO + 1 : band.y;
      const bayH = band.h - dO - 1;
      const bay = add(k, at, {x: x0, y: bayY, w: s.w, h: bayH}, 'room', 'office-open', CEIL.office, corridor.id, {label: run.bay, publicSpace: false, purpose: 'office-open'});
      meta.set(bay.id, {role: 'bay', facade: facadeOf(x0, x1).filter(q => q !== face)});
      openings(k, at, bay, corridor, face, x0, x1, 1);
      const n = s.n ?? 2;
      const ow = Math.floor((s.w - (n - 1)) / n);
      let ox = x0;
      for (let i = 0; i < n; i++) {
        const w = i === n - 1 ? x1 - ox : ow;
        const o = add(k, at, {x: ox, y: offY, w, h: dO}, 'room', 'office-room', CEIL.office, bay.id, {label: run.label, publicSpace: false, purpose: run.purpose});
        meta.set(o.id, {role: 'private', facade: facadeOf(ox, ox + w), program: c.program.run});
        k.connect(o, bay, 2, CEIL.door, {arch: false, margin: 1});
        ox += w + 1;
      }
      continue;
    }
    const info: {purpose: string; role: OfficeAreaMeta['role']; open?: boolean} = ROOMS[s.type];
    const a = add(k, at, {x: x0, y: band.y, w: s.w, h: band.h}, 'room', 'office-room', CEIL.office, corridor.id, {label: roomLabel(c, s.type), publicSpace: false, purpose: info.purpose});
    meta.set(a.id, {role: info.role, facade: facadeOf(x0, x1), program: s.type});
    if (info.open) openings(k, at, a, corridor, face, x0, x1, 2);
    else k.connect(a, corridor, s.type === 'exec' || s.type === 'meeting' || s.w >= 14 ? 4 : 3, CEIL.door, {arch: false, margin: 2});
  }
}

