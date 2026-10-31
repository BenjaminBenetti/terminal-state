// Task mall-playtest-revision-20261031 (lane GEN): carving of the mall into ONE Kit (station + three retail floors), canvas cells,
// before the crop. Pure data (gen/mall/index.ts crops, links, rails, dresses, populates, validates). Replaces the Track3 six-ring
// carver.
//
// Order:
//  1. level 0: Kit.sideBlock (two side platforms + one double track bed along X: the shared station block builder, so k.trenches
//     exists for Track2); gen/mall/skeleton.ts plans the atrium / court / wings / runs over it; the Fountain court behind the north
//     platform (escalators + glass elevator); the station band under the floor-1 opening rises to the roof apex;
//  2. retail floors 1..3: the public walkways of the floor (court galleries around that floor's opening, corridor wings / branches /
//     loops / second court), jutting gallery cells under a larger opening above get their ceiling at the roof apex;
//  3. the public runs (escalator banks in the court strips, stairs in the wings), each lane its own straight layStairRun into both
//     storeys' grids (open wells);
//  4. two service-stair cores (scissor lanes, station -> floor 3) behind the court's north / south edges (landing doors onto the
//     gallery on every floor; on level 0 straight onto the Fountain court / a spur to the south platform);
//  5. per floor: end units / anchors closing the corridor ends, the food court (one floor), a washroom passage, then LOTS of the ten
//     lot families (gen/mall/lots.ts) extruded from every walkway edge (corner units take two frontages);
//  6. the station's back of house (washrooms, agent office, maintenance store) on a spur off the Fountain court.

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, VOID} from '../grid';
import {Kit, type TrackBlock} from '../stationKit';
import {STAIR, layStairRun, stairRunCells, type StairFlight, type StairSpec} from '../traversal';
import {DOOR_HEIGHT, type Area, type Rect} from '../stationTypes';
import {CLEAR, CORE, FLOORS, ROOF, RUN, STOREY, mallStoreyLabel, type MallFrame} from './frame';
import {MALL_LOTS, type MallLotId, type MallLotStock, type MallLotZone} from './lots';
import {decompose, overlaps, planSkeleton, type CellRect, type EndSpec, type MallSkeleton, type RunPlan, type Side4} from './skeleton';
import {EXIT} from './exits';

export {decompose, type CellRect} from './skeleton';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Ramp headroom of an OPEN well (no ceiling follows the flight; the band is capped by the cell ceiling: levels.ts header). */
export const OPEN_HEADROOM = 40;
/** Service stair (cores): one storey = 28 risers of STOREY / 28 m on 0.28 m treads in 3 flights. */
export const SERVICE_STAIR: StairSpec = {...STAIR, riser: STOREY / 28};
export const SERVICE_RUN_CELLS = stairRunCells(STOREY, SERVICE_STAIR);
/** Cells (along a band) of a washroom slot: a 4-cell passage, a wall, 11 cells of washrooms; its depth. */
export const WC_SLOT = 16;
export const WC_DEPTH = 18;

/** One lane of a public run (escalator / stair): canvas cells of its rect, its flights (kit.flights ids). */
export interface RunLane { kind: 'escalator' | 'stair'; rect: CellRect; flights: number[] }
/** A public vertical run between storey `lower` and `lower + 1` (a bank of lanes on one shared pitch). */
export interface RunCarve {
  id: string;
  kind: 'escalator' | 'stair';
  lower: number;
  rect: CellRect;
  axis: 'x' | 'z';
  from: 'lo' | 'hi';
  lanes: RunLane[];
  area: number;
  side: Side4;
  zone: 'atrium' | 'wing';
}

export interface CoreCarve {
  id: string;
  well: CellRect;
  /** The stair lobby beside the well (front door onto the court on every storey) and its area per storey. */
  lobby: CellRect;
  lobbies: number[];
  /** Landing area per storey (index = storey). */
  landings: number[];
  runs: {lower: number; area: number; flights: number[]; lane: 'A' | 'B'}[];
}

export interface ShopCarve {
  id: string;
  level: number;
  /** Wall of the sales area holding the main frontage (= the direction toward the walkway). */
  side: Side4;
  sales: number;
  back?: number;
  kind: 'store' | 'anchor' | 'food' | 'kiosk';
  lot: MallLotId;
  zone: MallLotZone;
  /** Shopfront openings (canvas cells; [0] = main) + the door record indices. */
  fronts: {rect: CellRect; side: Side4; door: number}[];
  rect: CellRect;
  stock: MallLotStock;
  stockCells: number;
  serviceDoor: boolean;
  recess?: number;
}

export interface WashroomCarve { level: number; passage: number; rooms: number[] }
export interface ElevatorCarve { id: string; shaft: CellRect; cab: CellRect; doorSide: 'N' | 'S'; door: {x: number; w: number}; landing: CellRect }

export interface MallCarve {
  f: MallFrame;
  sk: MallSkeleton;
  /** Absolute floor of every storey (index = layout level). */
  bases: number[];
  /** Extent of everything carved (canvas cells, exclusive ends). */
  X0: number; Z0: number; X1: number; Z1: number;
  /** Floor-1 opening (the station column) mask (stride `cw`) and bbox; per floor openings in sk.open. */
  voidMask: Uint8Array;
  cw: number;
  vx0: number; vx1: number; vz0: number; vz1: number;
  block: TrackBlock;
  court0: number[];
  /** Public walkway areas per retail floor (court + corridors), the court's / the corridors' subsets. */
  galleries: Map<number, number[]>;
  courts: Map<number, number[]>;
  corridors: Map<number, number[]>;
  /** Service corridors per retail floor (the north corridor joining the cores' lobbies). */
  service: Map<number, number[]>;
  recesses: number[];
  shops: ShopCarve[];
  runs: RunCarve[];
  cores: CoreCarve[];
  elevators: ElevatorCarve[];
  washrooms: WashroomCarve[];
  /** The station's back-of-house areas (spurs, washrooms, station rooms). */
  stationBoh: number[];
  roof: {springY: number; apexY: number};
}

/** Why the last attempts failed (QA / tests). */
export const MALL_CARVE_FAILS: Record<string, number> = {};
const fail = (why: string): null => { MALL_CARVE_FAILS[why] = (MALL_CARVE_FAILS[why] ?? 0) + 1; return null; };

/** Station block placement on the canvas (room west / north for wings, east / south for wings and Track2's growth). */
const BLOCK = {px0: 124, P2y: 74};

/** Soft per-floor unit target (frontages incl. kiosks; end units / food counters included). */
export const FLOOR_UNITS: Readonly<Record<number, number>> = {1: 10, 2: 9, 3: 8};

interface Seg { dir: Side4; line: number; a0: number; a1: number; zone: MallLotZone }

