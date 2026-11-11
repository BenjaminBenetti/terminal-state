// Task enemy-spawn-tables-20261030 (lane SPAWN): buildEnemyReference() — the source-generated ENEMY SPAWN reference.
//
// Reads ONLY the real exported spawn profile API (game/src/ai/spawnTables.ts: SPAWN_PROFILES / spawnProfile / spawnContext /
// acceptedPlaced / baseAreaWeight / roomModifier / roomIntensity / the census hook), the archetype registry
// (ai/creatureArchetypes.ts ENEMY_ARCHETYPES), the registered levels (levels/registry.ts LEVELS / LEVEL_IDS) and the Office storey
// list (gen/office/frame.ts OFFICE_FLOORS) — no copied numbers. Which rooms occur and how much floor is eligible comes from a SMALL
// fixed-seed SAMPLED census of the real registered generators (labelled as such; never bounding boxes: eligible cells are the cells
// the generator's own candidate filter accepted, reported through spawnTables' generation-time census hook).
//
// The contract is tools/pages/enemyReferenceTypes.ts; the guide is docs/enemy-spawns.md. game/tests/enemy-spawn-reference.test.ts
// checks coverage (unknown registrations fail), determinism and runtime agreement. Gameplay is untouched: this module only READS
// game modules (it is never part of the game bundle).
//
// Task track1-siren-blightbelly-20261031 (lane SPAWN), schema 2: + each level's explicit difficulty TIER (levels/registry.ts), the
// registry contract check (levels/levelContract.ts validateLevelRegistry), every family's combat STATS / behaviour rules read from
// its exported constants (ENEMY_FAMILY_ADAPTER: brain.ts ZOMBIE_STATS, ai/blightbelly.ts, ai/siren.ts, ai/creatureActor.ts), the
// profiles' family ELIGIBILITY rules and a sampled ELIGIBILITY census (draws vs placed of a restricted family). A spawn's context
// is the generator's own tag (spawnTables spawnContextOf), never inferred from the storey.
//
// Task studio-screacher-production-20261110-221858-01 (lane REGISTRY-DOCS), schema 3: THE SEEDED ROSTER (ai/enemyRoster.ts FAMILY_ROSTER
// / applyEnemyRoster: which special families a level holds AT ALL, from its seed) — the rule of every family (EnemyReference.roster),
// each level's rates / eligibility and a sampled roster census (EnemyLevelInfo.roster), the roster-only Screacher (weight 0 in every
// pool) and its model variants. EVERY sampled "what a level holds" figure is now measured with the pass applied: a sample level is the
// registered generator's plain output (roster version 0 = the per-spawn roll's outcome, kept as the labelled "before the roster pass"
// stage) followed by applyEnemyRoster at ROSTER_VERSION on that same layout — exactly what the level registry runs for the game.

import * as ST from '../../game/src/ai/spawnTables';
import {
  ALL_FAMILIES, ENEMY_FAMILY_IDS, HORDE_CONTEXT, PASSAGE_NOOK_CELLS, ROSTER_ONLY_FAMILIES, SPAWN_PROFILES, acceptedPlaced, baseAreaWeight, eligibilityFailure, roomFamilyPool,
  roomIntensity, roomKey, roomModifier, setSpawnCensusHook, spawnContext, spawnContextOf, spawnProfile, validateSpawnProfile,
  type AreaCaps, type AreaMatch, type AreaWeights, type EnemyFamilyId, type FamilyEligibility, type SpawnCandidateReport, type SpawnContextId,
  type SpawnContextRule, type SpawnProfile,
} from '../../game/src/ai/spawnTables';
import {ENEMY_ARCHETYPES} from '../../game/src/ai/creatureArchetypes';
import {pickEnemyArchetype} from '../../game/src/ai/creatureSpawn';
import {HEARING, ZOMBIE_STATS, type ZombieStats} from '../../game/src/ai/brain';
import {BLIGHTBELLY_BURST, BLIGHTBELLY_STATS} from '../../game/src/ai/blightbelly';
import {SIREN_CLAW, SIREN_STATS, SIREN_WAKE} from '../../game/src/ai/siren';
import {LUNGE as RATDOG_LUNGE, RATDOG_STATS} from '../../game/src/ai/creatureActor';
import {STRAINER_ASSET, STRAINER_MAX_TOP_M, STRAINER_SCALE, STRAINER_STATS} from '../../game/src/ai/strainer'; // task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY)
import {IMPACT_FAMILY_LOUDNESS, SCREACHER_AGGRO, SCREACHER_ASSET, SCREACHER_ECHO, SCREACHER_MAX_TOP_M, SCREACHER_NOISE, SCREACHER_SCALE, SCREACHER_SENSE, SCREACHER_SPEED, SCREACHER_STATS, SCREACHER_VARIANTS} from '../../game/src/ai/screacher'; // task studio-screacher-production-20261110-221858-01
// task studio-screacher-production-20261110-221858-01: the seeded roster (the rule table, the pass itself, the roll, the version pin)
import {
  FAMILY_ROSTER, ROSTER_LANE, ROSTER_PLACE_PRIORITY, ROSTER_VERSION, ZOMBIE_FREE_LEVELS, applyEnemyRoster, familyInRoster, rosterRate,
  type RosterReport, type RosterRule,
} from '../../game/src/ai/enemyRoster';
import {LEVELS, LEVEL_IDS} from '../../game/src/levels/registry';
import {validateLevelRegistry} from '../../game/src/levels/levelContract';
import type {LevelId} from '../../game/src/levels/types';
import type {Area, StationLayout} from '../../game/src/gen/stationTypes';
import {OFFICE_FLOORS} from '../../game/src/gen/office/frame';
import {MALL_RINGS} from '../../game/src/gen/mall/mallTypes'; // task track3-eaton-centre-20261031 (lane PROFILES)
import {LINGERIE_SPAWN_RULES, LINGERIE_STORES_MAX} from '../../game/src/gen/mall/lingerieSpawns'; // task mall-lingerie-20261102-221554 (lane CONTEXT): the lingerie store's zone
import {COSPLAY_CONVENTIONS_MAX, COSPLAY_SPAWN_RULES} from '../../game/src/gen/skyways/cosplaySpawns'; // task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the convention's zone
import {COSPLAY_FLOOR_BUDGET} from '../../game/src/gen/skyways/cosplayFloors'; // task studio-cosplay-general-20261108-225231-01 (lane UPPER): the version-6 second run
import * as CC from '../../game/src/ai/cosplayContext';
const {COSPLAY_CONTEXT} = CC;
import {TRACK_EXT, TRACK_EXT_BUNKER, TRACK_EXT_MALL, TRACK_EXT_MARKET, TRACK_EXT_REACTOR, TRACK_EXT_SKYWAYS} from '../../game/src/gen/trackExt/config'; // Track 2 (lane CONTENT): annexes per level (the service zone's runs); + the mall's (task mall-playtest-revision-20261031: at most 1)
import {CELL} from '../../game/src/gen/grid';
import {ROOM_LABEL} from '../../game/src/gen/stationKit';
import {purposeById} from '../../game/src/gen/purposes';
import {startWeaponFor} from '../../game/src/weapons/pistol';
import {rd} from './probability';
import {
  ENEMY_REFERENCE_SCHEMA,
  type CensusCorpus, type EligibilityCensus, type EligibilityInfo, type EnemyFamilyInfo, type EnemyKnob, type EnemyLevelInfo, type EnemyReference,
  type FamilyRuleGroup, type FamilyStatsVariant, type LevelCensus, type LevelMovesInfo, type ModifierSemantics, type PlacementInfo, type RoomCensus,
  type RoomModifierTable, type RoomRow, type SourceLoc, type SpawnContextInfo, type VocabEntry, type ZombieTypeInfo,
  type AmbientBudgetInfo, type HordeInfo, // task track3-eaton-centre-20261031 (lane PROFILES)
  type LevelRosterInfo, type LevelRosterRow, type RosterCensus, type RosterFamilyInfo, type RosterInfo, // task studio-screacher-production-20261110-221858-01
} from './enemyReferenceTypes';

// ---------------------------------------------------------------------------------------------------------------------------
// Options / constants

export interface EnemyReferenceOptions {
  /** Source commit shown on every page (GITHUB_SHA / `git rev-parse HEAD` / 'local'). */
  commit?: string;
  /** Build id (CI run id); default: the data hash. */
  buildId?: string;
  /** Reads a repo-relative file (for source line numbers); omit: links point at files without lines. */
  readSource?: (repoPath: string) => string | null | undefined;
  /** Census seeds per level (default ENEMY_CENSUS_SEEDS); [] = no census. */
  censusSeeds?: readonly number[];
  /** TESTS ONLY: the profile a level resolves with (default: the registered spawnProfile(level)). Requires censusSeeds: []. */
  profileFor?: (level: LevelId) => SpawnProfile;
  /**
   * Eligibility census seeds per level with an eligibility rule (default ENEMY_ELIGIBILITY_SEEDS when the census is on) — and
   * (task studio-screacher-production-20261110-221858-01) the ROSTER census seeds of every combat level: one sample pass serves both.
   */
  eligibilitySeeds?: readonly number[];
}

/** The fixed SAMPLED census seeds (a few per level; not exhaustive). */
export const ENEMY_CENSUS_SEEDS: readonly number[] = [11, 222, 3333, 44444];
/**
 * Task track1 (lane SPAWN): the fixed SAMPLED eligibility-census seeds (levels whose profile restricts a family — the Office's
 * Siren): 20 generated levels, enough to show draws vs placed per level; the 400-run tuning census is in docs/enemy-spawns.md.
 */
export const ENEMY_ELIGIBILITY_SEEDS: readonly number[] = Array.from({length: 20}, (_, k) => 5003 + 7919 * k);
/**
 * Task studio-screacher-production-20261110-221858-01: the fixed SAMPLED roster-census seeds — the SAME 20 generated levels as the
 * eligibility census (one generation serves both), for every level that can hold enemies. A small sample: the long-run rates are the
 * roster rule's (FAMILY_ROSTER), and the roll itself is also evaluated over ROSTER_ROLL_CHECK_SEEDS seeds without generating a level.
 */
export const ENEMY_ROSTER_SEEDS: readonly number[] = ENEMY_ELIGIBILITY_SEEDS;
/** Level seeds 1..N the roster ROLL is evaluated for per family and level (familyInRoster: a pure hash; no level is generated). */
export const ROSTER_ROLL_CHECK_SEEDS = 10_000;

const F = {
  tables: 'game/src/ai/spawnTables.ts', spawn: 'game/src/ai/creatureSpawn.ts', archetypes: 'game/src/ai/creatureArchetypes.ts',
  wardrobe: 'game/src/ai/wardrobe.ts', registry: 'game/src/levels/registry.ts', station: 'game/src/gen/station.ts',
  stationDress: 'game/src/gen/stationDress.ts', levelGenDress: 'game/src/gen/levelGenDress.ts', officeIndex: 'game/src/gen/office/index.ts',
  officeSpawns: 'game/src/gen/office/spawns.ts', officeValidate: 'game/src/gen/office/validate.ts', roof: 'game/src/gen/office/roof.ts',
  frame: 'game/src/gen/office/frame.ts', grid: 'game/src/gen/grid.ts', stationKit: 'game/src/gen/stationKit.ts', purposes: 'game/src/gen/purposes.ts',
  memory: 'game/src/run/memory.ts', pistol: 'game/src/weapons/pistol.ts',
  // task track1 (lane SPAWN): family stats / rules, the registry contract
  brain: 'game/src/ai/brain.ts', blightbelly: 'game/src/ai/blightbelly.ts', siren: 'game/src/ai/siren.ts', creatureActor: 'game/src/ai/creatureActor.ts',
  strainer: 'game/src/ai/strainer.ts', // task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY)
  contract: 'game/src/levels/levelContract.ts',
  // task track3-eaton-centre-20261031 (lane PROFILES): the mall (seeded "<Name> Center")
  mallIndex: 'game/src/gen/mall/index.ts', reactorIndex: 'game/src/gen/reactor/index.ts', skywaysIndex: 'game/src/gen/skyways/index.ts', marketIndex: 'game/src/gen/market/index.ts', bunkerIndex: 'game/src/gen/bunker/index.ts', mallTypes: 'game/src/gen/mall/mallTypes.ts', hordeSpec: 'game/src/ai/hordeSpec.ts',
  // Track 2 (lane CONTENT): the service annexes (zone context): their generation config and the content pass that places them
  trackExt: 'game/src/gen/trackExt/config.ts', annexContent: 'game/src/gen/annexContent.ts',
  // task mall-lingerie-20261102-221554 (lane CONTEXT): the mall's optional lingerie store's store-local zone context
  lingerieSpawns: 'game/src/gen/mall/lingerieSpawns.ts',
  // task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the Skyways convention's cosplay zone context
  cosplaySpawns: 'game/src/gen/skyways/cosplaySpawns.ts', cosplayContext: 'game/src/ai/cosplayContext.ts',
  // task studio-screacher-production-20261110-221858-01: the Screacher and the seeded family roster
  screacher: 'game/src/ai/screacher.ts', roster: 'game/src/ai/enemyRoster.ts',
} as const;

/** The game modules whose exported values the reference reads (this file's imports). Other files appear only as source links. */
export const ENEMY_GENERATED_FROM: readonly string[] = [
  F.tables, F.archetypes, F.registry, F.frame, F.grid, F.stationKit, F.purposes, F.pistol, F.spawn, F.brain, F.blightbelly, F.siren, F.creatureActor,
  F.contract, F.mallTypes, F.trackExt, F.strainer, F.lingerieSpawns, F.cosplaySpawns, F.cosplayContext, F.screacher, F.roster,
].slice().sort();

/**
 * Task track1 (lane SPAWN): FAMILY ADAPTER — where each family's combat stats and behaviour constants are exported. `Record<
 * EnemyFamilyId, …>` makes a new family fail to typecheck until its exports are named here; every numeric / boolean / string leaf of
 * a rules constant is listed (labelled below when known, else by its key path) so a new knob can never be silently dropped.
 */
