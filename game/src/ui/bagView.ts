// Iteration 16 (lane GEAR): the grounded-backpack TRANSFER VIEW. Opened with E on a bag lying on the ground; the world
// is NOT paused while it is open (enemies keep coming). Player quick slots + pockets on the left, the bag's own slots on
// the right:
// - click (or right-click) an item: it moves across to the other side (merging onto the same item; what does not fit
//   stays); drag onto a slot: move / merge / swap there; Shift-drag: half the stack;
// - "Wear it": picks the bag up and wears it (the same bag: its exact contents), when the back slot is free;
// - "Close (E)" / E / 6 / Tab / Esc close it (Tab and Esc also open the inventory / pause as usual).
// Every action goes through the open BagSession (gear/bagSession.ts), which refuses once the bag is no longer on the
// ground or the view was closed. Refusals are shown in red under the slots.

import {itemIconHtml} from './itemIcons';
import {effectText, itemDef} from '../items/items';
import {PACK_SIZE, type AnyRef, type Inventory, type ItemStack} from '../items/inventory';
import {WEAPONS} from '../weapons/weapons';
import type {BagSession} from '../gear/bagSession';
import {ensureGearStyles} from './gearStyles';
import {DRAG_THRESHOLD} from './inventoryUI';

export interface BagViewHost {
  inv(): Inventory;
  session(): BagSession | null;
  /** The player closed it (button / key). */
  close(): void;
  /** "Wear it". */
  wear(): void;
  /** Inventory changed (re-sync the held item). */
  changed(): void;
}

type Side = 'hotbar' | 'pack' | 'bag';
const refOf = (el: HTMLElement | null): AnyRef | null => el && el.dataset.bar ? {bar: el.dataset.bar as Side, index: Number(el.dataset.index)} as AnyRef : null;

export class BagView {
  private root: HTMLElement | null = null;
  private drag: {from: AnyRef; count: number; pointerId: number; x0: number; y0: number; active: boolean; ghost: HTMLElement | null} | null = null;
  private note = '';
  private noteBad = false;
  private suppressClick = false;
  /** Last action (QA / tests in a browser). */
  last: {kind: string; from?: AnyRef; to?: AnyRef | null; result: string} | null = null;

