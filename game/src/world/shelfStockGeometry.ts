// Iteration 08 (Lane S): honestly AUTHORED low-poly packaging for the filler stock — cans, tins,
// bottles, jars, noodle cups, gable cartons, printed boxes (dieline-mapped: front panel / side
// panel / plain flaps), pillow bags with crimped seams, spray bottles, jugs, pill bottles, paint
// tins, cable reels, magazines, newspapers, bagged loaves, flower buckets, potted plants, key blanks
// and whole fruit. One
// shared canvas LABEL ATLAS (fictional designs only: no real brands, logos or photos) + a tiny
// roughness / metalness map, ONE material: every piece of every archetype merges into the same
// draw call (world/shelfStock.ts). Geometry: origin bottom-centre, front +Z, metres, upright pose
// of the catalogue dims (world/shelfStockCatalog.ts); vertex colours carry plastic / glass / cap /
// bloom tints, the atlas carries print.
//
// Iteration 12 (LOOT lane): ~30 YEARS OF NEGLECT on everything that is not loot. Every label is painted through agedContext() —
// each colour desaturated toward a warm sepia, darkened, its blacks lifted (faded ink) — and then overlaid with sun-bleach, water
// stains, grime / dust, torn corners and (food print) mould specks; plain swatches are yellowed / tarnished; vertex colours are
// desaturated and warmed (ageVertexColors); cans / foil lose their shine (rougher, less metallic). New abandoned-station pieces:
// open and crushed cartons, crumpled wrappers, torn deflated bags, crushed cans, broken bottles, rusted tins, empty bottles;
// rotten fruit, mouldy jar fills, dead flowers / plants, tarnished key blanks. Real loot keeps its own fresh models / materials.

import * as THREE from 'three';
import {canvasTexture} from './canvasTextures';
import {LABEL_VARIANTS, STOCK_ARCHES, type LabelKind, type StockArch} from './shelfStockCatalog';

type Ctx = CanvasRenderingContext2D;
type R = () => number;
/** UV rect (u0, v0, u1, v1), v up (canvas textures are flipY). */
export type UVRect = [number, number, number, number];
type V3 = [number, number, number];
type C3 = [number, number, number];

// ---------------------------------------------------------------------------------------
// Atlas layout (pure: geometry needs only the rects; pixels are drawn lazily for the material)

interface CellSpec { w: number; h: number; /** dieline: front panel fraction of the width (rest = side panel). */ front?: number }
const CELL: Record<Exclude<LabelKind, 'none'>, CellSpec> = {
  soda: {w: 96, h: 48}, energy: {w: 88, h: 64}, tin: {w: 112, h: 40}, bottle: {w: 96, h: 32}, bigbottle: {w: 128, h: 40},
  jar: {w: 112, h: 32}, cup: {w: 112, h: 40}, pills: {w: 72, h: 24}, paint: {w: 144, h: 40}, reel: {w: 64, h: 64},
  carton: {w: 56, h: 64, front: 0.5}, cereal: {w: 88, h: 96, front: 0.745}, pantry: {w: 72, h: 68, front: 0.73}, candy: {w: 84, h: 28, front: 0.57},
  chips: {w: 72, h: 88, front: 0.9}, snack: {w: 56, h: 64, front: 0.9}, towels: {w: 108, h: 78, front: 0.667}, rolls: {w: 132, h: 56, front: 0.6},
  med: {w: 60, h: 64, front: 0.72}, lotion: {w: 48, h: 76, front: 0.6}, spray: {w: 56, h: 72, front: 0.61}, jug: {w: 76, h: 88, front: 0.6},
  phone: {w: 56, h: 72, front: 0.667}, tablet: {w: 78, h: 84, front: 0.81}, blister: {w: 48, h: 76, front: 0.92}, gadget: {w: 96, h: 40, front: 0.583},
  cartonbox: {w: 128, h: 56, front: 0.58}, tubes: {w: 128, h: 16, front: 0.876}, magazine: {w: 64, h: 88}, news: {w: 72, h: 92},
  loaf: {w: 104, h: 32, front: 0.675}, donuts: {w: 64, h: 84},
  // iteration 12 (LOOT lane)
  trash: {w: 64, h: 48}, rusttin: {w: 112, h: 40}, oldbottle: {w: 96, h: 32},
};
/** Plain swatches (vertex-coloured parts): white, brushed metal, paper, kraft, dark plastic, clear plastic, glass, soil, leaf. */
export const SWATCHES = ['white', 'metal', 'paper', 'kraft', 'dark', 'clear', 'glass', 'soil', 'leaf', 'foil', 'peel'] as const;
export type Swatch = (typeof SWATCHES)[number];

export const ATLAS_W = 1024;
const PAD = 2;

export interface AtlasLayout {
  width: number; height: number;
  /** Canvas px rect of every cell: key `${label}:${variant}` or `swatch:${name}`. */
  cells: Map<string, {x: number; y: number; w: number; h: number; front?: number}>;
}

let layoutCache: AtlasLayout | null = null;
export function atlasLayout(): AtlasLayout {
  if (layoutCache) return layoutCache;
  const items: {key: string; w: number; h: number; front?: number}[] = [];
  for (const [label, spec] of Object.entries(CELL) as [Exclude<LabelKind, 'none'>, CellSpec][]) {
    const n = LABEL_VARIANTS[label] ?? 0;
    for (let v = 0; v < n; v++) items.push({key: `${label}:${v}`, w: spec.w, h: spec.h, front: spec.front});
  }
  for (const s of SWATCHES) items.push({key: `swatch:${s}`, w: 12, h: 12});
  items.sort((a, b) => b.h - a.h || b.w - a.w || a.key.localeCompare(b.key));
  const cells = new Map<string, {x: number; y: number; w: number; h: number; front?: number}>();
  let x = 0, y = 0, rowH = 0;
  for (const it of items) {
    const W = it.w + 2 * PAD, H = it.h + 2 * PAD;
    if (x + W > ATLAS_W) { x = 0; y += rowH; rowH = 0; }
    cells.set(it.key, {x: x + PAD, y: y + PAD, w: it.w, h: it.h, front: it.front});
    x += W;
    rowH = Math.max(rowH, H);
  }
  const height = Math.ceil((y + rowH) / 64) * 64;
  layoutCache = {width: ATLAS_W, height, cells};
  return layoutCache;
}

/** UV rect of a canvas px rect (inset half a texel). */
function uvOf(L: AtlasLayout, x: number, y: number, w: number, h: number): UVRect {
  return [(x + 0.5) / L.width, 1 - (y + h - 0.5) / L.height, (x + w - 0.5) / L.width, 1 - (y + 0.5) / L.height];
}

/** Label UVs: whole cell, dieline front / side panels, the plain flap band (top 12 % of the side / cell). */
export interface LabelUV { all: UVRect; front: UVRect; side: UVRect; flap: UVRect }
export function labelUV(label: LabelKind, variant: number): LabelUV {
  const L = atlasLayout();
  if (label === 'none') { const s = swatchUV('white'); return {all: s, front: s, side: s, flap: s}; }
  const c = L.cells.get(`${label}:${variant % Math.max(1, LABEL_VARIANTS[label])}`)!;
  const fw = c.front ? Math.round(c.w * c.front) : c.w;
  const all = uvOf(L, c.x, c.y, c.w, c.h);
  const front = uvOf(L, c.x, c.y, fw, c.h);
  const side = c.front ? uvOf(L, c.x + fw, c.y, c.w - fw, c.h) : front;
  const flap = c.front ? uvOf(L, c.x + fw + 1, c.y + 1, Math.max(2, c.w - fw - 2), Math.max(2, Math.round(c.h * 0.1))) : uvOf(L, c.x + 1, c.y + 1, Math.max(2, c.w - 2), 3);
  return {all, front, side, flap};
}
export function swatchUV(s: Swatch): UVRect {
  const L = atlasLayout();
  const c = L.cells.get(`swatch:${s}`)!;
  return uvOf(L, c.x + 3, c.y + 3, c.w - 6, c.h - 6);
}

// ---------------------------------------------------------------------------------------
// Label painters (fictional print)

const SANS = '"Helvetica Neue", Arial, sans-serif';
const rr = (r: R, a: number, b: number) => a + (b - a) * r();
function rect(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
function circle(ctx: Ctx, x: number, y: number, rad: number, c: string): void { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, rad), 0, Math.PI * 2); ctx.fill(); }
function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, c: string): void { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); ctx.fill(); }
function text(ctx: Ctx, s: string, x: number, y: number, maxW: number, px: number, c: string, weight = 'bold', align: CanvasTextAlign = 'center'): void {
  let size = Math.max(5, Math.round(px));
  ctx.font = `${weight} ${size}px ${SANS}`;
  while (ctx.measureText(s).width > maxW && size > 5) { size--; ctx.font = `${weight} ${size}px ${SANS}`; }
  ctx.fillStyle = c; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
function lines(ctx: Ctx, x: number, y: number, w: number, n: number, gap: number, c: string, r: R): void {
  ctx.fillStyle = c;
  for (let i = 0; i < n; i++) ctx.fillRect(x, y + i * gap, w * rr(r, 0.55, 1), Math.max(1, gap * 0.35));
}
function barcode(ctx: Ctx, x: number, y: number, w: number, h: number, r: R): void {
  rect(ctx, x, y, w, h, '#f4f2ea');
  ctx.fillStyle = '#1a1a1a';
  for (let bx = x + 1; bx < x + w - 1; bx += rr(r, 1.4, 2.6)) ctx.fillRect(bx, y + 1, rr(r, 0.6, 1.2), h - 2);
}
/** Light shelf wear: dust toward the top edge, faint scuffs. */
function wear(ctx: Ctx, x: number, y: number, w: number, h: number, r: R, k = 1): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(70,62,50,${0.16 * k})`); g.addColorStop(0.3, 'rgba(70,62,50,0)'); g.addColorStop(1, `rgba(40,34,26,${0.12 * k})`);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(50,44,36,${0.05 + r() * 0.08 * k})`; ctx.fillRect(x + r() * w, y + r() * h, 2 + r() * w * 0.3, 1 + r() * 2); }
}
const pickOf = <T>(l: readonly T[], v: number): T => l[((v % l.length) + l.length) % l.length];

type Painter = (ctx: Ctx, x: number, y: number, w: number, h: number, v: number, r: R, fw: number) => void;

