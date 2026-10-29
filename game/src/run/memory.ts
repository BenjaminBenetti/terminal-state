// Iteration 16 (lane RUN): per-SECTION memory of a run — what the player changed in a section, so coming back never
// respawns taken loot, never duplicates or loses dropped items and never revives killed enemies.
//
// Pure data + pure helpers (no three.js, no DOM): Game captures / applies it through run/worldMemory.ts. Everything in a
// SectionMemory is JSON-safe plain data, so a Retry-level snapshot is a structuredClone of it.
//
//  - pickups: null until the section was LEFT once (then the world spawns from layout.pickups). After that it is the
//    complete list of loose items lying in the section — what is left of generated pickups (layoutIndex), items the player
//    dropped, lots spilled / shot off holders — each with its exact pose. On return exactly these are restored, once.
//  - holders: per loot holder (keyed by kind + storey + position, robust to dropped prop placements): the lot ids still
//    inside (lots are rolled deterministically from the section seed, so ids are stable), opened / searched flags.
//  - killed: layout.zombies indices of enemies that died; they are not spawned again.
//  - cleared: the "section clear" moment already happened (no second win screen / toast).
//  - lanes: opaque per-lane stores (lane GEAR: grounded bags). JSON-safe plain data only.

import {sectionId, type SectionKey} from '../levels/types';

/** Object pose: position + quaternion (x, y, z, w). */
export interface Pose { p: [number, number, number]; q: [number, number, number, number] }

/** A plain copy of an ItemStack without its uid (inventory uids are per Inventory; a fresh one is made on restore). */
export interface StackRecord { itemId: string; count: number; mag?: number; [extra: string]: unknown }

/** A loose item lying in a section. */
export interface PickupRecord {
  stack: StackRecord;
  /** Render pose of the item object. */
  pose: Pose;
  /** Targeting anchor (PickupManager x / y / z; physics keeps it at the body centre). */
  anchor: [number, number, number];
  /** Index into layout.pickups when this is (what is left of) a generated pickup; absent = dropped / spilled / shot off. */
  layoutIndex?: number;
  /** Provenance of a lot that left its holder (QA). */
  fromLot?: {holder: number; lot: number};
}

/** A loot holder's remembered state. */
export interface HolderRecord {
  /** Lot ids still inside / on it. */
  lots: number[];
  open: boolean;
  searched: boolean;
  /** Openable compartments: ever opened (seen). Compartments come back closed; their contents are what was left. */
  seen?: boolean[];
}

export interface SectionMemory {
  /** sectionId(key) — 'subway:main', 'office:floor-5'. */
  id: string;
  /** Times the section was entered in this run. */
  visits: number;
  pickups: PickupRecord[] | null;
  holders: Record<string, HolderRecord>;
  killed: number[];
  cleared: boolean;
  lanes: Record<string, unknown>;
}

export function createMemory(key: SectionKey): SectionMemory {
  return {id: sectionId(key), visits: 0, pickups: null, holders: {}, killed: [], cleared: false, lanes: {}};
}

/** Deep copy (structuredClone-safe by construction). */
export function cloneMemory(m: SectionMemory): SectionMemory {
  return structuredClone(m);
}

/** Holder key: kind + storey + position (cm) — unique per placement and independent of placement order. */
export function holderKey(kind: string, level: number | undefined, x: number, z: number): string {
  return `${kind}@${level ?? 0}:${Math.round(x * 100)},${Math.round(z * 100)}`;
}

/** Minimal holder-state shape (items/loot.ts HolderState) the memory reads / writes. */
export interface HolderStateLike {
  lots: {id: number}[];
  open: boolean;
  searched: boolean;
  parts?: boolean[];
  seen?: boolean[];
}

export function captureHolder(st: HolderStateLike): HolderRecord {
  const r: HolderRecord = {lots: st.lots.map(l => l.id), open: st.open, searched: st.searched};
  if (st.seen) r.seen = [...st.seen];
  return r;
}

/**
 * Apply a remembered holder state onto a freshly built (re-rolled, identical) holder state: lots that were taken are
 * removed (never added: a lot id that is not in the rolled state is ignored), flags restored. `openable` holders get
 * their compartments back closed (state.parts all false; `open` false for door / lid holders) with `seen` kept.
 * Returns the number of lots removed.
 */
export function applyHolderRecord(st: HolderStateLike, rec: HolderRecord, o: {openable: boolean; container: boolean}): number {
  const keep = new Set(rec.lots);
  const before = st.lots.length;
  st.lots = st.lots.filter(l => keep.has(l.id));
  st.searched = st.searched || rec.searched;
  if (o.openable) {
    if (st.parts) st.parts = st.parts.map(() => false);
    if (st.seen && rec.seen) st.seen = st.seen.map((v, i) => v || !!rec.seen![i]);
    if (o.container) st.open = false;
  } else st.open = rec.open;
  return before - st.lots.length;
}

/** What to spawn when a section is built: generated pickups (first visit) or exactly the remembered list. */
export function pickupPlan(layoutCount: number, mem: SectionMemory): {fromLayout: number[]; restored: PickupRecord[]} {
  if (mem.pickups === null) return {fromLayout: Array.from({length: layoutCount}, (_, i) => i), restored: []};
  return {fromLayout: [], restored: mem.pickups};
}

/** layout.pickups indices no longer lying in the section (taken; QA / summary). */
export function takenLayoutPickups(layoutCount: number, mem: SectionMemory): number[] {
  if (mem.pickups === null) return [];
  const left = new Set(mem.pickups.map(p => p.layoutIndex).filter((i): i is number => i !== undefined));
  const out: number[] = [];
  for (let i = 0; i < layoutCount; i++) if (!left.has(i)) out.push(i);
  return out;
}

/** layout.zombies indices to spawn when a section is built: every enemy not killed earlier in the run. */
export function enemiesToSpawn(count: number, mem: SectionMemory): number[] {
  const killed = new Set(mem.killed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (!killed.has(i)) out.push(i);
  return out;
}

/** Union of killed indices (sorted, unique). A kill is permanent for the run. */
export function mergeKilled(prev: readonly number[], now: readonly number[]): number[] {
  return [...new Set([...prev, ...now])].sort((a, b) => a - b);
}

/** Short JSON summary (QA). */
export function memorySummary(m: SectionMemory, layoutPickups?: number): Record<string, unknown> {
  const holders = Object.values(m.holders);
  return {
    id: m.id, visits: m.visits, cleared: m.cleared, killed: m.killed.length,
    pickups: m.pickups === null ? null : m.pickups.length,
    dropped: m.pickups === null ? 0 : m.pickups.filter(p => p.layoutIndex === undefined).length,
    takenLayout: layoutPickups === undefined ? undefined : takenLayoutPickups(layoutPickups, m).length,
    holders: holders.length, holdersSearched: holders.filter(h => h.searched).length,
    lanes: Object.keys(m.lanes),
  };
}
