// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): SURFACE RUN's look runtime, installed by world/surface/install.ts.
// Inert outside a district layout (`layout.surface`): every hook returns at once, nothing is created, MOOD stays.
//
// While a district is built:
//  - ASSETS: the district's lazy models (rooftop plant, rubble, the far-city kit) and its texture sets (existing approved Reactor /
//    Skyways / Office files, archMaterials.ts SURFACE_TEXTURES) load behind the loading screen; every district-only GPU resource the
//    arch / look modules create is owned by LevelResources 'surface' (released when the run moves to another asset family; a Retry
//    in the district keeps them).
//  - MOOD: the scene fog becomes the overcast haze (lookSky.ts LOOK_SKY: FogExp2, never green), the camera far plane and the level
//    culler's fog distance follow it; teardown restores MOOD and the far plane exactly.
//  - THE RUNTIME GROUP (outside the world group, which the builder / culler own): the sky dome (follows the eye), the ground ring and
//    the surroundings beyond the cordon (lookCity.ts: berms, collapsed blocks, the far city; instanced per sector so frustum culling
//    drops whole sectors), the street decor (lane markings, crosswalks, patches, potholes, cracks, scorch, kerb / gutter strips,
//    manholes / drains, the rail spur: merged per 96 m chunk and material) and the rooftop plant (HVAC units, water tanks on stands,
//    vents, roof rubble: instanced per 132 m tile). Small decor is DISTANCE culled per chunk / tile (LOOK_DECOR; the level culler
//    knows only one global distance). Everything is registered as a warm-up pool, so a chunk hidden by distance still compiles
//    behind the loading screen.
//  - Teardown: the group's own geometries / instanced meshes, the sign atlas (SurfaceArch.dispose) — the materials stay owned.
// QA (spread into window.__LL by qa.ts): surfaceLook(), surfaceLookTune({...}), surfaceLookPoses(), surfaceLookPose(name).

import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout} from '../../gen/stationTypes';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MOOD, syncGlowFog} from '../lights';
import {fogCullDistance} from '../levelCulling';
import {modelParts} from '../exterior';
import {preloadOfficeArch} from '../officeArch';
import {SURFACE_TEXTURES, SURFACE_TEX_SLOTS, setSurfaceResourceOwner, setSurfaceTexture, surfaceArchMaterial, surfaceTexturesReady, liveSurfaceMaterials} from './archMaterials';
import {GROUND, SIDE_NORMAL, surfaceLookPlan, type Decal, type DepotGear, type SurfaceLookPlan} from './archPlan';
import {CELL} from '../../gen/grid';
import {LookOcclusion, closedShell, facadeStrips, streetSide, type FacadeStrip} from './lookOccluders';
import {LOOK_SKY, liveLookMaterials, lookSkyMaterial, lookTune, outdoorFlatMaterial, outdoorModelMaterial, syncLookHorizon} from './lookSky';
import {FAR_CITY_KEYS, farCityPlan, type FarCityPlan} from './lookCity';
import {daylightStats} from './lookDaylight';
import type {SurfaceArch} from './arch';
import {surfaceAirRuntime} from './air'; // lane AIR's door runtime: the tent flap seam (wireTentFlap)

/** The district's asset family (gen/surface/surfaceRun.ts sectionAssetLevel). */
const FAMILY = 'surface';

/** Decor chunking / distance culling (m). */
export const LOOK_DECOR = {
  /** Street decor chunk edge and its draw distance (from the chunk's bounding circle). */
  chunk: 96, near: 120,
  /** Rooftop plant tile edge and its draw distance. */
  tile: 132, tileNear: 170,
  /** The depot shed's gear: drawn within this distance of its bounding circle. */
  depotNear: 70,
  /** Frames between distance checks. */
  every: 8,
} as const;

/** The rooftop plant's lazy-library keys (Office / company kit: approved, Meshy maps kept). */
const ROOF_KEYS = {hvac: 'office-rooftop-hvac', tank: 'office-water-tower', rubble: 'office-rubble-pile'} as const;
/** Every lazy model a district asks for (game.ts sectionModelKeys). */
export const SURFACE_LOOK_MODEL_KEYS: readonly string[] = [...new Set([...Object.values(ROOF_KEYS), ...FAR_CITY_KEYS])];

/** Decal kind -> finish key (archMaterials.ts GROUND_SPEC / paint). */
const DECAL_KEY: Readonly<Record<Decal['kind'], string>> = {
  white: 'surface-paint-white', yellow: 'surface-paint-yellow', patch: 'surface-patch', pothole: 'surface-pothole', crack: 'surface-crack',
  scorch: 'surface-scorch', oil: 'surface-oil', kerb: 'surface-kerb', gutter: 'surface-gutter',
};

export interface SurfaceLookStats {
  buildMs: number; decorMeshes: number; decorTris: number; clutterMeshes: number; clutterInstances: number; clutterTris: number;
  farMeshes: number; farInstances: number; farTris: number; groundTris: number; decals: number; discs: number; railM: number;
  /** The depot shed's gear (lane ROOMS' features): merged meshes (one per material) and their triangles. */
  depotMeshes: number; depotTris: number;
  visibleDecor: number; missingModels: string[];
}

interface Culled { obj: THREE.Object3D; x: number; z: number; r: number; near: number }

/**
 * Follow-up 2 (draws): the walls round a building's roof decks. `fp` = the footprint (the facade faces lie on its lines); x0..z1 = the
 * footprint INSET by a cell (the inner face of the wall band: the parapet's inner face is LOOK_TUNE.parapetT in, AIR's window reveals
 * end at the span box); per side (N S W E) the LOWEST top of that side's drawn facade, or -Infinity where the side is not a street
 * facade along its whole length (a party wall onto a neighbour, the cordon, the tent: nothing assumed to hide).
 */
export interface RoofWalls { fp: {x0: number; z0: number; x1: number; z1: number}; x0: number; z0: number; x1: number; z1: number; top: [number, number, number, number] }

/**
 * Follow-up 2 (draws): one instanced look piece culled PER INSTANCE (the rooftop plant per tile, the surroundings per sector): its full
 * instance list in build order (16 floats each), each instance's world sphere (cx cy cz r), its world box (BOX floats: x0 z0 x1 z1
 * yTop yBottom — the AABB of its part's bounds) and its deck's walls (index into SurfaceLookView.walls, -1 none). A roof tile keeps its
 * former draw-distance rule (LOOK_DECOR.tileNear, unchanged). cullSurfaceInstances packs the instances drawn this frame to the front.
 */
export interface LookInstSet {
  im: THREE.InstancedMesh;
  n: number;
  mats: Float32Array; sph: Float32Array; top: Float32Array; walls: Int32Array;
  tile: {x: number; z: number; r: number; near: number} | null;
  /** The instances drawn at the last decision (their indices; `shown` of them). */
  shownIdx: Int32Array; shown: number;
}