const SODA = [['#c4161c', '#ffffff', 'FIZZ', '#ffd200'], ['#1d8f3a', '#f4ffe8', 'LIMA', '#c8e64a'], ['#f07d00', '#fff4e0', 'SUNNY', '#ffe066'], ['#173f8a', '#ffffff', 'POLAR', '#7fd0ff']] as const;
const soda: Painter = (ctx, x, y, w, h, v, r) => {
  const [bg, fg, name, ac] = pickOf(SODA, v);
  rect(ctx, x, y, w, h, bg);
  ctx.fillStyle = ac; ctx.beginPath(); ctx.moveTo(x, y + h * 0.72); ctx.bezierCurveTo(x + w * 0.3, y + h * 0.55, x + w * 0.6, y + h * 0.95, x + w, y + h * 0.7); ctx.lineTo(x + w, y + h * 0.82); ctx.bezierCurveTo(x + w * 0.6, y + h * 1.05, x + w * 0.3, y + h * 0.66, x, y + h * 0.84); ctx.closePath(); ctx.fill();
  text(ctx, name, x + w * 0.5, y + h * 0.38, w * 0.42, h * 0.42, fg);
  text(ctx, '330 ml', x + w * 0.85, y + h * 0.12, w * 0.2, h * 0.13, fg, 'normal');
  for (let i = 0; i < 5; i++) circle(ctx, x + w * rr(r, 0.05, 0.3), y + h * rr(r, 0.15, 0.55), h * rr(r, 0.02, 0.05), 'rgba(255,255,255,0.45)');
};
const ENERGY = [['#121212', '#7cff3a', 'VOLT'], ['#e6e6e6', '#e01a4f', 'RUSH'], ['#2a1a4a', '#ffb400', 'NOVA']] as const;
const energy: Painter = (ctx, x, y, w, h, v) => {
  const [bg, fg, name] = pickOf(ENERGY, v);
  rect(ctx, x, y, w, h, bg);
  ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(x + w * 0.62, y + h * 0.12); ctx.lineTo(x + w * 0.5, y + h * 0.5); ctx.lineTo(x + w * 0.6, y + h * 0.5); ctx.lineTo(x + w * 0.45, y + h * 0.9); ctx.lineTo(x + w * 0.66, y + h * 0.42); ctx.lineTo(x + w * 0.56, y + h * 0.42); ctx.closePath(); ctx.fill();
  text(ctx, name, x + w * 0.22, y + h * 0.5, w * 0.36, h * 0.3, fg);
  text(ctx, 'ENERGY', x + w * 0.82, y + h * 0.5, w * 0.3, h * 0.14, fg);
};
const TIN = [['#b8302a', 'BEANS', '#b5532a'], ['#c8402c', 'TOMATO', '#d23a2a'], ['#d9a520', 'CORN', '#f2c84a'], ['#3f7d4a', 'PEAS', '#7cb342'], ['#7a2618', 'CHILI', '#8a3a1a']] as const;
const tin: Painter = (ctx, x, y, w, h, v, r) => {
  const [bg, name, food] = pickOf(TIN, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x, y + h * 0.06, w, h * 0.08, '#f2ead6'); rect(ctx, x, y + h * 0.86, w, h * 0.08, '#f2ead6');
  ellipse(ctx, x + w * 0.5, y + h * 0.5, w * 0.2, h * 0.3, '#f4eedd');
  text(ctx, name, x + w * 0.5, y + h * 0.42, w * 0.34, h * 0.26, bg);
  for (let i = 0; i < 6; i++) ellipse(ctx, x + w * rr(r, 0.4, 0.6), y + h * rr(r, 0.56, 0.7), h * 0.05, h * 0.035, food);
  text(ctx, 'NET 400 g', x + w * 0.12, y + h * 0.5, w * 0.16, h * 0.13, '#f4eedd', 'normal');
  barcode(ctx, x + w * 0.8, y + h * 0.3, w * 0.12, h * 0.4, r);
};
const BOTTLE = [['#f4f8fb', '#2f6fb5', 'SPRING'], ['#eaf4ee', '#1d8f6a', 'GLACIER'], ['#ffe14d', '#3a7d1a', 'ZEST'], ['#ff8a1c', '#ffffff', 'ORA'], ['#b3201c', '#f7f1e8', 'COLA']] as const;
const bottle: Painter = (ctx, x, y, w, h, v) => {
  const [bg, fg, name] = pickOf(BOTTLE, v);
  rect(ctx, x, y, w, h, bg);
  ctx.strokeStyle = fg; ctx.lineWidth = Math.max(1, h * 0.08); ctx.beginPath(); ctx.moveTo(x, y + h * 0.82); ctx.bezierCurveTo(x + w * 0.3, y + h * 0.65, x + w * 0.65, y + h * 0.98, x + w, y + h * 0.78); ctx.stroke();
  text(ctx, name, x + w * 0.5, y + h * 0.4, w * 0.4, h * 0.5, fg);
  text(ctx, '500 ml', x + w * 0.88, y + h * 0.3, w * 0.18, h * 0.22, fg, 'normal');
};
const BIGBOTTLE = [['#c4161c', '#ffffff', 'FIZZ'], ['#1d8f3a', '#f4ffe8', 'LIMA'], ['#e8f0f6', '#2f6fb5', 'SPRING']] as const;
const bigbottle: Painter = (ctx, x, y, w, h, v) => {
  const [bg, fg, name] = pickOf(BIGBOTTLE, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x, y + h * 0.75, w, h * 0.12, fg);
  text(ctx, name, x + w * 0.5, y + h * 0.4, w * 0.4, h * 0.5, fg);
  text(ctx, '2 L', x + w * 0.85, y + h * 0.4, w * 0.15, h * 0.35, fg);
};
const JAR = [['#a01c34', 'BERRY JAM', '#f4e6d0'], ['#c8402c', 'PASTA SAUCE', '#f2e8d6'], ['#3a6a2a', 'DILL PICKLES', '#eef2dc'], ['#c08a4a', 'PEANUT BUTTER', '#f6ecd8']] as const;
const jar: Painter = (ctx, x, y, w, h, v, r) => {
  const [c, name, bg] = pickOf(JAR, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x, y, w, h * 0.16, c); rect(ctx, x, y + h * 0.84, w, h * 0.16, c);
  text(ctx, name, x + w * 0.5, y + h * 0.5, w * 0.44, h * 0.38, c);
  for (let i = 0; i < 3; i++) circle(ctx, x + w * rr(r, 0.1, 0.25), y + h * 0.5, h * 0.12, c);
};
const CUP = [['#c8281f', 'RAMEN'], ['#e8862a', 'CURRY'], ['#3a8a4a', 'MISO']] as const;
const cup: Painter = (ctx, x, y, w, h, v) => {
  const [c, name] = pickOf(CUP, v);
  rect(ctx, x, y, w, h, '#f6f2ea');
  rect(ctx, x, y + h * 0.28, w, h * 0.44, c);
  text(ctx, name, x + w * 0.5, y + h * 0.5, w * 0.4, h * 0.38, '#ffffff');
  text(ctx, 'instant noodles', x + w * 0.5, y + h * 0.86, w * 0.5, h * 0.16, c, 'normal');
};
const CARTON = [['#ff8a1c', '#ffffff', 'ORANGE'], ['#e8f0fa', '#1d4f9a', 'MILK'], ['#8ac23a', '#ffffff', 'APPLE']] as const;
const carton: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, fg, name] = pickOf(CARTON, v);
  rect(ctx, x, y, w, h, bg);
  circle(ctx, x + fw * 0.5, y + h * 0.58, fw * 0.28, name === 'MILK' ? '#ffffff' : '#ffd25a');
  text(ctx, name, x + fw * 0.5, y + h * 0.22, fw * 0.86, h * 0.14, fg);
  text(ctx, '1 L', x + fw * 0.5, y + h * 0.88, fw * 0.5, h * 0.1, fg);
  lines(ctx, x + fw + 3, y + h * 0.2, w - fw - 6, 6, h * 0.08, 'rgba(255,255,255,0.75)', r);
};
const CEREAL = [['#e8b81c', '#b8302a', 'OATY'], ['#c4302a', '#ffffff', 'CRISPS'], ['#d99a20', '#5a2e10', "HONEY O'S"], ['#7a4a2a', '#f4e6c8', 'BRAN']] as const;
const cereal: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, fg, name] = pickOf(CEREAL, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x, y + h * 0.06, fw, h * 0.2, '#f6efe0');
  text(ctx, name, x + fw * 0.5, y + h * 0.16, fw * 0.86, h * 0.15, fg);
  ellipse(ctx, x + fw * 0.5, y + h * 0.66, fw * 0.36, h * 0.12, '#f6f2ea');
  for (let i = 0; i < 12; i++) ellipse(ctx, x + fw * rr(r, 0.25, 0.75), y + h * rr(r, 0.58, 0.68), 2.4, 1.6, '#d9a35a');
  text(ctx, 'WHOLE GRAIN', x + fw * 0.5, y + h * 0.9, fw * 0.8, h * 0.06, fg, 'normal');
  rect(ctx, x + fw, y, w - fw, h, '#f2ecdc');
  rect(ctx, x + fw, y, w - fw, h * 0.12, bg);
  lines(ctx, x + fw + 2, y + h * 0.2, w - fw - 4, 12, h * 0.055, 'rgba(40,40,40,0.55)', r);
  wear(ctx, x, y, w, h, r);
};
const PANTRY = [['#e8862a', 'CRACKERS'], ['#2f5f9a', 'PENNE'], ['#3a7a4a', 'GREEN TEA'], ['#f2efe6', 'RICE']] as const;
const pantry: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, name] = pickOf(PANTRY, v);
  const light = bg === '#f2efe6';
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x + fw * 0.15, y + h * 0.46, fw * 0.7, h * 0.3, light ? '#c4302a' : '#f6efe0');
  text(ctx, name, x + fw * 0.5, y + h * 0.22, fw * 0.86, h * 0.16, light ? '#c4302a' : '#ffffff');
  for (let i = 0; i < 5; i++) ellipse(ctx, x + fw * rr(r, 0.25, 0.75), y + h * rr(r, 0.52, 0.7), 3, 2, light ? '#f6efe0' : bg);
  rect(ctx, x + fw, y, w - fw, h, light ? '#e8e4d8' : bg);
  lines(ctx, x + fw + 2, y + h * 0.25, w - fw - 4, 7, h * 0.08, light ? 'rgba(40,40,40,0.5)' : 'rgba(255,255,255,0.6)', r);
  wear(ctx, x, y, w, h, r);
};
const CANDY = [['#5a2e1e', '#e9c46a', 'CHOCO'], ['#b8302a', '#ffffff', 'NUTTY'], ['#1d9aa8', '#ffffff', 'MINTS'], ['#d9a520', '#5a2e1e', 'CARAMEL']] as const;
const candy: Painter = (ctx, x, y, w, h, v, _r, fw) => {
  const [bg, fg, name] = pickOf(CANDY, v);
  rect(ctx, x, y, w, h, bg);
  for (let i = 0; i < 4; i++) rect(ctx, x + fw * (0.06 + i * 0.235), y + h * 0.45, fw * 0.2, h * 0.45, i % 2 ? '#f2ead6' : fg);
  text(ctx, name, x + fw * 0.5, y + h * 0.22, fw * 0.8, h * 0.3, fg);
  rect(ctx, x + fw, y, w - fw, h, bg);
  text(ctx, '24 bars', x + fw + (w - fw) / 2, y + h * 0.5, (w - fw) * 0.85, h * 0.3, fg, 'normal');
};
const CHIPS = [['#e8c01c', '#c4302a', 'CRUNCH'], ['#2f5f9a', '#ffffff', 'KETTLE'], ['#c4302a', '#ffffff', 'SALTY'], ['#3a8a3a', '#fff6d8', 'ZESTY']] as const;
const chips: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, fg, name] = pickOf(CHIPS, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x, y, fw, h * 0.1, 'rgba(0,0,0,0.25)'); rect(ctx, x, y + h * 0.9, fw, h * 0.1, 'rgba(0,0,0,0.25)');
  ellipse(ctx, x + fw * 0.5, y + h * 0.36, fw * 0.42, h * 0.13, '#f6efe0');
  text(ctx, name, x + fw * 0.5, y + h * 0.36, fw * 0.7, h * 0.13, bg === '#e8c01c' ? fg : bg);
  for (let i = 0; i < 6; i++) ellipse(ctx, x + fw * rr(r, 0.25, 0.75), y + h * rr(r, 0.6, 0.78), fw * 0.08, h * 0.035, '#e8c060');
  text(ctx, 'SEA SALT', x + fw * 0.5, y + h * 0.84, fw * 0.6, h * 0.05, fg, 'normal');
  rect(ctx, x + fw, y, w - fw, h, bg);
  const g = ctx.createLinearGradient(x, 0, x + fw, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.18)'); g.addColorStop(0.35, 'rgba(255,255,255,0.18)'); g.addColorStop(0.6, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = g; ctx.fillRect(x, y, fw, h);
};
const SNACK = [['#8a5226', '#f2d8a8', 'TWISTS'], ['#c4302a', '#ffffff', 'POP!'], ['#3a6a2a', '#f4eedd', 'NUTS'], ['#2a4f8a', '#ffd25a', 'COOKIES']] as const;
const snack: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, fg, name] = pickOf(SNACK, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x, y + h * 0.3, fw, h * 0.24, fg);
  text(ctx, name, x + fw * 0.5, y + h * 0.42, fw * 0.8, h * 0.18, bg);
  for (let i = 0; i < 5; i++) circle(ctx, x + fw * rr(r, 0.2, 0.8), y + h * rr(r, 0.64, 0.84), fw * 0.06, fg);
  rect(ctx, x + fw, y, w - fw, h, bg);
};
const towelsP: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const c = v % 2 ? '#3a8a5a' : '#2f6fb5';
  rect(ctx, x, y, w, h, '#f4f4f0');
  for (let i = 0; i < 2; i++) { rect(ctx, x + fw * (0.08 + i * 0.46), y + h * 0.1, fw * 0.4, h * 0.8, '#ffffff'); rect(ctx, x + fw * (0.08 + i * 0.46), y + h * 0.1, fw * 0.4, h * 0.05, '#dcdcd6'); }
  rect(ctx, x, y + h * 0.4, w, h * 0.22, c);
  text(ctx, v % 2 ? 'ABSORB' : 'SOFT', x + fw * 0.5, y + h * 0.51, fw * 0.8, h * 0.16, '#ffffff');
  text(ctx, '2 ROLLS', x + fw + (w - fw) / 2, y + h * 0.51, (w - fw) * 0.9, h * 0.1, '#ffffff');
  wear(ctx, x, y, w, h, r, 0.6);
};
const rollsP: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const c = v % 2 ? '#d84a8a' : '#2f6fb5';
  rect(ctx, x, y, w, h, '#f6f6f2');
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) circle(ctx, x + fw * (0.18 + i * 0.32), y + h * (0.28 + k * 0.46), h * 0.2, '#ffffff');
  rect(ctx, x, y + h * 0.4, w, h * 0.2, c);
  text(ctx, v % 2 ? 'DOUBLE 12' : '12 ROLLS', x + fw * 0.5, y + h * 0.5, fw * 0.7, h * 0.15, '#ffffff');
  wear(ctx, x, y, w, h, r, 0.6);
};
const MED = [['#2f6fd0', 'PAIN RELIEF'], ['#e86a1a', 'COLD + FLU'], ['#1d9aa8', 'ALLERGY'], ['#3a9a48', 'ANTACID'], ['#e8b81c', 'VITAMIN C']] as const;
const med: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [c, name] = pickOf(MED, v);
  rect(ctx, x, y, w, h, '#f6f6f2');
  rect(ctx, x, y + h * 0.12, w, h * 0.3, c);
  rect(ctx, x + fw * 0.08, y + h * 0.2, fw * 0.16, h * 0.05, '#ffffff'); rect(ctx, x + fw * 0.135, y + h * 0.155, fw * 0.05, h * 0.14, '#ffffff');
  text(ctx, name, x + fw * 0.6, y + h * 0.27, fw * 0.66, h * 0.1, '#ffffff');
  lines(ctx, x + fw * 0.1, y + h * 0.55, fw * 0.8, 4, h * 0.08, 'rgba(60,64,70,0.6)', r);
  text(ctx, '24 tabs', x + fw * 0.75, y + h * 0.88, fw * 0.4, h * 0.07, c);
  rect(ctx, x + fw, y, w - fw, h, '#eeeee8');
  rect(ctx, x + fw, y + h * 0.12, w - fw, h * 0.3, c);
};
const PILLS = [['#2f6fd0', 'IBU 200'], ['#b8742a', 'MULTI'], ['#c4302a', 'ASPRN']] as const;
const pills: Painter = (ctx, x, y, w, h, v) => {
  const [c, name] = pickOf(PILLS, v);
  rect(ctx, x, y, w, h, '#f8f6ee');
  rect(ctx, x, y, w, h * 0.3, c);
  text(ctx, name, x + w * 0.5, y + h * 0.62, w * 0.4, h * 0.36, '#2a2c30');
};
const LOTION = [['#f2c0d0', '#a8325a', 'HAND CREAM'], ['#ffe14d', '#1d4f9a', 'SUN 30'], ['#1d9aa8', '#ffffff', 'SHAMPOO']] as const;
const lotion: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, fg, name] = pickOf(LOTION, v);
  rect(ctx, x, y, w, h, bg);
  ellipse(ctx, x + fw * 0.5, y + h * 0.55, fw * 0.36, h * 0.16, '#ffffff');
  text(ctx, name, x + fw * 0.5, y + h * 0.3, fw * 0.86, h * 0.08, fg);
  text(ctx, '200 ml', x + fw * 0.5, y + h * 0.86, fw * 0.6, h * 0.06, fg, 'normal');
  rect(ctx, x + fw, y, w - fw, h, bg);
  lines(ctx, x + fw + 2, y + h * 0.3, w - fw - 4, 6, h * 0.06, 'rgba(40,40,40,0.4)', r);
};
const SPRAY = [['#2f6fd0', 'GLASS'], ['#3a9a48', 'CLEAN'], ['#f4f4f0', 'DISINFECT']] as const;
const spray: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, name] = pickOf(SPRAY, v);
  const light = bg === '#f4f4f0';
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x + fw * 0.08, y + h * 0.3, fw * 0.84, h * 0.4, '#f8f6ee');
  text(ctx, name, x + fw * 0.5, y + h * 0.42, fw * 0.8, h * 0.12, light ? '#c4302a' : '#1d3a6a');
  text(ctx, 'TRIGGER 750 ml', x + fw * 0.5, y + h * 0.6, fw * 0.8, h * 0.06, '#2a2c30', 'normal');
  rect(ctx, x + fw, y, w - fw, h, bg);
  wear(ctx, x, y, w, h, r, 0.6);
};
const JUG = [['#f4f4f0', '#2f6fd0', 'BLEACH'], ['#ffe14d', '#3a3a3a', 'FLOOR'], ['#f4f4f0', '#3a9a48', 'AMMONIA']] as const;
const jug: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, c, name] = pickOf(JUG, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x, y + h * 0.42, fw, h * 0.3, c);
  text(ctx, name, x + fw * 0.5, y + h * 0.57, fw * 0.8, h * 0.14, '#ffffff');
  text(ctx, '3.6 L', x + fw * 0.5, y + h * 0.84, fw * 0.4, h * 0.07, c);
  ctx.fillStyle = '#c4302a'; ctx.beginPath(); ctx.moveTo(x + fw * 0.5, y + h * 0.12); ctx.lineTo(x + fw * 0.62, y + h * 0.3); ctx.lineTo(x + fw * 0.38, y + h * 0.3); ctx.closePath(); ctx.fill();
  rect(ctx, x + fw, y, w - fw, h, bg);
  lines(ctx, x + fw + 2, y + h * 0.3, w - fw - 4, 8, h * 0.06, 'rgba(40,40,40,0.45)', r);
  wear(ctx, x, y, w, h, r, 0.8);
};
const PHONE = [['#14161a', '#e8e8e8', 'SMART 5G'], ['#ecebe8', '#1a1c20', 'PHONE LITE'], ['#1d2a44', '#e8e8f0', 'MAX PRO'], ['#e8e2d8', '#2a2c30', 'MINI']] as const;
const phone: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, fg, name] = pickOf(PHONE, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x + fw * 0.22, y + h * 0.1, fw * 0.56, h * 0.66, '#101216');
  const g = ctx.createLinearGradient(x, y, x + fw, y + h);
  g.addColorStop(0, pickOf(['#2f6fd0', '#8a3ab0', '#1d9aa8', '#e86a1a'], v)); g.addColorStop(1, '#101830');
  ctx.fillStyle = g; ctx.fillRect(x + fw * 0.26, y + h * 0.13, fw * 0.48, h * 0.6);
  text(ctx, name, x + fw * 0.5, y + h * 0.86, fw * 0.86, h * 0.07, fg);
  rect(ctx, x + fw, y, w - fw, h, bg);
  barcode(ctx, x + fw + 2, y + h * 0.72, w - fw - 4, h * 0.18, r);
};
const tablet: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const dark = v % 2 === 0;
  rect(ctx, x, y, w, h, dark ? '#16181c' : '#ecebe8');
  rect(ctx, x + fw * 0.12, y + h * 0.12, fw * 0.76, h * 0.62, '#0e1014');
  const g = ctx.createLinearGradient(x, y, x + fw, y + h);
  g.addColorStop(0, dark ? '#3a6ad0' : '#d07a2a'); g.addColorStop(1, '#141c30');
  ctx.fillStyle = g; ctx.fillRect(x + fw * 0.15, y + h * 0.15, fw * 0.7, h * 0.56);
  text(ctx, dark ? 'TABLET 10"' : 'PAD AIR', x + fw * 0.5, y + h * 0.86, fw * 0.7, h * 0.07, dark ? '#e8e8e8' : '#1a1c20');
  rect(ctx, x + fw, y, w - fw, h, dark ? '#16181c' : '#ecebe8');
  barcode(ctx, x + fw + 1, y + h * 0.7, w - fw - 2, h * 0.2, r);
};
const BLISTER = [['#1d9aa8', 'EARBUDS'], ['#2a2c30', 'USB-C 2M'], ['#c4302a', 'CHARGER'], ['#7e57c2', 'CASE']] as const;
const blister: Painter = (ctx, x, y, w, h, v, _r, fw) => {
  const [c, name] = pickOf(BLISTER, v);
  rect(ctx, x, y, w, h, c);
  rect(ctx, x + fw * 0.38, y + h * 0.04, fw * 0.24, h * 0.05, '#101010');
  text(ctx, name, x + fw * 0.5, y + h * 0.18, fw * 0.86, h * 0.08, '#f6f6f2');
  rect(ctx, x + fw * 0.12, y + h * 0.3, fw * 0.76, h * 0.58, '#dfe6ea');
  circle(ctx, x + fw * 0.5, y + h * 0.58, fw * 0.2, c === '#2a2c30' ? '#5a5d62' : '#f6f6f2');
  rect(ctx, x + fw, y, w - fw, h, c);
};
const GADGET = [['#1a1c20', '#e8e8e8', 'POWER BANK'], ['#2f5f9a', '#ffffff', 'SPEAKER'], ['#ecebe8', '#1a1c20', 'ROUTER']] as const;
const gadget: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const [bg, fg, name] = pickOf(GADGET, v);
  rect(ctx, x, y, w, h, bg);
  rect(ctx, x + fw * 0.08, y + h * 0.18, fw * 0.36, h * 0.64, fg === '#ffffff' ? '#1a1c20' : '#3a3d42');
  text(ctx, name, x + fw * 0.7, y + h * 0.42, fw * 0.5, h * 0.16, fg);
  text(ctx, '20000 mAh', x + fw * 0.7, y + h * 0.7, fw * 0.5, h * 0.1, fg, 'normal');
  rect(ctx, x + fw, y, w - fw, h, bg);
  barcode(ctx, x + fw + 3, y + h * 0.5, w - fw - 6, h * 0.35, r);
};
const cartonbox: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const kraft = pickOf(['#a67a48', '#9c7044', '#b08452'], v);
  rect(ctx, x, y, w, h, kraft);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(80,55,30,0.12)' : 'rgba(210,180,130,0.12)'; ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * 6, 1); }
  rect(ctx, x + fw * 0.4, y, fw * 0.2, h * 0.32, 'rgba(214,190,140,0.85)');
  text(ctx, pickOf(['THIS SIDE UP', 'FRAGILE', 'KEEP DRY'], v), x + fw * 0.5, y + h * 0.5, fw * 0.8, h * 0.13, v === 1 ? 'rgba(170,30,25,0.85)' : 'rgba(25,20,15,0.85)');
  text(ctx, '↑ ↑', x + fw * 0.5, y + h * 0.72, fw * 0.3, h * 0.16, 'rgba(25,20,15,0.8)');
  barcode(ctx, x + fw + (w - fw) * 0.15, y + h * 0.55, (w - fw) * 0.7, h * 0.25, r);
  text(ctx, pickOf(['24 x 500 ML', 'LOT 4471', '12 x 400 G'], v), x + fw + (w - fw) / 2, y + h * 0.3, (w - fw) * 0.85, h * 0.1, 'rgba(25,20,15,0.8)', 'normal');
  wear(ctx, x, y, w, h, r, 1.2);
};
const tubes: Painter = (ctx, x, y, w, h, _v, _r, fw) => {
  rect(ctx, x, y, w, h, '#ecebe6');
  rect(ctx, x, y, fw * 0.22, h, '#3a9a48');
  text(ctx, 'T8 LAMPS · 2 FT', x + fw * 0.6, y + h * 0.5, fw * 0.6, h * 0.7, '#2a2c30');
  rect(ctx, x + fw, y, w - fw, h, '#3a9a48');
};
const MAG = [['#c0392b', 'METRO', '#f8f4ea'], ['#f2efe6', 'WEEKLY', '#b8302a'], ['#1d3a6a', 'AUTO', '#f8f4ea'], ['#d9a520', 'STYLE', '#2a2c30'], ['#2a2c30', 'SCORE', '#f0d040'], ['#3a9a48', 'TRAVEL', '#ffffff'], ['#e86a8a', 'HOME', '#ffffff'], ['#8a3ab0', 'TECH', '#ffffff']] as const;
const magazine: Painter = (ctx, x, y, w, h, v, r) => {
  const [bg, name, fg] = pickOf(MAG, v);
  rect(ctx, x, y, w, h, bg);
  ellipse(ctx, x + w * 0.5, y + h * 0.52, w * 0.18, h * 0.12, pickOf(['#c9956a', '#8a5a3a', '#e0b896', '#5a3a2a'], v + 1));
  ctx.fillStyle = pickOf(['#2a2c30', '#b8302a', '#2f6fd0', '#f2f0ea'], v); ctx.beginPath(); ctx.ellipse(x + w * 0.5, y + h * 0.95, w * 0.36, h * 0.3, 0, Math.PI, 0); ctx.fill();
  text(ctx, name, x + w * 0.5, y + h * 0.1, w * 0.92, h * 0.14, fg);
  lines(ctx, x + w * 0.06, y + h * 0.24, w * 0.4, 3, h * 0.05, fg, r);
  text(ctx, pickOf(['NEW!', 'SPECIAL', 'TOP 50', 'WIN'], v), x + w * 0.78, y + h * 0.32, w * 0.3, h * 0.06, fg);
  wear(ctx, x, y, w, h, r, 0.5);
};
const news: Painter = (ctx, x, y, w, h, v, r) => {
  rect(ctx, x, y, w, h, '#e6e2d6');
  text(ctx, v % 2 ? 'METRO POST' : 'THE DAILY LINE', x + w * 0.5, y + h * 0.07, w * 0.92, h * 0.08, '#1a1a1a');
  rect(ctx, x + w * 0.04, y + h * 0.13, w * 0.92, 1.5, '#1a1a1a');
  text(ctx, v % 2 ? 'SERVICE SUSPENDED' : 'LINES CLOSED', x + w * 0.5, y + h * 0.2, w * 0.9, h * 0.07, '#1a1a1a');
  rect(ctx, x + w * 0.06, y + h * 0.27, w * 0.52, h * 0.3, '#8a8a84');
  for (let c = 0; c < 3; c++) lines(ctx, x + w * (0.06 + c * 0.31), y + h * 0.62, w * 0.27, 9, h * 0.035, 'rgba(30,30,30,0.6)', r);
  lines(ctx, x + w * 0.62, y + h * 0.28, w * 0.32, 8, h * 0.035, 'rgba(30,30,30,0.6)', r);
  wear(ctx, x, y, w, h, r, 0.7);
};
const loaf: Painter = (ctx, x, y, w, h, v, r, fw) => {
  const c = pickOf(['#c4302a', '#2f6fb5', '#3a8a3a'], v);
  rect(ctx, x, y, w, h, '#f6f2e8');
  rect(ctx, x + fw * 0.15, y + h * 0.2, fw * 0.7, h * 0.6, pickOf(['#c98a4a', '#b8763a', '#8a5226'], v));
  rect(ctx, x, y, fw, h * 0.16, c); rect(ctx, x, y + h * 0.84, fw, h * 0.16, c);
  text(ctx, pickOf(['BAKERY FRESH', 'WHOLE WHEAT', 'RYE'], v), x + fw * 0.5, y + h * 0.5, fw * 0.6, h * 0.22, '#ffffff');
  rect(ctx, x + fw, y, w - fw, h, '#f6f2e8');
  rect(ctx, x + fw, y + h * 0.35, w - fw, h * 0.3, c);
  wear(ctx, x, y, w, h, r, 0.4);
};
const donuts: Painter = (ctx, x, y, w, h, v, _r) => {
  const top = Math.round(h * 0.76);
  rect(ctx, x, y, w, h, '#f6f2ea');
  rect(ctx, x + w * 0.12, y + top * 0.12, w * 0.76, top * 0.62, '#e8e2d4');
  for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
    const cx = x + w * (0.25 + i * 0.25), cy = y + top * (0.3 + k * 0.28);
    circle(ctx, cx, cy, w * 0.1, '#c98a4a');
    circle(ctx, cx, cy, w * 0.08, pickOf(['#5a2e1e', '#f0a0c0', '#f4f0e8', '#e8c060'], i + k + v));
    circle(ctx, cx, cy, w * 0.025, '#4a3a2a');
  }
  text(ctx, v % 2 ? 'DOZEN' : 'DONUTS', x + w * 0.5, y + top * 0.88, w * 0.7, top * 0.1, '#d84a6a');
  rect(ctx, x, y + top, w, h - top, v % 2 ? '#5a2e1e' : '#f0a0c0');
};
const reel: Painter = (ctx, x, y, w, h, v) => {
  rect(ctx, x, y, w, h, '#3a3d42');
  circle(ctx, x + w / 2, y + h / 2, w * 0.46, v % 2 ? '#d9732a' : '#2f5f9a');
  circle(ctx, x + w / 2, y + h / 2, w * 0.2, '#1a1a1a');
  text(ctx, 'CAT6 305 M', x + w / 2, y + h * 0.2, w * 0.6, h * 0.1, '#f4f4f0');
};
const PAINT = [['#f2f0ea', 'PRIMER'], ['#e8b81c', 'SAFETY YELLOW'], ['#7a7e84', 'GREY ENAMEL']] as const;
const paint: Painter = (ctx, x, y, w, h, v, r) => {
  const [c, name] = pickOf(PAINT, v);
  rect(ctx, x, y, w, h, '#f4f2ea');
  rect(ctx, x, y + h * 0.15, w * 0.3, h * 0.7, c);
  text(ctx, name, x + w * 0.62, y + h * 0.4, w * 0.5, h * 0.24, '#2a2c30');
  text(ctx, '3.78 L · INTERIOR / EXTERIOR', x + w * 0.62, y + h * 0.72, w * 0.5, h * 0.12, '#2a2c30', 'normal');
  wear(ctx, x, y, w, h, r, 1.2);
};

