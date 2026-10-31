// Track 2 playtest revision (lane ART): the procedural canvas painters of the STATION-SURFACE invitation art (atlas cells of
// world/trackExt/graffiti.ts; records gen/trackExt/art.ts). Local and deterministic: canvas 2D paths only (no image assets, no
// fonts, no generation service), so the same code paints in the browser and in the node canvas shim (CPU previews).
//
//   - piece      a full-colour letter piece ("REKS", the crew of the tunnel tags): gradient fill, black outline, a stepped 3D
//                block, a pale cutback outline, shine glints, sparkles and drips over a dark spray cloud. NO arrow shapes: the
//                piece is the non-directional eye-catcher (only the stencils point).
//   - watcher    the crew's character: a gas-mask head (goggle lenses, filter snout, hood) over a splat — non-directional.
//   - stencil    "SERVICE" in stencilled block letters with bridges + a stencilled block arrow (left / right variants: only the
//                arrow is mirrored, the letters always read left to right), white for the per-decal tint, soft overspray.

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

/** A polyline stroke (round caps / joins). */
function polyStroke(ctx: Ctx, pts: Pt[], width: number, style: string | CanvasGradient, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function polyFill(ctx: Ctx, pts: Pt[], style: string | CanvasGradient, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function disc(ctx: Ctx, x: number, y: number, r: number, style: string | CanvasGradient, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Paint runs: drips straight down from (x, y), never past `maxY`. */
function drip(ctx: Ctx, x: number, y: number, w: number, len: number, color: string, maxY: number): void {
  const l = Math.min(len, maxY - y - w);
  if (l < 4) return;
  polyStroke(ctx, [[x, y], [x + 0.6, y + l]], w, color, 0.92);
  disc(ctx, x + 0.6, y + l, w * 0.72, color, 0.92);
}

/** A 4-point spray sparkle. */
function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  const k = r * 0.22;
  polyFill(ctx, [[x, y - r], [x + k, y - k], [x + r, y], [x + k, y + k], [x, y + r], [x - k, y + k], [x - r, y], [x - k, y - k]], color, 0.95);
}

/** Irregular closed blob around (cx, cy): radii rx / ry with `n` bumps. */
function blob(cx: number, cy: number, rx: number, ry: number, n: number, rnd: () => number, bump = 0.12): Pt[] {
  const pts: Pt[] = [];
  const ph = rnd() * 6.28;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const r = 1 + bump * Math.sin(a * n + ph) + bump * 0.5 * Math.sin(a * (n * 2 + 1) + ph * 1.7) + (rnd() - 0.5) * bump * 0.25;
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  return pts;
}

// ---- the piece ---------------------------------------------------------------------------------------------------------

/** Block-letter skeletons in a unit box (x right, y down); the stroke width makes the letter body. */
const PIECE_GLYPHS: Record<string, Pt[][]> = {
  R: [[[0, 1.02], [0, 0], [0.74, 0], [1, 0.2], [0.96, 0.4], [0.7, 0.5], [0.04, 0.5]], [[0.42, 0.5], [1.08, 1.04]]],
  E: [[[1.02, 0], [0, 0], [0, 1], [1.06, 1]], [[0, 0.5], [0.78, 0.5]]],
  K: [[[0, -0.04], [0, 1.02]], [[0.98, -0.06], [0.06, 0.56]], [[0.36, 0.4], [1.06, 1.04]]],
  S: [[[1.02, 0.08], [0.82, 0], [0.18, 0], [0, 0.16], [0.02, 0.36], [0.2, 0.48], [0.82, 0.52], [1.0, 0.66], [1.0, 0.86], [0.82, 1], [0.12, 1], [-0.06, 0.88]]],
};
/** Spikes (wildstyle points: NOT arrows) at stroke ends: [letter, stroke, at end (true) / start, length (x stroke width)]. */
const PIECE_SPIKES: [string, number, boolean, number][] = [['R', 1, true, 1.1], ['E', 1, true, 0.9], ['K', 1, false, 1.0], ['S', 0, false, 0.9], ['S', 0, true, 1.0]];

/** The piece in a cw x ch cell (2:1). Deterministic for `rnd`. */
export function paintPiece(ctx: Ctx, cw: number, ch: number, rnd: () => number): void {
  const word = 'REKS';
  // --- cloud: a dark spray cloud with a light rim, dots and drips behind everything
  const cloud = blob(cw * 0.5, ch * 0.5, cw * 0.47, ch * 0.4, 7, rnd, 0.08);
  polyFill(ctx, blob(cw * 0.5, ch * 0.5, cw * 0.485, ch * 0.43, 7, rnd, 0.08), 'rgba(120,236,255,1)', 0.85);
  const cg = ctx.createLinearGradient(0, ch * 0.15, 0, ch * 0.9);
  cg.addColorStop(0, '#2a1450');
  cg.addColorStop(1, '#120a26');
  polyFill(ctx, cloud, cg, 1);
  for (let i = 0; i < 70; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd());
    disc(ctx, cw * 0.5 + Math.cos(a) * cw * 0.42 * r, ch * 0.52 + Math.sin(a) * ch * 0.31 * r, 1.5 + rnd() * 3.5, rnd() < 0.5 ? '#6a4bd0' : '#2f8fd8', 0.55);
  }
  for (let i = 0; i < 9; i++) drip(ctx, cw * (0.14 + rnd() * 0.72), ch * (0.8 + rnd() * 0.04), 4 + rnd() * 3, 14 + rnd() * 38, '#1a0e36', ch - 4);
  // --- letters: layout (slanted, bouncing), strokes in cell px
  const n = word.length, lw = cw * 0.145, lh = ch * 0.5, gapX = cw * 0.028, slant = 0.2;
  // centred with the slant and the 3D block (both lean right) taken into account
  const x0 = cw * 0.5 - (n * lw + (n - 1) * gapX) / 2 - cw * 0.04, base = ch * 0.76;
  const W = ch * 0.105; // letter stroke width
  const strokes: {pts: Pt[]; letter: string; k: number}[] = [];
  for (let i = 0; i < n; i++) {
    const L = word[i], g = PIECE_GLYPHS[L];
    const bounce = (i % 2 ? -1 : 1) * ch * 0.025 + (rnd() - 0.5) * ch * 0.02, sc = 0.94 + rnd() * 0.12;
    const gx = x0 + i * (lw + gapX), gw = lw * sc, gh = lh * sc;
    g.forEach((st, k) => strokes.push({letter: L, k, pts: st.map(([u, v]) => {
      const y = base + bounce - gh + v * gh;
      return [gx + u * gw + (base - y) * slant, y] as Pt;
    })}));
  }
  const spikes: Pt[][] = [];
  for (const [L, k, atEnd, len] of PIECE_SPIKES) {
    const s = strokes.find(q => q.letter === L && q.k === k);
    if (!s) continue;
    const p = atEnd ? s.pts[s.pts.length - 1] : s.pts[0], q = atEnd ? s.pts[s.pts.length - 2] : s.pts[1];
    const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    spikes.push([[p[0] - uy * W * 0.48, p[1] + ux * W * 0.48], [p[0] + ux * W * len, p[1] + uy * W * len], [p[0] + uy * W * 0.48, p[1] - ux * W * 0.48]]);
  }
  const all = (width: number, style: string | CanvasGradient, ox = 0, oy = 0, alpha = 1) => {
    for (const s of strokes) polyStroke(ctx, s.pts.map(([x, y]) => [x + ox, y + oy] as Pt), width, style, alpha);
    for (const sp of spikes) {
      // a spike grows with the outline width like the strokes do
      const grow = (width - W) / 2, c: Pt = [(sp[0][0] + sp[2][0]) / 2, (sp[0][1] + sp[2][1]) / 2];
      const out = sp.map(([x, y]) => { const dx = x - c[0], dy = y - c[1], l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * grow + ox, y + (dy / l) * grow + oy] as Pt; });
      polyFill(ctx, out, style, alpha);
    }
  };
  const dx3 = W * 0.16, dy3 = W * 0.13, steps = 6;
  // pale cutback outline around letters + block, then the 3D block (teal, stepping darker), then the black outline
  for (let k = steps; k >= 0; k--) all(W + W * 0.95, '#f4f1e6', dx3 * k, dy3 * k);
  for (let k = steps; k >= 1; k--) {
    const t = k / steps;
    all(W + W * 0.5, `rgb(${Math.round(18 + 30 * (1 - t))},${Math.round(70 + 90 * (1 - t))},${Math.round(92 + 80 * (1 - t))})`, dx3 * k, dy3 * k);
  }
  all(W + W * 0.5, '#0b0b10');
  // fill: hot gradient top to bottom, a fade band, then shine glints and sparkles
  const fg = ctx.createLinearGradient(0, base - lh, 0, base + ch * 0.02);
  fg.addColorStop(0, '#fff06a');
  fg.addColorStop(0.42, '#ff9a1f');
  fg.addColorStop(0.72, '#ff3d6e');
  fg.addColorStop(1, '#c21877');
  all(W, fg);
  for (const s of strokes) {
    // a short shine on the first segment of each stroke (inside the body: offset across it by a quarter width)
    const [a, b] = s.pts, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    const o = W * 0.22 * (ny < 0 ? 1 : -1), t0 = Math.min(0.3, (W * 0.6) / l), t1 = Math.min(0.62, t0 + (W * 1.4) / l);
    polyStroke(ctx, [[a[0] + dx * t0 + nx * o, a[1] + dy * t0 + ny * o], [a[0] + dx * t1 + nx * o, a[1] + dy * t1 + ny * o]], W * 0.13, '#ffffff', 0.9);
  }
  for (let i = 0; i < 6; i++) {
    const s = strokes[Math.floor(rnd() * strokes.length)], p = s.pts[Math.floor(rnd() * s.pts.length)];
    sparkle(ctx, p[0] + (rnd() - 0.5) * W, p[1] - W * 0.3, W * (0.35 + rnd() * 0.3), '#ffffff');
  }
  // drips of the fill colour off the letter bottoms
  for (const s of strokes) for (const p of s.pts) if (p[1] > base - ch * 0.03 && rnd() < 0.5) drip(ctx, p[0] + (rnd() - 0.5) * W * 0.6, p[1] + W * 0.3, 3 + rnd() * 3, 10 + rnd() * 30, '#c21877', ch - 4);
  // a crown over the first letter, stars in the cloud
  const cx = x0 + lw * 0.55, cy = base - lh - ch * 0.1, r = ch * 0.06;
  polyStroke(ctx, [[cx - r * 1.3, cy + r], [cx - r * 1.3, cy - r * 0.6], [cx - r * 0.55, cy + r * 0.1], [cx, cy - r], [cx + r * 0.55, cy + r * 0.1], [cx + r * 1.3, cy - r * 0.6], [cx + r * 1.3, cy + r], [cx - r * 1.3, cy + r]], W * 0.2, '#0b0b10');
  polyStroke(ctx, [[cx - r * 1.3, cy + r], [cx - r * 1.3, cy - r * 0.6], [cx - r * 0.55, cy + r * 0.1], [cx, cy - r], [cx + r * 0.55, cy + r * 0.1], [cx + r * 1.3, cy - r * 0.6], [cx + r * 1.3, cy + r], [cx - r * 1.3, cy + r]], W * 0.1, '#fff06a');
  for (let i = 0; i < 7; i++) sparkle(ctx, cw * (0.08 + rnd() * 0.84), ch * (0.12 + rnd() * 0.2), ch * (0.015 + rnd() * 0.025), '#bff6ff');
}

