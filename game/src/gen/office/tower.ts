// Seamless Office Space (lane GEN): carving the office tower into the generator canvas (gen/stationKit.ts Kit, one level grid
// per storey) — the core shared by the lobby and every office floor (scissor stair landing, washrooms, closets; the elevator
// shaft stays SOLID), the corridor rings, the seeded room program of an office floor, and the scissor stair runs that join
// consecutive storeys. Pure data.
//
// Everything is carved at a canvas offset (ox, oy) = canvas cell of tower-local (0, 0), on the storey's level grid (`level`,
// absolute floor `base`): the lobby is level 1 at the lobby height, office floor n is level n at lobby + 4.4 (n - 1). The level
// crop later puts tower-local (0, 0) at grid cell (MARGIN, MARGIN) on every storey.

import type {Rng} from '../../core/rng';
import {Kit, type AreaOpts} from '../stationKit';
import {layStairRun, type StairFlight} from '../traversal';
import type {Area, AreaKind, Door, Rect, RoomType} from '../stationTypes';
import {CEIL, SCISSOR_STAIR, WELL, landingEnd, landingRect, laneOf, type TowerFrame} from './frame';

export interface TowerAt { ox: number; oy: number; level: number; base: number }

/** What the office dresser needs to know about a carved area. */
export interface OfficeAreaMeta {
  /** Program role (signage / dressing / spawns). */
  role: 'open' | 'bay' | 'private' | 'exec' | 'meeting' | 'break' | 'copy' | 'storage' | 'server' | 'corridor' | 'lobby' | 'reception'
    | 'security' | 'transit' | 'wc' | 'closet' | 'landing' | 'collapsed';
  /** Facade sides of the area (perimeter walls = window walls). */
  facade: ('N' | 'S' | 'E' | 'W')[];
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
