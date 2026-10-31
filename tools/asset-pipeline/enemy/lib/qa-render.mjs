// Task track1-siren-blightbelly-20261031 (lane RIGB): small CPU QA rendering helpers on top of the zombie raster
// (tools/asset-pipeline/zombie/lib/raster.mjs Canvas: orthographic, z-buffer, Lambert, bilinear texture). No GPU / browser.
// Adds: joint / point overlays, line segments, a floor line, labelled grid composition to PNG (sharp + SVG text).
import sharp from 'sharp';
import {Canvas} from '../../zombie/lib/raster.mjs';

/** Screen position of a world point for a Canvas.draw camera {yawDeg, cx, cy, cz, height}. */
export function project(canvas, cam, p) {
  const th = (cam.yawDeg || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), k = canvas.h / cam.height;
  const x = p[0] - (cam.cx || 0), y = p[1] - cam.cy, z = p[2] - (cam.cz || 0);
  return [canvas.w / 2 + (cs * x - sn * z) * k, canvas.h / 2 - y * k, sn * x + cs * z];
}

export function dot(canvas, x, y, r, rgb) {
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
    if (xx < 0 || yy < 0 || xx >= canvas.w || yy >= canvas.h || (xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
    canvas.rgb.set(rgb, (yy * canvas.w + xx) * 3);
  }
}

export function line(canvas, a, b, rgb, width = 1) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
  for (let i = 0; i <= n; i++) { const t = i / n; dot(canvas, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, width / 2, rgb); }
}

/** Horizontal world-height line (floor / reference) across the canvas. */
export function hline(canvas, cam, y, rgb) {
  const sy = Math.round(project(canvas, cam, [0, y, 0])[1]);
  if (sy < 0 || sy >= canvas.h) return;
  for (let x = 0; x < canvas.w; x++) canvas.rgb.set(rgb, (sy * canvas.w + x) * 3);
}

/** Draw a skeleton (joint world positions {name: [x,y,z]} + parent list) on top of the image (no depth test). */
export function drawSkeleton(canvas, cam, world, parents, {rgb = [80, 255, 120], jointRgb = [255, 230, 60], r = 3} = {}) {
  for (const [n, p] of parents) if (p && world[n] && world[p]) line(canvas, project(canvas, cam, world[p]), project(canvas, cam, world[n]), rgb, 2);
  for (const n of Object.keys(world)) { const s = project(canvas, cam, world[n]); dot(canvas, s[0], s[1], r, jointRgb); }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Compose canvases into a labelled grid PNG.
 * @param cells [{canvas, label}] row-major; cols per row
 */
export async function composeGrid(cells, {cols, title = '', file, bg = [30, 30, 34], labelH = 22, titleH = 30}) {
  const cw = Math.max(...cells.map(c => c.canvas.w)), ch = Math.max(...cells.map(c => c.canvas.h));
  const rows = Math.ceil(cells.length / cols);
  const W = cw * cols, Hh = titleH + rows * (ch + labelH);
  const buf = Buffer.alloc(W * Hh * 3);
  for (let i = 0; i < W * Hh; i++) { buf[i * 3] = bg[0]; buf[i * 3 + 1] = bg[1]; buf[i * 3 + 2] = bg[2]; }
  cells.forEach((c, i) => {
    const ox = (i % cols) * cw, oy = titleH + Math.floor(i / cols) * (ch + labelH) + labelH;
    for (let y = 0; y < c.canvas.h; y++) for (let x = 0; x < c.canvas.w; x++) {
      const s = (y * c.canvas.w + x) * 3, d = ((oy + y) * W + ox + x) * 3;
      buf[d] = c.canvas.rgb[s]; buf[d + 1] = c.canvas.rgb[s + 1]; buf[d + 2] = c.canvas.rgb[s + 2];
    }
  });
  const texts = [`<text x="8" y="21" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="bold" fill="#e8e8e8">${esc(title)}</text>`];
  cells.forEach((c, i) => {
    const ox = (i % cols) * cw, oy = titleH + Math.floor(i / cols) * (ch + labelH);
    texts.push(`<text x="${ox + 6}" y="${oy + 16}" font-family="DejaVu Sans, sans-serif" font-size="13" fill="#cfd8e0">${esc(c.label)}</text>`);
  });
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}">${texts.join('')}</svg>`);
  await sharp(buf, {raw: {width: W, height: Hh, channels: 3}}).composite([{input: svg, top: 0, left: 0}]).png().toFile(file);
  return {width: W, height: Hh};
}

export {Canvas};
