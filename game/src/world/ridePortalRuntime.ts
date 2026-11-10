// Task studio-perf-ao-train-continuity-20261110-022206-01 (lead contract; lane PORTAL): the RIDE PORTALS in the live world — what
// the moving train (world/trainRide.ts) asks of the station it leaves / enters. Geometry and positions: world/ridePortal.ts; the
// gates' and the breach headwall's look: world/ridePortalView.ts.
//
// One instance per Game (installRidePortals), re-bound to each station by its section hooks. While a ride ENGAGES a portal:
//  - everything the station draws inside the portal's cut (its `box`; a gate's from the headwall front on) is hidden, and drawn again
//    on release — no geometry is rebuilt, nothing is disposed, no mesh, material or pipeline is created or changed;
//  - the station's baked light field (surfaces and haze) reads zero inside the box (world/rideMask.ts): a tunnel through rock;
//  - a 'gate' portal's gate can swing open / shut (the static headwall + gate stand in the bed end face at all times);
//  - a 'breach' portal's headwall stands across the station tunnel (only while engaged);
//  - the level culler decides the station from the opening while the eye rides beyond the plane (LevelCuller.eyeProxy).
// The ride tunnel itself (the box, rails, signals) is the transit tunnel placed as a stub by the ride (world/trainTransitTunnel.ts).
//
// THE CUT (one rule for everything: world/ridePortal.ts cutHides — bounds overlapping the box and lying beyond the front plane):
//  1. Static merged meshes of the three station roots (the world group, the holders, the shelf stock: world-space geometry of one
//     mesh) — per TRIANGLE. When the station is bound (the section build hook: behind the loading screen / during the transit) each
//     such mesh with triangles in a cut gets them partitioned once, in place and stably: [front portal's | kept | rear portal's] in
//     its index (a non-indexed mesh: in its vertex attributes). Engaging / releasing is then geometry.setDrawRange on those few
//     meshes: three r186 reads the draw range and the index live at every draw, so nothing is rebuilt and no buffer is uploaded.
//     Triangle ORDER is all that changes, and only then: damage/propDamage.ts finds a prop's merged-chunk triangles by scanning the
//     live index at the hit and restores them by position — valid, since no mesh is ever partitioned twice; it ignores the draw range,
//     so a cut-away chunk can still be detached (its copy is then hidden as a mover, rule 3).
//  2. InstancedMesh, anywhere in the scene — per INSTANCE: a hidden instance gets a collapsed matrix (its translation kept, so cached
//     bounds stay true; marked, so it is told from another system's zero matrix) and the original is kept to restore bit-exactly.
//     Order, counts, colours and every index other systems hold are untouched. While engaged an instanced mesh whose matrices changed
//     (instanceMatrix.version) is looked at again: an instance another system rewrote (a prop detached or re-attached, a pooled
//     decal) is never restored over; a newly placed one inside the cut is hidden.
//  3. Everything else — placed models, holder doors, and the things that move (enemies, market people, pickups, loose props, carts,
//     bags) — per OBJECT, each step: `visible = false` on what lies inside (remembering what WE hid), shown again when it leaves or
//     on release. Their simulation is untouched. NEVER the car, what rides in it (anything inside the car's own volume), the transit
//     tunnel (userData.trainTransit), the portals' own meshes (userData.ridePortal) or the viewmodel (its own scene).
// Whatever reaches the station side of the front plane stays whole: the bed up to a gate, the station tunnel up to a breach.

import * as THREE from 'three';
import type {StationLayout} from '../gen/stationTypes';
import type {TrainPlacement} from '../gen/playerTrain';
import type {WorldMaterials} from './materials';
import {RIDE_MASK, setRideMask} from './rideMask';
import {boxOverlaps, cutHides, portalCut, portalEndKey, portalEye, ridePortals, type PortalCut, type RidePortal} from './ridePortal';
import {buildBreachHeadwall, type BreachHeadwall, type RideGateView, type RideGatesBuilt} from './ridePortalView';

/** `front` = the departure portal (the cab's end), `rear` = the arrival portal (world/ridePortal.ts ridePortals). */
export type PortalWhich = 'front' | 'rear';
const WHICH: readonly PortalWhich[] = ['front', 'rear'];

