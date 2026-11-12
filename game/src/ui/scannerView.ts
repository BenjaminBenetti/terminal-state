// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER; user: "opens a black/green 360-degree radar around the train,
// approximately 100m range … snapshot blips: red enemies, green ordinary items, gold weapons/gear. No floorplan/map or continuous live
// tracking"): THE SCANNER'S SCOPE — DYNAMIC content (the standing art rule's exemption: state-driven runtime data drawn in code, like
// world/bunker/coreScreen.ts; never authored artwork).
//
//  - drawScanner(ctx, model, w, h): PURE drawing of one model on a 2D context (tests record the calls / rasterise it). Black glass, green
//    phosphor: the four range rings (SCANNER.rings, labelled in metres), a faint reticle and bearing ticks, the FRONT tick at the top (up
//    on the scope = the car's front), the train's glyph in the centre (a small bar, its nose up), the sweep hand with its fading trail
//    (one turn per period; it crosses "up" at the sweep instant), the blips of the LAST SNAPSHOT (craft/scanner.ts: brightest right after a
//    sweep, dimming to SCANNER.dim — never gone before the next one), the legend, the range and "NEXT SWEEP IN N s".
//    A class has its colour AND its own mark (enemy: a red disc; item: a green square; weapon / gear: a gold diamond), so the three stay
//    apart without colour vision; marks of different classes in one cell are nudged apart inside the cell so none hides another.
//    NEVER drawn: walls, rooms, routes, a label or a distance per blip, anything of the level's plan — the model holds none of it.
//    Not active (unplugged / the train not parked): the snapshot is blanked — "NO SIGNAL — PLUG IN".
//  - ScannerScope: the DOM holder — one <canvas> in #scanner-scope over the game (styles.css; pointer-events none: it never takes the
//    mouse or pauses anything), sized scopeSize() (a fraction of the smaller viewport side, capped; devicePixelRatio capped), redrawn only
//    when what it shows changed (the snapshot, the state, the hand's step at SCANNER.redrawHz, the viewport). No DOM (Node): it only
//    tracks open / closed.

import {SCANNER, SCAN_CLASSES, blipBrightness, blipScale, secondsLeft, sweepAngle, type ScanBlip, type ScanClass, type ScanSnapshot} from '../craft/scanner';

/** What the scope shows (filled by world/itemScanner.ts; plain data). */
export interface ScannerModel {
  /** The scanner works: plugged into the parked train in a live world. False: no signal, the snapshot is not shown. */
  active: boolean;
  /** The last snapshot of this world (null: none yet). */
  snap: ScanSnapshot | null;
  /** Counts the snapshots (a redraw key). */
  serial: number;
  /** Active seconds to the next sweep. */
  left: number;
}

/** The on-screen copy (one place). */
export const SCOPE_TEXT = {
  title: 'ITEM SCANNER',
  range: `RANGE ${SCANNER.range} m`,
  front: 'FRONT',
  legend: {enemy: 'ENEMY', item: 'ITEM', gear: 'WEAPON / GEAR'} as Readonly<Record<ScanClass, string>>,
  next: (seconds: number) => `NEXT SWEEP IN ${seconds} s`,
  first: 'FIRST SWEEP PENDING',
  noSignal: 'NO SIGNAL — PLUG IN',
  paused: 'SWEEP PAUSED',
} as const;

/** The three blip colours (user: red enemies, green ordinary items, gold weapons / gear). */
export const SCAN_COLORS: Readonly<Record<ScanClass, string>> = {enemy: '#ff4b3e', item: '#4be06a', gear: '#ffc83d'};

/** The scope's own greens / glass. */
export const SCOPE_COLORS = {
  bg: '#000000', glass: '#03100a', glassEdge: '#010503', ring: '#1c7a3c', ringOuter: '#35c765', reticle: '#0f4222', label: '#2f9a50', text: '#7df5a0', dimText: '#3fae62',
  hand: '#9dffba', trail: '120, 255, 160', train: '#d6ffe2',
} as const;

/** The trail's wedges, the newest (at the hand) first: fading to nothing. */
const TRAIL: readonly string[] = Array.from({length: SCANNER.trailSteps}, (_, i) => { const k = 1 - i / SCANNER.trailSteps; return `rgba(${SCOPE_COLORS.trail}, ${(0.17 * k * k).toFixed(3)})`; });

