// Iteration 08 (Lane W): the shared wall-detail texture atlases, generated once per page from canvas
// drawing (no image assets, no generation services): one DETAIL atlas (colour + alpha, roughness,
// normal) holding cut-out decals (cracks, chips, joints, formwork), exposed-substrate surfaces for
// insets and breaches (mortar bed, bare block, brick, raw concrete, cavity, fractured section) and
// flush finishes (accent tile bands, tile pilasters, replacement tile / paint / render patches); one
// small SOFT atlas of alpha-graded stains (water streaks, efflorescence, damp tide marks, soot,
// grime, scuffs) tinted per instance with vertex colours; and a per-station name tablet (frieze).
//
// Cell sizes are in real metres; cells are packed deterministically (skyline by height) so the
// geometry code can map UVs in metres. Tiled finishes are drawn on the same grids as the base wall
// textures (subway tile 0.36 x 0.15 m running bond, painted block 0.4 x 0.2 m) so insets and patches
// line up with the surrounding joints when the geometry aligns its UV origin to that grid.

import * as THREE from 'three';
import {Painter, mixHex, type SurfaceSet} from './canvasTextures';
import {requestSurfaceAnisotropy} from '../render/anisotropy'; // lane FIX (U08)

export type AtlasId = 'detail' | 'soft';
type Pt = [number, number];
type PathFn = (ctx: CanvasRenderingContext2D) => void;
interface Val { c?: string; r?: number; h?: number; a?: number }

interface CellSpec {
  atlas: AtlasId;
  /** Real size (m). */
  w: number; h: number;
  /** Pixels per metre. */
  ppm: number;
  draw: (p: Painter, W: number, H: number, ppm: number) => void;
}

/** Atlas pixel sizes. */
export const ATLAS_SIZE: Record<AtlasId, [number, number]> = {detail: [1024, 1024], soft: [512, 512]};
const PAD = 4;

// ---- drawing helpers (cell-local; features stay inside the cell) ----------------------------

const poly = (pts: Pt[], close = true): PathFn => ctx => { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (close) ctx.closePath(); };
const rect = (x: number, y: number, w: number, h: number): PathFn => ctx => ctx.rect(x, y, w, h);
const ell = (x: number, y: number, rx: number, ry: number, rot = 0): PathFn => ctx => ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
/** Draw once (no wrap-around copies: bounds = the cell centre with zero radius). */
const shape = (p: Painter, f: PathFn, v: Val, lw = 0) => p.shape(f, v, [p.w / 2, p.h / 2, 0], lw);
function soft(p: Painter, x: number, y: number, r: number, v: Val): void {
  // Painter.soft repeats across edges for tiling textures; clamp inside the cell instead.
  if (x - r < 0 || y - r < 0 || x + r > p.w || y + r > p.h) r = Math.max(1, Math.min(r, x, y, p.w - x, p.h - y));
  p.soft(x, y, r, v);
}
function mottle(p: Painter, n: number, rMin: number, rMax: number, tones: string[], alpha: number, rough?: [number, number]): void {
  for (let i = 0; i < n; i++) soft(p, p.rr(0, p.w), p.rr(0, p.h), p.rr(rMin, rMax), {c: p.pick(tones), a: alpha * p.rr(0.4, 1), r: rough ? p.rr(rough[0], rough[1]) : undefined});
}
function speckle(p: Painter, n: number, r: [number, number], colors: string[], v: Omit<Val, 'c'> = {}): void {
  for (let i = 0; i < n; i++) { const x = p.rr(2, p.w - 2), y = p.rr(2, p.h - 2), rr = p.rr(r[0], r[1]); shape(p, ell(x, y, rr, rr * p.rr(0.5, 1), p.rr(0, 3)), {c: p.pick(colors), ...v}); }
}
function jagLine(p: Painter, x0: number, y0: number, x1: number, y1: number, n: number, amp: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([x0 + (x1 - x0) * t + (i && i < n ? p.rr(-amp, amp) : 0), y0 + (y1 - y0) * t + (i && i < n ? p.rr(-amp, amp) : 0)]); }
  return pts;
}
/** Branching crack polyline network from (x, y) heading `ang`. */
function crack(p: Painter, x: number, y: number, ang: number, len: number, lw: number, depth: number): void {
  const pts: Pt[] = [[x, y]];
  let a = ang, px = x, py = y;
  const steps = Math.max(3, Math.round(len / 10));
  for (let i = 0; i < steps; i++) {
    a += p.rr(-0.45, 0.45);
    px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
    px = Math.min(p.w - 3, Math.max(3, px)); py = Math.min(p.h - 3, Math.max(3, py));
    pts.push([px, py]);
    if (depth > 0 && p.rnd() < 0.18) crack(p, px, py, a + p.rr(0.5, 1.1) * (p.rnd() < 0.5 ? -1 : 1), len * p.rr(0.25, 0.5), lw * 0.7, depth - 1);
  }
  shape(p, poly(pts, false), {c: '#e4dccb', a: 0.55, h: 0.55}, lw + 1.6);
  shape(p, poly(pts, false), {c: '#1b1916', a: 0.95, r: 0.95, h: 0.15}, lw);
}

