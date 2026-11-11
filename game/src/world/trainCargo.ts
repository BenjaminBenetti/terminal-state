// Task studio-beta-train-loose-cargo-20261107-060450-01 (user: "all items on the train should move with the train, i.e. if I drop an item
// on the train it should come with it, to the next level!"): the TRAIN'S LOOSE CARGO in the world — every loose item (a world pickup of any
// inventory item) and every grounded bag (a set-down backpack with its contents) lying in the player's train travels with it, exactly (the
// same ItemStack: uid, count, magazine, mask filter, air, bag contents; the same train-local pose).
//
// OWNERSHIP (the fuel carts' rule, world/fuelCarts.ts, for every loose item): a pickup / grounded bag whose anchor lies INSIDE the parked
// car (train-local, world/trainRideLocal.ts insideInterior, between its floor and ceiling) belongs to the TRAIN; anything else to the
// station. Decided where it physically lies at capture / save / teardown time: no suck radius, no platform floor, nothing through a wall.
//  - RIDE START (the doors closing, before the car moves; Game.travelToStation -> TrainRide.depart): the train's pickups / bags leave the
//    station's PickupManager / GearSystem and become RIDING CARGO — objects on the car's view root at their train-local poses, moving with
//    the car through the departure, the world teardown (the view is held), the transit and the next station's build.
//  - RIDE END (the car stopped at a placement: the arrival, a refused / reset departure, a failed journey brought back): ordinary pickups /
//    grounded bags again inside that parked car (trainToWorld of their local poses) — still the train's by the rule.
//  - WHILE RIDING: E on a riding item takes it (Inventory.add; a backpack is worn when the back slot is free); an inventory drop
//    (Game.dropRef, which refused drops while riding) lays the stack on the car floor in front of the player as riding cargo.
//  - A TEARDOWN WITHOUT A RIDE (Retry / Load / New game / leaving a section): the train's pickups / bags become PENDING records, spawned in
//    the next world's parked car (this system's teardown runs FIRST: before the gear saves the section's bags; Game.saveSectionMemory and
//    GearSystem.record leave the train's own out — the ending save's mid-section flush too). Its build runs after the train / gear builds.
//  - SAVES: the 'player-train' participant's `cargo` (run/trainCargo.ts; TrainCargo.live = this system): riding items, the train's pickups /
//    bags in the parked car and pending records, at save time. restore() (Load / Continue / Retry / New game) replaces them exactly.
// Not covered: the fuel carts (their own cargo) and the Lockbox (its slots) — never captured twice. Layout props knocked loose into the car
// travel too, as the train's PROP cargo (task studio-beta-train-all-cargo-20261107-184244-01: world/trainPropCargo.ts).
// Fuel: loose fuel cans travel like any item; the automatic burn stays tank -> carts aboard -> chest cans (fuel/fuel.ts planDebit).

import * as THREE from 'three';
import type {Game} from '../game';
import {stackFromJSON, stackToJSON, stacksIn, type ItemStack} from '../items/inventory';
import {itemDef} from '../items/items';
import {isBagItem} from '../items/gear';
import {trainToWorld, worldToTrain, type TrainPlacement} from '../gen/playerTrain';
import {CARGO, type CargoItemJSON} from '../run/trainCargo';
import {makeBagObject, type GroundBag} from './groundBag';
import type {Pickup} from './pickups';
import type {PlayerTrainSpec} from './playerTrainSpec';

/** Tuning. */
export const TRAIN_CARGO = {
  /** Riding pickup reach / aim cone (as PickupManager.target). */
  reach: 2.6, cone: 0.32, near: 1.0, nearCone: 1.0,
  /** A riding drop lands this far in front of the player (m), at least `margin` inside the interior walls. */
  dropAhead: 0.8, margin: 0.25,
  /** Riding fuel cans dropped as a stack lie side by side this far apart (m). */
  canStep: 0.26,
} as const;

