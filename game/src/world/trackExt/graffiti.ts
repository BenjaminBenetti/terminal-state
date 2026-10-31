// Track 2 (Beyond the Station), lane VIS: graffiti clues on the tunnel walls (DESIGN §3 "Graffiti").
//
// A local procedural canvas painter (no image assets, no generation service) paints ONE shared atlas of spray-paint
// marks in white / black with alpha: bold arrows, chevron runs and stencilled block arrows (each pointing left and
// right, drips always running down) and two freehand tags. Decals are wall-following strips at TrackTunnel.clues ONLY
// (the record exists only when the route really exists, GEN), tinted per clue with a vertex colour, all merged into one
// mesh per level with one shared material (one draw; the atlas is painted once per session). Deterministic per seed.

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {canvasTexture} from '../canvasTextures';
import type {TrackTunnel} from '../../gen/trackExt/types';
import {Acc, hashOf, prng, type V3} from './mesh';
import type {TunnelFrame} from './frame';

/** Atlas: 1024 x 1024, cells of 512 x 256 (2 columns x 4 rows). */
export const ATLAS = {w: 1024, h: 1024, cw: 512, ch: 256} as const;
export type ArrowStyle = 'bold' | 'chevron' | 'stencil';
export const ARROW_STYLES: readonly ArrowStyle[] = ['bold', 'chevron', 'stencil'];
/** Cell index of an arrow style + direction, and of the tags. */
export const CELL_OF = {
  arrow: (style: ArrowStyle, dir: 'left' | 'right') => ARROW_STYLES.indexOf(style) * 2 + (dir === 'left' ? 1 : 0),
  tag: (variant: 0 | 1) => 6 + variant,
} as const;
/** Spray colours (sRGB): red, white, yellow, green, blue, orange. */
export const SPRAY = ['#d0202a', '#ecebe4', '#f2c21a', '#36b24a', '#2b7fd8', '#f0661c'] as const;

/** Decal sizes (m) and heights above the bed. */
export const GRAFFITI = {arrowW: 1.6, arrowH: 0.8, arrowY: 1.5, tagW: 1.9, tagH: 0.95, tagY: 1.95, tagArrowW: 1.2, tagArrowH: 0.6, tagArrowY: 1.1, offset: 0.012} as const;

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
/** Height of the cell being painted (cell-local px): drips stop short of the next cell. */
let cellH = Infinity;

