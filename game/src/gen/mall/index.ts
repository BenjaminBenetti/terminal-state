// Task track3-eaton-centre-20261031 (lane GEN): THE MALL (LevelId 'mall', tier 2) — the WHOLE mall as ONE continuous StationLayout:
// `generateMallLevel(ctx)`.
// Task mall-playtest-revision-20261031 (lane GEN): the compact redesign — station + THREE retail floors (was six rings), a small
// irregular atrium (per-floor openings, nested and widening upward), corridor wings / branches / loops beyond it, shop units of ten
// lot families (gen/mall/lots.ts), a seeded "<Name> Center" (gen/mall/names.ts; layout.name + layout.mall.name).
//
// levels[0] = the subway station at the bottom of the atrium (role 'main', y 0): two side platforms on one double track bed under
// the floor-1 opening, the Fountain court behind the north platform (station escalators, glass elevator), station back of house;
// levels[1..3] = the retail floors (role 'ring', y = 5 m × k): the atrium court's galleries around that floor's opening (railed),
// corridor wings off it (variant topology; upper floors may omit a wing), shop units extruded from every walkway edge, two
// service-stair cores, a washroom passage per floor, escalator banks in the court strips + public stairs in the wings (open wells),
// one glass elevator (4 stops), a glass roof over the top opening only (layout.mall.roof.polygon). Deterministic from
// (ctx.levelSeed, ctx.startWeapon); gear is NOT placed here (the level registry appends ctx.gear once).
//
// Pipeline (the station / office machinery wherever it fits): frame (seeded variant) → carve (Kit with 4 level grids; the station
// with the shared Kit.sideBlock) → Track2 plan (extendTracks on rng.fork('track-ext'), lane INTEG: nothing written into the Kit) →
// crop (fixed origin, canvas room east / south) → storeys / links / apertures / rails / rescue ladders → ONE stationDress.dress()
// (run mouths / elevator landings held clear) → [lane SHOPS seam] → start → whole-level enemies (spawn profile 'pit' / 'ring'
// contexts) / loose supplies → applyLighting → finishTraversal → layout.mall (MallInfo + patrol graph) → [lane HORDE: placeHordes]
// → Track2 attach (finishExtensions: the grid grows east / south; populateExtensions: annex content + 'service' spawns, appended)
// → enemy archetypes ONCE + the Siren spacing → validation (retry on issues; extensions never decide a retry).

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
import {placeAtriumColumns, type ColumnReport} from './columns'; // task mall-playtest-revision-20261031 (lane FIX, U04): round atrium columns = props
import {CROP_MARGIN, FLOORS, MALL_CANVAS, mallFrame, mallSeed, type MallFrame, type MallVariant} from './frame';
import {carveMall, type MallCarve} from './carve';
import {exitHolds, mallInfo, mallLinks, mouthHolds, patrolGraph, runRails, subwayRoot, type Crop} from './structure';
import {mallIssues} from './validate';
import {mallTrackExtContext} from './trackExt'; // lane INTEG (Track2 integration): the mall's extendTracks parameters
import {placeStreetExits, type DesignedExitEnd} from './exits'; // task mall-round2-20261031 (lane GEN, M09): locked street exits
import {decayWalkwayLights, type WalkwayLightReport} from './lightDecay'; // task mall-round3-20261031 (lane LIGHT, R7): walkway light decay
import {dropExtensions, extendTracks, finishExtensions, trackExtConfig, TRACK_EXT_STATS, type TrackExtConfig} from '../trackExt/index';
import {populateExtensions} from '../annexContent'; // Track 2 (lane CONTENT): the extensions' appended content

export {MALL_VARIANTS, mallFrame, mallVariantOf, mallVariantV2Of, mallStoreyLabel, setMallVariantOverride, type MallVariant} from './frame';
export {mallIssues, mallVoidCells, mallRouteGroups} from './validate';
export {mallNameOf, MALL_GENERIC_NAME} from './names';
export {placeStreetExits, MALL_STREET_LEVEL, MALL_EXIT_STATS, EXIT, exitColliderCells} from './exits';

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 10;
/** Validation issues of rejected attempts (QA / tests). */
export const MALL_REJECTS = new Map<string, number>();
/** Timing of the last generateMallLevel call (ms), its attempts and the last attempt's issues (QA / tests). */
export const MALL_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, salt: 0, issues: [] as string[], landmarks: null as LandmarkReport | null, columns: null as ColumnReport | null, walkwayLights: null as WalkwayLightReport | null}; // (+ landmarks: lane ARCH; + columns: lane FIX; + walkwayLights: round 3 lane LIGHT)