// Subway tile grid (base wall texture): 0.36 x 0.15 m running bond; course parity 0 = joints at 0.18.
const TILE_W = 0.36, TILE_H = 0.15;
function subwayTiles(p: Painter, ppm: number, rows: number, faceTone: () => string, firstOffset: boolean, rough: [number, number]): void {
  const g = Math.max(2, Math.round(0.004 * ppm));
  for (let r = 0; r < rows; r++) {
    const y1 = p.h - r * TILE_H * ppm, y0 = y1 - TILE_H * ppm;
    const off = ((r % 2 === 0) === firstOffset ? TILE_W / 2 : 0) * ppm;
    for (let x = off - TILE_W * ppm; x < p.w; x += TILE_W * ppm) {
      const xa = Math.max(0, x + g / 2), xb = Math.min(p.w, x + TILE_W * ppm - g / 2);
      if (xb - xa < 1) continue;
      shape(p, rect(xa, y0 + g / 2, xb - xa, TILE_H * ppm - g), {c: faceTone(), r: p.rr(rough[0], rough[1]), h: 0.66});
      shape(p, rect(xa + g, y0 + g, xb - xa - 2 * g, TILE_H * ppm - 2 * g), {h: 0.7});
      // Glaze highlight toward the top of each tile.
      shape(p, rect(xa + g, y0 + g, xb - xa - 2 * g, (TILE_H * ppm - 2 * g) * 0.3), {c: '#ffffff', a: 0.12});
    }
  }
}

// ---- detail atlas cells ------------------------------------------------------------------------

const D = (w: number, h: number, ppm: number, draw: CellSpec['draw']): CellSpec => ({atlas: 'detail', w, h, ppm, draw});
const S = (w: number, h: number, ppm: number, draw: CellSpec['draw']): CellSpec => ({atlas: 'soft', w, h, ppm, draw});

