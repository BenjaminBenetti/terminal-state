// FROZEN GAME77 GENERATOR (task studio-skyways-rework-20261107-054512-01): a verbatim snapshot of gen/skyways/addonConvention.ts at main
// be3173d (GAME77), kept ONLY to regenerate Skyways stations a player entered before the rework (layout versions 1 and 2:
// gen/skyways/layoutVersion.ts) byte-identically, so their saved holders / pickups / kills keep matching. Never edit (except a
// shared runtime bug fix that leaves the layout fingerprints of tests/skyways-dest-layout-version.test.ts unchanged).
// Task studio-skyways-level-20261106-054448 (lane ADDON): the ANIME CONVENTION hall of a Skyways level (addon.id 'convention') —
// dresses the carved hall (gen/skyways/carve.ts carveAddon: the hall on the host's skyway level, its entry from the hub, the support
// strip's green room / washrooms / storage along one end) with the add-on kinds (gen/skyways/addonKinds.ts) and existing booth props:
//  - the STAGE model at real size, back to the wall opposite the entry (centred where the carve put the stage box; the record's
//    `stage` becomes its real footprint), the stage BACKDROP art laced into its truss, a `cheer` mascot statue on its deck;
//  - folding chairs in ROWS facing the stage either side of a centre aisle (the entry -> stage lane);
//  - MERCH TABLE rows in the hall's two side regions (vendor rows facing their aisles) with LOOSE merch on each table's real top —
//    boxed figures, plushes and print cards (the prints sheet) — separate on-host props packed along the top, never overlapping;
//  - the eight POSTERS on solid wall (never over glazing / doors / props), the rest on freestanding poster boards; the three BANNERS
//    hung from the ceiling (>= 2.2 m clear under them, away from light fixtures and the stage); the WELCOME sign beside the entry;
//  - booth props for life: a capsule-toy row, an arcade cabinet or two, a giant teddy (existing kinds);
//  - MASCOT STATUES (static, recorded in addon.convention.statues): `wave` just inside the entrance facing people coming in, `point`
//    turned so its pointing hand (SKYWAYS_MASCOT.poses.point.pointDir) aims at the WASHROOMS door, `cheer` on the stage, `bow` by the
//    merch tables and, when it fits, `stand` in the green room.
// Reserved first (PlaceCtx.keep): 1.5 m in front of every door of the hall and 1.8 m wide lanes from the entry to the stage front
// and to the washroom door. Pure data; the rng is consumed only here.

import {CELL} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {WALL_ROT, areaConnected, backed, markCell, placeAgainstWall, rowAlongWall, wallRange, wallSpot, wallXZ} from '../../placeKit';
import type {Area, Door, Side} from '../../stationTypes';
import {SKYWAYS_MASCOT, type SkywaysMascotPoseName} from '../../../assets/skywaysMascot.generated';
import {SKYWAYS_CON_BANNERS, SKYWAYS_CON_POSTERS, SKYWAYS_CON_PRINTS} from '../../../assets/skywaysArt.generated';
import {SKYWAYS_BANNER_CABLE, SKYWAYS_MASCOT_POSES, SKYWAYS_MERCH_TOP, SKYWAYS_POSTER_Y, SKYWAYS_STAGE, SKYWAYS_STAGE_DECK_D, SKYWAYS_STAGE_MODEL_SHIFT,
  SKYWAYS_STATUE_PLINTH, SKYWAYS_STATUE_POSE} from '../addonKinds';
import {AddonDresser, doorBetween, doorPoint, normYaw, propRect, r3, segDist, toWorld, uvXZ, xzUV, yawToward} from './addonFrame';
import type {SkywaysAddon, SkywaysStatue} from '../skywaysTypes';

/** Clear floor kept in front of every door of the hall (m: >= the 1.2 m rule). */
export const CON_DOOR_CLEAR = 1.5;
/** Half width of the reserved walking lanes (entry -> stage, entry -> washrooms), m. */
export const CON_LANE_HALF = 0.9;
/** Chairs per side of the centre aisle, rows at most; tables at most; merch per table (front row). */
export const CON_CHAIRS = {perSide: 5, rows: 5, pitch: 1.0} as const;
export const CON_TABLES_MAX = 10;
export const CON_MERCH_PER_TABLE: readonly [number, number] = [3, 5];
/** Statue scale over the authored 1.40 m pose (the entrance greeter a little larger). */
export const CON_STATUE_SCALE: Readonly<Record<string, number>> = {'entrance-wave': 1.1};

