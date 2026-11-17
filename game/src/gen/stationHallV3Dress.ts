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
//  - the aisles' pockets (below: the finishing pass's layout-aware fit);
//  - the nave beside the spine: 3-7 islands at bay centres, about every other bay (staggered between the two strips of a wide nave) —
//    seating (two back-to-back bench pairs + a bin), information (touch kiosks / ticket machines), a newsstand, a hot-dog cart — each
//    with a walkway ring; members meet on cell lines so no two footprints share a cell;
//  - loot holders (bins, stalls, carts, vending) stay in the version-2 grand halls' range: the furnishing adds none past
//    HALL_V3_HOLDER_CAP (a retail island becomes a seating island) and tops a sparse hall up to HALL_V3_HOLDER_MIN (wall bins / vending).
//
// Task studio-subway-rework-m2-finishing-20261117-111246-01 (lane GEN): the hall's DESTINATIONS, recorded on its section
// (HallSection.fronts / .upper, relative metres) for the render kit and the hall light plan:
//  - the ticket office is the primary front ('office': booths + queue lanes) with its fascia name plate;
//  - aisle POCKETS are fitted to the free floor that is really there (layout-aware: every cell-line anchor of both aisles' walls and
//    arcade sides is tested with the rectClear predicates, never only bay centres): kiosk (newsstand / food cart), service (ticket
//    machines, information / cash points from the palette) and waiting (benches against a wall, or back to back beside the arcade)
//    pockets, 2-4 per hall, spread along it and never two side by side in one stretch of an aisle (the aisle stays a walkway, never an
//    obstacle course); the gate-aisle variant's south nave strip is its pocket zone; waiting groups (pockets and nave seating islands) get a hung
//    wayfinding plate beside the clock the kit hangs on them, kiosk / service pockets a name plate on their wall;
//  - the CLERESTORY (the nave wall over each aisle) gets purposeful bays: a framed tablet over the ticket office, each gate bank and
//    each street exit (its sign on the face), one station clock near the hall centre, ventilation grilles in about every third
//    remaining bay (the two faces out of step); the rest keep the kit's blind panels;
//  - loot holders: the destinations prefer non-holder kinds and HALL_V3_HOLDER_CAP is the version-2 grand halls' mean (~9).

import {CELL, FLOOR, type Grid} from './grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from './props';
import {backed, begin, boxClear, commit, doorSide, markCell, propBlocksDoorway, rollback, rowAlongWall, tryPlaceProp, wallSpot, type PlaceCtx} from './placeKit';
import {signDims} from './doorways';
import {isLootHolderKind} from '../items/loot';
import type {Area, Door, HallFront, HallSection, HallUpperFeature, Side, SignPlacement} from './stationTypes';
import {hallSectionWorld} from './hallSection';

/** Loot holders the furnishing lets a version-3 great hall reach (version-2 grand halls hold 6-13, mean ~9.0, at the corpus seeds: the
 *  furnishing's destinations prefer non-holder kinds, so the version-3 mean stays at version 2's). */
export const HALL_V3_HOLDER_CAP = 9;
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
  /** Aisle pockets (retail = kiosk). */
  pockets: {retail: number; service: number; waiting: number};
  /** The longest free aisle wall run (m, 2 m deep) when the pockets were fitted. */
  freeRun: number;
  /** The recorded fronts / clerestory features by kind, and the signs the finishing pass placed. */
  fronts: Record<HallFront['kind'], number>;
  upper: Record<HallUpperFeature['kind'], number>;
  waitingSigns: number; frontSigns: number; tablets: number;
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
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Records a front (world metres) on the hall's section record (relative metres: the record survives the crop / re-framing). */
function addFront(a: Area, f: HallFront, sum: HallV3Summary): void {
  const al = a.x * CELL, ac = a.y * CELL;
  const S = a.hallSection!;
  (S.fronts ??= []).push({...f, along: [r2(f.along[0] - al), r2(f.along[1] - al)], across: [r2(f.across[0] - ac), r2(f.across[1] - ac)]});
  sum.fronts[f.kind]++;
}
/** The hall's fronts in world metres (those recorded so far). */
const frontsWorld = (a: Area): HallFront[] => hallSectionWorld(a)?.fronts ?? [];

