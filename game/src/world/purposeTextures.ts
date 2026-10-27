// Materials for the iteration-05 purpose props (gen/purposeShapes.ts PURPOSE_MAT_KEYS) and the
// per-cuisine backlit menu boards (gen/purposes.ts MenuSpec). Everything is drawn procedurally on
// canvases (fictional goods and words only: no real brands, logos or photos), lazily on first
// use, and shared by every instance. Face-mapped graphics (one picture per box face from the
// mesh's 0..1 UVs): stock rows, magazines, screens, CCTV, notice board, key blanks, flowers,
// bread, donuts, pizza boxes, fruit, warning labels, first-aid plate. World-mapped (metre scale,
// materials.ts shader hook): paint colours, vinyl, cardboard. "Maintained neglect": dust,
// grime toward the bottom, looted gaps in the stock rows.

import * as THREE from 'three';
import type {MenuSpec} from '../gen/purposes';
import type {PurposeMat} from '../gen/purposeShapes';
import {canvasTexture} from './canvasTextures';
import {surfaceMaterial, worldMapped} from './materials';

type Ctx = CanvasRenderingContext2D;
type R = () => number;

const SANS = '"Helvetica Neue", Arial, sans-serif';
const rr = (r: R, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: R, l: readonly T[]): T => l[Math.floor(r() * l.length) % l.length];

const textures = new Set<THREE.Texture>();
const materials = new Map<string, THREE.Material>();

function faceTex(w: number, h: number, seed: number, draw: (ctx: Ctx, w: number, h: number, r: R) => void): THREE.CanvasTexture {
  const t = canvasTexture(w, h, seed, draw);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  textures.add(t);
  return t;
}

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------
// Drawing helpers

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, rad: number): void {
  const k = Math.max(0, Math.min(rad, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}
function fillR(ctx: Ctx, x: number, y: number, w: number, h: number, rad: number, color: string): void {
  rrect(ctx, x, y, w, h, rad);
  ctx.fillStyle = color;
  ctx.fill();
}
function soft(ctx: Ctx, x: number, y: number, rad: number, rgb: string, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}
function text(ctx: Ctx, s: string, x: number, y: number, maxW: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 'bold'): void {
  let px = Math.max(6, Math.round(size));
  ctx.font = `${weight} ${px}px ${SANS}`;
  while (ctx.measureText(s).width > maxW && px > 6) { px -= 1; ctx.font = `${weight} ${px}px ${SANS}`; }
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
/** Vertical sheen across a package (plastic/foil). */
function sheen(ctx: Ctx, x: number, y: number, w: number, h: number, a = 0.2): void {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, `rgba(0,0,0,${a * 0.8})`);
  g.addColorStop(0.3, `rgba(255,255,255,${a})`);
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}
/** Shared wear: grime toward the bottom, soft dark patches, dust specks. */
function wear(ctx: Ctx, w: number, h: number, r: R, k = 1): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(40,34,26,${0.04 * k})`);
  g.addColorStop(0.75, `rgba(40,34,26,${0.08 * k})`);
  g.addColorStop(1, `rgba(30,25,20,${0.32 * k})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) soft(ctx, rr(r, 0, w), rr(r, 0, h), rr(r, w * 0.04, w * 0.18), '42,36,28', rr(r, 0.06, 0.18) * k);
  for (let i = 0, n = Math.round(w * h / 1400 * k); i < n; i++) {
    ctx.fillStyle = r() < 0.6 ? 'rgba(205,195,175,0.22)' : 'rgba(30,26,22,0.35)';
    const s = rr(r, 0.6, 2);
    ctx.fillRect(rr(r, 0, w), rr(r, 0, h), s, s);
  }
}
function barcode(ctx: Ctx, x: number, y: number, w: number, h: number, r: R): void {
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#1b1b1b';
  for (let bx = x + 3; bx < x + w - 3; bx += rr(r, 2, 4)) ctx.fillRect(bx, y + 2, rr(r, 0.8, 2), h - 6);
}

// ---------------------------------------------------------------------------------------
// Stock rows (one shelf row of packaged goods per theme, ~3.6:1)

/** Draws one product standing on `base` at `x`; returns the width it used. */
type Product = (ctx: Ctx, r: R, x: number, base: number, H: number) => number;

const BRIGHT = ['#d8322a', '#f0b429', '#2f6fd0', '#3a9a48', '#8a3ab0', '#e86a1a', '#1d9aa8'];

const chipBag: Product = (ctx, r, x, base, H) => {
  const bw = H * rr(r, 0.5, 0.62), bh = H * rr(r, 0.78, 0.95), top = base - bh, col = pick(r, BRIGHT);
  fillR(ctx, x, top + 8, bw, bh - 8, 12, col);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x + 4, top + 12);
  for (let i = 0, n = 8; i <= n; i++) ctx.lineTo(x + 4 + (bw - 8) * i / n, top + (i % 2 ? 0 : 8));
  ctx.lineTo(x + bw - 4, top + 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4eee0';
  ctx.beginPath(); ctx.ellipse(x + bw / 2, top + bh * 0.38, bw * 0.4, bh * 0.13, -0.08, 0, Math.PI * 2); ctx.fill();
  text(ctx, pick(r, ['CRUNCH', 'KETTLE', 'SALTY', 'ZESTY', 'RIPPLES', 'SNAX']), x + bw / 2, top + bh * 0.38, bw * 0.7, bh * 0.12, col);
  ctx.fillStyle = '#e8c060';
  ctx.beginPath(); ctx.ellipse(x + bw / 2, top + bh * 0.7, bw * 0.28, bh * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(160,110,40,0.6)'; ctx.fillRect(x + bw / 2 + rr(r, -bw * 0.2, bw * 0.2), top + bh * 0.7 + rr(r, -bh * 0.06, bh * 0.06), 4, 3); }
  sheen(ctx, x, top, bw, bh, 0.18);
  return bw;
};

const candyBoxes: Product = (ctx, r, x, base, H) => {
  const bw = H * 0.55, row = H * 0.22;
  for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) {
    const col = pick(r, ['#5a2e1e', '#b8302a', '#6a2a8a', '#d9a520', '#2a4f8a']);
    const bx = x + j * (bw / 2), by = base - (k + 1) * row;
    fillR(ctx, bx + 1, by + 1, bw / 2 - 3, row - 3, 3, col);
    ctx.fillStyle = 'rgba(245,238,220,0.85)';
    ctx.fillRect(bx + 4, by + row * 0.35, bw / 2 - 9, row * 0.25);
    text(ctx, pick(r, ['CHOCO', 'NUTTY', 'CARAMEL', 'MINTS', 'GUM']), bx + bw / 4, by + row * 0.48, bw / 2 - 12, row * 0.2, col);
  }
  sheen(ctx, x, base - 3 * row, bw, 3 * row, 0.12);
  return bw;
};

