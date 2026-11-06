// Task studio-skyways-level-20261106-054448-01 (Skyways lane ASSET-D): the runtime derivatives of the 7 accepted NEW Skyways Meshy T2.5
// props — car interior (dashboard, bucket seat) and convention hall (stage, merch table, boxed figure, plush, prize stanchion). Route:
// Codex native image_gen INITIAL conditioning image -> Meshy T2.5 image-to-3D (smart topology, 2K PBR); the model KEEPS Meshy's own PBR
// maps (base colour, metallic-roughness, normal), re-encoded / downsized only — never a Codex re-texture or projection.
//
// Reads (never modifies) the lead's private task records OUTSIDE Git (reference/tasks/skyways-level-20261106-054448/):
//   gen/LEDGER.jsonl           fsynced intent / posted / status / raw / accept lines (+ the Codex intent / result lines of the inputs)
//   gen/FINANCIAL-ACK.json     the Meshy create settings and the Codex input per asset (sha256)
//   gen/RAW-SHA256-meshy.txt   sha256 of every raw original (checked together with the ledger's raw line)
//   gen/raw/meshy-<asset>-<taskId>.glb   the immutable raw originals (read-only)
// and writes deterministically:
//   game/public/assets/models/skyways-<asset>.glb          plain glTF binary (no Draco / meshopt / KTX2): one node / mesh / primitive / material
//   game/public/assets/derivatives/skyways-<asset>-model.json    provenance (Meshy task id, ledger rows, input / raw sha256; no URLs / tokens)
//   game/src/assets/skywaysMeshyProps.generated.ts         SKYWAYS_MESHY_PROPS {url, w, h, d, tris (+ deckY / topY / ringY)} (three-free)
//   tools/release/public-inputs.json                       ONLY this script's entries added / updated (others untouched)
//
// Per asset: exact-attribute weld (+ degenerate triangles dropped; lossless), meshoptimizer seam-preserving simplification ONLY where the
// brief's budget is below the delivered count (source UVs / normals kept; if the UV seams stall the collapse above the budget, or the
// result is visibly crumpled, the source mesh is kept — recorded), UNIFORM scale so the row's reference measure is its real size, Meshy's
// native frame kept (front +Z, +Y up), grounded (min y = 0) and centred on x / z, baked into the vertices (identity node). The merch
// table is fitted by its 6-ft table-top width (the cloth flares wider at the floor); its top then lands on the real 0.76 m (checked).
// Measured on the shipped mesh: the stage deck top and the table top (top-down 1 cm height map), the stanchion's eye-ring height.
//
//   node tools/asset-pipeline/props/build-skyways-meshy-props.mjs [--reference <dir>] [--dry-run <scratch dir>]
//   (--reference defaults to <repo>/reference; --dry-run writes the GLBs only into the scratch dir — no public / registry / allowlist)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';

const root = path.resolve(import.meta.dirname, '../../..');
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const TASK = 'studio-skyways-level-20261106-054448-01';
const TASK_DIR = 'reference/tasks/skyways-level-20261106-054448';
const REF = path.resolve(arg('--reference') ?? path.join(root, 'reference'));
const GEN = path.join(REF, 'tasks/skyways-level-20261106-054448/gen');
const DRY = arg('--dry-run');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/skywaysMeshyProps.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const SELF = 'tools/asset-pipeline/props/build-skyways-meshy-props.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r4 = v => +v.toFixed(4), r6 = v => +v.toFixed(6);
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * The brief's table. fit: the reference measure and its real size (m) — x = the full width, y = the full height, top = the table-top
 * width (x extent of the geometry within TOP_BAND below the top plateau). tris: the budget (null = keep as delivered). tex: [base,
 * metallicRoughness, normal] px. measure: the extra registry height.
 */
