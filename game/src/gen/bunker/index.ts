// Task studio-bunker-level-20261109-072224-01: THE BUNKER (LevelId 'bunker') — a buried station at the door of a civil-defence shelter
// that descends through real storeys into the earth, as ONE continuous StationLayout: `generateBunkerLevel(ctx)`. Contract:
// gen/bunker/bunkerTypes.ts (layout.bunker: storeys, the vault door, the three generator slots, the core cluster, gas zones, damp areas).
//
// levels[0] = the STATION (y 0): the platform + track bed where the player's train parks, the arrival hall, the guard booth, the vault
// bulkhead with the Reactor's round blast door standing open, the vault vestibule; levels[1..5] DESCEND 7 m apart: ENTRY & SECURITY,
// HABITATION (generator #1), SERVICES & MEDICAL (generator #2), MAINTENANCE & WATER (damp; generator #3) and the CENTRAL PROCESSING CORE
// (the lowest walkable storey: the tall hall of racks round the core cluster). Two stacked scissor stairs (the main stair from the
// station down, the service stair from storey 1) join every storey; each shelter storey is a seeded room graph round them (the Reactor
// shelter's planner, gen/reactor/complex/bunkerPlan.ts). Deterministic from (ctx.levelSeed, ctx.startWeapon); gear is NOT placed here.
//
// Pipeline (the Reactor's / Market's): frame (seeded) → carve (Kit with 6 level grids) → crop (fixed origin) → storeys / links /
// apertures / rescue ladders / rails → start → the vault door + generators + core cluster (collision props) → hazards (gas zones, damp,
// aged wings) → ONE stationDress.dress() (the objectives' fronts and the threshold held clear) → the shelter's own furnishing / plates →
// whole-level enemies per storey (contexts station / floor / ring + the damp run) → loose supplies → weapon finds → applyLighting (aged
// wings dark / flickering, the plant rooms lit steadily) → finishTraversal → layout.bunker → enemy archetypes ONCE + family spacing →
// validation (retry on issues).

import {Rng, hashString} from '../../core/rng';
import {CELL} from '../grid';
import {Kit} from '../stationKit';
import {deriveRails, levelDistance, registerApertures} from '../levelGen';
import {Levels, type Level, type LevelLink, type RailRun} from '../levels';
import {applyLighting, dress} from '../stationDress';
import {finishTraversal, placeLadders} from '../traversal';
import {cropKit} from '../office/common';
import {holdCells} from '../office/transit';
import type {SpawnField} from '../office/spawns';
import {placeMallSupplies} from '../mall/supplies';
import {placeWeaponFinds} from '../weaponFinds';
import {pathRails} from '../reactor/pathsGen';
import {assignEnemyArchetypes} from '../../ai/creatureSpawn';
import {applyFamilySpacing} from '../../ai/familySpacing';
import {spawnProfile, type SpawnProfile} from '../../ai/spawnTables';
import {lootProfile, type LootProfile} from '../../items/lootTables';
import type {LevelId, SectionGenContext} from '../../levels/types';
import type {LightPlacement, StationLayout} from '../stationTypes';
import type {BunkerInfo} from './bunkerTypes';
import {BUNKER_BASES, BUNKER_LEVELS, BUNKER_PROGRAMMES, BUNKER_STOREY_LABELS, bunkerFrame, bunkerSeed, type BunkerFrame} from './frame';
import {bunkerCanvas, carveBunker, type BunkerCarve} from './carve';
import {dressShelter, placeObjectives} from './dress';
import {planHazards} from './hazards';
import {placeBunkerEnemies} from './spawns';
import {bunkerIssues} from './validate';
import {BUNKER_LAYOUT_VERSION} from './layoutVersion';
import {generateBunkerV2} from './v2/index';

export {BUNKER_GENERIC_NAME, bunkerNameOf, bunkerShortName} from './names';
export {BUNKER_BASES, BUNKER_CORE_LEVEL, BUNKER_LEVELS, BUNKER_STOREY_LABELS, bunkerFrame, bunkerSeed} from './frame';
export {bunkerIssues} from './validate';
export {bunkerSpawnContext} from './spawns';

