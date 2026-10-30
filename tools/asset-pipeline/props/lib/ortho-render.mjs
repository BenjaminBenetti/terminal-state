// Iteration 16 (lane ASSETS): tiny CPU orthographic renderer for GLB QA contact sheets (no browser / GPU).
// Renders the base-colour texture (bilinear-free nearest sample) with a simple lambert term from a few fixed views.
// Usage (CLI): node ortho-render.mjs <out.png> <tile px> <glb>...   -> one row per GLB: views FRONT(-Z) | BACK(+Z) | RIGHT(+X) | TOP
// "FRONT(-Z)" = camera on the -Z side looking toward +Z, i.e. it shows the faces that point at -Z.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

/** Loads triangles (world space, node transforms applied) + base-colour texture per primitive. */
export async function loadTris(glbPath) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  const out = [];
  const texCache = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), uv = p.getAttribute('TEXCOORD_0'), idx = p.getIndices();
      const mat = p.getMaterial(), tex = mat?.getBaseColorTexture();
      let img = null;
      if (tex) {
        if (!texCache.has(tex)) {
          const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true});
          texCache.set(tex, {data, w: info.width, h: info.height});
        }
        img = texCache.get(tex);
      }
      const bc = mat?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const n = idx ? idx.getCount() : pos.getCount();
      const v = [0, 0, 0], t = [0, 0];
      const P = [], U = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        P.push([M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]]);
        if (uv) { uv.getElement(i, t); U.push([t[0], t[1]]); }
      }
      for (let i = 0; i < n; i += 3) {
        const a = idx ? idx.getScalar(i) : i, b = idx ? idx.getScalar(i + 1) : i + 1, c = idx ? idx.getScalar(i + 2) : i + 2;
        out.push({p: [P[a], P[b], P[c]], uv: uv ? [U[a], U[b], U[c]] : null, img, bc});
      }
    }
  }
  return out;
}

// view: maps world (x,y,z) -> screen (u right, v up, depth toward camera)
const VIEWS = {
  'FRONT(-Z)': ([x, y, z]) => [-x, y, -z],   // camera at -Z looking +Z: right of screen is world -X
  'BACK(+Z)': ([x, y, z]) => [x, y, z],
  'RIGHT(+X)': ([x, y, z]) => [-z, y, x],
  TOP: ([x, y, z]) => [x, -z, y],
};

/** `viewName`: a VIEWS key, or a function world (x, y, z) -> [u right, v up, depth toward camera] (custom / 3/4 views). */
export function renderView(tris, viewName, S, bounds) {
  const f = typeof viewName === 'function' ? viewName : VIEWS[viewName];
  const img = Buffer.alloc(S * S * 3, 64), zb = new Float32Array(S * S).fill(-Infinity);
  const corners = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) corners.push(f([x, y, z]));
  const u0 = Math.min(...corners.map(c => c[0])), u1 = Math.max(...corners.map(c => c[0]));
  const v0 = Math.min(...corners.map(c => c[1])), v1 = Math.max(...corners.map(c => c[1]));
  const span = Math.max(u1 - u0, v1 - v0) * 1.08, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const toPx = q => [((q[0] - cu) / span + 0.5) * S, (0.5 - (q[1] - cv) / span) * S, q[2]];
  const L = [0.35, 0.6, 0.72]; const Ln = Math.hypot(...L); L[0] /= Ln; L[1] /= Ln; L[2] /= Ln;
  for (const t of tris) {
    const s = t.p.map(q => toPx(f(q)));
    const w = t.p.map(q => f(q));
    const e1 = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]], e2 = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const shade = 0.35 + 0.65 * Math.abs(nx * L[0] + ny * L[1] + nz * L[2]);
    const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), maxX = Math.min(S - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), maxY = Math.min(S - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5, y = py + 0.5;
      const b0 = ((s[1][0] - x) * (s[2][1] - y) - (s[2][0] - x) * (s[1][1] - y)) / area;
      const b1 = ((s[2][0] - x) * (s[0][1] - y) - (s[0][0] - x) * (s[2][1] - y)) / area;
      const b2 = 1 - b0 - b1;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;
      const z = b0 * s[0][2] + b1 * s[1][2] + b2 * s[2][2];
      const k = py * S + px;
      if (z <= zb[k]) continue;
      zb[k] = z;
      let r = 200 * t.bc[0], g = 200 * t.bc[1], bl = 200 * t.bc[2];
      if (t.img && t.uv) {
        const uu = b0 * t.uv[0][0] + b1 * t.uv[1][0] + b2 * t.uv[2][0], vv = b0 * t.uv[0][1] + b1 * t.uv[1][1] + b2 * t.uv[2][1];
        const tx = Math.min(t.img.w - 1, Math.max(0, Math.floor((uu - Math.floor(uu)) * t.img.w)));
        const ty = Math.min(t.img.h - 1, Math.max(0, Math.floor((vv - Math.floor(vv)) * t.img.h)));
        const o = (ty * t.img.w + tx) * 3;
        r = t.img.data[o] * t.bc[0]; g = t.img.data[o + 1] * t.bc[1]; bl = t.img.data[o + 2] * t.bc[2];
      }
      img[k * 3] = Math.min(255, r * shade); img[k * 3 + 1] = Math.min(255, g * shade); img[k * 3 + 2] = Math.min(255, bl * shade);
    }
  }
  return img;
}

export function boundsOf(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const q of t.p) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
  return {min, max};
}

export async function contactSheet(out, S, glbs) {
  const names = Object.keys(VIEWS);
  const comps = [];
  for (let r = 0; r < glbs.length; r++) {
    const tris = await loadTris(glbs[r]);
    const b = boundsOf(tris);
    for (let c = 0; c < names.length; c++) {
      const raw = renderView(tris, names[c], S, b);
      comps.push({input: await sharp(raw, {raw: {width: S, height: S, channels: 3}}).png().toBuffer(), left: c * S, top: r * S});
    }
  }
  await sharp({create: {width: names.length * S, height: glbs.length * S, channels: 3, background: '#202020'}}).composite(comps).png().toFile(out);
  return names;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, S, ...glbs] = process.argv.slice(2);
  const names = await contactSheet(out, +S, glbs);
  console.log(out, 'columns:', names.join(' | '), 'rows:', glbs.map(g => g.split('/').pop()).join(' | '));
  void fs;
}
