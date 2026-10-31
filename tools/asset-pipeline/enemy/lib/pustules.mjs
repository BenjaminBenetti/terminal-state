// Task track1-siren-blightbelly-20261031 (lane RIGB): seeded, reproducible procedural PUSTULE clusters for the Blightbelly.
//
// The Meshy T2.5 texture carries only sparse boils (two chest clusters + spots); at gameplay distance they do not read.
// This adds a modest set of small swollen domes (yellow-green heads, inflamed red rims) ON the skinned body surface:
//   - cluster anchors are drawn (seeded mulberry32) per bone quota over the welded body surface, area-weighted, preferring
//     exposed skin / the texture's own yellow boil patches over cloth, with a minimum spacing; the main dome of a cluster
//     sits at the anchor, 2-4 smaller satellites around it are projected back onto the surface (closest point);
//   - every dome copies the skin weights of its surface point (barycentric blend of the triangle's vertex weights, top 4)
//     so it follows the underlying skin exactly (no floating / sinking in the clips) — one rigid local transform per dome;
//   - geometry: squashed spherical caps (apex + rings) whose base ring is sunk below the surface; UV u = 0 at the apex ..
//     1 at the rim (gradient texture: cream-yellow head -> yellow-green -> inflamed red -> dark rim), v = colour variant row.
// Burst points (cluster centre on the swollen surface, the cluster's dominant bone, radius) are returned for the GLB extras.
import {TriGrid, insideByParity} from '../../zombie/lib/penetration.mjs';
import {JOINT_NAMES} from '../../zombie/lib/skin.mjs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const r4 = v => +(+v).toFixed(4);

/** Texture class of a surface colour (mean of a small texel neighbourhood): 'boil' (the texture's own yellow boils), 'cloth' (off-white shirt), 'dark' (trousers / belt), 'skin'. */
export function colourClass([r, g, b]) {
  const L = 0.3 * r + 0.59 * g + 0.11 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
  if (r > 140 && g > 100 && b < 0.62 * g && r - b > 80) return 'boil';
  if (L > 135 && sat < 0.3) return 'cloth';
  if (L < 58) return 'dark'; // trousers / belt / deep shadows (measured: trousers L 31-51, skin L 65-95, shirt L ~170)
  return 'skin';
}

/**
 * @param mesh {pos, nrm, idx} welded body surface (model space, metres)
 * @param w {joints: Uint16Array(n*4), weights: Float32Array(n*4)} welded skin weights
 * @param cls Array(n) of colourClass per welded vertex
 * @param skel skeleton (joints, crotchY, neckBaseY)
 * @param spec {seed, quotas: [{bone, n, sides?, front?}], minSpacing, mainR: [lo, hi], satellites: [lo, hi], satR: [lo, hi], satDist: [lo, hi], prefer: {skin, boil, cloth}, rings, segments, sink, heightK: [lo, hi], variants}
 */
