// CPU rendering of the BUILT runtime creature GLB (no browser/GPU): reads the GLB's own skin,
// joints and animation channels, poses a clip frame, skins on the CPU (linear blend) and rasterises
// with the zombie pipeline's deterministic rasteriser (tools/asset-pipeline/zombie/lib/raster.mjs).
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {Canvas} from '../../zombie/lib/raster.mjs';

const io = new NodeIO();
const arr = a => a ? a.getArray() : null;
export const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export const qrot = (q, v) => { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };

export async function loadCreature(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const node = root.listNodes().find(n => n.getName() === 'RatdogBody');
  const prim = node.getMesh().listPrimitives()[0];
  const skin = node.getSkin();
  const joints = skin.listJoints();
  const mat = prim.getMaterial();
  const dec = async img => { const {data, info} = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, channels: 3}; };
  return {file, doc, extras: root.listScenes()[0].getExtras().creatureRatdog, joints, names: joints.map(j => j.getName()), ibm: arr(skin.getInverseBindMatrices()),
    mesh: {pos: arr(prim.getAttribute('POSITION')), nrm: arr(prim.getAttribute('NORMAL')), uv: arr(prim.getAttribute('TEXCOORD_0')), idx: arr(prim.getIndices()), joints: arr(prim.getAttribute('JOINTS_0')), weights: arr(prim.getAttribute('WEIGHTS_0'))},
    tex: await dec(mat.getBaseColorTexture().getImage()), nrmTex: await dec(mat.getNormalTexture().getImage()), anims: root.listAnimations()};
}

export function poseAt(c, clipName, t) {
  const local = c.joints.map(j => ({q: j.getRotation().slice(), p: j.getTranslation().slice()}));
  const anim = clipName && c.anims.find(a => a.getName() === clipName);
  if (anim) for (const ch of anim.listChannels()) {
    const ji = c.joints.indexOf(ch.getTargetNode()); if (ji < 0) continue;
    const s = ch.getSampler(), T = s.getInput().getArray(), O = s.getOutput().getArray(), k = ch.getTargetPath() === 'rotation' ? 4 : 3;
    let i = 0; while (i < T.length - 2 && t > T[i + 1]) i++;
    const u = Math.min(1, Math.max(0, (t - T[i]) / (T[i + 1] - T[i] || 1)));
    const v = Array.from({length: k}, (_, q) => O[i * k + q] * (1 - u) + O[(i + 1) * k + q] * u);
    if (k === 4) { const l = Math.hypot(...v); local[ji].q = v.map(x => x / l); } else local[ji].p = v;
  }
  const world = [];
  c.joints.forEach((j, i) => {
    const par = j.getParentNode && j.getParentNode();
    const pi = c.joints.indexOf(par);
    if (pi < 0) world[i] = {q: local[i].q, p: local[i].p};
    else { const P = world[pi]; world[i] = {q: qmul(P.q, local[i].q), p: qrot(P.q, local[i].p).map((v, q) => v + P.p[q])}; }
  });
  return world;
}

