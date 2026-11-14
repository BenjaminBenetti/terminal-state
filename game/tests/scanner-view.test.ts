// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "opens a black/green 360-degree radar around the train,
// approximately 100m range … No floorplan/map or continuous live tracking") and task studio-scanner-console-refinements-20261114-031614-01
// (user: "Every mode shows ONLY GREEN dots, including weapons/equipment; no red/gold categories. Provide a clear mode label and
// straightforward cycling control in the existing scanner UI"): the scanner's SCOPE (ui/scannerView.ts) —
//  - drawScanner on a RECORDING context: black glass, the four range rings, the FRONT tick, the train's glyph, the sweep hand (one turn a
//    period, up at the sweep) with its trail, the header (title, range, "MODE: …", "[X] NEXT MODE"), the mode strip (the cycle's order,
//    the selected one lit and underlined), the countdown, one GREEN DOT per blip of the selected mode at the right place (ahead of the car
//    = up), dimming to 40 %; nothing else — no polyline, no outline, no text per dot: no map;
//  - the same drawing RASTERISED (the canvas shim): the dots are green, the whole canvas is black and green — no red, no gold anywhere;
//  - the DOM holder: one bounded canvas, redrawn only when what it shows changed (a mode change too); the stylesheet block.
// Node only.

import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SCANNER, SCAN_MODES, blipBrightness, sweepAngle, type ScanBlip, type ScanMode} from '../src/craft/scanner';
import {
  MODE_KEY_LABEL, SCAN_DOT, SCOPE_COLORS, SCOPE_TEXT, ScannerScope, blipPoint, drawScanner, markSize, redrawStep, scopeGeometry, scopeSize, type ScannerModel, type ScopeEnv,
} from '../src/ui/scannerView';
import * as viewModule from '../src/ui/scannerView';
import {CONTROLS} from '../src/ui/hud';
import {ShimCanvas} from './helpers/canvas2d';

const TAU = Math.PI * 2;

type Seg = {k: 'M' | 'L'; x: number; y: number} | {k: 'A'; x: number; y: number; r: number; a0: number; a1: number} | {k: 'Z'};
type Op =
  | {op: 'fill'; path: Seg[]; color: string; alpha: number}
  | {op: 'stroke'; path: Seg[]; color: string; width: number; alpha: number}
  | {op: 'fillRect'; x: number; y: number; w: number; h: number; color: string; alpha: number}
  | {op: 'text'; text: string; x: number; y: number; color: string; font: string; align: string; alpha: number};

/** A 2D context that records what is drawn (only the calls a scope may make exist: anything else throws). */
class Rec {
  readonly ops: Op[] = [];
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  globalAlpha = 1;
  lineWidth = 1;
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  depth = 0;
  transforms: number[][] = [];
  private path: Seg[] = [];
  private saved: {fillStyle: unknown; strokeStyle: unknown; globalAlpha: number; lineWidth: number; font: string; textAlign: string; textBaseline: string}[] = [];
  private col(v: unknown): string { return typeof v === 'string' ? v : 'gradient'; }
  save(): void { this.depth++; this.saved.push({fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha, lineWidth: this.lineWidth, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline}); }
  restore(): void { this.depth--; Object.assign(this, this.saved.pop()); }
  setTransform(...m: number[]): void { this.transforms.push(m); }
  beginPath(): void { this.path = []; }
  moveTo(x: number, y: number): void { this.path.push({k: 'M', x, y}); }
  lineTo(x: number, y: number): void { this.path.push({k: 'L', x, y}); }
  closePath(): void { this.path.push({k: 'Z'}); }
  arc(x: number, y: number, r: number, a0: number, a1: number): void { this.path.push({k: 'A', x, y, r, a0, a1}); }
  fill(): void { this.ops.push({op: 'fill', path: this.path.slice(), color: this.col(this.fillStyle), alpha: this.globalAlpha}); }
  stroke(): void { this.ops.push({op: 'stroke', path: this.path.slice(), color: this.col(this.strokeStyle), width: this.lineWidth, alpha: this.globalAlpha}); }
  fillRect(x: number, y: number, w: number, h: number): void { this.ops.push({op: 'fillRect', x, y, w, h, color: this.col(this.fillStyle), alpha: this.globalAlpha}); }
  fillText(text: string, x: number, y: number): void { this.ops.push({op: 'text', text, x, y, color: this.col(this.fillStyle), font: this.font, align: this.textAlign, alpha: this.globalAlpha}); }
  measureText(t: string): {width: number} { return {width: t.length * parseFloat(/(\d+)px/.exec(this.font)?.[1] ?? '10') * 0.6}; }
  createRadialGradient(): {addColorStop(t: number, c: string): void} { return {addColorStop() {}}; }
}

