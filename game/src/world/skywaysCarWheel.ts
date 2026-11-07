// Task skyways-vehicle-20261107 (lane VIS): the prize car's STEERING WHEEL separated from lane ASSET-D's Meshy dash — a deterministic
// LOCAL MESH SEPARATION of the cooked skyways-car-dash.glb at load (no new asset, no second wheel drawn over a baked one). The Meshy dash
// is one fused mesh: the wheel (rim, spokes, hub face) is welded to the column shroud behind it. Its triangles are partitioned
// (never cut, never copied) about the wheel's MEASURED axis (WHEEL_RIM: fitted on the rim's crest; DASH_MODEL.ring, the cockpit's
// placement anchor, is too coarse to turn about). A triangle belongs to the WHEEL when
//  - every vertex lies inside the wheel's cylinder (radius rMax: the rim's outer edge + a margin; the cluster hood and the dash face
//    around the rim stay the dash's), and
//  - its centre lies in the slab dBack .. dFront along the axis (the column shroud / instrument cluster behind the hub stay the dash's),
//    and
//  - it is reached from the rim tube (seed triangles: centre within seedBand of the crest radius, in front of seedBack) through other
//    such triangles sharing a welded vertex (the gauges and the stalks, separate pieces behind the wheel, are never reached).
// Everything else stays the dash: dash + wheel = the original triangle list exactly. Behind the hub the dash keeps the column shroud's
// own closed surface (no hole where the wheel was: the CPU QA renders with the wheel hidden). Three-free and import-free, so the runtime
// (world/skywaysCarModel.ts: two geometries over the SAME vertex attributes, the wheel on a pivot turning about WHEEL_RIM's axis), the
// tests and the private CPU QA renderer share these functions.

/** The wheel's ring in model space: centre, rim (tube-centre) radius, outer edge, the plane's normal toward the driver. */
export interface WheelRing { x: number; y: number; z: number; r: number; rimOuter: number; nx: number; ny: number; nz: number }

/**
 * The wheel's axis measured on the cooked dash (fitRimCrest from DASH_MODEL.ring: 55 of 72 sectors, rms 7 mm; stable to 1 mm / 0.1 deg):
 * (x, y, z) = the centre of the rim's front CREST circle (on the axis, the tube's radius in front of its mid-plane), r = the crest radius,
 * rimOuter = the rim's outer edge, n = the axis toward the driver (raked 16.8 deg back). DASH_MODEL.ring (the cockpit layout's anchor:
 * where the dash is placed) is a coarser estimate of the same wheel (its normal 6.5 deg off this axis, its centre 3 cm aside): a wheel
 * turned about it would wobble, so the pivot uses this axis.
 */
export const WHEEL_RIM: WheelRing = {x: -0.3402, y: 0.4698, z: 0.3374, r: 0.251, rimOuter: 0.285, nx: -0.0002, ny: 0.2896, nz: 0.9572};

/**
 * The partition's bounds (model metres, the WHEEL_RIM frame: d along the axis toward the driver from the crest plane, radial r from the
 * axis). Measured on the cooked dash: the rim tube spans d 0 .. -0.06 over r 0.2 .. 0.285, the hub face d 0 .. 0.02 over r < 0.12, its
 * walls run back into the column shroud; the cluster hood and the dash face around the rim lie at r >= 0.28, d <= -0.04.
 */
export const WHEEL_SPLIT = {rMax: 0.295, dBack: -0.075, dFront: 0.08, seedBand: 0.02, seedBack: -0.035, weld: 1e-5} as const;

export interface WheelSplit {
  /** Triangle vertex indices of the wheel / of the rest (the dash), both into the original vertex arrays. */
  wheel: Uint32Array;
  dash: Uint32Array;
  /** Triangle counts: candidates inside the cylinder slab, seeds, the wheel, the dash. */
  stats: {tris: number; candidates: number; seeds: number; wheel: number; dash: number};
}

/** The ring's unit normal (toward the driver). */
export function ringNormal(R: WheelRing): [number, number, number] {
  const l = Math.hypot(R.nx, R.ny, R.nz) || 1;
  return [R.nx / l, R.ny / l, R.nz / l];
}

/** An orthonormal in-plane pair (u ~ model +X, v = n x u ~ up) for a unit normal. */
function planeFrame(n: readonly number[]): [number[], number[]] {
  const u0 = [1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]], lu = Math.hypot(u0[0], u0[1], u0[2]) || 1, u = u0.map(x => x / lu);
  return [u, [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]];
}

/** Solves a 3x3 linear system (Gauss-Jordan, partial pivoting); null when singular. */
function solve3(M: number[][], y: number[]): number[] | null {
  const A = M.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-18) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k]; }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

