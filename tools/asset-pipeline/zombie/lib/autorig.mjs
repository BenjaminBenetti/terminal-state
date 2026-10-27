// Generic CPU auto-rig for any A-pose humanoid body source onto the SAME 18-joint skeleton
// (names/hierarchy of skeleton.mjs JOINTS), generalised from the iteration-01 body stage:
//   facing detection (feet extend toward the front) -> scale to the body's target height, feet
//   midpoint at the origin, +Z facing -> weld -> joints from horizontal cross-sections
//   (skeleton.mjs detectSkeleton) -> validation against anthropometric ranges -> meshoptimizer
//   simplify (head/hands importance) -> new UV unwrap -> bake from the source -> skin weights
//   (skin.mjs region/chain weights + masked Laplacian smoothing) -> per-bone girth profile.
import {bounds, weldByPosition} from './mesh.mjs';
import {placeHigh, lowPolyAndBake} from './stage-mesh.mjs';
import {detectSkeleton, JOINTS} from './skeleton.mjs';
import {computeSkinWeights, JOINT_NAMES} from './skin.mjs';
import {V} from './pose.mjs';

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);

/**
 * Which way does the source face? The feet extend forward of the ankles: compare the z centre of
 * the soles (lowest 3% of the height) with the z centre of the lower shins (8-12%). Returns
 * {facing: +1 (+Z) | -1 (-Z), margin} in native units.
 */
export function detectFacing(pos) {
  const b = bounds(pos), H = b.max[1] - b.min[1];
  let sz = 0, sn = 0, hz = 0, hn = 0;
  const z0 = [Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    const h = (pos[i + 1] - b.min[1]) / H;
    if (h < 0.03) { sz += pos[i + 2]; sn++; z0[0] = Math.min(z0[0], pos[i + 2]); z0[1] = Math.max(z0[1], pos[i + 2]); }
    else if (h > 0.08 && h < 0.12) { hz += pos[i + 2]; hn++; }
  }
  if (!sn || !hn) throw new Error('facing: no sole/shin vertices');
  // sole bbox centre is robust to vertex density; compare with the shin centroid
  const sole = (z0[0] + z0[1]) / 2, shin = hz / hn;
  return {facing: sole >= shin ? 1 : -1, margin: +((sole - shin) / H).toFixed(4), method: 'sole bbox z-centre (lowest 3% of height) vs shin centroid (8-12%): toes extend toward the front'};
}

/** Body placement: target height, +Z facing, feet midpoint (bbox centres of the soles) at origin. */
export function placement(master, height, facing) {
  const b = bounds(master.pos);
  const scale = height / (b.max[1] - b.min[1]);
  const L = {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity}, R = {...L};
  const p = master.pos;
  // split the feet about the bbox centre (not native x = 0: sources need not be centred)
  const cx = (b.min[0] + b.max[0]) / 2;
  for (let i = 0; i < p.length; i += 3) {
    if ((p[i + 1] - b.min[1]) * scale > 0.04) continue;
    const s = p[i] > cx ? L : R;
    s.x0 = Math.min(s.x0, p[i]); s.x1 = Math.max(s.x1, p[i]); s.z0 = Math.min(s.z0, p[i + 2]); s.z1 = Math.max(s.z1, p[i + 2]);
  }
  const mx = ((L.x0 + L.x1) / 2 + (R.x0 + R.x1) / 2) / 2, mz = ((L.z0 + L.z1) / 2 + (R.z0 + R.z1) / 2) / 2;
  return {scale, pivot: [mx, b.min[1], mz], flipFacing: facing < 0, offset: [0, 0, 0], nativeBounds: b,
    note: `scaled to ${height} m; ${facing < 0 ? 'source faced -Z: rotated 180 deg about Y' : 'source faced +Z: no rotation'}; feet midpoint (bbox centres of soles below 4 cm) moved to origin`};
}