export type StatueRole = keyof typeof SKYWAYS_STATUE_POSE;

export interface ConventionResult {
  stage: PropPlacement | null;
  steps: PropPlacement | null;
  backdrop: PropPlacement | null;
  chairs: PropPlacement[];
  tables: PropPlacement[];
  /** Loose merch on the tables' tops (boxed figures, plushes, print cards). */
  merch: PropPlacement[];
  posters: PropPlacement[];
  boards: PropPlacement[];
  banners: PropPlacement[];
  welcome: PropPlacement | null;
  /** Existing booth kinds (capsule machines, arcade cabinets, giant teddy). */
  booth: PropPlacement[];
  statues: {role: StatueRole; pose: SkywaysMascotPoseName; scale: number; prop: PropPlacement}[];
  /** The reserved lanes (world segments, half width). */
  lanes: {ax: number; az: number; bx: number; bz: number; half: number; to: 'stage' | 'washrooms'}[];
  washroomDoor: Door | null;
}

const snapC = (v: number) => Math.floor(v / CELL) * CELL + CELL / 2; // a cell centre
const snapB = (v: number) => Math.round(v / CELL) * CELL; // a cell boundary

export function dressConvention(d: AddonDresser): ConventionResult {
  const {layout, fr, hall, rng} = d;
  const conv = d.addon.convention!;
  const res: ConventionResult = {stage: null, steps: null, backdrop: null, chairs: [], tables: [], merch: [], posters: [], boards: [], banners: [], welcome: null, booth: [],
    statues: [], lanes: [], washroomDoor: null};
  const own = d.addon.areas.map(id => layout.areas[id]).filter(Boolean);
  const washroom = own.find(a => a.type === 'washroom');
  const wDoor = washroom ? doorBetween(layout, hall.id, washroom.id) ?? null : null;
  res.washroomDoor = wDoor;

  // --- 0. reserved floor: door strips --------------------------------------------------------------------------------------
  for (const door of layout.doors) if (door.a === hall.id || door.b === hall.id) d.keepDoor(door, hall, CON_DOOR_CLEAR);
  const E = doorPoint(d.entry, hall);
  const ein: [number, number] = [E.x + E.nx * 0.75, E.z + E.nz * 0.75];

  // --- 1. the stage, back to the wall opposite the entry ---------------------------------------------------------------------
  const sc = xzUV(fr, (conv.stage.x0 + conv.stage.x1) / 2, (conv.stage.z0 + conv.stage.z1) / 2);
  const halfW = PROP_DEFS.skywaysConStage.w / 2;
  const us0 = snapB(Math.max(halfW + 0.5, Math.min(fr.W - halfW - 0.5, sc[0])));
  // the deck's front edge on a cell line (its steps' collision box then starts on the next cell): back ~0.25 m off the wall
  const vDeckFront = snapB(fr.D - 0.03 - SKYWAYS_STAGE_DECK_D - 0.24) + 0.001, vDeck = vDeckFront + SKYWAYS_STAGE_DECK_D / 2;
  let us = us0;
  if (fr.W >= 2 * halfW + 0.8 && fr.D >= SKYWAYS_STAGE_DECK_D + 7) {
    for (const du of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3]) {
      const u = us0 + du;
      if (u < halfW + 0.3 || u > fr.W - halfW - 0.3) continue;
      const [x, z] = uvXZ(fr, u, vDeck);
      res.stage = d.put('skywaysConStage', x, z, fr.toFront);
      if (res.stage) { us = u; break; }
    }
  }
  if (!res.stage) d.skipped.push('convention: no room for the stage');
  const stepsD = SKYWAYS_STAGE.steps.z1 - SKYWAYS_STAGE.steps.z0;
  if (res.stage) {
    const st = res.stage;
    // the front steps: a collision-only box (variant 1), drawn by the stage model
    const s = SKYWAYS_STAGE.steps, lx = (s.x0 + s.x1) / 2, lz = (s.z0 + s.z1) / 2 + SKYWAYS_STAGE_MODEL_SHIFT;
    const [x, z] = toWorld(st, lx, lz);
    const q = Math.abs(Math.sin(st.rot)) > 0.7;
    const hx = r3(((q ? stepsD : s.x1 - s.x0)) / 2), hz = r3(((q ? s.x1 - s.x0 : stepsD)) / 2);
    res.steps = boxProp(d, 'skywaysConStage', x, z, hx, hz, s.h, st.rot, 1);
    if (!res.steps) d.skipped.push('convention: stage steps box');
    // the backdrop vinyl in the truss (behind the uprights, in front of the deck's back edge), its bottom just above the deck
    const [bx, bz] = toWorld(st, 0, SKYWAYS_STAGE.trussBackZ - 0.04 + SKYWAYS_STAGE_MODEL_SHIFT);
    const bf = footprint('skywaysConBackdrop', st.rot);
    res.backdrop = d.push({kind: 'skywaysConBackdrop', x: r3(bx), z: r3(bz), y: r3(SKYWAYS_STAGE.deckY + 0.08), rot: st.rot, area: hall.id, hx: r3(bf.hx), hz: r3(bf.hz),
      h: PROP_DEFS.skywaysConBackdrop.h, blocksSight: false, variant: 0, mounted: true, host: layout.props.indexOf(st)});
    // the cheer statue on the deck's front corner away from the steps, turned a little toward the hall's middle
    const [cx, cz] = toWorld(st, -(halfW - 1.1), SKYWAYS_STAGE.deckZ1 + SKYWAYS_STAGE_MODEL_SHIFT - 0.75);
    const [tx, tz] = uvXZ(fr, us, 0); // looking out over the audience toward the entry wall
    const sp = statueOn(d, st, 'stage-cheer', cx, cz, yawToward(tx - cx, tz - cz));
    if (sp) res.statues.push(sp); else d.skipped.push('convention: stage statue');
    conv.stage = unionRect(propRect(st), res.steps ? propRect(res.steps) : propRect(st));
  }

  // --- 2. lanes: entry -> the centre aisle -> the stage front; entry -> the washrooms ------------------------------------------
  const vFirst = vDeckFront - stepsD - 1.25; // first row of chairs
  const vMin = 3.4;
  const nRows = Math.max(0, Math.min(CON_CHAIRS.rows, Math.floor((vFirst - vMin) / CON_CHAIRS.pitch) + 1));
  const vLast = vFirst - (nRows - 1) * CON_CHAIRS.pitch;
  const A = uvXZ(fr, us, Math.max(1.6, vLast - 1.4)), S = uvXZ(fr, us, vDeckFront - stepsD - 0.35);
  lane(d, res, ein, A, 'stage'); lane(d, res, A, S, 'stage');
  let wIn: [number, number] | null = null;
  if (wDoor) {
    const W = doorPoint(wDoor, hall);
    wIn = [W.x + W.nx * 0.8, W.z + W.nz * 0.8];
    lane(d, res, ein, wIn, 'washrooms');
  }

  // --- 3. audience rows facing the stage ------------------------------------------------------------------------------------
  if (res.stage) {
    for (let r = 0; r < nRows; r++) {
      const v = vFirst - r * CON_CHAIRS.pitch;
      for (const side of [-1, 1]) for (let k = 0; k < CON_CHAIRS.perSide; k++) {
        if (rng.chance(0.08)) continue; // a missing chair now and then
        const u = us + side * (1.2 + k * 0.5);
        const [x0, z0] = uvXZ(fr, u, v);
        const turned = rng.chance(0.07) ? (rng.chance(0.5) ? 1 : -1) * Math.PI / 2 : 0;
        const p = d.put('foldingChair', snapC(x0), snapC(z0), normYaw(fr.toBack + turned));
        if (p) res.chairs.push(p);
      }
    }
  }

  // --- 4. merch table rows in the two side regions (+ the loose merch on their tops) --------------------------------------------
  const blockHalf = halfW + 1.2;
  const regions = [{e: 0, s: 1, w: us - blockHalf}, {e: fr.W, s: -1, w: fr.W - (us + blockHalf)}].filter(q => q.w >= 2.6);
  type Slot = {x: number; z: number; rot: number};
  const slots: Slot[][] = [];
  for (const q of rng.shuffle(regions.slice())) {
    for (let k = 0; ; k++) {
      const off = 1.0 + k * 3.5; // a cell boundary from the end wall (a 0.5 m vendor gap behind the first row)
      if (off + 0.52 + 1.0 > q.w) break;
      const u = q.e + q.s * off;
      const facesIn = k % 2 === 0;
      const rot = (q.s > 0) === facesIn ? fr.plusU : fr.minusU;
      const row: Slot[] = [];
      for (let v = 2.6; v + 1.05 <= fr.D - 0.8; v += 2.6) {
        const [x, z] = uvXZ(fr, u, v);
        row.push({x: snapB(x), z: snapB(z), rot});
      }
      slots.push(row);
    }
  }
  for (const row of slots) {
    for (const s of row) {
      if (res.tables.length >= CON_TABLES_MAX) break;
      if (rng.chance(0.2)) continue; // a gap in the row
      const t = d.put('skywaysConMerchTable', s.x, s.z, s.rot, {front: 0.9});
      if (!t) continue;
      res.tables.push(t);
      res.merch.push(...merchOn(d, t));
    }
  }
  if (!res.tables.length) d.skipped.push('convention: no merch table fitted');

  // --- 5. statues: the greeter at the entrance, the washroom pointer, the bowing vendor, the green-room stand -----------------
  {
    const tx = -E.nz, tz = E.nx; // along the entry wall
    const wSide = wIn ? Math.sign((wIn[0] - E.x) * tx + (wIn[1] - E.z) * tz) || 1 : 1;
    let done = false;
    // (layout-variety pass: the entry may sit near a corner or a support door now — a few more spots, still at the entrance)
    for (const side of [-wSide, wSide]) for (const lat of [E.half + 1.2, E.half + 1.8, E.half + 2.5, E.half + 3.2, E.half + 4.0, E.half + 5.0, E.half + 6.0]) for (const dv of [1.3, 1.9, 2.6, 3.4, 4.2]) {
      if (done) break;
      const x = E.x + E.nx * dv + tx * lat * side, z = E.z + E.nz * dv + tz * lat * side;
      const p = statueAt(d, 'entrance-wave', x, z, yawToward(E.x - x, E.z - z));
      if (p) { res.statues.push(p); done = true; }
    }
    // else anywhere on arcs 2.5-8 m in from the entry (still greeting it): an off-centre entry near a corner / a support door
    for (let r = 2.5; r <= 8 && !done; r += 0.75) for (let k = 0; k <= 12 && !done; k++) {
      const a = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 14);
      const c = Math.cos(a), sn = Math.sin(a);
      const dx = E.nx * c - E.nz * sn, dz = E.nz * c + E.nx * sn;
      const x = E.x + dx * r, z = E.z + dz * r;
      const p = statueAt(d, 'entrance-wave', x, z, yawToward(E.x - x, E.z - z));
      if (p) { res.statues.push(p); done = true; }
    }
    if (!done) d.skipped.push('convention: entrance statue');
  }
  if (wDoor && wIn) {
    const W = doorPoint(wDoor, hall), dir = SKYWAYS_MASCOT.poses.point.pointDir;
    const px = -(wIn[1] - ein[1]), pz = wIn[0] - ein[0], pl = Math.hypot(px, pz) || 1;
    let done = false;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2]) for (const off of [1.6, -1.6, 2.3, -2.3, 3.0, -3.0]) {
      if (done) break;
      const x = ein[0] + (wIn[0] - ein[0]) * t + (px / pl) * off, z = ein[1] + (wIn[1] - ein[1]) * t + (pz / pl) * off;
      if (Math.hypot(W.x - x, W.z - z) < 3.2) continue;
      // turn the statue so the pointing hand's direction (model frame) lands on the door
      const yaw = yawToward(W.x - x, W.z - z) - Math.atan2(dir[0], dir[1]);
      const p = statueAt(d, 'washroom-point', x, z, yaw);
      if (p) { res.statues.push(p); done = true; }
    }
    if (!done) d.skipped.push('convention: washroom statue');
  } else d.skipped.push('convention: no washroom door');
  {
    let done = false;
    for (const t of rng.shuffle(res.tables.slice())) {
      for (const end of rng.shuffle([-1, 1])) {
        if (done) break;
        const [x, z] = toWorld(t, end * (PROP_DEFS.skywaysConMerchTable.w / 2 + 0.75), 0.35);
        const p = statueAt(d, 'merch-bow', x, z, t.rot + end * 0.35);
        if (p) { res.statues.push(p); done = true; }
      }
      if (done) break;
    }
    if (!done) d.skipped.push('convention: merch statue');
  }
  {
    // the green room's `stand` (optional: the event storage when the green room is full)
    for (const room of [own.find(a => a.type === 'crew-room'), own.find(a => a.type === 'storage')]) {
      const door = room ? doorBetween(layout, hall.id, room.id) : undefined;
      const p = room && door ? greenRoomStatue(d, room, door) : null;
      if (p) { res.statues.push(p); break; }
    }
  }

  // --- 6. the welcome sign beside the entry lane, facing the entrance -------------------------------------------------------
  {
    const tx = -E.nz, tz = E.nx;
    const waveAt = res.statues.find(s => s.role === 'entrance-wave')?.prop;
    const wSide = waveAt ? Math.sign((waveAt.x - E.x) * tx + (waveAt.z - E.z) * tz) || 1 : 1;
    for (const side of [-wSide, wSide]) for (const dv of [3.4, 4.2, 2.8, 5.0]) for (const lat of [E.half + 0.7, E.half + 1.4, E.half + 2.2]) {
      if (res.welcome) break;
      const x = E.x + E.nx * dv + tx * lat * side, z = E.z + E.nz * dv + tz * lat * side;
      res.welcome = d.put('skywaysConWelcome', x, z, fr.toFront, {front: 0.6});
    }
    // else on arcs 2.8-8 m in from the entry (an off-centre entry: still at the entrance, facing it)
    for (let r = 2.8; r <= 8 && !res.welcome; r += 0.8) for (let k = 0; k <= 12 && !res.welcome; k++) {
      const a = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 14);
      const c = Math.cos(a), sn = Math.sin(a);
      const x = E.x + (E.nx * c - E.nz * sn) * r, z = E.z + (E.nz * c + E.nx * sn) * r;
      res.welcome = d.put('skywaysConWelcome', x, z, fr.toFront, {front: 0.6});
    }
    if (!res.welcome) d.skipped.push('convention: welcome sign');
  }

  // --- 7. booth props: a capsule-toy row, an arcade cabinet or two, a giant teddy ----------------------------------------------
  {
    const sides: Side[] = [fr.front, fr.back, ...(['N', 'S', 'E', 'W'] as Side[]).filter(s => s !== fr.front && s !== fr.back)];
    const n0 = layout.props.length;
    const want = rng.int(2, 3);
    for (const side of rng.shuffle(sides.slice())) {
      const [lo, hi] = wallRange(hall, side);
      if (hi - lo < 4) continue;
      const from = lo + rng.range(0.5, Math.max(0.6, hi - lo - 3.5));
      const row = rowAlongWall(d.ctx, hall, side, 'capsuleToyMachine', {from, to: from + 3.2, max: want, front: 0.9});
      if (row.length >= 2) break;
    }
    for (let i = 0, n = rng.int(1, 2); i < n; i++) placeAgainstWall(d.ctx, hall, 'arcadeCabinet', {front: 1.0, tries: 20});
    placeAgainstWall(d.ctx, hall, 'giantTeddy', {front: 0.6, tries: 20});
    for (let k = n0; k < layout.props.length; k++) { res.booth.push(layout.props[k]); d.placed.push(layout.props[k]); }
  }

  // --- 8. posters: solid wall first (never over glazing / doors / props), then freestanding boards ----------------------------
  {
    const order = rng.shuffle(SKYWAYS_CON_POSTERS.map((_, i) => i));
    const wall = posterSlots(d, rng);
    let i = 0;
    for (const s of wall) {
      if (i >= order.length) break;
      const p = d.push({kind: 'skywaysConPoster', x: s.x, z: s.z, y: SKYWAYS_POSTER_Y, rot: WALL_ROT[s.side], area: hall.id, hx: s.hx, hz: s.hz, h: PROP_DEFS.skywaysConPoster.h,
        blocksSight: false, variant: order[i++], mounted: true});
      res.posters.push(p);
    }
    for (; i < order.length; i++) {
      let p: PropPlacement | null = null;
      for (let t = 0; t < 40 && !p; t++) {
        const side = rng.pick(['N', 'S', 'E', 'W'] as Side[]);
        const [lo, hi] = wallRange(hall, side);
        const s = wallSpot(hall, side, Math.round(rng.range(lo + 0.8, hi - 0.8) * 2) / 2 + 0.25, 'skywaysConPosterBoard');
        p = d.put('skywaysConPosterBoard', s.x, s.z, s.rot, {front: 0.9, variant: order[i]});
      }
      if (p) res.boards.push(p); else d.skipped.push(`convention: poster ${SKYWAYS_CON_POSTERS[order[i]]}`);
    }
  }

  // --- 9. banners hung from the ceiling ---------------------------------------------------------------------------------------
  {
    const spots: [number, number][] = rng.shuffle([[us - 6.5, fr.D - 3.6], [us + 6.5, fr.D - 3.6], [us, Math.max(2.4, vLast - 1.6)], [us - 6.5, fr.D * 0.42], [us + 6.5, fr.D * 0.42],
      [us - 3.2, 2.6], [us + 3.2, 2.6], [us - 9.5, fr.D * 0.6], [us + 9.5, fr.D * 0.6]]);
    for (const [u, v] of spots) {
      if (res.banners.length >= SKYWAYS_CON_BANNERS.length) break;
      const p = hangBanner(d, res, u, v, res.banners.length);
      if (p) res.banners.push(p);
    }
    if (res.banners.length < SKYWAYS_CON_BANNERS.length) d.skipped.push(`convention: ${res.banners.length} banners hung`);
  }
  return res;
}

