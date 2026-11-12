// Task train-lockbox-windows-20261101-232156 (lane BOX): the LOCKBOX TRANSFER VIEW and its controller (LockboxSystem).
//
// [E] on the Lockbox in the train's rear compartment (lane TRAIN calls PlayerTrainRuntime.onLockboxInteract) opens it; the world is
// NOT paused. Your melee / quick / grenade slots and pockets on the left, the Lockbox's LOCKBOX_SLOTS (50: 10 columns × 5 rows since task
// gameplay-feedback-20261111; the pockets in POCKET_GRID's columns) slots (run/trainLockbox.ts, owned by the
// run's player-train record) on the right: click moves an item across (merging; a backpack in the Lockbox is worn when your back is
// free), drag moves / merges / swaps, Shift-drag splits; "Stow worn backpack" puts yours in whole. Refusals show in red.
// It closes on E / 6 / Esc / Tab / Close, walking out of reach, a hit, pause, travel, death or the train unloading; every close
// lowers the lid (setLockboxOpen(false)).
// While it is open the digit keys belong to it (consumed: never the quick slots or any other binding) and feed the developer code:
// 1 3 3 7 drops the gear bundle into the Lockbox when ALL of it fits (items/devGrant.ts), else nothing changes.
//
// Task studio-beta-skyways-vehicle-20261107-054512-01 (lane TRUNK): LockboxView takes StoreViewOptions (its DOM id / CSS scope, the
// name in the title and in running text, the slot count, the store side's columns and heading; default LOCKBOX_VIEW = the Lockbox
// exactly as before) so the Skyways prize car's trunk (world/skywaysCarTrunk.ts) is the same view and the same Inventory.storeMove /
// storeQuick / storeWornBag moves over its own slot list. The 1337 drop stays the Lockbox's (LockboxSystem only).
//
// Task train-interaction-ux-20261112-063646 (lane SENTRY): two optional StoreViewOptions for a store that is not general storage (the
// sentry's four feed slots, world/equipmentChestStore.ts): `stow: false` leaves the "Stow worn backpack" button out, `help` replaces
// the help line. Absent = the Lockbox / trunk / chest exactly as before.

import type {Game} from '../game';
import {itemIconHtml, onItemIconsChanged} from './itemIcons';
import {itemDef} from '../items/items';
import {itemTip} from './itemTip'; // (task studio-ui-subway-maps-20261108-074144-01)
import {hideTooltip, refreshTooltip, setTip, tipAttrs} from './tooltip';
import {isBagItem} from '../items/gear';
import {PACK_SIZE, POCKET_GRID, type Inventory, type ItemStack, type StoreSideRef} from '../items/inventory';
import {ICONS} from './icons';
import {WEAPONS} from '../weapons/weapons';
import {DRAG_THRESHOLD} from './inventoryUI';
import {isTypingTarget} from '../player/input';
import {CONTAINER_REACH} from '../world/containers';
import {LOCKBOX_GRID, LOCKBOX_NAME, LOCKBOX_SLOTS, type TrainLockbox} from '../run/trainLockbox';
import {DEV_GRANT_SEQUENCE, SequenceMatcher, devGrantBundle, digitOfCode, grantAllOrNothing, grantText} from '../items/devGrant';

/** What lane TRAIN's runtime offers (world/playerTrain.ts PlayerTrainRuntime; absent members = no Lockbox in this build). */
export interface LockboxTrainApi {
  onLockboxInteract: (() => void) | null;
  setLockboxOpen(open: boolean): void;
  /** World centre of the box top, null when no Lockbox is built (no train in this level / unloaded). */
  lockboxWorld(): {x: number; y: number; z: number} | null;
  lockboxAimed: boolean;
}

/** The open view closes beyond this horizontal distance from the box (the containers' reach + a small margin). */
export const LOCKBOX_VIEW_RANGE = CONTAINER_REACH + 0.4;
/** ... or this far above / below the box top. */
const LOCKBOX_VIEW_RISE = 1.6;
const MODIFIER_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock']);