/** The level id (levels/registry.ts LEVELS.bunker). */
const BUNKER_ID: LevelId = 'bunker';

export interface BunkerGenOptions {
  loot?: LootProfile;
  spawns?: SpawnProfile;
}

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 8;
/** Validation issues of rejected attempts (QA / tests). */
export const BUNKER_REJECTS = new Map<string, number>();
/** Timing of the last generateBunkerLevel call (ms), its attempts / carve failures and the last attempt's issues (QA / tests). */
export const BUNKER_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, issues: [] as string[]};

/** Storey label of a Bunker layout level ('Station', 'Level 1 — Entry & security', …; '' when the layout is not a Bunker). */
export function bunkerStoreyLabel(layout: StationLayout, level: number): string {
  return layout.bunker?.storeys.find(s => s.level === level)?.label ?? '';
}

/**
 * The ONE continuous Bunker layout (station + the shelter storeys + layout.bunker). Task studio-bunker-rework-20261109-205115-01: a
 * station's layout version (gen/bunker/layoutVersion.ts; absent = the current one) picks the generator — version 1 regenerates the
 * first Bunker exactly (below, frozen), version 2 the inhabited rework with the cargo lift (gen/bunker/v2/index.ts).
 */
export function generateBunkerLevel(ctx: SectionGenContext, opts: BunkerGenOptions = {}): StationLayout {
  if ((ctx.layoutVersion ?? BUNKER_LAYOUT_VERSION) >= 2) return generateBunkerV2(ctx, opts);
  return generateBunkerV1(ctx, opts);
}

