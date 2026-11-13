#!/usr/bin/env node
// Terminal State - BB enemy derivative builder (task studio-bb-models-20261112-234540-01). CPU only: no generation, inference,
// network or GPU. Single reproducible entry point (mirrors enemy/build-screacher.mjs):
//   flock /tmp/ll-heavy.lock node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-bb.mjs [--only binky[,teddy]] [--no-write] [--out-dir DIR]
//   QA sheets:  node tools/asset-pipeline/enemy/qa/bb-sheets.mjs   (renders the WRITTEN GLBs)
// The BB is ONE enemy family with FOUR bodies (lullaby, binky, teddy, changeling): toddler-sized baby-like creatures that share
// one AI (a fast floor / wall / ceiling skitter, a cackle and a close pounce). Reads the four READ-ONLY Meshy T2.5 image-to-3D
// masters (private raw store outside Git: BB_RAW_DIR or the task's private masters folder; each sha256 + byte count pinned
// below and re-verified after the build) and writes ONLY:
//   game/public/assets/models/enemy-bb-<v>.glb
//   game/public/assets/derivatives/enemy-bb-<v>.json     (hash-only public provenance: no private path, URL or prompt)
//   game/public/assets/CREDITS.md          the marked enemy-bb section only (rewritten in place)
//   tools/release/public-inputs.json       only this builder's output entries + CREDITS.md (whose bytes change)
// The asset contract is the implementation lead's (BB asset contract v1): a STANDING relaxed A-pose bind on the shared 18-joint
// skeleton with identity rest rotations, 0.85 m floor -> top of the head (headwear included), +Z facing, feet midpoint at the
// origin, NO baked clips (the game poses the bind into its crawl / wall / ceiling / pounce clips at runtime), scene extras
// `enemyBb`, the Meshy PBR maps kept.
//
// Pipeline (the humanoid libs in tools/asset-pipeline/zombie/lib are used unchanged):
//   1. placement: facing (autorig.detectFacing), uniform scale so floor -> top of the head is OPTIONS.heightM, feet midpoint at
//      the origin, +Z facing;
//   2. skeleton: lib/bb-skeleton.mjs on the welded mesh (per-body landmarks for what clothing hides + measured arms / legs; the
//      bind pose is the pose as generated: no re-posing);
//   3. mesh: the Meshy smart-topology mesh, its UVs and its 2K PBR maps are KEPT (no simplify / re-UV / re-bake / repaint);
//      textures re-encoded for size only (base colour 2048 JPEG, metallic-roughness + normal 1024 JPEG 4:4:4);
//   4. skin: lib/bb-skin.mjs (position chain weights, masked Laplacian smoothing, top 4, loose bits follow their surface);
//   5. audit: CPU-skinned triangle stretch over the contract's pose envelope (every range end) and its four key poses
//      (lib/bb-poses.mjs: CRAWL, WINDUP, POUNCE, TWITCH), the crawl pose's size;
//   6. GLB (gltf-transform; KHR_mesh_quantization normals) + scene extras `enemyBb` + sidecar provenance.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, KHRMeshQuantization} from '@gltf-transform/extensions';
import {MeshoptSimplifier} from 'meshoptimizer';
import {REPO, sha256File} from '../zombie/lib/master.mjs';
import {loadSource} from '../zombie/lib/source.mjs';
import {detectFacing, placement} from '../zombie/lib/autorig.mjs';
import {placeHigh} from '../zombie/lib/stage-mesh.mjs';
import {bounds, normalizeAll, components} from '../zombie/lib/mesh.mjs';
import {JOINTS} from '../zombie/lib/skeleton.mjs';
import {skinPositions} from '../zombie/lib/glb.mjs';
import {Rig, V} from '../zombie/lib/pose.mjs';
import {quantizeWeights, writeDoc, geometryHash} from '../zombie/lib/variant-glb.mjs';
import {triangleStretch, stretchStats} from '../zombie/lib/stretch.mjs';
import {detectBbSkeleton, BB_LANDMARKS, BB_SKELETON_OPTIONS} from './lib/bb-skeleton.mjs';
import {computeBbSkin, JOINT_NAMES} from './lib/bb-skin.mjs';
import {bbPose, KEY_POSES, ENVELOPE, envelopePoses} from './lib/bb-poses.mjs';

const ARGV = process.argv.slice(2);
const flag = n => ARGV.includes(n);
const opt = n => { const i = ARGV.indexOf(n); return i >= 0 ? ARGV[i + 1] : null; };
const TASK = 'studio-bb-models-20261112-234540-01';
const RAW_DIR = process.env.BB_RAW_DIR ? path.resolve(process.env.BB_RAW_DIR) : path.join(REPO, 'reference/tasks/bb-models-20261112-234540/gen/masters');
const INPUT_DIR = process.env.BB_INPUT_DIR ? path.resolve(process.env.BB_INPUT_DIR) : path.join(RAW_DIR, '..', 'meshy-inputs');
const GENERATOR = 'Terminal State BB enemy derivative builder (tools/asset-pipeline/enemy/build-bb.mjs)';
const CREDITS = path.join(REPO, 'game/public/assets/CREDITS.md');
const ALLOW = path.join(REPO, 'tools/release/public-inputs.json');
const CREDITS_BEGIN = '<!-- BEGIN enemy-bb-20261113 (build-bb.mjs) -->';
const CREDITS_END = '<!-- END enemy-bb-20261113 -->';
/** Dev only: write the GLB + sidecar into this folder instead of game/public (no CREDITS / allowlist update). */
const DEV_OUT = opt('--out-dir') ? path.resolve(opt('--out-dir')) : null;
const outGlb = v => DEV_OUT ? path.join(DEV_OUT, `enemy-bb-${v}.glb`) : path.join(REPO, `game/public/assets/models/enemy-bb-${v}.glb`);
const outJson = v => DEV_OUT ? path.join(DEV_OUT, `enemy-bb-${v}.json`) : path.join(REPO, `game/public/assets/derivatives/enemy-bb-${v}.json`);

