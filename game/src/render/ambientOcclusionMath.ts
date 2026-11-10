// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO): screen-space ambient occlusion — the presets, the look and the
// CPU MIRROR of every formula of the AO passes (render/ambientOcclusion.ts holds the TSL; this file has no three.js import and is
// what the unit tests and the CPU pictures run). The mirror follows the shader step by step: the same pixel picks, the same
// rounding (floor(x + 0.5), never round()), the same noise, the same weights.
//
// The algorithm is GTAO (Jimenez et al., "Practical Real-Time Strategies for Accurate Indirect Occlusion", Activision 2016), as in
// three's examples/jsm/tsl/display/GTAONode.js, with our own texture access (see render/ambientOcclusion.ts for why):
//  raw    (low res): per pixel, the view position and a view normal rebuilt from the scene depth; SLICES planes through the view
//         vector (evenly spaced around it, rotated per pixel by a 4x4 pattern); along each one's screen line, STEPS depth samples
//         per side at quadratically growing distances up to a world radius (clamped on screen) find the two horizon angles; the
//         cosine-weighted visible arc has a closed form, taken relative to the same arc with nothing over the surface. A sample
//         only raises the horizon while it is within the radius (smooth falloff) and not far in FRONT of the pixel (the thickness
//         rule: a thin post does not shade the wall well behind it). Stored with 1 / view depth (0 = sky).
//  blur   (low res, two passes: along x, then along y): a 7-wide triangle (two 4-wide boxes: every phase of the 4x4 pattern gets
//         the same total weight, so the pattern cancels) weighted by depth similarity against the pixel's own depth PLANE (1 / z
//         is linear on screen for a plane: floors seen at a grazing angle blur fully, silhouettes do not bleed).
//  apply  (full res, in the fog composite): a depth-aware 2x2 upsample, then scene x mix(1, ao ^ power, strength x bright guard)
//         BEFORE the fog (in-scatter is never darkened). Sky gets none; bright pixels (emissive fixtures, glow cards, muzzle
//         flashes) keep their colour; the occlusion fades out with view distance before the fog swallows the surface.
// There is NO temporal accumulation: nothing to reset on camera cuts, sections or journeys, no ghost trails.

export type V3 = [number, number, number];

export interface AoPreset {
  /** AO resolution as a fraction of the drawing buffer, capped at `maxPixels` (like the fog march: render/atmosphere.ts marchSize). */
  scale: number;
  maxPixels: number;
  /** Screen directions per pixel (each is marched both ways). */
  slices: number;
  /** Depth samples per direction and side. */
  steps: number;
}

/** Per atmosphere quality (the AO runs inside the volumetric pipeline: quality 'off' has no AO). */
export const AO_QUALITY: Record<'low' | 'high', AoPreset> = {
  high: {scale: 0.5, maxPixels: 1280 * 720, slices: 3, steps: 4},
  low: {scale: 0.5, maxPixels: 640 * 360, slices: 2, steps: 3},
};

/** The look (uniform values; QA may edit the live copy on the pass). Distances in metres, luminances in linear HDR (before tone mapping). */
export const AO_LOOK = {
  /** World radius within which geometry occludes. */
  radius: 0.6,
  /** Screen clamp of that radius, as a fraction of the drawing buffer's height (near surfaces: bounded reach and texture cost). */
  maxRadiusFrac: 0.1,
  /** Thickness rule: geometry more than this in front of the pixel (toward the eye) does not occlude it; fades in from half of it. */
  thickness: 0.5,
  /** Contrast of the visible fraction before it is applied (ao ^ power): the bounded radius / falloff read conservatively. */
  power: 1.8,
  /** How much of the occlusion is applied to the scene colour. */
  strength: 0.8,
  /** View distance over which the occlusion fades to none. */
  fade: [16, 28] as [number, number],
  /** Bright guard: scene luminance (linear HDR) over which the occlusion fades to none. */
  guard: [0.7, 1.6] as [number, number],
  /** Depth-similarity sharpness of the blur (against the pixel's depth plane) and of the upsample: exp(-k x relative depth gap). */
  blurK: 40,
  upsampleK: 25,
};
export type AoLook = typeof AO_LOOK;

/** Closest depth sample to the pixel, in full-resolution pixels (1.5 px always rounds to another pixel: never the pixel itself). */
export const AO_MIN_STEP_PX = 1.5;
/** |projected normal|^2 of a slice below which it takes no samples / from which it takes them fully (the surface edge-on in the slice). */
export const AO_EDGE_ON = [0.03, 0.1] as const;
/**
 * The blur's taps along one axis and their weights: a 7-wide triangle = two 4-wide boxes, so the four phases of the 4-periodic
 * pattern each total 4 (offsets -3 / +1, -2 / +2, -1 / +3, 0) and the pattern cancels exactly on an even surface.
 */
