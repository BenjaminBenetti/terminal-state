// Task reactor-build-20261101 (lane ARCH): the Reactor kit plan (archKit.ts) -> render objects. Unit geometries are built once per
// world; every (part, depth band) becomes ONE InstancedMesh tagged with the tiers that see it (userData.levels: the level culler
// draws it when one of them is current / seen through the pit), unique pieces one merged mesh per material, delivered models one
// InstancedMesh per (model mesh, band) carrying the Meshy materials unchanged. Lamp bulbs / lens glows are one InstancedMesh per
// tier (its material = that tier's power), fan rotors one InstancedMesh (spun by the visuals), panel lamps instance colours.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {MeshBasicNodeMaterial} from 'three/webgpu';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {canvasTexture} from '../canvasTextures';
import type {KitGeo, KitMat, KitPlan, KitRef} from './archKit';
import {REACTOR_MODELS, type ReactorPiece} from './archAssets';
import {LAMP, markerMaterial, tierBulbMaterial} from './archMaterials';

/** The unit geometries of the kit (see archKit.ts KitGeo). */
export function kitGeometry(geo: KitGeo): THREE.BufferGeometry {
  switch (geo) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1);
    case 'ibeam': {
      // I section: unit width (x) x unit depth (y), length along z; flanges 0.14, web 0.14
      const top = new THREE.BoxGeometry(1, 0.14, 1).translate(0, 0.43, 0), bot = new THREE.BoxGeometry(1, 0.14, 1).translate(0, -0.43, 0);
      const web = new THREE.BoxGeometry(0.16, 0.72, 1);
      return mergeGeometries([top, bot, web])!;
    }
    case 'cyl': return new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
    case 'tube': return new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true);
    case 'stripe': {
      // hazard stripe: a parallelogram leaning along +x (pitch 1, height 1), facing +z
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0, -0.5, 0, 0.5, 0.5, 0, 0, 0.5, 0], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 1, 1, 0.5, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      return g;
    }
    case 'plane': return new THREE.PlaneGeometry(1, 1);
    case 'bulb': return new THREE.IcosahedronGeometry(0.5, 0);
    case 'cage': {
      const parts: THREE.BufferGeometry[] = [];
      for (const [x, z] of [[0.42, 0.42], [-0.42, 0.42], [0.42, -0.42], [-0.42, -0.42]]) parts.push(new THREE.BoxGeometry(0.07, 1, 0.07).translate(x, 0, z));
      parts.push(new THREE.CylinderGeometry(0.6, 0.6, 0.14, 8, 1, false).translate(0, 0.5, 0));
      parts.push(new THREE.CylinderGeometry(0.55, 0.55, 0.07, 8, 1, true).translate(0, -0.46, 0));
      return mergeGeometries(parts)!;
    }
    case 'blade': {
      // fan rotor of unit radius in the local XY plane (axis +z): hub + 6 pitched blades
      const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.17, 0.17, 0.2, 12, 1, false).rotateX(Math.PI / 2)];
      for (let k = 0; k < 6; k++) parts.push(new THREE.BoxGeometry(0.22, 0.8, 0.025).rotateY(0.38).translate(0, 0.57, 0).rotateZ((k * Math.PI) / 3));
      return mergeGeometries(parts)!;
    }
    case 'wheel': {
      // handwheel (unit diameter) facing +z
      const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.46, 0.04, 6, 20)];
      parts.push(new THREE.BoxGeometry(0.9, 0.04, 0.04), new THREE.BoxGeometry(0.04, 0.9, 0.04), new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8).rotateX(Math.PI / 2));
      return mergeGeometries(parts.map(p => p.toNonIndexed()))!;
    }
  }
}

export interface KitBuildStats {
  meshes: number; instancedMeshes: number; mergedMeshes: number; modelMeshes: number; instances: number; triangles: number;
  modelInstances: Partial<Record<ReactorPiece, number>>; modelTriangles: number; lampMeshes: number; labelMeshes: number;
  byPart: Record<string, {instances: number; meshes: number; triangles: number}>;
}

/** Where an addressable plan instance (KitRef) or a model placement ended up. */
export interface InstanceSlot { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4 }

export interface KitBuilt {
  stats: KitBuildStats;
  /** Plan ref -> its instance (generator bodies / lamps). */
  slot(ref: KitRef): InstanceSlot | undefined;
  /** Model placements per piece: per placement, its instances (one per model mesh). */
  modelSlots: Map<ReactorPiece, InstanceSlot[][]>;
  /** The fan rotor InstancedMesh (instance i = plan.fans[i]) and the per-tier lamp meshes / materials. */
  fanRotors: THREE.InstancedMesh | null;
  tierLamps: Map<number, {mesh: THREE.InstancedMesh; mat: MeshBasicNodeMaterial}>;
  /** Every geometry created here (released with the world: the game disposes the world group's geometries). */
  geometries: THREE.BufferGeometry[];
}

const trisOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/**
 * Builds the plan into `group`. `mat(k)` resolves the kit materials; `models` the loaded GLTFs by REACTOR_MODELS[piece].key.
 * Never throws for a single bad piece (logged, skipped).
 */
export function buildKitMeshes(group: THREE.Group, plan: KitPlan, mat: (k: Exclude<KitMat, 'marker'>) => THREE.Material, models: Readonly<Record<string, GLTF | undefined>>): KitBuilt {
  const stats: KitBuildStats = {meshes: 0, instancedMeshes: 0, mergedMeshes: 0, modelMeshes: 0, instances: 0, triangles: 0, modelInstances: {}, modelTriangles: 0, lampMeshes: 0, labelMeshes: 0, byPart: {}};
  const geos = new Map<KitGeo, THREE.BufferGeometry>();
  const created: THREE.BufferGeometry[] = [];
  const geoOf = (g: KitGeo) => { let x = geos.get(g); if (!x) { geos.set(g, (x = kitGeometry(g))); created.push(x); } return x; };
  const tag = (o: THREE.Object3D, bands: Iterable<number>) => {
    const lv = new Set<number>();
    for (const b of bands) for (const l of plan.bandLevels(b)) lv.add(l);
    if (lv.size) o.userData.levels = [...lv].sort((a, b) => a - b);
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  };
  const addIM = (im: THREE.InstancedMesh, partKey: string, bands: Iterable<number>) => {
    im.computeBoundingSphere();
    im.computeBoundingBox();
    tag(im, bands);
    group.add(im);
    stats.meshes++; stats.instancedMeshes++;
    stats.instances += im.count;
    const t = trisOf(im.geometry) * im.count;
    stats.triangles += t;
    const p = (stats.byPart[partKey] ??= {instances: 0, meshes: 0, triangles: 0});
    p.instances += im.count; p.meshes++; p.triangles += t;
  };
  // --- instanced parts, chunked per band
  const slots = new Map<string, InstanceSlot[]>();
  for (const [key, part] of plan.parts) {
    const byBand = new Map<number, number[]>();
    part.list.forEach((inst, i) => { let l = byBand.get(inst.band); if (!l) byBand.set(inst.band, (l = [])); l.push(i); });
    const per: InstanceSlot[] = new Array(part.list.length);
    const material = part.mat === 'marker' ? null : mat(part.mat);
    if (!material) continue;
    const colored = part.list.some(x => x.color !== undefined);
    const c = new THREE.Color();
    for (const [band, idx] of byBand) {
      const im = new THREE.InstancedMesh(geoOf(part.geo), material, idx.length);
      im.name = `reactor-${part.geo}-${part.mat}-b${band}`;
      idx.forEach((i, k) => {
        const inst = part.list[i];
        im.setMatrixAt(k, inst.m);
        if (colored) im.setColorAt(k, c.setHex(inst.color ?? 0xffffff));
        per[i] = {mesh: im, index: k, base: inst.m};
      });
      addIM(im, key, [band]);
    }
    slots.set(key, per);
  }
  // --- merged unique pieces
  for (const mg of plan.merged) {
    if (!mg.geos.length) continue;
    const material = mg.mat === 'marker' ? null : mat(mg.mat);
    let merged: THREE.BufferGeometry | null = null;
    try { merged = mergeGeometries(mg.geos.map(g => (g.index ? g.toNonIndexed() : g))); } catch { merged = null; }
    for (const g of mg.geos) g.dispose();
    if (!merged || !material) continue;
    merged.computeBoundingSphere();
    created.push(merged);
    const m = new THREE.Mesh(merged, material);
    m.name = mg.name;
    tag(m, [mg.band]);
    group.add(m);
    stats.meshes++; stats.mergedMeshes++;
    stats.triangles += trisOf(merged);
    const p = (stats.byPart[mg.name] ??= {instances: 0, meshes: 0, triangles: 0});
    p.meshes++; p.triangles += trisOf(merged);
  }
  // --- delivered models: one InstancedMesh per (model mesh, band); Meshy materials kept as loaded
  const modelSlots = new Map<ReactorPiece, InstanceSlot[][]>();
  for (const [piece, list] of plan.modelPlacements) {
    const gltf = models[REACTOR_MODELS[piece].key];
    if (!gltf || !list.length) continue;
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const per: InstanceSlot[][] = list.map(() => []);
    const byBand = new Map<number, number[]>();
    list.forEach((p, i) => { let l = byBand.get(p.band); if (!l) byBand.set(p.band, (l = [])); l.push(i); });
    for (const mesh of meshes) {
      for (const [band, idx] of byBand) {
        const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, idx.length);
        im.name = `reactor-model-${piece}-b${band}`;
        idx.forEach((i, k) => {
          const base = new THREE.Matrix4().multiplyMatrices(list[i].m, mesh.matrixWorld);
          im.setMatrixAt(k, base);
          per[i].push({mesh: im, index: k, base});
        });
        addIM(im, `model:${piece}`, [band]);
        stats.modelMeshes++;
        stats.modelTriangles += trisOf(mesh.geometry) * idx.length;
      }
    }
    stats.modelInstances[piece] = list.length;
    modelSlots.set(piece, per);
  }
  // --- fan rotors (one InstancedMesh; matrices set by the visuals every frame they spin)
  let fanRotors: THREE.InstancedMesh | null = null;
  if (plan.fans.length) {
    fanRotors = new THREE.InstancedMesh(geoOf('blade'), mat('steelDark'), plan.fans.length);
    fanRotors.name = 'reactor-fan-rotors';
    const m = new THREE.Matrix4(), s = new THREE.Vector3();
    plan.fans.forEach((f, i) => fanRotors!.setMatrixAt(i, m.copy(f.basis).scale(s.setScalar(f.radius))));
    fanRotors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fanRotors.frustumCulled = false; // spinning: its bounds are the discs (the level culler leaves it alone too)
    addIM(fanRotors, 'blade|rotor', plan.fans.map(f => plan.bandOf(f.hub.y)));
  }
  // --- lamp bulbs / lens glows: one InstancedMesh per tier (material = the tier's power)
  const tierLamps = new Map<number, {mesh: THREE.InstancedMesh; mat: MeshBasicNodeMaterial}>();
  const byTier = new Map<number, number[]>();
  plan.lamps.forEach((l, i) => { let x = byTier.get(l.level); if (!x) byTier.set(l.level, (x = [])); x.push(i); });
  for (const [level, idx] of byTier) {
    const lm = tierBulbMaterial(level);
    const im = new THREE.InstancedMesh(geoOf('bulb'), lm, idx.length);
    im.name = `reactor-lamps-tier-${level}`;
    const c = new THREE.Color();
    idx.forEach((i, k) => {
      const l = plan.lamps[i];
      im.setMatrixAt(k, l.m);
      im.setColorAt(k, l.dead ? c.setScalar(LAMP.dead) : c.setRGB(1, l.tint, l.tint * l.tint));
    });
    addIM(im, 'bulb|tier', idx.map(i => plan.lamps[i].band));
    stats.lampMeshes++;
    tierLamps.set(level, {mesh: im, mat: lm});
  }
  // --- stencilled tier labels (one atlas, one merged mesh)
  try { if (buildLabels(group, plan, created, tag)) { stats.meshes++; stats.labelMeshes++; } } catch (e) { console.warn('reactor kit: labels skipped', e); }
  return {stats, slot: ref => slots.get(ref.part)?.[ref.index], modelSlots, fanRotors, tierLamps, geometries: created};
}