/**
 * The four Meshy T2.5 image-to-3D bodies (one paid attempt each, all four accepted first try), pinned by hash. Public provenance
 * is HASH-ONLY: the raw GLBs, the provider's map files and the conditioning images live in a private raw store.
 */
const RECIPE = {tool: 'meshy_image_to_3d (Meshy MCP)', ai_model: 'meshy-t2.5', model_type: 'smart-topology', should_texture: true, texture_resolution: '2k', enable_pbr: true, target_polycount: 20000, target_formats: ['glb']};
export const VARIANTS = [
  {v: 'lullaby', id: 'A', name: 'Lullaby', look: 'a porcelain-doll-like toddler in a yellowed lace christening smock, puffed sleeves, ribboned bloomers, a frilled lace bonnet and grey knitted stockings',
    meshyTaskId: '01a1d238-d41c-7639-a90a-89eee05f533c', raw: {sha256: '2365e02689bca0781772e4ab6c8c50b2fd03c1908d3aec9524614272e0e29eed', bytes: 9458728},
    inputImage: {sha256: '9c0f695e480d75e9974f364f119c38e8ed638221225bc9dafbce250e95a165c1', bytes: 2163362, file: 'A-a3-9c0f695e480d.png'}, selectedConceptSha256: '72242713fa5329fd158f5c4ab25b36c222a2164d7e4ccce05cc12c4bdd0dc17f',
    providerMaps: {base_color: {bytes: 5694988, sha256: '598e63e7e6288632e9a32332e521bcc4aeeec8ccb8182b7cc432f1f7057a63e2'}, metallic: {bytes: 30838, sha256: '2cea038151c9ce20809efdf06c1c4f007691515b4f58164602629cec2647aef6'}, roughness: {bytes: 1517663, sha256: '1469c930486545e9085f9aa3804c528312e6438c1ed15846ffab85c4666b38f2'}, normal: {bytes: 5678888, sha256: '234de463d1a28a125261a516b36c6a184b17de2830d5b457c0b1d73571a9251b'}}},
  {v: 'binky', id: 'B', name: 'Binky', look: 'a skinny big-headed toddler in a torn oversized orange hi-vis vest worn as a smock, striped leggings and a pacifier on a cord',
    meshyTaskId: '01a1d238-dbe9-75fb-80a8-31186ca71e65', raw: {sha256: '55e79a322ecd9dbda8477c62d4492eadf283d945984ac6618747dcbf9e4014e0', bytes: 9400484},
    inputImage: {sha256: 'eff082742986dc2c2e0e568fbd51ce052ffe9ff6908ef1747c94ddf2332f8806', bytes: 1862491, file: 'B-a3-eff082742986.png'}, selectedConceptSha256: '697c27e592e436efe554b8144abd084d560e7e3336c5098a1af256480d44f395',
    providerMaps: {base_color: {bytes: 6008473, sha256: 'a9826470a74754b95182bacf30a1b00d0cfee86a54e5b5b0b4e4f34e701c77a1'}, metallic: {bytes: 73605, sha256: '9bfa5fdc57e9822da7cf3added1a1c3eeb70a95a2ef3c1dd6decb9d78f8bb532'}, roughness: {bytes: 1424532, sha256: '88292d594a8c08da06e46784b18163963bffecf8b044a789ab31af376d72fb13'}, normal: {bytes: 5585826, sha256: '3bfb4232e4425782c2f14a4d3fff38335d55a2afa4a557f61f2b7b23094ee489'}}},
  {v: 'teddy', id: 'C', name: 'Teddy', look: 'a top-heavy toddler in a fuzzy hand-knitted brown bear-suit romper with a deep eared hood and mismatched buttons',
    meshyTaskId: '01a1d238-e41c-7526-8481-9f7377b26d46', raw: {sha256: '172b9dbd15d4cb0c46659dba4888a7dcda428ce26bb7f7ac99d9e8a2eae4cb52', bytes: 9116644},
    inputImage: {sha256: '97fbdbadd93179d81c144631b9e3f1a59593403ac53ff1465c360137e2aa83bd', bytes: 2166636, file: 'C-a3-97fbdbadd931.png'}, selectedConceptSha256: 'f35c4a77406fb8d5fad7fbcd7a2fb0528456e858f74d6f8b202ff26686b04ce9',
    providerMaps: {base_color: {bytes: 6807497, sha256: '69c6536b802b0dc103bc39654b42df40b7df250b487f49faf9e2d0745d135624'}, metallic: {bytes: 53254, sha256: '4f8237c4241f93b03c52ca139e26667a304d801e4cd8eae31009e65c693add8a'}, roughness: {bytes: 1448356, sha256: '05ae1933581ffb70540993940fdab9e59f0b4b5a7367d6d5e60933cf47eb2bbc'}, normal: {bytes: 6224400, sha256: '63a6d5017f5830398c44bb5daff7db008d16029243a7e2d3fea930ef5cda0063'}}},
  {v: 'changeling', id: 'D', name: 'Changeling', look: 'a stocky wrinkled old-faced toddler in a quilted navy hooded snowsuit with patched knees, a striped undershirt, fingerless mittens and knitted booties',
    meshyTaskId: '01a1d238-ec04-76ee-a49d-62e84a27a0e0', raw: {sha256: 'c1f141338d4f87437cd9fe567660de3c8cfa28effb6d6f4ea69297f064cf5318', bytes: 8888248},
    inputImage: {sha256: 'd62a008250810bba8f928740b80925bb2a53615efc976879a4e9907d2ff92b2a', bytes: 1973377, file: 'D-a3-d62a00825081.png'}, selectedConceptSha256: 'fc61ab20af9ea43a9e07bb05e4cceb238d281d86d1130aae543747123a9f0e1c',
    providerMaps: {base_color: {bytes: 6757829, sha256: '19549e21d0106b90da56f951b42c4cd5636b908fac291b95fb274326f51fef25'}, metallic: {bytes: 84948, sha256: '76169a820d8f50b55a60090678fee3e26c09a8a6eaac8819d746cf7c23444b80'}, roughness: {bytes: 1339901, sha256: '99d81310a6e4bb3715c634cd85c086759234750d9d7871f50d58fa8f29b65e53'}, normal: {bytes: 6013541, sha256: 'eb74c9b8bcc3ee0a2465502657219841b79c698faf2722436afe10ddbd4036ac'}}},
];

