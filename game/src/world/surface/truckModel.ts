// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): the truck's LOOK — the cooked model
// (assets/models/surface-military-truck.glb: nodes `body`, `glass`, `wheel-0` … `wheel-7`; nose -Z, grounded, centred; the model's own
// PBR maps) and its first-person interior, as the vehicle controller's view (world/skywaysCar.ts CarView):
//  - the body's material draws its outside (FrontSide, as cooked); a BackSide LINING twin of the body's triangles inside the cab volume and
//    under the canvas cover (the SAME vertex attributes, a sub-index; one shared dark material) draws the hollow shell's inside, so from
//    the seat / through the opened bed the shell reads as a dark trimmed inside (never the paint seen from behind, never see-through);
//  - the glass panes take the cab glass material path (world/elevator.ts cabGlassMaterial: the 'cab' reflection tag, a facing normal,
//    clear and lightly tinted, both sides in one pass);
//  - the eight road wheels are their own nodes (origin at the hub): they ROLL by the distance travelled and the first two axles STEER
//    (axle 2 at its share of the angle's tangent: TRUCK_WHEELS.steer);
//  - the cab: world/surface/truckCab.ts (handmade: floor, dash + gauges, a steering wheel on its pivot, seats, door cards, back panel,
//    roof liner; the bed's floor);
//  - the LAMPS: the body's own headlamp triangles drawn again as glowing lenses (world/skywaysCarLights.ts lampTriangles over the
//    truck's measured outlines; one shared lens material per loaded GLB) + the controller's beam.
// The model loads through this module's own cache behind the district's loading screen (the controller's section preload) and is
// released at the next build of a layout without the truck. Without it (Node tests, a failed fetch) a STAND-IN body (boxes, eight wheel
// cylinders on the same pivots, the same glass material) keeps the truck usable; a truck built before the model arrived is upgraded in
// place (truckModelsGen).

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../../assets/loader';
import {cabGlassMaterial} from '../elevator';
import type {CarSpec} from '../skywaysCarSpec';
import type {CarBody} from '../skywaysCarPhysics';
import type {CarView} from '../skywaysCarModel';
import {lampTriangles, lensMaterialFrom, type CarBeam} from '../skywaysCarLights';
import {buildTruckCab} from './truckCab';
import {TRUCK_LAMPS, TRUCK_WHEELS, TRUCK_WHEEL_RATIO} from './truckSpec';
import {TRUCK_ANCHORS} from './truckAnchors.generated';

/** The steering wheel follows the steering through a light ease (time constant, s), like the car's. */
export const TRUCK_WHEEL_EASE = 0.05;

/** The truck's view: the controller's CarView + its road wheels. */
export interface TruckView extends CarView {
  /** The road wheel pivots (index = TRUCK_WHEELS), their rolled angle (rad, about the axle) and the steer they show. */
  roadWheels: THREE.Object3D[];
  roll: number;
  /** The front wheel angle shown (rad; > 0 = left). */
  steer: number;
}

let cache: Promise<GLTF | null> | null = null;
let loaded: GLTF | null = null;
/** Bumped when the model arrives / is released (a view built from the stand-in rebuilds its look). */
export let truckModelsGen = 0;

export function truckModel(): GLTF | null {
  return loaded;
}

/** Fetches the truck once per session (browser only; never rejects: a failure keeps the stand-in). */
export function loadTruckModel(spec: CarSpec): Promise<GLTF | null> {
  if (typeof document === 'undefined') return Promise.resolve(loaded);
  if (cache) return cache;
  cache = new Promise<GLTF | null>(resolve => new GLTFLoader().load(assetUrl(spec.url), g => resolve(g), undefined, err => {
    console.warn(`surface truck: model ${spec.url} failed (stand-in kept)`, err);
    resolve(null);
  })).then(g => {
    loaded = g;
    truckModelsGen++;
    if (g) truckDerived(g); // (the lining and the lenses now, behind the loading screen)
    return g;
  });
  return cache;
}