/** What a keydown does while the Lockbox view is (or is not) open. */
export type LockboxKey =
  | {kind: 'pass'} // not the view's: the game / browser handles it as usual
  | {kind: 'digit'; digit: string} // consumed: the developer-code matcher only (never the quick slots / hotkeys)
  | {kind: 'swallow'} // consumed, nothing else (auto-repeat)
  | {kind: 'close'} // E / 6: consumed, closes the view
  | {kind: 'close-pass'} // Tab / Esc / I: closes, then goes on (inventory / pause)
  | {kind: 'reset'}; // any other key: not consumed (WASD still walks), the code starts over

/** The view's key scope (pure; the capture listener applies it). Nothing is taken while closed or while typing in a field. */
export function lockboxKeyAction(e: {code: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: unknown}, open: boolean): LockboxKey {
  if (!open || isTypingTarget(e.target)) return {kind: 'pass'};
  if (e.code === 'KeyE' || e.code === 'Digit6') return e.repeat ? {kind: 'swallow'} : {kind: 'close'};
  if (e.code === 'Tab' || e.code === 'Escape' || e.code === 'KeyI') return {kind: 'close-pass'};
  const d = digitOfCode(e.code);
  if (d !== null && !e.ctrlKey && !e.altKey && !e.metaKey) return e.repeat ? {kind: 'swallow'} : {kind: 'digit', digit: d};
  if (e.repeat || MODIFIER_KEYS.has(e.code)) return {kind: 'pass'};
  return {kind: 'reset'};
}

// --- the view (DOM) ------------------------------------------------------------------------------------------------------

export interface LockboxViewHost {
  inv(): Inventory;
  /** The Lockbox slots while the view is open (null: closed — every action is refused). */
  slots(): (ItemStack | null)[] | null;
  close(): void;
  /** Inventory changed (re-sync the held item). */
  changed(): void;
}

type Side = 'hotbar' | 'pack' | 'store' | 'throw' | 'melee';
const refOf = (el: HTMLElement | null): StoreSideRef | null => el && el.dataset.bar ? {bar: el.dataset.bar as Side, index: Number(el.dataset.index)} as StoreSideRef : null;

/** (lane TRUNK) What the transfer view shows for its store (the Lockbox: LOCKBOX_VIEW). */
export interface StoreViewOptions {
  /** The root element's DOM id and CSS scope (one view per id). */
  id: string;
  /** The title / short name ('Lockbox'). */
  name: string;
  /** The store in running text ('the Lockbox'). */
  the: string;
  /** The store's slot count (the title counts the live list). */
  slots: number;
  /** The store side's grid columns. */
  columns: number;
  /** The store side's heading. */
  heading: string;
  /** false: no "Stow worn backpack" button (a store that takes no backpack). Default: shown. */
  stow?: boolean;
  /** The help line under the actions (default: the Lockbox's, naming `the`). */
  help?: string;
}

