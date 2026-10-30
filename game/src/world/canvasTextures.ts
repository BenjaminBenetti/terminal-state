// Procedural canvas textures for simple surfaces with no authored texture (terrazzo, painted
// block, ballast, steel paint, crates). Deterministic, generated at startup; no image assets.

import * as THREE from 'three';
import {mulberry32} from '../core/rng';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

export function canvasTexture(w: number, h: number, seed: number, draw: Draw, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h, mulberry32(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, n: number, colors: string[], rMin: number, rMax: number) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const r = rMin + rnd() * (rMax - rMin);
    ctx.beginPath();
    ctx.ellipse(rnd() * w, rnd() * h, r, r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Soft blotches for grime/water stains; wraps at edges so textures tile. */
function stains(ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, n: number, color: string, maxR: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, r = maxR * (0.3 + rnd() * 0.7);
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, color.replace('A', String(alpha * (0.4 + rnd() * 0.6))));
      g.addColorStop(1, color.replace('A', '0'));
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

/** Terrazzo-like public floor, one texture = 2 m x 2 m. */
export function terrazzo(seed: number): THREE.CanvasTexture {
  return canvasTexture(1024, 1024, seed, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#8b857a';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rnd, 9000, ['#a29b8d', '#6f6a61', '#c9bfa7', '#5b5853', '#b48a3a'], 0.8, 2.6);
    stains(ctx, w, h, rnd, 26, 'rgba(40,36,30,A)', 160, 0.22);
    // 1 m tile joints
    ctx.strokeStyle = 'rgba(48,46,42,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * w / 2, 0); ctx.lineTo(i * w / 2, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * h / 2); ctx.lineTo(w, i * h / 2); ctx.stroke();
    }
  });
}

/** Service-area concrete floor, 2 m x 2 m. */
export function concreteFloor(seed: number): THREE.CanvasTexture {
  return canvasTexture(512, 512, seed, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#6e6b65';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rnd, 5000, ['#7a7770', '#605d58', '#83807a'], 0.5, 1.6);
    stains(ctx, w, h, rnd, 18, 'rgba(30,28,24,A)', 110, 0.3);
    stains(ctx, w, h, rnd, 6, 'rgba(120,110,80,A)', 80, 0.12);
    ctx.strokeStyle = 'rgba(40,38,35,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  });
}

/**
 * Painted concrete block for back-of-house walls: charcoal base, teal dado, cream upper.
 * One texture spans 2.4 m wide x 3.0 m tall (v = 0 at the floor).
 */
export function paintedBlock(seed: number): THREE.CanvasTexture {
  return canvasTexture(512, 640, seed, (ctx, w, h, rnd) => {
    const m = h / 3.0; // px per meter
    const y = (meters: number) => h - meters * m;
    ctx.fillStyle = '#d4cbb2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4c7c79';
    ctx.fillRect(0, y(1.15), w, 1.15 * m);
    ctx.fillStyle = '#2b2e31';
    ctx.fillRect(0, y(0.14), w, 0.14 * m);
    ctx.fillStyle = '#c99b2b';
    ctx.fillRect(0, y(1.17), w, 0.025 * m);
    // block coursing 0.4 x 0.2 m, running bond
    ctx.strokeStyle = 'rgba(60,58,52,0.35)';
    ctx.lineWidth = 1.2;
    const bw = 0.4 * m, bh = 0.2 * m;
    for (let row = 0; row * bh < h; row++) {
      const yy = h - row * bh;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
      for (let x = (row % 2) * bw / 2; x <= w; x += bw) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy - bh); ctx.stroke(); }
    }
    stains(ctx, w, h, rnd, 14, 'rgba(50,44,34,A)', 70, 0.25);
    // scuffs near the floor and drips from above
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(30,28,25,${0.08 + rnd() * 0.15})`;
      ctx.fillRect(rnd() * w, y(0.2 + rnd() * 0.7), 6 + rnd() * 30, 1 + rnd() * 3);
    }
    for (let i = 0; i < 10; i++) {
      const x = rnd() * w, len = (0.2 + rnd() * 0.9) * m;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(70,60,40,0.25)'); g.addColorStop(1, 'rgba(70,60,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 2 + rnd() * 3, len);
    }
  });
}

export function ballast(seed: number): THREE.CanvasTexture {
  return canvasTexture(512, 512, seed, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#3d3a36';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rnd, 4200, ['#4f4b45', '#2d2b28', '#5c5750', '#3a342c', '#6a645a'], 2, 6);
    stains(ctx, w, h, rnd, 12, 'rgba(15,13,10,A)', 90, 0.4);
  });
}

/** Charcoal-painted steel with chipped edges and rubbed areas. */
export function steelPaint(seed: number, base = '#2c3034'): THREE.CanvasTexture {
  return canvasTexture(256, 256, seed, (ctx, w, h, rnd) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rnd, 600, ['rgba(255,255,255,0.04)', 'rgba(0,0,0,0.08)'], 1, 4);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rnd() < 0.7 ? 'rgba(140,138,130,0.35)' : 'rgba(120,80,40,0.25)';
      ctx.beginPath();
      ctx.ellipse(rnd() * w, rnd() * h, 1 + rnd() * 5, 1 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    stains(ctx, w, h, rnd, 6, 'rgba(10,10,10,A)', 60, 0.25);
  });
}

export function crateWood(seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 256, seed, (ctx, w, h, rnd) => {
    ctx.fillStyle = '#7d6142';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#86694a' : '#74593c';
      ctx.fillRect(0, i * h / 4 + 3, w, h / 4 - 6);
      for (let k = 0; k < 30; k++) {
        ctx.strokeStyle = `rgba(50,35,20,${0.15 + rnd() * 0.2})`;
        ctx.beginPath();
        const yy = i * h / 4 + 6 + rnd() * (h / 4 - 12);
        ctx.moveTo(0, yy); ctx.bezierCurveTo(w / 3, yy + rnd() * 4 - 2, 2 * w / 3, yy + rnd() * 4 - 2, w, yy); ctx.stroke();
      }
    }
    ctx.fillStyle = '#3e3020';
    ctx.fillRect(0, 0, 10, h); ctx.fillRect(w - 10, 0, 10, h);
    ctx.fillStyle = 'rgba(30,30,30,0.55)';
    ctx.font = 'bold 34px Arial';
    ctx.fillText('TA-' + (100 + Math.floor(rnd() * 800)), 40, h / 2 + 12);
  });
}

/** Text plate for exit/service signs (charcoal field, cream lettering, mustard rule). */
export function signPlate(text: string, kind: 'exit' | 'service' | 'station', seed: number): THREE.CanvasTexture {
  const w = 1024, h = 220;
  return canvasTexture(w, h, seed, (ctx, W, H, rnd) => {
    ctx.fillStyle = kind === 'service' ? '#d8cfb6' : '#1f2225';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = kind === 'service' ? '#b53a2c' : '#d9a520';
    ctx.fillRect(0, H - 22, W, 10);
    ctx.fillStyle = kind === 'service' ? '#1f2225' : '#ece4cf';
    let size = 104;
    ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
    while (ctx.measureText(text).width > W - 80 && size > 40) { size -= 4; ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`; }
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 40, H / 2 - 8);
    if (kind === 'exit') {
      ctx.beginPath(); ctx.moveTo(W - 120, H / 2 - 40); ctx.lineTo(W - 50, H / 2 - 8); ctx.lineTo(W - 120, H / 2 + 24); ctx.closePath(); ctx.fill();
    }
    stains(ctx, W, H, rnd, 8, 'rgba(60,50,30,A)', 90, 0.18);
  });
}

export function pickupLabel(text: string, bg: string, fg: string, seed: number, cross = false): THREE.CanvasTexture {
  return canvasTexture(256, 128, seed, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    if (cross) {
      ctx.fillRect(w / 2 - 14, h / 2 - 44, 28, 88);
      ctx.fillRect(w / 2 - 44, h / 2 - 14, 88, 28);
    } else {
      ctx.font = 'bold 40px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
  });
}

/** Flat normal map placeholder so procedural materials share the same shader variant. */
export function soft(t: THREE.Texture, rx: number, ry: number): THREE.Texture {
  t.repeat.set(rx, ry);
  return t;
}