  constructor(private readonly host: BagViewHost) {}

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
  }

  private mount(): void {
    if (this.root || typeof document === 'undefined') return;
    ensureGearStyles();
    const el = document.createElement('section');
    el.id = 'bagview';
    el.className = 'hidden';
    el.setAttribute('aria-label', 'Backpack on the ground');
    el.innerHTML = `<div class="bv-panel">
      <div class="bv-head"><b>Backpack on the ground</b><span class="bv-live">● Not paused — keep an eye out</span></div>
      <div class="bv-cols">
        <div class="bv-side"><h4>Quick slots</h4><div class="slots bv-g5" data-side="hotbar"></div><h4 class="bv-pockets">Pockets</h4><div class="slots bv-g6" data-side="pack"></div></div>
        <div class="bv-arrow">⇄</div>
        <div class="bv-side"><h4 class="bv-bagtitle">Backpack</h4><div class="slots bv-g6" data-side="bag"></div></div>
      </div>
      <div class="bv-note"></div>
      <div class="bv-actions"><button class="bv-wear" type="button">Wear it (pick up)</button><button class="bv-close primary" type="button">Close (E)</button></div>
      <div class="bv-help">Click an item to move it across · drag onto a slot · Shift-drag splits · walking away or getting hit closes the bag</div>
    </div>`;
    (document.querySelector('#app') ?? document.body).appendChild(el);
    this.root = el;
    const slotEl = (e: Event) => (e.target as HTMLElement | null)?.closest?.('#bagview .slot') as HTMLElement | null;
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      const ref = refOf(slotEl(e));
      if (ref && !this.drag?.active) this.quick(ref);
    });
    el.addEventListener('click', e => {
      if (this.suppressClick) return;
      const t = e.target as HTMLElement;
      if (t.closest('.bv-close')) { this.host.close(); return; }
      if (t.closest('.bv-wear')) { this.host.wear(); return; }
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
        g.id = 'bagview-ghost';
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
      const to = refOf(target?.closest?.('#bagview .slot') as HTMLElement | null);
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

  private stackAt(ref: AnyRef): ItemStack | null {
    const s = this.host.session();
    if (ref.bar === 'bag') return s?.slots()[ref.index] ?? null;
    return this.host.inv().get(ref);
  }

  /** Click-transfer (also the QA hook). */
  quick(ref: AnyRef): number {
    const s = this.host.session();
    if (!s) return 0;
    const st = this.stackAt(ref);
    const name = st ? itemDef(st.itemId).short : '';
    const n = s.quick(ref);
    this.last = {kind: 'quick', from: ref, result: String(n)};
    if (n > 0) this.say(`${n > 1 ? `${n} × ` : ''}${name} → ${ref.bar === 'bag' ? 'you' : 'backpack'}`, false);
    else if (s.refusal) this.say(s.refusal.text, true);
    this.host.changed();
    this.render();
    return n;
  }

  /** Drag-move (also the QA hook). */
  move(from: AnyRef, to: AnyRef, count?: number): string {
    const s = this.host.session();
    if (!s) return 'closed';
    const r = s.move(from, to, count);
    this.last = {kind: 'move', from, to, result: r};
    if (r === 'refused' && s.refusal) this.say(s.refusal.text, true);
    else if (r !== 'none') this.say('', false);
    this.host.changed();
    this.render();
    return r;
  }

  /** A message under the slots (refusals in red). */
  say(text: string, bad: boolean): void {
    this.note = text;
    this.noteBad = bad;
    const n = this.root?.querySelector('.bv-note');
    if (n) { n.textContent = text; n.classList.toggle('refused', bad); }
  }

  render(): void {
    const root = this.root, s = this.host.session();
    if (!root || !s) return;
    const inv = this.host.inv();
    const cell = (ref: AnyRef, st: ItemStack | null) => {
      const def = st ? itemDef(st.itemId) : null;
      const count = def ? (def.kind === 'weapon' ? (WEAPONS[def.weaponId!].melee ? '' : `<span class="count">${st!.mag}/${WEAPONS[def.weaponId!].magazine}</span>`) : st!.count > 1 ? `<span class="count">×${st!.count}</span>` : '') : '';
      const fx = def?.kind === 'consumable' ? effectText(def) : '';
      const title = def ? ` title="${def.name}${fx ? ` — ${fx}` : ''}. Click to move it ${ref.bar === 'bag' ? 'to you' : 'into the backpack'} · drag to a slot"` : '';
      const extra = ref.bar === 'pack' && ref.index >= PACK_SIZE ? ' gear-extra' : '';
      const held = ref.bar === 'hotbar' && ref.index === inv.selected ? ' held' : '';
      return `<div class="slot${def ? ' filled' : ''}${extra}${held}" data-bar="${ref.bar}" data-index="${ref.index}"${title}>${ref.bar === 'hotbar' ? `<span class="key">${ref.index + 1}</span>` : ''}${def ? itemIconHtml(def.id) : ''}<span class="nm">${def ? def.short : ''}</span>${count}</div>`;
    };
    const side = (name: Side, list: readonly (ItemStack | null)[]) => {
      const box = root.querySelector(`[data-side="${name}"]`);
      if (box) box.innerHTML = list.map((st, i) => cell({bar: name, index: i} as AnyRef, st)).join('');
    };
    side('hotbar', inv.hotbar);
    side('pack', inv.pack);
    side('bag', s.slots());
    const ex = inv.extraPockets;
    const pk = root.querySelector('.bv-pockets');
    if (pk) pk.textContent = `Pockets · ${inv.pack.length}${ex ? ` (${PACK_SIZE} + ${ex} chest rig)` : ''}`;
    const fill = s.fill();
    const bt = root.querySelector('.bv-bagtitle');
    if (bt) bt.textContent = `${itemDef(s.bag.stack.itemId).name} · ${fill.used}/${fill.slots} slots used`;
    const wear = root.querySelector('.bv-wear') as HTMLButtonElement | null;
    if (wear) {
      const worn = inv.worn('backpack');
      wear.disabled = !!worn;
      wear.title = worn ? 'You are already wearing a backpack — put yours down first (6, then click)' : 'Pick this backpack up and wear it (its contents stay inside)';
    }
    const n = root.querySelector('.bv-note');
    if (n) { n.textContent = this.note; n.classList.toggle('refused', this.noteBad); }
  }
}
