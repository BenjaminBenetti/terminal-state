// Task studio-bunker-rework-20261109-205115-01: THE BUNKER, layout version 2 — the lead's PIPELINE round the shared spine
// (gen/bunker/v2/spine.ts) and the six floor modules (gen/bunker/v2/floor0.ts … floor5.ts; contract gen/bunker/v2/floorApi.ts).
//
// Per attempt: spine carve (track bed + platform, the vault vestibule, the two scissor cores; the lift shaft and the voids' wells stay
// rock) → each floor's carve() inside its frame → the anchor checks (every apron is open floor of ONE floor area) and the cut stair
// landing doors → the vault lane (gen/bunker/v2/vault.ts) → crop / links / apertures / ladders / rails → start → the vault door, the
// three generators (in the floors' generator rooms) and the core cluster (in floor 5's core hall) → hazards from the floors'
// declarations → ONE station dresser pass (anchor aprons, objective fronts and the threshold held clear) → each floor's dress() (its
// props lifted onto its floor) → the shelter-wide plates → enemies / supplies / weapon finds (the shared Bunker passes) → lighting →
// traversal → layout.bunker (version 2: + the cargo lift + the voids) → archetypes / family spacing → bunkerIssues + bunkerV2Issues.
// Version 1 stations never reach this file (gen/bunker/index.ts dispatches on ctx.layoutVersion).

import {Rng, hashString} from '../../../core/rng';
import {CELL, FLOOR, VOID} from '../../grid';
import {Kit, type TrenchCells} from '../../stationKit';
import {deriveRails, levelDistance, registerApertures} from '../../levelGen';
import {Levels, type Level, type LevelLink, type RailRun} from '../../levels';
import {applyLighting, dress} from '../../stationDress';
import {STAIR, finishTraversal, layStairRun, placeLadders, type StairFlight} from '../../traversal';
import {cropKit} from '../../office/common';
import {holdCells} from '../../office/transit';
import type {SpawnField} from '../../office/spawns';
import {placeMallSupplies} from '../../mall/supplies';
import {placeWeaponFinds} from '../../weaponFinds';
import {pathRails} from '../../reactor/pathsGen';
import {assignEnemyArchetypes} from '../../../ai/creatureSpawn';
import {applyFamilySpacing} from '../../../ai/familySpacing';
import {spawnProfile, type SpawnProfile} from '../../../ai/spawnTables';
import {lootProfile, type LootProfile} from '../../../items/lootTables';
import type {LevelId, SectionGenContext} from '../../../levels/types';
import {TRENCH_DEPTH, type Area, type LightPlacement, type PickupPlacement, type Rect, type StationLayout} from '../../stationTypes';
import {BUNKER_CORE_KIND, BUNKER_GENERATOR_KIND, type BunkerGasZone, type BunkerInfo} from '../bunkerTypes';
import {bunkerNameOf} from '../names';
import {heroAgainstWall, heroFront, heroWalls, liftFrom, shelterDx} from '../dress';
import {GAS_STRENGTH, seedCells} from '../hazards';
import {placeBunkerEnemies} from '../spawns';
import {bunkerIssues} from '../validate';
import type {BunkerFloorModule, FloorCarveCtx, FloorCarveResult, FloorDressCtx} from './floorApi';
import {BUNKER_V2_FLOORS} from './floors';
import {bunkerSpine, rectInside, rectsOverlap, V2, V2_BASES, V2_CORE_LEVEL, V2_GENERATOR_LEVELS, V2_LEVELS, V2_PROGRAMMES, V2_STOREY_LABELS, type BunkerSpine, type V2Anchor, type V2Core} from './spine';
import {carveVaultLane, placeVaultDoor, type VaultCarve} from './vault';
import {liftRecord} from './liftPlan';
import {bunkerV2Issues} from './validate';
import {BUNKER_LAYOUT_VERSION} from '../layoutVersion';
import {BUNKER_S_RATIONS_VERSION, placeStationRations} from './stationRations'; // (task gameplay-feedback-20261111, lane FUEL-LOOT)

