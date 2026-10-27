// Worker for bake.mjs (adapted from tools/asset-pipeline/zombie/lib/bake-worker.mjs, which stays
// untouched): closest facing-compatible master point per texel (cage-ray override), then colour /
// MR sampling there plus a tangent-space normal from the master's interpolated vertex normals.
import {workerData, parentPort} from 'node:worker_threads';

const D = workerData;
const {hpos, hidx, huv, hfn, hnrm, gstart, gtris, gmin, gdims, cell, base, baseW, baseH, mr, mrW, mrH, jP, jN, jTB, jpx, outBase, outMR, outNrm, outDist, outDev, maxShell, backfacePenalty, normalBlend} = D;

const res = new Float64Array(5);
function closestOnTri(px, py, pz, t) {
  const a = hidx[t * 3] * 3, b = hidx[t * 3 + 1] * 3, c = hidx[t * 3 + 2] * 3;
  const ax = hpos[a], ay = hpos[a + 1], az = hpos[a + 2];
  const abx = hpos[b] - ax, aby = hpos[b + 1] - ay, abz = hpos[b + 2] - az;
  const acx = hpos[c] - ax, acy = hpos[c + 1] - ay, acz = hpos[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let v, w;
  if (d1 <= 0 && d2 <= 0) { v = 0; w = 0; }
  else {
    const bpx = px - hpos[b], bpy = py - hpos[b + 1], bpz = pz - hpos[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { v = 1; w = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); w = 0; }
      else {
        const cpx = px - hpos[c], cpy = py - hpos[c + 1], cpz = pz - hpos[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { v = 0; w = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { v = 0; w = d2 / (d2 - d6); }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); v = 1 - w; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; }
          }
        }
      }
    }
  }
  res[0] = ax + abx * v + acx * w; res[1] = ay + aby * v + acy * w; res[2] = az + abz * v + acz * w; res[3] = v; res[4] = w;
}

