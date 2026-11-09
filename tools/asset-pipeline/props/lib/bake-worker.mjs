// Bake worker: for each low-poly surface sample (position + interpolated normal, in source units),
// find the closest dense triangle whose geometric normal faces the same way (fallback: any
// orientation), then sample the dense UV -> source base colour / metallic-roughness (bilinear)
// and the interpolated dense vertex normal. Pure function of its inputs: deterministic.
import {parentPort, workerData} from 'node:worker_threads';

const d = workerData;
const P = new Float32Array(d.P), N = new Float32Array(d.N), UV = new Float32Array(d.UV), I = new Uint32Array(d.I), FN = new Float32Array(d.FN);
const cellStart = new Uint32Array(d.cellStart), cellTris = new Uint32Array(d.cellTris);
const BC = new Uint8Array(d.BC), MR = new Uint8Array(d.MR);
const S = new Float32Array(d.samples);
const oC = new Uint8Array(d.outColor), oM = new Uint8Array(d.outMR), oN = new Float32Array(d.outN), oS = new Uint8Array(d.outStatus), oD = new Float32Array(d.outDist);
const counter = new Int32Array(d.counter);
const {ox, oy, oz, h, dx, dy, dz, rmax, texW, texH, nSamples, chunk} = d;

let bu = 0, bv = 0, bw = 0;
function closest(px, py, pz, t) {
  const ia = 3 * I[3 * t], ib = 3 * I[3 * t + 1], ic = 3 * I[3 * t + 2];
  const ax = P[ia], ay = P[ia + 1], az = P[ia + 2];
  const abx = P[ib] - ax, aby = P[ib + 1] - ay, abz = P[ib + 2] - az;
  const acx = P[ic] - ax, acy = P[ic + 1] - ay, acz = P[ic + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else {
    const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t1 = d1 / (d1 - d3); u = 1 - t1; v = t1; w = 0; }
      else {
        const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t2 = d2 / (d2 - d6); u = 1 - t2; v = 0; w = t2; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const t3 = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - t3; w = t3; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
          }
        }
      }
    }
  }
  const qx = ax + abx * v + acx * w - px, qy = ay + aby * v + acy * w - py, qz = az + abz * v + acz * w - pz;
  bu = u; bv = v; bw = w;
  return qx * qx + qy * qy + qz * qz;
}

function bilinear(tex, u, v, out, o) {
  let x = u * texW - 0.5, y = v * texH - 0.5;
  let x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  let x1 = x0 + 1, y1 = y0 + 1;
  x0 = x0 < 0 ? 0 : x0 >= texW ? texW - 1 : x0; x1 = x1 < 0 ? 0 : x1 >= texW ? texW - 1 : x1;
  y0 = y0 < 0 ? 0 : y0 >= texH ? texH - 1 : y0; y1 = y1 < 0 ? 0 : y1 >= texH ? texH - 1 : y1;
  const i00 = 4 * (y0 * texW + x0), i10 = 4 * (y0 * texW + x1), i01 = 4 * (y1 * texW + x0), i11 = 4 * (y1 * texW + x1);
  for (let c = 0; c < 4; c++) {
    const top = tex[i00 + c] * (1 - fx) + tex[i10 + c] * fx;
    const bot = tex[i01 + c] * (1 - fx) + tex[i11 + c] * fx;
    out[o + c] = top * (1 - fy) + bot * fy;
  }
}