const ROWS = [
  {asset: 'car-dash', key: 'skyways_car_dash', fit: {x: 1.48}, tris: null, tex: [2048, 1024, 1024],
    role: 'Skyways car interior: dashboard (instrument cluster, steering wheel, centre stack and gear console)',
    front: 'front +Z = the driver / cabin side (gauges, steering wheel and centre stack face +Z; the windscreen edge is at -Z)'},
  {asset: 'car-seat', key: 'skyways_car_seat', fit: {y: 1.12}, tris: null, tex: [1024, 1024, 1024],
    role: 'Skyways car interior: bucket seat on its floor rails (height includes the rails)',
    front: 'front +Z = the sitting side (the backrest is at -Z)'},
  {asset: 'con-stage', key: 'skyways_con_stage', fit: {x: 8.0}, tris: null, tex: [1024, 1024, 1024], measure: 'deckY',
    role: 'convention hall: event stage (skirted deck, box truss with hung speakers, side steps); width includes the truss and speakers',
    front: 'front +Z = the open audience side (the truss uprights stand at the back edge, -Z)'},
  {asset: 'con-merch-table', key: 'skyways_con_merch_table', fit: {top: 1.83}, tris: 6000, tex: [512, 512, 512], measure: 'topY',
    role: 'convention hall: merch table (6-ft table under a floor-length blue cloth)',
    front: 'front +Z = the customer side (the cloth is the same all round)'},
  {asset: 'con-figure-box', key: 'skyways_con_figure_box', fit: {y: 0.24}, tris: 3000, tex: [512, 512, 512],
    role: 'convention merch: boxed anime figure (window box)',
    front: 'front +Z = the window with the figure'},
  {asset: 'con-plush', key: 'skyways_con_plush', fit: {y: 0.34}, tris: 5000, tex: [512, 512, 512],
    role: 'convention merch: round cat plush with a blue scarf',
    front: 'front +Z = the face'},
  {asset: 'prize-stanchion', key: 'skyways_prize_stanchion', fit: {y: 0.96}, tris: 2500, tex: [512, 512, 512], measure: 'ringY',
    role: 'convention prize area: chrome queue stanchion with its red rope hanging from the hook',
    front: 'front +Z = the rope-hook side'},
];
/** Table top: the geometry within this fraction of the height below the top plateau gives the table-top width. */
const TOP_BAND = 0.06;
/** The merch table's real top height (m); the uniform table-top-width fit must land it within 1 cm (the build refuses otherwise). */
const TABLE_TOP_Y = 0.76;
const SIMPLIFY = {normalWeight: 0.5, uvWeight: 1, targetError: 1, tool: 'meshoptimizer 1.3 simplifyWithAttributes (normals x0.5 + UV x1 attribute weights; UV seams preserved; source UVs / normals kept)'};
/** Above this relative error the seam-preserving result counts as visibly crumpled: the source mesh is kept instead. */
const MAX_KEEP_ERROR = 0.05;
/** JPEG encodes per slot (channel-packed metallic-roughness and normals without chroma subsampling). */
const JPEG = {baseColor: {quality: 86, chromaSubsampling: '4:2:0'}, metallicRoughness: {quality: 88, chromaSubsampling: '4:4:4'}, normal: {quality: 90, chromaSubsampling: '4:4:4'}};

