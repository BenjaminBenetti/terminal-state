// Task mall-playtest-revision-20261031 (lane ARCH, D06: "certainly the stores would have like pictures of people wearing the
// clothes ... some billboards make some ads"). Advertising ART + RECORDS for the mall — rendered by MallArch.buildAds (atlas pages,
// instanced faces, bounded draw calls):
//  - records: lane SHOPS places in-shop / shopfront ads as `layout.mall.ads` (MallAd: poster / lightbox / billboard / decal, program
//    theme, face centre + normal + size, seed); lane ARCH adds gallery billboards on long blank public walls (planGalleryAds) and
//    nothing else — never in front of a door, a shopfront, a prop or another sign;
//  - art: ORIGINAL LOCAL VECTOR CANVAS DRAWING only (this file; no photos, no provider / image generation, no asset files): fictional
//    brands (the shop's own fictional brand from layout.mall.shops, else the seeded mall name), generic headlines, and per program a
//    motif — GENERIC DRESSED ADULT SILHOUETTES for fashion (coat / dress / suit / casual / skirt figures: featureless flat heads, no
//    faces, no likeness, no real brand / logo), product shapes for electronics / phones, food for food / cafe / grocery, crosses and
//    capsules for pharmacy / clinic, balls / runners / peaks for sports / outdoors, and simple pictograms for the rest; aged (sun
//    fade, grime from the top, scratches, a torn corner on paper posters).
// Provenance: drawn procedurally at load from these functions + a seed; reproducible; nothing derived from external imagery.
//
// Task mall-round3-20261031 (lane SHOPS, R5 — user: "there are no adds ... on kiosks, and as posters in the store and stuff"): + the
// women's fashion program (womenswear: its own palette / headlines, dress / skirt / coat figures, some with longer hair — generic,
// featureless), kiosk palettes / motifs from the kiosk brand, food-counter MENU boards (cuisine item lists + prices: generic dishes,
// no brands), kiosk-cart HEADER signs, lighter window vinyl (white-ish figures + a sale band: readable against a dark shop behind the
// glass), and planGalleryAds' second tier: backlit WALL LIGHTBOXES (portrait, eye level) on the public walls between openings, each
// advertising one of the mall's own stores. Same canvas recipes, same provenance.

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {attribute, texture, uniform} from 'three/tsl';
import type {MallProgram} from '../gen/mall/mallTypes';
import type {StationLayout} from '../gen/stationTypes';
import {CELL} from '../gen/grid';
import {canvasTexture} from './canvasTextures';
import {SIGN_ATLAS_CONTEXT, SIGN_ATLAS_UV} from './surfaceNodes';

/** (R5) Backlight gain of the backlit ad faces (QA tune: `__LL.mallAds({glow})`); per face x its aGlow (the record's glow). */
export const AD_GLOW_DEFAULT = 0.8;
export const AD_GLOW = uniform(AD_GLOW_DEFAULT);

/**
 * (R5) The ad atlas material: the builder's sign-atlas program (lit like every wall: the light field) + EMISSIVE backlight = the atlas
 * colour x the per-instance `aGlow` (0 = paper / vinyl / a dead box) x AD_GLOW — one material per atlas page, no extra draw call.
 * Cut-out pages (window vinyl): alpha-tested, double-sided, no backlight.
 */
export function adAtlasMaterial(atlas: THREE.Texture, cutout: boolean): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({map: atlas, roughness: 0.6});
  m.contextNode = SIGN_ATLAS_CONTEXT;
  if (cutout) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.transparent = false; m.name = 'mall-ad-decal-atlas'; return m; }
  m.emissiveNode = texture(atlas, SIGN_ATLAS_UV).rgb.mul(attribute('aGlow', 'float')).mul(AD_GLOW);
  m.name = 'mall-ad-atlas';
  return m;
}

/** One advertisement face (pure data; no collider, never a prop: nothing to open / move / classify). */
export interface MallAd {
  /** poster = paper in a snap frame on a wall; lightbox = 0.12 m deep box on a wall; billboard = a big framed panel; decal = vinyl
   *  on shopfront glass (cut-out, both faces); (R5) menu = a 0.1 m deep backlit menu board on a food counter's wall; cart = a
   *  double-faced backlit header sign standing on a kiosk cart's canopy (centre = the sign's mid-plane). */
  kind: 'poster' | 'lightbox' | 'billboard' | 'decal' | 'menu' | 'cart';
  /** Theme: the program it advertises (fashion programs -> dressed adult silhouettes), or 'mall' (centre-wide ads). */
  program: MallProgram | 'mall';
  /** MallShop.id it belongs to (its fictional brand is printed); none = a gallery ad (the mall's own name). */
  shop?: string;
  level: number;
  /** Centre of the face ON the wall plane (decals: on the glass plane; world m, absolute y — the renderer stands the frame / box
   *  proud of it) and its unit axis-aligned normal (into the room it is seen from). */
  x: number; y: number; z: number; nx: number; nz: number;
  /** Face size (m). */
  w: number; h: number;
  seed: number;
  /** (R5, = gen/mall/ads.ts MallAdSlot) header / eye / window / display / menu / cart / gallery. */
  slot?: 'header' | 'eye' | 'window' | 'display' | 'menu' | 'cart' | 'gallery';
  /** (R5) Backlight of the backlit kinds (1 lit, ~0.3-0.5 dim, 0 dead); absent = unlit (paper / vinyl). Drawn as emissive. */
  glow?: number;
  /** (R5) Advertiser of a record without a shop (kiosk carts). */
  brand?: string;
  /** (R5) Menu boards: the cuisine / café menu. */
  cuisine?: string;
}

/** (R5) Backlit kinds (emissive faces in world/mallArch.ts buildAds). */
export const LIT_KINDS: ReadonlySet<MallAd['kind']> = new Set(['lightbox', 'billboard', 'menu', 'cart']);
/** (R5) The backlight level a face is drawn with: the record's glow, else 1 for a backlit kind / 0 for paper / vinyl. */
export const adGlowOf = (ad: Pick<MallAd, 'kind' | 'glow'>): number => (LIT_KINDS.has(ad.kind) ? Math.max(0, Math.min(1, ad.glow ?? 1)) : 0);

