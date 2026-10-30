// Task office-overhaul-20261030 (lane TENANTS): canvas plates for company-styled signs (SignPlacement.style): the reception logo
// wall's name / tagline, door plates and wayfinding of a tenant floor, the lobby's tenant directory. Local canvas graphics only
// (no generated images): the company's accent ground, its sign colour lettering in its typeface, a trim band, light wear.
// world/builder.ts signTexture calls this for styled signs (cached there per text / size / style).

import * as THREE from 'three';
import {canvasTexture} from './canvasTextures';
import type {SignPlacement, SignStyle} from '../gen/stationTypes';

const FONTS: Record<NonNullable<SignStyle['font']>, string> = {
  sans: '"Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", Consolas, monospace',
  rounded: '"Trebuchet MS", "Verdana", sans-serif',
  condensed: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif',
};
const css = (v: number) => `#${(v >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;

/** The plate texture of a styled sign (w x h m plate). */
export function companySignTexture(s: SignPlacement, w: number, h: number): THREE.Texture {
  const st = s.style!;
  const W = 1024, H = Math.max(160, Math.round(1024 * h / w));
  let seed = 0;
  for (let i = 0; i < s.text.length; i++) seed = (seed * 31 + s.text.charCodeAt(i)) >>> 0;
  return canvasTexture(W, H, seed ^ st.bg, (ctx, cw, ch, rnd) => {
    ctx.fillStyle = css(st.bg);
    ctx.fillRect(0, 0, cw, ch);
    if (st.accent !== undefined) {
      ctx.fillStyle = css(st.accent);
      ctx.fillRect(0, ch - ch * 0.1, cw, ch * 0.05);
    }
    const family = FONTS[st.font ?? 'sans'];
    const arrowW = s.arrow ? ch * 0.6 : 0;
    const upper = st.font !== 'serif' && st.font !== 'rounded';
    const text = upper ? s.text.toUpperCase() : s.text;
    let size = Math.round(ch * (s.kind === 'station' ? 0.56 : 0.5));
    const font = () => `${st.font === 'serif' ? '' : 'bold '}${size}px ${family}`;
    ctx.font = font();
    while (ctx.measureText(text).width > cw - 80 - arrowW && size > 22) { size -= 3; ctx.font = font(); }
    ctx.fillStyle = css(st.fg);
    ctx.textBaseline = 'middle';
    // Logos (station-size plates) are centred; plates read left-aligned like the station's wayfinding.
    if (s.kind === 'station') { ctx.textAlign = 'center'; ctx.fillText(text, cw / 2 - arrowW / 2, ch / 2 - ch * 0.04); ctx.textAlign = 'left'; }
    else ctx.fillText(text, 36, ch / 2 - ch * 0.04);
    if (s.arrow) {
      const ax = cw - 30 - arrowW / 2, ay = ch / 2 - ch * 0.04, r = arrowW * 0.42;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate({right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2}[s.arrow]);
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.2, -r); ctx.lineTo(-r * 0.2, -r * 0.4); ctx.lineTo(-r, -r * 0.4); ctx.lineTo(-r, r * 0.4); ctx.lineTo(-r * 0.2, r * 0.4); ctx.lineTo(-r * 0.2, r); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Decades of dust: faint grime speckle and a darker lower edge.
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(40,32,20,${(0.05 + rnd() * 0.08).toFixed(3)})`; ctx.fillRect(rnd() * cw, rnd() * ch, 2 + rnd() * 6, 2 + rnd() * 4); }
    const g = ctx.createLinearGradient(0, ch * 0.6, 0, ch);
    g.addColorStop(0, 'rgba(30,24,16,0)');
    g.addColorStop(1, 'rgba(30,24,16,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, ch * 0.6, cw, ch * 0.4);
  });
}

/** Cache key part of a sign's style (builder signTexture). */
export const signStyleKey = (s: SignPlacement): string => (s.style ? `|${s.style.bg}:${s.style.fg}:${s.style.accent ?? ''}:${s.style.font ?? ''}` : '');
