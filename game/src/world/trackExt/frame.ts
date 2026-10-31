// Track 2 (Beyond the Station), lane VIS: pure path maths for the track tunnels (no three.js).
//
// A TrackTunnel (gen/trackExt/types.ts) is a smooth centreline polyline starting ON a bed end face. TunnelFrame gives
// arc length, tangents and the LEFT normal at every sample, projects world points to (s, lat) tunnel coordinates, and
// answers "is this point inside the tunnel corridor" for the builder's suppression of grid geometry.
//
// Convention (DESIGN §1 "lateral offsets (m, +left)", "side +1 = left of travel"): with Y up and the game's camera
// convention (yaw 0 looks along -Z, +X is to its right), the left of a travel direction (tx, tz) is (tz, -tx): travelling
// +X, left is -Z. `leftSign` flips that for a tunnel whose data was written with the mirrored convention (detected from
// its door rects / rails at the mouth; see resolveLeftSign) so presentation always matches the grid.

import type {TrackTunnel} from '../../gen/trackExt/types';

export interface PathSample { x: number; z: number; s: number; tx: number; tz: number; lx: number; lz: number }

/** Tunnel-local coordinates of a world point: arc length (extended linearly beyond both ends) and signed lateral offset (+left). */
export interface TunnelCoord { s: number; lat: number }

export class TunnelFrame {
  readonly samples: PathSample[];
  readonly length: number;
  readonly half: number;
  /** +1: left = (tz, -tx) (the documented convention); -1: the mirrored data convention. */
  readonly leftSign: 1 | -1;
  /** Axis-aligned bounds of the corridor (walls included) with a margin. */
  readonly bounds: {x0: number; z0: number; x1: number; z1: number};
  private readonly segs: Float64Array; // per segment: ax, az, dx, dz, len, s0

  constructor(readonly tunnel: TrackTunnel, leftSign: 1 | -1 = 1) {
    this.leftSign = leftSign;
    this.half = tunnel.width / 2;
    const pts = dedupe(tunnel.path);
    if (pts.length < 2) throw new Error(`track tunnel ${tunnel.id}: path needs >= 2 distinct points`);
    const n = pts.length;
    this.segs = new Float64Array((n - 1) * 6);
    let s = 0;
    for (let i = 0; i + 1 < n; i++) {
      const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z, len = Math.hypot(dx, dz);
      this.segs.set([pts[i].x, pts[i].z, dx / len, dz / len, len, s], i * 6);
      s += len;
    }
    this.length = s;
    this.samples = pts.map((p, i) => {
      // Vertex tangent: the mean of the adjacent segment directions (exact on circular arcs with uniform spacing).
      const a = Math.max(0, i - 1), b = Math.min(n - 2, i);
      let tx = this.segs[a * 6 + 2] + this.segs[b * 6 + 2], tz = this.segs[a * 6 + 3] + this.segs[b * 6 + 3];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      return {x: p.x, z: p.z, s: i === 0 ? 0 : this.segs[(i - 1) * 6 + 5] + this.segs[(i - 1) * 6 + 4], tx, tz, lx: leftSign * tz, lz: -leftSign * tx};
    });
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    const m = this.half + 1.5;
    this.bounds = {x0: x0 - m, z0: z0 - m, x1: x1 + m, z1: z1 + m};
  }

  get first(): PathSample { return this.samples[0]; }
  get last(): PathSample { return this.samples[this.samples.length - 1]; }

  /** Left normal of a travel direction under this tunnel's convention. */
  leftOf(tx: number, tz: number): [number, number] { return [this.leftSign * tz, -this.leftSign * tx]; }

