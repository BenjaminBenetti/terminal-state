// Task studio-baked-lighting-reflections-20261114-050258-01 (lane CACHE): the derived-data cache (core/derivedCache.ts).
//  - The container: round trips for every array type, raw and deflated; the documented layout written by a second writer in this
//    file gives the same bytes; every kind of damage reads as null; what cannot be stored makes packBundle throw.
//  - The in-memory backend: LRU by entries and by bytes, a hit refreshes recency, a replaced key gives its bytes back, an entry
//    over the budget is refused.
//  - The IndexedDB backend over tests/helpers/fakeIndexedDb.ts: persistence across a "reload", LRU across it, damaged records are
//    misses and are deleted, a quota failure is one failed put and nothing else, every way IndexedDB can be unusable ends on the
//    in-memory backend with a reason and working operations. Nothing ever rejects.
//  - The cache stays out of the save: its sources do not touch the save's storage, and the save's sources do not know it.
// Recency runs on an injected clock, never on real time.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest';
import {ContentHasher} from '../src/core/contentHash';
import {
  DERIVED_CACHE_LIMITS, DERIVED_CONTAINER_VERSION, DERIVED_DB_NAME, DERIVED_MEMORY_MAX_BYTES, openDerivedCache, packBundle, unpackBundle,
  type DerivedArray, type DerivedBundle, type DerivedCache, type DerivedCacheOptions,
} from '../src/core/derivedCache';
import {FakeIndexedDb, type FakeDatabase, type FakeOpenRequest} from './helpers/fakeIndexedDb';

// ---------------------------------------------------------------------------------------------
// Helpers

const align8 = (n: number): number => Math.ceil(n / 8) * 8;
const bytesOf = (a: DerivedArray): number[] => Array.from(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

/** Test data only (not the game's generator). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
}

/** Every element type, with the values that are easy to lose (limits, -0, NaN, infinities, a denormal). */
function everyType(): Record<string, DerivedArray> {
  return {
    u8: new Uint8Array([0, 1, 127, 128, 255]),
    i8: new Int8Array([-128, -1, 0, 1, 127]),
    u16: new Uint16Array([0, 1, 65535]),
    i16: new Int16Array([-32768, -1, 32767]),
    u32: new Uint32Array([0, 1, 4294967295]),
    i32: new Int32Array([-2147483648, -1, 2147483647]),
    f32: new Float32Array([0, -0, 1.5, -2.25, Infinity, -Infinity, NaN, 1e-40]),
    f64: new Float64Array([Math.PI, -0, Number.MAX_VALUE, Number.MIN_VALUE, NaN]),
  };
}

/** The same content, byte for byte, in fresh exactly-sized arrays of the same types. */
function expectSameBundle(got: DerivedBundle | null, want: DerivedBundle): void {
  expect(got).not.toBeNull();
  if (!got) return;
  expect(got.meta).toEqual(want.meta);
  expect(Object.keys(got.arrays)).toEqual(Object.keys(want.arrays));
  for (const name of Object.keys(want.arrays)) {
    const g = got.arrays[name], w = want.arrays[name];
    expect(g.constructor, name).toBe(w.constructor);
    expect(g.length, name).toBe(w.length);
    expect(bytesOf(g), name).toEqual(bytesOf(w));
    expect(g.byteOffset, name).toBe(0);
    expect(g.buffer.byteLength, name).toBe(g.byteLength);
    expect(g.buffer, name).not.toBe(w.buffer);
  }
}

/** A small bundle that differs per `id`; `floats` sets its size. */
function bundle(id: number, floats = 64): DerivedBundle {
  const field = new Float32Array(floats), next = lcg(id + 1);
  for (let i = 0; i < floats; i++) field[i] = (next() >>> 8) / 65536;
  return {meta: {id, name: `station ${id}`, dims: [4, 4, floats / 16]}, arrays: {field, probes: new Uint8Array([id & 255, 1, 2, 3])}};
}

/** Compresses well: a short pattern repeated. */
function compressible(): DerivedBundle {
  const grid = new Uint16Array(50_000);
  for (let i = 0; i < grid.length; i++) grid[i] = (i % 17) * 3;
  return {meta: {kind: 'grid'}, arrays: {grid}};
}

/** The payload as packBundle lays it out: each array at the next multiple of 8. */
function payloadOf(...arrays: DerivedArray[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + align8(a.byteLength), 0));
  let at = 0;
  for (const a of arrays) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += align8(a.byteLength); }
  return out;
}

interface CraftOptions { magic?: string; version?: number; flags?: number; reserved?: number }
/**
 * A container written from the documented layout alone (derivedCache.ts header), checksum included: the second writer that pins
 * the format, and the way to make containers that are intact but wrong (a header packBundle would never write).
 */
function craft(header: unknown, payload: Uint8Array, o: CraftOptions = {}): Uint8Array {
  const json = header instanceof Uint8Array ? header : new TextEncoder().encode(typeof header === 'string' ? header : JSON.stringify(header));
  const start = align8(json.length), total = start + payload.length, version = o.version ?? 1;
  const out = new Uint8Array(24 + total), dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode(o.magic ?? 'TSDC'), 0);
  dv.setUint16(4, version, true);
  out[6] = o.flags ?? 0;
  out[7] = o.reserved ?? 0;
  dv.setUint32(8, json.length, true);
  dv.setUint32(12, total, true);
  out.set(json, 24);
  out.set(payload, 24 + start);
  const sum = new ContentHasher().num(version, json.length, total).view(out.subarray(24)).digest();
  for (let i = 0; i < 8; i++) out[16 + i] = parseInt(sum.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const flipped = (bytes: Uint8Array, at: number): Uint8Array => { const out = bytes.slice(); out[at] ^= 0xff; return out; };

/** A clock that moves one tick per reading: every put / hit gets its own, ordered time. */
function ticking(): {now: () => number; t: number} {
  const clock = {t: 0, now: (): number => ++clock.t};
  return clock;
}

const fakes: FakeIndexedDb[] = [];
function newFake(): FakeIndexedDb {
  const fake = new FakeIndexedDb();
  fakes.push(fake);
  return fake;
}
const keysOf = (fake: FakeIndexedDb, store: 'meta' | 'data', db = DERIVED_DB_NAME): string[] => [...fake.records(db, store).keys()].map(String).sort();

/** Opens a database on the fake directly (another page, another schema). */
function rawOpen(fake: FakeIndexedDb, name: string, version: number, upgrade: (req: FakeOpenRequest) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = fake.open(name, version);
    req.onupgradeneeded = () => upgrade(req);
    req.onsuccess = () => { (req.result as {close(): void}).close(); resolve(); };
    req.onerror = () => reject(req.error ?? new Error('open failed'));
  });
}

let warn: MockInstance<typeof console.warn>;
const warnings = (pattern: RegExp): number => warn.mock.calls.filter(call => pattern.test(String(call[0]))).length;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Nothing the cache registered on the fake may have thrown.
  for (const fake of fakes.splice(0)) expect(fake.handlerErrors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------

describe('derived container: round trip', () => {
  it('returns every array type, empty arrays and nested meta unchanged, raw and deflated', async () => {
    const b: DerivedBundle = {
      meta: {version: 3, name: 'st-12', nested: {list: [1, 'two', null, true, {deep: [[], {}]}], ok: false}, text: 'héllo \u{1f687}', empty: '', big: 2 ** 53, small: 1e-300},
      arrays: {...everyType(), none32: new Float32Array(0), none8: new Uint8Array(0), none64: new Float64Array(0)},
    };
    for (const compress of [false, true]) {
      const bytes = await packBundle(b, compress);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.buffer.byteLength, 'an exactly sized buffer (a structured clone stores the whole buffer)').toBe(bytes.byteLength);
      expectSameBundle(await unpackBundle(bytes), b);
    }
    expectSameBundle(await unpackBundle(await packBundle({meta: {}, arrays: {}})), {meta: {}, arrays: {}});
  });

  it('packs views by their content, wherever they sit in their buffer', async () => {
    const pool = new Uint8Array(64);
    for (let i = 0; i < pool.length; i++) pool[i] = i * 7;
    const views: DerivedBundle = {meta: {}, arrays: {odd: new Uint8Array(pool.buffer, 3, 5), floats: new Float32Array(pool.buffer, 12, 3), doubles: new Float64Array(pool.buffer, 40, 2), words: new Uint16Array(pool.buffer, 2, 7)}};
    const copies: DerivedBundle = {meta: {}, arrays: {odd: views.arrays.odd.slice(), floats: views.arrays.floats.slice(), doubles: views.arrays.doubles.slice(), words: views.arrays.words.slice()}};
    expect(Array.from(await packBundle(views, false))).toEqual(Array.from(await packBundle(copies, false)));
    expectSameBundle(await unpackBundle(await packBundle(views)), copies);
  });

  it('gives the caller its own copies, and leaves the container and the source alone', async () => {
    const source = bundle(5), bytes = await packBundle(source, false), before = bytes.slice();
    const first = await unpackBundle(bytes);
    (first!.arrays.field as Float32Array).fill(-1);
    (first!.meta as {id: number}).id = 99;
    expect(Array.from(bytes)).toEqual(Array.from(before));
    expectSameBundle(await unpackBundle(bytes), bundle(5));
    expectSameBundle(source, bundle(5));
  });

  it('keeps an array named __proto__ and meta keys of that name as plain entries', async () => {
    const arrays = Object.create(null) as Record<string, DerivedArray>;
    arrays['__proto__'] = new Uint8Array([7]);
    arrays.other = new Int8Array([-7]);
    const meta = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>;
    const got = await unpackBundle(await packBundle({meta, arrays}));
    expect(got).not.toBeNull();
    expect(Object.keys(got!.arrays)).toEqual(['__proto__', 'other']);
    expect(Object.getPrototypeOf(got!.arrays)).toBe(Object.prototype);
    expect(Array.from(Object.getOwnPropertyDescriptor(got!.arrays, '__proto__')!.value as Uint8Array)).toEqual([7]);
    expect(Object.keys(got!.meta)).toEqual(['__proto__', 'a']);
    expect(({} as {polluted?: boolean}).polluted).toBeUndefined();
  });
});

