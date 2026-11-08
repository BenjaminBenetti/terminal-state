// Task studio-market-bar-20261108-225231-01 (lane SHELVES; user: "Clothesline z-fighting / flat squares: hang existing actual clothing
// models instead."): THE MARKET'S HUNG LAUNDRY — real garment models on the lines across the lanes (gen/market/v2/art.ts settleLines,
// layout versions 2 and 3), never flat cloth squares.
//  - SOURCE: ordinary clothing the market's own people wear — the fitted wearables of market-human-cast.glb (market/humanWardrobe.ts:
//    'Wear_<w>__<b>', each fitted to one body; their Meshy maps), READ ONLY: the file's meshes, geometry and materials are never
//    modified (each type's geometry is a copy of its static attributes — no skin —, its material a DoubleSide clone sharing the maps).
//    Shirts / hoodies / sweaters / vests / blazers and trousers only: no coat (too long), no headwear, never the lingerie pool.
//  - HUNG: in the garment's own bind pose (the market bodies' relaxed A-pose: a shirt's sleeves hang out and down, as laundry does), its
//    width along the line, front to one side or the other: a top by the shoulders (the line runs through them, the collar just above),
//    trousers by the waistband; tilted with the line's sag; two wooden pegs where it is pinned. Each lies wholly over the open lane (its
//    footprint open from the lane floor to the shed roof: no catwalk, bridge or rooftop above / below it) and its lowest point stays
//    LAUNDRY.minY above the ground (over the catwalk walkers' heads).
//  - NO Z-FIGHTING: neighbours on a line never overlap (their extents along the line keep LAUNDRY.gap apart); real 3D garments, no planes.
//  - SEEDED: the station seed + the line's own seed pick the garments and the gaps (deterministic; no draw on any game / generator stream).
//  - BATCHED: one InstancedMesh per garment type (shared geometry, one shared material), the pegs one merged mesh: at most
//    LAUNDRY_GARMENTS.length + 1 draw calls for all the market's laundry; frustum culled per mesh like the rest of the market's visuals.
// Pure planning (planLaundry: no three.js meshes) + the build (buildLaundry): tests and the CPU QA use both.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {StationLayout} from '../gen/stationTypes';
import type {MarketLine} from '../gen/market/v2/art';
import {SETTLE} from '../gen/market/v2/frame';

/** The garments hung out to dry: a market cast wearable, the body it is fitted to, how it hangs. */
export const LAUNDRY_GARMENTS = [
  {id: 'flannel@m1', wearable: 'flannel', body: 'm1', hang: 'shoulders'},
  {id: 'hoodie@m1', wearable: 'hoodie', body: 'm1', hang: 'shoulders'},
  {id: 'sweater@f1', wearable: 'sweater', body: 'f1', hang: 'shoulders'},
  {id: 'hivis@m1', wearable: 'hivis', body: 'm1', hang: 'shoulders'},
  {id: 'blazer@f2', wearable: 'blazer', body: 'f2', hang: 'shoulders'},
  {id: 'cargo@m1', wearable: 'cargo', body: 'm1', hang: 'waist'},
  {id: 'jeans@f1', wearable: 'jeans', body: 'f1', hang: 'waist'},
  {id: 'slacks@m2', wearable: 'slacks', body: 'm2', hang: 'waist'},
] as const;
export type LaundryGarmentId = typeof LAUNDRY_GARMENTS[number]['id'];

export const LAUNDRY = {
  /** The line runs this far below a top's highest point (its collar stands above the line) / a waistband's top edge (m). */
  shoulderDrop: 0.07,
  waistDrop: 0.012,
  /** Lowest point of any garment above the lane floor: over the catwalk walkers' heads (gen/market/v2 lines test: bases[1] + 1.2). */
  minY: SETTLE.bases[1] + 1.2,
  /** Clear gap between neighbours along a line (m) and its random extra; the first garment's start from the line's end. */
  gap: 0.05,
  gapExtra: 0.14,
  start: [0.3, 0.55] as const,
  /** Share of a line's places left empty (a gap of a garment's width). */
  empty: 0.12,
  /** How much of the line's slope a hung garment's shoulders / waistband follow (the rest: it hangs plumb under its pegs). */
  follow: 0.6,
  /** The pegs (m): a top's pegs at +-shoulder from its middle, trousers' at the waistband's ends less `inset`. */
  peg: {w: 0.014, h: 0.075, d: 0.024, shoulder: 0.17, inset: 0.035},
  pegColor: 0xb89466,
} as const;

