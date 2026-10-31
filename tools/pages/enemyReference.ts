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

import * as ST from '../../game/src/ai/spawnTables';
import {
  ALL_FAMILIES, ENEMY_FAMILY_IDS, SPAWN_PROFILES, acceptedPlaced, baseAreaWeight, familyHookStatus, roomIntensity, roomKey, roomModifier, setSpawnCensusHook,
  spawnContext, spawnProfile, validateSpawnProfile,
  type AreaCaps, type AreaMatch, type AreaWeights, type EnemyFamilyId, type SpawnCandidateReport, type SpawnContextId, type SpawnContextRule,
  type SpawnProfile,
} from '../../game/src/ai/spawnTables';
import {ENEMY_ARCHETYPES} from '../../game/src/ai/creatureArchetypes';
import {LEVELS, LEVEL_IDS} from '../../game/src/levels/registry';
import type {LevelId} from '../../game/src/levels/types';
import type {Area, StationLayout} from '../../game/src/gen/stationTypes';
import {OFFICE_FLOORS, OFFICE_ROOF_LEVEL} from '../../game/src/gen/office/frame';
import {MALL_RINGS} from '../../game/src/gen/mall/mallTypes'; // task track3-eaton-centre-20261031 (lane PROFILES)
import {CELL} from '../../game/src/gen/grid';
import {ROOM_LABEL} from '../../game/src/gen/stationKit';
import {purposeById} from '../../game/src/gen/purposes';
import {startWeaponFor} from '../../game/src/weapons/pistol';
import {rd} from './probability';
import {
  ENEMY_REFERENCE_SCHEMA,
  type CensusCorpus, type EnemyFamilyInfo, type EnemyKnob, type EnemyLevelInfo, type EnemyReference, type LevelCensus, type LevelMovesInfo,
  type ModifierSemantics, type PlacementInfo, type RoomCensus, type RoomModifierTable, type RoomRow, type SourceLoc, type SpawnContextInfo,
  type VocabEntry, type ZombieTypeInfo,
  type AmbientBudgetInfo, type FamilyHookInfo, type HordeInfo, type RareRuleInfo, // task track3-eaton-centre-20261031 (lane PROFILES)
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
}

/** The fixed SAMPLED census seeds (a few per level; not exhaustive). */
export const ENEMY_CENSUS_SEEDS: readonly number[] = [11, 222, 3333, 44444];

const F = {
  tables: 'game/src/ai/spawnTables.ts', spawn: 'game/src/ai/creatureSpawn.ts', archetypes: 'game/src/ai/creatureArchetypes.ts',
  wardrobe: 'game/src/ai/wardrobe.ts', registry: 'game/src/levels/registry.ts', station: 'game/src/gen/station.ts',
  stationDress: 'game/src/gen/stationDress.ts', levelGenDress: 'game/src/gen/levelGenDress.ts', officeIndex: 'game/src/gen/office/index.ts',
  officeSpawns: 'game/src/gen/office/spawns.ts', officeValidate: 'game/src/gen/office/validate.ts', roof: 'game/src/gen/office/roof.ts',
  frame: 'game/src/gen/office/frame.ts', grid: 'game/src/gen/grid.ts', stationKit: 'game/src/gen/stationKit.ts', purposes: 'game/src/gen/purposes.ts',
  memory: 'game/src/run/memory.ts', pistol: 'game/src/weapons/pistol.ts',
  // task track3-eaton-centre-20261031 (lane PROFILES): The Eaton's Center
  mallIndex: 'game/src/gen/mall/index.ts', mallTypes: 'game/src/gen/mall/mallTypes.ts', hordeSpec: 'game/src/ai/hordeSpec.ts',
} as const;

/** The game modules whose exported values the reference reads (this file's imports). Other files appear only as source links. */
export const ENEMY_GENERATED_FROM: readonly string[] = [
  F.tables, F.archetypes, F.registry, F.frame, F.grid, F.stationKit, F.purposes, F.pistol, F.mallTypes,
].slice().sort();

