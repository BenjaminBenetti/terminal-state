// Iteration 16 (WORLD-GEN): carving the office tower into the generator canvas (gen/stationKit.ts Kit) — the core shared by
// the lobby and every office floor, the corridor rings and the seeded room program of an office floor. Pure data.
//
// Everything is carved at a canvas offset (ox, oy) = canvas cell of tower-local (0, 0), on one level grid (`level`, floor `base`):
// the lobby is the street section's upper storey (level 1 at the lobby height), an office floor is a single main storey (level 0
// at y 0). The section's crop later puts tower-local (0, 0) at grid cell (MARGIN, MARGIN) in both cases.

import type {Rng} from '../../core/rng';
import {Kit, type AreaOpts} from '../stationKit';
import type {Area, AreaKind, Door, Rect, RoomType} from '../stationTypes';
import {CEIL, type TowerFrame} from './frame';

export interface TowerAt { ox: number; oy: number; level: number; base: number }

/** What the office dresser needs to know about a carved area. */
export interface OfficeAreaMeta {
  /** Program role (signage / dressing / spawns). */
  role: 'open' | 'bay' | 'private' | 'exec' | 'meeting' | 'break' | 'copy' | 'storage' | 'server' | 'corridor' | 'lobby' | 'reception'
    | 'security' | 'transit' | 'wc' | 'closet' | 'cab' | 'vestibule' | 'collapsed';
  /** Facade sides of the area (perimeter walls = window walls). */
  facade: ('N' | 'S' | 'E' | 'W')[];
}

export interface CoreAreas {
  cab: Area; vest: Area; wcM: Area; wcW: Area; janitor: Area; closets: Area[];
  /** Elevator door (cab -> north host) and vestibule door records. */
  cabDoor: Door; vestDoor: Door;
}

export interface CarvedTower {
  at: TowerAt;
  core: CoreAreas;
  meta: Map<number, OfficeAreaMeta>;
  /** Areas north / south of the core the core doors open onto (N corridor / lobby hall, S corridor / transit hall). */
  north: Area; south: Area;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

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
 * The core: stairwell vestibule (door onto the north host; stair door on its back wall) with a riser closet behind it, the
 * elevator cab (north end of its unit, 3-cell door onto the north host; the rest of the unit is the solid shaft), men's and
 * women's washrooms (doors onto the south host), the janitor closet (north) and a supply closet (south). Same cells on every floor.
 */
export function carveCore(k: Kit, f: TowerFrame, at: TowerAt, north: Area, south: Area, meta: Map<number, OfficeAreaMeta>): CoreAreas {
  const {cy0, cy1} = f;
  const CH = cy1 - cy0;
  const unit = (kind: string) => f.units.find(u => u.kind === kind)!;
  const st = unit('stair'), el = unit('elevator'), wm = unit('wc-m'), ww = unit('wc-w'), cl = unit('closet');
  const closets: Area[] = [];
  // Stairwell vestibule + riser closet behind it.
  const vest = add(k, at, {x: f.vest.x, y: f.vest.y, w: f.vest.w, h: f.vest.h}, 'room', 'office-stair', CEIL.stair, north.id, {label: 'Stairwell', publicSpace: false, purpose: 'office-stair'});
  meta.set(vest.id, {role: 'vestibule', facade: []});
  const vestDoor = door(k, at, {x: st.x0 + 2, y: cy0 - 1, w: 3, h: 1}, north, vest, CEIL.door);
  const riserY = f.vest.y + f.vest.h + 1;
  if (cy1 - riserY >= 3) {
    const riser = add(k, at, {x: st.x0, y: riserY, w: st.x1 - st.x0, h: cy1 - riserY}, 'closet', 'supply-closet', CEIL.core, south.id, {label: 'Electrical riser', purpose: 'electrical-closet'});
    meta.set(riser.id, {role: 'closet', facade: []});
    door(k, at, {x: st.x0 + 2, y: cy1, w: 2, h: 1}, south, riser, CEIL.door, {staff: false});
    closets.push(riser);
  }
  // Elevator cab: its unit's north end; the shaft below it stays solid.
  const cab = add(k, at, {x: f.cab.x, y: f.cab.y, w: f.cab.w, h: f.cab.h}, 'room', 'office-elevator', CEIL.cab, north.id, {label: 'Elevator', publicSpace: false, purpose: 'office-elevator'});
  meta.set(cab.id, {role: 'cab', facade: []});
  const cabDoor = door(k, at, {x: el.x0 + 1, y: cy0 - 1, w: 3, h: 1}, cab, north, CEIL.door);
  // Washrooms (full core depth), doors onto the south host.
  const wcM = add(k, at, {x: wm.x0, y: cy0, w: wm.x1 - wm.x0, h: CH}, 'room', 'washroom', CEIL.core, south.id, {label: "Men's washroom", publicSpace: true});
  const wcW = add(k, at, {x: ww.x0, y: cy0, w: ww.x1 - ww.x0, h: CH}, 'room', 'washroom', CEIL.core, south.id, {label: "Women's washroom", publicSpace: true});
  for (const [a, u] of [[wcM, wm], [wcW, ww]] as const) {
    meta.set(a.id, {role: 'wc', facade: []});
    door(k, at, {x: u.x0 + 2, y: cy1, w: 3, h: 1}, south, a, CEIL.door);
  }
  // Closet unit: janitor closet (north door) + supply closet (south door).
  const jh = Math.floor((CH - 1) / 2);
  const janitor = add(k, at, {x: cl.x0, y: cy0, w: cl.x1 - cl.x0, h: jh}, 'closet', 'janitor-closet', CEIL.core, north.id, {label: 'Janitor closet', purpose: 'janitor-closet'});
  meta.set(janitor.id, {role: 'closet', facade: []});
  door(k, at, {x: cl.x0 + 1, y: cy0 - 1, w: 2, h: 1}, north, janitor, CEIL.door, {staff: false});
  const sup = add(k, at, {x: cl.x0, y: cy0 + jh + 1, w: cl.x1 - cl.x0, h: CH - jh - 1}, 'closet', 'supply-closet', CEIL.core, south.id, {label: 'Supply closet', purpose: 'supply-closet'});
  meta.set(sup.id, {role: 'closet', facade: []});
  door(k, at, {x: cl.x0 + 1, y: cy1, w: 2, h: 1}, south, sup, CEIL.door, {staff: false});
  closets.push(janitor, sup);
  return {cab, vest, wcM, wcW, janitor, closets, cabDoor, vestDoor};
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
 * Returns the carved tower (areas + their dressing meta).
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
  const core = carveCore(k, f, at, N, S, meta);

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
  void floor;
  return {at, core, meta, north: N, south: S};
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