// ---- the watcher ---------------------------------------------------------------------------------------------------------

/** The gas-mask watcher in a cw x ch (square) cell. */
export function paintWatcher(ctx: Ctx, cw: number, ch: number, rnd: () => number): void {
  const cx = cw * 0.5, cy = ch * 0.47, R = Math.min(cw, ch) * 0.3;
  // splat behind: cyan with a magenta rim and flecks
  polyFill(ctx, blob(cx, cy + R * 0.1, R * 1.58, R * 1.42, 9, rnd, 0.16), '#ff3d8e', 0.9);
  polyFill(ctx, blob(cx, cy + R * 0.1, R * 1.45, R * 1.3, 9, rnd, 0.16), '#33d6e6', 1);
  for (let i = 0; i < 40; i++) { const a = rnd() * 6.28, r = R * (1.55 + rnd() * 0.35); disc(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + rnd() * 5, rnd() < 0.5 ? '#33d6e6' : '#ff3d8e', 0.85); }
  const ink = '#0b0b10', o = R * 0.07;
  // hood
  const hood = blob(cx, cy - R * 0.05, R * 1.12, R * 1.18, 3, rnd, 0.03);
  polyFill(ctx, hood, ink, 1);
  const hg = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  hg.addColorStop(0, '#ff5a3c');
  hg.addColorStop(1, '#a81e2e');
  polyFill(ctx, blob(cx, cy - R * 0.05, R * 1.12 - o, R * 1.18 - o, 3, rnd, 0.03), hg, 1);
  // mask face (purple rubber)
  const face = blob(cx, cy + R * 0.08, R * 0.84, R * 0.9, 2, rnd, 0.02);
  polyFill(ctx, face, ink, 1);
  const mg = ctx.createLinearGradient(0, cy - R * 0.8, 0, cy + R);
  mg.addColorStop(0, '#9b6bff');
  mg.addColorStop(1, '#3d1f8a');
  polyFill(ctx, blob(cx, cy + R * 0.08, R * 0.84 - o, R * 0.9 - o, 2, rnd, 0.02), mg, 1);
  // straps
  for (const sx of [-1, 1]) polyStroke(ctx, [[cx + sx * R * 0.62, cy - R * 0.25], [cx + sx * R * 1.02, cy - R * 0.55]], R * 0.14, ink);
  // goggle lenses: yellow glass, black rims, centred pupils (no gaze direction), white glints
  for (const sx of [-1, 1]) {
    const ex = cx + sx * R * 0.38, ey = cy - R * 0.12, er = R * 0.27;
    disc(ctx, ex, ey, er + o * 1.6, ink);
    disc(ctx, ex, ey, er + o * 0.4, '#c9c4b8');
    const lg = ctx.createRadialGradient(ex - er * 0.3, ey - er * 0.3, er * 0.1, ex, ey, er);
    lg.addColorStop(0, '#fffbd0');
    lg.addColorStop(1, '#f2c21a');
    disc(ctx, ex, ey, er, lg);
    disc(ctx, ex, ey + er * 0.05, er * 0.42, ink);
    disc(ctx, ex - er * 0.38, ey - er * 0.4, er * 0.18, '#ffffff');
  }
  // filter snout: orange canister with a grille
  const fx = cx, fy = cy + R * 0.52, fr = R * 0.3;
  polyFill(ctx, [[fx - fr * 0.7, fy - fr * 1.05], [fx + fr * 0.7, fy - fr * 1.05], [fx + fr * 1.1, fy - fr * 0.1], [fx - fr * 1.1, fy - fr * 0.1]], ink, 1);
  disc(ctx, fx, fy, fr + o * 1.4, ink);
  const fg = ctx.createRadialGradient(fx - fr * 0.3, fy - fr * 0.3, fr * 0.1, fx, fy, fr);
  fg.addColorStop(0, '#ffc06a');
  fg.addColorStop(1, '#e8641c');
  disc(ctx, fx, fy, fr, fg);
  for (let k = -2; k <= 2; k++) polyStroke(ctx, [[fx + k * fr * 0.3, fy - fr * 0.6], [fx + k * fr * 0.3, fy + fr * 0.6]], fr * 0.1, ink);
  // drips off the chin, a few sparkles
  for (let i = 0; i < 5; i++) drip(ctx, cx + (rnd() - 0.5) * R * 1.0, cy + R * 0.95, 4 + rnd() * 4, 20 + rnd() * 50, '#3d1f8a', ch - 4);
  for (let i = 0; i < 4; i++) sparkle(ctx, cx + (rnd() - 0.5) * R * 2.6, cy - R * (0.9 + rnd() * 0.4), R * (0.08 + rnd() * 0.06), '#ffffff');
}