export const LOCKBOX_VIEW: Readonly<StoreViewOptions> = Object.freeze({id: 'lockboxview', name: LOCKBOX_NAME, the: `the ${LOCKBOX_NAME}`, slots: LOCKBOX_SLOTS,
  columns: LOCKBOX_GRID.columns, heading: 'Train storage · travels with you'}); // (lane STORAGE: the grid's 10 columns, now 5 full rows)

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The view's CSS scoped to its id (the Lockbox: exactly the original rules); the store grid takes its columns' share of the width.
 * (lane STORAGE) A store / pockets column count without a static rule (POCKET_GRID, the store's grid) gets one generated at the end.
 */
const css = (id: string, columns: number) => `
#lockboxview { position: fixed; inset: 0; z-index: 45; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 92px; pointer-events: auto; cursor: default; }
#lockboxview.hidden { display: none; }
#lockboxview .lb-panel { width: min(${Math.round((1240 * (7 + columns)) / 17)}px, calc(100vw - 24px)); background: rgba(16, 18, 20, 0.9); border: 1px solid #3a3f44; border-top: 3px solid var(--teal); padding: 10px 14px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6); color: var(--cream); font-size: 13px; }
#lockboxview .lb-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 6px; }
#lockboxview .lb-head b { font-size: 15px; letter-spacing: 0.04em; }
#lockboxview .lb-live { color: var(--red); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
#lockboxview .lb-cols { display: grid; grid-template-columns: 7fr 26px ${columns}fr; gap: 8px; align-items: start; }
#lockboxview .lb-arrow { align-self: center; text-align: center; color: var(--cream-dim); font-size: 18px; }
#lockboxview h4 { margin: 4px 0; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cream-dim); font-weight: 600; }
#lockboxview .slots { display: grid; gap: 6px; }
#lockboxview .lb-g6 { grid-template-columns: repeat(6, 1fr); }
#lockboxview .lb-g7 { grid-template-columns: repeat(7, 1fr); }
#lockboxview .lb-g10 { grid-template-columns: repeat(10, 1fr); }
#lockboxview .slot { height: 54px; font-size: 11px; }
#lockboxview .slot img.ico3d { height: 32px; }
#lockboxview .slot svg { width: 40px; height: 22px; }
#lockboxview .slot .nm { font-size: 10px; }
#lockboxview .slot .count { top: 3px; bottom: auto; font-size: 11px; }
#lockboxview .slot.filled { cursor: grab; touch-action: none; }
#lockboxview .slot .ghost { color: #4a5157; display: flex; }
#lockboxview .slot[data-bar="melee"] { order: -1; border-style: dashed; }
#lockboxview .slot[data-bar="melee"].filled { border-style: solid; }
#lockboxview .slot[data-bar="melee"] .key, #lockboxview .slot[data-bar="throw"] .key { color: var(--teal); }
#lockboxview.dragging, #lockboxview.dragging .slot { cursor: grabbing; }
#lockboxview .lb-note { min-height: 1.2em; margin-top: 6px; color: var(--mustard); }
#lockboxview .lb-note.refused { color: var(--red); font-weight: 700; }
#lockboxview .lb-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
#lockboxview .lb-actions button { padding: 6px 12px; }
#lockboxview .lb-help { margin-top: 4px; font-size: 11.5px; color: var(--cream-dim); }
#lockboxview-ghost { position: fixed; left: -40px; top: -27px; width: 80px; height: 54px; z-index: 61; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(21, 23, 26, 0.88); border: 1px solid var(--teal); color: var(--cream); font-size: 11px; }
#lockboxview-ghost img.ico3d { width: 70px; height: 34px; object-fit: contain; }
#lockboxview-ghost svg { width: 46px; height: 24px; }
${[...new Set([columns, POCKET_GRID.columns])].filter(n => n !== 6 && n !== 7 && n !== 10).map(n => `#lockboxview .lb-g${n} { grid-template-columns: repeat(${n}, 1fr); }\n`).join('')}`.split('#lockboxview').join(`#${id}`);
/** CSS injected once per view id. */
const styled = new Set<string>();

export class LockboxView {
  private root: HTMLElement | null = null;
  private drag: {from: StoreSideRef; count: number; pointerId: number; x0: number; y0: number; active: boolean; ghost: HTMLElement | null} | null = null;
  private suppressClick = false;
  /** The message under the slots (refusals in red). */
  note = '';
  noteBad = false;
  /** Last action (QA / tests). */
  last: {kind: string; from?: StoreSideRef; to?: StoreSideRef | null; result: string} | null = null;

  constructor(private readonly host: LockboxViewHost, readonly opts: Readonly<StoreViewOptions> = LOCKBOX_VIEW) {
    // (task studio-weapon-runtime-fix-20261110-022206-01) item icons were (re)rendered — a weapon model that arrived while this view shows
    // the weapon: redraw, so its glyph becomes the rendered preview at once (never mid-drag: the drop redraws)
    onItemIconsChanged(() => { if (this.visible && !this.drag?.active) this.render(); });
  }

  get visible(): boolean {
    return !!this.root && !this.root.classList.contains('hidden');
  }

  show(): void {
    this.mount();
    this.note = '';
    this.noteBad = false;
    if (!this.root) return; // no DOM (tests)
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.cancelDrag();
    this.root?.classList.add('hidden');
    hideTooltip(); // (task studio-ui-subway-maps-20261108-074144-01) the tooltip goes with the panel
  }

  private mount(): void {
    if (this.root || typeof document === 'undefined') return;
    const o = this.opts;
    if (!styled.has(o.id)) {
      styled.add(o.id);
      const st = document.createElement('style');
      st.id = o.id === LOCKBOX_VIEW.id ? 'lockbox-styles' : `${o.id}-styles`;
      st.textContent = css(o.id, o.columns);
      document.head.appendChild(st);
    }
    const el = document.createElement('section');
    el.id = o.id;
    el.className = 'hidden';
    el.setAttribute('aria-label', o.name);
    el.innerHTML = `<div class="lb-panel">
      <div class="lb-head"><b class="lb-title">${o.name}</b><span class="lb-live">● Not paused — keep an eye out</span></div>
      <div class="lb-cols">
        <div class="lb-side"><h4>Melee · quick slots · grenade slot</h4><div class="slots lb-g7" data-side="hotbar"></div><h4 class="lb-pockets">Pockets</h4><div class="slots lb-g${POCKET_GRID.columns}" data-side="pack"></div></div>
        <div class="lb-arrow">⇄</div>
        <div class="lb-side"><h4>${o.heading}</h4><div class="slots lb-g${o.columns}" data-side="store"></div></div>
      </div>
      <div class="lb-note"></div>
      <div class="lb-actions">${o.stow === false ? '' : '<button class="lb-stow" type="button">Stow worn backpack</button>'}<button class="lb-close primary" type="button">Close (E)</button></div>
      <div class="lb-help">${o.help ?? `Click an item to move it across · drag onto a slot · Shift-drag splits · a backpack taken out is worn · walking away or getting hit closes ${o.the}`}</div>
    </div>`;
    (document.querySelector('#app') ?? document.body).appendChild(el);
    this.root = el;
    const slotSel = `#${o.id} .slot`;
    const slotEl = (e: Event) => (e.target as HTMLElement | null)?.closest?.(slotSel) as HTMLElement | null;
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const ref = refOf(slotEl(e));
      if (ref && !this.drag?.active) this.quick(ref);
    });
    el.addEventListener('click', e => {
      if (this.suppressClick) return;
      const t = e.target as HTMLElement;
      if (t.closest('.lb-close')) { this.host.close(); return; }
      if (t.closest('.lb-stow')) { this.stow(); return; }
      const ref = refOf(slotEl(e));
      if (ref) this.quick(ref);
    });
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const ref = refOf(slotEl(e));
      const st = ref ? this.stackAt(ref) : null;
      if (!ref || !st) return;
      e.preventDefault();
      this.cancelDrag();
      this.drag = {from: ref, count: e.shiftKey && st.count > 1 ? Math.floor(st.count / 2) : st.count, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, ghost: null};
    });
    el.addEventListener('dragstart', e => e.preventDefault());
    window.addEventListener('pointermove', e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if ((e.buttons & 1) === 0) { this.cancelDrag(); return; }
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_THRESHOLD) return;
        const st = this.stackAt(d.from);
        if (!this.visible || !st) { this.cancelDrag(); return; }
        d.active = true;
        const g = document.createElement('div');
        g.id = `${this.opts.id}-ghost`;
        g.innerHTML = `${itemIconHtml(st.itemId)}${d.count > 1 ? `<span class="count">×${d.count}</span>` : ''}`;
        document.body.appendChild(g);
        d.ghost = g;
        el.classList.add('dragging');
      }
      if (d.ghost) d.ghost.style.transform = `translate(${Math.round(e.clientX)}px, ${Math.round(e.clientY)}px)`;
    });
    window.addEventListener('pointerup', e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.active) { this.drag = null; return; } // a click: the click handler moves it across
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 0);
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const to = refOf(target?.closest?.(slotSel) as HTMLElement | null);
      this.cancelDrag();
      if (to && this.visible) this.move(d.from, to, d.count);
    });
    window.addEventListener('pointercancel', e => { if (this.drag && e.pointerId === this.drag.pointerId) this.cancelDrag(); });
  }

  private cancelDrag(): void {
    const d = this.drag;
    this.drag = null;
    d?.ghost?.remove();
    this.root?.classList.remove('dragging');
  }

  private stackAt(ref: StoreSideRef): ItemStack | null {
    if (ref.bar === 'store') return this.host.slots()?.[ref.index] ?? null;
    return this.host.inv().get(ref);
  }

  /** Click-transfer to the other side (also the QA hook). Returns how many items moved. */
  quick(ref: StoreSideRef): number {
    const slots = this.host.slots(), inv = this.host.inv();
    if (!slots) { this.say(this.closedText(), true); return 0; }
    const st = this.stackAt(ref);
    const name = st ? itemDef(st.itemId).short : '';
    const bag = ref.bar === 'store' && isBagItem(st?.itemId);
    const n = inv.storeQuick(slots, ref);
    this.last = {kind: 'quick', from: ref, result: String(n)};
    if (n > 0) this.say(bag ? `Wearing the ${name.toLowerCase()} (its contents came with it)` : `${n > 1 ? `${n} × ` : ''}${name} → ${ref.bar === 'store' ? 'you' : this.opts.name}`, false);
    else if (inv.refusal) this.say(this.storeText(inv.refusal.text), true);
    this.host.changed();
    this.render();
    return n;
  }

  /** Drag-move (also the QA hook). */
  move(from: StoreSideRef, to: StoreSideRef, count?: number): string {
    const slots = this.host.slots(), inv = this.host.inv();
    if (!slots) { this.say(this.closedText(), true); return 'closed'; }
    const r = inv.storeMove(slots, from, to, count);
    this.last = {kind: 'move', from, to, result: r};
    if (r === 'refused' && inv.refusal) this.say(this.storeText(inv.refusal.text), true);
    else if (r !== 'none') this.say('', false);
    this.host.changed();
    this.render();
    return r;
  }

  /** "Stow worn backpack": the worn bag (with its contents) into the first free Lockbox slot. */
  stow(): boolean {
    const slots = this.host.slots(), inv = this.host.inv();
    if (!slots) { this.say(this.closedText(), true); return false; }
    const worn = inv.worn('backpack'); // (task filter-tension-airtank: an Airtank Backpack is stowed whole too — name what went in)
    const ok = inv.storeWornBag(slots);
    this.last = {kind: 'stow', result: String(ok)};
    const the = this.opts.the;
    this.say(ok ? (worn && !isBagItem(worn.itemId) ? `${itemDef(worn.itemId).name} stowed in ${the}` : `Backpack stowed in ${the} (its contents stay inside)`) : this.storeText(inv.refusal?.text ?? 'Nothing to stow.'), !ok);
    this.host.changed();
    this.render();
    return ok;
  }

  private closedText(): string {
    return `Open ${this.opts.the} (E) to reach into it.`;
  }

  /** The Inventory's store refusals name the Lockbox: another store's view names itself (the Lockbox's own text is unchanged). */
  storeText(text: string): string {
    const the = this.opts.the, lb = LOCKBOX_VIEW.the;
    return the === lb ? text : text.split(lb).join(the).split(capital(lb)).join(capital(the));
  }

  say(text: string, bad: boolean): void {
    this.note = text;
    this.noteBad = bad;
    const n = this.root?.querySelector('.lb-note');
    if (n) { n.textContent = text; n.classList.toggle('refused', bad); }
  }

  render(): void {
    const root = this.root, slots = this.host.slots();
    if (!root || !slots) return;
    const inv = this.host.inv();
    const sel = inv.selectedRef();
    const cell = (ref: StoreSideRef, st: ItemStack | null) => {
      const def = st ? itemDef(st.itemId) : null;
      const w = def?.kind === 'weapon' ? WEAPONS[def.weaponId!] : null;
      const count = def ? (w ? (w.melee ? '' : `<span class="count">${st!.mag}/${w.magazine}</span>`) : st!.count > 1 ? `<span class="count">×${st!.count}</span>` : '') : '';
      const verb = ref.bar === 'store' ? (st && isBagItem(st.itemId) ? 'to wear it' : 'to take it') : `into ${this.opts.the}`;
      // (task studio-ui-subway-maps-20261108-074144-01) the game's own tooltip (a bag's contents count is in its lines; escaped names)
      const title = st ? tipAttrs(itemTip(st, `Click to move it ${verb} · drag to a slot`, {inv})) : '';
      const extra = ref.bar === 'pack' && ref.index >= PACK_SIZE ? ' gear-extra' : '';
      const held = ref.bar === sel.bar && ref.index === sel.index ? ' held' : '';
      const key = ref.bar === 'hotbar' ? `<span class="key">${ref.index + 1}</span>` : ref.bar === 'throw' ? '<span class="key">G</span>'
        : ref.bar === 'melee' ? `<span class="key">~</span>${def ? '' : `<span class="ghost">${ICONS.knife}</span>`}` : '';
      return `<div class="slot${def ? ' filled' : ''}${extra}${held}" data-bar="${ref.bar}" data-index="${ref.index}"${title}>${key}${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? def.short : ''}</span>${count}</div>`;
    };
    const side = (name: Side, list: readonly (ItemStack | null)[], extra = '') => {
      const box = root.querySelector(`[data-side="${name}"]`);
      if (box) box.innerHTML = list.map((st, i) => cell({bar: name, index: i} as StoreSideRef, st)).join('') + extra;
    };
    side('hotbar', inv.hotbar, inv.throwSlot.map((st, i) => cell({bar: 'throw', index: i}, st)).join('') + inv.meleeSlot.map((st, i) => cell({bar: 'melee', index: i}, st)).join(''));
    side('pack', inv.pack);
    side('store', slots);
    const ex = inv.extraPockets;
    const pk = root.querySelector('.lb-pockets');
    if (pk) pk.textContent = `Pockets · ${inv.pack.length}${ex ? ` (${PACK_SIZE} + ${ex} chest rig)` : ''}`;
    const tt = root.querySelector('.lb-title');
    if (tt) tt.textContent = `${this.opts.name} · ${slots.filter(Boolean).length}/${slots.length} slots used`; // (a runtime count: no bundled '/40' fragment, ci:package)
    const stow = root.querySelector('.lb-stow') as HTMLButtonElement | null;
    if (stow) {
      const worn = inv.worn('backpack');
      stow.disabled = !worn;
      setTip(stow, {head: 'Stow worn backpack', hint: worn ? `Put your backpack (and everything in it) into ${this.opts.the}` : 'You are not wearing a backpack'});
    }
    const n = root.querySelector('.lb-note');
    if (n) { n.textContent = this.note; n.classList.toggle('refused', this.noteBad); }
    refreshTooltip();
  }
}

