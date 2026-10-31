// Task siren-clothing-refit-20261031 (lane FIT): garment-fit measurements for the Siren dress on the UNCHANGED Siren body, in the
// bind pose and in sampled frames of the actual clips (CPU glTF skinning of a WRITTEN GLB: lib/siren-glb.mjs loadRigged / jointWorld
// / skinMesh). Used for the before (main's asset) / after (candidate) comparison; nothing here changes any asset.
//
// Conventions (verified on the geometry by `bodyFacing`, never from names): metres, +Y up, the body faces +Z (nose, toes and breast
// apices are the +Z extremes), so the wearer's anatomical RIGHT is -X (right = forward x up = (0,0,1) x (0,1,0) = (-1,0,0)).
//
// Definitions (per frame, posed body + posed dress):
//  - signed distance of a dress vertex: distance to the closest point on the closed-SKIN body surface (`skinMask`: hair strands are
//    open sheets with no inside and are excluded), sign from the interpolated (welded, area-weighted) body normal at that point: < 0 = the cloth vertex is
//    inside the body (hidden, "crammed in"). Searched within `maxR`; farther = "far" (reported as > maxR).
//  - penetration: signed distance < -tol (tol 3 mm: the body's chord error on its sparse triangles is a few mm); depth buckets
//    > 3 / 10 / 25 mm; counted on WELDED dress vertices (UV-seam duplicates once); split by dress region and by the body region of
//    the closest point (torso / arm / leg / head) — an arm pressed into the torso is a body-animation property, reported apart.
//    The skin has holes where hair is fused to it; a negative sign is only kept when ray parity (6 axis rays, majority) agrees.
//  - floating: gap (signed distance > 0) of FITTED dress regions (strap / cup / band / waist) above per-region thresholds; open
//    edges (neckline, tear, hem: boundary vertices + 2 rings) are reported separately because free edges may lift.
//  - coverage: a breast vertex (anatomical sets from the bind geometry) is covered when the ray along its posed outward normal
//    meets the dress within `coverDist` (6 cm); the fraction per breast and in the apex zone (3 cm). Cloth INSIDE the breast does
//    not cover it (skin shows through) — the ray test makes that explicit.
//  - skin through: torso / leg skin vertices covered by the dress in the bind pose (outward ray meets it within 8 cm) whose posed
//    outward ray no longer meets it — skin showing through / out of the cloth (per asset: its own bind coverage).
//  - floor: lowest dress point, dress vertices below -5 mm (sink depth).
// Dress regions are defined on the SOURCE dress's own native frame (see `dressRegions`), so before / after use identical masks.
import {TriGrid, weldMap, weldedNormals, insideByParity} from '../../zombie/lib/penetration.mjs';
import {components} from '../../zombie/lib/mesh.mjs';
import {jointWorld, skinMesh} from './siren-glb.mjs';

export const JOINT_GROUPS = {torso: ['Root', 'Hips', 'Spine', 'Chest', 'Neck'], head: ['Head'], arm: ['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand'], leg: ['L_Thigh', 'L_Shin', 'L_Foot', 'R_Thigh', 'R_Shin', 'R_Foot']};
const GROUP_NAMES = Object.keys(JOINT_GROUPS);
export const DRESS_REGIONS = ['strap', 'cup', 'band', 'waist', 'hip', 'skirt'];
/** Floating thresholds (m) for fitted regions: a gap above this between cloth and skin reads as a shell / loose strap. */
export const FLOAT_THRESHOLD = {strap: 0.012, cup: 0.02, band: 0.02, waist: 0.035};
const r4 = v => +(+v).toFixed(4), mm = v => +(v * 1000).toFixed(1);

