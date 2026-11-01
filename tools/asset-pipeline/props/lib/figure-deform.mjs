// Task studio-beta-mall-round3-20261031-01 (Studio Beta, lane SHOPS, R4 — user: "no female clothing store ... Make sure to make a female
// maniqune. This asset will be handy in other spots, because it will be spooooky!"): a ZERO-SPEND local derivative — a scripted, smooth
// VERTEX DEFORMATION of the accepted M07 full-figure display mannequin (fibreglass form on a chrome rod + round base disc) to adult
// FEMALE proportions with a featureless egg head. No generation, no new vertices / triangles, no UV / texture / material change: every
// vertex keeps its index, UV and material; only positions and normals move.
//
// Runs on a derivative in its FINAL frame (front -Z, +Y up, grounded, centred, metres; build-mall-track3.mjs derive() after the
// rotate / uniform size step). Pure and deterministic (no randomness, fixed iteration order).
//
// Membership (by mesh CONNECTIVITY, vertices welded by quantised position so UV-seam copies always move together):
//   stand  every connected component except the largest (base disc, rod, T-bar): left rigid;
//   arm    the body's vertices reachable from a seed on each side (the widest vertex between `arms.seedY`) through edges whose both ends
//          lie below `armCut` (the arms hang free of the torso below the armpit);
//   leg    the body's vertices reachable from each foot (the lowest vertex per side) through edges below `legCut` (the crotch);
//   torso  the rest (pelvis, waist, chest, shoulders, neck, head).
// Field (applied to the rest position p of every non-stand vertex, in this order):
//   0. featureless head (torso set): closest-point projection onto a smooth implicit head `face` — the smooth union (polynomial smin,
//      radius face.k) of the fitted cranium ellipsoid, a jaw / chin ellipsoid and a neck capsule matched to the existing neck — faded in
//      over `face.blend` (rest y): the sculpted nose / lips / eye sockets / ear flaps become one smooth egg head that meets the neck;
//   1. lateral profile: x *= S(y) (smooth knots: narrower shoulders / ribcage, waist, wider hips). Arms take the constant S(armCut), so
//      the arm and the shoulder it hangs from move together (continuous at the armpit seam);
//   2. legs: x / z about the leg's own axis (per-height centroid, after step 1) by `legs.slim` knots (slimmer calves / ankles);
//   3. arms: x / z about the arm's own axis by `arms.slim`, then a small outward swing about the shoulder pivot (z axis) — both faded in
//      over `arms.bend` below the armpit (the upper arm bends a little, the forearm / hand move rigidly): clears the wider hips;
//   4. shoulder slope: dy = -drop on the arms and on the torso's shoulder caps (|x| ramp `shoulder.x`, height ramp `shoulder.y`);
//   5. bust (torso): two smooth lobes pushed forward (-Z) on the chest front (asymmetric vertical falloff: soft above, a defined
//      underside), weighted by front-ness `bust.zFront`;
//   6. head + neck: uniform scale about `head.pivot`, faded in over `head.blend` (slightly smaller head, slimmer neck).
// Normals: n' = normalize(cof(J) n) with J the central-difference Jacobian of the per-vertex field (tangents, if any: t' = J t); every
// vertex of the projected head (rest y >= face.normalsFrom) takes the area-weighted normal of the final surface (smooth egg shading;
// the stored normal's side is kept).

const smooth = (a, b, x) => { if (a === b) return x >= b ? 1 : 0; const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Smooth knot profile: piecewise smoothstep between consecutive [x, value] knots, clamped at the ends. */
export function profile(knots, x) {
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) if (x <= knots[i][0]) { const [x0, v0] = knots[i - 1], [x1, v1] = knots[i]; return v0 + (v1 - v0) * smooth(x0, x1, x); }
  return knots[knots.length - 1][1];
}

