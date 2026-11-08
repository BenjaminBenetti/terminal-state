// Task studio-skywalk-encounters-20261108-074144-01 (lane STORES): the fascia lettering of the Skywalk's MALL STORE FAMILIES
// (gen/skyways/skywaysMallStores.ts, layout version >= 5) — their slot in the storefronts' ONE lettering atlas (world/storefrontBuilder.ts
// fasciaAtlas: no texture / draw call added) drawn in the Mall's own brand style (world/mallArch.ts BRAND_STYLE: the programme's plate
// colour, accent rule, pictogram and typeface, as the Mall's brandSignTexture draws its shop signs), dimmed by the storefront's sign state
// (lit / dim / dead: burnt-out letters). Dynamic per-seed content (the seeded fictional brand over a plate): code-drawn like every
// storefront / Mall brand sign, no image asset.

import type {MallProgram} from '../gen/mall/mallTypes';
import {BRAND_FONT, BRAND_STYLE, drawBrandIcon} from './mallArch';

/** Light factor of a sign state (the storefront atlas's own: lit 1, dim 0.55, dead 0.22). */
export const mallFasciaLight = (sign: 'lit' | 'dim' | 'dead'): number => (sign === 'lit' ? 1 : sign === 'dim' ? 0.55 : 0.22);

/** '#rrggbb' scaled by k (0..1) as an rgb() string. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.round(((n >> s) & 255) * k);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/**
 * One Mall store's fascia slot (canvas px: x, y, w, h) in the Mall brand style of `program`: the plate, the accent rule, the pictogram
 * left of the brand (as written: the Mall's signs keep the brand's own case), fitted to the slot; a dead sign burns out some letters, a
 * working one drops one letter on about a third of the signs (the Mall's rule); a little grime on top.
 */
export function drawMallFascia(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, brand: string, program: MallProgram,
  sign: 'lit' | 'dim' | 'dead', rnd: () => number): void {
  const st = BRAND_STYLE[program], k = mallFasciaLight(sign);
  ctx.fillStyle = shade(st.bg, k);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = shade(st.accent, k);
  ctx.fillRect(x, y + h - h * 0.1, w, h * 0.045);
  const icon = st.icon !== 'none', iconS = h * 0.56;
  let size = Math.round(h * 0.5);
  const font = () => `${st.font === 'serif' ? '' : 'bold '}${size}px ${BRAND_FONT[st.font]}`;
  ctx.font = font();
  const avail = w - 40 - (icon ? iconS + 20 : 0);
  while (ctx.measureText(brand).width > avail && size > 16) { size -= 2; ctx.font = font(); }
  const tw = ctx.measureText(brand).width, total = tw + (icon ? iconS + 20 : 0);
  let cx = x + Math.max(10, (w - total) / 2);
  const cy = y + h * 0.45;
  if (icon) { drawBrandIcon(ctx, st.icon, cx + iconS / 2, cy, iconS, shade(st.accent, Math.max(0.35, k))); cx += iconS + 20; }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const fg = shade(st.fg, Math.max(0.3, k)), off = 'rgba(20,20,20,0.85)';
  const drop = sign !== 'dead' && rnd() < 0.35 ? Math.floor(rnd() * brand.length) : -1;
  for (let i = 0; i < brand.length; i++) {
    const ch = brand[i];
    ctx.fillStyle = sign === 'dead' ? (rnd() < 0.35 ? off : fg) : i === drop && ch !== ' ' ? shade(st.fg, k * 0.25) : fg;
    ctx.fillText(ch, cx, cy);
    cx += ctx.measureText(ch).width;
  }
  // grime: soft dark patches and a dirty lower edge (the storefront atlas's neglect)
  for (let g = 0; g < 4; g++) {
    ctx.fillStyle = `rgba(20,16,12,${0.06 + rnd() * 0.14})`;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, 20 + rnd() * w * 0.25, 6 + rnd() * h * 0.5);
  }
  ctx.fillStyle = 'rgba(30,24,18,0.3)';
  ctx.fillRect(x, y + h - 10, w, 10);
}