/** Carves the whole mall into a fresh kit (levels 0..FLOORS); null when the program does not fit (the caller re-rolls). */
export function carveMall(k: Kit, rng: Rng, f: MallFrame): MallCarve | null {
  const bases = Array.from({length: FLOORS + 1}, (_, i) => r2(i * STOREY));
  const W = k.g.w, H = k.g.h;
  // --- 1. Station block + skeleton ---------------------------------------------------------------------------------------------
  const block = k.sideBlock(BLOCK.px0, BLOCK.P2y, f.Lp, CLEAR.platform, ['Platform 1', 'Platform 2']);
  const [P1, P2] = block.platforms;
  for (const t of k.trenches) t.columns = false;
  for (const P of block.platforms) delete P.paid;
  P1.platformNo = 1; P2.platformNo = 2;
  const sk = planSkeleton(rng.fork('skeleton'), f, block, W, H);
  if (!sk) return fail('skeleton');
  const C = sk.court;
  const b3 = sk.openBox[3];
  const springY = r2(bases[FLOORS] + ROOF.spring);
  const apexY = r2(springY + Math.min(b3.x1 - b3.x0, b3.y1 - b3.y0) * CELL * ROOF.riseFrac);
  const openAt = (lv: number, x: number, y: number) => lv >= 1 && lv <= FLOORS && sk.open[lv][y * W + x] === 1;
  const runsTouching = (lv: number) => sk.runs.filter(p => p.lower === lv || p.lower + 1 === lv);
  const inR = (r: CellRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const shaftAt = (x: number, y: number) => inR(sk.lift.shaft, x, y);

  // --- Level 0: the Fountain court behind the north platform (no wall: the platform's back opens onto it) ---------------------
  const g0 = k.grid(0);
  const court0: number[] = [];
  for (const q of decompose((x, y) => !shaftAt(x, y) && !runsTouching(0).some(p => inR(p.rect, x, y)), sk.court0)) {
    const a = k.addArea(q, 'concourse', 'concourse', CLEAR.court, P2.id, {label: 'Fountain court', publicSpace: true, role: 'great-hall'});
    court0.push(a.id);
  }
  // The station band under the floor-1 opening rises to the roof apex (the platform sees the sky through the atrium).
  for (let i = 0; i < W * H; i++) {
    if (!sk.open[1][i]) continue;
    if (g0.cells[i] === SOLID) return fail('void-over-rock');
    g0.ceil[i] = apexY;
  }

  // --- 2. Retail floors: public walkways ----------------------------------------------------------------------------------------
  const galleries = new Map<number, number[]>(), courts = new Map<number, number[]>(), corridors = new Map<number, number[]>();
  /** Per floor: walkway area id per cell (-1 = none); public runs / void / shaft are not walkway. */
  const walkArea: Int32Array[] = [new Int32Array(W * H).fill(-1)];
  /** Per floor: inside the floor's public region (walk rects incl. void / runs / shaft) — lots never extrude into it. */
  const inside: Uint8Array[] = [new Uint8Array(W * H)];
  for (let lv = 1; lv <= FLOORS; lv++) {
    const base = bases[lv], opt = {level: lv, floorY: base};
    const wa = new Int32Array(W * H).fill(-1), ins = new Uint8Array(W * H);
    walkArea.push(wa); inside.push(ins);
    const touching = runsTouching(lv);
    const gl: number[] = [], cl: number[] = [], rl: number[] = [];
    const claimed = new Uint8Array(W * H);
    for (const piece of sk.walks) {
      if (!piece.floors.includes(lv)) continue;
      const r = piece.rect, pm = piece.mask;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!pm || pm[y * W + x]) ins[y * W + x] = 1;
      const walkable = (x: number, y: number) => (!pm || pm[y * W + x] === 1) && !claimed[y * W + x] && !openAt(lv, x, y) && !shaftAt(x, y) && !touching.some(p => inR(p.rect, x, y));
      // jutting cells (open above: a larger opening on the next floor) carry their own areas with the roof-apex ceiling
      const jut = (x: number, y: number) => lv < FLOORS && openAt(lv + 1, x, y);
      for (const isJut of [false, true]) {
        for (const q of decompose((x, y) => walkable(x, y) && jut(x, y) === isJut, r)) {
          const label = piece.zone === 'court' ? `Atrium court · ${mallStoreyLabel(lv)}` : `${piece.label} · ${mallStoreyLabel(lv)}`;
          const a = k.addArea(q, 'concourse', 'retail-arcade', isJut ? apexY : r2(base + CLEAR.gallery), -1, {...opt, label, publicSpace: true, role: 'mall'});
          for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) { claimed[y * W + x] = 1; wa[y * W + x] = a.id; }
          gl.push(a.id);
          (piece.zone === 'court' ? cl : rl).push(a.id);
        }
      }
    }
    galleries.set(lv, gl); courts.set(lv, cl); corridors.set(lv, rl);
  }
  // Wings on different floors must not leave a walkway cell over the station's look-up column.
  const vb = sk.openBox[1];

  // --- 3. Public runs ---------------------------------------------------------------------------------------------------------
  const runs: RunCarve[] = [];
  for (const p of sk.runs) {
    const rc = carveRun(k, p, bases);
    // both mouths must be walkway on the storey they land on
    for (const [lv, end] of [[p.lower, p.from === 'lo' ? 'hi' : 'lo'], [p.lower + 1, p.from]] as const) {
      const g = k.grid(lv), r = p.rect;
      const n = p.axis === 'x' ? r.h : r.w;
      for (let t = 0; t < n; t++) {
        const x = p.axis === 'x' ? (end === 'lo' ? r.x - 1 : r.x + r.w) : r.x + t;
        const y = p.axis === 'x' ? r.y + t : (end === 'lo' ? r.y - 1 : r.y + r.h);
        if (!g.inBounds(x, y) || g.cells[g.idx(x, y)] !== FLOOR || g.rampIdx[g.idx(x, y)] >= 0) return fail(`run-mouth-${p.id}-${lv}`);
      }
    }
    runs.push(rc);
  }

  // --- 3b. Task mall-round2-20261031 (lane GEN, M09): the designed street-exit corridor ends — their outside (the vestibule pocket
  // + the near exterior view, EXIT.reserve) stays free of every later room on every retail floor: its rock cells are marked VOID
  // while the cores / lots / washrooms are carved (rectFree refuses them) and turn back to rock at the end. An end whose outside is
  // already built over falls back to an end unit on floor 1. (Only the round-2 variants design such ends.)
  const reservedCells: [number, number][] = [];
  sk.ends.forEach((e, ei) => {
    if (!e.exit) return;
    const r = exitReserveRect(e);
    let clear = r.x >= 1 && r.y >= 1 && r.x + r.w <= W - 1 && r.y + r.h <= H - 1;
    for (let lv = 1; lv <= FLOORS && clear; lv++) { const g = k.grid(lv); for (let y = r.y; y < r.y + r.h && clear; y++) for (let x = r.x; x < r.x + r.w; x++) if (g.cells[g.idx(x, y)] !== SOLID) { clear = false; break; } }
    if (!clear) { const {exit: _x, ...rest} = e; sk.ends[ei] = {...rest, pref: {...rest.pref, 1: 'end-unit'}}; return; }
    for (let lv = 1; lv <= FLOORS; lv++) { const g = k.grid(lv); for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { g.cells[g.idx(x, y)] = VOID; reservedCells.push([lv, g.idx(x, y)]); } }
  });

  // --- 4. Two service-stair cores behind the court's north edge (beside their lobbies; on level 0 onto the Fountain court) -----
  const cores: CoreCarve[] = [];
  const L = 2 * CORE.landing + SERVICE_RUN_CELLS, WH = 2 * CORE.lane + CORE.divider, FW = WH + 1 + 3;
  const westFirst = rng.chance(0.5);
  const nx0 = sk.court0.x, nx1 = sk.court0.x + sk.court0.w;
  const taken: CellRect[] = [];
  for (const which of westFirst ? ['W', 'E'] as const : ['E', 'W'] as const) {
    // the lobby faces the court's north edge (its front wall = the court's wall row); scan inward from that end of the court
    const xs: number[] = [];
    for (let x = nx0 + 2; x + FW <= nx1 - 2; x++) xs.push(x);
    if (which === 'E') xs.reverse();
    let got: CoreCarve | null = null;
    for (const x of xs) {
      const foot: CellRect = {x, y: C.y - 1 - L, w: FW, h: L};
      if (taken.some(t => overlaps(t, foot, 4))) continue;
      let ok = true;
      for (let lv = 0; lv <= FLOORS && ok; lv++) if (!k.rectFree(foot, lv)) ok = false;
      // the lobby's front must open onto walkway on every retail floor and the Fountain court on level 0
      const lobbyX = which === 'W' ? x + WH + 1 : x;
      for (let lv = 1; lv <= FLOORS && ok; lv++) for (let t = 0; t < 3; t++) if (walkArea[lv][C.y * W + lobbyX + t] < 0) ok = false;
      for (let t = 0; t < 3 && ok; t++) { const a0 = g0.area[g0.idx(lobbyX + t, C.y)]; if (a0 < 0 || !court0.includes(a0)) ok = false; }
      if (!ok) continue;
      got = carveCore(k, `core-${which}`, x, C.y, which, bases, walkArea, court0);
      if (got) { taken.push(foot); break; }
    }
    if (!got) return fail(`core-${which}`);
    cores.push(got);
  }

  // --- 4b. The north service corridor on every retail floor: behind the court's north band, joining both cores' lobbies at their
  // far ends (a staff loop gallery -> lobby -> corridor -> lobby -> gallery); north-band stockrooms that reach it get a service door
  const service = new Map<number, number[]>();
  const svc: Int32Array[] = [new Int32Array(W * H).fill(-1)];
  {
    const lob = cores.map(cc => cc.lobby).sort((a, b) => a.x - b.x);
    const y1 = lob[0].y - 1, y0 = y1 - 4;
    const r: CellRect = {x: Math.min(...cores.map(cc => Math.min(cc.well.x, cc.lobby.x))), y: y0, w: 0, h: 4};
    r.w = Math.max(...cores.map(cc => Math.max(cc.well.x + cc.well.w, cc.lobby.x + cc.lobby.w))) - r.x;
    for (let lv = 1; lv <= FLOORS; lv++) {
      const m = new Int32Array(W * H).fill(-1);
      svc.push(m);
      if (!k.rectFree(r, lv)) continue;
      const A = k.addArea(r, 'service', 'service-corridor', r2(bases[lv] + CLEAR.corridor), -1, {level: lv, floorY: bases[lv], label: `Service corridor · ${mallStoreyLabel(lv)}`, publicSpace: false});
      for (const cc of cores) k.carveDoor({x: cc.lobby.x, y: y1, w: 3, h: 1}, A, k.areas[cc.lobbies[lv]], CLEAR.door, false, {staff: true});
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) m[y * W + x] = A.id;
      service.set(lv, [A.id]);
    }
  }

  // --- 5. Lots, end units, food court, washrooms per floor ------------------------------------------------------------------
  const shops: ShopCarve[] = [], washrooms: WashroomCarve[] = [], recesses: number[] = [];
  const familyCount = new Map<MallLotId, number>();
  const used = (id: MallLotId) => familyCount.get(id) ?? 0;
  for (let lv = 1; lv <= FLOORS; lv++) {
    const lrng = rng.fork(`lots-${lv}`);
    const target = FLOOR_UNITS[lv] + lrng.int(-1, 1); // seeded: ~24-30 frontages per run
    const ctx: LotCtx = {k, lv, base: bases[lv], W, walkArea: walkArea[lv], inside: inside[lv], svc: svc[lv], rng: lrng, shops, recesses, count: familyCount};
    const floorShops = () => shops.filter(s => s.level === lv).length;
    // end units / anchors closing the corridor ends
    for (const e of sk.ends) {
      const pref = e.pref[lv];
      if (!pref) continue;
      const order: MallLotId[] = [pref, ...(pref === 'anchor-deep' ? ['end-unit'] as MallLotId[] : []), 'standard-line', 'compact-square'];
      for (const id of order) {
        if (id === 'anchor-deep' && used(id) >= MALL_LOTS[id].maxPerMall) continue;
        if (placeEnd(ctx, e, id)) break;
      }
    }
    const segs = segmentsOf(inside[lv], walkArea[lv], W, H, sk, lv);
    // the food court: food counters along the longest court edge of the food floor
    if (lv === sk.foodFloor) {
      const fs = segs.filter(s => s.zone === 'atrium').sort((a, b) => (b.a1 - b.a0) - (a.a1 - a.a0))[0];
      if (fs) fillSegment(ctx, {...fs, zone: 'food'}, ['food-counter'], 5);
    }
    // one washroom passage per floor (a corridor edge if one has room, else the court)
    const wcSegs = [...segs.filter(s => s.zone === 'corridor'), ...segs.filter(s => s.zone === 'atrium')].filter(s => s.a1 - s.a0 >= WC_SLOT + 4);
    let wc: WashroomCarve | null = null;
    for (const s of lrng.shuffle(wcSegs.slice())) { wc = placeWashrooms(ctx, s); if (wc) break; }
    if (!wc) return fail(`washrooms-${lv}`);
    washrooms.push(wc);
    // regular lots: corridor / second-court edges first (shopping corridors are lined with shops), then the atrium court's edges,
    // longest first, at most 3 units per edge in this pass; then a second pass over every edge until the floor's soft unit target
    const byLen = (a: Seg, b: Seg) => (b.a1 - b.a0) - (a.a1 - a.a0) || a.line - b.line || a.a0 - b.a0;
    const cor = segs.filter(s => s.zone !== 'atrium').sort(byLen), atr = segs.filter(s => s.zone === 'atrium').sort(byLen);
    const order: Seg[] = [];
    for (let i = 0; i < Math.max(cor.length, atr.length); i++) { if (cor[i]) order.push(cor[i]); if (atr[i]) order.push(atr[i]); }
    for (const pass of [2, 99]) for (const s of order) {
      const left = target - floorShops();
      if (left <= 0) break;
      fillSegment(ctx, s, null, Math.min(left, pass));
    }
  }

  // --- 6. The station's back of house: a spur off the Fountain court's west wall ---------------------------------------------
  const stationBoh = stationServices(k, rng.fork('station-boh'), sk, court0);
  if (!stationBoh) return fail('station-boh');
  // (3b) the reserved street-exit outsides are rock again
  for (const [lv, i] of reservedCells) k.grid(lv).cells[i] = SOLID;

  // --- Extent ---------------------------------------------------------------------------------------------------------------
  let X0 = Infinity, Z0 = Infinity, X1 = -Infinity, Z1 = -Infinity;
  for (const r of [...k.areas, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    X0 = Math.min(X0, r.x); Z0 = Math.min(Z0, r.y); X1 = Math.max(X1, r.x + r.w); Z1 = Math.max(Z1, r.y + r.h);
  }
  if (X0 - 6 < 1 || Z0 - 6 < 1 || X1 + 6 > W || Z1 + 6 > H) return fail('canvas');
  const elevators: ElevatorCarve[] = [{id: 'lift-N', shaft: sk.lift.shaft, cab: sk.lift.cab, doorSide: sk.lift.doorSide, door: sk.lift.door, landing: sk.lift.landing}];
  return {
    f, sk, bases, X0, Z0, X1, Z1, voidMask: sk.open[1], cw: W, vx0: vb.x0, vx1: vb.x1, vz0: vb.y0, vz1: vb.y1, block, court0,
    galleries, courts, corridors, service, recesses, shops, runs, cores, elevators, washrooms, stationBoh, roof: {springY, apexY},
  };
}

