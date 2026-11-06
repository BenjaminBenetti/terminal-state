// Skyways lane ASSET-B: QA renders of the prize car runtime model (CPU only; no browser / GPU). Reads
//   game/public/assets/models/skyways-prize-car.glb + its provenance (anchors) and writes PNGs to the PRIVATE QA folder
//   (default reference/tasks/skyways-level-20261106-054448/qa/asset-b; never Git):
//   ortho.png              front / back / left / right / top of the result (glass = its dark tint over the dark cabin)
//   glass-mask.png         the glass primitive in cyan over the textured body (6 views): proves the classification
//   glass-vs-texture.png   close-ups: glass drawn with the source base map (what the classifier read) | the glass mask
//   cabin-top.png          roof clipped, from above: interior box, eye, steering wheel, wheels, exits, collision circles
//   cabin-side.png         section through the driver seat plane (x > eye.x), from the left: box, eye, wheel, sight lines
//   first-person.png       perspective views from the driver eye (forward / left / right / forward-down): what the player sees
//   badges.png             close-ups of the badge areas in the texture (reported, never painted over)
// Lane CAR2 (the ASSEMBLED car: body + glass + the Meshy dash + two seats + the cockpit fillers, placed by the runtime's own
// game/src/world/skywaysCarCockpit.ts cockpitLayout; private QA folder qa/car2):
//   cockpit-first-person.png  from the driver eye at the game's default 75° vertical FOV (16:9): forward, forward-down at the dash,
//                             left, right, over the right shoulder, straight down at the wheel / seat
//   cockpit-side.png          a section through the driver seat plane from the left (parts, eye, wheel, the cowl -> header line)
//   cockpit-top.png           the roof clipped, from above (parts, fillers, interior box, eye)
// Usage: node --experimental-strip-types --max-old-space-size=3072 tools/asset-pipeline/props/qa-skyways-car.mjs [--reference <dir>]
//        [--out <dir>] [--only cockpit]   (the cockpit sheets need --experimental-strip-types: they import the runtime's layout)
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {NodeIO} from '@gltf-transform/core';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const REF = path.resolve(opt('--reference') ?? path.join(root, 'reference'));
const OUT = path.resolve(opt('--out') ?? path.join(REF, 'tasks/skyways-level-20261106-054448/qa/asset-b'));
const ONLY = opt('--only'); // 'cockpit': only lane CAR2's cockpit sheets
fs.mkdirSync(OUT, {recursive: true});
const prov = JSON.parse(fs.readFileSync(path.join(root, 'game/public/assets/derivatives/skyways-prize-car.json'), 'utf8'));
const A = prov.anchors;
const doc = await new NodeIO().read(path.join(root, 'game/public/assets/models/skyways-prize-car.glb'));
const parts = {};
for (const node of doc.getRoot().listNodes()) {
  const p = node.getMesh().listPrimitives()[0];
  const mat = p.getMaterial(), tex = mat.getBaseColorTexture();
  parts[node.getName()] = {P: p.getAttribute('POSITION').getArray(), N: p.getAttribute('NORMAL').getArray(), UV: p.getAttribute('TEXCOORD_0').getArray(), I: p.getIndices().getArray(), mat};
  if (tex) { const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); parts[node.getName()].tex = {data, w: info.width, h: info.height}; }
}
const body = parts.body, glass = parts.glass;
glass.tex = body.tex; // glass keeps the body UVs: the base map under the glass is what the classifier read
const GC = glass.mat.getBaseColorFactor();
const TRIM = [46, 46, 50]; // the inside of the shell (the vehicle runtime renders it as a dark BackSide trim)
const sample = (t, u, v) => { const o = 3 * (Math.min(t.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * t.h))) * t.w + Math.min(t.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * t.w)))); return [t.data[o], t.data[o + 1], t.data[o + 2]]; };
const LIGHT = (() => { const l = [0.35, 0.8, 0.45], n = Math.hypot(...l); return l.map(v => v / n); })();

