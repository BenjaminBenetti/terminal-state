// Task track1-siren-blightbelly-20261031 (lane RIGS): CPU evidence renders for the appearance-locked Siren rig path.
// Deterministic orthographic rasteriser of the zombie pipeline (zombie/lib/raster.mjs: z-buffer, two-sided Lambert, bilinear
// base-colour sampling, no back-face culling — like the source materials, which are double-sided). No browser / GPU.
// Panels are composed into one PNG sheet with SVG captions. Texture decoding here is for DISPLAY only; the builder never
// decodes / re-encodes the runtime textures (their bytes are copied verbatim).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Canvas} from '../../zombie/lib/raster.mjs';

/** RGB raw texture for display (optionally reduced; display only). */
export async function decodeTexture(bytes, maxSize = 2048) {
  const {data, info} = await sharp(Buffer.from(bytes)).removeAlpha().resize({width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true})
    .raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height, channels: 3};
}

/** Bind-pose mesh of a runtime zombie body GLB (A-pose in model metres; node "ZombieBody"). */
export async function loadZombieBind(file, scale = 1) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const node = doc.getRoot().listNodes().find(n => n.getName() === 'ZombieBody');
  const prim = node.getMesh().listPrimitives()[0];
  const pa = prim.getAttribute('POSITION');
  if (pa.getComponentType() !== 5126) throw new Error('zombie POSITION is quantised (unsupported here)');
  const pos = Float32Array.from(pa.getArray(), v => v * scale);
  const tex = await decodeTexture(prim.getMaterial().getBaseColorTexture().getImage(), 1024);
  return {pos, idx: prim.getIndices().getArray(), uv: prim.getAttribute('TEXCOORD_0').getArray(), tex};
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * panels: [{title, lines?: [text], meshes: [{pos, idx, uv?, tex?, color?, nrm?}], cam: {yawDeg, cx, cy, cz?, height}, floorY?}]
 * Each panel is w x h px; world `cam.height` metres span the panel height. A floor line is drawn at floorY when given and a
 * 0.5 m tick ruler on the left edge.
 */
export async function renderPanels(panels, out, {w = 560, h = 760, cols = panels.length, title = ''} = {}) {
  const rows = Math.ceil(panels.length / cols), TITLE = title ? 34 : 0, CAP = 64;
  const W = cols * w, H = TITLE + rows * (h + CAP);
  const sheet = Buffer.alloc(W * H * 3, 24);
  const svg = [];
  const text = (x, y, s, size = 13, fill = '#e8e8e8', weight = 'normal', anchor = 'start') => svg.push(`<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`);
  if (title) text(10, 23, title, 16, '#ffffff', 'bold');
  panels.forEach((p, i) => {
    const c = new Canvas(w, h, [38, 38, 44]);
    for (const m of p.meshes) c.draw(m, p.cam);
    const k = h / p.cam.height;
    const px0 = (i % cols) * w, py0 = TITLE + Math.floor(i / cols) * (h + CAP);
    for (let y = 0; y < h; y++) Buffer.from(c.rgb.buffer, c.rgb.byteOffset + y * w * 3, w * 3).copy(sheet, ((py0 + y) * W + px0) * 3);
    const yPx = wy => py0 + h / 2 - (wy - p.cam.cy) * k;
    if (p.floorY != null) svg.push(`<line x1="${px0}" y1="${yPx(p.floorY).toFixed(1)}" x2="${px0 + w}" y2="${yPx(p.floorY).toFixed(1)}" stroke="#e0e0e0" stroke-width="1.5"/>`);
    if (p.ruler !== false) {
      const y0 = p.floorY ?? 0;
      for (let g = 0; g * 0.5 <= p.cam.height; g++) {
        const y = yPx(y0 + g * 0.5); if (y < py0 || y > py0 + h) continue;
        svg.push(`<line x1="${px0}" y1="${y.toFixed(1)}" x2="${px0 + 12}" y2="${y.toFixed(1)}" stroke="#ffffff" stroke-width="2"/>`);
        text(px0 + 15, (y + 4).toFixed(1), `${(g * 0.5).toFixed(1)} m`, 11, '#ffffff');
      }
    }
    for (const g of p.guides ?? []) svg.push(`<line x1="${px0}" y1="${yPx(g.y).toFixed(1)}" x2="${px0 + w}" y2="${yPx(g.y).toFixed(1)}" stroke="${g.color ?? 'rgba(120,230,200,0.6)'}" stroke-width="1" stroke-dasharray="6 5"/>`);
    text(px0 + 8, py0 + h + 18, p.title, 13, '#ffffff', 'bold');
    (p.lines ?? []).forEach((l, j) => text(px0 + 8, py0 + h + 34 + j * 14, l, 11, '#cccccc'));
    if (i % cols) svg.push(`<line x1="${px0}" y1="${py0}" x2="${px0}" y2="${py0 + h + CAP}" stroke="#555" stroke-width="1"/>`);
  });
  fs.mkdirSync(path.dirname(out), {recursive: true});
  await sharp(sheet, {raw: {width: W, height: H, channels: 3}}).composite([{input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('')}</svg>`), top: 0, left: 0}]).png().toFile(out);
  return {file: out, width: W, height: H};
}

/** Small octahedron markers (e.g. joints) as one drawable mesh; zBias pulls them in front of the surface they sit in. */
export function markers(points, size = 0.018, color = [255, 60, 60], zBias = 0.5) {
  const pos = [], idx = [];
  for (const p of points) {
    const b = pos.length / 3;
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) pos.push(p[0] + d[0] * size, p[1] + d[1] * size, p[2] + d[2] * size);
    for (const [a, c, e] of [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]) idx.push(b + a, b + c, b + e);
  }
  return {pos: Float32Array.from(pos), idx: Uint32Array.from(idx), color, zBias};
}

/** Thin boxes along bone segments (parent -> child) for skeleton overlays. */
export function boneLines(segments, w = 0.006, color = [80, 230, 255], zBias = 0.5) {
  const pos = [], idx = [];
  for (const [a, b] of segments) {
    const base = pos.length / 3;
    for (const o of [[w, 0, 0], [-w, 0, 0], [0, w, 0], [0, -w, 0], [0, 0, w], [0, 0, -w]]) { pos.push(a[0] + o[0], a[1] + o[1], a[2] + o[2]); }
    for (const o of [[w, 0, 0], [-w, 0, 0], [0, w, 0], [0, -w, 0], [0, 0, w], [0, 0, -w]]) { pos.push(b[0] + o[0], b[1] + o[1], b[2] + o[2]); }
    for (let k = 0; k < 6; k += 2) { const i = base + k, j = base + k + 1; idx.push(i, j, i + 6, j, j + 6, i + 6); }
  }
  return {pos: Float32Array.from(pos), idx: Uint32Array.from(idx), color, zBias};
}
