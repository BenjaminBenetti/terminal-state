// Task studio-bb-production-20261112-234540-01 (lane ACTOR): BB is presented NON-GRAPHICALLY. A small baby-like body gets no wound,
// no blood, no flesh / cloth piece, no tear cue, no torn-off chunk and no skull crack — when it is hit, on the hit that kills it and
// as a corpse, by a bullet, by buckshot and by the knife — while it still takes the hit (the damage, the kill, the headshot count,
// the bullet stopped by its corpse, the ordinary hit confirm). Checked on the four real bodies against the real damage system, the
// real effects and the real physics, with an ORDINARY zombie in the same world that must still show all of it (so the test cannot
// pass by the effects being off).

import * as THREE from 'three';
import fs from 'node:fs';
import {beforeAll, describe, expect, it, vi} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {PhysicsSystem} from '../src/physics/world';
import {DamageSystem} from '../src/damage/system';
import {hasWounds, woundsOf} from '../src/damage/wounds';
import {Effects} from '../src/world/fx';
import type {Sfx} from '../src/audio/sfx';
import {ZombieActor} from '../src/ai/zombieActor';
import {BbActor} from '../src/ai/bbActor';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {corpseFeedable} from '../src/ai/corpseTrait';
import {BB_VARIANTS, type BbVariantId} from '../src/ai/bb';
import {BB_IDS, bbGltf, bbRoom, rng, spawnBb, zombieGltf} from './helpers/bbBodies';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false); // (the effects' sprite textures)

const src = (rel: string): string => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const RIFLE = {damage: 24, pellet: false, weapon: 'rifle'} as const;
const PELLET = {damage: 9, pellet: true, weapon: 'shotgun'} as const;

/** The damage system on a bare room with the REAL effects and physics; every sound cue it asks for is recorded. */
function world() {
  const L = bbRoom();
  const ph = new PhysicsSystem(null);
  ph.build(L);
  const fx = new Effects();
  const bodyHit = vi.spyOn(fx, 'bodyHit'), impact = vi.spyOn(fx, 'impact');
  const cues: {name: string; args: unknown[]}[] = [];
  const sfx = new Proxy({}, {get: (_t, name) => (...args: unknown[]) => { cues.push({name: String(name), args}); }}) as unknown as Sfx;
  const sys = new DamageSystem(fx, sfx);
  const draw = rng(11), draws = {n: 0};
  sys.rand = () => { draws.n++; return draw(); };
  sys.build({...L, areas: [], trenches: [], props: [], name: 't', seed: 1} as unknown as Parameters<DamageSystem['build']>[0], null, [], {physics: ph});
  /** Everything graphic the system has produced so far. */
  const graphic = () => ({
    blood: bodyHit.mock.calls.length, bloodDecals: fx.stats().blood, pieces: sys.debris.spawned, chunks: ph.chunks.stats().flesh, torn: sys.counts.patches + sys.counts.flaps,
    tearCues: cues.filter(c => c.name === 'breakage').length, draws: draws.n,
  });
  return {L, ph, fx, sys, cues, bodyHit, impact, graphic};
}
const NONE = {blood: 0, bloodDecals: 0, pieces: 0, chunks: 0, torn: 0, tearCues: 0, draws: 0};

function makeBb(gltf: GLTF, v: BbVariantId, x: number, z: number, seed: number): BbActor {
  const made = createEnemyActor(spawnBb(x, z, v, 0.4), {[BB_VARIANTS[v].model]: gltf}, rng(seed), () => { throw new Error('a zombie stood in for a BB'); });
  expect(made.fallback).toBe(false);
  expect(made.actor).toBeInstanceOf(BbActor);
  return made.actor as BbActor;
}
const materialsOf = (a: {meshes: readonly THREE.SkinnedMesh[]}): THREE.Material[] => a.meshes.map(m => m.material as THREE.Material);

