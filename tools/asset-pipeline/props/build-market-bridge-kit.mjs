// Task studio-survivor-market-crevice-20261116-074419-01 (lane BRIDGE): the Survivor Market's MODULAR BRIDGE KIT for its concrete-crevice
// layout — cooked from the USER'S OWN textured walkway-bridge model (supplied for this task; its upload file name mentions Meshy, but the
// generator, account, settings and licence are NOT verified). The user permits cutting / trimming its legs and adapting pieces for
// different spans, decks and landings; the original stays unchanged. Nothing is generated, re-textured or replaced here: every piece is
// the model's own geometry (exact plane clips, one recorded x-remap, seam-preserving decimation) with the model's own PBR maps
// (downsized / re-encoded only; its all-but-black emissive map dropped, measured and recorded).
//
// Reads (never modifies) the PRIVATE master outside Git (--master <glb>; default: the task's input under TS_REFERENCE_ROOT, else under
// the first ancestor of the repository that holds the task folder). Its sha256 + bytes must equal the record below: a different file
// stops the cook. The master never ships and is never copied into the repository; the public provenance names only its hashes and
// measurements.
//
// The source (inspected): one primitive, ~1.04 M triangles, one welded position-connected island (+ 15 tiny ones), a fragmented atlas.
// A rusty riveted walkway: a plank deck (transverse boards) between two side girders, baluster handrails on both sides with heavy posts
// every ~0.29 source units, two halves meeting at the middle, cable bundles swagging under both girders (hung from the two leg frames and
// two hangers), and an X-braced leg frame at each end. Source frame: length along X, +Y up, width along Z.
//
// GAME FRAME of every piece (metres, +Y up, the deck's long axis +X, width Z): uniform scale s = 2.0 m / the measured distance between the
// two top-rail centre-lines (so the handrails run along z = +-1.0: the runtime deck is a 2.0 m grid strip with collision rails there),
// z centred on the rail mid-line, y = 0 on the deck's walking surface (the area-weighted median height of the up-facing board tops in the
// middle of the deck). No y stretch is needed while the measured handrail top stands >= 0.95 m above the deck (else <= 1.15, recorded).
// Pieces (named mesh nodes, identity transforms, geometry in each piece's own local frame; ONE shared material):
//   End      the source's -X end: end posts, deck, girders and end frame up to the first heavy post (the joint plane = its centre, local
//            x = 0; the piece extends toward -x). Everything below the girder underside is clipped off (the legs cut just under the
//            girders; the cables, their reels and the leg nameplate go with them).
//   MidPlain one tileable bay: heavy-post centre to heavy-post centre (the rail period), above the girder underside: no cables.
//   Mid      MidPlain + a cable festoon: the source's middle cable swag (hanger centre to hanger centre: the only swag that hangs between
//            two identical clamps) clipped below the girder underside and remapped along x onto the bay (factor recorded), so its two
//            half-clamps sit exactly on the joint planes and tiled copies hang one continuous festoon.
//   Trestle  the -X end's leg frame (the two legs, their X-bracing and the conduit) from the girder underside down to the feet: local
//            top y = 0, feet y = -H, centred on x (z on the deck's rail mid-line); its transverse cable swag carved out between the legs.
// Geometry: an exact-attribute weld (lossless), exact plane clips (lib weapon-cook clipBox), meshoptimizer seam-preserving decimation per
// piece (simplifyWithAttributes: UV seams + normals kept; open clip borders stay on their planes). Maps: base colour 2048 px, metallic-
// roughness / normal 1024 px (sharp lanczos3, JPEG); the emissive map (all but black) is dropped, its stats recorded.
//
// Writes deterministically:
//   game/public/assets/models/market-bridge-kit.glb          four mesh nodes (End / Mid / MidPlain / Trestle), ONE material, Market-only
//   game/public/assets/derivatives/market-bridge-kit.json    public provenance (hashes / measurements only: no paths, names or tokens)
//   game/src/assets/marketBridgeKit.generated.ts             MARKET_BRIDGE_KIT (a three-free literal catalog)
//   game/public/assets/CREDITS.md                            its marked section
//   tools/release/public-inputs.json                         ONLY this script's two entries + CREDITS.md added / updated
//
//   node --max-old-space-size=12000 tools/asset-pipeline/props/build-market-bridge-kit.mjs [--master <glb>] [--dry-run <scratch dir>] [--measure]
//   (--dry-run writes the GLB + provenance + a registry preview only into the scratch dir; --measure prints the source measurements and
//   the per-piece clip counts, then stops)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {clipBox, r4, r5, r6, weld} from '../weapons/lib/weapon-cook.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
const TASK_DIR = 'reference/tasks/survivor-market-crevice-20261116-074419';
const REF_ROOT = (() => {
  if (process.env.TS_REFERENCE_ROOT) return path.resolve(process.env.TS_REFERENCE_ROOT);
  for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, TASK_DIR))) return d; if (path.dirname(d) === d) return root; }
})();
const MASTER = path.resolve(arg('--master') ?? path.join(REF_ROOT, TASK_DIR, 'inputs/user-bridge-master.glb'));
const DRY = arg('--dry-run') ? path.resolve(arg('--dry-run')) : null;
const MEASURE = argv.includes('--measure');
const PUB = path.join(root, 'game/public');
const REG = path.join(root, 'game/src/assets/marketBridgeKit.generated.ts');
const ALLOW = path.join(root, 'tools/release/public-inputs.json');
const CREDITS = path.join(PUB, 'assets/CREDITS.md');
const CREDITS_BEGIN = '<!-- BEGIN market-bridge-kit-20261116 (build-market-bridge-kit.mjs) -->';
const CREDITS_END = '<!-- END market-bridge-kit-20261116 -->';
/** A new section goes right after the first of these that exists (the Market's latest model section); at the end of the file when missing. */
const CREDITS_AFTER = ['<!-- END corpse-shop-20261114 -->'];
const SELF = 'tools/asset-pipeline/props/build-market-bridge-kit.mjs';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sharp = (await import('sharp')).default;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const ID = 'market-bridge-kit';
const TASK = {
  id: 'studio-survivor-market-crevice-20261116-074419-01',
  /** The private master's delivery record (size / sha256 checked on every run). */
  master: {sha256: '729afb41d59d3bed61aa6d545f33a84acea878cbb0f9f66ec1f52d0945cf9f0f', bytes: 43177692},
  route: "the user's own textured walkway-bridge model (its upload file name mentions Meshy), supplied by the user for the Survivor Market's crevice layout with explicit permission to cut / trim its legs and adapt pieces for different spans, decks and landings (the original unchanged); cooked into a modular kit: rotation-free uniform scale, a lossless weld, exact plane clips, one recorded x-remap of a cable swag, seam-preserving decimation, and the model's own maps downsized / re-encoded (no generation, re-texture, projection or replacement)",
  licence: 'supplied by the user for this project (its upload file name mentions Meshy; the generator, account, settings and licence are not verified and the provider\'s terms may apply); unapproved prototype asset, no blanket licence or commercial clearance implied',
};