/** A garment type's measures in its own (bind pose) frame: width along the line (x), depth (z), the hang point, how far it hangs down. */
export interface GarmentDims {
  id: LaundryGarmentId;
  /** Its own frame's box (m). */
  min: [number, number, number];
  max: [number, number, number];
  /** The hang point (the line through it): x / z the box's middle, y the shoulders / the waistband. */
  hang: [number, number, number];
  /** Peg offsets along its width from the hang point (m). */
  pegs: number[];
}

/** One hung garment: its line, type, where along the line, its pose (the hang point's world position, yaw, the line's tilt), its pegs. */
export interface HungGarment {
  line: number;
  garment: LaundryGarmentId;
  /** Distance along the line's horizontal run from its (x0, z0) end to the garment's middle (m), and the line parameter there. */
  s: number;
  t: number;
  x: number; y: number; z: number;
  /** three.js rotation.y putting its width along the line (+ PI: its front to the other side), and its roll about its depth axis. */
  yaw: number;
  roll: number;
  /** World extents along the line (from the x0 end, m) and its lowest point (m). */
  s0: number; s1: number;
  bottom: number;
  pegs: {x: number; y: number; z: number}[];
}

const hash2 = (a: number, b: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return h >>> 0;
};
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The wearable mesh of a garment type in the cast file (null: not in it). */
export function garmentMesh(gltf: GLTF, g: (typeof LAUNDRY_GARMENTS)[number]): THREE.Mesh | null {
  const m = gltf.scene.getObjectByName(`Wear_${g.wearable}__${g.body}`) as THREE.Mesh | undefined;
  return m && m.isMesh && m.geometry?.attributes.position ? m : null;
}

/** A garment type's measures from its static (bind-pose, holder-frame) geometry. */
export function garmentDims(g: (typeof LAUNDRY_GARMENTS)[number], geo: THREE.BufferGeometry): GarmentDims {
  const b = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const y = g.hang === 'shoulders' ? b.max.y - LAUNDRY.shoulderDrop : b.max.y - LAUNDRY.waistDrop;
  const half = (b.max.x - b.min.x) / 2;
  const p = g.hang === 'shoulders' ? Math.min(LAUNDRY.peg.shoulder, half * 0.6) : half - LAUNDRY.peg.inset;
  return {id: g.id, min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z], hang: [cx, y, cz], pegs: [-p, p]};
}

/** Open from the lane floor to the shed roof at (x, z): a ground-storey lane cell, no catwalk / bridge / rooftop above it. */
export function laundryOpenAt(layout: StationLayout, x: number, z: number): boolean {
  const g0 = layout.grid, [cx, cy] = g0.cellOf(x, z);
  if (!g0.inBounds(cx, cy)) return false;
  const i = g0.idx(cx, cy);
  if (g0.cells[i] !== 1 || g0.ceil[i] < SETTLE.roofY - 0.05) return false;
  for (let L = 1; L < layout.levels.length; L++) if (layout.levels[L].grid.cells[i] !== 0) return false;
  return true;
}

/**
 * The laundry of a market's lines (only lines with `laundry`): seeded per line, garments one after another along it with clear gaps,
 * each fitting the line's open run, hanging no lower than LAUNDRY.minY; deterministic. `dims`: the garment types available (missing ones
 * are simply not hung).
 */