// ---------------------------------------------------------------------------------------------
// Runs and cores

function carveRun(k: Kit, p: RunPlan, bases: number[]): RunCarve {
  const lo = p.lower, hi = lo + 1;
  const ceil = r2(bases[hi] + CLEAR.gallery);
  const area = k.addArea(p.rect, 'passage', 'stair-core', ceil, -1, {
    ...(lo ? {level: lo, floorY: bases[lo]} : {}), also: [hi], role: 'stair', publicSpace: true,
    label: p.kind === 'escalator' ? `Escalators · ${mallStoreyLabel(lo)} – ${mallStoreyLabel(hi)}` : `Stairs · ${mallStoreyLabel(lo)} – ${mallStoreyLabel(hi)}`,
  });
  const lanes: RunLane[] = [];
  const laneW = p.kind === 'escalator' ? 3 : 5;
  const nLanes = Math.max(1, Math.floor((p.axis === 'x' ? p.rect.h : p.rect.w) / laneW));
  const spec: StairSpec = {...(p.kind === 'escalator' ? RUN.escalator : RUN.stair), headroom: OPEN_HEADROOM};
  for (let li = 0; li < nLanes; li++) {
    const rect: CellRect = p.axis === 'x' ? {x: p.rect.x, y: p.rect.y + li * laneW, w: p.rect.w, h: laneW} : {x: p.rect.x + li * laneW, y: p.rect.y, w: laneW, h: p.rect.h};
    const fl: StairFlight[] = layStairRun([k.grid(lo), k.grid(hi)], rect, area.id, p.axis, p.from, bases[hi], bases[lo], spec);
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; q.spec = p.kind === 'escalator' ? 'escalator' : 'transit'; ids.push(q.id); k.flights.push(q); }
    lanes.push({kind: p.kind, rect, flights: ids});
  }
  // Open well: both storeys' bands rise to the upper storey's gallery ceiling (no ceiling following the pitch).
  for (const g of [k.grid(lo), k.grid(hi)]) for (let y = p.rect.y; y < p.rect.y + p.rect.h; y++) for (let x = p.rect.x; x < p.rect.x + p.rect.w; x++) g.ceil[g.idx(x, y)] = ceil;
  return {id: p.id, kind: p.kind, lower: lo, rect: p.rect, axis: p.axis, from: p.from, lanes, area: area.id, side: p.side, zone: p.zone};
}