/** The handrail centre-lines in the game frame (m): the runtime deck's collision rails. */
const RAIL_Z = 1.0;
/** If the measured handrail top stands lower than this above the deck, a y-only stretch (<= Y_STRETCH_MAX) lifts it to Y_RAIL_TARGET. */
const RAIL_MIN_H = 0.95, Y_RAIL_TARGET = 1.02, Y_STRETCH_MAX = 1.15;
/** The runtime may stretch Mid / MidPlain along x within this range to fit a span (checked on the assembled renders). */
const STRETCH = {min: 0.85, max: 1.2};
const TEX = {baseColor: 2048, metallicRoughness: 1024, normal: 1024};
const JPEG = {baseColor: {quality: 86, chromaSubsampling: '4:2:0'}, metallicRoughness: {quality: 88, chromaSubsampling: '4:4:4'}, normal: {quality: 90, chromaSubsampling: '4:4:4'}};
const SLOTS = ['baseColor', 'metallicRoughness', 'normal'];
const SIMPLIFY = {normalWeight: 0.5, uvWeight: 1, tool: 'meshoptimizer 1.3 simplifyWithAttributes (normals x0.5 + UV x1 attribute weights; UV seams preserved; source UVs / normals kept; open clip borders collapse only along themselves, so they stay on their planes)'};

/**
 * The recorded measurements and cuts, in SOURCE units (the raw frame; inspected on the master: renders, cross-sections, histograms).
 *  rails     the top-rail tube band (y) away from the end posts (|x| < xAbs): its vertices split at z = 0 into the two rails; each rail's
 *            centre-line z = the median z of its vertices; its top = the median over 0.01-wide x bins of the band's highest vertex
 *  deck      the walking surface: up-facing (normal y > 0.9) triangles with centroids within zAbs of the rail mid-line and inside y,
 *            |x| < xAbs: the area-weighted median centroid height (the board tops; the board gaps / stringers lie ~0.02 lower)
 *  cut       the girder underside cuts. bay 0.1395: the girders' bottom flanges are at y 0.1400 (both sides, along the whole span);
 *            just under them (only the cable clamps, a pipe-hanger rod and the legs reach higher). end 0.134: the End and the Trestle
 *            part a little lower, below the end frame's lowest cross bar (its underside ~0.136), so the bar stays whole on the End; the
 *            End's leg stubs and the Trestle's leg tops meet on that plane
 *  joints    the heavy rail posts of the source's left half (front / back rails line up within ~5 mm): the centres of the first
 *            (x -0.630) and second (x -0.338) heavy posts from the -X end. Their cross-sections overlay within a few mm (posts, girders,
 *            board top); the bay between them is the rail period: a heavy post, ~6 balusters, one diagonal brace and a sign plate.
 *  cables    the middle swag's two hanger clamps (front x [-0.2535, -0.214] / [0.212, 0.252], back [-0.258, -0.215] / [0.209, 0.249]):
 *            their centres; their cross-sections (the clamp boxes around the cable bundles under both girders) overlay within ~2 mm
 *  trestle   the -X leg frame: legs x [-0.915, -0.845] (I-beams at z [-0.242, -0.17] and [0.14, 0.215]), the X-brace plane x ~-0.86;
 *            its box ends just inboard of the brace; the transverse cable swag between the legs (x < -0.887, outboard of the brace)
 *            is carved out between the legs' inner faces, and so are the side swags' stubs that leave the legs inboard
 */
const SPEC = {
  rails: {y: [0.455, 0.49], xAbs: 0.85},
  deck: {zAbs: 0.15, y: [0.235, 0.255], xAbs: 0.9},
  cut: {bay: 0.1395, end: 0.134},
  joints: [-0.630, -0.338],
  cables: [-0.2335, 0.2315],
  end: {xMin: -Infinity},
  trestle: {x: [-Infinity, -0.8425], carve: [
    {name: 'transverse cable swag', box: {min: [-Infinity, -0.135, -0.168], max: [-0.8875, 0.1345, 0.138]}},
  ]},
};

/**
 * Per-piece triangle budgets (the brief's targets: End <= 14 k, Mid <= 9 k, MidPlain <= 6 k, Trestle <= 6 k). Mid = MidPlain + its cable
 * festoon: the festoon gets 4 k (Mid 10 k, over the 9 k target) — at 3 k the cable bundles collapse into flat jagged ribbons (relative
 * error ~0.14), at 4 k they read as separate round cables again (compared on renders at 3 / 4 / 6 / 9 k).
 */
const BUDGET = {End: 14000, MidPlain: 6000, Cables: 4000, Trestle: 6000};

const fail = m => { throw new Error(`${ID}: ${m}`); };

