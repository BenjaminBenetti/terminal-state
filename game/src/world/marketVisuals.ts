// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): THE SURVIVOR MARKET's live dressing — the SLOW CEILING FANS (a code-driven
// spin: an animated, dynamic element) and the patched-canvas STALL AWNINGS (the Codex-authored tarp texture: world/marketTextures.ts),
// both planned by gen/market/art.ts from the finished layout. One section runtime (installMarketVisuals: one tagged line in Game): its
// build hook adds a group to the scene before the warm-up (so every program is compiled with the level), its frame hook turns the fan
// rotors (one InstancedMesh: a matrix per fan per frame, nothing allocated), its teardown removes and disposes everything. Inert on
// every other level.
// The shed's ATMOSPHERE: an ordinary (never green: no gas here) warm dusty haze lighter than the station's near-black fog, so the whole
// settlement (40 m of square, the deck, the far stalls) reads from the platform; the camera far plane / the culler's fog distance follow;
// teardown restores the indoor MOOD values exactly (the mall's recipe, world/mallAtmosphere.ts: uniform / camera values only).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {StationLayout} from '../gen/stationTypes';
import {marketAwnings, marketFans, type MarketFan} from '../gen/market/art';
import {SurfaceNodeMaterial} from './materials';
import {marketSpan, marketTexture} from './marketTextures';
import {MOOD, syncGlowFog} from './lights';
import {fogCullDistance} from './levelCulling';

export interface MarketVisualsHost {
  scene: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  world?: {culler?: {maxDistance: number}} | null;
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
}

/** The built pieces of one market (QA / tests). */
export interface MarketView {
  root: THREE.Group;
  fans: MarketFan[];
  rotors: THREE.InstancedMesh | null;
  awnings: number;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

const FAN_STEEL = 0x34322e, AWNING_STANDIN = 0x6d6a3e;
/** The shed's haze (FogExp2): warm dusty brown, ~55 % transmittance across the 35 m square (MOOD: ~10 %); the camera far plane (m). */
export const MARKET_FOG = {density: 0.022, color: 0x2b2620, far: 120};

/** One fan's rotor (motor housing + four blades) about +Y, centred on the hub. */
function rotorGeometry(r: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.13, 0.11, 0.17, 12)];
  for (let k = 0; k < 4; k++) {
    const b = new THREE.BoxGeometry(r - 0.1, 0.014, 0.13);
    b.translate(0.1 + (r - 0.1) / 2, -0.05, 0);
    b.rotateX(0.12); // a little blade pitch
    b.rotateY(k * Math.PI / 2);
    parts.push(b);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  for (const p of parts) p.dispose();
  return g;
}

/** The awnings' sloped canvas quads + a front batten each, uv in metres / the tarp span. */
function awningGeometry(layout: StationLayout): {canvas: THREE.BufferGeometry; battens: THREE.BufferGeometry; n: number} | null {
  const list = marketAwnings(layout);
  if (!list.length) return null;
  const span = marketSpan('tarp');
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const battens: THREE.BufferGeometry[] = [];
  for (const a of list) {
    const b = pos.length / 3, z1 = a.z + a.depth, slant = Math.hypot(a.depth, a.yWall - a.yEdge);
    pos.push(a.x0, a.yWall, a.z, a.x1, a.yWall, a.z, a.x1, a.yEdge, z1, a.x0, a.yEdge, z1);
    uv.push(a.x0 / span.u, 0, a.x1 / span.u, 0, a.x1 / span.u, slant / span.v, a.x0 / span.u, slant / span.v);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    const bt = new THREE.BoxGeometry(a.x1 - a.x0, 0.06, 0.05);
    bt.translate((a.x0 + a.x1) / 2, a.yEdge - 0.03, z1);
    battens.push(bt.toNonIndexed());
    bt.dispose();
  }
  const canvas = new THREE.BufferGeometry();
  canvas.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  canvas.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  canvas.setIndex(idx);
  canvas.computeVertexNormals();
  const bg = mergeGeometries(battens);
  for (const g of battens) g.dispose();
  return {canvas, battens: bg, n: list.length};
}

