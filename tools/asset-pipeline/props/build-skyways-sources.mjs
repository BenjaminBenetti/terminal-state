// Task skyways-level-20261106-054448 (lane ASSET-A): runtime derivatives of the user-supplied COMMUNITY Meshy models for the Skyways level
// (sky-ways.zip, delivered by the user): food pickups (ramen bowls, bubble tea, sushi bento), the sushi-mascot figurine, kitchen gear
// (stock pot, saucepan, commercial range) and the street wrecks seen through the bridge glass.
//
// Reads (never modifies) the read-only masters kept OUTSIDE Git:
//   reference/tasks/skyways-level-20261106-054448/masters/<file>.glb + ../MASTERS-SHA256.json (each master's bytes / sha256 verified)
// (a git worktree has no reference/: the main checkout's copy is used; `--masters <dir>` overrides) and writes deterministically:
//   game/public/assets/models/<id>.glb             plain glTF binary (no Draco / meshopt / KTX2), one node / mesh / primitive / material
//   game/public/assets/derivatives/<id>.json       provenance (archive member name, hashes, counts, transform, simplify settings)
//   game/src/assets/skywaysProps.generated.ts      SKYWAYS_PROP_MODELS {url, w, h, d, tris} (three-free; measured runtime bounds)
//   tools/release/public-inputs.json               ONLY this builder's entries added / updated (format and order kept)
//
// Per row: exact-attribute weld (+ degenerate triangles dropped) -> optional half turn about Y (wrecks: nose at +X, the office wreck
// convention) -> geometry to the triangle budget -> UNIFORM scale so the row's reference measure hits its real size, grounded
// (min y = 0), centred on x / z, baked into the vertices (identity node). Geometry + textures, method 'source-uv' (preferred):
// meshoptimizer simplifyWithAttributes on the source buffer (source UVs / normals kept, UV seams preserved) and the SOURCE maps
// Lanczos-downsized + re-encoded JPEG (base colour q85). Method 'rebake' only where that cannot work: when the source atlas's UV charts
// pin the seam-preserving collapse above the budget (hundreds to thousands of charts) or leave it visibly crumpled (relative error >
// MAX_KEEP_ERROR) — geometry-only simplification, a fresh atlas and the source maps baked onto it (rebake() below). No new art either way.
// A source emissive map that is black everywhere is dropped (deadEmissive).
//
//   node --max-old-space-size=3072 tools/asset-pipeline/props/build-skyways-sources.mjs [--only id,id] [--masters <dir>]
// (--only rebuilds those rows; the registry / allowlist are always rewritten from every row's provenance on disk.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {simplifyGeometry} from './lib/dense.mjs';
import {unwrap} from './lib/unwrap.mjs';
import {bake} from './lib/bake.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = path.resolve(import.meta.dirname, '../../..');
const TASK_REL = 'reference/tasks/skyways-level-20261106-054448';
const PUB = path.join(ROOT, 'game/public');
const REG = path.join(ROOT, 'game/src/assets/skywaysProps.generated.ts');
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const TOOL = 'tools/asset-pipeline/props/build-skyways-sources.mjs';
const ARCHIVE = 'sky-ways.zip';
const LICENCE = `community-supplied source via the user (${ARCHIVE}); creator / license links pending; no license or authorship claim`;
const arg = k => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const ONLY = arg('--only') ? new Set(arg('--only').split(',')) : null;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r4 = v => +v.toFixed(4), r6 = v => +v.toFixed(6);

function mastersDir() {
  if (arg('--masters')) return path.resolve(arg('--masters'));
  const local = path.join(ROOT, TASK_REL, 'masters');
  if (fs.existsSync(local)) return local;
  // a lane worktree: reference/ lives (ignored) in the main checkout only
  const common = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir']).toString().trim();
  return path.join(path.dirname(common), TASK_REL, 'masters');
}
const MASTERS = mastersDir();
const MASTER_SHAS = JSON.parse(fs.readFileSync(path.join(MASTERS, '../MASTERS-SHA256.json'), 'utf8'));

/**
 * The rows. fit: the reference measure scaled to `size` metres —
 *   'x' / 'y' / 'z'  the full bounds extent on that axis;
 *   'maxXZ'          the longer horizontal side;
 *   'rim'            a bowl's rim diameter: the mean x / z extent of the geometry at or below `yFrac` of the height (food that
 *                    overhangs above the rim does not count).
 * tris: the triangle budget. tex: base-colour px, `other` px for every other source map. yaw180: half turn about Y (wrecks: nose -> +X).
 */
