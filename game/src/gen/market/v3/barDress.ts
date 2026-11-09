// Task studio-market-bar-20261108-225231-01 (lane BAR): the FURNISHING of the Survivor Market's upper-level bar (layout version 3; the
// deck: gen/market/v3/barCarve.ts). Existing prop kinds only (the station's shop counter / shelving / crates, the mall's café bistro tables
// and chairs — assets/levelAssets.ts lets the market load them — the record store's counter stools, the office's jukebox / globe bar,
// the p7 till), every placement through the shared placement kit (gen/placeKit.ts: blocked cells, keep-clear cells, connectivity, the
// one-cell setback from every railing / the stair), deterministic on its own fork. Nothing here holds loot: every holder gets the market's
// exact empty key (version 1's MARKET_EMPTY_KEY), like every other market fixture.
//
// The deck in its own frame: u across it from the stair side toward block C (world x, or -x when mirrored), v from its Market Lane edge
// (north) toward the Back Lane (south). Rows of the plan (v, m):
//   0.5 - 1.0   the BACKBAR along the north railing: shelving units end to end (the bar's bottles — the bartender's finite stock —
//               stand on their tiers: the stall's display surfaces); the bar's hanging name board above it;
//   1.0 - 2.0   the bartender's aisle (the bartender's post in the middle, facing the customers);
//   2.0 - 2.8   the long BAR COUNTER (three 1.5 m shop counter modules, flush with the deck's block-C edge; the bartender's way in at the
//               stair end; a till and two lanterns riding on it);
//   3.0 - 3.5   the counter STOOLS (every other cell), the customer's spot to buy from the bartender behind the middle gap;
//   4.5 - 7.5   a row of bistro TABLES with a chair each side (the stair's landing at the south-west keeps its approach clear), the
//               jukebox against the block-C edge facing them;
//   7.5 - 8.0   along the south railing: crates of empties, a globe bar;
// + pendant lamps from the shed roof over the counter and the tables. The patrons' 'drink' posts (gen/market/v3/barRecord.ts) are the
// stools' and chairs' seats.

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {isLootHolderKind} from '../../../items/loot';
import {makePlaceCtx, markCell, tryPlaceProp, type PlaceCtx, type PlaceOpts} from '../../placeKit';
import type {Area, LightPlacement, StationLayout} from '../../stationTypes';
import {MARKET_EMPTY_KEY} from '../dress';
import {STALL_SIGNS} from '../names';
import {BAR_STALL} from '../marketTypes';
import {SETTLE} from '../v2/frame';
import type {DisplaySource, StallDressed2} from '../v2/dress';
import type {BarCarve} from './barCarve';

/** The plan's depths (v, m from the deck's north edge) and sizes. */
export const BAR_PLAN = {
  /** Backbar units' back gap to the setback line (m); the bartender's post; the counter's centre line; the stools; the customer spot. */
  backGap: 0.03,
  traderV: 1.5,
  counterV: 2.395,
  stoolV: 3.25,
  frontV: 3.75,
  /** The table row's centre line (a cell line: the tables stand on cell corners). */
  tableV: 6.0,
  /** Stools: one per cell, every other cell along the counter (a 1 m pitch; the counter's cells are 0.5 m), the customer spot's cell
   *  between two of them left free. */
  stoolPitch: 1.0,
  /** Fewest counter modules / display shelves / stools / tables a bar must get. */
  min: {modules: 2, shelves: 2, stools: 4, tables: 3},
  /** Pendant lamps: height above the deck (m). */
  lampY: 2.5,
} as const;

/** Fixtures that show the bar's stock (their exposed shelf tiers: items/lootLayout.ts holderSurfaces). */
const SHELF_TIERS: readonly number[] = [0, 1, 2];

/** A seat a patron may take (a stool or a chair: layout.props index), the point it faces (the counter / its table). */
export interface BarSeat { prop: number; x: number; z: number; faceX: number; faceZ: number }

export interface BarDressed {
  stall: StallDressed2;
  seats: BarSeat[];
  /** QA / tests: what was placed. */
  counts: {modules: number; shelves: number; stools: number; tables: number; chairs: number; lamps: number; decor: number};
}