/** Plain mesh-data accumulator (positions / normals / uvs / indices). */
class Mesh3 {
  readonly pos: number[] = []; readonly nor: number[] = []; readonly uv: number[] = []; readonly idx: number[] = [];
  /** A quad (4 points, counter-clockwise seen from the normal side). */
  quad(p: readonly (readonly number[])[], n: readonly number[], uv: readonly (readonly number[])[]): void {
    const b = this.pos.length / 3;
    for (let k = 0; k < 4; k++) { this.pos.push(p[k][0], p[k][1], p[k][2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(uv[k][0], uv[k][1]); }
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  /** A flat up-facing rect (rotated by `rot` round its centre), world-metre UVs. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, rot = 0): void {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, c = Math.cos(rot), s = Math.sin(rot);
    const P = (u: number, v: number) => [cx + u * c - v * s, y, cz + u * s + v * c];
    const a = P(-hx, hz), b = P(hx, hz), d = P(hx, -hz), e = P(-hx, -hz);
    this.quad([a, b, d, e], [0, 1, 0], [[a[0], -a[2]], [b[0], -b[2]], [d[0], -d[2]], [e[0], -e[2]]]);
  }
  /** An up-facing disc (n segments). */
  disc(x: number, z: number, y: number, r: number, n = 12): void {
    const b = this.pos.length / 3;
    this.pos.push(x, y, z); this.nor.push(0, 1, 0); this.uv.push(x, -z);
    for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; this.pos.push(px, y, pz); this.nor.push(0, 1, 0); this.uv.push(px, -pz); }
    for (let k = 0; k < n; k++) this.idx.push(b, b + 2 + k, b + 1 + k);
  }
  /** An axis-aligned box (outward normals). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
  }
  /** A box of half extents (hx, hz) rotated by yaw round (x, z), y0..y1. */
  yawBox(x: number, z: number, hx: number, hz: number, y0: number, y1: number, yaw: number): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (u: number, y: number, v: number) => [x + u * c + v * s, y, z - u * s + v * c];
    const N = (u: number, v: number) => [u * c + v * s, 0, -u * s + v * c];
    const q = (a: number[], b: number[], d: number[], e: number[], n: number[]) => this.quad([a, b, d, e], n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    q(P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz), [0, 1, 0]);
    q(P(-hx, y0, hz), P(hx, y0, hz), P(hx, y1, hz), P(-hx, y1, hz), N(0, 1));
    q(P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y1, -hz), P(hx, y1, -hz), N(0, -1));
    q(P(hx, y0, hz), P(hx, y0, -hz), P(hx, y1, -hz), P(hx, y1, hz), N(1, 0));
    q(P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, y1, hz), P(-hx, y1, -hz), N(-1, 0));
  }
  get empty(): boolean { return this.idx.length === 0; }
  geometry(): THREE.BufferGeometry | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** The look's runtime pieces of one built district (pure three.js: tests build it without a Game). */
export interface SurfaceLookView {
  root: THREE.Group;
  dome: THREE.Mesh;
  culled: Culled[];
  geometries: THREE.BufferGeometry[];
  instanced: THREE.InstancedMesh[];
  far: FarCityPlan;
  stats: SurfaceLookStats;
  /** Follow-up 2: the per-instance culled pieces (cullSurfaceInstances), the roof decks' walls and the facade strips they test. */
  inst: LookInstSet[];
  walls: RoofWalls[];
  strips: FacadeStrip[];
}

/** Floats per instance box in LookInstSet.top: x0 z0 x1 z1 yTop yBottom. */
export const BOX = 6;

/**
 * Builds the district's runtime look group: sky dome, ground ring, surroundings, street decor, rooftop plant. `models(key)` = the
 * lazy library (undefined: not delivered — that piece is skipped and listed in stats.missingModels).
 */
