// Task studio-turnstile-reload-visuals-20261112-063646-01 (the user: "Turnstile should eject old shell casings on reload, and show new shells
// appearing in the cylinder"): a revolver's ROUNDS in its held view (weapons/viewmodel.ts), drawn from the held stack every frame — never
// counted here, so the view always agrees with the actual rounds (ItemStack.mag live, ItemStack.spent fired hulls; weapons.ts):
//  - CylinderRounds: the cylinder's six chambers on its rear face (children of the held copy's `Cylinder` node: they turn with each index and
//    break open with the barrels). A chamber shows a 12-gauge shell head (live or a fired hull) or its dark empty mouth. Chamber `index`
//    (GunParts.chamberIndex) is the one under the barrel; the live rounds are the next ones to come under it, the fired hulls the ones that
//    have passed — so each shot (one index, one live round less, one hull more) keeps the picture true. While the action opens the fired
//    hulls rise with the extractor; each shell being loaded slides home into the next empty chamber, seated as its 'shellIn' counts it.
//  - ThrownHulls: the reload's 'eject' throws the fired hulls out of their chambers — a short slide clear of the chamber, then a flight out of
//    the view — and hands each one to the world's bounded casing pool (physics/casings.ts: 48 slots, 25 s lifetime) once it leaves the view.
// Shapes and materials are the existing 12-gauge hull resource (physics/casings.ts SHELL_PARTS); only the chamber mouths and the primer are
// added. Nothing is drawn while the action is closed (the standing breech hides the rear face). Every mesh shares a handful of geometries /
// materials (one warm-up key set); no allocation per frame. Hidden things are hidden MESH by mesh, never by a group: the loading-screen
// warm-up (render/warmup.ts) shows every mesh of the held view's scene, so all of these compile there with no extra warm root.

import * as THREE from 'three';
import {SHELL_PARTS, brassMaterial, shellHullMaterial} from '../physics/casings';

/**
 * The chamber layout on the rear face, in model metres / radians, measured on the cooked Turnstile (weapon-turnstile.glb): the rear face is
 * flat 0.4 mm under the `Eject` marker (its rim) and 36 - 40 mm in radius, with the ratchet hub (r 10 - 16 mm, off-centre) in its middle;
 * the eight flutes run out 1 - 3 mm under it. Six 21.6 mm shell heads on a 25.0 mm pitch circle stay 0.3 mm inside that rim (the hub laps
 * the inner edge of the two upper heads by <= 2.1 mm, like an extractor star over the rims).
 */
export const CHAMBERS = {
  /** Pitch-circle radius about the cylinder's axis. */
  pitch: 0.025,
  /** Chamber 0's angle at the model's rest pose (counter-clockwise seen from behind, from +X): the top, under the barrel. */
  top: Math.PI / 2,
  /** Head bases stand this far above the `Eject` marker plane: 0.8 mm proud of the flat face, 0.5 mm clear of the closed standing breech. */
  proud: 0.0004,
  /** How deep (below the marker plane) a shell is drawn: only the solid rim of the face (never out through the flutes' run-out). */
  depth: 0.0012,
};
/**
 * A loaded shell is seen going home over the last `time` s before its 'shellIn' (seated as it is counted), from `from` m out of its chamber
 * or less where the frame leaves less room (OPEN_ROOM).
 */
export const SHELL_IN = {from: 0.05, time: 0.18};
/**
 * How far (m) a whole shell can stand out of its chamber at each POSITION (0 = under the barrel, then on in the order of the chambers)
 * with the action fully open before it would touch the frame, less a 4 mm margin: measured on the cooked model (0.5 mm surface samples of
 * the body and barrels; 75 / 75 / 30 / 21.25 / 30 / 75 mm, the lower three run into the standing breech). Positions over SHELL_IN.from
 * are clear for the whole shell.
 */