describe('derived container: compression', () => {
  it('deflates when that is smaller and says so in the flags; the fixed fields are otherwise the same', async () => {
    const b = compressible();
    const raw = await packBundle(b, false), deflated = await packBundle(b, true);
    expect(raw[6]).toBe(0);
    expect(deflated[6]).toBe(1);
    expect(deflated.byteLength).toBeLessThan(raw.byteLength / 4);
    expect(Array.from(deflated.subarray(0, 6))).toEqual(Array.from(raw.subarray(0, 6)));
    expect(Array.from(deflated.subarray(7, 24)), 'lengths and checksum describe the uncompressed body').toEqual(Array.from(raw.subarray(7, 24)));
    expectSameBundle(await unpackBundle(deflated), b);
    expectSameBundle(await unpackBundle(raw), b);
    expect((await packBundle(b))[6], 'compression is the default').toBe(1);
  });

  it('stores data that deflate cannot shrink raw', async () => {
    const noise = new Uint8Array(4096), next = lcg(3);
    for (let i = 0; i < noise.length; i++) noise[i] = next() >>> 24;
    const b: DerivedBundle = {meta: {}, arrays: {noise}};
    const packed = await packBundle(b, true);
    expect(packed[6]).toBe(0);
    expect(Array.from(packed)).toEqual(Array.from(await packBundle(b, false)));
  });

  it('packs raw on a host without the stream classes, and cannot read a deflated container without DecompressionStream', async () => {
    const b = compressible(), deflated = await packBundle(b, true);
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(unpackBundle(deflated)).resolves.toBeNull();
    expect((await packBundle(b, true))[6], 'nothing is written that this host could not read back').toBe(0);
    vi.unstubAllGlobals();
    vi.stubGlobal('CompressionStream', undefined);
    const raw = await packBundle(b, true);
    expect(raw[6]).toBe(0);
    expectSameBundle(await unpackBundle(raw), b);
    expectSameBundle(await unpackBundle(deflated), b);
    vi.unstubAllGlobals();
    vi.stubGlobal('CompressionStream', class { constructor() { throw new TypeError('unsupported format'); } });
    expect((await packBundle(b, true))[6], 'a stream class that refuses the format').toBe(0);
  });
});

describe('derived container: the format', () => {
  const a = new Uint8Array([1, 2, 3]), f = new Float32Array([1.5, -2]);
  const header = {key: 'k', meta: {n: 1}, arrays: [{name: 'a', type: 'u8', length: 3, offset: 0}, {name: 'f', type: 'f32', length: 2, offset: 8}]};
  const source: DerivedBundle = {meta: {n: 1}, arrays: {a, f}};

  it('is the documented layout: a second writer produces the same bytes', async () => {
    const packed = await packBundle(source, false, 'k'), crafted = craft(header, payloadOf(a, f));
    expect(Array.from(packed)).toEqual(Array.from(crafted));
    const json = JSON.stringify(header), dv = new DataView(packed.buffer);
    expect(new TextDecoder().decode(packed.subarray(0, 4))).toBe('TSDC');
    expect(dv.getUint16(4, true)).toBe(DERIVED_CONTAINER_VERSION);
    expect(DERIVED_CONTAINER_VERSION).toBe(1);
    expect(dv.getUint32(8, true)).toBe(json.length);
    expect(dv.getUint32(12, true)).toBe(align8(json.length) + 16);
    expect(packed.byteLength).toBe(24 + align8(json.length) + 16);
    expect(new TextDecoder().decode(packed.subarray(24, 24 + json.length))).toBe(json);
    expectSameBundle(await unpackBundle(crafted), source);
  });

  it('binds a container to the key it was packed with', async () => {
    const keyed = await packBundle(source, false, 'k'), bare = await packBundle(source, false);
    expectSameBundle(await unpackBundle(keyed), source);
    expectSameBundle(await unpackBundle(keyed, 'k'), source);
    await expect(unpackBundle(keyed, 'other')).resolves.toBeNull();
    await expect(unpackBundle(keyed, '')).resolves.toBeNull();
    await expect(unpackBundle(keyed, null)).resolves.toBeNull();
    expectSameBundle(await unpackBundle(bare), source);
    expectSameBundle(await unpackBundle(bare, null), source);
    await expect(unpackBundle(bare, 'k')).resolves.toBeNull();
    for (const compress of [true, false]) await expect(unpackBundle(await packBundle(compressible(), compress, 'a'), 'b')).resolves.toBeNull();
  });

  it('reads anything that is not a whole container of this version as null, without throwing', async () => {
    const payload = payloadOf(a, f), good = craft(header, payload);
    expect(await unpackBundle(good)).not.toBeNull();
    const long = new Uint8Array(good.length + 1);
    long.set(good);
    const withHeader = (h: unknown): Uint8Array => craft(h, payload);
    const desc = (d: Record<string, unknown>): Uint8Array => withHeader({key: null, meta: {}, arrays: [{name: 'a', type: 'u8', length: 3, offset: 0, ...d}]});
    expect(await unpackBundle(desc({})), 'the descriptor the cases below damage is itself valid').not.toBeNull();
    const cases: [string, Uint8Array][] = [
      ['nothing', new Uint8Array(0)],
      ['shorter than the fixed part', good.subarray(0, 23)],
      ['only the fixed part', good.subarray(0, 24)],
      ['cut inside the header', good.subarray(0, 40)],
      ['one byte short', good.subarray(0, good.length - 1)],
      ['one byte long', long],
      ['another magic', craft(header, payload, {magic: 'TSDX'})],
      ['a later format version', craft(header, payload, {version: DERIVED_CONTAINER_VERSION + 1})],
      ['format version 0', craft(header, payload, {version: 0})],
      ['an unknown flag', craft(header, payload, {flags: 4})],
      ['written by a big-endian host', craft(header, payload, {flags: 2})],
      ['the reserved byte set', craft(header, payload, {reserved: 1})],
      ['marked deflated but raw', craft(header, payload, {flags: 1})],
      ['a damaged payload byte', flipped(good, good.length - 3)],
      ['a damaged header byte', flipped(good, 30)],
      ['a damaged checksum byte', flipped(good, 17)],
      ['a damaged header length', flipped(good, 8)],
      ['a damaged body length', flipped(good, 12)],
      ['JSON cut short', withHeader('{"key":null,"meta":{},"arrays":[')],
      ['JSON that is a list', withHeader('[1,2]')],
      ['JSON that is null', withHeader('null')],
      ['JSON that is a string', withHeader('"x"')],
      ['a header that is not UTF-8', withHeader(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))],
      ['no meta', withHeader({key: null, arrays: []})],
      ['meta that is a list', withHeader({key: null, meta: [1], arrays: []})],
      ['meta that is a string', withHeader({key: null, meta: 'x', arrays: []})],
      ['meta that is null', withHeader({key: null, meta: null, arrays: []})],
      ['no arrays', withHeader({key: null, meta: {}})],
      ['arrays that are not a list', withHeader({key: null, meta: {}, arrays: {}})],
      ['no key field', withHeader({meta: {}, arrays: []})],
      ['a key that is a number', withHeader({key: 5, meta: {}, arrays: []})],
      ['a descriptor that is a number', withHeader({key: null, meta: {}, arrays: [5]})],
      ['a descriptor that is null', withHeader({key: null, meta: {}, arrays: [null]})],
      ['an unknown element type', desc({type: 'f16'})],
      ['a clamped element type', desc({type: 'u8c'})],
      ['an element type from the prototype', desc({type: 'constructor'})],
      ['an element type that is a number', desc({type: 8})],
      ['a length past the payload', desc({type: 'f32', length: 5})],
      ['an offset past the payload', desc({offset: 16, length: 1})],
      ['an offset that leaves too little', desc({type: 'f64', offset: 8, length: 2})],
      ['a negative length', desc({length: -1})],
      ['a fractional length', desc({length: 1.5})],
      ['an absurd length', desc({length: 2 ** 40})],
      ['a length that is a string', desc({length: '3'})],
      ['no length', desc({length: undefined})],
      ['an offset off the 8-byte grid', desc({offset: 4})],
      ['a negative offset', desc({offset: -8})],
      ['a name that is a number', desc({name: 7})],
      ['the same name twice', withHeader({key: null, meta: {}, arrays: [{name: 'a', type: 'u8', length: 1, offset: 0}, {name: 'a', type: 'u8', length: 1, offset: 8}]})],
    ];
    for (const [what, bytes] of cases) await expect(unpackBundle(bytes), what).resolves.toBeNull();
    for (const notBytes of [null, undefined, 'TSDC', 42, {}, [], good.buffer, new Float32Array(16)]) await expect(unpackBundle(notBytes as never), String(notBytes)).resolves.toBeNull();
  });

  it('reads a damaged deflated container as null', async () => {
    const good = await packBundle(compressible(), true, 'k');
    expect(good[6]).toBe(1);
    expect(await unpackBundle(good, 'k')).not.toBeNull();
    for (const cut of [24, 25, 31, Math.floor(good.length / 2), good.length - 1]) await expect(unpackBundle(good.subarray(0, cut)), `cut at ${cut}`).resolves.toBeNull();
    for (let at = 24; at < good.length; at += 37) await expect(unpackBundle(flipped(good, at)), `byte ${at}`).resolves.toBeNull();
    const junk = good.slice();
    junk.fill(0xab, 24);
    await expect(unpackBundle(junk)).resolves.toBeNull();
    await expect(unpackBundle(flipped(good, 12)), 'the stated length no longer matches').resolves.toBeNull();
    await expect(unpackBundle(flipped(good, 20)), 'the checksum no longer matches').resolves.toBeNull();
    // A stream that inflates to more than the container says is stopped, not collected.
    const larger = await packBundle({meta: {}, arrays: {zeros: new Uint8Array(4_000_000)}}, true);
    const lying = larger.slice();
    new DataView(lying.buffer).setUint32(12, 4096, true);
    await expect(unpackBundle(lying)).resolves.toBeNull();
  });
});