export const ENEMY_FAMILY_ADAPTER: Readonly<Record<EnemyFamilyId, {
  stats: readonly {variant: string | null; stats: ZombieStats; file: string; symbol: string}[];
  /** `labels`: this constant's own leaf labels (key path -> [label, unit]), read before the shared RULE_LABEL (the same key can mean another thing in another constant). */
  rules: readonly {title: string; value: object; file: string; symbol: string; labels?: Readonly<Record<string, readonly [string, string]>>}[];
  /** Names of the family's model variants (ENEMY_ARCHETYPES[id].variantModels keys), where it has several bodies. */
  variantNames?: Readonly<Record<string, string>>;
}>> = {
  zombie: {
    stats: [
      {variant: 'shambler', stats: ZOMBIE_STATS.shambler, file: F.brain, symbol: 'ZOMBIE_STATS.shambler'},
      {variant: 'coated', stats: ZOMBIE_STATS.coated, file: F.brain, symbol: 'ZOMBIE_STATS.coated'},
    ],
    rules: [],
  },
  blightbelly: {
    stats: [{variant: null, stats: BLIGHTBELLY_STATS, file: F.blightbelly, symbol: 'BLIGHTBELLY_STATS'}],
    rules: [{title: 'Death burst (once, when killed)', value: BLIGHTBELLY_BURST, file: F.blightbelly, symbol: 'BLIGHTBELLY_BURST'}],
  },
  siren: {
    stats: [{variant: null, stats: SIREN_STATS, file: F.siren, symbol: 'SIREN_STATS'}],
    rules: [
      {title: 'Dormant wake rules', value: SIREN_WAKE, file: F.siren, symbol: 'SIREN_WAKE'},
      {title: 'Claw lunge', value: SIREN_CLAW, file: F.siren, symbol: 'SIREN_CLAW'},
    ],
  },
  ratdog: {
    stats: [{variant: null, stats: RATDOG_STATS, file: F.creatureActor, symbol: 'RATDOG_STATS'}],
    rules: [{title: 'Bite lunge', value: RATDOG_LUNGE, file: F.creatureActor, symbol: 'LUNGE'}],
  },
  // task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): THE STRAINER (service annexes only)
  strainer: {
    stats: [{variant: null, stats: STRAINER_STATS, file: F.strainer, symbol: 'STRAINER_STATS'}],
    rules: [
      {title: 'Body, reach and claw timing (asset contract enemy-strainer.glb; provisional until the GLB lands)', value: STRAINER_ASSET, file: F.strainer, symbol: 'STRAINER_ASSET'},
      {title: 'Runtime root scale (its own narrow jitter)', value: {scale: STRAINER_SCALE, maxTopM: STRAINER_MAX_TOP_M}, file: F.strainer, symbol: 'STRAINER_SCALE'},
    ],
  },
  // task studio-screacher-production-20261110-221858-01: THE SCREACHER (headless, blind, sound-hunting; placed only by the seeded roster:
  // its roster rule FAMILY_ROSTER.screacher is shown by the roster block every family has — EnemyReference.roster)
  screacher: {
    stats: [{variant: null, stats: SCREACHER_STATS, file: F.screacher, symbol: 'SCREACHER_STATS'}],
    variantNames: Object.fromEntries(Object.entries(SCREACHER_VARIANTS).map(([id, v]) => [id, v.name])),
    rules: [
      {title: 'Paces of its three aggression tiers (it is blind: it walks or runs toward the last sound it believes in)', value: SCREACHER_SPEED, file: F.screacher, symbol: 'SCREACHER_SPEED', labels: {
        investigate: ['INVESTIGATE pace (heat below the hunt threshold): a stalking walk toward the sound', 'm/s'],
        hunt: ['HUNT pace (heat from the hunt threshold)', 'm/s'],
        frenzy: ['FRENZY pace (heat from the frenzy threshold): a run', 'm/s'],
      }},
      {title: 'Aggression: every distinct sound adds heat, quiet cools it', value: SCREACHER_AGGRO, file: F.screacher, symbol: 'SCREACHER_AGGRO', labels: {
        'weight.gunshot': ['heat added by a gunshot-class sound (gunfire, melee contact, explosions, machines)', 'heat'],
        'weight.run': ['heat added by one sprinting footstep', 'heat'],
        'weight.land': ['heat added by a landing', 'heat'],
        'weight.impact': ['heat added by a prop / item impact', 'heat'],
        'weight.drag': ['heat added by a pushed box scraping the floor', 'heat'],
        'weight.touch': ['heat added by touching the player, or by a melee hit from touch range', 'heat'],
        'weight.echo': ['heat added by a scream that found the player', 'heat'],
        'weight.pain': ['heat added by a hit from beyond touch range (it feels pain, but learns no position from it)', 'heat'],
        mergeS: ['sounds closer together than this count as one event (a shotgun blast, one crash)', 's'],
        heatMax: ['heat cap', 'heat'],
        huntAt: ['heat from which it hunts', 'heat'],
        frenzyAt: ['heat from which it is frenzied', 'heat'],
        quietHoldS: ['silence before the heat starts to fall', 's'],
        decayPerS: ['heat lost per second of silence after that', 'heat per s'],
      }},
      {title: 'What it hears besides gunfire: loudness of each sound (radius around its source)', value: SCREACHER_NOISE, file: F.screacher, symbol: 'SCREACHER_NOISE', labels: {
        run: ['one sprinting footstep (walking and crouch-walking make no sound it hears)', 'm'],
        landMinSpeed: ['a landing counts from this landing speed', 'm/s'],
        landBase: ['landing loudness: base radius', 'm'],
        landPerMs: ['landing loudness: added per m/s of landing speed', 'm per m/s'],
        landMax: ['landing loudness at most', 'm'],
        impactMinSpeed: ['a prop / item impact counts from this impact speed', 'm/s'],
        impactBase: ['impact loudness: base radius', 'm'],
        impactPerMs: ['impact loudness: added per m/s of impact speed', 'm per m/s'],
        impactMax: ['impact loudness at most', 'm'],
        drag: ['a pushed box scraping along the floor', 'm'],
      }},
      {title: 'Impact loudness by what struck (the object\'s sound family: a factor on the impact radius; a family not listed counts 1)', value: IMPACT_FAMILY_LOUDNESS, file: F.screacher, symbol: 'IMPACT_FAMILY_LOUDNESS', labels: {
        light: ['soft and light things (physics sound family light)', 'x'],
        cardboard: ['cardboard (physics sound family cardboard)', 'x'],
        can: ['a can (physics sound family can)', 'x'],
        heavy: ['a heavy object (physics sound family heavy)', 'x'],
        prop: ['an ordinary loose prop (physics sound family prop)', 'x'],
        wood: ['wood (physics sound family wood)', 'x'],
        stone: ['stone (physics sound family stone)', 'x'],
        glass: ['glass (physics sound family glass)', 'x'],
        metal: ['sheet metal (physics sound family metal)', 'x'],
      }},
      {title: 'How far a sound carries to it (the gunfire rule of every enemy: a factor on the loudness radius)', value: HEARING, file: F.brain, symbol: 'HEARING', labels: {
        wall: ['no clear line between the sound and the listener, same storey', 'x'],
        slab: ['per storey floor between the sound and the listener (instead of the wall factor)', 'x'],
      }},
      {title: 'Touch and memory', value: SCREACHER_SENSE, file: F.screacher, symbol: 'SCREACHER_SENSE', labels: {
        touchM: ['it feels the player\'s body within this centre-to-centre distance (same floor)', 'm'],
        painTouchM: ['a melee hit from within this distance tells it where the attacker stands', 'm'],
        beliefTtlS: ['a believed position older than this, without a newer sound, is forgotten', 's'],
        stallS: ['a chase without progress for this long gives the believed position up (an unreachable sound)', 's'],
        holdS: ['a quieter class of sound does not move the believed position while a louder one is younger than this', 's'],
      }},
      {title: 'Echolocation scream (one position snapshot; no damage, no stun, calls nobody)', value: SCREACHER_ECHO, file: F.screacher, symbol: 'SCREACHER_ECHO', labels: {
        periodS: ['time between screams, of active play (its own clock: no pause, menu or offline catch-up)', 's'],
        jitterS: ['each period varies by up to this much either way', 's'],
        firstMinS: ['its first scream comes no earlier than', 's'],
        firstSpanS: ['the first scream is staggered over this span after that (from its spawn position: two never scream in unison)', 's'],
        rangeM: ['the scan finds the player within this distance (3D) when no solid geometry is between', 'm'],
        cueS: ['the scan happens this far into the scream', 's'],
        holdS: ['it stands still for the length of the scream', 's'],
        retryS: ['a scream cut short by a staggering hit before its scan is retried after', 's'],
      }},
      {title: 'Body, reach and clip timing (the asset contract numbers of enemy-screacher-sc01..sc04.glb that the gameplay reads; no head hit volume)', value: SCREACHER_ASSET, file: F.screacher, symbol: 'SCREACHER_ASSET', labels: {
        heightM: ['bind height (feet to the top of the neck stump, scale 1)', 'm'],
        reachM: ['horizontal reach of the striking hand at the Attack hit frame', 'm'],
        attackHitTime: ['the hand lands this far into the Attack clip', 's'],
        screamDuration: ['Scream clip length', 's'],
        screamCueTime: ['the cry peaks (the echo scan) this far into the Scream clip', 's'],
      }},
      {title: 'Runtime root scale (its own narrow jitter)', value: {scale: SCREACHER_SCALE, maxTopM: SCREACHER_MAX_TOP_M}, file: F.screacher, symbol: 'SCREACHER_SCALE', labels: {
        maxTopM: ['neck-stump height cap', 'm'],
      }},
    ],
  },
};

/** Labels + units of known rule constant leaves (key path → [label, unit]). Unknown leaves show their key path. */
const RULE_LABEL: Readonly<Record<string, readonly [string, string]>> = {
  // ai/blightbelly.ts BLIGHTBELLY_BURST
  delayS: ['delay between the kill and the burst', 's'], centreY: ['burst centre above the feet', 'm'],
  blastMax: ['blast damage to the player at most (inside the inner radius)', 'hp'], blastInner: ['full-damage inner radius', 'm'],
  blastRadius: ['blast radius (linear falloff to 0)', 'm'], bodySamples: ['player body sample heights (damage x visible fraction)', 'm'],
  enemyMax: ['blast damage to other enemies at most', 'hp'], noise: ['burst noise hearing radius', 'm'],
  maxPerFrame: ['bursts processed per frame at most', ''], maxQueued: ['queued bursts at most', ''], maxPops: ['visible pustule pops at most', ''],
  gasRadius: ['toxic gas source radius', 'm'], gasPeak: ['toxic gas source peak concentration', 'relative'],
  gasEmitS: ['toxic gas emission time', 's'], gasDurationS: ['toxic gas cloud life (then it is gone)', 's'],
  // ai/siren.ts SIREN_WAKE / SIREN_CLAW
  proximityM: ['proximity wake: plan distance to the player (with a sight line)', 'm'], proximityDy: ['proximity wake: max height difference (same storey)', 'm'],
  onDamage: ['a direct hit wakes her', ''], gunfireHearing: ['gunfire / noise wakes her while dormant', ''], sightCone: ['ordinary sight cone while dormant', ''],
  lightLure: ['lured by lights while dormant', ''], flares: ['flares wake her', ''],
  'flashlight.kinds': ['light kinds that wake her (beam cone + range + clear ray)', ''], 'flashlight.period': ['flashlight check period', 's'],
  'flashlight.minIntensity': ['minimum emitting brightness of the beam', 'relative'], 'flashlight.maxRange': ['flashlight wake range cap', 'm'],
  'flashlight.points': ['body sample points of the dormant pose (any one lit wakes her)', 'points'],
  riseS: ['rise after the wake (default; the Rise clip length when present)', 's'], riseMin: ['rise at least', 's'], riseMax: ['rise at most', 's'],
  'lunge.from': ['lunge starts this far into the swing', 's'], 'lunge.speed': ['lunge speed', 'm/s'], 'lunge.stop': ['no lunge closer than', 'm'],
  // ai/creatureActor.ts LUNGE
  from: ['lunge starts this far into the bite', 's'], to: ['lunge ends', 's'], speed: ['lunge speed', 'm/s'], stop: ['no lunge closer than', 'm'],
  // ai/strainer.ts STRAINER_ASSET / STRAINER_SCALE (task studio-alpha-beyond-station-round4-20261101-01, lane FAMILY)
  heightM: ['bind height (feet to crown, scale 1)', 'm'], headCenter: ['head hit-sphere centre, bind pose (x, y, z; hunched forward)', 'm'],
  headRadius: ['head hit-sphere radius', 'm'], reachM: ['horizontal claw reach at the Attack hit frame (attack range = reach + the player\'s 0.3 m body radius)', 'm'],
  attackHitTime: ['claws land this far into the Attack clip', 's'], attackDuration: ['Attack clip length', 's'],
  walkGroundSpeed: ['Walk clip authored ground speed', 'm/s'], runGroundSpeed: ['Run clip authored ground speed', 'm/s'],
  'hitRadii.torso': ['torso hit-capsule radius', 'm'], 'hitRadii.arm': ['arm hit-capsule radius', 'm'], 'hitRadii.leg': ['leg hit-capsule radius', 'm'],
  'scale.min': ['runtime root scale at least', 'x'], 'scale.max': ['runtime root scale at most', 'x'], maxTopM: ['crown height cap (annex doors are 2.3 m)', 'm'],
};

/**
 * Every leaf of a rules constant as a row (nested objects flattened by key path; arrays: numbers joined, else their length).
 * `labels` (task studio-screacher-production-20261110-221858-01): the constant's own labels, read before the shared RULE_LABEL.
 */
export function ruleRows(value: object, prefix = '', labels: Readonly<Record<string, readonly [string, string]>> = {}): {what: string; value: number | string; unit: string}[] {
  const out: {what: string; value: number | string; unit: string}[] = [];
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const [label, unit] = labels[key] ?? RULE_LABEL[key] ?? [key, ''];
    if (v && typeof v === 'object' && !Array.isArray(v)) { out.push(...ruleRows(v, key, labels)); continue; }
    let shown: number | string;
    if (Array.isArray(v)) shown = v.every(x => typeof x === 'number') ? v.join(', ') : v.every(x => typeof x === 'string') ? v.join(', ') : v.length;
    else if (typeof v === 'boolean') shown = v ? 'yes' : 'no';
    else if (typeof v === 'number' || typeof v === 'string') shown = v;
    else continue;
    out.push({what: label, value: shown, unit});
  }
  return out;
}

/** Track 2 (lane CONTENT): how the service-annex zone context relates to the level (shown with the context). */
const SERVICE_ZONE_NOTE = 'A PER-ANNEX ZONE BUDGET: one run per seeded service annex (0 to TRACK_EXT.annex.max per level, a generation census quantity — see docs/enemy-spawns.md "Service annexes"), on the annex\'s own fork, appended after every core spawn and tagged \'service\'. It is additive to the core contexts and NOT in the whole-level total above; the level\'s zombie types apply; its spawns draw from the annexes\' OWN family pool (SERVICE_FAMILY_POOL: a configured 20 % rat/dog selection share, Blightbelly 5 %, Strainer 8 % (the only pool that enables it: STRAINER_CONTEXTS), no Siren — per-spawn probabilities, not quotas). The seeded roster pass then runs on the finished level (see the seeded roster): it fixes the level\'s Strainers at EXACTLY ONE on the maps whose seed rolled the Strainer present, and at none on the others, and it decides per level whether Blightbellies and rat/dogs are there at all (the Screacher\'s slot rule lists the core contexts, not the annex). The sampled census shows the outcome with the pass applied. Killed annex enemies stay dead for the run (per-index memory).';

/**
 * Task mall-lingerie-20261102-221554 (lane CONTEXT): how the lingerie store's zone context relates to the mall (shown with the context),
 * the store-local eligibility line and the placement steps of gen/mall/lingerieSpawns.ts placeLingerieSpawns (not the generic area order).
 */
const LINGERIE_ZONE_NOTE = `A STORE-LOCAL ZONE BUDGET: one run per lingerie store — the store is a seeded shop program on a LARGE lot (0 to ${LINGERIE_STORES_MAX} per mall, never guaranteed) — on its own fork (mall-lingerie-spawns), appended after EVERY other spawn of the mall (ambient, hordes, annex 'service') and tagged 'lingerie' (spawn context and ZombieSpawn.look). It is additive to the core contexts and NOT in the whole-level total or the ambient budget; its spawns draw from the store's OWN family pool (LINGERIE_FAMILY_POOL: ordinary zombies only — no Blightbelly, Siren, rat/dog, Strainer or Screacher; the seeded roster never converts an outfit zombie), are shamblers, and wear a fitted lingerie set at spawn time (ai/lingerie.ts lingerieLook(level seed, spawn index)) — a wardrobe look of the zombie family, never a new family. Every other spawn of every level keeps the ordinary wardrobe pick. No leash: after aggro they may follow the player out of the store. Killed variants stay dead for the run (per-index memory); a mall without a lingerie store has none.`;
const LINGERIE_ZONE_WHERE = `the lingerie store's own sales floor only (never its stock room, a gallery or another unit), ≥ ${LINGERIE_SPAWN_RULES.entryKeepM} m from its shopfront(s): in a BOOTH (a changing rect with 1-${LINGERIE_SPAWN_RULES.boothOpeningCells} opening cells — its curtain gap) the centre of a 2 × 2 patch of its walkable cells off the opening row (the booth's centre line); the aisle hosts nobody while the store has booths; on the sales floor a 3 × 3-clear cell > ${LINGERIE_SPAWN_RULES.changingMarginCells} cells off the changing area and ≥ ${LINGERIE_SPAWN_RULES.changingEntryKeepM} m from its mouth; everywhere a ${LINGERIE_SPAWN_RULES.passageRadiusM} m disc around the spawn never splits the storey (fair passage)`;
const LINGERIE_ZONE_EXPLAIN: readonly string[] = [
  `Only when the mall has a lingerie store: draw count = U{${ST.LINGERIE_CONTEXT.count[0]}..${ST.LINGERIE_CONTEXT.count[1]}} (one draw per store, rng.int); every one a shambler (no coat roll: the look is a lingerie set).`,
  `Split: floor(count / ${LINGERIE_SPAWN_RULES.floorEvery}) on the store's sales floor, the rest in its walk-in changing area (MallShop.changing: one rect per booth + the aisle) — 3 → 2 + 1, 4 → 3 + 1, 5 → 4 + 1.`,
  `The changing area first: its booth rects in a seeded order, round-robin — one spawn per booth per pass (spread over the booths), each from up to ${ST.LINGERIE_PLACEMENT.tries} random picks of that booth's stand points; then the sales floor takes its share plus what the changing area could not hold; then the changing area takes what the floor could not.`,
  `A pick is taken when it is ≥ ${ST.LINGERIE_PLACEMENT.spacingM} m from every enemy already on the storey and its fair-passage disc never splits the floor. Spacing and eligible floor can leave a run short of its count (placed < count); a run never regenerates the level.`,
  'Each placed spawn is an ordinary zombie (the store\'s own pool, rolled by the one family roll at the end).',
];

/**
 * Task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): how the Skyways convention's cosplay zone context relates to the level,
 * its eligibility line and the placement steps of gen/skyways/cosplaySpawns.ts placeCosplaySpawns (not the generic area order).
 */
