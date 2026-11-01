// Task studio-alpha-track2-round2-20261031-01 (lane CACHE, item R5): SURVIVOR CACHES deeper in the service annexes. User (round 2
// playtest): "there's not enough of a reason to go to this place, there should be some "cache" rooms that spawn deeper in, a room like
// a survivor had been living there you know."
// Task studio-alpha-track2-round3-20261031-01 (lane HIDEOUT). User (round 3): "There must always be 1 cache room generated at least." /
// "additional graffite clues in the area should guid the player to the hideout / cache. The cache should include pops like bed roll,
// lantern and stuff, to make it feel like someone lives there. it should have substantial detail applied and contain substantial loot.
// perhaps a boosted chance of gear spawning. it needs to be a good pay off for navigating the confusing maze of rooms."
//
// placeAnnexCaches runs LAST in gen/annexContent.ts populateExtensions (after the dressing, the loot keys, lights, floor finds, vents
// and service spawns), per annex on its own fork (`track-ext-content` -> `cache:<annexId>`), and only APPENDS props (+ one light-field
// source per lantern and the hideout's gear pickup): every core record and every earlier annex record (props, holder indices + loot,
// pickups, spawns; lights but the cache room's own fixture) is unchanged; their cells (holder access strips / stand points, wall mounts,
// floor finds, spawn points) are kept clear. gen/annexMarks.ts then paints the survivor's trail to it (layout.extensions.cacheMarks).
//
// WHERE — "deep" from the annex's own door-hop topology (Area.depth = door hops from the annex entry, as pickOver's supply bands):
//  - (round 3) the LAYOUT lane's guaranteed deep hideout room `ServiceAnnex.hideout` (an area id) FIRST when the layout carries one;
//  - else the deep THIRD of the annex's depth range (band 2 of dMin..dMax, the formula pickOver / the service spawns use);
//  - a ROOM (never a closet: too small to live in; never a service corridor), never a machinery HALL, never a SIGNATURE room
//    (boiler / generator / sewage / overflow / spillway / turbine / ventilation: their machinery stays as it is), never an entry
//    room (depth <= dMin + 1: the entry corridor and the room at its end), at least ANNEX_CACHE.room.minShort x minM2;
//  - a seeded weighted pick: dead ends first (one door x3, two doors x1.5), deeper first (+1 per hop past the tier's shallowest
//    candidate), room to live in (free floor after the room's own props: x0.2 .. x2), the room holding the annex stash x0.5 (spread
//    the finds); a room whose cache does not fit is dropped and the next drawn, at most `roomTries` rooms per tier;
//  - ONE cache per annex; a SECOND only in a large annex (areaM2 >= twoM2), deep band only, never door-adjacent to the first;
//  - THE GUARANTEE (round 3: "There must always be 1 cache room generated at least") — a fallback LADDER, each rung only when every
//    rung above placed nothing: the middle band, any eligible room past the entry, then RELAXED (any room / closet / hall / signature
//    room past the entry corridor of >= relaxed.minShort x minM2, a lighter set-up: a bedroll and >= 1 holder), then LAST (every annex
//    area, deepest first, the bedroll alone suffices). Measured: zero annexes without a cache over 200 Subway + 40 Office + 20 Mall
//    levels (tests/annex-hideout.test.ts, opt-in HIDEOUT_SAMPLE=1).
// WHAT — one room set up as somewhere a survivor LIVES (existing kinds + local procedural kinds; no new asset files):
//  - a SLEEPING SPOT: a palletBed or a floor bedroll (seeded, ~half each; relaxed rungs: the bedroll first), against a door-free wall
//    first, a 0.6 m bedside strip kept clear; a SECOND bedroll in a roomy cache (two people lived here);
//  - their STORAGE (>= 2 holders, else the room is rolled back): a wooden FOOTLOCKER at the foot of the bed, an open shelf (pantry), a
//    tall (else low) cabinet (kit), a crate (supply crate) — loot key items/lootTables.ts ANNEX_CACHE_KEY (exact per-container tables,
//    never empty; ammo only in the crate and the footlocker);
//  - a CAMP TABLE (a door on cinder blocks) with the LANTERN and the CAMP STOVE standing on it (separate loose props, `host`), else the
//    lantern on the floor at the bed's head; the lantern is a warm light-field source (a `virtual` light record at the lantern: the
//    existing baked light field, no new light system) — and the room's first ceiling fixture still burns steadily, warm and low;
//  - up to 2 CAMP THINGS: existing iteration-07 kinds the level already loads (no extra model download) and whose own placement spec
//    allows the room's purpose (folding / stacking chair first, then work light, generator, trash bags, water cooler, IV pole, drum fan,
//    mop bucket) — separate props, never baked;
//  - the GEAR PIECE (the annex's first cache): with ANNEX_CACHE_GEAR.chance one piece of rare gear from the level's gear pool (+ the gas
//    mask with its seeded filter) lies at the bedside — a layout pickup tagged `reward: ANNEX_CACHE_GEAR_KEY`, rolled on its own fork.
// Placement uses the dresser's own primitives (placeKit tryPlaceProp: door zones / door cells, access strips, room connectivity;
// propBlocksDoorway for the doorway clear volumes; strictWallOk in the mall), every wall spot of a room enumerated in seeded order,
// through the room-storage pass's annex-window context (no second full-grid context).