const canStack: Product = (ctx, r, x, base, H) => {
  const cw = H * 0.26, ch = H * 0.36, col = pick(r, ['#b8302a', '#2f6f3a', '#d98a1a', '#2a4f8a', '#8a2a2a']);
  const word = pick(r, ['BEANS', 'SOUP', 'CORN', 'TOMATO', 'CHILI', 'PEAS']);
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) {
    const cx = x + j * (cw + 2), cy = base - (k + 1) * ch;
    fillR(ctx, cx, cy, cw, ch, 4, '#a8acae');
    ctx.fillStyle = col;
    ctx.fillRect(cx, cy + ch * 0.14, cw, ch * 0.72);
    ctx.fillStyle = '#f2ead6';
    ctx.fillRect(cx, cy + ch * 0.36, cw, ch * 0.24);
    text(ctx, word, cx + cw / 2, cy + ch * 0.48, cw * 0.86, ch * 0.16, col);
    sheen(ctx, cx, cy, cw, ch, 0.22);
  }
  return cw * 2 + 2;
};

const cereal: Product = (ctx, r, x, base, H) => {
  const bw = H * rr(r, 0.5, 0.6), bh = H * rr(r, 0.85, 0.97), top = base - bh, col = pick(r, ['#d9a520', '#c0392b', '#2f6fd0', '#3a9a48', '#e86a1a']);
  ctx.fillStyle = col; ctx.fillRect(x, top, bw, bh);
  ctx.fillStyle = '#f4eee0'; ctx.fillRect(x, top + bh * 0.06, bw, bh * 0.2);
  text(ctx, pick(r, ['OATY', 'FLAKES', 'CRISPS', 'HONEY O\'S', 'BRAN']), x + bw / 2, top + bh * 0.16, bw * 0.86, bh * 0.12, col);
  ctx.fillStyle = '#f4eee0'; ctx.beginPath(); ctx.ellipse(x + bw / 2, top + bh * 0.66, bw * 0.34, bh * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 10; i++) { ctx.fillStyle = '#d9a35a'; ctx.beginPath(); ctx.ellipse(x + bw / 2 + rr(r, -bw * 0.25, bw * 0.25), top + bh * 0.6 + rr(r, -bh * 0.03, bh * 0.03), 5, 3, r(), 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + bw - 4, top, 4, bh);
  return bw;
};

const paperTowels: Product = (ctx, r, x, base, H) => {
  const w = H * 0.28, h = H * 0.85;
  for (let j = 0; j < 2; j++) {
    const cx = x + j * (w + 1);
    fillR(ctx, cx, base - h, w, h, 8, '#ecebe6');
    for (let i = 0; i < 14; i++) { ctx.fillStyle = 'rgba(90,140,200,0.35)'; ctx.fillRect(cx + rr(r, 4, w - 8), base - h + rr(r, 6, h - 6), 4, 4); }
    sheen(ctx, cx, base - h, w, h, 0.12);
  }
  ctx.fillStyle = 'rgba(120,170,220,0.55)'; ctx.fillRect(x, base - h * 0.62, w * 2 + 1, h * 0.2);
  text(ctx, '2 ROLLS', x + w, base - h * 0.52, w * 1.8, h * 0.1, '#1d3a6a');
  return w * 2 + 1;
};

const medBoxes: Product = (ctx, r, x, base, H) => {
  const bw = H * rr(r, 0.45, 0.55);
  let y = base;
  for (let k = 0, n = 2 + Math.floor(r() * 2); k < n; k++) {
    const bh = H * rr(r, 0.26, 0.32), band = pick(r, ['#2f6fd0', '#1d9aa8', '#e86a1a', '#3a9a48', '#b8302a']);
    y -= bh;
    ctx.fillStyle = '#f4f4f0'; ctx.fillRect(x, y, bw, bh - 2);
    ctx.fillStyle = band; ctx.fillRect(x, y + bh * 0.08, bw, bh * 0.3);
    ctx.fillStyle = '#f4f4f0'; ctx.fillRect(x + bh * 0.1, y + bh * 0.13, bh * 0.2, bh * 0.06); ctx.fillRect(x + bh * 0.17, y + bh * 0.1, bh * 0.06, bh * 0.2);
    text(ctx, pick(r, ['PAIN RELIEF', 'COLD + FLU', 'ALLERGY', 'ANTACID', 'VITAMIN C', 'COUGH']), x + bw * 0.58, y + bh * 0.23, bw * 0.66, bh * 0.16, '#f4f4f0');
    ctx.fillStyle = '#5a5f66'; ctx.fillRect(x + 6, y + bh * 0.55, bw * 0.6, 3); ctx.fillRect(x + 6, y + bh * 0.68, bw * 0.4, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + bw - 3, y, 3, bh - 2);
  }
  return bw;
};

const pillBottles: Product = (ctx, r, x, base, H) => {
  const w = H * 0.16, h = H * 0.38;
  for (let j = 0; j < 3; j++) {
    const cx = x + j * (w + 3), amber = r() < 0.5;
    fillR(ctx, cx, base - h, w, h * 0.82, 5, amber ? '#b8742a' : '#f2f0ea');
    fillR(ctx, cx - 1, base - h - h * 0.02, w + 2, h * 0.22, 3, amber ? '#f2f0ea' : '#2f6fd0');
    ctx.fillStyle = '#f8f6ee'; ctx.fillRect(cx + 2, base - h * 0.58, w - 4, h * 0.3);
    ctx.fillStyle = '#5a5f66'; ctx.fillRect(cx + 4, base - h * 0.5, w - 8, 2);
    sheen(ctx, cx, base - h, w, h, 0.2);
  }
  return 3 * w + 6;
};

const bandageBox: Product = (ctx, r, x, base, H) => {
  const bw = H * 0.45, bh = H * rr(r, 0.45, 0.55);
  ctx.fillStyle = '#e8dcc4'; ctx.fillRect(x, base - bh, bw, bh);
  ctx.fillStyle = '#b8302a'; ctx.fillRect(x, base - bh * 0.85, bw, bh * 0.16);
  text(ctx, 'BANDAGES', x + bw / 2, base - bh * 0.77, bw * 0.86, bh * 0.1, '#f4eee0');
  ctx.fillStyle = '#d9b48a'; fillR(ctx, x + bw * 0.2, base - bh * 0.5, bw * 0.6, bh * 0.16, 8, '#d9b48a');
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + bw - 3, base - bh, 3, bh);
  return bw;
};