/** Per-vertex dominant joint group (torso / head / arm / leg) from a mesh's JOINTS_0 / WEIGHTS_0 and joint names. */
export function vertexGroups(m, names) {
  const n = m.pos.length / 3, out = new Uint8Array(n);
  const gOf = names.map(nm => GROUP_NAMES.findIndex(g => JOINT_GROUPS[g].includes(nm)));
  for (let i = 0; i < n; i++) {
    const acc = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) { const w = m.weights[i * 4 + k]; if (w) acc[gOf[m.joints[i * 4 + k]]] += w; }
    out[i] = acc.indexOf(Math.max(...acc));
  }
  return out;
}

/**
 * The body's facing from the bind geometry (non-hair): nose vs back of the head, toes vs heels about the ankle joints, breast apices
 * vs the back. Returns the evidence numbers and the derived axis convention.
 */
export function bodyFacing(P, hair, joints) {
  const n = P.length / 3;
  // z extents (non-hair) of a height band, relative to a joint's z: the face / bust protrude much farther forward than backward
  const band = (y0, y1, jz) => {
    let zMin = Infinity, zMax = -Infinity, at = null;
    for (let i = 0; i < n; i++) { if (hair[i]) continue; const y = P[i * 3 + 1]; if (y < y0 || y > y1 || Math.abs(P[i * 3]) > 0.2) continue; const z = P[i * 3 + 2]; if (z > zMax) { zMax = z; at = i; } zMin = Math.min(zMin, z); }
    return {plusZ: r4(zMax - jz), minusZ: r4(jz - zMin), plusZAt: [r4(P[at * 3]), r4(P[at * 3 + 1]), r4(P[at * 3 + 2])]};
  };
  const head = band(joints.Head[1] - 0.02, joints.Head[1] + 0.06, joints.Head[2]);
  const bust = band(joints.Chest[1], joints.Neck[1] - 0.05, joints.Chest[2]);
  const feet = {};
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < n; i++) if (P[i * 3 + 1] < 0.04 && Math.sign(P[i * 3]) === s) { zMin = Math.min(zMin, P[i * 3 + 2]); zMax = Math.max(zMax, P[i * 3 + 2]); }
    const az = joints[side + '_Foot'][2];
    feet[side] = {plusZ: r4(zMax - az), minusZ: r4(az - zMin)};
  }
  const votes = [head, bust, feet.L, feet.R].map(e => (e.plusZ > e.minusZ ? 1 : -1));
  const sum = votes.reduce((a, b) => a + b, 0);
  if (Math.abs(sum) < 4) throw new Error('body facing is ambiguous: ' + JSON.stringify({head, bust, feet}));
  const forwardZ = Math.sign(sum);
  return {forward: [0, 0, forwardZ], up: [0, 1, 0], wearerRight: [-forwardZ, 0, 0], wearerLeft: [forwardZ, 0, 0],
    evidence: {headFaceVsBackOfHeadM: head, bustVsBackM: bust, feetToeVsHeelM: feet, note: 'distances of the +Z / -Z extremes from the Head / Chest / Foot joint z; all four agree'},
    rule: 'right-handed glTF frame, +Y up; forward = the side the face, bust and toes protrude to; wearer\'s right = forward x up'};
}

/**
 * Anatomical breast vertex sets (bind, non-hair, native body vertex ids): apex = the most forward vertex per side in the bust band
 * (|x| 0.02-0.16 m, y 1.10-1.36 m); the breast = vertices within 8.5 cm of the apex in x / y, at most 6 cm behind its depth and
 * facing forward (normal z > 0), on that side of the midline. side 'R' = wearer's right (x < 0 when facing +Z).
 */
