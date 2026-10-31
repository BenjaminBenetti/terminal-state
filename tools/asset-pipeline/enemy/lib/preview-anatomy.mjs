// Task studio-siren-clothing-refit-20261031-01 (lane PREVIEW): body-relative orientation + a small coverage probe for the Siren
// preview labels. Establishes the wearer's FRONT and anatomical LEFT / RIGHT from the body GEOMETRY (not names, not screen sides):
//  - up = +Y (glTF; checked: the height extent dominates);
//  - front = mean horizontal offset of the foot-sole vertices from the ankle-band centroid (toes extend further than heels;
//    lateral offsets of the two feet cancel). A second, independent cue: the two lateral chest maxima (breast apexes) lie on
//    the front side of the chest band's centre. Both must agree;
//  - anatomical LEFT = up x front (a person facing +Z with +Y up has her left hand at +X); RIGHT = -LEFT.
// Coverage probe (geometric sanity check for the labels, NOT an approval metric): body vertices within 3.5 cm of each breast apex
// cast a ray along their posed normal; a hit on any dress triangle within 12 cm counts as covered. Reported per side and pose.
import {poseAll} from './preview-gltf.mjs';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };

export function computeAnatomy(asset) {
  const rest = poseAll(asset, null, 0);
  const body = rest.filter(p => p.prim.role === 'body');
  if (!body.length) throw new Error('no body primitive');
  const P = body[0].pos, Nn = body[0].nrm, n = P.length / 3;
  let minY = Infinity, maxY = -Infinity, ext = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = P[i * 3 + c]; if (v < ext[c][0]) ext[c][0] = v; if (v > ext[c][1]) ext[c][1] = v; }
  minY = ext[1][0]; maxY = ext[1][1];
  const H = maxY - minY;
  const up = [0, 1, 0];
  // feet: soles vs ankle band
  let ax = 0, az = 0, ac = 0;
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1] - minY; if (y > 0.05 * H && y < 0.075 * H) { ax += P[i * 3]; az += P[i * 3 + 2]; ac++; } }
  ax /= ac; az /= ac;
  let fx = 0, fz = 0, fc = 0;
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1] - minY; if (y < 0.03 * H) { fx += P[i * 3] - ax; fz += P[i * 3 + 2] - az; fc++; } }
  const toeDir = norm([fx / fc, 0, fz / fc]);
  // snap to the nearest horizontal axis for camera convenience (the raw angle is reported)
  const axes = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  const front = axes.reduce((b, a) => (dot(a, toeDir) > dot(b, toeDir) ? a : b));
  const left = cross(up, front);
  const right = left.map(v => -v);
  // chest band: lateral apexes on the front side
  // apex = the vertex nearest the centroid of the most-forward 1.5 cm of each side's chest band (front-facing normals only)
  const apex = side => {
    const cand = [];
    let bq = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = P[i * 3 + 1] - minY; if (y < 0.66 * H || y > 0.79 * H) continue;
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], s = dot(p, left) * side;
      if (s < 0.035 || s > 0.15) continue;
      const nn = [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]];
      if (dot(nn, front) < 0.6) continue;
      const q = dot(p, front); cand.push([i, q]); if (q > bq) bq = q;
    }
    const top = cand.filter(([, q]) => q >= bq - 0.015);
    if (!top.length) return -1;
    const c = [0, 0, 0]; for (const [i] of top) for (let k = 0; k < 3; k++) c[k] += P[i * 3 + k] / top.length;
    let best = -1, bd = Infinity;
    for (const [i] of top) { const d = Math.hypot(P[i * 3] - c[0], P[i * 3 + 1] - c[1], P[i * 3 + 2] - c[2]); if (d < bd) { bd = d; best = i; } }
    return best;
  };
  const apexL = apex(1), apexR = apex(-1);
  // chest band centre along front (all chest-band vertices, incl. back / hair) -> second cue
  let qs = [];
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1] - minY; if (y > 0.66 * H && y < 0.79 * H && Math.abs(dot([P[i * 3], 0, P[i * 3 + 2]], left)) < 0.15) qs.push(dot([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], front)); }
  qs.sort((a, b) => a - b);
  const qMid = (qs[0] + qs[qs.length - 1]) / 2;
  const pt = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const chestCue = apexL >= 0 && apexR >= 0 && dot(pt(apexL), front) > qMid && dot(pt(apexR), front) > qMid;
  const around = (c, r = 0.035) => { const o = []; const C = pt(c); for (let i = 0; i < n; i++) if (Math.hypot(P[i * 3] - C[0], P[i * 3 + 1] - C[1], P[i * 3 + 2] - C[2]) < r) o.push(i); return o; };
  return {
    up, front, left, right, toeDir, toeAngleDeg: Math.atan2(toeDir[0], toeDir[2]) * 180 / Math.PI, heightM: H, minY, extents: ext,
    bodyPrim: asset.prims.indexOf(body[0].prim),
    apex: {left: {vertex: apexL, bind: pt(apexL), patch: around(apexL)}, right: {vertex: apexR, bind: pt(apexR), patch: around(apexR)}},
    cues: {toes: `mean sole offset from the ankle band (${toeDir.map(v => v.toFixed(3)).join(', ')}) -> front ${JSON.stringify(front)}`, chest: chestCue ? 'both lateral chest apexes lie on the front half of the chest band: agrees' : 'chest cue DISAGREES or apex not found'},
    agree: chestCue,
    statement: `front = ${axisName(front)} (toes + chest agree: ${chestCue}); anatomical LEFT = up x front = ${axisName(left)}; anatomical RIGHT = ${axisName(right)}`,
  };
}
export const axisName = a => (a[0] > 0.5 ? '+X' : a[0] < -0.5 ? '-X' : a[2] > 0.5 ? '+Z' : a[2] < -0.5 ? '-Z' : JSON.stringify(a));

