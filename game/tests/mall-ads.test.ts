// Task mall-playtest-revision-20261031 (lane SHOPS, D06 — user: "there was no uh billboards or anything like certainly the stores would
// have like pictures of people wearing the clothes ... some ads and some billboards"): the shops' ad / fashion-merchandising PLACEMENT
// records (gen/mall/ads.ts -> layout.mall.ads, rendered by lane ARCH). Layout-agnostic: the dressed synthetic shop rings
// (tests/helpers/mallShopsFixture.ts), a few seeds, cached.
// Task mall-round3-20261031 (lane SHOPS, R5 — user: "there are no adds ... They should appear on kiosks, and as posters in the store
// and stuff"): + eye-level in-store posters, kiosk-cell ads, food-counter menu boards, kiosk-cart header signs standing on the cart's
// canopy, static backlight (glow) shares. (The REAL generated mall's per-kind case lives in tests/mall-shops.test.ts, on its memoized
// seed-4242 mall: CI time, PR #25.)
import {describe, expect, it} from 'vitest';
import {Rng} from '../src/core/rng';
import {CELL} from '../src/gen/grid';
import {wallBacked} from '../src/gen/doorways';
import {areaBase} from '../src/gen/placeKit';
import type {StationLayout} from '../src/gen/stationTypes';
import {MALL_PROGRAMS, assignMallPrograms, shopFit} from '../src/gen/mall/shops';
import {dressMallShops} from '../src/gen/mall/shopsDress';
import {CART_AD, EYE_POSTER, FASHION, GLOW_DEAD, MENU_BOARD, adBox, adGlow, mallAds, placeMallAds, propBox, type MallAd} from '../src/gen/mall/ads';
import {mallShopsFixture} from './helpers/mallShopsFixture';
import {checkMenu} from './helpers/mallAdsChecks';

function dressed(seed: number): StationLayout {
  const {layout} = mallShopsFixture(2);
  assignMallPrograms(layout, new Rng(seed));
  dressMallShops(layout, new Rng(seed ^ 0x5eed), {frame: 'absolute'});
  return layout;
}
const cache = new Map<number, StationLayout>();
const get = (seed: number) => { let v = cache.get(seed); if (!v) cache.set(seed, (v = dressed(seed))); return v; };
const SEEDS = [1, 2, 3];
const ov = (a: ReturnType<typeof adBox>, b: ReturnType<typeof adBox>, e = 0.005) =>
  a.x0 < b.x1 - e && b.x0 < a.x1 - e && a.y0 < b.y1 - e && b.y0 < a.y1 - e && a.z0 < b.z1 - e && b.z0 < a.z1 - e;
/** Lowest bottom (m above the storey floor) per wall slot. */
const MIN_BOTTOM: Record<string, number> = {header: 1.6, eye: EYE_POSTER.bottom, display: 0.6, menu: MENU_BOARD.bottom};
/** The cart a header record stands on (same storey, same centre). */
const cartOf = (L: StationLayout, ad: MallAd) => L.props.find(p => p.kind === 'mallKioskCart' && (p.level ?? 0) === ad.level && Math.abs(p.x - ad.x) < 1e-3 && Math.abs(p.z - ad.z) < 1e-3);