/** Runtime tuning (s, m). */
export const PORTAL_RT = {
  /** A gate's swing. */
  swing: 1.3,
  /** A breach's headwall goes when its plane is out of the camera's view or this far from the eye — or after `timeout` s. */
  unseen: 50, timeout: 4,
  /** The station's light fades in over this many metres at the plane (world/rideMask.ts). */
  fade: 4,
  /** Around the car's body: what is inside rides with it and is never hidden. */
  carPad: 0.35,
  /** A mover's bounds round its origin: half width, height (an enemy, a person); a pickup's half size. */
  actor: [0.6, 2.1] as const, item: 0.4,
} as const;

export interface PortalState {
  /** The portal of the current station (null: no car / no station). */
  portal: RidePortal | null;
  engaged: boolean;
  /** Being released (a gate shutting, a breach waiting to be unobserved); still engaged until done. */
  releasing: boolean;
  /** Gate swing 0 (shut) .. 1 (open); a breach reads 1 while engaged, 0 otherwise. */
  gate: number;
  /** What `engage` hid: static meshes cut, their triangles, instances, whole objects (QA / tests). */
  hidden: {meshes: number; triangles: number; instances: number; objects: number};
}

/** What the runtime reads from Game (structural: tests drive it with a fake host). */
export interface RidePortalHost {
  scene: THREE.Object3D;
  layout?: StationLayout | null;
  trainPlacement?: TrainPlacement | null;
  world?: {group: THREE.Object3D; culler?: unknown; rideGates?: RideGatesBuilt | null} | null;
  /** The holders and the shelf stock (with the world group: the station's static roots). */
  containers?: {group: THREE.Object3D} | null;
  stock?: {group: THREE.Object3D} | null;
  /** The movers hidden by their root. */
  zombies?: readonly {root: THREE.Object3D}[];
  pickups?: {list: readonly {obj: THREE.Object3D}[]} | null;
  marketPeople?: {traders: readonly {actor: {root: THREE.Object3D}}[]; residents: readonly {actor: {root: THREE.Object3D}}[]} | null;
  /** The car: its view (never cut) and size (what is inside it is never hidden). */
  trainRuntime?: {view: {root: THREE.Object3D} | null; spec: {length: number; width: number; roofY: number}} | null;
  mats?: WorldMaterials | null;
  camera?: THREE.Camera;
  /** Model-library geometry (shared across stations) is never partitioned. */
  propModels?: {ownsGeometry(g: THREE.BufferGeometry): boolean};
  warmRegistry?: {addPool(name: string, roots: () => readonly THREE.Object3D[]): void};
  sectionHooks?: {build?(layout: never): void; teardown?(): void}[];
}

/** A static mesh's triangles partitioned [front portal's | kept | rear portal's] (rule 1). */
interface Split { mesh: THREE.Mesh; geo: THREE.BufferGeometry; n: [number, number, number] }
/** An instance we hold hidden: whose cut, and its original matrix (rule 2). */
interface HiddenInstance { slot: 0 | 1; orig: Float32Array }
interface InstTrack {
  im: THREE.InstancedMesh;
  /** instanceMatrix.version / count as last looked at (after our own writes). */
  version: number; count: number;
  hidden: Map<number, HiddenInstance>;
}
type ObjKind = 'static' | 'actor' | 'item' | 'leaf';
interface Slot {
  which: PortalWhich; index: 0 | 1; portal: RidePortal; cut: PortalCut;
  gateView: RideGateView | null; breach: BreachHeadwall | null;
  engaged: boolean; releasing: boolean; releaseT: number;
  /** The gate's linear swing 0..1 and where it is going. */
  swing: number; target: number;
  /** RIDE_MASK.version when we last set the mask for this portal (-1: not ours). */
  maskVersion: number;
}

/** The first rotation element of a matrix we collapsed: tells it from another system's all-zero matrix (damage/propDamage.ts ZERO). */
const MARK = Math.fround(1e-30);
const IDENTITY = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _v = new THREE.Vector3(), _frustum = new THREE.Frustum(), _box = new THREE.Box3();
const ease = (t: number): number => t * t * (3 - 2 * t);