function rayTri(o, d, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = cross(d, e2), det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = dot(s, p) * inv;
  if (u < 0 || u > 1) return -1;
  const q = cross(s, e1), v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return -1;
  return dot(e2, q) * inv;
}

/** Coverage probe for one posed frame: {left: {covered, total, fraction, minHit}, right: {...}, apexPos: {left, right}}. */
export function coverageProbe(anat, posedAll, maxDist = 0.12) {
  const body = posedAll[anat.bodyPrim];
  const dress = posedAll.filter(p => p.prim.role === 'dress');
  const out = {};
  for (const side of ['left', 'right']) {
    const A = anat.apex[side];
    const C = [body.pos[A.vertex * 3], body.pos[A.vertex * 3 + 1], body.pos[A.vertex * 3 + 2]];
    const tris = [];
    for (const d of dress) {
      const I = d.prim.idx, Pp = d.pos;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3; if (Math.abs(Pp[a] - C[0]) > 0.25 || Math.abs(Pp[a + 1] - C[1]) > 0.25 || Math.abs(Pp[a + 2] - C[2]) > 0.25) continue;
        tris.push([[Pp[a], Pp[a + 1], Pp[a + 2]], [Pp[I[t + 1] * 3], Pp[I[t + 1] * 3 + 1], Pp[I[t + 1] * 3 + 2]], [Pp[I[t + 2] * 3], Pp[I[t + 2] * 3 + 1], Pp[I[t + 2] * 3 + 2]]]);
      }
    }
    let covered = 0, minHit = Infinity;
    for (const i of A.patch) {
      const o = [body.pos[i * 3], body.pos[i * 3 + 1], body.pos[i * 3 + 2]], d = norm([body.nrm[i * 3], body.nrm[i * 3 + 1], body.nrm[i * 3 + 2]]);
      let hit = Infinity;
      for (const [a, b, c] of tris) { const t = rayTri(o, d, a, b, c); if (t > -0.003 && t < hit) hit = t; }
      if (hit <= maxDist) { covered++; minHit = Math.min(minHit, hit); }
    }
    out[side] = {covered, total: A.patch.length, fraction: +(covered / A.patch.length).toFixed(3), nearestHitM: Number.isFinite(minHit) ? +minHit.toFixed(4) : null};
    out.apexPos ??= {};
    out.apexPos[side] = C;
  }
  return out;
}