const spray: Product = (ctx, r, x, base, H) => {
  const w = H * 0.24, h = H * 0.75, col = pick(r, ['#2f6fd0', '#3a9a48', '#e8d040', '#f2f0ea', '#d8322a']);
  fillR(ctx, x, base - h * 0.78, w, h * 0.78, 8, col);
  ctx.fillStyle = col; ctx.fillRect(x + w * 0.3, base - h * 0.86, w * 0.4, h * 0.1);
  fillR(ctx, x + w * 0.1, base - h, w * 0.75, h * 0.16, 4, '#2a2c30');
  ctx.fillStyle = '#2a2c30'; ctx.fillRect(x + w * 0.8, base - h * 0.97, w * 0.2, h * 0.04); ctx.fillRect(x + w * 0.3, base - h * 0.86, w * 0.12, h * 0.12);
  ctx.fillStyle = '#f8f6ee'; ctx.fillRect(x + 3, base - h * 0.55, w - 6, h * 0.25);
  text(ctx, pick(r, ['GLASS', 'CLEAN', 'DISINFECT', 'DEGREASE']), x + w / 2, base - h * 0.43, w * 0.86, h * 0.07, '#1d3a6a');
  sheen(ctx, x, base - h, w, h, 0.18);
  return w + 4;
};

const jug: Product = (ctx, r, x, base, H) => {
  const w = H * 0.4, h = H * 0.72, col = pick(r, ['#f2f0ea', '#d9e4ee', '#e8d040']);
  fillR(ctx, x, base - h * 0.88, w, h * 0.88, 10, col);
  fillR(ctx, x + w * 0.55, base - h * 0.84, w * 0.3, h * 0.18, 6, 'rgba(20,20,20,0.6)');
  fillR(ctx, x + w * 0.12, base - h, w * 0.3, h * 0.14, 3, pick(r, ['#2f6fd0', '#d8322a', '#3a9a48']));
  ctx.fillStyle = '#2f6fd0'; ctx.fillRect(x + 4, base - h * 0.5, w - 8, h * 0.28);
  text(ctx, pick(r, ['BLEACH', 'FLOOR', 'AMMONIA', 'CLEANER']), x + w / 2, base - h * 0.36, w * 0.86, h * 0.09, '#f8f6ee');
  sheen(ctx, x, base - h, w, h, 0.15);
  return w + 3;
};

const toiletRolls: Product = (ctx, _r, x, base, H) => {
  const w = H * 0.3, h = H * 0.3;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) fillR(ctx, x + j * (w + 1), base - (k + 1) * h, w, h - 1, 6, '#f2f1ec');
  ctx.fillStyle = 'rgba(190,210,235,0.35)'; ctx.fillRect(x, base - 2 * h, w * 2 + 1, h * 2);
  ctx.fillStyle = '#2f6fd0'; ctx.fillRect(x, base - h * 1.25, w * 2 + 1, h * 0.4);
  text(ctx, '12 ROLLS', x + w, base - h * 1.05, w * 1.8, h * 0.25, '#f8f6ee');
  return w * 2 + 2;
};

const deviceBox: Product = (ctx, r, x, base, H) => {
  const bw = H * rr(r, 0.4, 0.5), bh = H * rr(r, 0.55, 0.7), dark = r() < 0.5, top = base - bh;
  ctx.fillStyle = dark ? '#1a1c20' : '#ecebe8'; ctx.fillRect(x, top, bw, bh);
  fillR(ctx, x + bw * 0.25, top + bh * 0.12, bw * 0.5, bh * 0.66, 8, '#101216');
  const g = ctx.createLinearGradient(x, top, x + bw, top + bh);
  g.addColorStop(0, pick(r, ['#2f6fd0', '#8a3ab0', '#1d9aa8', '#e86a1a'])); g.addColorStop(1, '#101830');
  ctx.fillStyle = g; ctx.fillRect(x + bw * 0.28, top + bh * 0.15, bw * 0.44, bh * 0.6);
  text(ctx, pick(r, ['SMART 5G', 'TABLET 10"', 'SMARTWATCH', 'PHONE LITE']), x + bw / 2, top + bh * 0.88, bw * 0.86, bh * 0.08, dark ? '#e8e8e8' : '#1a1c20');
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x + bw - 3, top, 3, bh);
  return bw + 2;
};

const blisterPegs: Product = (ctx, r, x, base, H) => {
  const cw = H * 0.3, ch = H * 0.5, peg = base - H * 0.95;
  ctx.fillStyle = '#9aa0a6'; ctx.fillRect(x, peg, cw * 2 + 8, 3);
  for (let j = 0; j < 2; j++) {
    const cx = x + j * (cw + 8), col = pick(r, ['#1d9aa8', '#2a2c30', '#d8322a', '#8a3ab0', '#f0b429']);
    ctx.fillStyle = col; ctx.fillRect(cx, peg + 2, cw, ch);
    ctx.fillStyle = '#101216'; ctx.fillRect(cx + cw / 2 - 6, peg + 6, 12, 5);
    text(ctx, pick(r, ['EARBUDS', 'USB-C', 'CHARGER', 'POWER BANK', 'CASE', 'CABLE 2M']), cx + cw / 2, peg + ch * 0.2, cw * 0.86, ch * 0.09, '#f4f4f0');
    fillR(ctx, cx + cw * 0.15, peg + ch * 0.32, cw * 0.7, ch * 0.58, 10, 'rgba(225,235,240,0.55)');
    ctx.fillStyle = '#f4f4f0'; ctx.beginPath(); ctx.ellipse(cx + cw / 2, peg + ch * 0.62, cw * 0.18, ch * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  }
  return cw * 2 + 10;
};

const carton: Product = (ctx, r, x, base, H) => {
  const bw = H * rr(r, 0.9, 1.4), bh = H * rr(r, 0.75, 0.98), top = base - bh;
  ctx.fillStyle = pick(r, ['#a67a48', '#9c7044', '#b08452']); ctx.fillRect(x, top, bw, bh);
  ctx.fillStyle = 'rgba(60,40,20,0.25)'; ctx.fillRect(x, top, bw, 5); ctx.fillRect(x + bw - 5, top, 5, bh);
  ctx.fillStyle = 'rgba(214,190,140,0.85)'; ctx.fillRect(x, top + bh * 0.06, bw, bh * 0.1);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, top + bh * 0.07, bw, bh * 0.02);
  text(ctx, pick(r, ['THIS SIDE UP', 'FRAGILE', 'KEEP DRY', 'HANDLE WITH CARE', 'LOT 4471', '24 x 500 ML']), x + bw * 0.42, top + bh * 0.36, bw * 0.7, bh * 0.1, 'rgba(25,20,15,0.85)');
  text(ctx, '↑ ↑', x + bw * 0.42, top + bh * 0.52, bw * 0.4, bh * 0.14, 'rgba(25,20,15,0.8)');
  barcode(ctx, x + bw * 0.62, top + bh * 0.6, bw * 0.3, bh * 0.22, r);
  return bw + 3;
};

