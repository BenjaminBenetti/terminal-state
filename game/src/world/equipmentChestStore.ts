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
//
// Task train-interaction-ux-20261112-063646 (lane SENTRY; user: "Replace the sentry's take-all-ammo interaction with a real FOUR-SLOT
// inventory. Normal interaction opens it; players drag real 5.56 in and take it back out using existing inventory/stack rules"):
// this controller is now THE STORE VIEW OF EVERY KIND WITH SLOTS, by trait (craft/equipment.ts EquipmentDef.slots / slotItem) — no
// kind is named in its rules (the file and its export names stay the chest's, where it began):
//  - register(): `uses[kind] = {prompt, tap}` for every kind with def.slots > 0;
//  - general storage (slotItem null — the chest) keeps CHEST_VIEW and every rule above unchanged;
//  - a FEED (slotItem set — the sentry's four slots of 5.56 mm rounds) opens the same LockboxView with its own small options
//    (storeViewOptions: its name, def.slots columns, no "Stow worn backpack", a help line that names the one item). The transfers are
//    the same Inventory.storeMove / storeQuick calls on the unit's live slots; what the slots take is the feed's store rule
//    (items/inventory.ts setStoreRule, set by the equipment system), so a refused item says "Only … go in the defense sentry." and
//    nothing moves. Its prompt counts the rounds ("[E] Open the defense sentry · 120 × 5.56mm") and ends with the notes its own
//    system adds (EquipmentSystemLike.promptNotes: "not plugged in" / no headroom). The turret using rounds up while the view is
//    open redraws it (the unit's storeVersion is part of the redraw key).

import type {Game} from '../game';
import {EQUIPMENT, EQUIPMENT_KINDS, type EquipmentDef} from '../craft/equipment';
import type {EquipmentSystemLike, EquipmentUnit, EquipmentUse} from '../craft/equipmentApi';
import type {Inventory, StoreSideRef} from '../items/inventory';
import {itemDef} from '../items/items';
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

