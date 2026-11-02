// Task reactor-build-20261101 (lane RESTART): the in-world STATUS SCREENS of THE RESTART (layout.reactor.screens; ARCH frames them,
// world/reactor/restart.ts builds the textured planes). DYNAMIC content — state-driven canvas text / diagrams redrawn only when what
// they show changes (the standing art rule's dynamic exemption: runtime data, not authored artwork). Pure drawing on a 2D context
// (tests use the canvas shim):
//  - 'pitBoard' (rim): the pit section (tiers top-down, each zone's generator lamp + gas clearing from runState.generators /
//    zoneClear, the core at the bottom) and the four tasks KEY / POWER / COOLANT / RODS (✓ / READY / BLOCKED) + the next step;
//    after the restart: the SURFACE VENTILATION NETWORK view;
//  - 'switchgearBoard': fuse slots, main breaker, control power;  'pumpBoard': valve, power, pump, flow;
//  - 'controlMonitor': dark "NO CONTROL POWER" until the breaker closes, then the startup checklist; after the restart: the
//    SURFACE VENTILATION NETWORK (the pre-existing towers across the city receiving power one by one) + the canon status line.

import {REACTOR_FUSE_SLOTS, reactorTasks, type ReactorRunState, type ReactorTaskStatus} from './runState';
import {VENT_TOWERS, WIN_TEXT, type TowerState} from './restartWin';
import {JAM_TEXT} from '../../gen/reactor/gasJam'; // task reactor-playtest-round2-20261102 (lane GAS)

export type ReactorScreenId = 'pitBoard' | 'controlMonitor' | 'switchgearBoard' | 'pumpBoard';

/** What the screens show (the runtime fills it; arrays are reused). */
export interface ScreenModel {
  state: ReactorRunState;
  /** Tiers top-down (layout.reactor.tiers): label, painted colour, gas zone (-1 = clean). */
  tiers: readonly {label: string; color: number; zone: number}[];
  /** Per zone: its generator id. */
  zones: readonly {generator: number}[];
  /** Win time (s) since the rods were withdrawn; null = not restarted. */
  winT: number | null;
  /** The surface towers (restartWin VENT_TOWERS order). */
  towers: readonly TowerState[];
  /** Core output 0..1 (the glow ramp). */
  core: number;
  /** Pump spool 0..1. */
  pumpK: number;
  /** "Next: …" hint for the pit board (where to go next). */
  next: string;
  /**
   * Task reactor-playtest-round2-20261102 (lane GAS): the zone whose generator is JAMMED (gen/reactor/gasJam.ts; -1 / absent: none).
   * While it is not clear the pit board shows it red ("JAMMED · MASK") and the switchgear board warns before the core floor.
   */
  jamZone?: number;
}

/** (lane GAS) The jammed zone is still gassed (not cleared: the reactor is not online yet). */
export const jamGassed = (m: Pick<ScreenModel, 'state' | 'jamZone'>): boolean => (m.jamZone ?? -1) >= 0 && !m.state.restarted && (m.state.zoneClear[m.jamZone!] ?? 0) < 1;

/** Canvas size (px) of a screen of w x h metres: 512 wide (taller boards 512 tall at most). */
export function screenPixels(w: number, h: number): {pw: number; ph: number} {
  const pw = 512;
  const ph = Math.max(128, Math.min(512, Math.round(pw * (h > 0 && w > 0 ? h / w : 0.6))));
  return {pw, ph};
}

const STATUS_COLOR: Record<ReactorTaskStatus, string> = {done: '#63d36e', ready: '#e8b13a', blocked: '#c8473c'};
const STATUS_TEXT: Record<ReactorTaskStatus, string> = {done: '✓ DONE', ready: 'READY', blocked: 'BLOCKED'};
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

/**
 * Change key of a screen: the redraw happens only when it differs from the last drawn one (the runtime builds it only when the
 * restart state / AIR's record / the win step changed — never per frame).
 */
