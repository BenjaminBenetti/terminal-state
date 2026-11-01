// Task studio-beta-mall-round4-20261101-01 (lane ADS — user: "use codex to produce images for the adds, not draw them by hand :P"):
// the mall's advertising ARTWORK = eight Codex-generated images (root CLAUDE.md "Textures — Codex generates new static artwork"),
// shipped as runtime derivatives assets/textures/mall/ads/ad-<id>.jpg (512 px sRGB JPEG: resize + format conversion only, built by
// tools/asset-pipeline/mall-ads/build-ad-art.mjs; provenance with prompts, Codex thread ids and source hashes:
// assets/derivatives/mall-ad-art-20261101.json). Level-only by path (assets/levelAssets.ts mall rule: assets/textures/mall/**).
// world/mallAds.ts draws them under the code-driven (dynamic, exempt) fictional brand / headline / price / menu text and aging.
//
// Loading model (assets/levelAssets.ts step 2): a MALL section preload (world/mallAtmosphere.ts -> Game.sectionPreloads) fetches and
// decodes the eight files behind the mall's loading screen BEFORE the world is built; MallArch.buildAds reads them synchronously while
// it draws the ad canvases and RELEASES them once the atlas pages are packed (ImageBitmap.close(): the decoded pixels live only for
// the build; the atlas canvases carry the result). Every mall build preloads again (Retry / travel: the browser cache serves the
// bytes). Other levels never load them (the preload runs for layout.mall only and drops any leftover). A missing / failed image is
// simply absent: that ad draws a plain palette fill — never substitute drawn art.

import {assetUrl} from './loader';
import {assetAllowedIn} from './levelAssets';

/** The eight accepted Codex artworks (provenance order). */
export const AD_ART_IDS = ['womenswear', 'menswear', 'food', 'cafe', 'electronics', 'health', 'sports', 'shopping'] as const;
export type AdArtId = (typeof AD_ART_IDS)[number];

/** Runtime files (literal relative paths: the CI packager verifies each one ships). */
export const AD_ART_URLS: Readonly<Record<AdArtId, string>> = {
  womenswear: 'assets/textures/mall/ads/ad-womenswear.jpg',
  menswear: 'assets/textures/mall/ads/ad-menswear.jpg',
  food: 'assets/textures/mall/ads/ad-food.jpg',
  cafe: 'assets/textures/mall/ads/ad-cafe.jpg',
  electronics: 'assets/textures/mall/ads/ad-electronics.jpg',
  health: 'assets/textures/mall/ads/ad-health.jpg',
  sports: 'assets/textures/mall/ads/ad-sports.jpg',
  shopping: 'assets/textures/mall/ads/ad-shopping.jpg',
};

/** A box in normalised image coordinates (0..1, y down). */
export interface ArtBox { x0: number; y0: number; x1: number; y1: number }

/**
 * Per image the part a crop must keep (measured on the accepted sources): the fashion photos keep head to hem (a full-length figure
 * in a narrow column — a wide crop shows the upper body, never cuts the head); the product photos keep the product group (upper two
 * thirds, wide). The lower third of every image is plain backdrop / floor, which is where the text band goes.
 */
export const AD_ART_FOCUS: Readonly<Record<AdArtId, ArtBox>> = {
  womenswear: {x0: 0.3, y0: 0, x1: 0.69, y1: 0.62},
  menswear: {x0: 0.29, y0: 0, x1: 0.71, y1: 0.62},
  food: {x0: 0, y0: 0.05, x1: 1, y1: 0.73},
  cafe: {x0: 0.02, y0: 0, x1: 0.98, y1: 0.64},
  electronics: {x0: 0.06, y0: 0.2, x1: 1, y1: 0.62},
  health: {x0: 0.04, y0: 0.05, x1: 0.97, y1: 0.62},
  sports: {x0: 0.14, y0: 0.1, x1: 0.94, y1: 0.68},
  shopping: {x0: 0, y0: 0.08, x1: 1, y1: 0.68},
};

