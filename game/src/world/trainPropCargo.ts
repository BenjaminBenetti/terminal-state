// Task studio-beta-train-all-cargo-20261107-184244-01 (user: "Let’s have all items on the train move with the train!" — confirmed for the
// movable furniture / decor / containers too): the TRAIN'S PROP CARGO. Every MOVABLE layout prop (physics/dynamicItems.ts dynamicKind:
// chairs, bins, suitcases, strollers, plush, record crates, LP bins, book stacks, camp chairs, mannequins, garment rails … 118 kinds over
// every level's builder family) that the player pushes or knocks into the parked train travels with it, as one entity with the decor
// riding it (ridesHost: garments on a rail), keeping its look (kind, variant, size, purpose), its integrity and its exact pose.
//
// OWNERSHIP (the item cargo's rule for props): a LOOSE prop whose collider centre lies inside the parked car's interior volume
// (world/trainCargo.ts insideCar, train-local) belongs to the TRAIN; anything else to the station it lies in. No suck radius. A prop whose
// collider straddles the car's wall line (a doorway) refuses the departure (departBlock, like a fuel cart in a doorway): the doors never cut
// a prop and nothing is moved through them.
// EVERYTHING ABOARD TRAVELS (task studio-beta-train-cargo-overflow-20261107-210410-01): ownership is where a prop lies, never a capacity cut.
// More than CARGO.maxProps (256) props aboard, or one carrying more than CARGO.maxRiders (32) riders, refuses the departure in the same
// pre-departure check (Game.fuelCheck: before the fuel draw, the carts' capture, the doors and any capture); records are never cut to fit.
// No prop holds a render slot (the damage system's 96 detach cap) while it rests in the car or rides: carried props are handed back to their
// shared instances once adopted (DynamicItems.handBack), withdrawn ones' instances are hidden.
//
// IDENTITY: '<section id>#<generated layout index>' of the placement it was generated as (kept through every move). The source station
// remembers it GONE (lane STATION_PROPS_LANE `gone`: hidden on every rebuild, never respawned); a station it is left in owns it (`here`).
//
// LIFECYCLE
//  - Layout (Game.sectionLayoutHooks; prepare: a superset for the model keys / art preloads, build: exactly the records): carried props
//    are APPENDED to the end of layout.props — the station's `here` props at their world poses, the train's at their train-local poses in
//    the layout's parked car (playerTrainPlacement, computed before anything is appended). Every family builder draws them, holders are
//    built for containers (emptied here: their lots spilled where they were knocked over), the prop index / physics see them.
//  - Build (sectionHooks.build, last: after the train's floor colliders): gone originals are hidden (instances zeroed, no collision, a
//    holder emptied and removed); each carried prop is made LOOSE at its exact pose (DynamicItems.adoptLoose): a resting body, pushed by
//    walking into it, shot … like any loose prop. An arriving (riding) build keeps the train's hidden until the stop.
//  - Ride start (doors closing / departing): the train's props leave the station (DynamicItems.withdraw; their objects out of the scene)
//    and ride as copies of their drawn meshes on the car's view root at their train-local poses; the ride's car-local collision model
//    gets their footprints (world/trainRideLocal.ts setRideCargoBoxes, shared with the fuel carts).
//  - Ride end (stopped at a placement): the copies go; the props are loose in the parked car again (the same world: the withdrawn ones;
//    a new one: its hidden copies).
//  - Teardown (FIRST) / the ending flush: the train's props (riding / in the parked car) are the train's records (TrainCargo.liveProps);
//    the station's lane gets its `gone` and `here`.
// Containers: every movable container is a spill holder — knocked loose it spills its finite lots as pickups, once (containers.ts goLoose),
// so a carried container is open and empty and its items travel as item cargo; an appended holder copy is emptied (no invented loot).

import * as THREE from 'three';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {playerTrainPlacement, trainToWorld, worldToTrain, type TrainPlacement} from '../gen/playerTrain';
import {sectionId, type SectionKey} from '../levels/types';
import {CARGO, STATION_PROPS_LANE, cargoPropsOf, stationPropsOf, type CargoPropJSON, type CargoRiderJSON, type GonePropJSON, type StationPropsJSON} from '../run/trainCargo';
import {PROP_DATA_KEY} from '../damage/propDamage';
import type {LooseProp} from '../physics/dynamicItems';
import {RIDE_FRAME, setRideCargoBoxes, type RideLocalModel} from './trainRideLocal';
import type {PlayerTrainSpec} from './playerTrainSpec';

export const PROP_CARGO = {
  /** A collider corner this far past the car's wall line counts as outside / inside (m): props resting against a wall are not straddling. */
  wallTol: 0.06,
  /** Riding footprints: columns from below the floor (step frame y) to the prop's top. */
  rideBase: -1,
} as const;

export const PROP_CARGO_TEXT = {
  doorway: 'Something is stuck in the train doorway — push it fully inside or out onto the platform',
  // task studio-beta-train-cargo-overflow-20261107-210410-01: everything aboard travels, or the train does not leave
  overloaded: (n: number) => `The train is overloaded — ${n} loose things lie in it, at most ${CARGO.maxProps} can travel. Push ${n - CARGO.maxProps} out first`,
  overhung: `Too much hangs on one thing in the train (at most ${CARGO.maxRiders}) — take some of it off first`,
} as const;

type Phase = 'prepare' | 'build';
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), QY = new THREE.Quaternion(), M = new THREE.Matrix4(), S = new THREE.Vector3();
const r5 = (v: number) => (Math.round(v * 1e5) / 1e5) || 0;
/** (run/trainCargo.ts lookProblem's purpose rule: a record is always valid) */
const PURPOSE_OK = /^[\x20-\x7e]{1,64}$/;
const quarter = (rot: number) => Math.round(rot / (Math.PI / 2)) & 1;
const placeM = (p: PropPlacement) => new THREE.Matrix4().compose(V.set(p.x, p.y, p.z), Q.setFromAxisAngle(UP, p.rot), ONE);

