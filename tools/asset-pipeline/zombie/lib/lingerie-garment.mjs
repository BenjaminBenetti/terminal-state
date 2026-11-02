// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): the accepted Meshy T2.5 lingerie sets as CLEAN garment sources.
// Read-only: the raw Meshy GLB (sha256-verified) and its PBR texture PNGs. Nothing is generated, painted or retextured here; the
// Meshy maps are kept (re-encoded / packed / resized only) and the geometry is the Meshy mesh (welded, split, simplified).
//  1. load: POSITION / NORMAL / TEXCOORD_0 / indices of the single primitive (Meshy's normalised frame: +Y up, front +Z, the set
//     spans y -0.475 .. 0.475);
//  2. clean: degenerate triangles dropped; welded connected components (UV seams joined by exact position) classified; floating
//     junk (tiny components far from every other one) and inner shells (a component lying entirely just inside another one) are
//     dropped and recorded (the six accepted sets have none of either: every small component is a strap slider, clip, ring, bow or
//     lacing piece touching the set);
//  3. split into the two wardrobe pieces: TOP (bra / bustier / bodysuit above the waist; slot upper) and BOTTOM (brief / thong,
//     garter belt, suspender straps, thigh rings; slot lower): per component by its centroid height, or per triangle for a
//     one-piece bodysuit (cut at the waist; the cut duplicates nothing and both halves keep the same vertices along it);
//  4. simplify each piece (meshoptimizer, UV-weighted quadric, attribute seams preserved) to the runtime budget;
//  5. textures: the Meshy base colour PNG -> 1024 JPEG; metallic + roughness PNGs packed into one glTF metallicRoughness map
//     (G roughness, B metallic) -> 256 JPEG. The Meshy normal map is not shipped (see build-lingerie.mjs: it did not earn its bytes).
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {MeshoptSimplifier} from 'meshoptimizer';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {TriGrid} from './penetration.mjs';

export const sha256File = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const r4 = v => +(+v).toFixed(4);

/** Raw Meshy garment: arrays of its single primitive + texture bytes. */
export async function loadRawGarment(file, sha256) {
  const got = sha256File(file);
  if (sha256 && got !== sha256) throw new Error(`raw garment ${file}: sha256 ${got} != pinned ${sha256}`);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const nodes = doc.getRoot().listNodes().filter(n => n.getMesh());
  if (nodes.length !== 1) throw new Error(`${file}: expected one mesh node, got ${nodes.length}`);
  const n = nodes[0];
  const t = n.getTranslation(), r = n.getRotation(), s = n.getScale();
  if (t.some(v => v) || r[0] || r[1] || r[2] || r[3] !== 1 || s.some(v => v !== 1)) throw new Error(`${file}: non-identity node transform`);
  const prims = n.getMesh().listPrimitives();
  if (prims.length !== 1) throw new Error(`${file}: expected one primitive`);
  const p = prims[0], mat = p.getMaterial();
  return {file, sha256: got, pos: Float32Array.from(p.getAttribute('POSITION').getArray()), nrm: Float32Array.from(p.getAttribute('NORMAL').getArray()),
    uv: Float32Array.from(p.getAttribute('TEXCOORD_0').getArray()), idx: Uint32Array.from(p.getIndices().getArray()),
    material: {alphaMode: mat.getAlphaMode(), doubleSided: mat.getDoubleSided(), baseColorFactor: mat.getBaseColorFactor(), metallicFactor: mat.getMetallicFactor(), roughnessFactor: mat.getRoughnessFactor()}};
}

/** Exact-position weld: rep[i] = first vertex with the same position (UV / normal seams joined). */
export function weld(pos) {
  const n = pos.length / 3, rep = new Uint32Array(n), seen = new Map();
  const u = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
  for (let i = 0; i < n; i++) {
    const k = u[i * 3] + ',' + u[i * 3 + 1] + ',' + u[i * 3 + 2];
    const r = seen.get(k);
    if (r === undefined) { seen.set(k, i); rep[i] = i; } else rep[i] = r;
  }
  return rep;
}

/** Connected components of the welded mesh, per triangle (label = component index, sorted by size desc). */
export function triangleComponents(idx, rep) {
  const n = rep.length, par = Int32Array.from({length: n}, (_, i) => i);
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(rep[idx[t]]), b = find(rep[idx[t + 1]]); if (a !== b) par[b] = a;
    const c = find(rep[idx[t + 2]]), a2 = find(a); if (a2 !== c) par[c] = a2;
  }
  const roots = new Map();
  const triRoot = new Int32Array(idx.length / 3);
  for (let t = 0; t < idx.length / 3; t++) { const r = find(rep[idx[t * 3]]); triRoot[t] = r; roots.set(r, (roots.get(r) ?? 0) + 1); }
  const order = [...roots.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([r]) => r);
  const lab = new Map(order.map((r, i) => [r, i]));
  return {label: Int32Array.from(triRoot, r => lab.get(r)), count: order.length};
}

