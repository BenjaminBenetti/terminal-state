// Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the 'cosplay' ZONE CONTEXT of Skyways (layout version 5+) — the
// costumed ordinary zombies of the anime convention. A leaf module (type-only imports): ai/spawnTables.ts declares it in
// SKYWAYS_SPAWN_PROFILE.contexts; gen/skyways/cosplaySpawns.ts places it (the convention-specific rules: COSPLAY_SPAWN_RULES there).

import type {FamilyPool, PlacementRules, SpawnContextRule} from './spawnTables';

/**
 * Spawns per convention: U{4..6}, one draw (rng.int) per level that has the convention add-on (the add-on is the convention OR the prize
 * display, never both: 0..1 per level, never guaranteed), ADDITIVE to the core contexts (never in the station / street / floor counts or
 * the ambient budget).
 */
export const COSPLAY_ZONE_BUDGET: readonly [number, number] = [4, 6];
/**
 * The convention's placement (gen/skyways/cosplaySpawns.ts placeCosplaySpawns reads it): the venue's public event floor only (main hall,
 * exhibitors' floor, photo lounge, panel rooms — never registration, the back of house, storage or the washrooms), one cap pass holding the
 * whole run, 24 tries per pick, 2 m spacing (a cluster of fans, never two bodies in one spot), >= 36 walking cells from the start (the
 * validator's rule), 3 x 3 clear, 5 m off every stair / escalator landing (the level's keep points).
 */
export const COSPLAY_PLACEMENT: PlacementRules = {
  areaWeights: {
    rules: [{when: {kind: ['concourse', 'room', 'passage']}, weight: 1, why: 'the convention venue\'s public event floor (main hall, exhibitors\' floor, photo lounge, panel rooms)'}],
    otherwise: 0, otherwiseWhy: 'nowhere outside the convention venue: never its registration, back of house, storage or washrooms, nor any other area of the level',
  },
  caps: {passes: [COSPLAY_ZONE_BUDGET[1]], rules: []},
  tries: 24, spacingM: 2, startCells: 36, clearCells: 1, landingKeepM: 5,
};
/**
 * The convention's OWN family pool: ordinary zombies only (Blightbelly / Siren / rat-dog / Strainer weight 0 — a cosplay zombie is a
 * wardrobe look of the zombie family, never another family). = familyPool({blightbelly: 0, siren: 0, ratdog: 0, strainer: 0}), written out
 * (this module must not import spawnTables' values: it is imported BY it).
 */
export const COSPLAY_FAMILY_POOL: FamilyPool = [['zombie', 1], ['blightbelly', 0], ['siren', 0], ['ratdog', 0], ['strainer', 0]];
/** The 'cosplay' zone context of Skyways (once per convention; never regenerates a level: no accepted minimum). */
export const COSPLAY_CONTEXT: SpawnContextRule = {
  label: 'Anime convention (cosplay zombies on the venue\'s event floor)', count: COSPLAY_ZONE_BUDGET, placement: COSPLAY_PLACEMENT,
  accept: {min: null, max: 'count'}, families: COSPLAY_FAMILY_POOL,
};