/** A wall plate's span over the wall (`side`) of the hall is free of other wall plates of the hall (any height overlap). */
function wallPlateFree(ctx: PlaceCtx, a: Area, side: Side, t0: number, t1: number, y0: number, y1: number): boolean {
  const plane = side === 'N' ? a.y * CELL : (a.y + a.h) * CELL;
  for (const s of ctx.layout.signs) {
    if (s.area !== a.id || s.hang || Math.abs(s.z - plane) > 0.5) continue;
    const {w, h} = signDims(s);
    if (s.x + w / 2 > t0 - 0.1 && s.x - w / 2 < t1 + 0.1 && s.y + h / 2 > y0 - 0.1 && s.y - h / 2 < y1 + 0.1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Structure

/** The version-3 hall's structure (the dresser's area pass; `ctx.rng` = the hall's furnish fork). */
export function dressGrandHallV3(ctx: PlaceCtx, a: Area, api: HallV3Api): void {
  const S = hallSectionWorld(a)!;
  const {rng, layout} = ctx;
  const sum: HallV3Summary = {area: a.id, variant: S.variant, columns: 0, gateBooths: 0, officeBooths: 0, barriers: 0, machines: 0, signs: 0,
    islands: {seating: 0, info: 0, news: 0, food: 0}, pockets: {retail: 0, service: 0, waiting: 0}, freeRun: 0,
    fronts: {office: 0, waiting: 0, kiosk: 0, service: 0}, upper: {clock: 0, tablet: 0, grille: 0}, waitingSigns: 0, frontSigns: 0, tablets: 0,
    holdersBefore: 0, holdersAfter: 0};
  a.hallSection!.fronts = [];
  a.hallSection!.upper = [];
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
  const office = ticketOffice(ctx, a, S, api.palette, sum);
  naveSigns(ctx, a, S, api, sum);
  clerestory(ctx, a, S, office, sum);
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

/** The ticket office's fascia name plate: centred on the office, 0.32 m out from the wall (in front of the kit's fascia box). */
export const OFFICE_FASCIA = {text: 'TICKETS · TRAVEL INFORMATION', y: 3.1, out: 0.32, maxW: 6} as const;

/** The ticket office: 2-4 booths in the longest free run of the gate-side wall, queue barriers in front, a machine bank beside it.
 *  Records its 'office' front and fascia plate; returns its along span (world), or null without one. */
function ticketOffice(ctx: PlaceCtx, a: Area, S: HallSection, palette: ReadonlySet<string>, sum: HallV3Summary): [number, number] | null {
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
        const front = booths[0].z + PROP_DEFS.booth.d / 2;
        let apron = front + 1.2;
        if (palette.has('crowdBarrier')) {
          const fz = (Math.floor((front + 1.2 - 0.04) / CELL) + 1) * CELL + PROP_DEFS.crowdBarrier.w / 2;
          let k = 0;
          for (let i = 0; i <= n; i++) if (tryPlaceProp(ctx, a, 'crowdBarrier', r3(x0 + bw * i), r3(fz), Math.PI / 2, {})) { sum.barriers++; k++; }
          if (k) apron = Math.max(apron, fz + PROP_DEFS.crowdBarrier.w / 2);
        }
        // a machine bank beside the office (the side with more wall)
        const left = x0 - r0 > r1 - (x0 + W);
        const t0 = left ? x0 - 1.0 - 3.4 : x0 + W + 1.0;
        sum.machines += rowAlongWall(ctx, a, side, 'ticketMachine', {from: t0, to: t0 + 3.4, max: rng.int(3, 4), front: 1.0}).length;
        // the primary destination: its front (the windows + the queue lanes) and its fascia name over the booths
        addFront(a, {kind: 'office', wall: 'N', along: [r2(x0 - 0.3), r2(x0 + W + 0.3)], across: [r2(a.y * CELL), r2(apron)], label: OFFICE_FASCIA.text}, sum);
        const fw = r2(Math.min(W - 0.6, OFFICE_FASCIA.maxW)), fx = r3(x0 + W / 2), fh = signDims({kind: 'info', w: fw}).h;
        const base = a.floorY ?? 0;
        if (backed(ctx, a, side, fx - fw / 2, fx + fw / 2, base + OFFICE_FASCIA.y - fh / 2)) {
          ctx.layout.signs.push({x: fx, y: OFFICE_FASCIA.y, z: r3(a.y * CELL + OFFICE_FASCIA.out), rot: 0, kind: 'info', text: OFFICE_FASCIA.text, area: a.id, w: fw});
          sum.frontSigns++;
        }
        return [x0, x0 + W];
      }
    }
  }
  return null;
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

/**
 * The clerestory's panel band (absolute y): the render kit's framed blind panels (world/subwayKit.ts CLERESTORY) run from the string
 * course over the aisle ceiling (+0.24 course, +0.45 inset) to under the piers' caps below the nave's transverse beams (a grand hall's
 * nave is >= 7 m tall: 0.9 m beams; 0.16 m cap, 0.45 inset).
 */
/** A clerestory tablet's plate height (m; at most 60 % of the panel band). */
export const TABLET_H = 0.8;
export function clerestoryBand(S: Pick<HallSection, 'aisleCeil' | 'naveCeil'>): [number, number] {
  return [r2(S.aisleCeil + 0.24 + 0.45), r2(S.naveCeil - 0.9 - 0.16 - 0.45)];
}

/** The clerestory's purposeful bays (HallSection.upper) and the tablets' signs (deterministic: no draw). */
function clerestory(ctx: PlaceCtx, a: Area, S: HallSection, office: [number, number] | null, sum: HallV3Summary): void {
  const {layout} = ctx;
  // the faces: the nave wall over each aisle (the gate-aisle variant's south wall is the full-height hall wall: no clerestory)
  const faces: {face: number; facing: 1 | -1}[] = [{face: S.nave[0], facing: 1}];
  if (S.aisles.length > 1) faces.push({face: S.nave[1], facing: -1});
  // its bays (end walls included), never the transept's full-height crossing
  const bays = baysOf(a, S).filter(([p, q]) => !(S.transept && (p + q) / 2 > S.transept[0] && (p + q) / 2 < S.transept[1]));
  if (!bays.length) return;
  const feats = new Map<number, HallUpperFeature>();
  const key = (fi: number, bi: number) => fi * 1000 + bi;
  const bayAt = (x: number) => bays.findIndex(([p, q]) => x >= p && x < q);
  const [b0, b1] = clerestoryBand(S);
  const base = a.floorY ?? 0;
  const tablet = (fi: number, xs: readonly number[], text: string, kind: SignPlacement['kind']) => {
    // (the first of the spots that is in a clerestory bay: a crossing has none)
    const bi = xs.map(bayAt).find(i => i >= 0) ?? -1;
    if (bi < 0 || feats.has(key(fi, bi))) return;
    const [p, q] = bays[bi], w = r2(Math.min(q - p - 1.6, 4.5));
    if (w < 1.2) return;
    const {face, facing} = faces[fi];
    feats.set(key(fi, bi), {kind: 'tablet', face, facing, along: [p, q], text});
    // (a tablet is a tall plate — lettering that reads across the nave, not a thin strip: TABLET_H, within the panel band)
    layout.signs.push({x: r3((p + q) / 2), y: r2((b0 + b1) / 2 - base), z: r3(face + 0.06 * facing), rot: facing > 0 ? 0 : Math.PI, kind, text, area: a.id, w,
      h: r2(Math.min(TABLET_H, (b1 - b0) * 0.6))});
    sum.tablets++;
  };
  const doors = ctx.doorsOf.get(a.id) ?? [];
  // tablets: over the ticket office and each gate bank (the gate-side face), over each street exit (the exit-side face)
  if (office) tablet(0, [(office[0] + office[1]) / 2, office[0] + 0.5, office[1] - 0.5], 'TICKETS', 'info');
  for (const d of doors) if (d.fare && doorSide(d, a) === 'N') tablet(0, [(d.x + d.w / 2) * CELL], 'TO TRAINS', 'info');
  if (faces.length > 1) for (const d of doors) {
    if (d.fare || doorSide(d, a) !== 'S' || layout.areas[d.a === a.id ? d.b : d.a]?.type !== 'exit-stair') continue;
    tablet(1, [(d.x + d.w / 2) * CELL], 'WAY OUT', 'exit');
  }
  // one station clock: the bay nearest the hall centre on the face opposite the ticket office (the exit side), else the gate side
  const mid = (a.x + a.w / 2) * CELL, cf = faces.length - 1;
  const byMid = bays.map((_, i) => i).sort((i, j) => Math.abs((bays[i][0] + bays[i][1]) / 2 - mid) - Math.abs((bays[j][0] + bays[j][1]) / 2 - mid) || i - j);
  const ci = byMid.find(i => !feats.has(key(cf, i)));
  if (ci !== undefined) feats.set(key(cf, ci), {kind: 'clock', face: faces[cf].face, facing: faces[cf].facing, along: bays[ci]});
  // ventilation grilles: about every third remaining bay of each face, the two faces out of step
  faces.forEach(({face, facing}, fi) => {
    let k = 0;
    bays.forEach((b, bi) => {
      if (feats.has(key(fi, bi))) return;
      if (k++ % 3 === (fi === 0 ? 1 : 2)) feats.set(key(fi, bi), {kind: 'grille', face, facing, along: b});
    });
  });
  // (relative metres, by face then along)
  const al = a.x * CELL, ac = a.y * CELL;
  const S0 = a.hallSection!;
  for (const k of [...feats.keys()].sort((p, q) => p - q)) {
    const u = feats.get(k)!;
    (S0.upper ??= []).push({...u, face: r2(u.face - ac), along: [r2(u.along[0] - al), r2(u.along[1] - al)]});
    sum.upper[u.kind]++;
  }
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
  return group(ctx, a, x, z, members, {x: ring, z0: ring, z1: ring});
}
/** The members' footprint box round (x, z) (world). */
function membersBox(x: number, z: number, members: readonly Member[]): [number, number, number, number] {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const m of members) {
    const d = PROP_DEFS[m.kind], q = Math.abs(Math.sin(m.rot)) > 0.5;
    const hx = (q ? d.d : d.w) / 2, hz = (q ? d.w : d.d) / 2;
    x0 = Math.min(x0, x + m.dx - hx); x1 = Math.max(x1, x + m.dx + hx); z0 = Math.min(z0, z + m.dz - hz); z1 = Math.max(z1, z + m.dz + hz);
  }
  return [x0, z0, x1, z1];
}
/** A group of members round (x, z) inside a clear box with walkway margins (along either end; on its -z / +z sides), all or nothing. */
function group(ctx: PlaceCtx, a: Area, x: number, z: number, members: readonly Member[], margin: {x: number; z0: number; z1: number}): PropPlacement[] | null {
  const [x0, z0, x1, z1] = membersBox(x, z, members);
  const bx0 = x0 - margin.x, bx1 = x1 + margin.x, bz0 = z0 - margin.z0, bz1 = z1 + margin.z1;
  if (!rectClear(ctx, a, bx0, bz0, bx1, bz1)) return null;
  begin(ctx);
  const out: PropPlacement[] = [];
  for (const m of members) {
    const p = tryPlaceProp(ctx, a, m.kind, r3(x + m.dx), r3(z + m.dz), m.rot, {variant: ctx.rng.int(0, 3), ...(m.front ? {front: m.front} : {})});
    if (!p) { rollback(ctx); return null; }
    if (m.purpose) p.purpose = m.purpose;
    out.push(p);
  }
  commit(ctx);
  keepRing(ctx, a, bx0, bz0, bx1, bz1);
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
  // --- the aisle pockets, fitted to the free floor that is really there (both aisles; the gate-aisle variant's south nave strip)
  aislePockets(ctx, a, S, palette, sum, room, count);
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
  // --- each waiting group's wayfinding: a hung plate beside the clock the kit hangs on it
  waitingSigns(ctx, a, S, sum);
  sum.holdersAfter = holders;
}

// ---------------------------------------------------------------------------------------------
// Aisle pockets (layout-aware)

type PocketType = 'kiosk' | 'service' | 'waiting';
/** A pocket against an aisle wall: members side by side, backs to the wall, each in whole cells from a cell line. */
interface WallMember { kind: PropKind; front: number; purpose?: string }
/** Where a pocket may go: against an aisle's outer wall, or free-standing on a meeting line (beside the arcade / mid-strip). */
type Band = {aisle: 'N' | 'S'; wall: 'N' | 'S'} | {aisle: 'N' | 'S'; zm: number; naveDir: 1 | -1};

/** Cells a member's slot spans along the wall (its width + 2 cm, whole cells: neighbours never share a footprint cell). */
const slotOf = (k: PropKind) => Math.ceil((PROP_DEFS[k].w + 0.02) / CELL - 1e-9) * CELL;
/** Side gap (m) kept clear either end of a pocket and the gap between two pockets of one aisle. */
const POCKET_SIDE = 0.5, POCKET_GAP = 1.0;
/** Walkway (m) kept clear beyond a wall pocket's deepest apron. */
const POCKET_WALK = 0.5;

/** Every cell of the hall is free open floor (the rectClear predicate). */
function cellFree(ctx: PlaceCtx, a: Area, cx: number, cy: number): boolean {
  const i = hallCell(ctx, a, cx, cy);
  return i >= 0 && !ctx.g.blocked[i] && !ctx.keep[i] && !ctx.lane[i] && !ctx.plaza[i] && !ctx.zone[i] && !ctx.edge[i] && !ctx.doorCell[i];
}
/** The free runs (along spans, world m) of a band of rows [y0, y1) of the hall: every cell of a run's columns is free. */
export function freeRuns(ctx: PlaceCtx, a: Area, y0: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let x = a.x; x <= a.x + a.w; x++) {
    let free = x < a.x + a.w;
    for (let y = y0; free && y < y1; y++) free = cellFree(ctx, a, x, y);
    if (free && s < 0) s = x;
    else if (!free && s >= 0) { out.push([s * CELL, x * CELL]); s = -1; }
  }
  return out;
}