// ---- the SERVICE stencil -------------------------------------------------------------------------------------------------

/** Stencil block letters on a 4 x 6 unit grid: rectangles [x, y, w, h] and polygons; gaps are the stencil bridges. */
const STENCIL: Record<string, {r?: [number, number, number, number][]; p?: Pt[][]}> = {
  S: {r: [[0.5, 0, 3.5, 1], [0, 0.5, 1, 2.2], [0.5, 2.5, 3, 1], [3, 2.8, 1, 2.7], [0, 5, 3.5, 1]]},
  E: {r: [[0, 0, 1, 2.75], [0, 3.25, 1, 2.75], [1.3, 0, 2.7, 1], [1.3, 2.5, 2.2, 1], [1.3, 5, 2.7, 1]]},
  R: {r: [[0, 0, 1, 6], [1.3, 0, 2.2, 1], [3, 0.5, 1, 2], [1.3, 2.5, 2.2, 1]], p: [[[1.9, 3.7], [2.9, 3.7], [4, 6], [3, 6]]]},
  V: {p: [[[0, 0], [1, 0], [1.85, 4.6], [1.6, 6]], [[3, 0], [4, 0], [2.4, 6], [2.15, 4.6]]]},
  I: {r: [[1.5, 0, 1, 2.75], [1.5, 3.25, 1, 2.75]]},
  C: {r: [[0.5, 0, 3.5, 1], [0, 0.5, 1, 5], [0.5, 5, 3.5, 1]]},
};