import type {Rng} from '../core/rng';
import {CELL, FLOOR} from './grid';
import {
  areaBase, begin, cellsOfBox, commit, doorSide, makePlaceCtx, markCell, propBlocksDoorway, rollback, strictWallOk, tryPlaceProp, wallRange, wallSpot,
  type PlaceCtx,
} from './placeKit';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from './props';
import {isP7Kind, p7Spec} from './props07';
import {p7AreaKey} from './props07Dress';
import {SIGNATURE_OF_PURPOSE} from './annexRooms';
import type {ServiceAnnex} from './trackExt/types';
import type {Area, LightPlacement, PickupPlacement, Side, StationLayout} from './stationTypes';
import {ANNEX_CACHE_GEAR, ANNEX_CACHE_GEAR_KEY, ANNEX_CACHE_KEY, ANNEX_STASH_KEY, annexCacheGearRows, type LootProfile} from '../items/lootTables';
import {isLootHolderKind} from '../items/loot';
import {FILTER_LIFE_S, isGearItem} from '../items/gear';
import {GAS_MASK_ID, MASK_LOOT} from './maskLoot';

/** THE survivor-cache config (one exported block; docs/track-extensions.md "Survivor caches"). */
export const ANNEX_CACHE = {
  /** One cache per annex; two when the annex has at least `twoM2` m² of floor (the second deep only, never next door to the first). */
  twoM2: 2000,
  /** Room minimum: short side (m) and floor area (m²) — a bed, two pieces of storage and the walkway between them. */
  room: {minShort: 3, minM2: 10.5},
  /**
   * (round 3) The guarantee's RELAXED rung: any room / closet / hall / signature room past the entry corridor with at least this short
   * side / floor (a bedroll along a wall + its strip), up to `tries` rooms; then the LAST rung: every annex area, deepest first.
   */
  relaxed: {minShort: 1.5, minM2: 4, tries: 16, minHolders: 1},
  /**
   * Selection weights (see the header): door count, hops past the tier's shallowest candidate, free floor (m² after the room's own
   * floor props: (free - freeMid) / freeMid clamped to [freeMin, freeMax]), the stash room.
   */
  weight: {deadEnd: 3, twoDoors: 1.5, perHop: 1, freeMid: 9, freeMin: 0.2, freeMax: 2, stash: 0.5},
  /** Rooms tried per tier before the next tier (bounds the work when a tier's rooms are all full of shelving). */
  roomTries: 5,
  /** (round 3) The sleeping spot: a pallet bed with this chance, else a floor bedroll (relaxed rungs: the bedroll first). */
  beds: ['palletBed', 'bedroll'] as readonly PropKind[],
  palletBedChance: 0.45,
  /** (round 3) A second sleeper's bedroll in a roomy cache: at least `m2` of free floor, with `chance`. */
  secondBed: {m2: 20, chance: 0.4},
  /** The rest spot of round 2 (kept for reference: the pallet bed). */
  bed: 'palletBed' as PropKind,
  /**
   * Storage roles in placement order (each: kinds tried in order): (round 3) the footlocker at the foot of the bed, the pantry shelf,
   * the kit cabinet, the supply crate.
   */
  storage: [['footlocker'], ['shelf'], ['cabinetTall', 'cabinetLow'], ['crate']] as readonly (readonly PropKind[])[],
  /** A cache needs its bed and at least this many storage holders (else the room is rolled back and the next one tried). */
  minHolders: 2,
  /** (round 3) The camp table and what stands on it (local frame of the table: x along it, z toward its front; on its top). */
  table: 'campTable' as PropKind,
  onTable: [['campLantern', 0.43, -0.06], ['campStove', -0.36, -0.03]] as readonly (readonly [PropKind, number, number])[],
  /** (round 3) The lantern's light: a warm light-field source `lift` m over the lantern's base, at `power` (reach ~max(4, 9 sqrt p) m). */
  lantern: {kind: 'campLantern' as PropKind, power: 0.7, lift: 0.2},
  /** Camp things (existing iteration-07 kinds; only those the level loads and whose spec allows the room's purpose), chairs first. */
  decor: ['foldingChair', 'plasticStackChair', 'tripodWorkLight', 'portableGenerator', 'trashBagPile', 'waterCooler', 'privacyScreen', 'ivPole', 'drumFan', 'mopBucketWringer'] as readonly string[],
  decorMax: 2,
  /** Clear strip (m) kept in front of the room's existing floor props (their stand points / door swings / drawer travel). */
  keepFront: 0.8,
  /** Access strip (m) in front of every cache piece (bedside, cabinet doors, crate lid, shelf, table). */
  front: 0.6,
  /** Wall spots: every `step` m along each wall (seeded order). */
  step: 0.25,
  /** The survivor's working light: the cache room's first fixture burns steadily, warm, at this power (the dim profile's range). */
  light: {power: 0.55} as {power: number} | null,
};

