// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO; user: "add AO"): the CPU MIRROR of the screen-space ambient
// occlusion (render/ambientOcclusionMath.ts — the same pixel picks, rounding, noise and weights as the TSL in render/ambientOcclusion.ts)
// on ANALYTIC scenes ray-cast per full-resolution pixel (exact view depth, like a depth buffer without its quantisation):
//  1. an open flat surface reads open (raw >= 0.98 in EVERY pixel) — floors at grazing and steep angles, walls, a ceiling, a rolled
//     view, both presets, the ADS field of view; this is the self-occlusion bug of the first mirror (an open floor read 0.81-0.95 in
//     pixels near its horizon);
//  2. a 90 degree wall / floor crease darkens toward the crease, bounded (never black), and is open again a radius away;
//  3. a thin post far in front of a wall leaves no dark halo on the wall around it (the thickness rule), but a post standing ON the
//     floor shades the floor at its foot;
//  4. sky pixels read 1 (and carry g = 0); every value of every stage stays within [0, 1];
//  5. the filter: the 4x4 interleaved pattern cancels on an even surface (no noise left), the blur and the upsample keep a silhouette
//     sharp (the far wall's AO never bleeds onto the near post or back);
//  6. the apply: sky / AO off / bright pixels keep their colour, distance fades the occlusion out before the fog; sizes and the cost
//     arithmetic of docs/ambient-occlusion.md.
import {describe, expect, it} from 'vitest';
import {
  AO_BLUR_TAPS, AO_BLUR_WEIGHTS, AO_LOOK, AO_QUALITY, aoBlur, aoCost, aoFactor, aoNoise, aoNormal, aoPixel, aoRaw, aoRawAt, aoSize, aoUpsampleAt,
  aoViewPos, type AoPreset, type AoView, type V3,
} from '../src/render/ambientOcclusionMath';

// ---------------------------------------------------------------------------------------------
// A tiny analytic ray caster: planes and axis-aligned boxes, a yaw / pitch / roll camera at the origin (view: x right, y up, -z forward)

type Prim = {plane: V3; d: number} | {box: [V3, V3]};

function rotate(v: V3, yaw: number, pitch: number, roll: number): V3 {
  let [x, y, z] = v, c = Math.cos(roll), s = Math.sin(roll);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(pitch); s = Math.sin(pitch);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(yaw); s = Math.sin(yaw);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return [x, y, z];
}

/** View depth (metres along the view axis) per full-res pixel of the scene; Infinity where nothing is hit (sky). */
function castView(w: number, h: number, fovY: number, eye: V3, cam: {yaw?: number; pitch?: number; roll?: number}, prims: Prim[]): AoView {
  const tanY = Math.tan(fovY * Math.PI / 360), aspect = w / h, zb = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // the pixel centre's ray scaled to view z = -1: its parameter t IS the view depth
    const d = rotate([(2 * (x + 0.5) / w - 1) * tanY * aspect, (1 - 2 * (y + 0.5) / h) * tanY, -1], cam.yaw ?? 0, cam.pitch ?? 0, cam.roll ?? 0);
    let best = Infinity;
    for (const p of prims) {
      if ('plane' in p) {
        const nd = p.plane[0] * d[0] + p.plane[1] * d[1] + p.plane[2] * d[2];
        if (Math.abs(nd) < 1e-12) continue;
        const t = -(p.plane[0] * eye[0] + p.plane[1] * eye[1] + p.plane[2] * eye[2] + p.d) / nd;
        if (t > 1e-6 && t < best) best = t;
      } else {
        let t0 = -Infinity, t1 = Infinity;
        for (let k = 0; k < 3; k++) {
          const lo = (p.box[0][k] - eye[k]) / d[k], hi = (p.box[1][k] - eye[k]) / d[k];
          t0 = Math.max(t0, Math.min(lo, hi)); t1 = Math.min(t1, Math.max(lo, hi));
        }
        if (t1 >= t0 && t0 > 1e-6 && t0 < best) best = t0;
      }
    }
    zb[y * w + x] = best;
  }
  return {w, h, tanY, aspect, z: (x, y) => zb[y * w + x]};
}

