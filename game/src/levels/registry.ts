// Iteration 16 (lane RUN) / iteration 17 (seamless): the logical levels of the game (levels/types.ts). Each level is ONE
// continuous world, section 'main':
//  - subway: generateStation(levelSeed, {startWeapon}) with ZERO changes to its output; the level-wide gear roll (lane GEAR)
//    is appended to layout.pickups afterwards (no gear => identical). Track 2 (lane GEN): + the level's track extensions
//    (LevelDef.trackExtensions), attached after every core pass (the core station is unchanged up to a crop translation).
//  - office: lane GEN's generateOfficeLevel(ctx) — the compact station, the tower lobby and office floors 2–8 at their real
//    heights in one layout (stairs + a moving elevator between them; nothing inside the level is a travel).
// A level regenerates identically from its seed: the run memory (run/memory.ts) carries what changed.

import {generateStation} from '../gen/station';
import type {StationLayout} from '../gen/stationTypes';
import {isMaskLootItem, placeMaskLoot, placeSectionGear} from './gearAdapter';
import {generateOfficeLevel} from '../gen/office/index'; // lane GEN
import {generateMallLevel} from '../gen/mall/index'; // Task track3-eaton-centre-20261031 (lane GEN): the mall
import {MALL_GENERIC_NAME, mallNameOf} from '../gen/mall/names'; // task mall-playtest-revision-20261031 (lane GEN): seeded "<Name> Center"
import {trackExtConfig} from '../gen/trackExt/config'; // Track 2 (lane GEN): tunnels + service annexes per level
import {generateReactorLevel} from '../gen/reactor/index'; // task reactor-build-20261101 (lane GEN): THE REACTOR
import {generateSkywaysLevel} from '../gen/skyways/index'; // task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS
import {lootProfile} from '../items/lootTables'; // task mall-round3-20261031 (lane SHOPS, R6): the gear placement bias
import {skywalkText} from '../gen/skyways/skywalkText'; // task studio-skywalk-variety-20261107-231448-01
import {trainSpawnPose, type TrainPlacement} from '../gen/playerTrain'; // task player-train-shell-20261101-202805 (lane PLACE): start arrivals inside the train
import type {Arrival, LevelDef, LevelId, LevelTier, SectionGenContext, SectionKey} from './types';

/** Logical levels in tier order (subway 0, office 1, mall 2 — task track3-eaton-centre-20261031, lane GEN). */
export const LEVEL_IDS: readonly LevelId[] = ['subway', 'office', 'mall', 'skyways', 'reactor']; // (+ reactor, tier 3: task reactor-build-20261101; + skyways: task studio-skyways-level-20261106-054448-01, before the Reactor)

/**
 * Gear of the level-wide roll (lane GEAR), placed once, after generation. Task gasmask-breach-20261030 (mask lane): the roll's
 * gas masks / filters (gen/maskLoot.ts, appended to it by levels/gearAdapter.ts) are placed AFTER the gear with their own rng,
 * so every gear placement is exactly what it was. Task mall-round3-20261031 (lane SHOPS, R6): the gear is placed under the level's loot
 * profile (its LootTables.gearPlace bias: the mall's themed shops; the Subway / Office tables carry none = unchanged placement).
 */
function withGear(layout: StationLayout, ctx: SectionGenContext, level: LevelId): StationLayout {
  if (ctx.gear && ctx.gear.length) {
    placeSectionGear(layout, ctx.gear.filter(g => !isMaskLootItem(g.itemId)), lootProfile(level));
    placeMaskLoot(layout, ctx.gear.filter(g => isMaskLootItem(g.itemId)));
  }
  return layout;
}

