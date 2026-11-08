// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the human body stage — a Meshy T2.5 A-pose base -> placed,
// skeleton-detected runtime mesh that KEEPS the Meshy model's own UVs and PBR maps (CLAUDE.md: a Meshy model keeps its maps; only
// re-encoded / resized here).
//
// Differences to the zombie body stage (zombie/lib/autorig.mjs bodyStage, unchanged and reused for the rest):
//  - no simplify / re-unwrap / re-bake: the runtime mesh IS the source's ~20 k-triangle smart-topology mesh (placed: scaled to the
//    body's height, feet midpoint at the origin, +Z facing), so the Meshy base colour, metal-rough AND normal maps stay valid;
//  - the skeleton is detected on a densified copy (zombie/lib/densify.mjs: same surface, edge splits) exactly as the T2.5 zombie
//    bodies are, because the slice landmarks need a dense vertex cloud;
//  - the welded mesh (position-welded UV seams) keeps the runtime mesh's TRIANGLE ORDER (masks / fit validation index both).
// Output shape = what zombie/lib/autorig.mjs bodySkin / spreadWeights / bodyProfile and zombie/lib/fit-pool.mjs expect.
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {loadSource} from '../../zombie/lib/source.mjs';
import {densify} from '../../zombie/lib/densify.mjs';
import {bounds, similarity, rotateNormals, weldByPosition, computeNormals} from '../../zombie/lib/mesh.mjs';
import {detectFacing, placement, slimSkeleton, validateSkeleton} from '../../zombie/lib/autorig.mjs';
import {detectSkeleton} from '../../zombie/lib/skeleton.mjs';

/** The source's normal map image (loadSource decodes base colour + metal-rough only). */
async function sourceImages(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const mat = doc.getRoot().listMaterials()[0];
  const img = t => (t ? {bytes: Buffer.from(t.getImage()), mime: t.getMimeType(), size: t.getSize()} : null);
  return {base: img(mat.getBaseColorTexture()), mr: img(mat.getMetallicRoughnessTexture()), normal: img(mat.getNormalTexture()), normalScale: mat.getNormalScale?.() ?? 1};
}

/**
 * Weld the runtime (UV-split) mesh by exact position. Returns weldId (split vertex -> welded vertex) and the triangle lists of both,
 * in ONE order (triangles degenerate after welding are dropped from both).
 */
function weldKeepingOrder(pos, idx, maxEdge = Infinity) {
  const remap = MeshoptSimplifier.generatePositionRemap(pos, 3);
  const n = pos.length / 3, id = new Int32Array(n).fill(-1);
  let c = 0;
  for (let i = 0; i < n; i++) if (remap[i] === i) id[i] = c++;
  const weldId = new Uint32Array(n);
  for (let i = 0; i < n; i++) weldId[i] = id[remap[i]];
  const W = new Float32Array(c * 3);
  for (let i = 0; i < n; i++) if (remap[i] === i) W.set(pos.subarray(i * 3, i * 3 + 3), id[i] * 3);
  const L = [], WI = [];
  let dropped = 0, long = 0;
  const len = (i, j) => Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 1] - pos[j * 3 + 1], pos[i * 3 + 2] - pos[j * 3 + 2]);
  for (let t = 0; t < idx.length; t += 3) {
    const a = weldId[idx[t]], b = weldId[idx[t + 1]], d = weldId[idx[t + 2]];
    if (a === b || b === d || a === d) { dropped++; continue; }
    if (Math.max(len(idx[t], idx[t + 1]), len(idx[t + 1], idx[t + 2]), len(idx[t + 2], idx[t])) > maxEdge) { long++; continue; }
    L.push(idx[t], idx[t + 1], idx[t + 2]); WI.push(a, b, d);
  }
  return {weldId, welded: {pos: W, idx: Uint32Array.from(WI)}, idx: Uint32Array.from(L), dropped, long};
}

/** Longest edge (m) a runtime body triangle may have (stray reconstruction slivers beyond it are dropped). */
const MAX_EDGE_M = 0.2;

/** Mean nose-tip -> head-pivot depth (m) of the four bases whose head joint the detector places cleanly (m1 m2 f2 m3: 0.092-0.119). */
const NOSE_TO_HEAD_PIVOT = 0.105;