// ---------- records ----------
const ledger = fs.readFileSync(path.join(GEN, 'LEDGER.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const ack = JSON.parse(fs.readFileSync(path.join(GEN, 'FINANCIAL-ACK.json'), 'utf8'));
const rawShas = new Map(fs.readFileSync(path.join(GEN, 'RAW-SHA256-meshy.txt'), 'utf8').split('\n').filter(Boolean).map(l => { const [h, f] = l.trim().split(/\s+/); return [f, h]; }));
const approvalSha = sha(fs.readFileSync(path.join(REF, 'tasks/skyways-level-20261106-054448/USER-GENERATION-APPROVAL.json')));
if (approvalSha !== ack.approvalSha256) throw new Error('FINANCIAL-ACK approval sha256 does not match USER-GENERATION-APPROVAL.json');
const last = ledger[ledger.length - 1];
if (last.billed + last.reserved > ack.caps.credits || last.attempts > ack.caps.attempts || last.paidPOSTs > ack.caps.paidPOSTs) throw new Error(`ledger outside the caps: ${JSON.stringify(last)}`);
const seq = e => ledger.indexOf(e) + 1;

function records(asset) {
  const one = (pred, what) => { const m = ledger.filter(pred); if (m.length !== 1) throw new Error(`${asset}: expected exactly one ${what} line, found ${m.length}`); return m[0]; };
  const accept = one(e => e.event === 'accept' && e.asset === asset, 'accept');
  const raw = one(e => e.event === 'raw' && e.asset === asset, 'raw');
  const intent = one(e => e.event === 'intent' && e.asset === asset && !e.kind, 'Meshy intent');
  const posted = one(e => e.event === 'posted' && e.asset === asset, 'posted');
  const status = one(e => e.event === 'status' && e.asset === asset, 'status');
  if (status.taskId !== posted.taskId || status.status !== 'SUCCEEDED' || !raw.file.includes(posted.taskId)) throw new Error(`${asset}: task id / status mismatch`);
  const input = ack.inputs[asset];
  if (!input || !input.sha256.startsWith(intent.inputSha256) || !intent.input.endsWith(path.basename(input.file))) throw new Error(`${asset}: Meshy input does not match FINANCIAL-ACK`);
  const codex = one(e => e.event === 'result' && e.kind === 'codex-image' && e.n === input.codexCall, `Codex ${input.codexCall} result`);
  const codexIntent = one(e => e.event === 'intent' && e.kind === 'codex-image' && e.n === input.codexCall, `Codex ${input.codexCall} intent`);
  if (codex.files.length !== 1 || codex.files[0].sha256 !== input.sha256 || codex.rc !== 0) throw new Error(`${asset}: Codex result does not match the Meshy input`);
  const inputBytes = fs.readFileSync(path.join(GEN, codex.files[0].raw));
  if (sha(inputBytes) !== input.sha256) throw new Error(`${asset}: Codex input file sha256 mismatch`);
  const bytes = fs.readFileSync(path.join(GEN, raw.file));
  if (sha(bytes) !== raw.sha256 || rawShas.get(raw.file) !== raw.sha256 || bytes.length !== raw.bytes) throw new Error(`${asset}: raw original sha256 / bytes mismatch (${raw.file})`);
  return {accept, raw, intent, posted, status, input, codex, codexIntent, bytes};
}

// ---------- geometry ----------
async function readSource(rec) {
  const doc = await io.readBinary(new Uint8Array(rec.bytes));
  const r = doc.getRoot();
  const nodes = r.listNodes();
  if (nodes.length !== 1 || !nodes[0].getMesh() || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) throw new Error('expected one node / mesh / material');
  if (nodes[0].getWorldMatrix().some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) throw new Error('non-identity source node');
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4 || prims[0].getAttribute('TANGENT') || prims[0].listSemantics().join() !== 'POSITION,NORMAL,TEXCOORD_0') throw new Error('expected one POSITION / NORMAL / TEXCOORD_0 triangle primitive');
  const p = prims[0], mat = r.listMaterials()[0];
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getOcclusionTexture() || mat.getEmissiveTexture()) throw new Error('unexpected material (alpha / occlusion / emissive)');
  for (const info of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo()]) if (!info || info.getTexCoord() !== 0) throw new Error('a map is missing or uses TEXCOORD_1');
  const m = {P: Float32Array.from(p.getAttribute('POSITION').getArray()), N: Float32Array.from(p.getAttribute('NORMAL').getArray()),
    UV: Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), I: Uint32Array.from(p.getIndices().getArray())};
  const maps = [['baseColor', mat.getBaseColorTexture()], ['metallicRoughness', mat.getMetallicRoughnessTexture()], ['normal', mat.getNormalTexture()]]
    .map(([slot, t]) => ({slot, size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  return {doc, prim: p, mat, m, maps, material};
}

/** Exact-attribute weld (bitwise-equal position / normal / uv) + degenerate-triangle removal; lossless. */
function weld(m) {
  const nv = m.P.length / 3, stride = 8, A = new Float32Array(nv * stride);
  for (let v = 0; v < nv; v++) {
    A.set(m.P.subarray(3 * v, 3 * v + 3), v * stride); A.set(m.N.subarray(3 * v, 3 * v + 3), v * stride + 3); A.set(m.UV.subarray(2 * v, 2 * v + 2), v * stride + 6);
  }
  const U = new Uint32Array(A.buffer);
  let cap = 1; while (cap < nv * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), first = [];
  for (let v = 0; v < nv; v++) {
    let h = 2166136261;
    for (let k = 0; k < stride; k++) { h ^= U[v * stride + k]; h = Math.imul(h, 16777619); }
    for (let s = (h >>> 0) & (cap - 1); ; s = (s + 1) & (cap - 1)) {
      const w = table[s];
      if (w < 0) { table[s] = first.length; remap[v] = first.length; first.push(v); break; }
      let eq = true;
      for (let k = 0; k < stride; k++) if (U[first[w] * stride + k] !== U[v * stride + k]) { eq = false; break; }
      if (eq) { remap[v] = w; break; }
    }
  }
  const n = first.length, P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
  first.forEach((v, i) => { P.set(m.P.subarray(3 * v, 3 * v + 3), 3 * i); N.set(m.N.subarray(3 * v, 3 * v + 3), 3 * i); UV.set(m.UV.subarray(2 * v, 2 * v + 2), 2 * i); });
  const I = [];
  let degenerate = 0;
  for (let f = 0; f < m.I.length; f += 3) {
    const a = remap[m.I[f]], b = remap[m.I[f + 1]], c = remap[m.I[f + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    I.push(a, b, c);
  }
  return {P, N, UV, I: Uint32Array.from(I), weld: {verticesBefore: nv, verticesAfter: n, degenerateTrianglesDropped: degenerate}};
}

/** UV charts = index-connected triangle groups (Meshy splits vertices at chart borders). */
function uvCharts(m) {
  const nv = m.P.length / 3, parent = Int32Array.from({length: nv}, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let f = 0; f < m.I.length; f += 3) for (const [a, b] of [[m.I[f], m.I[f + 1]], [m.I[f + 1], m.I[f + 2]]]) { const x = find(a), y = find(b); if (x !== y) parent[x] = y; }
  const roots = new Set();
  for (let f = 0; f < m.I.length; f += 3) roots.add(find(m.I[f]));
  return roots.size;
}

/** Seam-preserving simplification on the welded source buffer (UVs / normals kept); `kept` + reason when it stalls or crumples. */
async function simplify(m, budget) {
  const tris0 = m.I.length / 3;
  if (budget == null || tris0 <= budget) return {m, info: {applied: false, reason: budget == null ? 'kept as delivered (the brief keeps this model at its delivered count)' : `already within the ${budget} budget`, triangles: tris0, budget}};
  await MeshoptSimplifier.ready;
  const nv = m.P.length / 3, attrs = new Float32Array(nv * 5);
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) attrs[5 * v + k] = m.N[3 * v + k] * SIMPLIFY.normalWeight;
    attrs[5 * v + 3] = m.UV[2 * v] * SIMPLIFY.uvWeight; attrs[5 * v + 4] = m.UV[2 * v + 1] * SIMPLIFY.uvWeight;
  }
  // attribute seams can stop the collapse short of the target: ask for less until the result fits the budget (or makes no progress)
  let out, err, ask = budget, passes = 0, prev = Infinity;
  for (; passes < 10; passes++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(m.I, m.P, 3, attrs, 5, [1, 1, 1, 1, 1], null, ask * 3, SIMPLIFY.targetError, []);
    if (out.length / 3 <= budget || out.length / 3 >= prev) break;
    prev = out.length / 3;
    ask = Math.floor(ask * Math.min(0.97, budget / (out.length / 3)));
  }
  const attempt = {fromTriangles: tris0, triangles: out.length / 3, budget, askedTriangles: ask, passes: passes + 1, errorRelative: r6(err)};
  if (out.length / 3 > budget) return {m, info: {applied: false, reason: `the UV seams stall the seam-preserving collapse at ${out.length / 3} triangles (> the ${budget} budget): source mesh kept rather than smear the texture`, triangles: tris0, budget, attempt}};
  if (err > MAX_KEEP_ERROR) return {m, info: {applied: false, reason: `the seam-preserving result at the budget is visibly crumpled (relative error ${r6(err)} > ${MAX_KEEP_ERROR}): source mesh kept`, triangles: tris0, budget, attempt}};
  const map = new Int32Array(nv).fill(-1), P = [], N = [], UV = [], I = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (map[v] < 0) { map[v] = P.length / 3; P.push(m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]); N.push(m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2]); UV.push(m.UV[2 * v], m.UV[2 * v + 1]); }
    I[i] = map[v];
  }
  return {m: {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I},
    info: {applied: true, tool: SIMPLIFY.tool, normalWeight: SIMPLIFY.normalWeight, uvWeight: SIMPLIFY.uvWeight, targetError: SIMPLIFY.targetError, ...attempt,
      errorSourceUnits: r6(err * MeshoptSimplifier.getScale(m.P, 3))}};
}

