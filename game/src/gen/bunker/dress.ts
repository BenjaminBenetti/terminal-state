// Task studio-bunker-level-20261109-072224-01: THE BUNKER's own furnishing (world metres; pure data). Two passes round the ONE station
// dresser (gen/stationDress.ts dress: purposes / lights / loot holders / plates by room purpose, liftLevels):
//
//  BEFORE it — placeObjectives(): the pieces the dresser must furnish round (collision props, their fronts held clear through its pass):
//   - the VAULT DOOR: the Reactor's round blast door (REACTOR_X_KIT.blastDoor, standing open: gen/reactor/complex/bunkerKinds.ts BLAST)
//     in the bulkhead between the arrival hall and the vault vestibule — leaf + frame collision both sides, the 3-cell lane over the
//     raised threshold stays open (never a locked door: the exit is always free);
//   - the THREE AUXILIARY GENERATORS (BUNKER_GENERATOR_KIND, the Reactor's generator model) against a wall of the plant rooms of storeys
//     2 / 3 / 4, front (+Z, the control box) toward >= 2 m of clear floor;
//   - the CORE CLUSTER (BUNKER_CORE_KIND) against the processing hall's far wall on its long axis, >= 3 m clear in front.
//  AFTER it — dressShelter(): the shelter's own rooms through the Reactor shelter's room dressers (gen/reactor/complex/bunkerDress.ts:
//   barracks bunks + footlockers + lockers, mess tables + folding chairs, the armoury's gun lockers / crates, the radio / control
//   console, the air filtration units), the decontamination room, the muster hall's benches, the processing hall's rack rows, corridor
//   ducts, the plates (the shelter's name at the vault, the storey plates at every stair lobby, door plates in the shelter's words),
//   the aged wing's fallen ceiling panels; then the pocket sweep (no floor pocket anywhere).
// Every storage placed opens (footlockers, lockers, cabinets, crates, gun lockers: existing openables / holders, loot by the room's
// purpose); loose things move (folding chairs, benches are the dresser's own kinds); anchored plant is classified (bunkerKinds.ts).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../props';
import type {Area, Door, Side, StationLayout} from '../stationTypes';
import {begin, boxClear, cellsOfBox, commit, doorSide, makePlaceCtx, placeAgainstWall, propBlocksDoorway, rollback, tryPlaceProp, wallRange, wallSpot} from '../placeKit';
import {frontCells} from './validate';
import {BLAST} from '../reactor/complex/bunkerKinds';
import type {BunkerCarveRec} from '../reactor/complex/bunker';
import {
  NORMAL, OPP, armoury, ceilingDuct, coverCells, doorPlate, dormitory, face, filtration, mess, pocketCells, radioRoom, rotFacing, scanWall, sealOrDrop,
  solidProp, sweepPockets, wallSign, type Dx,
} from '../reactor/complex/bunkerDress';
import {BUNKER_CORE_KIND, BUNKER_GENERATOR_KIND} from './bunkerTypes';
import {BUNKER_HALL_PLATES, BUNKER_PLATES} from './programme';
import {BUNKER_BASES, BUNKER_CORE_LEVEL, BUNKER_STOREY_PLATES} from './frame';
import type {BunkerCarve} from './carve';
import {bunkerShortName} from './names';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** QA / tests: why hero placements (generators, the core cluster) were refused. */
export const HERO_FAILS: Record<string, number> = {};
/** QA / tests: what the last passes did. */
export const BUNKER_DRESS_STATS = {objectives: 0, generators: 0, core: 0, props: 0, signs: 0, decor: 0, dropped: 0, skipped: [] as string[]};

