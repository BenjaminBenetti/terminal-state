// Shared, pure geometry helpers of the weapon cooks (moved verbatim out of build-weapon-variety.mjs so build-turnstile.mjs cooks with
// the exact same rules: exact-attribute weld, position-connected islands, exact axis-aligned box clip, marker probes, recorded part ops).
// Every function is deterministic local processing of the source mesh's own geometry (UVs / maps untouched); nothing here reads or writes
// files. Coordinates are metres in the cook's game frame.

const nz = v => (Object.is(v, -0) || Math.abs(v) < 5e-7 ? 0 : v);
export const r4 = v => nz(+v.toFixed(4)), r5 = v => nz(+v.toFixed(5)), r6 = v => nz(+v.toFixed(6));
/** The band (m) at the front face whose vertices define the Muzzle / Tip centre. */
export const FRONT_BAND = 0.004;
/** A 'mid' y (handle axis): the cross-section within this half-size (m) of z gives the x of the Y ray. */
export const MID_R = 0.006;

/** Exact-attribute weld (bitwise-equal float32 position / normal / uv) + degenerate-triangle and unreferenced-vertex removal; lossless. */
export function weld(m) {
  const nv = m.P.length / 3, stride = 8, A = new Float32Array(nv * stride);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { A[v * stride + k] = m.P[3 * v + k]; A[v * stride + 3 + k] = m.N[3 * v + k]; if (k < 2) A[v * stride + 6 + k] = m.UV[2 * v + k]; }
  const U = new Uint32Array(A.buffer);
  let cap = 1; while (cap < nv * 2) cap <<= 1;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(nv), first = [], used = new Uint8Array(nv);
  for (let i = 0; i < m.I.length; i++) used[m.I[i]] = 1;
  let unreferenced = 0;
  for (let v = 0; v < nv; v++) {
    if (!used[v]) { unreferenced++; continue; }
    let h = 2166136261;
    for (let k = 0; k < stride; k++) { h ^= U[v * stride + k]; h = Math.imul(h, 16777619); }
    for (let s = (h >>> 0) & (cap - 1); ; s = (s + 1) & (cap - 1)) {
      const q = table[s];
      if (q < 0) { table[s] = first.length; remap[v] = first.length; first.push(v); break; }
      let eq = true;
      for (let k = 0; k < stride; k++) if (U[first[q] * stride + k] !== U[v * stride + k]) { eq = false; break; }
      if (eq) { remap[v] = q; break; }
    }
  }
  const n = first.length, P = new Float64Array(n * 3), N = new Float64Array(n * 3), UV = new Float64Array(n * 2);
  first.forEach((v, i) => { for (let k = 0; k < 3; k++) { P[3 * i + k] = m.P[3 * v + k]; N[3 * i + k] = m.N[3 * v + k]; } UV[2 * i] = m.UV[2 * v]; UV[2 * i + 1] = m.UV[2 * v + 1]; });
  const I = [];
  let degenerate = 0;
  for (let f = 0; f < m.I.length; f += 3) {
    const a = remap[m.I[f]], b = remap[m.I[f + 1]], c = remap[m.I[f + 2]];
    if (a === b || b === c || a === c) { degenerate++; continue; }
    I.push(a, b, c);
  }
  return {m: {P, N, UV, I: Uint32Array.from(I)}, info: {verticesBefore: nv, verticesAfter: n, unreferencedVerticesDropped: unreferenced, degenerateTrianglesDropped: degenerate}};
}

export function boundsOf(P, I = null) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const visit = v => { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[3 * v + k]); max[k] = Math.max(max[k], P[3 * v + k]); } };
  if (I) for (let i = 0; i < I.length; i++) visit(I[i]); else for (let v = 0; v < P.length / 3; v++) visit(v);
  return {min, max};
}

/** The vertices (of the triangles in I) inside an axis-aligned range {x?, y?, z?: [lo, hi]}: their bounds + count. */
export function slab(m, range, I = m.I) {
  const used = new Uint8Array(m.P.length / 3);
  for (let i = 0; i < I.length; i++) used[I[i]] = 1;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (let v = 0; v < used.length; v++) {
    if (!used[v]) continue;
    const p = [m.P[3 * v], m.P[3 * v + 1], m.P[3 * v + 2]];
    if (['x', 'y', 'z'].some((ax, k) => range[ax] && (p[k] < range[ax][0] || p[k] > range[ax][1]))) continue;
    n++;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  }
  return {n, min, max};
}

