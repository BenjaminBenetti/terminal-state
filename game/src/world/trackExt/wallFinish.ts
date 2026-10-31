// Track 2 playtest revision (task studio-alpha-track2-playtest-revision-20261031-01, lane ART): the WALL FINISH of the track
// extensions. User: "The wall textures look low res".
//
// Diagnosis (docs/track-extensions.md "Wall finish"): the annex walls used the 'platformFace' material — the 256 x 256
// platform-authored-backing set (a 5.7 KB colour JPEG) stretched over 2 x 2 m = 128 texels / m, i.e. ~3x magnified at 2 m and ~6x
// at 1 m in a 1.5-2 m service corridor (1080p, 75 deg: ~380 screen px / m at 2 m), plus a 110 px / m formwork overlay. The tunnel
// shell walls used the bed lining 'tunnel' (1024 x 384 over 3.6 x 1.38 m = 284 texels / m) whose stamped repair patches repeat every
// 3.6 m along and FOUR times up a 5.5 m tunnel wall.
//
// Fix: ONE local procedural board-formed concrete set (canvas, generated once per page, deterministic; no image asset, no provider):
// colour 1024 x 1024 over 2.4 x 2.4 m = 427 texels / m (3.3x the annex density, 1.5x the tunnel's), roughness + normal 512 x 512 from
// the same height field (board seams, tie-cone holes, bug holes, grain imprint, panel joints). Two materials share it:
//   - annexWall: world-mapped (real-scale projection, the shared world-mapping program) with its MACRO tone variation (world-space
//     noise, ~1.4 m features: no two bays read the same) and floor grime, + the decay hook (platformFace profile);
//   - tunnelShell: the shell's developed wall UVs (u along the wall from the mouth, v from the bed floor) at the same 2.4 m span,
//     + the decay hook (tunnel profile; its world-space stain field breaks the repeat). The bed walls keep the station lining: a
//     concrete portal rib at the mouth (world/trackExt/shell.ts) marks where the station box ends and the cast tunnel starts.
// Both are created lazily per WorldMaterials (only a level with extensions pays for them: ~8 MiB GPU with mips) and kept for the
// session like every other shared material; they are in the station scene at build, so the warm-up prepares them (no first-use
// compile; docs/rendering-warmup.md).
//
// Task track2-round2 R1 (lane CONCRETE). User: "Wall texture looks low detail still, likely due to the distance, it just doesn't
// give that concrete vibe." Diagnosis (docs/track-extensions.md "Wall finish", R1; per-mip numbers from tests/r1-concrete-preview):
// the texel density was not the problem — at 1080p / 75 deg with the native 16x request the colour map is sampled at mip 0-2.6
// (<= 1.5 cm texels) everywhere within 10 m — but the set's CONTENT had almost no structure between 0.2 and 1.5 m: linear
// luminance varied 3.5 % (rel. std) at 0.3 m texels and 2.7 % at 0.6 m, roughness was a flat 0.87 +- 0.03, and the only strong
// mid-scale feature was a perfectly regular 0.15 m board-seam stripe that reads as plank cladding, not cast concrete. Its fine
// grain / speckle / 1-4 mm bug holes (most of the 15 % mip-0 variation) is gone by mip 2-3 — which a software rasterizer's 1x
// anisotropy cap (render/softwareGl.ts) reaches already at 2-4 m along a corridor wall (mip 3.7 at 4 m, 5.7 at 8 m).
// Fix (same three textures, same sizes, same materials / programs / draws): the energy moves into the scales that survive —
//   - cement-paste CLOUDINESS: a tileable, domain-warped value-noise fBm (1.2 / 0.6 / 0.3 / 0.15 m octaves, computed on a 256^2
//     grid and upsampled) in colour (+-~6 %), roughness and a little relief, plus a sparse level-set of darker curing / water stains;
//   - FORMWORK at mid scale: two 1.2 m panels of their own tone and sheen, boards of RANDOM widths (0.09-0.2 m: no regular stripe)
//     whose seams are faint, broken lines with small fins, slightly cupped board faces (float relief: per-board light / shade
//     under the flashlight), joints with grout-leak bleed and chipped arrises, a wavy pour-lift / cold joint;
//   - CONCRETE INCIDENTS: tie holes (open cones or grout plugs) with rust / water runs below, mortar patch repairs, honeycomb pockets
//     along the joints, lime (efflorescence) runs, hairline cracks, bug holes banded under board edges;
//   - a float relief field (board cupping, panel offset, pillowing between ties, paste undulation) added to the painted height
//     before the normal map (no 8-bit banding), and a real roughness range (0.6-1.0 instead of 0.75-1.0).
// Fine grain stays for the 1-2 m close-up. The anisotropy request path (render/anisotropy.ts, world/surfaceAnisotropy.ts) and the
// software guard are untouched: the maps are created exactly as before (8x at creation, 16x requested at build as 'wall').

