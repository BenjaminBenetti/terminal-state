// Track 2 — Beyond the Station (lane CONTENT): the CONTENT of the track extensions (gen/trackExt: tunnels past the bed ends, seeded
// SERVICE ANNEXES off them). User: "a small sort of concrete area … nuclear bunker kind of vibe … cramped … sewage pipes kind of
// service corridor … scavenging … apply all the same sort of generation and rules that we built up for the office and for the main
// subway area … much darker … steam coming out of the vents … spooky".
//
// populateExtensions runs ONCE, after finishExtensions attached the extensions to the finished core (every core pass already ran and
// skipped them), on its OWN rng fork (`track-ext-content`; forks are position-independent: no core stream is consumed) and APPENDS
// everything after the core's records — props, signs, lights, pickups (and the service-context spawns) — so every core index,
// persistence key and pinned record is unchanged (coreView(layout) filters them back out). Passes, each on its own sub-fork:
//  1. purposes  — (task track2-playtest-revision, lane ROOMS: gen/annexRooms.ts) machinery halls and about half of the medium rooms
//                 take a ROOM SIGNATURE (boiler / generator / sewage / overflow / spillway / turbine / ventilation) under a bounded
//                 anti-repetition rule, the other rooms an existing utility purpose (workshop, stores, electrical, pump, custodial,
//                 first aid), closets janitor / electrical / supply closets, corridors service corridors; the area's RoomType follows
//                 the purpose's slot (the purpose ↔ slot contract of the core);
//  2. dressing  — gen/stationDress.ts dressExtensionAreas: FIRST the signature layouts (gen/annexRooms.ts placeAnnexMachinery:
//                 anchored machinery records in layout.extensions.machines + collision-only 'annexMachine' boxes, budget-exempt),
//                 then the purpose rules (the lean annex rule sets ANNEX_RULES for the existing purposes: fewer, meaningful holders),
//                 the composer (annex corridors compose as the lower service level: pump skids, transformer banks, tool bays, caches)
//                 on its own generated-model budget ANNEX_COMPOSE_BUDGET, the iteration-07 dresser, purpose door plates — plus one
//                 STASH holder per annex (two in big ones) in its dead-end rooms (loot key items/lootTables.ts ANNEX_STASH_KEY);
//  3. lights    — untinted layout.lights: annex fixtures with the purposes' light odds, one step darker half the time (low,
//                 flickering, dead; the entry corridor at least dim), sparse mostly dead / dying fixtures down the tunnels (much
//                 darker than the station);
//  4. loot      — the per-annex loose floor program (items/lootTables.ts ANNEX_FLOOR) on the annex's free floor;
//  5. vents     — layout.extensions.vents: steam spots over the annex's pump skids / water heaters / compressors, then corridor
//                 walls (lane VIS's bounded, non-hazardous steam emitter reads them; never the gas field);
//  6. service   — the level profile's 'service' context (ai/spawnTables.ts SERVICE_CONTEXT: a per-annex ZONE BUDGET), one run per
//                 annex in its areas only, APPENDED after every core spawn and tagged markSpawnContext(…, 'service') (Track 1
//                 contract, docs/level-enemy-contract.md §2); the caller then runs assignEnemyArchetypes ONCE (the level's own pool:
//                 no annex families, no Siren unless the level's eligibility lists 'service' — none does).
// Holder contents roll at runtime from the seed (finite, remembered by run memory, never refilled) like every holder.

import type {Rng} from '../core/rng';
import {CELL, FLOOR, SOLID} from './grid';
import {ROOM_PURPOSES, purposeById, type LightOdds, type RoomPurpose} from './purposes';
import {isP7Kind} from './props07';
import {LIGHT_ODDS, clearAround, dressExtensionAreas, stationP7Palette} from './stationDress';
import {areaBase, makePlaceCtx, placeAgainstWall, type PlaceCtx} from './placeKit';
import {isExtensionArea, type ServiceAnnex, type TrackTunnel} from './trackExt/types';
import {ANNEX_PICKED_KEY, ANNEX_SCRAPS_KEY, ANNEX_STASH_KEY, ANNEX_SUPPLY_KEY, BATTERY_ID, FLARE_ID, FLOOR_ECONOMY, econCat, floorChance, floorCount, type LootProfile} from '../items/lootTables';
import {areaCap, areaSpawnWeight, markSpawnContext, reportSpawnCandidates, rollZombieTypes, type SpawnContextRule, type SpawnProfile} from '../ai/spawnTables';
import {levelDistance} from './levelGen';
import {lootTheme} from '../items/lootEconomy';
import {ITEMS} from '../items/items';
import {PENDANT_Y, type Area, type LightPlacement, type PickupPlacement, type RoomType, type StationLayout} from './stationTypes';
import type {PropKind} from './props';
import {isLootHolderKind, rollsPurposeTable} from '../items/loot';
// Task track2-playtest-revision (lane ROOMS): room signatures + machinery, the room mix and the lean annex furniture rules
import {ANNEX_RULES, assignAnnexRooms, placeAnnexMachinery, SIGNATURE_OF_PURPOSE, type AnnexMachine, type AnnexRoomPlan, type SignatureId} from './annexRooms';

/**
 * Generated-model (iteration-07) placements the composition of ONE annex's corridors may add: the composer's own budget
 * (COMPOSED_P7_BUDGET = 110 per station) for the annex subset, so every annex adds bounded triangles / draws.
 */
export const ANNEX_COMPOSE_BUDGET = 12;

/** A steam vent spot (world/trackExt/steam.ts SteamVent): wall point (absolute y), blow direction, area id. */
export interface AnnexVent { x: number; y: number; z: number; dir: {x: number; y: number; z: number}; area: number }

