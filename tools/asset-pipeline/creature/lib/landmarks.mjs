// Quadruped skeleton auto-placed from mesh landmarks of the PLACED dense mesh (+Z forward, +Y up,
// +X = creature left, paws on y = 0):
//   midline profile   (|x| small, 1 cm z bins): back line (max y) and underside (min y) -> spine
//                      height, chest bottom (elbow level), flank fold (stifle level), rump end;
//   leg tracking      horizontal slices from each paw contact upward, following the slice centroid
//                      (handles angled legs) -> carpus/hock, elbow/stifle heights on the real leg;
//   head              nose tip = most forward midline point; ear tips = highest lateral points of
//                      the head block; skull base just behind the ears;
//   tail              vertices behind the rump end, Dijkstra geodesic distance from the tail root
//                      ring, centroids of equal-distance bands -> a joint chain along the actual curl.
// Anatomical ratios (where the mesh gives no direct landmark, e.g. the shoulder/hip joint inside the
// body) are explicit constants below and reported in the provenance.

export const RATIOS = {
  carpusOfElbow: 0.33,      // front foot joint height as a fraction of the elbow height
  hockOfStifle: 0.5,        // hind foot joint height as a fraction of the stifle height
  shoulderUp: 0.66,         // front leg pivot (upper scapula; scapula + humerus form the Upper bone):
                            //   this fraction from elbow height up to the back line
  shoulderFwd: 0.01,        // ... and this far (m) forward of the elbow
  hipUp: 0.55,              // hip joint: fraction from stifle height up to the rump top
  hipBack: 0.07,            // ... and this far (m) behind the stifle
  upperInset: 0.72,         // hip joints sit at this fraction of the leg's lateral offset
  scapulaInset: 0.62,       // front pivots (on the scapula, close to the spine)
  spineFrac: 0.6,           // spine height between underside and back line
  headBehindNeck: 0.01,     // skull-base joint this far (m) in front of the narrowest neck section
  headJointFrac: 0.6,       // ... at this fraction of the head's height (underside -> top)
  jawHinge: 0.28,           // jaw hinge at this fraction from the skull base to the nose tip
  tailBones: 5,
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const r4 = v => +v.toFixed(4);
const r4v = a => a.map(r4);

/** Midline profile in 1 cm z bins. */
function midlineProfile(P, halfWidth = 0.03, bin = 0.01) {
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
  const nb = Math.ceil((z1 - z0) / bin) + 1;
  const lo = new Float32Array(nb).fill(Infinity), hi = new Float32Array(nb).fill(-Infinity);
  for (let i = 0; i < P.length; i += 3) {
    if (Math.abs(P[i]) > halfWidth) continue;
    const k = Math.floor((P[i + 2] - z0) / bin);
    const y = P[i + 1];
    if (y < lo[k]) lo[k] = y; if (y > hi[k]) hi[k] = y;
  }
  const at = (z, arr) => {
    const k = Math.max(0, Math.min(nb - 1, Math.floor((z - z0) / bin)));
    // nearest filled bin
    for (let d = 0; d < nb; d++) { for (const kk of [k - d, k + d]) if (kk >= 0 && kk < nb && Number.isFinite(arr[kk])) return arr[kk]; }
    return NaN;
  };
  return {z0, z1, bin, nb, lo, hi, minY: z => at(z, lo), maxY: z => at(z, hi)};
}

/** Leg centreline by horizontal slices from the paw upward. */
function trackLeg(P, paw, sideSign, topY, {step = 0.01, radius = 0.11} = {}) {
  const pts = [];
  let c = [paw[0], paw[2]];
  // a paw lifted mid-stride: start at its own lowest point
  let y0 = Infinity;
  for (let i = 0; i < P.length; i += 3) if (P[i] * sideSign > 0.02 && Math.hypot(P[i] - paw[0], P[i + 2] - paw[2]) < 0.08 && P[i + 1] < y0) y0 = P[i + 1];
  for (let y = y0 + 0.01; y <= topY; y += step) {
    let sx = 0, sz = 0, cnt = 0;
    for (let i = 0; i < P.length; i += 3) {
      const py = P[i + 1];
      if (py < y - step / 2 || py >= y + step / 2) continue;
      const x = P[i], z = P[i + 2];
      if (x * sideSign < 0.02) continue; // never cross the midline to the other leg
      if (Math.hypot(x - c[0], z - c[1]) > radius) continue;
      sx += x; sz += z; cnt++;
    }
    if (cnt < 8) break;
    c = [sx / cnt, sz / cnt];
    pts.push([c[0], y, c[1]]);
  }
  return pts;
}

function legAt(pts, y) {
  if (!pts.length) return null;
  let best = pts[0];
  for (const p of pts) if (Math.abs(p[1] - y) < Math.abs(best[1] - y)) best = p;
  return [best[0], y, best[2]];
}

/** Dijkstra over a vertex subset (mask) of a welded mesh; returns distances (Infinity = unreached). */
export function geodesic(P, idx, mask, sources) {
  const n = P.length / 3;
  const adj = Array.from({length: n}, () => []);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      if (!mask[a] || !mask[b]) continue;
      adj[a].push(b); adj[b].push(a);
    }
  }
  const dist = new Float64Array(n).fill(Infinity);
  // binary heap
  const heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of sources) { dist[s] = 0; push(0, s); }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const u of adj[v]) {
      const nd = d + Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]);
      if (nd < dist[u]) { dist[u] = nd; push(nd, u); }
    }
  }
  return dist;
}

