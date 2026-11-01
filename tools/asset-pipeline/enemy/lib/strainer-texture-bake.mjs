// Terminal State - STRAINER runtime texture bake from the two CODEX images (task studio-alpha-bts-round4-compliance-followup-
// 20261101-01, lane TEXTURE). Deterministic CPU processing only: NO painting, no procedural / Canvas / SVG artwork, no
// generation or network, and the Meshy provider maps are NOT read here (they stay private raw provenance).
//
// The colour of every texel of the accepted mesh's EXISTING UV layout is taken from the user-approved Codex front T-pose and
// the accepted Codex back view by projection:
//   1. segment each image's figure from its flat grey background (quadratic background model per channel, colour distance,
//      morphology, small-component / small-hole cleanup); the sampling mask is the figure eroded by a few pixels so the grey
//      background never bleeds in, samples that land within `pullPx` of it are pulled to the nearest eroded-figure pixel;
//   2. register the mesh to each image: pose the arms with the builder's own rig + skin (CPU linear-blend skinning) toward the
//      image pose, then fit per-region 2D similarity transforms (torso + head, each arm, each leg; blended per vertex by the
//      skin weights so region borders stay continuous) by coordinate ascent on the silhouette IoU;
//   3. bake: rasterise every triangle in UV space; per texel the posed position / normal of its bind-surface point; FRONT where
//      front-facing and visible (image-space z-buffer of the main body), BACK (mirrored x) where back-facing and visible, a
//      smooth normal-based blend across the silhouette band; texels seen by neither are filled from the nearest well-sampled
//      surface points in 3D (Gaussian k-nearest-neighbour mean); UV islands are padded by dilation;
//   4. derivatives from the baked Codex colour only: tangent-space normal map (glTF convention, +Y = toward decreasing v) from a
//      high-passed luminance height field, metallic-roughness (G roughness, B metallic = 0) as a fixed function of the colour.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {MeshoptSimplifier} from 'meshoptimizer';
import {REPO} from '../../zombie/lib/master.mjs';
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {skinPositions} from '../../zombie/lib/glb.mjs';
import {qAxis} from '../../zombie/lib/pose.mjs';

/** The two Codex projection sources (read only, external reference/ tree; never copied into Git). */
export const CODEX_SOURCES = {
  front: {
    file: 'reference/tasks/strainer-tpose-20261101/pose/strainer-tpose-attempt2.png', sha256: 'bb297b9a04db913e85d51f40ae6d4c4ef9d7539344d87fe00b0198e9ae1987be', bytes: 1888811, size: [1536, 1024],
    view: 'front: the creature faces the camera (creature left = image right)', approval: 'user-approved front T-pose (the image the Meshy image-to-3D body was conditioned on)',
    codex: {route: 'codex exec -i (codex-cli 0.163.0, ChatGPT login, existing owned tooling) -> built-in image_gen (tools.image_gen__imagegen); agent model gpt-6.1-sol; image model id not reported by the tool',
      task: 'strainer-tpose-20261101', attempts: 'reference/tasks/strainer-tpose-20261101/pose/ATTEMPTS.jsonl', attempt: 2, promptSha256: '9c56267e30828134a900ee81e257b724f9ddf026bd65ce7b996bcd06ada0646f',
      conditionedOn: {file: 'reference/tasks/beyond-enemy-concepts-20261101/concepts/strainer-attempt1.png', sha256: 'd182c908b51d62ab9b8132190705f14d922e4c759dce637f58638d8de8ae9aa6', what: 'the approved Strainer concept'}},
  },
  back: {
    file: 'reference/tasks/beyond-station-round4-followup-20261101/codex/strainer-back-attempt1.png', sha256: '0a0bf26d4ba808af2442138b375ef2677b028d3e30a2e633e8d78807a0963a6e', bytes: 1871041, size: [1536, 1024],
    view: 'back: seen from directly behind in the same pose / framing (creature left = image left, i.e. mirrored vs the front)', approval: 'accepted Codex back view (first acceptable attempt; projection source for this bake only)',
    codex: {route: 'codex exec -i (codex-cli 0.163.0, ChatGPT login, existing owned tooling) -> built-in image_gen (tools.image_gen__imagegen); agent model gpt-6.1-sol; image model id not reported by the tool',
      task: 'beyond-station-round4-followup-20261101', attempts: 'reference/tasks/beyond-station-round4-followup-20261101/codex/ATTEMPTS.jsonl', attempt: 1, promptSha256: '52df94c696c4add502fd895ac05b522725ae389b29ccf91736a351bb5e6d223a',
      conditionedOn: {file: 'reference/tasks/strainer-tpose-20261101/pose/strainer-tpose-attempt2.png', sha256: 'bb297b9a04db913e85d51f40ae6d4c4ef9d7539344d87fe00b0198e9ae1987be', what: 'the approved front T-pose (attached image)'}},
  },
};

export const BAKE = {
  size: {baseColor: 2048, normal: 1024, metallicRoughness: 1024},
  segment: {borderPx: 24, threshold: 13, refits: 3, rowSigma: 6, floorZone: 0.08, shadowAlphaMin: 0.45, shadowChroma: 7, closeR: 1.5, openR: 1.0, minComponentPx: 80, holeMaxPx: 40, erodePx: 2.0, pullPx: 7,
    note: 'background = per-channel quadratic surface + per-row median offset (Gaussian-smoothed over rowSigma rows) fitted to the border band, refitted on pixels within threshold/2 of it; figure = RGB distance to the background model > threshold, minus the floor contact shadow (bottom floorZone of the figure: neutral darkening rgb ~ alpha x background with alpha >= shadowAlphaMin and chroma residual < shadowChroma); closing then opening (Euclidean disks), components >= minComponentPx kept, background holes <= holeMaxPx filled; sampling mask = figure eroded by erodePx (Euclidean)'},
  register: {workScale: 0.5, regions: ['torso+head', 'L arm', 'R arm', 'L leg', 'R leg'],
    regionJoints: [['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head'], ['L_UpperArm', 'L_Forearm', 'L_Hand'], ['R_UpperArm', 'R_Forearm', 'R_Hand'], ['L_Thigh', 'L_Shin', 'L_Foot'], ['R_Thigh', 'R_Shin', 'R_Foot']],
    pivots: ['Hips', 'L_UpperArm', 'R_UpperArm', 'L_Thigh', 'R_Thigh'],
    armInit: {upper: 34, fore: 0, hand: 0}, steps: {k: 0.02, c: 4, angle: 6, s: 0.04, th: 3, t: 4}, halvings: 5, sweepsPerLevel: 3,
    note: 'arms posed with the builder rig (local rotations about +Z of UpperArm / Forearm / Hand, mirrored for the right side) and CPU linear-blend skinned; base projection x_img = cx +- k x (mirror for the back view), y_img = cy - k y; per region a similarity (scale s, rotation th, translation t) about its pivot joint, blended per vertex by the skin-weight share of the region; all parameters by coordinate ascent of the whole-figure silhouette IoU at workScale (steps halved when a sweep makes no progress)'},
  bake: {facing: [0.0, 0.3], depthEps: {base: 0.01, slopePx: 1.0, max: 0.06}, strandsOccludeBody: false, strandFacing: 'unsigned (|n.z|: loose strips are double-sided)',
    note: 'view weight = smoothstep(facing[0], facing[1], n.view) x visible x inside-pull-range; colour = weighted mean of FRONT / BACK; confidence = min(1, sum of weights); the rest from the fill'},
  fill: {k: 12, sigmaMin: 0.008, sigmaK: 0.6, cellM: 0.02, maxRings: 20, sampleStride: 2, note: 'texels with confidence < 1: colour = conf x sample + (1 - conf) x Gaussian-weighted mean of the k nearest well-sampled texels (bind-surface 3D distance; sigma = max(sigmaMin, sigmaK x d_k); well-sampled texels taken at sampleStride)'},
  pad: {px: 16, note: 'UV islands dilated by averaging covered 8-neighbours, then the remaining empty atlas = mean island colour'},
  normal: {blur: 0.8, highPassSigma: 6, strength: 5.0, maxTilt: 0.75, note: 'height = gauss(L, blur) - gauss(L, highPassSigma) of the baked colour luminance at 1024 (island texels only); n = normalize(-strength dh/dx, +strength dh/dy, 1) (row y grows with v: glTF +Y = toward decreasing v), tilt clamped to maxTilt'},
  roughness: {base: 0.55, bone: 0.8, slime: 0.4, dark: -0.08, note: 'per texel of the baked colour (HSV): pale pink / bone (hue -25..35 deg, value > 0.5) -> dull, saturated olive / yellow (hue 35..80 deg, saturation > 0.35) -> wet slime, dark crevices (value < 0.25) slightly wetter; otherwise wet skin; metallic 0'},
  jpeg: {base: {quality: 86, chromaSubsampling: '4:2:0'}, metallicRoughness: {quality: 88, chromaSubsampling: '4:4:4'}, normal: {quality: 92, chromaSubsampling: '4:4:4'}},
};