const ROWS = [
  {id: 'item-ramen-bowl', key: 'item_ramen_bowl', src: 'Meshy_AI_Ramen_Delight_1106035914_texture.glb',
    role: 'food pickup: ramen in a blue patterned bowl (inventory item, held in the hand)', fit: {kind: 'rim', size: 0.20, yFrac: 1}, tris: 4000, tex: {base: 512, other: 512},
    front: 'round bowl: source frame kept (front +Z)'},
  {id: 'item-ramen-chashu', key: 'item_ramen_chashu', src: 'Meshy_AI_Ramen_Delight_food__1106035919_texture.glb',
    role: 'food pickup: chashu ramen in a white bowl (inventory item, held in the hand)', fit: {kind: 'rim', size: 0.22, yFrac: 0.85}, tris: 4000, tex: {base: 512, other: 512},
    front: 'round bowl: source frame kept (front +Z); the nori overhangs the rim (source geometry)'},
  {id: 'item-bubble-tea', key: 'item_bubble_tea', src: 'Meshy_AI_Bubble_tea_cup_with_a_1106035926_texture.glb',
    role: 'food pickup: bubble tea cup with a straw (inventory item, held in the hand)', fit: {kind: 'y', size: 0.24}, tris: 3000, tex: {base: 512, other: 512},
    front: 'round cup: source frame kept (front +Z)'},
  {id: 'item-sushi-bento', key: 'item_sushi_bento', src: 'Meshy_AI__Japan_Bento_Sushi_B_1105041244_texture.glb',
    role: 'food pickup: sushi bento box (inventory item, held in the hand)', fit: {kind: 'maxXZ', size: 0.24}, tris: 3000, tex: {base: 512, other: 512},
    front: 'square wooden tray: source frame kept (front +Z)'},
  {id: 'skyways-sushi-mascot', key: 'skyways_sushi_mascot', src: 'Meshy_AI_Kawaii_Sushi_Mascot_3_1106035958_image-to-3d-texture.glb',
    role: 'display figurine: kawaii nigiri-sushi mascot with fans (restaurant counter / shelf decoration)', fit: {kind: 'y', size: 0.32}, tris: 6000, tex: {base: 512, other: 512},
    front: 'the face looks +Z in the source frame (kept)'},
  {id: 'skyways-stock-pot', key: 'skyways_stock_pot', src: 'Meshy_AI_stainless_steel_pot_1106040153_image-to-3d-texture.glb',
    role: 'kitchen prop: lidded stainless-steel stock pot', fit: {kind: 'x', size: 0.42}, tris: 3000, tex: {base: 512, other: 512},
    front: 'the two side handles lie along X (source frame kept; front +Z)'},
  {id: 'skyways-saucepan', key: 'skyways_saucepan', src: 'Meshy_AI_Rusty_saucepan_1106040321_texture.glb',
    role: 'kitchen prop: rusty saucepan with a long handle', fit: {kind: 'x', size: 0.46}, tris: 2500, tex: {base: 512, other: 512},
    front: 'the long handle points +X (source frame kept)'},
  {id: 'skyways-commercial-range', key: 'skyways_commercial_range', src: 'Meshy_AI_Commercial_Stainless__1106040414_texture.glb',
    role: 'kitchen fixture: commercial stainless range (burners + griddle, two ovens, backsplash)', fit: {kind: 'x', size: 1.52}, tris: 12000, tex: {base: 1024, other: 512},
    front: 'knobs / oven doors face +Z in the source frame (kept); the backsplash is at -Z'},
  {id: 'skyways-wreck-sedan-stripped', key: 'skyways_wreck_sedan_stripped', src: 'Meshy_AI_Rustbound_Relic_1106035207_texture.glb',
    role: 'street scenery: stripped red sedan shell (no doors / glass)', fit: {kind: 'x', size: 4.6}, tris: 12000, tex: {base: 1024, other: 512}, yaw180: true,
    front: "nose at +X (half turn: steering wheel, hood and front lamps at the source's -X end; trunk lid and round tail lamps at +X)"},
  {id: 'skyways-wreck-sedan-rust', key: 'skyways_wreck_sedan_rust', src: 'Meshy_AI_Rustbound_Relic_1106035225_texture.glb',
    role: 'street scenery: rusted white sedan', fit: {kind: 'x', size: 4.75}, tris: 12000, tex: {base: 1024, other: 512}, yaw180: true,
    front: "nose at +X (half turn: grille and crumpled headlights at the source's -X end; red tail lights and the plate at +X)"},
  {id: 'skyways-wreck-sedan-burnt', key: 'skyways_wreck_sedan_burnt', src: 'Meshy_AI_Charred_Car_Remnant_1106035237_texture.glb',
    role: 'street scenery: burnt-out sedan', fit: {kind: 'x', size: 4.75}, tris: 12000, tex: {base: 1024, other: 512}, yaw180: true,
    front: "nose at +X (half turn: crushed front and hood at the source's -X end; tail lamps, trunk lid and the plate recess at +X)"},
  {id: 'skyways-wreck-army-truck', key: 'skyways_wreck_army_truck', src: 'Meshy_AI_Bloodmarked_Convoy_1106035329_texture.glb',
    role: 'street scenery: abandoned six-wheel army cargo truck with a canvas cover', fit: {kind: 'x', size: 7.6}, tris: 15000, tex: {base: 1024, other: 512}, yaw180: true,
    front: "nose at +X (half turn: cab, windscreen and grille at the source's -X end; the canvas-covered cargo bed's tail at +X)"},
  {id: 'skyways-wreck-suv', key: 'skyways_wreck_suv', src: 'Meshy_AI_Forest_Relic_1106035528_texture.glb',
    role: 'street scenery: overgrown rusted SUV / station wagon', fit: {kind: 'x', size: 4.9}, tris: 12000, tex: {base: 1024, other: 512}, yaw180: true,
    front: "nose at +X (half turn: chrome grille and headlights at the source's -X end; round tail lamps and the rear hatch at +X)"},
];
const SIMPLIFY = {normalWeight: 0.5, uvWeight: 1, targetError: 1, tool: 'meshoptimizer 1.3 simplifyWithAttributes (normals x0.5 + UV x1 attribute weights; UV seams preserved; source UVs / normals kept)'};
/** Above this relative error the seam-preserving result is visibly crumpled (the bento tray at 0.128): the row is re-baked instead. */
const MAX_KEEP_ERROR = 0.05;
const BAKE_WORKERS = 6;

