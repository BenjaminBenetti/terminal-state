// Inventory screen (iteration 04: drag and drop, user feedback #6).
// - Drag a stack with the mouse (pointer events) onto any quick slot or backpack slot: an empty
//   slot takes it, the same item stacks up to its cap (the rest stays), a different item swaps.
//   Shift-drag takes half the stack (split). The HUD quick-slot bar under the screen accepts drops too.
// - Drop it outside the inventory panel: it is dropped on the floor in front of the player.
// - Click selects a slot (details + Use / Equip / Drop buttons; 1-5 puts it in that quick slot).
//   Double-click or right-click food, drink or medicine to use it; right-click a gun to equip it.
//   Keyboard: Tab-focus a slot, Enter/Space selects it, Delete drops it.
// Icons are renders of the runtime 3D models (ui/itemIcons.ts), with the SVG set as fallback.

import {itemIconHtml} from './itemIcons';
import {effectText, itemDef, useButtonLabel} from '../items/items';
import type {Bar, Inventory, SlotRef} from '../items/inventory';
import {WEAPONS} from '../weapons/weapons';
import {CRITICAL, LOW} from '../player/survival';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

export interface InventoryActions {
  use(ref: SlotRef): void;
  /** Drop `count` (default: the whole stack) on the floor in front of the player. */
  drop(ref: SlotRef, count?: number): void;
  equip(ref: SlotRef): void;
  close(): void;
  changed(): void;
  /** Health / food / water for the status line (optional). */
  vitals?(): {hp: number; maxHp: number; food: number; water: number};
}

/** Where a drag ends: a slot, `'out'` (outside the panel = drop to the floor) or null (cancel). */
export type DropTarget = SlotRef | 'out' | null;

const DOUBLE_CLICK_MS = 380;
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
const slotSel = (r: SlotRef) => `#inv-${r.bar === 'hotbar' ? 'hotbar' : 'pack'} .slot[data-index="${r.index}"]`;

export class InventoryUI {
  selected: SlotRef | null = null;
  /** Last drop (QA / browser check). */
  lastDrop: {from: SlotRef; to: DropTarget; count: number; result: string} | null = null;
  private lastClick: {bar: string; index: number; at: number} | null = null;
  private drag: DragState | null = null;
  private suppressClick = false;
  private note = '';
  private hoverEl: HTMLElement | null = null;

  constructor(private readonly inv: () => Inventory, private readonly actions: InventoryActions) {
    const refOf = (e: Event): SlotRef | null => {
      const el = (e.target as HTMLElement | null)?.closest?.('.slot') as HTMLElement | null;
      return el && el.dataset.bar ? {bar: el.dataset.bar as Bar, index: Number(el.dataset.index)} : null;
    };
    const onClick = (e: MouseEvent) => {
      if (this.suppressClick) return;
      const ref = refOf(e);
      if (!ref) return;
      // Manual double-click (render() replaces the slot elements, so native dblclick is unreliable).
      const now = performance.now();
      const last = this.lastClick;
      this.lastClick = {bar: ref.bar, index: ref.index, at: now};
      if (last && last.bar === ref.bar && last.index === ref.index && now - last.at < DOUBLE_CLICK_MS && this.isConsumable(ref)) {
        this.lastClick = null;
        this.selected = null;
        this.actions.use(ref);
        this.render();
        return;
      }
      this.click(ref);
    };
    const onContext = (e: MouseEvent) => {
      const ref = refOf(e);
      if (!ref) return;
      e.preventDefault();
      if (this.drag?.active) return;
      const st = this.inv().get(ref);
      if (!st) return;
      const def = itemDef(st.itemId);
      this.selected = null;
      if (def.kind === 'consumable') this.actions.use(ref);
      else if (def.kind === 'weapon') this.actions.equip(ref);
      this.render();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (this.drag) this.cancelDrag(); // stale (button released outside the window)
      const ref = refOf(e);
      const st = ref ? this.inv().get(ref) : null;
      if (!ref || !st) return;
      e.preventDefault(); // no text selection / native image drag; click still fires
      const count = e.shiftKey && st.count > 1 ? Math.floor(st.count / 2) : st.count;
      this.drag = {from: ref, count, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, ghost: null};
    };
    const onKey = (e: KeyboardEvent) => {
      const ref = refOf(e);
      if (!ref) return;
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.click(ref); }
      else if ((e.code === 'Delete' || e.code === 'Backspace') && this.inv().get(ref)) { e.preventDefault(); this.dropAt(ref, 'out'); }
    };
    for (const id of ['#inv-hotbar', '#inv-pack']) {
      const el = $(id);
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
    $('#btn-inv-equip').addEventListener('click', () => { if (this.selected) this.actions.equip(this.selected); this.render(); });
    $('#btn-inv-close').addEventListener('click', () => this.actions.close());
  }