import * as THREE from 'three';
import {Painter, type SurfaceSet} from '../canvasTextures';
import {SurfaceNodeMaterial, worldMapped, type WorldMaterials} from '../materials';
import {DECAY_PROFILES, applyDecay} from '../decay';

/** Finish key of the annex walls (levelGeometry WallKind 'annex' -> finishFor). */
export const ANNEX_WALL = 'annexWall';
/** Real span (m) of one repeat of the board-formed set, both ways. */
export const BOARD_SPAN = 2.4;
/** Pixel sizes: colour, and roughness / height (normal) layers. */
export const BOARD_PX = {color: 1024, detail: 512} as const;
/** Normal-map strength of the set's height field (Sobel gradient scale on the 512 px detail layer). */
const NORMAL_STRENGTH = 2.2;
/** R1: material normal scale (was 0.85) — the mid-scale relief carries the read at distance now. */
export const BOARD_NORMAL_SCALE = 1;
/** R1: world-space macro tone of the annex walls (world mapping wmGrime.z; was 0.32). A uniform value: same program. */
export const ANNEX_MACRO = 0.4;

/**
 * R1: the set's feature vocabulary and scales (metres), for the report and the focused tests. Mid-scale = what still reads at
 * 4-10 m once the fine grain has mipped away.
 */
export const BOARD_FEATURES = {
  panel: [1.2, 2.4] as const,
  boardWidth: [0.09, 0.2] as const,
  tieGrid: 0.6,
  cloudOctaves: [1.2, 0.6, 0.3, 0.15] as const,
  liftLine: 1.55,
  patches: 2,
  honeycomb: 2,
  rustRuns: [0.12, 0.45] as const,
  limeRuns: 3,
  cracks: 2,
} as const;

/** Tileable 2D value noise over `cells` x `cells` lattice cells per tile (smoothstep interpolation), u / v in tile units. */
function tileNoise(rnd: () => number, cells: number): (u: number, v: number) => number {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  return (u, v) => {
    const x = u * cells, y = v * cells, xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % cells) + cells) % cells, y0 = ((yi % cells) + cells) % cells, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1], c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** A zero-mean, unit-variance tileable field on a G x G grid: domain-warped fBm over the given lattice cell counts / weights. */
function fbmField(rnd: () => number, G: number, cells: readonly number[], weights: readonly number[], warp: number): Float32Array {
  const oct = cells.map(c => tileNoise(rnd, c));
  const wu = tileNoise(rnd, 4), wv = tileNoise(rnd, 4);
  const F = new Float32Array(G * G);
  let s = 0, s2 = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    let u = (x + 0.5) / G, v = (y + 0.5) / G;
    u += warp * (wu(u, v) - 0.5); v += warp * (wv(u, v) - 0.5);
    let f = 0;
    for (let k = 0; k < oct.length; k++) f += weights[k] * (oct[k](u, v) - 0.5);
    F[y * G + x] = f; s += f; s2 += f * f;
  }
  const n = G * G, mean = s / n, sd = Math.sqrt(Math.max(1e-12, s2 / n - mean * mean));
  for (let i = 0; i < n; i++) F[i] = (F[i] - mean) / sd;
  return F;
}