// --- the controller ------------------------------------------------------------------------------------------------------

type CloseReason = 'user' | 'hit' | 'distance' | 'state' | 'travel' | 'gone';

export class LockboxSystem {
  readonly view: LockboxView;
  /** The 1337 developer-code matcher (reset on open / close / blur / a hidden tab / a wrong key). */
  readonly matcher = new SequenceMatcher(DEV_GRANT_SEQUENCE);
  /** The last developer drop (QA / tests). */
  lastGrant: {ok: boolean; need: number; free: number} | null = null;
  private openFlag = false;
  private ownsPointer = false;
  private lockGraceUntil = 0;
  private seen = '';

  constructor(private readonly game: Game) {
    this.view = new LockboxView({
      inv: () => this.game.inv,
      slots: () => (this.openFlag ? this.store.slots : null),
      close: () => this.close('user'),
      changed: () => this.game.syncHeld(),
    });
  }

  /** The run's Lockbox (the player-train record's store). */
  get store(): TrainLockbox {
    return this.game.playerTrain.lockbox;
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  private train(): Partial<LockboxTrainApi> | null {
    return (this.game.trainRuntime as unknown as Partial<LockboxTrainApi> | undefined) ?? null;
  }

  install(): this {
    const g = this.game;
    g.frameHooks.push(() => this.update());
    g.hitListeners.push(hit => { if (this.openFlag && hit.amount > 0) this.close('hit'); });
    g.stateListeners.push(s => { if (s !== 'playing') this.close('state'); });
    g.sectionHooks.push({teardown: () => this.close('travel')});
    g.inputOwners.push(() => this.openFlag); // the mouse belongs to the view: no fire / ADS / item use / flare
    const prev = g.input.onLockChange; // the view releases pointer lock WITHOUT pausing (like the bag view)
    g.input.onLockChange = locked => {
      if (!locked && (this.ownsPointer || performance.now() < this.lockGraceUntil) && g.state === 'playing') return;
      prev(locked);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', e => this.onKeyCapture(e), {capture: true});
      window.addEventListener('blur', () => this.matcher.reset());
      document.addEventListener('visibilitychange', () => this.matcher.reset());
    }
    const t = this.train();
    if (t) t.onLockboxInteract = () => { if (this.openFlag) this.close('user'); else this.open(); };
    return this;
  }

  /** Open the view (the TRAIN [E] callback; QA). Refused outside play, when dead, while a bag view is open or with no Lockbox built. */
  open(): boolean {
    const g = this.game;
    if (this.openFlag) return true;
    if (g.state !== 'playing' || !g.player.alive || g.gear?.session || !this.train()?.lockboxWorld?.()) return false;
    g.gear?.cancelReady(true);
    this.openFlag = true;
    this.matcher.reset();
    this.seen = this.key();
    this.ownsPointer = true;
    this.lockGraceUntil = performance.now() + 500;
    if (!g.qa) g.input.unlock();
    this.view.show();
    this.train()?.setLockboxOpen?.(true);
    return true;
  }

  /** Close the view (every path lowers the lid). A player close re-takes the mouse (or shows "click to aim"). */
  close(reason: CloseReason): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.matcher.reset();
    this.view.hide();
    this.ownsPointer = false;
    this.lockGraceUntil = performance.now() + 300;
    this.train()?.setLockboxOpen?.(false);
    const g = this.game;
    if (reason === 'state' || reason === 'travel') return;
    if (reason === 'hit') g.hud.toast('Hit! You let go of the Lockbox', true);
    if (g.state !== 'playing' || g.qa || g.input.locked) return;
    void g.input.lock().then(ok => { if (!ok && g.state === 'playing' && !g.input.locked) g.gear?.showResume(); });
  }

