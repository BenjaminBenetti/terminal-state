// Task reactor-expansion-20261101 (lane WASTE): the waste repository's RUNTIME LOOK — instances layout.reactorWaste (gen/reactor/complex/
// wasteTypes.ts, written by the complex's dress hook) into the world group once, at build (world/builder.ts, Reactor layouts only):
//  - the lead's approved models where loaded (REACTOR_X_KIT waste drums in the racks, dry casks, decon booths, the hot-cell window;
//    REACTOR_KIT switchgear / console / fan housings), real size, Meshy materials kept — one InstancedMesh per (model mesh, 12 m chunk);
//  - everything else from the Reactor's EXISTING kit materials (archMaterials.ts reactorDress: the lead's Codex rusted-steel / pit-
//    concrete / grating sets, the painted-steel fallbacks): rack uprights / beams / decks, plinths, ducts, door frames,
//    the crane runway, hazard bands (yellow / black), the compactor press, pucks, pipes; procedural stand-ins for a model that failed
//    to load (Node tests, a 404) — never an untextured block;
//  - the yellow-green status beacons: unlit glow instances (no light sources: accents cost nothing per frame).
// Bounded: ~20-40 InstancedMeshes for the whole complex, chunked so frustum culling works, every mesh tagged with its storey for the level
// culler (userData.levels). Static: no per-frame work. Returns stats (QA / tests).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {StationLayout} from '../../gen/stationTypes';
import type {WasteMat, WasteModel} from '../../gen/reactor/complex/wasteTypes';
import type {WorldMaterials} from '../materials';
import {reactorDress} from './archMaterials';
import {kitGeometry} from './archMeshes';
import {FAN_HOUSING, WASTE_MODELS} from './wasteAssets';

export interface WasteVisualStats {
  meshes: number;
  instances: number;
  triangles: number;
  /** Placements drawn from a loaded model / procedurally (by piece). */
  models: Record<string, number>;
  procedural: Record<string, number>;
}

/** Stats of the last build (QA). */
export let WASTE_VISUAL_STATS: WasteVisualStats | null = null;

const CHUNK = 12;
const BEACON_ON = 0xc8ff3c, BEACON_OFF = 0x1a1e14;

type Geo = 'box' | 'cyl' | 'bulb' | 'blade' | 'tube';
interface Inst { m: THREE.Matrix4; c?: number }

