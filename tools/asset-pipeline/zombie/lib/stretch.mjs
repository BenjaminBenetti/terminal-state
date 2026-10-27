// Motion quality audit (iteration 06): CPU-skins a mesh through sampled frames of every clip and
// measures, per triangle, the worst edge-length ratio posed / bind. Spikes, webbing between limbs
// and torso, and skirts torn by the legs show up as triangles stretching several times their bind
// length. Used to (a) report per body / body x wearable motion quality, (b) gate variants, and
// (c) find body webbing to trim.
import {skinPositions} from './glb.mjs';

/** Every `every`-th frame of each sampled clip (+ the last frame) as poses for rig.fk. */
export function auditPoses(clips, {every = 3} = {}) {
  const out = [];
  for (const c of clips) for (let f = 0; f < c.times.length; f += every) out.push({clip: c.name, t: c.times[f], pose: {hips: c.hips[f], rot: Object.fromEntries(Object.entries(c.rot).map(([k, v]) => [k, v[f]]))}});
  return out;
}

/** Per-triangle max edge stretch over the poses. mesh {pos, idx, joints, weights (float)}. */
export function triangleStretch(mesh, skel, rig, poses) {
  const idx = mesh.idx, P0 = mesh.pos, nt = idx.length / 3;
  const worst = new Float32Array(nt), at = new Int32Array(nt).fill(-1);
  const L = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const bind = new Float32Array(nt * 3);
  for (let k = 0; k < nt; k++) { const a = idx[k * 3], b = idx[k * 3 + 1], c = idx[k * 3 + 2]; bind[k * 3] = Math.max(2e-3, L(P0, a, b)); bind[k * 3 + 1] = Math.max(2e-3, L(P0, b, c)); bind[k * 3 + 2] = Math.max(2e-3, L(P0, c, a)); }
  poses.forEach((p, pi) => {
    const P = skinPositions(mesh, skel, rig.fk(p.pose));
    for (let k = 0; k < nt; k++) {
      const a = idx[k * 3], b = idx[k * 3 + 1], c = idx[k * 3 + 2];
      const s = Math.max(L(P, a, b) / bind[k * 3], L(P, b, c) / bind[k * 3 + 1], L(P, c, a) / bind[k * 3 + 2]);
      if (s > worst[k]) { worst[k] = s; at[k] = pi; }
    }
  });
  return {worst, at};
}

export function stretchStats(worst, poses, at, {ratio = 3} = {}) {
  const n = worst.length;
  const s = Array.from(worst).sort((a, b) => a - b);
  let over = 0, over2 = 0; for (const v of worst) { if (v > ratio) over++; if (v > 2) over2++; }
  // which clip produced the worst stretches (top 1%)
  const byClip = {};
  if (at && poses) { const thr = s[Math.floor(0.99 * (n - 1))]; for (let k = 0; k < n; k++) if (worst[k] >= thr && at[k] >= 0) { const c = poses[at[k]].clip; byClip[c] = (byClip[c] || 0) + 1; } }
  return {triangles: n, p50: +s[n >> 1].toFixed(3), p99: +s[Math.floor(0.99 * (n - 1))].toFixed(3), max: +s[n - 1].toFixed(2), over2x: over2, [`over${ratio}x`]: over, fractionOver: +(over / n).toFixed(4), worstClips: byClip, poses: poses?.length};
}