/** Position-connected islands (exact positions): [{tris: [triangle indices], min, max}], largest first. */
export function islands(m) {
  const nv = m.P.length / 3, key = new Map(), rep = new Int32Array(nv);
  for (let v = 0; v < nv; v++) { const k = `${m.P[3 * v]},${m.P[3 * v + 1]},${m.P[3 * v + 2]}`; if (!key.has(k)) key.set(k, key.size); rep[v] = key.get(k); }
  const par = Int32Array.from({length: key.size}, (_, i) => i);
  const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const TN = m.I.length / 3;
  for (let t = 0; t < TN; t++) { const a = rep[m.I[3 * t]], b = rep[m.I[3 * t + 1]], c = rep[m.I[3 * t + 2]]; par[f(a)] = f(b); par[f(b)] = f(c); }
  const comps = new Map();
  for (let t = 0; t < TN; t++) {
    const c = f(rep[m.I[3 * t]]);
    if (!comps.has(c)) comps.set(c, {tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]});
    const o = comps.get(c); o.tris.push(t);
    for (let k = 0; k < 3; k++) { const v = m.I[3 * t + k]; for (let r = 0; r < 3; r++) { o.min[r] = Math.min(o.min[r], m.P[3 * v + r]); o.max[r] = Math.max(o.max[r], m.P[3 * v + r]); } }
  }
  return [...comps.values()].sort((a, b) => b.tris.length - a.tris.length || a.min[2] - b.min[2]);
}
export const inBox = (o, b) => [0, 1, 2].every(k => o.min[k] >= b.min[k] && o.max[k] <= b.max[k]);

/**
 * Exact clip of the triangles `cand` of mesh m (P / N / UV extended in place: returned) by an axis-aligned box: triangles crossing a box
 * face are split along it (Sutherland-Hodgman per face; the cut vertex interpolates position / normal / UV, computed in a canonical edge
 * order so both sides of a shared edge get the identical position, and lies exactly on the face). Returns the inside / outside triangles.
 */
export function clipBox(m, cand, box) {
  const P = Array.from(m.P), N = Array.from(m.N), UV = Array.from(m.UV);
  const planes = [];
  for (let k = 0; k < 3; k++) {
    if (Number.isFinite(box.min[k])) planes.push({k, sign: -1, d: box.min[k]});
    if (Number.isFinite(box.max[k])) planes.push({k, sign: 1, d: box.max[k]});
  }
  const cache = new Map();
  const before = (a, b) => { for (let k = 0; k < 3; k++) { if (P[3 * a + k] !== P[3 * b + k]) return P[3 * a + k] < P[3 * b + k]; } return a < b; };
  const cut = (a, b, pi) => {
    const key = `${Math.min(a, b)}|${Math.max(a, b)}|${pi}`;
    if (cache.has(key)) return cache.get(key);
    const pl = planes[pi];
    const [lo, hi] = before(a, b) ? [a, b] : [b, a];
    const t = (pl.d - P[3 * lo + pl.k]) / (P[3 * hi + pl.k] - P[3 * lo + pl.k]);
    const v = P.length / 3;
    for (let k = 0; k < 3; k++) P.push(k === pl.k ? pl.d : P[3 * lo + k] + t * (P[3 * hi + k] - P[3 * lo + k]));
    const n = [0, 1, 2].map(k => N[3 * lo + k] + t * (N[3 * hi + k] - N[3 * lo + k])), l = Math.hypot(...n) || 1;
    N.push(n[0] / l, n[1] / l, n[2] / l);
    UV.push(UV[2 * lo] + t * (UV[2 * hi] - UV[2 * lo]), UV[2 * lo + 1] + t * (UV[2 * hi + 1] - UV[2 * lo + 1]));
    cache.set(key, v);
    return v;
  };
  let pending = cand.map(t => [m.I[3 * t], m.I[3 * t + 1], m.I[3 * t + 2]]);
  const outside = [];
  let split = 0;
  planes.forEach((pl, pi) => {
    const next = [];
    for (const poly of pending) {
      const s = poly.map(v => pl.sign * (P[3 * v + pl.k] - pl.d));
      if (s.every(x => x <= 0)) { next.push(poly); continue; }
      if (s.every(x => x >= 0)) { outside.push(poly); continue; }
      split++;
      const inP = [], outP = [];
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length, a = poly[i], b = poly[j];
        if (s[i] <= 0) inP.push(a);
        if (s[i] >= 0) outP.push(a);
        if ((s[i] < 0 && s[j] > 0) || (s[i] > 0 && s[j] < 0)) { const c = cut(a, b, pi); inP.push(c); outP.push(c); }
      }
      if (inP.length >= 3) next.push(inP);
      if (outP.length >= 3) outside.push(outP);
    }
    pending = next;
  });
  const fan = polys => polys.flatMap(q => q.slice(1, -1).flatMap((v, i) => [q[0], v, q[i + 2]]));
  return {P: Float64Array.from(P), N: Float64Array.from(N), UV: Float64Array.from(UV), inside: fan(pending), outside: fan(outside), splitTriangles: split, planes: planes.length};
}