/**
 * GENERATOR ADAPTER: which generator reads each level's profile and how often each context runs per level. These are code paths
 * of the generators (not data), declared here — `Record<LevelId, …>` makes a new level fail to typecheck until it is documented,
 * and game/tests/enemy-spawn-reference.test.ts checks that the contexts declared here === the profile's === the ones the real
 * generator asks for.
 */
export const ENEMY_LEVEL_ADAPTER: Readonly<Record<LevelId, {
  generator: {fn: string; file: string; note: string};
  /** `hook`: a DATA-HOOK context the generator does not run yet (0 runs; task track3-eaton-centre-20261031, lane PROFILES). */
  contexts: Readonly<Partial<Record<SpawnContextId, {storeys: string; runs: number; hook?: string}>>>;
  /** The ambient context a spawn on layout storey `storey` belongs to (the census groups placed spawns by it). */
  contextOf: (storey: number) => SpawnContextId;
}>> = {
  subway: {
    generator: {fn: 'generateStation', file: F.station,
      note: 'One station per level seed: placeSpawns (fork "spawns", after the loose floor finds) places the station context on the main level, placeLevelSpawns (fork "levelSpawns") moves a weighted share onto the upper / lower storeys, assignEnemyArchetypes rolls every family at the end.'},
    contexts: {station: {storeys: 'the main level, then the storey moves onto the upper / lower levels', runs: 1}},
    contextOf: () => 'station',
  },
  office: {
    generator: {fn: 'generateOfficeLevel', file: F.officeIndex,
      note: 'ONE continuous level (station, lobby, office floors 2..8, roof) generated once per level seed: placeOfficeEnemies runs once per storey context on its own fork, assignEnemyArchetypes rolls every family at the end. Changing floors never rerolls anything.'},
    contexts: {
      street: {storeys: 'station + tower lobby (levels 0 and 1)', runs: 1},
      floor: {storeys: 'one office floor (each of floors 2..8)', runs: OFFICE_FLOORS.filter(f => f !== 1).length},
      roof: {storeys: 'the roof deck (level 9; the hatch / ladder zone held empty)', runs: 1},
    },
    contextOf: storey => (storey <= 1 ? 'street' : storey === OFFICE_ROOF_LEVEL ? 'roof' : 'floor'),
  },
  // task track3-eaton-centre-20261031 (lane PROFILES): The Eaton's Center — ONE level: the pit station + the retail rings
  mall: {
    generator: {fn: 'generateMallLevel', file: F.mallIndex,
      note: `ONE continuous level (the subway station at the bottom of the open void and ${MALL_RINGS} retail rings around it) generated once per level seed: placeOfficeEnemies runs the pit context once and the ring context once per ring, each on its own fork (mall-enemies-<storey>); assignEnemyArchetypes rolls every ambient family; applyRareFamilyRules bounds the rare families; the roaming hordes (the separate horde pool) are placed LAST by ai/hordePlace.ts placeHordes. Moving between storeys never rerolls anything.`},
    contexts: {
      pit: {storeys: 'the subway station storey at the bottom of the void (level 0: platforms, plaza, courts)', runs: 1},
      ring: {storeys: `one retail ring (each of levels 1..${MALL_RINGS}: gallery, shops, back rooms, service corridors)`, runs: MALL_RINGS},
      service: {storeys: 'one Track2 service annex (per annex, annex areas only)', runs: 0,
        hook: 'DATA HOOK, NOT INTEGRATED: Track2\'s same-world service annexes (0 / 1 / 2 per level) are not on main yet, so no generator runs this per-annex budget (0 runs; excluded from the level total). When they land each annex runs it once on its own fork with the mall\'s ambient family profile (no guaranteed Siren per annex), never as part of the horde pool.'},
    },
    contextOf: storey => (storey === 0 ? 'pit' : 'ring'),
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
};

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
  /** One entry per placed AMBIENT spawn of every sample level. */
  spawns: {family: string; type: string; key: string; kind: string; context: string}[];
  /** Task track3-eaton-centre-20261031 (lane PROFILES): horde members (the separate pool; layout.zombies tagged `horde`) and groups. */
  horde: {family: string; type: string; key: string; group: string; storey: number}[];
}