  /** Per playing frame: out of reach / no Lockbox any more / dead -> close; redraw on changes (reloads, uses). */
  update(): void {
    if (!this.openFlag) return;
    const g = this.game, p = g.player, at = this.train()?.lockboxWorld?.() ?? null;
    if (!at) { this.close('gone'); return; }
    if (!p.alive) { this.close('state'); return; }
    if (Math.hypot(p.x - at.x, p.z - at.z) > LOCKBOX_VIEW_RANGE || Math.abs(p.y - at.y) > LOCKBOX_VIEW_RISE) {
      this.close('distance');
      g.hud.toast(`Too far from the ${LOCKBOX_NAME} — it closed`, true);
      return;
    }
    const k = this.key();
    if (k !== this.seen) { this.seen = k; this.view.render(); }
  }

  private key(): string {
    return `${this.game.inv.version}:${this.store.version}`;
  }

  /** The keydown capture listener (window, capture phase): applies lockboxKeyAction. */
  onKeyCapture(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'target' | 'preventDefault' | 'stopPropagation'>): void {
    const a = lockboxKeyAction(e, this.openFlag);
    if (a.kind === 'pass') return;
    if (a.kind === 'close-pass') { this.close('state'); return; }
    if (a.kind === 'reset') { this.matcher.reset(); return; }
    e.preventDefault();
    e.stopPropagation(); // never reaches player/input.ts (quick slots 1-5, 6, any other binding)
    if (a.kind === 'close') this.close('user');
    else if (a.kind === 'digit') this.digit(a.digit);
  }