/**
 * A service-stair core behind the court's north edge: the well runs north-south (two scissor lanes, landings at both ends
 * alternating storey to storey) with a 1.5 m stair lobby along its court-side flank ('W' core: lobby on its east side, 'E' core: on
 * its west side). On every storey the lobby opens onto the walkway / the Fountain court (staff door) and into that storey's landing,
 * so both landing ends are reachable from the front on every floor.
 */
function carveCore(k: Kit, id: string, x: number, courtY: number, which: 'W' | 'E', bases: number[], walkArea: Int32Array[], court0: number[]): CoreCarve | null {
  const L = 2 * CORE.landing + SERVICE_RUN_CELLS, WH = 2 * CORE.lane + CORE.divider, W = k.g.w;
  const y0 = courtY - 1 - L;
  const wx = which === 'W' ? x : x + 4, lx = which === 'W' ? x + WH + 1 : x;
  const wallX = which === 'W' ? x + WH : x + 3;
  const well: CellRect = {x: wx, y: y0, w: WH, h: L};
  const landings: number[] = new Array(FLOORS + 1).fill(-1);
  const lobbies: number[] = [];
  const endOf = (lv: number): 'lo' | 'hi' => (lv % 2 === 0 ? 'hi' : 'lo'); // level 0: the south (court) end
  for (let lv = 0; lv <= FLOORS; lv++) {
    const base = bases[lv], ceil = r2(base + (lv ? CLEAR.core : CLEAR.core0));
    const lvOpt = lv ? {level: lv, floorY: base} : {};
    const ly = endOf(lv) === 'lo' ? y0 : y0 + L - CORE.landing;
    const la = k.addArea({x: wx, y: ly, w: WH, h: CORE.landing}, 'room', 'stair-core', ceil, -1, {...lvOpt, label: `Service stairs · ${mallStoreyLabel(lv)}`, publicSpace: false, role: 'landing'});
    landings[lv] = la.id;
    const lob = k.addArea({x: lx, y: y0, w: 3, h: L}, 'service', 'service-corridor', ceil, la.id, {...lvOpt, label: `Service stairs lobby · ${mallStoreyLabel(lv)}`, publicSpace: false});
    lobbies.push(lob.id);
    k.carveDoor({x: wallX, y: ly, w: 1, h: CORE.landing}, lob, la, CLEAR.door, false);
    const gap: Rect = {x: lx, y: courtY - 1, w: 3, h: 1};
    const front = lv ? walkArea[lv][courtY * W + lx + 1] : (() => { const g0 = k.grid(0), a = g0.area[g0.idx(lx + 1, courtY)]; return court0.includes(a) ? a : -1; })();
    if (front < 0) return null;
    k.carveDoor(gap, k.areas[front], lob, CLEAR.door, false, {staff: true});
  }
  const runs: CoreCarve['runs'] = [];
  for (let lv = 0; lv < FLOORS; lv++) {
    const lane: 'A' | 'B' = lv % 2 === 1 ? 'A' : 'B';
    const rx = lane === 'A' ? wx : wx + CORE.lane + CORE.divider;
    const rect: Rect = {x: rx, y: y0 + CORE.landing, w: CORE.lane, h: SERVICE_RUN_CELLS};
    const area = k.addArea(rect, 'room', 'stair-core', r2(bases[lv] + SERVICE_STAIR.headroom), landings[lv],
      {...(lv ? {level: lv, floorY: bases[lv]} : {}), also: [lv + 1], role: 'stair', publicSpace: false, label: `Service stairs · ${mallStoreyLabel(lv)} – ${mallStoreyLabel(lv + 1)}`});
    const fl = layStairRun([k.grid(lv), k.grid(lv + 1)], rect, area.id, 'z', endOf(lv), bases[lv], bases[lv + 1], SERVICE_STAIR);
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; ids.push(q.id); k.flights.push(q); }
    runs.push({lower: lv, area: area.id, flights: ids, lane});
  }
  return {id, well, lobby: {x: lx, y: y0, w: 3, h: L}, landings, lobbies, runs};
}