// ---------- source ----------
async function readSource(row) {
  const rec = MASTER_SHAS.find(m => m.file === row.src);
  if (!rec) throw new Error(`${row.id}: ${row.src} not in MASTERS-SHA256.json`);
  const bytes = fs.readFileSync(path.join(MASTERS, row.src));
  if (bytes.length !== rec.bytes || sha(bytes) !== rec.sha256) throw new Error(`${row.id}: master bytes / sha256 mismatch (${row.src})`);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
  const r = doc.getRoot();
  const nodes = r.listNodes().filter(n => n.getMesh());
  if (nodes.length !== 1 || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) throw new Error(`${row.id}: expected one node / mesh / material`);
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4) throw new Error(`${row.id}: expected one triangle primitive`);
  const p = prims[0], M = nodes[0].getWorldMatrix();
  if (M.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) throw new Error(`${row.id}: non-identity source node`);
  const P = Float32Array.from(p.getAttribute('POSITION').getArray()), N = Float32Array.from(p.getAttribute('NORMAL').getArray());
  const UV = Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), T = p.getAttribute('TANGENT') ? Float32Array.from(p.getAttribute('TANGENT').getArray()) : null;
  const I = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: P.length / 3}, (_, i) => i);
  const mat = r.listMaterials()[0];
  const slot = (name, t, info) => (t ? {slot: name, bytes: Buffer.from(t.getImage()), mime: t.getMimeType(), size: t.getSize(), info} : null);
  const maps = [slot('baseColor', mat.getBaseColorTexture(), mat.getBaseColorTextureInfo()), slot('metallicRoughness', mat.getMetallicRoughnessTexture(), mat.getMetallicRoughnessTextureInfo()),
    slot('normal', mat.getNormalTexture(), mat.getNormalTextureInfo()), slot('occlusion', mat.getOcclusionTexture(), mat.getOcclusionTextureInfo()),
    slot('emissive', mat.getEmissiveTexture(), mat.getEmissiveTextureInfo())].filter(Boolean);
  if (maps.some(m => (m.info?.getTexCoord() ?? 0) !== 0)) throw new Error(`${row.id}: a map uses TEXCOORD_1`);
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), occlusionStrength: mat.getOcclusionStrength(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  if (material.alphaMode !== 'OPAQUE') throw new Error(`${row.id}: non-opaque source material`);
  const b = bounds(P);
  return {member: rec.member, bytes: bytes.length, sha256: rec.sha256, P, N, UV, T, I, maps, material, triangles: I.length / 3, vertices: P.length / 3,
    extent: [0, 1, 2].map(k => r4(b.max[k] - b.min[k]))};
}