// --- iteration 12 (LOOT lane): trash, rusted tins, empty bottles -----------------------------------------------------------
const TRASH = ['#b7a98e', '#8a3a30', '#3e5a7a', '#9a9a90'] as const;
/** Crumpled printed scraps: faded wrapper / newsprint / grey plastic with fragments of print and creases. */
const trash: Painter = (ctx, x, y, w, h, v, r) => {
  rect(ctx, x, y, w, h, pickOf(TRASH, v));
  for (let i = 0; i < 6; i++) rect(ctx, x + r() * w * 0.8, y + r() * h * 0.8, w * (0.1 + r() * 0.3), h * (0.08 + r() * 0.22), pickOf(['#d8cfb8', '#6a2a22', '#2a3a4a', '#c8a040', '#e8e2d0'], v + i));
  text(ctx, pickOf(['CRUNCH', 'FIZZ', 'DAILY', 'CHOCO'], v), x + w * 0.5, y + h * 0.45, w * 0.8, h * 0.22, 'rgba(240,232,214,0.55)');
  for (let i = 0; i < 8; i++) { rect(ctx, x + r() * w, y, 1, h, 'rgba(30,24,18,0.2)'); rect(ctx, x, y + r() * h, w, 1, 'rgba(255,250,235,0.14)'); }
  wear(ctx, x, y, w, h, r, 1.6);
};
const RUST = [['#7a3a1c', '#b8642a'], ['#6a2e18', '#a0552a'], ['#5a3424', '#8a5a3a']] as const;
/** A tin rusted through, its paper label mostly peeled away. */
const rusttin: Painter = (ctx, x, y, w, h, v, r) => {
  const [dark, light] = pickOf(RUST, v);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, light); g.addColorStop(1, dark);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const lx = x + w * (0.15 + r() * 0.3), lw = w * (0.25 + r() * 0.3);
  rect(ctx, lx, y + h * 0.15, lw, h * 0.7, pickOf(['#b8a890', '#a89a7a', '#9a8c74'], v));
  text(ctx, pickOf(['BEA', 'TOMA', 'PE'], v), lx + lw * 0.5, y + h * 0.5, lw * 0.9, h * 0.3, 'rgba(90,40,30,0.6)');
  for (let i = 0; i < 28; i++) circle(ctx, x + r() * w, y + r() * h, 0.6 + r() * 2, r() < 0.5 ? 'rgba(60,24,10,0.5)' : 'rgba(190,110,50,0.4)');
  for (let i = 0; i < 6; i++) rect(ctx, x + r() * w, y + r() * h * 0.3, 1 + r(), h * (0.3 + r() * 0.6), 'rgba(70,30,12,0.35)');
};
const OLDBOTTLE = [['#cfc8b4', '#5a7a9a'], ['#c8c2ae', '#8a4a3a'], ['#c4c0b0', '#5a7a4a']] as const;
/** An empty bottle's sleeve: scuffed plastic showing through, a torn remnant of the label. */
const oldbottle: Painter = (ctx, x, y, w, h, v, r) => {
  const [base, print] = pickOf(OLDBOTTLE, v);
  rect(ctx, x, y, w, h, '#96927f');
  const tw = w * (0.35 + r() * 0.3), tx = x + r() * (w - tw);
  rect(ctx, tx, y + h * 0.08, tw, h * 0.84, base);
  rect(ctx, tx + tw * 0.12, y + h * 0.3, tw * 0.55, h * 0.4, print);
  for (let k = 0; k < 6; k++) rect(ctx, tx + tw - 2 + r() * 3, y + h * (k / 6), 2 + r() * 3, h / 6 + 1, '#96927f');
  for (let i = 0; i < 10; i++) rect(ctx, x + r() * w, y + r() * h, 1 + r() * w * 0.2, 1, 'rgba(60,54,40,0.3)');
  wear(ctx, x, y, w, h, r, 1.6);
};