/** A compact mesh of the triangles I (indices into m), translated by -origin. */
export function compact(m, I, origin = [0, 0, 0]) {
  const map = new Map(), P = [], N = [], UV = [], J = new Uint32Array(I.length);
  for (let i = 0; i < I.length; i++) {
    const v = I[i];
    if (!map.has(v)) { map.set(v, P.length / 3); for (let k = 0; k < 3; k++) { P.push(m.P[3 * v + k] - origin[k]); N.push(m.N[3 * v + k]); } UV.push(m.UV[2 * v], m.UV[2 * v + 1]); }
    J[i] = map.get(v);
  }
  return {P: Float32Array.from(P), N: Float32Array.from(N), UV: Float32Array.from(UV), I: J};
}

/** The sorted coordinates along `axis` (0 x / 1 y / 2 z) where a ray at the other two coordinates `at` crosses the mesh's triangles. */
export function rayHits(m, axis, at) {
  const [a, b] = [0, 1, 2].filter(k => k !== axis), hits = [];
  for (let f = 0; f < m.I.length; f += 3) {
    const t = [3 * m.I[f], 3 * m.I[f + 1], 3 * m.I[f + 2]];
    const d = (m.P[t[1] + b] - m.P[t[2] + b]) * (m.P[t[0] + a] - m.P[t[2] + a]) + (m.P[t[2] + a] - m.P[t[1] + a]) * (m.P[t[0] + b] - m.P[t[2] + b]);
    if (Math.abs(d) < 1e-16) continue;
    const l0 = ((m.P[t[1] + b] - m.P[t[2] + b]) * (at[0] - m.P[t[2] + a]) + (m.P[t[2] + a] - m.P[t[1] + a]) * (at[1] - m.P[t[2] + b])) / d;
    const l1 = ((m.P[t[2] + b] - m.P[t[0] + b]) * (at[0] - m.P[t[2] + a]) + (m.P[t[0] + a] - m.P[t[2] + a]) * (at[1] - m.P[t[2] + b])) / d, l2 = 1 - l0 - l1;
    if (l0 < 0 || l1 < 0 || l2 < 0) continue;
    hits.push(l0 * m.P[t[0] + axis] + l1 * m.P[t[1] + axis] + l2 * m.P[t[2] + axis]);
  }
  return hits.sort((p, q) => p - q);
}

