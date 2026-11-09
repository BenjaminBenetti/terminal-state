// Task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): the Bunker objective's VISUALS — the three auxiliary generators and the
// core's computer cluster, drawn by world/bunker/objective.ts on the LEVEL lane's prop placements (kinds BUNKER_GENERATOR_KIND /
// BUNKER_CORE_KIND: their collision / bullets / sight come from the placements like every prop; the builder draws nothing for them).
// A separate visuals state: never the Reactor's reactorVisuals() / archVisuals, never its lanes.
//
// GENERATOR (real size, the Reactor's accepted Meshy model REACTOR_KIT.generator — its maps kept — at the placement: front +Z = the
// control box side): a small FUEL / START PANEL on the body face beside the control box (procedural, plain painted-steel colours: a
// fixture, no textures) — the filler neck with its yellow screw cap (off while a pour runs: the neck's opening shows), the status lamp
// (OFFLINE red / FUELLED amber / ONLINE green; a blinking amber while it cranks) and the KEY SWITCH whose key turns with the [E] hold
// (the turnkey start) and stays turned while it runs. A running generator vibrates (the body group jitters a few mm, like the
// Reactor's ARCH_VISUALS.jitter). The world/fuelPourView.ts pour hangs in `pourFrame` (the generator frame turned by pi about Y: the
// pour view's outward -Z is the generator's +Z face).
//
// CORE CLUSTER (front +Z, footprint BUNKER_CORE_DIMS 6.0 x 3.6 x 2.2): two Reactor switchgear cabinets (sealed equipment) on the
// flanks, the Reactor control console in front (the operator terminal: a built-in console), and between them a steel stand carrying
// the NEW big screen (a self-lit CanvasTexture plane: world/bunker/coreScreen.ts — dynamic content), dim at low power, bright alive.
// Models are the Reactor kit's at their accepted real sizes (no rescale); a model the library could not load draws nothing (the
// collision stays: no stand-in box). Shared geometry / fixture materials are module singletons; canvases / lamp / screen materials
// are per world (disposed by dispose()).

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {REACTOR_KIT} from '../../assets/reactorKit.generated';
import {BUNKER_CORE_DIMS, BUNKER_GENERATOR_DIMS, type BunkerCoreInfo, type BunkerGeneratorSlot} from '../../gen/bunker/bunkerTypes';
import type {BunkerGenState} from './objectiveState';
import {CORE_SCREEN_PX, coreScreenKey, drawCoreScreen, type CoreScreenModel} from './coreScreen';

/** The lazy-library keys the objective draws (the LEVEL lane's levelAssets rule lets the bunker load these reactor-* files). */
export const BUNKER_OBJECTIVE_MODELS = {
  generator: REACTOR_KIT.generator.key,
  switchgear: REACTOR_KIT.switchgear.key,
  console: REACTOR_KIT.controlConsole.key,
} as const;

interface V3 { x: number; y: number; z: number }

/**
 * The generator's fuel / start panel (generator-local metres, front +Z). Probed on the cooked GLB and checked on a front render
 * (2026-11-09): the engine housing's plain face is at z 0.59 .. 0.61 over y 0.65 .. 1.0 below its third louvred door (x 0.81 .. 1.22),
 * left of the control box (gauges / levers x 1.54 .. 2.35, out to z 0.84) — the plate's back sits inside that face, the filler neck /
 * lamp / key on its front (a genset's filler sits low on its housing).
 */
export const GEN_PANEL = {
  cx: 1.0, cy: 0.85, w: 0.5, h: 0.34, backZ: 0.555, frontZ: 0.625,
  /** The body face behind the plate (the pour's "skin": the posed can stays in front of it). */
  bodyZ: 0.6,
  neck: {x: 0.88, y: 0.82, r: 0.034, len: 0.05},
  cap: {r: 0.046, len: 0.03},
  lamp: {x: 1.13, y: 0.95, r: 0.026},
  key: {x: 1.13, y: 0.77, r: 0.032},
} as const;

/** The aim box of a generator's controls (generator-local): the panel and the model's control box beside it. */
export const GEN_AIM = {x0: 0.6, x1: 2.45, y0: 0.6, y1: 1.85, z0: 0.4, z1: 1.0} as const;
/** Where the operator stands (generator-local plan point in front of the panel / control box). */
export const GEN_USE = {x: 1.3, z: 1.6} as const;
/** The exhaust outlet (generator-local; the model's tallest part is its muffler stack at x ~1.8). */
export const GEN_EXHAUST = {x: 1.7, y: 2.62, z: 0.05} as const;
/** Vibration amplitude (m) of a running generator (the Reactor's ARCH_VISUALS.jitter). */
export const GEN_JITTER = 0.006;
/** The turned key's angle (rad, about the panel normal). */
const KEY_TURN = -Math.PI / 2;

