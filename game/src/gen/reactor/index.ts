// Task reactor-build-20261101 (lane GEN): THE REACTOR (LevelId 'reactor', tier 3) — the WHOLE pit as ONE continuous StationLayout:
// `generateReactorLevel(ctx)`. Contract: gen/reactor/reactorTypes.ts (layout.reactor). B "Industrial Service Cathedral".
//
// levels[0] = the RIM: a subway station at the top of the pit (one platform beside the track bed; task reactor-playtest-round2-20261102,
// lane ARRIVAL: its openings lead into a small station area, a breached wall and a short tunnel to the rim gallery round most of the pit
// mouth — gen/reactor/arrival.ts; the rim control office); levels[1..4] = the walkway TIERS going down (steel galleries,
// generator / stair landings, bridges through lattice towers, rooms cut into the rock); levels[5] = the CORE FLOOR round the vessel
// (pump hall, control room, a store). Routes: the wall switchbacks (stair wall), the south flight set reached by the bridge / tower line,
// the maintenance ladders up the organ-pipe terraces. Deterministic from (ctx.levelSeed, ctx.startWeapon); gear is NOT placed here.
//
// Pipeline (the mall's): frame (seeded variant) → carve (Kit with 6 level grids; the column stack) → Track2 plan (extendTracks on
// rng.fork('track-ext'), nothing written into the Kit) → crop (fixed origin) → storeys / links / apertures / rails / rescue +
// maintenance ladders → machines (collision props) → ONE stationDress.dress() (decks, run mouths, stand points held clear) → start →
// components → whole-level enemies per storey (contexts station / floor / ring / pit) → loose supplies → applyLighting → finishTraversal
// → deck fixtures → layout.reactor → Track2 attach (finishExtensions + populateExtensions) → enemy archetypes ONCE + family spacing →
// validation (retry on issues; extensions never decide a retry).

import {Rng, hashString} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {Kit} from '../stationKit';
import type {Level, LevelLink} from '../levels';
import {levelDistance, registerApertures} from '../levelGen';
import {applyLighting, dress} from '../stationDress';
import {planPitLamps} from './gaslightLamps'; // task reactor-expansion-20261101 (lane GASLIGHT)
import {finishTraversal, placeLadders} from '../traversal';
import {assignEnemyArchetypes} from '../../ai/creatureSpawn';
import {spawnProfile, type SpawnContextId, type SpawnProfile} from '../../ai/spawnTables';
import {applyFamilySpacing} from '../../ai/familySpacing';
import {lootProfile, type LootProfile} from '../../items/lootTables';
import type {LevelId, SectionGenContext} from '../../levels/types';
import type {PickupPlacement, StationLayout} from '../stationTypes';
import {cropKit} from '../office/common';
import {holdCells} from '../office/transit';
import {placeOfficeEnemies, type SpawnField} from '../office/spawns';
import {placeMallSupplies} from '../mall/supplies';
import {placeWeaponFinds} from '../weaponFinds';
import type {TrackExtConfig} from '../trackExt/types';
import {dropExtensions, extendTracks, finishExtensions, trackExtConfig, TRACK_EXT_STATS} from '../trackExt/index';
import {populateExtensions} from '../annexContent';
import type {ReactorComponent, ReactorPose} from './reactorTypes';
import {CORE_LEVEL, PIT_ROCK, REACTOR_LEVELS, reactorFrame, reactorSeed, type ReactorFrame} from './frame';
import {carveReactor, reactorCanvas, type ReactorCarve} from './carve';
import {
  buildSites, deckHolds, deckLights, maintenanceLadders, mouthHolds, placeFans, reactorInfo, reactorLinks, reactorRails,
  roomFrame, roomPoint,
} from './structure';
import {reactorIssues} from './validate';
import {approachRecord, arrivalHolds, arrivalLights, arrivalSigns} from './arrival'; // task reactor-playtest-round2-20261102 (lane ARRIVAL)
import {sealPockets, suiteHolds, suiteRecord} from './suites'; // (lane ARRIVAL)
import {coreFloorRecord, finishCoreFloor} from './coreFloor'; // task reactor-expansion-20261101 (lane CORE)
// task reactor-expansion-20261101 (lane HOST): the generator side complexes (bunker / mines / waste) off the main shaft
import {carveComplexes, clearEntranceLamps, complexLights, dressComplexes, finishComplexes, hostGenerators, trimCoreCrop, type ComplexCarvers} from './complex/host';