  /** One digit typed while the view is open. True when it completed 1 3 3 7 (the drop was then attempted). */
  digit(d: string): boolean {
    if (!this.openFlag || !this.matcher.push(d)) return false;
    this.grant();
    return true;
  }

  /** The developer gear drop: all of the bundle into the Lockbox, or nothing (items/devGrant.ts). */
  private grant(): void {
    const g = this.game, bundle = devGrantBundle();
    const plan = grantAllOrNothing(this.store.slots, g.inv, bundle);
    this.lastGrant = {...plan};
    if (plan.ok) {
      this.store.version++;
      this.view.say(`Gear drop added to the ${LOCKBOX_NAME}: ${grantText(bundle)}`, false);
      g.sfx.pickup();
    } else {
      this.view.say(`Not enough space in the ${LOCKBOX_NAME} for the gear drop (needs ${plan.need} free slots, ${plan.free} free) — nothing was added`, true);
      g.sfx.denied();
    }
    this.view.render();
  }

  /** QA: a compact state report. */
  qa() {
    const t = this.train();
    return {open: this.openFlag, used: this.store.used, slots: LOCKBOX_SLOTS, contents: this.store.summary(), progress: this.matcher.progress,
      note: this.view.note, noteBad: this.view.noteBad, lastGrant: this.lastGrant, anchor: t?.lockboxWorld?.() ?? null, aimed: t?.lockboxAimed ?? null,
      wired: typeof t?.lockboxWorld === 'function'};
  }
}

