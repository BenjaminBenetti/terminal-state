// Task train-lockbox-windows-20261101-232156 (lane TRAIN): the Lockbox — a substantial bolted-down storage box in the player train's
// rear compartment (spec.lockbox: placement + size + lid hinge, train-local). This module is the WORLD object only: its view (the
// cooked Meshy model, two nodes 'lockbox-body' / 'lockbox-lid' with the lid's origin on the back-top hinge line, front +Z, baked at
// runtime size — or a plain placeholder box while that model is missing), the hinged lid animation, an untextured dark liner in the
// open cavity, the pick box for aim + [E]. Its collision is a solid box among the car's colliders (world/playerTrain.ts
// trainColliders: game.propIndex + layout.props, like the train walls); the LOCKBOX_SLOTS contents are lane BOX's (run/trainLockbox.ts,
// ui/lockboxView.ts), reached through PlayerTrainRuntime.onLockboxInteract / setLockboxOpen / lockboxWorld / lockboxAimed.
//
// Prop rules (root CLAUDE.md): an ANCHORED fixture — bolted to the car floor, no physics body, never knocked about (rule 3 exception,
// recorded here); it is storage that opens (rule 1) through lane BOX's persistent store; no loose items are baked into it (rule 4);
// its runtime-size scale check beside a zombie is lane ASSETS' (rule 5).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {PlayerTrainSpec} from './playerTrainSpec';
import type {TrainMaterials} from './playerTrainView';

/** The prop library key of the cooked model (assets/playerTrain.generated.ts PLAYER_TRAIN_MODELS). */
export const LOCKBOX_MODEL_KEY = 'player-train-lockbox';

export const LOCKBOX = {
  /** Full lid stroke (s), smoothstep like the openables. */
  lidTime: 0.75,
  /** Placeholder (no model) panel thickness / rim inset (m). */
  wall: 0.035,
} as const;

export type LockboxSpec = NonNullable<PlayerTrainSpec['lockbox']>;

export interface LockboxView {
  /** Train-local group: position (x, floorY, z), rotation.y = yaw; its children are in the box frame (front +Z, grounded, centred). */
  group: THREE.Group;
  /** The lid's pivot (its origin on the hinge line); rotation.x = rest - openAngle * eased fraction. */
  lid: THREE.Object3D | null;
  lidRest: number;
  /** The meshes that glow while aimed (body + lid; never the liner). */
  highlight: THREE.Mesh[];
  /** Geometries this view created (the model's belong to the prop library). */
  geometries: THREE.BufferGeometry[];
  source: 'model' | 'placeholder';
}

/** One axis-aligned box's six outward faces into a geometry (uvs in metres). */
function boxGeometry(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: {top?: boolean; bottom?: boolean} = {}): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    const i = pos.length / 3;
    for (const p of [a, b, c, d]) pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) nor.push(n[0], n[1], n[2]);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  if (faces.top !== false) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  if (faces.bottom !== false) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The dark liner of the open cavity: four inner walls facing in + the inner floor facing up (box frame). */
function linerGeometry(c: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number}, rim: {x: number; z: number} | null): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (a: number[], b: number[], cc: number[], d: number[], n: number[]) => {
    const i = pos.length / 3;
    for (const p of [a, b, cc, d]) pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) nor.push(n[0], n[1], n[2]);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const {x0, x1, y0, y1, z0, z1} = c;
  quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, 1]); // back wall, faces +Z (into the cavity)
  quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, -1]); // front wall, faces -Z
  quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [1, 0, 0]); // left, faces +X
  quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [-1, 0, 0]); // right, faces -X
  quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, 1, 0]); // floor, faces up
  // the rim at the seam: a frame facing up from the cavity edge out to the walls (`rim` = the outer half extents, inset 4 mm)
  if (rim) {
    const y = y1, ox = rim.x, oz = rim.z;
    quad([-ox, y, z0], [ox, y, z0], [ox, y, -oz], [-ox, y, -oz], [0, 1, 0]); // back strip
    quad([-ox, y, oz], [ox, y, oz], [ox, y, z1], [-ox, y, z1], [0, 1, 0]); // front strip
    quad([-ox, y, z1], [x0, y, z1], [x0, y, z0], [-ox, y, z0], [0, 1, 0]); // left strip
    quad([x1, y, z1], [ox, y, z1], [ox, y, z0], [x1, y, z0], [0, 1, 0]); // right strip
  }
  // (windings: counter-clockwise seen from inside the cavity / from above)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Builds the Lockbox in its own frame under a group placed train-locally at (x, floorY, z) with yaw. `model` = the cooked GLB (two
 * nodes 'lockbox-body' / 'lockbox-lid'); missing / malformed -> the plain placeholder (body + lid boxes), never a crash.
 */
