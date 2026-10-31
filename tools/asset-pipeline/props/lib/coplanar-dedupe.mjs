// Task mall-playtest-revision-20261031 (Studio Beta, lane FIX, U06): LOCAL REPAIR of coplanar duplicate triangle layers.
//
// User: "the new vault asset has flickering on the door / messed up triangles". Cause (measured on mall-gun-safe-tall.glb, M35): the
// raw Meshy refine models the door face as TWO interleaved, partly overlapping front-facing triangle tilings plus a few inward-facing
// triangles, all in the SAME plane (the raw preview has the same); the material is double-sided, so every layer is drawn and the
// depth test picks a different one per pixel / frame — z-fighting patches that swap texture islands along triangle edges.
//
// Repair (pure, deterministic gltf-transform helper; no regeneration, the raw master is untouched): inside a selection box, triangles
// lying in a common plane perpendicular to `axis` are grouped per plane; within a plane
//   1. FRONT layers: triangles facing `facing` (+1 / -1 along the axis) are taken in priority order (larger area first, then lower
//      index); each is CLIPPED against every triangle already kept (exact 2D convex polygon difference in the plane, attributes —
//      position, normal, UVs, tangent, colour — interpolated barycentrically from the source triangle), so the plane keeps exactly
//      ONE front layer over the union of the old coverage: no hole, no overlap;
//   2. OPPOSITE-facing triangles in that plane that overlap the front layer are dropped (with a double-sided material they are drawn
//      from the front too); the inside of the leaf gets a separate inner plate in the openable spec instead.
//      Task mall-round2-20261031 (lane PROPS, M04 / M07): opt-in `clipOpposite: true` keeps the part of such an opposite triangle that
//      the front layer does NOT cover (clipped exactly, attributes interpolated, its own winding), so a plane whose two layers cover
//      different areas never opens a hole. The default (false) is the original behaviour, byte for byte.
//      Opt-in `minAxisCos` (e.g. 0.98): only triangles whose 3D normal is within acos(minAxisCos) of the axis are candidates, so a
//      larger plane tolerance (warped sheets) never treats a steep, narrow sliver as part of the plane. Default: no normal test.
//      Opt-in `slab: [lo, hi]`: all three vertices must also lie in [lo, hi] along the axis (no tolerance margin), so a large plane
//      tolerance never reaches a distinct surface just below / above (a shelf's lip underside 1.7 cm under its top).
// Everything outside the box / off-plane is untouched (vertex order, indices, attributes).

const EPS_AREA = 1e-9;
/** On-line tolerance of the 2D clipper (m) and the overlap below which a triangle counts as untouched (m2, 0.1 mm2). */
const ON = 1e-5, MIN_OVERLAP = 1e-7;

function area2(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

/** Split convex polygon P (points [u, v, ...payload]) by the line a->b: [left (inside of a CCW clip edge), right]. */
function splitByLine(P, a, b) {
  const L = [], R = [];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  // signed distance (m) to the line; within ON (0.01 mm) a vertex lies ON the line and belongs to both sides
  const side = p => { const d = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len; return Math.abs(d) < ON ? 0 : d; };
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], sp = side(p), sq = side(q);
    if (sp >= 0) L.push(p);
    if (sp <= 0) R.push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const t = sp / (sp - sq), m = p.map((x, k) => x + (q[k] - x) * t);
      L.push(m); R.push(m);
    }
  }
  return [L, R];
}

/** Convex P minus convex triangle T (CCW in 2D) -> convex pieces. */
function subtract(P, T) {
  const tri = area2(T) > 0 ? T : [T[0], T[2], T[1]];
  const out = [];
  let rest = P;
  for (let i = 0; i < 3 && rest.length >= 3; i++) {
    const [inside, outside] = splitByLine(rest, tri[i], tri[(i + 1) % 3]);
    if (outside.length >= 3 && Math.abs(area2(outside)) > EPS_AREA) out.push(outside);
    rest = inside;
  }
  return out;
}

function triIndex(prim) {
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = idx ? idx.getScalar(i) : i;
  return out;
}