// ---------------------------------------------------------------------------------------------
// Walkway edges (bands)

/**
 * Maximal straight edges of a floor's public region: runs of walkway cells whose neighbour across (the band side) is outside the
 * region. Lots extrude from them. Zone: 'atrium' for edges of the court, 'corridor' for the wings / links / second court.
 */
function segmentsOf(ins: Uint8Array, wa: Int32Array, W: number, H: number, sk: MallSkeleton, lv: number): Seg[] {
  const out: Seg[] = [];
  const zoneOf = (x: number, y: number): MallLotZone => (sk.courtMask[y * W + x] ? 'atrium' : sk.walks.some(w => w.zone === 'court2' && w.floors.includes(lv) && x >= w.rect.x && x < w.rect.x + w.rect.w && y >= w.rect.y && y < w.rect.y + w.rect.h) ? 'court' : 'corridor');
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && ins[y * W + x] === 1;
  for (const dir of ['N', 'S', 'W', 'E'] as const) {
    const [dx, dy] = dir === 'N' ? [0, -1] : dir === 'S' ? [0, 1] : dir === 'W' ? [-1, 0] : [1, 0];
    const alongX = dx === 0;
    const outer = alongX ? H : W, inner = alongX ? W : H;
    for (let o = 1; o < outer - 1; o++) {
      let start = -1, zone: MallLotZone = 'corridor';
      for (let a = 0; a <= inner; a++) {
        const x = alongX ? a : o, y = alongX ? o : a;
        const on = a < inner && at(x, y) && !at(x + dx, y + dy) && wa[y * W + x] >= 0;
        const z: MallLotZone = on ? zoneOf(x, y) : zone;
        if (start >= 0 && (!on || z !== zone)) {
          out.push({dir, line: alongX ? o + dy : o + dx, a0: start, a1: a, zone});
          start = -1;
        }
        if (on && start < 0) { start = a; zone = z; }
      }
    }
  }
  return out.filter(s => s.a1 - s.a0 >= 6);
}

// ---------------------------------------------------------------------------------------------
// Lots

interface LotCtx {
  k: Kit; lv: number; base: number; W: number; walkArea: Int32Array; inside: Uint8Array; rng: Rng;
  /** Service corridor area id per cell on this floor (-1 = none). */
  svc: Int32Array;
  shops: ShopCarve[]; recesses: number[]; count: Map<MallLotId, number>;
}

const OPP: Record<Side4, Side4> = {N: 'S', S: 'N', W: 'E', E: 'W'};

/** Lot-local geometry: along [a, a+w) x depth [d0, d0+dd) beyond the wall line of a segment -> canvas rect. */
function lotRect(s: {dir: Side4; line: number}, a: number, w: number, d0: number, dd: number): CellRect {
  switch (s.dir) {
    case 'N': return {x: a, y: s.line - d0 - dd, w, h: dd};
    case 'S': return {x: a, y: s.line + 1 + d0, w, h: dd};
    case 'W': return {x: s.line - d0 - dd, y: a, w: dd, h: w};
    default: return {x: s.line + 1 + d0, y: a, w: dd, h: w};
  }
}
/** A wall-line rect at depth d (d = -1: the segment's own wall line; d >= 0: the line between depth d-1 and d). */
function lineRect(s: {dir: Side4; line: number}, a: number, w: number, d = 0): CellRect {
  const off = d;
  switch (s.dir) {
    case 'N': return {x: a, y: s.line - off, w, h: 1};
    case 'S': return {x: a, y: s.line + off, w, h: 1};
    case 'W': return {x: s.line - off, y: a, w: 1, h: w};
    default: return {x: s.line + off, y: a, w: 1, h: w};
  }
}
/** The walkway cell in front of along-position a (just inside the region). */
function frontCell(s: {dir: Side4; line: number}, a: number): [number, number] {
  switch (s.dir) {
    case 'N': return [a, s.line + 1];
    case 'S': return [a, s.line - 1];
    case 'W': return [s.line + 1, a];
    default: return [s.line - 1, a];
  }
}

const cellsOf = (m: number) => Math.round(m / CELL);
const sampleCells = (rng: Rng, r: readonly [number, number]) => cellsOf(rng.range(r[0], r[1]));

/** Is the whole span [a0, a1) of the segment's front row a walkway (not a run / void / shaft)? Returns the walkway area there. */
function frontOk(c: LotCtx, s: Seg, a0: number, a1: number): number {
  if (a1 <= a0) return -1;
  for (let a = a0; a < a1; a++) {
    const [x, y] = frontCell(s, a);
    if (x < 0 || y < 0 || x >= c.W || c.walkArea[y * c.W + x] < 0) return -1;
  }
  const [mx, my] = frontCell(s, (a0 + a1) >> 1);
  return c.walkArea[my * c.W + mx];
}

interface LotPlan { id: MallLotId; w: number; ds: number; st: number; sideStock: 'L' | 'R' | null; recess: number }

/** A family's cell dimensions for a lot (sales width ws / depth ds, stock size st, recess r); total footprint along / deep. */
function planLot(c: LotCtx, id: MallLotId, maxAlong: number, maxDeep: number): LotPlan | null {
  const f = MALL_LOTS[id];
  const minW = cellsOf(f.width[0]), minD = cellsOf(f.depth[0]);
  const st = f.stock === 'none' ? 0 : sampleCells(c.rng, f.stockSize);
  const sideStock: 'L' | 'R' | null = f.stock === 'side' ? (c.rng.chance(0.5) ? 'L' : 'R') : null;
  const recess = f.recess ? sampleCells(c.rng, f.recess) : 0;
  const alongExtra = sideStock ? st + 1 : 0;
  const deepExtra = (sideStock || f.stock === 'none' ? 0 : st + 1) + (recess ? recess + 1 : 0);
  let w = Math.min(sampleCells(c.rng, f.width), maxAlong - alongExtra);
  let ds = Math.min(sampleCells(c.rng, f.depth), maxDeep - deepExtra);
  if (w < minW || ds < minD) return null;
  w = Math.max(minW, w); ds = Math.max(minD, ds);
  return {id, w, ds, st, sideStock, recess};
}