export const OPTIONS = {
  heightM: 0.85, // contract: floor -> top of the head geometry, headwear included (a toddler-sized body at true scale)
  textures: {baseColor: 2048, metallicRoughness: 1024, normal: 1024, quality: {base: 86, mr: 88, normal: 92}},
  collider: {radius: 0.22}, // contract value (gameplay collider)
  maxBytes: 2_800_000,
};

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const r3 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(3)) : +(+v).toFixed(3);
const rel = f => path.relative(REPO, f);
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function guardOutput(file) {
  const abs = path.resolve(file), allowed = DEV_OUT ? VARIANTS.flatMap(x => [outGlb(x.v), outJson(x.v)]) : [...VARIANTS.flatMap(x => [outGlb(x.v), outJson(x.v)]), CREDITS, ALLOW];
  if (!allowed.includes(abs)) throw new Error('refusing to write outside the BB derivative outputs: ' + rel(abs));
  return abs;
}

/** Pin check: the raw GLB's sha256 / byte count (and, when the private provider maps / conditioning image are there, those too). */
function verifySource(X) {
  const file = path.join(RAW_DIR, `${X.id}-stand-g1.glb`);
  if (!fs.existsSync(file)) throw new Error(`${X.v}: raw master not found (private raw store; set BB_RAW_DIR)`);
  const size = fs.statSync(file).size, s = sha256File(file);
  if (s !== X.raw.sha256 || size !== X.raw.bytes) throw new Error(`${X.v}: raw master sha256 / bytes mismatch (refusing to build)`);
  const checks = {rawGlb: true, providerMaps: null, inputImage: null};
  const mapDir = path.join(RAW_DIR, `${X.id}-stand-g1_textures`);
  if (fs.existsSync(mapDir)) {
    for (const [k, e] of Object.entries(X.providerMaps)) { const f = path.join(mapDir, k + '.png'); if (!fs.existsSync(f) || fs.statSync(f).size !== e.bytes || sha256File(f) !== e.sha256) throw new Error(`${X.v}: provider map ${k} does not match its pinned sha256`); }
    checks.providerMaps = true;
  }
  const img = path.join(INPUT_DIR, X.inputImage.file);
  if (fs.existsSync(img)) {
    if (fs.statSync(img).size !== X.inputImage.bytes || sha256File(img) !== X.inputImage.sha256) throw new Error(`${X.v}: conditioning image does not match its pinned sha256`);
    checks.inputImage = true;
  }
  return {file, checks};
}

/** Raw embedded images of the source material. */
async function sourceImages(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
  const root = doc.getRoot(), mats = root.listMaterials();
  if (mats.length !== 1 || root.listSkins().length || root.listAnimations().length) throw new Error('unexpected source structure (expected one material, no skin, no animation)');
  const mat = mats[0];
  const img = t => t && {bytes: Buffer.from(t.getImage()), mime: t.getMimeType(), size: t.getSize(), sha256: sha(Buffer.from(t.getImage()))};
  return {base: img(mat.getBaseColorTexture()), mr: img(mat.getMetallicRoughnessTexture()), normal: img(mat.getNormalTexture()), doubleSided: mat.getDoubleSided(), alphaMode: mat.getAlphaMode(),
    meshes: root.listMeshes().length, primitives: root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0)};
}

/** Weld by exact position, keeping the UV-split -> welded vertex map (weldByPosition semantics). */
function weldLow(pos, nrm, idx) {
  const remap = MeshoptSimplifier.generatePositionRemap(pos, 3);
  const n = pos.length / 3, newId = new Int32Array(n).fill(-1);
  let count = 0;
  for (let i = 0; i < n; i++) if (remap[i] === i) newId[i] = count++;
  const P = new Float32Array(count * 3), N = new Float32Array(count * 3), weldId = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const r = newId[remap[i]]; weldId[i] = r;
    if (remap[i] === i) for (let k = 0; k < 3; k++) P[r * 3 + k] = pos[i * 3 + k];
    for (let k = 0; k < 3; k++) N[r * 3 + k] += nrm[i * 3 + k];
  }
  normalizeAll(N);
  const I = [];
  for (let t = 0; t < idx.length; t += 3) { const a = weldId[idx[t]], b = weldId[idx[t + 1]], c = weldId[idx[t + 2]]; if (a !== b && b !== c && a !== c) I.push(a, b, c); }
  return {pos: P, nrm: N, idx: Uint32Array.from(I), weldId};
}
function spread(weldId, sw) {
  const n = weldId.length, joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = weldId[i]; for (let k = 0; k < 4; k++) { joints[i * 4 + k] = sw.joints[s * 4 + k]; weights[i * 4 + k] = sw.weights[s * 4 + k]; } }
  return {joints, weights};
}

