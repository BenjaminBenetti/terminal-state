// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane MENU): the main menu's diorama (world/menuScene.ts), headless —
// it builds (procedural fallbacks and with stand-in models), stays inside its draw-call / object budget, never imports or touches
// game / world state, keeps the camera out of every car and off the ring road's vehicle lanes, compiles on both backends inside
// WebGPU's 12-uniform-buffer limit, honours the frame cap / hidden tab, and restores the shared exterior uniforms it re-tunes.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {appendFileSync, readFileSync} from 'node:fs';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {buildBoth} from './helpers/tslShaders';
import {EXT_FOG, EXT_U, exteriorFogTune} from '../src/world/exterior';
import {MENU_SCENE, MenuScene, menuCars, menuPoles, orbitPose, type MenuRenderer} from '../src/world/menuScene';
import {PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';

installCanvasShim(false);

const fakeGltf = (w: number, h: number, d: number): GLTF => {
  const scene = new THREE.Group();
  const map = new THREE.DataTexture(new Uint8Array([200, 190, 170, 255]), 1, 1);
  map.needsUpdate = true;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({map})));
  return {scene} as unknown as GLTF;
};
const S = PLAYER_TRAIN_SPEC;
const assets = () => ({shell: fakeGltf(S.length, S.roofY, S.width), door: fakeGltf(S.doorLeaf.width, S.doorLeaf.height, S.doorLeaf.thickness)});

class FakeRenderer implements MenuRenderer {
  initialized = true;
  toneMappingExposure = 0.78;
  renders = 0;
  exposureSeen: number[] = [];
  info = {reset() {}};
  target: unknown = 'icon-target';
  getDrawingBufferSize(t: THREE.Vector2): THREE.Vector2 { return t.set(1920, 1080); }
  getRenderTarget(): unknown { return this.target; }
  setRenderTarget(t: unknown): void { this.target = t; }
  render(): void { this.renders++; this.exposureSeen.push(this.toneMappingExposure); }
}

describe('menu scene: builds headless within its budget', () => {
  it('procedural only (no models loaded): city, corridor, wisps; no train', () => {
    const m = new MenuScene({});
    const st = m.stats();
    expect(st.source).toEqual({train: 'none', leaves: 'none', heroes: false, props: false});
    expect(st.meshes).toBeLessThanOrEqual(MENU_SCENE.maxDrawCalls);
    expect(m.scene.getObjectByName('menu-ballast')).toBeTruthy();
    expect(m.scene.getObjectByName('menu-sleepers')).toBeTruthy();
    expect(m.scene.getObjectByName('menu-fog-wisps')).toBeTruthy();
    expect(m.scene.getObjectByName('tower-ext-sky')).toBeTruthy();
    m.dispose();
  });

  it('with the train models: 5 cars in ONE draw, every door leaf in ONE draw, one interior draw; the whole menu <= the budget', () => {
    const m = new MenuScene(assets());
    const shell = m.scene.getObjectByName('menu-train-shell') as THREE.InstancedMesh;
    const leaves = m.scene.getObjectByName('menu-train-leaves') as THREE.InstancedMesh;
    const inside = m.scene.getObjectByName('menu-train-interiors') as THREE.InstancedMesh;
    expect(shell.isInstancedMesh && shell.count).toBe(5);
    expect(leaves.count).toBe(5 * S.doors.length * 2);
    expect(inside.count).toBe(5);
    const st = m.stats();
    expect(st.source.train).toBe('model');
    expect(st.meshes).toBeLessThanOrEqual(MENU_SCENE.maxDrawCalls);
    let objects = 0;
    m.scene.traverse(() => { objects++; });
    expect(objects).toBeLessThan(90); // instancing: a few dozen scene objects for hundreds of instances
    expect(st.instances).toBeGreaterThan(700);
    m.dispose();
  });

  it('the lead car is lit (warm interior) and is the +X end of the player train; the dead train is dark', () => {
    const cars = menuCars();
    expect(cars).toHaveLength(5);
    const lead = cars.filter(c => c.lead);
    expect(lead).toHaveLength(1);
    expect(lead[0].lit).toBe(true);
    expect(lead[0].x).toBe(Math.max(...cars.filter(c => c.z === MENU_SCENE.tracks[0]).map(c => c.x)));
    expect(cars.filter(c => c.lit)).toHaveLength(1);
    const m = new MenuScene(assets());
    const inside = m.scene.getObjectByName('menu-train-interiors') as THREE.InstancedMesh;
    const c = new THREE.Color();
    inside.getColorAt(cars.indexOf(lead[0]), c);
    expect(c.r).toBeGreaterThan(0.2);
    inside.getColorAt(4, c);
    expect(c.r).toBeLessThan(0.05);
    m.dispose();
  });
});

