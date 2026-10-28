// Iteration 08 (Lane A): MULTI-LEVEL STATIONS — the generator's level program (pure data, no three.js).
//
// User (iteration 08): "make the levels more multilevel … elevation changes so we go up, down,
// multi layers". Every generated station now stacks three levels over the same X/Z ground
// (gen/levels.ts contract: one full Grid per level, same size/origin, union-of-bands free space):
//
//   UPPER (1)  decks over every platform (the upper concourse), crossover bridges over the track
//              beds at both ends, a 1.5 m maintenance catwalk along the tunnel wall of outer beds,
//              LIGHT WELLS over the beds between the bridges (cells closed on the upper grid while
//              the main track-bed band rises through them: a double-height slot over the tracks, so
//              the decks / bridges are visible from the platforms and the trains from above), and
//              rooms bridging the tracks beyond the bridges (security control room, staff mezzanine).
//   MAIN (0)   platforms + track beds + everything the archetype builds (unchanged), plus
//              enclosed STAIR CORES: behind the back wall of each side platform (door in the wall),
//              or as an enclosure on an island platform (open on both long sides). A core is a lobby
//              with an UP run (flights carved identically into the main and upper grids — the same
//              Ramp, the same ramp index everywhere) and a DOWN run (main + lower grids).
//   LOWER (2)  a service crossing beneath the platforms and track beds joining the down runs'
//              bottom landings, a cable / drainage gallery along a bed with plant rooms off it
//              (pump room, electrical room, maintenance store, cable vault). Replaces the
//              iteration-05 underpass that ran under the tunnel continuation beyond the platforms.
//
// Loops: side and express stations: platform A → core up → bridge → platform B (down its core) →
// core down → service crossing → back up to A. Single-island stations get a second (up-only)
// core at the far end of the decks (island → up → deck → down → island). Rescue ladders stay.
//
// Dimensions: 0.35 m slabs (upper floor = platform ceiling + 0.35; lower ceiling = track bed − 0.35),
// ≥ 2.4 m headroom on every walkable band (2.5 m flight headroom), 0.17 × 0.28 m steps, ≤ 12 risers
// per flight with 1.2 m landings, 2.0 m wide flights, ≥ 1.5 m catwalks, railings on every walkable
// edge facing a well (layout.rails).
//
// The program is carved early (right after the archetype's track block, before passages and
// back-of-house grow), so the rest of the generator plans around it; `keepRock` keeps main-level
// rock under upper-only landings. Validation: `levelIssues` (generation retry guard + tests).

import {CELL, FLOOR, MAX_DROP, NAV_STEP, SOLID, VOID, type Grid, type Ramp} from './grid';
import type {Level, LevelLink} from './levels';
import {STAIR, layStairRun, stairRunCells, type StairFlight} from './traversal';
import type {Kit, TrackBlock} from './stationKit';
import {TRENCH_DEPTH, type Area, type Rect, type RailRun, type StationLayout} from './stationTypes';

// ---------------------------------------------------------------------------------------------
// Dimensions

export const LEVEL_MAIN = 0;
export const LEVEL_UPPER = 1;
export const LEVEL_LOWER = 2;
/** Structural slab between stacked bands (m). */
export const SLAB = 0.35;
/** Clear height of the public upper concourse (decks, bridges, wells) and of upper rooms (m). */
export const UPPER_CLEAR = 3.2;
export const UPPER_ROOM_CLEAR = 2.8;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Lower level: ceiling a slab below the track bed, 2.5 m clear. */
export const LOWER_CEIL = r2(-TRENCH_DEPTH - SLAB);
export const LOWER_FLOOR = r2(LOWER_CEIL - 2.5);
/** Minimum clear height on walkable bands and under flights (m). */
export const MIN_HEADROOM = 2.4;
export const FLIGHT_HEADROOM = 2.1;
/** Stair core (cells): flight width, lobby length, top landing, bottom landing / crossing width; heights (m). */
export const CORE = {width: 4, lobby: 6, top: 4, cross: 6, lobbyCeil: 3.0, doorH: 2.6, landingClear: 2.6, landingDoorH: 2.4};
export const CATWALK_CELLS = 3;
/** A wall plate / prop never backs onto an aperture; railings are this tall (m). */
export const RAIL_HEIGHT = 1.07;

// ---------------------------------------------------------------------------------------------
// Program record

export interface CoreRec {
  /** Platform the core serves and whether it stands on an island (else behind a side platform's back wall). */
  platform: number;
  island: boolean;
  /** Rows of the flights (cells). */
  y0: number; y1: number;
  /** Area ids: lobby (main), up run, down run (-1 = up-only core), upper landing (-1 when it is the deck itself). */
  lobby: number; up: number; down: number; landing: number;
  /** traversal.stairs ids of the up / down flights (bottom flight first for up, top flight first for down). */
  upFlights: number[]; downFlights: number[];
}

export interface LevelPlan {
  /** Upper floor / ceiling (absolute m), lower floor / ceiling. */
  hu: number; upperCeil: number; lowerFloor: number; lowerCeil: number;
  /** +1: up runs climb toward +X (decks east of the cores), -1 mirrored. */
  dir: 1 | -1;
  /** Deck X range (cells, exclusive end). */
  mx0: number; mx1: number;
  cores: CoreRec[];
  /** Light wells (cells; upper grid closed, main ceiling raised to upperCeil). */
  wells: Rect[];
  decks: number[]; bridges: number[]; catwalks: number[]; upperRooms: number[];
  crossing: number; gallery: number; lowerRooms: number[];
  spawnEnd: 'W' | 'E';
  notes: string[];
}

export interface ProgramOpts {
  /** Platform-length fractions [f0, f1] the side cores' main-level footprint must stay out of (archetype passages). */
  avoid?: readonly (readonly [number, number])[];
  /** Force the platform-1 end the player starts at. */
  spawnEnd?: 'W' | 'E';
}

interface Seg { kind: 'plat' | 'bed'; y0: number; y1: number; P?: Area; outer?: 'N' | 'S' }

/** Platform and bed row bands of a track block, north to south; outer beds lie against a tunnel wall. */
function segments(blk: TrackBlock): Seg[] {
  const s: Seg[] = [
    ...blk.platforms.map(P => ({kind: 'plat' as const, y0: P.y, y1: P.y + P.h, P})),
    ...blk.trenches.map(t => ({kind: 'bed' as const, y0: t.y0, y1: t.y1})),
  ];
  s.sort((a, b) => a.y0 - b.y0);
  if (s[0].kind === 'bed') s[0].outer = 'N';
  if (s[s.length - 1].kind === 'bed') s[s.length - 1].outer = 'S';
  return s;
}