/** One placed cache (census / tests / QA). */
export interface AnnexCacheRecord {
  annex: number;
  /** The cache room (layout.areas id), its door-hop depth, depth band (0 entry / 1 middle / 2 deep) and door count. */
  area: number; depth: number; band: number; doors: number;
  /**
   * Selection rung: 'hideout' (the layout's guaranteed hideout room), 'deep' (the rule), 'middle' / 'any' (the round-2 fallback),
   * 'relaxed' / 'last' (round 3: the guarantee's lighter set-up).
   */
  tier: 'hideout' | 'deep' | 'middle' | 'any' | 'relaxed' | 'last';
  /** layout.props indices: the (first) bed, the storage holders (loot key ANNEX_CACHE_KEY), the camp things. */
  bed: number; holders: number[]; decor: number[];
  /** (round 3) Every bed (bedroll / pallet bed), the camp table, the lantern and the stove (-1 = none), every piece in placement order. */
  beds: number[]; table: number; lantern: number; stove: number; pieces: number[];
  /** (round 3) The lantern's light-field source (layout.lights index, -1 = none) and the gear piece (layout.pickups index, -1 = none). */
  light: number; gear: number;
  /** Rooms tried (and rolled back) before this one in the annex. */
  rejected: number;
  /** Straight-line metres from the annex door to the room centre. */
  doorM: number;
}

const CACHES = new WeakMap<StationLayout, AnnexCacheRecord[]>();
/** The survivor caches of a populated layout (empty when it has none). */
export function annexCachesOf(layout: StationLayout): readonly AnnexCacheRecord[] {
  return CACHES.get(layout) ?? [];
}

const ALL_SIDES: readonly Side[] = ['N', 'S', 'W', 'E'];
type Tier = AnnexCacheRecord['tier'];
type From = {props: number; pickups: number; zombies: number; lights: number};

/**
 * The survivor caches of ONE annex (see the file header): selection on the annex's door-hop topology, placement through one place
 * context over the annex window — `reuse`: the room-storage pass's annex-window contexts by level (gen/annexContent.ts; its masks
 * still hold that pass's access strips), else a fresh one (a full-grid context costs ~1-4 ms to build). `from`: the first appended
 * (extension) prop / pickup / zombie index — nothing before it lies in an annex, so the scans start there. `loot`: the level's profile
 * (the gear piece's pool; none = no gear piece). Appends props (+ lantern lights, the gear pickup); returns (and records) what it placed.
 */
