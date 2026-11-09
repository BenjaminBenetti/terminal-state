// Task studio-bunker-level-20261109-072224-01: THE BUNKER's enemy populations (pure data) — the spawn profile's storey contexts
// (ai/spawnTables.ts BUNKER_SPAWN_PROFILE): one run per storey through the Office / Reactor placement routine (gen/office/spawns.ts
// placeOfficeEnemies: count, type roll, start keep-off, area weights x room intensity, caps, tries, spacing — tagged with its context so
// the Siren's eligibility reads it), then ONE 'damp' run over the water-damaged areas only (the distance field masked to them: the same
// routine, no second placement code) — its own pool is the only one outside the service annexes with the Strainer. Archetypes are rolled
// once for the whole level afterwards (assignEnemyArchetypes + applyFamilySpacing, gen/bunker/index.ts).

import type {Rng} from '../../core/rng';
import type {StationLayout} from '../stationTypes';
import type {SpawnContextId, SpawnProfile} from '../../ai/spawnTables';
import {placeOfficeEnemies, type SpawnField} from '../office/spawns';
import {BUNKER_LEVELS} from './frame';

/** Spawn context of a storey: the station 'station', the upper shelter storeys 1-3 'floor', the deep storeys 4-5 'ring'. */
export function bunkerSpawnContext(lv: number): SpawnContextId {
  return lv === 0 ? 'station' : lv <= 3 ? 'floor' : 'ring';
}

/** QA / tests: what the last level placed per context. */
export const BUNKER_SPAWN_STATS = {placed: {} as Record<string, number>, damp: 0};

export function placeBunkerEnemies(layout: StationLayout, rng: Rng, field: SpawnField, spawns: SpawnProfile, damp: readonly number[]): void {
  BUNKER_SPAWN_STATS.placed = {};
  for (let lv = 0; lv < BUNKER_LEVELS; lv++) {
    const ctx = bunkerSpawnContext(lv);
    if (!spawns.contexts[ctx]) continue;
    const n = placeOfficeEnemies(layout, rng.fork(`bunker-enemies-${lv}`), field, [lv], spawns, ctx);
    BUNKER_SPAWN_STATS.placed[`L${lv}`] = n;
  }
  BUNKER_SPAWN_STATS.damp = 0;
  if (!damp.length || !spawns.contexts.damp) return;
  const set = new Set(damp);
  const levels = [...new Set(damp.map(id => layout.areas[id].level ?? 0))];
  // the damp run's field: the start distances inside the damp areas only (every other cell unreachable for this run)
  const dist = field.dist.map((d, lv) => {
    if (!levels.includes(lv)) return new Int32Array(d.length).fill(-1);
    const g = layout.levels[lv].grid, out = new Int32Array(d.length).fill(-1);
    for (let i = 0; i < d.length; i++) if (set.has(g.area[i])) out[i] = d[i];
    return out;
  });
  BUNKER_SPAWN_STATS.damp = placeOfficeEnemies(layout, rng.fork('bunker-damp'), {dist, keep: field.keep}, levels, spawns, 'damp');
}
