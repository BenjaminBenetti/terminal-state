#!/usr/bin/env node
// Terminal State — runtime derivatives of the three Meshy T2.5 AMMO BOXES (task studio-knife-melee-20261030-01, lane AMMO).
//
// User (2026-10-30): "relabel all the ammo ... nine millimeter ... whatever rifles use ... whatever shotguns use" and "you might as
// well generate some assets for these ammo boxes right now it's just a basic box. Let's have three meshy assets generated using
// that T two point five model". The primary (sole submitter) generated ONE text-to-3D model per caliber — preview (meshy-t2.5,
// smart-topology, triangle, target 3000) + 2K PBR refine, 45 credits total — and reviewed them (assets/DELIVERED.json):
//   M1 ammo-9mm  — worn red / white "9MM" carton, torn-open lid flap, brass rounds;   item ammo_9mm  (9×19mm)
//   M2 ammo-556  — olive-drab steel ammo can, handle, latches;                         item ammo_556  (5.56×45mm)
//   M3 ammo-12ga — tan "12 Gauge SHOTGUN SHELLS" carton, open top with red shells;      item ammo_12ga (12-gauge)
// This tool turns each ACCEPTED native GLB into the game's runtime derivative:
//   verify (sha256 vs DELIVERED.json) -> orient (Meshy front +Z / up +Y; M1's clean printed "9MM" face is native +X: a quarter
//   turn puts it to the pickup front) -> uniform scale to a sensible pickup size (each fits the 0.18 m drawer / low-shelf clearance
//   of the loot holders: items/lootLayout.ts) -> bottom-centre origin -> Meshy's own topology and UVs kept (2.3–3.1k triangles,
//   already in the ~3k item class) -> LOCAL REPAIR (M2 only, see STENCIL) -> PBR maps downsized (Lanczos) to 512 px colour /
//   256 px metallic-roughness / 256 px normal, JPEG -> game/public/assets/models/ammo-<caliber>-t25.glb + one provenance record
//   per box in game/public/assets/derivatives/meshy-t25-ammo-20261030.json -> CPU review sheet in
//   reference/tasks/knife-melee-20261030/review/ammo/.
// The runtime registry is game/src/assets/manifest.ts (item_ammo_* model keys) + world/pickups.ts ITEM_MODEL_KEYS; ITEM_DIMS
// (items/items.ts) holds the measured runtime dims so fitItemModel keeps the derivative at exactly this size.
//
// STENCIL (M2, local repair — NOT Meshy output): Meshy painted the can's stencil as "516" (front and back panels) instead of 5.56.
// Both panels are repaired in the 2048 px base colour BEFORE downsizing, in object space: the panel is projected orthographically
// (front / back view), the old yellow stencil is masked (colour rule) and filled from the surrounding olive paint (push-pull
// inpainting + seeded grain), and "5.56" is composed from the generated stencil's OWN glyphs (its "5" twice, its "6", a dot cut from
// its "1"), so the paint, wear and stencil bridges match; the result is written back to every atlas texel of that panel (face
// normal toward the view, on the panel plane) and bled 3 px into the atlas gutters. The embossed "516" relief in the normal map is
// flattened inside the old stencil mask. Recorded as `localRepair` in the provenance.
//
// Usage:
//   node tools/asset-pipeline/props/build-ammo-boxes.mjs                # build all three (accepted deliveries)
//   node tools/asset-pipeline/props/build-ammo-boxes.mjs --only ammo-556
//   node tools/asset-pipeline/props/build-ammo-boxes.mjs --dev --out-dir /tmp/x   # dry run: writes ONLY into --out-dir
// Native GLBs are read-only inputs (outside Git); nothing here calls Meshy or any generator.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {writeMeshGlb} from './lib/glb.mjs';

const TOOL_VERSION = 'ammo-boxes-1';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TASK_ID = 'studio-knife-melee-20261030-01';
const TASK = path.join(REPO, 'reference/tasks/knife-melee-20261030');
const ASSETS = path.join(TASK, 'assets');
const DELIVERED = path.join(ASSETS, 'DELIVERED.json');
const MANIFEST = path.join(ASSETS, 'manifest.json');
const MODELS_DIR = path.join(REPO, 'game/public/assets/models');
const PROV = path.join(REPO, 'game/public/assets/derivatives/meshy-t25-ammo-20261030.json');

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = arg('--only')?.split(',') ?? null;
const dev = args.includes('--dev');
const outDir = arg('--out-dir');
const log = (...a) => console.log(...a);
const r6 = v => Math.round(v * 1e6) / 1e6, r4 = v => Math.round(v * 1e4) / 1e4, r3 = v => Math.round(v * 1e3) / 1e3;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const rel = f => path.relative(REPO, f);

/** Items class budget (build-meshy-t25.mjs consumable items): ~3k tris (Meshy's own topology kept), 512 / 256 / 256 px, JPEG. */
const BASE_BUDGET = {tris: 3200, color: 512, mr: 256, normal: 256, bytes: 240_000, rule: 'consumable item class (build-meshy-t25.mjs): ~3k tris (native smart topology kept, no simplification), 512 px colour, 256 px MR / normal, JPEG'};

/**
 * Per box: runtime file, item, orientation (quarter turns about +Y, rotYQuarter) and the uniform scale rule (runtime axis 0 = X / w,
 * 1 = Y / h, 2 = Z / d to `m` metres). Sizes: a little larger than the real boxes (pickup readability) and every one <= 0.176 m tall
 * so it fits the 0.18 m clearance of desk drawers / low cupboard tiers (items/lootLayout.ts: height + 4 mm <= clear).
 */
const BOXES = {
  'ammo-9mm': {code: 'M1', itemId: 'ammo_9mm', caliber: '9x19mm', file: 'ammo-9mm-t25.glb', yawQuarter: 1, scale: {axis: 2, m: 0.13},
    orientReason: 'the clean printed "9MM" carton end is native +X (primary review): one quarter turn (+X -> +Z) makes it the pickup / shelf front; the carton then runs front-to-back like boxes stocked on a shelf',
    sizeReason: 'carton length 0.13 m (a 50-round 9mm box is ~0.12 m; slightly larger for readability); the open lid flap makes it ~0.13 m tall'},
  'ammo-556': {code: 'M2', itemId: 'ammo_556', caliber: '5.56x45mm', file: 'ammo-556-t25.glb', yawQuarter: 0, scale: {axis: 1, m: 0.175}, stencil: true,
    orientReason: 'native front (+Z) already shows the stencilled panel',
    sizeReason: 'a compact steel ammo can 0.175 m tall incl. the folded handle (fits the 0.18 m drawer / low-tier clearance), ~0.165 m wide, ~0.076 m deep'},
  'ammo-12ga': {code: 'M3', itemId: 'ammo_12ga', caliber: '12ga', file: 'ammo-12ga-t25.glb', yawQuarter: 0, scale: {axis: 0, m: 0.13},
    budget: {color: 1024, bytes: 420_000, reason: 'M3 colour 1024 px: its UV islands are packed tightly, so at 512 px the red shells bleed into the carton as pink seams (review sheet)'},
    orientReason: 'native front (+Z) shows the "12 Gauge" print and the open top with the red shells',
    sizeReason: 'carton 0.13 m wide (a 25-shell 12-gauge box is ~0.11 m); the lid flap standing open at the back makes it ~0.16 m tall'},
};