  private isConsumable(ref: SlotRef): boolean {
    const st = this.inv().get(ref);
    return !!st && itemDef(st.itemId).kind === 'consumable';
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
    this.render();
  }

  /** 1-5 while the inventory is open: put the selected stack into that quick slot. */
  assign(slot: number): void {
    if (!this.selected) return;
    const to: SlotRef = {bar: 'hotbar', index: slot};
    this.dropAt(this.selected, to);
  }

  /**
   * The drop step of every drag (also used by the Drop button, Delete, 1-5 and the QA hook):
   * slot -> Inventory.moveCount (move / split / merge / swap), 'out' -> drop to the floor,
   * null -> nothing. Afterwards the held item is re-synced and the screen redrawn.
   */
  dropAt(from: SlotRef, to: DropTarget, count?: number): string {
    const inv = this.inv();
    const st = inv.get(from);
    let result = 'none';
    this.note = '';
    if (!st) result = 'empty';
    else if (to === 'out') {
      const n = Math.min(st.count, count ?? st.count);
      this.actions.drop(from, n);
      result = 'dropped';
      if (same(this.selected, from) && !inv.get(from)) this.selected = null;
    } else if (to) {
      result = inv.moveCount(from, to, count);
      if (result === 'refused') this.note = 'A split stack can only go to an empty slot or onto the same item.';
      else if (result !== 'none') {
        this.selected = inv.get(to) ? to : null;
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
    for (const el of document.querySelectorAll<HTMLElement>('#inv-hotbar .slot, #inv-pack .slot')) if (inside(el)) return hit(el);
    const panel = document.querySelector('#inventory .inv-panel');
    if (panel && inside(panel)) return {target: null, el: null};
    for (const el of document.querySelectorAll<HTMLElement>('#hotbar .slot[data-bar]')) if (inside(el)) return hit(el);
    return {target: 'out', el: null};
  }

  /**
   * QA / browser check: viewport centre of a slot spec — 'hotbar:N' / 'pack:N' (inventory panel),
   * 'hud:N' (HUD quick slot), 'panel' (inside the panel, not a slot), 'out' (outside the panel).
   */
  pointFor(spec: string): {x: number; y: number} | null {
    const centre = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? {x: r.left + r.width / 2, y: r.top + r.height / 2} : null;
    };
    const [kind, n] = spec.split(':');
    if (kind === 'hotbar' || kind === 'pack') return centre(document.querySelector(slotSel({bar: kind, index: Number(n)})));
    if (kind === 'hud') return centre(document.querySelector(`#hotbar .slot[data-index="${Number(n)}"]`));
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
    const n = def.kind === 'weapon' ? `${st.mag}/${WEAPONS[def.weaponId!].magazine}` : d.count > 1 || d.count < st.count ? `×${d.count}` : '';
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

  /** Drop-target feedback: slot outline (red when a split cannot go there), "Drop on floor" outside. */
  private hover(t: DropTarget, el: HTMLElement | null): void {
    this.hoverEl?.classList.remove('drop-target', 'drop-bad');
    this.hoverEl = null;
    const d = this.drag;
    document.querySelector('#inventory')?.classList.toggle('drop-out', !!d && t === 'out');
    const hint = d?.ghost?.querySelector('.hint');
    if (hint) hint.textContent = t === 'out' ? 'Drop on floor' : '';
    if (!d || !t || t === 'out' || !el) return;
    const inv = this.inv(), a = inv.get(d.from), b = inv.get(t);
    const bad = !!a && !!b && !same(t, d.from) && d.count < a.count && (b.itemId !== a.itemId || b.count >= itemDef(a.itemId).stackMax);
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
      const held = ref.bar === 'hotbar' && ref.index === inv.selected;
      const usable = def?.kind === 'consumable';
      const count = def ? (def.kind === 'weapon' ? `<span class="count">${st!.mag}/${WEAPONS[def.weaponId!].magazine}</span>` : st!.count > 1 ? `<span class="count">×${st!.count}</span>` : '') : '';
      const title = def ? ` title="${def.name}${usable ? ` — ${effectText(def)}. Double-click or right-click to ${useButtonLabel(def).toLowerCase()}` : ''}. Drag to move · Shift-drag to split · drag out of the panel to drop"` : '';
      return `<div class="slot${sel ? ' selected' : ''}${held ? ' held' : ''}${usable ? ' usable' : ''}${def ? ' filled' : ''}" data-bar="${ref.bar}" data-index="${ref.index}" role="button" tabindex="0"${title}>${ref.bar === 'hotbar' ? `<span class="key">${ref.index + 1}</span>` : ''}${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? def.short : ''}</span>${count}</div>`;
    };
    $('#inv-hotbar').innerHTML = inv.hotbar.map((_, i) => cell({bar: 'hotbar', index: i})).join('');
    $('#inv-pack').innerHTML = inv.pack.map((_, i) => cell({bar: 'pack', index: i})).join('');
    if (refocus) (document.querySelector(`#inventory .slot[data-bar="${refocus.bar}"][data-index="${refocus.index}"]`) as HTMLElement | null)?.focus();
    if (this.selected && !inv.get(this.selected)) this.selected = null;
    const st = this.selected ? inv.get(this.selected) : null;
    const def = st ? itemDef(st.itemId) : null;
    $('#inv-detail .name').textContent = def ? `${def.name}${def.kind !== 'weapon' ? ` ×${st!.count}` : ` — ${st!.mag} loaded`}` : 'Nothing selected';
    $('#inv-detail .desc').textContent = def ? def.description : `Rifle rounds: ${inv.count('ammo_rifle')} · Shells: ${inv.count('ammo_shells')}`;
    const fx = document.querySelector('#inv-detail .fx');
    if (fx) fx.textContent = this.note || (def?.kind === 'consumable' ? `${effectText(def)} · ${def.useTime ?? 1} s to ${useButtonLabel(def).toLowerCase()} · double-click or right-click to ${useButtonLabel(def).toLowerCase()}` : '');
    const useBtn = $('#btn-inv-use') as HTMLButtonElement;
    useBtn.textContent = useButtonLabel(def);
    useBtn.disabled = !def || def.kind !== 'consumable';
    ($('#btn-inv-equip') as HTMLButtonElement).disabled = !def || def.kind === 'ammo';
    ($('#btn-inv-drop') as HTMLButtonElement).disabled = !def;
    const v = this.actions.vitals?.();
    const vit = document.querySelector('#inv-vitals');
    if (vit && v) {
      const tone = (x: number) => (x <= CRITICAL ? 'crit' : x <= LOW ? 'low' : '');
      vit.innerHTML = `<span>Health <b>${Math.ceil(v.hp)}</b>/${v.maxHp}</span><span class="${tone(v.food)}">Food <b>${Math.round(v.food)}%</b></span><span class="${tone(v.water)}">Water <b>${Math.round(v.water)}%</b></span>`;
    }
  }
}
