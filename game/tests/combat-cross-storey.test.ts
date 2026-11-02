// Task studio-reactor-playtest-round2-20261102 (lane COMBAT), user bullet 1 (global): "zombies cannot be damaged when on a different
// level than the player, so for exmaple shooting at at zombie who is down stairs. this appears to apply to all levels in the game."
//
// Root cause (game.ts fire(), every level): the per-enemy cheap reject before the hit-volume test projected the enemy's feet onto
// the ray with the UNIT 3D direction's horizontal components (along = dx * d.x + dz * d.z, never divided by |d_xz|^2), so on a
// pitched ray the "closest point" fell short of the enemy by D * sin^2(pitch) and an enemy more than sqrt(1.6) = 1.26 m from that
// wrong point was skipped. A level shot hardly pitches; a shot down / up a flight of stairs (25-30 degrees, 10-15 m), across an
// atrium or into the Reactor pit (35-55 degrees) skipped the enemy on every level type. The world ray (Levels.raycast) was 3D and
// right all along (levels-gameplay.test.ts tested rayCapsule directly, so the reject was never exercised).
// The fix (combat/enemyRay.ts nearestEnemyHit, used by Game.fire for every bullet / pellet and by the damage QA shot): an exact
// cheap reject (the ray against the box around the enemy's own volumes), no storey filter, no render-state input.
//
// Pinned here on REAL generated layouts (Subway multi-level station, the Office tower, a Mall, the Reactor) with the REAL enemy
// actors (a wardrobe zombie, the rat/dog, the Blightbelly, the Siren, the Strainer; their own posed hit volumes):
//  - down / up every stair link, across the mall atrium and into / out of the Reactor pit: the enemy on the other storey is hit;
//  - the pre-fix reject skipped those same shots (the root cause, reproduced on the same rays);
//  - a slab between the storeys and a closed lift landing door still stop the bullet (the world hit is the limit);
//  - pistol, rifle and the shotgun's nine pellets: head / body parts, each pellet resolved once, one damage per enemy per shot;
//  - render culling never removes a target: an enemy hidden by the Reactor's tracked-actor culling (CULL_LAYER) is still hit;
//  - the exact reject never drops a hit the volumes would take (brute-force parity over every pitch).
// LL_COMBAT_OUT=/tmp/x.txt writes the per-layout numbers (vitest hides console output).
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {Levels, levelsOf, type DynamicVolume, type VolumeGate} from '../src/gen/levels';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {raycastWorld, rayCapsule, raySphere, type Vec3} from '../src/combat/hitscan';
import {nearestEnemyHit, volumesBoxEntry} from '../src/combat/enemyRay';
import {mulberry32} from '../src/core/rng';
import {MODEL_FILES} from '../src/assets/manifest';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {ZombieLookLibrary} from '../src/ai/outfits';
import {ZombieActor} from '../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor, type EnemyArchetypeId} from '../src/ai/creatureArchetypes';
import {WEAPONS, WeaponController, type WeaponDef} from '../src/weapons/weapons';
import {WorldMaterials} from '../src/world/materials';
import {ReactorArch} from '../src/world/reactor/arch';
import {LevelColumns, stationLevels} from '../src/world/levelGeometry';
import {CULL_LAYER, LevelCuller} from '../src/world/levelCulling';
import {ReactorCpuCulling} from '../src/world/reactor/cpuActorCulling';
import {readTowerInfo} from '../src/world/towerShared';
import {planElevator} from '../src/world/elevator';

installCanvasShim(false);

const GAME = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.LL_COMBAT_OUT;
const out = (s: string) => { if (OUT) appendFileSync(OUT, s + '\n'); };
if (OUT) writeFileSync(OUT, '');

const EYE = 1.62, DT = 1 / 30;
const ARCHETYPES: readonly EnemyArchetypeId[] = ['zombie', 'ratdog', 'blightbelly', 'siren', 'strainer'];

// ---------------------------------------------------------------------------------------------------------------------------
// Real enemies (stripped GLBs: no texture decoding in Node), built exactly like Game.spawnEnemy (createEnemyActor + the feet height)

const models: Record<string, GLTF> = {};
let looks: ZombieLookLibrary;
const rand = mulberry32(0xc0ba7);

beforeAll(async () => {
  for (const k of ['zombieBody_lastshift', 'creature_ratdog'] as const) models[k] = await loadStripped(MODEL_FILES[k].url);
  for (const [k, f] of Object.entries(ENEMY_MODEL_FILES)) models[k] = await loadStripped(f.url);
  looks = new ZombieLookLibrary(models);
}, 180000);

