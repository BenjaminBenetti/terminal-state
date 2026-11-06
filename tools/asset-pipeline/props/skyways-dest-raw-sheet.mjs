#!/usr/bin/env node
// Task studio-skyways-destinations-20261106-170011-01 (lane KITS): ACCEPTANCE contact sheet of the raw Meshy T2.5 destination-kit
// models — a CPU orthographic render (no browser / GPU), QA only (writes nothing into the game). Per raw, one row at the raw's own
// scale (one shared span per row so the views compare): the Codex concept | CAM +Z (front) | CAM -Z (back) | CAM +X (right side) |
// TOP (camera +Y; +Z = the front at the BOTTOM of the tile), base colour x a lambert term, a 0.1-of-span grid, plus a stats line
// (triangles, vertices, nodes / meshes / primitives / materials, maps, raw extent, position-connected parts and the largest few).
//
// Reads (never modifies) the lead's private records OUTSIDE Git: <gen>/assets.json, <gen>/LEDGER.jsonl (raw + intent lines: the raw
// file and its sha256, checked; the Codex concept input) and <gen>/raw/*.
//   node tools/asset-pipeline/props/skyways-dest-raw-sheet.mjs --out <png> [--tile 340] [--gen <dir>] <asset id> [<asset id> ...]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

const root = path.resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const GEN = path.resolve(opt('--gen', path.join(root, 'reference/tasks/skyways-destinations-20261106-170011/gen')));
const OUT = opt('--out', '/tmp/skyways-dest-raw.png');
const S = Number(opt('--tile', '340'));
const ids = args;
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r3 = v => +v.toFixed(3);

const assets = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(GEN, 'assets.json'), 'utf8')).map(a => [a.id, a]));
const ledger = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// view: world (x, y, z) -> [u right, v up, depth toward the camera]
const VIEWS = [
  ['CAM +Z (front)', ([x, y, z]) => [x, y, z]],
  ['CAM -Z (back)', ([x, y, z]) => [-x, y, -z]],
  ['CAM +X (right)', ([x, y, z]) => [-z, y, x]],
  ['TOP (+Z at bottom)', ([x, y, z]) => [x, -z, y]],
];
const L = (() => { const l = [0.35, 0.6, 0.72], n = Math.hypot(...l); return l.map(x => x / n); })();

async function load(file) {
  const doc = await io.read(file);
  const r = doc.getRoot();
  const tris = [], tex = new Map();
  const P0 = [];
  let verts = 0;
  for (const node of r.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), uv = p.getAttribute('TEXCOORD_0'), idx = p.getIndices(), mat = p.getMaterial();
      const t = mat?.getBaseColorTexture();
      if (t && !tex.has(t)) {
        const {data, info} = await sharp(Buffer.from(t.getImage())).removeAlpha().resize(1024, 1024, {fit: 'fill'}).raw().toBuffer({resolveWithObject: true});
        tex.set(t, {data, w: info.width, h: info.height});
      }
      const img = t ? tex.get(t) : null, bc = mat?.getBaseColorFactor() ?? [1, 1, 1, 1];
      const P = [], U = [], v = [0, 0, 0], w = [0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        P.push([M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]]);
        if (uv) { uv.getElement(i, w); U.push([w[0], w[1]]); }
      }
      const base = P0.length;
      P0.push(...P);
      verts += P.length;
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        const a = idx ? idx.getScalar(i) : i, b = idx ? idx.getScalar(i + 1) : i + 1, c = idx ? idx.getScalar(i + 2) : i + 2;
        tris.push({p: [P[a], P[b], P[c]], uv: uv ? [U[a], U[b], U[c]] : null, img, bc, vi: [base + a, base + b, base + c]});
      }
    }
  }
  const mat = r.listMaterials()[0];
  const maps = mat ? [['base', mat.getBaseColorTexture()], ['MR', mat.getMetallicRoughnessTexture()], ['normal', mat.getNormalTexture()],
    ['AO', mat.getOcclusionTexture()], ['emis', mat.getEmissiveTexture()]].filter(([, t]) => t).map(([k, t]) => `${k} ${t.getSize()?.join('x')}`) : [];
  const info = {nodes: r.listNodes().length, meshes: r.listMeshes().length, prims: r.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0),
    materials: r.listMaterials().length, maps, alpha: mat?.getAlphaMode(), doubleSided: mat?.getDoubleSided(), verts};
  return {tris, info, P0};
}