/** The ads lane SHOPS placed (`layout.mall.ads`; read loosely so a layout without the field has none). */
export function adsOf(layout: StationLayout): MallAd[] {
  const a = (layout.mall as {ads?: unknown} | undefined)?.ads;
  return Array.isArray(a) ? (a as MallAd[]).filter(q => q && Number.isFinite(q.x) && Number.isFinite(q.z) && q.w > 0.05 && q.h > 0.05) : [];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Art

/** Palette per theme: background, second background, ink, accent, garment colours. */
interface AdPalette { bg: string; bg2: string; ink: string; accent: string; cloth: string[] }
const FASHION: MallProgram[] = ['clothing', 'department', 'shoes', 'beauty', 'jewelry', 'luggage', 'optical', 'womenswear'];
const PAL: Partial<Record<MallProgram | 'mall', AdPalette>> = {
  clothing: {bg: '#e9dccb', bg2: '#c9a27a', ink: '#2b211a', accent: '#8a3b2e', cloth: ['#7a2e2a', '#2f3b52', '#c8a26a', '#3e4a3a', '#d9cfc0', '#5a4a6a']},
  // (R5) women's fashion: blush / ivory / plum, jewel-tone garments
  womenswear: {bg: '#f3e6e4', bg2: '#c98f9a', ink: '#3a1f2b', accent: '#9c3a5a', cloth: ['#9c3a5a', '#e8c9b8', '#2f2a3a', '#c86a6a', '#6a4a7a', '#d9b26a', '#1f4a5a']},
  kiosk: {bg: '#f2ece0', bg2: '#e0a040', ink: '#2a2420', accent: '#d0402a', cloth: []},
  department: {bg: '#1e2a3a', bg2: '#38506a', ink: '#f2ead8', accent: '#c8a45a', cloth: ['#c8a45a', '#8a1f24', '#e9e1d4', '#2e4a32', '#5a6a8a']},
  shoes: {bg: '#f2f0ea', bg2: '#d8c8a8', ink: '#222224', accent: '#b8463a', cloth: ['#222224', '#b8463a', '#3a5a7a', '#c8a26a']},
  beauty: {bg: '#f2dcd8', bg2: '#d8a8a0', ink: '#5a2e30', accent: '#b0485a', cloth: ['#b0485a', '#f4ece6', '#5a2e30', '#c8a08a']},
  jewelry: {bg: '#141312', bg2: '#2e2a24', ink: '#e8d8a8', accent: '#b8963e', cloth: ['#e8d8a8', '#3a3a40', '#6a1f2a']},
  luggage: {bg: '#4e3a2a', bg2: '#7a5a40', ink: '#f0e4d0', accent: '#c8a070', cloth: ['#c8a070', '#2a3a4a', '#e0d4c0']},
  optical: {bg: '#f4f6f8', bg2: '#c8d4e0', ink: '#2c4a6a', accent: '#2c4a6a', cloth: ['#2c4a6a', '#8a9aaa', '#d8b48a']},
  electronics: {bg: '#101216', bg2: '#163a4a', ink: '#e8f6fa', accent: '#2ac0e0', cloth: []},
  phone: {bg: '#f4f4f2', bg2: '#e0702a', ink: '#202224', accent: '#e0702a', cloth: []},
  arcade: {bg: '#0e0e14', bg2: '#3a0e3a', ink: '#ff6ad0', accent: '#2ad0d8', cloth: []},
  music: {bg: '#141416', bg2: '#3a1e5a', ink: '#efe6ff', accent: '#9a5ad8', cloth: []},
  'food-court': {bg: '#b03a2e', bg2: '#f2c14e', ink: '#fff4e0', accent: '#f2c14e', cloth: []},
  cafe: {bg: '#3a2618', bg2: '#6a4a30', ink: '#f4e6cc', accent: '#c88a4a', cloth: []},
  grocery: {bg: '#3e6a3a', bg2: '#8ab05a', ink: '#f4f2e0', accent: '#e8c84a', cloth: []},
  pharmacy: {bg: '#f2f4f2', bg2: '#bfe3d4', ink: '#1e6e58', accent: '#2fa37f', cloth: []},
  clinic: {bg: '#e8f0f4', bg2: '#b8d0dc', ink: '#1f4d66', accent: '#d23c3c', cloth: []},
  sports: {bg: '#23304a', bg2: '#c8323a', ink: '#ffffff', accent: '#f2c14e', cloth: ['#c8323a', '#ffffff', '#23304a', '#f2c14e']},
  outdoors: {bg: '#2e3a2a', bg2: '#5a6a3a', ink: '#efe6cf', accent: '#d9a441', cloth: ['#d9a441', '#3a5a7a', '#8a3a2a']},
  books: {bg: '#2f4a3c', bg2: '#4a6a54', ink: '#f0e6cc', accent: '#c8a050', cloth: []},
  toys: {bg: '#3a7fc1', bg2: '#e8c547', ink: '#fff8e0', accent: '#e8453a', cloth: []},
  home: {bg: '#a9b79a', bg2: '#e8e2d2', ink: '#2a3226', accent: '#8a5a3a', cloth: []},
  pet: {bg: '#3e8a80', bg2: '#f2c46a', ink: '#f4fff8', accent: '#f2c46a', cloth: []},
  florist: {bg: '#5a8a5a', bg2: '#e88aa0', ink: '#fff6f0', accent: '#e88aa0', cloth: []},
  hardware: {bg: '#d29a1e', bg2: '#1a1a1a', ink: '#1a1a1a', accent: '#f4f0e0', cloth: []},
  guns: {bg: '#1b1c1d', bg2: '#3a3a30', ink: '#e8e2d2', accent: '#c8452e', cloth: []},
  vacant: {bg: '#cfccc4', bg2: '#8a8680', ink: '#2a2826', accent: '#c8452e', cloth: []},
  mall: {bg: '#1f2b38', bg2: '#3e5a74', ink: '#f2efe6', accent: '#d9a520', cloth: ['#8a1f24', '#c8a26a', '#3e4a3a', '#e9e1d4', '#5a4a6a', '#b0485a']},
};
const GENERIC: AdPalette = {bg: '#2c3a46', bg2: '#8ab0c8', ink: '#eef2f4', accent: '#d9a520', cloth: ['#8a1f24', '#2f3b52', '#c8a26a']};
export const adPalette = (p: MallProgram | 'mall'): AdPalette => PAL[p] ?? GENERIC;

/** Generic headlines per theme (no real brands / products / slogans). */
const HEADLINES: Partial<Record<MallProgram | 'mall', string[]>> = {
  clothing: ['NEW SEASON', 'THE AUTUMN EDIT', 'LAYER UP', 'WEEKEND READY', 'UP TO 40% OFF'],
  womenswear: ['THE DRESS EDIT', 'NEW IN: DRESSES', 'COAT WEATHER', 'THE WEEKEND EDIT', 'SPRING COLLECTION', 'UP TO 50% OFF'],
  kiosk: ['WHILE U WAIT', 'GIFTS & MORE', '2 FOR $10', 'TREAT YOURSELF', 'OPEN TODAY'],
  department: ['GRAND SALE', 'NEW SEASON', 'DRESS THE PART', 'ALL FLOORS -30%'],
  shoes: ['STEP OUT', 'NEW ARRIVALS', 'WALK TALL', '2ND PAIR HALF PRICE'],
  beauty: ['GLOW UP', 'NEW SHADES', 'SELF CARE'], jewelry: ['TIMELESS', 'FOREVER YOURS'], luggage: ['TRAVEL LIGHT', 'GO ANYWHERE'],
  optical: ['SEE CLEARLY', '2 FOR 1 FRAMES'], electronics: ['ULTRA HD', 'POWER UP', 'SMART HOME', 'NOW IN STORE'],
  phone: ['UPGRADE TODAY', 'UNLIMITED DATA', 'NEW 5G'], arcade: ['HIGH SCORE', 'DOUBLE TOKENS'], music: ['NEW RELEASES', 'LIVE SOUND'],
  'food-court': ['COMBO DEAL', 'FRESH DAILY', 'BIG BITE'], cafe: ['FRESH ROAST', 'ICED LATTE'], grocery: ['FRESH PRODUCE', 'FARM TO TABLE'],
  pharmacy: ['COLD & FLU', 'VITAMINS 2 FOR 1', 'FLU SHOTS TODAY'], clinic: ['WALK-INS WELCOME', 'CHECK-UPS'],
  sports: ['GAME ON', 'TRAIN HARDER', 'NEW KITS'], outdoors: ['GO FURTHER', 'CAMP SEASON'], books: ['BESTSELLERS', 'READ MORE'],
  toys: ['PLAY TIME', 'NEW TOYS'], home: ['HOME REFRESH', 'COSY NIGHTS'], pet: ['HAPPY PETS', 'TREAT TIME'], florist: ['FRESH BLOOMS'],
  hardware: ['DIY WEEKEND', 'TOOLS 30% OFF'], guns: ['RANGE OPEN', 'HUNTING SEASON', 'SAFETY FIRST'],
  mall: ['SUMMER SALE', 'GIFT CARDS', 'OPEN 7 DAYS', 'NEW STORES', 'SHOP LATE'],
  vacant: ['FOR LEASE', 'AVAILABLE', 'COMING SOON', 'NOW LEASING'],
};

type Ctx = CanvasRenderingContext2D;
type Rnd = () => number;
const pick = <T>(a: readonly T[], r: Rnd): T => a[Math.floor(r() * a.length) % a.length];

/** A generic dressed adult figure (front, featureless flat head; standing at foot (x, y), height h). */
export type FigureStyle = 'coat' | 'dress' | 'suit' | 'casual' | 'skirt';
/** (R5) `longHair`: a longer hair shape falling to the shoulders (still a flat silhouette: no face, no likeness). */
export function drawFigure(ctx: Ctx, x: number, y: number, h: number, style: FigureStyle, cloth: string, cloth2: string, skin: string, r: Rnd, longHair = false): void {
  const u = h / 100; // 100 units tall
  const lean = (r() - 0.5) * 3 * u, hip = r() < 0.5;
  const P = (px: number, py: number): [number, number] => [x + px * u + lean * (1 - py / 100), y - py * u];
  const poly = (pts: [number, number][], fill: string) => { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(...P(px, py)) : ctx.moveTo(...P(px, py)))); ctx.closePath(); ctx.fill(); };
  // legs + shoes (a weight shift: one leg angled)
  const legTop = style === 'dress' || style === 'coat' || style === 'skirt' ? 46 : 50;
  poly([[-8, legTop], [-1, legTop], [-3, 2], [-8, 2]], style === 'suit' ? cloth2 : style === 'casual' ? '#3a4a6a' : skin);
  poly([[1, legTop], [8, legTop], [10, 2], [5, 2]], style === 'suit' ? cloth2 : style === 'casual' ? '#3a4a6a' : skin);
  poly([[-10, 3], [-2, 3], [-2, 0], [-11, 0]], '#1a1a1c');
  poly([[4, 3], [12, 3], [13, 0], [4, 0]], '#1a1a1c');
  // arms (behind the torso), one hand on the hip
  poly([[-13, 80], [-9, 80], [-12, 50], [-16, 51]], style === 'casual' ? skin : cloth);
  if (hip) poly([[9, 80], [13, 80], [17, 64], [11, 56], [9, 60], [13, 65]], style === 'casual' ? skin : cloth);
  else poly([[9, 80], [13, 80], [16, 51], [12, 50]], style === 'casual' ? skin : cloth);
  // torso / garment
  switch (style) {
    case 'coat': poly([[-12, 82], [12, 82], [15, 36], [-15, 36]], cloth); poly([[-1, 82], [1, 82], [1, 38], [-1, 38]], cloth2); poly([[-13, 58], [13, 58], [13, 55], [-13, 55]], cloth2); break;
    case 'dress': poly([[-10, 82], [10, 82], [8, 62], [18, 38], [-18, 38], [-8, 62]], cloth); poly([[-8, 63], [8, 63], [8, 60], [-8, 60]], cloth2); break;
    case 'suit': poly([[-12, 82], [12, 82], [11, 50], [-11, 50]], cloth); poly([[-3, 82], [3, 82], [0, 64]], '#e9e6de'); poly([[-0.8, 80], [0.8, 80], [0.8, 64], [-0.8, 64]], cloth2); break;
    case 'casual': poly([[-12, 82], [12, 82], [11, 52], [-11, 52]], cloth); poly([[-11, 54], [11, 54], [10, 48], [-10, 48]], '#3a4a6a'); break;
    default: poly([[-11, 82], [11, 82], [10, 60], [-10, 60]], cloth2); poly([[-10, 61], [10, 61], [15, 40], [-15, 40]], cloth); break;
  }
  // neck + head (featureless), a hair shape
  if (longHair) poly([[-6.2, 93], [6.2, 93], [7, 79], [-7, 79]], '#1e1a18'); // (R5) hair behind the shoulders
  poly([[-2.5, 86], [2.5, 86], [2.5, 81], [-2.5, 81]], skin);
  const [hx, hy] = P(0, 92.5);
  ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(hx, hy, 5.2 * u, 6.5 * u, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1e1a18'; ctx.beginPath(); ctx.ellipse(hx, hy - 2.6 * u, 5.6 * u, 4.4 * u, 0, Math.PI, Math.PI * 2); ctx.fill();
}

