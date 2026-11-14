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
//
// HOW
//  - openDerivedCache returns at once. `backend` is tentative ('indexeddb' when there is a factory) until ready() resolves; every
//    operation waits for that itself, and all of them run one after another on one promise chain, so a put's "read the index, evict,
//    write" is never interleaved with another call of this instance. Across tabs each put is one IndexedDB transaction that reads
//    the index it decides on, so two tabs cannot corrupt each other's accounting either.
//  - The database (version 1) has two object stores: `meta` (key path `key`: the key, the stored bytes, lastUsed, created, the tag
//    and the container format version — everything the LRU needs, a few dozen small rows) and `data` (key -> the container, one
//    Uint8Array). A hit rewrites its `meta` row only. The in-memory backend keeps the same two things in a Map.
//  - IndexedDB is given up for this session (the in-memory backend takes over, capped at DERIVED_MEMORY_MAX_BYTES so a session
//    without storage cannot grow without bound; `reason` says why) when: there is no factory or reading it throws; open() throws,
//    errors, is blocked, finds another schema under the name or does not settle in `openTimeoutMs`; later, when the browser closes
//    the connection or another tab asks for a version change (reported at that moment; our connection is closed so that tab is not
//    blocked), when a transaction cannot be started (the connection closed: InvalidStateError) or does not finish in `txTimeoutMs`,
//    or when IDB_FAILURE_LIMIT operations in a row failed for another reason than quota. A put refused for quota is only a failed
//    put. The operation that found the database dead (also one whose transaction was aborted by the connection closing under
//    it) is repeated on the in-memory backend. A missing factory is reported in `reason` without a console warning (Node, tests); every real failure is
//    warned about once per kind per cache.
//  - `corrupt` counts records that were found but could not be used (damaged, truncated, another format version, another key, a
//    `data` record without its `meta` row or the reverse); each is deleted and is also a miss. `failedPuts` counts every put that
//    resolved false (quota, an aborted write, a bundle that cannot be packed, an entry over the byte budget, no backend).
//
// THE CONTAINER (packBundle / unpackBundle; integers little-endian)
//     0  4  magic 'TSDC'
//     4  2  DERIVED_CONTAINER_VERSION
//     6  1  flags: 1 = the body is deflated ('deflate-raw'), 2 = written by a big-endian host (its arrays are in that order)
//     7  1  0
//     8  4  H: bytes of the header (UTF-8 JSON)
//    12  4  B: bytes of the body before compression
//    16  8  checksum: the 16 hex digits of new ContentHasher().num(version, H, B).view(body).digest() as 8 bytes
//    24  …  the body: the header {key, meta, arrays: [{name, type, length, offset}]}, zero padding to a multiple of 8, then the
//           payload; `offset` counts from the payload's start and is a multiple of 8, `type` is u8 i8 u16 i16 u32 i32 f32 f64,
//           `length` is in elements.
//  The body is deflated through CompressionStream when the host has both stream classes and the result is smaller, else stored
//  raw; a deflated container on a host without DecompressionStream reads as null. The checksum is over the uncompressed body, so
//  it also catches a bad inflate. `key` binds a record to the key it was stored under (null from a bare packBundle): the cache
//  packs with the key and reads back with it, so a record copied under another key is a miss. `meta` must survive
//  JSON.parse(JSON.stringify(meta)) unchanged: plain objects, arrays without holes, strings, booleans, null and finite numbers
//  (-0 is accepted and comes back as 0); anything else makes packBundle throw and put resolve false. unpackBundle never throws:
//  anything that is not a whole, undamaged container of this version and this byte order is null. Arrays come back as fresh copies.

import {ContentHasher} from './contentHash';

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
  /** The byte budget in force (the in-memory backend's is capped at DERIVED_MEMORY_MAX_BYTES). */
  maxBytes: number;
  /** This session's counters. */
  hits: number; misses: number; puts: number; failedPuts: number; evictions: number; corrupt: number;
}