function boundsOf(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  return {min, max};
}

/** Top-down height map (max y per `cell` x `cell` column, sampled at the cell centres) of the indexed mesh. */
function heightMap(P, I, cell) {
  const b = boundsOf(P), x0 = b.min[0], z0 = b.min[2];
  const nx = Math.ceil((b.max[0] - x0) / cell) + 1, nz = Math.ceil((b.max[2] - z0) / cell) + 1;
  const H = new Float32Array(nx * nz).fill(-Infinity);
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], bb = 3 * I[f + 1], c = 3 * I[f + 2];
    const ax = P[a], az = P[a + 2], bx = P[bb], bz = P[bb + 2], cx = P[c], cz = P[c + 2];
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell)), k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * cell, z = z0 + (k + 0.5) * cell;
      const w0 = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area, w1 = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
      const y = w0 * P[a + 1] + w1 * P[bb + 1] + w2 * P[c + 1];
      if (y > H[k * nx + i]) H[k * nx + i] = y;
    }
  }
  return {H, nx, nz, x0, z0, cell};
}

/** The broadest flat top: the 2 cm height window holding the most height-map cells (above `minY`); its median height and extent. */
function plateau(hm, minY = -Infinity) {
  const {H, nx, x0, z0, cell} = hm, bin = 0.002, half = 5;
  const hs = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < H.length; i++) if (H[i] > minY && Number.isFinite(H[i])) { hs.push(i); lo = Math.min(lo, H[i]); hi = Math.max(hi, H[i]); }
  const nb = Math.ceil((hi - lo) / bin) + 1;
  const hist = new Int32Array(nb);
  for (const i of hs) hist[Math.floor((H[i] - lo) / bin)]++;
  let best = -1, bestN = -1;
  for (let c = 0; c < nb; c++) { let n = 0; for (let d = -half; d <= half; d++) n += hist[c + d] ?? 0; if (n > bestN) { bestN = n; best = c; } }
  const y0 = lo + (best - half) * bin, y1 = lo + (best + half + 1) * bin;
  const cells = hs.filter(i => H[i] >= y0 && H[i] < y1);
  const ys = cells.map(i => H[i]).sort((p, q) => p - q);
  const x = [Infinity, -Infinity], z = [Infinity, -Infinity];
  for (const i of cells) {
    const cx = x0 + ((i % nx) + 0.5) * cell, cz = z0 + (Math.floor(i / nx) + 0.5) * cell;
    x[0] = Math.min(x[0], cx); x[1] = Math.max(x[1], cx); z[0] = Math.min(z[0], cz); z[1] = Math.max(z[1], cz);
  }
  return {y: ys[ys.length >> 1], cells: cells.length, areaM2: cells.length * cell * cell, ySpread: [ys[0], ys[ys.length - 1]], x, z};
}