export const AO_BLUR_TAPS = [-3, -2, -1, 0, 1, 2, 3] as const;
export const AO_BLUR_WEIGHTS = [1, 2, 3, 4, 3, 2, 1] as const;

/** AO target size for a drawing buffer (scale, then the pixel cap). */
export function aoSize(w: number, h: number, q: AoPreset): [number, number] {
  let lw = Math.max(1, Math.round(w * q.scale)), lh = Math.max(1, Math.round(h * q.scale));
  if (lw * lh > q.maxPixels) {
    const k = Math.sqrt(q.maxPixels / (lw * lh));
    lw = Math.max(1, Math.floor(lw * k)); lh = Math.max(1, Math.floor(lh * k));
  }
  return [lw, lh];
}

/**
 * The 4x4 per-pixel pattern (Activision): `dir` in [0, 1) rotates the slices (16 distinct values per 4x4 block: with S slices, 16 S
 * directions after the blur), `step` in (0, 1) offsets the samples along them (4 values). Any 4x4 window, aligned or not, holds every
 * `dir` once and every `step` four times.
 */
export function aoNoise(ix: number, iy: number): {dir: number; step: number} {
  const mx = ix % 4;
  return {dir: (((ix + iy) % 4) * 4 + mx) / 16, step: (((iy + 3 * mx) % 4) + 0.5) / 4};
}

const clampi = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The full-res pixel AO pixel (ix, iy) is computed for: a quarter in from a corner of its block, the corner alternating over every
 * 2x2 AO pixels (all four corners in each) — at half resolution each of a block's full-res pixels in turn, so the blur also averages
 * the sub-pixel position and a thin crease does not bead along its length.
 */
export function aoPixel(ix: number, iy: number, aw: number, ah: number, fw: number, fh: number): [number, number] {
  const jx = (ix + iy) % 2 ? 0.75 : 0.25, jy = iy % 2 ? 0.75 : 0.25;
  return [clampi(Math.floor((ix + jx) * fw / aw), 0, fw - 1), clampi(Math.floor((iy + jy) * fh / ah), 0, fh - 1)];
}