/**
 * Repair coplanar duplicate layers inside `box` ({min: [x, y, z], max: [x, y, z]}, the derivative frame) on planes perpendicular to
 * `axis` (0 / 1 / 2) whose front faces point to `facing` (+1 / -1). `tol` = plane / box tolerance (m); `keep` = which overlapping
 * layer wins ('larger' / 'smaller' triangles first). Returns a provenance record.
 */
export function dedupeCoplanar(doc, {box, axis = 2, facing = -1, tol = 0.001, keep = 'larger', clipOpposite = false, minAxisCos = null, slab = null}) {
  const [ia, ib] = [[1, 2], [2, 0], [0, 1]][axis];
  const rec = {axis, facing, keep, box, planes: [], trianglesIn: 0, frontKept: 0, frontClipped: 0, frontDropped: 0, oppositeDropped: 0, piecesAdded: 0, overlapRemovedM2: 0};
  if (clipOpposite) Object.assign(rec, {clipOpposite: true, oppositeClipped: 0});
  if (minAxisCos !== null) rec.minAxisCos = minAxisCos;
  if (slab) rec.slab = slab;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const I = triIndex(prim);
    const sem = prim.listSemantics();
    const attrs = sem.map(s => prim.getAttribute(s));
    for (const a of attrs) if (a.getNormalized() || !(a.getArray() instanceof Float32Array)) throw new Error('dedupeCoplanar: quantised / normalised vertex attributes are unsupported');
    const V = (i, out = [0, 0, 0]) => pos.getElement(i, out);
    // candidate triangles: all three vertices inside the box and on one axis plane, normal along the axis
    const cands = [];
    for (let t = 0; t < I.length / 3; t++) {
      const v = [V(I[3 * t]), V(I[3 * t + 1]), V(I[3 * t + 2])];
      if (!v.every(p => p.every((x, k) => x >= box.min[k] - tol && x <= box.max[k] + tol))) continue;
      const c = v.map(p => p[axis]);
      if (Math.max(...c) - Math.min(...c) > tol) continue;
      if (slab && !c.every(x => x >= slab[0] && x <= slab[1])) continue;
      if (minAxisCos !== null) {
        const e1 = [0, 1, 2].map(k => v[1][k] - v[0][k]), e2 = [0, 1, 2].map(k => v[2][k] - v[0][k]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (Math.abs(n[axis]) < minAxisCos * Math.hypot(n[0], n[1], n[2])) continue;
      }
      const P = v.map(p => [p[ia], p[ib]]);
      const a = area2(P);
      if (Math.abs(a) < EPS_AREA) continue;
      // facing along +axis when the 2D (ia, ib) winding is CCW (right-handed: ia x ib = axis)
      cands.push({t, plane: (c[0] + c[1] + c[2]) / 3, dir: Math.sign(a), area: Math.abs(a), P});
    }
    if (!cands.length) continue;
    rec.trianglesIn += cands.length;
    cands.sort((x, y) => x.plane - y.plane);
    const groups = [];
    for (const c of cands) { const g = groups.at(-1); if (g && c.plane - g.at(-1).plane <= tol) g.push(c); else groups.push([c]); }
    const drop = new Set();
    const add = []; // [{src: t, poly: [[u, v, w0, w1, w2]...]}]
    for (const g of groups) {
      // priority: keep = 'larger' (default: the larger triangle's texture wins where layers overlap) or 'smaller'
      const front = g.filter(c => c.dir === facing).sort((x, y) => (keep === 'smaller' ? x.area - y.area : y.area - x.area) || x.t - y.t);
      const opp = g.filter(c => c.dir !== facing);
      if (front.length < 2 && !opp.length) continue;
      const kept = []; // triangles (2D) already in the single layer
      let clipped = 0, dropped = 0, overlap = 0;
      for (const c of front) {
        // barycentric payload so new vertices interpolate the source triangle's attributes
        let pieces = [c.P.map((p, k) => [p[0], p[1], k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0])];
        for (const K of kept) pieces = pieces.flatMap(pc => subtract(pc, K));
        const left = pieces.reduce((s, pc) => s + Math.abs(area2(pc)), 0);
        if (c.area - left < MIN_OVERLAP) { kept.push(c.P); continue; } // untouched (edge contact / numerical noise)
        overlap += c.area - left;
        drop.add(c.t);
        if (left <= EPS_AREA) { dropped++; continue; }
        clipped++;
        for (const pc of pieces) add.push({src: c.t, poly: pc});
        kept.push(c.P);
      }
      // opposite-facing triangles overlapping the front layer (barycentric payload: only used when clipOpposite keeps the remainder)
      let oppDropped = 0, oppClipped = 0;
      for (const c of opp) {
        let pieces = [c.P.map((p, k) => [p[0], p[1], k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0])];
        for (const K of kept) pieces = pieces.flatMap(pc => subtract(pc, K));
        const left = pieces.reduce((s, pc) => s + Math.abs(area2(pc)), 0);
        if (c.area - left >= MIN_OVERLAP) {
          drop.add(c.t); oppDropped++; overlap += c.area - left;
          if (clipOpposite && left > EPS_AREA) { oppClipped++; for (const pc of pieces) add.push({src: c.t, poly: pc, want: -facing}); }
        }
      }
      if (!clipped && !dropped && !oppDropped) continue;
      rec.planes.push({at: +g[0].plane.toFixed(5), front: front.length, clipped, dropped, opposite: opp.length, oppositeDropped: oppDropped, ...(clipOpposite ? {oppositeClipped: oppClipped} : {}), overlapM2: +overlap.toFixed(5)});
      if (clipOpposite) rec.oppositeClipped += oppClipped;
      rec.frontClipped += clipped; rec.frontDropped += dropped; rec.oppositeDropped += oppDropped; rec.overlapRemovedM2 += overlap;
      rec.frontKept += front.length - clipped - dropped;
    }
    if (!drop.size) continue;
    // rebuild: original vertices unchanged; clipped pieces get new vertices interpolated from their source triangle
    const base = pos.getCount();
    const newVerts = []; // [{src: t, w: [w0, w1, w2]}]
    const newIdx = [];
    for (let t = 0; t < I.length / 3; t++) if (!drop.has(t)) newIdx.push(I[3 * t], I[3 * t + 1], I[3 * t + 2]);
    for (const {src, poly, want: wantDir} of add) {
      // keep the source triangle's winding: fan in polygon order, flipped when the polygon order is opposite to the source's
      const srcDir = Math.sign(area2(poly.map(p => [p[0], p[1]])));
      const ids = poly.map(p => { newVerts.push({src, w: [p[2], p[3], p[4]]}); return base + newVerts.length - 1; });
      const want = wantDir ?? facing; // a clipped front piece faces `facing`; a kept opposite remainder (clipOpposite) faces -facing
      for (let k = 1; k + 1 < ids.length; k++) {
        const tri = srcDir === want ? [ids[0], ids[k], ids[k + 1]] : [ids[0], ids[k + 1], ids[k]];
        newIdx.push(...tri);
        rec.piecesAdded++;
      }
    }
    for (let a = 0; a < attrs.length; a++) {
      const acc = attrs[a], n = acc.getElementSize(), arr = acc.getArray();
      const out = new arr.constructor((base + newVerts.length) * n);
      out.set(arr.subarray(0, base * n));
      const e0 = [], e1 = [], e2 = [];
      newVerts.forEach((nv, j) => {
        acc.getElement(I[3 * nv.src], e0); acc.getElement(I[3 * nv.src + 1], e1); acc.getElement(I[3 * nv.src + 2], e2);
        const val = e0.map((x, k) => nv.w[0] * x + nv.w[1] * e1[k] + nv.w[2] * e2[k]);
        if (sem[a] === 'NORMAL' || (sem[a] === 'TANGENT')) { const l = Math.hypot(val[0], val[1], val[2]) || 1; for (let k = 0; k < 3; k++) val[k] /= l; if (sem[a] === 'TANGENT') val[3] = e0[3]; }
        out.set(val, (base + j) * n);
      });
      acc.setArray(out);
    }
    const idxAcc = prim.getIndices();
    const IdxType = base + newVerts.length > 65535 ? Uint32Array : (idxAcc?.getArray().constructor ?? Uint32Array);
    if (idxAcc) idxAcc.setArray(new IdxType(newIdx));
    else throw new Error('dedupeCoplanar: non-indexed primitive (unsupported)');
  }
  rec.overlapRemovedM2 = +rec.overlapRemovedM2.toFixed(5);
  return rec;
}