export class RidePortalRuntime {
  /** Node figures of the last bind / engage (ms) and what the bind found (QA / tests / the report). */
  readonly stats = {prepareMs: 0, engageMs: 0, scanned: 0, splits: 0, splitTriangles: 0, instanced: 0, late: 0};
  private slots: Slot[] = [];
  private bound: RidePortalHost['world'] | null = null;
  private splits: Split[] = [];
  private tracks = new Map<THREE.InstancedMesh, InstTrack>();
  /** Non-instanced renderables of the static roots that are cut whole (rule 3, decided when a portal engages). */
  private wholes: THREE.Object3D[] = [];
  private seen = new WeakSet<THREE.Object3D>();
  private users = new Map<THREE.BufferGeometry, number>();
  /** Objects WE made invisible -> how they are bounded. */
  private readonly objHidden = new Map<THREE.Object3D, {slot: 0 | 1; kind: ObjKind}>();
  private readonly explicit = new Set<THREE.Object3D>();
  private carOn = false;
  private readonly car = {hl: 0, hw: 0, top: 0};
  private readonly proxy = (eye: THREE.Vector3): void => { for (const s of this.slots) if (s.engaged && portalEye(s.portal, eye)) return; };

  constructor(readonly host: RidePortalHost) {}

  /** Section hooks (build: bind to the new station; teardown: release everything at once). Called once from the Game constructor. */
  install(): this {
    const h = this.host;
    h.sectionHooks?.push({build: () => this.bind(), teardown: () => this.unbind()});
    // hidden until used: the breach headwalls; and whatever a ride holds invisible while a warm-up runs (an arrival's build)
    h.warmRegistry?.addPool('ride-portals', () => this.warmRoots());
    return this;
  }

  /** The portal `which` of the current station (null without a car). */
  portal(which: PortalWhich): RidePortal | null { return this.slot(which)?.portal ?? null; }

  private slot(which: PortalWhich): Slot | null { return this.slots.find(s => s.which === which) ?? null; }

  // -------------------------------------------------------------------------------------------
  // Binding to a station

  /**
   * Bind to the host's current station (the section build hook; idempotent per world): its two portals, its gates, a breach's
   * headwall (hidden), and the cut PREPARED (rule 1's partitions, the instanced meshes) so that engaging is draw ranges and matrices.
   */
  bind(): void {
    const h = this.host, layout = h.layout, p = h.trainPlacement, world = h.world;
    if (this.bound && this.bound === world) return;
    this.unbind();
    if (!layout || !p || !world) return;
    const r = ridePortals(layout, p);
    this.slots = WHICH.map((which, i) => {
      const portal = r[which];
      const breach = portal.kind === 'breach' && h.mats ? buildBreachHeadwall(portal, h.mats, p.level) : null;
      if (breach) h.scene.add(breach.root);
      return {which, index: i as 0 | 1, portal, cut: portalCut(portal), gateView: world.rideGates?.gates.get(portalEndKey(portal)) ?? null, breach,
        engaged: false, releasing: false, releaseT: 0, swing: 0, target: 0, maskVersion: -1};
    });
    this.bound = world;
    const t0 = performance.now();
    this.prepare();
    this.stats.prepareMs = performance.now() - t0;
  }

  /** Leave the station (the section teardown hook): everything released at once, references dropped. */
  unbind(): void {
    for (const s of this.slots) if (s.engaged) this.finish(s);
    for (const [o] of this.objHidden) if (!o.visible) o.visible = true;
    this.objHidden.clear();
    for (const s of this.slots) {
      if (!s.breach) continue;
      s.breach.root.removeFromParent();
      s.breach.wall.geometry.dispose();
      s.breach.frame.geometry.dispose();
    }
    const cul = this.bound?.culler as {eyeProxy?: unknown} | undefined;
    if (cul && cul.eyeProxy === this.proxy) cul.eyeProxy = null;
    this.slots = [];
    this.bound = null;
    this.splits = [];
    this.tracks = new Map();
    this.wholes = [];
    this.seen = new WeakSet();
    this.users = new Map();
    Object.assign(this.stats, {scanned: 0, splits: 0, splitTriangles: 0, instanced: 0, late: 0});
  }