// ---- image buffer + overlays -----------------------------------------------------------------------------------------------
const img = (W, H, bg) => { const d = Buffer.alloc(W * H * 3); for (let k = 0; k < W * H; k++) { d[3 * k] = bg[0]; d[3 * k + 1] = bg[1]; d[3 * k + 2] = bg[2]; } return {W, H, d}; };
const put = (im, x, y, c, a = 1) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= im.W || y >= im.H) return; const o = 3 * (y * im.W + x); for (let k = 0; k < 3; k++) im.d[o + k] = im.d[o + k] * (1 - a) + c[k] * a; };
const dot = (im, x, y, r, c) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) put(im, x + i, y + j, c); };
const line = (im, x0, y0, x1, y1, c, w = 1) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1; for (let s = 0; s <= n; s++) { const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n; for (let j = -w + 1; j < w; j++) for (let i = -w + 1; i < w; i++) put(im, x + i, y + j, c); } };
const ring = (im, x, y, r, c, w = 2) => { const n = Math.ceil(2 * Math.PI * r) + 8; for (let s = 0; s < n; s++) { const a = 2 * Math.PI * s / n; for (let k = 0; k < w; k++) put(im, x + (r - k) * Math.cos(a), y + (r - k) * Math.sin(a), c); } };
const png = im => sharp(im.d, {raw: {width: im.W, height: im.H, channels: 3}}).png().toBuffer();
async function sheet(file, tiles, cols) {
  const W = tiles[0].W, H = tiles[0].H, rows = Math.ceil(tiles.length / cols);
  const comps = []; for (let i = 0; i < tiles.length; i++) comps.push({input: await png(tiles[i]), left: (i % cols) * (W + 6), top: Math.floor(i / cols) * (H + 6)});
  await sharp({create: {width: cols * (W + 6) - 6, height: rows * (H + 6) - 6, channels: 3, background: '#111111'}}).composite(comps).png().toFile(path.join(OUT, file));
  console.log('wrote', path.join(OUT, file));
}

