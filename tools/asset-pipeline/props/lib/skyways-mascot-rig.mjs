// Skyways lane ASSET-C: deterministic GEOMETRIC posing of the (unrigged) convention-mascot statue — region skinning, no provider rig.
//
// Input: one decimated, game-frame mesh {P (xyz, metres, +Y up, front +Z, feet at y 0), N, UV, I} + its base-colour texture (RGB).
// 1. weld by exact position (the mesh is split at UV seams) -> a vertex graph that is continuous across seams;
// 2. per-vertex colour classes from the base colour: HAIR (light blue), MAROON (skirt / straps), BLACK, SKIN; small islands of a
//    class inside another (white hair highlights, blue-tinted skirt shadows) are flipped to the surrounding class;
// 3. per arm: hand seed = lowest skin-coloured vertex beside the skirt; ARM region = flood fill from the seed through non-hair,
//    non-maroon, non-black vertices on the arm side of the sleeve-seam plane (the skirt and the hair stop it), small holes closed;
//    SHOULDER pivot = the arm's cross-section just past the seam plane (centroid x / z, cfg.pivotFrac of its height); TIP = the arm
//    vertex farthest from the shoulder; ELBOW at ELBOW_FRAC along it;
// 4. weights: upper arm = a HARMONIC field over a GEODESIC band (cfg.seamBand) around the whole arm / torso junction near the
//    shoulder (armhole loop incl. the armpit bottom): 1 on the arm outside the band, 0 on torso / hair / skirt, Laplace-solved inside
//    it, so the shoulder bends without tearing; forearm = smoothstep along the arm axis around the elbow; head (+ the upper hair,
//    fading down the hanging hair) and the bow's upper body (smoothstep across the waist; arms and all hair ride along rigidly);
// 5. posing = ANGLE-blended rotations (each vertex turns by weight x angle about the joint; no linear-blend collapse), applied child
//    first (forearm, upper arm, head, waist); normals = the authored normal turned by the vertex rotation, then corrected by the
//    change of the welded geometric normal (only non-zero where the surface actually deforms); UVs / topology / textures unchanged.
// Diagnostics: per-triangle edge stretch, folded triangles, and moved-vs-static triangle intersections (uniform-grid broad phase).

export const ELBOW_FRAC = 0.45;

const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vget = (A, i) => [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];

/** 3x3 rotation (row-major) about unit `axis` by `ang` radians. */
export function rotMat(axis, ang) {
  const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
const mulMV = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const mulMM = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
const transpose = M => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
/** minimal rotation taking unit a onto unit b, as {axis, angle}. */
export function minRot(a, b) {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  let ax = cross(a, b);
  if (Math.hypot(...ax) < 1e-9) ax = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
  return {axis: norm(ax), angle: Math.acos(c)};
}
/** unit direction from elevation (deg above horizontal) and azimuth (deg from the lateral axis toward +Z) for arm side s (+1 = +X). */
export function dirFromElAz(s, el, az) {
  const e = el * Math.PI / 180, a = az * Math.PI / 180;
  return [s * Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}

// ---------------------------------------------------------------------------------------------------------------------------
// mesh graph

export function weld(P) {
  const n = P.length / 3, map = new Map(), W = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = `${P[i * 3]},${P[i * 3 + 1]},${P[i * 3 + 2]}`; let r = map.get(k); if (r === undefined) { r = i; map.set(k, i); } W[i] = r; }
  return W;
}

/** multi-source Dijkstra over the welded graph (edge length = Euclidean), stopping at `limit`; `ok(v)` gates traversal. */
export function geodesic(P, G, n, sources, limit, ok) {
  const dist = new Float32Array(n).fill(Infinity), heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] < heap[i][0] || (heap[p][0] === heap[i][0] && heap[p][1] <= heap[i][1])) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; for (const c of [l, r]) if (c < heap.length && (heap[c][0] < heap[m][0] || (heap[c][0] === heap[m][0] && heap[c][1] < heap[m][1]))) m = c; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of sources) { dist[s] = 0; push(0, s); }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v] || d > limit) continue;
    for (const m of G.nbrs(v)) {
      if (!ok(m)) continue;
      const nd = d + Math.hypot(P[v * 3] - P[m * 3], P[v * 3 + 1] - P[m * 3 + 1], P[v * 3 + 2] - P[m * 3 + 2]);
      if (nd < dist[m]) { dist[m] = nd; push(nd, m); }
    }
  }
  return dist;
}