/** A canonical unit quaternion (w >= 0, rounded: a record round-trips exactly). */
function quat(q: THREE.Quaternion): [number, number, number, number] {
  const n = q.clone().normalize();
  if (n.w < 0) n.set(-n.x, -n.y, -n.z, -n.w);
  return [r5(n.x), r5(n.y), r5(n.z), r5(n.w)];
}

/** The placement's object-frame size (width x, depth z, height) from its AABB half extents + quarter-turn yaw. */
function sizeOf(p: PropPlacement, h: number): {w: number; d: number; h: number} {
  const q = quarter(p.rot), c = (v: number) => r5(Math.max(0.01, Math.min(CARGO.size, v)));
  return {w: c((q ? p.hz : p.hx) * 2), d: c((q ? p.hx : p.hz) * 2), h: c(h)};
}

/** Yaw about +Y of an orientation (YXZ order), snapped to a quarter turn in (-PI, PI]. */
function quarterYaw(q: THREE.Quaternion): number {
  const y = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  let r = Math.round(y / (Math.PI / 2)) * (Math.PI / 2);
  if (r <= -Math.PI + 1e-9) r += 2 * Math.PI;
  return Math.abs(r) < 1e-9 ? 0 : r;
}

interface Hidden { obj: THREE.Object3D; parent: THREE.Object3D | null }
/** A shared instance hidden (zero matrix) and the matrix it drew with. */
interface HiddenInstance { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }
/**
 * A withdrawn prop: out of the simulation and the scene. Task cargo-overflow: it holds NO render slot (the damage system's detach cap) —
 * its own meshes are handed back to its shared instances (PropDamage.reattach), which are then hidden; only a prop that cannot hand them
 * back (a broken body) keeps its own meshes (`parts`, out of the scene).
 */
interface Withdrawn { prop: PropPlacement; index: number; matrix: THREE.Matrix4; parts: Hidden[]; inst: HiddenInstance[]; riders: PropPlacement[] }

interface Appended {
  rec: CargoPropJSON;
  owner: 'train' | 'station';
  prop: PropPlacement;
  riders: PropPlacement[];
  /** The exact object -> world matrix it is adopted at. */
  matrix: THREE.Matrix4;
}

interface RidingProp {
  rec: CargoPropJSON;
  /** The copy on the car's view root (null: none could be drawn — it still travels). */
  obj: THREE.Group | null;
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  /** The withdrawn prop in the live world (gen = the world it belongs to): a stop there shows it again. */
  src: (Withdrawn & {gen: number}) | null;
}

interface HolderLike { holderFor(p: PropPlacement): unknown; emptyHolder(p: PropPlacement): boolean; removeHolder(p: PropPlacement): boolean; ownRoot?(p: PropPlacement): THREE.Object3D | null }

/** What the system needs of Game (structural: the Node tests drive it with the real physics / damage / containers / train / ride). */
export interface PropCargoHost {
  run: {
    current: SectionKey;
    laneStore<T = unknown>(lane: string, key?: SectionKey): T | undefined;
    setLaneStore(lane: string, data: unknown, key?: SectionKey): void;
    entry?: {lanes: Record<string, unknown>; memories: Record<string, {lanes?: Record<string, unknown>}>} | null;
  };
  layout: StationLayout | null;
  physics: {
    dynamicItems: {
      loose(): LooseProp[];
      adoptLoose(prop: PropPlacement, index: number, at: THREE.Matrix4, target?: THREE.Matrix4): boolean;
      handBack?(prop: PropPlacement): boolean;
      withdraw(prop: PropPlacement, o?: {detach?: boolean}): {matrix: THREE.Matrix4; parts: THREE.Object3D[]} | null;
      restHeight(prop: PropPlacement): number;
    };
    propsChanged(x: number, z: number): void;
  };
  damage: {props: {index: {inst: Map<PropPlacement, {mesh: THREE.InstancedMesh; index: number}[]>}; states: Map<PropPlacement, {hp: number; spec: {integrity: number}; parts?: unknown[] | null}>;
    state(prop: PropPlacement, index?: number): {hp: number; spec: {integrity: number}}; reattach?(prop: PropPlacement, dropMarks?: boolean): string}};
  containers: HolderLike | null;
  trainRuntime?: {spec: PlayerTrainSpec; view: {root: THREE.Object3D} | null; train: {placement: TrainPlacement} | null} | null;
  trainRide?: {riding: boolean; phase: string; model?: RideLocalModel} | null;
  playerTrain: {cargo: {liveProps: {props(): CargoPropJSON[]; restoreProps(props: CargoPropJSON[]): void} | null}};
  sectionLayoutHooks: ((layout: StationLayout, key: SectionKey, run: unknown, phase: Phase) => void)[];
  sectionHooks: {holders?(layout: never): void; build?(layout: never): void; teardown?(): void}[];
  frameHooks: ((dt: number) => void)[];
  warmRegistry?: {addPool(name: string, f: () => readonly THREE.Object3D[]): void} | null;
  /** Are the lazy models these carried placements need loaded (Game: propModels)? Absent: yes. */
  carriedModelsReady?(layout: StationLayout, props: readonly PropPlacement[]): boolean;
}

export class TrainPropCargo {
  /** Props riding the car's view root (a ride's start .. its stop). */
  readonly riding: RidingProp[] = [];
  /** The train's props waiting for a world with the car (a teardown without a ride, a load). */
  pending: CargoPropJSON[] = [];
  /** A ride took the train's props (released once the ride has ended). */
  private captured = false;
  /** World generation (a withdrawn prop belongs to the world it was withdrawn from). */
  private gen = 0;
  /**
   * The live world's bookkeeping. `goneNow`: generated props withdrawn into the riding train (with their riders); a generated prop lying in
   * the parked car is gone too, decided by its position at flush time (pushed back out, it is the station's again).
   */
  private here: {key: SectionKey; layout: StationLayout; gone: GonePropJSON[]; appended: Appended[]; goneNow: Map<PropPlacement, GonePropJSON>; deferred: CargoPropJSON[]} | null = null;
  /** Each layout's generated indices (identity) and parked car (computed before anything is appended). */
  private readonly genIndex = new WeakMap<StationLayout, Map<PropPlacement, number>>();
  private readonly trainAt = new WeakMap<StationLayout, TrainPlacement | null>();
  private readonly appendedOf = new WeakMap<StationLayout, Appended[]>();
  /** Station records a build could not draw (a model fetch failed): kept in the station's lane as they were. */
  private readonly deferredOf = new WeakMap<StationLayout, CargoPropJSON[]>();
  /** Props of a decoded save not yet installed (Game.decodeSave): their models are fetched by the prepare. */
  private readonly prepared = new WeakMap<object, CargoPropJSON[]>();
  /** QA / tests. */
  readonly counts = {appended: 0, adopted: 0, hidden: 0, captured: 0, released: 0, pending: 0, deferred: 0, blocked: 0, restores: 0, flushes: 0};

