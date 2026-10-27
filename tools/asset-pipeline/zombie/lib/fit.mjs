// Per-body garment fitting (offline): a garment fitted once to the canonical body is retargeted to
// every other body through the shared 18-joint skeleton, then collision-fixed and re-skinned:
//  1. retarget: each garment vertex is moved by the blend (its canonical skin weights) of
//     - a torso height map for Hips/Spine/Chest/Neck/Head: piecewise-linear height map between body
//       landmarks (ankle, knee, crotch, hip, spine, chest, armpit, neck base, head, top), lateral and
//       depth offsets scaled by the ratio of the bodies' torso cross-section width/depth there;
//     - per limb bone: rotation onto the target bone + length scale along it + girth scale
//       perpendicular (ratio of measured limb radii);
//  2. bind-pose push-out against the target body (coat.mjs pushOut) with diffusion smoothing;
//  3. skin weights transferred from the target body (skin.mjs transferWeights);
//  4. hidden-triangle mask: body triangles whose outward cone of 5 rays all hit the garment within
//     a short distance are hidden at runtime for that body x outfit (reduces poke-through);
//  5. bulk: median garment-to-body distance on torso/arms (hit volume / ragdoll padding).
import {buildGrid} from './bake.mjs';
import {computeNormals, faceNormalsAreas, vertexAdjacency} from './mesh.mjs';
import {transferWeights, JOINT_NAMES} from './skin.mjs';
import {pushOut} from './coat.mjs';
import {frameRot, qRot, V} from './pose.mjs';
import {measurePants, fitPantsToBody} from './pants.mjs';
import {fitRigid} from './rigid.mjs';

const TORSO = new Set(['Root', 'Hips', 'Spine', 'Chest', 'Neck']);
const CHILD = {L_UpperArm: 'L_Forearm', L_Forearm: 'L_Hand', R_UpperArm: 'R_Forearm', R_Forearm: 'R_Hand', L_Thigh: 'L_Shin', L_Shin: 'L_Foot', R_Thigh: 'R_Shin', R_Shin: 'R_Foot'};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function landmarkList(skel) {
  const J = skel.joints;
  // shoulder joint height instead of the armpit: the armpit (where the arm separates from the torso
  // in horizontal slices) depends on how far the arms are abducted, the joint does not
  const raw = [0, skel.ankleY, J.L_Shin[1], skel.crotchY, skel.hipY, J.Spine[1], J.Chest[1], J.L_UpperArm[1], skel.neckBaseY, J.Head[1], skel.H];
  for (let i = 1; i < raw.length; i++) raw[i] = Math.max(raw[i], raw[i - 1] + 1e-3);
  return raw;
}
function makeYMap(from, to) {
  return y => {
    if (y <= from[0]) return to[0] + (y - from[0]);
    for (let i = 0; i < from.length - 1; i++) if (y <= from[i + 1]) { const t = (y - from[i]) / (from[i + 1] - from[i]); return to[i] + t * (to[i + 1] - to[i]); }
    const n = from.length - 1; return to[n] + (y - from[n]) * (to[n] - to[n - 1]) / (from[n] - from[n - 1]);
  };
}
/** Smoothed torso row (w, d, cx, cz) at height y; rows missing below the crotch reuse the nearest above. */
function torsoRows(skel, profile) {
  const T = profile?.torsoRows ?? skel.torso, n = T.rows.length;
  const filled = T.rows.slice();
  // below the crotch the "central" cluster is not the torso (legs are separate; any cluster that
  // happens to span x = 0 there is debris): reuse the first row 3 cm above the crotch
  const kc = clamp(Math.round((skel.crotchY + 0.03 - T.y0) / T.step), 0, n - 1);
  let firstValid = kc; while (firstValid < n - 1 && !filled[firstValid]) firstValid++;
  for (let k = 0; k < firstValid; k++) filled[k] = filled[firstValid];
  for (let k = 1; k < n; k++) if (!filled[k]) filled[k] = filled[k - 1];
  // gaussian-weighted smoothing over +-8 cm: per-row ratios that change quickly with height would
  // ripple a garment into horizontal folds
  const sm = filled.map((_, k) => { const acc = [0, 0, 0, 0]; let c = 0; for (let d = -8; d <= 8; d++) { const w = Math.exp(-(d * d) / 18); const r = filled[clamp(k + d, 0, n - 1)]; for (let q = 0; q < 4; q++) acc[q] += w * r[q]; c += w; } return acc.map(v => v / c); });
  return y => sm[clamp(Math.round((y - T.y0) / T.step), 0, n - 1)];
}