export function placeAnnexCaches(layout: StationLayout, n: ServiceAnnex, areas: readonly Area[], kinds: ReadonlySet<string>, rng: Rng,
  o: {reuse?: ReadonlyMap<number, PlaceCtx>; from?: From; loot?: LootProfile} = {}): AnnexCacheRecord[] {
  const from = o.from ?? {props: 0, pickups: 0, zombies: 0, lights: 0};
  const C = ANNEX_CACHE, W = C.weight, out: AnnexCacheRecord[] = [];
  if (!areas.length) return out;
  let dMin = Infinity, dMax = -Infinity;
  for (const a of areas) { dMin = Math.min(dMin, a.depth); dMax = Math.max(dMax, a.depth); }
  const bandOf = (d: number) => (dMax <= dMin ? 0 : Math.min(2, Math.floor((3 * (d - dMin)) / (dMax - dMin + 1e-9))));
  const ids = new Set(areas.map(a => a.id));
  // door degree + annex-internal adjacency (one pass over the doors)
  const degree = new Map<number, number>(), adj = new Map<number, Set<number>>();
  const link = (p: number, q: number) => { let s = adj.get(p); if (!s) adj.set(p, (s = new Set())); s.add(q); };
  for (const d of layout.doors) {
    const ia = ids.has(d.a), ib = ids.has(d.b);
    if (ia) degree.set(d.a, (degree.get(d.a) ?? 0) + 1);
    if (ib && d.b !== d.a) degree.set(d.b, (degree.get(d.b) ?? 0) + 1);
    if (ia && ib && d.a !== d.b) { link(d.a, d.b); link(d.b, d.a); }
  }
  // the stash rooms and each room's floor taken by its own floor props (one pass over the props)
  const stashRooms = new Set<number>(), taken = new Map<number, number>();
  for (let i = from.props; i < layout.props.length; i++) {
    const p = layout.props[i];
    if (!ids.has(p.area)) continue;
    if (p.purpose === ANNEX_STASH_KEY) stashRooms.add(p.area);
    if (p.host === undefined && !p.mounted) taken.set(p.area, (taken.get(p.area) ?? 0) + 4 * p.hx * p.hz);
  }
  const m2 = (a: Area) => a.w * a.h * CELL * CELL;
  const free = (a: Area) => m2(a) - (taken.get(a.id) ?? 0);
  const eligible = (a: Area) => a.kind === 'room' && !a.extHall && !SIGNATURE_OF_PURPOSE[a.purpose ?? ''] && a.depth > dMin + 1
    && Math.min(a.w, a.h) * CELL >= C.room.minShort && m2(a) >= C.room.minM2;
  const relaxedOk = (a: Area) => a.kind !== 'service' && a.depth > dMin && Math.min(a.w, a.h) * CELL >= C.relaxed.minShort && m2(a) >= C.relaxed.minM2;
  const want = n.areaM2 >= C.twoM2 ? 2 : 1;
  const win = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
  for (const a of areas) { win.x0 = Math.min(win.x0, a.x - 4); win.y0 = Math.min(win.y0, a.y - 4); win.x1 = Math.max(win.x1, a.x + a.w + 3); win.y1 = Math.max(win.y1, a.y + a.h + 3); }
  const st: {ctx: PlaceCtx | null} = {ctx: null};
  let rejected = 0;
  const used = new Set<number>();
  const ctxFor = (a: Area): PlaceCtx => {
    if (!st.ctx) { const r = o.reuse?.get(a.level ?? 0); st.ctx = r ? {...r, rng} : makePlaceCtx(layout, rng, a.level ?? 0, win); }
    return st.ctx;
  };
  const tryRoom = (a: Area, tier: Tier, relaxed: boolean): boolean => {
    const rec = buildCache(ctxFor(a), layout, n, a, kinds, from, relaxed, tier === 'last');
    if (!rec) { rejected++; return false; }
    Object.assign(rec, {tier, band: bandOf(a.depth), doors: degree.get(a.id) ?? 0, rejected});
    out.push(rec);
    used.add(a.id);
    return true;
  };
  // (round 3) the layout's guaranteed hideout room first, when the layout carries one (lane LAYOUT's optional ServiceAnnex.hideout)
  const hint = (n as ServiceAnnex & {hideout?: number}).hideout;
  const hinted = typeof hint === 'number' ? areas.find(a => a.id === hint) : undefined;
  if (hinted && !tryRoom(hinted, 'hideout', false) && relaxedOk(hinted)) tryRoom(hinted, 'hideout', true);
  const weightOf = (cands: readonly Area[]) => {
    const floor = Math.min(...cands.map(a => a.depth));
    return (a: Area) => {
      const dg = degree.get(a.id) ?? 0;
      return (dg <= 1 ? W.deadEnd : dg === 2 ? W.twoDoors : 1) * (1 + W.perHop * (a.depth - floor))
        * Math.min(W.freeMax, Math.max(W.freeMin, (free(a) - W.freeMid) / W.freeMid)) * (stashRooms.has(a.id) ? W.stash : 1);
    };
  };
  const notNextToUsed = (a: Area) => !used.has(a.id) && ![...used].some(u => adj.get(u)?.has(a.id));
  const TIERS: readonly (readonly [Tier, (a: Area) => boolean])[] = [
    ['deep', a => eligible(a) && bandOf(a.depth) === 2], ['middle', a => eligible(a) && bandOf(a.depth) === 1], ['any', eligible],
  ];
  for (const [tier, inTier] of TIERS) {
    if (out.length >= want || (out.length && tier !== 'deep')) break; // the second cache: deep only
    let cands = areas.filter(a => inTier(a) && notNextToUsed(a));
    if (!cands.length) continue;
    const weight = weightOf(cands);
    const need = tier === 'deep' ? want : 1; // a fallback tier only ever places the ONE cache
    for (let tries = 0; cands.length && out.length < need && tries < C.roomTries; tries++) {
      const a = rng.weighted(cands.map(c => [c, weight(c)] as const));
      cands = cands.filter(c => c !== a);
      if (tryRoom(a, tier, false)) cands = cands.filter(c => !adj.get(a.id)?.has(c.id));
    }
  }
  // (round 3) THE GUARANTEE: nothing placed yet -> the relaxed rung (weighted, deeper first), then the last rung (deepest first)
  if (!out.length) {
    let cands = areas.filter(a => relaxedOk(a) && !used.has(a.id));
    const weight = cands.length ? weightOf(cands) : () => 1;
    for (let tries = 0; cands.length && !out.length && tries < C.relaxed.tries; tries++) {
      const a = rng.weighted(cands.map(c => [c, Math.max(1e-3, weight(c))] as const));
      cands = cands.filter(c => c !== a);
      tryRoom(a, 'relaxed', true);
    }
  }
  if (!out.length) {
    const deepest = areas.filter(a => !used.has(a.id)).sort((p, q) => q.depth - p.depth || m2(q) - m2(p) || p.id - q.id);
    for (const a of deepest) if (tryRoom(a, 'last', true)) break;
  }
  // (round 3) the gear piece: the annex's FIRST cache, on its own fork (the cache stream is untouched)
  if (out.length && o.loot && st.ctx) out[0].gear = placeGearPiece(layout, out[0], o.loot, st.ctx, rng.fork('gear'));
  const all = CACHES.get(layout) ?? [];
  all.push(...out);
  CACHES.set(layout, all);
  return out;
}