describe('BB is non-graphic in the damage system (real bodies, real effects, real physics)', () => {
  const bodies = new Map<BbVariantId, GLTF>();
  let zombie: GLTF;
  beforeAll(async () => {
    for (const v of BB_IDS) bodies.set(v, await bbGltf(v));
    zombie = await zombieGltf();
  }, 120_000);

  it('the actor says so; an ordinary zombie does not; a BB corpse is never carried or fed to anything', () => {
    for (const v of BB_IDS) {
      const bb: EnemyActor = makeBb(bodies.get(v)!, v, 6, 6, 3);
      expect(bb.nonGraphic).toBe(true);
      expect(bb.archetype).toBe('bb');
      bb.dispose();
    }
    const z: EnemyActor = new ZombieActor(zombie, {x: 8, z: 6, yaw: 0, type: 'shambler', area: 0}, rng(5));
    expect(z.nonGraphic).toBeUndefined();
    expect(corpseFeedable('bb')).toBe(false); // (not a humanoid corpse: no carry, no chipper)
    expect(corpseFeedable('zombie')).toBe(true);
    z.dispose();
  });

  it.each(BB_IDS)('BB %s: installZombie gives it no wound materials; a head shot, a body shot and buckshot show a dust puff and nothing else', v => {
    const W = world();
    const bb = makeBb(bodies.get(v)!, v, 6, 6, 3);
    const before = materialsOf(bb);
    W.sys.installZombie(bb);
    expect(woundsOf(bb)).toBeUndefined();
    expect(materialsOf(bb)).toEqual(before);
    for (let i = 0; i < before.length; i++) { expect(materialsOf(bb)[i]).toBe(before[i]); expect(hasWounds(before[i])).toBe(false); }
    for (let i = 0; i < 12; i++) { bb.animate(1 / 60, 'Idle', 0); bb.syncTransform(); bb.updateVolumes(); }
    const vols = bb.hitVolumes;
    expect(vols[0].part).toBe('head');
    const fwd = new THREE.Vector3(Math.sin(0.4), 0, Math.cos(0.4)), dir = fwd.clone().negate();
    const head = new THREE.Vector3(vols[0].a.x, vols[0].a.y, vols[0].a.z).addScaledVector(fwd, vols[0].r);
    // --- a rifle round into the head
    W.sys.beginShot();
    const hit = W.sys.hitZombie(bb, head, dir, 'head', RIFLE);
    expect(hit).toMatchObject({object: 'zombie', material: 'cloth', instanceId: null});
    expect(hit.bone).toBeUndefined();
    expect(hit.localPoint).toBeUndefined();
    expect(Math.hypot(hit.point.x - head.x, hit.point.y - head.y, hit.point.z - head.z)).toBeLessThan(1e-9);
    expect(W.graphic()).toEqual(NONE);
    // the mark of the hit: the soft-goods dust puff, back along the shot, no decal, no chips
    expect(W.impact.mock.calls.length).toBe(1);
    const [at, normal, surface, opts] = W.impact.mock.calls[0];
    expect(surface).toBe('soft');
    expect(opts).toEqual({decal: false, chips: 0});
    expect(at.distanceTo(head)).toBeLessThan(1e-9);
    expect(normal.dot(dir)).toBeCloseTo(-1, 6);
    expect(W.fx.stats()).toMatchObject({particles: 3, decals: 0, blood: 0});
    expect(W.cues).toEqual([]);
    expect(W.sys.counts.zombie).toBe(1); // the hit itself is counted as ever
    // --- a body shot, then a full load of buckshot (pellets of one trigger pull)
    const torso = vols.find(x => x.part === 'torso')!;
    const chest = new THREE.Vector3((torso.a.x + torso.b!.x) / 2, (torso.a.y + torso.b!.y) / 2 + torso.r, (torso.a.z + torso.b!.z) / 2);
    W.sys.beginShot();
    W.sys.hitZombie(bb, chest, new THREE.Vector3(0, -1, 0), 'torso', RIFLE);
    W.sys.beginShot();
    for (let p = 0; p < 9; p++) W.sys.hitZombie(bb, chest.clone().add(new THREE.Vector3(0.01 * (p - 4), 0, 0)), new THREE.Vector3(0, -1, 0), p % 3 === 0 ? 'limb' : 'torso', PELLET);
    expect(W.graphic()).toEqual(NONE);
    expect(W.impact.mock.calls.every(c => c[2] === 'soft' && (c[3] as {decal?: boolean}).decal === false)).toBe(true);
    expect(W.fx.stats()).toMatchObject({decals: 0, blood: 0});
    expect(W.sys.stats([bb]).woundsPerZombie).toEqual([0]);
    expect(W.cues).toEqual([]);
    // still the body's own maps, untouched
    for (let i = 0; i < before.length; i++) expect(materialsOf(bb)[i]).toBe(before[i]);
    bb.dispose();
  });

  it('the killing hit and every hit on the corpse (lying, ragdolled) stay clean; the corpse still stops the bullet', () => {
    const W = world();
    const bb = makeBb(bodies.get('teddy')!, 'teddy', 6, 6, 4);
    W.sys.installZombie(bb);
    for (let i = 0; i < 12; i++) { bb.animate(1 / 60, 'Idle', 0); bb.syncTransform(); bb.updateVolumes(); }
    const torso = bb.hitVolumes.find(x => x.part === 'torso')!;
    const mid = new THREE.Vector3((torso.a.x + torso.b!.x) / 2, (torso.a.y + torso.b!.y) / 2, (torso.a.z + torso.b!.z) / 2);
    const down = new THREE.Vector3(0.2, -0.9, 0.1).normalize();
    // the hit that kills it
    bb.brain.damage(999, 6, 9);
    expect(bb.brain.alive).toBe(false);
    W.sys.beginShot();
    expect(W.sys.hitZombie(bb, mid.clone().addScaledVector(down, -torso.r), down, 'torso', RIFLE)).toMatchObject({object: 'zombie', material: 'cloth'});
    expect(W.ph.ragdoll(bb, {dir: {x: down.x, y: down.y, z: down.z}, point: {x: mid.x, y: mid.y, z: mid.z}, strength: 38})).toBe(true);
    expect(bb.ragdolled).toBe(true);
    expect(bb.updateVolumes()).toEqual([]); // (dead: no live hit volumes — the corpse volumes below)
    for (let i = 0; i < 90; i++) W.ph.update(1 / 60);
    // shoot the corpse where it lies now: the bullet is stopped by its own small volumes
    bb.root.updateMatrixWorld(true);
    const at = bb.bone('Chest')!.getWorldPosition(new THREE.Vector3());
    const from = at.clone().add(new THREE.Vector3(0.5, 1.1, 0.3)), d = at.clone().sub(from).normalize();
    for (let shot = 0; shot < 6; shot++) {
      const c = W.sys.corpseHit([bb], from, d, 5);
      expect(c).not.toBeNull();
      expect(c!.z).toBe(bb);
      W.sys.beginShot();
      const info = W.sys.hitZombie(bb, from.clone().addScaledVector(d, c!.t), d, c!.part, shot % 2 ? PELLET : RIFLE, true);
      expect(info).toMatchObject({object: 'corpse', material: 'cloth'});
    }
    expect(W.graphic()).toEqual(NONE);
    expect(W.fx.stats()).toMatchObject({decals: 0, blood: 0});
    expect(W.cues).toEqual([]);
    expect(woundsOf(bb)).toBeUndefined();
    expect(W.sys.counts).toMatchObject({zombie: 1, corpse: 6, patches: 0, flaps: 0});
    bb.dispose();
  });

  it('an ordinary zombie in the same world still shows all of it (the BB beside it shows none)', () => {
    const W = world();
    const bb = makeBb(bodies.get('lullaby')!, 'lullaby', 6, 6, 3);
    const z = new ZombieActor(zombie, {x: 12, z: 6, yaw: 0.4, type: 'shambler', area: 0}, rng(5));
    W.sys.installZombie(bb);
    W.sys.installZombie(z);
    expect(woundsOf(z)).toBeDefined();
    let wounded = 0;
    z.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && hasWounds(m.material as THREE.Material)) wounded++; });
    expect(wounded).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) {
      bb.animate(1 / 60, 'Idle', 0); bb.syncTransform(); bb.updateVolumes();
      z.animate(1 / 60, 'Idle', 0); z.syncTransform(); z.updateVolumes();
    }
    // the same rifle round into each chest
    const bt = bb.hitVolumes.find(x => x.part === 'torso')!;
    W.sys.beginShot();
    W.sys.hitZombie(bb, new THREE.Vector3(bt.a.x, bt.a.y + bt.r, bt.a.z), new THREE.Vector3(0, -1, 0), 'torso', RIFLE);
    expect(W.graphic()).toEqual(NONE);
    const fwd = new THREE.Vector3(Math.sin(z.brain.yaw), 0, Math.cos(z.brain.yaw));
    const chest = z.bone('Spine')!.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0));
    W.sys.beginShot();
    const hit = W.sys.hitZombie(z, chest.clone().addScaledVector(fwd, 0.22), fwd.clone().negate(), 'torso', RIFLE);
    const g = W.graphic();
    expect(hit.bone).toBeDefined();
    expect(woundsOf(z)!.count).toBe(1);
    expect(g.blood).toBe(1);        // the blood spurt
    expect(g.pieces).toBeGreaterThanOrEqual(1); // flesh pieces
    expect(g.torn).toBe(1);         // a piece torn off the posed surface ...
    expect(g.chunks).toBe(1);       // ... as a physical chunk
    expect(g.draws).toBeGreaterThan(0);
    expect(W.sys.stats([bb, z]).woundsPerZombie).toEqual([0, 1]);
    bb.dispose();
    z.dispose();
  });

  it('its hit blink is a neutral pale flash (not the red of a bleeding body) on its own material copies', () => {
    const a = makeBb(bodies.get('binky')!, 'binky', 6, 6, 3), b = makeBb(bodies.get('binky')!, 'binky', 7, 6, 4);
    a.hitFlash = 1;
    a.animate(1 / 600, 'Idle', 0);
    b.animate(1 / 600, 'Idle', 0);
    for (const m of materialsOf(a) as THREE.MeshStandardMaterial[]) {
      expect(m.emissive.g).toBeGreaterThan(0.2);
      expect(Math.abs(m.emissive.r - m.emissive.g)).toBeLessThan(0.02); // grey, not red
      expect(m.emissive.b).toBeLessThanOrEqual(m.emissive.g);
    }
    // another BB of the same look does not blink with it, and the shared GLB template is untouched
    for (const m of materialsOf(b) as THREE.MeshStandardMaterial[]) expect(m.emissive.getHex()).toBe(0);
    for (let i = 0; i < 20; i++) a.animate(1 / 30, 'Idle', 0);
    for (const m of materialsOf(a) as THREE.MeshStandardMaterial[]) expect(m.emissive.getHex()).toBe(0);
    a.dispose();
    b.dispose();
  });
});