// ---- orthographic rasteriser -----------------------------------------------------------------------------------------------
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** view rows [right, up, toward camera] from yaw (0 = camera in front, at -Z; 90 = camera on the left, at -X) and pitch */
function viewYP(yaw, pitch) {
  const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180;
  const toward = [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)];
  const right = norm(cross([0, 1, 0], toward)), up = cross(toward, right);
  return [right, up, toward];
}
const TOP = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
function frameBox(V, box, W, H, m = 0.94) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const x of [box[0][0], box[1][0]]) for (const y of [box[0][1], box[1][1]]) for (const z of [box[0][2], box[1][2]]) {
    const u = V[0][0] * x + V[0][1] * y + V[0][2] * z, v = V[1][0] * x + V[1][1] * y + V[1][2] * z;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return {cx: (u0 + u1) / 2, cy: (v0 + v1) / 2, s: Math.min(W / (u1 - u0), H / (v1 - v0)) * m};
}
const CAR = [[-1.06, 0, -2.39], [1.06, 1.39, 2.39]];
/** glassMode: 'tint' (its material over what is behind) | 'cyan' | 'texture' | 'hide'; skip(centroid) clips */
function ortho(V, W, H, {frame, glassMode = 'tint', skip = null, bg = [40, 40, 44], extras = []} = {}) {
  const fr = frame ?? frameBox(V, CAR, W, H);
  const im = img(W, H, bg), zb = new Float32Array(W * H).fill(-Infinity);
  const proj = p => [(V[0][0] * p[0] + V[0][1] * p[1] + V[0][2] * p[2] - fr.cx) * fr.s + W / 2, H / 2 - (V[1][0] * p[0] + V[1][1] * p[1] + V[1][2] * p[2] - fr.cy) * fr.s, V[2][0] * p[0] + V[2][1] * p[1] + V[2][2] * p[2]];
  const draw = (M, mode, flat = null) => {
    const {P, N, I, tex} = M, UV = M.UV ?? new Float32Array(P.length / 3 * 2);
    for (let t = 0; t < I.length; t += 3) {
      const ids = [I[t], I[t + 1], I[t + 2]], w = ids.map(i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
      if (skip && skip([(w[0][0] + w[1][0] + w[2][0]) / 3, (w[0][1] + w[1][1] + w[2][1]) / 3, (w[0][2] + w[1][2] + w[2][2]) / 3])) continue;
      const s = w.map(proj);
      const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-12) continue;
      const nA = norm([0, 1, 2].map(k => N[3 * ids[0] + k] + N[3 * ids[1] + k] + N[3 * ids[2] + k]));
      const facing = nA[0] * V[2][0] + nA[1] * V[2][1] + nA[2] * V[2][2] > 0; // outer side toward the camera
      const fn = norm(cross([0, 1, 2].map(k => w[1][k] - w[0][k]), [0, 1, 2].map(k => w[2][k] - w[0][k])));
      const L = 0.42 + 0.58 * Math.abs(fn[0] * LIGHT[0] + fn[1] * LIGHT[1] + fn[2] * LIGHT[2]);
      const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const b0 = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b1 = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, b2 = 1 - b0 - b1;
        if (b0 < -1e-6 || b1 < -1e-6 || b2 < -1e-6) continue;
        const z = b0 * s[0][2] + b1 * s[1][2] + b2 * s[2][2], k = y * W + x;
        let c;
        if (mode === 'opaque' || mode === 'cyan' || mode === 'texture' || mode === 'both') {
          if (z <= zb[k]) continue; zb[k] = z;
          if (mode === 'cyan') c = [0, 225, 255];
          else if (flat) c = flat;
          else if (mode === 'both') c = sample(tex, b0 * UV[2 * ids[0]] + b1 * UV[2 * ids[1]] + b2 * UV[2 * ids[2]], b0 * UV[2 * ids[0] + 1] + b1 * UV[2 * ids[1] + 1] + b2 * UV[2 * ids[2] + 1]);
          else if (!facing && mode === 'opaque') c = TRIM;
          else c = sample(tex, b0 * UV[2 * ids[0]] + b1 * UV[2 * ids[1]] + b2 * UV[2 * ids[2]], b0 * UV[2 * ids[0] + 1] + b1 * UV[2 * ids[1] + 1] + b2 * UV[2 * ids[2] + 1]);
          put(im, x, y, c.map(v => Math.min(255, v * L)));
        } else if (mode === 'tint') {
          if (z <= zb[k]) continue;
          put(im, x, y, [GC[0] * 255 + 60 * L * L, GC[1] * 255 + 64 * L * L, GC[2] * 255 + 70 * L * L], Math.min(1, GC[3] + 0.12)); // tint + a little sheen
        }
      }
    }
  };
  draw(body, 'opaque');
  for (const x of extras) draw(x.M, 'both', x.flat ?? null);
  if (glassMode === 'cyan') draw(glass, 'cyan');
  else if (glassMode === 'texture') draw(glass, 'texture');
  else if (glassMode === 'tint') draw(glass, 'tint');
  return {im, P: p => { const q = proj(p); return [q[0], q[1]]; }, s: fr.s};
}