const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const r4 = v => +(+v).toFixed(4);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------------------------------------ image + segmentation
async function loadSource(src) {
  const abs = path.join(REPO, src.file);
  const buf = fs.readFileSync(abs);
  if (sha256(buf) !== src.sha256 || buf.length !== src.bytes) throw new Error('Codex source sha256 / bytes mismatch: ' + src.file);
  const {data, info} = await sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject: true});
  if (info.width !== src.size[0] || info.height !== src.size[1]) throw new Error('Codex source size mismatch: ' + src.file);
  return {W: info.width, H: info.height, rgb: new Uint8Array(data.buffer, data.byteOffset, data.length)};
}

/** Exact 1D squared distance transform (Felzenszwalb-Huttenlocher) with argmin. */
function dt1d(f, n, d, arg, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; arg[q] = v[k]; }
}
/** 2D Euclidean distance transform to the nearest site: {d2 (squared px), site (pixel index or -1)}. */
function edt(isSite, W, H) {
  const INF = 1e12, M = Math.max(W, H);
  const f = new Float64Array(M), d = new Float64Array(M), arg = new Int32Array(M), v = new Int32Array(M), z = new Float64Array(M + 1);
  const colD = new Float64Array(W * H), colArg = new Int32Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = isSite[y * W + x] ? 0 : INF;
    dt1d(f, H, d, arg, v, z);
    for (let y = 0; y < H; y++) { colD[y * W + x] = d[y]; colArg[y * W + x] = arg[y]; }
  }
  const d2 = new Float64Array(W * H), site = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = colD[y * W + x];
    dt1d(f, W, d, arg, v, z);
    for (let x = 0; x < W; x++) { const cx = arg[x], cy = colArg[y * W + cx]; d2[y * W + x] = d[x]; site[y * W + x] = d[x] >= INF / 2 ? -1 : cy * W + cx; }
  }
  return {d2, site};
}
const dilate = (m, W, H, r) => { const {d2} = edt(m, W, H); return Uint8Array.from(d2, v => v <= r * r ? 1 : 0); };
const erode = (m, W, H, r) => { const {d2} = edt(Uint8Array.from(m, v => v ? 0 : 1), W, H); return Uint8Array.from(d2, (v, i) => m[i] && v > r * r ? 1 : 0); };

/** 8-connected components of the pixels with m == val: {label (Int32, -1 elsewhere), sizes[], touchesBorder[]}. */
function labelComponents(m, W, H, val) {
  const label = new Int32Array(W * H).fill(-1), sizes = [], border = [], q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (m[s] !== val || label[s] >= 0) continue;
    const id = sizes.length; let head = 0, tail = 0, n = 0, b = false;
    q[tail++] = s; label[s] = id;
    while (head < tail) {
      const p = q[head++], x = p % W, y = (p - x) / W; n++;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) b = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const o = yy * W + xx; if (m[o] === val && label[o] < 0) { label[o] = id; q[tail++] = o; }
      }
    }
    sizes.push(n); border.push(b);
  }
  return {label, sizes, border};
}

function solve(A, b) { // Gaussian elimination with partial pivoting (small dense)
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
/** Per-channel quadratic background surface fitted to the selected pixels. */
function fitBackground(img, sel) {
  const {W, H, rgb} = img;
  const phi = (x, y) => { const u = x / W * 2 - 1, v = y / H * 2 - 1; return [1, u, v, u * u, u * v, v * v]; };
  const A = Array.from({length: 6}, () => new Array(6).fill(0)), B = [0, 1, 2].map(() => new Array(6).fill(0));
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = y * W + x; if (!sel[i]) continue;
    const p = phi(x + 0.5, y + 0.5);
    for (let a = 0; a < 6; a++) { for (let b = 0; b < 6; b++) A[a][b] += p[a] * p[b]; for (let c = 0; c < 3; c++) B[c][a] += p[a] * rgb[i * 3 + c]; }
  }
  const coef = B.map(b => solve(A, b));
  const bg = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = phi(x + 0.5, y + 0.5), i = y * W + x; for (let c = 0; c < 3; c++) { let s = 0; for (let a = 0; a < 6; a++) s += coef[c][a] * p[a]; bg[i * 3 + c] = s; } }
  // + a per-row offset (median residual of the selected pixels of the row, Gaussian-smoothed over rows): the backdrop's
  // vertical sweep (wall -> floor brightening) is not quadratic
  const P = BAKE.segment, off = new Float32Array(H * 3), has = new Uint8Array(H);
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    const r = [];
    for (let x = 0; x < W; x++) { const i = y * W + x; if (sel[i]) r.push(rgb[i * 3 + c] - bg[i * 3 + c]); }
    if (r.length >= 16) { r.sort((a, b) => a - b); off[y * 3 + c] = r[r.length >> 1]; has[y] = 1; }
  }
  const sm = new Float32Array(H * 3), sg = P.rowSigma, rr = Math.ceil(3 * sg);
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
    let s = 0, w = 0;
    for (let d = -rr; d <= rr; d++) { const yy = y + d; if (yy < 0 || yy >= H || !has[yy]) continue; const k = Math.exp(-d * d / (2 * sg * sg)); s += k * off[yy * 3 + c]; w += k; }
    sm[y * 3 + c] = w ? s / w : 0;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) bg[(y * W + x) * 3 + c] += sm[y * 3 + c];
  return {bg, coef};
}

