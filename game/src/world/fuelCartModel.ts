// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART): the FUEL CART's look — composed from two EXISTING approved models
// only (no new art, no generation):
//  - the hand truck  game/public/assets/models/p7-hand-truck-t25.glb (gen/props07.catalog.ts handTruck: 0.50 x 1.20 x 0.50 m, front +Z,
//    origin bottom-centre) at its native runtime size;
//  - the drum        game/public/assets/models/reactor-waste-drum.glb (assets/reactorExpansionKit.generated.ts wasteDrum: 0.63 x 0.90 x
//    0.63 m) scaled uniformly by CART_LOOK.drumScale (0.72: 0.45 m wide, 0.65 m tall) standing on the truck's nose plate (top 0.073 m)
//    against its uprights (front face z = -0.066 in the truck's frame).
// The cart stands upright (a parked dolly rests on its nose plate and wheels). Beside a 1.78 m zombie: handle top 1.20 m, drum lid
// 0.72 m (tests/fuel-carts-cargo.test.ts pins the numbers).
//
// The CART FRAME (every cart-local value here): origin = the centre of the footprint circle (PORT.cartRadius) on the floor, +Z = the
// FRONT (the drum side), -Z = the handle side (where the player holds it), +Y up. three.js rotation.y = yaw, so the front points along
// world (sin yaw, cos yaw).
//
// Models load through this module's own cache (loadCartModels: the same GLTFLoader the prop library uses, never trimmed / disposed for
// the session) and NOT through Game.propModels: the drum is a Reactor-level-only path (assets/levelAssets.ts) that the library refuses
// on every other level, and a cart (station-owned or riding in the train as cargo) can stand in any station. Without the models
// (Node tests, a failed fetch) a simple procedural STAND-IN (named 'fuel-cart-stand-in') is drawn; a cart built before the models arrive
// is upgraded in place (FuelCarts.frame).
//
// The runtime fuel GAUGE (dynamic geometry / material: allowed by the texture rule) is a short bar on the drum lid: 8 quarter-unit
// segments (= two tanks), a mark at one tank; green from one tank up, amber below, nothing lit when empty.
// The HOSE (CartHose) is ONE pooled tube (fixed segment count; positions / normals rewritten in place: no BufferGeometry per frame).

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetUrl} from '../assets/loader';
import {P7_MODELS} from '../gen/props07.catalog';
import {REACTOR_X_KIT} from '../assets/reactorExpansionKit.generated';
import {FUEL} from '../fuel/fuel';
import {PORT} from '../fuel/trainPort';

/** Measured layout of the composed cart (m, cart frame unless noted). */
export const CART_LOOK = (() => {
  const truck = P7_MODELS.handTruck, drum = REACTOR_X_KIT.wasteDrum;
  const drumScale = 0.72;
  const plateTop = 0.073; // the nose plate's top (props07.catalog handTruck surfaces[0].y)
  const uprightFront = -0.066; // the uprights' front face, truck frame (measured on the cooked GLB)
  const drumR = (Math.max(drum.dims[0], drum.dims[2]) / 2) * drumScale;
  const drumZt = uprightFront + drumR + 0.004; // the drum's centre, truck frame
  const back = -truck.d / 2, front = drumZt + drumR;
  const zc = (back + front) / 2; // footprint centre, truck frame
  return {
    drumScale, plateTop, drumR, drumH: drum.dims[1] * drumScale,
    /** The truck model's origin in the cart frame (z). */
    truckZ: -zc,
    /** The drum's centre (z) / base / lid in the cart frame. */
    drumZ: drumZt - zc, drumBase: plateTop, drumTop: plateTop + drum.dims[1] * drumScale,
    /** Overall height (the handle top) and the footprint (half width x, half depth z). */
    height: truck.h, halfW: truck.w / 2, halfD: (front - back) / 2,
    /** The handle bar (where the player grabs): centre height and z. */
    handle: {y: 1.12, z: -0.125 - zc},
    /** The frame's aim cylinder (the truck: uprights, handle, wheels): centre z, radius. */
    frame: {z: -0.12 - zc, r: 0.27},
    /** The drum's bung / hose nozzle on the lid. */
    nozzle: {x: 0.1, y: plateTop + drum.dims[1] * drumScale + 0.02, z: drumZt - zc - 0.05},
    keys: {truck: 'fuel-cart-truck', drum: 'fuel-cart-drum'},
    urls: {truck: truck.url, drum: drum.url},
  } as const;
})();

// ---------------------------------------------------------------------------------------------------------------------
// Models (own cache: never trimmed)

export interface CartModels { truck: GLTF | null; drum: GLTF | null }

let modelCache: Promise<CartModels> | null = null;
let loaded: CartModels = {truck: null, drum: null};
/** Bumped when the models arrive (a cart built from the stand-in rebuilds its look). */
export let cartModelsGen = 0;