/** CSR adjacency over weld representatives. */
export function graph(I, W, n) {
  const sets = new Map();
  const add = (a, b) => { let s = sets.get(a); if (!s) sets.set(a, s = new Set()); s.add(b); };
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = W[I[t + e]], b = W[I[t + (e + 1) % 3]]; if (a !== b) { add(a, b); add(b, a); } }
  const off = new Int32Array(n + 1); const list = [];
  for (let v = 0; v < n; v++) { off[v] = list.length; const s = sets.get(v); if (s) for (const m of [...s].sort((x, y) => x - y)) list.push(m); }
  off[n] = list.length;
  return {off, adj: Int32Array.from(list), nbrs(v) { return this.adj.subarray(this.off[v], this.off[v + 1]); }};
}

/**
 * Colour classes per weld representative (any seam copy flagged hair / maroon / black flags the vertex; light needs every copy light),
 * then small ISLANDS are flipped to the class that surrounds them (white hair highlights inside the hair, blue-tinted shadow texels
 * on the skirt underside, stray maroon specks on a sleeve).
 */
export function classify(UV, W, tex, G, reps, island = 40) {
  const n = W.length, hair = new Uint8Array(n), maroon = new Uint8Array(n), black = new Uint8Array(n), light = new Uint8Array(n).fill(1), skin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const u = UV[i * 2] - Math.floor(UV[i * 2]), v = UV[i * 2 + 1] - Math.floor(UV[i * 2 + 1]);
    const x = Math.min(tex.w - 1, Math.floor(u * tex.w)), y = Math.min(tex.h - 1, Math.floor(v * tex.h));
    const o = (y * tex.w + x) * 3, r = tex.data[o], g = tex.data[o + 1], b = tex.data[o + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, rep = W[i];
    if (b > r + 25 && b > g) hair[rep] = 1;
    if (r > g + 25 && lum < 130) maroon[rep] = 1;
    if (lum < 60) black[rep] = 1;
    if (!(lum > 140)) light[rep] = 0;
    if (r > 190 && g > 140 && b > 110 && r > b + 20) skin[rep] = 1;
  }
  const flips = {hair: flipIslands(hair, G, reps, island) + flipIslands(hair, G, reps, island, 0), maroon: flipIslands(maroon, G, reps, 12)};
  for (let i = 0; i < n; i++) if (hair[i] || maroon[i]) light[i] = 0;
  return {hair, maroon, black, light, skin, flips};
}

/** flip connected components of `mask == val` smaller than `max` vertices to the other value; returns the flipped vertex count. */
function flipIslands(mask, G, reps, max, val = 1) {
  const seen = new Uint8Array(mask.length); let flipped = 0;
  for (const s of reps) {
    if (seen[s] || mask[s] !== val) continue;
    const comp = [s]; seen[s] = 1;
    for (let k = 0; k < comp.length; k++) for (const m of G.nbrs(comp[k])) if (!seen[m] && mask[m] === val) { seen[m] = 1; comp.push(m); }
    if (comp.length < max) { for (const v of comp) mask[v] = 1 - val; flipped += comp.length; }
  }
  return flipped;
}

// ---------------------------------------------------------------------------------------------------------------------------
// rig

/**
 * @param mesh {P, N, UV, I}
 * @param tex  base colour {data RGB, w, h}
 * @param cfg  {seam: {x, y, tiltDeg}, seamBand, seamSlab, pivotFrac, shoulderRadius, elbowBand, neck: {y, z, band}, hairFade,
 *              waist: {y, z, band}, hand: {xMin, yMin, yMax}}
 */
