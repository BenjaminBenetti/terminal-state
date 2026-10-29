// Task office-seamless-20261029 (lane LIFT): the tower runtime on lane GEN's REAL continuous Office Space level
// (generateOfficeLevel: ONE layout — station, lobby, floors 2..8 at their real heights; one SOLID shaft through every tower
// storey). The v2 contract plans sanely (a stop at every storey's floor, the cab + doorway solid on every storey grid, panels
// beside the doorway), the cab is moving free space on the real Levels, and the REAL Player body (Player.update + grid /
// prop collision) walks into the cab in the lobby, rides 1 -> 8 -> 1 carried by the cab (continuous y, never below its
// floor), walks out onto floor 8 — with no travel ever requested. Windows of every storey, the exterior once at street
// level, warm-up coverage, and the delivered Meshy exterior models within budget.
import {beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {OFFICE_ASSETS} from '../src/assets/officeAssets';
import {buildExterior, planExterior, type ExteriorModels} from '../src/world/exterior';
import {buildBoth} from './helpers/tslShaders';
import * as officeGen from '../src/gen/office/index';
import {levelsOf} from '../src/gen/levels';
import {CELL, SOLID} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {Player} from '../src/player/player';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {WarmupRegistry, planWarmup, warmKeys} from '../src/render/warmup';
import {CAB_SPEED, planElevator} from '../src/world/elevator';
import {gateWorld, readTowerInfo} from '../src/world/towerShared';
import {planWindows} from '../src/world/officeWindows';
import {installTower, type TowerHost} from '../src/world/towerRuntime';
import {PickupManager} from '../src/world/pickups';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

const SEEDS = [12345, 777];
const gen = (officeGen as unknown as {generateOfficeLevel?: (ctx: {levelSeed: number; startWeapon?: string}) => StationLayout}).generateOfficeLevel;
const cache = new Map<number, StationLayout | null>();
/** GEN's continuous level (null while lane GEN's v2 is not there yet: these tests then skip). */
function level(seed: number): StationLayout | null {
  if (!cache.has(seed)) {
    let l: StationLayout | null = null;
    try { l = gen ? gen({levelSeed: seed, startWeapon: 'pistol'}) : null; } catch (err) { console.warn('generateOfficeLevel failed', err); }
    cache.set(seed, l && (l.office as {version?: number} | undefined)?.version === 2 ? l : null);
  }
  return cache.get(seed)!;
}

function hostFor(layout: StationLayout, player: Player) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  scene.add(camera);
  return {
    scene, camera, player, zombies: [], levels: levelsOf(layout), layout, mats, sfx: null, hud: {toast() {}}, warmRegistry: new WarmupRegistry(),
    interactHandlers: [], frameHooks: [], sectionHooks: [], promptProviders: [], stateListeners: [], sectionPreloads: [],
    state: 'playing', warming: false, pickups: new PickupManager({}), world: {culler: {enabled: true, register: () => {}}},
    travel: vi.fn(async () => ({ok: true})), setState: vi.fn(),
  } as unknown as TowerHost & {frameHooks: ((dt: number) => void)[]; travel: ReturnType<typeof vi.fn>; setState: ReturnType<typeof vi.fn>};
}

/** Input stub: the given keys held. */
const keys = (...k: string[]) => ({down: (c: string) => k.includes(c), hit: () => false, clears: 0});
const DT = 1 / 30;

