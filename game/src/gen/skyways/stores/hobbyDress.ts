// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-HOBBY): GRAIN ELEVATOR MODELS — the layout-version-3 interior of the
// Skyways hobby / model shop (a 'hall': one big sales floor, plus its back rooms). A real model shop, not toys in a Subway box:
//
//  - the CASH DESK by the entry (a flank wall near the front, else the front wall beside the entry): a till counter and a glass display
//    counter in a run facing the shop, a staff aisle behind them and the wall-backed BACK COUNTER (Mall M01 mallCashwrapCounter: 5
//    drawers + a cupboard that open) behind the aisle;
//  - the tin-toy ROBOT greeting the entry and the model-railway LAYOUT TABLE (the prairie grain-elevator diorama, kit model) as the
//    centrepiece with a clear viewing ring;
//  - the WORKBENCH / demo corner on a far wall: a desk with drawers (the demo table: soldering station + toolbox on top, a chair at it,
//    a tool pegboard above), a rolling tool chest (8 drawers) with wall parts bins above it, and the PAINT RACK beside it (stock
//    shelving of paint tins, tubes and supplies: the 'parts' stock theme's 3D filler);
//  - GLASS DISPLAY CASES (Mall M02 glassDisplayCabinet: glass doors that open) along a wall, sideboard EXHIBITS (openable cabinetLow
//    with the airship / a cased ship model on top), an architectural model on its plinth, a pair of capsule-toy machines;
//  - KIT WALLS (open steel shelving along the free walls) and low KIT AISLES (Mall M03 gondola runs, back to back, 1.4 m: the layout
//    stays in view over them), all stocked with separate loose stacks of boxed kits (skyDModelKits) on their measured tiers;
//  - the family's poster art (lane ART2D's Codex hobby poster) on solid walls;
//  - BACK ROOMS: the stock room keeps the station dresser's shelving / cartons / crates and gains openable cartons and a storage tote
//    (a staff desk when the store has no office); staff lockers go in the office, else the stock room, else (both full) on the cash
//    desk's wall behind it. Without any back room a whole staff stock corner (tall cabinet, carton shelving, an openable carton,
//    lockers) stands there.
//
// Loot (gen/skyways/stores/hobby.ts STORE_HOBBY.purposes + the per-holder keys HOBBY_HOLDER_PURPOSE below — existing purposes only, the
// ramen precedent: PropPlacement.purpose): the sales floor rolls the Mall toy store ('mall-toys': batteries, snacks and drinks left
// behind), the workbench / tool chest / paint rack the Mall hardware store ('mall-hardware': batteries, flares, a dressing, water),
// the glass cases the Mall electronics store ('mall-electronics': batteries first — the RC / train-controller case), the back rooms
// and the staff corner the toy store's stock room ('mall-toys-back').
//
// Placement: the destinations' anchor kit (destinations/skywaysShopsAKit.ts AnchorKit: local height frame, door / stair / entry
// reserves, walking lanes, cell-exact packing, all-or-nothing clusters). The shopsA helpers this store needs (lattice / fillRuns /
// shelfItems / exhibitOn) are private to that file and its v1/v2 output is pinned, so their few lines are re-stated here.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, SHELF_TIER_Y, SHOP_COUNTER_TOP_Y, footprint, type PropKind, type PropPlacement} from '../../props';
import {stockVariant} from '../../purposeShapes';
import {WALL_ROT, begin, commit, makePlaceCtx, mountProp, rollback, tryPlaceProp, wallRange, wallSpot, wallXZ, type PlaceCtx} from '../../placeKit';
import type {Area, Side, StationLayout} from '../../stationTypes';
import type {SkywaysAnchor} from '../skywaysTypes';
import {normYaw, toWorld} from '../addonFrame';
import {AnchorKit, r3, snapEdge, type ShopsALane} from '../destinations/skywaysShopsAKit';
import {destDims} from '../destinations/kindsShopsA';

/** Per-holder loot keys (existing purposes) of the store's themed holders; every other holder rolls its area's purpose. */
export const HOBBY_HOLDER_PURPOSE = {
  /** The workbench desk, the rolling tool chest and the paint rack: craft / hardware supplies. */
  workbench: 'mall-hardware',
  /** The glass display cabinets and the glass display counter: the RC / train-controller case. */
  glass: 'mall-electronics',
  /** The staff corner on the sales floor (its lockers / stock storage are the back of house's). */
  staff: 'mall-toys-back',
} as const;

/** What the dresser placed, by role (QA / tests: hobbyRoleProps finds them in the finished layout). */
export type HobbyRole =
  | 'backCounter' | 'till' | 'glassCounter' | 'register' | 'robot' | 'diorama'
  | 'workbench' | 'toolChest' | 'paintRack' | 'pegboard' | 'partsBins' | 'benchTop' | 'chair'
  | 'glassCase' | 'sideboard' | 'exhibit' | 'model' | 'capsule' | 'kitShelf' | 'kitGondola' | 'kitStack' | 'poster'
  | 'staffCorner' | 'backStorage' | 'staffDesk';