/** The statue records (absolute feet heights: call after the dresser lifted the props). */
export function conventionStatues(res: ConventionResult, level: number): SkywaysStatue[] {
  return res.statues.map(s => ({pose: s.pose, x: s.prop.x, y: r3(s.prop.y + SKYWAYS_STATUE_PLINTH.h), z: s.prop.z, yaw: s.prop.rot, level, scale: s.scale, role: s.role}));
}

// ---------------------------------------------------------------------------------------------

function lane(d: AddonDresser, res: ConventionResult, a: readonly [number, number], b: readonly [number, number], to: 'stage' | 'washrooms'): void {
  d.keepSegment(a[0], a[1], b[0], b[1], CON_LANE_HALF);
  res.lanes.push({ax: r3(a[0]), az: r3(a[1]), bx: r3(b[0]), bz: r3(b[1]), half: CON_LANE_HALF, to});
}

const unionRect = (a: {x0: number; z0: number; x1: number; z1: number}, b: {x0: number; z0: number; x1: number; z1: number}) =>
  ({x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1)});

/** A collision box of its own size (cells free floor of the hall, not reserved; the hall stays connected). */
function boxProp(d: AddonDresser, kind: PropKind, x: number, z: number, hx: number, hz: number, h: number, rot: number, variant: number): PropPlacement | null {
  const g = d.g, cells: number[] = [];
  for (let cy = Math.floor((z - hz + 0.04) / CELL); cy <= Math.floor((z + hz - 0.04) / CELL); cy++) for (let cx = Math.floor((x - hx + 0.04) / CELL); cx <= Math.floor((x + hx - 0.04) / CELL); cx++) {
    if (!d.freeAt((cx + 0.5) * CELL, (cy + 0.5) * CELL)) return null;
    cells.push(g.idx(cx, cy));
  }
  for (const i of cells) markCell(d.ctx, g.blocked, i);
  if (!areaConnected(d.ctx, d.hall)) { for (const i of cells) g.blocked[i] = 0; return null; }
  return d.push({kind, x: r3(x), z: r3(z), y: 0, rot: r3(rot), area: d.hall.id, hx, hz, h, blocksSight: false, variant});
}