export function buildPustules(mesh, w, cls, skel, spec) {
  const rnd = mulberry32(spec.seed);
  const P = mesh.pos, N = mesh.nrm, I = mesh.idx, n = P.length / 3;
  const J = skel.joints;
  const allowed = new Set(spec.quotas.map(q => q.bone));
  const forbid = new Set(['Head', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot', 'L_Shin', 'R_Shin']);
  const pt = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const nr = i => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
  const dom = i => ({j: JOINT_NAMES[w.joints[i * 4]], wt: w.weights[i * 4]});
  // vertex areas (1/3 of the incident triangle areas)
  const area = new Float32Array(n);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const A = Math.hypot(...cross(sub(pt(b), pt(a)), sub(pt(c), pt(a)))) / 6;
    area[a] += A; area[b] += A; area[c] += A;
  }
  const grid = new TriGrid(P, I, 0.03);
  // surface point with interpolated normal + skin weights (top 4) at the closest triangle point
  const surf = p => {
    const h = grid.closest(p[0], p[1], p[2], 0.15);
    if (!h) return null;
    const t = h.tri, vs = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]], bw = [h.q[3], h.q[4], h.q[5]];
    let nn = [0, 0, 0];
    const acc = new Map();
    vs.forEach((v, k) => {
      nn = add(nn, mul(nr(v), bw[k]));
      for (let q = 0; q < 4; q++) { const wt = w.weights[v * 4 + q] * bw[k]; if (wt > 0) acc.set(w.joints[v * 4 + q], (acc.get(w.joints[v * 4 + q]) || 0) + wt); }
    });
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const s = top.reduce((a, e) => a + e[1], 0);
    const joints = [0, 0, 0, 0], weights = [0, 0, 0, 0];
    top.forEach(([j, v], k) => { joints[k] = j; weights[k] = v / s; });
    return {p: [h.q[0], h.q[1], h.q[2]], n: norm(nn), joints, weights, bone: JOINT_NAMES[joints[0]], vs};
  };
  // ---- 1. candidates per bone
  const minY = (skel.crotchY ?? 0) + 0.12, maxY = (skel.neckBaseY ?? J.Neck[1]) - 0.035;
  const cand = {};
  for (const b of allowed) cand[b] = [];
  for (let i = 0; i < n; i++) {
    const d = dom(i), y = P[i * 3 + 1];
    if (!allowed.has(d.j) || d.wt < 0.5 || y < minY || y > maxY) continue;
    if (N[i * 3 + 1] < -0.55) continue; // undersides (armpits, belly overhang) never read
    const c = cls[i];
    if (c === 'dark') continue;
    cand[d.j].push({i, wt: area[i] * (spec.prefer[c] ?? 1), c});
  }
  // ---- 2. anchors by quota (seeded, area x preference weighted, min spacing)
  const anchors = [];
  const pick = (list, ok) => {
    const tot = list.reduce((a, e) => a + (ok(e) ? e.wt : 0), 0);
    if (tot <= 0) return null;
    for (let tries = 0; tries < 600; tries++) {
      let r = rnd() * tot;
      for (const e of list) { if (!ok(e)) continue; r -= e.wt; if (r <= 0) { if (anchors.every(a => Math.hypot(...sub(a.p, pt(e.i))) >= (cur.minSpacing ?? spec.minSpacing))) return e; break; } }
    }
    return null;
  };
  const skipped = [];
  let cur = null;
  for (const q of spec.quotas) {
    cur = q;
    for (let k = 0; k < q.n; k++) {
      const side = q.sides ? q.sides[k % q.sides.length] : 0; // +1 = character left (+x), -1 = right
      const front = q.front ? q.front[k % q.front.length] : 0; // +1 = in front of the bone, -1 = behind
      const ref = J[q.bone];
      const ok = e => {
        const p = pt(e.i);
        if (side && Math.sign(p[0]) !== side) return false;
        if (front && Math.sign(p[2] - ref[2] - (q.frontBias ?? 0)) !== front) return false;
        if (q.lateral && (q.bone.startsWith('L_') ? 1 : -1) * N[e.i * 3] < q.lateral) return false;
        return true;
      };
      const e = pick(cand[q.bone], ok);
      if (!e) { skipped.push({bone: q.bone, k}); continue; }
      anchors.push({bone: q.bone, i: e.i, p: pt(e.i), cls: e.c});
    }
  }
  // a dome must stand OUT of the body: its apex (and a point half way up) outside the closed surface (6-axis ray parity);
  // interpolated normals in folds / creases can point inward (the dome would be buried and only its halo would show)
  const rejected = {buried: 0};
  const standsOut = (p, nn, h) => [h, h * 0.5].every(k => { const q = add(p, mul(nn, k)); return !insideByParity(grid, q[0], q[1], q[2]); });
  // ---- 3. clusters: main dome + satellites projected on the surface
  const clusters = [];
  for (const a of anchors) {
    const s0 = surf(a.p);
    if (!standsOut(s0.p, s0.n, spec.mainR[1] * 0.5)) { rejected.buried++; skipped.push({bone: a.bone, reason: 'main dome buried (fold / crease)'}); continue; }
    const R = spec.mainR[0] + rnd() * (spec.mainR[1] - spec.mainR[0]);
    const domes = [{...s0, r: R, h: R * (spec.heightK[0] + rnd() * (spec.heightK[1] - spec.heightK[0])), variant: Math.floor(rnd() * spec.variants)}];
    const ns = spec.satellites[0] + Math.floor(rnd() * (spec.satellites[1] - spec.satellites[0] + 1));
    const t1 = norm(cross(s0.n, Math.abs(s0.n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t2 = cross(s0.n, t1);
    const phase = rnd() * Math.PI * 2;
    for (let k = 0; k < ns; k++) {
      const ang = phase + (k / ns) * Math.PI * 2 + (rnd() - 0.5) * 0.9;
      const r = R * (spec.satR[0] + rnd() * (spec.satR[1] - spec.satR[0]));
      const dist = R * (spec.satDist[0] + rnd() * (spec.satDist[1] - spec.satDist[0]));
      const guess = add(s0.p, add(mul(t1, Math.cos(ang) * dist), mul(t2, Math.sin(ang) * dist)));
      const s = surf(guess);
      if (!s || forbid.has(s.bone) || domes.some(d => Math.hypot(...sub(d.p, s.p)) < 0.9 * (d.r + r))) continue;
      if (spec.satelliteNever && s.vs.some(v => spec.satelliteNever.includes(cls[v]))) continue; // never on the trousers / belt
      const h = r * (spec.heightK[0] + rnd() * (spec.heightK[1] - spec.heightK[0])), variant = Math.floor(rnd() * spec.variants);
      if (!standsOut(s.p, s.n, h)) { rejected.buried++; continue; }
      domes.push({...s, r, h, variant});
    }
    clusters.push({bone: s0.bone, anchorBone: a.bone, cls: a.cls, domes});
  }
  // ---- 4. dome geometry
  const pos = [], nrm = [], uv = [], idx = [], joints = [], weights = [];
  const S = spec.segments, Rg = spec.rings;
  for (const c of clusters) for (const d of c.domes) {
    const t1 = norm(cross(d.n, Math.abs(d.n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), t2 = cross(d.n, t1);
    const base = pos.length / 3;
    const vrow = (d.variant + 0.5) / spec.variants;
    const push = (p, nn, u) => { pos.push(...p); nrm.push(...norm(nn)); uv.push(u, vrow); joints.push(...d.joints); weights.push(...d.weights); };
    // apex
    push(add(d.p, mul(d.n, d.h)), d.n, 0);
    for (let j = 1; j <= Rg + 1; j++) {
      const last = j === Rg + 1; // skirt ring sunk below the surface
      const phi = Math.min(1, j / Rg) * Math.PI / 2;
      const rad = last ? d.r * 1.04 : d.r * Math.sin(phi), up = last ? -spec.sink * d.r : d.h * Math.cos(phi);
      for (let k = 0; k < S; k++) {
        const th = (k / S) * Math.PI * 2;
        const radial = add(mul(t1, Math.cos(th)), mul(t2, Math.sin(th)));
        // squashed-cap normal: gradient of (radial / r)^2 + (up / h)^2
        const nn = last ? add(mul(radial, 1), mul(d.n, 0.15)) : add(mul(radial, Math.sin(phi) / d.r), mul(d.n, Math.cos(phi) / d.h));
        push(add(d.p, add(mul(radial, rad), mul(d.n, up))), nn, last ? 1 : Math.min(1, j / Rg) * 0.97);
      }
    }
    for (let k = 0; k < S; k++) idx.push(base, base + 1 + k, base + 1 + (k + 1) % S);
    for (let j = 1; j <= Rg; j++) {
      const r0 = base + 1 + (j - 1) * S, r1 = base + 1 + j * S;
      for (let k = 0; k < S; k++) { const k1 = (k + 1) % S; idx.push(r0 + k, r1 + k, r1 + k1, r0 + k, r1 + k1, r0 + k1); }
    }
  }
  // fix winding: outward = along the dome normal (apex fan built with the right-handed t1 x t2 = n order)
  const mesh2 = {pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), uv: Float32Array.from(uv), idx: Uint32Array.from(idx), joints: Uint16Array.from(joints), weights: Float32Array.from(weights)};
  orientOutward(mesh2);
  // ---- 5. burst points: per cluster, the main dome's swollen top, its dominant bone, radius covering the cluster
  const burst = clusters.map(c => {
    const m = c.domes[0], top = add(m.p, mul(m.n, m.h * 0.6));
    const ext = Math.max(...c.domes.map(d => Math.hypot(...sub(d.p, m.p)) + d.r));
    return {bone: m.bone, offset: sub(top, J[m.bone]).map(r4), r: r4(ext), normal: m.n.map(r4), domes: c.domes.length, worldBind: top.map(r4)};
  });
  return {clusters, mesh: mesh2, burst, skipped, stats: {rejectedBuriedDomes: rejected.buried, clusters: clusters.length, domes: clusters.reduce((a, c) => a + c.domes.length, 0), triangles: idx.length / 3, vertices: pos.length / 3,
    perBone: Object.fromEntries([...new Set(burst.map(b => b.bone))].map(b => [b, burst.filter(x => x.bone === b).length])), anchorClasses: Object.fromEntries(['skin', 'boil', 'cloth'].map(k => [k, anchors.filter(a => a.cls === k).length]))}};
}

function orientOutward(m) {
  const P = m.pos, N = m.nrm, I = m.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const fn = cross(e1, e2), vn = [N[a] + N[b] + N[c], N[a + 1] + N[b + 1] + N[c + 1], N[a + 2] + N[b + 2] + N[c + 2]];
    if (dot(fn, vn) < 0) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  }
}

/** 64 x (16 * variants) RGB gradient strip for the domes: u = apex (0) -> rim (1), one row band per colour variant. */
export function pustuleTexture(variants = 4, W = 64, rowH = 16) {
  const H = variants * rowH, data = new Uint8Array(W * H * 3);
  // stops: [u, rgb] (sRGB) — cream-yellow head, yellow-green body, inflamed red, dark crimson rim
  const base = [[0, [236, 222, 150]], [0.18, [214, 200, 92]], [0.48, [158, 168, 58]], [0.72, [178, 78, 52]], [0.88, [150, 40, 36]], [1, [92, 26, 24]]];
  const tint = [[1, 1, 1], [1.05, 0.96, 0.9], [0.92, 1.04, 0.95], [1.02, 0.94, 0.86]];
  for (let v = 0; v < variants; v++) for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    let k = 0; while (k < base.length - 2 && u > base[k + 1][0]) k++;
    const [u0, c0] = base[k], [u1, c1] = base[k + 1], f = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
    const col = c0.map((c, i) => Math.min(255, Math.round((c + (c1[i] - c) * f) * (u < 0.6 ? tint[v % tint.length][i] : 1))));
    for (let y = 0; y < rowH; y++) data.set(col, ((v * rowH + y) * W + x) * 3);
  }
  return {data, width: W, height: H, channels: 3};
}

/**
 * Inflamed halo painted into the BODY base colour around every dome (UV-space raster of the body triangles within reach):
 * a soft reddish ring under / around the rim so the boils read against the skin. `tex` RGBA (Uint8Array, w x h), `low` =
 * the UV-split body mesh {pos, uv, idx}. Returns texels touched.
 */
export function paintHalos(tex, low, clusters, {reach = 1.9, strength = 0.55, colour = [150, 44, 38]} = {}) {
  const {width: W, height: H, data} = tex;
  const P = low.pos, U = low.uv, I = low.idx;
  const domes = clusters.flatMap(c => c.domes);
  const R = Math.max(...domes.map(d => d.r)) * reach;
  let touched = 0;
  const done = new Uint8Array(W * H);
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    const ps = v.map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const cen = mul(add(add(ps[0], ps[1]), ps[2]), 1 / 3);
    const near = domes.filter(d => Math.hypot(...sub(d.p, cen)) < R + 0.08);
    if (!near.length) continue;
    const uv = v.map(i => [U[i * 2] * W, U[i * 2 + 1] * H]);
    const x0 = Math.max(0, Math.floor(Math.min(...uv.map(q => q[0])) - 2)), x1 = Math.min(W - 1, Math.ceil(Math.max(...uv.map(q => q[0])) + 2));
    const y0 = Math.max(0, Math.floor(Math.min(...uv.map(q => q[1])) - 2)), y1 = Math.min(H - 1, Math.ceil(Math.max(...uv.map(q => q[1])) + 2));
    const area = (uv[1][0] - uv[0][0]) * (uv[2][1] - uv[0][1]) - (uv[2][0] - uv[0][0]) * (uv[1][1] - uv[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      let w0 = ((uv[1][0] - qx) * (uv[2][1] - qy) - (uv[2][0] - qx) * (uv[1][1] - qy)) / area;
      let w1 = ((uv[2][0] - qx) * (uv[0][1] - qy) - (uv[0][0] - qx) * (uv[2][1] - qy)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < -0.12 || w1 < -0.12 || w2 < -0.12) continue; // ~1-2 texel conservative border (mip / bilinear bleed at seams)
      const o = y * W + x;
      if (done[o]) continue;
      w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2); const s = w0 + w1 + w2; w0 /= s; w1 /= s; w2 /= s;
      const p = [0, 1, 2].map(k => ps[0][k] * w0 + ps[1][k] * w1 + ps[2][k] * w2);
      let a = 0;
      for (const d of near) {
        const dist = Math.hypot(...sub(p, d.p)) / d.r;
        if (dist > reach) continue;
        a = Math.max(a, strength * (dist < 1 ? 1 : 1 - (dist - 1) / (reach - 1)));
      }
      if (a <= 0) continue;
      done[o] = 1; touched++;
      for (let k = 0; k < 3; k++) data[o * 4 + k] = Math.round(data[o * 4 + k] * (1 - a) + colour[k] * a * (0.75 + 0.25 * data[o * 4 + k] / 255));
    }
  }
  return touched;
}
