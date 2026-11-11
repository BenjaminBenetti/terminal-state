// Task studio-initial-loading-subway-graphic-20261111-070741-01: THE LOADING SCREEN'S GRAPHIC — a small subway-map drawing that fills
// in as the load really advances, in place of the progress bar, on an opaque backdrop (the half-built world and the held gun behind
// the old translucent card are no longer visible).
//
// It is DECORATION: one fixed drawing (the data below), the same for every run, seed and destination. Nothing here reads the campaign
// network, a layout or a save, so it cannot show or change the player's map (ui/paperMap.ts is that map).
//
// Its progress is the load's own. game.ts reports every stage where it used to write the bar's width (the prop models, the mall's
// texture uploads, the graphics warm-up) and LoadProgress places those stages on one 0..1 scale that never runs backwards within a
// load and reaches 1 only when the game says the load is ready (complete()). The drawing is a pure function of that number
// (loadingMapFrame): nothing waits for an animation, and play is never held back for one.

type Pt = readonly [number, number];

/** A stage of a load, in the order game.ts runs them ('textures': the mall's staged uploads only). */
export type LoadStage = 'props' | 'textures' | 'graphics';

/**
 * Each stage's share of the whole load. The gaps are the steps that report nothing (the world build sits between the models and
 * the warm-up); the last stretch belongs to complete(), so no stage can draw the finished map.
 */
export const LOAD_STAGES: Readonly<Record<LoadStage, readonly [number, number]>> = {props: [0, 0.42], textures: [0.46, 0.52], graphics: [0.52, 0.96]};

const unit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** One load's overall progress (0..1): monotonic within a load, 1 only once complete() is called. */
export class LoadProgress {
  private p = 0;
  get value(): number { return this.p; }
  /** A new load starts. */
  reset(): number { return (this.p = 0); }
  /** `stage` is `frac` (0..1) done. A later stage implies the earlier ones; a stage that restarts never takes progress back. */
  stage(stage: LoadStage, frac: number): number {
    const [a, b] = LOAD_STAGES[stage];
    return (this.p = Math.max(this.p, a + (b - a) * unit(frac)));
  }
  /** The load is ready. */
  complete(): number { return (this.p = 1); }
}

/** Where a load reports its progress (the loading screen's map). */
export interface LoadMeter {
  reset(): void;
  stage(stage: LoadStage, frac: number): void;
  complete(): void;
}

// ---------------------------------------------------------------------------------------------
// The drawing (fixed; a 60-unit grid, 45-degree bends)

const MUSTARD = '#d9a520', TEAL = '#4f8a87', RED = '#c2463a';
const BEND = 16;

/** A stretch of line, drawn from its first point over `from`..`to` of the load (no `from`: when an earlier stretch reaches that point). */
interface LineDef { color: string; pts: readonly Pt[]; from?: number; to: number }

const LINES: readonly LineDef[] = [
  {color: MUSTARD, pts: [[45, 165], [405, 165]], from: 0, to: 0.4}, // the trunk, west to the fork
  {color: TEAL, pts: [[165, 165], [165, 45]], to: 0.27},
  {color: TEAL, pts: [[165, 165], [165, 225], [225, 285], [405, 285]], to: 0.5},
  {color: MUSTARD, pts: [[405, 165], [465, 105], [645, 105]], to: 1}, // the fork's two branches end the load
  {color: MUSTARD, pts: [[405, 165], [465, 225], [645, 225]], to: 1},
  {color: RED, pts: [[405, 285], [550, 285], [585, 250], [585, 45]], to: 0.94},
];

export type StationKind = 'stop' | 'interchange' | 'terminus';

const STATIONS: readonly (readonly [number, number, StationKind])[] = [
  [45, 165, 'terminus'], [105, 165, 'stop'], [165, 165, 'interchange'], [225, 165, 'stop'], [285, 165, 'stop'], [345, 165, 'stop'], [405, 165, 'interchange'],
  [165, 105, 'stop'], [165, 45, 'terminus'], [285, 285, 'stop'], [345, 285, 'stop'], [405, 285, 'interchange'],
  [525, 105, 'stop'], [585, 105, 'interchange'], [645, 105, 'terminus'], [525, 225, 'stop'], [585, 225, 'interchange'], [645, 225, 'terminus'],
  [475, 285, 'stop'], [585, 165, 'stop'], [585, 45, 'terminus'],
];

const RADIUS: Readonly<Record<StationKind, number>> = {stop: 2.7, interchange: 8.5, terminus: 6.5};

interface Run { a: Pt; b: Pt; s: number }

