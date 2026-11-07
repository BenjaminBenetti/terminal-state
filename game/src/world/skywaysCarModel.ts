// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's LOOK — the approved runtime model (lane ASSET-B's
// assets/models/skyways-prize-car.glb: nodes `body` + `glass`, nose -Z, grounded, centred; the pristine paint and its Meshy maps kept
// as they are) and a first-person interior built WITHOUT new art or bytes:
//  - the body's own material draws its outside (FrontSide); a BackSide twin of every body mesh (the SAME geometry, one shared dark trim
//    material) draws the shell's inside, so from the driver's seat the cabin is a dark trimmed shell (no paint seen from inside);
//  - the glass (material `glass`, alpha-blended) is drawn from both sides in ONE pass (forceSinglePass: no hidden FrontSide / BackSide
//    variant for the warm-up to miss), so the windscreen and side windows tint the view out;
//  - the cockpit (lane CAR2): lane ASSET-D's Meshy dash + two Meshy seats (their own maps kept) placed by world/skywaysCarCockpit.ts
//    cockpitLayout, with its plain dark fillers (firewall, dash-end shelves, console tunnel, seat risers); only if either part fails to
//    load, the PROCEDURAL fallback — untextured dark shapes (dash, a steering wheel that turns with the front wheels, two seats, console).
// Models load through this module's own cache (loadSkywaysCarModel: the same GLTFLoader the prop library uses) behind the Skyways
// loading screen (the runtime's section preload) and are released at the next build of a layout without the car (a Skyways-only
// asset: assets/levelAssets.ts 'skyways'). Without the model (Node tests, a failed fetch) a simple STAND-IN body (named
// 'skyways-car-stand-in', a console warning) keeps the car drivable; a car built before the model arrived is upgraded in place.

//
// Task skyways-vehicle-20261107 (lane VIS): the Meshy dash's steering wheel TURNS — the baked wheel is separated from the dash at load
// (world/skywaysCarWheel.ts splitWheel: a triangle partition, two geometries over the SAME vertex attributes, one split per loaded GLB
// shared by every view) and mounted on a pivot turning about its measured axis (WHEEL_RIM), in the dash's own material; the LAMPS
// (world/skywaysCarLights.ts): the body's own lamp triangles drawn again as glowing lenses (one shared material per loaded GLB), plain
// lens boxes on the stand-in.

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import type {CarSpec} from './skywaysCarSpec';
import {COCKPIT_URLS, FILL_COLOR, cockpitLayout, fillMesh} from './skywaysCarCockpit';
import {WHEEL_RIM, ringNormal, splitWheel, type WheelSplit} from './skywaysCarWheel';
import {CAR_LAMPS, lampTriangles, lensMaterialFrom} from './skywaysCarLights';

/** Steering-wheel turns per front-wheel radian (a quick rack: full lock 0.55 rad ~ 140°). */
export const WHEEL_RATIO = 4.4;
/** (lane VIS) The wheel follows the steering through a light exponential ease (time constant, s: a ~0.04 s lag, never steppy). */
export const WHEEL_EASE = 0.04;

export interface CarModels { car: GLTF | null; dash: GLTF | null; seat: GLTF | null }
const NO_MODELS: CarModels = {car: null, dash: null, seat: null};

let cache: Promise<CarModels> | null = null;
let cacheUrls = '';
let loaded: CarModels = NO_MODELS;
/** Bumped when models arrive / are released (a view built from the stand-in rebuilds its look). */
export let carModelsGen = 0;

export function skywaysCarModels(): CarModels {
  return loaded;
}

/** Fetches the car + the cockpit parts once per session (browser only; never rejects: a failure keeps the stand-in / fallback). */
export function loadSkywaysCarModel(spec: CarSpec): Promise<CarModels> {
  if (typeof document === 'undefined') return Promise.resolve(loaded);
  const key = `${spec.url}|${COCKPIT_URLS.dash}|${COCKPIT_URLS.seat}`;
  if (cache && cacheUrls === key) return cache;
  cacheUrls = key;
  cache = (async () => {
    const one = (url: string): Promise<GLTF | null> => new Promise(resolve => new GLTFLoader().load(assetUrl(url), g => resolve(g), undefined, err => {
      console.warn(`skyways car: model ${url} failed (stand-in kept)`, err);
      resolve(null);
    }));
    const [car, dash, seat] = await Promise.all([one(spec.url), one(COCKPIT_URLS.dash), one(COCKPIT_URLS.seat)]);
    loaded = {car, dash, seat};
    carModelsGen++;
    // (lane VIS) the wheel split and the lamp lenses now, behind the loading screen (cached: the views only look them up)
    if (dash) dashWheel(dash);
    if (car) carLens(car);
    return loaded;
  })();
  return cache;
}

