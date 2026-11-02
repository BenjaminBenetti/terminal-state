// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane MENU): the MAIN MENU's diorama — a genuine real-time 3D scene behind
// the side menu: a ruined city in green fog, a surface subway corridor (two tracks) with the player's train (three cars, the lead car
// lit inside, head lamps cutting the murk) and a dead two-car train, under a slowly orbiting camera. NOT a live game world: no
// simulation, damage, loot, enemies, physics or world state — it imports none of that (tests/menu-scene.test.ts checks), only
// renders.
//
// Reused, nothing new authored: the Office exterior city (world/exterior.ts planExterior / buildExterior: procedural ruined blocks,
// the Meshy ruined tower / midrise / car / bus / rubble when loaded, its green height fog with drifting patches and the sky dome),
// the player train's cooked Meshy shell + door leaf (player-train-*.glb through the game's prop library; their Meshy maps kept),
// the station's procedural ballast canvas (world/canvasTextures.ts) and value noise (world/surfaceNodes.ts). Track geometry is boxes
// in the station's own track dimensions (gen builder: rails at +-0.72 m, third rail, coverboard, sleepers every 0.65 m).
//
// Fog: decorative atmospheric fog (not the gameplay gas): the exterior's analytic green height fog (exteriorFog) on every material
// here — node materials, the same on WebGPU and the WebGL2 fallback, plain uniforms only (no uniformArray; nothing near WebGPU's
// 12-uniform-buffer limit) — plus a few soft drifting fog wisps (billboards). The game's VolumetricAtmosphere is NOT used (it
// rebuilds its pipeline per scene / camera and latches `failed`). The shared exterior uniforms the menu re-tunes are restored by
// deactivate() before any level is built.
//
// Cost: ~30 draw calls (instancing everywhere: 5 train cars = 1 draw, 60 door leaves = 1, ~740 sleepers = 1, all rails / curbs /
// poles = 1 merged mesh, 18 wisps = 1, every glow = 1), unlit node materials (no lights, no shadows), a 30 fps frame cap and no
// rendering while the tab is hidden. Per frame only the camera and ~30 billboard matrices move.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {Fn, abs, attribute, cameraPosition, dot, exp, float, length, max, mix, normalView, normalWorld, output, positionGeometry, positionWorld, pow, smoothstep, texture, time, uv, vec2, vec3, vec4} from 'three/tsl';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {EXT_FOG, EXT_U, buildExterior, exteriorFog, exteriorFogTune, modelParts, planExterior, setExteriorFootprint, setExteriorRoof, type ExteriorFogTune, type ExteriorModels, type ExteriorView} from './exterior';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {ballast} from './canvasTextures';
import {wmNoise} from './surfaceNodes';
import {mulberry32} from '../core/rng';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** Tuning (metres, seconds, linear colours). */
export const MENU_SCENE = {
  seed: 0x51ab7a,
  /** The rail corridor (the exterior plan's "footprint": the city's ring road runs round it). */
  corridor: {x0: -120, x1: 120, z0: -8.5, z1: 8.5},
  /** Track centre lines (z) and the rail top (the train-local origin height). */
  tracks: [-2.2, 2.2] as const,
  railTop: 0.29,
  /** Sleeper pitch along the track (the station builder's 0.65 m). */
  sleeperPitch: 0.65,
  /** The player's train: track 0, three cars from x (lead car = the +X end, lit inside, head lamps on). */
  train: {track: 0, cars: 3, x: -16.2},
  /** The dead train: track 1, two cars, facing -X. */
  derelict: {track: 1, cars: 2, x: -54},
  /**
   * Orbit: an ellipse round the trains (centre, x / z radii +- swing) that never enters a car (its x ends stay >= 4 m past the
   * train ends, its z extent stays off the ring road's vehicle lanes), eye height (+- swing), angular speed (rad/s), start angle,
   * and the look-at point (over the lead half of the train).
   */
  orbit: {center: [0, 0, -1] as const, rx: 31, rxSwing: 2, rz: 10.6, rzSwing: 1.2, height: 4.1, heightSwing: 0.9, speed: 0.024, start: 0.9,
    target: [6, 1.8, -2.2] as const},
  fov: 46,
  near: 0.3,
  far: 620,
  /** Frame cap (the diorama moves slowly; menus need no more). */
  fps: 30,
  /** ACES exposure while the menu renders (the game's MOOD.exposure is restored after each menu frame). */
  exposure: 1.2,
  /** The menu's green fog (exterior uniforms; restored on deactivate). Lighter than the Office's murk so the train reads at ~25 m. */
  fog: {color: [0.055, 0.112, 0.046], base: 0.0045, ground: 0.017, height: 9, range: 135, noise: 0.45, drift: 0.55, skyline: 0.16,
    sun: [0.12, 0.13, 0.06], sky: [0.07, 0.1, 0.062], zenith: [0.045, 0.062, 0.04]} satisfies ExteriorFogTune,
  /** Fog wisps (billboards): count, size range (w, h), max opacity, distance band from the orbit centre. */
  wisps: {count: 18, w: [14, 26], h: [5, 9], opacity: 0.34, r: [8, 70]},
  /** The menu draws at most this many meshes (tests). */
  maxDrawCalls: 48,
} as const;

