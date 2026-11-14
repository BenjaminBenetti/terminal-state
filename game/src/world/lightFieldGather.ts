// Task studio-baked-lighting-reflections-20261114-050258-01: the ENHANCED INDIRECT LIGHT of the station light field — a ray gather
// that replaces the baseline bounce fill (world/lightField.ts: a tenth of the area's mean light, blurred) when Enhanced lighting is on.
//
// The baseline fill knows nothing of the room: it is as bright behind a wall as in front of it, has no colour of its own and no
// direction. Here every field voxel looks around instead: a fixed set of rays over the sphere (world/lightScene.ts: the station's fixed
// architecture, exact) and, at whatever each ray hits, the light that surface really sends back — its own colour (world/surfaceAlbedo.ts:
// the finish the builder drew there) times the light that falls on it from its side (the direct light of the bake, by the surface's
// normal). What comes back is kept as a mean (the indirect irradiance), its first moment (where it comes from: a doorway, a lit floor)
// and its share of each flicker circuit (so a room lit by a stuttering tube stutters with it). Further bounces reuse the same hits.
//  - A room lit only through its door is lit from the door; an alcove off a bright hall is darker than the hall; under a platform edge,
//    behind a pier or up a stairwell the light falls off the way the space does.
//  - Red quarry tile throws warm light, a green wall a green cast, dark ballast almost nothing: no extra flat ambient anywhere.
//  - Nothing movable is in the scene (no prop, door, character or train), so nothing that can move is frozen into it.
// Cost: load time only (it is baked into the SAME field texture: no shader, texture or frame cost). Deterministic: no random numbers,
// the ray sets are fixed rotations of one lattice, interleaved over the cells and smoothed (an interleaved-sampling gather).
// `stride` 2 gathers on every other cell in x and z (a 1 m lattice: indirect light is smooth) and fills the cells between from their
// lattice neighbours in the same space, never across a wall or a drop: a quarter of the rays for nearly the same picture.

import {CELL} from '../gen/grid';
import type {BuildSteps} from '../core/pacedBuild';
import {BandScene, HIT_CEIL, HIT_FLOOR, sphereDirections} from './lightScene';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, type SurfaceAlbedo} from './surfaceAlbedo';
import type {ColumnGeometry} from './lightField';

/** What the bake hands the gather (its own arrays, slot-major as the fixtures wrote them). */
export interface IndirectContext {
  W: number; H: number;
  geos: readonly ColumnGeometry[];
  /** Height layers per slot. */
  layers: readonly number[];
  /** Direct light per slot: tinted fluence (rgb per voxel), its luminance-weighted direction, its luminance. */
  E: readonly Float32Array[]; D: readonly Float32Array[]; EL: readonly Float32Array[];
  /** Per slot: per column the luminance from each flicker circuit (x 3), per voxel the dying circuit's. */
  GL: readonly Float32Array[]; G2L: readonly Float32Array[];
  /** FieldParams.scatter: the share of non-directional direct light that reaches a surface. */
  scatter: number;
}

/** Channels per voxel of IndirectLight.data. */
export const IND_STRIDE = 9;

export interface IndirectLight {
  /** Per slot, per voxel (i * layers + k): its row in `data` (-1: a closed cell). */
  index: Int32Array[];
  /**
   * Per open voxel, IND_STRIDE floats: the indirect light as a sphere mean (rgb: the irradiance of a surface that sees it evenly),
   * its luminance-weighted mean direction (x, y, z: |it| <= the mean's luminance) and its luminance from flicker circuits 0 / 1 / 2.
   */
  data: Float32Array;
  stats: {voxels: number; probes: number; rays: number; hits: number; bounces: number; ms: number; traceMs: number; mean: number};
}

export interface GatherOptions {
  /** Rays per gathering voxel. */
  rays: number;
  /** Light bounces followed (1 = the directly lit surfaces only). */
  bounces: number;
  /** 1 = every cell gathers; 2 = every other cell in x and z gathers, the cells between are filled from them. */
  stride: 1 | 2;
  /** Farthest surface a voxel gathers from (m); fades out over the last 40 %. */
  reach: number;
  /** Scale of the result (1 = what the surfaces send back). */
  gain: number;
  albedo: SurfaceAlbedo;
  /** The ray scene (default: built from the context's geometry). */
  scene?: BandScene;
}