/**
 * @param dense {pos, idx} welded placed dense mesh
 * @param paws {frontL, frontR, hindL, hindR} contact points from placement
 */
export function detectQuadruped(dense, paws) {
  const P = dense.pos;
  const prof = midlineProfile(P);
  const zF = (paws.frontL[2] + paws.frontR[2]) / 2, zH = (paws.hindL[2] + paws.hindR[2]) / 2;
  const spineY = z => prof.minY(z) + RATIOS.spineFrac * (prof.maxY(z) - prof.minY(z));
  // underside levels at the legs: chest bottom (elbow) and flank fold (stifle). Between the legs the
  // midline underside is the belly; at the legs themselves it is the chest / groin between them.
  const chestBottom = prof.minY(zF), groin = prof.minY(zH);
  // ---- legs ------------------------------------------------------------------------------
  const legs = {};
  const L = {};
  for (const [key, pawKey, end] of [['L_Front', 'frontL', 'front'], ['R_Front', 'frontR', 'front'], ['L_Hind', 'hindL', 'hind'], ['R_Hind', 'hindR', 'hind']]) {
    const paw = paws[pawKey], sg = paw[0] > 0 ? 1 : -1;
    const top = end === 'front' ? chestBottom : groin;
    const pts = trackLeg(P, paw, sg, top + 0.02);
    legs[key] = pts;
    const lowerY = top * (end === 'front' ? 1.0 : 0.98);
    const lower = legAt(pts, lowerY) ?? [paw[0], lowerY, paw[2]];
    const footY = lowerY * (end === 'front' ? RATIOS.carpusOfElbow : RATIOS.hockOfStifle);
    const foot = legAt(pts, footY) ?? [paw[0], footY, paw[2]];
    let upper;
    if (end === 'front') {
      const backY = prof.maxY(lower[2]);
      upper = [lower[0] * RATIOS.scapulaInset, lower[1] + RATIOS.shoulderUp * (backY - lower[1]), lower[2] + RATIOS.shoulderFwd];
    } else {
      const z = lower[2] - RATIOS.hipBack;
      const rumpTop = prof.maxY(z);
      upper = [lower[0] * RATIOS.upperInset, lower[1] + RATIOS.hipUp * (rumpTop - lower[1]), z];
    }
    // toe tip: the most forward contact vertex of this paw
    const sole = pts.length ? pts[0][1] - 0.01 : 0;
    let toe = [paw[0], sole + 0.012, paw[2]], best = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i + 1] > sole + 0.04 || (P[i] > 0 ? 1 : -1) !== sg || Math.hypot(P[i] - paw[0], P[i + 2] - paw[2]) > 0.13) continue;
      if (P[i + 2] > best) { best = P[i + 2]; toe = [P[i], sole + 0.012, P[i + 2]]; }
    }
    L[key] = {upper, lower, foot, toe, paw};
  }
  // the shoulder / hip girdles are symmetric even when the stance is not (a tucked or lifted leg)
  for (const end of ['Front', 'Hind']) {
    const a = L[`L_${end}`].upper, b = L[`R_${end}`].upper;
    const x = (Math.abs(a[0]) + Math.abs(b[0])) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2;
    L[`L_${end}`].upper = [x, y, z]; L[`R_${end}`].upper = [-x, y, z];
  }
  // ---- spine -------------------------------------------------------------------------------
  const sym = (a, b) => [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const hipC = sym(L.L_Hind.upper, L.R_Hind.upper);
  const shC = sym(L.L_Front.upper, L.R_Front.upper);
  const Hips = [0, hipC[1] + 0.02, hipC[2]];
  const chestZ = shC[2] - 0.06;
  const Chest = [0, spineY(chestZ), chestZ];
  const Spine1 = [0, spineY(Hips[2] + (chestZ - Hips[2]) / 3), Hips[2] + (chestZ - Hips[2]) / 3];
  const Spine2 = [0, spineY(Hips[2] + 2 * (chestZ - Hips[2]) / 3), Hips[2] + 2 * (chestZ - Hips[2]) / 3];
  // ---- head --------------------------------------------------------------------------------
  let nose = null;
  for (let i = 0; i < P.length; i += 3) {
    if (Math.abs(P[i]) > 0.03 || P[i + 1] < 0.12) continue;
    if (!nose || P[i + 2] > nose[2]) nose = [0, P[i + 1], P[i + 2]];
  }
  // neck: the first narrowest lateral cross-section (|x| of vertices above the chest underside)
  // forward of the front legs; the skull starts just in front of it
  const halfW = z => {
    let w = 0;
    for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 2] - z) < 0.01 && P[i + 1] > chestBottom) w = Math.max(w, Math.abs(P[i]));
    return w;
  };
  // scan forward from the front paws: shoulders narrow into the neck, then the cheeks widen again
  let neckZ = zF, neckW = Infinity;
  for (let z = zF; z <= nose[2] - 0.08; z += 0.01) {
    const w = halfW(z);
    if (w < neckW) { neckW = w; neckZ = z; } else if (w > neckW * 1.1) break;
  }
  const headZ = neckZ + RATIOS.headBehindNeck;
  const headMid = z => prof.minY(z) + RATIOS.headJointFrac * (prof.maxY(z) - prof.minY(z));
  const Head = [0, headMid(headZ + 0.04), headZ];
  const neckBaseZ = Chest[2] + 0.5 * (Head[2] - Chest[2]);
  const Neck = [0, Math.max(spineY(neckBaseZ), Head[1]), neckBaseZ];
  const jawZ = Head[2] + RATIOS.jawHinge * (nose[2] - Head[2]);
  const Jaw = [0, prof.minY(jawZ) + 0.35 * (prof.maxY(jawZ) - prof.minY(jawZ)), jawZ];
  const chinZ = nose[2] - 0.035;
  const chin = [0, prof.minY(chinZ) + 0.012, chinZ];
  const headTop = [0, prof.maxY(headZ + 0.04), headZ + 0.04];
  // ears (debug only): highest lateral points just in front of the neck
  let earL = null, earR = null;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (z < neckZ || z > neckZ + 0.12 || Math.abs(x) < 0.04) continue;
    if (x > 0 && (!earL || y > earL[1])) earL = [x, y, z];
    if (x < 0 && (!earR || y > earR[1])) earR = [x, y, z];
  }
  const earZ = neckZ;
  // ---- tail --------------------------------------------------------------------------------
  // rump end: scanning backward from the hind legs, where the midline thickness first drops
  // below 40 % of the thickness at the hips
  const thick = z => prof.maxY(z) - prof.minY(z);
  const t0 = thick(Hips[2]);
  let rootZ = Hips[2];
  for (let z = Hips[2]; z > prof.z0; z -= 0.005) { rootZ = z; if (thick(z) < 0.4 * t0) break; }
  const n = P.length / 3;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (P[i * 3 + 2] < rootZ + 0.03 && P[i * 3 + 1] > 0.1 && Math.abs(P[i * 3]) < 0.12) mask[i] = 1;
  const sources = [];
  for (let i = 0; i < n; i++) if (mask[i] && P[i * 3 + 2] > rootZ) sources.push(i);
  const dist = geodesic(P, dense.idx, mask, sources);
  let maxD = 0;
  for (let i = 0; i < n; i++) if (mask[i] && Number.isFinite(dist[i]) && dist[i] > maxD) maxD = dist[i];
  const NB = RATIOS.tailBones;
  const band = k => {
    const d0 = maxD * k / NB, w = maxD * 0.04;
    let sx = 0, sy = 0, sz = 0, c = 0;
    for (let i = 0; i < n; i++) if (mask[i] && Math.abs(dist[i] - d0) < w) { sx += P[i * 3]; sy += P[i * 3 + 1]; sz += P[i * 3 + 2]; c++; }
    return c ? [sx / c, sy / c, sz / c] : null;
  };
  const tail = [];
  for (let k = 0; k <= NB; k++) tail.push(band(k === NB ? NB - 0.02 : k + (k === 0 ? 0.04 : 0)));
  // tail tip: farthest tail vertex
  let tipI = -1;
  for (let i = 0; i < n; i++) if (mask[i] && Number.isFinite(dist[i]) && (tipI < 0 || dist[i] > dist[tipI])) tipI = i;
  const tailTip = [P[tipI * 3], P[tipI * 3 + 1], P[tipI * 3 + 2]];
  const tailMask = mask, tailDist = dist;
  if (tail[0]) tail[0] = [0, tail[0][1], tail[0][2]]; // the tail root sits on the midline
  const joints = {
    Root: [0, 0, 0], Hips, Spine1, Spine2, Chest, Neck, Head, Jaw,
    Tail1: tail[0], Tail2: tail[1], Tail3: tail[2], Tail4: tail[3], Tail5: tail[4],
  };
  for (const s of ['L', 'R']) {
    for (const end of ['Front', 'Hind']) {
      const l = L[`${s}_${end}`];
      joints[`${s}_${end}Upper`] = l.upper; joints[`${s}_${end}Lower`] = l.lower; joints[`${s}_${end}Foot`] = l.foot;
    }
  }
  const ends = {Head: nose, Jaw: chin, Tail5: tail[5] ?? tailTip, tailTip, headTop, earL, earR};
  for (const s of ['L', 'R']) for (const end of ['Front', 'Hind']) ends[`${s}_${end}Foot`] = L[`${s}_${end}`].toe;
  const out = {joints: {}, ends: {}};
  for (const [k, v] of Object.entries(joints)) out.joints[k] = r4v(v);
  for (const [k, v] of Object.entries(ends)) out.ends[k] = r4v(v);
  return {
    ...out,
    measures: {zFrontPaws: r4(zF), zHindPaws: r4(zH), chestBottomY: r4(chestBottom), groinY: r4(groin), rumpEndZ: r4(rootZ), tailGeodesicLengthM: r4(maxD),
      noseZ: r4(nose[2]), neckZ: r4(neckZ), neckHalfWidth: r4(neckW), backAtChestY: r4(prof.maxY(Chest[2])), backAtHipsY: r4(prof.maxY(Hips[2])), legSlices: Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, v.length]))},
    ratios: RATIOS,
    debug: {legs, tailMask, tailDist},
    _sanity: (() => { const issues = []; for (const [k, v] of Object.entries(out.joints)) if (!v.every(Number.isFinite)) issues.push(k); for (const s of ['L', 'R']) for (const e of ['Front', 'Hind']) { const l = L[`${s}_${e}`]; if (!(l.upper[1] > l.lower[1] && l.lower[1] > l.foot[1] && l.foot[1] > 0)) issues.push(`${s}_${e} joint heights not ordered`); } if (len(sub(nose, Head ?? [0, 0, 0])) < 0.05) issues.push('head too short'); return issues; })(),
  };
}