export function buildSurfaceLookView(layout: StationLayout, mats: Parameters<typeof surfaceArchMaterial>[0], models: (key: string) => GLTF | undefined): SurfaceLookView | null {
  const plan = surfaceLookPlan(layout);
  const S = layout.surface;
  if (!plan || !S) return null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const root = new THREE.Group();
  root.name = 'surface-look';
  const geometries: THREE.BufferGeometry[] = [], instanced: THREE.InstancedMesh[] = [], culled: Culled[] = [], inst: LookInstSet[] = [];
  const missing = new Set<string>();
  const stats: SurfaceLookStats = {buildMs: 0, decorMeshes: 0, decorTris: 0, clutterMeshes: 0, clutterInstances: 0, clutterTris: 0, farMeshes: 0, farInstances: 0, farTris: 0,
    groundTris: 0, decals: plan.decals.length, discs: plan.discs.length, railM: 0, depotMeshes: 0, depotTris: 0, visibleDecor: 0, missingModels: []};
  const level0 = layout.levels?.[0]?.id ?? 0;
  const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.userData.level = level0;
    m.matrixAutoUpdate = false;
    m.castShadow = m.receiveShadow = false;
    parent.add(m);
    geometries.push(geo);
    return m;
  };
  // --- the sky dome (follows the eye: the runtime moves it) ---
  const sg = new THREE.SphereGeometry(LOOK_SKY.dome, 32, 14);
  sg.deleteAttribute('uv');
  const dome = addMesh(sg, lookSkyMaterial(), 'surface-sky');
  dome.frustumCulled = false;
  dome.renderOrder = -5;
  dome.matrixAutoUpdate = true;
  // --- the ground ring beyond the extent (under the cordon band and out past the fog's cull distance) ---
  const far = farCityPlan(S, k => !!models(k));
  {
    const E = S.extent, R = far.groundR, cx = far.centre.x, cz = far.centre.z, y = -0.03;
    const q = new Mesh3();
    const O = {x0: cx - R, z0: cz - R, x1: cx + R, z1: cz + R};
    q.flat(O.x0, O.z0, O.x1, E.z0, y); q.flat(O.x0, E.z1, O.x1, O.z1, y);
    q.flat(O.x0, E.z0, E.x0, E.z1, y); q.flat(E.x1, E.z0, O.x1, E.z1, y);
    const g = q.geometry();
    if (g) { addMesh(g, outdoorFlatMaterial('ground'), 'surface-ground-ring'); stats.groundTris = triCount(g); }
  }
  // --- the surroundings: instanced per entry part x sector ---
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const place = (x: number, y: number, z: number, yaw: number, s: number) => m4.compose(tv.set(x, y, z), qt.setFromAxisAngle(up, yaw), sv.set(s, s, s)).clone();
  const addInstanced = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[], parent: THREE.Object3D = root): THREE.InstancedMesh | null => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geometry, material, list.length);
    im.name = name;
    im.userData.level = level0;
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    im.castShadow = im.receiveShadow = false;
    im.matrixAutoUpdate = false;
    parent.add(im);
    instanced.push(im);
    return im;
  };
  // (follow-up 2) an instanced piece culled per instance
  const track = (im: THREE.InstancedMesh, list: THREE.Matrix4[], walls: readonly number[] | null, tile: LookInstSet['tile']): void => { inst.push(lookInstSet(im, list, walls, tile)); };
  const byKey = new Map<string, typeof far.placements>();
  for (const p of far.placements) { let l = byKey.get(p.key); if (!l) byKey.set(p.key, (l = [])); l.push(p); }
  for (const [key, list] of byKey) {
    const gltf = models(key);
    if (!gltf) { missing.add(key); continue; }
    const parts = modelParts(gltf);
    for (const [pi, part] of parts.entries()) {
      const mat = outdoorModelMaterial(part.material, true);
      for (let sct = 0; sct < 8; sct++) {
        const ps = list.filter(p => p.sector === sct);
        const ms = ps.map(p => place(p.x, p.y, p.z, p.yaw, p.s).multiply(part.matrix));
        const im = addInstanced(`surface-far-${key}-${pi}-s${sct}`, part.geometry, mat, ms);
        if (im) { stats.farMeshes++; stats.farInstances += ps.length; stats.farTris += triCount(part.geometry) * ps.length; track(im, ms, null, null); }
      }
    }
  }
  // --- street decor: merged per (material key x chunk), distance culled ---
  const C = LOOK_DECOR.chunk;
  const decor = new Map<string, {key: string; cx: number; cz: number; q: Mesh3}>();
  const D = (key: string, x: number, z: number): Mesh3 => {
    const cx = Math.floor(x / C), cz = Math.floor(z / C), k = `${key}@${cx},${cz}`;
    let e = decor.get(k);
    if (!e) decor.set(k, (e = {key, cx, cz, q: new Mesh3()}));
    return e.q;
  };
  for (const d of plan.decals) D(DECAL_KEY[d.kind], (d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2).flat(d.x0, d.z0, d.x1, d.z1, d.y, d.rot ?? 0);
  for (const c of plan.discs) {
    const q = D('surface-iron', c.x, c.z);
    if (c.kind === 'manhole') q.disc(c.x, c.z, c.y, c.r, 14);
    else q.flat(c.x - c.r, c.z - c.r * 0.45, c.x + c.r, c.z + c.r * 0.45, c.y, c.rot);
  }
  // the rail spur: two flush rails (a hair proud) on timber sleepers set into the ground (no tripping geometry: no colliders here)
  if (plan.rail && plan.rail.points.length > 1) {
    const R = plan.rail, half = R.gauge / 2;
    for (let k = 0; k + 1 < R.points.length; k++) {
      const a = R.points[k], b = R.points[k + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const ux = dx / len, uz = dz / len, yaw = Math.atan2(ux, uz);
      stats.railM += len;
      for (const o of [-half, half]) {
        const mx = (a.x + b.x) / 2 - uz * o, mz = (a.z + b.z) / 2 + ux * o;
        D('surface-rail', mx, mz).yawBox(mx, mz, 0.036, len / 2 + 0.01, R.y - 0.01, R.y + 0.025, yaw);
      }
      for (let s = 0.3; s < len; s += 0.65) {
        const x = a.x + ux * s, z = a.z + uz * s;
        D('surface-sleeper', x, z).flat(x - 1.3, z - 0.13, x + 1.3, z + 0.13, R.y + 0.004, -yaw);
      }
    }
  }
  if (plan.depot) {
    for (const [key, q] of depotGearMeshes(plan.depot)) {
      const g = q.geometry(), mat = g ? surfaceArchMaterial(mats, key) : undefined;
      if (!g) continue;
      if (!mat) { g.dispose(); continue; }
      const m = addMesh(g, mat, `surface-depot-${key}`);
      const bs = g.boundingSphere!;
      culled.push({obj: m, x: bs.center.x, z: bs.center.z, r: bs.radius, near: LOOK_DECOR.depotNear});
      stats.depotMeshes++;
      stats.depotTris += triCount(g);
    }
    stats.railM += plan.depot.tracks.reduce((a, t) => a + Math.hypot(t.x1 - t.x0, t.z1 - t.z0), 0);
  }
  for (const e of decor.values()) {
    const g = e.q.geometry();
    if (!g) continue;
    const mat = surfaceArchMaterial(mats, e.key);
    if (!mat) { g.dispose(); continue; }
    const m = addMesh(g, mat, `surface-decor-${e.key}@${e.cx},${e.cz}`);
    m.renderOrder = 1;
    const bs = g.boundingSphere!;
    culled.push({obj: m, x: bs.center.x, z: bs.center.z, r: bs.radius, near: LOOK_DECOR.near});
    stats.decorMeshes++;
    stats.decorTris += triCount(g);
  }
  // --- rooftop plant: instanced per (model part x tile), distance culled; stands / vents as merged boxes per tile ---
  const T = LOOK_DECOR.tile;
  const tiles = new Map<string, {tx: number; tz: number; byModel: Map<string, {m: THREE.Matrix4; w: number}[]>; boxes: Mesh3}>();
  // (follow-up 2) each placement's deck walls: the building whose footprint holds it
  const walls: RoofWalls[] = [], wallIx = new Map<number, number>();
  const wallsOf = (x: number, z: number): number => {
    const k = plan.buildings.findIndex(bl => { const f = bl.b.footprint; return x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1; });
    if (k < 0) return -1;
    let w = wallIx.get(k);
    if (w === undefined) { w = walls.length; walls.push(roofWalls(layout, plan, k)); wallIx.set(k, w); }
    return w;
  };
  const tileOf = (x: number, z: number) => {
    const tx = Math.floor(x / T), tz = Math.floor(z / T), k = `${tx},${tz}`;
    let e = tiles.get(k);
    if (!e) tiles.set(k, (e = {tx, tz, byModel: new Map(), boxes: new Mesh3()}));
    return e;
  };
  const STAND = 2.4;
  for (const p of plan.placements) {
    const t = tileOf(p.x, p.z);
    if (p.model === 'vent') {
      const h = 0.55 * p.s, w = 0.32 * p.s;
      t.boxes.yawBox(p.x, p.z, w, w, p.y, p.y + h, p.yaw);
      t.boxes.yawBox(p.x, p.z, w * 1.35, w * 1.35, p.y + h, p.y + h + 0.06, p.yaw);
      continue;
    }
    const key = ROOF_KEYS[p.model];
    const lift = p.model === 'tank' ? STAND * p.s : 0;
    if (p.model === 'tank') {
      // four steel legs + a ring beam under the tank
      const r = 1.75 * p.s;
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) t.boxes.yawBox(p.x + ox * r * 0.7, p.z + oz * r * 0.7, 0.09, 0.09, p.y, p.y + lift, 0);
      t.boxes.yawBox(p.x, p.z, r, r, p.y + lift - 0.18, p.y + lift, p.yaw);
    }
    let l = t.byModel.get(key);
    if (!l) t.byModel.set(key, (l = []));
    l.push({m: place(p.x, p.y + lift, p.z, p.yaw, p.s), w: wallsOf(p.x, p.z)});
  }
  const partsOf = new Map<string, ReturnType<typeof modelParts> | null>();
  for (const t of tiles.values()) {
    const cx = (t.tx + 0.5) * T, cz = (t.tz + 0.5) * T, r = T * Math.SQRT1_2;
    for (const [key, list] of t.byModel) {
      if (!partsOf.has(key)) { const g = models(key); partsOf.set(key, g ? modelParts(g) : null); if (!g) missing.add(key); }
      const parts = partsOf.get(key);
      if (!parts) continue;
      for (const [pi, part] of parts.entries()) {
        const ms = list.map(e => e.m.clone().multiply(part.matrix));
        const im = addInstanced(`surface-roof-${key}-${pi}@${t.tx},${t.tz}`, part.geometry, outdoorModelMaterial(part.material), ms);
        if (!im) continue;
        track(im, ms, list.map(e => e.w), {x: cx, z: cz, r, near: LOOK_DECOR.tileNear}); // (follow-up 2: per instance; the tile's distance rule kept)
        stats.clutterMeshes++;
        stats.clutterInstances += list.length;
        stats.clutterTris += triCount(part.geometry) * list.length;
      }
    }
    const bg = t.boxes.geometry();
    if (bg) {
      const m = addMesh(bg, outdoorFlatMaterial('steel'), `surface-roof-steel@${t.tx},${t.tz}`);
      culled.push({obj: m, x: cx, z: cz, r, near: LOOK_DECOR.tileNear});
      stats.clutterMeshes++;
      stats.clutterTris += triCount(bg);
    }
  }
  root.traverse(o => { if (o !== dome) o.updateMatrix(); });
  root.updateMatrixWorld(true);
  stats.missingModels = [...missing];
  stats.buildMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  return {root, dome, culled, geometries, instanced, far, stats, inst, walls, strips: facadeStrips(layout, plan)};
}