export interface HobbyStoreResult {
  anchor: string;
  /** A point 1.25 m inside the storefront entry (world m) and the store's storey. */
  entry: {x: number; z: number; level: number};
  /** The flank (frame end: 0 = u 0, 1 = u W) the cash desk stands on / beside, -1 when the fallback counter was used. */
  cashEnd: 0 | 1 | -1;
  roles: Partial<Record<HobbyRole, PropPlacement[]>>;
  lanes: ShopsALane[];
  skipped: string[];
  placed: number;
}
const RESULTS = new WeakMap<StationLayout, HobbyStoreResult[]>();
/** QA / tests: the hobby stores dressed in a layout (the generator ignores it). */
export function hobbyStoreDressOf(layout: StationLayout): readonly HobbyStoreResult[] { return RESULTS.get(layout) ?? []; }
/**
 * QA / tests: a role's props as they stand in the finished layout (matched by kind, position and storey — robust to a later pass
 * re-creating the prop records).
 */
export function hobbyRoleProps(layout: StationLayout, rec: HobbyStoreResult, role: HobbyRole): PropPlacement[] {
  const key = (p: PropPlacement) => `${p.kind}@${p.x},${p.z},${p.y},${p.level ?? 0}`;
  const want = new Set((rec.roles[role] ?? []).map(key));
  return want.size ? layout.props.filter(p => want.has(key(p))) : [];
}

/** Kit-stack budget per store (each stack is an ~830-triangle instance; enough to read as packed kit walls). */
export const HOBBY_KIT_STACKS = 140;

/** Dresses one Grain Elevator Models anchor (layout version >= 3). Returns the props placed. */
export function dressHobbyStore(layout: StationLayout, rng: Rng, anchor: SkywaysAnchor): number {
  if (!layout.areas[anchor.floor]) return 0;
  const kit = new AnchorKit(layout, rng, anchor);
  const [ix, iz] = kit.inside(1.25);
  const res: HobbyStoreResult = {anchor: anchor.id, entry: {x: r3(ix), z: r3(iz), level: kit.level}, cashEnd: -1, roles: {}, lanes: kit.lanes, skipped: kit.skipped, placed: 0};
  const add = (role: HobbyRole, ...ps: (PropPlacement | null | undefined)[]) => { for (const p of ps) if (p) (res.roles[role] ??= []).push(p); };
  kit.reserveDoors();
  // the fixed pieces first (the lanes route round them): the cash desk, the back rooms' additions (no back room, or no room there for
  // the staff lockers: a staff corner behind the cash desk), the greeter, the layout table, the workbench corner
  cashDesk(kit, res, add);
  const noBack = !anchor.stock.some(id => layout.areas[id]);
  const staffOk = backRooms(kit, res, add);
  if (noBack || !staffOk) staffCorner(kit, res, add, noBack);
  robotAtEntry(kit, add);
  diorama(kit, add);
  workbench(kit, res, add);
  kit.reserveLanes();
  // the walls and the floor: glass cases, exhibits, capsule machines, kit walls, kit aisles, a model on its plinth, posters
  glassCases(kit, res, add);
  for (const b of kit.wallRun('cabinetLow', {cluster: 1, max: rng.int(1, 2), front: 0.7})) {
    add('sideboard', b);
    add('exhibit', exhibitOn(kit, b, rng.chance(0.5) ? 'skyDAirshipModel' : 'shipModel') ?? exhibitOn(kit, b, 'skyDAirshipModel'));
  }
  const [ex, ez] = kit.inside(2.2);
  for (let i = 0, n = rng.int(1, 2); i < n; i++) add('capsule', kit.putNearWall('capsuleToyMachine', ex, ez, {front: 0.9, tries: 40}));
  let left = HOBBY_KIT_STACKS;
  const shelves = kit.wallRun('shelf', {cluster: 4, gap: 0.5, max: rng.int(8, 14), front: 0.9});
  add('kitShelf', ...shelves);
  // (the kit aisles along the floor's long axis first, then across it where the floor left over suits that better)
  const wantRuns = rng.int(3, 5), long = kit.fr.W >= kit.fr.D ? 'u' : 'v';
  const runs = fillRuns(kit, kit.level, 'retailGondola', {units: [2, 3], aisle: 1.3, max: wantRuns, orient: long});
  if (runs.length < wantRuns) runs.push(...fillRuns(kit, kit.level, 'retailGondola', {units: [2, 3], aisle: 1.3, max: wantRuns - runs.length, orient: long === 'u' ? 'v' : 'u'}));
  for (const run of runs) add('kitGondola', ...run);
  if (!runs.length) kit.skipped.push('kit aisles (gondola runs)');
  for (const sh of rng.shuffle(shelves.slice())) { if (left <= 0) break; const ks = shelfKits(kit, sh, left); left -= ks.length; add('kitStack', ...ks); }
  for (const g of runs.flat()) { if (left <= 0) break; const ks = gondolaKits(kit, g, Math.min(left, rng.int(1, 2))); left -= ks.length; add('kitStack', ...ks); }
  add('model', ...lattice(kit, 'architectModel', {ring: 0.8, pitch: [3.4, 3.0], max: 1}));
  add('poster', ...kit.posters(3));
  kit.lift();
  res.placed = layout.props.length - kit.p0;
  // (one record per anchor: a re-dressed layout keeps the latest)
  let list = RESULTS.get(layout);
  if (!list) RESULTS.set(layout, (list = []));
  const k = list.findIndex(q => q.anchor === res.anchor);
  if (k >= 0) list[k] = res; else list.push(res);
  return res.placed;
}