export const CARGO_TEXT = {
  take: (name: string) => `<b>[E]</b> Take ${name}`,
  wear: '<b>[E]</b> Wear the backpack',
  backTaken: 'Your back is taken — set your own backpack down after the stop to swap',
  noRoom: 'No room in inventory — drop something (Tab)',
  // task studio-beta-train-cargo-overflow-20261107-210410-01: everything aboard travels, or the train does not leave / takes no more
  overloaded: (n: number) => `Too many loose items in the train — ${n} lie in it, at most ${CARGO.maxItems} can travel. Pick some up or use the Lockbox first`,
  floorFull: `The train's floor is full (${CARGO.maxItems} loose items) — keep it, or use the Lockbox`,
} as const;

interface Riding {
  kind: 'item' | 'bag';
  id?: string;
  stack: ItemStack;
  obj: THREE.Object3D;
  mats: THREE.Material[];
  /** Train-local pose. */
  x: number; y: number; z: number;
  q: THREE.Quaternion;
}

/** What the system needs of Game (structural: Node tests drive it with the real train runtime / ride / pickups and a small gear). */
export interface CargoHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  state: string;
  player: {x: number; y: number; z: number; yaw: number; alive: boolean};
  inv: {add(s: ItemStack): number; wornBag(): ItemStack | null; wearBag(s: ItemStack): boolean; reserveUids(max: number): void; makeStack(id: string, count: number): ItemStack; refusal?: {text: string} | null};
  pickups: {list: Pickup[]; addAt(stack: ItemStack, m: THREE.Matrix4): Pickup; remove(p: Pickup): void; meshFor(itemId: string): THREE.Object3D};
  gear?: {bags: GroundBag[]; releaseBag(b: GroundBag): ItemStack | null; adoptBag(id: string, stack: ItemStack, pose: {x: number; y: number; z: number; yaw: number; level: number}): GroundBag; recordFilter: ((b: GroundBag) => boolean) | null;
    /** Lane CARGO: gear/system.ts VolumeCarrier — the parked car's floor carries a set-down bag (installed here). */
    carrier?: ((v: unknown, x: number, y: number, z: number) => boolean | null) | null} | null;
  trainRuntime?: {spec: PlayerTrainSpec; view: {root: THREE.Object3D} | null; train: {placement: TrainPlacement; col?: {volume: unknown}} | null; carLocal(x: number, y: number, z: number): {x: number; y: number; z: number} | null; carDir(x: number, y: number, z: number): {x: number; y: number; z: number} | null} | null;
  trainRide?: {riding: boolean; phase: string; moving: boolean; local: {x: number; y: number; z: number; yaw: number}} | null;
  playerTrain: {cargo: {live: {cargo(): CargoItemJSON[]; restore(items: CargoItemJSON[]): void; add?(item: CargoItemJSON): void} | null}};
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  frameHooks: ((dt: number) => void)[];
  interactHandlers: (() => boolean)[];
  promptProviders?: (() => string | null)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  syncHeld?(): void;
}

const QY = new THREE.Quaternion(), QW = new THREE.Quaternion(), V = new THREE.Vector3(), M = new THREE.Matrix4(), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const r5 = (v: number) => (Math.round(v * 1e5) / 1e5) || 0; // (never -0: records compare exactly)
const byKey = (a: CargoItemJSON, b: CargoItemJSON) => (a.stack.uid - b.stack.uid) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

export class TrainCargoSystem {
  /** Items riding the car's view root (between a ride's start and its stop). */
  readonly riding: Riding[] = [];
  /** Records waiting for a world with a parked car (a teardown without a ride, a load). */
  pending: CargoItemJSON[] = [];
  /** A ride took our cargo (released when the ride has ended). */
  private captured = false;
  /** The riding item under the crosshair (prompt / E). */
  aimed: Riding | null = null;
  prompt: string | null = null;
  /** QA / tests. */
  readonly counts = {captured: 0, released: 0, pending: 0, spawned: 0, taken: 0, dropped: 0, restores: 0};
  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(readonly host: CargoHost) {}