/** Bilinear, wrapping upsample of a G x G grid to N x N (pixel centres; separable index tables). */
function upsample(F: Float32Array, G: number, N: number): Float32Array {
  const i0 = new Int32Array(N), i1 = new Int32Array(N), w = new Float32Array(N);
  for (let i = 0; i < N; i++) { const t = ((i + 0.5) / N) * G - 0.5, f = Math.floor(t); i0[i] = ((f % G) + G) % G; i1[i] = (i0[i] + 1) % G; w[i] = t - f; }
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const r0 = i0[y] * G, r1 = i1[y] * G, wy = w[y];
    for (let x = 0; x < N; x++) {
      const a = F[r0 + i0[x]], b = F[r0 + i1[x]], c = F[r1 + i0[x]], d = F[r1 + i1[x]], wx = w[x];
      out[y * N + x] = (a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy;
    }
  }
  return out;
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Tangent-space normal map (glTF convention, +Y = image up; as canvasTextures normalFromHeight) from a FLOAT height field. */
function normalCanvas(H: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const o = img.data;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (H[ym + xp] + 2 * H[y0 + xp] + H[yp + xp]) - (H[ym + xm] + 2 * H[y0 + xm] + H[yp + xm]);
      const dy = (H[yp + xm] + 2 * H[yp + x] + H[yp + xp]) - (H[ym + xm] + 2 * H[ym + x] + H[ym + xp]);
      const nx = -dx * strength, ny = dy * strength; // canvas y points down = -v
      const l = 1 / Math.hypot(nx, ny, 1);
      const i = (y0 + x) * 4;
      o[i] = (nx * l * 0.5 + 0.5) * 255;
      o[i + 1] = (ny * l * 0.5 + 0.5) * 255;
      o[i + 2] = (l * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Random widths in [a, b] (m) scaled to fill `total` exactly (px), as cumulative edges [0, ..., total]. */
function boardEdges(p: Painter, total: number, ppm: number, [a, b]: readonly [number, number]): number[] {
  const ws: number[] = [];
  let sum = 0;
  while (sum < total / ppm - a * 0.5) { const w = p.rr(a, b); ws.push(w); sum += w; }
  const k = total / (sum * ppm), edges = [0];
  for (const w of ws) edges.push(edges[edges.length - 1] + w * ppm * k);
  edges[edges.length - 1] = total;
  return edges;
}

/** A soft vertical run (rust / water / lime) from (x, y) downward: tapered segments, alpha fading with length. */
function run(p: Painter, x: number, y: number, len: number, wdt: number, c: string, a: number, r?: number, h?: number): void {
  const seg = 8;
  for (let k = 0; k < seg; k++) {
    const y0 = y + (len * k) / seg, ww = wdt * (1 - k * 0.07), xx = x + p.rr(-0.8, 0.8);
    p.shape(ctx => ctx.rect(xx - ww / 2, y0, ww, len / seg + 1), {c, a: a * (1 - k / seg) ** 1.3, r, h}, [xx, y0, len / seg + ww]);
  }
}

/**
 * Board-formed cast concrete, BOARD_SPAN x BOARD_SPAN m, tiling: two 1.2 m formwork panels of random-width boards, tie holes on a
 * 0.6 m grid, a pour-lift line, the cement-paste cloud and the incidents of 30-60 years of service (see the R1 header).
 */
function boardFormed(seed: number): SurfaceSet {
  const N = BOARD_PX.color, D = BOARD_PX.detail, ppm = N / BOARD_SPAN, k = D / N;
  const p = new Painter(N, N, seed, {rough: k, height: k});
  const relief = new Float32Array(D * D); // float relief (height units) added to the painted 8-bit height before the normal map
  p.base({c: '#98948a', r: 0.8, h: 0.5});
  const panelW = BOARD_FEATURES.panel[0] * ppm;
  const tie = BOARD_FEATURES.tieGrid * ppm;
  // --- formwork panels: own tone + sheen; boards of random widths (no regular stripe) imprinted FAINTLY — a strong board relief
  //     read as plank cladding (R1) — as tone bands, broken hairline seams with small fins and a barely-there board plane
  const panelTone = [p.rr(-1, -0.4), p.rr(0.4, 1)];
  for (let px = 0; px < 2; px++) {
    const x0 = px * panelW, t = panelTone[px];
    const pc = t > 0 ? `rgba(176,172,163,${0.1 * t})` : `rgba(84,81,75,${-0.05 * t})`;
    p.shape(ctx => ctx.rect(x0, 0, panelW, N), {c: pc, r: 0.8 + 0.035 * t, h: 0.5}, [x0 + panelW / 2, N / 2, N]);
    const edges = boardEdges(p, N, ppm, BOARD_FEATURES.boardWidth);
    for (let b = 0; b + 1 < edges.length; b++) {
      const y0 = edges[b], y1 = edges[b + 1], bh = y1 - y0, tone = p.rr(-1, 1);
      const c = tone > 0 ? `rgba(178,174,165,${0.02 + tone * 0.05})` : `rgba(78,76,70,${0.02 - tone * 0.045})`;
      p.shape(ctx => ctx.rect(x0, y0, panelW, bh), {c, r: 0.8 + tone * 0.025 + p.rr(-0.02, 0.02)}, [x0 + panelW / 2, y0 + bh / 2, panelW]);
      // the board's own plane: a hair-thin step at its seams, no cupping
      const off = p.rr(-0.006, 0.006), xa = Math.floor(x0 * k), xb = Math.floor((x0 + panelW) * k);
      for (let yy = Math.floor(y0 * k); yy < Math.floor(y1 * k); yy++) for (let xx = xa; xx < xb; xx++) relief[(((yy % D) + D) % D) * D + xx] += off;
      // wood-grain imprint, very faint (close-up only)
      for (let g = 0; g < 3; g++) {
        const y = y0 + p.rr(3, bh - 3), xa2 = x0 + p.rr(0, panelW * 0.6), len = p.rr(panelW * 0.2, panelW * 0.5);
        p.shape(ctx => { ctx.moveTo(xa2, y); ctx.lineTo(Math.min(x0 + panelW - 2, xa2 + len), y + p.rr(-1.5, 1.5)); }, {c: p.rnd() < 0.5 ? 'rgba(62,60,55,0.05)' : 'rgba(190,186,176,0.045)', h: 0.49}, [xa2 + len / 2, y, len], p.rr(1, 2));
      }
      // the seam at the board's top edge: faint, broken (segments), a small fin of grout here and there
      let sx = x0;
      while (sx < x0 + panelW - 4) {
        const seg = Math.min(x0 + panelW - sx, p.rr(40, 220)), on = p.rnd() < 0.6, yj = y0 + p.rr(-0.6, 0.6), sx0 = sx;
        if (on) {
          p.shape(ctx => ctx.rect(sx0, yj - 0.7, seg, 1.4), {c: 'rgba(60,58,53,0.16)', r: 0.86, h: 0.47}, [sx0 + seg / 2, yj, seg]);
          if (p.rnd() < 0.3) p.shape(ctx => ctx.rect(sx0, yj + 1, seg * p.rr(0.3, 0.8), 1.2), {c: 'rgba(196,192,182,0.12)', h: 0.54}, [sx0 + seg / 2, yj + 1, seg]);
        }
        sx += seg;
      }
      // bug holes banded just under the board edge (air trapped under the board)
      for (let i = 0, n = Math.round(p.rr(1, 6)); i < n; i++) {
        const x = x0 + p.rr(0, panelW), y = y0 + p.rr(1, 7), r = p.rr(0.6, 1.7);
        p.shape(ctx => ctx.ellipse(x, y, r, r * p.rr(0.6, 1), p.rr(0, 3), 0, Math.PI * 2), {c: 'rgba(40,38,34,0.62)', r: 1, h: 0.38}, [x, y, r + 1]);
      }
    }
    // panel B stands a hair proud of panel A (a step at the joints)
    if (px === 1) for (let yy = 0; yy < D; yy++) for (let xx = Math.floor(x0 * k); xx < Math.floor((x0 + panelW) * k); xx++) relief[yy * D + xx] += 0.025;
  }
  // --- panel joints: grout-leak line with a fin, sand-streaked bleed band beside it, chipped arrises
  const joint = (vertical: boolean, at: number) => {
    const L = N;
    const rect = (a: number, w: number) => (ctx: CanvasRenderingContext2D) => (vertical ? ctx.rect(at + a, 0, w, L) : ctx.rect(0, at + a, L, w));
    const b: [number, number, number] = vertical ? [at, N / 2, N] : [N / 2, at, N];
    p.shape(rect(-1.8, 3.6), {c: 'rgba(46,44,40,0.62)', r: 0.97, h: 0.36}, b);
    p.shape(rect(1.8, 2.2), {c: 'rgba(198,194,184,0.28)', h: 0.6}, b);
    // bleed: darker, rougher paste loss along one side, irregular width (soft dabs: no stepped edge)
    for (let s = 0; s < L; s += 16) {
      const r = p.rr(5, 16), o = -r * 0.6 - 2;
      p.soft(vertical ? at + o : s, vertical ? s : at + o, r, {c: '#46433d', a: p.rr(0.06, 0.16), r: 0.92});
    }
    for (let i = 0; i < 5; i++) {
      const s = p.rr(0, L), r = p.rr(3, 9), cx = vertical ? at + p.rr(-3, 3) : s, cy = vertical ? s : at + p.rr(-3, 3);
      p.shape(p.blob(cx, cy, r), {c: 'rgba(170,166,156,0.85)', r: 0.95, h: 0.42}, [cx, cy, r * 1.4]);
      p.shape(p.blob(cx + 1, cy + 1.5, r * 0.5), {c: 'rgba(48,46,42,0.5)', h: 0.38}, [cx, cy, r * 1.4]);
    }
  };
  joint(true, 0);
  joint(true, panelW);
  joint(false, 0);
  // --- pour lift / cold joint: a wavy line across the tile, the upper lift a shade lighter, honeycomb and bug holes along it
  const liftY = N - BOARD_FEATURES.liftLine * ppm;
  const liftPts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) liftPts.push([(i / 24) * N, liftY + (i === 0 || i === 24 ? 0 : p.rr(-5, 5))]);
  liftPts[24][1] = liftPts[0][1];
  p.shape(ctx => { ctx.moveTo(0, 0); ctx.lineTo(N, 0); for (let i = 24; i >= 0; i--) ctx.lineTo(liftPts[i][0], liftPts[i][1]); ctx.closePath(); }, {c: 'rgba(182,178,168,0.07)', r: 0.82}, [N / 2, liftY / 2, N]);
  p.shape(ctx => { ctx.moveTo(liftPts[0][0], liftPts[0][1]); for (const [x, y] of liftPts) ctx.lineTo(x, y); }, {c: 'rgba(52,50,45,0.3)', r: 0.95, h: 0.42}, [N / 2, liftY, N], 1.6);
  for (let i = 0; i < 40; i++) {
    const x = p.rr(0, N), y = liftY + p.rr(-3, 9), r = p.rr(0.6, 2);
    p.shape(ctx => ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2), {c: 'rgba(36,34,31,0.62)', r: 1, h: 0.36}, [x, y, r + 1]);
  }
  // --- honeycomb pockets (rock pockets where paste leaked at a joint / the lift)
  const honey = (cx: number, cy: number, rad: number) => {
    p.soft(cx, cy, rad * 1.1, {c: '#423f39', a: 0.35, r: 1, h: 0.4});
    for (let i = 0; i < rad * 2.2; i++) {
      const a = p.rr(0, Math.PI * 2), d = rad * Math.sqrt(p.rnd()) * 0.9, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, r = p.rr(1, 3.6);
      if (p.rnd() < 0.6) p.shape(p.blob(x, y, r), {c: 'rgba(28,27,24,0.8)', r: 1, h: 0.18}, [x, y, r * 1.4]);
      else p.shape(p.blob(x, y, r * 0.9), {c: 'rgba(168,162,150,0.7)', r: 0.95, h: 0.47}, [x, y, r * 1.4]);
    }
  };
  honey(panelW + p.rr(8, 30), liftY + p.rr(10, 40), p.rr(0.05, 0.09) * ppm);
  honey(p.rr(0.2, 0.9) * ppm, N - p.rr(4, 30), p.rr(0.04, 0.08) * ppm);
  // --- tie holes on the 0.6 m grid: open cones (dark, recessed ring) or grout plugs (lighter disc); rust / water runs below some
  for (let gy = tie / 2; gy < N; gy += tie) for (let gx = tie / 2; gx < N; gx += tie) {
    const x = gx + p.rr(-2.5, 2.5), y = gy + p.rr(-2.5, 2.5);
    if (p.rnd() < 0.55) {
      const r = 0.013 * ppm;
      p.soft(x, y + 1, r * 2.6, {c: '#3a3833', a: 0.32, h: 0.42});
      p.shape(ctx => ctx.ellipse(x, y, r * 1.5, r * 1.5, 0, 0, Math.PI * 2), {c: 'rgba(58,56,51,0.55)', r: 0.95, h: 0.34}, [x, y, r * 2]);
      p.shape(ctx => ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2), {c: '#1b1a18', r: 1, h: 0.08}, [x, y, r * 1.2]);
    } else {
      const r = 0.022 * ppm * p.rr(0.85, 1.1);
      p.shape(p.blob(x, y, r, 0.16, 14), {c: 'rgba(160,155,145,0.72)', r: 0.86, h: 0.51}, [x, y, r * 1.3]);
      p.shape(ctx => ctx.ellipse(x, y, r * 1.02, r * 1.02, 0, 0, Math.PI * 2), {c: 'rgba(50,48,44,0.28)', h: 0.46}, [x, y, r * 1.3], 1);
    }
    if (p.rnd() < 0.38) {
      const rust = p.rnd() < 0.6;
      run(p, x + p.rr(-2, 2), y + 6, p.rr(BOARD_FEATURES.rustRuns[0], BOARD_FEATURES.rustRuns[1]) * ppm, p.rr(5, 11),
        rust ? 'rgb(104,74,46)' : 'rgb(58,56,50)', p.rr(0.16, 0.3), rust ? 0.82 : 0.76);
    }
  }
  // --- mortar patch repairs (lighter, warmer, trowelled smoother; a hairline shrinkage ring)
  for (let i = 0; i < BOARD_FEATURES.patches; i++) {
    const cx = i === 0 ? panelW + p.rr(-40, 40) : p.rr(0.15, 0.95) * panelW, cy = p.rr(0.1, 0.9) * N, rad = p.rr(0.06, 0.11) * ppm;
    const path = p.blob(cx, cy, rad, 0.2, 24);
    p.shape(path, {c: 'rgba(170,165,154,0.38)', r: 0.74, h: 0.525}, [cx, cy, rad * 1.4]);
    for (let s = 0; s < 5; s++) p.soft(cx + p.rr(-0.6, 0.6) * rad, cy + p.rr(-0.6, 0.6) * rad, rad * p.rr(0.3, 0.6), {c: p.rnd() < 0.5 ? '#a9a598' : '#8e8a80', a: 0.25, r: p.rr(0.68, 0.8)});
    p.shape(path, {c: 'rgba(56,54,49,0.26)', r: 0.95, h: 0.48}, [cx, cy, rad * 1.4], 1);
  }
  // --- lime runs (efflorescence leaching from the lift / joints)
  for (let i = 0; i < BOARD_FEATURES.limeRuns; i++) {
    const x = i === 0 ? panelW + p.rr(4, 12) : p.rr(0, N), y = i === 0 ? p.rr(0.1, 0.6) * N : liftY + 4;
    run(p, x, y, p.rr(0.15, 0.6) * ppm, p.rr(4, 9), 'rgb(222,218,206)', p.rr(0.08, 0.15), 0.94, 0.52);
  }
  // --- hairline cracks
  for (let i = 0; i < BOARD_FEATURES.cracks; i++) {
    const x = p.rr(0, N), y = p.rr(0, N), len = p.rr(0.2, 0.55) * ppm;
    for (let s = 0, cx = x, cy = y, a = p.rr(1.2, 1.9); s < 5; s++) {
      const path = p.scratch(cx, cy, len / 5, a), x0 = cx, y0 = cy;
      p.shape(path, {c: 'rgba(40,38,34,0.38)', r: 0.95, h: 0.43}, [x0, y0, len / 4], p.rr(0.9, 1.4));
      cx += Math.cos(a) * len / 5; cy += Math.sin(a) * len / 5; a += p.rr(-0.4, 0.4);
    }
  }
  // --- bug holes (surface air voids) and fine aggregate speckle, for the 1-2 m close-up
  for (let i = 0; i < 420; i++) {
    const x = p.rr(0, N), y = Math.pow(p.rnd(), 0.75) * N, r = p.rr(0.5, 1.9);
    p.shape(ctx => ctx.ellipse(x, y, r, r * p.rr(0.6, 1), p.rr(0, 3), 0, Math.PI * 2), {c: 'rgba(38,36,32,0.66)', r: 1, h: 0.36}, [x, y, r + 1]);
  }
  for (let i = 0; i < 2600; i++) {
    const x = p.rr(0, N), y = p.rr(0, N), r = p.rr(0.5, 1.4);
    p.shape(ctx => ctx.rect(x, y, r, r), {c: p.rnd() < 0.5 ? 'rgba(204,200,190,0.32)' : 'rgba(78,75,69,0.32)'}, [x, y, r + 1]);
  }
  // --- cement-paste cloud (fBm, 1.2-0.15 m) + a sparse level-set of darker curing / water stains, on a 256^2 grid: colour,
  //     roughness and relief (multiplicative on colour, so every feature above shares the cloud)
  const G = 256;
  // (the 1.2 m octave stays weak and the stains small: a large distinctive shape would mark the 2.4 m repeat; the world-space
  // macro tone of the world mapping and the decay hook carry the variation above ~1 m)
  const cloud = fbmField(p.rnd, G, [2, 4, 8, 16], [0.22, 0.32, 0.24, 0.14], 0.06);
  const stain = fbmField(p.rnd, G, [6, 12, 24], [0.5, 0.32, 0.18], 0.12);
  // per grid cell: colour factor (cloud x stain level set, its edge broken by the cloud: irregular, not a smooth blob), the blue
  // channel's (stains a touch warmer), roughness offset and relief; upsampled once per layer (bilinear, wrapping)
  const fac = new Float32Array(G * G), facB = new Float32Array(G * G), rgh = new Float32Array(G * G), rel = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) {
    const c = cloud[i], s = smooth(0.8, 1.7, stain[i] + 0.3 * c);
    fac[i] = (1 + 0.055 * c) * (1 - 0.065 * s); facB[i] = fac[i] * (1 - 0.015 * s); rgh[i] = 0.035 * c - 0.05 * s; rel[i] = 0.025 * c;
  }
  const ctx = p.ctx, img = ctx.getImageData(0, 0, N, N), d = img.data, F1 = upsample(fac, G, N), F2 = upsample(facB, G, N);
  for (let j = 0, i = 0; j < N * N; j++, i += 4) { d[i] *= F1[j]; d[i + 1] *= F1[j]; d[i + 2] *= F2[j]; }
  ctx.putImageData(img, 0, 0);
  const rctx = p.rough!.getContext('2d', {willReadFrequently: true})!, rimg = rctx.getImageData(0, 0, D, D), rd = rimg.data;
  const hctx = p.height!.getContext('2d', {willReadFrequently: true})!, hd = hctx.getImageData(0, 0, D, D).data;
  const R = upsample(rgh, G, D), Rl = upsample(rel, G, D);
  // pillowing between the ties (forms bulge between tie rows / columns)
  const pil = new Float32Array(D);
  for (let x = 0; x < D; x++) pil[x] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (((x + 0.5) / D) * BOARD_SPAN - BOARD_FEATURES.tieGrid / 2)) / BOARD_FEATURES.tieGrid);
  // + a fine "orange peel" of the cast face (1.9 / 3.75 cm cells): the pitted, non-wood micro-shading under the flashlight up close
  const peelA = tileNoise(p.rnd, 128), peelB = tileNoise(p.rnd, 64);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const u = (x + 0.5) / D, v = (y + 0.5) / D, j = y * D + x, i = j * 4;
    const rv = Math.min(255, Math.max(0, rd[i] + 255 * R[j]));
    rd[i] = rd[i + 1] = rd[i + 2] = rv;
    relief[j] += Rl[j] + 0.1 * pil[x] * pil[y] + 0.014 * (peelA(u, v) - 0.5) + 0.02 * (peelB(u, v) - 0.5);
  }
  rctx.putImageData(rimg, 0, 0);
  p.grain(8);
  const H = new Float32Array(D * D);
  for (let i = 0; i < D * D; i++) H[i] = hd[i * 4] / 255 + relief[i];
  const set = p.finish([BOARD_SPAN, BOARD_SPAN], 0);
  // the normal map from the float field, created exactly like the set's other maps (canvasTextures surfaceTexture: linear data,
  // repeat wrap, the same creation anisotropy and default mipmapped filters)
  const nt = new THREE.CanvasTexture(normalCanvas(H, D, D, NORMAL_STRENGTH));
  nt.colorSpace = THREE.NoColorSpace;
  nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
  nt.anisotropy = set.map.anisotropy;
  return {...set, normalMap: nt};
}