export const ATLAS_CELLS = {
  // Exposed substrates (opaque; insets, breach backs/sides).
  /** Tile adhesive bed left where tiles fell: combed ridges, tile-back fragments, grout remnants on the tile grid. */
  mortarBed: D(2.16, 1.2, 160, (p, W, H, ppm) => {
    p.base({c: '#6c675e', r: 0.95, h: 0.45});
    mottle(p, 40, 8, 40, ['#77716a', '#5c5850', '#837c70'], 0.5);
    // Notched-trowel ridges (slightly wavy horizontal combing).
    for (let y = 4; y < H; y += 7) shape(p, poly(jagLine(p, 0, y, W, y + p.rr(-2, 2), 12, 1.2), false), {c: p.pick(['#8a8478', '#4f4b45']), a: 0.55, h: 0.62}, 2.2);
    // Grout remnants on the tile joints (cell bottom = offset course).
    const g = '#b3ab9a';
    for (let r = 0; r < 8; r++) {
      const y1 = H - r * TILE_H * ppm;
      shape(p, rect(0, y1 - 2, W, 3), {c: g, a: 0.55, h: 0.6});
      const off = (r % 2 === 0 ? TILE_W / 2 : 0) * ppm;
      for (let x = off; x < W; x += TILE_W * ppm) shape(p, rect(x - 1.5, y1 - TILE_H * ppm, 3, TILE_H * ppm), {c: g, a: 0.5, h: 0.6});
    }
    // Fragments of tile backs still stuck in the bed (buff biscuit, glaze chips).
    for (let i = 0; i < 14; i++) { const x = p.rr(10, W - 30), y = p.rr(10, H - 20); shape(p, p.blob(x, y, p.rr(4, 12), 0.9, 7), {c: p.pick(['#c9b79a', '#d8cdb8', '#bfa98a']), r: 0.8, h: 0.72}); }
    // Damp darkening where water got behind the tiles.
    for (let i = 0; i < 5; i++) soft(p, p.rr(30, W - 30), p.rr(30, H - 30), p.rr(20, 60), {c: '#3e3a34', a: 0.3});
    speckle(p, 800, [0.5, 1.4], ['#6d685f', '#a8a296', '#5c5852'], {a: 0.7});
    p.grain(10);
  }),
  /** Bare grey concrete block (0.4 x 0.2 m running bond, cell bottom = even course). */
  blockBare: D(1.6, 1.2, 160, (p, W, H, ppm) => {
    p.base({c: '#8b8881', r: 0.9, h: 0.55});
    mottle(p, 50, 10, 50, ['#96938b', '#7d7a73', '#a09c93', '#86827a'], 0.5);
    speckle(p, 1400, [0.5, 1.6], ['#6f6c66', '#a5a198', '#5f5c57', '#b3aea3'], {a: 0.8});
    const bw = 0.4 * ppm, bh = 0.2 * ppm;
    for (let r = 0; r < 6; r++) {
      const y1 = H - r * bh;
      shape(p, rect(0, y1 - 2, W, 4), {c: '#a49d8e', r: 0.95, h: 0.3});
      for (let x = (r % 2) * bw / 2; x <= W; x += bw) shape(p, rect(x - 2, y1 - bh, 4, bh), {c: '#a49d8e', r: 0.95, h: 0.3});
    }
    // Paint residue at random spots (old coats).
    for (let i = 0; i < 6; i++) { const x = p.rr(10, W - 10), y = p.rr(10, H - 10); shape(p, p.blob(x, y, p.rr(2, 7), 0.9, 7), {c: p.pick(['#4c7c79', '#d4cbb2', '#c9c0a6']), a: 0.85, h: 0.58}); }
    p.grain(9);
  }),
  /** Old red-brown brick behind plaster (0.2 x 0.075 m courses). */
  brickBare: D(0.8, 0.6, 200, (p, W, H, ppm) => {
    p.base({c: '#8c8173', r: 0.95, h: 0.35});
    const bw = 0.2 * ppm, bh = 0.075 * ppm;
    for (let r = 0; r * bh < H; r++) for (let x = (r % 2) * bw / 2 - bw; x < W; x += bw) {
      const xa = Math.max(0, x + 2), xb = Math.min(W, x + bw - 2);
      if (xb - xa < 2) continue;
      shape(p, rect(xa, H - (r + 1) * bh + 2, xb - xa, bh - 4), {c: mixHex(p.pick(['#7d4632', '#8a5038', '#6f3c2b', '#94573c']), '#6d6458', p.rr(0, 0.35)), r: p.rr(0.75, 0.9), h: 0.62});
    }
    mottle(p, 20, 6, 24, ['#b9b0a0', '#5a3528'], 0.35);
    speckle(p, 300, [0.5, 1.3], ['#3d2a20', '#a89a86'], {a: 0.6});
    p.grain(10);
  }),
  /** Spalled cast concrete: exposed aggregate, pits, rust bleed. */
  concreteRaw: D(1.0, 1.0, 180, p => {
    p.base({c: '#7c7870', r: 0.95, h: 0.4});
    mottle(p, 40, 10, 50, ['#878279', '#6b6760', '#8f8a80'], 0.55);
    for (let i = 0; i < 520; i++) { const x = p.rr(3, p.w - 3), y = p.rr(3, p.h - 3), r = p.rr(1.2, 4.5); shape(p, p.blob(x, y, r, 0.7, 7), {c: p.pick(['#9a948a', '#6a655e', '#a89f90', '#5b5650', '#8a7a68']), r: p.rr(0.7, 0.9), h: p.rr(0.5, 0.75)}); }
    for (let i = 0; i < 40; i++) { const x = p.rr(4, p.w - 4), y = p.rr(4, p.h - 4), r = p.rr(1, 3); shape(p, ell(x, y, r, r), {c: '#3b3834', h: 0.15, r: 1}); }
    for (let i = 0; i < 4; i++) soft(p, p.rr(20, p.w - 20), p.rr(20, p.h - 20), p.rr(12, 30), {c: '#7a4a2a', a: 0.35});
    p.grain(10);
  }),
  /** Inside a broken blockwork wall: hollow block cores, webs, dust, deep shadow. */
  cavity: D(1.0, 0.8, 200, (p, W, H, ppm) => {
    p.base({c: '#4a4741', r: 0.95, h: 0.5});
    const bw = 0.4 * ppm, bh = 0.2 * ppm;
    for (let r = 0; r < 4; r++) for (let x = (r % 2) * bw / 2 - bw; x < W; x += bw) {
      const y0 = H - (r + 1) * bh;
      // Two dark cores per block with a lighter web between.
      for (const k of [0.27, 0.73]) {
        const cx = x + bw * k, cy = y0 + bh / 2;
        if (cx < 8 || cx > W - 8) continue;
        shape(p, rect(cx - bw * 0.17, cy - bh * 0.32, bw * 0.34, bh * 0.64), {c: '#1c1b19', r: 1, h: 0.1});
        soft(p, cx, cy, bh * 0.45, {c: '#121110', a: 0.6});
      }
      shape(p, rect(Math.max(0, x), y0, 3, bh), {c: '#6e6a62', h: 0.55});
    }
    mottle(p, 30, 8, 40, ['#5c5851', '#3a3833', '#66615a'], 0.35);
    speckle(p, 400, [0.6, 1.8], ['#77726a', '#2e2c29'], {a: 0.6});
    p.grain(8);
  }),
  /** Fractured section for inset / breach sides (u along the edge, v = depth from the face). */
  breakSide: D(1.0, 0.3, 220, p => {
    p.base({c: '#77736b', r: 0.95, h: 0.5});
    for (let i = 0; i < 160; i++) { const x = p.rr(2, p.w - 2), y = p.rr(2, p.h - 2), r = p.rr(1.5, 5); shape(p, p.blob(x, y, r, 0.8, 6), {c: p.pick(['#8c877e', '#5e5a54', '#9a9387']), h: p.rr(0.3, 0.8)}); }
    // Darker with depth (v = 1 deep inside the wall).
    for (let k = 0; k < 8; k++) shape(p, rect(0, p.h * k / 8, p.w, p.h / 8 + 1), {c: '#1a1917', a: 0.06 * k});
    shape(p, rect(0, 0, p.w, 3), {c: '#b7b0a2', a: 0.6});
    p.grain(10);
  }),
  /** Tile edge where tiles broke away: glaze, buff biscuit, grey adhesive (v = depth, 0.02 m). */
  tileBody: D(1.0, 0.02, 300, p => {
    p.base({c: '#8f897d', r: 0.9, h: 0.5});
    shape(p, rect(0, 0, p.w, p.h * 0.18), {c: '#e8e2d3', r: 0.2});
    shape(p, rect(0, p.h * 0.18, p.w, p.h * 0.32), {c: '#c8ad8a', r: 0.85});
    for (let i = 0; i < 60; i++) shape(p, rect(p.rr(0, p.w), p.h * 0.18, p.rr(1, 4), p.h * 0.32), {c: '#a88f70', a: 0.5});
  }),
  // Flush finishes (opaque, tinted per instance; white-ish base).
  /** Replacement subway tiles (cell bottom = offset course, as the base wall's even courses). */
  tilePatch: D(1.44, 0.6, 284, (p, _W, _H, ppm) => {
    p.base({c: '#9a958a', r: 0.85, h: 0.3});
    subwayTiles(p, ppm, 4, () => mixHex('#f1efe8', p.pick(['#e6e3da', '#fbfaf5', '#ecebe4']), p.rr(0, 1)), true, [0.12, 0.22]);
    mottle(p, 16, 10, 40, ['#d8d2c4'], 0.18);
    p.grain(5);
  }),
  /** Replacement 150 mm square shop tiles. */
  shopTilePatch: D(0.6, 0.6, 284, (p, _W, _H, ppm) => {
    p.base({c: '#9a958a', r: 0.85, h: 0.3});
    const s = 0.15 * ppm, g = 3;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) shape(p, rect(i * s + g / 2, j * s + g / 2, s - g, s - g), {c: mixHex('#f3f1ea', '#e2dfd5', p.rr(0, 1)), r: p.rr(0.12, 0.22), h: 0.66});
    p.grain(5);
  }),
  /** Fresh repaint (roller stipple, brushed edges); tinted to a near-miss of the surrounding paint. */
  paintPatch: D(1.0, 1.0, 96, p => {
    p.base({c: '#f2f0ea', r: 0.82, h: 0.5});
    mottle(p, 30, 4, 18, ['#e8e5dd', '#faf9f5'], 0.4);
    for (const [x, y, w, h] of [[0, 0, p.w, 3], [0, p.h - 3, p.w, 3], [0, 0, 3, p.h], [p.w - 3, 0, 3, p.h]] as const) shape(p, rect(x, y, w, h), {c: '#d9d5cb', a: 0.6, h: 0.55});
  }),
  /** Smooth cement render patch over spalled concrete. */
  concretePatch: D(1.0, 1.0, 160, p => {
    p.base({c: '#a5a199', r: 0.8, h: 0.52});
    mottle(p, 30, 10, 50, ['#b0aca3', '#9a968e'], 0.4);
    for (let i = 0; i < 12; i++) { const x = p.rr(20, p.w - 20), y = p.rr(20, p.h - 20), r = p.rr(20, 60); shape(p, ctx => ctx.arc(x, y, r, p.rr(0, 3), p.rr(3.5, 5.5)), {c: '#bdb9b0', a: 0.3, h: 0.56}, 2); }
    speckle(p, 200, [0.5, 1.2], ['#87837b'], {a: 0.5});
    p.grain(6);
  }),
  /** Accent tile band: two courses (bottom = offset course), tinted per station / hall. */
  band: D(3.6, 0.3, 280, (p, W, H, ppm) => {
    p.base({c: '#77736a', r: 0.85, h: 0.3});
    subwayTiles(p, ppm, 2, () => mixHex('#f4f2ec', p.pick(['#e2ded4', '#ffffff', '#ebe8e0']), p.rr(0, 1)), true, [0.1, 0.2]);
    // Slim liner courses top and bottom.
    shape(p, rect(0, 0, W, 3), {c: '#5b5850', h: 0.4});
    shape(p, rect(0, H - 3, W, 3), {c: '#5b5850', h: 0.4});
    mottle(p, 30, 10, 40, ['#d7d2c6'], 0.15);
    p.grain(5);
  }),
  /** Tile pilaster strip: stacked 0.36 x 0.15 tiles with bullnose edges (repeats every 0.15 m). */
  pilaster: D(0.36, 1.2, 250, (p, W, H, ppm) => {
    p.base({c: '#77736a', r: 0.85, h: 0.3});
    const th = TILE_H * ppm, g = 3;
    for (let r = 0; r < 8; r++) {
      const y0 = H - (r + 1) * th;
      shape(p, rect(g, y0 + g / 2, W - 2 * g, th - g), {c: mixHex('#eeebe3', '#dcd8cd', p.rr(0, 1)), r: p.rr(0.1, 0.2), h: 0.66});
      shape(p, rect(g, y0 + g / 2, W - 2 * g, (th - g) * 0.3), {c: '#ffffff', a: 0.12});
    }
    // Bullnose edge highlights / shadows (the strip reads as a slight projection).
    shape(p, rect(0, 0, 5, H), {c: '#ffffff', a: 0.25, h: 0.85});
    shape(p, rect(W - 5, 0, 5, H), {c: '#3e3b35', a: 0.35, h: 0.85});
  }),
  /** Expansion joint: dark sealant bead with crisp arrises (repeats vertically). */
  joint: D(0.06, 1.0, 256, (p, W, H) => {
    p.base({c: '#57544d', r: 0.9, h: 0.45});
    shape(p, rect(W * 0.3, 0, W * 0.4, H), {c: '#151413', r: 0.6, h: 0.05});
    shape(p, rect(W * 0.22, 0, 2, H), {c: '#b8b2a5', a: 0.8, h: 0.6});
    shape(p, rect(W * 0.76, 0, 2, H), {c: '#2b2925', a: 0.8, h: 0.4});
  }),
  // Cut-out decals (alpha).
  crackA: D(0.8, 0.8, 240, p => { p.base({r: 0.85, h: 0.5}); for (let i = 0; i < 3; i++) crack(p, p.w * p.rr(0.35, 0.65), p.h * p.rr(0.35, 0.65), p.rr(0, 6.28), p.w * p.rr(0.35, 0.5), 1.6, 2); }),
  crackB: D(0.8, 0.8, 240, p => { p.base({r: 0.85, h: 0.5}); crack(p, p.w * 0.08, p.h * p.rr(0.3, 0.7), p.rr(-0.3, 0.3), p.w * 0.85, 1.8, 3); crack(p, p.w * 0.5, p.h * 0.1, Math.PI / 2 + p.rr(-0.3, 0.3), p.h * 0.6, 1.3, 2); }),
  /** Chipped lower edge: substrate showing through flakes along the cell bottom. */
  chipsEdgeA: D(2.0, 0.25, 224, p => chipsAlong(p, 'bottom', 26)),
  chipsEdgeB: D(2.0, 0.25, 224, p => chipsAlong(p, 'bottom', 40)),
  /** Chipped outside corner: flakes along the cell's left edge. */
  cornerChipA: D(0.25, 1.0, 256, p => chipsAlong(p, 'left', 14)),
  cornerChipB: D(0.25, 1.0, 256, p => chipsAlong(p, 'left', 22)),
  /** Fractured plaster / concrete around a breach (rim ring). */
  fracture: D(1.2, 1.2, 180, p => {
    p.base({c: '#7d786e', r: 0.95, h: 0.5});
    mottle(p, 40, 8, 40, ['#8a8478', '#625e57', '#747068'], 0.55);
    for (let i = 0; i < 260; i++) { const x = p.rr(3, p.w - 3), y = p.rr(3, p.h - 3), r = p.rr(2, 7); shape(p, p.blob(x, y, r, 0.9, 6), {c: p.pick(['#8f897d', '#5c5852', '#9a9387', '#6e6961']), h: p.rr(0.35, 0.75)}); }
    for (let i = 0; i < 6; i++) crack(p, p.rr(20, p.w - 20), p.rr(20, p.h - 20), p.rr(0, 6.28), p.w * 0.25, 1.4, 1);
    p.grain(10);
  }),
  /** Plaster skim / old paint layers at a spall edge. */
  skim: D(1.0, 1.0, 120, p => {
    p.base({c: '#ddd6c6', r: 0.85, h: 0.6});
    mottle(p, 30, 6, 30, ['#cfc7b4', '#e8e2d4', '#c4bba6'], 0.5);
    speckle(p, 200, [0.6, 1.6], ['#a59c88', '#f0ebe0'], {a: 0.6});
    p.grain(6);
  }),
  /** Board-formed concrete: panel joints + tie holes (repeats every 2.4 x 1.2 m). */
  formwork: D(2.4, 1.2, 110, (p, W, H, ppm) => {
    p.base({r: 0.9, h: 0.5});
    shape(p, rect(0, 0, 2, H), {c: '#3a3832', a: 0.75, h: 0.3});
    shape(p, rect(W / 2 - 1, 0, 2, H), {c: '#3a3832', a: 0.55, h: 0.35});
    shape(p, rect(0, 0, W, 2), {c: '#3a3832', a: 0.7, h: 0.3});
    // Board seams (faint, every 0.15 m) and a lip of grout bleed under the panel joint.
    for (let y = 0.15 * ppm; y < H; y += 0.15 * ppm) shape(p, rect(0, y, W, 1), {c: '#4a4740', a: 0.25, h: 0.45});
    shape(p, rect(0, 3, W, 3), {c: '#a8a397', a: 0.35, h: 0.55});
    // Tie holes on a 0.6 m grid (plugged / open).
    for (let y = 0.3 * ppm; y < H; y += 0.6 * ppm) for (let x = 0.3 * ppm; x < W; x += 0.6 * ppm) {
      const plugged = p.rnd() < 0.5;
      shape(p, ell(x, y, 0.016 * ppm + 1.5, 0.016 * ppm + 1.5), {c: plugged ? '#8f8a80' : '#1d1c1a', a: 0.9, h: plugged ? 0.45 : 0.1});
      shape(p, ell(x + 1, y + 1.5, 0.016 * ppm + 2, 0.016 * ppm + 2), {c: '#2a2824', a: 0.25}, 1);
    }
  }),
  // ---- soft (alpha-graded, tinted) ----
  streakA: S(0.8, 2.0, 96, p => streakCell(p, 5, 0.9)),
  streakB: S(0.8, 2.0, 96, p => streakCell(p, 9, 0.7)),
  streakC: S(0.8, 2.0, 96, p => streakCell(p, 3, 1.0)),
  /** Efflorescence: white crystalline bloom with short drips (bottom-weighted). */
  efflor: S(1.2, 0.6, 120, p => {
    p.ctx.clearRect(0, 0, p.w, p.h);
    for (let i = 0; i < 26; i++) soft(p, p.rr(20, p.w - 20), p.rr(p.h * 0.3, p.h - 12), p.rr(8, 26), {c: '#ffffff', a: p.rr(0.15, 0.4)});
    for (let i = 0; i < 260; i++) { const x = p.rr(4, p.w - 4), y = p.rr(p.h * 0.2, p.h - 4), r = p.rr(0.6, 2.2); shape(p, ell(x, y, r, r), {c: '#ffffff', a: p.rr(0.2, 0.6)}); }
    for (let i = 0; i < 14; i++) { const x = p.rr(10, p.w - 10), y = p.rr(p.h * 0.1, p.h * 0.5), l = p.rr(10, p.h * 0.4); for (let k = 0; k < 6; k++) shape(p, rect(x, y + l * k / 6, 2, l / 6 + 1), {c: '#ffffff', a: 0.3 * (1 - k / 6)}); }
  }),
  /** Damp tide band: darker wet zone below a crusty white tide line (bottom of the cell = floor). */
  damp: S(2.0, 0.6, 100, p => {
    p.ctx.clearRect(0, 0, p.w, p.h);
    const line: Pt[] = jagLine(p, 0, p.h * 0.3, p.w, p.h * 0.3, 24, 4);
    for (let k = 0; k < 10; k++) shape(p, poly([...line.map(([x, y]) => [x, y + k * (p.h * 0.07)] as Pt), [p.w, p.h], [0, p.h]]), {c: '#6a6a6a', a: 0.05});
    shape(p, poly(line, false), {c: '#ffffff', a: 0.5}, 3);
    shape(p, poly(line.map(([x, y]) => [x, y + 4] as Pt), false), {c: '#ffffff', a: 0.2}, 5);
  }),
  /** Soot / damp under the ceiling: dark at the top edge fading down with ragged fingers. */
  soot: S(2.0, 0.6, 100, p => {
    p.ctx.clearRect(0, 0, p.w, p.h);
    for (let k = 0; k < 12; k++) shape(p, rect(0, 0, p.w, p.h * (0.12 + k * 0.05)), {c: '#5a5a5a', a: 0.055});
    for (let i = 0; i < 14; i++) { const x = p.rr(6, p.w - 6), l = p.rr(p.h * 0.3, p.h * 0.95), w = p.rr(3, 10); for (let k = 0; k < 8; k++) shape(p, rect(x, l * k / 8, w * (1 - k * 0.08), l / 8 + 1), {c: '#5a5a5a', a: 0.14 * (1 - k / 8)}); }
  }),
  /** Horizontal grime / rub band (hands, shoulders, trolleys). */
  grime: S(2.0, 0.4, 100, p => {
    p.ctx.clearRect(0, 0, p.w, p.h);
    for (let i = 0; i < 26; i++) { const x = p.rr(10, p.w - 10), y = p.rr(p.h * 0.3, p.h * 0.7), rx = p.rr(8, 40), ry = p.rr(2, 6); shape(p, ell(x, y, Math.min(rx, x, p.w - x), Math.min(ry, y, p.h - y), p.rr(-0.08, 0.08)), {c: '#707070', a: p.rr(0.03, 0.1)}); }
    for (let i = 0; i < 8; i++) soft(p, p.rr(20, p.w - 20), p.h / 2, p.rr(10, 18), {c: '#707070', a: 0.08});
  }),
  /** Kick-line scuffs: sparse short dark shoe / trolley marks, densest near the floor. */
  scuff: S(2.0, 0.35, 128, p => {
    p.ctx.clearRect(0, 0, p.w, p.h);
    for (let i = 0; i < 9; i++) soft(p, p.rr(20, p.w - 20), p.rr(p.h * 0.55, p.h - 8), p.rr(10, 26), {c: '#5a5a5a', a: p.rr(0.08, 0.2)});
    for (let i = 0; i < 26; i++) {
      const x = p.rr(6, p.w - 30), y = p.h - Math.pow(p.rr(0, 1), 1.8) * p.h * 0.7 - 5, l = p.rr(5, 22), a = p.rr(-0.15, 0.15);
      shape(p, poly([[x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l]], false), {c: '#2a2a2a', a: p.rr(0.15, 0.4)}, p.rr(1, 2.2));
    }
  }),
  /** Round water blot with a darker ring. */
  blot: S(0.6, 0.6, 100, p => {
    p.ctx.clearRect(0, 0, p.w, p.h);
    const cx = p.w / 2, cy = p.h / 2;
    soft(p, cx, cy, p.w * 0.45, {c: '#8a8a8a', a: 0.35});
    shape(p, ctx => ctx.arc(cx, cy, p.w * 0.36, 0, Math.PI * 2), {c: '#555555', a: 0.25}, 3);
  }),
} satisfies Record<string, CellSpec>;