export interface DerivedCache {
  /** Tentative until ready() resolves ('indexeddb' when a factory exists), the real backend afterwards. */
  readonly backend: 'indexeddb' | 'memory' | 'none';
  readonly reason: string | null;
  /** Resolves (never rejects) once the backend is decided: IndexedDB opened, or downgraded. Every operation waits for it itself. */
  ready(): Promise<void>;
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

/** The in-memory backend never holds more than this, whatever `maxBytes` says. */
export const DERIVED_MEMORY_MAX_BYTES = 48 * 1024 * 1024;

/** The container format (a record of another version is a miss). */
export const DERIVED_CONTAINER_VERSION = 1;

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
  /** How long open() may take before the in-memory backend takes over (ms; default 3000). */
  openTimeoutMs?: number;
  /** How long one transaction may take before the database counts as unusable (ms; default 10000). */
  txTimeoutMs?: number;
  /** false = no in-memory backend: without a working IndexedDB the cache stores nothing (backend 'none'). Default true. */
  memoryFallback?: boolean;
}

// ---------------------------------------------------------------------------------------------
// The container

const MAGIC = [0x54, 0x53, 0x44, 0x43];
const FIXED = 24, FLAG_DEFLATED = 1, FLAG_BIG_ENDIAN = 2;
const DEFLATE = 'deflate-raw';
/** Lengths are 32-bit fields; one container stays far below that. */
const MAX_BODY = 0x7fffffff;
const HOST_BIG_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 0;

type ArrayCtor = {new (buffer: ArrayBuffer, byteOffset: number, length: number): DerivedArray; readonly BYTES_PER_ELEMENT: number};
const TYPES: ReadonlyMap<string, ArrayCtor> = new Map<string, ArrayCtor>([
  ['u8', Uint8Array], ['i8', Int8Array], ['u16', Uint16Array], ['i16', Int16Array], ['u32', Uint32Array], ['i32', Int32Array], ['f32', Float32Array], ['f64', Float64Array],
]);
const TYPE_NAMES: ReadonlyMap<string, string> = new Map([
  ['Uint8Array', 'u8'], ['Int8Array', 'i8'], ['Uint16Array', 'u16'], ['Int16Array', 'i16'], ['Uint32Array', 'u32'], ['Int32Array', 'i32'], ['Float32Array', 'f32'], ['Float64Array', 'f64'],
]);

interface ArrayDesc { name: string; type: string; length: number; offset: number }

const align8 = (n: number): number => Math.ceil(n / 8) * 8;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Throws unless `v` is the same after JSON.parse(JSON.stringify(v)) (the header is JSON; what was put must be what comes back). */
function assertJsonSafe(v: unknown, path: string, depth: number): void {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`derived bundle: ${path} is not a finite number`);
    return;
  }
  if (typeof v !== 'object') throw new Error(`derived bundle: ${path} is ${typeof v}, which JSON cannot hold`);
  if (depth > 32) throw new Error(`derived bundle: ${path} is nested too deeply (or refers to itself)`);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new Error(`derived bundle: ${path}[${i}] is a hole`);
      assertJsonSafe(v[i], `${path}[${i}]`, depth + 1);
    }
    return;
  }
  if (!isPlain(v) || Object.getOwnPropertySymbols(v).length > 0) throw new Error(`derived bundle: ${path} is not a plain object`);
  for (const k of Object.keys(v)) assertJsonSafe(v[k], `${path}.${k}`, depth + 1);
}

function checksum(headerLength: number, body: Uint8Array): string {
  return new ContentHasher().num(DERIVED_CONTAINER_VERSION, headerLength, body.byteLength).view(body).digest();
}

/** The uncompressed container of a bundle. Throws a plain Error for a bundle that cannot be stored. */
function encode(b: DerivedBundle, key: string | null): Uint8Array<ArrayBuffer> {
  if (!isPlain(b) || !isPlain(b.meta)) throw new Error('derived bundle: meta must be a plain object');
  assertJsonSafe(b.meta, 'meta', 0);
  if (!isPlain(b.arrays)) throw new Error('derived bundle: arrays must be a plain object of typed arrays');
  const names = Object.keys(b.arrays), descs: ArrayDesc[] = [];
  let payload = 0;
  for (const name of names) {
    const a = b.arrays[name];
    const type = ArrayBuffer.isView(a) ? TYPE_NAMES.get((a as {[Symbol.toStringTag]: string})[Symbol.toStringTag]) : undefined;
    if (!type) throw new Error(`derived bundle: arrays.${name} is not a supported typed array`);
    descs.push({name, type, length: a.length, offset: payload});
    payload += align8(a.byteLength);
  }
  const json = new TextEncoder().encode(JSON.stringify({key, meta: b.meta, arrays: descs}));
  const start = align8(json.byteLength), total = start + payload;
  if (total > MAX_BODY) throw new Error('derived bundle: too large for one container');
  const out = new Uint8Array(FIXED + total);
  out.set(json, FIXED);
  names.forEach((name, i) => {
    const a = b.arrays[name];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), FIXED + start + descs[i].offset);
  });
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, DERIVED_CONTAINER_VERSION, true);
  out[6] = HOST_BIG_ENDIAN ? FLAG_BIG_ENDIAN : 0;
  dv.setUint32(8, json.byteLength, true);
  dv.setUint32(12, total, true);
  const sum = checksum(json.byteLength, out.subarray(FIXED));
  for (let i = 0; i < 8; i++) out[16 + i] = parseInt(sum.slice(2 * i, 2 * i + 2), 16);
  return out;
}

