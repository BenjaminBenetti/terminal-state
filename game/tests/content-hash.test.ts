// Task studio-baked-lighting-reflections-20261114-050258-01 (lane CACHE): the content hash (core/contentHash.ts) — its digests are
// cache keys and the derived container's checksum, so the algorithm is pinned twice: by literal digests, and by a second, slow
// implementation of the documented word stream and lanes (BigInt arithmetic, nothing shared with the source). Also: the tags and
// length prefixes that keep different inputs apart, views at any byteOffset, the byte-assembled path over big-endian memory, the
// number rules (float64, canonical NaN, -0), digest() in mid-stream, and a speed / allocation sanity check.
import {describe, expect, it} from 'vitest';
import {ContentHasher, hashViews, type HashView} from '../src/core/contentHash';

// ---------------------------------------------------------------------------------------------
// The reference: the word stream written out as a list, the lanes in BigInt.

const M = 0xffffffffn;
const rotl = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (32n - r))) & M;

function referenceDigest(words: number[]): string {
  let a = 0x811c9dc5n, b = 0x165667b1n;
  for (const word of words) {
    const w = BigInt(word >>> 0);
    let k = (w * 0xcc9e2d51n) & M; k = rotl(k, 15n); k = (k * 0x1b873593n) & M;
    a ^= k; a = rotl(a, 13n); a = (a * 5n + 0xe6546b64n) & M;
    b = (b + w * 0x85ebca77n) & M; b = rotl(b, 13n); b = (b * 0x9e3779b1n) & M;
  }
  const n = BigInt(words.length), lo = n & M, hi = n >> 32n;
  a = a ^ lo ^ ((hi * 0xcc9e2d51n) & M);
  a ^= a >> 16n; a = (a * 0x85ebca6bn) & M; a ^= a >> 13n; a = (a * 0xc2b2ae35n) & M; a ^= a >> 16n;
  b = (b + lo + hi * 0x9e3779b1n) & M;
  b ^= b >> 15n; b = (b * 0x85ebca77n) & M; b ^= b >> 13n; b = (b * 0xc2b2ae3dn) & M; b ^= b >> 16n;
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

const VIEW_TAG: Record<string, number> = {Uint8Array: 1, Int8Array: 2, Uint8ClampedArray: 3, Uint16Array: 4, Int16Array: 5, Uint32Array: 6, Int32Array: 7, Float32Array: 8, Float64Array: 9};
const head = (tag: number, length: number): number[] => [tag, length >>> 0, Math.floor(length / 2 ** 32)];
/** Bytes, four to a word, low byte first, zero-padded. */
function bytesToWords(bytes: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) out.push(((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24)) >>> 0);
  return out;
}
/** The little-endian bytes of a typed array's elements, element by element through a DataView (independent of the host's order). */
function littleEndianBytes(a: HashView): number[] {
  const size = a.BYTES_PER_ELEMENT, dv = new DataView(a.buffer, a.byteOffset, a.byteLength), out: number[] = [];
  const hostLittle = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  for (let i = 0; i < a.length; i++) {
    // The element's bits as the host holds them, then written low byte first.
    let bits = 0n;
    for (let j = 0; j < size; j++) bits |= BigInt(dv.getUint8(i * size + j)) << BigInt(8 * (hostLittle ? j : size - 1 - j));
    for (let j = 0; j < size; j++) out.push(Number((bits >> BigInt(8 * j)) & 0xffn));
  }
  return out;
}
const viewPart = (a: HashView): number[] => [...head(VIEW_TAG[a[Symbol.toStringTag]], a.length), ...bytesToWords(littleEndianBytes(a))];
function strPart(s: string): number[] {
  const out = head(16, s.length);
  for (let i = 0; i < s.length; i += 2) out.push((s.charCodeAt(i) | ((i + 1 < s.length ? s.charCodeAt(i + 1) : 0) << 16)) >>> 0);
  return out;
}
function numPart(...n: number[]): number[] {
  const out = head(17, n.length), dv = new DataView(new ArrayBuffer(8));
  for (const v of n) {
    if (Number.isNaN(v)) { out.push(0, 0x7ff80000); continue; }
    dv.setFloat64(0, v, true);
    out.push(dv.getUint32(0, true), dv.getUint32(4, true));
  }
  return out;
}
const boolPart = (b: boolean): number[] => [18, b ? 1 : 0];