export function buildLockboxView(lb: LockboxSpec, floorY: number, mats: TrainMaterials, model?: GLTF | null): LockboxView {
  const group = new THREE.Group();
  group.name = 'train-lockbox';
  group.position.set(lb.x, floorY, lb.z);
  group.rotation.set(0, lb.yaw, 0);
  const geometries: THREE.BufferGeometry[] = [];
  const highlight: THREE.Mesh[] = [];
  const seam = lb.seamY ?? lb.lid.hingeY;
  const L2 = lb.length / 2, D2 = lb.depth / 2, w = LOCKBOX.wall;
  const cavity = lb.cavity ?? {x0: -L2 + w, x1: L2 - w, y0: 0.06, y1: seam, z0: -D2 + w, z1: D2 - w};
  let lid: THREE.Object3D | null = null, lidRest = 0, source: LockboxView['source'] = 'placeholder';
  const scene = model?.scene ?? null;
  const body = scene?.getObjectByName('lockbox-body') ?? null, lidNode = scene?.getObjectByName('lockbox-lid') ?? null;
  if (scene && body && lidNode) {
    const s = scene.clone(true);
    s.name = 'train-lockbox-model';
    group.add(s);
    lid = s.getObjectByName('lockbox-lid') ?? null;
    lidRest = lid?.rotation.x ?? 0;
    s.traverse(o => { if ((o as THREE.Mesh).isMesh) highlight.push(o as THREE.Mesh); });
    source = 'model';
  } else {
    if (scene) console.warn('player train: the lockbox model lacks its lockbox-body / lockbox-lid nodes; using the placeholder');
    // placeholder: an open steel box (outer walls + bottom + the rim) and a lid slab hinged at the back-top edge — plain paint
    const paint = mats.get('lockbox');
    const bodyGeo = boxGeometry(-L2, 0, -D2, L2, seam, D2, {top: false});
    geometries.push(bodyGeo);
    const bm = new THREE.Mesh(bodyGeo, paint);
    bm.name = 'train-lockbox-body';
    group.add(bm);
    highlight.push(bm);
    const pivot = new THREE.Group();
    pivot.name = 'train-lockbox-lid';
    pivot.position.set(0, lb.lid.hingeY, lb.lid.hingeZ);
    const lidGeo = boxGeometry(-L2, seam - lb.lid.hingeY, -D2 - lb.lid.hingeZ, L2, lb.height - lb.lid.hingeY, D2 - lb.lid.hingeZ);
    geometries.push(lidGeo);
    const lm = new THREE.Mesh(lidGeo, paint);
    lm.name = 'train-lockbox-lid-panel';
    pivot.add(lm);
    group.add(pivot);
    highlight.push(lm);
    lid = pivot;
  }
  // the dark, untextured liner: the open cavity never shows the outside through it or the model's inside-out back faces
  const linerGeo = linerGeometry(cavity, {x: L2 - 0.004, z: D2 - 0.004});
  geometries.push(linerGeo);
  const liner = new THREE.Mesh(linerGeo, mats.get('liner'));
  liner.name = 'train-lockbox-liner';
  liner.userData.lockboxLiner = true;
  group.add(liner);
  return {group, lid, lidRest, highlight, geometries, source};
}

/** The lid's state: open fraction t (0 shut .. 1 open) moving toward target. */
export class LockboxLid {
  t = 0;
  target: 0 | 1 = 0;
  /** True while the lid moves. */
  moving = false;

  /** Steps the lid; returns 'opening' / 'closing' on the frame a stroke starts, 'opened' / 'closed' on the frame it ends. */
  step(dt: number): 'opening' | 'closing' | 'opened' | 'closed' | null {
    const was = this.t, wasMoving = this.moving;
    const k = dt / LOCKBOX.lidTime;
    if (this.target > this.t) this.t = Math.min(1, this.t + k);
    else if (this.target < this.t) this.t = Math.max(0, this.t - k);
    this.moving = this.t !== was;
    if (this.moving && !wasMoving) return this.target === 1 ? 'opening' : 'closing';
    if (!this.moving && wasMoving) return this.t >= 1 ? 'opened' : 'closed';
    return null;
  }

  /** Eased open fraction (smoothstep, like the openables' hinges). */
  get eased(): number {
    const t = this.t;
    return t * t * (3 - 2 * t);
  }
}

/** The Lockbox's footprint in train-local coordinates (yaw in quarter turns: a side-on yaw swaps length and depth). */
export function lockboxFootprint(lb: LockboxSpec): {x0: number; x1: number; z0: number; z1: number} {
  const side = Math.abs(Math.sin(lb.yaw)) > 0.5;
  const hx = (side ? lb.depth : lb.length) / 2, hz = (side ? lb.length : lb.depth) / 2;
  return {x0: lb.x - hx, x1: lb.x + hx, z0: lb.z - hz, z1: lb.z + hz};
}

/** Pose the view's lid for an eased open fraction e. */
export function poseLid(v: LockboxView, lb: LockboxSpec, e: number): void {
  if (v.lid) v.lid.rotation.x = v.lidRest - lb.lid.openAngle * e;
}
