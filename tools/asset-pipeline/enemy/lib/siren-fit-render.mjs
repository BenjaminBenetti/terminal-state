// Task siren-clothing-refit-20261031 (lane FIT): labelled ANATOMICAL fit views of a written Siren GLB (CPU, no browser / GPU).
// Same deterministic orthographic rasteriser as the Track1 evidence (zombie/lib/raster.mjs: z-buffer, two-sided Lambert, bilinear
// base-colour sampling, no back-face culling — the supplied materials are double-sided). Not the game's PBR / lighting.
//
// Camera convention (verified against the body by garment-metrics.mjs bodyFacing: the body faces +Z, wearer's RIGHT = -X):
//   yaw   0  FRONT              camera on +Z looking -Z, unmirrored: wearer's RIGHT appears on screen-LEFT
//   yaw 180  BACK               camera on -Z: wearer's RIGHT on screen-RIGHT
//   yaw  90  WEARER'S LEFT side camera on +X: her front (+Z) on screen-LEFT
//   yaw 270  WEARER'S RIGHT side camera on -X: her front on screen-RIGHT
//   yaw 325  3/4 FRONT-RIGHT    camera front-right of her (sees the right breast / strap side), wearer's right toward screen-left
//   yaw  35  3/4 FRONT-LEFT     camera front-left of her
// Every panel carries corner tags naming the wearer's side / front shown at that screen edge.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {Canvas} from '../../zombie/lib/raster.mjs';
import {loadRigged, jointWorld, skinMesh} from './siren-glb.mjs';
import {decodeTexture} from './siren-render.mjs';

export const VIEWS = {
  front: {yawDeg: 0, label: 'FRONT (camera +Z, unmirrored)', left: "wearer's RIGHT", right: "wearer's LEFT"},
  back: {yawDeg: 180, label: 'BACK (camera -Z)', left: "wearer's LEFT", right: "wearer's RIGHT"},
  wearerLeft: {yawDeg: 90, label: "WEARER'S LEFT side (camera +X)", left: 'her FRONT', right: 'her BACK'},
  wearerRight: {yawDeg: 270, label: "WEARER'S RIGHT side (camera -X)", left: 'her BACK', right: 'her FRONT'},
  threeQuarterRight: {yawDeg: 325, label: '3/4 FRONT-RIGHT (camera 35 deg toward her right)', left: "wearer's RIGHT", right: "wearer's LEFT"},
  threeQuarterLeft: {yawDeg: 35, label: '3/4 FRONT-LEFT (camera 35 deg toward her left)', left: "wearer's RIGHT", right: "wearer's LEFT"},
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Loads a written Siren GLB for posing + display textures (decoded for display only). */
export async function loadForRender(glb, texSize = 1024) {
  const R = await loadRigged(glb);
  const tex = {};
  for (const m of R.meshes) { const t = m.material?.getBaseColorTexture(); tex[m.name] = t ? await decodeTexture(t.getImage(), texSize) : null; }
  return {R, tex, file: glb};
}

/** Drawable meshes of the asset posed at clip / t (clip null = bind). opts.only: mesh names; opts.color per mesh name. */
export function posed(A, clip = null, t = 0, opts = {}) {
  const W = jointWorld(A.R, clip, t);
  return A.R.meshes.filter(m => !opts.only || opts.only.includes(m.name)).map(m => {
    let idx = m.idx;
    // technical views only: drop the body's hair triangles (opts.hairMask = per body vertex 1 = hair) to show the strap / skin
    if (opts.hairMask && m.name === 'SirenBody') { const I = []; for (let t = 0; t < idx.length; t += 3) if (!opts.hairMask[idx[t]] && !opts.hairMask[idx[t + 1]] && !opts.hairMask[idx[t + 2]]) I.push(idx[t], idx[t + 1], idx[t + 2]); idx = Uint32Array.from(I); }
    return {name: m.name, pos: skinMesh(m, W), idx, uv: m.uv, tex: opts.flat?.[m.name] ? null : A.tex[m.name], color: opts.flat?.[m.name] ?? [205, 205, 210]};
  });
}

/** Pre-rotates meshes for a camera elevated by pitchDeg (looking down) at yaw; draw the result with yawDeg 0, centre 0. */
export function pitched(meshes, {yawDeg = 0, pitchDeg = 0, cx = 0, cy = 0, cz = 0}) {
  const th = yawDeg * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), a = pitchDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  return meshes.map(m => {
    const P = m.pos, o = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i] - cx, y = P[i + 1] - cy, z = P[i + 2] - cz;
      const xr = cs * x - sn * z, zr = sn * x + cs * z;
      o[i] = xr; o[i + 1] = y * ca - zr * sa; o[i + 2] = y * sa + zr * ca;
    }
    return {...m, pos: o, nrm: undefined};
  });
}