const digestOf = (feed: (h: ContentHasher) => unknown): string => { const h = new ContentHasher(); feed(h); return h.digest(); };

/** A small deterministic generator for test data (not the game's). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
}

type Ctor = {new (length: number): HashView; new (buffer: ArrayBuffer, byteOffset?: number, length?: number): HashView; readonly name: string};
const CTORS: readonly Ctor[] = [Uint8Array, Int8Array, Uint8ClampedArray, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array];

/** `values` laid out the way a big-endian host would hold them, wrapped in the same typed array class (its elements read as nonsense here). */
function bigEndianImage(a: HashView): HashView {
  const size = a.BYTES_PER_ELEMENT, src = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), out = new Uint8Array(a.byteLength);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < size; j++) out[i * size + j] = src[i * size + (size - 1 - j)];
  return new (a.constructor as Ctor)(out.buffer, 0, a.length);
}

describe('content hash: pinned', () => {
  it('this host is little-endian (the fast path is what the suite exercises; the other path is walked over big-endian images below)', () => {
    expect(new Uint8Array(new Uint32Array([1]).buffer)[0]).toBe(1);
  });

  it('gives these exact digests (cache keys: a change here invalidates every stored bake and must be deliberate)', () => {
    expect(digestOf(() => {})).toBe('ab3e7c0b02cc5d05');
    expect(digestOf(h => h.str(''))).toBe('c5bbfa8d6f4a4cc3');
    expect(digestOf(h => h.str('terminal-state'))).toBe('8e91943578de563c');
    expect(digestOf(h => h.num(1, 2.5, -3))).toBe('2470a2b8b880c892');
    expect(digestOf(h => h.num(NaN))).toBe('cf85734db08f9d0f');
    expect(digestOf(h => h.bool(true).bool(false))).toBe('0854089e4800c008');
    expect(hashViews(new Float32Array([1, 2.5, -3, 1e-20]))).toBe('7710bee37c0f35f0');
    expect(hashViews(new Uint8Array([1, 2, 3, 4, 5]))).toBe('90d351fff165513a');
    expect(hashViews(new Uint16Array([65535, 1, 513]), new Float64Array([Math.PI, -0]))).toBe('1b3d338abd453ea7');
    expect(digestOf(h => h.str('lightfield').num(3, 96, 12, 64, 0.5).view(new Int16Array([-1, 2, -3])).bool(true).str('high'))).toBe('b68302ef64ed6375');
  });

  it('is 16 lowercase hex characters', () => {
    for (const d of [digestOf(() => {}), digestOf(h => h.str('x')), hashViews(new Uint8Array(1000))]) expect(d).toMatch(/^[0-9a-f]{16}$/);
  });

  it('matches the reference implementation of the documented stream for every part kind', () => {
    expect(digestOf(() => {})).toBe(referenceDigest([]));
    for (const s of ['', 'a', 'ab', 'abc', 'terminal-state', 'héllo wörld', '\u{1f687} train', '\ud800 lone surrogate']) expect(digestOf(h => h.str(s)), s).toBe(referenceDigest(strPart(s)));
    for (const n of [[], [0], [-0], [1], [1, 2.5, -3], [NaN], [Infinity, -Infinity], [Number.MAX_VALUE, Number.MIN_VALUE, 2 ** 53, 1e-320]]) expect(digestOf(h => h.num(...n)), String(n)).toBe(referenceDigest(numPart(...n)));
    for (const b of [true, false]) expect(digestOf(h => h.bool(b))).toBe(referenceDigest(boolPart(b)));
    const next = lcg(20261114);
    for (const ctor of CTORS) {
      for (let length = 0; length <= 9; length++) {
        const a = new ctor(length);
        const raw = new Uint8Array(a.buffer);
        for (let i = 0; i < raw.length; i++) raw[i] = next() >>> 24;
        expect(hashViews(a), `${ctor.name}[${length}]`).toBe(referenceDigest(viewPart(a)));
      }
    }
    const parts = [...strPart('lightfield'), ...numPart(3, 96, 12, 64, 0.5), ...viewPart(new Int16Array([-1, 2, -3])), ...boolPart(true), ...strPart('high')];
    expect(digestOf(h => h.str('lightfield').num(3, 96, 12, 64, 0.5).view(new Int16Array([-1, 2, -3])).bool(true).str('high'))).toBe(referenceDigest(parts));
  });
});