const PAINTERS: Record<Exclude<LabelKind, 'none'>, Painter> = {
  soda, energy, tin, bottle, bigbottle, jar, cup, carton, cereal, pantry, candy, chips, snack, towels: towelsP, rolls: rollsP,
  med, pills, lotion, spray, jug, phone, tablet, blister, gadget, cartonbox, tubes, magazine, news, loaf, donuts, reel, paint,
  trash, rusttin, oldbottle,
};

/** Plain swatches, iteration 12: yellowed white / paper, tarnished metal, scuffed clouded plastic, grimy glass, dried leaf. */
const SWATCH_FILL: Record<Swatch, string> = {
  white: '#d8d0bf', metal: '#8f8b82', paper: '#cfc5ae', kraft: '#8e6c44', dark: '#2a2a28', clear: '#b9b4a4', glass: '#a2a898', soil: '#3a2a1e', leaf: '#5a5434', foil: '#9a978c',
  peel: '#d8d0bf',
};
/**
 * Roughness / metalness per label family (packaging material). Iteration 12: dull, dusty, tarnished — no glossy cans or shiny
 * foil left (real loot keeps its own fresh materials).
 */
const ORM: Partial<Record<LabelKind | `swatch:${Swatch}`, [number, number]>> = {
  soda: [0.66, 0.32], energy: [0.66, 0.32], tin: [0.72, 0.28], paint: [0.78, 0.25], bottle: [0.62, 0], bigbottle: [0.62, 0], jar: [0.78, 0],
  magazine: [0.78, 0], blister: [0.62, 0], phone: [0.72, 0], tablet: [0.72, 0], chips: [0.66, 0.05], snack: [0.68, 0.04],
  trash: [0.88, 0], rusttin: [0.92, 0.12], oldbottle: [0.64, 0],
  'swatch:metal': [0.66, 0.42], 'swatch:clear': [0.48, 0], 'swatch:glass': [0.38, 0.04], 'swatch:dark': [0.74, 0], 'swatch:foil': [0.64, 0.36],
  'swatch:peel': [0.72, 0],
};

// ---------------------------------------------------------------------------------------
// Iteration 12 (LOOT lane): aging

/** How hard the print is aged: desaturation toward luminance, warm sepia shift, darkening, lifted blacks (faded ink). */
export const AGE = {desat: 0.6, sepia: 0.32, darken: 0.2, lift: 0.06} as const;

/** One sRGB colour (0..255) aged by `k` (0 = fresh, 1 = the station's 30 years). */
export function ageRGB(r: number, g: number, b: number, k = 1): [number, number, number] {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (c: number, t: number, f: number) => c + (t - c) * f;
  let R = mix(r, Y, AGE.desat * k), G = mix(g, Y, AGE.desat * k), B = mix(b, Y, AGE.desat * k);
  R = mix(R, Y * 1.08, AGE.sepia * k); G = mix(G, Y * 0.96, AGE.sepia * k); B = mix(B, Y * 0.76, AGE.sepia * k);
  const d = 1 - AGE.darken * k, lift = 255 * AGE.lift * k;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * d + lift)));
  return [c(R), c(G), c(B)];
}