/** The truck left the current world for good (a build without it): its GPU resources go, the next district fetches again. */
export function releaseTruckModel(): boolean {
  const g = loaded;
  cache = null;
  if (!g) return false;
  g.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
  dropDerived();
  loaded = null;
  truckModelsGen++;
  return true;
}

/** Tests: a model injected (or cleared) without a fetch. */
export function setTruckModelForTests(g: GLTF | null): void {
  dropDerived();
  loaded = g;
  truckModelsGen++;
}

// ---------------------------------------------------------------------------------------------------------------------
// Derived per loaded GLB (built once, shared by every view): the lining sub-geometry, the lamp lenses

export interface TruckDerived { lining: THREE.BufferGeometry | null; liningTris: number; lens: {geo: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; tris: number} | null }
let derived: {src: GLTF; v: TruckDerived} | null = null;

function dropDerived(): void {
  if (derived) { derived.v.lining?.dispose(); derived.v.lens?.geo.dispose(); derived.v.lens?.material.dispose(); }
  derived = null;
}

const xyzOf = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array => {
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) { out[3 * i] = a.getX(i); out[3 * i + 1] = a.getY(i); out[3 * i + 2] = a.getZ(i); }
  return out;
};

/** A geometry drawing `tris` of `src` over its OWN attributes (shared, not copied); its bounds from the referenced vertices only. */
function subGeometry(src: THREE.BufferGeometry, tris: Uint32Array, name: string): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.name = name;
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  const pos = src.getAttribute('position');
  g.setIndex(new THREE.BufferAttribute(pos.count <= 65535 ? Uint16Array.from(tris) : tris, 1));
  const box = new THREE.Box3(), p = new THREE.Vector3();
  for (let k = 0; k < tris.length; k++) box.expandByPoint(p.fromBufferAttribute(pos, tris[k]));
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return g;
}

/** The lining's region: the cab volume and the bed box, each grown by this much (m: the shell's inner faces lie on their walls). */
export const LINING_PAD = 0.15;
/** Sanity bounds of the lamp lenses (a re-cooked body that no longer matches the outlines shows no lenses rather than odd patches). */
export const TRUCK_LENS_SANITY = {minTris: 50, maxTris: 4000} as const;

/** Is a truck-frame point inside the lined regions (the cab volume / the bed, + LINING_PAD)? */
export function inLining(x: number, y: number, z: number): boolean {
  const I = TRUCK_ANCHORS.interior, B = TRUCK_ANCHORS.bed, p = LINING_PAD;
  const inBox = (b: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number}) => x > b.x0 - p && x < b.x1 + p && y > b.y0 - p && y < b.y1 + p && z > b.z0 - p && z < b.z1 + p;
  return inBox(I) || inBox(B);
}

/** The body mesh of a loaded GLB (node `body`). */
function bodyMesh(root: THREE.Object3D): THREE.Mesh | null {
  let out: THREE.Mesh | null = null;
  root.traverse(o => { if (!out && (o as THREE.Mesh).isMesh && /^body/.test(o.name) && !/glass/i.test(materialName(o as THREE.Mesh))) out = o as THREE.Mesh; });
  if (!out) root.traverse(o => { if (!out && (o as THREE.Mesh).isMesh && o.parent?.name === 'body') out = o as THREE.Mesh; });
  return out;
}
const materialName = (m: THREE.Mesh): string => (Array.isArray(m.material) ? m.material[0]?.name : m.material?.name) ?? '';

