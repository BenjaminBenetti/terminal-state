// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): what every planned interior gets after its rooms are carved and
// dressed — FACADE WINDOW SPANS of the rooms behind the facade (gen/surface/surfaceTypes.ts SurfaceWindowSpan; pane states from the
// building's condition: intact buildings stay sealed, damaged ones now and then have a broken pane, gutted ones many), the fixture-less
// VIRTUAL DAYLIGHT behind them (the office tower's window daylight, gen/office/windows.ts addDaylight's recipe), the interior CEILING
// FIXTURES in the darker mood (mostly dim / dark / broken, gen/stationDress.ts applyLighting's state rules, decided here once — the district
// must not re-run applyLighting over them), the permanent INTERIOR ENEMIES (ordinary layout zombies on free floor, off doorways and landings),
// the LOOSE FINDS (items/lootTables.ts SURFACE_INTERIOR_FLOOR) and the entrance records with their door states. All draws come from
// named forks of the building's stream (RNG-neutral between these passes).

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {FLARE_ID, BATTERY_ID, SURFACE_INTERIOR_FLOOR} from '../../../items/lootTables';
import {DAYLIGHT_TINT} from '../../office/windows';
import type {Door, LightPlacement, Side, ZombieSpawn} from '../../stationTypes';
import type {SurfaceEntrance, SurfaceWindowSpan} from '../surfaceTypes';
import type {InteriorBuilder, RoomInfo, WindowStyle} from './builder';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
type Pane = SurfaceWindowSpan['panes'][number];

/** Window look per style: sill / head above the storey floor (m, clamped to the room's clear height), pane width (m), span limits (cells). */
export const WINDOW_STYLE: Readonly<Record<Exclude<WindowStyle, 'none'>, {sill: number; head: number; pane: number; min: number; max: number}>> = {
  shop: {sill: 0.45, head: 2.9, pane: 2.2, min: 3, max: 12},
  office: {sill: 0.85, head: 2.5, pane: 1.25, min: 2, max: 8},
  high: {sill: 2.2, head: 3.4, pane: 1.5, min: 2, max: 8},
  small: {sill: 1.6, head: 2.1, pane: 0.8, min: 2, max: 2},
};

/** Per-pane state odds by building condition (intact / cracked / broken / boarded), and the chance a damaged building has a breach. */
const PANE_ODDS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  intact: [0.86, 0.14, 0, 0], damaged: [0.62, 0.22, 0, 0.16], gutted: [0.25, 0.2, 0.35, 0.2], collapsed: [0.1, 0.1, 0.5, 0.3],
};
export const DAMAGED_BREACH = 0.45;

// ---------------------------------------------------------------------------------------------------------------------------
// Windows + daylight