function segment(img) {
  const P = BAKE.segment, {W, H, rgb} = img, N = W * H;
  let sel = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < P.borderPx || y < P.borderPx || x >= W - P.borderPx || y >= H - P.borderPx) sel[y * W + x] = 1;
  let fit = fitBackground(img, sel);
  const dist = new Float32Array(N);
  const measure = () => { for (let i = 0; i < N; i++) dist[i] = Math.hypot(rgb[i * 3] - fit.bg[i * 3], rgb[i * 3 + 1] - fit.bg[i * 3 + 1], rgb[i * 3 + 2] - fit.bg[i * 3 + 2]); };
  measure();
  for (let it = 0; it < P.refits; it++) { sel = Uint8Array.from(dist, d => d < P.threshold / 2 ? 1 : 0); fit = fitBackground(img, sel); measure(); }
  let bgResid = 0, nb = 0; for (let i = 0; i < N; i += 7) if (dist[i] < P.threshold / 2) { bgResid += dist[i]; nb++; }
  let m = Uint8Array.from(dist, d => d > P.threshold ? 1 : 0);
  const raw = m.reduce((a, v) => a + v, 0);
  // floor contact shadow: in the floor zone (the bottom floorZone of the figure's height) a pixel that is only a neutral
  // darkening of the backdrop (rgb ~ alpha x background: small chroma residual) is background, not figure
  let fy0 = H, fy1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { fy0 = Math.min(fy0, y); fy1 = y; }
  let shadow = 0;
  const zoneTop = Math.round(fy1 - P.floorZone * (fy1 - fy0));
  for (let y = Math.max(0, zoneTop); y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!m[i]) continue;
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], R0 = fit.bg[i * 3], G0 = fit.bg[i * 3 + 1], B0 = fit.bg[i * 3 + 2];
    const al = (r * R0 + g * G0 + b * B0) / (R0 * R0 + G0 * G0 + B0 * B0), ch = Math.hypot(r - al * R0, g - al * G0, b - al * B0);
    if (al >= P.shadowAlphaMin && ch < P.shadowChroma) { m[i] = 0; shadow++; }
  }
  m = erode(dilate(m, W, H, P.closeR), W, H, P.closeR);
  m = dilate(erode(m, W, H, P.openR), W, H, P.openR);
  const fgc = labelComponents(m, W, H, 1);
  let dropped = 0;
  for (let i = 0; i < N; i++) if (m[i] && fgc.sizes[fgc.label[i]] < P.minComponentPx) { m[i] = 0; dropped++; }
  const bgc = labelComponents(m, W, H, 0);
  let filled = 0;
  for (let i = 0; i < N; i++) if (!m[i] && !bgc.border[bgc.label[i]] && bgc.sizes[bgc.label[i]] <= P.holeMaxPx) { m[i] = 1; filled++; }
  const eroded = erode(m, W, H, P.erodePx);
  const pull = edt(eroded, W, H);
  let area = 0, er = 0, x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (m[i]) { area++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } if (eroded[i]) er++; }
  // mean colour of the eroded figure (front / back exposure comparison)
  const mean = [0, 0, 0]; for (let i = 0; i < N; i++) if (eroded[i]) for (let c = 0; c < 3; c++) mean[c] += rgb[i * 3 + c] / er;
  return {mask: m, eroded, pull, bbox: [x0, y0, x1, y1],
    stats: {figurePx: area, figureFraction: r4(area / N), erodedPx: er, rawAboveThresholdPx: raw, floorShadowPx: shadow, floorZoneTopRow: zoneTop, droppedSpeckPx: dropped, filledHolePx: filled, bgMeanResidual: r4(bgResid / Math.max(1, nb)), bboxPx: [x0, y0, x1, y1], meanErodedRGB: mean.map(r4),
      backgroundModel: fit.coef.map(c => c.map(r4))}};
}

// ------------------------------------------------------------------------------------------------ mesh prep / posing
function prepMesh(mesh) {
  const n = mesh.pos.length / 3, I = mesh.idx;
  const remap = MeshoptSimplifier.generatePositionRemap(mesh.pos, 3);
  const parent = Int32Array.from({length: n}, (_, i) => remap[i]);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) { const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]); if (a !== b) parent[b] = a; const a2 = find(a), c2 = find(c); if (a2 !== c2) parent[c2] = a2; }
  const root = Int32Array.from({length: n}, (_, i) => find(i)), size = new Map();
  for (let i = 0; i < n; i++) if (remap[i] === i) size.set(root[i], (size.get(root[i]) || 0) + 1);
  const main = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const strand = Uint8Array.from(root, r => r === main ? 0 : 1);
  const names = JOINTS.map(j => j[0]), R = BAKE.register.regionJoints, jReg = names.map(nm => R.findIndex(g => g.includes(nm)));
  const regW = new Float32Array(n * 5), dom = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) regW[i * 5 + jReg[mesh.joints[i * 4 + k]]] += mesh.weights[i * 4 + k];
    let s = 0; for (let r = 0; r < 5; r++) s += regW[i * 5 + r];
    let best = 0; for (let r = 0; r < 5; r++) { regW[i * 5 + r] /= s || 1; if (regW[i * 5 + r] > regW[i * 5 + best]) best = r; }
    dom[i] = best;
  }
  return {n, strand, regW, dom, strandComponents: size.size - 1, mainWeldedVertices: size.get(main)};
}

function armPose(a) {
  const z = [0, 0, 1];
  return {rot: {L_UpperArm: qAxis(z, a.Lu), L_Forearm: qAxis(z, a.Lf), L_Hand: qAxis(z, a.Lh), R_UpperArm: qAxis(z, -a.Ru), R_Forearm: qAxis(z, -a.Rf), R_Hand: qAxis(z, -a.Rh)}};
}
/** Posed positions + LBS-rotated normals for an arm pose. */
function posedMesh(mesh, skel, rig, a) {
  const world = rig.fk(armPose(a));
  const pos = skinPositions(mesh, skel, world);
  const names = JOINTS.map(j => j[0]), q = names.map(nm => world[nm].rot), n = mesh.pos.length / 3, nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v0 = mesh.nrm[i * 3], v1 = mesh.nrm[i * 3 + 1], v2 = mesh.nrm[i * 3 + 2];
    let x = 0, y = 0, zz = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weights[i * 4 + k]; if (!w) continue;
      const [qx, qy, qz, qw] = q[mesh.joints[i * 4 + k]];
      const ix = qw * v0 + qy * v2 - qz * v1, iy = qw * v1 + qz * v0 - qx * v2, iz = qw * v2 + qx * v1 - qy * v0, iw = -qx * v0 - qy * v1 - qz * v2;
      x += w * (ix * qw + iw * -qx + iy * -qz - iz * -qy); y += w * (iy * qw + iw * -qy + iz * -qx - ix * -qz); zz += w * (iz * qw + iw * -qz + ix * -qy - iy * -qx);
    }
    const l = Math.hypot(x, y, zz) || 1; nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = zz / l;
  }
  return {pos, nrm, world};
}