/**
 * Task studio-bunker-level-20261109-072224-01 (lane LEVEL): THE BUNKER's damp zone — one run per Bunker level over its water-damaged
 * areas (layout.bunker.damp); 0 when a level has no damp area (gen/bunker: the maintenance & water storey's pump hall / filtration plant /
 * flooded wing). The reference's zone ceiling.
 */
export const BUNKER_DAMP_RUNS_MAX = 1;
const BUNKER_DAMP_ZONE_NOTE = `A DAMP-SECTION ZONE BUDGET: one run per Bunker level (0 to ${BUNKER_DAMP_RUNS_MAX}: a level without a damp area has none) over the water-damaged areas only (layout.bunker.damp: the pump hall, the filtration plant, the flooded maintenance wing), on its own fork, appended after the storey runs and tagged 'damp'. It is additive to the core contexts and NOT in the whole-level total; its one spawn draws from the zone's OWN family pool (BUNKER_DAMP_SHARES: rat/dog 10 %, THE STRAINER 30 % — the only pool outside the service annexes that enables it: STRAINER_CONTEXTS — the zombie the remainder; no Siren, no Blightbelly) — a per-spawn probability. The seeded roster pass then decides (see the seeded roster): on the maps whose seed rolled the Strainer present the damp spawn IS the level\'s one Strainer (whatever the per-spawn roll drew there — a rat/dog drawn there is exchanged to an ordinary zombie slot elsewhere), on the others the level has none. Killed ones stay dead for the run (per-index memory).`;
const COSPLAY_ZONE_NOTE = `A CONVENTION ZONE BUDGET (layout version 5+): one run when the level's one add-on is the anime convention (0 to ${COSPLAY_CONVENTIONS_MAX} per level, never guaranteed — the alternative add-on, the prize display, has none), on its own fork (skyways-cosplay-spawns), appended after EVERY other spawn of the level (ambient, hordes, annex 'service') and tagged 'cosplay' (spawn context and ZombieSpawn.look). It is additive to the core contexts and NOT in the whole-level total; its spawns draw from the convention's OWN family pool (COSPLAY_FAMILY_POOL: ordinary zombies only — no Blightbelly, Siren, rat/dog, Strainer or Screacher; the seeded roster never converts an outfit zombie), are shamblers, and wear a costume at spawn time (ai/cosplay.ts cosplayLook(level seed, spawn index): the mascot's bear-ear hat + wig, an oversized mascot head, a sushi hat, the alternate-palette wig with a uniform) — a wardrobe look of the zombie family, never a new family. Every other spawn keeps the ordinary wardrobe pick. No leash. Killed ones stay dead for the run (per-index memory). Layout versions 1-4 never run it.`;
const COSPLAY_ZONE_WHERE = `the convention venue's public event floor only (its main hall, exhibitors' floor, photo lounge and panel rooms — never registration, the back of house, storage or the washrooms): a 3 × 3-clear walkable floor cell, never a ramp, ≥ ${COSPLAY_SPAWN_RULES.doorKeepM} m from every door of those areas and from the add-on's entry, ≥ ${COSPLAY_SPAWN_RULES.statueKeepM} m from every mascot statue (the greeter included), off the stage + ${COSPLAY_SPAWN_RULES.stageMarginM} m, a ${COSPLAY_SPAWN_RULES.passageRadiusM} m disc around the spawn never splitting the storey (fair passage)`;
const COSPLAY_ZONE_EXPLAIN: readonly string[] = [
  `Only with the convention add-on (layout version 5+): draw count = U{${COSPLAY_CONTEXT.count[0]}..${COSPLAY_CONTEXT.count[1]}} (one draw, rng.int); every one a shambler (no coat roll: the look is a costume).`,
  `Round-robin over the hosting areas — the main hall first, the others in a seeded order — one spawn per area per pass (spread over the venue), each from up to ${COSPLAY_CONTEXT.placement.tries} random picks of that area's stand points.`,
  `A pick is taken when it is ≥ ${COSPLAY_CONTEXT.placement.spacingM} m from every enemy already on the storey and its fair-passage disc never splits the floor. Spacing and eligible floor can leave the run short of its count (placed < count); a run never regenerates the level.`,
  'Each placed spawn is an ordinary zombie (the convention\'s own pool, rolled by the one family roll at the end).',
  // (task studio-cosplay-general-20261108-225231-01, lane UPPER) the version-6 second run on the convention building's other floor
  `Layout version 6+: a SECOND run appended right after it (gen/skyways/cosplayFloors.ts placeCosplayFloorSpawns, fork skyways-cosplay-floors), U{${COSPLAY_FLOOR_BUDGET[0]}..${COSPLAY_FLOOR_BUDGET[1]}} more on the host building's other public storey joined to the venue by its stair (today its street floor: lobby / galleria / court, entrance halls — never a shop, washroom, back room or stair core), each pick uniform over that floor's stand points with the same keep-offs (landings, doors, the boarded street entrances, passage, spacing); same tags and pool. A convention level holds up to ${COSPLAY_CONTEXT.count[1] + COSPLAY_FLOOR_BUDGET[1]} cosplayers.`,
];

/**
 * GENERATOR ADAPTER: which generator reads each level's profile and how often each context runs per level. These are code paths
 * of the generators (not data), declared here — `Record<LevelId, …>` makes a new level fail to typecheck until it is documented,
 * and game/tests/enemy-spawn-reference.test.ts checks that the contexts declared here === the profile's === the ones the real
 * generator asks for.
 */
export const ENEMY_LEVEL_ADAPTER: Readonly<Record<LevelId, {
  generator: {fn: string; file: string; note: string};
  /**
   * The profile's AMBIENT contexts (=== Object.keys(profile.contexts); the horde pool's tag is reported in the horde section).
   * `hook`: a DATA-HOOK context the generator does not run yet (0 runs; task track3-eaton-centre-20261031, lane PROFILES).
   * `zone` (Track 2): a same-world zone context — one run per seeded zone, `runsPerLevel` zones per level (never in the total).
   */
  contexts: Readonly<Partial<Record<SpawnContextId, {storeys: string; runs: number; hook?: string; zone?: {runsPerLevel: readonly [number, number]; note: string; where?: string; explain?: readonly string[]}}>>>;
}>> = {
  subway: {
    generator: {fn: 'generateStation', file: F.station,
      note: 'One station per level seed: placeSpawns (fork "spawns", after the loose floor finds) places the station context on the main level, placeLevelSpawns (fork "levelSpawns") moves a weighted share onto the upper / lower storeys; then (Track 2) placeServiceSpawns (gen/annexContent.ts, fork "track-ext-content") runs the service context once per seeded service annex, appended last; assignEnemyArchetypes rolls every family once at the end.'},
    contexts: {
      station: {storeys: 'the main level, then the storey moves onto the upper / lower levels', runs: 1},
      service: {storeys: 'one seeded service annex off a track tunnel (its rooms and corridors only)', runs: 1, zone: {runsPerLevel: [0, TRACK_EXT.annex.max], note: SERVICE_ZONE_NOTE}},
    },
  },
  office: {
    generator: {fn: 'generateOfficeLevel', file: F.officeIndex,
      note: 'ONE continuous level (station, lobby, office floors 2..8, roof) generated once per level seed: placeOfficeEnemies runs once per storey context on its own fork, then (Track 2) placeServiceSpawns runs the service context once per seeded service annex of the street station, appended last; assignEnemyArchetypes rolls every family once at the end. Changing floors never rerolls anything.'},
    contexts: {
      street: {storeys: 'station + tower lobby (levels 0 and 1)', runs: 1},
      floor: {storeys: 'one office floor (each of floors 2..8)', runs: OFFICE_FLOORS.filter(f => f !== 1).length},
      roof: {storeys: 'the roof deck (level 9; the hatch / ladder zone held empty)', runs: 1},
      service: {storeys: 'one seeded service annex off a track tunnel of the street station (its rooms and corridors only)', runs: 1, zone: {runsPerLevel: [0, TRACK_EXT.annex.max], note: SERVICE_ZONE_NOTE}},
    },
  },
  // task track3-eaton-centre-20261031 (lane PROFILES): the mall — ONE level: the station + the retail floors. Task
  // mall-playtest-revision-20261031 (lane PROFILES, U01): its display name is seeded per run ("<Name> Center", gen/mall/names.ts
  // mallNameOf(levelSeed)); LevelId 'mall', tier 2; the compact design has ${MALL_RINGS} retail floors (MALL_RINGS = MALL_FLOORS)
  mall: {
    generator: {fn: 'generateMallLevel', file: F.mallIndex,
      note: `ONE continuous level (LevelId 'mall', tier 2; its display name is seeded per run: "<Name> Center", gen/mall/names.ts mallNameOf(levelSeed) — the same seed always gives the same name) — the subway station at the bottom of a small glass atrium and ${MALL_RINGS} retail floors above it, generated once per level seed: placeOfficeEnemies runs the pit context once (the station storey) and the ring context once per retail floor, each on its own fork (mall-enemies-<storey>) and tags its spawns with the context; the roaming hordes (the separate horde pool, tagged '${HORDE_CONTEXT}') follow from ai/hordePlace.ts placeHordes; then (Track 2) the station's tunnel / service annex (at most ${TRACK_EXT_MALL.annex.max}) is attached and placeServiceSpawns (gen/annexContent.ts, fork "track-ext-content") runs the service context once per seeded service annex, appended last; then (task mall-lingerie-20261102-221554) the optional lingerie store's store-local run (gen/mall/lingerieSpawns.ts placeLingerieSpawns, fork "mall-lingerie-spawns": the lingerie context, at most ${LINGERIE_STORES_MAX} store) is appended after those; assignEnemyArchetypes rolls every family ONCE at the end (horde members keep their own pool's family; Siren eligibility included) and applyFamilySpacing keeps the Sirens of the whole mall apart (cap and spacing jointly). Moving between storeys never rerolls anything.`},
    contexts: {
      pit: {storeys: 'the subway station storey at the bottom of the atrium (level 0: platforms, Fountain court, station back of house)', runs: 1},
      ring: {storeys: `one retail floor (each of levels 1..${MALL_RINGS}: atrium court galleries, corridor wings, shops, stock rooms, service corridors)`, runs: MALL_RINGS},
      // lane INTEG (Track2 integration): the station's service annex — the same zone context as the Subway / Office; the mall grows at
      // most TRACK_EXT_MALL.annex.max (1) annex (task mall-playtest-revision-20261031, lane GEN)
      service: {storeys: 'one seeded service annex off the east track tunnel of the station (its rooms and corridors only)', runs: 1, zone: {runsPerLevel: [0, TRACK_EXT_MALL.annex.max], note: SERVICE_ZONE_NOTE}},
      // task mall-lingerie-20261102-221554 (lane CONTEXT): the optional lingerie store (0..LINGERIE_STORES_MAX per mall) — store-local
      lingerie: {storeys: 'the lingerie store of one retail floor (its walk-in changing area first, then its sales floor; nowhere else)', runs: 1,
        zone: {runsPerLevel: [0, LINGERIE_STORES_MAX], note: LINGERIE_ZONE_NOTE, where: LINGERIE_ZONE_WHERE, explain: LINGERIE_ZONE_EXPLAIN}},
    },
  },
  // Task reactor-build-20261101 (primary + lane GEN): THE REACTOR — depth-graded contexts (the rim, upper / deep walkway tiers, the core
  // floor) + the rim station's annex.
  reactor: {
    generator: {fn: 'generateReactorLevel', file: F.reactorIndex,
      note: `ONE continuous level (LevelId 'reactor', tier 3): a rim subway station at the TOP of a vertical industrial pit, walkway tiers going down and the core floor round the dormant reactor vessel, generated once per level seed: placeOfficeEnemies runs the station context once (the rim storey), the floor context once per UPPER walkway tier, the ring context once per DEEP walkway tier and the pit context once (the core floor), each on its own fork (reactor-enemies-<storey>) with its OWN depth-graded family pool, and tags its spawns with the context; then (Track 2) the rim station's tunnel / service annex (at most ${TRACK_EXT_REACTOR.annex.max}) is attached and placeServiceSpawns runs the service context once per seeded service annex, appended last; assignEnemyArchetypes rolls every family ONCE at the end (the deep-tier Siren eligibility included) and applyFamilySpacing keeps the Sirens apart. Moving between tiers never rerolls anything.`},
    contexts: {
      station: {storeys: 'the rim storey (level 0: the station platform, the rim gallery, the rim control office)', runs: 1},
      floor: {storeys: 'one UPPER walkway tier (each of tiers 1-2: galleries, landings, bridges, side rooms)', runs: 2},
      ring: {storeys: 'one DEEP walkway tier (each of tiers 3-4: galleries, landings, bridges, side rooms incl. the switchgear room)', runs: 2},
      pit: {storeys: 'the core floor (round the vessel, the pump hall, the control room)', runs: 1},
      service: {storeys: 'one seeded service annex off a rim-station track tunnel (its rooms and corridors only)', runs: 1, zone: {runsPerLevel: [0, TRACK_EXT_REACTOR.annex.max], note: SERVICE_ZONE_NOTE}},
    },
  },
  // Task studio-skyways-level-20261106-054448-01 (primary): SKYWAYS — the station storey, the street level and the skyway level, each
  // one placeOfficeEnemies run on its own fork (skyways-enemies-<storey>), + the station's annex.
  skyways: {
    generator: {fn: 'generateSkywaysLevel', file: F.skywaysIndex,
      note: `ONE continuous level (LevelId 'skyways', tier 2): a subway station under the station building, its pedway concourse, the street-level lobbies and the "+15" skyway level with glazed bridges between the buildings, generated once per level seed: placeOfficeEnemies runs the station context once (storey 0), the street context once (storey 1) and the floor context once (storey 2), each on its own fork (skyways-enemies-<storey>), and tags its spawns with the context; then (Track 2) the station's tunnel / service annex (at most ${TRACK_EXT_SKYWAYS.annex.max}) is attached and placeServiceSpawns runs the service context once per seeded service annex, appended last; then (layout version 5+, task studio-skywalk-encounters-20261108-074144-01) the anime convention's cosplay run (gen/skyways/cosplaySpawns.ts placeCosplaySpawns, fork "skyways-cosplay-spawns": the cosplay context, at most ${COSPLAY_CONVENTIONS_MAX} convention) is appended after those; assignEnemyArchetypes rolls every family ONCE at the end. Moving between storeys never rerolls anything.`},
    contexts: {
      station: {storeys: 'the station storey (platforms, the pedway concourse, the station back of house)', runs: 1},
      street: {storeys: 'the street level (every building: lobbies, atrium courts, entrance halls, shops, service rooms)', runs: 1},
      floor: {storeys: 'the skyway level (concourses, bridges, shops, the add-on hall)', runs: 1},
      service: {storeys: 'one seeded service annex off a station track tunnel (its rooms and corridors only)', runs: 1, zone: {runsPerLevel: [0, TRACK_EXT_SKYWAYS.annex.max], note: SERVICE_ZONE_NOTE}},
      // task studio-skywalk-encounters-20261108-074144-01 (lane COSPLAY): the anime convention's cosplay zombies (0..1 convention per level)
      cosplay: {storeys: 'the convention venue\'s event floor (main hall, exhibitors\' floor, photo lounge, panel rooms) and, from layout version 6, the host building\'s other public floor joined to it by its stair (its street-floor concourse); nowhere else', runs: 1,
        zone: {runsPerLevel: [0, COSPLAY_CONVENTIONS_MAX], note: COSPLAY_ZONE_NOTE, where: COSPLAY_ZONE_WHERE, explain: COSPLAY_ZONE_EXPLAIN}},
    },
  },
  // Task studio-bunker-level-20261109-072224-01 (lane LEVEL): THE BUNKER — one placeOfficeEnemies run per storey (station / floor / ring
  // contexts, each its own pool), the damp-section zone run, no annex.
  bunker: {
    generator: {fn: 'generateBunkerLevel', file: F.bunkerIndex,
      note: `ONE continuous level (LevelId 'bunker', tier 2; its display name is the shelter's seeded name, gen/bunker/names.ts bunkerNameOf(levelSeed)): a buried subway station at the vault door of a civil-defence shelter and the shelter's storeys DESCENDING below it (entry & security, habitation, services & medical, maintenance & water, the central processing core), generated once per level seed: placeOfficeEnemies runs the station context once (storey 0), the floor context once per upper shelter storey (1-3) and the ring context once per deep storey (4-5), each on its own fork with its OWN family pool, and tags its spawns with the context; then the damp-section run (the damp context: at most ${BUNKER_DAMP_RUNS_MAX} per level, its own pool with the rare Strainer) is appended; there is no service annex (LEVELS.bunker.trackExtensions 'none'); assignEnemyArchetypes rolls every family ONCE at the end (the Siren's room eligibility included) and applyFamilySpacing keeps the Sirens apart. Moving between storeys never rerolls anything.`},
    contexts: {
      station: {storeys: 'the station storey (level 0: the platform, the arrival hall, the vault vestibule behind the open vault door)', runs: 1},
      floor: {storeys: 'one upper shelter storey (each of levels 1-3: entry & security, habitation, services & medical)', runs: 3},
      ring: {storeys: 'one deep shelter storey (each of levels 4-5: maintenance & water, the central processing core)', runs: 2},
      damp: {storeys: 'the water-damaged areas of the shelter (layout.bunker.damp; nowhere else)', runs: 1,
        zone: {runsPerLevel: [0, BUNKER_DAMP_RUNS_MAX], note: BUNKER_DAMP_ZONE_NOTE, where: 'an area listed in layout.bunker.damp (the pump hall, the filtration plant, the flooded maintenance wing), the storey placement rules of its storey'}},
      service: {storeys: 'none: the bunker grows no service annex (LEVELS.bunker.trackExtensions none)', runs: 1, zone: {runsPerLevel: [0, TRACK_EXT_BUNKER.annex.max], note: SERVICE_ZONE_NOTE}},
    },
  },
  // Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET — a calm settlement: no placement run at all.
  market: {
    generator: {fn: 'generateMarketLevel', file: F.marketIndex,
      note: `ONE continuous level (LevelId 'market'): a calm survivor settlement in a salvaged railway shed where the player's train stops (the platform, six trader stalls, the market square, the housing deck), generated once per level seed. NO enemies: the generator never runs a placement (its one ambient context places [0, 0]), there is no horde pool, no Siren eligibility and no service annex (LEVELS.market.trackExtensions 'none'); its friendly residents are not enemies (never in layout.zombies).`},
    contexts: {
      station: {storeys: 'the whole settlement (platform, stalls, square, housing deck)', runs: 0, hook: 'count [0, 0]: a calm settlement, gen/market never asks for a placement run'},
      service: {storeys: 'none: the market grows no service annex (LEVELS.market.trackExtensions none)', runs: 1, zone: {runsPerLevel: [0, TRACK_EXT_MARKET.annex.max], note: SERVICE_ZONE_NOTE}},
    },
  },
};

