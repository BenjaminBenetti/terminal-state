// Task studio-beta-mall-lingerie-20261102-221554-01 (lane FIT): a WRITTEN wardrobe body GLB (zombie-body-<id>-t25.glb: 18 joints,
// identity bind rotations, IBM = T(-J), six clips) read for lingerie fitting. Read-only: nothing here changes the body.
//  - bind mesh = the GLB's own POSITION (the skin's bind pose; spec-checked against CPU skinning at load);
//  - hair = NOT closed skin (enemy/lib/garment-metrics.mjs skinMask: hair strands are open sheets), excluded from every surface the
//    cloth is fitted / anchored to (long hair hangs over the back and shoulders of the pale bodies);
//  - groups (dominant joint group per vertex): torso / head / arm / leg;
//  - FIT surface = closed skin, torso + leg groups (no head, no arm: straps sit medially on the trapezius, never on the deltoid);
//  - landmarks measured on the mesh (never assumed): breast apices, inframammary fold, waist, widest hip, crotch, shoulder crest,
//    torso / leg cross-section profiles (5 mm bins).
import {loadRigged, jointWorld, skinMesh} from '../../enemy/lib/siren-glb.mjs';
import {skinMask, vertexGroups, bodyFacing} from '../../enemy/lib/garment-metrics.mjs';
import {TriGrid, weldMap, weldedNormals, closestOnTri} from './penetration.mjs';

const r4 = v => +(+v).toFixed(4);
export const GROUP = {torso: 0, head: 1, arm: 2, leg: 3};

export async function loadBody(file) {
  const R = await loadRigged(file);
  const m = R.meshes.find(x => x.name === 'ZombieBody');
  if (!m) throw new Error(file + ': no ZombieBody');
  const ex = R.extras.zombieBody;
  if (!ex?.geometryHash) throw new Error(file + ': no zombieBody.geometryHash');
  const W0 = jointWorld(R, null);
  const bind = skinMesh(m, W0, true);
  let maxErr = 0;
  for (let i = 0; i < m.pos.length; i++) maxErr = Math.max(maxErr, Math.abs(bind.pos[i] - m.pos[i]));
  if (maxErr > 1e-5) throw new Error(`${file}: bind pose != POSITION (${maxErr})`);
  const pos = Float32Array.from(m.pos), idx = Uint32Array.from(m.idx);
  const weights = Float32Array.from(m.weights, v => m.weightsNormalized ? v / 255 : v), joints = Uint8Array.from(m.joints);
  const names = R.names;
  const J = Object.fromEntries(names.map((nm, j) => [nm, [W0[j][12], W0[j][13], W0[j][14]]]));
  const sk = skinMask(pos, idx);
  const hair = Uint8Array.from(sk.skin, v => 1 - v);
  const groups = vertexGroups({pos, joints, weights}, names);
  const {remap} = weldMap(pos);
  // arm-group skin that is NOT on the arm's own cylinder (the front armpit fold, the shoulder slope medial of the deltoid) stays part
  // of the fit surface: distance to the arm bones > armOff x the arm's median skin radius (measured on the free upper arm / forearm)
  const armOn = armCylinder(pos, groups, hair, J);
  const skinTris = [], fitTris = [], legTris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (v.some(i => hair[i])) continue;
    skinTris.push(...v);
    if (v.every(i => groups[i] === GROUP.torso || groups[i] === GROUP.leg || (groups[i] === GROUP.arm && !armOn.on[i]))) fitTris.push(...v);
    if (v.every(i => groups[i] === GROUP.leg)) legTris.push(...v);
  }
  const skinIdx = Uint32Array.from(skinTris), fitIdx = Uint32Array.from(fitTris);
  const nrm = weldedNormals(pos, skinIdx, remap);
  const facing = bodyFacing(pos, hair, J);
  if (facing.forward[2] !== 1) throw new Error(file + ': body does not face +Z');
  const B = {file, id: ex.id, extras: ex, R, mesh: m, names, J, pos, idx, nrm, joints, weights, hair, groups, remap, skinIdx, fitIdx, legIdx: Uint32Array.from(legTris),
    nTris: idx.length / 3, geometryHash: ex.geometryHash, skinVertices: sk.skinVertices, facing};
  B.fitGrid = new TriGrid(pos, fitIdx, 0.025);
  B.skinGrid = new TriGrid(pos, skinIdx, 0.025);
  B.landmarks = measureLandmarks(B);
  return B;
}