/** Per-vertex image coordinates (full-resolution pixels) for a view's parameters. */
function projectView(view, posed, prep, out) {
  const sg = view.mirror ? -1 : 1, {k, cx, cy} = view;
  const piv = BAKE.register.pivots.map(j => { const p = posed.world[j].pos; return [cx + sg * k * p[0], cy - k * p[1]]; });
  const A = view.sim.map(([s, th, tx, ty], r) => {
    const c = s * Math.cos(th * Math.PI / 180), sn = s * Math.sin(th * Math.PI / 180), p = piv[r];
    return [c, -sn, sn, c, p[0] - (c * p[0] - sn * p[1]) + tx, p[1] - (sn * p[0] + c * p[1]) + ty];
  });
  const P = posed.pos, W = prep.regW;
  for (let i = 0; i < prep.n; i++) {
    const X0 = cx + sg * k * P[i * 3], Y0 = cy - k * P[i * 3 + 1];
    let X = 0, Y = 0;
    for (let r = 0; r < 5; r++) { const w = W[i * 5 + r]; if (!w) continue; const a = A[r]; X += w * (a[0] * X0 + a[1] * Y0 + a[4]); Y += w * (a[2] * X0 + a[3] * Y0 + a[5]); }
    out[i * 2] = X; out[i * 2 + 1] = Y;
  }
  return out;
}

/** Triangle rasteriser over pixel centres; cb(pixelIndex, w0, w1, w2, tri). */
function raster(W, H, idx, XY, scale, triOk, cb) {
  for (let t = 0; t < idx.length; t += 3) {
    if (triOk && !triOk(t / 3)) continue;
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = XY[a * 2] * scale, ay = XY[a * 2 + 1] * scale, bx = XY[b * 2] * scale, by = XY[b * 2 + 1] * scale, cx = XY[c * 2] * scale, cy = XY[c * 2 + 1] * scale;
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area, w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
      cb(y * W + x, w0, w1, w2, t / 3);
    }
  }
}

function downMask(m, W, H, s) {
  const w = Math.round(W * s), h = Math.round(H * s), f = Math.round(1 / s), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let c = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) c += m[(y * f + dy) * W + x * f + dx]; out[y * w + x] = c * 2 >= f * f ? 1 : 0; }
  return {m: out, w, h};
}

/** Fit one view: arm pose + per-region similarities maximising the silhouette IoU. */
function registerView(name, img, seg, mesh, skel, rig, prep, mirror, log) {
  const P = BAKE.register, sc = P.workScale, D = downMask(seg.mask, img.W, img.H, sc);
  const idx = mesh.idx, XY = new Float32Array(prep.n * 2), sil = new Uint8Array(D.w * D.h);
  let imgArea = 0; for (const v of D.m) imgArea += v;
  const cache = new Map();
  const posedFor = a => { const key = JSON.stringify(a); if (!cache.has(key)) { if (cache.size > 40) cache.clear(); cache.set(key, posedMesh(mesh, skel, rig, a)); } return cache.get(key); };
  const iouOf = view => {
    const posed = posedFor(view.arm);
    projectView({...view, mirror}, posed, prep, XY);
    sil.fill(0);
    raster(D.w, D.h, idx, XY, sc, null, o => { sil[o] = 1; });
    let inter = 0, uni = 0;
    for (let i = 0; i < sil.length; i++) { const a = sil[i], b = D.m[i]; if (a & b) inter++; if (a | b) uni++; }
    return inter / uni;
  };
  // initial: arms raised, height / floor / centre from the bounding boxes
  const arm = {Lu: P.armInit.upper, Lf: P.armInit.fore, Lh: P.armInit.hand, Ru: P.armInit.upper, Rf: P.armInit.fore, Rh: P.armInit.hand};
  const p0 = posedFor(arm);
  let ymax = -Infinity, ymin = Infinity, xs = 0, xn = 0;
  for (let i = 0; i < prep.n; i++) { ymax = Math.max(ymax, p0.pos[i * 3 + 1]); ymin = Math.min(ymin, p0.pos[i * 3 + 1]); }
  const [bx0, by0, bx1, by1] = seg.bbox;
  // horizontal centre of the image figure from the leg / torso band (between 35 % and 75 % of the height), not the arms
  for (let y = Math.round(by0 + 0.4 * (by1 - by0)); y < by0 + 0.75 * (by1 - by0); y++) for (let x = bx0; x <= bx1; x++) if (seg.mask[y * img.W + x]) { xs += x; xn++; }
  let view = {k: (by1 + 1 - by0) / (ymax - ymin), cx: xs / xn + 0.5, cy: by1 + 1, arm, sim: [0, 1, 2, 3, 4].map(() => [1, 0, 0, 0])};
  const init = iouOf(view);
  const S = P.steps;
  const params = [
    ['k', S.k * view.k], ['cx', S.c], ['cy', S.c],
    ...['Lu', 'Lf', 'Lh', 'Ru', 'Rf', 'Rh'].map(a => ['arm.' + a, S.angle]),
    ...[0, 1, 2, 3, 4].flatMap(r => [[`sim.${r}.0`, S.s], [`sim.${r}.1`, S.th], [`sim.${r}.2`, S.t], [`sim.${r}.3`, S.t]]),
  ];
  const get = (v, p) => { const s = p.split('.'); return s[0] === 'arm' ? v.arm[s[1]] : s[0] === 'sim' ? v.sim[+s[1]][+s[2]] : v[p]; };
  const set = (v, p, x) => {
    const s = p.split('.'), o = {...v, arm: {...v.arm}, sim: v.sim.map(q => [...q])};
    if (s[0] === 'arm') o.arm[s[1]] = x; else if (s[0] === 'sim') o.sim[+s[1]][+s[2]] = x; else o[p] = x;
    return o;
  };
  let best = init, evals = 1, scale = 1;
  for (let level = 0; level <= P.halvings; level++, scale /= 2) {
    for (let sweep = 0; sweep < P.sweepsPerLevel; sweep++) {
      let improved = false;
      for (const [p, st] of params) {
        for (const dir of [1, -1]) {
          let moved = false;
          for (;;) {
            const cand = set(view, p, get(view, p) + dir * st * scale), v = iouOf(cand); evals++;
            if (v > best + 1e-6) { best = v; view = cand; improved = moved = true; } else break;
          }
          if (moved) break;
        }
      }
      if (!improved) break;
    }
  }
  // per-region IoU: mesh pixels by dominant region; image pixels labelled by the nearest mesh pixel
  const posed = posedFor(view.arm);
  projectView({...view, mirror}, posed, prep, XY);
  const lab = new Int8Array(D.w * D.h).fill(-1);
  raster(D.w, D.h, idx, XY, sc, null, (o, w0, w1, w2, t) => { const v = w0 >= w1 && w0 >= w2 ? idx[t * 3] : w1 >= w2 ? idx[t * 3 + 1] : idx[t * 3 + 2]; lab[o] = prep.dom[v]; });
  const near = edt(Uint8Array.from(lab, v => v >= 0 ? 1 : 0), D.w, D.h).site;
  const inter = new Float64Array(5), uni = new Float64Array(5);
  for (let i = 0; i < D.w * D.h; i++) {
    const a = lab[i], b = D.m[i] ? (a >= 0 ? a : (near[i] >= 0 ? lab[near[i]] : -1)) : -1;
    if (a >= 0 && a === b) { inter[a]++; uni[a]++; } else { if (a >= 0) uni[a]++; if (b >= 0) uni[b]++; }
  }
  const regionIoU = Object.fromEntries(P.regions.map((r, i) => [r, r4(inter[i] / Math.max(1, uni[i]))]));
  const fit = {iouInitial: r4(init), iou: r4(best), regionIoU, evals, imageMaskPx: imgArea, workScale: sc,
    k: r4(view.k), cx: r4(view.cx), cy: r4(view.cy), armDeg: Object.fromEntries(Object.entries(view.arm).map(([a, v]) => [a, r4(v)])),
    similarity: Object.fromEntries(P.regions.map((r, i) => [r, {s: r4(view.sim[i][0]), thDeg: r4(view.sim[i][1]), txPx: r4(view.sim[i][2]), tyPx: r4(view.sim[i][3])}]))};
  log?.(`  ${name}: IoU ${fit.iouInitial} -> ${fit.iou} (${evals} evals) regions ${JSON.stringify(regionIoU)} arms ${JSON.stringify(fit.armDeg)}`);
  return {view: {...view, mirror}, posed, fit, workSil: {lab, w: D.w, h: D.h, img: D.m}};
}

