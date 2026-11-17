// Task studio-subway-architecture-materials-rework-20261117-072826-01: DRESSING of the layout-version-3 grand hall (gen/stationHallV3.ts) —
// its structure and its furnished subdivisions (pure data, no three.js). Every draw is on the dresser's 'grand-hall-v3-furnish' fork; no
// new prop kind (existing kinds only; generated kinds only when the station's palette carries them), placed through the shared rules of
// gen/placeKit.ts (door zones, lanes, keep strips, connectivity, stairs).
//
// Structure (in the dresser's area pass, before the composer, so its clusters flow round it):
//  - ARCADES: a column on every bay line of each nave / aisle boundary, as tall as the aisle ceiling (gen/subwayBays.ts derives the bays
//    from them; no columns in the nave);
//  - CIRCULATION: the spine (6 m down the nave, end to end) and a lane from every opening of the hall to it are reserved as desire lines
//    — nothing that stands on the floor is placed on them (the composer and the iteration-07 dresser respect them too; the composer's own
//    desire lines follow them and the hall gets no central plaza, gen/compose.ts, so the nave's bays stay free for the islands);
//  - each GATE BANK keeps its agent booth, machine bank and plate (the version-2 rule);
//  - the TICKET OFFICE: a row of 2-4 booths facing the nave in the longest free stretch of the gate-side aisle wall, queue barrier lanes
//    in front of its windows (crowd barriers, when the palette has them) and a ticket machine bank beside it;
//  - WAYFINDING: double-sided signs hung across the nave on bay lines (to trains, exits, the district).
// Furnishing (after the composer and the iteration-07 dresser):
//  - the south aisle's bays: retail pockets (a newsstand / hot-dog island, vending against the wall) and waiting pockets (benches);
//  - the nave beside the spine: 3-7 islands at bay centres, about every other bay (staggered between the two strips of a wide nave) —
//    seating (two back-to-back bench pairs + a bin), information (touch kiosks / ticket machines), a newsstand, a hot-dog cart — each
//    with a walkway ring; members meet on cell lines so no two footprints share a cell;
//  - loot holders (bins, stalls, carts, vending) stay in the version-2 grand halls' range: the furnishing adds none past
//    HALL_V3_HOLDER_CAP (a retail island becomes a seating island) and tops a sparse hall up to HALL_V3_HOLDER_MIN (wall bins / vending).

import {CELL, FLOOR, type Grid} from './grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from './props';
import {begin, commit, doorSide, markCell, rollback, rowAlongWall, tryPlaceProp, wallSpot, type PlaceCtx} from './placeKit';
import {isLootHolderKind} from '../items/loot';
import type {Area, Door, HallSection, Side, SignPlacement} from './stationTypes';
import {hallSectionWorld} from './hallSection';

/** Loot holders the furnishing lets a version-3 great hall reach (version-2 grand halls hold 6-13 at the corpus seeds). */
export const HALL_V3_HOLDER_CAP = 12;
/** ... and at least (the corpus's version-2 minimum). */
export const HALL_V3_HOLDER_MIN = 6;

export interface HallV3Api {
  /** stationDress signAtDoor (a plate over / beside an opening). */
  signAtDoor: (ctx: PlaceCtx, d: Door, a: Area, s: Omit<SignPlacement, 'x' | 'y' | 'z' | 'rot' | 'area'>) => void;
  /** stationDress hungRoofed (a hung plate's rods end at a real ceiling). */
  hungRoofed: (g: Grid, x: number, z: number, rot: number, w: number, ceil: number) => boolean;
  /** The station's generated-kind palette (gen/props07.ts p7Palette). */
  palette: ReadonlySet<string>;
}

/** What the dresser placed in a version-3 hall (tests / QA). */
export interface HallV3Summary {
  area: number;
  variant: HallSection['variant'];
  columns: number; gateBooths: number; officeBooths: number; barriers: number; machines: number; signs: number;
  islands: {seating: number; info: number; news: number; food: number};
  pockets: {retail: number; waiting: number};
  holdersBefore: number; holdersAfter: number;
}
const SUMMARY = new WeakMap<object, HallV3Summary[]>();
/** The version-3 hall summaries of a generated layout (empty for every other layout). */
export function hallV3Summary(layout: object): readonly HallV3Summary[] { return SUMMARY.get(layout) ?? []; }

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const q4 = (v: number) => Math.round(v * 4) / 4;
/** Snapped to a cell line (CELL = 0.5 m). */
const q2 = (v: number) => Math.round(v / CELL) * CELL;