export function buildRig(mesh, tex, cfg) {
  const {P, UV, I} = mesh, n = P.length / 3;
  const W = weld(P), G = graph(I, W, n);
  const reps = []; for (let i = 0; i < n; i++) if (W[i] === i) reps.push(i);
  const cls = classify(UV, W, tex, G, reps);
  const passable = v => !cls.hair[v] && !cls.maroon[v] && !cls.black[v];
  const arms = [];
  for (const s of [1, -1]) {
    const tilt = cfg.seam.tiltDeg * Math.PI / 180;
    const C = [s * cfg.seam.x, cfg.seam.y, 0], nrm = [s * Math.cos(tilt), -Math.sin(tilt), 0];
    const side = v => (P[v * 3] - C[0]) * nrm[0] + (P[v * 3 + 1] - C[1]) * nrm[1];
    // hand seed: the lowest skin vertex beside the skirt, in front half
    let seed = -1;
    for (const v of reps) {
      const x = P[v * 3] * s, y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (!cls.skin[v] || cls.hair[v] || x < cfg.hand.xMin || y < cfg.hand.yMin || y > cfg.hand.yMax || z < 0) continue;
      if (seed < 0 || y < P[seed * 3 + 1] || (y === P[seed * 3 + 1] && v < seed)) seed = v;
    }
    if (seed < 0) throw new Error(`arm ${s}: no hand seed`);
    // flood fill
    const inA = new Uint8Array(n); const stack = [seed]; inA[seed] = 1;
    while (stack.length) { const v = stack.pop(); for (const m of G.nbrs(v)) if (!inA[m] && passable(m) && side(m) > 0) { inA[m] = 1; stack.push(m); } }
    // close small holes (dark fold / outline texels inside the arm): non-hair, non-maroon, arm side, >= 2/3 of the neighbours in the arm
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      for (const v of reps) {
        if (inA[v] || cls.hair[v] || cls.maroon[v] || side(v) <= 0) continue;
        const nb = G.nbrs(v); let k = 0; for (const m of nb) k += inA[m];
        if (nb.length && k * 3 >= nb.length * 2) add.push(v);
      }
      for (const v of add) inA[v] = 1;
      if (!add.length) break;
    }
    // shoulder pivot = centroid of the arm's cross-section just past the seam plane; the seam ring = arm vertices bordering the torso
    const slab = reps.filter(v => inA[v] && side(v) <= cfg.seamSlab);
    if (slab.length < 8) throw new Error(`arm ${s}: seam cross-section too small (${slab.length})`);
    // x / z from the cross-section centroid; y at cfg.pivotFrac of its height (the joint sits in the upper part of the armhole),
    // x moved along the tilted seam plane to that height
    const S = [0, 1, 2].map(k => slab.reduce((acc, v) => acc + P[v * 3 + k], 0) / slab.length);
    { const ys = slab.map(v => P[v * 3 + 1]), y0 = Math.min(...ys), y1 = Math.max(...ys), y = y0 + cfg.pivotFrac * (y1 - y0);
      S[0] += s * (y - S[1]) * Math.tan(tilt); S[1] = y; }
    const ring = [];
    for (const v of reps) if (inA[v]) for (const m of G.nbrs(v)) if (!inA[m] && !cls.hair[m] && !cls.maroon[m] && side(m) <= 0) { ring.push(v); break; }
    let tip = seed, best = -1;
    for (const v of reps) if (inA[v]) { const d = Math.hypot(...sub(vget(P, v), S)); if (d > best) { best = d; tip = v; } }
    const T = vget(P, tip), L = best, a = norm(sub(T, S));
    const E = [0, 1, 2].map(k => S[k] + a[k] * L * ELBOW_FRAC);
    // upper-arm weights: harmonic field over the welded graph
    // free = a geodesic band (cfg.seamBand, over the welded surface) around the WHOLE arm / torso junction near the shoulder (the
    // armhole loop including the armpit bottom); arm vertices outside it pinned 1, everything else pinned 0
    const junction = [];
    for (const v of reps) {
      if (cls.hair[v] || Math.hypot(...sub(vget(P, v), S)) > cfg.shoulderRadius) continue;
      for (const m of G.nbrs(v)) if (inA[m] !== inA[v] && !cls.hair[m]) { junction.push(v); break; }
    }
    const gd = geodesic(P, G, n, junction, cfg.seamBand, v => !cls.hair[v]);
    const wU = new Float32Array(n), state = new Uint8Array(n); // 0 pinned 0, 1 pinned 1, 2 free
    for (const v of reps) {
      const near = gd[v] < cfg.seamBand && Math.hypot(...sub(vget(P, v), S)) <= cfg.shoulderRadius;
      state[v] = near ? 2 : inA[v] ? 1 : 0;
      wU[v] = state[v] === 1 ? 1 : state[v] === 2 ? 0.5 : 0;
    }
    const free = reps.filter(v => state[v] === 2);
    for (let it = 0; it < 600; it++) for (const v of free) { const nb = G.nbrs(v); let acc = 0; for (const m of nb) acc += wU[m]; wU[v] = nb.length ? acc / nb.length : 0; }
    // forearm weights
    const wF = new Float32Array(n), tE = L * ELBOW_FRAC;
    for (const v of reps) if (inA[v]) wF[v] = ss(tE - cfg.elbowBand, tE + cfg.elbowBand, dot(sub(vget(P, v), S), a));
    // bridges: arm vertices (wU > 0.9) with a pinned-0 neighbour off the arm
    let bridges = 0; for (const v of reps) if (wU[v] > 0.9) for (const m of G.nbrs(v)) if (state[m] === 0) bridges++;
    let count = 0; for (const v of reps) count += inA[v];
    const slabY = [Math.min(...slab.map(v => P[v * 3 + 1])), Math.max(...slab.map(v => P[v * 3 + 1]))];
    const profile = [];
    for (let t0 = -0.06; t0 < L + 0.02; t0 += 0.02) {
      const rs = reps.filter(v => inA[v]).map(v => { const d = sub(vget(P, v), S), t = dot(d, a); return t >= t0 && t < t0 + 0.02 ? Math.sqrt(Math.max(0, dot(d, d) - t * t)) : -1; }).filter(r => r >= 0).sort((x, y) => x - y);
      if (rs.length) profile.push([+t0.toFixed(2), rs.length, +rs[Math.floor(rs.length / 2)].toFixed(3), +rs[rs.length - 1].toFixed(3)]);
    }
    arms.push({side: s, seed, tip, S, E, T, a, L, inA, wU, wF, ring: ring.length, count, bridges, free: free.length, slabY, profile});
  }
  // head + hair (head tilt) and upper body (bow)
  const wH = new Float32Array(n), wB = new Float32Array(n);
  const onArm = v => arms.some(A => A.wU[v] > 0);
  for (const v of reps) {
    const y = P[v * 3 + 1];
    if (onArm(v)) { wH[v] = 0; wB[v] = 1; continue; }
    if (cls.hair[v]) { wH[v] = ss(cfg.hairFade, cfg.neck.y + cfg.neck.band, y); wB[v] = 1; continue; }
    wH[v] = ss(cfg.neck.y - cfg.neck.band, cfg.neck.y + cfg.neck.band, y);
    wB[v] = ss(cfg.waist.y - cfg.waist.band, cfg.waist.y + cfg.waist.band, y);
  }
  // arms: the bow carries the whole arm (shoulder blend included) — blend wB on the shoulder band with the torso value
  for (const A of arms) for (const v of reps) if (A.wU[v] > 0 && A.wU[v] < 1) { const tb = ss(cfg.waist.y - cfg.waist.band, cfg.waist.y + cfg.waist.band, P[v * 3 + 1]); wB[v] = tb + (1 - tb) * A.wU[v]; }
  const spread = w => { for (let i = 0; i < n; i++) w[i] = w[W[i]]; };
  for (const A of arms) { spread(A.wU); spread(A.wF); spread(A.inA); }
  spread(wH); spread(wB);
  return {W, G, cls, reps, arms, wH, wB, neck: [0, cfg.neck.y, cfg.neck.z], waist: [0, cfg.waist.y, cfg.waist.z]};
}

