// Shared CPU rendering helpers for zombie wardrobe QA (iteration 06): load runtime body / wearable
// GLBs, pose them with the body's own skeleton/clips (CPU linear-blend skinning), apply the union of
// the worn wearables' hidden-triangle masks (body + layered wearables) and rasterise with
// lib/raster.mjs. No browser/GPU.
import path from 'node:path';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {KHRMeshQuantization} from '@gltf-transform/extensions';
import {REPO} from '../lib/master.mjs';
import {Canvas} from '../lib/raster.mjs';

const io = new NodeIO().registerExtensions([KHRMeshQuantization]);
const decode = async img => { const {data, info} = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, channels: 3}; };
const arr = a => a ? a.getArray() : null;

export const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const qrot = (q, v) => { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };

export async function loadBody(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const node = root.listNodes().find(n => n.getName() === 'ZombieBody');
  const prim = node.getMesh().listPrimitives()[0];
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const mat = prim.getMaterial();
  const extras = root.listScenes()[0].getExtras().zombieBody;
  return {file, doc, extras, joints, names: joints.map(j => j.getName()), ibm: arr(skin.getInverseBindMatrices()),
    mesh: {pos: arr(prim.getAttribute('POSITION')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0')), wScale: 255},
    tex: await decode(mat.getBaseColorTexture().getImage()), anims: root.listAnimations()};
}

/** Wearable GLB (outfit-<id>.glb): one SkinnedMesh per body, shared texture. */
export async function loadWearable(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const sx = root.listScenes()[0].getExtras();
  const extras = sx.zombieWearable ?? sx.zombieOutfit;
  const variants = {};
  let tex = null;
  for (const n of root.listNodes()) {
    const m = /^Outfit_(.+)__(.+)$/.exec(n.getName()); if (!m) continue;
    const prim = n.getMesh().listPrimitives()[0];
    if (!tex) tex = await decode(prim.getMaterial().getBaseColorTexture().getImage());
    variants[m[2]] = {extras: n.getExtras(), mesh: {pos: arr(prim.getAttribute('POSITION')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0')), wScale: 255}};
  }
  return {file, extras: {slot: 'upper', ...extras}, variants, tex};
}

/** World joint transforms ({q, p}) for a clip time, from the body's own animation. */
export function poseAt(body, clipName, t) {
  const local = body.joints.map(j => ({q: j.getRotation().slice(), p: j.getTranslation().slice()}));
  const anim = clipName && body.anims.find(a => a.getName() === clipName);
  if (anim) for (const ch of anim.listChannels()) {
    const ji = body.joints.indexOf(ch.getTargetNode()); if (ji < 0) continue;
    const s = ch.getSampler(), T = s.getInput().getArray(), O = s.getOutput().getArray(), k = ch.getTargetPath() === 'rotation' ? 4 : 3;
    let i = 0; while (i < T.length - 2 && t > T[i + 1]) i++;
    const u = Math.min(1, Math.max(0, (t - T[i]) / (T[i + 1] - T[i] || 1)));
    const v = Array.from({length: k}, (_, c) => O[i * k + c] * (1 - u) + O[(i + 1) * k + c] * u);
    if (k === 4) { const l = Math.hypot(...v); local[ji].q = v.map(x => x / l); } else local[ji].p = v;
  }
  const world = [];
  body.joints.forEach((j, i) => {
    const par = j.getParentNode && j.getParentNode();
    const pi = body.joints.indexOf(par);
    if (pi < 0) world[i] = {q: local[i].q, p: local[i].p};
    else { const P = world[pi]; world[i] = {q: qmul(P.q, local[i].q), p: qrot(P.q, local[i].p).map((v, c) => v + P.p[c])}; }
  });
  return world;
}

export function skinMesh(mesh, body, world) {
  const n = mesh.pos.length / 3, out = new Float32Array(n * 3);
  const bind = body.joints.map((_, j) => [-body.ibm[j * 16 + 12], -body.ibm[j * 16 + 13], -body.ibm[j * 16 + 14]]);
  for (let i = 0; i < n; i++) {
    const v = [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weights[i * 4 + k] / mesh.wScale; if (!w) continue;
      const j = mesh.joints[i * 4 + k], W = world[j], b = bind[j];
      const r = qrot(W.q, [v[0] - b[0], v[1] - b[1], v[2] - b[2]]);
      x += w * (r[0] + W.p[0]); y += w * (r[1] + W.p[1]); z += w * (r[2] + W.p[2]);
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}

/** Index buffer without the triangles set in ANY of the base64 bitsets. */
export function maskedIndex(idx, b64s) {
  const list = (b64s || []).filter(Boolean).map(b => Buffer.from(b, 'base64'));
  if (!list.length) return idx;
  const out = [];
  for (let t = 0; t < idx.length / 3; t++) if (!list.some(bits => bits[t >> 3] & (1 << (t & 7)))) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  return Uint32Array.from(out);
}

const LAYER = {lower: 1, upper: 2, head: 3, face: 3};
/**
 * Render body + worn wearables (array of loaded wearables). Body triangles hidden by every worn
 * wearable's `hideBodyTriangles`; a lower garment's triangles hidden by a worn upper's
 * `hideWear[<lowerId>]` (waistband under the jacket hem).
 */
export function renderLook(body, wear, {clip = null, t = 0, yaw = 0, W = 220, H = 330, frame, noBody = false, bg = [44, 44, 50], cullBack = true} = {}) {
  const c = new Canvas(W, H, bg);
  const world = poseAt(body, clip, t);
  const worn = (wear || []).filter(Boolean).map(o => ({o, v: o.variants[body.extras.id]}));
  for (const {o, v} of worn) {
    if (!v) throw new Error(`no ${o.extras.id} variant for ${body.extras.id}`);
    if (v.extras.bodyGeometryHash !== body.extras.geometryHash) throw new Error(`mask/body hash mismatch ${o.extras.id} x ${body.extras.id}`);
  }
  const cam = {yawDeg: yaw, cx: frame?.cx ?? 0, cy: frame?.cy ?? 0.92, cz: 0, height: frame?.h ?? 2.0};
  if (!noBody) c.draw({pos: skinMesh(body.mesh, body, world), idx: maskedIndex(body.mesh.idx, worn.map(w => w.v.extras.hideBodyTriangles)), uv: body.mesh.uv, tex: body.tex, cullBack}, cam);
  for (const {o, v} of worn.sort((a, b) => (LAYER[a.o.extras.slot] ?? 2) - (LAYER[b.o.extras.slot] ?? 2))) {
    const over = worn.filter(w => w !== undefined && w.o !== o).map(w => w.v.extras.hideWear?.[o.extras.id]).filter(Boolean);
    c.draw({pos: skinMesh(v.mesh, body, world), idx: maskedIndex(v.mesh.idx, over), uv: v.mesh.uv, tex: o.tex, cullBack}, cam);
  }
  return c;
}

const esc = s => String(s).replace(/[<>&]/g, ch => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[ch]));
export async function sheet(file, title, rows, cellW, cellH, colLabels, rowLabels, {labelW = 120} = {}) {
  const LW = labelW, TH = 46, CH = 22;
  const ncol = Math.max(colLabels.length, ...rows.map(r => r.length));
  const Wt = LW + cellW * ncol, Ht = TH + CH + cellH * rows.length;
  const comps = [];
  rows.forEach((row, ri) => row.forEach((c, ci) => { if (c) comps.push({input: Buffer.from(c.rgb), raw: {width: c.w, height: c.h, channels: 3}, left: LW + ci * cellW, top: TH + CH + ri * cellH}); }));
  const svg = `<svg width="${Wt}" height="${Ht}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:DejaVu Sans,Arial,sans-serif;fill:#e8e4da}</style>
    <text x="10" y="28" font-size="20">${esc(title)}</text>
    ${colLabels.map((l, i) => `<text x="${LW + i * cellW + cellW / 2}" y="${TH + 16}" font-size="12" text-anchor="middle">${esc(l)}</text>`).join('')}
    ${rowLabels.map((l, i) => `<text x="6" y="${TH + CH + i * cellH + cellH / 2}" font-size="12">${esc(l)}</text>`).join('')}</svg>`;
  await sharp({create: {width: Wt, height: Ht, channels: 3, background: '#1c1c20'}}).composite([...comps, {input: Buffer.from(svg), left: 0, top: 0}]).png().toFile(file);
  console.log('wrote', path.relative(REPO, file));
  return file;
}