/** The filler neck's open end (generator-local) — where the poured stream goes in. */
export function genNeckMouth(): V3 {
  const P = GEN_PANEL;
  return {x: P.neck.x, y: P.neck.y, z: P.frontZ + P.neck.len - 0.005};
}

/** Generator-local -> the pour frame (turned pi about Y: x -> -x, z -> -z). */
export const toPourFrame = (p: V3): V3 => ({x: -p.x, y: p.y, z: -p.z});

/** The core cluster's parts (core-local metres, front +Z, origin at the footprint's floor centre). */
export const CORE_LAYOUT = {
  switchgear: [{x: -2.4, z: -0.45}, {x: 2.4, z: -0.45}],
  console: {x: 0, z: 0.355},
  /** The screen stand (floor to the bezel) and the bezel round the screen. */
  stand: {w: 3.6, h: 1.75, d: 0.1, z: -1.0},
  bezel: {w: 3.6, h: 1.8, d: 0.1, y: 2.65, z: -1.0},
  screen: {w: 3.4, h: 1.6, y: 2.65, z: -0.948},
} as const;
/** The core's aim box (core-local): the console and the screen wall above it. */
export const CORE_AIM = {x0: -1.9, x1: 1.9, y0: 0.5, y1: 3.6, z0: -1.0, z1: 1.15} as const;
/** Where the operator stands (core-local plan point in front of the console). */
export const CORE_USE = {x: 0, z: 1.75} as const;

const LAMP_COLOR: Record<BunkerGenState, THREE.Color> = {
  off: new THREE.Color(0.9, 0.12, 0.06), fuelled: new THREE.Color(1.0, 0.62, 0.1), online: new THREE.Color(0.2, 1.0, 0.32),
};
const LAMP_DARK = new THREE.Color(0.12, 0.07, 0.03);

// --- shared (module singletons: never disposed) ----------------------------------------------------------------------------------
const geos = new Map<string, THREE.BufferGeometry>();
const G = (k: string, make: () => THREE.BufferGeometry) => { let g = geos.get(k); if (!g) geos.set(k, (g = make())); return g; };
let fixtureMats: {plate: THREE.MeshStandardMaterial; neck: THREE.MeshStandardMaterial; cap: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; key: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial} | null = null;
function mats(): NonNullable<typeof fixtureMats> {
  fixtureMats ??= {
    plate: new THREE.MeshStandardMaterial({name: 'bunker-gen-panel', color: 0x4a5049, roughness: 0.62, metalness: 0.45}),
    neck: new THREE.MeshStandardMaterial({name: 'bunker-gen-neck', color: 0x6b6f72, roughness: 0.4, metalness: 0.7}),
    cap: new THREE.MeshStandardMaterial({name: 'bunker-gen-cap', color: 0xc99a1e, roughness: 0.5, metalness: 0.3}),
    dark: new THREE.MeshStandardMaterial({name: 'bunker-gen-opening', color: 0x0d0f10, roughness: 0.9, metalness: 0.1}),
    key: new THREE.MeshStandardMaterial({name: 'bunker-gen-key', color: 0xb8b2a0, roughness: 0.35, metalness: 0.85}),
    steel: new THREE.MeshStandardMaterial({name: 'bunker-core-steel', color: 0x3b4245, roughness: 0.55, metalness: 0.55}),
  };
  return fixtureMats;
}

/** A model's meshes fitted like world/reactor/bunkerModels.ts: x / z centred on the measured box, min y on the floor (real size). */
function modelMeshes(gltf: GLTF | undefined, name: string, level: number): THREE.Mesh[] {
  if (!gltf) return [];
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return [];
  const c = box.getCenter(new THREE.Vector3());
  const fit = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
  const out: THREE.Mesh[] = [];
  root.traverse(o => {
    const src = o as THREE.Mesh;
    if (!src.isMesh) return;
    const m = new THREE.Mesh(src.geometry, src.material); // the GLB's own geometry / material (Meshy maps kept; shared, never disposed here)
    m.name = name;
    m.matrixAutoUpdate = false;
    m.matrix.multiplyMatrices(fit, src.matrixWorld);
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.level = level;
    out.push(m);
  });
  return out;
}