/** THE annex content config (one exported block). (Lane ROOMS: the room mix / signatures live in gen/annexRooms.ts ANNEX_ROOMS.) */
export const ANNEX_CONTENT = {
  /**
   * Prop budget of one annex: one placement per `m2PerProp` m² of its floor (an annex of ~1840 m² — the 25 % target — gets ~150,
   * about half the density of the core's back-of-house rooms: GEN's annexes are dozens of small rooms and closets). Rooms are dressed
   * in priority order (the lead plant rooms, then rooms by size, then closets) until it is spent (the room in progress finishes); the
   * corridors' composition is bounded by its zone coverage cap and ANNEX_COMPOSE_BUDGET, the iteration-07 dresser stops at the budget
   * (its per-area budgets scaled by `p7Scale`), host decor follows its host — measured <= ~1.15 x the budget (tests allow 1.25 x).
   */
  m2PerProp: 12,
  p7Scale: 0.5,
  /** (lane ROOMS) Iteration-07 dresser placements per annex (the lean furniture no longer exhausts m2PerProp first). */
  p7Max: 10,
  /**
   * Holders of one annex that keep their room purpose's loot table: one per `m2PerIntactHolder` m² of its floor (~8 for the 25 %
   * target; census 7-8), its DEEPEST holders (area depth from the entry door: the reward is further in); every other annex holder (the stash
   * aside) is picked-over storage (items/lootTables.ts ANNEX_PICKED_KEY) — the measured reason is there.
   */
  m2PerIntactHolder: 230,
  /** Dressing priority of room purposes (lower first; unlisted after): the signature rooms, then the small utility rooms. */
  priority: ['turbine-hall', 'spillway', 'overflow-chamber', 'boiler-room', 'generator-room', 'sewage-room', 'ventilation-plant',
    'workshop', 'first-aid-room', 'electrical-room', 'pump-room', 'custodial-room', 'storage'] as readonly string[],
  /**
   * Playtest revision (studio-alpha-track2-playtest-revision-20261031-01): the annex's ORDINARY FINDS, deterministic per annex
   * (pickOver). Measured on main 312a653: 94-98 % of annex holders were empty — the picked-over table (90 % empty) was ALSO cut by
   * the level-wide scarcity economy, and the few stocked holders were the deepest — so ordinary routes opened only empty storage.
   * Now: `supply` holders (items/lootTables.ts ANNEX_SUPPLY: never empty, 1-2 ordinary supplies) — one per `m2PerSupply` m²,
   * clamped to `supply`, by DEPTH BAND (door-hop depth thirds from the annex entry: `bands` = entry / middle shares, the deep end
   * the rest), at most `perArea` per room; then `scrapsShare` of the remaining picked-over holders (at most `scrapsMax`) keep ONE leftover
   * (ANNEX_SCRAPS); the rest are searched clean (ANNEX_PICKED). The stash and the deepest room-table holders are unchanged.
   */
  loot: {m2PerSupply: 170, supply: [6, 12] as const, bands: [0.5, 0.3] as const, perArea: 2, scrapsShare: 0.12, scrapsMax: 6},
  /**
   * Playtest revision: every annex room / closet the dressing left WITHOUT any loot holder gets one searchable piece of storage
   * (placeRoomStorage, after the dressing): open shelving first (its finds are visible before anything opens), else a low cabinet /
   * crate (rooms) or a tall cabinet (closets). Measured on the merged rooms: an ordinary 10-area route passed 0-2 holders — most
   * plant rooms and closets held none — so even stocked supply holders were out of the way.
   */
  roomStorage: {room: ['shelf', 'cabinetLow', 'crate'] as readonly PropKind[], closet: ['shelf', 'cabinetTall'] as readonly PropKind[]},
  /** Stash holders per annex: one, two when the annex has at least `stashTwoRooms` rooms; kinds in order. */
  stash: {kinds: ['crate', 'cabinetTall'] as readonly PropKind[], twoRooms: 7},
  lights: {
    /** Annex corridor fixtures every ~`corridorStep` m (rooms: 1, 2 along a long side > 9 m; closets 1). */
    corridorStep: 6.5,
    /**
     * "Much darker": after the purpose's own light odds pick a profile, it drops one step (lit -> dim, dim -> dark) with this chance
     * — an annex of ~68 small areas otherwise reads like the core's back-of-house (census: ~32 steadily working fixtures per annex
     * at the purposes' odds alone, ~19 of ~80 with this; ~17 more are dying / sputtering). The entry corridor stays at least dim.
     */
    darken: 0.5,
    /** Tunnel fixtures: the first at s in `first`, then every `step` m, none within `capClear` of the cap. */
    tunnel: {first: [5, 9] as const, step: [16, 24] as const, capClear: 4,
      /** Per fixture: dead, else dying (sputtering), else dim (power range, flicker chance). */
      broken: 0.55, dying: 0.45, power: [0.3, 0.5] as const, flicker: 0.5},
  },
  /** Steam vents per annex (world/trackExt/steam.ts STEAM.perAnnex caps the emitter; tests check <=). */
  ventsPerAnnex: 3,
  /** Props a vent sits over (pipe runs of the plant). */
  ventKinds: ['waterPumpSkid', 'waterHeaterTank', 'pipeValveManifold', 'airCompressor'] as readonly string[],
};

/** What populateExtensions appended (census / tests). */
export interface ExtensionContentReport {
  annexes: {id: number; purposes: Record<string, number>; props: number; holders: number; stash: number; lights: number; pickups: number; service: {count: number; placed: number};
    /** (lane ROOMS) built room signatures (count per signature), machinery halls, assemblies, collision boxes, demoted signature rooms. */
    signatures: Partial<Record<SignatureId, number>>; halls: number; machines: number; solids: number; demoted: number}[];
  tunnelLights: number;
  props: number; signs: number; lights: number; pickups: number; vents: number;
  /** Generation time of the pass (ms) and of its phases. */
  ms: number;
  phases: Record<string, number>;
  /** First index of the appended records in each list. */
  first: {props: number; signs: number; lights: number; pickups: number; zombies: number};
}

const REPORTS = new WeakMap<StationLayout, ExtensionContentReport>();
/** The content report of a populated layout (null when it has no extensions / was not populated). */
export function extensionContentOf(layout: StationLayout): ExtensionContentReport | null {
  return REPORTS.get(layout) ?? null;
}

/**
 * Populates the attached extensions of a finished layout (see the file header). `rng` = the generator's attempt rng (its
 * `track-ext-content` fork is used; the core's streams are never consumed). `dressRng` = the fork the station's dress() ran on (its
 * iteration-07 palette is re-derived: no new model kinds). Idempotence is the caller's: call once per layout.
 */
