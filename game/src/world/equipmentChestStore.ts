// Task studio-train-crafting-v1-20261111-225628-01 (lane BENCH): THE CRAFTED CHEST'S STORE VIEW — what a TAP of [E] on a storage chest
// (craft/equipment.ts EQUIPMENT.chest; the unit itself, its body, carrying it and its lid are lane EQUIP's world/trainEquipment.ts)
// does: it opens the Lockbox transfer view (ui/lockboxView.ts LockboxView with CHEST_VIEW: "Chest", the Lockbox's 50 slots in its 10
// columns) over the unit's own slots. HOLDING [E] carries the chest — that stays the equipment system's rule and is never asked here.
//
// installEquipmentChestStore(game) (called from installCraftBench) only REGISTERS: `game.trainEquipment.uses.chest = {prompt, tap}`
// (craft/equipmentApi.ts EquipmentUse), frameHooks (the open view's close rules and redraw), hitListeners, stateListeners,
// sectionHooks (teardown closes), inputOwners (the mouse belongs to the view), the pointer-lock wrap and a keydown capture listener —
// the Skyways car trunk's rules (world/skywaysCarTrunk.ts), which are the Lockbox view's. ONE shared view for every chest: opening
// another chest closes the first.
//
// STORE: the unit's live `slots` (ordinary inventory stacks: uids, counts, magazines, filters, air, a backpack whole with its
// contents). Transfers ONLY through Inventory.storeMove / storeQuick / storeWornBag (atomic, uid-keeping, the Lockbox's refusals with
// "the chest" in their text). Nothing is created, refilled or re-rolled here; no developer drop (that stays the Lockbox's).
// PROMPT (a chest standing in the world, the train not moving): "[E] Open the storage chest (n/50) · hold [E] to carry it"; while its
// view is open "[E] Close the storage chest"; otherwise null = the equipment system's own prompt.
// OPEN: a tap while the game plays, the player is alive, no bag view is open and the chest stands in the world (`mode === 'world'`, a
// world pose). While the train moves (a ride phase, or the chest riding as cargo) a tap says "Not while the train is moving" and does
// nothing else. The lid goes up (unit.setOpen(true)) with the Lockbox lid's cue (the existing 'cabinetOpen').
// CLOSE: E / 6 / Close (user); Esc / Tab / I (they go on to pause / inventory); a hit; walking away (CHEST_STORE_RT.closeRange from
// the chest, closeRise off its floor); the chest moved or was picked up / became cargo (`mode !== 'world'`, or its pose changed);
// the train starting to move; any state but playing; death; teardown; the unit gone from units(). Every close lowers the lid
// (unit.setOpen(false)); a close the player sees also plays the Lockbox lid's 'cabinetClose'.

import type {Game} from '../game';
import {EQUIPMENT} from '../craft/equipment';
import type {EquipmentSystemLike, EquipmentUnit, EquipmentUse} from '../craft/equipmentApi';
import type {Inventory, StoreSideRef} from '../items/inventory';
import {LOCKBOX_GRID} from '../run/trainLockbox';
import {LockboxView, lockboxKeyAction, type StoreViewOptions} from '../ui/lockboxView';
import {towerCue} from './towerShared';

export const CHEST_STORE_RT = {
  /** The open view closes beyond closeRange (m, horizontal) from the chest, or with the feet closeRise (m) off its floor. */
  closeRange: 2.6,
  closeRise: 1.2,
  /** The chest moved this far (m / rad) since the view opened: it closes. */
  moved: 0.02,
} as const;

export const CHEST_STORE_TEXT = {
  /** (a runtime count on both sides of the slash: no bundled fragment that reads like a root-absolute URL) */
  prompt: (used: number, slots: number) => `<b>[E]</b> Open the storage chest (${used}/${slots}) · hold <b>[E]</b> to carry it`,
  close: '<b>[E]</b> Close the storage chest',
  moving: 'Not while the train is moving',
  hit: 'Hit! You let go of the chest',
  far: 'Too far from the chest — it closed',
  moved: 'The chest moved — it closed',
} as const;

/** The transfer view's look for a crafted chest (the Lockbox view's layout and slot count). */
export const CHEST_VIEW: Readonly<StoreViewOptions> = Object.freeze({id: 'chestview', name: 'Chest', the: 'the chest', slots: EQUIPMENT.chest.slots,
  columns: LOCKBOX_GRID.columns, heading: 'Storage chest · carry it anywhere'});

export type ChestCloseReason = 'user' | 'hit' | 'distance' | 'state' | 'travel' | 'gone' | 'moved';