export function breastSets(P, N, hair, facing) {
  const n = P.length / 3, f = facing.forward[2], out = {};
  for (const [side, sx] of [['R', facing.wearerRight[0]], ['L', facing.wearerLeft[0]]]) {
    let apex = -1;
    for (let i = 0; i < n; i++) {
      if (hair[i]) continue;
      const x = P[i * 3] * sx, y = P[i * 3 + 1];
      if (x < 0.02 || x > 0.16 || y < 1.10 || y > 1.36) continue;
      if (apex < 0 || P[i * 3 + 2] * f > P[apex * 3 + 2] * f) apex = i;
    }
    const A = [P[apex * 3], P[apex * 3 + 1], P[apex * 3 + 2]];
    const ids = [], apexZone = [];
    for (let i = 0; i < n; i++) {
      if (hair[i] || P[i * 3] * sx < 0.004 || N[i * 3 + 2] * f <= 0) continue;
      if (Math.hypot(P[i * 3] - A[0], P[i * 3 + 1] - A[1]) > 0.085 || (A[2] - P[i * 3 + 2]) * f > 0.06) continue;
      ids.push(i);
      if (Math.hypot(P[i * 3] - A[0], P[i * 3 + 1] - A[1], P[i * 3 + 2] - A[2]) < 0.03) apexZone.push(i);
    }
    out[side] = {apex: A.map(r4), ids: Uint32Array.from(ids), apexZone: Uint32Array.from(apexZone)};
  }
  return out;
}

/**
 * Dress regions on the SOURCE dress (native frame of the supplied GhostDress, y up, its strap on -X, front +Z): measured landmarks
 * (lane FIT notes): strap top 0.474, strap bases ~0.335-0.35, bodice (cup) top edge 0.25-0.35, empire (under-bust) seam ~0.165-0.20,
 * left-side tear bottom ~-0.12, ruffle-tier seam ~-0.18, hem ~-0.40 (fringe to -0.466).
 *   strap  y > 0.335 and x < -0.05      cup   0.20 < y (not strap)          band  0.14 < y <= 0.20 (under-bust seam)
 *   waist  -0.02 < y <= 0.14            hip   -0.18 < y <= -0.02            skirt y <= -0.18 (ruffle tier, hem, fringe)
 * Plus `edge`: open-boundary vertices (neckline, tear, armhole, hem) and two rings around them (free edges may lift).
 */
export function dressRegions(nativePos, idx) {
  const n = nativePos.length / 3, region = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = nativePos[i * 3], y = nativePos[i * 3 + 1];
    region[i] = y > 0.335 && x < -0.05 ? 0 : y > 0.20 ? 1 : y > 0.14 ? 2 : y > -0.02 ? 3 : y > -0.18 ? 4 : 5;
  }
  const {remap} = weldMap(nativePos);
  const E = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = remap[idx[t + k]], b = remap[idx[t + (k + 1) % 3]]; if (a === b) continue;
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a; E.set(key, (E.get(key) ?? 0) + 1);
  }
  let edge = new Uint8Array(n);
  for (const [key, c] of E) if (c === 1) { edge[Math.floor(key / 4294967296)] = 1; edge[key % 4294967296] = 1; }
  for (let ring = 0; ring < 2; ring++) {
    const next = edge.slice();
    for (let t = 0; t < idx.length; t += 3) {
      const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
      if (edge[a] || edge[b] || edge[c]) { next[a] = next[b] = next[c] = 1; }
    }
    edge = next;
  }
  for (let i = 0; i < n; i++) edge[i] = edge[remap[i]];
  const comp = components(n, idx);
  return {region, edge, remap, names: DRESS_REGIONS, componentCount: comp.sizes.size};
}

/**
 * Closed-skin mask of the body (1 = skin): from 1 mm inside each welded vertex a ray along -normal must first meet the body from
 * INSIDE (the hit triangle's winding normal points along the ray) — true for every part of the closed figure (torso, limbs,
 * fingers, nipples), false for the hair: open strands / sheets (the ray escapes or meets the skin from outside). The supplied
 * texture's dark-hair luminance mask misses the lighter strand tips hanging over the back; this geometric test does not.
 * Winding is checked by majority (flipped if the mesh is inward-wound). Returns {skin, flipped, skinVertices}.
 */
