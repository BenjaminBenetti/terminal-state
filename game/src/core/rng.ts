// Deterministic PRNG for the station generator. The same seed always yields the same station;
// a fresh seed is drawn from crypto on every page load / new run and is never persisted.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string, h = 2166136261): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private readonly f: () => number;
  constructor(readonly seed: number) {
    this.f = mulberry32(seed);
  }
  next(): number {
    return this.f();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.f();
  }
  /** Inclusive integer range. */
  int(a: number, b: number): number {
    return a + Math.floor(this.f() * (b - a + 1));
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.f() * arr.length)];
  }
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.f() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    return items[items.length - 1][0];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  fork(salt: string): Rng {
    return new Rng(hashString(salt, this.seed ^ 0x9e3779b9));
  }
}

/** New random seed per run. Uses crypto; nothing is stored. */
export function freshSeed(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] >>> 0;
}

export function seedToCode(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase().padStart(7, '0');
}

export function codeToSeed(code: string): number | null {
  const clean = code.trim().toLowerCase();
  if (!/^[0-9a-z]{1,7}$/.test(clean)) return null;
  const n = parseInt(clean, 36);
  return Number.isFinite(n) && n <= 0xffffffff ? n >>> 0 : null;
}