const platNo = (P: Area) => (P.label.match(/\d+(?:\s*·\s*\d+)?/)?.[0] ?? String(P.platformNo ?? 1)).replace(/\s+/g, ' ');

/**
 * Carves the multi-level program of one track block (the station's main block) into the kit's
 * level canvases. Returns false when it cannot fit (the generation attempt is retried).
 */
export function levelProgram(k: Kit, blk: TrackBlock, opts: ProgramOpts = {}): boolean {
  const rng = k.rng;
  const G0 = k.grid(LEVEL_MAIN), GU = k.grid(LEVEL_UPPER);
  const plats = blk.platforms;
  const island = plats.every(p => p.edge === 'NS');
  if (!island && plats.some(p => p.edge === 'NS')) return false;
  const single = island && plats.length === 1;
  const hu = r2(plats[0].ceil + SLAB), uc = r2(hu + UPPER_CLEAR);
  const segs = segments(blk);
  const CW = CORE.width, LB = CORE.lobby, CX = CORE.cross, TL = island ? 0 : CORE.top;
  const UL = stairRunCells(hu), DL = stairRunCells(-LOWER_FLOOR);
  const BW = rng.int(6, 8);
  const RW = rng.int(10, 14);
  const d: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const spawnEnd: 'W' | 'E' = opts.spawnEnd ?? (rng.chance(0.5) ? 'W' : 'E');
  const px0 = blk.px0, px1 = blk.px1, Lp = px1 - px0;
  let ML = single ? rng.int(36, 48) : rng.int(52, 76);
  // Local coordinate u runs from the core's outer end (crossing) toward the decks.
  const upEnd = CX + DL + LB + UL;
  const geo = (ml: number, core2: boolean) => {
    const m0 = island ? upEnd : upEnd - 1, m1 = m0 + ml;
    const near: [number, number] = [m0 - 1 - RW, m0 - 1], far: [number, number] = [m1 + 1, m1 + 1 + RW];
    const c2: [number, number] = [m1, m1 + UL + LB];
    const lo = Math.min(0, near[0]), hi = Math.max(far[1], upEnd + TL, core2 ? c2[1] : 0);
    return {m0, m1, near, far, c2, lo, hi};
  };
  const xr = (xa: number, a: number, b: number): [number, number] => (d > 0 ? [xa + a, xa + b] : [xa - b, xa - a]);
  // Core rows per platform.
  const coreRows = (P: Area): {y0: number; wall: number; back: 'N' | 'S' | null} => {
    if (P.edge === 'NS') return {y0: P.y + Math.floor((P.h - CW) / 2), wall: -1, back: null};
    const back = P.edge === 'N' ? 'S' : 'N';
    const wy = back === 'S' ? P.y + P.h : P.y - 1;
    return {y0: back === 'S' ? wy + 1 : wy - CW, wall: wy, back};
  };
  const avoid = (opts.avoid ?? []).map(([f0, f1]) => [px0 + Math.floor(f0 * Lp) - 2, px0 + Math.ceil(f1 * Lp) + 2] as const);
  const fits = (ml: number, core2: boolean, useSpawn: boolean): number[] => {
    const g = geo(ml, core2);
    const out: number[] = [];
    const sp = Math.round(Lp * 0.2) + 16;
    for (let xa = px0 - 400; xa <= px1 + 400; xa++) {
      const [s0, s1] = xr(xa, g.lo, g.hi);
      if (s0 < px0 + 2 || s1 > px1 - 2) continue;
      if (useSpawn && (spawnEnd === 'W' ? s0 < px0 + sp : s1 > px1 - sp)) continue;
      const [c0, c1] = xr(xa, CX, upEnd);
      if (!island) {
        if (avoid.some(([a, b]) => c0 < b && c1 > a)) continue;
        let ok = true;
        for (const P of plats) {
          const {y0} = coreRows(P);
          if (!k.rectFree({x: c0, y: y0, w: c1 - c0, h: CW})) { ok = false; break; }
          const [t0, t1] = xr(xa, upEnd, upEnd + TL);
          if (!k.solid({x: t0, y: y0, w: t1 - t0, h: CW}) || !k.solid({x: t0, y: y0 - 1, w: t1 - t0, h: CW + 2})) { ok = false; break; }
        }
        if (!ok) continue;
      }
      out.push(xa);
    }
    return out;
  };
  let core2 = single;
  let cands: number[] = [];
  const minML = single ? 28 : 36;
  outer: for (const useSpawn of [true, false]) {
    for (const c2 of single ? [true, false] : [false]) {
      for (let ml = ML; ml >= minML; ml -= 6) {
        cands = fits(ml, c2, useSpawn);
        if (cands.length) { ML = ml; core2 = c2; break outer; }
      }
    }
  }
  if (!cands.length) return false;
  const xa = rng.pick(cands);
  const G = geo(ML, core2);
  const [mx0, mx1] = xr(xa, G.m0, G.m1);
  const plan: LevelPlan = {
    hu, upperCeil: uc, lowerFloor: LOWER_FLOOR, lowerCeil: LOWER_CEIL, dir: d, mx0, mx1, cores: [], wells: [],
    decks: [], bridges: [], catwalks: [], upperRooms: [], crossing: -1, gallery: -1, lowerRooms: [], spawnEnd, notes: [],
  };
  const upLevel = {level: LEVEL_UPPER, floorY: hu};
  const loLevel = {level: LEVEL_LOWER, floorY: LOWER_FLOOR};

  // --- 1. Upper: decks over the platforms, bridges / catwalks / wells over the beds -------------
  const deckOf = new Map<number, Area>();
  for (const s of segs) {
    if (s.kind !== 'plat') continue;
    const P = s.P!;
    const D = k.addArea({x: mx0, y: s.y0, w: mx1 - mx0, h: s.y1 - s.y0}, 'concourse', 'concourse', uc, P.id, {...upLevel, paid: true, role: 'upper-concourse', label: `Upper concourse · Platform ${platNo(P)}`});
    deckOf.set(P.id, D);
    plan.decks.push(D.id);
  }
  const firstDeck = k.areas[plan.decks[0]];
  const bridgeRows = new Map<Seg, [number, number]>();
  const bridgesOf = new Map<Seg, Area[]>();
  for (const s of segs) {
    if (s.kind !== 'bed') continue;
    let w0 = s.y0, w1 = s.y1;
    if (s.outer && s.y1 - s.y0 >= 8) {
      const cr: Rect = s.outer === 'N' ? {x: mx0, y: s.y0, w: mx1 - mx0, h: CATWALK_CELLS} : {x: mx0, y: s.y1 - CATWALK_CELLS, w: mx1 - mx0, h: CATWALK_CELLS};
      // Service soffit: the catwalk keeps a 2.8 m ceiling under the high well roof.
      const C = k.addArea(cr, 'service', 'service-corridor', r2(hu + UPPER_ROOM_CLEAR), firstDeck.id, {...upLevel, publicSpace: false, role: 'catwalk', label: 'Maintenance catwalk'});
      plan.catwalks.push(C.id);
      if (s.outer === 'N') w0 += CATWALK_CELLS; else w1 -= CATWALK_CELLS;
    }
    bridgeRows.set(s, [w0, w1]);
    const list: Area[] = [];
    for (const bx of [mx0, mx1 - BW]) {
      const B = k.addArea({x: bx, y: w0, w: BW, h: w1 - w0}, 'concourse', 'concourse', uc, firstDeck.id, {...upLevel, paid: true, role: 'crossover', label: 'Crossover bridge'});
      list.push(B);
      plan.bridges.push(B.id);
    }
    bridgesOf.set(s, d > 0 ? list : [list[1], list[0]]); // [near (core side), far]
    let spans: [number, number][] = [[mx0 + BW, mx1 - BW]];
    const inner = mx1 - mx0 - 2 * BW;
    if (!s.outer && inner >= 28 && rng.chance(0.45)) {
      const mc = Math.floor((mx0 + mx1) / 2) - 2;
      const F = k.addArea({x: mc, y: w0, w: 4, h: w1 - w0}, 'concourse', 'concourse', uc, firstDeck.id, {...upLevel, paid: true, role: 'crossover', label: 'Footbridge'});
      plan.bridges.push(F.id);
      spans = [[mx0 + BW, mc], [mc + 4, mx1 - BW]];
      plan.notes.push('footbridge');
    }
    for (const [a, b] of spans) {
      if (b - a < 2) continue;
      const r: Rect = {x: a, y: w0, w: b - a, h: w1 - w0};
      plan.wells.push(r);
      // The track-bed band rises through the well to the upper ceiling (upper grid stays closed there).
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) G0.ceil[G0.idx(x, y)] = uc;
    }
  }

  // --- 2. Stair cores ---------------------------------------------------------------------------
  const runFlights = (fl: StairFlight[]): number[] => fl.map(f => { f.id = k.flights.length; k.flights.push(f); return f.id; });
  const islandWalls = (y0: number, xa0: number, xa1: number) => {
    for (const row of [y0 - 1, y0 + CW]) for (let x = xa0; x < xa1; x++) {
      const i = G0.idx(x, row);
      G0.cells[i] = SOLID; G0.area[i] = -1; G0.ceil[i] = 0; G0.floor[i] = 0;
    }
  };
  for (const P of plats) {
    const {y0, wall, back} = coreRows(P);
    const rowsR = (x0: number, x1: number): Rect => ({x: x0, y: y0, w: x1 - x0, h: CW});
    const [dx0, dx1] = xr(xa, CX, CX + DL), [lx0, lx1] = xr(xa, CX + DL, CX + DL + LB), [ux0, ux1] = xr(xa, CX + DL + LB, upEnd);
    if (island) islandWalls(y0, Math.min(dx0, ux0), Math.max(dx1, ux1));
    const lobby = k.addArea(rowsR(lx0, lx1), 'passage', 'stair-core', CORE.lobbyCeil, P.id, {paid: true, role: 'stair-core', label: `Stairs · Platform ${platNo(P)}`});
    if (island) for (const row of [y0 - 1, y0 + CW]) k.carveDoor({x: lx0 + 1, y: row, w: LB - 2, h: 1}, P, lobby, CORE.doorH, true);
    else k.carveDoor({x: lx0 + 1, y: wall, w: LB - 2, h: 1}, P, lobby, CORE.doorH, true);
    const up = k.addArea(rowsR(ux0, ux1), 'passage', 'stair-core', STAIR.headroom, lobby.id, {paid: true, role: 'stair', label: 'Stairs · Upper concourse', also: [LEVEL_UPPER]});
    const upF = runFlights(layStairRun([G0, GU], rowsR(ux0, ux1), up.id, 'x', d > 0 ? 'lo' : 'hi', 0, hu));
    const down = k.addArea(rowsR(dx0, dx1), 'passage', 'stair-core', STAIR.headroom, lobby.id, {paid: true, role: 'stair', label: 'Stairs · Service level', also: [LEVEL_LOWER]});
    const dnF = runFlights(layStairRun([G0, k.grid(LEVEL_LOWER)], rowsR(dx0, dx1), down.id, 'x', d > 0 ? 'hi' : 'lo', 0, LOWER_FLOOR));
    let landing = -1;
    if (!island) {
      const [tx0, tx1] = xr(xa, upEnd, upEnd + TL);
      const T = k.addArea(rowsR(tx0, tx1), 'passage', 'stair-core', r2(hu + CORE.landingClear), up.id, {...upLevel, paid: true, role: 'landing', label: `Upper landing · Platform ${platNo(P)}`});
      for (let y = y0 - 1; y <= y0 + CW; y++) for (let x = tx0; x < tx1; x++) k.keepRock[G0.idx(x, y)] = 1;
      k.carveDoor({x: tx0, y: wall, w: tx1 - tx0, h: 1}, deckOf.get(P.id)!, T, CORE.landingDoorH, true);
      landing = T.id;
      void back;
    }
    plan.cores.push({platform: P.id, island, y0, y1: y0 + CW, lobby: lobby.id, up: up.id, down: down.id, landing, upFlights: upF, downFlights: dnF});
  }
  if (core2) {
    // Single island: an up-only core at the far end of the decks closes the loop through the upper level.
    const P = plats[0];
    const {y0} = coreRows(P);
    const rowsR = (x0: number, x1: number): Rect => ({x: x0, y: y0, w: x1 - x0, h: CW});
    const [ux0, ux1] = xr(xa, G.m1, G.m1 + UL), [lx0, lx1] = xr(xa, G.m1 + UL, G.m1 + UL + LB);
    islandWalls(y0, Math.min(ux0, lx0), Math.max(ux1, lx1));
    const lobby = k.addArea(rowsR(lx0, lx1), 'passage', 'stair-core', CORE.lobbyCeil, P.id, {paid: true, role: 'stair-core', label: `Stairs · Platform ${platNo(P)} (far end)`});
    for (const row of [y0 - 1, y0 + CW]) k.carveDoor({x: lx0 + 1, y: row, w: LB - 2, h: 1}, P, lobby, CORE.doorH, true);
    const up = k.addArea(rowsR(ux0, ux1), 'passage', 'stair-core', STAIR.headroom, lobby.id, {paid: true, role: 'stair', label: 'Stairs · Upper concourse', also: [LEVEL_UPPER]});
    const upF = runFlights(layStairRun([G0, GU], rowsR(ux0, ux1), up.id, 'x', d > 0 ? 'hi' : 'lo', 0, hu));
    plan.cores.push({platform: P.id, island: true, y0, y1: y0 + CW, lobby: lobby.id, up: up.id, down: -1, landing: -1, upFlights: upF, downFlights: []});
    plan.notes.push('core2');
  }

  // --- 3. Upper rooms bridging the tracks beyond the crossover bridges ----------------------------
  const roomBed = segs.find(s => s.kind === 'bed' && !s.outer) ?? segs.find(s => s.kind === 'bed' && s.outer === 'N')!;
  const [b0, b1] = bridgeRows.get(roomBed)!;
  const [nearB, farB] = bridgesOf.get(roomBed)!;
  const rooms: [boolean, Area['type'], string, string][] = [[true, 'utility', 'security-office', 'Security control room'], [false, 'crew-room', rng.chance(0.5) ? 'staff-room' : 'locker-room', 'Staff mezzanine']];
  for (const [far, type, purpose, label] of rooms) {
    const [ra, rb] = far ? G.far : G.near;
    const [x0, x1] = xr(xa, ra, rb);
    const r: Rect = {x: x0, y: roomBed.y0, w: x1 - x0, h: roomBed.y1 - roomBed.y0};
    if (!k.rectFree(r, LEVEL_UPPER)) continue;
    const B = far ? farB : nearB;
    const R = k.addArea(r, 'room', type, r2(hu + UPPER_ROOM_CLEAR), B.id, {...upLevel, publicSpace: false, label});
    R.purpose = purpose;
    const col = (far ? d > 0 : d < 0) ? mx1 : mx0 - 1;
    const mid = Math.floor((b0 + b1) / 2);
    k.carveDoor({x: col, y: mid - 1, w: 1, h: 3}, B, R, 2.3, false, {staff: true});
    plan.upperRooms.push(R.id);
  }

  // --- 4. Lower: service crossing, gallery, plant rooms ---------------------------------------------
  const [cx0, cx1] = xr(xa, 0, CX);
  // Side blocks: from one core's bottom landing (behind its back wall) to the other's; islands: under every bed.
  const ry0 = island ? segs[0].y0 : Math.min(...plan.cores.filter(c => c.down >= 0).map(c => c.y0));
  const ry1 = island ? segs[segs.length - 1].y1 : Math.max(...plan.cores.filter(c => c.down >= 0).map(c => c.y1));
  const crossing = k.addArea({x: cx0, y: ry0, w: cx1 - cx0, h: ry1 - ry0}, 'service', 'service-corridor', LOWER_CEIL, plan.cores[0].down, {...loLevel, publicSpace: false, role: 'service-crossing', label: 'Service crossing'});
  plan.crossing = crossing.id;
  const gb = segs.find(s => s.kind === 'bed' && !s.outer) ?? segs.find(s => s.kind === 'bed' && s.outer === 'N')!;
  const GW = 6;
  const gy0 = gb.y0 + Math.floor((gb.y1 - gb.y0 - GW) / 2);
  let gl = rng.int(36, 60);
  const GLo = k.grid(LEVEL_LOWER);
  const freeLower = (r: Rect) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!GLo.inBounds(x, y) || GLo.cells[GLo.idx(x, y)] !== SOLID) return false;
    return true;
  };
  // The gallery leaves the crossing through a doorway in a one-cell wall (a real portal: kept clear of dressing).
  const G0u = CX + 1;
  for (; gl >= 16; gl -= 4) {
    const [gx0, gx1] = xr(xa, CX, G0u + gl);
    if (gx0 >= px0 + 2 && gx1 <= px1 - 2 && freeLower({x: gx0, y: gy0 - 1, w: gx1 - gx0, h: GW + 2})) break;
  }
  if (gl < 16) return false;
  const [gx0, gx1] = xr(xa, G0u, G0u + gl);
  const gallery = k.addArea({x: gx0, y: gy0, w: gx1 - gx0, h: GW}, 'service', 'service-corridor', LOWER_CEIL, crossing.id, {...loLevel, publicSpace: false, role: 'service-gallery', label: 'Service gallery'});
  const [wx0] = xr(xa, CX, CX + 1);
  k.carveDoor({x: wx0, y: gy0 + 1, w: 1, h: GW - 2}, crossing, gallery, 2.3, true);
  plan.gallery = gallery.id;
  const kinds = rng.shuffle([
    ['utility', 'pump-room', 'Pump room'], ['utility', 'electrical-room', 'Electrical room'],
    ['storage', 'storage', 'Maintenance store'], ['utility', 'signal-room', 'Cable vault'],
  ] as [Area['type'], string, string][]);
  let ki = 0;
  for (const north of [true, false]) {
    let u = G0u + 2;
    while (ki < kinds.length && u + 9 <= G0u + gl) {
      const rw = Math.min(rng.int(10, 14), G0u + gl - u);
      let placed = false;
      for (let rh = rng.int(8, 11); rh >= 6 && !placed; rh--) {
        const [x0, x1] = xr(xa, u, u + rw);
        const r: Rect = north ? {x: x0, y: gy0 - 1 - rh, w: x1 - x0, h: rh} : {x: x0, y: gy0 + GW + 1, w: x1 - x0, h: rh};
        if (r.y < blk.y0 || r.y + r.h > blk.y1 + 1 || !k.rectFree(r, LEVEL_LOWER)) continue;
        const [type, purpose, label] = kinds[ki++];
        const R = k.addArea(r, 'room', type, LOWER_CEIL, gallery.id, {...loLevel, publicSpace: false, label});
        R.purpose = purpose;
        const mid = r.x + Math.floor(r.w / 2);
        k.carveDoor({x: mid - 1, y: north ? gy0 - 1 : gy0 + GW, w: 3, h: 1}, gallery, R, 2.3, false);
        plan.lowerRooms.push(R.id);
        placed = true;
        u += rw + 1;
      }
      if (!placed) u += 3;
    }
  }
  plan.notes.push(`${island ? (single ? 'island' : 'islands') : 'side'}:${plan.cores.length} cores, deck ${((mx1 - mx0) * CELL).toFixed(1)} m`);
  k.levelPlan = plan;
  return true;
}

