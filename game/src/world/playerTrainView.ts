// Task player-train-shell-20261101-202805 (lane TRAIN): the player's home train — what it LOOKS like, in the TRAIN-LOCAL frame
// (world/playerTrainSpec.ts: origin = car centre on the track centre line at rail-top height, +X = the front / cab end, +Y up,
// -Z = the platform side). Everything here is built ONCE per level build under one group; the runtime (world/playerTrain.ts) only
// sets that group's world pose (gen/playerTrain.ts placement), animates the door leaves along local X and switches lights. So a
// moving train later is a transform change of the root, not a rebuild.
//
//  - shell: the cooked Meshy exterior (player-train-shell.glb, door openings cut, in local metres) when loaded; else a plain
//    procedural skin (side panels with the door openings, roof, ends, skirt; untextured paint) so a missing model never leaves a
//    void or a sealed solid;
//  - interior: a hollow lining built from planes with FACE UVs in local coordinates (nothing is world-mapped, so nothing swims when
//    the car moves): ribbed floor, vented ceiling, side walls (one window bay per repeat, whole bays between the door openings),
//    end walls and the cab partition with an open doorway (the bulkhead art), door jambs / heads / thresholds closing the gap
//    between the lining and the outer skin; the static textures are the accepted Codex images (lane ASSETS' runtime JPEGs);
//    without them the lining keeps plain paint (never code-drawn art);
//  - cab: the cooked Meshy driving desk (player-train-console.glb) at spec.console;
//  - doors: per opening two sliding leaves (the cooked Meshy leaf, the second mirrored), fitted to half the opening each;
//  - light fixtures: emissive ceiling fittings at the interior mounts, head / tail lamp lenses (the casting lights are the
//    runtime's boot-time lights, world/playerTrain.ts).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {PlayerTrainSpec, TrainDoorSpec} from './playerTrainSpec';
import {cabGlassMaterial} from './elevator';

/** The accepted Codex interior textures (runtime JPEGs; null / missing = plain paint). */
export interface TrainTextures {
  wall?: THREE.Texture | null;
  floor?: THREE.Texture | null;
  ceiling?: THREE.Texture | null;
  bulkhead?: THREE.Texture | null;
}

/** The cooked Meshy models (missing = the procedural fallback for the shell / leaves; no console). */
export interface TrainModels {
  shell?: GLTF | null;
  door?: GLTF | null;
  console?: GLTF | null;
  /** Task train-lockbox: the cooked Lockbox (world/trainLockbox.ts builds it; missing = its placeholder). */
  lockbox?: GLTF | null;
}

/** Thicknesses / tiling (m). */
export const TRAIN_VIEW = {
  /** An open leaf's closing edge clears the jamb by this. */
  leafClear: 0.01,
  /** Glass panes sit this far inside the cut skin plane (task train-shell-followup). */
  glassInset: 0.004,
  /** Task train-window-fit: the lining's dark outer face stands this far behind it (m). */
  backingGap: 0.004,
  /** Task train-lockbox: the pocket-end stop post (x thickness) behind a window over the rear door's leaf pocket, and its gap to the
   *  parked leaf's -X edge (m). */
  pocketStop: 0.02,
  pocketStopGap: 0.007,
  /** The jambs / heads / thresholds reach this far past the leaf's outer face (the shell's recess walls cover from ~outerZ + 0.02). */
  jambPast: 0.03,
  /** Cab partition thickness. */
  partition: 0.06,
  /** Floor / ceiling tile sizes (m per texture repeat). */
  floorTile: 1.25,
  /** Short wall pieces (< this x the wall height) take the plain seam strip of the bay instead of a squeezed window. */
  shortBay: 0.5,
  /** Fixture box (x, y, z) and the head / tail lens radius. */
  fixture: [1.1, 0.04, 0.22] as const,
  lens: 0.07,
} as const;

/**
 * Task train-lockbox-windows-20261101-232156: where the wall bay art (the accepted Codex train-int-wall texture) paints its window
 * GLASS, in texture coordinates (measured on the 1024 px image: the dark glass inside the rubber gasket at px x 118..903, y 170..556).
 * A newly cut side window gets the bay laid so this rect lands exactly on its hole: the painted gasket frames the real opening.
 */
export const WALL_ART_GLASS = {u0: 0.115, u1: 0.882, v0: 0.457, v1: 0.834} as const;

/**
 * Task train-lockbox-windows-20261101-232156: the nose corner windows (zone 'nose') wrap each corner end window round the rounded nose.
 * The side pane at |z| = skinZ closes the strip of the side hole BEHIND the end pane's plane (from the nose rect's inner x edge to the
 * end pane at skinX), beside the end window's sleeve: the corner reads as one recessed wraparound window and the sleeve's inside is
 * never seen bare from the side.
 */
export function noseCorners(spec: PlayerTrainSpec, e: TrainWindows['end'][number]): TrainWindows['side'][number][] {
  return windowsOf(spec).side.filter(n => n.zone === 'nose' && Math.sign(n.x0 + n.x1) === e.end
    && (n.side < 0 ? Math.abs(e.z0 + n.skinZ) < 0.02 : Math.abs(e.z1 - n.skinZ) < 0.02));
}
/** The side pane rect (x0 < x1, y0 < y1) of nose corner n joined to end window e. */
export function nosePane(e: TrainWindows['end'][number], n: TrainWindows['side'][number]): {x0: number; x1: number; y0: number; y1: number} {
  const inner = e.end > 0 ? n.x0 : n.x1, pane = e.end * e.skinX;
  return {x0: Math.min(inner, pane), x1: Math.max(inner, pane), y0: Math.max(n.y0, e.y0), y1: Math.min(n.y1, e.y1)};
}

/** The spec's head / tail mounts sit this far in front of the modelled lamp lenses (lane ASSETS). */
const LENS_AHEAD = 0.05;

/**
 * Leaf `k` (0 = toward -X, 1 = toward +X) of a door at open fraction t: its local x span. Closed, the pair meets at the opening
 * centre (each leaf `leafW` wide, overlapping its jamb); open, each slid by half the opening (+ leafClear) into its wall pocket.
 * Shared by the view and the collision.
 */