export type AtlasCell = keyof typeof ATLAS_CELLS;

function chipsAlong(p: Painter, edge: 'bottom' | 'left', n: number): void {
  p.base({r: 0.85, h: 0.5});
  for (let i = 0; i < n; i++) {
    const big = p.rnd() < 0.25;
    const r = big ? p.rr(8, 18) : p.rr(2.5, 8);
    const along = edge === 'bottom' ? p.rr(r, p.w - r) : p.rr(r, p.h - r);
    const into = r * p.rr(0.2, 0.9);
    const x = edge === 'bottom' ? along : into, y = edge === 'bottom' ? p.h - into : along;
    const pts: Pt[] = [];
    const a0 = p.rr(0, 6.28);
    for (let k = 0; k < 9; k++) { const a = a0 + k / 9 * Math.PI * 2, rr = r * p.rr(0.55, 1.1); pts.push([Math.min(p.w - 1, Math.max(1, x + Math.cos(a) * rr)), Math.min(p.h - 1, Math.max(1, y + Math.sin(a) * rr * 0.75))]); }
    shape(p, poly(pts), {c: p.pick(['#8f897d', '#9c968a', '#7c776d']), r: 0.95, h: 0.2});
    // Flaked rim (lighter broken glaze / paint edge) and shadow at the upper edge.
    shape(p, poly(pts), {c: '#d8d1c0', a: 0.45, h: 0.62}, 1.2);
  }
}