interface ByteStreams { readonly readable: ReadableStream<Uint8Array>; readonly writable: WritableStream<Uint8Array> }
type StreamCtor = new (format: string) => ByteStreams;
interface StreamGlobals { CompressionStream?: StreamCtor; DecompressionStream?: StreamCtor }

/** `input` through a (de)compression stream. Null when the stream fails or gives more than `limit` bytes. Never rejects. */
async function pipeBytes(make: () => ByteStreams, input: Uint8Array, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const streams = make(), writer = streams.writable.getWriter(), reader = streams.readable.getReader();
    // Written without waiting (the stream applies backpressure until it is read). A bad stream fails the read below as well: the
    // write side's own rejection is swallowed here so it is never an unhandled one.
    const fed = writer.write(input).then(() => writer.close()).then(() => true, () => false);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      total += r.value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => {});
        void writer.abort().catch(() => {});
        return null;
      }
      chunks.push(r.value);
    }
    if (!(await fed)) return null;
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out;
  } catch {
    return null;
  }
}

/** A bundle as one byte container (magic, format version, checksum; deflated when possible). `key` binds it to a cache key. */
export async function packBundle(b: DerivedBundle, compress = true, key: string | null = null): Promise<Uint8Array> {
  const raw = encode(b, key);
  const g = globalThis as StreamGlobals, C = g.CompressionStream;
  if (!compress || typeof C !== 'function' || typeof g.DecompressionStream !== 'function') return raw;
  const body = raw.subarray(FIXED);
  const packed = await pipeBytes(() => new C(DEFLATE), body, body.byteLength - 1);
  if (!packed) return raw;
  const out = new Uint8Array(FIXED + packed.byteLength);
  out.set(raw.subarray(0, FIXED), 0);
  out[6] |= FLAG_DEFLATED;
  out.set(packed, FIXED);
  return out;
}

/**
 * The bundle of a container, or null when it is not one / is damaged / is of another format version. With `key` given (a string,
 * or null for "packed without one") the container must also have been packed with exactly that key.
 */
export async function unpackBundle(bytes: Uint8Array, key?: string | null): Promise<DerivedBundle | null> {
  try {
    return await decode(bytes, key);
  } catch {
    return null;
  }
}