function statueProp(p: PropPlacement, role: StatueRole): {role: StatueRole; pose: SkywaysMascotPoseName; scale: number; prop: PropPlacement} {
  const pose = SKYWAYS_STATUE_POSE[role], scale = CON_STATUE_SCALE[role] ?? 1;
  p.variant = SKYWAYS_MASCOT_POSES.indexOf(pose);
  p.h = r3(SKYWAYS_STATUE_PLINTH.h + SKYWAYS_MASCOT.poses[pose].h * scale);
  p.blocksSight = false;
  return {role, pose, scale, prop: p};
}
/** A floor statue (round plinth collider, any yaw). */
function statueAt(d: AddonDresser, role: StatueRole, x: number, z: number, yaw: number, area?: Area) {
  const p = d.putRound('skywaysMascotStatue', snapC(x), snapC(z), yaw, area ? {area} : {});
  return p ? statueProp(p, role) : null;
}
/** A statue standing on a host's top (the stage deck). */
function statueOn(d: AddonDresser, host: PropPlacement, role: StatueRole, x: number, z: number, yaw: number) {
  const r = SKYWAYS_STATUE_PLINTH.r;
  const p = d.push({kind: 'skywaysMascotStatue', x: r3(x), z: r3(z), y: r3(host.y + host.h), rot: r3(normYaw(yaw)), area: host.area, hx: r, hz: r, h: 0, blocksSight: false, variant: 0,
    round: true, host: d.layout.props.indexOf(host)});
  return statueProp(p, role);
}