/** The lining + lenses of one loaded GLB (cached per GLB). */
export function truckDerived(g: GLTF): TruckDerived {
  if (derived?.src === g) return derived.v;
  dropDerived();
  const v: TruckDerived = {lining: null, liningTris: 0, lens: null};
  const body = bodyMesh(g.scene);
  if (body) {
    const geo = body.geometry, pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal'), idx = geo.index;
    if (pos && idx) {
      const P = xyzOf(pos), I = idx.array, keep: number[] = [];
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], b = I[t + 1], c = I[t + 2];
        if (inLining((P[3 * a] + P[3 * b] + P[3 * c]) / 3, (P[3 * a + 1] + P[3 * b + 1] + P[3 * c + 1]) / 3, (P[3 * a + 2] + P[3 * b + 2] + P[3 * c + 2]) / 3)) keep.push(a, b, c);
      }
      if (keep.length) { v.lining = subGeometry(geo, Uint32Array.from(keep), 'surface-truck-lining'); v.liningTris = keep.length / 3; }
      if (nrm && !Array.isArray(body.material)) {
        const tris = lampTriangles(P, xyzOf(nrm), I, TRUCK_LAMPS);
        const n = tris.length / 3;
        if (n >= TRUCK_LENS_SANITY.minTris && n <= TRUCK_LENS_SANITY.maxTris) {
          const material = lensMaterialFrom(body.material);
          material.name = 'surface-truck-lamp-lens';
          material.emissive.set(TRUCK_LAMPS.lens.color);
          v.lens = {geo: subGeometry(geo, tris, 'surface-truck-lamp-lens'), material, tris: n};
        }
      }
    }
  }
  derived = {src: g, v};
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared runtime materials (one instance each)

let shared: {lining: THREE.MeshStandardMaterial; standPaint: THREE.MeshStandardMaterial; standCanvas: THREE.MeshStandardMaterial; standTyre: THREE.MeshStandardMaterial; standLens: THREE.MeshStandardMaterial; box: THREE.BufferGeometry; tyre: THREE.BufferGeometry} | null = null;

export function truckMaterials(): NonNullable<typeof shared> {
  if (shared) return shared;
  const std = (name: string, color: number, o: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({color, roughness: 0.85, metalness: 0.05, ...o}); m.name = name; return m; };
  const tyre = new THREE.CylinderGeometry(1, 1, 1, 18, 1);
  tyre.rotateZ(Math.PI / 2); // (axis along x: the axle)
  shared = {
    lining: std('surface-truck-lining', 0x1b1d18, {side: THREE.BackSide, roughness: 0.92}),
    standPaint: std('surface-truck-stand-in-paint', 0x4a5140, {roughness: 0.7, metalness: 0.2}),
    standCanvas: std('surface-truck-stand-in-canvas', 0x4f533f, {roughness: 0.95}),
    standTyre: std('surface-truck-stand-in-tyre', 0x141414, {roughness: 0.9}),
    standLens: std('surface-truck-stand-in-lens', 0x2a2d31, {roughness: 0.2, metalness: 0.1, emissive: TRUCK_LAMPS.lens.color, emissiveIntensity: 0}),
    box: new THREE.BoxGeometry(1, 1, 1),
    tyre,
  };
  return shared;
}

// ---------------------------------------------------------------------------------------------------------------------
// One truck's view (truck frame)

const isGlass = (m: THREE.Mesh): boolean => {
  if (/glass/i.test(materialName(m))) return true;
  for (let o: THREE.Object3D | null = m; o; o = o.parent) if (/^glass/i.test(o.name)) return true;
  return false;
};