describe('content hash: parts stay apart', () => {
  it('length prefixes: the same characters or numbers split differently are different inputs', () => {
    expect(digestOf(h => h.str('ab').str('c'))).not.toBe(digestOf(h => h.str('a').str('bc')));
    expect(digestOf(h => h.str('abc'))).not.toBe(digestOf(h => h.str('ab').str('c')));
    expect(digestOf(h => h.str(''))).not.toBe(digestOf(() => {}));
    expect(digestOf(h => h.str('').str(''))).not.toBe(digestOf(h => h.str('')));
    expect(digestOf(h => h.num(1, 2))).not.toBe(digestOf(h => h.num(1).num(2)));
    expect(digestOf(h => h.num(1).num(2, 3))).not.toBe(digestOf(h => h.num(1, 2).num(3)));
    expect(digestOf(h => h.num())).not.toBe(digestOf(() => {}));
    const a = new Uint8Array([1, 2, 3, 4]);
    expect(hashViews(a.subarray(0, 3), a.subarray(3))).not.toBe(hashViews(a.subarray(0, 1), a.subarray(1)));
    expect(hashViews(a)).not.toBe(hashViews(a.subarray(0, 2), a.subarray(2)));
  });

  it('type tags: a Float32Array is not the Uint8Array of its bytes, and equal bytes under another element type differ', () => {
    const f = new Float32Array([1, 2.5, -3, 1e-20]);
    expect(hashViews(f)).not.toBe(hashViews(new Uint8Array(f.buffer)));
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const seen = new Set(CTORS.map(ctor => hashViews(new ctor(bytes.buffer.slice(0)))));
    expect(seen.size).toBe(CTORS.length);
  });

  it('empty arrays of different types differ from each other and from nothing', () => {
    const seen = new Set([digestOf(() => {}), ...CTORS.map(ctor => hashViews(new ctor(0)))]);
    expect(seen.size).toBe(CTORS.length + 1);
  });

  it('a string, a number and a boolean with the same face are different', () => {
    const seen = new Set([digestOf(h => h.str('1')), digestOf(h => h.num(1)), digestOf(h => h.bool(true)), hashViews(new Uint8Array([1])), digestOf(h => h.str('true'))]);
    expect(seen.size).toBe(5);
  });

  it('order matters, and one changed element changes the digest (both halves)', () => {
    expect(digestOf(h => h.str('a').num(1))).not.toBe(digestOf(h => h.num(1).str('a')));
    const a = new Float32Array(1024).fill(0.25), base = hashViews(a);
    for (const i of [0, 1, 511, 1023]) {
      const b = a.slice();
      b[i] = 0.2500001;
      const d = hashViews(b);
      expect(d.slice(0, 8), `lane A, element ${i}`).not.toBe(base.slice(0, 8));
      expect(d.slice(8), `lane B, element ${i}`).not.toBe(base.slice(8));
    }
  });

  it('refuses what it has no tag for', () => {
    const h = new ContentHasher();
    expect(() => h.view(new DataView(new ArrayBuffer(8)) as unknown as HashView)).toThrow(TypeError);
    expect(() => h.view(new BigInt64Array(2) as unknown as HashView)).toThrow(TypeError);
    expect(() => h.view([1, 2, 3] as unknown as HashView)).toThrow(TypeError);
    expect(() => h.view(new ArrayBuffer(8) as unknown as HashView)).toThrow(TypeError);
  });
});