/** The path through `pts` with its bends rounded (arcs of radius BEND); `runs` = its straights and the path length where each starts. */
function trace(pts: readonly Pt[]): {d: string; length: number; runs: Run[]} {
  const f = (v: number) => Math.round(v * 100) / 100;
  const runs: Run[] = [];
  let d = `M ${pts[0][0]} ${pts[0][1]}`, at: Pt = pts[0], length = 0;
  const lineTo = (b: Pt) => { runs.push({a: at, b, s: length}); length += Math.hypot(b[0] - at[0], b[1] - at[1]); d += ` L ${f(b[0])} ${f(b[1])}`; at = b; };
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], inLen = Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]), outLen = Math.hypot(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]);
    const u: Pt = [(p[0] - pts[i - 1][0]) / inLen, (p[1] - pts[i - 1][1]) / inLen], v: Pt = [(pts[i + 1][0] - p[0]) / outLen, (pts[i + 1][1] - p[1]) / outLen];
    const cross = u[0] * v[1] - u[1] * v[0], turn = Math.atan2(Math.abs(cross), u[0] * v[0] + u[1] * v[1]);
    const cut = BEND * Math.tan(turn / 2), b: Pt = [p[0] + v[0] * cut, p[1] + v[1] * cut];
    lineTo([p[0] - u[0] * cut, p[1] - u[1] * cut]);
    d += ` A ${BEND} ${BEND} 0 0 ${cross > 0 ? 1 : 0} ${f(b[0])} ${f(b[1])}`;
    length += BEND * turn;
    at = b;
  }
  lineTo(pts[pts.length - 1]);
  return {d, length, runs};
}

export interface MapLine { color: string; d: string; length: number; from: number; to: number }
export interface MapStation { x: number; y: number; kind: StationKind; color: string; lit: number }

/** The load progress at which the stretch `l` (its straights: `runs`) reaches the point (null: not on it). */
function reach(l: MapLine, runs: readonly Run[], [x, y]: Pt): number | null {
  for (const r of runs) {
    const dx = r.b[0] - r.a[0], dy = r.b[1] - r.a[1], len = Math.hypot(dx, dy);
    const t = len ? ((x - r.a[0]) * dx + (y - r.a[1]) * dy) / (len * len) : 0;
    if (t < -1e-6 || t > 1 + 1e-6 || Math.hypot(r.a[0] + dx * t - x, r.a[1] + dy * t - y) > 0.01) continue;
    const s = (r.s + len * t) / l.length;
    return s > 1 - 1e-9 ? l.to : l.from + (l.to - l.from) * s; // (a stretch's end is reached exactly at `to`)
  }
  return null;
}

function buildMap(): {viewBox: readonly [number, number, number, number]; lines: readonly MapLine[]; stations: readonly MapStation[]} {
  const lines: MapLine[] = [], runs: Run[][] = [];
  /** The stretch that reaches the point first, and when. */
  const first = (pt: Pt): {l: MapLine; at: number} => {
    let best: {l: MapLine; at: number} | null = null;
    for (let i = 0; i < lines.length; i++) { const at = reach(lines[i], runs[i], pt); if (at !== null && (!best || at < best.at)) best = {l: lines[i], at}; }
    if (!best) throw new Error(`loading map: nothing reaches ${pt[0]},${pt[1]}`);
    return best;
  };
  for (const def of LINES) {
    const t = trace(def.pts);
    lines.push({color: def.color, d: t.d, length: t.length, from: def.from ?? first(def.pts[0]).at, to: def.to});
    runs.push(t.runs);
  }
  const stations = STATIONS.map(([x, y, kind]): MapStation => { const r = first([x, y]); return {x, y, kind, color: r.l.color, lit: r.at}; });
  return {viewBox: [34, 34, 622, 262], lines, stations};
}

/** The fixed drawing: every stretch of line with its share of the load, every station mark with the progress that lights it. */
export const LOADING_MAP = buildMap();

export interface LoadingMapFrame {
  /** Per LOADING_MAP.lines: the fraction drawn (0..1). */
  lines: number[];
  /** Per LOADING_MAP.stations: lit. */
  stations: boolean[];
}

/** What the map shows at `progress` (0..1). Everything is drawn and lit at 1, and only at 1. */
export function loadingMapFrame(progress: number): LoadingMapFrame {
  const p = unit(progress);
  return {
    lines: LOADING_MAP.lines.map(l => (p >= l.to ? 1 : p <= l.from ? 0 : (p - l.from) / (l.to - l.from))),
    stations: LOADING_MAP.stations.map(s => p >= s.lit),
  };
}

const num = (v: number): string => String(Math.round(v * 100) / 100);
/** A stretch's inline style at `drawn` (hidden at 0: a round cap would leave a dot at its start). */
const lineStyle = (l: MapLine, drawn: number): {offset: string; visibility: string} => ({offset: num(l.length * (1 - drawn)), visibility: drawn > 0 ? 'visible' : 'hidden'});