function streakCell(p: Painter, n: number, strength: number): void {
  p.ctx.clearRect(0, 0, p.w, p.h);
  // Source stain at the top edge, then run-down streaks of varying length.
  soft(p, p.w / 2, 6, p.w * 0.35, {c: '#9a9a9a', a: 0.35 * strength});
  for (let i = 0; i < n; i++) {
    const x = p.w / 2 + p.rr(-p.w * 0.32, p.w * 0.32), len = p.rr(0.35, 0.98) * p.h, wd = p.rr(2, 7);
    let cx = x;
    for (let k = 0; k < 14; k++) {
      cx += p.rr(-0.8, 0.8);
      const y0 = len * k / 14;
      shape(p, rect(Math.max(1, cx - wd / 2), y0, wd * (1 - k * 0.04), len / 14 + 1), {c: '#b0b0b0', a: strength * 0.28 * (1 - k / 16)});
    }
    soft(p, cx, Math.min(p.h - 6, len), wd * 1.6, {c: '#808080', a: 0.25 * strength});
  }
}

// ---- packing (pure; deterministic) -------------------------------------------------------------

export interface CellRect {
  atlas: AtlasId;
  /** Pixel rect in its atlas. */
  x: number; y: number; w: number; h: number;
  /** UV rect (v up, three's flipY convention): u0..u1, v0 (cell bottom) .. v1 (cell top). */
  u0: number; u1: number; v0: number; v1: number;
  /** Real size (m). */
  mw: number; mh: number;
}

