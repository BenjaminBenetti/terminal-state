// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): fixtures for the surface visuals' tests — real generated Reactor
// layouts with lane ENDING's surface contract (layout.reactor.surface: the real one once its generator is on the layout, else a
// CONTRACT-SHAPED stand-in built here from the pit: the plaza ~9 m round the pit with a corner bite, its edges, the stair head house,
// the aperture's parapet ring / keep-off radius), the kit models (texture-stripped GLBs, as the cpu-submit test loads them) and a fake
// host for the runtime.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {ReactorRect, ReactorSurface, ReactorSurfaceEdge} from '../src/gen/reactor/reactorTypes';
import {roofOpeningOf} from '../src/gen/reactor/roofOpening';
import {REACTOR_MODEL_FILES} from '../src/world/reactor/archAssets';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES} from '../src/assets/companyAssets';
import {SURFACE_KIT} from '../src/world/reactor/surfaceKit';
import {loadStripped} from './helpers/openablesFixture';

export const SURFACE_SEEDS = [9100, 637474, 218558, 4242];

/** The lazy catalogue the surface keys resolve in (game.ts propModels). */
export const SURFACE_CATALOGUE: Readonly<Record<string, {url: string; bytes: number}>> = {...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...REACTOR_MODEL_FILES};
export const inCatalogue = (key: string) => !!SURFACE_CATALOGUE[key];

const r2 = (v: number) => Math.round(v * 2) / 2;

/** A contract-shaped surface (lane ENDING's ReactorSurface) for a layout without one. */
export function standInSurface(layout: StationLayout): ReactorSurface {
  const info = layout.reactor!, p = info.pit, o = roofOpeningOf(info)!;
  const y = p.roofY + 0.5, B = {x0: r2(p.bounds.x0 - 9), z0: r2(p.bounds.z0 - 9), x1: r2(p.bounds.x1 + 9), z1: r2(p.bounds.z1 + 9)};
  const bite = 6;
  // an L-shaped plaza: the (x1, z1) corner bitten off
  const walk: ReactorRect[] = [{x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z1 - bite}, {x0: B.x0, z0: B.z1 - bite, x1: B.x1 - bite, z1: B.z1}];
  const edges: ReactorSurfaceEdge[] = [
    {x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z0, nx: 0, nz: -1},
    {x0: B.x1, z0: B.z0, x1: B.x1, z1: B.z1 - bite, nx: 1, nz: 0},
    {x0: B.x1 - bite, z0: B.z1 - bite, x1: B.x1, z1: B.z1 - bite, nx: 0, nz: 1},
    {x0: B.x1 - bite, z0: B.z1 - bite, x1: B.x1 - bite, z1: B.z1, nx: 1, nz: 0},
    {x0: B.x0, z0: B.z1, x1: B.x1 - bite, z1: B.z1, nx: 0, nz: 1},
    {x0: B.x0, z0: B.z0, x1: B.x0, z1: B.z1, nx: -1, nz: 0},
  ];
  const cx = (B.x0 + B.x1) / 2;
  const head = {rect: {x0: cx - 2.5, z0: B.z0 + 0.5, x1: cx + 2.5, z1: B.z0 + 7}, top: y + 3.4};
  const pt = (x: number, yy: number, z: number, level: number) => ({x, y: yy, z, level});
  return {
    version: 1, level: layout.levels.length, y, ceil: y + 40, parapetY: y + 1.1, bounds: B, walk, edges,
    hole: {x: o.x, z: o.z, r: o.r, parapet: {r0: o.r, r1: o.r + 0.5, top: y + 1.1}, keepR: o.r + 1.2},
    door: {level: 0, x: cx, y: p.rimY, z: p.bounds.z0, yaw: 0, nx: 0, nz: 1, w: 2, h: 2.4, rect: {x0: cx - 1, z0: p.bounds.z0 - 0.5, x1: cx + 1, z1: p.bounds.z0}, front: 0}, // (lane ENDING merge: the contract's door has no grid `cells` — they come from its rect, surface.ts surfaceDoorCells)
    stairs: {flights: [], link: -1, bottom: pt(cx, p.rimY, B.z0 + 3, 0), top: pt(cx, y, B.z0 + 3, layout.levels.length), rect: {x0: cx - 2.5, z0: B.z0 + 0.5, x1: cx + 2.5, z1: B.z0 + 7}},
    head, exit: {x: cx, y, z: B.z0 + 7.2, yaw: Math.PI}, areas: {lower: -11, stair: -12, upper: -13, plaza: -14}, // (no area grid on the stand-in: ids that match no cell)
  };
}