/** Cell rows of the section (the hall runs along X). */
function rowsOf(a: Area, S: HallSection) {
  const row = (z: number) => Math.round(z / CELL);
  return {nave0: row(S.nave[0]), nave1: row(S.nave[1]), spine0: row(S.spine[0]), spine1: row(S.spine[1]), y0: a.y, y1: a.y + a.h};
}
/** The hall's bays as along spans (end walls included). */
function baysOf(a: Area, S: HallSection): [number, number][] {
  const edges = [a.x * CELL, ...S.lines, (a.x + a.w) * CELL];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < edges.length; i++) out.push([edges[i], edges[i + 1]]);
  return out;
}
const hallCell = (ctx: PlaceCtx, a: Area, x: number, y: number): number => {
  const g = ctx.g;
  if (!g.inBounds(x, y)) return -1;
  const i = g.idx(x, y);
  return g.area[i] === a.id && g.cells[i] === FLOOR ? i : -1;
};

// ---------------------------------------------------------------------------------------------
// Structure

/** The version-3 hall's structure (the dresser's area pass; `ctx.rng` = the hall's furnish fork). */
export function dressGrandHallV3(ctx: PlaceCtx, a: Area, api: HallV3Api): void {
  const S = hallSectionWorld(a)!;
  const {rng, layout} = ctx;
  const sum: HallV3Summary = {area: a.id, variant: S.variant, columns: 0, gateBooths: 0, officeBooths: 0, barriers: 0, machines: 0, signs: 0,
    islands: {seating: 0, info: 0, news: 0, food: 0}, pockets: {retail: 0, waiting: 0}, holdersBefore: 0, holdersAfter: 0};
  const list = SUMMARY.get(layout) ?? [];
  list.push(sum);
  SUMMARY.set(layout, list);
  // arcades: on every bay line of each boundary, up to the aisle ceiling
  const colH = S.aisleCeil - (a.floorY ?? 0);
  for (const z of S.arcades) for (const x of S.lines) if (tryPlaceProp(ctx, a, 'column', x, z, 0, {h: colH, laneOk: true})) sum.columns++;
  // circulation: the spine and a lane from every opening to it
  reserveCirculation(ctx, a, S);
  // gate banks (the version-2 rule): agent booth beside the gates, machines on the other side, the plate over them
  const doors = ctx.doorsOf.get(a.id) ?? [];
  const fares = doors.filter(d => d.fare);
  const bw = PROP_DEFS.booth.w;
  for (const fare of fares) {
    const side = doorSide(fare, a);
    const s0 = fare.x * CELL, s1 = s0 + fare.w * CELL;
    const spots = rng.chance(0.5) ? [s0 - 1.2 - bw / 2, s1 + 1.2 + bw / 2] : [s1 + 1.2 + bw / 2, s0 - 1.2 - bw / 2];
    let boothAt: number | null = null;
    for (const t of spots) {
      const s = wallSpot(a, side, q4(t), 'booth');
      if (tryPlaceProp(ctx, a, 'booth', s.x, s.z, s.rot, {front: 1.2})) { boothAt = t; sum.gateBooths++; break; }
    }
    const before = boothAt !== null ? boothAt > s1 : rng.chance(0.5);
    const t0 = before ? s0 - 1.4 - 4 : s1 + 1.4;
    sum.machines += rowAlongWall(ctx, a, side, 'ticketMachine', {from: t0, to: t0 + 4, max: rng.int(3, 4), front: 1.0}).length;
    api.signAtDoor(ctx, fare, a, {kind: 'info', text: 'TO TRAINS · ALL PLATFORMS', arrow: 'up', w: 2.4});
  }
  ticketOffice(ctx, a, S, api.palette, sum);
  naveSigns(ctx, a, S, api, sum);
}

/** Reserves the spine and the lanes from every opening of the hall to it (desire-line cells: no floor prop stands on them). */
function reserveCirculation(ctx: PlaceCtx, a: Area, S: HallSection): void {
  const R = rowsOf(a, S);
  const mark = (x: number, y: number) => { const i = hallCell(ctx, a, x, y); if (i >= 0 && !ctx.lane[i]) markCell(ctx, ctx.lane, i); };
  for (let y = R.spine0; y < R.spine1; y++) for (let x = a.x; x < a.x + a.w; x++) mark(x, y);
  for (const d of ctx.doorsOf.get(a.id) ?? []) {
    const side = doorSide(d, a);
    if (side === 'N' || side === 'S') {
      const [ya, yb] = side === 'N' ? [a.y, R.spine0] : [R.spine1, a.y + a.h];
      for (let y = ya; y < yb; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) mark(x, y);
    } else {
      // an end-wall opening: a 3 m landing inside it, then straight across to the spine
      const xs = side === 'W' ? [a.x, a.x + 6] : [a.x + a.w - 6, a.x + a.w];
      const ya = Math.min(d.y - 1, R.spine0), yb = Math.max(d.y + d.h + 1, R.spine1);
      for (let y = ya; y < yb; y++) for (let x = xs[0]; x < xs[1]; x++) mark(x, y);
    }
  }
}

