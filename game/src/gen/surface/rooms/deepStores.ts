// Task studio-surface-run-field-followup-20261116-211729-01 (lane INTERIOR): the v2 DEEP STORE — every store programme's shop as a place to
// explore (user: "Deepen enterable destinations with logical public/back rooms, connected storeys/stairs/landings and real rooftop access on
// suitable buildings"), on the programme table of the first release (rooms/stores.ts STORE_SPECS: the sales floor recipe and the
// programme's back rooms — stock room, cooler, prep, dispensary, office, staff room, washroom …). v1 plots never come here
// (rooms/index.ts branches on InteriorPlot.deep).
//
// Layout (local frame, rooms/builder.ts; v = depth from the shopfront):
//   - the SALES FLOOR behind the shopfront (a café corner on a wide bookshop), its staff door onto
//   - the BACK CORRIDOR across the building (3 cells = 1.5 m), every back room's door on it;
//   - the BACK ZONE on the back wall: the dog-leg stair core (rooms/deepCore.ts) at one side (the end with fewer side / back doors), the
//     programme's back rooms beside it;
//   - with a second walkable storey (GEN: two or more drawn storeys) the UPPER FLOOR: the upper corridor over the back one, an upper sales
//     floor (the programme's `upper` recipe) or the store's offices / storage / staff room over the shop, a back store and a washroom
//     beside the core;
//   - on a one-storey intact store (GEN: InteriorPlot.deep.roof) the ROOF: the stair climbs into a BULKHEAD (the core + a one-cell wall on
//     the roof) whose door opens onto the walkable roof inside the parapet (outdoor areas of the roof's level: the district's outdoor air),
//     dressed with the Office roof's existing plant (rooftop HVAC units, a satellite dish) and its own loose finds (rooms/finish.ts planLoose).
// No core fits (a very shallow plot): one storey with the corridor and the back rooms. Never fails: false only when even that does not fit
// (the caller falls back to the first release's store plan).

import type {MallProgram} from '../../mall/mallTypes';
import {CELL} from '../../grid';
import type {Rect, Side} from '../../stationTypes';
import {SKY_CEIL} from '../cityCarve';
import type {SurfaceEntrance, SurfaceRoofAccess} from '../surfaceTypes';
import type {InteriorBuilder, LRect, RoomInfo} from './builder';
import type {InteriorFloor} from './api';
import {BULKHEAD, DOGLEG, carveDogLeg, dogLegLength} from './deepCore';
import {againstWall, breakRoom, convenienceFloor, copyRoom, privateOffice, sales, stockRoom, washroom} from './dress';
import {STORE_SPECS, type Back} from './stores';
import type {SurfaceProgrammeId} from './programmes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Back corridor depth (cells), the least sales floor depth (cells), the least back-room width (cells). */
export const DEEP_STORE = {corridor: 3, minSales: 10, minRoom: 6} as const;