export function leafSpan(door: TrainDoorSpec, k: 0 | 1, t: number, leafW: number): [number, number] {
  const shift = Math.max(0, Math.min(1, t)) * (door.width / 2 + TRAIN_VIEW.leafClear);
  return k === 0 ? [door.x - leafW - shift, door.x - shift] : [door.x + shift, door.x + leafW + shift];
}

/** Side walls' outer half width (the widest skin point) — the wall boxes span halfWidth .. outer. */
export const outerHalf = (spec: PlayerTrainSpec): number => spec.width / 2;
/** The jambs' outer reach (past the leaves' outer face, into the shell's door recess). */
export const jambOut = (spec: PlayerTrainSpec): number => Math.min(outerHalf(spec), spec.doorLeaf.outerZ + TRAIN_VIEW.jambPast);

export interface TrainView {
  /** The train-local root: the runtime sets its position / rotation from the placement. */
  root: THREE.Group;
  /** Every static part (culler-registered, shadow-marked as structure). */
  fixed: THREE.Group;
  /** Door leaves per spec door: [toward -X, toward +X] (moved along local X by the runtime). */
  leaves: THREE.Object3D[][];
  /** Geometries this view created (disposed with it; model geometry belongs to the model library). */
  geometries: THREE.BufferGeometry[];
  /** Which parts came from the cooked models. */
  source: {shell: 'model' | 'procedural'; door: 'model' | 'procedural'; console: 'model' | 'none'; textures: number};
  /**
   * Task train-shell-followup: the glass of every leaf window as ONE instanced mesh (both faces, so a mirrored leaf needs no flipped
   * pipeline: one draw for all twelve panes), instance i = slots[i]'s leaf; null without a leaf window / leaf model.
   */
  leafGlass: {mesh: THREE.InstancedMesh; slots: {door: number; k: 0 | 1; holder: THREE.Object3D; inner: THREE.Object3D}[]} | null;
  /** Re-fit the leaf-window glass instances to the leaves' current positions (call after moving the leaves). */
  syncLeafGlass(): void;
}

// ---------------------------------------------------------------------------------------------
// Materials: created once per runtime (MaterialCache) and kept across level builds, so the next level's warm-up reuses the same
// programs (three frees a pipeline with its last user).

type MatKey = 'wall' | 'floor' | 'ceiling' | 'bulkhead' | 'metal' | 'rubber' | 'paint' | 'skirt' | 'roof' | 'fixture' | 'head' | 'tail' | 'leaf' | 'desk' | 'liner' | 'lockbox';

export class TrainMaterials {
  private readonly cache = new Map<string, THREE.Material>();

  get(key: MatKey, tex?: THREE.Texture | null): THREE.Material {
    const id = `${key}:${tex ? tex.uuid : '-'}`;
    let m = this.cache.get(id);
    if (!m) { m = makeMaterial(key, tex ?? null); m.name = `player-train-${key}`; this.cache.set(id, m); }
    return m;
  }

  get size(): number { return this.cache.size; }

  /**
   * Task train-shell-followup-20261101-221246: the window glass — the moving glass lift's clear glass (world/elevator.ts
   * cabGlassMaterial: transparent, depthWrite off, both faces, a little fresnel, no world mapping, so nothing swims when the car moves;
   * never a shadow caster). Shared, never disposed here.
   */
  glass(): THREE.Material { return cabGlassMaterial(); }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

function makeMaterial(key: MatKey, tex: THREE.Texture | null): THREE.Material {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  switch (key) {
    // the Codex lining art; without it a plain paint of the same tone (no drawn substitute)
    case 'wall': return std({map: tex, color: tex ? 0xffffff : 0xb9b4a6, roughness: 0.82, metalness: 0.08});
    case 'bulkhead': return std({map: tex, color: tex ? 0xffffff : 0xb3ae9f, roughness: 0.82, metalness: 0.08});
    case 'floor': return std({map: tex, color: tex ? 0xffffff : 0x34332f, roughness: 0.95, metalness: 0});
    case 'ceiling': return std({map: tex, color: tex ? 0xffffff : 0xa19f98, roughness: 0.88, metalness: 0.05});
    case 'metal': return std({color: 0x5d5f5c, roughness: 0.62, metalness: 0.55});
    case 'rubber': return std({color: 0x1d1d1c, roughness: 0.95, metalness: 0});
    case 'paint': return std({color: 0x6e3b2c, roughness: 0.78, metalness: 0.25}); // fallback skin: oxide-red paint
    case 'skirt': return std({color: 0x2a2724, roughness: 0.9, metalness: 0.3});
    case 'roof': return std({color: 0x4d4943, roughness: 0.85, metalness: 0.3});
    case 'leaf': return std({color: 0x707a7a, roughness: 0.6, metalness: 0.45}); // fallback leaf
    case 'desk': return std({color: 0x3c4a46, roughness: 0.7, metalness: 0.35}); // fallback console
    // task train-lockbox (lane TRAIN): the Lockbox's dark untextured cavity liner and its placeholder paint (until the cooked model)
    case 'liner': return std({color: 0x17150f, roughness: 0.95, metalness: 0.1});
    case 'lockbox': return std({color: 0x3f4a3a, roughness: 0.7, metalness: 0.4});
    case 'fixture': return std({color: 0xf1e3c4, emissive: 0xffd9a0, emissiveIntensity: 1.4, roughness: 0.5, metalness: 0});
    case 'head': return std({color: 0xfff6e0, emissive: 0xfff1d6, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0});
    case 'tail': return std({color: 0x8a120c, emissive: 0xff2414, emissiveIntensity: 1.8, roughness: 0.4, metalness: 0});
  }
}

// ---------------------------------------------------------------------------------------------
// Face-UV quads

type V3 = readonly [number, number, number];

/** Accumulates quads (positions / normals / uvs / indices) for one material. */
class QuadSet {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly idx: number[] = [];