// ---- mesh I/O ------------------------------------------------------------------------------------------------------------
async function readMesh(bytes) {
  const doc = await new NodeIO().readBinary(new Uint8Array(bytes));
  const prims = [];
  for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (m) for (const p of m.listPrimitives()) prims.push({p, M: n.getWorldMatrix()}); }
  if (prims.length !== 1) throw new Error(`expected one mesh primitive, found ${prims.length}`);
  const {p, M} = prims[0];
  if (p.getMode() !== 4) throw new Error('triangles only');
  const P0 = p.getAttribute('POSITION').getArray(), N0 = p.getAttribute('NORMAL').getArray(), UV = Float32Array.from(p.getAttribute('TEXCOORD_0').getArray());
  const idx = p.getIndices(), I = idx ? Uint32Array.from(idx.getArray()) : Uint32Array.from({length: P0.length / 3}, (_, i) => i);
  const P = new Float32Array(P0.length), N = new Float32Array(P0.length);
  for (let i = 0; i < P0.length; i += 3) {
    const x = P0[i], y = P0[i + 1], z = P0[i + 2], a = N0[i], b = N0[i + 1], c = N0[i + 2];
    P[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
    N[i] = M[0] * a + M[4] * b + M[8] * c; N[i + 1] = M[1] * a + M[5] * b + M[9] * c; N[i + 2] = M[2] * a + M[6] * b + M[10] * c;
  }
  const mat = p.getMaterial();
  const tex = t => (t ? {bytes: Buffer.from(t.getImage()), mime: t.getMimeType(), size: t.getSize()} : null);
  return {P, N, UV, I, material: {metallicFactor: mat?.getMetallicFactor() ?? 1, roughnessFactor: mat?.getRoughnessFactor() ?? 1, color: tex(mat?.getBaseColorTexture()), mr: tex(mat?.getMetallicRoughnessTexture()), normal: tex(mat?.getNormalTexture())}};
}
const decodeRGB = async bytes => { const {data, info} = await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, ch: 3}; };
const rawPng = (t) => sharp(t.data, {raw: {width: t.width, height: t.height, channels: 3}}).png({compressionLevel: 1}).toBuffer();

const rotYQuarter = q => [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]][((q % 4) + 4) % 4];
const apply = (P, R, s = 1, t = [0, 0, 0]) => {
  const o = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = s * (R[k][0] * P[i] + R[k][1] * P[i + 1] + R[k][2] * P[i + 2]) + t[k];
  return o;
};
function bbox(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { if (P[i + k] < min[k]) min[k] = P[i + k]; if (P[i + k] > max[k]) max[k] = P[i + k]; }
  return {min, max, size: max.map((v, k) => v - min[k]), center: max.map((v, k) => (v + min[k]) / 2)};
}
function meshStats(P, I) {
  // position-welded components + boundary (open) edges: an open shell (the 9mm carton's lid flap) renders double-sided
  const nv = P.length / 3, key = new Map(), weld = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${P[3 * v].toFixed(5)},${P[3 * v + 1].toFixed(5)},${P[3 * v + 2].toFixed(5)}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); weld[v] = w; }
  const edges = new Map();
  for (let f = 0; f < I.length; f += 3) {
    const a = weld[I[f]], b = weld[I[f + 1]], c = weld[I[f + 2]];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? `${u}_${v}` : `${v}_${u}`; edges.set(k, (edges.get(k) ?? 0) + 1); }
  }
  let boundary = 0, nonManifold = 0; for (const n of edges.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  return {boundaryEdges: boundary, nonManifoldEdges: nonManifold, edges: edges.size};
}

// ---- orthographic rasteriser (review sheets + the stencil projection) ----------------------------------------------------
const VIEWS = {front: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], right: [[0, 0, -1], [0, 1, 0], [1, 0, 0]], back: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], left: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]};
const norm3 = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
function viewYawPitch(yawDeg, pitchDeg) {
  const a = yawDeg * Math.PI / 180, b = pitchDeg * Math.PI / 180;
  const toward = [Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)];
  const right = norm3(cross3([0, 1, 0], toward)), up = cross3(toward, right);
  return [right, up, toward];
}
/** Orthographic z-buffered textured raster (RGBA). `frame` {cx, cy, s} fixes the mapping (s = px per unit). */
function rasterize(P, I, UV, tex, V, W, H, {shade = true, frame = null, bg = null, margin = 0.06} = {}) {
  const n = P.length / 3, X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = P[3 * i], py = P[3 * i + 1], pz = P[3 * i + 2];
    X[i] = V[0][0] * px + V[0][1] * py + V[0][2] * pz; Y[i] = V[1][0] * px + V[1][1] * py + V[1][2] * pz; Z[i] = V[2][0] * px + V[2][1] * py + V[2][2] * pz;
    x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); y0 = Math.min(y0, Y[i]); y1 = Math.max(y1, Y[i]);
  }
  const fr = frame ?? {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: Math.min(W, H) * (1 - 2 * margin) / Math.max(x1 - x0, y1 - y0, 1e-9)};
  const zb = new Float32Array(W * H).fill(-Infinity), out = Buffer.alloc(W * H * 4), face = new Int32Array(W * H).fill(-1);
  if (bg) for (let k = 0; k < W * H; k++) { out[4 * k] = bg[0]; out[4 * k + 1] = bg[1]; out[4 * k + 2] = bg[2]; out[4 * k + 3] = 255; }
  const sx = i => (X[i] - fr.cx) * fr.s + W / 2, sy = i => H / 2 - (Y[i] - fr.cy) * fr.s;
  for (let f = 0; f < I.length / 3; f++) {
    const a = I[3 * f], b = I[3 * f + 1], c = I[3 * f + 2];
    const ax = sx(a), ay = sy(a), bx = sx(b), by = sy(b), cx = sx(c), cy = sy(c);
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    const xa = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xb = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))), ya = Math.max(0, Math.floor(Math.min(ay, by, cy))), yb = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    if (xa > xb || ya > yb) continue;
    const ux = X[b] - X[a], uy = Y[b] - Y[a], uz = Z[b] - Z[a], vx = X[c] - X[a], vy = Y[c] - Y[a], vz = Z[c] - Z[a];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
    const L = shade ? 0.38 + 0.62 * Math.max(Math.abs(nz / nl) * 0.85 + (ny / nl) * 0.15 * Math.sign(nz || 1), 0) : 1;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * Z[a] + w1 * Z[b] + w2 * Z[c], k = y * W + x; if (z <= zb[k]) continue; zb[k] = z; face[k] = f;
      const u = w0 * UV[2 * a] + w1 * UV[2 * b] + w2 * UV[2 * c], v = w0 * UV[2 * a + 1] + w1 * UV[2 * b + 1] + w2 * UV[2 * c + 1];
      const tx = Math.min(tex.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.width))), ty = Math.min(tex.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.height))), o = tex.ch * (ty * tex.width + tx);
      out[4 * k] = Math.min(255, tex.data[o] * L); out[4 * k + 1] = Math.min(255, tex.data[o + 1] * L); out[4 * k + 2] = Math.min(255, tex.data[o + 2] * L); out[4 * k + 3] = 255;
    }
  }
  return {data: out, width: W, height: H, frame: fr, face, zb};
}

