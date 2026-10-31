// Task mall-playtest-revision-20261031 (lane SHOPS, D06 — user: "there was no uh billboards or anything like certainly the stores would
// have like pictures of people wearing the clothes ... some ads and some billboards"): the shops' ad / fashion-merchandising PLACEMENT
// records (gen/mall/ads.ts -> layout.mall.ads, rendered by lane ARCH). Layout-agnostic: the dressed synthetic shop rings
// (tests/helpers/mallShopsFixture.ts), a few seeds, cached.
import {describe, expect, it} from 'vitest';
import {Rng} from '../src/core/rng';
import {CELL} from '../src/gen/grid';
import {wallBacked} from '../src/gen/doorways';
import {areaBase} from '../src/gen/placeKit';
import type {StationLayout} from '../src/gen/stationTypes';
import {assignMallPrograms, shopFit} from '../src/gen/mall/shops';
import {dressMallShops} from '../src/gen/mall/shopsDress';
import {FASHION, adBox, mallAds, placeMallAds, propBox, type MallAd} from '../src/gen/mall/ads';
import {mallShopsFixture} from './helpers/mallShopsFixture';

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

describe('D06 shop ad / merchandising placement records', () => {
  it('every record belongs to a real shop, faces its room / the walkway, sits inside its wall span at absolute heights', () => {
    for (const seed of SEEDS) {
      const L = get(seed), ads = mallAds(L);
      expect(ads.length, `seed ${seed}`).toBeGreaterThan(10);
      for (const ad of ads) {
        expect(['poster', 'lightbox', 'decal']).toContain(ad.kind);
        expect(Math.abs(ad.nx) + Math.abs(ad.nz)).toBe(1); // unit axis-aligned
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
          const gl = L.props.find(p => p.kind === 'shopGlazing' && p.area === a.id && Math.abs(p.x - ad.x) < 1e-3 && Math.abs(p.z - ad.z) < 1e-3);
          expect(gl, `seed ${seed} ${ad.shop} decal on glazing`).toBeDefined();
          expect(ad.w).toBeLessThanOrEqual(2 * Math.max(gl!.hx, gl!.hz) + 1e-6);
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          expect(ad.nx * (ad.x - cx) + ad.nz * (ad.z - cz), 'faces away from the unit centre').toBeGreaterThan(0);
        } else {
          // wall-backed over its width at its bottom and at 1.0 m (never over a door / opening), on a wall of its area, facing in
          const side = ad.nz === 1 ? 'N' : ad.nz === -1 ? 'S' : ad.nx === 1 ? 'W' : 'E';
          const line = side === 'N' ? z0 : side === 'S' ? z1 : side === 'W' ? x0 : x1;
          const off = ad.kind === 'lightbox' ? 0.06 : 0.015;
          expect(Math.abs((ad.nz !== 0 ? ad.z : ad.x) - (line + (ad.nz || ad.nx) * off))).toBeLessThan(1e-3);
          const g = L.levels![a.level ?? 0].grid;
          expect(wallBacked(g, a, side, along - ad.w / 2, along + ad.w / 2, ad.y - ad.h / 2), `seed ${seed} ${ad.shop} ${ad.kind} backed`).toBe(true);
          expect(wallBacked(g, a, side, along - ad.w / 2, along + ad.w / 2, base + 1.0)).toBe(true);
          expect(ad.y - ad.h / 2).toBeGreaterThanOrEqual(base + (ad.kind === 'poster' ? 1.6 : 0.6) - 1e-6);
        }
      }
    }
  });

  it('records overlap no prop (mounted ones too), no other record, no wall sign; decals never sit over an entry span', () => {
    for (const seed of SEEDS) {
      const L = get(seed), ads = mallAds(L);
      const boxes = ads.map(ad => adBox(ad));
      for (const [i, ad] of ads.entries()) {
        for (const p of L.props) {
          if ((p.level ?? 0) !== ad.level) continue;
          if (ad.kind === 'decal' && (p.kind === 'shopGlazing' || p.kind === 'shopShutter')) continue; // it lies on its glass
          expect(ov(boxes[i], propBox(p)), `seed ${seed} ${ad.shop} ${ad.kind} vs ${p.kind}`).toBe(false);
        }
        for (const [j, q] of ads.entries()) if (j !== i && q.level === ad.level) expect(ov(boxes[i], boxes[j]), `seed ${seed} ${ad.shop} ${ad.kind} vs ${q.kind}`).toBe(false);
        for (const s of L.signs) if ((s.level ?? 0) === ad.level && !s.hang) {
          const sw = (s.w ?? 1.4) / 2;
          expect(ov(boxes[i], {x0: s.x - sw, x1: s.x + sw, z0: s.z - sw, z1: s.z + sw, y0: s.y - 0.35, y1: s.y + 0.35})).toBe(false);
        }
        if (ad.kind === 'decal') {
          // not over the walk-in opening: the decal's span lies on its glazing prop only (the entry span has no glazing)
          const shop = L.mall!.shops.find(s => s.id === ad.shop)!;
          const along = ad.nz !== 0 ? ad.x : ad.z, f = shop.frontage, fs = ad.nz !== 0 ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1);
          const e = shopFit(shop)!.entry;
          const e0 = fs + e[0], e1 = fs + e[1];
          expect(along + ad.w / 2 <= e0 + 1e-6 || along - ad.w / 2 >= e1 - 1e-6, `seed ${seed} ${ad.shop} decal clear of the entry`).toBe(true);
        }
      }
    }
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
        if (fit.kind === 'service' || fit.kind === 'kiosk') { expect(mine.length, `${s.id} ${fit.kind}`).toBe(0); continue; }
        if (fit.kind === 'store' || fit.kind === 'anchor' || fit.kind === 'food') { stores++; if (mine.length) withAd++; }
        if (FASHION.has(fit.program) && fit.front === 'glazed' && fit.kind !== 'vacant') {
          fashion++;
          if (mine.some(ad => ad.kind === 'decal')) fashionDecal++;
          if (mine.some(ad => ad.kind === 'lightbox')) fashionLight++;
        }
      }
    }
    expect([...seen].sort()).toEqual(['decal', 'lightbox', 'poster']);
    expect(withAd / stores).toBeGreaterThan(0.75);
    expect(fashion).toBeGreaterThan(3);
    expect(fashionDecal / fashion).toBeGreaterThan(0.8);
    expect(fashionLight / fashion).toBeGreaterThan(0.6);
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
  });
});