export {reactorFrame, reactorSeed, reactorStoreyLabel, setReactorVariantOverride, TIERS, CORE_LEVEL, REACTOR_LEVELS} from './frame';
export {reactorIssues, routeIssues as reactorRouteIssues} from './validate';

/** The level id (levels/registry.ts LEVELS.reactor). */
const REACTOR_ID: LevelId = 'reactor';

export interface ReactorGenOptions {
  /** Force a named kit variant (tests / QA): 'W' / 'E' or a variant name ('west-stairs-…' / 'east-stairs-…'); default: the level seed's. */
  variant?: string;
  loot?: LootProfile;
  spawns?: SpawnProfile;
  /** The level's track-extension declaration (LEVELS.reactor.trackExtensions); 'none' = no extensions. */
  trackExt?: TrackExtConfig | 'none';
  /** Task reactor-expansion-20261101 (lane HOST): side-complex carver overrides (tests / QA; a missing key = the shipped carver, null = none). */
  complexCarvers?: ComplexCarvers;
}

/** Generation attempts before the last generated layout is returned with its issues. */
const ATTEMPTS = 8;
/** Grid cell budget of the layout with its Track2 extensions. */
export const REACTOR_EXT_MAX_CELLS = 80_000;
/** Validation issues of rejected attempts (QA / tests). */
export const REACTOR_REJECTS = new Map<string, number>();
/** Timing of the last generateReactorLevel call (ms), its attempts / carve failures and the last attempt's issues (QA / tests). */
export const REACTOR_GEN_STATS = {ms: 0, attempts: 0, carveFails: 0, issues: [] as string[]};

/** The ONE continuous Reactor layout (rim station + walkway tiers + core floor + layout.reactor). */
export function generateReactorLevel(ctx: SectionGenContext, opts: ReactorGenOptions = {}): StationLayout {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let f = reactorFrame(ctx.levelSeed, opts.variant);
  const loot = opts.loot ?? lootProfile(REACTOR_ID);
  const spawns = opts.spawns ?? spawnProfile(REACTOR_ID);
  const trackExt = opts.trackExt ?? trackExtConfig('reactor');
  const seed = reactorSeed(ctx.levelSeed);
  let fallback: StationLayout | null = null;
  REACTOR_GEN_STATS.carveFails = 0;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const s = attempt === 0 ? seed : hashString('retry' + attempt, seed);
    const layout = tryLevel(f, s, seed, attempt, ctx, loot, spawns, trackExt, opts.complexCarvers);
    REACTOR_GEN_STATS.attempts = attempt + 1;
    if (!layout) { REACTOR_GEN_STATS.carveFails++; f = reactorFrame(ctx.levelSeed, f.stairWall, REACTOR_GEN_STATS.carveFails); continue; }
    let issues = reactorIssues(layout, {startCells: startCells(spawns)});
    // Track2: extensions never decide a retry (the core keeps its attempt): drop them and re-check the core.
    if (issues.length && (layout.extensions?.tunnels.length || layout.extensions?.annexes.length)) {
      dropExtensions(layout);
      issues = reactorIssues(layout, {startCells: startCells(spawns)});
      if (!issues.length) TRACK_EXT_STATS.rescued++;
    }
    REACTOR_GEN_STATS.issues = issues;
    if (!issues.length) { fallback = layout; break; }
    for (const i of new Set(issues.map(q => q.replace(/-?[\d.]+/g, '#')))) REACTOR_REJECTS.set(i, (REACTOR_REJECTS.get(i) ?? 0) + 1);
    fallback ??= layout;
  }
  REACTOR_GEN_STATS.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  if (fallback) return fallback;
  throw new Error('reactor level generation failed');
}

/** The pit's canvas rect grown by PIT_ROCK: no Track2 extension cell inside it (extendTracks keepOut; reactorIssues checks it). */
export function pitKeepOut(rc: {rectC: ReactorCarve['rectC']; PW: number; PD: number}): {x: number; y: number; w: number; h: number} {
  const r = rc.rectC(0, 0, rc.PW, rc.PD);
  return {x: r.x - PIT_ROCK, y: r.y - PIT_ROCK, w: r.w + 2 * PIT_ROCK, h: r.h + 2 * PIT_ROCK};
}