/**
 * One cache in room `a`: a bed (+ a second bedroll in a roomy room), storage holders (>= minHolders, else rolled back: null), the camp
 * table with its lantern and stove (else the lantern at the bed's head), up to decorMax camp things; lifted onto the floor, the lantern's
 * light, the room's working fixture. `relaxed` (the guarantee's lighter rungs): the bedroll first, >= relaxed.minHolders holders;
 * `bare` (the last rung): the bed alone suffices.
 */
function buildCache(ctx: PlaceCtx, layout: StationLayout, n: ServiceAnnex, a: Area, kinds: ReadonlySet<string>, from: From, relaxed = false, bare = false): AnnexCacheRecord | null {
  const C = ANNEX_CACHE;
  reserve(ctx, layout, a, from);
  const p0 = layout.props.length;
  const doorSides = new Set((ctx.doorsOf.get(a.id) ?? []).map(d => doorSide(d, a)));
  const quiet = ALL_SIDES.filter(s => !doorSides.has(s)), loud = ALL_SIDES.filter(s => doorSides.has(s));
  const rng = ctx.rng;
  begin(ctx);
  // 1. the sleeping spot (pallet bed or bedroll; relaxed: the bedroll first — it is smaller and lower)
  const first = !relaxed && rng.chance(C.palletBedChance) ? C.beds[0] : C.beds[1];
  const order = first === C.beds[0] ? C.beds : relaxed ? [C.beds[1], C.beds[0]] : C.beds.slice().reverse();
  let bed: WallPlaced | null = null;
  for (const k of order) { bed = onWall(ctx, a, k, quiet) ?? onWall(ctx, a, k, loud); if (bed) break; }
  if (!bed) { rollback(ctx); return null; }
  bed.p.variant = rng.int(0, 11); // the sleeping bag's colour (PURPOSE_ACCENT palette)
  const beds: PropPlacement[] = [bed.p];
  // 2. storage: the footlocker at the foot of the bed (else its head, else any wall), then shelf / cabinet / crate
  const holders: PropPlacement[] = [];
  for (const role of C.storage) for (const k of role) {
    const p = k === 'footlocker' ? (besideBed(ctx, a, bed, k, 1) ?? besideBed(ctx, a, bed, k, -1) ?? onWall(ctx, a, k, ALL_SIDES)?.p ?? null) : onWall(ctx, a, k, ALL_SIDES)?.p ?? null;
    if (p) { holders.push(p); break; }
  }
  if (!bare && holders.length < (relaxed ? C.relaxed.minHolders : C.minHolders)) { rollback(ctx); return null; }
  commit(ctx);
  // 3. a second sleeper's bedroll in a roomy cache (another wall, quiet first)
  const roomy = a.w * a.h * CELL * CELL - 4 * layout.props.slice(from.props).reduce((s, p) => s + (p.area === a.id && p.host === undefined && !p.mounted ? p.hx * p.hz : 0), 0);
  if (!relaxed && roomy >= C.secondBed.m2 && rng.chance(C.secondBed.chance)) {
    const b2 = onWall(ctx, a, C.beds[1], quiet.filter(s => s !== bed!.side)) ?? onWall(ctx, a, C.beds[1], ALL_SIDES);
    if (b2) { b2.p.variant = rng.int(0, 11); beds.push(b2.p); }
  }
  // 4. the camp table with the lantern / stove on its top; else the lantern on the floor at the bed's head
  const table = onWall(ctx, a, C.table, quiet)?.p ?? onWall(ctx, a, C.table, ALL_SIDES)?.p ?? null;
  let lantern: PropPlacement | null = null, stove: PropPlacement | null = null;
  if (table) {
    const ti = layout.props.length - 1;
    for (const [k, lx, lz] of C.onTable) {
      const q = onHost(ctx, layout, a, table, ti, k, lx, lz);
      if (q && k === C.lantern.kind) lantern = q; else if (q) stove = q;
    }
  }
  if (!lantern) {
    lantern = besideBed(ctx, a, bed, C.lantern.kind, -1, 0.12) ?? besideBed(ctx, a, bed, C.lantern.kind, 1, 0.12) ?? onWall(ctx, a, C.lantern.kind, ALL_SIDES)?.p ?? null;
    if (lantern) lantern.variant = rng.int(0, 11);
  }
  // 5. camp things: the level's loaded iteration-07 kinds whose own wall placement spec allows this room's purpose (the p7 contract)
  const key = p7AreaKey(a);
  const decorKinds = C.decor.filter(k => kinds.has(k) && isP7Kind(k) && p7Spec(k).uses.some(u => u.at === 'wall' && u.in.includes(key)));
  const chairs = decorKinds.filter(k => /Chair$/.test(k)), rest = rng.shuffle(decorKinds.filter(k => !/Chair$/.test(k)));
  const placed: PropPlacement[] = [];
  for (const k of [...chairs.slice(0, 1), ...rest]) {
    if (placed.length >= C.decorMax) break;
    const p = onWall(ctx, a, k as PropKind, ALL_SIDES)?.p;
    if (p) placed.push(p);
  }
  // onto the room's own floor (the annex lies at the trackbed, as placeRoomStorage lifts its pieces); holders take the cache key
  const g = ctx.g;
  for (let i = p0; i < layout.props.length; i++) {
    const p = layout.props[i];
    const [cx, cy] = g.cellOf(p.x, p.z), k = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
    p.y += k >= 0 && g.cells[k] === FLOOR && g.rampIdx[k] < 0 ? g.floorOf(k) : areaBase(layout, a);
    if (isLootHolderKind(p.kind)) p.purpose = ANNEX_CACHE_KEY;
  }
  // the survivor got a light working (their generator / work light): the room's first fixture burns steadily, warm and low — a lit
  // doorway deep in the dark annex; the room's profile at least 'dim' (the annex light rule: dim / lit = a steady fixture). No new
  // fixture record: the lights pass already placed the room's fixtures (only its own records change; deterministic, no draw)
  const L = C.light;
  let own: LightPlacement | undefined;
  for (let i = from.lights; i < layout.lights.length && !own; i++) if (layout.lights[i].area === a.id && !layout.lights[i].virtual) own = layout.lights[i];
  if (L && own) Object.assign(own, {broken: false, dying: false, flicker: false, warm: true, power: L.power});
  if (L && a.lighting === 'dark') a.lighting = 'dim';
  // (round 3) the LANTERN lights the room: a warm, steady light-field source at the lantern (`virtual`: no fixture / tube / glow card,
  // world/builder.ts; the baked light field, world/lightField.ts) — appended, so every earlier light keeps its index
  let light = -1;
  if (lantern) {
    light = layout.lights.length;
    const lr: LightPlacement = {x: lantern.x, y: lantern.y + C.lantern.lift, z: lantern.z, rot: 0, area: a.id, broken: false, flicker: false, warm: true, power: C.lantern.power, dying: false, virtual: true};
    if (lantern.level) lr.level = lantern.level;
    layout.lights.push(lr);
  }
  const idx = (p: PropPlacement | null) => (p ? layout.props.indexOf(p, p0) : -1);
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  const pieces: number[] = [];
  for (let i = p0; i < layout.props.length; i++) pieces.push(i);
  return {annex: n.id, area: a.id, depth: a.depth, band: 2, doors: 0, tier: 'deep', bed: idx(beds[0]), holders: holders.map(idx), decor: placed.map(idx),
    beds: beds.map(idx), table: idx(table), lantern: idx(lantern), stove: idx(stove), pieces, light, gear: -1, rejected: 0,
    doorM: Math.round(Math.hypot(cx - n.exit.x, cz - n.exit.z) * 10) / 10};
}