export const ENEMY_REPO = {
  url: 'https://github.com/BenjaminBenetti/terminal-state',
  private: true,
  note: 'Source links point to the private game repository: repository access is required to open them.',
};

/** Static explanation of each family's NON-family sub-distributions (keyed by registry id; a new family defaults to none). */
const VARIANTS: Readonly<Partial<Record<EnemyFamilyId, string>>> = {
  zombie: 'Shambler / coated type (the profile\'s zombie type roll) and the wardrobe outfit chosen at spawn time from (level seed, spawn index, type) by ai/wardrobe.ts pickZombieLook — sub-distributions of the zombie family, not separate families.',
  // task studio-screacher-production-20261110-221858-01: the Screacher's four approved bodies — ONE enemy type
  screacher: `${Object.keys(SCREACHER_VARIANTS).length} approved bodies (${Object.entries(SCREACHER_VARIANTS).map(([id, v]) => `${id} "${v.name}"`).join(', ')}): model variants of ONE enemy type with the same AI, stats and sounds — not separate families. The roster pass that places a Screacher gives it its variant (ZombieSpawn.variant), dealt in turn from a seeded start, and a level loads only the bodies its Screachers use.`,
};

/**
 * Task studio-screacher-production-20261110-221858-01: the seeded roster pass, appended to every level's generator note (it runs in the
 * level registry on every level's finished layout, after everything the generator itself does).
 */
const ROSTER_GENERATOR_NOTE = `Last of all the level registry runs the SEEDED ROSTER pass on the finished layout (ai/enemyRoster.ts applyEnemyRoster, roster version ${ROSTER_VERSION}): from the level seed alone it decides which special families this map holds at all, and it only ever changes the family of ordinary ambient zombie slots — never a count, a position, an index, a horde member or an outfit zombie (see the seeded roster).`;
const ROSTER_GENERATOR_NOTE_ZOMBIE_FREE = 'The seeded roster pass (ai/enemyRoster.ts applyEnemyRoster) does nothing here: a zombie-free level never holds any enemy family.';

// ---------------------------------------------------------------------------------------------------------------------------
// Source locations

class Sources {
  private cache = new Map<string, string[] | null>();
  readonly files = new Set<string>();
  constructor(private readonly read?: EnemyReferenceOptions['readSource']) {}
  private lines(file: string): string[] | null {
    if (!this.read) return null;
    if (!this.cache.has(file)) { const t = this.read(file); this.cache.set(file, typeof t === 'string' ? t.split('\n') : null); }
    return this.cache.get(file) ?? null;
  }
  /** `symbol` = Export[.key...]: the declaration line of the export, then each key below it. */
  at(file: string, symbol: string): SourceLoc {
    this.files.add(file);
    const loc: SourceLoc = {file, symbol};
    const lines = this.lines(file);
    if (!lines) return loc;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = symbol.replace(/\[(\d+)\]/g, '').split('.').filter(Boolean);
    const top = new RegExp(`^export (?:const|function|let|interface|type|class) ${esc(parts[0])}\\b`);
    let line = lines.findIndex(l => top.test(l));
    if (line < 0) line = lines.findIndex(l => new RegExp(`^(?:async )?function ${esc(parts[0])}\\b`).test(l));
    if (line < 0) return loc;
    for (const p of parts.slice(1)) {
      const re = new RegExp(`(?:^|[\\s{,(])'?${esc(p)}'?\\s*:`);
      const k = lines.slice(line, line + 200).findIndex(l => re.test(l));
      if (k >= 0) line += k;
    }
    return {...loc, line: line + 1};
  }
}

/** Export name of a spawnTables object (by identity): rules shared by several contexts link to their named constant. */
const EXPORT_NAME = new Map<unknown, string>(Object.entries(ST).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [v, k]));
/**
 * (task studio-skywalk-encounters-20261108-074144-01, lane COSPLAY) rule objects declared OUTSIDE spawnTables (the Skyways convention's
 * zone context lives in its own leaf module, ai/cosplayContext.ts): their export name and the file their source links point into.
 */
const EXPORT_FILE = new Map<unknown, string>();
for (const [k, v] of Object.entries(CC)) if (v && typeof v === 'object' && !EXPORT_NAME.has(v)) { EXPORT_NAME.set(v, k); EXPORT_FILE.set(v, F.cosplayContext); }
/** The file a rule object's source link points into (spawnTables unless declared elsewhere). */
const fileOf = (obj: unknown): string => EXPORT_FILE.get(obj) ?? F.tables;

// ---------------------------------------------------------------------------------------------------------------------------
// Helpers