/** Anthropometric sanity ranges (fractions of height). Returns a list of problems (empty = ok). */
export function validateSkeleton(skel) {
  const J = skel.joints, H = skel.H, out = [];
  const len = (a, b) => V.len(V.sub(J[a], J[b]));
  const chk = (name, v, lo, hi) => { if (!(v >= lo && v <= hi)) out.push(`${name}=${(+v).toFixed(3)} outside [${lo}, ${hi}]`); };
  chk('hipY/H', J.Hips[1] / H, 0.44, 0.58);
  chk('neckY/H', J.Neck[1] / H, 0.78, 0.9);
  chk('shoulderY/H', J.L_UpperArm[1] / H, 0.74, 0.88);
  chk('shoulderHalfWidth/H', J.L_UpperArm[0] / H, 0.07, 0.14);
  chk('upperArm/H', len('L_UpperArm', 'L_Forearm') / H, 0.12, 0.2);
  chk('forearm/H', len('L_Forearm', 'L_Hand') / H, 0.11, 0.19);
  chk('thigh/H', len('L_Thigh', 'L_Shin') / H, 0.17, 0.27);
  chk('shin/H', len('L_Shin', 'L_Foot') / H, 0.17, 0.27);
  chk('ankleY/H', J.L_Foot[1] / H, 0.03, 0.09);
  for (const [n, p] of JOINTS) if (p && !(J[n] && J[n].every(Number.isFinite))) out.push('non-finite joint ' + n);
  return out;
}

export function slimSkeleton(sk) {
  const arms = {}; for (const s of ['L', 'R']) { const {ids, line, ...rest} = sk.arms[s]; arms[s] = rest; }
  return {...sk, arms};
}

export function rigFor(skel) {
  return {joints: skel.joints, ends: skel.ends, cut: skel.cut, wall: skel.wall, crotchY: skel.crotchY, hipY: skel.hipY, neckY: skel.neckY, headY: skel.headY, kneeY: skel.kneeY, ankleY: skel.ankleY};
}

/**
 * Master -> placed, rigged-ready low poly + baked textures. `opts` mirrors build-zombie OPTIONS.body.
 * Returns {skel, placement, low, enc, stats, master, facing, issues}.
 */
export async function bodyStage(master, {heightM, facing: forceFacing, ...O}) {
  const fd = detectFacing(master.pos);
  const facing = forceFacing ?? fd.facing;
  const pl = placement(master, heightM, facing);
  const high = placeHigh(master, pl);
  const welded = weldByPosition(high.pos, high.nrm, high.idx);
  const skel = slimSkeleton(detectSkeleton(welded.pos));
  const issues = validateSkeleton(skel);
  const neckY = skel.neckBaseY;
  const inHand = (p, s) => {
    const a = skel.arms[s];
    const d = (p[0] - a.wrist[0]) * a.dir[0] + (p[1] - a.wrist[1]) * a.dir[1] + (p[2] - a.wrist[2]) * a.dir[2];
    return Math.abs(p[0]) > 0.3 * heightM / 1.78 && (s === 'L' ? p[0] > 0 : p[0] < 0) ? d : -1;
  };
  const importanceOf = p => Math.max(O.importance.head * smooth(neckY - 0.06, neckY + 0.02, p[1]), ...['L', 'R'].map(s => O.importance.hands * smooth(-0.04, 0, inHand(p, s))));
  const faceRegion = (t, c) => {
    if (c[1] > neckY - 0.03) return {region: 1, density: O.density.head};
    if (['L', 'R'].some(s => inHand(c, s) > -0.01)) return {region: 2, density: O.density.hands};
    return {region: 0, density: 1};
  };
  const r = await lowPolyAndBake(high, master, {targetTris: O.targetTris, importanceOf, faceRegion, unwrapOpts: O.unwrap, bakeSize: O.bake.size, bakeOpts: {cage: O.bake.cage, rayBelow: O.bake.rayBelow}, baseSize: O.textures.baseColor, mrSize: O.textures.metallicRoughness, quality: O.textures.jpegQuality});
  const {nativeBounds, ...plRest} = pl;
  return {skel, issues, facing: {...fd, used: facing, forced: forceFacing != null}, placement: {...plRest, nativeBounds}, low: r.low,
    enc: {baseJpg: r.enc.baseJpg, mrJpg: r.enc.mrJpg, basePreview: r.enc.basePreview}, stats: r.stats,
    master: {id: master.id, uploadId: master.uploadId, file: master.file, sha256: master.sha256Verified, bytes: master.bytes, triangles: master.triangles, vertices: master.vertices, material: master.material,
      textures: {baseColor: [master.baseColor.width, master.baseColor.height, master.baseColor.mimeType], metallicRoughness: [master.metallicRoughness.width, master.metallicRoughness.height, master.metallicRoughness.mimeType]}}};
}