async function decode(bytes: Uint8Array, key: string | null | undefined): Promise<DerivedBundle | null> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < FIXED) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, FIXED), flags = bytes[6];
  if (dv.getUint16(4, true) !== DERIVED_CONTAINER_VERSION || (flags & ~(FLAG_DEFLATED | FLAG_BIG_ENDIAN)) !== 0 || bytes[7] !== 0) return null;
  if (((flags & FLAG_BIG_ENDIAN) !== 0) !== HOST_BIG_ENDIAN) return null;
  const headerLength = dv.getUint32(8, true), total = dv.getUint32(12, true);
  if (headerLength > total || total > MAX_BODY) return null;
  let body: Uint8Array | null = bytes.subarray(FIXED);
  if (flags & FLAG_DEFLATED) {
    const D = (globalThis as StreamGlobals).DecompressionStream, deflated = body;
    body = typeof D === 'function' ? await pipeBytes(() => new D(DEFLATE), deflated, total) : null;
  }
  if (!body || body.byteLength !== total) return null;
  const sum = checksum(headerLength, body);
  for (let i = 0; i < 8; i++) if (bytes[16 + i] !== parseInt(sum.slice(2 * i, 2 * i + 2), 16)) return null;
  const header: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body.subarray(0, headerLength)));
  if (!isPlain(header) || !isPlain(header.meta) || !Array.isArray(header.arrays)) return null;
  if (header.key !== null && typeof header.key !== 'string') return null;
  if (key !== undefined && header.key !== key) return null;
  const start = align8(headerLength), arrays: Record<string, DerivedArray> = {};
  for (const d of header.arrays as unknown[]) {
    if (!isPlain(d)) return null;
    const {name, length, offset} = d, ctor = typeof d.type === 'string' ? TYPES.get(d.type) : undefined;
    if (!ctor || typeof name !== 'string' || !isCount(length) || !isCount(offset) || offset % 8 !== 0) return null;
    if (Object.prototype.hasOwnProperty.call(arrays, name)) return null;
    const from = start + offset, to = from + length * ctor.BYTES_PER_ELEMENT;
    if (to > total) return null;
    // defineProperty: a name like '__proto__' is an ordinary entry, as it was in the bundle that was packed.
    Object.defineProperty(arrays, name, {value: new ctor(body.slice(from, to).buffer, 0, length), enumerable: true, writable: true, configurable: true});
  }
  return {meta: header.meta, arrays};
}

// ---------------------------------------------------------------------------------------------
// The two backends: the index rows (`meta`) and the containers (`data`)

/** One `meta` row: everything the LRU needs, without the data. */
interface Row { key: string; bytes: number; lastUsed: number; created: number; tag: string; format: number }

/** Which rows to drop so that `key` (of `size` bytes) fits the budget. */
type EvictionPlan = (rows: Row[]) => Row[];

interface Store {
  readonly kind: 'indexeddb' | 'memory';
  rows(): Promise<Row[]>;
  read(key: string): Promise<{row: Row | null; data: unknown}>;
  /** Sets lastUsed on an existing row (nothing when the row is gone). */
  touch(key: string, lastUsed: number): Promise<void>;
  /** Drops what `plan` names, then stores the row and its data: all or nothing. Resolves the number of rows dropped. */
  write(row: Row, data: Uint8Array, plan: EvictionPlan): Promise<number>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
}

const META = 'meta', DATA = 'data', DB_VERSION = 1;
/** This many IndexedDB operations failing in a row (quota apart) end its use for the session. */
const IDB_FAILURE_LIMIT = 3;
const OPEN_TIMEOUT_MS = 3000, TX_TIMEOUT_MS = 10000;

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** A `meta` row as stored by this file (null for anything else; odd numbers read as 0, so such a row is evicted first). */
function rowOf(v: unknown): Row | null {
  if (!isPlain(v) || typeof v.key !== 'string') return null;
  return {key: v.key, bytes: Math.max(0, finite(v.bytes)), lastUsed: finite(v.lastUsed), created: finite(v.created), tag: typeof v.tag === 'string' ? v.tag : '', format: finite(v.format)};
}
const rowsOf = (list: unknown): Row[] => (Array.isArray(list) ? list.map(rowOf).filter((r): r is Row => r !== null) : []);

/** The least recently used rows that must go so that `key` with `size` bytes fits (`key`'s own old row is replaced, not counted). */
function evictionPlan(rows: Row[], key: string, size: number, maxEntries: number, maxBytes: number): Row[] {
  const others = rows.filter(r => r.key !== key).sort((p, q) => p.lastUsed - q.lastUsed || p.created - q.created || (p.key < q.key ? -1 : 1));
  let count = others.length + 1, total = size;
  for (const r of others) total += r.bytes;
  const out: Row[] = [];
  for (const r of others) {
    if (count <= maxEntries && total <= maxBytes) break;
    out.push(r); count--; total -= r.bytes;
  }
  return out;
}

class MemoryStore implements Store {
  readonly kind = 'memory';
  private readonly entries = new Map<string, {row: Row; data: Uint8Array}>();
  async rows(): Promise<Row[]> { return [...this.entries.values()].map(e => e.row); }
  async read(key: string): Promise<{row: Row | null; data: unknown}> {
    const e = this.entries.get(key);
    return e ? {row: e.row, data: e.data} : {row: null, data: undefined};
  }
  async touch(key: string, lastUsed: number): Promise<void> {
    const e = this.entries.get(key);
    if (e) e.row = {...e.row, lastUsed};
  }
  async write(row: Row, data: Uint8Array, plan: EvictionPlan): Promise<number> {
    const out = plan(await this.rows());
    for (const r of out) this.entries.delete(r.key);
    this.entries.set(row.key, {row, data});
    return out.length;
  }
  async remove(key: string): Promise<void> { this.entries.delete(key); }
  async clear(): Promise<void> { this.entries.clear(); }
  dispose(): void { this.entries.clear(); }
}