/** Resolves the marker specs on the centred mesh (see SPEC). */
export function resolveMarkers(w, m, specs) {
  const out = {}, rules = {};
  for (const [name, sp] of Object.entries(specs)) {
    if (Array.isArray(sp)) {
      const [x, y0, z] = sp;
      let y = y0, yRule = '';
      if (y0 === 'mid') {
        // the handle axis: a ray along Y through the cross-section's x centre at z (the outermost hits = the section's top / bottom)
        const sl = slab(m, {z: [z - MID_R, z + MID_R]});
        if (!sl.n) throw new Error(`${w.asset} ${name}: no geometry within ${MID_R} m of z ${z}`);
        const hy = rayHits(m, 1, [(sl.min[0] + sl.max[0]) / 2, z]);
        if (hy.length < 2) throw new Error(`${w.asset} ${name}: the Y ray at z ${z} hits ${hy.length} surfaces`);
        y = (hy[0] + hy[hy.length - 1]) / 2; yRule = '; y = the middle of a ray along Y through the cross-section at z (the handle axis)';
      }
      let px = x, rule = 'explicit';
      if (x && typeof x === 'object' && x.mid) {
        const hx = rayHits(m, 0, x.mid);
        if (hx.length < 2) throw new Error(`${w.asset} ${name}: the X probe ray at ${x.mid} hits ${hx.length} surfaces`);
        px = (hx[0] + hx[hx.length - 1]) / 2; rule = `x = the middle of a ray along X at y / z ${JSON.stringify(x.mid)} (the mid-plane there)`;
      } else if (x && typeof x === 'object' && x.right) {
        // the port's opening plane: the right-most surface of a ray along X at a probe point on the receiver side next to the port
        const hx = rayHits(m, 0, x.right);
        if (!hx.length) throw new Error(`${w.asset} ${name}: the X probe ray at ${x.right} hits nothing`);
        px = hx[hx.length - 1]; rule = `x = the right-hand receiver surface (the right-most hit of a ray along X at y / z ${JSON.stringify(x.right)}, beside the port)`;
      } else if (x === 'mid' || x === 'right' || x === 'left') {
        const hx = rayHits(m, 0, [y, z]);
        if (hx.length < 2) throw new Error(`${w.asset} ${name}: the X ray at y ${y} z ${z} hits ${hx.length} surfaces`);
        px = x === 'mid' ? (hx[0] + hx[hx.length - 1]) / 2 : x === 'right' ? hx[hx.length - 1] : hx[0];
        rule = x === 'mid' ? 'x = the middle of a ray along X at y / z (the outermost surfaces: the local mid-plane)' : `x = the ${x}-most surface hit by a ray along X at y / z`;
      }
      out[name] = [px, y, z]; rules[name] = {rule: rule + yRule, spec: sp};
    } else if (sp.front) {
      const range = {...(sp.front.y ? {y: sp.front.y} : {}), ...(sp.front.x ? {x: sp.front.x} : {})};
      const all = slab(m, range);
      const band = slab(m, {...range, z: [all.min[2], all.min[2] + FRONT_BAND]});
      out[name] = [(band.min[0] + band.max[0]) / 2, (band.min[1] + band.max[1]) / 2, all.min[2]];
      rules[name] = {rule: `the front face: z = the minimum z${Object.keys(range).length ? ` within ${JSON.stringify(range)}` : ''}; x / y = the centre of the vertices within ${FRONT_BAND} m of it`, spec: sp, faceVertices: band.n};
    } else if (sp.back) {
      const range = Object.fromEntries(['x', 'y', 'z'].filter(a => sp.back[a]).map(a => [a, sp.back[a]]));
      const all = slab(m, range);
      const band = slab(m, {...range, z: [all.max[2] - FRONT_BAND, all.max[2]]});
      out[name] = [(band.min[0] + band.max[0]) / 2, (band.min[1] + band.max[1]) / 2, all.max[2]];
      rules[name] = {rule: `the rear face: z = the maximum z within ${JSON.stringify(range)}; x / y = the centre of the vertices within ${FRONT_BAND} m of it`, spec: sp, faceVertices: band.n};
    } else throw new Error(`${w.asset} ${name}: bad marker spec`);
  }
  return {markers: out, rules};
}

/**
 * The recorded geometry ops (SPEC.ops), in order, on the centred mesh with a label per triangle ('' = the body, else a part name).
 * Every op is local processing of Meshy's own geometry (UVs / maps untouched):
 *  assign  {name, from?, islands?: {box, expect}, clip?: {box, except?: {box, expect}}}  whole islands of label `from` (default the body)
 *          lying inside the box and / or the `from` mesh clipped exactly to the box become label `name` (clip.except: whole islands inside
 *          its box are left out of the clip and keep their label: a small separate part the cut must not split)
 *  drop    {islands: {box, expect}}                              whole body islands inside the box are removed (an overlapping duplicate)
 *  scaleX  {name? | islands?: {box, expect}, width? | factor?, centreX?}  the selection's X extent scaled about its own X centre (to `width`
 *          m or by `factor`), then moved to `centreX` when given; normals by the inverse transpose
 *          (clampHalf: the result is clamped to +-clampHalf m about that centre: a thin plate thickened without blowing up a thicker point)
 *  move    {name, by: [dx, dy, dz]}                              the label's (separate) geometry translated rigidly
 *  pair    {name, width, offset}                                 the label's geometry scaled across X to `width`, then duplicated: the two
 *          copies centred `offset` m either side of its X centre (a side-by-side pair from one reconstructed tube; same UVs / maps)
 * Vertices shared across labels (a clip's cut edge) are duplicated per label, so a part moves without tearing the body.
 */