// =========================================================================================
// Iteration 04: layered, tileable surface sets for every procedural prop / storefront surface
// (colour + roughness + a drawn height layer turned into a tangent-space normal map), plus
// face-mapped graphic panels (menu boards, fare screen, vending front). Palette and finish follow
// reference/design/ENVIRONMENT-KIT.md and the concept board: charcoal-painted steel with teal
// undercoat, brushed stainless, cream/white glazed tile, mustard accents, weathered concrete.
// "Maintained neglect": rubbed contact points, chips, scratches, dirt in seams, credible repairs;
// not a uniform rust coat. All graphics are fictional/generic (no real brands or logos).
// Generated once per page (cached by name), shared by every material that uses them.

export interface SurfaceSet {
  map: THREE.Texture;
  roughnessMap: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  /** Real-world size (metres, u x v) of one repeat when world-mapped. */
  span: [number, number];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function hexRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Blend two hex colours (sRGB, authoring only). */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexRgb(a), y = hexRgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * clamp01(t)).toString(16).padStart(2, '0')).join('');
}
const grayCss = (v: number) => { const g = Math.round(clamp01(v) * 255); return `rgb(${g},${g},${g})`; };
function withAlpha(css: string, a: number): string {
  if (css[0] === '#') { const [r, g, b] = hexRgb(css); return `rgba(${r},${g},${b},${a})`; }
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return css;
  const p = m[1].split(',');
  return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
}

/** Per-layer values: colour (CSS), roughness 0..1, height 0..1 (0.5 = surface), alpha. */
interface Val { c?: string; r?: number; h?: number; a?: number }
type PathFn = (ctx: CanvasRenderingContext2D) => void;
/** Centre x, y and radius of a feature; used to repeat it across the edges so textures tile. */
type Bounds = [number, number, number];
type Pt = [number, number];

function layerCanvas(w: number, h: number, scale: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', {willReadFrequently: true})!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return [c, ctx];
}

function surfaceTexture(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Tangent-space normal map (glTF convention, +Y = image up) from a height canvas; wraps at the edges. */
function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const d = src.getContext('2d', {willReadFrequently: true})!.getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = d[i * 4] / 255;
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

/**
 * Paints the same features into colour, roughness and height layers so wear reads in all three
 * (a paint chip is lighter bare metal, smoother and slightly recessed). Features near an edge are
 * repeated on the opposite edge, so every set tiles seamlessly.
 */
export class Painter {
  readonly color: HTMLCanvasElement;
  readonly rough: HTMLCanvasElement | null = null;
  readonly height: HTMLCanvasElement | null = null;
  readonly rnd: () => number;
  private readonly layers: {ctx: CanvasRenderingContext2D; k: 'c' | 'r' | 'h'}[] = [];

  constructor(readonly w: number, readonly h: number, seed: number, opt: {rough?: number; height?: number} = {}) {
    this.rnd = mulberry32(seed);
    const [c, cctx] = layerCanvas(w, h, 1);
    this.color = c;
    this.layers.push({ctx: cctx, k: 'c'});
    if (opt.rough) { const [r, rctx] = layerCanvas(w, h, opt.rough); this.rough = r; this.layers.push({ctx: rctx, k: 'r'}); }
    if (opt.height) { const [hc, hctx] = layerCanvas(w, h, opt.height); this.height = hc; this.layers.push({ctx: hctx, k: 'h'}); }
  }

  get ctx(): CanvasRenderingContext2D { return this.layers[0].ctx; }
  rr(a: number, b: number): number { return a + (b - a) * this.rnd(); }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.rnd() * list.length)]; }

  private style(k: 'c' | 'r' | 'h', v: Val): string | undefined {
    if (k === 'c') return v.c;
    const n = k === 'r' ? v.r : v.h;
    return n === undefined ? undefined : grayCss(n);
  }
  private offsets(b?: Bounds): Pt[] {
    const xs = [0], ys = [0];
    if (!b) { xs.push(-this.w, this.w); ys.push(-this.h, this.h); } else {
      const [x, y, r] = b;
      if (x - r < 0) xs.push(this.w);
      if (x + r > this.w) xs.push(-this.w);
      if (y - r < 0) ys.push(this.h);
      if (y + r > this.h) ys.push(-this.h);
    }
    const out: Pt[] = [];
    for (const x of xs) for (const y of ys) out.push([x, y]);
    return out;
  }

  base(v: Val): void {
    for (const {ctx, k} of this.layers) {
      const st = this.style(k, {h: 0.5, ...v});
      if (st === undefined) continue;
      ctx.globalAlpha = 1;
      ctx.fillStyle = st;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
  /** Fill (or stroke, when lw > 0) a path on every layer that has a value. */
  shape(path: PathFn, v: Val, b?: Bounds, lw = 0): void {
    const offs = this.offsets(b);
    for (const {ctx, k} of this.layers) {
      const st = this.style(k, v);
      if (st === undefined) continue;
      ctx.globalAlpha = v.a ?? 1;
      if (lw > 0) { ctx.strokeStyle = st; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; } else ctx.fillStyle = st;
      for (const [ox, oy] of offs) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.beginPath();
        path(ctx);
        if (lw > 0) ctx.stroke(); else ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }
  /** Soft round dab with radial falloff: stains, rubbed areas, dents (height), mottling. */
  soft(x: number, y: number, r: number, v: Val): void {
    for (const {ctx, k} of this.layers) {
      const st = this.style(k, v);
      if (st === undefined) continue;
      for (const [ox, oy] of this.offsets([x, y, r])) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, withAlpha(st, v.a ?? 1));
        g.addColorStop(1, withAlpha(st, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    }
  }
  /** Irregular polygon (chip, patch). Points are fixed at creation so every layer gets the same shape. */
  blob(x: number, y: number, r: number, jag = 0.45, n = 9): PathFn {
    const pts: Pt[] = [];
    const a0 = this.rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * Math.PI * 2, rr = r * (1 - jag / 2 + this.rnd() * jag);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * this.rr(0.6, 1)]);
    }
    return poly(pts, true);
  }
  /** Short wobbly scratch as a polyline (stroke it). */
  scratch(x: number, y: number, len: number, ang: number): PathFn {
    const pts: Pt[] = [[x, y]];
    let a = ang, px = x, py = y;
    for (let i = 0; i < 3; i++) { a += this.rr(-0.25, 0.25); px += Math.cos(a) * len / 3; py += Math.sin(a) * len / 3; pts.push([px, py]); }
    return poly(pts, false);
  }
  /** Per-pixel luminance noise on the colour layer (material grain); tiles trivially. */
  grain(amount: number): void {
    const ctx = this.ctx;
    const img = ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (this.rnd() - 0.5) * amount;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  finish(span: [number, number], normalStrength = 0): SurfaceSet {
    return {
      map: surfaceTexture(this.color, true),
      roughnessMap: this.rough ? surfaceTexture(this.rough, false) : null,
      normalMap: this.height && normalStrength > 0 ? surfaceTexture(normalFromHeight(this.height, normalStrength), false) : null,
      span,
    };
  }
}

function poly(pts: Pt[], close: boolean): PathFn {
  return ctx => {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
  };
}
const rect = (x: number, y: number, w: number, h: number): PathFn => ctx => ctx.rect(x, y, w, h);
const ellipse = (x: number, y: number, rx: number, ry: number, rot = 0): PathFn => ctx => ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);