/** World position of full-res pixel (x, y) (its view position rotated back; the eye at `eye`). */
function worldAt(v: AoView, x: number, y: number, eye: V3, cam: {yaw?: number; pitch?: number; roll?: number}): V3 {
  const p = aoViewPos(v, x, y, v.z(x, y)), r = rotate(p, cam.yaw ?? 0, cam.pitch ?? 0, cam.roll ?? 0);
  return [r[0] + eye[0], r[1] + eye[1], r[2] + eye[2]];
}

const FLOOR: Prim = {plane: [0, 1, 0], d: 0};
const HIGH = AO_QUALITY.high, LOW = AO_QUALITY.low;

/** The raw pass over a view at the preset's size: every surface pixel's AO, with its full-res pixel. */
function rawPixels(v: AoView, q: AoPreset) {
  const [aw, ah] = aoSize(v.w, v.h, q), out: {ao: number; g: number; cx: number; cy: number}[] = [];
  for (let iy = 0; iy < ah; iy++) for (let ix = 0; ix < aw; ix++) {
    const r = aoRawAt(v, ix, iy, aw, ah, q), [cx, cy] = aoPixel(ix, iy, aw, ah, v.w, v.h);
    out.push({...r, cx, cy});
  }
  return out;
}

describe('an open flat surface reads open in every pixel (no self-occlusion at any angle)', () => {
  const cases: {tag: string; w: number; h: number; fov: number; eye: V3; cam: {yaw?: number; pitch?: number; roll?: number}; prim: Prim}[] = [];
  for (const pitch of [0.08, 0, -0.08, -0.28, -0.7, -1.3]) for (const eyeY of [1.62, 0.4]) cases.push({tag: `floor pitch ${pitch} eye ${eyeY}`, w: 640, h: 360, fov: 75, eye: [0, eyeY, 0], cam: {pitch}, prim: FLOOR});
  for (const pitch of [0, -0.12, -0.28]) cases.push({tag: `floor ADS fov 45 pitch ${pitch}`, w: 640, h: 360, fov: 45, eye: [0, 1.62, 0], cam: {pitch}, prim: FLOOR});
  cases.push({tag: 'floor 4:3, rolled 0.6', w: 480, h: 360, fov: 75, eye: [0, 1.62, 0], cam: {pitch: -0.3, roll: 0.6}, prim: FLOOR});
  for (const yaw of [0.3, 1.0, 1.45]) cases.push({tag: `wall seen at yaw ${yaw}`, w: 640, h: 360, fov: 75, eye: [0, 1.62, 0], cam: {yaw, pitch: -0.1}, prim: {plane: [0, 0, 1], d: 4}});
  cases.push({tag: 'ceiling', w: 640, h: 360, fov: 75, eye: [0, 1.62, 0], cam: {pitch: 0.35}, prim: {plane: [0, -1, 0], d: 3}});
  for (const c of cases) for (const [qn, q] of [['high', HIGH], ['low', LOW]] as const) {
    it(`${c.tag} (${qn})`, () => {
      const v = castView(c.w, c.h, c.fov, c.eye, c.cam, [c.prim]);
      let n = 0, min = 1;
      for (const p of rawPixels(v, q)) {
        if (!(p.g > 0)) continue;
        n++;
        if (p.ao < min) min = p.ao;
      }
      expect(n, 'surface pixels').toBeGreaterThan(1000);
      expect(min, `${c.tag}: the darkest pixel of an open surface`).toBeGreaterThanOrEqual(0.98);
    });
  }

  it('the normal rebuilt from depth is the plane\'s, also at a silhouette (the nearer side is picked) and next to the sky', () => {
    const eye: V3 = [0, 1.62, 0], cam = {pitch: -0.4};
    const v = castView(320, 180, 75, eye, cam, [FLOOR, {box: [[-0.3, 0, -3.3], [0.3, 0.8, -2.7]]}]);
    const toView = (n: V3): V3 => { // the world normal in view space (inverse rotation: pitch only)
      const c = Math.cos(-0.4), s = Math.sin(-0.4);
      return [n[0], n[1] * c + n[2] * s, -n[1] * s + n[2] * c];
    };
    // which face a pixel shows (floor / box top / another box face / sky)
    const face = (x: number, y: number) => {
      if (!Number.isFinite(v.z(x, y))) return 'sky';
      const P = worldAt(v, x, y, eye, cam);
      return Math.abs(P[1]) < 1e-6 ? 'floor' : Math.abs(P[1] - 0.8) < 1e-6 ? 'top' : 'box';
    };
    let floorPx = 0, silhouette = 0, skyEdge = 0;
    for (let y = 1; y < v.h - 1; y++) for (let x = 1; x < v.w - 1; x++) {
      const f = face(x, y), z = v.z(x, y);
      if (f !== 'floor' && f !== 'top') continue;
      // a CONVEX edge, where the neighbour across it lies on the other face at the same depth, may blend the two normals (the 1 / z
      // tie): harmless — the blend only lowers the occlusion there — and excluded; a silhouette (a depth jump) or the sky is not a tie
      const across = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => face(a, b) !== f);
      if (across.some(([a, b]) => face(a, b) !== 'sky' && Math.abs(v.z(a, b) - z) / z < 0.05)) continue;
      const N = aoNormal(v, x, y, z), want = toView([0, 1, 0]);
      expect(N[0] * want[0] + N[1] * want[1] + N[2] * want[2], `pixel ${x},${y} (${f})`).toBeGreaterThan(0.999);
      if (f === 'floor') floorPx++;
      if (across.some(([a, b]) => face(a, b) === 'sky')) skyEdge++;
      else if (across.length) silhouette++;
    }
    expect(floorPx).toBeGreaterThan(5000);
    expect(silhouette, 'pixels at a silhouette over a farther surface').toBeGreaterThan(20); // the box top's back edge over the far floor
    expect(skyEdge, 'floor pixels next to the sky (the horizon row)').toBeGreaterThan(100);
  });
});