// ---------- build ----------
const outRows = [];
for (const row of ROWS) {
  const id = `skyways-${row.asset}`, url = `assets/models/${id}.glb`, provRel = `assets/derivatives/${id}-model.json`; // (lead: '-model' — skyways-con-stage.json is the stage ART atlas's provenance)
  const rec = records(row.asset);
  const src = await readSource(rec);
  const srcB = boundsOf(src.m.P);
  const extent = [0, 1, 2].map(k => r4(srcB.max[k] - srcB.min[k]));
  const welded = weld(src.m);
  const charts = uvCharts(welded);
  const {m: low, info: simp} = await simplify(welded, row.tris);
  // ---- fit: UNIFORM scale (s) on the reference measure; grounded, centred on x / z (normals unchanged under a uniform scale)
  const b = boundsOf(low.P);
  let s, fit;
  if (row.fit.x) { s = row.fit.x / (b.max[0] - b.min[0]); fit = {kind: 'x: the full width', size: row.fit.x}; }
  else if (row.fit.top) {
    // the 6-ft table itself, not the cloth flaring out at the floor: x extent of the geometry within the top band below the top plateau
    const top = plateau(heightMap(low.P, low.I, (b.max[0] - b.min[0]) / 400), b.min[1] + 0.5 * (b.max[1] - b.min[1]));
    const band = top.y - TOP_BAND * (b.max[1] - b.min[1]);
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < low.P.length; i += 3) if (low.P[i + 1] >= band) { x0 = Math.min(x0, low.P[i]); x1 = Math.max(x1, low.P[i]); }
    s = row.fit.top / (x1 - x0);
    fit = {kind: 'top: the table-top width = the x extent of the geometry within the top band (the cloth flares wider at the floor)', size: row.fit.top,
      topBandY: r6(s * (band - b.min[1])), topBand: `geometry at or above the top plateau minus ${TOP_BAND * 100} % of the height`};
  } else { s = row.fit.y / (b.max[1] - b.min[1]); fit = {kind: 'y: the full height', size: row.fit.y}; }
  const tx = -s * (b.min[0] + b.max[0]) / 2, ty = -s * b.min[1], tz = -s * (b.min[2] + b.max[2]) / 2;
  const P = new Float32Array(low.P.length);
  for (let i = 0; i < P.length; i += 3) { P[i] = s * low.P[i] + tx; P[i + 1] = s * low.P[i + 1] + ty; P[i + 2] = s * low.P[i + 2] + tz; }
  const N = low.N;
  fit = {...fit, scale: r6(s), translate: [tx, ty, tz].map(r6), measuredOn: 'the welded (and simplified) mesh that ships', rotation: 'none (Meshy native front +Z kept)'};
  // ---- write into the source document (its material + PBR maps kept; maps re-encoded / downsized only)
  const {doc, prim, mat} = src;
  const r = doc.getRoot();
  const nv = P.length / 3;
  prim.getAttribute('POSITION').setArray(P);
  prim.getAttribute('NORMAL').setArray(N);
  prim.getAttribute('TEXCOORD_0').setArray(Float32Array.from(low.UV));
  prim.getIndices().setArray(nv < 65536 ? Uint16Array.from(low.I) : Uint32Array.from(low.I));
  const [tb, tmr, tn] = row.tex;
  for (const [slot, t, px] of [['baseColor', mat.getBaseColorTexture(), tb], ['metallicRoughness', mat.getMetallicRoughnessTexture(), tmr], ['normal', mat.getNormalTexture(), tn]]) {
    const img = await sharp(Buffer.from(t.getImage())).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'}).jpeg(JPEG[slot]).toBuffer();
    t.setImage(new Uint8Array(img)).setMimeType('image/jpeg').setURI(`${id}-${slot}.jpg`).setName(`${id}-${slot}`);
  }
  r.listMeshes()[0].setName(id); r.listNodes()[0].setName(id); mat.setName(id);
  r.listScenes().forEach(sc => sc.setName(id));
  await doc.transform(dedup(), prune());
  r.getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
  const glb = Buffer.from(await io.writeBinary(doc));
  const jsonChunk = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
  if (/https?:|Signature|X-Amz|token/i.test(jsonChunk)) throw new Error(`${id}: URL / token-like string inside the glTF JSON`);
  // ---- verify the written bytes + measure on them
  const chk = await io.readBinary(new Uint8Array(glb));
  const cr = chk.getRoot();
  const bb = getBounds(cr.getDefaultScene() ?? cr.listScenes()[0]);
  const dims = [0, 1, 2].map(k => r4(bb.max[k] - bb.min[k]));
  if (Math.abs(bb.min[1]) > 1e-4 || Math.abs(bb.min[0] + bb.max[0]) > 1e-3 || Math.abs(bb.min[2] + bb.max[2]) > 1e-3) throw new Error(`${id}: not grounded / centred`);
  const cp = cr.listMeshes()[0].listPrimitives()[0];
  const tris = cp.getIndices().getCount() / 3;
  if (row.tris != null && simp.applied && tris > row.tris) throw new Error(`${id}: over budget`);
  const CP = cp.getAttribute('POSITION').getArray(), CI = cp.getIndices().getArray();
  const measures = {};
  if (row.measure === 'deckY' || row.measure === 'topY') {
    // the stage deck / the table top: the broadest flat top above the lower part of the model (floor-level steps / cloth hem excluded)
    const pl = plateau(heightMap(CP, CI, 0.01), (row.measure === 'deckY' ? 0.1 : 0.5) * dims[1]);
    measures[row.measure] = r4(pl.y);
    measures.plateau = {method: 'broadest 2 cm height window of a 1 cm top-down height map (max y per column) of the shipped mesh; median height', areaM2: r4(pl.areaM2),
      ySpread: pl.ySpread.map(r4), x: pl.x.map(r4), z: pl.z.map(r4)};
  }
  if (row.measure === 'topY' && Math.abs(measures.topY - TABLE_TOP_Y) > 0.01) throw new Error(`${id}: table top ${measures.topY} m is not the real ${TABLE_TOP_Y} m (± 1 cm)`);
  if (row.measure === 'ringY') Object.assign(measures, ringHeight(CP, CI, dims));
  const mats = cr.listMaterials();
  const textures = cr.listTextures().map(t => ({slot: [['baseColor', mats[0].getBaseColorTexture()], ['metallicRoughness', mats[0].getMetallicRoughnessTexture()], ['normal', mats[0].getNormalTexture()]].find(([, x]) => x === t)?.[0] ?? 'unused',
    size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())}));
  outRows.push({row, id, url, provRel, rec, src, extent, welded, charts, simp, fit, glb, dims, min: bb.min.map(r6), max: bb.max.map(r6), tris, vertices: cp.getAttribute('POSITION').getCount(), measures, textures});
  console.log(`${id}: ${rec.bytes.length} B ${src.m.I.length / 3} tris -> ${glb.length} B ${tris} tris (${simp.applied ? `simplified, err ${simp.errorRelative}` : simp.reason}; ${charts} UV charts), dims ${dims.join(' x ')} m, ` +
    `scale ${s.toFixed(4)}${Object.entries(measures).filter(([, v]) => typeof v === 'number').map(([k, v]) => `, ${k} ${v}`).join('')}; maps ${textures.map(t => `${t.slot} ${t.size[0]} ${t.bytes}`).join(', ')}`);
}