const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** The texts of a unit's store, by the unit (`the`: its def's) or its view (`the`: the view options') — every kind with slots. */
export const STORE_TEXT = {
  /** (a runtime count on both sides of the slash: no bundled fragment that reads like a root-absolute URL) */
  open: (the: string, used: number, slots: number) => `<b>[E]</b> Open ${the} (${used}/${slots})`,
  /** A feed: how many of its one item it holds ('120 × 5.56mm'). */
  openFeed: (the: string, count: number, short: string) => `<b>[E]</b> Open ${the} · ${count} × ${short}`,
  close: (the: string) => `<b>[E]</b> Close ${the}`,
  moving: 'Not while the train is moving',
  hit: (the: string) => `Hit! You let go of ${the}`,
  far: (the: string) => `Too far from ${the} — it closed`,
  moved: (the: string) => `${capital(the)} moved — it closed`,
} as const;

/** The transfer view's look for a crafted chest (the Lockbox view's layout and slot count). */
export const CHEST_VIEW: Readonly<StoreViewOptions> = Object.freeze({id: 'chestview', name: 'Chest', the: 'the chest', slots: EQUIPMENT.chest.slots,
  columns: LOCKBOX_GRID.columns, heading: 'Storage chest · carry it anywhere'});

/** The chest's texts (STORE_TEXT for the chest and its view). */
export const CHEST_STORE_TEXT = {
  prompt: (used: number, slots: number) => STORE_TEXT.open(EQUIPMENT.chest.the, used, slots),
  close: STORE_TEXT.close(EQUIPMENT.chest.the),
  moving: STORE_TEXT.moving,
  hit: STORE_TEXT.hit(CHEST_VIEW.the),
  far: STORE_TEXT.far(CHEST_VIEW.the),
  moved: STORE_TEXT.moved(CHEST_VIEW.the),
} as const;

const FEED_VIEWS = new Map<string, Readonly<StoreViewOptions>>();
/**
 * The transfer view's look for a unit's store, from its traits: general storage (the chest) = CHEST_VIEW; a feed (def.slotItem: the
 * sentry) = its own small view — its slots in one row, no backpack stow, the one item it takes named in the heading and the help line.
 */
export function storeViewOptions(def: EquipmentDef): Readonly<StoreViewOptions> {
  if (!def.slotItem) return CHEST_VIEW;
  let o = FEED_VIEWS.get(def.kind);
  if (!o) {
    const item = itemDef(def.slotItem);
    o = Object.freeze({
      id: `${def.kind}view`, name: def.name, the: def.the, slots: def.slots, columns: Math.min(def.slots, LOCKBOX_GRID.columns),
      heading: `${item.name} only`, stow: false,
      help: `Click a stack to move it across · drag onto a slot · Shift-drag splits · only ${item.name} go in · walking away or getting hit closes ${def.the}`,
    });
    FEED_VIEWS.set(def.kind, o);
  }
  return o;
}

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
  /** One transfer view per look (storeViewOptions().id): the chest's is made at once, a feed's on its first open. */
  private readonly views = new Map<string, LockboxView>();
  /** The view that is open (null: closed). */
  private shown: LockboxView | null = null;
  /** What the equipment system calls for a unit with slots (EquipmentSystemLike.uses[kind], every kind with def.slots). */
  readonly use: EquipmentUse;
  /** The unit whose view is open (null: closed). */
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
    this.viewFor(EQUIPMENT.chest);
    this.use = {prompt: u => this.prompt(u), tap: u => this.tap(u)};
  }

  /** The transfer view of a kind's store (made once per look; its slots are the open unit's only while IT is the open view). */
  private viewFor(def: EquipmentDef): LockboxView {
    const o = storeViewOptions(def);
    let v = this.views.get(o.id);
    if (!v) {
      const view: LockboxView = v = new LockboxView({
        inv: () => this.host.inv,
        slots: () => (this.openFlag && this.shown === view ? this.unit?.slots ?? null : null),
        close: () => this.close('user'),
        changed: () => this.host.syncHeld?.(),
      }, o);
      this.views.set(o.id, v);
    }
    return v;
  }

  /** The open view — closed: the chest's (QA / tests read its note; its actions are refused while closed). */
  get view(): LockboxView {
    return this.shown ?? this.viewFor(EQUIPMENT.chest);
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

  /** The store's use on the equipment system for every kind with slots (kept there: re-checked per frame, should the system ever be replaced). */
  private register(): void {
    const eq = this.host.trainEquipment;
    if (!eq) return;
    for (const kind of EQUIPMENT_KINDS) if (EQUIPMENT[kind].slots > 0 && eq.uses[kind] !== this.use) eq.uses[kind] = this.use;
  }

  // --- the equipment system's side (EquipmentUse) ------------------------------------------------------------------------

  /** The train is moving (a ride phase), or this unit rides it as cargo. */
  private moving(u: EquipmentUnit): boolean {
    return !!this.host.trainRide?.riding || u.mode === 'cargo';
  }

  /**
   * The look-at prompt of a unit with slots (null: the equipment system's own): general storage counts its used slots, a feed its
   * rounds; then whatever the kind's own system adds (EquipmentSystemLike.promptNotes).
   */
  prompt(u: EquipmentUnit): string | null {
    const slots = u.slots, def = u.def;
    if (!slots) return null;
    if (this.openFlag && this.unit === u) return STORE_TEXT.close(def.the);
    if (u.mode !== 'world' || this.moving(u)) return null;
    let line: string;
    if (def.slotItem) line = STORE_TEXT.openFeed(def.the, u.ammo, itemDef(def.slotItem).short);
    else {
      let used = 0;
      for (const s of slots) if (s) used++;
      line = STORE_TEXT.open(def.the, used, slots.length);
    }
    for (const note of this.host.trainEquipment?.promptNotes ?? []) {
      let t: string | null = null;
      try { t = note(u); } catch (err) { console.warn(`equipment store: a ${u.kind} prompt note failed`, err); }
      if (t) line += ` · ${t}`;
    }
    return line;
  }

  /** [E] tapped on a unit with slots: open its view (true), or — a kind without slots / a refused open — false: nothing else happens. */
  tap(u: EquipmentUnit): boolean {
    if (this.openFlag) {
      const same = this.unit === u;
      this.close('user');
      if (same) return true;
    }
    if (!u.slots) return false;
    if (this.moving(u)) {
      this.counts.moving++;
      this.host.hud.toast(STORE_TEXT.moving, true);
      return true;
    }
    return this.open(u);
  }

  // --- open / close ------------------------------------------------------------------------------------------------------

  /** Open the view over a unit's slots (a tap through the equipment system; QA). Refused outside play, dead, a bag view open, no world pose. */
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
    this.shown = this.viewFor(u.def);
    this.shown.show();
    this.counts.opens++;
    u.setOpen(true);
    this.lid('cabinetOpen', 0.85);
    return true;
  }

  /** Close the view (every path lowers the lid). A player close re-takes the mouse (or shows "click to aim"). */
  close(reason: ChestCloseReason): void {
    if (!this.openFlag) return;
    const u = this.unit, h = this.host, view = this.shown;
    this.openFlag = false;
    view?.hide();
    this.shown = null;
    this.ownsPointer = false;
    this.lockGraceUntil = now() + 300;
    this.counts.closes++;
    this.lastClose = reason;
    try { u?.setOpen(false); } catch { /* a unit that is gone has no lid */ }
    if (reason !== 'state' && reason !== 'travel' && reason !== 'gone') this.lid('cabinetClose', 0.8);
    this.unit = null;
    this.pose = null;
    if (reason === 'state' || reason === 'travel' || reason === 'gone') return;
    const the = view?.opts.the ?? CHEST_VIEW.the;
    if (reason === 'hit') h.hud.toast(STORE_TEXT.hit(the), true);
    if (reason === 'distance') h.hud.toast(STORE_TEXT.far(the), true);
    if (reason === 'moved') h.hud.toast(STORE_TEXT.moved(the), true);
    const inp = h.input;
    if (h.state !== 'playing' || h.qa || !inp || inp.locked) return;
    void inp.lock().then(ok => { if (!ok && h.state === 'playing' && !inp.locked) h.gear?.showResume?.(); });
  }

  /** The lid cue at the unit (the Lockbox lid's existing cabinet cues; no new audio). */
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
    if (k !== this.seen) { this.seen = k; this.shown?.render(); }
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
    const u = this.unit, eq = this.host.trainEquipment;
    return {open: this.openFlag, unit: u?.uid ?? null, kind: u?.kind ?? null, view: this.view.opts.id, used: u?.slots ? u.slots.filter(Boolean).length : 0,
      slots: u?.slots?.length ?? CHEST_VIEW.slots, ammo: u?.ammo ?? 0, note: this.view.note, noteBad: this.view.noteBad, lastClose: this.lastClose,
      registered: !!eq && EQUIPMENT_KINDS.every(k => EQUIPMENT[k].slots === 0 || eq.uses[k] === this.use), counts: {...this.counts}};
  }
}

/** Installs the store view of the units with slots (called from installCraftBench, after the train equipment system; registries only). */
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
    /** Open?, the unit (+ kind, view id, rounds), slots used, note, the last close, whether the store use is registered. */
    chestStore: () => sys()?.qa() ?? null,
    /** Tap [E] on a unit with slots as the equipment system would (by uid — a chest or a sentry; default: the first one in the world). */
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