/** What the chest's store view needs from Game (structural: tests drive it with a fake host + a real Inventory). */
export interface ChestStoreHost {
  /** Read on every use (Game replaces the inventory on Retry / Load). */
  inv: Inventory;
  player: {x: number; y: number; z: number; alive: boolean};
  state: string;
  qa?: boolean;
  hud: {toast(text: string, warn?: boolean): void};
  sfx: unknown;
  trainEquipment?: EquipmentSystemLike | null;
  trainRide?: {riding: boolean};
  frameHooks: ((dt: number) => void)[];
  stateListeners?: ((state: never, prev: never) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  inputOwners?: (() => boolean)[];
  hitListeners?: ((hit: {amount: number}) => void)[];
  input?: {onLockChange: (locked: boolean) => void; lock(): Promise<boolean>; unlock(): void; readonly locked: boolean} | null;
  gear?: {session?: unknown; cancelReady?(resync: boolean): void; showResume?(): void} | null;
  syncHeld?(): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class EquipmentChestStore {
  readonly view: LockboxView;
  /** What the equipment system calls for a chest (EquipmentSystemLike.uses.chest). */
  readonly use: EquipmentUse;
  /** The chest whose view is open (null: closed). */
  unit: EquipmentUnit | null = null;
  /** QA / tests. */
  readonly counts = {opens: 0, closes: 0, refused: 0, moving: 0};
  lastClose: ChestCloseReason | null = null;
  private openFlag = false;
  private pose: {x: number; y: number; z: number; yaw: number} | null = null;
  private ownsPointer = false;
  private lockGraceUntil = 0;
  private seen = '';

  constructor(readonly host: ChestStoreHost) {
    this.view = new LockboxView({
      inv: () => this.host.inv,
      slots: () => (this.openFlag ? this.unit?.slots ?? null : null),
      close: () => this.close('user'),
      changed: () => this.host.syncHeld?.(),
    }, CHEST_VIEW);
    this.use = {prompt: u => this.prompt(u), tap: u => this.tap(u)};
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  install(): this {
    const h = this.host;
    this.register();
    h.frameHooks.push(() => this.update());
    h.hitListeners?.push(hit => { if (this.openFlag && hit.amount > 0) this.close('hit'); });
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.close('state'); }) as (s: never, p: never) => void);
    h.sectionHooks.push({teardown: () => this.close('travel')});
    h.inputOwners?.push(() => this.openFlag); // the mouse belongs to the view: no fire / ADS / item use / flare
    const inp = h.input;
    if (inp) { // the view releases pointer lock WITHOUT pausing (like the Lockbox / trunk / bag view)
      const prev = inp.onLockChange;
      inp.onLockChange = locked => {
        if (!locked && (this.ownsPointer || now() < this.lockGraceUntil) && h.state === 'playing') return;
        prev(locked);
      };
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', e => this.onKeyCapture(e), {capture: true});
    return this;
  }

  /** The chest's use on the equipment system (kept there: re-checked per frame, should the system ever be replaced). */
  private register(): void {
    const eq = this.host.trainEquipment;
    if (eq && eq.uses.chest !== this.use) eq.uses.chest = this.use;
  }

  // --- the equipment system's side (EquipmentUse) ------------------------------------------------------------------------

  /** The train is moving (a ride phase), or this unit rides it as cargo. */
  private moving(u: EquipmentUnit): boolean {
    return !!this.host.trainRide?.riding || u.mode === 'cargo';
  }

  /** The look-at prompt of a chest (null: the equipment system's own). */
  prompt(u: EquipmentUnit): string | null {
    const slots = u.slots;
    if (!slots) return null;
    if (this.openFlag && this.unit === u) return CHEST_STORE_TEXT.close;
    if (u.mode !== 'world' || this.moving(u)) return null;
    let used = 0;
    for (const s of slots) if (s) used++;
    return CHEST_STORE_TEXT.prompt(used, slots.length);
  }

  /** [E] tapped on a chest: open its view (true), or — a kind without slots / a refused open — false: the default action. */
  tap(u: EquipmentUnit): boolean {
    if (this.openFlag) {
      const same = this.unit === u;
      this.close('user');
      if (same) return true;
    }
    if (!u.slots) return false;
    if (this.moving(u)) {
      this.counts.moving++;
      this.host.hud.toast(CHEST_STORE_TEXT.moving, true);
      return true;
    }
    return this.open(u);
  }

  // --- open / close ------------------------------------------------------------------------------------------------------

  /** Open the view over a chest's slots (a tap through the equipment system; QA). Refused outside play, dead, a bag view open, no world pose. */
  open(u: EquipmentUnit): boolean {
    const h = this.host;
    if (this.openFlag && this.unit === u) return true;
    const pose = u.slots && u.mode === 'world' && !this.moving(u) ? u.worldPose() : null;
    if (h.state !== 'playing' || !h.player.alive || h.gear?.session || !pose) { this.counts.refused++; return false; }
    if (this.openFlag) this.close('user');
    h.gear?.cancelReady?.(true);
    this.openFlag = true;
    this.unit = u;
    this.pose = {x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw};
    this.seen = this.key();
    this.ownsPointer = true;
    this.lockGraceUntil = now() + 500;
    if (!h.qa) h.input?.unlock();
    this.view.show();
    this.counts.opens++;
    u.setOpen(true);
    this.lid('cabinetOpen', 0.85);
    return true;
  }

  /** Close the view (every path lowers the lid). A player close re-takes the mouse (or shows "click to aim"). */
  close(reason: ChestCloseReason): void {
    if (!this.openFlag) return;
    const u = this.unit, h = this.host;
    this.openFlag = false;
    this.view.hide();
    this.ownsPointer = false;
    this.lockGraceUntil = now() + 300;
    this.counts.closes++;
    this.lastClose = reason;
    try { u?.setOpen(false); } catch { /* a unit that is gone has no lid */ }
    if (reason !== 'state' && reason !== 'travel' && reason !== 'gone') this.lid('cabinetClose', 0.8);
    this.unit = null;
    this.pose = null;
    if (reason === 'state' || reason === 'travel' || reason === 'gone') return;
    if (reason === 'hit') h.hud.toast(CHEST_STORE_TEXT.hit, true);
    if (reason === 'distance') h.hud.toast(CHEST_STORE_TEXT.far, true);
    if (reason === 'moved') h.hud.toast(CHEST_STORE_TEXT.moved, true);
    const inp = h.input;
    if (h.state !== 'playing' || h.qa || !inp || inp.locked) return;
    void inp.lock().then(ok => { if (!ok && h.state === 'playing' && !inp.locked) h.gear?.showResume?.(); });
  }

  /** The lid cue at the chest (the Lockbox lid's existing cabinet cues; no new audio). */
  private lid(cue: 'cabinetOpen' | 'cabinetClose', rate: number): void {
    const p = this.pose, u = this.unit;
    if (p && u) towerCue(this.host.sfx, cue, {x: p.x, y: p.y + u.def.height, z: p.z}, {rate, gain: 0.8});
  }

  /** Per playing frame: the chest gone / moved / carried / riding, death, out of reach -> close; redraw on changes. */
  update(): void {
    this.register();
    if (!this.openFlag) return;
    const h = this.host, P = h.player, u = this.unit, o = this.pose;
    if (!u || !o || !u.slots || !(h.trainEquipment?.units().includes(u) ?? false)) { this.close('gone'); return; }
    if (!P.alive) { this.close('state'); return; }
    if (h.trainRide?.riding) { this.close('travel'); return; }
    if (u.mode !== 'world') { this.close('moved'); return; }
    const p = u.worldPose();
    if (!p) { this.close('gone'); return; }
    if (Math.hypot(p.x - o.x, p.z - o.z) > CHEST_STORE_RT.moved || Math.abs(p.y - o.y) > CHEST_STORE_RT.moved || Math.abs(wrap(p.yaw - o.yaw)) > CHEST_STORE_RT.moved) {
      this.close('moved');
      return;
    }
    if (Math.hypot(P.x - p.x, P.z - p.z) > CHEST_STORE_RT.closeRange || Math.abs(P.y - p.y) > CHEST_STORE_RT.closeRise) { this.close('distance'); return; }
    const k = this.key();
    if (k !== this.seen) { this.seen = k; this.view.render(); }
  }

  private key(): string {
    return `${this.host.inv.version}:${this.unit?.storeVersion ?? -1}`;
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
    const u = this.unit;
    return {open: this.openFlag, unit: u?.uid ?? null, used: u?.slots ? u.slots.filter(Boolean).length : 0, slots: u?.slots?.length ?? CHEST_VIEW.slots,
      note: this.view.note, noteBad: this.view.noteBad, lastClose: this.lastClose, registered: this.host.trainEquipment?.uses.chest === this.use,
      counts: {...this.counts}};
  }
}

/** Installs the chest's store view (called from installCraftBench, after the train equipment system; registries only). */
export function installEquipmentChestStore(game: Game): EquipmentChestStore {
  return new EquipmentChestStore(game as unknown as ChestStoreHost).install();
}

const qaRef = (spec: string): StoreSideRef => {
  const [bar, n] = spec.split(':');
  return {bar: bar as StoreSideRef['bar'], index: Number(n)} as StoreSideRef;
};

/** QA hooks (spread by craftBenchQaApi) for SHORT serial browser spot checks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function chestStoreQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {craftBench?: {chestStore: EquipmentChestStore | null}; trainEquipment?: EquipmentSystemLike | null};
  const sys = () => g.craftBench?.chestStore ?? null;
  return {
    /** Open?, the unit, slots used, note, the last close, whether the chest use is registered. */
    chestStore: () => sys()?.qa() ?? null,
    /** Tap [E] on a chest as the equipment system would (by uid; default: the first chest in the world). */
    chestTap: (uid?: string): boolean => {
      const u = g.trainEquipment?.units().find(x => x.slots && (uid ? x.uid === uid : x.mode === 'world')) ?? null;
      return u ? sys()?.tap(u) ?? false : false;
    },
    chestClose: () => sys()?.close('user'),
    /** Click-transfer in the open view ('pack:0', 'hotbar:2', 'store:3'); returns the moved count. */
    chestQuick: (spec: string): number => sys()?.view.quick(qaRef(spec)) ?? 0,
    /** Drag-move in the open view; returns the move result. */
    chestMove: (from: string, to: string, count?: number): string => sys()?.view.move(qaRef(from), qaRef(to), count) ?? 'none',
    /** "Stow worn backpack". */
    chestStow: (): boolean => sys()?.view.stow() ?? false,
  };
}
