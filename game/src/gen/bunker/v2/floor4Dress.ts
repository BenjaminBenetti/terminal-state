// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 4's own dressing (after the station dresser; ./floor4.ts carves).
// World metres on this storey's grid, heights relative to its floor (the pipeline lifts the props placed here onto it). A few strong
// compositions, never clutter:
//
//  - the RESERVOIR HALL: the cistern — a walled water tank filling the hall's middle (a walkway all round), its roof columns standing in
//    the dark water, the inlet mains dropping in from the ceiling;
//  - WATER TREATMENT: the long sand-filter bed and the settling basin (low walled troughs of dark water), pressure filter vessels;
//  - the PUMP HALL: two rows of big pumps on plinths either side of the central aisle (the storey's axis: freight hall → core gallery),
//    their discharge mains running overhead, the travelling crane's rails high on the walls;
//  - the CORE GALLERY / WEST CATWALK / COOLING FEED GALLERY round the V45 well: an amber safety line and grating along the rim, the
//    feed gallery's operator console turned to the drop, plates;
//  - the BOILER HOUSE: two boilers with their flues; the AUXILIARY POWER ROOM: the diesel day tank on its bund, a cable trench;
//  - the FREIGHT HALL: the loading bay's hazard-striped lift apron, a gantry beam, hand trucks / pallet jack;
//  - the CHLORINATION ROOM (the strong leak): chlorine cylinder carts, warning plates;
//  - the DRAINAGE WING (aged, flooded): standing water, a walled sump pit, fallen ceiling panels.
// Machinery bodies are layout.decor over collision-only 'annexMachine' footprints (the shelter's own pattern: gen/reactor/complex
// bunkerDress.ts dayTank); every model / loose kind is an existing classified kind; nothing here stores loot. Doorway clear volumes,
// the held cells (anchor aprons, the generator's front) and every area's connectivity are respected (placeKit / freeFor).

import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, LightPlacement, Side} from '../../stationTypes';
import type {ShopMat} from '../../storefronts';
import {boxClear, doorSide, placeAgainstWall, propBlocksDoorway, tryPlaceProp, wallRange} from '../../placeKit';
import {NORMAL, face, freeFor, island, pocketCells, scanWall, sealOrDrop, solidProp, sweepPockets, wallBox, wallSign, doorPlate, filtration, type Dx} from '../../reactor/complex/bunkerDress';
import {BUNKER_GENERATOR_KIND} from '../bunkerTypes';
import {shelterDx} from '../dress';
import type {FloorDressCtx} from './floorApi';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
type Box = {x0: number; z0: number; x1: number; z1: number};
const B = (x0: number, z0: number, x1: number, z1: number): Box => ({x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1)});

/** QA / tests: what the last storey-4 dress did. */
export const FLOOR4_DRESS_STATS = {props: 0, decor: 0, lights: 0, signs: 0, tanks: 0, pumps: 0, boilers: 0, skipped: [] as string[]};

/** A room's world rect. */
const W = (a: Area): Box => ({x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL});
const rel = (D: Dx, a: Area) => a.ceil - D.base;

/** A decor box that keeps every doorway's clear volume and every prop's body clear (false = skipped). */
function put(D: Dx, m: ShopMat, b: Box, y0: number, y1: number): boolean {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  if (propBlocksDoorway(D.layout, cx, cz, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base + y0, y1 - y0)) return false;
  if (!boxClear(D.ctx, b.x0, b.x1, D.base + y0, D.base + y1, b.z0, b.z1)) return false;
  D.decor(m, b, y0, y1);
  return true;
}

/** A ceiling fixture of area `a` at (x, z) (steady unless the pipeline ages the room later). */
function light(D: Dx, a: Area, x: number, z: number, rot: number, warm = false, power = 0.9): void {
  const lt: LightPlacement = {x: r3(x), y: r3(a.ceil - 0.05), z: r3(z), rot, area: a.id, broken: false, flicker: false, warm, power, dying: false, level: D.lv};
  D.layout.lights.push(lt);
  FLOOR4_DRESS_STATS.lights++;
}

/**
 * A walled water basin over the world box `b` (snapped to whole cells): collision-only footprint (low: never blocks sight), four walls
 * `wallH` tall, dark water to `water` with a sheen. False when its cells are not this area's free floor or the area would split.
 */
