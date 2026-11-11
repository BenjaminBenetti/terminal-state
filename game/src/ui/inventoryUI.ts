// Inventory screen (iteration 04: drag and drop, user feedback #6).
// - Drag a stack with the mouse (pointer events) onto any quick slot or pocket slot: an empty
//   slot takes it, the same item stacks up to its cap (the rest stays), a different item swaps.
//   Shift-drag takes half the stack (split). The HUD quick-slot bar under the screen accepts drops too.
// - Drop it outside the inventory panel: it is dropped on the floor in front of the player.
// - Click selects a slot (details + Use / Equip / Drop buttons; 1-5 puts it in that quick slot).
//   Double-click or right-click food, drink or medicine to use it; right-click a gun to equip it.
//   Keyboard: Tab-focus a slot, Enter/Space selects it, Delete drops it.
// Icons are renders of the runtime 3D models (ui/itemIcons.ts), with the SVG set as fallback.
//
// Iteration 16 (lane GEAR): a GEAR panel (head / chest / hands / feet / back). Drag gear onto its slot (or double-click /
// right-click / Wear) to wear it, off again onto a pocket / quick slot (or Take off) or out of the panel to drop it.
// Refusals are explained in the detail line (red): wrong slot, a chest rig whose extra pockets still hold items, a
// backpack into the pockets. The pockets heading shows their live count (PACK_SIZE, +4 with a chest rig; extra pockets are
// dashed; task gameplay-feedback-20261111, lane STORAGE: 18 = POCKET_GRID 6 × 3, one row more than the old 12). The WORN BACKPACK's contents are never shown or reachable here: its slot says to put it down (6) to open it;
// dragging it out of the panel sets it down on the ground (gear/system.ts), exactly like 6 + click.
//
// Task office-overhaul-20261030 (lane INTERACT, #6): the GRENADE SLOT (key G) is the 6th cell of the quick-slot row
// (data-bar="throw"): only throwables (flares) go in — drag them in / out, right-click / double-click / Equip a flare to put it
// there. G no longer drops: dropping is dragging an item out of this panel (or Drop / Delete), which works for every slot.
// (#1) the worn backpack's "contents hidden" label is gone; its contents still need the bag on the ground (tap E opens it).
//
// Task gasmask-breach-20261030 (mask lane): the gear panel's 6th slot FACE (the gas mask; Q puts it on). A mask shows its fitted
// filter (%) in its cell and detail line. Spare filters (kind 'supply') are passive: no Use / Equip — a mask on the face fits them.
//
// Task knife-windup-20261030 (lane SLOT): the MELEE SLOT (key ~) is the last cell of the quick-slot row (data-bar="melee"), shown
// first (left of 1) by CSS. Only melee weapons go in (drag refused / red outline otherwise). Right-click / double-click / Equip on a
// melee weapon anywhere puts it into the melee slot (a swap sends the old one back) and draws it; ~ while the inventory is open
// puts the selected melee weapon there (like 1-5 for quick slots). Dragging it out of the panel drops it, as for every slot.
//
// Task studio-cosplay-general-20261108-225231-01 (user: "Ctrl-click in inventory should do the same equip/unequip as double-click."):
// Ctrl (or Cmd) + click on a slot runs its double-click action (activate: use / wear / take off / grenade slot / melee slot) on the
// press — one action per physical click: no drag, its click / macOS context menu ignored, never half of a later double-click. Only
// this panel's slots listen (the Market trade view keeps its own Ctrl+click = buy / sell).

import {itemIconHtml} from './itemIcons';
import {effectText, itemDef, useButtonLabel} from '../items/items';
import {MELEE_REF, PACK_SIZE, THROW_REF, isMeleeItem, type Bar, type Inventory, type SlotRef} from '../items/inventory';
import {GEAR_SLOTS, GEAR_SLOT_NAMES, gearStatText, isAirtank, isBagItem, isFilterMask} from '../items/gear';
import {armorPool, pipsText} from '../player/armor'; // task studio-general-armor-20261107-231448-01
import {WEAPONS, reserveFor, weaponsForCaliber} from '../weapons/weapons';
import {CALIBERS, CALIBER_IDS, ammoItemFor} from '../items/calibers'; // lane AMMO
import {MATERIAL_NOTE} from '../items/craftMaterials'; // lane RACK (office-props-physics-scale-20261030)
import {CURRENCY_NOTE} from '../items/railTies'; // task studio-market-rework-20261108-074144-01 (lane TRADE)
import {CRITICAL, LOW} from '../player/survival';
import {GEAR_ICONS} from './gearIcons';
import {ICONS} from './icons';
import {ensureGearStyles} from './gearStyles';
import {airText, filterPct, itemTip} from './itemTip'; // (task studio-ui-subway-maps-20261108-074144-01: the slot tooltips; filterPct / airText moved there, shared)
import {refreshTooltip, tipAttrs} from './tooltip';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

