// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EXPO): the Expo event's own drawing — its canvas PAINTERS (the
// graphics its kinds' faces name: the keynote LED wall, booth headers / graphics / counter fronts, hanging booth signs, product and talk
// slides, the welcome / schedule / directory totems, the lectern's front). These are DYNAMIC canvas content (root CLAUDE.md: runtime-
// composited fictional names / slide text / schedule lines over simple code shapes — bars, rings, device outlines, a chart), drawn
// locally per placement variant from the fictional tables in gen/skyways/events/expoTypes.ts. Never presented as generated art. Every
// expo kind draws through the generic parts + faces of world/skywaysEventDraw.ts (drawExpoProp returns null).
//
// Variant codes (gen/skyways/events/expoDress.ts assigns them per seed):
//  - 'expo-led': nameIdx * EXPO_KEYNOTE_SLIDES + slide (0 keynote title "KEYNOTE · 10:00", 1 a growth chart, 2 the day's schedule);
//  - 'expo-header' / 'expo-graphic' / 'expo-counter' / 'expo-hang': the exhibitor index (EXPO_EXHIBITORS);
//  - 'expo-slide': < 100 the exhibitor's product slide, 100 + t a demo theatre's talk title slide (EXPO_TALKS), 200 + n the expo's info;
//  - 'expo-totem': kind * 16 + nameIdx (0 welcome, 1 schedule, 2 exhibitor directory, 3 demo theatre programme);
//  - 'expo-lectern': nameIdx.

import type * as THREE from 'three';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {EXPO_EXHIBITORS, EXPO_KEYNOTE_SLIDES, EXPO_NAMES, EXPO_TALKS} from '../gen/skyways/events/expoTypes';
import type {WorldMaterials} from './materials';
import type {EventPainter} from './skywaysEventDraw';

type Ctx = CanvasRenderingContext2D;
const mod = (v: number, n: number) => ((Math.floor(v) % n) + n) % n;
const nameOf = (n: number) => EXPO_NAMES[mod(n, EXPO_NAMES.length)];
const exOf = (e: number) => EXPO_EXHIBITORS[mod(e, EXPO_EXHIBITORS.length)];
const SANS = 'Helvetica, Arial, sans-serif';

