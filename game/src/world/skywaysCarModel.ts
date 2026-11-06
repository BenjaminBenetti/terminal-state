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

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import type {CarSpec} from './skywaysCarSpec';
import {COCKPIT_URLS, FILL_COLOR, cockpitLayout} from './skywaysCarCockpit';

/** Steering-wheel turns per front-wheel radian (a quick rack: full lock 0.55 rad ~ 140°). */
export const WHEEL_RATIO = 4.4;

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
  loaded = NO_MODELS;
  cache = null;
  cacheUrls = '';
  carModelsGen++;
  return true;
}

/** Tests: models injected (or cleared) without a fetch. */
export function setSkywaysCarModelsForTests(m: CarModels): void {
  loaded = m;
  carModelsGen++;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared runtime materials / geometry (one instance each: one program, one shadow program per material)

let shared: {
  trim: THREE.MeshStandardMaterial; dash: THREE.MeshStandardMaterial; seat: THREE.MeshStandardMaterial; wheel: THREE.MeshStandardMaterial; fill: THREE.MeshStandardMaterial;
  standPaint: THREE.MeshStandardMaterial; standGlass: THREE.MeshStandardMaterial; standTyre: THREE.MeshStandardMaterial;
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
  /** The steering wheel's spin pivot (rotation.z = the wheel turn), null for a cockpit model. */
  wheel: THREE.Object3D | null;
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

/** The approved model: paint outside, the BackSide trim twin inside, the glass both sides in one pass. */
function modelBody(g: GLTF): THREE.Group {
  const S = carMaterials(), root = new THREE.Group();
  root.name = 'skyways-car-body';
  const scene = g.scene.clone(true);
  scene.name = 'skyways-car-model';
  const meshes: THREE.Mesh[] = [];
  scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
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
  return root;
}

/** No model (Node tests / a failed fetch): a plain coupe-sized stand-in, its cabin glazed so the view out still works. */
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

/**
 * The Meshy cockpit (car frame, world/skywaysCarCockpit.ts cockpitLayout): the dash (its wheel rim on the eye's x), the two seats turned to
 * face it, and the plain dark fillers. The parts keep their own materials (Meshy maps); nothing here casts a shadow.
 */
function modelCockpit(spec: CarSpec, dash: GLTF, seat: GLTF): THREE.Group {
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
  };
  part(dash, lay.dash, 'skyways-car-dash-model');
  lay.seats.forEach((p, i) => part(seat, p, i ? 'skyways-car-seat-right' : 'skyways-car-seat-left'));
  for (const b of lay.fillers) {
    const m = new THREE.Mesh(S.box, S.fill);
    m.name = `skyways-car-${b.name}`;
    m.scale.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
    m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    m.userData.carPart = 'cockpit';
    g.add(m);
  }
  return g;
}

/** A car's view (car frame) from the current models (else the stand-in / procedural cockpit). */
export function buildCarView(spec: CarSpec): CarView {
  const m = skywaysCarModels();
  const group = new THREE.Group();
  group.name = 'skyways-car';
  const body = m.car ? modelBody(m.car) : standInBody(spec);
  group.add(body);
  let cockpit: THREE.Group, wheel: THREE.Object3D | null = null;
  if (m.dash && m.seat) cockpit = modelCockpit(spec, m.dash, m.seat);
  else ({group: cockpit, wheel} = proceduralCockpit(spec));
  group.add(cockpit);
  return {group, body, cockpit, wheel, gen: carModelsGen, standIn: !m.car};
}

/** Rebuild the body / cockpit from the current models (they arrived after the view was built). */
export function refreshCarView(v: CarView, spec: CarSpec): void {
  if (v.gen === carModelsGen) return;
  v.gen = carModelsGen;
  const m = skywaysCarModels();
  v.group.remove(v.body, v.cockpit);
  v.body = m.car ? modelBody(m.car) : standInBody(spec);
  v.standIn = !m.car;
  if (m.dash && m.seat) { v.cockpit = modelCockpit(spec, m.dash, m.seat); v.wheel = null; }
  else ({group: v.cockpit, wheel: v.wheel} = proceduralCockpit(spec));
  v.group.add(v.body, v.cockpit);
}

/** The steering wheel shows the front-wheel angle (no allocation). */
export function setWheel(v: CarView, steer: number): void {
  if (v.wheel) v.wheel.rotation.z = steer * WHEEL_RATIO;
}