/** The ticket office: 2-4 booths in the longest free run of the gate-side wall, queue barriers in front, a machine bank beside it. */
function ticketOffice(ctx: PlaceCtx, a: Area, S: HallSection, palette: ReadonlySet<string>, sum: HallV3Summary): void {
  const rng = ctx.rng;
  const side: Side = 'N';
  const a0 = a.x * CELL + 1, a1 = (a.x + a.w) * CELL - 1;
  // the wall is taken round every opening in it (the gate banks with their booths and machines: ~7.5 m either side)
  const taken: [number, number][] = [];
  for (const d of ctx.doorsOf.get(a.id) ?? []) {
    if (doorSide(d, a) !== side) continue;
    const s0 = d.x * CELL, s1 = s0 + d.w * CELL, m = d.fare ? 7.5 : 2;
    taken.push([s0 - m, s1 + m]);
  }
  taken.sort((p, q) => p[0] - q[0]);
  const runs: [number, number][] = [];
  let cur = a0;
  for (const [p, q] of taken) { if (p > cur) runs.push([cur, Math.min(p, a1)]); cur = Math.max(cur, q); }
  if (cur < a1) runs.push([cur, a1]);
  runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  // (windows on whole cells from a cell line: neighbouring booths never share a footprint cell)
  const bw = Math.ceil((PROP_DEFS.booth.w + 0.02) / CELL) * CELL;
  const want = rng.int(2, 4);
  for (const [r0, r1] of runs) {
    for (let n = want; n >= 2; n--) {
      const W = n * bw;
      if (r1 - r0 < W + 1) continue;
      // centred on the bay centre nearest the run's middle that keeps the office inside the run
      const mid = (r0 + r1) / 2;
      const centres = baysOf(a, S).map(([p, q]) => (p + q) / 2).filter(c => c - W / 2 >= r0 && c + W / 2 <= r1).sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
      for (const c of centres.length ? centres : [mid]) {
        const x0 = q2(c - W / 2);
        begin(ctx);
        const booths: PropPlacement[] = [];
        for (let i = 0; i < n; i++) {
          const s = wallSpot(a, side, r3(x0 + bw * (i + 0.5)), 'booth');
          const p = tryPlaceProp(ctx, a, 'booth', s.x, s.z, s.rot, {front: 1.2});
          if (!p) break;
          booths.push(p);
        }
        if (booths.length < n) { rollback(ctx); continue; }
        commit(ctx);
        sum.officeBooths += n;
        // queue lanes: a barrier on each window joint, running out (2 m) from the cell line past the windows' access strips
        if (palette.has('crowdBarrier')) {
          const front = booths[0].z + PROP_DEFS.booth.d / 2;
          const fz = (Math.floor((front + 1.2 - 0.04) / CELL) + 1) * CELL + PROP_DEFS.crowdBarrier.w / 2;
          for (let i = 0; i <= n; i++) if (tryPlaceProp(ctx, a, 'crowdBarrier', r3(x0 + bw * i), r3(fz), Math.PI / 2, {})) sum.barriers++;
        }
        // a machine bank beside the office (the side with more wall)
        const left = x0 - r0 > r1 - (x0 + W);
        const t0 = left ? x0 - 1.0 - 3.4 : x0 + W + 1.0;
        sum.machines += rowAlongWall(ctx, a, side, 'ticketMachine', {from: t0, to: t0 + 3.4, max: rng.int(3, 4), front: 1.0}).length;
        return;
      }
    }
  }
}

