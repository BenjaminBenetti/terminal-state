// Task studio-baked-lighting-reflections-20261114-050258-01 (lane CACHE): a small, fast, deterministic CONTENT HASH for derived-data
// keys (core/derivedCache.ts). Not cryptographic: it names bake inputs (grids, lights, palettes, parameters), nothing is trusted on it.
// CONTRACT (the lead's stub; lane CACHE implements it in this file):
//  - 64 bits of state from two independent 32-bit lanes, hex digest of 16 characters;
//  - byte-order independent of the platform (typed arrays are read as their little-endian bytes; every supported browser and Node
//    is little-endian, and a big-endian host must still produce the same digest);
//  - every part is length-prefixed and type-tagged, so ('ab', 'c') and ('a', 'bc') differ and a Float32Array never collides with
//    the Uint8Array of its bytes;
//  - numbers are hashed as float64; NaN is canonical; -0 and 0 differ;
//  - no allocation proportional to the input (a 20 MB grid hashes in a few tens of ms on one core).
//
// HOW (the digests are cache keys and the derived container's checksum: nothing below may change without changing every key; the
// pinned digests of tests/content-hash.test.ts fail first):
//  - Everything fed becomes a stream of 32-bit WORDS; both lanes take every word. Lane A is the MurmurHash3 (x86, 32-bit) round,
//    lane B the xxHash32 round, each with its own constants and its own final avalanche; the number of words is mixed into both at
//    the end. Either round is a bijection of its state for a fixed word and of the word for a fixed state, so two streams that
//    differ in one word never share a lane.
//  - A PART is a tag word, its length as two words (low, high), then its content padded with zero bytes to a whole word. The tag
//    and the length fix how many words follow, so a sequence of parts reads back in one way only (no two different sequences give
//    the same stream):
//      view(a)   tag = the element type (1..9, Uint8Array .. Float64Array; a Uint8ClampedArray is its own type), length = the
//                element count, content = the elements' little-endian bytes, four per word;
//      str(s)    tag 16, length = UTF-16 code units, content = the code units, two per word (low half first);
//      num(...n) tag 17, length = how many numbers this ONE call was given, content = each as float64 (low word, high word); a NaN
//                is 0x7ff8000000000000 whatever its payload. num(1, 2) is therefore not num(1).num(2): a spread list carries its
//                length. (A long list belongs in a typed array and view(): a spread call is bounded by the engine's argument limit.)
//      bool(b)   tag 18 and one word, 0 or 1.
//  - Speed: on a little-endian host a view whose byteOffset is a multiple of four is read through a Uint32Array over the same
//    buffer (one word a step; the views made here are two small objects, never a copy). Any other view — an odd byteOffset, or a
//    big-endian host — is assembled byte by byte from a Uint8Array over the buffer, mirroring the byte index inside each element
//    when the memory is big-endian: the same words, so the same digest. `hostLittleEndian` exists for the tests to walk that path
//    over buffers laid out the way a big-endian host would hold them.

export type HashView = Uint8Array | Int8Array | Uint8ClampedArray | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

/** Part tags. Never renumber. */
const VIEW_TAGS: ReadonlyMap<string, number> = new Map([
  ['Uint8Array', 1], ['Int8Array', 2], ['Uint8ClampedArray', 3], ['Uint16Array', 4], ['Int16Array', 5], ['Uint32Array', 6], ['Int32Array', 7],
  ['Float32Array', 8], ['Float64Array', 9],
]);
const TAG_STR = 16, TAG_NUM = 17, TAG_BOOL = 18;

// Lane A: MurmurHash3 x86_32 (c1, c2, the round's add, the two fmix multipliers). Lane B: xxHash32 (PRIME32_1, _2, _3).
const A_SEED = 0x811c9dc5, A_C1 = 0xcc9e2d51, A_C2 = 0x1b873593, A_ADD = 0xe6546b64, A_F1 = 0x85ebca6b, A_F2 = 0xc2b2ae35;
const B_SEED = 0x165667b1, B_P1 = 0x9e3779b1, B_P2 = 0x85ebca77, B_P3 = 0xc2b2ae3d;

/** Whether this host stores multi-byte typed-array elements low byte first (every supported one does). */
const HOST_LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** The byte-assembled path walks at most this many bytes per Uint8Array (a multiple of 8), so its integer index math stays in 31 bits. */
const SLOW_CHUNK = 1 << 30;
const TWO32 = 4294967296;
const F64 = new DataView(new ArrayBuffer(8));

export interface ContentHasherOptions {
  /** The byte order typed-array memory is taken to be in (default: this host's). Tests pass false with buffers laid out big-endian. */
  hostLittleEndian?: boolean;
}

export class ContentHasher {
  private a = A_SEED | 0;
  private b = B_SEED | 0;
  /** Words absorbed. */
  private n = 0;
  private readonly le: boolean;

  constructor(opts: ContentHasherOptions = {}) { this.le = opts.hostLittleEndian ?? HOST_LE; }