/** Advance (grid units) of a stencil glyph: 4 wide + 1 gap; the narrow I is drawn at x 1.5..2.5 of its box and advances 3. */
const advance = (ch: string) => (ch === 'I' ? 3 : 5);
const lead = (ch: string) => (ch === 'I' ? -1 : 0);
const wordUnits = (word: string) => [...word].reduce((n, ch) => n + advance(ch), 0) - 1;

function stencilWord(ctx: Ctx, word: string, x0: number, y0: number, u: number, color: string, alpha: number, grow = 0): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  let pen = 0;
  for (let i = 0; i < word.length; i++) {
    const g = STENCIL[word[i]], ox = x0 + (pen + lead(word[i])) * u;
    pen += advance(word[i]);
    ctx.beginPath();
    for (const [x, y, w, h] of g.r ?? []) ctx.rect(ox + x * u - grow, y0 + y * u - grow, w * u + 2 * grow, h * u + 2 * grow);
    for (const p of g.p ?? []) { ctx.moveTo(ox + p[0][0] * u, y0 + p[0][1] * u); for (let k = 1; k < p.length; k++) ctx.lineTo(ox + p[k][0] * u, y0 + p[k][1] * u); ctx.closePath(); }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** "SERVICE" + a stencilled block arrow pointing `dir` (only the arrow mirrors), white for the per-decal tint. */
export function paintServiceStencil(ctx: Ctx, cw: number, ch: number, rnd: () => number, dir: 'left' | 'right'): void {
  const word = 'SERVICE', u = Math.min((cw * 0.82) / wordUnits(word), (ch * 0.34) / 6);
  const tw = wordUnits(word) * u, x0 = (cw - tw) / 2, y0 = ch * 0.1;
  // a rough dark backing panel (rollered over the wall first) so the mark reads on pale tile and in the dark: it stays dark under
  // any can tint; then the overspray halo and the crisp letters
  const panel: Pt[] = [];
  for (let i = 0; i <= 24; i++) panel.push([cw * (0.03 + 0.94 * (i / 24)), ch * 0.04 + (rnd() - 0.5) * 6]);
  for (let i = 0; i <= 8; i++) panel.push([cw * 0.97 + (rnd() - 0.5) * 6, ch * (0.04 + 0.9 * (i / 8))]);
  for (let i = 24; i >= 0; i--) panel.push([cw * (0.03 + 0.94 * (i / 24)), ch * 0.94 + (rnd() - 0.5) * 6]);
  for (let i = 8; i >= 0; i--) panel.push([cw * 0.03 + (rnd() - 0.5) * 6, ch * (0.04 + 0.9 * (i / 8))]);
  polyFill(ctx, panel, '#101012', 0.72);
  for (let i = 0; i < 3; i++) drip(ctx, cw * (0.1 + rnd() * 0.8), ch * 0.93, 3 + rnd() * 2, 4 + rnd() * 10, 'rgba(16,16,18,0.7)', ch - 2);
  stencilWord(ctx, word, x0, y0, u, '#ffffff', 0.1, u * 0.45);
  stencilWord(ctx, word, x0, y0, u, '#ffffff', 0.95);
  // the arrow under the word: shaft pieces + head, with two bridges; mirrored for 'left'
  const ay = ch * 0.72, ah = ch * 0.17, s = dir === 'right' ? 1 : -1, X = (f: number) => cw / 2 + s * (f - 0.5) * cw * 0.86;
  const shaft = (f0: number, f1: number) => polyFill(ctx, [[X(f0), ay - ah * 0.42], [X(f1), ay - ah * 0.42], [X(f1), ay + ah * 0.42], [X(f0), ay + ah * 0.42]], '#ffffff', 0.95);
  for (const [f0, f1] of [[0.02, 0.3], [0.33, 0.62]] as const) {
    polyFill(ctx, [[X(f0) - s * 3, ay - ah * 0.42 - 3], [X(f1) + s * 3, ay - ah * 0.42 - 3], [X(f1) + s * 3, ay + ah * 0.42 + 3], [X(f0) - s * 3, ay + ah * 0.42 + 3]], '#ffffff', 0.1);
    shaft(f0, f1);
  }
  polyFill(ctx, [[X(0.645), ay - ah * 1.35], [X(1), ay], [X(0.645), ay + ah * 1.35]], '#ffffff', 0.95);
  // a few runs from the lower edges
  for (let i = 0; i < 4; i++) drip(ctx, x0 + rnd() * tw, y0 + 6 * u, 2 + rnd() * 2, 6 + rnd() * 18, '#ffffff', ay - ah * 1.4);
  for (let i = 0; i < 3; i++) drip(ctx, X(0.05 + rnd() * 0.55), ay + ah * 0.45, 2 + rnd() * 2, 6 + rnd() * 20, '#ffffff', ch - 3);
}