function basin(D: Dx, a: Area, b: Box, wallH: number, water: number, mat: ShopMat = 'panel'): boolean {
  const s = (v: number) => Math.round(v / CELL) * CELL;
  const q = B(s(b.x0), s(b.z0), s(b.x1), s(b.z1));
  if (q.x1 - q.x0 < 2 || q.z1 - q.z0 < 2) return false;
  if (!freeFor(D, a, {x0: q.x0 + 0.05, z0: q.z0 + 0.05, x1: q.x1 - 0.05, z1: q.z1 - 0.05})) return false;
  if (propBlocksDoorway(D.layout, (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, (q.x1 - q.x0) / 2, (q.z1 - q.z0) / 2, D.base, wallH)) return false;
  solidProp(D, 'annexMachine', a, q, wallH, 0, 0, false);
  const t = 0.3;
  D.decor(mat, {x0: q.x0, x1: q.x1, z0: q.z0, z1: q.z0 + t}, 0, wallH);
  D.decor(mat, {x0: q.x0, x1: q.x1, z0: q.z1 - t, z1: q.z1}, 0, wallH);
  D.decor(mat, {x0: q.x0, x1: q.x0 + t, z0: q.z0 + t, z1: q.z1 - t}, 0, wallH);
  D.decor(mat, {x0: q.x1 - t, x1: q.x1, z0: q.z0 + t, z1: q.z1 - t}, 0, wallH);
  const inner = {x0: q.x0 + t, x1: q.x1 - t, z0: q.z0 + t, z1: q.z1 - t};
  D.decor('black', inner, 0, water);
  D.decor('glassShopfront', inner, water, water + 0.015);
  FLOOR4_DRESS_STATS.tanks++;
  return true;
}

/** A free-standing machine body (decor box + collision-only footprint, snapped to cells). */
function machine(D: Dx, a: Area, b: Box, h: number, m: ShopMat, sight = true): boolean {
  const s = (v: number) => Math.round(v / CELL) * CELL;
  const q = B(s(b.x0), s(b.z0), s(b.x1), s(b.z1));
  if (q.x1 <= q.x0 || q.z1 <= q.z0) return false;
  if (!freeFor(D, a, {x0: q.x0 + 0.05, z0: q.z0 + 0.05, x1: q.x1 - 0.05, z1: q.z1 - 0.05})) return false;
  if (propBlocksDoorway(D.layout, (q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2, (q.x1 - q.x0) / 2, (q.z1 - q.z0) / 2, D.base, h)) return false;
  solidProp(D, 'annexMachine', a, q, h, 0, 0, sight);
  D.decor(m, q, 0, h);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The halls

/** The cistern: a walled tank over the hall's middle (a walkway >= 2.5 m all round), roof columns in the water, inlet mains. */
function reservoir(D: Dx, a: Area): void {
  const w = W(a), top = rel(D, a);
  let tank: Box | null = null;
  for (const inset of [3.0, 3.5, 4.0, 4.5]) {
    const b = B(w.x0 + inset, w.z0 + inset, w.x1 - inset, w.z1 - inset);
    if (basin(D, a, b, 1.1, 0.8)) { tank = b; break; }
  }
  if (!tank) { FLOOR4_DRESS_STATS.skipped.push('reservoir tank'); return; }
  // roof columns standing in the water (2 rows), the coping band at the top of each, cross beams over the tank
  const nx = Math.max(2, Math.round((tank.x1 - tank.x0) / 5)), xs: number[] = [];
  for (let i = 1; i < nx; i++) xs.push(tank.x0 + (tank.x1 - tank.x0) * i / nx);
  const zs = [tank.z0 + (tank.z1 - tank.z0) / 3, tank.z0 + (tank.z1 - tank.z0) * 2 / 3];
  for (const x of xs) for (const z of zs) D.decor('panel', B(x - 0.3, z - 0.3, x + 0.3, z + 0.3), 0.8, top);
  for (const z of zs) D.decor('steelDark', B(tank.x0, z - 0.2, tank.x1, z + 0.2), top - 0.45, top);
  // the inlet mains: a header along the hall's north wall under the ceiling, two drops into the tank
  const hz = w.z0 + 0.5;
  put(D, 'steelBright', B(w.x0 + 1.0, hz - 0.22, w.x1 - 1.0, hz + 0.22), top - 1.2, top - 0.75);
  for (const x of [tank.x0 + 1.5, tank.x1 - 1.5]) {
    D.decor('steelBright', B(x - 0.2, hz + 0.22, x + 0.2, tank.z0 + 0.6), top - 1.2, top - 0.8);
    D.decor('steelBright', B(x - 0.2, tank.z0 + 0.4, x + 0.2, tank.z0 + 0.8), 1.3, top - 0.8);
  }
  // a depth gauge board and the plates
  wallSign(D, a, 'N', (tank.x0 + tank.x1) / 2, 2.3, {kind: 'service', text: 'POTABLE WATER RESERVOIR · NO ENTRY', w: 2.6});
  wallSign(D, a, 'S', (tank.x0 + tank.x1) / 2, 2.3, {kind: 'service', text: 'RESERVOIR LEVEL · CHECK EVERY SHIFT', w: 2.4});
}

/** Water treatment: the long sand-filter bed along a wall without doors, the settling basin, pressure filter vessels. */
function treatment(D: Dx, a: Area): void {
  const w = W(a);
  const walls = wallsByDoors(D, a);
  // the filter bed: a 2.4 m deep trough along the quietest wall (the longest free run of it: 11 m down to 6 m), a pipe rail on its edge
  let beds = 0;
  for (const len of [11, 9, 7.5, 6]) {
    for (const sd of walls) {
      if (beds) break;
      const [lo, hi] = wallRange(a, sd);
      for (const off of [0.6, 1.1]) {
        if (beds) break;
        for (let t = lo + 1.5; t + len <= hi - 1.5 + 1e-6 && !beds; t += 0.5) {
          if (!basin(D, a, wallBox(a, sd, t, t + len, off, off + 2.4), 1.0, 0.7)) continue;
          D.decor('steelDark', wallBox(a, sd, t, t + len, off + 2.3, off + 2.4), 1.0, 1.1);
          beds++;
        }
      }
    }
    if (beds) break;
  }
  if (!beds) FLOOR4_DRESS_STATS.skipped.push('treatment: filter bed');
  // the settling basin: a square trough in the room's middle half
  const cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
  let settled = false;
  for (const d of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
    if (basin(D, a, B(cx + d[0] - 2.5, cz + d[1] - 2.0, cx + d[0] + 2.5, cz + d[1] + 2.0), 0.9, 0.6)) { settled = true; break; }
  }
  if (!settled) FLOOR4_DRESS_STATS.skipped.push('treatment: settling basin');
  // pressure filter vessels (the heater tanks' tall cylinders) along a free wall
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'waterHeaterTank', {front: 0.8, tries: 16, sides: walls.slice(1)});
  wallSign(D, a, walls[walls.length - 1], wallMid(a, walls[walls.length - 1]), 2.4, {kind: 'service', text: 'WATER TREATMENT · SAND FILTERS', w: 2.2});
}

/** The pump hall: two rows of pumps on plinths along the long axis, their discharge mains overhead, the crane rails. */
function pumpHall(D: Dx, a: Area): void {
  const w = W(a), top = rel(D, a);
  const alongZ = a.h >= a.w;
  const def = PROP_DEFS.bunkerCoolantPump;
  const cA = alongZ ? (w.x0 + w.x1) / 2 : (w.z0 + w.z1) / 2;
  const L0 = (alongZ ? w.z0 : w.x0) + 3.5, L1 = (alongZ ? w.z1 : w.x1) - 3.5;
  const off = 1.75 + def.d / 2;
  const rows: {c: number; zs: number[]}[] = [];
  for (const sgn of [-1, 1]) {
    const c = Math.round((cA + sgn * off) * 4) / 4;
    const got: number[] = [];
    for (let t = L0 + def.w / 2; t + def.w / 2 <= L1 + 1e-6; t += def.w + 1.25) {
      const tt = Math.round(t * 4) / 4;
      // the pump's front faces the aisle
      const rot = alongZ ? (sgn < 0 ? Math.PI / 2 : -Math.PI / 2) : (sgn < 0 ? 0 : Math.PI);
      const x = alongZ ? c : tt, z = alongZ ? tt : c;
      const p = tryPlaceProp(D.ctx, a, 'bunkerCoolantPump', x, z, rot, {ring: 0.5});
      if (!p || !sealOrDrop(D, a, p)) continue;
      p.y = 0.15;
      // its plinth
      D.decor('panel', B(p.x - p.hx - 0.15, p.z - p.hz - 0.15, p.x + p.hx + 0.15, p.z + p.hz + 0.15), 0, 0.15);
      got.push(tt);
      FLOOR4_DRESS_STATS.pumps++;
    }
    if (got.length) rows.push({c, zs: got});
  }
  // the discharge mains: a header over each row, a riser down to every pump
  const yH = Math.min(4.6, top - 1.2);
  for (const r of rows) {
    const t0 = r.zs[0] - 1.0, t1 = r.zs[r.zs.length - 1] + 1.0;
    D.decor('steelBright', alongZ ? B(r.c - 0.25, t0, r.c + 0.25, t1) : B(t0, r.c - 0.25, t1, r.c + 0.25), yH, yH + 0.5);
    for (const t of r.zs) D.decor('steelBright', alongZ ? B(r.c - 0.15, t - 0.15, r.c + 0.15, t + 0.15) : B(t - 0.15, r.c - 0.15, t + 0.15, r.c + 0.15), 0.15 + def.h - 0.1, yH);
  }
  // the travelling crane: two rails high on the long walls, the gantry girder parked over the aisle's north end
  if (top > 5.5) {
    const yR = top - 0.7;
    if (alongZ) {
      D.decor('steelDark', B(w.x0, w.z0 + 0.5, w.x0 + 0.35, w.z1 - 0.5), yR, yR + 0.35);
      D.decor('steelDark', B(w.x1 - 0.35, w.z0 + 0.5, w.x1, w.z1 - 0.5), yR, yR + 0.35);
      const gz = w.z0 + 2.2;
      D.decor('plasticSeat', B(w.x0 + 0.35, gz - 0.35, w.x1 - 0.35, gz + 0.35), yR - 0.1, yR + 0.45);
      D.decor('steelDark', B((w.x0 + w.x1) / 2 - 0.5, gz - 0.45, (w.x0 + w.x1) / 2 + 0.5, gz + 0.45), yR - 0.75, yR - 0.1);
    } else {
      D.decor('steelDark', B(w.x0 + 0.5, w.z0, w.x1 - 0.5, w.z0 + 0.35), yR, yR + 0.35);
      D.decor('steelDark', B(w.x0 + 0.5, w.z1 - 0.35, w.x1 - 0.5, w.z1), yR, yR + 0.35);
    }
  }
  // the nave's structural rhythm: steel pilasters up the long walls every ~5 m carrying the crane rails (flush, clear of doorways / props)
  for (const sd of (alongZ ? ['W', 'E'] : ['N', 'S']) as Side[]) {
    const [lo, hi] = wallRange(a, sd);
    for (let t = lo + 3.0; t <= hi - 2.5; t += 6) put(D, 'steelDark', wallBox(a, sd, t - 0.25, t + 0.25, 0, 0.3), 0, top);
  }
  // the pipe banks along the side walls (where the dresser left room), the aisle's floor line
  for (const sd of (alongZ ? ['W', 'E'] : ['N', 'S']) as Side[]) scanWall(D, a, 'bunkerPipeBank', [sd], 0.9);
  D.decor('plasticSeat', alongZ ? B(cA - 1.6, L0 - 2.0, cA - 1.5, L1 + 2.0) : B(L0 - 2.0, cA - 1.6, L1 + 2.0, cA - 1.5), 0, 0.008);
  D.decor('plasticSeat', alongZ ? B(cA + 1.5, L0 - 2.0, cA + 1.6, L1 + 2.0) : B(L0 - 2.0, cA + 1.5, L1 + 2.0, cA + 1.6), 0, 0.008);
  wallSign(D, a, alongZ ? 'N' : 'W', alongZ ? cA - 3.0 : cA - 3.0, 3.6, {kind: 'service', text: 'PUMP HALL · RAW & POTABLE MAINS', w: 2.4});
}

/** The rim of the V45 well on this storey: an amber safety line on the gallery floor along every railed edge of `a`. */
function rimLine(D: Dx, a: Area): number {
  const g = D.g;
  let n = 0;
  // the railed edges: this area's floor cells whose neighbour (outside the area) is not floor on this grid but floor on the grid below
  const below = D.layout.levels[D.lv + 1]?.grid;
  if (!below) return 0;
  const sides: [Side, number, number][] = [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]];
  for (const [sd, dx, dy] of sides) {
    // runs along this side
    const horiz = sd === 'N' || sd === 'S';
    const line = sd === 'N' ? a.y : sd === 'S' ? a.y + a.h - 1 : sd === 'W' ? a.x : a.x + a.w - 1;
    let start = -1;
    const len = horiz ? a.w : a.h;
    for (let k = 0; k <= len; k++) {
      let edge = false;
      if (k < len) {
        const x = horiz ? a.x + k : line, y = horiz ? line : a.y + k;
        const nx = x + dx, ny = y + dy;
        if (g.inBounds(nx, ny)) {
          const j = g.idx(nx, ny);
          edge = g.cells[j] !== FLOOR && below.cells[j] === FLOOR && below.ceil[j] > D.base - 0.3;
        }
      }
      if (edge && start < 0) start = k;
      if (!edge && start >= 0) {
        const t0 = (horiz ? a.x : a.y) * CELL + start * CELL, t1 = (horiz ? a.x : a.y) * CELL + k * CELL;
        const fc = face(a, sd), [nx, nz] = NORMAL[sd];
        // grating strip 1 m wide at the edge, the amber line 1.0 m in from it
        const g0 = horiz ? B(t0, fc - nz * 0.0, t1, fc - nz * 1.0) : B(fc - nx * 0.0, t0, fc - nx * 1.0, t1);
        const l0 = horiz ? B(t0, fc - nz * 1.0, t1, fc - nz * 1.12) : B(fc - nx * 1.0, t0, fc - nx * 1.12, t1);
        D.decor('grille', g0, 0, 0.012);
        D.decor('plasticSeat', l0, 0, 0.012);
        n++;
        start = -1;
      }
    }
  }
  return n;
}

/** The core gallery: the rim line, plates facing the drop, benches against the back wall (the crew's lookout), lights. */
function gallery(D: Dx, a: Area): void {
  rimLine(D, a);
  const w = W(a);
  // the back wall (the long side away from the well)
  const back: Side = 'N';
  const cx = (w.x0 + w.x1) / 2;
  wallSign(D, a, back, cx + 6, 2.4, {kind: 'service', text: 'PROCESSING CORE · LEVEL 5 BELOW', w: 2.6});
  wallSign(D, a, back, cx - 8, 2.2, {kind: 'service', text: 'KEEP BEHIND THE YELLOW LINE', w: 2.2});
  for (const t of [cx - 3, cx + 12]) {
    const p = tryPlaceProp(D.ctx, a, 'bench', Math.round(t * 4) / 4, r3(w.z0 + 0.45), 0, {front: 0.8});
    if (p) FLOOR4_DRESS_STATS.props++;
  }
  // the rim walk lit along its length when the dresser hung fewer than four fixtures here (the storey's light budget)
  const own = D.layout.lights.filter(l => l.area === a.id).length;
  if (own < 4) for (const f of [0.3, 0.7]) light(D, a, w.x0 + (w.x1 - w.x0) * f, w.z1 - 1.6, 0, false, 0.85);
}

/** The cooling feed gallery (the service stair's landing hall on the well's east side): the operator's console turned to the drop. */
function feedGallery(D: Dx, a: Area): void {
  rimLine(D, a);
  // the operator's console free-standing in the hall, its front (the operator's side) to the east: standing at it he looks west over
  // its desk and the rim into the core's nave
  island(D, a, 'bunkerControlConsole', 'E', 0.8);
  const walls = wallsByDoors(D, a).filter(s => s !== 'W');
  scanWall(D, a, 'bunkerPipeBank', walls, 0.9);
  for (let i = 0; i < 2; i++) scanWall(D, a, 'bunkerCoolantPump', walls, 0.9);
  wallSign(D, a, 'E', wallMid(a, 'E'), 2.6, {kind: 'service', text: 'CORE COOLING FEED · LEVEL 5', w: 2.4});
}

/** The boiler house: two boilers (body, firebox door, flue to the ceiling) against the quietest wall. */
function boilerHouse(D: Dx, a: Area): void {
  const top = rel(D, a);
  let n = 0;
  for (const sd of wallsByDoors(D, a)) {
    const [lo, hi] = wallRange(a, sd);
    for (let t = lo + 2.0; t + 2.4 <= hi - 1.5 && n < 2; t += 0.5) {
      const b = wallBox(a, sd, t, t + 2.4, 0.5, 3.5);
      if (!machine(D, a, b, 2.6, 'steelDark')) continue;
      const fx = (b.x0 + b.x1) / 2, fz = (b.z0 + b.z1) / 2;
      // the firebox door on the room side, the flue up to the ceiling at the wall side, a gauge band
      const door = wallBox(a, sd, t + 0.7, t + 1.7, 3.5, 3.55);
      D.decor('black', door, 0.4, 1.4);
      const flue = wallBox(a, sd, t + 0.95, t + 1.45, 0.75, 1.25);
      D.decor('steelBright', flue, 2.6, top);
      D.decor('plasticSeat', B(fx - 1.25, fz - 1.25, fx + 1.25, fz + 1.25), 2.0, 2.12);
      n++;
      t += 3.0;
    }
    if (n >= 2) break;
  }
  FLOOR4_DRESS_STATS.boilers += n;
  if (!n) FLOOR4_DRESS_STATS.skipped.push('boilers');
}

/** The auxiliary power room: the day tank on its bund along a wall, the cable trench from the generator, the hazard outline. */
function powerRoom(D: Dx, a: Area): void {
  const gen = D.layout.props.find(p => p.kind === BUNKER_GENERATOR_KIND && p.area === a.id) ?? null;
  // the day tank: a bunded steel tank against the quietest wall that is not the generator's
  const genSide: Side | null = gen ? sideOfProp(gen) : null;
  let tank = false;
  for (const sd of wallsByDoors(D, a)) {
    if (sd === genSide || tank) continue;
    const [lo, hi] = wallRange(a, sd);
    for (let t = lo + 1.0; t + 3.0 <= hi - 1.0 && !tank; t += 0.5) {
      const b = wallBox(a, sd, t, t + 3.0, 0.1, 1.5);
      if (!freeFor(D, a, b) || propBlocksDoorway(D.layout, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base, 1.8)) continue;
      solidProp(D, 'annexMachine', a, b, 1.6, 0, 0, false);
      D.decor('steelDark', wallBox(a, sd, t, t + 3.0, 0.1, 1.5), 0, 0.18);
      D.decor('steelDark', wallBox(a, sd, t + 0.25, t + 2.75, 0.25, 1.35), 0.3, 1.45);
      D.decor('plasticSeat', wallBox(a, sd, t + 0.24, t + 2.76, 0.24, 1.36), 0.95, 1.08);
      D.decor('kitchenSteel', wallBox(a, sd, t + 2.2, t + 2.35, 0.7, 0.85), 1.45, 1.6);
      tank = true;
    }
  }
  if (gen) {
    // the hazard outline round the set (1.2 m out), amber
    const m = 1.2, ww = 0.2;
    const x0 = gen.x - gen.hx - m, x1 = gen.x + gen.hx + m, z0 = gen.z - gen.hz - m, z1 = gen.z + gen.hz + m;
    const wr = W(a);
    const cl = (b: Box): Box => B(Math.max(b.x0, wr.x0), Math.max(b.z0, wr.z0), Math.min(b.x1, wr.x1), Math.min(b.z1, wr.z1));
    for (const b of [B(x0, z0, x1, z0 + ww), B(x0, z1 - ww, x1, z1), B(x0, z0, x0 + ww, z1), B(x1 - ww, z0, x1, z1)]) D.decor('plasticSeat', cl(b), 0, 0.008);
  }
  duct(D, a, wallsByDoors(D, a)[0], 0.6);
}

/** The freight hall: the loading bay round the lift apron (hazard stripes on the floor), the gantry beam, hand trucks / a pallet jack. */
function freightHall(D: Dx, a: Area, apron: {x: number; y: number; w: number; h: number} | null): void {
  const w = W(a), top = rel(D, a);
  if (apron) {
    const x0 = apron.x * CELL, x1 = (apron.x + apron.w) * CELL, z0 = apron.y * CELL, z1 = (apron.y + apron.h) * CELL;
    // chevron band: alternating amber / black bars along the bay's open sides (flat floor paint)
    for (let x = x0; x < x1 - 0.01; x += 2) D.decor('plasticSeat', B(x, z0, Math.min(x1, x + 1), z0 + 0.15), 0, 0.008);
    for (const xe of [x0, x1 - 0.15]) D.decor('plasticSeat', B(xe, z0, xe + 0.15, z1), 0, 0.008);
  }
  // the gantry beam across the hall over the bay, on brackets
  if (top > 4.4 && apron) {
    const zc = (apron.y + apron.h / 2) * CELL;
    D.decor('plasticSeat', B(w.x0, zc - 0.25, w.x1, zc + 0.25), top - 0.8, top - 0.35);
    D.decor('steelDark', B((apron.x + apron.w / 2) * CELL - 0.45, zc - 0.4, (apron.x + apron.w / 2) * CELL + 0.45, zc + 0.4), top - 1.3, top - 0.8);
  }
  for (const k of ['palletJack', 'handTruck', 'handTruck'] as PropKind[]) placeAgainstWall(D.ctx, a, k, {tries: 16, sides: ['N']});
  wallSign(D, a, 'N', (w.x0 + w.x1) / 2 + 4, 3.2, {kind: 'service', text: 'LEVEL 4 · MAINTENANCE & WATER', w: 2.8});
  wallSign(D, a, 'N', w.x0 + 4.0, 2.4, {kind: 'service', text: 'DRAINAGE · FLOODED · KEEP OUT', w: 2.2});
}

/** The chlorination room (the strong leak): chlorine cylinder carts, a burst one on its side, the warning plates. */
function chlorination(D: Dx, a: Area): void {
  for (let i = 0; i < 3; i++) placeAgainstWall(D.ctx, a, 'gasCylinderCart', {tries: 16, front: 0.4});
  const walls = wallsByDoors(D, a);
  wallSign(D, a, walls[0], wallMid(a, walls[0]), 1.9, {kind: 'service', text: 'CHLORINE · MASKS ON', w: 1.8});
}

/** The drainage wing (aged, flooded): standing water over most of the floor, fallen ceiling panels, a walled sump pit. */
function flooded(D: Dx, a: Area, pit: boolean): void {
  const w = W(a), rng = D.rng;
  if (pit) {
    const cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
    let ok = false;
    for (const d of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) if (basin(D, a, B(cx + d[0] - 2.0, cz + d[1] - 2.0, cx + d[0] + 2.0, cz + d[1] + 2.0), 0.7, 0.55, 'steelDark')) { ok = true; break; }
    if (!ok) FLOOR4_DRESS_STATS.skipped.push('sump pit');
  }
  // standing water: a few broad sheets (flat; the decor never blocks), clear of the doorways
  const n = Math.max(2, Math.round((w.x1 - w.x0) * (w.z1 - w.z0) / 40));
  let got = 0;
  for (let i = 0; i < n * 3 && got < n; i++) {
    const sw = rng.range(2.0, 4.5), sd = rng.range(1.5, 3.5);
    const x = w.x0 + 0.3 + rng.next() * Math.max(0.1, w.x1 - w.x0 - sw - 0.6), z = w.z0 + 0.3 + rng.next() * Math.max(0.1, w.z1 - w.z0 - sd - 0.6);
    const b = B(x, z, x + sw, z + sd);
    if (propBlocksDoorway(D.layout, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base, 0.05)) continue;
    D.decor('glassShopfront', b, 0, 0.006);
    got++;
  }
  // fallen ceiling panels
  for (let i = 0; i < 2; i++) {
    const pw = rng.range(0.9, 1.5), pd = rng.range(0.6, 1.1);
    const x = w.x0 + 0.5 + rng.next() * Math.max(0.1, w.x1 - w.x0 - pw - 1.0), z = w.z0 + 0.5 + rng.next() * Math.max(0.1, w.z1 - w.z0 - pd - 1.0);
    put(D, 'panel', B(x, z, x + pw, z + pd), 0.006, 0.05);
  }
}

/** A rectangular duct under the ceiling along wall `side` of a run (long segments: one box each, skipping doorway volumes / props). */
function duct(D: Dx, a: Area, side: Side, w = 0.5): void {
  const top = rel(D, a), y1 = top - 0.08, y0 = y1 - 0.38;
  if (y0 < 2.45) return;
  const [lo, hi] = wallRange(a, side);
  for (let t = lo + 0.1; t < hi - 0.5; t += 6) {
    const t1 = Math.min(hi - 0.1, t + 6);
    for (const [s0, s1] of [[t, t1], [t, (t + t1) / 2], [(t + t1) / 2, t1]]) if (put(D, 'steelBright', wallBox(a, side, s0, s1, 0.06, 0.06 + w), y0, y1)) break;
  }
}

/** Seepage in a damp plant room: a few small puddles of standing water by the walls (flat; clear of doorways and props). */
function seepage(D: Dx, a: Area, n: number): void {
  const w = W(a), rng = D.rng;
  let got = 0;
  for (let i = 0; i < n * 4 && got < n; i++) {
    const sd = (['N', 'S', 'W', 'E'] as Side[])[rng.int(0, 3)];
    const [lo, hi] = wallRange(a, sd);
    const len = rng.range(1.2, 2.6), t = lo + 0.5 + rng.next() * Math.max(0.1, hi - lo - len - 1.0);
    const b = wallBox(a, sd, t, t + len, 0.05, rng.range(0.7, 1.4));
    const q = B(Math.max(b.x0, w.x0), Math.max(b.z0, w.z0), Math.min(b.x1, w.x1), Math.min(b.z1, w.z1));
    if (put(D, 'glassShopfront', q, 0, 0.006)) got++;
  }
}

/** The crew room: the foreman's desk and the shift board by it (the room's lockers / benches are the dresser's locker-room stock). */
function crewRoom(D: Dx, a: Area): void {
  const walls = wallsByDoors(D, a);
  const desk = scanWall(D, a, 'desk', walls, 0.8, undefined, true);
  if (desk) {
    const sd = sideOfProp(desk), t = sd === 'N' || sd === 'S' ? desk.x : desk.z;
    placeAgainstWall(D.ctx, a, 'noticeBoard', {y: 1.1, tries: 16, sides: [sd]});
    wallSign(D, a, sd, t, 2.35, {kind: 'service', text: 'SHIFT ROSTER · PLANT ROUNDS', w: 2.2});
  }
  placeAgainstWall(D.ctx, a, 'filingCabinet', {tries: 16, front: 0.7, sides: walls});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Helpers

/** The walls of `a`, fewest doors first (ties: longer first). */
function wallsByDoors(D: Dx, a: Area): Side[] {
  const ds = D.doors(a);
  const cnt = (s: Side) => ds.filter(d => doorSide(d, a) === s).length;
  const len = (s: Side) => (s === 'N' || s === 'S' ? a.w : a.h);
  return (['N', 'S', 'W', 'E'] as Side[]).sort((p, q) => cnt(p) - cnt(q) || len(q) - len(p));
}
const wallMid = (a: Area, s: Side) => (s === 'N' || s === 'S' ? (a.x + a.w / 2) * CELL : (a.y + a.h / 2) * CELL);

/** The wall a wall-backed prop stands against (its back side). */
function sideOfProp(p: PropPlacement): Side {
  const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
  return fz > 0 ? 'N' : fz < 0 ? 'S' : fx > 0 ? 'W' : 'E';
}

/** Storey 4's bespoke dressing. */
export function dressFloor4(ctx: FloorDressCtx): void {
  const S = FLOOR4_DRESS_STATS;
  S.props = S.decor = S.lights = S.signs = S.tanks = S.pumps = S.boilers = 0;
  S.skipped = [];
  const {layout, carved} = ctx;
  const A = (k: string): Area | undefined => (carved.areas[k] !== undefined ? layout.areas[carved.areas[k]] : undefined);
  const areas = Object.values(carved.areas).map(id => layout.areas[id]);
  const D = shelterDx(layout, ctx.level, ctx.rng, areas);
  D.held = ctx.held as Set<number>;
  const p0 = layout.props.length, d0 = layout.decor.length, s0 = layout.signs.length;
  const step = (name: string, fn: () => void) => { try { fn(); } catch (e) { S.skipped.push(`${name}: ${(e as Error).message}`); } };
  const lift = ctx.frame.anchors.find(q => q.id === 'lift')?.apron ?? null;
  const run = (k: string, fn: (D: Dx, a: Area) => void) => { const a = A(k); if (a) step(k, () => fn(D, a)); };
  run('reservoir', reservoir);
  run('treatment', treatment);
  run('pumpHall', pumpHall);
  run('gallery', gallery);
  run('westWalk', (d, a) => { rimLine(d, a); });
  run('feed', feedGallery);
  run('filtration', filtration);
  run('boiler', boilerHouse);
  run('power', powerRoom);
  run('freight', (d, a) => freightHall(d, a, lift));
  run('chlorine', chlorination);
  run('crew', crewRoom);
  for (const k of ['reservoir', 'treatment', 'pumpHall', 'power', 'feed']) run(k, (d, a) => seepage(d, a, 2));
  run('drainage', (d, a) => flooded(d, a, false));
  run('sump', (d, a) => flooded(d, a, true));
  run('ejector', (d, a) => flooded(d, a, false));
  // the cramped runs stay dimmer than the halls: every other ceiling fixture of the long ones (the storey's light budget, <= ~75)
  for (const k of ['pipeRun', 'passage']) run(k, (d, a) => {
    const own = d.layout.lights.filter(l => l.area === a.id && (l.level ?? 0) === d.lv);
    if (own.length < 4) return;
    const drop = new Set(own.filter((_, i) => i % 2 === 1));
    d.layout.lights = d.layout.lights.filter(l => !drop.has(l));
  });
  for (const k of ['pipeRun', 'link', 'passage']) run(k, (d, a) => { const longs: Side[] = a.w >= a.h ? ['N', 'S'] : ['W', 'E']; duct(d, a, wallsByDoors(d, a).filter(s => longs.includes(s))[0] ?? longs[0]); });
  // door plates in the shelter's words
  step('plates', () => {
    const plate: Record<string, string> = {
      reservoir: 'RESERVOIR', treatment: 'WATER TREATMENT', chlorine: 'CHLORINATION · DANGER', filtration: 'AIR FILTRATION', boiler: 'BOILER HOUSE · DANGER',
      power: 'AUX GENERATOR 3 · DANGER', workshop: 'WORKSHOP', stores: 'MAINTENANCE STORES', washroom: 'WASHROOM',
      crew: 'CREW ROOM', pumpHall: 'PUMP HALL', drainage: 'DRAINAGE', sump: 'SUMP · NO ENTRY', ejector: 'SEWAGE EJECTORS', feed: 'COOLING FEED',
    };
    for (const [k, text] of Object.entries(plate)) {
      const a = A(k);
      if (!a) continue;
      const ds = D.doors(a);
      const d = ds.find(q => q.a === a.parent || q.b === a.parent) ?? ds[0];
      if (!d) continue;
      const outside = layout.areas[d.a === a.id ? d.b : d.a];
      if ((outside.level ?? 0) !== ctx.level) continue;
      doorPlate(D, d, outside, text, text.length > 14 ? 2.0 : 1.4);
    }
  });
  // the guarantee: no floor pocket anywhere on the storey
  step('pockets', () => { sweepPockets(D, areas, p0); for (const a of areas) if (pocketCells(D, a).length) S.skipped.push(`pocket ${a.label}`); });
  S.props += layout.props.length - p0;
  S.decor = layout.decor.length - d0;
  S.signs = layout.signs.length - s0;
}