export function screenKey(id: ReactorScreenId, m: ScreenModel): string {
  const s = m.state;
  const base = `${s.fuses.map(Number).join('')}${+s.breaker}${+s.valve}${+s.pump}${+s.keyInserted}${+s.rods}${+s.restarted}`;
  const towers = m.winT === null ? '' : m.towers.map(t => t[0]).join('');
  switch (id) {
    case 'switchgearBoard': return `${base}|${+jamGassed(m)}`; // (lane GAS: + the jam warning)
    case 'pumpBoard': return `${base}|${Math.round(m.pumpK * 20)}`;
    case 'controlMonitor': return `${base}|${towers}|${m.winT === null ? '' : Math.round(m.core * 20)}`;
    case 'pitBoard': {
      const air = m.zones.map((z, i) => `${+(s.generators[z.generator]?.started ?? false)}${Math.round((s.zoneClear[i] ?? 0) * 10)}`).join('.');
      return `${base}|${towers}|${air}|${m.next}`;
    }
  }
}

type Ctx = CanvasRenderingContext2D;

const FONT = '"DejaVu Sans Mono", "Courier New", monospace';
/** Smallest font a screen text shrinks to (px). */
export const MIN_TEXT_PX = 9;

/**
 * Task reactor-expansion-20261101 (lane CONTROLS): AUTO-FIT (user feedback: 'instructions on the "Switchgear - control power" sign are
 * slightly cut off'): the font size (<= `size`, >= MIN_TEXT_PX) at which `s` is at most `maxW` px wide (measured, not guessed).
 */
export function fitSize(ctx: Ctx, s: string, size: number, maxW: number, weight = 'bold'): number {
  let px = Math.max(MIN_TEXT_PX, Math.round(size));
  if (!(maxW < Infinity)) return px;
  while (px > MIN_TEXT_PX) {
    ctx.font = `${weight} ${px}px ${FONT}`;
    if (ctx.measureText(s).width <= maxW) break;
    px--;
  }
  return px;
}