export function skinMask(P, idx) {
  const {remap, uniq} = weldMap(P);
  const N = weldedNormals(P, idx, remap);
  const grid = new TriGrid(P, idx, 0.03);
  const test = sign => {
    const out = new Uint8Array(P.length / 3);
    for (const i of uniq) {
      const dx = -sign * N[i * 3], dy = -sign * N[i * 3 + 1], dz = -sign * N[i * 3 + 2];
      const h = grid.ray(P[i * 3] + dx * 0.001, P[i * 3 + 1] + dy * 0.001, P[i * 3 + 2] + dz * 0.001, dx, dy, dz, 1.0, 0.0002);
      if (!h) continue;
      const a = idx[h.tri * 3] * 3, b = idx[h.tri * 3 + 1] * 3, c = idx[h.tri * 3 + 2] * 3;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (sign * (fn[0] * dx + fn[1] * dy + fn[2] * dz) > 0) out[i] = 1;
    }
    for (let i = 0; i < out.length; i++) out[i] = out[remap[i]];
    return out;
  };
  let skin = test(1), flipped = false;
  const count = m => m.reduce((s, v) => s + v, 0);
  if (count(skin) < 0.3 * skin.length) { const alt = test(-1); if (count(alt) > count(skin)) { skin = alt; flipped = true; } }
  return {skin, flipped, skinVertices: count(skin)};
}

/** Representative (welded) vertex ids of a position array: one per exact position. */
const uniqueIds = pos => weldMap(pos).uniq;

function quantiles(arr, qs) { if (!arr.length) return qs.map(() => null); const s = Float64Array.from(arr).sort(); return qs.map(q => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]); }

/**
 * Static context for a rigged Siren GLB (loadRigged result) + its analysis inputs.
 * @param R loadRigged(glb)
 * @param a {dressNative: source dress POSITION (native frame)}; the body's hair (non-skin) mask is geometric (`skinMask`, bind)
 */
export function prepareFit(R, {dressNative}) {
  const body = R.meshes.find(m => m.name === 'SirenBody'), dress = R.meshes.find(m => m.name === 'SirenDress');
  if (!body || !dress) throw new Error('expected SirenBody + SirenDress');
  if (dressNative && dress.pos.length !== dressNative.length) throw new Error('dress vertex count differs from the source (topology changed)');
  const W0 = jointWorld(R, null);
  const bind = skinMesh(body, W0, true);
  const sk = skinMask(bind.pos, body.idx);
  const hair = Uint8Array.from(sk.skin, v => 1 - v);
  const bodyRemap = weldMap(bind.pos).remap;
  // skin-only triangles (all three vertices closed skin): hair-root triangles would pollute normals / closest points
  const nonHairIdx = [];
  for (let t = 0; t < body.idx.length; t += 3) if (!hair[body.idx[t]] && !hair[body.idx[t + 1]] && !hair[body.idx[t + 2]]) nonHairIdx.push(body.idx[t], body.idx[t + 1], body.idx[t + 2]);
  const skinIdx = Uint32Array.from(nonHairIdx);
  const bodyN = weldedNormals(bind.pos, skinIdx, bodyRemap);
  // winding sanity: the welded normals must point outward (breast / nose forward); flip the convention otherwise
  const joints = Object.fromEntries(R.names.map((nm, j) => [nm, [W0[j][12], W0[j][13], W0[j][14]]]));
  const facing = bodyFacing(bind.pos, hair, joints);
  const groups = vertexGroups(body, R.names);
  const breasts = breastSets(bind.pos, bodyN, hair, facing);
  // regions need the source dress (native frame); without it (e.g. CI, no uploads) every vertex is 'skirt' — penetration totals,
  // coverage, skin-through and floor stay valid, per-region / floating statistics do not
  const regions = dressNative ? dressRegions(dressNative, dress.idx) : {region: new Uint8Array(dress.pos.length / 3).fill(5), edge: new Uint8Array(dress.pos.length / 3), names: DRESS_REGIONS, noSourceRegions: true};
  // skin covered by the dress in the bind pose (outward normal ray meets the dress within coverDist): torso / leg welded skin only
  const bindDress = skinMesh(dress, W0);
  const dg = new TriGrid(bindDress, dress.idx, 0.03), seenW = new Set(), coveredBind = [];
  for (let i = 0; i < bind.pos.length / 3; i++) {
    const w = bodyRemap[i]; if (seenW.has(w) || hair[i] || (groups[i] !== 0 && groups[i] !== 3)) continue; seenW.add(w);
    const nx = bodyN[i * 3], ny = bodyN[i * 3 + 1], nz = bodyN[i * 3 + 2];
    if (dg.ray(bind.pos[i * 3] + nx * 0.0015, bind.pos[i * 3 + 1] + ny * 0.0015, bind.pos[i * 3 + 2] + nz * 0.0015, nx, ny, nz, 0.08)) coveredBind.push(i);
  }
  const dressIds = uniqueIds(dressNative ?? dress.pos);
  return {R, body, dress, bodyRemap, hair, skinMaskInfo: {skinVertices: sk.skinVertices, windingFlipped: sk.flipped}, groups, facing, breasts, joints, nonHairIdx: skinIdx, regions, dressIds, coveredBind: Uint32Array.from(coveredBind), normalSign: sk.flipped ? -1 : 1};
}