export function planLaundry(layout: StationLayout, lines: readonly MarketLine[], dims: readonly GarmentDims[]): HungGarment[] {
  const out: HungGarment[] = [];
  if (!dims.length) return out;
  lines.forEach((l, li) => {
    if (!l.laundry) return;
    const dx = l.x1 - l.x0, dz = l.z1 - l.z0, run = Math.hypot(dx, dz);
    if (run < 0.5) return;
    const ux = dx / run, uz = dz / run, nx = -uz, nz = ux;
    let h = hash2(layout.seed >>> 0, l.seed + 1013);
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 0x100000000);
    const lineY = (t: number) => l.y - l.sag * 4 * t * (1 - t);
    const slope = (t: number) => -l.sag * 4 * (1 - 2 * t) / run; // (dy / ds)
    let s = LAUNDRY.start[0] + (LAUNDRY.start[1] - LAUNDRY.start[0]) * rnd();
    for (let guard = 0; guard < 64 && s < run; guard++) {
      // a seeded order of the types: the first that fits here is hung
      const first = Math.floor(rnd() * dims.length);
      const skip = rnd() < LAUNDRY.empty;
      let placed: HungGarment | null = null, width = 0;
      const flip = rnd() < 0.5;
      for (let k = 0; k < dims.length && !placed; k++) {
        const d = dims[(first + k) % dims.length];
        const w = d.max[0] - d.min[0], depth = d.max[2] - d.min[2];
        width = w;
        // its outline in the line's vertical plane (along, up) about the hang point, mirrored when flipped, tilted by phi
        const f = flip ? -1 : 1;
        const xs = [d.min[0] - d.hang[0], d.max[0] - d.hang[0]].map(x => x * f), ys = [d.min[1] - d.hang[1], d.max[1] - d.hang[1]];
        const outline = (phi: number) => {
          const c = Math.cos(phi), n = Math.sin(phi);
          let a = Infinity, b = -Infinity, lo = Infinity, hi = -Infinity;
          for (const x of xs) for (const y of ys) { const al = x * c - y * n, up = x * n + y * c; a = Math.min(a, al); b = Math.max(b, al); lo = Math.min(lo, up); hi = Math.max(hi, up); }
          return {a, b, lo, hi};
        };
        // (placed so its outline starts at the cursor; the tilt read at its middle, twice to settle)
        let sc = s + w / 2, phi = 0, o = outline(0);
        for (let it = 0; it < 2; it++) { phi = LAUNDRY.follow * Math.atan(slope(sc / run)); o = outline(phi); sc = s - o.a; }
        const t = sc / run;
        if (sc + o.b > run - 0.3) continue;
        const y = lineY(t);
        if (y + o.lo < LAUNDRY.minY) continue; // (its lowest point over the catwalk walkers' heads)
        // its whole footprint over the open lane
        const cxw = l.x0 + ux * sc, czw = l.z0 + uz * sc;
        let open = true;
        for (const [a, b] of [[o.a, -1], [o.b, -1], [o.b, 1], [o.a, 1], [0, 0]]) {
          if (!laundryOpenAt(layout, cxw + ux * a + nx * b * depth / 2, czw + uz * a + nz * b * depth / 2)) { open = false; break; }
        }
        if (!open) continue;
        const yaw = Math.atan2(-uz, ux) + (flip ? Math.PI : 0);
        // (flipped, its own +x runs back along the line: the local roll turns the other way for the same tilt in the world)
        const roll = flip ? -phi : phi;
        const pegs = d.pegs.map(p => {
          const along = p * f * Math.cos(phi); // (the peg's distance along the line from the middle)
          return {x: r4(cxw + ux * along), y: r4(lineY((sc + along) / run)), z: r4(czw + uz * along)};
        });
        placed = {line: li, garment: d.id, s: r4(sc), t: r4(t), x: r4(cxw), y: r4(y), z: r4(czw), yaw: r4(yaw), roll: r4(roll), s0: r4(sc + o.a), s1: r4(sc + o.b), bottom: r4(y + o.lo), pegs};
      }
      if (placed && !skip) { out.push(placed); s = placed.s1 + LAUNDRY.gap + LAUNDRY.gapExtra * rnd(); }
      else s += Math.max(0.3, (placed ? width : 0.3)) + LAUNDRY.gap;
    }
  });
  return out;
}

/** A hung garment's instance matrix: its hang point to the world point, its width along the line, tilted with it. */
export function hungMatrix(g: HungGarment, d: GarmentDims, out = new THREE.Matrix4()): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, g.yaw, g.roll, 'YXZ'));
  out.compose(new THREE.Vector3(g.x, g.y, g.z), q, new THREE.Vector3(1, 1, 1));
  return out.multiply(new THREE.Matrix4().makeTranslation(-d.hang[0], -d.hang[1], -d.hang[2]));
}

