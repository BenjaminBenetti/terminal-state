// Task track1-siren-blightbelly-20261031 (lane BLIGHT): the Blightbelly family — registry / stats derived from the ordinary zombie
// and matched to lane RIGB's clip contract, the actor on the real derivative GLB (hit volumes, pustules, obese ragdoll), doorway
// fit / no invisible reach, the death burst EXACTLY ONCE (single kill, multi-pellet frame, melee kill, chains, revisit /
// teardown / despawn = none), the blast (falloff, cover / LOS, storey isolation, never an instakill, 'blast' hit pipeline,
// the gas mask does not block it) and the burst's gas puff hand-off.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {CELL, FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import {PropIndex, moveCircle, resolveCircle} from '../src/core/physics';
import {levelsOf} from '../src/gen/levels';
import {ZOMBIE_STATS, ZombieBrain} from '../src/ai/brain';
import {BLIGHT_CUES, BLIGHTBELLY_BURST, BLIGHTBELLY_STATS, BlightbellyBrain, blastDamage, blastFalloff, blastHitLocation, bodyDistance} from '../src/ai/blightbelly';
import {BlightbellyActor, blightHitRadii, obeseRagdollRig} from '../src/ai/blightbellyActor';
import {BlightBurstSystem, installBlightBurst, type BlightEnemy, type BlightHost} from '../src/ai/blightBurst';
import {createEnemyActor, ENEMY_ARCHETYPES, enemyCues, archetypeOf, type EnemyActor} from '../src/ai/creatureArchetypes';
import {ENEMY_FAMILY_IDS} from '../src/ai/spawnTables';
import {ENEMY_MODEL_FILES, enemyModelKeysFor, withEnemyModels} from '../src/ai/enemyModels';
import {MODEL_FILES} from '../src/assets/manifest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import {enemiesToSpawn} from '../src/run/memory';
import {PhysicsSystem, killImpulseStrength} from '../src/physics/world';
import {armorFor, type PlayerHit} from '../src/player/hits';
import {hitInjuryChance} from '../src/player/injuries';
import {installGas, type GasHost} from '../src/world/gas/system';
import {GAS} from '../src/world/gas/field';
import type {PuffSpec} from '../src/world/gas/puff';
import type {PropPlacement} from '../src/gen/props';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const MODEL_URL = ENEMY_MODEL_FILES.enemy_blightbelly.url;

async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // node has no image decoder
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}
const spawnAt = (x: number, z: number, yaw = 0): ZombieSpawn => ({x, z, yaw, type: 'shambler', area: 0, archetype: 'blightbelly'});
const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

let gltf: GLTF;
beforeAll(async () => { gltf = await loadStripped(MODEL_URL); });

// ---------------------------------------------------------------------------------------------
describe('Blightbelly family: registry, stats from the ordinary zombie, RIGB clip contract, lazy model', () => {
  it('stats: only conservative, explained subtype changes; health / claw / reach / sight are the ordinary zombie\'s (read from source)', () => {
    const S = ZOMBIE_STATS.shambler, B = BLIGHTBELLY_STATS;
    expect(B.hp).toBe(S.hp);
    expect(B.attackDamage).toBe(S.attackDamage);
    expect(B.attackRange).toBe(S.attackRange);
    expect(B.sightRange).toBe(S.sightRange);
    expect(B.chaseSpeed).toBeLessThan(ZOMBIE_STATS.coated.chaseSpeed); // lumbers: slower than every existing zombie
    expect(B.wanderSpeed).toBeLessThan(ZOMBIE_STATS.coated.wanderSpeed);
    expect(B.chaseSpeed).toBeLessThan(3.4); // a walking player outpaces it
    expect(B.radius).toBeGreaterThan(ZOMBIE_STATS.coated.radius);
    // no global retune: the existing families are untouched
    expect(ZOMBIE_STATS.shambler).toMatchObject({hp: 100, chaseSpeed: 2.55, attackDamage: 10, radius: 0.33});
    expect(ZOMBIE_STATS.coated).toMatchObject({hp: 165, chaseSpeed: 1.75, attackDamage: 15, radius: 0.38});
  });

  it('registry: the entry sits in SPAWN\'s family order, names its lazy model and stats; cues are the deep / heavy zombie cues', () => {
    expect(Object.keys(ENEMY_ARCHETYPES)).toEqual([...ENEMY_FAMILY_IDS]);
    const def = ENEMY_ARCHETYPES.blightbelly;
    expect(def).toMatchObject({id: 'blightbelly', label: 'Blightbelly', model: 'enemy_blightbelly', stats: BLIGHTBELLY_STATS, climbsLadders: true});
    // level-specific loading: not in the boot preload, in the lazy enemy table
    expect((MODEL_FILES as Record<string, unknown>).enemy_blightbelly).toBeUndefined();
    expect(ENEMY_MODEL_FILES.enemy_blightbelly.url).toBe('assets/models/enemy-blightbelly.glb');
    const bytes = statSync(pub(MODEL_URL)).size;
    expect(Math.abs(ENEMY_MODEL_FILES.enemy_blightbelly.bytes - bytes) / bytes).toBeLessThan(0.1);
    // a layout's lazy keys = exactly the enemy models its spawns place
    const layout = (arch: (string | undefined)[]) => ({zombies: arch.map(a => ({archetype: a}))});
    expect(enemyModelKeysFor(layout([undefined, 'ratdog']))).toEqual([]);
    expect(enemyModelKeysFor(layout(['blightbelly', undefined, 'blightbelly']))).toEqual(['enemy_blightbelly']);
    const merged = withEnemyModels({zombie: 1 as unknown}, k => (k === 'enemy_blightbelly' ? 2 as unknown : undefined));
    expect(merged).toEqual({zombie: 1, enemy_blightbelly: 2});
  });

  it('the GLB extras (RIGB) agree with the stats: Attack slam timing, collider radius, locomotion speeds near the authored ground speeds', () => {
    const E = gltf.scene.userData.enemyBlightbelly;
    expect(E.clips.Attack.duration).toBeCloseTo(BLIGHTBELLY_STATS.attackDuration, 3);
    expect(E.clips.Attack.impactTime).toBeCloseTo(BLIGHTBELLY_STATS.attackImpact, 3);
    expect(E.radius).toBeCloseTo(BLIGHTBELLY_STATS.radius, 3);
    for (const [clip, speed] of [['Walk', BLIGHTBELLY_STATS.wanderSpeed], ['Run', BLIGHTBELLY_STATS.chaseSpeed]] as const) {
      const k = speed / E.clips[clip].groundSpeed; // the actor time-scales the clip by this (x actor scale ~1)
      expect(k, clip).toBeGreaterThan(0.85);
      expect(k, clip).toBeLessThan(1.3);
    }
    expect(gltf.animations.map(a => a.name).sort()).toEqual(['Attack', 'Death', 'Hit', 'Idle', 'Run', 'Walk']);
    expect(E.pustules.length).toBeGreaterThanOrEqual(BLIGHTBELLY_BURST.maxPops);
  });
});