const W = 720, H = 720, G = scopeGeometry(W, H);
const model = (o: Partial<ScannerModel> = {}): ScannerModel => ({active: true, mode: 'all', blips: null, serial: 1, left: 20, ...o});
function draw(m: ScannerModel, w = W, h = H): Rec {
  const r = new Rec();
  drawScanner(r as unknown as CanvasRenderingContext2D, m, w, h);
  return r;
}
const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const isGreen = (c: string) => { const [r, g, b] = rgb(c); return g > 150 && r < g * 0.75 && b < g * 0.75; };
/** Green-dominant at any brightness (the scope's dim furniture). */
const greenish = (c: string) => { const [r, g, b] = rgb(c); return g > r * 1.3 && g > b * 1.3; };
const MODE_NAMES = ['ALL', 'FOOD/WATER', 'AMMO', 'FUEL', 'WEAPON', 'EQUIPMENT', 'MATERIAL'];

/** The marks in a recording: discs (one full arc filled, small), squares (fillRect, small, square), diamonds (4-point closed path filled). */
function marks(r: Rec): {shape: 'disc' | 'square' | 'diamond'; x: number; y: number; half: number; color: string; alpha: number}[] {
  const out: ReturnType<typeof marks> = [];
  for (const o of r.ops) {
    if (o.op === 'fillRect' && o.w < 40 && o.w > 0 && Math.abs(o.w - o.h) < 1e-9) out.push({shape: 'square', x: o.x + o.w / 2, y: o.y + o.h / 2, half: o.w / 2, color: o.color, alpha: o.alpha});
    if (o.op !== 'fill') continue;
    const p = o.path;
    if (p.length === 1 && p[0].k === 'A' && p[0].r < 40) out.push({shape: 'disc', x: p[0].x, y: p[0].y, half: p[0].r, color: o.color, alpha: o.alpha});
    if (p.length === 5 && p[0].k === 'M' && p[1].k === 'L' && p[2].k === 'L' && p[3].k === 'L' && p[4].k === 'Z') {
      out.push({shape: 'diamond', x: p[0].x, y: (p[0].y + p[2].y) / 2, half: (p[2].y - p[0].y) / 2, color: o.color, alpha: o.alpha});
    }
  }
  return out;
}
/** Marks on the scope itself. */
const blipsIn = (r: Rec) => marks(r).filter(m => Math.hypot(m.x - G.cx, m.y - G.cy) <= G.r * 1.01 && SCOPE_COLORS.train !== m.color);
const texts = (r: Rec) => r.ops.filter((o): o is Extract<Op, {op: 'text'}> => o.op === 'text');
const strokes = (r: Rec) => r.ops.filter((o): o is Extract<Op, {op: 'stroke'}> => o.op === 'stroke');

