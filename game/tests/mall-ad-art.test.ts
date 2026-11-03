// Task studio-beta-mall-round4-20261101-01 (lane ADS — user: "use codex to produce images for the adds, not draw them by hand :P"): the
// mall ad ARTWORK comes from the Codex-generated images (eight round-4 + the lingerie boutique's four, task mall-lingerie-store-polish-20261103-045922) (assets/mallAdArt.ts; runtime derivatives assets/textures/mall/ads/*.jpg,
// tools/asset-pipeline/mall-ads/build-ad-art.mjs, provenance assets/derivatives/mall-ad-art-20261101.json), never hand-drawn:
//  - every ad program / cuisine / kiosk brand maps to a shipped image (world/mallAds.ts adArtOf);
//  - the files exist (512 px JPEG), are allowlisted byte-exact, level-only (mall), credited, and the provenance carries the Codex
//    receipts (source sha256, thread id, prompt) and the outputs' hashes — no URLs / local paths;
//  - adTexture / drawMenu draw the held image (cover-cropped, the subject kept; decals on an opaque panel; menu tiles cropped per
//    item) under the code-driven brand / headline text; with no image they draw a plain fill only — no figure, no pictogram;
//  - the loader holds images only between the mall's preload and its atlas build (MallArch.buildAds releases them, also on a throw);
//    other levels load none.
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {ShimCanvas, installCanvasShim} from './helpers/canvas2d';
import {AD_ART_FOCUS, AD_ART_IDS, AD_ART_LINGERIE_IDS, AD_ART_ROUND4_IDS, AD_ART_MENU_CROPS, AD_ART_URLS, adArtStats, mallAdArt, mallAdArtSummary, preloadMallAdArt, releaseMallAdArt, setMallAdArt,
  type AdArtId, type AdArtImage} from '../src/assets/mallAdArt';
import {CUISINE_ART, PROGRAM_ART, adArtOf, adCanvasSize, adPalette, adTexture, coverWindow, cropWindow, type MallAd} from '../src/world/mallAds';
import {CAFE_MENUS, FOOD_CUISINES, MALL_PROGRAMS} from '../src/gen/mall/shops';
import type {MallProgram} from '../src/gen/mall/mallTypes';
import {assetAllowedIn, levelOfAsset} from '../src/assets/levelAssets';
import {MallArch} from '../src/world/mallArch';
import {MallAtmosphere} from '../src/world/mallAtmosphere';
import type {StationLayout} from '../src/gen/stationTypes';