// ------------------------------------------------------------------------------------------------ bake
function sampleBilinear(img, x, y, out) {
  const {W, H, rgb} = img;
  const fx = Math.min(W - 1.001, Math.max(0, x - 0.5)), fy = Math.min(H - 1.001, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const i00 = (y0 * W + x0) * 3, i10 = i00 + 3, i01 = i00 + W * 3, i11 = i01 + 3;
  for (let c = 0; c < 3; c++) out[c] = (rgb[i00 + c] * (1 - ax) + rgb[i10 + c] * ax) * (1 - ay) + (rgb[i01 + c] * (1 - ax) + rgb[i11 + c] * ax) * ay;
}

/** Image-space z-buffer of the main body (depth toward the camera: +z front, -z back). */
function zbuffer(img, reg, mesh, prep) {
  const XY = projectView(reg.view, reg.posed, prep, new Float32Array(prep.n * 2));
  const zb = new Float32Array(img.W * img.H).fill(-Infinity), sg = reg.view.mirror ? -1 : 1, P = reg.posed.pos, I = mesh.idx;
  raster(img.W, img.H, I, XY, 1, t => !prep.strand[I[t * 3]] || BAKE.bake.strandsOccludeBody, (o, w0, w1, w2, t) => {
    const d = sg * (w0 * P[I[t * 3] * 3 + 2] + w1 * P[I[t * 3 + 1] * 3 + 2] + w2 * P[I[t * 3 + 2] * 3 + 2]);
    if (d > zb[o]) zb[o] = d;
  });
  return {XY, zb};
}

/**
 * Bake the runtime maps. mesh = {pos, nrm (bind), uv, idx, joints, weights (float, normalised)}, skel = {joints: bind world
 * positions}, rig = zombie/lib/pose.mjs Rig of the same skeleton. Returns {base, normal, mr (JPEG buffers), report}.
 */
export async function bakeStrainerTextures({mesh, skel, rig, debugDir = null, log = console.log}) {
  const t0 = Date.now();
  await MeshoptSimplifier.ready;
  const S = BAKE.size.baseColor;
  const imgs = {front: await loadSource(CODEX_SOURCES.front), back: await loadSource(CODEX_SOURCES.back)};
  const seg = {front: segment(imgs.front), back: segment(imgs.back)};
  log(`  segmentation front ${JSON.stringify(seg.front.stats.bboxPx)} ${seg.front.stats.figurePx} px, back ${JSON.stringify(seg.back.stats.bboxPx)} ${seg.back.stats.figurePx} px`);
  const prep = prepMesh(mesh);
  const reg = {front: registerView('front', imgs.front, seg.front, mesh, skel, rig, prep, false, log), back: registerView('back', imgs.back, seg.back, mesh, skel, rig, prep, true, log)};
  const zb = {front: zbuffer(imgs.front, reg.front, mesh, prep), back: zbuffer(imgs.back, reg.back, mesh, prep)};

  // ---- UV-space bake at S x S
  const N = S * S, col = new Float32Array(N * 3), conf = new Float32Array(N), bpos = new Float32Array(N * 3), cover = new Uint8Array(N), src = new Uint8Array(N * 3);
  const I = mesh.idx, UV = mesh.uv, B = mesh.pos;
  const uvXY = Float32Array.from(UV, v => v * S);
  const views = ['front', 'back'].map(v => ({name: v, img: imgs[v], seg: seg[v], reg: reg[v], zb: zb[v], sg: reg[v].view.mirror ? -1 : 1}));
  const F = BAKE.bake, cs = [0, 0, 0], acc = [0, 0, 0];
  let overlap = 0, pulled = 0, sampledTexels = 0;
  const stat = {front: 0, back: 0, both: 0, neither: 0, occluded: 0, outside: 0};
  raster(S, S, I, uvXY, 1, null, (o, w0, w1, w2, t) => {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    if (cover[o]) overlap++;
    cover[o] = 1;
    for (let k = 0; k < 3; k++) bpos[o * 3 + k] = w0 * B[a * 3 + k] + w1 * B[b * 3 + k] + w2 * B[c * 3 + k];
    const isStrand = prep.strand[a];
    let wsum = 0; acc[0] = acc[1] = acc[2] = 0;
    let fw = 0, bw = 0, occ = 0, out = 0;
    for (const V of views) {
      const P = V.reg.posed.pos, Nn = V.reg.posed.nrm, XY = V.zb.XY;
      let nx = w0 * Nn[a * 3] + w1 * Nn[b * 3] + w2 * Nn[c * 3], ny = w0 * Nn[a * 3 + 1] + w1 * Nn[b * 3 + 1] + w2 * Nn[c * 3 + 1], nz = w0 * Nn[a * 3 + 2] + w1 * Nn[b * 3 + 2] + w2 * Nn[c * 3 + 2];
      const nl = Math.hypot(nx, ny, nz) || 1; nz = V.sg * nz / nl;
      const f = isStrand ? Math.abs(nz) : nz;
      const wf = smoothstep(F.facing[0], F.facing[1], f);
      if (wf <= 0) continue;
      const X = w0 * XY[a * 2] + w1 * XY[b * 2] + w2 * XY[c * 2], Y = w0 * XY[a * 2 + 1] + w1 * XY[b * 2 + 1] + w2 * XY[c * 2 + 1];
      const px = Math.floor(X), py = Math.floor(Y);
      if (px < 0 || py < 0 || px >= V.img.W || py >= V.img.H) { out++; continue; }
      const pi = py * V.img.W + px;
      const d = V.sg * (w0 * P[a * 3 + 2] + w1 * P[b * 3 + 2] + w2 * P[c * 3 + 2]);
      const slope = Math.sqrt(Math.max(0, 1 - nz * nz)) / Math.max(Math.abs(nz), 1e-3) / V.reg.view.k;
      const eps = Math.min(F.depthEps.max, F.depthEps.base + F.depthEps.slopePx * slope);
      if (V.zb.zb[pi] > d + eps) { occ++; continue; }
      if (V.seg.eroded[pi]) sampleBilinear(V.img, X, Y, cs);
      else {
        const s = V.seg.pull.site[pi];
        if (s < 0 || V.seg.pull.d2[pi] > BAKE.segment.pullPx ** 2) { out++; continue; }
        const sx = s % V.img.W, sy = (s - sx) / V.img.W;
        sampleBilinear(V.img, sx + 0.5, sy + 0.5, cs); pulled++;
      }
      for (let k = 0; k < 3; k++) acc[k] += wf * cs[k];
      wsum += wf;
      if (V.name === 'front') fw = wf; else bw = wf;
    }
    if (wsum > 0) { for (let k = 0; k < 3; k++) col[o * 3 + k] = acc[k] / wsum; sampledTexels++; }
    conf[o] = Math.min(1, wsum);
    src[o * 3] = Math.round(255 * Math.min(1, fw)); src[o * 3 + 2] = Math.round(255 * Math.min(1, bw));
    if (fw > 0 && bw > 0) stat.both++; else if (fw > 0) stat.front++; else if (bw > 0) stat.back++; else { stat.neither++; if (occ) stat.occluded++; else if (out) stat.outside++; }
  });
  let covered = 0, full = 0, partial = 0, none = 0;
  for (let o = 0; o < N; o++) { if (!cover[o]) continue; covered++; if (conf[o] >= 1 - 1e-6) full++; else if (conf[o] > 0) partial++; else none++; }
  log(`  bake ${S}: covered ${covered} texels, full ${(full / covered * 100).toFixed(1)} %, partial ${(partial / covered * 100).toFixed(1)} %, unsampled ${(none / covered * 100).toFixed(1)} % (${JSON.stringify(stat)})`);

  // ---- fill from the nearest well-sampled surface points (3D, bind surface)
  const FL = BAKE.fill, h = FL.cellM, TB = 1 << 20, hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) & (TB - 1);
  const pts = [];
  for (let y = 0; y < S; y += FL.sampleStride) for (let x = 0; x < S; x += FL.sampleStride) { const o = y * S + x; if (cover[o] && conf[o] >= 1 - 1e-6) pts.push(o); }
  const cnt = new Int32Array(TB + 1), cellOf = new Int32Array(pts.length);
  for (let i = 0; i < pts.length; i++) { const o = pts[i]; const c = hash(Math.floor(bpos[o * 3] / h), Math.floor(bpos[o * 3 + 1] / h), Math.floor(bpos[o * 3 + 2] / h)); cellOf[i] = c; cnt[c + 1]++; }
  for (let c = 0; c < TB; c++) cnt[c + 1] += cnt[c];
  const fillPos = cnt.slice(), list = new Int32Array(pts.length);
  for (let i = 0; i < pts.length; i++) list[fillPos[cellOf[i]]++] = pts[i];
  const kd = new Float64Array(FL.k), ki = new Int32Array(FL.k);
  let filled = 0, maxD = 0, sumD = 0;
  for (let o = 0; o < N; o++) {
    if (!cover[o] || conf[o] >= 1 - 1e-6) continue;
    const px = bpos[o * 3], py = bpos[o * 3 + 1], pz = bpos[o * 3 + 2], cx = Math.floor(px / h), cy = Math.floor(py / h), cz = Math.floor(pz / h);
    let m = 0;
    for (let r = 0; r <= FL.maxRings; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const c = hash(cx + dx, cy + dy, cz + dz);
        for (let e = cnt[c]; e < cnt[c + 1]; e++) {
          const q = list[e], ddx = bpos[q * 3] - px, ddy = bpos[q * 3 + 1] - py, ddz = bpos[q * 3 + 2] - pz;
          if (Math.floor(bpos[q * 3] / h) !== cx + dx || Math.floor(bpos[q * 3 + 1] / h) !== cy + dy || Math.floor(bpos[q * 3 + 2] / h) !== cz + dz) continue; // hash collision
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (m < FL.k) { let j = m++; while (j > 0 && kd[j - 1] > d2) { kd[j] = kd[j - 1]; ki[j] = ki[j - 1]; j--; } kd[j] = d2; ki[j] = q; }
          else if (d2 < kd[FL.k - 1]) { let j = FL.k - 1; while (j > 0 && kd[j - 1] > d2) { kd[j] = kd[j - 1]; ki[j] = ki[j - 1]; j--; } kd[j] = d2; ki[j] = q; }
        }
      }
      if (m >= FL.k && Math.sqrt(kd[FL.k - 1]) <= r * h) break;
    }
    if (!m) continue;
    const dk = Math.sqrt(kd[m - 1]), sig = Math.max(FL.sigmaMin, FL.sigmaK * dk);
    let ws = 0; acc[0] = acc[1] = acc[2] = 0;
    for (let j = 0; j < m; j++) { const w = Math.exp(-kd[j] / (2 * sig * sig)); ws += w; for (let k = 0; k < 3; k++) acc[k] += w * col[ki[j] * 3 + k]; }
    const cf = conf[o];
    for (let k = 0; k < 3; k++) col[o * 3 + k] = cf * col[o * 3 + k] + (1 - cf) * acc[k] / ws;
    src[o * 3 + 1] = Math.round(255 * (1 - cf));
    filled++; const d1 = Math.sqrt(kd[0]); maxD = Math.max(maxD, d1); sumD += d1;
  }
  log(`  fill: ${filled} texels (${(filled / covered * 100).toFixed(1)} %), nearest sample mean ${(sumD / Math.max(1, filled) * 100).toFixed(2)} cm, max ${(maxD * 100).toFixed(1)} cm, ${pts.length} sample points`);

  // ---- pad UV islands
  const padded = padIslands(col, cover, S, BAKE.pad.px);
  const baseRGB = Buffer.alloc(N * 3);
  for (let i = 0; i < N * 3; i++) baseRGB[i] = Math.max(0, Math.min(255, Math.round(padded[i])));

  // ---- derivatives (1024)
  const s2 = BAKE.size.normal, low = await sharp(baseRGB, {raw: {width: S, height: S, channels: 3}}).resize(s2, s2, {kernel: 'cubic'}).raw().toBuffer();
  const cov2 = new Uint8Array(s2 * s2), f2 = S / s2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (cover[y * S + x]) cov2[Math.floor(y / f2) * s2 + Math.floor(x / f2)] = 1;
  const nm = normalMap(low, cov2, s2);
  const mr = roughnessMap(low, s2);
  checkNormalConvention();

  const enc = BAKE.jpeg;
  const base = await sharp(baseRGB, {raw: {width: S, height: S, channels: 3}}).jpeg({quality: enc.base.quality, mozjpeg: true, chromaSubsampling: enc.base.chromaSubsampling}).toBuffer();
  const normal = await sharp(nm.rgb, {raw: {width: s2, height: s2, channels: 3}}).jpeg({quality: enc.normal.quality, mozjpeg: true, chromaSubsampling: enc.normal.chromaSubsampling}).toBuffer();
  const mrJ = await sharp(mr.rgb, {raw: {width: s2, height: s2, channels: 3}}).jpeg({quality: enc.metallicRoughness.quality, mozjpeg: true, chromaSubsampling: enc.metallicRoughness.chromaSubsampling}).toBuffer();

  if (debugDir) await writeDebug(debugDir, {imgs, seg, reg, prep, mesh, S, baseRGB, src, cover, nm, mr, s2});
  const report = {
    sources: Object.fromEntries(Object.entries(CODEX_SOURCES).map(([k, v]) => [k, {...v, sha256Verified: v.sha256}])),
    segmentation: {front: seg.front.stats, back: seg.back.stats},
    registration: {front: reg.front.fit, back: reg.back.fit},
    mesh: {vertices: prep.n, triangles: I.length / 3, looseStrandComponents: prep.strandComponents, mainBodyWeldedVertices: prep.mainWeldedVertices, uvLayout: 'the accepted mesh\'s own TEXCOORD_0 (unchanged)'},
    bake: {size: S, coveredTexels: covered, coveredFraction: r4(covered / N), overlappingTexelWrites: overlap,
      sampledFully: r4(full / covered), sampledPartially: r4(partial / covered), unsampled: r4(none / covered),
      byView: {frontOnly: r4(stat.front / covered), backOnly: r4(stat.back / covered), frontAndBack: r4(stat.both / covered), neither: r4(stat.neither / covered), neitherOccluded: r4(stat.occluded / covered), neitherOutsideFigure: r4(stat.outside / covered)},
      pulledSamples: pulled, filledTexels: filled, filledFraction: r4(filled / covered), filledFullyFraction: r4(none / covered),
      fillNearestSampleM: {mean: r4(sumD / Math.max(1, filled)), max: r4(maxD)}, fillSamplePoints: pts.length},
    derivatives: {normal: nm.stats, metallicRoughness: mr.stats, normalConvention: 'glTF 2.0 tangent space: R = +X (toward increasing u), G = +Y (toward decreasing v, image up), B = +Z; verified by the builder on a synthetic dome (checkNormalConvention) and in a lit CPU render'},
    outputs: {baseColor: {size: S, bytes: base.length, sha256: sha256(base), ...enc.base}, normal: {size: s2, bytes: normal.length, sha256: sha256(normal), ...enc.normal}, metallicRoughness: {size: s2, bytes: mrJ.length, sha256: sha256(mrJ), ...enc.metallicRoughness}},
    params: BAKE, seconds: Math.round((Date.now() - t0) / 1000),
  };
  return {base, normal, mr: mrJ, report};
}