export interface MallGenOptions {
  /** Force a named variant (tests / QA); default: the level seed's. */
  variant?: MallVariant;
  loot?: LootProfile;
  spawns?: SpawnProfile;
  /** Track2 (lane INTEG): the level's track-extension declaration (default LEVELS.mall's: trackExtConfig('mall')); 'none' = no extensions. */
  trackExt?: TrackExtConfig | 'none';
  /** Task mall-round2-20261031 (lane GEN, M09): the locked street-exit post-pass (default true; false = the core layout only). */
  streetExits?: boolean;
  /** Task mall-round3-20261031 (lane LIGHT, R7): the walkway light decay pass (default true; false = applyLighting's walkway state). */
  walkwayDecay?: boolean;
}

/** The designed street-exit corridor ends of a layout's skeleton (cropped cells), for the post-pass (set by tryLevel). */
const DESIGNED_EXITS = new WeakMap<StationLayout, DesignedExitEnd[]>();

/** The ONE continuous mall layout (station + three retail floors + the roof record). */
export function generateMallLevel(ctx: SectionGenContext, opts: MallGenOptions = {}): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let f = mallFrame(ctx.levelSeed, opts.variant);
  const loot = opts.loot ?? lootProfile('mall');
  const spawns = opts.spawns ?? spawnProfile('mall');
  const trackExt = opts.trackExt ?? trackExtConfig('mall');
  const seed = mallSeed(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  MALL_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(f, s, seed, attempt, ctx, loot, spawns, trackExt, opts.walkwayDecay !== false);
    MALL_GEN_STATS.attempts = attempt + 1;
    MALL_GEN_STATS.salt = MALL_GEN_STATS.carveFails;
    // A program that does not fit re-rolls the frame's free parameters (same variant) for the next attempt.
    if (!layout) { MALL_GEN_STATS.carveFails++; f = mallFrame(ctx.levelSeed, f.variant, MALL_GEN_STATS.carveFails); continue; }
    let issues = mallIssues(layout, {startCells: spawnStartCells(spawns)});
    // Track2 (lane INTEG): extensions never decide a retry (the core keeps its attempt): drop them and re-check the core.
    if (issues.length && (layout.extensions?.tunnels.length || layout.extensions?.annexes.length)) {
      dropExtensions(layout);
      issues = mallIssues(layout, {startCells: spawnStartCells(spawns)});
      if (!issues.length) TRACK_EXT_STATS.rescued++;
    }
    MALL_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) MALL_REJECTS.set(i, (MALL_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  // Task mall-round2-20261031 (lane GEN, M09): the locked street exits — an APPEND-ONLY post-pass on the chosen layout (its areas /
  // lights are the last records: the core of an existing (seed, variant) stays identical; gen/mall/exits.ts).
  if (fallback && opts.streetExits !== false) placeStreetExits(fallback, DESIGNED_EXITS.get(fallback) ?? [], ctx.levelSeed);
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

function tryLevel(f: MallFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, loot: LootProfile, spawns: SpawnProfile, trackExt: TrackExtConfig | 'none' = 'none', walkwayDecay = true): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng, {levels: MALL_CANVAS.levels, w: MALL_CANVAS.w, h: MALL_CANVAS.h});
  const mc = carveMall(k, rng, f);
  if (!mc) return null;

  // --- Crop origin: fixed (the outer corridor's NW corner CROP_MARGIN cells in) ----------------------------------------------
  const ox = mc.X0 - CROP_MARGIN, oy = mc.Z0 - CROP_MARGIN;
  // --- Track2 seam (lane INTEG): AFTER all mall carving, BEFORE the crop — the tunnels past the pit station's bed ends + service
  // annexes are PLANNED on their own fork (east / south of the fixed origin only); the crop and every core pass below run exactly as
  // without them; finishExtensions grows the grid and stamps them after the last core pass.
  // (round 3, lane LAYOUT: the crop extent is taken first — extendTracks writes nothing into the Kit — so the extension planner budgets
  // the 75k cells on the exact core crop)
  let x1 = mc.X1, y1 = mc.Z1;
  for (const r of [...k.areas, ...k.doors, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  const ext = trackExt === 'none' ? null : extendTracks(k, rng.fork('track-ext'), trackExt, mallTrackExtContext(ox, oy, {w: x1 - ox + CROP_MARGIN, h: y1 - oy + CROP_MARGIN}));

  // --- Crop: extent of everything carved (the extensions join later, finishExtensions) ----------------------------------------
  const use = Array.from({length: FLOORS + 1}, (_, i) => i);
  const c = cropKit(k, use, ox, oy, x1 - ox + CROP_MARGIN, y1 - oy + CROP_MARGIN);
  const crop: Crop = {ox, oy};

  // --- Storeys, links, apertures, rails, ladders -----------------------------------------------------------------------------
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: mc.bases[id]}));
  const links: LevelLink[] = [];
  const linkIds = mallLinks(mc, c.flights, links);
  const P1 = mc.block.platforms[0], P2 = mc.block.platforms[1];
  const layout: StationLayout = {
    seed, attempt, name: f.name, archetype: 'side-mezzanine', towards: ['Union Yards', 'Lakeshore Loop'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: P1.id, platforms: [P1.id, P2.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  P1.towardsN = layout.towards[0]; P2.towardsS = layout.towards[1];
  registerApertures(layout.levels);
  layout.rails = [...deriveRails(layout.levels), ...runRails(mc, crop, c.flights)];
  layout.traversal.ladders = placeLadders(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';

  // --- Dressing: ONE station dresser pass with the run mouths / runs / elevator landings held clear --------------------------
  // (Track2 extension areas do not exist yet — they are attached after the last core pass: the dresser never sees them.)
  // (round 2, M09) designed street-exit approaches stay prop-free through the dressers / landmarks / columns (round-2 variants only)
  const exitHold = holdCells(layout, exitHolds(layout, mc, crop));
  const release = holdCells(layout, mouthHolds(layout, mc, crop));
  dress(layout, rng.fork('dress'));
  release();

  // --- Player start: on platform 1 under the open void, a third of the way along, looking along the platform toward the middle
  const start = startOf(layout, mc, crop);
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
  // lane FIX (U04): the round atrium columns under each slab edge as round props (collision / bullets / nav; ARCH renders the records),
  // after the shops / landmarks (the columns keep a walkable ring off them) and before the populations (enemies / supplies / hordes
  // avoid them). Pure and deterministic (its fork draws nothing from `rng`).
  MALL_GEN_STATS.columns = placeAtriumColumns(layout, rng.fork('mall-columns'));
  exitHold();

  // --- Whole-level populations, storey by storey -------------------------------------------------------------------------------
  const g0 = layout.grid, [sx, sy] = g0.cellOf(start.x, start.z);
  const field: SpawnField = {dist: levelDistance(layout.levels, sx, sy, 0, layout.levelLinks), keep: keepPoints(layout, mc, crop)};
  for (let lv = 0; lv <= FLOORS; lv++) {
    const context = lv === 0 ? (spawns.contexts.pit ? 'pit' : 'station') : (spawns.contexts.ring ? 'ring' : 'floor');
    placeOfficeEnemies(layout, rng.fork(`mall-enemies-${lv}`), field, [lv], spawns, context);
  }
  // Loose floor supplies: lane PROFILES' per-storey mall program (stream mall-supplies-<storey>).
  for (let lv = 0; lv <= FLOORS; lv++) placeMallSupplies(layout, rng.fork(`mall-supplies-${lv}`), field, [lv], lv === 0 ? 'pit' : 'ring', loot);

  // --- Lighting, traversal finishing, archetypes, the mall record, hordes ------------------------------------------------------
  applyLighting(layout, rng.fork('lighting'));
  finishTraversal(layout);
  dropFloatingFixtures(layout);
  // round 3 (lane LIGHT, R7): ~half the public walkway fixtures dead, some flickering / off-colour (own fork: no other draw moves)
  MALL_GEN_STATS.walkwayLights = walkwayDecay ? decayWalkwayLights(layout, rng.fork('mall-walkway-lights')) : null;
  layout.mall.patrol = patrolGraph(layout, mc, crop, c.flights);
  // Hordes (lane HORDE) never start on a run (its flat top landing included) or in front of a mouth / elevator landing. They read
  // ambient POSITIONS only (keep-off), never families, so the one family roll may run after them.
  const runHold = holdCells(layout, mouthHolds(layout, mc, crop));
  placeHordes(layout, spawns.horde, rng.fork('mall-hordes'), {dist: field.dist});
  runHold();
  // Track2 (lane INTEG): only now the extensions join — the finished core is re-framed into the grid grown east / south (same
  // origin: every world coordinate and core record stays put) and their cells / areas / doors are appended; their dressing, lights,
  // loose finds and 'service' spawns follow on the `track-ext-content` fork, APPENDED after every core record (hordes included).
  if (ext) {
    finishExtensions(layout, ext, {ox, oy, grow: 'east-south'});
    populateExtensions(layout, rng, {loot, spawns, dressRng: rng.fork('dress')});
  }
  layout.mall.subwayRoot = subwayRoot(layout, mc, crop); // DERIVED report: now from the real extensions
  // Track1 contract (lane INTEG): the ambient runs above were tagged 'pit' / 'ring' by placeOfficeEnemies, the hordes 'horde', the
  // annex runs 'service' (markSpawnContext); ONE family roll after every context (horde members keep their pool's family: skipped),
  // then the mall's Siren spacing (FamilySpacing: the cap + 30 m, jointly) — RNG-free. The roll is per spawn index: appending the
  // annex spawns after the hordes leaves every ambient draw unchanged.
  assignEnemyArchetypes(layout, spawns);
  applyFamilySpacing(layout, spawns);
  DESIGNED_EXITS.set(layout, designedExitEnds(mc, crop));
  return layout;
}

/** The skeleton's designed street-exit corridor ends (EndSpec.exit, floor 1) in cropped grid cells. */
function designedExitEnds(mc: MallCarve, c: Crop): DesignedExitEnd[] {
  return mc.sk.ends.filter(e => e.exit).map(e => {
    const alongX = e.dir === 'N' || e.dir === 'S';
    return {dir: e.dir, line: e.line - (alongX ? c.oy : c.ox), a0: e.a0 - (alongX ? c.ox : c.oy), a1: e.a1 - (alongX ? c.ox : c.oy)};
  });
}

/**
 * Player start: on the NORTH platform (Platform 2, which opens onto the Fountain court and its escalators) UNDER the floor-1 opening
 * (the look-up column), clear of the platform edge, facing along the platform toward the escalators / the atrium's middle.
 */
function startOf(layout: StationLayout, mc: MallCarve, c: Crop): {x: number; z: number; yaw: number; level: number} {
  const P = mc.block.platforms[1], g = layout.grid; // areas are already in cropped coordinates
  const voidAt = (x: number, y: number) => mc.voidMask[(y + c.oy) * mc.cw + (x + c.ox)] === 1;
  const sx = Math.round((mc.vx0 + mc.vx1) / 2) - c.ox, edge = P.y + P.h - 4;
  let spawn: [number, number] | null = null;
  search: for (let r = 0; r < 48; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = sx + dx, y = edge - 1 + dy;
    if (y > edge - 1 || !g.inBounds(x, y) || g.area[g.idx(x, y)] !== P.id || !voidAt(x, y)) continue; // >= 1.5 m back from the edge
    let ok = true;
    for (let qy = -2; qy <= 2 && ok; qy++) for (let qx = -2; qx <= 2; qx++) if (!g.walkable(x + qx, y + qy)) { ok = false; break; }
    if (ok) { spawn = [x, y]; break search; }
  }
  const [wx, wz] = g.center(...(spawn ?? [sx, P.y + Math.floor(P.h / 2)]));
  // Facing along the platform toward the station escalators (forward = (-sin yaw, -cos yaw)), a little toward the court.
  const esc = mc.runs.find(r => r.lower === 0);
  const ex = esc ? (esc.rect.x + esc.rect.w / 2 - c.ox) * CELL : wx + 10;
  const yaw = Math.atan2(-(ex - wx), 6);
  layout.playerSpawn = {x: wx, z: wz, yaw};
  return {x: wx, z: wz, yaw, level: 0};
}

/** Points enemies / loot keep off: every public run's mouths, every elevator landing, every service-stair landing. */
function keepPoints(layout: StationLayout, mc: MallCarve, c: Crop): SpawnField['keep'] {
  const out: SpawnField['keep'] = [];
  for (const k of layout.levelLinks) {
    out.push({level: k.lower, x: k.bottom.x, z: k.bottom.z}, {level: k.upper, x: k.top.x, z: k.top.z});
  }
  for (const e of mc.elevators) for (let lv = 0; lv <= FLOORS; lv++) out.push({level: lv, x: (e.landing.x + e.landing.w / 2 - c.ox) * CELL, z: (e.landing.y + e.landing.h / 2 - c.oy) * CELL});
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

/** QA / tests: one attempt (null when the program does not fit). */
export function mallAttempt(ctx: SectionGenContext, attempt: number, opts: MallGenOptions & {salt?: number} = {}): StationLayout | null {
  const f = mallFrame(ctx.levelSeed, opts.variant, opts.salt ?? 0), seed = mallSeed(ctx.levelSeed);
  const L = tryLevel(f, attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx, opts.loot ?? lootProfile('mall'), opts.spawns ?? spawnProfile('mall'), opts.trackExt ?? trackExtConfig('mall'), opts.walkwayDecay !== false);
  if (L && opts.streetExits !== false) placeStreetExits(L, DESIGNED_EXITS.get(L) ?? [], ctx.levelSeed);
  return L;
}