const tagLevel = (root: THREE.Object3D, level: number) => root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });

// --- the generator ----------------------------------------------------------------------------------------------------------------

export class BunkerGeneratorView {
  /** World pose of the placement (rotation.y = slot.rot). */
  readonly root = new THREE.Group();
  /** The model + panel (vibrates while running). */
  readonly body = new THREE.Group();
  /** The pour view's frame (the generator frame turned pi about Y; not vibrating, never level-registered). */
  readonly pourFrame = new THREE.Group();
  /** The status lamp's own material (colour only: one program for every lamp). */
  readonly lampMat: THREE.MeshBasicMaterial;
  /** The key (turns about the panel normal with the start hold). */
  readonly key = new THREE.Group();
  /** Model meshes drawn (0: the model was not loaded). */
  readonly modelMeshes: number;
  private readonly screwCap: THREE.Mesh[] = [];
  private readonly opening: THREE.Mesh;
  private state: BunkerGenState = 'off';
  private blink = -1;
  private keyK = -1;
  private jitterOn = false;
  readonly phase: number;

  constructor(readonly slot: BunkerGeneratorSlot, model: GLTF | undefined, index: number) {
    this.root.name = `bunker-generator-${slot.id}`;
    this.root.position.set(slot.x, slot.y, slot.z);
    this.root.rotation.y = slot.rot;
    this.body.name = 'bunker-generator-body';
    this.root.add(this.body);
    this.phase = index * 1.37;
    const meshes = modelMeshes(model, 'bunker-generator-model', slot.level);
    for (const m of meshes) this.body.add(m);
    this.modelMeshes = meshes.length;
    // the fuel / start panel (procedural plain-colour fixture on the body face)
    const P = GEN_PANEL, M = mats(), D = P.frontZ - P.backZ;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body, name = 'bunker-gen-panel') => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.name = name; m.castShadow = false; parent.add(m); return m;
    };
    add(G('plate', () => new THREE.BoxGeometry(P.w, P.h, D)), M.plate, P.cx, P.cy, P.backZ + D / 2);
    const neckG = G('neck', () => new THREE.CylinderGeometry(P.neck.r, P.neck.r, P.neck.len, 14).rotateX(Math.PI / 2));
    add(neckG, M.neck, P.neck.x, P.neck.y, P.frontZ + P.neck.len / 2 - 0.004, this.body, 'bunker-gen-neck');
    const capZ = P.frontZ + P.neck.len + P.cap.len / 2 - 0.008;
    this.screwCap.push(add(G('cap', () => new THREE.CylinderGeometry(P.cap.r, P.cap.r, P.cap.len, 16).rotateX(Math.PI / 2)), M.cap, P.neck.x, P.neck.y, capZ, this.body, 'bunker-gen-cap'));
    this.screwCap.push(add(G('grip', () => new THREE.BoxGeometry(P.cap.r * 1.5, 0.014, 0.012)), M.cap, P.neck.x, P.neck.y, capZ + P.cap.len / 2 + 0.004, this.body, 'bunker-gen-cap-grip'));
    this.opening = add(G('hole', () => new THREE.CircleGeometry(P.neck.r * 0.72, 14)), M.dark, P.neck.x, P.neck.y, P.frontZ + P.neck.len - 0.0025, this.body, 'bunker-gen-opening');
    this.opening.visible = false;
    // the status lamp (self-lit) in a dark bezel
    add(G('lampBezel', () => new THREE.CylinderGeometry(P.lamp.r + 0.012, P.lamp.r + 0.012, 0.014, 18).rotateX(Math.PI / 2)), M.dark, P.lamp.x, P.lamp.y, P.frontZ + 0.007);
    this.lampMat = new THREE.MeshBasicMaterial({name: 'bunker-gen-lamp', color: LAMP_COLOR.off.clone()});
    add(G('lamp', () => new THREE.SphereGeometry(P.lamp.r, 14, 10).scale(1, 1, 0.6)), this.lampMat, P.lamp.x, P.lamp.y, P.frontZ + 0.016, this.body, 'bunker-gen-lamp');
    // the key switch: a bezel, the barrel and the key (its bow turns)
    add(G('keyBezel', () => new THREE.CylinderGeometry(P.key.r + 0.01, P.key.r + 0.01, 0.012, 18).rotateX(Math.PI / 2)), M.neck, P.key.x, P.key.y, P.frontZ + 0.006);
    add(G('keyBarrel', () => new THREE.CylinderGeometry(P.key.r * 0.55, P.key.r * 0.55, 0.02, 14).rotateX(Math.PI / 2)), M.dark, P.key.x, P.key.y, P.frontZ + 0.016);
    this.key.name = 'bunker-gen-key';
    this.key.position.set(P.key.x, P.key.y, P.frontZ + 0.026);
    this.body.add(this.key);
    add(G('keyShank', () => new THREE.BoxGeometry(0.008, 0.026, 0.016)), M.key, 0, 0, 0.004, this.key, 'bunker-gen-key');
    add(G('keyBow', () => new THREE.BoxGeometry(0.03, 0.036, 0.006)), M.key, 0, 0.026, 0.01, this.key, 'bunker-gen-key');
    tagLevel(this.body, slot.level);
    // the pour frame (the FuelPourView is parented here by the runtime while it pours / for the warm-up)
    this.pourFrame.name = 'bunker-generator-pour-frame';
    this.pourFrame.rotation.y = Math.PI;
    this.root.add(this.pourFrame);
    this.body.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.raycast = () => {}; }); // decorative: never a hit / aim target
    this.setStatus('off', false, 0);
    this.setKey(0);
  }

  /** The status lamp: the state's colour; cranking blinks amber (one colour write per flip). */
  setStatus(state: BunkerGenState, cranking: boolean, time: number): void {
    const on = cranking ? (Math.floor(time * 4) % 2 === 0 ? 1 : 0) : 2;
    if (state === this.state && on === this.blink) return;
    this.state = state;
    this.blink = on;
    this.lampMat.color.copy(cranking ? (on ? LAMP_COLOR.fuelled : LAMP_DARK) : LAMP_COLOR[state]);
  }

  /** The key's turn 0 (off) .. 1 (start). */
  setKey(k: number): void {
    const v = Math.max(0, Math.min(1, k));
    if (v === this.keyK) return;
    this.keyK = v;
    this.key.rotation.z = KEY_TURN * v;
  }

  /** The screw cap off (the neck's opening shows) / back on. */
  setUncapped(off: boolean): void {
    for (const m of this.screwCap) m.visible = !off;
    this.opening.visible = off;
  }

  get uncapped(): boolean { return this.opening.visible; }

  /** Running vibration at `level` 0..1 (0: back to rest once). */
  vibrate(level: number, time: number): void {
    if (level <= 0) { if (this.jitterOn) { this.body.position.set(0, 0, 0); this.jitterOn = false; } return; }
    this.jitterOn = true;
    const a = GEN_JITTER * level, t = time * 60 + this.phase;
    this.body.position.set(a * Math.sin(t * 1.37), a * 0.5 * Math.sin(t * 2.11 + 1), a * Math.sin(t * 1.73 + 2));
  }

  /** The visible state (QA / tests). */
  qa(): {state: BunkerGenState; lamp: string; key: number; uncapped: boolean; vibrating: boolean} {
    return {state: this.state, lamp: `#${this.lampMat.color.getHexString()}`, key: this.keyK, uncapped: this.uncapped, vibrating: this.jitterOn};
  }

  dispose(): void {
    this.lampMat.dispose();
  }
}

