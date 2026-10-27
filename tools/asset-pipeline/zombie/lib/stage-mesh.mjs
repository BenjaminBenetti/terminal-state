// Stage: master -> placed high-poly -> simplified low-poly -> new UVs -> baked textures.
import {similarity, rotateNormals, weldByPosition, simplifyMesh, computeNormals, bounds} from './mesh.mjs';
import {unwrap} from './unwrap.mjs';
import {bake, encodeTextures} from './bake.mjs';

/** Body placement: 1.78 m tall, rotate 180deg about Y (masters face -Z), feet midpoint at origin. */
export function bodyPlacement(master, height = 1.78) {
  const b = bounds(master.pos);
  const scale = height / (b.max[1] - b.min[1]);
  const L = {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity}, R = {...L};
  const p = master.pos;
  for (let i = 0; i < p.length; i += 3) {
    if ((p[i + 1] - b.min[1]) * scale > 0.04) continue;
    const s = p[i] > 0 ? L : R;
    s.x0 = Math.min(s.x0, p[i]); s.x1 = Math.max(s.x1, p[i]); s.z0 = Math.min(s.z0, p[i + 2]); s.z1 = Math.max(s.z1, p[i + 2]);
  }
  const mx = ((L.x0 + L.x1) / 2 + (R.x0 + R.x1) / 2) / 2, mz = ((L.z0 + L.z1) / 2 + (R.z0 + R.z1) / 2) / 2;
  return {scale, pivot: [mx, b.min[1], mz], flipFacing: true, offset: [0, 0, 0], nativeBounds: b,
    note: 'native masters face -Z (boot toes and pale face on -Z, hair on +Z); rotated 180deg about Y; feet midpoint (bbox centres of soles below 4 cm) moved to origin'};
}

export function placeHigh(master, placement) {
  return {pos: similarity(master.pos, placement), nrm: rotateNormals(master.nrm, placement.flipFacing), uv: master.uv, idx: master.idx};
}

/** Optional per-axis scale applied after the similarity (used for the coat's global fit). */
export function scaleAbout(pos, s, c, t) {
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = (pos[i + k] - c[k]) * s[k] + c[k] + t[k];
  return out;
}

export async function lowPolyAndBake(high, tex, {targetTris, normalWeight = 0, importanceOf = null, faceRegion, unwrapOpts, bakeSize, baseSize, mrSize, quality, bakeOpts = {}}) {
  const welded = weldByPosition(high.pos, high.nrm, high.idx);
  let importance = null;
  if (importanceOf) { importance = new Float32Array(welded.pos.length / 3); for (let i = 0; i < importance.length; i++) importance[i] = importanceOf([welded.pos[i * 3], welded.pos[i * 3 + 1], welded.pos[i * 3 + 2]]); }
  const simp = await simplifyMesh(welded, {targetTris, importance});
  const lowNrm = computeNormals(simp.pos, simp.idx);
  const uw = unwrap(simp.pos, simp.idx, {...unwrapOpts, faceRegion});
  const nv = uw.vertMap.length;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { const s = uw.vertMap[i]; for (let k = 0; k < 3; k++) { pos[i * 3 + k] = simp.pos[s * 3 + k]; nrm[i * 3 + k] = lowNrm[s * 3 + k]; } }
  const low = {pos, nrm, uv: uw.uv, idx: uw.idx, weldId: uw.vertMap, welded: {pos: simp.pos, idx: simp.idx, nrm: lowNrm}};
  const bk = await bake(high, low, tex, {size: bakeSize, ...bakeOpts});
  const enc = await encodeTextures(bk, {baseSize, mrSize, quality});
  return {low, welded, enc, stats: {weldedVertices: welded.pos.length / 3, weldedTriangles: welded.idx.length / 3, simplify: {targetTris, errorMetric: 'position quadric (normal attribute weight 0: fewest folds/slivers in comparison)', importanceWeighted: !!importanceOf, flags: ['Prune', 'Regularize'], resultTris: simp.triangles, resultVerts: simp.vertices, relativeError: +simp.error.toFixed(5), absoluteErrorM: +(simp.error * simp.scale).toFixed(5)}, unwrap: uw.stats, bake: bk.stats, outVertices: nv}};
}