export function planWindows(b: InteriorBuilder): void {
  const rng = b.rng.fork('windows');
  const rect = b.plot.rect, I = b.I;
  const cond = b.b.condition;
  const odds = PANE_ODDS[cond] ?? PANE_ODDS.intact;
  const pane = (): Pane => {
    const r = rng.next();
    return r < odds[0] ? 'intact' : r < odds[0] + odds[1] ? 'cracked' : r < odds[0] + odds[1] + odds[2] ? 'broken' : 'boarded';
  };
  for (const ri of b.rooms) {
    if (ri.windows === 'none' || ri.role === 'stair-run') continue;
    const a = ri.area, f = b.storeys[ri.storey];
    const clear = f.ceil - f.y;
    const sides: [Side, boolean][] = [['N', a.y === I.y], ['S', a.y + a.h === I.y + I.h], ['W', a.x === I.x], ['E', a.x + a.w === I.x + I.w]];
    for (const [side, on] of sides) {
      if (!on) continue;
      // shop windows only on the street storey's main facade (display glazing), the room's ordinary windows elsewhere
      const style = ri.windows === 'shop' && (side !== b.front || ri.storey > 0) ? 'office' : ri.windows;
      const st = WINDOW_STYLE[style];
      const head = Math.min(st.head, clear - 0.3), sill = Math.min(st.sill, head - 0.6);
      if (head - sill < 0.5) continue;
      const alongX = side === 'N' || side === 'S';
      const ring = side === 'N' ? rect.y : side === 'S' ? rect.y + rect.h - 1 : side === 'W' ? rect.x : rect.x + rect.w - 1;
      const c0 = (alongX ? a.x : a.y) + 1, c1 = (alongX ? a.x + a.w : a.y + a.h) - 2;
      // never in a party wall (the facade cell must face open ground) nor beside a doorway
      const blocked = (c: number) => (ri.storey === 0 && b.ents.some(en => en.e.side === side && en.e.cells.some(p => Math.abs((alongX ? p.x : p.y) - c) <= 1)))
        || !b.exposed(alongX ? c : ring, alongX ? ring : c, side);
      let s = -1;
      const runs: [number, number][] = [];
      for (let c = c0; c <= c1 + 1; c++) {
        const ok = c <= c1 && !blocked(c);
        if (ok && s < 0) s = c;
        if (!ok && s >= 0) { runs.push([s, c - 1]); s = -1; }
      }
      for (const [r0, r1] of runs) {
        // spans of at most st.max cells with one-cell piers between them
        const n = Math.ceil((r1 - r0 + 2) / (st.max + 1));
        const len = Math.floor((r1 - r0 + 1 - (n - 1)) / n);
        for (let k = 0; k < n; k++) {
          const q0 = r0 + k * (len + 1), q1 = k === n - 1 ? r1 : q0 + len - 1;
          if (q1 - q0 + 1 < st.min) continue;
          const lenM = (q1 - q0 + 1) * CELL;
          const panes: Pane[] = Array.from({length: Math.max(1, Math.round(lenM / st.pane))}, pane);
          const box = alongX ? {x0: q0 * CELL, x1: (q1 + 1) * CELL, z0: ring * CELL, z1: (ring + 1) * CELL} : {x0: ring * CELL, x1: (ring + 1) * CELL, z0: q0 * CELL, z1: (q1 + 1) * CELL};
          b.windows.push({id: `b${b.b.id}-w${b.windows.length}`, building: b.b.id, level: f.level, ...box, side, sill: r3(sill), head: r3(head), panes,
            room: a.id, ...(style === 'shop' ? {shop: true} : {})});
        }
      }
    }
  }
  // a damaged building now and then has a breach: one or two panes of one span broken (gas gets in there: lane AIR's pane rules)
  if (cond === 'damaged' && b.windows.length && rng.chance(DAMAGED_BREACH)) {
    const w = b.windows[rng.int(0, b.windows.length - 1)];
    const k = rng.int(0, w.panes.length - 1);
    w.panes[k] = 'broken';
    if (w.panes.length > 1 && rng.chance(0.4)) w.panes[(k + 1) % w.panes.length] = 'broken';
  }
  // daylight inside every span (fixture-less, steady): dimmer behind boarded panes
  for (const w of b.windows) {
    const f = b.storeys.find(s => s.level === w.level)!;
    const g = b.kit.grid(w.level);
    const alongX = w.side === 'N' || w.side === 'S';
    const len = alongX ? w.x1 - w.x0 : w.z1 - w.z0;
    const open = w.panes.reduce((s, p) => s + (p === 'boarded' ? 0.15 : 1), 0) / w.panes.length;
    if (open < 0.2) continue;
    const k = Math.max(1, Math.round(len / 2.5));
    const inward = w.side === 'N' || w.side === 'W' ? 1 : -1;
    const plane = w.side === 'N' ? w.z1 : w.side === 'S' ? w.z0 : w.side === 'W' ? w.x1 : w.x0;
    for (let i = 0; i < k; i++) {
      const t = (alongX ? w.x0 : w.z0) + len * (i + 0.5) / k;
      const x = alongX ? t : plane + inward * 0.9, z = alongX ? plane + inward * 0.9 : t;
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.area[g.idx(cx, cy)] !== w.room) continue;
      const l: LightPlacement = {x: r3(x), y: r3(Math.min(f.y + w.head - 0.12, f.ceil - 0.08)), z: r3(z), rot: alongX ? 0 : Math.PI / 2, area: w.room,
        broken: false, flicker: false, warm: false, power: r3((w.shop ? 0.36 : 0.3) * open), dying: false, virtual: true, tint: DAYLIGHT_TINT};
      if (w.level) l.level = w.level;
      b.stub.lights.push(l);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Ceiling fixtures

export function planLights(b: InteriorBuilder): void {
  const rng = b.rng.fork('lights');
  const gutted = b.b.condition === 'gutted' || b.b.condition === 'collapsed';
  for (const ri of b.rooms) {
    if (ri.role === 'stair-run' || ri.role === 'roof') continue; // (v2, lane INTERIOR: a roof is open sky — no ceiling fixtures)
    const a = ri.area, f = b.storeys[ri.storey];
    // the darker mood: public rooms mostly dim, back of house mostly dark, a gutted building dark throughout
    a.lighting = gutted ? 'dark' : ri.front ? (rng.chance(0.72) ? 'dim' : 'dark') : (rng.chance(0.3) ? 'dim' : 'dark');
    const w = a.w * CELL, h = a.h * CELL;
    const step = ri.role === 'shed' || ri.role === 'bay' ? 6 : ri.front ? 4.2 : 3.8;
    const nx = Math.max(1, Math.round(w / step)), nz = Math.max(1, Math.round(h / step));
    const warm = ri.front && rng.chance(0.4);
    const g = b.kit.grid(f.level);
    const mine: LightPlacement[] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = a.x * CELL + w * (i + 0.5) / nx, z = a.y * CELL + h * (j + 0.5) / nz;
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.area[g.idx(cx, cy)] !== a.id) continue;
      const ceil = Math.min(a.ceil, g.ceil[g.idx(cx, cy)] || a.ceil);
      // a tall room's fixtures hang at 4.5 m (pendants), the shed's high-bays at its roof
      const y = ri.role !== 'shed' && ceil - f.y > 4.65 ? f.y + 4.5 : ceil - 0.02;
      const l: LightPlacement = {x: r3(x), y: r3(y), z: r3(z), rot: w >= h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm, power: 1, dying: false};
      if (f.level) l.level = f.level;
      mine.push(l);
    }
    moodStates(mine, a.lighting, rng);
    b.stub.lights.push(...mine);
  }
}