/** Defaults of the gather that are not a quality tier (world/enhancedLighting.ts GI_TIERS holds rays / stride / bounces). */
export const GATHER_REACH = 14;
export const GATHER_GAIN = 1;

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Cells whose floors differ by more than this are not one space for smoothing / filling (the bake's own bounce rule). */
const STEP_MAX = 0.6;

/** Ray sets: 16 fixed rotations of one lattice, chosen per voxel by its cell parity and layer (interleaved sampling). */
const SETS = 16;
function raySets(N: number): Float32Array {
  const base = sphereDirections(N), out = new Float32Array(SETS * N * 3);
  let seed = 0x9e3779b9;
  const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let s = 0; s < SETS; s++) {
    // a uniform random rotation from a fixed sequence (Shoemake): the same sets on every machine
    const u1 = rnd(), u2 = rnd() * Math.PI * 2, u3 = rnd() * Math.PI * 2;
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    const qx = a * Math.sin(u2), qy = a * Math.cos(u2), qz = b * Math.sin(u3), qw = b * Math.cos(u3);
    for (let j = 0; j < N; j++) {
      const x = base[j * 3], y = base[j * 3 + 1], z = base[j * 3 + 2];
      const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
      let rx = x + qw * tx + (qy * tz - qz * ty), ry = y + qw * ty + (qz * tx - qx * tz), rz = z + qw * tz + (qx * ty - qy * tx);
      // never exactly along an axis (a ray down a cell boundary)
      if (Math.abs(rx) < 1e-4) rx = 1e-4;
      if (Math.abs(rz) < 1e-4) rz = 1e-4;
      const l = Math.hypot(rx, ry, rz);
      const o = (s * N + j) * 3;
      out[o] = rx / l; out[o + 1] = ry / l; out[o + 2] = rz / l;
    }
  }
  return out;
}

/**
 * The gather as build steps (core/pacedBuild.ts): the journey's paced build draws frames between them. The result is the same
 * whatever the slicing (nothing reads a clock but the statistics).
 */