/** What the passes read of the scene: the full-resolution depth as VIEW depth (metres along the view axis), and the projection. */
export interface AoView {
  w: number;
  h: number;
  /** tan(vertical FOV / 2) and w / h (a symmetric perspective projection: three's PerspectiveCamera without a view offset). */
  tanY: number;
  aspect: number;
  /** View depth of full-res pixel (x, y); Infinity = sky / nothing drawn (device depth 1). */
  z(x: number, y: number): number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const HALF_PI = Math.PI / 2;

/** View position of the centre of full-res pixel (x, y) at view depth z (three's getViewPosition: x right, y up, looking down -z). */
export function aoViewPos(v: AoView, x: number, y: number, z: number): V3 {
  return [(2 * (x + 0.5) / v.w - 1) * v.tanY * v.aspect * z, (1 - 2 * (y + 0.5) / v.h) * v.tanY * z, -z];
}

/** Full-res pixels per metre at view depth 1 (0.5 x height x projection[1][1]). */
export const aoProjScale = (v: {h: number; tanY: number}): number => 0.5 * v.h / v.tanY;

/**
 * View normal at full-res pixel (cx, cy) from neighbouring depths: per axis, the neighbour whose 1 / z is closer to the pixel's (a
 * plane is linear in 1 / z on screen, so on a plane both sides tie; at a silhouette the far side loses and the normal does not smear).
 * A sky neighbour (nothing drawn) is never picked while the other one is a surface (a far pixel's 1 / z is close to the sky's 0: a roof
 * edge against the sky kept a normal of the view vector). Faces the eye. At the buffer's edge the inner neighbour is used.
 */
export function aoNormal(v: AoView, cx: number, cy: number, z: number, P: V3 = aoViewPos(v, cx, cy, z)): V3 {
  const pick = (ax: 0 | 1): V3 => {
    const lim = ax ? v.h - 1 : v.w - 1, c = ax ? cy : cx;
    const zm = c > 0 ? (ax ? v.z(cx, cy - 1) : v.z(cx - 1, cy)) : Infinity, zp = c < lim ? (ax ? v.z(cx, cy + 1) : v.z(cx + 1, cy)) : Infinity;
    const okm = Number.isFinite(zm), okp = Number.isFinite(zp);
    const minus = okm && (!okp || Math.abs(1 / zm - 1 / z) < Math.abs(1 / zp - 1 / z));
    const zq = minus ? zm : zp, s = minus ? -1 : 1;
    if (!Number.isFinite(zq)) return [0, 0, 0];
    const Q = aoViewPos(v, cx + (ax ? 0 : s), cy + (ax ? s : 0), zq);
    return [(Q[0] - P[0]) * s, (Q[1] - P[1]) * s, (Q[2] - P[2]) * s];
  };
  const c = cross(pick(0), pick(1)), l = Math.hypot(c[0], c[1], c[2]);
  const pl = Math.hypot(P[0], P[1], P[2]) || 1, V: V3 = [-P[0] / pl, -P[1] / pl, -P[2] / pl];
  if (!(l > 0)) return V;
  const N: V3 = [c[0] / l, c[1] / l, c[2] / l];
  return dot(N, V) < 0 ? [-N[0], -N[1], -N[2]] : N;
}

/**
 * The raw pass for AO pixel (ix, iy) of an aw x ah target: `ao` = the cosine-weighted visible fraction of the hemisphere (1 = open),
 * already faded with distance; `g` = 1 / view depth of the pixel it was computed for (0 = sky).
 */
export function aoRawAt(v: AoView, ix: number, iy: number, aw: number, ah: number, q: AoPreset, look: AoLook = AO_LOOK): {ao: number; g: number} {
  const [cx, cy] = aoPixel(ix, iy, aw, ah, v.w, v.h);
  const z = v.z(cx, cy);
  if (!Number.isFinite(z)) return {ao: 1, g: 0};
  if (z >= look.fade[1]) return {ao: 1, g: 1 / z};
  const P = aoViewPos(v, cx, cy, z), N = aoNormal(v, cx, cy, z, P);
  const pl = Math.hypot(P[0], P[1], P[2]) || 1, V: V3 = [-P[0] / pl, -P[1] / pl, -P[2] / pl];
  const proj = aoProjScale(v);
  // the world radius actually covered: look.radius, less where its screen size would pass the clamp (near surfaces)
  const R = Math.min(look.radius, look.maxRadiusFrac * v.h * z / proj);
  // slices are spaced evenly AROUND THE VIEW VECTOR (not around the screen's z axis: off-centre those differ by up to the half FOV,
  // and the arc integral is only exact — an open surface reads 1 at any tilt — for an even spacing around V): e1 / e2 span the plane
  // perpendicular to V
  const e0: V3 = [1 - V[0] * V[0], -V[1] * V[0], -V[2] * V[0]], el = Math.hypot(e0[0], e0[1], e0[2]), e1: V3 = [e0[0] / el, e0[1] / el, e0[2] / el], e2 = cross(V, e1);
  const nz = aoNoise(ix, iy);
  let vis = 0, open = 0;
  for (let s = 0; s < q.slices; s++) {
    const psi = (s + nz.dir) / q.slices * Math.PI, cp = Math.cos(psi), sp = Math.sin(psi);
    // the slice plane holds V and T (unit, perpendicular to V); `axis` is its normal
    const T: V3 = [e1[0] * cp + e2[0] * sp, e1[1] * cp + e2[1] * sp, e1[2] * cp + e2[2] * sp], axis = cross(T, V);
    // T's direction on screen in pixels (+y is down) and how many pixels one metre along T covers there
    const wl = Math.sqrt(Math.max(1 - axis[2] * axis[2], 1e-6)), cs = -axis[1] / wl, sn = -axis[0] / wl;
    const rPx = R * proj / z * wl / V[2];
    const na = dot(N, axis), pn: V3 = [N[0] - axis[0] * na, N[1] - axis[1] * na, N[2] - axis[2] * na];
    const pnLen = Math.hypot(pn[0], pn[1], pn[2]);
    const cosN = clamp(dot(pn, V) / Math.max(pnLen, 1e-5), 0, 1);
    const n = (dot(T, pn) >= 0 ? 1 : -1) * Math.acos(cosN), sinN = Math.sin(n);
    // samples are whole pixels, up to half a pixel off the slice's line. Each is placed IN the slice by its height over the tangent
    // PLANE (exact wherever the pixel is; / pnLen = measured within the slice) and its distance along the surface's tangent line there
    // (`L`, on the + side): on a flat surface every sample then sits exactly on the tangent line, so an open floor reads open at any
    // angle instead of gaining a pixel-snapping bias. Near the horizon of a grazing floor a pixel that is beside the slice's line on
    // screen can lie almost straight ACROSS the slice in the world (screen-to-floor is strongly anisotropic there): its offset along
    // B (the tangent plane's direction across the slice), less the part the slice's own tilt explains (kb), is counted as distance
    // along the surface too (the sample turned about the normal into the slice, its height kept). Without it such a sample had next
    // to no distance (a direction from rounding noise) and darkened an open floor by up to 7 % (lane AO debug log, 2026-11-10).
    // A slice that sees the surface nearly edge-on (tiny pnLen: next to no weight, heights blown up) takes no samples.
    const L: V3 = [T[0] * cosN - V[0] * sinN, T[1] * cosN - V[1] * sinN, T[2] * cosN - V[2] * sinN];
    const B = cross(N, L), kb = dot(pn, B) / Math.max(pnLen, 1e-5);
    const sure = smooth(AO_EDGE_ON[0], AO_EDGE_ON[1], pnLen * pnLen);
    // the horizons start at the surface's own tangent plane (cos of the angle from the view vector), +direction and -direction
    let hc0 = -sinN, hc1 = sinN;
    for (let j = 0; j < q.steps; j++) {
      const t = (j + nz.step) / q.steps, sPx = Math.max(t * t * rPx, AO_MIN_STEP_PX);
      const ox = Math.floor(cs * sPx + 0.5), oy = Math.floor(sn * sPx + 0.5);
      for (let side = 0; side < 2; side++) {
        const sg = side ? -1 : 1, qx = cx + sg * ox, qy = cy + sg * oy;
        if (qx < 0 || qy < 0 || qx > v.w - 1 || qy > v.h - 1) continue; // off screen: unknown, never an occluder
        const zs = v.z(qx, qy);
        if (!Number.isFinite(zs)) continue; // sky: far beyond the radius
        const S = aoViewPos(v, qx, qy, zs), d0: V3 = [S[0] - P[0], S[1] - P[1], S[2] - P[2]];
        const fr = Math.min(Math.hypot(d0[0], d0[1], d0[2]) / R, 1);
        const w = (1 - fr * fr) * (1 - smooth(look.thickness * 0.5, look.thickness, d0[2])) * sure;
        const up = dot(d0, N) / Math.max(pnLen, 1e-3), along = Math.hypot(dot(d0, L), dot(d0, B) - up * kb);
        const low = side ? sinN : -sinN, hc = low + ((low * along + cosN * up) / Math.max(Math.hypot(along, up), 1e-6) - low) * w;
        if (side) hc1 = Math.max(hc1, hc); else hc0 = Math.max(hc0, hc);
      }
    }
    const h0 = n + clamp(-Math.acos(clamp(hc1, -1, 1)) - n, -HALF_PI, HALF_PI), h1 = n + clamp(Math.acos(clamp(hc0, -1, 1)) - n, -HALF_PI, HALF_PI);
    vis += pnLen * (2 * cosN + 2 * (h0 + h1) * sinN - Math.cos(2 * h0 - n) - Math.cos(2 * h1 - n)) / 4;
    open += pnLen * (cosN + n * sinN); // the same arc with nothing above the tangent plane
  }
  // visible / open over the pixel's own slices: an open surface reads exactly 1 in EVERY pixel whatever its tilt and rotation (the
  // few slices of one pixel do not average the open arc to 1 on a tilted surface; their ratio needs no averaging)
  vis = clamp(vis / Math.max(open, 1e-4), 0, 1);
  const fade = 1 - smooth(look.fade[0], look.fade[1], z);
  return {ao: 1 + (vis - 1) * fade, g: 1 / z};
}

/** A low-res AO target on the CPU: `ao` and `g` (1 / view depth; 0 = sky) per pixel, row-major. */
export interface AoBuffer { w: number; h: number; ao: Float32Array; g: Float32Array }

/** The raw pass over a whole target. */
export function aoRaw(v: AoView, q: AoPreset, look: AoLook = AO_LOOK, size: [number, number] = aoSize(v.w, v.h, q)): AoBuffer {
  const [w, h] = size, ao = new Float32Array(w * h), g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const r = aoRawAt(v, x, y, w, h, q, look); ao[y * w + x] = r.ao; g[y * w + x] = r.g; }
  return {w, h, ao, g};
}