/** Product / theme pictograms (flat vector), centred at (cx, cy), size s. */
function drawMotif(ctx: Ctx, program: MallProgram | 'mall', cx: number, cy: number, s: number, pal: AdPalette, r: Rnd): void {
  ctx.save();
  ctx.translate(cx, cy);
  const S = s / 2, fill = (c: string) => { ctx.fillStyle = c; }, stroke = (c: string, w: number) => { ctx.strokeStyle = c; ctx.lineWidth = w; };
  const rr = (x: number, y: number, w: number, h: number, rad: number) => { ctx.beginPath(); if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h); };
  const circ = (x: number, y: number, rad: number) => { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); };
  switch (program) {
    case 'electronics': { // a flat TV + a laptop
      fill('#0a0c0e'); rr(-S, -S * 0.75, S * 2, S * 1.15, S * 0.04); ctx.fill();
      const g = ctx.createLinearGradient(-S, -S, S, S * 0.4); g.addColorStop(0, pal.accent); g.addColorStop(1, pal.bg2);
      fill('rgba(0,0,0,0)'); ctx.fillStyle = g; rr(-S * 0.94, -S * 0.7, S * 1.88, S * 1.03, S * 0.02); ctx.fill();
      fill('#2a2c30'); ctx.fillRect(-S * 0.1, S * 0.4, S * 0.2, S * 0.18); ctx.fillRect(-S * 0.4, S * 0.56, S * 0.8, S * 0.06);
      break;
    }
    case 'phone': case 'arcade': { // a phone slab with a glowing screen
      fill('#1a1b1e'); rr(-S * 0.42, -S * 0.9, S * 0.84, S * 1.8, S * 0.12); ctx.fill();
      const g = ctx.createLinearGradient(0, -S, 0, S); g.addColorStop(0, pal.accent); g.addColorStop(1, pal.bg2);
      ctx.fillStyle = g; rr(-S * 0.36, -S * 0.8, S * 0.72, S * 1.58, S * 0.08); ctx.fill();
      fill('rgba(255,255,255,0.35)'); for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { rr(-S * 0.28 + i * S * 0.2, -S * 0.6 + j * S * 0.28, S * 0.14, S * 0.14, S * 0.03); ctx.fill(); }
      break;
    }
    case 'music': { // a record + headphones band
      fill('#0c0c0e'); circ(0, 0, S * 0.85); ctx.fill(); fill(pal.accent); circ(0, 0, S * 0.3); ctx.fill(); fill('#0c0c0e'); circ(0, 0, S * 0.05); ctx.fill();
      stroke(pal.ink, S * 0.08); ctx.beginPath(); ctx.arc(0, -S * 0.1, S * 1.0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      break;
    }
    case 'food-court': { // a burger + fries cone
      fill('#d8963a'); ctx.beginPath(); ctx.ellipse(-S * 0.25, -S * 0.25, S * 0.6, S * 0.38, 0, Math.PI, Math.PI * 2); ctx.fill();
      fill('#5a8a3a'); ctx.fillRect(-S * 0.85, -S * 0.27, S * 1.2, S * 0.1); fill('#6a3020'); ctx.fillRect(-S * 0.82, -S * 0.17, S * 1.14, S * 0.2);
      fill('#e8c84a'); ctx.fillRect(-S * 0.85, -S * 0.0, S * 1.2, S * 0.06); fill('#d8963a'); rr(-S * 0.82, S * 0.06, S * 1.14, S * 0.2, S * 0.08); ctx.fill();
      fill('#e8c84a'); for (let i = 0; i < 6; i++) ctx.fillRect(S * 0.45 + i * S * 0.07, -S * 0.5 + (i % 2) * S * 0.08, S * 0.05, S * 0.5);
      fill('#c8323a'); ctx.beginPath(); ctx.moveTo(S * 0.4, -S * 0.05); ctx.lineTo(S * 0.92, -S * 0.05); ctx.lineTo(S * 0.82, S * 0.5); ctx.lineTo(S * 0.5, S * 0.5); ctx.closePath(); ctx.fill();
      break;
    }
    case 'cafe': { // a cup with steam
      fill('#f4ece0'); ctx.beginPath(); ctx.moveTo(-S * 0.5, -S * 0.3); ctx.lineTo(S * 0.5, -S * 0.3); ctx.lineTo(S * 0.38, S * 0.7); ctx.lineTo(-S * 0.38, S * 0.7); ctx.closePath(); ctx.fill();
      fill(pal.accent); ctx.fillRect(-S * 0.46, S * 0.0, S * 0.92, S * 0.26); fill('#6a4a30'); rr(-S * 0.55, -S * 0.42, S * 1.1, S * 0.14, S * 0.04); ctx.fill();
      stroke('rgba(244,236,224,0.7)', S * 0.06); for (const dx of [-0.2, 0.05, 0.3]) { ctx.beginPath(); ctx.moveTo(dx * S, -S * 0.5); ctx.bezierCurveTo((dx + 0.15) * S, -S * 0.7, (dx - 0.15) * S, -S * 0.8, dx * S, -S * 1.0); ctx.stroke(); }
      break;
    }
    case 'grocery': case 'florist': { // fruit / blooms
      const cols = program === 'florist' ? ['#e88aa0', '#f2c14e', '#d8463a', '#f4ece6'] : ['#c8323a', '#e8c84a', '#5a8a3a', '#e0702a'];
      for (let i = 0; i < 5; i++) { const a = i * 1.26 + r() * 0.3, d = S * (i ? 0.48 : 0); fill(cols[i % cols.length]); circ(Math.cos(a) * d, Math.sin(a) * d * 0.8, S * 0.32); ctx.fill(); }
      fill('#3e6a3a'); ctx.beginPath(); ctx.ellipse(S * 0.1, -S * 0.55, S * 0.3, S * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'pharmacy': case 'clinic': { // a cross + capsules
      fill(program === 'clinic' ? pal.accent : pal.ink); ctx.fillRect(-S * 0.18, -S * 0.7, S * 0.36, S * 1.0); ctx.fillRect(-S * 0.5, -S * 0.38, S * 1.0, S * 0.36);
      for (const [dx, a] of [[-0.55, 0.6], [0.55, -0.5]] as const) {
        ctx.save(); ctx.translate(dx * S, S * 0.62); ctx.rotate(a);
        fill('#f4f4f2'); rr(-S * 0.3, -S * 0.11, S * 0.3, S * 0.22, S * 0.11); ctx.fill(); fill(pal.accent); rr(0, -S * 0.11, S * 0.3, S * 0.22, S * 0.11); ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'sports': { // a ball + a running figure (filled limbs)
      fill('#f4f4f2'); circ(S * 0.45, S * 0.35, S * 0.4); ctx.fill(); stroke('#1a1a1a', S * 0.05); circ(S * 0.45, S * 0.35, S * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.05, S * 0.35); ctx.lineTo(S * 0.85, S * 0.35); ctx.moveTo(S * 0.45, -S * 0.05); ctx.lineTo(S * 0.45, S * 0.75); ctx.stroke();
      stroke(pal.ink, S * 0.12); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-S * 0.45, -S * 0.5); ctx.lineTo(-S * 0.3, -S * 0.05); ctx.lineTo(-S * 0.05, S * 0.35); ctx.moveTo(-S * 0.3, -S * 0.05); ctx.lineTo(-S * 0.65, S * 0.3);
      ctx.moveTo(-S * 0.42, -S * 0.4); ctx.lineTo(-S * 0.1, -S * 0.25); ctx.moveTo(-S * 0.42, -S * 0.4); ctx.lineTo(-S * 0.75, -S * 0.2); ctx.stroke();
      fill(pal.ink); circ(-S * 0.5, -S * 0.68, S * 0.12); ctx.fill();
      break;
    }
    case 'outdoors': case 'guns': { // peaks (+ a tent / a crosshair)
      fill(pal.bg2); ctx.beginPath(); ctx.moveTo(-S, S * 0.6); ctx.lineTo(-S * 0.3, -S * 0.5); ctx.lineTo(S * 0.05, S * 0.05); ctx.lineTo(S * 0.4, -S * 0.3); ctx.lineTo(S, S * 0.6); ctx.closePath(); ctx.fill();
      fill('#f2efe6'); ctx.beginPath(); ctx.moveTo(-S * 0.3, -S * 0.5); ctx.lineTo(-S * 0.45, -S * 0.27); ctx.lineTo(-S * 0.15, -S * 0.27); ctx.closePath(); ctx.fill();
      if (program === 'outdoors') { fill(pal.accent); ctx.beginPath(); ctx.moveTo(-S * 0.1, S * 0.6); ctx.lineTo(S * 0.25, S * 0.15); ctx.lineTo(S * 0.6, S * 0.6); ctx.closePath(); ctx.fill(); }
      else { stroke(pal.accent, S * 0.06); circ(S * 0.2, S * 0.05, S * 0.45); ctx.stroke(); ctx.beginPath(); ctx.moveTo(S * 0.2, -S * 0.5); ctx.lineTo(S * 0.2, S * 0.6); ctx.moveTo(-S * 0.35, S * 0.05); ctx.lineTo(S * 0.75, S * 0.05); ctx.stroke(); }
      break;
    }
    case 'vacant': { // a key (leasing)
      stroke(pal.ink, S * 0.14); circ(-S * 0.45, 0, S * 0.32); ctx.stroke();
      fill(pal.ink); ctx.fillRect(-S * 0.15, -S * 0.07, S * 1.0, S * 0.14); ctx.fillRect(S * 0.55, S * 0.05, S * 0.12, S * 0.25); ctx.fillRect(S * 0.3, S * 0.05, S * 0.1, S * 0.18);
      break;
    }
    case 'books': for (let i = 0; i < 5; i++) { fill(['#8a2e2a', '#c8a050', '#2f4a6a', '#f0e6cc', '#4a6a3a'][i]); ctx.fillRect(-S * 0.8 + i * S * 0.08, S * 0.5 - (i + 1) * S * 0.24, S * 1.5, S * 0.21); } break;
    case 'toys': { fill('#e8453a'); ctx.fillRect(-S * 0.8, S * 0.1, S * 0.6, S * 0.6); fill('#e8c547'); ctx.fillRect(-S * 0.2, S * 0.1, S * 0.6, S * 0.6); fill('#4a9a5a'); ctx.fillRect(-S * 0.5, -S * 0.5, S * 0.6, S * 0.6); fill('#c8945a'); circ(S * 0.55, -S * 0.1, S * 0.32); ctx.fill(); circ(S * 0.38, -S * 0.42, S * 0.12); ctx.fill(); circ(S * 0.72, -S * 0.42, S * 0.12); ctx.fill(); break; }
    case 'home': { fill(pal.accent); rr(-S * 0.9, S * 0.05, S * 1.4, S * 0.45, S * 0.1); ctx.fill(); rr(-S * 0.9, -S * 0.2, S * 0.3, S * 0.6, S * 0.08); ctx.fill(); rr(S * 0.2, -S * 0.2, S * 0.3, S * 0.6, S * 0.08); ctx.fill(); fill(pal.ink); ctx.fillRect(S * 0.7, -S * 0.6, S * 0.04, S * 1.1); fill('#f2e2a0'); ctx.beginPath(); ctx.moveTo(S * 0.55, -S * 0.55); ctx.lineTo(S * 0.9, -S * 0.55); ctx.lineTo(S * 0.82, -S * 0.85); ctx.lineTo(S * 0.63, -S * 0.85); ctx.closePath(); ctx.fill(); break; }
    case 'pet': { fill(pal.ink); ctx.beginPath(); ctx.ellipse(0, S * 0.25, S * 0.4, S * 0.32, 0, 0, Math.PI * 2); ctx.fill(); for (const [dx, dy] of [[-0.5, -0.15], [-0.18, -0.5], [0.18, -0.5], [0.5, -0.15]]) { circ(dx * S, dy * S, S * 0.15); ctx.fill(); } break; }
    case 'hardware': { stroke(pal.ink, S * 0.16); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-S * 0.6, S * 0.6); ctx.lineTo(S * 0.3, -S * 0.3); ctx.stroke(); ctx.beginPath(); ctx.arc(S * 0.45, -S * 0.45, S * 0.3, 0.8, Math.PI * 2 - 0.8); ctx.stroke(); fill(pal.accent); ctx.fillRect(-S * 0.1, -S * 0.75, S * 0.75, S * 0.18); fill('#6a4a2a'); ctx.fillRect(S * 0.2, -S * 0.6, S * 0.12, S * 1.2); break; }
    default: { // shopping bags (mall / generic)
      for (const [dx, c] of [[-0.35, pal.accent], [0.3, '#e9e1d4']] as const) {
        fill(c as string); ctx.fillRect((dx - 0.3) * S, -S * 0.2, S * 0.6, S * 0.8);
        stroke(c as string, S * 0.06); ctx.beginPath(); ctx.arc(dx * S, -S * 0.2, S * 0.18, Math.PI, Math.PI * 2); ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Ages a canvas: grime from the top, sun-faded patch, scratches; paper posters lose a corner. */
function age(ctx: Ctx, w: number, h: number, r: Rnd, paper: boolean): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(40,34,26,${0.2 + r() * 0.2})`); g.addColorStop(0.4, 'rgba(40,34,26,0.05)'); g.addColorStop(1, `rgba(40,34,26,${0.12 + r() * 0.12})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = `rgba(240,236,228,${0.06 + r() * 0.12})`; ctx.fillRect(r() * w * 0.6, 0, w * (0.2 + r() * 0.3), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); const x = r() * w, y = r() * h; ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * w * 0.4, y + (r() - 0.5) * h * 0.2); ctx.stroke(); }
  if (paper && r() < 0.45) {
    // a torn-off corner showing the dark backing
    const cx = r() < 0.5 ? 0 : w, cy = r() < 0.6 ? h : 0, s = Math.min(w, h) * (0.12 + r() * 0.12);
    ctx.fillStyle = '#2a2826'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + (cx ? -s : s), cy); ctx.lineTo(cx, cy + (cy ? -s * 0.8 : s * 0.8)); ctx.closePath(); ctx.fill();
  }
}

/** Fits a text into a width (bold sans / serif), returns the font size used. */
function fitText(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, serif: boolean, color: string, align: CanvasTextAlign = 'center'): number {
  const face = serif ? 'Georgia, "Times New Roman", serif' : '"Helvetica Neue", Arial, sans-serif';
  let s = size;
  ctx.font = `bold ${s}px ${face}`;
  while (ctx.measureText(text).width > maxW && s > 8) { s -= 1; ctx.font = `bold ${s}px ${face}`; }
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  return s;
}

/** (R5) The pictogram theme of an ad: kiosks by their brand (phone cases -> phone, candy / pretzels -> sweets, lotto / news -> print). */
function motifProgram(ad: MallAd, brand: string): MallProgram | 'mall' {
  if (ad.program !== 'kiosk') return ad.program;
  const b = brand.toLowerCase();
  return /phone/.test(b) ? 'phone' : /candy|sweet|pretzel/.test(b) ? 'grocery' : /lotto|news/.test(b) ? 'books' : 'mall';
}

/** (R5) Generic menu items per cuisine / café menu (gen/mall/shops.ts FOOD_CUISINES / CAFE_MENUS; no brands, no real products). */
const MENU_ITEMS: Record<string, string[]> = {
  burger: ['CLASSIC BURGER', 'DOUBLE STACK', 'CHEESE FRIES', 'CHICKEN BURGER', 'MILKSHAKE', 'ONION RINGS'],
  pizza: ['MARGHERITA', 'PEPPERONI', 'VEGGIE SLICE', 'GARLIC KNOTS', 'SLICE + DRINK', 'CALZONE'],
  noodles: ['CHOW MEIN', 'PAD THAI', 'SPRING ROLLS', 'FRIED RICE', 'RAMEN BOWL', 'DUMPLINGS'],
  sushi: ['CALIFORNIA ROLL', 'SALMON NIGIRI', 'BENTO BOX', 'MISO SOUP', 'TEMPURA', 'EDAMAME'],
  deli: ['TURKEY CLUB', 'PASTRAMI RYE', 'SOUP OF THE DAY', 'CAESAR WRAP', 'COLESLAW', 'BAGEL'],
  shawarma: ['CHICKEN WRAP', 'FALAFEL PLATE', 'HUMMUS BOWL', 'GARLIC FRIES', 'BEEF PLATE', 'TABBOULEH'],
  juice: ['GREEN DETOX', 'BERRY BLAST', 'MANGO SMOOTHIE', 'FRESH OJ', 'CARROT GINGER', 'ACAI BOWL'],
  hotdog: ['CLASSIC DOG', 'CHILI DOG', 'CORN DOG', 'LEMONADE', 'PRETZEL', 'NACHOS'],
  coffee: ['ESPRESSO', 'CAPPUCCINO', 'LATTE', 'ICED MOCHA', 'CHAI LATTE', 'HOT CHOCOLATE'],
  donut: ['GLAZED', 'BOSTON CREAM', 'DOZEN BOX', 'SPRINKLES', 'CRULLER', 'COFFEE'],
  bakery: ['CROISSANT', 'SOURDOUGH', 'MUFFIN', 'CINNAMON ROLL', 'BAGUETTE', 'SCONE'],
};

/** (R5) A backlit food-counter menu board: the brand strip, 2-3 panels (pictogram + items with prices) on a dark board, lightly aged. */
function drawMenu(ctx: Ctx, w: number, h: number, r: Rnd, ad: MallAd, brand: string, pal: AdPalette): void {
  ctx.fillStyle = '#17191b'; ctx.fillRect(0, 0, w, h);
  const hh = Math.round(h * 0.2);
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, hh);
  fitText(ctx, brand.toUpperCase(), w / 2, hh / 2, w * 0.9, Math.round(hh * 0.72), false, pal.ink);
  const items = MENU_ITEMS[ad.cuisine ?? ''] ?? MENU_ITEMS[ad.program === 'cafe' ? 'coffee' : 'burger'];
  const drink = /coffee|juice|donut|bakery/.test(ad.cuisine ?? '') || ad.program === 'cafe';
  const n = w > h * 3 ? 3 : 2, pw = w / n, body = h - hh;
  const order = [...items].sort(() => r() - 0.5);
  for (let i = 0; i < n; i++) {
    const x0 = i * pw;
    if (i) { ctx.fillStyle = '#3a3c3e'; ctx.fillRect(x0 - 1, hh + body * 0.06, 2, body * 0.88); }
    const s = Math.min(pw * 0.34, body * 0.62);
    drawMotif(ctx, drink ? 'cafe' : 'food-court', x0 + pw * 0.2, hh + body * 0.5, s, pal, r);
    const lines = 2 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < lines; k++) {
      const y = hh + body * (lines === 3 ? 0.22 + k * 0.28 : 0.32 + k * 0.36);
      fitText(ctx, order[(i * 3 + k) % order.length], x0 + pw * 0.4, y, pw * 0.4, Math.round(body * 0.13), false, '#f2ede2', 'left');
      fitText(ctx, `$${3 + Math.floor(r() * 10)}.${pick(['29', '49', '79', '99'], r)}`, x0 + pw * 0.96, y, pw * 0.16, Math.round(body * 0.13), false, pal.accent, 'right');
    }
  }
  age(ctx, w, h, r, false);
}