// ---------------------------------------------------------------------------------------------
// After the crop

/** Shifts the canvas-space plan by the crop offset. */
export function shiftPlan(p: LevelPlan, ox: number, oy: number): LevelPlan {
  return {
    ...p, mx0: p.mx0 - ox, mx1: p.mx1 - ox,
    cores: p.cores.map(c => ({...c, y0: c.y0 - oy, y1: c.y1 - oy})),
    wells: p.wells.map(w => ({...w, x: w.x - ox, y: w.y - oy})),
  };
}

/** The station's levels (main, upper, lower) from cropped grids. */
export function buildLevels(grids: Grid[], plan: LevelPlan | null): Level[] {
  const out: Level[] = [{id: LEVEL_MAIN, role: 'main', grid: grids[0], baseY: 0}];
  if (!plan) return out;
  out.push({id: LEVEL_UPPER, role: 'upper', grid: grids[1], baseY: plan.hu});
  out.push({id: LEVEL_LOWER, role: 'lower', grid: grids[2], baseY: plan.lowerFloor});
  return out;
}

/** One LevelLink per stair run (stand points just off its bottom and top; ramp = its first flight). */
export function buildLevelLinks(plan: LevelPlan | null, stairs: readonly StairFlight[]): LevelLink[] {
  const out: LevelLink[] = [];
  if (!plan) return out;
  for (const c of plan.cores) {
    if (c.upFlights.length) {
      const first = stairs[c.upFlights[0]], last = stairs[c.upFlights[c.upFlights.length - 1]];
      out.push({id: out.length, kind: 'stairs', lower: LEVEL_MAIN, upper: LEVEL_UPPER, ramp: first.ramp, bottom: {...first.bottom}, top: {...last.top}, traversalId: first.id});
    }
    if (c.downFlights.length) {
      const first = stairs[c.downFlights[0]], last = stairs[c.downFlights[c.downFlights.length - 1]];
      out.push({id: out.length, kind: 'stairs', lower: LEVEL_LOWER, upper: LEVEL_MAIN, ramp: first.ramp, bottom: {...last.bottom}, top: {...first.top}, traversalId: first.id});
    }
  }
  return out;
}