/** Mottling: many large faint dabs in two tones to break up flat colour. */
function mottle(p: Painter, n: number, rMin: number, rMax: number, tones: string[], alpha: number, rough?: [number, number]): void {
  for (let i = 0; i < n; i++) {
    p.soft(p.rr(0, p.w), p.rr(0, p.h), p.rr(rMin, rMax), {c: p.pick(tones), a: alpha * p.rr(0.4, 1), r: rough ? p.rr(rough[0], rough[1]) : undefined});
  }
}
/** Thin vertical run-down streaks (water/rust/grime), canvas y down = world down. */
function streaks(p: Painter, n: number, color: string, alpha: number, rough?: number, maxLen = 0.5): void {
  for (let i = 0; i < n; i++) {
    const x = p.rr(0, p.w), y = p.rr(0, p.h), len = p.rr(0.15, maxLen) * p.h, wdt = p.rr(1, 3.5);
    for (let k = 0; k < 6; k++) {
      const y0 = y + len * k / 6;
      p.shape(rect(x + p.rr(-0.6, 0.6), y0, wdt * (1 - k * 0.1), len / 6 + 1), {c: color, a: alpha * (1 - k / 6), r: rough}, [x, y0, len / 6 + wdt]);
    }
  }
}
function scratches(p: Painter, n: number, len: [number, number], v: Val, lw: [number, number], angle?: [number, number]): void {
  for (let i = 0; i < n; i++) {
    const x = p.rr(0, p.w), y = p.rr(0, p.h), l = p.rr(len[0], len[1]);
    const a = angle ? p.rr(angle[0], angle[1]) : p.rr(0, Math.PI * 2);
    p.shape(p.scratch(x, y, l, a), {...v, a: (v.a ?? 1) * p.rr(0.5, 1)}, [x, y, l * 1.2], p.rr(lw[0], lw[1]));
  }
}
function chips(p: Painter, n: number, r: [number, number], v: () => Val): void {
  for (let i = 0; i < n; i++) {
    const x = p.rr(0, p.w), y = p.rr(0, p.h), rad = p.rr(r[0], r[1]);
    p.shape(p.blob(x, y, rad), v(), [x, y, rad * 1.3]);
  }
}

// ---- surface sets --------------------------------------------------------------------------

/** Charcoal-painted steel (columns, frames, legs, grilles): teal undercoat and bare-metal chips. 1 x 1 m. */
function paintedSteel(seed: number): SurfaceSet {
  const p = new Painter(512, 512, seed, {rough: 0.5, height: 1});
  p.base({c: '#30363a', r: 0.6});
  mottle(p, 60, 30, 140, ['#3a4145', '#262b2e', '#343a36'], 0.45, [0.55, 0.7]);
  // Repainted patches (slightly different charcoal, crisp edges) = credible maintenance.
  for (let i = 0; i < 3; i++) { const x = p.rr(0, 512), y = p.rr(0, 512), w = p.rr(60, 160), h = p.rr(40, 120); p.shape(rect(x - w / 2, y - h / 2, w, h), {c: p.pick(['#2b3134', '#353b3f']), a: 0.7, r: 0.55, h: 0.52}, [x, y, Math.max(w, h)]); }
  // Rubbed areas (paint worn thin, slightly lighter and smoother).
  mottle(p, 10, 40, 110, ['#454c50', '#3f4649'], 0.35, [0.45, 0.55]);
  // Wear clusters: teal undercoat exposed where the top coat flaked, bare-steel chips around it.
  for (let i = 0; i < 3; i++) {
    const x = p.rr(0, 512), y = p.rr(0, 512), r = p.rr(20, 48);
    p.shape(p.blob(x, y, r, 1.0, 17), {c: p.pick(['#3a5754', '#36504d', '#3d5b57']), a: 0.5, r: 0.55, h: 0.47}, [x, y, r * 1.6]);
    for (let k = 0; k < 6; k++) { const a = p.rr(0, Math.PI * 2), d = r * p.rr(0.6, 1.4), cr = p.rr(1, 3); p.shape(p.blob(x + Math.cos(a) * d, y + Math.sin(a) * d, cr), {c: p.pick(['#6f6d67', '#64625d']), r: 0.36, h: 0.43}, [x, y, r * 2]); }
  }
  for (let i = 0; i < 6; i++) {
    const cx = p.rr(0, 512), cy = p.rr(0, 512);
    for (let k = 0; k < 6; k++) { const x = cx + p.rr(-30, 30), y = cy + p.rr(-30, 30), cr = p.rr(0.8, 2.8); p.shape(p.blob(x, y, cr), {c: p.pick(['#6f6d67', '#64625d', '#7a7871']), r: 0.36, h: 0.43}, [x, y, cr * 1.3]); }
  }
  chips(p, 25, [0.8, 2.5], () => ({c: '#75736c', r: 0.38, h: 0.44, a: 0.8}));
  chips(p, 14, [1, 2.5], () => ({c: p.pick(['#5e3f28', '#6b4a2e']), r: 0.85, h: 0.44, a: 0.7}));
  scratches(p, 70, [8, 60], {c: '#6f6d67', r: 0.42, h: 0.46, a: 0.45}, [0.6, 1.2]);
  streaks(p, 10, '#1d2124', 0.25, 0.7);
  mottle(p, 22, 20, 90, ['#5e574b', '#4f4a40'], 0.22, [0.75, 0.9]);
  p.grain(10);
  return p.finish([1, 1], 2.4);
}

/** Brushed stainless (shelf decks, nosings, kitchen equipment, rails). 1 x 1 m, grain along u. */
function brushedSteel(seed: number): SurfaceSet {
  const p = new Painter(512, 512, seed, {rough: 0.5, height: 1});
  p.base({c: '#a6aaac', r: 0.38});
  mottle(p, 30, 40, 160, ['#b3b6b7', '#9a9ea1'], 0.4);
  for (let i = 0; i < 1500; i++) {
    const y = p.rr(0, 512), x = p.rr(-200, 512), len = p.rr(80, 512);
    p.shape(rect(x, y, len, p.rr(0.5, 1.3)), {c: p.pick(['#c5c8c9', '#8f9396', '#b8bbbc', '#9da1a3']), a: p.rr(0.15, 0.45), r: p.rr(0.3, 0.46), h: p.rr(0.47, 0.53)}, [x + len / 2, y, len]);
  }
  // Fingerprints / wiped smudges (duller), water spots, dents, scratches, grime at contact points.
  mottle(p, 40, 10, 50, ['#7f8284', '#8c8e8f'], 0.35, [0.5, 0.62]);
  for (let i = 0; i < 70; i++) { const x = p.rr(0, 512), y = p.rr(0, 512), r = p.rr(2, 6); p.shape(ellipse(x, y, r, r), {c: '#d3d4d2', a: 0.18, r: 0.5}, [x, y, r + 1], 0.8); }
  for (let i = 0; i < 6; i++) p.soft(p.rr(0, 512), p.rr(0, 512), p.rr(12, 40), {h: 0.35, a: 0.6});
  scratches(p, 70, [10, 80], {c: '#d7d9d8', r: 0.28, h: 0.47, a: 0.5}, [0.6, 1.1]);
  mottle(p, 18, 20, 80, ['#6b665c', '#5d584f'], 0.2, [0.6, 0.75]);
  p.grain(6);
  return p.finish([1, 1], 1.4);
}