/**
 * Measures one frame. clip = null -> bind pose. Returns per-region statistics (mm) plus worst offenders.
 */
export function measureFrame(F, clip = null, t = 0, {maxR = 0.08, tol = 0.003, coverDist = 0.06, withVertex = false} = {}) {
  const W = jointWorld(F.R, clip, t);
  const B = skinMesh(F.body, W), D = skinMesh(F.dress, W);
  const BN = weldedNormals(B, F.nonHairIdx, F.bodyRemap);
  const grid = new TriGrid(B, F.nonHairIdx, 0.03);
  const idx = F.nonHairIdx;
  const reg = F.regions.region, edge = F.regions.edge;
  let unconfirmed = 0;
  const pen = {}, flo = {}, sdAll = withVertex ? new Float32Array(D.length / 3).fill(NaN) : null;
  for (const r of DRESS_REGIONS) { pen[r] = {n: 0, gt3: 0, gt10: 0, gt25: 0, maxMm: 0, at: null, byBody: {torso: 0, head: 0, arm: 0, leg: 0}}; flo[r] = {gaps: [], gapsInterior: [], far: 0}; }
  for (const i of F.dressIds) {
    const r = DRESS_REGIONS[reg[i]];
    const px = D[i * 3], py = D[i * 3 + 1], pz = D[i * 3 + 2];
    const c = grid.closest(px, py, pz, maxR);
    pen[r].n++;
    if (!c) { flo[r].far++; continue; }
    const a = idx[c.tri * 3], b = idx[c.tri * 3 + 1], e = idx[c.tri * 3 + 2], q = c.q;
    const nx = q[3] * BN[a * 3] + q[4] * BN[b * 3] + q[5] * BN[e * 3], ny = q[3] * BN[a * 3 + 1] + q[4] * BN[b * 3 + 1] + q[5] * BN[e * 3 + 1], nz = q[3] * BN[a * 3 + 2] + q[4] * BN[b * 3 + 2] + q[5] * BN[e * 3 + 2];
    const s = (px - q[0]) * nx + (py - q[1]) * ny + (pz - q[2]) * nz;
    let sd = (s < 0 ? -1 : 1) * c.d * F.normalSign;
    // the skin surface has holes where the hair is fused to it (rims): a negative sign is CONFIRMED by ray parity against the
    // skin (majority of the 6 axis rays); unconfirmed -> outside
    if (sd < -tol && !insideByParity(grid, px, py, pz)) { sd = c.d; unconfirmed++; }
    if (sdAll) sdAll[i] = sd;
    if (sd < -tol) {
      const P = pen[r], dep = -sd;
      P.gt3++; if (dep > 0.01) P.gt10++; if (dep > 0.025) P.gt25++;
      const bg = GROUP_NAMES[F.groups[q[3] >= q[4] && q[3] >= q[5] ? a : q[4] >= q[5] ? b : e]];
      P.byBody[bg]++;
      if (dep * 1000 > P.maxMm) { P.maxMm = mm(dep); P.at = [r4(px), r4(py), r4(pz)]; P.atBody = bg; }
    } else if (sd > 0) { flo[r].gaps.push(sd); if (!edge[i]) flo[r].gapsInterior.push(sd); }
  }
  const floating = {};
  for (const r of Object.keys(FLOAT_THRESHOLD)) {
    const f = flo[r], th = FLOAT_THRESHOLD[r];
    const [p50, p90, mx] = quantiles(f.gaps, [0.5, 0.9, 1]);
    floating[r] = {thresholdMm: mm(th), outside: f.gaps.length, p50Mm: p50 == null ? null : mm(p50), p90Mm: p90 == null ? null : mm(p90), maxMm: mx == null ? null : mm(mx),
      overThreshold: f.gaps.filter(g => g > th).length + f.far, overThresholdInterior: f.gapsInterior.filter(g => g > th).length, beyondSearchRadius: f.far};
  }
  // coverage of the breasts: ray along the posed outward normal hits the dress within coverDist
  const dgrid = new TriGrid(D, F.dress.idx, 0.03);
  const coverage = {};
  for (const side of ['R', 'L']) {
    const S = F.breasts[side];
    const test = ids => { let c = 0, n = 0; const seen = new Set(); for (const i of ids) { const w = F.bodyRemap[i]; if (seen.has(w)) continue; seen.add(w); n++; const nx = BN[i * 3], ny = BN[i * 3 + 1], nz = BN[i * 3 + 2]; if (dgrid.ray(B[i * 3] + nx * 0.0015, B[i * 3 + 1] + ny * 0.0015, B[i * 3 + 2] + nz * 0.0015, nx, ny, nz, coverDist)) c++; } return {n, covered: c, fraction: n ? r4(c / n) : null}; };
    coverage[side === 'R' ? 'wearerRightBreast' : 'wearerLeftBreast'] = {...test(S.ids), apexZone: test(S.apexZone)};
  }
  // skin showing through: bind-covered torso / leg skin whose posed outward ray no longer meets the dress within 8 cm
  const through = {torso: 0, leg: 0}; let coveredN = 0;
  for (const i of F.coveredBind) {
    coveredN++;
    const nx = BN[i * 3], ny = BN[i * 3 + 1], nz = BN[i * 3 + 2];
    if (!dgrid.ray(B[i * 3] + nx * 0.0015, B[i * 3 + 1] + ny * 0.0015, B[i * 3 + 2] + nz * 0.0015, nx, ny, nz, 0.08)) through[F.groups[i] === 3 ? 'leg' : 'torso']++;
  }
  // floor
  let dMin = Infinity, below = 0, bMin = Infinity;
  for (const i of F.dressIds) { const y = D[i * 3 + 1]; if (y < dMin) dMin = y; if (y < -0.005) below++; }
  for (let i = 1; i < B.length; i += 3) if (B[i] < bMin) bMin = B[i];
  const penetration = {};
  let totalGt3 = 0, worst = {mm: 0};
  for (const r of DRESS_REGIONS) { const P = pen[r]; totalGt3 += P.gt3; penetration[r] = {vertices: P.n, gt3mm: P.gt3, gt10mm: P.gt10, gt25mm: P.gt25, maxMm: P.maxMm, maxAt: P.at, maxAtBody: P.atBody ?? null, byBodyRegion: P.byBody}; if (P.maxMm > worst.mm) worst = {mm: P.maxMm, region: r, at: P.at, body: P.atBody}; }
  return {clip: clip ?? 'bind', t: r4(t), penetration, penetrationTotal: {gt3mm: totalGt3, worst, negativeSignNotConfirmedByParity: unconfirmed}, floating, coverage,
    skinThrough: {bindCovered: coveredN, uncoveredTorso: through.torso, uncoveredLeg: through.leg, fraction: coveredN ? r4((through.torso + through.leg) / coveredN) : null},
    floor: {dressMinY: r4(dMin), dressVerticesBelowMinus5mm: below, dressMaxSinkM: r4(Math.max(0, -dMin)), bodyMinY: r4(bMin)}, ...(sdAll ? {sd: sdAll, D, B} : {})};
}

