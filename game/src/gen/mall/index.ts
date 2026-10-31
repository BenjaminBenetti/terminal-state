// Task track3-eaton-centre-20261031 (lane GEN): THE EATON'S CENTER (LevelId 'mall', tier 2) — the WHOLE mall as ONE continuous
// StationLayout: `generateMallLevel(ctx)`.
//
// levels[0] = the subway station at the bottom of the pit (role 'main', y 0): two side platforms on one double track bed under the
// open void, the north (fountain) and south courts beside them; levels[1..6] = the retail rings (role 'ring', y = 5 m × k): a
// gallery walkway ring around the void (railed on every edge), shop units on all four sides (sales floor + stock room, shopfronts
// onto the gallery), a service-corridor loop with four corner service-stair cores and plant rooms, escalator banks / stairs between
// every storey pair (open wells in the galleries), bridges across the void on some rings, glass-elevator shafts at the void edge,
// a glass barrel-vault roof over the void (layout.mall.roof). Deterministic from (ctx.levelSeed, ctx.startWeapon); gear is NOT
// placed here (the level registry appends ctx.gear once).
//
// Pipeline (the station / office machinery wherever it fits): frame (seeded variant) → carve (Kit with 7 level grids; the station
// with the shared Kit.sideBlock) → Track2 seam (extendTracksSeam: NOT INTEGRATED, a no-op on rng.fork('track-ext')) → crop (fixed
// origin, canvas room east / south) → storeys / links / apertures / rails / rescue ladders → ONE stationDress.dress() (run mouths /
// elevator landings held clear) → [lane SHOPS seam] → start → whole-level enemies (spawn profile 'pit' / 'ring' contexts) /
// loose supplies → applyLighting → finishTraversal → enemy archetypes → layout.mall (MallInfo + patrol graph) → [lane HORDE:
// placeHordes] → validation (retry on issues).

import {Rng, hashString} from '../../core/rng';
import {CELL} from '../grid';
import {Kit} from '../stationKit';
import type {Level, LevelLink} from '../levels';
import {deriveRails, levelDistance, registerApertures} from '../levelGen';
import {applyLighting, dress} from '../stationDress';
import {finishTraversal, placeLadders} from '../traversal';
import {assignEnemyArchetypes} from '../../ai/creatureSpawn';
import {spawnProfile, type SpawnProfile} from '../../ai/spawnTables';
import {applyFamilySpacing} from '../../ai/familySpacing'; // lane INTEG (Track1 integration): the whole-mall Siren spacing post-pass
import {lootProfile, type LootProfile} from '../../items/lootTables';
import type {SectionGenContext} from '../../levels/types';
import type {StationLayout} from '../stationTypes';
import {cropKit} from '../office/common';
import {holdCells} from '../office/transit';
import {placeOfficeEnemies, type SpawnField} from '../office/spawns';
import {placeHordes} from '../../ai/hordePlace'; // lane HORDE
import {placeMallSupplies} from './supplies'; // lane PROFILES: the mall's per-storey loose floor program
import {assignMallPrograms} from './shops'; // lane SHOPS: programs / brands / purposes of the shop units
import {dressMallShops} from './shopsDress'; // lane SHOPS: the shop interiors (sales floors + stock rooms) by program recipe
import {placeMallWeapons} from './shopsWeapons'; // lane SHOPS: the bounded once-per-run gun-shop weapon plan
import {placeMallLandmarks, type LandmarkReport} from './landmarks'; // lane ARCH: fountain, directory pylons, wayfinding signs
import {CROP_MARGIN, MALL_CANVAS, RINGS, mallFrame, mallSeed, type MallFrame, type MallVariant} from './frame';
import {carveMall, type MallCarve} from './carve';
import {mallInfo, mallLinks, mouthHolds, patrolGraph, runRails, type Crop} from './structure';
import {mallIssues} from './validate';
import {MALL_TRACK_EXTENSIONS, extendTracksSeam, isExtensionArea, type TrackExtensionsInterim} from './trackExt';