const BUNKER_ID: LevelId = 'bunker';
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface BunkerV2Options {
  loot?: LootProfile;
  spawns?: SpawnProfile;
  /** Tests / floor QA: replace floor modules (by storey). */
  floors?: Partial<Record<number, BunkerFloorModule>>;
}

const ATTEMPTS = 8;
/** QA / tests: the last generation's timing, attempts, why attempts were refused, the last issues, per-floor carve failures. */
export const BUNKER_V2_STATS = {ms: 0, attempts: 0, refused: {} as Record<string, number>, issues: [] as string[], floorFails: {} as Record<string, number>};
const refuse = (why: string): null => { BUNKER_V2_STATS.refused[why] = (BUNKER_V2_STATS.refused[why] ?? 0) + 1; return null; };

/** What the spine carved (canvas = grid cells). */
export interface SpineCarve {
  sp: BunkerSpine;
  bed: Rect;
  trench: TrenchCells;
  platform: Area;
  vest: Area;
  /** Per core: the landing area per storey, the run areas + flight ids per storey pair. */
  cores: {core: V2Core; landing: Record<number, number>; runs: {upper: number; area: number; flights: number[]}[]}[];
}

/** The one continuous version-2 Bunker layout. */
export function generateBunkerV2(ctx: SectionGenContext, opts: BunkerV2Options = {}): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const loot = opts.loot ?? lootProfile(BUNKER_ID);
  const spawns = opts.spawns ?? spawnProfile(BUNKER_ID);
  const seed = hashString('terminal-state:bunker-v2', ctx.levelSeed >>> 0);
  const floors = BUNKER_V2_FLOORS.map((f, i) => opts.floors?.[i] ?? f);
  let fallback: StationLayout | null = null;
  BUNKER_V2_STATS.refused = {};
  BUNKER_V2_STATS.floorFails = {};
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(s, seed, attempt, ctx, loot, spawns, floors);
    BUNKER_V2_STATS.attempts = attempt + 1;
    if (!layout) continue;
    const issues = [...bunkerIssues(layout, {startCells: startCells(spawns)}), ...bunkerV2Issues(layout)];
    BUNKER_V2_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) refuse(i);
    fallback ??= layout;
  }
  BUNKER_V2_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error(`bunker v2 generation failed: ${JSON.stringify(BUNKER_V2_STATS.refused)} floors ${JSON.stringify(BUNKER_V2_STATS.floorFails)}`);
}

const startCells = (p: SpawnProfile): number => p.contexts.station?.placement.startCells ?? 36;

// ---------------------------------------------------------------------------------------------------------------------------------
// The spine carve

function carveSpine(k: Kit, sp: BunkerSpine): SpineCarve {
  const S = sp.station, g0 = k.grid(0);
  // storey 0: the one-track bed + the side platform (the train parks here; its edge faces north)
  const roof = V2.clear.platform;
  for (let y = S.bed.y; y < S.bed.y + S.bed.h; y++) for (let x = S.bed.x; x < S.bed.x + S.bed.w; x++) {
    const i = g0.idx(x, y);
    g0.cells[i] = VOID; g0.ceil[i] = roof; g0.floor[i] = -TRENCH_DEPTH;
  }
  g0.voidFloor = -TRENCH_DEPTH;
  const P = S.platform;
  const trench: TrenchCells = {x0: S.bed.x, x1: S.bed.x + S.bed.w, y0: S.bed.y, y1: P.y, px0: P.x, px1: P.x + P.w, tracks: [P.y * CELL - 2.0], third: [-1], columns: false, ceil: roof};
  k.trenches.push(trench);
  const platform = k.addArea(P, 'platform', 'platform', roof, -1, {label: 'Platform'});
  platform.edge = 'N';
  platform.platformNo = 1;
  const vest = k.addArea(S.vest, 'concourse', 'concourse', V2.clear.vest, platform.id, {label: 'Vault vestibule', publicSpace: true});
  // the two scissor cores
  const cores: SpineCarve['cores'] = [];
  for (const c of sp.cores) cores.push(carveCore(k, c));
  return {sp, bed: S.bed, trench, platform, vest, cores};
}

