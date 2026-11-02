// Task mall-playtest-revision-20261031 (lane ARCH, D06: "certainly the stores would have like pictures of people wearing the
// clothes ... some billboards make some ads"). Advertising ART + RECORDS for the mall — rendered by MallArch.buildAds (atlas pages,
// instanced faces, bounded draw calls):
//  - records: lane SHOPS places in-shop / shopfront ads as `layout.mall.ads` (MallAd: poster / lightbox / billboard / decal, program
//    theme, face centre + normal + size, seed); lane ARCH adds gallery billboards on long blank public walls (planGalleryAds) and
//    nothing else — never in front of a door, a shopfront, a prop or another sign;
//  - art: see task mall-round4 below (the original D06 / R5 hand-drawn vector figures and pictograms are gone); the per-face text —
//    fictional brands (the shop's own fictional brand from layout.mall.shops, else the seeded mall name), generic headlines, price /
//    percent roundels, menu lines — and the aging (sun fade, grime from the top, scratches, a torn corner on paper posters) stay
//    drawn here at load from a seed (dynamic, per-mall content).
//
// Task mall-round3-20261031 (lane SHOPS, R5 — user: "there are no adds ... on kiosks, and as posters in the store and stuff"): + the
// women's fashion program (womenswear: its own palette / headlines), kiosk themes from the kiosk brand, food-counter MENU boards
// (cuisine item lists + prices: generic dishes, no brands), kiosk-cart HEADER signs, window vinyl (an opaque sale band: readable
// against a dark shop behind the glass), and planGalleryAds' second tier: backlit WALL LIGHTBOXES (portrait, eye level) on the public
// walls between openings, each advertising one of the mall's own stores.
//
// Task studio-beta-mall-round4-20261101-01 (lane ADS — user: "use codex to produce images for the adds, not draw them by hand :P"):
// the ARTWORK is the eight Codex-generated images (assets/mallAdArt.ts: womenswear / menswear / food / cafe / electronics / health /
// sports / shopping; provenance assets/derivatives/mall-ad-art-20261101.json). Every ad maps its program (kiosks: their brand; menus:
// their cuisine) to one image (adArtOf), cover-cropped into the face keeping the image's subject (AD_ART_FOCUS), under a palette band
// that carries the text; window vinyl prints it on an opaque panel (survives the cut-out alpha test); menu boards show cropped items
// (AD_ART_MENU_CROPS). No image (Node tests, a failed load): a plain palette fill — never substitute drawn art.

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {attribute, texture, uniform} from 'three/tsl';
import type {MallProgram} from '../gen/mall/mallTypes';
import type {StationLayout} from '../gen/stationTypes';
import {CELL} from '../gen/grid';
import {canvasTexture} from './canvasTextures';
import {SIGN_ATLAS_CONTEXT, SIGN_ATLAS_UV} from './surfaceNodes';
import {AD_ART_FOCUS, AD_ART_MENU_CROPS, mallAdArt, type AdArtId, type AdArtImage, type ArtBox} from '../assets/mallAdArt'; // task mall-round4 (lane ADS)

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
  /** Theme: the program it advertises (its Codex artwork: adArtOf), or 'mall' (centre-wide ads). */
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

/** Palette per theme: background (the text band / panel), second background (the plain fill where no artwork is held: lane ADS), ink,
 *  accent (brand line, roundel, vinyl sale band). */