// ---------- geometry ----------
/** Exact-attribute weld (bitwise-equal position / normal / uv / tangent) + degenerate-triangle removal. */
function weld(m) {
  const nv = m.P.length / 3, tw = m.T ? 4 : 0, stride = 8 + tw;
  const A = new Float32Array(nv * stride);
  for (let v = 0; v < nv; v++) {
    const o = v * stride;
    A[o] = m.P[3 * v]; A[o + 1] = m.P[3 * v + 1]; A[o + 2] = m.P[3 * v + 2]; A[o + 3] = m.N[3 * v]; A[o + 4] = m.N[3 * v + 1]; A[o + 5] = m.N[3 * v + 2];
    A[o + 6] = m.UV[2 * v]; A[o + 7] = m.UV[2 * v + 1];
    if (tw) for (let k = 0; k < 4; k++) A[o + 8 + k] = m.T[4 * v + k];
  }
  const U = new Uint32Array(A.buffer);
  let cap = 1; while (cap < nv * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), first = [];
  for (let v = 0; v < nv; v++) {
    let h = 2166136261;
    for (let k = 0; k < stride; k++) { h ^= U[v * stride + k]; h = Math.imul(h, 16777619); }
    let slotI = (h >>> 0) & (cap - 1);
    for (;;) {
      const w = table[slotI];
      if (w < 0) { table[slotI] = first.length; remap[v] = first.length; first.push(v); break; }
      const f = first[w];
      let eq = true;
      for (let k = 0; k < stride; k++) if (U[f * stride + k] !== U[v * stride + k]) { eq = false; break; }
      if (eq) { remap[v] = w; break; }
      slotI = (slotI + 1) & (cap - 1);
    }
  }
  const n = first.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2), T = tw ? new Float32Array(n * 4) : null;
  first.forEach((v, i) => {
    P.set(m.P.subarray(3 * v, 3 * v + 3), 3 * i); N.set(m.N.subarray(3 * v, 3 * v + 3), 3 * i); UV.set(m.UV.subarray(2 * v, 2 * v + 2), 2 * i);
    if (T) T.set(m.T.subarray(4 * v, 4 * v + 4), 4 * i);
  });
  const I = [];
  let degenerate = 0;
  for (let f = 0; f < m.I.length; f += 3) {
    const a = remap[m.I[f]], b = remap[m.I[f + 1]], c = remap[m.I[f + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    I.push(a, b, c);
  }
  return {P, N, UV, T, I: Uint32Array.from(I), weld: {verticesBefore: nv, verticesAfter: n, degenerateTrianglesDropped: degenerate}};
}

/** Half turn about Y (x, z -> -x, -z) for positions, normals and tangent xyz. */
function halfTurn(m) {
  for (const [A, s] of [[m.P, 3], [m.N, 3], [m.T, 4]]) if (A) for (let i = 0; i < A.length; i += s) { A[i] = -A[i]; A[i + 2] = -A[i + 2]; }
}

/** Seam-preserving simplification on the source vertex buffer (UVs / normals / tangents kept). `stalled` when seams pin it above the budget. */
async function simplify(m, budget, flags = []) {
  await MeshoptSimplifier.ready;
  const tris0 = m.I.length / 3;
  if (tris0 <= budget) return {...m, simplify: {applied: false, triangles: tris0, budget, errorRelative: 0}};
  const nv = m.P.length / 3, attrs = new Float32Array(nv * 5);
  for (let v = 0; v < nv; v++) {
    attrs[5 * v] = m.N[3 * v] * SIMPLIFY.normalWeight; attrs[5 * v + 1] = m.N[3 * v + 1] * SIMPLIFY.normalWeight; attrs[5 * v + 2] = m.N[3 * v + 2] * SIMPLIFY.normalWeight;
    attrs[5 * v + 3] = m.UV[2 * v] * SIMPLIFY.uvWeight; attrs[5 * v + 4] = m.UV[2 * v + 1] * SIMPLIFY.uvWeight;
  }
  // attribute seams can stop the collapse short of the target: ask for less until the result fits the budget
  let out, err, ask = budget, passes = 0, prev = Infinity;
  for (; passes < 10; passes++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(m.I, m.P, 3, attrs, 5, [1, 1, 1, 1, 1], null, ask * 3, SIMPLIFY.targetError, flags);
    if (out.length / 3 <= budget || out.length / 3 >= prev) break;   // fits, or the seams pin it (no progress)
    prev = out.length / 3;
    ask = Math.floor(ask * Math.min(0.97, budget / (out.length / 3)));
  }
  if (out.length / 3 > budget) return {stalled: true, simplify: {applied: false, stalledAt: out.length / 3, budget, errorRelative: r6(err)}};
  const map = new Int32Array(nv).fill(-1), P = [], N = [], UV = [], T = m.T ? [] : null, I = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (map[v] < 0) {
      map[v] = P.length / 3;
      P.push(m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]); N.push(m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2]); UV.push(m.UV[2 * v], m.UV[2 * v + 1]);
      if (T) T.push(m.T[4 * v], m.T[4 * v + 1], m.T[4 * v + 2], m.T[4 * v + 3]);
    }
    I[i] = map[v];
  }
  const scale = MeshoptSimplifier.getScale(m.P, 3);
  return {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), T: T ? Float32Array.from(T) : null, I,
    simplify: {applied: true, tool: SIMPLIFY.tool, flags, fromTriangles: tris0, triangles: I.length / 3, budget, askedTriangles: ask, passes: passes + 1,
      errorRelative: r6(err), errorSourceUnits: r6(err * scale)}};
}

/** UV charts = index-connected triangle groups of the source buffer (Meshy splits vertices at chart borders). */
function uvCharts(m) {
  const nv = m.P.length / 3, parent = new Int32Array(nv).map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let f = 0; f < m.I.length; f += 3) { join(m.I[f], m.I[f + 1]); join(m.I[f + 1], m.I[f + 2]); }
  const roots = new Set();
  for (let f = 0; f < m.I.length; f += 3) roots.add(find(m.I[f]));
  return roots.size;
}

