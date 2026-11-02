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
  const relabelled = refineHair(pos, idx, hair);
  const groups = vertexGroups({pos, joints, weights}, names);
  const {remap} = weldMap(pos);
  // arm-group skin that is NOT on the arm's own cylinder (the front armpit fold, the shoulder slope medial of the deltoid) stays part
  // of the fit surface: distance to the arm bones > armOff x the arm's median skin radius (measured on the free upper arm / forearm)
  const armOn = armCylinder(pos, groups, hair, J);
  const skinTris = [], legTris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (v.some(i => hair[i])) continue;
    skinTris.push(...v);
    if (v.every(i => groups[i] === GROUP.leg)) legTris.push(...v);
  }
  const skinIdx = Uint32Array.from(skinTris);
  // hair FUSED onto the skin (a lock lying on a breast / the shoulder, within fusedHair of the closed skin) is part of the body's outer
  // surface the cloth sits on; free-hanging hair (the curtain over the back, locks beside the arms) never is
  const closed = new TriGrid(pos, skinIdx, 0.025);
  const fused = new Uint8Array(pos.length / 3);
  for (let i = 0; i < fused.length; i++) { if (!hair[i] || remap[i] !== i) continue; const c = closed.closest(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 0.006); if (c) fused[i] = 1; }
  for (let i = 0; i < fused.length; i++) fused[i] = fused[remap[i]];
  const fitTris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (v.some(i => hair[i] && !fused[i])) continue;
    if (v.every(i => groups[i] === GROUP.torso || groups[i] === GROUP.leg || (groups[i] === GROUP.arm && !armOn.on[i]))) fitTris.push(...v);
  }
  const fitIdx = Uint32Array.from(fitTris);
  // welded normals over the closed skin + fused hair (the fit surface's own normals at fused locks)
  const nrm = weldedNormals(pos, Uint32Array.from([...skinIdx, ...fitIdx]), remap);
  const facing = bodyFacing(pos, hair, J);
  if (facing.forward[2] !== 1) throw new Error(file + ': body does not face +Z');
  const B = {file, id: ex.id, extras: ex, R, mesh: m, names, J, pos, idx, nrm, joints, weights, hair, groups, remap, skinIdx, fitIdx, legIdx: Uint32Array.from(legTris),
    nTris: idx.length / 3, geometryHash: ex.geometryHash, skinVertices: sk.skinVertices, hairIslandsRelabelled: relabelled, facing};
  B.fitGrid = new TriGrid(pos, fitIdx, 0.025);
  B.skinGrid = closed;
  B.fused = fused;
  B.landmarks = measureLandmarks(B);
  return B;
}


/**
 * Hair mask refinement. The geometric test (open sheets) misses hair strands lying close over the skin (Gaze / Revenant: locks over
 * the shoulders and chest sides) and flags small patches of real skin under such locks. Strands are OPEN sheets: every vertex within
 * one ring of a boundary / non-manifold edge (welded) is hair; then hair-labelled islands that are small, contain no such vertex and
 * are bordered by skin are real skin (relabelled). Returns {strandVertices, relabelled}.
 */