const TRAIN = PLAYER_TRAIN_SPEC;

/** The menu's loaded models (missing = that part is procedural / absent; the city falls back to its procedural blocks). */
export interface MenuSceneAssets {
  shell?: GLTF | null;
  door?: GLTF | null;
  exterior?: ExteriorModels;
}

/** One car of the diorama: centre x on a track, facing +X (yaw 0) or -X (PI), lit inside or not. */
export interface MenuCar { x: number; z: number; yaw: number; lit: boolean; lead: boolean }

/** The cars (pure; tests). */
export function menuCars(spec: PlayerTrainSpec = TRAIN): MenuCar[] {
  const L = spec.length, out: MenuCar[] = [];
  const t = MENU_SCENE.train, d = MENU_SCENE.derelict;
  for (let i = 0; i < t.cars; i++) out.push({x: t.x + i * L, z: MENU_SCENE.tracks[t.track], yaw: 0, lit: i === t.cars - 1, lead: i === t.cars - 1});
  for (let i = 0; i < d.cars; i++) out.push({x: d.x - i * L, z: MENU_SCENE.tracks[d.track], yaw: Math.PI, lit: false, lead: false});
  return out;
}

/** The camera pose at time t (s): a slow orbit with gentle radius / height swings (pure; tests). */
export function orbitPose(t: number): {pos: THREE.Vector3; target: THREE.Vector3} {
  const o = MENU_SCENE.orbit;
  const a = o.start + t * o.speed;
  const rx = o.rx + o.rxSwing * Math.sin(t * 0.041 + 1.3), rz = o.rz + o.rzSwing * Math.sin(t * 0.053 + 0.4);
  const h = o.height + o.heightSwing * Math.sin(t * 0.067);
  const [cx, , cz] = o.center, [tx, ty, tz] = o.target;
  const target = new THREE.Vector3(tx + 3 * Math.sin(t * 0.03), ty, tz);
  return {pos: new THREE.Vector3(cx + Math.cos(a) * rx, h, cz + Math.sin(a) * rz), target};
}

// ---------------------------------------------------------------------------------------------
// Materials (unlit: the exterior's fake outdoor light + its green fog)

const outdoorLight = (n: AnyNode): AnyNode => mix(EXT_U.ground, EXT_U.sky, n.y.mul(0.5).add(0.5)).add(EXT_U.sun.mul(max(dot(n, EXT_U.sunDir), 0)));

/** The Meshy model's base colour map, outdoor-lit and fogged (exterior.ts modelMaterial's treatment; the maps are the model's own). */
function modelMaterial(src: THREE.Material, gain = 1.15): MeshBasicNodeMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const tint = std.color ?? new THREE.Color(0xffffff);
  const albedo: AnyNode = std.map ? (texture(std.map, uv()).rgb as AnyNode).mul(vec3(tint.r, tint.g, tint.b)) : vec3(tint.r, tint.g, tint.b);
  const m = new MeshBasicNodeMaterial();
  m.name = 'menu-model';
  m.fog = false;
  m.colorNode = Fn(() => vec3(exteriorFog(albedo.mul(outdoorLight(normalWorld)).mul(gain))))();
  return m;
}