function padIslands(col, cover, S, px) {
  const out = Float32Array.from(col), done = Uint8Array.from(cover);
  let frontier = [];
  for (let pass = 0; pass < px; pass++) {
    frontier = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const o = y * S + x; if (done[o]) continue;
      let n = 0, r = 0, g = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        const q = yy * S + xx; if (!done[q]) continue; n++; r += out[q * 3]; g += out[q * 3 + 1]; b += out[q * 3 + 2];
      }
      if (n) frontier.push(o, r / n, g / n, b / n);
    }
    if (!frontier.length) break;
    for (let i = 0; i < frontier.length; i += 4) { const o = frontier[i]; out[o * 3] = frontier[i + 1]; out[o * 3 + 1] = frontier[i + 2]; out[o * 3 + 2] = frontier[i + 3]; done[o] = 1; }
  }
  const mean = [0, 0, 0]; let n = 0;
  for (let o = 0; o < S * S; o++) if (cover[o]) { n++; for (let k = 0; k < 3; k++) mean[k] += col[o * 3 + k]; }
  for (let o = 0; o < S * S; o++) if (!done[o]) for (let k = 0; k < 3; k++) out[o * 3 + k] = mean[k] / n;
  return out;
}

function gauss(src, W, H, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  const r = Math.ceil(sigma * 3), ker = Array.from({length: 2 * r + 1}, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma))), ks = ker.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let i = -r; i <= r; i++) s += ker[i + r] * src[y * W + Math.min(W - 1, Math.max(0, x + i))]; tmp[y * W + x] = s / ks; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let i = -r; i <= r; i++) s += ker[i + r] * tmp[Math.min(H - 1, Math.max(0, y + i)) * W + x]; out[y * W + x] = s / ks; }
  return out;
}