/** A Dx (the Reactor shelter's room-dresser context) over arbitrary areas of one storey. */
export function shelterDx(layout: StationLayout, lv: number, rng: Rng, areas: readonly Area[]): Dx {
  const g = layout.levels[lv].grid, base = BUNKER_BASES[lv];
  const win = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
  for (const a of areas) { win.x0 = Math.min(win.x0, a.x - 6); win.y0 = Math.min(win.y0, a.y - 6); win.x1 = Math.max(win.x1, a.x + a.w + 6); win.y1 = Math.max(win.y1, a.y + a.h + 6); }
  const ctx = makePlaceCtx(layout, rng.fork('ctx'), lv, Number.isFinite(win.x0) ? win : undefined);
  return {
    layout, rec: undefined as unknown as BunkerCarveRec, g, ctx, lv, base, rng,
    area: () => undefined,
    W: (u, v) => [r3(u * CELL), r3(v * CELL)],
    box: (u0, u1, v0, v1) => ({x0: Math.min(u0, u1) * CELL, z0: Math.min(v0, v1) * CELL, x1: Math.max(u0, u1) * CELL, z1: Math.max(v0, v1) * CELL}),
    decor: (m, b, y0, y1) => { layout.decor.push({m, x0: r3(b.x0), y0: r3(base + y0), z0: r3(b.z0), x1: r3(b.x1), y1: r3(base + y1), z1: r3(b.z1)}); },
    doors: a => ctx.doorsOf.get(a.id) ?? [],
    held: new Set<number>(),
  };
}

/** Lift every prop of storey lv >= 1 placed since `from` onto its cell floor (the placeKit local height frame; storey 0: finishTraversal). */
function liftFrom(layout: StationLayout, lv: number, from: number): void {
  if (!lv) return;
  const g = layout.levels[lv].grid;
  for (let i = from; i < layout.props.length; i++) {
    const p = layout.props[i];
    if ((p.level ?? 0) !== lv || p.host !== undefined) continue;
    const [cx, cy] = g.cellOf(p.x, p.z), k = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    p.y = r3(p.y + (k >= 0 && g.cells[k] === FLOOR && g.rampIdx[k] < 0 ? g.floorOf(k) : BUNKER_BASES[lv]));
  }
  for (let i = from; i < layout.props.length; i++) {
    const p = layout.props[i];
    if ((p.level ?? 0) !== lv || p.host === undefined) continue;
    p.y = r3(p.y + BUNKER_BASES[lv]);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Before the dresser

export interface ObjectiveRec {
  generators: {prop: number; level: number; area: number; label: string}[];
  core: {prop: number; level: number; area: number} | null;
  vaultProp: number;
  /** Cells the dresser (and the later passes) keep clear: the objectives' fronts, the threshold lane (per storey). */
  holds: {level: number; cells: number[]}[];
}

/** Cells of `a` (free floor, own area) in a world box. */
function cellsIn(layout: StationLayout, lv: number, a: Area, b: {x0: number; z0: number; x1: number; z1: number}): number[] {
  const g = layout.levels[lv].grid, out: number[] = [];
  const [c0, r0, c1, r1] = cellsOfBox((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2);
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    if (!g.inBounds(cx, cy)) continue;
    const i = g.idx(cx, cy);
    if (g.cells[i] === FLOOR && g.area[i] === a.id) out.push(i);
  }
  return out;
}

/** The cells of the strip `depth` m in front of a placed hero piece (whole cells beyond its body, `widen` cells past each end). */
export function heroFront(layout: StationLayout, p: PropPlacement, depth: number, widen = 0): number[] {
  const g = layout.levels[p.level ?? 0].grid;
  return frontCells(g, p, Math.ceil(depth / CELL - 1e-6), widen);
}

/**
 * A wall-backed hero piece in room `a`: every 0.25 m along each wall of `sides` (nearest `prefer` first), the placement primitive's
 * checks with a `front` access strip, its visible body sealed (sealOrDrop), the strip `keep` m deep in front (whole cells, its width)
 * all free floor of the room outside every doorway, the room still connected — each try in a placeKit transaction (a refused try
 * leaves no mask behind). Null when nothing fits.
 */
function heroAgainstWall(D: Dx, a: Area, kind: PropKind, sides: readonly Side[], front: number, keep: number, prefer?: (s: Side) => number): PropPlacement | null {
  const w = PROP_DEFS[kind].w;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd);
    const ts: number[] = [];
    for (let t = lo + w / 2 + 0.3; t <= hi - w / 2 - 0.3 + 1e-6; t += 0.25) ts.push(Math.round(t * 4) / 4);
    const c = prefer?.(sd) ?? (lo + hi) / 2;
    ts.sort((p, q) => Math.abs(p - c) - Math.abs(q - c) || p - q);
    for (const t of ts) {
      const sp = wallSpot(a, sd, t, kind);
      begin(D.ctx);
      const p = tryPlaceProp(D.ctx, a, kind, sp.x, sp.z, sp.rot, {front});
      if (!p) { HERO_FAILS.place = (HERO_FAILS.place ?? 0) + 1; rollback(D.ctx); continue; }
      if (!sealOrDrop(D, a, p)) { HERO_FAILS.seal = (HERO_FAILS.seal ?? 0) + 1; rollback(D.ctx); continue; }
      const fc = heroFront(D.layout, p, keep);
      const why = fc.some(i => D.g.cells[i] !== FLOOR || D.g.area[i] !== a.id) ? 'front-room' : fc.some(i => D.g.blocked[i]) ? 'front-blocked'
        : fc.some(i => D.ctx.doorCell[i]) ? 'front-door' : pocketCells(D, a).length ? 'pocket' : '';
      if (why) {
        HERO_FAILS[why] = (HERO_FAILS[why] ?? 0) + 1;
        // the body's sealed cells were free floor before this try: free them, then the transaction restores the rest
        const [c0, r0, c1, r1] = coverCells(p.x, p.z, p.hx, p.hz);
        for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) if (D.g.inBounds(cx, cy)) { const i = D.g.idx(cx, cy); D.g.blocked[i] = 0; D.g.sightBlocked[i] = 0; }
        rollback(D.ctx);
        continue;
      }
      commit(D.ctx);
      return p;
    }
  }
  return null;
}