describe('derived container: what cannot be stored', () => {
  it('refuses meta that would not come back from JSON as it went in, naming the place', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse: unknown[] = [1, 2, 3];
    delete sparse[1];
    const bad: [string, Record<string, unknown>, RegExp][] = [
      ['NaN', {x: NaN}, /meta\.x is not a finite number/],
      ['Infinity deep inside', {a: {b: [1, Infinity]}}, /meta\.a\.b\[1\] is not a finite number/],
      ['undefined', {x: undefined}, /meta\.x is undefined/],
      ['a function', {f: () => 1}, /meta\.f is function/],
      ['a bigint', {n: 1n}, /meta\.n is bigint/],
      ['a symbol', {s: Symbol('s')}, /meta\.s is symbol/],
      ['a Date', {d: new Date(0)}, /meta\.d is not a plain object/],
      ['a Map', {m: new Map()}, /meta\.m is not a plain object/],
      ['a typed array', {a: new Uint8Array(2)}, /meta\.a is not a plain object/],
      ['a class instance', {c: new (class Point { x = 1; })()}, /meta\.c is not a plain object/],
      ['a hole in a list', {list: sparse}, /meta\.list\[1\] is a hole/],
      ['a reference to itself', cyclic, /nested too deeply/],
      ['a symbol key', {[Symbol('k')]: 1}, /meta is not a plain object/],
    ];
    for (const [what, meta, message] of bad) await expect(packBundle({meta, arrays: {}}), what).rejects.toThrow(message);
    for (const meta of [null, undefined, [1], 'x', 5, new Map()]) await expect(packBundle({meta: meta as never, arrays: {}})).rejects.toThrow(/meta must be a plain object/);
    await expect(packBundle(null as never)).rejects.toThrow(/derived bundle/);
  });

  it('refuses arrays that are not one of the eight types', async () => {
    for (const value of [[1, 2, 3], new DataView(new ArrayBuffer(8)), new Uint8ClampedArray(2), new BigInt64Array(1), new ArrayBuffer(8), null, 'bytes']) {
      await expect(packBundle({meta: {}, arrays: {a: value as never}})).rejects.toThrow(/arrays\.a is not a supported typed array/);
    }
    for (const arrays of [null, undefined, [new Uint8Array(1)], new Map()]) await expect(packBundle({meta: {}, arrays: arrays as never})).rejects.toThrow(/arrays must be a plain object/);
  });

  it('accepts -0 (it comes back as 0) and an object without a prototype', async () => {
    const meta = Object.assign(Object.create(null) as Record<string, unknown>, {z: -0, list: [-0]});
    const got = await unpackBundle(await packBundle({meta, arrays: {}}));
    expect(got!.meta).toEqual({z: 0, list: [0]});
  });
});

// ---------------------------------------------------------------------------------------------