/** Double-sided signs hung across the nave on bay lines: to the trains, the exits, the district. */
function naveSigns(ctx: PlaceCtx, a: Area, S: HallSection, api: HallV3Api, sum: HallV3Summary): void {
  const {layout} = ctx;
  const food = layout.areas.some(o => o.type === 'food-court');
  const texts = ['TO TRAINS · ALL PLATFORMS', 'EXITS · STREET', food ? 'FOOD COURT · SHOPS' : 'SHOPS · WASHROOMS'];
  const L = S.lines.length;
  if (!L) return;
  const picks = [...new Set([0.2, 0.5, 0.8].map(f => Math.min(L - 1, Math.max(0, Math.round(f * (L - 1))))))];
  const z = (S.spine[0] + S.spine[1]) / 2, rot = Math.PI / 2, w = 3.0;
  const y = Math.min(S.aisleCeil - 0.4, 3.9) - (a.floorY ?? 0);
  picks.forEach((li, k) => {
    const x = S.lines[li];
    if (!api.hungRoofed(ctx.g, x, z, rot, w, a.ceil)) return;
    layout.signs.push({x: r3(x), y, z: r3(z), rot, kind: 'info', text: texts[k % texts.length], area: a.id, hang: true, w});
    sum.signs++;
  });
}

// ---------------------------------------------------------------------------------------------
// Furnishing

/** Every cell of the rect (world) is free open floor of the hall: no prop, reservation, lane, plaza, door zone or stair edge. */
function rectClear(ctx: PlaceCtx, a: Area, x0: number, z0: number, x1: number, z1: number): boolean {
  const g = ctx.g;
  for (let cy = Math.floor(z0 / CELL); cy <= Math.floor((z1 - 1e-3) / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor((x1 - 1e-3) / CELL); cx++) {
    const i = hallCell(ctx, a, cx, cy);
    if (i < 0 || g.blocked[i] || ctx.keep[i] || ctx.lane[i] || ctx.plaza[i] || ctx.zone[i] || ctx.edge[i] || ctx.doorCell[i]) return false;
  }
  return true;
}
/** Reserves a walkway ring (keep) round an island's box. */
function keepRing(ctx: PlaceCtx, a: Area, x0: number, z0: number, x1: number, z1: number): void {
  const g = ctx.g;
  for (let cy = Math.floor(z0 / CELL); cy <= Math.floor((z1 - 1e-3) / CELL); cy++) for (let cx = Math.floor(x0 / CELL); cx <= Math.floor((x1 - 1e-3) / CELL); cx++) {
    const i = hallCell(ctx, a, cx, cy);
    if (i >= 0 && !g.blocked[i] && !ctx.keep[i]) markCell(ctx, ctx.keep, i);
  }
}

interface Member { kind: PropKind; dx: number; dz: number; rot: number; holder?: boolean; purpose?: string; front?: number }

/** An island of members round (x, z) inside a clear box with a `ring` m walkway, all or nothing. */
function island(ctx: PlaceCtx, a: Area, x: number, z: number, members: readonly Member[], ring: number): PropPlacement[] | null {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const m of members) {
    const d = PROP_DEFS[m.kind], q = Math.abs(Math.sin(m.rot)) > 0.5;
    const hx = (q ? d.d : d.w) / 2, hz = (q ? d.w : d.d) / 2;
    x0 = Math.min(x0, x + m.dx - hx); x1 = Math.max(x1, x + m.dx + hx); z0 = Math.min(z0, z + m.dz - hz); z1 = Math.max(z1, z + m.dz + hz);
  }
  if (!rectClear(ctx, a, x0 - ring, z0 - ring, x1 + ring, z1 + ring)) return null;
  begin(ctx);
  const out: PropPlacement[] = [];
  for (const m of members) {
    const p = tryPlaceProp(ctx, a, m.kind, r3(x + m.dx), r3(z + m.dz), m.rot, {variant: ctx.rng.int(0, 3), ...(m.front ? {front: m.front} : {})});
    if (!p) { rollback(ctx); return null; }
    if (m.purpose) p.purpose = m.purpose;
    out.push(p);
  }
  commit(ctx);
  keepRing(ctx, a, x0 - ring, z0 - ring, x1 + ring, z1 + ring);
  return out;
}