/** The walls of `a` ordered for a hero piece: no door first, then the wall opposite the main door, then by fewest doors. */
function heroWalls(D: Dx, a: Area): Side[] {
  const doors = D.doors(a);
  const main = doors.find(d => d.a === a.parent || d.b === a.parent) ?? doors[0];
  const ms = main ? doorSide(main, a) : 'S';
  const count = (s: Side) => doors.filter(d => doorSide(d, a) === s).length;
  const len = (s: Side) => (s === 'N' || s === 'S' ? a.w : a.h);
  return (['N', 'S', 'W', 'E'] as Side[]).sort((p, q) => count(p) - count(q) || +(q === OPP[ms]) - +(p === OPP[ms]) || len(q) - len(p));
}

/** The vault door's collision pieces + lane trims (storey 0; the bulkhead's model pose from the carve). */
function vaultDoor(D: Dx, bc: BunkerCarve): number {
  const {ox, oz, lane, steps} = bc.bulkhead;
  // rot PI: model (x, z) -> world (ox - x, oz - z)
  const mbox = (x0: number, x1: number, z0: number, z1: number) => ({x0: ox - Math.max(x0, x1), x1: ox - Math.min(x0, x1), z0: oz - Math.max(z0, z1), z1: oz - Math.min(z0, z1)});
  const zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2, half = lane.h / 2 * CELL;
  const frontFace = zc + half, backFace = zc - half;
  const lx0 = BLAST.openX - BLAST.laneHalf, lx1 = BLAST.openX + BLAST.laneHalf;
  const hall = bc.hall, vest = bc.vest;
  const hFront = Math.min(BLAST.bodyH, hall.ceil) - 0.05, hBack = Math.min(BLAST.bodyH, vest.ceil) - 0.05;
  const leaf = solidProp(D, 'blastDoor', hall, mbox(BLAST.leaf.x[0], BLAST.leaf.x[1], BLAST.leaf.z[0], BLAST.leaf.z[1]), BLAST.leaf.h, Math.PI, 0, true);
  const idx = D.layout.props.indexOf(leaf);
  solidProp(D, 'blastDoor', hall, mbox(-BLAST.halfW, lx0, frontFace, BLAST.frontFeetZ), hFront, 0, 1, true);
  solidProp(D, 'blastDoor', hall, mbox(lx1, BLAST.halfW, frontFace, BLAST.frontFeetZ), hFront, 0, 1, true);
  solidProp(D, 'blastDoor', vest, mbox(-BLAST.halfW, lx0, BLAST.backPlinthZ, backFace), hBack, 0, 1, true);
  solidProp(D, 'blastDoor', vest, mbox(lx1, BLAST.halfW, BLAST.backPlinthZ, backFace), hBack, 0, 1, true);
  // the lane through the bulkhead: steel lining on both jambs (above the threshold), tread plates on the risers, amber nosings
  const sill = BLAST.sill, top = sill + 2.26;
  const x0 = lane.x * CELL, x1 = (lane.x + lane.w) * CELL, z0 = lane.y * CELL, z1 = (lane.y + lane.h) * CELL;
  D.decor('shopFrame', {x0, x1: x0 + 0.02, z0, z1}, sill, top);
  D.decor('shopFrame', {x0: x1 - 0.02, x1, z0, z1}, sill, top);
  for (const s of steps) {
    const y = r3(s.n * sill / 3);
    D.decor('steelDark', {x0, x1, z0: s.y * CELL, z1: (s.y + 1) * CELL}, y, y + 0.012);
  }
  D.decor('plasticSeat', {x0, x1, z0: steps[0].y * CELL, z1: steps[0].y * CELL + 0.05}, r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
  D.decor('plasticSeat', {x0, x1, z0: (steps[steps.length - 1].y + 1) * CELL - 0.05, z1: (steps[steps.length - 1].y + 1) * CELL}, r3(sill / 3) - 0.005, r3(sill / 3) + 0.014);
  return idx;
}

/** The pieces the station dresser furnishes round (before it runs). */
export function placeObjectives(layout: StationLayout, bc: BunkerCarve, rng: Rng): ObjectiveRec | null {
  const S = BUNKER_DRESS_STATS;
  S.objectives = S.generators = S.core = 0;
  S.skipped = [];
  const holds: ObjectiveRec['holds'] = [];
  // the vault door + the threshold lane held clear on both sides
  const D0 = shelterDx(layout, 0, rng.fork('vault'), [bc.hall, bc.vest]);
  const vaultProp = vaultDoor(D0, bc);
  {
    const g = layout.levels[0].grid, cells: number[] = [];
    const {lane, steps} = bc.bulkhead;
    for (const s of [{y: steps[0].y - 1}, ...steps, {y: steps[steps.length - 1].y + 1}]) for (let x = lane.x - 1; x <= lane.x + lane.w; x++) if (g.inBounds(x, s.y)) cells.push(g.idx(x, s.y));
    holds.push({level: 0, cells: cells.filter(i => g.cells[i] === FLOOR && !g.blocked[i])});
  }
  // the generators: one per plant room of storeys 2 / 3 / 4 (contract ids gen-0 .. gen-2 in that order)
  const generators: ObjectiveRec['generators'] = [];
  for (const st of bc.storeys) {
    const id = st.area.genroom;
    if (id === undefined) continue;
    const a = layout.areas[id];
    const D = shelterDx(layout, st.level, rng.fork(`gen-${st.level}`), [a]);
    const p = heroAgainstWall(D, a, BUNKER_GENERATOR_KIND, heroWalls(D, a), 1.0, 2.0);
    if (!p) { S.skipped.push(`generator L${st.level}`); return null; }
    p.y = 0;
    generators.push({prop: layout.props.indexOf(p), level: st.level, area: a.id, label: a.label});
    holds.push({level: st.level, cells: heroFront(layout, p, 2.0, 1).filter(i => { const g = layout.levels[st.level].grid; return g.cells[i] === FLOOR && g.area[i] === a.id && !g.blocked[i]; })});
    S.generators++;
  }
  // the core cluster: the processing hall's far wall, centred on its long axis
  let core: ObjectiveRec['core'] = null;
  {
    const st = bc.storeys.find(s => s.level === BUNKER_CORE_LEVEL);
    const id = st?.area.hall;
    if (st && id !== undefined) {
      const a = layout.areas[id];
      const D = shelterDx(layout, st.level, rng.fork('core'), [a]);
      const shorts: Side[] = a.w >= a.h ? ['W', 'E'] : ['N', 'S'];
      const walls = heroWalls(D, a);
      const order = [...walls.filter(s => shorts.includes(s)), ...walls.filter(s => !shorts.includes(s))];
      const p = heroAgainstWall(D, a, BUNKER_CORE_KIND, order, 1.2, 3.0);
      if (!p) { S.skipped.push('core cluster'); return null; }
      p.y = 0;
      core = {prop: layout.props.indexOf(p), level: st.level, area: a.id};
      holds.push({level: st.level, cells: heroFront(layout, p, 3.0, 1).filter(i => { const g = layout.levels[st.level].grid; return g.cells[i] === FLOOR && g.area[i] === a.id && !g.blocked[i]; })});
      S.core = 1;
    }
  }
  if (generators.length !== 3 || !core) return null;
  S.objectives = generators.length + 1;
  return {generators, core, vaultProp, holds};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// After the dresser

/** The decontamination room: wash troughs, suit lockers, a bench, a bin. */
function decon(D: Dx, a: Area): void {
  const ms = heroWalls(D, a).reverse()[0];
  const back = OPP[ms], sides: Side[] = ms === 'N' || ms === 'S' ? ['W', 'E'] : ['N', 'S'];
  for (let i = 0; i < 2; i++) scanWall(D, a, 'washCounter', [back, ...sides], 0.7, undefined, true);
  for (let i = 0; i < 3; i++) scanWall(D, a, 'staffLockers', sides, 1.0, undefined, true);
  scanWall(D, a, 'bench', sides, 0.6, undefined, true);
  scanWall(D, a, 'bin', [back, ...sides], 0, undefined, true);
}

/** The muster hall: rows of benches facing the hall's notice wall, a notice board, lockers along a side wall. */
function musterHall(D: Dx, a: Area): void {
  const horiz = a.w >= a.h;
  const bench = PROP_DEFS.bench;
  const x0 = a.x * CELL + 2.0, x1 = (a.x + a.w) * CELL - 2.0, z0 = a.y * CELL + 2.0, z1 = (a.y + a.h) * CELL - 2.0;
  let n = 0;
  // benches in rows across the short axis, every 1.6 m along the long one, a 2 m aisle down the middle
  const mid = horiz ? (z0 + z1) / 2 : (x0 + x1) / 2;
  for (let l = (horiz ? x0 : z0) + 1.0; l <= (horiz ? x1 : z1) - 1.0 && n < 14; l += 1.6) {
    for (const off of [-1, 1]) {
      const c = mid + off * (1.0 + bench.w / 2);
      const x = horiz ? l : c, z = horiz ? c : l;
      if (tryPlaceProp(D.ctx, a, 'bench', Math.round(x * 4) / 4, Math.round(z * 4) / 4, horiz ? Math.PI / 2 : 0, {ring: 0.5})) n++;
    }
  }
  placeAgainstWall(D.ctx, a, 'noticeBoard', {y: 1.1, tries: 16});
  for (let i = 0; i < 2; i++) scanWall(D, a, 'staffLockers', horiz ? ['N', 'S'] : ['W', 'E'], 1.0, undefined, true);
}

/** The processing hall: rows of server racks along the long axis either side of the central aisle to the core cluster, data cabinets. */
function processingHall(D: Dx, a: Area, coreProp: PropPlacement | null): void {
  const horiz = a.w >= a.h;
  const rack = PROP_DEFS.serverRack;
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  const L0 = (horiz ? ax0 : az0) + 3.0, L1 = (horiz ? ax1 : az1) - 3.0;
  const C0 = horiz ? az0 : ax0, C1 = horiz ? az1 : ax1, cm = (C0 + C1) / 2;
  // the aisle centre: the core cluster's axis when it stands on a short wall
  const aisle = coreProp ? (horiz ? coreProp.z : coreProp.x) : cm;
  let n = 0;
  // rows either side of the central aisle (2.4 m to the cluster): the inner rows face the aisle, then back-to-back pairs facing out
  // across 1.6 m service aisles, as long as a row keeps 1.2 m off the side walls
  const offs: [number, 1 | -1][] = [];
  for (let k = 0, c = 1.2 + rack.d / 2; k < 4; k++) {
    const facing: 1 | -1 = k % 2 === 0 ? -1 : 1; // -1: front toward the aisle
    offs.push([c, facing]);
    c += k % 2 === 0 ? rack.d : rack.d + 1.6;
  }
  for (const [o, facing] of offs) for (const sgn of [-1, 1] as const) {
    const c = aisle + sgn * o;
    if (c - rack.d / 2 < C0 + 1.2 || c + rack.d / 2 > C1 - 1.2) continue;
    // the prop's front (sin rot, cos rot) points toward the aisle (facing -1) or away from it (+1)
    const dir = sgn * facing;
    const rot = horiz ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    // a rack row (0.6 m units) with a 1.2 m cross gap every 4 racks
    let k = 0;
    for (let l = L0; l <= L1 - rack.w; l += rack.w + (++k % 4 === 0 ? 1.2 : 0)) {
      const t = l + rack.w / 2;
      const x = horiz ? t : c, z = horiz ? c : t;
      if (tryPlaceProp(D.ctx, a, 'serverRack', r3(x), r3(z), rot, {laneOk: true})) n++;
    }
  }
  if (n < 8) BUNKER_DRESS_STATS.skipped.push(`processing hall: ${n} racks`);
  for (let i = 0; i < 3; i++) placeAgainstWall(D.ctx, a, 'cabinetLow', {front: 0.7, tries: 16});
}

/** Fallen ceiling panels and a hanging duct section in an aged room (decor only, low slabs: no blocked passage). */
function agedDecor(D: Dx, a: Area): void {
  const rng = D.rng;
  /** A decor box (world x / z, local y) that keeps every doorway's clear volume and every prop's body clear. */
  const put = (m: Parameters<Dx['decor']>[0], b: {x0: number; z0: number; x1: number; z1: number}, y0: number, y1: number): boolean => {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    if (propBlocksDoorway(D.layout, cx, cz, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base + y0, y1 - y0)) return false;
    if (!boxClear(D.ctx, b.x0, b.x1, D.base + y0, D.base + y1, b.z0, b.z1)) return false;
    D.decor(m, b, y0, y1);
    return true;
  };
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const w = rng.range(0.9, 1.6), d = rng.range(0.6, 1.2);
    const x = (a.x + 1) * CELL + rng.next() * Math.max(0.1, a.w * CELL - 2 * CELL - w), z = (a.y + 1) * CELL + rng.next() * Math.max(0.1, a.h * CELL - 2 * CELL - d);
    if (!cellsIn(D.layout, D.lv, a, {x0: x, z0: z, x1: x + w, z1: z + d}).every(c => !D.ctx.doorCell[c])) continue;
    put('panel', {x0: x, z0: z, x1: x + w, z1: z + d}, 0, 0.05);
  }
  const rel = a.ceil - D.base;
  if (rel > 3) {
    const s: Side = a.w >= a.h ? 'N' : 'W';
    const [lo, hi] = wallRange(a, s);
    const t = lo + (hi - lo) * rng.range(0.3, 0.7);
    const fc = face(a, s), [nx, nz] = NORMAL[s];
    const b = s === 'N' ? {x0: t - 1.0, x1: t + 1.0, z0: fc - nz * 0.1, z1: fc - nz * 0.55} : {x0: fc - nx * 0.1, x1: fc - nx * 0.55, z0: t - 1.0, z1: t + 1.0};
    put('steelBright', {x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), z0: Math.min(b.z0, b.z1), z1: Math.max(b.z0, b.z1)}, rel - 1.4, rel - 1.05);
  }
}