/** Enamel-painted sheet steel, light neutral so materials/instances tint it (stall fronts, panels, partitions). 1.2 x 1.2 m. */
function paintedPanel(seed: number): SurfaceSet {
  const p = new Painter(512, 512, seed, {rough: 0.5, height: 1});
  p.base({c: '#d5d1c7', r: 0.5});
  mottle(p, 50, 30, 150, ['#c9c4b9', '#e0ddd5', '#cfc9bb'], 0.35, [0.45, 0.6]);
  // Vertical panel seam (one per repeat = every 1.2 m) with dirt in the joint.
  p.shape(rect(-1.5, 0, 3, 512), {c: '#4a4740', r: 0.85, h: 0.2});
  p.shape(rect(1.5, 0, 2, 512), {c: '#efece6', a: 0.5, h: 0.6});
  // Fastener heads along the seam.
  for (let y = 16; y < 512; y += 64) p.shape(ellipse(8, y, 2.6, 2.6), {c: '#8f8b83', r: 0.4, h: 0.7}, [8, y, 4]);
  // Scuffs (rubbed, horizontal), dents, chips to primer/steel, scratches, sticker residue.
  for (let i = 0; i < 45; i++) { const x = p.rr(0, 512), y = p.rr(0, 512), rx = p.rr(5, 30), ry = p.rr(1, 4); p.shape(ellipse(x, y, rx, ry, p.rr(-0.6, 0.6)), {c: p.pick(['#5a564f', '#6e695f', '#3f3c37']), a: p.rr(0.08, 0.22), r: 0.62}, [x, y, rx]); }
  mottle(p, 8, 40, 120, ['#bdb6a8', '#b3ad9f'], 0.35, [0.55, 0.65]);
  for (let i = 0; i < 9; i++) p.soft(p.rr(0, 512), p.rr(0, 512), p.rr(14, 46), {h: 0.36, a: 0.7});
  chips(p, 60, [1.2, 5], () => ({c: p.pick(['#8a8780', '#9b978e', '#4a4d50']), r: 0.45, h: 0.44}));
  scratches(p, 50, [8, 50], {c: '#8f8b83', r: 0.55, h: 0.47, a: 0.45}, [0.6, 1.2]);
  for (let i = 0; i < 6; i++) {
    const x = p.rr(0, 512), y = p.rr(0, 512), w = p.rr(18, 60), h = p.rr(12, 40);
    p.shape(poly([[x, y], [x + w, y + p.rr(-3, 3)], [x + w + p.rr(-4, 4), y + h], [x + p.rr(-4, 4), y + h + p.rr(-3, 3)]], true), {c: p.pick(['#e8e1cd', '#ded6bf', '#cfc6ad']), a: 0.55, r: 0.85, h: 0.51}, [x + w / 2, y + h / 2, Math.max(w, h)]);
  }
  mottle(p, 26, 20, 100, ['#6d665a', '#5f5a50'], 0.16, [0.6, 0.75]);
  p.grain(7);
  return p.finish([1.2, 1.2], 2.2);
}

/** Speckled counter laminate (food-court counters, tables, desks). 1 x 1 m. */
function laminate(seed: number): SurfaceSet {
  const p = new Painter(512, 512, seed, {rough: 0.5, height: 0.5});
  p.base({c: '#cbc2ae', r: 0.4});
  mottle(p, 30, 40, 140, ['#c3b9a3', '#d4ccba'], 0.35);
  for (let i = 0; i < 9000; i++) {
    const x = p.rr(0, 512), y = p.rr(0, 512), r = p.rr(0.6, 1.8);
    p.shape(ellipse(x, y, r, r * p.rr(0.5, 1), p.rr(0, 3)), {c: p.pick(['#a39780', '#efe9db', '#7d7360', '#958a73', '#ddd4c0', '#6f6654']), a: p.rr(0.7, 1)}, [x, y, r]);
  }
  // Rubbed-dull wear where hands/trays slide, knife/tray scratches, cup rings, a cigarette burn.
  mottle(p, 12, 50, 130, ['#dbd3c3', '#d2c9b6'], 0.3, [0.52, 0.6]);
  scratches(p, 160, [6, 40], {c: '#ede7da', r: 0.52, h: 0.47, a: 0.4}, [0.5, 0.9]);
  for (let i = 0; i < 8; i++) { const x = p.rr(0, 512), y = p.rr(0, 512), r = p.rr(16, 30); p.shape(ellipse(x, y, r, r), {c: '#968a73', a: p.rr(0.12, 0.25), r: 0.55}, [x, y, r + 2], p.rr(1.5, 3)); }
  { const x = p.rr(60, 450), y = p.rr(60, 450); p.soft(x, y, 9, {c: '#4a3a2a', a: 0.7, r: 0.7}); p.soft(x, y, 4, {c: '#2a2018', a: 0.8, h: 0.4}); }
  mottle(p, 16, 20, 80, ['#8a7f6c', '#7d725f'], 0.14, [0.55, 0.7]);
  p.grain(6);
  return p.finish([1, 1], 1.2);
}

/** Grimy glazing: RGBA (alpha = smudge/dust density) for transparent glass. 1 x 1 m. */
function grimyGlass(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5});
  p.ctx.clearRect(0, 0, 256, 256);
  p.base({c: 'rgba(168,184,190,0.5)', r: 0.08});
  mottle(p, 26, 20, 90, ['#8c8a80', '#9a988e', '#7d7a70'], 0.5, [0.25, 0.4]);
  for (let i = 0; i < 10; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), r = p.rr(30, 80); p.shape(ctx => ctx.arc(x, y, r, p.rr(0, 3), p.rr(3.5, 6)), {c: '#a8a69c', a: 0.18, r: 0.3}, [x, y, r + 8], p.rr(5, 12)); }
  for (let i = 0; i < 500; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), r = p.rr(0.4, 1.2); p.shape(ellipse(x, y, r, r), {c: '#bdb8aa', a: p.rr(0.3, 0.7), r: 0.5}, [x, y, r]); }
  streaks(p, 14, '#8b867a', 0.25, 0.35, 0.7);
  scratches(p, 25, [10, 50], {c: '#dfe4e4', a: 0.35, r: 0.2}, [0.5, 0.9]);
  return p.finish([1, 1]);
}

/** Galvanised roll-down shutter slats (8 per repeat, 75 mm pitch) with dirt in the grooves. 1 x 0.6 m. */
function shutterSlats(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5, height: 1});
  p.base({c: '#8b8f91', r: 0.55});
  // Galvanised spangle.
  for (let i = 0; i < 260; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), r = p.rr(4, 12); p.shape(p.blob(x, y, r, 0.6, 6), {c: p.pick(['#959a9c', '#82878a', '#8e9294']), a: 0.45, r: p.rr(0.45, 0.62)}, [x, y, r * 1.3]); }
  const P = 32;
  for (let s = 0; s < 8; s++) {
    const y = s * P;
    p.shape(rect(0, y, 256, 3), {c: '#a9adaf', a: 0.8, h: 0.68});
    for (let k = 0; k < 6; k++) p.shape(rect(0, y + 3 + k * 4, 256, 4), {h: 0.66 - k * 0.04});
    p.shape(rect(0, y + 22, 256, 6), {c: '#6f7376', a: 0.6, h: 0.36});
    p.shape(rect(0, y + 28, 256, 4), {c: '#3d3f40', r: 0.85, h: 0.1});
  }
  // Rust weeping from the grooves, buffed-out graffiti patches (paint slightly off-colour), dents, grime.
  for (let i = 0; i < 12; i++) { const x = p.rr(0, 256), y = Math.floor(p.rr(0, 8)) * P + 30, len = p.rr(10, 60); for (let k = 0; k < 5; k++) p.shape(rect(x, y + k * len / 5, p.rr(1, 2.5), len / 5 + 1), {c: '#6b4b30', a: 0.35 * (1 - k / 5), r: 0.8}, [x, y + k * len / 5, len]); }
  for (let i = 0; i < 3; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), w = p.rr(40, 110), h = p.rr(30, 80); p.shape(rect(x - w / 2, y - h / 2, w, h), {c: p.pick(['#7a7e81', '#959189', '#868a7f']), a: 0.5, r: 0.62}, [x, y, Math.max(w, h)]); }
  for (let i = 0; i < 5; i++) p.soft(p.rr(0, 256), p.rr(0, 256), p.rr(10, 26), {h: 0.3, a: 0.6});
  scratches(p, 30, [6, 40], {c: '#b7bbbc', r: 0.4, a: 0.5}, [0.6, 1]);
  mottle(p, 16, 20, 70, ['#4f4a42', '#3e3a33'], 0.25, [0.7, 0.85]);
  p.grain(8);
  return p.finish([1, 0.6], 3);
}

function tileGrid(p: Painter, n: number, grout: number, face: () => string, rough: () => number, odd: number, oddColors: string[]): void {
  const s = p.w / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * s + grout / 2, y = j * s + grout / 2, w = s - grout;
    const c = p.rnd() < odd ? p.pick(oddColors) : face();
    p.shape(rect(x, y, w, w), {c, r: rough(), h: 0.62});
    p.shape(rect(x + 1.5, y + 1.5, w - 3, w - 3), {h: 0.66});
  }
}