/** Vertex-coloured track / curb / pole boxes (with a little world-space grain), outdoor-lit and fogged. */
function trackMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'menu-track';
  m.fog = false;
  m.colorNode = Fn(() => {
    const c = attribute('color', 'vec3') as AnyNode;
    const grain = (wmNoise(positionWorld.mul(2.3)) as AnyNode).mul(0.35).add(0.82);
    // polished rail heads: the top faces of thin steel read lighter
    return vec3(exteriorFog(c.mul(grain).mul(outdoorLight(normalWorld)).mul(1.25)));
  })();
  return m;
}

/** The corridor's ballast bed: the station's procedural ballast canvas, world-mapped (2 m tiles). */
function ballastMaterial(tex: THREE.Texture): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'menu-ballast';
  m.fog = false;
  m.colorNode = Fn(() => {
    const b = (texture(tex, positionWorld.xz.div(2.2)).rgb as AnyNode);
    const patch = (wmNoise(vec3(positionWorld.x.div(9), 0.5, positionWorld.z.div(9))) as AnyNode).mul(0.4).add(0.75);
    return vec3(exteriorFog(b.mul(patch).mul(outdoorLight(vec3(0, 1, 0))).mul(1.2)));
  })();
  return m;
}

/** Car interiors seen through the windows: back faces of a box, brighter toward the ceiling; instance colour = warm (lit) / dark. */
function linerMaterial(spec: PlayerTrainSpec): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({side: THREE.BackSide});
  m.name = 'menu-car-interior';
  m.fog = false;
  m.colorNode = mix(float(0.32), float(1), smoothstep(spec.floorY + 0.1, spec.ceilingY, positionGeometry.y)) as AnyNode;
  // fog after the instance colour (NodeMaterial multiplies instanceColor into the diffuse colour)
  m.outputNode = vec4(exteriorFog((output as AnyNode).rgb), (output as AnyNode).a) as AnyNode;
  return m;
}

/** Additive glow sprites (lamps): radial falloff, attenuated by distance through the murk; instance colour = the glow colour. */
function glowMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide});
  m.name = 'menu-glow';
  m.fog = false;
  m.colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    const core = pow(max(float(1).sub(d), 0), 2.2);
    const dist = length(positionWorld.sub(cameraPosition));
    return vec3(core.mul(exp(dist.mul(-0.018))));
  })();
  return m;
}

/** Head-lamp beams: open cones, additive, soft toward the far end and at grazing views (no hard silhouette). */
function beamMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide});
  m.name = 'menu-beam';
  m.fog = false;
  m.colorNode = Fn(() => {
    const along = uv().y; // 1 at the lamp (cylinder top), 0 at the far end
    const facing = pow(abs(normalView.z), 1.6);
    const dist = length(positionWorld.sub(cameraPosition));
    return vec3(0.9, 0.84, 0.66).mul(pow(along, 1.7).mul(facing).mul(0.085).mul(exp(dist.mul(-0.012))));
  })();
  return m;
}

/** Fog wisps: soft drifting sheets of the fog colour (lifted), faded at the bottom edge, near the eye and by noise. */
function wispMaterial(maxOpacity: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide});
  m.name = 'menu-fog-wisp';
  m.fog = false;
  m.colorNode = Fn(() => (EXT_U.haze as AnyNode).mul(1.55).add(vec3(0.006, 0.012, 0.004)))();
  m.opacityNode = Fn(() => {
    const p = uv().sub(0.5).mul(vec2(2, 2));
    const ell = float(1).sub(smoothstep(0.35, 1, length(p)));
    const bottom = smoothstep(0.02, 0.42, uv().y);
    const drift = time.mul(0.35);
    const n = wmNoise(vec3(positionWorld.x.add(drift).div(7), positionWorld.y.div(4).sub(time.mul(0.03)), positionWorld.z.sub(drift.mul(0.6)).div(7))) as AnyNode;
    const near = smoothstep(4, 14, length(positionWorld.sub(cameraPosition)));
    return ell.mul(bottom).mul(smoothstep(0.25, 0.85, n)).mul(near).mul(maxOpacity);
  })();
  return m;
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