describe('the scope: black glass, green rings, the mode label and strip, the copy', () => {
  const r = draw(model({left: 11.2}));

  it('starts by blacking out the whole canvas and leaves the context as it found it', () => {
    const first = r.ops[0];
    expect(first).toMatchObject({op: 'fillRect', x: 0, y: 0, w: W, h: H, alpha: 1});
    expect(rgb((first as {color: string}).color)).toEqual([0, 0, 0]);
    expect(r.depth).toBe(0);
    expect([r.globalAlpha, r.fillStyle]).toEqual([1, '#000']);
  });

  it('four range rings at 25 / 50 / 75 / 100 m around the centre, green, the outer one the range', () => {
    const rings = strokes(r).filter(s => s.path.length === 1 && s.path[0].k === 'A').map(s => ({...(s.path[0] as Extract<Seg, {k: 'A'}>), color: s.color, width: s.width}));
    expect(rings.map(c => +(c.r / G.r).toFixed(6))).toEqual([0.25, 0.5, 0.75, 1]);
    expect(SCANNER.rings.map(m => m / SCANNER.range)).toEqual([0.25, 0.5, 0.75, 1]);
    for (const c of rings) {
      expect([c.x, c.y]).toEqual([G.cx, G.cy]);
      expect(Math.abs(c.a1 - c.a0)).toBeCloseTo(TAU); // a full circle: 360 degrees
      expect(greenish(c.color)).toBe(true);
    }
    expect(rings[3].width).toBeGreaterThan(rings[0].width);
    expect(isGreen(rings[3].color)).toBe(true); // the range ring is the bright one
    for (const s of strokes(r)) expect(greenish(s.color)).toBe(true); // every line on the scope is green
    // the scope fits the canvas with room for the header and the footer
    expect(G.cy - G.r * 1.08).toBeGreaterThan(H * 0.06);
    expect(G.cy + G.r * 1.08).toBeLessThan(H * 0.9);
    expect(G.cx + G.r * 1.08).toBeLessThan(W);
  });

  it('the copy: the title, the range, MODE: ALL and [X] NEXT MODE, the ring distances, FRONT at the top, the mode strip, the countdown — all green, no legend of classes', () => {
    const t = texts(r), by = new Map(t.map(o => [o.text, o]));
    expect(t.map(o => o.text).sort()).toEqual(['100', '25', '50', '75', '[X] NEXT MODE', ...MODE_NAMES, 'FIRST SWEEP PENDING', 'FRONT', 'ITEM SCANNER', 'MODE: ALL', 'NEXT SWEEP IN 12 s', 'RANGE 100 m'].sort());
    expect(SCOPE_TEXT.range).toBe(`RANGE ${SCANNER.range} m`);
    expect(MODE_KEY_LABEL).toBe('X');
    expect(SCOPE_TEXT.cycle).toBe('[X] NEXT MODE');
    // the game's Controls list (pause menu + the main menu's Controls view) names the same key
    expect(CONTROLS.filter(([a, k]) => /scanner/i.test(a) && /mode/i.test(a) && k === MODE_KEY_LABEL)).toHaveLength(1);
    for (const gone of ['ENEMY', 'ITEM', 'WEAPON / GEAR']) expect(by.has(gone)).toBe(false);
    // every word is phosphor green; the fonts are monospace and readable
    for (const o of t) {
      expect([o.text, isGreen(o.color)]).toEqual([o.text, true]);
      expect(o.font).toMatch(/monospace/);
      expect(parseFloat(/(\d+)px/.exec(o.font)![1])).toBeGreaterThanOrEqual(12);
    }
    // FRONT sits above the outer ring: up on the scope is the car's front
    expect(by.get('FRONT')!.y).toBeLessThan(G.cy - G.r);
    // the header: the mode label under the title (left), the key's hint under the range (right), both above the scope, inside the canvas
    const title = by.get('ITEM SCANNER')!, label = by.get('MODE: ALL')!, hint = by.get('[X] NEXT MODE')!, range = by.get('RANGE 100 m')!;
    expect(label.x).toBe(title.x);
    expect(label.y).toBeGreaterThan(title.y);
    expect([hint.x, hint.align, hint.y]).toEqual([range.x, 'right', label.y]);
    expect(label.y).toBeLessThan(G.cy - G.r);
    const lpx = parseFloat(/(\d+)px/.exec(label.font)![1]);
    expect(label.x + 'MODE: EQUIPMENT'.length * lpx * 0.6).toBeLessThan(G.cx - Math.sqrt((G.r * 1.06) ** 2 - (G.cy - label.y) ** 2)); // clear of the glass
    expect(label.color).toBe(SCOPE_COLORS.text); // the bright green
  });

  it('the mode strip: every mode in the cycle\'s order on one row under the scope, the selected one lit and underlined', () => {
    for (const mode of SCAN_MODES) {
      const d = draw(model({mode})), t = texts(d), name = MODE_NAMES[SCAN_MODES.indexOf(mode)];
      const row = MODE_NAMES.map(k => t.find(o => o.text === k)!);
      expect(new Set(row.map(o => o.y)).size).toBe(1);
      expect(row[0].y).toBeGreaterThan(G.cy + G.r * 1.08);
      expect(row.map(o => o.x)).toEqual([...row.map(o => o.x)].sort((a, b) => a - b)); // left to right in the cycle's order
      expect(row[0].x).toBeGreaterThan(10);
      const px = parseFloat(/(\d+)px/.exec(row[6].font)![1]);
      expect(row[6].x + 'MATERIAL'.length * px * 0.6).toBeLessThan(W - 10);
      for (const o of row) expect([o.text, o.color]).toEqual([o.text, o.text === name ? SCOPE_COLORS.text : SCOPE_COLORS.label]);
      // one underline, under the selected name
      const under = d.ops.filter((o): o is Extract<Op, {op: 'fillRect'}> => o.op === 'fillRect' && o.y > row[0].y && o.y < row[0].y + px && o.w > o.h * 3);
      expect(under).toHaveLength(1);
      const sel = row.find(o => o.text === name)!;
      expect(under[0].x).toBeCloseTo(sel.x);
      expect(under[0].w).toBeCloseTo(name.length * px * 0.6, 1);
      expect(t.find(o => o.text.startsWith('MODE: '))!.text).toBe(`MODE: ${name}`);
    }
  });

  it('the train is a small bar in the centre with its nose up; the FRONT tick is a small triangle on top of the outer ring', () => {
    const bar = r.ops.find((o): o is Extract<Op, {op: 'fillRect'}> => o.op === 'fillRect' && o.color === SCOPE_COLORS.train)!;
    expect(bar.x + bar.w / 2).toBeCloseTo(G.cx);
    expect(bar.y + bar.h / 2).toBeCloseTo(G.cy);
    expect(bar.h).toBeGreaterThan(bar.w * 2); // longer along the car's axis (up - down)
    expect(bar.h).toBeLessThan(G.r * 0.12); // a glyph, not a plan of the car
    const tris = r.ops.filter((o): o is Extract<Op, {op: 'fill'}> => o.op === 'fill' && o.path.length === 4 && o.path[3].k === 'Z' && o.path[0].k === 'M');
    const nose = tris.find(o => o.color === SCOPE_COLORS.train)!, tick = tris.find(o => o.color !== SCOPE_COLORS.train)!;
    const apex = (o: typeof nose) => o.path[0] as {x: number; y: number};
    expect(apex(nose).x).toBeCloseTo(G.cx);
    expect(apex(nose).y).toBeLessThan(bar.y); // the nose is at the bar's TOP end
    expect(apex(tick).x).toBeCloseTo(G.cx);
    expect(apex(tick).y).toBeLessThan(G.cy - G.r);
    expect(isGreen(tick.color)).toBe(true);
  });

  it('the sweep hand turns clockwise once a period and points UP at the sweep; a fading trail follows it', () => {
    const hand = (left: number) => {
      const s = strokes(draw(model({left}))).find(o => o.color === SCOPE_COLORS.hand)!;
      expect(s.path).toHaveLength(2);
      const [a, b] = s.path as Extract<Seg, {k: 'M' | 'L'}>[];
      expect([a.x, a.y]).toEqual([G.cx, G.cy]);
      return [+((b.x - G.cx) / G.r).toFixed(6) + 0, +((b.y - G.cy) / G.r).toFixed(6) + 0];
    };
    expect(hand(SCANNER.period)).toEqual([0, -1]); // just swept: straight up
    expect(hand(SCANNER.period * 0.75)).toEqual([1, 0]); // a quarter of the period later: to the right (clockwise)
    expect(hand(SCANNER.period * 0.5)).toEqual([0, 1]);
    expect(hand(SCANNER.period * 0.25)).toEqual([-1, 0]);
    const up = hand(0.0001);
    expect(up[1]).toBeCloseTo(-1, 3); // the next sweep is when it comes up again
    // the trail: wedges from the centre to the outer ring BEHIND the hand, each fainter than the one before
    const rec = draw(model({left: SCANNER.period * 0.75}));
    const wedges = rec.ops.filter((o): o is Extract<Op, {op: 'fill'}> => o.op === 'fill' && o.path.length === 3 && o.path[1].k === 'A' && o.path[2].k === 'Z');
    expect(wedges).toHaveLength(SCANNER.trailSteps);
    const handAngle = sweepAngle(SCANNER.period * 0.75) - Math.PI / 2;
    let last = Infinity;
    wedges.forEach((wd, i) => {
      const arc = wd.path[1] as Extract<Seg, {k: 'A'}>;
      expect(arc.r).toBeCloseTo(G.r);
      expect(arc.a1).toBeCloseTo(handAngle - i * SCANNER.trail / SCANNER.trailSteps);
      expect(arc.a0).toBeLessThan(arc.a1);
      const alpha = Number(/rgba\(.*,\s*([\d.]+)\)$/.exec(wd.color)![1]);
      expect(alpha).toBeLessThan(last);
      expect(alpha).toBeLessThanOrEqual(0.2);
      last = alpha;
    });
    expect(SCANNER.trail).toBeLessThan(Math.PI / 2);
  });
});