const startCells = (p: SpawnProfile): number => {
  const c = p.contexts.floor ?? p.contexts.ring ?? p.contexts.station;
  return c?.placement.startCells ?? 36;
};

/** Spawn context of a storey (the primary's SPAWN_PROFILES.reactor): rim 'station', tiers 1-2 'floor', tiers 3-4 'ring', core 'pit'. */
export function reactorSpawnContext(lv: number): SpawnContextId {
  return lv === 0 ? 'station' : lv === CORE_LEVEL ? 'pit' : lv <= 2 ? 'floor' : 'ring';
}

// ---------------------------------------------------------------------------------------------
// One attempt

function tryLevel(f: ReactorFrame, genSeed: number, seed: number, attempt: number, ctx: SectionGenContext, loot: LootProfile, spawns: SpawnProfile, trackExt: TrackExtConfig | 'none', carvers?: ComplexCarvers): StationLayout | null {
  const rng = new Rng(genSeed);
  const cv = reactorCanvas(f);
  const k = new Kit(rng, {levels: REACTOR_LEVELS, w: cv.W, h: cv.H});
  const rc = carveReactor(k, rng, f);
  if (!rc) return null;
  // --- Task reactor-expansion-20261101 (lane HOST): the side complexes, each carver once in its slot (before Track2 / the crop) -----
  const cxs = carveComplexes(k, rng, rc, carvers);
  trimCoreCrop(k, rc); // the crop holds what was carved east / south (unused complex rock stays out of the grids)
  // --- Track2 seam: AFTER all carving, BEFORE the crop (plans only; east / south of the fixed origin) ----------------------------
  const ext = trackExt === 'none' ? null : extendTracks(k, rng.fork('track-ext'), trackExt, {
    levelId: 'reactor', levelSeed: ctx.levelSeed, canvasGrow: 'east-south', origin: {x: 0, y: 0}, maxCells: REACTOR_EXT_MAX_CELLS, coreCrop: {w: rc.coreW, h: rc.coreH},
    // task reactor-playtest-round2-20261102 (lane ARRIVAL): the pit is reactor-owned on every storey — its organ-pipe banks / tower-leg
    // columns are SOLID everywhere but are not rock, and the fans' ducts need PIT_ROCK cells of rock behind the walls: no extension
    // cell there (an annex corridor once cut through the rim gallery's organ bank)
    keepOut: [pitKeepOut(rc)],
  });
  // --- Crop (fixed origin: canvas cells = grid cells) ------------------------------------------------------------------------
  const c = cropKit(k, Array.from({length: REACTOR_LEVELS}, (_, i) => i), 0, 0, rc.coreW, rc.coreH);
  const levels: Level[] = c.grids.map((grid, id) => ({id, role: id === 0 ? 'main' : 'ring', grid, baseY: rc.bases[id]}));
  const links: LevelLink[] = [];
  const linkIds = reactorLinks(rc, c.flights, links);
  const layout: StationLayout = {
    seed, attempt, name: 'Reactor', archetype: 'side-mezzanine', towards: ['Deep Line', 'Rim Terminal'], grid: c.grids[0], areas: k.areas, doors: k.doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0}, trench: c.trenches[0], trenches: c.trenches, platform: rc.platform.id, platforms: [rc.platform.id],
    traversal: {stairs: c.flights, ladders: [], underpasses: []}, levels, levelLinks: links, rails: [],
  };
  rc.platform.towardsN = layout.towards[0];
  // the vessel: raised, blocked cells on the core floor (cropKit does not copy the blocked masks)
  { const gC = layout.levels[CORE_LEVEL].grid; for (const [x, y] of rc.vessel) gC.blocked[gC.idx(x, y)] = 1; }
  registerApertures(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  const lad = maintenanceLadders(layout, rc);
  // task reactor-expansion-20261101 (lane CORE): the goop pool blocked, the coolant loops' collision, the turbine generator's wall run
  const coreFin = finishCoreFloor(layout, rc.coreFloor, rc.coreAreas, layout.levelLinks.flatMap(k => [...(k.lower === CORE_LEVEL ? [k.bottom] : []), ...(k.upper === CORE_LEVEL ? [k.top] : [])]));
  layout.rails = reactorRails(layout);
  layout.startWeapon = ctx.startWeapon ?? 'rifle';

  // --- Machines (collision props) before the dresser: the dresser furnishes round them --------------------------------------------
  const gens = hostGenerators(layout, rc, cxs); // lane HOST: the landing generators + the complexes' (ids in zone order)
  const sb = buildSites(layout, rc);
  // --- Dressing: ONE station dresser pass with the pit decks, run mouths, stand points and doors held clear ----------------------
  const before = {lights: layout.lights.length, signs: layout.signs.length};
  const deckIds = new Set([...rc.decks.map(d => d.area), ...rc.coreAreas]);
  const holds = [...deckHolds(layout, rc), ...mouthHolds(layout, rc, links), ...sb.holds, ...gens.holds, ...arrivalHolds(layout, rc.arrival), ...suiteHolds(layout, rc.suites)];
  const release = holdCells(layout, holds);
  dress(layout, rng.fork('dress'));
  release();
  // the dresser's fixtures / plates over the open pit decks are dropped (the decks get their own fixtures below)
  layout.lights = layout.lights.filter((l, i) => i < before.lights || !deckIds.has(l.area));
  layout.signs = layout.signs.filter((s, i) => i < before.signs || !deckIds.has(s.area) || s.kind === 'service');
  // lane HOST: each complex's own dress hook (world metres, crop {0, 0}), the same cells held clear
  dressComplexes(layout, rng, cxs, holds);
  // task reactor-playtest-round2-20261102 (lane ARRIVAL): furniture pockets of the suites / the station area sealed (the office's rule)
  for (const s of rc.suites) sealPockets(layout.levels[s.level].grid, [...s.corridors, ...s.rooms].map(id => layout.areas[id]), s.deckDoors);
  sealPockets(layout.grid, [rc.arrival.hall, ...(rc.arrival.corridor ? [rc.arrival.corridor] : []), ...rc.arrival.rooms, ...rc.arrival.tunnel], rc.arrival.platformDoors);
  // task reactor-playtest-round2-20261102 (lane ARRIVAL): wayfinding plates (platform openings, beside the breach, beside the reveal)
  { const off = rc.rooms.find(r => r.key === 'rimOffice'); arrivalSigns(layout, rc.arrival, off ? {x: (off.door.x + off.door.w / 2) * CELL, z: (off.door.y + off.door.h / 2) * CELL} : undefined); }

  // --- Player start: on the platform in front of the middle opening, looking through it into the pit ------------------------------
  const start = startOf(layout, rc);
  // --- The restart components (finite, placed once): the key in the rim office, three fuses in the maintenance stores --------------
  const components = placeComponents(layout, rc, rng.fork('reactor-components'));

  // --- Whole-level populations, storey by storey -------------------------------------------------------------------------------
  const g0 = layout.grid, [sx, sy] = g0.cellOf(start.x, start.z);
  const keep: SpawnField['keep'] = [...sb.keep, ...gens.keep];
  for (const kk of layout.levelLinks) keep.push({level: kk.lower, x: kk.bottom.x, z: kk.bottom.z}, {level: kk.upper, x: kk.top.x, z: kk.top.z});
  const field: SpawnField = {dist: levelDistance(layout.levels, sx, sy, 0, layout.levelLinks), keep};
  for (let lv = 0; lv < REACTOR_LEVELS; lv++) {
    const context = reactorSpawnContext(lv);
    if (!spawns.contexts[context]) continue;
    placeOfficeEnemies(layout, rng.fork(`reactor-enemies-${lv}`), field, [lv], spawns, context);
  }
  for (let lv = 0; lv < REACTOR_LEVELS; lv++) placeMallSupplies(layout, rng.fork(`reactor-supplies-${lv}`), field, [lv], lv === 0 ? 'pit' : 'ring', loot);
  // weapon finds: the station rule (plausible back-of-house rooms far from the start; tools/pages LEVEL_ADAPTER.reactor weapons 'station')
  placeWeaponFinds(layout, rng.fork('weaponFinds'), layout.startWeapon ?? 'rifle');

  // --- Lighting, traversal finishing, deck fixtures, the record ------------------------------------------------------------------
  applyLighting(layout, rng.fork('lighting'));
  // applyLighting's stand-in fixture of an unlit area hangs at the area centre: never over the pit decks (they get their own below)
  layout.lights = layout.lights.filter(l => !deckIds.has(l.area));
  finishTraversal(layout);
  // finishTraversal's rescue-ladder plate ('EMERGENCY LADDER', storey-less) is not for the maintenance ladders (ARCH marks them)
  layout.signs = layout.signs.filter(s => !lad.ladders.some(q => Math.abs(q.x + 0.95 - s.x) < 1e-6 && Math.abs(q.bottomY + 0.72 - s.y) < 1e-6));
  for (const a of layout.areas) if (deckIds.has(a.id)) a.lighting = a.level ? 'dim' : 'lit';
  // Lane RESTART's light contract: `dying` = the Reactor's POWERED circuit 2 only (the deck fixtures below): a room's sputtering tube
  // from applyLighting is dark instead; the restart sites are lit steadily (emergency power) so the player can work there.
  for (const l of layout.lights) if (l.dying) { l.dying = false; l.broken = true; l.flicker = false; }
  for (const s of sb.sites) {
    const a = layout.areas[s.area], own = layout.lights.filter(l => l.area === a.id);
    for (const l of own) { l.broken = false; l.flicker = false; l.dying = false; l.power = 0.8; }
    a.lighting = 'lit';
    if (!own.length) layout.lights.push({x: (a.x + a.w / 2) * CELL, y: a.ceil - 0.05, z: (a.y + a.h / 2) * CELL, rot: a.w >= a.h ? 0 : Math.PI / 2, area: a.id, broken: false, flicker: false, warm: true, power: 0.8, dying: false, ...(a.level ? {level: a.level} : {})});
  }
  complexLights(layout, cxs); // lane HOST: a complex generator's room is lit steadily, like the restart sites
  arrivalLights(layout, rc.arrival); // task reactor-playtest-round2-20261102 (lane ARRIVAL): dim steady work lamps down the breach tunnel
  deckLights(layout, rc, rng.fork('reactor-deck-lights'));
  clearEntranceLamps(layout, cxs); // lane HOST: no deck lamp hangs in a complex's doorway
  const fans = placeFans(layout, rc, rng.fork('reactor-fans'));
  layout.reactor = reactorInfo(layout, rc, rng.fork('reactor-info'), {
    linkIds, ladderLinks: lad.links, gens: gens.gens, fans, sites: sb.sites, screens: sb.screens, components, start, flights: layout.traversal.stairs,
  });
  finishComplexes(layout, rc, cxs); // lane HOST: complex generators' cables through their entrances + layout.reactor.complexes
  layout.reactor.approach = approachRecord(rc.arrival); // task reactor-playtest-round2-20261102 (lane ARRIVAL)
  layout.reactor.suites = suiteRecord(rc.suites); // (lane ARRIVAL: the seeded rock suites)
  planPitLamps(layout); // task reactor-expansion-20261101 (lane GASLIGHT): every pit lamp MOUNTED + a real fixture (no floating / dead-glow lamps); the open pit top — AFTER every wall carve (incl. the complex entrances)
  clearEntranceLamps(layout, cxs); // (lead merge fix) …and no mounted pit lamp in a complex's doorway band either
  layout.reactor.coreFloor = coreFloorRecord(layout, rc.coreFloor, coreFin); // task reactor-expansion-20261101 (lane CORE): glow sources, round-rail seam, record

  // --- Track2 attach, then the ONE family roll ---------------------------------------------------------------------------------
  if (ext) {
    finishExtensions(layout, ext, {ox: 0, oy: 0, grow: 'east-south'});
    populateExtensions(layout, rng, {loot, spawns, dressRng: rng.fork('dress')});
  }
  assignEnemyArchetypes(layout, spawns);
  applyFamilySpacing(layout, spawns);
  return layout;
}