export const LEVELS: Record<LevelId, LevelDef> = {
  subway: {
    id: 'subway',
    tier: 0, // task track1-siren-blightbelly-20261031 (lane SPAWN): level 0 difficulty — the starting level
    name: 'Subway',
    blurb: 'A large abandoned subway station — platforms, concourses, shops and back-of-house rooms.',
    entry: 'main',
    sections: () => ['main'],
    trackExtensions: trackExtConfig('subway'),
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`Subway has no section '${section}'`);
      return withGear(generateStation(ctx.levelSeed >>> 0, {startWeapon: ctx.startWeapon, trackExtensions: LEVELS.subway.trackExtensions}), ctx, 'subway');
    },
  },
  office: {
    id: 'office',
    tier: 1, // task track1-siren-blightbelly-20261031 (lane SPAWN): level 1 difficulty
    name: 'Office Space',
    blurb: 'A small subway stop under an office tower — climb the stairs into the lobby, then work up eight floors by stairwell or elevator.',
    entry: 'main',
    sections: () => ['main'],
    trackExtensions: trackExtConfig('office'),
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`Office Space has no section '${section}'`);
      return withGear(generateOfficeLevel(ctx, undefined, undefined, LEVELS.office.trackExtensions), ctx, 'office');
    },
  },
  // Task track3-eaton-centre-20261031 (lane GEN): THE MALL — a subway station under a glass atrium (gen/mall/index.ts). ONE continuous
  // world, section 'main'. Task mall-playtest-revision-20261031 (lane GEN): three retail floors; the DISPLAY name is seeded per run
  // ("<Name> Center", gen/mall/names.ts mallNameOf(levelSeed); levelDisplayName below) — `name` is the generic label for menus that
  // have no level seed yet.
  mall: {
    id: 'mall',
    tier: 2, // lane INTEG (Track1 level contract): level 2 difficulty — after the Subway (0) and Office Space (1); metadata only
    name: MALL_GENERIC_NAME,
    blurb: 'A subway station under a small glass atrium — look up to the sky, then explore three floors of shops, corridors and arcades by escalator, stairs or the glass elevator.',
    entry: 'main',
    sections: () => ['main'],
    // lane INTEG (Track2 integration): the pit station's beds are track-bearing — the real TrackExtConfig (TRACK_EXT_MALL), never
    // 'none'; gen/mall/index.ts calls extendTracks at its seam (east / south growth from the fixed crop origin).
    trackExtensions: trackExtConfig('mall'),
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`${MALL_GENERIC_NAME} has no section '${section}'`);
      return withGear(generateMallLevel(ctx, {trackExt: LEVELS.mall.trackExtensions}), ctx, 'mall');
    },
  },
  // Task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS — a connected multi-building public pedway network loosely inspired
  // by Alberta's pedway / "+15" systems (gen/skyways/index.ts): the station under one building, the underground pedway concourse up into
  // its street-level lobby, stair cores up to the skyway level and glazed bridges over the streets to the other buildings, plus exactly
  // one localized add-on. ONE continuous world, section 'main'; an ordinary network node (10 % of the ordinary stations, taken from
  // the Subway's share: campaign/types.ts ORDINARY_WEIGHTS).
  skyways: {
    id: 'skyways',
    tier: 2, // an ordinary node of the Mall's difficulty; metadata only
    name: 'Skyways',
    blurb: 'A station under a downtown block — climb from the pedway concourse to the glazed skyways linking the towers above the streets.',
    entry: 'main',
    sections: () => ['main'],
    trackExtensions: trackExtConfig('skyways'),
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`Skyways has no section '${section}'`);
      return withGear(generateSkywaysLevel(ctx, {trackExt: LEVELS.skyways.trackExtensions}), ctx, 'skyways');
    },
  },
  // Task reactor-build-20261101 (primary + lane GEN): THE REACTOR — the user-selected B "Industrial Service Cathedral": a rim subway
  // station at the TOP of a huge vertical industrial pit, walkway tiers, bridges, lattice towers, the crane and the organ-pipe wall
  // going down through stratified gas to the dormant reactor core (gen/reactor/index.ts). ONE continuous world, section 'main'. The
  // rim station's beds are track-bearing: TRACK_EXT_REACTOR (tunnels past the bed ends + at most one Beyond-the-Station annex).
  reactor: {
    id: 'reactor',
    tier: 3, // level 3 difficulty — the culminating level; metadata only (no unlock gating: selectable like every level)
    name: 'Reactor',
    blurb: 'A station on the rim of a vast industrial pit — descend the gantries through deepening gas, restart the auxiliary generators or mask up, and bring the dormant reactor back to life.',
    entry: 'main',
    sections: () => ['main'],
    trackExtensions: trackExtConfig('reactor'),
    generate: (section, ctx) => {
      if (section !== 'main') throw new Error(`Reactor has no section '${section}'`);
      return withGear(generateReactorLevel(ctx, {trackExt: LEVELS.reactor.trackExtensions}), ctx, 'reactor');
    },
  },
};

export function isLevelId(v: unknown): v is LevelId {
  return typeof v === 'string' && (LEVEL_IDS as readonly string[]).includes(v);
}

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): the difficulty tier of a registered level (types.ts LevelTier). Throws for an
 * unregistered id or a level without a valid tier — never a silent Subway / Office default (levels/levelContract.ts validates all).
 */
export function levelTier(id: LevelId): LevelTier {
  const def = isLevelId(id) ? LEVELS[id] : undefined;
  if (!def) throw new Error(`level '${String(id)}' is not registered`);
  if (!Number.isInteger(def.tier) || def.tier < 0) throw new Error(`level '${id}' has no valid tier (${String(def.tier)})`);
  return def.tier;
}