const isOpen = (g: Grid, i: number) => g.cells[i] === FLOOR || g.cells[i] === VOID;

/** Per-level flat arrays (open mask, floor, ceiling with Infinity = unset), built once per levels list. */
/**
 * Per-level flat arrays (open mask, floor, ceiling with Infinity = unset), built once per levels list.
 * `box` = cell bounds [x0, y0, x1, y1) of every non-main level's open cells (all stacking happens inside
 * it; outside it only the main level is open) — the stacked-level passes scan just that box.
 */
export interface LevelArrays { n: number; W: number; H: number; open: Uint8Array[]; fl: Float32Array[]; cl: Float32Array[]; box: [number, number, number, number] }
const ARRAYS = new WeakMap<readonly Level[], LevelArrays>();
export function levelArrays(levels: readonly Level[]): LevelArrays {
  let a = ARRAYS.get(levels);
  if (a) return a;
  const g0 = levels[0].grid, W = g0.w, H = g0.h, n = W * H;
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
  for (let k = 1; k < levels.length; k++) {
    const cells = levels[k].grid.cells;
    for (let y = 0; y < H; y++) {
      const r = y * W;
      let lo = -1, hi = -1;
      for (let x = 0; x < W; x++) if (cells[r + x] !== SOLID) { if (lo < 0) lo = x; hi = x; }
      if (lo < 0) continue;
      if (lo < bx0) bx0 = lo; if (hi + 1 > bx1) bx1 = hi + 1; if (y < by0) by0 = y; by1 = y + 1;
    }
  }
  if (bx1 <= bx0) { bx0 = by0 = bx1 = by1 = 0; }
  a = {n, W, H, open: [], fl: [], cl: [], box: [bx0, by0, bx1, by1]};
  for (const L of levels) {
    const g = L.grid, cells = g.cells, floor = g.floor, ceil = g.ceil, vf = g.voidFloor;
    const open = new Uint8Array(n), fl = new Float32Array(n), cl = new Float32Array(n);
    const [x0, y0, x1, y1] = L.id === 0 ? [0, 0, W, H] : [bx0, by0, bx1, by1];
    for (let y = y0; y < y1; y++) for (let i = y * W + x0, e = y * W + x1; i < e; i++) {
      const c = cells[i];
      if (c === SOLID) continue;
      open[i] = c === FLOOR || c === VOID ? 1 : 0;
      const f = floor[i];
      fl[i] = f === 0 && c === VOID ? vf : f;
      cl[i] = ceil[i] !== 0 || f !== 0 ? ceil[i] : Infinity;
    }
    a.open.push(open); a.fl.push(fl); a.cl.push(cl);
  }
  ARRAYS.set(levels, a);
  return a;
}