/** Tangent-space normal from the encoded height derivative (row y grows with v). Exported for the convention check / tests. */
export function normalFromGradient(gx, gy, strength = BAKE.normal.strength, maxTilt = BAKE.normal.maxTilt) {
  let nx = -strength * gx, ny = strength * gy;
  const t = Math.hypot(nx, ny);
  if (t > maxTilt) { nx *= maxTilt / t; ny *= maxTilt / t; }
  const l = Math.hypot(nx, ny, 1);
  return [nx / l, ny / l, 1 / l];
}

function normalMap(rgb, cov, S) {
  const P = BAKE.normal, L = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) L[i] = (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / 255;
  const g1 = gauss(L, S, S, P.blur), g2 = gauss(L, S, S, P.highPassSigma), h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) h[i] = g1[i] - g2[i];
  const out = Buffer.alloc(S * S * 3);
  let tiltSum = 0, n = 0, clamped = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = y * S + x;
    if (!cov[o]) { out[o * 3] = 128; out[o * 3 + 1] = 128; out[o * 3 + 2] = 255; continue; }
    const c = (xx, yy) => xx >= 0 && yy >= 0 && xx < S && yy < S && cov[yy * S + xx];
    const l = c(x - 1, y), r = c(x + 1, y), u = c(x, y - 1), d = c(x, y + 1);
    const gx = l && r ? (h[o + 1] - h[o - 1]) / 2 : r ? h[o + 1] - h[o] : l ? h[o] - h[o - 1] : 0;
    const gy = u && d ? (h[o + S] - h[o - S]) / 2 : d ? h[o + S] - h[o] : u ? h[o] - h[o - S] : 0;
    const nv = normalFromGradient(gx, gy);
    if (Math.hypot(P.strength * gx, P.strength * gy) > P.maxTilt) clamped++;
    tiltSum += Math.acos(nv[2]); n++;
    out[o * 3] = Math.round((nv[0] * 0.5 + 0.5) * 255); out[o * 3 + 1] = Math.round((nv[1] * 0.5 + 0.5) * 255); out[o * 3 + 2] = Math.round((nv[2] * 0.5 + 0.5) * 255);
  }
  // pad the islands' normals a few texels (flat beyond) so mip / bilinear taps at seams stay plausible
  const done = Uint8Array.from(cov);
  for (let pass = 0; pass < 6; pass++) {
    const add = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const o = y * S + x; if (done[o]) continue;
      let k = 0, s = [0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= S || yy >= S || !done[yy * S + xx]) continue; k++; for (let c = 0; c < 3; c++) s[c] += out[(yy * S + xx) * 3 + c]; }
      if (k) add.push(o, ...s.map(v => Math.round(v / k)));
    }
    for (let i = 0; i < add.length; i += 4) { out[add[i] * 3] = add[i + 1]; out[add[i] * 3 + 1] = add[i + 2]; out[add[i] * 3 + 2] = add[i + 3]; done[add[i]] = 1; }
  }
  return {rgb: out, stats: {size: S, meanTiltDeg: r4(tiltSum / Math.max(1, n) * 180 / Math.PI), clampedFraction: r4(clamped / Math.max(1, n)), method: P.note}};
}