describe('BB is non-graphic in the game\'s hit feedback (game.ts)', () => {
  it('the skull crack is never asked for on a non-graphic body; the confirm, the damage and the headshot count are as for anyone', () => {
    const game = src('game.ts');
    // guns: the crack only for a confirmed head hit on a graphic body; the headshot still counts on the next line
    expect(game).toMatch(/this\.sfx\.hitConfirm\(e\.point\.x, e\.point\.y, e\.point\.z, z, e\.head && !z\.nonGraphic\);[^\n]*\n\s*if \(e\.head\) this\.stats\.headshots\+\+;/);
    // the knife
    expect(game).toMatch(/this\.sfx\.hitConfirm\(point\.x, point\.y, point\.z, z, res\.part === 'head' && !z\.nonGraphic\);/);
    // those are the only two confirms; and no body hit of the game goes round the damage-system entry that honours the flag (guns,
    // corpses, the knife and the turret all call hitZombie; nothing calls the blood spurt or installs wounds directly)
    expect(game.match(/hitConfirm\(/g)?.length).toBe(2);
    expect(game.match(/\.(bodyHit|installWounds)\(/g) ?? []).toEqual([]);
    const sys = src('damage/system.ts');
    expect(sys).toMatch(/installZombie\(z: WoundableActor & \{readonly nonGraphic\?: boolean\}\): void \{\n\s*if \(z\.nonGraphic\) return;/);
    expect(sys.match(/this\.fx\?\.bodyHit\(/g)?.length).toBe(1);
    // ... and hitZombie turns away before the wound, the blood and the pieces
    const entry = sys.indexOf('hitZombie(z: DamageZombie'), guard = sys.indexOf('if (z.nonGraphic) {', entry);
    expect(entry).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(entry);
    for (const graphic of ['woundsOf(z)', 'this.fx?.bodyHit(', 'this.debris.spawn(', "breakage('fleshTear'", 'this.tearChunk(']) expect(sys.indexOf(graphic, entry), graphic).toBeGreaterThan(guard);
  });
});
