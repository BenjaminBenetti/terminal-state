#!/usr/bin/env node
// Terminal State — runtime derivatives of the reference-conditioned Meshy T2.5 replacements of the locally generated PROPS,
// CONSUMABLE ITEMS and the LIGHT FIXTURE (task studio-meshy-game-replacement-20261029-01, lane PROPS).
//
// User: "Can we regenerate all the assets that we generated with our local 3d model gen using Meshy T2.5?" ... "Make sure that we
// match the vibe of the game ... If we use the original images the game will look the same and be awesome." Lane MESHY submitted
// each master's ORIGINAL front / reference image to meshy_image_to_3d (meshy-t2.5, smart-topology, 2K PBR) and reviewed the result
// against that image; this tool turns an ACCEPTED native GLB into the game's runtime derivative:
//
//   verify (sha256 vs DELIVERED.json) -> orient (Meshy front +Z / up +Y; a front check against the original image confirms or turns
//   it by quarter turns) -> fit to the EXISTING gameplay footprint (props / light: per-axis to the old runtime bbox so PROP_DEFS,
//   P7_PROP_DEFS, layouts, colliders and the fixture size stay valid; items: uniform to the old height, fitItemModel does the rest)
//   -> ground / anchor (bottom-centre; the light: top-centre, hanging below y = 0) -> seam-preserving simplification to the class
//   triangle budget (meshoptimizer, Meshy's own UVs kept: no re-unwrap / re-bake of a clean smart-topology atlas) -> PBR maps
//   downsized (Lanczos) to the class sizes, JPEG, under the class byte budget -> measure support surfaces (p7 loot / on-top
//   surfaces) -> write game/public/assets/models/<old-basename>-t25.glb (NEW flat path = cache-busting; logical keys unchanged)
//   + one provenance record per master in game/public/assets/derivatives/meshy-t25-{props,items,light}-20261029.json (task id,
//   native + input-image hashes, runtime hashes / budgets, RESTORE map of the replaced file at the pushed base commit)
//   -> CPU review sheet (original image | old runtime | new runtime views) in reference/tasks/<task>/review/props/.
//   p7 kinds: game/src/gen/props07.catalog.ts is regenerated (lib/p7-catalog.mjs; the T2.5 row replaces the iteration-07 row).
//
// Usage:
//   node tools/asset-pipeline/props/build-meshy-t25.mjs                       # every ACCEPTED delivery in this lane's classes
//   node tools/asset-pipeline/props/build-meshy-t25.mjs --only base:trashCan,p7:filingCabinet [--force]
//   node tools/asset-pipeline/props/build-meshy-t25.mjs --list                # what is delivered / accepted / built
//   node tools/asset-pipeline/props/build-meshy-t25.mjs --dev <id> --out-dir /tmp/x [--native <glb>]
//        # dry run (any native, accepted or not): writes ONLY into --out-dir (GLB + record + review sheet); never the game
// Native GLBs are read-only inputs (outside Git); nothing here calls Meshy or any generator.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import {writeMeshGlb} from './lib/glb.mjs';
import {bbox, minAreaYaw} from './lib/orient.mjs';
import {p7CatalogSource, t25CatalogOverrides, T25_PROPS_PROVENANCE} from './lib/p7-catalog.mjs';
import {OPEN_FRONT, assembleOpenFront} from './open-front-iteration05.mjs';

const TOOL_VERSION = 'meshy-t25-props-1';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE = 'a7a646a1dd62bf1c641fe3dd0d1187ab322afe87';
const TASK_ID = 'studio-meshy-game-replacement-20261029-01';
const TASK = path.join(REPO, 'reference/tasks/meshy-game-replacement-20261029');
const ASSETS = path.join(TASK, 'assets');
const DELIVERED = path.join(ASSETS, 'DELIVERED.json');
const INVENTORY = path.join(TASK, 'inventory.json');
const REVIEW = path.join(TASK, 'review/props');
const MODELS_DIR = path.join(REPO, 'game/public/assets/models');
const PROV = {
  props: path.join(REPO, T25_PROPS_PROVENANCE),
  items: path.join(REPO, 'game/public/assets/derivatives/meshy-t25-items-20261029.json'),
  light: path.join(REPO, 'game/public/assets/derivatives/meshy-t25-light-20261029.json'),
};
const P7_PROV = path.join(REPO, 'game/public/assets/derivatives/props-iteration07.json');
const CATALOG = path.join(REPO, 'game/src/gen/props07.catalog.ts');

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = arg('--only')?.split(',') ?? null;
const force = args.includes('--force');
const devId = arg('--dev');
const outDir = arg('--out-dir');
const log = (...a) => console.log(...a);
const r6 = v => Math.round(v * 1e6) / 1e6, r4 = v => Math.round(v * 1e4) / 1e4, r3 = v => Math.round(v * 1e3) / 1e3;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const rel = f => path.relative(REPO, f);

// ---- class policy ---------------------------------------------------------------------------------------------------
// Runtime budgets (lane contract §3: keep total size / GPU memory in today's ballpark). p7 kinds keep their iteration-07 size
// class budgets exactly (tests/composition.test.ts bounds the per-station p7 triangles / texture memory). Earlier props keep
// ~their old triangle count (x1.25, 1.5k..8k); items <= 3k tris / 512 px; the light (instanced at every fixture) <= 1.2k tris.
const P7_CLASSES = {
  small: {tris: 1500, color: 512, mr: 256, normal: 256, bytes: 340_000},
  medium: {tris: 4000, color: 768, mr: 256, normal: 256, bytes: 560_000},
  large: {tris: 6000, color: 1024, mr: 256, normal: 256, bytes: 800_000},
};
const CLASS_OF = {'openable prop': 'props', prop: 'props', 'shelf/holder': 'props', 'consumable item': 'items', 'light fixture': 'light'};

/**
 * Open-front hybrids (user feedback iteration 05: "just a picture of drinks on the front"): the T2.5 exterior is cut and the
 * authored interior / real wire shelves / transparent glass of open-front-iteration05.mjs is added, exactly as before, so the
 * loot surfaces (gen/props.ts SHOP_COOLER_SURFACES / SHOP_DISPLAY_SURFACES) and the cooler-door openable stay valid. Cut volumes
 * re-measured on the T2.5 geometry (ray-cast, 2026-10-29): cooler opening x -0.287..0.275, y 0.262..1.715, front z 0.301,
 * inner back z -0.331 (the iteration-05 cut fits unchanged); display base top y ~0.175 (old 0.214), canopy from 0.625: the cut
 * starts at 0.172 and a stainless band fills 0.172..0.202 under the iteration-05 base cap (trays / glass / lamps unchanged).
 */
const HYBRID = {
  'base:shopCooler': {name: 'shopCoolerOpen', spec: OPEN_FRONT.shopCoolerOpen},
  'base:shopDisplay': {name: 'shopDisplayOpen', spec: {...OPEN_FRONT.shopDisplayOpen,
    cut: ([, y]) => y > 0.172 && y < 0.624,
    build(g, I) { OPEN_FRONT.shopDisplayOpen.build.call(this, g, I); g.box('base-band', [-0.548, 0.172, -0.305], [0.548, I.yLow - 0.012, 0.305], 'steel', '+x-x+z-z'); }}},
};

/** Per-asset tuning found by inspection (front/yaw overrides, fit, budget changes, notes). */
const TUNE = {
  'base:shopDisplay': {dims: [1.1, 0.7, 0.62], budget: {tris: 4000, reason: 'open-front hybrid: the glass band is cut and rebuilt, keep the base / canopy detail'}, reason: 'fitted to gen/props.ts SHOP_DISPLAY_CASE 1.1 x 0.70 x 0.62 (the case box on the shop counter)'},
  'base:crate': {patch: {reason: 'Meshy left the lid skirt open on the front and back between the corner caps (a see-through slit y 0.362..0.418 m, ray-cast 2026-10-29; the native has it too): two quads close it, textured from the lid skirt on the side (the same teal paint)',
    quads: [
      {name: 'lid-skirt-front', c: [[-0.268, 0.3615, 0.2045], [0.268, 0.3615, 0.2045], [0.268, 0.4185, 0.2045], [-0.268, 0.4185, 0.2045]], n: [0, 0, 1], uvAt: [0.31, 0.39, 0.0]},
      {name: 'lid-skirt-back', c: [[0.268, 0.3615, -0.2045], [-0.268, 0.3615, -0.2045], [-0.268, 0.4185, -0.2045], [0.268, 0.4185, -0.2045]], n: [0, 0, -1], uvAt: [-0.31, 0.39, 0.0]},
    ]}},
  'base:shelf': {yawQuarter: 2, reason: 'the original image is a 3/4 view (the orthographic front check cannot tell front from back: 0.22 vs 0.219); Meshy put the single diagonal brace in its +Z face, but the reference has the braces at the BACK and the shelf is loaded from the front (stock, loot, the cabinet inserts): turned 180 deg'},
  'base:turnstile': {yawQuarter: 1, reason: 'the front check matched the reference (a 3/4 view of the cabinet end) to a side view and turned the cabinet 180 deg from the old model; the game contract is the old orientation: cabinet along Z with the card reader at the +Z end, the tripod arms reaching -X across the gate lane (world/builder.ts TURNSTILE_CABINET_OFFSET centres the cabinet on the fare-gate placement)'},
  'base:light': {fit: 'uniform-width', reason: 'the fixture size is read from the model bbox at load (game.ts WorldMaterials fixture dims -> emissive tube box, instancing fit): keep the 1.2 m length and the round diffuser tube round (a per-axis fit to the old 0.172 m depth would stretch it 30% into an oval); height comes out 0.19 m like the old fixture, depth 0.13 m'},
};