export const OPEN_ROOM = [0.071, 0.071, 0.026, 0.0172, 0.026, 0.071];
/** The fired hulls rise with the extractor as the action opens from `start` (WeaponController.actionOpen) to `rise` m out when fully open. */
export const EXTRACT = {start: 0.6, rise: 0.012};
/**
 * The throw at the 'eject': each hull slides clear of its chamber at `slide` m/s, then flies on in the view at `out` m/s along the chamber
 * axis + `side` to the right + `up` (+-`jitter` each), tumbling ~`spin` rad/s; it leaves the view (past its edge, nearer the eye than `near`
 * m, or after `life` s) into the world pool.
 */
export const THROW = {slide: 3, out: 1.2, side: 1.1, up: 0.45, jitter: 0.15, spin: 13, life: 0.8, near: 0.12};

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const HEAD = SHELL_PARTS.head, HULL = SHELL_PARTS.hull;
/** A whole shell's length (head + hull: 70 mm). */
const SHELL_LEN = HEAD.length + HULL.length;

interface Shared {head: THREE.BufferGeometry; hull: THREE.BufferGeometry; disc: THREE.BufferGeometry; brass: THREE.Material; plastic: THREE.Material; primer: THREE.Material; mouth: THREE.Material}
let shared: Shared | null = null;
/** One set for every held cylinder and thrown hull: unit-length cylinders along -Y from y 0 (scaled to the drawn length), a +Y-facing disc. */
function parts(): Shared {
  if (shared) return shared;
  const unit = (r: number, seg: number) => new THREE.CylinderGeometry(r, r, 1, seg, 1, false).translate(0, -0.5, 0);
  shared = {
    head: unit(HEAD.radius, 24), hull: unit(HULL.radius, 20), disc: new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
    brass: brassMaterial(), plastic: shellHullMaterial(),
    primer: new THREE.MeshStandardMaterial({color: 0xb7aa92, metalness: 0.7, roughness: 0.4, emissive: 0x100c06}),
    mouth: new THREE.MeshStandardMaterial({color: 0x0a0908, metalness: 0, roughness: 0.95}),
  };
  return shared;
}

/** A 12-gauge shell (head base at the group's origin, the hull along -Y) whose drawn length can be cut short (`draw`); shown mesh by mesh. */
class Shell {
  readonly group = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly hull: THREE.Mesh;
  private readonly primer: THREE.Mesh;
  private shown = true;
  private hullLen: number = HULL.length;
  constructor(s: Shared) {
    this.head = new THREE.Mesh(s.head, s.brass);
    this.hull = new THREE.Mesh(s.hull, s.plastic);
    this.hull.position.y = -HEAD.length;
    this.primer = new THREE.Mesh(s.disc, s.primer);
    this.primer.scale.setScalar(0.0029);
    this.primer.position.y = 0.00005;
    this.group.add(this.head, this.hull, this.primer);
  }
  get visible(): boolean {
    return this.shown;
  }
  show(on: boolean): void {
    this.shown = on;
    this.head.visible = this.primer.visible = on;
    this.hull.visible = on && this.hullLen > 1e-4;
  }
  /** Draw `len` m of the shell from its base (the whole 70 mm by default). */
  draw(len = SHELL_LEN): void {
    this.head.scale.y = Math.max(1e-4, Math.min(HEAD.length, len));
    this.hullLen = Math.min(HULL.length, len - HEAD.length);
    if (this.hullLen > 1e-4) this.hull.scale.y = this.hullLen;
    this.show(this.shown);
  }
}

interface Slot {
  /** The chamber's frame: origin on the `Eject` marker plane at the chamber centre, +Y out of the rear face along the axis. */
  frame: THREE.Group;
  mouth: THREE.Mesh;
  shell: Shell;
  /** What the chamber shows (from the last update). */
  state: 'empty' | 'live' | 'spent' | 'loading';
}

/** A chamber's world pose for the throw: the head base (camera space) and its outward axis. */
export interface ChamberPose { base: THREE.Vector3; axis: THREE.Vector3; quat: THREE.Quaternion; drawn: number }