/** The database cannot serve this session any more (the cache moves to the in-memory backend). */
class DatabaseUnusable extends Error {
  constructor(why: string) { super(why); this.name = 'DatabaseUnusable'; }
}

function errorName(err: unknown): string {
  const name: unknown = err !== null && typeof err === 'object' ? (err as {name?: unknown}).name : undefined;
  return typeof name === 'string' && name ? name : 'Error';
}
function errorText(err: unknown): string {
  const message: unknown = err !== null && typeof err === 'object' ? (err as {message?: unknown}).message : err;
  const text = typeof message === 'string' && message ? `${errorName(err)}: ${message}` : errorName(err);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

class IdbStore implements Store {
  readonly kind = 'indexeddb';
  /** Set when the connection was closed under us. */
  private dead: string | null = null;

  /** `onDead` is told at once when the connection is lost (the cache reports the downgrade then, not at its next operation). */
  constructor(private readonly db: IDBDatabase, private readonly txTimeoutMs: number, onDead: (why: string) => void) {
    const lost = (why: string): void => { this.dead = why; onDead(why); };
    // Another tab wants a newer version or to delete the database: holding the connection would block it.
    db.onversionchange = () => { this.dispose(); lost('another tab is replacing the database'); };
    db.onclose = () => lost('the browser closed the database');
  }

  /**
   * One transaction. `body` places its requests at once or inside their success handlers (wrapped in `step`, so a throw there aborts
   * the transaction and rejects, instead of surfacing as an uncaught error); the promise settles when the transaction has
   * completed (with what `body` passed to `set`) or aborted (with the transaction's error).
   */
  private tx<T>(stores: string[], mode: IDBTransactionMode, initial: T, body: (t: IDBTransaction, set: (v: T) => void, step: (fn: () => void) => () => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.dead) { reject(new DatabaseUnusable(this.dead)); return; }
      let t: IDBTransaction;
      try {
        t = this.db.transaction(stores, mode);
      } catch (err) {
        reject(new DatabaseUnusable(`a transaction could not start (${errorText(err)})`));
        return;
      }
      let out = initial, settled = false, timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        fn();
      };
      const fail = (err: unknown): void => {
        try { t.abort(); } catch { /* already finished */ }
        settle(() => reject(err));
      };
      if (Number.isFinite(this.txTimeoutMs) && this.txTimeoutMs > 0) {
        timer = setTimeout(() => fail(new DatabaseUnusable(`a transaction did not finish in ${this.txTimeoutMs} ms`)), this.txTimeoutMs);
      }
      t.oncomplete = () => settle(() => resolve(out));
      // An abort that is not the browser refusing space may be the connection going away (its `close` event comes after the
      // aborts, if at all): starting a transaction tells — it throws on a closed connection, and is an empty one otherwise.
      t.onabort = () => settle(() => {
        const cause: unknown = t.error ?? new Error('the transaction was aborted');
        if (errorName(cause) !== 'QuotaExceededError') {
          try {
            this.db.transaction([META], 'readonly');
          } catch (err) {
            reject(new DatabaseUnusable(`the connection was lost (${errorText(err)})`));
            return;
          }
        }
        reject(cause);
      });
      const step = (fn: () => void) => (): void => { try { fn(); } catch (err) { fail(err); } };
      step(() => body(t, v => { out = v; }, step))();
    });
  }

  rows(): Promise<Row[]> {
    return this.tx<Row[]>([META], 'readonly', [], (t, set, step) => {
      const all = t.objectStore(META).getAll();
      all.onsuccess = step(() => set(rowsOf(all.result)));
    });
  }

  read(key: string): Promise<{row: Row | null; data: unknown}> {
    return this.tx<{row: Row | null; data: unknown}>([META, DATA], 'readonly', {row: null, data: undefined}, (t, set, step) => {
      // Requests of one transaction finish in the order they were placed: the row is there when the data arrives.
      const row = t.objectStore(META).get(key), data = t.objectStore(DATA).get(key);
      data.onsuccess = step(() => set({row: rowOf(row.result), data: data.result as unknown}));
    });
  }

  touch(key: string, lastUsed: number): Promise<void> {
    return this.tx<void>([META], 'readwrite', undefined, (t, _set, step) => {
      const meta = t.objectStore(META), got = meta.get(key);
      got.onsuccess = step(() => {
        const row = rowOf(got.result);
        if (row) meta.put({...row, lastUsed});
      });
    });
  }

  write(row: Row, data: Uint8Array, plan: EvictionPlan): Promise<number> {
    return this.tx<number>([META, DATA], 'readwrite', 0, (t, set, step) => {
      const meta = t.objectStore(META), store = t.objectStore(DATA), all = meta.getAll();
      all.onsuccess = step(() => {
        const out = plan(rowsOf(all.result));
        for (const r of out) { meta.delete(r.key); store.delete(r.key); }
        store.put(data, row.key);
        meta.put(row);
        set(out.length);
      });
    });
  }

  remove(key: string): Promise<void> {
    return this.tx<void>([META, DATA], 'readwrite', undefined, t => {
      t.objectStore(META).delete(key);
      t.objectStore(DATA).delete(key);
    });
  }

  clear(): Promise<void> {
    return this.tx<void>([META, DATA], 'readwrite', undefined, t => {
      t.objectStore(META).clear();
      t.objectStore(DATA).clear();
    });
  }

  dispose(): void {
    try { this.db.close(); } catch { /* already closed */ }
  }
}

