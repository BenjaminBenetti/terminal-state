// Task studio-beta-skyways-vehicle-20261107-054512-01 (lane TRUNK): THE PRIZE CAR'S TRUNK — the Skyways car's own storage, a portable
// chest that stays with the car at its station (world/skywaysCar.ts; record v2 world/skywaysCarStore.ts `trunk`).
//
// STORE: a TrainLockbox of TRUNK_SLOTS (16) ordinary inventory slots (the item's own stackMax; every kind, a backpack whole with its
// contents; stacks keep their uid, count, mag, filter, air). It is loaded from SkywaysCar.trunkJSON right after the car's build (this
// system's section hook runs after the car's) and handed back through SkywaysCar.trunkSource whenever the car stores its record
// (teardown, getting out, play pausing): the car's record is the one persistent copy. A v1 record reads as an empty trunk once
// (upgradeCarRecord); nothing is ever duplicated or invented. The inventory's uid counter is reserved above the trunk's uids at load.
// It is the CAR's (this station's): never train cargo, never carried between stations.
//
// OPEN: [E] with the crosshair on the boot (TRUNK_RT.zone: a box in the car frame from the rear window's base back to the tail, measured
// on the cooked GLB) within TRUNK_RT.reach, nothing structural in between, standing BEHIND the car (feet behind the tail line, within
// the body's width + a margin, within TRUNK_RT.stand of the tail's centre, the car's storey), not seated, playing, alive, not climbing /
// riding / using an item, no other lane owning the hands, no bag view open. It goes through the car's own [E] handler and prompt
// (SkywaysCar.rear: the rear zone from behind -> "Open the trunk"; anywhere else the doors rule), so a press does exactly one thing; the
// stand zone behind the car never meets a door's reach. Seated, E always gets out first (the car's handler).
// VIEW: the Lockbox transfer view (ui/lockboxView.ts LockboxView with TRUNK_VIEW: "Trunk", 16 slots in 8 columns); transfers only
// through Inventory.storeMove / storeQuick / storeWornBag (atomic, uid-keeping). No developer drop here (that stays the Lockbox's).
// CLOSE: E / 6 / Esc / Tab / I / Close, walking out of reach (TRUNK_RT.closeRange from the anchor, closeRise off the car's floor), the
// car moving or someone getting in, a hit, any state but playing (pause / menu / inventory), death, the car gone, teardown. The anchor
// follows the car body every frame. The lid cue is the car's door sound (sfx.carDoor) on open / close; the body GLB has no separate
// lid node, so there is no lid animation.

import * as THREE from 'three';
import type {Game} from '../game';
import type {Levels} from '../gen/levels';
import type {Inventory, StoreSideRef} from '../items/inventory';
import {TrainLockbox} from '../run/trainLockbox';
import {LockboxView, lockboxKeyAction, type StoreViewOptions} from '../ui/lockboxView';
import {rayBox, type Box3Like} from './towerShared';
import {CAR_RT, type SkywaysCar} from './skywaysCar';
import {wrapAngle} from './skywaysCarPhysics';
import {carToWorld, worldToCar} from './skywaysCarSpec';
import {TRUNK_SLOTS} from './skywaysCarStore';

export const TRUNK_RT = {
  /**
   * The rear zone the crosshair must hit (car frame, m): the boot from the rear window's base (the glass ends at z ≈ 1.65) back to the
   * tail (z = length / 2 = 2.39), the deck 1.03–1.14 m high, the body ±0.97 m wide (the cooked GLB).
   */
  zone: {halfX: 0.95, y0: 0.25, y1: 1.18, z0: 1.6},
  /** Standing behind: the feet at car-frame z ≥ length / 2 - behind and |x| ≤ width / 2 + side, within stand (m, horizontal) of the tail's centre. */
  behind: 0.15,
  side: 0.3,
  stand: 1.7,
  /** Aim reach (eye -> the boot, m): the car's own. */
  reach: CAR_RT.enterReach,
  /** The open view closes beyond closeRange (m, horizontal) from the anchor, or with the feet closeRise (m) off the car's floor. */
  closeRange: 2.6,
  closeRise: 1.2,
  /** The anchor (car frame): the middle of the boot deck (the lid cue; the reach). */
  anchor: {x: 0, y: 1.05, z: 2.0},
  /** The car moved this far (m / rad) since the view opened: it closes. */
  moved: 0.02,
} as const;