/**
 * Follow-up 2: an instanced piece's per-instance record (LookInstSet): `list` = its instance matrices (world: the look group sits at the
 * origin), `walls` = each instance's deck walls (null: none), `tile` = a roof tile's draw-distance rule (null: none).
 */
export function lookInstSet(im: THREE.InstancedMesh, list: readonly THREE.Matrix4[], walls: readonly number[] | null, tile: LookInstSet['tile']): LookInstSet {
  const g = im.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox) g.computeBoundingBox();
  const n = list.length, bs = g.boundingSphere!, bb = g.boundingBox!, c = new THREE.Vector3();
  const mats = new Float32Array(16 * n), sph = new Float32Array(4 * n), top = new Float32Array(BOX * n), shownIdx = new Int32Array(n);
  list.forEach((m, i) => {
    mats.set(m.elements, 16 * i);
    c.copy(bs.center).applyMatrix4(m);
    sph.set([c.x, c.y, c.z, bs.radius * m.getMaxScaleOnAxis()], 4 * i);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = -Infinity, y0 = Infinity;
    for (let k = 0; k < 8; k++) {
      c.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(m);
      x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z); y1 = Math.max(y1, c.y); y0 = Math.min(y0, c.y);
    }
    top.set([x0, z0, x1, z1, y1, y0], BOX * i);
    shownIdx[i] = i;
  });
  return {im, n, mats, sph, top, walls: Int32Array.from(walls ?? new Array<number>(n).fill(-1)), tile, shownIdx, shown: n};
}

/** Follow-up 2: the walls round building `k`'s decks (RoofWalls). A side counts only where every cell just outside it is open street. */
export function roofWalls(layout: StationLayout, plan: SurfaceLookPlan, k: number): RoofWalls {
  const bl = plan.buildings[k], f = bl.b.footprint;
  const top: RoofWalls['top'] = [-Infinity, -Infinity, -Infinity, -Infinity];
  const order = ['N', 'S', 'W', 'E'];
  if (closedShell(bl)) for (const sd of bl.sides) if (sd.tops.length && streetSide(layout, plan, sd)) top[order.indexOf(sd.side)] = Math.min(...sd.tops.map(t => t.top));
  return {fp: {x0: f.x0, z0: f.z0, x1: f.x1, z1: f.z1}, x0: f.x0 + CELL, z0: f.z0 + CELL, x1: f.x1 - CELL, z1: f.z1 - CELL, top};
}

/** Margin (m) under a wall top within which a sight line counts as clearing it. */
const WALL_MARGIN = 0.05;

/**
 * Follow-up 2: whether the walls round its deck hide a roof piece (top box x0 z0 x1 z1 at height q) from the eye (ex ey ez). A sight
 * line from the eye to a point of the box leaves the inset footprint through one side (a corner: both) a fraction t of the way from the
 * point, at height q + (ey - q) t. Below that side's lowest top it meets the facade face (between the inset line and the face the line
 * only drops towards the eye): opaque from the street to its top except at openings, and an opening leads into the building's closed
 * shell under the deck (window / door reveals, rooms with ceilings, dark-room boxes) — the line rises from there to the deck and
 * cannot leave it. The box's top hides its lower points (lower = lower line); every interior point of the top lies on a sight line
 * through an outline point that sits higher at the same wall; along an outline edge the height is monotonic between its corners and
 * the points whose line passes a footprint corner (where the exit side changes): those points are tested.
 * Never hidden: the eye inside the footprint, any part of the box outside the inset footprint, an exit side without a street facade.
 */