type Add = (role: HobbyRole, ...ps: (PropPlacement | null | undefined)[]) => void;

// =================================================================================================================================
// The frame's walls

/** The flank wall at frame end 0 (u = 0) or 1 (u = W). */
function flankSide(kit: AnchorKit, end: 0 | 1): Side {
  const alongX = kit.fr.front === 'N' || kit.fr.front === 'S';
  return alongX ? (end ? 'E' : 'W') : (end ? 'S' : 'N');
}
/** World coordinate along a wall of a point. */
const tOf = (side: Side, x: number, z: number): number => (side === 'N' || side === 'S' ? x : z);

// =================================================================================================================================
// The cash desk

/**
 * The cash desk against a wall near the entry: the back counter (mallCashwrapCounter) backed to the wall, a 1.2 m staff aisle in front
 * of its drawers, then the counter run parallel to it facing the shop — the till counter (with the register) on the entry's side, the
 * glass display counter beyond it. Tried on the flanks near the front (the flank nearer the entry first), on the front wall beside the
 * entry, then deeper on the flanks (a flank door / window near the front). Fallback: a till counter beside the entry (the glass counter
 * in line behind it) and the back counter on the nearest wall.
 */
function cashDesk(kit: AnchorKit, res: HobbyStoreResult, add: Add): void {
  const fr = kit.fr, E = kit.entry;
  const lo = kit.uE - E.half, hi = fr.W - (kit.uE + E.half);
  const ends: (0 | 1)[] = lo === hi ? kit.rng.shuffle([0, 1] as (0 | 1)[]) : lo < hi ? [0, 1] : [1, 0];
  const flank = (v: number) => ends.map(end => ({side: flankSide(kit, end), at: kit.uv(end ? fr.W - 0.5 : 0.5, v), toTill: kit.uv(end ? fr.W - 0.5 : 0.5, v - 1), end}));
  const cands: {side: Side; at: [number, number]; toTill: [number, number]; end: 0 | 1 | -1}[] = [];
  for (const v of [2.6, 3.1, 3.6, 4.2]) cands.push(...flank(v));
  // (the front wall beside the entry: the till toward the entry)
  for (const du of [1.6, 2.2, 3.0, 4.0]) for (const end of ends) {
    const s = end ? 1 : -1, u = kit.uE + s * (E.half + du + 1.0);
    if (u < 1.2 || u > fr.W - 1.2) continue;
    cands.push({side: fr.front, at: kit.uv(u, 0.5), toTill: kit.uv(u - s, 0.5), end});
  }
  for (const v of [4.8, 5.6, 6.4, 7.2, 8.0]) if (v + 1.6 <= fr.D - 2.0) cands.push(...flank(v));
  for (const c of cands) {
    const a = kit.areaAt(c.at[0], c.at[1]);
    if (!a) continue;
    const t = tOf(c.side, c.at[0], c.at[1]), dir = Math.sign(tOf(c.side, c.toTill[0], c.toTill[1]) - t) || 1;
    const got = cashRun(kit, a, c.side, t, dir);
    if (!got) continue;
    res.cashEnd = c.end;
    add('backCounter', got[0]);
    add('till', got[1]);
    add('glassCounter', got[2]);
    register(kit, got[1], add);
    return;
  }
  // fallback: a till counter beside the entry (its customer side to the entry aisle) with the glass counter behind it in line, the back
  // counter on the nearest free wall
  const def = PROP_DEFS.shopCounter;
  for (const s of kit.rng.shuffle([1, -1])) for (const du of [kit.entry.half + 1.2, kit.entry.half + 2.0, kit.entry.half + 3.0]) for (const dv of [2.4, 3.2, 4.2]) {
    const [x, z] = kit.uv(kit.uE + s * (du + def.d / 2), dv + def.w / 2);
    const rot = s > 0 ? fr.minusU : fr.plusU;
    const till = putSnap(kit, 'shopCounter', x, z, rot, {front: 1.0});
    if (!till) continue;
    add('till', till);
    register(kit, till, add);
    const [tu, tv] = kit.toUV(till.x, till.z), gd = PROP_DEFS.glassCounter;
    const [gx, gz] = kit.uv(tu + s * (def.d - gd.d) / 2, tv + def.w + 0.01);
    const glass = kit.put('glassCounter', gx, gz, rot, {front: 1.0});
    if (glass) { glass.purpose = HOBBY_HOLDER_PURPOSE.glass; add('glassCounter', glass); }
    add('backCounter', kit.putNearWall('mallCashwrapCounter', till.x, till.z, {front: 0.9, tries: 60}));
    if (!res.roles.backCounter) kit.skipped.push('back counter');
    return;
  }
  kit.skipped.push('cash desk');
}
/**
 * One cash-desk cluster on `side` of `a` round the wall coordinate `t` (`dir`: along the wall toward the till end), all-or-nothing:
 * [back counter, till, glass counter?] or null. Every piece's ends on cell lines; the counters' backs on the first cell line past the
 * back counter's 0.92 m drawer strip (a ~1.2 m staff aisle, reserved).
 */