let packed: Record<AtlasCell, CellRect> | null = null;

/** Deterministic skyline packing of every cell into its atlas (throws if a cell does not fit). */
export function atlasCells(): Record<AtlasCell, CellRect> {
  if (packed) return packed;
  const out = {} as Record<AtlasCell, CellRect>;
  for (const atlas of ['detail', 'soft'] as AtlasId[]) {
    const [AW, AH] = ATLAS_SIZE[atlas];
    const names = (Object.keys(ATLAS_CELLS) as AtlasCell[]).filter(n => ATLAS_CELLS[n].atlas === atlas);
    const size = (n: AtlasCell): [number, number] => { const c = ATLAS_CELLS[n]; return [Math.max(2, Math.round(c.w * c.ppm / 2) * 2), Math.max(2, Math.round(c.h * c.ppm / 2) * 2)]; };
    names.sort((a, b) => size(b)[1] - size(a)[1] || size(b)[0] - size(a)[0] || (a < b ? -1 : 1));
    // Skyline: per-column heights.
    const sky = new Int32Array(AW);
    for (const n of names) {
      const [w, h] = size(n);
      const W = w + 2 * PAD, H = h + 2 * PAD;
      let bestX = -1, bestY = Infinity;
      for (let x = 0; x + W <= AW; x += 2) {
        let y = 0;
        for (let k = x; k < x + W; k++) if (sky[k] > y) y = sky[k];
        if (y + H <= AH && y < bestY) { bestY = y; bestX = x; }
      }
      if (bestX < 0) throw new Error(`wall detail atlas ${atlas}: cell ${n} (${w}x${h}) does not fit`);
      for (let k = bestX; k < bestX + W; k++) sky[k] = bestY + H;
      const x = bestX + PAD, y = bestY + PAD;
      const c = ATLAS_CELLS[n];
      // UVs inset by a texel so bilinear / anisotropic sampling never reaches the padding.
      const I = 1.25;
      out[n] = {atlas, x, y, w, h, u0: (x + I) / AW, u1: (x + w - I) / AW, v0: 1 - (y + h - I) / AH, v1: 1 - (y + I) / AH, mw: c.w, mh: c.h};
    }
  }
  packed = out;
  return out;
}

