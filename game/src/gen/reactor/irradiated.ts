// Task studio-reactor-glowing-zombies-20261115-013245-01: WHERE the Reactor's irradiated zombies stand (the rule: ai/irradiated.ts).
//
// THE LOWER LEVELS = the bottom half of the pit's six storeys (layout.levels 0..5: the rim 0, walkway tiers 1-4, the core floor 5):
// TIER 3 (levels[3], deck ~ -17 … -19 m), TIER 4 (levels[4], ~ -23 … -26 m) and the CORE FLOOR (levels[5], ~ -28 … -33 m). They are the
// deep gas zone's two walkway tiers (spawn context 'ring', the waste repository on tier 4) and the core floor ('pit'). The rim (0), tiers
// 1-2 ('floor', the bunker and the mines) and the open-air surface storey (levels[6], the ending's exit; no enemies) never get one.
//
// PLACEMENT, per storey: the storey's own spawn context and its placement rules (REACTOR_SPAWN_PROFILE: area weights, per-area caps,
// tries, 4 m spacing to every enemy already on the storey, >= 36 walking cells from the platform start, 5 m off every stair / ladder /
// link landing, generator use point, restart stand point and complex entrance) on the generator's OWN walking-distance field and keep
// points (recorded per layout by the generator: rememberReactorSpawnField), through the same routine the generator placed its storey
// runs with (gen/office/spawns.ts placeOfficeEnemies, `fixed` count). The stream is a fresh Rng from a hash of (level seed, storey):
// nothing the generator, the roster or the loot drew moves. Types: the profile's 60 / 40 shambler / coated chance per addition (without
// the storey run's at-least-one-each fix — that belongs to a whole storey run). A storey that cannot hold all of its share at 4 m
// retries the rest once at 2.5 m; anything still left is reported (`short`), never silently dropped.

import {Rng, hashString} from '../../core/rng';
import type {StationLayout} from '../stationTypes';
import type {LevelId} from '../../levels/types';
import {spawnContext, spawnProfile, type SpawnProfile} from '../../ai/spawnTables';
import {IRRADIATED, irradiatedAddCount, isRegularZombie, recordIrradiated, splitAdditions, type IrradiatedReport} from '../../ai/irradiated';
import {placeOfficeEnemies, type SpawnField} from '../office/spawns';
import {REACTOR_LEVELS, reactorSpawnContext} from './frame';

/** The Reactor's LOWER storeys: the bottom half of its pit storeys = [3, 4, 5] (tier 3, tier 4, the core floor). */
export const REACTOR_LOWER_LEVELS: readonly number[] = Array.from({length: REACTOR_LEVELS - Math.ceil(REACTOR_LEVELS / 2)}, (_, i) => Math.ceil(REACTOR_LEVELS / 2) + i);

/** The spacing (m) of a storey's second, relaxed try for additions the 4 m rule could not seat. */
export const IRRADIATED_RELAXED_SPACING_M = 2.5;

/**
 * Generation-time side table: the spawn field (walking distance from the start on every storey + keep points) the Reactor generator
 * placed its storey runs with, keyed by the layout object (layout data unchanged: no fingerprint moves; garbage with the layout).
 */
const FIELDS = new WeakMap<object, SpawnField>();
export function rememberReactorSpawnField(layout: object, field: SpawnField): void {
  FIELDS.set(layout, field);
}

const streamOf = (levelSeed: number, what: string): Rng => new Rng(hashString(`enemy-${IRRADIATED.key}:${what}`, (levelSeed >>> 0) ^ 0x1a2d1a7e));

/**
 * THE ADDITIONS PASS (levels/registry.ts, right after applyEnemyRoster): appends the irradiated zombies of a FINISHED layout of `level`
 * at roster `version`. A no-op (undefined) for every other level and for a version older than IRRADIATED.since.
 */
export function applyIrradiatedAdditions(layout: StationLayout, level: LevelId, levelSeed: number, version: number): IrradiatedReport | undefined {
  if (level !== 'reactor' || version < IRRADIATED.since) return undefined;
  return addReactorIrradiated(layout, levelSeed, version);
}

/** The Reactor's additions (exported for tests / QA: `profile` defaults to the level's). */
export function addReactorIrradiated(layout: StationLayout, levelSeed: number, version: number = IRRADIATED.since, profile: SpawnProfile = spawnProfile('reactor')): IrradiatedReport {
  const Z = layout.zombies, storeys = [...REACTOR_LOWER_LEVELS];
  const rows = storeys.map(level => ({level, regular: Z.reduce((n, s) => n + ((s.level ?? 0) === level && isRegularZombie(s) ? 1 : 0), 0)}));
  const regular = rows.reduce((n, r) => n + r.regular, 0), wanted = irradiatedAddCount(regular);
  const split = splitAdditions(wanted, rows);
  const report: IrradiatedReport = {
    version, storeys, regular, wanted, placed: 0, first: Z.length, short: 0,
    perStorey: rows.map(r => ({level: r.level, regular: r.regular, wanted: split.get(r.level) ?? 0, placed: 0})),
  };
  recordIrradiated(layout, report);
  const field = FIELDS.get(layout);
  if (!field) { report.noField = true; report.short = wanted; return report; }
  for (const row of report.perStorey) {
    if (!row.wanted) continue;
    const context = reactorSpawnContext(row.level), rule = spawnContext(profile, context);
    const types = {coatedChance: profile.zombieTypes.coatedChance, atLeastOneEach: false};
    const from = Z.length;
    row.placed = placeOfficeEnemies(layout, streamOf(levelSeed, `${row.level}`), field, [row.level], profile, context, {count: row.wanted, types});
    if (row.placed < row.wanted) {
      // the storey's own rules could not seat them all at 4 m: once more at the relaxed spacing (still the storey's cells, caps, keep-offs)
      const relaxed: SpawnProfile = {...profile, contexts: {...profile.contexts, [context]: {...rule, placement: {...rule.placement, spacingM: IRRADIATED_RELAXED_SPACING_M}}}};
      row.placed += placeOfficeEnemies(layout, streamOf(levelSeed, `${row.level}:relaxed`), field, [row.level], relaxed, context, {count: row.wanted - row.placed, types});
    }
    for (let i = from; i < Z.length; i++) Z[i].irradiated = true;
    report.placed += row.placed;
  }
  report.short = wanted - report.placed;
  return report;
}