/** The car left the current world for good (a build without it): its GPU resources go, the next Skyways fetches again. */
export function releaseSkywaysCarModel(): boolean {
  if (!loaded.car && !loaded.dash && !loaded.seat) return false;
  for (const g of [loaded.car, loaded.dash, loaded.seat]) g?.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
  dropDerived();
  loaded = NO_MODELS;
  cache = null;
  cacheUrls = '';
  carModelsGen++;
  return true;
}

/** Tests: models injected (or cleared) without a fetch. */
export function setSkywaysCarModelsForTests(m: CarModels): void {
  dropDerived();
  loaded = m;
  carModelsGen++;
}

// ---------------------------------------------------------------------------------------------------------------------
// (lane VIS) Derived per loaded GLB: the dash's wheel split, the body's lamp lenses (built once, shared by every view)

/** The meshes under a root in traversal order (a clone lists its meshes in the source's order). */
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

/** An attribute's xyz as a plain array (interleaved or not). */
function xyzOf(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) { out[3 * i] = a.getX(i); out[3 * i + 1] = a.getY(i); out[3 * i + 2] = a.getZ(i); }
  return out;
}

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

/** The dash's wheel split for one loaded dash GLB: which mesh (traversal index), the two geometries, the partition's counts. */
export interface DashWheel { mesh: number; dash: THREE.BufferGeometry; wheel: THREE.BufferGeometry; stats: WheelSplit['stats'] }
/** The body's lamp lenses for one loaded car GLB: the body mesh (traversal index), the lens geometry and its ONE shared material. */
export interface CarLens { mesh: number; geo: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; tris: number }

let wheelCache: {src: GLTF; v: DashWheel | null} | null = null;
let lensCache: {src: GLTF; v: CarLens | null} | null = null;

function dropWheel(): void {
  if (wheelCache?.v) { wheelCache.v.dash.dispose(); wheelCache.v.wheel.dispose(); }
  wheelCache = null;
}
function dropLens(): void {
  if (lensCache?.v) { lensCache.v.geo.dispose(); lensCache.v.material.dispose(); } // (the lens shares the body's textures: they go with the GLB)
  lensCache = null;
}
function dropDerived(): void {
  dropWheel();
  dropLens();
}

/** Sanity bounds of a wheel split (a re-cooked dash that no longer matches WHEEL_RIM keeps its wheel still rather than tearing). */
export const WHEEL_SPLIT_SANITY = {minTris: 1000, maxShare: 0.35} as const;

/**
 * The dash GLB's steering wheel separated (cached per GLB; null: no plausible wheel at WHEEL_RIM — the dash stays whole and still, a
 * console warning).
 */
export function dashWheel(g: GLTF): DashWheel | null {
  if (wheelCache?.src === g) return wheelCache.v;
  dropWheel();
  let v: DashWheel | null = null;
  const meshes = meshesOf(g.scene);
  for (let i = 0; i < meshes.length && !v; i++) {
    const geo = meshes[i].geometry, pos = geo.getAttribute('position');
    if (!pos) continue;
    const split = splitWheel(xyzOf(pos), geo.index ? geo.index.array : null, WHEEL_RIM);
    const s = split.stats;
    if (s.wheel < WHEEL_SPLIT_SANITY.minTris || s.wheel > s.tris * WHEEL_SPLIT_SANITY.maxShare) continue;
    v = {mesh: i, dash: subGeometry(geo, split.dash, 'skyways-car-dash-body'), wheel: subGeometry(geo, split.wheel, 'skyways-car-dash-wheel'), stats: s};
  }
  if (!v && typeof document !== 'undefined') console.warn('skyways car: no steering wheel found in the dash model (kept still)');
  wheelCache = {src: g, v};
  return v;
}

/** Sanity bounds of the lamp lenses (a re-cooked body that no longer matches CAR_LAMPS shows no lenses rather than odd patches). */
export const LENS_SANITY = {minTris: 100, maxTris: 4000} as const;