// ---- texture generation (browser canvas or the node test shim) --------------------------------

export interface WallDetailTextures {
  detail: SurfaceSet;
  soft: THREE.Texture;
  /** Bytes of GPU texture memory (incl. mipmaps), for budgets/QA. */
  bytes: number;
}

let textures: WallDetailTextures | null = null;

/** Generated once per page; shared by every station. */
export function wallDetailTextures(): WallDetailTextures {
  if (textures) return textures;
  const cells = atlasCells();
  const [DW, DH] = ATLAS_SIZE.detail, [SW, SH] = ATLAS_SIZE.soft;
  const master = new Painter(DW, DH, 8801, {rough: 0.5, height: 0.5});
  master.base({r: 0.85, h: 0.5});
  const softAtlas = new Painter(SW, SH, 8802);
  const names = Object.keys(ATLAS_CELLS) as AtlasCell[];
  names.forEach((n, i) => {
    const spec = ATLAS_CELLS[n], r = cells[n];
    const cell = new Painter(r.w, r.h, 9100 + i * 37, spec.atlas === 'detail' ? {rough: 0.5, height: 0.5} : {});
    spec.draw(cell, r.w, r.h, r.w / spec.w);
    const dst = spec.atlas === 'detail' ? master : softAtlas;
    dst.color.getContext('2d')!.drawImage(cell.color as unknown as CanvasImageSource, r.x, r.y);
    if (spec.atlas === 'detail') {
      // The half-resolution layers' contexts carry a 0.5 scale: draw in full-resolution atlas coordinates.
      if (cell.rough && master.rough) master.rough.getContext('2d')!.drawImage(cell.rough as unknown as CanvasImageSource, r.x, r.y, r.w, r.h);
      if (cell.height && master.height) master.height.getContext('2d')!.drawImage(cell.height as unknown as CanvasImageSource, r.x, r.y, r.w, r.h);
    }
  });
  const detail = master.finish([1, 1], 2.2);
  const soft = softAtlas.finish([1, 1]).map;
  // Anisotropic filtering only where it shows (the colour map); roughness / normal / soft stains are
  // low-frequency (cheaper sampling, notably on software rasterizers such as llvmpipe).
  for (const t of [detail.map, detail.roughnessMap, detail.normalMap, soft]) if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = t === detail.map ? 4 : 1; }
  // lane FIX (U08): the wall-treatment colour map is a wall surface map: 16x requested (was 4x; the low-frequency maps keep 1x)
  if (detail.map) requestSurfaceAnisotropy(detail.map, 'wall');
  const mip = 4 / 3;
  const bytes = Math.round((DW * DH * 4 + (DW / 2) * (DH / 2) * 4 * 2 + SW * SH * 4) * mip);
  textures = {detail, soft, bytes};
  return textures;
}