  /** Quad a-b-c-d (counter-clockwise seen from the front, normal n) with uvs per corner. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, ua: readonly [number, number], ub: readonly [number, number], uc: readonly [number, number], ud: readonly [number, number]): void {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) this.nor.push(n[0], n[1], n[2]);
    for (const t of [ua, ub, uc, ud]) this.uv.push(t[0], t[1]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** Axis-aligned box (all six faces, uvs in metres / `tile`). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tile = 1): void {
    const u = (a: number) => a / tile;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [u(x0), u(y0)], [u(x1), u(y0)], [u(x1), u(y1)], [u(x0), u(y1)]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [u(x1), u(y0)], [u(x0), u(y0)], [u(x0), u(y1)], [u(x1), u(y1)]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [u(z1), u(y0)], [u(z0), u(y0)], [u(z0), u(y1)], [u(z1), u(y1)]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [u(z0), u(y0)], [u(z1), u(y0)], [u(z1), u(y1)], [u(z0), u(y1)]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [u(x0), u(z1)], [u(x1), u(z1)], [u(x1), u(z0)], [u(x0), u(z0)]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [u(x0), u(z0)], [u(x1), u(z0)], [u(x1), u(z1)], [u(x0), u(z1)]);
  }

  get empty(): boolean { return this.idx.length === 0; }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** [lo, hi] minus the door openings of one side (ascending spans; open intervals cut). */
export function wallSpans(lo: number, hi: number, cuts: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  let a = lo;
  for (const [c0, c1] of [...cuts].sort((p, q) => p[0] - q[0])) {
    if (c1 <= a || c0 >= hi) continue;
    if (c0 > a + 1e-4) out.push([a, Math.min(c0, hi)]);
    a = Math.max(a, c1);
  }
  if (hi > a + 1e-4) out.push([a, hi]);
  return out;
}

/**
 * The partitions with an open doorway: the cab's (at cab.x0) and, task train-shell-followup-20261101-221246, the rear compartment's
 * (at rear.x1, no console). Shared by the view and the collision.
 */
export function partitionsOf(spec: PlayerTrainSpec): {x: number; doorway: {z0: number; z1: number; height: number}; end: 1 | -1}[] {
  const out: {x: number; doorway: {z0: number; z1: number; height: number}; end: 1 | -1}[] = [{x: spec.cab.x0, doorway: spec.cab.doorway, end: 1}];
  if (spec.rear) out.push({x: spec.rear.x1, doorway: spec.rear.doorway, end: -1});
  return out;
}

/**
 * Task train-shell-followup-20261101-221246: the see-through windows lane ASSETS cut out of the cooked shell / door leaf (spec.windows,
 * train-local; the leaf rect in the leaf GLB's own frame). Rects are the inner-most opening in their projection.
 */
export interface TrainWindows {
  side: readonly {side: -1 | 1; zone?: string; x0: number; x1: number; y0: number; y1: number; skinZ: number; pocket?: {x0: number; x1: number}}[];
  end: readonly {end: -1 | 1; z0: number; z1: number; y0: number; y1: number; skinX: number}[];
  leaf: {x0: number; x1: number; y0: number; y1: number} | null;
}
/** The spec's window cut-outs (none until the shell / leaf carry them). */
export function windowsOf(spec: PlayerTrainSpec): TrainWindows {
  const w = (spec as {windows?: Partial<TrainWindows> | null}).windows;
  return {side: w?.side ?? [], end: w?.end ?? [], leaf: w?.leaf ?? null};
}

/** The end-wall cut-outs (z0, z1, y0, y1) of the windows cut through the end at `end` (+1 = the front / cab, -1 = the rear). */
export function endHoles(spec: PlayerTrainSpec, end: 1 | -1): [number, number, number, number][] {
  return windowsOf(spec).end.filter(w => w.end === end).map(w => [w.z0, w.z1, w.y0, w.y1] as [number, number, number, number]);
}

/** [a0, a1] x [b0, b1] minus axis-aligned holes (a0, a1, b0, b1; clipped to the rect) as disjoint rects (column decomposition). */
export function rectMinusHoles(a0: number, a1: number, b0: number, b1: number, holes: readonly (readonly [number, number, number, number])[]): [number, number, number, number][] {
  const hs = holes.map(h => [Math.max(a0, h[0]), Math.min(a1, h[1]), Math.max(b0, h[2]), Math.min(b1, h[3])] as const).filter(h => h[1] - h[0] > 1e-4 && h[3] - h[2] > 1e-4);
  if (!hs.length) return [[a0, a1, b0, b1]];
  const cuts = [...new Set([a0, a1, ...hs.flatMap(h => [h[0], h[1]])])].sort((p, q) => p - q);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const c0 = cuts[i], c1 = cuts[i + 1];
    if (c1 - c0 < 1e-4) continue;
    const mid = (c0 + c1) / 2;
    const over = hs.filter(h => h[0] < mid && h[1] > mid).map(h => [h[2], h[3]] as [number, number]).sort((p, q) => p[0] - q[0]);
    let b = b0;
    for (const [h0, h1] of over) { if (h0 > b + 1e-4) out.push([c0, c1, b, h0]); b = Math.max(b, h1); }
    if (b1 > b + 1e-4) out.push([c0, c1, b, b1]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** Task train-window-fit: back faces of a lining QuadSet's quads (reversed, pushed TRAIN_VIEW.backingGap out along the -normal);
 *  `keep(centreX)` selects which quads get one. */
function backFaces(out: QuadSet, src: QuadSet, keep: (cx: number) => boolean): void {
  const P = src.pos, N = src.nor, g = TRAIN_VIEW.backingGap;
  for (let q = 0; q < P.length / 12; q++) {
    const o = q * 12, n: V3 = [-N[o], -N[o + 1], -N[o + 2]];
    const v = (k: number): V3 => [P[o + k * 3] + n[0] * g, P[o + k * 3 + 1] + n[1] * g, P[o + k * 3 + 2] + n[2] * g];
    const cx = (P[o] + P[o + 3] + P[o + 6] + P[o + 9]) / 4;
    if (!keep(cx)) continue;
    out.quad(v(0), v(3), v(2), v(1), n, [0, 0], [0, 1], [1, 1], [1, 0]);
  }
}

/**
 * Builds the train in its local frame. `mats` is the runtime's long-lived material cache; `models` / `textures` whatever is
 * loaded (any may be missing). Pure three.js: no scene, no world pose.
 */
export function buildTrainView(spec: PlayerTrainSpec, mats: TrainMaterials, models: TrainModels = {}, textures: TrainTextures = {}): TrainView {
  const root = new THREE.Group();
  root.name = 'player-train';
  const fixed = new THREE.Group();
  fixed.name = 'player-train-fixed';
  root.add(fixed);
  const doorsGroup = new THREE.Group();
  doorsGroup.name = 'player-train-doors';
  root.add(doorsGroup);
  const geometries: THREE.BufferGeometry[] = [];
  const add = (q: QuadSet, mat: THREE.Material, name: string): void => {
    if (q.empty) return;
    const g = q.geometry();
    geometries.push(g);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    fixed.add(m);
  };
  const hw = spec.interior.halfWidth, out = outerHalf(spec), f = spec.floorY, c = spec.ceilingY, H = c - f;
  const ix0 = spec.interior.x0, ix1 = spec.interior.x1, L2 = spec.length / 2;
  const tex = textures;
  const win = windowsOf(spec);
  const nTex = [tex.wall, tex.floor, tex.ceiling, tex.bulkhead].filter(Boolean).length;
  const cutsOf = (side: -1 | 1) => spec.doors.filter(d => d.side === side).map(d => [d.x - d.width / 2, d.x + d.width / 2] as const);

  // --- floor / ceiling -------------------------------------------------------------------------
  const floor = new QuadSet(), ceil = new QuadSet();
  const ft = TRAIN_VIEW.floorTile, ct = hw;
  floor.quad([ix0, f, hw], [ix1, f, hw], [ix1, f, -hw], [ix0, f, -hw], [0, 1, 0], [ix0 / ft, hw / ft], [ix1 / ft, hw / ft], [ix1 / ft, -hw / ft], [ix0 / ft, -hw / ft]);
  ceil.quad([ix0, c, -hw], [ix1, c, -hw], [ix1, c, hw], [ix0, c, hw], [0, -1, 0], [ix0 / ct, 0], [ix1 / ct, 0], [ix1 / ct, 2], [ix0 / ct, 2]);
  add(floor, mats.get('floor', tex.floor), 'train-floor');
  add(ceil, mats.get('ceiling', tex.ceiling), 'train-ceiling');

  // --- side walls: whole window bays between the openings, plain seam strips on short pieces / door heads -----------------------
  const wall = new QuadSet();
  const seam = TRAIN_VIEW.shortBay;
  for (const side of [-1, 1] as const) {
    const z = side * hw, n: V3 = [0, 0, -side];
    // u runs to the viewer's right: +X on the -Z wall (seen facing -Z), -X on the +Z wall; uOf / vOf give a corner's texture
    // coordinates (task train-lockbox: one continuous mapping per span, also across window holes on the +Z wall)
    const piece = (a: number, b: number, y0: number, y1: number, uOf: (x: number) => number, vOf: (y: number) => number) => {
      const v0 = vOf(y0), v1 = vOf(y1);
      if (side < 0) wall.quad([a, y0, z], [b, y0, z], [b, y1, z], [a, y1, z], n, [uOf(a), v0], [uOf(b), v0], [uOf(b), v1], [uOf(a), v1]);
      else wall.quad([b, y0, z], [a, y0, z], [a, y1, z], [b, y1, z], n, [uOf(b), v0], [uOf(a), v0], [uOf(a), v1], [uOf(b), v1]);
    };
    const vWall = (y: number) => (y - f) / H;
    /** u growing to the viewer's right over [a, b], from ua at the viewer's left edge to ub at the right. */
    const uSpan = (a: number, b: number, ua: number, ub: number) => (x: number) => ua + ((side < 0 ? x - a : b - x) / (b - a)) * (ub - ua);
    const seamU = (len: number): [number, number] => { const w = Math.min(0.24, len / H) / 2; return [-w, w]; };
    // (task train-shell-followup) the see-through side windows cut out of this side's lining (their sleeves / glass below)
    const wins = win.side.filter(w => w.side === side);
    const holes = wins.map(w => [w.x0, w.x1, w.y0, w.y1] as [number, number, number, number]);
    for (const [a, b] of wallSpans(ix0, ix1, cutsOf(side))) {
      const inSpan = wins.filter(w => w.x1 > a && w.x0 < b);
      const len = b - a;
      if (!inSpan.length || inSpan.every(w => (w.zone ?? 'cab') === 'cab')) {
        // the accepted bay mapping (whole window bays / a plain seam strip), kept across the cab's window holes
        const nb = Math.round(len / H);
        const [ua, ub] = nb >= 1 && len >= seam * H ? [0, nb] : seamU(len);
        const uOf = uSpan(a, b, ua, ub);
        for (const [x0, x1, y0, y1] of rectMinusHoles(a, b, f, c, holes)) piece(x0, x1, y0, y1, uOf, vWall);
        continue;
      }
      // task train-lockbox-windows: a span with newly cut windows — one wall bay per window, the bay art's painted glass laid exactly
      // over the real hole (so its painted gasket frames it), plain panel between the bays (the bay art's seam strip)
      const sorted = [...inSpan].sort((p, q) => p.x0 - q.x0);
      sorted.forEach((w, i) => {
        const ba = i === 0 ? a : (sorted[i - 1].x1 + w.x0) / 2, bb = i === sorted.length - 1 ? b : (w.x1 + sorted[i + 1].x0) / 2;
        const su = (WALL_ART_GLASS.u1 - WALL_ART_GLASS.u0) / (w.x1 - w.x0), sv = (WALL_ART_GLASS.v1 - WALL_ART_GLASS.v0) / (w.y1 - w.y0);
        // u at x: the painted glass's left / right edges (as seen from inside) on the hole's left / right edges
        const uOf = (x: number) => WALL_ART_GLASS.u0 + (side < 0 ? x - w.x0 : w.x1 - x) * su;
        const vOf = (y: number) => WALL_ART_GLASS.v0 + (y - w.y0) * sv;
        // the art tile (u 0..1) in x, clipped to the bay; the bay's rest is the plain seam strip on the same v (the trims line up)
        const t0 = side < 0 ? w.x0 - WALL_ART_GLASS.u0 / su : w.x1 - (1 - WALL_ART_GLASS.u0) / su;
        const t1 = side < 0 ? w.x0 + (1 - WALL_ART_GLASS.u0) / su : w.x1 + WALL_ART_GLASS.u0 / su;
        const ta = Math.max(ba, t0), tb = Math.min(bb, t1);
        for (const [x0, x1, y0, y1] of rectMinusHoles(ta, tb, f, c, holes)) piece(x0, x1, y0, y1, uOf, vOf);
        for (const [pa, pb] of [[ba, ta], [tb, bb]] as const) {
          if (pb - pa < 1e-3) continue;
          const [s0, s1] = seamU(pb - pa);
          piece(pa, pb, f, c, uSpan(pa, pb, s0, s1), vOf);
        }
      });
    }
    for (const d of spec.doors.filter(q => q.side === side)) {
      const a = d.x - d.width / 2, b = d.x + d.width / 2, top = Math.min(c, f + d.height);
      if (c - top > 1e-3) { const [s0, s1] = seamU(b - a); piece(a, b, top, c, uSpan(a, b, s0, s1), vWall); }
    }
  }
  add(wall, mats.get('wall', tex.wall), 'train-walls');

  // --- end walls + cab partition (the bulkhead art; the partition's open doorway cut where its painted door is) ---------------
  const bulk = new QuadSet(), pt = TRAIN_VIEW.partition / 2;
  const uZ = (z: number, facingPlusX: boolean) => (facingPlusX ? (hw - z) : (z + hw)) / (2 * hw); // u to the viewer's right
  const endWall = (x: number, facingPlusX: boolean, z0: number, z1: number, y0: number, y1: number) => {
    const n: V3 = [facingPlusX ? 1 : -1, 0, 0], v0 = (y0 - f) / H, v1 = (y1 - f) / H;
    if (facingPlusX) bulk.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1], n, [uZ(z1, true), v0], [uZ(z0, true), v0], [uZ(z0, true), v1], [uZ(z1, true), v1]);
    else bulk.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], n, [uZ(z0, false), v0], [uZ(z1, false), v0], [uZ(z1, false), v1], [uZ(z0, false), v1]);
  };
  // end walls with the end windows' cut-outs (their frames: the window sleeves below)
  for (const r of rectMinusHoles(-hw, hw, f, c, endHoles(spec, -1))) endWall(ix0, true, r[0], r[1], r[2], r[3]); // the rear wall (a closed gangway door painted on it)
  for (const r of rectMinusHoles(-hw, hw, f, c, endHoles(spec, 1))) endWall(ix1, false, r[0], r[1], r[2], r[3]); // the cab's front wall
  // the partitions: the cab's and (task train-shell-followup) the rear compartment's, both with the open doorway
  for (const {x: px, doorway: dw} of partitionsOf(spec)) {
    const doorTop = Math.min(c, f + dw.height);
    for (const [x, plusX] of [[px - pt, false], [px + pt, true]] as const) {
      endWall(x, plusX, -hw, dw.z0, f, c);
      endWall(x, plusX, dw.z1, hw, f, c);
      if (c - doorTop > 1e-3) endWall(x, plusX, dw.z0, dw.z1, doorTop, c);
    }
  }
  add(bulk, mats.get('bulkhead', tex.bulkhead), 'train-bulkheads');