/**
 * Retarget welded garment positions from canonical body C to body B.
 * @param g {pos, joints, weights} welded garment on C (canonical skin weights)
 * @param C/B {skel, profile}
 */
export function retargetGarment(g, C, B, {torsoRatio = [0.7, 1.6], limbRatio = [0.7, 1.7], limbs = true, smoothIters = 12} = {}) {
  const yMap = makeYMap(landmarkList(C.skel), landmarkList(B.skel));
  const rowC = torsoRows(C.skel, C.profile), rowB = torsoRows(B.skel, B.profile);
  const JC = C.skel.joints, JB = B.skel.joints;
  const endC = n => CHILD[n] ? JC[CHILD[n]] : C.skel.ends[n], endB = n => CHILD[n] ? JB[CHILD[n]] : B.skel.ends[n];
  const maps = {};
  for (const name of JOINT_NAMES) {
    if (TORSO.has(name) || name === 'Head') continue;
    const a0 = JC[name], b0 = JB[name], d0 = V.sub(endC(name), a0), d1 = V.sub(endB(name), b0);
    const u0 = V.norm(d0), u1 = V.norm(d1), side = [0, 0, 1];
    const base = name.slice(2); // UpperArm, Forearm, Hand, Thigh, Shin, Foot
    const rc = C.profile.limb[name]?.radius, rb = B.profile.limb[name]?.radius;
    const g0 = rc && rb ? clamp(rb / rc, ...limbRatio) : 1;
    // girth: radial offset grows by the radius difference (additive), so sleeves follow the limb
    // surface without inflating torso-side points that carry some limb weight
    const dr = base === 'Hand' || base === 'Foot' || !(rc && rb) ? 0 : clamp(rb - rc, -0.04, 0.06);
    maps[name] = {a0, b0, u0, k: V.len(d1) / V.len(d0), g: g0, dr, q: frameRot(u0, V.cross(u0, side), u1, V.cross(u1, side))};
  }
  const headK = clamp((B.profile.head.halfWidth / C.profile.head.halfWidth + B.profile.head.depth / C.profile.head.depth) / 2, 0.8, 1.25);
  const torsoMap = p => {
    const y1 = yMap(p[1]);
    const a = rowC(p[1]), b = rowB(y1);
    const rx = clamp(b[0] / a[0], ...torsoRatio), rz = clamp(b[1] / a[1], ...torsoRatio);
    return [b[2] + (p[0] - a[2]) * rx, y1, b[3] + (p[2] - a[3]) * rz];
  };
  const headMap = p => V.add(JB.Head, V.mul(V.sub(p, JC.Head), headK));
  const limbMap = (M, p) => {
    const d = V.sub(p, M.a0), along = V.dot(d, M.u0), perp = V.sub(d, V.mul(M.u0, along));
    const pl = V.len(perp), k = pl > 1e-6 ? Math.max(0.2 * pl, pl + M.dr) / pl : 1;
    return V.add(M.b0, qRot(M.q, V.add(V.mul(M.u0, along * M.k), V.mul(perp, k))));
  };
  const n = g.pos.length / 3, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]];
    let acc = [0, 0, 0], tw = 0;
    for (let k = 0; k < 4; k++) {
      const w = g.weights[i * 4 + k]; if (!w) continue;
      const name = JOINT_NAMES[g.joints[i * 4 + k]];
      // sleeveless garments: limb weight near armholes/hems follows the torso map only
      if (TORSO.has(name) || (!limbs && name !== 'Head')) { tw += w; continue; }
      acc = V.add(acc, V.mul(name === 'Head' ? headMap(p) : limbMap(maps[name], p), w));
    }
    if (tw > 0) acc = V.add(acc, V.mul(torsoMap(p), tw));
    out[i * 3] = acc[0]; out[i * 3 + 1] = acc[1]; out[i * 3 + 2] = acc[2];
  }
  // regularise: Laplacian smoothing of the displacement field over the garment surface
  if (g.idx && smoothIters > 0) {
    const {offs, adj} = vertexAdjacency(n, g.idx);
    let D = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) D[i] = out[i] - g.pos[i];
    for (let it = 0; it < smoothIters; it++) {
      const N2 = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const deg = offs[i + 1] - offs[i];
        for (let c = 0; c < 3; c++) {
          let acc = 0; for (let k = offs[i]; k < offs[i + 1]; k++) acc += D[adj[k] * 3 + c];
          N2[i * 3 + c] = deg ? 0.5 * D[i * 3 + c] + 0.5 * acc / deg : D[i * 3 + c];
        }
      }
      D = N2;
    }
    for (let i = 0; i < n * 3; i++) out[i] = g.pos[i] + D[i];
  }
  return {pos: out, stats: {displacementSmoothIters: smoothIters, headScale: +headK.toFixed(3), limbRadiusDeltaM: Object.fromEntries(Object.entries(maps).filter(([k]) => !/Hand|Foot/.test(k)).map(([k, m]) => [k, +m.dr.toFixed(4)])), limbsMapped: limbs, limbLength: Object.fromEntries(Object.entries(maps).map(([k, m]) => [k, +m.k.toFixed(3)]))}};
}

