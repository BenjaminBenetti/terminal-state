// TEMPORARY (sub-lane SHOPS-ADS, R5): CPU contact sheet of the new ad art (rasterizing canvas shim -> PNG). Delete before finishing.
import {it} from 'vitest';
import sharp from 'sharp';
import {installCanvasShim, type ShimCanvas} from './helpers/canvas2d';
import {adTexture, type MallAd} from '../src/world/mallAds';

installCanvasShim(true);
const OUT = process.env.LL_ADS_OUT ?? '/tmp/shops-ads/ads-art.png';

it('ad art preview', async () => {
  const base = {level: 1, x: 0, y: 0, z: 0, nx: 0, nz: 1} as const;
  const items: [MallAd, string][] = [
    [{...base, kind: 'poster', slot: 'eye', program: 'womenswear', w: 0.75, h: 1.1, seed: 101}, 'Rosalind & Grey'],
    [{...base, kind: 'lightbox', slot: 'gallery', program: 'womenswear', w: 1.1, h: 1.7, seed: 202, glow: 1}, 'Rosalind & Grey'],
    [{...base, kind: 'poster', slot: 'eye', program: 'clothing', w: 0.7, h: 1.0, seed: 303}, 'Northline Outfitters'],
    [{...base, kind: 'poster', slot: 'eye', program: 'kiosk', w: 0.7, h: 1.0, seed: 404}, 'Sweet Spot Candy'],
    [{...base, kind: 'poster', slot: 'eye', program: 'pharmacy', w: 0.7, h: 1.0, seed: 505}, 'Corner Care Pharmacy'],
    [{...base, kind: 'decal', slot: 'window', program: 'womenswear', w: 0.9, h: 1.25, seed: 606}, 'Rosalind & Grey'],
    [{...base, kind: 'menu', slot: 'menu', program: 'food-court', w: 2.6, h: 0.7, seed: 707, cuisine: 'burger', glow: 1}, 'Stackhouse Burgers'],
    [{...base, kind: 'menu', slot: 'menu', program: 'cafe', w: 2.0, h: 0.7, seed: 808, cuisine: 'coffee', glow: 1}, 'Daily Grind'],
    [{...base, kind: 'cart', slot: 'cart', program: 'kiosk', w: 1.1, h: 0.42, seed: 909, brand: 'Phone Case Corner', glow: 1}, 'Phone Case Corner'],
    [{...base, kind: 'poster', slot: 'header', program: 'electronics', w: 2.2, h: 1.0, seed: 111}, 'Voltline'],
  ];
  const texs = items.map(([ad, brand]) => adTexture(ad, brand).image as unknown as ShimCanvas);
  const pad = 16, W = 1500;
  // simple shelf packing
  let x = pad, y = pad, rowH = 0;
  const at: [number, number][] = [];
  for (const t of texs) {
    if (x + t.width + pad > W) { x = pad; y += rowH + pad; rowH = 0; }
    at.push([x, y]); x += t.width + pad; rowH = Math.max(rowH, t.height);
  }
  const H = y + rowH + pad;
  const sheet = document.createElement('canvas') as unknown as ShimCanvas;
  sheet.width = W; sheet.height = H;
  const ctx = sheet.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#202326'; ctx.fillRect(0, 0, W, H);
  texs.forEach((t, i) => ctx.drawImage(t as unknown as CanvasImageSource, at[i][0], at[i][1]));
  await sharp(Buffer.from(sheet.data.buffer), {raw: {width: W, height: H, channels: 4}}).png().toFile(OUT);
}, 120000);