// ---------------------------------------------------------------------------------------------
// The cache

const NOTHING: {row: Row | null; data: unknown} = {row: null, data: undefined};

class Cache implements DerivedCache {
  backend: 'indexeddb' | 'memory' | 'none' = 'none';
  reason: string | null = null;
  private store: Store | null = null;
  private readonly settled: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly counts = {hits: 0, misses: 0, puts: 0, failedPuts: 0, evictions: 0, corrupt: 0};
  private readonly warned = new Set<string>();
  /** IndexedDB operations that failed in a row (quota apart). */
  private failures = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private readonly compress: boolean;
  private readonly memoryFallback: boolean;
  private readonly txTimeoutMs: number;

  constructor(opts: DerivedCacheOptions) {
    const limit = (v: unknown, d: number): number => (typeof v === 'number' && !Number.isNaN(v) ? Math.floor(v) : d);
    this.maxEntries = limit(opts.maxEntries, DERIVED_CACHE_LIMITS.maxEntries);
    this.maxBytes = limit(opts.maxBytes, DERIVED_CACHE_LIMITS.maxBytes);
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.compress = opts.compress !== false;
    this.memoryFallback = opts.memoryFallback !== false;
    this.txTimeoutMs = opts.txTimeoutMs ?? TX_TIMEOUT_MS;
    if (!(this.maxEntries >= 1) || !(this.maxBytes >= 1)) {
      this.reason = 'the cache budget is zero';
      this.settled = Promise.resolve();
      return;
    }
    let factory: IDBFactory | null = null, why = 'IndexedDB is not available here';
    try {
      const f: unknown = opts.indexedDB === undefined ? (globalThis as {indexedDB?: unknown}).indexedDB : opts.indexedDB;
      if (f !== null && typeof f === 'object' && typeof (f as IDBFactory).open === 'function') factory = f as IDBFactory;
      else if (opts.indexedDB === null) why = 'IndexedDB was not requested';
    } catch (err) {
      // Some sandboxed / private contexts throw on the property read itself.
      why = `IndexedDB is blocked here (${errorText(err)})`;
    }
    if (!factory) {
      this.downgrade(why, false);
      this.settled = Promise.resolve();
      return;
    }
    this.backend = 'indexeddb';
    this.settled = this.open(factory, typeof opts.name === 'string' && opts.name ? opts.name : DERIVED_DB_NAME, opts.openTimeoutMs ?? OPEN_TIMEOUT_MS);
  }

