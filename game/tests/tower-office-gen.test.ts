// Iteration 16 (lane TOWER): the tower runtime against REAL generated office sections (lane WORLD-GEN's
// generateOfficeSection): the contract fields plan sanely on every section kind (lobby / office floors / top floor),
// the real movement path (Player.update + grid / prop collision) plus the door gate keeps a sprinting player inside a
// shut cab and lets them out of an open one, the stairwell door snaps onto its wall, windows cover the perimeter
// openings, the exterior sits at street level for every floor, and a built section's warm-up plan covers it all.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {OFFICE_ASSETS} from '../src/assets/officeAssets';
import {buildExterior, planExterior, type ExteriorModels} from '../src/world/exterior';
import {buildBoth} from './helpers/tslShaders';
import {generateOfficeSection} from '../src/gen/office/index';
import {levelsOf} from '../src/gen/levels';
import {CELL} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import {Player} from '../src/player/player';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {WarmupRegistry, planWarmup, warmKeys} from '../src/render/warmup';
import {CAB_FRONT, planElevator} from '../src/world/elevator';
import {insideRect, readTowerInfo} from '../src/world/towerShared';
import {planWindows} from '../src/world/officeWindows';
import {installTower, type TowerHost} from '../src/world/towerRuntime';

installCanvasShim(false);
let mats: WorldMaterials;
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