export interface InventoryActions {
  use(ref: SlotRef): void;
  /** Drop `count` (default: the whole stack) on the floor in front of the player. */
  drop(ref: SlotRef, count?: number): void;
  equip(ref: SlotRef): void;
  close(): void;
  changed(): void;
  /** Health / food / water for the status line (optional). Iteration 16 (lane INJURY): `limbs` = limb status HTML. */
  vitals?(): {hp: number; maxHp: number; food: number; water: number; limbs?: string};
}

/** Iteration 16 (lane GEAR): hooks the gear system installs (gear/system.ts). */
export interface GearUiHooks {
  /** Set the worn backpack down on the ground in front of the player; null = done, else the refusal text. */
  dropBag(): string | null;
  /** Gear changed through this screen (no "now wearing" toast for it). */
  changed(): void;
}

/** Where a drag ends: a slot, `'out'` (outside the panel = drop to the floor) or null (cancel). */
export type DropTarget = SlotRef | 'out' | null;

const DOUBLE_CLICK_MS = 380;
/** Task studio-cosplay-general-20261108-225231-01: a Ctrl (or Cmd) + LEFT click — the inventory's one-click double-click action. */
export const isQuickClick = (e: {button?: number; ctrlKey?: boolean; metaKey?: boolean}): boolean => (e.button ?? 0) === 0 && !!(e.ctrlKey || e.metaKey);
/** Pointer travel (px) before a press becomes a drag, so clicks and double-clicks still work. */
export const DRAG_THRESHOLD = 5;

interface DragState {
  from: SlotRef;
  count: number;
  pointerId: number;
  x0: number;
  y0: number;
  active: boolean;
  ghost: HTMLElement | null;
}

const same = (a: SlotRef | null | undefined, b: SlotRef | null | undefined) => !!a && !!b && a.bar === b.bar && a.index === b.index;
// Task office-overhaul-20261030 (INTERACT): by data-bar (the grenade slot lives in the quick-slot row)
const slotSel = (r: SlotRef) => `#inventory .slot[data-bar="${r.bar}"][data-index="${r.index}"]`;
const GEAR_GHOST: Record<string, string> = {helmet: GEAR_ICONS.helmet, chest: GEAR_ICONS.vest, gloves: GEAR_ICONS.gloves, boots: GEAR_ICONS.boots, backpack: GEAR_ICONS.backpack, mask: GEAR_ICONS.gasmask};
/** Mask lane: what goes in each gear slot (empty-slot hint). */
const SLOT_WHAT: Record<string, string> = {helmet: 'a helmet', chest: 'an armor vest or a chest rig', gloves: 'gloves', boots: 'boots', backpack: 'a backpack', mask: 'a gas mask'};

export class InventoryUI {
  selected: SlotRef | null = null;
  /** Last drop (QA / browser check). */
  lastDrop: {from: SlotRef; to: DropTarget; count: number; result: string} | null = null;
  /** Iteration 16 (lane GEAR): installed by gear/system.ts. */
  gear: GearUiHooks | null = null;
  private lastClick: {bar: string; index: number; at: number} | null = null;
  private drag: DragState | null = null;
  private suppressClick = false;
  /** The current physical press was a Ctrl / Cmd + click, already acted on: its click / context menu are ignored. */
  private quickPress = false;
  private note = '';
  /** Iteration 16: the note is a refusal (shown in red). */
  private noteBad = false;
  private hoverEl: HTMLElement | null = null;