/** The loaded models now (nulls until loadCartModels resolved, always in Node). */
export function cartModels(): CartModels {
  return loaded;
}

/** Fetches both models once (browser only; never rejects: a failure keeps the stand-in for that part). */
export function loadCartModels(): Promise<CartModels> {
  if (typeof document === 'undefined') return Promise.resolve(loaded);
  modelCache ??= (async () => {
    const one = (url: string): Promise<GLTF | null> => new Promise(resolve => new GLTFLoader().load(assetUrl(url), g => resolve(g), undefined, err => {
      console.warn(`fuel cart: model ${url} failed (stand-in kept)`, err);
      resolve(null);
    }));
    const [truck, drum] = await Promise.all([one(CART_LOOK.urls.truck), one(CART_LOOK.urls.drum)]);
    loaded = {truck, drum};
    cartModelsGen++;
    return loaded;
  })();
  return modelCache;
}

/** Tests: models injected (or cleared) without a fetch. */
export function setCartModelsForTests(m: CartModels): void {
  loaded = m;
  cartModelsGen++;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared runtime materials / geometry (one instance each: one program, one shadow program per material)

let shared: {
  gaugeBack: THREE.MeshStandardMaterial; gaugeFull: THREE.MeshStandardMaterial; gaugeLow: THREE.MeshStandardMaterial; gaugeMark: THREE.MeshStandardMaterial;
  hose: THREE.MeshStandardMaterial; standSteel: THREE.MeshStandardMaterial; standDrum: THREE.MeshStandardMaterial; standTyre: THREE.MeshStandardMaterial;
  gaugeBackGeo: THREE.BufferGeometry; gaugeSegGeo: THREE.BufferGeometry; gaugeMarkGeo: THREE.BufferGeometry;
  boxGeo: THREE.BufferGeometry; drumGeo: THREE.BufferGeometry; wheelGeo: THREE.BufferGeometry;
} | null = null;

export function cartMaterials(): NonNullable<typeof shared> {
  if (shared) return shared;
  const std = (name: string, color: number, o: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({color, roughness: 0.8, metalness: 0.1, ...o}); m.name = name; return m; };
  shared = {
    gaugeBack: std('fuel-cart-gauge-back', 0x161616, {roughness: 0.6}),
    gaugeFull: std('fuel-cart-gauge-full', 0x1d5c22, {emissive: 0x46e04f, emissiveIntensity: 0.9}),
    gaugeLow: std('fuel-cart-gauge-low', 0x6a4a10, {emissive: 0xffa21c, emissiveIntensity: 0.9}),
    gaugeMark: std('fuel-cart-gauge-mark', 0xd8d8d0, {emissive: 0x4a4a46, emissiveIntensity: 0.5}),
    hose: std('fuel-cart-hose', 0x121212, {roughness: 0.55}),
    standSteel: std('fuel-cart-stand-in-steel', 0x5b6168, {metalness: 0.5, roughness: 0.55}),
    standDrum: std('fuel-cart-stand-in-drum', 0x7a2a1c, {metalness: 0.3, roughness: 0.6}),
    standTyre: std('fuel-cart-stand-in-tyre', 0x151515, {roughness: 0.9}),
    gaugeBackGeo: new THREE.BoxGeometry(GAUGE.len + 0.016, 0.006, GAUGE.w + 0.014),
    gaugeSegGeo: new THREE.BoxGeometry(GAUGE.seg, 0.006, GAUGE.w),
    gaugeMarkGeo: new THREE.BoxGeometry(0.004, 0.008, GAUGE.w + 0.012),
    boxGeo: new THREE.BoxGeometry(1, 1, 1),
    drumGeo: new THREE.CylinderGeometry(1, 1, 1, 18, 1),
    wheelGeo: new THREE.CylinderGeometry(1, 1, 1, 14, 1),
  };
  return shared;
}

/** The lid gauge: 8 segments (one per quarter unit) along x. */
export const GAUGE = {len: 0.2, w: 0.03, segments: FUEL.cartUnits, get seg() { return this.len / this.segments - 0.004; }} as const;

// ---------------------------------------------------------------------------------------------------------------------
// One cart's view

export interface CartView {
  group: THREE.Group;
  /** The body (models or the stand-in): rebuilt when the models arrive. */
  body: THREE.Group;
  segments: THREE.Mesh[];
  /** cartModelsGen the body was built with; stand-in = no model was available. */
  gen: number;
  standIn: boolean;
  /** Units shown by the gauge (NaN = not yet drawn). */
  shown: number;
}

function standInBody(): THREE.Group {
  const S = cartMaterials(), L = CART_LOOK, g = new THREE.Group();
  g.name = 'fuel-cart-stand-in';
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(S.boxGeo, m); b.scale.set(w, h, d); b.position.set(x, y, z); g.add(b); return b;
  };
  const tz = L.truckZ;
  for (const sx of [-1, 1]) box(0.03, 1.12, 0.03, sx * 0.13, 0.62, tz - 0.08, S.standSteel); // the uprights
  box(0.33, 0.03, 0.03, 0, 1.17, tz - 0.12, S.standSteel); // the handle bar
  box(0.35, 0.015, 0.3, 0, L.plateTop - 0.008, tz + 0.08, S.standSteel); // the nose plate
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(S.wheelGeo, S.standTyre);
    w.scale.set(0.125, 0.06, 0.125); w.rotation.z = Math.PI / 2; w.position.set(sx * 0.215, 0.125, tz - 0.15); g.add(w);
  }
  const d = new THREE.Mesh(S.drumGeo, S.standDrum);
  d.scale.set(L.drumR, L.drumH, L.drumR); d.position.set(0, L.drumBase + L.drumH / 2, L.drumZ); g.add(d);
  return g;
}