/** A pocket's wall members, label and front kind (a waiting group on a free-standing band is benchGroup's instead); null: a kiosk past the
 *  holder cap. */
function pocketRecipe(type: PocketType, palette: ReadonlySet<string>, holderRoom: number, cart: boolean): {members: WallMember[]; label: string; kind: HallFront['kind']} | null {
  if (type === 'kiosk') {
    if (holderRoom <= 0) return null;
    const unit: WallMember = cart ? {kind: 'hotdogCart', front: 1.2, purpose: 'hotdog'} : {kind: 'stall', front: 1.2, purpose: 'newsstand'};
    return {members: [unit, ...(palette.has('atmKiosk') ? [{kind: 'atmKiosk' as PropKind, front: 1.0}] : [])], label: cart ? 'COFFEE · SNACKS' : 'NEWS · TOBACCO', kind: 'kiosk'};
  }
  if (type === 'service') {
    const info = palette.has('infoTouchKiosk'), atm = palette.has('atmKiosk');
    const tm: WallMember = {kind: 'ticketMachine', front: 1.0};
    const members = [...(info ? [{kind: 'infoTouchKiosk' as PropKind, front: 1.0}] : []), tm, tm, ...(atm ? [{kind: 'atmKiosk' as PropKind, front: 1.0}] : []), ...(!info && !atm ? [tm] : [])];
    return {members, label: info ? 'INFORMATION' : 'TICKET MACHINES', kind: 'service'};
  }
  return {members: [{kind: 'bench', front: 0.9}, {kind: 'bench', front: 0.9}], label: 'WAITING', kind: 'waiting'};
}