// ---- inputs ---------------------------------------------------------------------------------------------------------
const inventory = () => readJson(INVENTORY);
/**
 * Delivery state per asset: lane MESHY's fsynced ledger folded read-only (latest attempt: done -> native file + sha256, review
 * verdict, input image, args), falling back to / merged over DELIVERED.json (which MESHY rewrites periodically from that ledger).
 */
function delivered() {
  const out = {assets: {...(fs.existsSync(DELIVERED) ? readJson(DELIVERED).assets ?? {} : {})}};
  const L = path.join(ASSETS, 'ledger.jsonl');
  if (!fs.existsSync(L)) return out;
  const by = {};
  for (const line of fs.readFileSync(L, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }   // a line being appended right now
    if (!e.asset || e.asset === '*' || !e.attempt) continue;
    const t = ((by[e.asset] ??= {})[e.attempt] ??= {attempt: e.attempt});
    if (['intent', 'ack', 'done', 'failed', 'review'].includes(e.event)) t[e.event] = e;
  }
  for (const [id, atts] of Object.entries(by)) {
    const cur = Object.values(atts).sort((x, y) => +x.attempt.slice(1) - +y.attempt.slice(1)).pop();
    out.assets[id] = {...(out.assets[id] ?? {}), attempt: cur.attempt, taskId: cur.ack?.task_id ?? null,
      status: cur.done ? 'SUCCEEDED' : cur.failed ? 'FAILED' : cur.ack?.task_id ? 'SUBMITTED' : 'PENDING',
      review: cur.review?.verdict ?? (cur.done ? 'pending-review' : null), reviewNote: cur.review?.note ?? null,
      nativeGlb: cur.done?.nativeGlb?.file ?? null, sha256: cur.done?.nativeGlb?.sha256 ?? null,
      inputImage: cur.intent?.inputImage?.path ?? null, inputImageSha256: cur.intent?.inputImage?.sha256 ?? null,
      args: cur.intent?.args ? {target_polycount: cur.intent.args.target_polycount, pose_mode: cur.intent.args.pose_mode ?? null} : null};
  }
  return out;
}
const p7Prov = () => readJson(P7_PROV);
function gitBlob(p) { return execFileSync('git', ['-C', REPO, 'show', `${BASE}:${p}`], {maxBuffer: 1 << 28}); }
function gitBlobSha(p) { return execFileSync('git', ['-C', REPO, 'rev-parse', `${BASE}:${p}`]).toString().trim(); }

/** First (and only) triangle primitive of a GLB: positions / normals / uvs / indices (world transforms applied) + its textures. */
async function readMesh(bytesOrFile, {merge = false} = {}) {
  const io = new NodeIO();
  const doc = Buffer.isBuffer(bytesOrFile) ? await io.readBinary(new Uint8Array(bytesOrFile)) : await io.read(bytesOrFile);
  const root = doc.getRoot();
  const prims = [];
  for (const n of root.listNodes()) { const m = n.getMesh(); if (m) for (const p of m.listPrimitives()) prims.push({p, M: n.getWorldMatrix()}); }
  if (merge && prims.length > 1) {   // positions / triangle count only (old multi-node hybrids: bbox + budget reference)
    const P = [], I = [];
    for (const {p, M} of prims) {
      const base = P.length / 3, A = p.getAttribute('POSITION').getArray(), ix = p.getIndices()?.getArray() ?? Array.from({length: A.length / 3}, (_, i) => i);
      for (let i = 0; i < A.length; i += 3) P.push(M[0] * A[i] + M[4] * A[i + 1] + M[8] * A[i + 2] + M[12], M[1] * A[i] + M[5] * A[i + 1] + M[9] * A[i + 2] + M[13], M[2] * A[i] + M[6] * A[i + 1] + M[10] * A[i + 2] + M[14]);
      for (const v of ix) I.push(base + v);
    }
    const first = prims[0].p.getMaterial();
    return {P: Float32Array.from(P), I: Uint32Array.from(I), UV: null, N: null, primitives: prims.length, material: {color: first?.getBaseColorTexture() ? {bytes: Buffer.from(first.getBaseColorTexture().getImage()), mime: first.getBaseColorTexture().getMimeType(), size: first.getBaseColorTexture().getSize()} : null}};
  }
  if (prims.length !== 1) throw new Error(`expected one mesh primitive, found ${prims.length}`);
  const {p, M} = prims[0];
  if (p.getMode() !== 4) throw new Error('triangles only');
  const P0 = p.getAttribute('POSITION').getArray(), N0 = p.getAttribute('NORMAL')?.getArray(), UV = Float32Array.from(p.getAttribute('TEXCOORD_0').getArray());
  const idx = p.getIndices();
  const I = idx ? Uint32Array.from(idx.getArray()) : Uint32Array.from({length: P0.length / 3}, (_, i) => i);
  const P = new Float32Array(P0.length), N = new Float32Array(P0.length);
  for (let i = 0; i < P0.length; i += 3) {
    const x = P0[i], y = P0[i + 1], z = P0[i + 2];
    P[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
    if (N0) { const a = N0[i], b = N0[i + 1], c = N0[i + 2]; N[i] = M[0] * a + M[4] * b + M[8] * c; N[i + 1] = M[1] * a + M[5] * b + M[9] * c; N[i + 2] = M[2] * a + M[6] * b + M[10] * c; }
  }
  const mat = p.getMaterial();
  const tex = t => (t ? {bytes: Buffer.from(t.getImage()), mime: t.getMimeType(), size: t.getSize()} : null);
  return {P, N, UV, I, material: {baseColorFactor: mat?.getBaseColorFactor() ?? [1, 1, 1, 1], metallicFactor: mat?.getMetallicFactor() ?? 1, roughnessFactor: mat?.getRoughnessFactor() ?? 1, doubleSided: mat?.getDoubleSided() ?? false,
    color: tex(mat?.getBaseColorTexture()), mr: tex(mat?.getMetallicRoughnessTexture()), normal: tex(mat?.getNormalTexture())}};
}
const decodeRGB = async bytes => { const {data, info} = await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, width: info.width, height: info.height, ch: 3}; };