/** gen/stationDress.ts applyLighting's per-profile fixture states (lit / dim / dark), on the building's own stream. */
function moodStates(ls: LightPlacement[], mood: 'lit' | 'dim' | 'dark', rng: Rng): void {
  if (!ls.length) return;
  for (const l of ls) {
    if (mood === 'lit') { l.power = r3(rng.range(0.9, 1)); l.broken = rng.chance(0.07); l.flicker = !l.broken && rng.chance(0.1); }
    else if (mood === 'dim') { l.power = r3(rng.range(0.42, 0.62)); l.broken = rng.chance(0.45); l.flicker = !l.broken && rng.chance(0.35); }
    else { l.broken = true; l.flicker = false; l.power = 0; }
  }
  if (mood === 'dim' && ls.every(l => l.broken)) ls[rng.int(0, ls.length - 1)].broken = false;
  if (mood === 'dark' && rng.chance(0.35)) {
    const l = ls[rng.int(0, ls.length - 1)];
    Object.assign(l, {broken: false, dying: true, flicker: true, power: 0.5});
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Interior enemies (permanent: ordinary layout zombies)

/** Interior enemy count range per programme (on top: + 1 per ~400 m² of walkable floor beyond the first 300, at most + 6). */
export const ENEMY_RANGE: Readonly<Record<string, readonly [number, number]>> = {
  grocery: [4, 6], pharmacy: [2, 3], hardware: [3, 5], clothing: [2, 4], electronics: [2, 3], convenience: [1, 2], liquor: [1, 2], 'sporting-goods': [2, 4],
  gunstore: [2, 3], bookstore: [2, 3], cafe: [1, 3], diner: [2, 4], 'strip-centre': [4, 7], arcade: [5, 8], 'office-block': [3, 5], 'rail-depot': [6, 9],
  police: [4, 6], 'fire-station': [3, 5], clinic: [3, 5],
};

export function planEnemies(b: InteriorBuilder): void {
  const rng = b.rng.fork('enemies');
  const [lo, hi] = ENEMY_RANGE[b.pid ?? ''] ?? [1, 3];
  let walk = 0;
  for (const ri of b.rooms) walk += ri.area.w * ri.area.h * CELL * CELL;
  // + 1 per ~400 m² of walkable floor beyond the first 300 (a big box is not as sparse as a corner shop), capped
  const n = Math.min(hi + 6, rng.int(lo, hi) + Math.max(0, Math.floor((walk - 300) / 400)));
  const pool = b.rooms.filter(r => r.enemies > 0 && r.area.w * r.area.h * CELL * CELL >= 6);
  if (!pool.length) return;
  const placed: ZombieSpawn[] = [];
  const doors = b.doorIndex();
  for (let k = 0; k < n; k++) {
    const room = weightedRoom(pool, rng);
    const z = spawnIn(b, room, placed, rng, doors.get(room.area.id) ?? []);
    if (z) placed.push(z);
  }
  b.stub.zombies.push(...placed);
}

function weightedRoom(pool: readonly RoomInfo[], rng: Rng): RoomInfo {
  return rng.weighted(pool.map(r => [r, r.enemies * Math.sqrt(r.area.w * r.area.h)] as const));
}

/** A free floor cell of the room: walkable with a clear ring, off its doorways / entrances (2 cells), 3 m from the others. */
export function spawnIn(b: InteriorBuilder, r: RoomInfo, placed: readonly ZombieSpawn[], rng: Rng, doors: readonly Door[]): ZombieSpawn | null {
  const a = r.area, f = b.storeys[r.storey], g = b.kit.grid(f.level);
  const near = (x: number, y: number): boolean => {
    for (const d of doors) if (x >= d.x - 2 && x < d.x + d.w + 2 && y >= d.y - 2 && y < d.y + d.h + 2) return true;
    if (r.storey === 0) for (const en of b.ents) for (const c of en.inner) if (Math.abs(c.x - x) <= 3 && Math.abs(c.y - y) <= 3) return true;
    return false;
  };
  for (let t = 0; t < 24; t++) {
    const x = rng.int(a.x + 1, a.x + a.w - 2), y = rng.int(a.y + 1, a.y + a.h - 2);
    const i = g.idx(x, y);
    if (g.area[i] !== a.id || g.rampIdx[i] >= 0) continue;
    let clear = true;
    for (let oy = -1; oy <= 1 && clear; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy)) { clear = false; break; }
    if (!clear || near(x, y)) continue;
    const wx = (x + 0.5) * CELL, wz = (y + 0.5) * CELL;
    if (placed.some(p => (p.level ?? 0) === f.level && Math.hypot(p.x - wx, p.z - wz) < 3)) continue;
    const z: ZombieSpawn = {x: r3(wx), z: r3(wz), yaw: r3(rng.range(-Math.PI, Math.PI)), type: rng.chance(0.3) ? 'coated' : 'shambler', area: a.id};
    if (f.level) z.level = f.level;
    z.y = r3(g.floorOf(i));
    return z;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Loose finds (items/lootTables.ts SURFACE_INTERIOR_FLOOR, once per carved storey)

export function planLoose(b: InteriorBuilder): void {
  const P = SURFACE_INTERIOR_FLOOR;
  const doors = b.doorIndex();
  for (let k = 0; k < b.carvedStoreys; k++) {
    const rng = b.rng.fork(`loose-${k}`);
    const rooms = b.roomsOn(k).filter(r => !r.noLoose && r.role !== 'stair' && r.role !== 'stair-run');
    if (!rooms.length) continue;
    const back = rooms.filter(r => !r.front);
    const finds: string[] = [];
    for (let d = 0; d < P.scarce.draws; d++) {
      if (rng.chance(P.scarce.med)) finds.push(rng.chance(P.scarce.medkit) ? 'medkit' : 'bandage');
      if (rng.chance(P.scarce.battery)) finds.push(BATTERY_ID);
      if (rng.chance(P.scarce.flare)) finds.push(FLARE_ID);
    }
    const salv = rng.int(P.salvage.n[0], P.salvage.n[1]);
    const salvage: string[] = [];
    for (let s = 0; s < salv; s++) salvage.push(rng.weighted(P.salvage.items));
    for (const [list, from] of [[finds, rooms], [salvage, back.length ? back : rooms]] as const) for (const itemId of list) {
      const r = rng.pick(from);
      const spot = freeCell(b, r, rng, doors.get(r.area.id) ?? []);
      if (!spot) continue;
      b.stub.pickups.push({itemId, count: 1, x: spot.x, y: spot.y, z: spot.z, area: r.area.id, ...(spot.level ? {level: spot.level} : {})});
    }
  }
}

function freeCell(b: InteriorBuilder, r: RoomInfo, rng: Rng, doors: readonly Door[]): {x: number; y: number; z: number; level: number} | null {
  const a = r.area, f = b.storeys[r.storey], g = b.kit.grid(f.level);
  for (let t = 0; t < 20; t++) {
    const x = rng.int(a.x, a.x + a.w - 1), y = rng.int(a.y, a.y + a.h - 1), i = g.idx(x, y);
    if (g.area[i] !== a.id || !g.walkable(x, y) || g.rampIdx[i] >= 0) continue;
    if (doors.some(d => x >= d.x - 1 && x <= d.x + d.w && y >= d.y - 1 && y <= d.y + d.h)) continue;
    if (b.stub.pickups.some(p => Math.hypot(p.x - (x + 0.5) * CELL, p.z - (y + 0.5) * CELL) < 0.6)) continue;
    return {x: r3((x + 0.5) * CELL), y: r3(g.floorOf(i)), z: r3((y + 0.5) * CELL), level: f.level};
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Entrances

/**
 * The entrances the plan keeps, with their door states: an intact building's doors are shut (sealed until opened), a damaged one's main
 * door now and then smashed in and its service door sometimes boarded, a gutted one's doors smashed. The main entrance is never boarded.
 */
export function planEntrances(b: InteriorBuilder): SurfaceEntrance[] {
  const rng = b.rng.fork('entrances');
  const cond = b.b.condition;
  const out: SurfaceEntrance[] = [];
  b.ents.forEach((en, k) => {
    const inner = en.inner.map(c => b.kit.g.area[c.i]).find(id => id >= 0 && b.info(id));
    if (inner === undefined) return;
    const e = en.e;
    let door: SurfaceEntrance['door'] = 'closed';
    if (cond === 'damaged') door = e.main ? (rng.chance(0.3) ? 'smashed' : 'closed') : (rng.chance(0.3) ? 'boarded' : 'closed');
    else if (cond === 'gutted' || cond === 'collapsed') door = e.main ? 'smashed' : (rng.chance(0.5) ? 'boarded' : 'smashed');
    const c = e.cells[Math.floor(e.cells.length / 2)];
    const alongX = e.side === 'N' || e.side === 'S';
    const xs = e.cells.map(p => p.x), ys = e.cells.map(p => p.y);
    const x = alongX ? (Math.min(...xs) + Math.max(...xs) + 1) / 2 * CELL : (e.side === 'W' ? c.x : c.x + 1) * CELL;
    const z = alongX ? (e.side === 'N' ? c.y : c.y + 1) * CELL : (Math.min(...ys) + Math.max(...ys) + 1) / 2 * CELL;
    out.push({id: `b${b.b.id}-e${k}`, building: b.b.id, level: 0, x: r3(x), z: r3(z), side: e.side, width: e.cells.length * CELL,
      height: Math.min(b.pid === 'rail-depot' && e.main ? 4.2 : 2.4, b.storeys[0].ceil - b.storeys[0].y - 0.2), inner, outer: e.outer, door,
      cells: e.cells.map(p => b.kit.g.idx(p.x, p.y))});
  });
  return out;
}