/**
 * The aisle pockets: 2-4 destinations (a kiosk or service point first, a waiting group, then the other two) spread along the hall,
 * each fitted to the free floor of the bands that hold it (every cell-line anchor tested, the nearest to its share of the hall first),
 * one per stretch of an aisle (POCKET_GAP apart: the aisle stays a walkway). A hall whose program could not place a waiting group or a
 * kiosk / service point tries again anywhere it fits (a service point needs only 2 m of wall).
 */
function aislePockets(ctx: PlaceCtx, a: Area, S: HallSection, palette: ReadonlySet<string>, sum: HallV3Summary,
  room: () => number, count: (ps: readonly PropPlacement[] | null) => readonly PropPlacement[] | null): void {
  const rng = ctx.rng;
  const R = rowsOf(a, S);
  const two = S.aisles.length > 1;
  // the bands: both aisle walls; free-standing groups beside each arcade (the nave-facing bench one row inside the aisle, clear of the
  // arcade beam) — or, in the gate-aisle variant, mid-way across its south nave strip
  const wallN: Band = {aisle: 'N', wall: 'N'}, wallS: Band = {aisle: 'S', wall: 'S'};
  const freeN: Band = {aisle: 'N', zm: (R.nave0 - 2) * CELL, naveDir: 1};
  const freeS: Band = two ? {aisle: 'S', zm: (R.nave1 + 2) * CELL, naveDir: -1} : {aisle: 'S', zm: Math.round((R.spine1 + R.y1) / 2) * CELL, naveDir: -1};
  // (the longest free wall run 2 m deep, QA)
  for (const [y0, y1] of [[R.y0, R.y0 + 4], [R.y1 - 4, R.y1]]) for (const [p, q] of freeRuns(ctx, a, y0, y1)) sum.freeRun = Math.max(sum.freeRun, r2(q - p));
  const spans: Record<'N' | 'S', [number, number][]> = {N: [], S: []};
  // (the ticket office and the machine bank beside it hold their stretch of the gate aisle; its queue lanes stay walkway)
  for (const f of frontsWorld(a)) if (f.kind === 'office') { spans.N.push([f.along[0] - 4.4, f.along[1] + 4.4]); keepRing(ctx, a, f.along[0], f.across[0], f.along[1], f.across[1]); }
  const a0 = a.x * CELL, len = a.w * CELL;
  const n = rng.int(2, 4);
  const kioskFirst = room() > 0 && rng.chance(0.55);
  const program: PocketType[] = [kioskFirst ? 'kiosk' : 'service', 'waiting', kioskFirst ? 'service' : 'kiosk', 'waiting'];
  const fracs = rng.shuffle([0.14, 0.38, 0.62, 0.86]);
  const cart = rng.chance(0.35);
  const order: Record<PocketType, Band[][]> = {
    kiosk: [[wallS, wallN]], service: [[wallN, wallS]],
    waiting: [[wallS, freeS, freeN, wallN], [freeN, freeS, wallN, wallS]],
  };
  const placed: Record<PocketType, number> = {kiosk: 0, service: 0, waiting: 0};
  const attempt = (type: PocketType, bands: Band[], target: number, spread: boolean): boolean => {
    const t = type === 'kiosk' && room() <= 0 ? 'service' : type;
    const rec = pocketRecipe(t, palette, room(), cart);
    if (!rec) return false;
    for (const b of bands) {
      const got = 'wall' in b ? wallPocket(ctx, a, b.wall, rec.members, target, spread ? spans[b.aisle] : null)
        : t === 'waiting' ? benchGroup(ctx, a, b.zm, b.naveDir, target, spread ? spans[b.aisle] : null) : null;
      if (!got) continue;
      count(got.props);
      spans[b.aisle].push([got.along[0], got.along[1]]);
      addFront(a, {kind: rec.kind, wall: 'wall' in b ? b.wall : 'nave', along: got.along, across: got.across, label: rec.label}, sum);
      placed[t]++;
      if (t === 'kiosk') sum.pockets.retail++; else sum.pockets[t]++;
      if (t !== 'waiting' && 'wall' in b) pocketPlate(ctx, a, b.wall, got.along, rec.label, sum);
      return true;
    }
    return false;
  };
  for (let k = 0; k < n; k++) {
    const type = program[k];
    attempt(type, order[type][type === 'waiting' ? Math.min(placed.waiting, 1) : 0], a0 + len * fracs[k], true);
  }
  // (never zero where the floor holds one: anywhere it fits)
  const all = [wallS, wallN, freeS, freeN];
  if (!placed.waiting) attempt('waiting', all, a0 + len / 2, false);
  if (!placed.kiosk && !placed.service) attempt('service', all, a0 + len / 2, false);
}

