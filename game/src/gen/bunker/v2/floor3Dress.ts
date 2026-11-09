// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 3 (SERVICES & MEDICAL)'s own dressing, after the ONE station
// dresser furnished / lit the rooms by purpose (gen/bunker/v2/floor3.ts carves them). World metres on this storey's grid; props in the
// placeKit local height frame (the pipeline lifts them onto the floor), decor / lights / signs through the Bunker's Dx (absolute).
//
//  - the SERVICE STREET: a continuous ceiling light trough down its crown with a line of fixtures under it, steel ribs every ~8.5 m
//    (its bays), the bulkhead gate between its compartments (hazard-striped jambs, plates both faces), the residents' notice wall at
//    its north end, waiting benches and planters at the infirmary end, hung wayfinding;
//  - the SUPPLY DEPOT: five runs of high pallet racking (orange beams on steel posts, collision-only footprints, see-through), picked
//    bare; what stock is left staged on the floor by the goods-in desk; fixtures down the aisles (the dresser's pendants would hang
//    into the racks);
//  - the FABRICATION HALL: a yellow gantry crane on runway beams (its hoist and hook mid-span), fitting benches (openable low
//    cabinets back to back), a lathe and a pillar drill against the walls, high-bay fixtures;
//  - the PLANT ROOM: the switchboard, a diesel day tank on its bund, the hazard outline round the generator;
//  - the WORKS YARD and the FREIGHT LOBBY: hand trucks / pallet jacks / cable spools, the loading-bay outline at the lift gate;
//  - the LAUNDRY: a bank of washing machines and dryers (anchored, collision box), folding table, clothes rails;
//  - the INFIRMARY: the reception desk facing the main stair, rows of waiting benches, wheelchairs, planters; the CASUALTY WARD's bays
//    (stretcher beds under curtain rails, drip stands, a nurses' station); the ISOLATION WARD's glazed cubicles (beds behind glass);
//    the treatment room's exam couch; the medical-gas store's cylinder carts;
//  - plates in the shelter's words at every door, the storey plate at both stair landings.
// Every storage placed opens (cabinets, crates, carton stacks: existing holders, loot by the room's purpose); loose things move (chairs,
// benches, carts, trolleys: classified kinds); anchored plant / racks are collision-only 'annexMachine' footprints (classified anchored
// machinery) under layout.decor. Nothing stands in a doorway's clear volume or on a held cell; the pocket sweep runs last.

import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../../props';
import type {Area, Door, LightPlacement, Side} from '../../stationTypes';
import type {ShopMat} from '../../storefronts';
import {begin, commit, doorSide, placeAgainstWall, rollback, propBlocksDoorway, rowAlongWall, tryPlaceProp, wallRange, wallSpot} from '../../placeKit';
import {NORMAL, OPP, doorPlate, face, freeFor, rotFacing, scanWall, solidProp, sweepPockets, wallBox, wallSign, type Dx} from '../../reactor/complex/bunkerDress';
import {shelterDx} from '../dress';
import type {FloorDressCtx} from './floorApi';
import {V2_STOREY_PLATES} from './spine';
import type {F3Key} from './floor3';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
type Box = {x0: number; z0: number; x1: number; z1: number};

/** QA / tests: what the last storey-3 dress did. */
export const F3_DRESS_STATS = {props: 0, decor: 0, lights: 0, signs: 0, racks: 0, beds: 0, cubicles: 0, skipped: [] as string[]};

interface F3 {
  D: Dx;
  c: FloorDressCtx;
  A: Partial<Record<F3Key, Area>>;
}

const ax0 = (a: Area) => a.x * CELL, az0 = (a: Area) => a.y * CELL, ax1 = (a: Area) => (a.x + a.w) * CELL, az1 = (a: Area) => (a.y + a.h) * CELL;
const rel = (D: Dx, a: Area) => a.ceil - D.base;

/** A decor box (local y) unless it would stand in a doorway's clear volume (y0 < 2.9 m only). */
function deco(D: Dx, m: ShopMat, b: Box, y0: number, y1: number): boolean {
  if (y0 < 3.1 && propBlocksDoorway(D.layout, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base + y0, y1 - y0)) return false;
  D.decor(m, {x0: r3(Math.min(b.x0, b.x1)), z0: r3(Math.min(b.z0, b.z1)), x1: r3(Math.max(b.x0, b.x1)), z1: r3(Math.max(b.z0, b.z1))}, r3(y0), r3(y1));
  return true;
}

/** An anchored collision-only footprint (annexMachine) over free floor of `a` that keeps the room connected; null otherwise. */
function solid(D: Dx, a: Area, b: Box, h: number, sight = false): PropPlacement | null {
  if (!freeFor(D, a, b)) return null;
  if (propBlocksDoorway(D.layout, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2, D.base, Math.min(h, 2.4))) return null;
  return solidProp(D, 'annexMachine', a, b, h, 0, 0, sight);
}

/** A ceiling fixture (absolute y) of area `a`; applyLighting gives it the area's condition later. */
function light(D: Dx, a: Area, x: number, z: number, yRel: number, alongX: boolean, warm = false): void {
  for (const l of D.layout.lights) if (l.area === a.id && Math.hypot(l.x - x, l.z - z) < 1.4) return;
  const l: LightPlacement = {x: r3(x), y: r3(D.base + Math.min(yRel, rel(D, a) - 0.05)), z: r3(z), rot: alongX ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm, power: 1, dying: false, level: D.lv};
  D.layout.lights.push(l);
  F3_DRESS_STATS.lights++;
}

/** Removes the station dresser's fixtures of `a` (an area whose own fixtures replace them: the racks / crane would meet them). */
function dropLights(D: Dx, a: Area): void {
  D.layout.lights = D.layout.lights.filter(l => l.area !== a.id);
}

/** A holder's loot purpose (PropPlacement.purpose: the room's own otherwise). */
function stock<T extends PropPlacement | null>(p: T, purpose: string): T {
  if (p) p.purpose = purpose;
  return p;
}