// --- the core cluster --------------------------------------------------------------------------------------------------------------

export class BunkerCoreView {
  readonly root = new THREE.Group();
  readonly canvas: HTMLCanvasElement | null;
  readonly texture: THREE.Texture;
  readonly screenMat: MeshBasicNodeMaterial;
  readonly screen: THREE.Mesh;
  /** Model meshes drawn (switchgear x2 + console; fewer when a model was not loaded). */
  readonly modelMeshes: number;
  /** The last drawn key (QA: redraws only on change). */
  key = '';
  redraws = 0;
  private alive: boolean | null = null;

  constructor(readonly info: BunkerCoreInfo, models: {switchgear?: GLTF; console?: GLTF}) {
    const L = CORE_LAYOUT, M = mats();
    this.root.name = 'bunker-core-cluster';
    this.root.position.set(info.x, info.y, info.z);
    this.root.rotation.y = info.rot;
    let n = 0;
    for (const s of L.switchgear) {
      for (const m of modelMeshes(models.switchgear, 'bunker-core-switchgear', info.level)) { m.matrix.premultiply(new THREE.Matrix4().makeTranslation(s.x, 0, s.z)); this.root.add(m); n++; }
    }
    for (const m of modelMeshes(models.console, 'bunker-core-console', info.level)) { m.matrix.premultiply(new THREE.Matrix4().makeTranslation(L.console.x, 0, L.console.z)); this.root.add(m); n++; }
    this.modelMeshes = n;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, name: string) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.name = name; m.castShadow = false; m.receiveShadow = true; this.root.add(m); return m;
    };
    add(G(`stand${L.stand.w},${L.stand.h}`, () => new THREE.BoxGeometry(L.stand.w, L.stand.h, L.stand.d)), M.steel, 0, L.stand.h / 2, L.stand.z, 'bunker-core-stand');
    add(G(`bezel${L.bezel.w},${L.bezel.h}`, () => new THREE.BoxGeometry(L.bezel.w, L.bezel.h, L.bezel.d)), M.steel, 0, L.bezel.y, L.bezel.z, 'bunker-core-bezel');
    const hasCanvas = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this.canvas = hasCanvas ? document.createElement('canvas') : null;
    if (this.canvas) { this.canvas.width = CORE_SCREEN_PX.w; this.canvas.height = CORE_SCREEN_PX.h; }
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : new THREE.DataTexture(new Uint8Array([8, 14, 10, 255]), 1, 1);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;
    this.screenMat = new MeshBasicNodeMaterial({map: this.texture, color: new THREE.Color(0.5, 0.5, 0.5)});
    this.screenMat.name = 'bunker-core-screen';
    this.screen = add(G(`screen${L.screen.w},${L.screen.h}`, () => new THREE.PlaneGeometry(L.screen.w, L.screen.h)), this.screenMat, 0, L.screen.y, L.screen.z, 'bunker-core-screen');
    this.screen.receiveShadow = false;
    tagLevel(this.root, info.level);
    this.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.raycast = () => {}; });
  }

  /** Redraw the face when the key (state + quantised animation frame) changed. True = redrawn. */
  draw(m: CoreScreenModel, frame: number): boolean {
    if (m.alive !== this.alive) {
      this.alive = m.alive;
      this.screenMat.color.setScalar(m.alive ? 0.95 : 0.5); // dim at low power (a uniform: no new program)
    }
    const key = coreScreenKey(m, frame);
    if (key === this.key) return false;
    this.key = key;
    const ctx = typeof this.canvas?.getContext === 'function' ? this.canvas.getContext('2d') as CanvasRenderingContext2D | null : null;
    if (!ctx) return false;
    drawCoreScreen(ctx, m, CORE_SCREEN_PX.w, CORE_SCREEN_PX.h, frame);
    this.texture.needsUpdate = true;
    this.redraws++;
    return true;
  }

  get brightness(): number { return this.screenMat.color.r; }

  dispose(): void {
    this.texture.dispose();
    this.screenMat.dispose();
  }
}