/** Furnishes a version-3 great hall's bays (after the composer; `ctx.rng` = the hall's furnish fork). */
export function furnishGrandHallV3(ctx: PlaceCtx, a: Area, palette: ReadonlySet<string>): void {
  const S = hallSectionWorld(a)!;
  const {rng, layout} = ctx;
  const sum = hallV3Summary(layout).find(s => s.area === a.id);
  if (!sum) return;
  let holders = layout.props.filter(p => p.area === a.id && isLootHolderKind(p.kind)).length;
  sum.holdersBefore = holders;
  const room = () => HALL_V3_HOLDER_CAP - holders;
  const count = (ps: readonly PropPlacement[] | null) => { if (ps) holders += ps.filter(p => isLootHolderKind(p.kind)).length; return ps; };
  const R = rowsOf(a, S);
  const bays = baysOf(a, S);
  const inner = bays.slice(1, -1);
  // --- the south pockets: the south aisle (behind its arcade), or the nave's south strip in a one-aisle hall
  const pz0 = (S.aisles.length > 1 ? R.nave1 + 1 : R.spine1) * CELL, pz1 = R.y1 * CELL;
  if (pz1 - pz0 >= 4) {
    const order = rng.shuffle(inner.slice());
    let retail = rng.int(1, 3), waiting = rng.int(1, 2);
    const zc = (pz0 + pz1) / 2;
    for (const [p, q] of order) {
      if (!retail && !waiting) break;
      const c = q4((p + q) / 2);
      const wantRetail = retail > 0 && (room() > 0) && (waiting === 0 || sum.pockets.retail <= sum.pockets.waiting);
      if (wantRetail) {
        const cart = rng.chance(0.35);
        const kind: PropKind = cart ? 'hotdogCart' : 'stall';
        const got = count(island(ctx, a, c, q4(zc), [{kind, dx: 0, dz: 0, rot: Math.PI, front: 1.2, purpose: cart ? 'hotdog' : 'newsstand'}], 0.9));
        if (!got) continue;
        retail--; sum.pockets.retail++;
        // the pocket's wall: a cash machine (palette) or a vending machine (a holder) against the south wall in the bay
        if (palette.has('atmKiosk')) rowAlongWall(ctx, a, 'S', 'atmKiosk' as PropKind, {from: p + 0.6, to: q - 0.6, max: 1, front: 1.0});
        if (room() > 0) count(rowAlongWall(ctx, a, 'S', 'vending', {from: p + 0.6, to: q - 0.6, max: 1, front: 1.0, variant: () => rng.int(0, 2)}));
      } else if (waiting > 0) {
        // two benches side by side against the wall, facing the nave (both or none)
        begin(ctx);
        const benches = rowAlongWall(ctx, a, 'S', 'bench', {from: c - 2.2, to: c + 2.2, max: 2, front: 0.9, variant: () => rng.int(0, 3)});
        if (benches.length < 2) { rollback(ctx); continue; }
        commit(ctx);
        waiting--; sum.pockets.waiting++;
        if (room() > 0) count(rowAlongWall(ctx, a, 'S', 'bin', {from: c + 2.2, to: c + 3.4, max: 1}));
      }
    }
  }
  // --- nave islands beside the spine, at bay centres spread along the hall
  const strips: [number, number][] = [];
  if (R.spine0 - R.nave0 >= 7) strips.push([R.nave0 * CELL, R.spine0 * CELL]);
  if (R.nave1 - R.spine1 >= 7 && S.aisles.length > 1) strips.push([R.spine1 * CELL, R.nave1 * CELL]);
  if (strips.length && inner.length) naveIslands(ctx, a, S, strips, inner, palette, sum, room, count);
  // --- the floor of the version-2 range: a bin (then a vending machine) against the aisle walls at bay centres
  for (const kind of ['bin', 'vending'] as const) for (const side of ['S', 'N'] as const) for (const [p, q] of inner) {
    if (holders >= HALL_V3_HOLDER_MIN) break;
    const c = (p + q) / 2;
    count(rowAlongWall(ctx, a, side, kind, {from: c - 1.2, to: c + 1.2, max: 1, ...(kind === 'vending' ? {front: 1.0, variant: () => rng.int(0, 2)} : {})}));
  }
  sum.holdersAfter = holders;
}

type IslandType = 'seating' | 'info' | 'news' | 'food';