function modelBody(m: CartModels): THREE.Group {
  const L = CART_LOOK, g = new THREE.Group();
  g.name = 'fuel-cart-body';
  const stand = standInBody(); // a part without its model keeps its stand-in piece (truck: everything but the drum; drum: the cylinder)
  if (m.truck) {
    const t = m.truck.scene.clone(true);
    t.name = 'fuel-cart-truck';
    t.position.set(0, 0, L.truckZ);
    g.add(t);
  } else for (const c of [...stand.children].filter(c => (c as THREE.Mesh).geometry !== cartMaterials().drumGeo)) g.add(c);
  if (m.drum) {
    const d = m.drum.scene.clone(true);
    d.name = 'fuel-cart-drum';
    d.scale.setScalar(L.drumScale);
    d.position.set(0, L.drumBase, L.drumZ);
    g.add(d);
  } else for (const c of [...stand.children].filter(c => (c as THREE.Mesh).geometry === cartMaterials().drumGeo)) g.add(c);
  return g;
}

/**
 * Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): the HAND TRUCK alone, in the cart frame, exactly as a fuel cart draws
 * it (the model at CART_LOOK.truckZ, else the stand-in's truck pieces) — the train equipment's devices stand on the same truck
 * (world/trainEquipmentModel.ts). Shared geometry / materials; a truck built before the model arrived is rebuilt by its owner when
 * cartModelsGen changes.
 */
export function buildTruckBody(): THREE.Group {
  const m = cartModels(), g = new THREE.Group();
  g.name = 'fuel-cart-truck-body';
  if (m.truck) {
    const t = m.truck.scene.clone(true);
    t.name = 'fuel-cart-truck';
    t.position.set(0, 0, CART_LOOK.truckZ);
    g.add(t);
  } else for (const c of [...standInBody().children].filter(c => (c as THREE.Mesh).geometry !== cartMaterials().drumGeo)) g.add(c);
  return g;
}

/** A cart's view in the cart frame (the body from the models, else the stand-in; the gauge on the lid). */
export function buildCartView(): CartView {
  const m = cartModels(), S = cartMaterials(), L = CART_LOOK;
  const group = new THREE.Group();
  group.name = 'fuel-cart';
  const standIn = !m.truck && !m.drum;
  const body = standIn ? standInBody() : modelBody(m);
  group.add(body);
  // the gauge: a dark plate on the lid, 8 segments, the one-tank mark (tilted a little toward the handle side, where the player stands)
  const gauge = new THREE.Group();
  gauge.name = 'fuel-cart-gauge';
  gauge.position.set(-0.02, L.drumTop + 0.004, L.drumZ - 0.06);
  gauge.rotation.x = 0.18;
  gauge.add(new THREE.Mesh(S.gaugeBackGeo, S.gaugeBack));
  const segments: THREE.Mesh[] = [];
  for (let i = 0; i < GAUGE.segments; i++) {
    const s = new THREE.Mesh(S.gaugeSegGeo, S.gaugeFull);
    s.position.set(-GAUGE.len / 2 + (i + 0.5) * (GAUGE.len / GAUGE.segments), 0.004, 0);
    segments.push(s);
    gauge.add(s);
  }
  const mark = new THREE.Mesh(S.gaugeMarkGeo, S.gaugeMark);
  mark.position.set(-GAUGE.len / 2 + (FUEL.tankUnits / FUEL.cartUnits) * GAUGE.len, 0.005, 0);
  gauge.add(mark);
  group.add(gauge);
  return {group, body, segments, gen: cartModelsGen, standIn, shown: NaN};
}