/** Menu-board panel crops (one item each: burger / fries / cup; latte / croissant / the whole spread), cycled per panel. */
export const AD_ART_MENU_CROPS: Readonly<Partial<Record<AdArtId, readonly ArtBox[]>>> = {
  food: [{x0: 0.32, y0: 0.28, x1: 0.84, y1: 0.73}, {x0: 0, y0: 0.34, x1: 0.37, y1: 0.7}, {x0: 0.66, y0: 0.06, x1: 0.99, y1: 0.68}],
  cafe: [{x0: 0.05, y0: 0.12, x1: 0.62, y1: 0.6}, {x0: 0.5, y0: 0.15, x1: 0.98, y1: 0.62}, {x0: 0.03, y0: 0.05, x1: 0.97, y1: 0.65}],
};

/** A decoded image the 2D canvas can draw (ImageBitmap in the browser; a canvas in tests). */
export type AdArtImage = CanvasImageSource & {width: number; height: number; close?(): void};
export type AdArtLoad = (url: string) => Promise<AdArtImage>;

const held = new Map<AdArtId, AdArtImage>();
const inflight = new Map<AdArtId, Promise<void>>();
let lastFailed: AdArtId[] = [];
/** Counters (QA `__LL.mallAds().art`). */
export const adArtStats = {preloads: 0, loaded: 0, failed: 0, released: 0, refused: 0};

/** Browser loader: fetch + createImageBitmap (decoded off the main thread; `close()` frees it). */
const fetchBitmap: AdArtLoad = async url => {
  const res = await fetch(assetUrl(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await createImageBitmap(await res.blob());
};

/**
 * Decodes every ad artwork not held yet (call from a mall section preload, behind the loading screen). Never throws: a failed
 * file stays absent (its ads draw the plain palette fill). Resolves with the ids held afterwards.
 */
export async function preloadMallAdArt(load: AdArtLoad = fetchBitmap): Promise<AdArtId[]> {
  adArtStats.preloads++;
  await Promise.all(AD_ART_IDS.map(id => {
    if (held.has(id)) return Promise.resolve();
    let p = inflight.get(id);
    if (!p) {
      const url = AD_ART_URLS[id];
      p = (async () => {
        if (!assetAllowedIn('mall', url)) { adArtStats.refused++; return; }
        try { held.set(id, await load(url)); adArtStats.loaded++; } catch (err) {
          adArtStats.failed++;
          console.warn(`Mall ad art ${id} failed to load (its ads draw a plain fill)`, err);
        }
      })().finally(() => inflight.delete(id));
      inflight.set(id, p);
    }
    return p;
  }));
  lastFailed = AD_ART_IDS.filter(id => !held.has(id));
  return AD_ART_IDS.filter(id => held.has(id));
}

/** The decoded artwork for `id` while held (between the preload and the atlas build), else null. */
export function mallAdArt(id: AdArtId): AdArtImage | null {
  return held.get(id) ?? null;
}

/** Frees every held artwork (ImageBitmap.close) — MallArch.buildAds once its atlas pages are packed. Returns the count. */
export function releaseMallAdArt(): number {
  const n = held.size;
  for (const img of held.values()) { try { img.close?.(); } catch { /* already closed */ } }
  held.clear();
  adArtStats.released += n;
  return n;
}

/** Tests / tools: hold an image for `id` (null: drop it) without a fetch. */
export function setMallAdArt(id: AdArtId, img: AdArtImage | null): void {
  if (img) held.set(id, img); else held.delete(id);
}

/** QA: what is held now, what failed in the last preload, counters. */
export function mallAdArtSummary(): {held: AdArtId[]; lastFailed: AdArtId[]; stats: typeof adArtStats} {
  return {held: AD_ART_IDS.filter(id => held.has(id)), lastFailed: [...lastFailed], stats: {...adArtStats}};
}