/** Generator-local point -> world, for a slot (no three.js objects needed). */
export function genToWorld(slot: Pick<BunkerGeneratorSlot, 'x' | 'y' | 'z' | 'rot'>, p: V3, out: V3 = {x: 0, y: 0, z: 0}): V3 {
  const c = Math.cos(slot.rot), s = Math.sin(slot.rot);
  // three.js Y rotation: local (x, z) -> world (x cos + z sin, -x sin + z cos)
  out.x = slot.x + p.x * c + p.z * s;
  out.y = slot.y + p.y;
  out.z = slot.z - p.x * s + p.z * c;
  return out;
}

/** World point / direction -> placement-local (inverse of genToWorld; directions skip the translation). */
export function worldToLocal(slot: Pick<BunkerGeneratorSlot, 'x' | 'y' | 'z' | 'rot'>, p: V3, dir: boolean, out: V3 = {x: 0, y: 0, z: 0}): V3 {
  const c = Math.cos(slot.rot), s = Math.sin(slot.rot);
  const dx = dir ? p.x : p.x - slot.x, dy = dir ? p.y : p.y - slot.y, dz = dir ? p.z : p.z - slot.z;
  out.x = dx * c - dz * s;
  out.y = dy;
  out.z = dx * s + dz * c;
  return out;
}

/** The footprints the views assume (the contract's dims; tests check the parts stay inside). */
export const VIEW_FOOTPRINTS = {generator: BUNKER_GENERATOR_DIMS, core: BUNKER_CORE_DIMS} as const;
