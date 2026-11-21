// Task studio-surface-tent-first-staging-20261120-225458-01 (lead): THE STAGED COMMAND TENT (world/surface/tentShell.ts) — the loading space
// of a version-2 up-crossing, on the real districts of the three hosts (the Subway lift, the Office / Mall connector), without a Game
// (tests/surface-tent-first-staging.test.ts drives the real one):
//  - built from the district's own layout: wall faces, floor, doorway soffit / frame, the arch's roof + flap, the kit and the crate's closed
//    body, all at the tent's place; nothing of the district outside the tent; no layout / prop / RNG change;
//  - ENCLOSED: the real Player on the shell's collision (the district's levels + the tent's props + the closed flap) walking in every
//    direction from the arrival, and straight at the flap, stays in the tent;
//  - drawSealed draws the shell + the kept roots only, and a light added after begin() (the district's field light) is left out; every
//    layer is given back; the lent lamps move to the tent's lamps and go back (off without a train);
//  - dispose releases its own geometry only; the decay field it made is handed to the build once (world/decay.ts primeDecayField).
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import {connectorToWorld} from '../src/gen/surface/connectorShape';
import type {StationLayout} from '../src/gen/stationTypes';
import {isContainerKind} from '../src/items/loot';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {CULL_LAYER} from '../src/world/levelCulling';
import {WorldMaterials} from '../src/world/materials';
import {stationLevels} from '../src/world/levelGeometry';
import {activeDecayField, applyStationDecaySteps} from '../src/world/decay';
import {TENT_SHELL, buildTentShellSteps, tentProps, type CrateModelSource, type TentShell} from '../src/world/surface/tentShell';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

const SEAL = (1 << CULL_LAYER) >>> 0;
const HOSTS = ['subway', 'office', 'mall'] as const;
const firstSeed = (host: (typeof HOSTS)[number]): number => {
  for (let s = 1; s < 5000; s++) if (surfacePresent(host, s, SURFACE_VERSION)) return s;
  throw new Error(`no ${host} seed with a Surface Run`);
};
const district = (host: (typeof HOSTS)[number], s: number): StationLayout => LEVELS[host].generate('surface', {levelSeed: s, surfaceVersion: SURFACE_VERSION});
/** The arrival's feet in the tent: the car's gate (Subway) / just past the tube's tent mouth (Office, Mall) — as the runtimes' exitPoint. */
const arrival = (L: StationLayout): {x: number; y: number; z: number} => {
  const P = L.surface!.portal;
  if (P.lift) return {x: P.lift.door.x, y: P.lift.y, z: P.lift.door.z};
  const c = P.connector!, [x, z] = connectorToWorld(c, c.len + 0.35, 0);
  return {x, y: c.y, z};
};
const drain = <T>(g: Generator<unknown, T, unknown>): {value: T; yields: number} => { let n = 0; for (;;) { const r = g.next(); if (r.done) return {value: r.value, yields: n}; n++; } };
/** The crate's closed body: one box per part (the openables' model in the game). */
const crates: CrateModelSource = {model: () => ({body: [{geo: new THREE.BoxGeometry(0.8, 0.5, 0.5), mat: new THREE.MeshBasicMaterial()}], closed: [{geo: new THREE.BoxGeometry(0.8, 0.05, 0.5), mat: new THREE.MeshBasicMaterial()}]})};
const shellOf = (L: StationLayout): TentShell => drain(buildTentShellSteps(L, {mats, crates})).value!;

class Keys implements MoveInput {
  readonly held = new Set<string>();
  down(c: string): boolean { return this.held.has(c); }
  hit(): boolean { return false; }
}