const layouts = new Map<number, StationLayout>();
/** A real Reactor layout with a surface contract (ENDING's own when the generator writes one, else the stand-in). */
export function surfaceLayout(seed: number): StationLayout {
  let L = layouts.get(seed);
  if (!L) {
    L = LEVELS.reactor.generate('main', {levelSeed: seed});
    if (!L.reactor!.surface) (L.reactor as {surface?: ReactorSurface}).surface = standInSurface(L);
    layouts.set(seed, L);
  }
  return L;
}

const models = new Map<string, Promise<GLTF>>();
/** The kit's models, texture-stripped (keyed like the lazy library). */
export async function surfaceModels(): Promise<Record<string, GLTF>> {
  const out: Record<string, GLTF> = {};
  for (const e of SURFACE_KIT) {
    const f = SURFACE_CATALOGUE[e.key];
    if (!f) continue;
    let m = models.get(e.key);
    if (!m) models.set(e.key, (m = loadStripped(f.url)));
    out[e.key] = await m;
  }
  return out;
}

/** A Game-shaped host for ReactorSurface (scene with the Reactor's FogExp2, a game camera, hook lists, the model library). */
export function fakeSurfaceHost(lib: Record<string, GLTF>) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a2925, 0.0135);
  const camera = new THREE.PerspectiveCamera(75, 3456 / 1813, 0.05, 230);
  scene.add(camera);
  const pools: [string, () => readonly THREE.Object3D[]][] = [];
  return {
    scene, camera,
    sectionHooks: [] as {build?(layout: StationLayout): void; teardown?(): void}[],
    frameHooks: [] as ((dt: number) => void)[],
    sectionModelKeys: [] as ((layout: StationLayout) => readonly string[])[],
    propModels: {get: (k: string) => lib[k]},
    warmRegistry: {addPool: (name: string, roots: () => readonly THREE.Object3D[]) => { pools.push([name, roots]); }},
    renderer: {domElement: {height: 1813}},
    pools,
  };
}

/** Put the host's camera at a pose (camera convention: yaw about y, pitch about x, 'YXZ'). */
export function poseCamera(cam: THREE.PerspectiveCamera, x: number, y: number, z: number, yaw: number, pitch: number): void {
  cam.position.set(x, y, z);
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
}

/**
 * three r186 render list of a camera under `root`: draws of the visible meshes it would submit (frustum-tested unless frustumCulled is
 * false; a transparent double-sided material without forceSinglePass = 2).
 */
export function surfaceDraws(root: THREE.Object3D, cam: THREE.Camera): {draws: number; tris: number; names: string[]} {
  cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices((cam as THREE.PerspectiveCamera).projectionMatrix, cam.matrixWorldInverse));
  const sph = new THREE.Sphere();
  let draws = 0, tris = 0;
  const names: string[] = [];
  root.updateMatrixWorld(true);
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const im = m as THREE.InstancedMesh;
      let inView = true;
      if (m.frustumCulled !== false) {
        if (im.isInstancedMesh) { if (!im.boundingSphere) im.computeBoundingSphere(); sph.copy(im.boundingSphere!); }
        else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sph.copy(m.geometry.boundingSphere!); }
        inView = fr.intersectsSphere(sph.applyMatrix4(m.matrixWorld));
      }
      if (inView && !(im.isInstancedMesh && im.count === 0)) {
        const mt = m.material as THREE.Material;
        draws += mt.transparent && mt.side === THREE.DoubleSide && !mt.forceSinglePass ? 2 : 1;
        tris += ((m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3) * (im.isInstancedMesh ? im.count : 1);
        names.push(m.name);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return {draws, tris, names};
}
