// Task studio-survivor-market-crevice-20261116-074419 (lane DRESS): the FURNISHING of THE SURVIVOR MARKET version 5 — THE CREVICE
// (gen/market/v5/carve.ts) — its own pass, existing prop kinds only (versions 2 / 3's market kinds: the station / p7 / office kinds and
// the mall's café furniture, gun rack, plank shelving the market may load — assets/levelAssets.ts LEVEL_ONLY_RULES — plus the office's
// small potted plant, a shared model), every placement through the shared placement kit (gen/placeKit.ts: blocked cells, keep cells,
// door cells, stair / railing setbacks, connectivity), deterministic on the `dress` fork. User: "Make it feel like people genuinely live
// here and survive against the odds" — warm, occupied pockets in cold concrete.
//
//  - THE SIX SHOPS: walk-in rooms (the container and its rock-cut backroom one 5.5 m deep room, a 3 m shopfront onto the square / the
//    lower terrace): side shelving in the customer zone by the opening, a counter run ALONG the crevice (along z: the trader and the
//    customer differ in x), the trader behind it, the trade's back-wall fixtures and floor props behind the trader (version 2's walk-in
//    rules in a frame that works for containers facing east or west). Every display surface is recorded (gen/market/v5/record.ts).
//  - THE BAR on its deck over the Arrival Square (storey 1): the backbar shelving along the rock, the bartender's aisle, a counter run
//    with its till and lanterns, stools, bistro tables with chairs at both ends of the deck, the jukebox; its two cellars (the
//    'bar-store' containers on the lower terrace). The deck's south band (by the railing over the square) stays the cross lane.
//  - EVERY OPEN CONTAINER furnished by its use (homes, the bunk room, the communal kitchen and its pantry, the workshop and its store,
//    the water point, the latrine, the generator shed, the stores — the first one the community store room —, tea counters, the repair
//    counter, the laundry, the bar's cellars); THE DEN'S ENTRY gets nothing (gen/market/v5/den.ts owns it: a passage).
//  - THE TERRACES / LOW WALKS / THE SQUARE / THE WEIR: lived-in dressing along the container fronts only (chairs, crates, bins, bikes,
//    plants, drying racks, water tanks up top), the terrace nooks themed (a sitting terrace, a garden, a lookout, a drying corner, a
//    stack of stores), the square's gathering spot, the weir's communal eating (long tables, benches, the cook's camp table).
//  - THE CLEAR LANES: every walk / terrace keeps its outer 2 m (all but the 1 m strip along the container fronts; the low walks all but
//    0.5 m) as keep cells, so nothing ever stands there; likewise every bridge mouth, every stair foot (and the kit's stair approaches),
//    the gates' aprons, the den's approach, the chasm's edge, the square's and the weir's cross routes and side lanes, the bar deck's
//    cross lane, the platform's train side. Door zones (2 cells round every opening) stay clear on the public floors.
//  - LIGHTS (warm): a lamp in every open container and backroom, the shops / kitchen / workshop / bar their own, WALL LAMPS on the
//    container fronts along every walk on both sides every ~6 m at door-head height, lamps under the bridges' decks and the bar's deck,
//    over every stair foot and nook — never high in the open void. (The crevice's walks are open to its top: a pendant there would draw
//    a rod up to 19.5 m — world/builder.ts rods reach min(area ceiling, local ceiling) — so a wall lamp on an open floor names the
//    container it is fixed to (or the nearest open container of its storey) as its area: the rod is the 0.2 m bracket under that
//    container's roof edge.)
//  - SIGNS: each stall's painted board over its front and a blade sign standing out from it, painted notices over the services, the
//    bar's board on the rock over the backbar, the platform's name plates and MARKET boards.
//
// THE MARKET RULE (unchanged): nothing here holds loot — every loot-holder kind gets the exact empty key (MARKET_EMPTY_KEY) except
// version 2's community stores (the workshop's bench row and the first store room's crates / shelf / footlocker: MARKET_WORKSHOP_KEY,
// the same recipe and kinds as gen/market/v2/dress.ts). No pickups.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, SOLID, VOID, type Grid} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {isLootHolderKind} from '../../../items/loot';
import {MARKET_WORKSHOP_KEY} from '../../../items/lootTables';
import {makePlaceCtx, markCell, mountProp, tryPlaceProp, type PlaceCtx, type PlaceOpts} from '../../placeKit';
import {DOOR_CLEAR} from '../../doorways';
import type {Area, LightPlacement, Rect, Side, SignPlacement, StationLayout} from '../../stationTypes';
import {MARKET_EMPTY_KEY} from '../dress';
import {STALL_SIGNS} from '../names';
import {BAR_STALL, type MarketShopId, type MarketStallId} from '../marketTypes';
import {SURF_TOP, type DisplaySource, type StallDressed2, type UseKind} from '../v2/dress';
import {CREVICE} from './frame';
import type {CrevContainer, CreviceCarve} from './carve';

/** Fixed numbers of the furnishing (m unless noted). */
export const CREVICE_DRESS = {
  /** A container's ceiling lamp (above its floor), a wall / under-deck lamp (above the storey floor), its distance off the wall. */
  roomLampY: CREVICE.cont - 0.02,
  wallLampY: 2.4,
  wallLampOff: 0.15,
  /** Wall lamps along a frontage: about every `lampEvery` m (seeded +-1 m). */
  lampEvery: 5.0,
  /** Cells next to a frontage that may be dressed: the terraces' first two (1 m), the storey-0 floor's first (0.5 m); the rest of the
   *  walk is the clear lane (>= 2 m on the 3 m terraces and the 2.5 m low walks). */
  dressCells: {walk: 2, low: 1},
  /** Props stand this far off a wall (a 0.5 m deep prop keeps to one cell). */
  wallGap: 0.03,
  /** The square's gate apron / the weir's cross route (rows kept clear across the whole floor). */
  apron: 6,
  cross: 4,
  /** Clear cells in front of the den's entry door on the square (its body-carry approach). */
  denApproach: 3,
  /** The platform's train side kept clear (m from the edge). */
  trainSide: 2.5,
  /** (layout version 7) A plaza: a walk section at least `min` cells wide keeps its outer `lane` cells (2 m) clear; its seating group. */
  plaza: {min: 9, lane: 4, rows: 6},
  /** (layout version 7) A stair's head kept clear on the walk above: rows [run end - [0], run end + [1]) across the walk. */
  stairHead: [3, 4],
} as const;

/** QA / tests: per furnished layout, what this pass placed (the first `props` / `lights` / `signs` entries are its own: later passes
 *  — the den — append) and the community stores. */
export const CREVICE_DRESS_QA = new WeakMap<StationLayout, {props: number; lights: number; signs: number; community: CreviceAnchors['community']; counts: Record<string, number>}>();
/** Required pieces that did not fit, placements refused by kind (QA / tests). */
export const CREVICE_DRESS_FAILS: Record<string, number> = {};
export const CREVICE_PUT_FAILS: Record<string, number> = {};

/** A seat a bar patron may take (a stool or a chair: layout.props index) and the point it faces (the counter / its table). */
export interface CrevSeat { prop: number; x: number; z: number; faceX: number; faceZ: number }
/** A resident's post beside the furniture it belongs to (or open floor): `home` — inside a home (private: the record keeps a few). */
export interface CrevUsePost { kind: UseKind; x: number; z: number; level: number; yaw: number; area: number; home?: boolean }

/** Anchors the record pass reads. */
export interface CreviceAnchors {
  /** The six shops (any order) and the bar (BAR_STALL). */
  stalls: StallDressed2[];
  uses: CrevUsePost[];
  bar: {area: number; seats: CrevSeat[]};
  /** QA / tests: the community stores (layout.props indices keyed MARKET_WORKSHOP_KEY) and version 2's count for the same recipe. */
  community: {props: number[]; expected: number; workshop: number; store: number};
  /** QA / tests: counts of what was placed. */
  counts: Record<string, number>;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const WALL_ROT: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};

/** Holder fixtures and their exposed display surfaces (items/lootLayout.ts holderSurfaces; version 2's table). */
const SHELF_SURFACES: Readonly<Partial<Record<PropKind, readonly number[]>>> = {
  shelf: [0, 1, 2], outdoorsPlankShelving: [0, 1, 2], medCabinet: [1, 2, 3], shopCounter: [0],
};
const SOLID_TOPS: ReadonlySet<PropKind> = new Set(['gunDisplay']);
/** The bar's backbar shelving tiers (its stock: the bartender's side of the counter). */
const BAR_TIERS: readonly number[] = [0, 1, 2];

/**
 * A room's local frame for a container facing east or west: u along the crevice (world +z from the room's north end), v the depth
 * inward from its opening wall (the walk side). Rotations: `out` = a fixture backed onto the back wall facing the opening; end walls:
 * 'L' (u 0, the north end) faces +z, 'R' (u U) faces -z.
 */
interface Frame { a: Area; U: number; V: number; east: boolean; level: number; base: number; X0: number; X1: number; Z0: number; out: number; at: (u: number, v: number) => [number, number] }
function frameOf(a: Area, r: Rect, face: Side, base: number): Frame {
  const X0 = r.x * CELL, X1 = (r.x + r.w) * CELL, Z0 = r.y * CELL, east = face === 'E';
  return {a, U: r.h * CELL, V: r.w * CELL, east, level: a.level ?? 0, base, X0, X1, Z0, out: east ? WALL_ROT.W : WALL_ROT.E, at: (u, v) => [east ? X1 - v : X0 + v, Z0 + u]};
}
const areaRect = (a: Area): Rect => ({x: a.x, y: a.y, w: a.w, h: a.h});

/** A storey's frontage: the container fronts along one side's walk (storey 0: the square, the low walk, the weir). Per row (layout
 *  version 7's fronts step from section to section; versions 5 / 6: one column): the walk's first column against the fronts, the wall
 *  plane, the walk's width (cells). */
interface Front {
  L: number; s: 'W' | 'E'; dir: 1 | -1; y0: number; y1: number; band: CrevContainer[];
  colAt: (y: number) => number; wallXAt: (y: number) => number; widthAt: (y: number) => number;
}