/** A span overlaps none of an aisle's pockets (with POCKET_GAP between). */
const spaced = (spans: readonly [number, number][] | null, s0: number, s1: number) => !spans || spans.every(([p, q]) => s1 + POCKET_GAP <= p || s0 - POCKET_GAP >= q);

/**
 * Members side by side against a wall of the hall (backs to it, facing the hall), in whole-cell slots from a cell-line anchor: the
 * anchor nearest to `target` whose box (the slots + POCKET_SIDE either end, from the wall to the deepest apron + POCKET_WALK) is free
 * floor and whose wall is solid behind it. All or nothing; the box is kept as the pocket's walkway.
 */
function wallPocket(ctx: PlaceCtx, a: Area, side: 'N' | 'S', members: readonly WallMember[], target: number, spans: readonly [number, number][] | null):
  {props: PropPlacement[]; along: [number, number]; across: [number, number]} | null {
  const L = members.reduce((s, m) => s + slotOf(m.kind), 0);
  const depth = Math.max(...members.map(m => PROP_DEFS[m.kind].d + 0.03 + m.front)) + POCKET_WALK;
  const wz = side === 'N' ? a.y * CELL : (a.y + a.h) * CELL;
  const z0 = side === 'N' ? wz : wz - depth, z1 = side === 'N' ? wz + depth : wz;
  const base = a.floorY ?? 0;
  const cands: number[] = [];
  for (let x0 = a.x * CELL + 1; x0 + L <= (a.x + a.w) * CELL - 1 + 1e-6; x0 += CELL) {
    if (!spaced(spans, x0, x0 + L)) continue;
    if (!rectClear(ctx, a, x0 - POCKET_SIDE, z0, x0 + L + POCKET_SIDE, z1)) continue;
    if (!backed(ctx, a, side, x0, x0 + L, base + 0.3)) continue;
    cands.push(x0);
  }
  cands.sort((p, q) => Math.abs(p + L / 2 - target) - Math.abs(q + L / 2 - target) || p - q);
  for (const x0 of cands.slice(0, 6)) {
    begin(ctx);
    const props: PropPlacement[] = [];
    let u = x0;
    for (const m of members) {
      const s = wallSpot(a, side, r3(u + slotOf(m.kind) / 2), m.kind);
      u += slotOf(m.kind);
      const p = tryPlaceProp(ctx, a, m.kind, s.x, s.z, s.rot, {front: m.front, variant: ctx.rng.int(0, 3)});
      if (!p) break;
      if (m.purpose) p.purpose = m.purpose;
      props.push(p);
    }
    if (props.length < members.length) { rollback(ctx); continue; }
    commit(ctx);
    keepRing(ctx, a, x0 - POCKET_SIDE, z0, x0 + L + POCKET_SIDE, z1);
    return {props, along: [r2(x0), r2(x0 + L)], across: [r2(z0), r2(z1)]};
  }
  return null;
}