  constructor(private readonly inv: () => Inventory, private readonly actions: InventoryActions) {
    this.mountGearPanel(); // Iteration 16 (lane GEAR)
    const refOf = (e: Event): SlotRef | null => {
      const el = (e.target as HTMLElement | null)?.closest?.('.slot') as HTMLElement | null;
      return el && el.dataset.bar ? {bar: el.dataset.bar as Bar, index: Number(el.dataset.index)} : null;
    };
    const onClick = (e: MouseEvent) => {
      if (this.suppressClick) return;
      const ref = refOf(e);
      if (!ref) return;
      // Task studio-cosplay-general-20261108-225231-01: a Ctrl / Cmd + click acted on its press (onDown): its click is ignored.
      if (this.quickPress || isQuickClick(e)) { this.quickPress = false; e.preventDefault(); return; }
      // Manual double-click (render() replaces the slot elements, so native dblclick is unreliable).
      const now = performance.now();
      const last = this.lastClick;
      this.lastClick = {bar: ref.bar, index: ref.index, at: now};
      if (last && last.bar === ref.bar && last.index === ref.index && now - last.at < DOUBLE_CLICK_MS && this.activate(ref)) return;
      this.click(ref);
    };
    const onContext = (e: MouseEvent) => {
      const ref = refOf(e);
      if (!ref) return;
      e.preventDefault();
      // (a Ctrl + click is the context menu on macOS: the press already acted — no right-click action on top)
      if (this.quickPress) { this.quickPress = false; return; }
      if (this.drag?.active) return;
      const st = this.inv().get(ref);
      if (!st) return;
      const def = itemDef(st.itemId);
      this.selected = null;
      if (def.kind === 'consumable') this.actions.use(ref);
      else if (def.kind === 'weapon') this.actions.equip(ref);
      else if (def.kind === 'gear') { this.toggleWear(ref); return; } // Iteration 16
      else if (def.kind === 'throwable' && ref.bar !== 'throw') { this.dropAt(ref, THROW_REF); return; } // INTERACT (#6): into the grenade slot
      this.render();
    };
    const onDown = (e: PointerEvent) => {
      this.quickPress = false; // a new physical press
      if (e.button !== 0) return;
      if (this.drag) this.cancelDrag(); // stale (button released outside the window)
      const ref = refOf(e);
      const st = ref ? this.inv().get(ref) : null;
      if (!ref || !st) return;
      e.preventDefault(); // no text selection / native image drag; click still fires
      // Task studio-cosplay-general-20261108-225231-01 (user: "Ctrl-click in inventory should do the same equip/unequip as
      // double-click."): Ctrl / Cmd + press = the slot's double-click action at once (quick): never a drag, one action per press.
      if (isQuickClick(e)) {
        e.stopPropagation();
        if (!this.isOpen()) return;
        this.quickPress = true;
        this.quick(ref);
        return;
      }
      const count = e.shiftKey && st.count > 1 ? Math.floor(st.count / 2) : st.count;
      this.drag = {from: ref, count, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, ghost: null};
    };
    const onKey = (e: KeyboardEvent) => {
      const ref = refOf(e);
      if (!ref) return;
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.click(ref); }
      else if ((e.code === 'Delete' || e.code === 'Backspace') && this.inv().get(ref)) { e.preventDefault(); this.dropAt(ref, 'out'); }
    };
    for (const id of ['#inv-hotbar', '#inv-pack', '#inv-gear']) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('click', onClick);
      el.addEventListener('contextmenu', onContext);
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('keydown', onKey);
      el.addEventListener('dragstart', e => e.preventDefault());
    }
    window.addEventListener('pointermove', e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if ((e.buttons & 1) === 0) { this.cancelDrag(); return; } // released where we could not see it
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_THRESHOLD) return;
        if (!this.isOpen() || !this.inv().get(d.from)) { this.cancelDrag(); return; }
        this.beginDrag(d);
      }
      this.moveGhost(e.clientX, e.clientY);
      const h = this.hitTest(e.clientX, e.clientY);
      this.hover(h.target, h.el);
    });
    window.addEventListener('pointerup', e => {
      const d = this.drag;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.active) { this.drag = null; return; } // a plain click: the click handler selects / uses
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 0);
      const to = this.targetAt(e.clientX, e.clientY);
      this.cancelDrag();
      if (this.isOpen()) this.dropAt(d.from, to, d.count);
    });
    window.addEventListener('pointercancel', e => { if (this.drag && e.pointerId === this.drag.pointerId) this.cancelDrag(); });
    window.addEventListener('blur', () => this.cancelDrag());
    $('#btn-inv-use').addEventListener('click', () => { if (this.selected) this.actions.use(this.selected); this.render(); });
    $('#btn-inv-drop').addEventListener('click', () => { if (this.selected) this.dropAt(this.selected, 'out'); });
    $('#btn-inv-equip').addEventListener('click', () => {
      if (!this.selected) return;
      if (this.isGear(this.selected)) { this.toggleWear(this.selected); return; } // Iteration 16: Wear / Take off
      if (this.isThrowable(this.selected) && this.selected.bar !== 'throw') { this.dropAt(this.selected, THROW_REF); return; } // INTERACT (#6)
      this.actions.equip(this.selected);
      this.render();
    });
    $('#btn-inv-close').addEventListener('click', () => this.actions.close());
  }

  /** Iteration 16 (lane GEAR): the gear panel (built here: no markup change in index.html), above the quick slots. */
  private mountGearPanel(): void {
    if (typeof document === 'undefined' || document.querySelector('#inv-gear')) return;
    const hot = document.querySelector('#inv-hotbar');
    const heading = hot?.previousElementSibling;
    if (!hot?.parentElement) return;
    ensureGearStyles();
    const wrap = document.createElement('div');
    wrap.id = 'inv-gear-wrap';
    wrap.innerHTML = '<h3>Gear <span class="gear-sum"></span></h3><div class="slots" id="inv-gear"></div><div id="inv-gear-note"></div>';
    hot.parentElement.insertBefore(wrap, heading && heading.tagName === 'H3' ? heading : hot);
  }

  /**
   * The double-click action of a slot — the ONE path for double-click and Ctrl / Cmd + click: use a consumable, wear / take off
   * gear, a throwable into the grenade slot, a melee weapon into the melee slot. False: the slot has none (a gun, ammo, a part …).
   */
  private activate(ref: SlotRef): boolean {
    if (this.isConsumable(ref)) {
      this.lastClick = null;
      this.selected = null;
      this.actions.use(ref);
      this.render();
      return true;
    }
    if (this.isGear(ref)) { this.lastClick = null; this.toggleWear(ref); return true; } // Iteration 16: wear / take off
    if (this.isThrowable(ref) && ref.bar !== 'throw') { this.lastClick = null; this.dropAt(ref, THROW_REF); return true; } // INTERACT (#6)
    if (this.isMelee(ref) && ref.bar !== 'melee') { this.lastClick = null; this.selected = null; this.actions.equip(ref); this.render(); return true; } // SLOT
    return false;
  }

  /**
   * Task studio-cosplay-general-20261108-225231-01: Ctrl / Cmd + click — the slot's double-click action (activate) at once; a slot
   * without one is a plain click (select). Never half of a double-click (a following click starts a new one).
   */
  quick(ref: SlotRef): void {
    this.lastClick = null;
    if (!this.activate(ref)) this.click(ref);
  }

  private isConsumable(ref: SlotRef): boolean {
    const st = this.inv().get(ref);
    return !!st && itemDef(st.itemId).kind === 'consumable';
  }

  private isGear(ref: SlotRef): boolean {
    const st = this.inv().get(ref);
    return !!st && itemDef(st.itemId).kind === 'gear';
  }

  /** Task office-overhaul-20261030 (INTERACT): a throwable (flare) — it belongs in the grenade slot. */
  private isThrowable(ref: SlotRef): boolean {
    const st = this.inv().get(ref);
    return !!st && itemDef(st.itemId).kind === 'throwable';
  }

  /** Task knife-windup-20261030 (SLOT): a melee weapon (knife) — it belongs in the melee slot. */
  private isMelee(ref: SlotRef): boolean {
    return isMeleeItem(this.inv().get(ref)?.itemId);
  }

  /** Iteration 16: wear a gear item from a slot, or take worn gear off (refusals explained). */
  toggleWear(ref: SlotRef): string {
    const inv = this.inv();
    const st = inv.get(ref);
    if (!st) return 'empty';
    let result: string;
    this.note = '';
    this.noteBad = false;
    if (ref.bar === 'gear') {
      const slot = GEAR_SLOTS[ref.index];
      result = inv.takeOff(slot);
      if (result === 'refused') this.refused(inv);
      else if (result !== 'none') { this.selected = inv.find(st.uid); this.note = `Took off the ${itemDef(st.itemId).short.toLowerCase()}.`; }
    } else {
      result = inv.wearFrom(ref);
      if (result === 'refused') this.refused(inv);
      else if (result !== 'none') { this.selected = inv.find(st.uid); this.note = `Wearing the ${itemDef(st.itemId).short.toLowerCase()}.`; }
    }
    if (result !== 'refused' && result !== 'none') { this.gear?.changed(); this.actions.changed(); }
    this.lastDrop = {from: ref, to: null, count: 1, result: `wear:${result}`};
    this.render();
    return result;
  }

  private refused(inv: Inventory): void {
    this.note = inv.refusal?.text ?? 'That does not fit there.';
    this.noteBad = true;
  }

  private isOpen(): boolean {
    const el = document.querySelector('#inventory');
    return !!el && !el.classList.contains('hidden');
  }

  get dragging(): boolean {
    return !!this.drag?.active;
  }

  /** Click: select (or unselect) a slot for the detail line and the Use / Equip / Drop buttons. */
  click(ref: SlotRef): void {
    this.selected = same(this.selected, ref) || !this.inv().get(ref) ? null : ref;
    this.note = '';
    this.noteBad = false;
    this.render();
  }

  /** 1-5 while the inventory is open: put the selected stack into that quick slot. */
  assign(slot: number): void {
    if (!this.selected) return;
    const to: SlotRef = {bar: 'hotbar', index: slot};
    this.dropAt(this.selected, to);
  }

  /** Task knife-windup-20261030 (SLOT): ~ while the inventory is open — the selected stack into the melee slot (refused unless melee). */
  assignMelee(): string {
    if (!this.selected) return 'none';
    return this.dropAt(this.selected, MELEE_REF);
  }

  /**
   * The drop step of every drag (also used by the Drop button, Delete, 1-5 and the QA hook):
   * slot -> Inventory.moveCount (move / split / merge / swap), 'out' -> drop to the floor,
   * null -> nothing. Afterwards the held item is re-synced and the screen redrawn.
   * Iteration 16: gear validation (refusal shown in red); the worn backpack dropped 'out' is set down as a ground bag.
   */
  dropAt(from: SlotRef, to: DropTarget, count?: number): string {
    const inv = this.inv();
    const st = inv.get(from);
    let result = 'none';
    this.note = '';
    this.noteBad = false;
    if (!st) result = 'empty';
    else if (to === 'out') {
      const n = Math.min(st.count, count ?? st.count);
      if (isBagItem(st.itemId)) {
        // Iteration 16: a backpack leaves only as a grounded bag (same rules as 6 + click)
        const refusal = this.gear ? this.gear.dropBag() : 'Put a backpack down with 6, then click.';
        if (refusal) { this.note = refusal; this.noteBad = true; result = 'refused'; }
        else { result = 'placed'; this.gear?.changed(); }
      } else {
        inv.refusal = null;
        this.actions.drop(from, n);
        if (inv.get(from) === st && st.count >= n && inv.refusal) { this.refused(inv); result = 'refused'; }
        else { result = 'dropped'; if (from.bar === 'gear') this.gear?.changed(); }
      }
      if (same(this.selected, from) && !inv.get(from)) this.selected = null;
    } else if (to) {
      result = inv.moveCount(from, to, count);
      if (result === 'refused') this.refused(inv);
      else if (result !== 'none') {
        this.selected = inv.get(to) ? to : null;
        if (from.bar === 'gear' || to.bar === 'gear') this.gear?.changed();
        this.actions.changed();
      }
    }
    this.lastDrop = {from, to, count: count ?? st?.count ?? 0, result};
    this.render();
    return result;
  }

  /** Slot under a viewport point: inventory slots, then the panel itself, then the HUD quick slots. */
  targetAt(x: number, y: number): DropTarget {
    return this.hitTest(x, y).target;
  }

  private hitTest(x: number, y: number): {target: DropTarget; el: HTMLElement | null} {
    const inside = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const hit = (el: HTMLElement) => ({target: {bar: el.dataset.bar as Bar, index: Number(el.dataset.index)}, el});
    for (const el of document.querySelectorAll<HTMLElement>('#inv-hotbar .slot, #inv-pack .slot, #inv-gear .slot')) if (inside(el)) return hit(el);
    const panel = document.querySelector('#inventory .inv-panel');
    if (panel && inside(panel)) return {target: null, el: null};
    for (const el of document.querySelectorAll<HTMLElement>('#hotbar .slot[data-bar]')) if (inside(el)) return hit(el);
    return {target: 'out', el: null};
  }

  /**
   * QA / browser check: viewport centre of a slot spec — 'hotbar:N' / 'pack:N' / 'gear:N' / 'throw:0' (inventory panel),
   * 'hud:N' (HUD quick slot), 'hudq' (the HUD gas-mask cell, mask lane), 'panel' (inside the panel, not a slot), 'out' (outside the panel).
   */
  pointFor(spec: string): {x: number; y: number} | null {
    const centre = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? {x: r.left + r.width / 2, y: r.top + r.height / 2} : null;
    };
    const [kind, n] = spec.split(':');
    if (kind === 'hotbar' || kind === 'pack' || kind === 'gear' || kind === 'throw' || kind === 'melee') return centre(document.querySelector(slotSel({bar: kind, index: Number(n)})));
    // 'hud:N' = HUD quick slot N (by data-bar: the G / ~ cells also have data-index 0); 'hud:melee' / 'hud:throw' = those HUD cells
    if (kind === 'hud') return centre(document.querySelector(n === 'melee' || n === 'throw' ? `#hotbar .slot[data-bar="${n}"]` : `#hotbar .slot[data-bar="hotbar"][data-index="${Number(n)}"]`));
    if (kind === 'hudq') return centre(document.querySelector('#hotbar .slot.maskslot')); // mask lane: the HUD gas-mask cell
    if (kind === 'panel') return centre(document.querySelector('#inv-detail'));
    const p = document.querySelector('#inventory .inv-panel')?.getBoundingClientRect();
    if (!p) return null;
    return p.left > 12 ? {x: p.left / 2, y: p.top + Math.min(40, p.height / 2)} : {x: p.left + p.width / 2, y: Math.max(2, p.top / 2)};
  }

  /** QA: a full drag (press, travel, release) with synthetic pointer events through the real listeners. */
  simulateDrag(fromSpec: string, toSpec: string, shift = false): {from: SlotRef; to: DropTarget; count: number; result: string} | null {
    const a = this.pointFor(fromSpec), b = this.pointFor(toSpec);
    const [bar, i] = fromSpec.split(':');
    const src = document.querySelector(slotSel({bar: bar as Bar, index: Number(i)}));
    if (!a || !b || !src || !this.isOpen()) return null;
    const ev = (type: string, x: number, y: number, buttons: number) => new PointerEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 91, pointerType: 'mouse', isPrimary: true, shiftKey: shift});
    const at = (x: number, y: number) => document.elementFromPoint(x, y) ?? window;
    const before = this.lastDrop;
    src.dispatchEvent(ev('pointerdown', a.x, a.y, 1));
    at(a.x + 6, a.y + 6).dispatchEvent(ev('pointermove', a.x + 6, a.y + 6, 1));
    at(b.x, b.y).dispatchEvent(ev('pointermove', b.x, b.y, 1));
    at(b.x, b.y).dispatchEvent(ev('pointerup', b.x, b.y, 0));
    return this.lastDrop !== before ? this.lastDrop : null;
  }

  /** Abort a drag in progress (inventory closed, pointer lost, window blur). */
  cancelDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    d.ghost?.remove();
    this.hover(null, null);
    document.querySelector('#inventory')?.classList.remove('dragging', 'drop-out');
    document.querySelector('.slot.drag-src')?.classList.remove('drag-src');
  }

  private beginDrag(d: DragState): void {
    d.active = true;
    const st = this.inv().get(d.from)!;
    const def = itemDef(st.itemId);
    const g = document.createElement('div');
    g.id = 'drag-ghost';
    const n = def.kind === 'weapon' ? (WEAPONS[def.weaponId!].melee ? '' : `${st.mag}/${WEAPONS[def.weaponId!].magazine}`) : d.count > 1 || d.count < st.count ? `×${d.count}` : '';
    g.innerHTML = `${itemIconHtml(st.itemId)}${n ? `<span class="count">${n}</span>` : ''}<span class="hint"></span>`;
    ($('#app') ?? document.body).appendChild(g);
    d.ghost = g;
    document.querySelector(slotSel(d.from))?.classList.add('drag-src');
    document.querySelector('#inventory')?.classList.add('dragging');
  }

  private moveGhost(x: number, y: number): void {
    const g = this.drag?.ghost;
    if (g) g.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  /** Drop-target feedback: slot outline (red when a split / that item cannot go there), "Drop on floor" outside. */
  private hover(t: DropTarget, el: HTMLElement | null): void {
    this.hoverEl?.classList.remove('drop-target', 'drop-bad');
    this.hoverEl = null;
    const d = this.drag;
    document.querySelector('#inventory')?.classList.toggle('drop-out', !!d && t === 'out');
    const hint = d?.ghost?.querySelector('.hint');
    const dragged = d ? this.inv().get(d.from) : null;
    if (hint) hint.textContent = t === 'out' ? (dragged && isBagItem(dragged.itemId) ? 'Set the backpack down' : 'Drop on floor') : '';
    if (!d || !t || t === 'out' || !el) return;
    const inv = this.inv(), a = inv.get(d.from), b = inv.get(t);
    let bad = !!a && !!b && !same(t, d.from) && d.count < a.count && (b.itemId !== a.itemId || b.count >= itemDef(a.itemId).stackMax);
    // Iteration 16: gear slots take only their gear; a backpack never goes into the quick slots / pockets
    if (a && t.bar === 'gear' && itemDef(a.itemId).gear?.slot !== GEAR_SLOTS[t.index]) bad = true;
    if (a && t.bar !== 'gear' && isBagItem(a.itemId)) bad = true;
    if (a && t.bar === 'throw' && itemDef(a.itemId).kind !== 'throwable') bad = true; // INTERACT (#6): throwables only
    if (a && b && d.from.bar === 'throw' && itemDef(b.itemId).kind !== 'throwable') bad = true;
    if (a && t.bar === 'melee' && !isMeleeItem(a.itemId)) bad = true; // SLOT: melee weapons only
    if (a && b && d.from.bar === 'melee' && !isMeleeItem(b.itemId)) bad = true;
    if (a && b && d.from.bar === 'gear' && itemDef(b.itemId).gear?.slot !== GEAR_SLOTS[d.from.index]) bad = true;
    el.classList.add(bad ? 'drop-bad' : 'drop-target');
    this.hoverEl = el;
  }

  render(): void {
    const inv = this.inv();
    const focused = (document.activeElement as HTMLElement | null)?.closest?.('#inventory .slot') as HTMLElement | null;
    const refocus = focused ? {bar: focused.dataset.bar, index: focused.dataset.index} : null;
    const cell = (ref: SlotRef) => {
      const st = inv.get(ref);
      const def = st ? itemDef(st.itemId) : null;
      const sel = same(this.selected, ref);
      const held = same(ref, inv.selectedRef()); // SLOT: the melee slot while its weapon is drawn
      const usable = def?.kind === 'consumable';
      const count = def ? (def.kind === 'weapon' ? (WEAPONS[def.weaponId!].melee ? '' : `<span class="count">${st!.mag}/${WEAPONS[def.weaponId!].magazine}</span>`)
        : isFilterMask(def.id) ? `<span class="count">${filterPct(st!.filter)}%</span>` // mask lane: the fitted filter
        : st!.count > 1 ? `<span class="count">×${st!.count}</span>` : '') : '';
      // (task studio-ui-subway-maps-20261108-074144-01) the game's own tooltip (ui/tooltip.ts): no native title, which outlived the closed panel under a still cursor
      const use = usable ? `Double-click / Ctrl+click or right-click to ${useButtonLabel(def!).toLowerCase()} · ` : def?.kind === 'gear' ? `Double-click / Ctrl+click or right-click to ${ref.bar === 'gear' ? 'take it off' : 'wear it'} · ` : '';
      let title = st ? tipAttrs(itemTip(st, `${use}Drag to move · Shift-drag to split · drag out of the panel to drop`, {inv})) : '';
      // Iteration 16: gear slots (slot name + empty silhouette); the worn backpack's contents stay hidden
      let lead = ref.bar === 'hotbar' ? `<span class="key">${ref.index + 1}</span>` : '';
      let cls = '';
      // Task office-overhaul-20261030 (INTERACT, #6): the grenade slot
      if (ref.bar === 'throw') {
        lead = `<span class="key">G</span>${def ? '' : `<span class="ghost">${ICONS.flare}</span>`}`;
        title = st ? tipAttrs(itemTip(st, 'Grenade slot: hold G to ready it, release to throw · drag to move · drag out of the panel to drop', {inv}))
          : tipAttrs({head: 'Grenade slot (G)', hint: 'Drag a flare here (or right-click one) — hold G to ready it, release to throw'});
      }
      // Task knife-windup-20261030 (SLOT): the melee slot
      if (ref.bar === 'melee') {
        lead = `<span class="key">~</span>${def ? '' : `<span class="ghost">${ICONS.knife}</span>`}`;
        title = st ? tipAttrs(itemTip(st, 'Melee slot: ~ draws it (it takes no quick slot) · drag to move · drag out of the panel to drop', {inv}))
          : tipAttrs({head: 'Melee slot (~)', hint: 'Drag a knife here (or right-click one) — ~ draws it; it takes no quick slot'});
      }
      if (ref.bar === 'gear') {
        const slot = GEAR_SLOTS[ref.index];
        lead = `<span class="gslot">${GEAR_SLOT_NAMES[slot]}</span>${def ? '' : `<span class="ghost">${GEAR_GHOST[slot] ?? ''}</span>`}`;
        if (def && isBagItem(def.id)) { cls = ' worn-bag'; title = tipAttrs(itemTip(st!, 'Worn. Its contents are only reachable on the ground: press 6, click to set it down, then tap E to open it (hold E picks it back up), or drag it out of this panel.', {inv})); }
        else if (!def) title = tipAttrs({head: GEAR_SLOT_NAMES[slot], hint: `Drag ${SLOT_WHAT[slot] ?? slot} here to wear it${slot === 'mask' ? ' (Q puts it on your face)' : ''}`});
      } else if (ref.bar === 'pack' && ref.index >= PACK_SIZE) cls = ' gear-extra';
      return `<div class="slot${sel ? ' selected' : ''}${held ? ' held' : ''}${usable ? ' usable' : ''}${def ? ' filled' : ''}${cls}" data-bar="${ref.bar}" data-index="${ref.index}" role="button" tabindex="0"${title}>${lead}${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? def.short : ''}</span>${count}</div>`;
    };
    // + grenade slot (INTERACT) + melee slot (SLOT: last in the markup, shown first by CSS)
    $('#inv-hotbar').innerHTML = inv.hotbar.map((_, i) => cell({bar: 'hotbar', index: i})).join('') + inv.throwSlot.map((_, i) => cell({bar: 'throw', index: i})).join('')
      + inv.meleeSlot.map((_, i) => cell({bar: 'melee', index: i})).join('');
    const qh = document.querySelector('#inv-hotbar')?.previousElementSibling; // SLOT: the row's heading names its three kinds of slot
    if (qh && qh.tagName === 'H3') qh.textContent = 'Melee slot (~) · quick slots (1–5) · grenade slot (G)';
    $('#inv-pack').innerHTML = inv.pack.map((_, i) => cell({bar: 'pack', index: i})).join('');
    this.renderGear(inv, cell);
    refreshTooltip(); // (task studio-ui-subway-maps-20261108-074144-01) the hovered slot was just replaced: keep the tooltip on the new one (its new text)
    if (refocus) (document.querySelector(`#inventory .slot[data-bar="${refocus.bar}"][data-index="${refocus.index}"]`) as HTMLElement | null)?.focus();
    if (this.selected && !inv.get(this.selected)) this.selected = null;
    const st = this.selected ? inv.get(this.selected) : null;
    const def = st ? itemDef(st.itemId) : null;
    const worn = this.selected?.bar === 'gear';
    $('#inv-detail .name').textContent = def ? `${def.name}${def.kind === 'weapon' ? (WEAPONS[def.weaponId!].melee ? ' — melee, no ammo' : ` — ${st!.mag} loaded`) : def.kind === 'gear' ? (worn ? ' — worn' : '') : ` ×${st!.count}`}` : 'Nothing selected';
    // lane AMMO (knife-melee-20261030): ammo by caliber; an ammo item names the weapons it loads, a gun the caliber it takes
    $('#inv-detail .desc').textContent = def ? def.description : `Ammo — ${CALIBER_IDS.map(c => `${CALIBERS[c].label}: ${inv.count(ammoItemFor(c))}`).join(' · ')}`;
    const fx = document.querySelector('#inv-detail .fx');
    const wdef = def?.kind === 'weapon' && def.weaponId ? WEAPONS[def.weaponId] : undefined;
    if (fx) {
      fx.textContent = this.note || (def?.kind === 'ammo' && def.caliber ? `${CALIBERS[def.caliber].designation} · loads: ${weaponsForCaliber(def.caliber).map(w => itemDef(w.itemId).short).join(', ') || 'no weapon yet'}`
        : wdef?.caliber ? `Takes ${CALIBERS[wdef.caliber].label} (${CALIBERS[wdef.caliber].designation}) · ${reserveFor(wdef, inv)} in reserve`
        : wdef?.melee ? `Melee · hold click to wind up, release to slash · reach ${wdef.range} m · never needs ammo · ${this.selected?.bar === 'melee' ? 'in the melee slot: ~ draws it' : 'right-click / double-click / Ctrl+click / Equip puts it in the melee slot (~)'}` // lane KNIFE / SLOT
        : def?.kind === 'consumable' ? `${effectText(def)} · ${def.useTime ?? 1} s to ${useButtonLabel(def).toLowerCase()} · double-click / Ctrl+click or right-click to ${useButtonLabel(def).toLowerCase()}`
        : def?.kind === 'gear' ? `${isFilterMask(def.id) ? `Filter ${filterPct(st!.filter)} % fitted · ${inv.count('gas_filter')} spare · ` : ''}${isAirtank(def.id) ? `${airText(st!.air)} · ` : ''}${gearStatText(def.gear!, st)} · ${worn ? (isBagItem(def.id) ? 'press 6 then click to set it down (contents only on the ground)' : 'double-click / Ctrl+click / right-click / Take off to remove') : `double-click / Ctrl+click / right-click / Wear to put it on (${GEAR_SLOT_NAMES[def.gear!.slot].toLowerCase()} slot)`}`
        : def?.kind === 'throwable' ? (this.selected?.bar === 'throw' ? 'In the grenade slot: hold G to ready it, release to throw' : 'Right-click / double-click / Ctrl+click / Equip puts it in the grenade slot (G)') // INTERACT (#6)
        : def?.kind === 'supply' ? `A worn gas mask fits one by itself when its filter runs out · ${inv.count(def.id)} carried where the mask can reach them (not in a worn backpack)` // mask lane
        : def?.kind === 'material' ? `${MATERIAL_NOTE} · ${inv.count(def.id)} in pockets / quick slots` // lane RACK (office-props-physics-scale-20261030)
        : def?.kind === 'part' ? `Reactor restart part — nothing to use by hand: take it to its control and press E there · ${inv.count(def.id)} in pockets / quick slots` // task reactor-build-20261101 (lane RESTART)
        : def?.kind === 'currency' ? `${CURRENCY_NOTE} · ${inv.count(def.id)} ready to spend` : ''); // task studio-market-rework-20261108-074144-01 (lane TRADE)
      fx.classList.toggle('refused', !!this.note && this.noteBad);
    }
    const useBtn = $('#btn-inv-use') as HTMLButtonElement;
    useBtn.textContent = useButtonLabel(def);
    useBtn.disabled = !def || def.kind !== 'consumable';
    const eq = $('#btn-inv-equip') as HTMLButtonElement;
    eq.textContent = def?.kind === 'gear' ? (worn ? 'Take off' : 'Wear') : 'Equip'; // Iteration 16
    eq.disabled = !def || def.kind === 'ammo' || def.kind === 'supply' || def.kind === 'material' || def.kind === 'part' || def.kind === 'currency' || (worn && !!def && isBagItem(def.id)) || (def.kind === 'throwable' && this.selected?.bar === 'throw'); // INTERACT; mask lane: filters are passive
    ($('#btn-inv-drop') as HTMLButtonElement).disabled = !def;
    const v = this.actions.vitals?.();
    const vit = document.querySelector('#inv-vitals');
    if (vit && v) {
      const tone = (x: number) => (x <= CRITICAL ? 'crit' : x <= LOW ? 'low' : '');
      vit.innerHTML = `<span>Health <b>${Math.ceil(v.hp)}</b>/${v.maxHp}</span><span class="${tone(v.food)}">Food <b>${Math.round(v.food)}%</b></span><span class="${tone(v.water)}">Water <b>${Math.round(v.water)}%</b></span>${v.limbs ?? ''}`;
    }
  }

  /** Iteration 16 (lane GEAR): gear slots, the pockets heading (live count) and the worn-backpack line. */
  private renderGear(inv: Inventory, cell: (ref: SlotRef) => string): void {
    const box = document.querySelector('#inv-gear');
    if (box) box.innerHTML = GEAR_SLOTS.map((_, i) => cell({bar: 'gear', index: i})).join('');
    const ex = inv.extraPockets;
    const ph = document.querySelector('#inv-pack')?.previousElementSibling;
    if (ph && ph.tagName === 'H3') ph.textContent = `Pockets · ${inv.pack.length}${ex ? ` (${PACK_SIZE} + ${ex} from the chest rig)` : ''}`;
    const mods: string[] = [];
    // (task studio-general-armor-20261107-231448-01) the worn armour as ONE pool first ("armor 5 pips (12.5 %)"), then each item's other stats
    const pool = armorPool(inv.gear);
    if (pool > 0) mods.push(`armor ${pipsText(pool)} pips (${+(pool * 100).toFixed(2)} %) — cuts every enemy hit; same chance to shrug off its injury`);
    for (const st of inv.gearSlots) if (st) { const t = gearStatText({...itemDef(st.itemId).gear!, armor: undefined}); if (t) mods.push(t); }
    const sum = document.querySelector('#inv-gear-wrap .gear-sum');
    if (sum) sum.textContent = mods.length ? mods.join(' · ') : 'nothing worn — gear is rare: armor vest, chest rig, backpack, hard hat, boots, gloves, gas mask';
    const note = document.querySelector('#inv-gear-note');
    if (note) {
      const bag = inv.wornBag(), back = inv.worn('backpack');
      note.innerHTML = bag ? `<b>${itemDef(bag.itemId).short}</b> — put it down (<b>6</b>, then click) and tap <b>E</b> to open it; hold <b>E</b> picks it back up. Its contents are not reachable while you wear it.`
        : back && isAirtank(back.itemId) ? `<b>${itemDef(back.itemId).name}</b> — ${airText(back.air)}. With the gas mask on (<b>Q</b>) it is breathed before the mask's filter. No storage; it cannot be refilled.` : ''; // task filter-tension-airtank
    }
  }
}
