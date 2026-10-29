// Iteration 16 (lane GEAR): the ONLY way into a backpack's contents — an open transfer session on a bag that lies on the
// ground. While a backpack is worn or held its contents have no API path at all (items/inventory.ts refuses `bagMove` /
// `bagQuick` on the worn bag; nothing else reads `stack.bag`). A session refuses everything once the bag is no longer
// grounded or the session was closed (distance, damage, death, travel, pause, Tab, E / 6 / Close).

import type {AnyRef, Inventory, MoveResult, Refusal} from '../items/inventory';
import {BACKPACK_SLOTS} from '../items/gear';

/** What a session needs from a grounded bag (world/groundBag.ts GroundBag). */
export interface BagHost {
  readonly stack: import('../items/inventory').ItemStack;
  /** Lying in the world right now (false once worn / removed). */
  readonly grounded: boolean;
}

export const CLOSED: Refusal = {code: 'worn-bag', text: 'The backpack has to be on the ground and open (E) to reach into it.'};

export class BagSession {
  private openFlag = true;
  /** Why the last action was refused (the view shows it). */
  refusal: Refusal | null = null;

  constructor(private readonly inv: () => Inventory, readonly bag: BagHost) {}

  /** Transfers are allowed: open, the bag lies on the ground and is not part of the inventory. */
  get active(): boolean {
    return this.openFlag && this.bag.grounded && !this.inv().holds(this.bag.stack);
  }
  get open(): boolean {
    return this.openFlag;
  }

  close(): void {
    this.openFlag = false;
  }

  /** Drag / drop between the player's quick slots / pockets and the bag's slots (or within either). */
  move(from: AnyRef, to: AnyRef, count?: number): MoveResult {
    if (!this.active) { this.refusal = CLOSED; return 'refused'; }
    const inv = this.inv();
    const r = inv.bagMove(this.bag.stack, from, to, count);
    this.refusal = r === 'refused' ? inv.refusal : null;
    return r;
  }

  /** Click-to-transfer to the other side. Returns how many items moved. */
  quick(from: AnyRef): number {
    if (!this.active) { this.refusal = CLOSED; return 0; }
    const inv = this.inv();
    const n = inv.bagQuick(this.bag.stack, from);
    this.refusal = n ? null : inv.refusal;
    return n;
  }

  /** Pick the bag up and wear it (the same stack: identity and exact contents kept). Needs the back slot free. */
  wear(): boolean {
    if (!this.active) { this.refusal = CLOSED; return false; }
    const inv = this.inv();
    if (!inv.wearBag(this.bag.stack)) { this.refusal = inv.refusal; return false; }
    this.refusal = null;
    this.openFlag = false;
    return true;
  }

  /** Contents for display (only while active; empty otherwise). */
  slots(): readonly (import('../items/inventory').ItemStack | null)[] {
    return this.active ? this.bag.stack.bag ?? [] : [];
  }

  /** Items (stacks) inside / slot count, for the header. */
  fill(): {used: number; slots: number} {
    const list = this.bag.stack.bag ?? [];
    return {used: list.filter(Boolean).length, slots: list.length || BACKPACK_SLOTS};
  }
}