export {MALL_VARIANTS, mallFrame, mallVariantOf, mallStoreyLabel, setMallVariantOverride, type MallVariant} from './frame';
export {mallIssues, mallVoidCells} from './validate';

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 12;
/** Validation issues of rejected attempts (QA / tests). */
export const MALL_REJECTS = new Map<string, number>();
/** Timing of the last generateMallLevel call (ms), its attempts and the last attempt's issues (QA / tests). */
export const MALL_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, issues: [] as string[], landmarks: null as LandmarkReport | null}; // (+ landmarks: lane ARCH)

export interface MallGenOptions {
  /** Force a named variant (tests / QA); default: the level seed's. */
  variant?: MallVariant;
  loot?: LootProfile;
  spawns?: SpawnProfile;
}

/** The ONE continuous Eaton's Center layout (station pit + six rings + the roof record). */
export function generateMallLevel(ctx: SectionGenContext, opts: MallGenOptions = {}): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let f = mallFrame(ctx.levelSeed, opts.variant);
  const loot = opts.loot ?? lootProfile('mall');
  const spawns = opts.spawns ?? spawnProfile('mall');
  const seed = mallSeed(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  MALL_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(f, s, seed, attempt, ctx, loot, spawns);
    MALL_GEN_STATS.attempts = attempt + 1;
    // A program that does not fit re-rolls the frame's free parameters (same variant) for the next attempt.
    if (!layout) { MALL_GEN_STATS.carveFails++; f = mallFrame(ctx.levelSeed, f.variant, MALL_GEN_STATS.carveFails); continue; }
    const issues = mallIssues(layout, {startCells: spawnStartCells(spawns)});
    MALL_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) MALL_REJECTS.set(i, (MALL_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  MALL_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error('mall level generation failed');
}

const spawnStartCells = (p: SpawnProfile): number => {
  const c = p.contexts.ring ?? p.contexts.floor ?? p.contexts.station;
  return c?.placement.startCells ?? 36;
};

// ---------------------------------------------------------------------------------------------
// One attempt

function tryLevel(f: MallFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, loot: LootProfile, spawns: SpawnProfile): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng, {levels: MALL_CANVAS.levels, w: MALL_CANVAS.w, h: MALL_CANVAS.h});
  const mc = carveMall(k, rng, f);
  if (!mc) return null;

  // --- Track2 seam: AFTER all mall carving, BEFORE the crop (NOT INTEGRATED — Track2 pending; rng fork only) -------------------
  const extensions: TrackExtensionsInterim = extendTracksSeam(k, rng.fork('track-ext'), MALL_TRACK_EXTENSIONS, {levelId: 'mall', canvasGrow: 'east-south'});

  // --- Crop: fixed origin (the outer corridor's NW corner CROP_MARGIN cells in), extent of everything carved (+ extensions) ----
  const ox = mc.X0 - CROP_MARGIN, oy = mc.Z0 - CROP_MARGIN;
  let x1 = mc.X1, y1 = mc.Z1;
  for (const r of [...k.areas, ...k.doors, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  const use = Array.from({length: RINGS + 1}, (_, i) => i);
  const c = cropKit(k, use, ox, oy, x1 - ox + CROP_MARGIN, y1 - oy + CROP_MARGIN);
  const crop: Crop = {ox, oy};

  // --- Storeys, links, apertures, rails, ladders -----------------------------------------------------------------------------
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: mc.bases[id]}));
  const links: LevelLink[] = [];
  const linkIds = mallLinks(mc, c.flights, links);
  const P1 = mc.block.platforms[0], P2 = mc.block.platforms[1];
  const layout: StationLayout = {
    seed, attempt, name: f.name, archetype: 'side-mezzanine', towards: ['Union Yards', 'Harbourfront'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: P1.id, platforms: [P1.id, P2.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  P1.towardsN = layout.towards[0]; P2.towardsS = layout.towards[1];
  (layout as StationLayout & {extensions?: TrackExtensionsInterim}).extensions = extensions; // Track2 data hook (NOT INTEGRATED)
  registerApertures(layout.levels);
  layout.rails = [...deriveRails(layout.levels), ...runRails(mc, crop, c.flights)];
  layout.traversal.ladders = placeLadders(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';

  // --- Dressing: ONE station dresser pass with the run mouths / runs / elevator landings held clear --------------------------
  // (Track2 extension areas, once they exist, are held too: the station dresser never furnishes them — isExtensionArea.)
  const release = holdCells(layout, [...mouthHolds(layout, mc, crop), ...extensionCells(layout)]);
  dress(layout, rng.fork('dress'));
  release();

  // --- Player start: on platform 1 under the open void, a third of the way along, looking along the platform toward the middle
  const start = startOf(layout, mc);
  // The mall record (shops, void, runs, bridges, elevators, roof, subway root); the patrol graph follows once the level is final.
  layout.mall = mallInfo(layout, mc, crop, c.flights, linkIds, start);
  // [lane SHOPS seam] programs / kinds / brands / fits of layout.mall.shops + their areas' purposes / labels (own fork); SHOPS'
  // interior dressing joins here too (after the station dresser, before the populations: loot follows the purposes).
  assignMallPrograms(layout, rng.fork('mall-shops'));
  // lane SHOPS: interiors (after the station dresser: absolute heights; stock rooms it furnished only gain the program's pieces),
  // then the gun shops' weapon finds (one plan per logical run from the level seed + start weapon; layout pickups, remembered).
  dressMallShops(layout, rng.fork('mall-shop-dress'), {frame: 'absolute'});
  placeMallWeapons(layout, ctx.levelSeed, layout.startWeapon ?? 'rifle');
  // lane ARCH: the pit-plaza fountain, directory pylons and wayfinding signs (after the interiors, before the populations)
  MALL_GEN_STATS.landmarks = placeMallLandmarks(layout, rng.fork('mall-landmarks'));

  // --- Whole-level populations, storey by storey -------------------------------------------------------------------------------
  const g0 = layout.grid, [sx, sy] = g0.cellOf(start.x, start.z);
  const field: SpawnField = {dist: levelDistance(layout.levels, sx, sy, 0, layout.levelLinks), keep: keepPoints(layout, mc, crop)};
  // Global mall passes skip Track2 extension areas (isExtensionArea) once they exist: hold their cells while populating.
  const extHold = holdCells(layout, extensionCells(layout));
  for (let lv = 0; lv <= RINGS; lv++) {
    const context = lv === 0 ? (spawns.contexts.pit ? 'pit' : 'station') : (spawns.contexts.ring ? 'ring' : 'floor');
    placeOfficeEnemies(layout, rng.fork(`mall-enemies-${lv}`), field, [lv], spawns, context);
  }
  // Loose floor supplies: lane PROFILES' per-storey mall program (stream mall-supplies-<storey>).
  for (let lv = 0; lv <= RINGS; lv++) placeMallSupplies(layout, rng.fork(`mall-supplies-${lv}`), field, [lv], lv === 0 ? 'pit' : 'ring', loot);
  extHold();

  // --- Lighting, traversal finishing, archetypes, the mall record, hordes ------------------------------------------------------
  applyLighting(layout, rng.fork('lighting'));
  finishTraversal(layout);
  dropFloatingFixtures(layout);
  // Track1 contract (lane INTEG): the ambient runs above were tagged 'pit' / 'ring' by placeOfficeEnemies (markSpawnContext); ONE
  // family roll for every ambient context, then the mall's Siren spacing (FamilySpacing: the cap + 30 m, jointly) — RNG-free.
  assignEnemyArchetypes(layout, spawns);
  applyFamilySpacing(layout, spawns);
  layout.mall.patrol = patrolGraph(layout, mc, crop, c.flights);
  // Hordes (lane HORDE) never start on a run (its flat top landing included) or in front of a mouth / elevator landing.
  const runHold = holdCells(layout, mouthHolds(layout, mc, crop));
  placeHordes(layout, spawns.horde, rng.fork('mall-hordes'), {dist: field.dist});
  runHold();
  return layout;
}

function startOf(layout: StationLayout, mc: MallCarve): {x: number; z: number; yaw: number; level: number} {
  const P = layout.areas[layout.platform], g = layout.grid;
  const sx = P.x + Math.round(P.w * 0.3), sy = P.y + Math.floor(P.h / 2);
  let spawn: [number, number] = [sx, sy];
  search: for (let r = 0; r < 16; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    const x = sx + ox, y = sy + oy;
    if (!g.inBounds(x, y) || g.area[g.idx(x, y)] !== P.id) continue;
    let ok = true;
    for (let qy = -2; qy <= 2 && ok; qy++) for (let qx = -2; qx <= 2; qx++) if (!g.walkable(x + qx, y + qy)) { ok = false; break; }
    if (ok) { spawn = [x, y]; break search; }
  }
  const [wx, wz] = g.center(spawn[0], spawn[1]);
  void mc;
  // Facing east along the platform (forward = (-sin yaw, -cos yaw)), a little toward the far platform and the rings above it.
  layout.playerSpawn = {x: wx, z: wz, yaw: -Math.PI / 2 + 0.3};
  return {x: wx, z: wz, yaw: layout.playerSpawn.yaw, level: 0};
}

/** Points enemies / loot keep off: every public run's mouths, every elevator landing, every service-stair landing. */
function keepPoints(layout: StationLayout, mc: MallCarve, c: Crop): SpawnField['keep'] {
  const out: SpawnField['keep'] = [];
  for (const k of layout.levelLinks) {
    out.push({level: k.lower, x: k.bottom.x, z: k.bottom.z}, {level: k.upper, x: k.top.x, z: k.top.z});
  }
  for (const e of mc.elevators) for (let lv = 0; lv <= RINGS; lv++) out.push({level: lv, x: (e.landing.x + e.landing.w / 2 - c.ox) * CELL, z: (e.landing.y + e.landing.h / 2 - c.oy) * CELL});
  return out;
}

/**
 * Ceiling fixtures the station dresser hung in OPEN AIR — over the void (the pit floor under the atrium, bridge decks) a fixture at
 * the area's nominal pendant height has no ceiling above it: dropped (the atrium is lit by lane ARCH's skylight bake through the
 * glass roof). A fixture counts as floating when it hangs more than 1 m below its column's ceiling on its storey.
 */
function dropFloatingFixtures(layout: StationLayout): number {
  const before = layout.lights.length;
  layout.lights = layout.lights.filter(l => {
    if (l.virtual) return true;
    const lv = l.level ?? layout.areas[l.area]?.level ?? 0, g = layout.levels[lv]?.grid;
    if (!g) return true;
    const [cx, cy] = g.cellOf(l.x, l.z);
    if (!g.inBounds(cx, cy)) return true;
    const c = g.ceilAt(l.x, l.z);
    return !(Number.isFinite(c) && l.y < c - 1.0);
  });
  return before - layout.lights.length;
}

/** Cells of Track2 extension areas (none until Track2 integrates). */
function extensionCells(layout: StationLayout): {level: number; cells: number[]}[] {
  const out: {level: number; cells: number[]}[] = [];
  for (const a of layout.areas) {
    if (!isExtensionArea(a)) continue;
    const lv = a.level ?? 0, g = layout.levels[lv].grid, cells: number[] = [];
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.area[g.idx(x, y)] === a.id) cells.push(g.idx(x, y));
    out.push({level: lv, cells});
  }
  return out;
}

/** QA / tests: one attempt (null when the program does not fit). */
export function mallAttempt(ctx: SectionGenContext, attempt: number, opts: MallGenOptions & {salt?: number} = {}): StationLayout | null {
  const f = mallFrame(ctx.levelSeed, opts.variant, opts.salt ?? 0), seed = mallSeed(ctx.levelSeed);
  return tryLevel(f, attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx, opts.loot ?? lootProfile('mall'), opts.spawns ?? spawnProfile('mall'));
}