function cashRun(kit: AnchorKit, a: Area, side: Side, t: number, dir: number): PropPlacement[] | null {
  const cw = PROP_DEFS.mallCashwrapCounter, sc = PROP_DEFS.shopCounter;
  const U = Math.ceil((0.03 + cw.d + 0.92) / CELL) * CELL, A0 = Math.ceil((0.03 + cw.d) / CELL) * CELL;
  const tc = r3(Math.round((t - cw.w / 2) / CELL) * CELL + cw.w / 2), rot = WALL_ROT[side];
  const got: PropPlacement[] = [];
  const ok = kit.cluster(() => {
    if (!kit.solidWall(a, side, tc, 'mallCashwrapCounter')) return false;
    const sp = wallSpot(a, side, tc, 'mallCashwrapCounter');
    const back = kit.put('mallCashwrapCounter', sp.x, sp.z, sp.rot, {area: a, front: 0.9});
    if (!back) return false;
    got.push(back);
    // the run centred on the back counter: the till's outer end T0, the glass counter beyond it
    const T0 = tc + dir * sc.w;
    const kinds: PropKind[] = ['shopCounter', 'glassCounter'];
    for (let k = 0; k < kinds.length; k++) {
      const d = PROP_DEFS[kinds[k]];
      const [x, z] = wallXZ(a, side, T0 - dir * (k * (sc.w + 0.01) + sc.w / 2), U + d.d / 2);
      const p = kit.put(kinds[k], r3(x), r3(z), rot, {front: 1.0});
      if (!p) { if (k === 0) return false; break; }
      if (kinds[k] === 'glassCounter') p.purpose = HOBBY_HOLDER_PURPOSE.glass;
      got.push(p);
    }
    // the staff aisle between the back counter's drawers and the counters' backs: free floor, kept clear
    const tEnd = T0 - dir * ((got.length - 1) * (sc.w + 0.01));
    const t0 = Math.min(tc - cw.w / 2, T0, tEnd), t1 = Math.max(tc + cw.w / 2, T0, tEnd);
    const [ax, az] = wallXZ(a, side, t0 + 0.02, A0 + 0.02), [bx, bz] = wallXZ(a, side, t1 - 0.02, U - 0.02);
    const box = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)] as const;
    if (!kit.boxFree(box[0], box[1], box[2], box[3], kit.level, true)) return false;
    kit.keepBox(box[0], box[1], box[2], box[3]);
    return true;
  });
  return ok ? got : null;
}

function register(kit: AnchorKit, till: PropPlacement, add: Add): void {
  const reg = kit.onTop(till, 'cashRegister', 0.25, -0.08, SHOP_COUNTER_TOP_Y);
  if (reg) { (till.cut ??= []).push({y: SHOP_COUNTER_TOP_Y, x0: 0.25 - 0.26, x1: 0.25 + 0.26}); add('register', reg); }
}

/**
 * The staff corner along the cash desk's wall behind it: without a back room a whole staff stock corner (tall cabinet, carton shelving,
 * an openable carton, lockers); when the back rooms had no wall left for staff lockers, just the lockers here.
 */
function staffCorner(kit: AnchorKit, res: HobbyStoreResult, add: Add, full: boolean): void {
  const fr = kit.fr, end = res.cashEnd === -1 ? 0 : res.cashEnd;
  const [nx, nz] = kit.uv(end ? fr.W - 1 : 1, Math.min(fr.D - 1.5, 7.5));
  const sides = [flankSide(kit, end), fr.back];
  const kinds: [PropKind, number, number][] = full
    ? [['cabinetTall', 0.8, 0], ['stockShelf', 0.9, stockVariant('cartons')], ['cardboardBoxFlaps', 0.5, 0], ['staffLockers', 0.8, 0]]
    : [['staffLockers', 0.8, 0]];
  for (const [kind, front, variant] of kinds) {
    const p = kit.putNearWall(kind, nx, nz, {front, variant, sides, tries: 60});
    if (p) { p.purpose = HOBBY_HOLDER_PURPOSE.staff; add('staffCorner', p); } else kit.skipped.push(`staff corner: ${kind}`);
  }
}

// =================================================================================================================================
// Centrepieces