export function populateExtensions(layout: StationLayout, rng: Rng, o: {loot: LootProfile; spawns: SpawnProfile; dressRng: Rng}): ExtensionContentReport | null {
  // the level's 'service' context (read on every call: the generator asks for exactly the contexts its profile declares; a level
  // without annex enemies omits it or declares count [0, 0])
  const service = o.spawns.contexts.service;
  const ext = layout.extensions;
  if (!ext) return null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  const t0 = now();
  const root = rng.fork('track-ext-content');
  const first = {props: layout.props.length, signs: layout.signs.length, lights: layout.lights.length, pickups: layout.pickups.length, zombies: layout.zombies.length};
  const rep: ExtensionContentReport = {annexes: [], tunnelLights: 0, props: 0, signs: 0, lights: 0, pickups: 0, vents: 0, ms: 0, phases: {}, first};
  let tp = t0;
  const phase = (k: string) => { const t = now(); rep.phases[k] = (rep.phases[k] ?? 0) + t - tp; tp = t; };
  const annexAreas = (n: ServiceAnnex) => n.areas.map(id => layout.areas[id]).filter((a): a is Area => !!a && isExtensionArea(a));
  // 1. purposes (lane ROOMS: signatures for the halls and half of the medium rooms, the anti-repetition rule; gen/annexRooms.ts)
  const plans = new Map<number, AnnexRoomPlan>();
  for (const n of ext.annexes) plans.set(n.id, assignAnnexPurposes(layout, annexAreas(n), root.fork(`purposes:${n.id}`)));
  phase('purposes');
  // 2. dressing (+ the signature machinery, + stashes), one pass per annex (its own budget; areas in priority order)
  const stashes: number[] = [];
  const machines: AnnexMachine[] = [];
  const mrep = new Map<number, {built: Map<number, SignatureId>; demoted: number; solids: number; machines: number}>();
  const palette = ext.annexes.length ? stationP7Palette(o.dressRng) : new Set<string>();
  // (lane ROOMS) the annexes only use iteration-07 kinds the core already places: no extra model download / GPU texture memory
  const coreKinds = new Set<string>();
  for (let i = 0; i < first.props; i++) if (isP7Kind(layout.props[i].kind)) coreKinds.add(layout.props[i].kind);
  const C = ANNEX_CONTENT, prio = (a: Area) => (a.kind === 'closet' ? 90 : a.kind === 'service' ? 95 : (k => (k < 0 ? 50 : k))(C.priority.indexOf(a.purpose ?? '')));
  for (const n of ext.annexes) {
    const areas = annexAreas(n).sort((p, q) => prio(p) - prio(q) || q.w * q.h - p.w * p.h || p.id - q.id);
    const d = dressExtensionAreas(layout, areas, root.fork(`dress:${n.id}`), {
      palette, p7Budget: ANNEX_COMPOSE_BUDGET, maxProps: Math.round(n.areaM2 / C.m2PerProp), p7Scale: C.p7Scale,
      pre: ctxOf => {
        // (lane ROOMS) the signature layouts first (they need the most floor), budget-exempt collision boxes; then the stashes
        const m0 = machines.length;
        const r = placeAnnexMachinery(layout, plans.get(n.id)!, annexAreas(n), ctxOf, root.fork(`machinery:${n.id}`), machines, setPurpose, utilityFits);
        mrep.set(n.id, {built: r.built, demoted: r.demoted, solids: r.solids, machines: machines.length - m0});
        stashes.push(...placeStashes(layout, annexAreas(n), ctxOf, root.fork(`stash:${n.id}`)));
        return r.solids;
      },
      // (lane ROOMS) lean furniture of the existing purposes in annex rooms: fewer, meaningful holders (gen/annexRooms.ts ANNEX_RULES)
      rules: a => ANNEX_RULES[a.purpose ?? ''],
      kinds: coreKinds,
      // (lane ROOMS) the iteration-07 equipment props stay about where the old dense dressing left them (~16 per annex): one per
      // room, two per machinery hall, none from the dresser in closets / corridors (the composer dresses corridors), C.p7Max in total
      p7Cap: {perArea: a => (a.kind !== 'room' ? 0 : a.extHall ? 2 : 1), total: C.p7Max},
      phase,
    });
    rep.props += d.props; rep.signs += d.signs;
    const added = placeRoomStorage(layout, annexAreas(n), root.fork(`storage:${n.id}`));
    rep.props += added;
    pickOver(layout, n, layout.props.length - d.props - added, new Set(stashes), root.fork(`loot:${n.id}`));
  }
  if (ext.annexes.length) ext.machines = machines;
  phase('dress');
  // 3. lights
  const lr = root.fork('lights');
  for (const n of ext.annexes) lightAnnex(layout, annexAreas(n), lr.fork(`annex:${n.id}`));
  for (const t of ext.tunnels) rep.tunnelLights += lightTunnel(layout, t, lr.fork(`tunnel:${t.id}`));
  phase('lights');
  // 4. loose floor finds
  for (const n of ext.annexes) placeAnnexFloor(layout, annexAreas(n), o.loot, root.fork(`floor:${n.id}`));
  phase('floor');
  // 5. steam vents
  const vents: AnnexVent[] = [];
  for (const n of ext.annexes) vents.push(...annexVents(layout, annexAreas(n), root.fork(`vents:${n.id}`)));
  if (ext.annexes.length) ext.vents = vents;
  rep.vents = vents.length;
  phase('vents');
  // 6. service spawns (last: every core spawn keeps its index), one run per annex, tagged 'service'
  const svc = new Map<number, {count: number; placed: number}>();
  if (service && service.count[1] > 0 && ext.annexes.length) {
    const start = layout.office?.start ?? {...layout.playerSpawn, level: 0};
    const levels = layout.levels?.length ? layout.levels : [{id: 0, role: 'main' as const, grid: layout.grid, baseY: 0}];
    const [sx, sy] = levels[0].grid.cellOf(start.x, start.z);
    const dist = levelDistance(levels, sx, sy, start.level ?? 0, layout.levelLinks)[0];
    for (const n of ext.annexes) {
      const z0 = layout.zombies.length;
      const r = placeServiceSpawns(layout, n, annexAreas(n), service, o.spawns, dist, root.fork(`service:${n.id}`));
      if (layout.zombies.length > z0) markSpawnContext(layout, z0, 'service');
      svc.set(n.id, r);
    }
  }
  phase('service');
  // report
  rep.lights = layout.lights.length - first.lights;
  rep.pickups = layout.pickups.length - first.pickups;
  for (const n of ext.annexes) {
    const ids = new Set(n.areas);
    const purposes: Record<string, number> = {};
    for (const a of annexAreas(n)) purposes[a.purpose ?? a.type] = (purposes[a.purpose ?? a.type] ?? 0) + 1;
    const props = layout.props.slice(first.props).filter(p => ids.has(p.area));
    const mr = mrep.get(n.id), signatures: Partial<Record<SignatureId, number>> = {};
    for (const s of mr?.built.values() ?? []) signatures[s] = (signatures[s] ?? 0) + 1;
    rep.annexes.push({
      id: n.id, purposes, props: props.length, holders: props.filter(p => p.host === undefined && isLootHolderKind(p.kind)).length, stash: stashes.filter(i => ids.has(layout.props[i].area)).length,
      lights: layout.lights.slice(first.lights).filter(l => ids.has(l.area)).length, pickups: layout.pickups.slice(first.pickups).filter(p => ids.has(p.area)).length,
      service: svc.get(n.id) ?? {count: 0, placed: 0},
      signatures, halls: annexAreas(n).filter(a => a.extHall).length, machines: mr?.machines ?? 0, solids: mr?.solids ?? 0, demoted: mr?.demoted ?? 0,
    });
  }
  rep.ms = now() - t0;
  REPORTS.set(layout, rep);
  return rep;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Purposes

const fitsRoom = (p: RoomPurpose, a: Area): boolean => {
  if (p.requires && !p.requires.some(isP7Kind)) return false;
  if (!p.min) return true;
  const s = Math.min(a.w, a.h) * CELL, l = Math.max(a.w, a.h) * CELL;
  return s >= p.min[0] && l >= p.min[1];
};

/** Retypes an area to its purpose's first slot when its RoomType is not one of the purpose's slots (the core's purpose ↔ slot rule). */
function setPurpose(a: Area, pid: string): void {
  const p = ROOM_PURPOSES[pid];
  a.purpose = pid;
  if (!p.slots.includes(a.type)) a.type = p.slots[0] as RoomType;
  if (pid !== 'service-corridor') a.label = p.label;
}

/** A utility purpose (existing id) fits an annex room: its size minimum and generated signature models (the core's rule). */
const utilityFits = (pid: string, a: Area): boolean => !!ROOM_PURPOSES[pid] && fitsRoom(ROOM_PURPOSES[pid], a);

/**
 * (Lane ROOMS) Every area of one annex takes a purpose through gen/annexRooms.ts assignAnnexRooms: machinery halls and about half
 * of the medium rooms a ROOM SIGNATURE (boiler / generator / sewage / overflow / spillway / turbine / ventilation; the bounded
 * anti-repetition rule), the other rooms a small utility purpose (existing ids, hop rule + repeat penalty), closets a weighted closet
 * purpose, corridors 'service-corridor'. Returns the plan the machinery pass builds the signature layouts from.
 */
function assignAnnexPurposes(layout: StationLayout, areas: readonly Area[], rng: Rng): AnnexRoomPlan {
  return assignAnnexRooms(layout, areas, rng, setPurpose, utilityFits);
}
/** (Lane ROOMS) The signature of an annex area's purpose (undefined for utility rooms / closets / corridors). */
export const annexSignatureOf = (a: Pick<Area, 'purpose'>): SignatureId | undefined => SIGNATURE_OF_PURPOSE[a.purpose ?? ''];

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Stash holders

/** Doors of an area (layout.doors joining it). */
const doorCount = (layout: StationLayout, a: Area) => layout.doors.reduce((n, d) => n + (d.a === a.id || d.b === a.id ? 1 : 0), 0);

/**
 * One stash holder per annex (two when it has >= stash.twoRooms rooms): a crate (then a tall cabinet) against a wall of its
 * dead-end rooms (one door; deepest first; rooms before closets), loot key ANNEX_STASH_KEY. Placed through the dresser's own
 * primitive (door zones, access strips, connectivity) before the purpose rules. Returns the prop indices.
 */
function placeStashes(layout: StationLayout, areas: readonly Area[], ctxOf: (a: Area) => PlaceCtx, rng: Rng): number[] {
  const C = ANNEX_CONTENT.stash;
  const rooms = areas.filter(a => a.kind === 'room' || a.kind === 'closet');
  const want = Math.min(C.kinds.length, rooms.filter(a => a.kind === 'room').length >= C.twoRooms ? 2 : 1);
  const order = rooms.slice().sort((p, q) => (doorCount(layout, p) === 1 ? 0 : 1) - (doorCount(layout, q) === 1 ? 0 : 1)
    || (p.kind === 'room' ? 0 : 1) - (q.kind === 'room' ? 0 : 1) || q.depth - p.depth || p.id - q.id);
  const out: number[] = [];
  const usedRooms = new Set<number>();
  for (let k = 0; k < want; k++) {
    for (const a of order) {
      if (usedRooms.has(a.id)) continue;
      const ctx = {...ctxOf(a), rng};
      const p = placeAgainstWall(ctx, a, C.kinds[k], {tries: 16, front: 0.6});
      if (!p) continue;
      p.purpose = ANNEX_STASH_KEY;
      out.push(layout.props.length - 1);
      usedRooms.add(a.id);
      break;
    }
  }
  return out;
}

/**
 * Loot keys of one annex's holders (props from index `from`): its deepest round(areaM2 / m2PerIntactHolder) holders keep their room
 * purpose's table (area depth desc, then placement order); every other holder except the stashes gets ANNEX_PICKED_KEY.
 */
function pickOver(layout: StationLayout, n: ServiceAnnex, from: number, stashes: ReadonlySet<number>, rng: Rng): void {
  const C = ANNEX_CONTENT.loot, ids = new Set(n.areas), list: number[] = [];
  for (let i = from; i < layout.props.length; i++) {
    const p = layout.props[i];
    if (ids.has(p.area) && !stashes.has(i) && p.host === undefined && isLootHolderKind(p.kind)) list.push(i);
  }
  const depth = (i: number) => layout.areas[layout.props[i].area].depth;
  list.sort((p, q) => depth(q) - depth(p) || p - q);
  const intact = Math.max(1, Math.round(n.areaM2 / ANNEX_CONTENT.m2PerIntactHolder));
  // playtest revision: SUPPLY holders by DEPTH BAND (area door-hop depth from the annex entry, thirds of its range): the entry band
  // gets `bands[0]` of them, the middle `bands[1]`, the deep end the rest (a band short of holders passes its share on); inside a
  // band a seeded pick, <= perArea per room. Then a capped few SCRAPS; every other non-intact holder is searched clean.
  // (a holder kind with its own table — a first-aid wall kit, an extinguisher cabinet — is never a supply / scraps pick: its loot key
  // does not decide what it holds)
  const rest = list.slice(intact).reverse().filter(i => rollsPurposeTable(layout.props[i].kind));
  for (const i of list.slice(intact)) if (!rollsPurposeTable(layout.props[i].kind)) layout.props[i].purpose = ANNEX_PICKED_KEY;
  const k = Math.min(rest.length, Math.max(C.supply[0], Math.min(C.supply[1], Math.round(n.areaM2 / C.m2PerSupply))));
  const ds = rest.map(depth), dMin = Math.min(...ds), dMax = Math.max(...ds);
  const bandOf = (i: number) => (dMax <= dMin ? 0 : Math.min(2, Math.floor((3 * (depth(i) - dMin)) / (dMax - dMin + 1e-9))));
  const want = [Math.ceil(k * C.bands[0]), Math.ceil(k * C.bands[1]), 0];
  want[2] = Math.max(0, k - want[0] - want[1]);
  const supply = new Set<number>(), perArea = new Map<number, number>();
  const take = (band: number, n: number) => {
    let got = 0;
    for (const i of rng.shuffle(rest.filter(i => bandOf(i) === band || band < 0))) {
      if (got >= n) break;
      const a = layout.props[i].area;
      if (supply.has(i) || (perArea.get(a) ?? 0) >= C.perArea) continue;
      supply.add(i); perArea.set(a, (perArea.get(a) ?? 0) + 1); got++;
    }
    return got;
  };
  let carry = 0;
  for (const b of [0, 1, 2]) carry = want[b] + carry - take(b, want[b] + carry);
  if (carry > 0) take(-1, carry);
  const others = rest.filter(i => !supply.has(i));
  const scraps = new Set(rng.shuffle(others.slice()).slice(0, Math.min(C.scrapsMax, Math.round(C.scrapsShare * others.length))));
  for (const i of rest) layout.props[i].purpose = supply.has(i) ? ANNEX_SUPPLY_KEY : scraps.has(i) ? ANNEX_SCRAPS_KEY : ANNEX_PICKED_KEY;
}

/**
 * Playtest revision: one storage holder in each annex room / closet that has none after the dressing (ANNEX_CONTENT.roomStorage
 * kinds in order, the first that fits against a wall through the dresser's own primitive: door zones, access strips,
 * connectivity). Returns the number placed. Its loot key comes from pickOver like every annex holder.
 */
function placeRoomStorage(layout: StationLayout, areas: readonly Area[], rng: Rng): number {
  const C = ANNEX_CONTENT.roomStorage, ids = new Set(areas.map(a => a.id));
  const has = new Set<number>();
  for (const p of layout.props) if (ids.has(p.area) && p.host === undefined && isLootHolderKind(p.kind)) has.add(p.area);
  const win = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity};
  for (const a of areas) { win.x0 = Math.min(win.x0, a.x - 4); win.y0 = Math.min(win.y0, a.y - 4); win.x1 = Math.max(win.x1, a.x + a.w + 3); win.y1 = Math.max(win.y1, a.y + a.h + 3); }
  const ctxs = new Map<number, PlaceCtx>();
  const ctxOf = (a: Area) => { const L = a.level ?? 0; let c = ctxs.get(L); if (!c) ctxs.set(L, (c = makePlaceCtx(layout, rng, L, win))); return c; };
  let n = 0;
  for (const a of areas) {
    if ((a.kind !== 'room' && a.kind !== 'closet') || has.has(a.id)) continue;
    for (const kind of a.kind === 'closet' ? C.closet : C.room) {
      const p = placeAgainstWall({...ctxOf(a), rng}, a, kind, {tries: 10, front: 0.6});
      if (!p) continue;
      // onto the area's own floor (as dressExtensionAreas lifts its placements; the annex lies at the bed floor, not at 0)
      const g = layout.grid, [cx, cy] = g.cellOf(p.x, p.z), k = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
      p.y += k >= 0 && g.cells[k] === FLOOR && g.rampIdx[k] < 0 ? g.floorOf(k) : areaBase(layout, a);
      n++;
      break;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Lights (untinted; states like gen/stationDress.ts applyLighting's lit / dim / dark profiles)

/** Fixture height under an area's (absolute) ceiling: the station rule (pendants under high ceilings, else 2 cm under it). */
const fixtureY = (ceil: number) => (ceil > PENDANT_Y + 0.15 ? PENDANT_Y : ceil - 0.02);

function pushLight(layout: StationLayout, a: Area, x: number, z: number, rot: number, warm: boolean): LightPlacement {
  const l: LightPlacement = {x: Math.round(x * 1000) / 1000, y: fixtureY(a.ceil), z: Math.round(z * 1000) / 1000, rot, area: a.id, broken: false, flicker: false, warm, power: 1, dying: false};
  layout.lights.push(l);
  return l;
}

/**
 * Annex fixtures: corridors a line every ~corridorStep m, rooms 1-2 along their long axis, closets one; each area's profile from
 * its purpose's light odds (else LIGHT_ODDS by type), then one step darker with lights.darken — the entry corridor (first annex
 * area) at least 'dim' (the way out always shows) — and fixture states exactly as applyLighting's profiles (lit: mostly working; dim: low output, about half dead,
 * flickering; dark: dead, sometimes one dying tube).
 */
function lightAnnex(layout: StationLayout, areas: readonly Area[], rng: Rng): void {
  areas.forEach((a, k) => {
    const P = purposeById(a.purpose);
    const odds: LightOdds = P?.light ?? LIGHT_ODDS[a.type] ?? [0, 0.4, 0.6];
    let prof = rng.weighted([['lit', odds[0]], ['dim', odds[1]], ['dark', odds[2]]] as const);
    if (prof !== 'dark' && rng.chance(ANNEX_CONTENT.lights.darken)) prof = prof === 'lit' ? 'dim' : 'dark';
    if (k === 0 && prof === 'dark') prof = 'dim';
    a.lighting = prof;
    const ax0 = a.x * CELL, az0 = a.y * CELL, aw = a.w * CELL, ah = a.h * CELL, alongX = aw >= ah, rot = alongX ? 0 : Math.PI / 2;
    // (lane ROOMS: a machinery hall gets a fixture every ~5 m of its long side, at least 2)
    const n = a.kind === 'closet' ? 1 : a.kind === 'service' ? Math.max(1, Math.round(Math.max(aw, ah) / ANNEX_CONTENT.lights.corridorStep))
      : a.extHall ? Math.max(2, Math.round(Math.max(aw, ah) / 5)) : Math.max(aw, ah) > 9 ? 2 : 1;
    const own: LightPlacement[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      own.push(pushLight(layout, a, alongX ? ax0 + aw * t : ax0 + aw / 2, alongX ? az0 + ah / 2 : az0 + ah * t, rot, !!P?.warm || rng.chance(0.25)));
    }
    if (prof === 'lit') {
      for (const l of own) { l.power = rng.range(0.9, 1); l.broken = rng.chance(0.07); l.flicker = !l.broken && rng.chance(0.1); }
      if (own.every(l => l.broken)) own[0].broken = false;
    } else if (prof === 'dim') {
      for (const l of own) { l.power = rng.range(0.42, 0.62); l.broken = rng.chance(0.45); l.flicker = !l.broken && rng.chance(0.35); }
      if (!own.some(l => !l.broken)) { const l = rng.pick(own); l.broken = false; l.flicker = rng.chance(0.5); }
    } else {
      for (const l of own) l.broken = true;
      if (rng.chance(0.35)) { const l = rng.pick(own); l.broken = false; l.dying = true; l.flicker = true; l.power = 0.5; }
    }
  });
}

/**
 * Tunnel fixtures: sparse ceiling fixtures on the centreline (the first at s in tunnel.first, then every tunnel.step m, none within
 * capClear of the cap), oriented along the path; most are dead, the rest dying or dim and flickering — the tunnels read much
 * darker than the station. The tunnel area's profile follows (dim with a steadily working fixture, else dark). Returns the count.
 */
function lightTunnel(layout: StationLayout, t: TrackTunnel, rng: Rng): number {
  const T = ANNEX_CONTENT.lights.tunnel, a = layout.areas[t.areas[0]], g = layout.grid;
  if (!a || !t.path.length) return 0;
  // arc length along the sampled path
  const cum = [0];
  for (let i = 1; i < t.path.length; i++) cum.push(cum[i - 1] + Math.hypot(t.path[i].x - t.path[i - 1].x, t.path[i].z - t.path[i - 1].z));
  const at = (s: number): {x: number; z: number; dx: number; dz: number} => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const p = t.path[i - 1], q = t.path[i], f = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    return {x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f, dx: (q.x - p.x) / len, dz: (q.z - p.z) / len};
  };
  const end = cum[cum.length - 1] - T.capClear;
  let n = 0, steady = false;
  for (let s = rng.range(T.first[0], T.first[1]); s < end; s += rng.range(T.step[0], T.step[1])) {
    const p = at(s), [cx, cy] = g.cellOf(p.x, p.z);
    if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== a.id) continue;
    const ceil = g.ceil[g.idx(cx, cy)] || t.ceilY;
    const l: LightPlacement = {x: Math.round(p.x * 1000) / 1000, y: fixtureY(ceil), z: Math.round(p.z * 1000) / 1000, rot: Math.atan2(-p.dz, p.dx), area: a.id, broken: false, flicker: false, warm: false, power: 1, dying: false};
    if (rng.chance(T.broken)) l.broken = true;
    else if (rng.chance(T.dying)) { l.dying = true; l.flicker = true; l.power = 0.5; }
    else { l.power = rng.range(T.power[0], T.power[1]); l.flicker = rng.chance(T.flicker); }
    layout.lights.push(l);
    n++;
    if (!l.broken && !l.dying) steady = true;
  }
  // the station's profile semantics: 'dark' = no steadily working fixture; a tunnel with a working (dim) one reads 'dim'
  a.lighting = steady ? 'dim' : 'dark';
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Loose floor finds (items/lootTables.ts ANNEX_FLOOR)

/**
 * One annex's loose floor finds, the Subway program's draw shape on this annex's fork: the boxes' copies, the kept dressings / kits,
 * the light finds; each lands in a weighted annex area (ammo / med: the purpose's `floor` weights; battery / flare:
 * FLOOR_ECONOMY.themeWeight by theme) on a free floor cell (walkable, off the door zones, not taken; cells by a wall twice as likely),
 * 10 tries; a find with no cell places nothing. Pickups rest on the cell floor (absolute y).
 */
function placeAnnexFloor(layout: StationLayout, areas: readonly Area[], loot: LootProfile, rng: Rng): void {
  const prog = loot.tables.floor.annex;
  if (!prog || !areas.length) return;
  const g = layout.grid, ids = new Set(areas.map(a => a.id));
  const zone = new Set<number>();
  for (const d of layout.doors) {
    if (!ids.has(d.a) && !ids.has(d.b)) continue;
    for (let y = d.y - 2; y < d.y + d.h + 2; y++) for (let x = d.x - 2; x < d.x + d.w + 2; x++) if (g.inBounds(x, y)) zone.add(g.idx(x, y));
  }
  const used = new Set<number>();
  const found: [string, number][] = [];
  for (const b of prog.boxes) { const [lo, hi] = floorCount(loot, econCat(b.itemId), b.n); for (let i = 0, n = rng.int(lo, hi); i < n; i++) found.push([b.itemId, b.count]); }
  for (const k of prog.kept) {
    const [lo, hi] = floorCount(loot, econCat(k.itemId), k.n), keep = floorChance(loot, econCat(k.itemId), k.keep);
    for (let i = 0, n = rng.int(lo, hi); i < n; i++) if (rng.chance(keep)) found.push([k.itemId, k.count]);
  }
  for (const c of prog.light) if (rng.chance(floorChance(loot, econCat(c.itemId), c.chance))) found.push([c.itemId, c.count]);
  const pool = (cat: 'ammo' | 'med' | 'light'): [Area, number][] => areas.map(a => {
    if (cat === 'light') return [a, FLOOR_ECONOMY.themeWeight[lootTheme(a.purpose ?? a.type)]] as [Area, number];
    return [a, purposeById(a.purpose)?.floor?.[cat] ?? 0] as [Area, number];
  }).filter(e => e[1] > 0);
  const pools = {ammo: pool('ammo'), med: pool('med'), light: pool('light')};
  const place = (itemId: string, count: number, a: Area): boolean => {
    const cands: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g.idx(x, y);
      if (!g.walkable(x, y) || g.area[i] !== a.id || zone.has(i) || used.has(i)) continue;
      cands.push(i);
      if (!g.walkable(x + 1, y) || !g.walkable(x - 1, y) || !g.walkable(x, y + 1) || !g.walkable(x, y - 1)) cands.push(i);
    }
    if (!cands.length) return false;
    const i = rng.pick(cands), x = i % g.w, y = (i - x) / g.w, [wx, wz] = g.center(x, y);
    used.add(i);
    const p: PickupPlacement = {itemId, count, x: wx + rng.range(-0.1, 0.1), y: g.floorOf(i), z: wz + rng.range(-0.1, 0.1), area: a.id};
    layout.pickups.push(p);
    return true;
  };
  for (const [id, count] of found) {
    const list = pools[id.startsWith('ammo') ? 'ammo' : id === BATTERY_ID || id === FLARE_ID ? 'light' : 'med'];
    if (!list.length || !(id in ITEMS)) continue;
    for (let t = 0; t < 10; t++) if (place(id, count, rng.weighted(list))) break;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 6. Service spawns (the 'service' context's per-annex zone budget)

/**
 * One annex's run of the 'service' context — the station placement's rules (gen/stationDress.ts placeSpawns) on this annex's own
 * fork, in its areas only: count = U{count}, the zombie types of that many spawns (the level's type roll); candidate cells =
 * walkable FLOOR of an annex area, >= startCells walking cells from the start, clearCells clear all round, >= landingKeepM from
 * the annex's entry door (its keep point), the area's effective weight > 0; weighted area order (Efraimidis-Spirakis keys), cap
 * passes, `tries` picks per visit, >= spacingM from every enemy already placed. Appends to layout.zombies (y = the cell's absolute
 * floor: the trackbed); returns the drawn count and the placed count.
 */
function placeServiceSpawns(layout: StationLayout, n: ServiceAnnex, areas: readonly Area[], ctx: SpawnContextRule, profile: SpawnProfile, dist: Int32Array, rng: Rng): {count: number; placed: number} {
  const g = layout.grid, pl = ctx.placement;
  const count = rng.int(ctx.count[0], ctx.count[1]);
  const types = rollZombieTypes(rng, count, profile.zombieTypes);
  const keep = pl.landingKeepM ?? 0;
  const weightOf = new Map<number, number>();
  for (const a of areas) weightOf.set(a.id, areaSpawnWeight(pl.areaWeights, profile, a));
  const byArea = new Map<number, [number, number][]>();
  for (const a of areas) {
    if (!((weightOf.get(a.id) ?? 0) > 0)) continue;
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || g.area[i] !== a.id || dist[i] < pl.startCells || !clearAround(g, x, y, pl.clearCells)) continue;
      const [cx, cz] = g.center(x, y);
      if (Math.hypot(cx - n.exit.x, cz - n.exit.z) < keep) continue;
      let l = byArea.get(a.id);
      if (!l) byArea.set(a.id, (l = []));
      l.push([x, y]);
    }
  }
  reportSpawnCandidates(layout, 'service', byArea);
  const order = [...byArea.keys()].map(id => ({id, k: Math.pow(rng.next(), 1 / weightOf.get(id)!)})).sort((p, q) => q.k - p.k).map(o => o.id);
  // Playtest revision (studio-alpha-track2-playtest-revision-20261031-01): ENCOUNTERABLE placement. Measured on main 312a653: an
  // ordinary 10-room route met 0-2 of an annex's 3-5 enemies (closed rooms, 5 m spacing anywhere), and station gunfire (heard by 3D
  // straight-line distance through rock, Game.alertZombies) pulled the near ones out of a hatch annex before the player arrived.
  // Now the count is split over three DEPTH BANDS of the candidate rooms (entry / middle / deep: equal quotas, the remainder to the
  // middle; a band without room passes its quota on), and inside a band cells beyond SERVICE_EARSHOT_M of every core station floor
  // cell are preferred (all cells when none is).
  const depths = order.map(id => layout.areas[id].depth), dMin = Math.min(...depths), dMax = Math.max(...depths);
  const bandOf = (id: number) => (dMax <= dMin ? 1 : Math.min(2, Math.floor((3 * (layout.areas[id].depth - dMin)) / (dMax - dMin + 1e-9))));
  const quota = [Math.floor(count / 3), count - 2 * Math.floor(count / 3), Math.floor(count / 3)];
  const quiet = coreEarshot(layout, areas, SERVICE_EARSHOT_M);
  const quietCells = new Map<number, [number, number][]>();
  for (const [id, cells] of byArea) { const q = cells.filter(([x, y]) => { const [cx, cz] = g.center(x, y); return !quiet(cx, cz); }); if (q.length) quietCells.set(id, q); }
  const perArea = new Map<number, number>(), perBand = [0, 0, 0];
  let placed = 0;
  for (const band of [1, 0, 2, -1]) for (const cap of pl.caps.passes) {
    for (const id of order) {
      if (placed >= count) break;
      if (band >= 0 && (bandOf(id) !== band || perBand[band] >= quota[band])) continue;
      const a = layout.areas[id];
      if ((perArea.get(id) ?? 0) >= areaCap(pl.caps, a, cap)) continue;
      const cells = quietCells.get(id) ?? byArea.get(id)!;
      for (let t = 0; t < pl.tries; t++) {
        const [x, y] = rng.pick(cells);
        const [zx, zz] = g.center(x, y);
        if (layout.zombies.some(z => (z.level ?? 0) === 0 && Math.hypot(z.x - zx, z.z - zz) < pl.spacingM)) continue;
        perArea.set(id, (perArea.get(id) ?? 0) + 1);
        perBand[bandOf(id)]++;
        // y: the spawn's absolute floor height (ZombieSpawn.y; the annex lies on the trackbed, not at the main level's 0)
        layout.zombies.push({x: zx, z: zz, y: g.floorOf(g.idx(x, y)), yaw: rng.range(-Math.PI, Math.PI), type: types[placed], area: id});
        placed++;
        break;
      }
    }
  }
  return {count, placed};
}

/** Playtest revision: rifle earshot through rock (weapons.ts rifle noise 30 m x HEARING.wall 0.6). */
export const SERVICE_EARSHOT_M = 18;

/**
 * Playtest revision: "is (x, z) within `r` m (plan distance) of a CORE station floor cell" — the core cells (any storey, non-extension
 * area, walkable) around the annex's box, bucketed into 2 m tiles; a tile counts when its centre is within r + its half-diagonal
 * (conservative). Cheap: one pass over the box per annex.
 */
function coreEarshot(layout: StationLayout, areas: readonly Area[], r: number): (x: number, z: number) => boolean {
  const g = layout.grid, pad = Math.ceil(r / CELL) + 2, B = 4;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of areas) { x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + a.w); y1 = Math.max(y1, a.y + a.h); }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(g.w - 1, x1 + pad); y1 = Math.min(g.h - 1, y1 + pad);
  const bw = Math.floor((x1 - x0) / B) + 1, bh = Math.floor((y1 - y0) / B) + 1, occ = new Uint8Array(bw * bh);
  const grids = layout.levels?.length ? layout.levels.map(L => L.grid) : [g];
  for (const G of grids) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const ar = G.area[G.idx(x, y)];
    if (ar < 0 || isExtensionArea(layout.areas[ar]) || !G.walkable(x, y)) continue;
    occ[Math.floor((y - y0) / B) * bw + Math.floor((x - x0) / B)] = 1;
  }
  const tile = B * CELL, reach = r + tile * Math.SQRT1_2, rb = Math.ceil(reach / tile);
  return (wx, wz) => {
    const bx = Math.floor((wx / CELL - x0) / B), by = Math.floor((wz / CELL - y0) / B);
    for (let j = by - rb; j <= by + rb; j++) for (let i = bx - rb; i <= bx + rb; i++) {
      if (i < 0 || j < 0 || i >= bw || j >= bh || !occ[j * bw + i]) continue;
      if (Math.hypot((x0 + (i + 0.5) * B) * CELL - wx, (y0 + (j + 0.5) * B) * CELL - wz) <= reach) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 5. Steam vents

/**
 * Up to ventsPerAnnex steam spots per annex: first over its plant (pump skids, water heaters, valve manifolds, compressors: on the
 * wall behind the prop, above it at pipe height), then on corridor / room walls (a wall-adjacent free cell, the wall face), >= 3 m
 * apart; blowing out of the wall and a little up. Visual only (world/trackExt/steam.ts), never the gas field.
 */
function annexVents(layout: StationLayout, areas: readonly Area[], rng: Rng): AnnexVent[] {
  const C = ANNEX_CONTENT, g = layout.grid, ids = new Set(areas.map(a => a.id)), out: AnnexVent[] = [];
  const far = (x: number, z: number) => out.every(v => Math.hypot(v.x - x, v.z - z) >= 3);
  const ceilAt = (i: number) => (g.hasCeil(i) ? g.ceil[i] : g.floorOf(i) + 2.6);
  // over the plant: the prop's back wall (its yaw faces away from the wall it stands against)
  const plant = layout.props.filter(p => ids.has(p.area) && C.ventKinds.includes(p.kind) && !p.host);
  for (const p of rng.shuffle(plant.slice())) {
    if (out.length >= C.ventsPerAnnex) break;
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
    const back = Math.abs(fx) ? p.hx : p.hz;
    const wx = p.x - fx * (back + 0.02), wz = p.z - fz * (back + 0.02);
    const [cx, cy] = g.cellOf(p.x - fx * (back + 0.3), p.z - fz * (back + 0.3));
    if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== SOLID || !far(wx, wz)) continue;
    const [px, py] = g.cellOf(p.x, p.z), i = g.idx(px, py), floor = g.floorOf(i);
    const y = Math.min(ceilAt(i) - 0.35, Math.max(p.y + p.h + 0.25, floor + 1.6));
    out.push({x: r3(wx), y: r3(y), z: r3(wz), dir: {x: fx * 0.8, y: 0.35, z: fz * 0.8}, area: p.area});
  }
  // walls of the rooms / corridors (rooms first), one try per area in seeded order
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (const a of rng.shuffle(areas.slice()).sort((p, q) => (p.kind === 'room' ? 0 : 1) - (q.kind === 'room' ? 0 : 1))) {
    if (out.length >= C.ventsPerAnnex) break;
    const cand: {x: number; y: number; d: readonly [number, number]}[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i]) continue;
      for (const d of dirs) if (g.get(x + d[0], y + d[1]) === SOLID) cand.push({x, y, d});
    }
    if (!cand.length) continue;
    const c = rng.pick(cand), i = g.idx(c.x, c.y);
    const wx = (c.x + 0.5 + c.d[0] * 0.45) * CELL, wz = (c.y + 0.5 + c.d[1] * 0.45) * CELL;
    if (!far(wx, wz)) continue;
    const floor = g.floorOf(i), y = Math.min(ceilAt(i) - 0.35, floor + 1.5 + rng.next() * 0.6);
    out.push({x: r3(wx), y: r3(y), z: r3(wz), dir: {x: -c.d[0] * 0.8, y: 0.35, z: -c.d[1] * 0.8}, area: a.id});
  }
  return out;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