  // task train-window-fit: the lining's OUTER face — a dark backing a few mm behind the side walls, the end walls and the ceiling
  // (the same window holes), facing the void between the lining and the skin. A wall has two faces: without it the void side showed
  // the culled back of the lining, i.e. straight into the lit car through any crack in the cooked shell (a bright seam line).
  const backing = new QuadSet();
  backFaces(backing, wall, () => true);
  backFaces(backing, bulk, (cx) => Math.abs(Math.abs(cx) - ix1) < 1e-4 || Math.abs(cx - ix0) < 1e-4); // the end walls, not the partitions
  backFaces(backing, ceil, () => true);
  add(backing, mats.get('liner'), 'train-lining-backing');

  // --- metal trim: door jambs / heads / thresholds through the wall, the partition doorway reveals, kick strip ------------------
  const metal = new QuadSet(), rubber = new QuadSet();
  const jo = jambOut(spec);
  for (const d of spec.doors) {
    const s = d.side, a = d.x - d.width / 2, b = d.x + d.width / 2, top = f + d.height;
    const zi = s * hw, zo = s * jo, zl = Math.min(zi, zo), zh = Math.max(zi, zo);
    // jambs facing into the opening
    metal.quad([a, f, zh], [a, f, zl], [a, top, zl], [a, top, zh], [1, 0, 0], [zh, 0], [zl, 0], [zl, d.height], [zh, d.height]);
    metal.quad([b, f, zl], [b, f, zh], [b, top, zh], [b, top, zl], [-1, 0, 0], [zl, 0], [zh, 0], [zh, d.height], [zl, d.height]);
    // head (facing down) and the threshold plate (facing up, flush with the floor)
    metal.quad([a, top, zl], [b, top, zl], [b, top, zh], [a, top, zh], [0, -1, 0], [a, zl], [b, zl], [b, zh], [a, zh]);
    rubber.quad([a, f + 0.004, zh], [b, f + 0.004, zh], [b, f + 0.004, zl], [a, f + 0.004, zl], [0, 1, 0], [a, zh], [b, zh], [b, zl], [a, zl]);
  }
  // partition doorway reveals (both jambs + head across the partition thickness)
  for (const {x: px, doorway: dw} of partitionsOf(spec)) {
    const x0 = px - pt, x1 = px + pt, doorTop = Math.min(c, f + dw.height);
    metal.quad([x0, f, dw.z0], [x1, f, dw.z0], [x1, doorTop, dw.z0], [x0, doorTop, dw.z0], [0, 0, 1], [x0, 0], [x1, 0], [x1, 1], [x0, 1]);
    metal.quad([x1, f, dw.z1], [x0, f, dw.z1], [x0, doorTop, dw.z1], [x1, doorTop, dw.z1], [0, 0, -1], [x1, 0], [x0, 0], [x0, 1], [x1, 1]);
    metal.quad([x0, doorTop, dw.z0], [x1, doorTop, dw.z0], [x1, doorTop, dw.z1], [x0, doorTop, dw.z1], [0, -1, 0], [x0, 0], [x1, 0], [x1, 1], [x0, 1]);
  }
  // (task train-shell-followup) window sleeves: frames closing the void between the lining and the cut skin, around every window
  const glass = new QuadSet();
  const leafSpec = spec.doorLeaf;
  /** Signed z range (s * a .. s * b, ascending) of the |z| interval [a, b] on side s. */
  const zr = (s: -1 | 1, a: number, b: number): [number, number] => [Math.min(s * a, s * b), Math.max(s * a, s * b)];
  for (const w of win.side) {
    const s = w.side;
    if (w.zone === 'nose') continue; // (task train-lockbox) the nose corner panes are built with their end window below
    // task train-lockbox: a rear-compartment window over the rear door's leaf pocket is a pocket door seen through glass — no sleeve
    // face crosses the leaf's slot (|z| of the leaf's faces + 5 mm) inside the pocket span, a slim stop post at the parked leaf's -X end
    const slot = w.pocket ? {x0: w.pocket.x0 - 0.005, x1: w.pocket.x1 + 0.005, a: leafSpec.outerZ - leafSpec.thickness - 0.005, b: leafSpec.outerZ + 0.005} : null;
    const zParts = (x: number): [number, number][] => {
      const parts: [number, number][] = !slot || x <= slot.x0 || x >= slot.x1 ? [[hw, w.skinZ]] : [[hw, slot.a], [slot.b, w.skinZ]];
      return parts.filter(([a, b]) => b - a > 0.008);
    };
    if (w.skinZ - hw > 1e-3) {
      for (const [a, b] of zParts(w.x0)) {
        const [zl, zh] = zr(s, a, b);
        metal.quad([w.x0, w.y0, zh], [w.x0, w.y0, zl], [w.x0, w.y1, zl], [w.x0, w.y1, zh], [1, 0, 0], [zh, w.y0], [zl, w.y0], [zl, w.y1], [zh, w.y1]);
      }
      for (const [a, b] of zParts(w.x1)) {
        const [zl, zh] = zr(s, a, b);
        metal.quad([w.x1, w.y0, zl], [w.x1, w.y0, zh], [w.x1, w.y1, zh], [w.x1, w.y1, zl], [-1, 0, 0], [zl, w.y0], [zh, w.y0], [zh, w.y1], [zl, w.y1]);
      }
      // head / sill, split where the slot starts / ends along the window
      const xs = [w.x0, ...(slot ? [slot.x0, slot.x1].filter(x => x > w.x0 && x < w.x1) : []), w.x1];
      for (let i = 0; i + 1 < xs.length; i++) {
        const xa = xs[i], xb = xs[i + 1];
        for (const [a, b] of zParts((xa + xb) / 2)) {
          const [zl, zh] = zr(s, a, b);
          metal.quad([xa, w.y1, zl], [xb, w.y1, zl], [xb, w.y1, zh], [xa, w.y1, zh], [0, -1, 0], [xa, zl], [xb, zl], [xb, zh], [xa, zh]);
          metal.quad([xa, w.y0, zh], [xb, w.y0, zh], [xb, w.y0, zl], [xa, w.y0, zl], [0, 1, 0], [xa, zh], [xb, zh], [xb, zl], [xa, zl]);
        }
      }
    }
    if (w.pocket && w.pocket.x0 > w.x0 && w.pocket.x0 < w.x1) {
      const [zl, zh] = zr(s, hw, w.skinZ), px1 = w.pocket.x0 - TRAIN_VIEW.pocketStopGap;
      metal.box(px1 - TRAIN_VIEW.pocketStop, w.y0, zl, px1, w.y1, zh); // the parked leaf's -X edge rests against it
    }
    const zg = s * (w.skinZ - TRAIN_VIEW.glassInset);
    glass.quad([w.x0, w.y0, zg], [w.x1, w.y0, zg], [w.x1, w.y1, zg], [w.x0, w.y1, zg], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  for (const w of win.end) {
    const e = w.end, xl = Math.min(e * (e > 0 ? ix1 : -ix0), e * w.skinX), xh = Math.max(e * (e > 0 ? ix1 : -ix0), e * w.skinX);
    // task train-lockbox: the nose corner window joined to this end window (its wraparound): a side pane at |z| = its skinZ closes
    // the strip of the side hole beside this window's sleeve (NOSE_PANE), and that strip of the sleeve's side face gives way to it
    const nose = noseCorners(spec, w);
    const zFace = (z: number) => nose.find(n => Math.abs(n.side * n.skinZ - z) < 0.02) ?? null;
    if (xh - xl > 1e-3) {
      const sideFace = (z: number, facing: 1 | -1) => {
        const n = zFace(z), panes = n ? [nosePane(w, n)] : [];
        for (const [a, b, y0, y1] of rectMinusHoles(xl, xh, w.y0, w.y1, panes.map(q => [q.x0, q.x1, q.y0, q.y1] as [number, number, number, number]))) {
          if (facing > 0) metal.quad([a, y0, z], [b, y0, z], [b, y1, z], [a, y1, z], [0, 0, 1], [a, y0], [b, y0], [b, y1], [a, y1]);
          else metal.quad([b, y0, z], [a, y0, z], [a, y1, z], [b, y1, z], [0, 0, -1], [b, y0], [a, y0], [a, y1], [b, y1]);
        }
      };
      sideFace(w.z0, 1);
      sideFace(w.z1, -1);
      metal.quad([xl, w.y1, w.z0], [xh, w.y1, w.z0], [xh, w.y1, w.z1], [xl, w.y1, w.z1], [0, -1, 0], [xl, w.z0], [xh, w.z0], [xh, w.z1], [xl, w.z1]);
      metal.quad([xl, w.y0, w.z1], [xh, w.y0, w.z1], [xh, w.y0, w.z0], [xl, w.y0, w.z0], [0, 1, 0], [xl, w.z1], [xh, w.z1], [xh, w.z0], [xl, w.z0]);
    }
    const xg = e * (w.skinX - TRAIN_VIEW.glassInset);
    glass.quad([xg, w.y0, w.z1], [xg, w.y0, w.z0], [xg, w.y1, w.z0], [xg, w.y1, w.z1], [1, 0, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
    for (const n of nose) {
      const q = nosePane(w, n), z = n.side * n.skinZ;
      if (q.x1 - q.x0 > 1e-3 && q.y1 - q.y0 > 1e-3) glass.quad([q.x0, q.y0, z], [q.x1, q.y0, z], [q.x1, q.y1, z], [q.x0, q.y1, z], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
    }
  }
  add(metal, mats.get('metal'), 'train-trim');
  add(rubber, mats.get('rubber'), 'train-thresholds');
  if (!glass.empty) {
    const g = glass.geometry();
    geometries.push(g);
    const m = new THREE.Mesh(g, mats.glass());
    m.name = 'train-glass';
    m.userData.trainGlass = true;
    m.renderOrder = 1; // after the opaque car (transparent: depthWrite off, both faces)
    fixed.add(m);
  }

  // --- light fittings (emissive; the casting lights are the runtime's boot-time lights) -----------------------------------------
  const fixtures = new QuadSet(), heads = new QuadSet(), tails = new QuadSet();
  const [fx, fy, fz] = TRAIN_VIEW.fixture;
  for (const m of spec.lights.interior) fixtures.box(m.x - fx / 2, Math.min(m.y, c - fy), m.z - fz / 2, m.x + fx / 2, c - 0.002, m.z + fz / 2);
  // a flat lens disc (triangle fan as degenerate quads), counter-clockwise seen from outside the car end; it covers the modelled
  // lamp (the mounts are LENS_AHEAD in front of the modelled lenses; the front lamps are painted red in the Meshy map: white here)
  const lensR = Math.max(TRAIN_VIEW.lens, (spec.lights.lampRadius ?? 0) + 0.012);
  const lens = (q: QuadSet, x: number, y: number, z: number, plusX: boolean) => {
    const r = lensR, seg = 12, n: V3 = [plusX ? 1 : -1, 0, 0], k0 = plusX ? -1 : 1;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p0: V3 = [x, y + Math.sin(a0) * r, z + Math.cos(a0) * r * k0], p1: V3 = [x, y + Math.sin(a1) * r, z + Math.cos(a1) * r * k0];
      q.quad([x, y, z], [x, y, z], p0, p1, n, [0.5, 0.5], [0.5, 0.5], [0, 0], [1, 0]);
    }
  };
  for (const m of spec.lights.head) lens(heads, m.x - LENS_AHEAD + 0.012, m.y, m.z, true);
  for (const m of spec.lights.tail) lens(tails, m.x + LENS_AHEAD - 0.012, m.y, m.z, false);
  add(fixtures, mats.get('fixture'), 'train-light-fittings');
  add(heads, mats.get('head'), 'train-head-lamps');
  add(tails, mats.get('tail'), 'train-tail-lamps');

  // --- the shell -----------------------------------------------------------------------------------------------------------
  let shellSrc: TrainView['source']['shell'] = 'procedural';
  if (models.shell?.scene) {
    const s = models.shell.scene.clone(true);
    s.name = 'train-shell';
    fixed.add(s);
    shellSrc = 'model';
  } else {
    // fallback skin: plain paint, door openings cut, roof, ends, skirt (kept above the third rail / coverboard)
    const paint = new QuadSet(), roof = new QuadSet(), skirt = new QuadSet();
    const sill = f - 0.12, roofY = spec.roofY, base = 0.35;
    for (const side of [-1, 1] as const) {
      const z = side * out, n: V3 = [0, 0, side];
      const face = (q: QuadSet, a: number, b: number, y0: number, y1: number) => {
        if (side > 0) q.quad([a, y0, z], [b, y0, z], [b, y1, z], [a, y1, z], n, [a, y0], [b, y0], [b, y1], [a, y1]);
        else q.quad([b, y0, z], [a, y0, z], [a, y1, z], [b, y1, z], n, [b, y0], [a, y0], [a, y1], [b, y1]);
      };
      for (const [a, b] of wallSpans(-L2, L2, cutsOf(side))) face(paint, a, b, sill, roofY);
      for (const d of spec.doors.filter(q => q.side === side)) {
        const a = d.x - d.width / 2, b = d.x + d.width / 2;
        face(paint, a, b, sill, f);
        if (roofY - (f + d.height) > 1e-3) face(paint, a, b, f + d.height, roofY);
      }
      face(skirt, -L2, L2, base, sill);
    }
    roof.quad([-L2, roofY, out], [L2, roofY, out], [L2, roofY, -out], [-L2, roofY, -out], [0, 1, 0], [-L2, out], [L2, out], [L2, -out], [-L2, -out]);
    for (const [x, plusX] of [[L2, true], [-L2, false]] as const) {
      const n: V3 = [plusX ? 1 : -1, 0, 0];
      if (plusX) paint.quad([x, sill, out], [x, sill, -out], [x, roofY, -out], [x, roofY, out], n, [out, sill], [-out, sill], [-out, roofY], [out, roofY]);
      else paint.quad([x, sill, -out], [x, sill, out], [x, roofY, out], [x, roofY, -out], n, [-out, sill], [out, sill], [out, roofY], [-out, roofY]);
    }
    add(paint, mats.get('paint'), 'train-shell-fallback');
    add(roof, mats.get('roof'), 'train-roof-fallback');
    add(skirt, mats.get('skirt'), 'train-skirt-fallback');
  }

  // --- the cab desk ----------------------------------------------------------------------------------------------------------
  let consoleSrc: TrainView['source']['console'] = 'none';
  if (models.console?.scene) {
    const k = models.console.scene.clone(true);
    k.name = 'train-console';
    const cs = spec.console;
    k.scale.setScalar(cs.scale);
    k.rotation.y = cs.yaw;
    k.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(k);
    k.position.set(cs.x - (bb.min.x + bb.max.x) / 2, f - bb.min.y, cs.z - (bb.min.z + bb.max.z) / 2);
    fixed.add(k);
    consoleSrc = 'model';
  }

  // --- door leaves -----------------------------------------------------------------------------------------------------------
  const leaves: THREE.Object3D[][] = [];
  const doorModel = models.door?.scene ?? null;
  let modelBox: THREE.Box3 | null = null;
  if (doorModel) { doorModel.updateMatrixWorld(true); modelBox = new THREE.Box3().setFromObject(doorModel); }
  let leafGeo: THREE.BufferGeometry | null = null, leafGlassGeo: THREE.BufferGeometry | null = null;
  const glassSlots: {door: number; k: 0 | 1; holder: THREE.Object3D; inner: THREE.Object3D}[] = [];
  // lane ASSETS' leaf rules: the closed leaf's OUTER face at |z| = doorLeaf.outerZ (a clear sliding pocket at every door), its baked
  // width / height / thickness; both faces alike, closing edge (T-handle) at +X -> the +X leaf of a pair is mirrored
  const DL = spec.doorLeaf, lw = DL.width;
  for (const d of spec.doors) {
    const pair: THREE.Object3D[] = [];
    const zc = d.side * (DL.outerZ - DL.thickness / 2);
    for (const k of [0, 1] as const) {
      const holder = new THREE.Group();
      holder.name = `train-door-${spec.doors.indexOf(d)}-${k}`;
      let leaf: THREE.Object3D;
      if (doorModel && modelBox) {
        leaf = doorModel.clone(true);
        const sz = modelBox.getSize(new THREE.Vector3()), ctr = modelBox.getCenter(new THREE.Vector3());
        // baked at runtime size: these scales are ~1 (a re-cook with other dims still fits the spec's leaf box)
        const sx = lw / Math.max(1e-3, sz.x), sy = DL.height / Math.max(1e-3, sz.y), sz2 = DL.thickness / Math.max(1e-3, sz.z);
        const inner = new THREE.Group();
        leaf.position.set(-ctr.x, -ctr.y, -ctr.z);
        inner.add(leaf);
        // (task train-shell-followup) glass in the leaf's cut window, in the leaf's own frame: it slides (and mirrors) with the leaf
        if (win.leaf) {
          leafGlassGeo ??= (() => {
            const q = new QuadSet(), w = win.leaf!, z = -ctr.z;
            q.quad([w.x0 - ctr.x, w.y0 - ctr.y, z], [w.x1 - ctr.x, w.y0 - ctr.y, z], [w.x1 - ctr.x, w.y1 - ctr.y, z], [w.x0 - ctr.x, w.y1 - ctr.y, z], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
            const g = q.geometry();
            geometries.push(g);
            return g;
          })();
          glassSlots.push({door: spec.doors.indexOf(d), k, holder, inner});
        }
        inner.scale.set(sx * (k === 1 ? -1 : 1), sy, sz2);
        leaf = inner;
      } else {
        leafGeo ??= (() => { const q = new QuadSet(); q.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5); const g = q.geometry(); geometries.push(g); return g; })();
        const m = new THREE.Mesh(leafGeo, mats.get('leaf'));
        m.scale.set(lw, DL.height, DL.thickness);
        leaf = m;
      }
      holder.add(leaf);
      const [a, b] = leafSpan(d, k, 0, lw);
      holder.position.set((a + b) / 2, f + DL.height / 2, zc);
      doorsGroup.add(holder);
      pair.push(holder);
    }
    leaves.push(pair);
  }
  // the leaf-window glass: one instanced mesh under the root (it moves with the leaves: never culler-registered)
  let leafGlass: TrainView['leafGlass'] = null;
  if (leafGlassGeo && glassSlots.length) {
    const im = new THREE.InstancedMesh(leafGlassGeo, mats.glass(), glassSlots.length);
    im.name = 'train-door-glass';
    im.userData.trainGlass = true;
    im.renderOrder = 1;
    root.add(im);
    leafGlass = {mesh: im, slots: glassSlots};
  }
  const mtx = new THREE.Matrix4();
  const syncLeafGlass = (): void => {
    if (!leafGlass) return;
    leafGlass.slots.forEach((sl, i) => {
      sl.holder.updateMatrix(); sl.inner.updateMatrix();
      leafGlass!.mesh.setMatrixAt(i, mtx.multiplyMatrices(sl.holder.matrix, sl.inner.matrix)); // (the doors group is the root's identity child)
    });
    leafGlass.mesh.instanceMatrix.needsUpdate = true;
    leafGlass.mesh.computeBoundingSphere();
  };
  syncLeafGlass();
  return {root, fixed, leaves, geometries, source: {shell: shellSrc, door: doorModel ? 'model' : 'procedural', console: consoleSrc, textures: nTex}, leafGlass, syncLeafGlass};
}

/** Draw calls / triangles of a view (QA / tests: the cost the train adds; hidden warm-up prototypes never draw). */
export function viewCost(root: THREE.Object3D): {meshes: number; tris: number} {
  let meshes = 0, tris = 0;
  root.traverseVisible(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return {meshes, tris: Math.round(tris)};
}