/** Text shrunk to fit `maxW` (px), drawn at (x, y) with the given alignment. */
function fit(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, o: {weight?: string; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline} = {}): void {
  let s = size;
  ctx.font = `${o.weight ?? 'bold'} ${s}px ${SANS}`;
  while (s > 8 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${o.weight ?? 'bold'} ${s}px ${SANS}`; }
  ctx.fillStyle = o.color ?? '#ffffff';
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'middle';
  ctx.fillText(text, x, y);
}
function gradient(ctx: Ctx, w: number, h: number, a: string, b: string): void {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, a); g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
/** An exhibitor's simple geometric mark (rings / hexagon / chevrons / squares by index) in a box of size s centred at (x, y). */
function mark(ctx: Ctx, e: number, x: number, y: number, s: number, ink: string, bg: string): void {
  const k = mod(e, 7), r = s / 2;
  ctx.save();
  ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.beginPath();
  if (k === 0) { ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x + r * 0.25, y - r * 0.2, r * 0.42, 0, Math.PI * 2); ctx.fill(); }
  else if (k === 1) { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); } ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill(); }
  else if (k === 2) { for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - r * 0.8 + i * r * 0.55, y - r * 0.7); ctx.lineTo(x - r * 0.25 + i * r * 0.55, y); ctx.lineTo(x - r * 0.8 + i * r * 0.55, y + r * 0.7); ctx.stroke(); } }
  else if (k === 3) { ctx.fillRect(x - r * 0.85, y - r * 0.85, r * 0.8, r * 0.8); ctx.fillRect(x + r * 0.05, y + r * 0.05, r * 0.8, r * 0.8); ctx.strokeRect(x + r * 0.05, y - r * 0.85, r * 0.8, r * 0.8); }
  else if (k === 4) { for (const f of [0.9, 0.6, 0.3]) { ctx.beginPath(); ctx.arc(x, y, r * f, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke(); } }
  else if (k === 5) { ctx.moveTo(x, y - r * 0.9); ctx.lineTo(x + r * 0.9, y + r * 0.75); ctx.lineTo(x - r * 0.9, y + r * 0.75); ctx.closePath(); ctx.fill(); ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(x, y - r * 0.2); ctx.lineTo(x + r * 0.4, y + r * 0.5); ctx.lineTo(x - r * 0.4, y + r * 0.5); ctx.closePath(); ctx.fill(); }
  else { ctx.lineCap = 'round'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * r * 0.36, y + r * 0.8); ctx.lineTo(x + i * r * 0.36, y + r * 0.8 - r * (0.6 + 0.25 * (2 - Math.abs(i)))); ctx.stroke(); } }
  ctx.restore();
}
/** A simple device outline (phone / tablet / monitor / tower / server / gamepad) for the product slides. */
function device(ctx: Ctx, kind: number, x: number, y: number, s: number, ink: string): void {
  ctx.save();
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = Math.max(2, s * 0.03);
  const k = mod(kind, 6);
  if (k === 0) { rr(ctx, x - s * 0.22, y - s * 0.42, s * 0.44, s * 0.84, s * 0.06); ctx.stroke(); ctx.fillRect(x - s * 0.17, y - s * 0.34, s * 0.34, s * 0.62); }
  else if (k === 1) { rr(ctx, x - s * 0.45, y - s * 0.32, s * 0.9, s * 0.64, s * 0.05); ctx.stroke(); ctx.globalAlpha = 0.55; ctx.fillRect(x - s * 0.39, y - s * 0.26, s * 0.78, s * 0.52); }
  else if (k === 2) { ctx.strokeRect(x - s * 0.48, y - s * 0.36, s * 0.96, s * 0.56); ctx.fillRect(x - s * 0.06, y + s * 0.2, s * 0.12, s * 0.14); ctx.fillRect(x - s * 0.22, y + s * 0.34, s * 0.44, s * 0.04); }
  else if (k === 3) { for (let i = 0; i < 5; i++) { ctx.strokeRect(x - s * 0.3, y - s * 0.45 + i * s * 0.18, s * 0.6, s * 0.14); ctx.fillRect(x + s * 0.15, y - s * 0.41 + i * s * 0.18, s * 0.06, s * 0.06); } }
  else if (k === 4) { rr(ctx, x - s * 0.45, y - s * 0.2, s * 0.9, s * 0.4, s * 0.18); ctx.stroke(); ctx.beginPath(); ctx.arc(x - s * 0.25, y, s * 0.07, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + s * 0.25, y, s * 0.07, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.strokeRect(x - s * 0.2, y - s * 0.45, s * 0.4, s * 0.9); ctx.beginPath(); ctx.arc(x, y + s * 0.25, s * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - s * 0.12, y - s * 0.35, s * 0.24, s * 0.03); }
  ctx.restore();
}
/** A small bar chart of `n` rising bars (fictional numbers) in a box. */
function chart(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, ink: string, dim: string): void {
  ctx.save();
  ctx.strokeStyle = dim; ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(x, y + h - i * h / 4); ctx.lineTo(x + w, y + h - i * h / 4); ctx.stroke(); }
  const n = 6, bw = w / (n * 1.6);
  for (let i = 0; i < n; i++) {
    const v = 0.25 + 0.7 * ((i + 1) / n) * (0.8 + 0.2 * Math.sin(seed * 1.7 + i * 2.1));
    ctx.fillStyle = i === n - 1 ? ink : dim;
    ctx.fillRect(x + bw * 0.4 + i * bw * 1.6, y + h - v * h, bw, v * h);
  }
  ctx.restore();
}
function grid(ctx: Ctx, w: number, h: number, step: number, color: string): void {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The painters

/** The keynote LED wall: a title slide, a growth chart, the day's schedule (per seed: the expo's name). */
function drawLed(ctx: Ctx, w: number, h: number, v: number): void {
  const n = nameOf(Math.floor(v / EXPO_KEYNOTE_SLIDES)), slide = mod(v, EXPO_KEYNOTE_SLIDES);
  gradient(ctx, w, h, '#06142c', '#1b0b3a');
  grid(ctx, w, h, 48, 'rgba(80,140,255,0.10)');
  // a light band sweeping across (shapes only)
  ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#3fa9ff';
  ctx.beginPath(); ctx.moveTo(0, h * 0.78); ctx.bezierCurveTo(w * 0.3, h * 0.6, w * 0.6, h * 0.95, w, h * 0.7); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (slide === 0) {
    fit(ctx, n.name, w * 0.06, h * 0.2, w * 0.88, 92, {color: '#ffffff'});
    fit(ctx, 'KEYNOTE · 10:00', w * 0.06, h * 0.42, w * 0.7, 150, {color: '#ffd166'});
    fit(ctx, n.tag, w * 0.06, h * 0.6, w * 0.8, 64, {weight: 'normal', color: '#cfe3ff'});
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(w * (0.84 + i * 0.03), h * 0.44, h * (0.18 - i * 0.05), 0, Math.PI * 2); ctx.strokeStyle = ['#3fa9ff', '#ff5ea8', '#ffd166'][i]; ctx.lineWidth = 10; ctx.stroke(); }
  } else if (slide === 1) {
    fit(ctx, 'THE NEXT FIVE YEARS', w * 0.06, h * 0.14, w * 0.6, 84, {color: '#ffffff'});
    fit(ctx, `${n.short} · KEYNOTE`, w * 0.06, h * 0.26, w * 0.5, 44, {weight: 'normal', color: '#9fc4ff'});
    chart(ctx, w * 0.08, h * 0.36, w * 0.5, h * 0.46, v, '#ffd166', 'rgba(140,180,255,0.6)');
    for (const [k, t] of ['Faster devices', 'Greener racks', 'Open tools'].entries()) {
      ctx.fillStyle = ['#3fa9ff', '#ff5ea8', '#ffd166'][k]; ctx.fillRect(w * 0.64, h * (0.42 + k * 0.14) - 18, 36, 36);
      fit(ctx, t, w * 0.64 + 56, h * (0.42 + k * 0.14), w * 0.3, 54, {weight: 'normal', color: '#ffffff'});
    }
  } else {
    fit(ctx, `WELCOME TO ${n.name}`, w * 0.06, h * 0.14, w * 0.88, 76, {color: '#ffffff'});
    const rows = [['10:00', 'Keynote', 'Keynote hall'], ['11:30', 'Demo talks', 'Demo theatres'], ['13:00', 'Expo floor open', 'All booths'], ['16:00', 'Developer meetup', 'Developer lounge']];
    rows.forEach(([t, what, where], k) => {
      const y = h * (0.34 + k * 0.15);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(w * 0.06, y - h * 0.06, w * 0.88, h * 0.12);
      fit(ctx, t, w * 0.08, y, w * 0.14, 60, {color: '#ffd166'});
      fit(ctx, what, w * 0.24, y, w * 0.4, 60, {weight: 'normal', color: '#ffffff'});
      fit(ctx, where, w * 0.66, y, w * 0.26, 48, {weight: 'normal', color: '#9fc4ff'});
    });
  }
}

/** A booth's header fascia: the exhibitor's name and mark on its colour (a backlit lightbox). */
function drawHeader(ctx: Ctx, w: number, h: number, v: number): void {
  const e = exOf(v);
  ctx.fillStyle = e.color; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, h * 0.86, w, h * 0.14);
  mark(ctx, v, h * 0.62, h / 2, h * 0.72, e.ink, e.color);
  fit(ctx, e.name, h * 1.2, h * 0.5, w - h * 1.4, Math.round(h * 0.56), {color: e.ink});
}
/** A booth's back-wall graphic: the name, the tagline, a big device outline and a few feature bullets. */
function drawGraphic(ctx: Ctx, w: number, h: number, v: number): void {
  const e = exOf(v);
  gradient(ctx, w, h, '#f4f6f8', '#dfe5ea');
  ctx.fillStyle = e.color; ctx.fillRect(0, 0, w * 0.06, h);
  fit(ctx, e.name, w * 0.1, h * 0.16, w * 0.85, 64, {color: e.color});
  fit(ctx, e.tag, w * 0.1, h * 0.3, w * 0.85, 40, {weight: 'normal', color: '#30363c'});
  device(ctx, v, w * 0.3, h * 0.66, h * 0.5, e.color);
  for (const [k, t] of ['Live demos', 'Talk to our team', 'Expo pricing'].entries()) {
    ctx.fillStyle = e.color; ctx.beginPath(); ctx.arc(w * 0.58, h * (0.52 + k * 0.13), 9, 0, Math.PI * 2); ctx.fill();
    fit(ctx, t, w * 0.62, h * (0.52 + k * 0.13), w * 0.34, 34, {weight: 'normal', color: '#30363c'});
  }
}
/** A demo counter's front: the exhibitor's name band (variant >= 100: the expo's registration desk, 100 + nameIdx). */
function drawCounter(ctx: Ctx, w: number, h: number, v: number): void {
  if (v >= 100) {
    const n = nameOf(v - 100);
    gradient(ctx, w, h, '#0b1f3a', '#2a1150');
    ctx.fillStyle = '#ffd166'; ctx.fillRect(0, h * 0.84, w, h * 0.05);
    fit(ctx, 'REGISTRATION · BADGES', w * 0.04, h * 0.32, w * 0.92, Math.round(h * 0.34), {color: '#ffffff'});
    fit(ctx, n.name, w * 0.04, h * 0.66, w * 0.92, Math.round(h * 0.22), {weight: 'normal', color: '#9fc4ff'});
    return;
  }
  const e = exOf(v);
  ctx.fillStyle = e.color; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = e.ink; ctx.fillRect(0, h * 0.82, w, h * 0.06);
  mark(ctx, v, h * 0.55, h * 0.45, h * 0.6, e.ink, e.color);
  fit(ctx, e.name, h * 1.0, h * 0.45, w - h * 1.15, Math.round(h * 0.42), {color: e.ink});
}
/** A hanging booth sign (both faces): the exhibitor's name over a colour band. */
function drawHang(ctx: Ctx, w: number, h: number, v: number): void {
  const e = exOf(v);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = e.color; ctx.fillRect(0, h * 0.78, w, h * 0.22);
  mark(ctx, v, h * 0.45, h * 0.4, h * 0.56, e.color, '#ffffff');
  fit(ctx, e.name, h * 0.85, h * 0.4, w - h, Math.round(h * 0.42), {color: '#1a1d21'});
  fit(ctx, `BOOTH ${String.fromCharCode(65 + mod(v, 26))}${1 + mod(v * 7, 9)}`, w / 2, h * 0.89, w * 0.9, Math.round(h * 0.15), {color: '#ffffff', align: 'center'});
}
/** A screen's slide: an exhibitor's product, a demo theatre's talk title, or the expo's info. */
function drawSlide(ctx: Ctx, w: number, h: number, v: number): void {
  if (v >= 200) {
    const n = nameOf(v - 200);
    gradient(ctx, w, h, '#0b1f3a', '#2a1150');
    fit(ctx, n.name, w * 0.06, h * 0.22, w * 0.88, 70, {color: '#ffffff'});
    fit(ctx, n.tag, w * 0.06, h * 0.38, w * 0.88, 40, {weight: 'normal', color: '#cfe3ff'});
    fit(ctx, 'KEYNOTE 10:00 · DEMOS 11:30 · EXPO FLOOR 13:00', w * 0.06, h * 0.62, w * 0.88, 34, {color: '#ffd166'});
    return;
  }
  if (v >= 100) {
    const t = EXPO_TALKS[mod(v - 100, EXPO_TALKS.length)];
    gradient(ctx, w, h, '#101418', '#26313b');
    ctx.fillStyle = '#ffd166'; ctx.fillRect(w * 0.06, h * 0.2, w * 0.12, 8);
    fit(ctx, 'DEMO THEATRE · NOW', w * 0.06, h * 0.13, w * 0.6, 30, {color: '#ffd166'});
    fit(ctx, t.title, w * 0.06, h * 0.42, w * 0.88, 64, {color: '#ffffff'});
    fit(ctx, t.who, w * 0.06, h * 0.58, w * 0.6, 36, {weight: 'normal', color: '#a9c7e8'});
    chart(ctx, w * 0.62, h * 0.66, w * 0.3, h * 0.24, v, '#ffd166', 'rgba(169,199,232,0.5)');
    return;
  }
  const e = exOf(v);
  gradient(ctx, w, h, e.color, '#0c0f12');
  device(ctx, v, w * 0.72, h * 0.52, h * 0.62, e.ink);
  fit(ctx, e.name, w * 0.06, h * 0.18, w * 0.6, 48, {color: e.ink});
  fit(ctx, e.tag, w * 0.06, h * 0.34, w * 0.56, 34, {weight: 'normal', color: '#ffffff'});
  for (const [k, t] of ['Hands-on demo', 'Ask our engineers', 'Booth special'].entries()) fit(ctx, `· ${t}`, w * 0.06, h * (0.56 + k * 0.11), w * 0.5, 30, {weight: 'normal', color: '#e8eef4'});
}
/** A freestanding totem: welcome / schedule / exhibitor directory / demo theatre programme. */
function drawTotem(ctx: Ctx, w: number, h: number, v: number): void {
  const kind = mod(Math.floor(v / 16), 4), n = nameOf(v % 16);
  gradient(ctx, w, h, '#0b1f3a', '#2a1150');
  ctx.fillStyle = '#ffd166'; ctx.fillRect(0, h * 0.9, w, h * 0.02);
  fit(ctx, n.short, w * 0.08, h * 0.06, w * 0.84, 54, {color: '#9fc4ff'});
  if (kind === 0) {
    fit(ctx, 'WELCOME', w * 0.08, h * 0.2, w * 0.84, 96, {color: '#ffffff'});
    fit(ctx, n.name, w * 0.08, h * 0.3, w * 0.84, 40, {color: '#ffd166'});
    fit(ctx, n.tag, w * 0.08, h * 0.37, w * 0.84, 30, {weight: 'normal', color: '#cfe3ff'});
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(w * 0.5, h * 0.62, w * (0.3 - i * 0.08), 0, Math.PI * 2); ctx.strokeStyle = ['#3fa9ff', '#ff5ea8', '#ffd166'][i]; ctx.lineWidth = 12; ctx.stroke(); }
    fit(ctx, 'BADGES AT REGISTRATION', w / 2, h * 0.84, w * 0.84, 30, {color: '#ffffff', align: 'center'});
  } else if (kind === 1) {
    fit(ctx, 'TODAY', w * 0.08, h * 0.18, w * 0.84, 80, {color: '#ffffff'});
    [['10:00', 'Keynote'], ['11:30', 'Demo talks'], ['13:00', 'Expo floor'], ['15:00', 'Panel Q&A'], ['16:00', 'Dev meetup']].forEach(([t, what], k) => {
      const y = h * (0.3 + k * 0.11);
      fit(ctx, t, w * 0.08, y, w * 0.3, 40, {color: '#ffd166'});
      fit(ctx, what, w * 0.4, y, w * 0.54, 40, {weight: 'normal', color: '#ffffff'});
    });
  } else if (kind === 2) {
    fit(ctx, 'EXHIBITORS', w * 0.08, h * 0.17, w * 0.84, 64, {color: '#ffffff'});
    for (let k = 0; k < 8; k++) {
      const e = exOf(k * 2 + (v % 2)), y = h * (0.27 + k * 0.075);
      ctx.fillStyle = e.color; ctx.fillRect(w * 0.08, y - 12, 24, 24);
      fit(ctx, e.name, w * 0.08 + 36, y, w * 0.76, 28, {weight: 'normal', color: '#ffffff'});
    }
  } else {
    fit(ctx, 'DEMO THEATRES', w * 0.08, h * 0.17, w * 0.84, 56, {color: '#ffffff'});
    for (let k = 0; k < 4; k++) {
      const t = EXPO_TALKS[mod(v + k, EXPO_TALKS.length)], y = h * (0.3 + k * 0.14);
      fit(ctx, `${11 + k}:30`, w * 0.08, y, w * 0.3, 34, {color: '#ffd166'});
      fit(ctx, t.title, w * 0.08, y + 40, w * 0.84, 28, {weight: 'normal', color: '#ffffff'});
    }
  }
}
/** The lectern's front: the expo's mark and short name. */
function drawLectern(ctx: Ctx, w: number, h: number, v: number): void {
  const n = nameOf(v);
  ctx.fillStyle = '#101418'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(w / 2, h * 0.42, w * (0.3 - i * 0.08), 0, Math.PI * 2); ctx.strokeStyle = ['#3fa9ff', '#ff5ea8', '#ffd166'][i]; ctx.lineWidth = 10; ctx.stroke(); }
  fit(ctx, n.short, w / 2, h * 0.84, w * 0.86, 56, {color: '#ffffff', align: 'center'});
}

export const EXPO_PAINTERS: Readonly<Record<string, EventPainter>> = {
  'expo-led': {px: [1536, 768], draw: drawLed},
  'expo-header': {px: [1024, 128], draw: drawHeader},
  'expo-graphic': {px: [768, 512], draw: drawGraphic},
  'expo-counter': {px: [1024, 256], draw: drawCounter},
  'expo-hang': {px: [1024, 256], draw: drawHang},
  'expo-slide': {px: [1024, 576], draw: drawSlide},
  'expo-totem': {px: [512, 1024], draw: drawTotem},
  'expo-lectern': {px: [512, 512], draw: drawLectern},
};

/** Draws a kind this lane draws itself (returns its instance count), or null (the generic parts + faces). */
export function drawExpoProp(group: THREE.Group, kind: string, list: readonly PropPlacement[], wm: WorldMaterials, layout?: StationLayout): number | null {
  void group; void kind; void list; void wm; void layout;
  return null;
}