  /** Opens the database; resolves (never rejects) with `store` set, or downgraded. */
  private open(factory: IDBFactory, name: string, timeoutMs: number): Promise<void> {
    return new Promise<void>(resolve => {
      let done = false, timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (db: IDBDatabase | null, why: string): void => {
        if (done) {
          // A success that arrives after the cache gave up (blocked, timed out): the connection is not kept.
          if (db) try { db.close(); } catch { /* nothing to close */ }
          return;
        }
        done = true;
        if (timer !== null) clearTimeout(timer);
        if (db) {
          const store: Store = new IdbStore(db, this.txTimeoutMs, lost => { if (this.store === store) this.downgrade(`IndexedDB stopped working (${lost})`, true); });
          this.store = store;
        } else this.downgrade(why, true);
        resolve();
      };
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(() => settle(null, `IndexedDB did not open within ${timeoutMs} ms`), timeoutMs);
      try {
        const req = factory.open(name, DB_VERSION);
        req.onupgradeneeded = () => {
          try {
            const db = req.result;
            if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, {keyPath: 'key'});
            if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
          } catch (err) {
            try { req.transaction?.abort(); } catch { /* the open fails by itself */ }
            settle(null, `IndexedDB could not be set up (${errorText(err)})`);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          let whole = false;
          try { whole = db.objectStoreNames.contains(META) && db.objectStoreNames.contains(DATA); } catch { /* not ours */ }
          if (whole) { settle(db, ''); return; }
          try { db.close(); } catch { /* nothing to close */ }
          settle(null, 'the IndexedDB database under this name is not the derived cache');
        };
        req.onerror = ev => {
          try { ev.preventDefault(); } catch { /* not a real event */ }
          settle(null, `IndexedDB could not be opened (${errorText(req.error)})`);
        };
        req.onblocked = () => settle(null, 'IndexedDB is blocked by another tab');
      } catch (err) {
        // open() threw (some private modes do), or what it returned is not a request.
        settle(null, `IndexedDB could not be opened (${errorText(err)})`);
      }
    });
  }

  private warn(kind: string, text: string, err?: unknown): void {
    if (this.warned.has(kind)) return;
    this.warned.add(kind);
    try { console.warn(`derived cache: ${text}${err === undefined ? '' : ` (${errorText(err)})`}`); } catch { /* no console */ }
  }

  /** Leaves IndexedDB for the session: the in-memory backend (or nothing) from here on. */
  private downgrade(why: string, warn: boolean): void {
    this.store?.dispose();
    this.store = this.memoryFallback ? new MemoryStore() : null;
    this.backend = this.store ? 'memory' : 'none';
    this.reason = why;
    if (warn) this.warn('downgrade', `${why}; ${this.store ? 'baked data is kept in memory for this session only' : 'nothing is cached'}`);
  }

  private budget(): number { return this.backend === 'memory' ? Math.min(this.maxBytes, DERIVED_MEMORY_MAX_BYTES) : this.maxBytes; }

  /** One operation after the ones before it; resolves `fallback()` if it throws (it should not). */
  private run<T>(op: () => Promise<T>, fallback: () => T): Promise<T> {
    const p = this.chain.then(() => this.settled).then(op).catch((err: unknown) => {
      this.warn('internal', 'an operation failed unexpectedly', err);
      return fallback();
    });
    this.chain = p;
    return p;
  }

  /**
   * One backend operation. When IndexedDB shows itself unusable the cache downgrades and the operation is repeated on the new
   * backend; any other failure is thrown to the caller, who turns it into a miss / a failed put.
   */
  private async io<T>(none: T, op: (s: Store) => Promise<T>): Promise<T> {
    const s = this.store;
    if (!s) return none;
    try {
      const r = await op(s);
      this.failures = 0;
      return r;
    } catch (err) {
      if (s.kind !== 'indexeddb') throw err;
      // The connection was lost while this ran (the cache has already moved on): once more, on the backend in use now.
      if (this.store !== s) return this.store ? op(this.store) : none;
      if (errorName(err) !== 'QuotaExceededError') this.failures++;
      if (!(err instanceof DatabaseUnusable) && this.failures < IDB_FAILURE_LIMIT) throw err;
      this.downgrade(`IndexedDB stopped working (${err instanceof DatabaseUnusable ? err.message : errorText(err)})`, true);
      return this.store ? op(this.store) : none;
    }
  }

  ready(): Promise<void> { return this.settled; }