  /** One word into both lanes (the same two rounds are written out in the loops of bytes()). */
  private word(w: number): void {
    let k = Math.imul(w, A_C1); k = (k << 15) | (k >>> 17); k = Math.imul(k, A_C2);
    let a = this.a ^ k; a = (a << 13) | (a >>> 19); this.a = (Math.imul(a, 5) + A_ADD) | 0;
    let b = (this.b + Math.imul(w, B_P2)) | 0; b = (b << 13) | (b >>> 19); this.b = Math.imul(b, B_P1);
    this.n++;
  }

  private head(tag: number, length: number): void {
    this.word(tag); this.word(length >>> 0); this.word((length / TWO32) >>> 0);
  }

  /** `len` bytes of `buf` from `off`, holding elements of `size` bytes in this hasher's byte order, as their little-endian bytes. */
  private bytes(buf: ArrayBufferLike, off: number, len: number, size: number): void {
    const rem = len % 4, whole = len - rem, words = whole / 4;
    // The little-endian byte j of the stream is memory byte j when the memory is little-endian, else its mirror inside the element
    // (sizes are powers of two: j ^ (size - 1)).
    const flip = this.le ? 0 : size - 1;
    let a = this.a, b = this.b;
    if (this.le && HOST_LE && off % 4 === 0) {
      const u = new Uint32Array(buf, off, words);
      for (let i = 0; i < words; i++) {
        const w = u[i];
        let k = Math.imul(w, A_C1); k = (k << 15) | (k >>> 17); k = Math.imul(k, A_C2);
        a ^= k; a = (a << 13) | (a >>> 19); a = (Math.imul(a, 5) + A_ADD) | 0;
        b = (b + Math.imul(w, B_P2)) | 0; b = (b << 13) | (b >>> 19); b = Math.imul(b, B_P1);
      }
    } else {
      for (let base = 0; base < whole; base += SLOW_CHUNK) {
        const n = Math.min(SLOW_CHUNK, whole - base), u8 = new Uint8Array(buf, off + base, n);
        for (let j = 0; j < n; j += 4) {
          const w = u8[j ^ flip] | (u8[(j + 1) ^ flip] << 8) | (u8[(j + 2) ^ flip] << 16) | (u8[(j + 3) ^ flip] << 24);
          let k = Math.imul(w, A_C1); k = (k << 15) | (k >>> 17); k = Math.imul(k, A_C2);
          a ^= k; a = (a << 13) | (a >>> 19); a = (Math.imul(a, 5) + A_ADD) | 0;
          b = (b + Math.imul(w, B_P2)) | 0; b = (b << 13) | (b >>> 19); b = Math.imul(b, B_P1);
        }
      }
    }
    this.a = a; this.b = b; this.n += words;
    if (rem) {
      // The last one to three bytes (only 1- and 2-byte elements leave any), zero-padded to a word.
      const tail = new Uint8Array(buf, off + whole, rem);
      let w = 0;
      for (let j = 0; j < rem; j++) w |= tail[j ^ flip] << (8 * j);
      this.word(w);
    }
  }

  /** A typed array's contents (with its element type and length). */
  view(a: HashView): this {
    const tag = ArrayBuffer.isView(a) ? VIEW_TAGS.get((a as {[Symbol.toStringTag]: string})[Symbol.toStringTag]) : undefined;
    if (tag === undefined) throw new TypeError('ContentHasher.view: not a supported typed array');
    this.head(tag, a.length);
    this.bytes(a.buffer, a.byteOffset, a.byteLength, a.BYTES_PER_ELEMENT);
    return this;
  }

  /** A string (UTF-16 code units). */
  str(s: string): this {
    const n = s.length;
    this.head(TAG_STR, n);
    let i = 0;
    for (; i + 1 < n; i += 2) this.word(s.charCodeAt(i) | (s.charCodeAt(i + 1) << 16));
    if (i < n) this.word(s.charCodeAt(i));
    return this;
  }

  /** One or more numbers (float64 each). One call is one part: its count is hashed with it. */
  num(...n: number[]): this {
    this.head(TAG_NUM, n.length);
    for (let i = 0; i < n.length; i++) {
      const v = n[i];
      if (v !== v) { this.word(0); this.word(0x7ff80000); continue; }
      F64.setFloat64(0, v, true);
      this.word(F64.getUint32(0, true)); this.word(F64.getUint32(4, true));
    }
    return this;
  }

  /** A boolean. */
  bool(b: boolean): this {
    this.word(TAG_BOOL); this.word(b ? 1 : 0);
    return this;
  }

  /** 16 lowercase hex characters. The hasher stays usable (the digest of what was fed so far). */
  digest(): string {
    const lo = this.n >>> 0, hi = (this.n / TWO32) >>> 0;
    let a = this.a ^ lo ^ Math.imul(hi, A_C1);
    a ^= a >>> 16; a = Math.imul(a, A_F1); a ^= a >>> 13; a = Math.imul(a, A_F2); a ^= a >>> 16;
    let b = (this.b + lo + Math.imul(hi, B_P1)) | 0;
    b ^= b >>> 15; b = Math.imul(b, B_P2); b ^= b >>> 13; b = Math.imul(b, B_P3); b ^= b >>> 16;
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
}

/** Digest of a list of typed arrays (convenience). */
export function hashViews(...views: HashView[]): string {
  const h = new ContentHasher();
  for (const v of views) h.view(v);
  return h.digest();
}
