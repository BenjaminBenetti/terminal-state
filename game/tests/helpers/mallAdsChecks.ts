// Task mall-round3-20261031 (lane SHOPS, R5): shared ad-record checks — used by tests/mall-ads.test.ts (synthetic shop rings) and by
// the REAL generated-mall ad case in tests/mall-shops.test.ts (moved there to reuse its memoized seed-4242 mall: CI time, PR #25).
import {expect} from 'vitest';
import {areaBase} from '../../src/gen/placeKit';
import type {StationLayout} from '../../src/gen/stationTypes';
import {shopFit} from '../../src/gen/mall/shops';
import {MENU_BOARD, propBox, type MallAd} from '../../src/gen/mall/ads';

/** (R5) A food unit's menu board (if any): high on a wall above the kitchen line, backlit, its cuisine; true when present. */
export function checkMenu(L: StationLayout, s: NonNullable<StationLayout['mall']>['shops'][number], ads: readonly MallAd[]): boolean {
  const fit = shopFit(s)!, menu = ads.find(ad => ad.shop === s.id && ad.kind === 'menu');
  if (!menu) return false;
  const base = areaBase(L, L.areas[s.area]);
  expect(menu.slot).toBe('menu');
  expect(menu.y - menu.h / 2).toBeGreaterThanOrEqual(base + MENU_BOARD.bottom - 1e-6);
  expect(menu.w).toBeGreaterThanOrEqual(MENU_BOARD.w[0] - 1e-6);
  expect(menu.glow).toBeDefined();
  expect(menu.cuisine).toBe(fit.cuisine);
  // clears every prop standing within 0.4 m of that wall span by MENU_BOARD.over
  const wallX = menu.nz !== 0, along = wallX ? menu.x : menu.z, line = (wallX ? menu.z : menu.x) - (menu.nz || menu.nx) * MENU_BOARD.depth / 2;
  for (const p of L.props) {
    if ((p.level ?? 0) !== menu.level || p.kind === 'shopGlazing' || p.kind === 'shopShutter') continue;
    const b = propBox(p), a0 = wallX ? b.x0 : b.z0, a1 = wallX ? b.x1 : b.z1;
    if (a1 <= along - menu.w / 2 || a0 >= along + menu.w / 2) continue;
    const n = menu.nz || menu.nx, near = n > 0 ? (wallX ? b.z0 : b.x0) - line : line - (wallX ? b.z1 : b.x1);
    if (near > 0.4 || near < -0.05) continue;
    expect(menu.y - menu.h / 2, `${s.id} menu over ${p.kind}`).toBeGreaterThanOrEqual(b.y1 + MENU_BOARD.over - 1e-3);
  }
  return true;
}