// ---------------------------------------------------------------------------------------------------------------------------
// posing

/**
 * spec: {arms?: {[side]: {upper: [el, az], fore?: [el, az]}}, head?: {axis: [x,y,z], deg}, bow?: deg}
 * Arm directions are given in the TORSO frame (before the bow). Returns {P, N, R (per-vertex 3x3 rotation, for diagnostics)}.
 */
export function pose(mesh, rig, spec) {
  const {P, N} = mesh, n = P.length / 3;
  const out = new Float32Array(P.length), R = new Array(n);
  const chains = [];
  const RbowT = spec.bow ? transpose(rotMat([1, 0, 0], spec.bow * Math.PI / 180)) : null;
  for (const A of rig.arms) {
    const ps = spec.arms?.[A.side];
    if (!ps) continue;
    // 'rest' = the authored hanging direction; world: true = the directions are wanted AFTER the bow (converted to the torso frame)
    const dir = d => d === 'rest' ? A.a : dirFromElAz(A.side, ...d);
    const toTorso = d => ps.world && RbowT ? norm(mulMV(RbowT, d)) : d;
    const du = toTorso(dir(ps.upper)), df = ps.fore ? toTorso(dir(ps.fore)) : du;
    const ru = minRot(A.a, du), Ru = rotMat(ru.axis, ru.angle);
    const rf = minRot(A.a, norm(mulMV(transpose(Ru), df)));
    chains.push({A, ru, rf});
  }
  const head = spec.head ? {axis: norm(spec.head.axis), ang: spec.head.deg * Math.PI / 180} : null;
  const bow = spec.bow ? {axis: [1, 0, 0], ang: spec.bow * Math.PI / 180} : null;
  for (let i = 0; i < n; i++) {
    let p = vget(P, i), M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const turn = (axis, ang, pivot) => { if (!ang) return; const Rm = rotMat(axis, ang); p = sub(mulMV(Rm, sub(p, pivot)), [-pivot[0], -pivot[1], -pivot[2]]); M = mulMM(Rm, M); };
    for (const {A, ru, rf} of chains) {
      if (A.wF[i] > 0) turn(rf.axis, rf.angle * A.wF[i], A.E);
      if (A.wU[i] > 0) turn(ru.axis, ru.angle * A.wU[i], A.S);
    }
    if (head && rig.wH[i] > 0) turn(head.axis, head.ang * rig.wH[i], rig.neck);
    if (bow && rig.wB[i] > 0) turn(bow.axis, bow.ang * rig.wB[i], rig.waist);
    out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2]; R[i] = M;
  }
  // normals: authored normal turned by the vertex rotation, corrected by the change of the welded geometric normal
  const G0 = geomNormals(P, mesh.I, rig.W), G1 = geomNormals(out, mesh.I, rig.W);
  const outN = new Float32Array(N.length);
  for (let i = 0; i < n; i++) {
    let v = mulMV(R[i], vget(N, i));
    const g0 = norm(mulMV(R[i], vget(G0, rig.W[i]))), g1 = vget(G1, rig.W[i]);
    if (Math.hypot(...g1) > 0.5 && dot(g0, g1) < 0.99999) { const c = minRot(g0, g1); v = mulMV(rotMat(c.axis, c.angle), v); }
    v = norm(v); outN[i * 3] = v[0]; outN[i * 3 + 1] = v[1]; outN[i * 3 + 2] = v[2];
  }
  return {P: out, N: outN, R};
}