/**
 * Player start: on the platform in front of the ticket-hall opening, facing south toward it. (task reactor-playtest-round2-20261102,
 * lane ARRIVAL: the platform no longer opens onto the pit — the opening leads into the station area, the breach and the tunnel.)
 */
function startOf(layout: StationLayout, rc: ReactorCarve): ReactorPose {
  const g = layout.grid, P = rc.platform;
  const o = rc.openings[Math.floor(rc.openings.length / 2)];
  const sx0 = o.x + Math.floor(o.w / 2), sy0 = o.y - 4;
  let spot: [number, number] | null = null;
  search: for (let r = 0; r < 24; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = sx0 + dx, y = sy0 + dy;
    if (y > P.y + P.h - 3 || y < P.y + 4 || !g.inBounds(x, y) || g.area[g.idx(x, y)] !== P.id) continue;
    let ok = true;
    for (let qy = -2; qy <= 2 && ok; qy++) for (let qx = -2; qx <= 2; qx++) if (!g.walkable(x + qx, y + qy)) { ok = false; break; }
    if (ok) { spot = [x, y]; break search; }
  }
  const [wx, wz] = g.center(...(spot ?? [sx0, sy0]));
  const yaw = Math.PI; // forward = (-sin yaw, -cos yaw) = (0, +1): south, toward the ticket hall
  layout.playerSpawn = {x: wx, z: wz, yaw};
  return {x: wx, z: wz, yaw, level: 0};
}