describe('the dots: one GREEN dot per blip of the selected mode, where the things were', () => {
  const blips: ScanBlip[] = [{x: 50, z: 0, n: 1}, {x: 0, z: -40, n: 1}, {x: -30, z: 30, n: 1}];
  const r = draw(model({blips, left: SCANNER.period}));
  const cell = SCANNER.cell * G.r / SCANNER.range;

  it('every mode draws the same mark: a green disc, one colour — no red, no gold, no other shape', () => {
    expect(isGreen(SCAN_DOT)).toBe(true);
    const exported = Object.keys(viewModule);
    expect(exported).not.toContain('SCAN_COLORS');
    for (const mode of SCAN_MODES) {
      const b = blipsIn(draw(model({mode, blips, left: SCANNER.period})));
      expect(b.map(m => [m.shape, m.color])).toEqual(blips.map(() => ['disc', SCAN_DOT]));
    }
  });

  it('ahead of the car is UP, its right is RIGHT, to scale with the rings (within the cell)', () => {
    const b = blipsIn(r);
    const near = (m: {x: number; y: number}, x: number, y: number) => { expect(Math.abs(m.x - x)).toBeLessThanOrEqual(cell * 0.25); expect(Math.abs(m.y - y)).toBeLessThanOrEqual(cell * 0.25); };
    near(b[0], G.cx, G.cy - G.r * 0.5); // 50 m ahead: straight up, on the 50 m ring
    near(b[1], G.cx - G.r * 0.4, G.cy); // 40 m to the car's left
    near(b[2], G.cx + G.r * 0.3, G.cy + G.r * 0.3); // behind and to the right
    // the helper the draw uses says the same: exactly the cell centre's point
    blips.forEach((q, i) => { const p = blipPoint(G, q); expect([b[i].x, b[i].y]).toEqual([p.x, p.y]); });
    const p0 = blipPoint(G, {x: 100, z: 0});
    expect([p0.x, p0.y]).toEqual([G.cx, G.cy - G.r]);
    // a cell centre just past the range is drawn ON the outer ring; no dot's centre is ever outside it
    const edge = blipPoint(G, {x: 102, z: 102});
    expect(Math.hypot(edge.x - G.cx, edge.y - G.cy)).toBeCloseTo(G.r);
    for (let a = 0; a < TAU; a += 0.05) {
      const q = blipPoint(G, {x: Math.cos(a) * 101.5, z: Math.sin(a) * 101.5});
      expect(Math.hypot(q.x - G.cx, q.y - G.cy)).toBeLessThanOrEqual(G.r + 1e-9);
    }
  });

  it('a count makes a dot only a little larger', () => {
    const sized = blipsIn(draw(model({blips: [{x: 20, z: 0, n: 1}, {x: 40, z: 0, n: 3}, {x: 60, z: 0, n: 200}], left: 30})));
    expect(sized.map(m => +(m.half / markSize(G.s, 1)).toFixed(3))).toEqual([1, 1.2, 1.5]);
    expect(sized[2].half * 2).toBeLessThan(cell); // the largest dot is still smaller than a cell
    expect(markSize(G.s, 1)).toBeGreaterThanOrEqual(3); // and the smallest is visible
  });

  it('brightest right after a sweep, dimming slowly to 40 % — never gone before the next sweep; the rest of the scope does not dim', () => {
    const alphaAt = (left: number) => { const d = draw(model({blips, left})); const a = new Set(blipsIn(d).map(m => m.alpha)); expect(a.size).toBe(1); return {a: [...a][0], d}; };
    expect(alphaAt(SCANNER.period).a).toBe(1);
    expect(alphaAt(SCANNER.period / 2).a).toBeCloseTo(0.7);
    expect(alphaAt(0.05).a).toBeCloseTo(SCANNER.dim, 2);
    let prev = 1.01;
    for (let left = SCANNER.period; left > 0; left -= 1.5) {
      const {a, d} = alphaAt(left);
      expect(a).toBeLessThan(prev);
      expect(a).toBeGreaterThanOrEqual(SCANNER.dim);
      expect(a).toBe(blipBrightness(left));
      expect(blipsIn(d)).toHaveLength(3); // all still there
      for (const o of d.ops) if (o.op === 'text' || o.op === 'stroke') expect(o.alpha).toBe(1);
      prev = a;
    }
  });

  it('a mode with nothing in the snapshot says so; before the first sweep it says that instead', () => {
    for (const mode of SCAN_MODES) {
      const t = texts(draw(model({mode, blips: []}))).map(o => o.text);
      expect(t).toContain(mode === 'all' ? 'NO RESOURCES IN RANGE' : `NO ${MODE_NAMES[SCAN_MODES.indexOf(mode)]} IN RANGE`);
      expect(t).not.toContain('FIRST SWEEP PENDING');
    }
    expect(texts(draw(model({mode: 'fuel', blips: null}))).map(o => o.text)).toContain('FIRST SWEEP PENDING');
    expect(texts(draw(model({mode: 'fuel', blips: [{x: 1, z: 1, n: 1}]}))).map(o => o.text).some(t => /IN RANGE$/.test(t))).toBe(false);
  });
});