const segD = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]; const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2))); return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]); };
/** Arm-group vertices ON the arm cylinder (distance to the UpperArm-Forearm-Hand bones < armOff x median radius). */
export function armCylinder(pos, groups, hair, J, armOff = 1.3) {
  const n = pos.length / 3, d = new Float32Array(n), on = new Uint8Array(n), radius = {};
  for (const [side, sg] of [['L', 1], ['R', -1]]) {
    const U = J[side + '_UpperArm'], F = J[side + '_Forearm'], H = J[side + '_Hand'];
    const ds = [];
    for (let i = 0; i < n; i++) {
      if (groups[i] !== 2 || hair[i] || Math.sign(pos[i * 3]) !== sg) continue;
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      d[i] = Math.min(segD(p, U, F), segD(p, F, H));
      if (p[1] < U[1] - 0.08) ds.push(d[i]); // the free arm below the armpit
    }
    ds.sort((a, b) => a - b);
    const r = ds.length ? ds[Math.floor(ds.length / 2)] : 0.04;
    radius[side] = r;
    for (let i = 0; i < n; i++) if (groups[i] === 2 && Math.sign(pos[i * 3]) === sg) on[i] = d[i] < armOff * r ? 1 : 0;
  }
  return {on, radius};
}

/** Closest point on a body triangle set + interpolated (welded) normal + barycentrics. */
export function closestOn(B, grid, idx, p, maxR = 0.12, nrm = B.nrm) {
  const c = grid.closest(p[0], p[1], p[2], maxR);
  if (!c) return null;
  const a = idx[c.tri * 3], b = idx[c.tri * 3 + 1], e = idx[c.tri * 3 + 2];
  const cp = closestOnTri(p, grid.pos, a * 3, b * 3, e * 3);
  let n = [0, 1, 2].map(k => cp[3] * nrm[a * 3 + k] + cp[4] * nrm[b * 3 + k] + cp[5] * nrm[e * 3 + k]);
  const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
  const sd = (p[0] - cp[0]) * n[0] + (p[1] - cp[1]) * n[1] + (p[2] - cp[2]) * n[2];
  return {q: [cp[0], cp[1], cp[2]], n, d: c.d, sd: sd < 0 ? -c.d : c.d, tri: c.tri, v: [a, b, e], bary: [cp[3], cp[4], cp[5]]};
}

/**
 * Landmarks of the bind body (metres, +Y up, front +Z, wearer's left = +X). Fit-surface vertices only (closed skin, torso / leg).
 */