// ---------- the private master ----------
const bytes = fs.readFileSync(MASTER);
if (bytes.length !== TASK.master.bytes || sha(bytes) !== TASK.master.sha256) fail('the --master file is not the delivered original (bytes / sha256 mismatch)');
const raw = await (async () => {
  const doc = await io.readBinary(new Uint8Array(bytes));
  const r = doc.getRoot();
  const nodes = r.listNodes().filter(n => n.getMesh());
  if (nodes.length !== 1 || r.listMeshes().length !== 1 || r.listMaterials().length !== 1) fail('expected one mesh node / mesh / material');
  const M = nodes[0].getWorldMatrix();
  if (M.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-9)) fail('non-identity source node');
  if (r.listAnimations().length || r.listSkins().length) fail('unexpected animation / skin');
  const prims = r.listMeshes()[0].listPrimitives();
  if (prims.length !== 1 || prims[0].getMode() !== 4) fail('expected one triangle primitive');
  const p = prims[0], mat = r.listMaterials()[0];
  for (const s of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (!p.getAttribute(s)) fail(`missing ${s}`);
  if (mat.getAlphaMode() !== 'OPAQUE' || mat.getOcclusionTexture()) fail('unexpected material (alpha / occlusion)');
  const infos = {baseColor: mat.getBaseColorTextureInfo(), metallicRoughness: mat.getMetallicRoughnessTextureInfo(), normal: mat.getNormalTextureInfo()};
  for (const info of Object.values(infos)) if (!info || info.getTexCoord() !== 0) fail('a map is missing or uses TEXCOORD_1');
  const I = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({length: p.getAttribute('POSITION').getCount()}, (_, i) => i);
  const m = {P: Float64Array.from(p.getAttribute('POSITION').getArray()), N: Float64Array.from(p.getAttribute('NORMAL').getArray()),
    UV: Float64Array.from(p.getAttribute('TEXCOORD_0').getArray()), I};
  const textures = {baseColor: mat.getBaseColorTexture(), metallicRoughness: mat.getMetallicRoughnessTexture(), normal: mat.getNormalTexture()};
  const mapRec = t => ({size: t.getSize(), mime: t.getMimeType(), bytes: t.getImage().byteLength, sha256: sha(t.getImage())});
  const maps = SLOTS.map(slot => ({slot, ...mapRec(textures[slot])}));
  const sampler = Object.fromEntries(SLOTS.map(s => [s, {wrapS: infos[s].getWrapS(), wrapT: infos[s].getWrapT(), magFilter: infos[s].getMagFilter(), minFilter: infos[s].getMinFilter()}]));
  const material = {baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor(),
    emissiveFactor: mat.getEmissiveFactor(), normalScale: mat.getNormalScale(), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode()};
  // the emissive map: measured (per-channel max / mean of the decoded pixels) and dropped
  const et = mat.getEmissiveTexture();
  let emissive = null;
  if (et) {
    const {data, info} = await sharp(Buffer.from(et.getImage()), {limitInputPixels: false}).removeAlpha().raw().toBuffer({resolveWithObject: true});
    const max = [0, 0, 0], sum = [0, 0, 0];
    let lit = 0;
    for (let i = 0; i < data.length; i += 3) { let any = false; for (let k = 0; k < 3; k++) { max[k] = Math.max(max[k], data[i + k]); sum[k] += data[i + k]; if (data[i + k] > 8) any = true; } if (any) lit++; }
    const px = data.length / 3;
    emissive = {...mapRec(et), decoded: [info.width, info.height], channelMax: max, channelMean: sum.map(v => r4(v / px)), pixelsAbove8Fraction: r6(lit / px)};
  }
  const extraSemantics = p.listSemantics().filter(s => !['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(s));
  // every name / uri the master carries (its own node, mesh, material, texture, scene and generator strings): none may reach a public file
  const names = [...r.listNodes(), ...r.listMeshes(), ...r.listMaterials(), ...r.listTextures(), ...r.listScenes()].flatMap(o => [o.getName(), o.getURI?.()])
    .concat(r.getAsset().generator ?? '').filter(n => typeof n === 'string' && n.length >= 4);
  return {m, textures, maps, sampler, material, emissive, extraSemantics, tris: I.length / 3, verts: m.P.length / 3, names};
})();
if (!raw.emissive) fail('expected the source\'s emissive map (to measure and drop)');
if (raw.emissive.channelMax.some(v => v > 64) || raw.emissive.channelMean.some(v => v > 1)) fail(`the emissive map is not all but black (${JSON.stringify(raw.emissive)}): inspect before dropping it`);

// ---------- geometry: weld + the source measurements ----------
const welded = weld(raw.m);
const src = welded.m;
const median = a => { const s = Float64Array.from(a).sort(); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const measure = (() => {
  const P = src.P, nv = P.length / 3;
  // the two top rails
  const zs = [[], []];
  for (let v = 0; v < nv; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    if (y >= SPEC.rails.y[0] && y <= SPEC.rails.y[1] && Math.abs(x) < SPEC.rails.xAbs) zs[z < 0 ? 0 : 1].push(z);
  }
  const railZ = zs.map(median);
  const zc = (railZ[0] + railZ[1]) / 2, half = (railZ[1] - railZ[0]) / 2;
  // each rail's top: per 0.01 x bin, the band's highest vertex near the rail; the median over bins
  const tops = railZ.map(rz => {
    const bins = new Map();
    for (let v = 0; v < nv; v++) {
      const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
      if (y < SPEC.rails.y[0] || Math.abs(x) >= SPEC.rails.xAbs || Math.abs(z - rz) > 0.02) continue;
      const b = Math.floor(x / 0.01);
      bins.set(b, Math.max(bins.get(b) ?? -Infinity, y));
    }
    return median([...bins.values()]);
  });
  // the deck's walking surface
  const ys = [], ws = [];
  const I = src.I;
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f], b = 3 * I[f + 1], c = 3 * I[f + 2];
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (cy < SPEC.deck.y[0] || cy > SPEC.deck.y[1] || Math.abs(cz - zc) > SPEC.deck.zAbs || Math.abs(cx) > SPEC.deck.xAbs) continue;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (!l || ny / l <= 0.9) continue;
    ys.push(cy); ws.push(l / 2);
  }
  const order = ys.map((_, i) => i).sort((p, q) => ys[p] - ys[q]);
  const total = ws.reduce((t, w) => t + w, 0);
  let acc = 0, deckY = NaN;
  for (const i of order) { acc += ws[i]; if (acc >= total / 2) { deckY = ys[i]; break; } }
  const b = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], P[3 * v + k]); b.max[k] = Math.max(b.max[k], P[3 * v + k]); }
  return {railZ, zc, half, railTop: tops, deckY, deckArea: total, bounds: b, railVerts: zs.map(a => a.length)};
})();
const S = RAIL_Z / measure.half;
const railH0 = (Math.min(...measure.railTop) - measure.deckY) * S;
const SY = railH0 >= RAIL_MIN_H ? 1 : Math.min(Y_STRETCH_MAX, Y_RAIL_TARGET / railH0);
if (railH0 * SY < RAIL_MIN_H) fail(`the handrail stands only ${r4(railH0 * SY)} m above the deck even with the y stretch cap`);
const L_SRC = SPEC.joints[1] - SPEC.joints[0], KX = L_SRC / (SPEC.cables[1] - SPEC.cables[0]);
const toGame = {
  scale: S, stretchY: SY,
  rule: `x' = (x - x0) * ${r6(S)} (x0 = the piece's local origin), y' = (y - ${r6(measure.deckY)}) * ${r6(S)}${SY !== 1 ? ` * ${r6(SY)}` : ''}, z' = (z - ${r6(measure.zc)}) * ${r6(S)}`,
};
const G = {
  deckY: measure.deckY, zc: measure.zc,
  x: (x, x0, kx = 1) => (x - x0) * kx * S, y: (y, y0 = measure.deckY) => (y - y0) * S * SY, z: z => (z - measure.zc) * S,
};
if (MEASURE) {
  console.log('source bounds', measure.bounds.min.map(r4), measure.bounds.max.map(r4), 'tris', raw.tris, 'weld', welded.info);
  console.log('rails z', measure.railZ.map(r5), 'mid-line', r5(measure.zc), 'half', r5(measure.half), 'tops', measure.railTop.map(r5), 'verts', measure.railVerts);
  console.log('deck y', r5(measure.deckY), 'area', r6(measure.deckArea), '-> scale', r6(S), 'rail h', r4(railH0), 'm, y stretch', r4(SY));
  console.log('joints', SPEC.joints, 'L', r4(L_SRC * S), 'm; cable window', SPEC.cables, 'kx', r6(KX), '; girder depth', r4((measure.deckY - SPEC.cut.bay) * S * SY), 'm; leg cut depth', r4((measure.deckY - SPEC.cut.end) * S * SY), 'm');
  console.log('emissive', JSON.stringify(raw.emissive));
}