/**
 * One blur pass at pixel (ix, iy) along `axis` (0 = x, 1 = y): the 7 taps x their triangle weight x exp(-blurK x |g - plane| / g),
 * `plane` = the pixel's own 1 / z extended along the axis by its per-pixel gradient (the smaller of the two one-sided differences;
 * at the target's edge the inner one). Clamped to [0, 1]. Sky: 1.
 */
export function aoBlurAt(src: AoBuffer, ix: number, iy: number, axis: 0 | 1, look: AoLook = AO_LOOK): number {
  const {w} = src, lim = axis ? src.h - 1 : w - 1, c = axis ? iy : ix;
  const at = (q: number) => (axis ? q * w + ix : iy * w + q);
  const gc = src.g[at(c)];
  if (!(gc > 0)) return 1;
  const a = gc - src.g[at(clampi(c - 1, 0, lim))], b = src.g[at(clampi(c + 1, 0, lim))] - gc;
  const grad = c >= lim || (c > 0 && Math.abs(a) < Math.abs(b)) ? a : b;
  let sum = 0, ws = 0;
  for (let k = 0; k < AO_BLUR_TAPS.length; k++) {
    const q = clampi(c + AO_BLUR_TAPS[k], 0, lim), i = at(q);
    const wt = AO_BLUR_WEIGHTS[k] * Math.exp(-look.blurK * Math.abs(src.g[i] - (gc + grad * (q - c))) / gc);
    sum += src.ao[i] * wt; ws += wt;
  }
  return clamp(sum / ws, 0, 1); // (the pixel's own tap has weight 4: ws >= 4)
}