/** Rebuild the body from the current models (they arrived after the cart was built). */
export function refreshCartBody(v: CartView): void {
  if (v.gen === cartModelsGen) return;
  const m = cartModels();
  v.gen = cartModelsGen;
  if (!m.truck && !m.drum) return;
  v.group.remove(v.body);
  v.body = modelBody(m);
  v.standIn = false;
  v.group.add(v.body);
}

/** The gauge shows `units` (0..FUEL.cartUnits): lit segments, green from one tank up, amber below. No allocation. */
export function setGauge(v: CartView, units: number): void {
  if (v.shown === units) return;
  v.shown = units;
  const S = cartMaterials(), mat = units >= FUEL.tankUnits ? S.gaugeFull : S.gaugeLow;
  for (let i = 0; i < v.segments.length; i++) {
    const s = v.segments[i];
    s.visible = i < units;
    s.material = mat;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The hose: one pooled tube from the cart's nozzle to the train's fuel cap

export const HOSE = {rings: 24, sides: 6, radius: 0.022, sagBase: 0.12, sagPerM: 0.12} as const;

export class CartHose {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  /** QA / tests: how many in-place updates ran (the geometry object never changes). */
  updates = 0;

  constructor() {
    const R = HOSE.rings, S = HOSE.sides;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((R + 1) * S * 3);
    this.nrm = new Float32Array((R + 1) * S * 3);
    const idx: number[] = [];
    for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) {
      const a = i * S + j, b = i * S + ((j + 1) % S), c = (i + 1) * S + j, d = (i + 1) * S + ((j + 1) % S);
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.mesh = new THREE.Mesh(this.geo, cartMaterials().hose);
    this.mesh.name = 'fuel-cart-hose';
    this.mesh.visible = false;
    this.mesh.frustumCulled = true;
    this.update(0, 1, 0, 1, 1, 0, -1); // a valid shape for the warm-up
  }

  get geometry(): THREE.BufferGeometry { return this.geo; }

  /**
   * Shape the hose from A (the nozzle) to B (the fuel cap): a quadratic sag (deeper the longer it runs, never below `floor` + 5 cm).
   * Positions / normals rewritten in place; no allocation.
   */
  update(ax: number, ay: number, az: number, bx: number, by: number, bz: number, floor: number): void {
    const R = HOSE.rings, S = HOSE.sides, r = HOSE.radius, P = this.pos, N = this.nrm;
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    const sag = Math.max(0, Math.min(HOSE.sagBase + HOSE.sagPerM * len, Math.min(ay, by) - floor - 0.05));
    // quadratic Bezier with its control 2·sag under the chord's midpoint: the curve's midpoint dips exactly `sag`
    const cx = (ax + bx) / 2, cy = (ay + by) / 2 - 2 * sag, cz = (az + bz) / 2;
    for (let i = 0; i <= R; i++) {
      const t = i / R, u = 1 - t;
      const px = u * u * ax + 2 * u * t * cx + t * t * bx;
      const py = u * u * ay + 2 * u * t * cy + t * t * by;
      const pz = u * u * az + 2 * u * t * cz + t * t * bz;
      let tx = 2 * u * (cx - ax) + 2 * t * (bx - cx), ty = 2 * u * (cy - ay) + 2 * t * (by - cy), tz = 2 * u * (cz - az) + 2 * t * (bz - cz);
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // n1 = t x up (horizontal), n2 = n1 x t (up-ish); a vertical tangent takes +X as its reference
      let n1x = -tz, n1y = 0, n1z = tx;
      let nl = Math.hypot(n1x, n1z);
      if (nl < 1e-4) { n1x = 0; n1y = tz; n1z = -ty; nl = Math.hypot(n1y, n1z) || 1; }
      n1x /= nl; n1y /= nl; n1z /= nl;
      const n2x = n1y * tz - n1z * ty, n2y = n1z * tx - n1x * tz, n2z = n1x * ty - n1y * tx;
      for (let j = 0; j < S; j++) {
        const a = (j / S) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = ca * n1x + sa * n2x, ny = ca * n1y + sa * n2y, nz = ca * n1z + sa * n2z;
        const k = (i * S + j) * 3;
        N[k] = nx; N[k + 1] = ny; N[k + 2] = nz;
        P[k] = px + r * nx; P[k + 1] = py + r * ny; P[k + 2] = pz + r * nz;
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    const s = this.geo.boundingSphere!;
    s.center.set(cx, (ay + by) / 2 - sag / 2, cz);
    s.radius = len / 2 + sag + 0.1;
    this.updates++;
  }

  /** The hose's lowest point (tests). */
  lowestY(): number {
    let m = Infinity;
    for (let k = 1; k < this.pos.length; k += 3) m = Math.min(m, this.pos[k]);
    return m;
  }
}

/** The cart's footprint radius (re-exported for the controller). */
export const CART_RADIUS = PORT.cartRadius;