// ------------------------------------------------------------------------------------------------ measurements
const onPolyline = (p, pts) => {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], ab = V.sub(pts[i + 1], a), L2 = V.dot(ab, ab);
    const t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / L2));
    best = Math.min(best, V.len(V.sub(p, V.add(a, V.mul(ab, t)))));
  }
  return best;
};
const LIMBS = [['L_UpperArm', 'L_Forearm'], ['L_Forearm', 'L_Hand'], ['R_UpperArm', 'R_Forearm'], ['R_Forearm', 'R_Hand'], ['L_Thigh', 'L_Shin'], ['L_Shin', 'L_Foot'], ['R_Thigh', 'R_Shin'], ['R_Shin', 'R_Foot']];
/** Per limb bone: median distance of its dominant-weight vertices (middle half of the bone) to the bone axis (autorig.bodyProfile rule). */
function limbRadii(weld, sw, skel) {
  const J = skel.joints, P = weld.pos, n = P.length / 3, limb = {};
  for (const [a, b] of LIMBS) {
    const ja = JOINT_NAMES.indexOf(a), A = J[a], d = V.sub(J[b], A), L = V.len(d), u = V.mul(d, 1 / L), rs = [];
    for (let i = 0; i < n; i++) {
      if (sw.joints[i * 4] !== ja || sw.weights[i * 4] < 0.6) continue;
      const q = V.sub([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], A), t = V.dot(q, u) / L;
      if (t < 0.25 || t > 0.75) continue;
      rs.push(V.len(V.sub(q, V.mul(u, t * L))));
    }
    rs.sort((x, y) => x - y);
    limb[a] = {length: r4(L), radius: rs.length ? r4(rs[rs.length >> 1]) : null, radiusP90: rs.length ? r4(pct(rs, 0.9)) : null, samples: rs.length};
  }
  return limb;
}
/** Gameplay capsule radii (model metres, actor scale 1): the contract's measures (trunk half-depth, upper-arm / thigh mean radius). */
function measureHit(weld, sw, skel, limb) {
  const J = skel.joints, P = weld.pos, n = P.length / 3, spine = [J.Hips, J.Spine, J.Chest, J.Neck], torso = [];
  for (let i = 0; i < n; i++) {
    if (sw.region[i] !== 0) continue;
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    if (p[1] < skel.crotchY || p[1] > J.Neck[1]) continue;
    torso.push(onPolyline(p, spine));
  }
  const mean = (...ks) => ks.reduce((a, k) => a + (limb[k].radius ?? 0), 0) / ks.length;
  return {
    radii: {torso: r4(pct(torso, 0.75)), arm: r4(mean('L_UpperArm', 'R_UpperArm', 'L_Forearm', 'R_Forearm')), leg: r4(mean('L_Thigh', 'R_Thigh', 'L_Shin', 'R_Shin'))},
    torsoP90: r4(pct(torso, 0.9)), torsoVertices: torso.length,
    method: 'torso: 75th pct distance of the torso-region vertices (crotch .. neck base: clothing included) to the Hips-Spine-Chest-Neck chain (the capsule Hips -> Neck); arm / leg: mean over both sides and both bones of the median distance of each limb bone\'s dominant-weight vertices (middle half of the bone) to its axis',
  };
}

/** CPU-skinned stretch audit over the contract's envelope ends and key poses (lib/bb-poses.mjs). */
function skinAudit(rig, skel, weld, sw) {
  const mesh = {pos: weld.pos, idx: weld.idx, joints: sw.joints, weights: sw.weights};
  const all = [...Object.entries(KEY_POSES).map(([name, spec]) => ({name, spec, key: true})), ...envelopePoses()];
  const poses = all.map(p => ({clip: p.name, pose: bbPose(rig, skel, p.spec)}));
  const per = poses.map(p => { const st = triangleStretch(mesh, skel, rig, [p]); const s = stretchStats(st.worst, null, null, {ratio: 3}); return {pose: p.clip, p99: s.p99, max: s.max, over2x: s.over2x, over3x: s.over3x}; });
  const st = triangleStretch(mesh, skel, rig, poses);
  const overall = stretchStats(st.worst, poses, st.at, {ratio: 3});
  // the CRAWL pose's size (lowest point on the floor; the contract's expected runtime crawl envelope is ~0.60-0.70 long,
  // 0.30-0.36 wide, 0.42-0.50 to the top of the head)
  const crawl = poses[0], P = skinPositions(mesh, skel, rig.fk(crawl.pose)), b = bounds(P);
  const w = rig.fk(crawl.pose), headTop = V.add(w.Head.pos, qRotLocal(w.Head.rot, skel.endsRel.Head));
  return {
    maxStretch: overall.max, p99: overall.p99, over3x: overall.over3x, triangles: overall.triangles,
    poses: per,
    crawlPose: {lengthM: r3(b.max[2] - b.min[2]), widthM: r3(b.max[0] - b.min[0]), heightM: r3(b.max[1] - b.min[1]), crownAboveFloorM: r3(headTop[1] - b.min[1])},
    method: 'CPU linear-blend skinning of the welded body; per triangle the worst edge length ratio posed / bind (edges clamped to >= 2 mm), per pose and over all poses: the four key poses of the contract (CRAWL, WINDUP, POUNCE, TWITCH) and every range end of its pose envelope one degree of freedom at a time from the bind (arm angles measured from hanging), lib/bb-poses.mjs',
  };
}
function qRotLocal(q, v) { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; }