/**
 * Aperture masks per level: cells CLOSED on that level while another level's open band crosses the
 * level's floor plane there (light wells): you look down through them, so nothing may back onto
 * them (wall plates, wall props) and walkable edges beside them get railings.
 */
const APERTURES = new WeakMap<Grid, Uint8Array>();
export function registerApertures(levels: readonly Level[]): void {
  if (levels.length < 2) return;
  const {n, W, open, fl, cl, box: [bx0, by0, bx1, by1]} = levelArrays(levels);
  for (const L of levels) {
    const m = new Uint8Array(n), oL = open[L.id], lo = L.baseY - 0.2, hi = L.baseY + 0.2;
    let any = false;
    for (const M of levels) {
      if (M.id === L.id) continue;
      const oM = open[M.id], fM = fl[M.id], cM = cl[M.id], rM = M.grid.rampIdx;
      // Two levels can only overlap inside the stacked box.
      for (let y = by0; y < by1; y++) for (let i = y * W + bx0, e = y * W + bx1; i < e; i++) if (!oL[i] && oM[i] && fM[i] < lo && cM[i] > hi && rM[i] < 0) { m[i] = 1; any = true; }
    }
    if (any) APERTURES.set(L.grid, m); else APERTURES.delete(L.grid);
  }
}
/** Aperture mask of a level grid (registered for generated stations), or undefined. */
export function apertureOf(g: Grid): Uint8Array | undefined {
  return APERTURES.get(g);
}