/**
 * A back room's statue: free floor 0.45 m clear of every prop there, never in front of one (its 0.9 m access strip: fridge / locker
 * doors, seats) nor near the door, facing the door; the room stays connected (tryPlaceProp).
 */
function greenRoomStatue(d: AddonDresser, room: Area, door: Door) {
  const r = SKYWAYS_STATUE_PLINTH.r, dp = doorPoint(door, room), props = d.layout.props.filter(p => p.area === room.id && p.host === undefined && p.h > 0);
  const near = (p: PropPlacement, x: number, z: number) => {
    if (Math.abs(p.x - x) < p.hx + r + 0.45 && Math.abs(p.z - z) < p.hz + r + 0.45) return true;
    // its front strip (front +Z turned by its yaw), 0.9 m deep over its width
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot)), q = Math.abs(fx) > 0;
    const sx = p.x + fx * (p.hx + 0.45), sz = p.z + fz * (p.hz + 0.45), shx = q ? 0.45 : p.hx, shz = q ? p.hz : 0.45;
    return Math.abs(sx - x) < shx + r && Math.abs(sz - z) < shz + r;
  };
  const cells: [number, number][] = [];
  for (let y = room.y + 2; y < room.y + room.h - 2; y++) for (let x = room.x + 2; x < room.x + room.w - 2; x++) cells.push([x, y]);
  for (const [cx, cy] of d.rng.shuffle(cells).slice(0, 80)) {
    const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
    if (Math.hypot(x - dp.x, z - dp.z) < 2.2) continue;
    if (props.some(p => near(p, x, z))) continue;
    const s = statueAt(d, 'green-room-stand', x, z, yawToward(dp.x - x, dp.z - z), room);
    if (s) return s;
  }
  return null;
}

