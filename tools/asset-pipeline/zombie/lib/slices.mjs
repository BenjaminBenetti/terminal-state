// Horizontal cross-section analysis: cluster vertices of a height slice into
// connected 2D (x,z) occupancy components. Used to find legs, arms, torso, neck.

/** Build per-slice vertex buckets. pos is xyz Float32Array (already in game space). */
export function bucketByHeight(pos, y0, y1, step) {
  const n = Math.ceil((y1 - y0) / step);
  const buckets = Array.from({length: n}, () => []);
  for (let i = 0; i < pos.length / 3; i++) {
    const k = Math.floor((pos[i * 3 + 1] - y0) / step);
    if (k >= 0 && k < n) buckets[k].push(i);
  }
  return {buckets, y0, step};
}

/** Connected components of occupied grid cells (8-connected) for a vertex subset. */
export function clusterXZ(pos, ids, cell = 0.015, minCount = 8) {
  const cells = new Map();
  for (const i of ids) {
    const cx = Math.floor(pos[i * 3] / cell), cz = Math.floor(pos[i * 3 + 2] / cell);
    const key = cx * 100003 + cz;
    let c = cells.get(key);
    if (!c) { c = {cx, cz, ids: [], label: -1}; cells.set(key, c); }
    c.ids.push(i);
  }
  const clusters = [];
  for (const c of cells.values()) {
    if (c.label >= 0) continue;
    const label = clusters.length;
    const stack = [c]; c.label = label;
    const members = [];
    while (stack.length) {
      const cur = stack.pop(); members.push(cur);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const nb = cells.get((cur.cx + dx) * 100003 + (cur.cz + dz));
        if (nb && nb.label < 0) { nb.label = label; stack.push(nb); }
      }
    }
    const vids = members.flatMap(m => m.ids);
    clusters.push(summarize(pos, vids));
  }
  return clusters.filter(c => c.count >= minCount).sort((a, b) => a.cx - b.cx);
}

export function summarize(pos, vids) {
  let sx = 0, sy = 0, sz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const i of vids) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    sx += x; sy += y; sz += z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const n = vids.length;
  return {count: n, cx: sx / n, cy: sy / n, cz: sz / n, minX, maxX, minY, maxY, minZ, maxZ, ids: vids,
    // bbox centre is less biased by uneven vertex density than the centroid
    bx: (minX + maxX) / 2, bz: (minZ + maxZ) / 2};
}

/** Fit a 3D line (centroid + principal direction) to points via power iteration on covariance. */
export function fitLine(points) {
  const n = points.length;
  const c = [0, 0, 0];
  for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= n; c[1] /= n; c[2] /= n;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += d[a] * d[b];
  }
  let v = [1, -1, 0.1];
  for (let it = 0; it < 100; it++) {
    const w = [C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[3] * v[0] + C[4] * v[1] + C[5] * v[2], C[6] * v[0] + C[7] * v[1] + C[8] * v[2]];
    const l = Math.hypot(...w); v = w.map(x => x / l);
  }
  return {center: c, dir: v};
}