// ---------------------------------------------------------------------------------------------
describe('BlightbellyActor on the real derivative GLB', () => {
  it('rigged; Blightbelly brain + stats; 7 hit volumes from RIGB\'s measured radii (belly sphere in front of the spine); clips time-scaled by their own ground speeds', () => {
    const a = new BlightbellyActor(gltf, spawnAt(4, 6, 0), rng(3));
    expect(a.hasRig).toBe(true);
    expect(a.archetype).toBe('blightbelly');
    expect(archetypeOf(a as unknown as EnemyActor)).toBe('blightbelly');
    expect(a.brain).toBeInstanceOf(BlightbellyBrain);
    expect(a.brain.stats).toBe(BLIGHTBELLY_STATS);
    expect(a.scale).toBeGreaterThanOrEqual(0.95);
    expect(a.scale).toBeLessThanOrEqual(1.05);
    expect(a.meshes.length).toBe(1);
    expect(a.pustuleMeshes.length).toBe(1);
    a.root.position.y = 0;
    a.animate(1 / 30, 'Idle', 0);
    const v = a.updateVolumes();
    expect(v.map(x => x.part)).toEqual(['head', 'torso', 'torso', 'limb', 'limb', 'limb', 'limb']);
    const E = gltf.scene.userData.enemyBlightbelly, R = blightHitRadii(E);
    expect(v[1].r).toBeCloseTo(R.torso * a.scale, 6);
    // the belly sphere: the measured radius clamped to the belly front (no hit shell in front of the body)
    expect(v[2].r).toBeLessThanOrEqual(R.belly * a.scale + 1e-9);
    expect(v[2].a.z + v[2].r - 6).toBeLessThanOrEqual(E.footprint.torsoFrontZ * a.scale + 0.03); // (bind clamp; the Idle pose leans a few mm)
    // yaw 0 = model forward +Z: the belly sphere sits in front of the torso capsule's axis
    const capZ = (v[1].a.z + v[1].b!.z) / 2;
    expect(v[2].a.z).toBeGreaterThan(capZ + 0.05);
    // a head shot is a head shot: the head sphere is NOT inside the fat torso capsule (its centre clears the capsule by > its radius / 2)
    const segDist = (p: {x: number; y: number; z: number}, A: {x: number; y: number; z: number}, B: {x: number; y: number; z: number}) => {
      const ab = new THREE.Vector3(B.x - A.x, B.y - A.y, B.z - A.z), ap = new THREE.Vector3(p.x - A.x, p.y - A.y, p.z - A.z);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
      return ap.sub(ab.multiplyScalar(t)).length();
    };
    expect(segDist(v[0].a, v[1].a, v[1].b!)).toBeGreaterThan(v[1].r + v[0].r * 0.5);
    // ... nor does the torso capsule swallow the thighs: its bottom stays above the knees
    expect(Math.min(v[1].a.y, v[1].b!.y) - v[1].r).toBeGreaterThan(a.bone('L_Shin')!.getWorldPosition(new THREE.Vector3()).y);
    expect(v[0].a.y).toBeGreaterThan(1.55 * a.scale);
    expect(v[0].a.y).toBeLessThan(1.95 * a.scale);
    expect(a.clipSpeed('Run')).toBe(gltf.scene.userData.enemyBlightbelly.clips.Run.groundSpeed);
    // the volumes stay inside the body bounds (no invisible hit shell): every capsule end within the extras bounds + radius
    const bnd = gltf.scene.userData.enemyBlightbelly.boundsM;
    for (const h of v) for (const p of [h.a, h.b].filter(Boolean) as {x: number; y: number; z: number}[]) {
      expect(p.x - 4).toBeGreaterThan(bnd.min[0] * a.scale - 0.05);
      expect(p.x - 4).toBeLessThan(bnd.max[0] * a.scale + 0.05);
      expect(p.y).toBeLessThan(bnd.max[1] * a.scale + 0.15);
    }
    a.dispose();
  });

  it('pustules: the largest burst points lie on the body; popPustules hides the domes once', () => {
    const a = new BlightbellyActor(gltf, spawnAt(0, 0, 0.7), rng(5));
    a.root.position.y = 0;
    a.animate(1 / 30, 'Idle', 0);
    const pts = a.pustulePoints(BLIGHTBELLY_BURST.maxPops);
    expect(pts.length).toBe(BLIGHTBELLY_BURST.maxPops);
    for (const p of pts) {
      expect(Math.hypot(p.p.x, p.p.z)).toBeLessThan(0.75);
      expect(p.p.y).toBeGreaterThan(0.4);
      expect(p.p.y).toBeLessThan(1.8);
      expect(p.n.length()).toBeCloseTo(1, 3);
    }
    for (let i = 1; i < pts.length; i++) expect(pts[i].r).toBeLessThanOrEqual(pts[i - 1].r + 1e-9);
    expect(a.pustuleMeshes.every(m => m.visible)).toBe(true);
    expect(a.popPustules()).toBe(true);
    expect(a.pustuleMeshes.every(m => !m.visible)).toBe(true);
    expect(a.popPustules()).toBe(false);
    a.dispose();
  });

  it('createEnemyActor: the Blightbelly when its lazy model is loaded, else a zombie stands in (fallback); cues', () => {
    const zombie = () => ({brain: new ZombieBrain('shambler', 0, 0, 0)}) as unknown as EnemyActor;
    const withModel = createEnemyActor(spawnAt(1, 1), withEnemyModels({}, k => (k === 'enemy_blightbelly' ? gltf : undefined)), rng(), zombie);
    expect(withModel.fallback).toBe(false);
    expect(withModel.actor).toBeInstanceOf(BlightbellyActor);
    expect(enemyCues(withModel.actor)).toBe(BLIGHT_CUES);
    const without = createEnemyActor(spawnAt(1, 1), {}, rng(), zombie);
    expect(without.fallback).toBe(true);
    expect(without.actor.brain).not.toBeInstanceOf(BlightbellyBrain); // a plain zombie never bursts
  });

  it('obese ragdoll: builds from the walking pose, falls, settles low on its belly / back without sinking through the floor', () => {
    const rig = obeseRagdollRig();
    expect(rig.parts.find(p => p.name === 'torso')!.mass).toBeGreaterThan(40);
    const g = new Grid(48, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : y >= 24 ? VOID : FLOOR);
    const ph = new PhysicsSystem(null);
    ph.build({grid: g, props: [], trench: {floorY: -1.15}} as never);
    const rows: string[] = [];
    for (const [x, z, yaw, weapon, dirZ] of [[8, 6, 0.4, 'rifle', -1], [14, 8, 2.6, 'shotgun', 1]] as const) {
      const a = new BlightbellyActor(gltf, spawnAt(x, z, yaw), rng(9));
      a.root.position.y = 0;
      for (let i = 0; i < 6; i++) { a.animate(1 / 30, 'Walk', 0.45); a.updateVolumes(); }
      a.brain.damage(999, x, z + 3);
      expect(ph.ragdoll(a, {dir: {x: 0, y: -0.1, z: dirZ}, point: {x, y: 1.0, z}, strength: killImpulseStrength(weapon, weapon === 'shotgun' ? 9 : 1, weapon === 'shotgun' ? 9 : 1)})).toBe(true);
      let settled = -1, minY = Infinity;
      for (let t = 0; t < 8; t += 1 / 60) {
        ph.update(1 / 60);
        a.root.updateMatrixWorld(true);
        for (const n of ['Hips', 'Spine', 'Chest', 'Head', 'L_Foot', 'R_Hand']) minY = Math.min(minY, a.bone(n)!.getWorldPosition(new THREE.Vector3()).y);
        if (ph.stats().ragdollsActive === 0) { settled = t; break; }
      }
      const pel = a.bone('Hips')!.getWorldPosition(new THREE.Vector3()), sp = a.bone('Spine')!.getWorldPosition(new THREE.Vector3());
      rows.push(`${weapon}: settled ${settled.toFixed(2)} s, hips y ${pel.y.toFixed(3)}, spine y ${sp.y.toFixed(3)}, min bone y ${minY.toFixed(3)}`);
      expect(Number.isFinite(pel.x + pel.y + pel.z)).toBe(true);
      expect(settled).toBeGreaterThan(0);
      expect(pel.y).toBeLessThan(0.5); // down (standing hips 0.69 m)
      expect(sp.y).toBeGreaterThan(0.1); // the fat torso keeps the spine joint well above the floor (belly not sunk)
      expect(minY).toBeGreaterThan(-0.05);
      a.dispose();
    }
    expect(ph.stats().ragdollsFailed).toBe(0);
    console.info(`[blightbelly] obese ragdoll: ${rows.join(' | ')}`);
  });
});

