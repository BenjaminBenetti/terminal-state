// Iteration 16 (lane GEAR): where grounded backpacks live while their section is not built.
//
// One record per SECTION ("subway:main", "office:floor-5"): the bags lying there (exact contents, uids, pose) and whether
// that section's found (generated) backpacks were already turned into bags. Records are plain JSON-safe data.
// - In a run, lane RUN plugs its section memory in (run/bagStore.ts runBagStore -> game.gear.setStore): bags then follow
//   the run's memories exactly (kept across travel, restored with the level on Retry level, dropped on NewGame).
// - Without RUN (tests, an older boot path) the module-level MemoryBagStore below is used.
// Records are validated on load (a foreign / stale record is ignored, never trusted blindly).

import type {StackJSON} from '../items/inventory';
import {isBagItem} from '../items/gear';

export interface BagRecord {
  /** Stable id within the run ("found:<layout pickup index>" for generated finds, "bag:<uid>" for the player's own). */
  id: string;
  /** The backpack stack with its contents (deep plain copy). */
  stack: StackJSON;
  x: number; y: number; z: number; yaw: number;
  /** Storey (layout.levels index) it rests on. */
  level: number;
}

export interface SectionBags {
  v: 1;
  /** Layout seed the record belongs to (a record for another seed is stale and ignored). */
  seed: number;
  /** The section's generated backpack finds were converted to bags already (never convert twice). */
  init: boolean;
  bags: BagRecord[];
}

/** Store shape (RUN's adapter returns `unknown` from load: GEAR validates). */
export interface BagStore {
  load(sectionId: string): unknown;
  save(sectionId: string, rec: unknown): void;
  clear(): void;
  toJSON(): Record<string, unknown>;
  loadJSON(j: unknown): void;
}

/** In-module fallback store (no run plugged in). */
export class MemoryBagStore implements BagStore {
  private readonly map = new Map<string, unknown>();
  load(sectionId: string): unknown {
    const v = this.map.get(sectionId);
    return v === undefined ? undefined : structuredClone(v);
  }
  save(sectionId: string, rec: unknown): void {
    if (rec === undefined || rec === null) this.map.delete(sectionId);
    else this.map.set(sectionId, structuredClone(rec));
  }
  clear(): void {
    this.map.clear();
  }
  toJSON(): Record<string, unknown> {
    return Object.fromEntries([...this.map].map(([k, v]) => [k, structuredClone(v)]));
  }
  loadJSON(j: unknown): void {
    this.map.clear();
    if (j && typeof j === 'object') for (const [k, v] of Object.entries(j as Record<string, unknown>)) this.map.set(k, structuredClone(v));
  }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function validStack(s: unknown, depth: number): s is StackJSON {
  if (!s || typeof s !== 'object') return false;
  const j = s as StackJSON;
  if (!finite(j.uid) || typeof j.itemId !== 'string' || !finite(j.count) || j.count < 1) return false;
  if (j.bag !== undefined) {
    if (depth > 0 || !Array.isArray(j.bag)) return false; // one level only: no bag inside a bag
    for (const c of j.bag) if (c !== null && (!validStack(c, depth + 1) || isBagItem(c.itemId))) return false;
  }
  return true;
}

/** A store record for this section and seed, or null (missing / stale / malformed). */
export function readSectionBags(raw: unknown, seed: number): SectionBags | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as SectionBags;
  if (r.v !== 1 || !finite(r.seed) || (r.seed >>> 0) !== (seed >>> 0) || !Array.isArray(r.bags)) return null;
  const bags = r.bags.filter(b => b && typeof b.id === 'string' && validStack(b.stack, 0) && isBagItem(b.stack.itemId) && Array.isArray(b.stack.bag)
    && finite(b.x) && finite(b.y) && finite(b.z) && finite(b.yaw) && finite(b.level));
  return {v: 1, seed: r.seed >>> 0, init: !!r.init, bags};
}

/** The module-level fallback store (TODO(RUN wiring): replaced by game.gear.setStore(runBagStore(...)) in a run). */
export const defaultBagStore = new MemoryBagStore();