function triArea(P, a, b, c) {
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  return 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
}

/**
 * Cleaning + piece split. cfg: {splitY (garment frame), splitBy: 'component' | 'triangle', junkMaxTris, junkGap, innerGap}
 * Returns {pieces: {top: Uint32Array idx, bottom: Uint32Array idx}, components: [...], dropped: {...}}.
 */
export function cleanAndSplit(raw, cfg) {
  const {pos: P, idx: I0} = raw;
  const keep = [];
  let degenerate = 0;
  for (let t = 0; t < I0.length; t += 3) { const a = I0[t], b = I0[t + 1], c = I0[t + 2]; if (a === b || b === c || a === c || triArea(P, a, b, c) < 1e-12) { degenerate++; continue; } keep.push(a, b, c); }
  const idx = Uint32Array.from(keep);
  const rep = weld(P);
  const {label, count} = triangleComponents(idx, rep);
  const comps = Array.from({length: count}, (_, k) => ({k, tris: 0, area: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], c: [0, 0, 0]}));
  for (let t = 0; t < idx.length / 3; t++) {
    const C = comps[label[t]], a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2], A = triArea(P, a, b, c);
    C.tris++; C.area += A;
    for (const v of [a, b, c]) for (let q = 0; q < 3; q++) { C.min[q] = Math.min(C.min[q], P[v * 3 + q]); C.max[q] = Math.max(C.max[q], P[v * 3 + q]); C.c[q] += A * P[v * 3 + q] / 3; }
  }
  for (const C of comps) C.c = C.c.map(v => v / C.area);
  // per-component triangle lists + grids for the junk / inner-shell tests
  const triOf = comps.map(() => []);
  for (let t = 0; t < idx.length / 3; t++) triOf[label[t]].push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  const others = k => { const o = []; for (let j = 0; j < count; j++) if (j !== k) o.push(...triOf[j]); return Uint32Array.from(o); };
  const dropped = [];
  for (const C of comps) {
    const own = triOf[C.k];
    const vs = [...new Set(own)];
    if (count === 1) { C.gap = 0; continue; }
    const g = new TriGrid(P, others(C.k), 0.02);
    // gap: closest distance from the component's vertices to any other component (min over its vertices)
    let gap = Infinity, near = 0, under = 0;
    const OI = g.idx, N = raw.nrm;
    for (const v of vs) {
      const h = g.closest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], 0.06); const d = h ? h.d : Infinity; gap = Math.min(gap, d);
      if (d >= cfg.innerGap) continue;
      near++;
      // which side of that layer: its interpolated (outward) normal at the closest point
      const a = OI[h.tri * 3], b = OI[h.tri * 3 + 1], c = OI[h.tri * 3 + 2], q = h.q;
      const n = [0, 1, 2].map(k => q[3] * N[a * 3 + k] + q[4] * N[b * 3 + k] + q[5] * N[c * 3 + k]);
      if ((P[v * 3] - q[0]) * n[0] + (P[v * 3 + 1] - q[1]) * n[1] + (P[v * 3 + 2] - q[2]) * n[2] < 0) under++;
    }
    C.gap = gap; C.nearFraction = near / vs.length; C.underFraction = under / vs.length;
    if (C.tris <= cfg.junkMaxTris && gap > cfg.junkGap) { C.drop = 'floating junk'; dropped.push({component: C.k, tris: C.tris, reason: `floating: ${C.tris} triangles, ${(gap * 1000).toFixed(1)} mm (garment frame) from every other component`}); }
    // inner shell: (almost) every vertex within innerGap of another component AND the component is a closed duplicate layer
    // (its bounding box inside the other's, area < that one's) -- recorded, never silently kept
    else if (C.nearFraction > 0.98 && C.underFraction > 0.9 && C.k > 0 && C.area < 0.9 * comps[0].area && C.tris > cfg.junkMaxTris * 4) { C.drop = 'inner shell'; dropped.push({component: C.k, tris: C.tris, reason: `inner shell: ${(C.nearFraction * 100).toFixed(1)}% of its vertices within ${cfg.innerGap} of another layer, ${(C.underFraction * 100).toFixed(1)}% on its inner side`}); }
  }
  const top = [], bottom = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const C = comps[label[t]]; if (C.drop) continue;
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const y = cfg.splitBy === 'triangle' && C.k === 0 ? (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3 : C.c[1];
    (y > cfg.splitY ? top : bottom).push(a, b, c);
  }
  return {pieces: {top: Uint32Array.from(top), bottom: Uint32Array.from(bottom)}, degenerate, rep,
    components: comps.map(C => ({k: C.k, tris: C.tris, piece: C.drop ? null : (cfg.splitBy === 'triangle' && C.k === 0 ? 'split' : C.c[1] > cfg.splitY ? 'top' : 'bottom'), y: [r4(C.min[1]), r4(C.max[1])], x: [r4(C.min[0]), r4(C.max[0])], z: [r4(C.min[2]), r4(C.max[2])], gapToOthers: Number.isFinite(C.gap) ? r4(C.gap) : null, under: C.underFraction != null ? r4(C.underFraction) : null, drop: C.drop ?? null})),
    dropped};
}