describe('tower runtime on GEN\'s continuous office level', () => {
  it('the v2 contract plans sanely: a stop at every storey floor, cab + doorway solid on every storey grid, panels beside the doorway', () => {
    for (const seed of SEEDS) {
      const layout = level(seed);
      if (!layout) { expect(gen, 'generateOfficeLevel exists but produced no v2 layout').toBeUndefined(); return; } // lane GEN's v2 not delivered yet
      const info = readTowerInfo(layout)!;
      const L = levelsOf(layout);
      const e = info.elevator!;
      expect(e.stops.map(s => s.floor), `${seed}`).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      for (const s of e.stops) {
        expect(s.levelId).toBe(s.floor);
        expect(s.y).toBeCloseTo(L.list[s.levelId].baseY, 4);
      }
      const plan = planElevator(e);
      expect(plan.gate.depth, `${seed} wall`).toBeCloseTo(0.5, 6);
      expect(plan.gate.hw * 2).toBeCloseTo(e.door.width, 6);
      for (const s of e.stops) {
        const g = L.grid(s.levelId);
        for (let z = e.cab.z0 + CELL / 2; z < e.cab.z1; z += CELL) for (let x = e.cab.x0 + CELL / 2; x < e.cab.x1; x += CELL) {
          expect(g.cells[g.idx(...g.cellOf(x, z))], `${seed} floor ${s.floor} cab ${x},${z}`).toBe(SOLID);
        }
        const [dx, dz] = gateWorld(plan.gate, plan.gate.depth / 2, 0);
        expect(g.cells[g.idx(...g.cellOf(dx, dz))], `${seed} floor ${s.floor} doorway`).toBe(SOLID);
        // the landing stand point is walkable floor of that storey, right outside the door
        const sup = L.supportIn(s.landing.x, s.landing.z, s.y + 0.05);
        expect(sup?.level, `${seed} floor ${s.floor} landing`).toBe(s.levelId);
        // the call panel sits on the shaft's corridor face, beside the doorway
        const c = plan.calls[e.stops.indexOf(s)];
        expect(c.at.y - s.y).toBeGreaterThan(0.9);
        expect(c.at.y - s.y).toBeLessThan(1.6);
      }
      expect(plan.doorH).toBeGreaterThan(2.0);
      expect(plan.cabH).toBeGreaterThan(plan.doorH);
    }
  });

  it('REAL movement: walk into the cab in the lobby, ride 1 -> 8 (carried, continuous), walk out on floor 8, ride back down; never a travel', () => {
    const layout = level(SEEDS[0]);
    if (!layout) { expect(gen).toBeUndefined(); return; }
    const info = readTowerInfo(layout)!;
    const e = info.elevator!;
    const player = new Player();
    const host = hostFor(layout, player);
    const rt = installTower(host);
    host.sectionHooks[0].build!(layout);
    const el = rt.office!.elevator!, L = levelsOf(layout), props = new PropIndex(L, layout.props);
    const G = el.plan.gate;
    const lobby = e.stops[0], top = e.stops[e.stops.length - 1];
    const toward = (x: number, z: number) => Math.atan2(-(x - player.x), -(z - player.z));
    const frame = (k: string[]) => {
      player.update(DT, keys(...k), L, props, {aiming: false, speedMult: 1, canSprint: true});
      for (const f of host.frameHooks) f(DT);
    };
    player.spawn(lobby.landing.x, lobby.landing.z, 0, lobby.y);
    expect(rt.callFloor(1)).toBe(true); // the cab waits in the lobby: its doors open
    for (let i = 0; i < 60; i++) frame([]);
    expect(el.gate.open).toBe(true);
    const [ix, iz] = gateWorld(G, -1.0, 0); // a point inside the cab, 1 m in from the door
    for (let i = 0; i < 90 && !rt.playerInCab(); i++) { player.yaw = toward(ix, iz); frame(['KeyW']); }
    for (let i = 0; i < 10; i++) { player.yaw = toward(ix, iz); frame(['KeyW']); }
    expect(rt.playerInCab()).toBe(true);
    const ride = (floor: number) => {
      expect(rt.panelPick(floor)).toBe(true);
      let prev = player.y, moved = false;
      for (let i = 0; i < 30 * 60; i++) {
        frame([]);
        if (el.logic.moving) moved = true;
        expect(Math.abs(player.y - prev)).toBeLessThanOrEqual(CAB_SPEED * DT + 1e-6);
        expect(player.y).toBeGreaterThanOrEqual(el.logic.y - 1e-6);
        expect(player.y).toBeLessThan(el.logic.y + 0.05);
        prev = player.y;
        if (moved && !el.logic.moving && el.logic.state === 'open') break;
      }
      expect(moved).toBe(true);
    };
    ride(8);
    expect(el.logic.y).toBe(top.y);
    expect(player.y).toBe(top.y);
    // out onto floor 8's landing
    for (let i = 0; i < 60; i++) { player.yaw = toward(top.landing.x, top.landing.z); frame(['KeyW']); }
    const sOut = (player.x - G.cx) * G.nx + (player.z - G.cz) * G.nz;
    expect(sOut).toBeGreaterThan(G.depth + 0.25);
    expect(L.levelAt(player.x, player.z, player.y)).toBe(top.levelId);
    expect(player.y).toBeCloseTo(top.y, 4);
    // back in and down to the lobby
    for (let i = 0; i < 90 && !rt.playerInCab(); i++) { player.yaw = toward(ix, iz); frame(['KeyW']); }
    for (let i = 0; i < 10; i++) { player.yaw = toward(ix, iz); frame(['KeyW']); }
    expect(rt.playerInCab()).toBe(true);
    ride(1);
    expect(player.y).toBe(lobby.y);
    expect(host.travel).not.toHaveBeenCalled();
    expect(host.setState).not.toHaveBeenCalled();
    host.sectionHooks[0].teardown!();
    expect(L.dynamicVolumes).toHaveLength(0);
  });

  it('windows of every storey at their height, exterior once at street level, the build fully warm-up discovered', () => {
    for (const seed of SEEDS) {
      const layout = level(seed);
      if (!layout) { expect(gen).toBeUndefined(); return; }
      const info = readTowerInfo(layout)!;
      const L = levelsOf(layout);
      const plans = planWindows(info);
      expect(plans.length, `${seed}`).toBe(info.windows.length);
      expect(new Set(plans.map(p => p.level)).size, `${seed} storeys with windows`).toBeGreaterThanOrEqual(7);
      for (const p of plans) {
        expect(p.baseY).toBeCloseTo(L.list[p.level].baseY, 4);
        const g = L.grid(p.level), mx = (p.span.x0 + p.span.x1) / 2, mz = (p.span.z0 + p.span.z1) / 2;
        expect(g.cells[g.idx(...g.cellOf(mx, mz))], `${seed} window cell solid`).toBe(SOLID);
      }
      const player = new Player();
      const host = hostFor(layout, player);
      const rt = installTower(host);
      host.sectionHooks[0].build!(layout);
      const o = rt.office!;
      expect(o.exterior!.plan.groundY).toBeCloseTo(info.groundY, 6);
      expect(info.groundY).toBeCloseTo(info.storeys[0].baseY, 6);
      expect(o.exterior!.view.tris).toBeLessThan(150_000);
      const plan = planWarmup(host.scene, {mode: 'full', cameraMask: host.camera.layers.mask, pools: host.warmRegistry.poolRoots()});
      const planned = new Set(plan.items.flatMap(i => warmKeys(i.object as THREE.Mesh)));
      let meshes = 0;
      o.root.traverse(ob => { const m = ob as THREE.Mesh; if (!m.isMesh) return; meshes++; for (const k of warmKeys(m)) expect(planned.has(k), `${seed} ${m.name}`).toBe(true); });
      expect(meshes, `${seed}`).toBeGreaterThan(60);
      host.sectionHooks[0].teardown!();
    }
  });
});

