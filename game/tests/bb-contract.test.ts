// Task studio-bb-production-20261112-234540-01: BB's four runtime GLBs against what the GAME's tables say about them — the agreement
// between the cooked bodies (game/public/assets/models/enemy-bb-<look>.glb; tests/bb-asset.test.ts checks the files themselves) and
// the family code. The files are checked-in runtime inputs, so every check here always runs (a missing GLB FAILS).
//  - ENEMY_MODEL_FILES names each file and knows its size;
//  - each file's `enemyBb` extras name the look the roster's variant table expects, at the family's contract height;
//  - the fallback hit sizes of the family (BB_ASSET) are of the size of the measured ones each body carries;
//  - the body the AI and the floor motor reason about (BB_BODY / BB_STATS) fits the real crawling bodies at every runtime size;
//  - through the game's own factory each look gets its own body, a shot at it hits it and a shot at a standing zombie's chest
//    height passes over it; a model that did not load is the counted zombie stand-in, never another look.
import {beforeAll, describe, expect, it} from 'vitest';
import {existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ENEMY_MODEL_FILES, enemyModelKeysFor} from '../src/ai/enemyModels';
import {ENEMY_ARCHETYPES, createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {BB_ASSET, BB_BODY, BB_SCALE, BB_STATS, BB_VARIANTS, BbBrain, type BbVariantId} from '../src/ai/bb';
import {BbActor} from '../src/ai/bbActor';
import type {BbExtras} from '../src/ai/bbClips';
import {nearestEnemyHit} from '../src/combat/enemyRay';
import {BB_IDS, bbGltf, rng, spawnBb} from './helpers/bbBodies';

const pub = (rel: string): string => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const fileOf = (v: BbVariantId): string => pub(ENEMY_MODEL_FILES[BB_VARIANTS[v].model].url);
/** Spawn seeds by the size they give (tests/bb-actor.test.ts): the smallest (0.94) and the largest (1.06). */
const SMALL = 7, BIG = 127773;

const bodies = new Map<BbVariantId, GLTF>();
beforeAll(async () => { for (const v of BB_IDS) bodies.set(v, await bbGltf(v)); }, 120_000);
const extrasOf = (v: BbVariantId): BbExtras => (bodies.get(v)!.scene.userData.enemyBb ?? {}) as BbExtras;
/** The real actor of a look on the floor at the origin, as the game's factory builds it, after a few frames of its idle. */
function actorOf(v: BbVariantId, seed: number): BbActor {
  const made = createEnemyActor(spawnBb(0, 0, v), {[BB_VARIANTS[v].model]: bodies.get(v)}, rng(seed), () => { throw new Error('a zombie stood in for a BB'); });
  const bb = made.actor as BbActor;
  for (let i = 0; i < 20; i++) { bb.animate(1 / 60, 'Idle', 0); bb.syncTransform(); bb.updateVolumes(); }
  return bb;
}

describe('BB: the four bodies against the game\'s tables', () => {
  it('the model table names the four checked-in files and knows their exact sizes', () => {
    expect([...BB_IDS]).toEqual(['lullaby', 'binky', 'teddy', 'changeling']);
    for (const v of BB_IDS) {
      const entry = ENEMY_MODEL_FILES[BB_VARIANTS[v].model];
      expect(entry.url).toBe(`assets/models/enemy-bb-${v}.glb`);
      expect(existsSync(fileOf(v)), `${v}: no stand-in ships in its place`).toBe(true);
      expect(entry.bytes, `${v}: ENEMY_MODEL_FILES bytes`).toBe(statSync(fileOf(v)).size);
      expect(entry.bytes).toBeLessThanOrEqual(3.2e6);
    }
    // the family loads lazily: only the looks a layout's roster placed
    expect(ENEMY_ARCHETYPES.bb.variantModels).toEqual(Object.fromEntries(BB_IDS.map(v => [v, BB_VARIANTS[v].model])));
    expect(enemyModelKeysFor({zombies: [{archetype: 'bb', variant: 'teddy'}, {archetype: 'bb', variant: 'binky'}, {archetype: 'bb', variant: 'teddy'}]})).toEqual(['enemy_bb_binky', 'enemy_bb_teddy']);
    expect(enemyModelKeysFor({zombies: [{}, {archetype: 'zombie'}]}).filter(k => k.startsWith('enemy_bb'))).toEqual([]);
  });

  it('each body says which look it is, at the family\'s height; its measured hit sizes are of the family\'s size', () => {
    for (const v of BB_IDS) {
      const e = extrasOf(v);
      expect([e.variant, e.name], v).toEqual([v, BB_VARIANTS[v].name]);
      expect(e.heightM, v).toBeCloseTo(BB_ASSET.heightM, 2);
      const box = new THREE.Box3().setFromObject(bodies.get(v)!.scene);
      expect(Math.abs(box.min.y), `${v}: feet on the origin`).toBeLessThan(0.03);
      expect(box.max.y, `${v}: standing bind height`).toBeGreaterThan(BB_ASSET.heightM - 0.03);
      expect(box.max.y).toBeLessThan(BB_ASSET.heightM + 0.03);
      // measured per body (a hood, a dress and thin bare arms differ: what is seen is what is hit) but always a small body of the
      // family's size — between about half and twice the family's fallback, never an adult's
      const r = e.hitRadii ?? {}, head = e.head?.radius;
      for (const [k, fallback] of [['torso', BB_ASSET.hitRadii.torso], ['arm', BB_ASSET.hitRadii.arm], ['leg', BB_ASSET.hitRadii.leg]] as const) {
        expect(r[k], `${v}: hitRadii.${k}`).toBeGreaterThanOrEqual(fallback * 0.5);
        expect(r[k], `${v}: hitRadii.${k}`).toBeLessThan(fallback * 2);
      }
      expect(head, `${v}: head radius`).toBeGreaterThan(BB_ASSET.headRadius * 0.6);
      expect(head, `${v}: head radius`).toBeLessThan(BB_ASSET.headRadius * 1.7);
    }
  });

  it('the body the AI and the motor reason about fits the real crawling bodies, smallest to largest', () => {
    expect(BB_STATS.radius).toBe(BB_BODY.radius);
    expect(BB_STATS.height).toBe(BB_BODY.clearM);
    for (const v of BB_IDS) for (const seed of [SMALL, BIG]) {
      const bb = actorOf(v, seed), where = `${v} x${bb.scale.toFixed(2)}`;
      expect(bb.scale).toBeGreaterThanOrEqual(BB_SCALE.min);
      expect(bb.scale).toBeLessThanOrEqual(BB_SCALE.max);
      let top = -Infinity, low = Infinity, side = 0, torso: {x: number; y: number; z: number} | null = null;
      for (const h of bb.hitVolumes) for (const p of [h.a, h.b]) {
        if (!p) continue;
        top = Math.max(top, p.y + h.r); low = Math.min(low, p.y - h.r); side = Math.max(side, Math.abs(p.x) + h.r);
        if (h.part === 'torso' && !torso) torso = p;
      }
      // on all fours: its top is under the headroom the motor asks for, its volumes rest on the floor (not sunk, not floating)
      expect(top, `${where}: top of the crawling body`).toBeLessThan(BB_BODY.clearM);
      expect(top, `${where}: top of the crawling body`).toBeGreaterThan(0.25);
      expect(low, `${where}: lowest volume`).toBeGreaterThan(-0.06);
      expect(low, `${where}: lowest volume`).toBeLessThan(0.06);
      // the AI's body centre is inside the trunk's height; the collider is about the body's half width
      expect(BB_BODY.centreUp).toBeLessThan(top);
      expect(side, `${where}: half width`).toBeLessThan(BB_BODY.radius + 0.12);
      expect(side, `${where}: half width`).toBeGreaterThan(BB_BODY.radius * 0.45);
      // a shot along the floor at the trunk hits it; one at a standing zombie's chest height passes over it
      const hit = nearestEnemyHit({x: torso!.x, y: torso!.y, z: -6}, {x: 0, y: 0, z: 1}, 20, [bb]);
      expect(hit?.enemy, where).toBe(bb);
      expect(nearestEnemyHit({x: 0, y: 1.2, z: -6}, {x: 0, y: 0, z: 1}, 20, [bb]), `${where}: a chest-height shot`).toBeNull();
      expect(nearestEnemyHit({x: 0, y: BB_BODY.clearM + 0.05, z: -6}, {x: 0, y: 0, z: 1}, 20, [bb]), `${where}: a shot just over it`).toBeNull();
      bb.dispose();
    }
  });

  it('the factory: each look its own body and brain; a model that did not load is the counted zombie stand-in, never another look', () => {
    const roots = new Set<string>();
    for (const v of BB_IDS) {
      const bb = actorOf(v, SMALL);
      expect(bb).toBeInstanceOf(BbActor);
      expect(bb.brain).toBeInstanceOf(BbBrain);
      expect([bb.archetype, bb.variant, bb.placesRoot, bb.nonGraphic]).toEqual(['bb', v, true, true]);
      expect(bb.brain.stats).toBe(BB_STATS);
      roots.add(bb.root.name);
      bb.dispose();
    }
    expect(roots.size).toBe(4);
    // Binky's model missing while Teddy's is loaded: a Binky spawn does NOT borrow Teddy's body
    const standIn = {stand: 'in'} as unknown as EnemyActor;
    const made = createEnemyActor(spawnBb(1, 2, 'binky'), {[BB_VARIANTS.teddy.model]: bodies.get('teddy')}, rng(3), () => standIn);
    expect(made.fallback).toBe(true);
    expect(made.actor).toBe(standIn);
  });
});