/**
 * The default other logical level (the pause menu's first "Travel to …"; task track3-eaton-centre-20261031, lane GEN: with three
 * levels the menus offer every level in `travelTargets`). Subway <-> Office as before; the mall's default is the Subway.
 */
export function otherLevel(level: LevelId): LevelId {
  return level === 'subway' ? 'office' : 'subway';
}

/** Every level a menu can travel to from `level` (tier order, the current level excluded). */
export function travelTargets(level: LevelId): LevelId[] {
  return LEVEL_IDS.filter(l => l !== level);
}

/**
 * Display name of a logical level in a run (task mall-playtest-revision-20261031, lane GEN): the mall's seeded "<Name> Center" when the
 * run's level seed is known (the same seed always gives the same name: revisits / Travel agree with layout.mall.name), else the
 * static LEVELS name ("Shopping Center" for the mall).
 */
export function levelDisplayName(level: LevelId, levelSeed?: number): string {
  return level === 'mall' && levelSeed !== undefined && Number.isFinite(levelSeed) ? mallNameOf(levelSeed) : LEVELS[level].name;
}

/** Short human label of a level's world ("Station", "Station and tower", "Station and mall"). */
export function sectionLabel(key: SectionKey): string {
  return key.level === 'office' ? 'Station and tower' : key.level === 'mall' ? 'Station and mall' : key.level === 'reactor' ? 'Station and pit' : key.level === 'skyways' ? 'Station and skyways' : 'Station';
}

/** What the HUD calls clearing the level. */
export function clearLabel(key: SectionKey): string {
  return key.level === 'office' ? 'Tower clear' : key.level === 'mall' ? 'Mall clear' : key.level === 'reactor' ? 'Pit clear' : key.level === 'skyways' ? 'Skyways clear' : 'Station clear';
}

/**
 * Storey label of a layout level id: the office's ('L' = lobby, '2'..'8'); the mall's ('Subway', 'Level 1' … 'Level 3'; lane GEN);
 * '' for the Subway.
 */
export function storeyLabel(layout: StationLayout, level: number): string {
  const s = layout.office?.storeys.find(t => t.levelId === level);
  if (s) return s.label;
  const m = layout.mall?.storeys.find(t => t.level === level);
  if (m) return m.label;
  const r = layout.reactor?.tiers.find(t => t.level === level); // task reactor-build-20261101: 'Rim', 'Tier 1' … 'Core floor'
  if (r) return r.label;
  const k = layout.skyways?.storeys.find(t => t.level === level); // Skyways: 'Concourse', 'Street level', 'Skywalk'
  return k ? skywalkText(k.label) : ''; // (task studio-skywalk-variety-20261107-231448-01: no '+15' in player text)
}

/** The player pose a level starts at: the office's platform start (layout.office.start), else layout.playerSpawn. */
export interface ArrivalPose { x: number; z: number; yaw: number; level?: number; y?: number; source: string }

/**
 * Task player-train-shell-20261101-202805 (lane PLACE): with the level's parked player train (`train` = gen/playerTrain.ts
 * playerTrainPlacement(layout), passed by Game.buildSection), a START arrival — New game, Travel and Retry all arrive with
 * {kind: 'start'} — spawns INSIDE the train (trainSpawnPose: interior floor, explicit y, facing the platform-side doors). The
 * generated starts (layout.playerSpawn / office.start / mall.start) are never changed: generation and many tests key off them, and
 * callers without a train (tests, censuses) get exactly the old pose.
 * SEAM: only 'start' uses the train. Nothing saves a player position today (a page reload is a new run); a future resume /
 * saved-pose arrival (or any other kind, e.g. the unused 'return') never gets the train pose: resolve such a pose BEFORE this
 * function so the legitimately saved position always wins (tests/player-train-placement.test.ts).
 */
export function arrivalPose(layout: StationLayout, arrival: Arrival, train?: TrainPlacement | null): ArrivalPose {
  if (train && arrival.kind === 'start') return trainSpawnPose(layout, train);
  const start = layout.office?.start ?? layout.mall?.start ?? layout.reactor?.start ?? layout.skyways?.start; // (lane GEN: + the mall's platform start; + the reactor's rim platform start; + Skyways')
  if (start) return {...start, source: 'start'};
  const sp = layout.playerSpawn as {x: number; z: number; yaw: number; level?: number; y?: number};
  return {x: sp.x, z: sp.z, yaw: sp.yaw, level: sp.level, y: sp.y, source: 'playerSpawn'};
}
