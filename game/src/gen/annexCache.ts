// Task studio-alpha-track2-round2-20261031-01 (lane CACHE, item R5): SURVIVOR CACHES deeper in the service annexes. User (round 2
// playtest): "there's not enough of a reason to go to this place, there should be some "cache" rooms that spawn deeper in, a room like
// a survivor had been living there you know."
//
// placeAnnexCaches runs LAST in gen/annexContent.ts populateExtensions (after the dressing, the loot keys, lights, floor finds, vents
// and service spawns), per annex on its own fork (`track-ext-content` -> `cache:<annexId>`), and only APPENDS props: every core record
// and every earlier annex record (props, holder indices + loot, pickups, spawns; lights but the cache room's own fixture) is unchanged;
// their cells (holder access strips / stand points, wall mounts, floor finds, spawn points) are kept clear.
//
// WHERE — "deep" from the annex's own door-hop topology (Area.depth = door hops from the annex entry, as pickOver's supply bands):
//  - the deep THIRD of the annex's depth range (band 2 of dMin..dMax, the formula pickOver / the service spawns use);
//  - a ROOM (never a closet: too small to live in; never a service corridor), never a machinery HALL, never a SIGNATURE room
//    (boiler / generator / sewage / overflow / spillway / turbine / ventilation: their machinery stays as it is), never an entry
//    room (depth <= dMin + 1: the entry corridor and the room at its end), at least ANNEX_CACHE.room.minShort x minM2;
//  - a seeded weighted pick: dead ends first (one door x3, two doors x1.5), deeper first (+1 per hop past the tier's shallowest
//    candidate), room to live in (free floor after the room's own props: x0.2 .. x2), the room holding the annex stash x0.5 (spread
//    the finds); a room whose cache does not fit is dropped and the next drawn, at most `roomTries` rooms per tier;
//  - ONE cache per annex; a SECOND only in a large annex (areaM2 >= twoM2), deep band only, never door-adjacent to the first;
//  - FALLBACK (documented): no deep room fits -> the middle band, then any eligible room past the entry; still none (an annex of
//    halls / signature rooms / closets only) -> no cache (reported: annexCachesOf / the content report).
// WHAT — one room set up as somewhere a survivor lived (existing kinds + one local procedural kind; no new asset files):
//  - a REST SPOT: palletBed (gen/purposeShapes.ts: mattress + sleeping bag + pillow on two pallets) against a wall, a door-free wall
//    first, with a 0.6 m bedside strip kept clear;
//  - their STORAGE (2-3 holders, else the room is rolled back): an open shelf (pantry), a tall (else low) cabinet (kit), a crate
//    (supply crate) — loot key items/lootTables.ts ANNEX_CACHE_KEY (exact per-container tables, never empty, 2-3 lots; the crate the
//    only ammo); access strips in front;
//  - up to 2 CAMP THINGS: existing iteration-07 kinds the level already loads (no extra model download) and whose own placement spec
//    allows the room's purpose (work light, folding chair, portable generator, trash bags, water cooler, privacy screen, IV pole, drum
//    fan, mop bucket) — separate props, never baked;
//  - a WORKING LIGHT: the room's first ceiling fixture burns steadily (warm, low) — a lit doorway deep in the dark annex.
// Placement uses the dresser's own primitives (placeKit tryPlaceProp: door zones / door cells, access strips, room connectivity;
// propBlocksDoorway for the doorway clear volumes; strictWallOk in the mall), every wall spot of a room enumerated in seeded order,
// through the room-storage pass's annex-window context (no second full-grid context: measured 0.46 ms on Subway 424242, 0.5-0.9 ms
// with two annexes, warm min-of-N).

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
import type {Area, Side, StationLayout} from './stationTypes';
import {ANNEX_CACHE_KEY, ANNEX_STASH_KEY} from '../items/lootTables';
import {isLootHolderKind} from '../items/loot';