export const TRUNK_TEXT = {
  open: '<b>[E]</b> Open the trunk',
  hit: 'Hit! You let go of the trunk',
  far: 'Too far from the trunk — it closed',
} as const;

/** The transfer view's look for the trunk (the Lockbox view's layout). */
export const TRUNK_VIEW: Readonly<StoreViewOptions> = Object.freeze({id: 'trunkview', name: 'Trunk', the: 'the trunk', slots: TRUNK_SLOTS, columns: 8,
  heading: 'Car trunk · stays with the car'});

export type TrunkCloseReason = 'user' | 'hit' | 'distance' | 'state' | 'travel' | 'gone' | 'moved' | 'driving';

/** What the trunk needs from Game (structural: tests drive it with the car's Node host + a real Inventory). */
export interface TrunkHost {
  /** Read on every use (Game replaces the inventory on Retry / Load). */
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

export class TrunkSystem {
  /** The live trunk (16 slots; loaded per car build, cleared at teardown). */
  readonly store = new TrainLockbox(TRUNK_SLOTS);
  readonly view: LockboxView;
  readonly prompt: string = TRUNK_TEXT.open;
  /** QA / tests. */
  readonly counts = {loads: 0, opens: 0, closes: 0, refused: 0};
  lastClose: TrunkCloseReason | null = null;
  private openFlag = false;
  /** The car build whose trunk the store holds (-1: none) — trunkSource hands the live slots back only for that build. */
  private loadedFor = -1;
  private pose: {x: number; z: number; yaw: number; pitch: number} | null = null;
  private ownsPointer = false;
  private lockGraceUntil = 0;
  private seen = '';
  private readonly box: Box3Like = {min: {x: 0, y: 0, z: 0}, max: {x: 0, y: 0, z: 0}};