// ---- perspective (first person) ------------------------------------------------------------------------------------------
/** extras: [{M: {P, N, UV, I, tex}, flat?: [r, g, b]}] drawn opaque from both sides (the cockpit parts / fillers); vfov: vertical FOV */
function persp(eye, yaw, pitch, W, H, hfov = 80, {extras = [], vfov = null} = {}) {
  const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180;
  const f = [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)], r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const fp = vfov ? (H / 2) / Math.tan(vfov * Math.PI / 360) : (W / 2) / Math.tan(hfov * Math.PI / 360), NEAR = 0.05;
  const im = img(W, H, [0, 0, 0]), zb = new Float32Array(W * H).fill(0); // stores 1/depth (bigger = nearer)
  // background: sky gradient + 1 m checker ground (with distance fade) seen from the eye height
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - W / 2) / fp, dy = (H / 2 - y - 0.5) / fp;
    const d = norm([0, 1, 2].map(k => f[k] + dx * r[k] + dy * u[k]));
    let c;
    if (d[1] < -1e-4) {
      const t = -eye[1] / d[1], gx = eye[0] + t * d[0], gz = eye[2] + t * d[2];
      const chk = (Math.floor(gx) + Math.floor(gz)) & 1 ? 150 : 110, fog = Math.min(1, t / 60);
      c = [chk * (1 - fog) + 190 * fog, (chk + 8) * (1 - fog) + 200 * fog, chk * (1 - fog) + 210 * fog];
    } else c = [150 + 80 * (1 - d[1]), 185 + 50 * (1 - d[1]), 235];
    put(im, x, y, c);
  }
  const cam = p => { const q = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]]; return [q[0] * r[0] + q[1] * r[1] + q[2] * r[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * f[0] + q[1] * f[1] + q[2] * f[2]]; };
  const draw = (M, glassy, flat = null, both = false) => {
    const {P, N, I, tex} = M, UV = M.UV ?? new Float32Array(P.length / 3 * 2);
    for (let t = 0; t < I.length; t += 3) {
      const ids = [I[t], I[t + 1], I[t + 2]];
      const w = ids.map(i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]]);
      let poly = ids.map((i, k) => ({c: cam(w[k]), uv: [UV[2 * i], UV[2 * i + 1]]}));
      if (poly.every(p => p.c[2] < NEAR)) continue;
      if (poly.some(p => p.c[2] < NEAR)) { // clip against the near plane
        const out = [];
        for (let k = 0; k < poly.length; k++) {
          const A = poly[k], B = poly[(k + 1) % poly.length], ina = A.c[2] >= NEAR, inb = B.c[2] >= NEAR;
          if (ina) out.push(A);
          if (ina !== inb) { const s = (NEAR - A.c[2]) / (B.c[2] - A.c[2]); out.push({c: A.c.map((v, j) => v + s * (B.c[j] - v)), uv: A.uv.map((v, j) => v + s * (B.uv[j] - v))}); }
        }
        poly = out;
      }
      const cen = [0, 1, 2].map(k => (w[0][k] + w[1][k] + w[2][k]) / 3);
      const nA = norm([0, 1, 2].map(k => N[3 * ids[0] + k] + N[3 * ids[1] + k] + N[3 * ids[2] + k]));
      const facing = nA[0] * (eye[0] - cen[0]) + nA[1] * (eye[1] - cen[1]) + nA[2] * (eye[2] - cen[2]) > 0;
      const fn = norm(cross([0, 1, 2].map(k => w[1][k] - w[0][k]), [0, 1, 2].map(k => w[2][k] - w[0][k])));
      const L = 0.45 + 0.55 * Math.abs(fn[0] * LIGHT[0] + fn[1] * LIGHT[1] + fn[2] * LIGHT[2]);
      for (let k = 1; k + 1 < poly.length; k++) {
        const tri = [poly[0], poly[k], poly[k + 1]];
        const s = tri.map(p => [W / 2 + p.c[0] / p.c[2] * fp, H / 2 - p.c[1] / p.c[2] * fp, 1 / p.c[2]]);
        const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-12) continue;
        const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
        const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const b0 = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b1 = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, b2 = 1 - b0 - b1;
          if (b0 < -1e-6 || b1 < -1e-6 || b2 < -1e-6) continue;
          const iz = b0 * s[0][2] + b1 * s[1][2] + b2 * s[2][2], k2 = y * W + x;
          if (iz <= zb[k2]) continue;
          if (glassy) { put(im, x, y, [GC[0] * 255 + 40 * L, GC[1] * 255 + 44 * L, GC[2] * 255 + 50 * L], GC[3]); continue; }
          zb[k2] = iz;
          let c = TRIM;
          if (flat) c = flat;
          else if (facing || both) { const q0 = b0 * s[0][2], q1 = b1 * s[1][2], q2 = b2 * s[2][2], qs = q0 + q1 + q2; c = sample(tex, (q0 * tri[0].uv[0] + q1 * tri[1].uv[0] + q2 * tri[2].uv[0]) / qs, (q0 * tri[0].uv[1] + q1 * tri[1].uv[1] + q2 * tri[2].uv[1]) / qs); }
          put(im, x, y, c.map(v => Math.min(255, v * L)));
        }
      }
    }
  };
  draw(body, false);
  for (const x of extras) draw(x.M, false, x.flat ?? null, true);
  draw(glass, true);
  // centre cross-hair
  for (let i = -6; i <= 6; i++) { put(im, W / 2 + i, H / 2, [255, 255, 0]); put(im, W / 2, H / 2 + i, [255, 255, 0]); }
  return im;
}