/** Builds the market's fans + awnings for a layout (null: not a market). Pure three.js (tests call it directly). */
export function buildMarketView(layout: StationLayout): MarketView | null {
  if (!layout.market) return null;
  const root = new THREE.Group();
  root.name = 'market-visuals';
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const steel = new SurfaceNodeMaterial({color: FAN_STEEL, roughness: 0.55, metalness: 0.5});
  steel.name = 'market-fan-steel';
  materials.push(steel);
  // --- fans: static rods (one instanced unit cylinder, scaled), spinning rotors (one InstancedMesh) ---
  const fans = marketFans(layout);
  let rotors: THREE.InstancedMesh | null = null;
  if (fans.length) {
    const rod = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
    rod.translate(0, 0.5, 0);
    const rotor = rotorGeometry(fans[0].r);
    geometries.push(rod, rotor);
    const rods = new THREE.InstancedMesh(rod, steel, fans.length);
    rods.name = 'market-fan-rods';
    const m = new THREE.Matrix4();
    fans.forEach((f, i) => rods.setMatrixAt(i, m.compose(new THREE.Vector3(f.x, f.y, f.z), new THREE.Quaternion(), new THREE.Vector3(1, Math.max(0.01, f.rod), 1))));
    rods.computeBoundingSphere();
    rotors = new THREE.InstancedMesh(rotor, steel, fans.length);
    rotors.name = 'market-fan-rotors';
    rotors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(rods, rotors);
  }
  // --- awnings: the tarp canvas (Codex texture; a plain olive stand-in while not loaded) + battens ---
  const aw = awningGeometry(layout);
  if (aw) {
    const t = marketTexture('tarp');
    const canvasMat = new SurfaceNodeMaterial({...(t ? {map: t} : {color: AWNING_STANDIN}), roughness: 0.95, metalness: 0, side: THREE.DoubleSide});
    canvasMat.name = 'market-awning';
    materials.push(canvasMat);
    geometries.push(aw.canvas, aw.battens);
    const canvas = new THREE.Mesh(aw.canvas, canvasMat);
    canvas.name = 'market-awnings';
    const battens = new THREE.Mesh(aw.battens, steel);
    battens.name = 'market-awning-battens';
    root.add(canvas, battens);
  }
  for (const o of root.children) { o.castShadow = false; o.receiveShadow = false; o.userData.level = 0; }
  const view: MarketView = {root, fans, rotors, awnings: aw?.n ?? 0, geometries, materials};
  turnFans(view, 0);
  return view;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
/** Writes every rotor at time t (s): angle = phase + speed * t. */
export function turnFans(view: MarketView, t: number): void {
  const r = view.rotors;
  if (!r) return;
  view.fans.forEach((f, i) => r.setMatrixAt(i, _m.compose(_p.set(f.x, f.y, f.z), _q.setFromAxisAngle(_up, f.phase + f.speed * t), _s)));
  r.instanceMatrix.needsUpdate = true;
  if (!r.boundingSphere) r.computeBoundingSphere();
}

/** The section runtime. */
export class MarketVisuals {
  view: MarketView | null = null;
  private t = 0;
  readonly counts = {builds: 0, teardowns: 0};
  constructor(readonly host: MarketVisualsHost) {}

  install(): this {
    this.host.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    this.host.frameHooks.push(dt => this.frame(dt));
    return this;
  }

  private farWas: number | null = null;
  private fogOn = false;

  build(layout: StationLayout): void {
    if (this.view) this.teardown();
    const v = buildMarketView(layout);
    if (!v) { this.restoreFog(); return; }
    this.applyFog();
    this.host.scene.add(v.root);
    this.view = v;
    this.t = 0;
    this.counts.builds++;
  }

  frame(dt: number): void {
    if (!this.view) return;
    this.t += Math.min(0.1, Math.max(0, dt));
    turnFans(this.view, this.t);
  }

  /** The shed's haze, the far plane, the culler's fog distance. */
  private applyFog(): void {
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) { fog.density = MARKET_FOG.density; fog.color.setHex(MARKET_FOG.color); syncGlowFog(fog); }
    const cam = this.host.camera;
    if (cam) {
      if (this.farWas === null) this.farWas = cam.far;
      cam.far = Math.max(this.farWas, MARKET_FOG.far);
      cam.updateProjectionMatrix();
    }
    const culler = this.host.world?.culler;
    if (culler) culler.maxDistance = Math.min(fogCullDistance(MARKET_FOG.density), MARKET_FOG.far);
    this.fogOn = true;
  }

  /** The indoor MOOD values back exactly. */
  private restoreFog(): void {
    if (!this.fogOn) return;
    const fog = this.host.scene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) { fog.density = MOOD.fogDensity; fog.color.setHex(MOOD.fogColor); syncGlowFog(fog); }
    if (this.farWas !== null && this.host.camera) { this.host.camera.far = this.farWas; this.host.camera.updateProjectionMatrix(); }
    this.farWas = null;
    this.fogOn = false;
  }

  teardown(): void {
    this.restoreFog();
    const v = this.view;
    this.view = null;
    if (!v) return;
    this.host.scene.remove(v.root);
    for (const g of v.geometries) g.dispose();
    for (const m of v.materials) m.dispose();
    for (const o of v.root.children) if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    this.counts.teardowns++;
  }
}

/** Installs the market visuals into a Game (one call in the Game constructor). */
export function installMarketVisuals(host: MarketVisualsHost): MarketVisuals {
  return new MarketVisuals(host).install();
}