describe('the staged command tent on real version-2 districts', () => {
  for (const host of HOSTS) {
    it(`${host}: built from the district's own tent — walls, floor, roof + flap, kit, crate — at its place, nothing else, nothing changed`, () => {
      const L = district(host, firstSeed(host));
      const before = JSON.stringify({props: L.props, pickups: L.pickups, lights: L.lights, doors: L.doors, seed: L.seed});
      const {value: shell, yields} = drain(buildTentShellSteps(L, {mats, crates}));
      expect(shell, 'the district has a staged tent').toBeTruthy();
      const s = shell!.stats;
      expect(yields, 'built in steps').toBeGreaterThan(4);
      expect(s.faces, 'its wall faces').toBeGreaterThan(4);
      expect(s.floors, 'its floor').toBeGreaterThan(0);
      expect(s.kit, 'its kit (the map table, cots, …)').toBeGreaterThan(0);
      const inTent = tentProps(L, shell!.box);
      expect(s.props).toBe(inTent.length);
      expect(s.crate, 'the supply crate\'s closed body').toBe(inTent.filter(p => isContainerKind(p.kind)).length);
      expect(s.skipped, 'every kind in the tent is shown').toEqual([]);
      expect(shell!.root.getObjectByName('surface-tent-flap'), 'the arch\'s own flap').toBeTruthy();
      expect(s.lamps, 'no lamp lent before begin()').toBe(0);
      expect(shell!.lamps.length, 'the tent\'s ridge lamps').toBeGreaterThan(0);
      for (const p of shell!.lamps) expect(shell!.contains(p.x, p.y, p.z)).toBe(true);
      // at the tent: every mesh's bounds meet the tent's box grown by a few metres (the guy lines reach the ground beside it)
      const near = shell!.box.clone().expandByScalar(TENT_SHELL.marginCells * 2 + 3);
      const b = new THREE.Box3();
      shell!.root.updateMatrixWorld(true);
      shell!.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        b.setFromObject(m, true);
        expect(near.intersectsBox(b), `${m.name} at the tent`).toBe(true);
        // (a face of the tent's wall line may rise past the eave: the district's own face there — its bounds meet the tent, not its centre)
      });
      // the arrival stands in it; the layout as it was (no prop / pickup / light / door / seed touched)
      const a = arrival(L);
      expect(shell!.contains(a.x, a.y + STAND_EYE, a.z), 'the arrival is in the tent').toBe(true);
      expect(JSON.stringify({props: L.props, pickups: L.pickups, lights: L.lights, doors: L.doors, seed: L.seed})).toBe(before);
      expect(s.triangles).toBeGreaterThan(100);
      shell!.dispose();
    });

    it(`${host}: enclosed — the real Player on its collision stays in the tent, walking every way and straight at the flap`, () => {
      const L = district(host, firstSeed(host)), shell = shellOf(L), a = arrival(L);
      const keys = new Keys();
      const flap = shell.flapPlan!;
      expect(flap, 'the tent\'s flap').toBeTruthy();
      const walk = (yaw: number, secs: number): Player => {
        const p = new Player();
        // start a pace into the tent from the arrival (the car's gate / the tube's mouth stand at its edge)
        const c = shell.box.getCenter(new THREE.Vector3()), dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz) || 1;
        p.spawn(a.x + (dx / d) * 0.8, a.z + (dz / d) * 0.8, yaw, a.y);
        keys.held.clear();
        keys.held.add('KeyW');
        for (let t = 0; t < secs; t += 1 / 60) p.update(1 / 60, keys, shell.levels, shell.props, {aiming: false, speedMult: 1, canSprint: true});
        return p;
      };
      for (let k = 0; k < 8; k++) {
        const p = walk((k / 8) * Math.PI * 2, 5);
        expect(shell.contains(p.x, p.y + 0.5, p.z, 0.35), `walking at yaw ${k * 45}° from ${JSON.stringify(a)}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} in ${JSON.stringify(shell.box)}`).toBe(true);
      }
      // straight at the shut flap (the game's forward is -Z turned by yaw; the flap's normal points out)
      const p = new Player();
      p.spawn(flap.x - flap.n[0] * 1.2, flap.z - flap.n[1] * 1.2, Math.atan2(-flap.n[0], -flap.n[1]), flap.floor);
      keys.held.clear();
      keys.held.add('KeyW');
      for (let t = 0; t < 4; t += 1 / 60) p.update(1 / 60, keys, shell.levels, shell.props, {aiming: false, speedMult: 1, canSprint: true});
      const out = (p.x - flap.x) * flap.n[0] + (p.z - flap.z) * flap.n[1];
      expect(out, 'the closed flap stops the player inside').toBeLessThan(0.05);
      expect(shell.contains(p.x, p.y + 0.5, p.z, 0.35)).toBe(true);
      // looking at it from inside: the flap is aimed at within reach, not from across the tent's far side
      const eye = new THREE.Vector3(flap.x - flap.n[0] * 1.2, flap.floor + STAND_EYE, flap.z - flap.n[1] * 1.2);
      expect(shell.aimsAtFlap(eye, new THREE.Vector3(flap.n[0], 0, flap.n[1]), 2.6)).toBe(true);
      expect(shell.aimsAtFlap(eye, new THREE.Vector3(-flap.n[0], 0, -flap.n[1]), 2.6)).toBe(false);
      // the supply crate: aimed at from in front of it (its closed body; it opens once the district is built), not from behind the eye
      for (const c of shell.crates) {
        const at = new THREE.Vector3(c.x + c.hx + 1, c.y + c.h * 0.6, c.z);
        expect(shell.aimsAtCrate(at, new THREE.Vector3(-1, 0, 0), 2.6), `the ${c.kind} in front`).toBe(true);
        expect(shell.aimsAtCrate(at, new THREE.Vector3(1, 0, 0), 2.6), `the ${c.kind} behind`).toBe(false);
      }
      expect(shell.crates.length).toBe(shell.stats.crate);
      shell.dispose();
    });
  }

  it('drawSealed: the shell + the kept roots only, a light added since begin() left out, the lent lamps placed and given back', () => {
    const L = district('subway', firstSeed('subway')), shell = shellOf(L);
    const scene = new THREE.Scene();
    const train = [new THREE.PointLight(0xffffff, 0, 5, 2), new THREE.PointLight(0xffffff, 0, 5, 2), new THREE.PointLight(0xffffff, 0, 5, 2)];
    train.forEach((l, i) => { l.position.set(i, 2, 0); scene.add(l); });
    const flashlight = new THREE.SpotLight();
    scene.add(flashlight);
    const world = new THREE.Group(), wall = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    world.add(wall);
    scene.add(world, shell.root);
    const car = new THREE.Group(), carMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    car.add(carMesh);
    scene.add(car);
    shell.begin(scene, train);
    expect(shell.stats.lamps).toBe(Math.min(train.length, shell.lamps.length));
    for (let i = 0; i < shell.stats.lamps; i++) {
      expect(train[i].intensity).toBe(TENT_SHELL.lamp.intensity);
      expect(train[i].position.x).toBeCloseTo(shell.lamps[i].x, 6);
      expect(train[i].position.y).toBeCloseTo(shell.lamps[i].y - TENT_SHELL.lamp.drop, 6);
    }
    // the district build adds its field light meanwhile, and switches the train's lights off for its world
    const field = new THREE.PointLight();
    world.add(field);
    train[0].intensity = 0;
    const shellMesh = shell.root.children.find(o => (o as THREE.Mesh).isMesh)!;
    let seen: Record<string, number> = {};
    shell.drawSealed(scene, [car], () => {
      seen = {wall: wall.layers.mask, field: field.layers.mask, carMesh: carMesh.layers.mask, shell: shellMesh.layers.mask, flash: flashlight.layers.mask, train0: train[0].layers.mask, train0i: train[0].intensity};
    });
    expect(seen.wall, 'the district outside: sealed').toBe(SEAL);
    expect(seen.field, 'a light added since begin(): left out').toBe(SEAL);
    expect(seen.carMesh, 'a kept root: drawn').not.toBe(SEAL);
    expect(seen.shell, 'the shell: drawn').not.toBe(SEAL);
    expect(seen.flash, 'a light of its first view: kept').not.toBe(SEAL);
    expect(seen.train0, 'the lent lamp: kept').not.toBe(SEAL);
    expect(seen.train0i, 'the lent lamp: lit again for the shell\'s draw').toBe(TENT_SHELL.lamp.intensity);
    for (const o of [wall, field, carMesh, shellMesh, flashlight, train[0]]) expect(o.layers.mask, 'every layer given back').not.toBe(SEAL);
    expect(shell.stats.frames).toBe(1);
    // given back: as they were, off (a world without the train)
    shell.returnLights(false);
    train.forEach((l, i) => { expect(l.intensity).toBe(0); expect(l.position.x).toBe(i); expect(l.position.y).toBe(2); });
    // disposed: out of the scene, its own geometry released, the shared materials kept
    const geos = new Set<THREE.BufferGeometry>();
    shell.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) geos.add(m.geometry); });
    let released = 0;
    for (const g of geos) g.addEventListener('dispose', () => released++);
    const mat = (shellMesh as THREE.Mesh).material as THREE.Material;
    let matGone = false;
    mat.addEventListener('dispose', () => { matGone = true; });
    shell.dispose();
    expect(shell.root.parent).toBeNull();
    expect(released, 'its own geometry').toBeGreaterThan(geos.size * 0.8);
    expect(matGone, 'the world\'s shared material stays').toBe(false);
  });

  it('the decay field it made is the build\'s: handed over once, bound once, the same field', () => {
    const L = district('office', firstSeed('office'));
    const shell = shellOf(L);
    const made = activeDecayField();
    expect(made, 'the shell bound the district\'s field').toBeTruthy();
    const levels = stationLevels(L);
    const first = drain(applyStationDecaySteps(L, levels, mats));
    expect(first.yields, 'the build takes the primed field (no steps of its own)').toBe(0);
    expect(activeDecayField()).toBe(made);
    const second = drain(applyStationDecaySteps(L, levels, mats));
    expect(second.yields, 'once: a later build makes its own').toBeGreaterThan(0);
    expect(JSON.stringify(Array.from(activeDecayField()!.data.slice(0, 4096)))).toBe(JSON.stringify(Array.from(made!.data.slice(0, 4096))));
    shell.dispose();
  });
});