/** THE survivor-cache config (one exported block; docs/track-extensions.md "Survivor caches"). */
export const ANNEX_CACHE = {
  /** One cache per annex; two when the annex has at least `twoM2` m² of floor (the second deep only, never next door to the first). */
  twoM2: 2000,
  /** Room minimum: short side (m) and floor area (m²) — a bed, two pieces of storage and the walkway between them. */
  room: {minShort: 3, minM2: 10.5},
  /**
   * Selection weights (see the header): door count, hops past the tier's shallowest candidate, free floor (m² after the room's own
   * floor props: (free - freeMid) / freeMid clamped to [freeMin, freeMax]), the stash room.
   */
  weight: {deadEnd: 3, twoDoors: 1.5, perHop: 1, freeMid: 9, freeMin: 0.2, freeMax: 2, stash: 0.5},
  /** Rooms tried per tier before the next tier (bounds the work when a tier's rooms are all full of shelving). */
  roomTries: 5,
  /** The rest spot (gen/purposeShapes.ts palletBed). */
  bed: 'palletBed' as PropKind,
  /** Storage roles in placement order (each: kinds tried in order): pantry shelf, kit cabinet, supply crate. */
  storage: [['shelf'], ['cabinetTall', 'cabinetLow'], ['crate']] as readonly (readonly PropKind[])[],
  /** A cache needs its bed and at least this many storage holders (else the room is rolled back and the next one tried). */
  minHolders: 2,
  /** Camp things (existing iteration-07 kinds; only those the level loads and whose spec allows the room's purpose). */
  decor: ['tripodWorkLight', 'foldingChair', 'portableGenerator', 'trashBagPile', 'waterCooler', 'privacyScreen', 'ivPole', 'drumFan', 'mopBucketWringer'] as readonly string[],
  decorMax: 2,
  /** Clear strip (m) kept in front of the room's existing floor props (their stand points / door swings / drawer travel). */
  keepFront: 0.8,
  /** Access strip (m) in front of every cache piece (bedside, cabinet doors, crate lid, shelf). */
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
  /** Selection tier: 'deep' (the rule), 'middle' / 'any' (the documented fallback). */
  tier: 'deep' | 'middle' | 'any';
  /** layout.props indices: the bed, the storage holders (loot key ANNEX_CACHE_KEY), the camp things. */
  bed: number; holders: number[]; decor: number[];
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
const TIERS = [['deep', (b: number) => b === 2], ['middle', (b: number) => b === 1], ['any', () => true]] as const;

/**
 * The survivor caches of ONE annex (see the file header): selection on the annex's door-hop topology, placement through one place
 * context over the annex window — `reuse`: the room-storage pass's annex-window contexts by level (gen/annexContent.ts; its masks
 * still hold that pass's access strips), else a fresh one (a full-grid context costs ~1-4 ms to build). `from`: the first appended
 * (extension) prop / pickup / zombie index — nothing before it lies in an annex, so the scans start there. Appends props; returns
 * (and records) what it placed.
 */
export function placeAnnexCaches(layout: StationLayout, n: ServiceAnnex, areas: readonly Area[], kinds: ReadonlySet<string>, rng: Rng,
  o: {reuse?: ReadonlyMap<number, PlaceCtx>; from?: {props: number; pickups: number; zombies: number; lights: number}} = {}): AnnexCacheRecord[] {
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
  const eligible = (a: Area) => a.kind === 'room' && !a.extHall && !SIGNATURE_OF_PURPOSE[a.purpose ?? ''] && a.depth > dMin + 1
    && Math.min(a.w, a.h) * CELL >= C.room.minShort && m2(a) >= C.room.minM2;
  const want = n.areaM2 >= C.twoM2 ? 2 : 1;
  const win = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
  for (const a of areas) { win.x0 = Math.min(win.x0, a.x - 4); win.y0 = Math.min(win.y0, a.y - 4); win.x1 = Math.max(win.x1, a.x + a.w + 3); win.y1 = Math.max(win.y1, a.y + a.h + 3); }
  let ctx: PlaceCtx | null = null, rejected = 0;
  const used = new Set<number>();
  for (const [tier, inTier] of TIERS) {
    if (out.length >= want || (out.length && tier !== 'deep')) break; // the second cache: deep only
    let cands = areas.filter(a => eligible(a) && inTier(bandOf(a.depth)) && !used.has(a.id) && ![...used].some(u => adj.get(u)?.has(a.id)));
    if (!cands.length) continue;
    const floor = Math.min(...cands.map(a => a.depth));
    const weight = (a: Area) => {
      const dg = degree.get(a.id) ?? 0, free = m2(a) - (taken.get(a.id) ?? 0);
      return (dg <= 1 ? W.deadEnd : dg === 2 ? W.twoDoors : 1) * (1 + W.perHop * (a.depth - floor))
        * Math.min(W.freeMax, Math.max(W.freeMin, (free - W.freeMid) / W.freeMid)) * (stashRooms.has(a.id) ? W.stash : 1);
    };
    const need = tier === 'deep' ? want : 1; // a fallback tier only ever places the ONE cache
    for (let tries = 0; cands.length && out.length < need && tries < C.roomTries; tries++) {
      const a = rng.weighted(cands.map(c => [c, weight(c)] as const));
      cands = cands.filter(c => c !== a);
      if (!ctx) { const r = o.reuse?.get(a.level ?? 0); ctx = r ? {...r, rng} : makePlaceCtx(layout, rng, a.level ?? 0, win); }
      const rec = buildCache(ctx, layout, n, a, kinds, from);
      if (!rec) { rejected++; continue; }
      Object.assign(rec, {tier, band: bandOf(a.depth), doors: degree.get(a.id) ?? 0, rejected});
      out.push(rec);
      used.add(a.id);
      cands = cands.filter(c => !adj.get(a.id)?.has(c.id));
    }
  }
  const all = CACHES.get(layout) ?? [];
  all.push(...out);
  CACHES.set(layout, all);
  return out;
}

/** One cache in room `a`: bed, 2-3 storage holders (else rolled back: null), up to decorMax camp things; lifted onto the floor. */
function buildCache(ctx: PlaceCtx, layout: StationLayout, n: ServiceAnnex, a: Area, kinds: ReadonlySet<string>, from: {props: number; pickups: number; zombies: number; lights: number}): AnnexCacheRecord | null {
  const C = ANNEX_CACHE;
  reserve(ctx, layout, a, from);
  const p0 = layout.props.length;
  const doorSides = new Set((ctx.doorsOf.get(a.id) ?? []).map(d => doorSide(d, a)));
  const quiet = ALL_SIDES.filter(s => !doorSides.has(s)), loud = ALL_SIDES.filter(s => doorSides.has(s));
  begin(ctx);
  const bed = onWall(ctx, a, C.bed, quiet) ?? onWall(ctx, a, C.bed, loud);
  const holders: PropPlacement[] = [];
  if (bed) for (const role of C.storage) for (const k of role) { const p = onWall(ctx, a, k, ALL_SIDES); if (p) { holders.push(p); break; } }
  if (!bed || holders.length < C.minHolders) { rollback(ctx); return null; }
  commit(ctx);
  // camp things: the level's loaded iteration-07 kinds whose own wall placement spec allows this room's purpose (the p7 contract)
  const key = p7AreaKey(a);
  const decor = C.decor.filter(k => kinds.has(k) && isP7Kind(k) && p7Spec(k).uses.some(u => u.at === 'wall' && u.in.includes(key)));
  const placed: PropPlacement[] = [];
  for (const k of ctx.rng.shuffle(decor.slice())) {
    if (placed.length >= C.decorMax) break;
    const p = onWall(ctx, a, k as PropKind, ALL_SIDES);
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
  // light record: the lights pass already placed the room's fixtures (only its own records change; deterministic, no draw)
  const L = C.light;
  let own: (typeof layout.lights)[number] | undefined;
  for (let i = from.lights; i < layout.lights.length && !own; i++) if (layout.lights[i].area === a.id) own = layout.lights[i];
  if (L && own) {
    Object.assign(own, {broken: false, dying: false, flicker: false, warm: true, power: L.power});
    if (a.lighting === 'dark') a.lighting = 'dim';
  }
  const idx = (p: PropPlacement) => layout.props.indexOf(p, p0);
  const cx = (a.x + a.w / 2) * CELL, cz = (a.y + a.h / 2) * CELL;
  return {annex: n.id, area: a.id, depth: a.depth, band: 2, doors: 0, tier: 'deep', bed: idx(bed), holders: holders.map(idx), decor: placed.map(idx), rejected: 0,
    doorM: Math.round(Math.hypot(cx - n.exit.x, cz - n.exit.z) * 10) / 10};
}

/**
 * The keep reservations a reused / fresh context lacks (the dressing's own masks are gone): every existing floor prop of the room
 * keeps a `keepFront` strip in front of its face (holder stand points, door swings, drawer travel), wall mounts their footprint, floor
 * finds their cell and service spawns a 3 x 3 cell square — so the cache never covers, blocks or crowds what is already there.
 */
function reserve(ctx: PlaceCtx, layout: StationLayout, a: Area, from: {props: number; pickups: number; zombies: number; lights: number}): void {
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

/**
 * A wall spot for `kind` in `a`, back to one of `sides`: every `step` m along those walls in seeded order — the doorway clear volumes
 * (absolute heights), the mall's real-wall rule, then the dresser's own tryPlaceProp (cells, door zones / cells, keep, access strip
 * `front`, room connectivity). Null when no spot fits.
 */
function onWall(ctx: PlaceCtx, a: Area, kind: PropKind, sides: readonly Side[]): PropPlacement | null {
  const C = ANNEX_CACHE, def = PROP_DEFS[kind], base = areaBase(ctx.layout, a), spots: [Side, number][] = [];
  for (const side of sides) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + def.w / 2 + 0.05; t <= hi - def.w / 2 - 0.05 + 1e-9; t += C.step) spots.push([side, Math.round(t * 1000) / 1000]);
  }
  for (const [side, along] of ctx.rng.shuffle(spots)) {
    if (!strictWallOk(ctx, a, side, along, kind)) continue;
    const s = wallSpot(a, side, along, kind), {hx, hz} = footprint(kind, s.rot);
    if (propBlocksDoorway(ctx.layout, s.x, s.z, hx, hz, base, def.h)) continue;
    const p = tryPlaceProp(ctx, a, kind, s.x, s.z, s.rot, {front: C.front});
    if (p) return p;
  }
  return null;
}