interface AdPalette { bg: string; bg2: string; ink: string; accent: string }
/** Fashion programs (planGalleryLightboxes weights their stores x3). */
const FASHION: MallProgram[] = ['clothing', 'department', 'shoes', 'beauty', 'jewelry', 'luggage', 'optical', 'womenswear', 'lingerie'];
const PAL: Partial<Record<MallProgram | 'mall', AdPalette>> = {
  clothing: {bg: '#e9dccb', bg2: '#c9a27a', ink: '#2b211a', accent: '#8a3b2e'},
  // (R5) women's fashion: blush / ivory / plum
  womenswear: {bg: '#f3e6e4', bg2: '#c98f9a', ink: '#3a1f2b', accent: '#9c3a5a'},
  // (task mall-lingerie-20261102, lane STORE) the lingerie boutique: plum / blush / gold
  lingerie: {bg: '#2a1626', bg2: '#b9788c', ink: '#f4dbe4', accent: '#c9a96e'},
  kiosk: {bg: '#f2ece0', bg2: '#e0a040', ink: '#2a2420', accent: '#d0402a'},
  department: {bg: '#1e2a3a', bg2: '#38506a', ink: '#f2ead8', accent: '#c8a45a'},
  shoes: {bg: '#f2f0ea', bg2: '#d8c8a8', ink: '#222224', accent: '#b8463a'},
  beauty: {bg: '#f2dcd8', bg2: '#d8a8a0', ink: '#5a2e30', accent: '#b0485a'},
  jewelry: {bg: '#141312', bg2: '#2e2a24', ink: '#e8d8a8', accent: '#b8963e'},
  luggage: {bg: '#4e3a2a', bg2: '#7a5a40', ink: '#f0e4d0', accent: '#c8a070'},
  optical: {bg: '#f4f6f8', bg2: '#c8d4e0', ink: '#2c4a6a', accent: '#2c4a6a'},
  electronics: {bg: '#101216', bg2: '#163a4a', ink: '#e8f6fa', accent: '#2ac0e0'},
  phone: {bg: '#f4f4f2', bg2: '#e0702a', ink: '#202224', accent: '#e0702a'},
  arcade: {bg: '#0e0e14', bg2: '#3a0e3a', ink: '#ff6ad0', accent: '#2ad0d8'},
  music: {bg: '#141416', bg2: '#3a1e5a', ink: '#efe6ff', accent: '#9a5ad8'},
  'food-court': {bg: '#b03a2e', bg2: '#f2c14e', ink: '#fff4e0', accent: '#f2c14e'},
  cafe: {bg: '#3a2618', bg2: '#6a4a30', ink: '#f4e6cc', accent: '#c88a4a'},
  grocery: {bg: '#3e6a3a', bg2: '#8ab05a', ink: '#f4f2e0', accent: '#e8c84a'},
  pharmacy: {bg: '#f2f4f2', bg2: '#bfe3d4', ink: '#1e6e58', accent: '#2fa37f'},
  clinic: {bg: '#e8f0f4', bg2: '#b8d0dc', ink: '#1f4d66', accent: '#d23c3c'},
  sports: {bg: '#23304a', bg2: '#c8323a', ink: '#ffffff', accent: '#f2c14e'},
  outdoors: {bg: '#2e3a2a', bg2: '#5a6a3a', ink: '#efe6cf', accent: '#d9a441'},
  books: {bg: '#2f4a3c', bg2: '#4a6a54', ink: '#f0e6cc', accent: '#c8a050'},
  toys: {bg: '#3a7fc1', bg2: '#e8c547', ink: '#fff8e0', accent: '#e8453a'},
  home: {bg: '#a9b79a', bg2: '#e8e2d2', ink: '#2a3226', accent: '#8a5a3a'},
  pet: {bg: '#3e8a80', bg2: '#f2c46a', ink: '#f4fff8', accent: '#f2c46a'},
  florist: {bg: '#5a8a5a', bg2: '#e88aa0', ink: '#fff6f0', accent: '#e88aa0'},
  hardware: {bg: '#d29a1e', bg2: '#1a1a1a', ink: '#1a1a1a', accent: '#f4f0e0'},
  guns: {bg: '#1b1c1d', bg2: '#3a3a30', ink: '#e8e2d2', accent: '#c8452e'},
  vacant: {bg: '#cfccc4', bg2: '#8a8680', ink: '#2a2826', accent: '#c8452e'},
  mall: {bg: '#1f2b38', bg2: '#3e5a74', ink: '#f2efe6', accent: '#d9a520'},
};
const GENERIC: AdPalette = {bg: '#2c3a46', bg2: '#8ab0c8', ink: '#eef2f4', accent: '#d9a520'};
export const adPalette = (p: MallProgram | 'mall'): AdPalette => PAL[p] ?? GENERIC;

