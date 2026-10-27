// Iteration 07 (Lane Q): the field-notes rat/dog creature — derivative rig/skin/clip validity,
// archetype registry, ~5 % seed-weighted spawn share, brain (no ladders, lunge), quadruped hit
// volumes, wounds on the generic actor surface and the quadruped ragdoll building and settling.

import {describe, expect, it, beforeAll} from 'vitest';
import * as THREE from 'three';
import {readFileSync, existsSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {CELL, FLOOR, Grid, PathFinder, SOLID, VOID} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {moveZombie} from '../src/ai/motor';
import {MODEL_FILES} from '../src/assets/manifest';
import {CreatureActor, CreatureBrain, RATDOG_STATS, LUNGE} from '../src/ai/creatureActor';
import {createEnemyActor, ENEMY_ARCHETYPES, enemyCues, RATDOG_CUES, ZOMBIE_CUES, archetypeOf, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_POOL, assignEnemyArchetypes, enemyRoll, pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {ZOMBIE_STATS, type BrainWorld} from '../src/ai/brain';
import {ARCHETYPES, generateStation} from '../src/gen/station';
import type {ZombieSpawn} from '../src/gen/station';
import {PhysicsSystem, killImpulseStrength} from '../src/physics/world';
import {installWounds, woundsOf} from '../src/damage/wounds';
import {DamageSystem} from '../src/damage/system';
import {raySphere, rayCapsule} from '../src/combat/hitscan';
import {CUES} from '../src/audio/bank';
import {CLIP_MANIFEST_I07Q} from '../src/audio/manifest.iteration07q.generated';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const MASTER_SHA = '03503553ac5b7328e589785cea54e5261280148c5e2cd7a75340e728073d07ec';
const prov = JSON.parse(readFileSync(pub('assets/derivatives/creature-ratdog.json'), 'utf8'));

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO();
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const spawnAt = (x: number, z: number, yaw = 0, archetype: 'ratdog' | 'zombie' = 'ratdog'): ZombieSpawn => ({x, z, yaw, type: 'shambler', area: 0, archetype});
const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

let gltf: GLTF;
beforeAll(async () => { gltf = await loadStripped(MODEL_FILES.creature_ratdog.url); });

describe('rat/dog derivative (creature-ratdog.glb)', () => {
  it('is a new derivative of the read-only quadruped-02 master with provenance', () => {
    expect(prov.source.id).toBe('quadruped-02');
    expect(prov.source.sha256).toBe(MASTER_SHA);
    expect(prov.source.unrigged).toBe(true);
    expect(prov.approval).toMatchObject({approved: false, gameReady: false});
    const bytes = readFileSync(pub(MODEL_FILES.creature_ratdog.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(prov.output.sha256);
    expect(bytes.length).toBe(prov.output.bytes);
    expect(Math.abs(MODEL_FILES.creature_ratdog.bytes - bytes.length) / bytes.length).toBeLessThan(0.1);
    expect(prov.output.triangles).toBeGreaterThanOrEqual(8000);
    expect(prov.output.triangles).toBeLessThanOrEqual(15000);
    // the master is never written by the pipeline (present in the packaged board snapshot)
    const master = fileURLToPath(new URL('../../public/vision-board/models/84cdf0afae9346489ac2f188c37f12de.glb', import.meta.url));
    if (existsSync(master)) expect(statSync(master).size).toBe(96884108);
  });

  it('has a quadruped skeleton, normalised 4-influence skin and the six clips', async () => {
    const io = new NodeIO();
    const doc = await io.read(pub(MODEL_FILES.creature_ratdog.url));
    const node = doc.getRoot().listNodes().find(n => n.getName() === 'RatdogBody')!;
    const skin = node.getSkin()!;
    const names = skin.listJoints().map(j => j.getName());
    expect(names.length).toBe(25);
    for (const n of ['Root', 'Hips', 'Spine1', 'Spine2', 'Chest', 'Neck', 'Head', 'Jaw', 'Tail1', 'Tail5', 'L_FrontUpper', 'L_FrontLower', 'L_FrontFoot', 'R_HindUpper', 'R_HindLower', 'R_HindFoot']) expect(names).toContain(n);
    // bind rotations identity (ragdoll axes are bind/model vectors)
    for (const j of skin.listJoints()) expect(j.getRotation()).toEqual([0, 0, 0, 1]);
    const prim = node.getMesh()!.listPrimitives()[0];
    const W = prim.getAttribute('WEIGHTS_0')!.getArray()!, J = prim.getAttribute('JOINTS_0')!.getArray()!;
    let bad = 0;
    const used = new Set<number>();
    for (let i = 0; i < W.length; i += 4) {
      const s = W[i] + W[i + 1] + W[i + 2] + W[i + 3];
      if (Math.abs(s - 1) > 1e-3) bad++;
      for (let k = 0; k < 4; k++) if (W[i + k] > 0.05) used.add(J[i + k]);
    }
    expect(bad).toBe(0);
    // every deforming bone drives some skin (Root never does)
    expect(used.has(names.indexOf('Root'))).toBe(false);
    for (const n of names.filter(n => n !== 'Root')) expect(used.has(names.indexOf(n)), n).toBe(true);
    const mat = prim.getMaterial()!;
    expect(mat.getBaseColorTexture()?.getSize()).toEqual([1024, 1024]);
    expect(mat.getNormalTexture()?.getSize()).toEqual([512, 512]);
    expect(mat.getMetallicRoughnessTexture()?.getSize()).toEqual([512, 512]);
    const clips = doc.getRoot().listAnimations().map(a => a.getName());
    expect(clips.sort()).toEqual(['Attack', 'Death', 'Hit', 'Idle', 'Run', 'Walk']);
    // authored quadruped gaits and floor contact (CPU-skinned verification in the provenance)
    expect(prov.clips.gaits.Walk.phase).toMatchObject({L_Hind: 0, L_Front: 0.25, R_Hind: 0.5, R_Front: 0.75});
    for (const c of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']) expect(prov.clips.verify[c].framesBelowMinus1cm, c).toBe(0);
    expect(prov.clips.verify.Walk.groundSpeed).toBeGreaterThan(0.4);
    expect(prov.clips.verify.Run.groundSpeed).toBeGreaterThan(prov.clips.verify.Walk.groundSpeed * 2.5);
    // a low quadruped: top of the shoulders ~0.64 m, longer than tall
    const b = prov.output && gltf.scene.userData.creatureRatdog.boundsM;
    expect(b.max[1]).toBeGreaterThan(0.55);
    expect(b.max[1]).toBeLessThan(0.75);
    expect(b.max[2] - b.min[2]).toBeGreaterThan(1.5 * b.max[1]);
  });
});

describe('enemy archetype registry + spawn weights', () => {
  it('pool is level-generic and ~5 % rat/dog', () => {
    const total = ENEMY_POOL.reduce((s, [, w]) => s + w, 0);
    expect(ENEMY_POOL.find(([id]) => id === 'ratdog')![1] / total).toBeCloseTo(0.05, 5);
    expect(ENEMY_ARCHETYPES.ratdog.climbsLadders).toBe(false);
    expect(ENEMY_ARCHETYPES.ratdog.dropsIntoTrackBed).toBe(true);
  });

  it('per-spawn seed-weighted draw: aggregate share ~5 % of TOTAL enemies, deterministic, many stations with none', () => {
    let rat = 0, n = 0, zeroStations = 0, multi = 0;
    const seeds = 6000;
    for (let s = 0; s < seeds; s++) {
      const seed = (s * 2654435761) >>> 0;
      const count = 11 + (s % 6); // the generator places 11..16 spawns
      const layout = {seed, zombies: Array.from({length: count}, () => ({} as {archetype?: 'zombie' | 'ratdog'}))};
      const k = assignEnemyArchetypes(layout);
      rat += k; n += count;
      if (k === 0) zeroStations++;
      if (k > 1) multi++;
      if (s < 50) { // deterministic per seed / index
        const again = {seed, zombies: Array.from({length: count}, () => ({} as {archetype?: 'zombie' | 'ratdog'}))};
        assignEnemyArchetypes(again);
        expect(again.zombies.map(z => z.archetype)).toEqual(layout.zombies.map(z => z.archetype));
      }
    }
    const share = rat / n;
    console.log(`[creature.test] rat/dog share ${(share * 100).toFixed(2)} % of ${n} enemies over ${seeds} seeds; stations with none ${(zeroStations / seeds * 100).toFixed(1)} %, with 2+ ${(multi / seeds * 100).toFixed(1)} %`);
    expect(Math.abs(share - 0.05)).toBeLessThan(0.004);
    expect(zeroStations / seeds).toBeGreaterThan(0.4); // 0.95^13.5 ~ 0.5 — not forced into every map
    expect(multi / seeds).toBeGreaterThan(0.05);
    // the roll is uniform and independent of the index
    let lo = 0;
    for (let i = 0; i < 20000; i++) if (enemyRoll(12345 + (i >> 4), i & 15) < 0.05) lo++;
    expect(lo / 20000).toBeGreaterThan(0.042);
    expect(lo / 20000).toBeLessThan(0.058);
    expect(pickEnemyArchetype(7, 3, [['ratdog', 1]])).toBe('ratdog');
  });

  it('generated stations tag every spawn; replacements keep the total enemy count', () => {
    let tagged = 0, rat = 0, total = 0;
    for (let s = 1; s <= 12; s++) {
      const L = generateStation(s * 7919);
      for (const z of L.zombies) { if (z.archetype) tagged++; if (z.archetype === 'ratdog') rat++; total++; }
      expect(L.zombies.length).toBeGreaterThanOrEqual(8);
      const again = generateStation(s * 7919);
      expect(again.zombies.map(z => z.archetype)).toEqual(L.zombies.map(z => z.archetype));
    }
    expect(tagged).toBe(total);
    expect(rat).toBeLessThan(total * 0.25);
  });

  it('createEnemyActor builds the rat/dog (or a zombie stand-in when its model is missing)', () => {
    const zombie = () => ({stub: true}) as unknown as EnemyActor;
    const a = createEnemyActor(spawnAt(1, 1), {creature_ratdog: gltf}, rng(), zombie);
    expect(a.actor).toBeInstanceOf(CreatureActor);
    expect(a.fallback).toBe(false);
    expect(archetypeOf(a.actor)).toBe('ratdog');
    expect(enemyCues(a.actor)).toBe(RATDOG_CUES);
    const b = createEnemyActor(spawnAt(1, 1), {}, rng(), zombie);
    expect(b.fallback).toBe(true);
    const c = createEnemyActor(spawnAt(1, 1, 0, 'zombie'), {creature_ratdog: gltf}, rng(), zombie);
    expect((c.actor as unknown as {stub: boolean}).stub).toBe(true);
    expect(enemyCues(c.actor)).toBe(ZOMBIE_CUES);
  });
});

describe('rat/dog actor', () => {
  it('rigged, animated, quadruped hit volumes smaller than a zombie\'s, gone when dead', () => {
    const c = new CreatureActor(gltf, spawnAt(4, 5, 0), rng(3));
    expect(c.hasRig).toBe(true);
    c.root.position.y = 0;
    for (let i = 0; i < 10; i++) c.animate(1 / 30, 'Walk', 0.7);
    const vols = c.updateVolumes();
    expect(vols.length).toBe(13);
    expect(vols.filter(v => v.part === 'head').length).toBe(2);
    expect(vols.filter(v => v.part === 'limb').length).toBe(9);
    for (const v of vols) { expect(v.r).toBeLessThan(0.15); expect(v.a.y).toBeGreaterThan(-0.05); expect(v.a.y).toBeLessThan(0.75); }
    // head in front (+Z at yaw 0), torso capsule horizontal and low
    const head = vols.find(v => v.part === 'head')!;
    expect(head.a.z).toBeGreaterThan(5.2);
    const torso = vols.find(v => v.part === 'torso')!;
    expect(Math.abs(torso.a.y - torso.b!.y)).toBeLessThan(0.2);
    expect(Math.abs(torso.a.z - torso.b!.z)).toBeGreaterThan(0.3);
    // a shot fired at its face from the front hits the head first; a shot at zombie chest height misses it
    const o = {x: 4, y: head.a.y, z: 8}, d = {x: 0, y: 0, z: -1};
    let best = Infinity, part = '';
    for (const v of vols) { const t = v.b ? rayCapsule(o, d, v.a, v.b, v.r) : raySphere(o, d, v.a, v.r); if (t < best) { best = t; part = v.part; } }
    expect(part).toBe('head');
    const high = {x: 4, y: 1.3, z: 8};
    expect(vols.every(v => !Number.isFinite(v.b ? rayCapsule(high, d, v.a, v.b, v.r) : raySphere(high, d, v.a, v.r)))).toBe(true);
    // corpse volumes for the damage system
    expect(c.corpseVolumes().length).toBe(13);
    c.brain.damage(999, 4, 8);
    expect(c.updateVolumes().length).toBe(0);
    c.dispose();
  });

  it('brain: quadruped stats, never paths over ladders, lunges into the bite', () => {
    expect(RATDOG_STATS.hp).toBeLessThan(ZOMBIE_STATS.shambler.hp);
    expect(RATDOG_STATS.chaseSpeed).toBeGreaterThan(ZOMBIE_STATS.shambler.chaseSpeed);
    expect(RATDOG_STATS.radius).toBeLessThan(ZOMBIE_STATS.shambler.radius);
    const b = new CreatureBrain(0, 0, 0);
    const calls: ({drops?: boolean; noLinks?: boolean} | undefined)[] = [];
    let px = 0, pz = 6;
    const w: BrainWorld = {
      get px() { return px; }, get pz() { return pz; }, playerAlive: true,
      los: () => true, walkClear: () => false,
      findPath: (_ax, _az, bx, bz, opts) => { calls.push(opts); return [[bx, bz]]; },
      randomNear: () => null, rand: () => 0.5, py: 0,
    };
    for (let i = 0; i < 30; i++) { const out = b.update(1 / 30, w); b.x += out.dirX * out.speed / 30; b.z += out.dirZ * out.speed / 30; if (out.face !== null) b.yaw = out.face; }
    expect(b.state).toBe('chase');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(o => o?.noLinks === true)).toBe(true);
    // close in: the attack starts and the brain lunges forward during the wind-up
    px = b.x + Math.sin(b.yaw) * 1.0; pz = b.z + Math.cos(b.yaw) * 1.0;
    let lunged = 0, attacked = false;
    for (let i = 0; i < 60; i++) { const out = b.update(1 / 60, w); if (b.state === 'attack') attacked = true; if (b.state === 'attack' && out.speed >= LUNGE.speed - 1e-6) lunged++; }
    expect(attacked).toBe(true);
    expect(lunged).toBeGreaterThan(3);
  });

  it('wounds install on the generic actor surface (flesh class on the creature body)', () => {
    const c = new CreatureActor(gltf, spawnAt(0, 0, 0), rng(5));
    c.root.position.y = 0;
    c.animate(1 / 30, 'Idle', 0);
    const vols = c.updateVolumes();
    const w = installWounds(c);
    expect(w.layers.length).toBe(1);
    expect(w.layers[0].cls).toBe('flesh');
    const t = vols.find(v => v.part === 'torso')!;
    const p = new THREE.Vector3((t.a.x + t.b!.x) / 2 + 0.3, (t.a.y + t.b!.y) / 2, (t.a.z + t.b!.z) / 2);
    const r = w.add({point: p, dir: new THREE.Vector3(-1, 0, 0), part: 'torso', damage: 24});
    expect(r).not.toBeNull();
    expect(r!.cls).toBe('flesh');
    expect(w.count).toBe(1);
    c.dispose();
  });
});

describe('rat/dog traversal on generated stations (no ladders, drops into the track bed)', () => {
  const DT = 1 / 60;
  const layout = generateStation(9001, {archetype: ARCHETYPES[0]}); // = traversal.test.ts PER_ARCH[0]
  const world = (px: number, pz: number, py: number, pf: PathFinder): BrainWorld => {
    let rnd = 11;
    const g = layout.grid;
    return {
      px, pz, py, playerAlive: true,
      los: (ax, az, bx, bz) => g.lineOfSight(ax, az, bx, bz),
      walkClear: (ax, az, bx, bz, r) => g.walkLineClearH(ax, az, bx, bz, r),
      findPath: (ax, az, bx, bz, o) => pf.find(ax, az, bx, bz, 0.34, 26000, o),
      randomNear: () => null,
      rand: () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647),
      ladder: id => layout.traversal.ladders[id],
    };
  };

  it('chases a player into the track bed by dropping off the platform edge', () => {
    expect(layout.traversal.ladders.length).toBeGreaterThan(0);
    const g = layout.grid, props = new PropIndex(g, layout.props), pf = new PathFinder(g);
    const lad = layout.traversal.ladders[2] ?? layout.traversal.ladders[0];
    const px = lad.x + 12, pz = lad.bottom.z - lad.dir * 1.2, py = g.floorAt(px, pz);
    const b = new CreatureBrain(px, lad.top.z + lad.dir * 0.4, 0);
    b.y = 0;
    const w = world(px, pz, py, pf);
    b.hear(px, pz, 50);
    let landed = false, climbed = false, hitFromAbove = false;
    for (let f = 0; f < 60 * 10; f++) {
      const out = b.update(DT, w);
      if (b.climbing) climbed = true;
      if (out.attackHit && b.y > -0.5) hitFromAbove = true;
      moveZombie(b, out, DT, g, props);
      if (b.y < py + 0.05) landed = true;
      if (landed && Math.hypot(b.x - px, b.z - pz) < 1.2) break;
    }
    expect(climbed).toBe(false);
    expect(hitFromAbove).toBe(false);
    expect(landed).toBe(true);
    expect(Math.hypot(b.x - px, b.z - pz)).toBeLessThan(1.3);
  });

  it('in the track bed it never climbs a rescue ladder after a player on the platform', () => {
    expect(layout.traversal.ladders.length).toBeGreaterThan(0);
    const g = layout.grid, props = new PropIndex(g, layout.props), pf = new PathFinder(g);
    const lad = layout.traversal.ladders[1] ?? layout.traversal.ladders[0];
    const b = new CreatureBrain(lad.x + 7, lad.bottom.z, 0);
    b.y = g.floorAt(b.x, b.z);
    const bedY = b.y;
    const px = lad.top.x - 3, pz = lad.top.z + lad.dir * 1.5;
    const w = world(px, pz, 0, pf);
    b.hear(px, pz, 50);
    let climbed = false, maxY = -Infinity;
    for (let f = 0; f < 60 * 15; f++) {
      const out = b.update(DT, w);
      if (b.climbing) climbed = true;
      moveZombie(b, out, DT, g, props);
      maxY = Math.max(maxY, b.y);
    }
    expect(bedY).toBeLessThan(-0.5);
    expect(climbed).toBe(false);
    // a zombie climbs out here (traversal.test.ts); the quadruped stays in the bed unless a ladder-free route exists
    const ladderFree = pf.find(lad.x + 7, lad.bottom.z, px, pz, 0.34, 26000, {drops: true, noLinks: true});
    console.log(`[creature.test] bed chase: ladder-free route ${ladderFree ? 'exists' : 'none'}; max feet y ${maxY.toFixed(2)} (bed ${bedY.toFixed(2)})`);
    if (!ladderFree) expect(maxY).toBeLessThan(bedY + 0.3);
  });
});

/** 24 x 16 m room with a track-bed trench (same as the zombie ragdoll test). */
function testLayout() {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : y >= 24 ? VOID : FLOOR);
  return {grid: g, props: [], trench: {floorY: -1.15}};
}

describe('quadruped ragdoll (Lane K generic rig hook)', () => {
  it('builds from the running pose, falls, settles low and freezes without NaN', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    const results: {settled: number; pelvisY: number; minY: number}[] = [];
    const poses: {weapon: string; settled: number; centre: number[]; bones: Record<string, number[]>}[] = [];
    for (const [x, z, yaw, weapon] of [[8, 6, 0.5, 'rifle'], [14, 8, 2.2, 'shotgun']] as const) {
      const c = new CreatureActor(gltf, spawnAt(x, z, yaw), rng(7));
      c.root.position.y = 0;
      for (let i = 0; i < 6; i++) { c.animate(1 / 30, 'Run', 4); c.updateVolumes(); }
      c.brain.damage(999, x, z + 3);
      const ok = ph.ragdoll(c, {dir: {x: 0, y: -0.1, z: -1}, point: {x, y: 0.4, z}, strength: killImpulseStrength(weapon, weapon === 'shotgun' ? 9 : 1, weapon === 'shotgun' ? 9 : 1)});
      expect(ok).toBe(true);
      expect(c.ragdolled).toBe(true);
      let t = 0, settled = -1, minY = Infinity;
      for (; t < 8; t += 1 / 60) {
        ph.update(1 / 60);
        c.root.updateMatrixWorld(true);
        for (const n of ['Hips', 'Chest', 'Head', 'L_FrontFoot', 'R_HindFoot', 'Tail3']) minY = Math.min(minY, c.bone(n)!.getWorldPosition(new THREE.Vector3()).y);
        if (ph.stats().ragdollsActive === 0) { settled = t; break; }
      }
      const pel = c.bone('Hips')!.getWorldPosition(new THREE.Vector3());
      expect(Number.isFinite(pel.x + pel.y + pel.z)).toBe(true);
      results.push({settled, pelvisY: pel.y, minY});
      // QA evidence (opt-in): settled bone world matrices for the CPU render in tools/asset-pipeline/creature/qa/evidence.mjs
      if (process.env.LL_CREATURE_EVIDENCE) {
        c.root.updateMatrixWorld(true);
        const bones: Record<string, number[]> = {};
        c.root.traverse(o => { if ((o as THREE.Bone).isBone) bones[o.name] = o.matrixWorld.toArray(); });
        poses.push({weapon, settled, centre: [pel.x, pel.y, pel.z], bones});
      }
      expect(settled).toBeGreaterThan(0);
      expect(pel.y).toBeLessThan(0.33); // down, not standing (standing hips joint ~0.37 m)
      expect(pel.y).toBeGreaterThan(0.02);
      expect(minY).toBeGreaterThan(-0.05);
    }
    expect(ph.stats().ragdollsFailed).toBe(0);
    if (process.env.LL_CREATURE_EVIDENCE) writeFileSync(process.env.LL_CREATURE_EVIDENCE, JSON.stringify(poses));
    console.log('[creature.test] ragdolls', JSON.stringify(results.map(r => ({settled: +r.settled.toFixed(2), pelvisY: +r.pelvisY.toFixed(3), minY: +r.minY.toFixed(3)}))));
    void CELL;
  });
});

describe('damage on the generic actor surface (Lane K chunks + corpse volumes)', () => {
  it('a rifle hit tears a real posed-surface chunk off the running rat/dog; its corpse stops bullets', () => {
    const L = testLayout();
    const ph = new PhysicsSystem(null);
    ph.build(L);
    const sys = new DamageSystem(null, null);
    sys.build({...L, areas: [], trenches: [], props: [], name: 't', seed: 1} as unknown as Parameters<DamageSystem['build']>[0], null, [], {physics: ph});
    const c = new CreatureActor(gltf, spawnAt(8, 6, 0.4), rng(9));
    c.root.position.y = 0;
    sys.installZombie(c);
    for (let i = 0; i < 20; i++) {
      c.brain.x += 4 / 60 * Math.sin(0.4); c.brain.z += 4 / 60 * Math.cos(0.4);
      c.animate(1 / 60, 'Run', 4);
      c.syncTransform();
      c.updateVolumes();
    }
    // flank shot (from the creature's left side) at the middle of the back capsule
    const t = c.hitVolumes.find(v => v.part === 'torso')!;
    const mid = new THREE.Vector3((t.a.x + t.b!.x) / 2, (t.a.y + t.b!.y) / 2, (t.a.z + t.b!.z) / 2);
    const left = new THREE.Vector3(Math.cos(0.4), 0, -Math.sin(0.4));
    const point = mid.clone().addScaledVector(left, t.r);
    sys.beginShot();
    const hit = sys.hitZombie(c, point, left.clone().negate(), 'torso', {damage: 24, pellet: false, weapon: 'rifle'});
    expect(hit.material).toBe('flesh');
    expect(woundsOf(c)!.count).toBe(1);
    expect(sys.counts.patches + sys.counts.flaps).toBe(1);
    expect(ph.chunks.stats().flesh).toBe(1);
    console.log(`[creature.test] chunk: patches ${sys.counts.patches}, flaps ${sys.counts.flaps}, tears ${woundsOf(c)!.tears}`);
    // dead: the quadruped corpse volumes stop a bullet aimed at its body
    c.brain.damage(999, 0, 0);
    c.updateVolumes();
    const o = {x: point.x + left.x * 3, y: point.y, z: point.z + left.z * 3}, d = {x: -left.x, y: 0, z: -left.z};
    const corpse = sys.corpseHit([c], o, d, 10);
    expect(corpse).not.toBeNull();
    expect(corpse!.z).toBe(c);
    c.dispose();
  });
});

describe('creature audio (Sound Lab only)', () => {
  it('six creature cues are in the bank with bundled Sound Lab derivatives on disk', () => {
    for (const cue of ['creatureGrowl', 'creatureSnarl', 'creatureBite', 'creatureYelp', 'creatureDeath', 'creatureStep'] as const) {
      expect(CUES).toContain(cue);
      const clips = CLIP_MANIFEST_I07Q[cue] ?? [];
      expect(clips.length, cue).toBeGreaterThan(0);
      for (const c of clips) { expect(existsSync(pub(c.url)), c.url).toBe(true); expect(c.src).toMatch(/^i07q-creature-/); }
    }
    const ap = JSON.parse(readFileSync(pub('assets/derivatives/audio-iteration07-creature.json'), 'utf8'));
    expect(ap.gaps).toEqual([]);
    for (const d of ap.derivatives) expect(d.source.rawSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