/** The car GLB's lamp lenses (cached per GLB; null: none found — the beam still works). */
export function carLens(g: GLTF): CarLens | null {
  if (lensCache?.src === g) return lensCache.v;
  dropLens();
  let v: CarLens | null = null;
  const meshes = meshesOf(g.scene);
  for (let i = 0; i < meshes.length && !v; i++) {
    const m = meshes[i], geo = m.geometry, pos = geo.getAttribute('position'), nrm = geo.getAttribute('normal');
    if (!pos || !nrm || isGlass(m) || Array.isArray(m.material)) continue;
    const tris = lampTriangles(xyzOf(pos), xyzOf(nrm), geo.index ? geo.index.array : null);
    const n = tris.length / 3;
    if (n < LENS_SANITY.minTris || n > LENS_SANITY.maxTris) continue;
    v = {mesh: i, geo: subGeometry(geo, tris, 'skyways-car-lamp-lens'), material: lensMaterialFrom(m.material), tris: n};
  }
  lensCache = {src: g, v};
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared runtime materials / geometry (one instance each: one program, one shadow program per material)

let shared: {
  trim: THREE.MeshStandardMaterial; dash: THREE.MeshStandardMaterial; seat: THREE.MeshStandardMaterial; wheel: THREE.MeshStandardMaterial; fill: THREE.MeshStandardMaterial;
  standPaint: THREE.MeshStandardMaterial; standGlass: THREE.MeshStandardMaterial; standTyre: THREE.MeshStandardMaterial; standLens: THREE.MeshStandardMaterial;
  box: THREE.BufferGeometry; ring: THREE.BufferGeometry; cyl: THREE.BufferGeometry;
} | null = null;

export function carMaterials(): NonNullable<typeof shared> {
  if (shared) return shared;
  const std = (name: string, color: number, o: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({color, roughness: 0.85, metalness: 0.05, ...o}); m.name = name; return m; };
  const trim = std('skyways-car-trim', 0x141518, {side: THREE.BackSide, roughness: 0.9});
  const standGlass = std('skyways-car-stand-in-glass', 0x1c2328, {transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false});
  standGlass.forceSinglePass = true;
  shared = {
    trim,
    dash: std('skyways-car-dash', 0x1b1c1f),
    seat: std('skyways-car-seat', 0x2a2522, {roughness: 0.95}),
    wheel: std('skyways-car-wheel', 0x101012, {roughness: 0.6}),
    fill: std('skyways-car-cockpit-fill', FILL_COLOR, {roughness: 0.9}),
    standPaint: std('skyways-car-stand-in-paint', 0x8c1a16, {roughness: 0.35, metalness: 0.4}),
    standGlass,
    standTyre: std('skyways-car-stand-in-tyre', 0x121212, {roughness: 0.9}),
    // (lane VIS) the stand-in's lamp lenses: dark glass until switched on (emissiveIntensity only)
    standLens: std('skyways-car-stand-in-lens', 0x2a2d31, {roughness: 0.2, metalness: 0.1, emissive: CAR_LAMPS.lens.color, emissiveIntensity: 0}),
    box: new THREE.BoxGeometry(1, 1, 1),
    ring: new THREE.TorusGeometry(1, 0.1, 8, 28),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
  };
  return shared;
}

// ---------------------------------------------------------------------------------------------------------------------
// One car's view (car frame: see skywaysCarSpec.ts)

export interface CarView {
  group: THREE.Group;
  /** The exterior (model or stand-in) incl. the BackSide trim twins and the glass. */
  body: THREE.Group;
  /** The cockpit (model or procedural). */
  cockpit: THREE.Group;
  /**
   * The steering wheel's spin pivot (rotation.z = the wheel turn about its axis toward the driver): the procedural wheel's, or (lane VIS)
   * the Meshy dash's separated wheel; null only when the dash model has no plausible wheel (it stays still).
   */
  wheel: THREE.Object3D | null;
  /** (lane VIS) The wheel's shown angle (rad, eased toward steer x WHEEL_RATIO). */
  wheelAngle: number;
  /** (lane VIS) The lamp lenses' ONE material (the model's shared lens material / the stand-in's), null: no lenses on this body. */
  lens: THREE.MeshStandardMaterial | null;
  /** carModelsGen the body was built with; stand-in = no car model was available. */
  gen: number;
  standIn: boolean;
}

const isGlass = (m: THREE.Mesh): boolean => {
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  if (mats.some(x => /glass/i.test(x?.name ?? ''))) return true;
  for (let o: THREE.Object3D | null = m; o; o = o.parent) if (/^glass/i.test(o.name)) return true;
  return false;
};

/** The approved model: paint outside, the BackSide trim twin inside, the glass both sides in one pass; (lane VIS) the lamp lenses. */
function modelBody(g: GLTF): {group: THREE.Group; lens: THREE.MeshStandardMaterial | null} {
  const S = carMaterials(), root = new THREE.Group();
  root.name = 'skyways-car-body';
  const scene = g.scene.clone(true);
  scene.name = 'skyways-car-model';
  const meshes = meshesOf(scene);
  // (lane VIS) the lenses: the body's own lamp triangles over its paint (shared geometry + material, a child of that body mesh)
  const L = carLens(g), host = L ? meshes[L.mesh] : undefined;
  if (L && host) {
    const lens = new THREE.Mesh(L.geo, L.material);
    lens.name = 'skyways-car-lamp-lens';
    lens.userData.carPart = 'lens';
    lens.userData.noShadow = true;
    lens.castShadow = false;
    host.add(lens);
  }
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (isGlass(m)) {
      for (const mat of mats) { mat.side = THREE.DoubleSide; mat.forceSinglePass = true; mat.depthWrite = false; mat.transparent = true; }
      m.castShadow = false;
      m.userData.carPart = 'glass';
      continue;
    }
    for (const mat of mats) mat.side = THREE.FrontSide; // (the GLB's double-sided paint: the inside is the trim twin's)
    m.userData.carPart = 'paint';
    const twin = new THREE.Mesh(m.geometry, S.trim);
    twin.name = `${m.name || 'body'}-interior-trim`;
    twin.userData.carPart = 'trim';
    twin.userData.noShadow = true;
    m.add(twin);
  }
  root.add(scene);
  return {group: root, lens: L && host ? L.material : null};
}