/** Position-connected parts (vertices welded by exact position): count + the largest few (triangles, bounds). */
function parts(tris, P0) {
  const key = new Map(), rep = new Int32Array(P0.length);
  P0.forEach((q, i) => { const k = `${q[0]},${q[1]},${q[2]}`; if (!key.has(k)) key.set(k, key.size); rep[i] = key.get(k); });
  const parent = Int32Array.from({length: key.size}, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const t of tris) { const [a, b, c] = t.vi.map(v => rep[v]); for (const [x, y] of [[a, b], [b, c]]) { const fx = find(x), fy = find(y); if (fx !== fy) parent[fx] = fy; } }
  const comps = new Map();
  for (const t of tris) {
    const c = find(rep[t.vi[0]]);
    let o = comps.get(c);
    if (!o) comps.set(c, (o = {tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}));
    o.tris++;
    for (const q of t.p) for (let k = 0; k < 3; k++) { o.min[k] = Math.min(o.min[k], q[k]); o.max[k] = Math.max(o.max[k], q[k]); }
  }
  return [...comps.values()].sort((a, b) => b.tris - a.tris);
}

function bounds(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const q of t.p) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
  return {min, max};
}

function render(tris, f, span, centre) {
  const img = Buffer.alloc(S * S * 3, 58), zb = new Float32Array(S * S).fill(-Infinity);
  const [cu, cv] = centre;
  const toPx = q => [((q[0] - cu) / span + 0.5) * S, (0.5 - (q[1] - cv) / span) * S, q[2]];
  for (let g = -10; g <= 10; g++) { // grid every 0.1 of the span (faint)
    const p = Math.round(S / 2 + g * 0.1 * S);
    if (p < 0 || p >= S) continue;
    for (let i = 0; i < S; i++) for (const o of [(i * S + p) * 3, (p * S + i) * 3]) { img[o] = 70; img[o + 1] = 72; img[o + 2] = 80; }
  }
  for (const t of tris) {
    const w = t.p.map(f), s = w.map(toPx);
    const e1 = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]], e2 = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const shade = 0.35 + 0.65 * Math.abs(nx * L[0] + ny * L[1] + nz * L[2]);
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(S - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(S - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const x = px + 0.5, y = py + 0.5;
      const b0 = ((s[1][0] - x) * (s[2][1] - y) - (s[2][0] - x) * (s[1][1] - y)) / area;
      const b1 = ((s[2][0] - x) * (s[0][1] - y) - (s[0][0] - x) * (s[2][1] - y)) / area;
      const b2 = 1 - b0 - b1;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;
      const z = b0 * s[0][2] + b1 * s[1][2] + b2 * s[2][2], k = py * S + px;
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

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = (w, h, lines, size = 13) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#181a1f"/>${lines.map((l, i) =>
  `<text x="6" y="${16 + i * (size + 4)}" font-family="sans-serif" font-size="${size}" fill="${i ? '#cfd3da' : '#ffffff'}">${esc(l)}</text>`).join('')}</svg>`);

const HEAD = 22, LABEL = 58, COLS = 1 + VIEWS.length;
const comps = [];
const report = [];
for (const [ri, id] of ids.entries()) {
  const a = assets[id];
  if (!a) throw new Error(`unknown asset ${id}`);
  const raws = ledger.filter(e => e.event === 'raw' && e.asset === id);
  if (!raws.length) throw new Error(`${id}: no raw line in the ledger`);
  const raw = raws[raws.length - 1];
  const bytes = fs.readFileSync(path.join(GEN, raw.file));
  if (sha(bytes) !== raw.sha256 || bytes.length !== raw.bytes) throw new Error(`${id}: raw sha256 / bytes mismatch (${raw.file})`);
  const intent = ledger.filter(e => e.event === 'intent' && e.asset === id && e.kind === 'meshy-image-to-3d').pop();
  const {tris, info, P0} = await load(path.join(GEN, raw.file));
  const b = bounds(tris), ext = [0, 1, 2].map(k => b.max[k] - b.min[k]);
  const span = Math.max(...ext) * 1.08;
  const ps = parts(tris, P0);
  const top = ps.slice(0, 4).map(o => `${o.tris}t ${[0, 1, 2].map(k => r3(o.max[k] - o.min[k])).join('x')}@y${r3(o.min[1])}`);
  const y = ri * (HEAD + S + LABEL);
  comps.push({input: text(COLS * S, HEAD, [`${a.n} ${id}  [${a.tier}, ${a.family}, view ${a.view}, real ${a.size.axis} = ${a.size.m} m, budget ${a.polycount} tris, ${a.physics}]  ${raw.file.split('/').pop()}`]), left: 0, top: y});
  if (intent?.input && fs.existsSync(path.join(GEN, intent.input))) {
    comps.push({input: await sharp(path.join(GEN, intent.input)).resize(S, S, {fit: 'contain', background: '#3a3a3a'}).png().toBuffer(), left: 0, top: y + HEAD});
  }
  for (const [vi, [, f]] of VIEWS.entries()) {
    const cs = []; for (const x of [b.min[0], b.max[0]]) for (const yy of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) cs.push(f([x, yy, z]));
    const centre = [(Math.min(...cs.map(c => c[0])) + Math.max(...cs.map(c => c[0]))) / 2, (Math.min(...cs.map(c => c[1])) + Math.max(...cs.map(c => c[1]))) / 2];
    const img = render(tris, f, span, centre);
    comps.push({input: await sharp(img, {raw: {width: S, height: S, channels: 3}}).png().toBuffer(), left: (vi + 1) * S, top: y + HEAD});
  }
  const line1 = `${tris.length} tris, ${info.verts} verts; ${info.nodes} node / ${info.meshes} mesh / ${info.prims} prim / ${info.materials} mat (${info.alpha}${info.doubleSided ? ', double' : ''}); maps ${info.maps.join(', ')}`;
  const line2 = `raw extent x ${r3(ext[0])} y ${r3(ext[1])} z ${r3(ext[2])} (min y ${r3(b.min[1])}); ${ps.length} parts; largest: ${top.join(' | ')}`;
  comps.push({input: text(COLS * S, LABEL, [line1, line2], 12), left: 0, top: y + HEAD + S});
  report.push({id, file: raw.file, sha256: raw.sha256, tris: tris.length, ...info, extent: ext.map(r3), minY: r3(b.min[1]), parts: ps.length, largest: top});
  console.log(`${id}: ${line1}; ${line2}`);
}
const titles = ['Codex concept', ...VIEWS.map(v => v[0])];
const hdr = Buffer.from(`<svg width="${COLS * S}" height="20"><rect width="100%" height="100%" fill="#101114"/>${titles.map((t, i) =>
  `<text x="${i * S + 6}" y="14" font-family="sans-serif" font-size="13" fill="#9fd">${esc(t)}</text>`).join('')}</svg>`);
const H = 20 + ids.length * (HEAD + S + LABEL);
await sharp({create: {width: COLS * S, height: H, channels: 3, background: '#202226'}})
  .composite([{input: hdr, left: 0, top: 0}, ...comps.map(c => ({...c, top: c.top + 20}))]).png().toFile(OUT);
fs.writeFileSync(OUT.replace(/\.png$/, '.json'), JSON.stringify(report, null, 1) + '\n');
console.log('wrote', OUT);
