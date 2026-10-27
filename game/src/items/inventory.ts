// Inventory: five hotbar slots (keys 1-5) plus a small backpack. Pure logic, no DOM.

import {itemDef} from './items';
import {WEAPONS} from '../weapons/weapons';

export interface ItemStack {
  uid: number;
  itemId: string;
  count: number;
  /** Rounds currently loaded (weapons only). */
  mag?: number;
}

export type Bar = 'hotbar' | 'pack';
export interface SlotRef { bar: Bar; index: number }

export const HOTBAR_SIZE = 5;
export const PACK_SIZE = 12;

export class Inventory {
  readonly hotbar: (ItemStack | null)[] = new Array(HOTBAR_SIZE).fill(null);
  readonly pack: (ItemStack | null)[] = new Array(PACK_SIZE).fill(null);
  selected = 0;
  private nextUid = 1;
  /** Bumped on every change so the UI knows when to redraw. */
  version = 0;

  makeStack(itemId: string, count: number, mag?: number): ItemStack {
    const def = itemDef(itemId);
    const s: ItemStack = {uid: this.nextUid++, itemId, count: Math.min(count, def.stackMax)};
    if (def.kind === 'weapon') s.mag = mag ?? WEAPONS[def.weaponId!].magazine;
    return s;
  }

  private list(bar: Bar) {
    return bar === 'hotbar' ? this.hotbar : this.pack;
  }
  get(ref: SlotRef): ItemStack | null {
    return this.list(ref.bar)[ref.index] ?? null;
  }
  set(ref: SlotRef, s: ItemStack | null): void {
    this.list(ref.bar)[ref.index] = s;
    this.version++;
  }
  selectedStack(): ItemStack | null {
    return this.hotbar[this.selected];
  }
  select(i: number): void {
    if (i < 0 || i >= HOTBAR_SIZE) return;
    this.selected = i;
    this.version++;
  }
  cycle(dir: number): void {
    this.select((this.selected + dir + HOTBAR_SIZE) % HOTBAR_SIZE);
  }

  /** Adds as much of the stack as fits. Returns the count that did not fit. */
  add(stack: ItemStack): number {
    const def = itemDef(stack.itemId);
    let left = stack.count;
    if (def.stackMax > 1) {
      for (const s of [...this.pack, ...this.hotbar]) {
        if (!s || s.itemId !== stack.itemId || s.count >= def.stackMax) continue;
        const n = Math.min(left, def.stackMax - s.count);
        s.count += n;
        left -= n;
        if (!left) break;
      }
    }
    const order: Bar[] = def.kind === 'ammo' ? ['pack', 'hotbar'] : ['hotbar', 'pack'];
    for (const bar of order) {
      const list = this.list(bar);
      for (let i = 0; i < list.length && left > 0; i++) {
        if (list[i]) continue;
        const n = Math.min(left, def.stackMax);
        list[i] = n === stack.count && left === stack.count ? stack : {...stack, uid: this.nextUid++, count: n};
        left -= n;
      }
      if (!left) break;
    }
    this.version++;
    return left;
  }

  count(itemId: string): number {
    let n = 0;
    for (const s of [...this.hotbar, ...this.pack]) if (s && s.itemId === itemId) n += s.count;
    return n;
  }

  /** Removes up to n of an item (backpack first). Returns how many were removed. */
  take(itemId: string, n: number): number {
    let got = 0;
    for (const bar of ['pack', 'hotbar'] as Bar[]) {
      const list = this.list(bar);
      for (let i = list.length - 1; i >= 0 && got < n; i--) {
        const s = list[i];
        if (!s || s.itemId !== itemId) continue;
        const k = Math.min(s.count, n - got);
        s.count -= k;
        got += k;
        if (s.count <= 0) list[i] = null;
      }
    }
    if (got) this.version++;
    return got;
  }

  /** Consume one from a specific slot (used for consumables in hand). */
  consumeAt(ref: SlotRef): boolean {
    const s = this.get(ref);
    if (!s) return false;
    s.count--;
    if (s.count <= 0) this.set(ref, null);
    else this.version++;
    return true;
  }

  remove(ref: SlotRef): ItemStack | null {
    const s = this.get(ref);
    if (s) this.set(ref, null);
    return s;
  }