export function* gatherIndirectSteps(ctx: IndirectContext, opt: GatherOptions): BuildSteps<IndirectLight> {
  const t0 = performance.now();
  const {W, H, geos, layers: LS, E, D, EL, GL, G2L, scatter} = ctx;
  const n = W * H, S = geos.length, N = Math.max(4, Math.round(opt.rays)), stride = opt.stride === 2 ? 2 : 1;
  const scene = opt.scene ?? new BandScene(W, H, geos);
  yield 'gather.index';
  // --- open voxels ---------------------------------------------------------------------------
  const index = LS.map(L => new Int32Array(n * L).fill(-1));
  let count = 0;
  for (let s = 0; s < S; s++) { const open = geos[s].open, L = LS[s], ix = index[s]; for (let i = 0; i < n; i++) if (open[i]) for (let k = 0; k < L; k++) ix[i * L + k] = count++; }
  const vs = new Uint8Array(count), vi = new Int32Array(count), vk = new Uint8Array(count);
  for (let s = 0, c = 0; s < S; s++) { const open = geos[s].open, L = LS[s]; for (let i = 0; i < n; i++) if (open[i]) for (let k = 0; k < L; k++) { vs[c] = s; vi[c] = i; vk[c] = k; c++; } }
  yield;
  // --- which cells gather (1 = on the lattice, 2 = on their own: no lattice neighbour in their space), the others' sources -------
  const gathers = geos.map(() => new Uint8Array(n));
  /** Per slot, per filled cell: up to four lattice cells it is filled from (-1 = none). */
  const fillFrom = geos.map(() => (stride === 2 ? new Int32Array(n * 4).fill(-1) : null));
  let probes = 0;
  for (let s = 0; s < S; s++) {
    const {open, floorH} = geos[s], gt = gathers[s], ff = fillFrom[s], L = LS[s];
    for (let i = 0; i < n; i++) {
      if (!open[i]) continue;
      const cx = i % W, cz = (i - cx) / W;
      if (stride === 1 || (!(cx & 1) && !(cz & 1))) { gt[i] = 1; probes += L; continue; }
      const f = floorH[i];
      const ok = (j: number): boolean => open[j] > 0 && Math.abs(floorH[j] - f) < STEP_MAX;
      let m = 0;
      if (cx & 1 && !(cz & 1)) {
        if (ok(i - 1)) ff![i * 4 + m++] = i - 1;
        if (cx + 1 < W && ok(i + 1)) ff![i * 4 + m++] = i + 1;
      } else if (!(cx & 1)) {
        if (ok(i - W)) ff![i * 4 + m++] = i - W;
        if (cz + 1 < H && ok(i + W)) ff![i * 4 + m++] = i + W;
      } else {
        // a diagonal neighbour counts when the way round either corner is open (no leak through a wall corner)
        for (let q = 0; q < 4; q++) {
          const ax = q & 1 ? 1 : -1, az = q & 2 ? W : -W;
          if (cx + ax >= W || cz + (az > 0 ? 1 : -1) >= H) continue;
          const j = i + ax + az;
          if (ok(j) && (ok(i + ax) || ok(i + az))) ff![i * 4 + m++] = j;
        }
      }
      if (!m) { gt[i] = 2; probes += L; }
    }
  }
  /** The gathering voxels (rows of `data`), in slot / cell / layer order. */
  const P = new Int32Array(probes);
  for (let s = 0, q = 0; s < S; s++) { const gt = gathers[s], L = LS[s], ix = index[s]; for (let i = 0; i < n; i++) if (gt[i]) for (let k = 0; k < L; k++) P[q++] = ix[i * L + k]; }
  const sets = raySets(N), setShift = stride === 2 ? 1 : 0;
  const hitV = new Int32Array(probes * N).fill(-1);
  /** Per ray: the surface code (0 floor, 1 ceiling, 2 / 3 wall facing +x / -x, 4 / 5 wall facing +z / -z) and its weight (0..255). */
  const hitC = new Uint8Array(probes * N), hitW = new Uint8Array(probes * N);
  let cur = new Float32Array(count * IND_STRIDE), prev = new Float32Array(count * IND_STRIDE);
  const tot = new Float32Array(count * IND_STRIDE);
  const R = opt.reach, fade0 = R * 0.6, invFade = 1 / (R - fade0), invN = 1 / N;
  let hits = 0;
  yield;
  // --- per voxel, in one row each (a ray's hit then costs one or two cache lines, not a dozen scattered reads): its cell's surface
  // colours (floor, ceiling, wall: linear rgb), and what each of the six surface orientations there sends back of the DIRECT light
  // (its colour x the direct light on it from its own side), plus the flicker circuits' shares of that light ------------------------
  const va = new Float32Array(count * 9);
  const RAD = 21, rad = new Float32Array(count * RAD);
  const radRange = (c0: number, c1: number): void => {
    for (let c = c0; c < c1; c++) {
      const s = vs[c], i = vi[c], L = LS[s], hv = i * L + vk[c], A = opt.albedo.slots[s], a0 = i * ALBEDO_STRIDE, v0 = c * 9;
      for (let q = 0; q < 9; q++) va[v0 + q] = ALBEDO_LUT[A[a0 + q]];
      const el = EL[s][hv];
      if (el <= 0) continue;
      const Ds = D[s], Es = E[s], h3 = hv * 3, ddx = Ds[h3], ddy = Ds[h3 + 1], ddz = Ds[h3 + 2];
      const dmag = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz), dl = el < dmag ? el : dmag, o = c * RAD;
      for (let code = 0; code < 6; code++) {
        let ndl = code === 0 ? ddy : code === 1 ? -ddy : code === 2 ? ddx : code === 3 ? -ddx : code === 4 ? ddz : -ddz;
        ndl = ndl > 0 && dmag > 1e-9 ? ndl / dmag : 0;
        const wg = ((el - dl) * scatter + dl * ndl) / el, ao = v0 + (code === 0 ? ALB_FLOOR : code === 1 ? ALB_CEIL : ALB_WALL);
        rad[o + code * 3] = Es[h3] * wg * va[ao]; rad[o + code * 3 + 1] = Es[h3 + 1] * wg * va[ao + 1]; rad[o + code * 3 + 2] = Es[h3 + 2] * wg * va[ao + 2];
      }
      // column shares for circuits 0 / 1, the voxel's own for the dying one
      const GLs = GL[s], g0 = GLs[i * 3], g1 = GLs[i * 3 + 1];
      if (g0 > 0 || g1 > 0) {
        let ct = 0;
        for (let kk = 0; kk < L; kk++) ct += EL[s][i * L + kk];
        if (ct > 0) { rad[o + 18] = g0 / ct; rad[o + 19] = g1 / ct; }
      }
      rad[o + 20] = G2L[s][hv] / el;
    }
  };
  for (let c = 0; c < count; c += 16384) { radRange(c, Math.min(count, c + 16384)); yield; }

  yield 'gather.trace';
  // --- first bounce: trace, and gather what the directly lit surfaces send back ---------------------
  const traceRange = (p0: number, p1: number): void => {
    for (let p = p0; p < p1; p++) {
      const c = P[p], s = vs[c], i = vi[c], k = vk[c], cx = i % W, cz = (i - cx) / W;
      const ox = (cx + 0.5) * CELL, oz = (cz + 0.5) * CELL, oy = geos[s].layerY[i * LS[s] + k];
      const so = ((((cx >> setShift) & 1) | (((cz >> setShift) & 1) << 1) | ((k & 3) << 2)) % SETS) * N * 3;
      let mr = 0, mg = 0, mb = 0, vx = 0, vy = 0, vz = 0, c0l = 0, c1l = 0, c2l = 0;
      for (let j = 0; j < N; j++) {
        const dx = sets[so + j * 3], dy = sets[so + j * 3 + 1], dz = sets[so + j * 3 + 2];
        if (!scene.trace(ox, oy, oz, dx, dy, dz, R)) continue;
        const t = scene.hitT, band = scene.hitBand, hs = scene.slot[band], hi = scene.hitCol, Lh = LS[hs];
        const kind = scene.hitKind;
        let hk: number, code: number;
        if (kind === HIT_FLOOR) { hk = 0; code = 0; }
        else if (kind === HIT_CEIL) { hk = Lh - 1; code = 1; }
        else {
          const f = scene.f[band], span = scene.c[band] - 0.13 - f;
          hk = span > 1e-3 ? Math.round((scene.hitY - f - 0.05) / span * (Lh - 1)) : 0;
          hk = hk < 0 ? 0 : hk > Lh - 1 ? Lh - 1 : hk;
          code = scene.hitNx > 0 ? 2 : scene.hitNx < 0 ? 3 : scene.hitNz > 0 ? 4 : 5;
        }
        const hc = index[hs][hi * Lh + hk];
        if (hc < 0) continue;
        const w8 = t <= fade0 ? 255 : Math.round((1 - (t - fade0) * invFade) * 255);
        if (w8 <= 0) continue;
        const q = p * N + j;
        hitV[q] = hc; hitC[q] = code; hitW[q] = w8;
        hits++;
        const ro = hc * RAD, rc = ro + code * 3, w = w8 / 255;
        const r = rad[rc] * w, g = rad[rc + 1] * w, b = rad[rc + 2] * w;
        const l = lum(r, g, b);
        if (l <= 0) continue;
        mr += r; mg += g; mb += b;
        vx += l * dx; vy += l * dy; vz += l * dz;
        c0l += l * rad[ro + 18]; c1l += l * rad[ro + 19]; c2l += l * rad[ro + 20];
      }
      const o = c * IND_STRIDE;
      cur[o] = mr * invN; cur[o + 1] = mg * invN; cur[o + 2] = mb * invN;
      cur[o + 3] = vx * invN; cur[o + 4] = vy * invN; cur[o + 5] = vz * invN;
      cur[o + 6] = c0l * invN; cur[o + 7] = c1l * invN; cur[o + 8] = c2l * invN;
    }
  };
  // a step every few thousand rays (a couple of milliseconds)
  const CHUNK = Math.max(32, Math.round(4000 / N));
  for (let p = 0; p < probes; p += CHUNK) { traceRange(p, Math.min(probes, p + CHUNK)); yield; }
  const traceMs = performance.now() - t0;

  // --- further bounces: the same hits, lit by the bounce before ----------------------------------------
  const bounces = Math.max(1, Math.round(opt.bounces));
  const bounceRange = (p0: number, p1: number): void => {
    for (let p = p0; p < p1; p++) {
      const c = P[p], i = vi[c], k = vk[c], cx = i % W, cz = (i - cx) / W;
      const so = ((((cx >> setShift) & 1) | (((cz >> setShift) & 1) << 1) | ((k & 3) << 2)) % SETS) * N * 3;
      let mr = 0, mg = 0, mb = 0, vx = 0, vy = 0, vz = 0, c0l = 0, c1l = 0, c2l = 0;
      for (let j = 0, q = p * N; j < N; j++, q++) {
        const h = hitV[q];
        if (h < 0) continue;
        const ph = h * IND_STRIDE, pr = prev[ph], pg = prev[ph + 1], pb = prev[ph + 2], pl = lum(pr, pg, pb);
        if (pl <= 1e-7) continue;
        const code = hitC[q];
        // irradiance of the hit surface from the bounce before: the mean plus its first moment along the surface normal
        const nv = code === 0 ? prev[ph + 4] : code === 1 ? -prev[ph + 4] : code === 2 ? prev[ph + 3] : code === 3 ? -prev[ph + 3] : code === 4 ? prev[ph + 5] : -prev[ph + 5];
        let f = 1 + 2 * nv / pl;
        if (f <= 0) continue;
        if (f > 3) f = 3;
        f *= hitW[q] / 255;
        const a0 = h * 9 + (code === 0 ? ALB_FLOOR : code === 1 ? ALB_CEIL : ALB_WALL);
        const r = pr * f * va[a0], g = pg * f * va[a0 + 1], b = pb * f * va[a0 + 2];
        const l = lum(r, g, b), sh = l / pl;
        mr += r; mg += g; mb += b;
        vx += l * sets[so + j * 3]; vy += l * sets[so + j * 3 + 1]; vz += l * sets[so + j * 3 + 2];
        c0l += prev[ph + 6] * sh; c1l += prev[ph + 7] * sh; c2l += prev[ph + 8] * sh;
      }
      const o = c * IND_STRIDE;
      cur[o] = mr * invN; cur[o + 1] = mg * invN; cur[o + 2] = mb * invN;
      cur[o + 3] = vx * invN; cur[o + 4] = vy * invN; cur[o + 5] = vz * invN;
      cur[o + 6] = c0l * invN; cur[o + 7] = c1l * invN; cur[o + 8] = c2l * invN;
    }
  };

  // --- smoothing: a wall-respecting [1 2 1] along x then z, per slot and layer. On the lattice (stride 2) it runs over the gathering
  // cells two apart (which also merges the interleaved ray sets), and the cells between are then filled from them. -------------------
  const tmp = new Float32Array(count * IND_STRIDE);
  const smoothAxis = (src: Float32Array, dst: Float32Array, s: number, d: number, lattice: boolean, i0: number, i1: number): void => {
    const {open, floorH} = geos[s], L = LS[s], ix = index[s], gt = gathers[s];
    const alongX = d < W, h = d >> 1;
    for (let i = i0; i < i1; i++) {
      if (!open[i] || (lattice && gt[i] !== 1)) continue;
      const cx = i % W, f = floorH[i];
      const a = i - d, b = i + d;
      let okA = a >= 0 && (!alongX || cx - d >= 0) && open[a] > 0 && Math.abs(floorH[a] - f) < STEP_MAX;
      let okB = b < n && (!alongX || cx + d < W) && open[b] > 0 && Math.abs(floorH[b] - f) < STEP_MAX;
      if (lattice) {
        okA = okA && gt[a] === 1 && open[i - h] > 0 && Math.abs(floorH[i - h] - f) < STEP_MAX;
        okB = okB && gt[b] === 1 && open[i + h] > 0 && Math.abs(floorH[i + h] - f) < STEP_MAX;
      }
      const wt = 1 / (2 + (okA ? 1 : 0) + (okB ? 1 : 0));
      for (let k = 0; k < L; k++) {
        const o = ix[i * L + k] * IND_STRIDE, oa = okA ? ix[a * L + k] * IND_STRIDE : -1, ob = okB ? ix[b * L + k] * IND_STRIDE : -1;
        for (let q = 0; q < IND_STRIDE; q++) dst[o + q] = (2 * src[o + q] + (oa >= 0 ? src[oa + q] : 0) + (ob >= 0 ? src[ob + q] : 0)) * wt;
      }
    }
  };
  const fill = (buf: Float32Array, s: number, i0: number, i1: number): void => {
    const ff = fillFrom[s];
    if (!ff) return;
    const {open} = geos[s], L = LS[s], ix = index[s], gt = gathers[s];
    for (let i = i0; i < i1; i++) {
      if (!open[i] || gt[i]) continue;
      let m = 0;
      while (m < 4 && ff[i * 4 + m] >= 0) m++;
      const wt = 1 / m;
      for (let k = 0; k < L; k++) {
        const o = ix[i * L + k] * IND_STRIDE;
        for (let q = 0; q < IND_STRIDE; q++) {
          let v = 0;
          for (let e = 0; e < m; e++) v += buf[ix[ff[i * 4 + e] * L + k] * IND_STRIDE + q];
          buf[o + q] = v * wt;
        }
      }
    }
  };
  const ROWS = 32 * W;
  /** One bounce's result, complete at every voxel: lattice smoothing and the fill (stride 2), then into the total. */
  const finish = function* (): BuildSteps<void> {
    if (stride === 2) {
      for (let s = 0; s < S; s++) {
        for (let i = 0; i < n; i += ROWS) smoothAxis(cur, tmp, s, 2, true, i, Math.min(n, i + ROWS));
        for (let i = 0; i < n; i += ROWS) smoothAxis(tmp, cur, s, 2 * W, true, i, Math.min(n, i + ROWS));
        yield;
        for (let i = 0; i < n; i += ROWS) fill(cur, s, i, Math.min(n, i + ROWS));
        yield;
      }
    }
    for (let q = 0; q < tot.length; q++) tot[q] += cur[q];
  };
  yield* finish();
  for (let b = 1; b < bounces; b++) {
    yield 'gather.bounce';
    [cur, prev] = [prev, cur];
    for (let p = 0; p < probes; p += CHUNK * 8) { bounceRange(p, Math.min(probes, p + CHUNK * 8)); yield; }
    yield* finish();
  }

  yield 'gather.smooth';
  for (let pass = stride === 2 ? 1 : 0; pass < 2; pass++) {
    for (let s = 0; s < S; s++) {
      for (let i = 0; i < n; i += ROWS) smoothAxis(tot, tmp, s, 1, false, i, Math.min(n, i + ROWS));
      yield;
      for (let i = 0; i < n; i += ROWS) smoothAxis(tmp, tot, s, W, false, i, Math.min(n, i + ROWS));
      yield;
    }
  }
  let mean = 0;
  const gain = opt.gain;
  for (let c = 0; c < count; c++) {
    const o = c * IND_STRIDE;
    if (gain !== 1) for (let q = 0; q < IND_STRIDE; q++) tot[o + q] *= gain;
    mean += lum(tot[o], tot[o + 1], tot[o + 2]);
  }
  return {index, data: tot, stats: {voxels: count, probes, rays: probes * N, hits, bounces, ms: performance.now() - t0, traceMs, mean: count ? mean / count : 0}};
}