/** An enemy of `kind` standing with its feet at `feet` (posed in its idle clip; hit volumes refreshed as Game.updateZombies does). */
function place(kind: EnemyArchetypeId, feet: Vec3, yaw = 0.4): EnemyActor {
  const spawn = {x: feet.x, z: feet.z, yaw, type: 'shambler' as const, area: 0, y: feet.y, ...(kind === 'zombie' ? {} : {archetype: kind})};
  const {actor, fallback} = createEnemyActor(spawn, models, rand, () => new ZombieActor(looks.build({body: 'lastshift', wear: {}}), spawn, rand));
  expect(fallback, kind).toBe(false);
  expect(actor.archetype ?? 'zombie').toBe(kind);
  actor.brain.y = feet.y;
  pose(actor);
  return actor;
}
function pose(a: EnemyActor): void {
  for (let i = 0; i < 4; i++) {
    a.animate(DT, 'Idle', 0);
    a.syncTransform();
    a.root.position.y = a.brain.y; // (Game.updateZombies: feet on stairs / decks)
    a.updateVolumes();
  }
}
/** A point to aim at on `part` (the volume's middle; the first such volume). */
function aimPoint(a: EnemyActor, part: 'head' | 'torso'): Vec3 {
  const v = a.hitVolumes.find(h => h.part === part)!;
  return v.b ? {x: (v.a.x + v.b.x) / 2, y: (v.a.y + v.b.y) / 2, z: (v.a.z + v.b.z) / 2} : {...v.a};
}
const dirTo = (a: Vec3, b: Vec3): Vec3 => { const x = b.x - a.x, y = b.y - a.y, z = b.z - a.z, l = Math.hypot(x, y, z); return {x: x / l, y: y / l, z: z / l}; };
const dist = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
const pitchDeg = (d: Vec3) => Math.asin(d.y) * 180 / Math.PI;