describe('content hash: where the bytes live does not matter', () => {
  it('a view at any byteOffset and of any length equals its copy', () => {
    const next = lcg(7);
    const pool = new Uint8Array(64);
    for (let i = 0; i < pool.length; i++) pool[i] = next() >>> 24;
    for (let offset = 0; offset < 9; offset++) {
      for (let length = 0; length <= 13; length++) {
        const view = pool.subarray(offset, offset + length);
        expect(view.byteOffset).toBe(offset);
        expect(hashViews(view), `Uint8Array @${offset} +${length}`).toBe(hashViews(view.slice()));
        const signed = new Int8Array(pool.buffer, offset, length);
        expect(hashViews(signed), `Int8Array @${offset} +${length}`).toBe(hashViews(signed.slice()));
      }
    }
    const wide: [Ctor, number[]][] = [[Uint16Array, [0, 2, 4, 6, 10]], [Int16Array, [2, 6]], [Uint32Array, [0, 4, 12]], [Int32Array, [4]], [Float32Array, [0, 4, 20]], [Float64Array, [0, 8, 24]]];
    for (const [ctor, offsets] of wide) {
      for (const offset of offsets) {
        for (let length = 0; length <= 4; length++) {
          const view = new ctor(pool.buffer, offset, length);
          expect(hashViews(view), `${ctor.name} @${offset} +${length}`).toBe(hashViews(view.slice()));
        }
      }
    }
  });

  it('a Node Buffer (a Uint8Array inside a shared pool) equals a plain Uint8Array of the same bytes', () => {
    const buffer = Buffer.from('the same bytes, wherever they are kept');
    expect(hashViews(buffer)).toBe(hashViews(new Uint8Array(buffer)));
  });

  it('the byte-assembled path over big-endian memory gives the little-endian host\'s digest', () => {
    const next = lcg(99);
    for (const ctor of CTORS) {
      for (const length of [0, 1, 2, 3, 4, 5, 8, 33]) {
        const a = new ctor(length);
        const raw = new Uint8Array(a.buffer);
        for (let i = 0; i < raw.length; i++) raw[i] = next() >>> 24;
        const expected = hashViews(a);
        expect(new ContentHasher({hostLittleEndian: false}).view(bigEndianImage(a)).digest(), `${ctor.name}[${length}]`).toBe(expected);
        expect(new ContentHasher({hostLittleEndian: true}).view(a).digest()).toBe(expected);
      }
    }
    // Strings, numbers and booleans do not depend on the host's order at all.
    const feed = (h: ContentHasher): string => h.str('key').num(1.5, -0, NaN).bool(true).digest();
    expect(feed(new ContentHasher({hostLittleEndian: false}))).toBe(feed(new ContentHasher()));
  });
});