export function skin(c, world) {
  const m = c.mesh, n = m.pos.length / 3, out = new Float32Array(n * 3);
  const bind = c.joints.map((_, j) => [-c.ibm[j * 16 + 12], -c.ibm[j * 16 + 13], -c.ibm[j * 16 + 14]]);
  for (let i = 0; i < n; i++) {
    const v = [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = m.weights[i * 4 + k]; if (!w) continue;
      const j = m.joints[i * 4 + k], W = world[j], b = bind[j];
      const r = qrot(W.q, [v[0] - b[0], v[1] - b[1], v[2] - b[2]]);
      x += w * (r[0] + W.p[0]); y += w * (r[1] + W.p[1]); z += w * (r[2] + W.p[2]);
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}

const PALETTE = [[200, 200, 200], [230, 60, 60], [240, 140, 40], [240, 220, 40], [120, 220, 60], [40, 200, 160], [60, 160, 240], [120, 90, 240], [220, 80, 220], [160, 60, 60], [60, 120, 60], [60, 60, 160], [200, 120, 160]];

/**
 * Render one view. opts: {clip, t, yaw, W, H, frame: {cx, cy, cz, h}, mode: 'tex'|'weights', floor: true, bg}
 * yaw 0 = looking at the creature's face (+Z), 90 = its LEFT side, 270 = its RIGHT side; 'top' = from above.
 */
export function render(c, {clip = null, t = 0, yaw = 270, W = 360, H = 240, frame = {}, mode = 'tex', floor = true, bg = [40, 40, 46]} = {}) {
  const cv = new Canvas(W, H, bg);
  const world = poseAt(c, clip, t);
  let P = skin(c, world);
  const top = yaw === 'top';
  const cam = {yawDeg: top ? 0 : yaw, cx: frame.cx ?? 0, cy: frame.cy ?? 0.3, cz: frame.cz ?? 0, height: frame.h ?? 0.95};
  if (top) { const Q = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) { Q[i] = P[i]; Q[i + 1] = -P[i + 2]; Q[i + 2] = P[i + 1]; } P = Q; cam.cy = frame.cy ?? 0; }
  if (floor && !top) {
    // floor line (y = 0) for contact reading
    const k = H / cam.height, y = Math.round(H / 2 + cam.cy * k);
    if (y >= 0 && y < H) for (let x = 0; x < W; x++) cv.rgb.set([90, 90, 70], (y * W + x) * 3);
  }
  if (mode === 'weights') {
    const n = c.mesh.pos.length / 3, colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const w = c.mesh.weights[i * 4 + k], col = PALETTE[c.mesh.joints[i * 4 + k] % PALETTE.length]; for (let q = 0; q < 3; q++) colors[i * 3 + q] += w * col[q]; }
    c._wtex ??= vertexColorsToUV(c.mesh, colors, 512);
    const tex = c._wtex, uv = c.mesh.uv;
    cv.draw({pos: P, idx: c.mesh.idx, uv, tex, cullBack: false}, cam);
  } else cv.draw({pos: P, idx: c.mesh.idx, uv: c.mesh.uv, tex: c.tex, cullBack: false}, cam);
  return cv;
}

/** Rasterise per-vertex colours into the mesh's own UV atlas (weights view). */
function vertexColorsToUV(m, colors, size) {
  const data = new Uint8Array(size * size * 3).fill(30);
  const {uv, idx} = m;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = uv[a * 2] * size, ay = uv[a * 2 + 1] * size, bx = uv[b * 2] * size, by = uv[b * 2 + 1] * size, cx = uv[c * 2] * size, cy = uv[c * 2 + 1] * size;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      let w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area, w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < -0.15 || w1 < -0.15 || w2 < -0.15) continue;
      w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2); const s = w0 + w1 + w2;
      for (let q = 0; q < 3; q++) data[(y * size + x) * 3 + q] = Math.min(255, (w0 * colors[a * 3 + q] + w1 * colors[b * 3 + q] + w2 * colors[c * 3 + q]) / s);
    }
  }
  return {data, width: size, height: size, channels: 3};
}

const esc = s => String(s).replace(/[<>&]/g, ch => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[ch]));
export async function sheet(file, title, rows, cellW, cellH, colLabels, rowLabels, {labelW = 110} = {}) {
  const LW = labelW, TH = 40, CH = 20;
  const ncol = Math.max(colLabels.length, ...rows.map(r => r.length));
  const Wt = LW + cellW * ncol, Ht = TH + CH + cellH * rows.length;
  const comps = [];
  rows.forEach((row, ri) => row.forEach((c, ci) => { if (c) comps.push({input: Buffer.from(c.rgb), raw: {width: c.w, height: c.h, channels: 3}, left: LW + ci * cellW, top: TH + CH + ri * cellH}); }));
  const svg = `<svg width="${Wt}" height="${Ht}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:DejaVu Sans,Arial,sans-serif;fill:#e8e4da}</style>
    <text x="10" y="26" font-size="18">${esc(title)}</text>
    ${colLabels.map((l, i) => `<text x="${LW + i * cellW + cellW / 2}" y="${TH + 14}" font-size="12" text-anchor="middle">${esc(l)}</text>`).join('')}
    ${rowLabels.map((l, i) => `<text x="6" y="${TH + CH + i * cellH + cellH / 2}" font-size="12">${esc(l)}</text>`).join('')}</svg>`;
  await sharp({create: {width: Wt, height: Ht, channels: 3, background: '#1c1c20'}}).composite([...comps, {input: Buffer.from(svg), left: 0, top: 0}]).png().toFile(file);
  return file;
}