/** Spray a polyline: soft overspray halo, mid and core strokes, speckle, drips that run down. */
function spray(ctx: Ctx, pts: Pt[], w: number, rnd: () => number, o: {color?: string; drips?: number; core?: number} = {}): void {
  const col = o.color ?? '255,255,255';
  const line = (width: number, a: number) => {
    ctx.strokeStyle = `rgba(${col},${a})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };
  line(w * 2.3, 0.07);
  line(w * 1.5, 0.2);
  line(w, o.core ?? 0.9);
  // Speckle along the stroke.
  ctx.fillStyle = `rgba(${col},0.45)`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
    for (let k = 0; k < n; k++) {
      const u = rnd(), r = w * (0.7 + rnd() * 1.1), a = rnd() * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(ax + (bx - ax) * u + Math.cos(a) * r, ay + (by - ay) * u + Math.sin(a) * r, 0.6 + rnd() * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Drips: paint runs straight down from a few points.
  const drips = o.drips ?? 2;
  ctx.strokeStyle = `rgba(${col},0.85)`;
  ctx.fillStyle = `rgba(${col},0.85)`;
  for (let k = 0; k < drips; k++) {
    const p = pts[Math.floor(rnd() * pts.length)], dw = Math.max(1.5, w * (0.18 + rnd() * 0.12));
    const len = Math.min(12 + rnd() * 48, cellH - 6 - dw - (p[1] + w * 0.3));
    if (len < 4) continue;
    ctx.lineWidth = dw;
    ctx.beginPath();
    ctx.moveTo(p[0] + (rnd() - 0.5) * w * 0.6, p[1] + w * 0.3);
    ctx.lineTo(p[0] + (rnd() - 0.5) * w * 0.6, p[1] + w * 0.3 + len);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p[0], p[1] + w * 0.3 + len, dw * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Gentle hand wobble on a straight segment. */
function wobble(a: Pt, b: Pt, rnd: () => number, n = 8, amp = 3): Pt[] {
  const out: Pt[] = [];
  const ph = rnd() * 6;
  for (let i = 0; i <= n; i++) {
    const u = i / n, s = Math.sin(u * Math.PI * 2 + ph) * amp * Math.sin(u * Math.PI);
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    out.push([a[0] + dx * u - (dy / l) * s, a[1] + dy * u + (dx / l) * s]);
  }
  return out;
}

/** Arrow pointing right inside a cw x ch cell (mirrored by the caller for left). */
function arrowRight(ctx: Ctx, style: ArrowStyle, cw: number, ch: number, rnd: () => number): void {
  const cy = ch * 0.5;
  if (style === 'bold') {
    // Black outline pass under a white fill pass: tinted white becomes the colour, black stays an outline.
    const shaft = wobble([cw * 0.1, cy + 6], [cw * 0.78, cy], rnd, 10, 4);
    const head: Pt[] = [[cw * 0.6, cy - ch * 0.3], [cw * 0.86, cy], [cw * 0.6, cy + ch * 0.3]];
    spray(ctx, shaft, 46, rnd, {color: '10,10,10', drips: 0, core: 0.8});
    spray(ctx, head, 46, rnd, {color: '10,10,10', drips: 0, core: 0.8});
    spray(ctx, shaft, 30, rnd, {drips: 3});
    spray(ctx, head, 30, rnd, {drips: 2});
  } else if (style === 'chevron') {
    for (let k = 0; k < 3; k++) {
      const x = cw * (0.2 + k * 0.24);
      spray(ctx, [[x, cy - ch * 0.28], [x + cw * 0.13, cy], [x, cy + ch * 0.28]], 24, rnd, {drips: 1});
    }
    spray(ctx, wobble([cw * 0.08, cy + ch * 0.38], [cw * 0.9, cy + ch * 0.36], rnd, 10, 2), 6, rnd, {drips: 0, core: 0.7});
  } else {
    // Stencilled block arrow: crisp fill with two stencil bridges, faint overspray around it.
    const poly: Pt[] = [[cw * 0.08, cy - ch * 0.11], [cw * 0.58, cy - ch * 0.11], [cw * 0.58, cy - ch * 0.3], [cw * 0.9, cy], [cw * 0.58, cy + ch * 0.3], [cw * 0.58, cy + ch * 0.11], [cw * 0.08, cy + ch * 0.11]];
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x + (x - cw * 0.45) * 0.04, y + (y - cy) * 0.12) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    const piece = (x0: number, x1: number) => {
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.beginPath();
      if (x1 <= cw * 0.58) { ctx.rect(x0, cy - ch * 0.11, x1 - x0, ch * 0.22); ctx.fill(); return; }
      // Head piece from x0.
      ctx.moveTo(x0, cy - ch * 0.11); ctx.lineTo(cw * 0.58, cy - ch * 0.11); ctx.lineTo(cw * 0.58, cy - ch * 0.3);
      ctx.lineTo(cw * 0.9, cy); ctx.lineTo(cw * 0.58, cy + ch * 0.3); ctx.lineTo(cw * 0.58, cy + ch * 0.11); ctx.lineTo(x0, cy + ch * 0.11);
      ctx.closePath();
      ctx.fill();
    };
    piece(cw * 0.08, cw * 0.27);
    piece(cw * 0.295, cw * 0.5);
    piece(cw * 0.525, cw * 0.9);
    // A couple of runs from the stencil's lower edge.
    spray(ctx, [[cw * 0.3, cy + ch * 0.11], [cw * 0.3, cy + ch * 0.12]], 5, rnd, {drips: 2, core: 0.6});
  }
}

/** Stroke letters in a unit box (x right, y down) for the freehand tags. */
const GLYPHS: Record<string, Pt[][]> = {
  A: [[[0, 1], [0.5, 0], [1, 1]], [[0.2, 0.62], [0.8, 0.62]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.75, 0.5]]],
  K: [[[0, 0], [0, 1]], [[1, 0], [0.05, 0.58], [1, 1]]],
  R: [[[0, 1], [0, 0], [0.75, 0], [1, 0.2], [0.78, 0.45], [0, 0.45]], [[0.4, 0.45], [1, 1]]],
  S: [[[1, 0.12], [0.75, 0], [0.22, 0], [0, 0.22], [0.25, 0.46], [0.78, 0.55], [1, 0.78], [0.78, 1], [0.2, 1], [0, 0.88]]],
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  Z: [[[0, 0], [1, 0], [0, 1], [1, 1]]],
  O: [[[0.5, 0], [0.9, 0.15], [1, 0.5], [0.88, 0.86], [0.5, 1], [0.12, 0.86], [0, 0.5], [0.1, 0.15], [0.5, 0]]],
  M: [[[0, 1], [0, 0], [0.5, 0.6], [1, 0], [1, 1]]],
  N: [[[0, 1], [0, 0], [1, 1], [1, 0]]],
};
/** Tag words (fictional writers) per variant. */
const TAG_WORDS = ['REKS', 'VOZ'] as const;

/** A freehand tag: slanted, bouncing stroke letters with an underline swoosh and a star / crown. */
function tag(ctx: Ctx, variant: 0 | 1, cw: number, ch: number, rnd: () => number): void {
  const word = TAG_WORDS[variant];
  const n = word.length;
  const lh = ch * (variant === 1 ? 0.5 : 0.46), lw = (cw * 0.72) / n;
  const slant = 0.28, x0 = cw * 0.1, base = ch * 0.72;
  const strokes: Pt[][] = [];
  for (let k = 0; k < n; k++) {
    const g = GLYPHS[word[k]];
    const sc = 0.85 + rnd() * 0.3, bounce = (rnd() - 0.5) * ch * 0.08;
    const gx = x0 + k * lw * 1.02, gw = lw * 0.82 * sc, gh = lh * sc;
    for (const st of g) {
      const pts: Pt[] = [];
      for (let i = 0; i < st.length; i++) {
        const [u, v] = st[i];
        const y = base + bounce - gh + v * gh;
        pts.push([gx + u * gw + (base - y) * slant + (rnd() - 0.5) * 3, y + (rnd() - 0.5) * 3]);
        // Densify long legs a little (hand wobble).
        if (i + 1 < st.length) {
          const [u2, v2] = st[i + 1];
          const y2 = base + bounce - gh + v2 * gh;
          const mx = (gx + u * gw + (base - y) * slant + gx + u2 * gw + (base - y2) * slant) / 2, my = (y + y2) / 2;
          pts.push([mx + (rnd() - 0.5) * 5, my + (rnd() - 0.5) * 5]);
        }
      }
      strokes.push(pts);
    }
  }
  const core = variant === 1 ? 20 : 16;
  for (const st of strokes) spray(ctx, st, core + (variant === 1 ? 16 : 10), rnd, {color: '10,10,10', drips: 0, core: variant === 1 ? 0.85 : 0.55});
  strokes.forEach((st, i) => spray(ctx, st, core, rnd, {drips: i % 3 === 0 ? 1 : 0}));
  // Underline swoosh.
  const sw: Pt[] = [];
  for (let i = 0; i <= 14; i++) { const u = i / 14; sw.push([cw * (0.08 + u * 0.82), base + ch * 0.1 + Math.sin(u * Math.PI) * ch * 0.05 - u * ch * 0.07]); }
  spray(ctx, sw, 8, rnd, {drips: 1});
  // Star (variant 0) / crown (variant 1) over the last letter.
  const sx = cw * 0.88, sy = ch * 0.17, r = ch * 0.085;
  const star: Pt[] = [];
  if (variant === 0) for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 4 / 5; star.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]); }
  else star.push([sx - r * 1.2, sy + r], [sx - r * 1.2, sy - r * 0.6], [sx - r * 0.5, sy + r * 0.1], [sx, sy - r], [sx + r * 0.5, sy + r * 0.1], [sx + r * 1.2, sy - r * 0.6], [sx + r * 1.2, sy + r], [sx - r * 1.2, sy + r]);
  spray(ctx, star, 6, rnd, {drips: 0});
}

/** Paint the whole atlas (deterministic). Exported for tests / previews. */
export function paintGraffitiAtlas(ctx: Ctx, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const {cw, ch} = ATLAS;
  const sx = w / ATLAS.w, sy = h / ATLAS.h;
  const cell = (i: number, f: (rnd: () => number) => void, mirror = false) => {
    const col = i % 2, row = Math.floor(i / 2);
    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(col * cw, row * ch);
    if (mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
    cellH = ch;
    f(prng(hashOf('graffiti-cell', i)));
    cellH = Infinity;
    ctx.restore();
  };
  ARROW_STYLES.forEach(st => {
    cell(CELL_OF.arrow(st, 'right'), rnd => arrowRight(ctx, st, cw, ch, rnd));
    cell(CELL_OF.arrow(st, 'left'), rnd => arrowRight(ctx, st, cw, ch, rnd), true);
  });
  cell(CELL_OF.tag(0), rnd => tag(ctx, 0, cw, ch, rnd));
  cell(CELL_OF.tag(1), rnd => tag(ctx, 1, cw, ch, rnd));
}

let atlasTex: THREE.Texture | null = null;
let atlasMat: THREE.Material | null = null;

/** The shared atlas texture (painted on first use, kept for the session: every level reuses it and its program). */
export function graffitiAtlas(): THREE.Texture {
  if (!atlasTex) {
    const t = canvasTexture(ATLAS.w, ATLAS.h, 0x6aff17, (ctx, w, h) => paintGraffitiAtlas(ctx, w, h));
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    atlasTex = t;
  }
  return atlasTex;
}

/** The shared decal material: atlas x vertex colour, alpha blended, no depth write, pulled toward the camera. */
export function graffitiMaterial(): THREE.Material {
  if (!atlasMat) {
    const m = new MeshStandardNodeMaterial({map: graffitiAtlas(), vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.02, roughness: 0.82, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
    m.name = 'track-ext-graffiti';
    atlasMat = m;
  }
  return atlasMat;
}

/** One placed decal (for tests / QA). */
export interface GraffitiDecal { tunnel: number; clue: number; cell: number; s: number; side: 1 | -1; dir: 'left' | 'right'; color: string; w: number; h: number; y: number }

/**
 * Decals for a tunnel's clue records (and nothing else): arrows point (as seen by a viewer facing the wall) toward the
 * clue's `toward` along the path. `avoid` = wall spans to keep clear (door openings: [s0, s1, side]).
 */
export function graffitiDecals(acc: Acc, t: TrackTunnel, f: TunnelFrame, seed: number, avoid: readonly {s0: number; s1: number; side: 1 | -1}[] = []): GraffitiDecal[] {
  const out: GraffitiDecal[] = [];
  const y0 = t.floorY, half = f.half;
  t.clues.forEach((c, ci) => {
    const rnd = prng(hashOf('graffiti', seed, t.id, ci));
    const color = SPRAY[Math.floor(rnd() * SPRAY.length)];
    const col = new THREE.Color().setStyle(color);
    const rgb: V3 = [col.r, col.g, col.b];
    // Keep the mark off door openings on its wall.
    let s = Math.max(1, Math.min(f.length - 1, c.s));
    const width = c.kind === 'tag' ? GRAFFITI.tagW : GRAFFITI.arrowW;
    for (const o of avoid) if (o.side === c.side && s + width / 2 > o.s0 - 0.3 && s - width / 2 < o.s1 + 0.3) s = s < (o.s0 + o.s1) / 2 ? o.s0 - 0.3 - width / 2 : o.s1 + 0.3 + width / 2;
    s = Math.max(width / 2 + 0.2, Math.min(f.length - width / 2 - 0.2, s));
    const p = f.at(s);
    const inward: V3 = [-c.side * p.lx, 0, -c.side * p.lz];
    const right: V3 = [inward[2], 0, -inward[0]];
    const dir: 'left' | 'right' = (p.tx * right[0] + p.tz * right[2]) * c.toward >= 0 ? 'right' : 'left';
    const jitter = (rnd() - 0.5) * 0.12;
    if (c.kind === 'arrow') {
      const style = ARROW_STYLES[Math.floor(rnd() * ARROW_STYLES.length)];
      const cell = CELL_OF.arrow(style, dir);
      strip(acc, f, c.side, s, GRAFFITI.arrowW, y0 + GRAFFITI.arrowY + jitter, GRAFFITI.arrowH, cell, rgb, half);
      out.push({tunnel: t.id, clue: ci, cell, s, side: c.side, dir, color, w: GRAFFITI.arrowW, h: GRAFFITI.arrowH, y: y0 + GRAFFITI.arrowY + jitter});
    } else {
      const v = (rnd() < 0.5 ? 0 : 1) as 0 | 1;
      const cell = CELL_OF.tag(v);
      strip(acc, f, c.side, s, GRAFFITI.tagW, y0 + GRAFFITI.tagY + jitter, GRAFFITI.tagH, cell, rgb, half);
      out.push({tunnel: t.id, clue: ci, cell, s, side: c.side, dir, color, w: GRAFFITI.tagW, h: GRAFFITI.tagH, y: y0 + GRAFFITI.tagY + jitter});
      // The tag's arrow (same can) underneath, pointing the way.
      const ac = CELL_OF.arrow('bold', dir);
      strip(acc, f, c.side, s, GRAFFITI.tagArrowW, y0 + GRAFFITI.tagArrowY + jitter, GRAFFITI.tagArrowH, ac, rgb, half);
      out.push({tunnel: t.id, clue: ci, cell: ac, s, side: c.side, dir, color, w: GRAFFITI.tagArrowW, h: GRAFFITI.tagArrowH, y: y0 + GRAFFITI.tagArrowY + jitter});
    }
  });
  return out;
}

/** A wall-following decal strip centred at arc s on `side`, unmirrored for a viewer facing the wall. */
function strip(acc: Acc, f: TunnelFrame, side: 1 | -1, s: number, w: number, yc: number, h: number, cell: number, rgb: V3, half: number): void {
  const col = cell % 2, row = Math.floor(cell / 2);
  const u0 = (col * ATLAS.cw) / ATLAS.w, u1 = ((col + 1) * ATLAS.cw) / ATLAS.w;
  const v1 = 1 - (row * ATLAS.ch) / ATLAS.h, v0 = 1 - ((row + 1) * ATLAS.ch) / ATLAS.h;
  const n = Math.max(1, Math.ceil(w / 0.25));
  const p = f.at(s);
  const inward: V3 = [-side * p.lx, 0, -side * p.lz];
  const right: V3 = [inward[2], 0, -inward[0]];
  const sigma = p.tx * right[0] + p.tz * right[2] >= 0 ? 1 : -1; // +1: s grows to the viewer's right
  const lat = side * (half - GRAFFITI.offset);
  const ids: [number, number][] = [];
  for (let j = 0; j <= n; j++) {
    const sj = s - w / 2 + (w * j) / n;
    const q = f.at(sj);
    const [x, z] = f.point(sj, lat);
    const nn: V3 = [-side * q.lx, 0, -side * q.lz];
    const t = sigma > 0 ? j / n : 1 - j / n;
    const u = u0 + (u1 - u0) * (0.01 + t * 0.98);
    ids.push([acc.v([x, yc - h / 2, z], nn, u, v0 + 0.002, rgb), acc.v([x, yc + h / 2, z], nn, u, v1 - 0.002, rgb)]);
  }
  for (let j = 0; j < n; j++) acc.quad(ids[j][0], ids[j + 1][0], ids[j + 1][1], ids[j][1]);
}