let boardSet: SurfaceSet | null = null;
/** The shared board-formed set (painted on first use, kept for the page). */
export function boardFormedSet(): SurfaceSet {
  return (boardSet ??= boardFormed(20261031));
}
/** Tests / previews that swap the canvas implementation. */
export function resetBoardFormedSet(): void { boardSet = null; }

const annexMats = new WeakMap<WorldMaterials, THREE.Material>();
const shellMats = new WeakMap<WorldMaterials, THREE.Material>();

/** The annex wall material (world-mapped board-formed concrete with macro variation, aged), shared per WorldMaterials. */
export function annexWallMaterial(mats: WorldMaterials): THREE.Material {
  let m = annexMats.get(mats);
  if (!m) {
    const s = boardFormedSet();
    const mm = new SurfaceNodeMaterial({map: s.map, roughnessMap: s.roughnessMap, normalMap: s.normalMap, roughness: 1, metalness: 0, color: 0xaeaaa0});
    mm.normalScale.set(BOARD_NORMAL_SCALE, BOARD_NORMAL_SCALE);
    // R1: macro 0.32 -> ANNEX_MACRO (world-space, ~1.4 m features, never repeats: the pour-to-pour tone a 2.4 m tile cannot carry)
    worldMapped(mm, {span: [BOARD_SPAN, BOARD_SPAN], grime: [0.32, 0.5], macro: ANNEX_MACRO});
    mm.name = 'annex-wall';
    applyDecay(mm, DECAY_PROFILES.platformFace);
    annexMats.set(mats, (m = mm));
  }
  return m;
}

/** The tunnel shell wall material (board-formed concrete on the shell's developed UVs, aged), shared per WorldMaterials. */
export function tunnelShellMaterial(mats: WorldMaterials): THREE.Material {
  let m = shellMats.get(mats);
  if (!m) {
    const s = boardFormedSet();
    const mm = new SurfaceNodeMaterial({map: s.map, roughnessMap: s.roughnessMap, normalMap: s.normalMap, roughness: 1, metalness: 0, color: 0xb2aea4});
    mm.normalScale.set(BOARD_NORMAL_SCALE, BOARD_NORMAL_SCALE);
    mm.name = 'track-ext-shell-wall';
    applyDecay(mm, DECAY_PROFILES.tunnel);
    shellMats.set(mats, (m = mm));
  }
  return m;
}

/** The extension wall materials built so far for `mats` (wall detail: they are cuttable base walls like the station's). */
export function extensionWallMaterials(mats: WorldMaterials): THREE.Material[] {
  return [annexMats.get(mats), shellMats.get(mats)].filter((m): m is THREE.Material => !!m);
}

/** Texels per metre of the board-formed colour map (report / tests). */
export const BOARD_TEXELS_PER_M = BOARD_PX.color / BOARD_SPAN;