async function decodeRGBA(bytes, size = null) {
  let img = sharp(bytes).ensureAlpha();
  if (size) img = img.resize(size[0], size[1], {fit: 'fill', kernel: 'lanczos3'});
  const {data, info} = await img.raw().toBuffer({resolveWithObject: true});
  return {data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height};
}

/**
 * The REBAKE path (rows whose source atlas is too fragmented for the budget: hundreds to thousands of UV charts pin a seam-preserving
 * collapse far above it, and collapsing across the seams smears the texture between charts): geometry-only simplification
 * (lib/dense.mjs simplifyGeometry: meshoptimizer Permissive, position weld), a fresh deterministic atlas (lib/unwrap.mjs) and the
 * SOURCE appearance transferred onto it (lib/bake.mjs: closest same-facing source surface -> its base colour / metallic-roughness
 * texels, bilinear; the normal map from the dense source's surface normals). Processing of the source maps, no new art.
 */
async function rebake(src, m, row) {
  const bcMap = src.maps.find(x => x.slot === 'baseColor'), mrMap = src.maps.find(x => x.slot === 'metallicRoughness');
  const bc = await decodeRGBA(bcMap.bytes);
  // bake.mjs samples both on one grid: an MR map of another size is resampled to the base colour's; a source without one gets a
  // placeholder whose bake output is discarded (the material keeps its constant factors)
  const mr = mrMap ? await decodeRGBA(mrMap.bytes, [bc.width, bc.height]) : {data: new Uint8Array(bc.width * bc.height * 4), width: bc.width, height: bc.height};
  const dense = {P: m.P, N: m.N, UV: m.UV, I: m.I, bc, mr};
  const simp = await simplifyGeometry(dense, row.tris);
  const atlas = row.tex.base, div = atlas / row.tex.other;
  const low = unwrap(simp.pos, simp.idx, {atlas, pad: atlas >= 1024 ? 4 : 3});
  const b = bounds(m.P), maxExt = Math.max(...[0, 1, 2].map(k => b.max[k] - b.min[k]));
  const searchRadius = Math.max(0.02 * maxExt, 6 * simp.errorAbsolute);
  const baked = await bake(dense, low, {atlas, supersample: 2, mrDiv: div, normalDiv: div, searchRadius, workers: BAKE_WORKERS});
  const enc = async (img, slot) => ({slot, mime: 'image/jpeg', size: [img.size, img.size], quality: Q[slot], bytes: await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {raw: {width: img.size, height: img.size, channels: 3}})
    .jpeg({quality: Q[slot], chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer()});
  const textures = [await enc(baked.color, 'baseColor')];
  if (mrMap) textures.push(await enc(baked.mr, 'metallicRoughness'));
  if (src.maps.some(x => x.slot === 'normal')) textures.push(await enc(baked.normal, 'normal'));
  return {mesh: {P: low.pos, N: low.nrm, UV: low.uv, T: null, I: low.idx}, textures,
    info: {simplify: {tool: 'lib/dense.mjs simplifyGeometry (meshoptimizer 1.3 simplify, Permissive, geometry only; position weld)', fromTriangles: m.I.length / 3, triangles: low.idx.length / 3, budget: row.tris,
      errorRelative: r6(simp.error), errorSourceUnits: r6(simp.errorAbsolute), droppedDegenerate: simp.droppedDegenerate},
    unwrap: {tool: 'lib/unwrap.mjs', ...low.stats, texelsPerSourceUnit: r4(low.stats.texelsPerSourceUnit), chartAreaFraction: r4(low.stats.chartAreaFraction)},
    bake: {tool: 'lib/bake.mjs (closest same-facing source surface; base colour + metallic-roughness texels bilinear; normal from the source surface normals)', supersample: 2, atlas, mrDiv: div, normalDiv: div,
      searchRadiusSourceUnits: r6(searchRadius), matchedSameFacing: baked.stats.matchedSameFacing, matchedFallbackAnyFacing: baked.stats.matchedFallbackAnyFacing, unmatched: baked.stats.unmatched,
      projectionDistanceSourceUnits: Object.fromEntries(Object.entries(baked.stats.projectionDistanceSourceUnits).map(([k, v]) => [k, v === null ? null : r6(v)])),
      notes: mrMap ? 'base colour, metallic-roughness (G roughness, B metalness, R neutral) and normal re-baked from the source' : 'base colour re-baked from the source (no metallic-roughness / normal map in the source: constant factors kept)'}}};
}

/** A source emissive map that is black everywhere emits nothing: dropped (its factor would otherwise light the whole surface). */
async function deadEmissive(map) {
  const {data} = await sharp(map.bytes).removeAlpha().raw().toBuffer({resolveWithObject: true});
  let max = 0; for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  return max <= 8 ? {max} : null;
}

function bounds(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return {min, max};
}
/** The rim measure: mean x / z extent of the vertices at or below yFrac of the height. */
function rimDiameter(P, b, yFrac) {
  const yc = b.min[1] + yFrac * (b.max[1] - b.min[1]);
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    if (P[i + 1] > yc + 1e-9) continue;
    lo[0] = Math.min(lo[0], P[i]); hi[0] = Math.max(hi[0], P[i]); lo[1] = Math.min(lo[1], P[i + 2]); hi[1] = Math.max(hi[1], P[i + 2]);
  }
  return {d: ((hi[0] - lo[0]) + (hi[1] - lo[1])) / 2, yCut: yc};
}
function fitTransform(m, fit) {
  const b = bounds(m.P), ext = [0, 1, 2].map(k => b.max[k] - b.min[k]);
  let measure, rimY = null;
  if (fit.kind === 'x' || fit.kind === 'y' || fit.kind === 'z') measure = ext['xyz'.indexOf(fit.kind)];
  else if (fit.kind === 'maxXZ') measure = Math.max(ext[0], ext[2]);
  else if (fit.kind === 'rim') { const rd = rimDiameter(m.P, b, fit.yFrac); measure = rd.d; rimY = rd.yCut; }
  else throw new Error(fit.kind);
  const s = fit.size / measure, c = [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2];
  for (let i = 0; i < m.P.length; i += 3) for (let k = 0; k < 3; k++) m.P[i + k] = s * (m.P[i + k] - c[k]);
  return {scale: s, sourceMeasure: measure, sourceExtent: ext, offset: c, rimY: rimY === null ? null : s * (rimY - c[1])};
}