/** The plan of a v2 store (rooms/index.ts); false = nothing fits (the caller falls back to the first release's plan). */
export function planDeepStore(b: InteriorBuilder): boolean {
  const spec = STORE_SPECS[b.pid as SurfaceProgrammeId] ?? STORE_SPECS.convenience!;
  const rng = b.rng.fork('deep-store');
  const {W, D} = b;
  const C = DEEP_STORE.corridor;
  if (W < 8 || D < DEEP_STORE.minSales + C + 4) return false;
  const roof = b.deep?.roof ?? null;
  // the core's second storey: the walkable upper floor, else the roof (a storey of its own once carved)
  const top: InteriorFloor | null = b.storeys.length >= 2 ? b.storeys[1]
    : roof ? {level: roof.level, y: r3(roof.y), ceil: r3(roof.y + BULKHEAD.inner)} : null;
  const Lc = top ? dogLegLength(b.storeys[0].y, top.y) : 0;
  const coreFits = !!top && D - Lc - C - 2 >= DEEP_STORE.minSales && W >= DOGLEG.width + 1 + DEEP_STORE.minRoom;
  // --- the frame: the sales wall at v = S, the corridor [S + 1, bz - 1), the back zone [bz, D) ------------------------------------
  const bz = coreFits ? D - Lc : D - Math.max(8, Math.min(14, Math.round(D * spec.back)));
  let S = bz - C - 2;
  S = b.clearLine('v', S, Math.max(DEEP_STORE.minSales, S - 4), S, [0, W - 1]);
  if (S < DEEP_STORE.minSales - 2) return false;
  // the core at the side whose facade / back doors it would take fewer of ('hi' on a tie)
  const hits = (u0: number): number => b.ents.reduce((s, en) => {
    if (en.local === 'B') return s + Math.max(0, Math.min(en.s1, u0 + DOGLEG.width) - Math.max(en.s0, u0 - 1) + 1);
    if ((en.local === 'L' && u0 === 0) || (en.local === 'R' && u0 + DOGLEG.width === W)) return s + Math.max(0, en.s1 - Math.max(en.s0, bz - 2) + 1);
    return s;
  }, 0);
  const cu = !coreFits ? -1 : hits(0) < hits(W - DOGLEG.width) ? 0 : hits(0) > hits(W - DOGLEG.width) ? W - DOGLEG.width : rng.chance(0.5) ? 0 : W - DOGLEG.width;
  const zone: LRect = cu < 0 ? {u: 0, v: bz, du: W, dv: D - bz} : {u: cu === 0 ? DOGLEG.width + 1 : 0, v: bz, du: W - DOGLEG.width - 1, dv: D - bz};
  // --- street storey ------------------------------------------------------------------------------------------------------------
  const floor = rng.weighted(spec.floor);
  let salesL: LRect = {u: 0, v: 0, du: W, dv: S}, cafeL: LRect | null = null;
  if (spec.cafe && W >= 30) {
    const cw = Math.max(10, Math.round(W * 0.34)), right = rng.chance(0.5);
    const c = b.clearLine('u', right ? W - cw - 1 : cw, (right ? W - cw - 1 : cw) - 4, (right ? W - cw - 1 : cw) + 4, [0, S - 1]);
    salesL = right ? {u: 0, v: 0, du: c, dv: S} : {u: c + 1, v: 0, du: W - c - 1, dv: S};
    cafeL = right ? {u: c + 1, v: 0, du: W - c - 1, dv: S} : {u: 0, v: 0, du: c, dv: S};
  }
  const sale = b.room(0, salesL, {type: spec.type ?? 'shop', label: spec.label, role: 'sales', front: true, windows: 'shop', enemies: 2.2});
  if (!sale) return false;
  const cafe = cafeL ? b.room(0, cafeL, {type: 'eatery', label: 'Café', role: 'cafe', front: true, windows: 'shop', enemies: 1}) : null;
  if (cafe) b.door(sale, cafe, 6, {at: 'mid', margin: 2});
  const corrL: LRect = {u: 0, v: S + 1, du: W, dv: bz - 1 - (S + 1)};
  const corr = b.room(0, corrL, {type: 'service-corridor', label: 'Back corridor', role: 'corridor', windows: 'none', noLoose: true, enemies: 0.5});
  b.door(corr, sale, 3, {at: r3(rng.range(0.15, 0.85)), staff: true});
  const backs = backRooms(b, 0, zone, spec.rooms);
  for (const {spec: q, r} of backs) b.door(r, corr, q.door ?? 2, {at: 'mid', staff: !q.front});
  // --- the core and the second storey -------------------------------------------------------------------------------------------
  let landings: RoomInfo[] = [];
  const isRoof = !!top && b.storeys.length < 2;
  if (coreFits && top) {
    if (isRoof) b.storeys.push(top);
    const L: LRect = {u: cu, v: bz, du: DOGLEG.width, dv: Lc};
    const dl = carveDogLeg(b, L, 'v', 'lo', top.ceil, isRoof ? 'Stairs · Roof' : 'Stairs · Upper floor');
    if (dl) {
      landings = dl.landings;
      b.landingDoor(landings[0], corr);
    } else if (isRoof) b.storeys.pop();
  }
  b.connectAll(0, sale);
  const ups: RoomInfo[] = [];
  let upperSales: RoomInfo | null = null;
  if (landings[1] && !isRoof) {
    const corr1 = b.room(1, corrL, {type: 'service-corridor', label: 'Upstairs corridor', role: 'hall', windows: 'none', noLoose: true, enemies: 0.4});
    b.landingDoor(landings[1], corr1);
    if (spec.upper !== 'offices') {
      upperSales = b.room(1, {u: 0, v: 0, du: W, dv: S}, {type: 'shop', label: 'Upper floor', role: 'sales', front: true, windows: 'office', enemies: 1.6});
      b.door(corr1, upperSales, 4, {at: 'mid'});
    } else {
      const labels = [['Manager\'s office', 'office', 'office-room'], ['Storage', 'storage', 'storage'], ['Staff room', 'staff', 'crew-room']] as const;
      b.split('u', 0, W, [1.2, 1.0, 0.8], 10, [0, S - 1]).forEach(([s, e], j) => {
        const r = b.room(1, {u: s, v: 0, du: e - s, dv: S}, {type: labels[j][2], label: labels[j][0], role: labels[j][1], windows: 'office'});
        if (r) { ups.push(r); b.door(r, corr1, 2, {at: 'mid'}); }
      });
    }
    if (zone.du >= DEEP_STORE.minRoom) {
      const bs = b.split('u', zone.u, zone.u + zone.du, [1.4, 0.6], DEEP_STORE.minRoom, [zone.v, zone.v + zone.dv - 1]);
      bs.forEach(([s, e], j) => {
        const r = b.room(1, {u: s, v: zone.v, du: e - s, dv: zone.dv}, j === bs.length - 1 && bs.length > 1
          ? {type: 'washroom', label: 'Washroom', role: 'washroom', windows: 'small', enemies: 0.3}
          : {type: 'storage', label: 'Back store', role: 'store', windows: 'none'});
        if (r) { ups.push(r); b.door(r, corr1, 2, {at: 'mid', staff: true}); }
      });
    }
    b.connectAll(1, corr1);
  }
  if (landings[1] && isRoof && roof) carveRoof(b, landings[1], {u: cu, v: bz, du: DOGLEG.width, dv: Lc}, rng.fork('roof'));
  // --- dressing ---------------------------------------------------------------------------------------------------------------
  const cuisine = spec.cuisine ? rng.pick(spec.cuisine) : undefined;
  if (floor === 'convenience' || floor === 'liquor') convenienceFloor(b, sale, floor === 'liquor');
  else sales(b, sale, floor, cuisine ? {cuisine} : {});
  if (cafe) sales(b, cafe, 'cafe', {cuisine: 'coffee'});
  for (const {spec: q, r} of backs) q.dress(b, r, sale);
  if (upperSales) sales(b, upperSales, spec.upper as MallProgram, {front: 'B'});
  for (const r of ups) {
    if (r.role === 'office') privateOffice(b, r, true);
    else if (r.role === 'storage') copyRoom(b, r, true);
    else if (r.role === 'staff') breakRoom(b, r);
    else if (r.role === 'washroom') washroom(b, r);
    else if (r.role === 'store') stockRoom(b, r, 'storage', 'cartons');
  }
  return true;
}