const SECTIONS = ['street', 'floor-2', 'floor-5', 'floor-8'] as const;
const SEEDS = [12345, 777];
const cache = new Map<string, StationLayout>();
const gen = (section: string, seed: number): StationLayout => {
  const k = `${seed}:${section}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = generateOfficeSection(section, {levelSeed: seed})));
  return l;
};

function hostFor(layout: StationLayout, player: Player) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  scene.add(camera);
  return {
    scene, camera, player, zombies: [], levels: levelsOf(layout), layout, mats, sfx: null, hud: {toast() {}}, warmRegistry: new WarmupRegistry(),
    interactHandlers: [], frameHooks: [], sectionHooks: [], promptProviders: [], stateListeners: [], sectionPreloads: [],
    travel: async () => ({ok: true}), arrival: {kind: 'start' as const}, state: 'playing', warming: false,
  } as unknown as TowerHost & {frameHooks: ((dt: number) => void)[]};
}

/** Input stub: the given keys held. */
const keys = (...k: string[]) => ({down: (c: string) => k.includes(c), hit: () => false, clears: 0});

describe('tower runtime on generated office sections', () => {
  it('the contract plans sanely on every section (cab, 0.5 m shaft wall, panels facing their rooms, fixture in the cab)', () => {
    for (const seed of SEEDS) for (const s of SECTIONS) {
      const layout = gen(s, seed);
      const info = readTowerInfo(layout)!;
      expect(info, s).not.toBeNull();
      const L = levelsOf(layout), g = L.grid(info.levelId);
      const e = info.elevator!;
      const plan = planElevator(e, g);
      expect(plan.gate.depth, s).toBeCloseTo(0.5, 6);
      expect(plan.gate.hw * 2, s).toBeCloseTo(e.door.width, 6);
      const [nx, nz] = [plan.gate.nx, plan.gate.nz];
      expect(plan.panelN, `${s} panel`).toEqual([-nx || 0, -nz || 0]);
      expect(plan.callN, `${s} call`).toEqual([nx, nz]);
      // panels mount ON surfaces: the inside panel on the cab's front panelling (not buried in it), the call panel flush
      // on the corridor face of the shaft wall (not floating)
      const sIn = (plan.panelAt.x - plan.gate.cx) * nx + (plan.panelAt.z - plan.gate.cz) * nz;
      expect(sIn, `${s} inside panel surface`).toBeCloseTo(-CAB_FRONT, 6);
      const sCall = (plan.callAt.x - plan.gate.cx) * nx + (plan.callAt.z - plan.gate.cz) * nz;
      expect(sCall, `${s} call panel surface`).toBeCloseTo(plan.gate.depth, 6);
      expect(plan.doorTop - e.floorY).toBeGreaterThan(2.0);
      expect(plan.doorTop - e.floorY).toBeLessThan(2.5);
      // cab cells walkable on the office storey; the opening too
      for (let z = e.cab.z0 + CELL / 2; z < e.cab.z1; z += CELL) for (let x = e.cab.x0 + CELL / 2; x < e.cab.x1; x += CELL) expect(g.walkable(...g.cellOf(x, z)), `${s} cab ${x},${z}`).toBe(true);
      expect(g.passable(...g.cellOf(plan.gate.cx + nx * 0.25, plan.gate.cz + nz * 0.25)), `${s} opening`).toBe(true);
      expect(layout.lights.some(l => insideRect(e.cab, l.x, l.z)), `${s} cab fixture`).toBe(true);
      // arrival in the cab
      const arr = (layout as unknown as {office: {arrivals: {elevator: {x: number; z: number}}}}).office.arrivals.elevator;
      expect(insideRect(e.cab, arr.x, arr.z, 0.3), `${s} arrival`).toBe(true);
      expect(info.groundY, s).toBeCloseTo(info.baseY - info.floorHeight * (info.floor - 1), 6);
    }
  });

  it('real movement + door gate: a sprinting player stays in a shut cab, walks out of an open one', () => {
    for (const s of SECTIONS) {
      const layout = gen(s, SEEDS[0]);
      const info = readTowerInfo(layout)!;
      const e = info.elevator!;
      const player = new Player();
      const host = hostFor(layout, player);
      const rt = installTower(host);
      host.sectionHooks[0].build!(layout);
      const L = levelsOf(layout), props = new PropIndex(L, layout.props);
      const cx = (e.cab.x0 + e.cab.x1) / 2, cz = (e.cab.z0 + e.cab.z1) / 2;
      // face the door (doorSide N on every generated floor: -z; camera yaw 0 looks along -z)
      const G = rt.section!.elevator!.plan.gate;
      const yaw = Math.atan2(-G.nx, -G.nz);
      player.spawn(cx, cz, yaw, e.floorY);
      const dt = 1 / 30;
      for (let i = 0; i < 90; i++) {
        player.update(dt, keys('KeyW', 'ShiftLeft'), L, props, {aiming: false, speedMult: 1, canSprint: true});
        for (const f of host.frameHooks) f(dt);
        if (rt.section!.elevator!.logic.state !== 'closed') break; // (pushing opens them after 0.7 s: never trapped)
        expect(insideRect(e.cab, player.x, player.z, 0.25), `${s} frame ${i}`).toBe(true);
      }
      // the push opened them; keep walking: out through the opening onto the landing
      for (let i = 0; i < 120; i++) {
        player.update(dt, keys('KeyW'), L, props, {aiming: false, speedMult: 1, canSprint: true});
        for (const f of host.frameHooks) f(dt);
      }
      const sOut = (player.x - G.cx) * G.nx + (player.z - G.cz) * G.nz;
      expect(sOut, `${s} walked out`).toBeGreaterThan(G.depth + 0.3);
      expect(Math.abs(player.y - e.floorY), `${s} same storey`).toBeLessThan(0.05);
      host.sectionHooks[0].teardown!();
    }
  });

  it('stair door snaps onto its wall, windows cover the perimeter openings, the build is fully warm-up discovered', () => {
    for (const s of SECTIONS) {
      const layout = gen(s, SEEDS[1]);
      const info = readTowerInfo(layout)!;
      const player = new Player();
      const host = hostFor(layout, player);
      const rt = installTower(host);
      host.sectionHooks[0].build!(layout);
      const sec = rt.section!;
      // stairwell door: one per floor, on the wall face (the solid cell is right behind it)
      expect(sec.stairs!.plans.length, s).toBe(1);
      const d = sec.stairs!.plans[0], g = levelsOf(layout).grid(info.levelId);
      expect(g.cells[g.idx(...g.cellOf(d.x - d.n[0] * 0.1, d.z - d.n[1] * 0.1))], `${s} wall behind the door`).toBe(0);
      expect(g.passable(...g.cellOf(d.x + d.n[0] * 0.3, d.z + d.n[1] * 0.3)), `${s} room in front`).toBe(true);
      const wantChoices = s === 'street' ? ['up'] : s === 'floor-8' ? ['down'] : ['up', 'down'];
      expect(d.choices.map(c => c.dir), s).toEqual(wantChoices);
      // windows: every span planned, its cells solid (no walking out even through a broken pane)
      const plans = planWindows(info);
      expect(plans.length, s).toBe(info.windows.length);
      for (const p of plans) {
        const mx = (p.span.x0 + p.span.x1) / 2, mz = (p.span.z0 + p.span.z1) / 2;
        expect(g.cells[g.idx(...g.cellOf(mx, mz))], `${s} window cell solid`).toBe(0);
      }
      // warm-up: every renderable of the section is represented
      const plan = planWarmup(host.scene, {mode: 'full', cameraMask: host.camera.layers.mask, pools: host.warmRegistry.poolRoots()});
      const planned = new Set(plan.items.flatMap(i => warmKeys(i.object as THREE.Mesh)));
      let meshes = 0;
      sec.root.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; meshes++; for (const k of warmKeys(m)) expect(planned.has(k), `${s} ${m.name}`).toBe(true); });
      expect(meshes, s).toBeGreaterThan(20);
      // exterior at street level, the tower block clear
      expect(sec.exterior!.plan.groundY, s).toBeCloseTo(info.groundY, 6);
      expect(sec.exterior!.view.tris, s).toBeLessThan(150_000);
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
    const layout = gen('floor-5', SEEDS[0]);
    const info = readTowerInfo(layout)!;
    for (const seed of [1, 2, 3, 4]) {
      const plan = planExterior({foot: info.exterior, groundY: info.groundY, eyeAbove: 19.2, seed});
      const view = buildExterior(plan, models);
      expect(view.used).toEqual({props: true, heroes: plan.buildings.some(b => b.kind === 'tower' || b.kind === 'midrise')});
      const quad = [0, 0, 0, 0];
      for (const im of view.instanced) {
        const q = Number(/-(\d)$/.exec(im.name)?.[1] ?? -1);
        if (q >= 0) quad[q] += (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3 * im.count;
      }
      const half = Math.max(quad[0] + quad[1], quad[1] + quad[2], quad[2] + quad[3], quad[3] + quad[0]);
      expect(half, `seed ${seed}`).toBeLessThan(160_000);
      // hero instances stay inside their lot (rotated, scaled footprint)
      for (const im of view.instanced.filter(m => /tower-ext-(tower|midrise)-/.test(m.name))) {
        im.computeBoundingBox();
        const m4 = new THREE.Matrix4();
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m4);
          const bb = im.geometry.boundingBox!.clone().applyMatrix4(m4);
          const p = new THREE.Vector3().setFromMatrixPosition(m4);
          const lot = plan.buildings.find(b => Math.hypot(b.x - p.x, b.z - p.z) < 0.5)!;
          expect(lot, 'hero lot').toBeDefined();
          // per axis, + the AABB growth of the +-1.4 deg yaw jitter on a ~45 m model (the lots keep 1.5-4.5 m setbacks)
          expect(bb.max.x - bb.min.x, 'hero x').toBeLessThanOrEqual(lot.w + 1.5);
          expect(bb.max.z - bb.min.z, 'hero z').toBeLessThanOrEqual(lot.d + 1.5);
          expect(bb.min.y).toBeGreaterThan(info.groundY - 0.6); // grounded (min y = 0 derivatives)
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