/** A CSS colour ('#rgb', '#rrggbb', 'rgb()', 'rgba()') aged; anything else is returned unchanged. */
export function ageColor(css: string, k = 1): string {
  const t = css.trim();
  let rgb: [number, number, number] | null = null, a = 1;
  if (t[0] === '#') {
    let h = t.slice(1);
    if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
    if (h.length === 6 || h.length === 8) { const n = parseInt(h.slice(0, 6), 16); rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; if (h.length === 8) a = parseInt(h.slice(6), 16) / 255; }
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(t);
    if (m) { const p = m[1].split(',').map(x => parseFloat(x)); if (p.length >= 3 && p.every(Number.isFinite)) { rgb = [p[0], p[1], p[2]]; if (p.length > 3) a = p[3]; } }
  }
  if (!rgb) return css;
  const [R, G, B] = ageRGB(rgb[0], rgb[1], rgb[2], k);
  return a >= 1 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${a})`;
}

const RAW = Symbol('raw-gradient');
/** A 2D context whose every fill / stroke colour (and gradient stop) is aged on the way in: the painters stay as authored. */
export function agedContext(ctx: Ctx, k = 1): Ctx {
  const grad = (g: CanvasGradient): CanvasGradient => new Proxy(g, {
    get(t, p) {
      if (p === RAW) return t;
      if (p === 'addColorStop') return (o: number, c: string) => t.addColorStop(o, ageColor(c, k));
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return new Proxy(ctx, {
    get(t, p) {
      if (p === 'createLinearGradient' || p === 'createRadialGradient') {
        const f = Reflect.get(t, p, t) as (...a: number[]) => CanvasGradient;
        return (...a: number[]) => grad(f.apply(t, a));
      }
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, p, v) {
      if (p === 'fillStyle' || p === 'strokeStyle') v = typeof v === 'string' ? ageColor(v, k) : (v as {[RAW]?: unknown})?.[RAW] ?? v;
      return Reflect.set(t, p, v, t);
    },
  });
}

/** Food / drink / medicine print (mould specks, more staining). */
const FOODISH = new Set<string>(['soda', 'energy', 'tin', 'bottle', 'bigbottle', 'jar', 'cup', 'carton', 'cereal', 'pantry', 'candy', 'chips', 'snack', 'med', 'pills', 'loaf', 'donuts']);

/** Thirty years on a cell: sun-bleached side, water-stain rings, grime / dust, a torn corner, mould specks on food print. */
function ageCell(ctx: Ctx, x: number, y: number, w: number, h: number, label: string, r: R): void {
  // sun-bleach: one side washed out toward a dusty beige
  const side = Math.floor(r() * 3);
  const g = side === 0 ? ctx.createLinearGradient(x, 0, x + w, 0) : side === 1 ? ctx.createLinearGradient(x + w, 0, x, 0) : ctx.createLinearGradient(0, y, 0, y + h);
  const bleach = 0.2 + r() * 0.18;
  g.addColorStop(0, `rgba(214,204,180,${bleach})`); g.addColorStop(0.55, 'rgba(214,204,180,0)'); g.addColorStop(1, 'rgba(214,204,180,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  // water stains: a tide-mark ring with a darker inside
  for (let i = 0, n = 1 + Math.floor(r() * 2); i < n; i++) {
    const cx = x + r() * w, cy = y + h * (0.4 + r() * 0.6), rx = w * (0.15 + r() * 0.25), ry = h * (0.12 + r() * 0.25);
    ellipse(ctx, cx, cy, rx, ry, 'rgba(110,86,52,0.16)');
    ctx.strokeStyle = 'rgba(80,60,34,0.32)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // grime / dust (heavier than the old shelf wear)
  wear(ctx, x, y, w, h, r, 2.2);
  for (let i = 0; i < 10; i++) { ctx.fillStyle = `rgba(52,44,32,${0.06 + r() * 0.1})`; ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * w * 0.25, 1 + r() * 2); }
  // torn / scuffed corner
  if (r() < 0.6) {
    const cw = w * (0.08 + r() * 0.14), ch = h * (0.1 + r() * 0.2);
    const cx = r() < 0.5 ? x : x + w - cw, cy = r() < 0.5 ? y : y + h - ch;
    rect(ctx, cx, cy, cw, ch, 'rgba(120,104,78,0.75)');
  }
  // mould / spoilage specks on food print
  if (FOODISH.has(label)) for (let c = 0, n = 1 + Math.floor(r() * 3); c < n; c++) {
    const mx = x + r() * w, my = y + r() * h;
    for (let i = 0; i < 8; i++) circle(ctx, mx + (r() - 0.5) * w * 0.2, my + (r() - 0.5) * h * 0.2, 0.5 + r() * 1.6, r() < 0.5 ? 'rgba(96,112,84,0.45)' : 'rgba(170,170,150,0.35)');
  }
}

let colorTex: THREE.CanvasTexture | null = null;
let ormTex: THREE.CanvasTexture | null = null;
let material: THREE.MeshStandardMaterial | null = null;

function drawAtlas(): THREE.CanvasTexture {
  const L = atlasLayout();
  const t = canvasTexture(L.width, L.height, 80801, (ctx, w, h, r) => {
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    for (const [key, c] of L.cells) {
      const [kind, vs] = key.split(':');
      if (kind === 'swatch') { rect(ctx, c.x - PAD, c.y - PAD, c.w + 2 * PAD, c.h + 2 * PAD, SWATCH_FILL[vs as Swatch]); continue; }
      const p = PAINTERS[kind as Exclude<LabelKind, 'none'>];
      const fw = c.front ? Math.round(c.w * c.front) : c.w;
      // iteration 12: every colour aged on the way in (faded, desaturated, warm), then the cell's own 30 years of wear
      const actx = agedContext(ctx, 1);
      // gutter: a first pass scaled over the padded rect bleeds the cell's own colours into the 2 px
      // padding (mip-mapping then never samples a neighbour's print), then the cell itself.
      ctx.save(); ctx.translate(c.x - PAD, c.y - PAD); ctx.scale((c.w + 2 * PAD) / c.w, (c.h + 2 * PAD) / c.h);
      p(actx, 0, 0, c.w, c.h, Number(vs), r, fw);
      ctx.restore();
      p(actx, c.x, c.y, c.w, c.h, Number(vs), r, fw);
      ageCell(ctx, c.x, c.y, c.w, c.h, kind, r);
      if (c.front) {
        // printed cartons: a slightly darker fold line round each panel, so a row of identical boxes reads
        // as separate boxes (their edges), not one continuous print
        ctx.strokeStyle = 'rgba(24,20,16,0.3)'; ctx.lineWidth = 1;
        ctx.strokeRect(c.x + 0.5, c.y + 0.5, fw - 1, c.h - 1);
        if (c.w - fw > 2) ctx.strokeRect(c.x + fw + 0.5, c.y + 0.5, c.w - fw - 1, c.h - 1);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.name = 'shelf-stock-labels';
  return t;
}

function drawOrm(): THREE.CanvasTexture {
  const L = atlasLayout();
  const k = 8;
  const W = L.width / k, H = L.height / k;
  const t = canvasTexture(W, H, 80802, ctx => {
    ctx.fillStyle = 'rgb(255,209,0)'; ctx.fillRect(0, 0, W, H); // default: paper (rough 0.82, no metal)
    for (const [key, c] of L.cells) {
      const fam = key.split(':')[0];
      const o = ORM[(fam === 'swatch' ? key : fam) as keyof typeof ORM];
      if (!o) continue;
      ctx.fillStyle = `rgb(255,${Math.round(o[0] * 255)},${Math.round(o[1] * 255)})`;
      ctx.fillRect(Math.floor((c.x - PAD) / k), Math.floor((c.y - PAD) / k), Math.ceil((c.w + 2 * PAD) / k) + 1, Math.ceil((c.h + 2 * PAD) / k) + 1);
    }
  }, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.name = 'shelf-stock-orm';
  return t;
}

/** The one shared filler material (atlas print x vertex colour; roughness / metalness per packaging). */
export function stockMaterial(): THREE.MeshStandardMaterial {
  if (!material) {
    colorTex = drawAtlas();
    ormTex = drawOrm();
    material = new THREE.MeshStandardMaterial({map: colorTex, vertexColors: true, roughnessMap: ormTex, metalnessMap: ormTex, roughness: 1, metalness: 1});
    material.name = 'shelf-stock';
  }
  return material;
}

/** GPU texture bytes of the atlas (+ mips) and the roughness / metalness map (QA budget). */
export function stockTextureBytes(): number {
  const L = atlasLayout();
  return Math.round(L.width * L.height * 4 * 4 / 3 + (L.width / 8) * (L.height / 8) * 4 * 4 / 3);
}

export function disposeStockAssets(): void {
  material?.dispose(); colorTex?.dispose(); ormTex?.dispose();
  material = null; colorTex = null; ormTex = null;
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}

// ---------------------------------------------------------------------------------------
// Geometry builder

class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vert(p: V3, n: V3, u: number, v: number, c: C3): number {
    this.pos.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.nor.push(n[0] / l, n[1] / l, n[2] / l);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }
  /** Triangle wound counter-clockwise as seen from the side `n` points to. */
  tri(a: number, b: number, c: number, n: V3): void {
    const P = this.pos;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    if (gx * n[0] + gy * n[1] + gz * n[2] < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  /** Flat quad p0..p3 (in order around), UV rect corners matched to p0 (u0,v0), p1 (u1,v0), p2 (u1,v1), p3 (u0,v1). */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, n: V3, uv: UVRect, c: C3): void {
    const a = this.vert(p0, n, uv[0], uv[1], c), b = this.vert(p1, n, uv[2], uv[1], c), d = this.vert(p2, n, uv[2], uv[3], c), e = this.vert(p3, n, uv[0], uv[3], c);
    this.tri(a, b, d, n);
    this.tri(a, d, e, n);
  }
  /**
   * Box with per-face UV rects (each face mapped upright as seen from outside: front +Z / back -Z
   * / sides / top read with +Y or -Z up).
   */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: {pz: UVRect; nz: UVRect; px: UVRect; nx: UVRect; py: UVRect; ny: UVRect}, c: C3): void {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], f.pz, c);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], f.nz, c);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], f.px, c);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], f.nx, c);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], f.py, c);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], f.ny, c);
  }
  /** Same UV on every face. */
  solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uv: UVRect, c: C3): void {
    this.box(x0, y0, z0, x1, y1, z1, {pz: uv, nz: uv, px: uv, nx: uv, py: uv, ny: uv}, c);
  }
  /**
   * Smooth band of a body of revolution (axis Y): radius r0 at y0 to r1 at y1, `seg` sides. `wrap`
   * maps the label around (u = 0.5 at the front, +Z), else a swatch. Elliptic: x radius * sx.
   */
  band(r0: number, y0: number, r1: number, y1: number, seg: number, uv: UVRect, wrap: boolean, c: C3): void {
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const base = this.pos.length / 3;
    for (let k = 0; k <= seg; k++) {
      const a = Math.PI + (k / seg) * Math.PI * 2;
      const s = Math.sin(a), co = Math.cos(a);
      const u = wrap ? uv[0] + (uv[2] - uv[0]) * (k / seg) : (uv[0] + uv[2]) / 2;
      const n: V3 = [s, slope, co];
      this.vert([r0 * s, y0, r0 * co], n, u, wrap ? uv[1] : (uv[1] + uv[3]) / 2, c);
      this.vert([r1 * s, y1, r1 * co], n, u, wrap ? uv[3] : (uv[1] + uv[3]) / 2, c);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2, b = a + 1, d = a + 2, e = a + 3;
      const am = Math.PI + ((k + 0.5) / seg) * Math.PI * 2;
      const n: V3 = [Math.sin(am), slope, Math.cos(am)];
      if (r0 > 1e-5 || r1 > 1e-5) { this.tri(a, d, e, n); this.tri(a, e, b, n); }
    }
  }
  /** Flat disc (cap) at height y facing up / down. uv: swatch or a rect the disc is inscribed in. */
  disc(r: number, y: number, up: boolean, seg: number, uv: UVRect, c: C3, mapped = false): void {
    const n: V3 = [0, up ? 1 : -1, 0];
    const cu = (uv[0] + uv[2]) / 2, cv = (uv[1] + uv[3]) / 2, hu = (uv[2] - uv[0]) / 2, hv = (uv[3] - uv[1]) / 2;
    const ctr = this.vert([0, y, 0], n, cu, cv, c);
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = Math.PI + (k / seg) * Math.PI * 2;
      ring.push(this.vert([r * Math.sin(a), y, r * Math.cos(a)], n, mapped ? cu + Math.sin(a) * hu : cu, mapped ? cv - Math.cos(a) * hv : cv, c));
    }
    for (let k = 0; k < seg; k++) this.tri(ctr, ring[k], ring[(k + 1) % seg], n);
  }
  /** Low-poly blob (octahedron) — blossoms, leaves, foliage. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, uv: UVRect, c: C3): void {
    const u = (uv[0] + uv[2]) / 2, v = (uv[1] + uv[3]) / 2;
    const P: V3[] = [[cx + rx, cy, cz], [cx - rx, cy, cz], [cx, cy + ry, cz], [cx, cy - ry, cz], [cx, cy, cz + rz], [cx, cy, cz - rz]];
    const F: [number, number, number][] = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [0, 4, 3], [4, 1, 3], [1, 5, 3], [5, 0, 3]];
    for (const [a, b, d] of F) {
      const n: V3 = [(P[a][0] + P[b][0] + P[d][0]) / 3 - cx, (P[a][1] + P[b][1] + P[d][1]) / 3 - cy, (P[a][2] + P[b][2] + P[d][2]) / 3 - cz];
      const ia = this.vert(P[a], n, u, v, c), ib = this.vert(P[b], n, u, v, c), id = this.vert(P[d], n, u, v, c);
      this.tri(ia, ib, id, n);
    }
  }
  /** Quad with its normal from its own corners, turned to face away from `centre` (sheared / sagging faces). */
  quadAuto(p0: V3, p1: V3, p2: V3, p3: V3, uv: UVRect, c: C3, centre: V3): void {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
    let n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const m: V3 = [(p0[0] + p1[0] + p2[0] + p3[0]) / 4 - centre[0], (p0[1] + p1[1] + p2[1] + p3[1]) / 4 - centre[1], (p0[2] + p1[2] + p2[2] + p3[2]) / 4 - centre[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) return;
    this.quad(p0, p1, p2, p3, n, uv, c);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const hex = (h: number): C3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map(c => Math.pow(c, 2.2)) as C3; // sRGB -> linear vertex colour
const WHITE: C3 = [1, 1, 1];

/** Per-variant plastic / cap / bloom tints (iteration 12: clouded, murky contents; ageVertexColors fades them further). */
const BOTTLE_TINT = [0xa8b0a8, 0xb0b8a8, 0xb8b890, 0xb08a60, 0x4a2a1a];
const BOTTLE_CAP = [0x2f6fb5, 0x1d8f6a, 0x3a7d1a, 0xf07d00, 0xc4161c];
const BIG_TINT = [0x4a2a1a, 0xa8b498, 0xa8b0a8];
const BIG_CAP = [0xc4161c, 0x1d8f3a, 0x2f6fb5];
const JAR_LID = [0x8a3a2a, 0x8a8a80, 0x3a4a2a, 0x7a6a3a];
/** Iteration 12: every jar's contents have gone over — black / grey-green mould, a dried brown crust. */
const JAR_FILL = [0x2e2a20, 0x4a4a32, 0x5a6048, 0x4a3a2a];
/** Iteration 12: empty bottles (scuffed clouded plastic) and broken glass (green / brown / clear, grimy). */
const EMPTY_TINT = [0xb4b0a0, 0xa8aca0, 0xb8b0a0];
const GLASS_TINT = [0x4a6a44, 0x5a3a20, 0x9aa298];
const RUST_RIM = [0x6a3a20, 0x5a3018, 0x6a4a34];
const PILL_BODY = [0xf2f0ea, 0xb8742a, 0xf2f0ea];
const PILL_CAP = [0x2f6fd0, 0xf2f0ea, 0xc4302a];
const SPRAY_HEAD = [0x2f6fd0, 0x3a9a48, 0xc4302a];
const JUG_CAP = [0x2f6fd0, 0x2a2c30, 0x3a9a48];
const LOTION_CAP = [0xd84a8a, 0x1d4f9a, 0xf4f4f0];
/** Iteration 12: long-dead bunches — dried brown / rust / grey heads, papery whites gone tan. */
const BLOOMS = [[0x6a3a2a, 0x7a5a44, 0x9a8a70], [0x8a7a40, 0x7a5030, 0x9a8a70], [0x5a3a4a, 0x6a4a44, 0x8a8070], [0x6a2a24, 0x5a2a20, 0x4a2020], [0xa89a80, 0x9a8a68, 0x8a8270], [0x7a4a2a, 0x6a3a24, 0x8a7a40]];
/** Withered leaves / stems (olive-brown). */
const DEAD_LEAF = [0x5a5430, 0x4a4428, 0x6a5a34];
const WRAP = [0xa67a48, 0xf2efe6, 0x2a4a3a, 0xa67a48, 0xd8c8a8, 0xf2efe6];
const POT = [0xb8603a, 0x2a2c30, 0xd8d4c8, 0x8a5a3a];

function buildArch(A: StockArch, variant: number): THREE.BufferGeometry {
  const g = new Geo();
  const {w, h, d} = A;
  const L = labelUV(A.label, variant);
  const S = (s: Swatch) => swatchUV(s);
  const v = variant;
  const r = w / 2;
  switch (A.shape) {
    case 'can': {
      // drawn-aluminium can: base taper, printed wall, neck to the lid
      const seg = 8, metal = S('metal'), lid = hex(0xb9bdc1);
      g.band(r * 0.84, 0, r, h * 0.045, seg, metal, false, lid);
      g.band(r, h * 0.045, r, h * 0.9, seg, L.all, true, WHITE);
      g.band(r, h * 0.9, r * 0.8, h, seg, metal, false, lid);
      g.disc(r * 0.8, h, true, seg, metal, hex(0xa9adb1));
      g.disc(r * 0.84, 0, false, seg, metal, lid);
      break;
    }
    case 'tin': {
      const rusty = A.id === 'canRusty';
      const seg = 8, metal = S('metal'), tinC = hex(rusty ? RUST_RIM[v % 3] : 0xa9adb0);
      g.band(r, 0, r, h * 0.07, seg, metal, false, tinC);
      g.band(r * 0.985, h * 0.07, r * 0.985, h * 0.93, seg, L.all, true, WHITE);
      g.band(r, h * 0.93, r, h, seg, metal, false, tinC);
      g.disc(r, h, true, seg, metal, rusty ? hex(0x5a3420) : hex(0x9a9ea2));
      g.disc(r, 0, false, seg, metal, tinC);
      break;
    }
    case 'bottle': {
      // PET bottle: base / lower body, printed sleeve, shoulder to the neck, cap
      const big = A.id === 'bigbottle', empty = A.id === 'bottleEmpty';
      const tint = hex(empty ? EMPTY_TINT[v % 3] : big ? BIG_TINT[v % 3] : BOTTLE_TINT[v % 5]), cap = hex(big ? BIG_CAP[v % 3] : BOTTLE_CAP[v % 5]);
      const seg = 8, clear = S('clear');
      g.band(r * 0.88, 0, r, h * 0.27, seg, clear, false, tint);
      g.band(r, h * 0.27, r, h * 0.57, seg, L.all, true, WHITE);
      g.band(r, h * 0.57, r * 0.36, h * 0.88, seg, clear, false, tint);
      if (empty && v % 3 === 1) {
        // cap long gone: an open neck
        g.band(r * 0.36, h * 0.88, r * 0.36, h, seg, clear, false, tint);
        g.disc(r * 0.3, h * 0.99, true, seg, S('dark'), hex(0x1a1a16));
      } else {
        g.band(r * 0.42, h * 0.88, r * 0.42, h, seg, S('white'), false, cap);
        g.disc(r * 0.42, h, true, seg, S('white'), cap);
      }
      g.disc(r * 0.88, 0, false, seg, clear, tint);
      break;
    }
    case 'jar': {
      const seg = 8, glass = S('glass');
      const fill = hex(JAR_FILL[v % 4]), lid = hex(JAR_LID[v % 4]);
      g.band(r * 0.92, 0, r, h * 0.2, seg, glass, false, fill);
      g.band(r, h * 0.2, r, h * 0.66, seg, L.all, true, WHITE);
      g.band(r, h * 0.66, r * 0.86, h * 0.8, seg, glass, false, fill);
      g.band(r * 0.9, h * 0.8, r * 0.9, h, seg, S('metal'), false, lid);
      g.disc(r * 0.9, h, true, seg, S('metal'), lid);
      g.disc(r * 0.92, 0, false, seg, glass, fill);
      break;
    }
    case 'cup': {
      const seg = 8;
      g.band(r * 0.74, 0, r * 0.98, h * 0.9, seg, L.all, true, WHITE);
      g.band(r, h * 0.9, r, h, seg, S('white'), false, hex(0xe8e2d0));
      g.disc(r, h, true, seg, S('foil'), hex(0xe0dccf));
      g.disc(r * 0.74, 0, false, seg, S('white'), hex(0xf2efe6));
      break;
    }
    case 'pills': {
      const seg = 6;
      const body = hex(PILL_BODY[v % 3]), cap = hex(PILL_CAP[v % 3]);
      g.band(r * 0.95, 0, r * 0.95, h * 0.18, seg, S('white'), false, body);
      g.band(r * 0.96, h * 0.18, r * 0.96, h * 0.72, seg, L.all, true, WHITE);
      g.band(r, h * 0.72, r, h, seg, S('white'), false, cap);
      g.disc(r, h, true, seg, S('white'), cap);
      g.disc(r * 0.95, 0, false, seg, S('white'), body);
      break;
    }
    case 'paint': {
      const seg = 8, metal = S('metal'), m = hex(0xb4b8bc);
      g.band(r, 0, r, h * 0.06, seg, metal, false, m);
      g.band(r * 0.995, h * 0.06, r * 0.995, h * 0.86, seg, L.all, true, WHITE);
      g.band(r, h * 0.86, r * 0.94, h * 0.95, seg, metal, false, m);
      g.disc(r * 0.94, h * 0.95, true, seg, metal, hex(0xa0a4a8));
      g.disc(r, 0, false, seg, metal, m);
      // wire handle folded down across the lid
      g.solid(-r * 0.9, h * 0.95, -0.004, r * 0.9, h, 0.004, metal, hex(0x6a6e72));
      break;
    }
    case 'reel': {
      const seg = 8, flange = hex(v % 2 ? 0xd9732a : 0x2f5f9a), dark = S('dark');
      g.band(r, 0, r, 0.012, seg, dark, false, flange);
      g.disc(r, 0.012, true, seg, dark, flange);
      g.disc(r, 0, false, seg, dark, flange);
      g.band(r * 0.8, 0.012, r * 0.8, h - 0.012, seg, S('white'), false, hex(v % 2 ? 0x2f5f9a : 0x3a9a48));
      g.band(r, h - 0.012, r, h, seg, dark, false, flange);
      g.disc(r, h, true, seg, L.all, WHITE, true);
      g.disc(r, h - 0.012, false, seg, dark, flange);
      break;
    }
    case 'gable': {
      const bh = h * 0.8, rh = h * 0.93;
      const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
      g.box(x0, 0, z0, x1, bh, z1, {pz: L.front, nz: L.front, px: L.side, nx: L.side, py: L.flap, ny: L.flap}, WHITE);
      // gable roof along X (two sloped faces) + gable ends + the sealed fin
      const white = S('paper'), cw = hex(0xf3efe6);
      g.quad([x0, bh, z1], [x1, bh, z1], [x1, rh, 0], [x0, rh, 0], [0, 0.7, 0.7], L.flap, WHITE);
      g.quad([x1, bh, z0], [x0, bh, z0], [x0, rh, 0], [x1, rh, 0], [0, 0.7, -0.7], L.flap, WHITE);
      const e0 = g.vert([x1, bh, z1], [1, 0, 0], white[0], white[1], cw), e1 = g.vert([x1, bh, z0], [1, 0, 0], white[2], white[1], cw), e2 = g.vert([x1, rh, 0], [1, 0, 0], white[0], white[3], cw);
      g.tri(e0, e1, e2, [1, 0, 0]);
      const f0 = g.vert([x0, bh, z1], [-1, 0, 0], white[0], white[1], cw), f1 = g.vert([x0, bh, z0], [-1, 0, 0], white[2], white[1], cw), f2 = g.vert([x0, rh, 0], [-1, 0, 0], white[0], white[3], cw);
      g.tri(f0, f2, f1, [-1, 0, 0]);
      g.solid(x0, rh - 0.002, -0.003, x1, h, 0.003, white, cw);
      break;
    }
    case 'box': {
      if (A.id === 'news') {
        // lying flat: the front page on top
        g.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {pz: S('paper'), nz: S('paper'), px: S('paper'), nx: S('paper'), py: L.all, ny: S('paper')}, hex(0xe6e2d6));
        break;
      }
      if (A.id === 'donutbox') {
        const L2 = atlasLayout().cells.get(`donuts:${v % 2}`)!;
        const top = Math.round(L2.h * 0.76);
        const topUV = uvOf(atlasLayout(), L2.x, L2.y, L2.w, top), sideUV = uvOf(atlasLayout(), L2.x, L2.y + top + 1, L2.w, L2.h - top - 1);
        g.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {pz: sideUV, nz: sideUV, px: sideUV, nx: sideUV, py: topUV, ny: S('white')}, WHITE);
        break;
      }
      if (A.id === 'lotion') {
        const bh = h * 0.86;
        g.box(-w / 2, 0, -d / 2, w / 2, bh, d / 2, {pz: L.front, nz: L.front, px: L.side, nx: L.side, py: L.flap, ny: L.flap}, WHITE);
        g.band(w * 0.18, bh, w * 0.18, h, 8, S('white'), false, hex(LOTION_CAP[v % 3]));
        g.disc(w * 0.18, h, true, 8, S('white'), hex(LOTION_CAP[v % 3]));
        break;
      }
      g.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {pz: L.front, nz: L.front, px: L.side, nx: L.side, py: L.flap, ny: L.flap}, WHITE);
      break;
    }
    case 'rolls': {
      g.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {pz: L.front, nz: L.front, px: L.side, nx: L.side, py: L.flap, ny: L.flap}, WHITE);
      break;
    }
    case 'pillow': {
      // Pillow bag: front / back bulging over a 4 x 4 grid, meeting at the side folds and at the flat
      // crimped seams top and bottom (a closed lens-shaped bag).
      const seamH = h * 0.07, y0 = seamH, y1 = h - seamH;
      const rows = [0, 0.18, 0.82, 1], cols = [0, 0.25, 0.75, 1];
      const bulge = (fy: number, fx: number) => Math.sin(Math.PI * fy) ** 0.6 * Math.sin(Math.PI * fx) ** 0.5;
      for (const side of [1, -1]) {
        const uvR = L.front;
        const ids: number[][] = [];
        for (let j = 0; j < rows.length; j++) {
          const row: number[] = [];
          for (let i = 0; i < cols.length; i++) {
            const fx = side > 0 ? cols[i] : 1 - cols[i];
            const px = -w / 2 + w * fx * 0.98 + w * 0.01, py = y0 + (y1 - y0) * rows[j];
            const pz = side * (d / 2) * bulge(rows[j], fx);
            const n: V3 = [(fx - 0.5) * 0.6, (rows[j] - 0.5) * 0.5, side];
            row.push(g.vert([px, py, pz], n, uvR[0] + (uvR[2] - uvR[0]) * cols[i], uvR[1] + (uvR[3] - uvR[1]) * (0.07 + 0.86 * rows[j]), WHITE));
          }
          ids.push(row);
        }
        for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < cols.length - 1; i++) {
          const n: V3 = [0, 0, side];
          g.tri(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], n);
          g.tri(ids[j][i], ids[j + 1][i + 1], ids[j + 1][i], n);
        }
      }
      // the crimped seams (two-sided strips)
      const seamC = hex(0xd8d4c8);
      for (const [ya, yb] of [[0, seamH], [y1, h]] as const) {
        g.quad([-w / 2, ya, 0.0015], [w / 2, ya, 0.0015], [w / 2, yb, 0.0015], [-w / 2, yb, 0.0015], [0, 0, 1], L.flap, seamC);
        g.quad([w / 2, ya, -0.0015], [-w / 2, ya, -0.0015], [-w / 2, yb, -0.0015], [w / 2, yb, -0.0015], [0, 0, -1], L.flap, seamC);
      }
      break;
    }
    case 'spray': {
      const bh = h * 0.7, head = hex(SPRAY_HEAD[v % 3]);
      g.box(-w / 2, 0, -d / 2, w / 2, bh, d / 2, {pz: L.front, nz: L.front, px: L.side, nx: L.side, py: L.flap, ny: L.flap}, WHITE);
      g.band(0.016, bh, 0.014, h * 0.78, 8, S('white'), false, head);
      g.solid(-0.022, h * 0.78, -d / 2 + 0.004, 0.022, h * 0.94, d / 2 - 0.004, S('white'), head);
      g.solid(-0.009, h * 0.94, -0.02, 0.009, h, d / 2 - 0.004, S('white'), head);
      g.solid(-0.006, h * 0.66, d / 2 - 0.022, 0.006, h * 0.78, d / 2 - 0.006, S('white'), head); // trigger
      break;
    }
    case 'jug': {
      const bh = h * 0.84, cap = hex(JUG_CAP[v % 3]);
      g.box(-w / 2, 0, -d / 2, w / 2, bh, d / 2, {pz: L.front, nz: L.front, px: L.side, nx: L.side, py: L.flap, ny: L.flap}, WHITE);
      // carry handle at the back top, filler neck + cap at the front
      g.solid(-0.02, bh, -d / 2 + 0.006, 0.02, bh + h * 0.13, -d / 2 + 0.03, S('white'), hex(0xeeeee8));
      g.solid(-0.02, bh + h * 0.11, -d / 2 + 0.03, 0.02, bh + h * 0.14, d / 2 - 0.045, S('white'), hex(0xeeeee8));
      g.band(0.019, bh, 0.019, h, 8, S('white'), false, cap);
      g.disc(0.019, h, true, 8, S('white'), cap);
      break;
    }
    case 'thin': {
      // magazine: cover front and back, page edges
      g.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {pz: L.all, nz: L.all, px: S('paper'), nx: S('paper'), py: S('paper'), ny: S('paper')}, WHITE);
      break;
    }
    case 'blister': {
      const card = 0.004;
      g.box(-w / 2, 0, -d / 2, w / 2, h, -d / 2 + card, {pz: L.front, nz: L.side, px: L.side, nx: L.side, py: L.side, ny: L.side}, WHITE);
      g.solid(-w * 0.36, h * 0.1, -d / 2 + card, w * 0.36, h * 0.64, d / 2, S('clear'), hex(0xdfe6ea));
      break;
    }
    case 'loaf': {
      // bevelled bag: octagonal prism along X, printed sides, tied end
      const hy = h / 2, hz = d / 2, cut = Math.min(hy, hz) * 0.35;
      const prof: [number, number][] = [[hz - cut, 0], [hz, cut], [hz, h - cut], [hz - cut, h], [-hz + cut, h], [-hz, h - cut], [-hz, cut], [-hz + cut, 0]];
      const x0 = -w / 2 + 0.012, x1 = w / 2 - 0.004;
      for (let i = 0; i < prof.length; i++) {
        const [za, ya] = prof[i], [zb, yb] = prof[(i + 1) % prof.length];
        const n: V3 = [0, (ya + yb) / 2 - hy, (za + zb) / 2];
        const uv = n[1] > 0.2 * hy || n[2] > 0 ? L.front : L.side;
        g.quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], n, uv, WHITE);
      }
      for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
        const n: V3 = [s, 0, 0];
        const ctr = g.vert([x, hy, 0], n, (L.side[0] + L.side[2]) / 2, (L.side[1] + L.side[3]) / 2, WHITE);
        const ring = prof.map(([z, y]) => g.vert([x, y, z], n, (L.side[0] + L.side[2]) / 2, (L.side[1] + L.side[3]) / 2, WHITE));
        for (let i = 0; i < ring.length; i++) g.tri(ctr, ring[i], ring[(i + 1) % ring.length], n);
      }
      g.solid(-w / 2, hy - 0.012, -0.012, x0, hy + 0.012, 0.012, S('white'), hex(v % 2 ? 0x2f6fb5 : 0xc4302a)); // twist tie
      break;
    }
    case 'bunch': {
      // galvanised bucket, kraft / paper wrap, stems, blossom dome, a few leaves
      const seg = 10, br = 0.095, bh = 0.24;
      const metal = S('metal'), zinc = hex(0xa8acae);
      g.band(br * 0.84, 0, br, bh, seg, metal, false, zinc);
      g.band(br * 1.03, bh - 0.012, br * 1.03, bh, seg, metal, false, hex(0x8a8e92));
      g.disc(br * 0.84, 0, false, seg, metal, zinc);
      g.disc(br * 0.97, bh - 0.03, true, seg, S('dark'), hex(0x1a2a2a)); // water
      // a short paper / kraft sleeve, green stems and foliage above it, then a loose dome of blooms
      const wrap = hex(WRAP[v % WRAP.length]);
      g.band(0.045, bh - 0.03, 0.078, 0.35, 8, S(v % 2 ? 'paper' : 'kraft'), false, wrap);
      const cols = BLOOMS[v % BLOOMS.length];
      const R = mulberry(9100 + v);
      const leaf = S('leaf');
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        g.solid(Math.sin(a) * 0.02 - 0.004, 0.33, Math.cos(a) * 0.02 - 0.004, Math.sin(a) * 0.02 + 0.004, 0.45, Math.cos(a) * 0.02 + 0.004, leaf, hex(DEAD_LEAF[i % 3]));
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        g.blob(Math.sin(a) * 0.058, 0.4 + R() * 0.05, Math.cos(a) * 0.058, 0.034, 0.014, 0.04, leaf, hex(DEAD_LEAF[i % 3]));
      }
      const pts: V3[] = [[0, 0.525, 0]];
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; pts.push([Math.sin(a) * 0.066, 0.47 + R() * 0.035, Math.cos(a) * 0.066]); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.5; pts.push([Math.sin(a) * 0.036, 0.505 + R() * 0.02, Math.cos(a) * 0.036]); }
      pts.forEach((p, i) => g.blob(p[0], p[1], p[2], 0.038, 0.03, 0.038, S('white'), hex(cols[i % cols.length])));
      break;
    }
    case 'plant': {
      const seg = 8, pr = 0.07, ph = 0.13;
      const pot = hex(POT[v % POT.length]);
      g.band(pr * 0.78, 0, pr, ph, seg, S('white'), false, pot);
      g.band(pr * 1.06, ph - 0.018, pr * 1.06, ph, seg, S('white'), false, pot);
      g.disc(pr * 0.78, 0, false, seg, S('white'), pot);
      g.disc(pr, ph - 0.012, true, seg, S('soil'), hex(0x3a2a1e));
      const R = mulberry(9200 + v), leaf = S('leaf');
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + R();
        const rad = 0.02 + R() * 0.028, y = ph + 0.04 + R() * 0.11;
        g.blob(Math.sin(a) * rad, y, Math.cos(a) * rad, 0.05, 0.03, 0.05, leaf, hex(DEAD_LEAF[i % 3]));
      }
      g.blob(0, ph + 0.145, 0, 0.045, 0.04, 0.045, leaf, hex(DEAD_LEAF[(v + 1) % 3]));
      break;
    }
    case 'key': {
      // flat key blank (brass / nickel): hexagonal head pierced by its ring hole, shoulder, blade with a cut edge
      // iteration 12: tarnished nickel / dulled brass
      const metal = S('metal'), col = hex(v % 2 ? 0x8e908a : 0x8a7438), cut = hex(v % 2 ? 0x6a6c68 : 0x6a5a2e);
      const t = d / 2, hr = w / 2, s60 = Math.sqrt(3) / 2;
      const hy = h - hr * s60, holeY = hy + hr * 0.28, ri = 0.0032;
      const ring = (rad: number, cy: number, k: number): [number, number] => [rad * Math.cos(k * Math.PI / 3), cy + rad * Math.sin(k * Math.PI / 3)];
      for (let k = 0; k < 6; k++) {
        const [ox0, oy0] = ring(hr, hy, k), [ox1, oy1] = ring(hr, hy, k + 1), [ix0, iy0] = ring(ri, holeY, k), [ix1, iy1] = ring(ri, holeY, k + 1);
        for (const s of [1, -1]) g.quad([ox0, oy0, s * t], [ox1, oy1, s * t], [ix1, iy1, s * t], [ix0, iy0, s * t], [0, 0, s], metal, col);
        const am = (k + 0.5) * Math.PI / 3;
        g.quad([ox0, oy0, t], [ox1, oy1, t], [ox1, oy1, -t], [ox0, oy0, -t], [Math.cos(am), Math.sin(am), 0], metal, col);
        g.quad([ix0, iy0, -t], [ix1, iy1, -t], [ix1, iy1, t], [ix0, iy0, t], [-Math.cos(am), -Math.sin(am), 0], metal, cut);
      }
      const shoulder = hy - hr * s60;
      g.solid(-w * 0.34, shoulder - 0.004, -t, w * 0.34, shoulder + 0.0015, t, metal, col);
      g.solid(-w * 0.22, 0, -t, w * 0.1, shoulder - 0.004, t, metal, col);
      g.solid(w * 0.1, 0.006, -t * 0.85, w * 0.22, shoulder - 0.006, t * 0.85, metal, cut); // the bitted edge
      break;
    }
    case 'ball': {
      // whole fruit: smooth low-poly sphere, darker underneath, a little mottled; apples carry a stem
      // iteration 12: rotten — shrivelled brown orange, blackened apples, olive lemon / lime, grey-white mould patches
      const FRUIT = [0x6a4a22, 0x4a2a1a, 0x5a5a30, 0x8a7a40, 0x4a5228];
      const MOULD = hex(0x9a9a88);
      const apple = v % 5 === 1 || v % 5 === 2;
      const rad = apple ? r * 0.94 : r, seg = 8, rings = 6;
      const peel = S('peel'), base = hex(FRUIT[v % 5]), R = mulberry(9300 + v);
      const ids: number[][] = [];
      for (let j = 0; j <= rings; j++) {
        const phi = -Math.PI / 2 + (Math.PI * j) / rings, cp = Math.cos(phi), sp = Math.sin(phi);
        const row: number[] = [];
        for (let k = 0; k <= seg; k++) {
          const a = (2 * Math.PI * k) / seg, shade = (0.74 + 0.26 * (j / rings)) * (0.93 + 0.07 * R());
          // shrivelled: the skin sags in a little here and there (always inside the round collider)
          const sag = 0.88 + 0.12 * R(), rr = rad * sag;
          const col: C3 = R() < 0.22 ? MOULD : [base[0] * shade, base[1] * shade, base[2] * shade];
          row.push(g.vert([rr * cp * Math.sin(a), rad + rr * sp, rr * cp * Math.cos(a)], [cp * Math.sin(a), sp, cp * Math.cos(a)], (peel[0] + peel[2]) / 2, (peel[1] + peel[3]) / 2, col));
        }
        ids.push(row);
      }
      for (let j = 0; j < rings; j++) for (let k = 0; k < seg; k++) {
        const am = (2 * Math.PI * (k + 0.5)) / seg, pm = -Math.PI / 2 + (Math.PI * (j + 0.5)) / rings;
        const n: V3 = [Math.cos(pm) * Math.sin(am), Math.sin(pm), Math.cos(pm) * Math.cos(am)];
        if (j > 0) g.tri(ids[j][k], ids[j][k + 1], ids[j + 1][k + 1], n);
        if (j < rings - 1) g.tri(ids[j][k], ids[j + 1][k + 1], ids[j + 1][k], n);
      }
      if (apple) g.solid(-0.0018, 2 * rad - 0.003, -0.0018, 0.0018, Math.min(h, 2 * rad + 0.009), 0.0018, S('kraft'), hex(0x5a3a1e));
      break;
    }
    // --- iteration 12 (LOOT lane): the abandoned station ----------------------------------------------------------------------
    case 'openbox': {
      // open carton: printed kraft walls, darker inside and floor, four flaps folded out (one torn off on variant 2); the flaps
      // stay inside the catalogue box (the body is 72 % x 78 % x 74 % of it — the collider fit)
      // the body is the collider (catalogue `fit` x / z): small emptied product boxes keep short, near-upright flaps
      const fit = A.fit ?? [0.72, 1, 0.74];
      const bw = w * fit[0], bd = d * fit[2], bh = h * 0.78, t = Math.min(0.004, bw * 0.05);
      const x0 = -bw / 2, x1 = bw / 2, z0 = -bd / 2, z1 = bd / 2;
      g.quad([x0, 0, z1], [x1, 0, z1], [x1, bh, z1], [x0, bh, z1], [0, 0, 1], L.front, WHITE);
      g.quad([x1, 0, z0], [x0, 0, z0], [x0, bh, z0], [x1, bh, z0], [0, 0, -1], L.front, WHITE);
      g.quad([x1, 0, z1], [x1, 0, z0], [x1, bh, z0], [x1, bh, z1], [1, 0, 0], L.side, WHITE);
      g.quad([x0, 0, z0], [x0, 0, z1], [x0, bh, z1], [x0, bh, z0], [-1, 0, 0], L.side, WHITE);
      g.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, -1, 0], L.flap, WHITE);
      const kr = S('kraft'), inC = hex(0x5a4430);
      g.quad([x0 + t, t, z1 - t], [x1 - t, t, z1 - t], [x1 - t, bh, z1 - t], [x0 + t, bh, z1 - t], [0, 0, -1], kr, inC);
      g.quad([x0 + t, t, z0 + t], [x1 - t, t, z0 + t], [x1 - t, bh, z0 + t], [x0 + t, bh, z0 + t], [0, 0, 1], kr, inC);
      g.quad([x1 - t, t, z0 + t], [x1 - t, t, z1 - t], [x1 - t, bh, z1 - t], [x1 - t, bh, z0 + t], [-1, 0, 0], kr, inC);
      g.quad([x0 + t, t, z0 + t], [x0 + t, t, z1 - t], [x0 + t, bh, z1 - t], [x0 + t, bh, z0 + t], [1, 0, 0], kr, inC);
      g.quad([x0 + t, t, z0 + t], [x1 - t, t, z0 + t], [x1 - t, t, z1 - t], [x0 + t, t, z1 - t], [0, 1, 0], kr, hex(0x4a3826));
      const up = h - bh, outX = w / 2 - bw / 2, outZ = d / 2 - bd / 2;
      const flap = (along: 'x' | 'z', sgn: 1 | -1, ang: number) => {
        const out = along === 'x' ? outZ : outX, half = along === 'x' ? bw / 2 : bd / 2;
        const len = Math.min(up / Math.cos(ang), out / Math.sin(ang), half) * 0.97;
        const du = len * Math.cos(ang), dout = len * Math.sin(ang) * sgn;
        const e = along === 'x' ? z1 * sgn : x1 * sgn; // hinge line coordinate (z for front / back flaps, x for side flaps)
        const p0: V3 = along === 'x' ? [x0, bh, e] : [e, bh, z0], p1: V3 = along === 'x' ? [x1, bh, e] : [e, bh, z1];
        const p2: V3 = along === 'x' ? [x1, bh + du, e + dout] : [e + dout, bh + du, z1], p3: V3 = along === 'x' ? [x0, bh + du, e + dout] : [e + dout, bh + du, z0];
        const no: V3 = along === 'x' ? [0, -Math.sin(ang), Math.cos(ang) * sgn] : [Math.cos(ang) * sgn, -Math.sin(ang), 0];
        g.quad(p0, p1, p2, p3, no, L.flap, WHITE);
        g.quad(p0, p1, p2, p3, [-no[0], -no[1], -no[2]], kr, inC);
      };
      const R = mulberry(9400 + v);
      flap('x', 1, 0.5 + R() * 0.5);
      flap('x', -1, 0.5 + R() * 0.5);
      // small emptied product boxes: the end flaps are torn off (and the piece stays cheap: 56 vertices)
      if (w >= 0.2) {
        flap('z', 1, 0.45 + R() * 0.5);
        if (v % 3 !== 2) flap('z', -1, 0.45 + R() * 0.5);
      }
      break;
    }
    case 'crushed': {
      // collapsed carton: the top sheared sideways and sagging at one end (mirrored on odd variants)
      const m = v % 2 ? -1 : 1, a = w * 0.1, zt = d / 2 * 0.96;
      const X = (x: number) => x * m;
      const B: V3[] = [[X(-w / 2), 0, -d / 2], [X(w / 2 - a), 0, -d / 2], [X(w / 2 - a), 0, d / 2], [X(-w / 2), 0, d / 2]];
      const T: V3[] = [[X(-w / 2 + a), h, -zt], [X(w / 2), h * 0.58, -zt], [X(w / 2), h * 0.62, zt], [X(-w / 2 + a), h * 0.96, zt]];
      const ctr: V3 = [0, h / 2, 0];
      g.quadAuto(B[3], B[2], T[2], T[3], L.front, WHITE, ctr);
      g.quadAuto(B[1], B[0], T[0], T[1], L.front, WHITE, ctr);
      g.quadAuto(B[2], B[1], T[1], T[2], L.side, WHITE, ctr);
      g.quadAuto(B[0], B[3], T[3], T[0], L.side, WHITE, ctr);
      g.quadAuto(T[0], T[1], T[2], T[3], L.flap, WHITE, ctr);
      g.quadAuto(B[0], B[1], B[2], B[3], L.flap, WHITE, ctr);
      break;
    }
    case 'crumple': {
      // crumpled wrapper / paper wad: a few faceted lumps, each sampling a different patch of the scrap print
      const m = v % 2 ? -1 : 1;
      const sub = (fx: number, fy: number): UVRect => { const u = L.all[0] + (L.all[2] - L.all[0]) * fx, vv = L.all[1] + (L.all[3] - L.all[1]) * fy; return [u, vv, u, vv]; };
      const lumps: [number, number, number, number, number, number, number, number][] = [
        [0, 0.45, 0, 0.38, 0.42, 0.38, 0.5, 0.5], [0.18, 0.4, -0.12, 0.28, 0.36, 0.3, 0.2, 0.3], [-0.16, 0.38, 0.14, 0.3, 0.34, 0.3, 0.8, 0.7], [0.05, 0.62, 0.08, 0.22, 0.3, 0.22, 0.35, 0.8],
      ];
      lumps.forEach(([cx, cy, cz, rx, ry, rz, fu, fv], i) => g.blob(cx * w * m, cy * h, cz * d, rx * w, ry * h, rz * d, sub(fu, fv), i % 2 ? hex(0xe8e2d4) : WHITE));
      break;
    }
    case 'flatbag': {
      // a deflated snack bag lying flat, torn open at one corner: bulging printed top over a 4 x 4 grid, seams at the ends
      const cols = [0, 0.25, 0.75, 1], rows = [0, 0.3, 0.7, 1];
      const ids: number[][] = [];
      const top: V3[][] = [];
      for (let j = 0; j < rows.length; j++) {
        const row: number[] = [], prow: V3[] = [];
        for (let i = 0; i < cols.length; i++) {
          const fx = cols[i], fz = rows[j];
          const bulge = Math.sin(Math.PI * fx) ** 0.6 * Math.sin(Math.PI * fz) ** 0.6;
          // the torn corner (variant-dependent) is ripped back and lies flat
          const torn = (i === (v % 2 ? 3 : 0)) && j === 3;
          const px = -w / 2 + w * (torn ? fx * 0.9 + (v % 2 ? 0 : 0.06) : fx), pz = -d / 2 + d * (torn ? 0.9 : fz);
          const py = torn ? h * 0.15 : h * (0.25 + 0.75 * bulge);
          const P: V3 = [px, py, pz];
          prow.push(P);
          row.push(g.vert(P, [(fx - 0.5) * 0.5, 1, (fz - 0.5) * 0.5], L.front[0] + (L.front[2] - L.front[0]) * fx, L.front[1] + (L.front[3] - L.front[1]) * fz, WHITE));
        }
        ids.push(row); top.push(prow);
      }
      for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < cols.length - 1; i++) {
        g.tri(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], [0, 1, 0]);
        g.tri(ids[j][i], ids[j + 1][i + 1], ids[j + 1][i], [0, 1, 0]);
      }
      // skirt down to the floor round the edge (seams / folds), and the flat underside
      const ctr: V3 = [0, h / 2, 0], seamC = hex(0xb8b2a4);
      const ring: V3[] = [...top[0], ...top.slice(1).map(rw => rw[cols.length - 1]), ...top[rows.length - 1].slice(0, -1).reverse(), ...top.slice(1, -1).map(rw => rw[0]).reverse()];
      for (let k = 0; k < ring.length; k++) {
        const a0 = ring[k], a1 = ring[(k + 1) % ring.length];
        g.quadAuto([a0[0], 0, a0[2]], [a1[0], 0, a1[2]], a1, a0, L.flap, seamC, ctr);
      }
      g.quad([-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2], [0, -1, 0], L.side, WHITE);
      break;
    }
    case 'crushcan': {
      // a stamped-flat drinks can: squashed to half height, the wall bulging out and folding in
      const seg = 8, metal = S('metal'), lid = hex(0x8a8a84);
      g.band(r * 0.78, 0, r * 0.86, h * 0.08, seg, metal, false, lid);
      g.band(r * 0.86, h * 0.08, r * 0.99, h * 0.45, seg, L.all, true, WHITE);
      g.band(r * 0.99, h * 0.45, r * 0.8, h * 0.82, seg, L.all, true, WHITE);
      g.band(r * 0.8, h * 0.82, r * 0.68, h, seg, metal, false, lid);
      g.disc(r * 0.68, h, true, seg, metal, hex(0x7a7a74));
      g.disc(r * 0.78, 0, false, seg, metal, lid);
      break;
    }
    case 'shard': {
      // broken bottle: grimy glass lower body with the torn label sleeve, a jagged crown, dark inside
      const seg = 8, glass = S('glass'), tint = hex(GLASS_TINT[v % 3]), rr = r * 0.95;
      g.band(rr * 0.88, 0, rr, h * 0.18, seg, glass, false, tint);
      g.band(rr, h * 0.18, rr, h * 0.5, seg, L.all, true, WHITE);
      g.band(rr, h * 0.5, rr * 0.97, h * 0.62, seg, glass, false, tint);
      g.disc(rr * 0.88, 0, false, seg, glass, tint);
      const R = mulberry(9500 + v), y0 = h * 0.62, rc = rr * 0.97, inner = hex(0x1e221c);
      const jag = Array.from({length: seg}, (_, k) => h * (0.64 + (k % 2 ? 0.08 + R() * 0.12 : 0.22 + R() * 0.14)));
      for (let k = 0; k < seg; k++) {
        const a0 = Math.PI + (k / seg) * Math.PI * 2, a1 = Math.PI + ((k + 1) / seg) * Math.PI * 2;
        const b0: V3 = [rc * Math.sin(a0), y0, rc * Math.cos(a0)], b1: V3 = [rc * Math.sin(a1), y0, rc * Math.cos(a1)];
        const t0: V3 = [rc * Math.sin(a0), Math.min(h, jag[k]), rc * Math.cos(a0)], t1: V3 = [rc * Math.sin(a1), Math.min(h, jag[(k + 1) % seg]), rc * Math.cos(a1)];
        const am = (a0 + a1) / 2, no: V3 = [Math.sin(am), 0, Math.cos(am)];
        g.quad(b0, b1, t1, t0, no, glass, tint);
        g.quad(b0, b1, t1, t0, [-no[0], 0, -no[2]], S('dark'), inner);
      }
      // the inside of the remaining body (seen over the crown) and its floor
      for (let k = 0; k < seg; k++) {
        const a0 = Math.PI + (k / seg) * Math.PI * 2, a1 = Math.PI + ((k + 1) / seg) * Math.PI * 2, ri = rc * 0.96, am = (a0 + a1) / 2;
        g.quad([ri * Math.sin(a0), h * 0.06, ri * Math.cos(a0)], [ri * Math.sin(a1), h * 0.06, ri * Math.cos(a1)], [ri * Math.sin(a1), y0, ri * Math.cos(a1)], [ri * Math.sin(a0), y0, ri * Math.cos(a0)], [-Math.sin(am), 0, -Math.cos(am)], S('dark'), inner);
      }
      g.disc(rc * 0.98, h * 0.06, true, seg, S('dark'), inner);
      break;
    }
  }
  ageVertexColors(g, A);
  return g.build();
}

/**
 * Iteration 12 (LOOT lane): vertex colours (plastic / glass / caps / blooms, and the WHITE that shows the atlas print) faded toward
 * their luminance, warmed and darkened — the label atlas is aged separately (agedContext / ageCell).
 */
export const VERTEX_AGE = {desat: 0.45, warm: [1, 0.95, 0.82] as const, darken: 0.86} as const;
function ageVertexColors(g: Geo, _A: StockArch): void {
  const c = g.col;
  for (let i = 0; i < c.length; i += 3) {
    const Y = 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
    for (let k = 0; k < 3; k++) c[i + k] = (c[i + k] + (Y - c[i + k]) * VERTEX_AGE.desat) * VERTEX_AGE.warm[k] * VERTEX_AGE.darken;
  }
}

const mulberry = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const geoCache = new Map<number, THREE.BufferGeometry>();
/** Shared template geometry of archetype `a`, label / colourway `variant` (cached; never dispose it from a mesh). */
export function archGeometry(a: number, variant: number): THREE.BufferGeometry {
  const A = STOCK_ARCHES[a];
  const v = ((variant % A.variants) + A.variants) % A.variants;
  const key = a * 64 + v;
  let g = geoCache.get(key);
  if (!g) { g = buildArch(A, v); g.userData.shared = true; geoCache.set(key, g); }
  return g;
}

/** Triangles of one piece of archetype `a` (stats). */
export function archTriangles(a: number): number {
  const g = archGeometry(a, 0);
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}