  /**
   * Takes `count` (default: all) out of a slot, e.g. to drop it into the world. Taking the whole
   * stack returns the same object (uid and loaded magazine kept); a partial take leaves the rest
   * in place and returns a new stack with a fresh uid.
   */
  detach(ref: SlotRef, count?: number): ItemStack | null {
    const s = this.get(ref);
    if (!s) return null;
    const n = Math.max(1, Math.min(s.count, Math.floor(count ?? s.count)));
    if (n >= s.count) return this.remove(ref);
    s.count -= n;
    this.version++;
    return {...s, uid: this.nextUid++, count: n};
  }

  /** Move/merge/swap between two slots (whole stack). */
  move(from: SlotRef, to: SlotRef): boolean {
    const r = this.moveCount(from, to);
    return r !== 'none' && r !== 'refused';
  }

  /**
   * Drag-and-drop move of `count` items (default: the whole stack) from one slot to another:
   * - empty target: the whole stack moves as the same object (uid, mag); a split creates a new
   *   stack with a fresh uid and leaves the rest behind;
   * - same item with room: merge up to stackMax, any remainder stays in the source slot;
   * - anything else: the two whole stacks swap. A split onto a different (or full) stack is
   *   refused, because the remainder would have nowhere to go.
   * Selection (`selected`) is a slot index and never changes here: the caller re-syncs what is held.
   */
  moveCount(from: SlotRef, to: SlotRef, count?: number): 'none' | 'moved' | 'split' | 'merged' | 'swapped' | 'refused' {
    if (from.bar === to.bar && from.index === to.index) return 'none';
    const a = this.get(from), b = this.get(to);
    if (!a) return 'none';
    const n = Math.max(1, Math.min(a.count, Math.floor(count ?? a.count)));
    const whole = n >= a.count;
    if (b && b.itemId === a.itemId) {
      const max = itemDef(a.itemId).stackMax;
      if (max > 1 && b.count < max) {
        const k = Math.min(n, max - b.count);
        b.count += k;
        a.count -= k;
        this.list(from.bar)[from.index] = a.count > 0 ? a : null;
        this.version++;
        return 'merged';
      }
    }
    if (!b) {
      if (whole) {
        this.list(to.bar)[to.index] = a;
        this.list(from.bar)[from.index] = null;
        this.version++;
        return 'moved';
      }
      a.count -= n;
      this.list(to.bar)[to.index] = {...a, uid: this.nextUid++, count: n};
      this.version++;
      return 'split';
    }
    if (!whole) return 'refused';
    this.list(to.bar)[to.index] = a;
    this.list(from.bar)[from.index] = b;
    this.version++;
    return 'swapped';
  }

  hasRoomFor(itemId: string): boolean {
    const def = itemDef(itemId);
    for (const s of [...this.hotbar, ...this.pack]) {
      if (!s) return true;
      if (s.itemId === itemId && s.count < def.stackMax) return true;
    }
    return false;
  }

  find(uid: number): SlotRef | null {
    for (const bar of ['hotbar', 'pack'] as Bar[]) {
      const i = this.list(bar).findIndex(s => s?.uid === uid);
      if (i >= 0) return {bar, index: i};
    }
    return null;
  }

  /** Debug/test invariant check. */
  invariants(): string[] {
    const out: string[] = [];
    const uids = new Set<number>();
    for (const s of [...this.hotbar, ...this.pack]) {
      if (!s) continue;
      const def = itemDef(s.itemId);
      if (uids.has(s.uid)) out.push(`duplicate uid ${s.uid}`);
      uids.add(s.uid);
      if (s.count < 1 || s.count > def.stackMax) out.push(`bad count ${s.itemId}:${s.count}`);
      if (def.kind === 'weapon') {
        const w = WEAPONS[def.weaponId!];
        if (s.mag === undefined || s.mag < 0 || s.mag > w.magazine) out.push(`bad mag ${s.itemId}:${s.mag}`);
      }
    }
    if (this.hotbar.length !== HOTBAR_SIZE || this.pack.length !== PACK_SIZE) out.push('slot arrays resized');
    if (this.selected < 0 || this.selected >= HOTBAR_SIZE) out.push('bad selection');
    return out;
  }
}