/** The key (rim office) and three fuse cartridges (the maintenance stores of tier 3, tier 4 and the core floor): finite pickups. */
function placeComponents(layout: StationLayout, rc: ReactorCarve, rng: Rng): ReactorComponent[] {
  const out: ReactorComponent[] = [];
  const put = (key: string, item: ReactorComponent['item'], where: string) => {
    const rr = rc.rooms.find(r => r.key === key);
    if (!rr) return;
    const g = layout.levels[rr.level].grid, f = roomFrame(rc, rr);
    const cells: [number, number][] = [];
    for (let y = rr.rect.y; y < rr.rect.y + rr.rect.h; y++) for (let x = rr.rect.x; x < rr.rect.x + rr.rect.w; x++) {
      const i = g.idx(x, y);
      if (g.cells[i] !== FLOOR || g.blocked[i] || g.area[i] !== rr.area || g.rampIdx[i] >= 0) continue;
      // beside a wall or a prop (on the floor by a shelf / cabinet), never in the doorway lane
      let near = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!g.walkable(x + ox, y + oy)) near++;
      const [wx, wz] = g.center(x, y), door = roomPoint(f, rr.doorA0 - rr.a0 + rr.doorW / 2, 0);
      if (!near || Math.hypot(wx - door.x, wz - door.z) < 2.0) continue;
      cells.push([x, y]);
    }
    if (!cells.length) return;
    const [x, y] = rng.pick(cells);
    const [wx, wz] = g.center(x, y);
    const p: PickupPlacement = {itemId: item, count: 1, x: wx, y: g.floorOf(g.idx(x, y)), z: wz, area: rr.area};
    if (rr.level) p.level = rr.level;
    layout.pickups.push(p);
    out.push({item, pickup: layout.pickups.length - 1, level: rr.level, area: rr.area, where});
  };
  put('rimOffice', 'reactor_key', 'Rim control office');
  put('store3', 'fuse_cartridge', 'Maintenance store · Tier 3');
  put('store4', 'fuse_cartridge', 'Maintenance store · Tier 4');
  put('storeCore', 'fuse_cartridge', 'Maintenance store · Core floor');
  void CELL;
  return out;
}

/** QA / tests: one attempt (null when the program does not fit). */
export function reactorAttempt(ctx: SectionGenContext, attempt: number, opts: ReactorGenOptions & {salt?: number} = {}): StationLayout | null {
  const f = reactorFrame(ctx.levelSeed, opts.variant, opts.salt ?? 0), seed = reactorSeed(ctx.levelSeed);
  return tryLevel(f, attempt === 0 ? seed : hashString('retry' + attempt, seed), seed, attempt, ctx, opts.loot ?? lootProfile(REACTOR_ID), opts.spawns ?? spawnProfile(REACTOR_ID), opts.trackExt ?? trackExtConfig('reactor'), opts.complexCarvers);
}