/** The tin-toy robot just inside the entry, beside the entry strip, greeting the door (the side away from the cash desk first). */
function robotAtEntry(kit: AnchorKit, add: Add): void {
  const E = kit.entry, tx = -E.nz, tz = E.nx;
  for (const s of kit.rng.shuffle([-1, 1])) for (const dv of [1.6, 2.2, 3.0, 3.8]) for (const lat of [E.half + 0.9, E.half + 1.4, E.half + 2.0]) {
    const p = kit.put('skyDToyRobot', E.x + E.nx * dv + tx * lat * s, E.z + E.nz * dv + tz * lat * s, kit.fr.toFront);
    if (p) { add('robot', p); return; }
  }
  kit.skipped.push('robot at the entry');
}

/** The model-railway layout table mid-floor (its front to the entry), a 1.2 m viewing ring all round it. */
function diorama(kit: AnchorKit, add: Add): void {
  const fr = kit.fr, def = PROP_DEFS.skyDDiorama;
  for (const dv of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, 3.0]) for (const du of [0, 1, -1, 2, -2, 3, -3, 4.5, -4.5]) {
    const [x, z] = kit.uv(fr.W / 2 + du, Math.max(2.6 + 1.2 + def.d / 2, fr.D * 0.5) + dv);
    const p = putSnap(kit, 'skyDDiorama', x, z, fr.toFront, {ring: 1.2}) ?? putSnap(kit, 'skyDDiorama', x, z, fr.plusU, {ring: 1.2});
    if (p) { add('diorama', p); return; }
  }
  kit.skipped.push('diorama');
}

// =================================================================================================================================
// The workbench / demo corner and the paint rack

/**
 * On a far / flank wall away from the cash desk: the demo desk (3 drawers) backed to the wall, the rolling tool chest on one side and
 * the paint rack (two 'parts' stock shelves: paint tins, tubes, supplies) on the other, all-or-nothing; then the desk-top tools, a
 * chair at the desk, a pegboard above the desk and parts bins above the tool chest.
 */