// ---- sheets ------------------------------------------------------------------------------------------------------------------
const T = 640;
if (ONLY !== 'cockpit') {
await sheet('ortho.png', [ortho(viewYP(0, 0), T, T / 2 * 1.1 | 0), ortho(viewYP(180, 0), T, T / 2 * 1.1 | 0), ortho(viewYP(90, 0), T, T / 2 * 1.1 | 0), ortho(viewYP(-90, 0), T, T / 2 * 1.1 | 0), ortho(TOP, T, T / 2 * 1.1 | 0, {frame: frameBox(TOP, CAR, T, T / 2 * 1.1 | 0)}), ortho(viewYP(35, 22), T, T / 2 * 1.1 | 0)].map(o => o.im), 2);
await sheet('glass-mask.png', [viewYP(30, 25), viewYP(150, 25), viewYP(90, 5), viewYP(-90, 5), viewYP(0, 15), TOP].map(V => ortho(V, T, 400, {glassMode: 'cyan'}).im), 2);
{
  const shots = [[viewYP(0, 25), [[-0.8, 0.9, -1.0], [0.8, 1.36, 0]]], [viewYP(90, 3), [[-0.95, 0.9, -0.7], [-0.5, 1.36, 1.2]]], [viewYP(-90, 3), [[0.5, 0.9, -0.7], [0.95, 1.36, 1.2]]], [viewYP(180, 32), [[-0.6, 1.05, 1.0], [0.6, 1.36, 1.7]]]];
  const tiles = [];
  for (const [V, box] of shots) { const frame = frameBox(V, box, 760, 380); tiles.push(ortho(V, 760, 380, {frame, glassMode: 'texture'}).im, ortho(V, 760, 380, {frame, glassMode: 'cyan'}).im); }
  await sheet('glass-vs-texture.png', tiles, 2);
}
const C_BOX = [255, 220, 0], C_EYE = [255, 40, 40], C_WHEEL = [255, 140, 0], C_EXIT = [60, 255, 60], C_CIRC = [80, 160, 255], C_WHL = [255, 255, 255];
{
  const W = 900, H = 1200, frame = frameBox(TOP, [[-1.8, 0, -2.5], [1.8, 1, 2.5]], W, H, 0.97);
  const tiles = [];
  for (const clipY of [1.0, 0.7]) {
    const o = ortho(TOP, W, H, {frame, skip: c => c[1] > clipY, glassMode: 'hide'});
    const p = (x, z) => o.P([x, 0, z]);
    const {x0, x1, z0, z1} = A.interior;
    for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) { const [u0, v0] = p(...a), [u1, v1] = p(...b); line(o.im, u0, v0, u1, v1, C_BOX, 2); }
    for (const c of A.circles) { const [u, v] = p(0, c.z); ring(o.im, u, v, c.r * o.s, C_CIRC, 2); dot(o.im, u, v, 3, C_CIRC); }
    for (const w of A.wheels) { const [u, v] = p(w.x, w.z); ring(o.im, u, v, 0.06 * o.s, C_WHL, 2); line(o.im, ...p(w.x, w.z - w.r), ...p(w.x, w.z + w.r), C_WHL, 2); }
    for (const e of [A.exits.left, A.exits.right]) dot(o.im, ...p(e.x, e.z), 7, C_EXIT);
    dot(o.im, ...p(A.eye.x, A.eye.z), 7, C_EYE);
    dot(o.im, ...p(A.wheelCentre.x, A.wheelCentre.z), 6, C_WHEEL);
    line(o.im, ...p(A.eye.x, A.eye.z), ...p(A.eye.x, A.eye.z - 0.6), C_EYE, 1);
    tiles.push(o.im);
  }
  await sheet('cabin-top.png', tiles, 2);
}
{
  const V = viewYP(90, 0), W = 1400, H = 520, frame = frameBox(V, [[0, 0, -2.45], [0, 1.45, 2.45]], W, H, 0.97);
  const o = ortho(V, W, H, {frame, skip: c => c[0] < A.eye.x, glassMode: 'tint'});
  const p = (y, z) => o.P([0, y, z]);
  const {y0, y1, z0, z1} = A.interior;
  for (const [a, b] of [[[y0, z0], [y0, z1]], [[y0, z1], [y1, z1]], [[y1, z1], [y1, z0]], [[y1, z0], [y0, z0]]]) line(o.im, ...p(...a), ...p(...b), C_BOX, 2);
  for (const s of A.sightLines) {
    if (Math.abs(Math.sin(s.yaw * Math.PI / 180)) > 0.3) continue; // in-plane sight lines only
    const a = s.yaw * Math.PI / 180, b = s.pitch * Math.PI / 180, d = [-Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)];
    const L = Math.min(s.distance, 3) + 0.6;
    line(o.im, ...p(A.eye.y, A.eye.z), ...p(A.eye.y + L * d[1], A.eye.z + L * d[2]), s.hit === 'glass' ? [120, 255, 255] : [255, 80, 80], 1);
  }
  for (const w of A.wheels.filter(w => w.x < 0)) { const [u, v] = p(w.y, w.z); ring(o.im, u, v, w.r * o.s, C_WHL, 2); dot(o.im, u, v, 3, C_WHL); }
  dot(o.im, ...p(A.eye.y, A.eye.z), 7, C_EYE);
  dot(o.im, ...p(A.wheelCentre.y, A.wheelCentre.z), 6, C_WHEEL);
  dot(o.im, ...p(A.cowl.y, A.cowl.z), 5, [255, 0, 255]);
  dot(o.im, ...p(A.header.y, A.header.z), 5, [255, 0, 255]);
  await sheet('cabin-side.png', [o.im], 1);
}
{
  const e = [A.eye.x, A.eye.y, A.eye.z], W = 960, H = 540;
  await sheet('first-person.png', [persp(e, 0, -3, W, H), persp(e, 0, -14, W, H), persp(e, 75, -4, W, H), persp(e, -65, -4, W, H)], 2);
}
{
  const shots = [[viewYP(0, 8), [[-0.25, 0.6, -2.4], [0.25, 0.9, -2.2]]], [viewYP(180, 8), [[-0.3, 0.7, 2.2], [0.3, 0.95, 2.4]]], [viewYP(180, 0), [[-0.5, 0.35, 2.2], [0.5, 0.75, 2.4]]], [viewYP(90, 0), [[-1, 0.55, -1.25], [-0.8, 0.85, -0.85]]], [TOP, [[-0.4, 0.6, -2.42], [0.4, 0.9, -2.0]]], [TOP, [[-0.5, 0.9, 1.6], [0.5, 1.1, 2.4]]]];
  await sheet('badges.png', shots.map(([V, box]) => ortho(V, 640, 320, {frame: frameBox(V, box, 640, 320, 0.9), glassMode: 'hide'}).im), 2);
}
} // (ASSET-B's sheets)