/** Shop interior wall tile: 150 mm white glazed squares, stack bond, grey grout. 1.2 x 1.2 m. */
function shopTile(seed: number): SurfaceSet {
  const p = new Painter(512, 512, seed, {rough: 0.5, height: 1});
  p.base({c: '#8a857a', r: 0.9, h: 0.22});
  tileGrid(p, 8, 4, () => mixHex('#e9e6dc', p.pick(['#dcd7c9', '#f2f0e8', '#e4e0d3']), p.rr(0, 0.8)), () => p.rr(0.14, 0.24), 0.05, ['#d3dbd2', '#e6dcc2', '#cfd3d4']);
  // Glaze highlights, cracked tiles, chipped corners, grease/grime, darker grout patches.
  mottle(p, 40, 10, 40, ['#f7f5ef'], 0.25);
  for (let i = 0; i < 6; i++) {
    const x = p.rr(0, 512), y = p.rr(0, 512);
    const pts: Pt[] = [[x, y]]; let a = p.rr(0, 6.28), px = x, py = y;
    for (let k = 0; k < 5; k++) { a += p.rr(-0.6, 0.6); px += Math.cos(a) * 12; py += Math.sin(a) * 12; pts.push([px, py]); }
    p.shape(poly(pts, false), {c: '#5d594f', r: 0.7, h: 0.3, a: 0.8}, [x, y, 70], 0.9);
  }
  for (let i = 0; i < 8; i++) { const x = Math.round(p.rr(0, 8)) * 64, y = Math.round(p.rr(0, 8)) * 64, r = p.rr(3, 7); p.shape(p.blob(x, y, r, 0.6, 7), {c: '#b8b1a2', r: 0.75, h: 0.3}, [x, y, r * 1.3]); }
  mottle(p, 30, 20, 110, ['#8a7d63', '#7a6e57', '#998a6c'], 0.2, [0.4, 0.6]);
  p.grain(6);
  return p.finish([1.2, 1.2], 2.6);
}

/** Red quarry-tile kitchen/shop floor: 150 mm squares, dark grout, worn traffic, grease. 1.2 x 1.2 m. */
function quarryTile(seed: number): SurfaceSet {
  const p = new Painter(512, 512, seed, {rough: 0.5, height: 1});
  p.base({c: '#3b342f', r: 0.95, h: 0.2});
  tileGrid(p, 8, 5, () => p.pick(['#7f4a38', '#874f3b', '#76432f', '#8d5643', '#7a4a3a']), () => p.rr(0.62, 0.78), 0.06, ['#6f4231', '#94604b']);
  mottle(p, 90, 6, 30, ['#8c5a45', '#6e4232', '#93644f'], 0.3);
  mottle(p, 14, 60, 160, ['#9a7462', '#a17c6a'], 0.28, [0.5, 0.6]);
  mottle(p, 18, 20, 90, ['#3b2a22', '#2e221c'], 0.3, [0.4, 0.5]);
  chips(p, 30, [1.5, 5], () => ({c: '#5c4034', h: 0.38, r: 0.85}));
  scratches(p, 40, [8, 40], {c: '#b88a72', a: 0.3, r: 0.6}, [0.6, 1]);
  p.grain(10);
  return p.finish([1.2, 1.2], 2);
}

/** Wood veneer panelling, vertical grain, 600 mm leaves with dark joints. 1.2 x 1.2 m. */
function woodVeneer(seed: number): SurfaceSet {
  const p = new Painter(512, 512, seed, {rough: 0.5, height: 0.5});
  p.base({c: '#7a5536', r: 0.58});
  for (let k = 0; k < 2; k++) { // two leaves per repeat, slightly different tone (book-matched flitches)
    p.shape(rect(k * 256, 0, 256, 512), {c: k ? '#7f593a' : '#74502f', a: 0.7});
    for (let i = 0; i < 140; i++) {
      const x0 = k * 256 + p.rr(0, 256), amp = p.rr(1, 7), fr = p.rr(0.008, 0.03), ph = p.rr(0, 6.28);
      const pts: Pt[] = [];
      for (let y = -8; y <= 520; y += 8) pts.push([x0 + Math.sin(y * fr + ph) * amp, y]);
      p.shape(poly(pts, false), {c: p.pick(['#5f3f26', '#8e6640', '#6a482c', '#94704a']), a: p.rr(0.25, 0.55), h: p.rr(0.47, 0.53)}, [x0, 256, 300], p.rr(0.6, 2));
    }
  }
  for (const x of [0, 256]) p.shape(rect(x - 1.5, 0, 3, 512), {c: '#2e2118', r: 0.85, h: 0.2});
  scratches(p, 40, [8, 50], {c: '#a07c58', r: 0.6, a: 0.45, h: 0.47}, [0.6, 1.1]);
  mottle(p, 16, 30, 110, ['#4b3524', '#5a4030'], 0.22, [0.62, 0.75]);
  mottle(p, 10, 30, 90, ['#a3825f'], 0.15, [0.5, 0.58]);
  p.grain(7);
  return p.finish([1.2, 1.2], 1.2);
}

/** Moulded plastic/fibreglass (seats), light neutral for tinting. 0.5 x 0.5 m. */
function mouldedPlastic(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5, height: 1});
  p.base({c: '#d8d5ce', r: 0.42});
  mottle(p, 30, 15, 70, ['#cdc9c0', '#e3e0d9'], 0.35);
  scratches(p, 50, [6, 40], {c: '#f0eee8', r: 0.56, a: 0.45, h: 0.47}, [0.6, 1]);
  for (let i = 0; i < 30; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), rx = p.rr(4, 20); p.shape(ellipse(x, y, rx, p.rr(0.6, 2), p.rr(-0.5, 0.5)), {c: '#6f6b62', a: p.rr(0.1, 0.3), r: 0.6}, [x, y, rx]); }
  for (let i = 0; i < 3; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), r = p.rr(2.5, 5); p.shape(p.blob(x, y, r), {c: '#4a4640', a: 0.75, r: 0.8, h: 0.62}, [x, y, r * 1.3]); }
  mottle(p, 12, 20, 70, ['#6d665a'], 0.15, [0.5, 0.65]);
  p.grain(5);
  return p.finish([0.5, 0.5], 1);
}

/** Glazed porcelain (toilets, basins): crazing, limescale and rust drips. 0.6 x 0.6 m. */
function porcelain(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5, height: 0.5});
  p.base({c: '#eae7df', r: 0.12});
  mottle(p, 20, 15, 60, ['#e1ddd3', '#f2f0ea'], 0.4);
  for (let i = 0; i < 60; i++) {
    const x = p.rr(0, 256), y = p.rr(0, 256);
    const pts: Pt[] = [[x, y]]; let a = p.rr(0, 6.28), px = x, py = y;
    for (let k = 0; k < 4; k++) { a += p.rr(-1, 1); px += Math.cos(a) * 7; py += Math.sin(a) * 7; pts.push([px, py]); }
    p.shape(poly(pts, false), {c: '#c4beb1', a: 0.4, h: 0.45}, [x, y, 30], 0.5);
  }
  mottle(p, 10, 15, 50, ['#c6b28a', '#bfae8e'], 0.25, [0.25, 0.35]);
  streaks(p, 6, '#9a6a3c', 0.22, 0.3, 0.4);
  mottle(p, 10, 20, 60, ['#a59d8c'], 0.16, [0.25, 0.4]);
  p.grain(4);
  return p.finish([0.6, 0.6], 1.2);
}

/** Black rubber/plastic (flaps, keypads, kick plates, locks). 0.5 x 0.5 m. */
function blackPlastic(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5, height: 0.5});
  p.base({c: '#18191a', r: 0.72});
  mottle(p, 20, 15, 60, ['#202122', '#121314'], 0.5);
  scratches(p, 40, [6, 40], {c: '#4a4b4b', r: 0.5, a: 0.5, h: 0.47}, [0.6, 1.1]);
  mottle(p, 20, 15, 70, ['#4a4741', '#3b3833'], 0.18, [0.85, 0.95]);
  p.grain(10);
  return p.finish([0.5, 0.5], 1);
}