type Ctx = CanvasRenderingContext2D;
const FONT = '"DejaVu Sans Mono", "Courier New", monospace';
const TAU = Math.PI * 2;

/** Where the scope sits on a w x h canvas: its centre, the outer ring's radius (px) and the unit `s` every size derives from. */
export interface ScopeGeometry { cx: number; cy: number; r: number; s: number }
export function scopeGeometry(w: number, h: number): ScopeGeometry {
  const s = Math.min(w, h);
  return {cx: w / 2, cy: h * 0.47, r: s * 0.375, s};
}

/** How far marks of a class are moved inside their cell (fractions of a cell: right, down) so classes sharing a cell stay visible. */
const NUDGE: Readonly<Record<ScanClass, readonly [number, number]>> = {enemy: [0, -0.2], item: [-0.22, 0.2], gear: [0.22, 0.2]};

/**
 * A blip's point on the canvas: the train's frame seen from above with the car's FRONT UP — local +x (ahead) is up, local +z (the car's
 * right) is right; with a class, nudged inside its cell. Never past the outer ring (a cell centre at the edge of the range is drawn
 * on it). `out` is filled and returned (the draw passes one scratch point).
 */
export function blipPoint(g: ScopeGeometry, b: {x: number; z: number}, cls?: ScanClass, out: {x: number; y: number} = {x: 0, y: 0}): {x: number; y: number} {
  const k = g.r / SCANNER.range, n = cls ? NUDGE[cls] : null, cell = SCANNER.cell * k;
  let dx = b.z * k + (n ? n[0] * cell : 0), dy = -b.x * k + (n ? n[1] * cell : 0);
  const d = Math.hypot(dx, dy);
  if (d > g.r) { dx *= g.r / d; dy *= g.r / d; }
  out.x = g.cx + dx;
  out.y = g.cy + dy;
  return out;
}
const POINT = {x: 0, y: 0};

/** A blip mark's half size (px) on a scope of unit `s` for `n` merged things. */
export function markSize(s: number, n: number): number {
  return Math.max(1.5, s * 0.0046) * blipScale(n);
}

/** The legend's order (left to right) and its entries' measured widths (scratch). */
const LEGEND: readonly ScanClass[] = ['enemy', 'item', 'gear'];
const LEGEND_W = [0, 0, 0];