/** Drop the cached atlases (tests that switch the canvas shim between no-op and rasterizing). */
export function resetWallDetailTextures(): void { textures = null; friezes.clear(); }

// ---- per-station name tablet (mosaic frieze) ------------------------------------------------------

/** Frieze tablet real size (m): 6 tiles x 4 courses of the base wall grid. */
export const FRIEZE_SIZE = {w: 2.16, h: 0.6};
const friezes = new Map<string, THREE.CanvasTexture>();

/**
 * Station-name mosaic tablet: tesserae border in the station accent colour, cream field, dark lettering.
 * Only the current station's tablet is kept (a new station disposes the previous one: no growth over runs).
 */
export function friezeTexture(name: string, accent: string): THREE.CanvasTexture {
  const key = `${name}|${accent}`;
  let t = friezes.get(key);
  if (t) return t;
  for (const old of friezes.values()) old.dispose();
  friezes.clear();
  const W = 1024, H = 288;
  const p = new Painter(W, H, name.length * 131 + 7);
  p.base({c: '#e9e2cf'});
  // Tesserae field (small squares, slight tone variation).
  const q = 12;
  for (let y = 0; y < H; y += q) for (let x = 0; x < W; x += q) shape(p, rect(x + 1, y + 1, q - 2, q - 2), {c: mixHex('#ece5d2', '#d8cfb8', p.rr(0, 1))});
  // Two-row accent border with a dark keyline.
  const b = q * 2;
  for (let y = 0; y < H; y += q) for (let x = 0; x < W; x += q) {
    const edge = x < b || y < b || x >= W - b || y >= H - b;
    if (!edge) continue;
    shape(p, rect(x + 1, y + 1, q - 2, q - 2), {c: mixHex(accent, '#000000', p.rr(0, 0.25))});
  }
  const ctx = p.ctx;
  ctx.fillStyle = '#26231f';
  ctx.fillRect(b + 4, b + 4, W - 2 * b - 8, 4);
  ctx.fillRect(b + 4, H - b - 8, W - 2 * b - 8, 4);
  // Corner rosettes.
  for (const [x, y] of [[b + 26, H / 2], [W - b - 26, H / 2]] as const) {
    shape(p, ell(x, y, 18, 18), {c: accent});
    shape(p, ell(x, y, 8, 8), {c: '#26231f'});
  }
  let size = 112;
  const font = () => `bold ${size}px Georgia, "Times New Roman", serif`;
  ctx.font = font();
  const text = name.toUpperCase();
  while (ctx.measureText(text).width > W - 2 * b - 140 && size > 40) { size -= 4; ctx.font = font(); }
  ctx.fillStyle = '#26231f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 4);
  // Age: grime in the joints, a few lost tesserae, staining.
  for (let i = 0; i < 40; i++) { const x = Math.floor(p.rr(0, W / q)) * q, y = Math.floor(p.rr(0, H / q)) * q; shape(p, rect(x + 1, y + 1, q - 2, q - 2), {c: '#8f897d', a: p.rr(0.6, 1)}); }
  for (let i = 0; i < 10; i++) soft(p, p.rr(30, W - 30), p.rr(20, H - 20), p.rr(20, 70), {c: '#5a4e3a', a: p.rr(0.08, 0.2)});
  p.grain(8);
  t = p.finish([1, 1]).map as THREE.CanvasTexture;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  requestSurfaceAnisotropy(t, 'wall'); // lane FIX (U08): wall mosaic frieze, 16x requested
  friezes.set(key, t);
  return t;
}