/** Old mirror: desilvering spots, smudges, scratches (no environment map; reads as pale glass). 1 x 1 m. */
function oldMirror(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5});
  p.base({c: '#a9b3b7', r: 0.07});
  mottle(p, 16, 30, 100, ['#b9c2c5', '#98a2a6'], 0.4);
  for (let i = 0; i < 7; i++) p.soft(p.rr(0, 256), p.rr(0, 256), p.rr(8, 22), {c: p.pick(['#3a3a36', '#4c4a43', '#5f5a4d']), a: p.rr(0.35, 0.6), r: 0.5});
  for (let i = 0; i < 70; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), r = p.rr(0.4, 1.2); p.shape(ellipse(x, y, r, r), {c: '#3d3c37', a: 0.45, r: 0.5}, [x, y, r]); }
  mottle(p, 14, 15, 60, ['#8e9294', '#7f8486'], 0.3, [0.25, 0.4]);
  scratches(p, 30, [10, 60], {c: '#dde2e4', a: 0.35, r: 0.15}, [0.5, 0.8]);
  return p.finish([1, 1]);
}

/** Backlit fascia acrylic (shop sign band background; lettering comes from the sign system). 1.2 x 0.6 m. */
function signBand(seed: number): SurfaceSet {
  const p = new Painter(512, 256, seed, {rough: 0.5});
  p.base({c: '#ddd6c4', r: 0.35});
  // Two horizontal fluorescent tubes behind the face.
  for (const y of [85, 171]) for (let k = 5; k >= 1; k--) p.shape(rect(0, y - k * 9, 512, k * 18), {c: '#f3eedf', a: 0.12});
  mottle(p, 14, 30, 120, ['#cbb98e', '#c4b48c'], 0.3);
  p.soft(p.rr(80, 430), p.rr(40, 210), p.rr(40, 90), {c: '#7d786c', a: 0.45});
  p.shape(rect(-2, 0, 4, 256), {c: '#7a756a', r: 0.6});
  for (let i = 0; i < 260; i++) { const x = p.rr(0, 512), y = p.rr(0, 256), r = p.rr(0.6, 1.8); p.shape(ellipse(x, y, r, r), {c: '#5d574b', a: p.rr(0.3, 0.7)}, [x, y, r]); }
  streaks(p, 8, '#9c8f74', 0.2, 0.5, 0.6);
  p.grain(5);
  return p.finish([1.2, 0.6]);
}

/** Creosoted timber tie: grain and checks along u. 1 x 0.5 m. */
function timberTie(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5, height: 1});
  p.base({c: '#3a2f26', r: 0.9});
  for (let i = 0; i < 90; i++) {
    const y0 = p.rr(0, 256), amp = p.rr(0.5, 3), fr = p.rr(0.01, 0.04), ph = p.rr(0, 6.28);
    const pts: Pt[] = [];
    for (let x = -8; x <= 264; x += 8) pts.push([x, y0 + Math.sin(x * fr + ph) * amp]);
    p.shape(poly(pts, false), {c: p.pick(['#2a2119', '#4a3c2f', '#33281f']), a: p.rr(0.3, 0.7), h: p.rr(0.45, 0.55)}, [128, y0, 140], p.rr(0.6, 2));
  }
  for (let i = 0; i < 7; i++) { const x = p.rr(0, 256), y = p.rr(0, 256), l = p.rr(30, 110); p.shape(poly([[x, y], [x + l * 0.5, y + p.rr(-1.5, 1.5)], [x + l, y + p.rr(-2, 2)]], false), {c: '#17110c', a: 0.75, h: 0.2, r: 1}, [x + l / 2, y, l], p.rr(0.8, 1.6)); }
  mottle(p, 30, 10, 60, ['#6a645a', '#57524a', '#1b1612'], 0.3, [0.85, 1]);
  p.grain(10);
  return p.finish([1, 0.5], 2);
}

/** Rail steel: dark oxide with rust bloom and wheel-polish streaks. 0.5 x 0.5 m. */
function railSteel(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5, height: 0.5});
  p.base({c: '#57524c', r: 0.65});
  mottle(p, 40, 10, 60, ['#6b4630', '#7a5236', '#4a4540', '#5e4a3a'], 0.45, [0.7, 0.9]);
  for (let i = 0; i < 40; i++) { const y = p.rr(0, 256); p.shape(rect(0, y, 256, p.rr(0.6, 2)), {c: '#8c8a86', a: p.rr(0.1, 0.35), r: 0.35}, [128, y, 130]); }
  streaks(p, 10, '#3a2a1e', 0.3, 0.85, 0.6);
  p.grain(10);
  return p.finish([0.5, 0.5], 1);
}

/** Weathered fibreglass third-rail coverboard, faded mustard. 1 x 1 m. */
function coverboard(seed: number): SurfaceSet {
  const p = new Painter(256, 256, seed, {rough: 0.5, height: 0.5});
  p.base({c: '#a3843f', r: 0.75});
  mottle(p, 40, 10, 60, ['#b39352', '#8f7236', '#a07d3b'], 0.4);
  for (let i = 0; i < 300; i++) { const x = p.rr(0, 256), y = p.rr(0, 256); p.shape(rect(x, y, p.rr(3, 12), 0.8), {c: '#c4a868', a: 0.25, h: 0.52}, [x, y, 12]); }
  mottle(p, 22, 10, 45, ['#3b342a', '#4a4134', '#2a2520'], 0.2, [0.85, 1]);
  streaks(p, 10, '#3b342a', 0.2, 0.9, 0.5);
  scratches(p, 20, [8, 40], {c: '#c9b07a', a: 0.4, r: 0.6}, [0.6, 1]);
  p.grain(10);
  return p.finish([1, 1], 1);
}

export type SurfaceName =
  | 'paintedSteel' | 'brushedSteel' | 'paintedPanel' | 'laminate' | 'glass' | 'shutter' | 'shopTile' | 'quarryTile'
  | 'woodVeneer' | 'plastic' | 'porcelain' | 'black' | 'mirror' | 'signBand' | 'timberTie' | 'railSteel' | 'coverboard';

const SURFACES: Record<SurfaceName, () => SurfaceSet> = {
  paintedSteel: () => paintedSteel(4101), brushedSteel: () => brushedSteel(4102), paintedPanel: () => paintedPanel(4103),
  laminate: () => laminate(4104), glass: () => grimyGlass(4105), shutter: () => shutterSlats(4106), shopTile: () => shopTile(4107),
  quarryTile: () => quarryTile(4108), woodVeneer: () => woodVeneer(4109), plastic: () => mouldedPlastic(4110), porcelain: () => porcelain(4111),
  black: () => blackPlastic(4112), mirror: () => oldMirror(4113), signBand: () => signBand(4114), timberTie: () => timberTie(4115),
  railSteel: () => railSteel(4116), coverboard: () => coverboard(4117),
};
export const SURFACE_NAMES = Object.keys(SURFACES) as SurfaceName[];
const surfaceCache = new Map<SurfaceName, SurfaceSet>();
/** Shared, generated-once texture set (do not mutate repeat/offset: world mapping scales in the shader). */
export function surface(name: SurfaceName): SurfaceSet {
  let s = surfaceCache.get(name);
  if (!s) surfaceCache.set(name, (s = SURFACES[name]()));
  return s;
}
/** Drops generated sets (tests/previews that swap the canvas implementation). */
export function resetSurfaceCache(): void { surfaceCache.clear(); }

// ---- face-mapped graphic panels (0..1 per box face) ---------------------------------------

