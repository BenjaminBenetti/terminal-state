// Task studio-baked-lighting-reflections-20261114-050258-01: the ENHANCED INDIRECT LIGHT of the station light field — a ray gather
// that replaces the baseline bounce fill (world/lightField.ts: a tenth of the area's mean light, blurred) when Enhanced lighting is on.
// Task studio-baked-gi-visual-uplift-20261115-004324-01: the gather is now kept as it is — PHYSICAL, with its own directions.
//
// The baseline fill knows nothing of the room: it is as bright behind a wall as in front of it, has no colour of its own and no
// direction. Here every field voxel looks around instead: a fixed set of rays over the sphere (world/lightScene.ts: the station's fixed
// architecture, exact) and, at whatever each ray hits, the light that surface really sends back — its own colour (world/surfaceAlbedo.ts:
// the finish the builder drew there) times the light that falls on it from its side (the direct light of the bake, by the surface's
// normal). What comes back is kept per voxel as an AMBIENT CUBE: the irradiance of a surface facing each of the six axis directions
// (CUBE_FACES: what a floor, a ceiling and the four wall orientations there receive), plus the light's share of each flicker circuit
// (so a room lit by a stuttering tube stutters with it). Further bounces reuse the same hits: the surface a ray hit is lit by the
// bounce before through the cube face of its own normal (a radiosity iteration), so the light a white wall throws on the floor goes
// on to the ceiling.
//  - A room lit only through its door is lit from the door; an alcove off a bright hall is darker than the hall; under a platform edge,
//    behind a pier or up a stairwell the light falls off the way the space does.
//  - Red quarry tile throws warm light, a green wall a green cast, dark ballast almost nothing: no extra flat ambient anywhere.
//  - A ceiling over a lit floor is lit by that floor and a floor is not lit by itself; the side of a pier that faces a bright wall is
//    brighter than the side that faces a dark tunnel (the cube's six faces; the first version of this bake kept one mean and scaled
//    it to the baseline's amount, which is why it looked like the baseline).
//  - Nothing movable is in the scene (no prop, door, character or train), so nothing that can move is frozen into it.
// Cost: load time only. Deterministic: no random numbers, the ray sets are fixed rotations of one lattice, interleaved over the
// cells and smoothed (an interleaved-sampling gather). `stride` 2 gathers on every other cell in x and z (a 1 m lattice: indirect
// light is smooth) and fills the cells between from their lattice neighbours in the same space, never across a wall or a drop: a
// quarter of the rays for nearly the same picture. The rows are rounded to the 16 bits the derived cache stores (rowBits): a row read
// back from the cache is exactly the row a fresh gather returns.

import {CELL} from '../gen/grid';
import type {BuildSteps} from '../core/pacedBuild';
import {BandScene, HIT_CEIL, HIT_FLOOR, sphereDirections} from './lightScene';
import {ALBEDO_LUT, ALBEDO_STRIDE, ALB_CEIL, ALB_FLOOR, ALB_WALL, type SurfaceAlbedo} from './surfaceAlbedo';
import {CUBE_FACES, IND_CIRCUITS, IND_STRIDE, type ColumnGeometry} from './lightField';

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

export {CUBE_FACES, IND_CIRCUITS, IND_STRIDE};

export interface IndirectLight {
  /** Per slot, per voxel (i * layers + k): its row in `data` (-1: a closed cell). */
  index: Int32Array[];
  /**
   * Per open voxel, IND_STRIDE floats (each a rowValue): the gathered light as an ambient cube — per face of CUBE_FACES the
   * irradiance (rgb) of a surface with that normal — and the luminance flicker circuits 0 / 1 / 2 give to the cube's mean (the mean
   * of its six faces).
   */
  data: Float32Array;
  stats: {voxels: number; probes: number; rays: number; hits: number; bounces: number; ms: number; traceMs: number; mean: number};
}

/** Largest value a row holds. */
export const ROW_MAX = 64;
/** A row value as the derived cache stores it: 16 bits, square-root spaced over 0 .. ROW_MAX (finer than a half float in the dark). */
export const rowBits = (v: number): number => (v > 0 ? (v >= ROW_MAX ? 65535 : Math.round(Math.sqrt(v / ROW_MAX) * 65535)) : 0);
/** The value of rowBits' 16 bits (as a 32-bit float: what a row holds). */
export const rowValue = (b: number): number => { const t = b / 65535; return Math.fround(t * t * ROW_MAX); };