const place = (D: Dx, a: Area, kind: PropKind, x: number, z: number, rot: number, o: Parameters<typeof tryPlaceProp>[6] = {}): PropPlacement | null =>
  tryPlaceProp(D.ctx, a, kind, r3(Math.round(x * 4) / 4), r3(Math.round(z * 4) / 4), rot, o);

/** The door between areas a and b, if any. */
function doorOf(D: Dx, a: Area, b: Area | undefined): Door | undefined {
  if (!b) return undefined;
  return D.doors(a).find(d => (d.a === a.id && d.b === b.id) || (d.b === a.id && d.a === b.id));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The service street

function street(f: F3): void {
  const {D, A} = f;
  const comps = [A.streetN, A.streetS].filter((a): a is Area => !!a);
  for (const a of comps) {
    dropLights(D, a);
    const h = rel(D, a), cx = (ax0(a) + ax1(a)) / 2, z0 = az0(a) + 0.5, z1 = az1(a) - 0.5;
    // the crown's light trough: a luminous panel strip between two steel lips, the fixtures hung under it
    deco(D, 'signBand', {x0: cx - 0.6, x1: cx + 0.6, z0, z1}, h - 0.1, h - 0.02);
    deco(D, 'steelDark', {x0: cx - 0.68, x1: cx - 0.6, z0, z1}, h - 0.32, h - 0.02);
    deco(D, 'steelDark', {x0: cx + 0.6, x1: cx + 0.68, z0, z1}, h - 0.32, h - 0.02);
    for (let z = z0 + 1.5; z <= z1 - 0.8; z += 4.5) light(D, a, cx, z, h - 0.3, false);
    // the street's bays: steel ribs across the ceiling every ~8.5 m
    for (let z = az0(a) + 3.2; z < az1(a) - 2; z += 8.5) {
      deco(D, 'steelDark', {x0: ax0(a), x1: cx - 0.7, z0: z - 0.15, z1: z + 0.15}, h - 0.45, h);
      deco(D, 'steelDark', {x0: cx + 0.7, x1: ax1(a), z0: z - 0.15, z1: z + 0.15}, h - 0.45, h);
    }
  }
  // the bulkhead gate between the compartments: hazard-striped jambs on both faces, plates above
  const N = A.streetN, S = A.streetS;
  const gate = N && S ? doorOf(D, N, S) : undefined;
  if (N && S && gate) {
    const gx0 = gate.x * CELL, gx1 = (gate.x + gate.w) * CELL;
    for (const [a, zf, dir] of [[N, gate.y * CELL, -1], [S, (gate.y + 1) * CELL, 1]] as const) {
      for (const [j0, j1] of [[ax0(a), gx0], [gx1, ax1(a)]]) {
        deco(D, 'steelDark', {x0: j0, x1: j1, z0: zf, z1: zf + dir * 0.08}, 0, gate.height + 0.35);
        deco(D, 'plasticSeat', {x0: j0 + 0.08, x1: j1 - 0.08, z0: zf + dir * 0.08, z1: zf + dir * 0.1}, 0.1, gate.height - 0.1);
      }
      deco(D, 'steelDark', {x0: gx0, x1: gx1, z0: zf, z1: zf + dir * 0.08}, gate.height, gate.height + 0.35);
    }
    doorPlate(D, gate, N, 'INFIRMARY · MAIN STAIR · WORKS YARD', 3.2);
    doorPlate(D, gate, S, 'SUPPLY DEPOT · FABRICATION', 2.8);
  }
  // the residents' notice wall at the north end of the street (the far end of its sightline)
  if (N) {
    const cx = (ax0(N) + ax1(N)) / 2;
    deco(D, 'woodVeneer', {x0: cx - 2.2, x1: cx + 2.2, z0: az0(N), z1: az0(N) + 0.04}, 0.8, 2.6);
    for (let i = 0; i < 3; i++) placeAgainstWall(D.ctx, N, 'noticeBoard', {sides: ['N'], y: 1.1, tries: 20});
    wallSign(D, N, 'N', cx, 3.6, {kind: 'service', text: 'LEVEL 3 · SERVICES & MEDICAL', w: 4.2});
  }
  // street islands down the crown: a planter between two benches back to back (one per compartment), the street's resting places
  for (const a of comps) {
    const cx = (ax0(a) + ax1(a)) / 2, bw = PROP_DEFS.bench.w;
    for (const zf of [0.42, 0.58, 0.32, 0.68]) {
      const z = Math.round((az0(a) + (az1(a) - az0(a)) * zf) * 2) / 2;
      begin(D.ctx);
      const ok = place(D, a, 'planterTree', cx, z, 0, {}) && place(D, a, 'bench', cx, z - 0.55 - bw / 2, Math.PI / 2, {front: 0.6}) && place(D, a, 'bench', cx, z + 0.55 + bw / 2, -Math.PI / 2, {front: 0.6});
      if (ok) { commit(D.ctx); break; }
      rollback(D.ctx);
    }
  }
  // hung wayfinding in both compartments, a bin by the infirmary portal
  if (S) {
    scanWall(D, S, 'bin', ['W', 'E'], 0, az1(S) - 2);
    hang(D, S, (az0(S) + az1(S)) / 2 + 4, 'INFIRMARY · MAIN STAIR');
  }
  if (N) hang(D, N, (az0(N) + az1(N)) / 2, 'SUPPLY DEPOT · FABRICATION');
}

/** A double-sided hung sign across the street (its rods reach the ceiling). */
function hang(D: Dx, a: Area, z: number, text: string): void {
  const x = (ax0(a) + ax1(a)) / 2;
  for (const l of D.layout.lights) if (l.area === a.id && Math.abs(l.z - z) < 0.8) z += 1.6 - Math.abs(l.z - z);
  D.layout.signs.push({x: r3(x), y: r3(D.base + 3.4), z: r3(z), rot: 0, kind: 'info', text, area: a.id, hang: true, w: 3.2, level: D.lv});
  F3_DRESS_STATS.signs++;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The supply depot

function depot(f: F3): void {
  const {D, A} = f;
  const a = A.depot;
  if (!a) return;
  dropLights(D, a);
  const h = rel(D, a);
  const r0 = a.y + 4, r1 = a.y + a.h - 10; // racks' rows (inclusive): a 2 m aisle north, a 4.5 m cross aisle south
  const runs: number[] = [];
  for (let cx = a.x + 4; cx + 1 <= a.x + a.w - 10; cx += 7) runs.push(cx);
  const rackH = Math.min(4.9, h - 1.2);
  for (const cx of runs) {
    const b: Box = {x0: cx * CELL + 0.01, x1: (cx + 2) * CELL - 0.01, z0: r0 * CELL + 0.01, z1: (r1 + 1) * CELL - 0.01};
    if (!solid(D, a, b, rackH)) { F3_DRESS_STATS.skipped.push(`rack ${cx}`); continue; }
    F3_DRESS_STATS.racks++;
    const zs = [b.z0 + 0.05, (b.z0 + b.z1) / 2, b.z1 - 0.05];
    for (const z of zs) for (const x of [b.x0 + 0.05, b.x1 - 0.05]) deco(D, 'steelDark', {x0: x - 0.05, x1: x + 0.05, z0: z - 0.05, z1: z + 0.05}, 0, rackH);
    for (const y of [1.5, 3.0, 4.5]) if (y + 0.14 < rackH + 0.01) deco(D, 'plasticSeat', {x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1}, y, y + 0.14);
    // the aisle fixtures (the racks' tops are 1.5 m below the ceiling)
    const lx = (cx + 2) * CELL + 1.25;
    if (lx < ax1(a) - 0.5 && runs.indexOf(cx) % 2 === 0) light(D, a, lx, (b.z0 + b.z1) / 2, h - 0.3, false);
  }
  // the goods-in way along the street side and the south cross aisle: fixtures
  const ex = ((runs.length ? runs[runs.length - 1] + 2 : a.x) * CELL + ax1(a)) / 2;
  for (let z = az0(a) + 3; z < az1(a) - 1; z += 6) light(D, a, ex, z, h - 0.3, false);
  for (let x = ax0(a) + 4; x < ex - 3; x += 8) light(D, a, x, az1(a) - 2.2, h - 0.3, true);
  // the stock that is left: staged on the floor of the goods-in way, by the issue desk at the street door
  const sd = doorOf(D, a, A.streetN);
  const deskZ = sd ? sd.y * CELL - 1.6 : az0(a) + 4;
  const desk = scanWall(D, a, 'desk', ['E'], 0.9, deskZ);
  if (desk) place(D, a, 'officeSwivelChair', desk.x - 0.75, desk.z, rotFacing(1, 0), {laneOk: true});
  const xs = ex - 1.0;
  const staged: PropKind[] = ['parcelPallet', 'cartonStack', 'crate', 'parcelPallet'];
  let n = 0;
  for (let z = az0(a) + 1.6; z < az1(a) - 5 && n < staged.length; z += 1.5) {
    if (sd && z > sd.y * CELL - 1.2 && z < (sd.y + sd.h) * CELL + 1.2) continue;
    if (stock(place(D, a, staged[n], xs, z, Math.PI / 2), 'storage')) n++;
  }
  const pj = scanWall(D, a, 'palletJack', ['S'], 0.5, ex);
  if (!pj) placeAgainstWall(D.ctx, a, 'handTruck', {tries: 16});
  // the depot's own storage along its walls (the maintenance-stores loot): shelving on the west wall, store cupboards on the north
  rowAlongWall(D.ctx, a, 'W', 'shelf', {front: 0.8, max: 3, from: az0(a) + 2.5}).forEach(p => stock(p, 'storage'));
  for (let i = 0; i < 3; i++) stock(scanWall(D, a, 'cabinetTall', ['N'], 0.8, ax0(a) + 3 + i * 7), 'storage');
  stock(scanWall(D, a, 'cabinetLow', ['S'], 0.7, ax0(a) + 4), 'storage');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fabrication hall

function fabrication(f: F3): void {
  const {D, A} = f;
  const a = A.fab;
  if (!a) return;
  dropLights(D, a);
  const h = rel(D, a);
  const alongX = a.w >= a.h;
  // the gantry crane: runway beams along the long walls, the yellow bridge across at ~60 % of the hall, its end trucks, the hoist
  const [L0, L1] = alongX ? [ax0(a), ax1(a)] : [az0(a), az1(a)];
  const [C0, C1] = alongX ? [az0(a), az1(a)] : [ax0(a), ax1(a)];
  const B = (l0: number, l1: number, c0: number, c1: number): Box => (alongX ? {x0: l0, x1: l1, z0: c0, z1: c1} : {x0: c0, x1: c1, z0: l0, z1: l1});
  const yr = Math.min(5.0, h - 1.0);
  deco(D, 'steelDark', B(L0 + 0.1, L1 - 0.1, C0 + 0.1, C0 + 0.45), yr, yr + 0.35);
  deco(D, 'steelDark', B(L0 + 0.1, L1 - 0.1, C1 - 0.45, C1 - 0.1), yr, yr + 0.35);
  const bl = L0 + (L1 - L0) * (0.55 + 0.15 * D.rng.next());
  deco(D, 'plasticSeat', B(bl - 0.32, bl + 0.32, C0 + 0.3, C1 - 0.3), yr + 0.35, yr + 0.85);
  deco(D, 'black', B(bl - 0.55, bl + 0.55, C0 + 0.12, C0 + 0.75), yr + 0.3, yr + 0.9);
  deco(D, 'black', B(bl - 0.55, bl + 0.55, C1 - 0.75, C1 - 0.12), yr + 0.3, yr + 0.9);
  const hc = C0 + (C1 - C0) * 0.42;
  deco(D, 'steelDark', B(bl - 0.42, bl + 0.42, hc - 0.4, hc + 0.4), yr - 0.2, yr + 0.35);
  deco(D, 'steelBright', B(bl - 0.03, bl + 0.03, hc - 0.03, hc + 0.03), 3.5, yr - 0.2);
  deco(D, 'black', B(bl - 0.16, bl + 0.16, hc - 0.12, hc + 0.12), 3.2, 3.5);
  // the job they left: a pump motor hanging on the hook over its engine stand (the stand anchored; the load well above head height)
  deco(D, 'steelDark', B(bl - 0.55, bl + 0.55, hc - 0.4, hc + 0.4), 2.45, 3.1);
  deco(D, 'black', B(bl - 0.4, bl + 0.4, hc - 0.3, hc + 0.3), 2.3, 2.45);
  deco(D, 'steelBright', B(bl - 0.75, bl - 0.55, hc - 0.25, hc + 0.25), 2.6, 2.95);
  const stand = B(bl - 0.75, bl + 0.75, hc - 0.5, hc + 0.5);
  if (solid(D, a, {x0: Math.floor(stand.x0 / CELL) * CELL + 0.01, x1: Math.ceil(stand.x1 / CELL) * CELL - 0.01, z0: Math.floor(stand.z0 / CELL) * CELL + 0.01, z1: Math.ceil(stand.z1 / CELL) * CELL - 0.01}, 0.75)) {
    deco(D, 'steelDark', B(bl - 0.6, bl + 0.6, hc - 0.35, hc + 0.35), 0, 0.6);
    deco(D, 'plasticSeat', stand, 0.6, 0.7);
  }
  // high-bay fixtures in two rows clear of the bridge
  for (const cf of [0.28, 0.72]) for (let l = L0 + 2.5; l < L1 - 1.5; l += 5.5) {
    if (Math.abs(l - bl) < 1.2) continue;
    const c = C0 + (C1 - C0) * cf;
    light(D, a, alongX ? l : c, alongX ? c : l, h - 0.2, alongX);
  }
  // the fitting benches: openable low cabinets back to back, down the middle of the floor
  const mc = (C0 + C1) / 2, def = PROP_DEFS.cabinetLow;
  for (const lf of [0.3, 0.7]) {
    const l = L0 + (L1 - L0) * lf;
    for (const s of [-1, 1]) {
      const c = mc + s * (def.d / 2 + 0.02);
      place(D, a, 'cabinetLow', alongX ? l : c, alongX ? c : l, alongX ? (s < 0 ? Math.PI : 0) : (s < 0 ? -Math.PI / 2 : Math.PI / 2), {ring: 0.4, front: 0.7});
    }
  }
  // the machine line: a lathe and a pillar drill against the wall with the fewest doors (anchored, collision boxes under decor)
  const sides: Side[] = (['N', 'S', 'W', 'E'] as Side[]).sort((p, q) => D.doors(a).filter(d => doorSide(d, a) === p).length - D.doors(a).filter(d => doorSide(d, a) === q).length);
  let lathe = false, drill = false;
  for (const sd of sides) {
    const [lo, hi] = wallRange(a, sd);
    for (let t = lo + 2.0; t < hi - 2.0 && !(lathe && drill); t += 0.5) {
      if (!lathe) {
        const b = wallBox(a, sd, t - 1.3, t + 1.3, 0.05, 0.95);
        if (solid(D, a, b, 1.45, false)) {
          lathe = true;
          const [nx, nz] = NORMAL[sd], fc = face(a, sd);
          deco(D, 'steelDark', b, 0, 0.9);
          deco(D, 'steelBright', wallBox(a, sd, t - 1.3, t - 0.6, 0.15, 0.85), 0.9, 1.45);
          deco(D, 'black', wallBox(a, sd, t - 0.6, t + 0.8, 0.45, 0.55), 1.0, 1.1);
          void nx; void nz; void fc;
          t += 3.2;
          continue;
        }
      }
      if (lathe && !drill) {
        const b = wallBox(a, sd, t - 0.35, t + 0.35, 0.05, 0.75);
        if (solid(D, a, b, 1.85, false)) {
          drill = true;
          deco(D, 'steelDark', wallBox(a, sd, t - 0.32, t + 0.32, 0.08, 0.72), 0, 0.12);
          deco(D, 'steelBright', wallBox(a, sd, t - 0.06, t + 0.06, 0.15, 0.27), 0.12, 1.6);
          deco(D, 'steelDark', wallBox(a, sd, t - 0.2, t + 0.2, 0.12, 0.62), 1.35, 1.82);
        }
      }
    }
    if (lathe && drill) break;
  }
  if (!lathe) F3_DRESS_STATS.skipped.push('lathe');
  // the fitters' tool lockers and rolling tool chests by the benches (workshop loot)
  for (let i = 0; i < 2; i++) scanWall(D, a, 'cabinetTall', sides, 0.8, (alongX ? L0 : C0) + 2 + i * 1.2);
  for (const lf of [0.3, 0.7]) {
    const l = L0 + (L1 - L0) * lf + 1.4, c = mc + 1.3;
    place(D, a, 'rollingToolChest', alongX ? l : c, alongX ? c : l, alongX ? 0 : Math.PI / 2, {front: 0.6});
  }
  // walkway markings from the street door to the yard doors
  const sd = doorOf(D, a, A.streetN), yd = doorOf(D, a, A.yard);
  if (sd && yd) {
    const z = ((sd.y + sd.h / 2) * CELL), x = (yd.x + yd.w / 2) * CELL;
    deco(D, 'plasticSeat', {x0: ax0(a) + 0.2, x1: x + 0.9, z0: z - 1.0, z1: z - 0.92}, 0, 0.008);
    deco(D, 'plasticSeat', {x0: ax0(a) + 0.2, x1: x - 0.9, z0: z + 0.92, z1: z + 1.0}, 0, 0.008);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plant, yard, lobby, laundry, gas store

function plantRoom(f: F3): void {
  const {D, A} = f;
  const a = A.plant;
  if (!a) return;
  const gen = D.layout.props.find(p => p.kind === 'bunkerGenerator' && p.area === a.id);
  // hazard outline round the generator skid (0.6 m out), amber
  if (gen) {
    const m = 0.6, w = 0.12, x0 = gen.x - gen.hx - m, x1 = gen.x + gen.hx + m, z0 = gen.z - gen.hz - m, z1 = gen.z + gen.hz + m;
    for (const b of [{x0, x1, z0, z1: z0 + w}, {x0, x1, z0: z1 - w, z1}, {x0, x1: x0 + w, z0, z1}, {x0: x1 - w, x1, z0, z1}]) deco(D, 'plasticSeat', b, 0, 0.008);
  }
  // the switchboard: a row of panels on a wall without the generator
  const genSide: Side | null = gen ? (Math.abs(gen.z - az0(a)) < 1.6 ? 'N' : Math.abs(gen.z - az1(a)) < 1.6 ? 'S' : Math.abs(gen.x - ax0(a)) < 1.6 ? 'W' : 'E') : null;
  const walls = (['N', 'E', 'S', 'W'] as Side[]).filter(s => s !== genSide);
  let n = 0;
  for (const sd of walls) { if (n >= 3) break; n += rowAlongWall(D.ctx, a, sd, 'electricalPanel', {front: 1.0, max: 3 - n}).length; }
  // a diesel day tank on its spill bund against another wall
  for (const sd of walls.slice().reverse()) {
    const [lo, hi] = wallRange(a, sd);
    let done = false;
    for (let t = lo + 2.0; t < hi - 2.0; t += 0.5) {
      const b = wallBox(a, sd, t - 1.2, t + 1.2, 0.05, 1.3);
      if (!solid(D, a, b, 1.6)) continue;
      deco(D, 'shopFrame', b, 0, 0.03);
      deco(D, 'steelDark', wallBox(a, sd, t - 1.2, t + 1.2, 0.05, 0.12), 0, 0.18);
      deco(D, 'steelDark', wallBox(a, sd, t - 1.2, t + 1.2, 1.23, 1.3), 0, 0.18);
      deco(D, 'steelDark', wallBox(a, sd, t - 1.0, t + 1.0, 0.2, 1.15), 0.3, 1.4);
      deco(D, 'plasticSeat', wallBox(a, sd, t - 1.0, t + 1.0, 0.19, 1.16), 0.9, 1.02);
      deco(D, 'kitchenSteel', wallBox(a, sd, t + 0.6, t + 0.75, 0.6, 0.75), 1.4, 1.58);
      done = true;
      break;
    }
    if (done) break;
  }
}

function yard(f: F3): void {
  const {D, A} = f;
  const a = A.yard;
  if (!a) return;
  scanWall(D, a, 'palletJack', ['E', 'N'], 0.5);
  scanWall(D, a, 'gasCylinderCart', ['E'], 0.6);
  scanWall(D, a, 'handTruck', ['N'], 0.5);
  stock(scanWall(D, a, 'crate', ['E', 'S'], 0), 'storage');
  // the yard's electric tug and its flatbed trailer, parked along the north wall (anchored for good: flat batteries)
  for (let t = ax0(a) + 3; t < ax1(a) - 7.5; t += 0.5) {
    const tug = wallBox(a, 'N', t, t + 2.0, 0.6, 1.8), trl = wallBox(a, 'N', t + 2.3, t + 5.3, 0.55, 1.85);
    const box = (b: Box): Box => ({x0: Math.floor(b.x0 / CELL) * CELL + 0.01, x1: Math.ceil(b.x1 / CELL) * CELL - 0.01, z0: Math.floor(b.z0 / CELL) * CELL + 0.01, z1: Math.ceil(b.z1 / CELL) * CELL - 0.01});
    if (!freeFor(D, a, box(tug)) || !freeFor(D, a, box(trl))) continue;
    if (!solid(D, a, box(tug), 1.5)) continue;
    deco(D, 'plasticSeat', tug, 0.25, 1.0);
    deco(D, 'black', wallBox(a, 'N', t + 1.1, t + 1.6, 0.75, 1.65), 1.0, 1.45);
    deco(D, 'steelDark', wallBox(a, 'N', t + 0.1, t + 0.5, 0.7, 1.7), 1.0, 1.5);
    if (solid(D, a, box(trl), 0.75)) {
      deco(D, 'steelDark', trl, 0.45, 0.6);
      deco(D, 'black', wallBox(a, 'N', t + 2.0, t + 2.3, 1.1, 1.3), 0.4, 0.5);
    }
    break;
  }
  // a painted walkway down the yard from the street to the stair (keep-clear lines)
  const z = (az0(a) + az1(a)) / 2;
  deco(D, 'plasticSeat', {x0: ax0(a) + 0.2, x1: ax1(a) - 0.4, z0: z - 1.3, z1: z - 1.22}, 0, 0.008);
  deco(D, 'plasticSeat', {x0: ax0(a) + 0.2, x1: ax1(a) - 0.4, z0: z + 1.22, z1: z + 1.3}, 0, 0.008);
}

function lobby(f: F3): void {
  const {D, A, c} = f;
  const a = A.lobby;
  if (!a) return;
  // the loading-bay outline in front of the lift gate (its apron: held clear; floor paint only)
  const an = c.frame.anchors.find(q => q.id === 'lift');
  if (an) {
    const x0 = an.apron.x * CELL + 0.1, x1 = (an.apron.x + an.apron.w) * CELL - 0.1, z0 = an.apron.y * CELL + 0.1, z1 = (an.apron.y + an.apron.h) * CELL - 0.05;
    for (const b of [{x0, x1, z0, z1: z0 + 0.12}, {x0, x1: x0 + 0.12, z0, z1}, {x0: x1 - 0.12, x1, z0, z1}]) deco(D, 'plasticSeat', b, 0, 0.008);
  }
  scanWall(D, a, 'handTruck', ['W'], 0.5);
  scanWall(D, a, 'cartonStack', ['N'], 0, ax0(a) + 1);
  scanWall(D, a, 'cartonStack', ['W'], 0);
  stock(scanWall(D, a, 'cabinetTall', ['N', 'W'], 0.8, ax0(a) + 3), 'storage');
}

function laundry(f: F3): void {
  const {D, A} = f;
  const a = A.laundry;
  if (!a) return;
  // the machine bank: washers and a stacked dryer column along the wall with the fewest doors (anchored, one collision box)
  const ms: Side[] = (['N', 'S', 'W'] as Side[]).sort((p, q) => D.doors(a).filter(d => doorSide(d, a) === p).length - D.doors(a).filter(d => doorSide(d, a) === q).length);
  for (const sd of ms) {
    const [lo, hi] = wallRange(a, sd);
    const len = Math.min(4.5, hi - lo - 1.6);
    if (len < 3) continue;
    const t0 = lo + 0.8;
    const b = wallBox(a, sd, t0, t0 + len, 0.05, 0.8);
    if (!solid(D, a, b, 1.9, true)) continue;
    const n = Math.floor(len / 0.75);
    for (let i = 0; i < n; i++) {
      const s = t0 + i * 0.75;
      const stack = i % 3 === 2;
      deco(D, 'kitchenSteel', wallBox(a, sd, s + 0.02, s + 0.73, 0.05, 0.75), 0, stack ? 1.85 : 0.9);
      deco(D, 'black', wallBox(a, sd, s + 0.17, s + 0.58, 0.75, 0.78), 0.3, 0.71);
    }
    break;
  }
  const cx = (ax0(a) + ax1(a)) / 2, cz = (az0(a) + az1(a)) / 2;
  place(D, a, 'table', cx, cz + 0.6, a.w >= a.h ? Math.PI / 2 : 0, {ring: 0.7});
  for (let i = 0; i < 2; i++) placeAgainstWall(D.ctx, a, 'clothingRack', {front: 0.6, tries: 16});
  // (its linen shelving / cupboards are the station dresser's: the supply-closet purpose, dressings and linen)
}

function gasStore(f: F3): void {
  const {D, A} = f;
  const a = A.gasStore;
  if (!a) return;
  const back = OPP[doorSide(D.doors(a)[0] ?? ({x: a.x - 1, y: a.y, w: 1, h: 3} as Door), a)];
  for (const k of ['gasCylinderCart', 'oxygenCart'] as PropKind[]) scanWall(D, a, k, [back, 'N', 'S'], 0.5);
  scanWall(D, a, 'cabinetTall', ['N', 'S', back], 0.8);
  // the cylinder restraint rail along the back wall
  const [lo, hi] = wallRange(a, back);
  deco(D, 'plasticSeat', wallBox(a, back, lo + 0.3, hi - 0.3, 0.02, 0.06), 1.1, 1.16);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The infirmary

function clinic(f: F3): void {
  const {D, A} = f;
  const a = A.clinic;
  if (!a) return;
  // the reception desk on the south wall facing the main stair's arrival, its chair behind; planters either side
  const st = D.doors(a).find(d => d.y === a.y - 1 && d.x < a.x + 22);
  const tx = st ? (st.x + st.w / 2) * CELL + 4.5 : ax0(a) + 9;
  const desk = scanWall(D, a, 'receptionDesk', ['S'], 1.2, tx);
  // the reception's medicine and dressings cabinets on the wall behind it
  const kx = desk?.x ?? tx;
  stock(scanWall(D, a, 'medCabinet', ['S'], 0.9, kx - 2.4), 'first-aid-room');
  stock(scanWall(D, a, 'cabinetTall', ['S'], 0.8, kx + 2.3), 'first-aid-room');
  stock(scanWall(D, a, 'cabinetLow', ['S', 'W'], 0.7, kx - 4.2), 'first-aid-room');
  // waiting benches in rows facing the reception, between the stair and the street portal
  const bz = (az0(a) + az1(a)) / 2 - 0.6;
  let nb = 0;
  for (const x of [ax1(a) - 9.5, ax1(a) - 7.0, ax1(a) - 13.0]) for (const z of [bz - 1.0, bz + 0.6]) {
    if (nb >= 4) break;
    if (place(D, a, 'bench', x, z, 0, {ring: 0.5})) nb++;
  }
  scanWall(D, a, 'wheelchair', ['W', 'N'], 0.4);
  scanWall(D, a, 'waterCooler', ['N', 'W'], 0.5);
  scanWall(D, a, 'planterTree', ['N'], 0.3, ax1(a) - 0.8);
  scanWall(D, a, 'planterTree', ['N'], 0.3, ax1(a) - 11.0);
  placeAgainstWall(D.ctx, a, 'noticeBoard', {sides: ['N', 'W'], y: 1.1, tries: 20});
}

/** The casualty ward: bays along both long walls under curtain rails, stretcher beds in most, drip stands, the nurses' station. */
function ward(f: F3): void {
  const {D, A} = f;
  const a = A.ward;
  if (!a) return;
  const bayW = 2.6, bayD = 2.4, railY = 2.35;
  const main = D.doors(a)[0];
  let beds = 0;
  for (const sd of ['S', 'N'] as Side[]) {
    const [lo, hi] = wallRange(a, sd);
    const n = Math.floor((hi - lo - 1.0) / bayW);
    const t0 = lo + (hi - lo - n * bayW) / 2;
    const fc = face(a, sd), [, nz] = NORMAL[sd];
    const zFront = fc - nz * bayD;
    let run0 = -1;
    const flush = (i: number) => {
      if (run0 < 0) return;
      const s0 = t0 + run0 * bayW, s1 = t0 + i * bayW;
      deco(D, 'steelBright', {x0: s0, x1: s1, z0: zFront - 0.02, z1: zFront + 0.02}, railY, railY + 0.04);
      for (let k = run0; k <= i; k++) if (k === run0 || k === i || (k - run0) % 2 === 0) deco(D, 'steelBright', {x0: t0 + k * bayW - 0.02, x1: t0 + k * bayW + 0.02, z0: Math.min(fc, zFront), z1: Math.max(fc, zFront)}, railY, railY + 0.04);
      run0 = -1;
    };
    for (let i = 0; i < n; i++) {
      const s0 = t0 + i * bayW, s1 = s0 + bayW, mid = (s0 + s1) / 2;
      // never a bay across a doorway's clear volume
      if (main && propBlocksDoorway(D.layout, mid, (fc + zFront) / 2, bayW / 2, Math.abs(fc - zFront) / 2, D.base, 2.0)) { flush(i); continue; }
      if (run0 < 0) run0 = i;
      // the bed: a stretcher with its head to the wall, every bay but a seeded empty one or two
      let bed = false;
      if (D.rng.chance(0.55)) {
        const sp = wallSpot(a, sd, mid, 'wheeledStretcher');
        const p = place(D, a, 'wheeledStretcher', sp.x, sp.z, sd === 'N' ? 0 : Math.PI, {});
        if (p) {
          beds++; bed = true;
          if (D.rng.chance(0.35)) place(D, a, 'ivPole', mid + 0.75, fc - nz * 0.45, sd === 'N' ? 0 : Math.PI, {});
        }
      }
      // a stripped bay keeps its dressings cabinet against the wall
      if (!bed) { const sp = wallSpot(a, sd, mid, 'cabinetTall'); stock(place(D, a, 'cabinetTall', sp.x, sp.z, sp.rot, {front: 0.8}), 'first-aid-room'); }
    }
    flush(n);
  }
  F3_DRESS_STATS.beds += beds;
  // the nurses' station by the ward door: a desk and a medicine cabinet
  if (main) {
    const t = (main.x + main.w / 2) * CELL;
    scanWall(D, a, 'desk', ['N'], 0.9, t + 3.2);
    stock(scanWall(D, a, 'medCabinet', ['N'], 0.9, t - 3.0), 'first-aid-room');
    stock(scanWall(D, a, 'cabinetLow', ['N'], 0.7, t + 5.5), 'first-aid-room');
  }
  // fixtures over the aisle
  for (let x = ax0(a) + 2.5; x < ax1(a) - 1; x += 5.5) light(D, a, x, (az0(a) + az1(a)) / 2, rel(D, a) - 0.05, true);
}

/** The isolation ward: glazed cubicles along the wall opposite its door, a bed in each, the medium gas leak. */
function isolation(f: F3): void {
  const {D, A} = f;
  const a = A.isolation;
  if (!a) return;
  const door = D.doors(a)[0];
  const back: Side = door ? OPP[doorSide(door, a)] : 'N';
  const [lo, hi] = wallRange(a, back);
  const fc = face(a, back), [nx, nz] = NORMAL[back];
  const along = back === 'N' || back === 'S';
  const deep = 3.0, cw = 3.5, gap = 1.0, glassH = 2.4;
  const n = Math.max(1, Math.min(4, Math.floor((hi - lo - 0.5) / cw)));
  const t0 = lo + (hi - lo - n * cw) / 2;
  // the glazing line (one cell thick, on whole cells), doorway gaps of 2 cells in each cubicle front
  const off = Math.round(deep / CELL) * CELL;
  const line = fc - (nx + nz) * off; // world coordinate of the glazing cells' near edge (the wall's normal points into the room)
  const l0 = Math.min(line, line - (nx + nz) * CELL), l1 = Math.max(line, line - (nx + nz) * CELL);
  const seg = (s0: number, s1: number): Box => (along ? {x0: s0, x1: s1, z0: l0 + 0.01, z1: l1 - 0.01} : {x0: l0 + 0.01, x1: l1 - 0.01, z0: s0, z1: s1});
  const cuts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const g0 = Math.round((t0 + i * cw + cw / 2 - gap / 2) / CELL) * CELL;
    cuts.push([g0, g0 + gap]);
  }
  let s = Math.round(t0 / CELL) * CELL;
  const pieces: Box[] = [];
  for (const [g0, g1] of cuts) { if (g0 - s >= CELL) pieces.push(seg(s, g0)); s = g1; }
  const tEnd = Math.round((t0 + n * cw) / CELL) * CELL;
  if (tEnd - s >= CELL) pieces.push(seg(s, tEnd));
  let ok = 0;
  for (const b of pieces) {
    if (!solid(D, a, b, glassH, false)) continue;
    ok++;
    deco(D, 'glassShopfront', along ? {x0: b.x0, x1: b.x1, z0: (b.z0 + b.z1) / 2 - 0.03, z1: (b.z0 + b.z1) / 2 + 0.03} : {x0: (b.x0 + b.x1) / 2 - 0.03, x1: (b.x0 + b.x1) / 2 + 0.03, z0: b.z0, z1: b.z1}, 0.1, glassH);
  }
  // the side walls between cubicles (glass, on the cell line between them)
  for (let i = 1; i < n; i++) {
    const t = Math.round((t0 + i * cw) / CELL) * CELL;
    const b: Box = along ? {x0: t - CELL + 0.01, x1: t - 0.01, z0: Math.min(fc, line) + 0.01, z1: Math.max(fc, line) - 0.01} : {x0: Math.min(fc, line) + 0.01, x1: Math.max(fc, line) - 0.01, z0: t - CELL + 0.01, z1: t - 0.01};
    if (!solid(D, a, b, glassH, false)) continue;
    deco(D, 'glassShopfront', along ? {x0: t - 0.28, x1: t - 0.22, z0: b.z0, z1: b.z1} : {x0: b.x0, x1: b.x1, z0: t - 0.28, z1: t - 0.22}, 0.1, glassH);
  }
  F3_DRESS_STATS.cubicles += ok ? n : 0;
  // a bed in each cubicle, head to the back wall; a drip stand beside some
  for (let i = 0; i < n; i++) {
    const mid = t0 + i * cw + cw / 2 + (i % 2 ? 0.6 : -0.6);
    const sp = wallSpot(a, back, mid, 'wheeledStretcher');
    if (place(D, a, 'wheeledStretcher', sp.x, sp.z, sp.rot, {})) {
      F3_DRESS_STATS.beds++;
      if (i % 2 === 0) place(D, a, 'ivPole', along ? mid + 0.85 : fc - nx * 0.45, along ? fc - nz * 0.45 : mid + 0.85, sp.rot, {});
    }
  }
  scanWall(D, a, 'bin', [OPP[back]], 0);
  stock(scanWall(D, a, 'medCabinet', [OPP[back]], 0.9), 'first-aid-room');
  stock(scanWall(D, a, 'cabinetLow', [OPP[back], 'W', 'E'], 0.7), 'first-aid-room');
}

/** The clinical corridor's dressings cabinet, the dispensary's shelving, the yard's tool lockers. */
function stores(f: F3): void {
  const {D, A} = f;
  const corr = A.corridor, disp = A.dispensary, yd = A.yard;
  if (corr) stock(scanWall(D, corr, 'medCabinet', ['W', 'E'], 0.9, (az0(corr) + az1(corr)) / 2 - 3), 'first-aid-room');
  if (disp) { for (let i = 0; i < 2; i++) stock(scanWall(D, disp, 'medCabinet', ['N', 'S', 'W'], 0.9), 'first-aid-room'); }
  if (yd) for (let i = 0; i < 2; i++) stock(scanWall(D, yd, 'cabinetTall', ['N'], 0.8, ax1(yd) - 2 - i * 1.2), 'storage');
}

function treatment(f: F3): void {
  const {D, A} = f;
  const a = A.treatment;
  if (!a) return;
  place(D, a, 'examTable', (ax0(a) + ax1(a)) / 2, (az0(a) + az1(a)) / 2, a.w >= a.h ? Math.PI / 2 : 0, {ring: 0.7});
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plates

const PLATE: Partial<Record<F3Key, string>> = {
  depot: 'SUPPLY DEPOT · GOODS INWARD', lobby: 'FREIGHT LIFT', laundry: 'LAUNDRY', fab: 'FABRICATION', yard: 'WORKS YARD', gasStore: 'MEDICAL GASES · NO NAKED FLAMES',
  washroom: 'WASHROOM', medStores: 'MEDICAL STORES', clinic: 'INFIRMARY', ward: 'CASUALTY WARD', corridor: 'CLINICAL CORRIDOR', treatment: 'TREATMENT ROOM',
  dispensary: 'DISPENSARY', airlock: 'ISOLATION · MASKS ON', isolation: 'ISOLATION WARD · NO ENTRY',
};

function plates(f: F3): void {
  const {D, A, c} = f;
  const mine = new Set(Object.values(c.carved.areas));
  // the storey plate at both stair landings (on this storey's side of each landing door)
  for (const an of c.frame.anchors) {
    if (an.id !== 'stairA' && an.id !== 'stairB') continue;
    const d = D.layout.doors.find(q => (q.level ?? 0) === D.lv && q.x === an.gate.x && q.y === an.gate.y && q.w === an.gate.w);
    if (!d) continue;
    const out = mine.has(d.a) ? D.layout.areas[d.a] : mine.has(d.b) ? D.layout.areas[d.b] : null;
    if (out) doorPlate(D, d, out, V2_STOREY_PLATES[D.lv], 2.6);
  }
  for (const [key, text] of Object.entries(PLATE) as [F3Key, string][]) {
    const a = A[key];
    if (!a) continue;
    const ds = D.doors(a);
    const d = ds.find(q => q.a === a.parent || q.b === a.parent) ?? ds[0];
    if (!d) continue;
    const outside = D.layout.areas[d.a === a.id ? d.b : d.a];
    const near = new Set(D.layout.signs.filter(sg => sg.area === outside.id && sg.kind === 'service' && Math.hypot(sg.x - (d.x + d.w / 2) * CELL, sg.z - (d.y + d.h / 2) * CELL) < 2.6));
    if (near.size) D.layout.signs = D.layout.signs.filter(sg => !near.has(sg));
    if (doorPlate(D, d, outside, text, text.length > 16 ? 2.4 : 1.6)) F3_DRESS_STATS.signs++;
  }
  // the generator's own plate inside its room
  const p = A.plant;
  if (p) wallSign(D, p, 'N', (ax0(p) + ax1(p)) / 2, 3.2, {kind: 'service', text: 'AUX GENERATOR 2 · DANGER', w: 2.4});
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function dressFloor3(c: FloorDressCtx): void {
  const S = F3_DRESS_STATS;
  S.props = S.decor = S.lights = S.signs = S.racks = S.beds = S.cubicles = 0;
  S.skipped = [];
  const {layout} = c;
  const A: Partial<Record<F3Key, Area>> = {};
  for (const [k, id] of Object.entries(c.carved.areas)) A[k as F3Key] = layout.areas[id];
  const areas = Object.values(A).filter((a): a is Area => !!a);
  const D = shelterDx(layout, c.level, c.rng.fork('f3'), areas);
  for (const i of c.held) D.held.add(i);
  const f: F3 = {D, c, A};
  const p0 = layout.props.length, d0 = layout.decor.length;
  const step = (name: string, fn: (f: F3) => void) => { try { fn(f); } catch (e) { S.skipped.push(`${name}: ${(e as Error).message}`); } };
  step('street', street);
  step('depot', depot);
  step('fabrication', fabrication);
  step('plant', plantRoom);
  step('yard', yard);
  step('lobby', lobby);
  step('laundry', laundry);
  step('gasStore', gasStore);
  step('clinic', clinic);
  step('ward', ward);
  step('isolation', isolation);
  step('treatment', treatment);
  step('stores', stores);
  step('plates', plates);
  // the guarantee: no floor pocket anywhere on the storey (a prop of this pass that closes one off goes again)
  sweepPockets(D, areas, p0);
  S.props = layout.props.length - p0;
  S.decor = layout.decor.length - d0;
  void FLOOR;
}