/**
 * Simplify one piece (indices into the raw vertex arrays) with UV attributes; seams are preserved by meshoptimizer (vertices with
 * the same position are classified as seam pairs). Returns compact arrays {pos, nrm, uv, idx, srcIndex} (srcIndex: raw vertex id).
 */
export async function simplifyPiece(raw, idx, {targetTris, uvWeight = 0.5, targetError = 0.02}) {
  await MeshoptSimplifier.ready;
  let out = idx;
  let error = 0;
  if (targetTris && idx.length / 3 > targetTris) {
    const attrs = new Float32Array(raw.uv);
    const r = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(idx), raw.pos, 3, attrs, 2, [uvWeight, uvWeight], null, targetTris * 3, targetError, []);
    out = r[0]; error = r[1];
  }
  // compact (first-use order: deterministic)
  const map = new Map(), src = [];
  const I = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i++) { const v = out[i]; let m = map.get(v); if (m === undefined) { m = src.length; map.set(v, m); src.push(v); } I[i] = m; }
  const n = src.length, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  src.forEach((v, i) => { pos.set(raw.pos.subarray(v * 3, v * 3 + 3), i * 3); nrm.set(raw.nrm.subarray(v * 3, v * 3 + 3), i * 3); uv.set(raw.uv.subarray(v * 2, v * 2 + 2), i * 2); });
  return {pos, nrm, uv, idx: I, srcIndex: Uint32Array.from(src), triangles: I.length / 3, vertices: n, sourceTriangles: idx.length / 3, error: r4(error)};
}

/** Meshy PBR maps -> runtime JPEGs (base colour 1024, packed metallicRoughness 256). Deterministic (sharp / mozjpeg). */
export async function encodeTextures(texDir, {baseSize = 1024, baseQuality = 84, mrSize = 256, mrQuality = 85} = {}) {
  const f = n => `${texDir}/${n}`;
  const files = ['base_color.png', 'metallic.png', 'roughness.png', 'normal.png'].map(n => ({name: n, sha256: sha256File(f(n)), bytes: fs.statSync(f(n)).size}));
  const baseJpg = await sharp(f('base_color.png')).removeAlpha().resize(baseSize, baseSize, {kernel: 'lanczos3'}).jpeg({quality: baseQuality, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const rough = await sharp(f('roughness.png')).extractChannel(0).resize(mrSize, mrSize, {kernel: 'lanczos3'}).raw().toBuffer();
  const metal = await sharp(f('metallic.png')).extractChannel(0).resize(mrSize, mrSize, {kernel: 'lanczos3'}).raw().toBuffer();
  const mr = Buffer.alloc(mrSize * mrSize * 3);
  for (let i = 0; i < mrSize * mrSize; i++) { mr[i * 3] = 255; mr[i * 3 + 1] = rough[i]; mr[i * 3 + 2] = metal[i]; }
  const mrJpg = await sharp(mr, {raw: {width: mrSize, height: mrSize, channels: 3}}).jpeg({quality: mrQuality, mozjpeg: true}).toBuffer();
  const stats = async b => (await sharp(b).stats()).channels.map(c => r4(c.mean / 255));
  return {baseJpg, mrJpg, sources: files, encoded: {baseColor: {size: baseSize, quality: baseQuality, bytes: baseJpg.length, sha256: crypto.createHash('sha256').update(baseJpg).digest('hex')},
    metallicRoughness: {size: mrSize, quality: mrQuality, bytes: mrJpg.length, sha256: crypto.createHash('sha256').update(mrJpg).digest('hex'), meanRGB: await stats(mrJpg), packing: 'R 1 (unused), G Meshy roughness, B Meshy metallic'}}};
}