describe('menu scene: never a game world', () => {
  it('imports no game / run / level / AI / physics / loot / save state', () => {
    const src = readFileSync(new URL('../src/world/menuScene.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(3);
    for (const p of imports) {
      expect(p, p).not.toMatch(/(^|\/)(game|qa|main)$|\/run\/|\/levels\/|\/ai\/|\/physics\/|\/items\/|\/damage\/|\/player\/|\/gen\/|\/campaign\/|\/save\//);
    }
    // only rendering inputs: three, the exterior city, the train spec, the procedural ballast / noise, the rng
    expect(new Set(imports)).toEqual(new Set(['three', 'three/webgpu', 'three/tsl', 'three/addons/loaders/GLTFLoader.js', './exterior', './playerTrainSpec', './canvasTextures', './surfaceNodes', '../core/rng']));
  });
});

describe('menu scene: the orbit', () => {
  // the car boxes (world, with a margin for the near plane), the poles, the ring road's wrecks (<= 3.4 m tall) and the first buildings
  const boxes = menuCars().map(c => new THREE.Box3(new THREE.Vector3(c.x - S.length / 2 - 1.2, 0, c.z - S.width / 2 - 1.2), new THREE.Vector3(c.x + S.length / 2 + 1.2, MENU_SCENE.railTop + S.roofY + 1, c.z + S.width / 2 + 1.2)));
  const C = MENU_SCENE.corridor, buildingZ = C.z1 + 5 + 14 + 1.5; // pavement 5 m + ring road 14 m + the least setback

  it('a full orbit never enters a car, a pole, a wreck or a building, and always looks at the train', () => {
    const period = (Math.PI * 2) / MENU_SCENE.orbit.speed;
    let minClear = Infinity, minPole = Infinity;
    for (let t = 0; t < period * 2; t += 0.25) {
      const {pos, target} = orbitPose(t);
      for (const b of boxes) expect(b.containsPoint(pos), `t=${t} ${pos.toArray()}`).toBe(false);
      expect(pos.y, `t=${t}`).toBeGreaterThan(3.9); // over every wreck on the ring road (bus <= ~3.4 m)
      expect(Math.abs(pos.z)).toBeLessThan(buildingZ - 2);
      minClear = Math.min(minClear, ...boxes.map(b => b.distanceToPoint(pos)));
      for (const p of menuPoles()) if (pos.y < p.h + 2.4) {
        const d = Math.hypot(pos.x - p.x, pos.z - p.z);
        if (d < minPole && process.env.MENU_LOG) appendFileSync(process.env.MENU_LOG, `${t} ${d.toFixed(2)} pole ${JSON.stringify(p)} cam ${pos.toArray().map(v => v.toFixed(1))}\n`);
        minPole = Math.min(minPole, d);
      }
      expect(target.distanceTo(pos)).toBeGreaterThan(9);
      expect(target.distanceTo(pos)).toBeLessThan(45);
    }
    expect(minClear).toBeGreaterThan(0);
    expect(minPole).toBeGreaterThan(3);
  });

  it('pose() is a pure function of time (no state advances)', () => {
    const m = new MenuScene({});
    m.pose(42, 16 / 9);
    const a = m.camera.position.clone();
    m.pose(7, 16 / 9);
    m.pose(42, 16 / 9);
    expect(m.camera.position.distanceTo(a)).toBeLessThan(1e-9);
    m.dispose();
  });
});

describe('menu scene: rendering cost and the shared uniforms', () => {
  it('frame cap (30 fps), no frames while the tab is hidden, the game exposure restored after each frame', () => {
    const m = new MenuScene({});
    const r = new FakeRenderer();
    const g = globalThis as {document?: {hidden: boolean}};
    const had = g.document;
    g.document = {...(had ?? {}), hidden: false} as {hidden: boolean};
    try {
      let drawn = 0;
      for (let t = 0; t < 1000; t += 1000 / 120) if (m.render(r, t)) drawn++; // a 120 Hz display for one second
      expect(drawn).toBeGreaterThanOrEqual(29);
      expect(drawn).toBeLessThanOrEqual(31);
      expect(r.exposureSeen.every(e => e === MENU_SCENE.exposure)).toBe(true);
      expect(r.toneMappingExposure).toBe(0.78);
      expect(r.target).toBe('icon-target'); // a render target set by someone else (the boot's icon renders) is left as found
      g.document!.hidden = true;
      const before = r.renders;
      for (let t = 2000; t < 3000; t += 16) m.render(r, t);
      expect(r.renders).toBe(before);
      r.initialized = false;
      g.document!.hidden = false;
      expect(m.render(r, 5000)).toBe(false);
    } finally {
      if (had) g.document = had; else delete g.document;
      m.dispose();
    }
  });

  it('re-tunes the exterior fog / roof uniforms while active and restores them on dispose (a later Office exterior is untouched)', () => {
    exteriorFogTune({color: [...EXT_FOG.color], base: EXT_FOG.base, ground: EXT_FOG.ground});
    const before = exteriorFogTune();
    const m = new MenuScene({});
    expect(EXT_U.hazeDensity.value).toBeCloseTo(MENU_SCENE.fog.base, 9);
    expect(EXT_U.roofY.value).toBeLessThan(-1e4); // outdoors only
    m.dispose();
    const after = exteriorFogTune();
    expect(after).toEqual(before);
    expect(EXT_U.roofY.value).toBe(1e9);
    m.dispose(); // idempotent
    expect(m.render(new FakeRenderer(), 1e6)).toBe(false);
  });

  it('every menu material compiles on WebGPU (WGSL) and the WebGL2 fallback (GLSL), <= 12 uniform buffers per stage, no errors', () => {
    const m = new MenuScene(assets());
    const seen = new Set<string>();
    const meshes: THREE.Mesh[] = [];
    m.scene.traverse(o => { const x = o as THREE.Mesh; if (x.isMesh && x.name.startsWith('menu-') && !seen.has(x.name)) { seen.add(x.name); meshes.push(x); } });
    expect(seen.size).toBeGreaterThanOrEqual(9);
    for (const mesh of meshes) {
      for (const b of buildBoth(mesh)) {
        expect(b.errors, `${mesh.name} ${b.backend}`).toEqual([]);
        for (const [stage, src] of [['vertex', b.vertex], ['fragment', b.fragment]] as const) {
          const ubo = b.backend === 'wgsl' ? (src.match(/var<uniform>/g) ?? []).length : (src.match(/^(layout\(\s*std140\s*\)\s*)?uniform\s+\w+\s*\{/gm) ?? []).length;
          expect(ubo, `${mesh.name} ${b.backend} ${stage}`).toBeLessThanOrEqual(12);
        }
      }
    }
    m.dispose();
  });
});