/**
 * A free-standing waiting group: two benches facing the nave and two behind them facing away, back to back on the meeting line `zm`
 * (a cell line), side by side round a cell-line anchor nearest `target`. Its box keeps 0.45 m on the nave side (the spine / arcade
 * there is walkway already) and 0.9 m elsewhere; between the arcade's columns by construction (columns are blocked cells).
 */
function benchGroup(ctx: PlaceCtx, a: Area, zm: number, naveDir: 1 | -1, target: number, spans: readonly [number, number][] | null):
  {props: PropPlacement[]; along: [number, number]; across: [number, number]} | null {
  const bd = PROP_DEFS.bench.d / 2, bw = PROP_DEFS.bench.w / 2;
  const toNave = naveDir > 0 ? 0 : Math.PI, away = naveDir > 0 ? Math.PI : 0;
  const members: Member[] = [
    {kind: 'bench', dx: -bw, dz: naveDir * bd, rot: toNave}, {kind: 'bench', dx: bw, dz: naveDir * bd, rot: toNave},
    {kind: 'bench', dx: -bw, dz: -naveDir * bd, rot: away}, {kind: 'bench', dx: bw, dz: -naveDir * bd, rot: away},
  ];
  const zN = zm + naveDir * (2 * bd + 0.45), zA = zm - naveDir * (2 * bd + 0.9);
  const z0 = Math.min(zN, zA), z1 = Math.max(zN, zA);
  const cands: number[] = [];
  for (let x = a.x * CELL + 3; x <= (a.x + a.w) * CELL - 3 + 1e-6; x += CELL) {
    if (!spaced(spans, x - 2 * bw, x + 2 * bw)) continue;
    if (rectClear(ctx, a, x - 2 * bw - 0.9, z0, x + 2 * bw + 0.9, z1)) cands.push(x);
  }
  cands.sort((p, q) => Math.abs(p - target) - Math.abs(q - target) || p - q);
  for (const x of cands.slice(0, 6)) {
    const got = group(ctx, a, x, zm, members, {x: 0.9, z0: zm - z0 - 2 * bd, z1: z1 - zm - 2 * bd});
    if (got) return {props: got, along: [r2(x - 2 * bw - 0.3), r2(x + 2 * bw + 0.3)], across: [r2(z0), r2(z1)]};
  }
  return null;
}