/** The shelter's own furnishing, plates and decor (after the station dresser; `keep` = the objectives' held fronts). */
export function dressShelter(layout: StationLayout, bc: BunkerCarve, rng: Rng, obj: ObjectiveRec, aged: ReadonlySet<number>): void {
  const S = BUNKER_DRESS_STATS;
  const p0 = layout.props.length, s0 = layout.signs.length, d0 = layout.decor.length;
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { S.skipped.push(`${name}: ${(e as Error).message}`); } };
  const coreProp = obj.core ? layout.props[obj.core.prop] : null;
  // --- storey 0: the vault plates, the platform plates ------------------------------------------------------------------------------
  {
    const D = shelterDx(layout, 0, rng.fork('station'), [bc.platform, bc.hall, bc.vest]);
    const name = bunkerShortName(layout.name).toUpperCase();
    const lc = (bc.bulkhead.lane.x + 1.5) * CELL;
    step('vault-plates', () => {
      wallSign(D, bc.hall, 'S', lc, 4.42, {kind: 'service', text: name, w: Math.min(3.6, 0.9 + name.length * 0.16)});
      wallSign(D, bc.hall, 'S', lc - 3.6, 1.9, {kind: 'service', text: 'CIVIL DEFENCE · AUTHORISED ENTRY', w: 1.9});
      wallSign(D, bc.hall, 'S', lc + 3.6, 1.9, {kind: 'service', text: 'KEEP BLAST DOOR CLEAR', w: 1.6});
      wallSign(D, bc.vest, 'N', lc + 3.6, 1.9, {kind: 'service', text: 'EXIT · STATION', w: 1.4});
      for (const o of bc.openings) wallSign(D, bc.platform, 'S', (o.x + o.w / 2) * CELL, 3.6, {kind: 'service', text: `${name} · WAY IN`, w: 2.4});
      const L0 = bc.cores[0].landing[0];
      const dl = layout.doors.find(d => d.b === L0.area && d.a === bc.vest.id);
      if (dl) doorPlate(D, dl, bc.vest, 'MAIN STAIR · LEVELS 1-5', 2.0);
    });
  }
  // --- storeys 1..5 --------------------------------------------------------------------------------------------------------------
  for (const st of bc.storeys) {
    const lv = st.level;
    const areas = Object.values(st.area).map(id => layout.areas[id]);
    const D = shelterDx(layout, lv, rng.fork(`shelter-${lv}`), areas);
    // the objectives' fronts stay clear of everything placed here
    for (const h of obj.holds) if (h.level === lv) for (const i of h.cells) D.ctx.keep[i] = 1;
    const from = layout.props.length;
    for (const [key, id] of Object.entries(st.area)) {
      const a = layout.areas[id];
      const k = key.replace(/\d+$/, '');
      if (k === 'dorm') step(`L${lv} ${key}`, () => dormitory(D, a));
      else if (k === 'mess') step(`L${lv} ${key}`, () => mess(D, a));
      else if (k === 'armoury') step(`L${lv} ${key}`, () => armoury(D, a));
      else if (k === 'radio' || k === 'control') step(`L${lv} ${key}`, () => radioRoom(D, a));
      else if (k === 'filtration' || k === 'cooling') step(`L${lv} ${key}`, () => filtration(D, a));
      else if (k === 'decon') step(`L${lv} ${key}`, () => decon(D, a));
      else if (k === 'hall' && lv === 1) step(`L${lv} muster`, () => musterHall(D, a));
      else if (k === 'hall' && lv === BUNKER_CORE_LEVEL) step(`L${lv} processing`, () => processingHall(D, a, coreProp));
      if (a.kind === 'service' && key !== 'muster' && key !== 'lobbyB') step(`L${lv} duct ${key}`, () => {
        const longs: Side[] = a.w >= a.h ? ['N', 'S'] : ['W', 'E'];
        longs.sort((s, t) => D.doors(a).filter(d => doorSide(d, a) === s).length - D.doors(a).filter(d => doorSide(d, a) === t).length);
        ceilingDuct(D, a, longs[0]);
      });
      if (aged.has(a.id)) step(`L${lv} aged ${key}`, () => agedDecor(D, a));
    }
    // plates: the storey at both stair lobbies, every room's door in the shelter's words, the generator rooms numbered
    step(`L${lv} plates`, () => {
      for (const [key, c] of [['muster', bc.cores[0]], ['lobbyB', bc.cores[1]]] as const) {
        const lob = layout.areas[st.area[key]], land = layout.areas[c.landing[lv].area];
        const d = D.doors(lob).find(q => q.a === land.id || q.b === land.id);
        if (d) doorPlate(D, d, lob, `${BUNKER_STOREY_PLATES[lv]}`, 2.4);
      }
      for (const [key, id] of Object.entries(st.area)) {
        const a = layout.areas[id];
        const gi = obj.generators.findIndex(gr => gr.area === id);
        const text = gi >= 0 ? `AUX GENERATOR ${gi + 1} · DANGER` : key === 'hall' ? BUNKER_HALL_PLATES[lv] : BUNKER_PLATES[key.replace(/(\D)\d+$/, '$1')] ?? BUNKER_PLATES[key];
        if (!text) continue;
        const ds = D.doors(a);
        const d = ds.find(q => q.a === a.parent || q.b === a.parent) ?? ds[0];
        if (!d) continue;
        const outside = layout.areas[d.a === a.id ? d.b : d.a];
        // the dresser's stock plate by this door (STAFF ONLY / its purpose's words) gives way to the shelter's own
        const near = new Set(layout.signs.filter(sg => sg.area === outside.id && sg.kind === 'service' && Math.hypot(sg.x - (d.x + d.w / 2) * CELL, sg.z - (d.y + d.h / 2) * CELL) < 2.6));
        if (near.size) layout.signs = layout.signs.filter(sg => !near.has(sg));
        if (!doorPlate(D, d, outside, text, text.length > 14 ? 2.0 : 1.4) && text.length > 14) doorPlate(D, d, outside, text, 1.4);
      }
    });
    liftFrom(layout, lv, from);
    // the guarantee: no floor pocket anywhere on the storey (a prop of these passes that closes one off goes again)
    const n0 = layout.props.length;
    sweepPockets(D, areas, from);
    S.dropped += Math.max(0, n0 - layout.props.length);
  }
  S.props = layout.props.length - p0; S.signs = layout.signs.length - s0; S.decor = layout.decor.length - d0;
}

/** The generator / core props must face their room (quarter-turn yaw): the prop convention's front = (sin rot, cos rot). */
export function frontOf(p: Pick<PropPlacement, 'rot'>): [number, number] {
  return [Math.round(Math.sin(p.rot)), Math.round(Math.cos(p.rot))];
}

/** Door of `a` onto its parent (its main door), if any. */
export function mainDoor(layout: StationLayout, a: Area): Door | undefined {
  return layout.doors.find(d => (d.a === a.parent && d.b === a.id) || (d.b === a.parent && d.a === a.id)) ?? layout.doors.find(d => d.a === a.id || d.b === a.id);
}

export {rotFacing};
