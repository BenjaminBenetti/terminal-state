// Task studio-baked-lighting-reflections-20261114-050258-01 (lane CACHE): the DERIVED-DATA CACHE — rebuildable binary results (a
// station's enhanced light field, its reflection probes) kept in the browser OUTSIDE the campaign save.
// CONTRACT (the lead's stub; lane CACHE implements it in this file):
//  - It is never part of a save: nothing here reads or writes localStorage, a save slot, the settings record or any STORAGE_KEYS
//    entry, and no save / export / import code may mention it. Losing every entry (cleared site data, private mode, eviction,
//    another browser, an imported save) costs a re-bake and nothing else.
//  - Backend: IndexedDB when it works (its own database, DERIVED_DB_NAME), else an in-memory store for this session, else nothing.
//    The backend in use and the reason for a downgrade are reported (`backend`, `reason`), never hidden.
//  - Bounded: at most `maxEntries` entries and `maxBytes` stored bytes; a put that would exceed either evicts the least recently
//    USED entries first (a get that hits refreshes `lastUsed`); an entry larger than the whole budget is not stored.
//  - Robust: get / put / delete / clear / stats never throw and never reject. A missing, truncated, corrupt, foreign-version or
//    wrong-key record is a miss (and is deleted). A quota / blocked / aborted write is a failed put (false), the cache keeps working.
//  - Content is opaque here: a bundle of JSON-safe `meta` plus named typed arrays. Keys are caller-made content hashes
//    (core/contentHash.ts) of the realized bake inputs, versions and settings — never a seed.

/** A typed array a bundle may hold. */
export type DerivedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

/** One cached result: JSON-safe metadata + named typed arrays (returned arrays are fresh copies the caller owns). */
export interface DerivedBundle {
  meta: Record<string, unknown>;
  arrays: Record<string, DerivedArray>;
}

export interface DerivedCacheStats {
  backend: 'indexeddb' | 'memory' | 'none';
  /** Why the backend is not IndexedDB (null when it is). */
  reason: string | null;
  entries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
  /** This session's counters. */
  hits: number; misses: number; puts: number; failedPuts: number; evictions: number; corrupt: number;
}

export interface DerivedCache {
  readonly backend: 'indexeddb' | 'memory' | 'none';
  readonly reason: string | null;
  /** The bundle stored under `key`, or null (missing / corrupt / unreadable). Refreshes the entry's last-used time. */
  get(key: string): Promise<DerivedBundle | null>;
  /** Store (replace) `key`. `tag` is a short human label kept with the entry (diagnostics only). False when nothing was stored. */
  put(key: string, bundle: DerivedBundle, tag?: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<DerivedCacheStats>;
}

/** The database name (no leading slash: tools/release/package-ci.mjs rejects root-absolute string literals). */
export const DERIVED_DB_NAME = 'terminal-state.derived.v1';

/** Defaults: 48 stations or 96 MiB of stored (compressed where the browser can) bytes, whichever comes first. */
export const DERIVED_CACHE_LIMITS = {maxEntries: 48, maxBytes: 96 * 1024 * 1024} as const;

export interface DerivedCacheOptions {
  name?: string;
  maxEntries?: number;
  maxBytes?: number;
  /** Clock (ms) for last-used ordering (tests). */
  now?: () => number;
  /** The IndexedDB factory (default globalThis.indexedDB; null = no IndexedDB: the in-memory store). */
  indexedDB?: unknown;
  /** false = never compress (default: deflate through CompressionStream when the host has it). */
  compress?: boolean;
}

/** Open the cache. Never throws: an unusable IndexedDB gives the in-memory backend with its reason. */
export function openDerivedCache(_opts: DerivedCacheOptions = {}): DerivedCache {
  throw new Error('openDerivedCache: not implemented');
}

/** A bundle as one byte container (magic, format version, checksum; deflated when possible). */
export async function packBundle(_b: DerivedBundle, _compress = true): Promise<Uint8Array> {
  throw new Error('packBundle: not implemented');
}

/** The bundle of a container, or null when it is not one / is damaged / is of another format version. */
export async function unpackBundle(_bytes: Uint8Array): Promise<DerivedBundle | null> {
  throw new Error('unpackBundle: not implemented');
}