/** Builds the repository's visuals into `group` (null when the layout has no waste repository). */
export function buildWasteVisuals(group: THREE.Group, layout: StationLayout, mats: WorldMaterials, models: Readonly<Record<string, GLTF | undefined>>): WasteVisualStats | null {
  const D = layout.reactorWaste;
  if (!D) { WASTE_VISUAL_STATS = null; return null; }
  const stats: WasteVisualStats = {meshes: 0, instances: 0, triangles: 0, models: {}, procedural: {}};
  const dress = reactorDress(mats);
  const matOf = (k: WasteMat | 'panelLamp'): THREE.Material => (dress as Record<string, THREE.Material>)[k] ?? dress.steel;
  // (geo, mat, chunk) -> instances
  const buckets = new Map<string, {geo: Geo; mat: WasteMat | 'panelLamp'; list: Inst[]}>();
  const chunkOf = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  const add = (geo: Geo, mat: WasteMat | 'panelLamp', m: THREE.Matrix4, x: number, z: number, c?: number) => {
    const k = `${geo}|${mat}|${chunkOf(x, z)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = {geo, mat, list: []}));
    b.list.push({m, ...(c !== undefined ? {c} : {})});
  };
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  const boxM = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    new THREE.Matrix4().compose(p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q.identity(), s.set(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0)));

  // --- boxes and cylinders ---------------------------------------------------------------------------------------------------------
  for (const b of D.boxes) add('box', b.m, boxM(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1), (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.c);
  for (const c of D.cyls) {
    if (c.ax) {
      e.set(c.ax === 'x' ? 0 : Math.PI / 2, 0, c.ax === 'x' ? Math.PI / 2 : 0);
      add('cyl', c.m, new THREE.Matrix4().compose(p.set(c.x, c.y, c.z), q.setFromEuler(e), s.set(2 * c.r, c.h, 2 * c.r)), c.x, c.z, c.c);
    } else add('cyl', c.m, new THREE.Matrix4().compose(p.set(c.x, c.y + c.h / 2, c.z), q.identity(), s.set(2 * c.r, c.h, 2 * c.r)), c.x, c.z, c.c);
  }
  // --- hazard bands: alternating yellow / black slats across the band's long axis --------------------------------------------------
  for (const st of D.stripes) {
    const alongX = st.x1 - st.x0 >= st.z1 - st.z0, len = alongX ? st.x1 - st.x0 : st.z1 - st.z0, pitch = 0.3;
    const n = Math.max(1, Math.round(len / pitch)), step = len / n;
    for (let i = 0; i < n; i++) for (const [half, mat] of [[0, 'yellow'], [1, 'black']] as const) {
      const a0 = (alongX ? st.x0 : st.z0) + i * step + half * step / 2, a1 = a0 + step / 2;
      const m = alongX ? boxM(a0, st.y + 0.002, st.z0, a1, st.y + 0.012, st.z1) : boxM(st.x0, st.y + 0.002, a0, st.x1, st.y + 0.012, a1);
      add('box', mat, m, alongX ? (a0 + a1) / 2 : (st.x0 + st.x1) / 2, alongX ? (st.z0 + st.z1) / 2 : (a0 + a1) / 2);
    }
  }
  // --- beacons: a glowing dome on a black base ---------------------------------------------------------------------------------------
  for (const bc of D.beacons) {
    add('box', 'black', boxM(bc.x - 0.07, bc.y - 0.06, bc.z - 0.07, bc.x + 0.07, bc.y, bc.z + 0.07), bc.x, bc.z);
    add('bulb', 'panelLamp', new THREE.Matrix4().compose(p.set(bc.x, bc.y + 0.05, bc.z), q.identity(), s.set(0.13, 0.13, 0.13)), bc.x, bc.z, bc.on ? BEACON_ON : BEACON_OFF);
  }
  // --- models (or their procedural stand-ins) ----------------------------------------------------------------------------------------
  const placed = new Map<string, {gltf: GLTF; list: THREE.Matrix4[]; xz: [number, number][]}>();
  const placeModel = (piece: string, key: string, m: THREE.Matrix4, x: number, z: number): boolean => {
    const gltf = models[key];
    if (!gltf) return false;
    let e2 = placed.get(piece);
    if (!e2) placed.set(piece, (e2 = {gltf, list: [], xz: []}));
    e2.list.push(m); e2.xz.push([x, z]);
    stats.models[piece] = (stats.models[piece] ?? 0) + 1;
    return true;
  };
  for (const md of D.models) {
    const m = new THREE.Matrix4().compose(p.set(md.x, md.y, md.z), q.setFromAxisAngle(UP, md.yaw), s.set(1, 1, 1));
    if (placeModel(md.piece, WASTE_MODELS[md.piece].key, m, md.x, md.z)) continue;
    stats.procedural[md.piece] = (stats.procedural[md.piece] ?? 0) + 1;
    standIn(md, add);
  }
  // --- ventilation fans: the lead's fan housing (back flange on the wall) + a rotor in its ring; else a procedural duct ring -----------
  for (const f of D.fans) {
    const yaw = Math.atan2(f.nx, f.nz);
    const housing = new THREE.Matrix4().compose(p.set(f.x - f.nx * FAN_HOUSING.back, f.y - FAN_HOUSING.ringY, f.z - f.nz * FAN_HOUSING.back), q.setFromAxisAngle(UP, yaw), s.set(1, 1, 1));
    const hasModel = placeModel('fanHousing', WASTE_MODELS.fanHousing.key, housing, f.x, f.z);
    const hubOff = hasModel ? -FAN_HOUSING.back + FAN_HOUSING.bladeZ : 0.45;
    const rotorR = hasModel ? FAN_HOUSING.bladeR * f.r / FAN_HOUSING.ringR : f.r * 0.94;
    const hub = new THREE.Vector3(f.x + f.nx * hubOff, f.y, f.z + f.nz * hubOff);
    add('blade', 'steelDark', new THREE.Matrix4().compose(hub, q.setFromAxisAngle(UP, yaw), s.set(rotorR, rotorR, rotorR)), f.x, f.z);
    if (!hasModel) {
      stats.procedural.fanHousing = (stats.procedural.fanHousing ?? 0) + 1;
      // the duct ring (an open tube along the normal) and its square back plate
      e.set(Math.PI / 2, 0, 0);
      const ring = new THREE.Matrix4().compose(new THREE.Vector3(f.x + f.nx * 0.4, f.y, f.z + f.nz * 0.4), new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(new THREE.Quaternion().setFromEuler(e)), s.set(2 * f.r, 0.75, 2 * f.r));
      add('tube', 'machine', ring, f.x, f.z);
      const w = f.r + 0.25, nxA = Math.abs(f.nx) > 0.5;
      add('box', 'steelDark', nxA ? boxM(f.x, f.y - w, f.z - w, f.x + f.nx * 0.08, f.y + w, f.z + w) : boxM(f.x - w, f.y - w, f.z, f.x + w, f.y + w, f.z + f.nz * 0.08), f.x, f.z);
    }
  }

  // --- build the instanced meshes ----------------------------------------------------------------------------------------------
  const geos = new Map<Geo, THREE.BufferGeometry>();
  const geoOf = (g: Geo): THREE.BufferGeometry => {
    let x = geos.get(g);
    if (!x) geos.set(g, (x = g === 'box' ? kitGeometry('box') : g === 'cyl' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false) : g === 'bulb' ? kitGeometry('bulb') : g === 'blade' ? kitGeometry('blade') : kitGeometry('tube')));
    return x;
  };
  const tag = (o: THREE.Object3D) => {
    o.userData.levels = [D.level];
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  };
  const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const color = new THREE.Color();
  for (const [key, b] of buckets) {
    const geo = geoOf(b.geo);
    const im = new THREE.InstancedMesh(geo, matOf(b.mat), b.list.length);
    im.name = `reactor-waste-${b.geo}-${b.mat}-${key.split('|')[2]}`;
    const colored = b.list.some(i => i.c !== undefined);
    b.list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (colored) im.setColorAt(i, color.setHex(it.c ?? 0xffffff)); });
    im.computeBoundingBox();
    im.computeBoundingSphere();
    tag(im);
    group.add(im);
    stats.meshes++; stats.instances += b.list.length; stats.triangles += tris(geo) * b.list.length;
  }
  // models: one InstancedMesh per (model mesh, chunk); Meshy materials kept as loaded
  for (const [piece, e2] of placed) {
    const root = e2.gltf.scene;
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const byChunk = new Map<string, number[]>();
    e2.xz.forEach(([x, z], i) => { const k = chunkOf(x, z); let l = byChunk.get(k); if (!l) byChunk.set(k, (l = [])); l.push(i); });
    for (const mesh of meshes) for (const [ck, idx] of byChunk) {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, idx.length);
      im.name = `reactor-waste-model-${piece}-${ck}`;
      const m = new THREE.Matrix4();
      idx.forEach((i, k) => im.setMatrixAt(k, m.multiplyMatrices(e2.list[i], mesh.matrixWorld)));
      im.computeBoundingBox();
      im.computeBoundingSphere();
      tag(im);
      group.add(im);
      stats.meshes++; stats.instances += idx.length; stats.triangles += tris(mesh.geometry) * idx.length;
    }
  }
  WASTE_VISUAL_STATS = stats;
  return stats;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Procedural stand-in of a model that is not loaded (same footprint; kit materials). */
function standIn(md: WasteModel, add: (geo: Geo, mat: WasteMat, m: THREE.Matrix4, x: number, z: number, c?: number) => void): void {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, md.yaw);
  const local = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
    const v = new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(md.x, md.y, md.z));
    return new THREE.Matrix4().compose(v, q, new THREE.Vector3(sx, sy, sz));
  };
  switch (md.piece) {
    case 'wasteDrum': {
      const r = Math.min(md.w, md.d) / 2;
      add('cyl', 'steel', local(0, md.h / 2, 0, 2 * r, md.h, 2 * r), md.x, md.z, 0xd8b040);
      for (const y of [md.h * 0.33, md.h * 0.66]) add('cyl', 'black', local(0, y, 0, 2 * r + 0.02, 0.03, 2 * r + 0.02), md.x, md.z);
      return;
    }
    case 'storageCask': {
      const r = Math.min(md.w, md.d) / 2;
      add('cyl', 'concrete', local(0, md.h / 2, 0, 2 * r, md.h, 2 * r), md.x, md.z);
      add('cyl', 'steelDark', local(0, md.h + 0.06, 0, 2 * r - 0.2, 0.12, 2 * r - 0.2), md.x, md.z);
      return;
    }
    case 'deconShower': {
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add('box', 'steel', local(a * (md.w / 2 - 0.04), md.h / 2, b * (md.d / 2 - 0.04), 0.06, md.h, 0.06), md.x, md.z);
      add('box', 'machine', local(0, md.h / 2, -md.d / 2 + 0.03, md.w, md.h, 0.05), md.x, md.z);
      add('box', 'steel', local(0, md.h - 0.04, 0, md.w, 0.08, md.d), md.x, md.z);
      add('box', 'concrete', local(0, 0.04, 0, md.w, 0.08, md.d), md.x, md.z);
      return;
    }
    case 'hotCellWindow': {
      add('box', 'concrete', local(0, md.h / 2, -md.d / 2 + 0.4, md.w, md.h, 0.8), md.x, md.z);
      add('box', 'black', local(0, md.h * 0.6, -md.d / 2 + 0.81, md.w * 0.45, md.h * 0.35, 0.02), md.x, md.z);
      add('box', 'steelDark', local(0, md.h * 0.3, 0, md.w * 0.7, 0.9, md.d * 0.4), md.x, md.z);
      return;
    }
    default:
      add('box', 'machine', local(0, md.h / 2, 0, md.w, md.h, md.d), md.x, md.z);
      add('box', 'black', local(0, md.h * 0.6, md.d / 2 + 0.005, md.w * 0.7, md.h * 0.3, 0.01), md.x, md.z);
  }
}