/** The map's markup at `progress`: the unlit network, the coloured stretches drawn so far over it, the station marks on top. */
export function loadingMapSvg(progress = 0): string {
  const m = LOADING_MAP, f = loadingMapFrame(progress);
  const line = (l: MapLine, i: number) => {
    const st = lineStyle(l, f.lines[i]);
    return `<path class="lm-line" d="${l.d}" stroke="${l.color}" stroke-dasharray="${num(l.length)} ${num(l.length)}" style="stroke-dashoffset:${st.offset};visibility:${st.visibility}"/>`;
  };
  return `<svg class="lm" viewBox="${m.viewBox.join(' ')}" aria-hidden="true" focusable="false">`
    + `<g class="lm-ghost">${m.lines.map(l => `<path d="${l.d}"/>`).join('')}</g>`
    + `<g class="lm-lines">${m.lines.map(line).join('')}</g>`
    + `<g class="lm-stations">${m.stations.map((s, i) => `<circle class="lm-st lm-${s.kind}${f.stations[i] ? ' on' : ''}" cx="${s.x}" cy="${s.y}" r="${RADIUS[s.kind]}" style="color:${s.color}"/>`).join('')}</g>`
    + '</svg>';
}

// ---------------------------------------------------------------------------------------------
// The DOM view

/**
 * The loading screen: an opaque backdrop (never the canvas behind it), the place name, the map, the campaign's goal line. A short
 * window has no room under the card for the renderer badge (render/backend.ts), which the menu and the pause screen show anyway.
 */
export const LOADING_CSS = `
#title[data-mode="loading"].screen { background: radial-gradient(ellipse at 50% 44%, #121517 0%, #0c0e0f 62%, #090a0b 100%); backdrop-filter: none; }
#title[data-mode="loading"] #title-backdrop { display: none; }
.loading-card { position: relative; z-index: 1; margin: auto; width: min(100%, 112vh, clamp(680px, 46vw, 960px)); }
.loading-card .stripe { width: 72px; height: 6px; background: var(--mustard); }
.loading-card .loading-place { font-size: 30px; line-height: 1.15; margin: 14px 0 18px; overflow-wrap: anywhere; }
.loading-map .lm { display: block; width: 100%; height: auto; }
.lm-ghost path, .lm-line { fill: none; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.lm-ghost path { stroke: #272c30; }
.lm-line { transition: stroke-dashoffset 0.25s linear; }
.lm-st { transition: fill 0.2s ease-out, stroke 0.2s ease-out; }
.lm-stop { fill: #3a3f44; }
.lm-stop.on { fill: var(--cream); }
.lm-interchange, .lm-terminus { fill: #0c0e0f; stroke: #3a3f44; stroke-width: 3; }
.lm-interchange.on { stroke: var(--cream); }
.lm-terminus.on { stroke: currentColor; }
.loading-card .loading-goal { margin: 16px 0 0; font-size: 15px; font-weight: 400; letter-spacing: 0.04em; color: var(--cream-dim); }
.loading-card #load { margin: 0; }
.loading-card #load .label { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-height: 560px) { #title[data-mode="loading"] > .gpu-badge { display: none; } }
@media (prefers-reduced-motion: reduce) { .lm-line, .lm-st { transition: none; } }
`;

function injectCss(doc: Document): void {
  if (doc.getElementById('loading-map-css')) return;
  const st = doc.createElement('style');
  st.id = 'loading-map-css';
  st.textContent = LOADING_CSS;
  doc.head.appendChild(st);
}

/** The map in `host` (#loading-map), following one load at a time. */
export class LoadingMapView implements LoadMeter {
  private readonly progress = new LoadProgress();
  private readonly host: HTMLElement;
  private lines: SVGElement[] = [];
  private stations: Element[] = [];
  private shown = 0;

  constructor(host: HTMLElement, doc: Document = host.ownerDocument) {
    this.host = host;
    injectCss(doc);
    this.reset();
  }

  /** The overall progress shown (0..1). */
  get value(): number { return this.progress.value; }

  /** A new load: the empty map, redrawn (fresh elements, so the last load's lines do not animate away). */
  reset(): void {
    this.shown = this.progress.reset();
    this.host.innerHTML = loadingMapSvg(0);
    this.lines = [...this.host.querySelectorAll<SVGElement>('.lm-line')];
    this.stations = [...this.host.querySelectorAll('.lm-st')];
  }

  stage(stage: LoadStage, frac: number): void { this.draw(this.progress.stage(stage, frac)); }

  complete(): void { this.draw(this.progress.complete()); }

  private draw(p: number): void {
    if (p === this.shown) return;
    this.shown = p;
    const f = loadingMapFrame(p);
    this.lines.forEach((el, i) => { const st = lineStyle(LOADING_MAP.lines[i], f.lines[i]); el.style.strokeDashoffset = st.offset; el.style.visibility = st.visibility; });
    this.stations.forEach((el, i) => el.classList.toggle('on', f.stations[i]));
  }
}