/** Furnishes the whole crevice (props, lights, signs); null when a required piece (a stall's counter, the bar) does not fit. */
export function dressCrevice(layout: StationLayout, cc: CreviceCarve, rng: Rng, names: Record<MarketStallId, string>): CreviceAnchors | null {
  const fail = (why: string): null => { CREVICE_DRESS_FAILS[why] = (CREVICE_DRESS_FAILS[why] ?? 0) + 1; return null; };
  const D = CREVICE_DRESS, B = cc.bases;
  const ctxs: PlaceCtx[] = [0, 1, 2, 3].map(L => makePlaceCtx(layout, rng, L));
  const area = (id: number) => layout.areas[id];
  const gridOf = (L: number): Grid => ctxs[L].g;
  const anchors: CreviceAnchors = {stalls: [], uses: [], bar: {area: cc.bar.id, seats: []}, community: {props: [], expected: 0, workshop: 0, store: 0}, counts: {}};
  const count = (k: string, n = 1) => { anchors.counts[k] = (anchors.counts[k] ?? 0) + n; };
  const den = cc.containers[cc.denSlot];
  const faceOfSide = (s: 'W' | 'E'): Side => ((s === 'W') !== cc.f.mirror ? 'E' : 'W');
  // (version 2's: no floor loot anywhere but the workshop — the station's common fuel plan may store its cans there — and the den's own)
  for (const a of layout.areas) if (a.id !== den?.area && a.purpose !== 'workshop') a.noFloorLoot = true;

  // --- primitives ---------------------------------------------------------------------------------------------------------------
  const put = (a: Area, kind: PropKind, x: number, z: number, rot: number, o: PlaceOpts = {}): PropPlacement | null => {
    const p = tryPlaceProp(ctxs[a.level ?? 0], a, kind, r3(x), r3(z), rot, {checkZone: false, ...o});
    if (p && isLootHolderKind(kind)) p.purpose = MARKET_EMPTY_KEY;
    if (p) { p.variant = o.variant ?? rng.int(0, 11); count('props'); } else CREVICE_PUT_FAILS[kind] = (CREVICE_PUT_FAILS[kind] ?? 0) + 1;
    return p;
  };
  /** A loose thing standing on a host's top (host-local lx, lz; it never blocks cells: it moves / is taken off the host). */
  const onHost = (host: PropPlacement, kind: PropKind, lx: number, lz: number, top?: number, turn = 0): PropPlacement | null => {
    const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
    if (Math.abs(lx) + def.w / 2 > hd.w / 2 || Math.abs(lz) + def.d / 2 > hd.d / 2) return null;
    const c = Math.cos(host.rot), s = Math.sin(host.rot), rot = host.rot + turn;
    const {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(host.x + lx * c + lz * s), z: r3(host.z - lx * s + lz * c), y: host.y + (top ?? host.h), rot, area: host.area, hx, hz, h: def.h, blocksSight: false, variant: rng.int(0, 11), host: layout.props.indexOf(host)};
    if (host.level) p.level = host.level;
    (host.cut ??= []).push({y: top ?? host.h, x0: r3(lx - def.w / 2 - 0.02), x1: r3(lx + def.w / 2 + 0.02)});
    layout.props.push(p);
    count('props');
    return p;
  };
  const use = (kind: UseKind, x: number, z: number, a: Area, lx: number, lz: number, home = false) => {
    anchors.uses.push({kind, x: r3(x), z: r3(z), level: a.level ?? 0, yaw: r3(Math.atan2(-(lx - x), -(lz - z))), area: a.id, ...(home ? {home: true} : {})});
  };
  const light = (a: Area, L: number, x: number, z: number, y: number, power: number, o: Partial<LightPlacement> = {}) => {
    // (never over a stair cell: finishTraversal would hang it under the flight's ceiling — the crevice's open top)
    const g = ctxs[L].g, [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy) || g.rampIdx[g.idx(cx, cy)] >= 0) { CREVICE_PUT_FAILS.lampOverStair = (CREVICE_PUT_FAILS.lampOverStair ?? 0) + 1; return; }
    const l: LightPlacement = {x: r3(x), y: r3(y), z: r3(z), rot: 0, area: a.id, broken: false, flicker: false, warm: true, power, dying: false, ...o};
    if (L) l.level = L;
    layout.lights.push(l);
    count('lights');
  };
  const sign = (s: SignPlacement) => { layout.signs.push({...s, x: r3(s.x), y: r3(s.y), z: r3(s.z)}); count('signs'); };
  /** Keep cells (no props) over the cells a world box overlaps, on storey L (only cells of `areaId` when given). */
  const keepBox = (L: number, x0: number, z0: number, x1: number, z1: number, areaId?: number) => {
    const ctx = ctxs[L], g = ctx.g;
    for (let cy = Math.floor(Math.min(z0, z1) / CELL); cy <= Math.floor((Math.max(z0, z1) - 1e-6) / CELL); cy++) for (let cx = Math.floor(Math.min(x0, x1) / CELL); cx <= Math.floor((Math.max(x0, x1) - 1e-6) / CELL); cx++) {
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.cells[i] === FLOOR && (areaId === undefined || g.area[i] === areaId)) markCell(ctx, ctx.keep, i);
    }
  };
  const keepCells = (L: number, x0: number, y0: number, x1: number, y1: number) => keepBox(L, x0 * CELL, y0 * CELL, x1 * CELL, y1 * CELL);

  // --- frame primitives (a container / backroom / nook frame) ---------------------------------------------------------------------
  /**
   * Props against the back wall along u, each at the first place it fits scanning from the row's start (left to right, or right to
   * left) in 0.25 m steps, `gap` m clear of the one before: a back door / a kept cell in the wall's middle splits the row instead of
   * ending it (smaller pieces fill the gap before it).
   */
  const backRow = (F: Frame, kinds: PropKind[], u0: number, u1: number, gap = 0.12, fromRight = false): PropPlacement[] => {
    const out: PropPlacement[] = [];
    const taken: [number, number][] = [];
    for (const kind of kinds) {
      const w = PROP_DEFS[kind].w, d = PROP_DEFS[kind].d;
      for (let t = 0; ; t += 0.25) {
        const a0 = fromRight ? u1 - t - w : u0 + t, a1 = a0 + w;
        if (a0 < u0 - 1e-6 || a1 > u1 + 1e-6) break;
        if (taken.some(([b0, b1]) => a0 < b1 + gap - 1e-6 && a1 > b0 - gap + 1e-6)) continue;
        const p = put(F.a, kind, ...F.at((a0 + a1) / 2, F.V - d / 2 - D.wallGap), F.out);
        if (p) { out.push(p); taken.push([a0, a1]); break; }
      }
    }
    return out;
  };
  /** A fixture backed onto an end wall ('L' = u 0, 'R' = u U), centred at depth v. */
  const sideProp = (F: Frame, kind: PropKind, side: 'L' | 'R', v: number, o: PlaceOpts = {}): PropPlacement | null => {
    const d = PROP_DEFS[kind].d;
    return put(F.a, kind, ...F.at(side === 'L' ? d / 2 + D.wallGap : F.U - d / 2 - D.wallGap, v), side === 'L' ? WALL_ROT.N : WALL_ROT.S, o);
  };
  /** A thing backed onto the opening wall (beside the doorway), facing into the room. */
  const frontProp = (F: Frame, kind: PropKind, u: number, o: PlaceOpts = {}): PropPlacement | null => put(F.a, kind, ...F.at(u, PROP_DEFS[kind].d / 2 + D.wallGap), F.out + Math.PI, o);
  const displaysOf = (p: PropPlacement | null, out: DisplaySource[]) => {
    if (!p) return;
    const idx = layout.props.indexOf(p), sh = SHELF_SURFACES[p.kind];
    if (sh) for (const s of sh) out.push({prop: idx, surface: s});
    else if (SOLID_TOPS.has(p.kind)) out.push({prop: idx, surface: SURF_TOP});
  };
  const roomLamp = (F: Frame, u: number, v: number, power: number) => light(F.a, F.level, ...F.at(u, v), F.base + D.roomLampY, power);
  /** A door's u span in a frame (its rect: world cells in a wall column). */
  const doorSpan = (F: Frame, d: Rect): [number, number] => [d.y * CELL - F.Z0, (d.y + d.h) * CELL - F.Z0];
  /** Keep the cells just inside an opening clear (the door's rows, `depth` m deep). */
  const keepEntry = (F: Frame, d: Rect | null | undefined, depth = 1.0) => {
    if (!d) return;
    const [u0, u1] = doorSpan(F, d);
    const [xa, za] = F.at(u0, 0), [xb, zb] = F.at(u1, depth);
    keepBox(F.level, xa, za, xb, zb, F.a.id);
  };

  // --- 0. Clear lanes and approaches (keep cells first: every later placement respects them) --------------------------------------
  const fronts: Front[] = [];
  const st7 = cc.settle;
  for (const s of ['W', 'E'] as const) for (let L = 0; L < 4; L++) {
    const dir: 1 | -1 = faceOfSide(s) === 'E' ? 1 : -1;
    const band = cc.containers.filter(c => c.level === L && c.side === s).sort((p, q) => p.box.y - q.box.y);
    if (st7) {
      // (layout version 7, task studio-market-irregular-settlement-20261117-003819-01: the walk's columns row by row)
      const colAt = (y: number) => st7.walkCols(s, L, y)[0];
      fronts.push({L, s, dir, y0: cc.rows.z0, y1: cc.rows.z1, band, colAt, wallXAt: y => (dir > 0 ? colAt(y) * CELL : (colAt(y) + 1) * CELL), widthAt: y => { const [a, b] = st7.walkCols(s, L, y); return Math.abs(b - a) + 1; }});
      continue;
    }
    const A = L ? cc.walks[s][L - 1] : cc.low[s];
    const col = dir > 0 ? A.x : A.x + A.w - 1;
    const y0 = L ? A.y : cc.square.y, y1 = L ? A.y + A.h : cc.weir.y + cc.weir.h;
    const wallX = dir > 0 ? col * CELL : (col + 1) * CELL;
    const width = L ? CREVICE.pitch : CREVICE.lowWalk; // (the walk's / low walk's own columns: the square's and the weir's side lanes)
    fronts.push({L, s, dir, y0, y1, band, colAt: () => col, wallXAt: () => wallX, widthAt: () => width});
  }
  const publicIds = new Set<number>([cc.square.id, cc.weir.id, cc.low.W.id, cc.low.E.id, ...cc.walks.W.map(a => a.id), ...cc.walks.E.map(a => a.id)]);
  if (st7) for (const s of ['W', 'E'] as const) for (const list of st7.parts[s]) for (const a of list) publicIds.add(a.id);
  /** (layout version 7) Plaza cells: on a walk section 4.5 m or wider, the cells past the dressed strip short of the outer 2 m lane. */
  const plazaOf = (fr: Front, y: number) => (st7 && fr.L > 0 && fr.widthAt(y) >= D.plaza.min ? fr.widthAt(y) - D.plaza.lane : 0);
  for (const fr of fronts) {
    const g = gridOf(fr.L), allow = fr.L ? D.dressCells.walk : D.dressCells.low;
    for (let y = fr.y0; y < fr.y1; y++) for (let k = Math.max(allow, plazaOf(fr, y)), width = fr.widthAt(y); k < width; k++) {
      const x = fr.colAt(y) + fr.dir * k;
      if (!g.inBounds(x, y)) break;
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || !publicIds.has(g.area[i])) continue;
      markCell(ctxs[fr.L], ctxs[fr.L].keep, i);
    }
  }
  // the chasm's edge (storey 0: every floor cell beside the chasm keeps the railing free)
  {
    const g = gridOf(0), C = cc.chasm;
    for (let y = C.y - 1; y <= C.y + C.h; y++) for (let x = C.x - 1; x <= C.x + C.w; x++) {
      if (!g.inBounds(x, y) || g.cells[g.idx(x, y)] !== FLOOR) continue;
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) { const j = g.idx(x + ox, y + oy); if (g.cells[j] === VOID && g.floor[j] < -2) { near = true; break; } }
      if (near) markCell(ctxs[0], ctxs[0].keep, g.idx(x, y));
    }
  }
  // the bridges' mouths (both walks, the deck's rows +- 1, the whole walk width), the stair feet (whole areas)
  for (const b of cc.bridges) for (const s of ['W', 'E'] as const) {
    if (st7) {
      // (layout version 7: the walk's own columns on each of the mouth's rows)
      for (let y = b.rect.y - 1; y < b.rect.y + b.rect.h + 1; y++) { const [p, q] = st7.walkCols(s, b.level, y); keepCells(b.level, Math.min(p, q), y, Math.max(p, q) + 1, y + 1); }
      continue;
    }
    const A = cc.walks[s][b.level - 1];
    keepCells(b.level, A.x, b.rect.y - 1, A.x + A.w, b.rect.y + b.rect.h + 1);
  }
  for (const st of cc.stairs) { const f = area(st.foot); keepCells(st.from, f.x, f.y, f.x + f.w, f.y + f.h); }
  // (layout version 7: each stair's head too — the walk above, its whole width, from the top landing's rows on past the run)
  if (st7) for (const st of cc.stairs) for (let y = st.rect.y + st.rect.h - D.stairHead[0]; y < st.rect.y + st.rect.h + D.stairHead[1]; y++) {
    const [p, q] = st7.walkCols(st.side, st.from + 1, y);
    keepCells(st.from + 1, Math.min(p, q), y, Math.max(p, q) + 1, y + 1);
  }
  // the square: the gates' apron (its first rows across the floor), the den's approach; the weir: the cross route by the chasm
  const SQ = cc.square, WE = cc.weir;
  keepCells(0, SQ.x, SQ.y, SQ.x + SQ.w, SQ.y + D.apron);
  keepCells(0, WE.x, WE.y, WE.x + WE.w, WE.y + D.cross);
  if (den?.door) {
    const d = den.door, dir = faceOfSide(den.side) === 'E' ? 1 : -1;
    const xa = dir > 0 ? d.x + 1 : d.x - D.denApproach;
    keepCells(0, xa, d.y - 1, xa + D.denApproach, d.y + d.h + 1);
  }
  // the platform's train side and the gates' approaches on it
  {
    const P = cc.platform, edgeZ = P.edge === 'N' ? P.y * CELL : (P.y + P.h) * CELL, sgn = P.edge === 'N' ? 1 : -1;
    keepBox(0, P.x * CELL, edgeZ, (P.x + P.w) * CELL, edgeZ + sgn * D.trainSide, P.id);
    for (const gt of cc.gates) keepCells(0, gt.rect.x - 1, gt.rect.y - 4, gt.rect.x + gt.rect.w + 1, gt.rect.y);
  }

  // --- 1. The six shops ------------------------------------------------------------------------------------------------------------
  let why = '';
  /** Counter run along u at depth v (front toward the opening): the trader's >= 1.5 m way in at one end (version 2's counterRun). */
  function counterRun(F: Frame, v: number, modules: number, gapLeft: boolean, centred = false): {props: PropPlacement[]; u0: number; u1: number} | null {
    const cw = PROP_DEFS.shopCounter.w, runW = modules * cw;
    if (F.U - runW < 1.5 - 1e-6) return null;
    const u0 = centred ? (gapLeft ? 1.5 : F.U - runW - 1.5) : gapLeft ? F.U - runW : 0;
    const props: PropPlacement[] = [];
    for (let k = 0; k < modules; k++) {
      const p = put(F.a, 'shopCounter', ...F.at(u0 + cw / 2 + k * cw, v), F.out, {doorOk: true});
      if (!p) { why = `module ${k}`; return null; }
      props.push(p);
    }
    return {props, u0, u1: u0 + runW};
  }
  function tradeKit(id: MarketShopId): {back: PropKind[]; side: PropKind; extra: PropKind[]} {
    switch (id) {
      case 'gun': return {back: ['gunRack', 'outdoorsPlankShelving', 'outdoorsPlankShelving'], side: 'gunDisplay', extra: ['crate', 'handToolbox']};
      case 'medical': return {back: ['medCabinet', 'shelf', 'medCabinet', 'shelf'], side: 'shelf', extra: ['ivPole', 'oxygenCart']};
      case 'fuel': return {back: ['outdoorsPlankShelving', 'shelf', 'outdoorsPlankShelving'], side: 'outdoorsPlankShelving', extra: ['gasCylinderCart', 'portableGenerator']};
      case 'general': return {back: ['outdoorsPlankShelving', 'outdoorsPlankShelving', 'outdoorsPlankShelving'], side: 'outdoorsPlankShelving', extra: ['basketStack', 'newspaperBundles']};
      case 'gear': return {back: ['outdoorsPlankShelving', 'coatRack', 'outdoorsPlankShelving', 'coatRack'], side: 'outdoorsPlankShelving', extra: ['rollingSuitcase', 'coatRack']};
      case 'scrap': return {back: ['outdoorsPlankShelving', 'shelf', 'outdoorsPlankShelving'], side: 'shelf', extra: ['airCompressor', 'crate']};
    }
  }
  /**
   * A walk-in shop (5.5 m deep; a 3 m shopfront): customers 0-2.5 m between the side shelving, the counter 2.6-3.4 m (along the crevice;
   * the trader's way in at one end), the trader 3.4-5 m, the back wall's fixtures 5-5.5 m, the trade's floor props at the trader zone's
   * far end — every counter top and side board within the 2.6 m reach of the customer's side.
   */
  function walkIn(F: Frame, c: CrevContainer, id: MarketShopId): StallDressed2 | null {
    const kit = tradeKit(id), displays: DisplaySource[] = [];
    const vCounter = Math.min(3.0, F.V - 2.5), vTrader = vCounter + 1.0, vFront = vCounter - 1.0;
    if (vFront < 1.0) { why = `room ${F.V} m deep`; return null; }
    keepEntry(F, c.door, 0.5);
    const gapLeft = rng.chance(0.5);
    const run = counterRun(F, vCounter, F.U >= 6.0 - 1e-6 ? 3 : 2, gapLeft, true);
    if (!run) { why = `counter (${F.U} m) ${why}`; return null; }
    for (const p of run.props) displaysOf(p, displays);
    for (const p of backRow(F, kit.back, 0.05, F.U - 0.05, 0.1, rng.chance(0.5))) displaysOf(p, displays);
    // side shelving in the customer zone (both end walls; the gun shop: its felt bench on one side), plank shelving as the fallback
    const sides = id === 'gun' ? (rng.chance(0.5) ? [kit.side, 'outdoorsPlankShelving'] : ['outdoorsPlankShelving', kit.side]) as PropKind[] : [kit.side, kit.side];
    const vSide = Math.min(1.25, vFront - 0.8);
    (['L', 'R'] as const).forEach((side, k) => displaysOf(sideProp(F, sides[k], side, vSide) ?? (sides[k] !== 'outdoorsPlankShelving' ? sideProp(F, 'outdoorsPlankShelving', side, vSide) : null), displays));
    // the trade's floor props at the trader zone's far end (never in the trader's way in)
    const farSide: 'L' | 'R' = gapLeft ? 'R' : 'L';
    if (id === 'medical') {
      const t = F.at(0, vTrader + 0.2)[0];
      const kitP = mountProp(ctxs[F.level], F.a, gapLeft ? 'S' : 'N', t, 'firstAidWallKit', 1.35, F.base);
      if (kitP) { kitP.purpose = MARKET_EMPTY_KEY; count('props'); }
    }
    for (const k of kit.extra) {
      const dd = PROP_DEFS[k].d;
      const u = farSide === 'L' ? dd / 2 + D.wallGap : F.U - dd / 2 - D.wallGap;
      if (put(F.a, k, ...F.at(u, vTrader + 0.3), farSide === 'L' ? WALL_ROT.N : WALL_ROT.S)) break;
    }
    if (displays.length < 4) { why = `${displays.length} displays (${F.U} m)`; return null; }
    const cd = PROP_DEFS.shopCounter.d, uc = Math.max(run.u0 + 0.45, Math.min(run.u1 - 0.45, F.U / 2));
    const [xa, za] = F.at(run.u0, vCounter - cd / 2), [xb, zb] = F.at(run.u1, vCounter + cd / 2);
    const [tx, tz] = F.at(uc, vTrader), [fx, fz] = F.at(uc, vFront);
    // the trader faces the opening (the customer): forward (-sin yaw, -cos yaw) points out of the room (+x when it faces east)
    return {
      id, area: F.a.id, level: F.level,
      counter: {x0: r3(Math.min(xa, xb)), z0: r3(Math.min(za, zb)), x1: r3(Math.max(xa, xb)), z1: r3(Math.max(za, zb))},
      trader: {x: r3(tx), z: r3(tz), yaw: r3(F.east ? -Math.PI / 2 : Math.PI / 2)}, front: {x: r3(fx), z: r3(fz)}, displays,
    };
  }
  /** The board over an opening (on the walk face of its front wall) at `y` above the storey floor. */
  const boardOver = (c: CrevContainer, text: string, style: SignPlacement['style'] | undefined, y: number, w?: number) => {
    if (!c.door) return;
    const dir = c.face === 'E' ? 1 : -1, d = c.door;
    const x = dir > 0 ? (d.x + 1) * CELL + 0.02 : d.x * CELL - 0.02;
    const onto = layout.doors.find(q => q.b === c.area)?.a ?? c.area;
    sign({kind: 'info', text, area: onto, x, z: (d.y + d.h / 2) * CELL, y: B[c.level] + y, rot: dir > 0 ? Math.PI / 2 : -Math.PI / 2, w: w ?? Math.min(3.4, d.h * CELL + 0.4), ...(style ? {style} : {}), ...(c.level ? {level: c.level} : {})});
  };
  for (const c of cc.containers) {
    if (c.use !== 'shop' || !c.stall || c.area < 0) continue;
    const a = area(c.area), F = frameOf(a, c.rect, c.face, B[c.level]);
    a.label = names[c.stall];
    const st = walkIn(F, c, c.stall);
    if (!st) return fail(`${c.stall} shop ${why}`);
    anchors.stalls.push(st);
    count('shops');
    roomLamp(F, F.U / 2, F.V * 0.62, 0.9);
    roomLamp(F, F.U * 0.5, F.V * 0.22, 0.7);
    const short = names[c.stall].split(' — ')[0];
    boardOver(c, short, STALL_SIGNS[c.stall].style, 2.42);
    // a blade sign standing out from the front beside the opening (two plates back to back), under the deck / the walk above
    if (c.door) {
      const dir = c.face === 'E' ? 1 : -1, d = c.door;
      const zb = rng.chance(0.5) ? d.y * CELL - 0.8 : (d.y + d.h) * CELL + 0.8;
      const xb = (dir > 0 ? (d.x + 1) * CELL : d.x * CELL) + dir * 0.62; // (its 1.2 m plate touching the wall)
      const onto = layout.doors.find(q => q.b === c.area)?.a ?? c.area;
      for (const flip of [0, Math.PI]) sign({kind: 'info', text: short, area: onto, x: xb, z: zb + (flip ? 0.012 : -0.012), y: B[c.level] + 2.22, rot: flip, w: 1.2, style: STALL_SIGNS[c.stall].style, ...(c.level ? {level: c.level} : {})});
    }
  }

  // --- 2. The bar on its deck (storey 1) ---------------------------------------------------------------------------------------------
  if (!dressBar()) return null;
  function dressBar(): boolean {
    const a = cc.bar, R = areaRect(a), g = gridOf(1), L = 1;
    a.label = names[BAR_STALL];
    const U = R.w * CELL, V = R.h * CELL;
    // the deck's north edge is the rock (the hall's south wall over the gates)
    for (let x = R.x; x < R.x + R.w; x++) if (g.cells[g.idx(x, R.y - 1)] !== SOLID) { fail('bar north wall'); return false; }
    const flip = rng.chance(0.5); // (the jukebox's end)
    const X0 = R.x * CELL, Z0 = R.y * CELL;
    const x = (u: number) => (flip ? X0 + U - u : X0 + u), z = (v: number) => Z0 + v;
    const P = (kind: PropKind, u: number, v: number, rot: number, o: PlaceOpts = {}) => put(a, kind, x(u), z(v), rot, {doorOk: true, ...o});
    const keep = (u0: number, v0: number, u1: number, v1: number) => keepBox(L, x(u0), z(v0), x(u1), z(v1), a.id);
    // the plan (cells of 0.5 m): row 0 the backbar, rows 1-2 the bartender's aisle, rows 3-4 the counter, row 5 the stools, rows 6+
    // the cross lane between the two lower terraces (the customer's spot at its north edge); the tables at both ends of the deck
    const cw = PROP_DEFS.shopCounter.w, cd = PROP_DEFS.shopCounter.d, n = 3;
    const uc0 = Math.round((U - n * cw) / 2 / CELL) * CELL, uc1 = uc0 + n * cw, uMid = (uc0 + uc1) / 2;
    const vC = 1.5 + cd / 2, vT = 1.0, vStool = 2.75, vF = 3.5;
    keep(0, 3.0, U, V); // the cross lane (+ the customer's spot)
    keep(uc0 - 0.5, 0.5, uc0, 3.0); keep(uc1, 0.5, uc1 + 0.5, 3.0); // the bartender's ways round the counter's ends
    keep(uc0, 0.5, uc1, 1.5); // the bartender's aisle
    const modules: PropPlacement[] = [];
    for (let k = 0; k < n; k++) { const p = P('shopCounter', uc0 + cw / 2 + k * cw, vC, 0); if (!p) { fail(`bar counter ${k}`); return false; } modules.push(p); }
    // the backbar: shelving units end to end behind the counter (each centred on its own three cells)
    const displays: DisplaySource[] = [];
    let shelves = 0;
    for (let u = uc0; u + 1.5 <= uc1 + 1e-6; u += 1.5) {
      const p = P('shelf', u + 0.75, D.wallGap + PROP_DEFS.shelf.d / 2, 0);
      if (!p) continue;
      shelves++;
      const idx = layout.props.indexOf(p);
      for (const s of BAR_TIERS) displays.push({prop: idx, surface: s});
    }
    if (shelves < 2) { fail(`bar ${shelves} shelves`); return false; }
    onHost(modules[Math.floor(n / 2)], 'cashRegister', -0.42, -0.08, undefined, Math.PI);
    onHost(modules[0], 'campLantern', -0.45, -0.1);
    onHost(modules[n - 1], 'campLantern', 0.45, -0.1);
    // the stools along the counter (one per cell centre, every other cell; the customer's column free)
    const seats: CrevSeat[] = [];
    let stools = 0;
    for (let u = uMid - 0.5; u >= uc0 + 0.2; u -= 1.0) if (stool(u)) stools++;
    for (let u = uMid + 0.5; u <= uc1 - 0.2; u += 1.0) if (stool(u)) stools++;
    function stool(u: number): boolean {
      const p = P('skyMuStool', u, vStool, Math.PI);
      if (p) seats.push({prop: layout.props.indexOf(p), x: p.x, z: p.z, faceX: p.x, faceZ: r3(z(vC))});
      return !!p;
    }
    if (stools < 4) { fail(`bar ${stools} stools`); return false; }
    // the tables (a chair each side along the deck) at both ends; the jukebox against the rock at one end
    let tables = 0, chairs = 0;
    const table = (u: number, v: number) => {
      const t = P('cafeBistroTable', u, v, 0);
      if (!t) return;
      let seated = 0;
      for (const s of [-1, 1] as const) {
        const ch = P('cafeChair', u + s * 0.75, v, s < 0 ? (flip ? -Math.PI / 2 : Math.PI / 2) : (flip ? Math.PI / 2 : -Math.PI / 2));
        if (!ch) continue;
        seated++; chairs++;
        seats.push({prop: layout.props.indexOf(ch), x: ch.x, z: ch.z, faceX: t.x, faceZ: t.z});
      }
      if (seated) tables++;
    };
    const wU = uc0 - 1.5; // (a table on a cell line, its chairs on the cell centres either side: four cells off the way round)
    table(wU, 1.0); table(wU, 2.5);
    const eU = uc1 + 1.5;
    if (wU < 1.0 - 1e-6 || eU > U - 1.0 + 1e-6) { fail(`bar deck ${U} m`); return false; }
    const jk = P('jukebox', eU, D.wallGap + PROP_DEFS.jukebox.d / 2, 0);
    if (jk) count('jukebox');
    table(eU, 2.5);
    if (!jk) table(eU, 1.0);
    if (tables < 3 || chairs < 6) { fail(`bar ${tables} tables ${chairs} chairs`); return false; }
    anchors.bar.seats = seats;
    count('barTables', tables); count('barChairs', chairs); count('barStools', stools);
    // lamps: on the rock over the backbar and over each end's tables (bracket lamps: the deck is open above), one over the stools'
    // aisle from the cellar's roof edge; the board on the rock over the backbar
    const canopy = canopyOf(1);
    for (const u of [uc0 + (uc1 - uc0) * 0.25, uc0 + (uc1 - uc0) * 0.75, wU, eU]) light(canopy ?? a, L, x(u), z(D.wallLampOff), B[1] + D.wallLampY, 0.85);
    sign({kind: 'info', text: names[BAR_STALL].split(' — ')[0], area: a.id, x: x(uMid), z: Z0 + 0.02, y: B[1] + 2.28, rot: 0, w: 2.8, style: STALL_SIGNS[BAR_STALL].style, level: 1});
    const [cxA, cxB] = [x(uc0), x(uc1)];
    anchors.stalls.push({
      id: BAR_STALL, area: a.id, level: 1,
      counter: {x0: r3(Math.min(cxA, cxB)), z0: r3(z(vC - cd / 2)), x1: r3(Math.max(cxA, cxB)), z1: r3(z(vC + cd / 2))},
      trader: {x: r3(x(uMid)), z: r3(z(vT)), yaw: r3(Math.PI)}, front: {x: r3(x(uMid)), z: r3(z(vF))}, displays,
    });
    // a patron or two standing at the rail over the square
    use('idle', x(U * 0.3), z(V - 0.75), a, x(U * 0.3), z(V + 2));
    return true;
  }
  /** An open container of storey L (its roof edge carries a wall lamp's bracket: the lamp's area), the den's entry never. */
  function canopyOf(L: number, near?: {s: 'W' | 'E'; y: number}): Area | null {
    let best: CrevContainer | null = null, bd = Infinity;
    for (const c of cc.containers) {
      if (c.level !== L || c.area < 0 || c.use === 'den') continue;
      const d = near ? (c.side === near.s ? 0 : 1000) + Math.abs(c.box.y + c.box.h / 2 - near.y) : c.id;
      if (d < bd) { bd = d; best = c; }
    }
    return best ? area(best.area) : null;
  }

  // --- 3. The other containers --------------------------------------------------------------------------------------------------
  let storeRoom = false;
  for (const c of cc.containers) {
    if (c.area < 0 || c.use === 'shop' || c.use === 'den') continue;
    const a = area(c.area), F = frameOf(a, c.rect, c.face, B[c.level]);
    if (c.use !== 'tea') keepEntry(F, c.door, 1.0);
    if (c.backDoor) keepBackDoor(F, c.backDoor);
    const back = c.back !== undefined ? area(c.back) : null;
    const BF = back ? frameOf(back, areaRect(back), c.face, B[c.level]) : null;
    if (BF && c.backDoor) keepEntry(BF, c.backDoor, 1.0);
    switch (c.use) {
      case 'kitchen': dressKitchen(F, BF); break;
      case 'workshop': dressWorkshop(F, BF); break;
      case 'bunks': dressBunks(F, BF); break;
      case 'home': dressHome(F, c, BF); break;
      case 'water': {
        a.label = 'Water point';
        backRow(F, ['waterPumpSkid', 'waterHeaterTank', 'waterCooler', 'waterHeaterTank'], 0.1, F.U - 0.1, 0.15, rng.chance(0.5));
        const m = frontProp(F, 'mopBucketWringer', rng.chance(0.5) ? 0.4 : F.U - 0.4);
        if (m) use('work', m.x, m.z, a, ...F.at(F.U / 2, F.V));
        break;
      }
      case 'latrine': a.label = 'Latrine'; backRow(F, ['toiletStall', 'toiletStall', 'mopSink', 'toiletStall'], 0.1, F.U - 0.1, 0.05, rng.chance(0.5)); break;
      case 'generator': {
        a.label = 'Generator shed';
        backRow(F, ['portableGenerator', 'gasCylinderCart', 'portableGenerator'], 0.15, F.U - 0.15, 0.3, rng.chance(0.5));
        frontProp(F, 'drumFan', rng.chance(0.5) ? 0.6 : F.U - 0.6);
        break;
      }
      case 'storage': {
        a.label = 'Storage';
        // (version 2's recipe: four of the six against the back wall, a crate by a side wall)
        const kinds: PropKind[] = rng.shuffle(['crate', 'cartonStack', 'crate', 'shelf', 'footlocker', 'crate']);
        const stores = backRow(F, kinds.slice(0, 4), 0.05, F.U - 0.05, 0.1, rng.chance(0.5));
        const side = sideProp(F, 'crate', rng.chance(0.5) ? 'L' : 'R', F.V * 0.35);
        if (!storeRoom) {
          storeRoom = true; a.label = 'Store room';
          const keyed = communityStores([...stores, side]);
          anchors.community.store += keyed;
          anchors.community.expected += kinds.slice(0, 4).filter(k => isLootHolderKind(k)).length + 1;
        }
        break;
      }
      case 'tea': dressTea(F, c); break;
      case 'repair': {
        a.label = 'Repair counter';
        const bench = backRow(F, ['repairBench'], F.U * 0.5 - 0.8, F.U * 0.5 + 0.8)[0];
        if (bench) { use('work', ...F.at(bench.z - F.Z0, F.V - 1.15), a, bench.x, bench.z); onHost(bench, 'solderingStation', -0.4, 0.05, 0.9); }
        const ch = put(a, 'plasticStackChair', ...F.at(F.U * 0.5 + 1.1, F.V - 1.0), F.out + Math.PI);
        if (ch) count('chairs');
        backRow(F, ['crate', 'partsBinRack'], 0.1, F.U * 0.5 - 1.0, 0.1);
        break;
      }
      case 'laundry': {
        a.label = 'Laundry';
        const row = backRow(F, ['mopSink', 'coatRack', 'coatRack', 'basketStack', 'coatRack', 'basketStack'], 0.1, F.U - 0.1, 0.12, rng.chance(0.5));
        const sink = row.find(p => p.kind === 'mopSink');
        if (sink) use('work', ...F.at(sink.z - F.Z0, F.V - 1.2), a, sink.x, sink.z);
        frontProp(F, 'basketStack', rng.chance(0.5) ? 0.4 : F.U - 0.4);
        break;
      }
      case 'clinic-store': {
        a.label = 'Sick bay';
        backRow(F, ['palletBed', 'medCabinet', 'ivPole'], 0.1, F.U - 0.1, 0.2, rng.chance(0.5));
        break;
      }
      case 'bar-store': {
        a.label = c.side === cc.f.denSide ? 'Bar cellar' : 'Bar store';
        backRow(F, rng.shuffle(['shelf', 'crate', 'crate', 'cartonStack', 'crate'] as PropKind[]), 0.05, F.U - 0.05, 0.08, rng.chance(0.5));
        sideProp(F, 'crate', rng.chance(0.5) ? 'L' : 'R', F.V * 0.4);
        break;
      }
      default: break;
    }
    if (c.use !== 'kitchen' && c.use !== 'workshop') {
      const n = F.U > 7.5 ? 2 : 1;
      for (let k = 0; k < n; k++) roomLamp(F, F.U * (k + 0.5) / n, F.V * 0.5, c.use === 'home' ? 0.55 : 0.7);
      if (BF && c.use !== 'bunks' && c.use !== 'home') roomLamp(BF, BF.U / 2, BF.V / 2, 0.5);
    }
    // a painted notice over a service's opening
    const notice = noticeOf(c);
    if (notice) boardOver(c, notice, undefined, 2.38, Math.min(2.4, (c.door?.h ?? 2) * CELL + 0.6));
  }
  if (!storeRoom) CREVICE_DRESS_FAILS['no store room'] = (CREVICE_DRESS_FAILS['no store room'] ?? 0) + 1;

  function keepBackDoor(F: Frame, d: Rect): void {
    // the back door's cells on the container's side: its rows, the last 1 m of the depth
    const [u0, u1] = doorSpan(F, d);
    const [xa, za] = F.at(u0, F.V - 1.0), [xb, zb] = F.at(u1, F.V);
    keepBox(F.level, xa, za, xb, zb, F.a.id);
  }
  /** Version 2's community stores: holders among `props` carry the market workshop key (the shared base salvage). */
  function communityStores(props: readonly (PropPlacement | null | undefined)[]): number {
    let n = 0;
    for (const p of props) if (p && isLootHolderKind(p.kind)) { p.purpose = MARKET_WORKSHOP_KEY; anchors.community.props.push(layout.props.indexOf(p)); n++; }
    return n;
  }
  function dressKitchen(F: Frame, BF: Frame | null): void {
    F.a.label = 'Communal kitchen';
    // the grill on one end wall and a prep / serving counter on the other (clear of the opening's door cells), the cooking line along
    // the back wall between them (the pantry's door splits it: first fit)
    const end: 'L' | 'R' = rng.chance(0.5) ? 'L' : 'R', other: 'L' | 'R' = end === 'L' ? 'R' : 'L';
    const gr = sideProp(F, 'grillLine', other, F.V - PROP_DEFS.grillLine.w / 2 - 0.18);
    if (gr) use('cook', ...F.at(other === 'L' ? 1.4 : F.U - 1.4, F.V - PROP_DEFS.grillLine.w / 2 - 0.18), F.a, gr.x, gr.z);
    const ctr = sideProp(F, 'shopCounter', end, F.V - PROP_DEFS.shopCounter.w / 2 - 0.25);
    const line = backRow(F, ['wokLine', 'shopBackbar', 'ingredientBin', 'ingredientBin', 'waterCooler', ...(gr ? [] : ['grillLine' as PropKind])], 1.05, F.U - 1.05, 0.1, rng.chance(0.5));
    let cooker = false;
    for (const p of line) {
      if (p.kind === 'wokLine' || p.kind === 'grillLine') use('cook', ...F.at(p.z - F.Z0, F.V - 1.25), F.a, p.x, p.z);
      if (p.kind === 'shopBackbar') { onHost(p, 'riceCooker', -0.55, 0.05, 0.914); onHost(p, 'deepFryer', 0.45, 0.05, 0.914); cooker = true; }
    }
    if (ctr) {
      onHost(ctr, 'campLantern', 0.45, -0.1);
      if (!cooker) { onHost(ctr, 'riceCooker', -0.4, 0.02); onHost(ctr, 'deepFryer', 0.1, 0.02); }
    }
    for (const t of [0.22, 0.5, 0.78]) roomLamp(F, F.U * t, F.V * 0.55, 0.95);
    if (BF) {
      BF.a.label = 'Pantry';
      // (the back kitchen: the stainless backbar when the kitchen's own back wall had no room for it)
      const pk = backRow(BF, [...(cooker ? [] : ['shopBackbar' as PropKind]), 'shelf', 'ingredientBin', 'ingredientBin', 'shelf', 'cartonStack', 'ingredientBin'], 0.1, BF.U - 0.1, 0.12, rng.chance(0.5));
      for (const p of pk) if (p.kind === 'shopBackbar') { onHost(p, 'riceCooker', -0.55, 0.05, 0.914); use('cook', ...BF.at(p.z - BF.Z0, BF.V - 1.25), BF.a, p.x, p.z); }
      sideProp(BF, 'crate', rng.chance(0.5) ? 'L' : 'R', BF.V * 0.45);
      roomLamp(BF, BF.U / 2, BF.V / 2, 0.55);
    }
  }
  function dressWorkshop(F: Frame, BF: Frame | null): void {
    F.a.label = 'Workshop';
    // (version 2's bench row; its tool chest first: the store back door splits the wall, the chest is the row's community store)
    const row = backRow(F, ['rollingToolChest', 'repairBench', 'benchGrinderStand', 'repairBench'], 0.1, F.U - 0.1, 0.2, rng.chance(0.5));
    for (const p of row) if (p.kind === 'repairBench') use('work', ...F.at(p.z - F.Z0, F.V - 1.2), F.a, p.x, p.z);
    // (version 2's: the bench row's holders — its tool chest — are a community store)
    const keyed = communityStores(row);
    anchors.community.workshop += keyed;
    anchors.community.expected += 1;
    const mounts = [mountProp(ctxs[F.level], F.a, 'N', F.at(0, F.V * 0.5)[0], 'toolPegboard', 1.05, F.base), mountProp(ctxs[F.level], F.a, 'S', F.at(0, F.V * 0.5)[0], 'partsBinRack', 1.15, F.base)];
    for (const m of mounts) if (m) count('props');
    frontProp(F, 'airCompressor', 0.5);
    frontProp(F, 'portableGenerator', F.U - 0.45);
    for (const t of [0.3, 0.72]) roomLamp(F, F.U * t, F.V * 0.55, 0.9);
    if (BF) {
      BF.a.label = 'Workshop store';
      backRow(BF, ['shelf', 'gasCylinderCart', 'shelf', 'crate', 'cartonStack'], 0.1, BF.U - 0.1, 0.12, rng.chance(0.5));
      sideProp(BF, 'stepLadder', rng.chance(0.5) ? 'L' : 'R', BF.V * 0.45);
      roomLamp(BF, BF.U / 2, BF.V / 2, 0.55);
    }
  }
  function dressBunks(F: Frame, BF: Frame | null): void {
    F.a.label = 'Bunk room';
    const beds = backRow(F, ['palletBed', 'palletBed', 'palletBed', 'palletBed'], 0.1, F.U - 0.1, 0.35, rng.chance(0.5));
    beds.slice(0, 2).forEach(b => use('sleep', ...F.at(b.z - F.Z0, F.V - 1.25), F.a, b.x, b.z));
    frontProp(F, 'coatRack', 0.35);
    frontProp(F, 'footlocker', F.U - 0.5);
    if (BF) {
      BF.a.label = 'Bunk room';
      const more = backRow(BF, ['palletBed', 'bedroll', 'palletBed', 'bedroll'], 0.1, BF.U - 0.1, 0.35, rng.chance(0.5));
      if (more[0]) use('sleep', ...BF.at(more[0].z - BF.Z0, BF.V - 1.2), BF.a, more[0].x, more[0].z);
      sideProp(BF, 'footlocker', rng.chance(0.5) ? 'L' : 'R', 1.0);
      roomLamp(BF, BF.U / 2, BF.V / 2, 0.45);
    }
  }
  function dressHome(F: Frame, c: CrevContainer, BF: Frame | null): void {
    F.a.label = 'Home';
    const fromRight = rng.chance(0.5);
    const bedKind: PropKind = rng.chance(0.65) ? 'palletBed' : 'bedroll';
    const bed = backRow(F, [bedKind], 0.1, F.U - 0.1, 0, fromRight)[0];
    if (bed) use('sleep', ...F.at(bed.z - F.Z0, F.V - 1.2), F.a, bed.x, bed.z, true);
    // the table and a chair at the other end (by its end wall), the lantern on it
    const side: 'L' | 'R' = fromRight ? 'L' : 'R';
    const t = sideProp(F, 'campTable', side, F.V * 0.55);
    if (t) {
      onHost(t, 'campLantern', 0.3, 0);
      const u = side === 'L' ? 1.25 : F.U - 1.25; // (its own cell row, clear of the table's two)
      const ch = put(F.a, rng.chance(0.5) ? 'plasticStackChair' : 'foldingChair', ...F.at(u, F.V * 0.55), side === 'L' ? WALL_ROT.S : WALL_ROT.N);
      if (ch) { use('sit', ch.x, ch.z, F.a, t.x, t.z, true); count('chairs'); }
    }
    // a few belongings: against the opening wall beside the door, or in the back wall's middle
    const things: PropKind[] = rng.shuffle(['coatRack', 'footlocker', 'crtTvCart', 'crate', 'bicycle', 'drumFan', 'pottedPlantSmall', 'rollingSuitcase', 'pedestalFan', 'basketStack']);
    const [d0, d1] = c.door ? doorSpan(F, c.door) : [F.U / 2, F.U / 2];
    let placed = 0;
    for (const k of things) {
      if (placed >= (F.U > 6 ? 3 : 2)) break;
      const w = PROP_DEFS[k].w;
      const slots = [d0 - 0.55 - w / 2, d1 + 0.55 + w / 2].filter(u => u - w / 2 > 0.05 && u + w / 2 < F.U - 0.05);
      let ok = false;
      for (const u of rng.shuffle(slots)) if (k === 'bicycle' ? put(F.a, k, ...F.at(u, 0.95), 0) : frontProp(F, k, u)) { ok = true; break; }
      if (!ok && k !== 'bicycle') ok = !!backRow(F, [k], F.U * 0.3, F.U * 0.7, 0.1, rng.chance(0.5))[0];
      if (ok) placed++;
    }
    if (BF) {
      // the back room: a second bed (a family's) or the household's storage
      if (rng.chance(0.55)) {
        BF.a.label = 'Back room';
        const b2 = backRow(BF, [rng.chance(0.5) ? 'bedroll' : 'palletBed'], 0.1, BF.U - 0.1, 0, rng.chance(0.5))[0];
        if (b2) use('sleep', ...BF.at(b2.z - BF.Z0, BF.V - 1.2), BF.a, b2.x, b2.z, true);
        sideProp(BF, rng.chance(0.5) ? 'footlocker' : 'crate', rng.chance(0.5) ? 'L' : 'R', 1.0);
      } else {
        BF.a.label = 'Store';
        backRow(BF, rng.shuffle(['shelf', 'crate', 'footlocker', 'cartonStack', 'crate'] as PropKind[]).slice(0, 4), 0.1, BF.U - 0.1, 0.12, rng.chance(0.5));
      }
      roomLamp(BF, BF.U / 2, BF.V / 2, 0.45);
    }
  }
  function dressTea(F: Frame, c: CrevContainer): void {
    F.a.label = 'Tea counter';
    // the counter just inside the wide opening, past its approach strip (gen/doorways.ts DOOR_CLEAR: nothing in a doorway), the brewer's
    // way in at one end; the camp stove's table on the far end wall
    const gapLeft = rng.chance(0.5);
    const run = counterRun(F, DOOR_CLEAR.approach + 0.02 + PROP_DEFS.shopCounter.d / 2, F.U >= 4.6 ? 2 : 1, gapLeft);
    const t = sideProp(F, 'campTable', gapLeft ? 'R' : 'L', 1.6);
    if (t) { onHost(t, 'campStove', -0.3, 0); onHost(t, 'riceCooker', 0.32, 0); }
    if (run) {
      const um = (run.u0 + run.u1) / 2;
      use('work', ...F.at(um, 1.6), F.a, ...F.at(um, 0));
      onHost(run.props[0], 'campLantern', 0.4, -0.1);
    }
    // two chairs out on the walk, either side of the opening (outside its door zone), facing the counter
    if (!c.door) return;
    const fr = fronts.find(q => q.L === c.level && q.s === c.side)!;
    for (const yy of [c.door.y - 3, c.door.y + c.door.h + 2]) frontThing(fr, yy, 'plasticStackChair', 'sit-door');
  }
  function noticeOf(c: CrevContainer): string | null {
    switch (c.use) {
      case 'water': return 'WATER';
      case 'latrine': return 'LATRINE';
      case 'generator': return 'POWER';
      case 'tea': return 'TEA';
      case 'repair': return 'REPAIRS';
      case 'laundry': return 'LAUNDRY';
      case 'kitchen': return 'COMMUNAL KITCHEN';
      case 'workshop': return 'WORKSHOP';
      case 'bunks': return 'BUNKS';
      case 'storage': return c.area >= 0 && area(c.area).label === 'Store room' ? 'STORES' : null;
      default: return null;
    }
  }

  // --- 4. The frontages: lived-in dressing along every container front, wall lamps -----------------------------------------------
  /** What may stand outside a container (by its use / storey), and what clutters a closed box's front. */
  function kindsFor(c: CrevContainer | undefined, L: number): PropKind[] {
    const low = L === 0;
    if (!c || c.area < 0) return low ? ['crate', 'crate', 'pottedPlantSmall', 'bench', 'basketStack', 'footlocker', 'coatRack', 'handTruck']
      : L === 3 ? ['waterHeaterTank', 'waterHeaterTank', 'crate', 'deadPlant', 'trashBagPile', 'gasCylinderCart', 'stepLadder', 'pottedPlantSmall']
        : ['crate', 'deadPlant', 'trashBagPile', 'wheelieBin', 'handTruck', 'stepLadder', 'pottedPlantSmall', 'bicycle', 'waterHeaterTank'];
    switch (c.use) {
      case 'home': return low ? ['pottedPlantSmall', 'bench', 'coatRack', 'crate', 'basketStack']
        : ['plasticStackChair', 'pottedPlantSmall', 'coatRack', 'bicycle', 'foldingChair', 'pottedPlantSmall', 'crate', 'basketStack', ...(L === 3 ? ['waterHeaterTank' as PropKind] : [])];
      case 'water': return ['waterHeaterTank', 'crate', 'pottedPlantSmall'];
      case 'storage': case 'bar-store': return ['crate', 'handTruck', 'crate', 'cartonStack'];
      case 'laundry': return ['coatRack', 'basketStack', 'coatRack'];
      case 'generator': return ['gasCylinderCart', 'crate'];
      case 'bunks': return ['bicycle', 'coatRack', 'crate', 'plasticStackChair'];
      case 'latrine': return ['mopBucketWringer', 'basketStack'];
      case 'repair': return ['crate', 'handTruck', 'bicycle'];
      case 'kitchen': return ['crate', 'ingredientBin', 'wheelieBin'];
      case 'workshop': return ['crate', 'handTruck', 'gasCylinderCart'];
      case 'tea': case 'shop': return ['pottedPlantSmall', 'crate'];
      default: return [];
    }
  }
  /** One thing against the frontage at row y (backed onto the wall cell, inside the dressable strip); 'sit' marks a seat's post. */
  function frontThing(fr: Front, y: number, kind: PropKind, tag?: string): PropPlacement | null {
    const g = gridOf(fr.L), col = fr.colAt(y), wallC = col - fr.dir;
    if (!g.inBounds(col, y)) return null;
    const i = g.idx(col, y);
    if (g.cells[i] !== FLOOR || !publicIds.has(g.area[i])) return null;
    const a = area(g.area[i]);
    // bicycles lie along the wall, everything else faces the walk
    const along = kind === 'bicycle';
    const rot = along ? (rng.chance(0.5) ? 0 : Math.PI) : fr.dir > 0 ? WALL_ROT.W : WALL_ROT.E;
    const {hx, hz} = footprint(kind, rot);
    const x = fr.wallXAt(y) + fr.dir * (D.wallGap + hx), z = (y + 0.5) * CELL + (hz > 0.25 ? hz - 0.25 : 0);
    // wall-backed over its whole length (never against an opening / a nook / a stair foot; version 7: nor across a step in the fronts,
    // nor in the row beside one — a jog's corner stays clear: routes round it)
    const r0 = Math.floor((z - hz + 0.04) / CELL), r1 = Math.floor((z + hz - 0.04) / CELL);
    for (let cy = r0; cy <= r1; cy++) if (!g.inBounds(wallC, cy) || g.cells[g.idx(wallC, cy)] !== SOLID) return null;
    for (let cy = r0 - 1; cy <= r1 + 1; cy++) if (fr.colAt(cy) !== col) return null;
    const p = put(a, kind, x, z, rot, {checkZone: true});
    if (!p) return null;
    count('frontage');
    if (kind === 'plasticStackChair' || kind === 'foldingChair' || kind === 'bench') {
      use('sit', p.x, p.z, a, p.x + fr.dir * 2, p.z);
      if (kind !== 'bench') count('chairs');
    }
    if (tag === 'sit-door') count('teaChairs');
    return p;
  }
  /** (layout version 7) A walk's residents: one by the railing, a pair chatting (two storeys up: another by the railing), on rows down
   *  its length — each post on the walk's own floor there (the walk's areas step with it), never on a stair or a bridge. */
  function frontPosts(fr: Front): void {
    const g = gridOf(fr.L), y0 = fr.L ? fr.y0 : cc.rows.chasm0, y1 = fr.L ? fr.y1 : cc.rows.chasm1;
    const ys = [0.28, 0.62, 0.85].map(t => Math.round(y0 + (y1 - y0) * t + rng.range(-3, 3)));
    const on = (x: number, z: number): Area | null => {
      const [cx, cy] = g.cellOf(x, z);
      if (!g.inBounds(cx, cy)) return null;
      const i = g.idx(cx, cy);
      return g.cells[i] === FLOOR && g.rampIdx[i] < 0 && publicIds.has(g.area[i]) ? area(g.area[i]) : null;
    };
    const xAt = (y: number, k: number) => (fr.colAt(y) + fr.dir * k + 0.5) * CELL;
    const idle = (y: number) => { const x = xAt(y, fr.widthAt(y) - 2), z = (y + 0.5) * CELL, A = on(x, z); if (A) use('idle', x, z, A, x + fr.dir * 3, z); };
    idle(ys[0]);
    const xc = xAt(ys[1], fr.widthAt(ys[1]) - 3), za = (ys[1] + 0.5) * CELL - 0.55, zb = (ys[1] + 0.5) * CELL + 0.55, A = on(xc, za), Bq = on(xc, zb);
    if (A && Bq) { use('chat', xc, za, A, xc, zb); use('chat', xc, zb, Bq, xc, za); }
    if (fr.L >= 2) idle(ys[2]);
  }
  for (const fr of fronts) {
    const band = fr.band;
    const at = (y: number) => band.find(c => y >= c.box.y && y < c.box.y + c.box.h);
    let y = fr.y0 + 1 + rng.int(0, 3);
    while (y < fr.y1 - 1) {
      const c = at(y);
      if (c && c.use === 'den') { y = c.box.y + c.box.h + 1; continue; }
      const kinds = kindsFor(c, fr.L);
      if (!kinds.length) { y += 4; continue; }
      const kind = kinds[rng.int(0, kinds.length - 1)];
      const p = frontThing(fr, y, kind);
      if (p) {
        // a pair now and then (a chair and a plant, two crates)
        if (rng.chance(0.45)) {
          const k2 = kinds[rng.int(0, kinds.length - 1)];
          const {hz} = footprint(kind, p.rot);
          frontThing(fr, Math.floor((p.z + hz) / CELL) + 1, k2);
        }
        y += rng.int(4, 7);
      } else y += 1;
    }
    // wall lamps: about every 6 m on the container fronts (never the den's entry; a shop's board keeps its own lamp-free stretch)
    const g = gridOf(fr.L);
    let ly = fr.y0 + 2 + rng.int(0, 4);
    while (ly < fr.y1 - 1) {
      const c = at(ly);
      const lc = fr.colAt(ly);
      const okWall = g.inBounds(lc - fr.dir, ly) && g.cells[g.idx(lc - fr.dir, ly)] === SOLID && g.cells[g.idx(lc, ly)] === FLOOR;
      const nearDen = den && den.level === fr.L && den.side === fr.s && ly >= den.box.y - 1 && ly < den.box.y + den.box.h + 1;
      const onBoard = band.some(q => q.door && (q.use === 'shop' || noticeOf(q)) && ly >= q.door.y - 1 && ly < q.door.y + q.door.h + 1);
      if (!okWall || nearDen || onBoard) { ly++; continue; }
      const canopy = c && c.area >= 0 && c.use !== 'den' ? area(c.area) : canopyOf(fr.L, {s: fr.s, y: ly});
      if (canopy) light(canopy, fr.L, fr.wallXAt(ly) + fr.dir * D.wallLampOff, (ly + 0.5) * CELL, B[fr.L] + D.wallLampY, fr.L === 0 ? 0.8 : 0.7);
      ly += Math.round((D.lampEvery + rng.range(-1, 1)) / CELL);
    }
    // a resident or two at the railing / chatting on every terrace and low walk (the lane's middle: posts, never props)
    if (st7) { frontPosts(fr); continue; }
    const A = fr.L ? cc.walks[fr.s][fr.L - 1] : cc.low[fr.s];
    const kRail = fr.L ? 4 : 3, xr = (fr.colAt(0) + fr.dir * kRail + 0.5) * CELL;
    const ys = [0.28, 0.62, 0.85].map(t => Math.round(A.y + A.h * t + rng.range(-3, 3)));
    use('idle', xr, (ys[0] + 0.5) * CELL, A, xr + fr.dir * 3, (ys[0] + 0.5) * CELL);
    const xc = (fr.colAt(0) + fr.dir * (kRail - 1) + 0.5) * CELL;
    use('chat', xc, (ys[1] + 0.5) * CELL - 0.55, A, xc, (ys[1] + 0.5) * CELL + 0.55);
    use('chat', xc, (ys[1] + 0.5) * CELL + 0.55, A, xc, (ys[1] + 0.5) * CELL - 0.55);
    if (fr.L >= 2) use('idle', xr, (ys[2] + 0.5) * CELL, A, xr + fr.dir * 3, (ys[2] + 0.5) * CELL);
  }

  // --- 5. The terrace nooks (themed), the stair feet, the bridges' undersides ----------------------------------------------------
  const themes = ['terrace', 'garden', 'lookout', 'drying', 'stores'] as const;
  let themeAt = rng.int(0, themes.length - 1);
  for (const pk of cc.pockets) {
    const a = area(pk.area), fr = fronts.find(q => q.L === pk.level && q.s === pk.side)!;
    const F = frameOf(a, pk.rect, fr.dir > 0 ? 'E' : 'W', B[pk.level]);
    a.label = 'Terrace nook';
    const theme = F.U < 2.5 ? 'garden' : themes[themeAt++ % themes.length];
    dressNook(F, theme);
    light(a, pk.level, ...F.at(F.U / 2, F.V * 0.55), B[pk.level] + Math.min(D.wallLampY + 0.05, a.ceil - B[pk.level] - 0.15), 0.6);
    count(`nook-${theme}`);
  }
  function dressNook(F: Frame, theme: typeof themes[number] | 'garden'): void {
    const a = F.a;
    // (the nook's front cells by the walk stay open: things stand against its back (the rock) and its end walls)
    keepBox(F.level, ...F.at(0, 0), ...F.at(F.U, 0.5), a.id);
    switch (theme) {
      case 'terrace': {
        const t = backRow(F, ['campTable'], F.U / 2 - 0.7, F.U / 2 + 0.7)[0];
        if (t) {
          onHost(t, 'campLantern', 0.35, 0);
          for (const du of [-0.55, 0.55]) {
            const ch = put(a, rng.chance(0.5) ? 'foldingChair' : 'plasticStackChair', ...F.at(t.z - F.Z0 + du, F.V - 1.25), F.out + Math.PI);
            if (ch) { use('sit', ch.x, ch.z, a, t.x, t.z); count('chairs'); }
          }
        }
        sideProp(F, 'pottedPlantSmall', 'L', F.V - 0.4);
        sideProp(F, 'pottedPlantSmall', 'R', F.V - 0.4);
        break;
      }
      case 'garden': {
        backRow(F, ['pottedPlantSmall', 'pottedPlantSmall', 'deadPlant', 'pottedPlantSmall', 'pottedPlantSmall'], 0.1, F.U - 0.1, 0.12, rng.chance(0.5));
        const can = sideProp(F, rng.chance(0.5) ? 'waterCooler' : 'mopBucketWringer', rng.chance(0.5) ? 'L' : 'R', 1.2);
        if (F.U >= 2.5) use('work', ...F.at(F.U / 2, F.V - 1.2), a, ...F.at(F.U / 2, F.V));
        void can;
        break;
      }
      case 'lookout': {
        const ch = put(a, 'foldingChair', ...F.at(F.U * 0.5, 1.0), F.out + Math.PI);
        if (ch) { use('sit', ch.x, ch.z, a, ...F.at(F.U * 0.5, -3)); count('chairs'); }
        backRow(F, ['crate', 'pottedPlantSmall', 'crate'], 0.1, F.U - 0.1, 0.2, rng.chance(0.5));
        use('idle', ...F.at(F.U * 0.25, 0.75), a, ...F.at(F.U * 0.25, -3));
        break;
      }
      case 'drying': {
        backRow(F, ['coatRack', 'coatRack', 'basketStack', 'coatRack'], 0.1, F.U - 0.1, 0.25, rng.chance(0.5));
        const ch = sideProp(F, 'plasticStackChair', rng.chance(0.5) ? 'L' : 'R', 1.2);
        if (ch) { use('work', ...F.at(F.U / 2, F.V - 1.3), a, ...F.at(F.U / 2, F.V)); count('chairs'); }
        break;
      }
      case 'stores': {
        backRow(F, rng.shuffle(['crate', 'cartonStack', 'crate', 'footlocker', 'crate'] as PropKind[]), 0.1, F.U - 0.1, 0.1, rng.chance(0.5));
        sideProp(F, 'handTruck', rng.chance(0.5) ? 'L' : 'R', 1.3);
        break;
      }
    }
  }
  for (const st of cc.stairs) {
    const f = area(st.foot);
    light(f, st.from, (f.x + f.w / 2) * CELL, (f.y + 1.5) * CELL, B[st.from] + D.wallLampY + 0.05, 0.65);
    // and over its head (the storey above, just past the run's top: the walk there, its rod a canopy bracket)
    // (on the wall beside the run's head: the first clear row past its top whose outer column (either side) is solid)
    const up = st.from + 1, gu = gridOf(up), canopy = canopyOf(up, {s: st.side, y: st.rect.y + st.rect.h});
    for (let k = 0; k < 8 && canopy; k++) {
      const y = st.rect.y + st.rect.h + k;
      const xs: [number, number, number][] = [[st.rect.x, st.rect.x - 1, st.rect.x * CELL + D.wallLampOff], [st.rect.x + st.rect.w - 1, st.rect.x + st.rect.w, (st.rect.x + st.rect.w) * CELL - D.wallLampOff]];
      const hit = xs.find(([fx, wx]) => gu.inBounds(wx, y) && gu.cells[gu.idx(fx, y)] === FLOOR && gu.rampIdx[gu.idx(fx, y)] < 0 && gu.cells[gu.idx(wx, y)] === SOLID);
      if (hit) { light(canopy, up, hit[2], (y + 0.5) * CELL, B[up] + D.wallLampY, 0.6); break; }
    }
  }
  for (const b of cc.bridges) {
    // under the deck: over the walk / low walk below its two ends (the deck lowers their ceiling)
    const zc = (b.rect.y + b.rect.h / 2) * CELL;
    for (const s of ['W', 'E'] as const) {
      if (st7) {
        // (layout version 7: the middle of the walk under the deck's middle row, that row's own walk area)
        const row = Math.floor(zc / CELL), [p, q] = st7.walkCols(s, b.level - 1, row), xm = (Math.min(p, q) + Math.max(p, q) + 1) / 2 * CELL;
        const g = gridOf(b.level - 1), [cx, cy] = g.cellOf(xm, zc), id = g.inBounds(cx, cy) ? g.area[g.idx(cx, cy)] : -1;
        if (id >= 0 && publicIds.has(id)) light(area(id), b.level - 1, xm, zc, B[b.level] - 0.35 - 0.05, 0.6);
        continue;
      }
      const A = b.level === 1 ? cc.low[s] : cc.walks[s][b.level - 2];
      light(A, b.level - 1, (A.x + A.w / 2) * CELL, zc, B[b.level] - 0.35 - 0.05, 0.6);
    }
  }

  // --- 5b. (layout version 7) The plazas: a walk section 4.5 m or wider gets a seating group past its dressed strip (a camp table and
  // two chairs along the walk, its lantern; a bench where they do not fit), the outer 2 m lane kept clear --------------------------
  if (st7) for (const fr of fronts) {
    if (!fr.L) continue;
    const g = gridOf(fr.L);
    for (let y = fr.y0; y < fr.y1;) {
      const w = fr.widthAt(y), col = fr.colAt(y);
      let y2 = y;
      while (y2 < fr.y1 && fr.widthAt(y2) === w && fr.colAt(y2) === col) y2++;
      if (w >= D.plaza.min && y2 - y >= D.plaza.rows + 2) {
        // (the group's band: from the dressed strip to the clear lane, its middle row)
        const k0 = D.dressCells.walk, k1 = w - D.plaza.lane, xm = (col + fr.dir * ((k0 + k1 - 1) / 2) + 0.5) * CELL;
        const zm = ((y + y2) / 2) * CELL, [cx, cy] = g.cellOf(xm, zm), id = g.inBounds(cx, cy) ? g.area[g.idx(cx, cy)] : -1;
        const a = id >= 0 && publicIds.has(id) ? area(id) : null;
        if (a) {
          const t = put(a, 'campTable', xm, zm, Math.PI / 2, {checkZone: true});
          if (t) {
            onHost(t, 'campLantern', 0, 0);
            for (const sg of [-1, 1] as const) {
              const ch = put(a, rng.chance(0.5) ? 'foldingChair' : 'plasticStackChair', xm, zm + sg * 1.0, sg < 0 ? WALL_ROT.N : WALL_ROT.S, {checkZone: true});
              if (ch) { use('sit', ch.x, ch.z, a, t.x, t.z); count('chairs'); }
            }
            count('plaza');
          } else {
            const b = put(a, 'bench', xm, zm, fr.dir > 0 ? WALL_ROT.W : WALL_ROT.E, {checkZone: true});
            if (b) { use('sit', b.x, b.z, a, b.x + fr.dir * 2, b.z); count('plaza'); }
          }
          put(a, 'pottedPlantSmall', xm, y * CELL + 0.45, 0, {checkZone: true});
        }
      }
      y = y2;
    }
  }

  // --- 6. The Arrival Square: under the bar's deck the gates' apron and its lamps, the gathering spot by the chasm ------------------
  {
    const a = SQ, X0 = a.x * CELL, X1 = (a.x + a.w) * CELL, Z0 = a.y * CELL, Z1 = (a.y + a.h) * CELL, zDeck = (cc.bar.y + cc.bar.h) * CELL;
    a.label = 'Arrival Square';
    for (const t of [0.2, 0.5, 0.8]) light(a, 0, X0 + (X1 - X0) * t, Z0 + 1.2, CREVICE.cont - 0.15, 0.85);
    for (const t of [0.3, 0.7]) light(a, 0, X0 + (X1 - X0) * t, zDeck - 0.6, CREVICE.cont - 0.15, 0.75);
    // the gathering spot: a camp table between two benches in the open middle, south of the deck, clear of the side lanes
    const cx = (X0 + X1) / 2 + rng.range(-0.5, 0.5), cz = Math.max(zDeck + 1.2, Math.min(Z1 - 1.8, (zDeck + Z1) / 2));
    const t = put(a, 'campTable', cx, cz, 0, {checkZone: true});
    if (t) {
      onHost(t, 'campLantern', 0, 0);
      onHost(t, 'campStove', -0.4, 0.05);
      for (const s of [-1, 1] as const) {
        const b = put(a, 'bench', cx, cz + s * 0.9, s < 0 ? 0 : Math.PI, {checkZone: true});
        if (b) use('sit', b.x, b.z + s * 0.5, a, t.x, t.z);
      }
      for (const s of [-1, 1] as const) {
        const ch = put(a, 'foldingChair', cx + s * 1.25, cz, s < 0 ? WALL_ROT.W : WALL_ROT.E, {checkZone: true});
        if (ch) { use('sit', ch.x, ch.z, a, t.x, t.z); count('chairs'); }
      }
      count('gathering');
    }
    use('chat', X0 + (X1 - X0) * 0.38, Z0 + 3.2, a, X0 + (X1 - X0) * 0.38 + 1.1, Z0 + 3.2);
    use('chat', X0 + (X1 - X0) * 0.38 + 1.1, Z0 + 3.2, a, X0 + (X1 - X0) * 0.38, Z0 + 3.2);
    use('idle', X0 + (X1 - X0) * 0.62, Z0 + 2.4, a, X0 + (X1 - X0) * 0.62, Z0);
    use('idle', X0 + (X1 - X0) * 0.5, Z1 - 0.9, a, X0 + (X1 - X0) * 0.5, Z1 + 3);
  }

  // --- 7. The Weir: communal eating by the kitchen (long tables, benches against the rock, the cook's camp table) -----------------
  {
    const a = WE, X0 = a.x * CELL, X1 = (a.x + a.w) * CELL, Zb = (a.y + a.h) * CELL, Za = (a.y + D.cross) * CELL;
    a.label = 'The Weir';
    const kitchen = cc.containers.find(c => c.use === 'kitchen');
    const kEast = kitchen ? (kitchen.rect.x * CELL > (X0 + X1) / 2) : false; // the kitchen's side
    const ex0 = X0 + 5 * CELL, ex1 = X1 - 5 * CELL; // the eating floor between the side lanes
    const fromK = (d: number) => (kEast ? ex1 - d : ex0 + d);
    // against the rock (south): the cook's camp table by the kitchen side; the long tables beside it, a bench behind each where it
    // fits (else chairs both sides), chairs on their open side
    const ct = put(a, 'campTable', fromK(0.7), Zb - PROP_DEFS.campTable.d / 2 - D.wallGap, Math.PI);
    if (ct) { onHost(ct, 'campStove', -0.3, 0); onHost(ct, 'riceCooker', 0.32, 0); use('cook', ct.x, ct.z - 0.85, a, ct.x, ct.z); }
    let tables = 0;
    const tw = PROP_DEFS.table.w, td = PROP_DEFS.table.d, bd = PROP_DEFS.bench.d;
    for (let k = 0; k < 3; k++) {
      const off = 1.6 + tw / 2 + k * (tw + 0.5);
      if (off + tw / 2 > ex1 - ex0 - 0.05) break;
      const bx = fromK(off), tz = Zb - bd - 0.1 - td / 2 - D.wallGap;
      if (tz - td / 2 - 0.6 < Za) break;
      const tb = put(a, 'table', bx, tz, 0);
      if (!tb) continue;
      tables++;
      if (k === 0) onHost(tb, 'campLantern', 0.2, 0);
      const bench = put(a, 'bench', bx, Zb - bd / 2 - D.wallGap, Math.PI);
      if (bench) use('sit', bench.x, bench.z, a, tb.x, tb.z);
      for (const dx of [-0.4, 0.4]) {
        const ch = put(a, 'plasticStackChair', bx + dx, tz - td / 2 - 0.3, 0);
        if (ch) { use('sit', ch.x, ch.z, a, tb.x, tb.z); count('chairs'); }
      }
    }
    count('weirTables', tables);
    use('chat', (X0 + X1) / 2 - 0.55, a.y * CELL + 1.0, a, (X0 + X1) / 2 + 0.55, a.y * CELL + 1.0);
    use('chat', (X0 + X1) / 2 + 0.55, a.y * CELL + 1.0, a, (X0 + X1) / 2 - 0.55, a.y * CELL + 1.0);
    use('idle', fromK(4.5), a.y * CELL + 0.9, a, fromK(4.5), a.y * CELL - 3);
    // lamps on the rock over the tables (the kitchen's roof edge carries them: the weir is open above)
    const canopy = kitchen && kitchen.area >= 0 ? area(kitchen.area) : canopyOf(0);
    if (canopy) for (const t of [0.2, 0.5, 0.8]) light(canopy, 0, ex0 + (ex1 - ex0) * t, Zb - D.wallLampOff, D.wallLampY, 0.75);
  }

  // --- 8. The platform (version 1 / 2's): benches between the gates, the station's name plates, MARKET boards, lamps --------------
  {
    const a = cc.platform, X0 = a.x * CELL, X1 = (a.x + a.w) * CELL, Z0 = a.y * CELL, Z1 = (a.y + a.h) * CELL;
    const gx = cc.gates.map(g => ({x0: g.rect.x * CELL, x1: (g.rect.x + g.rect.w) * CELL}));
    const busy = (x: number, half: number) => gx.some(q => x + half > q.x0 - 0.6 && x - half < q.x1 + 0.6);
    let benches = 0;
    for (let x = X0 + 3; x < X1 - 3 && benches < 3; x += 0.5) {
      if (busy(x, PROP_DEFS.bench.w / 2)) continue;
      const b = put(a, 'bench', x, Z1 - PROP_DEFS.bench.d / 2 - 0.05, Math.PI);
      if (b) { benches++; x += 6; use('sit', b.x, b.z - 0.6, a, b.x, Z0); }
    }
    const pc = (X0 + X1) / 2, g = gx.slice().sort((p, q) => Math.abs((p.x0 + p.x1) / 2 - pc) - Math.abs((q.x0 + q.x1) / 2 - pc))[0];
    for (const sx of [g.x0 - 1.6, g.x1 + 1.6]) sign({kind: 'station', text: layout.name, area: a.id, x: sx, z: Z1 - 0.02, y: 3.4, rot: Math.PI});
    for (const pd of gx) sign({kind: 'exit', text: 'MARKET', arrow: 'up', area: a.id, x: (pd.x0 + pd.x1) / 2, z: Z1 - 0.02, y: CREVICE.gateH + 0.3, rot: Math.PI});
    for (let x = X0 + 3; x < X1 - 2; x += 6) light(a, 0, x, (Z0 + Z1) / 2, 4.5, 0.75, {warm: false});
    use('idle', X0 + 1.5, Z0 + 2.7, a, X0 + 1.5, Z0);
    use('idle', X1 - 1.5, Z0 + 2.7, a, X1 - 1.5, Z0);
  }
  CREVICE_DRESS_QA.set(layout, {props: layout.props.length, lights: layout.lights.length, signs: layout.signs.length, community: anchors.community, counts: anchors.counts});
  return anchors;
}