/** Signed distance (approx.) of the implicit head: smin(cranium ellipsoid, jaw ellipsoid, neck capsule). */
export function headSdf(F, p) {
  const ell = ({centre: c, radii: r}) => {
    const q = [0, 1, 2].map(k => (p[k] - c[k]) / r[k]), q2 = [0, 1, 2].map(k => (p[k] - c[k]) / (r[k] * r[k]));
    const k0 = Math.hypot(...q), k1 = Math.hypot(...q2) || 1e-12;
    return (k0 * (k0 - 1)) / k1;
  };
  const cap = ({a, b, r}) => {
    const ba = [0, 1, 2].map(k => b[k] - a[k]), pa = [0, 1, 2].map(k => p[k] - a[k]);
    const t = Math.min(1, Math.max(0, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2)));
    return Math.hypot(pa[0] - t * ba[0], pa[1] - t * ba[1], pa[2] - t * ba[2]) - r;
  };
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; };
  let d = ell(F.cranium);
  if (F.jaw) d = smin(d, ell(F.jaw), F.k);
  if (F.neck) d = smin(d, cap(F.neck), F.k);
  return d;
}
/** Closest point on the implicit head from p (Newton steps along the numerical gradient). */
function projectHead(F, p) {
  let q = [...p];
  const e = 1e-5;
  for (let it = 0; it < (F.iterations ?? 12); it++) {
    const d = headSdf(F, q);
    const g = [0, 1, 2].map(k => { const a = [...q], b = [...q]; a[k] += e; b[k] -= e; return (headSdf(F, a) - headSdf(F, b)) / (2 * e); });
    const g2 = g[0] ** 2 + g[1] ** 2 + g[2] ** 2 || 1e-12;
    q = q.map((c, k) => c - (d * g[k]) / g2);
    if (Math.abs(d) < 1e-7) break;
  }
  return q;
}

function triIndex(prim) {
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = idx ? idx.getScalar(i) : i;
  return out;
}