/** Loose merch packed along a table's top: a front row (figure boxes in runs, plushes, print cards) and a few boxes behind. */
function merchOn(d: AddonDresser, t: PropPlacement): PropPlacement[] {
  const rng = d.rng, out: PropPlacement[] = [], top = SKYWAYS_MERCH_TOP;
  const want = rng.int(CON_MERCH_PER_TABLE[0], CON_MERCH_PER_TABLE[1]);
  let x = -top.x + 0.06 + rng.range(0, 0.12);
  const put = (kind: PropKind, lx: number, lz: number, variant = 0) => {
    const def = PROP_DEFS[kind];
    if (Math.abs(lx) + def.w / 2 > top.x - 0.02 || Math.abs(lz) + def.d / 2 > top.z - 0.02) return null;
    const p = d.onTop(t, kind, r3(lx), r3(lz), top.y);
    if (p) { p.variant = variant; out.push(p); }
    return p;
  };
  while (out.length < want) {
    const kind = rng.weighted<PropKind>([['skywaysConFigureBox', 0.45], ['skywaysConPlush', 0.3], ['skywaysConPrintCard', 0.25]]);
    const n = kind === 'skywaysConFigureBox' ? rng.int(1, 3) : 1;
    const w = PROP_DEFS[kind].w;
    if (x + n * (w + 0.03) > top.x - 0.04) break;
    for (let k = 0; k < n && out.length < want; k++) {
      const lz = kind === 'skywaysConPlush' ? 0.1 : kind === 'skywaysConPrintCard' ? 0.2 : 0.16;
      put(kind, x + w / 2, lz, kind === 'skywaysConPrintCard' ? rng.int(0, SKYWAYS_CON_PRINTS.length - 1) : 0);
      x += w + 0.03;
    }
    x += rng.range(0.06, 0.2);
  }
  // a back row of boxed figures (stock behind the display)
  for (let k = 0, n = rng.int(0, 2), bx = -top.x + 0.12 + rng.range(0, 0.6); k < n; k++, bx += 0.2) put('skywaysConFigureBox', bx, -0.22);
  return out;
}