/**
 * Railings: every boundary between a walkable (FLOOR, non-ramp) cell of a level and a cell that is
 * closed on that level while another level's band drops away below it (an aperture / well edge),
 * merged into straight runs. Platform edges onto the track bed are open on the main grid and are
 * never railed.
 */
export function deriveRails(levels: readonly Level[]): RailRun[] {
  const out: RailRun[] = [];
  if (levels.length < 2) return out;
  const {fl, W, H} = levelArrays(levels);
  for (const L of levels) {
    // Railed edges = walkable cells beside this level's apertures (registerApertures runs first).
    const ap = APERTURES.get(L.grid);
    if (!ap) continue;
    const g = L.grid, fLv = fl[L.id], cells = g.cells, ramp = g.rampIdx;
    const drop = (j: number): boolean => ap[j] === 1;
    // Only rows / columns next to an aperture can carry a railing.
    const rowHas = new Uint8Array(H), colHas = new Uint8Array(W);
    for (let i = 0; i < ap.length; i++) if (ap[i]) { rowHas[(i / W) | 0] = 1; colHas[i % W] = 1; }
    // Horizontal boundaries (between rows y-1 and y): runs along X; vertical boundaries: along Z.
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const alongX = dx === 0;
      const outer = alongX ? H : W, inner = alongX ? W : H;
      const step = dx + dy * W;
      for (let a = 1; a < outer - 1; a++) {
        if (!(alongX ? rowHas[a + dy] : colHas[a + dx])) continue;
        let start = -1, fy = 0;
        const line = (alongX ? (dy < 0 ? a : a + 1) : (dx < 0 ? a : a + 1)) * CELL;
        for (let b = 1; b < inner; b++) {
          let on = false, f = 0;
          if (b < inner - 1) {
            const i = alongX ? a * W + b : b * W + a;
            if (cells[i] === FLOOR && ramp[i] < 0) { f = fLv[i]; on = drop(i + step); }
          }
          if (start >= 0 && (!on || Math.abs(f - fy) > 1e-3)) {
            const s0 = start * CELL, s1 = b * CELL;
            out.push(alongX
              ? {level: L.id, x0: s0, z0: line, x1: s1, z1: line, y0: fy, y1: fy, nx: 0, nz: -dy, kind: 'railing'}
              : {level: L.id, x0: line, z0: s0, x1: line, z1: s1, y0: fy, y1: fy, nx: -dx, nz: 0, kind: 'railing'});
            start = -1;
          }
          if (on && start < 0) { start = b; fy = f; }
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Multi-level reachability

/**
 * Walking distance (cells) from a start cell over every level: neighbours on a level within
 * NAV_STEP (drops down to MAX_DROP one-way), nav links (ladders), and a free switch where a cell is
 * open on two levels at the same floor (stair runs carved into both grids). -1 = unreachable.
 */
export function levelDistance(levels: readonly Level[], sx: number, sy: number, level = 0): Int32Array[] {
  const {n, W, H, open, fl} = levelArrays(levels);
  const NL = levels.length;
  const dist = levels.map(() => new Int32Array(n).fill(-1));
  const ok = levels.map(L => { const b = L.grid.blocked, o = open[L.id], a = new Uint8Array(n); for (let i = 0; i < n; i++) if (o[i] && !b[i]) a[i] = 1; return a; });
  const q = new Int32Array(n * NL);
  let head = 0, tail = 0;
  const s = sx + sy * W;
  if (s < 0 || s >= n || !ok[level][s]) return dist;
  dist[level][s] = 0;
  q[tail++] = level * n + s;
  while (head < tail) {
    const v = q[head++];
    const L = (v / n) | 0, c = v - L * n;
    const dL = dist[L], okL = ok[L], fL = fl[L];
    const d = dL[c], f = fL[c];
    // Same cell on another level at the same floor (shared stair cells).
    for (let M = 0; M < NL; M++) if (M !== L && ok[M][c] && dist[M][c] < 0 && Math.abs(fl[M][c] - f) < 0.05) { dist[M][c] = d; q[tail++] = M * n + c; }
    const nd = d + 1, cx = c % W, base = L * n;
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? (cx > 0 ? c - 1 : -1) : k === 1 ? (cx < W - 1 ? c + 1 : -1) : k === 2 ? (c >= W ? c - W : -1) : (c < n - W ? c + W : -1);
      if (j < 0 || dL[j] >= 0 || !okL[j]) continue;
      const dh = fL[j] - f;
      if (dh > NAV_STEP || dh < -MAX_DROP) continue;
      dL[j] = nd;
      q[tail++] = base + j;
    }
    const g = levels[L].grid;
    if (g.links.length) for (const li of g.linksAt(c)) {
      const l = g.links[li];
      const o = l.a === c ? l.b : l.a;
      if (dL[o] < 0 && okL[o]) { dL[o] = nd; q[tail++] = base + o; }
    }
  }
  void H;
  return dist;
}

// ---------------------------------------------------------------------------------------------
// Validation + metrics

/** Level a placement / area lies on. */
export const levelOfArea = (layout: StationLayout, area: number): number => layout.areas[area]?.level ?? 0;

/** Overlap (m²) of `level`'s walkable cells with main-level open cells above / below. */
export function overlapArea(layout: StationLayout, level: number): number {
  const L = layout.levels[level];
  if (!L) return 0;
  const g = L.grid, g0 = layout.grid;
  const {W, box: [bx0, by0, bx1, by1]} = levelArrays(layout.levels);
  let n = 0;
  for (let y = by0; y < by1; y++) for (let i = y * W + bx0, e = y * W + bx1; i < e; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0 && isOpen(g0, i) && g0.rampIdx[i] < 0) n++;
  return n * CELL * CELL;
}

/** Compact per-station summary (tests / QA / report). */
export function levelMetrics(layout: StationLayout) {
  const m2 = (lv: number) => {
    const g = layout.levels[lv]?.grid;
    if (!g) return 0;
    let n = 0;
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && (lv === 0 || g.rampIdx[i] < 0)) n++;
    return Math.round(n * CELL * CELL);
  };
  const p = layout.levelPlan;
  return {
    levels: layout.levels.length,
    upperY: p?.hu ?? null, lowerY: p?.lowerFloor ?? null,
    walkM2: layout.levels.map((_, i) => m2(i)),
    overlapUpperM2: Math.round(overlapArea(layout, LEVEL_UPPER)),
    overlapLowerM2: Math.round(overlapArea(layout, LEVEL_LOWER)),
    stairLinks: layout.levelLinks.filter(l => l.kind === 'stairs').length,
    upLinks: layout.levelLinks.filter(l => l.upper === LEVEL_UPPER).length,
    downLinks: layout.levelLinks.filter(l => l.lower === LEVEL_LOWER).length,
    wellsM2: Math.round((p?.wells ?? []).reduce((a, w) => a + w.w * w.h, 0) * CELL * CELL),
    rails: layout.rails.length,
    railM: Math.round(layout.rails.reduce((a, r) => a + Math.hypot(r.x1 - r.x0, r.z1 - r.z0), 0)),
    areasUpper: layout.areas.filter(a => a.level === LEVEL_UPPER).length,
    areasLower: layout.areas.filter(a => a.level === LEVEL_LOWER).length,
    zombiesUpper: layout.zombies.filter(z => z.level === LEVEL_UPPER).length,
    zombiesLower: layout.zombies.filter(z => z.level === LEVEL_LOWER).length,
    notes: p?.notes ?? [],
  };
}

/** Minimum real X/Z overlap (m²) of the upper and lower levels with the main level. */
export const MIN_OVERLAP_M2 = 150;

/**
 * Multi-level invariants (generation retry guard + tests): levels share the main grid's size;
 * real overlap above / below the main level; every level has a stair link; slabs between stacked
 * bands and ≥ 2.4 m headroom on walkable level bands; flights 0.17 × 0.28 m with ≥ 1.2 m landings;
 * landings ≥ 1.2 m deep and ≥ 1.8 m wide on the right levels; railings on every well edge; nothing
 * placed in a stair run or over an aperture; every walkable cell on every level reachable.
 */
export function levelIssues(layout: StationLayout, dist?: Int32Array[]): string[] {
  const issues: string[] = [];
  const levels = layout.levels;
  if (!levels?.length || levels[0].grid !== layout.grid) return ['levels[0] is not the main grid'];
  if (levels.length < 3) issues.push(`only ${levels.length} levels`);
  const g0 = layout.grid;
  for (const L of levels) if (L.grid.w !== g0.w || L.grid.h !== g0.h) issues.push(`level ${L.id} grid size differs`);
  for (const L of levels) if (L.grid.ramps !== g0.ramps && L.grid.ramps.some((r, i) => g0.ramps[i] !== r)) issues.push(`level ${L.id} ramp list differs`);
  if (levels.length < 2) return issues;
  for (const lv of [LEVEL_UPPER, LEVEL_LOWER]) {
    if (!levels[lv]) continue;
    const ov = overlapArea(layout, lv);
    if (ov < MIN_OVERLAP_M2) issues.push(`level ${lv} overlaps the main level by only ${ov.toFixed(0)} m²`);
    if (!layout.levelLinks.some(l => l.kind === 'stairs' && (l.upper === lv || l.lower === lv))) issues.push(`level ${lv} has no stairs`);
  }
  // Bands: slabs between stacked bands of different levels, headroom on walkable bands.
  const {open, fl, cl, W: AW, box: [bx0, by0, bx1, by1]} = levelArrays(levels);
  const NL = levels.length;
  const bL: number[] = [], bF: number[] = [], bC: number[] = [], bW: boolean[] = [];
  let slabBad = 0, headBad = 0;
  // Outside the stacked box only the main level is open.
  for (let y = by0; y < by1; y++) for (let i = y * AW + bx0, e = y * AW + bx1; i < e; i++) {
    let cnt = 0, only = -1;
    for (let L = 0; L < NL; L++) if (open[L][i]) { cnt++; only = L; }
    if (!cnt || (cnt === 1 && only === 0)) continue;
    bL.length = bF.length = bC.length = bW.length = 0;
    for (let L = 0; L < NL; L++) {
      if (!open[L][i]) continue;
      const f = fl[L][i], c = cl[L][i];
      // A stair run (flights + landings) is carved identically into two grids: one band.
      let dup = false;
      for (let k = 0; k < bF.length; k++) if (Math.abs(bF[k] - f) < 1e-4 && Math.abs(bC[k] - c) < 1e-4) { dup = true; break; }
      if (dup) continue;
      const g = levels[L].grid;
      bL.push(L); bF.push(f); bC.push(c); bW.push(g.cells[i] === FLOOR && g.rampIdx[i] < 0);
    }
    const order = bF.map((_, k) => k).sort((a, b) => bF[a] - bF[b]);
    for (let q = 0; q < order.length; q++) {
      const k = order[q];
      if (bL[k] !== 0 && bW[k] && bC[k] - bF[k] < MIN_HEADROOM - 1e-3 && !isDoorCell(layout, bL[k], i) && headBad++ < 4) issues.push(`level ${bL[k]} cell ${i % g0.w},${(i / g0.w) | 0} headroom ${(bC[k] - bF[k]).toFixed(2)} m`);
      if (q > 0) {
        const p = order[q - 1];
        if (bF[k] - bC[p] < SLAB - 1e-3) { if (slabBad++ < 4) issues.push(`slab ${(bF[k] - bC[p]).toFixed(2)} m between levels ${bL[p]}/${bL[k]} at ${i % g0.w},${(i / g0.w) | 0}`); break; }
      }
    }
  }
  // Flights: spec, landings, headroom.
  for (const f of layout.traversal.stairs) {
    if (f.riser < 0.15 || f.riser > 0.18 + 1e-6 || Math.abs(f.tread - STAIR.tread) > 1e-6 || f.risers > STAIR.maxRisers) issues.push(`flight ${f.id} off spec`);
    if (Math.abs(f.a1 - f.a0) < 1.8 - 1e-6) issues.push(`flight ${f.id} narrower than 1.8 m`);
    const r = g0.ramps[f.ramp];
    if (r.headroom < FLIGHT_HEADROOM) issues.push(`flight ${f.id} headroom ${r.headroom}`);
    for (const [name, p] of [['top', f.top], ['bottom', f.bottom]] as const) {
      if (!standOn(layout, p)) issues.push(`flight ${f.id} ${name} stand point not on a walkable band`);
    }
  }
  for (const k of layout.levelLinks) {
    for (const [name, p, lv] of [['bottom', k.bottom, k.lower], ['top', k.top, k.upper]] as const) {
      const g = levels[lv]?.grid;
      if (!g) { issues.push(`link ${k.id} ${name} level ${lv} missing`); continue; }
      const [cx, cy] = g.cellOf(p.x, p.z);
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || Math.abs(g.floorAt(p.x, p.z) - p.y) > 0.05) issues.push(`link ${k.id} ${name} landing not open on level ${lv}`);
      else if (!landingClear(g, cx, cy)) issues.push(`link ${k.id} ${name} landing smaller than 1.2 x 1.8 m`);
    }
    const ri = k.ramp;
    if (k.kind === 'stairs' && ri !== undefined) for (const lv of [k.lower, k.upper]) {
      const lg: Grid = levels[lv].grid;
      const R: Ramp | undefined = lg.ramps[ri];
      if (!R || lg.rampIdx[lg.idx(R.x, R.y)] !== ri) issues.push(`link ${k.id} ramp ${ri} not carved on level ${lv}`);
    }
  }
  // Railings on every well edge.
  const railed = new Set(layout.rails.map(r => `${r.level}:${r.x0}:${r.z0}:${r.x1}:${r.z1}`));
  if (deriveRails(levels).some(r => !railed.has(`${r.level}:${r.x0}:${r.z0}:${r.x1}:${r.z1}`))) issues.push('well edge without railing');
  // Placements on levels: on a walkable cell of their level, not on stairs / apertures, inside the band.
  const gridOf = (lv: number | undefined) => levels[lv ?? 0]?.grid ?? g0;
  for (const z of layout.zombies) {
    const g = gridOf(z.level), [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
    if (!g.inBounds(cx, cy) || g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) issues.push(`zombie on level ${z.level ?? 0} not on a flat floor`);
    else if (z.level && Math.abs((z.y ?? 0) - g.floorOf(i)) > 0.05) issues.push('zombie spawn height off its floor');
  }
  for (const p of layout.pickups) {
    if (!p.level) continue;
    const g = gridOf(p.level), [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
    if (!g.inBounds(cx, cy) || g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) issues.push(`pickup ${p.itemId} on level ${p.level} not on a flat floor`);
    else if (p.y < g.floorOf(i) - 1e-3 || p.y > g.ceil[i]) issues.push(`pickup ${p.itemId} floats on level ${p.level}`);
  }
  for (const p of layout.props) {
    if (!p.level) continue;
    const g = gridOf(p.level), [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
    if (!g.inBounds(cx, cy) || g.cells[i] !== FLOOR) { issues.push(`prop ${p.kind} on level ${p.level} off the floor`); continue; }
    if (g.rampIdx[i] >= 0) issues.push(`prop ${p.kind} on level ${p.level} on stairs`);
    if (p.y < g.floorOf(i) - 0.02) issues.push(`prop ${p.kind} on level ${p.level} sunk below its floor`);
    if (p.y + p.h > g.ceil[i] + 0.05) issues.push(`prop ${p.kind} on level ${p.level} through its ceiling`);
  }
  // Fixtures of level areas (and of stair cores / wells) hang inside a band of their column, above head height.
  for (const l of layout.lights) {
    const lv = l.level ?? levelOfArea(layout, l.area);
    const g = gridOf(lv), [cx, cy] = g.cellOf(l.x, l.z);
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    if (!lv && g0.rampIdx[i] < 0 && layout.areas[l.area]?.type !== 'stair-core' && g0.ceil[i] <= (layout.levelPlan?.hu ?? Infinity)) continue;
    let inBand = false;
    for (const L of levels) {
      const lg = L.grid;
      if (!isOpen(lg, i)) continue;
      const f = lg.floorAt(l.x, l.z), c = lg.ceilAt(l.x, l.z);
      if (l.y <= c + 1e-3 && l.y >= f + 1.9) { inBand = true; break; }
    }
    if (!inBand) issues.push(`light ${l.x.toFixed(1)},${l.y.toFixed(2)},${l.z.toFixed(1)} (level ${lv}) outside any band or below 1.9 m`);
  }
  // Reachability over every level from the player spawn.
  const [sx, sy] = g0.cellOf(layout.playerSpawn.x, layout.playerSpawn.z);
  const dd = dist ?? levelDistance(levels, sx, sy);
  // (The main level's own reachability is validateLayout's 'unreachable walkable cells'.)
  for (const L of levels) {
    if (!L.id) continue;
    const g = L.grid;
    let bad = 0;
    for (let y = by0; y < by1; y++) for (let i = y * AW + bx0, e = y * AW + bx1; i < e; i++) if (g.cells[i] === FLOOR && !g.blocked[i] && dd[L.id][i] < 0 && !(isOpen(g0, i) && dd[0][i] >= 0 && g0.rampIdx[i] >= 0)) bad++;
    if (bad) issues.push(`level ${L.id}: ${bad} walkable cells unreachable`);
  }
  return issues;
}

function isDoorCell(layout: StationLayout, level: number, i: number): boolean {
  const W = layout.grid.w, x = i % W, y = (i - x) / W;
  return layout.doors.some(d => (d.level ?? 0) === level && x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h);
}

/** A stand point lies on some level's walkable band at its height. */
function standOn(layout: StationLayout, p: {x: number; y: number; z: number}): boolean {
  for (const L of layout.levels) {
    const g = L.grid, [cx, cy] = g.cellOf(p.x, p.z);
    if (!g.inBounds(cx, cy) || !g.passable(cx, cy)) continue;
    if (Math.abs(g.floorAt(p.x, p.z) - p.y) <= 0.05) return true;
  }
  return false;
}

/** Flat walkable patch of ≥ 1.2 x 1.8 m (3 x 4 cells, either orientation) containing or touching the cell. */
function landingClear(g: Grid, cx: number, cy: number): boolean {
  const f = g.floorOf(g.idx(cx, cy));
  const flat = (x: number, y: number) => g.inBounds(x, y) && g.cells[g.idx(x, y)] === FLOOR && Math.abs(g.floorOf(g.idx(x, y)) - f) < 0.05;
  for (const [w, h] of [[3, 4], [4, 3]]) {
    for (let oy = -h + 1; oy <= 0; oy++) for (let ox = -w + 1; ox <= 0; ox++) {
      let ok = true;
      for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) if (!flat(cx + ox + x, cy + oy + y)) { ok = false; break; }
      if (ok) return true;
    }
  }
  return false;
}