export function roofPieceHidden(w: RoofWalls, x0: number, z0: number, x1: number, z1: number, q: number, ex: number, ey: number, ez: number): boolean {
  const F = w.fp;
  if (ex >= F.x0 - 0.05 && ex <= F.x1 + 0.05 && ez >= F.z0 - 0.05 && ez <= F.z1 + 0.05) return false;
  if (x0 < w.x0 || x1 > w.x1 || z0 < w.z0 || z1 > w.z1) return false;
  const hiddenAt = (qx: number, qz: number): boolean => {
    let t = Infinity, top = Infinity;
    const cand = (tt: number, side: number): void => {
      if (!(tt >= 0)) return;
      if (tt < t - 1e-6) { t = tt; top = w.top[side]; } else if (tt <= t + 1e-6) top = Math.min(top, w.top[side]);
    };
    if (ez < qz) cand((w.z0 - qz) / (ez - qz), 0); else if (ez > qz) cand((w.z1 - qz) / (ez - qz), 1);
    if (ex < qx) cand((w.x0 - qx) / (ex - qx), 2); else if (ex > qx) cand((w.x1 - qx) / (ex - qx), 3);
    if (!(t <= 1) || !(top > -Infinity)) return false;
    return q + (ey - q) * t < top - WALL_MARGIN;
  };
  if (!hiddenAt(x0, z0) || !hiddenAt(x1, z0) || !hiddenAt(x0, z1) || !hiddenAt(x1, z1)) return false;
  // the outline points whose sight line passes a footprint corner
  for (const cx of [w.x0, w.x1]) for (const cz of [w.z0, w.z1]) {
    const dx = cx - ex, dz = cz - ez;
    if (Math.abs(dx) > 1e-9) for (const xe of [x0, x1]) { const u = (xe - ex) / dx, z = ez + u * dz; if (u > 1 && z > z0 && z < z1 && !hiddenAt(xe, z)) return false; }
    if (Math.abs(dz) > 1e-9) for (const ze of [z0, z1]) { const u = (ze - ez) / dz, x = ex + u * dx; if (u > 1 && x > x0 && x < x1 && !hiddenAt(x, ze)) return false; }
  }
  return true;
}

const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere();

/**
 * Follow-up 2 (draws): the look's per-instance culling for the camera's CURRENT view (run right before each main render). An instance
 * is drawn when its sphere meets the view frustum, its nearest view depth is inside `maxDistance` (the level culler's fog distance: the
 * rule every registered mesh follows; the look's materials take the scene fog), a roof piece's own deck walls do not hide it
 * (roofPieceHidden) and — with `occl` — the district's facade strips do not hide its box (lookOccluders.ts LookOcclusion, built here
 * for this view); a roof tile beyond its draw distance is hidden whole, as before. The drawn instances are packed to the front of the
 * instance buffer (rewritten only when the set changes); a piece with none is hidden. No shadow casters here (castShadow off).
 */
export function cullSurfaceInstances(v: SurfaceLookView, cam: THREE.Camera, maxDistance: number, occl: LookOcclusion | null = null): {shown: number; total: number} {
  const oc = occl && v.strips.length && (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? occl : null;
  if (oc) oc.build(cam as THREE.PerspectiveCamera, v.strips, maxDistance);
  _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  _fr.setFromProjectionMatrix(_pm);
  const me = cam.matrixWorld.elements, ex = me[12], ey = me[13], ez = me[14];
  const fl = Math.hypot(me[8], me[9], me[10]) || 1, fx = -me[8] / fl, fy = -me[9] / fl, fz = -me[10] / fl;
  let shown = 0, total = 0;
  for (const set of v.inst) {
    total += set.n;
    const t = set.tile;
    if (t && Math.hypot(t.x - ex, t.z - ez) - t.r >= t.near) { set.shown = 0; if (set.im.visible) set.im.visible = false; continue; }
    const s = set.sph, b = set.top, idx = set.shownIdx;
    let k = 0, changed = false;
    for (let i = 0; i < set.n; i++) {
      const cx = s[4 * i], cy = s[4 * i + 1], cz = s[4 * i + 2], r = s[4 * i + 3];
      if (fx * (cx - ex) + fy * (cy - ey) + fz * (cz - ez) - r > maxDistance) continue;
      _sp.center.set(cx, cy, cz);
      _sp.radius = r;
      if (!_fr.intersectsSphere(_sp)) continue;
      const w = set.walls[i], o = BOX * i;
      if (w >= 0 && roofPieceHidden(v.walls[w], b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], ex, ey, ez)) continue;
      if (oc && oc.boxHidden(b[o], b[o + 5], b[o + 1], b[o + 2], b[o + 4], b[o + 3])) continue;
      if (k >= set.shown || idx[k] !== i) changed = true;
      idx[k++] = i;
    }
    if (k !== set.shown) changed = true;
    set.shown = k;
    shown += k;
    if (k === 0) { if (set.im.visible) set.im.visible = false; continue; }
    if (!set.im.visible) set.im.visible = true;
    if (!changed && set.im.count === k) continue;
    const arr = set.im.instanceMatrix.array as Float32Array;
    for (let j = 0; j < k; j++) arr.set(set.mats.subarray(16 * idx[j], 16 * idx[j] + 16), 16 * j);
    set.im.count = k;
    set.im.instanceMatrix.needsUpdate = true;
  }
  return {shown, total};
}

/** Follow-up 2: every per-instance piece back to its full instance list (the state before any per-instance decision). */
export function resetSurfaceInstances(v: SurfaceLookView): void {
  for (const set of v.inst) {
    (set.im.instanceMatrix.array as Float32Array).set(set.mats);
    for (let i = 0; i < set.n; i++) set.shownIdx[i] = i;
    set.shown = set.n;
    set.im.count = set.n;
    set.im.visible = true;
    set.im.instanceMatrix.needsUpdate = true;
  }
}

/** The depot gear's materials: crane yellow / rope black are the painted-steel trim tints (the Reactor crane's yellow). */
export const DEPOT_KEYS = {rail: 'surface-rail', groove: 'surface-gutter', pit: 'surface-void', grate: 'surface-iron', steel: 'surface-steel', yellow: 'surface-trim-b88c26', black: 'surface-trim-1d1c1b'} as const;

/**
 * The depot shed's gear (lane ROOMS' features, archPlan.ts DepotGear) as mesh data per material key:
 *  - each track: two rails set flush in the shed floor (a hair proud) with a dark flangeway groove inside each;
 *  - each inspection pit: the dark pit under a walkable grating (frame, bearing bars, cross bars) flush with the floor;
 *  - the overhead travelling crane: runway girders (+ flange, crane rail) on wall brackets along both long walls, the box-girder bridge
 *    on its end trucks at `at`, an underhung hoist mid-span, two ropes down to the hook block and the hook at `hookY` (above reach).
 * Flush or overhead: no colliders.
 */