  constructor(readonly host: TrunkHost, readonly car: SkywaysCar) {
    this.view = new LockboxView({
      inv: () => this.host.inv,
      slots: () => (this.openFlag ? this.store.slots : null),
      close: () => this.close('user'),
      changed: () => this.host.syncHeld?.(),
    }, TRUNK_VIEW);
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  /** The store holds this car build's trunk. */
  get loaded(): boolean {
    return this.loadedFor >= 0 && this.loadedFor === this.car.counts.builds && this.car.worldLive;
  }

  install(): this {
    const h = this.host, car = this.car;
    car.rear = this;
    car.trunkSource = () => (this.loaded ? this.store.toJSON().slots : car.trunkJSON);
    h.frameHooks.push(() => this.update());
    h.hitListeners?.push(hit => { if (this.openFlag && hit.amount > 0) this.close('hit'); });
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.close('state'); }) as (s: never, p: never) => void);
    // after the car's section hook (installed earlier): its build has read the record into trunkJSON; its teardown has stored the live slots
    h.sectionHooks.push({build: () => this.onBuild(), teardown: () => this.onTeardown()});
    h.inputOwners?.push(() => this.openFlag); // the mouse belongs to the view: no fire / ADS / item use / flare
    const inp = h.input;
    if (inp) { // the view releases pointer lock WITHOUT pausing (like the Lockbox / bag view)
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

  /** After the car's build: this station's car record's trunk -> the live store (uids reserved in the inventory). */
  onBuild(): void {
    this.close('travel');
    const car = this.car;
    if (!car.worldLive || !car.body) { this.store.clear(); this.loadedFor = -1; return; }
    this.store.load({v: 1, slots: car.trunkJSON});
    this.loadedFor = car.counts.builds;
    this.counts.loads++;
    this.host.inv.reserveUids(this.store.maxUid());
  }

  /** After the car's teardown stored the live slots in its record: close, forget. */
  onTeardown(): void {
    this.close('travel');
    this.store.clear();
    this.loadedFor = -1;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Aim / open / close

  /** The trunk's anchor in the world (the middle of the boot deck; follows the car body, its pitch on a flight too), null without a car. */
  anchor(): {x: number; y: number; z: number} | null {
    const b = this.car.body, A = TRUNK_RT.anchor;
    if (!b || !this.car.worldLive) return null;
    const pt = b.pitch ?? 0, cp = Math.cos(pt), sp = Math.sin(pt);
    const p = carToWorld(b.x, b.z, b.yaw, A.x, A.y * sp + A.z * cp);
    return {x: p.x, y: b.y + A.y * cp - A.z * sp, z: p.z};
  }

  /** The body line's height (feet) at car-frame z (on a stair flight it rises along the car: the car's own same-storey rule). */
  private lineY(lz: number): number {
    const b = this.car.body!;
    return b.y - lz * Math.tan(b.pitch ?? 0);
  }

  /** The player stands behind the car (on its storey, within reach of the tail). */
  standingBehind(): boolean {
    const b = this.car.body, P = this.host.player, S = this.car.spec;
    if (!b) return false;
    const lp = worldToCar(b.x, b.z, b.yaw, P.x, P.z);
    if (Math.abs(P.y - this.lineY(lp.z)) > CAR_RT.storeyY) return false;
    if (lp.z < S.length / 2 - TRUNK_RT.behind || Math.abs(lp.x) > S.width / 2 + TRUNK_RT.side) return false;
    return Math.hypot(lp.x, lp.z - S.length / 2) <= TRUNK_RT.stand;
  }

  /** The crosshair's hit on the boot (the rear zone) within reach with nothing structural in between, else null. */
  aimHit(): {t: number; x: number; y: number; z: number} | null {
    const h = this.host, car = this.car, b = car.body, L = h.levels, S = car.spec, Z = TRUNK_RT.zone;
    if (!b || !L) return null;
    h.camera.getWorldPosition(tv);
    h.camera.getWorldDirection(tv2);
    const lo = worldToCar(b.x, b.z, b.yaw, tv.x, tv.z), c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    const dz = tv2.x * s + tv2.z * c, oy = tv.y - b.y;
    // (a car on a flight) undo the body's pitch too: the view's rotation is (pitch, yaw, 'YXZ'), so local = Rx(-pitch) · the yaw frame
    const pt = b.pitch ?? 0, cp = Math.cos(pt), sp = Math.sin(pt);
    const o = {x: lo.x, y: oy * cp + lo.z * sp, z: lo.z * cp - oy * sp};
    const ld = {x: tv2.x * c - tv2.z * s, y: tv2.y * cp + dz * sp, z: dz * cp - tv2.y * sp};
    const B = this.box;
    B.min.x = -Z.halfX; B.min.y = Z.y0; B.min.z = Z.z0;
    B.max.x = Z.halfX; B.max.y = Z.y1; B.max.z = S.length / 2;
    const t = rayBox(o, ld, B, TRUNK_RT.reach);
    if (t === null) return null;
    const hit = {x: tv.x + tv2.x * t, y: tv.y + tv2.y * t, z: tv.z + tv2.z * t};
    if (!L.lineOfSight({x: tv.x, y: tv.y, z: tv.z}, hit, {slack: 0.15})) return null;
    return {t, ...hit};
  }

  /** SkywaysCar.rear: the crosshair on the boot from behind the car, and the trunk may open now. */
  aimed(): boolean {
    const h = this.host, car = this.car;
    if (this.openFlag || !this.loaded || !car.body || car.driving || h.state !== 'playing' || h.gear?.session) return false;
    if (!car.canEnter()) return false; // (alive, not climbing / riding / using an item, no other lane's hands)
    return this.standingBehind() && this.aimHit() !== null;
  }

  /** SkywaysCar.rear: [E] on the boot. */
  interact(): boolean {
    return this.open();
  }

  /** Open the view ([E] through the car; QA). Refused outside play, dead, seated, a bag view open or without this build's trunk. */
  open(): boolean {
    const h = this.host, car = this.car, b = car.body;
    if (this.openFlag) return true;
    if (h.state !== 'playing' || !h.player.alive || h.gear?.session || !b || car.driving || !this.loaded) { this.counts.refused++; return false; }
    h.gear?.cancelReady?.(true);
    this.openFlag = true;
    this.pose = {x: b.x, z: b.z, yaw: b.yaw, pitch: b.pitch ?? 0};
    this.seen = this.key();
    this.ownsPointer = true;
    this.lockGraceUntil = now() + 500;
    if (!h.qa) h.input?.unlock();
    this.view.show();
    this.counts.opens++;
    this.lid();
    return true;
  }

  /** Close the view. A player close re-takes the mouse (or shows "click to aim"). */
  close(reason: TrunkCloseReason): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.view.hide();
    this.ownsPointer = false;
    this.lockGraceUntil = now() + 300;
    this.pose = null;
    this.counts.closes++;
    this.lastClose = reason;
    const h = this.host;
    if (reason === 'state' || reason === 'travel' || reason === 'gone') return;
    this.lid();
    if (reason === 'hit') h.hud.toast(TRUNK_TEXT.hit, true);
    if (reason === 'distance') h.hud.toast(TRUNK_TEXT.far, true);
    const inp = h.input;
    if (h.state !== 'playing' || h.qa || !inp || inp.locked) return;
    void inp.lock().then(ok => { if (!ok && h.state === 'playing' && !inp.locked) h.gear?.showResume?.(); });
  }

  /** The lid cue at the boot: the car's door sound (the model has no separate lid). */
  private lid(): void {
    const a = this.anchor();
    if (a) (this.host.sfx as {carDoor?(at?: {x: number; y: number; z: number}): void} | null)?.carDoor?.(a);
  }

  /** Per frame: the car gone / moving / taken, death, out of reach -> close; redraw on changes (reloads, uses). */
  update(): void {
    if (!this.openFlag) return;
    const car = this.car, b = car.body, P = this.host.player, o = this.pose;
    if (!b || !o || !this.loaded) { this.close('gone'); return; }
    if (!P.alive) { this.close('state'); return; }
    if (car.driving) { this.close('driving'); return; }
    if (Math.hypot(b.x - o.x, b.z - o.z) > TRUNK_RT.moved || Math.abs(wrapAngle(b.yaw - o.yaw)) > TRUNK_RT.moved || Math.abs((b.pitch ?? 0) - o.pitch) > TRUNK_RT.moved) {
      this.close('moved');
      return;
    }
    const a = this.anchor()!, lz = worldToCar(b.x, b.z, b.yaw, P.x, P.z).z;
    if (Math.hypot(P.x - a.x, P.z - a.z) > TRUNK_RT.closeRange || Math.abs(P.y - this.lineY(lz)) > TRUNK_RT.closeRise) { this.close('distance'); return; }
    const k = this.key();
    if (k !== this.seen) { this.seen = k; this.view.render(); }
  }

  private key(): string {
    return `${this.host.inv.version}:${this.store.version}`;
  }

  /** The keydown capture listener while open: E / 6 close, Tab / Esc / I close and go on, digits consumed (no quick slots, no code). */
  onKeyCapture(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target' | 'preventDefault' | 'stopPropagation'>): void {
    const a = lockboxKeyAction(e, this.openFlag);
    if (a.kind === 'pass' || a.kind === 'reset') return;
    if (a.kind === 'close-pass') { this.close('state'); return; }
    e.preventDefault();
    e.stopPropagation(); // never reaches player/input.ts ([E] interact, quick slots 1-5, 6)
    if (a.kind === 'close') this.close('user');
  }

  /** QA: a compact state report. */
  qa() {
    return {open: this.openFlag, loaded: this.loaded, used: this.store.used, slots: this.store.size, contents: this.store.summary(),
      note: this.view.note, noteBad: this.view.noteBad, anchor: this.anchor(), aimed: this.aimed(), behind: this.standingBehind(),
      lastClose: this.lastClose, counts: {...this.counts}};
  }
}

/** Installs the trunk on the Skyways car (one call in the Game constructor, after installSkywaysCar and installLockbox). */
export function installSkywaysTrunk(game: Game): TrunkSystem {
  return new TrunkSystem(game as unknown as TrunkHost, game.skywaysCar).install();
}

const qaRef = (spec: string): StoreSideRef => {
  const [bar, n] = spec.split(':');
  return {bar: bar as StoreSideRef['bar'], index: Number(n)} as StoreSideRef;
};

/** QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks. */
export function trunkQaApi(game: Game) {
  const sys = () => (game.skywaysCar?.rear instanceof TrunkSystem ? game.skywaysCar.rear : null);
  return {
    /** Open?, loaded, slots used, contents ('i:item×count@mag[bag]'), note, anchor, aimed / behind, the last close. */
    trunk: () => sys()?.qa() ?? null,
    /** Open the view as [E] on the boot would (false: not playing / no car / seated / a bag view open). */
    trunkOpen: () => sys()?.open() ?? false,
    trunkClose: () => sys()?.close('user'),
    /** Click-transfer in the open view ('pack:0', 'hotbar:2', 'store:3'); returns the moved count. */
    trunkQuick: (spec: string): number => sys()?.view.quick(qaRef(spec)) ?? 0,
    /** Drag-move in the open view; returns the move result. */
    trunkMove: (from: string, to: string, count?: number): string => sys()?.view.move(qaRef(from), qaRef(to), count) ?? 'none',
    /** "Stow worn backpack". */
    trunkStow: (): boolean => sys()?.view.stow() ?? false,
  };
}