  install(): this {
    const h = this.host;
    // teardown FIRST (the train's items leave the section before the gear / the memory flush save it); build LAST (after the train / gear)
    h.sectionHooks.unshift({teardown: () => this.onTeardown()});
    h.sectionHooks.push({build: () => this.onBuild()});
    h.frameHooks.push(dt => this.frame(dt));
    h.interactHandlers.push(() => this.onInteract());
    h.promptProviders?.push(() => this.prompt);
    h.playerTrain.cargo.live = {cargo: () => this.cargo(), restore: items => this.restore(items), add: item => this.addPending(item)};
    if (h.gear) { h.gear.recordFilter = b => this.ownsBag(b); h.gear.carrier = (v, x, y, z) => this.carries(v, x, y, z); }
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

  /** A train-local point inside the car, between its floor and ceiling. */
  insideCar(lx: number, ly: number, lz: number): boolean {
    const S = this.spec;
    if (!S) return false;
    return lx > S.interior.x0 && lx < S.interior.x1 && Math.abs(lz) < S.interior.halfWidth && ly > S.floorY - 0.3 && ly < S.ceilingY;
  }

  /**
   * The pickup lies in the parked car: the train's (its object's origin, train-local). Task studio-market-rework-20261108-074144-01 (lane
   * WARES): never an OWNED pickup (a market stall's displayed stock, Pickup.owner) — knocked into the car it stays the stall's: never
   * captured, saved, counted or carried as cargo.
   */
  ownsPickup(p: Pickup): boolean {
    const pl = this.parked();
    if (!pl || p.owner) return false;
    const q = worldToTrain(pl, p.obj.position.x, p.obj.position.y, p.obj.position.z);
    return this.insideCar(q.x, q.y, q.z);
  }

  /** The grounded bag lies in the parked car: the train's. */
  ownsBag(b: GroundBag): boolean {
    const pl = this.parked();
    if (!pl) return false;
    const q = worldToTrain(pl, b.pose.x, b.pose.y, b.pose.z);
    return this.insideCar(q.x, q.y, q.z);
  }

  /**
   * Lane CARGO (user: "Backpacks must be placeable aboard the train and travel with it like other items"; GearSystem.carrier): a world
   * point on dynamic volume `v` — the parked car's interior volume: true when it lies inside the car (by the ownership rule above: a bag
   * set down there is the train's and travels as its cargo), false when not (its doorways / the walls, or the car is riding); null: not
   * the car's volume (a lift cab). The set-down's spot and collider checks stay the gear's.
   */
  carries(v: unknown, x: number, y: number, z: number): boolean | null {
    const t = this.host.trainRuntime?.train;
    if (!t?.col || v !== t.col.volume) return null;
    const pl = this.parked();
    if (!pl) return false;
    const q = worldToTrain(pl, x, y, z);
    return this.insideCar(q.x, q.y, q.z);
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // The ride: capture / release

  /** The train's pickups / bags become riding cargo on the car's view root (idempotent). */
  capture(): number {
    const h = this.host, root = h.trainRuntime?.view?.root, p = h.trainRuntime?.train?.placement;
    if (!root || !p) return 0;
    let n = 0;
    for (const pk of [...h.pickups.list]) {
      if (pk.owner) continue; // (lane WARES: a stall's ware is never cargo)
      const q = worldToTrain(p, pk.obj.position.x, pk.obj.position.y, pk.obj.position.z);
      if (!this.insideCar(q.x, q.y, q.z)) continue;
      const local = QW.copy(pk.obj.quaternion).premultiply(QY.setFromAxisAngle(UP, -p.yaw));
      h.pickups.remove(pk);
      this.ride({kind: 'item', stack: pk.stack, x: q.x, y: q.y, z: q.z, q: local.clone()});
      n++;
    }
    for (const b of [...(h.gear?.bags ?? [])]) {
      const q = worldToTrain(p, b.pose.x, b.pose.y, b.pose.z);
      if (!this.insideCar(q.x, q.y, q.z)) continue;
      const st = h.gear!.releaseBag(b);
      if (!st) continue;
      this.ride({kind: 'bag', id: b.id, stack: st, x: q.x, y: q.y, z: q.z, q: new THREE.Quaternion().setFromAxisAngle(UP, b.pose.yaw - p.yaw)});
      n++;
    }
    this.captured = true;
    this.counts.captured += n;
    return n;
  }

  /** Riding cargo -> ordinary pickups / bags in the parked car (an arrival: the NEW station's); without a parked car -> pending. */
  release(): number {
    const p = this.parked();
    this.captured = false;
    let n = 0;
    for (const r of this.riding.splice(0)) {
      this.dropObject(r);
      if (!p) { this.pending.push(this.recordOf(r)); continue; }
      this.spawnWorld(p, r.kind, r.id, r.stack, r.x, r.y, r.z, r.q);
      n++;
    }
    this.counts.released += n;
    return n;
  }

  /** A riding item: its object (the pickup's look; a bag's model) on the car's view root at the local pose. */
  private ride(o: {kind: 'item' | 'bag'; id?: string; stack: ItemStack; x: number; y: number; z: number; q: THREE.Quaternion}): Riding | null {
    const root = this.host.trainRuntime?.view?.root;
    if (!root) return null;
    const obj = o.kind === 'bag' ? makeBagObject() : this.host.pickups.meshFor(o.stack.itemId);
    const mats: THREE.Material[] = [];
    obj.traverse(m0 => {
      const m = m0 as THREE.Mesh;
      if (!m.isMesh) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const cloned = list.map(mm => { const c = mm.clone(); mats.push(c); return c; });
      m.material = Array.isArray(m.material) ? cloned : cloned[0];
      m.userData.level = this.host.trainRuntime?.train?.placement.level ?? 0;
    });
    obj.name = `train-cargo:${o.stack.uid}`;
    obj.position.set(o.x, o.y, o.z);
    obj.quaternion.copy(o.q);
    root.add(obj);
    obj.updateMatrixWorld(true);
    const r: Riding = {kind: o.kind, id: o.id, stack: o.stack, obj, mats, x: o.x, y: o.y, z: o.z, q: o.q.clone()};
    this.riding.push(r);
    return r;
  }

  private dropObject(r: Riding): void {
    r.obj.parent?.remove(r.obj);
    for (const m of r.mats) m.dispose();
    if (this.aimed === r) this.aimed = null;
  }

  /** An ordinary pickup / grounded bag in the parked car at placement p from a train-local pose. */
  private spawnWorld(p: TrainPlacement, kind: 'item' | 'bag', id: string | undefined, stack: ItemStack, x: number, y: number, z: number, q: THREE.Quaternion): void {
    const h = this.host, w = trainToWorld(p, x, y, z);
    QW.copy(q).premultiply(QY.setFromAxisAngle(UP, p.yaw));
    if (kind === 'bag' && h.gear) {
      const e = new THREE.Euler().setFromQuaternion(QW, 'YXZ');
      h.gear.adoptBag(id ?? `bag:${stack.uid}`, stack, {x: w.x, y: w.y, z: w.z, yaw: e.y, level: p.level});
      return;
    }
    h.pickups.addAt(stack, M.compose(V.set(w.x, w.y, w.z), QW, ONE));
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Records

  private recordOf(r: {kind: 'item' | 'bag'; id?: string; stack: ItemStack; x: number; y: number; z: number; q: THREE.Quaternion}): CargoItemJSON {
    const q = r.q.clone().normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w); // (q and -q are one orientation: one record)
    const rec: CargoItemJSON = {kind: r.kind, stack: stackToJSON(r.stack)!, x: r5(r.x), y: r5(r.y), z: r5(r.z), q: [r5(q.x), r5(q.y), r5(q.z), r5(q.w)]};
    if (r.kind === 'bag') rec.id = r.id ?? `bag:${r.stack.uid}`;
    return rec;
  }

  /** The train's loose cargo now (save time): riding items, the train's pickups / bags in the parked car, pending records. */
  cargo(): CargoItemJSON[] {
    const h = this.host, out: CargoItemJSON[] = this.riding.map(r => this.recordOf(r));
    const p = this.parked();
    if (p) {
      for (const pk of h.pickups.list) {
        if (pk.owner) continue; // (lane WARES: a stall's ware is never cargo)
        const q = worldToTrain(p, pk.obj.position.x, pk.obj.position.y, pk.obj.position.z);
        if (!this.insideCar(q.x, q.y, q.z)) continue;
        out.push(this.recordOf({kind: 'item', stack: pk.stack, x: q.x, y: q.y, z: q.z, q: QW.copy(pk.obj.quaternion).premultiply(QY.setFromAxisAngle(UP, -p.yaw))}));
      }
      for (const b of h.gear?.bags ?? []) {
        if (!b.grounded) continue;
        const q = worldToTrain(p, b.pose.x, b.pose.y, b.pose.z);
        if (!this.insideCar(q.x, q.y, q.z)) continue;
        out.push(this.recordOf({kind: 'bag', id: b.id, stack: b.stack, x: q.x, y: q.y, z: q.z, q: new THREE.Quaternion().setFromAxisAngle(UP, b.pose.yaw - p.yaw)}));
      }
    }
    for (const r of this.pending) out.push(structuredClone(r));
    // (task cargo-overflow: never cut to CARGO.maxItems — a departure beyond it is refused, a riding drop beyond it too; a save beyond it is
    // refused as invalid: nothing aboard is silently left out of the record)
    return out.sort(byKey);
  }

  /** Task cargo-overflow: the loose items that would travel now (riding, in the parked car, waiting). */
  aboardCount(): number {
    const h = this.host, p = this.parked();
    let n = this.riding.length + this.pending.length;
    if (p) {
      for (const pk of h.pickups.list) if (this.ownsPickup(pk)) n++;
      for (const b of h.gear?.bags ?? []) if (b.grounded && this.ownsBag(b)) n++;
    }
    return n;
  }

  /**
   * Task cargo-overflow: the departure refusal (Game.fuelCheck, BEFORE the fuel draw, the carts' capture, the doors and any capture): more
   * than CARGO.maxItems loose items / bags aboard cannot all travel, so the train does not leave. Null: free to leave.
   */
  departBlock(): string | null {
    if (!this.parked()) return null;
    const n = this.aboardCount();
    return n > CARGO.maxItems ? CARGO_TEXT.overloaded(n) : null;
  }

  /** Task cargo-overflow: the last riding drop was refused because the car's floor is full (Game.dropRef: its own message, not the ride's). */
  dropFull = false;

  /** Load / Continue / Retry / New game: the cargo becomes exactly `items` (the train's current items go first; idempotent). */
  restore(items: readonly CargoItemJSON[]): void {
    const h = this.host;
    this.counts.restores++;
    for (const r of this.riding.splice(0)) this.dropObject(r);
    this.captured = false;
    const p = this.parked();
    if (p) {
      for (const pk of [...h.pickups.list]) if (this.ownsPickup(pk)) h.pickups.remove(pk);
      for (const b of [...(h.gear?.bags ?? [])]) if (this.ownsBag(b)) h.gear!.releaseBag(b);
    }
    this.pending = items.map(r => structuredClone(r));
    this.reserve(this.pending);
    this.spawnPending();
  }

  /**
   * Task studio-market-rework-20261108-074144-01 (lane TRADE): one more record aboard (run/trainCargo.ts TrainCargo.add: the old market
   * balance's overflow) — a pending record like a load's, spawned in the parked car now (or riding with the moving car), else at the next
   * world with a parked car; saved with the cargo meanwhile (cargo() lists pending records).
   */
  addPending(item: CargoItemJSON): void {
    this.pending.push(structuredClone(item));
    this.reserve([item]);
    this.spawnPending();
  }

  /** The inventory's uid counter stays above every cargo uid (bag contents included). */
  private reserve(items: readonly CargoItemJSON[]): void {
    let max = 0;
    for (const r of items) for (const s of stacksIn(stackFromJSON(r.stack))) max = Math.max(max, s.uid);
    if (max > 0) this.host.inv.reserveUids(max);
  }

  /** Pending records -> riding cargo (while riding) or pickups / bags in the parked car (needs one). */
  spawnPending(): void {
    if (!this.pending.length) return;
    const riding = this.isRiding, p = this.parked(), root = this.host.trainRuntime?.view?.root;
    if (!riding && !p) return;
    if (riding && !root) return;
    const recs = this.pending;
    this.pending = [];
    for (const r of recs) {
      const st = stackFromJSON(r.stack);
      if (!st) continue;
      const S = this.spec!, m = TRAIN_CARGO.margin;
      // (a pose from a save is clamped into the car: always aboard)
      const x = Math.max(S.interior.x0 + m, Math.min(S.interior.x1 - m, r.x)), z = Math.max(-S.interior.halfWidth + m, Math.min(S.interior.halfWidth - m, r.z));
      const y = Math.max(S.floorY, Math.min(S.ceilingY - 0.3, r.y));
      const q = new THREE.Quaternion(r.q[0], r.q[1], r.q[2], r.q[3]).normalize();
      if (riding) { this.ride({kind: r.kind, id: r.id, stack: st, x, y, z, q}); this.captured = true; }
      else this.spawnWorld(p!, r.kind, r.id, st, x, y, z, q);
      this.counts.spawned++;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  private onTeardown(): void {
    this.aimed = null;
    this.prompt = null;
    if (this.isRiding && this.captured) return; // the riding car keeps its cargo through the teardown (the view is held)
    const h = this.host, p = this.parked();
    if (!p) return;
    for (const pk of [...h.pickups.list]) {
      if (pk.owner) continue; // (lane WARES: a stall's ware is never cargo)
      const q = worldToTrain(p, pk.obj.position.x, pk.obj.position.y, pk.obj.position.z);
      if (!this.insideCar(q.x, q.y, q.z)) continue;
      this.pending.push(this.recordOf({kind: 'item', stack: pk.stack, x: q.x, y: q.y, z: q.z, q: QW.copy(pk.obj.quaternion).premultiply(QY.setFromAxisAngle(UP, -p.yaw))}));
      h.pickups.remove(pk);
      this.counts.pending++;
    }
    for (const b of [...(h.gear?.bags ?? [])]) {
      if (!this.ownsBag(b)) continue;
      const q = worldToTrain(p, b.pose.x, b.pose.y, b.pose.z), yaw = b.pose.yaw - p.yaw, st = h.gear!.releaseBag(b);
      if (!st) continue;
      this.pending.push(this.recordOf({kind: 'bag', id: b.id, stack: st, x: q.x, y: q.y, z: q.z, q: new THREE.Quaternion().setFromAxisAngle(UP, yaw)}));
      this.counts.pending++;
    }
  }

  private onBuild(): void {
    this.spawnPending();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Per frame

  frame(_dt: number): void {
    const h = this.host, ride = h.trainRide;
    if (ride?.riding) {
      // the doors closing / the car about to move: the train's items ride with it (once; drops while riding join directly)
      if (!this.captured && (ride.phase === 'closing' || ride.phase === 'departing')) this.capture();
      if (this.pending.length) this.spawnPending();
      this.updateAim();
      return;
    }
    this.aimed = null;
    this.prompt = null;
    if (this.captured || this.riding.length) this.release();
    if (this.pending.length) this.spawnPending();
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Riding: take / drop

  /** The riding item under the crosshair (car frame), as PickupManager.target picks a pickup. */
  private updateAim(): void {
    const h = this.host, rt = h.trainRuntime;
    this.aimed = null;
    this.prompt = null;
    if (!rt || h.state !== 'playing' || !h.player.alive || !this.riding.length) return;
    h.camera.getWorldPosition(this.eye);
    h.camera.getWorldDirection(this.dir);
    const e = rt.carLocal(this.eye.x, this.eye.y, this.eye.z), d = rt.carDir(this.dir.x, this.dir.y, this.dir.z);
    if (!e || !d) return;
    const T = TRAIN_CARGO;
    let best: Riding | null = null, bestScore = Infinity;
    for (const r of this.riding) {
      const vx = r.x - e.x, vy = r.y + 0.08 - e.y, vz = r.z - e.z, dist = Math.hypot(vx, vy, vz);
      if (dist > T.reach || dist < 1e-6) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (vx * d.x + vy * d.y + vz * d.z) / dist)));
      const flat = Math.hypot(vx, vz);
      if (!(ang < T.cone || (flat < T.near && ang < T.nearCone))) continue;
      const score = ang + dist * 0.08;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    this.aimed = best;
    if (best) this.prompt = best.kind === 'bag' ? CARGO_TEXT.wear : CARGO_TEXT.take(itemDef(best.stack.itemId).short);
  }

  /** E while riding on an aimed riding item: take it (true = handled). */
  onInteract(): boolean {
    const h = this.host;
    if (!this.isRiding || h.state !== 'playing') return false;
    const r = this.aimed;
    if (!r || !this.riding.includes(r)) return false;
    const sfx = h.sfx as {pickup?(): void; denied?(): void} | null;
    if (r.kind === 'bag' || isBagItem(r.stack.itemId)) {
      if (h.inv.wornBag()) { h.hud.toast(CARGO_TEXT.backTaken, true); sfx?.denied?.(); return true; }
      if (!h.inv.wearBag(r.stack)) { h.hud.toast(h.inv.refusal?.text ?? 'You cannot wear it now.', true); sfx?.denied?.(); return true; }
      this.riding.splice(this.riding.indexOf(r), 1);
      this.dropObject(r);
      this.counts.taken++;
      sfx?.pickup?.();
      h.hud.toast(`Picked up the ${itemDef(r.stack.itemId).short.toLowerCase()} — wearing it`);
      h.syncHeld?.();
      return true;
    }
    const before = r.stack.count, left = h.inv.add(r.stack);
    if (left === before) { h.hud.toast(CARGO_TEXT.noRoom, true); sfx?.denied?.(); return true; }
    sfx?.pickup?.();
    const got = before - left;
    if (left > 0) { r.stack.count = left; h.hud.toast(`Took ${got} ${itemDef(r.stack.itemId).short} (no room for ${left})`); }
    else {
      this.riding.splice(this.riding.indexOf(r), 1);
      this.dropObject(r);
      h.hud.toast(`+${got} ${itemDef(r.stack.itemId).name}`);
    }
    this.counts.taken++;
    h.syncHeld?.();
    return true;
  }

  /**
   * An inventory drop while riding (Game.dropRef): the stack lies on the car floor in front of the player (inside the car) as riding cargo
   * — it arrives with the train. A fuel-can stack lies as single cans side by side (one visible can = one can). False = no car to drop in.
   */
  dropRiding(stack: ItemStack): boolean {
    const h = this.host, S = this.spec, L = h.trainRide?.local;
    this.dropFull = false;
    if (!S || !L || !this.isRiding || !h.trainRuntime?.view?.root) return false;
    // (task cargo-overflow: the car's floor holds at most CARGO.maxItems loose items — beyond, the stack stays in the inventory, untouched)
    const adds = stack.itemId === 'fuel_can' ? Math.max(1, stack.count) : 1;
    if (this.riding.length + this.pending.length + adds > CARGO.maxItems) { this.dropFull = true; h.hud.toast(CARGO_TEXT.floorFull, true); return false; }
    const T = TRAIN_CARGO, fx = -Math.sin(L.yaw), fz = -Math.cos(L.yaw);
    const clampX = (v: number) => Math.max(S.interior.x0 + T.margin, Math.min(S.interior.x1 - T.margin, v));
    const clampZ = (v: number) => Math.max(-S.interior.halfWidth + T.margin, Math.min(S.interior.halfWidth - T.margin, v));
    const x = clampX(L.x + fx * T.dropAhead), z = clampZ(L.z + fz * T.dropAhead), q = new THREE.Quaternion().setFromAxisAngle(UP, L.yaw);
    const stacks: ItemStack[] = [stack];
    if (stack.itemId === 'fuel_can' && stack.count > 1) { // (fuel/fuel.ts FUEL.canItem: single cans, the total exact)
      const n = stack.count;
      stack.count = 1;
      for (let k = 1; k < n; k++) { const one = h.inv.makeStack('fuel_can', 1); one.count = 1; stacks.push(one); }
    }
    stacks.forEach((st, k) => {
      const off = k * T.canStep;
      // (an item, as a drop in the parked car makes a pickup — a backpack too: worn again by E, or lying as a pickup after the stop)
      this.ride({kind: 'item', stack: st, x: clampX(x - fx * off), y: S.floorY, z: clampZ(z - fz * off), q});
    });
    this.captured = true;
    this.counts.dropped += stacks.length;
    return true;
  }

  /** QA: a compact state report. */
  qa() {
    return {riding: this.riding.map(r => ({kind: r.kind, item: r.stack.itemId, count: r.stack.count, uid: r.stack.uid, x: +r.x.toFixed(3), y: +r.y.toFixed(3), z: +r.z.toFixed(3)})),
      pending: this.pending.length, captured: this.captured, aimed: this.aimed?.stack.itemId ?? null, counts: {...this.counts}};
  }
}

/** Create the cargo system and register it into the Game (once, after the gear, the player train, the ride and the fuel carts). */
export function installTrainCargo(game: Game): TrainCargoSystem {
  return new TrainCargoSystem(game as unknown as CargoHost).install();
}
