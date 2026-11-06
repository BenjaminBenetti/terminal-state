// Skyways lane ASSET-C: tiny CPU orthographic renderer for the mascot pose QA sheets (no browser / GPU). Base colour (nearest texel),
// FLAT face shading on purpose (tears, folds and stretched triangles stay visible), optional per-vertex tint overlay, coordinate grid.
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

/** camera orbiting +Y: yaw 0 = camera on +Z looking at -Z (sees the FRONT of a +Z-facing model); yaw 90 = camera on +X. */
export function view(yawDeg, pitchDeg = 0) {
  const a = yawDeg * Math.PI / 180, b = pitchDeg * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  return (x, y, z) => { const u = ca * x - sa * z, d0 = sa * x + ca * z; return [u, cb * y - sb * d0, sb * y + cb * d0]; };
}

export function windowFor(P, f, pad = 1.1) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < P.length / 3; i++) { const [u, v] = f(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return {cu: (u0 + u1) / 2, cv: (v0 + v1) / 2, span: Math.max(u1 - u0, v1 - v0) * pad};
}

/** @returns raw RGB Buffer S x S */
export function render({P, UV, I, tex, tint = null, tintMix = 0, N = null}, f, S, win) {
  // N: per-vertex normals -> SMOOTH shading from the interpolated (view-space) vertex normal instead of the flat face normal
  const NV = N ? new Float32Array(N.length) : null;
  if (N) for (let i = 0; i < N.length / 3; i++) { const o = f(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); NV[i * 3] = o[0]; NV[i * 3 + 1] = o[1]; NV[i * 3 + 2] = o[2]; }
  const img = Buffer.alloc(S * S * 3, 52), zb = new Float32Array(S * S).fill(-Infinity);
  const n = P.length / 3, X = new Float32Array(n * 3), Wv = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = f(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    Wv[i * 3] = w[0]; Wv[i * 3 + 1] = w[1]; Wv[i * 3 + 2] = w[2];
    X[i * 3] = ((w[0] - win.cu) / win.span + 0.5) * S; X[i * 3 + 1] = (0.5 - (w[1] - win.cv) / win.span) * S; X[i * 3 + 2] = w[2];
  }
  const L = [0.35, 0.6, 0.72], Ln = Math.hypot(...L);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const e1 = [Wv[b * 3] - Wv[a * 3], Wv[b * 3 + 1] - Wv[a * 3 + 1], Wv[b * 3 + 2] - Wv[a * 3 + 2]];
    const e2 = [Wv[c * 3] - Wv[a * 3], Wv[c * 3 + 1] - Wv[a * 3 + 1], Wv[c * 3 + 2] - Wv[a * 3 + 2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const shade = 0.35 + 0.65 * Math.abs((nx * L[0] + ny * L[1] + nz * L[2]) / Ln);
    const x0 = X[a * 3], y0 = X[a * 3 + 1], x1 = X[b * 3], y1 = X[b * 3 + 1], x2 = X[c * 3], y2 = X[c * 3 + 1];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5, y = py + 0.5;
      const b0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area, b1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area, b2 = 1 - b0 - b1;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;
      const z = b0 * X[a * 3 + 2] + b1 * X[b * 3 + 2] + b2 * X[c * 3 + 2], k = py * S + px;
      if (z <= zb[k]) continue;
      zb[k] = z;
      let r = 200, g = 200, bl = 200;
      if (tex && UV) {
        const uu = b0 * UV[a * 2] + b1 * UV[b * 2] + b2 * UV[c * 2], vv = b0 * UV[a * 2 + 1] + b1 * UV[b * 2 + 1] + b2 * UV[c * 2 + 1];
        const tx = Math.min(tex.w - 1, Math.max(0, Math.floor((uu - Math.floor(uu)) * tex.w))), ty = Math.min(tex.h - 1, Math.max(0, Math.floor((vv - Math.floor(vv)) * tex.h)));
        const o = (ty * tex.w + tx) * 3; r = tex.data[o]; g = tex.data[o + 1]; bl = tex.data[o + 2];
      }
      let sh = shade;
      if (NV) {
        const nx2 = b0 * NV[a * 3] + b1 * NV[b * 3] + b2 * NV[c * 3], ny2 = b0 * NV[a * 3 + 1] + b1 * NV[b * 3 + 1] + b2 * NV[c * 3 + 1], nz2 = b0 * NV[a * 3 + 2] + b1 * NV[b * 3 + 2] + b2 * NV[c * 3 + 2];
        const l = Math.hypot(nx2, ny2, nz2) || 1, d = (nx2 * L[0] + ny2 * L[1] + nz2 * L[2]) / (l * Ln);
        sh = nz2 < 0 ? 0.25 : 0.3 + 0.7 * Math.max(0, d); // normals facing away from the camera show dark
      }
      if (tint && tintMix > 0) {
        const m = tintMix;
        r = r * (1 - m) + 255 * m * (b0 * tint[a * 3] + b1 * tint[b * 3] + b2 * tint[c * 3]);
        g = g * (1 - m) + 255 * m * (b0 * tint[a * 3 + 1] + b1 * tint[b * 3 + 1] + b2 * tint[c * 3 + 1]);
        bl = bl * (1 - m) + 255 * m * (b0 * tint[a * 3 + 2] + b1 * tint[b * 3 + 2] + b2 * tint[c * 3 + 2]);
      }
      img[k * 3] = Math.min(255, r * sh); img[k * 3 + 1] = Math.min(255, g * sh); img[k * 3 + 2] = Math.min(255, bl * sh);
    }
  }
  return img;
}

/** grid lines every `step` metres in view (u, v) + a ground line at v = 0 */
export function grid(img, S, win, step = 0.1) {
  const px = u => Math.round(((u - win.cu) / win.span + 0.5) * S), py = v => Math.round((0.5 - (v - win.cv) / win.span) * S);
  for (let k = Math.ceil((win.cu - win.span / 2) / step); k * step <= win.cu + win.span / 2; k++) { const x = px(k * step); if (x >= 0 && x < S) for (let y = 0; y < S; y += 3) img.set([110, 70, 70], (y * S + x) * 3); }
  for (let k = Math.ceil((win.cv - win.span / 2) / step); k * step <= win.cv + win.span / 2; k++) { const y = py(k * step); if (y >= 0 && y < S) for (let x = 0; x < S; x += k === 0 ? 1 : 3) img.set(k === 0 ? [90, 200, 90] : [70, 110, 70], (y * S + x) * 3); }
  return img;
}

export async function sheet(out, tiles, cols, S, labels = []) {
  const comps = [];
  for (let i = 0; i < tiles.length; i++) {
    let buf = await sharp(tiles[i], {raw: {width: S, height: S, channels: 3}}).png().toBuffer();
    if (labels[i]) {
      const esc = labels[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      buf = await sharp(buf).composite([{input: Buffer.from(`<svg width="${S}" height="26"><text x="6" y="19" font-family="sans-serif" font-size="17" fill="#ffff66">${esc}</text></svg>`), left: 0, top: 0}]).png().toBuffer();
    }
    comps.push({input: buf, left: (i % cols) * S, top: Math.floor(i / cols) * S});
  }
  await sharp({create: {width: cols * S, height: Math.ceil(tiles.length / cols) * S, channels: 3, background: '#202020'}}).composite(comps).png().toFile(out);
}
