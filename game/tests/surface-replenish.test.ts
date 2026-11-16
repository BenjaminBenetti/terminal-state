// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): SURFACE RUN's OUTDOOR REPLENISHER (world/surface/replenish.ts) on a
// real district layout (LEVELS.<host>.generate('surface'): its grid, its Levels line of sight and body-circle checks), driven by a host
// that stands in for the Game (world/surface/replenishRuntime.ts does the same calls on the real one):
//  - the active population stays bounded over a long simulated run, kills are replenished indefinitely, outdoor bodies are retired
//    within their caps (never more than cap + corpseHard outdoor actors), far unseen actors despawn, seen ones never vanish;
//  - every spawn is 35-80 m from the player, on a standable OUTDOOR street cell, outside the safe box / every building / the truck,
//    outside the view cone AND out of line of sight (checked independently here);
//  - nothing happens while the game is not playing (pause / menus / the planning map / loading);
//  - RNG neutrality: the replenisher draws only its own stream (deterministic per district seed + visit, never Math.random, never a
//    station stream), and the outdoor family pool is the host level's own spawn table (no Siren / roster-only / context-locked family).
import {describe, expect, it, vi} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {ENEMY_FAMILY_IDS} from '../src/ai/spawnTables';
import {
  OutdoorReplenisher, REPLENISH, inViewCone, outdoorFamilyPool, outdoorRulesOf, pickFamily, standableOn, viewerOf,
  type ReplenishHost, type Viewer,
} from '../src/world/surface/replenish';
import {mulberry32} from '../src/core/rng';

interface Actor { brain: {x: number; y: number; z: number; alive: boolean}; serial: number }

const district = (host: 'subway' | 'office' | 'mall', seed: number) => {
  const layout = LEVELS[host].generate('surface', {levelSeed: seed}) as StationLayout;
  return {layout, s: layout.surface as SurfaceInfo, L: levelsOf(layout)};
};

/** A Game stand-in on a real district: the player walks a loop round the core's streets. */
function sim(host: 'subway' | 'office' | 'mall' = 'subway', seed = 7, o: {visit?: number; seesAll?: boolean} = {}) {
  const {layout, s, L} = district(host, seed);
  const outdoor = new Set(s.outdoor.areas.length ? s.outdoor.areas : s.outdoorAreas);
  const player = {x: s.portal.pose.x, z: s.portal.pose.z, yaw: s.portal.pose.yaw, pitch: 0, eye: 1.6};
  const world: Actor[] = [];
  const spawned: {spawn: ZombieSpawn; v: Viewer; index: number}[] = [];
  const state = {active: true, removed: 0, seesAll: !!o.seesAll};
  const truck = {x: s.truck.x, z: s.truck.z, r: 3.5};
  const h: ReplenishHost<Actor> = {
    spawn: (spawn, index, rand) => {
      expect(typeof rand).toBe('function');
      const a: Actor = {brain: {x: spawn.x, y: spawn.y ?? 0, z: spawn.z, alive: true}, serial: index};
      world.push(a);
      spawned.push({spawn, v: h.viewer(), index});
      return a;
    },
    remove: a => { const i = world.indexOf(a); expect(i).toBeGreaterThanOrEqual(0); world.splice(i, 1); state.removed++; },
    // (seesAll: a view that sees everything — a cone round the whole sphere and every line clear)
    viewer: () => ({...viewerOf({x: player.x, y: player.eye, z: player.z}, player.yaw, player.pitch, 75, 16 / 9), ...(state.seesAll ? {halfH: Math.PI, halfV: Math.PI} : {})}),
    lineOfSight: (a, b) => (state.seesAll ? true : L.lineOfSight(a, b)),
    standable: (x, z, r) => standableOn(L.main, (a, b, c, d) => L.circleClear(a, b, c, d), outdoor, x, z, r),
    truck: () => truck,
    active: () => state.active,
  };
  const pool = outdoorFamilyPool(host);
  const rep = new OutdoorReplenisher<Actor>(h, outdoorRulesOf(s), {seed: s.seed, visit: o.visit ?? 1, pool, coatedChance: 0.4});
  // the loop: the street centre lines round the core
  const xs = s.core.x0, xe = s.core.x1, zs = s.core.z0, ze = s.core.z1;
  const loop = [[xs, ze], [xs, zs], [xe, zs], [xe, ze]] as const;
  let leg = 0, legT = 0;
  const walk = (dt: number, speed = 3) => {
    const [ax, az] = loop[leg % 4], [bx, bz] = loop[(leg + 1) % 4], len = Math.hypot(bx - ax, bz - az);
    legT += dt * speed;
    if (legT >= len) { legT -= len; leg++; }
    const f = Math.min(1, legT / len);
    player.x = ax + (bx - ax) * f; player.z = az + (bz - az) * f;
    player.yaw = Math.atan2(-(bx - ax), -(bz - az)); // facing along the walk (forward = (-sin yaw, -cos yaw))
  };
  // the zombies' stand-in brain: those within 70 m shamble straight at the player (1.4 m/s)
  const chase = (dt: number) => {
    for (const a of world) {
      if (!a.brain.alive) continue;
      const dx = player.x - a.brain.x, dz = player.z - a.brain.z, d = Math.hypot(dx, dz);
      if (d < 70 && d > 1) { a.brain.x += dx / d * 1.4 * dt; a.brain.z += dz / d * 1.4 * dt; }
    }
  };
  return {layout, s, L, outdoor, player, world, spawned, state, rep, walk, chase, truck, pool};
}

