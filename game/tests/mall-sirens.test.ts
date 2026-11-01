// Task studio-beta-mall-round3-20261031-01 (lane ENEMY, R8). User (mall round 3): "I've done a bunch of mall runs, and not found a siren
// ever, confirm that siren can spawn on this level. with chance similar to office space, i.e. average 2 per mall."
//
// 1. CONFIRMED the runtime path end to end on a REAL generated mall (Node, as far as the spawn path goes without a renderer): the
//    profile places dormant Sirens on the retail floors -> the section's lazy model keys (game.ts modelKeysFor: enemyModelKeysFor +
//    selectLevelKeys over the game's catalogue) carry 'enemy_siren' (a shared file, never 'foreign' to the mall), the file is in
//    game/public and in the release allowlist under the same literal path the bundle references (so the CI artifact ships it) ->
//    a fresh run spawns every index (run/memory enemiesToSpawn) -> SirenSystem.skip is false with her model loaded ->
//    createEnemyActor builds a SirenActor from the REAL enemy-siren.glb (textures stripped: no image decoder in Node) -> adopt()
//    leaves her DORMANT with her vein patch, standing on her retail floor. Nothing culls / replaces her (actors are never registered
//    with the level culler). The cause of "never found one" was rarity: mean 0.79 per mall, 37.5 % of malls none (48-mall census).
// 2. The retune (ai/spawnTables.ts MALL_RING_PLACEMENT / MALL_SIREN_ELIGIBILITY cap 4 / MALL_SIREN_SPACING 24 m): a 12-mall sample of
//    the 48-mall census seeds — the full census (mean 1.96, 8.3 % none, max 4) is in lanes/ENEMY-evidence in the task folder.