/**
 * The stanchion's rope-hook height. The model is the post (base, column, cap, finial: the largest position-connected component) plus
 * separate hardware: the eye ring on its bracket under the cap, the rope's snap hook, the rope-end ferrules and the rope. The post axis
 * and column radius come from the post's 40-60 % height band; the eye ring = the HIGHEST separate component lying wholly on the +Z side
 * beyond the column (the bracket touches the column; the snap hook, ferrules and rope hang below the ring). ringY = its centre height.
 */
function ringHeight(P, I, dims) {
  const h = dims[1], nv = P.length / 3;
  const ids = new Map(), rep = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${P[3 * v]},${P[3 * v + 1]},${P[3 * v + 2]}`; if (!ids.has(k)) ids.set(k, ids.size); rep[v] = ids.get(k); }
  const parent = Int32Array.from({length: ids.size}, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let f = 0; f < I.length; f += 3) for (const [a, b] of [[I[f], I[f + 1]], [I[f + 1], I[f + 2]]]) { const x = find(rep[a]), y = find(rep[b]); if (x !== y) parent[x] = y; }
  const comps = new Map();
  for (let f = 0; f < I.length; f += 3) {
    const c = find(rep[I[f]]);
    if (!comps.has(c)) comps.set(c, {tris: 0, verts: new Set(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
    const o = comps.get(c); o.tris++;
    for (const v of [I[f], I[f + 1], I[f + 2]]) { o.verts.add(v); for (let k = 0; k < 3; k++) { o.min[k] = Math.min(o.min[k], P[3 * v + k]); o.max[k] = Math.max(o.max[k], P[3 * v + k]); } }
  }
  const list = [...comps.values()].sort((a, b) => b.tris - a.tris);
  const post = list[0];
  if (post.max[1] < h - 1e-4 || post.min[1] > 1e-4) throw new Error('stanchion: the largest component is not the full-height post');
  // the column's cross-section at half height (the long column has vertices only near its ends): post edges crossing y = h / 2
  const y0 = 0.5 * h, cut = [];
  for (let f = 0; f < I.length; f += 3) {
    if (!post.verts.has(I[f])) continue;
    for (const [a, b] of [[I[f], I[f + 1]], [I[f + 1], I[f + 2]], [I[f + 2], I[f]]]) {
      const ya = P[3 * a + 1], yb = P[3 * b + 1];
      if ((ya - y0) * (yb - y0) >= 0) continue;
      const t = (y0 - ya) / (yb - ya);
      cut.push([P[3 * a] + t * (P[3 * b] - P[3 * a]), P[3 * a + 2] + t * (P[3 * b + 2] - P[3 * a + 2])]);
    }
  }
  if (cut.length < 6) throw new Error('stanchion: no column cross-section at half height');
  const ax = (Math.min(...cut.map(c => c[0])) + Math.max(...cut.map(c => c[0]))) / 2, az = (Math.min(...cut.map(c => c[1])) + Math.max(...cut.map(c => c[1]))) / 2;
  const rPost = Math.max(...cut.map(c => Math.hypot(c[0] - ax, c[1] - az)));
  const ring = list.slice(1).filter(o => o.min[2] - az > 1.2 * rPost && o.min[1] > 0.5 * h).sort((a, b) => b.max[1] - a.max[1])[0];
  if (!ring) throw new Error('stanchion: no eye ring found on the +Z side');
  const dy = ring.max[1] - ring.min[1], dz = ring.max[2] - ring.min[2], dx = ring.max[0] - ring.min[0];
  if (Math.abs(dy - dz) > 0.3 * dy || dx > 0.4 * dy) throw new Error(`stanchion: the topmost +Z part is not a ring in the y-z plane (${[dx, dy, dz].map(r4)})`);
  return {ringY: r4((ring.min[1] + ring.max[1]) / 2),
    ring: {method: 'centre of the highest separate (position-connected) component wholly on the +Z side beyond the column (the eye ring on its bracket under the cap, where the snap hook hangs)',
      centreXZ: [r4((ring.min[0] + ring.max[0]) / 2), r4((ring.min[2] + ring.max[2]) / 2)], y: [r4(ring.min[1]), r4(ring.max[1])], diameter: r4((dy + dz) / 2), triangles: ring.tris},
    postAxisXZ: [r4(ax), r4(az)], columnRadius: r4(rPost)};
}

if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const o of outRows) fs.writeFileSync(path.join(DRY, `${o.id}.glb`), o.glb);
  console.log('dry run: GLBs written to', DRY);
  process.exit(0);
}

// ---------- outputs ----------
const written = new Map();
for (const o of outRows) {
  const {row, rec} = o;
  const line = (({event: _e, ...rest}) => rest);
  const prov = {
    schema: 'terminal-state-derivative-v1',
    id: o.id,
    key: row.key,
    role: row.role,
    task: `${TASK} (Skyways lane ASSET-D; models generated by the Skyways lead, the sole paid owner)`,
    approval: {userGenerationApprovalSha256: ack.approvalSha256,
      summary: "the user's Skyways generation approval: up to 1000 Meshy credits on NEW Skyways props with the T2.5 model (caps 66 attempts / 96 paid POSTs); Codex images uncapped but recorded; first acceptable result per asset"},
    accepted: true,
    route: 'Codex native image_gen INITIAL conditioning image (straight-on elevation) -> Meshy T2.5 image-to-3D (smart topology, 2K PBR texture); the Meshy model keeps its own PBR maps (re-encoded / downsized only; no re-texture, projection or hand-painted replacement)',
    conditioningImage: {codexCall: rec.input.codexCall, sha256: rec.input.sha256, bytes: rec.codex.files[0].bytes, promptSha256: rec.codexIntent.promptSha256,
      generator: 'OpenAI Codex CLI 0.163.0 built-in image_gen (image model id not reported)', file: `${TASK_DIR}/gen/${rec.codex.files[0].raw} (raw original, outside Git)`},
    meshy: {
      tool: ack.tool, request: {...ack.settings, target_polycount: rec.intent.target_polycount}, task: rec.posted.taskId, status: rec.status.status, consumedCredits: rec.status.consumed_credits,
      evidence: 'the create arguments are fixed in FINANCIAL-ACK.json and the fsynced ledger intent line before the POST; the 15-credit charge is the T2 / T2.5 single-image textured price (meshy-6 / 7.1 / latest bill 30); the task GET response does not echo ai_model',
      ledger: {file: `${TASK_DIR}/gen/LEDGER.jsonl (outside Git)`, lines: {intent: seq(rec.intent), posted: seq(rec.posted), status: seq(rec.status), raw: seq(rec.raw), accept: seq(rec.accept)},
        codexLines: {intent: seq(rec.codexIntent), result: seq(rec.codex)}, accept: line(rec.accept)},
    },
    source: {file: `${TASK_DIR}/gen/${rec.raw.file} (raw original, read-only, outside Git; never shipped)`, sha256: rec.raw.sha256, bytes: rec.raw.bytes,
      triangles: o.src.m.I.length / 3, vertices: o.src.m.P.length / 3, extent: o.extent, uvCharts: o.charts, material: o.src.material, maps: o.src.maps},
    output: {url: o.url, file: `game/public/${o.url}`, bytes: o.glb.length, sha256: sha(o.glb), triangles: o.tris, vertices: o.vertices, dims: o.dims, min: o.min, max: o.max},
    fit: o.fit,
    weld: o.welded.weld,
    simplify: o.simp,
    measurements: o.measures,
    textures: o.textures,
    texturePolicy: `Meshy's own maps kept slot for slot (base colour / metallic-roughness / normal), lanczos3 downsize to ${row.tex.join(' / ')} px, JPEG q86 4:2:0 / q88 4:4:4 / q90 4:4:4 (no chroma subsampling on the channel-packed and normal maps)`,
    convention: `metres at real size, +Y up; ${row.front}; grounded (min y = 0), centred on x / z; identity node (transform baked into the vertices)`,
    licence: 'generated for this project (Codex initial image -> Meshy T2.5) under the user\'s Skyways generation approval; provider terms apply; unapproved prototype asset, no blanket licence or commercial clearance implied',
    rebuild: `node ${SELF} [--reference <dir holding tasks/skyways-level-20261106-054448>]`,
  };
  const provBuf = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
  { const hit = provBuf.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=).{0,20}/i); if (hit) throw new Error(`${o.id}: URL / token-like string in public provenance: ...${hit[0]}...`); }
  written.set(o.url, o.glb);
  written.set(o.provRel, provBuf);
}
for (const [rel, buf] of written) fs.writeFileSync(path.join(PUB, rel), buf);