// ---- lane CAR2: the assembled cockpit (the runtime's own layout) -------------------------------------------------------------
{
  const {cockpitLayout, fillMesh, posePoint, sightLineY, COCKPIT_URLS, FILL_COLOR} = await import('../../../game/src/world/skywaysCarCockpit.ts');
  const {SKYWAYS_CAR: SPEC} = await import('../../../game/src/assets/skywaysCar.generated.ts');
  const lay = cockpitLayout(SPEC);
  console.log('cockpit layout', JSON.stringify(lay));
  const loadPart = async url => {
    const d = await new NodeIO().read(path.join(root, 'game/public', url));
    const p = d.getRoot().listNodes()[0].getMesh().listPrimitives()[0], t = p.getMaterial().getBaseColorTexture();
    const {data, info} = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true});
    return {P: p.getAttribute('POSITION').getArray(), N: p.getAttribute('NORMAL').getArray(), UV: p.getAttribute('TEXCOORD_0').getArray(), I: p.getIndices().getArray(), tex: {data, w: info.width, h: info.height}};
  };
  const place = (M, pose) => {
    const P = new Float32Array(M.P.length), N = new Float32Array(M.N.length), c = Math.cos(pose.rotY), s = Math.sin(pose.rotY);
    for (let i = 0; i < P.length; i += 3) {
      const q = posePoint(pose, M.P[i], M.P[i + 1], M.P[i + 2]);
      P[i] = q.x; P[i + 1] = q.y; P[i + 2] = q.z;
      N[i] = M.N[i] * c + M.N[i + 2] * s; N[i + 1] = M.N[i + 1]; N[i + 2] = -M.N[i] * s + M.N[i + 2] * c;
    }
    return {...M, P, N};
  };
  const dashM = await loadPart(COCKPIT_URLS.dash), seatM = await loadPart(COCKPIT_URLS.seat);
  const FILL = [FILL_COLOR >> 16, (FILL_COLOR >> 8) & 255, FILL_COLOR & 255]; // (the runtime fillers' colour: the dash top's median)
  const parts = [{M: place(dashM, lay.dash)}, ...lay.seats.map(p => ({M: place(seatM, p)})), {M: fillMesh(lay), flat: FILL}];
  const flatParts = parts.map(x => (x.flat ? {...x, flat: [230, 140, 40]} : x)); // (the sections: fillers orange)
  const e = [SPEC.eye.x, SPEC.eye.y, SPEC.eye.z], W = 960, H = 540;
  const views = [[0, -4], [0, -28], [70, -10], [-60, -14], [0, -62], [-140, -12]];
  await sheet('cockpit-first-person.png', views.map(([y, p]) => persp(e, y, p, W, H, 0, {extras: parts, vfov: 75})), 2);
  // the side section through the driver seat plane (x >= eye.x), from the left; the cowl -> header line extended
  {
    const V = viewYP(90, 0), Wd = 1400, Hd = 620, frame = frameBox(V, [[0, 0, -1.6], [0, 1.45, 1.2]], Wd, Hd, 0.97);
    const im = ortho(V, Wd, Hd, {frame, skip: c => c[0] < SPEC.eye.x, glassMode: 'tint', extras: flatParts});
    const p = (y, z) => im.P([0, y, z]);
    line(im.im, ...p(sightLineY(SPEC, -1.2), -1.2), ...p(sightLineY(SPEC, SPEC.header.z), SPEC.header.z), [255, 0, 255], 1);
    dot(im.im, ...p(SPEC.cowl.y, SPEC.cowl.z), 5, [255, 0, 255]);
    dot(im.im, ...p(SPEC.header.y, SPEC.header.z), 5, [255, 0, 255]);
    dot(im.im, ...p(SPEC.eye.y, SPEC.eye.z), 7, [255, 40, 40]);
    dot(im.im, ...p(lay.wheel.y, lay.wheel.z), 6, [255, 140, 0]);
    dot(im.im, ...p(lay.cushionY, SPEC.eye.z), 5, [60, 255, 60]);
    const {y0, y1, z0, z1} = SPEC.interior;
    for (const [a, b] of [[[y0, z0], [y0, z1]], [[y0, z1], [y1, z1]], [[y1, z1], [y1, z0]], [[y1, z0], [y0, z0]]]) line(im.im, ...p(...a), ...p(...b), [255, 220, 0], 1);
    await sheet('cockpit-side.png', [im.im], 1);
  }
  // from above, the roof clipped
  {
    const Wd = 900, Hd = 1000, frame = frameBox(TOP, [[-1.1, 0, -1.6], [1.1, 1, 1.2]], Wd, Hd, 0.97);
    const im = ortho(TOP, Wd, Hd, {frame, skip: c => c[1] > 1.0, glassMode: 'hide', extras: flatParts});
    const p = (x, z) => im.P([x, 0, z]);
    const {x0, x1, z0, z1} = SPEC.interior;
    for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) line(im.im, ...p(...a), ...p(...b), [255, 220, 0], 1);
    dot(im.im, ...p(SPEC.eye.x, SPEC.eye.z), 7, [255, 40, 40]);
    dot(im.im, ...p(lay.wheel.x, lay.wheel.z), 6, [255, 140, 0]);
    await sheet('cockpit-top.png', [im.im], 1);
  }
}