// ---------- pieces: exact clips of the welded source ----------
/** The triangles of m kept by an axis-aligned box (keep 'inside' | 'outside'), crossing triangles split exactly on its faces: a mesh. */
function cut(m, box, keep = 'inside') {
  const T = m.I.length / 3, cand = [], whole = [];
  for (let t = 0; t < T; t++) {
    let overlaps = true, inside = true;
    for (let k = 0; k < 3; k++) {
      const a = m.P[3 * m.I[3 * t] + k], b = m.P[3 * m.I[3 * t + 1] + k], c = m.P[3 * m.I[3 * t + 2] + k];
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      if (hi < box.min[k] || lo > box.max[k]) overlaps = false;
      if (lo < box.min[k] || hi > box.max[k]) inside = false;
    }
    if (!overlaps) { if (keep === 'outside') whole.push(t); continue; }
    if (inside) { if (keep === 'inside') whole.push(t); continue; }
    cand.push(t);
  }
  const c = clipBox(m, cand, box);
  const I = [];
  for (const t of whole) I.push(m.I[3 * t], m.I[3 * t + 1], m.I[3 * t + 2]);
  for (const v of keep === 'inside' ? c.inside : c.outside) I.push(v);
  return {mesh: reindex({P: c.P, N: c.N, UV: c.UV}, I), info: {candidateTriangles: cand.length, splitTriangles: c.splitTriangles, keptTriangles: I.length / 3}};
}
/** A compact mesh of the triangles I (indices into m); zero-area triangles (a clip's slivers) dropped. */
function reindex(m, I) {
  const map = new Map(), P = [], N = [], UV = [], J = [];
  let degenerate = 0;
  for (let f = 0; f < I.length; f += 3) {
    const t = [I[f], I[f + 1], I[f + 2]];
    const p = t.map(v => [m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]]);
    const u = [0, 1, 2].map(k => p[1][k] - p[0][k]), w = [0, 1, 2].map(k => p[2][k] - p[0][k]);
    if (Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) < 1e-14) { degenerate++; continue; }
    for (const v of t) {
      if (!map.has(v)) { map.set(v, P.length / 3); P.push(m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]); N.push(m.N[3 * v], m.N[3 * v + 1], m.N[3 * v + 2]); UV.push(m.UV[2 * v], m.UV[2 * v + 1]); }
      J.push(map.get(v));
    }
  }
  return {P: Float64Array.from(P), N: Float64Array.from(N), UV: Float64Array.from(UV), I: Uint32Array.from(J), degenerate};
}
/** The mesh in a piece's local game frame: x' = (x - x0) * kx * S, y' = (y - y0) * S * SY, z' = (z - zc) * S; normals by the inverse transpose. */
function toLocal(m, x0, y0 = measure.deckY, kx = 1) {
  const nv = m.P.length / 3, P = new Float64Array(nv * 3), N = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    P[3 * v] = G.x(m.P[3 * v], x0, kx); P[3 * v + 1] = G.y(m.P[3 * v + 1], y0); P[3 * v + 2] = G.z(m.P[3 * v + 2]);
    const nx = m.N[3 * v] / kx, ny = m.N[3 * v + 1] / SY, nz = m.N[3 * v + 2], l = Math.hypot(nx, ny, nz) || 1;
    N[3 * v] = nx / l; N[3 * v + 1] = ny / l; N[3 * v + 2] = nz / l;
  }
  return {P, N, UV: m.UV, I: m.I};
}
function merge(...ms) {
  let off = 0;
  const P = [], N = [], UV = [], I = [];
  for (const m of ms) { P.push(...m.P); N.push(...m.N); UV.push(...m.UV); for (const v of m.I) I.push(v + off); off += m.P.length / 3; }
  return {P: Float64Array.from(P), N: Float64Array.from(N), UV: Float64Array.from(UV), I: Uint32Array.from(I)};
}
const boundsOf = m => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < m.P.length / 3; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.P[3 * v + k]); max[k] = Math.max(max[k], m.P[3 * v + k]); }
  return {min, max};
};

const INF = Infinity, [J0, J1] = SPEC.joints, [C0, C1] = SPEC.cables, YB = SPEC.cut.bay, YE = SPEC.cut.end;
const ops = [];
const clipRec = (piece, what, box, info, keep = 'inside') => ops.push({piece, op: keep === 'inside' ? 'clip' : 'carve', what,
  box: {min: box.min.map(v => (Number.isFinite(v) ? v : null)), max: box.max.map(v => (Number.isFinite(v) ? v : null))}, keep, ...info,
  rule: `exact axis-aligned clip in source units (null = open): triangles crossing a face are split exactly along it (interpolated position / normal / UV); the ${keep} part kept`});

const endBox = {min: [SPEC.end.xMin, YE, -INF], max: [J0, INF, INF]};
const endCut = cut(src, endBox); clipRec('End', 'the -X end above the end cut (legs cut just under the girders and the end frame), up to the first heavy post\'s centre', endBox, endCut.info);
const midBox = {min: [J0, YB, -INF], max: [J1, INF, INF]};
const midCut = cut(src, midBox); clipRec('MidPlain', 'one rail bay above the girder underside: heavy-post centre to heavy-post centre', midBox, midCut.info);
const cabBox = {min: [C0, -INF, -INF], max: [C1, YB, INF]};
const cabCut = cut(src, cabBox); clipRec('Mid', 'the middle cable swag below the girder underside, hanger-clamp centre to hanger-clamp centre', cabBox, cabCut.info);
const treBox = {min: [SPEC.trestle.x[0], -INF, -INF], max: [SPEC.trestle.x[1], YE, INF]};
let treCut = cut(src, treBox); clipRec('Trestle', 'the -X leg frame below the girder underside, to just inboard of its X-brace', treBox, treCut.info);
let treMesh = treCut.mesh;
for (const c of SPEC.trestle.carve) {
  const k = cut(treMesh, c.box, 'outside');
  clipRec('Trestle', c.name, c.box, k.info, 'outside');
  treMesh = k.mesh;
}
if (MEASURE) {
  for (const [n, c] of [['End', endCut], ['MidPlain', midCut], ['cables', cabCut], ['Trestle', {mesh: treMesh}]]) {
    const b = boundsOf(c.mesh);
    console.log(n.padEnd(9), 'tris', c.mesh.I.length / 3, 'bounds', b.min.map(r4), b.max.map(r4));
  }
}

// the trestle's own x centre (source units) and its feet
const treB = boundsOf(treMesh), TX = (treB.min[0] + treB.max[0]) / 2;
const pieces0 = {
  End: toLocal(endCut.mesh, J0),
  MidPlain: toLocal(midCut.mesh, J0),
  Cables: toLocal(cabCut.mesh, C0, measure.deckY, KX),
  Trestle: toLocal(treMesh, TX, YE),
};
ops.push({piece: 'Mid', op: 'remapX', what: 'the cable festoon onto the bay', factor: r6(KX), from: [C0, C1], to: [J0, J1],
  rule: `x' = (x - ${C0}) * ${r6(KX)} (source units, then the game scale): the swag's two hanger-clamp centres land exactly on the bay's joint planes, so tiled copies hang one continuous festoon from a clamp at every heavy post; normals by the inverse transpose. Cable cross-sections are in y / z and keep their size; the clamps and the diagonal cable runs near them narrow along x`});
if (MEASURE) process.exit(0);