/**
 * (round 3) The hideout's GEAR PIECE (ANNEX_CACHE_GEAR): with `chance`, ONE piece from the level's gear pool + the gas mask
 * (annexCacheGearRows; ids kept to real gear items), a mask with its seeded filter (MASK_LOOT.foundFilter of FILTER_LIFE_S, like the
 * level's mask find) — a layout pickup (`reward: ANNEX_CACHE_GEAR_KEY`) on the free floor cell of the room nearest the bed's bedside
 * (never a door cell, a blocked cell or a ramp). Rolled on its own fork: finite, deterministic per layout. Returns its pickups index
 * (-1: none rolled / no free cell).
 */
function placeGearPiece(layout: StationLayout, rec: AnnexCacheRecord, profile: LootProfile, ctx: PlaceCtx, rng: Rng): number {
  if (!rng.chance(ANNEX_CACHE_GEAR.chance)) return -1;
  const rows = annexCacheGearRows(profile).filter(([id]) => isGearItem(id));
  if (!rows.length) return -1;
  const itemId = rng.weighted(rows);
  const filter = itemId === GAS_MASK_ID ? Math.round(FILTER_LIFE_S * (MASK_LOOT.foundFilter[0] + (MASK_LOOT.foundFilter[1] - MASK_LOOT.foundFilter[0]) * rng.next()) * 10) / 10 : undefined;
  const a = layout.areas[rec.area], bed = layout.props[rec.bed], g = ctx.g;
  if (!a || !bed) return -1;
  // the bedside: half a metre out from the bed's front face, at its middle
  const fx = Math.round(Math.sin(bed.rot)), fz = Math.round(Math.cos(bed.rot)), deep = fx ? bed.hx : bed.hz;
  const tx = bed.x + fx * (deep + 0.45), tz = bed.z + fz * (deep + 0.45);
  const doorCells = new Set<number>();
  for (const d of ctx.doorsOf.get(a.id) ?? []) for (let y = d.y - 1; y <= d.y + d.h; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (g.inBounds(x, y)) doorCells.add(g.idx(x, y));
  let best = -1, bd = Infinity;
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || g.rampIdx[i] >= 0 || doorCells.has(i) || ctx.doorCell[i]) continue;
    const d = Math.hypot((x + 0.5) * CELL - tx, (y + 0.5) * CELL - tz);
    if (d < bd - 1e-9) { bd = d; best = i; }
  }
  if (best < 0) return -1;
  const x = (best % g.w + 0.5) * CELL, z = (Math.floor(best / g.w) + 0.5) * CELL;
  const pk: PickupPlacement = {itemId, count: 1, x, y: g.floorOf(best), z, area: a.id, reward: ANNEX_CACHE_GEAR_KEY, ...(filter !== undefined ? {filter} : {})};
  if (a.level) pk.level = a.level;
  layout.pickups.push(pk);
  return layout.pickups.length - 1;
}

