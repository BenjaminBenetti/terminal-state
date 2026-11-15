/** Modular upper ruins and street dressing for the real, walkable Surface Run layout. No geometry outside its 8x8 boundary. */
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {StationLayout} from '../../gen/stationTypes';
import type {SurfaceDestination, SurfaceInfo, SurfaceRect} from '../../gen/surface/types';
import {SurfaceNodeMaterial, surfaceMaterial, type WorldMaterials} from '../materials';
import {tagReflect} from '../../render/reflectTag';
import {SurfaceSectors} from './sectors';

export const SURFACE_CITY_MODEL_KEYS = ['office-ruined-tower', 'office-ruined-midrise', 'office-rubble-pile', 'office-car-wreck', 'office-bus-wreck'] as const;
export interface SurfaceCityView {
  root: THREE.Group;
  sectors: SurfaceSectors;
  mapFace: THREE.Mesh | null;
  dispose(): void;
  stats: {sectors: number; meshes: number; modelInstances: number; triangles: number; missing: string[]};
}

type ModelLibrary = {get(key: string): GLTF | undefined};
type Parts = Map<THREE.Material, THREE.BufferGeometry[]>;
const UP = new THREE.Vector3(0, 1, 0);

/** All facade variety is derived from destination identity, never a live RNG. */
function hash(text: string, seed = 0): number {
  let h = seed ^ 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Canvas text is handmade wayfinding, not generated imagery. */
function signTexture(text: string, sub: string, color: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 640; c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = color; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#aaa489'; ctx.lineWidth = 6; ctx.strokeRect(7, 7, 626, 114);
  ctx.fillStyle = '#e1ddc9'; ctx.font = 'bold 33px monospace'; ctx.textAlign = 'center'; ctx.fillText(text.toUpperCase(), 320, 61, 600);
  ctx.fillStyle = '#b0b5a0'; ctx.font = '17px monospace'; ctx.fillText(sub.toUpperCase(), 320, 99, 590);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Place a sign just outside the REAL entrance, facing out from its nearest wall. */
function entranceFace(d: SurfaceDestination): {x: number; z: number; yaw: number} {
  const e = d.entrance;
  const near = [
    {dist: Math.abs(e.z - d.z), x: e.x, z: d.z - 0.06, yaw: Math.PI},
    {dist: Math.abs(e.z - (d.z + d.d)), x: e.x, z: d.z + d.d + 0.06, yaw: 0},
    {dist: Math.abs(e.x - d.x), x: d.x - 0.06, z: e.z, yaw: -Math.PI / 2},
    {dist: Math.abs(e.x - (d.x + d.w)), x: d.x + d.w + 0.06, z: e.z, yaw: Math.PI / 2},
  ];
  return near.sort((a, b) => a.dist - b.dist)[0];
}

export function buildSurfaceCity(layout: StationLayout, mats: WorldMaterials, lib: ModelLibrary, mapTexture: THREE.Texture | null): SurfaceCityView | null {
  const info = layout.surface;
  if (!info) return null;
  const root = new THREE.Group(); root.name = 'surface-run-city';
  const sectors = new SurfaceSectors();
  const owned: {dispose(): void}[] = [], instanced: THREE.InstancedMesh[] = [];
  const groups = new Map<string, THREE.Group>(), parts = new Map<string, Parts>();
  const stats = {sectors: 0, meshes: 0, modelInstances: 0, triangles: 0, missing: [] as string[]};
  const makeMat = (name: string, color: number, roughness = 0.92, metalness = 0, map?: THREE.Texture | null) => {
    // Reuse the normal/roughness maps of the shared weathered finish kit. The concrete colour map is unchanged;
    // the roughness factor stays1 because three multiplies it by the authored map. Loaded GLB PBR stays untouched.
    const m = map ? surfaceMaterial(metalness > 0 ? 'paintedSteel' : 'paintedPanel', {color, metalness, map}, {grime: [0.35, 0.8], macro: 0.18, normal: 0.5}) : new SurfaceNodeMaterial({color, roughness, metalness});
    m.name = `surface-run-${name}`; owned.push(m); return m;
  };
  const concreteMap = (mats.get('concrete') as THREE.MeshStandardMaterial).map;
  const concrete = makeMat('weathered-concrete', 0x999a8a, 0.96, 0, concreteMap);
  const asphalt = makeMat('broken-asphalt', 0x303932, 0.99, 0, concreteMap);
  const sidewalk = makeMat('pavement', 0x70766b, 0.98, 0, concreteMap);
  const brick = makeMat('warm-masonry', 0x6b5950, 0.97, 0, concreteMap);
  const soot = makeMat('burnt-masonry', 0x454b45, 0.96, 0, concreteMap);
  const paint = makeMat('faded-markings', 0xb6b19b, 0.97, 0, concreteMap);
  const steel = tagReflect(makeMat('corroded-steel', 0x414b46, 0.78, 0.48, concreteMap), 'metal');
  const dark = makeMat('vacant-window', 0x17211f, 0.95, 0);
  const glass = tagReflect(makeMat('unbroken-window', 0x455b55, 0.28, 0.12), 'window');
  const canvas = makeMat('military-canvas', 0x4e5940, 0.98, 0, concreteMap);
  const palettes = [concrete, brick, soot];
  const sectorId = (x: number, z: number) => `${Math.max(0, Math.min(7, Math.floor((x - info.bounds.x) / info.blockSize)))},${Math.max(0, Math.min(7, Math.floor((z - info.bounds.z) / info.blockSize)))}`;
  const groupAt = (x: number, z: number): THREE.Group => {
    const id = sectorId(x, z); let g = groups.get(id);
    if (!g) { g = new THREE.Group(); g.name = `surface-sector-${id}`; root.add(g); groups.set(id, g); parts.set(id, new Map()); }
    return g;
  };
  const addGeo = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number) => {
    const group = groupAt(x, z), bucket = parts.get(group.name.replace('surface-sector-', ''))!;
    const list = bucket.get(mat) ?? []; list.push(g); bucket.set(mat, list);
  };
  const box = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0, rz = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (rz) geo.rotateZ(rz); if (yaw) geo.rotateY(yaw); geo.translate(x, y, z);
    addGeo(geo, mat, x, z);
  };
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, name: string, group: THREE.Group, cast = true): THREE.Mesh => {
    g.computeBoundingSphere(); owned.push(g);
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = cast; m.receiveShadow = true; m.userData.level = 0; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m);
    stats.meshes++; stats.triangles += (g.index?.count ?? g.attributes.position.count) / 3; return m;
  };
  const modelPlacements = new Map<string, Map<string, {r: SurfaceRect; y: number; h: number; yaw: number}[]>>();
  const model = (key: string, r: SurfaceRect, y: number, h: number, yaw: number) => {
    const id = sectorId(r.x + r.w / 2, r.z + r.d / 2), bySector = modelPlacements.get(key) ?? new Map();
    const list = bySector.get(id) ?? []; list.push({r, y, h, yaw}); bySector.set(id, list); modelPlacements.set(key, bySector); groupAt(r.x + r.w / 2, r.z + r.d / 2);
  };

  // Street surfacing is chunked into the same block sectors as its dressing. The vertical strips stop at junctions,
  // avoiding coplanar duplicate asphalt there; nothing is one giant permanent city plane.
  for (const r of info.roads.filter(r => r.axis === 'x')) {
    for (let x = r.x; x < r.x + r.w; x += info.blockSize) {
      const width = Math.min(info.blockSize, r.x + r.w - x);
      box(asphalt, x + width / 2, 0.004, r.z + r.d / 2, width, 0.008, r.d);
    }
  }
  for (const r of info.roads.filter(r => r.axis === 'z')) {
    for (const b of info.blocks.filter(b => b.col === 0)) box(asphalt, r.x + r.w / 2, 0.004, b.z + b.d / 2, r.w, 0.008, b.d);
  }
  // Pavement and curbs stay within the real lots. Every 8 m street remains open all the way to the 8x8 perimeter.
  for (const b of info.blocks) {
    const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
    box(sidewalk, cx, 0.013, b.z + 0.65, b.w, 0.026, 1.3);
    box(sidewalk, cx, 0.013, b.z + b.d - 0.65, b.w, 0.026, 1.3);
    box(sidewalk, b.x + 0.65, 0.013, cz, 1.3, 0.026, b.d - 2.6);
    box(sidewalk, b.x + b.w - 0.65, 0.013, cz, 1.3, 0.026, b.d - 2.6);
    box(concrete, cx, 0.035, b.z + 0.15, b.w, 0.07, 0.3);
    box(concrete, cx, 0.035, b.z + b.d - 0.15, b.w, 0.07, 0.3);
    box(concrete, b.x + 0.15, 0.035, cz, 0.3, 0.07, b.d);
    box(concrete, b.x + b.w - 0.15, 0.035, cz, 0.3, 0.07, b.d);
  }
  for (const r of info.roads) {
    const len = r.axis === 'x' ? r.w : r.d;
    for (let p = 5; p < len - 3; p += 9) {
      const x = r.axis === 'x' ? r.x + p : r.x + r.w / 2, z = r.axis === 'z' ? r.z + p : r.z + r.d / 2;
      // Skip junctions: the marked lines never pretend there is a road through a building.
      const junction = info.roads.some(q => q.axis !== r.axis && x >= q.x && x <= q.x + q.w && z >= q.z && z <= q.z + q.d);
      if (!junction) box(paint, x, 0.014, z, r.axis === 'x' ? 3 : 0.13, 0.02, r.axis === 'z' ? 3 : 0.13);
    }
  }
  // The outer blocks use the already approved destroyed tower kit, fitted to the generator's COLLIDABLE shell footprints.
  for (const s of info.shells) model(s.variant % 3 === 0 ? 'office-ruined-tower' : 'office-ruined-midrise', s, 0, s.height, s.variant % 2 ? Math.PI : 0);

  for (const d of info.destinations) {
    const seed = hash(d.id, info.seed), mat = palettes[d.facade % palettes.length];
    const storeys = d.kind === 'depot' ? 0 : d.kind === 'office' ? 2 + seed % 2 : 1 + seed % 2;
    const top = d.height + storeys * 3.6;
    const cx = d.x + d.w / 2, cz = d.z + d.d / 2;
    if (storeys) {
      // A modular masonry ring, open in the middle. Jagged bays and exposed concrete slabs break the repeated silhouette.
      for (let level = 0; level < storeys; level++) {
        const y = d.height + level * 3.6;
        box(concrete, cx, y + 0.1, cz, d.w, 0.2, d.d);
        for (let side = 0; side < 4; side++) {
          const alongX = side < 2, length = alongX ? d.w : d.d, n = Math.max(2, Math.floor(length / 3.7));
          for (let bay = 0; bay < n; bay++) {
            const broken = (seed + bay * 13 + level * 37 + side * 19) % 9;
            if (level === storeys - 1 && broken < 2) continue;
            const a = (bay + 0.5) / n, x = alongX ? d.x + a * d.w : side === 2 ? d.x : d.x + d.w;
            const z = alongX ? side === 0 ? d.z : d.z + d.d : d.z + a * d.d;
            const span = length / n;
            box(mat, x, y + 1.8, z, alongX ? span - 0.08 : 0.35, 3.4, alongX ? 0.35 : span - 0.08);
            const paneMat = broken > 5 ? glass : dark;
            const px = x + (side === 2 ? -0.19 : side === 3 ? 0.19 : 0), pz = z + (side === 0 ? -0.19 : side === 1 ? 0.19 : 0);
            box(paneMat, px, y + 1.9, pz, alongX ? span * 0.66 : 0.035, 1.8, alongX ? 0.035 : span * 0.66);
            if (broken === 3) box(steel, px, y + 2.1, pz, alongX ? span * 0.73 : 0.07, 0.16, alongX ? 0.07 : span * 0.73);
          }
        }
      }
      // Exposed, displaced parapet fragments at the broken roofline.
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5, y = top + 0.2 + ((seed >> i) & 1) * 0.3;
        box(mat, d.x + t * d.w, y, d.z, d.w / 8, 0.7, 0.45, 0, (i % 2 ? 1 : -1) * 0.08);
      }
    } else {
      for (let i = 0; i < 5; i++) box(steel, d.x + (i + 0.5) * d.w / 5, d.height + 0.5, cz, 0.14, 0.2, d.d + 0.2);
      box(steel, cx, d.height + 1.5, d.z + d.d * 0.64, d.w * 0.7, 1.3, 0.3);
    }
    const face = entranceFace(d), tex = signTexture(d.label, d.kind === 'depot' ? 'Rail maintenance · recovery stores' : d.kind === 'shopping-centre' ? 'Local merchants · passage open' : d.kind === 'office' ? 'Offices · deliveries at front' : 'Supplies · neighbourhood store', d.facade % 2 ? '#3d4940' : '#4a3e35');
    if (tex) {
      owned.push(tex); const sm = new SurfaceNodeMaterial({map: tex, roughness: 0.87}); sm.name = 'surface-run-wayfinding'; owned.push(sm);
      const g = new THREE.PlaneGeometry(Math.min(d.w - 1, 6), 1.15); g.rotateY(face.yaw); g.translate(face.x, Math.min(3, d.height - 0.65), face.z);
      mesh(g, sm, `surface-sign-${d.id}`, groupAt(cx, cz), false);
    }
  }
  for (const d of info.dressing) {
    if (d.kind === 'wreck' || d.kind === 'bus' || d.kind === 'rubble') {
      model(d.kind === 'wreck' ? 'office-car-wreck' : d.kind === 'bus' ? 'office-bus-wreck' : 'office-rubble-pile', {x: d.x - d.w / 2, z: d.z - d.d / 2, w: d.w, d: d.d}, 0, d.h, d.yaw);
    } else if (d.kind === 'lamp') {
      box(steel, d.x, d.h / 2, d.z, 0.12, d.h, 0.12);
      box(steel, d.x + Math.sin(d.yaw) * 0.35, d.h - 0.15, d.z + Math.cos(d.yaw) * 0.35, d.w, 0.15, d.d, d.yaw);
    } else {
      box(concrete, d.x, d.h * 0.25, d.z, d.w, d.h * 0.5, d.d, d.yaw);
      box(concrete, d.x, d.h * 0.7, d.z, d.w * 0.9, d.h * 0.4, d.d * 0.65, d.yaw);
      for (let i = -1; i <= 1; i++) box(paint, d.x + Math.cos(d.yaw) * d.w * i / 4, d.h * 0.72, d.z - Math.sin(d.yaw) * d.w * i / 4, 0.2, d.h * 0.35, d.d * 0.68, d.yaw);
    }
  }
  // Open military command tent: toxic air still enters; only the truck's enclosed cab provides protection.
  const cp = info.checkpoint, tx = cp.x + 5, tz = cp.z + 5, y = cp.y;
  for (const dx of [-4.5, 4.5]) for (const dz of [-4.5, 4.5]) box(steel, tx + dx, y + 1.5, tz + dz, 0.1, 3, 0.1);
  box(steel, tx, y + 3.5, tz, 0.12, 0.12, 9.6);
  const roofPitch = Math.atan2(1.2, 4.7), roofW = Math.hypot(4.7, 1.2);
  box(canvas, tx - 2.35, y + 2.9, tz, roofW, 0.055, 9.7, 0, roofPitch);
  box(canvas, tx + 2.35, y + 2.9, tz, roofW, 0.055, 9.7, 0, -roofPitch);
  box(canvas, tx - 4.65, y + 1.175, tz, 0.055, 2.35, 9.6);
  box(canvas, tx + 4.65, y + 1.175, tz, 0.055, 2.35, 9.6);
  box(canvas, tx, y + 1.175, tz - 4.7, 9.2, 2.35, 0.055);
  const map = cp.map;
  box(steel, map.x, map.y - 0.08, map.z, 2.8, 0.14, 2.1);
  for (const dx of [-1.15, 1.15]) for (const dz of [-0.82, 0.82]) box(steel, map.x + dx, map.y / 2, map.z + dz, 0.08, map.y, 0.08);
  let mapFace: THREE.Mesh | null = null;
  if (mapTexture) {
    const mm = new SurfaceNodeMaterial({map: mapTexture, roughness: 0.94}); mm.name = 'surface-run-dynamic-map'; owned.push(mm);
    const g = new THREE.PlaneGeometry(2.72, 2.04); g.rotateX(-Math.PI / 2); g.translate(map.x, map.y + 0.004, map.z);
    mapFace = mesh(g, mm, 'surface-planning-map', groupAt(map.x, map.z), false);
  }
  const notice = signTexture('EXPEDITION CHECKPOINT', 'Toxic air · Return to the train to save', '#414c36');
  if (notice) {
    owned.push(notice); const m = new SurfaceNodeMaterial({map: notice, roughness: 0.94}); owned.push(m);
    const g = new THREE.PlaneGeometry(5.2, 1.04); g.translate(tx, y + 2.4, tz + 4.73);
    mesh(g, m, 'surface-checkpoint-sign', groupAt(tx, tz), false);
  }
  // Merge handmade pieces per material PER SECTOR. Library models share their original PBR materials/maps and geometry.
  for (const [id, bucket] of parts) {
    for (const [mat, list] of bucket) {
      const g = mergeGeometries(list, false); for (const p of list) p.dispose();
      if (g) mesh(g, mat, `surface-kit-${mat.name}`, groups.get(id)!);
    }
  }
  for (const [key, bySector] of modelPlacements) {
    const gltf = lib.get(key);
    if (!gltf) { stats.missing.push(key); continue; }
    gltf.scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(gltf.scene.matrixWorld).invert(), bounds = new THREE.Box3().setFromObject(gltf.scene), sz = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
    gltf.scene.traverse(o => {
      const src = o as THREE.Mesh; if (!src.isMesh || !src.geometry?.attributes.position) return;
      const local = new THREE.Matrix4().multiplyMatrices(inv, src.matrixWorld);
      for (const [id, list] of bySector) {
        const im = new THREE.InstancedMesh(src.geometry, src.material, list.length); im.name = `surface-model-${key}`; im.castShadow = im.receiveShadow = true;
        list.forEach((p, i) => {
          const fit = new THREE.Matrix4().compose(new THREE.Vector3(p.r.x + p.r.w / 2, p.y, p.r.z + p.r.d / 2), new THREE.Quaternion().setFromAxisAngle(UP, p.yaw), new THREE.Vector3(p.r.w / Math.max(sz.x, 0.01), p.h / Math.max(sz.y, 0.01), p.r.d / Math.max(sz.z, 0.01)));
          fit.multiply(new THREE.Matrix4().makeTranslation(-centre.x, -bounds.min.y, -centre.z)).multiply(local); im.setMatrixAt(i, fit);
        });
        im.instanceMatrix.needsUpdate = true; im.computeBoundingBox(); im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix(); groups.get(id)!.add(im); instanced.push(im);
        stats.meshes++; stats.modelInstances += list.length; stats.triangles += (src.geometry.index?.count ?? src.geometry.attributes.position.count) / 3 * list.length;
      }
    });
  }
  root.updateMatrixWorld(true);
  for (const [id, g] of groups) sectors.add(id, g);
  stats.sectors = sectors.sectors.length;
  return {root, sectors, mapFace, stats, dispose() { root.removeFromParent(); sectors.clear(); for (const im of instanced) im.dispose(); for (const p of owned) p.dispose(); }};
}

/** Used by asset planning: the city is not fetched merely because the underground level has an access route. */
export const surfaceCityModelKeysFor = (layout: StationLayout): readonly string[] => layout.surface ? SURFACE_CITY_MODEL_KEYS : [];

/** Local destination observations for QA and the checkpoint's map; no enemy/global-campaign state is leaked. */
export const surfaceCitySummary = (info: SurfaceInfo) => ({blocks: info.blocks.length, destinations: info.destinations.map(d => ({id: d.id, kind: d.kind, entrance: {...d.entrance}})), boundary: {...info.bounds}});