import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import {MALL_SIREN_ELIGIBILITY, MALL_SIREN_SPACING, MALL_SPAWN_PROFILE, eligibilityFailure, spawnContextOf} from '../src/ai/spawnTables';
import {ENEMY_MODEL_FILES, enemyModelKeysFor, withEnemyModels} from '../src/ai/enemyModels';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {P7_FILES, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {officeModelKeysFor} from '../src/gen/office/index';
import {SIREN_MODEL_KEY, SirenActor} from '../src/ai/sirenActor';
import {SirenBrain} from '../src/ai/siren';
import {SirenSystem, type SirenHost} from '../src/ai/sirenSystem';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {RunState} from '../src/run/runState';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import type {Sfx} from '../src/audio/sfx';

const has = (LEVEL_IDS as readonly string[]).includes('mall');
/** The first 12 of the 48-mall census seeds (tuning / validation halves alternate). */
const SEEDS = Array.from({length: 12}, (_, k) => k % 2 === 0 ? 9100 + 104729 * (k >> 1) : 50021 + 7919 * (k >> 1));
/** The game's lazy model catalogue (game.ts propModels; the annex genset key is irrelevant here). */
const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...ENEMY_MODEL_FILES, ...MALL_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const PUB = (rel: string) => fileURLToPath(new URL(`../public/${rel}`, import.meta.url));
const mallOf = (seed: number): StationLayout => LEVELS.mall.generate(LEVELS.mall.entry, {levelSeed: seed, startWeapon: 'pistol'});

describe('mall Sirens', () => {
  const layouts = new Map<number, StationLayout>();
  const get = (seed: number) => { let l = layouts.get(seed); if (!l) layouts.set(seed, (l = mallOf(seed))); return l; };
  let real: GLTF;
  beforeAll(async () => {
    const io = new NodeIO();
    const doc = await io.read(PUB(ENEMY_MODEL_FILES[SIREN_MODEL_KEY].url));
    for (const t of doc.getRoot().listTextures()) t.dispose();
    const bin = await io.writeBinary(doc);
    real = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  });

  (has ? it : it.skip)('the runtime path on a real generated mall: placed -> model key loaded -> spawned -> a dormant Siren actor on her retail floor', () => {
    const seed = SEEDS.find(s => get(s).zombies.filter(z => z.archetype === 'siren').length >= 2)!;
    expect(seed, 'a census mall with at least two Sirens').toBeDefined();
    const l = get(seed), L = levelsOf(l), P = MALL_SPAWN_PROFILE;
    const sirens = l.zombies.map((z, i) => ({z, i})).filter(e => e.z.archetype === 'siren');
    // the section's lazy keys exactly as Game.modelKeysFor selects them: 'enemy_siren' requested, never rejected as another level's
    const sel = selectLevelKeys('mall', [...new Set([...p7ModelKeysFor(l), ...officeModelKeysFor(l as never), ...enemyModelKeysFor(l)])], CATALOGUE);
    expect(enemyModelKeysFor(l)).toContain(SIREN_MODEL_KEY);
    expect(sel.keys).toContain(SIREN_MODEL_KEY);
    expect(sel.foreign).not.toContain(SIREN_MODEL_KEY);
    // the file ships: in game/public with the allowlisted size / path, the path literal the bundle references (package-ci keeps a model
    // whose path appears in the code)
    const url = ENEMY_MODEL_FILES[SIREN_MODEL_KEY].url;
    const allow = (JSON.parse(readFileSync(fileURLToPath(new URL('../../tools/release/public-inputs.json', import.meta.url)), 'utf8')) as {files: {path: string; bytes: number}[]}).files;
    const entry = allow.find(f => f.path === url);
    expect(entry, 'release allowlist').toBeDefined();
    expect(statSync(PUB(url)).size).toBe(entry!.bytes);
    expect(readFileSync(fileURLToPath(new URL('../src/ai/enemyModels.ts', import.meta.url)), 'utf8')).toContain(`'${url}'`);
    // a fresh run spawns every placed index (killed ones only are skipped)
    const live = new Set(enemiesToSpawn(l.zombies.length, createMemory({level: 'mall', section: 'main'})));
    // the game's build loop: sirens.skip (model loaded: false) -> spawnEnemy (createEnemyActor with the lazy models) -> adopt
    const run = new RunState({seeds: {subway: 1, office: 2, mall: seed, reactor: 4}, start: {level: 'mall', section: 'main'}});
    const host: SirenHost = {
      scene: new THREE.Group(), levels: L, layout: {seed: l.seed, zombies: l.zombies as ZombieSpawn[]}, run, frameHooks: [], sectionHooks: [],
      warmRegistry: {addPool: () => {}}, propModels: {get: k => (k === SIREN_MODEL_KEY ? real : undefined)}, sfx: {sirenHumStop: () => {}} as unknown as Sfx,
    };
    const sys = new SirenSystem(host).install();
    let seq = 7;
    const rand = () => ((seq = (seq * 16807) % 2147483647) / 2147483647);
    const actors: EnemyActor[] = [];
    for (const {z, i} of sirens) {
      expect(live.has(i)).toBe(true);
      expect(sys.skip(z)).toBe(false);
      const {actor, fallback} = createEnemyActor(z as ZombieSpawn, withEnemyModels({}, k => host.propModels.get(k)), rand, () => { throw new Error('a Siren never becomes a zombie stand-in'); });
      expect(fallback).toBe(false);
      expect(actor).toBeInstanceOf(SirenActor);
      expect((actor as SirenActor).hasRig).toBe(true);
      const lv = z.level ?? 0, y = z.y ?? l.levels[lv].grid.floorAt(z.x, z.z); // spawnEnemy's height rule
      actor.brain.y = actor.root.position.y = y;
      sys.adopt(actor, z as ZombieSpawn, i);
      const b = actor.brain as SirenBrain;
      expect(b).toBeInstanceOf(SirenBrain);
      expect(b.dormant).toBe(true);
      expect(b.state).toBe('dormant');
      // her place: a retail floor (never the station storey), an eligible shop / stock-room slot of the 'ring' context, supported floor
      expect(lv).toBeGreaterThanOrEqual(1);
      expect(spawnContextOf(l, P, i)).toBe('ring');
      expect(eligibilityFailure(MALL_SIREN_ELIGIBILITY, l, z, 'ring')).toBeNull();
      const s = L.supportIn(z.x, z.z, y + 0.05, 0.45);
      expect(s?.level).toBe(lv);
      actors.push(actor);
    }
    expect(sys.veins.count).toBe(sirens.length); // each dormant Siren has her ground-corruption patch
    expect(sys.skippedHere).toBe(0);
    for (const a of actors) a.dispose();
  });

  (has ? it : it.skip)('the retune: about two Sirens per mall like the Office (12-mall sample of the census), never the station / annex / hordes, <= 4, 24 m apart', () => {
    const counts: number[] = [], storeys: number[] = [];
    for (const seed of SEEDS) {
      const l = get(seed);
      const sirens = l.zombies.map((z, i) => ({z, i})).filter(e => e.z.archetype === 'siren');
      counts.push(sirens.length);
      for (const {z, i} of sirens) {
        storeys.push(z.level ?? 0);
        expect(z.horde).toBeUndefined();
        expect(spawnContextOf(l, MALL_SPAWN_PROFILE, i)).toBe('ring');
      }
      expect(sirens.length).toBeLessThanOrEqual(MALL_SIREN_ELIGIBILITY.maxPerLevel!);
      for (let a = 0; a < sirens.length; a++) for (let b = a + 1; b < sirens.length; b++) {
        const p = sirens[a].z, q = sirens[b].z;
        expect(Math.hypot(p.x - q.x, (p.y ?? 0) - (q.y ?? 0), p.z - q.z)).toBeGreaterThanOrEqual(MALL_SIREN_SPACING.spacingM);
      }
    }
    const mean = counts.reduce((s, n) => s + n, 0) / counts.length, none = counts.filter(n => n === 0).length;
    process.stdout.write(`\n[mall-sirens] 12 malls: Sirens per mall ${counts.join(' ')} (mean ${mean.toFixed(2)}, none ${none}); storeys ${[1, 2, 3].map(k => storeys.filter(s => s === k).length).join(' / ')}\n`);
    // (before this round: 0.79 mean / 37.5 % none on the 48-mall census; the Office 1.97 / 12.5 %)
    expect(mean).toBeGreaterThanOrEqual(1.5);
    expect(mean).toBeLessThanOrEqual(2.8);
    expect(none).toBeLessThanOrEqual(2);
    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
  });
});