/**
 * panels: [{title, lines?, meshes, cam: {yawDeg, cx, cy, cz?, height}, floorY?, guides?: [{y, color}], tags?: {left, right}, view?: key of VIEWS}]
 * Writes a PNG sheet; returns {file, width, height}.
 */
export async function renderSheet(panels, out, {w = 512, h = 640, cols = panels.length, title = '', bg = [40, 40, 46]} = {}) {
  const rows = Math.ceil(panels.length / cols), TITLE = title ? 32 : 0, CAP = 18 + 14 * Math.max(1, ...panels.map(p => (p.lines ?? []).length));
  const W = cols * w, H = TITLE + rows * (h + CAP);
  const sheet = Buffer.alloc(W * H * 3, 22);
  const svg = [];
  const text = (x, y, s, size = 13, fill = '#e8e8e8', weight = 'normal', anchor = 'start') => svg.push(`<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`);
  if (title) text(10, 22, title, 15, '#ffffff', 'bold');
  panels.forEach((p, i) => {
    const v = p.view ? VIEWS[p.view] : null;
    const cam = {...p.cam, yawDeg: p.cam.yawDeg ?? v?.yawDeg ?? 0};
    const c = new Canvas(w, h, bg);
    for (const m of p.meshes) c.draw(m, cam);
    const k = h / cam.height;
    const px0 = (i % cols) * w, py0 = TITLE + Math.floor(i / cols) * (h + CAP);
    for (let y = 0; y < h; y++) Buffer.from(c.rgb.buffer, c.rgb.byteOffset + y * w * 3, w * 3).copy(sheet, ((py0 + y) * W + px0) * 3);
    const yPx = wy => py0 + h / 2 - (wy - cam.cy) * k;
    if (p.floorY != null) { const fy = yPx(p.floorY); if (fy > py0 && fy < py0 + h) svg.push(`<line x1="${px0}" y1="${fy.toFixed(1)}" x2="${px0 + w}" y2="${fy.toFixed(1)}" stroke="#d8d8d8" stroke-width="1.5"/>`); }
    for (const g of p.guides ?? []) { const gy = yPx(g.y); if (gy > py0 && gy < py0 + h) { svg.push(`<line x1="${px0}" y1="${gy.toFixed(1)}" x2="${px0 + w}" y2="${gy.toFixed(1)}" stroke="${g.color ?? 'rgba(120,230,200,0.6)'}" stroke-width="1" stroke-dasharray="6 5"/>`); if (g.label) text(px0 + w - 6, gy - 3, g.label, 10, g.color ?? '#9ee', 'normal', 'end'); } }
    const tags = p.tags ?? (v ? {left: v.left, right: v.right} : null);
    if (tags) {
      svg.push(`<rect x="${px0 + 4}" y="${py0 + 4}" width="${8 + 7 * tags.left.length}" height="18" fill="rgba(0,0,0,0.55)"/>`);
      text(px0 + 8, py0 + 17, '◀ ' + tags.left, 12, '#ffd479', 'bold');
      svg.push(`<rect x="${px0 + w - 12 - 7 * tags.right.length}" y="${py0 + 4}" width="${8 + 7 * tags.right.length}" height="18" fill="rgba(0,0,0,0.55)"/>`);
      text(px0 + w - 8, py0 + 17, tags.right + ' ▶', 12, '#ffd479', 'bold', 'end');
    }
    text(px0 + 8, py0 + h + 15, p.title ?? v?.label ?? '', 12, '#ffffff', 'bold');
    (p.lines ?? []).forEach((l, j) => text(px0 + 8, py0 + h + 29 + j * 14, l, 11, '#c8c8c8'));
    if (i % cols) svg.push(`<line x1="${px0}" y1="${py0}" x2="${px0}" y2="${py0 + h + CAP}" stroke="#555" stroke-width="1"/>`);
  });
  fs.mkdirSync(path.dirname(out), {recursive: true});
  const img = sharp(sheet, {raw: {width: W, height: H, channels: 3}}).composite([{input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('')}</svg>`), top: 0, left: 0}]);
  if (/\.jpe?g$/i.test(out)) await img.jpeg({quality: 88}).toFile(out); else await img.png().toFile(out);
  return {file: out, width: W, height: H};
}

/** The five standard full-body views (+ optional extra keys) of one posed asset. */
export function fullBodyPanels(meshes, {views = ['front', 'back', 'wearerLeft', 'wearerRight', 'threeQuarterRight'], cy = 0.88, height = 1.86, cx = 0, lines = [], floorY = 0} = {}) {
  return views.map(v => ({view: v, meshes, cam: {cx, cy, height}, floorY, lines}));
}