function fnv(s: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
const mean = (lo: number, hi: number) => (lo + hi) / 2;
const list = (xs: readonly string[]) => xs.join(' / ');

export function matchText(m: AreaMatch): string {
  const parts: string[] = [];
  if (m.kind?.length) parts.push(`kind ${list(m.kind)}`);
  if (m.type?.length) parts.push(`type ${list(m.type)}`);
  if (m.publicSpace) parts.push('public space');
  if (m.storefront) parts.push('storefront unit');
  return parts.join(' or ');
}

/** EXACT expected coated share of one run of n spawns incl. the at-least-one-each fix (spawnTables rollZombieTypes). */
export function expectedCoatedShare(n: number, c: number, atLeastOneEach: boolean): number {
  if (n <= 0) return 0;
  if (!atLeastOneEach) return c;
  if (n === 1) return 1; // a lone shambler becomes coated; the shambler fix needs count > 1
  return (n * c + Math.pow(1 - c, n) - Math.pow(c, n)) / n;
}

function weightsInfo(w: AreaWeights): PlacementInfo['areaWeights'] {
  return {
    rules: w.rules.map(r => ({match: matchText(r.when), weight: r.weight, why: r.why})),
    otherwise: w.otherwise,
    note: `First matching rule wins (${w.otherwiseWhy} otherwise). A relative weight in the weighted area order, multiplied by the room intensity D of its room key (1 when the room has no modifier). Weight 0 = never a candidate.`,
  };
}
function capsInfo(c: AreaCaps): PlacementInfo['caps'] {
  return {
    passes: [...c.passes],
    rules: c.rules.map(r => ({match: matchText(r.when), cap: 'fixed' in r ? `at most ${r.fixed}` : `pass cap + ${r.plus}`, why: r.why})),
    otherwise: 'the pass cap',
    note: `The placement walks the area order once per pass (caps ${c.passes.join(', ')}); an area takes one more spawn per visit while it is below its cap for that pass. Room modifiers never raise a cap.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Census (a small, fixed-seed SAMPLE of the REAL registered generators)

interface CensusArea { key: string; keyKind: 'purpose' | 'room-type'; type: string; kind: string; context: string; cells: number; baseWeight: number; sample: number }
interface CensusLevel {
  seeds: number[];
  areas: CensusArea[];
  /**
   * One entry per placed AMBIENT spawn of every sample level. `family` = with the seeded roster applied (what the level holds);
   * `rolled` = the family the per-spawn roll alone had placed there (before the roster pass); `sample` = its sample level.
   */
  spawns: {family: string; rolled: string; type: string; key: string; kind: string; context: string; sample: number}[];
  /** Task track3-eaton-centre-20261031 (lane PROFILES): horde members (the separate pool; layout.zombies tagged `horde`) and groups. */
  horde: {family: string; type: string; key: string; group: string; storey: number}[];
}

/**
 * The generation context of placed spawn `i`: the generator's own tag (spawnTables markSpawnContext; a single-context profile implies
 * its context). Task track1 (lane SPAWN): an untagged spawn of a multi-context profile fails the build (coverage), never a guess.
 */
function contextOfSpawn(layout: StationLayout, profile: SpawnProfile, i: number): SpawnContextId {
  const c = spawnContextOf(layout, profile, i);
  if (!c) throw new Error(`level ${profile.id}: spawn ${i} carries no generation context (its placement routine must call markSpawnContext)`);
  return c;
}

/**
 * Task studio-screacher-production-20261110-221858-01: THE SEEDED ROSTER PASS on a sample layout the registered generator just
 * returned WITHOUT a roster version (= roster version 0, the plain per-spawn roll outcome): applyEnemyRoster at ROSTER_VERSION with
 * the level's id and seed — exactly the call the level registry makes for `rosterVersion: ROSTER_VERSION` (game/tests/
 * enemy-spawn-reference.test.ts checks the two give the same level). Returns each spawn's family BEFORE the pass and the pass's own
 * report; throws when the pass touched a horde member or its report disagrees with the layout (the reference never shows a number
 * the game's own report contradicts).
 */
export function applySampleRoster(layout: StationLayout, level: LevelId, seed: number): {rolled: EnemyFamilyId[]; report: RosterReport} {
  const fam = (z: {archetype?: string}): EnemyFamilyId => (z.archetype ?? 'zombie') as EnemyFamilyId;
  const rolled = layout.zombies.map(fam);
  const report = applyEnemyRoster(layout, level, seed, ROSTER_VERSION);
  layout.zombies.forEach((z, i) => {
    if ((z.horde !== undefined || z.look !== undefined) && fam(z) !== rolled[i]) throw new Error(`level ${level} seed ${seed}: the roster pass changed spawn ${i}, a horde member / outfit zombie`);
  });
  for (const [f, r] of Object.entries(report.families)) {
    const before = layout.zombies.filter((z, i) => z.horde === undefined && rolled[i] === f).length;
    const after = layout.zombies.filter(z => z.horde === undefined && fam(z) === f).length;
    if (r.before !== before || r.after !== after) throw new Error(`level ${level} seed ${seed}: roster report of ${f} (${r.before} -> ${r.after}) != the layout (${before} -> ${after})`);
    if (!r.present && after !== 0) throw new Error(`level ${level} seed ${seed}: ${f} is absent from the roster but the level holds ${after}`);
  }
  return {rolled, report};
}

const censusCache = new Map<string, CensusLevel>();

/**
 * One level's census over `seeds` (the shipped start weapon, the registered generator, then the seeded roster pass: what a level
 * holds). Cached per process.
 */
export function enemyCensus(level: LevelId, seeds: readonly number[]): CensusLevel {
  const key = `${level}:${seeds.join(',')}`;
  const hit = censusCache.get(key);
  if (hit) return hit;
  const def = LEVELS[level];
  const profile = spawnProfile(level);
  const startWeapon = startWeaponFor(false);
  const out: CensusLevel = {seeds: [...seeds], areas: [], spawns: [], horde: []};
  seeds.forEach((seed, sample) => {
    for (const section of def.sections(seed)) {
      const reports: SpawnCandidateReport[] = [];
      let layout: StationLayout;
      setSpawnCensusHook(r => reports.push(r));
      try {
        layout = def.generate(section, {levelSeed: seed, startWeapon});
      } finally {
        setSpawnCensusHook(null);
      }
      const cells = new Map<number, {cells: number; context: string}>();
      for (const r of reports) {
        if (r.layout !== layout) continue; // a rejected attempt
        for (const [id, n] of r.cells) {
          const prev = cells.get(id);
          cells.set(id, {cells: (prev?.cells ?? 0) + n, context: r.context === 'levelMoves' ? 'station' : r.context});
        }
      }
      for (const [id, c] of [...cells].sort((a, b) => a[0] - b[0])) {
        const a = layout.areas[id];
        const ctx = spawnContext(profile, c.context as SpawnContextId);
        const rules = a.level && profile.levelMoves && c.context === 'station' ? profile.levelMoves.areaWeights : ctx.placement.areaWeights;
        out.areas.push({key: roomKey(a), keyKind: a.purpose !== undefined ? 'purpose' : 'room-type', type: a.type, kind: a.kind, context: c.context, cells: c.cells, baseWeight: baseAreaWeight(rules, a), sample});
      }
      // (task studio-screacher-production-20261110-221858-01) the seeded roster pass on the finished layout: the census reports what the level holds
      const {rolled} = applySampleRoster(layout, level, seed);
      layout.zombies.forEach((z, i) => {
        const a: Area | undefined = layout.areas[z.area];
        if (z.horde !== undefined) { out.horde.push({family: z.archetype ?? 'zombie', type: z.type, key: a ? roomKey(a) : '?', group: `${sample}:${z.horde}`, storey: z.level ?? 0}); return; }
        out.spawns.push({family: z.archetype ?? 'zombie', rolled: rolled[i], type: z.type, key: a ? roomKey(a) : '?', kind: a?.kind ?? '?', context: contextOfSpawn(layout, profile, i), sample});
      });
    }
  });
  censusCache.set(key, out);
  return out;
}

const per100 = (placed: number, m2: number): number | null => (m2 > 0 ? rd(placed / m2 * 100) : null);

function levelCensus(c: CensusLevel, families: readonly string[]): LevelCensus {
  const cellM2 = CELL * CELL;
  const layouts = c.seeds.length;
  const eligibleCells = c.areas.reduce((s, a) => s + a.cells, 0);
  const eligibleM2 = rd(eligibleCells * cellM2);
  const byFamily = (f: string) => c.spawns.filter(s => s.family === f).length;
  const ctxIds = [...new Set(c.areas.map(a => a.context).concat(c.spawns.map(s => s.context)))];
  const kinds = [...new Set(c.areas.map(a => a.kind))].sort();
  const zombieTypes: Record<string, number> = {};
  for (const s of c.spawns) if (s.family === 'zombie') zombieTypes[s.type] = (zombieTypes[s.type] ?? 0) + 1;
  return {
    seeds: c.seeds, startWeapon: startWeaponFor(false), layouts, cellM2, eligibleCells, eligibleM2,
    placed: families.map(f => ({family: f, total: byFamily(f), perLevel: rd(byFamily(f) / Math.max(1, layouts)), per100m2: per100(byFamily(f), eligibleCells * cellM2) ?? 0,
      levels: new Set(c.spawns.filter(s => s.family === f).map(s => s.sample)).size, rollTotal: c.spawns.filter(s => s.rolled === f).length})),
    byContext: ctxIds.map(id => {
      const m2 = c.areas.filter(a => a.context === id).reduce((s, a) => s + a.cells, 0) * cellM2;
      const n = c.spawns.filter(s => s.context === id).length;
      const byFam: Record<string, number> = {};
      for (const f of families) byFam[f] = c.spawns.filter(s => s.context === id && s.family === f).length;
      return {context: id, eligibleM2: rd(m2), placed: n, perLevel: rd(n / Math.max(1, layouts)), per100m2: per100(n, m2), byFamily: byFam};
    }),
    byAreaKind: kinds.map(kind => {
      const m2 = c.areas.filter(a => a.kind === kind).reduce((s, a) => s + a.cells, 0) * cellM2;
      const placed: Record<string, number> = {};
      for (const f of families) placed[f] = c.spawns.filter(s => s.kind === kind && s.family === f).length;
      return {kind, eligibleM2: rd(m2), placed, per100m2: per100(Object.values(placed).reduce((s, n) => s + n, 0), m2)};
    }),
    zombieTypes,
    horde: c.horde.length ? {
      members: c.horde.length, perLevel: rd(c.horde.length / Math.max(1, layouts)), groups: new Set(c.horde.map(h => h.group)).size,
      groupsPerLevel: rd(new Set(c.horde.map(h => h.group)).size / Math.max(1, layouts)),
      groupSizes: (() => { const m = new Map<string, number>(); for (const h of c.horde) m.set(h.group, (m.get(h.group) ?? 0) + 1); const v = [...m.values()]; return [Math.min(...v), Math.max(...v)] as const; })(),
      byFamily: Object.fromEntries(families.map(f => [f, c.horde.filter(h => h.family === f).length])),
      byStorey: (() => { const m: Record<string, number> = {}; for (const h of c.horde) m[h.storey] = (m[h.storey] ?? 0) + 1; return m; })(),
      note: 'Horde members are the SEPARATE horde pool (profile.horde): not part of the ambient counts, contexts, eligible floor or room rows above.',
    } : null,
    note: `SAMPLED: ${layouts} sample levels of the registered generator (seeds ${c.seeds.join(', ')}, shipped start weapon) WITH THE SEEDED ROSTER APPLIED (roster version ${ROSTER_VERSION}: what a level holds; the roster only changes families, so counts, positions and eligible floor are the generator's). Eligible floor = cells the generator's own candidate filter accepted (walking distance, clearance, storey, stair / landing keep-off, weight > 0) x ${cellM2} m² — never bounding boxes. Not exhaustive; not a runtime rule.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Task track1 (lane SPAWN): family eligibility — plain criteria + a sampled census of draws vs placed

/** The criteria of an eligibility rule in check order (every number read from the rule). */
export function eligibilityCriteria(rule: FamilyEligibility, P: SpawnProfile, family?: EnemyFamilyId): string[] {
  const ctx = rule.contexts.map(c => `${P.contexts[c]?.label ?? c} (${c})`).join(' / ');
  const out = [`the spawn's generation context is ${ctx}; draws in any other context fall back`];
  if (rule.kinds?.length) out.push(`area kind ${list(rule.kinds)}`);
  if (rule.excludeRooms?.length) out.push(`never in (room type or purpose): ${rule.excludeRooms.join(', ')}`);
  if (rule.minSideCells !== undefined) out.push(`the area's shorter side ≥ ${rule.minSideCells} cells (${rd(rule.minSideCells * CELL)} m)`);
  if (rule.minAreaCells !== undefined) out.push(`the area ≥ ${rule.minAreaCells} cells (${rd(rule.minAreaCells * CELL * CELL)} m²)`);
  if (rule.clearCells !== undefined) {
    const side = rd((2 * rule.clearCells + 1) * CELL);
    out.push(`a clear ${side} × ${side} m patch: every cell within ${rule.clearCells} cell(s) is walkable floor of the same area`);
  }
  if (rule.doorKeepM !== undefined) out.push(`≥ ${rule.doorKeepM} m from the centre of every doorway of its area`);
  if (rule.passageRadiusM !== undefined) out.push(`fair passage: a ${rule.passageRadiusM} m disc around the spawn, treated as blocked, never splits the storey's walkable floor (pockets of ≤ ${PASSAGE_NOOK_CELLS} cells ignored)`);
  if (rule.maxPerLevel !== undefined) out.push(`at most ${rule.maxPerLevel} per generated level (all contexts; later draws in spawn order fall back)`);
  // lane INTEG (task track3-eaton-centre-20261031): the profile's whole-level spacing (ai/familySpacing.ts, jointly with the cap)
  const sp = family !== undefined ? P.spacing?.[family] : undefined;
  if (sp) out.push(`≥ ${sp.spacingM} m (straight 3D line) from every earlier placed one of the level, in spawn order (applied with the cap: the cap counts only placed ones)`);
  return out;
}

interface SamplePass { eligibility: EligibilityCensus; roster: RosterCensus }
const sampleCache = new Map<string, SamplePass>();

/**
 * ONE sample pass over `seeds` of a level's registered generator, serving two censuses of the SAME generated levels (cached per process):
 *  - stage 1, the plain generator output (the per-spawn roll, the eligibility rules, cap and spacing — BEFORE the roster pass): the
 *    ELIGIBILITY census (draws vs placed of every restricted family);
 *  - stage 2 (task studio-screacher-production-20261110-221858-01), the seeded roster pass on that layout (applySampleRoster): the
 *    ROSTER census (which sample levels hold each family, what the pass removed / added, what a level holds afterwards).
 */
function samplePass(level: LevelId, seeds: readonly number[]): SamplePass {
  const key = `${level}:${seeds.join(',')}`;
  const hit = sampleCache.get(key);
  if (hit) return hit;
  const def = LEVELS[level], P = spawnProfile(level), startWeapon = startWeaponFor(false);
  const rules = Object.entries(P.eligibility ?? {}) as [EnemyFamilyId, FamilyEligibility][];
  const placedBy = new Map<string, number>();
  let total = 0, layouts = 0;
  const R = rules.map(([family]) => ({family, draws: 0, placed: 0, per: [] as number[], fallbacks: new Map<string, number>(), byContext: new Map<string, number>()}));
  // the roster census: per family, per layout
  const T = ENEMY_FAMILY_IDS.map(family => ({family, eligible: 0, present: 0, before: 0, after: 0, removed: 0, added: 0, noSlot: 0, per: [] as number[]}));
  for (const seed of seeds) for (const section of def.sections(seed)) {
    const l = def.generate(section, {levelSeed: seed, startWeapon});
    layouts++;
    const perLayout = R.map(() => 0);
    const keptAt = R.map(() => [] as {x: number; y: number; z: number}[]); // lane INTEG: placed positions (cap vs spacing fallbacks)
    l.zombies.forEach((z, i) => {
      // lane INTEG (task track3-eaton-centre-20261031): horde members are the separate horde pool (no ambient roll / rule reaches
      // them) — the eligibility census counts the AMBIENT spawns only; hordes are reported in the horde section / census.horde.
      if (z.horde !== undefined) return;
      const fam = z.archetype ?? 'zombie';
      total++;
      placedBy.set(fam, (placedBy.get(fam) ?? 0) + 1);
      const drawn = pickEnemyArchetype(l.seed, i, roomFamilyPool(P, l.areas[z.area]));
      rules.forEach(([f, rule], k) => {
        const r = R[k], ctx = contextOfSpawn(l, P, i);
        const y = z.y ?? 0;
        if (fam === f) { r.placed++; perLayout[k]++; r.byContext.set(ctx, (r.byContext.get(ctx) ?? 0) + 1); keptAt[k].push({x: z.x, y, z: z.z}); }
        if (drawn !== f) return;
        r.draws++;
        if (fam !== f) {
          const sp = P.spacing?.[f];
          const spaced = sp !== undefined && (rule.maxPerLevel === undefined || keptAt[k].length < rule.maxPerLevel)
            && keptAt[k].some(q => Math.hypot(q.x - z.x, q.y - y, q.z - z.z) < sp.spacingM);
          const why = eligibilityFailure(rule, l, z, ctx) ?? (spaced ? 'spacing' : 'cap');
          r.fallbacks.set(why, (r.fallbacks.get(why) ?? 0) + 1);
        }
      });
    });
    perLayout.forEach((n, k) => R[k].per.push(n));
    // stage 2: the seeded roster pass on this very layout
    const {rolled, report} = applySampleRoster(l, level, seed);
    for (const t of T) {
      const rep = report.families[t.family];
      let after = 0;
      l.zombies.forEach((z, i) => {
        if (z.horde !== undefined) return;
        const was = rolled[i] === t.family, is = (z.archetype ?? 'zombie') === t.family;
        if (was) t.before++;
        if (is) { t.after++; after++; }
        if (was && !is) t.removed++;
        if (!was && is) t.added++;
      });
      t.per.push(after);
      // the baseline family is never rolled: every level that can hold enemies holds it
      if (rep ? rep.eligible : !report.zombieFree) t.eligible++;
      if (rep ? rep.present : !report.zombieFree) t.present++;
      if (rep?.noSlot) t.noSlot++;
    }
  }
  const out: SamplePass = {
    eligibility: {
      seeds: [...seeds], layouts,
      note: `SAMPLED: ${layouts} generated levels of LEVELS.${level}.generate (seeds ${seeds[0]}..${seeds[seeds.length - 1]}, ${seeds.length} seeds, shipped start weapon), measured BEFORE the seeded roster pass: the per-spawn roll and the eligibility rule alone. A draw is a spawn whose roll lands on the family; it is placed only where the eligibility rule holds, otherwise it becomes the fallback family. Ambient spawns only (horde members are the separate horde pool). The roster pass then decides per level whether the family is there at all — the seeded roster census of the same levels shows what a level holds. Not exhaustive; not a runtime rule.`,
      placed: ENEMY_FAMILY_IDS.map(f => ({family: f, total: placedBy.get(f) ?? 0, perLevel: rd((placedBy.get(f) ?? 0) / Math.max(1, layouts)), share: rd((placedBy.get(f) ?? 0) / Math.max(1, total))})),
      restricted: R.map(r => {
        const max = r.per.length ? Math.max(...r.per) : 0;
        return {
          family: r.family, draws: r.draws, placed: r.placed,
          perLevel: {mean: rd(r.placed / Math.max(1, layouts)), none: r.per.filter(n => n === 0).length, max,
            histogram: Array.from({length: max + 1}, (_, n) => ({count: n, layouts: r.per.filter(v => v === n).length}))},
          fallbacks: [...r.fallbacks].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([reason, draws]) => ({reason, draws})),
          byContext: [...r.byContext].sort((a, b) => a[0].localeCompare(b[0])).map(([context, placed]) => ({context, placed})),
        };
      }),
    },
    roster: {
      seeds: [...seeds], layouts, ambient: total, ambientPerLevel: rd(total / Math.max(1, layouts)),
      note: `SAMPLED: the same ${layouts} generated levels of LEVELS.${level}.generate (seeds ${seeds[0]}..${seeds[seeds.length - 1]}, ${seeds.length} seeds, shipped start weapon), each followed by the seeded roster pass at roster version ${ROSTER_VERSION} — what a level holds. "Before" = what the per-spawn roll alone had placed; "after" = with the pass applied. The pass never changes the ${rd(total / Math.max(1, layouts))} ambient spawns per level of this sample, only their families. A SMALL sample: the long-run share of levels that hold a family is its roster rate, not this count. The roll depends on the level seed and the family only, so these seeds roll the same families present on every level. Ambient spawns only (horde members are the separate horde pool). Not exhaustive.`,
      families: T.map(t => {
        const holding = t.per.filter(n => n > 0).length, max = t.per.length ? Math.max(...t.per) : 0;
        return {
          family: t.family, eligible: t.eligible, present: t.present, holding, before: t.before, after: t.after, removed: t.removed, added: t.added,
          perLevel: rd(t.after / Math.max(1, layouts)), perHoldingLevel: holding ? rd(t.after / holding) : null, max, share: rd(t.after / Math.max(1, total)), noSlot: t.noSlot,
          histogram: Array.from({length: max + 1}, (_, n) => ({count: n, layouts: t.per.filter(v => v === n).length})),
        };
      }),
    },
  };
  sampleCache.set(key, out);
  return out;
}

/** Draws vs placed of every restricted family of a level over `seeds` (the registered generator, before the roster pass). Cached per process. */
export function eligibilityCensus(level: LevelId, seeds: readonly number[]): EligibilityCensus {
  return samplePass(level, seeds).eligibility;
}

/** Task studio-screacher-production-20261110-221858-01: the seeded roster pass on the same sample levels (what a level holds). Cached per process. */
export function rosterCensus(level: LevelId, seeds: readonly number[]): RosterCensus {
  return samplePass(level, seeds).roster;
}

function statsVariant(v: {variant: string | null; stats: ZombieStats}, at: SourceLoc): FamilyStatsVariant {
  const s = v.stats;
  return {variant: v.variant, hp: s.hp, wanderSpeed: s.wanderSpeed, chaseSpeed: s.chaseSpeed, attackRange: s.attackRange, attackDamage: s.attackDamage,
    attackDuration: s.attackDuration, attackImpact: s.attackImpact, attackCooldown: s.attackCooldown ?? null, sightRange: s.sightRange, radius: s.radius, at};
}

// ---------------------------------------------------------------------------------------------------------------------------
// Task studio-screacher-production-20261110-221858-01: THE SEEDED ROSTER (ai/enemyRoster.ts FAMILY_ROSTER / applyEnemyRoster)

type SeededRule = Extract<RosterRule, {mode: 'seeded'}>;
/** Every field of a roster rule the reference carries: a field it does not know fails the build instead of being silently dropped. */
const ROSTER_RULE_FIELDS: readonly string[] = ['mode', 'why', 'since', 'key', 'rate', 'levelRates', 'place', 'contexts', 'counts', 'slots', 'spacingM', 'variants'];
const ROSTER_SLOT_FIELDS: readonly string[] = ['contexts', 'excludeKinds', 'excludeRooms', 'minSideCells', 'minAreaCells'];
/** A share as a percentage ("40 %"). */
const pc = (x: number): string => `${rd(x * 100)} %`;

/**
 * How a PRESENT family is placed, in plain language; every number is read from the rule. The switch is exhaustive over the source's
 * placement policies (the `never` default): a new policy fails to typecheck until it is described here. The ORDER the present
 * families are placed in is the source's own ROSTER_PLACE_PRIORITY (ai/enemyRoster.ts), never a copy.
 */
function rosterPlacementText(rule: SeededRule): string {
  switch (rule.place) {
    case 'share-topup':
      return 'Share top-up ("option B"), at least one. What the per-spawn roll placed stays; then every remaining ordinary ambient zombie slot whose pool gives the family weight converts with chance share × (1 / rate − 1) × (ambient slots whose pool gives it weight / the ordinary zombie slots among them). A level that holds the family so has about (the per-spawn roll\'s number) / rate of it, and over many levels the family total stays about what the per-spawn roll alone placed — concentrated on fewer levels. At rate 1 nothing is topped up. PRESENT MEANS AT LEAST ONE: if the per-spawn roll and the top-ups together left none, one ordinary ambient zombie slot whose pool gives the family weight becomes it (picked by weight: a slot with a larger share is more likely), also at rate 1. Only a level with no such slot at all holds none (the pass reports "no slot").';
    case 'eligible-min-one':
      return 'At least one where a room qualifies. Her per-spawn draw weight, room eligibility, per-level cap and spacing decide as before. Only if that left none: an ordinary ambient zombie standing where she is eligible becomes her — else a member of a share-top-up family standing there, which is exchanged to an ordinary zombie slot elsewhere. A level in which no such enemy stands in a room she is eligible in holds none (the pass reports "no slot").';
    case 'context-one':
      return `Exactly one, in its contexts (${rule.contexts.join(', ')}). Only a map that has an ambient spawn in one of them is rolled. Present: one the per-spawn roll placed there is kept and any others become ordinary zombies; with none, an ordinary ambient zombie slot there converts — else the slot of a share-top-up family's member there, which is exchanged to an ordinary zombie slot elsewhere. A level whose roll includes the family always holds exactly one.`;
    case 'count': {
      const S = rule.slots, total = rule.counts.reduce((t, [, w]) => t + Math.max(0, w), 0);
      const counts = rule.counts.map(([n, w]) => `${n} in ${pc(total > 0 ? Math.max(0, w) / total : 0)}`).join(', ');
      return `Counted: placed by the roster alone (no per-spawn roll can draw it). One count per level map — ${counts} of the levels that hold it — and that many ordinary ambient zombie slots of the contexts ${S.contexts.join(', ')} become the family: only in an area at least ${S.minSideCells} cells (${rd(S.minSideCells * CELL)} m) on its shorter side and ${S.minAreaCells} cells (${rd(S.minAreaCells * CELL * CELL)} m²) large, never area kind ${S.excludeKinds.join(' / ') || '(none)'} and never a room of type / purpose ${S.excludeRooms.join(', ') || '(none)'}; never a horde member, an outfit zombie or a spawn of another context. Slots are taken in a seeded order, each at least ${rule.spacingM} m (straight 3D line) from the ones already taken: where the level cannot space them out the level holds as many as fit, at least one. A level with no such slot at all relaxes the rule to any ordinary ambient zombie of those contexts, then to any ordinary ambient zombie.${rule.variants.length ? ` Each one takes a model variant (${rule.variants.join(', ')}), dealt in turn from a seeded start.` : ''}`;
    }
    default: {
      const unknown: never = rule;
      throw new Error(`unknown roster placement ${JSON.stringify(unknown)}`);
    }
  }
}

/** True when a pool of the profile — the level's or a context's own — gives the family weight (ai/enemyRoster.ts inSomePool). */
function hasPoolWeight(P: SpawnProfile, family: EnemyFamilyId): boolean {
  return P.families.some(([f, w]) => f === family && w > 0) || Object.values(P.contexts).some(c => c?.families?.some(([f, w]) => f === family && w > 0));
}

/** One family's roster rule as the reference shows it (every field of FAMILY_ROSTER[id]). */
function rosterFamilyInfo(id: EnemyFamilyId, src: Sources): RosterFamilyInfo {
  const rule = FAMILY_ROSTER[id];
  for (const k of Object.keys(rule)) if (!ROSTER_RULE_FIELDS.includes(k)) throw new Error(`FAMILY_ROSTER.${id}: field '${k}' is not shown by the reference (add it to RosterFamilyInfo, tools/pages/enemyReferenceTypes.ts)`);
  const rosterOnly = ROSTER_ONLY_FAMILIES.includes(id);
  const at = src.at(F.roster, `FAMILY_ROSTER.${id}`);
  if (rule.mode === 'baseline') {
    if (rosterOnly) throw new Error(`family ${id}: roster-only (weight 0 in every pool) but its roster rule is the baseline — nothing could ever place it`);
    return {family: id, mode: 'baseline', since: null, key: null, rate: null, levelRates: [], place: null,
      placement: 'Baseline: always present and never rolled. Every other family only ever takes ordinary ambient zombie slots, so the ordinary zombie is whatever the others leave.',
      contexts: null, counts: null, countMean: null, slots: null, spacingM: null, variants: null, rosterOnly, why: rule.why, at};
  }
  if (rosterOnly && rule.place !== 'count') throw new Error(`family ${id}: roster-only (weight 0 in every pool) needs a 'count' roster rule — policy '${rule.place}' builds on a per-spawn roll that can never draw it`);
  let counts: RosterFamilyInfo['counts'] = null, countMean: number | null = null, slots: RosterFamilyInfo['slots'] = null;
  if (rule.place === 'count') {
    for (const k of Object.keys(rule.slots)) if (!ROSTER_SLOT_FIELDS.includes(k)) throw new Error(`FAMILY_ROSTER.${id}.slots: field '${k}' is not shown by the reference`);
    const total = rule.counts.reduce((t, [, w]) => t + Math.max(0, w), 0);
    counts = rule.counts.map(([count, weight]) => ({count, weight, share: total > 0 ? rd(Math.max(0, weight) / total) : 0}));
    countMean = total > 0 ? rd(rule.counts.reduce((t, [n, w]) => t + n * Math.max(0, w), 0) / total) : 0;
    const S = rule.slots;
    slots = {contexts: [...S.contexts], excludeKinds: [...S.excludeKinds], excludeRooms: [...S.excludeRooms], minSideCells: S.minSideCells, minSideM: rd(S.minSideCells * CELL),
      minAreaCells: S.minAreaCells, minAreaM2: rd(S.minAreaCells * CELL * CELL)};
    // every variant the roster deals must be a body the archetype registry can load
    const models = ENEMY_ARCHETYPES[id].variantModels ?? {};
    for (const v of rule.variants) if (!(v in models)) throw new Error(`FAMILY_ROSTER.${id}: variant '${v}' has no model in ENEMY_ARCHETYPES.${id}.variantModels`);
  }
  return {
    family: id, mode: 'seeded', since: rule.since, key: rule.key, rate: rule.rate,
    levelRates: Object.entries(rule.levelRates ?? {}).map(([level, rate]) => ({level, rate: rate as number})),
    place: rule.place, placement: rosterPlacementText(rule),
    contexts: rule.place === 'context-one' ? [...rule.contexts] : null,
    counts, countMean, slots,
    spacingM: rule.place === 'count' ? rule.spacingM : null,
    variants: rule.place === 'count' ? [...rule.variants] : null,
    rosterOnly, why: rule.why, at,
  };
}

const rollCheckCache = new Map<string, number>();
/** How many of the level seeds 1..ROSTER_ROLL_CHECK_SEEDS roll the family present on the level (familyInRoster: a pure hash). */
function rollCheck(family: EnemyFamilyId, level: LevelId): number {
  const key = `${family}:${level}`;
  let n = rollCheckCache.get(key);
  if (n === undefined) {
    n = 0;
    for (let seed = 1; seed <= ROSTER_ROLL_CHECK_SEEDS; seed++) if (familyInRoster(family, level, seed, ROSTER_VERSION)) n++;
    rollCheckCache.set(key, n);
  }
  return n;
}

/**
 * One level's roster rows (every registered family, registry order). `runs(c)` = the level's generator can run context c at all (the
 * adapter's runs / zone ceiling and the profile's count). Mirrors applyEnemyRoster's `eligible` (phase 1); buildEnemyReference checks
 * it against the pass's own reports of every sampled level.
 */
function levelRosterRows(level: LevelId, name: string, P: SpawnProfile, runs: (c: SpawnContextId) => boolean): LevelRosterRow[] {
  return ENEMY_FAMILY_IDS.map((family): LevelRosterRow => {
    const rule = FAMILY_ROSTER[family];
    if (ZOMBIE_FREE_LEVELS.includes(level)) {
      return {family, eligibility: 'zombie-free', rate: 0, rolled: null, status: `Never: ${name} is a zombie-free level — it holds no enemy of any family, and the roster pass does nothing there.`};
    }
    if (rule.mode === 'baseline') return {family, eligibility: 'baseline', rate: 0, rolled: null, status: 'Always: the baseline family, never rolled. The other families only ever take ordinary ambient zombie slots.'};
    const rate = rosterRate(family, level);
    const never = (why: string): LevelRosterRow => ({family, eligibility: 'never', rate: 0, rolled: null, status: `Never rolled: ${why}.`});
    const rolled = (): LevelRosterRow['rolled'] => ({seeds: ROSTER_ROLL_CHECK_SEEDS, present: rollCheck(family, level)});
    switch (rule.place) {
      case 'count':
        return {family, eligibility: 'every-map', rate, rolled: rolled(), status: `The roll includes it in ${pc(rate)} of this level's map seeds: such a map holds its count. Every other map holds none.`};
      case 'share-topup':
        if (!hasPoolWeight(P, family)) return never('no pool of this level gives the family weight');
        return {family, eligibility: 'every-map', rate, rolled: rolled(),
          status: rate >= 1 ? 'The roll includes it on every map of this level (rate 100 %): what the per-spawn roll placed stays and nothing is topped up; a map on which that roll placed none still gets one.'
            : `The roll includes it in ${pc(rate)} of this level's map seeds: there the per-spawn roll's placements stay and are topped up, and such a map holds at least one. Every other map holds none.`};
      case 'eligible-min-one':
        if (P.eligibility?.[family] === undefined || !hasPoolWeight(P, family)) return never('this level\'s profile gives the family no weight and no eligibility rule (it is opt-in per level)');
        return {family, eligibility: 'every-map', rate, rolled: rolled(), status: `The roll includes her in ${pc(rate)} of this level's map seeds: such a map holds at least one when an enemy stands in a room where she is eligible (else none: "no slot"). Every other map holds none.`};
      case 'context-one': {
        const here = rule.contexts.filter(c => P.contexts[c] !== undefined && runs(c));
        if (!here.length) return never(`none of its contexts (${rule.contexts.join(', ')}) ever runs in this level`);
        return {family, eligibility: 'layout', rate, rolled: rolled(),
          status: `The roll includes it in ${pc(rate)} of the map seeds whose map has an ambient spawn in its context here (${here.join(', ')}): such a map holds exactly one, there. A map without such a spawn is never rolled, and every other map holds none.`};
      }
      default: {
        const unknown: never = rule;
        throw new Error(`unknown roster placement ${JSON.stringify(unknown)}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Static vocabulary / semantics (prose; every number elsewhere is read from the profiles)

const VOCABULARY: readonly VocabEntry[] = [
  {term: 'count range', unit: 'spawns per run of a context', definition: 'The generator draws ONE uniform integer U{lo..hi} per run of a generation context (inclusive): the number of spawns that run tries to place. There is no per-area spawn density at runtime.'},
  {term: 'E[count]', unit: 'spawns per run', definition: 'Exact expectation of the count draw, (lo + hi) / 2. Per level: Σ runs × E[count] over the contexts.'},
  {term: 'area weight', unit: 'relative (no unit)', definition: 'Relative preference of an area in the weighted area order (Efraimidis–Spirakis keys u^(1/w)): areas with more weight tend to be visited earlier in each cap pass. Never a chance and never a count.'},
  {term: 'cap', unit: 'spawns per area', definition: 'Most spawns an area may hold after each pass (passes 1, 2, 3); platforms hold one more, closets / closed exits / storefront units at most one.'},
  {term: 'family weight', unit: 'relative (no unit)', definition: 'Weight of an enemy family in the level pool; only meaningful against the denominator Σ weights.'},
  {term: 'share', unit: 'conditional chance per placed spawn', definition: 'weight / denominator: the chance that the roll of ONE placed spawn draws that family (an independent per-spawn roll keyed on level seed + spawn index that REPLACES a zombie). For a family without an eligibility rule that is the share the per-spawn roll places; a restricted family places fewer (see eligibility). The seeded roster then decides per level whether the family is there at all (see seeded roster). Not a chance per area or per m².'},
  {term: 'eligibility', unit: 'rule per family and level', definition: 'Where a restricted family may take a placed slot (contexts, rooms, clearance, doorways, fair passage, a per-level cap). A draw that fails it becomes the fallback family (a zombie): the other families\' draws never change, and the restricted family\'s placed count is measured by the sampled eligibility census.'},
  {term: 'tier', unit: 'integer >= 0 per level', definition: 'The level\'s explicit difficulty tier (Subway 0 = the starting level). Metadata only: nothing scales counts, damage or loot by it, and no family is enabled by it.'},
  {term: 'family stats', unit: 'hp, m/s, m, s', definition: 'Health (hp), wander / chase speed (m/s), attack range (m, centre to centre) and damage per hit (hp), swing length / impact / recovery (s), sight range and body radius (m), read from each family\'s exported constants.'},
  {term: 'placed', unit: 'spawns', definition: 'What the generator actually placed: below the count when the eligible, spaced cells run out (Subway attempts with fewer than the accepted minimum, and Office runs outside their count range, are regenerated).'},
  {term: 'sampled density', unit: 'placed per 100 m² of eligible floor (sampled)', definition: 'Placed spawns divided by the eligible floor area of a small labelled seed corpus. Eligible = cells the generator\'s own candidate filter accepted (0.25 m² each), never map bounding boxes. A census, not a runtime rule.'},
  {term: 'density (room modifier)', unit: 'multiplier (1 = neutral)', definition: 'Local intensity of a family in a room: scales the room\'s area weight by the room intensity D and the family\'s part of the room mix. Never changes the count roll or a cap.'},
  {term: 'weight (room modifier)', unit: 'multiplier (1 = neutral)', definition: 'Conditional composition in a room: scales a family\'s pool weight for spawns that land in that room. Changes which family a spawn there becomes, never how many spawns the room attracts.'},
  // task track3-eaton-centre-20261031 (lane PROFILES / INTEG): the mall's family spacing, horde pool and budgets
  {term: 'family spacing', unit: 'metres (straight 3D line)', definition: 'A whole-level minimum distance between placed spawns of a family that has an eligibility rule (lane INTEG, ai/familySpacing.ts): in spawn order an eligible draw is placed only while fewer than the rule\'s cap are placed and it is at least that far from every placed one; otherwise it becomes the fallback family. Never touches horde members.'},
  {term: 'horde pool', unit: 'groups per level × members per group', definition: 'The roaming hordes: a SEPARATE pool with its own explicit families, group count and group size ranges and budgets (members in the level, members and groups starting on one storey). Placed once at generation, after the ambient family roll; its members carry their own context tag (horde), never an ambient one; no respawn or top-up; never counted in the ambient contexts.'},
  {term: 'ambient budget', unit: 'ambient spawns per level / per storey run', definition: 'Explicit caps of the ambient pool (the contexts): the whole-level total and one storey run. The horde pool has its own budget.'},
  // task studio-screacher-production-20261110-221858-01: the seeded per-level family roster
  {term: 'seeded roster', unit: 'chance per level map seed, per family', definition: 'Which special enemy families a generated level holds AT ALL. One independent roll per family per level map, a hash of the level seed (no random stream is consumed; the same seed always gives the same roster), applied once to the finished level after the per-spawn family roll. A family rolled absent has exactly none in that level: what the per-spawn roll placed becomes ordinary zombies. A family rolled present is placed by its policy (a share top-up, at least one, exactly one, or a count). Only ordinary ambient zombie slots ever change family: the enemy count, positions and indices never change, and horde members and outfit zombies are never touched. The ordinary zombie is the baseline and is never rolled; a zombie-free level gets no family.'},
  {term: 'roster-only family', unit: 'weight 0 in every pool', definition: 'A family no per-spawn roll can draw: its weight is 0 in every level, context and horde pool (validation rejects anything else), so its conditional share is 0 everywhere. It is placed only by the seeded roster: a level whose roll includes it gets its count in place of ordinary zombies, and every other level has exactly none.'},
  {term: 'before / after the roster pass', unit: 'two stages of one sampled level', definition: 'Sampled figures name their stage. "Before the roster pass" = the per-spawn roll, eligibility, cap and spacing alone (the generator\'s own output). "After" / "with the roster" = the same level with the seeded roster applied: what a level holds. Counts and positions are identical in both; only families differ.'},
];

function semantics(src: Sources): ModifierSemantics {
  return {
    key: 'Room key = the area\'s purpose id (gen/purposes.ts) when it has one, else its room type. Each field resolves: purpose entry → room-type entry → 1 (missing = neutral).',
    neutral: 1,
    fields: [
      {field: 'density', changes: 'local intensity',
        formula: 'area weight × D, D = all.density × Σ_f p_f·w_f·d_f / Σ_f p_f·w_f (p = pool weight, w = weight modifier, d = density modifier); the room\'s family mix uses p_f·w_f·d_f',
        zero: 'D = 0: the room is never a candidate (no spawns there); the count roll and the other rooms are unchanged, so its spawns go elsewhere when capacity allows.',
        two: 'The room is visited earlier in every cap pass, so it tends to fill its caps before the count runs out: more spawns there, fewer elsewhere, the same total.'},
      {field: 'weight', changes: 'conditional composition',
        formula: 'P(family f | spawn lands in the room) = p_f·w_f·d_f / Σ_g p_g·w_g·d_g',
        zero: 'That family never spawns in that room (its spawns there become the other families).',
        two: 'Twice its relative odds in that room before normalisation; the room still attracts the same number of spawns.'},
    ],
    allFamilies: `Family key '${ALL_FAMILIES}' carries a density for every family of the room (room-wide intensity; a family's own density multiplies with it). It has no weight.`,
    caps: 'Modifiers never change the count roll (the level / context total) or raise a cap: caps, spacing, tries and eligibility still bound every room, so a modifier can move spawns between rooms but cannot add any.',
    neutralParity: 'A room without an entry takes the shipped code path untouched (the same area weight number, the same pool array); an explicit entry of 1 is bit-identical too (x·1 === x, Σ/Σ === 1), so the RNG draws and every seeded spawn are unchanged.',
    notes: [
      'Weight modifiers never touch an RNG stream (the family roll is a hash of level seed + spawn index).',
      'A density modifier changes placement draws; on the Subway the storey moves of loose floor supplies follow on the same stream as the storey moves of enemies, so those moved supplies may land on other cells (same items, counts and pools).',
      'Shipped profiles have NO room entries: every room resolves to exactly 1×.',
    ],
    at: src.at(F.tables, 'roomIntensity'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The builder

export function buildEnemyReference(opts: EnemyReferenceOptions = {}): EnemyReference {
  const src = new Sources(opts.readSource);
  const seeds = opts.censusSeeds ?? ENEMY_CENSUS_SEEDS;
  if (opts.profileFor && seeds.length) throw new Error('buildEnemyReference: profileFor (tests only) needs censusSeeds: [] — the census runs the registered generators');
  const profileOf = (l: LevelId) => opts.profileFor?.(l) ?? spawnProfile(l);
  const eSeeds = opts.eligibilitySeeds ?? (seeds.length ? ENEMY_ELIGIBILITY_SEEDS : []);
  if (opts.profileFor && eSeeds.length) throw new Error('buildEnemyReference: profileFor (tests only) needs eligibilitySeeds: [] as well');

  // --- coverage of the registries (unknown registrations fail the build)
  // task track1 (lane SPAWN): every registered level declares a tier + a valid profile (levels/levelContract.ts)
  const contract = validateLevelRegistry();
  if (contract.length) throw new Error(`level registry contract: ${contract.join('; ')}`);
  const archetypeIds = Object.keys(ENEMY_ARCHETYPES);
  if (archetypeIds.join('|') !== ENEMY_FAMILY_IDS.join('|')) throw new Error(`enemy families ${ENEMY_FAMILY_IDS.join(', ')} != archetype registry ${archetypeIds.join(', ')}`);
  if (Object.keys(SPAWN_PROFILES).sort().join('|') !== [...LEVEL_IDS].sort().join('|')) throw new Error('SPAWN_PROFILES and LEVEL_IDS disagree');
  for (const l of LEVEL_IDS) {
    const issues = validateSpawnProfile(profileOf(l));
    if (issues.length) throw new Error(`invalid spawn profile: ${issues.join('; ')}`);
    const declared = Object.keys(ENEMY_LEVEL_ADAPTER[l].contexts).sort().join('|'), inProfile = Object.keys(profileOf(l).contexts).sort().join('|');
    if (declared !== inProfile) throw new Error(`level ${l}: adapter contexts ${declared} != profile contexts ${inProfile}`);
    // task track3-eaton-centre-20261031 (lane PROFILES): a declared context no generator runs (0 runs) must say why (a data hook)
    for (const [id, a] of Object.entries(ENEMY_LEVEL_ADAPTER[l].contexts)) if (a && a.runs === 0 && !a.hook) throw new Error(`level ${l}: context ${id} has 0 runs but no hook note`);
  }

  const families: EnemyFamilyInfo[] = ENEMY_FAMILY_IDS.map(id => {
    const d = ENEMY_ARCHETYPES[id], ad = ENEMY_FAMILY_ADAPTER[id];
    // the registry's stats (when set) must be the very constant the adapter reads: the reference never shows other numbers
    if (d.stats && !ad.stats.some(v => v.stats === d.stats)) throw new Error(`family ${id}: ENEMY_ARCHETYPES.${id}.stats is not ${ad.stats.map(v => v.symbol).join(' / ')}`);
    const stats = ad.stats.map(v => statsVariant(v, src.at(v.file, v.symbol)));
    const rules: FamilyRuleGroup[] = ad.rules.map(r => ({title: r.title, rows: ruleRows(r.value, '', r.labels), at: src.at(r.file, r.symbol)}));
    // task studio-screacher-production-20261110-221858-01: a roster-only family (weight 0 in every pool) appears where the roster places it
    const rosterOnly = ROSTER_ONLY_FAMILIES.includes(id);
    return {id, label: d.label, model: d.model,
      variantModels: d.variantModels ? Object.entries(d.variantModels).map(([variant, model]) => ({variant, model, name: ad.variantNames?.[variant] ?? null})) : null,
      variants: VARIANTS[id] ?? null,
      // lane FAMILY (round 4): + a context's OWN pool (the Strainer has weight only in the service annexes' pool); never a zombie-free level
      levels: LEVEL_IDS.filter(l => !ZOMBIE_FREE_LEVELS.includes(l) && (hasPoolWeight(profileOf(l), id) || (rosterOnly && rosterRate(id, l) > 0))),
      rosterOnly, at: src.at(F.archetypes, `ENEMY_ARCHETYPES.${id}`), stats, rules};
  });

  // --- task studio-screacher-production-20261110-221858-01: the seeded roster (one rule set for every level)
  const rosterFamilies = ENEMY_FAMILY_IDS.map(id => rosterFamilyInfo(id, src));
  const levelName = (l: LevelId) => LEVELS[l].name;
  const seededOrder = ENEMY_FAMILY_IDS.map((f, k) => [f, k] as const).filter(([f]) => FAMILY_ROSTER[f].mode === 'seeded')
    .sort((a, b) => ROSTER_PLACE_PRIORITY[(FAMILY_ROSTER[a[0]] as SeededRule).place] - ROSTER_PLACE_PRIORITY[(FAMILY_ROSTER[b[0]] as SeededRule).place] || a[1] - b[1]).map(r => r[0]);
  const roster: RosterInfo = {
    version: ROSTER_VERSION, lane: ROSTER_LANE, zombieFreeLevels: [...ZOMBIE_FREE_LEVELS], rosterOnly: [...ROSTER_ONLY_FAMILIES], order: seededOrder,
    rules: [
      'One independent roll per seeded family per generated level map: the family is PRESENT when its roll is below its rate on that level. The roll is a hash of the level seed and the family (no random stream is consumed), so the layout, the loot and every spawn\'s position, type and per-spawn family draw are bit-identical with or without the pass, and the same seed gives the same roster on every revisit, reload, Retry and import. One map = one roll: every storey of a level shares it; it is never per floor, per spawn or per campaign.',
      'The pass runs once on the FINISHED layout — after every generation context, the one per-spawn family roll, the eligibility rules, cap and spacing, and the hordes — in the level registry, the same for every registered level.',
      'It only swaps a family with an ORDINARY AMBIENT ZOMBIE slot: a spawn\'s family (and, for a family with several bodies, its model variant) changes and nothing else. No spawn is added, removed, moved or reordered, so the enemy count, the positions and the per-index kill memory keep their meaning. Roaming-horde members and store / convention outfit zombies are never touched.',
      'A family rolled ABSENT has exactly none in that level: what its per-spawn roll placed becomes ordinary zombies. Nothing is renormalised and no other family\'s draw moves.',
      `A family rolled PRESENT is placed by its policy, the most constrained first: ${seededOrder.map(f => `${ENEMY_ARCHETYPES[f].label} (${(FAMILY_ROSTER[f] as SeededRule).place})`).join(', ')} — each on the ordinary zombie slots still left. A constrained family whose only legal slot holds a member of a share-top-up family takes that slot, and the member is exchanged to an ordinary zombie slot elsewhere. PRESENT MEANS AT LEAST ONE for every policy: only a level with no slot at all where the family may stand holds none, and the pass reports that as "no slot".`,
      `The ordinary zombie is the baseline: always present, never rolled.${ZOMBIE_FREE_LEVELS.length ? ` Zombie-free levels (${ZOMBIE_FREE_LEVELS.map(levelName).join(', ')}) never get any family.` : ''}`,
      `Version pin (saves): a station records the roster version it was first built with (section-memory lane '${ROSTER_LANE}'). A station already visited before the roster existed regenerates with version 0 — no pass, so its enemies, kills and ids stay exact; a station never entered (a new campaign, or an unvisited node of an older one) is built with the current version ${ROSTER_VERSION}. A direct generator call without a roster version gets no pass.`,
    ],
    families: rosterFamilies, rollCheckSeeds: ROSTER_ROLL_CHECK_SEEDS,
    at: src.at(F.roster, 'applyEnemyRoster'),
  };

  const corpus: CensusCorpus[] = [];
  const levels: EnemyLevelInfo[] = LEVEL_IDS.map(l => {
    const P = profileOf(l), def = LEVELS[l], ad = ENEMY_LEVEL_ADAPTER[l];
    // task track3-eaton-centre-20261031 (lane PROFILES): a profile declared as its own export (MALL_SPAWN_PROFILE) links there
    const base = EXPORT_NAME.get(P) ?? `SPAWN_PROFILES.${l}`;
    const symbolOf = (obj: unknown, path: string) => EXPORT_NAME.get(obj) ?? path;

    // contexts
    const contexts: SpawnContextInfo[] = (Object.entries(P.contexts) as [SpawnContextId, SpawnContextRule][]).map(([id, c]) => {
      const a = ad.contexts[id]!;
      const pl = c.placement, plPath = `${base}.contexts.${id}.placement`;
      // lane PROFILES (track3): was l === 'office' (the same text for both shipped levels). Track3 x Track2 merge: a Track 2 zone context
      // (placeServiceSpawns) keeps Track 2's text — storeyed only on the Office — so the Subway / Office pages read exactly as on Track 2.
      const storeyed = pl.landingKeepM !== undefined && (!a.zone || l === 'office');
      const acc = acceptedPlaced(c);
      const rejection: string[] = [];
      if (acc.min !== null) rejection.push(`fewer than ${acc.min} placed in one run → the whole attempt is regenerated`);
      if (acc.max !== null) rejection.push(`more than ${acc.max} placed in one run → the whole attempt is regenerated`);
      rejection.push(`an enemy closer than ${pl.startCells} walking cells to the start, on an unreachable cell or intersecting geometry → the attempt is regenerated`);
      const keepAway: PlacementInfo['keepAway'][number][] = [
        {rule: 'walking distance from the player start', value: pl.startCells, unit: 'cells', metres: rd(pl.startCells * CELL)},
        {rule: 'clear walkable cells around the candidate (radius)', value: pl.clearCells, unit: 'cells', metres: rd(pl.clearCells * CELL)},
      ];
      if (pl.landingKeepM !== undefined) keepAway.push({rule: 'straight-line keep-off from stair / elevator landings, the roof hatch and the ladder foot', value: pl.landingKeepM, unit: 'm', metres: pl.landingKeepM});
      const eligibility = [
        'a FLOOR cell of the context\'s storeys (not the outer border row)',
        `walking distance from the start ≥ ${pl.startCells} cells (${pl.startCells * CELL} m)`,
        `every cell within ${pl.clearCells} cell(s) walkable`,
        // storeyed placements (the Office's placeOfficeEnemies, reused by the mall): the landing keep-off marks them (subway: none)
        ...(storeyed ? ['not a stair ramp, not in a stair-role area, the area on its own storey', `≥ ${pl.landingKeepM ?? 0} m from every keep point of the storey`] : []),
        'the area\'s effective weight (area weight × room intensity) > 0',
      ];
      const explanation = a.zone?.explain ? [...a.zone.explain] : [
        `Draw count = U{${c.count[0]}..${c.count[1]}} (one draw per run), then the zombie types of that many spawns.`,
        'Collect every eligible cell, grouped by area; order the areas by a weighted shuffle (Efraimidis–Spirakis keys u^(1/weight)).',
        `For each cap pass (${pl.caps.passes.join(', ')}), walk the order: an area below its cap gets up to ${pl.tries} random cell picks; the first pick ≥ ${pl.spacingM} m from every enemy already placed${storeyed ? ' on that storey' : ''} takes one spawn.`,
        'Stop when the count is reached. Spacing, caps and eligible floor can leave a run short of its count (placed < count); validation regenerates the attempt where the profile requires it.',
        'Each placed spawn is then a family by its own roll (see the family pool) — independent of the area unless a room modifier says otherwise.',
      ];
      if (a.zone) eligibility.push(a.zone.where ?? `an area of the zone (one service annex), ≥ ${pl.landingKeepM ?? 0} m from the annex's entry door (its keep point)`);
      return {
        id, label: c.label, storeys: a.storeys, runs: a.runs,
        count: {lo: c.count[0], hi: c.count[1], mean: mean(c.count[0], c.count[1]), distribution: `uniform integer U{${c.count[0]}..${c.count[1]}} (rng.int, inclusive)`},
        perLevel: {lo: a.runs * c.count[0], hi: a.runs * c.count[1], mean: a.runs * mean(c.count[0], c.count[1])},
        ...(a.zone ? {zone: {runsPerLevel: {lo: a.zone.runsPerLevel[0], hi: a.zone.runsPerLevel[1]}, perLevelMax: a.zone.runsPerLevel[1] * c.count[1], note: a.zone.note}} : {}),
        ...(c.families ? {families: (() => {
          const fams = c.families, den = fams.reduce((s2, [, w]) => s2 + w, 0);
          return {rows: fams.map(([family, weight]) => ({family, weight, share: den > 0 ? rd(weight / den) : 0})),
            note: 'This context\'s OWN pool: its spawns draw their family from it (the same single roll per spawn, room modifiers and eligibility on top) instead of the level pool. The shares are CONFIGURED selection probabilities per spawn, not quotas: a 5-6-enemy annex may hold none or several; the sampled census shows the placed outcome.',
            at: src.at(fileOf(fams), symbolOf(fams, `${base}.contexts.${id}.families`))};
        })()} : {}),
        placement: {
          areaWeights: weightsInfo(pl.areaWeights), caps: capsInfo(pl.caps), triesPerArea: pl.tries,
          spacing: {metres: pl.spacingM, scope: storeyed ? 'straight line, same storey' : 'straight line'},
          keepAway, eligibility, explanation, at: src.at(fileOf(pl), symbolOf(pl, plPath)),
        },
        rejection, ...(a.hook ? {hook: a.hook} : {}), at: src.at(F.tables, `${base}.contexts.${id}`),
      };
    });
    const core = contexts.filter(c => !c.zone), zones = contexts.filter(c => c.zone);
    const total = {
      lo: core.reduce((s, c) => s + c.perLevel.lo, 0), hi: core.reduce((s, c) => s + c.perLevel.hi, 0), mean: core.reduce((s, c) => s + c.perLevel.mean, 0),
      note: `Spawns the level's context runs try to place (Σ runs × count). The family roll replaces, never adds; placed totals can fall short where eligible, spaced cells run out.${zones.length ? ` Not included: the zone context${zones.length === 1 ? '' : 's'} ${zones.map(c => `'${c.id}'`).join(', ')} (a per-zone budget of ${zones.map(c => `${c.count.lo}-${c.count.hi} per zone, 0-${c.zone!.perLevelMax} per level`).join('; ')}), reported separately.` : ''}`,
    };

    // family pool (task track1: + eligibility; a restricted family and its fallback are measured, not derived)
    const rules = Object.entries(P.eligibility ?? {}) as [EnemyFamilyId, FamilyEligibility][];
    const affected = new Set<string>(rules.flatMap(([f, r]) => [f, r.fallback]));
    // (task studio-screacher-production-20261110-221858-01) ONE sample pass: the eligibility census (levels with a rule; before the
    // roster pass) and the roster census (every level that can hold enemies; what a level holds after it)
    const zombieFree = ZOMBIE_FREE_LEVELS.includes(l);
    const sample = eSeeds.length && (rules.length || !zombieFree) ? samplePass(l, eSeeds) : null;
    const elig = sample && rules.length ? sample.eligibility : null;
    const rosterCen = sample && !zombieFree ? sample.roster : null;
    const denominator = P.families.reduce((s, [, w]) => s + w, 0);
    const poolRows = P.families.map(([family, weight]) => ({family, weight, share: denominator > 0 ? rd(weight / denominator) : 0,
      ...(rules.some(([f]) => f === family) ? {restricted: true} : {})}));
    const eligibility: EligibilityInfo[] = rules.map(([family, rule]) => {
      const sp = P.spacing?.[family]; // lane INTEG (task track3-eaton-centre-20261031)
      return {family, contexts: [...rule.contexts], criteria: eligibilityCriteria(rule, P, family),
        fallback: rule.fallback, maxPerLevel: rule.maxPerLevel ?? null,
        spacing: sp ? {metres: sp.spacingM, why: sp.why, at: src.at(F.tables, symbolOf(sp, `${base}.spacing.${family}`))} : null,
        why: rule.why, at: src.at(F.tables, symbolOf(rule, `${base}.eligibility.${family}`))};
    });
    const pool = {
      denominator, rows: poolRows,
      roll: `Every placed spawn draws its family independently: roll = enemyRoll(level seed, spawn index) ∈ [0, 1), walked over the pool weights of the spawn's room (the level pool when the room has no modifier), in registry order (the rat/dog keeps the top band; a family at weight 0 — the roster-only ${ROSTER_ONLY_FAMILIES.map(f => ENEMY_ARCHETYPES[f].label).join(' / ')} — has no band). A drawn family REPLACES a zombie; it never adds to the count.${rules.length ? ` Then the eligibility rule${rules.length === 1 ? '' : 's'} of ${rules.map(([f]) => f).join(', ')}: a draw where the rule fails becomes the fallback family — the other families' draws are untouched.` : ''}${P.spacing && Object.keys(P.spacing).length ? ` Then the whole-level spacing of ${Object.keys(P.spacing).join(', ')} (with the cap, in spawn order; a too-close draw becomes the fallback).` : ''}${P.horde ? ' Horde members are not rolled here: they are the separate horde pool.' : ''}${zombieFree ? '' : ` Last, the seeded roster pass (roster version ${ROSTER_VERSION}) runs once on the finished level: a family the level's seed rolled absent has exactly none there, a present one is placed by its policy (see the seeded roster).`}`,
      expectedPerLevel: poolRows.map(r => affected.has(r.family)
        ? {family: r.family, mean: elig ? elig.placed.find(x => x.family === r.family)!.perLevel : null, basis: 'sampled' as const}
        : {family: r.family, mean: rd(r.share * total.mean), basis: 'exact' as const}),
      eligibility,
      at: src.at(F.tables, symbolOf(P.families, `${base}.families`)),
    };

    // zombie types
    const zt = P.zombieTypes;
    const zombieTypes: ZombieTypeInfo = {
      types: [{type: 'coated', chance: zt.coatedChance}, {type: 'shambler', chance: rd(1 - zt.coatedChance)}],
      atLeastOneEach: zt.atLeastOneEach,
      rule: zt.atLeastOneEach
        ? 'Each spawn of a run: coated with the coated chance, else shambler; then, if the run has no coated, its first spawn becomes coated, and (count > 1) if it has no shambler, its second becomes shambler. Ratdogs keep the rolled type but ignore it.'
        : 'Each spawn of a run: coated with the coated chance, else shambler.',
      expectedCoated: contexts.flatMap(c => [...new Set([c.count.lo, c.count.hi])].filter(n => n > 0).map(n => ({context: c.id, count: n, share: rd(expectedCoatedShare(n, zt.coatedChance, zt.atLeastOneEach))}))),
      appearance: VARIANTS.zombie ?? '',
      at: src.at(F.tables, symbolOf(zt, `${base}.zombieTypes`)),
    };

    // storey moves
    const mv = P.levelMoves;
    const levelMoves: LevelMovesInfo | null = mv ? {
      what: 'After the station context, when every enemy is still on the main level, a weighted share moves onto the upper / lower storeys (spawns on stair flights always move). Totals are unchanged.',
      formula: `moved = min(max(placed − ${mv.mainKeep}, 0), max(storeys with candidates, round(placed × W_levels / (W_levels + W_main)))), W = Σ effective area weights; one area per storey first, then by the weighted order, ${mv.passes} passes, ${mv.tries} tries per area visit`,
      areaWeights: mv.areaWeights === P.contexts.station?.placement.areaWeights ? 'same area weights as the station context' : 'own area weights (see the profile)',
      mainKeep: mv.mainKeep, passes: mv.passes, triesPerArea: mv.tries, spacing: {metres: mv.spacingM, verticalMetres: mv.spacingDy}, keepAwayCells: mv.startCells,
      at: src.at(F.tables, `${base}.levelMoves`),
    } : null;

    // census + room modifiers
    const cen = seeds.length ? enemyCensus(l, seeds) : null;
    if (cen) corpus.push({level: l, seeds: cen.seeds, startWeapon: startWeaponFor(false), note: `${cen.seeds.length} sample levels of LEVELS.${l}.generate (shipped start weapon)${zombieFree ? '' : `, then the seeded roster pass (roster version ${ROSTER_VERSION})`}; not exhaustive.`});
    if (sample) corpus.push({level: l, seeds: [...eSeeds], startWeapon: startWeaponFor(false),
      note: `${[elig ? 'Eligibility census (draws vs placed of the restricted families, before the roster pass)' : '', rosterCen ? `Seeded roster census (the roster pass at version ${ROSTER_VERSION} on those levels: what a level holds)` : ''].filter(Boolean).join(' and ')}: ${sample.roster.layouts} sample levels of LEVELS.${l}.generate; not exhaustive.`});
    const entries: RoomModifierTable['entries'][number][] = [];
    for (const [room, mod] of Object.entries(P.rooms).sort(([a], [b]) => a.localeCompare(b))) {
      for (const [family, fm] of Object.entries(mod)) if (fm) entries.push({room, family, density: fm.density ?? null, weight: family === ALL_FAMILIES ? null : (fm as {weight?: number}).weight ?? null});
    }
    const keys = new Map<string, {keyKind: 'purpose' | 'room-type'; area: Pick<Area, 'purpose' | 'type'>}>();
    for (const a of cen?.areas ?? []) if (!keys.has(a.key)) keys.set(a.key, {keyKind: a.keyKind, area: a.keyKind === 'purpose' ? {purpose: a.key, type: a.type as Area['type']} : {type: a.key as Area['type']}});
    for (const e of entries) if (!keys.has(e.room)) {
      const isPurpose = !!purposeById(e.room);
      keys.set(e.room, {keyKind: isPurpose ? 'purpose' : 'room-type', area: isPurpose ? {purpose: e.room, type: e.room as Area['type']} : {type: e.room as Area['type']}});
    }
    const rows: RoomRow[] = [...keys].sort(([a], [b]) => a.localeCompare(b)).map(([room, k]) => {
      const obs = cen?.areas.filter(a => a.key === room) ?? [];
      const fams = ENEMY_FAMILY_IDS.map(f => {
        const m = roomModifier(P, k.area, f);
        const explicit = entries.some(e => e.room === room && (e.family === f || e.family === ALL_FAMILIES));
        return {family: f, density: m.density, weight: m.weight, from: explicit ? 'profile' as const : 'default' as const};
      });
      let observed: RoomCensus | null = null;
      if (cen && obs.length) {
        const cellsN = obs.reduce((s, a) => s + a.cells, 0), m2 = cellsN * CELL * CELL;
        const placed: Record<string, number> = {};
        for (const f of ENEMY_FAMILY_IDS) placed[f] = cen.spawns.filter(s => s.key === room && s.family === f).length;
        observed = {samples: new Set(obs.map(a => a.sample)).size, areas: obs.length, eligibleCells: cellsN, eligibleM2: rd(m2), placed,
          per100m2: per100(Object.values(placed).reduce((s, n) => s + n, 0), m2)};
      }
      return {
        room, keyKind: k.keyKind, label: (k.keyKind === 'purpose' ? purposeById(room)?.label : undefined) ?? (ROOM_LABEL as Record<string, string>)[room] ?? room,
        types: obs.length ? [...new Set(obs.map(a => a.type))].sort().map(type => ({type, label: (ROOM_LABEL as Record<string, string>)[type] ?? type})) : null,
        families: fams, intensity: rd(roomIntensity(P, k.area)),
        baselineWeights: obs.length ? [...new Set(obs.map(a => a.baseWeight))].sort((a, b) => a - b) : null,
        observed,
      };
    });
    const rooms: RoomModifierTable = {
      entries, rows,
      note: `${entries.length ? `${entries.length} explicit entr${entries.length === 1 ? 'y' : 'ies'}` : 'No explicit entries'}: every other room / family resolves to 1×. Rows list the room keys seen in the sampled census${cen ? '' : ' (census disabled: explicit entries only)'} plus any explicit entry; a key not listed resolves to 1× as well.`,
    };

    // task track3-eaton-centre-20261031 (lane PROFILES): the horde pool, ambient budgets
    const H = P.horde;
    let horde: HordeInfo | null = null;
    if (H) {
      const hd = H.families.reduce((s2, [, w]) => s2 + Math.max(0, w), 0);
      const gMean = mean(H.groups[0], H.groups[1]), sMean = mean(H.size[0], H.size[1]);
      const max = Math.min(H.budget.total, H.groups[1] * H.size[1]);
      horde = {
        label: H.label,
        groups: {lo: H.groups[0], hi: H.groups[1], mean: gMean},
        size: {lo: H.size[0], hi: H.size[1], mean: sMean},
        pool: {denominator: hd, rows: H.families.map(([family, weight]) => ({family, weight, share: hd > 0 ? rd(Math.max(0, weight) / hd) : 0}))},
        zombieTypes: {coatedChance: H.zombieTypes.coatedChance, atLeastOneEach: H.zombieTypes.atLeastOneEach},
        budget: {...H.budget},
        members: {meanBeforeBudget: rd(gMean * sMean), max,
          note: `Groups U{${H.groups[0]}..${H.groups[1]}} × members U{${H.size[0]}..${H.size[1]}} per group, then the budgets: at most ${H.budget.total} horde members in the level, ${H.budget.perStorey} members and ${H.budget.groupsPerStorey} group(s) starting on one storey (a group that does not fit is trimmed or dropped, never topped up).`},
        placement: {storeys: H.placement.storeys === 'rings' ? 'every retail ring storey' : `storeys ${H.placement.storeys.join(', ')}`, startM: H.placement.startM,
          groupSpacingM: H.placement.groupSpacingM, memberSpacingM: H.placement.memberSpacingM, clusterM: H.placement.clusterM, ambientSpacingM: H.placement.ambientSpacingM},
        patrol: {speed: H.patrol.speed, storeyChange: H.patrol.storeyChange, pauseChance: H.patrol.pauseChance, pause: [H.patrol.pause[0], H.patrol.pause[1]]},
        semantics: [
          'A SEPARATE pool: horde members are placed once at generation, after the ambient contexts and the ambient family roll, and never count against the ambient budget (or the reverse).',
          `Every member carries the horde pool's own context tag '${HORDE_CONTEXT}' (declared by the profile's horde rules), never an ambient context: no ambient family roll or eligibility rule (no Siren) ever reaches a horde member.`,
          'The horde family pool is explicit: the ambient rat/dog and Blightbelly shares are NOT applied to hordes, and Sirens never join an ordinary-zombie horde (validation rejects them).',
          'Finite: no spawner, no kill top-up and no revisit respawn. Kills persist through the run memory like every enemy; a group whose members all died stays dead.',
          'Members roam together on the patrol graph of real walkable links (gallery walkways, bridges, escalators / stairs); each member can break formation to chase with the ordinary AI.',
        ],
        at: src.at(F.tables, symbolOf(H, `${base}.horde`)),
      };
    }
    const B = P.budgets?.ambient;
    const budgets = B ? {ambient: {
      total: B.total, perStorey: B.perStorey, contextsMax: contexts.reduce((s2, c) => s2 + c.runs * c.count.hi, 0),
      note: 'Caps of the AMBIENT pool only: the whole-level total and one storey run. The contexts\' count ranges stay below them by construction (validation); the horde pool has its own budget.',
      at: src.at(F.tables, `${base}.budgets`),
    } satisfies AmbientBudgetInfo} : null;

    // knobs
    const knobs: EnemyKnob[] = [
      ...contexts.map(c => ({what: `count range (${c.id})`, value: [c.count.lo, c.count.hi] as const, at: src.at(F.tables, `${base}.contexts.${c.id}.count`)})),
      {what: 'family pool weights', value: P.families.map(([f, w]) => `${f} ${w}`).join(', '), at: pool.at},
      {what: 'coated chance', value: zt.coatedChance, at: zombieTypes.at},
      ...[...new Set(Object.values(P.contexts).map(c => c!.placement))].flatMap(pl => {
        const name = symbolOf(pl, `${base}.placement`);
        return [
          {what: 'area weights', value: `${pl.areaWeights.rules.length} rules, otherwise ${pl.areaWeights.otherwise}`, at: src.at(fileOf(pl), symbolOf(pl.areaWeights, `${name}.areaWeights`))},
          {what: 'caps', value: `passes ${pl.caps.passes.join(' / ')}; ${pl.caps.rules.length} rules`, at: src.at(fileOf(pl), symbolOf(pl.caps, `${name}.caps`))},
          {what: 'tries per area visit', value: pl.tries, at: src.at(fileOf(pl), `${name}.tries`)},
          {what: 'spacing (m)', value: pl.spacingM, at: src.at(fileOf(pl), `${name}.spacingM`)},
          {what: 'keep-away from the start (cells)', value: pl.startCells, at: src.at(fileOf(pl), `${name}.startCells`), note: `${pl.startCells * CELL} m walking`},
          ...(pl.landingKeepM !== undefined ? [{what: 'landing keep-off (m)', value: pl.landingKeepM, at: src.at(fileOf(pl), `${name}.landingKeepM`)}] : []),
        ];
      }),
      ...(mv ? [{what: 'storey moves (keep on main, passes, tries, spacing)', value: `${mv.mainKeep}, ${mv.passes}, ${mv.tries}, ${mv.spacingM} m / ${mv.spacingDy} m`, at: levelMoves!.at}] : []),
      {what: 'room modifiers', value: entries.length ? `${entries.length} entries` : 'none (all 1×)', at: src.at(F.tables, `${base}.rooms`), note: 'room key → family (or all) → {density, weight}'},
      ...eligibility.map(e => ({what: `eligibility (${e.family})`, value: `${e.contexts.join(' / ')}; fallback ${e.fallback}${e.maxPerLevel !== null ? `; at most ${e.maxPerLevel} per level` : ''}`, at: e.at})),
      ...eligibility.flatMap(e => (e.spacing ? [{what: `spacing (${e.family}, m)`, value: e.spacing.metres, at: e.spacing.at, note: 'whole level, with the cap'}] : [])),
      {what: 'difficulty tier', value: def.tier, at: src.at(F.registry, `LEVELS.${l}.tier`), note: 'metadata only (no scaling)'},
      ...(horde ? [
        {what: 'horde groups per level', value: [horde.groups.lo, horde.groups.hi] as const, at: horde.at},
        {what: 'horde members per group', value: [horde.size.lo, horde.size.hi] as const, at: horde.at},
        {what: 'horde budget (total / per storey / groups per storey)', value: `${horde.budget.total} / ${horde.budget.perStorey} / ${horde.budget.groupsPerStorey}`, at: horde.at},
        {what: 'horde family pool', value: horde.pool.rows.map(r => `${r.family} ${r.weight}`).join(', '), at: horde.at},
      ] : []),
      ...(budgets ? [{what: 'ambient budget (total / per storey)', value: `${budgets.ambient.total} / ${budgets.ambient.perStorey}`, at: budgets.ambient.at}] : []),
    ];

    // task studio-screacher-production-20261110-221858-01: the seeded roster on this level
    const runsHere = (c: SpawnContextId): boolean => { const a = ad.contexts[c], pc2 = P.contexts[c]; return !!a && !!pc2 && pc2.count[1] > 0 && (a.zone ? a.zone.runsPerLevel[1] > 0 : a.runs > 0); };
    const rosterRows = levelRosterRows(l, def.name, P, runsHere);
    if (rosterCen) {
      // the reference's own eligibility statement must agree with the pass's reports of every sampled level
      for (const row of rosterRows) {
        const c = rosterCen.families.find(x => x.family === row.family)!;
        if ((row.eligibility === 'every-map' || row.eligibility === 'baseline') && c.eligible !== rosterCen.layouts) throw new Error(`level ${l}: roster row ${row.family} says every map is eligible, the pass reported ${c.eligible} of ${rosterCen.layouts}`);
        if (row.eligibility === 'never' && (c.eligible !== 0 || c.after !== 0)) throw new Error(`level ${l}: roster row ${row.family} says never, the pass reported ${c.eligible} eligible levels / ${c.after} placed`);
      }
    }
    const levelRoster: LevelRosterInfo = {
      zombieFree, rows: rosterRows, census: rosterCen,
      note: zombieFree
        ? `${def.name} is a zombie-free level: it holds no enemy of any family, and the seeded roster pass does nothing here.`
        : `The seeded roster pass (roster version ${ROSTER_VERSION}) runs once on the finished ${def.name} layout, after every generation context, the per-spawn family roll, the eligibility rules and the hordes. One roll per family per level map seed; every storey of the level shares it. It never changes how many enemies the level has or where they stand — only which family an ordinary ambient zombie slot is.`,
    };
    for (const row of rosterRows) {
      if (row.eligibility !== 'every-map' && row.eligibility !== 'layout') continue;
      const rf = rosterFamilies.find(x => x.family === row.family)!;
      knobs.push({what: `seeded roster rate (${row.family})`, value: row.rate, at: rf.at, note: 'chance a level map holds the family at all; one roll per level seed'});
    }

    return {
      id: l, name: def.name, blurb: def.blurb,
      tier: {value: def.tier, at: src.at(F.registry, `LEVELS.${l}.tier`),
        note: 'Explicit difficulty tier of the level (0 = the starting level). Metadata only: no automatic scaling of counts, damage or loot, and no enemy family is enabled by it.'},
      profile: {label: P.label, at: src.at(F.tables, base)},
      generator: {fn: ad.generator.fn, at: src.at(ad.generator.file, ad.generator.fn), note: `${ad.generator.note} ${zombieFree ? ROSTER_GENERATOR_NOTE_ZOMBIE_FREE : ROSTER_GENERATOR_NOTE}`},
      total, contexts, pool, zombieTypes, levelMoves, rooms,
      census: cen ? levelCensus(cen, ENEMY_FAMILY_IDS) : null,
      eligibilityCensus: elig,
      knobs, horde, budgets, roster: levelRoster,
    };
  });

  const ref: EnemyReference = clean({
    meta: {schema: ENEMY_REFERENCE_SCHEMA, commit: '', buildId: '', dataHash: '', generatedFrom: [], repo: ENEMY_REPO, census: corpus},
    vocabulary: VOCABULARY,
    modifiers: semantics(src),
    roster,
    families, levels,
  });
  ref.meta.generatedFrom = [...ENEMY_GENERATED_FROM];
  const dataHash = fnv(JSON.stringify(ref));
  ref.meta.dataHash = dataHash;
  ref.meta.commit = opts.commit ?? 'local';
  ref.meta.buildId = opts.buildId ?? dataHash;
  return ref;
}