/** Label atlas row size (px) and the text style: stencilled black capitals on the painted band. */
const ROW_W = 1024, ROW_H = 128;

function buildLabels(group: THREE.Group, plan: KitPlan, created: THREE.BufferGeometry[], tag: (o: THREE.Object3D, bands: Iterable<number>) => void): boolean {
  if (!plan.labels.length || typeof document === 'undefined') return false;
  const texts = [...new Set(plan.labels.map(l => l.text))];
  const H = Math.max(ROW_H, texts.length * ROW_H);
  const atlas = canvasTexture(ROW_W, H, 9917, ctx => {
    ctx.clearRect(0, 0, ROW_W, H);
    texts.forEach((t, r) => {
      ctx.save();
      ctx.fillStyle = '#121110';
      let size = 96;
      const font = () => `bold ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      ctx.font = font();
      while (ctx.measureText(t).width > ROW_W - 40 && size > 30) { size -= 4; ctx.font = font(); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.toUpperCase(), ROW_W / 2, r * ROW_H + ROW_H / 2 + 4);
      // stencil bridges: thin gaps through the letters
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(0, r * ROW_H + ROW_H * 0.47, ROW_W, 5);
      ctx.restore();
    });
  });
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const l of plan.labels) {
    const r = texts.indexOf(l.text);
    // the plane's aspect crops the row's centre (the text is centred in its row): never stretched
    const a = Math.min(ROW_W / ROW_H, l.aspect);
    const u0 = 0.5 - (a * ROW_H) / ROW_W / 2, u1 = 0.5 + (a * ROW_H) / ROW_W / 2;
    const v0 = 1 - ((r + 1) * ROW_H) / H, v1 = 1 - (r * ROW_H) / H;
    const b = pos.length / 3;
    nm.getNormalMatrix(l.m);
    n.set(0, 0, 1).applyMatrix3(nm).normalize();
    for (const [x, y, uu, vv] of [[-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0], [0.5, 0.5, u1, v1], [-0.5, 0.5, u0, v1]] as const) {
      v.set(x, y, 0).applyMatrix4(l.m);
      pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(uu, vv);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  created.push(g);
  const m = new THREE.Mesh(g, markerMaterial(atlas));
  m.name = 'reactor-tier-labels';
  tag(m, plan.labels.map(l => l.band));
  group.add(m);
  return true;
}
