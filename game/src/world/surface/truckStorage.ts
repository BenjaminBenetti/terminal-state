// Task surface-run-opus-rebuild-20261116-020827 (lane TRUCK): THE TRUCK'S STORAGE COMPARTMENTS and the truck's install.
//
// STORE: one TrainLockbox per compartment (world/surface/truckStore.ts TRUCK_COMPARTMENTS, measured by the cook: the LEFT LOCKER under
// the bed on the driver's side, 12 slots; the RIGHT LOCKER behind the passenger step, 6 slots) — FINITE ordinary inventory slots (the
// item's own stackMax; every kind; stacks keep their uid, count, mag, filter, air, a backpack whole with its contents). Loaded from
// SkywaysCar.storageJSON right after the controller's build of a truck world (this system's section hook runs after the controller's),
// handed back through SkywaysCar.storageSource whenever the controller writes the truck's record (teardown, getting out, play pausing):
// the record (lane SURFACE_TRUCK_LANE, the district's section memory) is the one persistent copy; save/validate.ts checks its stacks
// with the run-wide uid set (one item, one uid). The inventory's uid counter is reserved above the compartments' uids at load. Nothing is
// ever refilled, invented or duplicated: an empty truck starts empty (player storage, part of the vehicle: no seeded loot — classified in
// world/surface/truckAudit.ts).
// OPEN: [E] with the crosshair on a compartment's door (its measured box) within TRUCK_STORAGE_RT.reach, nothing structural in between,
// standing OUTSIDE the truck on that side near it, the truck's storey, not seated, playing, alive, not climbing / riding / using an
// item, no other lane owning the hands, no bag view open — through the controller's own [E] handler and prompt (SkywaysCar.access), so
// a press does exactly one thing. Seated, E always gets out first.
// VIEW: the Lockbox transfer view (ui/lockboxView.ts LockboxView, one per compartment: its name, slots, 6 columns); transfers only through
// Inventory.storeMove / storeQuick / storeWornBag (atomic, uid-keeping). CLOSE: E / 6 / Esc / Tab / I / Close, walking away
// (closeRange / closeRise), the truck moving or someone getting in, a hit, any state but playing, death, the truck gone, teardown. The
// door cue is the vehicle door sound (sfx.carDoor). (follow-up) The compartment's DOOR on the truck's side swings out while its view is
// open and shuts after (world/surface/truckModel.ts TruckLockerDoor: a hinged panel over the measured face, the openables' eased hinge).
// Inert in every world without the truck (the controller's other vehicle keeps its own trunk: world/skywaysCarTrunk.ts).

import * as THREE from 'three';
import type {Game} from '../../game';
import type {Levels} from '../../gen/levels';
import type {Inventory, StackJSON, StoreSideRef} from '../../items/inventory';
import {TrainLockbox} from '../../run/trainLockbox';
import {LockboxView, lockboxKeyAction, type StoreViewOptions} from '../../ui/lockboxView';
import {rayBox, type Box3Like} from '../towerShared';
import type {SkywaysCar} from '../skywaysCar';
import {wrapAngle} from '../skywaysCarPhysics';
import {carToWorld, worldToCar} from '../skywaysCarSpec';
import {TRUCK_ANCHORS} from './truckAnchors.generated';
import {TRUCK_COMPARTMENTS} from './truckStore';
import {TRUCK_RT} from './truckSpec';
import {TRUCK_DEF} from './truckVehicle';
import {stepLockerDoors, type TruckView} from './truckModel';
import {surfaceMapOf} from './mapRuntime';
import type {PlanningMap} from './mapModel';
import {TruckConditionSystem, truckConditionOf, type TruckConditionHost} from './truckConditionRuntime';
import {TruckRepairAccess, type TruckRepairHost} from './truckRepair';
import {TruckBoardSystem, type TruckBoardHost} from './truckBoard';