const tmp = new Float32Array(8);
// opt-in source normal map (see bake.mjs): decoded through three's derivative tangent frame of the dense face (inverse of encodeNormal)
const NM = d.NM ? new Uint8Array(d.NM) : null, DG = d.DG ? new Float32Array(d.DG) : null;
const tmpN = new Float32Array(4);
function processSample(s) {
  const px = S[6 * s], py = S[6 * s + 1], pz = S[6 * s + 2], nx = S[6 * s + 3], ny = S[6 * s + 4], nz = S[6 * s + 5];
  let cx = Math.floor((px - ox) / h), cy = Math.floor((py - oy) / h), cz = Math.floor((pz - oz) / h);
  cx = cx < 0 ? 0 : cx >= dx ? dx - 1 : cx; cy = cy < 0 ? 0 : cy >= dy ? dy - 1 : cy; cz = cz < 0 ? 0 : cz >= dz ? dz - 1 : cz;
  let bestF = Infinity, triF = -1, fu = 0, fv = 0, fw = 0;
  let bestA = Infinity, triA = -1, au = 0, av = 0, aw = 0;
  for (let r = 1; r <= rmax; r++) {
    const zlo = Math.max(0, cz - r), zhi = Math.min(dz - 1, cz + r);
    const ylo = Math.max(0, cy - r), yhi = Math.min(dy - 1, cy + r);
    const xlo = Math.max(0, cx - r), xhi = Math.min(dx - 1, cx + r);
    for (let z = zlo; z <= zhi; z++) for (let y = ylo; y <= yhi; y++) for (let x = xlo; x <= xhi; x++) {
      if (r > 1 && Math.abs(x - cx) < r && Math.abs(y - cy) < r && Math.abs(z - cz) < r) continue; // inner cells done
      const cell = (z * dy + y) * dx + x;
      for (let k = cellStart[cell], e = cellStart[cell + 1]; k < e; k++) {
        const t = cellTris[k];
        const facing = FN[3 * t] * nx + FN[3 * t + 1] * ny + FN[3 * t + 2] * nz > 0;
        if (!facing && triF >= 0) continue;
        const dd = closest(px, py, pz, t);
        if (facing) { if (dd < bestF) { bestF = dd; triF = t; fu = bu; fv = bv; fw = bw; } }
        if (dd < bestA) { bestA = dd; triA = t; au = bu; av = bv; aw = bw; }
      }
    }
    const lim = r * h;
    if (triF >= 0 && bestF <= lim * lim) break;
  }
  let t, u, v, w, status;
  const lim = rmax * h;
  if (triF >= 0 && bestF <= lim * lim) { t = triF; u = fu; v = fv; w = fw; status = 1; oD[s] = Math.sqrt(bestF); }
  else if (triA >= 0) { t = triA; u = au; v = av; w = aw; status = 2; oD[s] = Math.sqrt(bestA); }
  else { oS[s] = 0; oD[s] = -1; return; }
  const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
  const tu = UV[2 * a] * u + UV[2 * b] * v + UV[2 * c] * w;
  const tv = UV[2 * a + 1] * u + UV[2 * b + 1] * v + UV[2 * c + 1] * w;
  bilinear(BC, tu, tv, tmp, 0);
  bilinear(MR, tu, tv, tmp, 4);
  for (let k = 0; k < 4; k++) oC[4 * s + k] = Math.round(tmp[k]);
  oM[2 * s] = Math.round(tmp[5]); oM[2 * s + 1] = Math.round(tmp[6]);
  let mx = N[3 * a] * u + N[3 * b] * v + N[3 * c] * w, my = N[3 * a + 1] * u + N[3 * b + 1] * v + N[3 * c + 1] * w, mz = N[3 * a + 2] * u + N[3 * b + 2] * v + N[3 * c + 2] * w;
  const l = Math.hypot(mx, my, mz) || 1;
  mx /= l; my /= l; mz /= l;
  if (NM) {
    bilinear(NM, tu, tv, tmpN, 0);
    const x = tmpN[0] / 127.5 - 1, y = tmpN[1] / 127.5 - 1, z = tmpN[2] / 127.5 - 1, g = 9 * t;
    const NdNf = mx * DG[g + 6] + my * DG[g + 7] + mz * DG[g + 8], NdGu = mx * DG[g] + my * DG[g + 1] + mz * DG[g + 2], NdGv = mx * DG[g + 3] + my * DG[g + 4] + mz * DG[g + 5];
    const Tx = DG[g] * NdNf - DG[g + 6] * NdGu, Ty = DG[g + 1] * NdNf - DG[g + 7] * NdGu, Tz = DG[g + 2] * NdNf - DG[g + 8] * NdGu;
    const Bx = DG[g + 3] * NdNf - DG[g + 6] * NdGv, By = DG[g + 4] * NdNf - DG[g + 7] * NdGv, Bz = DG[g + 5] * NdNf - DG[g + 8] * NdGv;
    const m = Math.max(Tx * Tx + Ty * Ty + Tz * Tz, Bx * Bx + By * By + Bz * Bz);
    if (m > 0) {
      const sc = 1 / Math.sqrt(m);
      const nx = (x * Tx - y * Bx) * sc + z * mx, ny = (x * Ty - y * By) * sc + z * my, nz = (x * Tz - y * Bz) * sc + z * mz, ln = Math.hypot(nx, ny, nz);
      if (ln > 0) { mx = nx / ln; my = ny / ln; mz = nz / ln; }
    }
  }
  oN[3 * s] = mx; oN[3 * s + 1] = my; oN[3 * s + 2] = mz;
  oS[s] = status;
}

for (;;) {
  const start = Atomics.add(counter, 0, chunk);
  if (start >= nSamples) break;
  const end = Math.min(nSamples, start + chunk);
  for (let s = start; s < end; s++) processSample(s);
}
parentPort.postMessage('done');
