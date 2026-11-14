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

export type HashView = Uint8Array | Int8Array | Uint8ClampedArray | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

export class ContentHasher {
  /** A typed array's contents (with its element type and length). */
  view(_a: HashView): this { throw new Error('ContentHasher: not implemented'); }
  /** A string (UTF-16 code units). */
  str(_s: string): this { throw new Error('ContentHasher: not implemented'); }
  /** One or more numbers (float64 each). */
  num(..._n: number[]): this { throw new Error('ContentHasher: not implemented'); }
  /** A boolean. */
  bool(_b: boolean): this { throw new Error('ContentHasher: not implemented'); }
  /** 16 lowercase hex characters. The hasher stays usable (the digest of what was fed so far). */
  digest(): string { throw new Error('ContentHasher: not implemented'); }
}

/** Digest of a list of typed arrays (convenience). */
export function hashViews(..._views: HashView[]): string { throw new Error('hashViews: not implemented'); }