function text(ctx: Ctx, str: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left', weight = 'bold'): void {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${Math.max(8, Math.round(px))}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

/** One mark of `cls` centred on (x, y), half size m, in the current fill style. */
function mark(ctx: Ctx, cls: ScanClass, x: number, y: number, m: number): void {
  if (cls === 'item') { ctx.fillRect(x - m * 0.9, y - m * 0.9, m * 1.8, m * 1.8); return; }
  ctx.beginPath();
  if (cls === 'enemy') ctx.arc(x, y, m, 0, TAU);
  else { const d = m * 1.3; ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath(); }
  ctx.fill();
}

function blips(ctx: Ctx, g: ScopeGeometry, cls: ScanClass, list: readonly ScanBlip[]): void {
  ctx.fillStyle = SCAN_COLORS[cls];
  for (const b of list) { const p = blipPoint(g, b, cls, POINT); mark(ctx, cls, p.x, p.y, markSize(g.s, b.n)); }
}

/** Draws the scope for `m` onto a w x h px context (pure: the model in, canvas calls out). */
export function drawScanner(ctx: Ctx, m: ScannerModel, w: number, h: number): void {
  const g = scopeGeometry(w, h), {cx, cy, r, s} = g, C = SCOPE_COLORS;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  // the glass
  const glass = typeof ctx.createRadialGradient === 'function' ? ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.06) : null;
  if (glass) { glass.addColorStop(0, C.glass); glass.addColorStop(1, C.glassEdge); }
  ctx.fillStyle = glass ?? C.glass;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.06, 0, TAU); ctx.fill();
  // the reticle and the bearing ticks
  ctx.strokeStyle = C.reticle; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.strokeStyle = C.ring;
  ctx.beginPath();
  for (let i = 1; i < 12; i++) { const a = i * TAU / 12, sx = Math.sin(a), sy = -Math.cos(a); ctx.moveTo(cx + sx * r, cy + sy * r); ctx.lineTo(cx + sx * r * 1.035, cy + sy * r * 1.035); }
  ctx.stroke();
  // the range rings (the outer one is the range)
  const rings = SCANNER.rings;
  for (let i = 0; i < rings.length; i++) {
    const outer = i === rings.length - 1;
    ctx.strokeStyle = outer ? C.ringOuter : C.ring; ctx.lineWidth = outer ? 2 : 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * rings[i] / SCANNER.range, 0, TAU); ctx.stroke();
  }
  for (const ring of rings) text(ctx, String(ring), cx + s * 0.008, cy + r * ring / SCANNER.range - s * 0.016, s * 0.019, C.label, 'left', 'normal');
  // the FRONT tick: up on the scope is the car's front
  ctx.fillStyle = C.ringOuter;
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.075); ctx.lineTo(cx + s * 0.013, cy - r * 1.02); ctx.lineTo(cx - s * 0.013, cy - r * 1.02); ctx.closePath(); ctx.fill();
  text(ctx, SCOPE_TEXT.front, cx + s * 0.024, cy - r * 1.055, s * 0.019, C.dimText, 'left', 'normal');
  if (m.active) {
    // the sweep hand and its fading trail (clockwise from up; canvas angles run clockwise from +x)
    const a = sweepAngle(m.left), ca = a - Math.PI / 2, step = SCANNER.trail / SCANNER.trailSteps;
    for (let i = 0; i < SCANNER.trailSteps; i++) {
      ctx.fillStyle = TRAIL[i];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, ca - (i + 1) * step, ca - i * step); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = C.hand; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); ctx.stroke();
    // the last snapshot: brightest right after its sweep, dimming until the next (enemies on top)
    if (m.snap) {
      ctx.globalAlpha = blipBrightness(m.left);
      for (const cls of SCAN_CLASSES) blips(ctx, g, cls, m.snap[cls]);
      ctx.globalAlpha = 1;
    }
  }
  // the train: a small bar, its nose (the car's front) up
  const bw = s * 0.011, bl = s * 0.034;
  ctx.fillStyle = C.train;
  ctx.fillRect(cx - bw / 2, cy - bl / 2, bw, bl);
  ctx.beginPath(); ctx.moveTo(cx, cy - bl / 2 - bw); ctx.lineTo(cx + bw / 2, cy - bl / 2); ctx.lineTo(cx - bw / 2, cy - bl / 2); ctx.closePath(); ctx.fill();
  // the header, the legend, the countdown
  text(ctx, SCOPE_TEXT.title, s * 0.045, s * 0.05, s * 0.026, C.text);
  text(ctx, SCOPE_TEXT.range, w - s * 0.045, s * 0.05, s * 0.026, C.text, 'right');
  const ly = h - s * 0.088, lpx = s * 0.024, lm = s * 0.0085, gap = s * 0.016, between = s * 0.05;
  ctx.font = `bold ${Math.max(8, Math.round(lpx))}px ${FONT}`;
  let total = between * (LEGEND.length - 1);
  for (let i = 0; i < LEGEND.length; i++) total += (LEGEND_W[i] = lm * 2 + gap + ctx.measureText(SCOPE_TEXT.legend[LEGEND[i]]).width);
  let x = (w - total) / 2;
  for (let i = 0; i < LEGEND.length; i++) {
    const c = LEGEND[i];
    ctx.fillStyle = SCAN_COLORS[c];
    mark(ctx, c, x + lm, ly, lm);
    text(ctx, SCOPE_TEXT.legend[c], x + lm * 2 + gap, ly, lpx, SCAN_COLORS[c]);
    x += LEGEND_W[i] + between;
  }
  if (m.active) {
    text(ctx, SCOPE_TEXT.next(secondsLeft(m.left)), w / 2, h - s * 0.038, s * 0.026, C.text, 'center');
    if (!m.snap) text(ctx, SCOPE_TEXT.first, cx, cy + r * 0.4, s * 0.024, C.dimText, 'center');
  } else {
    text(ctx, SCOPE_TEXT.noSignal, cx, cy - r * 0.32, s * 0.044, C.text, 'center');
    text(ctx, SCOPE_TEXT.paused, w / 2, h - s * 0.038, s * 0.026, C.dimText, 'center');
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The DOM holder

/** The scope's size for a viewport: `css` px on a side (bounded) and the canvas's backing `px` (devicePixelRatio capped). */
export function scopeSize(vw: number, vh: number, dpr: number): {css: number; px: number} {
  const C = SCANNER.canvas;
  const side = Math.min(vw, vh);
  const css = Math.round(Math.max(C.min, Math.min(C.max, C.frac * (side > 0 ? side : C.max / C.frac))));
  const k = Math.max(1, Math.min(C.dpr, dpr > 0 ? dpr : 1));
  return {css, px: Math.round(css * k)};
}

/** The hand's redraw step of `left` (SCANNER.redrawHz steps a second). */
export const redrawStep = (left: number): number => Math.floor(left * SCANNER.redrawHz);

interface ElLike { id?: string; style: Record<string, unknown>; appendChild?(c: unknown): unknown; remove?(): void }
interface CanvasLike extends ElLike { width: number; height: number; getContext(kind: '2d'): unknown }
/** The page the scope lives in (structural: tests pass a fake). */
export interface ScopeEnv {
  /** The document (null: no DOM — the scope only tracks open / closed). */
  doc(): {createElement(tag: string): unknown; body?: {appendChild(c: unknown): unknown} | null} | null;
  width(): number;
  height(): number;
  dpr(): number;
}

const browserEnv: ScopeEnv = {
  doc: () => (typeof document !== 'undefined' ? document : null),
  width: () => (typeof window !== 'undefined' ? window.innerWidth : 0),
  height: () => (typeof window !== 'undefined' ? window.innerHeight : 0),
  dpr: () => (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
};

export class ScannerScope {
  isOpen = false;
  /** Redraws done (QA / tests). */
  draws = 0;
  el: ElLike | null = null;
  canvas: CanvasLike | null = null;
  private css = 0;
  private px = 0;
  // what the canvas shows now (a redraw only when one of them changed)
  private shown = {valid: false, active: false, serial: -1, step: -1};

  constructor(readonly env: ScopeEnv = browserEnv) {}

  /** Show the scope (built on the first open). */
  open(): void {
    this.isOpen = true;
    this.shown.valid = false;
    const doc = this.env.doc();
    if (!doc?.body) return;
    if (!this.el) {
      const el = doc.createElement('div') as ElLike, c = doc.createElement('canvas') as CanvasLike;
      el.id = 'scanner-scope';
      el.appendChild?.(c);
      doc.body.appendChild(el);
      this.el = el;
      this.canvas = c;
      this.css = this.px = 0;
    }
    this.fit();
    this.el.style.display = 'flex';
  }

  close(): void {
    this.isOpen = false;
    if (this.el) this.el.style.display = 'none';
  }

  /** The canvas follows the viewport (bounded); a resize clears it, so the next draw is forced. */
  private fit(): void {
    const c = this.canvas;
    if (!c) return;
    const {css, px} = scopeSize(this.env.width(), this.env.height(), this.env.dpr());
    if (css === this.css && px === this.px) return;
    this.css = css;
    this.px = px;
    c.width = px;
    c.height = px;
    c.style.width = `${css}px`;
    c.style.height = `${css}px`;
    this.shown.valid = false;
  }

  /** Redraw when what the scope shows changed (the snapshot, the state, the hand's step, the size). True: it drew. */
  draw(m: ScannerModel): boolean {
    if (!this.isOpen || !this.canvas) return false;
    this.fit();
    const sh = this.shown, step = m.active ? redrawStep(m.left) : 0, serial = m.active ? m.serial : 0;
    if (sh.valid && sh.active === m.active && sh.serial === serial && sh.step === step) return false;
    const ctx = this.canvas.getContext('2d') as Ctx | null;
    if (!ctx) return false;
    const k = this.px / this.css;
    ctx.setTransform?.(k, 0, 0, k, 0, 0);
    drawScanner(ctx, m, this.css, this.css);
    ctx.setTransform?.(1, 0, 0, 1, 0, 0);
    sh.valid = true; sh.active = m.active; sh.serial = serial; sh.step = step;
    this.draws++;
    return true;
  }

  /** Remove the element (QA / tests; the game keeps it for the session). */
  dispose(): void {
    this.close();
    this.el?.remove?.();
    this.el = null;
    this.canvas = null;
  }
}