function workbench(kit: AnchorKit, res: HobbyStoreResult, add: Add): void {
  const fr = kit.fr, rng = kit.rng, desk = PROP_DEFS.desk, chest = PROP_DEFS.rollingToolChest, rack = PROP_DEFS.stockShelf;
  const far = res.cashEnd === 1 ? 0 : 1;
  const [tx, tz] = kit.uv(far ? fr.W - 2 : 2, fr.D - 1);
  const sides = [fr.back, flankSide(kit, far as 0 | 1), flankSide(kit, (1 - far) as 0 | 1)];
  const spots = kit.wallSpots('desk', tx, tz, kit.level, sides).filter((_, i) => i % 2 === 0).slice(0, 60);
  const P = HOBBY_HOLDER_PURPOSE.workbench;
  // (every piece's ends on cell lines along the wall: the desk's three cells, the chest's two beside it, the racks' three cells each
  // on the other side — packed side by side, no two share a cell)
  const at = (sp: (typeof spots)[number], kind: PropKind, t: number, o: {front: number; variant?: number}): PropPlacement | null => {
    if (!kit.solidWall(sp.a, sp.side, t, kind)) return null;
    const w = wallSpot(sp.a, sp.side, t, kind);
    return kit.put(kind, w.x, w.z, w.rot, {area: sp.a, ...o});
  };
  const seen = new Set<string>();
  for (const sp of spots) {
    const tD = r3(Math.round((sp.t - desk.w / 2) / CELL) * CELL + desk.w / 2), key = `${sp.a.id}:${sp.side}:${tD}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const got: Partial<Record<'desk' | 'chest', PropPlacement>> & {racks: PropPlacement[]} = {racks: []};
    const ok = kit.cluster(() => {
      const d = at(sp, 'desk', tD, {front: 0.9});
      if (!d) return false;
      got.desk = d;
      for (const dir of rng.shuffle([1, -1])) {
        const pc = at(sp, 'rollingToolChest', tD + dir * (desk.w / 2 + 0.02 + chest.w / 2), {front: 0.7});
        if (!pc) continue;
        got.chest = pc;
        // the paint rack on the desk's other side
        for (let k = 0; k < 2; k++) {
          const pr = at(sp, 'stockShelf', tD - dir * (desk.w / 2 + k * 3 * CELL + 0.02 + rack.w / 2), {front: 0.9, variant: stockVariant('parts')});
          if (!pr) break;
          got.racks.push(pr);
        }
        break;
      }
      return !!got.chest && got.racks.length >= 1;
    });
    if (!ok) continue;
    const d = got.desk!, c = got.chest!;
    for (const p of [d, c, ...got.racks]) p.purpose = P;
    add('workbench', d);
    add('toolChest', c);
    add('paintRack', ...got.racks);
    // the demo desk's top: the soldering station and a toolbox (its loot surface gives up their spans)
    const ss = PROP_DEFS.solderingStation, tb = PROP_DEFS.handToolbox;
    const top = desk.h;
    // (the soldering station's lamp arm toward the front half: the pegboard above the desk's back keeps clear of it)
    const s1 = kit.onTop(d, 'solderingStation', -0.38, r3(desk.d / 2 - 0.04 - ss.d / 2), top);
    if (s1) { (d.cut ??= []).push({y: top, x0: r3(-0.38 - ss.w / 2 - 0.02), x1: r3(-0.38 + ss.w / 2 + 0.02)}); add('benchTop', s1); }
    const s2 = kit.onTop(d, 'handToolbox', 0.42, r3(-desk.d / 2 + 0.03 + tb.d / 2), top);
    if (s2) { (d.cut ??= []).push({y: top, x0: r3(0.42 - tb.w / 2 - 0.02), x1: r3(0.42 + tb.w / 2 + 0.02)}); add('benchTop', s2); }
    add('chair', chairAt(kit, d));
    // above the desk the pegboard, above the tool chest the parts bins (wall mounts, clear of every prop box)
    const s = kit.st(), base = s.base;
    add('pegboard', mountProp(s.ctx, sp.a, sp.side, tD, 'toolPegboard', 1.05, base));
    add('partsBins', mountProp(s.ctx, sp.a, sp.side, tOf(sp.side, c.x, c.z), 'partsBinRack', 1.3, base));
    for (const p of [...(res.roles.pegboard ?? []), ...(res.roles.partsBins ?? [])]) if (!kit.placed.includes(p)) kit.placed.push(p);
    return;
  }
  kit.skipped.push('workbench corner');
}

/** A swivel chair pulled up to the demo desk (tucked 0.1 m under it, facing it); its floor beyond the desk's cells must be free. */
function chairAt(kit: AnchorKit, desk: PropPlacement): PropPlacement | null {
  const d = PROP_DEFS.desk, c = PROP_DEFS.officeSwivelChair;
  const lz = d.d / 2 + c.d / 2 - 0.1;
  const [x, z] = toWorld(desk, 0.15, lz);
  const rot = normYaw(desk.rot + Math.PI);
  const {hx, hz} = footprint('officeSwivelChair', rot);
  // (the part of the chair beyond the desk's front face: free floor of the store, reserved strip allowed)
  const [fx, fz] = toWorld(desk, 0.15, d.d / 2 + 0.3 + (c.d - 0.4) / 2);
  const q = Math.abs(Math.sin(desk.rot)) > 0.7, ex = q ? (c.d - 0.4) / 2 : c.w / 2, ez = q ? c.w / 2 : (c.d - 0.4) / 2;
  if (!floorFree(kit, desk, fx - ex, fz - ez, fx + ex, fz + ez)) return null;
  return kit.push({kind: 'officeSwivelChair', x: r3(x), z: r3(z), y: 0, rot: r3(rot), area: desk.area, hx: r3(hx), hz: r3(hz), h: c.h, blocksSight: false, variant: 0}, desk.level ?? 0);
}

/** Every cell of a world box is walkable floor of the store (its sales pieces, or the host's own room), not blocked by a prop. */
function floorFree(kit: AnchorKit, host: PropPlacement, x0: number, z0: number, x1: number, z1: number): boolean {
  const s = kit.st(host.level ?? kit.level), g = s.g;
  for (let cy = Math.floor((z0 + 0.02) / CELL); cy <= Math.floor((z1 - 0.02) / CELL); cy++) for (let cx = Math.floor((x0 + 0.02) / CELL); cx <= Math.floor((x1 - 0.02) / CELL); cx++) {
    if (!g.inBounds(cx, cy)) return false;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.blocked[i] || g.rampIdx[i] >= 0 || !(s.ids.has(g.area[i]) || g.area[i] === host.area)) return false;
  }
  return true;
}

/** A floor prop with its footprint's low edges on cell lines (packed pieces never share a cell). */
function putSnap(kit: AnchorKit, kind: PropKind, x: number, z: number, rot: number, o: {front?: number; ring?: number} = {}): PropPlacement | null {
  const {hx, hz} = footprint(kind, rot);
  return kit.put(kind, snapEdge(x, hx), snapEdge(z, hz), rot, o);
}

// =================================================================================================================================
// Glass cases, exhibits, kits

/** Two to four glass display cabinets in a row on the wall opposite the cash desk (else the back wall, else any). */
function glassCases(kit: AnchorKit, res: HobbyStoreResult, add: Add): void {
  const want = kit.rng.int(2, 4), opp = flankSide(kit, res.cashEnd === 1 ? 0 : 1);
  let got = kit.wallRun('glassDisplayCabinet', {sides: [opp], cluster: want, gap: 1.0, max: want, front: 0.7});
  if (got.length < 2) got = got.concat(kit.wallRun('glassDisplayCabinet', {sides: [kit.fr.back], cluster: want, gap: 1.0, max: want - got.length, front: 0.7}));
  if (got.length < 2) got = got.concat(kit.wallRun('glassDisplayCabinet', {cluster: 2, gap: 1.0, max: want - got.length, front: 0.7}));
  for (const p of got) p.purpose = HOBBY_HOLDER_PURPOSE.glass;
  add('glassCase', ...got);
  if (got.length < 2) kit.skipped.push(`glass cases: ${got.length}`);
}

/** An exhibit standing on a sideboard's top, flush with its back (the sideboard's loot surface gives up the span). */
function exhibitOn(kit: AnchorKit, host: PropPlacement, kind: PropKind): PropPlacement | null {
  const cab = PROP_DEFS[host.kind], def = PROP_DEFS[kind];
  if (def.w > cab.w - 0.04 || def.d > cab.d - 0.02) return null;
  if (kind === 'skyDAirshipModel' && destDims('skyDAirshipModel').planned) return null;
  const p = kit.onTop(host, kind, 0, r3(-(cab.d - def.d) / 2 + 0.01), cab.h);
  if (p) (host.cut ??= []).push({y: cab.h, x0: r3(-def.w / 2 - 0.02), x1: r3(def.w / 2 + 0.02)});
  return p;
}

/** Kit stacks on a steel shelving unit's three lower tiers (one or two per tier, at the back of the bay; the loot surface gives up the span). */
function shelfKits(kit: AnchorKit, sh: PropPlacement, budget: number): PropPlacement[] {
  const def = PROP_DEFS.shelf, it = PROP_DEFS.skyDModelKits, out: PropPlacement[] = [];
  if (it.d > def.d - 0.04) return out;
  for (const i of [0, 1, 2]) {
    const y = SHELF_TIER_Y[i], clear = (SHELF_TIER_Y[i + 1] ?? def.h) - y - 0.03;
    if (it.h > clear || out.length >= budget) continue;
    const n = Math.min(budget - out.length, kit.rng.int(1, 2), Math.floor((def.w - 0.12) / (it.w + 0.08)));
    for (let k = 0; k < n; k++) {
      const lx = r3(n === 1 ? kit.rng.range(-0.25, 0.25) : (k === 0 ? -1 : 1) * (it.w / 2 + 0.06));
      const p = kit.onTop(sh, 'skyDModelKits', lx, r3(-def.d / 2 + 0.02 + it.d / 2), y);
      if (!p) continue;
      out.push(p);
      (sh.cut ??= []).push({y, x0: r3(lx - it.w / 2 - 0.02), x1: r3(lx + it.w / 2 + 0.02)});
    }
  }
  return out;
}

/** The gondola's top deck (Mall M03 measured: y 1.18 over z -0.22..0.12, open above): kit stacks at its back, side by side. */
export const GONDOLA_TOP = {y: 1.18, z0: -0.22, z1: 0.12, x: 0.93} as const;
function gondolaKits(kit: AnchorKit, g: PropPlacement, n: number): PropPlacement[] {
  const it = PROP_DEFS.skyDModelKits, out: PropPlacement[] = [];
  const lz = r3(GONDOLA_TOP.z0 + 0.005 + it.d / 2);
  const slots = kit.rng.shuffle([-(it.w + 0.05), 0, it.w + 0.05]);
  for (const lx of slots.slice(0, n)) {
    if (Math.abs(lx) + it.w / 2 > GONDOLA_TOP.x) continue;
    const p = kit.onTop(g, 'skyDModelKits', r3(lx), lz, GONDOLA_TOP.y);
    if (!p) continue;
    out.push(p);
    (g.cut ??= []).push({y: GONDOLA_TOP.y, x0: r3(lx - it.w / 2 - 0.02), x1: r3(lx + it.w / 2 + 0.02)});
  }
  return out;
}

/** Islands of `kind` on a lattice over the floor (frame u / v), tried in a shuffled order. */
function lattice(kit: AnchorKit, kind: PropKind, o: {ring?: number; pitch: [number, number]; max: number}): PropPlacement[] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[] = [];
  const [u0, u1] = [1.2 + def.w / 2, fr.W - 1.2 - def.w / 2], [v0, v1] = [2.6 + def.d / 2, fr.D - 1.2 - def.d / 2];
  const spots: [number, number][] = [];
  const nu = Math.max(1, Math.floor((u1 - u0) / o.pitch[0]) + 1), nv = Math.max(1, Math.floor((v1 - v0) / o.pitch[1]) + 1);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) spots.push([u0 + i * o.pitch[0], v0 + j * o.pitch[1]]);
  for (const [u, v] of kit.rng.shuffle(spots)) {
    if (out.length >= o.max) break;
    const [x, z] = kit.uv(u, v);
    const p = putSnap(kit, kind, x, z, fr.toFront, {ring: o.ring});
    if (p) out.push(p);
  }
  return out;
}

/**
 * Double-sided island RUNS of a single-sided fixture (two rows back to back on a cell line, `units` long), scanned greedily over the
 * floor (the deep floor first) so they pack into aisles `aisle` m wide; a run along u faces +/-v. A run needs its first back-to-back
 * pair and stops where the next unit does not fit. Lanes / door strips / rings already reserved stay clear.
 */
function fillRuns(kit: AnchorKit, level: number, kind: PropKind, o: {units: [number, number]; aisle: number; max: number; orient: 'u' | 'v'}): PropPlacement[][] {
  const fr = kit.fr, def = PROP_DEFS[kind], out: PropPlacement[][] = [];
  if (o.max <= 0) return out;
  const along = o.orient === 'u';
  const pitch = Math.max(def.w + 0.02, (Math.floor((def.w - 0.04) / CELL) + 1) * CELL);
  const us: number[] = [], vs: number[] = [];
  for (let u = CELL; u <= fr.W - CELL; u += CELL) us.push(u);
  for (let v = 2.5; v <= fr.D - CELL; v += CELL) vs.push(v);
  if (kit.rng.chance(0.5)) us.reverse();
  vs.reverse();
  for (const v of vs) for (const u of us) {
    if (out.length >= o.max) return out;
    const n = kit.rng.int(o.units[0], o.units[1]);
    const got: PropPlacement[] = [];
    const ok = kit.cluster(() => {
      for (let k = 0; k < n; k++) {
        const side: PropPlacement[] = [];
        for (const s of [-1, 1]) {
          const t = k * pitch + def.w / 2;
          const [pu, pv] = along ? [u + t, v + s * def.d / 2] : [u + s * def.d / 2, v + t];
          const rot = along ? (s < 0 ? fr.toFront : fr.toBack) : (s < 0 ? fr.minusU : fr.plusU);
          const [x, z] = kit.uv(pu, pv);
          const p = kit.put(kind, x, z, rot, {level, front: o.aisle});
          if (p) side.push(p);
        }
        got.push(...side);
        if (side.length < 2) return k > 0;
      }
      return true;
    }, level);
    if (ok) out.push(got);
  }
  return out;
}

// =================================================================================================================================
// Back rooms

/**
 * The back rooms (already shelved / furnished by the station dresser under their room purposes): staff lockers in the office, else
 * the stock room (else a tall cabinet there); the stock room gains openable cartons and a storage tote, and a staff desk with a chair
 * when the store has no office. Placed through the shared primitive on the store level's grid (local height frame, lifted with the
 * rest). True when the staff lockers / cabinet found a wall (else the caller puts the lockers in the staff corner).
 */
function backRooms(kit: AnchorKit, res: HobbyStoreResult, add: Add): boolean {
  const L = kit.layout, rooms = kit.an.stock.map(id => L.areas[id]).filter((a): a is Area => !!a);
  if (!rooms.length) return false;
  const x0 = Math.min(...rooms.map(a => a.x)) - 4, y0 = Math.min(...rooms.map(a => a.y)) - 4;
  const x1 = Math.max(...rooms.map(a => a.x + a.w)) + 4, y1 = Math.max(...rooms.map(a => a.y + a.h)) + 4;
  const ctx = makePlaceCtx(L, kit.rng, kit.level, {x0, y0, x1, y1});
  const stock = rooms.find(a => a.type === 'stock-room') ?? rooms[0];
  const office = rooms.find(a => a !== stock && a.type === 'agent-office');
  const put = (a: Area, kind: PropKind, front = 0, variant = 0): PropPlacement | null => {
    const p = againstWall(kit, ctx, a, kind, front, variant);
    if (p) add('backStorage', p);
    return p;
  };
  // staff lockers first (the office, else the stock room; a tall cabinet where lockers do not fit), then the cartons and the tote
  const staff = (office && put(office, 'staffLockers', 0.6)) || put(stock, 'staffLockers', 0.6) || put(stock, 'cabinetTall', 0.6);
  if (!staff) kit.skipped.push('back rooms: lockers / cabinet');
  for (let i = 0, n = kit.rng.int(1, 2); i < n; i++) if (!put(stock, 'cardboardBoxFlaps')) kit.skipped.push('stock room: carton');
  if (!put(stock, 'storageTote')) kit.skipped.push('stock room: tote');
  if (!office) {
    const d = againstWall(kit, ctx, stock, 'desk', 0.9);
    if (d) { add('staffDesk', d); add('chair', chairAt(kit, d)); } else kit.skipped.push('stock room: staff desk');
  }
  for (const p of [...(res.roles.backStorage ?? []), ...(res.roles.staffDesk ?? [])]) if (!kit.placed.includes(p)) kit.placed.push(p);
  return !!staff;
}

/** `kind` with its back to a solid wall of a back room (sides / spots in a seeded order), all masks through the shared primitive. */
function againstWall(kit: AnchorKit, ctx: PlaceCtx, a: Area, kind: PropKind, front: number, variant = 0): PropPlacement | null {
  const def = PROP_DEFS[kind];
  for (const side of kit.rng.shuffle(['N', 'S', 'E', 'W'] as Side[])) {
    const [lo, hi] = wallRange(a, side);
    const ts: number[] = [];
    for (let t = lo + 0.3 + def.w / 2; t <= hi - 0.3 - def.w / 2; t += 0.25) ts.push(t);
    for (const t of kit.rng.shuffle(ts)) {
      if (!kit.solidWall(a, side, t, kind)) continue;
      const sp = wallSpot(a, side, t, kind);
      begin(ctx);
      const n0 = kit.layout.props.length;
      const p = tryPlaceProp(ctx, a, kind, r3(sp.x), r3(sp.z), r3(sp.rot), {front, variant});
      if (p && !kit.overlaps(p, kit.level)) { commit(ctx); return p; }
      rollback(ctx);
      kit.layout.props.length = n0;
    }
  }
  return null;
}