interface WallSlot { side: Side; t: number; x: number; z: number; hx: number; hz: number }
/** Solid-wall poster slots of the hall (never over glazing, a door or a prop in front), spread out. */
function posterSlots(d: AddonDresser, rng: AddonDresser['rng']): WallSlot[] {
  const {hall, layout, base} = d, def = PROP_DEFS.skywaysConPoster, y0 = SKYWAYS_POSTER_Y, y1 = y0 + def.h;
  const wins = (layout.skyways?.windows ?? []).filter(w => w.level === d.level);
  const props = layout.props.filter(p => (p.level ?? 0) === d.level);
  const cands: WallSlot[] = [];
  for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
    const [lo, hi] = wallRange(hall, side);
    for (let t = lo + 0.75; t <= hi - 0.75; t += 0.5) {
      if (!backed(d.ctx, hall, side, t - def.w / 2, t + def.w / 2, base + y0 + 0.05) || !backed(d.ctx, hall, side, t - def.w / 2, t + def.w / 2, base + y1 - 0.05)) continue;
      // the wall strip behind the poster (one cell thick) must not hold glazing at the poster's height
      const [wx, wz] = wallXZ(hall, side, t, -CELL / 2);
      const along = side === 'N' || side === 'S';
      const sx0 = along ? t - def.w / 2 : wx - CELL / 2, sx1 = along ? t + def.w / 2 : wx + CELL / 2, sz0 = along ? wz - CELL / 2 : t - def.w / 2, sz1 = along ? wz + CELL / 2 : t + def.w / 2;
      if (wins.some(w => w.x0 < sx1 + 0.05 && w.x1 > sx0 - 0.05 && w.z0 < sz1 + 0.05 && w.z1 > sz0 - 0.05 && w.sill < y1 + 0.1 && w.head > y0 - 0.1)) continue;
      // nothing standing in front of it (0.8 m), no other wall piece within 0.3 m
      const [fx, fz] = wallXZ(hall, side, t, 0.4);
      const fhx = along ? def.w / 2 + 0.3 : 0.4, fhz = along ? 0.4 : def.w / 2 + 0.3;
      if (props.some(p => Math.abs(p.x - fx) < p.hx + fhx && Math.abs(p.z - fz) < p.hz + fhz)) continue;
      const [x, z] = wallXZ(hall, side, t, def.d / 2 + 0.004);
      const {hx, hz} = footprint('skywaysConPoster', WALL_ROT[side]);
      cands.push({side, t, x: r3(x), z: r3(z), hx: r3(hx), hz: r3(hz)});
    }
  }
  const out: WallSlot[] = [];
  for (const c of rng.shuffle(cands)) if (out.every(o => o.side !== c.side || Math.abs(o.t - c.t) >= 1.8)) out.push(c);
  return out;
}