describe('derived cache: the in-memory backend', () => {
  const open = (o: DerivedCacheOptions = {}): DerivedCache => openDerivedCache({indexedDB: null, now: ticking().now, compress: false, ...o});

  it('is what a host without IndexedDB gets, with the reason and without a warning', async () => {
    const asked = openDerivedCache({indexedDB: null});
    expect(asked.backend).toBe('memory');
    expect(asked.reason).toMatch(/not requested/);
    await expect(asked.ready()).resolves.toBeUndefined();
    expect(asked.backend).toBe('memory');
    expect((globalThis as {indexedDB?: unknown}).indexedDB, 'Node has no IndexedDB').toBeUndefined();
    const bare = openDerivedCache();
    expect(bare.backend).toBe('memory');
    expect(bare.reason).toMatch(/not available/);
    for (const notFactory of [{}, 42, 'idb', {open: 5}]) expect(openDerivedCache({indexedDB: notFactory}).backend).toBe('memory');
    expect(warn).not.toHaveBeenCalled();
    const stats = await bare.stats();
    expect(stats).toEqual({backend: 'memory', reason: bare.reason, entries: 0, bytes: 0, maxEntries: DERIVED_CACHE_LIMITS.maxEntries, maxBytes: DERIVED_MEMORY_MAX_BYTES, hits: 0, misses: 0, puts: 0, failedPuts: 0, evictions: 0, corrupt: 0});
    expect(DERIVED_CACHE_LIMITS).toEqual({maxEntries: 48, maxBytes: 96 * 1024 * 1024});
    expect(DERIVED_MEMORY_MAX_BYTES).toBe(48 * 1024 * 1024);
  });

  it('never holds more than its own cap, whatever maxBytes says, and keeps a smaller budget', async () => {
    expect((await open({maxBytes: 2 ** 31}).stats()).maxBytes).toBe(DERIVED_MEMORY_MAX_BYTES);
    expect((await open({maxBytes: 5000}).stats()).maxBytes).toBe(5000);
  });

  it('stores, returns copies, misses, deletes and clears', async () => {
    const cache = open(), source = bundle(1);
    await expect(cache.get('a')).resolves.toBeNull();
    await expect(cache.put('a', source, 'first')).resolves.toBe(true);
    (source.arrays.field as Float32Array).fill(123); // the caller's array changing later is not the cache's entry changing
    const got = await cache.get('a');
    expectSameBundle(got, bundle(1));
    (got!.arrays.field as Float32Array).fill(-1);
    expectSameBundle(await cache.get('a'), bundle(1));
    await expect(cache.put('b', bundle(2))).resolves.toBe(true);
    await expect(cache.delete('a')).resolves.toBeUndefined();
    await expect(cache.delete('never there')).resolves.toBeUndefined();
    await expect(cache.get('a')).resolves.toBeNull();
    expectSameBundle(await cache.get('b'), bundle(2));
    await expect(cache.clear()).resolves.toBeUndefined();
    await expect(cache.get('b')).resolves.toBeNull();
    expect(await cache.stats()).toMatchObject({entries: 0, bytes: 0, hits: 3, misses: 3, puts: 2, failedPuts: 0, evictions: 0, corrupt: 0});
  });

  it('evicts the least recently USED entry when the entry limit is reached (a hit refreshes, a miss does not)', async () => {
    const cache = open({maxEntries: 3});
    for (const [key, id] of [['a', 1], ['b', 2], ['c', 3]] as const) await expect(cache.put(key, bundle(id))).resolves.toBe(true);
    expect(await cache.get('a')).not.toBeNull();
    await expect(cache.get('zzz')).resolves.toBeNull();
    await expect(cache.put('d', bundle(4))).resolves.toBe(true);
    await expect(cache.get('b'), 'b was the least recently used').resolves.toBeNull();
    for (const key of ['a', 'c', 'd']) expect(await cache.get(key), key).not.toBeNull();
    expect(await cache.stats()).toMatchObject({entries: 3, evictions: 1, puts: 4});
    // Now c is the oldest use (a, c, d were just read in that order... a first): two more puts drop a then c.
    await cache.put('e', bundle(5));
    await cache.put('f', bundle(6));
    await expect(cache.get('a')).resolves.toBeNull();
    await expect(cache.get('c')).resolves.toBeNull();
    for (const key of ['d', 'e', 'f']) expect(await cache.get(key), key).not.toBeNull();
    expect(await cache.stats()).toMatchObject({entries: 3, evictions: 3});
  });

  it('evicts by bytes, counts stored bytes exactly, and gives a replaced key its bytes back', async () => {
    const size = (await packBundle(bundle(1), false, 'k1')).byteLength;
    for (const id of [2, 3, 4]) expect((await packBundle(bundle(id), false, `k${id}`)).byteLength).toBe(size);
    const cache = open({maxEntries: 100, maxBytes: 2 * size + 10});
    await cache.put('k1', bundle(1));
    await cache.put('k2', bundle(2));
    expect(await cache.stats()).toMatchObject({entries: 2, bytes: 2 * size, maxBytes: 2 * size + 10, evictions: 0});
    // Replacing k2 does not count its old bytes against the budget: nothing is evicted.
    await expect(cache.put('k2', bundle(2))).resolves.toBe(true);
    expect(await cache.stats()).toMatchObject({entries: 2, bytes: 2 * size, evictions: 0});
    expect(await cache.get('k1')).not.toBeNull();
    // A third entry does not fit: k2 (k1 was just read) goes.
    await expect(cache.put('k3', bundle(3))).resolves.toBe(true);
    await expect(cache.get('k2')).resolves.toBeNull();
    expect(await cache.stats()).toMatchObject({entries: 2, bytes: 2 * size, evictions: 1});
    // A larger replacement of k3 that only fits alone evicts k1 as well.
    const big = bundle(3, 160), bigSize = (await packBundle(big, false, 'k3')).byteLength;
    expect(bigSize).toBeGreaterThan(size + 10);
    expect(bigSize).toBeLessThanOrEqual(2 * size + 10);
    await expect(cache.put('k3', big)).resolves.toBe(true);
    expect(await cache.stats()).toMatchObject({entries: 1, bytes: bigSize, evictions: 2});
    expectSameBundle(await cache.get('k3'), big);
  });

  it('refuses an entry larger than the whole budget and keeps what it has', async () => {
    const size = (await packBundle(bundle(1), false, 'k1')).byteLength;
    const cache = open({maxBytes: size});
    await expect(cache.put('k1', bundle(1))).resolves.toBe(true);
    await expect(cache.put('k2', bundle(2, 4096))).resolves.toBe(false);
    await expect(cache.put('k1', bundle(1, 4096)), 'also as a replacement').resolves.toBe(false);
    expectSameBundle(await cache.get('k1'), bundle(1));
    expect(await cache.stats()).toMatchObject({entries: 1, bytes: size, puts: 1, failedPuts: 2, evictions: 0});
    expect(warnings(/larger than the whole budget/), 'warned once').toBe(1);
  });

  it('resolves false for a bundle that cannot be packed, and for keys that are not strings', async () => {
    const cache = open();
    await expect(cache.put('a', {meta: {x: NaN}, arrays: {}})).resolves.toBe(false);
    await expect(cache.put('a', {meta: {}, arrays: {x: [1, 2] as never}})).resolves.toBe(false);
    await expect(cache.put('a', null as never)).resolves.toBe(false);
    await expect(cache.put(5 as never, bundle(1))).resolves.toBe(false);
    await expect(cache.get(5 as never)).resolves.toBeNull();
    await expect(cache.get(undefined as never)).resolves.toBeNull();
    await expect(cache.delete(null as never)).resolves.toBeUndefined();
    expect(await cache.stats()).toMatchObject({entries: 0, puts: 0, failedPuts: 4, misses: 2});
    expect(warnings(/could not be packed/), 'one warning for the kind, not one per failure').toBe(1);
    expect(warn.mock.calls[0][0]).toMatch(/meta\.x is not a finite number/);
  });

  it('keeps its accounting under calls that are not awaited one by one', async () => {
    const cache = open({maxEntries: 4});
    const calls: Promise<unknown>[] = [];
    for (let i = 0; i < 40; i++) {
      calls.push(cache.put(`k${i % 9}`, bundle(i)));
      if (i % 3 === 0) calls.push(cache.get(`k${i % 5}`));
      if (i % 7 === 0) calls.push(cache.delete(`k${i % 4}`));
      if (i % 10 === 0) calls.push(cache.stats());
    }
    const results = await Promise.allSettled(calls);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    const stats = await cache.stats();
    expect(stats.entries).toBeLessThanOrEqual(4);
    expect(stats.puts).toBe(40);
    expect(stats.hits + stats.misses).toBe(14);
    // The newest four keys that were not deleted afterwards are the ones present.
    let present = 0;
    for (let k = 0; k < 9; k++) if (await cache.get(`k${k}`)) present++;
    expect(present).toBe(stats.entries);
  });

  it('compresses what it holds when the host can (default)', async () => {
    const cache = openDerivedCache({indexedDB: null}), raw = (await packBundle(compressible(), false, 'g')).byteLength;
    await expect(cache.put('g', compressible())).resolves.toBe(true);
    expect((await cache.stats()).bytes).toBeLessThan(raw / 4);
    expectSameBundle(await cache.get('g'), compressible());
  });

  it('is nothing at all with a zero budget, or without the in-memory fallback', async () => {
    for (const cache of [openDerivedCache({indexedDB: null, maxEntries: 0}), openDerivedCache({indexedDB: null, maxBytes: 0}), openDerivedCache({indexedDB: null, memoryFallback: false})]) {
      expect(cache.backend).toBe('none');
      expect(cache.reason).toBeTruthy();
      await expect(cache.ready()).resolves.toBeUndefined();
      await expect(cache.put('a', bundle(1))).resolves.toBe(false);
      await expect(cache.get('a')).resolves.toBeNull();
      await expect(cache.delete('a')).resolves.toBeUndefined();
      await expect(cache.clear()).resolves.toBeUndefined();
      expect(await cache.stats()).toMatchObject({backend: 'none', entries: 0, bytes: 0, puts: 0, failedPuts: 1, misses: 1});
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('derived cache: IndexedDB', () => {
  const NAME = DERIVED_DB_NAME;
  const open = (fake: FakeIndexedDb, o: DerivedCacheOptions = {}): DerivedCache => openDerivedCache({indexedDB: fake, now: ticking().now, compress: false, ...o});

  it('opens its own database with two stores; the backend is tentative until ready() and every operation waits for it', async () => {
    const fake = newFake(), cache = openDerivedCache({indexedDB: fake});
    expect(cache.backend).toBe('indexeddb');
    expect(cache.reason).toBeNull();
    expect(fake.databases(), 'open has not been answered yet').toEqual([]);
    const early = cache.put('early', bundle(1)); // not awaiting ready()
    await expect(cache.ready()).resolves.toBeUndefined();
    expect(cache.backend).toBe('indexeddb');
    expect(cache.reason).toBeNull();
    expect(fake.databases()).toEqual([{name: 'terminal-state.derived.v1', version: 1, stores: ['data', 'meta']}]);
    await expect(early).resolves.toBe(true);
    expect(keysOf(fake, 'data')).toEqual(['early']);
    expect(fake.opens).toBe(1);
    expect(await cache.stats()).toMatchObject({backend: 'indexeddb', reason: null, entries: 1, maxEntries: 48, maxBytes: 96 * 1024 * 1024});
    const named = openDerivedCache({indexedDB: fake, name: 'another.cache'});
    await named.ready();
    expect(fake.databases().map(d => d.name).sort()).toEqual(['another.cache', 'terminal-state.derived.v1']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses globalThis.indexedDB when no factory is given', async () => {
    const fake = newFake();
    vi.stubGlobal('indexedDB', fake);
    const cache = openDerivedCache();
    await cache.ready();
    expect(cache.backend).toBe('indexeddb');
    await expect(cache.put('a', bundle(1))).resolves.toBe(true);
    expect(keysOf(fake, 'meta')).toEqual(['a']);
  });

  it('keeps operations queued behind a slow open, in order', async () => {
    const fake = newFake();
    fake.openMode = 'hang';
    const cache = open(fake, {openTimeoutMs: 60_000});
    let settled = 0;
    const first = cache.put('a', bundle(1)), second = cache.get('a'), third = cache.stats();
    for (const p of [first, second, third]) void p.then(() => { settled++; });
    await fake.tick();
    expect(settled).toBe(0);
    fake.release();
    await expect(first).resolves.toBe(true);
    expectSameBundle(await second, bundle(1));
    expect(await third).toMatchObject({backend: 'indexeddb', entries: 1, hits: 1, puts: 1});
    expect(cache.backend).toBe('indexeddb');
  });

  it('stores one small index row and one container per entry', async () => {
    const fake = newFake(), cache = open(fake);
    await expect(cache.put('k1', bundle(1), 'Station 12 · standard')).resolves.toBe(true);
    const data = fake.records(NAME, 'data').get('k1') as Uint8Array;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.buffer.byteLength).toBe(data.byteLength);
    expect(fake.records(NAME, 'meta').get('k1')).toEqual({key: 'k1', bytes: data.byteLength, lastUsed: 1, created: 1, tag: 'Station 12 · standard', format: DERIVED_CONTAINER_VERSION});
    expect(Array.from(data)).toEqual(Array.from(await packBundle(bundle(1), false, 'k1')));
    expectSameBundle(await unpackBundle(data, 'k1'), bundle(1));
    expect(fake.log).toEqual([
      {db: NAME, store: 'meta', op: 'getAll'},
      {db: NAME, store: 'data', op: 'put', key: 'k1'},
      {db: NAME, store: 'meta', op: 'put', key: 'k1'},
    ]);
    await cache.put('k2', bundle(2), 'x'.repeat(500));
    expect((fake.records(NAME, 'meta').get('k2') as {tag: string}).tag.length, 'a long tag is cut').toBe(120);
    await cache.put('k3', bundle(3));
    expect((fake.records(NAME, 'meta').get('k3') as {tag: string}).tag).toBe('');
  });

  it('refreshes a hit with one index write and never rewrites the data; a miss writes nothing', async () => {
    const fake = newFake(), cache = open(fake);
    await cache.put('k1', bundle(1), 'tag');
    const stored = fake.records(NAME, 'data').get('k1'), row = fake.records(NAME, 'meta').get('k1') as Record<string, unknown>;
    let mark = fake.log.length;
    expectSameBundle(await cache.get('k1'), bundle(1));
    expect(fake.log.slice(mark)).toEqual([
      {db: NAME, store: 'meta', op: 'get', key: 'k1'},
      {db: NAME, store: 'data', op: 'get', key: 'k1'},
      {db: NAME, store: 'meta', op: 'get', key: 'k1'},
      {db: NAME, store: 'meta', op: 'put', key: 'k1'},
    ]);
    expect(fake.records(NAME, 'data').get('k1'), 'the stored container is the very same record').toBe(stored);
    expect(fake.records(NAME, 'meta').get('k1')).toEqual({...row, lastUsed: 2});
    mark = fake.log.length;
    await expect(cache.get('absent')).resolves.toBeNull();
    expect(fake.log.slice(mark)).toEqual([{db: NAME, store: 'meta', op: 'get', key: 'absent'}, {db: NAME, store: 'data', op: 'get', key: 'absent'}]);
    mark = fake.log.length;
    await cache.stats();
    expect(fake.log.slice(mark), 'stats reads the index only').toEqual([{db: NAME, store: 'meta', op: 'getAll'}]);
  });

  it('persists across a reload: a second cache on the same storage reads what the first stored', async () => {
    const fake = newFake(), clock = ticking();
    const first = open(fake, {now: clock.now});
    const whole: DerivedBundle = {meta: {name: 'st-3', nested: {a: [1, 2, {b: null}]}}, arrays: {...everyType(), none: new Float32Array(0)}};
    await expect(first.put('whole', whole, 'all types')).resolves.toBe(true);
    await expect(first.put('other', bundle(2))).resolves.toBe(true);
    const second = open(fake, {now: clock.now});
    expect(await second.stats()).toMatchObject({backend: 'indexeddb', entries: 2, hits: 0, puts: 0});
    expectSameBundle(await second.get('whole'), whole);
    expectSameBundle(await second.get('other'), bundle(2));
    expect(await second.stats(), 'the counters are this session\'s').toMatchObject({hits: 2, misses: 0, puts: 0});
    expect(fake.opens).toBe(2);
    // Also deflated.
    const third = openDerivedCache({indexedDB: fake, now: clock.now});
    await expect(third.put('grid', compressible())).resolves.toBe(true);
    expect((fake.records(NAME, 'data').get('grid') as Uint8Array)[6]).toBe(1);
    expectSameBundle(await openDerivedCache({indexedDB: fake, now: clock.now}).get('grid'), compressible());
  });

  it('keeps the LRU order across a reload', async () => {
    const fake = newFake(), clock = ticking();
    const first = open(fake, {now: clock.now, maxEntries: 3});
    for (const [key, id] of [['a', 1], ['b', 2], ['c', 3]] as const) await first.put(key, bundle(id));
    expect(await first.get('a')).not.toBeNull();
    const second = open(fake, {now: clock.now, maxEntries: 3});
    await expect(second.put('d', bundle(4))).resolves.toBe(true);
    expect(keysOf(fake, 'meta')).toEqual(['a', 'c', 'd']);
    expect(keysOf(fake, 'data')).toEqual(['a', 'c', 'd']);
    expect(await second.stats()).toMatchObject({entries: 3, evictions: 1, puts: 1});
    await second.put('e', bundle(5));
    expect(keysOf(fake, 'data'), 'c is now the least recently used').toEqual(['a', 'd', 'e']);
    // A reload with a smaller budget trims on its next put, not before.
    const third = open(fake, {now: clock.now, maxEntries: 2});
    expect((await third.stats()).entries).toBe(3);
    await third.put('f', bundle(6));
    expect(keysOf(fake, 'data')).toEqual(['e', 'f']);
    expect(keysOf(fake, 'meta')).toEqual(['e', 'f']);
  });

  it('evicts by bytes and gives a replaced key its bytes back', async () => {
    const fake = newFake(), size = (await packBundle(bundle(1), false, 'k1')).byteLength;
    const cache = open(fake, {maxEntries: 100, maxBytes: 2 * size + 10});
    await cache.put('k1', bundle(1));
    await cache.put('k2', bundle(2));
    await expect(cache.put('k2', bundle(2))).resolves.toBe(true);
    expect(keysOf(fake, 'data')).toEqual(['k1', 'k2']);
    expect(await cache.stats()).toMatchObject({entries: 2, bytes: 2 * size, evictions: 0});
    await cache.put('k3', bundle(3));
    expect(keysOf(fake, 'data')).toEqual(['k2', 'k3']);
    expect(await cache.stats()).toMatchObject({entries: 2, bytes: 2 * size, evictions: 1});
    await expect(cache.put('k4', bundle(4, 4096)), 'larger than the whole budget').resolves.toBe(false);
    expect(keysOf(fake, 'data')).toEqual(['k2', 'k3']);
    expect(await cache.stats()).toMatchObject({entries: 2, failedPuts: 1});
  });

  it('treats a damaged, truncated, foreign-version, wrong-key or half-missing record as a miss and deletes it', async () => {
    const fake = newFake(), cache = open(fake);
    const data = fake.records.bind(fake, NAME, 'data'), meta = fake.records.bind(fake, NAME, 'meta');
    const refill = async (): Promise<void> => {
      for (const key of ['k1', 'k2']) await expect(cache.put(key, bundle(key === 'k1' ? 1 : 2))).resolves.toBe(true);
    };
    const expectDropped = async (key: string, what: string): Promise<void> => {
      await expect(cache.get(key), what).resolves.toBeNull();
      expect(data().has(key), `${what}: data`).toBe(false);
      expect(meta().has(key), `${what}: index`).toBe(false);
    };
    await refill();
    fake.corrupt(NAME, 'data', 'k1', v => { (v as Uint8Array)[60] ^= 0xff; return v; });
    await expectDropped('k1', 'a damaged byte');
    expectSameBundle(await cache.get('k2'), bundle(2));

    await refill();
    fake.corrupt(NAME, 'data', 'k1', v => (v as Uint8Array).slice(0, 30));
    await expectDropped('k1', 'truncated');

    await refill();
    fake.corrupt(NAME, 'data', 'k1', v => { const bytes = v as Uint8Array; new DataView(bytes.buffer).setUint16(4, DERIVED_CONTAINER_VERSION + 1, true); return bytes; });
    fake.corrupt(NAME, 'meta', 'k1', v => ({...(v as object), format: DERIVED_CONTAINER_VERSION + 1}));
    await expectDropped('k1', 'another format version');

    await refill();
    data().set('k1', structuredClone(data().get('k2')));
    await expectDropped('k1', 'the record of another key');
    expectSameBundle(await cache.get('k2'), bundle(2));

    await refill();
    data().set('k1', 'not bytes');
    await expectDropped('k1', 'a string');
    await refill();
    data().set('k1', new Uint8Array(0));
    await expectDropped('k1', 'empty');
    await refill();
    data().set('k1', await packBundle(bundle(1), false));
    await expectDropped('k1', 'a container packed without a key');

    await refill();
    meta().delete('k1');
    await expectDropped('k1', 'data without its index row');
    await refill();
    data().delete('k1');
    await expectDropped('k1', 'an index row without its data');

    expect(await cache.stats()).toMatchObject({backend: 'indexeddb', corrupt: 9, misses: 9, hits: 2, entries: 1});
    expect(warnings(/unreadable entry/), 'one warning for the kind').toBe(1);
    // The key works again afterwards.
    await refill();
    expectSameBundle(await cache.get('k1'), bundle(1));
  });

  it('ignores index rows that are not its own when it counts and evicts', async () => {
    const fake = newFake(), cache = open(fake, {maxEntries: 2});
    await cache.put('a', bundle(1));
    fake.records(NAME, 'meta').set('junk', {key: 'junk', bytes: 'many', lastUsed: null});
    fake.records(NAME, 'meta').set(7, {key: 7, bytes: 5});
    expect(await cache.stats()).toMatchObject({entries: 2, bytes: (fake.records(NAME, 'data').get('a') as Uint8Array).byteLength});
    await cache.put('b', bundle(2));
    expect(keysOf(fake, 'data')).toEqual(['a', 'b']);
    expect(keysOf(fake, 'meta'), 'the odd string-keyed row counted as the oldest and went first').toEqual(['7', 'a', 'b']);
    await cache.clear();
    expect(fake.records(NAME, 'meta').size).toBe(0);
  });

  it('answers a quota failure with false and nothing else: no partial write, no eviction, no downgrade', async () => {
    const fake = newFake(), cache = open(fake, {maxEntries: 2});
    await cache.put('a', bundle(1));
    await cache.put('b', bundle(2));
    const before = {meta: new Map(fake.records(NAME, 'meta')), data: new Map(fake.records(NAME, 'data'))};
    fake.failNextPuts(1);
    await expect(cache.put('c', bundle(3))).resolves.toBe(false);
    expect(new Map(fake.records(NAME, 'meta')), 'the eviction planned by the failed put did not happen').toEqual(before.meta);
    expect(new Map(fake.records(NAME, 'data'))).toEqual(before.data);
    expect(cache.backend).toBe('indexeddb');
    expect(await cache.stats()).toMatchObject({backend: 'indexeddb', reason: null, entries: 2, puts: 2, failedPuts: 1, evictions: 0});
    expectSameBundle(await cache.get('a'), bundle(1));
    // Reported at the commit, as browsers usually do: the same.
    fake.failNextCommits(1);
    await expect(cache.put('c', bundle(3))).resolves.toBe(false);
    expect(keysOf(fake, 'data')).toEqual(['a', 'b']);
    // Afterwards everything works.
    await expect(cache.put('c', bundle(3))).resolves.toBe(true);
    expect(keysOf(fake, 'data'), 'b was the least recently used').toEqual(['a', 'c']);
    expectSameBundle(await cache.get('c'), bundle(3));
    // Quota failures never add up to a downgrade.
    fake.failNextPuts(6);
    for (let i = 0; i < 6; i++) await expect(cache.put(`q${i}`, bundle(i))).resolves.toBe(false);
    expect(cache.backend).toBe('indexeddb');
    await expect(cache.put('d', bundle(4))).resolves.toBe(true);
    expect(await cache.stats()).toMatchObject({backend: 'indexeddb', reason: null, entries: 2, puts: 4, failedPuts: 8, evictions: 2});
    expect(warnings(/lack of space/), 'one warning for the kind').toBe(1);
    expect(warnings(/in memory/)).toBe(0);
  });

  it('survives a failed refresh of a hit: the hit stands', async () => {
    const fake = newFake(), cache = open(fake);
    await cache.put('a', bundle(1));
    fake.failNextPuts(1);
    expectSameBundle(await cache.get('a'), bundle(1));
    expect((fake.records(NAME, 'meta').get('a') as {lastUsed: number}).lastUsed, 'recency was not refreshed').toBe(1);
    expect(await cache.stats()).toMatchObject({backend: 'indexeddb', hits: 1, misses: 0, entries: 1});
  });

  it('deletes from both stores and clears both stores', async () => {
    const fake = newFake(), cache = open(fake);
    for (const [key, id] of [['a', 1], ['b', 2], ['c', 3]] as const) await cache.put(key, bundle(id));
    await expect(cache.delete('b')).resolves.toBeUndefined();
    await expect(cache.delete('never there')).resolves.toBeUndefined();
    expect(keysOf(fake, 'meta')).toEqual(['a', 'c']);
    expect(keysOf(fake, 'data')).toEqual(['a', 'c']);
    await expect(cache.clear()).resolves.toBeUndefined();
    expect(fake.records(NAME, 'meta').size).toBe(0);
    expect(fake.records(NAME, 'data').size).toBe(0);
    expect(await cache.stats()).toMatchObject({backend: 'indexeddb', entries: 0, bytes: 0, puts: 3});
    await expect(cache.put('a', bundle(1))).resolves.toBe(true);
    expectSameBundle(await cache.get('a'), bundle(1));
    // The database itself stays (clear is not a schema change).
    expect(fake.databases()).toEqual([{name: NAME, version: 1, stores: ['data', 'meta']}]);
  });

  it('reports the right numbers', async () => {
    const fake = newFake(), cache = open(fake, {maxEntries: 2, maxBytes: 1 << 20});
    const sizes: Record<string, number> = {};
    for (const [key, id] of [['a', 1], ['b', 2], ['c', 3]] as const) sizes[key] = (await packBundle(bundle(id, 64 * id), false, key)).byteLength;
    expect(await cache.stats()).toEqual({backend: 'indexeddb', reason: null, entries: 0, bytes: 0, maxEntries: 2, maxBytes: 1 << 20, hits: 0, misses: 0, puts: 0, failedPuts: 0, evictions: 0, corrupt: 0});
    await cache.get('a');                           // miss
    await cache.put('a', bundle(1, 64));            // put
    await cache.put('b', bundle(2, 128));           // put
    await cache.get('a');                           // hit
    await cache.put('c', bundle(3, 192));           // put, evicts b
    await cache.get('b');                           // miss
    await cache.put('x', {meta: {bad: Infinity}, arrays: {}}); // failed put
    fake.corrupt(NAME, 'data', 'c', v => (v as Uint8Array).slice(0, 50));
    await cache.get('c');                           // corrupt + miss, deleted
    expect(await cache.stats()).toEqual({backend: 'indexeddb', reason: null, entries: 1, bytes: sizes.a, maxEntries: 2, maxBytes: 1 << 20, hits: 1, misses: 3, puts: 3, failedPuts: 1, evictions: 1, corrupt: 1});
  });

  it('lets two pages share the storage: each put decides on the index as it is then', async () => {
    const fake = newFake(), clock = ticking();
    const one = open(fake, {now: clock.now, maxEntries: 2}), two = open(fake, {now: clock.now, maxEntries: 2});
    await one.put('a', bundle(1));
    await one.put('b', bundle(2));
    expectSameBundle(await two.get('a'), bundle(1));
    await expect(two.put('c', bundle(3))).resolves.toBe(true);
    expect(keysOf(fake, 'data'), 'b: page two never stored it, but it was the least recently used').toEqual(['a', 'c']);
    await expect(one.get('b')).resolves.toBeNull();
    expectSameBundle(await one.get('c'), bundle(3));
    // Interleaved without waiting.
    const calls: Promise<unknown>[] = [];
    for (let i = 0; i < 12; i++) calls.push((i % 2 ? one : two).put(`k${i % 5}`, bundle(i)), (i % 2 ? two : one).get(`k${(i + 2) % 5}`));
    expect((await Promise.allSettled(calls)).every(r => r.status === 'fulfilled')).toBe(true);
    expect(keysOf(fake, 'meta')).toEqual(keysOf(fake, 'data'));
    expect(keysOf(fake, 'data').length).toBe(2);
  });

  it('keeps index and data in step under calls that are not awaited one by one', async () => {
    const fake = newFake(), size = (await packBundle(bundle(0), false, 'k0')).byteLength;
    const cache = open(fake, {maxEntries: 5, maxBytes: 4 * size + 5});
    const calls: Promise<unknown>[] = [];
    for (let i = 0; i < 36; i++) {
      calls.push(cache.put(`k${i % 8}`, bundle(i)));
      if (i % 3 === 0) calls.push(cache.get(`k${i % 5}`));
      if (i % 7 === 0) calls.push(cache.delete(`k${i % 4}`));
      if (i % 9 === 0) calls.push(cache.stats());
      if (i === 20) fake.failNextPuts(2);
    }
    expect((await Promise.allSettled(calls)).every(r => r.status === 'fulfilled')).toBe(true);
    const stats = await cache.stats();
    expect(keysOf(fake, 'meta')).toEqual(keysOf(fake, 'data'));
    expect(stats.entries).toBe(keysOf(fake, 'data').length);
    expect(stats.entries).toBeLessThanOrEqual(4);
    let bytes = 0;
    for (const [key, value] of fake.records(NAME, 'data')) {
      bytes += (value as Uint8Array).byteLength;
      expect((fake.records(NAME, 'meta').get(key) as {bytes: number}).bytes).toBe((value as Uint8Array).byteLength);
      expect(await unpackBundle(value as Uint8Array, String(key)), String(key)).not.toBeNull();
    }
    expect(stats.bytes).toBe(bytes);
    expect(stats.bytes).toBeLessThanOrEqual(4 * size + 5);
    expect(stats.puts + stats.failedPuts).toBe(36);
    expect(stats.backend).toBe('indexeddb');
  });
});

// ---------------------------------------------------------------------------------------------

describe('derived cache: when IndexedDB cannot be used', () => {
  const NAME = DERIVED_DB_NAME;
  const open = (fake: FakeIndexedDb, o: DerivedCacheOptions = {}): DerivedCache => openDerivedCache({indexedDB: fake, now: ticking().now, compress: false, ...o});

  /** The in-memory backend took over, says why, and works. */
  async function expectMemory(cache: DerivedCache, reason: RegExp): Promise<void> {
    await expect(cache.ready()).resolves.toBeUndefined();
    expect(cache.backend).toBe('memory');
    expect(cache.reason).toMatch(reason);
    await expect(cache.put('m1', bundle(1))).resolves.toBe(true);
    await expect(cache.put('m2', bundle(2))).resolves.toBe(true);
    expectSameBundle(await cache.get('m1'), bundle(1));
    await expect(cache.get('absent')).resolves.toBeNull();
    const stats = await cache.stats();
    expect(stats).toMatchObject({backend: 'memory', entries: 2, maxBytes: Math.min(DERIVED_CACHE_LIMITS.maxBytes, DERIVED_MEMORY_MAX_BYTES)});
    expect(stats.reason).toMatch(reason);
    await expect(cache.delete('m1')).resolves.toBeUndefined();
    await expect(cache.get('m1')).resolves.toBeNull();
    await expect(cache.clear()).resolves.toBeUndefined();
    expect((await cache.stats()).entries).toBe(0);
    expect(warnings(/kept in memory for this session only/), 'the downgrade is warned about once').toBe(1);
  }

  it('reading the global throws (a sandboxed context)', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); }});
    try {
      const cache = openDerivedCache({now: ticking().now});
      expect(cache.backend).toBe('memory');
      expect(cache.reason).toMatch(/blocked here \(SecurityError/);
      await expect(cache.put('a', bundle(1))).resolves.toBe(true);
      expectSameBundle(await cache.get('a'), bundle(1));
    } finally {
      delete (globalThis as {indexedDB?: unknown}).indexedDB;
    }
  });

  it('open() throws (some private modes)', async () => {
    const fake = newFake();
    fake.openMode = 'throw';
    await expectMemory(open(fake), /could not be opened \(SecurityError/);
    expect(fake.opens).toBe(1);
  });

  it('the open request fails', async () => {
    const fake = newFake();
    fake.openMode = 'error';
    fake.openErrorName = 'InvalidStateError';
    const cache = open(fake);
    expect(cache.backend, 'tentative').toBe('indexeddb');
    await expectMemory(cache, /could not be opened \(InvalidStateError/);
    expect(fake.databases()).toEqual([]);
  });

  it('the stored database is from a later version of the game', async () => {
    const fake = newFake();
    await rawOpen(fake, NAME, 2, req => { (req.result as {createObjectStore(name: string): unknown}).createObjectStore('future'); });
    await expectMemory(open(fake), /could not be opened \(VersionError/);
    expect(fake.databases()).toEqual([{name: NAME, version: 2, stores: ['future']}]);
  });

  it('the name holds some other database', async () => {
    const fake = newFake();
    await rawOpen(fake, NAME, 1, req => { (req.result as {createObjectStore(name: string): unknown}).createObjectStore('other'); });
    await expectMemory(open(fake), /is not the derived cache/);
    expect(fake.openConnections(), 'its connection was not kept').toBe(0);
    expect(fake.databases(), 'and the foreign database was left alone').toEqual([{name: NAME, version: 1, stores: ['other']}]);
  });

  it('the open is blocked by another tab; a success that comes later is not kept', async () => {
    const fake = newFake();
    fake.openMode = 'blocked';
    const cache = open(fake);
    await expectMemory(cache, /blocked by another tab/);
    fake.openMode = 'ok';
    fake.release();
    await fake.tick();
    expect(fake.openConnections()).toBe(0);
    expect(cache.backend).toBe('memory');
    await expect(cache.put('late', bundle(3))).resolves.toBe(true);
    expect(fake.records(NAME, 'data').size, 'still the in-memory backend').toBe(0);
  });

  it('the open does not settle in time; a success that comes later is not kept', async () => {
    const fake = newFake();
    fake.openMode = 'hang';
    const cache = open(fake, {openTimeoutMs: 15});
    expect(cache.backend, 'tentative').toBe('indexeddb');
    await expectMemory(cache, /did not open within 15 ms/);
    fake.release();
    await fake.tick();
    expect(fake.openConnections()).toBe(0);
    expect(cache.backend).toBe('memory');
  });

  it('the browser closes the connection in mid-session: reported at once, the session goes on in memory', async () => {
    const fake = newFake(), cache = open(fake);
    await expect(cache.put('a', bundle(1))).resolves.toBe(true);
    expect(cache.backend).toBe('indexeddb');
    fake.closeConnections();
    await fake.tick();
    expect(cache.backend).toBe('memory');
    expect(cache.reason).toMatch(/stopped working \(the browser closed the database\)/);
    await expect(cache.get('a'), 'what was on disk is out of reach: a miss, a re-bake').resolves.toBeNull();
    await expectMemory(cache, /stopped working/);
    expect(fake.records(NAME, 'data').has('a'), 'the stored entry is still there for the next session').toBe(true);
    expect(fake.records(NAME, 'data').has('m1')).toBe(false);
    // The next session opens the database again.
    const next = open(fake);
    expectSameBundle(await next.get('a'), bundle(1));
    expect(next.backend).toBe('indexeddb');
  });

  it('the connection is closed without notice: the operation that finds out is repeated in memory', async () => {
    const fake = newFake(), cache = open(fake);
    await cache.put('a', bundle(1));
    fake.closeConnections(false);
    await fake.tick();
    expect(cache.backend, 'nothing told the cache yet').toBe('indexeddb');
    await expect(cache.put('b', bundle(2))).resolves.toBe(true);
    expect(cache.backend).toBe('memory');
    expect(cache.reason).toMatch(/stopped working \(a transaction could not start \(InvalidStateError/);
    expectSameBundle(await cache.get('b'), bundle(2));
    expect(fake.records(NAME, 'data').has('b')).toBe(false);
    expect(await cache.stats()).toMatchObject({backend: 'memory', entries: 1, puts: 2, failedPuts: 0, hits: 1});
    expect(warnings(/kept in memory for this session only/)).toBe(1);
  });

  it('the connection is closed while a write is under way: that put lands in memory', async () => {
    const fake = newFake(), cache = open(fake);
    await cache.ready();
    const put = cache.put('a', bundle(1));
    await fake.tick(1);
    fake.closeConnections();
    await expect(put).resolves.toBe(true);
    expect(cache.backend).toBe('memory');
    expectSameBundle(await cache.get('a'), bundle(1));
    expect(fake.records(NAME, 'data').size).toBe(0);
    expect(fake.records(NAME, 'meta').size).toBe(0);
  });

  it('another tab asks for a version change: the connection is released and the session goes on in memory', async () => {
    const fake = newFake(), cache = open(fake);
    await cache.put('a', bundle(1));
    expect(fake.openConnections()).toBe(1);
    fake.versionChange();
    await fake.tick();
    expect(fake.openConnections(), 'not blocking the other tab').toBe(0);
    await expectMemory(cache, /another tab is replacing the database/);
  });

  it('a transaction never finishes', async () => {
    const fake = newFake(), cache = open(fake, {txTimeoutMs: 15});
    await cache.ready();
    fake.hangTransactions = true;
    await expect(cache.put('a', bundle(1))).resolves.toBe(true);
    expect(cache.backend).toBe('memory');
    expect(cache.reason).toMatch(/did not finish in 15 ms/);
    expectSameBundle(await cache.get('a'), bundle(1));
    expect(fake.openConnections(), 'the stuck connection was closed').toBe(0);
  });

  it('operations keep failing for another reason than quota', async () => {
    const fake = newFake(), cache = open(fake);
    await cache.put('a', bundle(1));
    // Two failures, then a success: the count starts again.
    fake.failNextCommits(2, 'UnknownError');
    await expect(cache.put('b', bundle(2))).resolves.toBe(false);
    await expect(cache.put('b', bundle(2))).resolves.toBe(false);
    await expect(cache.put('b', bundle(2))).resolves.toBe(true);
    expect(cache.backend).toBe('indexeddb');
    // Three in a row: IndexedDB is given up, and the third operation is repeated in memory.
    fake.failNextCommits(3, 'UnknownError');
    await expect(cache.put('c', bundle(3))).resolves.toBe(false);
    await expect(cache.get('a'), 'a read fails the same way').resolves.toBeNull();
    expect(cache.backend).toBe('indexeddb');
    await expect(cache.put('c', bundle(3))).resolves.toBe(true);
    expect(cache.backend).toBe('memory');
    expect(cache.reason).toMatch(/stopped working \(UnknownError/);
    expectSameBundle(await cache.get('c'), bundle(3));
    expect(fake.records(NAME, 'data').has('c')).toBe(false);
    expect(await cache.stats()).toMatchObject({backend: 'memory', entries: 1, failedPuts: 3});
    expect(warnings(/could not be written/), 'one warning for the kind').toBe(1);
  });

  it('without the in-memory fallback the cache is then nothing, and says so', async () => {
    const fake = newFake();
    fake.openMode = 'error';
    const cache = open(fake, {memoryFallback: false});
    await cache.ready();
    expect(cache.backend).toBe('none');
    expect(cache.reason).toMatch(/could not be opened/);
    await expect(cache.put('a', bundle(1))).resolves.toBe(false);
    await expect(cache.get('a')).resolves.toBeNull();
    await expect(cache.clear()).resolves.toBeUndefined();
    expect(await cache.stats()).toMatchObject({backend: 'none', entries: 0, failedPuts: 1, misses: 1});
    expect(warnings(/nothing is cached/)).toBe(1);
    // In mid-session.
    const live = newFake(), second = open(live, {memoryFallback: false});
    await expect(second.put('a', bundle(1))).resolves.toBe(true);
    live.closeConnections();
    await live.tick();
    expect(second.backend).toBe('none');
    await expect(second.put('b', bundle(2))).resolves.toBe(false);
    await expect(second.get('a')).resolves.toBeNull();
  });

  it('never throws from openDerivedCache and never rejects, whatever it is given', async () => {
    const hostile = {get open(): never { throw new Error('no'); }};
    for (const o of [{indexedDB: hostile}, {indexedDB: {open: () => ({})}, openTimeoutMs: 10}, {indexedDB: {open: () => null}}, {maxEntries: NaN, indexedDB: null}, {name: 5 as never, indexedDB: null}, null as never]) {
      let cache: DerivedCache | null = null;
      expect(() => { cache = openDerivedCache(o as DerivedCacheOptions); }).not.toThrow();
      await expect(cache!.ready()).resolves.toBeUndefined();
      await expect(cache!.put('a', bundle(1))).resolves.toBe(true);
      expectSameBundle(await cache!.get('a'), bundle(1));
      expect((await cache!.stats()).backend).toBe('memory');
    }
    // A clock that throws: the operation resolves its fallback.
    const broken = openDerivedCache({indexedDB: null, now: () => { throw new Error('no clock'); }});
    await expect(broken.put('a', bundle(1))).resolves.toBe(false);
    await expect(broken.get('a')).resolves.toBeNull();
    await expect(broken.stats()).resolves.toMatchObject({backend: 'memory'});
  });
});

// ---------------------------------------------------------------------------------------------

describe('the fake IndexedDB keeps the promises the adapter relies on', () => {
  const request = <T>(req: {onsuccess: unknown; onerror: unknown; result: unknown; error: unknown}): Promise<T> => new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
  async function database(fake: FakeIndexedDb): Promise<FakeDatabase> {
    const req = fake.open('t', 1);
    req.onupgradeneeded = () => {
      const db = req.result as FakeDatabase;
      db.createObjectStore('rows', {keyPath: 'key'});
      db.createObjectStore('blobs');
    };
    return request(req);
  }

  it('stores structured clones, answers later, and is atomic', async () => {
    const fake = newFake(), db = await database(fake);
    const bytes = new Uint8Array([1, 2, 3]);
    const tx = db.transaction(['rows', 'blobs'], 'readwrite');
    const put = tx.objectStore('blobs').put(bytes, 'a');
    expect(put.readyState, 'nothing is answered in the same task').toBe('pending');
    bytes[0] = 99;
    tx.objectStore('rows').put({key: 'a', n: 1});
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    const stored = fake.records('t', 'blobs').get('a') as Uint8Array;
    expect(Array.from(stored), 'cloned when the request was placed').toEqual([1, 2, 3]);
    expect(stored.buffer).not.toBe(bytes.buffer);
    const read = db.transaction('blobs');
    const got = await request<Uint8Array>(read.objectStore('blobs').get('a'));
    expect(got).not.toBe(stored);
    expect(Array.from(got)).toEqual([1, 2, 3]);
    // A failed put aborts everything the transaction did.
    fake.failNextPuts(1);
    const failing = db.transaction(['rows', 'blobs'], 'readwrite');
    failing.objectStore('rows').delete('a');
    failing.objectStore('blobs').put(new Uint8Array([4]), 'b');
    failing.objectStore('rows').put({key: 'c'});
    const outcome = await new Promise<string>(resolve => { failing.oncomplete = () => resolve('complete'); failing.onabort = () => resolve(`abort:${failing.error?.name}`); });
    expect(outcome).toBe('abort:QuotaExceededError');
    expect([...fake.records('t', 'rows').keys()]).toEqual(['a']);
    expect([...fake.records('t', 'blobs').keys()]).toEqual(['a']);
  });

  it('refuses requests outside an active transaction, writes in a read-only one, and work on a closed connection', async () => {
    const fake = newFake(), db = await database(fake);
    const tx = db.transaction('rows', 'readwrite'), store = tx.objectStore('rows');
    store.put({key: 'a'});
    await fake.tick(1);
    expect(() => store.put({key: 'late'})).toThrow(/not active/);
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); });
    expect(() => tx.objectStore('rows')).toThrow(/finished/);
    expect(() => db.transaction('rows').objectStore('rows').put({key: 'b'})).toThrow(/read-only/);
    expect(() => db.transaction('nope')).toThrow(/No object store/);
    expect(() => db.createObjectStore('late')).toThrow(/version change/);
    expect(() => db.transaction('rows', 'readwrite').objectStore('rows').put({nokey: 1})).toThrow(/valid key/);
    db.close();
    let name = '';
    try { db.transaction('rows'); } catch (err) { name = (err as DOMException).name; }
    expect(name).toBe('InvalidStateError');
  });

  it('runs requests in order and transactions one after another', async () => {
    const fake = newFake(), db = await database(fake);
    const order: string[] = [];
    const first = db.transaction('rows', 'readwrite'), second = db.transaction('rows', 'readwrite');
    const s1 = first.objectStore('rows'), s2 = second.objectStore('rows');
    s2.get('a').onsuccess = () => order.push('second:get');
    const put = s1.put({key: 'a', n: 1});
    put.onsuccess = () => { order.push('first:put'); s1.get('a').onsuccess = () => order.push('first:get'); };
    await Promise.all([first, second].map(tx => new Promise<void>(resolve => { tx.oncomplete = () => { order.push(tx === first ? 'first:complete' : 'second:complete'); resolve(); }; })));
    expect(order).toEqual(['first:put', 'first:get', 'first:complete', 'second:get', 'second:complete']);
  });
});

// ---------------------------------------------------------------------------------------------

describe('derived cache: outside the save', () => {
  const SRC = fileURLToPath(new URL('../src', import.meta.url));
  const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
  /** The code without its comments (the header states the rule in words; the rule is about what the code does). */
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it('its sources never touch the save\'s storage, the save modules or crypto', () => {
    for (const rel of ['core/derivedCache.ts', 'core/contentHash.ts']) {
      const text = code(read(rel));
      expect(text.length, rel).toBeGreaterThan(500);
      for (const word of ['localStorage', 'sessionStorage', 'STORAGE_KEYS', 'crypto']) expect(text.includes(word), `${rel}: ${word}`).toBe(false);
      const imports = [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1] ?? m[2]);
      for (const from of imports) expect(/save|settings|storage/i.test(from), `${rel} imports ${from}`).toBe(false);
      expect(imports, rel).toEqual(rel === 'core/derivedCache.ts' ? ['./contentHash'] : []);
      // tools/release/package-ci.mjs rejects string literals that start like a root-absolute path.
      expect(/['"`]\/[^\s/'"`]/.test(text), `${rel}: a root-absolute string literal`).toBe(false);
    }
  });

  it('the save\'s sources do not know the cache', () => {
    const files = walk(path.join(SRC, 'save'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const word of ['derivedCache', 'DERIVED_DB_NAME', 'DerivedCache', DERIVED_DB_NAME]) expect(text.includes(word), `${path.relative(SRC, file)}: ${word}`).toBe(false);
    }
  });
});