// ---- geometry helpers -----------------------------------------------------------------------------------------------
const rotYQuarter = q => [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]][((q % 4) + 4) % 4];
const rotYDeg = d => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const mul3 = (A, B) => [0, 1, 2].map(r => [0, 1, 2].map(c => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]));
const apply = (P, R, S = [1, 1, 1], t = [0, 0, 0]) => {
  const o = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = S[k] * (R[k][0] * P[i] + R[k][1] * P[i + 1] + R[k][2] * P[i + 2]) + t[k];
  return o;
};
/** Normals under p' = S R p: n' ∝ S^-1 R n. */
const applyN = (N, R, S) => {
  const o = new Float32Array(N.length);
  for (let i = 0; i < N.length; i += 3) {
    let x = (R[0][0] * N[i] + R[0][1] * N[i + 1] + R[0][2] * N[i + 2]) / S[0], y = (R[1][0] * N[i] + R[1][1] * N[i + 1] + R[1][2] * N[i + 2]) / S[1], z = (R[2][0] * N[i] + R[2][1] * N[i + 1] + R[2][2] * N[i + 2]) / S[2];
    const l = Math.hypot(x, y, z) || 1; o[i] = x / l; o[i + 1] = y / l; o[i + 2] = z / l;
  }
  return o;
};
function meshStats(P, I) {
  // position-welded connected components + boundary (open) edges: closed shells can be single-sided
  const nv = P.length / 3, key = new Map(), weld = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${P[3 * v].toFixed(5)},${P[3 * v + 1].toFixed(5)},${P[3 * v + 2].toFixed(5)}`; let w = key.get(k); if (w === undefined) key.set(k, (w = key.size)); weld[v] = w; }
  const parent = Int32Array.from({length: key.size}, (_, i) => i), find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const edges = new Map();
  for (let f = 0; f < I.length; f += 3) {
    const a = weld[I[f]], b = weld[I[f + 1]], c = weld[I[f + 2]];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? `${u}_${v}` : `${v}_${u}`; edges.set(k, (edges.get(k) ?? 0) + 1); const ru = find(u), rv = find(v); if (ru !== rv) parent[ru] = rv; }
  }
  const comps = new Map();
  for (let f = 0; f < I.length; f += 3) { const r = find(weld[I[f]]); comps.set(r, (comps.get(r) ?? 0) + 1); }
  let boundary = 0, nonManifold = 0; for (const n of edges.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  return {components: comps.size, largestComponentFaces: Math.max(...comps.values()), boundaryEdges: boundary, nonManifoldEdges: nonManifold, edges: edges.size};
}

/** Seam-preserving simplification on Meshy's own vertex buffer (UVs / normals kept), then compaction. */
async function simplifyKeepUV(m, targetTris) {
  await MeshoptSimplifier.ready;
  const tris0 = m.I.length / 3;
  if (tris0 <= targetTris) return {...m, simplify: {applied: false, triangles: tris0}};
  const attrs = new Float32Array((m.P.length / 3) * 5);
  for (let v = 0; v < m.P.length / 3; v++) { attrs[5 * v] = m.N[3 * v] * 0.5; attrs[5 * v + 1] = m.N[3 * v + 1] * 0.5; attrs[5 * v + 2] = m.N[3 * v + 2] * 0.5; attrs[5 * v + 3] = m.UV[2 * v]; attrs[5 * v + 4] = m.UV[2 * v + 1]; }
  // attribute seams can stop the collapse short of the target: ask for less until the result fits the budget
  let out, err, ask = targetTris;
  for (let k = 0; k < 8; k++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(m.I, m.P, 3, attrs, 5, [1, 1, 1, 1, 1], null, ask * 3, 1.0, []);
    if (out.length / 3 <= targetTris) break;
    ask = Math.floor(ask * Math.min(0.97, targetTris / (out.length / 3)));
  }
  const map = new Int32Array(m.P.length / 3).fill(-1), P = [], N = [], UV = [], I = [];
  for (const v of out) { if (map[v] < 0) { map[v] = P.length / 3; P.push(m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]); N.push(m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2]); UV.push(m.UV[2 * v], m.UV[2 * v + 1]); } I.push(map[v]); }
  const scale = MeshoptSimplifier.getScale(m.P, 3);
  return {...m, P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I: Uint32Array.from(I),
    simplify: {applied: true, tool: 'meshoptimizer simplifyWithAttributes (normals x0.5 + UV weights; attribute seams preserved, Meshy UVs kept)', fromTriangles: tris0, triangles: I.length / 3, targetTriangles: targetTris, errorRelative: r6(err), errorMeters: r6(err * scale)}};
}

// ---- CPU rasteriser (front check + review sheets; from build-props-iteration07.mjs) -----------------------------------
function rasterize(P, I, UV, tex, V, size, {shade = true, margin = 0.06, frame = null, bg = null} = {}) {
  const n = P.length / 3, X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = P[3 * i], py = P[3 * i + 1], pz = P[3 * i + 2];
    X[i] = V[0][0] * px + V[0][1] * py + V[0][2] * pz; Y[i] = V[1][0] * px + V[1][1] * py + V[1][2] * pz; Z[i] = V[2][0] * px + V[2][1] * py + V[2][2] * pz;
    if (X[i] < x0) x0 = X[i]; if (X[i] > x1) x1 = X[i]; if (Y[i] < y0) y0 = Y[i]; if (Y[i] > y1) y1 = Y[i];
  }
  const fr = frame ?? {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: size * (1 - 2 * margin) / Math.max(x1 - x0, y1 - y0, 1e-9)};
  const W = size, H = size, zb = new Float32Array(W * H).fill(-Infinity), out = Buffer.alloc(W * H * 4);
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
      const z = w0 * Z[a] + w1 * Z[b] + w2 * Z[c], k = y * W + x; if (z <= zb[k]) continue; zb[k] = z;
      const u = w0 * UV[2 * a] + w1 * UV[2 * b] + w2 * UV[2 * c], v = w0 * UV[2 * a + 1] + w1 * UV[2 * b + 1] + w2 * UV[2 * c + 1];
      const tx = Math.min(tex.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.width))), ty = Math.min(tex.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.height))), o = tex.ch * (ty * tex.width + tx);
      out[4 * k] = Math.min(255, tex.data[o] * L); out[4 * k + 1] = Math.min(255, tex.data[o + 1] * L); out[4 * k + 2] = Math.min(255, tex.data[o + 2] * L); out[4 * k + 3] = 255;
    }
  }
  return {data: out, width: W, height: H, frame: fr};
}
const norm3 = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross3 = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const VIEWS = {front: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], right: [[0, 0, -1], [0, 1, 0], [1, 0, 0]], back: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], left: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]};
function viewYawPitch(yawDeg, pitchDeg) {
  const a = yawDeg * Math.PI / 180, b = pitchDeg * Math.PI / 180;
  const toward = [Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)];
  const right = norm3(cross3([0, 1, 0], toward)), up = cross3(toward, right);
  return [right, up, toward];
}
async function normImage(buf, w, h, N = 48) {
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (buf[4 * (y * w + x) + 3] >= 128) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 < 0) return null;
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1;
  const {data} = await sharp(Buffer.from(buf), {raw: {width: w, height: h, channels: 4}}).extract({left: bx0, top: by0, width: cw, height: ch}).resize(N, N, {fit: 'fill', kernel: 'cubic'}).raw().toBuffer({resolveWithObject: true});
  return {data, N, aspect: cw / ch};
}
function compareNorm(A, B) {
  let inter = 0, uni = 0; const la = [], lb = [], ca = [], cb = [];
  const lum = (D, i) => 0.299 * D[4 * i] + 0.587 * D[4 * i + 1] + 0.114 * D[4 * i + 2];
  for (let i = 0; i < A.N * A.N; i++) {
    const a = A.data[4 * i + 3] >= 128, b = B.data[4 * i + 3] >= 128;
    if (a || b) uni++; if (!(a && b)) continue; inter++;
    const LA = lum(A.data, i), LB = lum(B.data, i); la.push(LA); lb.push(LB);
    ca.push([A.data[4 * i] - LA, A.data[4 * i + 2] - LA]); cb.push([B.data[4 * i] - LB, B.data[4 * i + 2] - LB]);
  }
  const n = la.length, ma = la.reduce((s, v) => s + v, 0) / (n || 1), mb = lb.reduce((s, v) => s + v, 0) / (n || 1);
  let sab = 0, saa = 0, sbb = 0, cd = 0;
  for (let i = 0; i < n; i++) { const x = la[i] - ma, y = lb[i] - mb; sab += x * y; saa += x * x; sbb += y * y; cd += (Math.abs(ca[i][0] - cb[i][0]) + Math.abs(ca[i][1] - cb[i][1])) / 2; }
  const ncc = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0, chroma = n ? cd / n / 255 : 1, iou = uni ? inter / uni : 0, aspect = Math.abs(Math.log(A.aspect / B.aspect));
  return {iou: r3(iou), lumaCorrelation: r3(ncc), chromaDiff: r3(chroma), aspectLogDiff: r3(aspect), score: r3(iou + 0.8 * ncc - 1.0 * chroma - 0.5 * aspect)};
}
/** Renders the native (Meshy frame) from front/right/back/left and compares each with the original image (alpha bbox, 48 px). */
async function frontCheck(m, tex, imagePath) {
  const {data, info} = await sharp(imagePath).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const ref = await normImage(data, info.width, info.height);
  const scores = {};
  for (const [name, V] of Object.entries(VIEWS)) {
    const img = rasterize(m.P, m.I, m.UV, tex, V, 160, {shade: false, margin: 0.02});
    const n = await normImage(img.data, img.width, img.height);
    scores[name] = n ? compareNorm(ref, n) : {score: -9};
  }
  const best = Object.entries(scores).sort((a, b) => b[1].score - a[1].score)[0][0];
  return {scores, best, method: 'native rendered orthographically (textured, unshaded, 160 px) from +Z/+X/-Z/-X; alpha-bbox crops of render and the original image resized to 48 x 48; score = IoU + 0.8 luma correlation - chroma difference - 0.5 |ln aspect|; Meshy front +Z kept unless another side wins by > 0.15'};
}

// ---- support surfaces (build-props-iteration07.mjs supportSurfaces; output space) ------------------------------------
// The iteration-07 measure took one centroid per face of a ~1M-triangle dense reconstruction. Smart-topology meshes have few,
// large faces, so every up-facing face is sampled here on a deterministic barycentric grid (~5 mm spacing, area-weighted
// points) before the same clustering / percentile / clearance rules run.
function samplePoints(DP, I, spacing = 0.01) {
  const out = [];
  for (let f = 0; f < I.length / 3; f++) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
    const ux = DP[b] - DP[a], uy = DP[b + 1] - DP[a + 1], uz = DP[b + 2] - DP[a + 2], vx = DP[c] - DP[a], vy = DP[c + 1] - DP[a + 1], vz = DP[c + 2] - DP[a + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2, g = Math.max(1, Math.min(40, Math.round(Math.sqrt(area) / spacing)));
    for (let i = 0; i < g; i++) for (let j = 0; j < g - i; j++) { const p = (i + 1 / 3) / g, q = (j + 1 / 3) / g, w = 1 - p - q; out.push(w * DP[a] + p * DP[b] + q * DP[c], w * DP[a + 1] + p * DP[b + 1] + q * DP[c + 1], w * DP[a + 2] + p * DP[b + 2] + q * DP[c + 2]); }
  }
  return out;
}
function supportSurfaces(DP, I, bb) {
  const bin = 0.005, hist = new Map(), cloud = samplePoints(DP, I);
  for (let f = 0; f < I.length / 3; f++) {
    const a = 3 * I[3 * f], b = 3 * I[3 * f + 1], c = 3 * I[3 * f + 2];
    const ux = DP[b] - DP[a], uy = DP[b + 1] - DP[a + 1], uz = DP[b + 2] - DP[a + 2], vx = DP[c] - DP[a], vy = DP[c + 1] - DP[a + 1], vz = DP[c + 2] - DP[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (!(l > 0) || ny / l < 0.9) continue;
    const area = l / 2, g = Math.max(1, Math.min(40, Math.round(Math.sqrt(area / 2.5e-5))));   // g x g sub-triangles
    const pts = [];
    for (let i = 0; i < g; i++) for (let j = 0; j < g - i; j++) {
      for (const [p, q] of [[(i + 1 / 3) / g, (j + 1 / 3) / g], ...(i + j < g - 1 ? [[(i + 2 / 3) / g, (j + 2 / 3) / g]] : [])]) {
        const w = 1 - p - q; pts.push([w * DP[a] + p * DP[b] + q * DP[c], w * DP[a + 1] + p * DP[b + 1] + q * DP[c + 1], w * DP[a + 2] + p * DP[b + 2] + q * DP[c + 2]]);
      }
    }
    const wa = area / pts.length;
    for (const [px, py, pz] of pts) {
      if (py < 0.015) continue;
      const k = Math.round(py / bin); let e = hist.get(k); if (!e) hist.set(k, (e = {area: 0, pts: []}));
      e.area += wa; e.pts.push(px, pz, wa, py);
    }
  }
  const keys = [...hist.keys()].sort((x, y) => x - y), clusters = [];
  for (const k of keys) { const e = hist.get(k), last = clusters[clusters.length - 1]; if (last && k - last.k1 <= 2) { last.k1 = k; last.area += e.area; for (const v of e.pts) last.pts.push(v); } else clusters.push({k0: k, k1: k, area: e.area, pts: e.pts.slice()}); }
  if (!clusters.length) return [];
  const maxA = Math.max(...clusters.map(c => c.area));
  const pctW = (vals, wts, t) => { const o = vals.map((v, i) => [v, wts[i]]).sort((a, b) => a[0] - b[0]); const tot = wts.reduce((s, w) => s + w, 0); let acc = 0; for (const [v, w] of o) { acc += w; if (acc >= t * tot) return v; } return o[o.length - 1][0]; };
  const out = [];
  for (const c of clusters.filter(c => c.area >= 0.04 * maxA && c.area >= 0.006)) {
    const xs = [], zs = [], ws = [], ys = []; for (let i = 0; i < c.pts.length; i += 4) { xs.push(c.pts[i]); zs.push(c.pts[i + 1]); ws.push(c.pts[i + 2]); ys.push(c.pts[i + 3]); }
    const y = pctW(ys, ws, 0.7), x0 = pctW(xs, ws, 0.05), x1 = pctW(xs, ws, 0.95), z0 = pctW(zs, ws, 0.05), z1 = pctW(zs, ws, 0.95);
    const ix0 = x0 + 0.1 * (x1 - x0), ix1 = x1 - 0.1 * (x1 - x0), iz0 = z0 + 0.1 * (z1 - z0), iz1 = z1 - 0.1 * (z1 - z0);
    // clearance from the surface-sampled cloud of ALL faces (a low-poly shelf board above has too few vertices to count)
    const above = []; for (let i = 0; i < cloud.length; i += 3) { const vy = cloud[i + 1]; if (vy > y + 0.04 && cloud[i] > ix0 && cloud[i] < ix1 && cloud[i + 2] > iz0 && cloud[i + 2] < iz1) above.push(vy); }
    above.sort((p, q) => p - q);
    const clear = above.length < 30 ? 0.6 : above[Math.floor(0.03 * above.length)] - y;
    out.push({y: r3(y), yTop: r3(c.k1 * bin), areaM2: r4(c.area), x0: r3(x0), x1: r3(x1), z0: r3(z0), z1: r3(z1), clear: r3(Math.min(0.6, clear)), top: false});
  }
  if (out.length) out.sort((a, b) => a.y - b.y), out[out.length - 1].top = Math.abs(out[out.length - 1].yTop - bb.max[1]) < 0.04;
  return out;
}

// ---- textures -------------------------------------------------------------------------------------------------------
async function resizeJpeg(bytes, size, q, kind) {
  const img = sharp(bytes).removeAlpha().resize(size, size, {fit: 'fill', kernel: 'lanczos3'});
  return {mime: 'image/jpeg', ext: 'jpg', bytes: await img.jpeg({quality: q, chromaSubsampling: kind === 'color' ? '4:2:0' : '4:4:4', mozjpeg: true}).toBuffer(), size: [size, size]};
}
async function mrStats(bytes) {
  const {data} = await sharp(bytes).removeAlpha().resize(128, 128, {fit: 'fill'}).raw().toBuffer({resolveWithObject: true});
  let g = 0, b = 0; for (let i = 0; i < data.length; i += 3) { g += data[i + 1]; b += data[i + 2]; }
  const n = data.length / 3; return {meanRoughness: r3(g / n / 255), meanMetalness: r3(b / n / 255)};
}

// ---- config per master ----------------------------------------------------------------------------------------------
const kebab = k => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
async function configFor(master, p7) {
  const cls = CLASS_OF[master.class];
  if (!cls) throw new Error(`${master.id}: class '${master.class}' is not a PROPS-lane class`);
  if (master.runtimePaths.length !== 1) throw new Error(`${master.id}: expected one runtime path`);
  const oldPath = master.runtimePaths[0], oldBase = path.basename(oldPath, '.glb');
  const tune = TUNE[master.id] ?? {};
  const old = await readMesh(gitBlob(oldPath), {merge: true});
  const ob = bbox(old.P), oldTris = old.I.length / 3;
  const p7Key = master.id.startsWith('p7:') ? master.id.slice(3) : null;
  const p7Out = p7Key ? p7.outputs.find(o => o.key === p7Key) : null;
  if (p7Key && !p7Out) throw new Error(`${master.id}: no iteration-07 output`);
  // Target footprint: p7 = the catalog's measured dims (P7_PROP_DEFS); others = the old runtime bbox (mm).
  const dims = tune.dims ?? (p7Out ? [p7Out.dimensionsMeters.measured.w, p7Out.dimensionsMeters.measured.h, p7Out.dimensionsMeters.measured.d] : ob.size.map(r3));
  const anchor = cls === 'light' ? 'top' : 'bottom';
  let budget;
  if (p7Out) budget = {...P7_CLASSES[p7Out.sizeClass], sizeClass: p7Out.sizeClass, rule: `iteration-07 ${p7Out.sizeClass} class budget (unchanged)`};
  else if (cls === 'items') budget = {tris: 3000, color: 512, mr: 256, normal: 256, bytes: 240_000, rule: 'consumable item: <= 3k tris, 512 px colour, 256 px MR / normal'};
  else if (cls === 'light') budget = {tris: 1200, color: 1024, mr: 512, normal: 512, bytes: 560_000, rule: 'light fixture (instanced at every fixture): <= 1.2k tris; old 1024 / 512 / 512 maps'};
  else {
    const oc = old.material.color?.size?.[0] ?? 1024;
    budget = {tris: Math.round(Math.min(8000, Math.max(1500, oldTris * 1.25))), color: Math.min(1024, oc), mr: Math.min(512, oc / 2), normal: Math.min(512, oc / 2), bytes: Math.round(Math.max(600_000, (master.current?.bytes ?? 0) * 1.1)), rule: 'earlier prop: ~old triangles x1.25 (1.5k..8k), old colour size, MR / normal at half'};
  }
  if (tune.budget) budget = {...budget, ...tune.budget, rule: `${budget.rule}; TUNE: ${tune.budget.reason}`};
  return {id: master.id, cls, p7Key, p7SizeClass: p7Out?.sizeClass ?? null, runtimeKeys: master.runtimeKeys, oldPath, outRel: `game/public/assets/models/${oldBase}-t25.glb`, url: `assets/models/${oldBase}-t25.glb`,
    fit: tune.fit ?? (cls === 'items' ? 'uniform-height' : 'footprint'), fitReason: tune.reason ?? null, dims, anchor, budget, old: {tris: oldTris, bbox: {min: ob.min.map(r4), max: ob.max.map(r4), size: ob.size.map(r4)}, bytes: master.current?.bytes ?? null, textures: master.current?.textures ?? null, sha256: master.current?.sha256 ?? null},
    yawQuarter: tune.yawQuarter ?? null, yawDeg: tune.yawDeg ?? null, patch: tune.patch ?? null, doubleSided: tune.doubleSided ?? null, limitations: tune.limitations ?? [], tool: TOOL_VERSION};
}

// ---- build one --------------------------------------------------------------------------------------------------------
async function buildOne(master, del, p7, {glbOut, reviewOut, dev = false}) {
  const t0 = Date.now();
  const cfg = await configFor(master, p7);
  const nativeAbs = path.isAbsolute(del.nativeGlb) ? del.nativeGlb : path.join(ASSETS, del.nativeGlb);
  const nativeBytes = fs.readFileSync(nativeAbs), nativeSha = sha256(nativeBytes);
  if (del.sha256 && del.sha256 !== nativeSha) throw new Error(`${cfg.id}: native sha256 mismatch (${nativeSha} != delivered ${del.sha256})`);
  const imgPath = master.originalImage?.absPath;
  if (!imgPath || !fs.existsSync(imgPath)) throw new Error(`${cfg.id}: original image missing`);
  const imgSha = sha256(fs.readFileSync(imgPath));
  if (del.inputImageSha256 && del.inputImageSha256 !== imgSha) throw new Error(`${cfg.id}: input image sha256 differs from the submitted one`);
  log(`\n== ${cfg.id} [${cfg.cls}${cfg.p7SizeClass ? ` ${cfg.p7SizeClass}` : ''}] <- ${rel(nativeAbs)} (task ${del.taskId ?? '?'})`);
  const nat = await readMesh(nativeBytes);
  if (!nat.material.color) throw new Error(`${cfg.id}: native has no base colour texture`);
  const natTex = await decodeRGB(nat.material.color.bytes);
  const natStats = {triangles: nat.I.length / 3, vertices: nat.P.length / 3, bbox: bbox(nat.P).size.map(r4), ...meshStats(nat.P, nat.I), mr: nat.material.mr ? await mrStats(nat.material.mr.bytes) : null,
    textures: ['color', 'mr', 'normal'].map(k => nat.material[k] && {slot: k, mime: nat.material[k].mime, size: nat.material[k].size, bytes: nat.material[k].bytes.length}).filter(Boolean)};
  // Orientation: Meshy front +Z / up +Y; the front check (vs the ORIGINAL image) may turn it by quarter turns on a clear margin.
  const fc = await frontCheck(nat, natTex, imgPath);
  let q = 0;
  if (cfg.yawQuarter !== null) q = cfg.yawQuarter;
  // (only on a confident match: a perspective / 3/4 product shot matches no orthographic side and must not turn the model)
  else if (fc.best !== 'front' && fc.scores[fc.best].score > 0.5 && fc.scores[fc.best].score - fc.scores.front.score > 0.15) q = {front: 0, left: 1, back: 2, right: 3}[fc.best];
  // Items rest the way the old model did (shelf slots / ITEM_DIMS: w = X, d = Z): a quarter turn when the long horizontal axis
  // disagrees with the old runtime model's (flat bars, bags).
  let itemTurn = false;
  if (cfg.cls === 'items' && cfg.yawQuarter === null) {
    const b = bbox(apply(nat.P, rotYQuarter(q))), o = cfg.old.bbox.size, longX = v => v[0] > 1.25 * v[2] ? 1 : v[2] > 1.25 * v[0] ? -1 : 0;
    if (longX(o) && longX(b.size) && longX(o) !== longX(b.size)) { q = (q + 1) % 4; itemTurn = true; }
  }
  log(`  front check: best '${fc.best}' (${JSON.stringify(Object.fromEntries(Object.entries(fc.scores).map(([k, v]) => [k, v.score])))}) -> yaw quarter ${q}${cfg.yawQuarter !== null ? ' (TUNE)' : ''}${itemTurn ? ' (item long axis aligned with the old model)' : ''}`);
  let R = rotYQuarter(q);
  // Box-like props: squaring yaw (min-area footprint, +-10 deg) when it shrinks the footprint by > 1.5% (Meshy is usually square-on).
  let yawRefine = cfg.yawDeg ?? 0;
  if (cfg.yawDeg === null && cfg.cls === 'props') {
    const P1 = apply(nat.P, R), d = minAreaYaw(P1), area = deg => { const b = bbox(apply(P1, rotYDeg(deg))); return b.size[0] * b.size[2]; };
    if (Math.abs(d) >= 0.5 && area(d) < 0.985 * area(0)) yawRefine = d;
  }
  if (yawRefine) R = mul3(rotYDeg(yawRefine), R);
  // Simplify first (seams kept) on the oriented mesh at uniform metric scale (error in metres), THEN fit the simplified mesh's
  // own bbox exactly to the target (vertex removal can move the extremes by millimetres).
  const bR0 = bbox(apply(nat.P, R)), pre = cfg.dims[1] / bR0.size[1];
  const oriented = {P: apply(nat.P, R, [pre, pre, pre]), N: applyN(nat.N, R, [1, 1, 1]), UV: nat.UV, I: nat.I};
  const low0 = await simplifyKeepUV(oriented, cfg.budget.tris);
  if (low0.I.length / 3 > cfg.budget.tris) {   // attribute seams stop the collapse: accept up to +10%, recorded
    if (low0.I.length / 3 > 1.1 * cfg.budget.tris) throw new Error(`${cfg.id}: simplification stalls at ${low0.I.length / 3} tris (budget ${cfg.budget.tris}); TUNE a budget`);
    cfg.budget = {...cfg.budget, requestedTris: cfg.budget.tris, tris: low0.I.length / 3, seamLimited: true};
  }
  const bR = bbox(low0.P);
  // Fit: footprint = per-axis to the old box; uniform-height (items) / uniform-width (light) = one uniform scale.
  const uni = cfg.dims[1] / bR.size[1];
  const uw = cfg.dims[0] / bR.size[0];
  const S = cfg.fit === 'footprint' ? [0, 1, 2].map(k => cfg.dims[k] / bR.size[k]) : cfg.fit === 'uniform-width' ? [uw, uw, uw] : [uni, uni, uni];
  const rel3 = S.map(s => r4(s / uni));
  if (cfg.fit !== 'footprint') cfg.dims = bR.size.map((v, k) => r4(v * S[k]));
  const t = [-S[0] * bR.center[0], cfg.anchor === 'top' ? -S[1] * bR.max[1] : -S[1] * bR.min[1], -S[2] * bR.center[2]];
  const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let low = {...low0, P: apply(low0.P, I3, S, t), N: applyN(low0.N, I3, S)};
  // TUNE patch: close a reconstruction hole with quads (output frame) textured from the model's own atlas at a nearby surface.
  let patchInfo = null;
  if (cfg.patch) {
    const P = Array.from(low.P), N = Array.from(low.N), UV = Array.from(low.UV), I = Array.from(low.I);
    patchInfo = cfg.patch.quads.map(q => {
      let best = -1, bd = Infinity;
      for (let f = 0; f < low.I.length; f += 3) {
        const c = [0, 1, 2].map(k => (low.P[3 * low.I[f] + k] + low.P[3 * low.I[f + 1] + k] + low.P[3 * low.I[f + 2] + k]) / 3), d = Math.hypot(c[0] - q.uvAt[0], c[1] - q.uvAt[1], c[2] - q.uvAt[2]);
        if (d < bd) { bd = d; best = f; }
      }
      const u0 = (low.UV[2 * low.I[best]] + low.UV[2 * low.I[best + 1]] + low.UV[2 * low.I[best + 2]]) / 3, v0 = (low.UV[2 * low.I[best] + 1] + low.UV[2 * low.I[best + 1] + 1] + low.UV[2 * low.I[best + 2] + 1]) / 3, e = 0.002;
      const base = P.length / 3, uvs = [[u0 - e, v0 + e], [u0 + e, v0 + e], [u0 + e, v0 - e], [u0 - e, v0 - e]];
      q.c.forEach((v, k) => { P.push(...v); N.push(...q.n); UV.push(...uvs[k]); });
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      return {name: q.name, corners: q.c, normal: q.n, uvFrom: q.uvAt, uvSourceDistanceM: r4(bd)};
    });
    low = {...low, P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I: Uint32Array.from(I)};
  }
  const full = {P: apply(oriented.P, I3, S, t), I: oriented.I};   // full-resolution native in the same frame (measurement)
  const surfaces = cfg.cls === 'props' && cfg.anchor === 'bottom' ? supportSurfaces(full.P, full.I, bbox(full.P)) : [];
  const Stotal = S.map(v => v * pre);   // native -> output scale per axis (provenance)
  const outBB = bbox(low.P);
  const lowStats = meshStats(low.P, low.I);
  // Closed shells stay single-sided (the game convention); open shells (> 1% boundary edges: thin brackets, handles, tube ends)
  // render double-sided so no see-through holes appear.
  const doubleSided = cfg.doubleSided ?? (lowStats.boundaryEdges > 0.01 * lowStats.edges);
  // Textures: downsized from Meshy's 2048 maps, JPEG; tiers until under the byte budget.
  const tiers = [[86, 88, 90], [80, 82, 86], [74, 76, 82], [66, 70, 76], [58, 62, 70]];
  let glb, textures, tierUsed, hybrid = null;
  const status = 'prototype runtime derivative of a reference-conditioned Meshy T2.5 image-to-3d output (lane MESHY accepted); no license clearance asserted';
  for (const [qc, qm, qn] of tiers) {
    textures = {color: await resizeJpeg(nat.material.color.bytes, cfg.budget.color, qc, 'color'), orm: nat.material.mr ? await resizeJpeg(nat.material.mr.bytes, cfg.budget.mr, qm, 'mr') : null, normal: nat.material.normal ? await resizeJpeg(nat.material.normal.bytes, cfg.budget.normal, qn, 'normal') : null};
    if (!textures.orm) throw new Error(`${cfg.id}: native has no metallic-roughness texture`);
    const extras = {sourceId: cfg.id, meshyTaskId: del.taskId ?? null, nativeSha256: nativeSha, inputImageSha256: imgSha, units: 'meters', front: '+Z', up: '+Y', origin: cfg.anchor === 'top' ? 'top-centre (hangs below y = 0)' : 'bottom-centre (y = 0 floor contact)', status, pipeline: 'tools/asset-pipeline/props/build-meshy-t25.mjs'};
    if (HYBRID[cfg.id]) {
      const H = HYBRID[cfg.id];
      hybrid = await assembleOpenFront(H.spec, {P: low.P, N: low.N, UV: low.UV, I: low.I, tex: textures, metallic: nat.material.metallicFactor, roughness: nat.material.roughnessFactor},
        bb => ({...extras, provisionalDimensionsMeters: bb.size, hybrid: `${H.name}: T2.5 exterior cut + authored interior / wire shelves / glass (open-front-iteration05.mjs)`, glassNode: 'glass (alphaMode BLEND; decorative only, never blocks item picking)'}));
      glb = hybrid.bytes;
    } else glb = await writeMeshGlb({name: path.basename(cfg.outRel, '.glb'), mesh: {pos: low.P, nrm: low.N, uv: low.UV, idx: low.I}, textures, material: {metallicFactor: nat.material.metallicFactor, roughnessFactor: nat.material.roughnessFactor}, doubleSided, extras});
    tierUsed = [qc, qm, qn];
    if (glb.length <= cfg.budget.bytes) break;
  }
  const overBudget = glb.length > cfg.budget.bytes;
  // write
  const abs = path.resolve(glbOut);
  if (dev) { if (!outDir || !abs.startsWith(path.resolve(outDir) + path.sep)) throw new Error('dev mode writes only into --out-dir'); }
  else if (!(path.dirname(abs) === MODELS_DIR && /^[a-z0-9-]+-t25\.glb$/.test(path.basename(abs)))) throw new Error(`refusing to write ${abs}`);
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs + '.tmp', glb); fs.renameSync(abs + '.tmp', abs);
  const gpu = Math.round(4 * 4 / 3 * (cfg.budget.color ** 2 + cfg.budget.mr ** 2 + cfg.budget.normal ** 2));
  log(`  wrote ${rel(abs)} ${glb.length} B (budget ${cfg.budget.bytes}${overBudget ? ' OVER' : ''}), ${low.I.length / 3} tris (native ${natStats.triangles}, old ${cfg.old.tris}), ${outBB.size.map(v => v.toFixed(3)).join(' x ')} m, stretch vs uniform ${rel3.join('/')}, doubleSided ${doubleSided}, ${surfaces.length} surfaces (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  // review sheet
  let review = null;
  if (reviewOut) review = await reviewSheet(cfg, {imgPath, nat, natTex, low, tex: await decodeRGB(textures.color.bytes), oldPath: cfg.oldPath}, reviewOut);
  const restoreBlob = dev ? null : gitBlobSha(cfg.oldPath);
  return {
    id: cfg.id, runtimeKeys: cfg.runtimeKeys, ...(cfg.p7Key ? {p7Key: cfg.p7Key, p7SizeClass: cfg.p7SizeClass} : {}), class: master.class,
    output: {path: rel(abs), url: cfg.url, sha256: sha256(glb), bytes: glb.length, triangles: hybrid ? hybrid.body.kept + hybrid.g.tris + hybrid.gidx.length / 3 : low.I.length / 3, vertices: low.P.length / 3,
      textures: ['color', 'orm', 'normal'].map(k => ({slot: {color: 'baseColor', orm: 'metallicRoughness', normal: 'normal'}[k], size: textures[k].size, mime: textures[k].mime, bytes: textures[k].bytes.length})),
      gpuTextureBytesEstimate: gpu, doubleSided, dims: outBB.size.map(r4), bbox: {min: outBB.min.map(r4), max: outBB.max.map(r4)}, budget: {...cfg.budget, overBudget, jpegQuality: tierUsed}},
    meshy: {taskId: del.taskId ?? null, attempt: del.attempt ?? null, review: del.review ?? null, reviewNote: del.reviewNote ?? null, args: del.args ?? null,
      nativeGlb: rel(nativeAbs), nativeSha256: nativeSha, nativeBytes: nativeBytes.length, native: natStats,
      inputImage: {path: rel(imgPath), sha256: imgSha, role: master.originalImage.role}},
    transform: {description: "p_out = diag(S) * Ryaw * p_native + t (baked into the vertices; node transform identity). Meshy native: +Y up, front +Z.", yawQuarter: q, yawRefineDeg: r4(yawRefine), R: R.map(r => r.map(r6)), S: Stotal.map(r6), t: t.map(r6),
      fit: cfg.fit === 'footprint' ? `per-axis to the existing footprint ${cfg.dims.join(' x ')} m (${cfg.p7Key ? 'P7_PROP_DEFS / catalog dims' : 'old runtime bbox'})`
        : cfg.fit === 'uniform-width' ? `uniform: width ${cfg.dims[0]} m (old runtime width) -> ${cfg.dims.join(' x ')} m. ${cfg.fitReason ?? ''}`
          : `uniform: height ${cfg.dims[1]} m (old runtime height) -> ${cfg.dims.join(' x ')} m; world/pickups.ts fitItemModel fits ITEM_DIMS at runtime`,
      oldDims: cfg.old.bbox.size,
      stretchVsUniformHeight: rel3, anchor: cfg.anchor, frontCheck: fc},
    tune: TUNE[cfg.id] ?? null, simplify: low.simplify, meshAfter: lowStats, ...(patchInfo ? {patch: {reason: cfg.patch.reason, quads: patchInfo}} : {}),
    ...(hybrid ? {hybrid: {spec: HYBRID[cfg.id].name, nodes: ['body', 'interior', 'glass'], trianglesByNode: {body: hybrid.body.kept, interior: hybrid.g.tris, glass: hybrid.gidx.length / 3}, cut: {removedFaces: hybrid.body.removed, removedAreaM2: hybrid.body.removedAreaM2, rule: HYBRID[cfg.id].spec.cut.toString()},
      interior: HYBRID[cfg.id].spec.interior, interiorSurfaces: hybrid.surfaces, authoredParts: hybrid.g.parts.length, note: 'iteration-05 open-front hybrid rebuilt on the T2.5 exterior: authored liner / deck / wire shelves or trays / bezel or posts / emissive strip + a separate transparent "glass" node (BLEND); interior loot surfaces unchanged'}} : {}),
    surfaces, ...(cfg.p7Key ? {catalog: {url: cfg.url, bytes: glb.length, w: cfg.dims[0], h: cfg.dims[1], d: cfg.dims[2], tris: low.I.length / 3, tex: cfg.budget.color, gpuBytes: gpu, surfaces}} : {}),
    conventions: {units: 'meters', up: '+Y', front: '+Z', origin: cfg.anchor === 'top' ? 'top-centre (y = 0 mounting face; hangs below)' : 'bottom-centre (y = 0 floor contact; x/z bbox centre)'},
    replaces: {path: cfg.oldPath, sha256: cfg.old.sha256, bytes: cfg.old.bytes, triangles: cfg.old.tris, textures: cfg.old.textures, bbox: cfg.old.bbox},
    restore: {path: cfg.oldPath, baseCommit: BASE, blobSha1: restoreBlob, command: `git show ${BASE}:${cfg.oldPath} > ${cfg.oldPath}`},
    review: review ? rel(review) : null,
    limitations: [
      'Single-image AI reconstruction (Meshy T2.5 image-to-3d) conditioned on the original front / reference image: back, sides and underside are inferred.',
      ...(cfg.fit === 'footprint' && rel3.some(v => Math.abs(v - 1) > 0.2) ? [`Fitted per axis to the existing gameplay footprint; relative stretch vs a uniform height fit ${rel3.join(' / ')} (x / y / z).`] : []),
      ...(low.simplify.applied ? [`Simplified from ${low.simplify.fromTriangles} to ${low.I.length / 3} triangles (Meshy UVs / seams kept).`] : []),
      'Prototype derivative: no commercial / model licence clearance asserted. Labels / graphics are fictional AI designs.',
      ...cfg.limitations,
    ],
    tool: TOOL_VERSION,
  };
}

// ---- review sheet: original image | old runtime front, 3/4 | new runtime front, right, back, 3/4, from above-behind ---------
async function reviewSheet(cfg, {imgPath, low, tex, oldPath}, out) {
  const N = 256, tiles = [], labels = [];
  const bg = [52, 52, 52];
  const toRGB = img => { const rgb = Buffer.alloc(N * N * 3); for (let i = 0; i < N * N; i++) { rgb[3 * i] = img.data[4 * i]; rgb[3 * i + 1] = img.data[4 * i + 1]; rgb[3 * i + 2] = img.data[4 * i + 2]; } return rgb; };
  tiles.push(await sharp(imgPath).resize(N, N, {fit: 'contain', background: {r: bg[0], g: bg[1], b: bg[2], alpha: 1}}).flatten({background: {r: bg[0], g: bg[1], b: bg[2]}}).removeAlpha().raw().toBuffer()); labels.push('original image');
  try {
    const old = await readMesh(gitBlob(oldPath)), otex = await decodeRGB(old.material.color.bytes);
    tiles.push(toRGB(rasterize(old.P, old.I, old.UV, otex, VIEWS.front, N, {bg}))); labels.push('OLD front');
    tiles.push(toRGB(rasterize(old.P, old.I, old.UV, otex, viewYawPitch(35, 18), N, {bg}))); labels.push('OLD 3/4');
  } catch (e) { log(`  (old model render skipped: ${e.message})`); }
  const views = cfg.anchor === 'top' ? [[VIEWS.front, 'NEW front'], [viewYawPitch(0, -35), 'NEW from below'], [VIEWS.right, 'NEW right'], [viewYawPitch(35, -18), 'NEW 3/4 below']]
    : [[VIEWS.front, 'NEW front'], [VIEWS.right, 'NEW right'], [VIEWS.back, 'NEW back'], [viewYawPitch(35, 18), 'NEW 3/4'], [viewYawPitch(-140, 30), 'NEW above-behind']];
  for (const [V, l] of views) { tiles.push(toRGB(rasterize(low.P, low.I, low.UV, tex, V, N, {bg}))); labels.push(l); }
  // Grid of 4 columns; a title bar, then per row a label strip and the tiles.
  const C = 4, rows = Math.ceil(tiles.length / C), LH = 18, TH = 24, W = C * N, H = TH + rows * (LH + N);
  const comps = [];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202020"/><text x="6" y="17" font-family="DejaVu Sans, sans-serif" font-size="14" fill="#ffd27a">${esc(cfg.id)} · Meshy T2.5 runtime ${low.I.length / 3} tris (old ${cfg.old.tris}) · ${cfg.dims.join(' × ')} m · ${cfg.budget.color}px</text>`;
  tiles.forEach((tb, i) => {
    const x = (i % C) * N, y = TH + Math.floor(i / C) * (LH + N);
    svg += `<text x="${x + 6}" y="${y + 13}" font-family="DejaVu Sans, sans-serif" font-size="12" fill="#e8e8e8">${esc(labels[i])}</text>`;
    comps.push({tb, x, y: y + LH});
  });
  svg += '</svg>';
  const layers = [{input: Buffer.from(svg), top: 0, left: 0}];
  for (const c of comps) layers.push({input: await sharp(c.tb, {raw: {width: N, height: N, channels: 3}}).png().toBuffer(), top: c.y, left: c.x});
  fs.mkdirSync(path.dirname(out), {recursive: true});
  await sharp({create: {width: W, height: H, channels: 3, background: '#202020'}}).composite(layers).png().toFile(out);
  return out;
}

// ---- provenance / catalog ---------------------------------------------------------------------------------------------
const PROV_HEAD = {
  schema: 'terminal-state-meshy-t25-derivatives-v1', task: TASK_ID, lane: 'PROPS', baseCommit: BASE,
  status: 'Runtime derivatives of reference-conditioned Meshy T2.5 image-to-3d outputs (each conditioned on the master\'s ORIGINAL front / reference image; lane MESHY review: accepted). Prototype art; no commercial / model licence clearance asserted.',
  rebuild: 'node tools/asset-pipeline/props/build-meshy-t25.mjs [--only <id>,<id>] [--force]',
  rawStorage: 'Native Meshy GLBs, thumbnails, task records and the submission ledger stay OUTSIDE Git in reference/tasks/meshy-game-replacement-20261029/assets/ (raw/<id>/<attempt>/native.glb, ledger.jsonl, DELIVERED.json).',
  conventions: {units: 'meters', up: '+Y', front: '+Z', files: 'plain glTF 2.0 binary (no Draco / meshopt / KTX2); new flat path <old-basename>-t25.glb (cache-busting); logical runtime keys unchanged'},
  restoreNote: 'Every replaced runtime file is tracked at the pushed base commit; restore = record.restore.command (git show <base>:<path>).',
  tool: TOOL_VERSION,
};
function writeProvenance(cls, records) {
  const doc = {...PROV_HEAD, class: cls, counts: {records: records.length, bytes: records.reduce((s, r) => s + r.output.bytes, 0), triangles: records.reduce((s, r) => s + r.output.triangles, 0), replacedBytes: records.reduce((s, r) => s + (r.replaces.bytes ?? 0), 0), replacedTriangles: records.reduce((s, r) => s + (r.replaces.triangles ?? 0), 0)}, records: records.slice().sort((a, b) => a.id.localeCompare(b.id))};
  const f = PROV[cls]; fs.writeFileSync(f + '.tmp', JSON.stringify(doc, null, 2) + '\n'); fs.renameSync(f + '.tmp', f);
  return f;
}
const loadRecords = cls => (fs.existsSync(PROV[cls]) ? readJson(PROV[cls]).records ?? [] : []);
/**
 * Retire (never delete) the older per-asset provenance of every replaced runtime file: each older derivatives file that names the
 * replaced path gets a `supersededByMeshyT25` block (replacement, new provenance, restore command). Idempotent; key order kept.
 */
const OLD_PROVENANCE = ['props.json', 'props-iteration02.json', 'props-iteration03.json', 'props-iteration04.json', 'props-iteration05.json', 'props-iteration07.json', 'light-lod-iteration04.json']
  .map(f => path.join(REPO, 'game/public/assets/derivatives', f));
function markSuperseded(all) {
  for (const f of OLD_PROVENANCE) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8'), doc = JSON.parse(text);
    const files = {};
    for (const [cls, recs] of Object.entries(all)) for (const r of recs) {
      const oldRel = r.replaces.path.replace(/^game\/public\//, '');
      if (!text.includes(`"${oldRel}"`) && !text.includes(`"${r.replaces.path}"`)) continue;
      files[r.replaces.path] = {id: r.id, replacedBy: r.output.path, provenance: rel(PROV[cls]), restoreBlobSha1: r.restore.blobSha1, restore: r.restore.command};
    }
    if (!Object.keys(files).length && !doc.supersededByMeshyT25) continue;
    doc.supersededByMeshyT25 = {
      note: `Runtime files listed here were REPLACED by reference-conditioned Meshy T2.5 derivatives (task ${TASK_ID}) and are removed from the current game tree once their replacement is integrated; their records below stay as history. Restore any of them from Git at the pushed base commit ${BASE}.`,
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    };
    const out = JSON.stringify(doc, null, 2) + '\n';
    if (out !== text) { fs.writeFileSync(f + '.tmp', out); fs.renameSync(f + '.tmp', f); log(`  marked ${Object.keys(files).length} superseded file(s) in ${rel(f)}`); }
  }
}
/**
 * Live registry switch for the earlier props / items / light (game/src/assets/manifest.ts MODEL_FILES): the url (+ progress
 * weight) of each built record's runtime key on its own line; nothing else in the file is touched. p7 kinds switch through the
 * generated catalog instead. Returns the keys changed.
 */
const MANIFEST = path.join(REPO, 'game/src/assets/manifest.ts');
function switchManifest(all) {
  let text = fs.readFileSync(MANIFEST, 'utf8');
  const changed = [];
  for (const recs of Object.values(all)) for (const r of recs) {
    if (r.p7Key) continue;
    for (const key of r.runtimeKeys) {
      const re = new RegExp(`^(\\s*${key}: \\{url: ')([^']+)(', bytes: )([\\d_]+)(\\})`, 'm');
      const m = text.match(re);
      if (!m) throw new Error(`manifest.ts: no MODEL_FILES line for ${key}`);
      const bytes = (Math.ceil(r.output.bytes / 1000) * 1000).toLocaleString('en-US').replace(/,/g, '_');
      if (m[2] === r.output.url && m[4] === bytes) continue;
      text = text.replace(re, `$1${r.output.url}$3${bytes}$5`);
      changed.push(key);
    }
  }
  if (changed.length) { fs.writeFileSync(MANIFEST + '.tmp', text); fs.renameSync(MANIFEST + '.tmp', MANIFEST); log(`  manifest.ts: switched ${changed.join(', ')}`); }
  return changed;
}
function writeCatalog() {
  const src = p7CatalogSource(p7Prov().outputs, t25CatalogOverrides(REPO));
  fs.writeFileSync(CATALOG + '.tmp', src); fs.renameSync(CATALOG + '.tmp', CATALOG);
}

// ---- main ---------------------------------------------------------------------------------------------------------------
async function main() {
  const inv = inventory(), byId = new Map(inv.masters.map(m => [m.id, m])), del = delivered().assets ?? {}, p7 = p7Prov();
  const mine = inv.masters.filter(m => CLASS_OF[m.class]);
  if (args.includes('--list')) {
    const built = new Map(['props', 'items', 'light'].flatMap(c => loadRecords(c).map(r => [r.id, r])));
    for (const m of mine) { const d = del[m.id]; log(`${m.id.padEnd(34)} ${m.class.padEnd(16)} ${(d ? `${d.status}/${d.review}` : '-').padEnd(26)} ${built.has(m.id) ? `built ${built.get(m.id).output.path}` : ''}`); }
    return;
  }
  if (arg('--contact')) {   // compact review: one row per built id (original | NEW front | NEW 3/4 | NEW back | OLD 3/4)
    const want = arg('--ids')?.split(',') ?? null;
    const recs = ['props', 'items', 'light'].flatMap(c => loadRecords(c)).filter(r => !want || want.includes(r.id)).sort((a, b) => a.id.localeCompare(b.id));
    const N = 200, bg = [52, 52, 52], LH = 16, layers = [];
    const toPng = img => { const rgb = Buffer.alloc(N * N * 3); for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) rgb[3 * i + k] = img.data[4 * i + k]; return sharp(rgb, {raw: {width: N, height: N, channels: 3}}).png().toBuffer(); };
    let svg = '';
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i], y = i * (N + LH), m = byId.get(r.id);
      svg += `<text x="4" y="${y + 12}" font-family="DejaVu Sans, sans-serif" font-size="12" fill="#ffd27a">${r.id} · ${r.output.triangles} tris (native ${r.meshy.native.triangles}, old ${r.replaces.triangles}) · ${r.output.dims.join('×')} m · stretch ${r.transform.stretchVsUniformHeight.join('/')}${r.output.doubleSided ? ' · 2-sided' : ''}</text>`;
      layers.push({input: await sharp(path.join(REPO, m.originalImage.path)).resize(N, N, {fit: 'contain', background: {r: bg[0], g: bg[1], b: bg[2], alpha: 1}}).flatten({background: {r: bg[0], g: bg[1], b: bg[2]}}).png().toBuffer(), left: 0, top: y + LH});
      const nm = await readMesh(fs.readFileSync(path.join(REPO, r.output.path))), nt = await decodeRGB(nm.material.color.bytes);
      const vs = r.transform.anchor === 'top' ? [VIEWS.front, viewYawPitch(0, -35), viewYawPitch(35, -18)] : [VIEWS.front, viewYawPitch(35, 18), VIEWS.back];
      for (let k = 0; k < vs.length; k++) layers.push({input: await toPng(rasterize(nm.P, nm.I, nm.UV, nt, vs[k], N, {bg})), left: (k + 1) * N, top: y + LH});
      try { const om = await readMesh(gitBlob(r.replaces.path)), ot = await decodeRGB(om.material.color.bytes); layers.push({input: await toPng(rasterize(om.P, om.I, om.UV, ot, r.transform.anchor === 'top' ? viewYawPitch(35, -18) : viewYawPitch(35, 18), N, {bg})), left: 4 * N, top: y + LH}); } catch { /* old file not readable */ }
    }
    const W = 5 * N, H = recs.length * (N + LH);
    layers.unshift({input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202020"/>${svg}</svg>`), left: 0, top: 0});
    await sharp({create: {width: W, height: H, channels: 3, background: '#202020'}}).composite(layers).png().toFile(arg('--contact'));
    log(`contact sheet ${arg('--contact')}: ${recs.length} rows (original | NEW front | NEW 3/4 | NEW back | OLD 3/4)`);
    return;
  }
  if (devId) {
    const m = byId.get(devId); if (!m) throw new Error(`unknown id ${devId}`);
    const d = {...(del[devId] ?? {}), ...(arg('--native') ? {nativeGlb: path.resolve(arg('--native')), sha256: null} : {})};
    if (!d.nativeGlb) { const a = fs.readdirSync(path.join(ASSETS, 'raw', devId)).sort().pop(); d.nativeGlb = path.join(ASSETS, 'raw', devId, a, 'native.glb'); d.attempt = a; }
    const base = devId.replace(/[^A-Za-z0-9]+/g, '_');
    const rec = await buildOne(m, d, p7, {glbOut: path.join(outDir, `${base}-t25.glb`), reviewOut: path.join(outDir, `${base}.png`), dev: true});
    fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(rec, null, 2));
    return;
  }
  const records = {props: loadRecords('props'), items: loadRecords('items'), light: loadRecords('light')};
  let built = 0; const failed = [], skipped = [];
  for (const m of mine) {
    if (only && !only.includes(m.id)) continue;
    const d = del[m.id];
    if (!d || d.status !== 'SUCCEEDED' || d.review !== 'accepted') { if (only) skipped.push({id: m.id, reason: d ? `${d.status}/${d.review}` : 'not delivered'}); continue; }
    const cls = CLASS_OF[m.class], prev = records[cls].find(r => r.id === m.id);
    if (!force && prev && prev.meshy.nativeSha256 === d.sha256 && prev.tool === TOOL_VERSION && fs.existsSync(path.join(REPO, prev.output.path)) && sha256(fs.readFileSync(path.join(REPO, prev.output.path))) === prev.output.sha256) continue;
    try {
      const base = m.id.replace(/[^A-Za-z0-9]+/g, '_');
      const cfgPath = path.join(REPO, 'game/public/assets/models', `${path.basename(m.runtimePaths[0], '.glb')}-t25.glb`);
      const rec = await buildOne(m, d, p7, {glbOut: cfgPath, reviewOut: path.join(REVIEW, `${base}.png`)});
      records[cls] = records[cls].filter(r => r.id !== m.id).concat([rec]);
      writeProvenance(cls, records[cls]);
      if (rec.p7Key) writeCatalog();
      built++;
    } catch (e) { failed.push({id: m.id, error: e.message}); log(`  FAILED ${m.id}: ${e.stack ?? e}`); }
  }
  markSuperseded(records);
  if (!args.includes('--no-registry')) switchManifest(records);
  log(`\nbuilt ${built}; failed ${failed.length}; skipped ${skipped.length}`);
  if (skipped.length) log('skipped:', JSON.stringify(skipped));
  if (failed.length) { log('failed:', JSON.stringify(failed)); process.exitCode = 2; }
}
await main();
