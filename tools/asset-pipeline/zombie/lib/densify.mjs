// Meshy T2.5 migration (2026-10-29, lane CHARS): consistent edge-split densification of a LOW-poly source.
//
// The CPU rig pipeline (skeleton.mjs / slices.mjs / garment.mjs measureGarment / pants.mjs measurePants /
// creature landmarks.mjs) measures landmarks from VERTEX positions in 1 cm horizontal slices clustered on 1.2-2.5 cm
// cells, tuned on the ~0.9 M-triangle Pixal3D masters (vertex spacing ~3-5 mm). A Meshy T2.5 smart-topology output
// has ~15-21 k triangles whose edges on flat areas are several cm long, so those slices would be empty or broken
// into fragments. This splits every edge longer than `maxEdge` at its midpoint (the decision is per edge, so both
// triangles sharing an edge always split it identically: no T-junctions, and position / UV / normal are linear
// along the edge, so the densified surface IS the source surface and its texture mapping is unchanged) until no
// edge is longer than `maxEdge`. Deterministic; nothing is smoothed or moved.
//
// The result is used only as the "high" (dense) mesh of the existing stages: landmark slices, the bake source and
// the simplifier input. The texture bake therefore samples exactly the source's own texture.

const KEY = 8388608; // 2^23: vertex ids stay far below this (keys < 2^46, exact in a double)

/**
 * @param m {pos: Float32Array, nrm: Float32Array, uv: Float32Array, idx: Uint32Array} (UV-split source mesh)
 * @param maxEdge maximum edge length in the source's own units
 * @returns {pos, nrm, uv, idx, passes, stats}
 */
export function densify(m, maxEdge, {maxPasses = 12, maxTriangles = 3_000_000} = {}) {
  let P = Array.from(m.pos), N = Array.from(m.nrm), U = Array.from(m.uv), I = Array.from(m.idx);
  const max2 = maxEdge * maxEdge;
  const len2 = (a, b) => { const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz; };
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    const mid = new Map(); // edge key -> midpoint vertex id (only edges that split)
    const midOf = (a, b) => {
      const lo = a < b ? a : b, hi = a < b ? b : a, k = lo * KEY + hi;
      let v = mid.get(k);
      if (v !== undefined) return v;
      if (len2(lo, hi) <= max2) { mid.set(k, -1); return -1; }
      v = P.length / 3;
      // computed from the ordered pair so the value never depends on which triangle asks first
      for (let c = 0; c < 3; c++) P.push((P[lo * 3 + c] + P[hi * 3 + c]) * 0.5);
      let nx = N[lo * 3] + N[hi * 3], ny = N[lo * 3 + 1] + N[hi * 3 + 1], nz = N[lo * 3 + 2] + N[hi * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1; N.push(nx / l, ny / l, nz / l);
      U.push((U[lo * 2] + U[hi * 2]) * 0.5, (U[lo * 2 + 1] + U[hi * 2 + 1]) * 0.5);
      mid.set(k, v);
      return v;
    };
    const out = [];
    let split = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a);
      const n = (ab >= 0) + (bc >= 0) + (ca >= 0);
      if (!n) { out.push(a, b, c); continue; }
      split++;
      if (n === 3) { out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca); continue; }
      if (n === 1) {
        if (ab >= 0) out.push(a, ab, c, ab, b, c);
        else if (bc >= 0) out.push(b, bc, a, bc, c, a);
        else out.push(c, ca, b, ca, a, b);
        continue;
      }
      // two split edges: the corner between them becomes its own triangle, the remaining quad is cut on a fixed diagonal
      if (ca < 0) out.push(ab, b, bc, a, ab, bc, a, bc, c);
      else if (ab < 0) out.push(bc, c, ca, b, bc, ca, b, ca, a);
      else out.push(ca, a, ab, c, ca, ab, c, ab, b);
    }
    I = out;
    if (!split) break;
    if (I.length / 3 > maxTriangles) throw new Error(`densify: ${I.length / 3} triangles exceed ${maxTriangles} (maxEdge ${maxEdge} too small)`);
  }
  let longest = 0;
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) longest = Math.max(longest, len2(I[t + e], I[t + (e + 1) % 3]));
  return {pos: Float32Array.from(P), nrm: Float32Array.from(N), uv: Float32Array.from(U), idx: Uint32Array.from(I), passes,
    stats: {method: 'per-edge midpoint split (consistent across shared edges, linear position/UV/normal) until every edge <= maxEdge; surface and texture mapping unchanged',
      maxEdge: +maxEdge.toPrecision(5), passes, sourceTriangles: m.idx.length / 3, sourceVertices: m.pos.length / 3, triangles: I.length / 3, vertices: P.length / 3, longestEdge: +Math.sqrt(longest).toPrecision(5)}};
}