/** Copy welded-vertex weights onto UV-split output vertices (identical weights across seams). */
export function spreadWeights(low, sw) {
  const n = low.weldId.length;
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const s = low.weldId[i]; for (let k = 0; k < 4; k++) { joints[i * 4 + k] = sw.joints[s * 4 + k]; weights[i * 4 + k] = sw.weights[s * 4 + k]; } }
  return {joints, weights};
}

export function bodySkin(stage, skinOptions) {
  return computeSkinWeights(stage.low.welded, rigFor(stage.skel), {kind: 'body', ...skinOptions});
}

const LIMBS = [['L_UpperArm', 'L_Forearm'], ['L_Forearm', 'L_Hand'], ['R_UpperArm', 'R_Forearm'], ['R_Forearm', 'R_Hand'],
  ['L_Thigh', 'L_Shin'], ['L_Shin', 'L_Foot'], ['R_Thigh', 'R_Shin'], ['R_Shin', 'R_Foot']];

/**
 * Girth profile used to retarget garments between bodies and to size hit volumes / ragdolls:
 * torso rows (central-cluster width/depth/centre per 1 cm, from detectSkeleton), and per limb bone
 * the median distance of its dominant-weight vertices (t in 0.25..0.75 of the bone) to the bone axis.
 */
export function bodyProfile(skel, welded, sw) {
  const J = skel.joints, P = welded.pos, n = P.length / 3;
  const limb = {};
  for (const [a, b] of LIMBS) {
    const ja = JOINT_NAMES.indexOf(a), A = J[a], B = J[b];
    const d = V.sub(B, A), L = V.len(d), u = V.mul(d, 1 / L);
    const rs = [];
    for (let i = 0; i < n; i++) {
      if (sw.joints[i * 4] !== ja || sw.weights[i * 4] < 0.6) continue;
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], q = V.sub(p, A), t = V.dot(q, u) / L;
      if (t < 0.25 || t > 0.75) continue;
      rs.push(V.len(V.sub(q, V.mul(u, t * L))));
    }
    rs.sort((x, y) => x - y);
    limb[a] = {length: r4(L), radius: rs.length ? r4(rs[rs.length >> 1]) : null, samples: rs.length};
  }
  // symmetrise limb radii (paired average) - the bind pose is symmetric
  for (const s of ['UpperArm', 'Forearm', 'Thigh', 'Shin']) {
    const l = limb['L_' + s].radius, r = limb['R_' + s].radius;
    const m = l && r ? (l + r) / 2 : l || r;
    limb['L_' + s].radius = limb['R_' + s].radius = r4(m);
  }
  // head size: half-width / half-depth of the vertices above the neck base
  let hx = 0, hz0 = Infinity, hz1 = -Infinity;
  for (let i = 0; i < n; i++) if (P[i * 3 + 1] > skel.neckBaseY + 0.06) { hx = Math.max(hx, Math.abs(P[i * 3])); hz0 = Math.min(hz0, P[i * 3 + 2]); hz1 = Math.max(hz1, P[i * 3 + 2]); }
  // torso rows from the skinning's TORSO region only (arms/legs excluded by the flood-fill region
  // classification), robust 3/97% extents per 1 cm: unlike the slice clusters, arms hanging close to
  // the body or webbing/tatters bridging to them do not inflate the torso width
  const step = 0.01, nRows = Math.ceil(skel.H / step) + 1;
  const bins = Array.from({length: nRows}, () => ({x: [], z: []}));
  for (let i = 0; i < n; i++) {
    if (sw.region[i] !== 0) continue;
    const k = Math.floor(P[i * 3 + 1] / step); if (k < 0 || k >= nRows) continue;
    bins[k].x.push(P[i * 3]); bins[k].z.push(P[i * 3 + 2]);
  }
  const pct = (a, q) => a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
  const torsoRows = {y0: 0, step, rows: bins.map(b => {
    if (b.x.length < 12) return null;
    b.x.sort((u, v) => u - v); b.z.sort((u, v) => u - v);
    const x0 = pct(b.x, 0.03), x1 = pct(b.x, 0.97), z0 = pct(b.z, 0.03), z1 = pct(b.z, 0.97);
    return [x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2].map(v => +v.toFixed(4));
  })};
  const rowAt = y => { const T = torsoRows; let k = Math.round((y - T.y0) / T.step); k = Math.max(0, Math.min(T.rows.length - 1, k)); for (let d = 0; d < 30; d++) { if (T.rows[k - d]) return T.rows[k - d]; if (T.rows[k + d]) return T.rows[k + d]; } return null; };
  const chest = rowAt((J.Chest[1] + skel.armpitY) / 2 - 0.03), waist = rowAt(J.Spine[1]), hips = rowAt(skel.hipY);
  return {
    heightM: r4(skel.H),
    landmarks: {ankle: r4(skel.ankleY), knee: r4(J.L_Shin[1]), crotch: r4(skel.crotchY), hip: r4(skel.hipY), spine: r4(J.Spine[1]), chest: r4(J.Chest[1]), armpit: r4(skel.armpitY), neck: r4(skel.neckBaseY), head: r4(J.Head[1]), top: r4(skel.H)},
    limb,
    head: {halfWidth: r4(hx), depth: r4(hz1 - hz0)},
    torso: {chest: chest && {w: chest[0], d: chest[1]}, waist: waist && {w: waist[0], d: waist[1]}, hips: hips && {w: hips[0], d: hips[1]}},
    torsoRows,
    // hit-volume radii for the runtime (metres at actor scale 1): capsule radius ~ mean half extent
    hit: {
      head: r4(Math.max(0.11, Math.min(0.17, 0.5 * (hx + (hz1 - hz0) / 2)))),
      torso: r4(chest ? Math.max(0.15, Math.min(0.3, 0.25 * (chest[0] + chest[1]) * 0.95)) : 0.2),
      arm: r4(Math.max(0.05, Math.min(0.12, ((limb.L_UpperArm.radius ?? 0.05) + (limb.L_Forearm.radius ?? 0.045)) / 2 * 1.35))),
      leg: r4(Math.max(0.07, Math.min(0.15, ((limb.L_Thigh.radius ?? 0.075) + (limb.L_Shin.radius ?? 0.055)) / 2 * 1.4))),
    },
  };
}