describe('no floor plan, no map, nothing per dot but its mark', () => {
  const count = (r: Rec) => { const c: Record<string, number> = {}; for (const o of r.ops) c[o.op] = (c[o.op] ?? 0) + 1; return c; };
  /** A full scope: a mode at the cap. */
  function crowded(): ScanBlip[] {
    const cells: ScanBlip[] = [];
    for (let x = -98; x < 100 && cells.length < SCANNER.maxBlips; x += 4) for (let z = -98; z < 100 && cells.length < SCANNER.maxBlips; z += 4) if (Math.hypot(x, z) <= 100) cells.push({x, z, n: 1 + (cells.length % 7)});
    return cells;
  }

  it('the dots add exactly one mark per blip and NOTHING else: no line, no outline, no text', () => {
    const mode: ScanMode = 'weapon';
    const one = draw(model({mode, blips: [{x: 4, z: 4, n: 1}], left: 17})), full = draw(model({mode, blips: crowded(), left: 17}));
    const n = SCANNER.maxBlips;
    expect(blipsIn(full).length).toBe(n);
    const a = count(one), b = count(full);
    expect(b.stroke).toBe(a.stroke); // not one more line
    expect(b.text).toBe(a.text); // not one more word
    expect(b.fillRect).toBe(a.fillRect);
    expect(b.fill - a.fill).toBe(n - 1); // the dots
    expect(strokes(full)).toEqual(strokes(one));
    expect(texts(full)).toEqual(texts(one));
    expect(new Set(blipsIn(full).map(m => m.color))).toEqual(new Set([SCAN_DOT]));
  });

  it('the furniture is a fixed handful of strokes: rings, a reticle, bearing ticks and the hand — it does not grow with the world', () => {
    const r = draw(model({blips: crowded()}));
    const s = strokes(r);
    expect(s).toHaveLength(SCANNER.rings.length + 3); // + the reticle, the ticks, the hand
    // every straight segment is a spoke through / on the centre or a short tick at the rim: nothing that could be a wall or a route
    for (const st of s) {
      const pts = st.path.filter((p): p is Extract<Seg, {k: 'M' | 'L'}> => p.k === 'M' || p.k === 'L');
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const [p, q] = [pts[i], pts[i + 1]];
        const cross = Math.abs((p.x - G.cx) * (q.y - G.cy) - (p.y - G.cy) * (q.x - G.cx));
        expect(cross).toBeLessThan(1e-6 * G.r * G.r); // radial: collinear with the centre
      }
      expect(pts.length % 2).toBe(0);
    }
    const lines = r.ops.reduce((k, o) => k + ((o.op === 'fill' || o.op === 'stroke') ? o.path.filter(p => p.k === 'L').length : 0), 0);
    expect(lines).toBeLessThan(60);
  });

  it('the model holds no geometry to draw: extra data on it changes nothing', () => {
    const blips = [{x: 10, z: 10, n: 2}];
    const plain = draw(model({blips}));
    const loaded = draw({...model({blips}), walls: [[0, 0, 50, 50]], rooms: ['Concourse'], route: [[0, 0], [10, 10]], names: ['zombie-1'], enemies: [{x: 20, z: 20, n: 1}]} as unknown as ScannerModel);
    expect(loaded.ops).toEqual(plain.ops);
    expect(texts(plain).some(t => /\d+\s*m\b/.test(t.text) && t.text !== SCOPE_TEXT.range)).toBe(false); // no distance read-out per dot
  });

  it('no signal: an unplugged scanner shows no dots, no hand and no countdown — only the furniture, the mode and NO SIGNAL — PLUG IN', () => {
    const r = draw(model({active: false, mode: 'ammo', blips: crowded(), left: 9}));
    expect(blipsIn(r)).toHaveLength(0);
    expect(strokes(r).some(s => s.color === SCOPE_COLORS.hand)).toBe(false);
    expect(r.ops.some(o => o.op === 'fill' && o.path.length === 3 && o.path[1].k === 'A')).toBe(false); // no trail
    const t = texts(r).map(o => o.text);
    expect(t).toContain('NO SIGNAL — PLUG IN');
    expect(t).toContain('SWEEP PAUSED');
    expect(t).toContain('MODE: AMMO');
    expect(t.some(x => x.startsWith('NEXT SWEEP'))).toBe(false);
    expect(strokes(r).filter(s => s.path.length === 1 && s.path[0].k === 'A')).toHaveLength(4); // the rings stay
    // before a world's first sweep an ACTIVE scope says so instead of showing an old picture
    const first = texts(draw(model({blips: null, left: 3.2}))).map(o => o.text);
    expect(first).toContain('FIRST SWEEP PENDING');
    expect(first).toContain('NEXT SWEEP IN 4 s');
    expect(texts(draw(model({blips: [], left: 3.2}))).map(o => o.text)).not.toContain('FIRST SWEEP PENDING');
  });
});