/**
 * Carves one lot at along-position a of a segment: sales floor (+ stockroom per the family, + a recess vestibule), its shopfront
 * door(s) (corner units: a second one on the side wall facing another walkway). Null when the footprint is not free rock.
 */
function carveLot(c: LotCtx, s: Seg, a: number, p: LotPlan, zone: MallLotZone, kind: ShopCarve['kind'], opts: {endCentre?: boolean} = {}): ShopCarve | null {
  const {k, lv, base} = c;
  const f = MALL_LOTS[p.id];
  const alongT = p.w + (p.sideStock ? p.st + 1 : 0);
  const deepT = p.ds + (p.sideStock || f.stock === 'none' ? 0 : p.st + 1) + (p.recess ? p.recess + 1 : 0);
  // the sales floor's along range (side stock on the left / right) and its depth start (behind the recess)
  const sa = p.sideStock === 'L' ? a + p.st + 1 : a;
  const sd = p.recess ? p.recess + 1 : 0;
  // shopfront span on the wall line (piers of one cell; the whole width for open fronts / recess vestibules)
  const piers = f.front === 'open' ? 0 : 1;
  let fa0 = (p.recess ? sa + 2 : sa) + piers, fa1 = (p.recess ? sa + p.w - 2 : sa + p.w) - piers;
  if (opts.endCentre) { fa0 = Math.max(fa0, s.a0 + 1); fa1 = Math.min(fa1, s.a1 - 1); }
  if (fa1 - fa0 < 3) return null;
  const gal = frontOk(c, s, p.recess ? sa + 2 : fa0, p.recess ? sa + p.w - 2 : fa1);
  if (gal < 0) return null;
  const foot = lotRect(s, a, alongT, 0, deepT);
  if (!k.rectFree(foot, lv)) return null;
  // corner units need a second frontage: a run of >= 6 walkway cells beyond one side wall within the sales depth
  let corner: {gap: CellRect; gal: number; side: Side4} | null = null;
  if (p.id === 'corner-double') {
    for (const sideA of [sa - 1, sa + p.w]) {
      if (p.sideStock && ((p.sideStock === 'L' && sideA === sa - 1) || (p.sideStock === 'R' && sideA === sa + p.w))) continue;
      const outA = sideA === sa - 1 ? sideA - 1 : sideA + 1;
      let run0 = -1, best: [number, number] | null = null;
      for (let d = sd; d <= sd + p.ds; d++) {
        const q = d < sd + p.ds ? lotRect(s, outA, 1, d, 1) : null;
        const ok = q ? c.walkArea[q.y * c.W + q.x] >= 0 : false;
        if (ok && run0 < 0) run0 = d;
        if (!ok && run0 >= 0) { if (!best || d - run0 > best[1] - best[0]) best = [run0, d]; run0 = -1; }
      }
      if (!best || best[1] - best[0] < 6) continue;
      const d0 = best[0] + 1, d1 = best[1] - 1;
      const q = lotRect(s, outA, 1, (d0 + d1) >> 1, 1);
      const g2 = c.walkArea[q.y * c.W + q.x];
      if (g2 < 0) continue;
      const side: Side4 = s.dir === 'N' || s.dir === 'S' ? (sideA === sa - 1 ? 'W' : 'E') : (sideA === sa - 1 ? 'N' : 'S');
      corner = {gap: lotRect(s, sideA, 1, d0, d1 - d0), gal: g2, side};
      break;
    }
    if (!corner) return null;
  }
  const opt = {level: lv, floorY: base};
  const S = k.addArea(lotRect(s, sa, p.w, sd, p.ds), 'room', 'shop', r2(base + CLEAR.shop), gal, {...opt, label: 'Shop', publicSpace: true});
  let back: Area | undefined, recessA: Area | undefined, stockCells = 0, serviceDoor = false;
  const fronts: ShopCarve['fronts'] = [];
  if (p.recess) {
    // the public vestibule in front of the shopfront (window bays at its sides belong to the shop's wall)
    recessA = k.addArea(lotRect(s, sa + 2, p.w - 4, 0, p.recess), 'passage', 'passage', r2(base + CLEAR.shopfront + 0.2), gal, {...opt, label: 'Arcade', publicSpace: true});
    k.carveDoor(lineRect(s, sa + 2, p.w - 4), k.areas[gal], recessA, CLEAR.shopfront, false);
    const fr = lineRect(s, fa0, fa1 - fa0, p.recess + 1);
    const d = k.carveDoor(fr, recessA, S, CLEAR.shopfront, false, {shopfront: true});
    fronts.push({rect: fr, side: OPP[s.dir], door: d.id});
    c.recesses.push(recessA.id);
  } else {
    const fr = lineRect(s, fa0, fa1 - fa0);
    const d = k.carveDoor(fr, k.areas[gal], S, CLEAR.shopfront, false, {shopfront: true});
    fronts.push({rect: fr, side: OPP[s.dir], door: d.id});
  }
  // stockroom
  if (f.stock !== 'none' && p.st > 0) {
    const r = p.sideStock ? lotRect(s, p.sideStock === 'L' ? a : sa + p.w + 1, p.st, sd, p.ds) : lotRect(s, sa, p.w, sd + p.ds + 1, p.st);
    back = k.addArea(r, 'room', 'stock-room', r2(base + CLEAR.back), S.id, {...opt, label: 'Stock room', publicSpace: false});
    back.purpose = 'stock-room';
    // a rear stockroom whose back wall is the service corridor's wall: a staff door onto it (the family's shared-corridor policy)
    if (!p.sideStock) {
      const dBack = sd + p.ds + 1 + p.st; // first row beyond the stockroom (its back wall), then the corridor
      const u0 = sa + 1, u1 = sa + p.w - 1;
      let ok = u1 - u0 >= 3;
      for (let u = u0; u < u0 + 3 && ok; u++) { const q = lotRect(s, u, 1, dBack + 1, 1); if (c.svc[q.y * c.W + q.x] < 0) ok = false; }
      if (ok) {
        const q = lotRect(s, u0, 1, dBack + 1, 1);
        k.carveDoor(lineRect(s, u0, 3, dBack + 1), back, k.areas[c.svc[q.y * c.W + q.x]], DOOR_HEIGHT, false, {staff: true});
        serviceDoor = true;
      }
    }
    stockCells = r.w * r.h;
    // staff door between them (3 cells, off-centre)
    if (p.sideStock) {
      const t = p.sideStock === 'L' ? sa - 1 : sa + p.w;
      const dl = Math.max(2, Math.floor(p.ds / 2) - 1);
      const gap = s.dir === 'N' || s.dir === 'S' ? {...lotRect(s, t, 1, sd + dl, 3)} : {...lotRect(s, t, 1, sd + dl, 3)};
      k.carveDoor(gap, S, back, DOOR_HEIGHT, false, {staff: true});
    } else {
      const u = c.rng.chance(0.5) ? sa + 1 : sa + p.w - 4;
      k.carveDoor(lineRect(s, Math.max(sa, u), Math.min(3, p.w), sd + p.ds + 1), S, back, DOOR_HEIGHT, false, {staff: true});
    }
  }
  // corner units: the second shopfront on the side wall facing the other walkway (found before carving)
  if (corner) {
    const d = k.carveDoor(corner.gap, k.areas[corner.gal], S, CLEAR.shopfront, false, {shopfront: true});
    fronts.push({rect: corner.gap, side: corner.side, door: d.id});
  }
  c.count.set(p.id, (c.count.get(p.id) ?? 0) + 1);
  const shop: ShopCarve = {
    id: '', level: lv, side: OPP[s.dir], sales: S.id, ...(back ? {back: back.id} : {}), kind, lot: p.id, zone, fronts,
    rect: lotRect(s, sa, p.w, sd, p.ds), stock: back ? (f.stock === 'service-corridor' && !serviceDoor ? 'rear' : f.stock) : 'none', stockCells, serviceDoor,
    ...(recessA ? {recess: recessA.id} : {}),
  };
  shop.id = `L${lv}-${String(c.shops.filter(q => q.level === lv).length + 1).padStart(2, '0')}`;
  c.shops.push(shop);
  return shop;
}