/** Create the Lockbox controller and register it into the Game (once, after the player train is installed). */
export function installLockbox(game: Game): LockboxSystem {
  return new LockboxSystem(game).install();
}

const qaRef = (spec: string): StoreSideRef => {
  const [bar, n] = spec.split(':');
  return {bar: bar as StoreSideRef['bar'], index: Number(n)} as StoreSideRef;
};

/** QA hooks (spread into window.__LL by qa.ts) for SHORT serial browser spot checks. */
export function lockboxQaApi(game: Game) {
  const sys = () => game.lockbox;
  return {
    /** Open?, slots used, contents ('i:item×count@mag[bag]'), code progress, note, last drop, TRAIN anchor / aim. */
    lockbox: () => sys().qa(),
    /** Open the view as [E] on the box would (false: not playing / no Lockbox built / a bag view open). */
    lockboxOpen: () => sys().open(),
    lockboxClose: () => sys().close('user'),
    /** Type keys into the page as real keydown events (e.g. '1337'); the open view consumes the digits. */
    lockboxType: (keys: string) => {
      const before = {selected: game.inv.selected, melee: game.inv.meleeSelected};
      for (const c of keys) { // (on the body: the window's capture listener sees it before player/input.ts's bubble listener)
        const code = /[0-9]/.test(c) ? `Digit${c}` : `Key${c.toUpperCase()}`;
        document.body.dispatchEvent(new KeyboardEvent('keydown', {code, key: c, bubbles: true, cancelable: true}));
        document.body.dispatchEvent(new KeyboardEvent('keyup', {code, key: c, bubbles: true, cancelable: true}));
      }
      return {...sys().qa(), quickSlotBefore: before, quickSlotAfter: {selected: game.inv.selected, melee: game.inv.meleeSelected}, pressed: [...game.input.pressed]};
    },
    /** Click-transfer in the open view ('pack:0', 'hotbar:2', 'store:3'); returns the moved count. */
    lockboxQuick: (spec: string): number => sys().view.quick(qaRef(spec)),
    /** Drag-move in the open view; returns the move result. */
    lockboxMove: (from: string, to: string, count?: number): string => sys().view.move(qaRef(from), qaRef(to), count),
    /** "Stow worn backpack". */
    lockboxStow: (): boolean => sys().view.stow(),
  };
}