const SANS = '"Helvetica Neue", Arial, sans-serif';
function faceTexture(w: number, h: number, seed: number, draw: (p: Painter) => void): THREE.CanvasTexture {
  const p = new Painter(w, h, seed);
  draw(p);
  const t = surfaceTexture(p.color, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
/** Shared face grime: uneven backlight, dust specks and a dirty lower edge. */
function panelWear(p: Painter, dead: boolean): void {
  const {w, h} = p;
  const g = p.ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(40,34,26,0.08)'); g.addColorStop(1, 'rgba(40,34,26,0.35)');
  p.ctx.fillStyle = g; p.ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) p.soft(p.rr(0, w), p.rr(0, h), p.rr(w * 0.08, w * 0.25), {c: '#2a241c', a: p.rr(0.08, 0.2)});
  for (let i = 0; i < w * h / 900; i++) { const x = p.rr(0, w), y = p.rr(0, h), r = p.rr(0.5, 1.6); p.shape(ellipse(x, y, r, r), {c: '#3a352c', a: p.rr(0.2, 0.6)}, [x, y, r]); }
  if (dead) { const x = p.rr(0, w * 0.7), wd = p.rr(w * 0.12, w * 0.3); p.shape(rect(x, 0, wd, h), {c: '#0c0c0b', a: 0.55}, [x + wd / 2, h / 2, w]); }
}

type MenuItem = [string, string];
interface MenuDef { name: string; tag: string; bg: string; fg: string; accent: string; band: string; sections: [string, MenuItem[]][]; food: string[] }
/** Fictional, generic food-court menus (no real brands). */
export const MENUS: MenuDef[] = [
  {name: 'GRILL & FRIES', tag: 'COMBOS SERVED WITH FRIES + DRINK', bg: '#1c1e20', fg: '#efe6cf', accent: '#d9a520', band: '#a8362b',
    sections: [['BURGERS', [['Classic Burger', '6.49'], ['Cheeseburger', '6.99'], ['Double Stack', '8.79'], ['Veggie Burger', '6.99']]],
      ['HOT DOGS', [['Street Dog', '3.99'], ['Chili Dog', '4.79']]], ['SIDES', [['Fries', '2.99'], ['Onion Rings', '3.49']]], ['DRINKS', [['Fountain Soda', '1.99'], ['Iced Tea', '2.19']]]],
    food: ['#8a4a26', '#d9a23a', '#6e8a3a', '#b8402e']},
  {name: 'NOODLE BAR', tag: 'WOK FRESH · ALL DAY', bg: '#efe6d0', fg: '#2a2522', accent: '#a8362b', band: '#2a2522',
    sections: [['NOODLES', [['Lo Mein', '8.25'], ['Pad Noodle', '8.95'], ['Beef Noodle Soup', '9.50']]], ['RICE', [['Fried Rice', '7.75'], ['Teriyaki Bowl', '8.95']]],
      ['SMALL PLATES', [['Dumplings (6)', '5.50'], ['Spring Rolls (2)', '3.25']]], ['DRINKS', [['Green Tea', '1.95'], ['Bottled Water', '1.79']]]],
    food: ['#c98a3a', '#e8d6a8', '#6a8a3a', '#a8362b']},
  {name: 'CORNER COFFEE', tag: 'FRESH BREWED · BAKED DAILY', bg: '#25352f', fg: '#efe6cf', accent: '#c99a2e', band: '#c99a2e',
    sections: [['COFFEE', [['Regular Coffee', '1.85'], ['Latte', '3.95'], ['Cappuccino', '3.75'], ['Hot Chocolate', '2.95']]], ['BAKERY', [['Bagel + Cream Cheese', '2.75'], ['Blueberry Muffin', '2.49'], ['Glazed Donut', '1.59']]],
      ['BREAKFAST', [['Egg Sandwich', '4.95'], ['Oatmeal', '3.25']]]],
    food: ['#5a3a22', '#d9b06a', '#3a2a1e', '#c9a46a']},
  {name: 'SLICE STOP', tag: 'BY THE SLICE OR WHOLE PIE', bg: '#1f2225', fg: '#f2ead6', accent: '#c2463a', band: '#2f7a78',
    sections: [['SLICES', [['Cheese Slice', '3.25'], ['Pepperoni Slice', '3.75'], ['Veggie Slice', '3.75'], ['Two Slices + Soda', '7.99']]], ['SIDES', [['Garlic Knots (4)', '2.99'], ['Caesar Salad', '5.49']]],
      ['DRINKS', [['Fountain Soda', '1.99'], ['Lemonade', '2.29']]]],
    food: ['#d9a23a', '#b8402e', '#e8c87a', '#6a8a3a']},
];

function foodPhoto(p: Painter, x: number, y: number, w: number, h: number, colors: string[]): void {
  const ctx = p.ctx;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#4a4238'); g.addColorStop(1, '#2a2520');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  p.shape(ellipse(x + w / 2, y + h * 0.6, w * 0.38, h * 0.3), {c: '#e8e2d4'});
  for (let i = 0; i < 7; i++) p.shape(p.blob(x + w / 2 + p.rr(-w * 0.22, w * 0.22), y + h * 0.55 + p.rr(-h * 0.15, h * 0.12), p.rr(w * 0.06, w * 0.14), 0.5, 8), {c: p.pick(colors)}, [0, 0, 1e4]);
  p.soft(x + w * 0.35, y + h * 0.35, w * 0.25, {c: '#fff6e0', a: 0.25});
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
}

/** Backlit menu panel for a counter (1024 x 512; designed for ~2:1 faces). */
export function menuBoardTexture(variant: number): THREE.CanvasTexture {
  const m = MENUS[((variant % MENUS.length) + MENUS.length) % MENUS.length];
  return faceTexture(1024, 512, 4200 + variant, p => {
    const ctx = p.ctx;
    ctx.fillStyle = m.bg; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = m.band; ctx.fillRect(0, 0, 1024, 92);
    ctx.fillStyle = m.accent; ctx.fillRect(0, 92, 1024, 8);
    ctx.fillStyle = m.band === m.fg ? m.bg : '#f4eedd';
    ctx.font = `bold 60px ${SANS}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(m.name, 34, 48);
    ctx.font = `bold 20px ${SANS}`; ctx.textAlign = 'right';
    ctx.fillText(m.tag, 990, 52);
    // Two food "photos" on the left, item columns on the right.
    foodPhoto(p, 24, 120, 300, 170, m.food);
    foodPhoto(p, 24, 304, 300, 170, [...m.food].reverse());
    const cols = [360, 690];
    let col = 0, y = 128;
    for (const [title, items] of m.sections) {
      const need = 40 + items.length * 34;
      if (y + need > 490 && col === 0) { col = 1; y = 128; }
      const x = cols[col];
      ctx.textAlign = 'left'; ctx.fillStyle = m.accent; ctx.font = `bold 26px ${SANS}`; ctx.fillText(title, x, y + 12);
      ctx.fillRect(x, y + 30, 300, 3);
      y += 44;
      for (const [name, price] of items) {
        ctx.fillStyle = m.fg; ctx.font = `22px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(name, x, y + 10);
        ctx.font = `bold 22px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText(price, x + 300, y + 10);
        y += 34;
      }
      y += 14;
    }
    // Taped-over price and a hand-written sign (credible neglect), then grime.
    const sx = cols[0] + 240, sy = 172;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.05);
    ctx.fillStyle = '#f0d860'; ctx.fillRect(-6, -14, 70, 30);
    ctx.fillStyle = '#2a2522'; ctx.font = `bold 20px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(String(5 + variant) + '.99', 0, 2);
    ctx.restore();
    ctx.save(); ctx.translate(880, 455); ctx.rotate(0.06);
    ctx.fillStyle = '#efe9da'; ctx.fillRect(-90, -24, 180, 48);
    ctx.fillStyle = '#a8362b'; ctx.font = `bold 22px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(variant % 2 ? 'CASH ONLY' : 'SORRY NO REFILLS', 0, 2);
    ctx.restore();
    panelWear(p, variant % 2 === 1);
  });
}

/** Fare-machine touch screen (generic UI, cracked corner, dead columns). */
export function fareScreenTexture(): THREE.CanvasTexture {
  return faceTexture(512, 384, 4301, p => {
    const ctx = p.ctx;
    ctx.fillStyle = '#0e2433'; ctx.fillRect(0, 0, 512, 384);
    ctx.fillStyle = '#17405a'; ctx.fillRect(0, 0, 512, 56);
    ctx.fillStyle = '#d9a520'; ctx.fillRect(0, 56, 512, 4);
    ctx.fillStyle = '#e8f2f6'; ctx.font = `bold 28px ${SANS}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText('SELECT FARE', 22, 30);
    ctx.font = `16px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText('ENGLISH · ESPAÑOL', 492, 30);
    const rows: [string, string][] = [['Single Ride', '$2.90'], ['Day Pass', '$8.00'], ['7-Day Pass', '$34.00'], ['Add Value to Card', '>']];
    rows.forEach(([a, b], i) => {
      const y = 84 + i * 62;
      ctx.fillStyle = i === 0 ? '#2a6f8f' : '#1b4a63'; ctx.fillRect(22, y, 468, 50);
      ctx.fillStyle = '#e8f2f6'; ctx.font = `bold 22px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(a, 40, y + 26);
      ctx.textAlign = 'right'; ctx.fillText(b, 472, y + 26);
    });
    ctx.fillStyle = '#7fc4d8'; ctx.font = `15px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText('CARD READER OUT OF SERVICE · USE CASH', 22, 352);
    // Dead pixel columns, a crack from the corner, smeared fingerprints.
    for (let i = 0; i < 3; i++) { const x = p.rr(30, 480); ctx.fillStyle = i ? 'rgba(10,10,10,0.8)' : 'rgba(200,240,255,0.6)'; ctx.fillRect(x, 0, p.rr(1, 3), 384); }
    for (let k = 0; k < 7; k++) {
      let x = 512, y = 384, a = Math.PI + p.rr(0.2, 1.3);
      const pts: Pt[] = [[x, y]];
      for (let s = 0; s < 6; s++) { a += p.rr(-0.4, 0.4); x += Math.cos(a) * p.rr(15, 35); y += Math.sin(a) * p.rr(15, 35); pts.push([x, y]); }
      p.shape(poly(pts, false), {c: '#d8eef6', a: 0.55}, [0, 0, 1e4], 1);
    }
    for (let i = 0; i < 14; i++) p.soft(p.rr(40, 470), p.rr(80, 340), p.rr(10, 26), {c: '#c8d8de', a: 0.12});
    panelWear(p, false);
  });
}

/** Snack/drink vending front: coils, generic products, price tags, glass glare. */
export function vendFrontTexture(): THREE.CanvasTexture {
  return faceTexture(256, 512, 4302, p => {
    const ctx = p.ctx, w = 256, h = 512;
    ctx.fillStyle = '#0d1012'; ctx.fillRect(0, 0, w, h);
    const rows = 6, cols = 5, top = 14, rh = (h - 28) / rows, cw = (w - 28) / cols;
    const colors = ['#c23b2c', '#e0b23a', '#3b7fc2', '#e8e2d0', '#5aa34a', '#8a4fb0', '#d9792a', '#2f7a78'];
    for (let r = 0; r < rows; r++) {
      const y0 = top + r * rh;
      ctx.fillStyle = '#6d7276'; ctx.fillRect(8, y0 + rh - 10, w - 16, 5);
      for (let c = 0; c < cols; c++) {
        const x = 14 + c * cw;
        ctx.fillStyle = '#c9c4b4'; ctx.fillRect(x + 6, y0 + rh - 5, cw - 14, 7);
        ctx.fillStyle = '#1f2225'; ctx.font = `bold 8px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${String.fromCharCode(65 + r)}${c + 1} 1.${25 + ((r * 7 + c * 13) % 7) * 10}`, x + cw / 2 - 1, y0 + rh - 1);
        ctx.strokeStyle = '#8a8f93'; ctx.lineWidth = 1.2;
        for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.ellipse(x + cw / 2, y0 + rh - 16 - k * 1.5, cw * 0.38, 3, 0, 0, Math.PI); ctx.stroke(); }
        if (p.rnd() < 0.22) continue; // sold-out gaps
        const col = p.pick(colors), pw = cw - 12, ph = rh - 26;
        ctx.fillStyle = col; ctx.fillRect(x + 6, y0 + 8, pw, ph);
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x + 8, y0 + 8 + ph * 0.35, pw - 4, ph * 0.22);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 6 + pw * 0.7, y0 + 8, pw * 0.3, ph);
      }
    }
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,0)'); g.addColorStop(0.47, 'rgba(255,255,255,0.12)'); g.addColorStop(0.55, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    panelWear(p, false);
  });
}

// ---- office surfaces (task office-overhaul-20261030, lane ARCH) ------------------------------------
// Neutral, tileable canvas maps of the office architecture (world/officeArch.ts tints them per tenant / finish):
//  - drywall / carpet / ceilingTile: procedural stand-ins for the Codex T4 office-wall / T1 office-carpet / T2 ceiling-tile
//    textures while those load (or when absent); authored to the same mean linear luminance (0.40 / 0.105 / 0.40) so the
//    office shaders' normalisation reads them alike;
//  - grain: the shared fine mottle / speckle of every office hard floor (vinyl, tile, stone, concrete, raised floor, roof
//    membrane), mean linear ~0.5 (the floor shader divides by it).

export type OfficeSurfaceName = 'drywall' | 'carpet' | 'ceilingTile' | 'grain';

/** Mean linear luminance each office surface map is authored to (the office shaders normalise by it). */
export const OFFICE_SURFACE_MEAN: Record<OfficeSurfaceName, number> = {drywall: 0.4, carpet: 0.105, ceilingTile: 0.4, grain: 0.5};

const officeSurfaceCache = new Map<OfficeSurfaceName, THREE.CanvasTexture>();

/** Shared office surface map (generated once; do not mutate repeat / offset). */
export function officeSurface(name: OfficeSurfaceName): THREE.CanvasTexture {
  let t = officeSurfaceCache.get(name);
  if (t) return t;
  t = name === 'drywall' ? canvasTexture(512, 512, 9301, (ctx, w, h, rnd) => {
    // Matt emulsion over plasterboard: broad mottle, a few flaked patches down to the grey board, faint runs.
    ctx.fillStyle = '#b2aca0'; ctx.fillRect(0, 0, w, h);
    stains(ctx, w, h, rnd, 30, 'rgba(150,144,132,A)', 120, 0.35);
    stains(ctx, w, h, rnd, 20, 'rgba(198,192,180,A)', 90, 0.3);
    speckle(ctx, w, h, rnd, 2600, ['#aaa498', '#bab4a8', '#a49e92'], 0.5, 1.4);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 26;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        ctx.fillStyle = '#8c8c89';
        ctx.beginPath();
        for (let k = 0; k < 11; k++) { const a = k / 11 * Math.PI * 2, rr = r * (0.6 + rnd() * 0.5); ctx.lineTo(x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr * 0.8); }
        ctx.closePath(); ctx.fill();
      }
    }
    for (let i = 0; i < 12; i++) {
      const x = rnd() * w, len = (0.2 + rnd() * 0.6) * h, y = rnd() * h;
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(110,100,84,0.18)'); g.addColorStop(1, 'rgba(110,100,84,0)');
      ctx.fillStyle = g; ctx.fillRect(x, y, 2 + rnd() * 3, len);
    }
  }) : name === 'carpet' ? canvasTexture(256, 256, 9302, (ctx, w, h, rnd) => {
    // Loop-pile commercial carpet: dense two-tone fibre speckle, faint traffic soiling.
    ctx.fillStyle = '#5a5c60'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rnd, 9000, ['#4a4c50', '#6c6e72', '#55575c', '#7a7a7a', '#45474b'], 0.4, 1.1);
    stains(ctx, w, h, rnd, 10, 'rgba(40,36,30,A)', 50, 0.25);
  }) : name === 'ceilingTile' ? canvasTexture(256, 256, 9303, (ctx, w, h, rnd) => {
    // Fissured mineral-fibre acoustic tile: pinholes and short fissures, a little water staining.
    ctx.fillStyle = '#b4aa96'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rnd, 1400, ['#8a8170', '#7a7262', '#9a917f'], 0.5, 1.3);
    stains(ctx, w, h, rnd, 6, 'rgba(150,118,70,A)', 60, 0.22);
  }) : canvasTexture(512, 512, 9304, (ctx, w, h, rnd) => {
    // Neutral mid-grey grain (hard floors tint it): soft mottle + fine speckle, no pattern.
    ctx.fillStyle = '#bcbcbc'; ctx.fillRect(0, 0, w, h);
    stains(ctx, w, h, rnd, 40, 'rgba(160,160,160,A)', 110, 0.35);
    stains(ctx, w, h, rnd, 30, 'rgba(214,214,214,A)', 90, 0.3);
    speckle(ctx, w, h, rnd, 7000, ['#a8a8a8', '#cfcfcf', '#b2b2b2', '#c6c6c6'], 0.4, 1.3);
  });
  officeSurfaceCache.set(name, t);
  return t;
}