/**
 * The keep reservations a reused / fresh context lacks (the dressing's own masks are gone): every existing floor prop of the room
 * keeps a `keepFront` strip in front of its face (holder stand points, door swings, drawer travel), wall mounts their footprint, floor
 * finds their cell and service spawns a 3 x 3 cell square — so the cache never covers, blocks or crowds what is already there.
 */
function reserve(ctx: PlaceCtx, layout: StationLayout, a: Area, from: From): void {
  const g = ctx.g, f = ANNEX_CACHE.keepFront;
  const mark = (c: readonly [number, number, number, number]) => {
    for (let y = Math.max(c[1], a.y); y <= Math.min(c[3], a.y + a.h - 1); y++) for (let x = Math.max(c[0], a.x); x <= Math.min(c[2], a.x + a.w - 1); x++) {
      const i = g.idx(x, y);
      if (g.area[i] === a.id) markCell(ctx, ctx.keep, i);
    }
  };
  for (let i = from.props; i < layout.props.length; i++) {
    const p = layout.props[i];
    if (p.area !== a.id || p.host !== undefined) continue;
    if (p.mounted) { mark(cellsOfBox(p.x, p.z, p.hx, p.hz)); continue; }
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    const deep = fx ? p.hx : p.hz, half = fx ? p.hz : p.hx;
    mark(cellsOfBox(p.x + fx * (deep + f / 2), p.z + fz * (deep + f / 2), fx ? f / 2 : half, fz ? f / 2 : half));
  }
  for (let i = from.pickups; i < layout.pickups.length; i++) { const p = layout.pickups[i]; if (p.area === a.id) mark(cellsOfBox(p.x, p.z, 0.05, 0.05)); }
  for (let i = from.zombies; i < layout.zombies.length; i++) { const z = layout.zombies[i]; if (z.area === a.id) { const [x, y] = g.cellOf(z.x, z.z); mark([x - 1, y - 1, x + 1, y + 1]); } }
}