export interface RimFit { x: number; y: number; z: number; nx: number; ny: number; nz: number; r: number; sectors: number; rms: number }

/**
 * Measures the rim by its CREST (QA / tests: how WHEEL_RIM was measured): around a provisional axis, per sector the vertex nearest the
 * driver (max d) between rIn and rS from the axis — the rim tube's front crest (the hub lies inside rIn; spokes meet the rim lower than
 * its crest; the cluster hood, the stalk and the dash face lie behind it); a circle (Kasa) and a plane (least squares d = a u + b v + c)
 * through those crest points; sectors off them by more than max(trim, 2 x the median residual) are dropped and the fit repeated from
 * the new axis. The crest circle's centre lies on the wheel's axis (in front of the tube's mid-plane by the tube's radius).
 */
export function fitRimCrest(P: ArrayLike<number>, guess: WheelRing, o: {iters?: number; sectors?: number; rIn?: number; rS?: number; trim?: number; log?: boolean} = {}): RimFit {
  const iters = o.iters ?? 10, ns = o.sectors ?? 72, rIn = o.rIn ?? 0.17, rS = o.rS ?? 0.31, trim = o.trim ?? 0.003;
  let C = [guess.x, guess.y, guess.z], N: number[] = ringNormal(guess);
  const nv = Math.floor(P.length / 3);
  let out: RimFit = {x: C[0], y: C[1], z: C[2], nx: N[0], ny: N[1], nz: N[2], r: 0, sectors: 0, rms: 0};
  for (let it = 0; it < iters; it++) {
    const [U, V] = planeFrame(N), top = new Float64Array(ns).fill(-Infinity), pts: number[][] = new Array(ns);
    for (let i = 0; i < nv; i++) {
      const qx = P[3 * i] - C[0], qy = P[3 * i + 1] - C[1], qz = P[3 * i + 2] - C[2];
      const a = qx * U[0] + qy * U[1] + qz * U[2], b = qx * V[0] + qy * V[1] + qz * V[2], r = Math.hypot(a, b);
      if (r > rS || r < rIn) continue;
      const d = qx * N[0] + qy * N[1] + qz * N[2];
      const s = Math.min(ns - 1, Math.floor(((Math.atan2(b, a) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI / ns)));
      if (d > top[s]) { top[s] = d; pts[s] = [a, b, d]; }
    }
    // fit -> trim -> refit in this frame (a sector without rim vertices in range picks a far point: dropped here)
    let keep = new Uint8Array(ns).map((_, s) => (pts[s] ? 1 : 0)), cu = 0, cv = 0, rad = 0, pl = [0, 0, 0], ss = 0, used = 0;
    for (let pass = 0; pass < 4; pass++) {
      const use = [...Array(ns).keys()].filter(s => keep[s]);
      let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0, Sd = 0, Sxd = 0, Syd = 0;
      for (const s of use) {
        const [a, b, d] = pts[s], z = a * a + b * b;
        Sx += a; Sy += b; Sxx += a * a; Syy += b * b; Sxy += a * b; Sxz += a * z; Syz += b * z; Sz += z; Sd += d; Sxd += a * d; Syd += b * d;
      }
      const M = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, use.length]], k = solve3(M, [Sxz, Syz, Sz]);
      if (!k) break;
      cu = k[0] / 2; cv = k[1] / 2; rad = Math.sqrt(Math.max(0, k[2] + cu * cu + cv * cv));
      pl = solve3(M, [Sxd, Syd, Sd]) ?? [0, 0, 0];
      const res = new Float64Array(ns).fill(Infinity);
      ss = 0; used = use.length;
      for (let s = 0; s < ns; s++) {
        if (!pts[s]) continue;
        const [a, b, d] = pts[s];
        res[s] = Math.hypot(Math.hypot(a - cu, b - cv) - rad, d - (pl[0] * a + pl[1] * b + pl[2]));
        if (keep[s]) ss += res[s] * res[s];
      }
      const sorted = [...res].filter(Number.isFinite).sort((x, y) => x - y), lim = Math.max(trim, 2 * (sorted[Math.floor(sorted.length / 2)] ?? 0));
      keep = new Uint8Array(ns);
      for (let s = 0; s < ns; s++) if (res[s] <= lim) keep[s] = 1;
    }
    const off = pl[2] + pl[0] * cu + pl[1] * cv;
    C = [0, 1, 2].map(j => C[j] + cu * U[j] + cv * V[j] + off * N[j]);
    const n2 = [0, 1, 2].map(j => N[j] - pl[0] * U[j] - pl[1] * V[j]), ln = Math.hypot(n2[0], n2[1], n2[2]);
    N = n2.map(x => x / ln);
    out = {x: C[0], y: C[1], z: C[2], nx: N[0], ny: N[1], nz: N[2], r: rad, sectors: used, rms: Math.sqrt(ss / Math.max(1, used))};
    if (o.log) console.log(`rim crest fit ${it}: sectors ${used} centre ${C.map(x => x.toFixed(4))} normal ${N.map(x => x.toFixed(4))} r ${rad.toFixed(4)} rms ${out.rms.toFixed(4)}`);
  }
  return out;
}