export function depotGearMeshes(G: DepotGear): Map<string, {geometry(): THREE.BufferGeometry | null}> {
  const out = new Map<string, Mesh3>();
  const Q = (key: string) => { let q = out.get(key); if (!q) out.set(key, (q = new Mesh3())); return q; };
  for (const t of G.tracks) {
    const dx = t.x1 - t.x0, dz = t.z1 - t.z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, yaw = Math.atan2(ux, uz);
    const mx = (t.x0 + t.x1) / 2, mz = (t.z0 + t.z1) / 2, half = t.gauge / 2;
    for (const o of [-half, half]) {
      Q(DEPOT_KEYS.rail).yawBox(mx - uz * o, mz + ux * o, 0.036, len / 2, t.y - 0.01, t.y + 0.012, yaw);
      const g = o - Math.sign(o) * 0.07, gx = mx - uz * g, gz = mz + ux * g;
      Q(DEPOT_KEYS.groove).flat(gx - 0.025, gz - len / 2, gx + 0.025, gz + len / 2, t.y + 0.003, -yaw);
    }
  }
  for (const p of G.pits) {
    const y = p.y, alongX = p.x1 - p.x0 >= p.z1 - p.z0;
    Q(DEPOT_KEYS.pit).flat(p.x0, p.z0, p.x1, p.z1, y + 0.004);
    const grate = Q(DEPOT_KEYS.grate), f = 0.06;
    grate.box(p.x0 - f, p.x1 + f, y, y + 0.012, p.z0 - f, p.z0); grate.box(p.x0 - f, p.x1 + f, y, y + 0.012, p.z1, p.z1 + f);
    grate.box(p.x0 - f, p.x0, y, y + 0.012, p.z0, p.z1); grate.box(p.x1, p.x1 + f, y, y + 0.012, p.z0, p.z1);
    // bearing bars along the pit every 0.1 m, cross bars every 1 m
    const w0 = alongX ? p.z0 : p.x0, w1 = alongX ? p.z1 : p.x1, l0 = alongX ? p.x0 : p.z0, l1 = alongX ? p.x1 : p.z1;
    const nb = Math.max(1, Math.round((w1 - w0) / 0.1));
    for (let k = 1; k < nb; k++) {
      const w = w0 + ((w1 - w0) * k) / nb;
      if (alongX) grate.flat(l0, w - 0.012, l1, w + 0.012, y + 0.008); else grate.flat(w - 0.012, l0, w + 0.012, l1, y + 0.008);
    }
    const nc = Math.max(1, Math.round((l1 - l0) / 1));
    for (let k = 1; k < nc; k++) {
      const l = l0 + ((l1 - l0) * k) / nc;
      if (alongX) grate.flat(l - 0.02, w0, l + 0.02, w1, y + 0.01); else grate.flat(w0, l - 0.02, w1, l + 0.02, y + 0.01);
    }
  }
  const c = G.crane;
  if (c) {
    const ax = c.axis === 'x';
    // (a along the runway, b across it) -> world boxes
    const AB = (key: string, a0: number, a1: number, y0: number, y1: number, b0: number, b1: number) =>
      (ax ? Q(key).box(a0, a1, y0, y1, b0, b1) : Q(key).box(b0, b1, y0, y1, a0, a1));
    const a0 = ax ? c.x0 : c.z0, a1 = ax ? c.x1 : c.z1, b0 = ax ? c.z0 : c.x0, b1 = ax ? c.z1 : c.x1, bm = (b0 + b1) / 2, y = c.y;
    const at = a0 + (a1 - a0) * c.at;
    for (const b of [b0, b1]) {
      const out = Math.sign(b - bm) || 1;
      AB(DEPOT_KEYS.steel, a0, a1, y - 0.62, y - 0.07, b - 0.13, b + 0.13);
      AB(DEPOT_KEYS.steel, a0, a1, y - 0.07, y - 0.04, b - 0.19, b + 0.19);
      AB(DEPOT_KEYS.black, a0, a1, y - 0.04, y, b - 0.035, b + 0.035);
      const nk = Math.max(1, Math.round((a1 - a0) / 6));
      for (let k = 0; k <= nk; k++) {
        const a = a0 + 0.15 + ((a1 - a0 - 0.3) * k) / nk;
        AB(DEPOT_KEYS.steel, a - 0.12, a + 0.12, y - 1.0, y - 0.62, Math.min(b - out * 0.13, b + out * 0.3), Math.max(b - out * 0.13, b + out * 0.3));
      }
      // the bridge's end truck riding this runway
      AB(DEPOT_KEYS.yellow, at - 1.5, at + 1.5, y, y + 0.42, b - 0.2, b + 0.2);
    }
    // the box-girder bridge (two girders), the underhung hoist mid-span, ropes, block and hook
    for (const o of [-0.42, 0.42]) AB(DEPOT_KEYS.yellow, at + o - 0.17, at + o + 0.17, y + 0.08, y + 0.72, b0 - 0.05, b1 + 0.05);
    AB(DEPOT_KEYS.yellow, at - 0.55, at + 0.55, y - 0.5, y + 0.08, bm - 0.6, bm + 0.6);
    AB(DEPOT_KEYS.steel, at - 0.32, at + 0.32, y - 0.46, y - 0.12, bm - 0.78, bm + 0.78);
    const blockTop = c.hookY + 0.95;
    if (y - 0.5 - blockTop > 0.05) for (const o of [-0.1, 0.1]) AB(DEPOT_KEYS.black, at + o - 0.012, at + o + 0.012, blockTop, y - 0.5, bm - 0.012, bm + 0.012);
    AB(DEPOT_KEYS.yellow, at - 0.18, at + 0.18, c.hookY + 0.45, blockTop, bm - 0.28, bm + 0.28);
    AB(DEPOT_KEYS.steel, at - 0.04, at + 0.04, c.hookY, c.hookY + 0.45, bm - 0.04, bm + 0.04);
    AB(DEPOT_KEYS.steel, at - 0.05, at + 0.05, c.hookY, c.hookY + 0.07, bm - 0.17, bm + 0.04);
    AB(DEPOT_KEYS.steel, at - 0.05, at + 0.05, c.hookY + 0.07, c.hookY + 0.2, bm - 0.17, bm - 0.1);
  }
  return out;
}

/** Releases what the view owns (model geometries / maps stay with the library; materials stay owned by the level resources). */
export function disposeSurfaceLookView(v: SurfaceLookView): void {
  v.root.removeFromParent();
  for (const im of v.instanced) im.dispose();
  for (const g of v.geometries) g.dispose();
  v.culled.length = 0;
}