const tubeBoxes: Product = (ctx, r, x, base, H) => {
  const w = H * 1.5, h = H * 0.16;
  for (let k = 0; k < 4; k++) {
    const y = base - (k + 1) * h;
    ctx.fillStyle = '#ecebe6'; ctx.fillRect(x + rr(r, 0, 6), y, w, h - 2);
    ctx.fillStyle = '#3a9a48'; ctx.fillRect(x, y + h * 0.15, w * 0.25, h * 0.6);
    text(ctx, 'T8 LAMPS · 4 FT', x + w * 0.6, y + h * 0.45, w * 0.6, h * 0.5, '#2a2c30');
  }
  return w + 6;
};

const cableReel: Product = (ctx, r, x, base, H) => {
  const d = H * 0.7, col = pick(r, ['#d9732a', '#2f5f9a', '#3a9a48']);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + d / 2, base - d / 2, d / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(x + d / 2, base - d / 2, d * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(x + d / 2, base - d / 2, d * 0.08, 0, Math.PI * 2); ctx.fill();
  text(ctx, 'CAT6 · 305 M', x + d / 2, base - d * 0.72, d * 0.6, d * 0.08, '#f4f4f0');
  return d + 4;
};

const paintCans: Product = (ctx, r, x, base, H) => {
  const w = H * 0.3, h = H * 0.36;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) {
    const cx = x + j * (w + 2), cy = base - (k + 1) * h;
    fillR(ctx, cx, cy, w, h - 2, 3, '#9ea3a8');
    ctx.fillStyle = pick(r, ['#f2f0ea', '#2f5f9a', '#d9a520']); ctx.fillRect(cx, cy + h * 0.3, w, h * 0.4);
    text(ctx, pick(r, ['PRIMER', 'SAFETY YELLOW', 'GREY ENAMEL']), cx + w / 2, cy + h * 0.5, w * 0.86, h * 0.13, '#2a2c30');
    sheen(ctx, cx, cy, w, h, 0.2);
  }
  return w * 2 + 4;
};

const STOCK: Record<string, {products: Product[]; bg: [string, string]; gap: number}> = {
  stockSnacks: {products: [chipBag, chipBag, candyBoxes, chipBag, candyBoxes], bg: ['#1e1c19', '#2c2925'], gap: 0.08},
  stockGrocery: {products: [canStack, cereal, paperTowels, canStack, cereal, chipBag], bg: ['#1e1c19', '#2c2925'], gap: 0.08},
  stockPharmacy: {products: [medBoxes, pillBottles, medBoxes, bandageBox, medBoxes], bg: ['#20232a', '#2e3238'], gap: 0.1},
  stockCleaning: {products: [spray, jug, spray, toiletRolls, jug, spray], bg: ['#1c1d1e', '#2a2b2c'], gap: 0.06},
  stockDevices: {products: [deviceBox, blisterPegs, deviceBox, blisterPegs, deviceBox], bg: ['#24262a', '#33363b'], gap: 0.1},
  stockCartons: {products: [carton], bg: ['#15130f', '#221e19'], gap: 0.04},
  stockParts: {products: [tubeBoxes, cableReel, paintCans, carton, paintCans], bg: ['#17181a', '#25262a'], gap: 0.06},
};

function stockTexture(key: string, seed: number): THREE.CanvasTexture {
  const spec = STOCK[key];
  return faceTex(1024, 288, seed, (ctx, w, h, r) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, spec.bg[0]); g.addColorStop(1, spec.bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const base = h - 4, H = h - 14;
    let x = 4;
    while (x < w - 10) {
      if (r() < spec.gap) {
        // Looted gap: dust outline and a lonely price tag.
        const gw = rr(r, 40, 110);
        ctx.fillStyle = 'rgba(160,150,130,0.12)'; ctx.fillRect(x, base - 6, gw, 6);
        ctx.fillStyle = '#e8e2c8'; ctx.fillRect(x + gw * 0.3, base - 18, 34, 14);
        text(ctx, `${Math.floor(rr(r, 1, 9))}.${Math.floor(rr(r, 10, 99))}`, x + gw * 0.3 + 17, base - 11, 30, 10, '#2a2522');
        x += gw;
        continue;
      }
      x += pick(r, spec.products)(ctx, r, x, base, H) + rr(r, 2, 8);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, w, 10);
    wear(ctx, w, h, r, 0.8);
  });
}

// ---------------------------------------------------------------------------------------
// Other graphics