  private staticRoots(): THREE.Object3D[] {
    const h = this.host, out: THREE.Object3D[] = [];
    for (const r of [h.world?.group, h.containers?.group, h.stock?.group]) if (r) out.push(r);
    return out;
  }

  /**
   * Look at every renderable of the static roots not seen yet (all of them at the bind; later only what a lane added since): partition
   * a world-space merged mesh with triangles in a cut (rule 1), track an InstancedMesh (rule 2), list the rest (rule 3).
   */
  private prepare(late = false): void {
    if (!this.slots.length) return;
    const fresh: THREE.Mesh[] = [];
    for (const root of this.staticRoots()) root.traverse(o => {
      if (this.seen.has(o)) return;
      this.seen.add(o);
      if (o.userData.ridePortal || o.userData.trainTransit) return;
      const m = o as THREE.Mesh;
      if ((o as THREE.InstancedMesh).isInstancedMesh) { this.track(o as THREE.InstancedMesh); return; }
      if (!m.isMesh) { if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) this.wholes.push(o); return; }
      this.users.set(m.geometry, (this.users.get(m.geometry) ?? 0) + 1);
      fresh.push(m);
    });
    for (const m of fresh) {
      this.stats.scanned++;
      if (late) this.stats.late++;
      if (this.splittable(m)) this.split(m); else this.wholes.push(m);
    }
  }

  /** Rule 1 applies: one mesh's own world-space geometry (never a model's, a shared or a placed one), plain and whole. */
  private splittable(m: THREE.Mesh): boolean {
    const g = m.geometry;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m.material) || !m.matrixWorld.equals(IDENTITY)) return false;
    if ((this.users.get(g) ?? 0) !== 1 || this.host.propModels?.ownsGeometry(g)) return false;
    if (g.groups.length || g.drawRange.start !== 0 || g.drawRange.count !== Infinity || Object.keys(g.morphAttributes).length) return false;
    const pos = g.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos || pos.itemSize !== 3) return false;
    if (g.index) return true;
    // without an index the triangles are moved in every attribute: plain per-vertex buffers only
    return Object.values(g.attributes).every(a => (a as THREE.BufferAttribute).isBufferAttribute && !(a as unknown as {isInterleavedBufferAttribute?: boolean}).isInterleavedBufferAttribute && a.count === pos.count);
  }

  /**
   * Classify `m`'s triangles by the two cuts and, when any is cut, partition them [front | kept | rear] in place (stable). True when
   * the mesh needs no other handling (nothing of it is in a cut, or it is partitioned).
   */
  private split(m: THREE.Mesh): boolean {
    const g = m.geometry, pos = g.attributes.position as THREE.BufferAttribute, idx = g.index;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!, cuts = this.slots.map(s => s.cut);
    if (!cuts.some(c => boxOverlaps(c.box, bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z))) return true;
    const nT = Math.floor((idx ? idx.count : pos.count) / 3), cls = new Uint8Array(nT), n: [number, number, number] = [0, 0, 0];
    for (let t = 0; t < nT; t++) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx.getX(t * 3 + k) : t * 3 + k, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const c = cutHides(cuts[0], x0, y0, z0, x1, y1, z1) ? 0 : cuts[1] && cutHides(cuts[1], x0, y0, z0, x1, y1, z1) ? 2 : 1;
      cls[t] = c;
      n[c]++;
    }
    if (!n[0] && !n[2]) return true;
    const order = new Uint32Array(nT);
    let o = 0;
    for (const c of [0, 1, 2]) for (let t = 0; t < nT; t++) if (cls[t] === c) order[o++] = t;
    const move = (a: THREE.BufferAttribute, per: number): void => {
      const src = a.array as unknown as {length: number; slice(): ArrayLike<number>; [i: number]: number}, old = src.slice();
      for (let t = 0; t < nT; t++) { const from = order[t] * per, to = t * per; for (let k = 0; k < per; k++) src[to + k] = old[from + k]; }
      a.needsUpdate = true;
    };
    if (idx) move(idx, 3);
    else for (const a of Object.values(g.attributes)) move(a as THREE.BufferAttribute, 3 * a.itemSize);
    this.splits.push({mesh: m, geo: g, n});
    this.stats.splits++;
    this.stats.splitTriangles += n[0] + n[2];
    return true;
  }

  private track(im: THREE.InstancedMesh): InstTrack {
    let t = this.tracks.get(im);
    if (!t) { this.tracks.set(im, (t = {im, version: -1, count: -1, hidden: new Map()})); this.stats.instanced++; }
    return t;
  }

  // -------------------------------------------------------------------------------------------
  // The public surface (lane RIDE drives it)

  /**
   * A ride starts using portal `which`: hide the station's geometry in its cut, set the light mask, stand a breach's headwall.
   * `gateOpen`: the gate's state at once (an arrival finds it open; a departure starts shut and calls setGate). Idempotent: on an
   * engaged portal it only cancels a release under way.
   */
  engage(which: PortalWhich, opts: {gateOpen: boolean}): void {
    if (this.host.world && this.bound !== this.host.world) this.bind(); // (a world built without the section hooks)
    const s = this.slot(which);
    if (!s) return;
    if (s.engaged) { s.releasing = false; return; }
    const t0 = performance.now();
    this.prepare(true);
    s.engaged = true;
    s.releasing = false;
    s.swing = s.target = opts.gateOpen ? 1 : 0;
    s.gateView?.setOpen(ease(s.swing));
    if (s.breach) s.breach.root.visible = true;
    this.applySplits();
    this.sweep(true);
    setRideMask(s.portal.box, s.portal.x, PORTAL_RT.fade);
    s.maskVersion = RIDE_MASK.version;
    this.syncCuller();
    this.stats.engageMs = performance.now() - t0;
  }

  /** Swing the gate open / shut (animated by step). No-op on a breach and on a portal that is not engaged. */
  setGate(which: PortalWhich, open: boolean): void {
    const s = this.slot(which);
    if (s?.engaged && s.gateView && !s.releasing) s.target = open ? 1 : 0;
  }

  /** Gate swing 0..1 as posed (1 on an engaged breach). */
  gate(which: PortalWhich): number {
    const s = this.slot(which);
    if (!s) return 0;
    return s.gateView ? ease(s.swing) : s.engaged ? 1 : 0;
  }

  /** Per frame while a portal is engaged or releasing (`eye`: the camera, for the unobserved test of a breach's release). */
  step(dt: number, eye?: {x: number; y: number; z: number}): void {
    let any = false;
    for (const s of this.slots) {
      if (!s.engaged) continue;
      any = true;
      if (s.gateView && s.swing !== s.target) {
        const d = Math.max(0, dt) / PORTAL_RT.swing;
        s.swing = s.target > s.swing ? Math.min(s.target, s.swing + d) : Math.max(s.target, s.swing - d);
        s.gateView.setOpen(ease(s.swing));
      }
      if (!s.releasing) continue;
      s.releaseT += Math.max(0, dt);
      // a gate is released once it has shut; a breach once nobody can see its headwall go (or, at worst, after the timeout)
      if (s.gateView ? s.swing <= 0 : this.unobserved(s, eye) || s.releaseT >= PORTAL_RT.timeout) this.finish(s);
    }
    if (any && this.slots.some(s => s.engaged)) this.sweep(false);
  }

  /**
   * The ride is done with portal `which`: a gate shuts first, a breach's headwall goes once it is out of sight; then the station's own
   * geometry is drawn again and the light mask is cleared. `now`: at once (reset / teardown).
   */
  release(which: PortalWhich, opts: {now?: boolean} = {}): void {
    const s = this.slot(which);
    if (!s?.engaged) return;
    if (opts.now || (s.gateView && s.swing <= 0)) { this.finish(s); return; } // (a shut gate has nothing to wait for)
    if (s.releasing) return;
    s.releasing = true;
    s.releaseT = 0;
    s.target = 0;
  }

  /** The portal's cut is in force (also while it is being released). */
  engaged(which: PortalWhich): boolean { return this.slot(which)?.engaged ?? false; }

  /** QA readout. */
  state(which: PortalWhich): PortalState {
    const s = this.slot(which);
    const hidden = {meshes: 0, triangles: 0, instances: 0, objects: 0};
    if (!s) return {portal: null, engaged: false, releasing: false, gate: 0, hidden};
    if (s.engaged) {
      const k = s.index === 0 ? 0 : 2;
      for (const sp of this.splits) if (sp.n[k]) { hidden.meshes++; hidden.triangles += sp.n[k]; }
      for (const t of this.tracks.values()) for (const hi of t.hidden.values()) if (hi.slot === s.index) hidden.instances++;
      for (const o of this.objHidden.values()) if (o.slot === s.index) hidden.objects++;
    }
    return {portal: s.portal, engaged: s.engaged, releasing: s.releasing, gate: this.gate(which), hidden};
  }

  // -------------------------------------------------------------------------------------------
  // Engage / release mechanics

  /** A portal's release is complete: its cut is lifted, its headwall hidden, its gate shut, the mask and the culler's stand-in updated. */
  private finish(s: Slot): void {
    s.engaged = s.releasing = false;
    s.swing = s.target = 0;
    s.gateView?.setOpen(0);
    if (s.breach) s.breach.root.visible = false;
    this.applySplits();
    this.sweep(true);
    // the mask is cleared only when it is still the one we set (the ride sets its own for the transit box)
    if (s.maskVersion === RIDE_MASK.version) {
      const other = this.slots.find(o => o.engaged);
      if (other) { setRideMask(other.portal.box, other.portal.x, PORTAL_RT.fade); other.maskVersion = RIDE_MASK.version; } else setRideMask(null);
    }
    s.maskVersion = -1;
    this.syncCuller();
  }

  /** Rule 1: every partitioned mesh draws [front | kept | rear] less the engaged portals' parts. */
  private applySplits(): void {
    const f = this.slots[0]?.engaged ?? false, r = this.slots[1]?.engaged ?? false;
    for (const sp of this.splits) {
      if (sp.mesh.geometry !== sp.geo) continue;
      const [a, b, c] = sp.n;
      if (!(f && a) && !(r && c)) { sp.geo.setDrawRange(0, Infinity); continue; }
      const start = f ? a : 0, end = r ? a + b : a + b + c;
      sp.geo.setDrawRange(start * 3, (end - start) * 3);
    }
  }

  /** The level culler decides from the opening while an eye is beyond an engaged portal's plane; null when none is engaged. */
  private syncCuller(): void {
    const cul = this.bound?.culler as {eyeProxy?: unknown} | undefined;
    if (!cul || !('eyeProxy' in cul)) return;
    const on = this.slots.some(s => s.engaged);
    if (on) cul.eyeProxy = this.proxy;
    else if (cul.eyeProxy === this.proxy) cul.eyeProxy = null;
  }

  private engagedSlot(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Slot | null {
    for (const s of this.slots) if (s.engaged && cutHides(s.cut, x0, y0, z0, x1, y1, z1)) return s;
    return null;
  }

  /** The car's volume (its own frame): what is inside rides with it. */
  private readCar(): void {
    const rt = this.host.trainRuntime, root = rt?.view?.root;
    this.carOn = !!root && !!rt;
    if (!root || !rt) return;
    _inv.copy(root.matrixWorld).invert();
    this.car.hl = rt.spec.length / 2 + PORTAL_RT.carPad;
    this.car.hw = rt.spec.width / 2 + PORTAL_RT.carPad;
    this.car.top = rt.spec.roofY + PORTAL_RT.carPad;
  }

  private inCar(x: number, y: number, z: number): boolean {
    if (!this.carOn) return false;
    _v.set(x, y, z).applyMatrix4(_inv);
    return Math.abs(_v.x) <= this.car.hl && Math.abs(_v.z) <= this.car.hw && _v.y >= -1.6 && _v.y <= this.car.top;
  }

  /**
   * Rules 2 and 3 for the current set of engaged portals: `all` (an engage / a release) looks at every instanced mesh and the static
   * roots' whole objects; a step only at instanced meshes whose matrices changed, at what we hold hidden and at the things that move.
   */
  private sweep(all: boolean): void {
    this.readCar();
    for (const t of this.tracks.values()) {
      const a = t.im.instanceMatrix;
      if (all || a.version !== t.version || t.im.count !== t.count) this.scanInstances(t);
    }
    // what we hold hidden and no longer should (it left the cut, boarded the car, its portal was released)
    for (const [o, e] of this.objHidden) {
      if (this.slots[e.slot]?.engaged && this.wants(o, e.kind) === this.slots[e.slot]) continue;
      if (!o.visible) o.visible = true;
      this.objHidden.delete(o);
    }
    if (!this.slots.some(s => s.engaged)) return;
    if (all) for (const o of this.wholes) this.consider(o, 'static');
    const h = this.host, ex = this.explicit;
    ex.clear();
    for (const z of h.zombies ?? []) { ex.add(z.root); this.consider(z.root, 'actor'); }
    for (const list of [h.marketPeople?.traders, h.marketPeople?.residents]) for (const q of list ?? []) { ex.add(q.actor.root); this.consider(q.actor.root, 'actor'); }
    for (const q of h.pickups?.list ?? []) { ex.add(q.obj); this.consider(q.obj, 'item'); }
    const car = h.trainRuntime?.view?.root;
    if (car) ex.add(car);
    for (const r of this.staticRoots()) ex.add(r);
    for (const c of h.scene.children) this.walk(c);
  }

  /** Everything else the scene draws (carts, bags, loose props, lane content): each visible renderable by its own bounds. */
  private walk(o: THREE.Object3D): void {
    if (!o.visible || this.explicit.has(o) || o.userData.ridePortal || o.userData.trainTransit || (o as THREE.Camera).isCamera) return;
    if ((o as THREE.InstancedMesh).isInstancedMesh) { if (!this.tracks.has(o as THREE.InstancedMesh)) this.scanInstances(this.track(o as THREE.InstancedMesh)); }
    else if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) this.consider(o, 'leaf');
    for (const c of o.children) this.walk(c);
  }

  private consider(o: THREE.Object3D, kind: ObjKind): void {
    if (!o.visible || this.objHidden.has(o)) return;
    const s = this.wants(o, kind);
    if (!s) return;
    o.visible = false;
    this.objHidden.set(o, {slot: s.index, kind});
  }

  /** The engaged portal whose cut holds object `o` (null: none, or it rides in the car). */
  private wants(o: THREE.Object3D, kind: ObjKind): Slot | null {
    const e = o.matrixWorld.elements;
    if (kind === 'actor' || kind === 'item') {
      // (a mover's root sits in the scene: its position is its world position, a frame ahead of its matrix)
      const p = o.parent === this.host.scene ? o.position : _v.setFromMatrixPosition(o.matrixWorld), x = p.x, y = p.y, z = p.z;
      const r = kind === 'actor' ? PORTAL_RT.actor[0] : PORTAL_RT.item, up = kind === 'actor' ? PORTAL_RT.actor[1] : PORTAL_RT.item;
      if (this.inCar(x, y + up / 2, z)) return null;
      return this.engagedSlot(x - r, y - 0.1, z - r, x + r, y + up, z + r);
    }
    // (never frustum-culled = no bounds of its own: a pool of particles, a level-wide effect — not ours to judge)
    if (o.frustumCulled === false) return null;
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    let cx = e[12], cy = e[13], cz = e[14], r = 0.5;
    if (g && !(o as THREE.Sprite).isSprite) {
      let bs: THREE.Sphere | null = (o as THREE.SkinnedMesh).boundingSphere ?? g.boundingSphere;
      if (!bs) { g.computeBoundingSphere(); bs = g.boundingSphere; }
      if (!bs || !Number.isFinite(bs.radius)) return null;
      const c = bs.center;
      cx = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12]; cy = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13]; cz = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
      r = bs.radius * Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    }
    if (this.inCar(cx, cy, cz)) return null;
    return this.engagedSlot(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
  }

  /**
   * Rule 2 for one instanced mesh: restore what we hold that should show again, forget what another system rewrote, hide what lies in
   * an engaged cut (never what rides in the car, never an instance already collapsed by someone else).
   */
  private scanInstances(t: InstTrack): void {
    const im = t.im, attr = im.instanceMatrix, a = attr.array as Float32Array, g = im.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!, lc = bb.getCenter(_v), lx = lc.x, ly = lc.y, lz = lc.z;
    const hx = (bb.max.x - bb.min.x) / 2, hy = (bb.max.y - bb.min.y) / 2, hz = (bb.max.z - bb.min.z) / 2;
    const W = im.matrixWorld, ident = W.equals(IDENTITY), any = this.slots.some(s => s.engaged);
    let dirty = false;
    const n = Math.min(im.count, a.length / 16);
    for (const [i, hi] of t.hidden) {
      const o = i * 16;
      // still the matrix we wrote? (else another system owns the instance now: its value stands)
      const ours = i < n && a[o] === MARK && a[o + 1] === 0 && a[o + 2] === 0 && a[o + 4] === 0 && a[o + 5] === 0 && a[o + 6] === 0 && a[o + 8] === 0 && a[o + 9] === 0 && a[o + 10] === 0
        && a[o + 12] === hi.orig[12] && a[o + 13] === hi.orig[13] && a[o + 14] === hi.orig[14];
      if (ours) { a.set(hi.orig, o); dirty = true; }
      t.hidden.delete(i);
    }
    if (any) for (let i = 0; i < n; i++) {
      const o = i * 16;
      if (a[o] === 0 && a[o + 1] === 0 && a[o + 2] === 0 && a[o + 5] === 0 && a[o + 10] === 0) continue; // (collapsed by its owner: not shown)
      let e: ArrayLike<number> = a, q = o;
      if (!ident) { _m.fromArray(a, o).premultiply(W); e = _m.elements; q = 0; }
      const cx = e[q] * lx + e[q + 4] * ly + e[q + 8] * lz + e[q + 12], cy = e[q + 1] * lx + e[q + 5] * ly + e[q + 9] * lz + e[q + 13], cz = e[q + 2] * lx + e[q + 6] * ly + e[q + 10] * lz + e[q + 14];
      const ex = Math.abs(e[q]) * hx + Math.abs(e[q + 4]) * hy + Math.abs(e[q + 8]) * hz, ey = Math.abs(e[q + 1]) * hx + Math.abs(e[q + 5]) * hy + Math.abs(e[q + 9]) * hz, ez = Math.abs(e[q + 2]) * hx + Math.abs(e[q + 6]) * hy + Math.abs(e[q + 10]) * hz;
      const s = this.engagedSlot(cx - ex, cy - ey, cz - ez, cx + ex, cy + ey, cz + ez);
      if (!s || this.inCar(cx, cy, cz)) continue;
      t.hidden.set(i, {slot: s.index, orig: a.slice(o, o + 16)});
      a[o] = MARK;
      a[o + 1] = a[o + 2] = a[o + 4] = a[o + 5] = a[o + 6] = a[o + 8] = a[o + 9] = a[o + 10] = 0;
      dirty = true;
    }
    if (dirty) attr.needsUpdate = true;
    t.version = attr.version;
    t.count = im.count;
  }

  /** Nobody can see the portal's plane: further than PORTAL_RT.unseen from the eye, or outside the camera's view. */
  private unobserved(s: Slot, eye?: {x: number; y: number; z: number}): boolean {
    const q = s.portal, f = q.face;
    if (eye && Math.hypot(eye.x - q.x, eye.y - (f.y0 + f.y1) / 2, eye.z - (f.z0 + f.z1) / 2) > PORTAL_RT.unseen) return true;
    const cam = this.host.camera;
    if (!cam) return false;
    cam.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    _box.min.set(q.x - 0.2, f.y0, f.z0);
    _box.max.set(q.x + 0.2, f.y1, f.z1);
    return !_frustum.intersectsBox(_box);
  }

  /** The warm-up pool: the breach headwalls (hidden until used) and whatever we hold invisible right now. */
  private warmRoots(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const s of this.slots) if (s.breach) out.push(s.breach.root);
    for (const o of this.objHidden.keys()) out.push(o);
    return out;
  }
}

/** Installs the ride portals (one call in the Game constructor, before the ride). */
export function installRidePortals(host: RidePortalHost): RidePortalRuntime {
  return new RidePortalRuntime(host).install();
}