/** The two blur passes over a whole target (`g` is passed through). */
export function aoBlur(raw: AoBuffer, look: AoLook = AO_LOOK): AoBuffer {
  const pass = (src: AoBuffer, axis: 0 | 1): AoBuffer => {
    const ao = new Float32Array(src.w * src.h);
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) ao[y * src.w + x] = aoBlurAt(src, x, y, axis, look);
    return {w: src.w, h: src.h, ao, g: src.g};
  };
  return pass(pass(raw, 0), 1);
}

/**
 * The composite's depth-aware upsample for full-res pixel (x, y) of a fw x fh buffer at view depth z: the 2x2 blurred neighbours,
 * bilinear x exp(-upsampleK x relative depth gap); the nearest-depth one when nothing matches (as the fog's own upsample:
 * render/atmosphere.ts bilateralUpsample).
 */
export function aoUpsampleAt(b: AoBuffer, fw: number, fh: number, x: number, y: number, z: number, look: AoLook = AO_LOOK): number {
  if (!Number.isFinite(z)) return 1;
  const g = 1 / z, px = (x + 0.5) / fw * b.w - 0.5, py = (y + 0.5) / fh * b.h - 0.5, bx = Math.floor(px), by = Math.floor(py), fx = px - bx, fy = py - by;
  let acc = 0, ws = 0, best = 1, bestD = Infinity;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const k = clampi(by + j, 0, b.h - 1) * b.w + clampi(bx + i, 0, b.w - 1);
    const dz = Math.abs(b.g[k] - g) / g;
    const wt = Math.max((i ? fx : 1 - fx) * (j ? fy : 1 - fy), 1e-3) * Math.exp(-look.upsampleK * dz);
    acc += b.ao[k] * wt; ws += wt;
    if (dz < bestD) { bestD = dz; best = b.ao[k]; }
  }
  return clamp(ws > 1e-4 ? acc / ws : best, 0, 1);
}

/** Rec. 709 luminance of a linear colour. */
export const aoLuminance = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * The factor the composite multiplies the scene colour by: mix(1, ao ^ power, strength x bright guard); 1 when AO is off or the
 * pixel is sky. `lum` = the scene pixel's linear HDR luminance.
 */
export function aoFactor(ao: number, lum: number, look: AoLook = AO_LOOK, on = true, sky = false): number {
  if (!on || sky) return 1;
  const k = look.strength * (1 - smooth(look.guard[0], look.guard[1], lum));
  return 1 + (Math.pow(clamp(ao, 1e-4, 1), look.power) - 1) * k; // (1e-4: the shader's pow never sees 0)
}

/** Texture loads per frame of each AO stage for a drawing buffer (the cost arithmetic of docs/ambient-occlusion.md; not a time). */
export function aoCost(fw: number, fh: number, q: AoPreset): {size: [number, number]; rawPerPixel: number; raw: number; blur: number; apply: number; total: number} {
  const size = aoSize(fw, fh, q), px = size[0] * size[1];
  const rawPerPixel = 1 + 4 + q.slices * q.steps * 2; // the pixel's depth, the normal's four neighbours, the horizon samples
  const raw = px * rawPerPixel, blur = px * AO_BLUR_TAPS.length * 2, apply = fw * fh * 4;
  return {size, rawPerPixel, raw, blur, apply, total: raw + blur + apply};
}
