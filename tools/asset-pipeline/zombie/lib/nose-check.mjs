// Meshy T2.5 migration (lane CHARS): face-landmark sanity check for the head / face item fits.
// lib/headwear.mjs (hats) and lib/rigid.mjs (masks) take the nose tip as the FRONT-MOST midline point of the head. On a
// face whose chin / lips protrude as far as the nose (the T2.5 station agent) that point lands on the chin, ~6-7 cm too
// low, and hats sink over the eyes / masks onto the chin. Robust estimate: the HIGHEST midline point within `tol` of the
// front-most depth (nose tip and chin tie -> the nose is the upper one). When it differs from the plain rule by more than
// `minShift`, the builder shifts the per-job fit parameters by the difference (hats: browAboveNose; masks: above /
// below / zone), so the libraries and every other body's fit stay exactly as they were. Recorded per body.
import {JOINT_NAMES} from './skin.mjs';

const HEAD = JOINT_NAMES.indexOf('Head');

/** @returns {plainY, robustY, shift} (metres, model space) */
export function noseCheck(B, {tol = 0.005, minShift = 0.03} = {}) {
  const P = B.low.welded.pos, I = B.low.welded.idx, sw = B.weldedWeights;
  const isHead = v => sw.joints[v * 4] === HEAD && sw.weights[v * 4] > 0.5;
  const verts = new Set();
  for (let t = 0; t < I.length / 3; t++) { let k = 0; for (let c = 0; c < 3; c++) if (isHead(I[t * 3 + c])) k++; if (k >= 2) for (let c = 0; c < 3; c++) verts.add(I[t * 3 + c]); }
  let mx = 0, n = 0; for (const v of verts) { mx += P[v * 3]; n++; } mx /= n;
  const hj = B.skel.joints.Head;
  const pts = [];
  for (const v of verts) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (Math.abs(x - mx) > 0.02 || y < hj[1] - 0.06 || y > hj[1] + 0.05) continue; pts.push([y, z]); }
  if (!pts.length) return {plainY: null, robustY: null, shift: 0};
  let best = pts[0]; for (const p of pts) if (p[1] > best[1]) best = p;
  let robust = best; for (const p of pts) if (p[1] >= best[1] - tol && p[0] > robust[0]) robust = p;
  const d = robust[0] - best[0];
  return {plainY: +best[0].toFixed(4), robustY: +robust[0].toFixed(4), shift: Math.abs(d) > minShift ? +d.toFixed(4) : 0, tolM: tol, minShiftM: minShift};
}

/** Per-job cfg for a head / face item on a body whose nose landmark needs `shift` metres. */
export function shiftHeadCfg(cfg, shift) {
  if (!shift) return cfg;
  const f = cfg.fit ?? {};
  if (f.mode === 'hat07') return {...cfg, fit: {...f, head: {...(f.head ?? {}), browAboveNose: (f.head?.browAboveNose ?? 0.045) + shift}}, noseShiftM: shift};
  if (f.mode === 'face') {
    const [zx, zy0, zy1] = f.zone ?? [0.035, -0.035, 0.03];
    return {...cfg, fit: {...f, above: (f.above ?? 0.07) + shift, below: (f.below ?? 0.02) - shift, zone: [zx, zy0 + shift, zy1 + shift]}, noseShiftM: shift};
  }
  return cfg;
}