  constructor(readonly host: PropCargoHost) {}

  install(): this {
    const h = this.host;
    h.sectionLayoutHooks.push((layout, key, run, phase) => this.onLayout(layout, key, run as PropCargoHost['run'], phase));
    // teardown FIRST (before the memory flush / other lanes save the section), holders after the fuel holders, build LAST (after the train)
    h.sectionHooks.unshift({teardown: () => this.onTeardown()});
    h.sectionHooks.push({holders: () => this.onHolders(), build: () => this.onBuild()});
    h.frameHooks.push(() => this.frame());
    h.playerTrain.cargo.liveProps = {props: () => this.props(), restoreProps: p => this.restoreProps(p)};
    h.warmRegistry?.addPool('train-cargo-props', () => this.riding.flatMap(r => (r.obj ? [r.obj] : [])));
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Ownership

  private get spec(): PlayerTrainSpec | null { return this.host.trainRuntime?.spec ?? null; }
  private get isRiding(): boolean { return !!this.host.trainRide?.riding; }

  /** The car standing parked (built, not riding), else null. */
  parked(): TrainPlacement | null {
    return this.isRiding ? null : this.host.trainRuntime?.train?.placement ?? null;
  }

  /** A train-local point inside the car interior, between its floor and ceiling (world/trainCargo.ts insideCar). */
  insideCar(lx: number, ly: number, lz: number, pad = 0): boolean {
    const Sp = this.spec;
    if (!Sp) return false;
    return lx > Sp.interior.x0 - pad && lx < Sp.interior.x1 + pad && Math.abs(lz) < Sp.interior.halfWidth + pad && ly > Sp.floorY - 0.3 && ly < Sp.ceilingY;
  }

  /** A loose prop's collider centre, train-local. */
  private localCentre(lp: LooseProp, p: TrainPlacement): {x: number; y: number; z: number} {
    V.copy(lp.center).applyMatrix4(lp.matrix);
    return worldToTrain(p, V.x, V.y, V.z);
  }

  /** The loose prop lies in the parked car: the train's. */
  ownsLoose(lp: LooseProp, p: TrainPlacement | null = this.parked()): boolean {
    if (!p) return false;
    const c = this.localCentre(lp, p);
    return this.insideCar(c.x, c.y, c.z);
  }

  /**
   * The train's loose props now (in the parked car `p`), by identity — ALL of them: ownership is where a prop lies, never a capacity cut
   * (task cargo-overflow: more than CARGO.maxProps refuses the departure instead, departBlock).
   */
  private trainOwned(p: TrainPlacement | null = this.parked()): {lp: LooseProp; id: string}[] {
    if (!p || !this.here) return [];
    const out: {lp: LooseProp; id: string}[] = [];
    for (const lp of this.host.physics.dynamicItems.loose()) {
      if (!this.ownsLoose(lp, p)) continue;
      const id = this.idOf(lp.prop);
      if (id) out.push({lp, id});
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Task cargo-overflow: the props that would travel now (riding, aboard, waiting) — the departure's count. */
  aboardCount(): number {
    return this.riding.length + this.trainOwned().length + this.pending.length;
  }

  /** The 8 collider corners of a loose prop, train-local. */
  private corners(lp: LooseProp, p: TrainPlacement): {x: number; y: number; z: number}[] {
    const out: {x: number; y: number; z: number}[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      V.set(lp.center.x + sx * lp.half.x, lp.center.y + sy * lp.half.y, lp.center.z + sz * lp.half.z).applyMatrix4(lp.matrix);
      out.push(worldToTrain(p, V.x, V.y, V.z));
    }
    return out;
  }

  /**
   * The departure refusal (Game.fuelCheck, with the fuel carts' doorway rule; checked BEFORE the fuel draw, the carts' capture, the doors
   * and any capture of ours): a loose prop straddling the car's wall line — its collider centre inside the car with a corner well outside,
   * or the other way round — would be cut by the doors. Task cargo-overflow: everything aboard travels or the train does not leave — more
   * than CARGO.maxProps props aboard (riding / in the car / waiting), or one carrying more than CARGO.maxRiders riders, refuses too.
   * Null: free to leave.
   */
  departBlock(): string | null {
    const p = this.parked(), Sp = this.spec;
    if (!p || !Sp) return null;
    const aboard = this.trainOwned(p), n = aboard.length + this.riding.length + this.pending.length;
    if (n > CARGO.maxProps) { this.counts.blocked++; return PROP_CARGO_TEXT.overloaded(n); }
    if (aboard.some(a => a.lp.riders.length > CARGO.maxRiders)) { this.counts.blocked++; return PROP_CARGO_TEXT.overhung; }
    const T = PROP_CARGO.wallTol;
    for (const lp of this.host.physics.dynamicItems.loose()) {
      const c = this.localCentre(lp, p);
      if (c.x < Sp.interior.x0 - 3 || c.x > Sp.interior.x1 + 3 || Math.abs(c.z) > Sp.interior.halfWidth + 3) continue;
      const cs = this.corners(lp, p).filter(q => q.y > Sp.floorY - 0.3 && q.y < Sp.ceilingY);
      const inside = this.insideCar(c.x, c.y, c.z);
      const straddles = inside ? cs.some(q => !this.insideCar(q.x, Math.max(q.y, Sp.floorY), q.z, T)) : cs.some(q => this.insideCar(q.x, Math.max(q.y, Sp.floorY), q.z, -T));
      if (straddles) { this.counts.blocked++; return PROP_CARGO_TEXT.doorway; }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Records

  /** The canonical identity of a live prop: its carried id, else '<section id>#<generated index>' (null: not a generated placement). */
  private idOf(prop: PropPlacement): string | null {
    if (prop.cargo) return prop.cargo;
    const w = this.here, i = w ? this.genIndex.get(w.layout)?.get(prop) : undefined;
    return w && i !== undefined ? `${sectionId(w.key)}#${i}` : null;
  }

  /** A loose prop as a record: its pose in the train frame (`p`) or the world (+ its storey). */
  recordOf(lp: LooseProp, id: string, p: TrainPlacement | null): CargoPropJSON {
    const di = this.host.physics.dynamicItems, prop = lp.prop;
    lp.matrix.decompose(V, Q, S);
    let pos = {x: V.x, y: V.y, z: V.z};
    if (p) { pos = worldToTrain(p, V.x, V.y, V.z); Q.premultiply(QY.setFromAxisAngle(UP, -p.yaw)); }
    const rec: CargoPropJSON = {id, kind: prop.kind, variant: Math.max(0, prop.variant | 0), ...sizeOf(prop, di.restHeight(prop)), x: r5(pos.x), y: r5(pos.y), z: r5(pos.z), q: quat(Q)};
    if (prop.purpose && PURPOSE_OK.test(prop.purpose)) rec.purpose = prop.purpose;
    if (!p) rec.level = prop.level ?? 0;
    const st = this.host.damage.props.states.get(prop);
    if (st && st.spec.integrity > 0 && st.hp < st.spec.integrity) rec.hp = r5(Math.max(0, st.hp) / st.spec.integrity);
    if (lp.riders.length) {
      rec.riders = lp.riders.map(r => { // (never cut: more than CARGO.maxRiders refuses the departure)
        r.rel.decompose(V2, Q, S);
        const rr: CargoRiderJSON = {kind: r.prop.kind, variant: Math.max(0, r.prop.variant | 0), ...sizeOf(r.prop, di.restHeight(r.prop)), x: r5(V2.x), y: r5(V2.y), z: r5(V2.z), q: quat(Q)};
        if (r.prop.purpose && PURPOSE_OK.test(r.prop.purpose)) rr.purpose = r.prop.purpose;
        return rr;
      });
    }
    return rec;
  }

  /** The train's props now (save time): riding, the train's loose props in the parked car, pending. Copies. */
  props(): CargoPropJSON[] {
    const out = this.riding.map(r => structuredClone(r.rec));
    const p = this.parked();
    for (const {lp, id} of this.trainOwned(p)) out.push(this.recordOf(lp, id, p));
    for (const r of this.pending) out.push(structuredClone(r));
    const seen = new Set<string>();
    // (never cut to CARGO.maxProps: a departure beyond it is refused; a save beyond it is refused as invalid — nothing silently left out)
    return out.filter(r => !seen.has(r.id) && !!seen.add(r.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Load / Continue / Retry / New game: the train's props become exactly `props` (its current ones leave the world first). */
  restoreProps(props: readonly CargoPropJSON[]): void {
    this.counts.restores++;
    for (const r of this.riding.splice(0)) this.dropCopy(r);
    this.captured = false;
    this.rideBoxes();
    const p = this.parked();
    if (p && this.here) for (const lp of this.host.physics.dynamicItems.loose()) if (this.ownsLoose(lp, p)) this.withdraw(lp); // (replaced by the record)
    this.pending = props.map(r => structuredClone(r));
  }

  /** Task train-all-cargo: a decoded save's train props (not installed yet) — the prepare fetches their models too. */
  notePrepared(run: object, participants: Record<string, unknown> | undefined): void {
    const t = participants?.['player-train'] as {cargo?: unknown} | undefined;
    this.prepared.set(run, cargoPropsOf(t?.cargo));
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Layout augmentation (prepare / build)

  /** Carried props -> placements appended to the end of layout.props (see the header). Idempotent per phase. */
  onLayout(layout: StationLayout, key: SectionKey, run: PropCargoHost['run'], phase: Phase): void {
    if (!this.genIndex.has(layout)) {
      const m = new Map<PropPlacement, number>();
      layout.props.forEach((q, i) => m.set(q, i));
      this.genIndex.set(layout, m);
      this.trainAt.set(layout, playerTrainPlacement(layout)); // (before anything is appended: the car's spot never moves for cargo)
    }
    for (let i = layout.props.length - 1; i >= 0; i--) if (layout.props[i].cargo) layout.props.splice(i, 1);
    const st = stationPropsOf(run.laneStore(STATION_PROPS_LANE, key));
    const here = [...st.here], train = [...this.riding.map(r => r.rec), ...this.pending];
    if (phase === 'prepare') {
      // a superset: the Retry snapshot's records and a decoded save's (installed only after the prepare) — their models are fetched too
      const snap = run.entry;
      here.push(...stationPropsOf(snap?.memories?.[sectionId(key)]?.lanes?.[STATION_PROPS_LANE]).here);
      train.push(...cargoPropsOf((snap?.lanes?.['player-train'] as {cargo?: unknown} | undefined)?.cargo), ...(this.prepared.get(run) ?? []));
    } else {
      const gen = this.genIndex.get(layout)!;
      const byIndex = new Map<number, PropPlacement>();
      for (const [q, i] of gen) byIndex.set(i, q);
      for (const g of st.gone) { const q = byIndex.get(g.i); if (q && q.kind === g.kind) q.cargoGone = true; }
    }
    const out: Appended[] = [], ids = new Set<string>(), tp = this.trainAt.get(layout) ?? null, deferred: CargoPropJSON[] = [];
    const add = (rec: CargoPropJSON, owner: 'train' | 'station', m: THREE.Matrix4, level: number) => {
      if (ids.has(rec.id) || !Object.prototype.hasOwnProperty.call(PROP_DEFS, rec.kind)) return;
      ids.add(rec.id);
      const a = this.placementsOf(layout, rec, owner, m, level);
      if (phase === 'build' && this.host.carriedModelsReady && !this.host.carriedModelsReady(layout, [a.prop, ...a.riders])) {
        this.counts.deferred++;
        if (owner === 'station') deferred.push(structuredClone(rec)); // (the train's stays pending)
        return;
      }
      layout.props.push(a.prop, ...a.riders);
      out.push(a);
    };
    if (tp) for (const rec of train) add(rec, 'train', this.trainMatrix(tp, rec), tp.level);
    for (const rec of here) add(rec, 'station', new THREE.Matrix4().compose(V.set(rec.x, rec.y, rec.z), Q.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize(), ONE), rec.level ?? 0);
    this.appendedOf.set(layout, out);
    this.deferredOf.set(layout, deferred);
    if (phase === 'build') this.counts.appended += out.length;
  }

  /** A train record's object -> world matrix in the parked car `p` (a pose from a save clamped into the interior: always aboard). */
  private trainMatrix(p: TrainPlacement, rec: CargoPropJSON): THREE.Matrix4 {
    const Sp = this.spec;
    let {x, y, z} = rec;
    if (Sp) {
      x = Math.max(Sp.interior.x0 + 0.05, Math.min(Sp.interior.x1 - 0.05, x));
      z = Math.max(-Sp.interior.halfWidth + 0.05, Math.min(Sp.interior.halfWidth - 0.05, z));
      y = Math.max(Sp.floorY - 0.3, Math.min(Sp.ceilingY - 0.05, y));
    }
    const w = trainToWorld(p, x, y, z);
    Q.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize().premultiply(QY.setFromAxisAngle(UP, p.yaw));
    return new THREE.Matrix4().compose(V.set(w.x, w.y, w.z), Q, ONE);
  }

  /** The placement drawing a record (at its pose with the yaw snapped to a quarter turn; adoptLoose puts it exactly) + its riders'. */
  private placementsOf(layout: StationLayout, rec: CargoPropJSON, owner: 'train' | 'station', m: THREE.Matrix4, level: number): Appended {
    m.decompose(V, Q, S);
    const rot = quarterYaw(Q), kind = rec.kind as PropKind;
    const qt = quarter(rot), area = this.areaNear(layout, level, V.x, V.z);
    const prop: PropPlacement = {kind, x: r5(V.x), z: r5(V.z), y: r5(V.y), rot, area, hx: (qt ? rec.d : rec.w) / 2, hz: (qt ? rec.w : rec.d) / 2, h: rec.h,
      blocksSight: false, variant: rec.variant, level, cargo: rec.id};
    if (rec.purpose) prop.purpose = rec.purpose;
    const riders: PropPlacement[] = [];
    const host = layout.props.length;
    (rec.riders ?? []).forEach((r, k) => {
      if (!Object.prototype.hasOwnProperty.call(PROP_DEFS, r.kind)) return;
      const rm = placeM(prop).multiply(new THREE.Matrix4().compose(V2.set(r.x, r.y, r.z), Q.set(r.q[0], r.q[1], r.q[2], r.q[3]).normalize(), ONE));
      rm.decompose(V2, Q, S);
      const rr = quarterYaw(Q), q2 = quarter(rr);
      const rp: PropPlacement = {kind: r.kind as PropKind, x: r5(V2.x), z: r5(V2.z), y: r5(V2.y), rot: rr, area, hx: (q2 ? r.d : r.w) / 2, hz: (q2 ? r.w : r.d) / 2, h: r.h,
        blocksSight: false, variant: r.variant, level, host, cargo: `${rec.id}/${k}`};
      if (r.purpose) rp.purpose = r.purpose;
      riders.push(rp);
    });
    return {rec, owner, prop, riders, matrix: m.clone()};
  }

  /** The area of the nearest generated prop on that storey (the platform beside the car; a valid index for loot / culling). */
  private areaNear(layout: StationLayout, level: number, x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (const q of layout.props) {
      if (q.cargo || (q.level ?? 0) !== level || q.area < 0) continue;
      const d = (q.x - x) ** 2 + (q.z - z) ** 2;
      if (d < bd) { bd = d; best = q.area; }
    }
    return best >= 0 ? best : 0;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  /** Holders built: carried holder copies and gone originals hold nothing (their lots spilled where they were knocked over). */
  private onHolders(): void {
    const layout = this.host.layout, cm = this.host.containers;
    if (!layout || !cm) return;
    const app = this.appendedOf.get(layout) ?? [];
    for (const a of app) {
      cm.emptyHolder(a.prop);
      const hi = layout.props.indexOf(a.prop);
      for (const r of a.riders) r.host = hi; // (a p7 model that failed to load dropped earlier placements: indices by identity)
    }
    for (const q of layout.props) if (q.cargoGone) cm.emptyHolder(q);
  }

  private onBuild(): void {
    const h = this.host, layout = h.layout;
    if (!layout) return;
    this.gen++;
    const key = {...h.run.current};
    const st = stationPropsOf(h.run.laneStore(STATION_PROPS_LANE, key));
    this.here = {key, layout, gone: st.gone, appended: [], goneNow: new Map(), deferred: this.deferredOf.get(layout) ?? []};
    this.prepared.delete(h.run); // (a decoded save's props: installed by now)
    if (!this.genIndex.has(layout)) { // (a world built without the layout hook: its generated props keep their identities, nothing carried)
      const m = new Map<PropPlacement, number>();
      layout.props.forEach((q, i) => { if (!q.cargo) m.set(q, i); });
      this.genIndex.set(layout, m);
    }
    for (const q of layout.props) if (q.cargoGone) this.hideOriginal(q);
    const app = (this.appendedOf.get(layout) ?? []).filter(a => layout.props.includes(a.prop));
    this.here.appended = app;
    const riding = this.isRiding;
    const trainIds = new Set<string>();
    // top-down (a box resting on another: the upper one goes loose first — nothing rests on a prop that goes loose)
    for (const a of [...app].sort((x, y) => y.matrix.elements[13] - x.matrix.elements[13])) {
      const idx = layout.props.indexOf(a.prop);
      if (a.rec.hp !== undefined) { const s = h.damage.props.state(a.prop, idx); s.hp = a.rec.hp * s.spec.integrity; }
      const ok = h.physics.dynamicItems.adoptLoose(a.prop, idx, placeM(a.prop), a.matrix);
      if (ok) this.counts.adopted++;
      // (task cargo-overflow: resting, drawn by its shared instances again — no detach slot held, whatever the number carried)
      if (ok && !(riding && a.owner === 'train')) h.physics.dynamicItems.handBack?.(a.prop);
      if (a.owner !== 'train' || !ok) continue; // (not adopted: it stands at its placement; its record stays where it was)
      trainIds.add(a.rec.id);
      if (!riding) continue;
      // an arriving car: hidden until it stops (the riding copies show it meanwhile)
      const lp = h.physics.dynamicItems.loose().find(l => l.prop === a.prop);
      let r = this.riding.find(x => x.rec.id === a.rec.id);
      const made = !r;
      if (!r) { r = {rec: structuredClone(a.rec), obj: null, geos: [], mats: [], src: null}; this.riding.push(r); this.captured = true; } // (a pending one: it rides in too)
      const rr = r;
      const w = lp ? this.withdraw(lp, rr.obj ? undefined : (objs, m) => this.makeCopy(rr, objs, m)) : null;
      if (!w) { // (it could not be hidden: it simply stays where it is, loose in the parked car — never also a riding record)
        this.dropCopy(rr);
        this.riding.splice(this.riding.indexOf(rr), 1);
        void made;
        continue;
      }
      rr.src = {...w, gen: this.gen};
    }
    // the train's props are in this world now (the riding ones stay records until the stop)
    this.pending = this.pending.filter(r => !trainIds.has(r.id));
  }

  /** A generated placement this station lost to the train: no render, no collision, a holder emptied and removed. */
  private hideOriginal(prop: PropPlacement): void {
    const h = this.host;
    for (const e of h.damage.props.index.inst.get(prop) ?? []) { e.mesh.setMatrixAt(e.index, M.makeScale(0, 0, 0)); e.mesh.instanceMatrix.needsUpdate = true; }
    h.containers?.removeHolder(prop);
    prop.h = 0;
    prop.blocksSight = false;
    h.physics.propsChanged(prop.x, prop.z);
    this.counts.hidden++;
  }

  /** Teardown (FIRST): the train's props become its records, the station's lane its gone / here. */
  private onTeardown(): void {
    if (!this.here) return;
    const p = this.parked(), took = new Set<PropPlacement>();
    if (!(this.isRiding && this.captured) && p) {
      for (const {lp, id} of this.trainOwned(p)) {
        this.pending.push(this.recordOf(lp, id, p));
        this.markGone(lp);
        took.add(lp.prop);
        this.counts.pending++;
      }
    }
    this.flush(took);
    for (const r of this.riding) r.src = null; // (the world goes: its withdrawn objects with it)
    this.here = null;
  }

  /**
   * The station's lane now (teardown; Game.commitEndingSave): `gone` = what it had lost + generated props it lost since (withdrawn into
   * the train / lying in the parked car); `here` = carried props lying in it, not the train's. `took` (teardown): the train's props the
   * teardown just took (else: the train's now).
   */
  flush(took?: ReadonlySet<PropPlacement>): void {
    const w = this.here;
    if (!w) return;
    const gone = new Map<number, GonePropJSON>(w.gone.map(g => [g.i, g]));
    for (const g of w.goneNow.values()) gone.set(g.i, g);
    const here: CargoPropJSON[] = [];
    const train = took ?? new Set(this.trainOwned().map(t => t.lp.prop));
    for (const lp of this.host.physics.dynamicItems.loose()) {
      if (train.has(lp.prop)) { // the train's (a generated one: lost to it)
        for (const q of [lp.prop, ...lp.riders.map(r => r.prop)]) { const g = q.cargo ? null : this.goneOf(q); if (g) gone.set(g.i, g); }
        continue;
      }
      if (lp.prop.cargo && !lp.prop.cargo.includes('/')) here.push(this.recordOf(lp, lp.prop.cargo, null));
    }
    // carried props that never went loose here (no render / model): kept where they were recorded
    for (const r of w.deferred) if (!here.some(x => x.id === r.id)) here.push(structuredClone(r));
    for (const a of w.appended) if (a.owner === 'station' && !lpOf(this.host, a.prop) && !this.riding.some(r => r.rec.id === a.rec.id) && !here.some(r => r.id === a.rec.id)) here.push(structuredClone(a.rec));
    // (never cut: the bounds are the save format's input safety — a station beyond them fails to save, it never loses or respawns a prop)
    const rec: StationPropsJSON = {v: 1, gone: [...gone.values()].sort((a, b) => a.i - b.i), here: here.sort((a, b) => (a.id < b.id ? -1 : 1))};
    this.host.run.setLaneStore(STATION_PROPS_LANE, rec.gone.length || rec.here.length ? rec : undefined, w.key);
    this.counts.flushes++;
  }

  private goneOf(prop: PropPlacement): GonePropJSON | null {
    const w = this.here, i = w ? this.genIndex.get(w.layout)?.get(prop) : undefined;
    return i === undefined ? null : {i, kind: prop.kind};
  }

  /**
   * Task studio-refinement-batch-20261113-035659-01 (lane MELT, world/acidMelt.ts): a CARRIED prop destroyed in the live world (acid)
   * leaves this system's records for good, whoever owned it — never re-added by a flush as a station prop that "never went loose"
   * (`here`), never a train record (pending). The caller took its body out of the world first (DynamicItems.withdraw); the decor riding it
   * is part of its record and goes with it. False: not a carried prop of this world.
   */
  consume(prop: PropPlacement): boolean {
    const w = this.here, id = prop.cargo;
    if (!w || !id || id.includes('/')) return false;
    const n = w.appended.length + w.deferred.length + this.pending.length;
    w.appended = w.appended.filter(a => a.prop !== prop && a.rec.id !== id);
    w.deferred = w.deferred.filter(r => r.id !== id);
    this.pending = this.pending.filter(r => r.id !== id);
    prop.cargoGone = true;
    return w.appended.length + w.deferred.length + this.pending.length < n;
  }

  /** A generated loose prop (and the generated decor riding it) lost to the train. */
  private markGone(lp: {prop: PropPlacement; riders: readonly {prop: PropPlacement}[]}): void {
    for (const q of [lp.prop, ...lp.riders.map(r => r.prop)]) {
      const g = q.cargo ? null : this.goneOf(q);
      if (g && this.here) this.here.goneNow.set(q, g);
    }
  }

  /** Back in this world (a stop where it was withdrawn): its position decides again. */
  private unmarkGone(w: Withdrawn): void {
    for (const q of [w.prop, ...w.riders]) this.here?.goneNow.delete(q);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The ride

  /** A loose prop out of the world: its body withdrawn, its objects out of the scene (kept to show it again). */
  private withdraw(lp: LooseProp, copy?: (objs: THREE.Object3D[], matrix: THREE.Matrix4) => void): Withdrawn | null {
    const h = this.host, pd = h.damage.props;
    const w = h.physics.dynamicItems.withdraw(lp.prop, {detach: false});
    if (!w) return null;
    const all = [lp.prop, ...lp.riders.map(r => r.prop)];
    // task cargo-overflow: hand its render slots back (its shared instances draw it again at its pose) — no capacity tied to the damage
    // system's detach cap; a prop that cannot (a broken body) keeps its own meshes out of the scene, as before
    let released = true;
    for (const q of all) if (pd.states.get(q)?.parts && (pd.reattach?.(q, true) ?? 'never') !== 'ok') released = false;
    const objs: THREE.Object3D[] = [], inst: HiddenInstance[] = [], parts: Hidden[] = [];
    if (released) {
      for (const q of all) for (const e of pd.index.inst.get(q) ?? []) {
        const m = new THREE.Matrix4();
        e.mesh.getMatrixAt(e.index, m);
        if (m.determinant() === 0) continue;
        inst.push({mesh: e.mesh, index: e.index, matrix: m});
        objs.push(instancePart(e.mesh, e.index, m));
      }
      const root = h.containers?.ownRoot?.(lp.prop);
      if (root) { objs.push(root); parts.push({obj: root, parent: root.parent}); }
    } else for (const o of w.parts) { objs.push(o); parts.push({obj: o, parent: o.parent}); }
    copy?.(objs, w.matrix);
    for (const i of inst) { i.mesh.setMatrixAt(i.index, ZERO); i.mesh.instanceMatrix.needsUpdate = true; }
    for (const q of parts) q.obj.removeFromParent();
    lp.prop.cargoGone = true; // (its ropes drop; it is not part of this station any more)
    h.physics.propsChanged(lp.prop.x, lp.prop.z);
    return {prop: lp.prop, index: lp.index, matrix: w.matrix, parts, inst, riders: lp.riders.map(r => r.prop)};
  }

  /** A withdrawn prop's objects back in the scene (a stop in its own world). */
  private reshow(w: Withdrawn): void {
    for (const i of w.inst) { i.mesh.setMatrixAt(i.index, i.matrix); i.mesh.instanceMatrix.needsUpdate = true; }
    for (const q of w.parts) if (q.parent && !q.obj.parent) q.parent.add(q.obj);
  }

  /** Doors closing / departing: the train's props ride with the car (once). */
  capture(): number {
    const h = this.host, root = h.trainRuntime?.view?.root, p = h.trainRuntime?.train?.placement;
    if (!root || !p || !this.here) return 0;
    let n = 0;
    for (const {lp, id} of this.trainOwned(p)) {
      const rec = this.recordOf(lp, id, p);
      const r: RidingProp = {rec, obj: null, geos: [], mats: [], src: null};
      const w = this.withdraw(lp, (objs, m) => this.makeCopy(r, objs, m));
      if (!w) continue; // (only a prop without a body: not loose, never the train's)
      this.markGone(lp);
      r.src = {...w, gen: this.gen};
      this.riding.push(r);
      n++;
    }
    this.captured = true;
    this.counts.captured += n;
    this.rideBoxes();
    return n;
  }

  /** The car stopped at a placement: the props are loose in it again (the same world: shown again; a new one: its hidden copies). */
  release(): number {
    const h = this.host, p = this.parked();
    this.captured = false;
    let n = 0;
    for (const r of this.riding.splice(0)) {
      this.dropCopy(r);
      const src = r.src && r.src.gen === this.gen && this.here ? r.src : null;
      if (!p || !src) { this.pending.push(r.rec); continue; }
      this.reshow(src);
      src.prop.cargoGone = undefined;
      src.prop.h = h.physics.dynamicItems.restHeight(src.prop);
      for (const rd of src.riders) rd.h = h.physics.dynamicItems.restHeight(rd);
      if (!h.physics.dynamicItems.adoptLoose(src.prop, h.layout?.props.indexOf(src.prop) ?? src.index, src.matrix, this.trainMatrix(p, r.rec))) { this.pending.push(r.rec); continue; }
      h.physics.dynamicItems.handBack?.(src.prop); // (task cargo-overflow: no detach slot held while it rests)
      this.unmarkGone(src); // (in the parked car: the train's while it lies there; its position decides at the flush)
      n++;
    }
    this.rideBoxes();
    this.counts.released += n;
    return n;
  }

  /**
   * The riding copy: clones of the drawn objects (own geometry / materials) on the car's view root (its frame = train-local), each at the
   * record's train-local pose x its offset from the prop's object frame (`objWorld`: the prop's object -> world matrix as withdrawn).
   */
  private makeCopy(r: RidingProp, objs: readonly THREE.Object3D[], objWorld: THREE.Matrix4): void {
    const root = this.host.trainRuntime?.view?.root, level = this.host.trainRuntime?.train?.placement.level ?? 0;
    if (!root || !objs.length) return;
    const rec = r.rec;
    const toLocal = new THREE.Matrix4().compose(V.set(rec.x, rec.y, rec.z), Q.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize(), ONE).multiply(objWorld.clone().invert());
    const g = new THREE.Group();
    g.name = `train-cargo-prop:${r.rec.id}`;
    for (const o of objs) {
      const parent = o.parent;
      o.updateWorldMatrix(true, true);
      const world = parent ? o.matrixWorld.clone() : o.matrix.clone(); // (withdrawn: out of the scene, `matrix` is its world matrix)
      const src: THREE.Object3D[] = [];
      o.traverse(x => src.push(x));
      const c = o.clone(true);
      const dst: THREE.Object3D[] = [];
      c.traverse(x => dst.push(x));
      c.matrixAutoUpdate = false;
      c.matrix.multiplyMatrices(toLocal, world);
      dst.forEach((d, i) => {
        const m = d as THREE.Mesh, s = src[i] as THREE.Mesh;
        delete m.userData.baseMat;
        if (!m.isMesh || !s?.isMesh) return;
        m.geometry = s.geometry.clone();
        r.geos.push(m.geometry);
        const list = Array.isArray(s.material) ? s.material : [s.material];
        const tint = s.userData.cargoTint as THREE.Color | undefined; // (an instance's per-instance colour: the accent it was drawn with)
        const cl = list.map(x => { const k = x.clone(); if (tint && (k as THREE.MeshStandardMaterial).color) (k as THREE.MeshStandardMaterial).color.multiply(tint); r.mats.push(k); return k; });
        m.material = Array.isArray(s.material) ? cl : cl[0];
        const data = s.userData[PROP_DATA_KEY] as Float32Array | undefined;
        if (data) m.userData[PROP_DATA_KEY] = data.slice(); // (the per-object damage data: marks as drawn)
        m.userData.level = level;
      });
      g.add(c);
    }
    root.add(g);
    g.updateMatrixWorld(true);
    r.obj = g;
  }

  private dropCopy(r: RidingProp): void {
    r.obj?.removeFromParent();
    for (const g of r.geos) g.dispose();
    for (const m of r.mats) m.dispose();
    r.obj = null;
    r.geos = [];
    r.mats = [];
  }

  /** The ride's car-local collision model: the riding props' footprints (columns up to their tops). */
  private rideBoxes(): void {
    const model = this.host.trainRide?.model;
    if (!model) return;
    const boxes: PropPlacement[] = [];
    for (const r of this.riding) {
      const rec = r.rec;
      const m = new THREE.Matrix4().compose(V.set(rec.x, rec.y, rec.z), Q.set(rec.q[0], rec.q[1], rec.q[2], rec.q[3]).normalize(), ONE);
      const b = new THREE.Box3(new THREE.Vector3(-rec.w / 2, 0, -rec.d / 2), new THREE.Vector3(rec.w / 2, rec.h, rec.d / 2)).applyMatrix4(m);
      boxes.push({kind: 'column', x: (b.min.x + b.max.x) / 2 + RIDE_FRAME.ox, z: (b.min.z + b.max.z) / 2 + RIDE_FRAME.oz, y: PROP_CARGO.rideBase, rot: 0, area: -1,
        hx: Math.max(0.02, (b.max.x - b.min.x) / 2), hz: Math.max(0.02, (b.max.z - b.min.z) / 2), h: b.max.y - PROP_CARGO.rideBase, blocksSight: false, variant: 0, level: 0});
    }
    setRideCargoBoxes(model, 'cargo-props', boxes.length ? boxes : null);
  }

  frame(): void {
    const ride = this.host.trainRide;
    if (ride?.riding) {
      if (!this.captured && (ride.phase === 'closing' || ride.phase === 'departing')) this.capture();
      return;
    }
    if (this.captured || this.riding.length) this.release();
  }

  /** QA: a compact state report. */
  qa() {
    return {riding: this.riding.map(r => ({id: r.rec.id, kind: r.rec.kind, x: r.rec.x, y: r.rec.y, z: r.rec.z, drawn: !!r.obj})), pending: this.pending.map(r => r.id),
      appended: this.here?.appended.map(a => ({id: a.rec.id, kind: a.rec.kind, owner: a.owner})) ?? [], captured: this.captured, counts: {...this.counts}};
  }
}

/**
 * The lazy model keys CARRIED placements add to a layout (`keysOf`: the Game's every-hook key list for a layout): what the layout with
 * just them asks for beyond the layout without props. Game.modelKeysFor lets these through the level rule (assets/levelAssets.ts
 * selectLevelKeys / foreignTo) — a carried mall cafe chair loads its mall model in the Subway's train.
 */
export function carriedModelKeys(keysOf: (layout: StationLayout) => readonly string[], layout: StationLayout, carried: readonly PropPlacement[]): string[] {
  const none = new Set(keysOf({...layout, props: []}));
  return [...new Set(keysOf({...layout, props: [...carried]}))].filter(k => !none.has(k));
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One shared instance as a stand-alone object (its geometry / material, its world matrix, its per-instance colour) — a riding copy's source. */
function instancePart(im: THREE.InstancedMesh, index: number, local: THREE.Matrix4): THREE.Mesh {
  im.updateWorldMatrix(true, false);
  const mesh = new THREE.Mesh(im.geometry, im.material);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.multiplyMatrices(im.matrixWorld, local);
  mesh.castShadow = im.castShadow;
  mesh.receiveShadow = im.receiveShadow;
  if (im.instanceColor) mesh.userData.cargoTint = new THREE.Color().fromArray(im.instanceColor.array as Float32Array, index * 3);
  return mesh;
}

function lpOf(h: PropCargoHost, prop: PropPlacement): LooseProp | undefined {
  return h.physics.dynamicItems.loose().find(l => l.prop === prop);
}

/** Create the prop cargo and register it into the Game (once, after the item cargo). */
export function installTrainPropCargo(game: unknown): TrainPropCargo {
  return new TrainPropCargo(game as PropCargoHost).install();
}
