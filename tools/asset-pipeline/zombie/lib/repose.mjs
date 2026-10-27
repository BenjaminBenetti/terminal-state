// T-pose -> bind A-pose correction for a reused static source whose arms are horizontal (the
// user-uploaded pixal3d zombie). Works on a derived in-memory copy only (native coordinates,
// +Y up, arms along +-X). Per side:
//  1. armpit: walking outward along X, the largest (y,z) cross-section cluster above the hips stops
//     being tall torso and becomes a short arm section;
//  2. arm axis: line fit through the arm section centres (armpit+3 cm .. 85% of the reach);
//  3. shoulder pivot on the axis 0.03 H medial of the armpit; rotation about the forward (Z) axis
//     bringing the axis to `upperArmFromVerticalDeg` (A-pose, matching the shared bind pose);
//  4. angle-blended rotation (rotation angle scaled by a smooth weight across the shoulder, not a
//     linear position blend, so the armpit does not collapse); weight also requires proximity to
//     the arm axis so hip pouches/torso below the armpit never move.
import {bounds, computeNormals} from './mesh.mjs';
import {fitLine, clusterXZ} from './slices.mjs';

const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function detectTPoseArms(pos) {
  const b = bounds(pos), H = b.max[1] - b.min[1], y0 = b.min[1];
  const cx = (b.min[0] + b.max[0]) / 2;
  const step = 0.01 * H / 1.76;
  const out = {H, cx, sides: {}};
  for (const sg of [1, -1]) {
    // bucket vertices above the hip (55% H) by |x - cx| on this side
    const reach = sg > 0 ? b.max[0] - cx : cx - b.min[0];
    const nb = Math.ceil(reach / step) + 1;
    const buckets = Array.from({length: nb}, () => []);
    for (let i = 0; i < pos.length / 3; i++) {
      const dx = sg * (pos[i * 3] - cx);
      if (dx < 0 || pos[i * 3 + 1] < y0 + 0.55 * H) continue;
      buckets[Math.min(nb - 1, Math.floor(dx / step))].push(i);
    }
    // cross-section clusters in (y, z): reuse clusterXZ by swapping axes (x <- y)
    const swapped = new Float32Array(pos.length);
    for (let i = 0; i < pos.length / 3; i++) { swapped[i * 3] = pos[i * 3 + 1]; swapped[i * 3 + 1] = pos[i * 3]; swapped[i * 3 + 2] = pos[i * 3 + 2]; }
    const sections = buckets.map((ids, k) => {
      if (ids.length < 20) return null;
      const cl = clusterXZ(swapped, ids, 0.02 * H / 1.76, 8);
      if (!cl.length) return null;
      const big = cl.reduce((a, c) => c.count > a.count ? c : a);
      return {dx: (k + 0.5) * step, h: big.maxX - big.minX, cy: (big.minX + big.maxX) / 2, cz: big.bz, top: big.maxX, bottom: big.minX, count: big.count};
    });
    // armpit: first dx (beyond 6% H) where the section height falls below 0.17 H and stays low
    let armpit = null;
    for (let k = 0; k < nb - 3; k++) {
      const s = sections[k]; if (!s || s.dx < 0.06 * H) continue;
      if ([0, 1, 2].every(d => sections[k + d] && sections[k + d].h < 0.17 * H)) { armpit = s; break; }
    }
    if (!armpit) throw new Error('T-pose: armpit not found on side ' + sg);
    const pts = sections.filter(s => s && s.dx > armpit.dx + 0.03 * H && s.dx < 0.85 * reach).map(s => [cx + sg * s.dx, (s.top + s.bottom) / 2, s.cz]);
    const line = fitLine(pts);
    if (line.dir[0] * sg < 0) line.dir = line.dir.map(v => -v);
    const angleFromHorizontalDeg = Math.atan2(-line.dir[1], Math.abs(line.dir[0])) * 180 / Math.PI; // + = drooping down
    const tAt = x => (x - line.center[0]) / line.dir[0];
    const at = x => line.center.map((v, k) => v + tAt(x) * line.dir[k]);
    const pivot = at(cx + sg * (armpit.dx - 0.03 * H));
    out.sides[sg > 0 ? 'pos' : 'neg'] = {sg, armpitDx: armpit.dx, armpitY: armpit.bottom, axis: line, angleFromHorizontalDeg, pivot, reach};
  }
  return out;
}