/** No model (Node tests / a failed fetch): a plain coupe-sized stand-in, its cabin glazed so the view out still works; two lens boxes. */
function standInBody(spec: CarSpec): THREE.Group {
  const S = carMaterials(), g = new THREE.Group();
  g.name = 'skyways-car-stand-in';
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, part: string) => {
    const b = new THREE.Mesh(S.box, m); b.scale.set(w, h, d); b.position.set(x, y, z); b.userData.carPart = part; g.add(b); return b;
  };
  const W = spec.width - 0.1, L = spec.length, belt = Math.min(0.95, spec.height * 0.72);
  const lower = box(W, belt - 0.22, L, 0, (belt + 0.22) / 2, 0, S.standPaint, 'paint');
  const inner = new THREE.Mesh(S.box, S.trim); inner.userData.carPart = 'trim'; inner.userData.noShadow = true; lower.add(inner);
  box(W - 0.16, spec.height - belt, L * 0.46, 0, (spec.height + belt) / 2, spec.eye.z - 0.1, S.standGlass, 'glass');
  for (const w of spec.wheels) {
    const t = new THREE.Mesh(S.cyl, S.standTyre);
    t.scale.set(w.r, 0.22, w.r); t.rotation.z = Math.PI / 2; t.position.set(w.x, w.y, w.z); t.userData.carPart = 'tyre'; g.add(t);
  }
  const Lp = CAR_LAMPS.projector;
  for (const sx of [-1, 1]) box(0.3, 0.07, 0.03, sx * Lp.x, Lp.y, -L / 2 - 0.005, S.standLens, 'lens').userData.noShadow = true;
  return g;
}