describe('D06 / R5 shop ad / merchandising placement records', () => {
  it('every shop record belongs to a real shop, faces its room / the walkway, sits inside its wall span at absolute heights', () => {
    for (const seed of SEEDS) {
      const L = get(seed), ads = mallAds(L);
      expect(ads.length, `seed ${seed}`).toBeGreaterThan(30);
      for (const ad of ads) {
        expect(['poster', 'lightbox', 'decal', 'menu', 'cart']).toContain(ad.kind);
        expect(Math.abs(ad.nx) + Math.abs(ad.nz)).toBe(1); // unit axis-aligned
        if (ad.kind === 'cart') continue; // (R5) no shop: the kiosk-cart test below
        const shop = L.mall!.shops.find(s => s.id === ad.shop)!;
        expect(shop, `seed ${seed} ${ad.shop}`).toBeDefined();
        const fit = shopFit(shop)!;
        expect(fit.kind).not.toBe('service');
        expect(ad.program).toBe(fit.program);
        const a = L.areas[shop.area], base = areaBase(L, a);
        expect(ad.level).toBe(a.level ?? 0);
        expect(ad.y - ad.h / 2).toBeGreaterThanOrEqual(base + 0.3 - 1e-6);
        expect(ad.y + ad.h / 2).toBeLessThanOrEqual(a.ceil - 0.2 + 1e-6);
        const x0 = a.x * CELL, x1 = (a.x + a.w) * CELL, z0 = a.y * CELL, z1 = (a.y + a.h) * CELL;
        const along = ad.nz !== 0 ? ad.x : ad.z, [s0, s1] = ad.nz !== 0 ? [x0, x1] : [z0, z1];
        expect(along - ad.w / 2).toBeGreaterThanOrEqual(s0 - 1e-6);
        expect(along + ad.w / 2).toBeLessThanOrEqual(s1 + 1e-6);
        if (ad.kind === 'decal') {
          // on a glazing span of its own unit, facing OUT of the unit (toward the walkway)
          expect(ad.slot).toBe('window');
          const gl = L.props.find(p => p.kind === 'shopGlazing' && p.area === a.id && Math.abs(p.x - ad.x) < 1e-3 && Math.abs(p.z - ad.z) < 1e-3);
          expect(gl, `seed ${seed} ${ad.shop} decal on glazing`).toBeDefined();
          expect(ad.w).toBeLessThanOrEqual(2 * Math.max(gl!.hx, gl!.hz) + 1e-6);
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          expect(ad.nx * (ad.x - cx) + ad.nz * (ad.z - cz), 'faces away from the unit centre').toBeGreaterThan(0);
        } else {
          // wall-backed over its width at its bottom and at 1.0 m (never over a door / opening), on a wall of its area, facing in
          const side = ad.nz === 1 ? 'N' : ad.nz === -1 ? 'S' : ad.nx === 1 ? 'W' : 'E';
          const line = side === 'N' ? z0 : side === 'S' ? z1 : side === 'W' ? x0 : x1;
          const off = ad.kind === 'lightbox' ? 0.06 : ad.kind === 'menu' ? MENU_BOARD.depth / 2 : 0.015;
          expect(Math.abs((ad.nz !== 0 ? ad.z : ad.x) - (line + (ad.nz || ad.nx) * off))).toBeLessThan(1e-3);
          const g = L.levels![a.level ?? 0].grid;
          expect(wallBacked(g, a, side, along - ad.w / 2, along + ad.w / 2, ad.y - ad.h / 2), `seed ${seed} ${ad.shop} ${ad.kind} backed`).toBe(true);
          expect(wallBacked(g, a, side, along - ad.w / 2, along + ad.w / 2, base + 1.0)).toBe(true);
          expect(MIN_BOTTOM[ad.slot!], `slot ${ad.slot}`).toBeDefined();
          expect(ad.y - ad.h / 2).toBeGreaterThanOrEqual(base + MIN_BOTTOM[ad.slot!] - 1e-6);
          if (ad.slot === 'eye') expect(ad.y + ad.h / 2).toBeLessThanOrEqual(base + EYE_POSTER.top + 1e-6);
        }
      }
    }
  });

  it('records overlap no prop (mounted ones too), no other record, no wall sign; decals never sit over an entry span', () => {
    // (CI time, PR #25: violations are collected and asserted once — the same pairs / boxes as one expect per pair; `checked` counts
    // every pair / box test so the domain stays visible: f5224bd ran ~249k expects here, one per check)
    const bad: string[] = [];
    let checked = 0;
    const test = (fail: boolean, msg: () => string) => { checked++; if (fail) bad.push(msg()); };
    for (const seed of SEEDS) {
      const L = get(seed), ads = mallAds(L);
      const boxes = ads.map(ad => adBox(ad));
      const props = L.props.map(p => ({p, b: propBox(p), lv: p.level ?? 0}));
      for (const [i, ad] of ads.entries()) {
        const own = ad.kind === 'cart' ? cartOf(L, ad) : undefined;
        for (const {p, b, lv} of props) {
          if (lv !== ad.level) continue;
          if (ad.kind === 'decal' && (p.kind === 'shopGlazing' || p.kind === 'shopShutter')) continue; // it lies on its glass
          if (p === own) continue; // (R5) a cart header stands on its own cart (its finials reach past the canopy top): the cart test
          test(ov(boxes[i], b), () => `seed ${seed} ${ad.shop ?? ad.kind} ${ad.kind} vs ${p.kind}`);
        }
        for (const [j, q] of ads.entries()) if (j !== i && q.level === ad.level) test(ov(boxes[i], boxes[j]), () => `seed ${seed} ${ad.shop} ${ad.kind} vs ${q.kind}`);
        for (const s of L.signs) if ((s.level ?? 0) === ad.level && !s.hang) {
          const sw = (s.w ?? 1.4) / 2;
          test(ov(boxes[i], {x0: s.x - sw, x1: s.x + sw, z0: s.z - sw, z1: s.z + sw, y0: s.y - 0.35, y1: s.y + 0.35}), () => `seed ${seed} ${ad.shop} ${ad.kind} vs sign`);
        }
        if (ad.kind === 'decal') {
          // not over the walk-in opening: the decal's span lies on its glazing prop only (the entry span has no glazing)
          const shop = L.mall!.shops.find(s => s.id === ad.shop)!;
          const along = ad.nz !== 0 ? ad.x : ad.z, f = shop.frontage, fs = ad.nz !== 0 ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1);
          const e = shopFit(shop)!.entry;
          const e0 = fs + e[0], e1 = fs + e[1];
          test(!(along + ad.w / 2 <= e0 + 1e-6 || along - ad.w / 2 >= e1 - 1e-6), () => `seed ${seed} ${ad.shop} decal over the entry`);
        }
      }
    }
    process.stdout.write(`[mall-ads] overlap checks evaluated: ${checked}\n`);
    expect(checked).toBeGreaterThan(200000); // the same pair / box domain as f5224bd's one-expect-per-pair loop (~249k)
    expect(bad).toEqual([]);
  });

  it('fashion stores carry window decals and a lightbox; every kind occurs; most real stores have an ad; service rooms none', () => {
    const seen = new Set<MallAd['kind']>();
    let stores = 0, withAd = 0, fashion = 0, fashionDecal = 0, fashionLight = 0;
    for (const seed of SEEDS) {
      const L = get(seed), ads = mallAds(L);
      for (const ad of ads) seen.add(ad.kind);
      for (const s of L.mall!.shops) {
        const fit = shopFit(s)!;
        const mine = ads.filter(ad => ad.shop === s.id);
        if (fit.kind === 'service') { expect(mine.length, `${s.id} ${fit.kind}`).toBe(0); continue; }
        if (fit.kind === 'store' || fit.kind === 'anchor' || fit.kind === 'food') { stores++; if (mine.length) withAd++; }
        if (FASHION.has(fit.program) && fit.front === 'glazed' && fit.kind !== 'vacant') {
          fashion++;
          if (mine.some(ad => ad.kind === 'decal')) fashionDecal++;
          if (mine.some(ad => ad.kind === 'lightbox')) fashionLight++;
        }
      }
    }
    for (const k of ['cart', 'decal', 'lightbox', 'poster'] as const) expect(seen.has(k), k).toBe(true); // (menu boards: food units — the real mall below)
    expect(withAd / stores).toBeGreaterThan(0.85);
    expect(fashion).toBeGreaterThan(3);
    expect(fashionDecal / fashion).toBeGreaterThan(0.8);
    expect(fashionLight / fashion).toBeGreaterThan(0.6);
    expect(FASHION.has('womenswear')).toBe(true);
  });

  it('R5: eye-level posters in most real stores (centre 1.2-2.0 m, by the till / entry walls), kiosk cells and food units carry ads', () => {
    let stores = 0, withEye = 0, kiosks = 0, kioskAds = 0, food = 0, withMenu = 0, eyes = 0;
    for (const seed of SEEDS) {
      const L = get(seed), ads = mallAds(L);
      for (const ad of ads.filter(q => q.slot === 'eye')) {
        eyes++;
        const a = L.areas[L.mall!.shops.find(s => s.id === ad.shop)!.area], base = areaBase(L, a);
        expect(ad.kind).toBe('poster');
        expect(ad.y - base, `seed ${seed} ${ad.shop} eye centre`).toBeGreaterThanOrEqual(1.2);
        expect(ad.y - base).toBeLessThanOrEqual(2.0);
        expect(ad.h).toBeGreaterThan(ad.w); // portrait
        expect(ad.glow).toBeUndefined(); // paper
      }
      for (const s of L.mall!.shops) {
        const fit = shopFit(s)!, mine = ads.filter(ad => ad.shop === s.id);
        if (fit.kind === 'store' || fit.kind === 'anchor') { stores++; if (mine.some(ad => ad.slot === 'eye')) withEye++; }
        if (fit.kind === 'kiosk') { kiosks++; if (mine.length) kioskAds++; }
        if (fit.kind === 'food') { food++; if (checkMenu(L, s, ads)) withMenu++; }
      }
    }
    expect(eyes).toBeGreaterThan(20);
    expect(withEye / stores).toBeGreaterThan(0.7);
    expect(kiosks).toBeGreaterThan(0);
    expect(kioskAds).toBe(kiosks);
    if (food) expect(withMenu / food).toBeGreaterThan(0.6); // (the synthetic rings may draw no food unit: the real mall below has them)
  });

  it('R5: every gallery kiosk cart carries ONE double-faced header sign standing on its canopy top, centred, along its long side', () => {
    let carts = 0;
    for (const seed of SEEDS) {
      const L = get(seed), ads = mallAds(L);
      for (const p of L.props.filter(q => q.kind === 'mallKioskCart')) {
        carts++;
        const mine = ads.filter(ad => ad.kind === 'cart' && cartOf(L, ad) === p);
        expect(mine.length, `seed ${seed} cart at ${p.x},${p.z}`).toBe(1);
        const ad = mine[0];
        expect(ad.slot).toBe('cart');
        expect(ad.shop).toBeUndefined();
        expect(MALL_PROGRAMS.kiosk.brands).toContain(ad.brand);
        // the sign box (face + border) stands ON the canopy's flat top: no float, no sink
        const top = p.y + (p.lift ?? 0) + CART_AD.top * (p.h / CART_AD.modelH);
        expect(ad.y - ad.h / 2 - CART_AD.border).toBeCloseTo(top, 2);
        expect(top).toBeLessThan(p.y + p.h); // under the finials' tips (the cart's box top)
        // centred and inside the flat top both ways (the cart is half-turned at runtime): +-w/2 + border within 0.6 m of the centre
        expect(ad.w / 2 + CART_AD.border).toBeLessThanOrEqual(0.6);
        const long = Math.max(p.hx, p.hz);
        expect(long).toBeGreaterThan(ad.w / 2 + 0.5);
        // faces look across the long side (the long axis runs along the sign)
        expect(ad.nz !== 0).toBe(p.hx >= p.hz);
        expect(ad.glow).toBeDefined();
      }
    }
    expect(carts).toBeGreaterThan(0);
  });

  it('R5: static backlight — lit kinds carry glow (a share dead / dim, most lit), paper / vinyl none; adGlow deterministic', () => {
    const glows: number[] = [];
    for (const seed of SEEDS) for (const ad of mallAds(get(seed))) {
      if (ad.kind === 'lightbox' || ad.kind === 'menu' || ad.kind === 'cart') { expect(ad.glow).toBeDefined(); glows.push(ad.glow!); } else expect(ad.glow).toBeUndefined();
    }
    for (const g of glows) expect(g === 0 || (g >= 0.3 && g <= 0.5) || (g >= 0.85 && g <= 1)).toBe(true);
    // the shares on a large deterministic sample (the per-mall sample is small)
    const big = Array.from({length: 4000}, (_, i) => adGlow(i * 7919 + 13));
    const dead = big.filter(g => g === 0).length / big.length, lit = big.filter(g => g >= 0.85).length / big.length;
    expect(dead).toBeGreaterThan(GLOW_DEAD - 0.04);
    expect(dead).toBeLessThan(GLOW_DEAD + 0.04);
    expect(lit).toBeGreaterThan(0.6);
    expect(adGlow(12345)).toBe(adGlow(12345));
    expect(glows.filter(g => g > 0).length / glows.length).toBeGreaterThan(0.6);
  });

  it('deterministic, pure records (never props), a re-run replaces the list', () => {
    const a = mallAds(get(1));
    expect(mallAds(dressed(1))).toEqual(a);
    const L = dressed(2);
    const n = L.props.length, before = mallAds(L);
    const rep = placeMallAds(L, new Rng(77));
    expect(L.props.length).toBe(n); // records are not PropPlacements
    expect(rep.ads).toBe(mallAds(L).length);
    expect(mallAds(L)).not.toBe(before);
    expect(Object.values(rep.byKind).reduce((s, v) => s + (v ?? 0), 0)).toBe(rep.ads);
    expect(Object.values(rep.bySlot).reduce((s, v) => s + (v ?? 0), 0)).toBe(rep.ads); // (R5) every record has a slot
  });
});