const extra = o => (o.row.measure ? `, ${o.row.measure}: ${o.measures[o.row.measure]}` : '');
fs.writeFileSync(REG, `// GENERATED by ${SELF} — do not edit (task skyways-level-20261106-054448, lane ASSET-D).
// The NEW Skyways Meshy T2.5 props (Codex initial conditioning image -> Meshy image-to-3D; Meshy's own PBR maps kept, re-encoded only):
// the car interior (dashboard, bucket seat) and the convention hall (stage, merch table, boxed figure, plush, prize stanchion). Per-file
// provenance in assets/derivatives/<file>.json. Metres at real size, +Y up, front +Z, grounded (min y = 0), centred on x / z.
// w / h / d = the measured runtime bounds (x / y / z extents); tris = triangles; deckY = the stage deck's top; topY = the merch table's
// top (cloth); ringY = the centre of the stanchion's eye ring (on the +Z side of the post, where the rope's snap hook hangs).
export interface SkywaysMeshyProp {
  readonly url: string; readonly w: number; readonly h: number; readonly d: number; readonly tris: number;
  readonly topY?: number; readonly deckY?: number; readonly ringY?: number;
}
export const SKYWAYS_MESHY_PROPS = {
${outRows.map(o => `  ${o.row.key}: {url: '${o.url}', w: ${o.dims[0]}, h: ${o.dims[1]}, d: ${o.dims[2]}, tris: ${o.tris}${extra(o)}},`).join('\n')}
} as const satisfies Readonly<Record<string, SkywaysMeshyProp>>;
export type SkywaysMeshyPropKey = keyof typeof SKYWAYS_MESHY_PROPS;
`);

const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const own = p => written.has(p) || ROWS.some(r => p === `assets/models/skyways-${r.asset}.glb` || p === `assets/derivatives/skyways-${r.asset}.json`);
allow.files = [...allow.files.filter(f => !own(f.path)), ...[...written].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${written.size} public files (${[...written.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json`);