describe('the same drawing as pixels (the canvas shim)', () => {
  const size = 360, g = scopeGeometry(size, size);
  function pixels(m: ScannerModel): (x: number, y: number) => [number, number, number] {
    const c = new ShimCanvas(true);
    c.width = size; c.height = size;
    drawScanner(c.getContext() as unknown as CanvasRenderingContext2D, m, size, size);
    return (x, y) => { const i = (Math.round(y) * size + Math.round(x)) * 4; return [c.data[i], c.data[i + 1], c.data[i + 2]]; };
  }
  const blips: ScanBlip[] = [{x: 62, z: 22, n: 6}, {x: -46, z: 30, n: 6}, {x: 10, z: -70, n: 6}];

  it('the dots are green on black / dark green glass, in every mode', () => {
    for (const mode of ['all', 'weapon', 'equipment'] as const) {
      const px = pixels(model({mode, blips, left: SCANNER.period}));
      for (const b of blips) {
        const p = blipPoint(g, b), [r0, g0, b0] = px(p.x, p.y);
        expect(g0).toBeGreaterThan(160); expect(r0).toBeLessThan(g0 * 0.6); expect(b0).toBeLessThan(g0 * 0.7);
      }
      // the corners are black; the glass between the rings is nearly black with a green cast
      expect(px(2, 2)).toEqual([0, 0, 0]);
      expect(px(size - 3, 3)).toEqual([0, 0, 0]);
      const glass = px(g.cx + g.r * 0.62 * Math.SQRT1_2, g.cy + g.r * 0.62 * Math.SQRT1_2);
      expect(Math.max(...glass)).toBeLessThan(40);
      expect(glass[1]).toBeGreaterThanOrEqual(glass[0]);
      // a point ON the outer ring is green
      const ring = px(g.cx + g.r * Math.cos(2.4), g.cy + g.r * Math.sin(2.4));
      expect(ring[1]).toBeGreaterThan(ring[0] * 1.5);
      expect(ring[1]).toBeGreaterThan(60);
    }
  });

  it('black and green: with a full picture nothing on the whole canvas is red or gold', () => {
    const px = pixels(model({mode: 'weapon', blips, left: 21}));
    let lit = 0, green = 0, dark = 0, all = 0;
    for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) {
      const [r0, g0, b0] = px(x, y);
      all++;
      if (Math.max(r0, g0, b0) < 48) { dark++; continue; }
      lit++;
      if (g0 >= r0 && g0 >= b0) green++;
    }
    expect(dark / all).toBeGreaterThan(0.8); // a black screen
    expect(lit).toBeGreaterThan(100);
    expect(green).toBe(lit); // everything lit is green-dominant: the header, the strip, the dots
  });
});