/** A kiosk / service pocket's name plate on its wall (floor + 2.75 m, wall-backed, clear of every other plate and prop). */
function pocketPlate(ctx: PlaceCtx, a: Area, side: 'N' | 'S', along: [number, number], text: string, sum: HallV3Summary): void {
  const w = r2(Math.min(along[1] - along[0] - 0.3, 2.6)), y = 2.75, base = a.floorY ?? 0;
  if (w < 1.0) return;
  const {h} = signDims({kind: 'info', w});
  const x = r3((along[0] + along[1]) / 2), z = side === 'N' ? a.y * CELL + 0.02 : (a.y + a.h) * CELL - 0.02;
  if (!backed(ctx, a, side, x - w / 2, x + w / 2, base + y - h / 2) || !wallPlateFree(ctx, a, side, x - w / 2, x + w / 2, y - h / 2, y + h / 2)) return;
  const [zb0, zb1] = side === 'N' ? [z, z + 0.08] : [z - 0.08, z];
  if (!boxClear(ctx, x - w / 2, x + w / 2, y - h / 2, y + h / 2, zb0, zb1) || propBlocksDoorway(ctx.layout, x, (zb0 + zb1) / 2, w / 2, 0.04, base + y - h / 2, h)) return;
  ctx.layout.signs.push({x, y, z: r3(z), rot: side === 'N' ? 0 : Math.PI, kind: 'info', text, area: a.id, w});
  sum.frontSigns++;
}

/** Hung wayfinding plates (at most) per hall, one per waiting group. */
const WAITING_SIGNS = 4;
/** Clear (m) a hung plate keeps from the clock centred on its group (the clock body ~0.45 m round its centre + 0.35). */
const CLOCK_CLEAR = 0.8;

/**
 * Each waiting group's hung wayfinding plate (WAITING_SIGNS at most): parallel to the hall axis at the group's across centre, offset
 * along from its centre (the kit's clock hangs there) towards the nearest gate bank first; under a real ceiling, off the bay lines
 * (+-0.8 m: beams, coves, drums) and the bay centres (+-0.6 m: the light plan's drums / downlights), 1.5 m from every other hung plate,
 * clear of every prop up to the ceiling; its arrow points to the gate bank.
 */