describe('contact shading: a crease darkens toward it, bounded; a radius away it is open again', () => {
  it('a 90 degree wall / floor crease (both presets)', () => {
    const eye: V3 = [0, 1.62, 0], cam = {pitch: -0.35};
    const v = castView(640, 360, 75, eye, cam, [FLOOR, {plane: [0, 0, 1], d: 4}]); // wall z = -4 facing the eye
    for (const q of [HIGH, LOW]) {
      const bins = [[0, 0.1], [0.1, 0.25], [0.25, 0.45], [0.8, 1.5]].map(b => ({b, sum: 0, n: 0, min: 1}));
      for (const p of rawPixels(v, q)) {
        if (!(p.g > 0)) continue;
        expect(p.ao).toBeGreaterThanOrEqual(0);
        expect(p.ao).toBeLessThanOrEqual(1);
        const P = worldAt(v, p.cx, p.cy, eye, cam);
        if (Math.abs(P[1]) > 1e-6) continue; // floor pixels only (by distance to the wall)
        const dist = P[2] + 4;
        for (const bin of bins) if (dist >= bin.b[0] && dist < bin.b[1]) { bin.sum += p.ao; bin.n++; bin.min = Math.min(bin.min, p.ao); }
      }
      const mean = bins.map(b => b.sum / Math.max(1, b.n));
      for (const b of bins) expect(b.n, `bin ${b.b}`).toBeGreaterThan(30);
      expect(mean[0], 'right at the crease').toBeLessThan(0.8);
      expect(mean[0]).toBeLessThan(mean[1]);
      expect(mean[1]).toBeLessThan(mean[2]);
      expect(mean[2]).toBeLessThan(mean[3]);
      expect(mean[3], 'a radius and more away').toBeGreaterThan(0.98);
      expect(Math.min(...bins.map(b => b.min)), 'bounded: never black').toBeGreaterThan(0.25);
    }
  });

  it('the wall side of the crease darkens toward the floor the same way', () => {
    const eye: V3 = [0, 1.62, 0], cam = {pitch: -0.2};
    const v = castView(640, 360, 75, eye, cam, [FLOOR, {plane: [0, 0, 1], d: 2.5}]);
    let low = 0, nl = 0, high = 0, nh = 0;
    for (const p of rawPixels(v, HIGH)) {
      if (!(p.g > 0)) continue;
      const P = worldAt(v, p.cx, p.cy, eye, cam);
      if (Math.abs(P[2] + 2.5) > 1e-6) continue; // wall pixels
      if (P[1] < 0.1) { low += p.ao; nl++; } else if (P[1] > 0.9) { high += p.ao; nh++; }
    }
    expect(nl).toBeGreaterThan(30);
    expect(low / nl).toBeLessThan(0.82);
    expect(high / nh).toBeGreaterThan(0.98);
  });

  it('a post standing on the floor shades the floor at its foot', () => {
    const eye: V3 = [0, 1.62, 0], cam = {pitch: -0.5};
    const post: Prim = {box: [[-0.06, 0, -2.56], [0.06, 1.2, -2.44]]};
    const v = castView(640, 360, 75, eye, cam, [FLOOR, post]);
    let near = 0, n = 0;
    for (const p of rawPixels(v, HIGH)) {
      if (!(p.g > 0)) continue;
      const P = worldAt(v, p.cx, p.cy, eye, cam);
      if (Math.abs(P[1]) > 1e-6) continue;
      const d = Math.hypot(P[0], P[2] + 2.5);
      if (d < 0.2) { near += p.ao; n++; }
    }
    expect(n).toBeGreaterThan(20);
    expect(near / n).toBeLessThan(0.9);
  });
});