/** Partitions a triangle list (P: xyz positions; I: indices, null = non-indexed) into the wheel and the rest. Deterministic. */
export function splitWheel(P: ArrayLike<number>, I: ArrayLike<number> | null, R: WheelRing, o: {rMax: number; dBack: number; dFront: number; seedBand: number; seedBack: number; weld: number} = WHEEL_SPLIT): WheelSplit {
  const nv = Math.floor(P.length / 3), nt = Math.floor((I ? I.length : nv) / 3);
  const idx = (k: number): number => (I ? I[k] : k);
  const [nx, ny, nz] = ringNormal(R);
  // per vertex: d along the normal, r from the axis; the welded id (UV seams split vertices: weld by quantized position)
  const D = new Float64Array(nv), Rr = new Float64Array(nv), weld = new Int32Array(nv), keys = new Map<string, number>(), q = 1 / o.weld;
  for (let i = 0; i < nv; i++) {
    const x = P[3 * i] - R.x, y = P[3 * i + 1] - R.y, z = P[3 * i + 2] - R.z, d = x * nx + y * ny + z * nz;
    D[i] = d;
    Rr[i] = Math.sqrt(Math.max(0, x * x + y * y + z * z - d * d));
    const k = `${Math.round(P[3 * i] * q)},${Math.round(P[3 * i + 1] * q)},${Math.round(P[3 * i + 2] * q)}`;
    let w = keys.get(k);
    if (w === undefined) keys.set(k, (w = keys.size));
    weld[i] = w;
  }
  // candidates (inside the cylinder slab) and the seeds (on the rim tube)
  const cand = new Uint8Array(nt), seeds: number[] = [];
  let candidates = 0;
  for (let t = 0; t < nt; t++) {
    const a = idx(3 * t), b = idx(3 * t + 1), c = idx(3 * t + 2);
    if (Rr[a] > o.rMax || Rr[b] > o.rMax || Rr[c] > o.rMax) continue;
    const dc = (D[a] + D[b] + D[c]) / 3;
    if (dc < o.dBack || dc > o.dFront) continue;
    cand[t] = 1;
    candidates++;
    // (the centroid's radius: from the centroid itself, not the mean of the vertex radii)
    const cx = (P[3 * a] + P[3 * b] + P[3 * c]) / 3 - R.x, cy = (P[3 * a + 1] + P[3 * b + 1] + P[3 * c + 1]) / 3 - R.y, cz = (P[3 * a + 2] + P[3 * b + 2] + P[3 * c + 2]) / 3 - R.z;
    const rc = Math.sqrt(Math.max(0, cx * cx + cy * cy + cz * cz - dc * dc));
    if (Math.abs(rc - R.r) <= o.seedBand && dc >= o.seedBack) seeds.push(t);
  }
  // flood from the seeds through candidates sharing a welded vertex
  const byWeld = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) {
    if (!cand[t]) continue;
    for (let k = 0; k < 3; k++) {
      const w = weld[idx(3 * t + k)];
      let l = byWeld.get(w);
      if (!l) byWeld.set(w, (l = []));
      l.push(t);
    }
  }
  const inWheel = new Uint8Array(nt), stack = [...seeds];
  for (const t of seeds) inWheel[t] = 1;
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) for (const u of byWeld.get(weld[idx(3 * t + k)])!) if (!inWheel[u]) { inWheel[u] = 1; stack.push(u); }
  }
  let nw = 0;
  for (let t = 0; t < nt; t++) nw += inWheel[t];
  const wheel = new Uint32Array(nw * 3), dash = new Uint32Array((nt - nw) * 3);
  for (let t = 0, iw = 0, id = 0; t < nt; t++) {
    const out = inWheel[t] ? wheel : dash, j = inWheel[t] ? (iw += 3) - 3 : (id += 3) - 3;
    out[j] = idx(3 * t); out[j + 1] = idx(3 * t + 1); out[j + 2] = idx(3 * t + 2);
  }
  return {wheel, dash, stats: {tris: nt, candidates, seeds: seeds.length, wheel: nw, dash: nt - nw}};
}