// ---------------------------------------------------------------------------------------------
// ray / closest-point helpers over a uniform triangle grid
function rayTri(o, d, P, a, b, c, tMax) {
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
  const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 && t < tMax ? t : Infinity;
}
function rayHits(grid, P, idx, o, d, tMax, stamp, mark) {
  const steps = Math.ceil(tMax / (grid.cell * 0.5));
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(tMax, s * grid.cell * 0.5);
    const c = [0, 1, 2].map(k => Math.floor((o[k] + d[k] * t - grid.min[k]) / grid.cell));
    if (c.some((v, k) => v < 0 || v >= grid.dims[k])) continue;
    const ci = (c[2] * grid.dims[1] + c[1]) * grid.dims[0] + c[0];
    for (let q = grid.start[ci]; q < grid.start[ci + 1]; q++) {
      const tri = grid.tris[q];
      if (mark[tri] === stamp) continue;
      mark[tri] = stamp;
      if (rayTri(o, d, P, idx[tri * 3] * 3, idx[tri * 3 + 1] * 3, idx[tri * 3 + 2] * 3, tMax) < tMax) return true;
    }
  }
  return false;
}

/**
 * Body triangles fully enclosed by the garment: from the centroid (1 mm out) cast the normal and
 * 4 rays tilted by `tiltDeg`; hide only if ALL hit the garment within `maxDist`. Returns a
 * Uint8Array(nTris) (1 = hide) and counts.
 */