/** The procedural cockpit (car frame): dash, steering wheel on its pivot, two seats, the centre console. */
function proceduralCockpit(spec: CarSpec): {group: THREE.Group; wheel: THREE.Object3D} {
  const S = carMaterials(), g = new THREE.Group();
  g.name = 'skyways-car-cockpit';
  const I = spec.interior, E = spec.eye, Wc = spec.wheelCentre;
  const wy = Math.min(Wc.y, E.y - 0.27); // (the wheel's rim stays under the eye line: the view ahead is over it)
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = g) => {
    const b = new THREE.Mesh(S.box, m); b.scale.set(w, h, d); b.position.set(x, y, z); parent.add(b); return b;
  };
  // the dash: across the cabin in front of the wheel, its top a little above the wheel's centre
  const dashTop = wy + 0.08, dashFront = Math.max(I.z0, Wc.z - 0.6), dashBack = Wc.z - 0.12;
  box(I.x1 - I.x0 - 0.04, 0.24, dashBack - dashFront, (I.x0 + I.x1) / 2, dashTop - 0.12, (dashFront + dashBack) / 2, S.dash).name = 'skyways-car-dash';
  // the steering wheel: tilted toward the driver; the spin pivot turns with the front wheels (a spoke shows the turn)
  const tilt = new THREE.Group();
  tilt.name = 'skyways-car-steering';
  tilt.position.set(Wc.x, wy, Wc.z);
  tilt.rotation.x = -0.35;
  g.add(tilt);
  const spin = new THREE.Group();
  spin.name = 'skyways-car-steering-spin';
  tilt.add(spin);
  const ring = new THREE.Mesh(S.ring, S.wheel);
  ring.scale.setScalar(0.18);
  spin.add(ring);
  box(0.34, 0.035, 0.03, 0, 0, 0, S.wheel, spin);
  const hub = new THREE.Mesh(S.cyl, S.wheel);
  hub.scale.set(0.055, 0.06, 0.055); hub.rotation.x = Math.PI / 2; spin.add(hub);
  // the column into the dash
  const col = new THREE.Mesh(S.cyl, S.dash);
  col.scale.set(0.035, 0.32, 0.035); col.rotation.x = Math.PI / 2; col.position.set(0, 0, -0.17); tilt.add(col);
  // two seats under the eyes (cushion + a reclined back behind the head) and the console between them
  const cushionTop = Math.max(I.y0 + 0.14, E.y - 0.66);
  for (const sx of [E.x, -E.x]) {
    box(0.5, 0.14, 0.52, sx, cushionTop - 0.07, E.z + 0.12, S.seat).name = 'skyways-car-seat';
    const back = box(0.5, 0.66, 0.12, sx, cushionTop + 0.33, E.z + 0.44, S.seat);
    back.rotation.x = 0.2;
  }
  box(0.2, Math.max(0.1, cushionTop - I.y0 + 0.04), 0.95, (I.x0 + I.x1) / 2, (I.y0 + cushionTop + 0.04) / 2, E.z - 0.2, S.dash).name = 'skyways-car-console';
  return {group: g, wheel: spin};
}

let fillCache: {spec: CarSpec; geo: THREE.BufferGeometry} | null = null;
/** The fillers' geometry for a spec (cached: one car at a time; a few hundred triangles). */
function fillGeometry(spec: CarSpec): THREE.BufferGeometry {
  if (fillCache?.spec === spec) return fillCache.geo;
  const m = fillMesh(cockpitLayout(spec)), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.N, 3));
  geo.setIndex(new THREE.BufferAttribute(m.I, 1));
  geo.computeBoundingSphere();
  fillCache = {spec, geo};
  return geo;
}

/**
 * The Meshy cockpit (car frame, world/skywaysCarCockpit.ts cockpitLayout): the dash (its wheel rim on the eye's x), the two seats turned to
 * face it, and the plain dark fillers. The parts keep their own materials (Meshy maps); nothing here casts a shadow.
 */
function modelCockpit(spec: CarSpec, dash: GLTF, seat: GLTF): {group: THREE.Group; wheel: THREE.Object3D | null} {
  const S = carMaterials(), lay = cockpitLayout(spec), g = new THREE.Group();
  g.name = 'skyways-car-cockpit-model';
  const part = (m: GLTF, pose: {x: number; y: number; z: number; rotY: number; scale: number}, name: string) => {
    const s = m.scene.clone(true);
    s.name = name;
    s.position.set(pose.x, pose.y, pose.z);
    s.rotation.set(0, pose.rotY, 0);
    s.scale.setScalar(pose.scale);
    s.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.carPart = 'cockpit'; });
    g.add(s);
    return s;
  };
  const wheel = mountWheel(dash, part(dash, lay.dash, 'skyways-car-dash-model'));
  lay.seats.forEach((p, i) => part(seat, p, i ? 'skyways-car-seat-right' : 'skyways-car-seat-left'));
  // the fillers: one mesh (firewall + shelves + tunnel + risers), built once per layout and shared by every view
  const fill = new THREE.Mesh(fillGeometry(spec), S.fill);
  fill.name = 'skyways-car-cockpit-fill';
  fill.userData.carPart = 'cockpit';
  g.add(fill);
  return {group: g, wheel};
}