/** The rounds in a held revolver's cylinder (see the header). Attached to the HELD copy only (Viewmodel.registerWeaponModel). */
export class CylinderRounds {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private index = 0;
  private drawn = false;

  private constructor(readonly chambers: number) {
    this.group.name = 'cylinder-rounds';
  }

  /**
   * Chambers on the `Cylinder` node of `root` (the model, matrices current, BEFORE any held-pose shift) at the `Eject` marker's plane,
   * about the node's own axis (model +Z through its origin: the cook puts it on the cylinder's axis). Null without both.
   */
  static attach(root: THREE.Object3D, chambers: number): CylinderRounds | null {
    const cyl = root.getObjectByName('Cylinder'), eject = root.getObjectByName('Eject');
    if (!cyl || cyl === root || !eject || chambers < 1) return null;
    root.updateMatrixWorld(true);
    const toModel = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const toNode = new THREE.Matrix4().copy(cyl.matrixWorld).invert().multiply(root.matrixWorld); // model frame -> node frame
    const axisAt = cyl.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel); // the axis point (model)
    const face = eject.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel).z; // the marker plane (model z)
    const up = new THREE.Vector3(0, 0, 1).applyMatrix4(toNode).sub(new THREE.Vector3().applyMatrix4(toNode)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const r = new CylinderRounds(chambers), s = parts();
    for (let k = 0; k < chambers; k++) {
      const a = CHAMBERS.top + k * 2 * Math.PI / chambers;
      const frame = new THREE.Group();
      frame.position.set(axisAt.x + CHAMBERS.pitch * Math.cos(a), axisAt.y + CHAMBERS.pitch * Math.sin(a), face).applyMatrix4(toNode);
      frame.quaternion.copy(q);
      const mouth = new THREE.Mesh(s.disc, s.mouth); // the empty chamber's mouth on the flat face (the head covers it when a shell is in)
      mouth.scale.setScalar(HULL.radius + 0.0003);
      mouth.position.y = -0.0003;
      const shell = new Shell(s);
      mouth.visible = false;
      shell.show(false);
      frame.add(mouth, shell.group);
      r.group.add(frame);
      r.slots.push({frame, mouth, shell, state: 'empty'});
    }
    cyl.add(r.group);
    return r;
  }

  /** Whether the chambers are drawn now (the action open or a shell going in; QA / tests). */
  get shown(): boolean {
    return this.drawn;
  }

  /** The chamber state shown now (QA / tests): chamber k's content from the last update ('loading': the shell sliding in, not counted yet). */
  get states(): readonly ('empty' | 'live' | 'spent' | 'loading')[] {
    return this.slots.map(s => s.state);
  }

  /** Whether chamber k's shell is drawn now and how far (m) it stands out of its chamber (QA / tests). */
  shellOut(k: number): {shown: boolean; out: number} {
    const s = this.slots[k];
    return {shown: this.drawn && s.shell.visible, out: s.shell.group.position.y - CHAMBERS.proud};
  }

  /**
   * Pose the chambers from the held stack: `live` rounds and `spent` hulls (undefined = not a gun's stack: nothing shown), the break action's
   * opening `open` 0..1, `index` = the chamber under the barrel (GunParts.chamberIndex), `due` = seconds until the shell being loaded is
   * counted (WeaponController.shellDue; null = none going in): it slides into the next empty chamber (after the live ones) over its last
   * SHELL_IN.time and is seated when it becomes a live round. Pure function of its inputs: nothing to reset on a cancel / switch.
   */
  update(live: number | undefined, spent: number | undefined, open: number, index: number, due: number | null = null): void {
    const n = this.chambers;
    const nLive = Math.max(0, Math.min(n, live ?? 0));
    const nSpent = Math.max(0, Math.min(n - nLive, spent ?? 0));
    this.index = ((index % n) + n) % n;
    const loading = live !== undefined && due !== null && due < SHELL_IN.time && nLive + nSpent < n;
    this.drawn = live !== undefined && (open > 1e-3 || loading);
    for (let k = 0; k < n; k++) {
      const slot = this.slots[k], rel = ((k - this.index) % n + n) % n;
      const state = live === undefined ? 'empty' : rel < nLive ? 'live' : rel >= n - nSpent ? 'spent' : loading && rel === nLive ? 'loading' : 'empty';
      slot.state = state;
      let out = 0;
      if (state === 'loading') out = Math.min(SHELL_IN.from, OPEN_ROOM[rel] ?? SHELL_IN.from) * ease(clamp01(due! / SHELL_IN.time));
      else if (state === 'spent') out = EXTRACT.rise * ease(clamp01((open - EXTRACT.start) / (1 - EXTRACT.start)));
      slot.mouth.visible = this.drawn;
      slot.shell.show(this.drawn && state !== 'empty');
      if (state !== 'empty') this.placeShell(slot.shell, out);
    }
  }

  /** The shell's head base `out` m out of its chamber, drawn only down to CHAMBERS.depth under the marker plane. */
  private placeShell(shell: Shell, out: number): void {
    const base = CHAMBERS.proud + out;
    shell.group.position.y = base;
    shell.draw(base + CHAMBERS.depth);
  }

  /**
   * The fired hulls leaving now (the 'eject'): the poses of the `count` chambers just behind the one under the barrel (the hulls), in the
   * frame of `space` (the viewmodel camera); world matrices must be current. Their chambers show empty from the next update on.
   */
  spentPoses(count: number, space: THREE.Object3D, out: ChamberPose[]): number {
    const n = this.chambers, inv = new THREE.Matrix4().copy(space.matrixWorld).invert(), m = new THREE.Matrix4(), sc = new THREE.Vector3();
    let made = 0;
    for (let j = 1; j <= Math.min(count, n); j++) {
      const slot = this.slots[((this.index - j) % n + n) % n];
      m.multiplyMatrices(inv, slot.shell.group.matrixWorld);
      const p = out[made] ?? (out[made] = {base: new THREE.Vector3(), axis: new THREE.Vector3(), quat: new THREE.Quaternion(), drawn: 0});
      m.decompose(p.base, p.quat, sc);
      p.axis.set(0, 1, 0).applyQuaternion(p.quat);
      p.drawn = slot.shell.group.position.y + CHAMBERS.depth;
      slot.shell.show(false);
      made++;
    }
    return made;
  }
}