  /** Point / tangent / left normal at arc length s (linear between samples; the end tangents extend beyond both ends). */
  at(s: number): PathSample {
    const S = this.samples;
    if (s <= 0) {
      const F = S[0];
      return {...F, x: F.x + F.tx * s, z: F.z + F.tz * s, s};
    }
    if (s >= this.length) {
      const L = S[S.length - 1];
      const d = s - this.length;
      return {...L, x: L.x + L.tx * d, z: L.z + L.tz * d, s};
    }
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; }
    const a = S[lo], b = S[hi], u = (s - a.s) / Math.max(1e-9, b.s - a.s);
    let tx = a.tx + (b.tx - a.tx) * u, tz = a.tz + (b.tz - a.tz) * u;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    return {x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, s, tx, tz, lx: this.leftSign * tz, lz: -this.leftSign * tx};
  }

  /** World point at (s, lat). */
  point(s: number, lat: number): [number, number] {
    const p = this.at(s);
    return [p.x + p.lx * lat, p.z + p.lz * lat];
  }

  /**
   * Nearest-point projection onto the centreline. Beyond the first / last sample the end segments extend linearly, so
   * s < 0 behind the mouth and s > length past the end.
   */
  project(x: number, z: number): TunnelCoord {
    const g = this.segs, ns = g.length / 6;
    let best = Infinity, bs = 0, bl = 0;
    for (let k = 0; k < ns; k++) {
      const o = k * 6, ax = g[o], az = g[o + 1], dx = g[o + 2], dz = g[o + 3], len = g[o + 4];
      let u = (x - ax) * dx + (z - az) * dz;
      if (k > 0 && u < 0) u = 0;
      if (k < ns - 1 && u > len) u = len;
      const px = ax + dx * u, pz = az + dz * u;
      const ex = x - px, ez = z - pz, d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bs = g[o + 5] + u;
        bl = (ex * dz - ez * dx) * this.leftSign; // dot(e, left) with left = leftSign * (dz, -dx)
      }
    }
    return {s: bs, lat: bl};
  }

  /** Inside the walled corridor: 0 - eps <= s <= length + eps and |lat| < half - margin. */
  inside(x: number, z: number, margin = 0, eps = 0.01): boolean {
    const b = this.bounds;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return false;
    const c = this.project(x, z);
    return c.s >= -eps && c.s <= this.length + eps && Math.abs(c.lat) < this.half - margin;
  }

  /** Offset polyline at lateral `lat` over [s0, s1] (samples inside plus both ends), mitred: arc length along it too. */
  offset(lat: number, s0 = 0, s1 = this.length): {x: number; z: number; s: number; w: number; nx: number; nz: number}[] {
    const out: {x: number; z: number; s: number; w: number; nx: number; nz: number}[] = [];
    // Mitre k: the vertex normal scaled so both adjacent segments stay `lat` away (tiny on 0.5 m samples).
    const push = (p: PathSample, k = 1) => out.push({x: p.x + p.lx * lat / k, z: p.z + p.lz * lat / k, s: p.s, w: 0, nx: p.lx, nz: p.lz});
    push(this.at(s0));
    this.samples.forEach((p, i) => { if (p.s > s0 + 1e-6 && p.s < s1 - 1e-6) push(p, Math.max(0.5, this.mitre(i))); });
    push(this.at(s1));
    for (let i = 1; i < out.length; i++) out[i].w = out[i - 1].w + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    return out;
  }

  /** cos of half the turn at sample i (1 on straights and at the ends). */
  private mitre(i: number): number {
    const S = this.samples;
    if (i <= 0 || i >= S.length - 1) return 1;
    const o = (i - 1) * 6;
    return S[i].tx * this.segs[o + 2] + S[i].tz * this.segs[o + 3];
  }

  /** Arc lengths where the path direction changes (> ~0.05°): straight runs between them may be drawn as one piece. */
  breaks(): number[] {
    const S = this.samples, out = [0];
    for (let i = 1; i + 1 < S.length; i++) {
      const a = (i - 1) * 6, b = i * 6;
      const c = this.segs[a + 2] * this.segs[b + 2] + this.segs[a + 3] * this.segs[b + 3];
      if (c < 0.9999996) out.push(S[i].s);
    }
    out.push(this.length);
    return out;
  }
}

function dedupe(path: readonly {x: number; z: number}[]): {x: number; z: number}[] {
  const out: {x: number; z: number}[] = [];
  for (const p of path) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 1e-6) out.push({x: p.x, z: p.z});
  }
  return out;
}

/** Render sample positions along [0, length]: every direction change (curves keep all samples), plus `extra` cut points and chunk splits. */
export function renderStations(f: TunnelFrame, extra: readonly number[] = [], chunk = 48): number[] {
  const set = new Set<number>();
  for (const s of f.breaks()) set.add(round6(s));
  for (const s of extra) if (s > 0 && s < f.length) set.add(round6(s));
  for (let s = chunk; s < f.length; s += chunk) set.add(round6(s));
  return [...set].sort((a, b) => a - b);
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