/** Distance culling of the view's small decor round the eye (x, z). Returns how many culled pieces are shown. */
export function cullSurfaceDecor(v: SurfaceLookView, x: number, z: number): number {
  let shown = 0;
  for (const c of v.culled) {
    const d = Math.hypot(c.x - x, c.z - z) - c.r;
    const on = d < c.near;
    if (c.obj.visible !== on) c.obj.visible = on;
    if (on) shown++;
  }
  return shown;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The runtime

export class SurfaceLook {
  /** District values applied now. */
  active = false;
  view: SurfaceLookView | null = null;
  private farWas: number | null = null;
  private frame = 0;
  private readonly game: Game;
  /** Follow-up 2: the last per-instance decision (instances drawn / total) and the camera matrix it was made for. */
  instStats = {shown: 0, total: 0, decisions: 0, ms: 0};
  private readonly occl = new LookOcclusion();
  private readonly instEye = new THREE.Matrix4();
  private readonly instProj = new THREE.Matrix4();
  private instMax = 0;
  private instValid = false;

  constructor(game: Game) {
    this.game = game;
    game.sectionModelKeys.push(layout => (layout.surface ? SURFACE_LOOK_MODEL_KEYS : []));
    game.sectionPreloads.push(layout => (layout.surface ? this.preload() : Promise.resolve()));
    game.sectionHooks.push({build: layout => this.build(layout as StationLayout), teardown: () => this.teardown()});
    game.frameHooks.push(() => this.tick());
    game.warmRegistry.addPool('surface-look', () => (this.view ? [this.view.root] : []));
    // (follow-up 2) the per-instance culling runs right before each main render, for the camera it draws with (the frame hooks run a
    // frame ahead of the camera); skipped while the warm-up owns the renderer (it compiles every piece whatever it shows)
    const look = this, scene = game.scene, prev = scene.onBeforeRender;
    scene.onBeforeRender = function (this: THREE.Scene, ...args: Parameters<THREE.Object3D['onBeforeRender']>) {
      prev.apply(this, args);
      look.beforeRender(args[2]);
    };
  }

  /** Follow-up 2: the per-instance culling of the look's instanced pieces for the main camera's current view (see cullSurfaceInstances). */
  beforeRender(camera: THREE.Camera): void {
    const g = this.game, v = this.view;
    if (!v || !this.active || camera !== g.camera || g.warming || !v.inst.length) return;
    camera.updateMatrixWorld();
    const maxD = g.world?.culler?.maxDistance ?? Math.min(fogCullDistance(LOOK_SKY.fogDensity), LOOK_SKY.far);
    if (this.instValid && this.instEye.equals(camera.matrixWorld) && this.instProj.equals(camera.projectionMatrix) && this.instMax === maxD) return;
    this.instEye.copy(camera.matrixWorld);
    this.instProj.copy(camera.projectionMatrix);
    this.instMax = maxD;
    this.instValid = true;
    const t0 = performance.now();
    const r = cullSurfaceInstances(v, camera, maxD, this.occl);
    this.instStats.ms = performance.now() - t0;
    this.instStats.shown = r.shown;
    this.instStats.total = r.total;
    this.instStats.decisions++;
  }

  /** The district's textures (existing approved sets under the 'surface' family) + the office programs' maps. */
  async preload(): Promise<void> {
    const lr = this.game.levelResources;
    setSurfaceResourceOwner(r => lr.own(FAMILY, r));
    this.wireTentFlap();
    await Promise.all([
      ...SURFACE_TEX_SLOTS.map(async slot => {
        const spec = SURFACE_TEXTURES[slot];
        if (!spec.url) return;
        const t = await lr.load(FAMILY, spec.url, {srgb: spec.srgb, repeat: true, anisotropy: 8});
        setSurfaceTexture(slot, t);
      }),
      preloadOfficeArch().catch(() => undefined),
    ]);
  }

  /**
   * Lane AIR's door runtime drives the command tent's flap; the flap drawn is this district arch's (SurfaceArch.setTentFlap), so AIR
   * draws none of its own. Wired before the section build (AIR reads it there); a world without the arch simply shows no swing.
   */
  private wireTentFlap(): void {
    const air = surfaceAirRuntime();
    if (air && !air.tentFlap) air.tentFlap = open => { this.game.world?.surfaceArch?.setTentFlap(open); };
  }

  build(layout: StationLayout): void {
    if (!layout.surface) { this.teardown(); return; }
    const g = this.game;
    this.wireTentFlap();
    setSurfaceResourceOwner(r => g.levelResources.own(FAMILY, r));
    // (the textures a preload resolved stay; a build without one — tests / tools — keeps the flat fallbacks)
    for (const slot of SURFACE_TEX_SLOTS) { const t = g.levelResources.get(FAMILY, SURFACE_TEXTURES[slot].url); if (t) setSurfaceTexture(slot, t); }
    this.apply(LOOK_SKY.fogDensity, LOOK_SKY.fogColor);
    this.view?.root.removeFromParent();
    if (this.view) disposeSurfaceLookView(this.view);
    this.view = buildSurfaceLookView(layout, g.mats, k => g.propModels.get(k));
    this.instValid = false;
    if (this.view) {
      g.scene.add(this.view.root);
      this.view.stats.visibleDecor = cullSurfaceDecor(this.view, g.camera.position.x, g.camera.position.z);
    }
  }

  /** District fog / far plane / culler distance (density, colour: QA tunable). */
  apply(density: number, color: number): void {
    const g = this.game;
    const fog = g.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) {
      fog.density = density;
      fog.color.setHex(color);
      syncGlowFog(fog);
      syncLookHorizon(fog.color);
    }
    const cam = g.camera;
    if (this.farWas === null) this.farWas = cam.far;
    cam.far = Math.max(this.farWas, LOOK_SKY.far);
    cam.updateProjectionMatrix();
    const culler = g.world?.culler;
    if (culler) culler.maxDistance = Math.min(fogCullDistance(density), LOOK_SKY.far);
    this.active = true;
  }

  tick(): void {
    const v = this.view;
    if (!v || !this.active) return;
    const p = this.game.camera.position;
    v.dome.position.set(p.x, p.y, p.z);
    if (++this.frame % LOOK_DECOR.every === 0) v.stats.visibleDecor = cullSurfaceDecor(v, p.x, p.z);
  }

  teardown(): void {
    const g = this.game;
    if (this.view) { disposeSurfaceLookView(this.view); this.view = null; }
    this.instValid = false;
    (g.world as {surfaceArch?: SurfaceArch} | undefined)?.surfaceArch?.dispose();
    if (!this.active) return;
    const fog = g.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) {
      fog.density = MOOD.fogDensity;
      fog.color.setHex(MOOD.fogColor);
      syncGlowFog(fog);
    }
    if (this.farWas !== null) { g.camera.far = this.farWas; g.camera.updateProjectionMatrix(); }
    this.farWas = null;
    this.active = false;
  }

  /** QA summary. */
  summary(): Record<string, unknown> {
    const g = this.game, v = this.view, fog = g.scene.fog as THREE.FogExp2 | null;
    const arch = (g.world as {surfaceArch?: SurfaceArch} | undefined)?.surfaceArch;
    return {
      active: this.active, fog: fog ? {density: fog.density, color: fog.color.getHex()} : null, far: g.camera.far, cullerDistance: g.world?.culler?.maxDistance ?? null,
      textures: surfaceTexturesReady(), materials: {arch: liveSurfaceMaterials.size, look: liveLookMaterials()},
      view: v ? {...v.stats, far: v.far.stats, farTris: v.far.tris, culled: v.culled.length, instances: {...this.instStats, sets: v.inst.length, walls: v.walls.length, strips: v.strips.length, occl: this.occl.stats}} : null,
      arch: arch ? arch.summary() : null, daylight: daylightStats(),
    };
  }
}

const runtimes = new WeakMap<object, SurfaceLook>();
/** The installed look runtime of a game (QA / tests). */
export const surfaceLookOf = (game: object): SurfaceLook | undefined => runtimes.get(game);