const PUB = fileURLToPath(new URL('../public/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const PROV_REL = 'assets/derivatives/mall-ad-art-20261101.json';
// task mall-lingerie-store-polish-20261103-045922: the lingerie boutique's own four Codex artworks (a sibling builder + provenance)
const LINGERIE_PROV_REL = 'assets/derivatives/mall-lingerie-ad-art-20261103.json';
const ART_SETS = [
  {prov: PROV_REL, ids: AD_ART_ROUND4_IDS as readonly AdArtId[], rebuild: 'node tools/asset-pipeline/mall-ads/build-ad-art.mjs', credits: 'mall-ad-art-20261101'},
  {prov: LINGERIE_PROV_REL, ids: AD_ART_LINGERIE_IDS as readonly AdArtId[], rebuild: 'node tools/asset-pipeline/mall-ads/build-lingerie-ad-art.mjs', credits: 'mall-lingerie-ad-art-20261103'},
];
const ad = (o: Partial<MallAd> & Pick<MallAd, 'kind' | 'program' | 'w' | 'h'>): MallAd => ({level: 1, x: 0, y: 2, z: 0, nx: 0, nz: 1, seed: 4242, ...o});
const PROGRAMS = [...Object.keys(MALL_PROGRAMS), 'mall'] as (MallProgram | 'mall')[];
const MENU_BURGER = ['CLASSIC BURGER', 'DOUBLE STACK', 'CHEESE FRIES', 'CHICKEN BURGER', 'MILKSHAKE', 'ONION RINGS'];

describe('program -> Codex artwork mapping', () => {
  it('every program, cuisine and kiosk brand maps to one of the twelve shipped images; every image is used; the lingerie boutique uses only its own art', () => {
    expect(new Set(Object.keys(PROGRAM_ART))).toEqual(new Set(PROGRAMS));
    const used = new Set<AdArtId>();
    for (const p of PROGRAMS) {
      expect(PROGRAM_ART[p].length, p).toBeGreaterThan(0);
      for (const id of PROGRAM_ART[p]) { expect(AD_ART_IDS, `${p} -> ${id}`).toContain(id); used.add(id); }
      for (let s = 0; s < 8; s++) expect(AD_ART_IDS).toContain(adArtOf({program: p, seed: s * 7919}, 'Brand'));
    }
    expect([...used].sort()).toEqual([...AD_ART_IDS].sort());
    for (const c of [...FOOD_CUISINES, ...CAFE_MENUS]) expect(AD_ART_IDS, c).toContain(CUISINE_ART[c]);
    expect([...PROGRAM_ART.lingerie].sort()).toEqual([...AD_ART_LINGERIE_IDS].sort());
    for (const p of PROGRAMS) if (p !== 'lingerie') for (const id of PROGRAM_ART[p]) expect(AD_ART_LINGERIE_IDS as readonly string[], `${p} -> ${id}`).not.toContain(id);
  });

  it('the themes: fashion -> people, food / cafe -> food photos, electronics, health, sports, everything else -> shopping', () => {
    const only = (p: MallProgram | 'mall') => [...new Set(Array.from({length: 16}, (_, s) => adArtOf({program: p, seed: s}, 'Brand')))].sort();
    expect(only('womenswear')).toEqual(['womenswear']);
    for (const p of ['clothing', 'department', 'shoes', 'luggage', 'jewelry', 'optical'] as const) for (const id of only(p)) expect(['menswear', 'womenswear'], p).toContain(id);
    expect(only('clothing')).toEqual(['menswear', 'womenswear']); // a clothing store's ads mix both campaigns (by the record's seed)
    expect(only('food-court')).toEqual(['food']);
    expect(only('cafe')).toEqual(['cafe']);
    for (const p of ['electronics', 'phone', 'arcade', 'music'] as const) expect(only(p), p).toEqual(['electronics']);
    for (const p of ['pharmacy', 'clinic', 'beauty'] as const) expect(only(p), p).toEqual(['health']);
    for (const p of ['sports', 'outdoors', 'guns'] as const) expect(only(p), p).toEqual(['sports']);
    for (const p of ['mall', 'books', 'toys', 'home', 'pet', 'florist', 'hardware', 'vacant'] as const) expect(only(p), p).toEqual(['shopping']);
    // menus by cuisine (drinks / bakery -> cafe), whatever the program
    for (const c of ['coffee', 'donut', 'bakery', 'juice']) expect(adArtOf({program: 'food-court', seed: 1, cuisine: c}, 'X')).toBe('cafe');
    for (const c of ['burger', 'pizza', 'noodles', 'sushi', 'deli', 'shawarma', 'hotdog']) expect(adArtOf({program: 'food-court', seed: 1, cuisine: c}, 'X')).toBe('food');
    // kiosks keep their brand keywords
    const kiosk = (b: string) => adArtOf({program: 'kiosk', seed: 3}, b);
    expect(MALL_PROGRAMS.kiosk.brands.map(kiosk)).toEqual(MALL_PROGRAMS.kiosk.brands.map(b => (/phone/i.test(b) ? 'electronics' : /candy|sweet|pretzel/i.test(b) ? 'cafe' : 'shopping')));
    expect(kiosk('Phone Case Corner')).toBe('electronics');
    expect(kiosk('Pretzel Twist')).toBe('cafe');
    expect(kiosk('Gift Wrap Kiosk')).toBe('shopping');
    expect(adArtOf({program: 'clothing', seed: 77}, 'A')).toBe(adArtOf({program: 'clothing', seed: 77}, 'B')); // deterministic, brand-free
  });
});

describe('runtime files, allowlist, provenance, credits', () => {
  const allow = JSON.parse(readFileSync(`${ROOT}tools/release/public-inputs.json`, 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
  const entry = (p: string) => allow.files.find(f => f.path === p);
  type Prov = {generator: string; rebuild: string; recipe: {resize: {kernel: string}}; files: {id: string; source: {sha256: string; width: number; height: number; file: string}; codex: {generator: string; threadId: string; nativeSha256Matches: boolean; exit: number}; prompt: string; output: {url: string; bytes: number; sha256: string; width: number; height: number}}[]};
  const provOf = (rel: string) => JSON.parse(readFileSync(`${PUB}${rel}`, 'utf8')) as Prov;

  it('twelve 512 px JPEGs (eight round-4 + four lingerie), level-only (mall), allowlisted byte-exact, each with its Codex receipt in its provenance', () => {
   expect([...ART_SETS.flatMap(t => t.ids)]).toEqual([...AD_ART_IDS]);
   for (const set of ART_SETS) {
    const prov = provOf(set.prov);
    expect(prov.files.map(f => f.id)).toEqual(set.ids.map(id => `ad-${id}`));
    expect(prov.generator).toBe('Codex native image_gen (owned Codex CLI)');
    expect(prov.rebuild).toBe(set.rebuild);
    expect(prov.recipe.resize.kernel).toBe('lanczos3');
    for (const id of set.ids) {
      const url = AD_ART_URLS[id], file = `${PUB}${url}`;
      expect(existsSync(file), url).toBe(true);
      const b = readFileSync(file);
      // JPEG: SOI, then the SOF0/2 frame size
      expect(b.readUInt16BE(0)).toBe(0xffd8);
      let i = 2, w = 0, h = 0;
      while (i < b.length - 9) { const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; } i += 2 + b.readUInt16BE(i + 2); }
      expect([w, h], url).toEqual([512, 512]);
      expect(entry(url), `${url} allowlisted`).toEqual({path: url, bytes: b.length, sha256: sha(b)});
      expect(levelOfAsset(url)).toBe('mall');
      expect(assetAllowedIn('office', url)).toBe(false);
      expect(assetAllowedIn('subway', url)).toBe(false);
      const p = prov.files.find(f => f.output.url === url)!;
      expect(p, url).toBeDefined();
      expect(p.output).toMatchObject({bytes: b.length, sha256: sha(b), width: 512, height: 512});
      expect(p.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(p.source.sha256).not.toBe(p.output.sha256);
      expect(p.source.file).toBe(`ad-${id}/ad-${id}-original.png`);
      expect([p.source.width, p.source.height]).toEqual([1254, 1254]);
      expect(p.codex.generator).toBe('Codex native image_gen (owned Codex CLI)');
      expect(p.codex.threadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(p.codex.nativeSha256Matches).toBe(true);
      expect(p.codex.exit).toBe(0);
      expect(p.prompt).toMatch(/NO text/);
    }
    expect(new Set(prov.files.map(f => f.codex.threadId)).size).toBe(set.ids.length);
    expect(new Set(prov.files.map(f => f.source.sha256)).size).toBe(set.ids.length);
   }
  });

  it('the provenance and CREDITS are allowlisted at their current bytes; no URLs, tokens or local paths in public provenance', () => {
    for (const rel of [PROV_REL, LINGERIE_PROV_REL, 'assets/CREDITS.md']) {
      const b = readFileSync(`${PUB}${rel}`);
      expect(entry(rel), rel).toEqual({path: rel, bytes: b.length, sha256: sha(b)});
    }
    const credits = readFileSync(`${PUB}assets/CREDITS.md`, 'utf8');
    for (const set of ART_SETS) {
      const text = readFileSync(`${PUB}${set.prov}`, 'utf8');
      expect(text).not.toMatch(/https?:|Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key|\/home\/|\/workspaces\//i);
      const sec = credits.slice(credits.indexOf(`<!-- BEGIN ${set.credits}`), credits.indexOf(`<!-- END ${set.credits} -->`));
      expect(sec).toMatch(/Codex native image generation/);
      expect(sec).toMatch(/no licence or commercial clearance implied/);
      for (const id of set.ids) expect(sec).toContain(`\`${AD_ART_URLS[id]}\``);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Drawing: a recording 2D context (structural: which calls, which source) and the rasterizing shim (pixels)

type Call = {m: string; a: unknown[]};
function recordingDocument(): {calls: () => Call[]; texts: () => string[]; restore: () => void} {
  let log: Call[] = [];
  const g = globalThis as unknown as {document?: unknown};
  const prev = g.document;
  g.document = {createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(tag);
    log = [];
    const state: Record<string, unknown> = {font: '10px sans-serif'};
    const ctx = new Proxy(state, {
      get(t, k) {
        if (typeof k !== 'string') return undefined;
        if (k in t) return t[k];
        if (k === 'measureText') return (s: string) => ({width: s.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(t.font))?.[1] ?? '10') * 0.55});
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a: unknown[]) => { log.push({m: k, a}); return {addColorStop() { /* recorded */ }}; };
        return (...a: unknown[]) => { log.push({m: k, a}); };
      },
      set(t, k, v) { t[k as string] = v; return true; },
    });
    return {width: 0, height: 0, getContext: () => ctx};
  }};
  return {calls: () => log, texts: () => log.filter(c => c.m === 'fillText').map(c => String(c.a[0])), restore: () => { g.document = prev; }};
}
const count = (calls: Call[], m: string) => calls.filter(c => c.m === m).length;
const fakeImage = (name: string, size = 512): AdArtImage => ({width: size, height: size, name, close: vi.fn()} as unknown as AdArtImage);
/** No figure / pictogram: no curves or ellipses, at most the roundel + a torn corner filled as paths, at most the aging scratches as lines. */
function expectNoDrawnArt(calls: Call[], label: string): void {
  expect(count(calls, 'ellipse'), `${label}: ellipses`).toBe(0);
  expect(count(calls, 'bezierCurveTo') + count(calls, 'quadraticCurveTo'), `${label}: curves`).toBe(0);
  expect(count(calls, 'arc'), `${label}: arcs (the roundel only)`).toBeLessThanOrEqual(1);
  expect(count(calls, 'fill'), `${label}: path fills (roundel + torn corner)`).toBeLessThanOrEqual(2);
  expect(count(calls, 'lineTo'), `${label}: lines (5 scratches + a torn corner)`).toBeLessThanOrEqual(7);
  expect(count(calls, 'roundRect'), `${label}: rounded shapes`).toBe(0);
}

const FACES: MallAd[] = [
  ad({kind: 'poster', program: 'womenswear', shop: 's1', w: 0.9, h: 1.3, seed: 11}),
  ad({kind: 'poster', program: 'electronics', shop: 's2', w: 1.2, h: 0.9, seed: 12}),
  ad({kind: 'lightbox', program: 'pharmacy', shop: 's3', w: 1.1, h: 1.7, seed: 13, glow: 1}),
  ad({kind: 'billboard', program: 'mall', w: 2.6, h: 1.6, seed: 14, slot: 'gallery', glow: 1}),
  ad({kind: 'decal', program: 'clothing', shop: 's4', w: 0.9, h: 1.2, seed: 15, slot: 'window'}),
  ad({kind: 'decal', program: 'sports', shop: 's5', w: 2.0, h: 0.8, seed: 16, slot: 'window'}),
  ad({kind: 'cart', program: 'kiosk', brand: 'Pretzel Twist', w: 1.1, h: 0.42, seed: 17, slot: 'cart', glow: 0.4}),
];

describe('adTexture / drawMenu draw the Codex art under the dynamic text (recording context)', () => {
  let doc: ReturnType<typeof recordingDocument>;
  const images = new Map<AdArtId, AdArtImage>(AD_ART_IDS.map(id => [id, fakeImage(id)]));
  beforeAll(() => { doc = recordingDocument(); });
  afterAll(() => { doc.restore(); releaseMallAdArt(); });
  const hold = () => { for (const [id, img] of images) setMallAdArt(id, img); };

  it('with the image held: ONE cover-cropped draw of the ad\'s own image (aspect kept, inside the image), brand + headline text, no drawn art', () => {
    hold();
    for (const a of FACES) {
      const brand = a.brand ?? 'Harbour Lane';
      const tex = adTexture(a, brand), {w, h} = adCanvasSize(a), calls = doc.calls(), label = `${a.kind} ${a.program}`;
      expect((tex.image as {width: number}).width).toBe(w); // same canvas size class (adCanvasSize)
      const draws = calls.filter(c => c.m === 'drawImage');
      expect(draws.length, label).toBe(1);
      const [img, sx, sy, sw, sh, dx, dy, dw, dh] = draws[0].a as [AdArtImage, number, number, number, number, number, number, number, number];
      expect(img, label).toBe(images.get(adArtOf(a, brand)));
      expect(sx).toBeGreaterThanOrEqual(-1e-6); expect(sy).toBeGreaterThanOrEqual(-1e-6);
      expect(sx + sw).toBeLessThanOrEqual(512 + 1e-6); expect(sy + sh).toBeLessThanOrEqual(512 + 1e-6);
      expect(sw / sh, `${label} cover aspect`).toBeCloseTo(dw / dh, 3);
      expect(dx).toBeGreaterThanOrEqual(0); expect(dy).toBeGreaterThanOrEqual(0);
      expect(dx + dw).toBeLessThanOrEqual(w + 1e-6); expect(dy + dh).toBeLessThanOrEqual(h + 1e-6);
      if (a.kind === 'decal') {
        // vinyl: the print sits on an opaque panel inside the face (glass round it), the sale band is opaque too
        expect(dx).toBeGreaterThan(0); expect(dy).toBeGreaterThan(0);
        const iDraw = calls.indexOf(draws[0]);
        const panel = calls.slice(0, iDraw).filter(c => c.m === 'fillRect').map(c => c.a as number[]);
        expect(panel.some(([x, y, pw, ph]) => x <= dx && y <= dy && x + pw >= dx + dw && y + ph >= dy + dh), `${label} opaque panel under the print`).toBe(true);
      } else if (w > h * 1.6) expect(dx, `${label}: the text panel stays clear on the left`).toBeGreaterThan(w * 0.4);
      else expect(dw * dh).toBeCloseTo(w * h, 0); // full-bleed
      expect(doc.texts(), label).toContain(brand.toUpperCase());
      expect(doc.texts().length, label).toBeGreaterThanOrEqual(2); // headline + brand
      expectNoDrawnArt(calls, label);
      tex.dispose();
    }
  });

  it('with no image held: no image draw, a plain palette fill, still the brand text — never substitute drawn art', () => {
    releaseMallAdArt();
    for (const a of FACES) {
      const brand = a.brand ?? 'Harbour Lane', label = `${a.kind} ${a.program}`;
      adTexture(a, brand).dispose();
      const calls = doc.calls();
      expect(count(calls, 'drawImage'), label).toBe(0);
      expect(doc.texts(), label).toContain(brand.toUpperCase());
      expectNoDrawnArt(calls, label);
    }
  });

  it('menu boards: each panel tile shows a DIFFERENT item crop of the food / café image; item lines + prices + brand; none without the image', () => {
    hold();
    const burger = ad({kind: 'menu', program: 'food-court', shop: 'f1', w: 2.0, h: 0.6, seed: 21, slot: 'menu', glow: 1, cuisine: 'burger'});
    const coffee = ad({kind: 'menu', program: 'cafe', shop: 'f2', w: 1.6, h: 0.6, seed: 22, slot: 'menu', glow: 1, cuisine: 'coffee'});
    for (const [m, art, panels] of [[burger, 'food', 3], [coffee, 'cafe', 2]] as const) {
      adTexture(m, 'Grill Theory').dispose();
      const draws = doc.calls().filter(c => c.m === 'drawImage');
      expect(draws.length, m.cuisine).toBe(panels);
      for (const d of draws) {
        expect(d.a[0]).toBe(images.get(art));
        const [, , , sw, sh, , , dw, dh] = d.a as number[];
        expect(sw / sh).toBeCloseTo(dw / dh, 3); // square tiles, square crops
        expect(sw).toBeLessThan(512 * 0.8); // zoomed into one item, not the whole picture
      }
      expect(new Set(draws.map(d => `${(d.a[1] as number).toFixed(1)},${(d.a[2] as number).toFixed(1)}`)).size, 'distinct crops').toBe(panels);
      expect(doc.texts()).toContain('GRILL THEORY');
      expect(doc.texts().filter(t => /^\$\d+\.\d\d$/.test(t)).length).toBeGreaterThanOrEqual(2 * panels);
      expectNoDrawnArt(doc.calls(), `menu ${m.cuisine}`);
    }
    adTexture(burger, 'Grill Theory').dispose();
    expect(doc.texts().some(t => MENU_BURGER.includes(t))).toBe(true);
    releaseMallAdArt();
    adTexture(burger, 'Grill Theory').dispose();
    expect(count(doc.calls(), 'drawImage')).toBe(0);
    expect(count(doc.calls(), 'fill')).toBe(0); // tiles are plain fills (no pictogram paths)
    expectNoDrawnArt(doc.calls(), 'menu without art');
  });
});

describe('crop geometry', () => {
  it('coverWindow keeps the destination aspect inside the image and the focus in view (top-aligned when it cannot fit)', () => {
    for (const id of AD_ART_IDS) for (const [dw, dh] of [[144, 224], [224, 224], [288, 216], [241, 256], [416, 160], [130, 92]]) {
      const f = AD_ART_FOCUS[id], [sx, sy, sw, sh] = coverWindow(512, 512, dw, dh, f);
      expect(sx).toBeGreaterThanOrEqual(0); expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx + sw).toBeLessThanOrEqual(512 + 1e-9); expect(sy + sh).toBeLessThanOrEqual(512 + 1e-9);
      expect(sw / sh).toBeCloseTo(dw / dh, 6);
      expect(Math.max(sw, sh)).toBeCloseTo(512, 6); // as large as the image allows (cover)
      // the focus centre is always in view; a focus that fits along the cropped axis is wholly in view
      const cx = (f.x0 + f.x1) / 2 * 512, cy = (f.y0 + f.y1) / 2 * 512;
      expect(cx >= sx - 1e-9 && cx <= sx + sw + 1e-9 && cy >= sy - 1e-9 && cy <= sy + sh + 1e-9, `${id} ${dw}x${dh}`).toBe(true);
      if ((f.y1 - f.y0) * 512 <= sh) { expect(sy).toBeLessThanOrEqual(f.y0 * 512 + 1e-6); expect(sy + sh).toBeGreaterThanOrEqual(f.y1 * 512 - 1e-6); }
      else expect(sy).toBeCloseTo(f.y0 * 512, 6); // e.g. a full-length figure on a wide face: the head stays
    }
    // a text band at the bottom: a focus that fits lands above it
    const f = AD_ART_FOCUS.electronics, [, sy, , sh] = coverWindow(512, 512, 300, 200, f, [0, 0.7]);
    expect((f.y0 * 512 - sy) / sh).toBeGreaterThanOrEqual(0);
    expect((f.y1 * 512 - sy) / sh).toBeLessThanOrEqual(0.7 + 1e-6);
  });

  it('cropWindow zooms into a menu item: the box in view, the destination aspect, inside the image', () => {
    for (const crops of Object.values(AD_ART_MENU_CROPS)) for (const b of crops!) {
      const [sx, sy, sw, sh] = cropWindow(512, 512, b, 50, 50);
      expect(sw).toBeCloseTo(sh, 6);
      expect(sx).toBeGreaterThanOrEqual(0); expect(sy).toBeGreaterThanOrEqual(0);
      expect(sx + sw).toBeLessThanOrEqual(512 + 1e-9); expect(sy + sh).toBeLessThanOrEqual(512 + 1e-9);
      expect(sx).toBeLessThanOrEqual(b.x0 * 512 + 1e-6); expect(sx + sw).toBeGreaterThanOrEqual(b.x1 * 512 - 1e-6);
      expect(sy).toBeLessThanOrEqual(b.y0 * 512 + 1e-6); expect(sy + sh).toBeGreaterThanOrEqual(b.y1 * 512 - 1e-6);
    }
  });
});

describe('pixels (rasterizing shim): the subject in view, the band under the text, vinyl on an opaque panel', () => {
  let restore: () => void;
  beforeAll(() => { restore = installCanvasShim(true); });
  afterAll(() => { restore(); releaseMallAdArt(); });
  /** A fake decoded image: RED inside the image's focus box, GREEN elsewhere (64 px: the crop maths is size-free). */
  const twoTone = (id: AdArtId): AdArtImage => {
    const c = document.createElement('canvas') as unknown as ShimCanvas;
    c.width = c.height = 64;
    const x = c.getContext(), f = AD_ART_FOCUS[id];
    x.fillStyle = '#00ff00'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#ff0000'; x.fillRect(f.x0 * 64, f.y0 * 64, (f.x1 - f.x0) * 64, (f.y1 - f.y0) * 64);
    return c as unknown as AdArtImage;
  };
  const px = (t: THREE.CanvasTexture, x: number, y: number) => {
    const c = t.image as unknown as ShimCanvas, i = (Math.floor(y) * c.width + Math.floor(x)) * 4;
    return [c.data[i], c.data[i + 1], c.data[i + 2], c.data[i + 3]];
  };
  const red = ([r, g, b]: number[]) => r > 150 && r > g + 60 && r > b + 60;
  const green = ([r, g, b]: number[]) => g > 150 && g > r + 60 && g > b + 60;

  it('a portrait poster: the figure (focus) fills the face centre; the bottom band is the palette, not the picture', () => {
    setMallAdArt('womenswear', twoTone('womenswear'));
    const a = ad({kind: 'poster', program: 'womenswear', shop: 's1', w: 0.9, h: 1.3, seed: 31});
    const t = adTexture(a, 'Rose & Thread'), {w, h} = adCanvasSize(a);
    expect(red(px(t, w / 2, h * 0.4)), `centre ${px(t, w / 2, h * 0.4)}`).toBe(true);
    const band = px(t, 1, h - h * 0.22 * 0.5);
    expect(green(band) || red(band), `band ${band}`).toBe(false);
    t.dispose();
  });

  it('a wide billboard: the text panel on the left is the palette colour, the art (its subject) on the right', () => {
    setMallAdArt('shopping', twoTone('shopping'));
    const a = ad({kind: 'billboard', program: 'mall', w: 2.6, h: 1.6, seed: 32, slot: 'gallery'});
    const t = adTexture(a, 'Harbourline Center'), {w, h} = adCanvasSize(a);
    const panel = px(t, w * 0.02, h * 0.95);
    expect(red(panel) || green(panel), `panel ${panel}`).toBe(false);
    expect(red(px(t, w * 0.71, h * 0.45)), `art ${px(t, w * 0.71, h * 0.45)}`).toBe(true);
    t.dispose();
  });

  it('window vinyl: transparent glass round an OPAQUE art panel and an opaque sale band (survive the 0.5 alpha test)', () => {
    setMallAdArt('womenswear', twoTone('womenswear'));
    setMallAdArt('menswear', twoTone('menswear'));
    const a = ad({kind: 'decal', program: 'clothing', shop: 's4', w: 0.9, h: 1.2, seed: 33, slot: 'window'});
    const t = adTexture(a, 'Northbound Outfitters'), {w, h} = adCanvasSize(a);
    expect(px(t, 0, 0)[3]).toBe(0);
    const mid = px(t, w / 2, h * 0.35);
    expect(mid[3]).toBe(255);
    expect(red(mid), `panel ${mid}`).toBe(true);
    expect(px(t, 2, h - h * 0.22 * 0.5)[3]).toBe(255); // the sale band
    t.dispose();
  });

  it('no image: the same faces are plain palette fills (no red / green anywhere, no shapes)', () => {
    releaseMallAdArt();
    const a = ad({kind: 'poster', program: 'womenswear', shop: 's1', w: 0.9, h: 1.3, seed: 31});
    const t = adTexture(a, 'Rose & Thread'), {w, h} = adCanvasSize(a), bg = adPalette('womenswear').bg;
    const want = [1, 3, 5].map(k => parseInt(bg.slice(k, k + 2), 16));
    const p = px(t, w / 2, h * 0.45);
    expect(red(p) || green(p)).toBe(false);
    for (let k = 0; k < 3; k++) expect(Math.abs(p[k] - want[k]), `${p} vs ${bg}`).toBeLessThan(60); // the palette under the aging
    t.dispose();
  });
});

describe('loader: held only between the mall preload and its atlas build; other levels load none', () => {
  it('preload decodes the twelve files (deduplicated, failures absent), release closes them', async () => {
    releaseMallAdArt();
    const asked: string[] = [], imgs: AdArtImage[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = async (url: string) => { asked.push(url); await Promise.resolve(); if (url.endsWith('ad-health.jpg')) throw new Error('404'); const i = fakeImage(url); imgs.push(i); return i; };
    const before = {...adArtStats};
    const [a, b] = await Promise.all([preloadMallAdArt(load), preloadMallAdArt(load)]);
    warn.mockRestore();
    expect(asked.sort()).toEqual(Object.values(AD_ART_URLS).sort()); // once each, the shipped paths
    expect(a).toEqual(AD_ART_IDS.filter(id => id !== 'health'));
    expect(b).toEqual(a);
    expect(mallAdArt('health')).toBeNull();
    expect(mallAdArtSummary().held).toEqual(a);
    expect(adArtStats.loaded - before.loaded).toBe(AD_ART_IDS.length - 1);
    expect(adArtStats.failed - before.failed).toBe(1);
    expect(releaseMallAdArt()).toBe(AD_ART_IDS.length - 1);
    for (const i of imgs) expect(i.close).toHaveBeenCalledTimes(1);
    expect(mallAdArtSummary().held).toEqual([]);
  });

  it('MallArch.buildAds holds them for the faces and releases them after (also when the build throws)', () => {
    const img = fakeImage('food');
    for (const fail of [false, true]) {
      for (const id of AD_ART_IDS) setMallAdArt(id, id === 'food' ? img : fakeImage(id));
      let seen: AdArtImage | null = null;
      const host = {adArt: null as unknown as MallArch['adArt'], buildAdFaces() { seen = mallAdArt('food'); if (fail) throw new Error('boom'); }};
      const run = () => MallArch.prototype.buildAds.call(host as unknown as MallArch, new THREE.Group(), () => {});
      if (fail) expect(run).toThrow('boom'); else run();
      expect(seen).toBe(img);
      expect(host.adArt.loaded).toEqual([...AD_ART_IDS]);
      expect(host.adArt.released).toBe(AD_ART_IDS.length);
      expect(mallAdArtSummary().held).toEqual([]);
    }
  });

  it('the game installs it behind the loading screen: section preloads run in prepareSection, before buildSection builds the world', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/game.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/installMallAtmosphere\(this\)/);
    const prep = src.indexOf('async prepareSection('), pre = src.indexOf('for (const pre of this.sectionPreloads)', prep), ret = src.indexOf('return layout;', prep);
    expect(prep).toBeGreaterThan(0);
    expect(pre).toBeGreaterThan(prep);
    expect(pre).toBeLessThan(ret);
    // every build of a section is preceded by its prepareSection (new game / retry / travel)
    const builds = [...src.matchAll(/this\.buildSection\(/g)].length, prepares = [...src.matchAll(/await this\.prepareSection\(/g)].length;
    expect(builds).toBeGreaterThan(0);
    expect(prepares).toBe(builds);
  });

  it('the mall section preload runs for mall layouts only; any other level drops a leftover and fetches nothing', async () => {
    const preloads: ((l: StationLayout) => Promise<void>)[] = [];
    new MallAtmosphere({scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), sectionHooks: [], sectionPreloads: preloads});
    expect(preloads.length).toBe(1);
    setMallAdArt('food', fakeImage('food'));
    const n = adArtStats.preloads;
    await preloads[0]({} as StationLayout); // a Subway / Office layout
    expect(adArtStats.preloads).toBe(n);
    expect(mallAdArt('food')).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await preloads[0]({mall: {}} as unknown as StationLayout); // no browser here: every fetch fails, quietly absent
    warn.mockRestore();
    expect(adArtStats.preloads).toBe(n + 1);
    releaseMallAdArt();
  });
});