function refineHair(pos, idx, hair, maxIsland = 60) {
  const {remap} = weldMap(pos);
  const n = pos.length / 3, adj = new Map(), E = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = remap[idx[t + k]], b = remap[idx[t + (k + 1) % 3]]; if (a === b) continue;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)).add(a);
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a; E.set(key, (E.get(key) ?? 0) + 1);
  }
  const bnd = new Uint8Array(n);
  for (const [key, c] of E) if (c !== 2) { bnd[Math.floor(key / 4294967296)] = 1; bnd[key % 4294967296] = 1; }
  const near = bnd.slice();
  for (let v = 0; v < n; v++) if (bnd[v]) for (const w of adj.get(v) ?? []) near[w] = 1;
  let strand = 0;
  for (let v = 0; v < n; v++) if (remap[v] === v && near[v] && !hair[v]) { hair[v] = 1; strand++; }
  const seen = new Uint8Array(n); let relabelled = 0;
  for (let i = 0; i < n; i++) {
    const r = remap[i]; if (r !== i || !hair[r] || seen[r]) continue;
    const island = [], stack = [r]; seen[r] = 1; let skinBorder = 0, open = 0;
    while (stack.length) { const v = stack.pop(); island.push(v); if (near[v]) open++; for (const w of adj.get(v) ?? []) { if (hair[w]) { if (!seen[w]) { seen[w] = 1; stack.push(w); } } else skinBorder++; } }
    if (island.length <= maxIsland && skinBorder > 0 && !open) { for (const v of island) hair[v] = 0; relabelled += island.length; }
  }
  for (let i = 0; i < n; i++) hair[i] = hair[remap[i]];
  return {strandVertices: strand, relabelled};
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
    // only the shoulder / armpit-fold skin (above the upper-arm joint - 15 cm) may count as off the arm; forearms / hands never
    // only shoulder / armpit-fold skin MEDIAL of the shoulder joint (and above it - 15 cm) may count as off the arm (the Siren rule);
    // the upper arm / forearm / hand never
    for (let i = 0; i < n; i++) if (groups[i] === 2 && Math.sign(pos[i * 3]) === sg) on[i] = d[i] < armOff * r || pos[i * 3 + 1] < U[1] - 0.15 || Math.abs(pos[i * 3]) > Math.abs(U[0]) ? 1 : 0;
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
  // breast apices: the front profile z(x, y) of the fit surface (rays along -Z, 5 mm grid over the bust band) and its vertical
  // prominence p = z(y) - (z(y + 5 cm) + z(y - 6 cm)) / 2: the breast mound stands out of the profile even where the belly / rib
  // cage reaches as far forward (Apparition); per side the centroid of the cells within 3 mm of the best prominence (2 cm around
  // it); the score adds the forwardness z itself (the nipple is both the most prominent and the most forward point of the mound),
  // then made symmetric
  const rawApex = {};
  const zf = (x, y) => { const h = B.fitGrid.ray(x, y, 0.6, 0, 0, -1, 1.2); return h ? 0.6 - h.t : null; };
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const cells = [];
    // the front of the chest only: medial of the arm (|x| <= 11 cm), every sample on the front half and the profile continuous
    const zc = J.Chest[2];
    for (let x = 0.025; x <= 0.11 + 1e-9; x += 0.005) for (let y = J.Chest[1] - 0.16; y <= J.Neck[1] - 0.06 + 1e-9; y += 0.005) {
      const z = zf(s * x, y), za = zf(s * x, y + 0.05), zb = zf(s * x, y - 0.06);
      if (z == null || za == null || zb == null || za < zc || zb < zc || Math.abs(z - za) > 0.06 || Math.abs(z - zb) > 0.06) continue;
      cells.push([s * x, y, z, z - (za + zb) / 2 + z]); // score: prominence + forwardness
    }
    const best = cells.reduce((a, c) => (c[3] > a[3] ? c : a));
    const cap = cells.filter(c => c[3] > best[3] - 0.003 && Math.hypot(c[0] - best[0], c[1] - best[1]) < 0.02);
    rawApex[side] = [0, 1, 2].map(k => cap.reduce((a, c) => a + c[k], 0) / cap.length);
    rawApex[side].prominence = best[3];
  }
  const mx = (Math.abs(rawApex.L[0]) + Math.abs(rawApex.R[0])) / 2, my = (rawApex.L[1] + rawApex.R[1]) / 2, mz = (rawApex.L[2] + rawApex.R[2]) / 2;
  const apex = {L: [mx, my, mz], R: [-mx, my, mz]};
  const apexY = (apex.L[1] + apex.R[1]) / 2, apexX = (apex.L[0] - apex.R[0]) / 2, apexZ = (apex.L[2] + apex.R[2]) / 2;
  // crotch (perineum): scanning down the midline (x = 0) from 8 cm above the hip joint, the front (+Z) and back (-Z) skin both exist
  // above it and close in on each other; the crotch is the last row before the midline first leaves the body (thighs apart) or the
  // front-back depth collapses below 1 cm (touching thighs: the crease below is not the crotch)
  let crotch = null;
  for (let y = J.Hips[1] + 0.08; y > J.Hips[1] - 0.25; y -= 0.0025) {
    const hf = B.fitGrid.ray(0, y, 0.6, 0, 0, -1, 1.2), hb = B.fitGrid.ray(0, y, -0.6, 0, 0, 1, 1.2);
    if (!hf || !hb) break;
    const zf = 0.6 - hf.t, zb = -0.6 + hb.t;
    if (zf - zb < 0.01) break;
    crotch = [0, y, (zf + zb) / 2];
  }
  if (!crotch) throw new Error(B.id + ': no midline crotch');
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
  // a 15k-triangle body has 1-2 cm vertex rows: each bin takes the union of the raw bins within +-1 cm
  const raw = prof.map(b => ({...b, legs: {L: {...b.legs.L}, R: {...b.legs.R}}}));
  for (let j = 0; j < NY; j++) {
    const b = prof[j];
    for (let d = -2; d <= 2; d++) { const k = j + d; if (k < 0 || k >= NY || !d) continue; const r = raw[k];
      b.xMin = Math.min(b.xMin, r.xMin); b.xMax = Math.max(b.xMax, r.xMax); b.zMin = Math.min(b.zMin, r.zMin); b.zMax = Math.max(b.zMax, r.zMax);
      for (const s of ['L', 'R']) { const L = b.legs[s], R = r.legs[s]; L.xMin = Math.min(L.xMin, R.xMin); L.xMax = Math.max(L.xMax, R.xMax); L.zMin = Math.min(L.zMin, R.zMin); L.zMax = Math.max(L.zMax, R.zMax); } }
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
  return {apex, rawApex: {L: rawApex.L.map(r4), R: rawApex.R.map(r4), prominenceMM: [r4(rawApex.L.prominence * 1000), r4(rawApex.R.prominence * 1000)]}, apexX: r4(apexX), apexY: r4(apexY), apexZ: r4(apexZ), crotch: crotch.map(r4), foldY: r4(fold[0]), waistY: r4(waist.y), waistHalfWidth: r4(waist.w / 2), hipY: r4(hip.y), hipHalfWidth: r4(hip.w / 2),
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
