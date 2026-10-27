// Orientation, alignment, scale and gun anchor analysis (all deterministic geometry measurements).

export const mat3mul = (A, B) => [0, 1, 2].map(r => [0, 1, 2].map(c => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]));
export const det3 = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
export const rotY = deg => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
export const rotX = deg => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };

export function transformPositions(P, M, s = 1, t = [0, 0, 0]) {
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    for (let r = 0; r < 3; r++) out[i + r] = s * (M[r][0] * x + M[r][1] * y + M[r][2] * z) + t[r];
  }
  return out;
}

export function bbox(P) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { if (P[i + c] < min[c]) min[c] = P[i + c]; if (P[i + c] > max[c]) max[c] = P[i + c]; }
  return {min, max, size: [0, 1, 2].map(c => max[c] - min[c]), center: [0, 1, 2].map(c => (max[c] + min[c]) / 2)};
}

const lsq = pts => { // y = a + b x
  const n = pts.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return {a: (sy - b * sx) / n, b};
};

// Slice profile along Z (bins of `bin`): per bin min/max of x and y.
export function profileZ(P, bin) {
  const bb = bbox(P);
  const B = Math.ceil(bb.size[2] / bin);
  const prof = Array.from({length: B}, (_, b) => ({z: bb.min[2] + (b + 0.5) * bin, minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity, n: 0}));
  for (let i = 0; i < P.length; i += 3) {
    const b = Math.min(B - 1, Math.floor((P[i + 2] - bb.min[2]) / bin));
    const s = prof[b]; s.n++;
    if (P[i + 1] < s.minY) s.minY = P[i + 1]; if (P[i + 1] > s.maxY) s.maxY = P[i + 1];
    if (P[i] < s.minX) s.minX = P[i]; if (P[i] > s.maxX) s.maxX = P[i];
  }
  return {bb, prof: prof.filter(s => s.n > 0)};
}

// Gun barrel alignment, measured on positions already mapped to muzzle -Z / top +Y.
// Yaw: least-squares line through slice x-centres over the front `yawFrac` of the length.
// Pitch: line through slice y-centres over the front `pitchFrac` (muzzle device / barrel only).
export function barrelAlignment(P, {yawFrac = 0.25, pitchFrac = 0.08, bin = 0.01} = {}) {
  const {bb, prof} = profileZ(P, bin);
  const L = bb.size[2];
  const yawPts = prof.filter(s => s.z < bb.min[2] + yawFrac * L).map(s => [s.z, (s.minX + s.maxX) / 2]);
  const pitchPts = prof.filter(s => s.z < bb.min[2] + pitchFrac * L).map(s => [s.z, (s.minY + s.maxY) / 2]);
  const fy = lsq(yawPts);
  // x = a + b z  -> barrel direction (b, ., 1) ; rotate about Y so the direction has no X component
  return {yawDeg: Math.atan(fy.b) * 180 / Math.PI, yawSamples: yawPts.length};
}

// Pitch check (measured, not corrected): Theil-Sen slope of the slice top line (max y, 1 cm bins)
// over a plain barrel section given as fractions of the length from the muzzle.
export function barrelTopPitch(P, [f0, f1]) {
  const {bb, prof} = profileZ(P, 0.01);
  const L = bb.size[2];
  const pts = prof.filter(s => s.z >= bb.min[2] + f0 * L && s.z <= bb.min[2] + f1 * L).map(s => [s.z, s.maxY]);
  const slopes = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  slopes.sort((a, b) => a - b);
  const m = slopes.length ? slopes[slopes.length >> 1] : 0;
  const ys = pts.map(p => p[1]);
  return {pitchDeg: Math.atan(m) * 180 / Math.PI, section: [f0, f1], samples: pts.length, topLineRangeMeters: ys.length ? Math.max(...ys) - Math.min(...ys) : null};
}

