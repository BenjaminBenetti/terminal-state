// Task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): the Bunker core's BIG SCREEN — DYNAMIC content (the standing art rule's
// exemption: state-driven runtime data drawn in code, like world/reactor/restartScreens.ts / mapBoard.ts; never authored artwork).
// Pure drawing on a 2D context (tests use the canvas shim); world/bunker/objectiveViews.ts uploads it as a self-lit CanvasTexture, and the
// [E] close-up (world/bunker/objective.ts) draws the same face larger.
//
//  - LOW POWER (fewer than all generators online): a dim amber diagnostic — "AUXILIARY POWER n/3", each generator's state and location,
//    the hint that each needs one fuel can and a turnkey start; a blinking cursor is its only motion.
//  - ALIVE (all online): the core display — the player's OWN map knowledge (known stations / track only: drawing it reveals nothing),
//    data pulses along it, a scan sweep, the intel panel (ready / the retrieved station / no network uplink) and activity bars.

import type {BunkerGenState, BunkerIntelKind} from './objectiveState';

/** Canvas size of the big screen (px; the face is 3.4 x 1.6 m). */
export const CORE_SCREEN_PX = {w: 768, h: 362} as const;

/** What the screen shows (filled by the runtime; the key decides a redraw). */
export interface CoreScreenModel {
  /** Generators in layout order: a letter ('A' ..), the location label, the state. */
  gens: readonly {letter: string; label: string; state: BunkerGenState}[];
  online: number;
  total: number;
  /** Every generator online. */
  alive: boolean;
  /** A campaign network to reach (false: a run without a network). */
  uplink: boolean;
  /** The claim (null: not yet). `head` / `line`: objectiveState.bunkerIntelText. */
  intel: {kind: BunkerIntelKind; head: string; line: string} | null;
  /** The player's known stations (map units) / known track (index pairs) / the intel station's index (-1 none). */
  map: {nodes: readonly {x: number; y: number}[]; edges: readonly (readonly [number, number])[]; hi: number} | null;
}

type Ctx = CanvasRenderingContext2D;
const FONT = '"DejaVu Sans Mono", "Courier New", monospace';
const MIN_PX = 9;

const STATE_TEXT: Record<BunkerGenState, string> = {off: 'OFFLINE — NO FUEL', fuelled: 'FUELLED — NOT STARTED', online: 'ONLINE'};
const STATE_COLOR: Record<BunkerGenState, string> = {off: '#d0503c', fuelled: '#e8b13a', online: '#63d36e'};

/** The redraw key: the state, plus the animation frame `frame` (the caller quantises time; low power only blinks). */
export function coreScreenKey(m: CoreScreenModel, frame: number): string {
  const g = m.gens.map(x => x.state[0]).join('');
  const i = m.intel ? `${m.intel.kind}:${m.intel.line}` : '-';
  const map = m.map ? `${m.map.nodes.length}/${m.map.edges.length}/${m.map.hi}` : '-';
  return `${g}|${+m.alive}|${+m.uplink}|${i}|${map}|${m.alive ? frame : frame & 1}`;
}

function fit(ctx: Ctx, s: string, size: number, maxW: number, weight: string): number {
  let px = Math.max(MIN_PX, Math.round(size));
  while (px > MIN_PX) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(s).width <= maxW) break;
    px--;
  }
  return px;
}