/** The mean of a row's six faces (rgb into `out`): the light a small sphere there receives, as an irradiance. */
export function cubeMean(data: ArrayLike<number>, o: number, out: [number, number, number]): [number, number, number] {
  out[0] = (data[o] + data[o + 3] + data[o + 6] + data[o + 9] + data[o + 12] + data[o + 15]) / 6;
  out[1] = (data[o + 1] + data[o + 4] + data[o + 7] + data[o + 10] + data[o + 13] + data[o + 16]) / 6;
  out[2] = (data[o + 2] + data[o + 5] + data[o + 8] + data[o + 11] + data[o + 14] + data[o + 17]) / 6;
  return out;
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
  /** Chroma of the surface colours the light bounces off (1 = as drawn; default 1): see GATHER_SATURATION. */
  saturation?: number;
  /** How reflective the bounce takes a finish to be (default: as drawn): see GATHER_RESPONSE / bounceReflectance. */
  response?: {lift: number; ceiling: number};
  albedo: SurfaceAlbedo;
  /** The ray scene (default: built from the context's geometry). */
  scene?: BandScene;
}

/** Defaults of the gather that are not a quality tier (world/enhancedLighting.ts GI_TIERS holds rays / stride / bounces). */
export const GATHER_REACH = 14;
/**
 * Task studio-baked-gi-visual-uplift-20261115-004324-01: the game shows the bounce stronger than its finishes strictly give. Measured
 * on the base Subway (seed 93), the station's dark, grimy finishes send back about a seventh of the light that falls on them: kept at
 * that, the bounce is as faint as the baseline's fill and Enhanced lighting reads like Off. It is a stylisation of the bounce alone
 * (direct light, the hemisphere and every light level without a lit surface nearby are untouched), with all of its occlusion,
 * direction and colour.
 * Task studio-gi-mood-bounce-loading-20261115-081523-01 (the user: "parts of the world are now too bright and less moody ... a bit
 * darker, not a rollback"): that stylisation was one factor of 2.5 on the whole gather, whatever the finish — a white-tiled room then
 * sent back more light than fell on it, and every ceiling over a lit floor was lifted to a flat mid grey. It is now a RESPONSE of the
 * finish (bounceReflectance): a dark finish bounces GATHER_RESPONSE.lift times what it strictly would, a pale one levels off below
 * GATHER_RESPONSE.ceiling (no finish returns more light than it receives), and GATHER_GAIN — the scale of the whole gather — is 1.
 */
export const GATHER_GAIN = 1;
export const GATHER_RESPONSE = {lift: 2.2, ceiling: 0.7} as const;
/** (task studio-baked-gi-visual-uplift-20261115-004324-01) Chroma of the surface colours as the bounce sees them (1 = as drawn): a little more, so a coloured finish reads in its bounce. */
export const GATHER_SATURATION = 1.25;
/** What the game's bake gathers with (QA / tuning may change it before a bake: the cache digest covers every number; lift 0 = the finishes as drawn). */
export const GATHER_TUNING: {gain: number; saturation: number; lift: number; ceiling: number} = {gain: GATHER_GAIN, saturation: GATHER_SATURATION, lift: GATHER_RESPONSE.lift, ceiling: GATHER_RESPONSE.ceiling};

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/**
 * The reflectance the bounce takes a finish of reflectance `rho` to have: `ceiling x (1 - exp(-lift x rho / ceiling))` — `lift` times
 * rho for a dark finish, levelling off below `ceiling` for a pale one (monotonic; a black finish stays black).
 */
export function bounceReflectance(rho: number, lift: number, ceiling: number): number {
  return rho > 0 ? ceiling * (1 - Math.exp(-lift * rho / ceiling)) : 0;
}
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
 * IndirectLight.index of a station (a pure enumeration of its open voxels, slot by slot, cell by cell, layer by layer) and the
 * number of rows: a cached gather stores only its rows (world/enhancedLightingRuntime.ts).
 */