// Prop squareness: yaw (about Y) minimising the XZ bounding rectangle area, searched over +-10 deg.
export function minAreaYaw(P) {
  let best = Infinity, bestDeg = 0;
  const step = Math.max(3, Math.floor(P.length / 3 / 200000)) * 3;
  for (let k = -100; k <= 100; k++) {
    const deg = k * 0.1, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i += step) {
      const x = c * P[i] + s * P[i + 2], z = -s * P[i] + c * P[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const A = (x1 - x0) * (z1 - z0);
    if (A < best - 1e-12) { best = A; bestDeg = deg; }
  }
  return bestDeg;
}

// Muzzle: barrel = vertices in the front `frontLen` whose y is within `barrelBand` of the front top.
// Tip z = min z of that set; x/y = bbox centre of barrel vertices within 1 cm of the tip.
export function findMuzzle(P, {frontLen = 0.04, barrelBand = 0.028} = {}) {
  const bb = bbox(P);
  let topY = -Infinity;
  for (let i = 0; i < P.length; i += 3) if (P[i + 2] < bb.min[2] + frontLen && P[i + 1] > topY) topY = P[i + 1];
  let zTip = Infinity;
  for (let i = 0; i < P.length; i += 3) if (P[i + 2] < bb.min[2] + frontLen && P[i + 1] > topY - barrelBand && P[i + 2] < zTip) zTip = P[i + 2];
  const x = [Infinity, -Infinity], y = [Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    if (P[i + 2] < zTip + 0.01 && P[i + 1] > topY - barrelBand) {
      x[0] = Math.min(x[0], P[i]); x[1] = Math.max(x[1], P[i]); y[0] = Math.min(y[0], P[i + 1]); y[1] = Math.max(y[1], P[i + 1]);
    }
  }
  return {position: [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, zTip], frontTopY: topY, barrelCrossSection: {x, y}, frontMostZ: bb.min[2]};
}

function centroidIn(P, test) {
  let n = 0; const c = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) if (test(P[i], P[i + 1], P[i + 2])) { n++; c[0] += P[i]; c[1] += P[i + 1]; c[2] += P[i + 2]; }
  return n ? c.map(v => v / n) : null;
}

// Grip estimates from the bottom profile (5 mm bins along Z, muzzle at -Z).
// 'pistol-grip': magazine = run holding the global minimum Y; pistol grip = deepest bin behind the
// magazine and ahead of the rear 25% (stock); receiver bottom yR = highest minY between them; grip
// run = contiguous bins below the halfway level; Grip = centroid of grip-run vertices 1..6 cm
// below yR (where the hand wraps, just behind the trigger).
// 'stock-wrist': trigger guard = deepest local protrusion of the bottom profile between 45% and
// 75% of the length; Grip = cross-section centre 4 cm behind the guard's rear edge (stock wrist).
export function findGrip(P, rule) {
  const {bb, prof} = profileZ(P, 0.005);
  const L = bb.size[2];
  if (rule === 'pistol-grip') {
    let gmin = 0; prof.forEach((s, i) => { if (s.minY < prof[gmin].minY) gmin = i; });
    let magEnd = gmin; while (magEnd + 1 < prof.length && prof[magEnd + 1].minY < prof[gmin].minY + 0.05) magEnd++;
    const stockStart = bb.min[2] + 0.75 * L;
    let g = -1;
    for (let i = magEnd + 1; i < prof.length && prof[i].z < stockStart; i++) if (g < 0 || prof[i].minY < prof[g].minY) g = i;
    let yR = -Infinity; for (let i = magEnd + 1; i < g; i++) yR = Math.max(yR, prof[i].minY);
    const half = (yR + prof[g].minY) / 2;
    let a = g, b = g;
    while (a - 1 > magEnd && prof[a - 1].minY < half) a--;
    while (b + 1 < prof.length && prof[b + 1].minY < half) b++;
    const z0 = prof[a].z - 0.0025, z1 = prof[b].z + 0.0025;
    const c = centroidIn(P, (x, y, z) => z >= z0 && z <= z1 && y < yR - 0.01 && y > yR - 0.06);
    return {position: c, rule, receiverBottomY: yR, gripRunZ: [z0, z1], gripBottomY: prof[g].minY, magazineBottomZ: prof[gmin].z};
  }
  if (rule === 'stock-wrist') {
    const lo = bb.min[2] + 0.45 * L, hi = bb.min[2] + 0.70 * L;
    const seg = prof.map((s, i) => ({...s, i})).filter(s => s.z >= lo && s.z <= hi);
    // two-sided local protrusion depth: the profile must rise again within 5 cm on BOTH sides
    // (rejects the continuously descending underside of the stock)
    let best = null;
    for (const s of seg) {
      const left = prof.filter(t => t.z < s.z && s.z - t.z <= 0.05), right = prof.filter(t => t.z > s.z && t.z - s.z <= 0.05);
      if (!left.length || !right.length) continue;
      const depth = Math.min(Math.max(...left.map(t => t.minY)), Math.max(...right.map(t => t.minY))) - s.minY;
      if (!best || depth > best.depth + 1e-9) best = {...s, depth};
    }
    let b = best.i; while (b + 1 < prof.length && prof[b + 1].minY < best.minY + best.depth / 2) b++;
    const zw = prof[b].z + 0.04;
    const w = prof.reduce((p, t) => Math.abs(t.z - zw) < Math.abs(p.z - zw) ? t : p);
    return {position: [(w.minX + w.maxX) / 2, (w.minY + w.maxY) / 2, zw], rule, triggerGuard: {z: best.z, bottomY: best.minY, depth: best.depth, rearZ: prof[b].z}};
  }
  throw new Error(rule);
}