export const TRUCK_STORAGE_RT = {
  /** Aim reach (eye -> the compartment's door, m). */
  reach: 2.2,
  /** The aim box: the measured compartment box grown by this (m). */
  pad: 0.05,
  /** Standing by it: feet outside the body's side (truck-frame |x| >= width / 2 - inside), within stand (m, horizontal) of the door's centre. */
  inside: 0.15,
  stand: 1.7,
  /** The open view closes beyond closeRange (m, horizontal) from the door's centre, or with the feet closeRise (m) off the truck's floor. */
  closeRange: 2.6,
  closeRise: 1.2,
  /** The truck moved this far (m / rad) since the view opened: it closes. */
  moved: 0.02,
  /** Same storey: |feet - the truck's floor| below this (m). */
  storeyY: TRUCK_RT.storeyY,
} as const;

export const TRUCK_STORAGE_TEXT = {
  open: (name: string) => `<b>[E]</b> Open the ${name.toLowerCase()}`,
  hit: (name: string) => `Hit! You let go of the ${name.toLowerCase()}`,
  far: (name: string) => `Too far from the ${name.toLowerCase()} — it closed`,
} as const;

/** One compartment: its id / name / slots and its measured box (truck frame) + the outer face (faceX on side ±1). */
export interface TruckCompartment {
  id: string; name: string; slots: number; side: number;
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; faceX: number;
}
export const TRUCK_COMPARTMENT_BOXES: readonly TruckCompartment[] = TRUCK_ANCHORS.storage;

/** The transfer view's look per compartment (the Lockbox view's layout). */
export const truckStorageView = (c: TruckCompartment): Readonly<StoreViewOptions> => Object.freeze({
  id: `truck-${c.id}-view`, name: c.name, the: `the ${c.name.toLowerCase()}`, slots: c.slots, columns: 6, heading: 'Truck storage · stays with the truck'});

export type TruckStorageCloseReason = 'user' | 'hit' | 'distance' | 'state' | 'travel' | 'gone' | 'moved' | 'driving';