/** Clip sample times: every 1/fps s from 0 to the duration (inclusive). */
export function sampleTimes(R, clip, fps = 10) {
  const a = R.anims.find(x => x.getName() === clip);
  let dur = 0; for (const ch of a.listChannels()) { const T = ch.getSampler().getInput().getArray(); dur = Math.max(dur, T[T.length - 1]); }
  const out = []; for (let k = 0; k * (1 / fps) <= dur + 1e-6; k++) out.push(+(k / fps).toFixed(4));
  if (out[out.length - 1] < dur - 1e-4) out.push(+dur.toFixed(4));
  return out;
}

/** Aggregates measureFrame results of one clip: worst frame per metric. */
export function summarizeClip(frames) {
  const by = (f, g) => frames.reduce((b, x) => (g(x) > g(b) ? x : b), frames[0]);
  const wPen = by(null, x => x.penetrationTotal.gt3mm), wDepth = by(null, x => x.penetrationTotal.worst.mm);
  const cov = k => frames.map(x => x.coverage[k].fraction);
  const floatOver = r => frames.map(x => x.floating[r].overThresholdInterior);
  return {frames: frames.length, times: frames.map(x => x.t),
    penetration: {maxVerticesGt3mm: wPen.penetrationTotal.gt3mm, atT: wPen.t, meanVerticesGt3mm: r4(frames.reduce((s, x) => s + x.penetrationTotal.gt3mm, 0) / frames.length),
      maxDepthMm: wDepth.penetrationTotal.worst.mm, maxDepthAtT: wDepth.t, maxDepthRegion: wDepth.penetrationTotal.worst.region, maxDepthBody: wDepth.penetrationTotal.worst.body, maxDepthAt: wDepth.penetrationTotal.worst.at,
      gt10mmMax: Math.max(...frames.map(x => Object.values(x.penetration).reduce((s, p) => s + p.gt10mm, 0))), gt25mmMax: Math.max(...frames.map(x => Object.values(x.penetration).reduce((s, p) => s + p.gt25mm, 0)))},
    floatingInteriorOverThresholdMax: Object.fromEntries(Object.keys(FLOAT_THRESHOLD).map(r => [r, Math.max(...floatOver(r))])),
    strapGapP90MmMax: Math.max(...frames.map(x => x.floating.strap.p90Mm ?? 0)),
    coverage: {wearerRightBreastMin: Math.min(...cov('wearerRightBreast')), wearerRightBreastMean: r4(cov('wearerRightBreast').reduce((a, b) => a + b, 0) / frames.length), wearerRightApexMin: Math.min(...frames.map(x => x.coverage.wearerRightBreast.apexZone.fraction)),
      wearerLeftBreastMax: Math.max(...cov('wearerLeftBreast')), wearerLeftApexMax: Math.max(...frames.map(x => x.coverage.wearerLeftBreast.apexZone.fraction))},
    floor: {dressMaxSinkM: Math.max(...frames.map(x => x.floor.dressMaxSinkM)), atT: by(null, x => x.floor.dressMaxSinkM).t, framesWithDressBelow: frames.filter(x => x.floor.dressVerticesBelowMinus5mm > 0).length, maxVerticesBelow: Math.max(...frames.map(x => x.floor.dressVerticesBelowMinus5mm))}};
}