function magazinesTexture(): THREE.CanvasTexture {
  return faceTex(1024, 240, 5101, (ctx, w, h, r) => {
    ctx.fillStyle = '#26282b'; ctx.fillRect(0, 0, w, h);
    let x = 6;
    while (x < w - 20) {
      if (r() < 0.08) { x += rr(r, 50, 90); continue; }
      const cw = rr(r, 84, 104), ch = h - rr(r, 14, 26), top = h - ch - 4;
      const bgc = pick(r, ['#c0392b', '#f2efe6', '#1d3a6a', '#d9a520', '#2a2c30', '#3a9a48', '#e86a8a', '#8a3ab0']);
      const light = bgc === '#f2efe6' || bgc === '#d9a520';
      ctx.fillStyle = bgc; ctx.fillRect(x, top, cw, ch);
      // Cover photo: a soft figure or a car/house silhouette.
      soft(ctx, x + cw / 2, top + ch * 0.6, cw * 0.55, light ? '120,100,80' : '230,220,200', 0.35);
      ctx.fillStyle = pick(r, ['#c9956a', '#8a5a3a', '#e0b896', '#5a3a2a']);
      ctx.beginPath(); ctx.ellipse(x + cw / 2, top + ch * 0.5, cw * 0.16, ch * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pick(r, ['#2a2c30', '#b8302a', '#2f6fd0', '#f2f0ea']);
      fillR(ctx, x + cw * 0.18, top + ch * 0.64, cw * 0.64, ch * 0.4, 14, ctx.fillStyle as string);
      text(ctx, pick(r, ['METRO', 'WEEKLY', 'AUTO', 'STYLE', 'SCORE', 'TRAVEL', 'HOME', 'TECH', 'GAMES', 'PUZZLES', 'CITY']), x + cw / 2, top + ch * 0.12, cw * 0.92, ch * 0.16, light ? '#b8302a' : '#f8f4ea');
      for (let i = 0; i < 3; i++) { ctx.fillStyle = light ? 'rgba(30,30,30,0.7)' : 'rgba(250,245,235,0.8)'; ctx.fillRect(x + 6, top + ch * (0.26 + i * 0.06), rr(r, cw * 0.3, cw * 0.6), 4); }
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, top, cw * 0.25, ch);
      x += cw + rr(r, 3, 10);
    }
    wear(ctx, w, h, r, 0.7);
  });
}

function deviceScreenTexture(): THREE.CanvasTexture {
  return faceTex(256, 384, 5102, (ctx, w, h, r) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1d3a6a'); g.addColorStop(0.6, '#3a1d5a'); g.addColorStop(1, '#0e1420');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    text(ctx, '4:12', w / 2, h * 0.14, w * 0.6, 44, '#f4f4f8', 'center', '300');
    text(ctx, 'NO SERVICE', w / 2, h * 0.22, w * 0.6, 12, 'rgba(240,240,250,0.7)');
    const cols = 4, s = w / cols;
    for (let i = 0; i < 12; i++) {
      const cx = (i % cols) * s + s * 0.18, cy = h * 0.32 + Math.floor(i / cols) * s * 1.05;
      fillR(ctx, cx, cy, s * 0.64, s * 0.64, 10, pick(r, ['#e86a1a', '#3a9a48', '#2f6fd0', '#d8322a', '#f0b429', '#1d9aa8', '#f4f4f8']));
    }
    fillR(ctx, w * 0.06, h * 0.86, w * 0.88, h * 0.1, 16, 'rgba(255,255,255,0.18)');
    ctx.strokeStyle = 'rgba(230,240,255,0.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(w, h * 0.7); ctx.lineTo(w * 0.7, h * 0.78); ctx.lineTo(w * 0.55, h * 0.95); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, 0, w * 0.35, h);
  });
}