  get(key: string): Promise<DerivedBundle | null> {
    return this.run<DerivedBundle | null>(async () => {
      let found = NOTHING;
      try {
        if (typeof key === 'string') found = await this.io(NOTHING, s => s.read(key));
      } catch (err) {
        this.warn('read', 'an entry could not be read', err);
      }
      if (!found.row && found.data === undefined) { this.counts.misses++; return null; }
      const bundle = found.row && found.data instanceof Uint8Array ? await unpackBundle(found.data, key) : null;
      if (!bundle) {
        this.counts.corrupt++; this.counts.misses++;
        this.warn('corrupt', `an unreadable entry was dropped (${found.row?.tag || key})`);
        try { await this.io(undefined, s => s.remove(key)); } catch (err) { this.warn('write', 'an entry could not be deleted', err); }
        return null;
      }
      this.counts.hits++;
      const t = this.now();
      // The hit stands even when its recency could not be refreshed.
      try { await this.io(undefined, s => s.touch(key, t)); } catch (err) { this.warn('write', 'an entry could not be refreshed', err); }
      return bundle;
    }, () => null);
  }

  put(key: string, bundle: DerivedBundle, tag = ''): Promise<boolean> {
    return this.run<boolean>(async () => {
      const refuse = (kind: string, text: string, err?: unknown): boolean => { this.counts.failedPuts++; this.warn(kind, text, err); return false; };
      if (!this.store || typeof key !== 'string') { this.counts.failedPuts++; return false; }
      let data: Uint8Array;
      try {
        data = await packBundle(bundle, this.compress, key);
      } catch (err) {
        return refuse('bundle', 'a bundle could not be packed', err);
      }
      const size = data.byteLength, label = typeof tag === 'string' ? tag.slice(0, 120) : '', t = this.now();
      try {
        const evicted = await this.io(-1, s => {
          // Read per attempt: after a downgrade the repeat runs against the in-memory budget.
          const maxBytes = this.budget();
          if (size > maxBytes) return Promise.resolve(-1);
          return s.write({key, bytes: size, lastUsed: t, created: t, tag: label, format: DERIVED_CONTAINER_VERSION}, data, rows => evictionPlan(rows, key, size, this.maxEntries, maxBytes));
        });
        if (evicted < 0) return refuse('oversize', `an entry of ${size} bytes is larger than the whole budget and was not stored`);
        this.counts.puts++; this.counts.evictions += evicted;
        return true;
      } catch (err) {
        return errorName(err) === 'QuotaExceededError'
          ? refuse('quota', 'the browser refused a write for lack of space; the entry was not stored', err)
          : refuse('write', 'an entry could not be written', err);
      }
    }, () => false);
  }

  delete(key: string): Promise<void> {
    return this.run<void>(async () => {
      try {
        if (typeof key === 'string') await this.io(undefined, s => s.remove(key));
      } catch (err) {
        this.warn('write', 'an entry could not be deleted', err);
      }
    }, () => undefined);
  }

  clear(): Promise<void> {
    return this.run<void>(async () => {
      try { await this.io(undefined, s => s.clear()); } catch (err) { this.warn('write', 'the cache could not be cleared', err); }
    }, () => undefined);
  }

  stats(): Promise<DerivedCacheStats> {
    const snapshot = (rows: Row[]): DerivedCacheStats => ({
      backend: this.backend, reason: this.reason, entries: rows.length, bytes: rows.reduce((sum, r) => sum + r.bytes, 0),
      maxEntries: this.maxEntries, maxBytes: this.budget(), ...this.counts,
    });
    return this.run<DerivedCacheStats>(async () => {
      let rows: Row[] = [];
      try { rows = await this.io<Row[]>([], s => s.rows()); } catch (err) { this.warn('read', 'the index could not be read', err); }
      return snapshot(rows);
    }, () => snapshot([]));
  }
}

/** Open the cache. Never throws: an unusable IndexedDB gives the in-memory backend with its reason. */
export function openDerivedCache(opts: DerivedCacheOptions = {}): DerivedCache {
  try {
    return new Cache(opts ?? {});
  } catch (err) {
    // Not reachable by design (the constructor guards what can throw): the in-memory backend, with the cause, if it ever is.
    const cache = new Cache({maxEntries: opts?.maxEntries, maxBytes: opts?.maxBytes, compress: opts?.compress, indexedDB: null});
    cache.reason = `the cache could not be set up (${errorText(err)})`;
    return cache;
  }
}