/** The nave's islands beside the spine, at bay centres spread along the hall. */
function naveIslands(ctx: PlaceCtx, a: Area, S: HallSection, strips: [number, number][], inner: [number, number][], palette: ReadonlySet<string>, sum: HallV3Summary,
  room: () => number, count: (ps: readonly PropPlacement[] | null) => readonly PropPlacement[] | null): void {
  const rng = ctx.rng;
  // about every other bay of each strip (staggered between two strips), 3-7 islands: seating, information, a newsstand, a food cart
  const slots = strips.length * inner.length;
  const n = Math.min(slots, Math.max(3, Math.min(7, Math.round(inner.length * 0.55 * strips.length))));
  const program: IslandType[] = rng.shuffle(['seating', 'info', 'news', 'food'] as IslandType[]);
  const types: IslandType[] = [];
  for (let k = 0; k < n; k++) types.push(k % 2 === 0 ? 'seating' : program[(k >> 1) % program.length]);
  const used = new Set<number>();
  types.forEach((type, k) => {
    // the slot nearest this island's share of the hall (strips alternate), then its neighbours
    const target = Math.round(((k + 0.5) / n) * (inner.length - 1)), want = k % strips.length;
    const tries: [number, number][] = [];
    for (let i = 0; i < inner.length; i++) for (let s = 0; s < strips.length; s++) tries.push([i, s]);
    tries.sort((p, q) => Math.abs(p[0] - target) - Math.abs(q[0] - target) || (p[1] === want ? 0 : 1) - (q[1] === want ? 0 : 1));
    for (const [bi, si] of tries) {
      if (used.has(bi * 2 + si) || used.has(bi * 2 + (1 - si))) continue;
      const [p, q] = inner[bi], [s0, s1] = strips[si];
      const x = q2((p + q) / 2), z = q2((s0 + s1) / 2);
      let kind = type, got: readonly PropPlacement[] | null = null;
      // (a counter faces the spine)
      for (const m of islandMembers(type, palette, room(), z < (S.spine[0] + S.spine[1]) / 2 ? 0 : Math.PI)) {
        got = count(island(ctx, a, x, z, m.members, 1.0));
        if (got) { kind = m.type; break; }
      }
      if (got) { used.add(bi * 2 + si); sum.islands[kind]++; break; }
    }
  });
}

/** The member sets of one nave island round a cell corner, best first (none: its kinds are not available / they would pass the holder
 *  cap). Back-to-back pairs meet exactly on the corner's cell line (half a depth either side), so their footprints never share a cell. */
function islandMembers(type: IslandType, palette: ReadonlySet<string>, holderRoom: number, face: number): {type: IslandType; members: Member[]}[] {
  const out: {type: IslandType; members: Member[]}[] = [];
  const bd = PROP_DEFS.bench.d / 2, bw = PROP_DEFS.bench.w / 2;
  const bin = (dx: number): Member[] => (holderRoom > 0 ? [{kind: 'bin', dx, dz: 0, rot: 0}] : []);
  if (type === 'info') {
    if (palette.has('infoTouchKiosk')) {
      const d = PROP_DEFS['infoTouchKiosk' as PropKind].d / 2;
      out.push({type, members: [{kind: 'infoTouchKiosk' as PropKind, dx: 0, dz: -d, rot: Math.PI}, {kind: 'infoTouchKiosk' as PropKind, dx: 0, dz: d, rot: 0},
        ...(palette.has('atmKiosk') ? [{kind: 'atmKiosk' as PropKind, dx: 0.9, dz: 0, rot: Math.PI / 2}] : [])]});
    }
    const d = PROP_DEFS.ticketMachine.d / 2, w = PROP_DEFS.ticketMachine.w / 2;
    out.push({type, members: [{kind: 'ticketMachine', dx: -w, dz: -d, rot: Math.PI}, {kind: 'ticketMachine', dx: w, dz: -d, rot: Math.PI},
      {kind: 'ticketMachine', dx: -w, dz: d, rot: 0}, {kind: 'ticketMachine', dx: w, dz: d, rot: 0}]});
  } else if (type === 'news' && holderRoom > 0) out.push({type, members: [{kind: 'stall', dx: 0, dz: 0, rot: face, front: 1.2, purpose: 'newsstand'}]});
  else if (type === 'food' && holderRoom > 0) out.push({type, members: [{kind: 'hotdogCart', dx: 0, dz: 0, rot: face, front: 1.2, purpose: 'hotdog'}]});
  if (type === 'seating' || !out.length) {
    // (a retail island past the holder cap is a waiting island instead) two back-to-back pairs side by side, else one pair
    out.push({type: 'seating', members: [{kind: 'bench', dx: -bw, dz: -bd, rot: Math.PI}, {kind: 'bench', dx: bw, dz: -bd, rot: Math.PI},
      {kind: 'bench', dx: -bw, dz: bd, rot: 0}, {kind: 'bench', dx: bw, dz: bd, rot: 0}, ...bin(2 * bw + 0.45)]});
    out.push({type: 'seating', members: [{kind: 'bench', dx: 0, dz: -bd, rot: Math.PI}, {kind: 'bench', dx: 0, dz: bd, rot: 0}, ...bin(bw + 0.45)]});
  }
  return out;
}