/** One scissor core (the v1 shelter's carveCore on the fixed v2 frame): a landing per storey, one run per storey pair. */
function carveCore(k: Kit, c: V2Core): SpineCarve['cores'][number] {
  const Cr = V2.core;
  const name = c.id === 'A' ? 'Main stair' : 'Service stair';
  const short = (L: number) => V2_STOREY_LABELS[L].replace(/ — .*$/, '');
  const landing: Record<number, number> = {};
  for (let L = c.from; L <= c.to; L++) {
    const end = c.end[L];
    const lr: Rect = {x: c.rect.x, y: end === 'lo' ? c.rect.y : c.rect.y + c.rect.h - Cr.landing, w: c.rect.w, h: Cr.landing};
    const a = k.addArea(lr, 'room', 'stair-core', r2(V2_BASES[L] + V2.clear.landing), -1, {...(L ? {level: L, floorY: V2_BASES[L]} : {}), role: 'landing', publicSpace: false, label: `${name} · ${short(L)}`});
    landing[L] = a.id;
  }
  const runs: SpineCarve['cores'][number]['runs'] = [];
  for (let L = c.from; L < c.to; L++) {
    const lane = (L - c.from) % 2;
    const rr: Rect = {x: c.rect.x + lane * (c.laneW + 1), y: c.rect.y + Cr.landing, w: c.laneW, h: c.rect.h - 2 * Cr.landing};
    const area = k.addArea(rr, 'room', 'stair-core', r2(V2_BASES[L] + STAIR.headroom), landing[L], {
      ...(L ? {level: L, floorY: V2_BASES[L]} : {}), also: [L + 1], role: 'stair', publicSpace: false, label: `${name} · ${short(L)} – ${short(L + 1)}`,
    });
    const fl: StairFlight[] = layStairRun([k.grid(L), k.grid(L + 1)], rr, area.id, 'z', c.end[L], V2_BASES[L], V2_BASES[L + 1], STAIR);
    const ids: number[] = [];
    for (const q of fl) { q.id = k.flights.length; ids.push(q.id); k.flights.push(q); }
    runs.push({upper: L, area: area.id, flights: ids});
  }
  return {core: c, landing, runs};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The floors

function carveCtx(k: Kit, sp: BunkerSpine, level: number, rng: Rng): FloorCarveCtx {
  const frame = sp.storeys[level], base = frame.base;
  const free = (r: Rect): boolean => r.w >= 1 && r.h >= 1 && rectInside(r, frame.envelope) && !frame.keepOut.some(q => rectsOverlap(q, r)) && k.rectFree(r, level);
  return {
    k, spine: sp, frame, level, base, rng,
    free,
    room(r, kind, type, clear, parent, opts = {}) {
      if (!free(r)) return null;
      const a = k.addArea(r, kind, type, r2(base + clear), parent, {...(level ? {level, floorY: base} : {}), label: opts.label, publicSpace: opts.publicSpace ?? false, role: opts.role});
      if (opts.purpose) a.purpose = opts.purpose;
      if (opts.noFloorLoot) a.noFloorLoot = true;
      return a;
    },
    door: (gap, a, b, height, arch = false) => k.carveDoor(gap, a, b, height, arch),
    connect: (a, b, width, height, pick = 'mid') => k.connect(a, b, width, height, {pick}),
  };
}

/** The ONE floor area over an anchor's apron (every apron cell open floor of it), or null. */
function apronArea(k: Kit, a: V2Anchor): Area | null {
  const g = k.grid(a.level);
  let id = -2;
  for (let y = a.apron.y; y < a.apron.y + a.apron.h; y++) for (let x = a.apron.x; x < a.apron.x + a.apron.w; x++) {
    const i = g.idx(x, y);
    if (g.cells[i] !== FLOOR) return null;
    if (id === -2) id = g.area[i]; else if (g.area[i] !== id) return null;
  }
  return id >= 0 ? k.areas[id] : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// One attempt

function tryLevel(genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, loot: LootProfile, spawns: SpawnProfile, floors: readonly BunkerFloorModule[]): StationLayout | null {
  const rng = new Rng(genSeed);
  const sp = bunkerSpine();
  const k = new Kit(rng, {levels: V2_LEVELS, w: sp.W, h: sp.H});
  const sc = carveSpine(k, sp);
  // --- the floors (station first, then down) ----------------------------------------------------------------------------------
  const carved: FloorCarveResult[] = [];
  for (let L = 0; L < V2_LEVELS; L++) {
    const f = floors[L];
    let res: FloorCarveResult | null = null;
    try { res = f.carve(carveCtx(k, sp, L, rng.fork(`floor-${L}`))); } catch (e) { BUNKER_V2_STATS.floorFails[`L${L}: ${(e as Error).message}`] = (BUNKER_V2_STATS.floorFails[`L${L}: ${(e as Error).message}`] ?? 0) + 1; res = null; }
    if (!res) { BUNKER_V2_STATS.floorFails[`L${L}`] = (BUNKER_V2_STATS.floorFails[`L${L}`] ?? 0) + 1; return refuse(`floor ${L} carve`); }
    carved.push(res);
  }
  // --- anchors: aprons served, stair landing doors cut ---------------------------------------------------------------------------
  for (const fr of sp.storeys) for (const an of fr.anchors) {
    const outside = fr.level === 0 && (an.id === 'stairA' || an.id === 'lift') ? sc.vest : apronArea(k, an);
    if (!outside) return refuse(`L${fr.level} ${an.id} apron`);
    if (an.id === 'stairA' || an.id === 'stairB') {
      const c = sc.cores.find(q => q.core.id === (an.id === 'stairA' ? 'A' : 'B'))!;
      k.carveDoor(an.gate, outside, k.areas[c.landing[fr.level]], an.height, false);
    }
  }
  // the voids: the owner's tall area covers the void exactly; nothing else on the owner storey rises above the storey above's floor
  for (const v of sp.voids) {
    const g = k.grid(v.lower);
    for (let i = 0; i < g.cells.length; i++) {
      if (g.cells[i] !== FLOOR || g.ceil[i] <= V2_BASES[v.upper] - 0.3 || k.areas[g.area[i]]?.role === 'stair') continue; // (stair runs: the spine's)
      const x = i % g.w, y = (i - x) / g.w;
      if (!(x >= v.rect.x && x < v.rect.x + v.rect.w && y >= v.rect.y && y < v.rect.y + v.rect.h)) return refuse(`${v.id} tall cell outside`);
    }
  }
  // --- the vault lane (hall side = floor 0's area over the vaultHall apron) ----------------------------------------------------------
  const vaultAnchor = sp.storeys[0].anchors.find(a => a.id === 'vaultHall')!;
  const hall = apronArea(k, vaultAnchor);
  if (!hall) return refuse('vault hall');
  const vault: VaultCarve = carveVaultLane(k, sp, hall, sc.vest);
  // --- crop (fixed origin), levels, links, apertures, ladders, rails ------------------------------------------------------------
  const c = cropKit(k, Array.from({length: V2_LEVELS}, (_, i) => i), 0, 0, sp.W, sp.H);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : id === 4 ? 'lower' : 'ring', grid, baseY: V2_BASES[id]}));
  const links: LevelLink[] = [];
  for (const core of sc.cores) for (const run of core.runs) {
    const fl = run.flights.map(i => c.flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    links.push({id: links.length, kind: 'stairs', lower: run.upper + 1, upper: run.upper, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
  }
  const name = bunkerNameOf(ctx.levelSeed);
  const layout: StationLayout = {
    seed, attempt, name, archetype: 'side-mezzanine', towards: ['Deep Line', 'Shelter Siding'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: sc.platform.id, platforms: [sc.platform.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  sc.platform.towardsN = layout.towards[0];
  registerApertures(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  layout.rails = bunkerRails(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';
  const openings = carved[0].openings ?? [];
  if (!openings.length) return refuse('no platform openings');
  const start = startOf(layout, sc, openings);

  // --- the vault door, the generators, the core cluster (collision props) before the dresser -----------------------------------------
  const holds: {level: number; cells: number[]}[] = [];
  const vaultProp = placeVaultDoor(layout, vault, hall, sc.vest, rng.fork('vault'), holds);
  const gens: {prop: number; level: number; area: number; label: string}[] = [];
  for (let i = 0; i < V2_GENERATOR_LEVELS.length; i++) {
    const L = V2_GENERATOR_LEVELS[i], spec = carved[L].generator;
    if (!spec) return refuse(`L${L} no generator room`);
    const a = layout.areas[spec.area];
    const D = shelterDx(layout, L, rng.fork(`gen-${L}`), [a]);
    const p = heroAgainstWall(D, a, BUNKER_GENERATOR_KIND, spec.walls ?? heroWalls(D, a), 1.0, 2.0);
    if (!p) return refuse(`L${L} generator placement`);
    p.y = 0;
    gens.push({prop: layout.props.indexOf(p), level: L, area: a.id, label: spec.label});
    holds.push({level: L, cells: heroFront(layout, p, 2.0, 1).filter(q => { const g = layout.levels[L].grid; return g.cells[q] === FLOOR && g.area[q] === a.id && !g.blocked[q]; })});
  }
  const coreSpec = carved[V2_CORE_LEVEL].core;
  if (!coreSpec) return refuse('no core hall');
  let coreRec: {prop: number; level: number; area: number};
  {
    const a = layout.areas[coreSpec.area];
    const D = shelterDx(layout, V2_CORE_LEVEL, rng.fork('core'), [a]);
    const shorts = a.w >= a.h ? ['W', 'E'] : ['N', 'S'];
    const walls = coreSpec.walls ?? heroWalls(D, a);
    const order = coreSpec.walls ? walls : [...walls.filter(s => shorts.includes(s)), ...walls.filter(s => !shorts.includes(s))];
    const p = heroAgainstWall(D, a, BUNKER_CORE_KIND, order, 1.2, 3.0);
    if (!p) return refuse('core placement');
    p.y = 0;
    coreRec = {prop: layout.props.indexOf(p), level: V2_CORE_LEVEL, area: a.id};
    holds.push({level: V2_CORE_LEVEL, cells: heroFront(layout, p, 3.0, 1).filter(q => { const g = layout.levels[V2_CORE_LEVEL].grid; return g.cells[q] === FLOOR && g.area[q] === a.id && !g.blocked[q]; })});
  }
  // every anchor apron stays clear (stair landings, the lift's loading bay)
  for (const fr of sp.storeys) for (const an of fr.anchors) {
    if (an.id === 'vaultHall') continue;
    const g = layout.levels[fr.level].grid, cells: number[] = [];
    for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) { const i = g.idx(x, y); if (g.cells[i] === FLOOR && !g.blocked[i]) cells.push(i); }
    holds.push({level: fr.level, cells});
  }

  // --- hazards from the floors' declarations ---------------------------------------------------------------------------------------
  const hz = planV2Hazards(layout, carved, gens, coreRec, rng.fork('hazards'));
  if (!hz) return refuse('hazards');

  // --- dressing: ONE station dresser pass with the held cells, then each floor's own --------------------------------------------------
  const release = holdCells(layout, holds);
  dress(layout, rng.fork('dress'));
  release();
  const heldBy = new Map<number, Set<number>>();
  for (const h of holds) { const s = heldBy.get(h.level) ?? new Set<number>(); for (const i of h.cells) s.add(i); heldBy.set(h.level, s); }
  for (let L = 0; L < V2_LEVELS; L++) {
    const f = floors[L];
    if (!f.dress) continue;
    const from = layout.props.length;
    const dctx: FloorDressCtx = {layout, spine: sp, frame: sp.storeys[L], level: L, base: V2_BASES[L], rng: rng.fork(`floor-dress-${L}`), carved: carved[L], held: heldBy.get(L) ?? new Set()};
    const rel = holdCells(layout, [{level: L, cells: [...(heldBy.get(L) ?? [])]}]);
    try { f.dress(dctx); } finally { rel(); }
    liftFrom(layout, L, from);
  }

  // --- whole-level populations --------------------------------------------------------------------------------------------------
  const g0 = layout.grid, [sx, sy] = g0.cellOf(start.x, start.z);
  const keep: SpawnField['keep'] = [];
  for (const kk of layout.levelLinks) keep.push({level: kk.lower, x: kk.bottom.x, z: kk.bottom.z}, {level: kk.upper, x: kk.top.x, z: kk.top.z});
  for (const gr of gens) { const p = layout.props[gr.prop]; keep.push({level: gr.level, x: p.x, z: p.z}); }
  { const p = layout.props[coreRec.prop]; keep.push({level: coreRec.level, x: p.x, z: p.z}); }
  for (let L = 0; L < V2_LEVELS; L++) { const an = sp.storeys[L].anchors.find(a => a.id === 'lift')!; keep.push({level: L, x: (an.apron.x + an.apron.w / 2) * CELL, z: (an.apron.y + an.apron.h / 2) * CELL}); }
  const field: SpawnField = {dist: levelDistance(layout.levels, sx, sy, 0, layout.levelLinks), keep};
  placeBunkerEnemies(layout, rng.fork('bunker-enemies'), field, spawns, hz.damp);
  let stationFloor: PickupPlacement[] = [];
  for (let lv = 0; lv < V2_LEVELS; lv++) {
    const placed = placeMallSupplies(layout, rng.fork(`bunker-supplies-${lv}`), field, [lv], lv === 0 ? 'pit' : 'ring', loot);
    if (lv === 0) stationFloor = placed;
  }
  placeWeaponFinds(layout, rng.fork('weaponFinds'), layout.startWeapon ?? 'rifle');
  // (task gameplay-feedback-20261111, lane FUEL-LOOT) layout version 3: storey S trades half its ammo opportunities for food / drink
  // (./stationRations.ts; no random stream read: storeys 1-5 and every other draw stay version 2's)
  if ((ctx.layoutVersion ?? BUNKER_LAYOUT_VERSION) >= BUNKER_S_RATIONS_VERSION) placeStationRations(layout, loot, stationFloor, layout.seed);

  // --- lighting, traversal, the record -------------------------------------------------------------------------------------------
  applyLighting(layout, rng.fork('lighting'));
  v2Lights(layout, sc, gens, coreRec, hz.aged, rng.fork('shelter-lights'), carved.flatMap(r => r.lit ?? []));
  finishTraversal(layout);
  const vp = layout.props[vaultProp];
  const info: BunkerInfo = {
    version: 2,
    name,
    storeys: Array.from({length: V2_LEVELS}, (_, i) => ({level: i, baseY: V2_BASES[i], label: V2_STOREY_LABELS[i], programme: V2_PROGRAMMES[i]})),
    vaultDoor: {prop: vaultProp, level: 0, x: vault.laneX, z: vault.laneZ, rot: vp?.rot ?? Math.PI},
    generators: gens.map((gr, i) => {
      const p = layout.props[gr.prop];
      return {id: `gen-${i}`, prop: gr.prop, level: gr.level, x: p.x, y: p.y, z: p.z, rot: p.rot, area: gr.area, label: `${gr.label} · ${V2_STOREY_LABELS[gr.level].replace(/ — .*$/, '')}`};
    }),
    core: {prop: coreRec.prop, level: coreRec.level, x: layout.props[coreRec.prop].x, y: layout.props[coreRec.prop].y, z: layout.props[coreRec.prop].z, rot: layout.props[coreRec.prop].rot, area: coreRec.area},
    gasZones: hz.gasZones,
    damp: hz.damp,
    start: {x: start.x, z: start.z, yaw: start.yaw, level: 0},
    lift: liftRecord(layout, sp),
    voids: sp.voids.map(v => ({id: v.id, lower: v.lower, upper: v.upper, rect: {...v.rect}, ceil: v.ceil})),
    floors: floors.map(f => f.title),
  };
  layout.bunker = info;
  assignEnemyArchetypes(layout, spawns);
  applyFamilySpacing(layout, spawns);
  return layout;
}

/** The shelter's railings: the derived well edges + every other drop the bands derive (the v1 rule). */
function bunkerRails(layout: StationLayout): RailRun[] {
  const base = deriveRails(layout.levels);
  const extra = new Levels(layout.levels, layout.levelLinks, base).unrailedDrops();
  return pathRails(layout, [...base, ...extra.map(r => ({...r, h: r.h ?? 1.1}))]);
}

/** The player start: on the platform in front of the opening nearest the vault lane, 2 m back from the edge, facing south. */
function startOf(layout: StationLayout, sc: SpineCarve, openings: readonly Rect[]): {x: number; z: number; yaw: number} {
  const g = layout.grid, P = sc.platform, lane = V2.station.laneX + V2.station.laneW / 2;
  const o = [...openings].sort((a, b) => Math.abs(a.x + a.w / 2 - lane) - Math.abs(b.x + b.w / 2 - lane))[0];
  const sx0 = Math.round(o.x + o.w / 2), sy0 = P.y + 4;
  let spot: [number, number] | null = null;
  search: for (let r = 0; r < 24; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = sx0 + dx, y = sy0 + dy;
    if (y < P.y + 3 || y > P.y + P.h - 3 || !g.inBounds(x, y) || g.area[g.idx(x, y)] !== P.id) continue;
    let ok = true;
    for (let qy = -2; qy <= 2 && ok; qy++) for (let qx = -2; qx <= 2; qx++) if (!g.walkable(x + qx, y + qy)) { ok = false; break; }
    if (ok) { spot = [x, y]; break search; }
  }
  const [wx, wz] = g.center(...(spot ?? [sx0, sy0]));
  layout.playerSpawn = {x: wx, z: wz, yaw: Math.PI};
  return {x: wx, z: wz, yaw: Math.PI};
}

/** Hazards from the floors' declarations: 3-6 leaks (at least one strong, in a dead-end room), damp and aged areas. */
function planV2Hazards(layout: StationLayout, carved: readonly FloorCarveResult[], gens: readonly {area: number}[], core: {area: number}, rng: Rng): {gasZones: BunkerGasZone[]; damp: number[]; aged: Set<number>} | null {
  const zones: BunkerGasZone[] = [];
  const genAreas = new Set(gens.map(g => g.area));
  const proposals: {level: number; area: number; strength: 'weak' | 'medium' | 'strong'}[] = [];
  carved.forEach((r, L) => { for (const q of r.gas ?? []) proposals.push({level: L, area: q.area, strength: q.strength}); });
  // at most six leaks over the level (a deterministic cut, never a retry): every strong / medium one, then each storey's first weak
  // one, then a storey's extra weak ones, deepest storey first — the services storey's optional cylinder-store leak is the first to go
  // (its designer's choice), the maintenance storey's ejector-room leak beside its strong one stays
  const rank = {strong: 0, medium: 1, weak: 2} as const;
  const tier = (q: (typeof proposals)[number], i: number) => (q.strength === 'weak' ? (proposals.some((o, j) => j !== i && o.level === q.level && (o.strength !== 'weak' || j < i)) ? 3 : 2) : rank[q.strength]);
  const order = proposals.map((q, i) => ({q, t: tier(q, i), i})).sort((a, b) => a.t - b.t || (a.t === 3 ? b.q.level - a.q.level : a.q.level - b.q.level) || a.i - b.i);
  proposals.splice(0, proposals.length, ...order.slice(0, 6).map(o => o.q));
  const doorsOf = (id: number) => layout.doors.filter(d => d.a === id || d.b === id).length;
  for (const q of proposals) {
    const a = layout.areas[q.area];
    if (!a) continue;
    const strong = q.strength === 'strong';
    if (strong && (a.kind !== 'room' || genAreas.has(a.id) || a.id === core.area || a.role === 'stair' || a.type === 'stair-core' || doorsOf(a.id) !== 1)) return refuse(`strong leak in ${a.label}`);
    const n = strong ? 3 : 2;
    const cells = seedCells(layout, q.level, a.id, n);
    if (!cells.length) continue;
    const [lo, hi] = GAS_STRENGTH[q.strength];
    zones.push({id: `gas-${zones.length}`, level: q.level, cells, strength: Math.round(rng.range(lo, hi) * 100) / 100});
  }
  if (zones.length < 3 || zones.length > 6 || !zones.some(z => z.strength >= 0.8)) return refuse(`${zones.length} gas zones`);
  const damp = [...new Set(carved.flatMap(r => r.damp ?? []))].filter(id => layout.areas[id]);
  const aged = new Set(carved.flatMap(r => r.aged ?? []).filter(id => layout.areas[id]));
  return {gasZones: zones, damp, aged};
}

/** The shelter's light condition (the v1 rule): aged areas dark / sputtering, the generator rooms and the core hall on steady power. */
function v2Lights(layout: StationLayout, sc: SpineCarve, gens: readonly {area: number}[], core: {area: number}, aged: ReadonlySet<number>, rng: Rng, lit: readonly number[] = []): void {
  for (const a of layout.areas) {
    if (!aged.has(a.id)) continue;
    a.lighting = rng.chance(0.6) ? 'dark' : 'dim';
    for (const l of layout.lights) if (l.area === a.id) { if (rng.chance(0.5)) { l.broken = true; l.flicker = false; } else { l.flicker = true; l.broken = false; } }
  }
  // (+ the floors' steady-power areas: their main routes / landmark halls; never one the floor also marked aged)
  for (const id of [...new Set([...gens.map(g => g.area), core.area, ...lit.filter(i => layout.areas[i] && !aged.has(i))])]) {
    const a = layout.areas[id], own = layout.lights.filter(l => l.area === id);
    a.lighting = 'lit';
    for (const l of own) { l.broken = false; l.flicker = false; l.dying = false; l.power = Math.max(l.power ?? 0.8, 0.8); }
    if (!own.length) {
      const lt: LightPlacement = {x: (a.x + a.w / 2) * CELL, y: a.ceil - 0.05, z: (a.y + a.h / 2) * CELL, rot: a.w >= a.h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: true, power: 0.8, dying: false};
      if (a.level) (lt as LightPlacement & {level?: number}).level = a.level;
      layout.lights.push(lt);
    }
  }
  for (const id of [sc.platform.id, sc.vest.id]) layout.areas[id].lighting = layout.areas[id].lighting === 'dark' ? 'dim' : layout.areas[id].lighting;
}

export {r3 as _r3};