function roughnessMap(rgb, S) {
  const P = BAKE.roughness, out = Buffer.alloc(S * S * 3);
  let sum = 0, lo = 1, hi = 0;
  for (let i = 0; i < S * S; i++) {
    const r = rgb[i * 3] / 255, g = rgb[i * 3 + 1] / 255, b = rgb[i * 3 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx, s = mx > 0 ? (mx - mn) / mx : 0;
    let hue = 0;
    if (mx > mn) { const d = mx - mn; hue = mx === r ? ((g - b) / d) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60; }
    if (hue > 180) hue -= 360;
    const bone = smoothstep(0.08, 0.2, s) * (1 - smoothstep(25, 40, Math.abs(hue - 5))) * smoothstep(0.45, 0.62, v);
    const slime = smoothstep(0.3, 0.5, s) * smoothstep(30, 42, hue) * (1 - smoothstep(72, 85, hue));
    let rough = P.base + (P.bone - P.base) * bone + (P.slime - P.base) * slime * (1 - bone) + P.dark * (1 - smoothstep(0.12, 0.25, v));
    rough = Math.min(1, Math.max(0.05, rough));
    sum += rough; lo = Math.min(lo, rough); hi = Math.max(hi, rough);
    out[i * 3] = 255; out[i * 3 + 1] = Math.round(rough * 255); out[i * 3 + 2] = 0;
  }
  return {rgb: out, stats: {size: S, channels: 'R 255 (unused), G roughness, B metallic 0', roughnessMean: r4(sum / (S * S)), roughnessMin: r4(lo), roughnessMax: r4(hi), method: P.note}};
}

/**
 * glTF normal-map convention self-check on a synthetic height dome: a flat quad facing +Z with glTF UVs (u -> +X, v -> -Y,
 * image row 0 at the top); the decoded normal on the dome's upper / right flank must tilt toward +Y / +X (away from the peak).
 */
export function checkNormalConvention() {
  const S = 33, h = new Float32Array(S * S), c = 16;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = Math.exp(-((x - c) ** 2 + (y - c) ** 2) / 40);
  const at = (x, y) => normalFromGradient((h[y * S + x + 1] - h[y * S + x - 1]) / 2, (h[(y + 1) * S + x] - h[(y - 1) * S + x]) / 2, 4, 0.9);
  // tangent T = dP/du = +X; glTF bitangent (normal-map +Y) = toward decreasing v = +Y on this quad; N = +Z
  const upper = at(c, c - 5), right = at(c + 5, c), lower = at(c, c + 5), left = at(c - 5, c);
  const ok = upper[1] > 0.1 && Math.abs(upper[0]) < 1e-6 && right[0] > 0.1 && Math.abs(right[1]) < 1e-6 && lower[1] < -0.1 && left[0] < -0.1;
  if (!ok) throw new Error('normal map convention check failed: ' + JSON.stringify({upper, right, lower, left}));
  return {upper, right};
}

async function writeDebug(dir, {imgs, seg, reg, prep, mesh, S, baseRGB, src, cover, nm, mr, s2}) {
  fs.mkdirSync(dir, {recursive: true});
  for (const v of ['front', 'back']) {
    const img = imgs[v], sg = seg[v], W = img.W, H = img.H, o = Buffer.from(img.rgb);
    // segmentation: figure outside the eroded mask tinted red; background tinted blue
    for (let i = 0; i < W * H; i++) {
      if (!sg.mask[i]) { o[i * 3] = o[i * 3] * 0.5; o[i * 3 + 1] = o[i * 3 + 1] * 0.5; o[i * 3 + 2] = Math.min(255, o[i * 3 + 2] * 0.5 + 90); }
      else if (!sg.eroded[i]) { o[i * 3] = 255; o[i * 3 + 1] = 40; o[i * 3 + 2] = 40; }
    }
    await sharp(o, {raw: {width: W, height: H, channels: 3}}).png().toFile(path.join(dir, `seg-${v}.png`));
    // registration: image mask (green) vs projected mesh silhouette (magenta), overlap white-ish; region colours
    const R = reg[v], ws = R.workSil, q = Buffer.alloc(ws.w * ws.h * 3), pal = [[230, 230, 230], [60, 140, 255], [60, 230, 230], [240, 160, 40], [240, 80, 200]];
    for (let i = 0; i < ws.w * ws.h; i++) {
      const a = ws.lab[i] >= 0, b = ws.img[i];
      const c = a && b ? pal[ws.lab[i]] : a ? [255, 0, 255] : b ? [0, 200, 0] : [30, 30, 34];
      q.set(a && b ? c.map(x => x * 0.75) : c, i * 3);
    }
    await sharp(q, {raw: {width: ws.w, height: ws.h, channels: 3}}).png().toFile(path.join(dir, `reg-${v}.png`));
  }
  await sharp(baseRGB, {raw: {width: S, height: S, channels: 3}}).png().toFile(path.join(dir, 'base.png'));
  const cv = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) if (cover[i]) { cv[i * 3] = src[i * 3 + 1]; cv[i * 3 + 1] = src[i * 3]; cv[i * 3 + 2] = src[i * 3 + 2]; } else { cv[i * 3] = cv[i * 3 + 1] = cv[i * 3 + 2] = 20; }
  await sharp(cv, {raw: {width: S, height: S, channels: 3}}).png().toFile(path.join(dir, 'coverage.png'));
  await sharp(nm.rgb, {raw: {width: s2, height: s2, channels: 3}}).png().toFile(path.join(dir, 'normal.png'));
  await sharp(mr.rgb, {raw: {width: s2, height: s2, channels: 3}}).png().toFile(path.join(dir, 'mr.png'));
  void prep; void mesh;
}

/** Internal steps exposed for ad-hoc diagnostics (segmentation / registration inspection without a full build). */
export const _internal = {loadSource, segment, prepMesh, posedMesh, projectView, registerView, edt};