/** area-weighted vertex normals accumulated on weld representatives (seam-continuous). */
export function geomNormals(P, I, W) {
  const G = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const f = cross(sub(vget(P, b), vget(P, a)), sub(vget(P, c), vget(P, a)));
    for (const v of [a, b, c]) { const r = W[v]; G[r * 3] += f[0]; G[r * 3 + 1] += f[1]; G[r * 3 + 2] += f[2]; }
  }
  for (let i = 0; i < P.length / 3; i++) { if (W[i] !== i) continue; const v = norm(vget(G, i)); G[i * 3] = v[0]; G[i * 3 + 1] = v[1]; G[i * 3 + 2] = v[2]; }
  return G;
}

// ---------------------------------------------------------------------------------------------------------------------------
// diagnostics

/** per-triangle max edge stretch (posed / rest) and folded triangles (face normal turned > 120 deg from its rigidly turned rest normal). */
export function stretchStats(P0, P1, I, R) {
  let max = 0, over15 = 0, over2 = 0, folded = 0, grow = 0; const worst = [], per = new Float32Array(I.length / 3);
  for (let t = 0; t < I.length; t += 3) {
    let m = 0;
    for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3];
      const l0 = Math.hypot(...sub(vget(P0, a), vget(P0, b))), l1 = Math.hypot(...sub(vget(P1, a), vget(P1, b)));
      if (l0 > 1e-7) m = Math.max(m, l1 / l0);
      grow = Math.max(grow, l1 - l0);
    }
    per[t / 3] = m;
    if (m > max) max = m;
    if (m > 1.5) over15++;
    if (m > 2) { over2++; worst.push(t / 3); }
    const f0 = cross(sub(vget(P0, I[t + 1]), vget(P0, I[t])), sub(vget(P0, I[t + 2]), vget(P0, I[t])));
    const f1 = cross(sub(vget(P1, I[t + 1]), vget(P1, I[t])), sub(vget(P1, I[t + 2]), vget(P1, I[t])));
    if (Math.hypot(...f0) > 1e-12 && Math.hypot(...f1) > 1e-12) { const r = norm(mulMV(R[I[t]], norm(f0))); if (dot(r, norm(f1)) < -0.5) { folded++; per[t / 3] = Math.max(per[t / 3], 9); } }
  }
  return {max: +max.toFixed(3), over15, over2, folded, maxGrowMm: +(grow * 1000).toFixed(1), worst, per};
}