/**
 * Iteration 06 (reused scavenger): remove triangles that BRIDGE an arm region and the torso region
 * below the armpit - geometry the AI reconstruction fused between a hanging sleeve and the jacket
 * flank / hip pouches. Under any arm motion those triangles stretch into flat sheets. Operates on
 * both the welded and the UV-split low mesh (same triangle order); vertices stay (unreferenced).
 */
export function trimArmTorsoBridges(low, sw, skel, {below = 0.04} = {}) {
  const R = sw.region, W = low.welded, yMax = skel.armpitY - below;
  const isArm = r => r === 1 || r === 2;
  const keepW = [], keepL = [];
  let removed = 0, mismatch = 0;
  for (let t = 0; t < W.idx.length / 3; t++) {
    const a = W.idx[t * 3], b = W.idx[t * 3 + 1], c = W.idx[t * 3 + 2];
    for (let k = 0; k < 3; k++) if (low.weldId[low.idx[t * 3 + k]] !== W.idx[t * 3 + k]) mismatch++;
    const rs = [R[a], R[b], R[c]];
    const arm = rs.some(isArm), torso = rs.some(r => r === 0), sides = new Set(rs.filter(isArm)).size;
    const y = Math.min(W.pos[a * 3 + 1], W.pos[b * 3 + 1], W.pos[c * 3 + 1]);
    if (((arm && torso) || sides > 1) && y < yMax) { removed++; continue; }
    keepW.push(a, b, c); keepL.push(low.idx[t * 3], low.idx[t * 3 + 1], low.idx[t * 3 + 2]);
  }
  if (mismatch) throw new Error('trimArmTorsoBridges: UV-split and welded triangle orders differ');
  const L = low.idx.constructor, WI = W.idx.constructor;
  return {low: {...low, idx: L.from(keepL), welded: {...W, idx: WI.from(keepW)}}, removed, method: `triangles joining an arm region and the torso region (or both arms) lower than ${below} m below the armpit removed`};
}