describe('the canvas is bounded', () => {
  it('0.8 of the smaller viewport side, at most 720 px (at least 240); devicePixelRatio capped at 2', () => {
    expect(scopeSize(1920, 1080, 1)).toEqual({css: 720, px: 720});
    expect(scopeSize(1280, 720, 1)).toEqual({css: 576, px: 576});
    expect(scopeSize(1280, 720, 2)).toEqual({css: 576, px: 1152});
    expect(scopeSize(3840, 2160, 3)).toEqual({css: 720, px: 1440});
    expect(scopeSize(640, 360, 1.5)).toEqual({css: 288, px: 432});
    expect(scopeSize(200, 150, 1)).toEqual({css: 240, px: 240});
    expect(scopeSize(1000, 2000, 0.5)).toEqual({css: 720, px: 720}); // never below one backing pixel per CSS pixel
    expect(scopeSize(0, 0, NaN)).toEqual({css: 720, px: 720}); // no viewport (Node): the cap
    for (const [w, h, d] of [[5000, 5000, 8], [1, 1, 1], [1366, 768, 1.25]]) {
      const s = scopeSize(w, h, d);
      expect(s.px).toBeLessThanOrEqual(SCANNER.canvas.max * SCANNER.canvas.dpr);
      expect(s.css).toBeLessThanOrEqual(SCANNER.canvas.max);
    }
  });
});