function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 'bold', maxW = Infinity): void {
  const px = maxW < Infinity ? fit(ctx, s, size, maxW, weight) : Math.round(size);
  ctx.fillStyle = color;
  ctx.font = `${weight} ${px}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function lamp(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function glass(ctx: Ctx, w: number, h: number, tint: string): void {
  ctx.fillStyle = '#040706'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = tint;
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
}

function lowPower(ctx: Ctx, w: number, h: number, m: CoreScreenModel, frame: number): void {
  glass(ctx, w, h, 'rgba(255,180,80,0.03)');
  const amber = '#d9a13a', dim = '#7a6436';
  text(ctx, 'CENTRAL PROCESSING CORE — LOW POWER', 22, 26, 22, amber, 'left', 'bold', w - 44);
  text(ctx, `AUXILIARY POWER ${m.online}/${m.total}`, 22, 58, 20, m.online ? '#e8c34a' : '#c8473c', 'left', 'bold', w * 0.6);
  ctx.fillStyle = dim; ctx.fillRect(22, 76, w - 44, 2);
  const rows = Math.max(1, m.gens.length), top = 92, bottom = h - 86, rh = Math.min(48, (bottom - top) / rows);
  m.gens.forEach((g, i) => {
    const y = top + rh * (i + 0.5);
    lamp(ctx, 34, y, 8, STATE_COLOR[g.state]);
    text(ctx, `GEN ${g.letter}`, 52, y, 18, '#e6d8b8', 'left', 'bold', 90);
    text(ctx, g.label.toUpperCase(), 140, y, 16, '#bfae88', 'left', 'normal', w * 0.5 - 140);
    text(ctx, STATE_TEXT[g.state], w - 22, y, 17, STATE_COLOR[g.state], 'right', 'bold', w * 0.5 - 30);
  });
  ctx.fillStyle = dim; ctx.fillRect(22, h - 78, w - 44, 2);
  text(ctx, 'Each auxiliary generator needs ONE fuel can poured in,', w / 2, h - 58, 16, amber, 'center', 'normal', w - 44);
  text(ctx, 'then hold [E] at its key switch to start it. All three: core online.', w / 2, h - 36, 16, amber, 'center', 'normal', w - 44);
  if (m.intel) text(ctx, `MAP INTEL RETRIEVED: ${m.intel.line.toUpperCase()}`, w / 2, h - 13, 13, '#9fd6a8', 'center', 'bold', w - 44);
  else if ((frame & 1) === 0) { ctx.fillStyle = amber; ctx.fillRect(w - 40, 16, 14, 20); } // the blinking cursor
}

function alive(ctx: Ctx, w: number, h: number, m: CoreScreenModel, frame: number): void {
  glass(ctx, w, h, 'rgba(80,255,140,0.035)');
  const green = '#63d36e', pale = '#b9e8c2', dim = '#2f5a3a';
  const t = frame / 4; // seconds (the runtime animates at 4 frames / s)
  text(ctx, 'CENTRAL PROCESSING CORE — ONLINE', 22, 24, 21, green, 'left', 'bold', w * 0.66);
  text(ctx, `AUX ${m.online}/${m.total}`, w - 22, 24, 18, green, 'right', 'bold', w * 0.3);
  ctx.fillStyle = dim; ctx.fillRect(16, 42, w - 32, 2);
  // --- the network display (left): the player's known stations and track only ---
  const px = 16, py = 52, pw = Math.round(w * 0.58), ph = h - py - 46;
  ctx.fillStyle = '#07120b'; ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#163222'; ctx.lineWidth = 1;
  for (let gx = px + 24; gx < px + pw; gx += 32) { ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx, py + ph); ctx.stroke(); }
  for (let gy = py + 18; gy < py + ph; gy += 32) { ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px + pw, gy); ctx.stroke(); }
  const map = m.map;
  if (map && map.nodes.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of map.nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    const sx = (pw - 40) / Math.max(1, x1 - x0), sy = (ph - 40) / Math.max(1, y1 - y0), s = Math.min(sx, sy);
    const ox = px + pw / 2 - ((x0 + x1) / 2) * s, oy = py + ph / 2 - ((y0 + y1) / 2) * s;
    const P = (i: number): [number, number] => [ox + map.nodes[i].x * s, oy + map.nodes[i].y * s];
    ctx.strokeStyle = '#3f8f55'; ctx.lineWidth = 2;
    for (const [a, b] of map.edges) { const [ax, ay] = P(a), [bx, by] = P(b); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    // data pulses running along the track
    ctx.fillStyle = '#c8ffd4';
    map.edges.forEach(([a, b], k) => {
      const f = (t * 0.5 + k * 0.37) % 1, [ax, ay] = P(a), [bx, by] = P(b);
      ctx.fillRect(ax + (bx - ax) * f - 2, ay + (by - ay) * f - 2, 4, 4);
    });
    for (let i = 0; i < map.nodes.length; i++) { const [x, y] = P(i); lamp(ctx, x, y, 4, i === map.hi ? '#ffe28a' : green); }
    if (map.hi >= 0 && map.hi < map.nodes.length) {
      const [x, y] = P(map.hi), r = 9 + 5 * ((t * 1.5) % 1);
      ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
  } else text(ctx, 'NO NETWORK UPLINK', px + pw / 2, py + ph / 2, 20, '#5f8f69', 'center', 'bold', pw - 20);
  // the scan sweep
  const sweep = px + ((t * 0.35) % 1) * pw;
  ctx.fillStyle = 'rgba(120,255,160,0.10)'; ctx.fillRect(sweep - 10, py, 20, ph);
  ctx.fillStyle = 'rgba(160,255,190,0.35)'; ctx.fillRect(sweep, py, 2, ph);
  // --- the intel panel (right) ---
  const ix = px + pw + 16, iw = w - ix - 16;
  text(ctx, 'MAP INTEL', ix, py + 14, 18, pale, 'left', 'bold', iw);
  ctx.fillStyle = dim; ctx.fillRect(ix, py + 30, iw, 2);
  if (!m.uplink) {
    text(ctx, 'NO NETWORK UPLINK', ix, py + 60, 17, '#e8b13a', 'left', 'bold', iw);
    text(ctx, 'The core cannot reach', ix, py + 88, 14, pale, 'left', 'normal', iw);
    text(ctx, 'a station network.', ix, py + 108, 14, pale, 'left', 'normal', iw);
  } else if (m.intel) {
    text(ctx, m.intel.head, ix, py + 60, 17, '#ffe28a', 'left', 'bold', iw);
    text(ctx, m.intel.line, ix, py + 90, 15, pale, 'left', 'normal', iw);
    text(ctx, m.intel.kind === 'charted' ? 'Nothing new to add.' : 'Marked on your map.', ix, py + 116, 14, green, 'left', 'normal', iw);
  } else {
    text(ctx, 'DATA READY', ix, py + 60, 18, '#ffe28a', 'left', 'bold', iw);
    text(ctx, 'Press [E] at the console', ix, py + 90, 14, pale, 'left', 'normal', iw);
    text(ctx, 'to retrieve map intel.', ix, py + 110, 14, pale, 'left', 'normal', iw);
  }
  m.gens.forEach((g, i) => { const y = py + ph - 18 - (m.gens.length - 1 - i) * 22; lamp(ctx, ix + 7, y, 6, STATE_COLOR[g.state]); text(ctx, `GEN ${g.letter} ${STATE_TEXT[g.state]}`, ix + 20, y, 13, pale, 'left', 'bold', iw - 20); });
  // activity bars along the foot
  const by = h - 30, n = 24, bw = (w - 32) / n;
  for (let i = 0; i < n; i++) {
    const v = 0.25 + 0.75 * Math.abs(Math.sin(t * 2.3 + i * 1.7) * Math.cos(t * 0.9 + i * 0.6));
    ctx.fillStyle = i % 5 === 0 ? '#e8c34a' : '#3fbf66';
    ctx.fillRect(16 + i * bw + 2, by + 22 - 20 * v, bw - 4, 20 * v);
  }
}

/** Draws the face for `m` at animation frame `frame` onto a w x h px context. */
export function drawCoreScreen(ctx: Ctx, m: CoreScreenModel, w: number, h: number, frame: number): void {
  ctx.save();
  if (m.alive) alive(ctx, w, h, m, frame);
  else lowPower(ctx, w, h, m, frame);
  ctx.restore();
}