/** Generic headlines per theme (no real brands / products / slogans). */
const HEADLINES: Partial<Record<MallProgram | 'mall', string[]>> = {
  clothing: ['NEW SEASON', 'THE AUTUMN EDIT', 'LAYER UP', 'WEEKEND READY', 'UP TO 40% OFF'],
  womenswear: ['THE DRESS EDIT', 'NEW IN: DRESSES', 'COAT WEATHER', 'THE WEEKEND EDIT', 'SPRING COLLECTION', 'UP TO 50% OFF'],
  lingerie: ['THE LACE EDIT', 'FREE FITTING SERVICE', 'NEW IN: SILK', 'BRA FIT WEEK', '3 FOR 2 BRIEFS'],
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

/**
 * (lane ADS) Program -> its Codex artwork (assets/mallAdArt.ts): one image, or two for the general fashion programs, picked by the
 * record's seed (a clothing / department store's ads mix the men's and women's campaigns). Exhaustive over MallProgram + 'mall'
 * (the typecheck keeps it so; tests: every id is a shipped image).
 */
export const PROGRAM_ART: Readonly<Record<MallProgram | 'mall', readonly AdArtId[]>> = {
  womenswear: ['womenswear'], lingerie: ['womenswear'], clothing: ['menswear', 'womenswear'], department: ['menswear', 'womenswear'], shoes: ['womenswear', 'menswear'],
  optical: ['womenswear', 'menswear'], jewelry: ['womenswear'], luggage: ['menswear'],
  'food-court': ['food'], grocery: ['food'], cafe: ['cafe'],
  electronics: ['electronics'], phone: ['electronics'], arcade: ['electronics'], music: ['electronics'],
  pharmacy: ['health'], clinic: ['health'], beauty: ['health'],
  sports: ['sports'], outdoors: ['sports'], guns: ['sports'],
  books: ['shopping'], toys: ['shopping'], home: ['shopping'], pet: ['shopping'], florist: ['shopping'], hardware: ['shopping'],
  kiosk: ['shopping'], service: ['shopping'], vacant: ['shopping'], mall: ['shopping'],
};
/** (lane ADS) Menu cuisines / café menus (gen/mall/shops.ts FOOD_CUISINES / CAFE_MENUS) -> artwork: drinks / bakery cafe, dishes food. */
export const CUISINE_ART: Readonly<Record<string, AdArtId>> = {
  burger: 'food', pizza: 'food', noodles: 'food', sushi: 'food', deli: 'food', shawarma: 'food', hotdog: 'food',
  juice: 'cafe', coffee: 'cafe', donut: 'cafe', bakery: 'cafe',
};

/**
 * (lane ADS) The artwork an ad shows: a menu board by its cuisine; a kiosk by its brand (R5 keyword logic: phone cases -> electronics,
 * candy / pretzels -> cafe, the rest -> shopping); else its program (PROGRAM_ART; two options -> by the record's seed).
 */
export function adArtOf(ad: Pick<MallAd, 'program' | 'seed' | 'cuisine'>, brand: string): AdArtId {
  const c = ad.cuisine ? CUISINE_ART[ad.cuisine] : undefined;
  if (c) return c;
  if (ad.program === 'kiosk') {
    const b = brand.toLowerCase();
    return /phone/.test(b) ? 'electronics' : /candy|sweet|pretzel/.test(b) ? 'cafe' : 'shopping';
  }
  const opts = PROGRAM_ART[ad.program] ?? PROGRAM_ART.mall;
  return opts[(ad.seed >>> 0) % opts.length];
}

const clampTo = (v: number, hi: number) => Math.max(0, Math.min(hi, v));

/**
 * (lane ADS) Cover-crop window [sx, sy, sw, sh] (source px) of an iw x ih image for a dw x dh destination: the destination's aspect,
 * as large as the image allows, placed to keep `focus` (normalised): centred on it across the image; along the cropped height centred
 * on the destination band `band` (normalised [v0, v1]: the part left clear of a text band) — top-aligned there when the focus is taller
 * than the band (a figure keeps its head). Always inside the image.
 */
export function coverWindow(iw: number, ih: number, dw: number, dh: number, focus: ArtBox, band: readonly [number, number] = [0, 1]): [number, number, number, number] {
  const a = dw / dh;
  if (a >= iw / ih) {
    const sh = iw / a, fy0 = focus.y0 * ih, fy1 = focus.y1 * ih;
    const sy = fy1 - fy0 <= (band[1] - band[0]) * sh ? (fy0 + fy1) / 2 - (band[0] + band[1]) / 2 * sh : fy0 - band[0] * sh;
    return [0, clampTo(sy, ih - sh), iw, sh];
  }
  const sw = ih * a;
  return [clampTo((focus.x0 + focus.x1) / 2 * iw - sw / 2, iw - sw), 0, sw, ih];
}

/** (lane ADS) The smallest window of the destination's aspect around `box` (normalised), centred on it, shrunk / shifted into the image. */
export function cropWindow(iw: number, ih: number, box: ArtBox, dw: number, dh: number): [number, number, number, number] {
  const a = dw / dh;
  let sw = (box.x1 - box.x0) * iw, sh = (box.y1 - box.y0) * ih;
  if (sw / sh < a) sw = sh * a; else sh = sw / a;
  const k = Math.min(1, iw / sw, ih / sh);
  sw *= k; sh *= k;
  return [clampTo((box.x0 + box.x1) / 2 * iw - sw / 2, iw - sw), clampTo((box.y0 + box.y1) / 2 * ih - sh / 2, ih - sh), sw, sh];
}

/** (lane ADS) Draws a source window of `img` into (x, y, w, h) with high-quality downsampling. */
function blit(ctx: Ctx, img: AdArtImage, [sx, sy, sw, sh]: readonly number[], x: number, y: number, w: number, h: number): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** (lane ADS) The artwork cover-cropped into (x, y, w, h); false (nothing drawn: the caller's plain fill shows) when no image is held. */
function drawArt(ctx: Ctx, img: AdArtImage | null, focus: ArtBox, x: number, y: number, w: number, h: number, band?: readonly [number, number]): boolean {
  if (!img || w < 1 || h < 1) return false;
  blit(ctx, img, coverWindow(img.width, img.height, w, h, focus, band), x, y, w, h);
  return true;
}

/** '#rrggbb' + alpha -> 'rgba(...)'. */
const rgba = (hex: string, a: number): string => { const n = parseInt(hex.slice(1, 7), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

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

/**
 * (R5) A backlit food-counter menu board: the brand strip, 2-3 panels (an item photo + item lines with prices) on a dark board, lightly
 * aged. (lane ADS) The photos are crops of the Codex food / café artwork (AD_ART_MENU_CROPS: one item per panel); with no image held
 * the photo tiles stay a plain palette fill.
 */
function drawMenu(ctx: Ctx, w: number, h: number, r: Rnd, ad: MallAd, brand: string, pal: AdPalette, art: AdArtId, img: AdArtImage | null): void {
  ctx.fillStyle = '#17191b'; ctx.fillRect(0, 0, w, h);
  const hh = Math.round(h * 0.2);
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, hh);
  fitText(ctx, brand.toUpperCase(), w / 2, hh / 2, w * 0.9, Math.round(hh * 0.72), false, pal.ink);
  const items = MENU_ITEMS[ad.cuisine ?? ''] ?? MENU_ITEMS[ad.program === 'cafe' ? 'coffee' : 'burger'];
  const crops = AD_ART_MENU_CROPS[art] ?? [AD_ART_FOCUS[art]];
  const n = w > h * 3 ? 3 : 2, pw = w / n, body = h - hh;
  const order = [...items].sort(() => r() - 0.5);
  for (let i = 0; i < n; i++) {
    const x0 = i * pw;
    if (i) { ctx.fillStyle = '#3a3c3e'; ctx.fillRect(x0 - 1, hh + body * 0.06, 2, body * 0.88); }
    // the item photo: a square tile left of the lines
    const t = Math.round(Math.min(pw * 0.34, body * 0.84)), tx = Math.round(x0 + pw * 0.2 - t / 2), ty = Math.round(hh + body * 0.5 - t / 2);
    ctx.fillStyle = pal.bg2; ctx.fillRect(tx, ty, t, t);
    if (img) blit(ctx, img, cropWindow(img.width, img.height, crops[i % crops.length], t, t), tx, ty, t, t);
    const lines = 2 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < lines; k++) {
      const y = hh + body * (lines === 3 ? 0.22 + k * 0.28 : 0.32 + k * 0.36);
      fitText(ctx, order[(i * 3 + k) % order.length], x0 + pw * 0.4, y, pw * 0.36, Math.round(body * 0.13), false, '#f2ede2', 'left');
      fitText(ctx, `$${3 + Math.floor(r() * 10)}.${pick(['29', '49', '79', '99'], r)}`, x0 + pw * 0.96, y, pw * 0.16, Math.round(body * 0.13), false, pal.accent, 'right');
    }
  }
  age(ctx, w, h, r, false);
}

/** Canvas size (px) of an ad face of w x h metres (bounded: posters ~256 px wide, billboards <= 512; R5 — ~2.3x the faces in the same
 *  atlas memory class: billboards 416, menu boards 448 for their item lines, faces >= 1.8 m on their long side 288, smaller 224 —
 *  120-200 px / m, the D06 posters' ~130-200). */
export function adCanvasSize(ad: Pick<MallAd, 'w' | 'h' | 'kind'>): {w: number; h: number} {
  const long = ad.kind === 'billboard' ? 416 : ad.kind === 'menu' ? 448 : Math.max(ad.w, ad.h) < 1.8 ? 224 : 288;
  const k = long / Math.max(ad.w, ad.h);
  return {w: Math.max(32, Math.round(ad.w * k / 4) * 4), h: Math.max(32, Math.round(ad.h * k / 4) * 4)};
}

/**
 * The ad face (canvas; decals with a transparent background around an opaque print). `brand` = the advertiser (the shop's fictional
 * brand, or the mall's seeded name for 'mall' ads). (lane ADS) The artwork is the ad's Codex image (adArtOf), held only while the
 * mall's atlas is built (assets/mallAdArt.ts); the brand, headline, roundel and aging are drawn over it here.
 */
export function adTexture(ad: MallAd, brand: string): THREE.CanvasTexture {
  const {w: W, h: H} = adCanvasSize(ad);
  const pal = adPalette(ad.program);
  const decal = ad.kind === 'decal';
  const art = adArtOf(ad, brand), img = mallAdArt(art), focus = AD_ART_FOCUS[art];
  return canvasTexture(W, H, 7300 + (ad.seed % 100000), (ctx, w, h, r) => {
    ctx.clearRect(0, 0, w, h);
    if (ad.kind === 'menu') { drawMenu(ctx, w, h, r, ad, brand, pal, art, img); return; } // (R5) food-counter menu board
    const portrait = h > w * 1.15, wide = w > h * 1.6;
    const headline = pick(HEADLINES[ad.program] ?? HEADLINES.mall!, r);
    const serif = ['clothing', 'department', 'jewelry', 'beauty', 'books', 'cafe', 'home', 'luggage', 'florist', 'outdoors', 'womenswear'].includes(ad.program);
    const textBand = portrait ? h * 0.22 : h * 0.3;
    // (lane ADS) the artwork: a wide face keeps its text panel on the left and the art fills the rest (the subject uncropped); the others
    // show it full-bleed with the text band at the bottom, over the images' plain lower third
    const ax = wide ? Math.round(w * 0.42) : 0;
    if (decal) {
      // window vinyl (cut-out page, alpha-tested): the art printed on an OPAQUE panel with a light vinyl edge (it survives the alpha
      // test; the glass shows round it), then the opaque sale band behind the text
      const e = Math.max(2, Math.round(Math.min(w, h) * 0.025));
      const px = Math.round(wide ? w * 0.45 : w * 0.07), py = Math.round(h * (wide ? 0.08 : 0.04));
      const pw = wide ? w - px - Math.round(w * 0.03) : w - 2 * px, ph = wide ? h - 2 * py : Math.round(h - textBand - py - h * 0.03);
      ctx.fillStyle = '#f6f3ec'; ctx.fillRect(px - e, py - e, pw + 2 * e, ph + 2 * e);
      ctx.fillStyle = pal.bg2; ctx.fillRect(px, py, pw, ph);
      drawArt(ctx, img, focus, px, py, pw, ph);
      ctx.fillStyle = pal.accent;
      if (wide) ctx.fillRect(w * 0.02, h * 0.2, w * 0.4, h * 0.6); else ctx.fillRect(0, h - textBand * 0.98, w, textBand * 0.96);
    } else {
      ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, w, h);
      if (drawArt(ctx, img, focus, ax, 0, w - ax, h, wide ? [0.04, 0.96] : [0.02, 1 - textBand * 1.15 / h])) {
        // the palette band under the text: a soft seam into the left panel, or a fade up into the solid bottom band
        const g = wide ? ctx.createLinearGradient(ax, 0, ax + w * 0.08, 0) : ctx.createLinearGradient(0, h - textBand * 1.35, 0, h - textBand * 0.95);
        g.addColorStop(0, rgba(pal.bg, wide ? 1 : 0));
        g.addColorStop(1, rgba(pal.bg, wide ? 0 : 0.9));
        ctx.fillStyle = g;
        if (wide) ctx.fillRect(ax, 0, w * 0.08, h);
        else { ctx.fillRect(0, h - textBand * 1.35, w, textBand * 0.4); ctx.fillStyle = rgba(pal.bg, 0.9); ctx.fillRect(0, h - textBand * 0.95, w, textBand * 0.95); }
      }
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
      // a sale roundel (a wide face: over the art's top-right corner, clear of the text panel)
      const rx = wide ? w * (0.86 - r() * 0.06) : w * (0.14 + r() * 0.1), ry = h * (0.12 + r() * 0.1), rad = Math.min(w, h) * 0.1;
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