// ---------- textures ----------
const Q = {baseColor: 85, metallicRoughness: 88, normal: 90, occlusion: 88, emissive: 85};
async function encodeMap(map, px) {
  const meta = await sharp(map.bytes).metadata();
  const n = Math.min(px, meta.width, meta.height);
  const out = await sharp(map.bytes).removeAlpha().resize(n, n, {fit: 'fill', kernel: 'lanczos3'})
    .jpeg({quality: Q[map.slot], chromaSubsampling: '4:4:4', mozjpeg: true}).toBuffer();
  return {slot: map.slot, mime: 'image/jpeg', bytes: out, size: [n, n], quality: Q[map.slot]};
}

// ---------- writer ----------
async function writeGlb(row, m, textures, material) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = `Terminal State ${TOOL} (glTF-Transform)`;
  const buffer = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', m.P)).setAttribute('NORMAL', acc('VEC3', m.N)).setAttribute('TEXCOORD_0', acc('VEC2', m.UV));
  if (m.T) prim.setAttribute('TANGENT', acc('VEC4', m.T));
  prim.setIndices(acc('SCALAR', m.P.length / 3 <= 65535 ? Uint16Array.from(m.I) : m.I));
  const mat = doc.createMaterial(row.id).setBaseColorFactor(material.baseColorFactor).setMetallicFactor(material.metallicFactor).setRoughnessFactor(material.roughnessFactor)
    .setEmissiveFactor(material.emissiveFactor).setDoubleSided(material.doubleSided).setAlphaMode('OPAQUE');
  const tex = t => doc.createTexture(`${row.id}-${t.slot}`).setImage(new Uint8Array(t.bytes)).setMimeType(t.mime);
  for (const t of textures) {
    if (t.slot === 'baseColor') mat.setBaseColorTexture(tex(t));
    else if (t.slot === 'metallicRoughness') mat.setMetallicRoughnessTexture(tex(t));
    else if (t.slot === 'normal') mat.setNormalTexture(tex(t)).setNormalScale(material.normalScale);
    else if (t.slot === 'occlusion') mat.setOcclusionTexture(tex(t)).setOcclusionStrength(material.occlusionStrength);
    else if (t.slot === 'emissive') mat.setEmissiveTexture(tex(t));
  }
  prim.setMaterial(mat);
  const node = doc.createNode(row.id).setMesh(doc.createMesh(row.id).addPrimitive(prim));
  doc.getRoot().setDefaultScene(doc.createScene('Scene').addChild(node));
  const glb = Buffer.from(await new NodeIO().writeBinary(doc));
  const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
  if (/https?:|Signature|X-Amz|token/i.test(json)) throw new Error(`${row.id}: URL/token-like string inside the glTF JSON`);
  return glb;
}