// ---- deterministic noise -------------------------------------------------------------------------------------------------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- STENCIL local repair (M2) --------------------------------------------------------------------------------------------
/** Generated stencil yellow (worn): warm, saturated, blue well below red. */
const isYellow = (r, g, b) => r > 105 && g > 70 && b < 0.5 * r && r - b > 70 && g < 0.98 * r && g > 0.45 * r;

/** Push-pull fill of masked pixels (mask 1 = unknown) from the known ones (smooth, hole-free at every size). */
function pushPull(rgb, mask, W, H) {
  const levels = [{rgb: Float32Array.from(rgb), w: Float32Array.from(mask, m => (m ? 0 : 1)), W, H}];
  while (levels[levels.length - 1].W > 1 || levels[levels.length - 1].H > 1) {
    const L = levels[levels.length - 1], W2 = Math.max(1, Math.ceil(L.W / 2)), H2 = Math.max(1, Math.ceil(L.H / 2));
    const c = new Float32Array(W2 * H2 * 3), w = new Float32Array(W2 * H2);
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
      const k = y * L.W + x, k2 = (y >> 1) * W2 + (x >> 1), ww = L.w[k];
      if (!ww) continue;
      w[k2] += ww; for (let j = 0; j < 3; j++) c[3 * k2 + j] += L.rgb[3 * k + j] * ww;
    }
    for (let k = 0; k < W2 * H2; k++) if (w[k] > 0) { for (let j = 0; j < 3; j++) c[3 * k + j] /= w[k]; w[k] = Math.min(1, w[k]); }
    levels.push({rgb: c, w, W: W2, H: H2});
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
      const k = y * L.W + x;
      if (L.w[k] >= 1) continue;
      // bilinear sample of the coarser level at this pixel's centre
      const fx = Math.min(U.W - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(U.H - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(U.W - 1, x0 + 1), y1 = Math.min(U.H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      for (let j = 0; j < 3; j++) {
        const s = (1 - ty) * ((1 - tx) * U.rgb[3 * (y0 * U.W + x0) + j] + tx * U.rgb[3 * (y0 * U.W + x1) + j]) + ty * ((1 - tx) * U.rgb[3 * (y1 * U.W + x0) + j] + tx * U.rgb[3 * (y1 * U.W + x1) + j]);
        L.rgb[3 * k + j] = L.w[k] * L.rgb[3 * k + j] + (1 - L.w[k]) * s;
      }
      L.w[k] = 1;
    }
  }
  return levels[0].rgb;
}

/** Morphological dilation of a 0/1 mask by r px (square). */
function dilate(mask, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) out[Y * W + X] = 1; }
  }
  return out;
}

/**
 * Repair one panel (`side` 'front' = +Z face, 'back' = -Z face) of the base colour (and flatten the normal map's embossed stencil).
 * Mutates color / normal (2048 RGB). Returns the record of what was done.
 */