const AXIS_Z = new THREE.Vector3(0, 0, 1);

/**
 * (lane VIS) The dash clone's baked wheel made to turn: its mesh draws the split dash, and the separated wheel (the same material: the
 * Meshy maps, one program) hangs under pivot (at WHEEL_RIM's centre, local +Z = the axis toward the driver) -> spin (rotation.z = the
 * turn) -> the wheel mesh (the inverse of the pivot's frame: at turn 0 exactly where it was baked). Returns the spin (null: no wheel).
 */
function mountWheel(src: GLTF, dashRoot: THREE.Object3D): THREE.Object3D | null {
  const sp = dashWheel(src), mesh = sp ? meshesOf(dashRoot)[sp.mesh] : undefined;
  if (!sp || !mesh) return null;
  mesh.geometry = sp.dash;
  const R = WHEEL_RIM, [nx, ny, nz] = ringNormal(R);
  const pivot = new THREE.Group();
  pivot.name = 'skyways-car-wheel-pivot';
  pivot.position.set(R.x, R.y, R.z);
  pivot.quaternion.setFromUnitVectors(AXIS_Z, new THREE.Vector3(nx, ny, nz));
  const spin = new THREE.Group();
  spin.name = 'skyways-car-wheel-spin';
  const w = new THREE.Mesh(sp.wheel, mesh.material);
  w.name = 'skyways-car-wheel';
  w.userData.carPart = 'cockpit';
  w.quaternion.copy(pivot.quaternion).invert();
  w.position.set(-R.x, -R.y, -R.z).applyQuaternion(w.quaternion);
  mesh.add(pivot);
  pivot.add(spin);
  spin.add(w);
  return spin;
}

/** The body (model or stand-in) and its lens material. */
function bodyOf(spec: CarSpec, m: CarModels): {group: THREE.Group; lens: THREE.MeshStandardMaterial | null} {
  return m.car ? modelBody(m.car) : {group: standInBody(spec), lens: carMaterials().standLens};
}

/** A car's view (car frame) from the current models (else the stand-in / procedural cockpit). */
export function buildCarView(spec: CarSpec): CarView {
  const m = skywaysCarModels();
  const group = new THREE.Group();
  group.name = 'skyways-car';
  const {group: body, lens} = bodyOf(spec, m);
  group.add(body);
  const {group: cockpit, wheel} = m.dash && m.seat ? modelCockpit(spec, m.dash, m.seat) : proceduralCockpit(spec);
  group.add(cockpit);
  return {group, body, cockpit, wheel, wheelAngle: 0, lens, gen: carModelsGen, standIn: !m.car};
}

/** Rebuild the body / cockpit from the current models (they arrived after the view was built). */
export function refreshCarView(v: CarView, spec: CarSpec): void {
  if (v.gen === carModelsGen) return;
  v.gen = carModelsGen;
  const m = skywaysCarModels();
  v.group.remove(v.body, v.cockpit);
  ({group: v.body, lens: v.lens} = bodyOf(spec, m));
  v.standIn = !m.car;
  ({group: v.cockpit, wheel: v.wheel} = m.dash && m.seat ? modelCockpit(spec, m.dash, m.seat) : proceduralCockpit(spec));
  if (v.wheel) v.wheel.rotation.z = v.wheelAngle;
  v.group.add(v.body, v.cockpit);
}

/**
 * The steering wheel shows the front-wheel angle x WHEEL_RATIO (no allocation): with dt, through the light WHEEL_EASE ease (the physics
 * already eases the steering itself); without, at once.
 */
export function setWheel(v: CarView, steer: number, dt?: number): void {
  const to = steer * WHEEL_RATIO;
  v.wheelAngle = dt !== undefined && dt > 0 ? v.wheelAngle + (to - v.wheelAngle) * (1 - Math.exp(-dt / WHEEL_EASE)) : to;
  if (v.wheel) v.wheel.rotation.z = v.wheelAngle;
}