describe('no halos: a thin post far in front of a wall leaves the wall around it open (thickness rule)', () => {
  it('raw, blurred and upsampled', () => {
    const eye: V3 = [0, 1.5, 0], cam = {};
    const post: Prim = {box: [[-0.05, -5, -3.05], [0.05, 5, -2.95]]}; // floor-to-ceiling, 3 m away
    const wall: Prim = {plane: [0, 0, 1], d: 8}; // 5 m behind it
    const W = 640, H = 360, v = castView(W, H, 75, eye, cam, [post, wall]);
    for (const q of [HIGH, LOW]) {
      const raw = aoRaw(v, q), b = aoBlur(raw);
      let wallPx = 0, minRaw = 1, minUp = 1;
      for (let i = 0; i < raw.w * raw.h; i++) if (raw.g[i] > 0 && Math.abs(1 / raw.g[i] - 8) < 1e-3) { wallPx++; minRaw = Math.min(minRaw, raw.ao[i]); }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const z = v.z(x, y);
        if (Math.abs(z - 8) > 1e-3) continue;
        minUp = Math.min(minUp, aoUpsampleAt(b, W, H, x, y, z));
      }
      expect(wallPx).toBeGreaterThan(1000);
      expect(minRaw, 'raw: the wall beside the post').toBeGreaterThan(0.98);
      expect(minUp, 'filtered + upsampled: the wall beside the post').toBeGreaterThan(0.98);
      // ... and the post itself is not darkened by the far wall either
      let minPost = 1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(v.z(x, y) - 2.95) < 1e-3) minPost = Math.min(minPost, aoUpsampleAt(b, W, H, x, y, v.z(x, y)));
      expect(minPost).toBeGreaterThan(0.98);
    }
  });
});

describe('sky, range and the filter', () => {
  it('sky pixels read 1 with g = 0; every stage stays within [0, 1]; the upsample of sky is 1', () => {
    const eye: V3 = [0, 1.62, 0], cam = {pitch: 0.1};
    const v = castView(320, 180, 75, eye, cam, [FLOOR, {box: [[-1, 0, -5], [1, 1.5, -4]]}]);
    const raw = aoRaw(v, HIGH), b = aoBlur(raw);
    let sky = 0;
    for (let i = 0; i < raw.w * raw.h; i++) {
      for (const val of [raw.ao[i], b.ao[i]]) { expect(val).toBeGreaterThanOrEqual(0); expect(val).toBeLessThanOrEqual(1); }
      if (raw.g[i] === 0) { sky++; expect(raw.ao[i]).toBe(1); expect(b.ao[i]).toBe(1); }
    }
    expect(sky).toBeGreaterThan(1000);
    expect(aoUpsampleAt(b, 320, 180, 160, 2, Infinity)).toBe(1);
    expect(aoRawAt(v, 160, 1, raw.w, raw.h, HIGH)).toEqual({ao: 1, g: 0});
  });

  it('the 4x4 pattern: every 4x4 window holds each direction once and each step offset four times; the blur weights cancel it', () => {
    for (const [ox, oy] of [[0, 0], [1, 2], [3, 3], [2, 1]]) {
      const dirs = new Set<number>(), steps = new Map<number, number>();
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const n = aoNoise(ox + x, oy + y); dirs.add(n.dir); steps.set(n.step, (steps.get(n.step) ?? 0) + 1); }
      expect(dirs.size).toBe(16);
      expect([...steps.values()]).toEqual([4, 4, 4, 4]);
    }
    // the 7-wide triangle = two 4-wide boxes: each of the 4 phases totals 4 (taps 0 / +-4 apart share a phase)
    const phase = [0, 0, 0, 0];
    AO_BLUR_TAPS.forEach((t, k) => { phase[((t % 4) + 4) % 4] += AO_BLUR_WEIGHTS[k]; });
    expect(phase).toEqual([4, 4, 4, 4]);
  });

  it('after the filter an even crease band carries no interleaved pattern (row-to-row spread is small)', () => {
    const eye: V3 = [0, 1.62, 0], cam = {pitch: -0.35};
    const v = castView(640, 360, 75, eye, cam, [FLOOR, {plane: [0, 0, 1], d: 4}]);
    const raw = aoRaw(v, HIGH), b = aoBlur(raw);
    // floor pixels at the same distance from the wall (one AO row near the crease, away from the screen edges): raw varies with the
    // pattern, blurred is smooth along the row
    const spread = (buf: Float32Array, y: number) => {
      const vals: number[] = [];
      for (let x = 40; x < raw.w - 40; x++) vals.push(buf[y * raw.w + x]);
      const m = vals.reduce((s, x) => s + x, 0) / vals.length;
      return Math.sqrt(vals.reduce((s, x) => s + (x - m) * (x - m), 0) / vals.length);
    };
    // the AO row just below the crease line (the floor right at the wall)
    let row = -1;
    for (let y = 0; y < raw.h && row < 0; y++) { const [cx, cy] = aoPixel(raw.w >> 1, y, raw.w, raw.h, 640, 360); const P = worldAt(v, cx, cy, eye, cam); if (Math.abs(P[1]) < 1e-6 && P[2] + 4 < 0.12) row = y + 1; }
    expect(row).toBeGreaterThan(0);
    const r0 = spread(raw.ao, row), b0 = spread(b.ao, row);
    expect(r0, 'the raw pass is noisy (the pattern)').toBeGreaterThan(0.01);
    expect(b0, 'the blur removes it').toBeLessThan(r0 / 3);
  });
});