function repairPanel(mesh, color, normal, side, seed) {
  const {P, I, UV} = mesh, T = color.width, V = side === 'front' ? VIEWS.front : VIEWS.back, sgn = side === 'front' ? 1 : -1;
  // 1) atlas texels of this panel: rasterise every triangle in UV space; keep those facing the view on the panel plane
  const nT = I.length / 3, faceN = new Float32Array(nT * 3);
  let zPanel = -Infinity;
  for (let f = 0; f < nT; f++) {
    const a = I[3 * f], b = I[3 * f + 1], c = I[3 * f + 2];
    const u = [0, 1, 2].map(k => P[3 * b + k] - P[3 * a + k]), v = [0, 1, 2].map(k => P[3 * c + k] - P[3 * a + k]), n = norm3(cross3(u, v));
    faceN.set(n, 3 * f);
    if (n[2] * sgn > 0.9) zPanel = Math.max(zPanel, sgn * (P[3 * a + 2] + P[3 * b + 2] + P[3 * c + 2]) / 3);
  }
  const covered = new Uint8Array(T * T);             // any triangle covers the texel (gutters are 0)
  const panelPos = new Float32Array(T * T * 2).fill(NaN); // view-plane (X, Y) of the panel texels
  for (let f = 0; f < nT; f++) {
    const ids = [I[3 * f], I[3 * f + 1], I[3 * f + 2]];
    const tx = ids.map(i => UV[2 * i] * T - 0.5), ty = ids.map(i => UV[2 * i + 1] * T - 0.5);
    const onPanel = faceN[3 * f + 2] * sgn > 0.85 && ids.every(i => sgn * P[3 * i + 2] > zPanel - 0.05);
    const den = (ty[1] - ty[2]) * (tx[0] - tx[2]) + (tx[2] - tx[1]) * (ty[0] - ty[2]); if (Math.abs(den) < 1e-12) continue;
    const xa = Math.max(0, Math.floor(Math.min(...tx))), xb = Math.min(T - 1, Math.ceil(Math.max(...tx))), ya = Math.max(0, Math.floor(Math.min(...ty))), yb = Math.min(T - 1, Math.ceil(Math.max(...ty)));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const w0 = ((ty[1] - ty[2]) * (x - tx[2]) + (tx[2] - tx[1]) * (y - ty[2])) / den, w1 = ((ty[2] - ty[0]) * (x - tx[2]) + (tx[0] - tx[2]) * (y - ty[2])) / den, w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      const k = y * T + x; covered[k] = 1;
      if (!onPanel) continue;
      const p = [0, 1, 2].map(j => w0 * P[3 * ids[0] + j] + w1 * P[3 * ids[1] + j] + w2 * P[3 * ids[2] + j]);
      panelPos[2 * k] = V[0][0] * p[0] + V[0][1] * p[1] + V[0][2] * p[2]; panelPos[2 * k + 1] = V[1][0] * p[0] + V[1][1] * p[1] + V[1][2] * p[2];
    }
  }
  // 2) the stencil's extent on this panel = the yellow panel texels
  let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity, nYellow = 0;
  for (let k = 0; k < T * T; k++) {
    if (Number.isNaN(panelPos[2 * k])) continue;
    if (!isYellow(color.data[3 * k], color.data[3 * k + 1], color.data[3 * k + 2])) continue;
    nYellow++; sx0 = Math.min(sx0, panelPos[2 * k]); sx1 = Math.max(sx1, panelPos[2 * k]); sy0 = Math.min(sy0, panelPos[2 * k + 1]); sy1 = Math.max(sy1, panelPos[2 * k + 1]);
  }
  if (nYellow < 500) throw new Error(`${side}: no stencil found (${nYellow} yellow texels)`);
  const pad = 0.25 * Math.max(sx1 - sx0, sy1 - sy0);
  const rect = {x0: sx0 - pad, x1: sx1 + pad, y0: sy0 - pad, y1: sy1 + pad};
  // 3) project the panel (unshaded) into a decal image over rect
  const PX = 1400; // decal px per model unit (>= the atlas density on this panel)
  const DW = Math.ceil((rect.x1 - rect.x0) * PX), DH = Math.ceil((rect.y1 - rect.y0) * PX);
  const frame = {cx: (rect.x0 + rect.x1) / 2, cy: (rect.y0 + rect.y1) / 2, s: PX};
  const proj = rasterize(P, I, UV, color, V, DW, DH, {shade: false, frame});
  const rgb = new Float32Array(DW * DH * 3), hole = new Uint8Array(DW * DH), yellow = new Uint8Array(DW * DH);
  for (let k = 0; k < DW * DH; k++) {
    const f = proj.face[k];
    if (f < 0 || faceN[3 * f + 2] * sgn < 0.85) { hole[k] = 1; continue; }
    const r = proj.data[4 * k], g = proj.data[4 * k + 1], b = proj.data[4 * k + 2];
    rgb[3 * k] = r; rgb[3 * k + 1] = g; rgb[3 * k + 2] = b;
    if (isYellow(r, g, b)) yellow[k] = 1;
  }
  const oldMask = dilate(yellow, DW, DH, 7); // 7 px (0.5 % of the can) also takes the dark halo Meshy painted round the stencil
  const debug = process.env.AMMO_DEBUG_DIR;
  const dump = (name, f) => { if (!debug) return; const b = Buffer.alloc(DW * DH * 3); for (let k = 0; k < DW * DH; k++) f(k, b); void sharp(b, {raw: {width: DW, height: DH, channels: 3}}).png().toFile(path.join(debug, `${side}-${name}.png`)); };
  dump('projected', (k, b) => { b[3 * k] = rgb[3 * k]; b[3 * k + 1] = rgb[3 * k + 1]; b[3 * k + 2] = rgb[3 * k + 2]; });
  dump('mask', (k, b) => { b[3 * k] = yellow[k] * 255; b[3 * k + 1] = hole[k] * 255; b[3 * k + 2] = oldMask[k] * 120; });
  // 4) segment the old stencil into its three digits ("5", "1", "6"): the "1" and "6" touch, so split at the least-occupied column
  //    (3-column smoothed) inside the expected bands of the "516" width (5 | 1: 30-50 %, 1 | 6: 52-74 %)
  let gx0 = DW, gx1 = -1, gy0 = DH, gy1 = -1;
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) if (yellow[y * DW + x]) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); }
  const colCount = new Int32Array(DW);
  for (let y = gy0; y <= gy1; y++) for (let x = gx0; x <= gx1; x++) if (yellow[y * DW + x]) colCount[x]++;
  const smooth = x => colCount[x - 1] + colCount[x] + colCount[x + 1];
  const splitIn = (f0, f1) => { let best = -1, bv = Infinity; for (let x = Math.round(gx0 + f0 * (gx1 - gx0)); x <= Math.round(gx0 + f1 * (gx1 - gx0)); x++) { const v = smooth(x); if (v < bv) { bv = v; best = x; } } return {x: best, occupancy: bv}; };
  const s1 = splitIn(0.3, 0.5), s2 = splitIn(0.52, 0.74);
  const groups = [[gx0, s1.x - 1], [s1.x + 1, s2.x - 1], [s2.x + 1, gx1]];
  if (s1.occupancy > 0.25 * 3 * (gy1 - gy0) || s2.occupancy > 0.25 * 3 * (gy1 - gy0)) throw new Error(`${side}: no clean split between the "516" glyphs`);
  const glyph = ([a, b]) => {
    let y0 = DH, y1 = -1;
    for (let y = gy0; y <= gy1; y++) for (let x = a; x <= b; x++) if (yellow[y * DW + x]) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return {x0: a, x1: b, y0, y1, w: b - a + 1, h: y1 - y0 + 1};
  };
  const [g5, g1, g6] = groups.map(glyph);
  const spacing = Math.max(Math.round(((g1.x0 - g5.x1) + (g6.x0 - g1.x1)) / 2), Math.round(0.07 * g5.w));
  // 5) fill the old stencil from the surrounding paint (holes off the panel stay unknown too), then seeded grain
  const unknown = new Uint8Array(DW * DH);
  for (let k = 0; k < DW * DH; k++) unknown[k] = oldMask[k] || hole[k] ? 1 : 0;
  const filled = pushPull(rgb, unknown, DW, DH);
  // grain: the panel's own luminance variation (std of the known paint near the stencil), seeded
  let sum = 0, sum2 = 0, cnt = 0;
  for (let y = gy0; y <= gy1; y++) for (let x = Math.max(0, gx0 - 40); x <= Math.min(DW - 1, gx1 + 40); x++) {
    const k = y * DW + x; if (unknown[k]) continue;
    const l = 0.299 * rgb[3 * k] + 0.587 * rgb[3 * k + 1] + 0.114 * rgb[3 * k + 2]; sum += l; sum2 += l * l; cnt++;
  }
  const std = cnt ? Math.sqrt(Math.max(0, sum2 / cnt - (sum / cnt) ** 2)) : 4;
  const rnd = mulberry32(seed);
  const out = new Float32Array(DW * DH * 3);
  for (let k = 0; k < DW * DH; k++) {
    if (!oldMask[k] || hole[k]) { out[3 * k] = rgb[3 * k]; out[3 * k + 1] = rgb[3 * k + 1]; out[3 * k + 2] = rgb[3 * k + 2]; continue; }
    const n = (rnd() + rnd() - 1) * Math.min(10, std) * 0.9;
    for (let j = 0; j < 3; j++) out[3 * k + j] = filled[3 * k + j] + n;
  }
  // 6) compose "5.56" from the generated glyphs: 5 . 5 6 (the dot = a square cut from the "1" stem's foot)
  const dotW = Math.max(6, Math.round(Math.min(g1.w, 0.3 * g5.w))), dotH = dotW;
  // the "1" stem: the densest columns of its glyph
  let best = g1.x0, bestN = -1;
  for (let x = g1.x0; x <= g1.x1 - dotW + 1; x++) { let n = 0; for (let xx = x; xx < x + dotW; xx++) for (let y = g1.y1 - dotH + 1; y <= g1.y1; y++) n += yellow[y * DW + xx]; if (n > bestN) { bestN = n; best = x; } }
  const dot = {x0: best, x1: best + dotW - 1, y0: g1.y1 - dotH + 1, y1: g1.y1, w: dotW, h: dotH};
  const seq = [g5, dot, g5, g6];
  const totalW = seq.reduce((s, g) => s + g.w, 0) + spacing * (seq.length - 1);
  const oldW = g6.x1 - g5.x0 + 1;
  // keep the stencil inside the panel: at most ~22 % wider than "516"; condense horizontally beyond that (stencil fonts run narrow)
  const maxW = Math.round(oldW * 1.18), kx = Math.min(1, maxW / totalW);
  const cxOld = (g5.x0 + g6.x1) / 2;
  let penX = cxOld - (totalW * kx) / 2;
  const baseY = Math.max(g5.y1, g6.y1);
  const alphaOf = (x, y) => { // soft glyph alpha from the yellow mask (1 px feather)
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue; s += yellow[Y * DW + X]; n++; }
    return n ? s / n : 0;
  };
  const placed = [];
  for (const g of seq) {
    const dw = Math.max(1, Math.round(g.w * kx)), top = baseY - (g.y1 - g.y0); // bottom-aligned (the dot sits on the baseline)
    const ox = Math.round(penX);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < dw; x++) {
      const sxp = g.x0 + Math.min(g.w - 1, Math.floor((x + 0.5) / kx)), syp = g.y0 + y;
      const a = alphaOf(sxp, syp);
      if (a <= 0) continue;
      const X = ox + x, Y = top + y;
      if (X < 0 || Y < 0 || X >= DW || Y >= DH) continue;
      const kS = syp * DW + sxp, kD = Y * DW + X;
      for (let j = 0; j < 3; j++) out[3 * kD + j] = (1 - a) * out[3 * kD + j] + a * rgb[3 * kS + j];
    }
    placed.push({x0: ox, x1: ox + dw - 1, y0: top, y1: top + g.h - 1});
    penX += (g.w + spacing) * kx;
  }
  dump('result', (k, b) => { b[3 * k] = Math.max(0, Math.min(255, out[3 * k])); b[3 * k + 1] = Math.max(0, Math.min(255, out[3 * k + 1])); b[3 * k + 2] = Math.max(0, Math.min(255, out[3 * k + 2])); });
  // 7) write back to every panel texel inside rect (bilinear from the decal); flatten the normal map's old "516" relief
  const changed = new Uint8Array(T * T);
  let written = 0, flattened = 0;
  const sample = (buf, fx, fy, j) => {
    const x0 = Math.max(0, Math.min(DW - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(DH - 1, Math.floor(fy))), x1 = Math.min(DW - 1, x0 + 1), y1 = Math.min(DH - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
    return (1 - ty) * ((1 - tx) * buf[3 * (y0 * DW + x0) + j] + tx * buf[3 * (y0 * DW + x1) + j]) + ty * ((1 - tx) * buf[3 * (y1 * DW + x0) + j] + tx * buf[3 * (y1 * DW + x1) + j]);
  };
  for (let k = 0; k < T * T; k++) {
    const X = panelPos[2 * k], Y = panelPos[2 * k + 1];
    if (Number.isNaN(X) || X < rect.x0 || X > rect.x1 || Y < rect.y0 || Y > rect.y1) continue;
    const fx = (X - frame.cx) * PX + DW / 2 - 0.5, fy = DH / 2 - (Y - frame.cy) * PX - 0.5;
    const ix = Math.round(fx), iy = Math.round(fy);
    if (ix < 0 || iy < 0 || ix >= DW || iy >= DH || hole[iy * DW + ix]) continue;
    for (let j = 0; j < 3; j++) color.data[3 * k + j] = Math.max(0, Math.min(255, Math.round(sample(out, fx, fy, j))));
    changed[k] = 1; written++;
    if (oldMask[iy * DW + ix]) { normal.data[3 * k] = 128; normal.data[3 * k + 1] = 128; normal.data[3 * k + 2] = 255; flattened++; changed[k] = 2; }
  }
  // 8) bleed 3 px into the atlas gutters next to rewritten texels (no old yellow at island edges under bilinear / mip sampling)
  let bled = 0;
  for (let it = 0; it < 3; it++) {
    const add = [];
    for (let y = 1; y < T - 1; y++) for (let x = 1; x < T - 1; x++) {
      const k = y * T + x; if (covered[k] || changed[k]) continue;
      let n = 0; const acc = [0, 0, 0], accN = [0, 0, 0]; let nN = 0;
      for (const d of [-1, 1, -T, T]) if (changed[k + d]) { n++; for (let j = 0; j < 3; j++) acc[j] += color.data[3 * (k + d) + j]; if (changed[k + d] === 2) { nN++; for (let j = 0; j < 3; j++) accN[j] += normal.data[3 * (k + d) + j]; } }
      if (n) add.push([k, acc.map(v => Math.round(v / n)), nN ? accN.map(v => Math.round(v / nN)) : null]);
    }
    for (const [k, c, nn] of add) { color.data.set(c, 3 * k); if (nn) normal.data.set(nn, 3 * k); changed[k] = nn ? 2 : 1; bled++; }
  }
  const toModel = d => r4(d / PX);
  return {
    side, view: side === 'front' ? '+Z panel (front view)' : '-Z panel (back view, mirrored X so it reads from behind)',
    oldStencil: {yellowAtlasTexels: nYellow, extentNative: {x: [r4(sx0), r4(sx1)], y: [r4(sy0), r4(sy1)]}, glyphs: ['5', '1', '6'].map((c, i) => ({char: c, wNative: toModel([g5, g1, g6][i].w), hNative: toModel([g5, g1, g6][i].h)}))},
    newStencil: {text: '5.56', from: 'the generated stencil\'s own glyphs: "5" (x2), "6", dot = a square cut from the foot of the "1"', horizontalScale: r4(kx), widthVsOld: r4(totalW * kx / oldW),
      glyphBoxesDecalPx: placed},
    decal: {pxPerUnit: PX, size: [DW, DH], rectNative: {x0: r4(rect.x0), x1: r4(rect.x1), y0: r4(rect.y0), y1: r4(rect.y1)}, grainStd: r3(Math.min(10, std) * 0.9), seed},
    atlas: {texelsRewritten: written, normalTexelsFlattened: flattened, gutterTexelsBled: bled},
  };
}

// ---- atlas coverage + edge padding ----------------------------------------------------------------------------------------
/** 1 = a triangle covers the texel (UV-space raster at T px; texel centres). */
function coverage(UV, I, T) {
  const cov = new Uint8Array(T * T);
  for (let f = 0; f < I.length / 3; f++) {
    const ids = [I[3 * f], I[3 * f + 1], I[3 * f + 2]];
    const tx = ids.map(i => UV[2 * i] * T - 0.5), ty = ids.map(i => UV[2 * i + 1] * T - 0.5);
    const den = (ty[1] - ty[2]) * (tx[0] - tx[2]) + (tx[2] - tx[1]) * (ty[0] - ty[2]); if (Math.abs(den) < 1e-12) continue;
    const xa = Math.max(0, Math.floor(Math.min(...tx))), xb = Math.min(T - 1, Math.ceil(Math.max(...tx))), ya = Math.max(0, Math.floor(Math.min(...ty))), yb = Math.min(T - 1, Math.ceil(Math.max(...ty)));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const w0 = ((ty[1] - ty[2]) * (x - tx[2]) + (tx[2] - tx[1]) * (y - ty[2])) / den, w1 = ((ty[2] - ty[0]) * (x - tx[2]) + (tx[0] - tx[2]) * (y - ty[2])) / den, w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) cov[y * T + x] = 1;
    }
  }
  return cov;
}
/** Gutter texels take the average of already-known 4-neighbours, pass by pass (16 passes), the rest a push-pull fill. */
function padIslands(img, cov, passes = 16) {
  const T = img.width, known = Uint8Array.from(cov), d = img.data;
  for (let it = 0; it < passes; it++) {
    const add = [];
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const k = y * T + x; if (known[k]) continue;
      let n = 0, r = 0, g = 0, b = 0;
      if (x > 0 && known[k - 1]) { n++; r += d[3 * (k - 1)]; g += d[3 * (k - 1) + 1]; b += d[3 * (k - 1) + 2]; }
      if (x < T - 1 && known[k + 1]) { n++; r += d[3 * (k + 1)]; g += d[3 * (k + 1) + 1]; b += d[3 * (k + 1) + 2]; }
      if (y > 0 && known[k - T]) { n++; r += d[3 * (k - T)]; g += d[3 * (k - T) + 1]; b += d[3 * (k - T) + 2]; }
      if (y < T - 1 && known[k + T]) { n++; r += d[3 * (k + T)]; g += d[3 * (k + T) + 1]; b += d[3 * (k + T) + 2]; }
      if (n) add.push(k, Math.round(r / n), Math.round(g / n), Math.round(b / n));
    }
    for (let i = 0; i < add.length; i += 4) { const k = add[i]; d[3 * k] = add[i + 1]; d[3 * k + 1] = add[i + 2]; d[3 * k + 2] = add[i + 3]; known[k] = 1; }
  }
  const unknown = Uint8Array.from(known, v => (v ? 0 : 1));
  if (unknown.some(v => v)) { const f = pushPull(Float32Array.from(d), unknown, T, T); for (let k = 0; k < T * T; k++) if (unknown[k]) for (let j = 0; j < 3; j++) d[3 * k + j] = Math.max(0, Math.min(255, Math.round(f[3 * k + j]))); }
  return img;
}