function waitingSigns(ctx: PlaceCtx, a: Area, S: HallSection, sum: HallV3Summary): void {
  const {layout, g} = ctx;
  const doors = ctx.doorsOf.get(a.id) ?? [];
  const gates = doors.filter(d => d.fare).map(d => (d.x + d.w / 2) * CELL);
  const lines = S.lines, centres = baysOf(a, S).map(([p, q]) => (p + q) / 2);
  const nos = [...new Set(layout.areas.filter(q => q.type === 'platform' && q.platformNo).map(q => q.platformNo!))].sort((p, q) => p - q);
  const trains = nos.length >= 2 ? `TRAINS · PLATFORMS ${nos.slice(0, -1).join(', ')} & ${nos[nos.length - 1]}` : 'TRAINS · ALL PLATFORMS';
  const texts = [trains, 'WAITING · ALL PLATFORMS'];
  const w = 2.2, base = a.floorY ?? 0;
  const hung = () => layout.signs.filter(s => s.area === a.id && s.hang);
  const seg = (s: {x: number; z: number; rot: number; w?: number}, k: number) => {
    const hw = (s.w ?? 1.4) / 2, t = -hw + (2 * hw * k) / 6;
    return [s.x + Math.cos(s.rot) * t, s.z - Math.sin(s.rot) * t];
  };
  const far = (x: number, z: number) => hung().every(s => {
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const [ax, az] = seg({x, z, rot: 0, w}, i), [bx, bz] = seg(s, j);
      if (Math.hypot(ax - bx, az - bz) < 1.5) return false;
    }
    return true;
  });
  let n = 0;
  for (const f of frontsWorld(a)) {
    if (f.kind !== 'waiting' || n >= WAITING_SIGNS) continue;
    const cx = (f.along[0] + f.along[1]) / 2, cz = r3((f.across[0] + f.across[1]) / 2);
    const gate = gates.length ? gates.reduce((p, q) => (Math.abs(q - cx) < Math.abs(p - cx) ? q : p)) : cx;
    const dir = gate >= cx ? 1 : -1;
    const y = r2(Math.min(g.ceilAt(cx, cz) - base - 0.75, 3.5));
    for (const off of [CLOCK_CLEAR + w / 2, CLOCK_CLEAR + w / 2 + 0.5, CLOCK_CLEAR + w / 2 + 1.0].flatMap(o => [dir * o, -dir * o])) {
      const x = r3(cx + off), s0 = x - w / 2, s1 = x + w / 2;
      if (lines.some(l => s1 > l - 0.8 && s0 < l + 0.8) || centres.some(c => s1 > c - 0.6 && s0 < c + 0.6)) continue;
      if (hallCell(ctx, a, Math.floor(s0 / CELL), Math.floor(cz / CELL)) < 0 || hallCell(ctx, a, Math.floor(s1 / CELL), Math.floor(cz / CELL)) < 0) continue;
      const top = Math.min(g.ceilAt(s0, cz), g.ceilAt(s1, cz)) - base;
      if (!(top > y + 0.4) || !far(x, cz) || !boxClear(ctx, s0, s1, y - 0.2, top, cz - 0.1, cz + 0.1)) continue;
      if (!hungRoofed(g, x, cz, 0, w, a.ceil)) continue;
      const arrow = Math.abs(gate - x) < 2.5 ? 'up' : gate > x ? 'right' : 'left';
      layout.signs.push({x, y, z: cz, rot: 0, kind: 'info', text: texts[n % texts.length], area: a.id, hang: true, w, arrow});
      sum.waitingSigns++;
      n++;
      break;
    }
  }
}
/** (stationDress hungRoofed's rule, without its refusal counter: the drop rods of a plate end at a real ceiling) */
function hungRoofed(g: Grid, x: number, z: number, rot: number, w: number, ceil: number): boolean {
  const ax = Math.cos(rot) * w * 0.38, az = -Math.sin(rot) * w * 0.38;
  for (const [px, pz] of [[x + ax, z + az], [x - ax, z - az]]) {
    const c = g.ceilAt(px, pz);
    if (c !== Infinity && c > ceil + 0.05) return false;
  }
  return true;
}

type IslandType = 'seating' | 'info' | 'news' | 'food';
/** The front a nave island records. */
const ISLAND_FRONT: Record<IslandType, {kind: HallFront['kind']; label: string}> = {
  seating: {kind: 'waiting', label: 'WAITING'}, info: {kind: 'service', label: 'INFORMATION'},
  news: {kind: 'kiosk', label: 'NEWS · TOBACCO'}, food: {kind: 'kiosk', label: 'COFFEE · SNACKS'},
};

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
      if (got) {
        used.add(bi * 2 + si); sum.islands[kind]++;
        // (its front: the island + its walkway ring)
        const fx0 = Math.min(...got.map(p => p.x - p.hx)) - 1.0, fx1 = Math.max(...got.map(p => p.x + p.hx)) + 1.0;
        const fz0 = Math.min(...got.map(p => p.z - p.hz)) - 1.0, fz1 = Math.max(...got.map(p => p.z + p.hz)) + 1.0;
        addFront(a, {kind: ISLAND_FRONT[kind].kind, wall: 'nave', along: [r2(fx0), r2(fx1)], across: [r2(fz0), r2(fz1)], label: ISLAND_FRONT[kind].label}, sum);
        break;
      }
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