/** The built laundry (meshes under `group`; what to dispose). */
export interface LaundryView {
  group: THREE.Group;
  plan: HungGarment[];
  dims: GarmentDims[];
  meshes: THREE.InstancedMesh[];
  pegs: THREE.Mesh | null;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

/**
 * A static float copy of a wearable's bind-pose geometry in its body holder's frame (position / normal / uv / index: no skin; dequantised
 * through the mesh's own node transform when the file stores it quantised). The file's arrays / objects are only read.
 */
export function staticGarment(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  // (the mesh's own node transform within its body holder 'Human_<b>', read from its pose: nothing in the file is written)
  const M = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale);
  const N = new THREE.Matrix3().getNormalMatrix(M);
  const g = new THREE.BufferGeometry(), v = new THREE.Vector3();
  const pos = src.getAttribute('position') as THREE.BufferAttribute, n = pos.count;
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  const nor = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nor) {
    const A = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(nor, i).applyMatrix3(N).normalize(); A[i * 3] = v.x; A[i * 3 + 1] = v.y; A[i * 3 + 2] = v.z; }
    g.setAttribute('normal', new THREE.BufferAttribute(A, 3));
  }
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) {
    const A = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { A[i * 2] = uv.getX(i); A[i * 2 + 1] = uv.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(A, 2));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  if (!nor) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Builds the laundry of `lines` from the cast's garments (null: no cast loaded / no laundry line / nothing fits). */
export function buildLaundry(layout: StationLayout, lines: readonly MarketLine[], gltf: GLTF | null | undefined): LaundryView | null {
  if (!gltf || !lines.some(l => l.laundry)) return null;
  const types: {g: (typeof LAUNDRY_GARMENTS)[number]; mesh: THREE.Mesh; geo: THREE.BufferGeometry; dims: GarmentDims}[] = [];
  for (const g of LAUNDRY_GARMENTS) {
    const mesh = garmentMesh(gltf, g);
    if (!mesh) continue;
    const geo = staticGarment(mesh);
    types.push({g, mesh, geo, dims: garmentDims(g, geo)});
  }
  const dims = types.map(t => t.dims);
  const plan = planLaundry(layout, lines, dims);
  if (!plan.length) { for (const t of types) t.geo.dispose(); return null; }
  const group = new THREE.Group();
  group.name = 'market-laundry';
  const view: LaundryView = {group, plan, dims, meshes: [], pegs: null, geometries: [], materials: []};
  const m = new THREE.Matrix4();
  for (const t of types) {
    const mine = plan.filter(p => p.garment === t.g.id);
    if (!mine.length) { t.geo.dispose(); continue; }
    const geo = t.geo;
    const src = (Array.isArray(t.mesh.material) ? t.mesh.material[0] : t.mesh.material) as THREE.Material;
    const mat = src.clone(); // (the same maps; two-sided: a hung garment shows its inside from below)
    mat.side = THREE.DoubleSide;
    mat.name = `market-laundry-${t.g.wearable}`;
    const im = new THREE.InstancedMesh(geo, mat, mine.length);
    im.name = `market-laundry-${t.g.id}`;
    im.userData = {laundry: t.g.id, level: 0};
    mine.forEach((p, i) => im.setMatrixAt(i, hungMatrix(p, t.dims, m)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingBox();
    im.computeBoundingSphere();
    im.castShadow = false;
    im.receiveShadow = false;
    group.add(im);
    view.meshes.push(im);
    view.geometries.push(geo);
    view.materials.push(mat);
  }
  // the pegs: small wooden clips across the line where each garment is pinned (flat runtime colour), one merged mesh
  const P = LAUNDRY.peg, parts: THREE.BufferGeometry[] = [];
  for (const p of plan) {
    const line = lines[p.line], yaw = Math.atan2(-(line.z1 - line.z0), line.x1 - line.x0);
    for (const q of p.pegs) {
      const b = new THREE.BoxGeometry(P.w, P.h, P.d);
      b.translate(0, -P.h * 0.3, 0); // (it grips the line near its top)
      b.rotateY(yaw);
      b.translate(q.x, q.y, q.z);
      parts.push(b.toNonIndexed());
      b.dispose();
    }
  }
  if (parts.length) {
    const pg = mergeGeometries(parts);
    for (const g of parts) g.dispose();
    const pm = new THREE.MeshStandardMaterial({color: LAUNDRY.pegColor, roughness: 0.85, metalness: 0});
    pm.name = 'market-laundry-pegs';
    const pegs = new THREE.Mesh(pg, pm);
    pegs.name = 'market-laundry-pegs';
    pegs.userData = {level: 0};
    pegs.castShadow = false;
    group.add(pegs);
    view.pegs = pegs;
    view.geometries.push(pg);
    view.materials.push(pm);
  }
  return view;
}
