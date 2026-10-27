// Minimal Canvas 2D software rasterizer for node tests / texture previews (no DOM, no native deps).
// Supports what the procedural texture code uses: paths (lines, rect, arc, ellipse, curves) with
// nonzero fill and round-capped strokes, solid/linear/radial paint, globalAlpha, transforms,
// fillRect/clearRect, approximate fillText (glyph boxes), get/put/createImageData, drawImage.
// `rasterize: false` turns every draw into a no-op (fast structural tests).

type Pt = [number, number];
type M = [number, number, number, number, number, number]; // a b c d e f
type RGBA = [number, number, number, number];

const NAMED: Record<string, RGBA> = {black: [0, 0, 0, 1], white: [255, 255, 255, 1], transparent: [0, 0, 0, 0]};
function parseColor(s: string): RGBA {
  s = s.trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) { const p = m[1].split(',').map(v => parseFloat(v)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  return NAMED[s] ?? [0, 0, 0, 1];
}

class Gradient {
  stops: [number, RGBA][] = [];
  constructor(readonly kind: 'linear' | 'radial', readonly g: number[]) {}
  addColorStop(t: number, c: string): void { this.stops.push([t, parseColor(c)]); this.stops.sort((a, b) => a[0] - b[0]); }
  at(x: number, y: number): RGBA {
    let t: number;
    if (this.kind === 'linear') {
      const [x0, y0, x1, y1] = this.g, dx = x1 - x0, dy = y1 - y0;
      t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1);
    } else {
      const [, , r0, x1, y1, r1] = this.g;
      t = (Math.hypot(x - x1, y - y1) - r0) / (r1 - r0 || 1);
    }
    const s = this.stops;
    if (!s.length) return [0, 0, 0, 0];
    if (t <= s[0][0]) return s[0][1];
    if (t >= s[s.length - 1][0]) return s[s.length - 1][1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) {
      const [ta, a] = s[i - 1], [tb, b] = s[i], k = (t - ta) / (tb - ta || 1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
    return s[s.length - 1][1];
  }
}

interface ImageDataLike { data: Uint8ClampedArray; width: number; height: number }

export class ShimCanvas {
  private w = 300;
  private h = 150;
  data = new Uint8ClampedArray(this.w * this.h * 4);
  private ctx: ShimContext | null = null;
  constructor(readonly rasterize = true) {}
  get width(): number { return this.w; }
  set width(v: number) { this.w = Math.max(1, Math.floor(v)); this.data = new Uint8ClampedArray(this.w * this.h * 4); }
  get height(): number { return this.h; }
  set height(v: number) { this.h = Math.max(1, Math.floor(v)); this.data = new Uint8ClampedArray(this.w * this.h * 4); }
  getContext(): ShimContext { return (this.ctx ??= new ShimContext(this)); }
}

interface State { m: M; fillStyle: string | Gradient; strokeStyle: string | Gradient; lineWidth: number; globalAlpha: number; font: string; textAlign: string; textBaseline: string; lineCap: string; lineJoin: string }

export class ShimContext {
  private st: State = {m: [1, 0, 0, 1, 0, 0], fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter'};
  private stack: State[] = [];
  private subs: Pt[][] = [];
  private closed: boolean[] = [];
  constructor(readonly canvas: ShimCanvas) {}

  get fillStyle(): string | Gradient { return this.st.fillStyle; } set fillStyle(v: string | Gradient) { this.st.fillStyle = v; }
  get strokeStyle(): string | Gradient { return this.st.strokeStyle; } set strokeStyle(v: string | Gradient) { this.st.strokeStyle = v; }
  get lineWidth(): number { return this.st.lineWidth; } set lineWidth(v: number) { this.st.lineWidth = v; }
  get globalAlpha(): number { return this.st.globalAlpha; } set globalAlpha(v: number) { this.st.globalAlpha = v; }
  get font(): string { return this.st.font; } set font(v: string) { this.st.font = v; }
  get textAlign(): string { return this.st.textAlign; } set textAlign(v: string) { this.st.textAlign = v; }
  get textBaseline(): string { return this.st.textBaseline; } set textBaseline(v: string) { this.st.textBaseline = v; }
  get lineCap(): string { return this.st.lineCap; } set lineCap(v: string) { this.st.lineCap = v; }
  get lineJoin(): string { return this.st.lineJoin; } set lineJoin(v: string) { this.st.lineJoin = v; }

  save(): void { this.stack.push({...this.st, m: [...this.st.m] as M}); }
  restore(): void { const s = this.stack.pop(); if (s) this.st = s; }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.st.m = [a, b, c, d, e, f]; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [A, B, C, D, E, F] = this.st.m;
    this.st.m = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  }
  translate(x: number, y: number): void { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number): void { this.transform(x, 0, 0, y, 0, 0); }
  rotate(a: number): void { const c = Math.cos(a), s = Math.sin(a); this.transform(c, s, -s, c, 0, 0); }
  private tp(x: number, y: number): Pt { const [a, b, c, d, e, f] = this.st.m; return [a * x + c * y + e, b * x + d * y + f]; }
  private inv(): M { const [a, b, c, d, e, f] = this.st.m, det = a * d - b * c || 1; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; }
  private scaleFactor(): number { const [a, b, c, d] = this.st.m; return Math.sqrt(Math.abs(a * d - b * c)); }

  // ---- path
  beginPath(): void { this.subs = []; this.closed = []; }
  moveTo(x: number, y: number): void { this.subs.push([this.tp(x, y)]); this.closed.push(false); }
  lineTo(x: number, y: number): void { if (!this.subs.length) this.moveTo(x, y); else this.subs[this.subs.length - 1].push(this.tp(x, y)); }
  closePath(): void { if (this.closed.length) this.closed[this.closed.length - 1] = true; }
  rect(x: number, y: number, w: number, h: number): void { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false): void {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = sweep % (2 * Math.PI) + 2 * Math.PI;
    if (ccw && sweep > 0) sweep = sweep % (2 * Math.PI) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const n = Math.max(8, Math.min(96, Math.ceil(Math.abs(sweep) * Math.max(rx, ry) * this.scaleFactor() / 3)));
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = a0 + sweep * i / n, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      const px = x + ex * cr - ey * sr, py = y + ex * sr + ey * cr;
      if (i === 0 && this.subs.length && this.subs[this.subs.length - 1].length) this.lineTo(px, py);
      else if (i === 0) this.moveTo(px, py); else this.lineTo(px, py);
    }
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void { this.ellipse(x, y, r, r, 0, a0, a1, ccw); }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const sub = this.subs[this.subs.length - 1]; if (!sub) { this.moveTo(x, y); return; }
    const inv = this.inv(), [px, py] = sub[sub.length - 1];
    const x0 = inv[0] * px + inv[2] * py + inv[4], y0 = inv[1] * px + inv[3] * py + inv[5];
    for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; this.lineTo(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y); }
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { this.bezierCurveTo(cx, cy, cx, cy, x, y); }

  // ---- paint
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient { return new Gradient('linear', [x0, y0, x1, y1]); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient { return new Gradient('radial', [x0, y0, r0, x1, y1, r1]); }
  createPattern(): null { return null; }
  fill(): void { this.paint(this.subs.filter(s => s.length > 2), this.st.fillStyle); }
  stroke(): void {
    const w = this.st.lineWidth * this.scaleFactor() / 2, polys: Pt[][] = [];
    const round = this.st.lineCap === 'round' || this.st.lineJoin === 'round';
    this.subs.forEach((s, k) => {
      const pts = this.closed[k] ? [...s, s[0]] : s;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1e-9, nx = -dy / l * w, ny = dx / l * w;
        polys.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
      }
      if (round) for (const [x, y] of pts) { const c: Pt[] = []; for (let i = 0; i < 10; i++) c.push([x + Math.cos(i / 10 * 6.283) * w, y + Math.sin(i / 10 * 6.283) * w]); polys.push(c); }
    });
    this.paint(polys.map(ccw), this.st.strokeStyle);
  }
  fillRect(x: number, y: number, w: number, h: number): void { const keep = [this.subs, this.closed] as const; this.beginPath(); this.rect(x, y, w, h); this.fill(); [this.subs, this.closed] = keep as unknown as [Pt[][], boolean[]]; }
  strokeRect(x: number, y: number, w: number, h: number): void { const keep = [this.subs, this.closed] as const; this.beginPath(); this.rect(x, y, w, h); this.stroke(); [this.subs, this.closed] = keep as unknown as [Pt[][], boolean[]]; }
  clearRect(x: number, y: number, w: number, h: number): void {
    const c = this.canvas, [x0, y0] = this.tp(x, y), [x1, y1] = this.tp(x + w, y + h);
    for (let py = Math.max(0, Math.round(Math.min(y0, y1))); py < Math.min(c.height, Math.round(Math.max(y0, y1))); py++)
      for (let px = Math.max(0, Math.round(Math.min(x0, x1))); px < Math.min(c.width, Math.round(Math.max(x0, x1))); px++) c.data.fill(0, (py * c.width + px) * 4, (py * c.width + px) * 4 + 4);
  }
  measureText(t: string): {width: number} { return {width: t.length * this.fontPx() * 0.55}; }
  private fontPx(): number { return parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.st.font)?.[1] ?? '10'); }
  fillText(t: string, x: number, y: number): void {
    const px = this.fontPx(), cw = px * 0.55, total = t.length * cw;
    let x0 = x;
    if (this.st.textAlign === 'center') x0 -= total / 2; else if (this.st.textAlign === 'right' || this.st.textAlign === 'end') x0 -= total;
    const base = this.st.textBaseline === 'middle' ? y + px * 0.35 : this.st.textBaseline === 'top' ? y + px * 0.8 : y;
    const keep = [this.subs, this.closed] as const;
    this.beginPath();
    for (let i = 0; i < t.length; i++) if (t[i] !== ' ') this.rect(x0 + i * cw + cw * 0.1, base - px * 0.7, cw * 0.75, px * 0.7);
    this.fill();
    [this.subs, this.closed] = keep as unknown as [Pt[][], boolean[]];
  }

  // ---- pixels
  createImageData(w: number, h: number): ImageDataLike { return {data: new Uint8ClampedArray(w * h * 4), width: w, height: h}; }
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike {
    const c = this.canvas, out = this.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const sx = x + i, sy = y + j;
      if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) continue;
      const s = (sy * c.width + sx) * 4, d = (j * w + i) * 4;
      out.data[d] = c.data[s]; out.data[d + 1] = c.data[s + 1]; out.data[d + 2] = c.data[s + 2]; out.data[d + 3] = c.data[s + 3];
    }
    return out;
  }
  putImageData(img: ImageDataLike, dx: number, dy: number): void {
    const c = this.canvas;
    for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
      const x = dx + i, y = dy + j;
      if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
      const s = (j * img.width + i) * 4, d = (y * c.width + x) * 4;
      c.data[d] = img.data[s]; c.data[d + 1] = img.data[s + 1]; c.data[d + 2] = img.data[s + 2]; c.data[d + 3] = img.data[s + 3];
    }
  }
  drawImage(src: unknown, ...a: number[]): void {
    if (!(src instanceof ShimCanvas) || !this.canvas.rasterize) return;
    let [sx, sy, sw, sh, dx, dy, dw, dh] = [0, 0, src.width, src.height, 0, 0, src.width, src.height];
    if (a.length === 2) [dx, dy] = a; else if (a.length === 4) [dx, dy, dw, dh] = a; else if (a.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    const c = this.canvas, [ox, oy] = this.tp(dx, dy), [ex, ey] = this.tp(dx + dw, dy + dh);
    for (let y = Math.max(0, Math.round(oy)); y < Math.min(c.height, Math.round(ey)); y++) for (let x = Math.max(0, Math.round(ox)); x < Math.min(c.width, Math.round(ex)); x++) {
      const u = Math.min(src.width - 1, Math.floor(sx + (x + 0.5 - ox) / (ex - ox) * sw)), v = Math.min(src.height - 1, Math.floor(sy + (y + 0.5 - oy) / (ey - oy) * sh));
      const s = (v * src.width + u) * 4;
      this.blend(x, y, [src.data[s], src.data[s + 1], src.data[s + 2], src.data[s + 3] / 255], 1);
    }
  }

  private blend(x: number, y: number, c: RGBA, cov: number): void {
    const d = this.canvas.data, i = (y * this.canvas.width + x) * 4;
    const sa = c[3] * cov * this.st.globalAlpha;
    if (sa <= 0) return;
    const da = d[i + 3] / 255, oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) d[i + k] = (c[k] * sa + d[i + k] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }

  /** Nonzero scanline fill with 4 sub-scanlines and exact horizontal span coverage. */
  private paint(polys: Pt[][], style: string | Gradient): void {
    if (!this.canvas.rasterize || !polys.length) return;
    const c = this.canvas, SS = 4;
    const edges: {x0: number; y0: number; x1: number; y1: number; dir: number}[] = [];
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const p of polys) for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]); minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
      if (a[1] === b[1]) continue;
      edges.push(a[1] < b[1] ? {x0: a[0], y0: a[1], x1: b[0], y1: b[1], dir: 1} : {x0: b[0], y0: b[1], x1: a[0], y1: a[1], dir: -1});
    }
    const ys = Math.max(0, Math.floor(minY)), ye = Math.min(c.height - 1, Math.ceil(maxY)), xs = Math.max(0, Math.floor(minX)), xe = Math.min(c.width - 1, Math.ceil(maxX));
    if (ys > ye || xs > xe) return;
    edges.sort((a, b) => a.y0 - b.y0);
    const solid = typeof style === 'string' ? parseColor(style) : null;
    const inv = solid ? null : this.inv();
    const cov = new Float32Array(xe - xs + 2);
    let next = 0;
    let active: typeof edges = [];
    const xing: [number, number][] = [];
    for (let y = ys; y <= ye; y++) {
      cov.fill(0);
      let any = false;
      for (let s = 0; s < SS; s++) {
        const sy = y + (s + 0.5) / SS;
        while (next < edges.length && edges[next].y0 <= sy) active.push(edges[next++]);
        active = active.filter(e => e.y1 > sy);
        xing.length = 0;
        for (const e of active) if (e.y0 <= sy) xing.push([e.x0 + (sy - e.y0) / (e.y1 - e.y0) * (e.x1 - e.x0), e.dir]);
        if (xing.length < 2) continue;
        xing.sort((a, b) => a[0] - b[0]);
        let wind = 0;
        for (let k = 0; k < xing.length - 1; k++) {
          wind += xing[k][1];
          if (!wind) continue;
          const xa = Math.max(xs, xing[k][0]), xb = Math.min(xe + 1, xing[k + 1][0]);
          if (xb <= xa) continue;
          any = true;
          for (let px = Math.floor(xa); px < Math.ceil(xb); px++) cov[px - xs] += (Math.min(px + 1, xb) - Math.max(px, xa)) / SS;
        }
      }
      if (!any) continue;
      for (let x = xs; x <= xe; x++) {
        const k = Math.min(1, cov[x - xs]);
        if (k <= 0) continue;
        let col = solid;
        if (!col) { const ux = inv![0] * (x + 0.5) + inv![2] * (y + 0.5) + inv![4], uy = inv![1] * (x + 0.5) + inv![3] * (y + 0.5) + inv![5]; col = (style as Gradient).at(ux, uy); }
        this.blend(x, y, col, k);
      }
    }
  }
}

function ccw(p: Pt[]): Pt[] {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return a < 0 ? [...p].reverse() : p;
}

/** Installs a `document.createElement('canvas')` stub backed by ShimCanvas; returns an uninstall fn. */
export function installCanvasShim(rasterize: boolean): () => void {
  const g = globalThis as unknown as {document?: unknown};
  const prev = g.document;
  g.document = {createElement: (tag: string) => { if (tag !== 'canvas') throw new Error(`shim: <${tag}>`); return new ShimCanvas(rasterize); }};
  return () => { g.document = prev; };
}