/** The pre-fix reject from Game.fire (verbatim maths): true = the enemy at feet (fx, fz) was skipped before its volumes were tested. */
function preFixSkips(o: Vec3, d: Vec3, fx: number, fz: number, bestT: number): boolean {
  const tx = fx - o.x, tz = fz - o.z;
  const along = tx * d.x + tz * d.z;
  if (along < -1 || along > bestT + 1) return true;
  const px = o.x + d.x * along, pz = o.z + d.z * along;
  return (px - fx) ** 2 + (pz - fz) ** 2 > 1.6;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Real layouts and the game's per-pellet pipeline (Game.fire: world ray first, then the enemies before it)

interface World { name: string; layout: StationLayout; L: Levels }
const worlds = new Map<string, World>();
function world(name: 'subway' | 'office' | 'mall' | 'reactor'): World {
  let w = worlds.get(name);
  if (!w) {
    const seed = {subway: 1, office: 4242, mall: 777, reactor: 70}[name];
    const layout = LEVELS[name].generate('main', {levelSeed: seed});
    w = {name: `${name} ${seed}`, layout, L: levelsOf(layout)};
    worlds.set(name, w);
  }
  return w;
}

function shot(w: {layout: StationLayout; L: Levels}, o: Vec3, d: Vec3, range: number, enemies: readonly EnemyActor[]) {
  const wh = raycastWorld(w.L, w.layout.props, o, d, range, w.layout.trench.floorY);
  return {wh, hit: nearestEnemyHit(o, d, wh.t, enemies)};
}

/** Feet height of a standing point near y (null: nothing to stand on). */
const feetAt = (L: Levels, x: number, z: number, y: number) => L.supportAt(x, z, y + 0.1, 0.35)?.floor ?? null;

interface Stand { x: number; y: number; z: number; level: number }
const standCache = new Map<string, Stand[]>();
/** Open floor cells of storey `level` an actor can stand on (no blocking prop, no ramp), every `step`-th cell (cached). */
function standCells(w: World, level: number, step: number): Stand[] {
  const key = `${w.name}/${level}/${step}`;
  const hit = standCache.get(key);
  if (hit) return hit;
  const lv = w.L.list[level], g = lv.grid, W = g.w, list: Stand[] = [];
  for (let i = 0; i < g.cells.length; i += step) {
    if (g.cells[i] !== FLOOR || g.blocked[i] || g.rampIdx[i] >= 0) continue;
    const x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL, f = g.floorOf(i), at = feetAt(w.L, x, z, f);
    if (at === null || Math.abs(at - f) > 0.05) continue;
    list.push({x, y: f, z, level: lv.id});
  }
  standCache.set(key, list);
  return list;
}

/**
 * Cross-storey sight pairs through open space (atrium / pit / light well): a point `lo` under open air, a point `hi` on a storey at
 * least 2.5 m higher, 3-20 m apart, the world ray from hi's eye to lo's torso height clear. Deterministic; at most `max`.
 */
function voidPairs(w: World, max: number): {lo: Stand; hi: Stand}[] {
  const pairs: {lo: Stand; hi: Stand}[] = [];
  for (let a = 0; a < w.L.count && pairs.length < max; a++) {
    let under = 0;
    for (const lo of standCells(w, a, 7)) {
      if (pairs.length >= max || under > 60) break;
      const up = raycastWorld(w.L, [], {x: lo.x, y: lo.y + 1.2, z: lo.z}, {x: 0, y: 1, z: 0}, 8, w.layout.trench.floorY);
      if (up.t < 6) continue;
      under++;
      for (let b = 0; b < w.L.count; b++) {
        if (w.L.list[b].baseY < w.L.list[a].baseY + 2.5) continue;
        const cand = standCells(w, b, 3), n = cand.length;
        let hi: Stand | null = null;
        for (let k = 0, rays = 0, at = (under * 7919) % Math.max(1, n); k < n && rays < 40 && !hi; k++, at = (at + 389) % n) {
          const h = cand[at], D = Math.hypot(h.x - lo.x, h.z - lo.z);
          if (h.y < lo.y + 2.5 || D < 3 || D > 20) continue;
          rays++;
          const eye = {x: h.x, y: h.y + EYE, z: h.z}, torso = {x: lo.x, y: lo.y + 1.0, z: lo.z};
          if (raycastWorld(w.L, w.layout.props, eye, dirTo(eye, torso), 90, w.layout.trench.floorY).t > dist(eye, torso) + 0.5) hi = h;
        }
        if (hi) { pairs.push({lo, hi}); break; }
      }
    }
  }
  return pairs;
}

/** A point `lo` with a solid storey floor right above it (`hi`, >= 2.5 m higher, standable) and a stand point on hi 1.5 m aside. */
function slabPair(w: World): {lo: Stand; hi: Stand} | null {
  for (let a = 0; a < w.L.count; a++) {
    for (const lo of standCells(w, a, 5)) {
      for (let b = 0; b < w.L.count; b++) {
        const g = w.L.list[b].grid, W = g.w, i = Math.floor(lo.z / CELL) * W + Math.floor(lo.x / CELL);
        if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || g.floorOf(i) < lo.y + 2.5) continue;
        const hx = lo.x + 1.5, hz = lo.z, j = Math.floor(hz / CELL) * W + Math.floor(hx / CELL), f = g.floorOf(i);
        if (g.cells[j] !== FLOOR || g.blocked[j] || g.rampIdx[j] >= 0 || Math.abs(g.floorOf(j) - f) > 0.01 || Math.abs((feetAt(w.L, hx, hz, f) ?? -999) - f) > 0.05) continue;
        return {lo, hi: {x: hx, y: f, z: hz, level: w.L.list[b].id}};
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
describe('root cause: the pre-fix reject skipped enemies on pitched rays; the exact reject never drops a volume hit', () => {
  it('a zombie one storey down a 30-degree line: volumes hit, the old reject skipped it; a level shot: both find it', () => {
    const z = place('zombie', {x: 10, y: -4, z: 10});
    const aim = aimPoint(z, 'torso');
    const down = {x: aim.x - 8, y: aim.y + 8 * Math.tan(Math.PI / 6), z: aim.z}; // 8 m away horizontally, 30 degrees down
    const d = dirTo(down, aim);
    expect(pitchDeg(d)).toBeCloseTo(-30, 1);
    expect(nearestEnemyHit(down, d, 90, [z])?.enemy).toBe(z);
    expect(preFixSkips(down, d, z.brain.x, z.brain.z, 90)).toBe(true); // 8 m x sin^2(30) = 2 m off the wrong point > 1.26 m
    const level = {x: aim.x - 8, y: aim.y, z: aim.z}, dl = dirTo(level, aim);
    expect(nearestEnemyHit(level, dl, 90, [z])?.enemy).toBe(z);
    expect(preFixSkips(level, dl, z.brain.x, z.brain.z, 90)).toBe(false);
  });

  it('brute-force parity over every pitch and every archetype: nearestEnemyHit = testing every volume of every enemy', () => {
    const R = mulberry32(31337);
    const enemies = ARCHETYPES.map((k, i) => place(k, {x: 20 + i * 3, y: i % 2 ? -5 : 4, z: 20 + (i % 3) * 2}, i));
    let hits = 0;
    for (let n = 0; n < 4000; n++) {
      const tgt = enemies[n % enemies.length], v = tgt.hitVolumes[Math.floor(R() * tgt.hitVolumes.length)];
      const pitch = (R() * 2 - 1) * 1.45, yaw = R() * Math.PI * 2, r = 2 + R() * 25;
      const aim = {x: v.a.x + (R() - 0.5) * 0.5, y: v.a.y + (R() - 0.5) * 0.5, z: v.a.z + (R() - 0.5) * 0.5};
      const o = {x: aim.x - Math.cos(pitch) * Math.sin(yaw) * r, y: aim.y - Math.sin(pitch) * r, z: aim.z - Math.cos(pitch) * Math.cos(yaw) * r};
      const d = dirTo(o, aim), maxT = R() < 0.2 ? r * R() : 90;
      let bestT = maxT, best: EnemyActor | null = null, part = '';
      for (const e of enemies) for (const q of e.hitVolumes) {
        const t = q.b ? rayCapsule(o, d, q.a, q.b, q.r) : raySphere(o, d, q.a, q.r);
        if (t < bestT) { bestT = t; best = e; part = q.part; }
      }
      const h = nearestEnemyHit(o, d, maxT, enemies);
      expect(h?.enemy ?? null).toBe(best);
      if (h) { expect(h.t).toBe(bestT); expect(h.part).toBe(part); hits++; }
      // the box entry never lies beyond a volume the ray reaches
      for (const e of enemies) {
        const ve = Math.min(...e.hitVolumes.map(q => q.b ? rayCapsule(o, d, q.a, q.b, q.r) : raySphere(o, d, q.a, q.r)));
        if (Number.isFinite(ve)) expect(volumesBoxEntry(o, d, e.hitVolumes)).toBeLessThanOrEqual(ve);
      }
    }
    expect(hits).toBeGreaterThan(1500); // (aims jittered +-0.25 m round a volume; a fifth of the rays stop short at a 'world' hit)
    // cost (logged only): a 9-pellet pull against 150 live enemies (the five actors repeated), every enemy tested on every pellet
    const crowd = Array.from({length: 150}, (_, i) => enemies[i % enemies.length]);
    const t0 = performance.now();
    for (let n = 0; n < 200; n++) for (let p = 0; p < 9; p++) nearestEnemyHit({x: 0, y: 2, z: 0}, dirTo({x: 0, y: 2, z: 0}, {x: 20 + p, y: 0, z: 20 + n % 7}), 90, crowd);
    out(`nearestEnemyHit: ${((performance.now() - t0) / 200).toFixed(3)} ms per 9-pellet pull vs 150 enemies (Node)`);
    // dead enemies / empty volumes are never hit
    const dead = place('zombie', {x: 50, y: 0, z: 50});
    const o = {x: 45, y: 6, z: 50}, d = dirTo(o, aimPoint(dead, 'torso'));
    expect(nearestEnemyHit(o, d, 90, [dead])?.enemy).toBe(dead);
    dead.brain.damage(9999, 0, 0);
    expect(nearestEnemyHit(o, d, 90, [dead])).toBe(null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('cross-storey shots on real generated levels (Subway multi-level, Office, Mall, Reactor)', () => {
  for (const name of ['subway', 'office', 'mall', 'reactor'] as const) {
    it(`${name}: down and up every stair link — the enemy on the other storey is hit (the pre-fix reject skipped them)`, () => {
      const w = world(name);
      const links = (w.layout.levelLinks ?? []).filter(k => k.kind === 'stairs');
      expect(w.L.count, w.name).toBeGreaterThan(1);
      expect(links.length).toBeGreaterThan(0);
      let down = 0, up = 0, preDown = 0, preUp = 0, heads = 0;
      for (const [i, k] of links.entries()) {
        for (const dir of ['down', 'up'] as const) {
          const from = dir === 'down' ? k.top : k.bottom, to = dir === 'down' ? k.bottom : k.top;
          const fy = feetAt(w.L, from.x, from.z, from.y), ty = feetAt(w.L, to.x, to.z, to.y);
          expect(fy, `${w.name} link ${k.id} ${dir}`).not.toBe(null);
          expect(ty, `${w.name} link ${k.id} ${dir}`).not.toBe(null);
          const eye = {x: from.x, y: fy! + EYE, z: from.z};
          const z = place('zombie', {x: to.x, y: ty!, z: to.z}, i);
          for (const part of ['torso', 'head'] as const) {
            const aim = aimPoint(z, part), d = dirTo(eye, aim);
            const {wh, hit} = shot(w, eye, d, WEAPONS.rifle.range, [z]);
            expect(wh.t, `${w.name} link ${k.id} ${dir} ${part}: the world ray reaches the enemy`).toBeGreaterThan(dist(eye, aim));
            expect(hit?.enemy, `${w.name} link ${k.id} ${dir} ${part} (pitch ${pitchDeg(d).toFixed(1)})`).toBe(z);
            expect(Math.abs(hit!.t - dist(eye, aim))).toBeLessThan(0.4);
            if (part === 'head' && hit!.part === 'head') heads++;
            if (part === 'torso') {
              if (dir === 'down') { down++; if (preFixSkips(eye, d, z.brain.x, z.brain.z, wh.t)) preDown++; }
              else { up++; if (preFixSkips(eye, d, z.brain.x, z.brain.z, wh.t)) preUp++; }
            }
          }
          z.dispose();
        }
      }
      out(`${w.name}: ${links.length} stair links — down ${down} hit (pre-fix skipped ${preDown}), up ${up} hit (pre-fix skipped ${preUp}), head aims -> head ${heads}`);
      expect(down).toBe(links.length);
      expect(up).toBe(links.length);
      expect(preDown + preUp, 'the root cause reproduces on these rays').toBeGreaterThan(0);
      expect(heads).toBeGreaterThan(0);
    });
  }

  for (const name of ['mall', 'reactor'] as const) {
    it(`${name}: across the ${name === 'mall' ? 'atrium' : 'pit'} — down and back up, every enemy archetype with its own volumes`, () => {
      const w = world(name);
      const pairs = voidPairs(w, 10);
      expect(pairs.length, w.name).toBeGreaterThanOrEqual(5);
      const byKind = new Map<EnemyArchetypeId, {down: number; up: number}>();
      let tested = 0, pre = 0, upTested = 0;
      for (const [i, {lo, hi}] of pairs.entries()) {
        for (let k = 0; k < ARCHETYPES.length; k++) {
          const kind = ARCHETYPES[(i + k) % ARCHETYPES.length];
          const rec = byKind.get(kind) ?? {down: 0, up: 0};
          byKind.set(kind, rec);
          // down: the enemy under the open void, the shooter on the higher storey
          const zl = place(kind, lo);
          const eye = {x: hi.x, y: hi.y + EYE, z: hi.z}, aim = aimPoint(zl, 'torso'), d = dirTo(eye, aim);
          const s = shot(w, eye, d, WEAPONS.rifle.range, [zl]);
          if (s.wh.t > dist(eye, aim) + 0.3) { // the real torso is in the clear (a low rat/dog may sit behind a kerb)
            expect(s.hit?.enemy, `${w.name} ${kind} down L${hi.level}->L${lo.level} pitch ${pitchDeg(d).toFixed(1)}`).toBe(zl);
            rec.down++; tested++;
            if (preFixSkips(eye, d, zl.brain.x, zl.brain.z, s.wh.t)) pre++;
          }
          zl.dispose();
          // up: the shooter under the void, the enemy on the higher storey (when its torso clears the deck edge)
          const zh = place(kind, hi);
          const eyeUp = {x: lo.x, y: lo.y + EYE, z: lo.z}, aimUp = aimPoint(zh, 'torso'), du = dirTo(eyeUp, aimUp);
          const su = shot(w, eyeUp, du, WEAPONS.rifle.range, [zh]);
          if (su.wh.t > dist(eyeUp, aimUp) + 0.3) {
            expect(su.hit?.enemy, `${w.name} ${kind} up L${lo.level}->L${hi.level} pitch ${pitchDeg(du).toFixed(1)}`).toBe(zh);
            rec.up++; upTested++;
          }
          zh.dispose();
        }
      }
      out(`${w.name}: ${pairs.length} void pairs, down shots ${tested} hit (pre-fix skipped ${pre}), up shots ${upTested} hit; ${[...byKind].map(([k, r]) => `${k} ${r.down}/${r.up}`).join(', ')}`);
      for (const kind of ARCHETYPES) expect(byKind.get(kind)!.down, `${w.name} ${kind} hit from above`).toBeGreaterThan(0);
      expect(upTested, 'shots up from under the void').toBeGreaterThan(0);
      expect(pre, 'the root cause reproduces on these rays').toBeGreaterThan(tested / 2);
    });
  }

  for (const name of ['subway', 'office', 'mall', 'reactor'] as const) {
    it(`${name}: a storey slab between shooter and enemy stops the bullet (down: its floor; up: its underside)`, () => {
      const w = world(name);
      const p = slabPair(w);
      expect(p, w.name).not.toBe(null);
      const {lo, hi} = p!;
      // down through the floor
      const z = place('zombie', lo), eye = {x: hi.x, y: hi.y + EYE, z: hi.z}, aim = aimPoint(z, 'torso'), d = dirTo(eye, aim);
      const s = shot(w, eye, d, WEAPONS.rifle.range, [z]);
      expect(s.wh.kind).toBe('floor');
      expect(s.wh.t).toBeLessThan(dist(eye, aim));
      expect(s.hit).toBe(null);
      expect(nearestEnemyHit(eye, d, Infinity, [z])?.enemy, 'only the slab protects it').toBe(z);
      // up through the slab underside
      const zu = place('zombie', hi), eu = {x: lo.x, y: lo.y + EYE, z: lo.z}, au = aimPoint(zu, 'torso'), du = dirTo(eu, au);
      const su = shot(w, eu, du, WEAPONS.rifle.range, [zu]);
      expect(su.wh.kind).toBe('ceiling');
      expect(su.wh.t).toBeLessThan(dist(eu, au));
      expect(su.hit).toBe(null);
      expect(nearestEnemyHit(eu, du, Infinity, [zu])?.enemy).toBe(zu);
      out(`${w.name}: slab L${hi.level} over L${lo.level} at (${lo.x}, ${lo.z}): down -> ${s.wh.kind} at ${s.wh.t.toFixed(2)} m, up -> ${su.wh.kind} at ${su.wh.t.toFixed(2)} m`);
      z.dispose(); zu.dispose();
    });
  }

  it('office: a closed lift landing door stops the bullet; open, the same shot hits the zombie in the cab', () => {
    const w = world('office');
    const info = readTowerInfo(w.layout as never)!, el = info.elevator!;
    const plan = planElevator(el);
    const L = new Levels(w.layout.levels!, w.layout.levelLinks ?? [], w.layout.rails); // (a private Levels: the volume stays out of the cache)
    const G = plan.gate, s = el.stops[Math.min(2, el.stops.length - 1)];
    const along = Math.abs(G.nx) > 0.5 ? G.cz : G.cx;
    const gate: VolumeGate = {side: el.doorSide, a0: along - G.hw, a1: along + G.hw, depth: G.depth, height: plan.doorH, open: false};
    const vol: DynamicVolume = {x0: el.cab.x0, z0: el.cab.z0, x1: el.cab.x1, z1: el.cab.z1, floorY: s.y, ceilY: s.y + plan.cabH, level: s.levelId, area: s.area,
      gates: [gate], stops: el.stops.map(q => q.y), name: 'elevator-cab'}; // (world/towerRuntime.ts: the cab parked at that stop)
    L.addDynamicVolume(vol);
    const cab = {x: (el.cab.x0 + el.cab.x1) / 2, y: s.y, z: (el.cab.z0 + el.cab.z1) / 2};
    expect(feetAt(L, cab.x, cab.z, s.y)).toBeCloseTo(s.y, 3);
    const z = place('zombie', cab);
    const stand = {x: G.cx + G.nx * (G.depth + 2.5), z: G.cz + G.nz * (G.depth + 2.5)};
    expect(feetAt(L, stand.x, stand.z, s.y)).toBeCloseTo(s.y, 3);
    const eye = {x: stand.x, y: s.y + EYE, z: stand.z}, aim = aimPoint(z, 'torso'), d = dirTo(eye, aim);
    const closed = shot({layout: w.layout, L}, eye, d, WEAPONS.pistol.range, [z]);
    expect(closed.wh.kind).toBe('wall');
    expect(closed.wh.t).toBeLessThan(dist(eye, aim));
    expect(closed.hit).toBe(null);
    gate.open = true;
    const open = shot({layout: w.layout, L}, eye, d, WEAPONS.pistol.range, [z]);
    expect(open.hit?.enemy).toBe(z);
    z.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('all three guns across storeys: parts, pellets resolved once, one damage per enemy per shot (Game.fire aggregation)', () => {
  /** One trigger pull as Game.fire resolves it: per pellet the world ray, then the nearest enemy before it; damage summed per enemy. */
  function pull(w: World, def: WeaponDef, eye: Vec3, aim: Vec3, spread: number, enemies: EnemyActor[], R: () => number) {
    const fwd = new THREE.Vector3(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const dmg = new Map<EnemyActor, {total: number; pellets: number; head: boolean}>();
    const pellets: ('enemy' | 'world' | 'none')[] = [];
    for (let i = 0; i < def.pellets; i++) {
      const a = R() * Math.PI * 2, r = spread * Math.sqrt(R());
      const dir = fwd.clone().addScaledVector(right, Math.tan(r) * Math.cos(a)).addScaledVector(up, Math.tan(r) * Math.sin(a)).normalize();
      const {wh, hit} = shot(w, eye, {x: dir.x, y: dir.y, z: dir.z}, def.range, enemies);
      pellets.push(hit ? 'enemy' : wh.kind === 'none' ? 'none' : 'world');
      if (!hit) continue;
      const mult = hit.part === 'head' ? def.headMult : hit.part === 'limb' ? def.limbMult : 1;
      const e = dmg.get(hit.enemy) ?? {total: 0, pellets: 0, head: false};
      e.total += def.damage * WeaponController.falloff(def, hit.t) * mult; e.pellets++; e.head ||= hit.part === 'head';
      dmg.set(hit.enemy, e);
    }
    return {dmg, pellets};
  }

  it('pistol / rifle: one round down the Reactor pit takes the head x headMult or the body x 1; shotgun: 9 pellets, each resolved once', () => {
    const w = world('reactor');
    const pair = voidPairs(w, 10).filter(p => dist({...p.hi, y: p.hi.y + EYE}, {...p.lo, y: p.lo.y + 1.2}) < 14)[0];
    expect(pair).toBeTruthy();
    const eye = {x: pair.hi.x, y: pair.hi.y + EYE, z: pair.hi.z};
    for (const id of ['pistol', 'rifle'] as const) {
      const def = WEAPONS[id];
      for (const part of ['head', 'torso'] as const) {
        const z = place('zombie', pair.lo), hp0 = z.brain.hp, aim = aimPoint(z, part);
        const {dmg, pellets} = pull(w, def, eye, aim, 0, [z], mulberry32(5));
        expect(pellets).toEqual(['enemy']);
        const e = dmg.get(z)!;
        expect(e.pellets).toBe(1);
        const h = nearestEnemyHit(eye, dirTo(eye, aim), 90, [z])!;
        if (part === 'head') expect(h.part).toBe('head'); else expect(h.part).not.toBe('head'); // (a body aim may take an arm first: limb)
        expect(e.head).toBe(part === 'head');
        expect(e.total).toBeCloseTo(def.damage * WeaponController.falloff(def, h.t) * (h.part === 'head' ? def.headMult : h.part === 'limb' ? def.limbMult : 1), 6);
        for (const [q, x] of dmg) q.brain.damage(x.total, eye.x, eye.z, eye.y); // once per enemy per shot (Game.fire)
        expect(hp0 - z.brain.hp).toBeCloseTo(Math.min(hp0, e.total), 6);
        z.dispose();
      }
    }
    // shotgun (aimed spread): two zombies side by side on the lower storey, nine pellets
    const def = WEAPONS.shotgun, R = mulberry32(99);
    let enemyPellets = 0, hitBoth = false;
    for (let pullN = 0; pullN < 6; pullN++) {
      const a = place('zombie', pair.lo), b = place('zombie', {x: pair.lo.x + 0.75, y: pair.lo.y, z: pair.lo.z}, 1.2);
      const hp = [a.brain.hp, b.brain.hp], aim = aimPoint(a, 'torso');
      const {dmg, pellets} = pull(w, def, eye, {x: aim.x + 0.35, y: aim.y, z: aim.z}, def.spreadAim, [a, b], R);
      expect(pellets.length).toBe(9); // one outcome per pellet: an enemy XOR the world (or nothing in range)
      const counted = [...dmg.values()].reduce((n, e) => n + e.pellets, 0);
      expect(counted).toBe(pellets.filter(p => p === 'enemy').length);
      enemyPellets += counted;
      if (dmg.size === 2) hitBoth = true;
      for (const [q, x] of dmg) q.brain.damage(x.total, eye.x, eye.z, eye.y);
      expect(hp[0] - a.brain.hp).toBeCloseTo(Math.min(hp[0], dmg.get(a)?.total ?? 0), 6);
      expect(hp[1] - b.brain.hp).toBeCloseTo(Math.min(hp[1], dmg.get(b)?.total ?? 0), 6);
      a.dispose(); b.dispose();
    }
    out(`reactor shotgun: ${enemyPellets} / 54 pellets on the two zombies one storey down; both hit in one pull: ${hitBoth}`);
    expect(enemyPellets).toBeGreaterThan(15);
    expect(hitBoth).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('render culling never removes a hit target', () => {
  it('Reactor: an enemy the tracked-actor culling hides (CULL_LAYER, fog distance) is still hit down the pit', () => {
    const w = world('reactor');
    const levels = stationLevels(w.layout);
    const mats = new WorldMaterials(fakeEnvTextures(), 20261102, {w: 0.6, h: 0.2, d: 0.6});
    const arch = ReactorArch.for(w.layout, mats, levels)!;
    expect(arch).toBeTruthy();
    const cols = new LevelColumns(levels);
    const culler = new LevelCuller(levels, cols, () => 0, {atrium: arch.pitMask, slabs: {see: arch.occlusionSee(), glass: []}});
    const anchor = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    m.userData.level = levels[0].id;
    anchor.add(m);
    culler.register(anchor); // (update() decides nothing without registered meshes)
    const pair = voidPairs(w, 4)[0];
    const z = place('zombie', pair.lo);
    const tracking = new ReactorCpuCulling({frameHooks: [], sectionHooks: [], layout: w.layout, world: {culler}, zombies: [z], pickups: null});
    tracking.sync();
    expect(culler.trackedCount).toBe(1);
    const eye = {x: pair.hi.x, y: pair.hi.y + EYE, z: pair.hi.z}, aim = aimPoint(z, 'torso');
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
    cam.position.set(eye.x, eye.y, eye.z);
    cam.lookAt(aim.x, aim.y, aim.z);
    culler.maxDistance = 2; // the fog hides it (it stands ~10 m away)
    culler.update(cam, true);
    expect(culler.trackedCulled).toBe(1);
    let meshes = 0;
    z.root.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; expect(o.layers.mask).toBe((1 << CULL_LAYER) >>> 0); } });
    expect(meshes).toBeGreaterThan(0);
    // the game keeps animating it and refreshing its volumes; the bullet still finds it
    pose(z);
    const s = shot(w, eye, dirTo(eye, aim), WEAPONS.rifle.range, [z]);
    expect(s.hit?.enemy).toBe(z);
    // shown again: the same answer
    culler.maxDistance = Infinity;
    culler.update(cam, true);
    expect(culler.trackedCulled).toBe(0);
    expect(shot(w, eye, dirTo(eye, aim), WEAPONS.rifle.range, [z]).hit?.enemy).toBe(z);
    tracking.clear();
    z.dispose();
  });

  it('every archetype: meshes on CULL_LAYER and the root invisible change nothing (the test reads the brain and the volumes only)', () => {
    const w = world('office');
    const k = (w.layout.levelLinks ?? []).find(l => l.kind === 'stairs')!;
    const eye = {x: k.top.x, y: feetAt(w.L, k.top.x, k.top.z, k.top.y)! + EYE, z: k.top.z};
    for (const kind of ARCHETYPES) {
      const z = place(kind, {x: k.bottom.x, y: feetAt(w.L, k.bottom.x, k.bottom.z, k.bottom.y)!, z: k.bottom.z});
      const aim = aimPoint(z, 'torso'), d = dirTo(eye, aim);
      const before = shot(w, eye, d, WEAPONS.pistol.range, [z]).hit;
      z.root.traverse(o => o.layers.set(CULL_LAYER));
      z.root.visible = false;
      const after = shot(w, eye, d, WEAPONS.pistol.range, [z]).hit;
      expect(before?.enemy, kind).toBe(z);
      expect(after?.enemy, kind).toBe(z);
      expect(after!.t).toBe(before!.t);
      // hidden, it keeps animating and its volumes keep following the pose (Game.updateZombies never asks about visibility)
      const vols = z.hitVolumes;
      pose(z);
      expect(z.hitVolumes).not.toBe(vols);
      expect(shot(w, eye, dirTo(eye, aimPoint(z, 'torso')), WEAPONS.pistol.range, [z]).hit?.enemy, kind).toBe(z);
      z.dispose();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('wiring (source): Game.fire and the damage QA shot use the one enemy test; no storey / render filter on the bullet path', () => {
  const src = readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
  const body = (s: string, name: string) => { const i = s.indexOf(`  private ${name}(`); return s.slice(i, s.indexOf('\n  }\n', i)); };
  it('fire(): per pellet the world ray, then nearestEnemyHit before it; the pre-fix reject is gone', () => {
    const fire = body(src, 'fire');
    expect(fire).toContain('const wh = raycastWorld(this.levels, this.layout.props, o, d, def.range, this.layout.trench.floorY);');
    expect(fire).toContain('const eh = nearestEnemyHit(o, d, bestT, this.zombies);');
    expect(fire.indexOf('nearestEnemyHit(')).toBeGreaterThan(fire.indexOf('for (let i = 0; i < def.pellets; i++)'));
    expect(fire).not.toMatch(/> 1\.6\) continue/);
    expect(fire).not.toMatch(/hitVolumes|sameLevel|layers|\.visible/);
    const qa = readFileSync(path.join(GAME, 'src/damage/qa.ts'), 'utf8');
    expect(qa).toContain('nearestEnemyHit(o, d, bestT, game.zombies)');
  });
});