/** Accumulates axis-aligned boxes (non-indexed, normals + vertex colours) into one mesh. */
class BoxBatch {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rgb: readonly [number, number, number], yaw = 0): void {
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    if (yaw) g.rotateY(yaw);
    g.translate(cx, cy, cz);
    const p = g.attributes.position.array as Float32Array, n = g.attributes.normal.array as Float32Array;
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]); this.nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) this.col.push(rgb[0], rgb[1], rgb[2]);
    g.dispose();
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const STEEL = [0.24, 0.215, 0.19] as const, RUST = [0.2, 0.12, 0.075] as const, CONCRETE = [0.27, 0.26, 0.24] as const, TIMBER = [0.13, 0.1, 0.075] as const;
const POLE = [0.17, 0.17, 0.16] as const, COVER = [0.22, 0.2, 0.17] as const;

// ---------------------------------------------------------------------------------------------

interface Billboard { x: number; y: number; z: number; w: number; h: number; yawOnly: boolean }

export interface MenuSceneStats {
  /** Meshes that can draw (an InstancedMesh = 1 draw call). */
  meshes: number;
  instances: number;
  tris: number;
  /** Which parts came from the cooked models. */
  source: {train: 'model' | 'none'; leaves: 'model' | 'none'; heroes: boolean; props: boolean};
}