/**
 * Torso half-width per height below the armpit (T-pose: the arms are separate from the torso there):
 * per 1 cm slice the (x, z) cluster spanning the centre line; returns y -> [maxDx +side, maxDx -side].
 */
function torsoWall(pos, det, y0, y1) {
  const H = det.H, step = 0.01 * H / 1.76, rows = [];
  const n = Math.ceil((y1 - y0) / step);
  const ids = Array.from({length: n}, () => []);
  for (let i = 0; i < pos.length / 3; i++) { const k = Math.floor((pos[i * 3 + 1] - y0) / step); if (k >= 0 && k < n) ids[k].push(i); }
  for (let k = 0; k < n; k++) {
    const cl = clusterXZ(pos, ids[k], 0.015 * H / 1.76, 5);
    const c = cl.filter(c => c.minX <= det.cx + 0.03 * H && c.maxX >= det.cx - 0.03 * H).sort((a, b) => b.count - a.count)[0];
    rows.push(c ? [c.maxX - det.cx, det.cx - c.minX] : null);
  }
  for (let k = 1; k < n; k++) if (!rows[k]) rows[k] = rows[k - 1];
  for (let k = n - 2; k >= 0; k--) if (!rows[k]) rows[k] = rows[k + 1];
  return y => rows[Math.max(0, Math.min(n - 1, Math.floor((y - y0) / step)))] ?? [0.1 * H, 0.1 * H];
}

/**
 * Returns a master-like copy {..., pos, nrm, (idx)} with both arms rotated down into the A-pose.
 * Iteration 06 (scavenger quality fix, `torsoGuard` + `trimFringe`, both default on):
 *  - torso guard: below the armpit, vertices inside the torso wall (+ margin) never rotate. The
 *    iteration-05 version rotated every vertex within ~0.2 m of the arm axis, which swung the
 *    jacket flank under the armpit out with the arm into a cape-like flare; in motion the skinning
 *    then stretched that flare between the arm and the torso into large flat sheets.
 *  - fringe trim: cloth tatters hanging BELOW the horizontal T-pose sleeves (deeper under the arm
 *    axis than 1.3 x the sleeve's upper radius, outside the torso wall) are removed: rotated into the
 *    A-pose they point at the torso and bridge the arm-torso gap.
 */