describe('the apply: what the composite multiplies the scene by', () => {
  it('sky / AO off / bright pixels keep their colour; the occlusion fades with view distance; power and strength', () => {
    expect(aoFactor(0.4, 0.2, AO_LOOK, false)).toBe(1);
    expect(aoFactor(0.4, 0.2, AO_LOOK, true, true)).toBe(1);
    const dark = aoFactor(0.5, 0.1);
    expect(dark).toBeCloseTo(1 + (Math.pow(0.5, AO_LOOK.power) - 1) * AO_LOOK.strength, 9);
    expect(dark).toBeGreaterThan(1 - AO_LOOK.strength); // never fully black
    expect(aoFactor(0.5, AO_LOOK.guard[1] + 0.01)).toBe(1); // emissive fixtures, glow cards, muzzle flashes
    expect(aoFactor(0.5, (AO_LOOK.guard[0] + AO_LOOK.guard[1]) / 2)).toBeGreaterThan(dark);
    expect(aoFactor(1, 0.1)).toBe(1);
    // distance fade: the same crease geometry far away reads open (before the fog swallows it)
    const eye: V3 = [0, 1.62, 0];
    const far = castView(320, 180, 30, eye, {pitch: -0.05}, [FLOOR, {plane: [0, 0, 1], d: AO_LOOK.fade[1] + 2}]);
    for (const p of rawPixels(far, HIGH)) if (p.g > 0 && 1 / p.g >= AO_LOOK.fade[1]) expect(p.ao).toBe(1);
  });

  it('sizes follow the scale and the pixel cap; the cost arithmetic', () => {
    expect(aoSize(1920, 1080, HIGH)).toEqual([960, 540]);
    expect(aoSize(1280, 720, LOW)).toEqual([640, 360]);
    const big = aoSize(3456, 1944, HIGH);
    expect(big[0] * big[1]).toBeLessThanOrEqual(HIGH.maxPixels);
    expect(big[0] / big[1]).toBeCloseTo(16 / 9, 2);
    const lowBig = aoSize(1920, 1080, LOW);
    expect(lowBig[0] * lowBig[1]).toBeLessThanOrEqual(LOW.maxPixels);
    const c = aoCost(1920, 1080, HIGH);
    expect(c.rawPerPixel).toBe(1 + 4 + HIGH.slices * HIGH.steps * 2);
    expect(c.total).toBe(c.raw + c.blur + c.apply);
    expect(c.apply).toBe(1920 * 1080 * 4);
  });
});