/** One line of text, shrunk to fit `maxW` px (default: no limit). */
function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 'bold', maxW = Infinity): void {
  const px = fitSize(ctx, s, size, maxW, weight);
  ctx.fillStyle = color;
  ctx.font = `${weight} ${px}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/**
 * An instruction line centred at (cx, y) inside `maxW` px: one line when it fits at >= 85 % of `size`, else word-wrapped into two
 * lines (each fitted) `lineH` px apart about y.
 */
function hint(ctx: Ctx, s: string, cx: number, y: number, size: number, color: string, maxW: number, lineH: number, weight = 'normal'): void {
  if (fitSize(ctx, s, size, maxW, weight) >= Math.round(size * 0.85) || !s.includes(' ')) { text(ctx, s, cx, y, size, color, 'center', weight, maxW); return; }
  const words = s.split(' ');
  let best = 1, bd = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < bd) { bd = d; best = i; }
  }
  const a = words.slice(0, best).join(' '), b = words.slice(best).join(' ');
  const px = Math.min(fitSize(ctx, a, size, maxW, weight), fitSize(ctx, b, size, maxW, weight));
  text(ctx, a, cx, y - lineH / 2, px, color, 'center', weight, maxW);
  text(ctx, b, cx, y + lineH / 2, px, color, 'center', weight, maxW);
}

function lamp(ctx: Ctx, x: number, y: number, r: number, color: string, lit: boolean): void {
  ctx.fillStyle = lit ? color : '#2a2f31';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if (lit) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill(); }
}

/** Painted enamel status board: dark slate field, a hazard-yellow header band with the title. */
function board(ctx: Ctx, w: number, h: number, title: string, band = '#d9a72b'): number {
  ctx.fillStyle = '#1a2024'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a4248'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
  const hh = Math.max(34, Math.round(h * 0.13));
  ctx.fillStyle = band; ctx.fillRect(4, 4, w - 8, hh);
  text(ctx, title, w / 2, 4 + hh / 2, Math.round(hh * 0.52), '#15181a', 'center', 'bold', w - 28);
  return 4 + hh;
}

/** Phosphor monitor: black glass, green text, scanlines. */
function monitor(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#050907'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(80,255,140,0.035)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2);
}

/** One status row: label left, a lamp + value right. */
function row(ctx: Ctx, w: number, y: number, size: number, label: string, value: string, color: string, lit = true): void {
  // label in the left 44 %, value in the right part before the lamp: one size for both, each fitted (never overlapping, never cut)
  const lw = w * 0.44 - 22, vw = w - 52 - w * 0.46;
  const px = Math.min(fitSize(ctx, label, size, lw), fitSize(ctx, value, size, vw));
  text(ctx, label, 22, y, px, '#d8d2c2', 'left', 'bold', lw);
  lamp(ctx, w - 30, y, size * 0.42, color, lit);
  text(ctx, value, w - 52, y, px, lit ? color : '#7c8284', 'right', 'bold', vw);
}

function towersView(ctx: Ctx, w: number, h: number, y0: number, m: ScreenModel, green: string, dim: string): void {
  const n = VENT_TOWERS.length, foot = Math.max(46, h * 0.2);
  const rowH = Math.max(18, (h - y0 - foot - 8) / n);
  const size = Math.max(12, Math.min(19, Math.round(rowH * 0.62)));
  for (let i = 0; i < n; i++) {
    const t = VENT_TOWERS[i], st = m.towers[i] ?? 'standby', y = y0 + 6 + rowH * (i + 0.5);
    const c = st === 'online' ? green : st === 'power' ? '#e8c34a' : dim;
    text(ctx, `VENT TOWER ${t.id} — ${t.name}`, 18, y, size, st === 'standby' ? dim : '#d6f5dc', 'left', 'bold', w * 0.52 - 18);
    text(ctx, st === 'online' ? 'FANS RUNNING' : st === 'power' ? 'POWER RECEIVED — FANS SPINNING UP' : 'STANDBY', w - 18, y, Math.round(size * 0.85), c, 'right', 'bold', w * 0.45 - 18);
  }
  const fy = h - foot + 6;
  ctx.fillStyle = 'rgba(99,211,110,0.12)'; ctx.fillRect(10, fy - 4, w - 20, foot - 12);
  text(ctx, WIN_TEXT.status, w / 2, fy + (foot - 12) * 0.3, Math.max(11, Math.round(size * 0.82)), green, 'center', 'bold', w - 28);
  text(ctx, WIN_TEXT.canon, w / 2, fy + (foot - 12) * 0.72, Math.max(10, Math.round(size * 0.74)), '#b9d8bf', 'center', 'normal', w - 28);
}

function drawPit(ctx: Ctx, w: number, h: number, m: ScreenModel): void {
  const s = m.state;
  if (s.restarted) {
    monitor(ctx, w, h);
    text(ctx, 'SURFACE VENTILATION NETWORK', w / 2, 24, 22, '#63d36e', 'center', 'bold', w - 28);
    text(ctx, 'PIT: ALL TIERS POWERED · CORE ONLINE', w / 2, 50, 14, '#9fd6a8', 'center', 'normal', w - 28);
    towersView(ctx, w, h, 62, m, '#63d36e', '#4b5a50');
    return;
  }
  const top = board(ctx, w, h, 'PIT STATUS — REACTOR RESTART');
  // --- the pit section (left): tiers top-down, generator lamp + gas clearing bar per zone, the core at the bottom ---
  const px = 14, pw = Math.round(w * 0.56), py0 = top + 10, py1 = h - 52;
  ctx.fillStyle = '#11161a'; ctx.fillRect(px, py0, pw, py1 - py0);
  const n = Math.max(1, m.tiers.length), step = (py1 - py0 - 34) / n;
  const size = Math.max(10, Math.min(16, Math.round(step * 0.5)));
  m.tiers.forEach((t, i) => {
    const y = py0 + 8 + step * (i + 0.5);
    ctx.fillStyle = hex(t.color); ctx.fillRect(px + 6, y - step * 0.32, 8, step * 0.64);
    text(ctx, t.label.toUpperCase(), px + 20, y, size, '#d8d2c2', 'left', 'bold', pw * 0.55 - 26);
    if (t.zone < 0) { text(ctx, 'CLEAN AIR', px + pw - 8, y, Math.round(size * 0.8), '#7fae86', 'right', 'normal', pw * 0.4); return; }
    const z = m.zones[t.zone], clear = Math.max(0, Math.min(1, s.zoneClear[t.zone] ?? 0));
    const bw = Math.round(pw * 0.3), bx = px + pw - 26 - bw;
    if (t.zone === m.jamZone && jamGassed(m)) { // (lane GAS) the jammed zone: red fault lamp + "JAMMED · MASK" over the bar
      lamp(ctx, px + pw - 14, y, size * 0.4, '#e0503c', true);
      text(ctx, JAM_TEXT.board, bx + bw, y, Math.round(size * 0.78), '#ff6a50', 'right', 'bold', bw + 12);
      return;
    }
    const on = !!(z && s.generators[z.generator]?.started);
    lamp(ctx, px + pw - 14, y, size * 0.4, '#63d36e', on);
    ctx.fillStyle = '#5a6b2a'; ctx.fillRect(bx, y - 4, bw, 8);
    ctx.fillStyle = '#9fd6a8'; ctx.fillRect(bx, y - 4, Math.round(bw * clear), 8);
  });
  // the core
  const cy = py1 - 16;
  ctx.fillStyle = s.rods ? '#7cf08a' : '#33493a';
  ctx.beginPath(); ctx.arc(px + pw / 2, cy + 8, 22, Math.PI, 0); ctx.fill();
  text(ctx, 'CORE', px + pw / 2, cy, 11, '#d8d2c2', 'center');
  // --- the tasks (right) ---
  const tasks = reactorTasks(s), tx = px + pw + 14;
  const items: [string, ReactorTaskStatus][] = [['STARTUP KEY', tasks.key], ['CONTROL POWER', tasks.power], ['COOLANT', tasks.coolant], ['CONTROL RODS', tasks.rods]];
  const th = (py1 - py0) / 4, ts = Math.max(11, Math.min(17, Math.round(th * 0.28)));
  items.forEach(([label, st], i) => {
    const y = py0 + th * i + th * 0.32;
    text(ctx, label, tx, y, ts, '#d8d2c2', 'left', 'bold', w - tx - 10);
    lamp(ctx, tx + 8, y + th * 0.34, ts * 0.42, STATUS_COLOR[st], true);
    text(ctx, STATUS_TEXT[st], tx + 22, y + th * 0.34, ts, STATUS_COLOR[st], 'left', 'bold', w - tx - 32);
  });
  const ns = Math.max(11, Math.min(16, Math.round(w / 34)));
  hint(ctx, m.next, w / 2, h - 26, ns, '#e8c34a', w - 24, ns * 1.15, 'bold');
}

function drawSwitchgear(ctx: Ctx, w: number, h: number, m: ScreenModel): void {
  const s = m.state, top = board(ctx, w, h, 'SWITCHGEAR — CONTROL POWER');
  const rows = REACTOR_FUSE_SLOTS + 3, rh = (h - top - 16) / rows, size = Math.max(12, Math.min(22, Math.round(rh * 0.42)));
  let y = top + rh * 0.6;
  for (let i = 0; i < REACTOR_FUSE_SLOTS; i++, y += rh) row(ctx, w, y, size, `FUSE ${i + 1}`, s.fuses[i] ? 'CARTRIDGE SEATED' : 'BURNT OUT — REPLACE', s.fuses[i] ? '#63d36e' : '#c8473c');
  row(ctx, w, y, size, 'MAIN BREAKER', s.breaker ? 'CLOSED' : 'OPEN', s.breaker ? '#63d36e' : '#e8b13a'); y += rh;
  row(ctx, w, y, size, 'CONTROL POWER', s.breaker ? 'ON' : 'OFF', s.breaker ? '#63d36e' : '#c8473c'); y += rh;
  const note = s.breaker ? (jamGassed(m) ? JAM_TEXT.switchgear : 'Control power on — the control room is live') : s.fuses.every(Boolean) ? 'Hold E on the main breaker to close it' : 'Fit two fuse cartridges, then close the main breaker'; // (lane GAS: + the jam warning)
  const hs = Math.max(11, Math.round(size * 0.78));
  hint(ctx, note, w / 2, y, hs, '#e8c34a', w - 28, hs * 1.15);
}

function drawPump(ctx: Ctx, w: number, h: number, m: ScreenModel): void {
  const s = m.state, top = board(ctx, w, h, 'PRIMARY COOLANT LOOP');
  const rh = (h - top - 16) / 5, size = Math.max(12, Math.min(22, Math.round(rh * 0.42)));
  let y = top + rh * 0.6;
  row(ctx, w, y, size, 'MAIN VALVE', s.valve ? 'OPEN' : 'SHUT', s.valve ? '#63d36e' : '#e8b13a'); y += rh;
  row(ctx, w, y, size, 'CONTROL POWER', s.breaker ? 'ON' : 'OFF', s.breaker ? '#63d36e' : '#c8473c'); y += rh;
  row(ctx, w, y, size, 'CIRCULATION PUMP', s.pump ? 'RUNNING' : 'STOPPED', s.pump ? '#63d36e' : '#c8473c'); y += rh;
  const flow = s.pump ? m.pumpK : 0;
  text(ctx, 'FLOW', 22, y, size, '#d8d2c2', 'left', 'bold', 92);
  const bx = 120, bw = w - bx - 70;
  ctx.fillStyle = '#2a2f31'; ctx.fillRect(bx, y - size * 0.4, bw, size * 0.8);
  ctx.fillStyle = '#5fb7d6'; ctx.fillRect(bx, y - size * 0.4, Math.round(bw * flow), size * 0.8);
  text(ctx, `${Math.round(flow * 100)} %`, w - 18, y, size, '#d8d2c2', 'right', 'bold', 48); y += rh;
  const note = s.pump ? 'Coolant flowing — the rod control can be armed' : !s.valve ? 'Hold E on the handwheel to open the main valve' : !s.breaker ? 'The pump needs control power (switchgear breaker)' : 'Press E on the pump station to start it';
  const hs = Math.max(11, Math.round(size * 0.78));
  hint(ctx, note, w / 2, y, hs, '#e8c34a', w - 28, hs * 1.15);
}

function drawControl(ctx: Ctx, w: number, h: number, m: ScreenModel): void {
  const s = m.state;
  monitor(ctx, w, h);
  if (!s.breaker) {
    text(ctx, 'NO CONTROL POWER', w / 2, h / 2 - 10, 24, '#24452c', 'center', 'bold', w - 28);
    text(ctx, 'standby — switchgear breaker open', w / 2, h / 2 + 18, 13, '#1d3423', 'center', 'normal', w - 28);
    return;
  }
  if (s.restarted) {
    text(ctx, 'SURFACE VENTILATION NETWORK', w / 2, 22, 21, '#63d36e', 'center', 'bold', w - 28);
    text(ctx, `CORE OUTPUT ${Math.round(m.core * 100)} % · RODS WITHDRAWN`, w / 2, 46, 14, '#9fd6a8', 'center', 'normal', w - 28);
    towersView(ctx, w, h, 58, m, '#63d36e', '#3f5245');
    return;
  }
  text(ctx, 'REACTOR CONTROL — STARTUP', w / 2, 24, 21, '#63d36e', 'center', 'bold', w - 28);
  const items: [string, string, boolean][] = [
    ['KEY SWITCH', s.keyInserted ? 'RUN' : 'OFF — NO KEY', s.keyInserted],
    ['CONTROL POWER', 'ON', true],
    ['COOLANT VALVE', s.valve ? 'OPEN' : 'SHUT', s.valve],
    ['CIRCULATION PUMP', s.pump ? 'RUNNING' : 'STOPPED', s.pump],
    ['CONTROL RODS', 'INSERTED', false],
  ];
  const rh = (h - 92) / items.length, size = Math.max(12, Math.min(19, Math.round(rh * 0.5)));
  items.forEach(([label, value, ok], i) => {
    const y = 52 + rh * (i + 0.5);
    const px = Math.min(fitSize(ctx, label, size, w * 0.5 - 22), fitSize(ctx, value, size, w * 0.46 - 22));
    text(ctx, label, 22, y, px, '#a8e6b4', 'left', 'bold', w * 0.5 - 22);
    text(ctx, value, w - 22, y, px, ok ? '#63d36e' : '#e8b13a', 'right', 'bold', w * 0.46 - 22);
  });
  const ready = s.keyInserted && s.pump, fs = Math.max(11, Math.round(size * 0.8));
  hint(ctx, ready ? '> HOLD E ON THE ROD CONTROL TO WITHDRAW THE RODS' : '> STARTUP INTERLOCK — SEE CHECKLIST', w / 2, h - 26, fs, ready ? '#e8c34a' : '#5f8f69', w - 28, fs * 1.1, 'bold');
}

/** Draws screen `id` for model `m` onto a w x h px context. */
export function drawReactorScreen(ctx: Ctx, id: ReactorScreenId, m: ScreenModel, w: number, h: number): void {
  ctx.save();
  switch (id) {
    case 'pitBoard': drawPit(ctx, w, h, m); break;
    case 'switchgearBoard': drawSwitchgear(ctx, w, h, m); break;
    case 'pumpBoard': drawPump(ctx, w, h, m); break;
    case 'controlMonitor': drawControl(ctx, w, h, m); break;
  }
  ctx.restore();
}