// ---- textures -------------------------------------------------------------------------------------------------------------
async function resizeJpeg(bytes, size, q, kind) {
  const img = sharp(bytes).removeAlpha().resize(size, size, {fit: 'fill', kernel: 'lanczos3'});
  return {mime: 'image/jpeg', ext: 'jpg', bytes: await img.jpeg({quality: q, chromaSubsampling: kind === 'color' ? '4:2:0' : '4:4:4', mozjpeg: true}).toBuffer(), size: [size, size]};
}

// ---- build one --------------------------------------------------------------------------------------------------------------
async function buildOne(id, cfg, del, man, {glbOut, reviewOut}) {
  const t0 = Date.now();
  const BUDGET = cfg.budget ? {...BASE_BUDGET, ...cfg.budget, rule: `${BASE_BUDGET.rule}; ${cfg.budget.reason}`} : BASE_BUDGET;
  const nativeAbs = del.nativeGlb;
  const nativeBytes = fs.readFileSync(nativeAbs), nativeSha = sha256(nativeBytes);
  if (nativeSha !== del.sha256) throw new Error(`${id}: native sha256 mismatch (${nativeSha} != delivered ${del.sha256})`);
  log(`\n== ${id} (${cfg.code}, ${cfg.caliber}) <- ${rel(nativeAbs)} (refine ${del.refineTaskId})`);
  const nat = await readMesh(nativeBytes);
  if (!nat.material.color || !nat.material.mr || !nat.material.normal) throw new Error(`${id}: native lacks a PBR map`);
  const natBB = bbox(nat.P), natTris = nat.I.length / 3;
  if (natTris > BUDGET.tris) throw new Error(`${id}: ${natTris} tris over the ${BUDGET.tris} item budget`);
  // orient + uniform scale + ground (bottom-centre)
  const R = rotYQuarter(cfg.yawQuarter);
  const P1 = apply(nat.P, R), b1 = bbox(P1);
  const s = cfg.scale.m / b1.size[cfg.scale.axis];
  const t = [-s * b1.center[0], -s * b1.min[1], -s * b1.center[2]];
  const P = apply(nat.P, R, s, t), N = apply(nat.N, R, 1);
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  const outBB = bbox(P);
  const stats = meshStats(P, nat.I);
  const doubleSided = stats.boundaryEdges > 0.01 * stats.edges;
  // textures (+ M2 stencil repair on the 2048 maps)
  let colorBytes = nat.material.color.bytes, normalBytes = nat.material.normal.bytes, repair = null;
  if (cfg.stencil) {
    const color = await decodeRGB(colorBytes), normal = await decodeRGB(normalBytes);
    if (color.width !== color.height || normal.width !== color.width) throw new Error(`${id}: expected square, equal colour / normal maps`);
    const mesh = {P: nat.P, I: nat.I, UV: nat.UV}; // native frame: the stencilled panels face +Z / -Z
    const panels = [repairPanel(mesh, color, normal, 'front', 0x55a6), repairPanel(mesh, color, normal, 'back', 0x55b6)];
    colorBytes = await rawPng(color); normalBytes = await rawPng(normal);
    repair = {kind: 'LOCAL texture repair (not Meshy output)', reason: 'Meshy painted the can\'s stencil as "516" (front and back panels; primary review) instead of the 5.56 caliber. Authorized by the task: "locally corrected typography / decals are fine if generated text is poor".',
      method: 'object-space panel projection: yellow stencil masked (colour rule) + dilated 7 px (its dark halo too), filled from the surrounding paint (push-pull inpainting + seeded grain at the panel\'s own luminance spread), "5.56" composed from the generated stencil\'s own glyphs, written back to every atlas texel of the panel (face normal toward the view, on the panel plane; bilinear from the decal) + a 3 px gutter bleed; the embossed "516" relief in the normal map flattened (128,128,255) inside the old mask. Metallic-roughness unchanged. Base colour / normal edited at 2048 px before downsizing.',
      colorRule: isYellow.toString(), panels,
      inputs: {baseColorSha256: sha256(nat.material.color.bytes), normalSha256: sha256(nat.material.normal.bytes)},
      outputs2048: {baseColorPngSha256: sha256(colorBytes), normalPngSha256: sha256(normalBytes)}};
    for (const p of panels) log(`  stencil ${p.side}: ${p.oldStencil.yellowAtlasTexels} yellow texels -> "5.56" (x-scale ${p.newStencil.horizontalScale}, ${p.atlas.texelsRewritten} texels rewritten, ${p.atlas.normalTexelsFlattened} normals flattened)`);
  }
  // Edge padding (all maps, every box): atlas gutters take the colour of the nearest island texel (16 dilation passes = 4 px at
  // 512, then push-pull), so downsizing / mip filtering never mixes a neighbouring island (red shells, carton print) into an edge.
  const T0 = nat.material.color.size[0];
  const cov = coverage(nat.UV, nat.I, T0);
  const padded = {};
  for (const [k, bytes] of [['color', colorBytes], ['mr', nat.material.mr.bytes], ['normal', normalBytes]]) {
    const img = await decodeRGB(bytes);
    if (img.width !== T0 || img.height !== T0) throw new Error(`${id}: ${k} map is not ${T0} px`);
    padded[k] = await rawPng(padIslands(img, cov));
  }
  const coveredPct = r3(100 * cov.reduce((a, v) => a + v, 0) / cov.length);
  const tiers = [[86, 88, 90], [80, 82, 86], [74, 76, 82], [66, 70, 76]];
  let glb, textures, tierUsed;
  const status = 'prototype runtime derivative of a Meshy T2.5 text-to-3D output (preview meshy-t2.5 smart-topology + 2K PBR refine; primary review: accepted); no license clearance asserted';
  for (const [qc, qm, qn] of tiers) {
    textures = {color: await resizeJpeg(padded.color, BUDGET.color, qc, 'color'), orm: await resizeJpeg(padded.mr, BUDGET.mr, qm, 'mr'), normal: await resizeJpeg(padded.normal, BUDGET.normal, qn, 'normal')};
    const extras = {sourceId: id, itemId: cfg.itemId, caliber: cfg.caliber, meshyPreviewTaskId: del.previewTaskId, meshyRefineTaskId: del.refineTaskId, nativeSha256: nativeSha, units: 'meters', front: '+Z', up: '+Y', origin: 'bottom-centre (y = 0 floor contact)', status, ...(repair ? {localRepair: 'stencil "516" -> "5.56" (base colour + normal map, see provenance)'} : {}), pipeline: 'tools/asset-pipeline/props/build-ammo-boxes.mjs'};
    glb = await writeMeshGlb({name: path.basename(cfg.file, '.glb'), mesh: {pos: P, nrm: N, uv: nat.UV, idx: nat.I}, textures, material: {metallicFactor: nat.material.metallicFactor, roughnessFactor: nat.material.roughnessFactor}, doubleSided, extras});
    tierUsed = [qc, qm, qn];
    if (glb.length <= BUDGET.bytes) break;
  }
  const abs = path.resolve(glbOut);
  if (dev) { if (!outDir || !abs.startsWith(path.resolve(outDir) + path.sep)) throw new Error('dev mode writes only into --out-dir'); }
  else if (!(path.dirname(abs) === MODELS_DIR && /^ammo-[a-z0-9]+-t25\.glb$/.test(path.basename(abs)))) throw new Error(`refusing to write ${abs}`);
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs + '.tmp', glb); fs.renameSync(abs + '.tmp', abs);
  const gpu = Math.round(4 * 4 / 3 * (BUDGET.color ** 2 + BUDGET.mr ** 2 + BUDGET.normal ** 2));
  log(`  wrote ${rel(abs)} ${glb.length} B (budget ${BUDGET.bytes}), ${natTris} tris, ${outBB.size.map(v => v.toFixed(3)).join(' x ')} m (w x h x d), doubleSided ${doubleSided} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  let review = null;
  if (reviewOut) review = await reviewSheet(id, cfg, {nat, natTex: await decodeRGB(nat.material.color.bytes), P, I: nat.I, UV: nat.UV, tex: await decodeRGB(textures.color.bytes), dims: outBB.size}, reviewOut);
  const m = man.assets.find(a => a.code === cfg.code);
  return {
    id, code: cfg.code, itemId: cfg.itemId, caliber: cfg.caliber, modelKey: `item_${cfg.itemId}`,
    output: {path: rel(abs), url: `assets/models/${cfg.file}`, sha256: sha256(glb), bytes: glb.length, triangles: natTris, vertices: P.length / 3,
      textures: ['color', 'orm', 'normal'].map(k => ({slot: {color: 'baseColor', orm: 'metallicRoughness', normal: 'normal'}[k], size: textures[k].size, mime: textures[k].mime, bytes: textures[k].bytes.length})),
      gpuTextureBytesEstimate: gpu, edgePadding: {atlasCoveragePct: coveredPct, method: '16 dilation passes from the covered texels (4-neighbour average) + push-pull for the rest, at the native size, before the Lanczos downsize'}, doubleSided, dims: outBB.size.map(r4), bbox: {min: outBB.min.map(r4), max: outBB.max.map(r4)}, budget: {...BUDGET, overBudget: glb.length > BUDGET.bytes, jpegQuality: tierUsed}},
    meshy: {route: 'text-to-3D: preview (ai_model meshy-t2.5 explicit, model_type smart-topology, topology triangle, target_polycount 3000, glb) -> refine (texture_resolution 2k, enable_pbr; inherits the preview model)',
      previewTaskId: del.previewTaskId, refineTaskId: del.refineTaskId, credits: {preview: m?.cost?.preview ?? 5, refine: m?.cost?.refine ?? 10},
      prompt: m?.preview?.prompt ?? null, texturePrompt: m?.refine?.texture_prompt ?? null, submittedBy: 'task primary (sole submitter; assets/manifest.json, ledger.jsonl)',
      review: {status: del.status, note: del.review},
      nativeGlb: rel(nativeAbs), nativeSha256: nativeSha, nativeBytes: nativeBytes.length,
      native: {triangles: natTris, vertices: nat.P.length / 3, bbox: natBB.size.map(r4), textures: ['color', 'mr', 'normal'].map(k => ({slot: k, mime: nat.material[k].mime, size: nat.material[k].size, bytes: nat.material[k].bytes.length, sha256: sha256(nat.material[k].bytes)})), ...meshStats(nat.P, nat.I)}},
    transform: {description: 'p_out = s * Ryaw * p_native + t (baked into the vertices; node transform identity). Meshy native: +Y up, front +Z.', yawQuarter: cfg.yawQuarter, R, s: r6(s), t: t.map(r6),
      orient: cfg.orientReason, fit: `uniform: runtime ${['X (w)', 'Y (h)', 'Z (d)'][cfg.scale.axis]} = ${cfg.scale.m} m -> ${outBB.size.map(r4).join(' x ')} m (w x h x d)`, size: cfg.sizeReason,
      itemDims: `items/items.ts ITEM_DIMS.${cfg.itemId} = these dims (shape 'flat': rests upright); world/pickups.ts fitItemModel then keeps scale 1`},
    ...(repair ? {localRepair: repair} : {}),
    conventions: {units: 'meters', up: '+Y', front: '+Z', origin: 'bottom-centre (y = 0 floor contact; x/z bbox centre)'},
    replaces: {what: `the procedural ${cfg.itemId} supply box (world/pickups.ts legacySupplyMesh; kept as the fallback if the model fails to load)`},
    review: review ? rel(review) : null,
    limitations: [
      'Text-to-3D AI reconstruction (Meshy T2.5): printed graphics and small print are fictional AI designs (some fine print is gibberish).',
      ...(repair ? ['The 5.56 stencil is a LOCAL repair of the generated texture (not Meshy output); the old "516" relief is flattened in the normal map (the new digits are paint only).'] : []),
      'Prototype derivative: no commercial / model licence clearance asserted.',
    ],
    tool: TOOL_VERSION,
  };
}

// ---- review sheet: native front | runtime front, right, back, 3/4, above (runtime 512 px texture) ---------------------------------
async function reviewSheet(id, cfg, {nat, natTex, P, I, UV, tex, dims}, out) {
  const N = 256, bg = [52, 52, 52], tiles = [], labels = [];
  const toRGB = img => { const rgb = Buffer.alloc(N * N * 3); for (let i = 0; i < N * N; i++) { rgb[3 * i] = img.data[4 * i]; rgb[3 * i + 1] = img.data[4 * i + 1]; rgb[3 * i + 2] = img.data[4 * i + 2]; } return rgb; };
  const R = rotYQuarter(cfg.yawQuarter), natRot = apply(nat.P, R);
  tiles.push(toRGB(rasterize(natRot, nat.I, nat.UV, natTex, VIEWS.front, N, N, {bg}))); labels.push('NATIVE front (2048 px)');
  for (const [V, l] of [[VIEWS.front, 'RUNTIME front'], [VIEWS.right, 'RUNTIME right'], [VIEWS.back, 'RUNTIME back'], [viewYawPitch(30, 22), 'RUNTIME 3/4'], [viewYawPitch(-35, 30), 'RUNTIME 3/4 left'], [viewYawPitch(0, 70), 'RUNTIME above'], [viewYawPitch(150, 20), 'RUNTIME behind']]) {
    tiles.push(toRGB(rasterize(P, I, UV, tex, V, N, N, {bg}))); labels.push(l);
  }
  const C = 4, rows = Math.ceil(tiles.length / C), LH = 18, TH = 24, W = C * N, H = TH + rows * (LH + N);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202020"/><text x="6" y="17" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#ffd27a">${esc(id)} (${cfg.code}, ${cfg.caliber}) · ${I.length / 3} tris · ${dims.map(v => v.toFixed(3)).join(' × ')} m · 512 px${cfg.stencil ? ' · LOCAL stencil repair 516 → 5.56' : ''}</text>`;
  const comps = [];
  tiles.forEach((tb, i) => { const x = (i % C) * N, y = TH + Math.floor(i / C) * (LH + N); svg += `<text x="${x + 6}" y="${y + 13}" font-family="DejaVu Sans, sans-serif" font-size="12" fill="#e8e8e8">${esc(labels[i])}</text>`; comps.push({tb, x, y: y + LH}); });
  svg += '</svg>';
  const layers = [{input: Buffer.from(svg), top: 0, left: 0}];
  for (const c of comps) layers.push({input: await sharp(c.tb, {raw: {width: N, height: N, channels: 3}}).png().toBuffer(), top: c.y, left: c.x});
  fs.mkdirSync(path.dirname(out), {recursive: true});
  await sharp({create: {width: W, height: H, channels: 3, background: '#202020'}}).composite(layers).png().toFile(out);
  return out;
}