/** The cooked model: paint outside + the lining inside, the cab glass, the road wheels on their nodes, the lamp lenses. */
function modelBody(g: GLTF): {group: THREE.Group; lens: THREE.MeshStandardMaterial | null; wheels: THREE.Object3D[]} {
  const S = truckMaterials(), D = truckDerived(g), root = new THREE.Group();
  root.name = 'surface-truck-body';
  const scene = g.scene.clone(true);
  scene.name = 'surface-truck-model';
  const meshes: THREE.Mesh[] = [];
  scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const body = bodyMesh(scene);
  for (const m of meshes) {
    if (isGlass(m)) {
      m.material = cabGlassMaterial();
      m.castShadow = false;
      m.userData.carPart = 'glass';
      continue;
    }
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.side = THREE.FrontSide;
    m.userData.carPart = 'paint';
  }
  if (body && D.lining) {
    const lining = new THREE.Mesh(D.lining, S.lining);
    lining.name = 'surface-truck-lining';
    lining.userData.carPart = 'trim';
    lining.userData.noShadow = true;
    lining.castShadow = false;
    body.add(lining);
  }
  if (body && D.lens) {
    const lens = new THREE.Mesh(D.lens.geo, D.lens.material);
    lens.name = 'surface-truck-lamp-lens';
    lens.userData.carPart = 'lens';
    lens.userData.noShadow = true;
    lens.castShadow = false;
    body.add(lens);
  }
  const wheels = TRUCK_WHEELS.map((_, i) => scene.getObjectByName(`wheel-${i}`) ?? null);
  root.add(scene);
  if (wheels.some(w => !w)) console.warn('surface truck: a wheel node is missing (the wheels stay still)');
  return {group: root, lens: body && D.lens ? D.lens.material : null, wheels: wheels.every(w => w) ? (wheels as THREE.Object3D[]) : []};
}