function buildDocument({X, skel, body, extras, tex}) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  const buf = doc.createBuffer('main');
  const scene = doc.createScene('BB-' + X.v).setExtras({enemyBb: extras});
  const nodes = {};
  for (const [name, parent] of JOINTS) {
    const t = parent ? V.sub(skel.joints[name], skel.joints[parent]) : skel.joints[name];
    const node = doc.createNode(name).setTranslation(t.map(v => +v.toFixed(6)));
    nodes[name] = node;
    if (parent) nodes[parent].addChild(node); else scene.addChild(node);
  }
  const ibm = new Float32Array(JOINTS.length * 16);
  JOINTS.forEach(([name], i) => { const p = skel.joints[name]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skin = doc.createSkin('BBSkin').setSkeleton(nodes.Root).setInverseBindMatrices(doc.createAccessor('BBSkin_ibm').setType('MAT4').setArray(ibm).setBuffer(buf));
  for (const [name] of JOINTS) skin.addJoint(nodes[name]);
  const acc = (type, arr, normalized) => { const a = doc.createAccessor().setType(type).setArray(arr).setBuffer(buf); if (normalized) a.setNormalized(true); return a; };
  const qn = nrm => { const q = new Int8Array(nrm.length); for (let i = 0; i < nrm.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nrm[i] * 127))); return q; };
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const texture = (name, img) => doc.createTexture(name).setImage(img).setMimeType('image/jpeg');
  const bodyMat = doc.createMaterial('BBBodyMaterial').setBaseColorTexture(texture('BB_baseColor', tex.base))
    .setMetallicRoughnessTexture(texture('BB_metallicRoughness', tex.mr)).setNormalTexture(texture('BB_normal', tex.normal))
    .setMetallicFactor(1).setRoughnessFactor(1).setDoubleSided(tex.doubleSided).setAlphaMode('OPAQUE');
  const q = quantizeWeights(body.joints, body.weights);
  const prim = doc.createPrimitive().setMaterial(bodyMat).setAttribute('POSITION', acc('VEC3', body.pos)).setAttribute('NORMAL', acc('VEC3', qn(body.nrm), true))
    .setAttribute('TEXCOORD_0', acc('VEC2', body.uv)).setAttribute('JOINTS_0', acc('VEC4', q.joints)).setAttribute('WEIGHTS_0', acc('VEC4', q.weights, true))
    .setIndices(acc('SCALAR', body.pos.length / 3 < 65536 ? Uint16Array.from(body.idx) : Uint32Array.from(body.idx)));
  scene.addChild(doc.createNode('BBBody').setMesh(doc.createMesh('BBBody').addPrimitive(prim).setExtras({slot: 'body'})).setSkin(skin).setExtras({slot: 'body'}));
  return doc;
}