/**
 * Documented per-body landmark fixes (humans.config.mjs `fix`), applied to the detected skeleton and logged in skel.log.humanFix:
 *  - headZ 'nose': hair hanging behind the neck (braids) widens every neck slice backwards, so the neck cluster centre (the
 *    detector's Neck / Head depth) lands ~13 cm behind the throat. Head z = the front-most midline head point (nose tip) minus
 *    NOSE_TO_HEAD_PIVOT; Neck z = Head z - 1 cm (the detector's own Neck / Head offset). Heights unchanged.
 *  - shoulder 'armpit': the acromion top-surface scan found no slope break (slim body: acromion at the neck, shoulder half-width
 *    0.05 H): the glenohumeral centre is put 1.4 cm lateral of the torso wall at the armpit (the other bases: +0.5..+1.2 cm), the
 *    acromion cut point 3 cm lateral of the wall (m1: +3.3 cm); heights / depth and the elbow / wrist joints unchanged.
 */
function applyFixes(skel, pos, fix = {}) {
  const log = [];
  const J = skel.joints;
  if (fix.headZ === 'nose') {
    let nose = -Infinity;
    for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i]) < 0.025 && Math.abs(pos[i + 1] - J.Head[1] - 0.02) < 0.02) nose = Math.max(nose, pos[i + 2]);
    const hz = nose - NOSE_TO_HEAD_PIVOT;
    log.push({fix: 'headZ', method: 'nose tip - ' + NOSE_TO_HEAD_PIVOT + ' m', noseZ: +nose.toFixed(4), before: {Neck: J.Neck[2], Head: J.Head[2]}, after: {Neck: +(hz - 0.01).toFixed(4), Head: +hz.toFixed(4)}});
    J.Neck = [J.Neck[0], J.Neck[1], hz - 0.01];
    J.Head = [J.Head[0], J.Head[1], hz];
    skel.ends.Head = [skel.ends.Head[0], skel.ends.Head[1], +hz.toFixed(4)];
  }
  if (fix.shoulder === 'armpit') {
    for (const [s, sg] of [['L', 1], ['R', -1]]) {
      const A = skel.cut[s].A, x = Math.abs(A[0]);
      const before = J[s + '_UpperArm'];
      J[s + '_UpperArm'] = [sg * (x + 0.014), before[1], before[2]];
      skel.cut[s] = {A, T: [sg * (x + 0.03), skel.cut[s].T[1], skel.cut[s].T[2]]};
      log.push({fix: 'shoulder', side: s, before: before.map(v => +v.toFixed(4)), after: J[s + '_UpperArm'].map(v => +v.toFixed(4)), armpitWallX: x});
    }
  }
  skel.log = {...skel.log, humanFix: log};
  return skel;
}

/**
 * Remove the triangles that BRIDGE the two legs below the crotch (zombie/lib/autorig.mjs trimArmTorsoBridges, for the legs): where
 * a reconstruction fused touching inner thighs / shins, a strip of triangles joins the left and right leg regions; any stride
 * stretches it into a sheet between the legs. Triangles holding a left-leg AND a right-leg vertex whose lowest vertex is more than
 * `below` under the crotch are dropped from both triangle lists (same order kept; the crotch seam itself stays).
 */
export function trimLegBridges(low, sw, skel, {below = 0.05} = {}) {
  const R = sw.region, W = low.welded, yMax = skel.crotchY - below;
  const keepW = [], keepL = [];
  let removed = 0;
  for (let t = 0; t < W.idx.length / 3; t++) {
    const v = [W.idx[t * 3], W.idx[t * 3 + 1], W.idx[t * 3 + 2]];
    const rs = v.map(i => R[i]);
    const y = Math.min(...v.map(i => W.pos[i * 3 + 1]));
    if (rs.includes(3) && rs.includes(4) && y < yMax) { removed++; continue; }
    keepW.push(...v); keepL.push(low.idx[t * 3], low.idx[t * 3 + 1], low.idx[t * 3 + 2]);
  }
  return {low: {...low, idx: Uint32Array.from(keepL), welded: {...W, idx: Uint32Array.from(keepW)}}, removed, method: `triangles joining the left and right leg regions lower than ${below} m under the crotch removed`};
}