/** Required pieces that did not fit, and placements the kit refused (by kind) (QA / tests). */
export const BAR_DRESS_FAILS: Record<string, number> = {};
export const BAR_PUT_FAILS: Record<string, number> = {};
/** The last refused placements (kind @ u, v; QA). */
export const BAR_PUT_LOG: string[] = [];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Furnishes the bar deck (props, lamps, its board); null when a required piece does not fit (the caller re-rolls). */
export function dressBar(layout: StationLayout, bc: BarCarve, rng: Rng, name: string): BarDressed | null {
  const fail = (why: string): null => { BAR_DRESS_FAILS[why] = (BAR_DRESS_FAILS[why] ?? 0) + 1; return null; };
  const a: Area = layout.areas[bc.area];
  a.label = name;
  a.noFloorLoot = true;
  const ctx: PlaceCtx = makePlaceCtx(layout, rng, 1);
  const g = ctx.g, P = BAR_PLAN, R = bc.rect, dir = bc.dir;
  const X0 = R.x * CELL, X1 = (R.x + R.w) * CELL, Z0 = R.y * CELL;
  const U = R.w * CELL;
  const x = (u: number) => (dir > 0 ? X0 + u : X1 - u), z = (v: number) => Z0 + v;
  // rotations (front = local +Z: world (sin rot, cos rot)) and people's yaws (forward = (-sin yaw, -cos yaw))
  const ROT = {south: 0, north: Math.PI, alongU: dir > 0 ? Math.PI / 2 : -Math.PI / 2, backU: dir > 0 ? -Math.PI / 2 : Math.PI / 2};
  const B1 = SETTLE.bases[1];
  const counts = {modules: 0, shelves: 0, stools: 0, tables: 0, chairs: 0, lamps: 0, decor: 0};

  const put = (kind: PropKind, u: number, v: number, rot: number, o: PlaceOpts = {}): PropPlacement | null => {
    const p = tryPlaceProp(ctx, a, kind, r3(x(u)), r3(z(v)), rot, {checkZone: false, ...o});
    if (p && isLootHolderKind(kind)) p.purpose = MARKET_EMPTY_KEY;
    if (p) p.variant = o.variant ?? rng.int(0, 11);
    else { BAR_PUT_FAILS[kind] = (BAR_PUT_FAILS[kind] ?? 0) + 1; BAR_PUT_LOG.push(`${kind}@${u.toFixed(2)},${v.toFixed(2)} U${U}`); if (BAR_PUT_LOG.length > 60) BAR_PUT_LOG.shift(); }
    return p;
  };
  /** A loose thing standing on a host's top (host-local lx, lz; it never blocks cells: it moves / is taken off the host). */
  const onHost = (host: PropPlacement, kind: PropKind, lx: number, lz: number, turn = 0): PropPlacement | null => {
    const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
    if (Math.abs(lx) + def.w / 2 > hd.w / 2 || Math.abs(lz) + def.d / 2 > hd.d / 2) return null;
    const c = Math.cos(host.rot), s = Math.sin(host.rot), rot = host.rot + turn;
    const {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(host.x + lx * c + lz * s), z: r3(host.z - lx * s + lz * c), y: host.y + host.h, rot, area: host.area, hx, hz, h: def.h, blocksSight: false, variant: rng.int(0, 11), host: layout.props.indexOf(host)};
    if (host.level) p.level = host.level;
    (host.cut ??= []).push({y: host.h, x0: r3(lx - def.w / 2 - 0.02), x1: r3(lx + def.w / 2 + 0.02)});
    layout.props.push(p);
    return p;
  };
  /** Keeps every deck cell overlapping the (u, v) box clear of props (the bartender's post and way in, the customer spot, the walks). */
  const keepClear = (u0: number, v0: number, u1: number, v1: number) => {
    const xa = Math.min(x(u0), x(u1)), xb = Math.max(x(u0), x(u1)), za = z(v0), zb = z(v1);
    for (let cy = Math.floor(za / CELL); cy <= Math.floor((zb - 1e-6) / CELL); cy++) for (let cx = Math.floor(xa / CELL); cx <= Math.floor((xb - 1e-6) / CELL); cx++) {
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.area[i] === a.id) markCell(ctx, ctx.keep, i);
    }
  };
  const light = (u: number, v: number, power: number) => {
    const l: LightPlacement = {x: r3(x(u)), y: r3(B1 + P.lampY), z: r3(z(v)), rot: 0, area: a.id, broken: false, flicker: false, warm: true, power, dying: false, level: 1};
    layout.lights.push(l);
    counts.lamps++;
  };

  // --- the counter run: as many 1.5 m modules as leave the bartender a >= 1.2 m way in at the stair end (flush with the block-C edge) ----
  const cw = PROP_DEFS.shopCounter.w, cd = PROP_DEFS.shopCounter.d;
  let n = 3;
  while (n > P.min.modules && U - n * cw < 0.5 + 1.2) n--;
  const uc0 = U - n * cw, uc1 = U;
  if (uc0 < 0.5 + 1.2 - 1e-6) return fail('counter');
  // the bartender / the customer face each other across the middle module's centre: a cell centre (the deck and the counter run lie on
  // whole cells), so the clear disc round each stand point needs its own cell and its four neighbours free (gen/grid.ts circleClear)
  const uMid = (uc0 + uc1) / 2;
  // the keep-clear cells first: the bartender's post and way in, the customer spot (its cell in the stool row, the row behind, the cell
  // after that), the stair landing's approach, the walk along the block-C edge (the deck's join to the ring) behind the stools
  keepClear(uMid - 0.4, P.traderV - 0.4, uMid + 0.4, P.traderV + 0.4);
  keepClear(0.5, 1.0, uc0, P.counterV + cd / 2);
  keepClear(uMid - 0.2, 3.0, uMid + 0.2, P.frontV + 0.7);
  keepClear(uMid - 0.7, P.frontV - 0.2, uMid + 0.7, P.frontV + 0.2);
  const vLand0 = (bc.landing.y0 - R.y) * CELL, vLand1 = (bc.landing.y1 - R.y) * CELL;
  keepClear(0, vLand0 - 0.3, 1.7, vLand1 + 0.3);
  keepClear(U - 0.8, P.stoolV + 0.25, U, P.stoolV + 1.25);
  const modules: PropPlacement[] = [];
  for (let k = 0; k < n; k++) {
    const p = put('shopCounter', uc0 + cw / 2 + k * cw, P.counterV, ROT.south, {doorOk: true});
    if (!p) return fail(`counter module ${k}`);
    modules.push(p);
  }
  counts.modules = n;

  // --- the backbar along the north railing: shelving for the bottles, end to end (the bartender's aisle in front of it) ------------------
  const displays: DisplaySource[] = [];
  const vBack = (d: number) => 0.5 + P.backGap + d / 2;
  // (each unit centred on its own three cells: two never share a cell)
  const sw = PROP_DEFS.shelf.w, uEnd = U - 0.55, pitch = Math.ceil(sw / CELL - 1e-6) * CELL;
  for (let u = 0.5; u + (pitch + sw) / 2 <= uEnd + 1e-6; u += pitch) {
    const p = put('shelf', u + pitch / 2, vBack(PROP_DEFS.shelf.d), ROT.south);
    if (!p) continue;
    counts.shelves++;
    const idx = layout.props.indexOf(p);
    for (const s of SHELF_TIERS) displays.push({prop: idx, surface: s});
  }
  if (counts.shelves < P.min.shelves) return fail(`${counts.shelves} shelves`);

  // the counter's own things (loose: knocked off, they fall): the till by the customer spot, a lantern at each end
  const till = modules[Math.floor(n / 2)];
  if (onHost(till, 'cashRegister', dir > 0 ? 0.42 : -0.42, -0.08, Math.PI)) counts.decor++;
  if (onHost(modules[0], 'campLantern', dir > 0 ? -0.45 : 0.45, -0.1)) counts.decor++;
  if (n > 1 && onHost(modules[n - 1], 'campLantern', dir > 0 ? 0.45 : -0.45, -0.1)) counts.decor++;

  // --- the stools along the counter (the customer spot's gap kept clear) --------------------------------------------------------------
  const seats: BarSeat[] = [];
  const firstStool = uMid - P.stoolPitch / 2 - Math.floor((uMid - P.stoolPitch / 2 - uc0) / P.stoolPitch) * P.stoolPitch;
  for (let u = firstStool; u <= U - 0.2 + 1e-6; u += P.stoolPitch) {
    const p = put('skyMuStool', u, P.stoolV, ROT.north);
    if (!p) continue;
    counts.stools++;
    seats.push({prop: layout.props.indexOf(p), x: p.x, z: p.z, faceX: p.x, faceZ: r3(z(P.counterV))});
  }
  if (counts.stools < P.min.stools) return fail(`${counts.stools} stools`);

  // --- a row of bistro tables, a chair each side (north / south): every piece on whole cells (a table on a cell corner takes 2 x 2 cells,
  // a chair centred on a cell line across 2 x 2: no two pieces share a cell), 1.5 m apart, clear of the stair landing's approach --------
  const chairOff = 0.8; // (a chair 0.15 m off the table edge, inside its own two rows)
  for (let b = Math.ceil((1.7 + 0.5) / CELL) * CELL; b + 0.5 <= U - 0.5 + 1e-6; b += 1.5) {
    const t = put('cafeBistroTable', b, P.tableV, ROT.south);
    if (!t) continue;
    let seated = 0;
    for (const s of [-1, 1] as const) {
      const c = put('cafeChair', b, P.tableV + s * chairOff, s < 0 ? ROT.south : ROT.north);
      if (!c) continue;
      seated++;
      counts.chairs++;
      seats.push({prop: layout.props.indexOf(c), x: c.x, z: c.z, faceX: t.x, faceZ: t.z});
    }
    if (seated) counts.tables++;
  }
  if (counts.tables < P.min.tables) return fail(`${counts.tables} tables`);

  // --- the jukebox against the block-C edge facing the tables; along the south railing crates of empties and a globe bar ---------------
  const jk = PROP_DEFS.jukebox;
  for (const v of [P.tableV, P.tableV - 0.5, P.tableV + 0.5]) if (put('jukebox', U - 0.03 - jk.d / 2, v, ROT.backU)) { counts.decor++; break; }
  const vSouth = (d: number) => (R.h - 1) * CELL - 0.03 - d / 2;
  for (const kind of ['globeBar', 'crate', 'crate'] as PropKind[]) {
    const d = PROP_DEFS[kind];
    for (let u = U - 0.55 - d.w / 2; u >= 1.75 + d.w / 2; u -= 0.25) if (put(kind, u, vSouth(d.d), ROT.north)) { counts.decor++; break; }
  }

  // --- lamps: pendants from the shed roof over the counter and over each table row; the name board over the backbar ----------------
  for (const t of [0.25, 0.75]) light(uc0 + (uc1 - uc0) * t, P.counterV - 0.2, 0.9);
  for (const t of [0.4, 0.78]) light(U * t, P.tableV, 0.75);
  for (const t of [0.15, 0.6]) light(U * t, P.frontV + 0.4, 0.6); // (over the stools' aisle and the stair end)
  const style = STALL_SIGNS[BAR_STALL].style;
  layout.signs.push({kind: 'info', text: name.split(' — ')[0], area: a.id, x: r3(x(0.55 + (uEnd - 0.55) / 2)), z: r3(z(1.05)), y: r3(B1 + 2.55), rot: 0, w: 2.6, hang: true, style, level: 1});

  // --- the stall record (world metres; the record pass adds storeys / heights) ----------------------------------------------------
  const cxA = x(uc0), cxB = x(uc1);
  const stall: StallDressed2 = {
    id: BAR_STALL, area: a.id, level: 1,
    counter: {x0: r3(Math.min(cxA, cxB)), z0: r3(z(P.counterV - cd / 2)), x1: r3(Math.max(cxA, cxB)), z1: r3(z(P.counterV + cd / 2))},
    trader: {x: r3(x(uMid)), z: r3(z(P.traderV)), yaw: r3(Math.PI)},
    front: {x: r3(x(uMid)), z: r3(z(P.frontV))},
    displays,
  };
  return {stall, seats, counts};
}