export function applyOps(w, m, ops) {
  let P = Array.from(m.P), N = Array.from(m.N), UV = Array.from(m.UV), I = Array.from(m.I);
  let label = new Array(I.length / 3).fill('');
  const recs = [];
  const fail = msg => { throw new Error(`${w.asset}: ${msg}`); };
  const trisOf = l => label.map((x, t) => (x === l ? t : -1)).filter(t => t >= 0);
  const vertsOfTris = tris => { const s = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) s.add(I[3 * t + k]); return [...s].sort((a, b) => a - b); };
  /** whole islands among the triangles `tris` lying inside sel.box: their triangle ids (checked against sel.expect) + a record */
  const pickIslands = (sel, tris) => {
    const sub = {P, I: tris.flatMap(t => [I[3 * t], I[3 * t + 1], I[3 * t + 2]])};
    const hit = islands(sub).filter(o => inBox(o, sel.box));
    const n = hit.reduce((s, o) => s + o.tris.length, 0);
    if (!sel.expect || hit.length !== sel.expect.islands || n !== sel.expect.tris) fail(`islands in the box ${hit.length} / ${n} tris != the recorded ${JSON.stringify(sel.expect)}`);
    return {ids: hit.flatMap(o => o.tris.map(i => tris[i])), rec: {rule: `whole position-connected islands lying inside the box min ${JSON.stringify(sel.box.min)} max ${JSON.stringify(sel.box.max)} (m)`,
      islands: hit.length, triangles: n, bounds: hit.map(o => ({tris: o.tris.length, min: o.min.map(r4), max: o.max.map(r4)}))}};
  };
  /** duplicate the vertices shared by triangles of different labels (the first label keeps the original) */
  const detach = () => {
    const owner = new Map(), copy = new Map();
    for (let t = 0; t < label.length; t++) for (let k = 0; k < 3; k++) {
      const v = I[3 * t + k], l = label[t];
      if (!owner.has(v)) { owner.set(v, l); continue; }
      if (owner.get(v) === l) continue;
      const key = `${v}|${l}`;
      if (!copy.has(key)) { copy.set(key, P.length / 3); P.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); N.push(N[3 * v], N[3 * v + 1], N[3 * v + 2]); UV.push(UV[2 * v], UV[2 * v + 1]); }
      I[3 * t + k] = copy.get(key);
    }
    return copy.size;
  };
  const scaleVertsX = (verts, k, to, clampHalf = Infinity) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of verts) { lo = Math.min(lo, P[3 * v]); hi = Math.max(hi, P[3 * v]); }
    const c = (lo + hi) / 2, target = to ?? c;
    let clamped = 0, lo2 = Infinity, hi2 = -Infinity;
    for (const v of verts) {
      const d = (P[3 * v] - c) * k;
      if (Math.abs(d) > clampHalf) clamped++;
      P[3 * v] = target + Math.max(-clampHalf, Math.min(clampHalf, d));
      lo2 = Math.min(lo2, P[3 * v]); hi2 = Math.max(hi2, P[3 * v]);
      const x = N[3 * v] / k, y = N[3 * v + 1], z = N[3 * v + 2], l = Math.hypot(x, y, z) || 1;
      N[3 * v] = x / l; N[3 * v + 1] = y / l; N[3 * v + 2] = z / l;
    }
    return {fromWidth: r5(hi - lo), centre: r5(c), toWidth: r5(hi2 - lo2), toCentre: r5(target), ...(Number.isFinite(clampHalf) ? {clampHalf, clampedVertices: clamped, ofVertices: verts.length} : {})};
  };
  /**
   * A thin plate thickened to `T` m across X about its LOCAL mid-surface: per vertex, c / t = the centre / extent of the selection's X
   * coordinates within r (y / z) of it (both faces of the plate), then x' = c + (x - c) * max(1, T / t) (never thinned; a vertex without
   * an opposite face in reach keeps its place); normals by the inverse transpose of its own factor.
   */
  const scaleLocalX = (verts, T, r) => {
    const cell = new Map(), key = (a, b) => `${a},${b}`;
    for (const v of verts) { const a = Math.floor(P[3 * v + 1] / r), b = Math.floor(P[3 * v + 2] / r); const kk = key(a, b); if (!cell.has(kk)) cell.set(kk, []); cell.get(kk).push(v); }
    const local = new Map();
    for (const v of verts) {
      const a = Math.floor(P[3 * v + 1] / r), b = Math.floor(P[3 * v + 2] / r);
      let lo = Infinity, hi = -Infinity;
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (const u of cell.get(key(a + da, b + db)) ?? []) {
        if (Math.hypot(P[3 * u + 1] - P[3 * v + 1], P[3 * u + 2] - P[3 * v + 2]) > r) continue;
        lo = Math.min(lo, P[3 * u]); hi = Math.max(hi, P[3 * u]);
      }
      local.set(v, {c: (lo + hi) / 2, t: hi - lo});
    }
    const ts = [...local.values()].map(q => q.t).sort((p, q) => p - q), pct = f => r5(ts[Math.min(ts.length - 1, Math.floor(f * ts.length))]);
    let kept = 0, kMax = 1;
    for (const v of verts) {
      const {c, t} = local.get(v), k = t > 1e-5 ? Math.max(1, T / t) : 1;
      if (k === 1) kept++;
      kMax = Math.max(kMax, k);
      P[3 * v] = c + (P[3 * v] - c) * k;
      const x = N[3 * v] / k, y = N[3 * v + 1], z = N[3 * v + 2], l = Math.hypot(x, y, z) || 1;
      N[3 * v] = x / l; N[3 * v + 1] = y / l; N[3 * v + 2] = z / l;
    }
    return {toThicknessM: T, localR: r, localThicknessBeforeM: {p10: pct(0.1), p50: pct(0.5), p90: pct(0.9)}, maxFactor: r4(kMax), unchangedVertices: kept, ofVertices: verts.length,
      rule: `each vertex moved across X about the plate's LOCAL mid-surface (the centre of the selection's X extent within ${r} m in y / z: both faces) by max(1, ${T} / the local thickness): the plate becomes ~${T * 1000} mm thick where it was thinner, never thinner; normals by the inverse transpose`};
  };
  for (const op of ops) {
    const rec = {op: op.op, why: op.why};
    if (op.op === 'assign') {
      const from = op.from ?? '';
      rec.name = op.name; rec.from = from || 'body';
      if (op.islands) { const r = pickIslands(op.islands, trisOf(from)); for (const t of r.ids) label[t] = op.name; rec.islands = r.rec; }
      if (op.clip) {
        const box = op.clip.box;
        let pool = trisOf(from), except = null;
        if (op.clip.except) { const r = pickIslands(op.clip.except, pool), keep = new Set(r.ids); pool = pool.filter(t => !keep.has(t)); except = r.rec; }
        const cand = pool.filter(t => triCrossesBox({P}, [I[3 * t], I[3 * t + 1], I[3 * t + 2]], box));
        const c = clipBox({P, N, UV, I}, cand, box);
        P = Array.from(c.P); N = Array.from(c.N); UV = Array.from(c.UV);
        const gone = new Set(cand), I2 = [], L2 = [];
        for (let t = 0; t < label.length; t++) if (!gone.has(t)) { I2.push(I[3 * t], I[3 * t + 1], I[3 * t + 2]); L2.push(label[t]); }
        for (let i = 0; i < c.outside.length; i += 3) { I2.push(c.outside[i], c.outside[i + 1], c.outside[i + 2]); L2.push(from); }
        for (let i = 0; i < c.inside.length; i += 3) { I2.push(c.inside[i], c.inside[i + 1], c.inside[i + 2]); L2.push(op.name); }
        I = I2; label = L2;
        rec.clip = {rule: `the ${from || 'body'} mesh clipped to the box min ${JSON.stringify(box.min)} max ${JSON.stringify(box.max)} (m; ${c.planes} finite faces): triangles crossing a face are split exactly along it (interpolated position / normal / UV)`,
          candidateTriangles: cand.length, splitTriangles: c.splitTriangles, insideTriangles: c.inside.length / 3, ...(except ? {exceptIslands: except} : {})};
      }
      if (!trisOf(op.name).length) fail(`assign ${op.name} selects nothing`);
      rec.detachedVertices = detach();
    } else if (op.op === 'drop') {
      const r = pickIslands(op.islands, trisOf(''));
      const gone = new Set(r.ids), I2 = [], L2 = [];
      for (let t = 0; t < label.length; t++) if (!gone.has(t)) { I2.push(I[3 * t], I[3 * t + 1], I[3 * t + 2]); L2.push(label[t]); }
      I = I2; label = L2; rec.islands = r.rec;
    } else if (op.op === 'scaleX') {
      let tris;
      if (op.name) { tris = trisOf(op.name); rec.name = op.name; } else { const r = pickIslands(op.islands, trisOf('')); tris = r.ids; rec.islands = r.rec; }
      const verts = vertsOfTris(tris);
      let lo = Infinity, hi = -Infinity;
      for (const v of verts) { lo = Math.min(lo, P[3 * v]); hi = Math.max(hi, P[3 * v]); }
      const k = op.width ? op.width / (hi - lo) : op.factor;
      if (op.localR) { rec.scale = scaleLocalX(verts, op.toThickness, op.localR); recs.push(rec); continue; }
      rec.scale = {...scaleVertsX(verts, k, op.centreX, op.clampHalf), factor: r6(k), rule: `the selection's X extent scaled about its own X centre${op.centreX != null ? `, then centred on x = ${op.centreX}` : ''}${op.clampHalf ? `, clamped to +-${op.clampHalf} m about it` : ''}; normals by the inverse transpose`};
    } else if (op.op === 'move') {
      const verts = vertsOfTris(trisOf(op.name));
      if (!verts.length) fail(`move: ${op.name} is empty`);
      for (const v of verts) for (let k = 0; k < 3; k++) P[3 * v + k] += op.by[k];
      rec.name = op.name; rec.move = {byM: op.by, vertices: verts.length, rule: 'a rigid translation of the separate part'};
    } else if (op.op === 'pair') {
      const tris = trisOf(op.name), verts = vertsOfTris(tris);
      // the tube's reference width: its X extent within refZ (the main tube, without the flared breech collar)
      let lo = Infinity, hi = -Infinity;
      for (const v of verts) if (P[3 * v + 2] >= op.refZ[0] && P[3 * v + 2] <= op.refZ[1]) { lo = Math.min(lo, P[3 * v]); hi = Math.max(hi, P[3 * v]); }
      let alo = Infinity, ahi = -Infinity;
      for (const v of verts) { alo = Math.min(alo, P[3 * v]); ahi = Math.max(ahi, P[3 * v]); }
      const c = (lo + hi) / 2, k = op.width / (hi - lo);
      const sc = scaleVertsX(verts, k, c - op.offset, op.width / 2);
      const map = new Map();
      for (const v of verts) { map.set(v, P.length / 3); P.push(P[3 * v] + 2 * op.offset, P[3 * v + 1], P[3 * v + 2]); N.push(N[3 * v], N[3 * v + 1], N[3 * v + 2]); UV.push(UV[2 * v], UV[2 * v + 1]); }
      for (const t of tris) { I.push(map.get(I[3 * t]), map.get(I[3 * t + 1]), map.get(I[3 * t + 2])); label.push(op.name); }
      rec.name = op.name;
      rec.pair = {referenceZ: op.refZ, referenceWidth: r5(hi - lo), fullWidth: r5(ahi - alo), boreLineX: r5(c), tubeWidth: op.width, factorX: r6(k), clampHalf: op.width / 2, clampedVertices: sc.clampedVertices,
        centresX: [r5(c - op.offset), r5(c + op.offset)], trianglesPerTube: tris.length,
        rule: 'the reconstructed single tube scaled across X about the bore line so its main section (referenceZ) is the tube width, its flared breech collar clamped to the same half-width, then two copies centred `offset` either side of the bore line (the side-by-side pair, joined along the rib; together exactly the action\'s width); the copy shares the UVs / maps'};
    } else fail(`unknown op ${op.op}`);
    recs.push(rec);
  }
  return {mesh: {P: Float64Array.from(P), N: Float64Array.from(N), UV: Float64Array.from(UV), I: Uint32Array.from(I)}, label, recs};
}
export function triCrossesBox(m, tri, box) {
  const min = [0, 1, 2].map(k => Math.min(...tri.map(v => m.P[3 * v + k]))), max = [0, 1, 2].map(k => Math.max(...tri.map(v => m.P[3 * v + k])));
  return [0, 1, 2].every(k => max[k] >= box.min[k] && min[k] <= box.max[k]);
}
export const triList = (mesh, list) => Uint32Array.from(list.flatMap(t => [mesh.I[3 * t], mesh.I[3 * t + 1], mesh.I[3 * t + 2]]));