interface Flying {
  shell: Shell;
  live: boolean;
  age: number;
  /** Still sliding out of its chamber: the distance left (m) before its whole length is clear (drawn length grows meanwhile). */
  slide: number;
  drawn: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

/** A hull leaving the held view for the world: its position / velocity in the viewmodel camera's space. */
export interface ReleasedHull { pos: THREE.Vector3; vel: THREE.Vector3 }
const NONE: readonly ReleasedHull[] = Object.freeze([]);

/** The hulls thrown out of the cylinder, flying in the viewmodel camera's space until they leave the view (see the header). Bounded pool. */
export class ThrownHulls {
  readonly root = new THREE.Group();
  private readonly pool: Flying[] = [];
  private readonly released: ReleasedHull[] = [];
  private releasedN = 0;
  /** Deterministic jitter source (tests may replace it). */
  rand: () => number = Math.random;
  private readonly tq = new THREE.Quaternion();
  private readonly tv = new THREE.Vector3();
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly upV = new THREE.Vector3(0, 1, 0);

  constructor(size = 6) {
    this.root.name = 'thrown-hulls';
    const s = parts();
    for (let i = 0; i < size; i++) {
      const shell = new Shell(s);
      shell.show(false);
      shell.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.renderOrder = 1; } });
      this.root.add(shell.group);
      this.pool.push({shell, live: false, age: 0, slide: 0, drawn: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3()});
    }
  }

  /** Hulls in flight (QA / tests). */
  get flying(): number {
    let n = 0;
    for (const f of this.pool) if (f.live) n++;
    return n;
  }

  /** Throw a hull from a chamber pose (camera space). The oldest flying one is handed to the world first when the pool is full. */
  throw(p: ChamberPose): void {
    let f = this.pool.find(x => !x.live);
    if (!f) { f = this.pool.reduce((a, b) => (b.age > a.age ? b : a)); this.release(f); }
    const R = this.rand, j = () => (R() - 0.5) * 2 * THROW.jitter;
    f.live = true;
    f.age = 0;
    f.drawn = p.drawn;
    f.slide = Math.max(0, SHELL_LEN - p.drawn);
    f.shell.group.position.copy(p.base);
    f.shell.group.quaternion.copy(p.quat);
    f.shell.show(true);
    f.shell.draw(f.drawn);
    f.vel.copy(p.axis).multiplyScalar(THROW.out + j()).addScaledVector(this.right, THROW.side + j()).addScaledVector(this.upV, THROW.up + j());
    // end over end about the axis across the throw and the hull, plus a little wobble
    f.spin.crossVectors(p.axis, f.vel).normalize().multiplyScalar(THROW.spin * (0.8 + 0.4 * R()));
    f.spin.x += j() * 10; f.spin.y += j() * 10; f.spin.z += j() * 10;
  }

  /**
   * Advance the flights; `down` = the world's down in camera space (gravity), `camera` = the viewmodel camera (its frustum decides when a
   * hull has left the view). Hulls that left (or ran out of `life`) are queued for takeReleased.
   */
  update(dt: number, down: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    for (const f of this.pool) {
      if (!f.live) continue;
      f.age += dt;
      const g = f.shell.group;
      if (f.slide > 0) { // clear of the chamber first: straight out along its axis, the drawn length growing as it comes out
        const d = Math.min(f.slide, THROW.slide * dt);
        f.slide -= d;
        f.drawn = Math.min(SHELL_LEN, f.drawn + d);
        g.position.addScaledVector(this.tv.set(0, 1, 0).applyQuaternion(g.quaternion), d);
        f.shell.draw(f.drawn);
        continue;
      }
      f.vel.addScaledVector(down, 9.81 * dt);
      g.position.addScaledVector(f.vel, dt);
      const w = f.spin.length();
      if (w > 1e-4) g.quaternion.premultiply(this.tq.setFromAxisAngle(this.tv.copy(f.spin).divideScalar(w), w * dt));
      // left the view (with a margin for its length) or too old: into the world
      const ndc = this.tv.copy(g.position).applyMatrix4(camera.projectionMatrix);
      if (f.age >= THROW.life || -g.position.z < Math.max(THROW.near, camera.near * 2) || Math.abs(ndc.x) > 1.15 || Math.abs(ndc.y) > 1.15) this.release(f);
    }
  }

  private release(f: Flying): void {
    f.live = false;
    f.shell.show(false);
    if (this.releasedN >= 2 * this.pool.length) return; // nobody is taking them (bounded: the hull just leaves the view)
    const r = this.released[this.releasedN] ?? (this.released[this.releasedN] = {pos: new THREE.Vector3(), vel: new THREE.Vector3()});
    r.pos.copy(f.shell.group.position);
    r.vel.copy(f.vel);
    this.releasedN++;
  }

  /** The hulls that left the view since the last call (camera space; the records are reused: copy what you keep). */
  takeReleased(): readonly ReleasedHull[] {
    if (!this.releasedN) return NONE;
    const out = this.released.slice(0, this.releasedN);
    this.releasedN = 0;
    return out;
  }

  /** Everything in flight goes to the world at once (QA / a level change). */
  releaseAll(): void {
    for (const f of this.pool) if (f.live) this.release(f);
  }
}