// ---------- seam-preserving decimation ----------
await MeshoptSimplifier.ready;
/** meshoptimizer simplifyWithAttributes toward `budget` triangles (asks for less while the UV seams stall the collapse); source attributes kept. */
function simplify(m, budget) {
  const tris0 = m.I.length / 3;
  if (tris0 <= budget) return {m, info: {applied: false, reason: `already within the ${budget} budget`, triangles: tris0, budget}};
  const nv = m.P.length / 3, P32 = Float32Array.from(m.P), attrs = new Float32Array(nv * 5);
  for (let v = 0; v < nv; v++) {
    for (let k = 0; k < 3; k++) attrs[5 * v + k] = m.N[3 * v + k] * SIMPLIFY.normalWeight;
    attrs[5 * v + 3] = m.UV[2 * v] * SIMPLIFY.uvWeight; attrs[5 * v + 4] = m.UV[2 * v + 1] * SIMPLIFY.uvWeight;
  }
  let out, err, ask = budget, passes = 0, prev = Infinity;
  for (; passes < 12; passes++) {
    [out, err] = MeshoptSimplifier.simplifyWithAttributes(m.I, P32, 3, attrs, 5, [1, 1, 1, 1, 1], null, ask * 3, 1, []);
    if (out.length / 3 <= budget || out.length / 3 >= prev) break;
    prev = out.length / 3;
    ask = Math.floor(ask * Math.min(0.97, budget / (out.length / 3)));
  }
  const kept = reindex(m, out);
  return {m: kept, info: {applied: true, tool: SIMPLIFY.tool, normalWeight: SIMPLIFY.normalWeight, uvWeight: SIMPLIFY.uvWeight, fromTriangles: tris0,
    triangles: kept.I.length / 3, budget, askedTriangles: ask, passes: passes + 1, errorRelative: r6(err), errorM: r4(err * MeshoptSimplifier.getScale(P32, 3))}};
}
const simp = Object.fromEntries(['End', 'MidPlain', 'Cables', 'Trestle'].map(k => [k, simplify(pieces0[k], BUDGET[k])]));
for (const [k, v] of Object.entries(simp)) if (v.info.triangles > BUDGET[k]) fail(`${k}: decimation stalled at ${v.info.triangles} triangles (> its ${BUDGET[k]} budget): ${JSON.stringify(v.info)}`);
const mesh = {
  End: simp.End.m,
  Mid: merge(simp.MidPlain.m, simp.Cables.m),
  MidPlain: simp.MidPlain.m,
  Trestle: simp.Trestle.m,
};
const NODES = ['End', 'Mid', 'MidPlain', 'Trestle'];

// ---------- maps: the model's own, downsized + re-encoded (the emissive map dropped) ----------
const maps = {images: {}, recs: []};
for (const slot of SLOTS) {
  const t = raw.textures[slot], img = Buffer.from(t.getImage()), [sw, sh] = t.getSize(), px = TEX[slot];
  const out = await sharp(img, {limitInputPixels: false}).removeAlpha().resize(px, px, {fit: 'fill', kernel: 'lanczos3'}).jpeg(JPEG[slot]).toBuffer();
  maps.images[slot] = out;
  maps.recs.push({slot, source: {size: [sw, sh], mime: t.getMimeType(), bytes: img.length, sha256: sha(img)}, size: [px, px], mime: 'image/jpeg', bytes: out.length, sha256: sha(out),
    note: `the model's ${sw} px map ${px === sw ? 're-encoded at' : 'downsized to'} ${px} (sharp lanczos3, JPEG q${JPEG[slot].quality} ${JPEG[slot].chromaSubsampling})`});
}

// ---------- the document ----------
const doc = new Document();
const buf = doc.createBuffer();
const tex = Object.fromEntries(SLOTS.map(slot => [slot, doc.createTexture(`${ID}-${slot}`).setImage(new Uint8Array(maps.images[slot])).setMimeType('image/jpeg')]));
const mt = raw.material;
const mat = doc.createMaterial(ID).setBaseColorFactor(mt.baseColorFactor).setMetallicFactor(mt.metallicFactor).setRoughnessFactor(mt.roughnessFactor)
  .setEmissiveFactor([0, 0, 0]).setDoubleSided(mt.doubleSided).setAlphaMode(mt.alphaMode)
  .setBaseColorTexture(tex.baseColor).setMetallicRoughnessTexture(tex.metallicRoughness).setNormalTexture(tex.normal).setNormalScale(mt.normalScale);
for (const [slot, info] of [['baseColor', mat.getBaseColorTextureInfo()], ['metallicRoughness', mat.getMetallicRoughnessTextureInfo()], ['normal', mat.getNormalTextureInfo()]]) {
  const s = raw.sampler[slot];
  info.setWrapS(s.wrapS).setWrapT(s.wrapT); if (s.magFilter != null) info.setMagFilter(s.magFilter); if (s.minFilter != null) info.setMinFilter(s.minFilter);
}
const scene = doc.createScene(ID);
doc.getRoot().setDefaultScene(scene);
const acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
for (const name of NODES) {
  const {P, N, UV, I} = mesh[name];
  const P32 = Float32Array.from(P);
  const prim = doc.createPrimitive().setMaterial(mat).setAttribute('POSITION', acc('VEC3', P32)).setAttribute('NORMAL', acc('VEC3', Float32Array.from(N)))
    .setAttribute('TEXCOORD_0', acc('VEC2', Float32Array.from(UV))).setIndices(acc('SCALAR', P.length / 3 < 65536 ? Uint16Array.from(I) : Uint32Array.from(I)));
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}
doc.getRoot().getAsset().generator = `Terminal State ${SELF} (glTF-Transform)`;
const glb = Buffer.from(await io.writeBinary(doc));
const json = glb.subarray(20, 20 + glb.readUInt32LE(12)).toString();
const sourceName = text => raw.names.find(n => text.toLowerCase().includes(n.toLowerCase()));
if (/https?:|Signature|X-Amz|token|_texture\.glb/i.test(json) || sourceName(json)) fail('URL / token / an upload or source name string inside the glTF JSON');