/** A banner hung from the ceiling at (u, v): >= 2.2 m clear under it, off the stage, away from fixtures and other banners. */
function hangBanner(d: AddonDresser, res: ConventionResult, u: number, v: number, k: number): PropPlacement | null {
  const {fr, hall, layout} = d, def = PROP_DEFS.skywaysConBanner;
  if (u < 1.0 || u > fr.W - 1.0 || v < 1.2 || v > fr.D - 1.0) return null;
  const [x, z] = uvXZ(fr, u, v);
  const {hx, hz} = footprint('skywaysConBanner', fr.toFront);
  if (res.stage) { const s = propRect(res.stage); if (x > s.x0 - 1.2 && x < s.x1 + 1.2 && z > s.z0 - 1.2 && z < s.z1 + 1.2) return null; }
  let ceil = Infinity;
  for (const [px, pz] of [[x - hx, z - hz], [x + hx, z - hz], [x - hx, z + hz], [x + hx, z + hz], [x, z]]) {
    const [cx, cy] = d.g.cellOf(px, pz);
    if (!d.g.inBounds(cx, cy) || d.g.area[d.g.idx(cx, cy)] !== hall.id) return null;
    ceil = Math.min(ceil, d.g.ceilAt(px, pz));
  }
  const y = Math.round((Math.min(ceil, hall.ceil) - d.base - def.h - 0.02) * 100) / 100;
  if (!Number.isFinite(y) || y < 2.2) return null;
  for (const l of layout.lights) if ((l.level ?? 0) === d.level && l.area === hall.id && Math.hypot(l.x - x, l.z - z) < 1.2) return null;
  if (res.banners.some(b => Math.hypot(b.x - x, b.z - z) < 3.0)) return null;
  // nothing of the hall's own furniture reaches up into it (local frame: the props placed here are not lifted yet)
  if (d.placed.some(p => !p.mounted && Math.abs(p.x - x) < p.hx + hx && Math.abs(p.z - z) < p.hz + hz && p.y + p.h > y - 0.1)) return null;
  void SKYWAYS_BANNER_CABLE;
  return d.push({kind: 'skywaysConBanner', x: r3(x), z: r3(z), y, rot: r3(fr.toFront), area: hall.id, hx: r3(hx), hz: r3(hz), h: def.h, blocksSight: false, variant: k, mounted: true});
}

/** Lanes kept clear: is (x, z) on one of them (QA / tests)? */
export function onLane(res: Pick<ConventionResult, 'lanes'>, x: number, z: number, pad = 0): boolean {
  return res.lanes.some(l => segDist(x, z, l.ax, l.az, l.bx, l.bz) <= l.half + pad);
}

export type {SkywaysAddon};