/**
 * The generation context a placed AMBIENT spawn belongs to: the level adapter's storey rule (Office: by storey; the Subway's single
 * context incl. its storey moves). Task track3-eaton-centre-20261031 (lane PROFILES): horde members (layout.zombies `horde`) are the
 * separate horde pool — counted in census.horde, never in an ambient context.
 */
function contextOfSpawn(level: LevelId, z: {level?: number}): string {
  return ENEMY_LEVEL_ADAPTER[level].contextOf(z.level ?? 0);
}

const censusCache = new Map<string, CensusLevel>();

/** One level's census over `seeds` (the shipped start weapon, the registered generator). Cached per process. */
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
      for (const z of layout.zombies) {
        const a: Area | undefined = layout.areas[z.area];
        if (z.horde !== undefined) { out.horde.push({family: z.archetype ?? 'zombie', type: z.type, key: a ? roomKey(a) : '?', group: `${sample}:${z.horde}`, storey: z.level ?? 0}); continue; }
        out.spawns.push({family: z.archetype ?? 'zombie', type: z.type, key: a ? roomKey(a) : '?', kind: a?.kind ?? '?', context: contextOfSpawn(level, z)});
      }
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
    placed: families.map(f => ({family: f, total: byFamily(f), perLevel: rd(byFamily(f) / Math.max(1, layouts)), per100m2: per100(byFamily(f), eligibleCells * cellM2) ?? 0})),
    byContext: ctxIds.map(id => {
      const m2 = c.areas.filter(a => a.context === id).reduce((s, a) => s + a.cells, 0) * cellM2;
      const n = c.spawns.filter(s => s.context === id).length;
      return {context: id, eligibleM2: rd(m2), placed: n, perLevel: rd(n / Math.max(1, layouts)), per100m2: per100(n, m2)};
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
    note: `SAMPLED: ${layouts} sample levels of the registered generator (seeds ${c.seeds.join(', ')}, shipped start weapon). Eligible floor = cells the generator's own candidate filter accepted (walking distance, clearance, storey, stair / landing keep-off, weight > 0) x ${cellM2} m² — never bounding boxes. Not exhaustive; not a runtime rule.`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Static vocabulary / semantics (prose; every number elsewhere is read from the profiles)

const VOCABULARY: readonly VocabEntry[] = [
  {term: 'count range', unit: 'spawns per run of a context', definition: 'The generator draws ONE uniform integer U{lo..hi} per run of a generation context (inclusive): the number of spawns that run tries to place. There is no per-area spawn density at runtime.'},
  {term: 'E[count]', unit: 'spawns per run', definition: 'Exact expectation of the count draw, (lo + hi) / 2. Per level: Σ runs × E[count] over the contexts.'},
  {term: 'area weight', unit: 'relative (no unit)', definition: 'Relative preference of an area in the weighted area order (Efraimidis–Spirakis keys u^(1/w)): areas with more weight tend to be visited earlier in each cap pass. Never a chance and never a count.'},
  {term: 'cap', unit: 'spawns per area', definition: 'Most spawns an area may hold after each pass (passes 1, 2, 3); platforms hold one more, closets / closed exits / storefront units at most one.'},
  {term: 'family weight', unit: 'relative (no unit)', definition: 'Weight of an enemy family in the level pool; only meaningful against the denominator Σ weights.'},
  {term: 'share', unit: 'conditional chance per placed spawn', definition: 'weight / denominator: the chance that ONE placed spawn is that family (an independent per-spawn roll keyed on level seed + spawn index that REPLACES a zombie). Not a chance per area or per m².'},
  {term: 'placed', unit: 'spawns', definition: 'What the generator actually placed: below the count when the eligible, spaced cells run out (Subway attempts with fewer than the accepted minimum, and Office runs outside their count range, are regenerated).'},
  {term: 'sampled density', unit: 'placed per 100 m² of eligible floor (sampled)', definition: 'Placed spawns divided by the eligible floor area of a small labelled seed corpus. Eligible = cells the generator\'s own candidate filter accepted (0.25 m² each), never map bounding boxes. A census, not a runtime rule.'},
  {term: 'density (room modifier)', unit: 'multiplier (1 = neutral)', definition: 'Local intensity of a family in a room: scales the room\'s area weight by the room intensity D and the family\'s part of the room mix. Never changes the count roll or a cap.'},
  {term: 'weight (room modifier)', unit: 'multiplier (1 = neutral)', definition: 'Conditional composition in a room: scales a family\'s pool weight for spawns that land in that room. Changes which family a spawn there becomes, never how many spawns the room attracts.'},
  // task track3-eaton-centre-20261031 (lane PROFILES): the mall's hooks, rare placement, horde pool and budgets
  {term: 'family hook', unit: 'share of the ambient pool once typed', definition: 'An ambient family a level declares before the enemy registry exports it (a plain string id). Inactive while the registry lacks it: no spawn can be that family and its share stays with zombies. Once the registry exports it, validation requires the level to list it in its typed pool.'},
  {term: 'rare placement', unit: 'spawns per level (cap) and metres (spacing)', definition: 'A whole-level cap and minimum spacing for a rare family, applied after the family roll in spawn-index order: an extra or too-close spawn of that family becomes a zombie. Never touches horde members.'},
  {term: 'horde pool', unit: 'groups per level × members per group', definition: 'The roaming hordes: a SEPARATE pool with its own explicit families, group count and group size ranges and budgets (members in the level, members and groups starting on one storey). Placed once at generation; no respawn or top-up; never counted in the ambient contexts.'},
  {term: 'ambient budget', unit: 'ambient spawns per level / per storey run', definition: 'Explicit caps of the ambient pool (the contexts): the whole-level total and one storey run. The horde pool has its own budget.'},
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

  // --- coverage of the registries (unknown registrations fail the build)
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
    const d = ENEMY_ARCHETYPES[id];
    return {id, label: d.label, model: d.model, variants: VARIANTS[id] ?? null,
      levels: LEVEL_IDS.filter(l => profileOf(l).families.some(([f, w]) => f === id && w > 0)), at: src.at(F.archetypes, `ENEMY_ARCHETYPES.${id}`)};
  });

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
      const storeyed = pl.landingKeepM !== undefined; // lane PROFILES (track3): was l === 'office' (the same text for both shipped levels)
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
      const explanation = [
        `Draw count = U{${c.count[0]}..${c.count[1]}} (one draw per run), then the zombie types of that many spawns.`,
        'Collect every eligible cell, grouped by area; order the areas by a weighted shuffle (Efraimidis–Spirakis keys u^(1/weight)).',
        `For each cap pass (${pl.caps.passes.join(', ')}), walk the order: an area below its cap gets up to ${pl.tries} random cell picks; the first pick ≥ ${pl.spacingM} m from every enemy already placed${storeyed ? ' on that storey' : ''} takes one spawn.`,
        'Stop when the count is reached. Spacing, caps and eligible floor can leave a run short of its count (placed < count); validation regenerates the attempt where the profile requires it.',
        'Each placed spawn is then a family by its own roll (see the family pool) — independent of the area unless a room modifier says otherwise.',
      ];
      return {
        id, label: c.label, storeys: a.storeys, runs: a.runs,
        count: {lo: c.count[0], hi: c.count[1], mean: mean(c.count[0], c.count[1]), distribution: `uniform integer U{${c.count[0]}..${c.count[1]}} (rng.int, inclusive)`},
        perLevel: {lo: a.runs * c.count[0], hi: a.runs * c.count[1], mean: a.runs * mean(c.count[0], c.count[1])},
        placement: {
          areaWeights: weightsInfo(pl.areaWeights), caps: capsInfo(pl.caps), triesPerArea: pl.tries,
          spacing: {metres: pl.spacingM, scope: storeyed ? 'straight line, same storey' : 'straight line'},
          keepAway, eligibility, explanation, at: src.at(F.tables, symbolOf(pl, plPath)),
        },
        rejection, ...(a.hook ? {hook: a.hook} : {}), at: src.at(F.tables, `${base}.contexts.${id}`),
      };
    });
    const total = {
      lo: contexts.reduce((s, c) => s + c.perLevel.lo, 0), hi: contexts.reduce((s, c) => s + c.perLevel.hi, 0), mean: contexts.reduce((s, c) => s + c.perLevel.mean, 0),
      note: 'Spawns the level\'s context runs try to place (Σ runs × count). The family roll replaces, never adds; placed totals can fall short where eligible, spaced cells run out.',
    };

    // family pool
    const denominator = P.families.reduce((s, [, w]) => s + w, 0);
    const poolRows = P.families.map(([family, weight]) => ({family, weight, share: denominator > 0 ? rd(weight / denominator) : 0}));
    const pool = {
      denominator, rows: poolRows,
      roll: 'Every placed spawn draws its family independently: roll = enemyRoll(level seed, spawn index) ∈ [0, 1), walked over the pool weights of the spawn\'s room (the level pool when the room has no modifier). A rat/dog REPLACES a zombie; it never adds to the count.',
      expectedPerLevel: poolRows.map(r => ({family: r.family, mean: rd(r.share * total.mean)})),
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
    if (cen) corpus.push({level: l, seeds: cen.seeds, startWeapon: startWeaponFor(false), note: `${cen.seeds.length} sample levels of LEVELS.${l}.generate (shipped start weapon); not exhaustive.`});
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

    // task track3-eaton-centre-20261031 (lane PROFILES): Track1 family hooks, rare placement, the horde pool, ambient budgets
    const hookStatus = familyHookStatus(P);
    const hooks: FamilyHookInfo[] = (P.familyHooks ?? []).map((h, i) => ({
      family: h.family, share: h.share, active: hookStatus[i].active, status: hookStatus[i].status, note: h.note,
      expectedPerLevelIfTyped: rd(h.share * total.mean), at: src.at(F.tables, `${symbolOf(P.familyHooks, `${base}.familyHooks`)}`),
    }));
    const typedShare = (f: string) => poolRows.find(r => r.family === f)?.share;
    const rare: RareRuleInfo[] = (P.rare ?? []).map(r => {
      const typed = typedShare(r.family), hook = P.familyHooks?.find(h => h.family === r.family);
      const share = typed ?? hook?.share ?? 0;
      return {
        family: r.family, capPerLevel: r.capPerLevel, spacingM: r.spacingM, why: r.why, status: typed !== undefined ? 'live' as const : 'waiting' as const,
        expectedBeforeCap: rd(share * total.mean),
        semantics: `After the family roll, in spawn-index order: an ambient ${r.family} beyond the first ${r.capPerLevel} of the level, or closer than ${r.spacingM} m (straight 3D line) to an earlier kept one, becomes a zombie (same position, type and area) — applyRareFamilyRules, pure and RNG-free. Horde members are never touched.${typed !== undefined ? '' : ` Waiting: '${r.family}' is a family hook the registry does not export yet, so no spawn can be one.`}`,
        at: src.at(F.tables, symbolOf(P.rare, `${base}.rare`)),
      };
    });
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
          {what: 'area weights', value: `${pl.areaWeights.rules.length} rules, otherwise ${pl.areaWeights.otherwise}`, at: src.at(F.tables, symbolOf(pl.areaWeights, `${name}.areaWeights`))},
          {what: 'caps', value: `passes ${pl.caps.passes.join(' / ')}; ${pl.caps.rules.length} rules`, at: src.at(F.tables, symbolOf(pl.caps, `${name}.caps`))},
          {what: 'tries per area visit', value: pl.tries, at: src.at(F.tables, `${name}.tries`)},
          {what: 'spacing (m)', value: pl.spacingM, at: src.at(F.tables, `${name}.spacingM`)},
          {what: 'keep-away from the start (cells)', value: pl.startCells, at: src.at(F.tables, `${name}.startCells`), note: `${pl.startCells * CELL} m walking`},
          ...(pl.landingKeepM !== undefined ? [{what: 'landing keep-off (m)', value: pl.landingKeepM, at: src.at(F.tables, `${name}.landingKeepM`)}] : []),
        ];
      }),
      ...(mv ? [{what: 'storey moves (keep on main, passes, tries, spacing)', value: `${mv.mainKeep}, ${mv.passes}, ${mv.tries}, ${mv.spacingM} m / ${mv.spacingDy} m`, at: levelMoves!.at}] : []),
      {what: 'room modifiers', value: entries.length ? `${entries.length} entries` : 'none (all 1×)', at: src.at(F.tables, `${base}.rooms`), note: 'room key → family (or all) → {density, weight}'},
      ...hooks.map(h => ({what: `family hook ${h.family} (ambient share)`, value: h.share, at: h.at, note: h.active ? 'registry exports it' : 'inactive until Track1'})),
      ...rare.map(r => ({what: `rare ${r.family}: cap per level / spacing (m)`, value: `${r.capPerLevel} / ${r.spacingM}`, at: r.at})),
      ...(horde ? [
        {what: 'horde groups per level', value: [horde.groups.lo, horde.groups.hi] as const, at: horde.at},
        {what: 'horde members per group', value: [horde.size.lo, horde.size.hi] as const, at: horde.at},
        {what: 'horde budget (total / per storey / groups per storey)', value: `${horde.budget.total} / ${horde.budget.perStorey} / ${horde.budget.groupsPerStorey}`, at: horde.at},
        {what: 'horde family pool', value: horde.pool.rows.map(r => `${r.family} ${r.weight}`).join(', '), at: horde.at},
      ] : []),
      ...(budgets ? [{what: 'ambient budget (total / per storey)', value: `${budgets.ambient.total} / ${budgets.ambient.perStorey}`, at: budgets.ambient.at}] : []),
    ];

    return {
      id: l, name: def.name, blurb: def.blurb,
      profile: {label: P.label, at: src.at(F.tables, base)},
      generator: {fn: ad.generator.fn, at: src.at(ad.generator.file, ad.generator.fn), note: ad.generator.note},
      total, contexts, pool, zombieTypes, levelMoves, rooms,
      census: cen ? levelCensus(cen, ENEMY_FAMILY_IDS) : null,
      knobs, hooks, rare, horde, budgets,
    };
  });

  const ref: EnemyReference = clean({
    meta: {schema: ENEMY_REFERENCE_SCHEMA, commit: '', buildId: '', dataHash: '', generatedFrom: [], repo: ENEMY_REPO, census: corpus},
    vocabulary: VOCABULARY,
    modifiers: semantics(src),
    families, levels,
  });
  ref.meta.generatedFrom = [...ENEMY_GENERATED_FROM];
  const dataHash = fnv(JSON.stringify(ref));
  ref.meta.dataHash = dataHash;
  ref.meta.commit = opts.commit ?? 'local';
  ref.meta.buildId = opts.buildId ?? dataHash;
  return ref;
}