// ---------- verify the written bytes + measure on them ----------
const chk = (await io.readBinary(new Uint8Array(glb))).getRoot();
if (chk.listMaterials().length !== 1 || chk.listTextures().length !== 3 || chk.listNodes().length !== NODES.length) fail('not four mesh nodes sharing one material with three maps');
if (chk.listMaterials()[0].getEmissiveTexture()) fail('the emissive map was written');
/** A written node's mesh (Float64 copies) — every node has an identity transform. */
const written = Object.fromEntries(chk.listNodes().map(n => {
  if (n.getTranslation().some(v => v !== 0) || n.getRotation().some((v, i) => v !== [0, 0, 0, 1][i]) || n.getScale().some(v => v !== 1)) fail(`${n.getName()}: a non-identity node transform`);
  const p = n.getMesh().listPrimitives()[0];
  return [n.getName(), {P: Float64Array.from(p.getAttribute('POSITION').getArray()), I: Uint32Array.from(p.getIndices().getArray())}];
}));
/** Up-facing (normal y > 0.9) triangle area-weighted median height within a predicate on the centroid (a surface's height). */
const upMedian = (m, keep) => {
  const ys = [], ws = [];
  for (let f = 0; f < m.I.length; f += 3) {
    const a = 3 * m.I[f], b = 3 * m.I[f + 1], c = 3 * m.I[f + 2], P = m.P;
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    if (!keep(cx, cy, cz)) continue;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (!l || ny / l <= 0.9) continue;
    ys.push(cy); ws.push(l / 2);
  }
  const order = ys.map((_, i) => i).sort((p, q) => ys[p] - ys[q]), total = ws.reduce((t, w) => t + w, 0);
  let acc2 = 0;
  for (const i of order) { acc2 += ws[i]; if (acc2 >= total / 2) return {y: ys[i], area: total}; }
  return {y: NaN, area: 0};
};
/** The highest surface hit by a vertical ray through (x, z) (the triangles' xz projection), or -Infinity. */
const rayTop = (m, x, z) => {
  let top = -Infinity;
  for (let f = 0; f < m.I.length; f += 3) {
    const a = 3 * m.I[f], b = 3 * m.I[f + 1], c = 3 * m.I[f + 2], P = m.P;
    const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
    if (Math.abs(d) < 1e-14) continue;
    const l0 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d;
    const l1 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d, l2 = 1 - l0 - l1;
    if (l0 < 0 || l1 < 0 || l2 < 0) continue;
    top = Math.max(top, l0 * P[a + 1] + l1 * P[b + 1] + l2 * P[c + 1]);
  }
  return top;
};
/** Each handrail's top above the deck: per x sample (every 0.1 m inside [x0, x1]) the highest ray hit within 4 cm of the rail line; the median. */
const railTopOf = (m, x0, x1) => [-1, 1].map(side => {
  const hits = [];
  for (let x = x0 + 0.05; x < x1 - 0.04; x += 0.1) hits.push(Math.max(...[-0.04, -0.02, 0, 0.02, 0.04].map(dz => rayTop(m, x, side * RAIL_Z + dz))));
  return median(hits);
});
/** The vertices lying on a plane x = c (within 0.5 mm): their y / z bounds (a joint's cross-section extent). */
const sectionAt = (m, c) => {
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  let n = 0;
  for (let v = 0; v < m.P.length / 3; v++) if (Math.abs(m.P[3 * v] - c) < 5e-4) { n++; for (const [i, k] of [[0, 1], [1, 2]]) { min[i] = Math.min(min[i], m.P[3 * v + k]); max[i] = Math.max(max[i], m.P[3 * v + k]); } }
  return {vertices: n, y: [r4(min[0]), r4(max[0])], z: [r4(min[1]), r4(max[1])]};
};
const pieceRec = {};
for (const name of NODES) {
  const m = written[name], b = boundsOf(m);
  pieceRec[name] = {node: name, tris: m.I.length / 3, vertices: m.P.length / 3, min: b.min.map(r4), max: b.max.map(r4), dims: [0, 1, 2].map(k => r4(b.max[k] - b.min[k]))};
}
const L = G.x(J1, J0);
const deckOf = (m, x0, x1) => upMedian(m, (x, y, z) => x > x0 && x < x1 && Math.abs(z) < 0.6 && Math.abs(y) < 0.06);
const deck = {End: deckOf(written.End, pieceRec.End.min[0] + 0.2, -0.05), Mid: deckOf(written.Mid, 0.05, L - 0.05), MidPlain: deckOf(written.MidPlain, 0.05, L - 0.05)};
for (const [k, d] of Object.entries(deck)) if (!(Math.abs(d.y) <= 0.01)) fail(`${k}: the deck's walking surface is at y ${r4(d.y)} (not 0 +- 1 cm)`);
const rails = {End: railTopOf(written.End, pieceRec.End.min[0] + 0.3, 0), Mid: railTopOf(written.MidPlain, 0, L)};
const railH = r4(median([...rails.End, ...rails.Mid]));
if (railH < RAIL_MIN_H) fail(`the handrail top stands ${railH} m above the deck (< ${RAIL_MIN_H})`);
for (const name of ['End', 'Mid', 'MidPlain']) { const zr = [pieceRec[name].min[2], pieceRec[name].max[2]]; if (!(zr[0] < -RAIL_Z && zr[1] > RAIL_Z)) fail(`${name}: the rails do not straddle z = +-${RAIL_Z}`); }
/** The bay's girder underside below the deck (MidPlain's lowest point: the girders' bottom flanges). */
const girderDepth = r4(-pieceRec.MidPlain.min[1]);
/** The End / Trestle parting plane below the deck: the End's leg stubs end there and the Trestle's top (y 0) belongs there. */
const legCutDepth = r4(-G.y(YE));
if (Math.abs(pieceRec.End.min[1] + legCutDepth) > 1e-3) fail(`End: its leg stubs end at y ${pieceRec.End.min[1]}, not on the end cut (-${legCutDepth})`);
if (Math.abs(girderDepth + G.y(YB)) > 0.01) fail(`MidPlain: its underside ${girderDepth} is not the girder flange just above the bay cut (${r4(-G.y(YB))})`);
const cableDrop = r4(-pieceRec.Mid.min[1]);
const trestleH = r4(-pieceRec.Trestle.min[1]);
if (Math.abs(pieceRec.Trestle.max[1]) > 1e-4) fail(`Trestle: its top is at y ${pieceRec.Trestle.max[1]} (not 0)`);
if (Math.abs(pieceRec.Trestle.min[0] + pieceRec.Trestle.max[0]) > 2e-3) fail('Trestle: not centred on x');
if (Math.abs(pieceRec.End.max[0]) > 1e-4 || Math.abs(pieceRec.MidPlain.min[0]) > 1e-4 || Math.abs(pieceRec.MidPlain.max[0] - L) > 1e-4 || Math.abs(pieceRec.Mid.max[0] - L) > 1e-4 || Math.abs(pieceRec.Mid.min[0]) > 1e-4) fail('a joint plane moved off x = 0 / L');
const sections = {End: {x0: sectionAt(written.End, 0)}, Mid: {x0: sectionAt(written.Mid, 0), xL: sectionAt(written.Mid, L)}, MidPlain: {x0: sectionAt(written.MidPlain, 0), xL: sectionAt(written.MidPlain, L)}};
for (const [a, b] of [[sections.MidPlain.x0, sections.MidPlain.xL], [sections.Mid.x0, sections.Mid.xL], [sections.End.x0, sections.MidPlain.x0]]) {
  const d = Math.max(...[...a.y, ...a.z].map((v, i) => Math.abs(v - [...b.y, ...b.z][i])));
  if (d > 0.03) fail(`joint cross-sections differ by ${r4(d)} m (${JSON.stringify(a)} vs ${JSON.stringify(b)})`);
}
const endTrestleX = r4(G.x(TX, J0));
const tris = NODES.reduce((t, n) => t + pieceRec[n].tris, 0);
console.log(`${ID}: ${raw.tris} source tris; scale ${r6(S)} (y stretch ${r4(SY)}); rail h ${railH} m; L ${r4(L)} m; girder ${girderDepth} m; cable drop ${cableDrop} m; trestle H ${trestleH} m; ` +
  `${NODES.map(n => `${n} ${pieceRec[n].tris} tris ${pieceRec[n].dims.join(' x ')}`).join(' | ')}; ${glb.length} B; maps ${maps.recs.map(t => `${t.slot} ${t.source.size[0]} -> ${t.size[0]} ${t.bytes}`).join(', ')}`);