export function coverMask(body, garment, {maxDist = 0.09, tiltDeg = 28, inset = 0.03, skipJoints = ['Head', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot'], bodyJoints = null} = {}) {
  const grid = buildGrid(garment.pos, garment.idx, 0.03);
  const nt = body.idx.length / 3;
  const {FN} = faceNormalsAreas(body.pos, body.idx);
  const mark = new Int32Array(garment.idx.length / 3).fill(-1);
  const hide = new Uint8Array(nt);
  const skip = new Set(skipJoints.map(n => JOINT_NAMES.indexOf(n)));
  const tilt = tiltDeg * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
  let stamp = 0, hidden = 0;
  for (let t = 0; t < nt; t++) {
    const a = body.idx[t * 3], b = body.idx[t * 3 + 1], c = body.idx[t * 3 + 2];
    if (bodyJoints && [a, b, c].some(v => skip.has(bodyJoints[v * 4]))) continue;
    const n = [FN[t * 3], FN[t * 3 + 1], FN[t * 3 + 2]];
    if (!(n[0] || n[1] || n[2])) continue;
    // rays start `inset` BELOW the surface so triangles that bulge slightly through a tight garment
    // (cloth wrinkles between garment vertices) are still recognised as covered
    const o = [0, 1, 2].map(k => (body.pos[a * 3 + k] + body.pos[b * 3 + k] + body.pos[c * 3 + k]) / 3 - n[k] * inset);
    const t1 = V.norm(Math.abs(n[1]) < 0.9 ? V.cross(n, [0, 1, 0]) : V.cross(n, [1, 0, 0])), t2 = V.cross(n, t1);
    const dirs = [n, V.add(V.mul(n, ct), V.mul(t1, st)), V.add(V.mul(n, ct), V.mul(t1, -st)), V.add(V.mul(n, ct), V.mul(t2, st)), V.add(V.mul(n, ct), V.mul(t2, -st))];
    let all = true;
    for (const d of dirs) { stamp++; if (!rayHits(grid, garment.pos, garment.idx, o, d, maxDist + inset, stamp, mark)) { all = false; break; } }
    if (all) { hide[t] = 1; hidden++; }
  }
  return {hide, hidden, total: nt, fraction: +(hidden / nt).toFixed(4), method: `normal + 4 rays tilted ${tiltDeg} deg from ${inset} m below each body triangle centroid; hidden when all hit the fitted garment within ${maxDist} m of the surface; head/hands/feet/legs (and arms under sleeveless garments) never hidden`};
}

/** Closest distance from each point to a triangle mesh (grid accelerated, bounded search). */
export function closestDistances(points, mesh, maxR = 0.25) {
  const grid = buildGrid(mesh.pos, mesh.idx, 0.03);
  const P = mesh.pos, n = points.length / 3, out = new Float32Array(n);
  const pt = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  for (let i = 0; i < n; i++) {
    const p = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    const c = [0, 1, 2].map(k => Math.floor((p[k] - grid.min[k]) / grid.cell));
    let bd = Infinity;
    const R = Math.ceil(maxR / grid.cell);
    for (let r = 0; r <= R && !(bd <= (r - 1) * grid.cell); r++) {
      for (let z = c[2] - r; z <= c[2] + r; z++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let x = c[0] - r; x <= c[0] + r; x++) {
        if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r) continue;
        if (x < 0 || y < 0 || z < 0 || x >= grid.dims[0] || y >= grid.dims[1] || z >= grid.dims[2]) continue;
        const ci = (z * grid.dims[1] + y) * grid.dims[0] + x;
        for (let k = grid.start[ci]; k < grid.start[ci + 1]; k++) {
          const t = grid.tris[k];
          const d = V.len(V.sub(p, closestOnTri(p, pt(mesh.idx[t * 3]), pt(mesh.idx[t * 3 + 1]), pt(mesh.idx[t * 3 + 2]))));
          if (d < bd) bd = d;
        }
      }
    }
    out[i] = bd;
  }
  return out;
}
function closestOnTri(p, a, b, c) {
  const ab = V.sub(b, a), ac = V.sub(c, a), ap = V.sub(p, a);
  const d1 = V.dot(ab, ap), d2 = V.dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = V.sub(p, b), d3 = V.dot(ab, bp), d4 = V.dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return V.add(a, V.mul(ab, d1 / (d1 - d3)));
  const cp = V.sub(p, c), d5 = V.dot(ab, cp), d6 = V.dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return V.add(a, V.mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return V.add(b, V.mul(V.sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const den = 1 / (va + vb + vc);
  return V.add(a, V.add(V.mul(ab, vb * den), V.mul(ac, vc * den)));
}

/**
 * Fit one canonical garment to body B. `gC` = garmentCanonical() result; C/B = body records
 * {id, skel, rigDesc, profile, low, weldedWeights}. Returns welded + UV-split mesh, weights, mask, stats.
 */
export function fitVariant(gC, cfg, C, B) {
  if (cfg.kind === 'pants' || cfg.kind === 'rigid') return fitDirect(gC, cfg, B);
  const can = gC.canonical;
  const same = C.id === B.id;
  const rt = same ? {pos: new Float32Array(can.pos), stats: {identity: true}} : retargetGarment({pos: can.pos, idx: can.idx, joints: can.joints, weights: can.weights}, C, B, {limbs: gC.sleeved !== false});
  const pos = rt.pos;
  const yr = P => { let a = Infinity, b = -Infinity; for (let i = 1; i < P.length; i += 3) { a = Math.min(a, P[i]); b = Math.max(b, P[i]); } return [+a.toFixed(3), +b.toFixed(3)]; };
  const debug = {canonicalY: yr(can.pos), retargetY: yr(pos)};
  const before = new Float32Array(pos);
  // sleeveless garments never wrap the arms: collide / transfer weights against torso+leg triangles
  // only (bodies whose arms hang close to the torso would otherwise push the armholes out over the arm)
  const sleeveless = gC.sleeved === false;
  const ARM = new Set(['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand'].map(n => JOINT_NAMES.indexOf(n)));
  let target = B.low.welded;
  if (sleeveless) {
    const wj = B.weldedWeights.joints, I = target.idx, keep = [];
    for (let t = 0; t < I.length; t += 3) if (![I[t], I[t + 1], I[t + 2]].some(v => ARM.has(wj[v * 4]))) keep.push(I[t], I[t + 1], I[t + 2]);
    target = {pos: target.pos, idx: Uint32Array.from(keep), nrm: target.nrm};
  }
  // layering (iteration 06): upper garments also collide with every lower garment fitted to this body
  // (waist/hip region), so a jacket hem always sits OVER any pants waistband
  const collide = B.extraCollide ? mergeMeshes(target, B.extraCollide) : target;
  const push = pushOut(pos, can.idx, collide, {...cfg.pushOut, radius: Math.max(cfg.pushOut.radius ?? 0.06, 0.1)});
  const tw = transferWeights({pos, idx: can.idx}, target, B.weldedWeights, B.rigDesc, {thighMax: cfg.thighFollow ?? 0.45, smoothIters: 3, grid: buildGrid(target.pos, target.idx, 0.03), region: can.region, armpitY: B.skel.armpitY});
  const nrm = computeNormals(pos, can.idx);
  {
    debug.pushedY = yr(pos);
    const d = []; for (let i = 0; i < pos.length; i += 3) d.push(Math.hypot(pos[i] - before[i], pos[i + 1] - before[i + 1], pos[i + 2] - before[i + 2]));
    d.sort((a, b) => a - b); debug.pushPercentilesM = [0.5, 0.9, 0.99].map(q => +d[Math.floor(q * (d.length - 1))].toFixed(4));
  }
  // spread to the garment's UV-split vertices (shared UV/index across bodies)
  const low = gC.low, n = low.weldId.length;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), J = new Uint16Array(n * 4), W = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = low.weldId[i];
    for (let k = 0; k < 3; k++) { P[i * 3 + k] = pos[s * 3 + k]; N[i * 3 + k] = nrm[s * 3 + k]; }
    for (let k = 0; k < 4; k++) { J[i * 4 + k] = tw.joints[s * 4 + k]; W[i * 4 + k] = tw.weights[s * 4 + k]; }
  }
  // legs are never masked: they swing out of rigid (non-simulated) skirts while walking/lunging
  const skipJoints = ['Head', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot', 'L_Thigh', 'L_Shin', 'R_Thigh', 'R_Shin', ...(sleeveless ? ['L_UpperArm', 'L_Forearm', 'R_UpperArm', 'R_Forearm'] : [])];
  const mask = coverMask({pos: B.low.pos, idx: B.low.idx}, {pos, idx: can.idx}, {...(cfg.mask || {}), bodyJoints: B.joints, skipJoints});
  // bulk: median garment->body distance over torso- and arm-dominant garment vertices
  const dist = closestDistances(pos, B.low.welded);
  const groups = {torso: [], arm: []};
  for (let i = 0; i < pos.length / 3; i++) {
    const j = JOINT_NAMES[tw.joints[i * 4]];
    if (['Spine', 'Chest', 'Hips'].includes(j)) groups.torso.push(dist[i]); else if (/UpperArm|Forearm/.test(j)) groups.arm.push(dist[i]);
  }
  const med = a => { if (!a.length) return 0; a.sort((x, y) => x - y); return +a[a.length >> 1].toFixed(4); };
  // penetration report after push-out (bind pose): garment vertices still inside/closer than 3 mm
  return {weldedPos: pos, pos: P, nrm: N, joints: J, weights: W, mask,
    stats: {debug, retarget: rt.stats, sleeveless, collisionTarget: (sleeveless ? 'body triangles without arm-dominant vertices' : 'whole body') + (B.extraCollide ? ' + fitted lower garments above the crotch (layering)' : ''), pushOut: push, transfer: tw.stats, bulkM: {torso: med(groups.torso), arm: med(groups.arm)}, hiddenBodyTriangles: mask.hidden, hiddenFraction: mask.fraction}};
}

function mergeMeshes(a, b) {
  const na = a.pos.length / 3;
  const pos = new Float32Array(a.pos.length + b.pos.length); pos.set(a.pos); pos.set(b.pos, a.pos.length);
  const idx = new Uint32Array(a.idx.length + b.idx.length); idx.set(a.idx); for (let i = 0; i < b.idx.length; i++) idx[a.idx.length + i] = b.idx[i] + na;
  return {pos, idx};
}

const HEAD_ONLY = JOINT_NAMES.filter(n => n !== 'Head');
const HEAD_NECK = JOINT_NAMES.filter(n => n !== 'Head' && n !== 'Neck');

/**
 * Pants and rigid items are fitted to each body directly from the body-independent stage
 * (gC = {kind, low: {weldId, welded}}). Same outputs as the garment path.
 */
function fitDirect(gC, cfg, B) {
  const W = gC.low.welded;
  let pos, fitStats, joints, weights, push = null, transfer;
  if (cfg.kind === 'pants') {
    const F = measurePants(W.pos);
    const r = fitPantsToBody(W.pos, W.idx, F, B, cfg);
    pos = r.pos; fitStats = r.stats;
    push = pushOut(pos, W.idx, B.low.welded, {...cfg.pushOut, radius: Math.max(cfg.pushOut.radius ?? 0.05, 0.08)});
    const tw = transferWeights({pos, idx: W.idx}, B.low.welded, B.weldedWeights, B.rigDesc, {skirt: false, smoothIters: 3, grid: buildGrid(B.low.welded.pos, B.low.welded.idx, 0.03)});
    joints = tw.joints; weights = tw.weights; transfer = tw.stats;
  } else {
    const r = fitRigid(gC, cfg, B);
    pos = r.pos; fitStats = {...r.stats, transform: r.transform};
    const n = pos.length / 3; joints = new Uint16Array(n * 4); weights = new Float32Array(n * 4);
    const hi = JOINT_NAMES.indexOf('Head');
    for (let i = 0; i < n; i++) { joints[i * 4] = hi; weights[i * 4] = 1; }
    transfer = {method: 'rigid: 100% Head'};
  }
  const nrm = computeNormals(pos, W.idx);
  const low = gC.low, n = low.weldId.length;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), J = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = low.weldId[i];
    for (let k = 0; k < 3; k++) { P[i * 3 + k] = pos[s * 3 + k]; N[i * 3 + k] = nrm[s * 3 + k]; }
    for (let k = 0; k < 4; k++) { J[i * 4 + k] = joints[s * 4 + k]; Wt[i * 4 + k] = weights[s * 4 + k]; }
  }
  // body triangles enclosed by the item: legs/pelvis under pants; scalp/hair under hats; face under masks
  const skipJoints = cfg.kind === 'pants'
    ? ['Head', 'Neck', 'Chest', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand', 'L_Foot', 'R_Foot']
    : cfg.slot === 'face' ? HEAD_NECK : HEAD_ONLY;
  // rigid items: rays start deeper (hair / cheeks that poke a little THROUGH a rigid shell are still
  // recognised as enclosed and hidden)
  const maskOpts = cfg.kind === 'pants' ? {maxDist: 0.07, inset: 0.025} : cfg.slot === 'head' ? {maxDist: 0.06, inset: 0.03, tiltDeg: 22} : {maxDist: 0.05, inset: 0.02, tiltDeg: 22};
  const mask = coverMask({pos: B.low.pos, idx: B.low.idx}, {pos, idx: W.idx}, {...maskOpts, ...(cfg.mask || {}), bodyJoints: B.joints, skipJoints});
  const dist = closestDistances(pos, B.low.welded);
  const groups = {leg: [], torso: []};
  for (let i = 0; i < pos.length / 3; i++) { const j = JOINT_NAMES[joints[i * 4]]; if (/Thigh|Shin/.test(j)) groups.leg.push(dist[i]); else if (['Hips', 'Spine'].includes(j)) groups.torso.push(dist[i]); }
  const med = a => { if (!a.length) return 0; a.sort((x, y) => x - y); return +a[a.length >> 1].toFixed(4); };
  const bulkM = cfg.kind === 'pants' ? {torso: 0, arm: 0, leg: med(groups.leg)} : {torso: 0, arm: 0, head: fitStats.bulkHeadM ?? 0};
  return {weldedPos: pos, pos: P, nrm: N, joints: J, weights: Wt, mask,
    stats: {kind: cfg.kind, fit: fitStats, collisionTarget: cfg.kind === 'pants' ? 'whole body' : 'none (rigid contact solve)', pushOut: push, transfer, bulkM, hiddenBodyTriangles: mask.hidden, hiddenFraction: mask.fraction}};
}