/**
 * @param src humanSource() record
 * @param opts {heightM, densifyFrac, skeleton (detectSkeleton options), fix (applyFixes), textures: {baseColor, normal, metallicRoughness, jpegQuality, normalQuality}}
 * @returns {skel, issues, facing, placement, low, enc, stats, master}
 */
export async function humanBodyStage(src, {heightM, densifyFrac = 0.0045, skeleton = null, fix = null, textures}) {
  const master = await loadSource(src);
  const H0 = bounds(master.pos).max[1] - bounds(master.pos).min[1];
  // skeleton on the densified copy (the zombie T2.5 body route), placement from the source itself (same bounds)
  const dense = densify(master, H0 * densifyFrac);
  const fd = detectFacing(dense.pos);
  const pl = placement(master, heightM, fd.facing);
  const highW = weldByPosition(similarity(dense.pos, pl), rotateNormals(dense.nrm, pl.flipFacing), dense.idx);
  const skel = applyFixes(slimSkeleton(skeleton ? detectSkeleton(highW.pos, skeleton) : detectSkeleton(highW.pos)), highW.pos, fix ?? {});
  const issues = validateSkeleton(skel);
  // runtime mesh = the source mesh, placed
  const pos = similarity(master.pos, pl), nrm = rotateNormals(master.nrm, pl.flipFacing);
  // stray sliver triangles of the reconstruction (one m3 triangle joins an ankle to the head: a hair-thin line in the bind pose,
  // a sheet in any stride): no real surface triangle of a ~20 k-triangle body has an edge near MAX_EDGE_M
  const w = weldKeepingOrder(pos, master.idx, MAX_EDGE_M);
  const weldedNrm = computeNormals(w.welded.pos, w.welded.idx);
  const low = {pos, nrm, uv: master.uv, idx: w.idx, weldId: w.weldId, welded: {pos: w.welded.pos, idx: w.welded.idx, nrm: weldedNrm}};
  // Meshy maps: re-encoded (JPEG) / resized only
  const im = await sourceImages(src.file);
  const T = textures;
  const jpg = (img, size, q) => sharp(img.bytes).resize(size, size, {fit: 'fill'}).jpeg({quality: q, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const enc = {
    baseJpg: await sharp(im.base.bytes).resize(T.baseColor, T.baseColor, {fit: 'fill'}).jpeg({quality: T.jpegQuality, mozjpeg: true}).toBuffer(),
    mrJpg: im.mr ? await jpg(im.mr, T.metallicRoughness, T.jpegQuality) : null,
    normalJpg: im.normal ? await jpg(im.normal, T.normal, T.normalQuality) : null,
  };
  const {nativeBounds, ...plRest} = pl;
  return {skel, issues, facing: {...fd, used: fd.facing, forced: false}, placement: {...plRest, nativeBounds},
    low, enc,
    stats: {method: 'Meshy source mesh kept as the runtime mesh (no simplify / unwrap / bake); skeleton detected on a densified copy',
      densify: {...dense.stats, maxEdgeFractionOfHeight: densifyFrac}, sourceTriangles: master.idx.length / 3, sourceVertices: master.pos.length / 3,
      runtimeTriangles: w.idx.length / 3, droppedDegenerateTriangles: w.dropped, droppedSliverTriangles: {count: w.long, maxEdgeM: MAX_EDGE_M}, weldedVertices: w.welded.pos.length / 3,
      textures: {baseColor: [T.baseColor, enc.baseJpg.length], normal: enc.normalJpg && [T.normal, enc.normalJpg.length], metallicRoughness: enc.mrJpg && [T.metallicRoughness, enc.mrJpg.length],
        source: {baseColor: im.base?.size, normal: im.normal?.size, metallicRoughness: im.mr?.size, normalScale: im.normalScale}}},
    master: {id: master.id, file: src.file, sha256: master.sha256Verified, bytes: master.bytes, triangles: master.triangles, vertices: master.vertices, material: master.material}};
}