const kindOf = (id: MallLotId): ShopCarve['kind'] => (id === 'kiosk-cell' ? 'kiosk' : id === 'food-counter' ? 'food' : id === 'anchor-deep' ? 'anchor' : 'store');

/** An end unit / anchor closing a corridor end, centred on the end segment (wider than the corridor where it fits). */
function placeEnd(c: LotCtx, e: {dir: Side4; line: number; a0: number; a1: number}, id: MallLotId): ShopCarve | null {
  const f = MALL_LOTS[id];
  const seg: Seg = {dir: e.dir, line: e.line, a0: e.a0, a1: e.a1, zone: 'end'};
  // the end row must be walkway on this floor
  if (frontOk(c, seg, e.a0 + 1, e.a1 - 1) < 0) return null;
  const segLen = e.a1 - e.a0;
  for (let tries = 0; tries < 6; tries++) {
    const p = planLot(c, id, cellsOf(f.width[1]) + 4, cellsOf(f.depth[1]) + 12);
    if (!p) return null;
    // shrink width toward the corridor width over the tries (a wide unit may collide with the side bands' space later: it is first)
    p.w = Math.max(cellsOf(f.width[0]), Math.min(p.w, segLen + 16 - tries * 4), Math.min(segLen + 2, cellsOf(f.width[1])));
    if (tries >= 3) p.ds = Math.max(cellsOf(f.depth[0]), p.ds - (tries - 2) * 4);
    const alongT = p.w + (p.sideStock ? p.st + 1 : 0);
    const a = Math.round((e.a0 + e.a1) / 2 - alongT / 2);
    const s = carveLot(c, seg, a, p, 'end', kindOf(id), {endCentre: true});
    if (s) return s;
  }
  return null;
}

/**
 * Fills a walkway edge with lots, left to right: families suiting the zone (or `only`), weighted, with per-mall caps; corner units
 * where the edge meets another walkway; kiosk cells in short leftovers. Stops after `max` units.
 */
function fillSegment(c: LotCtx, s: Seg, only: MallLotId[] | null, max: number): number {
  let placed = 0, a = s.a0;
  let deepMax = c.rng.int(24, 30);
  // a service corridor behind this edge (probed at its middle): lots that can reach it are sized to (their back wall = its wall)
  let reach = 0;
  for (let d = 0; d < 40; d++) { const q = lotRect(s, (s.a0 + s.a1) >> 1, 1, d, 1); if (q.x < 0 || q.y < 0 || q.x >= c.W) break; if (c.svc[q.y * c.W + q.x] >= 0) { reach = d - 1; break; } }
  if (reach > 0) deepMax = reach;
  while (a < s.a1 - 5 && placed < max) {
    const rem = s.a1 - a;
    // a corner where the edge meets another walkway at its far end: the last unit can take two frontages
    // the front cell must be walkway (not a run mouth / well / the void) to start a unit here
    { const [fx, fy] = frontCell(s, a + 1); if (c.walkArea[fy * c.W + fx] < 0) { a++; continue; } }
    const cornerEnd = rem <= cellsOf(MALL_LOTS['corner-double'].width[1]) + 8 && cornerBeyond(c, s, s.a1);
    const cornerStart = a <= s.a0 + 1 && cornerBeyond(c, s, s.a0 - 1);
    let fams: MallLotId[];
    if (only) fams = only;
    else {
      fams = (Object.keys(MALL_LOTS) as MallLotId[]).filter(id => {
        const f = MALL_LOTS[id];
        if (id === 'end-unit' || id === 'anchor-deep' || id === 'food-counter') return false;
        if (id === 'corner-double') return (cornerEnd || cornerStart) && (c.count.get(id) ?? 0) < f.maxPerMall;
        return f.zones.includes(s.zone === 'court' ? 'court' : s.zone === 'atrium' ? 'atrium' : 'corridor') && (c.count.get(id) ?? 0) < f.maxPerMall;
      });
    }
    // weighted order (corner first when available)
    const order: MallLotId[] = [];
    const pool = fams.map(id => [id, MALL_LOTS[id].weight * (id === 'corner-double' ? 6 : 1) * (id === 'kiosk-cell' && rem > 30 ? 0.3 : 1)] as [MallLotId, number]);
    while (pool.length) { const id = c.rng.weighted(pool); order.push(id); pool.splice(pool.findIndex(q => q[0] === id), 1); }
    let got: ShopCarve | null = null;
    for (const id of order) {
      const p = planLot(c, id, rem, deepMax);
      if (!p) continue;
      const fam = MALL_LOTS[id];
      if (reach > 0 && !p.sideStock && fam.stock !== 'none' && p.st > 0) {
        // stretch to the corridor: grow the stockroom within its range, then the sales floor within its range
        const used = p.ds + 1 + p.st + (p.recess ? p.recess + 1 : 0);
        let gap = reach - used;
        const stMax = cellsOf(fam.stockSize[1]), dsMax = cellsOf(fam.depth[1]);
        const dst = Math.max(0, Math.min(gap, stMax - p.st)); p.st += dst; gap -= dst;
        const dds = Math.max(0, Math.min(gap, dsMax - p.ds)); p.ds += dds;
      }
      for (const shrink of [0, 2, 4]) {
        const q = {...p, ds: Math.max(cellsOf(MALL_LOTS[id].depth[0]), p.ds - shrink)};
        // a corner unit at the far end hugs the end of the edge
        const alongT = q.w + (q.sideStock ? q.st + 1 : 0);
        const at = id === 'corner-double' && cornerEnd && !cornerStart ? Math.max(a, s.a1 - 1 - alongT) : a;
        got = carveLot(c, s, at, q, s.zone, kindOf(id));
        if (got) { a = at + alongT + 1; break; }
      }
      if (got) break;
    }
    if (got) placed++;
    else a += 1;
  }
  return placed;
}