export class MenuScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(MENU_SCENE.fov, 16 / 9, MENU_SCENE.near, MENU_SCENE.far);
  readonly root = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly instanced: THREE.InstancedMesh[] = [];
  private exterior: ExteriorView;
  private wisps: {mesh: THREE.InstancedMesh; list: Billboard[]} | null = null;
  private glows: {mesh: THREE.InstancedMesh; list: Billboard[]} | null = null;
  private saved: Record<string, unknown> | null = null;
  private active = false;
  private disposed = false;
  private lastDraw = -Infinity;
  /** Frames drawn (QA / tests). */
  frames = 0;
  readonly source: MenuSceneStats['source'];

  constructor(assets: MenuSceneAssets = {}) {
    this.root.name = 'menu-diorama';
    this.scene.add(this.root, this.camera);
    this.scene.background = new THREE.Color().setRGB(...MENU_SCENE.fog.color);
    // the city: the exterior plan round the rail corridor (its ring road borders the tracks), outdoors only (no tower shell /
    // indoor fog part: the roof uniform sits far below the eye)
    this.activate();
    const C = MENU_SCENE.corridor;
    const plan = planExterior({foot: {x0: C.x0, z0: C.z0, x1: C.x1, z1: C.z1}, groundY: 0, eyeAbove: MENU_SCENE.orbit.height, seed: MENU_SCENE.seed});
    this.exterior = buildExterior(plan, assets.exterior ?? {});
    this.root.add(this.exterior.root);
    this.buildCorridor();
    const train = this.buildTrains(assets);
    this.buildWisps();
    this.source = {train: train.shell ? 'model' : 'none', leaves: train.leaves ? 'model' : 'none', heroes: this.exterior.used.heroes, props: this.exterior.used.props};
    for (const im of this.instanced) im.computeBoundingSphere();
    this.scene.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    this.pose(0, 16 / 9);
  }

  /** Apply the menu's look to the shared exterior uniforms (saved for deactivate). Idempotent. */
  activate(): void {
    if (this.active || this.disposed) return;
    this.saved = exteriorFogTune();
    exteriorFogTune({...MENU_SCENE.fog, color: [...MENU_SCENE.fog.color], sun: [...MENU_SCENE.fog.sun], sky: [...MENU_SCENE.fog.sky], zenith: [...MENU_SCENE.fog.zenith]});
    setExteriorRoof(-1e5); // the eye is "above the roof": outdoor fog only, no tower shell
    setExteriorFootprint(null);
    this.active = true;
  }

  /** Restore the shared exterior uniforms (before a level builds its own exterior). Idempotent. */
  deactivate(): void {
    if (!this.active) return;
    const s = this.saved as {color?: number[]; sun?: number[]; sky?: number[]; zenith?: number[]; base?: number; ground?: number; height?: number; range?: number; noise?: number; drift?: number; skyline?: number} | null;
    exteriorFogTune(s ? {
      color: s.color as [number, number, number], sun: s.sun as [number, number, number], sky: s.sky as [number, number, number], zenith: s.zenith as [number, number, number],
      base: s.base, ground: s.ground, height: s.height, range: s.range, noise: s.noise, drift: s.drift, skyline: s.skyline,
    } : {color: [...EXT_FOG.color], base: EXT_FOG.base, ground: EXT_FOG.ground, height: EXT_FOG.height, range: EXT_FOG.range, noise: EXT_FOG.noise, drift: EXT_FOG.drift, skyline: EXT_FOG.skyline});
    setExteriorRoof(null);
    setExteriorFootprint(null);
    this.active = false;
  }

  private own<T extends THREE.BufferGeometry>(g: T): T { this.geometries.push(g); return g; }
  private mat<T extends THREE.Material>(m: T): T { this.materials.push(m); return m; }

  private addInstanced(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    im.name = name;
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.instanced.push(im);
    this.root.add(im);
    return im;
  }

  /** Ballast bed, rails (running + third rail + coverboard), sleepers, corridor curbs, lamp posts, a signal. */
  private buildCorridor(): void {
    const C = MENU_SCENE.corridor, len = C.x1 - C.x0, cx = (C.x0 + C.x1) / 2;
    // ballast bed (fills the plan's cut-out footprint)
    const tex = ballast(MENU_SCENE.seed + 4);
    this.textures.push(tex);
    const bed = this.own(new THREE.PlaneGeometry(len, C.z1 - C.z0));
    bed.rotateX(-Math.PI / 2);
    bed.translate(cx, 0.02, (C.z0 + C.z1) / 2);
    const bm = new THREE.Mesh(bed, this.mat(ballastMaterial(tex)));
    bm.name = 'menu-ballast';
    this.root.add(bm);
    // rails / curbs / poles: one merged vertex-coloured mesh
    const b = new BoxBatch();
    const railY = MENU_SCENE.railTop - 0.075;
    for (const [i, tc] of MENU_SCENE.tracks.entries()) {
      for (const off of [-0.72, 0.72]) b.box(cx, railY, tc + off, len, 0.15, 0.07, STEEL);
      const side = i === 0 ? -1 : 1; // third rail on the outer side of each track
      b.box(cx, 0.3, tc + side * 1.4, len, 0.12, 0.08, RUST);
      b.box(cx, 0.46, tc + side * 1.4, len, 0.035, 0.32, COVER);
    }
    for (const z of [C.z0 + 0.25, C.z1 - 0.25]) b.box(cx, 0.45, z, len, 0.9, 0.4, CONCRETE);
    const rnd = mulberry32(MENU_SCENE.seed ^ 0x9e37);
    const glows: Billboard[] = [];
    const glowColors: THREE.Color[] = [];
    for (let x = C.x0 + 14, k = 0; x < C.x1 - 10; x += 34, k++) {
      const z = k % 2 ? C.z1 - 0.6 : C.z0 + 0.6, broken = rnd() < 0.3;
      const h = broken ? 2.4 + rnd() * 1.6 : 6.4;
      b.box(x, h / 2 + 0.9, z, 0.18, h, 0.18, POLE);
      if (!broken) {
        const dir = z > 0 ? -1 : 1;
        b.box(x, h + 0.85, z + dir * 0.75, 0.12, 0.12, 1.6, POLE);
        b.box(x, h + 0.72, z + dir * 1.45, 0.34, 0.16, 0.5, POLE);
        // two survivors still burn sodium-orange in the murk
        if (k % 3 === 1) { glows.push({x, y: h + 0.6, z: z + dir * 1.45, w: 2.6, h: 2.6, yawOnly: false}); glowColors.push(new THREE.Color(1.0, 0.55, 0.18).multiplyScalar(0.9)); }
      }
    }
    // a signal mast ahead of the lead car (red aspect)
    const sigX = MENU_SCENE.train.x + MENU_SCENE.train.cars * TRAIN.length + 6, sigZ = MENU_SCENE.tracks[0] - 2.1;
    b.box(sigX, 2.2, sigZ, 0.16, 4.4, 0.16, POLE);
    b.box(sigX, 4.1, sigZ, 0.36, 0.95, 0.28, [0.05, 0.05, 0.05]);
    glows.push({x: sigX + 0.15, y: 4.3, z: sigZ, w: 0.9, h: 0.9, yawOnly: false});
    glowColors.push(new THREE.Color(1, 0.08, 0.04).multiplyScalar(1.1));
    const merged = this.own(b.geometry());
    const tm = this.mat(trackMaterial());
    const mesh = new THREE.Mesh(merged, tm);
    mesh.name = 'menu-track-steel';
    this.root.add(mesh);
    // sleepers (instanced)
    const sg = new BoxBatch();
    sg.box(0, 0.07, 0, 0.24, 0.14, 2.5, TIMBER);
    const sleeperGeo = this.own(sg.geometry());
    const m4: THREE.Matrix4[] = [];
    for (const tc of MENU_SCENE.tracks) for (let x = C.x0 + 0.3; x < C.x1; x += MENU_SCENE.sleeperPitch) m4.push(new THREE.Matrix4().makeTranslation(x, 0, tc));
    this.addInstanced('menu-sleepers', sleeperGeo, tm, m4);
    this.pendingGlows = {list: glows, colors: glowColors};
  }

  private pendingGlows: {list: Billboard[]; colors: THREE.Color[]} = {list: [], colors: []};

  /** The trains: shell instances, door leaves, interiors, lamp glows and beams. */
  private buildTrains(assets: MenuSceneAssets): {shell: boolean; leaves: boolean} {
    const cars = menuCars();
    const carMat = (c: MenuCar) => new THREE.Matrix4().compose(new THREE.Vector3(c.x, MENU_SCENE.railTop, c.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw), new THREE.Vector3(1, 1, 1));
    let shell = false, leaves = false;
    if (assets.shell?.scene) {
      for (const part of modelParts(assets.shell)) {
        this.addInstanced('menu-train-shell', part.geometry, this.mat(modelMaterial(part.material)), cars.map(c => carMat(c).multiply(part.matrix)));
        shell = true;
      }
    }
    if (assets.door?.scene) {
      const scene = assets.door.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
      const DL = TRAIN.doorLeaf, lw = DL.width;
      const local: THREE.Matrix4[] = [];
      for (const d of TRAIN.doors) {
        const zc = d.side * (DL.outerZ - DL.thickness / 2);
        for (const k of [0, 1] as const) {
          // the closed pair meets at the opening centre (playerTrainView leafSpan at t = 0); the +X leaf turned 180 deg (both faces
          // alike) instead of mirrored, so one instanced draw keeps its winding
          const a = k === 0 ? d.x - lw : d.x, bx = k === 0 ? d.x : d.x + lw;
          const holder = new THREE.Matrix4().compose(new THREE.Vector3((a + bx) / 2, TRAIN.floorY + DL.height / 2, zc),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k === 1 ? Math.PI : 0),
            new THREE.Vector3(lw / Math.max(1e-3, sz.x), DL.height / Math.max(1e-3, sz.y), DL.thickness / Math.max(1e-3, sz.z)));
          local.push(holder.multiply(new THREE.Matrix4().makeTranslation(-ctr.x, -ctr.y, -ctr.z)));
        }
      }
      for (const part of modelParts(assets.door)) {
        const mats: THREE.Matrix4[] = [];
        for (const c of cars) for (const l of local) mats.push(carMat(c).multiply(l).multiply(part.matrix));
        this.addInstanced('menu-train-leaves', part.geometry, this.mat(modelMaterial(part.material, 1.05)), mats);
        leaves = true;
      }
    }
    // interiors (seen through the cut windows): warm in the lead car, dead elsewhere
    const I = TRAIN.interior;
    const liner = this.own(new THREE.BoxGeometry(I.x1 - I.x0, TRAIN.ceilingY - TRAIN.floorY, I.halfWidth * 2));
    liner.translate((I.x0 + I.x1) / 2, (TRAIN.floorY + TRAIN.ceilingY) / 2, 0);
    this.addInstanced('menu-train-interiors', liner, this.mat(linerMaterial(TRAIN)), cars.map(carMat),
      cars.map(c => (c.lit ? new THREE.Color(0.95, 0.74, 0.45).multiplyScalar(0.62) : new THREE.Color(0.028, 0.032, 0.027))));
    // lamps: head lamps of the lead car (+ beams), tail lamps of the last car of the player's train
    const glows = this.pendingGlows;
    const lead = cars.find(c => c.lead)!, tail = cars[0];
    const toWorld = (c: MenuCar, p: {x: number; y: number; z: number}) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(carMat(c));
    const beams: THREE.Matrix4[] = [];
    for (const h of TRAIN.lights.head) {
      const w = toWorld(lead, h);
      glows.list.push({x: w.x, y: w.y, z: w.z, w: 1.5, h: 1.5, yawOnly: false});
      glows.colors.push(new THREE.Color(1, 0.93, 0.76).multiplyScalar(1.25));
      // a 22 m cone along the car's +X (its narrow top at the lamp: +Y turned to -X, tipped a little down), widening to ~2.8 m
      const fx = Math.cos(lead.yaw), fz = -Math.sin(lead.yaw);
      beams.push(new THREE.Matrix4().compose(new THREE.Vector3(w.x + 11 * fx, w.y - 0.25, w.z + 11 * fz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, lead.yaw, Math.PI / 2 - 0.035)), new THREE.Vector3(1, 1, 1)));
    }
    for (const t of TRAIN.lights.tail) {
      const w = toWorld(tail, t);
      glows.list.push({x: w.x, y: w.y, z: w.z, w: 0.9, h: 0.9, yawOnly: false});
      glows.colors.push(new THREE.Color(1, 0.12, 0.06).multiplyScalar(0.9));
    }
    const cone = this.own(new THREE.CylinderGeometry(0.14, 2.8, 22, 18, 1, true));
    this.addInstanced('menu-head-beams', cone, this.mat(beamMaterial()), beams);
    const quad = this.own(new THREE.PlaneGeometry(1, 1));
    const gm = this.addInstanced('menu-glows', quad, this.mat(glowMaterial()), glows.list.map(() => new THREE.Matrix4()), glows.colors);
    gm.frustumCulled = false; // billboards move with the eye; few instances
    gm.renderOrder = 20;
    this.glows = {mesh: gm, list: glows.list};
    return {shell, leaves};
  }

  private buildWisps(): void {
    const W = MENU_SCENE.wisps, [cx, , cz] = MENU_SCENE.orbit.target;
    const rnd = mulberry32(MENU_SCENE.seed ^ 0x5157);
    const list: Billboard[] = [];
    for (let i = 0; i < W.count; i++) {
      const a = rnd() * Math.PI * 2, r = W.r[0] + rnd() * (W.r[1] - W.r[0]);
      const w = W.w[0] + rnd() * (W.w[1] - W.w[0]), h = W.h[0] + rnd() * (W.h[1] - W.h[0]);
      list.push({x: cx + Math.cos(a) * r * 1.4, y: h * 0.5 - 0.4, z: cz + Math.sin(a) * r * 0.8, w, h, yawOnly: true});
    }
    const quad = this.own(new THREE.PlaneGeometry(1, 1));
    const mesh = this.addInstanced('menu-fog-wisps', quad, this.mat(wispMaterial(W.opacity)), list.map(() => new THREE.Matrix4()));
    mesh.frustumCulled = false;
    mesh.renderOrder = 15;
    this.wisps = {mesh, list};
  }

  private readonly tmp = {m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), e: new THREE.Euler(), v2: new THREE.Vector2()};

  /** Face the billboards to the eye (wisps: about Y only). */
  private faceBillboards(): void {
    const {m, q, s, p, e} = this.tmp, cam = this.camera.position;
    for (const set of [this.wisps, this.glows]) {
      if (!set) continue;
      set.list.forEach((b, i) => {
        if (b.yawOnly) { e.set(0, Math.atan2(cam.x - b.x, cam.z - b.z), 0); q.setFromEuler(e); } else q.copy(this.camera.quaternion);
        set.mesh.setMatrixAt(i, m.compose(p.set(b.x, b.y, b.z), q, s.set(b.w, b.h, 1)));
      });
      set.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Camera + billboards for time t (s) and the viewport aspect. On a wide screen the projection is shifted so the train sits right
   * of the side menu (setViewOffset), not under it.
   */
  pose(t: number, aspect: number): void {
    const {pos, target} = orbitPose(t);
    const cam = this.camera;
    cam.position.copy(pos);
    cam.lookAt(target);
    cam.aspect = aspect;
    if (aspect > 1.15) { const W = 1000, H = W / aspect; cam.setViewOffset(W, H, -W * 0.17, 0, W, H); } else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.faceBillboards();
  }

  /**
   * One menu frame on `renderer` at rAF time `nowMs`: skipped (false) when the tab is hidden, the frame cap holds it, the scene is
   * disposed or the renderer cannot draw. Saves / restores the renderer state it touches (exposure, render target).
   */
  render(renderer: MenuRenderer, nowMs: number): boolean {
    if (this.disposed || !renderer.initialized) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (nowMs - this.lastDraw < 1000 / MENU_SCENE.fps - 2) return false;
    this.lastDraw = nowMs;
    this.activate();
    const size = renderer.getDrawingBufferSize(this.tmp.v2);
    this.pose(nowMs / 1000, size.y > 0 ? size.x / size.y : 16 / 9);
    const exposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = MENU_SCENE.exposure;
    try {
      renderer.info.reset();
      renderer.setRenderTarget(null);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.toneMappingExposure = exposure;
    }
    this.frames++;
    return true;
  }

  /** Prepare every pipeline before the diorama is shown (no cold compile on screen). */
  async compile(renderer: {compileAsync(scene: THREE.Object3D, camera: THREE.Camera): Promise<unknown>}): Promise<void> {
    this.activate();
    await renderer.compileAsync(this.scene, this.camera);
  }

  /** Mesh / instance / triangle counts (the draw-call budget; tests and QA). */
  stats(): MenuSceneStats {
    let meshes = 0, instances = 0, tris = 0;
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const g = m.geometry, n = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      meshes++;
      instances += n;
      tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * n;
    });
    return {meshes, instances, tris: Math.round(tris), source: this.source};
  }

  /** Release everything the diorama owns (never the shared model library / exterior material caches) and restore the shared uniforms. */
  dispose(): void {
    if (this.disposed) return;
    this.deactivate();
    this.disposed = true;
    this.scene.remove(this.root);
    for (const g of this.exterior.geometries) g.dispose();
    for (const im of this.exterior.instanced) im.dispose();
    for (const g of this.geometries) g.dispose();
    for (const im of this.instanced) im.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.length = this.materials.length = this.textures.length = this.instanced.length = 0;
  }

  get isDisposed(): boolean { return this.disposed; }
}

/** What MenuScene.render needs of the renderer (three's WebGPURenderer). */
export interface MenuRenderer {
  initialized: boolean;
  toneMappingExposure: number;
  info: {reset(): void};
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2;
  setRenderTarget(t: null): void;
  render(scene: THREE.Scene, camera: THREE.Camera): unknown;
}

/** The model-library keys of the train parts the menu shows. */
export const MENU_TRAIN_KEYS = {shell: TRAIN.models.shell.key, door: TRAIN.models.doorLeaf.key} as const;