describe('the DOM holder: one canvas, redrawn only when what it shows changed', () => {
  interface El { tag: string; id: string; style: Record<string, unknown>; children: El[]; parent: {children: El[]} | null; width: number; height: number; ctx: Rec; contexts: number;
    appendChild(c: El): El; remove(): void; getContext(kind: string): unknown }
  function page(vw = 1920, vh = 1080, dpr = 1) {
    const view = {w: vw, h: vh, dpr};
    const made: El[] = [];
    const body = {children: [] as El[], appendChild(c: El) { c.parent = body; body.children.push(c); return c; }};
    const doc = {body, createElement(tag: string): El {
      const el: El = {tag, id: '', style: {}, children: [], parent: null, width: 300, height: 150, ctx: new Rec(), contexts: 0,
        appendChild(c) { c.parent = el; el.children.push(c); return c; },
        remove() { const l = el.parent?.children; if (l) l.splice(l.indexOf(el), 1); el.parent = null; },
        getContext(kind) { el.contexts++; return kind === '2d' ? el.ctx : null; }};
      made.push(el);
      return el;
    }};
    const env: ScopeEnv = {doc: () => doc as never, width: () => view.w, height: () => view.h, dpr: () => view.dpr};
    return {env, view, body, made};
  }

  it('builds #scanner-scope with one canvas on the first open, shows / hides it, keeps it for the next open', () => {
    const p = page(1280, 720, 2), s = new ScannerScope(p.env);
    expect([s.isOpen, p.made.length]).toEqual([false, 0]); // nothing in the page until it is used
    s.open();
    expect(s.isOpen).toBe(true);
    expect(p.body.children.map(e => [e.tag, e.id])).toEqual([['div', 'scanner-scope']]);
    const holder = p.body.children[0], canvas = holder.children[0];
    expect(holder.children.map(e => e.tag)).toEqual(['canvas']);
    expect(holder.style.display).toBe('flex');
    expect([canvas.width, canvas.height, canvas.style.width, canvas.style.height]).toEqual([1152, 1152, '576px', '576px']);
    // the holder styles nothing that could take input: that is the stylesheet's pointer-events none (below)
    expect(Object.keys(holder.style)).toEqual(['display']);
    s.close();
    expect([s.isOpen, holder.style.display]).toEqual([false, 'none']);
    s.open();
    expect(p.made).toHaveLength(2);
    expect(holder.style.display).toBe('flex');
    s.dispose();
    expect([p.body.children.length, s.isOpen, s.el, s.canvas]).toEqual([0, false, null, null]);
  });

  it('draws at the backing scale; the same picture is not drawn twice; the hand redraws at 10 Hz, not every frame', () => {
    const p = page(1280, 720, 2), s = new ScannerScope(p.env);
    const m = model({blips: [{x: 10, z: 10, n: 1}], left: 20, serial: 3});
    expect(s.draw(m)).toBe(false); // closed: nothing
    s.open();
    const canvas = p.body.children[0].children[0];
    expect(s.draw(m)).toBe(true);
    expect(canvas.ctx.transforms).toEqual([[2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 0, 0]]);
    expect(canvas.ctx.ops[0]).toMatchObject({op: 'fillRect', x: 0, y: 0, w: 576, h: 576});
    expect(s.draw(m)).toBe(false);
    expect([s.draws, canvas.contexts]).toEqual([1, 1]);
    // sixty frames of one active second: about ten redraws
    let n = 0;
    for (let i = 1; i <= 60; i++) { m.left = 20 - i / 60; if (s.draw(m)) n++; }
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
    expect(redrawStep(19.99)).toBe(redrawStep(19.91));
    expect(redrawStep(19.89)).not.toBe(redrawStep(19.91));
    expect(SCANNER.redrawHz).toBe(10);
    // a new snapshot / a mode change / a state change redraws at once
    const before = s.draws;
    m.serial++;
    expect(s.draw(m)).toBe(true);
    m.mode = 'ammo';
    expect(s.draw(m)).toBe(true);
    expect(s.draw(m)).toBe(false);
    m.active = false;
    expect(s.draw(m)).toBe(true);
    m.left -= 5; m.serial += 4; // nothing an inactive scope shows depends on the clock or the snapshot
    expect(s.draw(m)).toBe(false);
    m.mode = 'fuel'; // (its mode label does)
    expect(s.draw(m)).toBe(true);
    expect(s.draws).toBe(before + 4);
    // reopening always paints
    s.close(); s.open();
    expect(s.draw(m)).toBe(true);
  });

  it('follows the viewport (bounded) and survives a page without a DOM or without a 2D context', () => {
    const p = page(1920, 1080, 1), s = new ScannerScope(p.env);
    const m = model();
    s.open();
    const canvas = p.body.children[0].children[0];
    expect(s.draw(m)).toBe(true);
    expect([canvas.width, canvas.style.width]).toEqual([720, '720px']);
    p.view.w = 800; p.view.h = 600; p.view.dpr = 3;
    expect(s.draw(m)).toBe(true); // resized: the canvas was cleared
    expect([canvas.width, canvas.height, canvas.style.width]).toEqual([960, 960, '480px']);
    expect(s.draw(m)).toBe(false);
    // no document (Node): open / close only track the state
    const bare = new ScannerScope({doc: () => null, width: () => 0, height: () => 0, dpr: () => 1});
    bare.open();
    expect([bare.isOpen, bare.draw(m), bare.draws]).toEqual([true, false, 0]);
    bare.close();
    expect(bare.isOpen).toBe(false);
    expect(() => new ScannerScope().open()).not.toThrow(); // the default page of a Node process: none
    // a canvas that gives no context draws nothing and does not throw
    const q = page();
    const t = new ScannerScope(q.env);
    t.open();
    q.body.children[0].children[0].getContext = () => null;
    expect(t.draw(m)).toBe(false);
  });
});

describe('the stylesheet block', () => {
  const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');
  it('one marked block: the holder covers the view above the HUD and under the menus, hidden until opened, and never takes the mouse', () => {
    expect(css.match(/lane SCANNER/g)).toHaveLength(2); // its opening and closing comment
    const block = css.slice(css.indexOf('(lane SCANNER)'), css.indexOf('end of lane SCANNER'));
    const rule = /#scanner-scope \{([^}]*)\}/.exec(block)![1];
    for (const d of ['position: fixed', 'inset: 0', 'z-index: 15', 'display: none', 'pointer-events: none', 'align-items: center', 'justify-content: center']) expect(rule).toContain(d);
    expect(block.match(/#scanner-scope[^{]*\{/g)).toHaveLength(2);
    expect(css.indexOf('#scanner-scope')).toBeGreaterThan(css.indexOf('(lane SCANNER)')); // nothing of it outside the block
    expect(Number(/#hud \{[^}]*z-index: (\d+)/.exec(css)![1])).toBeLessThan(15);
    expect(Number(/\.screen \{[^}]*z-index: (\d+)/.exec(css)![1])).toBeGreaterThan(15);
  });
});