export function reposeTtoA(master, {upperArmFromVerticalDeg = 34, band = 0.05, radius = 0.16, torsoGuard = true, trimFringe = true} = {}) {
  const det = detectTPoseArms(master.pos);
  const H = det.H, P = master.pos, n = P.length / 3, u = H / 1.76;
  const pos = new Float32Array(P);
  const log = {method: 'angle-blended rotation of each arm about a shoulder pivot (forward axis) into the A-pose' + (torsoGuard ? '; torso flank below the armpit (inside the measured torso wall + 2.5 cm) held fixed' : '') + (trimFringe ? '; cloth fringe hanging below the T-pose sleeves removed' : ''), sides: {}, version: 2};
  // armpit height for the guard/trim: the higher of the two sides (a fringe or pouch hanging from
  // one sleeve extends that side's lowest arm-section point; the T-pose is symmetric)
  const armpitY = Math.max(det.sides.pos.armpitY, det.sides.neg.armpitY);
  const yHip = armpitY - 0.35 * H;
  const wall = torsoGuard || trimFringe ? torsoWall(P, det, yHip, armpitY + 0.02 * H) : null;
  const drop = new Uint8Array(n);
  for (const key of ['pos', 'neg']) {
    const s = det.sides[key], sg = s.sg, wi = sg > 0 ? 0 : 1;
    // rotation (about +Z) taking the current axis to the target: arm on +x rotates by -delta
    const targetFromHorizontal = 90 - upperArmFromVerticalDeg;
    const delta = (targetFromHorizontal - s.angleFromHorizontalDeg) * Math.PI / 180;
    const ang = -sg * delta;
    const ax = s.axis.dir, piv = s.pivot;
    // sleeve upper radius per 1 cm along the axis (tatters hang down; the top surface is clean)
    let rAt = () => Infinity;
    if (trimFringe) {
      const nb = Math.ceil(s.reach / (0.01 * u)) + 2, top = new Float32Array(nb).fill(0);
      for (let i = 0; i < n; i++) {
        const x = P[i * 3]; if (sg * (x - det.cx) < s.armpitDx) continue;
        const d = [x - piv[0], P[i * 3 + 1] - piv[1], P[i * 3 + 2] - piv[2]];
        const t = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
        const up = d[1] - t * ax[1];
        const k = Math.max(0, Math.min(nb - 1, Math.floor(t / (0.01 * u))));
        if (up > top[k]) top[k] = up;
      }
      // robust: running median over +-4 cm
      const rTop = top.map((_, k) => { const w = []; for (let d = -4; d <= 4; d++) { const v = top[Math.max(0, Math.min(nb - 1, k + d))]; if (v > 0) w.push(v); } w.sort((a, b) => a - b); return w.length ? w[w.length >> 1] : 0.04 * u; });
      rAt = t => rTop[Math.max(0, Math.min(rTop.length - 1, Math.floor(t / (0.01 * u))))];
    }
    let moved = 0, held = 0, trimmed = 0;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (sg * (x - det.cx) < 0) continue;
      const d = [x - piv[0], y - piv[1], z - piv[2]];
      const t = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
      const perp = Math.hypot(d[0] - t * ax[0], d[1] - t * ax[1], d[2] - t * ax[2]);
      const dx = sg * (x - det.cx);
      if (trimFringe && dx > s.armpitDx + 0.01 * u && y < armpitY - 0.005 * u) {
        const below = -(d[1] - t * ax[1]);
        const wl = wall(y)[wi];
        if (below > 1.3 * rAt(t) + 0.012 * u && dx > wl + 0.02 * u && y > yHip) { drop[i] = 1; trimmed++; }
      }
      // along-axis blend across the shoulder; radial falloff keeps the torso/hips (far from the axis) fixed
      let w = ss(-band * u, band * u, t) * (1 - ss(radius * u, (radius + 0.06) * u, perp + Math.max(0, -t)));
      if (torsoGuard && w > 0 && y < armpitY) {
        // below the armpit only vertices outside the torso wall follow the arm (smooth over 2.5 cm)
        const wl = wall(y)[wi];
        const g = ss(wl + 0.005 * u, wl + 0.03 * u, dx);
        const fade = ss(armpitY - 0.03 * u, armpitY, y); // blend into the unguarded rule at the armpit
        const k = fade + (1 - fade) * g;
        if (k < 1) held++;
        w *= k;
      }
      if (w <= 0) continue;
      const a = ang * w, c = Math.cos(a), si = Math.sin(a);
      pos[i * 3] = piv[0] + c * d[0] - si * d[1];
      pos[i * 3 + 1] = piv[1] + si * d[0] + c * d[1];
      moved++;
    }
    log.sides[key] = {armpitDxNative: +s.armpitDx.toFixed(4), shoulderPivotNative: s.pivot.map(v => +v.toFixed(4)), armAngleFromHorizontalDeg: +s.angleFromHorizontalDeg.toFixed(1), rotationDeg: +(ang * 180 / Math.PI).toFixed(1), verticesMoved: moved, verticesHeldByTorsoGuard: held, fringeVerticesTrimmed: trimmed};
  }
  let idx = master.idx;
  if (trimFringe) {
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) if (!drop[idx[t]] && !drop[idx[t + 1]] && !drop[idx[t + 2]]) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    log.fringeTrianglesRemoved = (idx.length - keep.length) / 3;
    idx = Uint32Array.from(keep);
  }
  return {...master, pos, idx, nrm: computeNormals(pos, idx), repose: log};
}