function sample(tex, W, H, u, v, out, o) {
  const x = Math.min(W - 1, Math.max(0, u * W - 0.5)), y = Math.min(H - 1, Math.max(0, v * H - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  for (let k = 0; k < 4; k++) {
    const c00 = tex[(y0 * W + x0) * 4 + k], c10 = tex[(y0 * W + x1) * 4 + k], c01 = tex[(y1 * W + x0) * 4 + k], c11 = tex[(y1 * W + x1) * 4 + k];
    out[o + k] = Math.round((c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy);
  }
}

function rayTri(ox, oy, oz, dx, dy, dz, t) {
  const a = hidx[t * 3] * 3, b = hidx[t * 3 + 1] * 3, c = hidx[t * 3 + 2] * 3;
  const e1x = hpos[b] - hpos[a], e1y = hpos[b + 1] - hpos[a + 1], e1z = hpos[b + 2] - hpos[a + 2];
  const e2x = hpos[c] - hpos[a], e2y = hpos[c + 1] - hpos[a + 1], e2z = hpos[c + 2] - hpos[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const sx = ox - hpos[a], sy = oy - hpos[a + 1], sz = oz - hpos[a + 2];
  const v = (sx * px + sy * py + sz * pz) * inv;
  if (v < 0 || v > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const w = (dx * qx + dy * qy + dz * qz) * inv;
  if (w < 0 || v + w > 1) return -1;
  res[3] = v; res[4] = w;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/** Solve [T | B | N] m = r (3x3, Cramer). */
function solve3(T, B, N, r) {
  const det = T[0] * (B[1] * N[2] - B[2] * N[1]) - B[0] * (T[1] * N[2] - T[2] * N[1]) + N[0] * (T[1] * B[2] - T[2] * B[1]);
  if (Math.abs(det) < 1e-12) return null;
  const dx = r[0] * (B[1] * N[2] - B[2] * N[1]) - B[0] * (r[1] * N[2] - r[2] * N[1]) + N[0] * (r[1] * B[2] - r[2] * B[1]);
  const dy = T[0] * (r[1] * N[2] - r[2] * N[1]) - r[0] * (T[1] * N[2] - T[2] * N[1]) + N[0] * (T[1] * r[2] - T[2] * r[1]);
  const dz = T[0] * (B[1] * r[2] - B[2] * r[1]) - B[0] * (T[1] * r[2] - T[2] * r[1]) + r[0] * (T[1] * B[2] - T[2] * B[1]);
  return [dx / det, dy / det, dz / det];
}

const [DX, DY, DZ] = gdims;
const cage = D.cage, below = D.rayBelow;
let rayUsed = 0;
for (let j = D.from; j < D.to; j++) {
  const px = jP[j * 3], py = jP[j * 3 + 1], pz = jP[j * 3 + 2];
  const nx = jN[j * 3], ny = jN[j * 3 + 1], nz = jN[j * 3 + 2];
  const cx = Math.floor((px - gmin[0]) / cell), cy = Math.floor((py - gmin[1]) / cell), cz = Math.floor((pz - gmin[2]) / cell);
  let best = Infinity, bestT = -1, bv = 0, bw = 0, bestD = 0;
  for (let r = 0; r <= maxShell; r++) {
    for (let z = cz - r; z <= cz + r; z++) {
      if (z < 0 || z >= DZ) continue;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= DY) continue;
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= DX) continue;
          if (r > 0 && Math.abs(x - cx) < r && Math.abs(y - cy) < r && Math.abs(z - cz) < r) continue;
          const ci = (z * DY + y) * DX + x;
          for (let k = gstart[ci]; k < gstart[ci + 1]; k++) {
            const t = gtris[k];
            closestOnTri(px, py, pz, t);
            const dx = res[0] - px, dy = res[1] - py, dz = res[2] - pz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const facing = hfn[t * 3] * nx + hfn[t * 3 + 1] * ny + hfn[t * 3 + 2] * nz;
            const score = d + (facing < 0 ? backfacePenalty : 0) + (facing < 0.3 ? 0.002 * (0.3 - facing) : 0);
            if (score < best) { best = score; bestT = t; bv = res[3]; bw = res[4]; bestD = d; }
          }
        }
      }
    }
    if (best <= r * cell) break;
  }
  if (cage > 0) {
    const ox = px + nx * cage, oy = py + ny * cage, oz = pz + nz * cage;
    const tMax = cage + below;
    const ex = ox - nx * tMax, ey = oy - ny * tMax, ez = oz - nz * tMax;
    const x0 = Math.max(0, Math.floor((Math.min(ox, ex) - gmin[0]) / cell)), x1 = Math.min(DX - 1, Math.floor((Math.max(ox, ex) - gmin[0]) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(oy, ey) - gmin[1]) / cell)), y1 = Math.min(DY - 1, Math.floor((Math.max(oy, ey) - gmin[1]) / cell));
    const z0 = Math.max(0, Math.floor((Math.min(oz, ez) - gmin[2]) / cell)), z1 = Math.min(DZ - 1, Math.floor((Math.max(oz, ez) - gmin[2]) / cell));
    let hitT = Infinity, hitTri = -1, hv = 0, hw = 0;
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ci = (z * DY + y) * DX + x;
      for (let k = gstart[ci]; k < gstart[ci + 1]; k++) {
        const t = gtris[k];
        if (hfn[t * 3] * nx + hfn[t * 3 + 1] * ny + hfn[t * 3 + 2] * nz < 0.2) continue;
        const th = rayTri(ox, oy, oz, -nx, -ny, -nz, t);
        if (th >= 0 && th <= tMax && th < hitT) { hitT = th; hitTri = t; hv = res[3]; hw = res[4]; }
      }
    }
    if (hitTri >= 0 && (bestT < 0 || hitTri !== bestT)) {
      const hd = Math.abs(cage - hitT);
      if (bestT < 0 || hd <= bestD + 0.012) { bestT = hitTri; bv = hv; bw = hw; bestD = hd; rayUsed++; }
    }
  }
  const o = jpx[j] * 4;
  if (bestT < 0) { outDist[j] = -1; continue; }
  outDist[j] = bestD;
  const a = hidx[bestT * 3], b = hidx[bestT * 3 + 1], c = hidx[bestT * 3 + 2];
  const bu = 1 - bv - bw;
  const u = bu * huv[a * 2] + bv * huv[b * 2] + bw * huv[c * 2];
  const v = bu * huv[a * 2 + 1] + bv * huv[b * 2 + 1] + bw * huv[c * 2 + 1];
  sample(base, baseW, baseH, u, v, outBase, o);
  sample(mr, mrW, mrH, u, v, outMR, o);
  // master normal at the chosen point (interpolated vertex normals), kept on the visible side
  let hx = bu * hnrm[a * 3] + bv * hnrm[b * 3] + bw * hnrm[c * 3];
  let hy = bu * hnrm[a * 3 + 1] + bv * hnrm[b * 3 + 1] + bw * hnrm[c * 3 + 1];
  let hz = bu * hnrm[a * 3 + 2] + bv * hnrm[b * 3 + 2] + bw * hnrm[c * 3 + 2];
  let hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
  let dn = hx * nx + hy * ny + hz * nz;
  if (dn < 0.25) { const k = 0.25 - dn; hx += nx * k; hy += ny * k; hz += nz * k; hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl; }
  // blend toward the low normal (fur strand normals are noisy)
  hx = nx + (hx - nx) * normalBlend; hy = ny + (hy - ny) * normalBlend; hz = nz + (hz - nz) * normalBlend;
  hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
  dn = Math.max(-1, Math.min(1, hx * nx + hy * ny + hz * nz));
  outDev[j] = Math.acos(dn) * 180 / Math.PI;
  const T = [jTB[j * 6], jTB[j * 6 + 1], jTB[j * 6 + 2]], B = [jTB[j * 6 + 3], jTB[j * 6 + 4], jTB[j * 6 + 5]];
  const m = solve3(T, B, [nx, ny, nz], [hx, hy, hz]);
  let ex2 = 0, ey2 = 0, ez2 = 1;
  if (m && m[2] > 0) {
    // decode is normalize(T*x - B*y + N*z): y = -m[1]
    ex2 = m[0]; ey2 = -m[1]; ez2 = m[2];
    const s = Math.max(1, Math.abs(ex2), Math.abs(ey2), Math.abs(ez2));
    ex2 /= s; ey2 /= s; ez2 /= s;
  }
  outNrm[o] = Math.round((ex2 * 0.5 + 0.5) * 255); outNrm[o + 1] = Math.round((ey2 * 0.5 + 0.5) * 255); outNrm[o + 2] = Math.round((ez2 * 0.5 + 0.5) * 255); outNrm[o + 3] = 255;
}
parentPort.postMessage({rayUsed});