/** A wall placement: the prop, the wall it backs onto and its position along that wall (world metres). */
interface WallPlaced { p: PropPlacement; side: Side; along: number }

/**
 * A wall spot for `kind` in `a`, back to one of `sides`: every `step` m along those walls in seeded order — the doorway clear volumes
 * (absolute heights), the mall's real-wall rule, then the dresser's own tryPlaceProp (cells, door zones / cells, keep, access strip
 * `front`, room connectivity). Null when no spot fits.
 */
function onWall(ctx: PlaceCtx, a: Area, kind: PropKind, sides: readonly Side[]): WallPlaced | null {
  const C = ANNEX_CACHE, def = PROP_DEFS[kind], spots: [Side, number][] = [];
  for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + def.w / 2 + 0.05; t <= hi - def.w / 2 - 0.05 + 1e-9; t += C.step) spots.push([side, Math.round(t * 1000) / 1000]);
  }
  for (const [side, along] of ctx.rng.shuffle(spots)) {
    const p = atWall(ctx, a, kind, side, along);
    if (p) return {p, side, along};
  }
  return null;
}

/** `kind` with its back to wall `side` of `a` at `along` (the checks of onWall), or null. */
function atWall(ctx: PlaceCtx, a: Area, kind: PropKind, side: Side, along: number): PropPlacement | null {
  const def = PROP_DEFS[kind], base = areaBase(ctx.layout, a);
  const [lo, hi] = wallRange(a, side);
  if (along - def.w / 2 < lo + 0.02 || along + def.w / 2 > hi - 0.02) return null;
  if (!strictWallOk(ctx, a, side, along, kind)) return null;
  const s = wallSpot(a, side, along, kind), {hx, hz} = footprint(kind, s.rot);
  if (propBlocksDoorway(ctx.layout, s.x, s.z, hx, hz, base, def.h)) return null;
  return tryPlaceProp(ctx, a, kind, s.x, s.z, s.rot, {front: ANNEX_CACHE.front});
}

/**
 * (round 3) `kind` against the bed's wall right beside it: past its FOOT end (`end` +1: the bed's local +X; the pillow lies at -X) or
 * its HEAD end (-1), `gap` m from the bed, then a little further along (up to 0.5 m) when the first spot is taken.
 */
function besideBed(ctx: PlaceCtx, a: Area, bed: WallPlaced, kind: PropKind, end: 1 | -1, gap = 0.08): PropPlacement | null {
  // the bed's local +X in world (three.js rotateY): (cos rot, -sin rot); its sign along the wall's axis
  const alongX = bed.side === 'N' || bed.side === 'S';
  const ax = alongX ? Math.cos(bed.p.rot) : -Math.sin(bed.p.rot);
  const sgn = (ax >= 0 ? 1 : -1) * end;
  const off = PROP_DEFS[bed.p.kind].w / 2 + gap + PROP_DEFS[kind].w / 2;
  for (const extra of [0, 0.25, 0.5]) {
    const p = atWall(ctx, a, kind, bed.side, Math.round((bed.along + sgn * (off + extra)) * 1000) / 1000);
    if (p) return p;
  }
  return null;
}

/**
 * (round 3) A loose camp thing standing on the camp table's top (`host` = the table's index): local (lx, lz) of the table frame, the
 * table's yaw; y = the table's top (lifted with it onto the floor afterwards). Never in a doorway's clear volume. Null when it would not
 * fit inside the table's top.
 */
function onHost(ctx: PlaceCtx, layout: StationLayout, a: Area, host: PropPlacement, hostIndex: number, kind: PropKind, lx: number, lz: number): PropPlacement | null {
  const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
  if (Math.abs(lx) + def.w / 2 > hd.w / 2 || Math.abs(lz) + def.d / 2 > hd.d / 2) return null;
  const c = Math.cos(host.rot), s = Math.sin(host.rot);
  const x = Math.round((host.x + lx * c + lz * s) * 1000) / 1000, z = Math.round((host.z - lx * s + lz * c) * 1000) / 1000;
  const {hx, hz} = footprint(kind, host.rot);
  const y = host.y + host.h;
  if (propBlocksDoorway(layout, x, z, hx, hz, areaBase(layout, a) + y, def.h)) return null;
  const p: PropPlacement = {kind, x, z, y, rot: host.rot, area: a.id, hx, hz, h: def.h, blocksSight: false, variant: ctx.rng.int(0, 11), host: hostIndex};
  if (host.level) p.level = host.level;
  layout.props.push(p);
  return p;
}