/** The programme's back rooms across a zone (fewer when narrow: the leading ones kept, the washroom last). */
function backRooms(b: InteriorBuilder, k: number, Z: LRect, order: readonly Back[]): {spec: Back; r: RoomInfo}[] {
  if (Z.du < DEEP_STORE.minRoom || Z.dv < 4 || !order.length) return [];
  const spans = b.split('u', Z.u, Z.u + Z.du, order.map(q => q.w), DEEP_STORE.minRoom, [Z.v, Z.v + Z.dv - 1]);
  const kept = spans.length >= order.length ? order : [...order.slice(0, spans.length - 1), order[order.length - 1]].slice(0, spans.length);
  const out: {spec: Back; r: RoomInfo}[] = [];
  spans.forEach(([s, e], j) => {
    const q = kept[j];
    const r = b.room(k, {u: s, v: Z.v, du: e - s, dv: Z.dv}, {type: q.type, label: q.label, role: q.role, front: q.front, windows: q.windows ?? 'none', enemies: q.enemies ?? 1});
    if (r) out.push({spec: q, r});
  });
  return out;
}

/** Roof dressing: the Office roof's plant (anchored machinery / fixtures: world/openablesSpec.ts roofHvac / satelliteDish). */
const ROOF_PLANT = {hvac: [1, 2], dish: 0.5} as const;

/**
 * The roof of a one-storey store (storey 1 = the roof): the walkable roof inside the parapet as outdoor areas of the roof's level (the
 * inner rect minus the bulkhead: one rect in front of it, one beside it), the bulkhead (the core + a one-cell wall on the roof; its other two
 * sides are the parapet), the roof door from the top landing, the plant, and the SurfaceRoofAccess record (InteriorPlan.features.roof).
 */