/** Canvas size (px) of an ad face of w x h metres (bounded: posters ~256 px wide, billboards <= 512; R5: menu boards 448 for their
 *  item lines, faces under 1.8 m on their long side 256 — ~150-210 px / m like the big posters' ~130 — to bound the atlas memory). */
export function adCanvasSize(ad: Pick<MallAd, 'w' | 'h' | 'kind'>): {w: number; h: number} {
  const long = ad.kind === 'billboard' ? 512 : ad.kind === 'menu' ? 448 : Math.max(ad.w, ad.h) < 1.8 ? 256 : 320;
  const k = long / Math.max(ad.w, ad.h);
  return {w: Math.max(32, Math.round(ad.w * k / 4) * 4), h: Math.max(32, Math.round(ad.h * k / 4) * 4)};
}

/**
 * The ad face art (canvas; decals with a transparent background). `brand` = the advertiser (the shop's fictional brand, or the
 * mall's seeded name for 'mall' ads).
 */
export function adTexture(ad: MallAd, brand: string): THREE.CanvasTexture {
  const {w: W, h: H} = adCanvasSize(ad);
  const pal = adPalette(ad.program);
  const decal = ad.kind === 'decal';
  return canvasTexture(W, H, 7300 + (ad.seed % 100000), (ctx, w, h, r) => {
    ctx.clearRect(0, 0, w, h);
    if (ad.kind === 'menu') { drawMenu(ctx, w, h, r, ad, brand, pal); return; } // (R5) food-counter menu board
    const portrait = h > w * 1.15, wide = w > h * 1.6;
    const fashion = ad.program === 'mall' ? r() < 0.6 : FASHION.includes(ad.program as MallProgram);
    const headline = pick(HEADLINES[ad.program] ?? HEADLINES.mall!, r);
    const serif = ['clothing', 'department', 'jewelry', 'beauty', 'books', 'cafe', 'home', 'luggage', 'florist', 'outdoors', 'womenswear'].includes(ad.program);
    if (!decal) {
      // two-tone colour-block background
      ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = pal.bg2;
      if (r() < 0.5) { ctx.beginPath(); ctx.moveTo(w * (0.45 + r() * 0.2), 0); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(w * (0.25 + r() * 0.2), h); ctx.closePath(); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(w * (0.55 + r() * 0.3), h * (0.35 + r() * 0.3), Math.min(w, h) * (0.32 + r() * 0.12), 0, Math.PI * 2); ctx.fill(); }
    }
    const textBand = portrait ? h * 0.22 : h * 0.3;
    // the motif: dressed adult figures for fashion, else the theme pictogram
    const area = {x0: wide ? w * 0.42 : w * 0.06, x1: w * 0.94, y0: portrait ? h * 0.08 : h * 0.1, y1: portrait ? h - textBand : h * 0.95};
    if (fashion) {
      const n = wide ? 3 : portrait ? (r() < 0.5 ? 1 : 2) : 2;
      // (R5) women's fashion: dress / skirt / coat figures, most with longer hair
      const women = ad.program === 'womenswear';
      const styles: FigureStyle[] = women ? ['dress', 'skirt', 'coat', 'dress'] : ['coat', 'dress', 'suit', 'casual', 'skirt'];
      const fh = (area.y1 - area.y0) * 0.96, span = area.x1 - area.x0;
      for (let i = 0; i < n; i++) {
        const fx = area.x0 + span * (i + 0.5) / n + (r() - 0.5) * span * 0.06;
        const c1 = pick(pal.cloth.length ? pal.cloth : GENERIC.cloth, r), c2 = pick(pal.cloth.length ? pal.cloth : GENERIC.cloth, r);
        // (R5) window vinyl: light figures (they read against the dark shop behind the glass)
        drawFigure(ctx, fx, area.y1, fh * (0.9 + r() * 0.1), pick(styles, r), c1, c2 === c1 ? '#2a2a2c' : c2, decal ? '#efebe4' : pick(['#3a3430', '#5a4a40', '#2a2624', '#6a5a4c'], r), r, women && r() < 0.75);
      }
    } else {
      const s = Math.min(area.x1 - area.x0, area.y1 - area.y0) * 0.86;
      drawMotif(ctx, motifProgram(ad, brand), (area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2, s, pal, r);
    }
    // (R5) window vinyl: an opaque sale band behind the text (cut-out pages: the band survives the alpha test)
    if (decal) {
      ctx.fillStyle = pal.accent;
      if (wide) ctx.fillRect(w * 0.02, h * 0.2, w * 0.4, h * 0.6); else ctx.fillRect(0, h - textBand * 0.98, w, textBand * 0.96);
    }
    // headline + brand (+ a price / percent tag)
    const ink = decal ? '#f6f3ec' : pal.ink;
    if (wide) {
      fitText(ctx, headline, w * 0.22, h * 0.36, w * 0.38, Math.round(h * 0.2), serif, ink);
      fitText(ctx, brand.toUpperCase(), w * 0.22, h * 0.66, w * 0.38, Math.round(h * 0.11), serif, decal ? ink : pal.accent);
    } else {
      fitText(ctx, headline, w / 2, h - textBand * (portrait ? 0.68 : 0.62), w * 0.88, Math.round(textBand * 0.36), serif, ink);
      fitText(ctx, brand.toUpperCase(), w / 2, h - textBand * 0.24, w * 0.8, Math.round(textBand * 0.2), serif, decal ? ink : pal.accent);
    }
    if (!decal && r() < 0.45) {
      // a sale roundel
      const rx = w * (0.14 + r() * 0.1), ry = h * (0.12 + r() * 0.1), rad = Math.min(w, h) * 0.1;
      ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.arc(rx, ry, rad, 0, Math.PI * 2); ctx.fill();
      fitText(ctx, pick(['-20%', '-30%', '-40%', 'NEW', 'SALE'], r), rx, ry, rad * 1.6, Math.round(rad * 0.7), false, pal.bg);
    }
    if (!decal) age(ctx, w, h, r, ad.kind === 'poster');
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Gallery billboards (lane ARCH's own placement, from the built wall faces)

/** A candidate wall face (world): a straight run with its open-side normal, storey and y span. */
export interface AdWall {
  level: number; x0: number; z0: number; x1: number; z1: number; nx: number; nz: number; y0: number; y1: number;
  /** Openings along the run (s from its min-x / min-z end, the builder's face convention). */
  ops?: readonly {s0: number; s1: number}[];
}

/** Billboard dimensions (m): face, centre height above the storey floor, spacing, clearances. */
export const GALLERY_AD = {w: 2.6, h: 1.6, y: 2.05, spacing: 9, propClear: 0.9, doorClear: 1.2, perStorey: 3} as const;

/**
 * Gallery billboards: on long, opening-free public walls (atrium courts, corridors, the station plaza), one framed panel per
 * candidate run at least GALLERY_AD.spacing apart, at most `perStorey` per storey; never near a door / shopfront / prop (vending,
 * benches, pylons) or a sign. Deterministic (fixed candidate order + seed). Program 'mall' (the seeded mall name), no shop.
 */
export function planGalleryAds(walls: readonly AdWall[], layout: StationLayout, seed: number, storeyBase: (level: number) => number): MallAd[] {
  const A = GALLERY_AD, out: MallAd[] = [];
  const props = layout.props ?? [];
  const doors = layout.doors ?? [];
  const perLevel = new Map<number, number>();
  // the builder splits a run into a dado band and an upper band: merge contiguous bands of the same run first
  const runs = new Map<string, AdWall>();
  for (const f of [...walls].sort((a, b) => a.y0 - b.y0)) {
    const key = `${f.level}|${f.x0}|${f.z0}|${f.x1}|${f.z1}|${f.nx}|${f.nz}`;
    const r = runs.get(key);
    if (r && f.y0 <= r.y1 + 0.02) { r.y1 = Math.max(r.y1, f.y1); r.ops = [...(r.ops ?? []), ...(f.ops ?? [])]; }
    else if (!r) runs.set(key, {...f, ops: [...(f.ops ?? [])]});
  }
  const sorted = [...runs.values()].sort((a, b) => Math.hypot(b.x1 - b.x0, b.z1 - b.z0) - Math.hypot(a.x1 - a.x0, a.z1 - a.z0) || a.level - b.level || a.x0 - b.x0 || a.z0 - b.z0);
  let k = 0;
  for (const f of sorted) {
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    if (len < A.w + 1.2) continue;
    const base = storeyBase(f.level);
    if (f.y0 > base + 0.6 || f.y1 < base + A.y + A.h / 2 + 0.2) continue;
    if ((perLevel.get(f.level) ?? 0) >= A.perStorey) continue;
    // the longest stretch of the run clear of its openings (doors, shopfronts, corridor mouths) by doorClear
    const alongX = Math.abs(f.z1 - f.z0) < 1e-6;
    const cuts = (f.ops ?? []).map(o => [Math.max(0, o.s0 - A.doorClear), Math.min(len, o.s1 + A.doorClear)] as const).sort((a, b) => a[0] - b[0]);
    let bestA = 0, bestB = 0, at = 0;
    for (const [c0, c1] of [...cuts, [len, len] as const]) { if (c0 - at > bestB - bestA) { bestA = at; bestB = c0; } at = Math.max(at, c1); }
    if (bestB - bestA < A.w + 1.2) continue;
    const sMid = (bestA + bestB) / 2, a0 = alongX ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1);
    const cx = (alongX ? a0 + sMid : f.x0) + f.nx * 0.02, cz = (alongX ? f.z0 : a0 + sMid) + f.nz * 0.02;
    const half = A.w / 2;
    // clear of props standing at the wall (footprint within propClear of the face span) and of doors
    const near = (x: number, z: number, hx: number, hz: number, e: number) => alongX
      ? Math.abs(z - cz) < hz + e && x + hx > cx - half - e && x - hx < cx + half + e
      : Math.abs(x - cx) < hx + e && z + hz > cz - half - e && z - hz < cz + half + e;
    if (props.some(p => (p.level ?? 0) === f.level && near(p.x, p.z, p.hx, p.hz, A.propClear))) continue;
    if (doors.some(d => ((d as {level?: number}).level ?? 0) === f.level && near((d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL, d.w * CELL / 2, d.h * CELL / 2, A.doorClear))) continue;
    if ((layout.signs ?? []).some(sg => (sg.level ?? 0) === f.level && Math.hypot(sg.x - cx, sg.z - cz) < half + 1)) continue;
    if (out.some(o => o.level === f.level && Math.hypot(o.x - cx, o.z - cz) < A.spacing)) continue;
    const bseed = (seed + 977 * k++) >>> 0;
    out.push({kind: 'billboard', program: 'mall', level: f.level, x: cx, y: base + A.y, z: cz, nx: f.nx, nz: f.nz, w: A.w, h: A.h, seed: bseed, slot: 'gallery', glow: litLevel(bseed)});
    perLevel.set(f.level, (perLevel.get(f.level) ?? 0) + 1);
  }
  out.push(...planGalleryLightboxes(sorted, layout, seed, storeyBase, out));
  return out;
}

/**
 * (R5) Gallery wall lightboxes: portrait panel (w x h), centre y above the storey floor, spacing between gallery ads, clearances from
 * openings (doors, shopfronts, corridor mouths), props at the wall, signs, escalator / stair runs; per-storey cap. Backlit (glow).
 */
export const GALLERY_LIGHTBOX = {w: 1.1, h: 1.7, y: 1.4, depth: 0.12, spacing: 4.5, propClear: 0.6, doorClear: 0.6, signClear: 0.4, runClear: 1.8, perStorey: 6} as const;

/** (R5) Static backlight level from a seed (= gen/mall/ads.ts adGlow shares: ~18 % dead, ~15 % dim, the rest lit). */
function litLevel(seed: number): number {
  const u = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) / 4294967296, v = (Math.imul(seed ^ 0x27d4eb2f, 0xc2b2ae35) >>> 0) / 4294967296;
  return u < 0.18 ? 0 : u < 0.33 ? Math.round((0.3 + v * 0.2) * 1000) / 1000 : Math.round((0.85 + v * 0.15) * 1000) / 1000;
}

/**
 * (R5) The second gallery tier: backlit wall LIGHTBOXES at eye level on the public walls (courts, corridors, galleries, the plaza)
 * between their openings — every clear stretch of a run long enough takes panels GALLERY_LIGHTBOX.spacing apart; never within
 * doorClear of an opening / a door, propClear of a prop at the wall (vending, benches, pylons, carts), signClear of a sign, runClear
 * of an escalator / stair run, or near another gallery ad; at most perStorey per storey. Each advertises one of the mall's own stores
 * (fashion weighted x3): shop = its id (the renderer prints its brand), program = its program. Deterministic (fixed order + seed).
 */
function planGalleryLightboxes(runs: readonly AdWall[], layout: StationLayout, seed: number, storeyBase: (level: number) => number, taken: readonly MallAd[]): MallAd[] {
  const L = GALLERY_LIGHTBOX, out: MallAd[] = [];
  const props = layout.props ?? [], doors = layout.doors ?? [], signs = layout.signs ?? [];
  const mall = layout.mall as ({shops?: readonly {id: string; program: MallProgram; kind: string}[]; verticals?: readonly {kind: string; lower: number; foot: {x: number; z: number}; head: {x: number; z: number}}[]} | undefined);
  const tenants = (mall?.shops ?? []).filter(s => s.kind === 'store' || s.kind === 'anchor' || s.kind === 'food');
  const pool = tenants.flatMap(s => (FASHION.includes(s.program) ? [s, s, s] : [s]));
  const runsV = mall?.verticals ?? [];
  const segDist = (px: number, pz: number, a: {x: number; z: number}, b: {x: number; z: number}) => {
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
    return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
  };
  const per = new Map<number, number>();
  let k = 0;
  for (const f of runs) {
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    if (len < L.w + 0.4) continue;
    const base = storeyBase(f.level);
    if (f.y0 > base + L.y - L.h / 2 - 0.1 || f.y1 < base + L.y + L.h / 2 + 0.15) continue;
    const alongX = Math.abs(f.z1 - f.z0) < 1e-6, a0 = alongX ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1);
    // clear stretches of the run between its openings (+- doorClear)
    const cuts = (f.ops ?? []).map(o => [Math.max(0, o.s0 - L.doorClear), Math.min(len, o.s1 + L.doorClear)] as const).sort((p, q) => p[0] - q[0]);
    const stretches: [number, number][] = [];
    let at = 0;
    for (const [c0, c1] of [...cuts, [len, len] as const]) { if (c0 - at >= L.w + 0.3) stretches.push([at, c0]); at = Math.max(at, c1); }
    for (const [s0, s1] of stretches) {
      const n = Math.max(1, Math.floor((s1 - s0 - L.w - 0.3) / L.spacing) + 1);
      for (let i = 0; i < n; i++) {
        if ((per.get(f.level) ?? 0) >= L.perStorey) break;
        const s = n === 1 ? (s0 + s1) / 2 : s0 + 0.15 + L.w / 2 + i * (s1 - s0 - 0.3 - L.w) / (n - 1);
        const cx = (alongX ? a0 + s : f.x0) + f.nx * L.depth / 2, cz = (alongX ? f.z0 : a0 + s) + f.nz * L.depth / 2;
        const half = L.w / 2;
        const near = (x: number, z: number, hx: number, hz: number, e: number) => alongX
          ? Math.abs(z - cz) < hz + e && x + hx > cx - half - e && x - hx < cx + half + e
          : Math.abs(x - cx) < hx + e && z + hz > cz - half - e && z - hz < cz + half + e;
        if (props.some(p => (p.level ?? 0) === f.level && near(p.x, p.z, p.hx, p.hz, L.propClear))) continue;
        if (doors.some(d => ((d as {level?: number}).level ?? 0) === f.level && near((d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL, d.w * CELL / 2, d.h * CELL / 2, L.doorClear))) continue;
        if (signs.some(sg => (sg.level ?? 0) === f.level && !sg.hang && Math.abs(sg.y - (base + L.y)) < L.h / 2 + 0.35 + L.signClear && near(sg.x, sg.z, alongX ? (sg.w ?? 1.4) / 2 : 0.2, alongX ? 0.2 : (sg.w ?? 1.4) / 2, L.signClear))) continue;
        if (runsV.some(v => (v.lower === f.level || v.lower + 1 === f.level) && segDist(cx, cz, v.foot, v.head) < L.runClear)) continue;
        if ([...taken, ...out].some(o => o.level === f.level && Math.hypot(o.x - cx, o.z - cz) < Math.max(L.spacing * 0.8, (o.w + L.w) / 2 + 1.2))) continue;
        const sd = (seed ^ 0x5a17c3) + 7919 * k++ >>> 0;
        const shop = pool.length ? pool[sd % pool.length] : undefined;
        out.push({kind: 'lightbox', program: shop?.program ?? 'mall', ...(shop ? {shop: shop.id} : {}), level: f.level, x: cx, y: base + L.y, z: cz, nx: f.nx, nz: f.nz, w: L.w, h: L.h,
          seed: sd, slot: 'gallery', glow: litLevel(sd)});
        per.set(f.level, (per.get(f.level) ?? 0) + 1);
      }
    }
  }
  return out;
}