// ---------- public provenance (hashes and measurements only) ----------
const url = `assets/models/${ID}.glb`, provRel = `assets/derivatives/${ID}.json`;
const prov = {
  schema: 'terminal-state-derivative-v1', id: ID, level: 'market',
  role: 'the Survivor Market crevice layout\'s modular walkway-bridge kit: End (an abutment end), Mid (a tileable bay with a cable festoon), MidPlain (the same bay without cables, for over walkways) and Trestle (a leg frame for a deck standing over a lower floor)',
  task: TASK.id, route: TASK.route,
  source: {kind: 'user-supplied textured GLB: the private master stays outside Git, read-only and never shipped (an independent backup is kept by the lead)', sha256: TASK.master.sha256, bytes: TASK.master.bytes,
    triangles: raw.tris, vertices: raw.verts, bounds: {min: measure.bounds.min.map(r5), max: measure.bounds.max.map(r5)},
    axes: 'the deck along X, +Y up, width along Z; a plank deck between two side girders, baluster handrails on both sides, two halves meeting at x ~0, cable bundles swagging under both girders, an X-braced leg frame at each end',
    material: raw.material, maps: raw.maps, emissive: raw.emissive, droppedAttributes: raw.extraSemantics},
  processing: {
    weld: {...welded.info, rule: 'exact-attribute weld (bitwise-equal position / normal / uv), degenerate triangles and unreferenced vertices dropped: lossless'},
    measured: {
      railCentreLineZ: measure.railZ.map(r5), railMidLineZ: r5(measure.zc), railHalfSpacing: r5(measure.half), railTopY: measure.railTop.map(r5),
      railRule: `the top-rail tube band y ${SPEC.rails.y.join(' .. ')} (|x| < ${SPEC.rails.xAbs}) split at z = 0; centre-line z = the median z of each rail's vertices; top = the median over 0.01-wide x bins of the band's highest vertex within 0.02 of the line`,
      deckY: r5(measure.deckY), deckRule: `the area-weighted median centroid height of the up-facing (normal y > 0.9) triangles within ${SPEC.deck.zAbs} of the rail mid-line, y ${SPEC.deck.y.join(' .. ')}, |x| < ${SPEC.deck.xAbs}: the board tops`,
      units: 'source units',
    },
    frame: {...toGame, railZ: RAIL_Z, scaleRule: `uniform scale = ${RAIL_Z} m / the measured half-spacing of the two top-rail centre-lines (the runtime deck's collision rails run along z = +-${RAIL_Z})`,
      yStretch: SY === 1 ? `none: the measured handrail top stands ${r4(railH0)} m above the deck (>= ${RAIL_MIN_H})` : `y-only ${r4(SY)} to lift the handrail from ${r4(railH0)} to ~${Y_RAIL_TARGET} m`,
      rotation: 'none: the source\'s +X stays the deck\'s long axis'},
    cuts: {yCutSource: SPEC.cut, jointsSource: SPEC.joints, cablesSource: SPEC.cables, trestleSource: {x: SPEC.trestle.x.map(v => (Number.isFinite(v) ? v : null)), carve: SPEC.trestle.carve.map(c => c.name)},
      rationale: [
        'girder underside: the girders\' bottom flanges reach down to ~0.137; the cut at 0.134 keeps the whole girders and the end frame\'s lowest cross bar on the deck pieces and takes every cable, the cable tray pipe, the leg nameplate and the hose reels off them (hanging cables over walkways would hang into people\'s heads)',
        'the rail period: the left half\'s two heavy posts (x -0.630 / -0.338: a bay of one heavy post, ~6 balusters, a diagonal brace and a sign plate); cut through their centres, the two half-posts of consecutive bays join into one post; their cross-sections (posts, girders, board top) overlay within a few mm. The board pitch (~0.066) does not divide the bay, so each joint shows one narrow board',
        'the cable festoon: the swags hang leg -> hanger (x ~-0.233) -> hanger (x ~0.232) -> leg; no swag spans the rail period, so the middle swag (the one hung between two identical clamps) is clipped from clamp centre to clamp centre and remapped onto the bay (factor in ops): the clamps land on the joint planes, the festoon connects across copies',
        'the End: the source\'s -X end (its first bay is continuous with the cooked bay); the +X end is a near mirror image',
        'the Trestle: the -X leg frame below the cut; its box ends just inboard of the X-brace plane, its transverse cable swag (outboard of the brace, between the legs) carved out at the legs\' inner faces',
      ]},
    ops,
    simplify: Object.fromEntries(Object.entries(simp).map(([k, v]) => [k === 'Cables' ? 'Mid cable festoon' : k, v.info])),
    pieceComposition: {End: 'End clip', Mid: 'MidPlain (the identical decimated bay) + the decimated cable festoon', MidPlain: 'MidPlain clip', Trestle: 'Trestle clip minus its carves'},
  },
  output: {url, file: `game/public/${url}`, bytes: glb.length, sha256: sha(glb), triangles: tris, nodes: NODES, pieces: pieceRec,
    deckY: 0, railZ: RAIL_Z, railH, girderDepth, cableDrop, trestleHeight: trestleH, midLength: r4(L), endTrestleX,
    deckSurface: Object.fromEntries(Object.entries(deck).map(([k, d]) => [k, {y: r5(d.y), areaM2: r4(d.area)}])),
    deckRule: 'area-weighted median height of the up-facing (normal y > 0.9) triangles within |z| < 0.6 and |y| < 0.06 (the board tops between the rails)',
    railTops: {End: rails.End.map(r4), Mid: rails.Mid.map(r4)}, joints: sections,
    stretch: STRETCH,
    frames: {
      End: 'x <= 0: the joint plane at x = 0, the abutment end toward -x; deck top y = 0, rails z = +-1; its leg stubs end at the girder underside (y = -girderDepth); the -X leg frame stands under it at x = endTrestleX',
      Mid: `x 0 .. ${r4(L)}: tileable (consecutive copies at x += midLength join post half to post half; the cable festoon's clamps sit on both joint planes); deck top y = 0, rails z = +-1; its cables hang to y = -cableDrop`,
      MidPlain: 'Mid without the cable festoon (nothing below y = -girderDepth): for over walkways',
      Trestle: 'top y = 0 (meets the girder underside, i.e. placed at y = -girderDepth below a deck top), feet y = -trestleHeight, centred on x; z on the deck\'s rail mid-line (z = 0 under a deck)',
    }},
  textures: maps.recs,
  texturePolicy: 'the model\'s own PBR maps kept slot for slot (base colour / metallic-roughness / normal), only downsized + re-encoded: base colour 2048 px (kept: the deck boards and rust read at walking distance), metallic-roughness / normal 2048 -> 1024 px (no recolour, tint, re-texture, projection or new art); the emissive map is DROPPED (emissive factor 0): measured all but black (source.emissive)',
  limitations: [
    'the clip faces are open (the material is double-sided, as the source\'s): the End\'s leg stubs end open at the girder underside and the Trestle\'s legs open at its top, both under the girders',
    'each bay joint shows one narrow deck board (the board pitch does not divide the rail period)',
    'Mid\'s cable festoon is the source\'s middle swag remapped along x onto the shorter bay: it hangs relatively deeper and its two clamps are narrower than in the source',
    'the End has no legs of its own below the girders (the Trestle supplies them); the abutment end\'s end posts and the end frame are the source\'s',
  ],
  convention: 'metres, +Y up, the deck along +X, rails along z = +-1, the deck\'s walking surface at y = 0; four mesh nodes with identity transforms and one shared material; geometry in each piece\'s own local frame (see output.frames)',
  licence: TASK.licence, rebuild: `node --max-old-space-size=12000 ${SELF} [--master <the private master glb>]`,
};
const provBytes = Buffer.from(JSON.stringify(prov, null, 1) + '\n');
{
  const hit = provBytes.toString().match(/.{0,60}(https?:|Signature|X-Amz|Key-Pair|token=|reference\/|\/workspace|\/home\/|portal|prompt|_texture\.glb).{0,20}/i);
  if (hit) fail(`URL / token / private path / generation text in the public provenance: ...${hit[0]}...`);
  if (sourceName(provBytes.toString())) fail('a source name string in the public provenance');
}