describe('content hash: numbers', () => {
  it('-0 and 0 differ', () => {
    expect(digestOf(h => h.num(-0))).not.toBe(digestOf(h => h.num(0)));
    expect(hashViews(new Float32Array([-0]))).not.toBe(hashViews(new Float32Array([0])));
  });

  it('every NaN given as a number is the one canonical NaN', () => {
    const odd = new Float64Array(new BigUint64Array([0x7ff0000000000001n, 0xfff8000000000123n]).buffer);
    const canonical = digestOf(h => h.num(NaN));
    for (const nan of [NaN, -NaN, 0 / 0, Number.NaN, odd[0], odd[1], Math.sqrt(-1)]) expect(digestOf(h => h.num(nan))).toBe(canonical);
    expect(canonical).toBe(referenceDigest([17, 1, 0, 0, 0x7ff80000]));
    expect(canonical).not.toBe(digestOf(h => h.num(Infinity)));
  });

  it('a number is its float64: an integer, its float and its exponent form are one input', () => {
    expect(digestOf(h => h.num(3))).toBe(digestOf(h => h.num(3.0)));
    expect(digestOf(h => h.num(1e3))).toBe(digestOf(h => h.num(1000)));
    expect(digestOf(h => h.num(0.1 + 0.2))).not.toBe(digestOf(h => h.num(0.3)));
  });

  it('a typed array is hashed by its bytes (a NaN payload in a view is not canonicalised)', () => {
    const one = new Float64Array(new BigUint64Array([0x7ff8000000000000n]).buffer), other = new Float64Array(new BigUint64Array([0x7ff8000000000001n]).buffer);
    expect(hashViews(one)).not.toBe(hashViews(other));
  });
});

describe('content hash: the hasher', () => {
  it('digest() in mid-stream does not disturb what follows, and repeats', () => {
    const h = new ContentHasher().str('a');
    const first = h.digest();
    expect(h.digest()).toBe(first);
    expect(first).toBe(digestOf(x => x.str('a')));
    h.num(2).view(new Uint8Array([9, 8, 7]));
    const second = h.digest();
    expect(second).not.toBe(first);
    expect(second).toBe(digestOf(x => x.str('a').num(2).view(new Uint8Array([9, 8, 7]))));
    expect(h.digest()).toBe(second);
  });

  it('chains, and two hashers do not share state', () => {
    const a = new ContentHasher(), b = new ContentHasher();
    expect(a.str('x')).toBe(a);
    expect(a.num(1)).toBe(a);
    expect(a.bool(true)).toBe(a);
    expect(a.view(new Uint8Array(3))).toBe(a);
    expect(b.digest()).toBe(digestOf(() => {}));
  });

  it('hashViews is view() over each array in order', () => {
    const u = new Uint8Array([1, 2, 3]), f = new Float64Array([4.5]);
    expect(hashViews(u, f)).toBe(digestOf(h => h.view(u).view(f)));
    expect(hashViews()).toBe(digestOf(() => {}));
  });

  it('does not change its input', () => {
    const a = new Float32Array([1, 2, 3]), copy = a.slice();
    hashViews(a);
    new ContentHasher({hostLittleEndian: false}).view(a);
    expect(a).toEqual(copy);
  });
});

describe('content hash: cost', () => {
  it('hashes a 20 MB grid quickly and without allocating in proportion to it', () => {
    const big = new Float32Array(5_000_000);
    for (let i = 0; i < big.length; i++) big[i] = (i % 977) * 0.125;
    hashViews(big.subarray(0, 200_000)); // warm
    let best = Infinity, digest = '';
    const before = process.memoryUsage().arrayBuffers;
    for (let run = 0; run < 3; run++) {
      const t = performance.now();
      digest = hashViews(big);
      best = Math.min(best, performance.now() - t);
    }
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(1 << 20);
    // An unaligned view of the same size takes the byte-assembled path.
    const shifted = new Uint8Array(big.byteLength + 1).subarray(1);
    shifted.set(new Uint8Array(big.buffer));
    const beforeSlow = process.memoryUsage().arrayBuffers;
    const t = performance.now();
    const slowDigest = hashViews(shifted);
    const slow = performance.now() - t;
    expect(process.memoryUsage().arrayBuffers - beforeSlow).toBeLessThan(1 << 20);
    expect(slowDigest).toBe(hashViews(new Uint8Array(big.buffer)));
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    // Measured ~30-40 ms on the studio pod; the bounds are an order of magnitude wider for a loaded CI runner.
    expect(best).toBeLessThan(600);
    expect(slow).toBeLessThan(1500);
  });
});