function cctvTexture(): THREE.CanvasTexture {
  return faceTex(512, 384, 5103, (ctx, w, h, r) => {
    ctx.fillStyle = '#0a0c0d'; ctx.fillRect(0, 0, w, h);
    const names = ['CAM 01 PLATFORM', 'CAM 04 CONCOURSE', 'CAM 07 FARE LINE', 'CAM 12 FOOD COURT'];
    for (let q = 0; q < 4; q++) {
      const x0 = (q % 2) * w / 2 + 3, y0 = Math.floor(q / 2) * h / 2 + 3, fw = w / 2 - 6, fh = h / 2 - 6;
      if (q === 3) {
        ctx.fillStyle = '#10204a'; ctx.fillRect(x0, y0, fw, fh);
        text(ctx, 'NO SIGNAL', x0 + fw / 2, y0 + fh / 2, fw * 0.7, 22, '#d8e0f0');
        continue;
      }
      const g = ctx.createLinearGradient(0, y0, 0, y0 + fh);
      g.addColorStop(0, '#4a4f50'); g.addColorStop(1, '#202425');
      ctx.fillStyle = g; ctx.fillRect(x0, y0, fw, fh);
      // Corridor perspective: floor, walls and ceiling lights toward a vanishing point.
      const vx = x0 + fw * rr(r, 0.35, 0.65), vy = y0 + fh * 0.42;
      ctx.strokeStyle = 'rgba(200,205,200,0.45)'; ctx.lineWidth = 1.5;
      for (const [ex, ey] of [[x0, y0 + fh], [x0 + fw, y0 + fh], [x0, y0], [x0 + fw, y0]]) { ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(ex, ey); ctx.stroke(); }
      for (let i = 1; i < 5; i++) { const t = i / 5; ctx.fillStyle = 'rgba(230,235,225,0.55)'; ctx.fillRect(vx - 3 + (x0 + fw / 2 - vx) * t * 0.2, vy - fh * 0.4 * t, 6 + 14 * t, 2 + 3 * t); }
      if (r() < 0.7) { ctx.fillStyle = 'rgba(20,20,20,0.8)'; const px = vx + rr(r, -40, 40), py = vy + 20; ctx.fillRect(px, py, 6, 18); ctx.beginPath(); ctx.arc(px + 3, py - 3, 4, 0, Math.PI * 2); ctx.fill(); }
      for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},0.12)`; ctx.fillRect(x0 + r() * fw, y0 + r() * fh, 1.5, 1.5); }
      text(ctx, names[q], x0 + 6, y0 + 12, fw - 12, 11, '#e8ece0', 'left');
      text(ctx, `10-26 03:1${q}:${String(Math.floor(rr(r, 10, 59)))}`, x0 + fw - 6, y0 + fh - 10, fw * 0.6, 11, '#e8ece0', 'right');
      ctx.fillStyle = '#d8322a'; ctx.beginPath(); ctx.arc(x0 + fw - 12, y0 + 12, 4, 0, Math.PI * 2); ctx.fill();
    }
    for (let y = 0; y < h; y += 3) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, y, w, 1); }
  });
}

function noticeBoardTexture(): THREE.CanvasTexture {
  return faceTex(512, 384, 5104, (ctx, w, h, r) => {
    ctx.fillStyle = '#ad8656'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = pick(r, ['#8a6640', '#c49a66', '#6e4e30', '#d2aa78']); ctx.fillRect(r() * w, r() * h, rr(r, 1, 3), rr(r, 1, 3)); }
    const notes: [string, string][] = [['SHIFT ROSTER', '#f4f1e8'], ['SAFETY FIRST', '#f0e070'], ['STAFF MEETING', '#f4f1e8'], ['NO SMOKING', '#f2c0c8'], ['LOST & FOUND', '#c8e0f0'], ['OVERTIME SIGN-UP', '#f4f1e8'], ['UNION NOTICE', '#e0f0c0']];
    for (let i = 0; i < 9; i++) {
      const [title, col] = pick(r, notes);
      const pw = rr(r, 90, 150), ph = rr(r, 100, 170), px = rr(r, 8, w - pw - 8), py = rr(r, 8, h - ph - 8);
      ctx.save(); ctx.translate(px + pw / 2, py + ph / 2); ctx.rotate(rr(r, -0.12, 0.12));
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-pw / 2 + 3, -ph / 2 + 4, pw, ph);
      ctx.fillStyle = col; ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      text(ctx, title, 0, -ph / 2 + 16, pw - 12, 13, '#2a2522');
      for (let l = 0; l < 6; l++) { ctx.fillStyle = 'rgba(40,40,45,0.55)'; ctx.fillRect(-pw / 2 + 8, -ph / 2 + 32 + l * 13, rr(r, pw * 0.4, pw - 16), 3); }
      ctx.fillStyle = pick(r, ['#d8322a', '#2f6fd0', '#3a9a48', '#f0b429']); ctx.beginPath(); ctx.arc(0, -ph / 2 + 5, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    wear(ctx, w, h, r, 0.8);
  });
}

function keyBlanksTexture(): THREE.CanvasTexture {
  return faceTex(512, 320, 5105, (ctx, w, h, r) => {
    ctx.fillStyle = '#c9b48a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(60,45,30,0.55)';
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
    for (let row = 0; row < 6; row++) {
      const y = 22 + row * 50;
      for (let col = 0; col < 10; col++) {
        const x = 18 + col * 49;
        ctx.fillStyle = '#7a7f84'; ctx.fillRect(x - 1, y - 6, 3, 14);
        if (r() < 0.15) continue;
        for (let k = 0; k < 3; k++) {
          const brass = r() < 0.6, kx = x + k * 2.5 - 3;
          ctx.fillStyle = brass ? '#c9a64a' : '#c0c4c8';
          ctx.beginPath(); ctx.arc(kx + 1, y + 12, 7, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(kx - 2, y + 17, 6, 22);
          ctx.fillStyle = 'rgba(40,30,20,0.6)'; ctx.beginPath(); ctx.arc(kx + 1, y + 10, 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = brass ? '#b08f3a' : '#a8acb0';
          for (let n = 0; n < 4; n++) ctx.fillRect(kx + 3, y + 22 + n * 4, 2, 2);
        }
      }
    }
    text(ctx, 'KEYS CUT WHILE U WAIT', w / 2, h - 10, w * 0.7, 13, '#5a2a1a');
    wear(ctx, w, h, r, 0.7);
  });
}

function flowersTexture(): THREE.CanvasTexture {
  return faceTex(256, 256, 5106, (ctx, w, h, r) => {
    ctx.fillStyle = '#25381f'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { ctx.fillStyle = pick(r, ['#3a5a2a', '#4a6e34', '#2e4a24']); ctx.beginPath(); ctx.ellipse(r() * w, r() * h, rr(r, 6, 14), rr(r, 3, 6), r() * Math.PI, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 46; i++) {
      const x = r() * w, y = r() * h, s = rr(r, 7, 15), wilt = r() < 0.18;
      const col = wilt ? '#6a4a30' : pick(r, ['#d8322a', '#e86a8a', '#f0d040', '#f4f0e8', '#8a3ab0', '#e8862a']);
      for (let p = 0; p < 6; p++) { const a = p / 6 * Math.PI * 2; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5, s * 0.45, s * 0.3, a, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = wilt ? '#3a2a1a' : '#f0c040'; ctx.beginPath(); ctx.arc(x, y, s * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    wear(ctx, w, h, r, 0.5);
  });
}

function breadTexture(): THREE.CanvasTexture {
  return faceTex(512, 128, 5107, (ctx, w, h, r) => {
    ctx.fillStyle = '#3a3c3e'; ctx.fillRect(0, 0, w, h);
    let x = 4;
    while (x < w - 20) {
      if (r() < 0.15) { x += rr(r, 30, 60); continue; }
      const long = r() < 0.35, lw = long ? rr(r, 110, 150) : rr(r, 60, 80), lh = long ? 40 : rr(r, 56, 76);
      ctx.fillStyle = pick(r, ['#b8763a', '#a8662a', '#c98a4a', '#8a5226']);
      ctx.beginPath(); ctx.ellipse(x + lw / 2, h - lh / 2 - 6, lw / 2, lh / 2, 0, 0, Math.PI * 2); ctx.fill();
      soft(ctx, x + lw * 0.4, h - lh * 0.7 - 6, lw * 0.3, '240,200,140', 0.4);
      ctx.strokeStyle = 'rgba(240,215,170,0.8)'; ctx.lineWidth = 3;
      for (let s = 0; s < (long ? 4 : 2); s++) { const sx = x + lw * (0.25 + s * (long ? 0.17 : 0.3)); ctx.beginPath(); ctx.moveTo(sx, h - lh * 0.75 - 6); ctx.lineTo(sx + 10, h - lh * 0.3 - 6); ctx.stroke(); }
      x += lw + rr(r, 4, 10);
    }
    wear(ctx, w, h, r, 0.6);
  });
}

function donutsTexture(): THREE.CanvasTexture {
  return faceTex(512, 128, 5108, (ctx, w, h, r) => {
    ctx.fillStyle = '#e8e2d4'; ctx.fillRect(0, 0, w, h);
    let x = 8;
    while (x < w - 30) {
      if (r() < 0.2) { x += rr(r, 40, 70); continue; }
      const d = rr(r, 54, 64), cx = x + d / 2, cy = h / 2 + rr(r, -6, 6);
      ctx.fillStyle = '#c98a4a'; ctx.beginPath(); ctx.ellipse(cx, cy, d / 2, d * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pick(r, ['#5a2e1e', '#f0a0c0', '#f4f0e8', '#e8c060', '#c98a4a']); ctx.beginPath(); ctx.ellipse(cx, cy - 2, d * 0.42, d * 0.34, 0, 0, Math.PI * 2); ctx.fill();
      for (let s = 0; s < 10; s++) { ctx.fillStyle = pick(r, ['#d8322a', '#2f6fd0', '#f0d040', '#3a9a48']); ctx.fillRect(cx + rr(r, -d * 0.3, d * 0.3), cy + rr(r, -d * 0.25, d * 0.2), 4, 2); }
      ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.ellipse(cx, cy - 2, d * 0.1, d * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      x += d + rr(r, 4, 10);
    }
    wear(ctx, w, h, r, 0.5);
  });
}

function pizzaBoxTexture(): THREE.CanvasTexture {
  return faceTex(256, 256, 5109, (ctx, w, h, r) => {
    ctx.fillStyle = '#e8e0cc'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b8302a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.32, 0, Math.PI * 2); ctx.stroke();
    text(ctx, 'PIZZA', w / 2, h * 0.46, w * 0.5, 38, '#b8302a');
    text(ctx, 'HOT · FRESH', w / 2, h * 0.6, w * 0.45, 16, '#2a6a3a');
    soft(ctx, rr(r, 40, 200), rr(r, 40, 200), 36, '150,110,50', 0.35);
    ctx.strokeStyle = 'rgba(120,100,70,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(6, 6, w - 12, h - 12);
    wear(ctx, w, h, r, 0.5);
  });
}

function fruitTexture(): THREE.CanvasTexture {
  return faceTex(256, 256, 5110, (ctx, w, h, r) => {
    ctx.fillStyle = '#5a7a3a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = r() * w, y = r() * h, s = rr(r, 16, 24);
      ctx.fillStyle = pick(r, ['#f08a1c', '#f08a1c', '#d8322a', '#9ac040', '#f0d040']);
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      soft(ctx, x - s * 0.35, y - s * 0.35, s * 0.6, '255,250,230', 0.35);
    }
    wear(ctx, w, h, r, 0.5);
  });
}

function hazardTexture(): THREE.CanvasTexture {
  return faceTex(256, 192, 5111, (ctx, w, h, r) => {
    ctx.fillStyle = '#f2efe6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c62828'; ctx.fillRect(0, 0, w, 44);
    text(ctx, 'DANGER', w / 2, 23, w * 0.8, 30, '#f8f4ea');
    ctx.fillStyle = '#f0c020'; ctx.beginPath(); ctx.moveTo(50, 60); ctx.lineTo(88, 128); ctx.lineTo(12, 128); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.moveTo(54, 74); ctx.lineTo(40, 100); ctx.lineTo(52, 100); ctx.lineTo(44, 120); ctx.lineTo(62, 92); ctx.lineTo(50, 92); ctx.closePath(); ctx.fill();
    text(ctx, 'HIGH VOLTAGE', 170, 80, 150, 20, '#1a1a1a');
    text(ctx, 'AUTHORIZED', 170, 104, 150, 14, '#1a1a1a', 'center', 'normal');
    text(ctx, 'PERSONNEL ONLY', 170, 122, 150, 14, '#1a1a1a', 'center', 'normal');
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 146, w, 2);
    text(ctx, `PANEL LP-${Math.floor(rr(r, 1, 9))}${pick(r, ['A', 'B', 'C'])} · 600 V`, w / 2, 170, w * 0.8, 16, '#1a1a1a');
    wear(ctx, w, h, r, 0.9);
  });
}

function firstAidTexture(): THREE.CanvasTexture {
  return faceTex(256, 96, 5112, (ctx, w, h, r) => {
    ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2e8a4a'; ctx.fillRect(12, 12, 72, 72);
    ctx.fillStyle = '#f4f2ec'; ctx.fillRect(40, 22, 16, 52); ctx.fillRect(22, 40, 52, 16);
    text(ctx, 'FIRST AID', 170, h / 2, 150, 30, '#2e8a4a');
    wear(ctx, w, h, r, 0.5);
  });
}

/** Kraft cardboard for world mapping (one repeat = 0.6 m): fibres, flutes, faint marker. */
function cardboardTexture(): THREE.CanvasTexture {
  const t = canvasTexture(512, 512, 5113, (ctx, w, h, r) => {
    ctx.fillStyle = '#a67a48'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { ctx.fillStyle = pick(r, ['#b4885a', '#94683a', '#a2764a', '#bb9466']); ctx.fillRect(r() * w, r() * h, rr(r, 1, 4), 1); }
    for (let x = 0; x < w; x += 7) { ctx.fillStyle = 'rgba(80,55,30,0.06)'; ctx.fillRect(x, 0, 2, h); }
    for (let i = 0; i < 10; i++) soft(ctx, r() * w, r() * h, rr(r, 30, 90), '70,50,30', 0.12);
    ctx.save(); ctx.translate(w * 0.3, h * 0.7); ctx.rotate(-0.05);
    text(ctx, pick(r, ['FOOD COURT', 'RETURN', 'BACK STOCK']), 0, 0, 200, 26, 'rgba(25,20,15,0.55)', 'left');
    ctx.restore();
  });
  textures.add(t);
  return t;
}

// ---------------------------------------------------------------------------------------
// Materials

const glow = (map: THREE.Texture, intensity: number, roughness: number) =>
  new THREE.MeshStandardMaterial({map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: intensity, roughness, metalness: 0});
const printed = (map: THREE.Texture, roughness = 0.78) => new THREE.MeshStandardMaterial({map, roughness, metalness: 0});
const WORN = {grime: [0.35, 0.45] as [number, number], macro: 0.15};
/** Painted-panel tints (also used as vertex colours when purpose parts are merged per chunk). */
export const PAINT: Partial<Record<PurposeMat, number>> = {paintRed: 0xb23a2e, paintYellow: 0xd9a520, paintGreen: 0x3f7d4a, paintWhite: 0xe8e4da, paintBlue: 0x2f5f9a, paintOrange: 0xd9732a};

function make(key: PurposeMat): THREE.Material {
  if (key in STOCK) return printed(stockTexture(key, 5000 + hashKey(key) % 997), 0.7);
  const paint = PAINT[key];
  if (paint !== undefined) return surfaceMaterial('paintedPanel', {color: paint, metalness: 0.1}, WORN);
  switch (key) {
    case 'magazines': return printed(magazinesTexture(), 0.55);
    case 'deviceScreen': return glow(deviceScreenTexture(), 0.5, 0.2);
    case 'cctv': return glow(cctvTexture(), 0.55, 0.25);
    case 'noticeBoard': return printed(noticeBoardTexture(), 0.9);
    case 'keyBlanks': return new THREE.MeshStandardMaterial({map: keyBlanksTexture(), roughness: 0.6, metalness: 0.25});
    case 'flowers': return printed(flowersTexture(), 0.8);
    case 'bread': return printed(breadTexture(), 0.85);
    case 'donuts': return printed(donutsTexture(), 0.7);
    case 'pizzaBox': return printed(pizzaBoxTexture(), 0.9);
    case 'fruit': return printed(fruitTexture(), 0.6);
    case 'hazardLabel': return printed(hazardTexture(), 0.6);
    case 'firstAid': return printed(firstAidTexture(), 0.5);
    case 'vinyl': return surfaceMaterial('plastic', {color: 0x56604a}, {grime: [0.2, 0.3], macro: 0.12});
    case 'cardboard': return worldMapped(new THREE.MeshStandardMaterial({map: cardboardTexture(), roughness: 0.95, metalness: 0}), {span: [0.6, 0.6], grime: [0.25, 0.35], macro: 0.15});
    default: return printed(magazinesTexture());
  }
}

/** Shared material for a purpose key (created on first use, module-level cache). */
export function purposeMaterial(key: PurposeMat): THREE.Material {
  let m = materials.get(key);
  if (!m) {
    m = make(key);
    m.name = `purpose-${key}`;
    materials.set(key, m);
  }
  return m;
}

/** Backlit menu panel for a store purpose (1024 x 512; designed for ~2:1 faces), cached by `key`. */
export function purposeMenuMaterial(menu: MenuSpec, key: string): THREE.Material {
  const ck = `menu:${key}`;
  let m = materials.get(ck);
  if (!m) {
    m = glow(menuTexture(menu, 4400 + hashKey(key) % 4093), 0.6, 0.3);
    m.name = `purpose-menu-${key}`;
    materials.set(ck, m);
  }
  return m;
}

/** Disposes every material and canvas texture created here (shared surface sets are not ours). */
export function disposePurposeMaterials(): void {
  for (const m of materials.values()) m.dispose();
  materials.clear();
  for (const t of textures) t.dispose();
  textures.clear();
}

function foodPhoto(ctx: Ctx, r: R, x: number, y: number, w: number, h: number, colors: readonly string[]): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#4a4238'); g.addColorStop(1, '#2a2520');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e8e2d4'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.6, w * 0.38, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = pick(r, colors);
    ctx.beginPath(); ctx.ellipse(x + w / 2 + rr(r, -w * 0.22, w * 0.22), y + h * 0.55 + rr(r, -h * 0.15, h * 0.12), rr(r, w * 0.06, w * 0.14), rr(r, h * 0.06, h * 0.12), r() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  soft(ctx, x + w * 0.35, y + h * 0.35, w * 0.25, '255,246,224', 0.25);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
}

function menuTexture(m: MenuSpec, seed: number): THREE.CanvasTexture {
  return faceTex(1024, 512, seed, (ctx, w, h, r) => {
    ctx.fillStyle = m.bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = m.band; ctx.fillRect(0, 0, w, 92);
    ctx.fillStyle = m.accent; ctx.fillRect(0, 92, w, 8);
    const titleCol = m.band.toLowerCase() === m.fg.toLowerCase() ? m.bg : '#f4eedd';
    text(ctx, m.name, 34, 48, 560, 58, titleCol, 'left');
    text(ctx, m.tag, 990, 52, 360, 20, titleCol, 'right');
    foodPhoto(ctx, r, 24, 120, 300, 170, m.food);
    foodPhoto(ctx, r, 24, 304, 300, 170, [...m.food].reverse());
    const cols = [360, 690];
    let col = 0, y = 128;
    for (const [title, items] of m.sections) {
      const need = 40 + items.length * 34;
      if (y + need > 490 && col === 0) { col = 1; y = 128; }
      const x = cols[col];
      text(ctx, title, x, y + 12, 300, 26, m.accent, 'left');
      ctx.fillStyle = m.accent; ctx.fillRect(x, y + 30, 300, 3);
      y += 44;
      for (const [name, price] of items) {
        text(ctx, name, x, y + 10, 230, 22, m.fg, 'left', 'normal');
        text(ctx, price, x + 300, y + 10, 70, 22, m.fg, 'right');
        y += 34;
      }
      y += 14;
    }
    // Taped-over price and a hand-written note (credible neglect).
    ctx.save(); ctx.translate(cols[0] + 240, 172); ctx.rotate(-0.05);
    ctx.fillStyle = '#f0d860'; ctx.fillRect(-6, -14, 70, 30);
    text(ctx, `${Math.floor(rr(r, 4, 12))}.99`, 0, 2, 60, 20, '#2a2522', 'left');
    ctx.restore();
    ctx.save(); ctx.translate(880, 455); ctx.rotate(rr(r, 0.03, 0.08));
    ctx.fillStyle = '#efe9da'; ctx.fillRect(-90, -24, 180, 48);
    text(ctx, pick(r, ['CASH ONLY', 'SORRY NO REFILLS', 'CLOSED SUNDAYS', 'NO PUBLIC WASHROOM']), 0, 2, 170, 22, '#a8362b');
    ctx.restore();
    // Panel wear: uneven backlight, dust, a dead tube band on some boards.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(40,34,26,0.08)'); g.addColorStop(1, 'rgba(40,34,26,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) soft(ctx, rr(r, 0, w), rr(r, 0, h), rr(r, w * 0.08, w * 0.25), '42,36,28', rr(r, 0.08, 0.2));
    if (r() < 0.4) { const x = rr(r, 0, w * 0.7), wd = rr(r, w * 0.12, w * 0.3); ctx.fillStyle = 'rgba(12,12,11,0.55)'; ctx.fillRect(x, 0, wd, h); }
    for (let i = 0; i < w * h / 900; i++) { ctx.fillStyle = 'rgba(58,53,44,0.4)'; const s = rr(r, 0.6, 1.8); ctx.fillRect(rr(r, 0, w), rr(r, 0, h), s, s); }
  });
}