describe('exterior with the delivered Meshy models (lane ASSETS C1-C5)', () => {
  it('real models: budget per half of the city, grounded heroes inside their lots, model shading builds cleanly', async () => {
    const ids = {car: 'car-wreck', bus: 'bus-wreck', rubble: 'rubble-pile', tower: 'ruined-tower', midrise: 'ruined-midrise'} as const;
    const models: ExteriorModels = {};
    for (const [k, id] of Object.entries(ids) as [keyof ExteriorModels, keyof typeof OFFICE_ASSETS][]) {
      const url = OFFICE_ASSETS[id].url;
      if (url) models[k] = await loadStripped(url);
    }
    if (Object.keys(models).length < 5) return; // not delivered: the procedural path is covered elsewhere
    const layout = level(SEEDS[0]);
    const info = layout ? readTowerInfo(layout)! : null;
    const foot = info?.exterior ?? {x0: 0.5, z0: 0.5, x1: 29.5, z1: 24.5}, groundY = info?.groundY ?? 5.6;
    for (const seed of [1, 2, 3, 4]) {
      const plan = planExterior({foot, groundY, eyeAbove: 32, seed});
      const view = buildExterior(plan, models);
      expect(view.used).toEqual({props: true, heroes: plan.buildings.some(b => b.kind === 'tower' || b.kind === 'midrise')});
      const quad = [0, 0, 0, 0];
      for (const im of view.instanced) {
        const q = Number(/-(\d)$/.exec(im.name)?.[1] ?? -1);
        if (q >= 0) quad[q] += (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3 * im.count;
      }
      const half = Math.max(quad[0] + quad[1], quad[1] + quad[2], quad[2] + quad[3], quad[3] + quad[0]);
      expect(half, `seed ${seed}`).toBeLessThan(160_000);
      for (const im of view.instanced.filter(m => /tower-ext-(tower|midrise)-/.test(m.name))) {
        im.computeBoundingBox();
        const m4 = new THREE.Matrix4();
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m4);
          const bb = im.geometry.boundingBox!.clone().applyMatrix4(m4);
          const p = new THREE.Vector3().setFromMatrixPosition(m4);
          const lot = plan.buildings.find(b => Math.hypot(b.x - p.x, b.z - p.z) < 0.5)!;
          expect(lot, 'hero lot').toBeDefined();
          expect(bb.max.x - bb.min.x, 'hero x').toBeLessThanOrEqual(lot.w + 1.5);
          expect(bb.max.z - bb.min.z, 'hero z').toBeLessThanOrEqual(lot.d + 1.5);
          expect(bb.min.y).toBeGreaterThan(groundY - 0.6); // grounded at the street (min y = 0 derivatives)
        }
      }
      if (seed === 1) {
        const seen = new Map<THREE.Material, THREE.Mesh>();
        view.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !seen.has(m.material as THREE.Material)) seen.set(m.material as THREE.Material, m); });
        for (const [mat, mesh] of seen) for (const b of buildBoth(mesh, {material: mat})) expect(b.errors, `${mesh.name} ${b.backend}`).toEqual([]);
      }
      for (const g of view.geometries) g.dispose();
    }
  }, 120000);
});