// ---------------------------------------------------------------------------------------------
const layouts = new Map<string, StationLayout>();
const subway = (seed: number) => { const k = `s${seed}`; let l = layouts.get(k); if (!l) layouts.set(k, (l = generateStation(seed))); return l; };
const office = (seed: number) => { const k = `o${seed}`; let l = layouts.get(k); if (!l) layouts.set(k, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'} as never))); return l; };

describe('fits doorways, no invisible reach', () => {
  it('every generated walk-through opening (Subway x2, Office) is wider than the collider + 0.08 m a side; the motor carries it through every flat opening, and through every narrow one (<= 1.5 m) a coated zombie passes with the props in place', () => {
    const r = BLIGHTBELLY_STATS.radius, rows: string[] = [];
    for (const [name, L] of [['subway 42', subway(42)], ['subway 7', subway(7)], ['office 12345', office(12345)]] as const) {
      const widths = L.doors.map(d => Math.max(d.w, d.h) * CELL);
      expect(Math.min(...widths), name).toBeGreaterThanOrEqual(2 * r + 2 * 0.08 - 1e-9);
      const levels = levelsOf(L), props = new PropIndex(levels, L.props);
      let coatedPass = 0, blightPass = 0;
      const cross = (d: (typeof L.doors)[number], rad: number, withProps = true) => {
        const lv = d.level ?? L.areas[d.a]?.level ?? 0, g = levels.grid(lv);
        const cx = (d.x + d.w / 2) * CELL, cz = (d.y + d.h / 2) * CELL, alongX = d.w < d.h; // thin axis = the wall: cross along it
        const ux = alongX ? 1 : 0, uz = alongX ? 0 : 1;
        const y = g.floorAt(cx, cz);
        let x = cx - ux * 1.2, z = cz - uz * 1.2;
        if (Math.abs(g.floorAt(x, z) - y) > 0.3 || Math.abs(g.floorAt(cx + ux * 1.2, cz + uz * 1.2) - y) > 0.3) return null; // stairs / ramps: not a flat door
        for (let i = 0; i < 60; i++) [x, z] = moveCircle(levels, withProps ? props : null, x, z, ux * 0.04, uz * 0.04, rad, y);
        return Math.hypot(x - (cx + ux * 1.2), z - (cz + uz * 1.2)) < 0.1;
      };
      let checked = 0, structural = 0, narrow = 0;
      for (const d of L.doors) {
        const bare = cross(d, r, false);
        if (bare === null) continue; // a stair / ramp mouth, not a flat door
        checked++;
        if (bare) structural++;
        // with the props in place: the narrow openings (where the body width matters). A wide opening with a loose chair
        // on the straight centre line is walked round by the pathfinder / shoved (loose props), not a fit problem.
        if (Math.max(d.w, d.h) * CELL > 1.5 || !cross(d, ZOMBIE_STATS.coated.radius)) continue;
        narrow++;
        coatedPass++;
        if (cross(d, r)) blightPass++;
      }
      // every placed enemy slot (any may roll a Blightbelly) has wall clearance for the collider; props nudge it at most a little
      let nudge = 0;
      for (const sp of L.zombies) {
        const lv = sp.level ?? 0, g = levels.grid(lv), y = sp.y ?? g.floorAt(sp.x, sp.z);
        expect(g.circleClear(sp.x, sp.z, r), `${name} spawn`).toBe(true);
        const [x, z] = resolveCircle(levels, props, sp.x, sp.z, r, y);
        nudge = Math.max(nudge, Math.hypot(x - sp.x, z - sp.z));
      }
      expect(nudge, name).toBeLessThan(0.35);
      rows.push(`${name}: doors ${L.doors.length}, min width ${Math.min(...widths).toFixed(2)} m, flat openings ${checked} (structurally passable ${structural}), narrow <= 1.5 m passable by a coated zombie ${narrow}, by the Blightbelly ${blightPass}; spawns ${L.zombies.length} all wall-clear, max prop nudge ${nudge.toFixed(2)} m`);
      expect(structural, name).toBe(checked);
      expect(blightPass, name).toBe(coatedPass);
    }
    console.info(`[blightbelly] doorways (collider r ${r}):\n${rows.join('\n')}`);
  });

  it('reach: the swing lands within the ordinary zombie\'s centre distance (1.8 m) — less beyond its own (bigger) body than a shambler; one hit per swing, LOS / facing / vertical checks unchanged', () => {
    const hitDist = (s: typeof BLIGHTBELLY_STATS) => s.attackRange + 0.45; // brain.ts attack check
    expect(hitDist(BLIGHTBELLY_STATS)).toBeCloseTo(hitDist(ZOMBIE_STATS.shambler), 9);
    expect(hitDist(BLIGHTBELLY_STATS) - BLIGHTBELLY_STATS.radius).toBeLessThan(hitDist(ZOMBIE_STATS.shambler) - ZOMBIE_STATS.shambler.radius);
    // the brain swings once per Attack (1.5 s) and hits once at the 0.7 s slam
    const b = new BlightbellyBrain(0, 0, 0);
    const w = {px: 0, pz: 1.2, py: 0, playerAlive: true, los: () => true, walkClear: () => true, findPath: () => [], randomNear: () => null, rand: () => 0.5};
    let hits = 0, t = 0;
    const times: number[] = [];
    for (; t < 1.49; t += 1 / 60) { const o = b.update(1 / 60, w); if (o.attackHit) { hits++; times.push(t); } }
    expect(b.attackSeq).toBe(1);
    expect(hits).toBe(1);
    expect(times[0]).toBeGreaterThan(0.65);
    expect(times[0]).toBeLessThan(0.75);
    // behind a wall (no LOS) the slam misses
    const b2 = new BlightbellyBrain(0, 0, 0);
    let sees = true, h2 = 0;
    const w2 = {...w, los: () => sees};
    for (let k = 0; k < 20; k++) b2.update(1 / 60, w2);
    sees = false;
    for (let k = 0; k < 90; k++) if (b2.update(1 / 60, w2).attackHit) h2++;
    expect(h2).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Fake host for the burst system on a level.

/** 20 x 20 m single storey (cells 2..41), floor 0, ceiling 3; optional solid wall column `wallX` (cells) without openings. */
function room(wallX?: number) {
  const g = new Grid(44, 44);
  for (let y = 0; y < 44; y++) for (let x = 0; x < 44; x++) {
    const open = x >= 2 && y >= 2 && x < 42 && y < 42 && x !== wallX;
    g.set(x, y, open ? FLOOR : SOLID);
    if (open) { const i = g.idx(x, y); g.floor[i] = 0; g.ceil[i] = 3; }
  }
  return {grid: g, props: [] as PropPlacement[], trench: {floorY: -1.15}, levels: [{id: 0, role: 'main', grid: g, baseY: 0}]} as unknown as StationLayout;
}
const prop = (x: number, z: number, hx: number, hz: number, h: number) => ({kind: 'counter', x, y: 0, z, hx, hz, h, rot: 0, blocksSight: true} as unknown as PropPlacement);

function host(L: StationLayout, o: {gas?: BlightHost['gas']} = {}) {
  const hits: {hit: PlayerHit; from: [number, number]}[] = [], puffs: PuffSpec[] = [], audio: string[] = [], kills: BlightEnemy[] = [];
  const h: BlightHost & {clockV: number} = {
    player: {x: 10, y: 0, z: 10, eye: 1.62, alive: true, crouched: false},
    layout: L, levels: levelsOf(L as never), zombies: [] as BlightEnemy[],
    gas: o.gas ?? {addPuff: s => { puffs.push(s); return true; }},
    fx: {blightBurst: () => { audio.push('fx'); }},
    damage: {burst: () => 1},
    sfx: {blightBurst: (_id, x, _y, z) => { audio.push(`burst@${x.toFixed(1)},${z.toFixed(1)}`); return true; }, blightHiss: () => { audio.push('hiss'); return true; }},
    frameHooks: [], sectionHooks: [],
    blastPlayer: (hit, fx, fz) => { hits.push({hit, from: [fx, fz]}); return {applied: armorFor(hit, 0, 0).applied}; },
    blastKill: z => { kills.push(z); },
    clockV: 0, get clock() { return this.clockV; },
  };
  const sys = installBlightBurst(h, {rand: () => 0.3});
  const step = (s: number, dt = 1 / 60) => { for (let t = 0; t < s - 1e-9; t += dt) { h.clockV += dt; for (const f of h.frameHooks) f(dt); } };
  /** A Blightbelly (brain only, like an actor without a model) adopted by the burst system. */
  const blight = (x: number, z: number, y = 0) => {
    const b = new BlightbellyBrain(x, z, 0);
    b.y = y;
    const e: BlightEnemy = {brain: b, archetype: 'blightbelly'};
    (h.zombies as BlightEnemy[]).push(e);
    sys.adopt(e);
    return e;
  };
  return {h, sys, hits, puffs, audio, kills, step, blight};
}

describe('death burst exactly once', () => {
  it('a single kill reports once; overkill, later hits, a second same-frame damage call (multi-pellet aggregation) and a melee kill never report again', () => {
    for (const melee of [false, true]) {
      const b = new BlightbellyBrain(0, 0, 0);
      let reports = 0;
      b.onDeath = () => reports++;
      expect(b.damage(60, 0, 5, 0, melee ? {stagger: false} : {})).toBe(false);
      expect(reports).toBe(0);
      expect(b.damage(500, 0, 5, 0, melee ? {stagger: false} : {})).toBe(true); // the killing hit
      expect(b.damage(30, 0, 5)).toBe(false); // a second pellet group / another weapon in the same frame
      expect(b.damage(999, 0, 5)).toBe(false);
      expect(reports).toBe(1);
      expect(b.deathReported).toBe(true);
      expect(b.alive).toBe(false);
    }
    // a shotgun blast is summed per enemy BEFORE the single damage() call (game.ts fire: dmg map) — one call, one report
    const b = new BlightbellyBrain(0, 0, 0);
    let reports = 0;
    b.onDeath = () => reports++;
    const pellets = Array.from({length: 9}, () => 15);
    expect(b.damage(pellets.reduce((s, v) => s + v, 0), 0, 3)).toBe(true);
    expect(reports).toBe(1);
  });

  it('the burst system: queued at the kill point, bursts ONCE after the beat, with audio once; duplicate reports are ignored; puff on the burst storey', () => {
    const {sys, puffs, audio, step, blight} = host(room());
    const e = blight(12, 10);
    expect(sys.counts.adopted).toBe(1);
    e.brain.damage(500, 10, 10);
    sys.report(e); // a stray second report (impossible through the brain) is still ignored
    expect(sys.counts.reported).toBe(1);
    expect(sys.counts.ignored).toBe(1);
    expect(sys.pending).toBe(1);
    step(BLIGHTBELLY_BURST.delayS * 0.5);
    expect(sys.counts.bursts).toBe(0);
    step(BLIGHTBELLY_BURST.delayS);
    expect(sys.counts.bursts).toBe(1);
    expect(audio.filter(a => a.startsWith('burst')).length).toBe(1);
    expect(audio.filter(a => a === 'hiss').length).toBe(1);
    expect(puffs).toHaveLength(1);
    expect(puffs[0]).toMatchObject({level: 0, x: 12, z: 10, radius: BLIGHTBELLY_BURST.gasRadius, peak: BLIGHTBELLY_BURST.gasPeak, durationS: BLIGHTBELLY_BURST.gasDurationS});
    // more damage / frames / reports: nothing more
    e.brain.damage(100, 10, 10);
    sys.report(e);
    step(2);
    expect(sys.counts.bursts).toBe(1);
    expect(puffs).toHaveLength(1);
    expect(sys.log).toHaveLength(1);
  });

  it('chains are bounded and once each: a blast killing a wounded Blightbelly bursts it in turn (next frames), a fresh zombie survives (staggered)', () => {
    const {sys, kills, step, blight, h} = host(room());
    h.player.x = 20; h.player.z = 20; // out of reach
    const a = blight(10, 10), b = blight(11.2, 10), c = blight(20, 14);
    const z = {brain: new ZombieBrain('shambler', 9, 10.5, 0), archetype: 'zombie'} as BlightEnemy;
    (h.zombies as BlightEnemy[]).push(z);
    b.brain.damage(80, 0, 0); // wounded: 20 hp left
    a.brain.damage(500, 0, 0);
    step(0.5);
    expect(sys.counts.bursts).toBe(2); // a, then b (killed by a's blast)
    expect(b.brain.alive).toBe(false);
    expect(kills).toContain(b);
    expect(z.brain.alive).toBe(true); // a fresh 100 hp zombie survives two nearby bursts (<= 30 each)
    expect(z.brain.hp).toBeGreaterThanOrEqual(100 - 2 * BLIGHTBELLY_BURST.enemyMax);
    expect(c.brain.alive).toBe(true); // beyond the radius: only heard it
    expect(c.brain.aware).toBe(true);
    step(3);
    expect(sys.counts.bursts).toBe(2);
    expect(sys.counts.reported).toBe(2);
  });

  it('no burst on spawn, despawn / dispose, teardown, section build, or a revisit (killed layout indices are never re-spawned)', async () => {
    const {sys, h, step, blight} = host(room());
    const a = blight(10, 10);
    step(1);
    expect(sys.counts.reported).toBe(0); // spawned and alive: nothing
    // killed, then the section is torn down before the beat: the burst is dropped (the kill is remembered by the run)
    a.brain.damage(500, 0, 0);
    expect(sys.pending).toBe(1);
    for (const s of h.sectionHooks) s.teardown?.();
    step(1);
    expect(sys.counts.bursts).toBe(0);
    // a section build also drops anything pending
    const b2 = blight(12, 12);
    b2.brain.damage(500, 0, 0);
    for (const s of h.sectionHooks) s.build?.(undefined as never);
    step(1);
    expect(sys.counts.bursts).toBe(0);
    // the actor with the real model: construction / animation / volumes / dispose never report a death
    const act = new BlightbellyActor(gltf, spawnAt(5, 5), rng(2));
    sys.adopt(act);
    act.animate(1 / 30, 'Walk', 0.4); act.updateVolumes(); act.dispose();
    step(1);
    expect(sys.counts.reported).toBe(2); // only the two killed above were ever reported
    // revisit: the run memory never spawns a killed index again (run/memory.ts)
    expect(enemiesToSpawn(5, {killed: [1, 3]} as never)).toEqual([0, 2, 4]);
    // re-adopting a dead brain cannot burst it: damage() on a dead brain returns false
    sys.adopt(a);
    expect(a.brain.damage(500, 0, 0)).toBe(false);
    step(1);
    expect(sys.counts.bursts).toBe(0);
  });

  it('bounded: at most maxPerFrame bursts per frame, a capped queue', () => {
    const {sys, h, step, blight} = host(room());
    h.player.x = 20; h.player.z = 20;
    const many = Array.from({length: 7}, (_, i) => blight(3 + (i % 4) * 5, 3 + Math.floor(i / 4) * 8));
    for (const e of many) e.brain.damage(500, 0, 0);
    step(BLIGHTBELLY_BURST.delayS + 1 / 60, BLIGHTBELLY_BURST.delayS + 1 / 60);
    expect(sys.counts.bursts).toBe(BLIGHTBELLY_BURST.maxPerFrame);
    step(0.1);
    expect(sys.counts.bursts).toBe(7);
  });
});

// ---------------------------------------------------------------------------------------------
describe('blast: falloff, cover / LOS, storey isolation, never an instakill, the hit pipeline, the mask does not block it', () => {
  it('falloff: max inside the inner radius, linear to 0 at the radius; never above blastMax (<= 25, a 100 hp player survives any single blast)', () => {
    const B = BLIGHTBELLY_BURST;
    expect(B.blastMax).toBeLessThanOrEqual(25);
    expect(blastFalloff(0)).toBe(1);
    expect(blastFalloff(B.blastInner)).toBe(1);
    expect(blastFalloff((B.blastInner + B.blastRadius) / 2)).toBeCloseTo(0.5, 9);
    expect(blastFalloff(B.blastRadius)).toBe(0);
    expect(blastFalloff(10)).toBe(0);
    expect(blastDamage(0, 1)).toBe(B.blastMax);
    expect(blastDamage(1, 0)).toBe(0);
    expect(blastDamage(1, 2)).toBeLessThanOrEqual(B.blastMax);
    // nearest body point: a player standing on the burst's storey, centre at belly height
    expect(bodyDistance(0, 0.95, 0, 2, 0, 1.62, 0)).toBeCloseTo(2, 9);
    expect(bodyDistance(0, 0.95, 0, 0, 3, 4.6, 0)).toBeCloseTo(2.05, 9);
    const table = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(d => `${d} m: ${blastDamage(d, 1).toFixed(1)}`).join(', ');
    console.info(`[blightbelly] blast (max ${B.blastMax}, inner ${B.blastInner} m, radius ${B.blastRadius} m), full view: ${table}`);
  });

  it('open floor: the full falloff; a solid wall between: nothing (even at 1 m); a tall shelf: nothing; a counter: partial; crouched behind it: less', () => {
    const open = host(room());
    const e = open.blight(10, 10);
    open.h.player.x = 11.5; open.h.player.z = 10;
    e.brain.damage(500, 0, 0);
    open.step(0.3);
    expect(open.hits).toHaveLength(1);
    const d = 1.5 - 0; // nearest body point at the burst height
    expect(open.hits[0].hit.amount).toBeCloseTo(blastDamage(d, 1), 6);
    expect(open.hits[0].hit).toMatchObject({source: 'blast', attacker: 'blightbelly'});
    expect(open.hits[0].from).toEqual([10, 10]); // HUD direction from the burst point

    // wall column x = 21 (10.5 .. 11 m): burst at x 10.25, player at x 11.25 — 1 m apart through the wall
    const walled = host(room(21));
    const w = walled.blight(10.25, 10);
    walled.h.player.x = 11.25; walled.h.player.z = 10;
    w.brain.damage(500, 0, 0);
    walled.step(0.3);
    expect(walled.hits).toHaveLength(0);
    expect(walled.sys.log[0].blast.visible).toBe(0);

    const shelfL = room();
    (shelfL.props as PropPlacement[]).push(prop(11, 10, 0.25, 1.5, 2.2));
    const shelf = host(shelfL);
    const s = shelf.blight(10, 10);
    shelf.h.player.x = 12; shelf.h.player.z = 10;
    s.brain.damage(500, 0, 0);
    shelf.step(0.3);
    expect(shelf.hits).toHaveLength(0);

    const counter = (crouched: boolean) => {
      const L = room();
      (L.props as PropPlacement[]).push(prop(11, 10, 0.3, 1.5, 1.05));
      const c = host(L);
      const k = c.blight(10, 10);
      c.h.player.x = 12; c.h.player.z = 10; c.h.player.crouched = crouched; c.h.player.eye = crouched ? 1.05 : 1.62;
      k.brain.damage(500, 0, 0);
      c.step(0.3);
      return {dmg: c.hits[0]?.hit.amount ?? 0, vis: c.sys.log[0].blast.visible};
    };
    const st = counter(false), cr = counter(true), full = blastDamage(2, 1);
    expect(st.dmg).toBeGreaterThan(0);
    expect(st.dmg).toBeLessThan(full);
    expect(cr.dmg).toBeLessThan(st.dmg);
    console.info(`[blightbelly] cover at 2 m: open ${full.toFixed(1)}, standing behind a 1.05 m counter ${st.dmg.toFixed(1)} (visible ${st.vis}), crouched ${cr.dmg.toFixed(1)} (visible ${cr.vis})`);
  });

  it('storey isolation on the REAL office: a burst on floor 3 never reaches a player standing right above it on floor 4; the same spot on floor 3 does', () => {
    const L = office(12345);
    const g3 = L.levels[3].grid, g4 = L.levels[4].grid;
    let spot: [number, number] | null = null;
    for (let i = 0; i < g3.cells.length && !spot; i += 7) {
      const cx = i % g3.w, cy = (i - cx) / g3.w;
      if (g3.walkable(cx, cy) && g4.walkable(cx, cy) && g3.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 1.7) && g4.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, 0.6)) spot = [(cx + 0.5) * CELL, (cy + 0.5) * CELL];
    }
    expect(spot).not.toBe(null);
    const [x, z] = spot!;
    const y3 = g3.floorAt(x, z), y4 = g4.floorAt(x, z);
    expect(y4 - y3).toBeGreaterThan(3);
    for (const [py, expectHit] of [[y4, false], [y3, true]] as const) {
      const t = host(L);
      const e = t.blight(x, z, y3);
      Object.assign(t.h.player, {x: x + (expectHit ? 1.2 : 0), z, y: py, eye: py + 1.62});
      e.brain.damage(500, 0, 0);
      t.step(0.3);
      expect(t.sys.log[0].level).toBe(3);
      if (expectHit) expect(t.hits.length).toBe(1); else expect(t.hits).toHaveLength(0);
    }
  });

  it('the hit pipeline: \'blast\' hits are reduced by worn armour and can injure a limb (cause hit); locations spread over the body', () => {
    const hit = (location: 'torso' | 'leg'): PlayerHit => ({amount: 20, source: 'blast', location, attacker: 'blightbelly'});
    expect(armorFor(hit('torso'), 0, 0.4).applied).toBeCloseTo(12, 9);
    expect(hitInjuryChance({...hit('leg'), applied: 20})).toBeGreaterThan(0);
    expect(hitInjuryChance({...hit('torso'), applied: 20})).toBe(0);
    const n: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) { const l = blastHitLocation((i + 0.5) / 1000); n[l] = (n[l] ?? 0) + 1; }
    expect(n).toEqual({torso: 550, leg: 250, arm: 150, head: 50});
  });

  it('the gas mask does NOT block the blast but DOES block the cloud: protected -> blast damage taken, gas dps 0; unprotected -> both', () => {
    for (const masked of [true, false]) {
      const L = room();
      const gasTaken: number[] = [];
      const gh = {
        player: {x: 11.2, z: 10, y: 0, eye: 1.62, alive: true, takeDamage: (a: number) => { gasTaken.push(a); }},
        layout: L, tower: {office: null}, atmosphere: {active: true, setGasLayer: () => {}}, run: {laneStore: () => undefined, setLaneStore: () => {}},
        clock: 0, state: 'playing', frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
      };
      const gas = installGas(gh as unknown as GasHost);
      gh.sectionHooks[0].build!(L);
      gas.protection = () => masked;
      const t = host(L, {gas});
      Object.assign(t.h.player, {x: 11.2, z: 10});
      const e = t.blight(10, 10);
      e.brain.damage(500, 0, 0);
      for (let k = 0; k < 6 * 60; k++) { t.step(1 / 60); for (const f of gh.frameHooks) f(1 / 60); }
      expect(t.hits).toHaveLength(1); // the blast, mask or not
      expect(t.hits[0].hit.amount).toBeGreaterThan(10);
      expect(gas.exposure.c).toBeGreaterThan(GAS.THRESHOLD); // standing in the cloud
      if (masked) { expect(gas.exposure.protected).toBe(true); expect(gasTaken).toHaveLength(0); }
      else { expect(gas.exposure.dps).toBeGreaterThan(0); expect(gasTaken.length).toBeGreaterThan(100); }
    }
  });
});

// keep the type import used (BlightBurstSystem is the installed class)
void BlightBurstSystem;
void readFileSync;
