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
};

/** The lazy enemy model keys a layout's spawns use (sorted; families without a lazy model contribute none). */
export function enemyModelKeysFor(layout: {zombies: readonly {archetype?: string}[]}): string[] {
  const s = new Set<string>();
  for (const z of layout.zombies) {
    const def = z.archetype ? (ENEMY_ARCHETYPES as Record<string, {model: string | null} | undefined>)[z.archetype] : undefined;
    if (def?.model && ENEMY_MODEL_FILES[def.model]) s.add(def.model);
  }
  return [...s].sort();
}

/** `base` (the boot models) + every loaded lazy enemy model (`get` = the lazy library lookup). */
export function withEnemyModels<T>(base: Readonly<Record<string, T | undefined>>, get: (key: string) => T | undefined): Record<string, T | undefined> {
  const out: Record<string, T | undefined> = {...base};
  for (const k of Object.keys(ENEMY_MODEL_FILES)) { const m = get(k); if (m) out[k] = m; }
  return out;
}