describe('Surface Run outdoor replenisher: rules', () => {
  it('the outdoor pool is the host level spawn table as a street context reads it (no Siren / roster-only / context-locked family)', () => {
    for (const host of ['subway', 'office', 'mall'] as const) {
      const pool = outdoorFamilyPool(host);
      expect(pool.map(([f]) => f)).toEqual([...ENEMY_FAMILY_IDS]); // the roll order
      const w = Object.fromEntries(pool);
      expect(w.siren).toBe(0);
      expect(w.screacher).toBe(0);
      expect(w.bb).toBe(0);
      expect(w.strainer).toBe(0);
      expect(w.zombie).toBeGreaterThan(0.85);
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
    expect(Object.fromEntries(outdoorFamilyPool('subway'))).toMatchObject({zombie: 0.9, blightbelly: 0.05, ratdog: 0.05});
    const r = mulberry32(5), picks = new Map<string, number>();
    for (let k = 0; k < 4000; k++) { const f = pickFamily(outdoorFamilyPool('office'), r); picks.set(f, (picks.get(f) ?? 0) + 1); }
    expect(picks.get('siren')).toBeUndefined();
    expect((picks.get('zombie') ?? 0) / 4000).toBeGreaterThan(0.85);
  });

  it('the view cone matches the camera frustum (in front within the half-angles, never behind)', () => {
    const v = viewerOf({x: 0, y: 1.6, z: 0}, 0, 0, 75, 16 / 9); // looking down -z
    expect(inViewCone(v, {x: 0, y: 1.6, z: -40}, 0)).toBe(true);
    expect(inViewCone(v, {x: 0, y: 1.6, z: 40}, 0)).toBe(false);
    expect(inViewCone(v, {x: 40, y: 1.6, z: -1}, 0)).toBe(false); // 88 deg to the right
    expect(inViewCone(v, {x: 40, y: 1.6, z: -40}, 0)).toBe(true); // 45 deg: inside the ~53.7 deg half width
    expect(inViewCone(v, {x: 0, y: 60, z: -40}, 0)).toBe(false); // far above the vertical half-angle
    const right = viewerOf({x: 0, y: 1.6, z: 0}, -Math.PI / 2, 0, 75, 16 / 9); // looking down +x
    expect(inViewCone(right, {x: 30, y: 1.6, z: 0}, 0)).toBe(true);
    expect(inViewCone(right, {x: -30, y: 1.6, z: 0}, 0)).toBe(false);
  });
});

describe('Surface Run outdoor replenisher: a long simulated run', () => {
  it('bounded population, indefinite replenishment, legal off-camera outdoor spawns, bounded bodies', () => {
    const t = sim('subway', 7);
    const {rep, world, spawned, player, s, L, outdoor} = t;
    const r = mulberry32(99);
    expect(rep.seed()).toBeGreaterThan(0); // the build's initial population (before the warm-up)
    let maxAlive = rep.alive, maxActors = world.length, kills = 0;
    const dt = 0.1, minutes = 16;
    const randSpy = vi.spyOn(Math, 'random');
    for (let k = 0; k < minutes * 600; k++) {
      t.walk(dt);
      t.chase(dt);
      rep.tick(dt);
      // the player shoots what comes near: each second a live outdoor zombie within 40 m dies with 25 % chance
      if (k % 10 === 0) for (const a of world) if (a.brain.alive && Math.hypot(a.brain.x - player.x, a.brain.z - player.z) < 40 && r() < 0.25) { a.brain.alive = false; kills++; }
      maxAlive = Math.max(maxAlive, rep.alive);
      maxActors = Math.max(maxActors, world.length);
      expect(rep.corpses).toBeLessThanOrEqual(REPLENISH.corpseHard + 1); // (a body counts the frame it falls, retired at the next sweep)
    }
    expect(randSpy).not.toHaveBeenCalled(); // never Math.random: the replenisher's own stream only
    randSpy.mockRestore();
    expect(maxAlive).toBeLessThanOrEqual(REPLENISH.cap);
    expect(maxActors).toBeLessThanOrEqual(REPLENISH.cap + REPLENISH.corpseHard + 1);
    expect(kills).toBeGreaterThan(REPLENISH.cap * 2); // the player killed far more than one population ...
    expect(rep.counts.spawned).toBeGreaterThan(kills); // ... and they kept coming
    expect(rep.alive).toBeGreaterThan(REPLENISH.cap / 2); // the population is replenished at the end too
    expect(world.length).toBe(rep.alive + rep.corpses);
    // every spawn, checked independently
    const rules = outdoorRulesOf(s);
    expect(rules.zones.length).toBeGreaterThan(0); // GEN's real spawn zones: never the anywhere-outdoors fallback
    expect(rep.qa()).toMatchObject({anywhereOutdoors: false, safe: true});
    for (const {spawn, v} of spawned) {
      expect(rules.zones.some(r => spawn.x >= r.x0 && spawn.x <= r.x1 && spawn.z >= r.z0 && spawn.z <= r.z1)).toBe(true); // inside a spawn zone
      const d = Math.hypot(spawn.x - v.x, spawn.z - v.z);
      expect(d).toBeGreaterThanOrEqual(REPLENISH.spawnMin - 1e-6);
      expect(d).toBeLessThanOrEqual(REPLENISH.spawnMax + 1e-6);
      const [cx, cy] = L.main.cellOf(spawn.x, spawn.z), i = L.main.idx(cx, cy);
      expect(outdoor.has(L.main.area[i])).toBe(true); // an outdoor street cell
      expect(spawn.level).toBe(0);
      expect(L.circleClear(spawn.x, spawn.z, REPLENISH.clearR, spawn.y ?? 0)).toBe(true);
      expect(rules.footprints.some(f => spawn.x >= f.x0 && spawn.x <= f.x1 && spawn.z >= f.z0 && spawn.z <= f.z1)).toBe(false); // never in a building
      const sf = s.outdoor.safe;
      expect(spawn.x >= sf.x0 && spawn.x <= sf.x1 && spawn.z >= sf.z0 && spawn.z <= sf.z1).toBe(false); // never at the checkpoint / portal
      expect(Math.hypot(spawn.x - t.truck.x, spawn.z - t.truck.z)).toBeGreaterThan(t.truck.r); // never on the truck
      // off-camera: outside the horizontal half-angle (the camera's 53.7 deg at 16:9, 75 deg vertical) and no line of sight
      const ang = Math.abs(Math.atan2((spawn.x - v.x) * -v.dz + (spawn.z - v.z) * v.dx, (spawn.x - v.x) * v.dx + (spawn.z - v.z) * v.dz));
      expect(ang).toBeGreaterThan(v.halfH);
      expect(L.lineOfSight(v, {x: spawn.x, y: (spawn.y ?? 0) + 1.6, z: spawn.z})).toBe(false);
      expect(L.lineOfSight(v, {x: spawn.x, y: (spawn.y ?? 0) + 1.0, z: spawn.z})).toBe(false);
      expect(spawn.archetype === undefined || ['blightbelly', 'ratdog'].includes(spawn.archetype)).toBe(true);
    }
    // indices are look indices far beyond any layout index (never a kill-memory identity)
    expect(Math.min(...spawned.map(x => x.index))).toBeGreaterThanOrEqual(REPLENISH.indexBase);
  }, 120000);

  it('every host district: GEN\'s spawn zones and safe box are used (no anywhere-outdoors fallback); the initial population stands in them', () => {
    for (const host of ['subway', 'office', 'mall'] as const) for (const seed of [3, 7]) {
      const t = sim(host, seed);
      const rules = outdoorRulesOf(t.s);
      expect(rules.zones.length, `${host} ${seed}`).toBeGreaterThan(0);
      expect(rules.safe).not.toBeNull();
      const sf = t.s.outdoor.safe;
      expect(sf.x1 - sf.x0).toBeGreaterThan(0);
      expect(t.rep.seed(), `${host} ${seed}`).toBeGreaterThan(0);
      expect(t.rep.qa()).toMatchObject({anywhereOutdoors: false});
      for (const {spawn} of t.spawned) {
        expect(rules.zones.some(r => spawn.x >= r.x0 && spawn.x <= r.x1 && spawn.z >= r.z0 && spawn.z <= r.z1)).toBe(true);
        expect(spawn.x >= sf.x0 && spawn.x <= sf.x1 && spawn.z >= sf.z0 && spawn.z <= sf.z1).toBe(false);
      }
    }
  }, 120000);

  it('far unseen actors despawn after the unseen delay; seen ones are kept up to the hard distance; a see-everything view spawns none', () => {
    const t = sim('subway', 7);
    t.rep.seed(REPLENISH.cap);
    const first = [...t.world];
    expect(first.length).toBeGreaterThan(4);
    // the player is suddenly ~150 m away (a fast move): seen from there (a view that sees everything), the 110-220 m ones stay, > 220 m go
    t.player.x += 150;
    t.state.seesAll = true;
    for (let k = 0; k < 100; k++) t.rep.tick(0.1); // 10 s
    const far = (a: Actor) => Math.hypot(a.brain.x - t.player.x, a.brain.z - t.player.z);
    for (const a of first) {
      if (far(a) <= REPLENISH.hardM) expect(t.world.includes(a)).toBe(true); // in view: never vanishes
      else expect(t.world.includes(a)).toBe(false);
    }
    expect(t.rep.counts.spawned).toBe(first.length); // and nothing spawns while everything is in view
    // out of view again: every one beyond 110 m goes once unseen for 3 s — not before
    t.state.seesAll = false;
    for (let k = 0; k < 20; k++) t.rep.tick(0.1); // 2 s
    const beyond = first.filter(a => far(a) > REPLENISH.despawnM && t.world.includes(a));
    for (let k = 0; k < 30; k++) t.rep.tick(0.1); // + 3 s
    for (const a of beyond) expect(t.world.includes(a)).toBe(false);
    for (const a of first.filter(x => far(x) <= REPLENISH.despawnM)) expect(t.world.includes(a)).toBe(true); // near ones are never despawned
    expect(t.rep.counts.despawned).toBeGreaterThanOrEqual(beyond.length);
    // a see-everything view refuses every candidate (in view / line of sight)
    const u = sim('subway', 7);
    u.state.seesAll = true;
    expect(u.rep.seed(4)).toBe(0);
    expect((u.rep.counts.rejected['in-view'] ?? 0) + (u.rep.counts.rejected['line-of-sight'] ?? 0)).toBeGreaterThan(0);
  }, 60000);

  it('outdoor bodies: never more than corpseHard, and more than corpseSoft only while they are in view', () => {
    const t = sim('subway', 11);
    t.rep.seed(REPLENISH.cap);
    const r = mulberry32(3);
    let maxCorpses = 0;
    for (let k = 0; k < 6000; k++) {
      t.walk(0.1, 1.5);
      t.rep.tick(0.1);
      for (const a of t.world) if (a.brain.alive && r() < 0.01) a.brain.alive = false; // kills everywhere, in and out of view
      maxCorpses = Math.max(maxCorpses, t.rep.corpses);
    }
    expect(maxCorpses).toBeLessThanOrEqual(REPLENISH.corpseHard + 1);
    expect(t.rep.counts.retired).toBeGreaterThan(0);
    expect(t.rep.alive).toBeLessThanOrEqual(REPLENISH.cap);
  }, 120000);

  it('pause / menus / loading: no spawn, no despawn, no retirement; teardown forgets everything', () => {
    const t = sim('subway', 7);
    t.rep.seed();
    for (const a of t.world.slice(0, 3)) a.brain.alive = false;
    const snap = {spawned: t.rep.counts.spawned, removed: t.state.removed, world: t.world.length};
    t.state.active = false;
    for (let k = 0; k < 3000; k++) { t.walk(0.1, 6); t.rep.tick(0.1); } // 5 min "paused" while the player pose moves
    expect(t.rep.counts.spawned).toBe(snap.spawned);
    expect(t.state.removed).toBe(snap.removed);
    expect(t.world.length).toBe(snap.world);
    t.state.active = true;
    for (let k = 0; k < 50; k++) t.rep.tick(0.1);
    expect(t.rep.counts.spawned + t.state.removed).toBeGreaterThan(snap.spawned + snap.removed); // resumes in play
    t.rep.reset();
    expect(t.rep.actors()).toEqual([]);
    expect(t.rep.alive).toBe(0);
  }, 60000);

  it('RNG: deterministic per district seed + visit, different per visit, and independent of any station stream', () => {
    const run = (visit: number) => {
      const t = sim('office', 21, {visit});
      t.rep.seed(10);
      for (let k = 0; k < 600; k++) { t.walk(0.1); t.rep.tick(0.1); }
      return t.spawned.map(x => `${x.spawn.x.toFixed(3)},${x.spawn.z.toFixed(3)},${x.spawn.type},${x.spawn.archetype ?? 'zombie'}`);
    };
    const a = run(1), b = run(1), c = run(2);
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    // a station stream drawn alongside is exactly the stream drawn alone (the replenisher holds no reference to it)
    const alone = mulberry32(12345), along = mulberry32(12345);
    const seqAlone = Array.from({length: 50}, () => alone());
    const t = sim('subway', 7);
    const seqAlong: number[] = [];
    for (let k = 0; k < 50; k++) { t.rep.tick(0.5); seqAlong.push(along()); }
    expect(seqAlong).toEqual(seqAlone);
  }, 120000);
});