/** Version 1 (the first Bunker, task studio-bunker-level-20261109-072224-01): frozen — entered stations regenerate it exactly. */
function generateBunkerV1(ctx: SectionGenContext, opts: BunkerGenOptions = {}): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const loot = opts.loot ?? lootProfile(BUNKER_ID);
  const spawns = opts.spawns ?? spawnProfile(BUNKER_ID);
  const seed = bunkerSeed(ctx.levelSeed);
  let f = bunkerFrame(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  BUNKER_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(f, s, seed, attempt, ctx, loot, spawns);
    BUNKER_GEN_STATS.attempts = attempt + 1;
    if (!layout) { BUNKER_GEN_STATS.carveFails++; f = bunkerFrame(ctx.levelSeed, BUNKER_GEN_STATS.carveFails); continue; }
    const issues = bunkerIssues(layout, {startCells: startCells(spawns)});
    BUNKER_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) BUNKER_REJECTS.set(i, (BUNKER_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  BUNKER_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error('bunker level generation failed');
}

/** QA / tests: one attempt (null when the programme does not fit). */
export function bunkerAttempt(ctx: SectionGenContext, attempt: number, salt = 0, opts: BunkerGenOptions = {}): StationLayout | null {
  const seed = bunkerSeed(ctx.levelSeed);
  return tryLevel(bunkerFrame(ctx.levelSeed, salt), attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx, opts.loot ?? lootProfile(BUNKER_ID), opts.spawns ?? spawnProfile(BUNKER_ID));
}

/** QA / tests: stop an attempt right before the objectives are placed (the cropped, linked layout + its carve). */
export const STAGE: {stop: boolean; layout: StationLayout | null; carve: BunkerCarve | null} = {stop: false, layout: null, carve: null};

const startCells = (p: SpawnProfile): number => p.contexts.station?.placement.startCells ?? 36;

function tryLevel(f: BunkerFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, loot: LootProfile, spawns: SpawnProfile): StationLayout | null {
  const rng = new Rng(genSeed);
  const cv = bunkerCanvas(f);
  const k = new Kit(rng, {levels: BUNKER_LEVELS, w: cv.W, h: cv.H});
  const bc = carveBunker(k, f, rng.fork('carve'));
  if (!bc) return null;
  // --- Crop (fixed origin: canvas cells = grid cells) ----------------------------------------------------------------------------
  const c = cropKit(k, Array.from({length: BUNKER_LEVELS}, (_, i) => i), 0, 0, cv.W, cv.H);
  // storey 4 (maintenance & water) is the damp one: level role 'lower' (world/decay.ts wetness / seepage / neglect)
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : id === 4 ? 'lower' : 'ring', grid, baseY: BUNKER_BASES[id]}));
  const links: LevelLink[] = [];
  for (const core of bc.cores) for (const run of core.runs) {
    const fl = run.flights.map(i => c.flights[i]);
    const lo = fl.reduce((a, q) => (Math.min(q.h0, q.h1) < Math.min(a.h0, a.h1) ? q : a));
    const hi = fl.reduce((a, q) => (Math.max(q.h0, q.h1) > Math.max(a.h0, a.h1) ? q : a));
    links.push({id: links.length, kind: 'stairs', lower: run.upper + 1, upper: run.upper, ramp: fl[0].ramp, bottom: {...lo.bottom}, top: {...hi.top}, traversalId: fl[0].id});
  }
  const layout: StationLayout = {
    seed, attempt, name: f.name, archetype: 'side-mezzanine', towards: ['Deep Line', 'Shelter Siding'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: bc.platform.id, platforms: [bc.platform.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  bc.platform.towardsN = layout.towards[0];
  registerApertures(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  layout.rails = bunkerRails(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';
  const start = startOf(layout, bc);

  if (STAGE.stop) { STAGE.layout = layout; STAGE.carve = bc; return null; }
  // --- The vault door, generators and core cluster (collision props) before the dresser --------------------------------------------
  const obj = placeObjectives(layout, bc, rng.fork('objectives'));
  if (!obj) return null;
  const objProps = {vault: layout.props[obj.vaultProp], gens: obj.generators.map(gr => layout.props[gr.prop]), core: obj.core ? layout.props[obj.core.prop] : null};
  const g0 = layout.grid, [sx, sy] = g0.cellOf(start.x, start.z);
  const dist0 = levelDistance(layout.levels, sx, sy, 0, layout.levelLinks);
  const hz = planHazards(layout, bc, obj, rng.fork('hazards'), dist0);
  // --- Dressing: ONE station dresser pass, the objectives' fronts and the vault threshold held clear --------------------------------
  const release = holdCells(layout, obj.holds);
  dress(layout, rng.fork('dress'));
  release();
  dressShelter(layout, bc, rng.fork('shelter'), obj, hz.aged);

  // --- Whole-level populations, storey by storey -------------------------------------------------------------------------------
  const keep: SpawnField['keep'] = [];
  for (const kk of layout.levelLinks) keep.push({level: kk.lower, x: kk.bottom.x, z: kk.bottom.z}, {level: kk.upper, x: kk.top.x, z: kk.top.z});
  for (const p of [...objProps.gens, objProps.core]) if (p) keep.push({level: p.level ?? 0, x: p.x, z: p.z});
  const field: SpawnField = {dist: levelDistance(layout.levels, sx, sy, 0, layout.levelLinks), keep};
  placeBunkerEnemies(layout, rng.fork('bunker-enemies'), field, spawns, hz.damp);
  for (let lv = 0; lv < BUNKER_LEVELS; lv++) placeMallSupplies(layout, rng.fork(`bunker-supplies-${lv}`), field, [lv], lv === 0 ? 'pit' : 'ring', loot);
  placeWeaponFinds(layout, rng.fork('weaponFinds'), layout.startWeapon ?? 'rifle');

  // --- Lighting, traversal finishing, the record ---------------------------------------------------------------------------------
  applyLighting(layout, rng.fork('lighting'));
  shelterLights(layout, bc, obj, hz.aged, rng.fork('shelter-lights'));
  finishTraversal(layout);
  const idxOf = (p: unknown) => layout.props.indexOf(p as never);
  const info: BunkerInfo = {
    version: 1,
    name: f.name,
    storeys: Array.from({length: BUNKER_LEVELS}, (_, i) => ({level: i, baseY: BUNKER_BASES[i], label: BUNKER_STOREY_LABELS[i], programme: BUNKER_PROGRAMMES[i]})),
    vaultDoor: {prop: idxOf(objProps.vault), level: 0, x: r3((bc.bulkhead.lane.x + 1.5) * CELL), z: r3((bc.bulkhead.lane.y + 1) * CELL), rot: bc.bulkhead.rot},
    generators: obj.generators.map((gr, i) => {
      const p = objProps.gens[i];
      return {id: `gen-${i}`, prop: idxOf(p), level: gr.level, x: p.x, y: p.y, z: p.z, rot: p.rot, area: gr.area, label: `${gr.label} · ${BUNKER_STOREY_LABELS[gr.level].replace(/ — .*$/, '')}`};
    }),
    core: {prop: idxOf(objProps.core), level: obj.core!.level, x: objProps.core!.x, y: objProps.core!.y, z: objProps.core!.z, rot: objProps.core!.rot, area: obj.core!.area},
    gasZones: hz.gasZones,
    damp: hz.damp,
    start: {x: start.x, z: start.z, yaw: start.yaw, level: 0},
  };
  layout.bunker = info;
  assignEnemyArchetypes(layout, spawns);
  applyFamilySpacing(layout, spawns);
  return layout;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The shelter's railings: the derived well edges + every other drop the bands derive, no rail across a storey seam (the Market's rule). */
function bunkerRails(layout: StationLayout): RailRun[] {
  const base = deriveRails(layout.levels);
  const extra = new Levels(layout.levels, layout.levelLinks, base).unrailedDrops();
  return pathRails(layout, [...base, ...extra.map(r => ({...r, h: r.h ?? 1.1}))]);
}

/**
 * Player start: on the platform in front of the opening nearer the vault, 2 m back from the edge, facing the openings (south) — the
 * parked train centres on it, so its middle door opens toward the arrival hall.
 */
function startOf(layout: StationLayout, bc: BunkerCarve): {x: number; z: number; yaw: number} {
  const g = layout.grid, P = bc.platform;
  const lane = (bc.bulkhead.lane.x + 1.5);
  const o = [...bc.openings].sort((a, b) => Math.abs(a.x + a.w / 2 - lane) - Math.abs(b.x + b.w / 2 - lane))[0];
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
  layout.playerSpawn = {x: wx, z: wz, yaw: Math.PI}; // forward = (-sin yaw, -cos yaw) = (0, +1): south, toward the arrival hall
  return {x: wx, z: wz, yaw: Math.PI};
}

/**
 * The shelter's light condition: the aged / damaged wings dark with sputtering tubes, the generator plant rooms and the core hall on
 * steady emergency power (the player works there), the station side lit.
 */
function shelterLights(layout: StationLayout, bc: BunkerCarve, obj: NonNullable<ReturnType<typeof placeObjectives>>, aged: ReadonlySet<number>, rng: Rng): void {
  for (const a of layout.areas) {
    if (!aged.has(a.id)) continue;
    a.lighting = rng.chance(0.6) ? 'dark' : 'dim';
    for (const l of layout.lights) if (l.area === a.id) { if (rng.chance(0.5)) { l.broken = true; l.flicker = false; } else { l.flicker = true; l.broken = false; } }
  }
  const steady = [...obj.generators.map(g => g.area), ...(obj.core ? [obj.core.area] : [])];
  for (const id of steady) {
    const a = layout.areas[id], own = layout.lights.filter(l => l.area === id);
    a.lighting = 'lit';
    for (const l of own) { l.broken = false; l.flicker = false; l.dying = false; l.power = Math.max(l.power ?? 0.8, 0.8); }
    if (!own.length) {
      const lt: LightPlacement = {x: (a.x + a.w / 2) * CELL, y: a.ceil - 0.05, z: (a.y + a.h / 2) * CELL, rot: a.w >= a.h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: true, power: 0.8, dying: false};
      if (a.level) (lt as LightPlacement & {level?: number}).level = a.level;
      layout.lights.push(lt);
    }
  }
  for (const id of [bc.platform.id, bc.hall.id, bc.vest.id]) layout.areas[id].lighting = layout.areas[id].lighting === 'dark' ? 'dim' : layout.areas[id].lighting;
}
