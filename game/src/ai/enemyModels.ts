// Task track1-siren-blightbelly-20261031 (lane BLIGHT, generic for both new families): LEVEL-SPECIFIC enemy model loading.
// The new enemy GLBs are NOT in assets/manifest.ts MODEL_FILES (the boot preload): a section fetches exactly the enemy models
// its generated layout placed (ENEMY_ARCHETYPES[spawn.archetype].model), through the same lazy library as the p7 / office
// models (Game.propModels + Game.sectionModelKeys, assets/loader.ts PropModelLibrary: fetched with progress before the
// section is revealed, cached, trimmed when no longer used). So a level whose profile never places a Siren never loads her
// model; resident memory follows the live section. A model that failed to load leaves those spawns as plain zombies
// (createEnemyActor's existing fallback, counted by QA).

import {ENEMY_ARCHETYPES} from './creatureArchetypes';

/** Lazily loaded enemy models: library key -> url + catalogue bytes (progress weight). */
export const ENEMY_MODEL_FILES: Readonly<Record<string, {url: string; bytes: number}>> = {
  enemy_blightbelly: {url: 'assets/models/enemy-blightbelly.glb', bytes: 2_221_420},
  enemy_siren: {url: 'assets/models/enemy-siren.glb', bytes: 12_873_732},
  // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): THE STRAINER (service annexes only: only a layout whose annex
  // roll placed one loads it). `bytes` = the GLB's size (tests/strainer-contract.test.ts checks it). A model that failed to load
  // -> the counted zombie stand-in.
  enemy_strainer: {url: 'assets/models/enemy-strainer.glb', bytes: 2_395_736},
  // Task studio-screacher-production-20261110-221858-01: THE SCREACHER's four approved bodies (one enemy type; a layout loads exactly
  // the variants its roster placed: 1-3 of them, on the 40 % of levels that hold Screachers at all). `bytes` = each GLB's size
  // (tests/screacher-contract.test.ts checks it). A model that failed to load -> the counted zombie stand-in.
  enemy_screacher_sc01: {url: 'assets/models/enemy-screacher-sc01.glb', bytes: 1_861_136},
  enemy_screacher_sc02: {url: 'assets/models/enemy-screacher-sc02.glb', bytes: 1_976_432},
  enemy_screacher_sc03: {url: 'assets/models/enemy-screacher-sc03.glb', bytes: 1_941_068},
  enemy_screacher_sc04: {url: 'assets/models/enemy-screacher-sc04.glb', bytes: 2_125_488},
  // Task studio-bb-production-20261112-234540-01: BB's four approved looks (one enemy type; a layout loads exactly the looks its roster
  // placed: 1-3 of them, on the 40 % of combat levels that hold BBs at all). `bytes` = each GLB's size (tests/bb-contract.test.ts
  // checks it). A model that failed to load -> the counted zombie stand-in.
  enemy_bb_lullaby: {url: 'assets/models/enemy-bb-lullaby.glb', bytes: 2_000_000},
  enemy_bb_binky: {url: 'assets/models/enemy-bb-binky.glb', bytes: 2_000_000},
  enemy_bb_teddy: {url: 'assets/models/enemy-bb-teddy.glb', bytes: 2_000_000},
  enemy_bb_changeling: {url: 'assets/models/enemy-bb-changeling.glb', bytes: 2_000_000},
};

/** The lazy enemy model keys a layout's spawns use (sorted; families without a lazy model contribute none). */
export function enemyModelKeysFor(layout: {zombies: readonly {archetype?: string; variant?: string}[]}): string[] {
  const s = new Set<string>();
  for (const z of layout.zombies) {
    const def = z.archetype ? (ENEMY_ARCHETYPES as Record<string, {model: string | null; variantModels?: Readonly<Record<string, string>>} | undefined>)[z.archetype] : undefined;
    if (def?.model && ENEMY_MODEL_FILES[def.model]) s.add(def.model);
    // a family with several approved bodies (the Screacher): exactly the spawn's own variant (a spawn without one: the family's first)
    const vm = def?.variantModels;
    if (vm) { const k = (z.variant !== undefined && vm[z.variant]) || Object.values(vm)[0]; if (k && ENEMY_MODEL_FILES[k]) s.add(k); }
  }
  return [...s].sort();
}

/** `base` (the boot models) + every loaded lazy enemy model (`get` = the lazy library lookup). */
export function withEnemyModels<T>(base: Readonly<Record<string, T | undefined>>, get: (key: string) => T | undefined): Record<string, T | undefined> {
  const out: Record<string, T | undefined> = {...base};
  for (const k of Object.keys(ENEMY_MODEL_FILES)) { const m = get(k); if (m) out[k] = m; }
  return out;
}