export function measureLandmarks(B) {
  const {pos: P, J} = B;
  const fitV = new Uint8Array(P.length / 3);
  for (const v of B.fitIdx) fitV[v] = 1;
  const n = P.length / 3;
  // breast apices: most forward fit vertex per side in the bust band
  const apex = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (!fitV[i]) continue;
      const x = P[i * 3] * s, y = P[i * 3 + 1];
      if (x < 0.025 || x > 0.17 || y < J.Chest[1] - 0.14 || y > J.Neck[1] - 0.05) continue;
      if (best < 0 || P[i * 3 + 2] > P[best * 3 + 2]) best = i;
    }
    apex[side] = [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]];
  }
  const apexY = (apex.L[1] + apex.R[1]) / 2, apexX = (apex.L[0] - apex.R[0]) / 2, apexZ = (apex.L[2] + apex.R[2]) / 2;
  // crotch: the lowest midline (|x| < 12 mm) fit vertex within 25 cm below the hip joint (the inner thighs of an A-pose body meet in
  // a V crease up to the perineum, so a vertical midline ray slides up the crease: the lowest midline vertex is the crotch)
  let crotch = null;
  for (let i = 0; i < n; i++) {
    if (!fitV[i] || Math.abs(P[i * 3]) > 0.012) continue;
    const y = P[i * 3 + 1]; if (y < J.Hips[1] - 0.25 || y > J.Hips[1]) continue;
    if (!crotch || y < crotch[1]) crotch = [0, y, P[i * 3 + 2]];
  }
  if (!crotch) throw new Error(B.id + ': no midline crotch vertex');
  // cross-section profile per 5 mm bin of the fit surface: torso (above the crotch: both sides) / per leg (below)
  const Y0 = Math.max(0.3, crotch[1] - 0.35), Y1 = J.Neck[1] + 0.06, YS = 0.005, NY = Math.round((Y1 - Y0) / YS) + 1;
  const prof = Array.from({length: NY}, (_, j) => ({y: Y0 + j * YS, xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity, legs: {L: {xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity}, R: {xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity}}}));
  for (let i = 0; i < n; i++) {
    if (!fitV[i]) continue;
    const y = P[i * 3 + 1], j = Math.round((y - Y0) / YS); if (j < 0 || j >= NY) continue;
    const x = P[i * 3], z = P[i * 3 + 2], b = prof[j];
    b.xMin = Math.min(b.xMin, x); b.xMax = Math.max(b.xMax, x); b.zMin = Math.min(b.zMin, z); b.zMax = Math.max(b.zMax, z);
    const L = b.legs[x >= 0 ? 'L' : 'R']; L.xMin = Math.min(L.xMin, x); L.xMax = Math.max(L.xMax, x); L.zMin = Math.min(L.zMin, z); L.zMax = Math.max(L.zMax, z);
  }
  const at = y => prof[Math.max(0, Math.min(NY - 1, Math.round((y - Y0) / YS)))];
  // inframammary fold: below the apex, along the apex column, the front z minimum before the belly (search 2-12 cm below)
  const frontAt = (x, y) => { const h = B.fitGrid.ray(x, y, 0.6, 0, 0, -1, 1.0); return h ? 0.6 - h.t : null; };
  let fold = null;
  for (let d = 0.02; d <= 0.12; d += 0.0025) { const z = frontAt(apexX * 0.9, apexY - d); if (z != null && (!fold || z < fold[1])) fold = [apexY - d, z]; }
  // waist: narrowest torso width between the fold and the hip joint (+3 cm)
  let waist = null;
  for (let y = J.Hips[1] + 0.03; y <= fold[0] - 0.02; y += YS) { const b = at(y); const w = b.xMax - b.xMin; if (Number.isFinite(w) && (!waist || w < waist.w)) waist = {y, w}; }
  // widest hip between the crotch and the hip joint
  let hip = null;
  for (let y = crotch[1]; y <= J.Hips[1] + 0.02; y += YS) { const b = at(y); const w = b.xMax - b.xMin; if (Number.isFinite(w) && (!hip || w > hip.w)) hip = {y, w}; }
  // shoulder crest at the strap line: |x| = 0.72 x the shoulder joint's |x| (medial on the trapezius)
  const strapX = 0.72 * Math.abs(J.L_UpperArm[0]);
  const crest = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    let top = null;
    for (const z of [J.Neck[2] - 0.01, J.Neck[2], J.Neck[2] + 0.01, J.Neck[2] + 0.02]) { const h = B.fitGrid.ray(s * strapX, J.Neck[1] + 0.3, z, 0, -1, 0, 0.5); if (h) { const y = J.Neck[1] + 0.3 - h.t; if (!top || y > top[1]) top = [s * strapX, y, z]; } }
    crest[side] = top;
  }
  return {apex, apexX: r4(apexX), apexY: r4(apexY), apexZ: r4(apexZ), crotch: crotch.map(r4), foldY: r4(fold[0]), waistY: r4(waist.y), waistHalfWidth: r4(waist.w / 2), hipY: r4(hip.y), hipHalfWidth: r4(hip.w / 2),
    strapX: r4(strapX), crest, profile: {Y0, YS, NY, at, bins: prof}};
}

function mul4(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }

/** Skinning matrices (JointWorld x IBM, column-major) of the body's skin for a clip time (rest pose: clip null). */
export function skinMats(B, clip = null, t = 0) {
  const W = jointWorld(B.R, clip, t), ibm = B.mesh.ibm;
  return B.mesh.skinJoints.map((j, k) => mul4(W[B.R.joints.indexOf(j)], Array.from(ibm.subarray(k * 16, k * 16 + 16))));
}

/** Clip durations of the body GLB (s). */
export function clipDurations(B) {
  return Object.fromEntries(B.R.anims.map(a => [a.getName(), Math.max(...a.listSamplers().map(s => { const T = s.getInput().getArray(); return T[T.length - 1]; }))]));
}

/** Validation poses: every `step` s of every clip (30 fps: 0.1 s = every 3rd frame) plus the clip's last frame. */
export function validationPoses(B, {step = 0.1, clips = null} = {}) {
  const out = [];
  for (const [clip, dur] of Object.entries(clipDurations(B))) {
    if (clips && !clips.includes(clip)) continue;
    const ts = []; for (let t = 0; t < dur - 1e-6; t += step) ts.push(+t.toFixed(4)); ts.push(+dur.toFixed(4));
    for (const t of ts) out.push({clip, t, mats: skinMats(B, clip, t)});
  }
  return out;
}