/** What the compartments need from Game (structural: tests drive them with the controller's Node host + a real Inventory). */
export interface TruckStorageHost {
  inv: Inventory;
  player: {x: number; y: number; z: number; alive: boolean};
  camera: THREE.Camera;
  levels: Levels | null;
  state: string;
  qa?: boolean;
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  frameHooks: ((dt: number) => void)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  inputOwners?: (() => boolean)[];
  hitListeners?: ((hit: {amount: number}) => void)[];
  input?: {onLockChange: (locked: boolean) => void; lock(): Promise<boolean>; unlock(): void; readonly locked: boolean} | null;
  gear?: {session?: unknown; cancelReady?(resync: boolean): void; showResume?(): void} | null;
  syncHeld?(): void;
}

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3();
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class TruckStorageSystem {
  /** The live compartments (loaded per truck build, cleared at teardown); index = TRUCK_COMPARTMENTS. */
  readonly stores: TrainLockbox[] = TRUCK_COMPARTMENTS.map(c => new TrainLockbox(c.slots));
  readonly views: LockboxView[];
  /** QA / tests. */
  readonly counts = {loads: 0, opens: 0, closes: 0, refused: 0};
  lastClose: TruckStorageCloseReason | null = null;
  /** The open compartment (-1: none). */
  private openIdx = -1;
  /** The truck build whose compartments the stores hold (-1: none). */
  private loadedFor = -1;
  private pose: {x: number; z: number; yaw: number} | null = null;
  private ownsPointer = false;
  private lockGraceUntil = 0;
  private seen = '';
  private readonly box: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};

  constructor(readonly host: TruckStorageHost, readonly car: SkywaysCar) {
    this.views = TRUCK_COMPARTMENT_BOXES.map((c, i) => new LockboxView({
      inv: () => this.host.inv,
      slots: () => (this.openIdx === i ? this.stores[i].slots : null),
      close: () => this.close('user'),
      changed: () => this.host.syncHeld?.(),
    }, truckStorageView(c)));
  }

  get isOpen(): boolean {
    return this.openIdx >= 0;
  }

  /** The open compartment's id (null: none). */
  get openId(): string | null {
    return this.openIdx >= 0 ? TRUCK_COMPARTMENTS[this.openIdx].id : null;
  }

  /** The stores hold this truck build's compartments. */
  get loaded(): boolean {
    return this.loadedFor >= 0 && this.loadedFor === this.car.counts.builds && this.car.vehicle === 'truck';
  }

  /** SkywaysCar.access: the prompt of the aimed compartment. */
  get prompt(): string {
    const i = this.aimedIndex();
    return TRUCK_STORAGE_TEXT.open(TRUCK_COMPARTMENTS[i >= 0 ? i : 0].name);
  }

  install(): this {
    const h = this.host, car = this.car;
    car.access.push(this);
    car.storageSource = () => (this.loaded ? this.stores.map(s => s.toJSON().slots as (StackJSON | null)[]) : car.storageJSON);
    h.frameHooks.push(dt => { this.update(); this.stepDoors(dt); });
    h.hitListeners?.push(hit => { if (this.isOpen && hit.amount > 0) this.close('hit'); });
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.close('state'); }) as (s: never, p: never) => void);
    // after the controller's section hook (installed earlier): its build has read the record into storageJSON; its teardown has stored
    // the live slots
    h.sectionHooks.push({build: () => this.onBuild(), teardown: () => this.onTeardown()});
    h.inputOwners?.push(() => this.isOpen); // the mouse belongs to the view: no fire / ADS / item use / flare
    const inp = h.input;
    if (inp) { // the view releases pointer lock WITHOUT pausing (like the Lockbox / the trunk)
      const prev = inp.onLockChange;
      inp.onLockChange = locked => {
        if (!locked && (this.ownsPointer || now() < this.lockGraceUntil) && h.state === 'playing') return;
        prev(locked);
      };
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', e => this.onKeyCapture(e), {capture: true});
    return this;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Section lifecycle

  /** After the controller's build: the truck record's compartments -> the live stores (uids reserved in the inventory). */
  onBuild(): void {
    this.close('travel');
    const car = this.car;
    if (car.vehicle !== 'truck') { for (const s of this.stores) s.clear(); this.loadedFor = -1; return; }
    let max = 0;
    this.stores.forEach((s, i) => { s.load({v: 1, slots: car.storageJSON[i] ?? []}); max = Math.max(max, s.maxUid()); });
    this.loadedFor = car.counts.builds;
    this.counts.loads++;
    this.host.inv.reserveUids(max);
  }

  /** After the controller's teardown stored the live slots in the record: close, forget. */
  onTeardown(): void {
    this.close('travel');
    for (const s of this.stores) s.clear();
    this.loadedFor = -1;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Aim / open / close

  /** A compartment door's centre in the world (follows the truck body), null without the truck. */
  anchor(i: number): {x: number; y: number; z: number} | null {
    const b = this.car.body, c = TRUCK_COMPARTMENT_BOXES[i];
    if (!b || !c || this.car.vehicle !== 'truck') return null;
    const p = carToWorld(b.x, b.z, b.yaw, c.faceX, (c.z0 + c.z1) / 2);
    return {x: p.x, y: b.y + (c.y0 + c.y1) / 2, z: p.z};
  }

  /** The player stands outside the truck by compartment i (its side, near its door, the truck's storey). */
  standingBy(i: number): boolean {
    const b = this.car.body, P = this.host.player, c = TRUCK_COMPARTMENT_BOXES[i], S = this.car.spec, R = TRUCK_STORAGE_RT;
    if (!b || !c) return false;
    if (Math.abs(P.y - b.y) > R.storeyY) return false;
    const lp = worldToCar(b.x, b.z, b.yaw, P.x, P.z);
    if (lp.x * c.side < S.width / 2 - R.inside) return false;
    return Math.hypot(lp.x - c.faceX, lp.z - (c.z0 + c.z1) / 2) <= R.stand;
  }

  /** The crosshair's hit on compartment i's box within reach with nothing structural in between, else null. */
  aimHit(i: number): {t: number} | null {
    const h = this.host, b = this.car.body, L = h.levels, c = TRUCK_COMPARTMENT_BOXES[i], R = TRUCK_STORAGE_RT;
    if (!b || !L || !c) return null;
    h.camera.getWorldPosition(tv);
    h.camera.getWorldDirection(tv2);
    const lo = worldToCar(b.x, b.z, b.yaw, tv.x, tv.z), co = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const ld = {x: tv2.x * co - tv2.z * s, y: tv2.y, z: tv2.x * s + tv2.z * co};
    const B = this.box;
    B.min.x = Math.min(c.x0, c.faceX) - R.pad; B.min.y = c.y0 - R.pad; B.min.z = c.z0 - R.pad;
    B.max.x = Math.max(c.x1, c.faceX) + R.pad; B.max.y = c.y1 + R.pad; B.max.z = c.z1 + R.pad;
    const t = rayBox({x: lo.x, y: tv.y - b.y, z: lo.z}, ld, B, R.reach);
    if (t === null) return null;
    const hit = {x: tv.x + tv2.x * t, y: tv.y + tv2.y * t, z: tv.z + tv2.z * t};
    if (!L.lineOfSight({x: tv.x, y: tv.y, z: tv.z}, hit, {slack: 0.15})) return null;
    return {t};
  }

  /** The compartment the crosshair is on (standing by it), the nearest hit first; -1: none. */
  aimedIndex(): number {
    let best = -1, bt = Infinity;
    for (let i = 0; i < TRUCK_COMPARTMENT_BOXES.length; i++) {
      if (!this.standingBy(i)) continue;
      const a = this.aimHit(i);
      if (a && a.t < bt) { bt = a.t; best = i; }
    }
    return best;
  }

  /** SkywaysCar.access: the crosshair on a compartment from beside the truck, and it may open now. */
  aimed(): boolean {
    const h = this.host, car = this.car;
    if (this.isOpen || !this.loaded || !car.body || car.driving || h.state !== 'playing' || h.gear?.session) return false;
    if (!car.canEnter()) return false; // (alive, not climbing / riding / using an item, no other lane's hands)
    return this.aimedIndex() >= 0;
  }

  /** SkywaysCar.access: [E] on the aimed compartment. */
  interact(): boolean {
    const i = this.aimedIndex();
    return i >= 0 && this.open(TRUCK_COMPARTMENTS[i].id);
  }

  /** Open a compartment's view ([E] through the controller; QA). Refused outside play, dead, seated, a bag view open or without this build's truck. */
  open(id: string): boolean {
    const h = this.host, car = this.car, b = car.body, i = TRUCK_COMPARTMENTS.findIndex(c => c.id === id);
    if (i < 0) { this.counts.refused++; return false; }
    if (this.openIdx === i) return true;
    if (this.isOpen) this.close('user');
    if (h.state !== 'playing' || !h.player.alive || h.gear?.session || !b || car.driving || !this.loaded) { this.counts.refused++; return false; }
    h.gear?.cancelReady?.(true);
    this.openIdx = i;
    this.pose = {x: b.x, z: b.z, yaw: b.yaw};
    this.seen = this.key();
    this.ownsPointer = true;
    this.lockGraceUntil = now() + 500;
    if (!h.qa) h.input?.unlock();
    this.views[i].show();
    this.counts.opens++;
    this.door(i);
    return true;
  }

  /** Close the open view. A player close re-takes the mouse (or shows "click to aim"). */
  close(reason: TruckStorageCloseReason): void {
    const i = this.openIdx;
    if (i < 0) return;
    this.openIdx = -1;
    this.views[i].hide();
    this.ownsPointer = false;
    this.lockGraceUntil = now() + 300;
    this.pose = null;
    this.counts.closes++;
    this.lastClose = reason;
    const h = this.host, name = TRUCK_COMPARTMENTS[i].name;
    if (reason === 'state' || reason === 'travel' || reason === 'gone') return;
    this.door(i);
    if (reason === 'hit') h.hud.toast(TRUCK_STORAGE_TEXT.hit(name), true);
    if (reason === 'distance') h.hud.toast(TRUCK_STORAGE_TEXT.far(name), true);
    const inp = h.input;
    if (h.state !== 'playing' || h.qa || !inp || inp.locked) return;
    void inp.lock().then(ok => { if (!ok && h.state === 'playing' && !inp.locked) h.gear?.showResume?.(); });
  }

  /** (follow-up) The compartments' doors on the truck's view: the open one swings out, the others shut (eased; world/surface/truckModel.ts). */
  private stepDoors(dt: number): void {
    const v = this.car.view as TruckView | null;
    if (!v?.lockers || this.car.vehicle !== 'truck') return;
    stepLockerDoors(v, this.openId, dt);
  }

  /** The door cue at the compartment: the vehicle door sound (a steel door). */
  private door(i: number): void {
    const a = this.anchor(i);
    if (a) (this.host.sfx as {carDoor?(at?: {x: number; y: number; z: number}): void} | null)?.carDoor?.(a);
  }

  /** Per frame: the truck gone / moving / taken, death, out of reach -> close; redraw on changes (reloads, uses). */
  update(): void {
    const i = this.openIdx;
    if (i < 0) return;
    const car = this.car, b = car.body, P = this.host.player, o = this.pose, R = TRUCK_STORAGE_RT;
    if (!b || !o || !this.loaded) { this.close('gone'); return; }
    if (!P.alive) { this.close('state'); return; }
    if (car.driving) { this.close('driving'); return; }
    if (Math.hypot(b.x - o.x, b.z - o.z) > R.moved || Math.abs(wrapAngle(b.yaw - o.yaw)) > R.moved) { this.close('moved'); return; }
    const a = this.anchor(i)!;
    if (Math.hypot(P.x - a.x, P.z - a.z) > R.closeRange || Math.abs(P.y - b.y) > R.closeRise) { this.close('distance'); return; }
    const k = this.key();
    if (k !== this.seen) { this.seen = k; this.views[i].render(); }
  }

  private key(): string {
    return `${this.host.inv.version}:${this.openIdx >= 0 ? this.stores[this.openIdx].version : -1}`;
  }

  /** The keydown capture listener while open: E / 6 close, Tab / Esc / I close and go on, digits consumed (no quick slots). */
  onKeyCapture(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target' | 'preventDefault' | 'stopPropagation'>): void {
    const a = lockboxKeyAction(e, this.isOpen);
    if (a.kind === 'pass' || a.kind === 'reset') return;
    if (a.kind === 'close-pass') { this.close('state'); return; }
    e.preventDefault();
    e.stopPropagation(); // never reaches player/input.ts ([E] interact, quick slots 1-5, 6)
    if (a.kind === 'close') this.close('user');
  }

  /** The open view (null: none). */
  get view(): LockboxView | null {
    return this.openIdx >= 0 ? this.views[this.openIdx] : null;
  }

  /** QA: a compact state report. */
  qa() {
    return {open: this.openId, loaded: this.loaded, aimed: this.aimed() ? TRUCK_COMPARTMENTS[this.aimedIndex()].id : null,
      compartments: TRUCK_COMPARTMENTS.map((c, i) => ({id: c.id, slots: c.slots, used: this.stores[i].used, contents: this.stores[i].summary(), anchor: this.anchor(i), by: this.standingBy(i)})),
      note: this.view?.note ?? '', noteBad: this.view?.noteBad ?? false, lastClose: this.lastClose, counts: {...this.counts}};
  }
}

/**
 * Installs the truck (one call in the Game constructor, after installSkywaysCar, installLockbox and installSkywaysTrunk): the truck's
 * definition joins the vehicle controller (picked at a Surface Run district's build) and its compartments' system. Inert elsewhere.
 */
export function installSurfaceTruck(game: Game): TruckStorageSystem {
  game.skywaysCar.addVehicle(TRUCK_DEF);
  const storage = new TruckStorageSystem(game as unknown as TruckStorageHost, game.skywaysCar).install();
  installTruckCondition(game as unknown as TruckFieldHost, game.skywaysCar, {
    model: () => surfaceMapOf(game)?.model() ?? null,
    open: () => surfaceMapOf(game)?.open() ?? false,
  });
  return storage;
}

/** What the condition / repair / board need from Game together (structural: the tests' Node host provides it). */
export type TruckFieldHost = TruckConditionHost & TruckRepairHost & TruckBoardHost;

/**
 * Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): the truck's condition (hits, fog pressure, smoke / fire, the
 * dash lamp), its repair at the nose and the planning-map board on its side — after the compartments, so their [E] targets come first
 * (SkywaysCar.access order) and the condition's section hook runs after the controller's build (the record read). Inert without the truck.
 */
export function installTruckCondition(host: TruckFieldHost, car: SkywaysCar, map: {model: () => PlanningMap | null; open: () => boolean}): {condition: TruckConditionSystem; repair: TruckRepairAccess; board: TruckBoardSystem} {
  const condition = new TruckConditionSystem(host, car).install();
  const repair = new TruckRepairAccess(host, car, () => condition.restore()).install();
  const board = new TruckBoardSystem(host, car, map.model, map.open).install();
  return {condition, repair, board};
}

const qaRef = (spec: string): StoreSideRef => {
  const [bar, n] = spec.split(':');
  return {bar: bar as StoreSideRef['bar'], index: Number(n)} as StoreSideRef;
};

/** QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks. */
export function truckQaApi(game: Game) {
  const car = () => game.skywaysCar ?? null;
  const sys = () => (car()?.access.find(a => a instanceof TruckStorageSystem) as TruckStorageSystem | undefined) ?? null;
  const repairOf = () => (car()?.access.find(a => a instanceof TruckRepairAccess) as TruckRepairAccess | undefined) ?? null;
  const boardOf = () => (car()?.access.find(a => a instanceof TruckBoardSystem) as TruckBoardSystem | undefined) ?? null;
  return {
    /** The truck: the controller's state (vehicle, pose, driving, enclosed, lamps), the compartments, the attachment points. */
    truck: () => {
      const c = car();
      if (!c || c.vehicle !== 'truck') return null;
      return {state: c.state(), transform: c.truckTransform() ? {...c.truckTransform()!} : null, attach: c.truckAttachPoints(), storage: sys()?.qa() ?? null};
    },
    /** Open a compartment's view as [E] on it would ('left-locker' | 'right-locker'; false: refused). */
    truckOpen: (id: string): boolean => sys()?.open(id) ?? false,
    truckClose: () => sys()?.close('user'),
    /** Click-transfer in the open view ('pack:0', 'hotbar:2', 'store:3'); returns the moved count. */
    truckQuick: (spec: string): number => sys()?.view?.quick(qaRef(spec)) ?? 0,
    /** Drag-move in the open view; returns the move result. */
    truckMove: (from: string, to: string, count?: number): string => sys()?.view?.move(qaRef(from), qaRef(to), count) ?? 'none',
    // (field follow-up) the condition, the repair, the planning-map board
    /** The truck's condition: the number (0..1), its stage, fire, breakdown, the fog pressure at it, the dash lamp, the repair / board state. */
    truckCondition: () => {
      const c = car(), cond = truckConditionOf(game);
      if (!c || c.vehicle !== 'truck' || !cond) return null;
      return {...cond.qa(), repair: repairOf()?.qa() ?? null, board: boardOf()?.qa() ?? null};
    },
    /** Set the condition (0..1; the stage's cues and notes as for a real change). */
    truckSetCondition: (v: number): number | null => {
      const cond = truckConditionOf(game);
      if (!cond || car()?.vehicle !== 'truck') return null;
      cond.setCondition(v);
      return cond.condition;
    },
    /** Repair now as a completed hold would (the 5 scrap drawn from the carried / worn-bag materials; refused: its reason). */
    truckRepair: () => repairOf()?.repair() ?? null,
    /** Open the planning map as [E] on the truck's board would (false: refused). */
    truckBoardOpen: (): boolean => boardOf()?.open() ?? false,
  };
}