export function indirectIndex(geos: readonly ColumnGeometry[], layers: readonly number[], n: number): {index: Int32Array[]; count: number} {
  const index = layers.map(L => new Int32Array(n * L).fill(-1));
  let count = 0;
  for (let s = 0; s < geos.length; s++) { const open = geos[s].open, L = layers[s], ix = index[s]; for (let i = 0; i < n; i++) if (open[i]) for (let k = 0; k < L; k++) ix[i * L + k] = count++; }
  return {index, count};
}

/**
 * The gather as build steps (core/pacedBuild.ts): the journey's paced build draws frames between them. The result is the same
 * whatever the slicing (nothing reads a clock but the statistics).
 */
export function* gatherIndirectSteps(ctx: IndirectContext, opt: GatherOptions): BuildSteps<IndirectLight> {
  const t0 = performance.now();
  const {W, H, geos, layers: LS, E, D, EL, GL, G2L, scatter} = ctx;
  const n = W * H, S = geos.length, N = Math.max(4, Math.round(opt.rays)), stride = opt.stride === 2 ? 2 : 1;
  const scene = opt.scene ?? new BandScene(W, H, geos), sat = opt.saturation ?? 1, resp = opt.response ?? null;
  yield 'gather.index';
  // --- open voxels ---------------------------------------------------------------------------
  const {index, count} = indirectIndex(geos, LS, n);
  const vs = new Uint8Array(count), vi = new Int32Array(count), vk = new Uint8Array(count);
  for (let s = 0, c = 0; s < S; s++) { const open = geos[s].open, L = LS[s]; for (let i = 0; i < n; i++) if (open[i]) for (let k = 0; k < L; k++) { vs[c] = s; vi[c] = i; vk[c] = k; c++; } }
  yield;
  // --- which cells gather (1 = on the lattice, 2 = on their own: no lattice neighbour in their space), the others' sources -------
  const gathers = geos.map(() => new Uint8Array(n));
  /** Per slot, per filled cell: up to four lattice cells it is filled from (-1 = none). */
  const fillFrom = geos.map(() => (stride === 2 ? new Int32Array(n * 4).fill(-1) : null));
  let probes = 0;
  for (let s = 0; s < S; s++) {
    yield;
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
  yield;
  const sets = raySets(N), setShift = stride === 2 ? 1 : 0;
  yield;
  const hitV = new Int32Array(probes * N).fill(-1);
  /** Per ray: the surface code (0 floor, 1 ceiling, 2 / 3 wall facing +x / -x, 4 / 5 wall facing +z / -z) and its weight (0..255). */
  const hitC = new Uint8Array(probes * N), hitW = new Uint8Array(probes * N);
  yield;
  let cur = new Float32Array(count * IND_STRIDE), prev = new Float32Array(count * IND_STRIDE);
  yield;
  const tot = new Float32Array(count * IND_STRIDE);
  const R = opt.reach, fade0 = R * 0.6, invFade = 1 / (R - fade0);
  // a face's irradiance from N rays over the sphere: (4 pi / N) x sum of radiance x cosine, radiance = radiosity / pi; the cube's
  // mean weighs a ray by the mean of its three cosines (x 4 / 6)
  const faceN = 4 / N, meanN = 4 / (6 * N), acc = new Float64Array(IND_STRIDE);
  let hits = 0;
  yield;
  // --- per voxel, in one row each (a ray's hit then costs one or two cache lines, not a dozen scattered reads): its cell's surface
  // colours (floor, ceiling, wall: linear rgb), and what each of the six surface orientations there sends back of the DIRECT light
  // (its colour x the direct light on it from its own side), plus the flicker circuits' shares of that light ------------------------
  const va = new Float32Array(count * 9);
  yield;
  const RAD = 21, rad = new Float32Array(count * RAD);
  yield;
  const radRange = (c0: number, c1: number): void => {
    for (let c = c0; c < c1; c++) {
      const s = vs[c], i = vi[c], L = LS[s], hv = i * L + vk[c], A = opt.albedo.slots[s], a0 = i * ALBEDO_STRIDE, v0 = c * 9;
      for (let q = 0; q < 9; q += 3) {
        let r = ALBEDO_LUT[A[a0 + q]], g = ALBEDO_LUT[A[a0 + q + 1]], b = ALBEDO_LUT[A[a0 + q + 2]];
        if (sat !== 1) {
          // more chroma at the same luminance (never below nothing, never brighter than white)
          const l = lum(r, g, b);
          r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
          r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
        }
        if (resp) {
          // the finish's colour at the reflectance the bounce takes it to have (its hue kept; never brighter than white)
          const l = lum(r, g, b);
          if (l > 1e-6) {
            const k = bounceReflectance(l, resp.lift, resp.ceiling) / l;
            r *= k; g *= k; b *= k;
            r = r > 1 ? 1 : r; g = g > 1 ? 1 : g; b = b > 1 ? 1 : b;
          }
        }
        va[v0 + q] = r; va[v0 + q + 1] = g; va[v0 + q + 2] = b;
      }
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
      acc.fill(0);
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
        // into the three faces the ray arrives on (a face sees the ray by the cosine to its normal)
        const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy, az = dz < 0 ? -dz : dz;
        const fy = dy > 0 ? 0 : 3, fx = dx > 0 ? 6 : 9, fz = dz > 0 ? 12 : 15;
        acc[fy] += r * ay; acc[fy + 1] += g * ay; acc[fy + 2] += b * ay;
        acc[fx] += r * ax; acc[fx + 1] += g * ax; acc[fx + 2] += b * ax;
        acc[fz] += r * az; acc[fz + 1] += g * az; acc[fz + 2] += b * az;
        const lm = l * (ax + ay + az);
        acc[18] += lm * rad[ro + 18]; acc[19] += lm * rad[ro + 19]; acc[20] += lm * rad[ro + 20];
      }
      const o = c * IND_STRIDE;
      for (let q = 0; q < IND_CIRCUITS; q++) cur[o + q] = acc[q] * faceN;
      cur[o + 18] = acc[18] * meanN; cur[o + 19] = acc[19] * meanN; cur[o + 20] = acc[20] * meanN;
    }
  };
  // a step every few thousand rays (a couple of milliseconds)
  const CHUNK = Math.max(32, Math.round(4000 / N));
  for (let p = 0; p < probes; p += CHUNK) { traceRange(p, Math.min(probes, p + CHUNK)); yield; }
  const traceMs = performance.now() - t0;

  // --- further bounces: the same hits, lit by the bounce before ----------------------------------------
  const bounces = Math.max(1, Math.round(opt.bounces));
  /** Luminance of the mean of the bounce before, per voxel. */
  const meanL = new Float32Array(count), m3: [number, number, number] = [0, 0, 0];
  // A bounce is gathered at the lattice's voxels only (stride 2): a surface in a cell between them is lit by the bounce before as
  // its lattice neighbour in the same space is (`rep`: a voxel's own row when it gathers, else the row of its first lattice source).
  const rep = new Int32Array(count);
  for (let s = 0; s < S; s++) {
    const gt = gathers[s], ff = fillFrom[s], L = LS[s], ix = index[s], open = geos[s].open;
    for (let i = 0; i < n; i++) if (open[i]) for (let k = 0; k < L; k++) rep[ix[i * L + k]] = gt[i] || !ff ? ix[i * L + k] : ix[ff[i * 4] * L + k];
  }
  yield;
  const bounceRange = (p0: number, p1: number): void => {
    for (let p = p0; p < p1; p++) {
      const c = P[p], i = vi[c], k = vk[c], cx = i % W, cz = (i - cx) / W;
      const so = ((((cx >> setShift) & 1) | (((cz >> setShift) & 1) << 1) | ((k & 3) << 2)) % SETS) * N * 3;
      acc.fill(0);
      for (let j = 0, q = p * N; j < N; j++, q++) {
        const hx = hitV[q];
        if (hx < 0) continue;
        // irradiance of the hit surface from the bounce before: the cube face of its own normal
        const h = rep[hx], code = hitC[q], hr = h * IND_STRIDE, ph = hr + code * 3, er = prev[ph], eg = prev[ph + 1], eb = prev[ph + 2];
        if (er + eg + eb <= 1e-7) continue;
        const w = hitW[q] / 255, a0 = hx * 9 + (code === 0 ? ALB_FLOOR : code === 1 ? ALB_CEIL : ALB_WALL);
        const r = er * va[a0] * w, g = eg * va[a0 + 1] * w, b = eb * va[a0 + 2] * w;
        const dx = sets[so + j * 3], dy = sets[so + j * 3 + 1], dz = sets[so + j * 3 + 2];
        const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy, az = dz < 0 ? -dz : dz;
        const fy = dy > 0 ? 0 : 3, fx = dx > 0 ? 6 : 9, fz = dz > 0 ? 12 : 15;
        acc[fy] += r * ay; acc[fy + 1] += g * ay; acc[fy + 2] += b * ay;
        acc[fx] += r * ax; acc[fx + 1] += g * ax; acc[fx + 2] += b * ax;
        acc[fz] += r * az; acc[fz + 1] += g * az; acc[fz + 2] += b * az;
        // the circuits' shares of the surface's light: those of the hit voxel's mean
        const pm = meanL[h];
        if (pm <= 1e-9) continue;
        const lm = lum(r, g, b) * (ax + ay + az) / pm;
        acc[18] += lm * prev[hr + 18]; acc[19] += lm * prev[hr + 19]; acc[20] += lm * prev[hr + 20];
      }
      const o = c * IND_STRIDE;
      for (let q = 0; q < IND_CIRCUITS; q++) cur[o + q] = acc[q] * faceN;
      cur[o + 18] = acc[18] * meanN; cur[o + 19] = acc[19] * meanN; cur[o + 20] = acc[20] * meanN;
    }
  };
  // (plain functions: a generator body runs a hot loop several times slower before the JIT warms up)
  /** The bounce in `cur` into the total, and its mean's luminance (rows of gathering voxels; the others are zero until the fill). */
  const addRange = (p0: number, p1: number): void => {
    for (let p = p0; p < p1; p++) {
      const c = P[p], o = c * IND_STRIDE;
      for (let q = 0; q < IND_STRIDE; q++) tot[o + q] += cur[o + q];
      cubeMean(cur, o, m3);
      meanL[c] = lum(m3[0], m3[1], m3[2]);
    }
  };
  for (let p = 0; p < probes; p += 8192) { addRange(p, Math.min(probes, p + 8192)); yield; }
  for (let b = 1; b < bounces; b++) {
    yield 'gather.bounce';
    [cur, prev] = [prev, cur]; // (meanL is the swapped-in bounce's)
    for (let p = 0; p < probes; p += CHUNK * 8) { bounceRange(p, Math.min(probes, p + CHUNK * 8)); yield; }
    for (let p = 0; p < probes; p += 8192) { addRange(p, Math.min(probes, p + 8192)); yield; }
  }

  // --- smoothing: a wall-respecting [1 2 1] along x then z, per slot and layer. On the lattice (stride 2) it runs over the gathering
  // cells two apart (which also merges the interleaved ray sets), and the cells between are then filled from them. -------------------
  yield 'gather.smooth';
  const tmp = prev; // (free now)
  const smoothAxis = (src: Float32Array, dst: Float32Array, s: number, d: number, lattice: boolean, i0: number, i1: number): void => {
    const {open, floorH} = geos[s], L = LS[s], ix = index[s], gt = gathers[s];
    const alongX = d < W, h = d >> 1;
    for (let i = i0; i < i1; i++) {
      if (!open[i] || (lattice && gt[i] !== 1)) {
        // (a cell that gathers on its own keeps what it gathered)
        if (lattice && open[i] && gt[i] === 2) for (let k = 0; k < L; k++) { const o = ix[i * L + k] * IND_STRIDE; for (let q = 0; q < IND_STRIDE; q++) dst[o + q] = src[o + q]; }
        continue;
      }
      const cx = i % W, f = floorH[i];
      const a = i - d, b = i + d;
      let okA = a >= 0 && (!alongX || cx - d >= 0) && open[a] > 0 && Math.abs(floorH[a] - f) < STEP_MAX;
      let okB = b < n && (!alongX || cx + d < W) && open[b] > 0 && Math.abs(floorH[b] - f) < STEP_MAX;
      if (lattice) {
        okA = okA && gt[a] === 1 && open[i - h] > 0 && Math.abs(floorH[i - h] - f) < STEP_MAX;
        okB = okB && gt[b] === 1 && open[i + h] > 0 && Math.abs(floorH[i + h] - f) < STEP_MAX;
      }
      for (let k = 0; k < L; k++) {
        const o = ix[i * L + k] * IND_STRIDE;
        if (okA && okB) { const oa = ix[a * L + k] * IND_STRIDE, ob = ix[b * L + k] * IND_STRIDE; for (let q = 0; q < IND_STRIDE; q++) dst[o + q] = (2 * src[o + q] + src[oa + q] + src[ob + q]) * 0.25; }
        else if (okA || okB) { const oa = ix[(okA ? a : b) * L + k] * IND_STRIDE; for (let q = 0; q < IND_STRIDE; q++) dst[o + q] = (2 * src[o + q] + src[oa + q]) * (1 / 3); }
        else for (let q = 0; q < IND_STRIDE; q++) dst[o + q] = src[o + q];
      }
    }
  };
  const fill = (buf: Float32Array, s: number, i0: number, i1: number): void => {
    const ff = fillFrom[s];
    if (!ff) return;
    const {open} = geos[s], L = LS[s], ix = index[s], gt = gathers[s];
    for (let i = i0; i < i1; i++) {
      if (!open[i] || gt[i]) continue;
      const f0 = ff[i * 4], f1 = ff[i * 4 + 1], f2 = ff[i * 4 + 2], f3 = ff[i * 4 + 3];
      for (let k = 0; k < L; k++) {
        const o = ix[i * L + k] * IND_STRIDE, o0 = ix[f0 * L + k] * IND_STRIDE;
        if (f1 < 0) { for (let q = 0; q < IND_STRIDE; q++) buf[o + q] = buf[o0 + q]; continue; }
        const o1 = ix[f1 * L + k] * IND_STRIDE;
        if (f2 < 0) { for (let q = 0; q < IND_STRIDE; q++) buf[o + q] = (buf[o0 + q] + buf[o1 + q]) * 0.5; continue; }
        const o2 = ix[f2 * L + k] * IND_STRIDE;
        if (f3 < 0) { for (let q = 0; q < IND_STRIDE; q++) buf[o + q] = (buf[o0 + q] + buf[o1 + q] + buf[o2 + q]) * (1 / 3); continue; }
        const o3 = ix[f3 * L + k] * IND_STRIDE;
        for (let q = 0; q < IND_STRIDE; q++) buf[o + q] = (buf[o0 + q] + buf[o1 + q] + buf[o2 + q] + buf[o3 + q]) * 0.25;
      }
    }
  };
  const ROWS = 32 * W;
  if (stride === 2) {
    for (let s = 0; s < S; s++) {
      for (let i = 0; i < n; i += ROWS) smoothAxis(tot, tmp, s, 2, true, i, Math.min(n, i + ROWS));
      yield;
      for (let i = 0; i < n; i += ROWS) smoothAxis(tmp, tot, s, 2 * W, true, i, Math.min(n, i + ROWS));
      yield;
      for (let i = 0; i < n; i += ROWS) fill(tot, s, i, Math.min(n, i + ROWS));
      yield;
    }
  }
  for (let pass = stride === 2 ? 1 : 0; pass < 2; pass++) {
    for (let s = 0; s < S; s++) {
      for (let i = 0; i < n; i += ROWS) smoothAxis(tot, tmp, s, 1, false, i, Math.min(n, i + ROWS));
      yield;
      for (let i = 0; i < n; i += ROWS) smoothAxis(tmp, tot, s, W, false, i, Math.min(n, i + ROWS));
      yield;
    }
  }
  // --- the rows as the cache holds them: 16-bit, square-root spaced up to ROW_MAX (rowBits / rowValue), so the row read back from
  // the cache is the row returned here, bit for bit ---------------------------------------------------------------------------------
  let mean = 0;
  const gain = opt.gain;
  const roundRange = (c0: number, c1: number): void => {
    for (let v = c0; v < c1; v++) {
      const o = v * IND_STRIDE;
      for (let q = 0; q < IND_STRIDE; q++) tot[o + q] = rowValue(rowBits(tot[o + q] * gain));
      cubeMean(tot, o, m3);
      mean += lum(m3[0], m3[1], m3[2]);
    }
  };
  for (let c = 0; c < count; c += 8192) { roundRange(c, Math.min(count, c + 8192)); yield; }
  return {index, data: tot, stats: {voxels: count, probes, rays: probes * N, hits, bounces, ms: performance.now() - t0, traceMs, mean: count ? mean / count : 0}};
}