// ---- main ---------------------------------------------------------------------------------------------------------------------
async function main() {
  const del = readJson(DELIVERED), man = readJson(MANIFEST);
  const ids = Object.keys(BOXES).filter(id => !only || only.includes(id));
  const prev = !dev && fs.existsSync(PROV) ? readJson(PROV).records ?? [] : [];
  const records = prev.filter(r => !ids.includes(r.id));
  for (const id of ids) {
    const d = del.assets[id];
    if (!d) throw new Error(`${id}: not delivered`);
    if (!/^accepted/.test(d.status)) throw new Error(`${id}: delivery status '${d.status}' is not accepted`);
    const glbOut = dev ? path.join(outDir, BOXES[id].file) : path.join(MODELS_DIR, BOXES[id].file);
    const reviewOut = path.join(dev ? outDir : path.join(TASK, 'review/ammo'), `${id}-review.png`);
    records.push(await buildOne(id, BOXES[id], d, man, {glbOut, reviewOut}));
  }
  records.sort((a, b) => a.code.localeCompare(b.code));
  const doc = {
    schema: 'terminal-state-meshy-t25-derivatives-v1', task: TASK_ID, lane: 'AMMO',
    status: 'Runtime derivatives of three Meshy T2.5 text-to-3D ammo boxes (one per caliber; primary review: accepted, M2 with a LOCAL stencil repair). Prototype art; no commercial / model licence clearance asserted.',
    generation: {provider: 'Meshy', model: 'meshy-t2.5', route: 'text-to-3D preview (smart-topology) + 2K PBR refine', credits: del.credits, authorization: 'task coordination.md "Task-scoped generation authority": exactly three ammo boxes, 45 credits, no rerolls'},
    rebuild: 'node tools/asset-pipeline/props/build-ammo-boxes.mjs [--only <id>,<id>]',
    rawStorage: 'Native Meshy GLBs, texture PNGs, task records and the submission ledger stay OUTSIDE Git in reference/tasks/knife-melee-20261030/assets/ (raw/M*/refine/model.glb, ledger.jsonl, DELIVERED.json, manifest.json).',
    conventions: {units: 'meters', up: '+Y', front: '+Z', origin: 'bottom-centre', files: 'plain glTF 2.0 binary (no Draco / meshopt / KTX2); flat paths assets/models/ammo-<caliber>-t25.glb'},
    runtime: 'game/src/assets/manifest.ts MODEL_FILES item_ammo_9mm / item_ammo_556 / item_ammo_12ga -> world/pickups.ts ITEM_MODEL_KEYS (pickups, holder lots, item icons, warm-up like the other item models)',
    counts: {records: records.length, bytes: records.reduce((s, r) => s + r.output.bytes, 0), triangles: records.reduce((s, r) => s + r.output.triangles, 0)},
    records,
    tool: TOOL_VERSION,
  };
  if (dev) { fs.writeFileSync(path.join(outDir, 'meshy-t25-ammo-20261030.json'), JSON.stringify(doc, null, 2) + '\n'); return; }
  fs.writeFileSync(PROV + '.tmp', JSON.stringify(doc, null, 2) + '\n'); fs.renameSync(PROV + '.tmp', PROV);
  log(`\nprovenance: ${rel(PROV)} (${records.length} records)`);
}

main().catch(e => { console.error(e); process.exit(1); });