/** count intersecting triangle pairs between `moving` triangles (moved > eps) and the rest (static or moved differently). */
export function intersections(P1, I, movedTri, cell = 0.02) {
  const nt = I.length / 3, grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const box = t => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let e = 0; e < 3; e++) for (let k = 0; k < 3; k++) { const v = P1[I[t * 3 + e] * 3 + k]; mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v); } return [mn, mx]; };
  for (let t = 0; t < nt; t++) {
    if (movedTri[t]) continue;
    const [mn, mx] = box(t);
    for (let x = Math.floor(mn[0] / cell); x <= Math.floor(mx[0] / cell); x++) for (let y = Math.floor(mn[1] / cell); y <= Math.floor(mx[1] / cell); y++) for (let z = Math.floor(mn[2] / cell); z <= Math.floor(mx[2] / cell); z++) {
      const k = key(x, y, z); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(t);
    }
  }
  const tri = t => [vget(P1, I[t * 3]), vget(P1, I[t * 3 + 1]), vget(P1, I[t * 3 + 2])];
  const hits = new Set(), hitMoving = new Set();
  for (let t = 0; t < nt; t++) {
    if (!movedTri[t]) continue;
    const [mn, mx] = box(t), A = tri(t), seen = new Set();
    const va = new Set([I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]);
    for (let x = Math.floor(mn[0] / cell); x <= Math.floor(mx[0] / cell); x++) for (let y = Math.floor(mn[1] / cell); y <= Math.floor(mx[1] / cell); y++) for (let z = Math.floor(mn[2] / cell); z <= Math.floor(mx[2] / cell); z++) {
      for (const u of grid.get(key(x, y, z)) ?? []) {
        if (seen.has(u)) continue; seen.add(u);
        if ([0, 1, 2].some(e => va.has(I[u * 3 + e]))) continue;
        const B = tri(u);
        // share a welded corner -> neighbours, skip
        if (A.some(p => B.some(q => p[0] === q[0] && p[1] === q[1] && p[2] === q[2]))) continue;
        if (triTri(A, B)) { hits.add(u); hitMoving.add(t); }
      }
    }
  }
  return {staticHit: hits.size, movingHit: hitMoving.size, staticTris: [...hits], movingTris: [...hitMoving]};
}

// triangle-triangle intersection (separating-axis over the 11 candidate axes; exact enough for diagnostics)
function triTri(A, B) {
  const axes = [];
  const eA = [sub(A[1], A[0]), sub(A[2], A[1]), sub(A[0], A[2])], eB = [sub(B[1], B[0]), sub(B[2], B[1]), sub(B[0], B[2])];
  axes.push(cross(eA[0], eA[1]), cross(eB[0], eB[1]));
  for (const x of eA) for (const y of eB) axes.push(cross(x, y));
  for (const ax of axes) {
    if (Math.hypot(...ax) < 1e-14) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = dot(p, ax); a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of B) { const d = dot(p, ax); b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