/** Is there walkway beyond along-position a (outside the edge's span) at the band's depth rows (the edge turns a corner there)? */
function cornerBeyond(c: LotCtx, s: Seg, a: number): boolean {
  let n = 0;
  for (let d = 1; d < 14; d++) {
    const q = lotRect(s, a, 1, d, 1);
    if (q.x < 0 || q.y < 0 || q.x >= c.W) return false;
    if (c.walkArea[q.y * c.W + q.x] >= 0) n++;
  }
  return n >= 6;
}

/** A washroom passage (public, from the walkway) with the men's / women's washrooms off it, in a band slot of the segment. */
function placeWashrooms(c: LotCtx, s: Seg): WashroomCarve | null {
  const {k, lv, base} = c;
  const span = s.a1 - s.a0 - WC_SLOT - 2;
  if (span < 0) return null;
  const opt = {level: lv, floorY: base};
  for (let t = 0; t < 8; t++) {
    const a = s.a0 + 1 + Math.round(span * c.rng.next());
    const foot = lotRect(s, a, WC_SLOT, 0, WC_DEPTH);
    if (!k.rectFree(foot, lv)) continue;
    const gal = frontOk(c, s, a, a + 4);
    if (gal < 0) continue;
    const P = k.addArea(lotRect(s, a, 4, 0, WC_DEPTH), 'passage', 'passage', r2(base + CLEAR.corridor), gal, {...opt, label: `Washrooms · ${mallStoreyLabel(lv)}`, publicSpace: true});
    k.carveDoor(lineRect(s, a, 4), k.areas[gal], P, 2.6, false);
    const m = Math.floor((WC_DEPTH - 1) / 2);
    const rooms: number[] = [];
    for (const [d0, dd, label] of [[0, m, "Men's washroom"], [m + 1, WC_DEPTH - m - 1, "Women's washroom"]] as const) {
      const R = k.addArea(lotRect(s, a + 5, WC_SLOT - 5, d0, dd), 'room', 'washroom', r2(base + CLEAR.back), P.id, {...opt, label, publicSpace: true});
      // door from the passage through the wall line between them (along a + 4), mid-depth of the room
      const dm = d0 + Math.max(1, Math.floor(dd / 2) - 1);
      k.carveDoor(lotRect(s, a + 4, 1, dm, 3), P, R, DOOR_HEIGHT, false);
      rooms.push(R.id);
    }
    return {level: lv, passage: P.id, rooms};
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Station back of house

/**
 * The station storey's back of house: a 1.5 m service corridor west (or east) off the Fountain court through a staff door, with the
 * men's / women's washrooms (public doors) on its north side and the station agent office / a maintenance store on its south side
 * (never toward the track bed: everything stays north of the north platform's back wall).
 */
function stationServices(k: Kit, rng: Rng, sk: MallSkeleton, court0: number[]): number[] | null {
  const g0 = k.grid(0), C = sk.court0;
  const out: number[] = [];
  for (const west of rng.chance(0.7) ? [true, false] : [false, true]) {
    const len = rng.int(26, 34);
    const sy = C.y + 2, sh = 3;
    const spur: CellRect = west ? {x: C.x - 1 - len, y: sy, w: len, h: sh} : {x: C.x + C.w + 1, y: sy, w: len, h: sh};
    if (!west && spur.x + spur.w > sk.px1 - 4) continue; // keep the east end clear for Track2's growth
    const north: CellRect = {x: spur.x, y: C.y - 7, w: len, h: sy - 1 - (C.y - 7)};
    const south: CellRect = {x: spur.x, y: sy + sh + 1, w: len, h: sk.P2y - 2 - (sy + sh + 1)};
    if (!k.rectFree(spur, 0) || north.h < 6 || south.h < 5 || !k.rectFree(north, 0) || !k.rectFree(south, 0)) continue;
    const wallX = west ? C.x - 1 : C.x + C.w;
    const ca = g0.area[g0.idx(west ? C.x : C.x + C.w - 1, sy + 1)];
    if (ca < 0 || !court0.includes(ca)) continue;
    const S = k.addArea(spur, 'service', 'service-corridor', CLEAR.core0, ca, {label: 'Station service corridor', publicSpace: false});
    k.carveDoor({x: wallX, y: sy, w: 1, h: sh}, k.areas[ca], S, CLEAR.door, false, {staff: true});
    out.push(S.id);
    // north: washrooms (men's / women's side by side), public doors off the corridor
    const half = Math.floor((len - 1) / 2);
    for (const [x, w, label] of [[north.x, half, "Men's washroom"], [north.x + half + 1, len - half - 1, "Women's washroom"]] as const) {
      const R = k.addArea({x, y: north.y, w, h: north.h}, 'room', 'washroom', CLEAR.back, S.id, {label, publicSpace: true});
      k.carveDoor({x: x + Math.floor(w / 2) - 1, y: sy - 1, w: 3, h: 1}, S, R, DOOR_HEIGHT, false);
      out.push(R.id);
    }
    // south: station agent office + maintenance store
    for (const [x, w, type, label] of [[south.x, half, 'agent-office', 'Station agent office'], [south.x + half + 1, len - half - 1, 'storage', 'Maintenance store']] as const) {
      const R = k.addArea({x, y: south.y, w, h: south.h}, 'room', type, CLEAR.back, S.id, {label, publicSpace: false});
      k.carveDoor({x: x + Math.floor(w / 2) - 1, y: sy + sh, w: 3, h: 1}, S, R, DOOR_HEIGHT, false, {staff: true});
      out.push(R.id);
    }
    return out;
  }
  return null;
}

/** Grid helper: the floor cells of a level grid inside a rect. */
export function floorCells(g: {cells: Uint8Array; idx: (x: number, y: number) => number}, r: CellRect): number {
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (g.cells[g.idx(x, y)] === FLOOR) n++;
  return n;
}

export {overlaps};

/**
 * Task mall-round2-20261031 (lane GEN, M09): the canvas cell rect kept free beyond a designed street-exit end on every retail floor —
 * the vestibule pocket and the near part of the exterior view (EXIT.vest + the minimum view depth + 4 cells), EXIT.viewSide[1] / 3
 * cells wider than the corridor each side.
 */
export function exitReserveRect(e: Pick<EndSpec, 'dir' | 'line' | 'a0' | 'a1'>): CellRect {
  const D = EXIT.vest + EXIT.viewDepth[0] + 4, s = Math.ceil(EXIT.viewSide[1] / 3);
  const t0 = e.a0 - s, t1 = e.a1 + s;
  switch (e.dir) {
    case 'N': return {x: t0, y: e.line - D + 1, w: t1 - t0, h: D};
    case 'S': return {x: t0, y: e.line, w: t1 - t0, h: D};
    case 'W': return {x: e.line - D + 1, y: t0, w: D, h: t1 - t0};
    default: return {x: e.line, y: t0, w: D, h: t1 - t0};
  }
}