export function installSurfaceLook(game: Game): void {
  if (runtimes.has(game)) return;
  runtimes.set(game, new SurfaceLook(game));
}

// ---------------------------------------------------------------------------------------------------------------------------
// QA poses + hooks

export interface SurfaceQaPose { name: string; x: number; z: number; yaw: number; level: number; look: {x: number; y: number; z: number} }

/**
 * Named QA poses of a district (for the lead's serial spot checks): an avenue, a destination's facade, inside a destination, the
 * cordon at a barricaded street end, the checkpoint tent's door, the depot's rail spur.
 */
export function surfaceQaPoses(layout: StationLayout): SurfaceQaPose[] {
  const S = layout.surface, plan = surfaceLookPlan(layout);
  if (!S || !plan) return [];
  const out: SurfaceQaPose[] = [];
  const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(-(tx - fx), -(tz - fz));
  const W = plan.W;
  const open = (x: number, z: number) => { const i = Math.floor(z / 0.5) * W + Math.floor(x / 0.5); return i >= 0 && i < plan.ground.length && plan.ground[i] !== GROUND.none && plan.ground[i] !== GROUND.interior; };
  // 1. an avenue (the widest segment), from one end looking along it
  const seg = [...plan.segments].sort((a, b) => b.w - a.w || (b.s1 - b.s0) - (a.s1 - a.s0))[0];
  if (seg) {
    const s = seg.s0 + 6, x = seg.axis === 'x' ? s : seg.c + seg.w / 4, z = seg.axis === 'x' ? seg.c + seg.w / 4 : s;
    const tx = seg.axis === 'x' ? seg.s1 : x, tz = seg.axis === 'x' ? z : seg.s1;
    out.push({name: 'avenue', x, z, yaw: yawTo(x, z, tx, tz), level: 0, look: {x: tx, y: 8, z: tz}});
  }
  // 2. a destination's facade from across its street; 3. inside it, a few metres past its entrance
  const dest = plan.buildings.find(b => b.b.destination && b.b.entrances.length) ?? plan.buildings.find(b => b.b.entrances.length);
  if (dest) {
    const e = dest.b.entrances[0], {alongX, n} = SIDE_NORMAL[e.side];
    const ox = alongX ? 0 : n, oz = alongX ? n : 0;
    let d = 14;
    while (d > 3 && !open(e.x + ox * d, e.z + oz * d)) d -= 1;
    out.push({name: 'facade', x: e.x + ox * d, z: e.z + oz * d, yaw: yawTo(e.x + ox * d, e.z + oz * d, e.x, e.z), level: e.level, look: {x: e.x, y: dest.top * 0.55, z: e.z}});
    out.push({name: 'interior', x: e.x - ox * 3, z: e.z - oz * 3, yaw: yawTo(e.x - ox * 3, e.z - oz * 3, e.x - ox * 10, e.z - oz * 10), level: e.level, look: {x: e.x - ox * 10, y: 1.4, z: e.z - oz * 10}});
  }
  // 4. the cordon: the perimeter road near the middle of the north side, looking at the wall
  {
    const I = plan.inner, x = (I.x0 + I.x1) / 2 + 3, z = I.z0 + 12;
    out.push({name: 'cordon', x, z, yaw: yawTo(x, z, x, I.z0), level: 0, look: {x, y: 3, z: I.z0}});
  }
  // 5. the checkpoint tent's door
  if (plan.tent) {
    const t = plan.tent, {alongX, n} = SIDE_NORMAL[t.door.side];
    const x = t.door.x + (alongX ? 0 : n * 5), z = t.door.z + (alongX ? n * 5 : 0);
    out.push({name: 'tent', x, z, yaw: yawTo(x, z, t.door.x, t.door.z), level: 0, look: {x: t.door.x, y: 1.6, z: t.door.z}});
  }
  // 6. the depot's rail spur
  if (plan.rail && plan.rail.points.length > 1) {
    const a = plan.rail.points[plan.rail.points.length - 1], b = plan.rail.points[0];
    out.push({name: 'rail', x: a.x + 2, z: a.z + 2, yaw: yawTo(a.x + 2, a.z + 2, b.x, b.z), level: 0, look: {x: b.x, y: 1, z: b.z}});
  }
  // 7. the depot shed (lane ROOMS' tracks / pit / crane): beside its first track a few metres in, looking down it
  const t = plan.depot?.tracks[0];
  if (t) {
    const len = Math.hypot(t.x1 - t.x0, t.z1 - t.z0), ux = (t.x1 - t.x0) / len, uz = (t.z1 - t.z0) / len;
    const x = t.x0 + ux * 3 - uz * (t.gauge / 2 + 1.2), z = t.z0 + uz * 3 + ux * (t.gauge / 2 + 1.2);
    const lx = t.x0 + ux * len * 0.7, lz = t.z0 + uz * len * 0.7;
    out.push({name: 'depot', x, z, yaw: yawTo(x, z, lx, lz), level: 0, look: {x: lx, y: t.y + 2.4, z: lz}});
  }
  return out;
}

/**
 * QA hooks (spread into window.__LL by qa.ts): surfaceLook() summary (fog / far / culler, draw + triangle counts, decor shown, the
 * daylight bake's stats, the arch's), surfaceLookTune({hemiTop, hemiBottom, horizon, zenith, sick, clouds, density, color}),
 * surfaceLookPoses(), surfaceLookPose(name) (teleport + look; null when not in a district).
 */
export function surfaceLookQaApi(game: {layout?: StationLayout}, lookAt: (x: number, y: number, z: number) => void, teleport: (x: number, z: number, yaw?: number, level?: number) => boolean) {
  return {
    surfaceLook: () => surfaceLookOf(game)?.summary() ?? {installed: false},
    surfaceLookTune: (o: Parameters<typeof lookTune>[0] & {density?: number; color?: number} = {}) => {
      const rt = surfaceLookOf(game);
      if (rt?.active && (typeof o.density === 'number' || typeof o.color === 'number')) rt.apply(o.density ?? LOOK_SKY.fogDensity, o.color ?? LOOK_SKY.fogColor);
      return lookTune(o);
    },
    surfaceLookPoses: () => (game.layout ? surfaceQaPoses(game.layout) : []),
    surfaceLookPose: (name: string) => {
      const p = game.layout ? surfaceQaPoses(game.layout).find(q => q.name === name) : undefined;
      if (!p || !teleport(p.x, p.z, p.yaw, p.level)) return null;
      lookAt(p.look.x, p.look.y, p.look.z);
      return p;
    },
  };
}

/** Plan access for tests (the plan the runtime draws from). */
export const surfaceLookPlanOf = (layout: StationLayout): SurfaceLookPlan | null => surfaceLookPlan(layout);