/** No model (Node tests / a failed fetch): a plain truck-sized stand-in, its cab glazed (the same glass) and the eight wheels on pivots. */
function standInBody(spec: CarSpec): {group: THREE.Group; wheels: THREE.Object3D[]} {
  const S = truckMaterials(), A = TRUCK_ANCHORS, g = new THREE.Group();
  g.name = 'surface-truck-stand-in';
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, part: string) => {
    const b = new THREE.Mesh(S.box, m); b.scale.set(w, h, d); b.position.set(x, y, z); b.userData.carPart = part; g.add(b); return b;
  };
  const I = A.interior, B = A.bed, W = spec.width - 0.1;
  box(W, 0.5, spec.length - 0.2, 0, 1.0, 0, S.standPaint, 'paint'); // chassis / frame
  box(I.x1 - I.x0 + 0.08, A.cowl.y - 0.85, I.z1 - I.z0 + 0.1, (I.x0 + I.x1) / 2, (0.85 + A.cowl.y) / 2, (I.z0 + I.z1) / 2, S.standPaint, 'paint'); // cab below the glass
  box(I.x1 - I.x0 + 0.08, 0.08, I.z1 - I.z0 + 0.1, (I.x0 + I.x1) / 2, I.y1 + 0.04, (I.z0 + I.z1) / 2, S.standPaint, 'paint'); // cab roof
  box(B.x1 - B.x0 + 0.1, B.y1 - B.y0, B.z1 - B.z0, (B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2, S.standCanvas, 'paint'); // canvas
  const glass = new THREE.Mesh(S.box, cabGlassMaterial());
  glass.scale.set(I.x1 - I.x0 + 0.06, A.header.y - A.cowl.y, I.z1 - I.z0 + 0.06);
  glass.position.set((I.x0 + I.x1) / 2, (A.cowl.y + A.header.y) / 2, (I.z0 + I.z1) / 2);
  glass.userData.carPart = 'glass';
  glass.castShadow = false;
  g.add(glass);
  const wheels = TRUCK_WHEELS.map((w, i) => {
    const pivot = new THREE.Group();
    pivot.name = `wheel-${i}`;
    pivot.position.set(w.x, w.y, w.z);
    const t = new THREE.Mesh(S.tyre, S.standTyre);
    t.scale.set(0.36, w.r, w.r); // (the cylinder's axis is x after rotateZ: x = width, y / z = the radius)
    t.userData.carPart = 'tyre';
    pivot.add(t);
    g.add(pivot);
    return pivot;
  });
  for (const P of [TRUCK_LAMPS.left, TRUCK_LAMPS.right]) {
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    box(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.03, (Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, -spec.length / 2 - 0.005, S.standLens, 'lens').userData.noShadow = true;
  }
  return {group: g, wheels};
}

function bodyOf(spec: CarSpec): {group: THREE.Group; lens: THREE.MeshStandardMaterial | null; wheels: THREE.Object3D[]} {
  const g = loaded;
  if (g) return modelBody(g);
  const s = standInBody(spec);
  return {group: s.group, lens: truckMaterials().standLens, wheels: s.wheels};
}

/** A truck's view (truck frame) from the current model (else the stand-in) + the handmade cab. */
export function buildTruckView(spec: CarSpec): TruckView {
  const group = new THREE.Group();
  group.name = 'surface-truck';
  const {group: body, lens, wheels} = bodyOf(spec);
  group.add(body);
  const cab = buildTruckCab();
  group.add(cab.group);
  for (const w of wheels) w.rotation.order = 'YXZ';
  return {group, body, cockpit: cab.group, wheel: cab.wheel, wheelAngle: 0, lens, gen: truckModelsGen, standIn: !loaded, roadWheels: wheels, roll: 0, steer: 0};
}

/** Rebuild the body from the current model (it arrived after the view was built); the cab stays. */
export function refreshTruckView(v: CarView, spec: CarSpec): void {
  const t = v as TruckView;
  if (t.gen === truckModelsGen) return;
  t.gen = truckModelsGen;
  t.group.remove(t.body);
  const b = bodyOf(spec);
  t.body = b.group;
  t.lens = b.lens;
  t.roadWheels = b.wheels;
  for (const w of b.wheels) w.rotation.order = 'YXZ';
  t.standIn = !loaded;
  t.group.add(t.body);
  poseWheels(t);
}

/** The road wheels at the view's roll / steer (front axles: atan(share x tan(steer))). */
function poseWheels(v: TruckView): void {
  const ts = Math.tan(v.steer);
  for (let i = 0; i < v.roadWheels.length; i++) {
    const w = TRUCK_WHEELS[i], n = v.roadWheels[i];
    n.rotation.set(v.roll, w.steer ? Math.atan(w.steer * ts) : 0, 0, 'YXZ');
  }
}

/**
 * Per frame: the steering wheel (the front angle x TRUCK_WHEEL_RATIO, eased with dt) and the road wheels — rolled by the signed distance
 * along the heading (forward = toward -Z: about +X by -distance / r) and the steering axles turned (no allocation).
 */
export function syncTruckView(view: CarView, body: CarBody, dt: number | undefined, moved: number): void {
  const v = view as TruckView;
  const to = body.steer * TRUCK_WHEEL_RATIO;
  v.wheelAngle = dt !== undefined && dt > 0 ? v.wheelAngle + (to - v.wheelAngle) * (1 - Math.exp(-dt / TRUCK_WHEEL_EASE)) : to;
  if (v.wheel) v.wheel.rotation.z = v.wheelAngle;
  const r = TRUCK_WHEELS[0]?.r ?? 0.5;
  if (moved !== 0) v.roll = (v.roll - moved / r) % (Math.PI * 2);
  v.steer = body.steer;
  poseWheels(v);
}

/** The truck's beam (one per controller: a stable light for every visit's programs); off until switched on. */
export function createTruckBeam(): CarBeam {
  const B = TRUCK_LAMPS.beam;
  const light = new THREE.SpotLight(B.color, 0, B.distance, B.angle, B.penumbra, B.decay);
  light.name = 'surface-truck-beam';
  light.castShadow = false;
  light.position.set(B.at.x, B.at.y, B.at.z);
  const target = new THREE.Object3D();
  target.name = 'surface-truck-beam-target';
  target.position.set(B.aim.x, B.aim.y, B.aim.z);
  light.target = target;
  return {light, target};
}

/** On / off: the lens glow and the beam's intensity only (never a light added / removed, never a program change). */
export function setTruckLamps(on: boolean, lens: THREE.MeshStandardMaterial | null, beam: CarBeam | null): void {
  if (lens) lens.emissiveIntensity = on ? TRUCK_LAMPS.lens.on : 0;
  if (beam) beam.light.intensity = on ? TRUCK_LAMPS.beam.intensity : 0;
}