function carveRoof(b: InteriorBuilder, landing: RoomInfo, core: LRect, rng: InteriorBuilder['rng']): void {
  const f = b.storeys[1], {W, D} = b;
  const left = core.u === 0;
  const bulk: LRect = {u: left ? 0 : core.u - 1, v: core.v - 1, du: DOGLEG.width + 1, dv: D - core.v + 1};
  const parts: LRect[] = [{u: 0, v: 0, du: W, dv: bulk.v}];
  if (W - bulk.du >= 2) parts.push({u: left ? bulk.du : 0, v: bulk.v, du: W - bulk.du, dv: bulk.dv});
  const roofs: RoomInfo[] = [];
  for (const P of parts) {
    if (P.du < 2 || P.dv < 2) continue;
    const a = b.kit.addArea(b.rect(P), 'concourse', 'street', SKY_CEIL, -1, {label: `${b.b.name} · Roof`, level: f.level, floorY: f.y, publicSpace: false});
    a.lighting = 'lit';
    const info: RoomInfo = {area: a, storey: 1, role: 'roof', front: false, windows: 'none', enemies: 0.5};
    b.rooms.push(info);
    roofs.push(info);
  }
  const front = roofs[0];
  if (!front || front.area.h < 1) return;
  // the roof door: through the bulkhead's front wall row, in front of the top landing
  const du = BULKHEAD.door, u0 = core.u + Math.floor((DOGLEG.width - du) / 2);
  const gapL: LRect = {u: u0, v: core.v - 1, du, dv: 1};
  const gap: Rect = b.rect(gapL);
  const d = b.kit.carveDoor(gap, front.area, landing.area, BULKHEAD.doorH, false, {staff: true});
  const g = b.kit.grid(f.level);
  const cells: number[] = [];
  for (let y = gap.y; y < gap.y + gap.h; y++) for (let x = gap.x; x < gap.x + gap.w; x++) cells.push(g.idx(x, y));
  // world records: the inner rect inside the parapet, the bulkhead over its facade ring sides, the door on its roof-side face
  const side: Side = b.front;
  const toM = (r: Rect) => ({x0: r.x * CELL, z0: r.y * CELL, x1: (r.x + r.w) * CELL, z1: (r.y + r.h) * CELL});
  const walk = toM(b.rect({u: 0, v: 0, du: W, dv: D}));
  // the bulkhead's facade sides (back wall, its side wall) extend over the facade ring: its walls stand on the building's own walls there
  const bulkOut: LRect = {u: left ? bulk.u - 1 : bulk.u, v: bulk.v, du: bulk.du + 1, dv: bulk.dv + 1};
  const bm = toM(b.rect(bulkOut));
  const gm = toM(gap);
  const alongX = side === 'N' || side === 'S';
  const lineZ = side === 'N' ? gm.z0 : gm.z1, lineX = side === 'W' ? gm.x0 : gm.x1;
  const door: SurfaceEntrance = {id: `b${b.b.id}-roof`, building: b.b.id, level: f.level, x: r3(alongX ? (gm.x0 + gm.x1) / 2 : lineX), z: r3(alongX ? lineZ : (gm.z0 + gm.z1) / 2), side,
    width: du * CELL, height: d.height, inner: landing.area.id, outer: front.area.id, door: b.b.condition === 'gutted' || b.b.condition === 'collapsed' ? 'smashed' : 'closed',
    cells, doorIndex: d.id};
  const access: SurfaceRoofAccess = {level: f.level, y: f.y, walk, bulkhead: {...bm, side, h: BULKHEAD.h}, door, areas: roofs.map(r => r.area.id)};
  b.features = {...(b.features ?? {}), roof: access};
  // the plant against the parapet (anchored: never blocks the way round — the placement kit keeps the door zones clear)
  const ctx = b.ctx(1);
  const n = rng.int(ROOF_PLANT.hvac[0], ROOF_PLANT.hvac[1]);
  for (let k = 0; k < n; k++) againstWall(b, ctx, rng.pick(roofs).area, 'roofHvac');
  if (rng.chance(ROOF_PLANT.dish)) againstWall(b, ctx, rng.pick(roofs).area, 'satelliteDish');
}