/** Welded vertex graph over every primitive of `doc` (quantised to 1e-5 m): positions, per-primitive maps, adjacency, components. */
function weldGraph(doc) {
  const key = new Map(), pos = [], prims = [];
  const v = [0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), map = new Int32Array(P.getCount());
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, v);
      const k = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`;
      let w = key.get(k);
      if (w === undefined) { w = pos.length; key.set(k, w); pos.push([v[0], v[1], v[2]]); }
      map[i] = w;
    }
    prims.push({prim, map, I: triIndex(prim)});
  }
  const adj = Array.from({length: pos.length}, () => new Set());
  for (const {map, I} of prims) for (let t = 0; t < I.length; t += 3) {
    const a = map[I[t]], b = map[I[t + 1]], c = map[I[t + 2]];
    adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b);
  }
  const comp = new Int32Array(pos.length).fill(-1), sizes = [];
  for (let s = 0; s < pos.length; s++) {
    if (comp[s] >= 0) continue;
    const id = sizes.length; let n = 0; const stack = [s]; comp[s] = id;
    while (stack.length) { const a = stack.pop(); n++; for (const b of adj[a]) if (comp[b] < 0) { comp[b] = id; stack.push(b); } }
    sizes.push(n);
  }
  return {pos, prims, adj, comp, sizes};
}

/** Vertices reachable from `seed` through edges whose far end satisfies `ok`. */
function grow(g, seed, ok) {
  const seen = new Set([seed]), stack = [seed];
  while (stack.length) { const a = stack.pop(); for (const b of g.adj[a]) if (!seen.has(b) && ok(b)) { seen.add(b); stack.push(b); } }
  return seen;
}

/** Per-height centroid polyline of a vertex set (bins of `step` m), linearly interpolated, clamped: y -> [cx, cz]. */
function axisOf(pos, set, step = 0.03) {
  const bins = new Map();
  for (const i of set) { const p = pos[i], b = Math.floor(p[1] / step); const e = bins.get(b) ?? [0, 0, 0, 0]; e[0] += p[1]; e[1] += p[0]; e[2] += p[2]; e[3]++; bins.set(b, e); }
  const pts = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => [e[0] / e[3], e[1] / e[3], e[2] / e[3]]);
  return y => {
    if (y <= pts[0][0]) return [pts[0][1], pts[0][2]];
    for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const t = (y - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return [pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]), pts[i - 1][2] + t * (pts[i][2] - pts[i - 1][2])]; }
    const l = pts[pts.length - 1]; return [l[1], l[2]];
  };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Deforms the figure in `doc` (final frame) in place. `spec` — see the header; every length in metres of the CURRENT frame.
 * Returns {members: {stand, torso, armL, armR, legL, legR} (welded vertex counts), armLateral, headVerts}.
 */
export function deformFigure(doc, spec) {
  const g = weldGraph(doc);
  const {pos} = g;
  const body = g.sizes.indexOf(Math.max(...g.sizes));
  const M = new Int8Array(pos.length); // 0 stand, 1 torso, 2 armL (x < 0), 3 armR, 4 legL, 5 legR
  for (let i = 0; i < pos.length; i++) M[i] = g.comp[i] === body ? 1 : 0;
  const inBody = i => g.comp[i] === body;
  const pick = (pred, score) => { let best = -1, bs = -Infinity; for (let i = 0; i < pos.length; i++) if (inBody(i) && pred(pos[i]) && score(pos[i]) > bs) { bs = score(pos[i]); best = i; } return best; };
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const seed = pick(p => p[1] > spec.arms.seedY[0] && p[1] < spec.arms.seedY[1], p => side * p[0]);
    const set = grow(g, seed, i => inBody(i) && pos[i][1] < spec.armCut);
    for (const i of set) if (side * pos[i][0] < spec.arms.minAbsX) throw new Error(`deformFigure: the ${side < 0 ? 'left' : 'right'} arm set reaches x ${pos[i][0].toFixed(3)} (touches the torso below the cut?)`);
    for (const i of set) M[i] = side < 0 ? 2 : 3;
    arms.push({side, set, axis: axisOf(pos, set)});
    const foot = pick(p => side * p[0] > 0.01, p => -p[1] - Math.abs(p[0]) * 1e-6);
    const lset = grow(g, foot, i => inBody(i) && pos[i][1] < spec.legCut && M[i] === 1);
    for (const i of lset) if (side * pos[i][0] < -0.005) throw new Error('deformFigure: a leg set crosses the centre line (legs joined below the cut?)');
    for (const i of lset) M[i] = side < 0 ? 4 : 5;
    legs.push({side, set: lset, axis: axisOf(pos, lset)});
  }
  const sArm = profile(spec.lateral, spec.armCut);
  const th = (spec.arms.outDeg ?? 0) * Math.PI / 180;
  const B = spec.bust, H = spec.head, S = spec.shoulder, F = spec.face;
  // the deformation of one point with a fixed membership (pure: used for the positions and the Jacobian)
  const field = (m, x, y, z) => {
    if (m === 0) return [x, y, z];
    if (F && m === 1) { // 0. featureless head
      const w = smooth(F.blend[0], F.blend[1], y);
      if (w > 0) { const q = projectHead(F, [x, y, z]); x += w * (q[0] - x); y += w * (q[1] - y); z += w * (q[2] - z); }
    }
    let X, Y = y, Z = z;
    if (m === 2 || m === 3) {
      const side = m === 2 ? -1 : 1, A = arms[m - 2];
      X = x * sArm;
      const r = smooth(spec.arms.bend[0], spec.arms.bend[1], y); // 0 at the armpit, 1 below the bend
      const [ax, az] = A.axis(y), k = 1 - r * (1 - spec.arms.slim);
      X = ax * sArm + (X - ax * sArm) * k; Z = az + (Z - az) * k;
      const piv = [side * spec.arms.pivot[0] * sArm, spec.arms.pivot[1]], a = side * th * r; // outward: away from x = 0
      const dx = X - piv[0], dy = Y - piv[1];
      X = piv[0] + dx * Math.cos(a) - dy * Math.sin(a); Y = piv[1] + dx * Math.sin(a) + dy * Math.cos(a);
      Y -= S.drop;
    } else {
      const s = profile(spec.lateral, y);
      X = x * s;
      if (m === 4 || m === 5) {
        const L = legs[m - 4], [ax, az] = L.axis(y), k = profile(spec.legs.slim, y);
        X = ax * s + (X - ax * s) * k; Z = az + (Z - az) * k;
      } else {
        Y -= S.drop * smooth(S.x[0], S.x[1], Math.abs(x)) * smooth(S.y[0], S.y[1], y);
        const fz = smooth(B.zFront[0], B.zFront[1], z);
        if (fz > 0) {
          const dyB = y - B.y, sy = dyB >= 0 ? B.syUp : B.syDown;
          const lobes = Math.exp(-((x - B.x) ** 2) / (2 * B.sx * B.sx)) + Math.exp(-((x + B.x) ** 2) / (2 * B.sx * B.sx));
          Z -= B.depth * fz * lobes * Math.exp(-(dyB * dyB) / (2 * sy * sy));
        }
      }
    }
    const w = smooth(H.blend[0], H.blend[1], y);
    if (w > 0) { const k = 1 + w * (H.scale - 1); X = H.pivot[0] + (X - H.pivot[0]) * k; Y = H.pivot[1] + (Y - H.pivot[1]) * k; Z = H.pivot[2] + (Z - H.pivot[2]) * k; }
    return [X, Y, Z];
  };
  const h = 1e-4;
  const jac = (m, p) => { const J = []; for (let k = 0; k < 3; k++) { const a = [...p], b = [...p]; a[k] += h; b[k] -= h; const fa = field(m, ...a), fb = field(m, ...b); J.push([0, 1, 2].map(r => (fa[r] - fb[r]) / (2 * h))); } return J; }; // J[k] = column k
  const jacNormal = (J, n) => { const [c0, c1, c2] = J, r0 = cross(c1, c2), r1 = cross(c2, c0), r2 = cross(c0, c1); return [0, 1, 2].map(k => n[0] * r0[k] + n[1] * r1[k] + n[2] * r2[k]); };
  const out = pos.map((p, i) => field(M[i], p[0], p[1], p[2]));
  // smooth area-weighted normals of the final surface for the projected head
  const gN = new Map();
  if (F) for (let i = 0; i < pos.length; i++) if (M[i] === 1 && pos[i][1] >= F.normalsFrom) gN.set(i, [0, 0, 0]);
  if (gN.size) for (const {map, I} of g.prims) for (let t = 0; t < I.length; t += 3) {
    const a = map[I[t]], b = map[I[t + 1]], c = map[I[t + 2]];
    if (!gN.has(a) && !gN.has(b) && !gN.has(c)) continue;
    const A = out[a], e1 = [0, 1, 2].map(k => out[b][k] - A[k]), e2 = [0, 1, 2].map(k => out[c][k] - A[k]), fn = cross(e1, e2);
    for (const w of new Set([a, b, c])) if (gN.has(w)) { const s = gN.get(w); for (let k = 0; k < 3; k++) s[k] += fn[k]; }
  }
  const v = [0, 0, 0], q = [0, 0, 0, 0];
  for (const {prim, map} of g.prims) {
    const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TANGENT');
    for (let i = 0; i < P.getCount(); i++) {
      const w = map[i];
      if (M[w] === 0) continue;
      P.setElement(i, out[w]);
      if (!N && !T) continue;
      if (gN.has(w)) {
        const s = gN.get(w), l = Math.hypot(...s) || 1;
        let n = s.map(c => c / l);
        if (N) {
          N.getElement(i, v);
          if (v[0] * n[0] + v[1] * n[1] + v[2] * n[2] < 0) n = n.map(c => -c); // keep the stored side (outward stays outward)
          N.setElement(i, n);
        }
        if (T) { T.getElement(i, q); const d = q[0] * n[0] + q[1] * n[1] + q[2] * n[2], o = [0, 1, 2].map(k => q[k] - d * n[k]), l2 = Math.hypot(...o) || 1; T.setElement(i, [o[0] / l2, o[1] / l2, o[2] / l2, q[3]]); }
        continue;
      }
      const J = jac(M[w], pos[w]);
      if (N) { N.getElement(i, v); const n = jacNormal(J, v), l = Math.hypot(...n) || 1; N.setElement(i, n.map(c => c / l)); }
      if (T) { T.getElement(i, q); const t = [0, 1, 2].map(k => J[0][k] * q[0] + J[1][k] * q[1] + J[2][k] * q[2]), l = Math.hypot(...t) || 1; T.setElement(i, [t[0] / l, t[1] / l, t[2] / l, q[3]]); }
    }
  }
  const count = c => M.reduce((s, m) => s + (m === c ? 1 : 0), 0);
  return {members: {stand: count(0), torso: count(1), armL: count(2), armR: count(3), legL: count(4), legR: count(5)}, armLateral: +sArm.toFixed(4), headVerts: gN.size};
}
