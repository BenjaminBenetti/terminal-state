// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): THE DISTRICT'S EXPLORATION RECORD — pure (no three.js / DOM).
// The checkpoint's planning map (world/surface/map*.ts) shades what the player has not been near yet; the record is ONE lane of the
// district's own memory (`${station}:surface`, run/runState.ts), so it is saved, retried and loaded with the district like its kills and
// loot, and never touches another section or the campaign.
//
// Lane SURFACE_LIFE_LANE ('surface.life') = SurfaceLifeRecord {v: 1, c, w, h, x, e}:
//  - c / w / h: the exploration cell (EXPLORE.cell = 8 m) and the bitset's columns / rows over the district's extent (528 m -> 66 x 66);
//  - x: the visited-cell BITSET (row-major, bit k of byte k >> 3 = cell k), base64 — 66 x 66 = 4356 bits = 545 bytes = 728 characters,
//    far below save/validate.ts SAVE_LIMITS.stringChars (4096); a bigger extent is refused (EXPLORE.maxChars), never truncated;
//  - e: the ids of the buildings the player has entered (sorted, unique; at most the layout's building count).
// A record that does not match the layout (another cell size / frame, a malformed string) is read as empty: never a throw, never a
// partial reveal of the wrong cells. Writing is change-driven (a new cell, a new building), so the record is current at any save.

import type {SRect} from '../../gen/surface/surfaceTypes';

export const SURFACE_LIFE_LANE = 'surface.life';

export const EXPLORE = {
  /** Exploration cell (m). */
  cell: 8,
  /** Reveal radius around the player outdoors (m): what the player has seen from the street. */
  revealM: 22,
  /** Reveal radius inside a building (m): its rooms, not the street through the walls. */
  interiorRevealM: 9,
  /** The record's bitset string may never exceed this (characters; SAVE_LIMITS.stringChars is 4096). */
  maxChars: 3600,
} as const;

/** The district's exploration grid (bitset over the extent). */
export interface ExploreGrid {
  x0: number; z0: number; cell: number; w: number; h: number;
  bits: Uint8Array;
}

export interface SurfaceLifeRecord { v: 1; c: number; w: number; h: number; x: string; e: number[] }

export function exploreGridFor(extent: SRect, cell: number = EXPLORE.cell): ExploreGrid {
  const w = Math.max(1, Math.ceil((extent.x1 - extent.x0) / cell)), h = Math.max(1, Math.ceil((extent.z1 - extent.z0) / cell));
  if (b64Len(Math.ceil(w * h / 8)) > EXPLORE.maxChars) throw new Error(`exploration grid ${w} x ${h} exceeds the save string bound`);
  return {x0: extent.x0, z0: extent.z0, cell, w, h, bits: new Uint8Array(Math.ceil(w * h / 8))};
}

const b64Len = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** The cell index of a world point (-1 outside the grid). */
export function cellIndex(g: ExploreGrid, x: number, z: number): number {
  const cx = Math.floor((x - g.x0) / g.cell), cz = Math.floor((z - g.z0) / g.cell);
  return cx < 0 || cz < 0 || cx >= g.w || cz >= g.h ? -1 : cz * g.w + cx;
}

export const isSet = (g: ExploreGrid, k: number): boolean => k >= 0 && (g.bits[k >> 3] & (1 << (k & 7))) !== 0;
export const isExplored = (g: ExploreGrid, x: number, z: number): boolean => isSet(g, cellIndex(g, x, z));

/** Mark every cell whose centre lies within `r` of (x, z) (and the cell under the point); returns how many were newly set. */
export function markDisc(g: ExploreGrid, x: number, z: number, r: number): number {
  let n = 0;
  const set = (k: number) => { if (k >= 0 && !isSet(g, k)) { g.bits[k >> 3] |= 1 << (k & 7); n++; } };
  set(cellIndex(g, x, z));
  const c0 = Math.max(0, Math.floor((x - r - g.x0) / g.cell)), c1 = Math.min(g.w - 1, Math.floor((x + r - g.x0) / g.cell));
  const r0 = Math.max(0, Math.floor((z - r - g.z0) / g.cell)), r1 = Math.min(g.h - 1, Math.floor((z + r - g.z0) / g.cell));
  for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
    const mx = g.x0 + (cx + 0.5) * g.cell, mz = g.z0 + (cz + 0.5) * g.cell;
    if ((mx - x) ** 2 + (mz - z) ** 2 <= r * r) set(cz * g.w + cx);
  }
  return n;
}

/** Explored cells (count) and their share of the grid. */
export function exploredCount(g: ExploreGrid): number {
  let n = 0;
  for (let k = 0; k < g.w * g.h; k++) if (isSet(g, k)) n++;
  return n;
}

// --- base64 (own: deterministic in every host, no atob / Buffer) --------------------------------------------------------------
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV = new Map([...ALPHA].map((c, i) => [c, i]));

export function encodeBits(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + (i + 1 < bytes.length ? ALPHA[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? ALPHA[n & 63] : '=');
  }
  return s;
}

/** Decode exactly `len` bytes; null when the string is not that (length, alphabet, padding). */
export function decodeBits(s: unknown, len: number): Uint8Array | null {
  if (typeof s !== 'string' || s.length !== b64Len(len)) return null;
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const q = [0, 1, 2, 3].map(k => s[i + k]);
    const v = q.map(c => (c === '=' ? 0 : REV.get(c)));
    if (v.some(x => x === undefined)) return null;
    const n = (v[0]! << 18) | (v[1]! << 12) | (v[2]! << 6) | v[3]!;
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (let k = 0; k < 3 && o < len; k++) out[o++] = bytes[k];
  }
  return o === len ? out : null;
}

/** The lane record of a grid + the entered buildings. */
export function writeLifeRecord(g: ExploreGrid, entered: Iterable<number>): SurfaceLifeRecord {
  return {v: 1, c: g.cell, w: g.w, h: g.h, x: encodeBits(g.bits), e: [...new Set(entered)].filter(n => Number.isInteger(n) && n >= 0).sort((a, b) => a - b)};
}

/**
 * Read the lane record into a fresh grid for `extent` (and the entered building ids below `buildings`). A record of another frame /
 * cell / a malformed one -> empty (never a throw).
 */
export function readLifeRecord(raw: unknown, extent: SRect, buildings: number): {grid: ExploreGrid; entered: Set<number>; restored: boolean} {
  const grid = exploreGridFor(extent);
  const entered = new Set<number>();
  const r = raw as Partial<SurfaceLifeRecord> | null | undefined;
  if (!r || typeof r !== 'object' || r.v !== 1 || r.c !== grid.cell || r.w !== grid.w || r.h !== grid.h) return {grid, entered, restored: false};
  const bits = decodeBits(r.x, grid.bits.length);
  if (!bits) return {grid, entered, restored: false};
  grid.bits.set(bits);
  if (Array.isArray(r.e)) for (const n of r.e) if (Number.isInteger(n) && n >= 0 && n < buildings) entered.add(n);
  return {grid, entered, restored: true};
}