// ------------------------------------------------------------------------------------------------ CREDITS + allowlist
/** The marked CREDITS.md section (every GLB that exists), then this builder's allowlist entries. */
function writeCreditsAndAllowlist() {
  const pub = p => path.relative(path.join(REPO, 'game/public'), p).split(path.sep).join('/');
  const have = VARIANTS.filter(X => fs.existsSync(outGlb(X.v)) && fs.existsSync(outJson(X.v)));
  const credSrc = fs.readFileSync(CREDITS, 'utf8');
  const section = [CREDITS_BEGIN, '## The BB (enemy, four bodies)', '',
    'One enemy family with four bodies. Each was generated for this project with Meshy T2.5 image-to-3D (smart topology, 2K PBR; 1 attempt and 15 credits each) through the Meshy MCP under the user\'s task authorization, conditioned on a standing reference image of the user-selected concept look (a Codex native image generation). Rigged and skinned locally on CPU by `tools/asset-pipeline/enemy/build-bb.mjs`: the shared 18-joint skeleton (joints measured on each body) and automatic skin weights; no animation clips are baked (the game poses the body at runtime); the provider\'s texture maps are resized / re-encoded only (hash-only provenance: `assets/derivatives/enemy-bb-<variant>.json`). AI-generated assets: provider terms apply; unapproved prototype, no licence or commercial clearance implied. Raw masters, provider maps and the input images are kept outside Git.', '',
    ...have.map(X => `- \`${pub(outGlb(X.v))}\` — BB "${X.name}": ${X.look} (Meshy task ${X.meshyTaskId})`), CREDITS_END].join('\n');
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(CREDITS_BEGIN)}[\\s\\S]*?${esc(CREDITS_END)}`);
  const next = re.test(credSrc) ? credSrc.replace(re, () => section) : credSrc.replace(/\n*$/, '\n\n') + section + '\n';
  if (next !== credSrc) fs.writeFileSync(guardOutput(CREDITS), next);
  const allowRaw = fs.readFileSync(ALLOW, 'utf8'), allow = JSON.parse(allowRaw);
  if (allow.schema !== 'terminal-state-public-inputs-v1' || !Array.isArray(allow.files)) throw new Error('unknown public-input policy schema');
  if (JSON.stringify(allow, null, 2) + '\n' !== allowRaw) throw new Error('public-inputs.json formatting differs from JSON.stringify(_, null, 2); refusing to rewrite');
  const mineAll = [...VARIANTS.flatMap(X => [outGlb(X.v), outJson(X.v)]), CREDITS].map(pub);
  const files = [...have.flatMap(X => [outGlb(X.v), outJson(X.v)]), CREDITS];
  const add = files.map(f => ({path: pub(f), bytes: fs.statSync(f).size, sha256: sha256File(f)}));
  allow.files = [...allow.files.filter(f => !mineAll.includes(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const out = JSON.stringify(allow, null, 2) + '\n';
  if (out !== allowRaw) fs.writeFileSync(guardOutput(ALLOW), out);
  console.log('  CREDITS section + allowlist:', add.map(a => `${a.path} ${a.bytes}`).join(', '));
}

// ------------------------------------------------------------------------------------------------ one variant
async function buildVariant(X) {
  const t0 = Date.now(), log = (...a) => console.log(`[${X.v}]`, ...a);
  for (const f of [outGlb(X.v), outJson(X.v)]) guardOutput(f);
  const src = verifySource(X);
  log('1/6 load + place', JSON.stringify(src.checks));
  const m = await loadSource({id: X.v, file: src.file, sha256: X.raw.sha256});
  const imgs = await sourceImages(src.file);
  if (imgs.meshes !== 1 || imgs.primitives !== 1) throw new Error('expected one mesh / one primitive');
  const fd = detectFacing(m.pos);
  if (fd.facing !== 1) throw new Error('unexpected facing: the masters face +Z');
  const pl = placement(m, OPTIONS.heightM, fd.facing);
  const low = placeHigh(m, pl);
  const {nativeBounds, ...plRest} = pl;
  log('  facing', fd.facing, 'scale', pl.scale.toFixed(4), 'tris', m.triangles, 'verts', m.vertices, 'textures', JSON.stringify([imgs.base.size, imgs.base.mime, imgs.mr.size, imgs.mr.mime, imgs.normal.size, imgs.normal.mime]), 'alpha', imgs.alphaMode);

  log('2/6 skeleton');
  const weld = weldLow(low.pos, low.nrm, m.idx);
  const comp = components(weld.pos.length / 3, weld.idx);
  const skel = detectBbSkeleton(weld, BB_LANDMARKS[X.v]);
  log('  joints', JSON.stringify(skel.joints));
  log('  head', JSON.stringify(skel.head), 'contact', JSON.stringify(skel.contact));

  log('3/6 skin');
  const sw = computeBbSkin(weld, skel);
  const bodyW = spread(weld.weldId, sw);
  const limb = limbRadii(weld, sw, skel);
  const hit = measureHit(weld, sw, skel, limb);
  const used = new Set(); for (let i = 0; i < sw.joints.length; i++) if (sw.weights[i] > 0.05) used.add(JOINT_NAMES[sw.joints[i]]);
  log('  regions', JSON.stringify(sw.stats.regionVertexCounts), 'bits', JSON.stringify(sw.stats.looseBits), 'joints unused', JSON.stringify(JOINT_NAMES.filter(j => !used.has(j))));
  log('  hit', JSON.stringify(hit.radii));
  const bodyMesh = {name: 'BBBody', pos: low.pos, nrm: low.nrm, uv: m.uv, idx: m.idx, ...bodyW};

  log('4/6 skin audit');
  const rig = new Rig(skel);
  const audit = skinAudit(rig, skel, weld, sw);
  log('  stretch', JSON.stringify({max: audit.maxStretch, p99: audit.p99, over3x: audit.over3x}), 'crawl', JSON.stringify(audit.crawlPose));
  for (const p of audit.poses) log('   ', p.pose.padEnd(34), JSON.stringify({p99: p.p99, max: p.max, over2x: p.over2x, over3x: p.over3x}));
  if (flag('--no-write')) { log(`dev run: nothing written (${((Date.now() - t0) / 1000).toFixed(1)} s)`); return null; }

  log('5/6 textures');
  const T = OPTIONS.textures;
  const base = await sharp(imgs.base.bytes).resize(T.baseColor, T.baseColor, {kernel: 'lanczos3'}).jpeg({quality: T.quality.base, mozjpeg: true, chromaSubsampling: '4:2:0'}).toBuffer();
  const mr = await sharp(imgs.mr.bytes).resize(T.metallicRoughness, T.metallicRoughness, {kernel: 'lanczos3'}).jpeg({quality: T.quality.mr, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const normal = await sharp(imgs.normal.bytes).resize(T.normal, T.normal, {kernel: 'lanczos3'}).jpeg({quality: T.quality.normal, mozjpeg: true, chromaSubsampling: '4:4:4'}).toBuffer();
  const mrStats = (await sharp(imgs.mr.bytes).stats()).channels.map(c => ({min: c.min, max: c.max, mean: +c.mean.toFixed(1)}));
  log('  bytes base', base.length, 'mr', mr.length, 'normal', normal.length);

  log('6/6 GLB + sidecar');
  const bb = bounds(low.pos);
  const ends = {Head: skel.endsRel.Head, L_Hand: skel.endsRel.L_Hand, R_Hand: skel.endsRel.R_Hand};
  // GLB scene extras: the implementation lead's asset contract (every field it lists) + a few self-describing facts
  const extras = {
    variant: X.v, name: X.name, bindPose: 'stand', heightM: r4(skel.H),
    head: {centre: skel.head.centre, radius: skel.head.radius},
    hitRadii: hit.radii,
    contact: skel.contact,
    ends,
    radius: OPTIONS.collider.radius,
    skinAudit: {maxStretch: audit.maxStretch, p99: audit.p99, over3x: audit.over3x, poses: audit.poses, crawlPose: audit.crawlPose},
    version: 1, archetype: 'bb', task: TASK, joints: JOINT_NAMES, bodyMesh: 'BBBody', sourceSha256: X.raw.sha256, meshyTaskId: X.meshyTaskId,
    boundsM: {min: r3(bb.min), max: r3(bb.max)},
  };
  const doc = buildDocument({X, skel, body: bodyMesh, extras, tex: {base, mr, normal, doubleSided: imgs.doubleSided}});
  fs.mkdirSync(path.dirname(outGlb(X.v)), {recursive: true});
  await writeDoc(doc, guardOutput(outGlb(X.v)));
  const outBytes = fs.statSync(outGlb(X.v)).size, outSha = sha256File(outGlb(X.v));
  if (sha256File(src.file) !== X.raw.sha256) throw new Error('SOURCE CHANGED during the build');
  if (outBytes > OPTIONS.maxBytes) throw new Error(`${X.v}: GLB ${outBytes} bytes exceeds the ${OPTIONS.maxBytes} contract maximum`);
  const J = skel.joints;
  const boneLengthsM = Object.fromEntries(JOINTS.filter(([, p]) => p).map(([n, p]) => [n, r4(V.len(V.sub(J[n], J[p])))]));
  const compSizes = [...comp.sizes.values()].sort((a, b) => b - a);
  const manifest = {
    schema: 'the-last-line/derivative-manifest@1', asset: `enemy-bb-${X.v}`, title: `BB "${X.name}" (${X.look}) - rigged runtime derivative of the Meshy T2.5 model (prototype)`,
    task: TASK, date: '2026-11-13', generatedBy: 'tools/asset-pipeline/enemy/build-bb.mjs',
    family: {archetype: 'bb', variant: X.v, look: X.id, name: X.name, variants: VARIANTS.map(e => e.v), note: 'one enemy family with four visual bodies: the same AI, stats and runtime-built clips (the game poses each body\'s own bind joints); each variant has its own mesh, skeleton fit and skin'},
    status: {approved: false, gameReady: false, stage: 'generated by Meshy (image-to-3D of a standing reference of the user-selected concept look); rig and skin weights are local and automatic; not approved in game by a human yet', licenseClearance: 'none - a derivative of an AI generation (Meshy, conditioned on a Codex-generated image); access to it grants no licence, commercial or production clearance'},
    honesty: {sourceHadSkeleton: false, rig: 'NEW derivative skeleton (shared 18-joint naming / hierarchy of the zombie wardrobe; joints measured on this body, with per-body landmarks for what clothing hides) and automatic skin weights created by this CPU pipeline', animation: 'none baked: the game builds its clips at runtime from the bind joints', textures: 'the provider\'s own generated maps, resized / re-encoded only (no painting, no reprojection, no new artwork)', mesh: 'the mesh as generated (uniform scale + translation only): no decimation, no re-pose, no added geometry', generation: 'no AI generation, inference, model download or network service was used by this builder; the Meshy model was generated earlier by this task under its credit grant'},
    provenance: 'generated (Meshy T2.5 image-to-3D, smart topology, 2K PBR, from a standing reference image of the user-selected concept look, itself a Codex native image generation conditioned on the selected concept) + local derivative work; public provenance is hash-only',
    source: {sha256Verified: X.raw.sha256, bytes: X.raw.bytes, readOnly: true, pinChecks: src.checks, rawKeptOutsideGit: 'the raw GLB, the provider map files and the conditioning image are kept in a private raw-asset store outside Git (not modified, not shipped); only their hashes are public',
      triangles: m.triangles, vertices: m.vertices, primitives: imgs.primitives, material: m.material, doubleSided: imgs.doubleSided, alphaMode: imgs.alphaMode,
      embeddedTextures: {baseColor: {size: imgs.base.size, mime: imgs.base.mime, bytes: imgs.base.bytes.length, sha256: imgs.base.sha256}, metallicRoughness: {size: imgs.mr.size, mime: imgs.mr.mime, bytes: imgs.mr.bytes.length, sha256: imgs.mr.sha256}, normal: {size: imgs.normal.size, mime: imgs.normal.mime, bytes: imgs.normal.bytes.length, sha256: imgs.normal.sha256}}, metallicRoughnessChannelStats: mrStats,
      meshy: {provider: 'Meshy image-to-3D', taskId: X.meshyTaskId, tool: RECIPE.tool, aiModel: RECIPE.ai_model, smartTopology: true, attempts: 1, credits: 15, accepted: true,
        settings: {ai_model: RECIPE.ai_model, model_type: RECIPE.model_type, pose_mode: null, should_texture: RECIPE.should_texture, texture_resolution: RECIPE.texture_resolution, enable_pbr: RECIPE.enable_pbr, target_polycount: RECIPE.target_polycount, target_formats: RECIPE.target_formats},
        inputImage: {sha256: X.inputImage.sha256, bytes: X.inputImage.bytes, what: 'a standing front-orthographic reference image of the user-selected concept look (the project\'s own Codex native image generation, conditioned on the selected concept sheet)'},
        selectedConcept: {sha256: X.selectedConceptSha256, what: 'the user-selected concept sheet of this look (input of the task)'},
        raw: {glb: {sha256: X.raw.sha256, bytes: X.raw.bytes}, providerMaps: X.providerMaps}}},
    outputs: {glb: {path: DEV_OUT ? path.basename(outGlb(X.v)) : rel(outGlb(X.v)), bytes: outBytes, sha256: outSha, format: 'glTF 2.0 binary; KHR_mesh_quantization (NORMAL int8 normalized; required); JPEG textures; JOINTS_0 u8 / WEIGHTS_0 normalized u8; one SkinnedMesh node; no animations'},
      textures: {baseColor: {size: T.baseColor, format: 'JPEG 4:2:0', quality: T.quality.base, bytes: base.length, sha256: sha(base), edits: 'none (re-encode only)'}, metallicRoughness: {size: T.metallicRoughness, format: 'JPEG 4:4:4 (source packed map: G roughness, B metallic; resized)', quality: T.quality.mr, bytes: mr.length, sha256: sha(mr), edits: 'none (resize + re-encode only)'}, normal: {size: T.normal, format: 'JPEG 4:4:4 tangent-space (source map resized; glTF convention, no tangents: three.js derivative tangents)', quality: T.quality.normal, bytes: normal.length, sha256: sha(normal), edits: 'none (resize + re-encode only)'}}},
    conventions: {units: 'metres', up: '+Y', facing: '+Z', floor: 'y = 0', origin: 'midpoint between the feet', handedness: 'L_ = character left = +X', heightM: r4(skel.H), heightIs: 'floor -> top of the head geometry (headwear included)', bindPose: 'the standing relaxed A-pose as generated: no re-posing', bindRotations: 'identity (bone frames aligned with model space)'},
    placement: {...plRest, nativeBounds: {min: r4(nativeBounds.min), max: r4(nativeBounds.max)}, boundsM: extras.boundsM, sizeM: r3([bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]])}, facing: fd,
    skeleton: {jointCount: JOINTS.length, joints: JOINTS.map(([n, p]) => ({name: n, parent: p, bindWorldPosition: r4(J[n])})), ends, boneLengthsM, head: skel.head, crownY: skel.crownY, options: BB_SKELETON_OPTIONS, estimation: skel.log},
    skinning: sw.stats,
    mesh: {node: 'BBBody', vertices: low.pos.length / 3, triangles: m.idx.length / 3, weldedVertices: weld.pos.length / 3, connectedComponents: compSizes.length, largestComponentsWeldedVertices: compSizes.slice(0, 8), geometryHash: geometryHash(low.pos, m.idx), jointsUsed: JOINT_NAMES.filter(j => used.has(j)), jointsUnused: JOINT_NAMES.filter(j => !used.has(j)),
      note: 'the Meshy smart-topology mesh and UVs unchanged (placed: uniform scale + translation); no simplification / re-UV / re-bake; the part-separated shells (clothing, limbs, shoes) keep their own vertices and get position-based weights'},
    profile: {heightM: r4(skel.H), landmarks: {ankle: r4(J.L_Foot[1]), knee: r4(J.L_Shin[1]), crotch: r4(skel.crotchY), hip: r4(skel.hipY), spine: r4(J.Spine[1]), chest: r4(J.Chest[1]), shoulder: r4(J.L_UpperArm[1]), neckBase: r4(J.Neck[1]), headJoint: r4(J.Head[1]), crown: r4(skel.crownY)}, limb},
    verification: {skinAudit: {...audit, envelope: ENVELOPE}},
    hit: {radii: hit.radii, torsoP90: hit.torsoP90, method: hit.method, head: skel.head, radius: OPTIONS.collider.radius,
      notes: ['head = the skull sphere in MODEL space (bind); the runtime rides it on the Head joint with this offset', 'all values in model metres at actor root scale 1 (multiply by the runtime scale)']},
    runtime: {modelKey: `enemy_bb_${X.v}`, url: `assets/models/enemy-bb-${X.v}.glb`, extras: 'gltf.scene.userData.enemyBb', meshes: {body: 'BBBody'}, bones: 'the same 18 names as the zombie bodies (Root, Hips, Spine, Chest, Neck, Head, L_/R_ UpperArm, Forearm, Hand, Thigh, Shin, Foot)'},
    limitations: [
      'Automatic approximate skin weights on a low-poly (20-21 k triangle) source: LBS volume loss at shoulders / elbows / knees / hips in strong poses (the crawl and the pounce are far from the standing bind); no finger or toe bones.',
      'Clothing (smocks, vests, hoods, bonnet frills, bloomers) is skinned shells without cloth simulation: loose garment parts follow the nearest body region; a hem over the thighs shears between the hips and the thighs when the legs fold.',
      'Joints that clothing hides (shoulders, crotch, neck, head pivot) are per-body landmarks measured on gridded renders of the placed mesh, not anatomy.',
      'Hidden-side geometry and texture of the source are AI-generated (Meshy).',
      'Unapproved prototype: appearance, anatomy, deformation, performance and licensing not certified; gameReady false.',
    ],
    rebuild: 'node --max-old-space-size=3500 tools/asset-pipeline/enemy/build-bb.mjs [--only <variant>] (needs the private raw masters: BB_RAW_DIR); QA sheets: node tools/asset-pipeline/enemy/qa/bb-sheets.mjs',
  };
  const text = JSON.stringify(manifest, null, 1) + '\n';
  if (/reference\/|\/workspaces?\/|\/home\/|\/tmp\/|https?:\/\//.test(text)) throw new Error('sidecar would carry a private / absolute path or a URL');
  fs.mkdirSync(path.dirname(outJson(X.v)), {recursive: true});
  fs.writeFileSync(guardOutput(outJson(X.v)), text);
  log(`done: ${DEV_OUT ? outGlb(X.v) : rel(outGlb(X.v))} ${outBytes} bytes sha256 ${outSha} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return {v: X.v, bytes: outBytes, sha256: outSha};
}

async function main() {
  await MeshoptSimplifier.ready;
  const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
  const todo = VARIANTS.filter(X => !only || only.has(X.v));
  if (!todo.length) throw new Error('no such variant: ' + opt('--only'));
  const done = [];
  for (const X of todo) { const r = await buildVariant(X); if (r) done.push(r); }
  if (done.length && !DEV_OUT) writeCreditsAndAllowlist();
}

await main();
