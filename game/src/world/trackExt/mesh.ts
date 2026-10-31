// Track 2 (Beyond the Station), lane VIS: a small triangle accumulator for the tunnel shell, caps and decals
// (per-vertex normals, UVs, optional vertex colours; winding fixed from the normals so every face is front-facing).

import * as THREE from 'three';

export type V3 = [number, number, number];

export class Acc {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  col: number[] | null = null;
  readonly idx: number[] = [];

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  /** One vertex; returns its index. `c` (rgb 0..1) switches the accumulator to vertex colours. */
  v(p: readonly number[], n: readonly number[], u: number, w: number, c?: readonly number[]): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, w);
    if (c) {
      if (!this.col) this.col = new Array(i * 3).fill(1);
      this.col.push(c[0], c[1], c[2]);
    } else if (this.col) this.col.push(1, 1, 1);
    return i;
  }

  /** Triangle, wound counter-clockwise as seen from the side its vertex normals point to. */
  tri(a: number, b: number, c: number): void {
    const P = this.pos, N = this.nor;
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const gx = e1[1] * e2[2] - e1[2] * e2[1], gy = e1[2] * e2[0] - e1[0] * e2[2], gz = e1[0] * e2[1] - e1[1] * e2[0];
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (Math.abs(gx) + Math.abs(gy) + Math.abs(gz) < 1e-12) return; // degenerate
    if (gx * nx + gy * ny + gz * nz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /** Quad a-b-c-d (perimeter order). */
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Convex polygon (perimeter order) as a fan. */
  fan(vs: readonly number[]): void {
    for (let k = 1; k + 1 < vs.length; k++) this.tri(vs[0], vs[k], vs[k + 1]);
  }

  /**
   * Oriented box: centre c, half extents h along the basis axes ax / ay / az (unit, right-handed). UVs are planar in
   * metres / uvScale on each face (non world-mapped materials keep real scale).
   */
  box(c: readonly number[], h: readonly number[], ax: readonly number[], ay: readonly number[], az: readonly number[], uvScale: {u: number; v: number} = {u: 1, v: 1}, col?: readonly number[]): void {
    const axes = [ax, ay, az];
    for (let k = 0; k < 3; k++) for (const sg of [-1, 1]) {
      const n = axes[k], a = axes[(k + 1) % 3], b = axes[(k + 2) % 3];
      const ha = h[(k + 1) % 3], hb = h[(k + 2) % 3], hn = h[k];
      const at = (sa: number, sb: number): V3 => [
        c[0] + n[0] * hn * sg + a[0] * ha * sa + b[0] * hb * sb,
        c[1] + n[1] * hn * sg + a[1] * ha * sa + b[1] * hb * sb,
        c[2] + n[2] * hn * sg + a[2] * ha * sa + b[2] * hb * sb,
      ];
      const nn: V3 = [n[0] * sg, n[1] * sg, n[2] * sg];
      // Vertical faces: u horizontal, v = height; horizontal faces: u / v along the box axes.
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => {
        const p = at(sa, sb);
        return this.v(p, nn, (sa * ha) / uvScale.u, (sb * hb) / uvScale.v, col);
      });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Right-handed horizontal basis from a travel direction: x = tangent, y = up, z = x × y. */
export function basisOf(tx: number, tz: number): {x: V3; y: V3; z: V3} {
  return {x: [tx, 0, tz], y: [0, 1, 0], z: [-tz, 0, tx]};
}

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of numbers / strings. */
export function hashOf(...v: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const x of v) {
    const s = String(x);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x9e; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