/** Re-reads the written GLB: the numbers the provenance / registry / tests use. */
async function measure(glb) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(glb));
  const r = doc.getRoot(), b = getBounds(r.getDefaultScene());
  const tris = r.listMeshes().reduce((s, me) => s + me.listPrimitives().reduce((t, p) => t + p.getIndices().getCount() / 3, 0), 0);
  const mat = r.listMaterials()[0];
  const slots = [['baseColor', mat.getBaseColorTexture()], ['metallicRoughness', mat.getMetallicRoughnessTexture()], ['normal', mat.getNormalTexture()], ['occlusion', mat.getOcclusionTexture()], ['emissive', mat.getEmissiveTexture()]];
  return {dims: [0, 1, 2].map(k => r4(b.max[k] - b.min[k])), min: b.min.map(r6), max: b.max.map(r6), tris,
    vertices: r.listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount(),
    maps: slots.filter(([, t]) => t).map(([slot, t]) => ({slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}))};
}

// ---------- build ----------
const built = [];
for (const row of ROWS) {
  if (ONLY && !ONLY.has(row.id)) continue;
  const t0 = Date.now();
  const src = await readSource(row);
  const welded = weld(src);
  if (row.yaw180) halfTurn(welded);
  const charts = uvCharts(welded);
  // a source emissive map that is black everywhere is dropped (with its factor: no map + factor 1 would light the whole surface)
  const material = {...src.material}, dropped = [];
  for (const map of src.maps.filter(x => x.slot === 'emissive')) {
    const dead = await deadEmissive(map);
    if (!dead) throw new Error(`${row.id}: a lit emissive map (not handled by this builder)`);
    src.maps = src.maps.filter(x => x !== map); material.emissiveFactor = [0, 0, 0];
    dropped.push({slot: 'emissive', size: map.size, bytes: map.bytes.length, sha256: sha(map.bytes), reason: `black everywhere (max channel ${dead.max} / 255): emits nothing; dropped and the emissive factor set to 0`});
  }
  const keep = await simplify(welded, row.tris);
  let low, textures, method, why = null, rebakeInfo = null;
  if (!keep.stalled && keep.simplify.errorRelative <= MAX_KEEP_ERROR) {
    method = 'source-uv'; low = keep; textures = [];
    for (const map of src.maps) textures.push(await encodeMap(map, map.slot === 'baseColor' ? row.tex.base : row.tex.other));
  } else {
    method = 'rebake';
    why = keep.stalled ? `the source atlas has ${charts} UV charts: a seam-preserving collapse stalls at ${keep.simplify.stalledAt} triangles (> the ${row.tris} budget) and collapsing across the seams smears the texture between charts`
      : `the seam-preserving result at the budget is visibly crumpled (relative error ${keep.simplify.errorRelative} > ${MAX_KEEP_ERROR}; ${charts} UV charts pin the collapse)`;
    const rb = await rebake(src, welded, row);
    low = rb.mesh; textures = rb.textures; rebakeInfo = rb.info;
  }
  const fit = fitTransform(low, row.fit);
  const glb = await writeGlb(row, low, textures, material);
  const out = await measure(glb);
  // runtime contract checks: grounded, centred, the reference measure at its size, the budget
  if (Math.abs(out.min[1]) > 1e-4 || Math.abs(out.min[0] + out.max[0]) > 1e-3 || Math.abs(out.min[2] + out.max[2]) > 1e-3) throw new Error(`${row.id}: not grounded / centred`);
  if (out.tris > row.tris) throw new Error(`${row.id}: ${out.tris} > ${row.tris} triangles`);
  const url = `assets/models/${row.id}.glb`, provRel = `assets/derivatives/${row.id}.json`;
  const prov = {
    schema: 'terminal-state-derivative-v1',
    id: row.id, key: row.key, role: row.role,
    task: 'skyways-level-20261106-054448 (lane ASSET-A)',
    licence: LICENCE,
    source: {archive: ARCHIVE, member: src.member, sha256: src.sha256, bytes: src.bytes, triangles: src.triangles, vertices: src.vertices,
      extent: src.extent, uvCharts: charts,
      material: {metallicFactor: src.material.metallicFactor, roughnessFactor: src.material.roughnessFactor, emissiveFactor: src.material.emissiveFactor, doubleSided: src.material.doubleSided},
      maps: [...src.maps.map(mp => ({slot: mp.slot, size: mp.size, mime: mp.mime, bytes: mp.bytes.length, sha256: sha(mp.bytes)})), ...dropped.map(d => ({slot: d.slot, size: d.size, bytes: d.bytes, sha256: d.sha256}))],
      storage: 'read-only master kept privately outside Git (never shipped)'},
    output: {url, file: `game/public/${url}`, bytes: glb.length, sha256: sha(glb), triangles: out.tris, vertices: out.vertices, dims: out.dims, min: out.min, max: out.max,
      material: {metallicFactor: material.metallicFactor, roughnessFactor: material.roughnessFactor, emissiveFactor: material.emissiveFactor, doubleSided: material.doubleSided},
      maps: out.maps.map(mp => ({...mp, quality: textures.find(t => t.slot === mp.slot).quality}))},
    fit: {kind: row.fit.kind, sizeM: row.fit.size, ...(row.fit.kind === 'rim' ? {rimBandYFrac: row.fit.yFrac, rimBandTopY: r6(fit.rimY)} : {}),
      measuredOn: 'the simplified mesh in source units (its extremes are what ships)', sourceMeasure: r6(fit.sourceMeasure), scale: r6(fit.scale)},
    transform: `${row.yaw180 ? 'half turn about Y (x, z -> -x, -z), then ' : 'no rotation, '}uniform scale ${r6(fit.scale)} about the bounds' bottom centre (source offset ${fit.offset.map(r6).join(', ')}): grounded (min y = 0), centred on x / z; baked into the vertices (identity node)`,
    convention: `metres at real size, +Y up; ${row.front}`,
    weld: welded.weld,
    method,
    ...(method === 'source-uv'
      ? {simplify: {...low.simplify, normalWeight: SIMPLIFY.normalWeight, uvWeight: SIMPLIFY.uvWeight, targetError: SIMPLIFY.targetError},
        textures: 'the source maps only, on the source UVs (no new / hand-painted art): Lanczos3 downsize, JPEG (mozjpeg, 4:4:4) — base colour q85, metallic-roughness q88, normal q90; source material factors kept'}
      : {rebakeReason: why, seamPreservingAttempt: keep.simplify, ...rebakeInfo,
        textures: 'the source appearance re-baked onto a fresh atlas (processing of the source maps, no new / hand-painted art): JPEG (mozjpeg, 4:4:4) — base colour q85, metallic-roughness q88, normal q90; source material factors kept'}),
    ...(dropped.length ? {droppedMaps: dropped} : {}),
    rebuild: `node --max-old-space-size=3072 ${TOOL}`,
  };
  const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
  { const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|X-Amz|Key-Pair-Id|token=).{0,20}/i); if (hit) throw new Error(`${row.id}: URL/token-like string in provenance: ${hit[0]}`); }
  fs.writeFileSync(path.join(PUB, url), glb);
  fs.writeFileSync(path.join(PUB, provRel), provBuf);
  built.push(row.id);
  console.log(`${row.id}: ${method}${why ? ` (${why})` : ''}: ${src.triangles} -> ${out.tris} tris (${charts} charts, weld ${welded.weld.verticesBefore} -> ${welded.weld.verticesAfter} v, err ${method === 'source-uv' ? low.simplify.errorRelative : rebakeInfo.simplify.errorRelative}), ${(src.bytes / 1e6).toFixed(2)} MB -> ${(glb.length / 1e6).toFixed(3)} MB, dims ${out.dims.join(' x ')} m, maps ${out.maps.map(mp => `${mp.slot} ${mp.size[0]} ${mp.bytes}`).join(', ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// ---------- registry + allowlist (every row present on disk) ----------
const present = ROWS.filter(row => fs.existsSync(path.join(PUB, `assets/derivatives/${row.id}.json`)) && fs.existsSync(path.join(PUB, `assets/models/${row.id}.glb`)));
const provs = present.map(row => JSON.parse(fs.readFileSync(path.join(PUB, `assets/derivatives/${row.id}.json`), 'utf8')));
for (const p of provs) {
  const b = fs.readFileSync(path.join(PUB, p.output.url));
  if (b.length !== p.output.bytes || sha(b) !== p.output.sha256) throw new Error(`${p.id}: provenance does not match the GLB on disk (rebuild it)`);
}
const reg = `// GENERATED by ${TOOL} — do not edit (task skyways-level-20261106-054448, lane ASSET-A).
// Runtime derivatives of the user-supplied community Meshy sources (${ARCHIVE}; creator / license links pending; no license or authorship
// claim): per-file provenance in assets/derivatives/<file>.json. Metres at real size, +Y up, grounded (min y = 0), centred on x / z; props
// face +Z, wrecks lie along X with the nose at +X. w / h / d = the measured runtime bounds (x / y / z extents); tris = triangles.
export interface SkywaysPropModel { url: string; w: number; h: number; d: number; tris: number }
export const SKYWAYS_PROP_MODELS = {
${provs.map(p => `  ${p.key}: {url: '${p.output.url}', w: ${p.output.dims[0]}, h: ${p.output.dims[1]}, d: ${p.output.dims[2]}, tris: ${p.output.triangles}},`).join('\n')}
} as const satisfies Readonly<Record<string, SkywaysPropModel>>;
export type SkywaysPropModelKey = keyof typeof SKYWAYS_PROP_MODELS;
`;
fs.writeFileSync(REG, reg);
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const mine = new Map();
for (const row of present) for (const rel of [`assets/models/${row.id}.glb`, `assets/derivatives/${row.id}.json`]) mine.set(rel, fs.readFileSync(path.join(PUB, rel)));
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...[...mine].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`built ${built.length} row(s); registry ${present.length} / ${ROWS.length} rows; allowlist +${mine.size} entries`);