// ---------- registry ----------
const vec = v => `[${v.map(x => String(r4(x))).join(', ')}]`;
const pieceTs = (n, extra = '') => `    ${n}: {node: '${n}', tris: ${pieceRec[n].tris}, min: ${vec(pieceRec[n].min)}, max: ${vec(pieceRec[n].max)}${extra}},`;
const registry = `// GENERATED by ${SELF} (task ${TASK.id}) — do not edit.
/**
 * The Survivor Market crevice layout's MODULAR BRIDGE KIT: the user's own rusty walkway-bridge model cut into runtime pieces (its own
 * PBR maps kept: base colour 2048 px, metallic-roughness / normal 1024 px; one shared material). Provenance in
 * assets/derivatives/market-bridge-kit.json. Market-only (assets/levelAssets.ts 'market-*'), never a boot model.
 * Every piece is a named mesh node with an identity transform, its geometry in its own local frame: metres, +Y up, the deck along +X,
 * the deck's walking surface at y = deckY (0), the two handrail centre-lines at z = +-railZ (1.0), the handrail top railH above the deck.
 *  - End: the abutment end. The joint plane at x = 0, the end toward -x (place it at a span start; turn it 180 deg about Y for the far
 *    end). No legs or cables: its leg stubs end at the girder underside (y = -girderDepth). endTrestleX = where the source's leg frame
 *    stood under it (End-local x).
 *  - Mid: one tileable bay, x 0 .. length (copies at x += length join post half to post half), with a cable festoon whose clamps sit on
 *    both joint planes; its cables hang to y = -cableDrop. Over the chasm.
 *  - MidPlain: the same bay with nothing below the girder underside (no cables): over walkways. Mixes with Mid bay for bay.
 *  - Trestle: a leg frame. Top at y = 0 (meets the girder underside: place at y = deck top - girderDepth), feet at y = -height,
 *    centred on x, z on the deck's mid-line.
 * stretch: the range a runtime may stretch Mid / MidPlain along x to fit a span (checked on assembled renders).
 */
export interface MarketBridgePiece {
  node: string; tris: number; min: readonly [number, number, number]; max: readonly [number, number, number];
  /** Mid / MidPlain: the tiling period along x (m). */
  length?: number;
  /** Trestle: top (y 0) to feet (m). */
  height?: number;
}
export const MARKET_BRIDGE_KIT = {
  key: '${ID}', url: '${url}', bytes: ${glb.length}, sha256: '${sha(glb)}',
  pieces: {
${pieceTs('End')}
${pieceTs('Mid', `, length: ${r4(L)}`)}
${pieceTs('MidPlain', `, length: ${r4(L)}`)}
${pieceTs('Trestle', `, height: ${trestleH}`)}
  },
  deckY: 0, railZ: ${RAIL_Z}, railH: ${railH}, girderDepth: ${girderDepth}, cableDrop: ${cableDrop}, endTrestleX: ${endTrestleX},
  stretch: {min: ${STRETCH.min}, max: ${STRETCH.max}},
} as const satisfies {key: string; url: string; bytes: number; sha256: string; pieces: Readonly<Record<'End' | 'Mid' | 'MidPlain' | 'Trestle', MarketBridgePiece>>;
  deckY: number; railZ: number; railH: number; girderDepth: number; cableDrop: number; endTrestleX: number; stretch: {min: number; max: number}};
`;

const credSection = [CREDITS_BEGIN, '## The Survivor Market bridge kit', '',
  `A user-uploaded textured model of a rusty industrial walkway bridge (the user supplied and authorized it for the Survivor Market's crevice layout, with permission to cut its legs and adapt pieces; the upload file name mentions Meshy, but the generator, account, settings and licence are NOT verified and no clearance is implied). The game ships modular runtime derivatives cut from it (End / Mid / MidPlain / Trestle: exact plane clips, the middle cable swag remapped onto one bay, seam-preserving decimation) with the model's own PBR maps downsized and re-encoded (base colour 2048 px, metallic-roughness / normal 1024 px; its all-but-black emissive map dropped). Task ${TASK.id}. No generation. The original stays outside the repository.`, '',
  `- \`${url}\` — the Survivor Market's modular walkway-bridge kit (an abutment end, a tileable bay with and without its cable festoon, a leg frame); runtime derivative by \`${SELF}\` (provenance: \`${provRel}\`).`,
  CREDITS_END].join('\n');

const out = new Map([[url, glb], [provRel, provBytes]]);
if (DRY) {
  fs.mkdirSync(DRY, {recursive: true});
  for (const [rel, b] of out) fs.writeFileSync(path.join(DRY, path.basename(rel)), b);
  fs.writeFileSync(path.join(DRY, path.basename(REG)), registry);
  console.log(`dry run: ${out.size} files (${[...out.values()].reduce((t, b) => t + b.length, 0)} B) + registry preview written to ${DRY}`);
  process.exit(0);
}
const allowRaw = fs.readFileSync(ALLOW, 'utf8');
const allow = JSON.parse(allowRaw);
if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) fail('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
const credSrc = fs.readFileSync(CREDITS, 'utf8');
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const credRe = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
const after = CREDITS_AFTER.find(m => credSrc.includes(m));
const credOut = credRe.test(credSrc) ? credSrc.replace(credRe, credSection)
  : after ? credSrc.replace(after, `${after}\n\n${credSection}`)
    : `${credSrc.replace(/\n*$/, '')}\n\n${credSection}\n`;
out.set('assets/CREDITS.md', Buffer.from(credOut));
const othersBefore = JSON.stringify(allow.files.filter(f => !out.has(f.path)));
for (const [rel, b] of out) fs.writeFileSync(path.join(PUB, rel), b);
fs.writeFileSync(REG, registry);
allow.files = [...allow.files.filter(f => !out.has(f.path)), ...[...out].map(([p, b]) => ({path: p, bytes: b.length, sha256: sha(b)}))]
  .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
if (JSON.stringify(allow.files.filter(f => !out.has(f.path))) !== othersBefore) fail('another allowlist entry changed');
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log(`wrote ${out.size} public files (${[...out.values()].reduce((t, b) => t + b.length, 0)} B) + ${path.relative(root, REG)} + public-inputs.json (its own entries + CREDITS.md)`);
