// Placement of the READ-ONLY quadruped master into runtime model space, from mesh landmarks only:
//   * the four paw contact patches (lowest vertices, split along the paw spread's principal axis
//     into front/hind and across it into left/right);
//   * head vs tail end: the end whose largest cross-section beyond the paw line is bigger (blunt
//     skull and ears) — the tail end only carries a thin tail;
//   * heading = hind-paw midpoint -> front-paw midpoint, rotated onto +Z (game model forward);
//     +Y up, +X = the creature's LEFT (same convention as the zombie rigs);
//   * paw-patch centre at the origin, lowest vertex at y = 0, uniform scale to a chosen top height.
// Every number used is reported in the returned object (written into the provenance JSON).

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];

/** Rotation about +Y by `ang` (radians), applied as x' = c*x + s*z, z' = -s*x + c*z. */
export function rotY(ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return {c, s, apply: (x, z) => [c * x + s * z, -s * x + c * z]};
}

/**
 * @param pos Float32Array master positions (any frame, +Y up assumed and checked: paws at min y)
 * @param opts {topHeight: metres from the floor to the highest point of the placed creature}
 */
export function quadrupedPlacement(pos, {topHeight}) {
  const n = pos.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const span = maxY - minY;
  // 1. paw contact patches: the lowest band of vertices, raised in 1 % steps until its XZ occupancy
  //    grid (cells 2.5 % of the height, 8-connected) holds exactly four sizeable components (a
  //    paw lifted mid-stride only appears once the band reaches it)
  const cell = 0.025 * span;
  let cent = null, lowFrac = 0;
  for (let f = 0.02; f <= 0.12 + 1e-9 && !cent; f += 0.01) {
    const cut = minY + f * span, cells = new Map();
    for (let i = 0; i < n; i++) {
      if (pos[i * 3 + 1] >= cut) continue;
      const key = Math.floor(pos[i * 3] / cell) + ',' + Math.floor(pos[i * 3 + 2] / cell);
      let c = cells.get(key);
      if (!c) cells.set(key, (c = {x: 0, z: 0, n: 0, comp: -1}));
      c.x += pos[i * 3]; c.z += pos[i * 3 + 2]; c.n++;
    }
    const comps = [];
    for (const [key, c] of cells) {
      if (c.comp >= 0) continue;
      const id = comps.length, acc = {x: 0, z: 0, n: 0};
      const stack = [key]; c.comp = id;
      while (stack.length) {
        const k = stack.pop(), q = cells.get(k);
        acc.x += q.x; acc.z += q.z; acc.n += q.n;
        const [cx, cz] = k.split(',').map(Number);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const nk = (cx + dx) + ',' + (cz + dz), nq = cells.get(nk);
          if (nq && nq.comp < 0) { nq.comp = id; stack.push(nk); }
        }
      }
      comps.push(acc);
    }
    const big = comps.filter(c => c.n >= 20);
    if (big.length === 4) { cent = big.map(c => [c.x / c.n, c.z / c.n, c.n]); lowFrac = +f.toFixed(2); }
  }
  if (!cent) throw new Error('placement: could not isolate four paw contact patches');
  // body axis = principal axis of the four cluster centres; front/hind pairs by projection on it
  let mx = 0, mz = 0;
  for (const c of cent) { mx += c[0] / 4; mz += c[1] / 4; }
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of cent) { const dx = x - mx, dz = z - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ax = [Math.cos(th), Math.sin(th)];
  const order = cent.map((c, k) => ({k, a: (c[0] - mx) * ax[0] + (c[1] - mz) * ax[1]})).sort((p, q) => p.a - q.a);
  const gap = order[2].a - order[1].a;
  const pawPairs = [[order[0], order[1]], [order[2], order[3]]].map(pair => pair.map(o => ({x: cent[o.k][0], z: cent[o.k][1], count: cent[o.k][2]})));
  const mid = pair => [(pair[0].x + pair[1].x) / 2, (pair[0].z + pair[1].z) / 2];
  const m0 = mid(pawPairs[0]), m1 = mid(pawPairs[1]);
  // 2. which end is the head: the largest cross-section area (occupied cells of a slice across the
  //    body axis) well beyond each paw line — a blunt skull is many times a tail's cross-section,
  //    and the margin (25 % of the paw spacing) keeps the haunches / chest out of the comparison
  const bodyAx = (() => { const d = sub2(m1, m0); const l = Math.hypot(d[0], d[1]); return [d[0] / l, d[1] / l]; })();
  const bodyPerp = [-bodyAx[1], bodyAx[0]];
  const a0 = m0[0] * bodyAx[0] + m0[1] * bodyAx[1], a1 = m1[0] * bodyAx[0] + m1[1] * bodyAx[1];
  const margin = 0.25 * Math.abs(a1 - a0);
  const sliceW = 0.03 * span, cellW = 0.025 * span;
  const slices = [new Map(), new Map()];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], z = pos[i * 3 + 2], y = pos[i * 3 + 1];
    if (y < minY + 0.2 * span) continue; // ignore paws / toes
    const a = x * bodyAx[0] + z * bodyAx[1], b = x * bodyPerp[0] + z * bodyPerp[1];
    const k = a < Math.min(a0, a1) - margin ? 0 : a > Math.max(a0, a1) + margin ? 1 : -1;
    if (k < 0) continue;
    const s = Math.floor(a / sliceW);
    let set = slices[k].get(s);
    if (!set) slices[k].set(s, (set = new Set()));
    set.add(Math.floor(b / cellW) * 4096 + Math.floor(y / cellW));
  }
  const width = slices.map(m => Math.max(0, ...[...m.values()].map(s => s.size)));
  const headEnd = (a1 > a0 ? width[1] >= width[0] : width[0] >= width[1]) ? 1 : 0;
  const front = headEnd === 1 ? m1 : m0, hind = headEnd === 1 ? m0 : m1;
  // 3. heading onto +Z
  const hd = sub2(front, hind);
  const ang = Math.atan2(hd[0], hd[1]); // rotate by -ang about Y: heading -> +Z
  const R = rotY(-ang);
  const centre = [(front[0] + hind[0]) / 2, (front[1] + hind[1]) / 2];
  const scale = topHeight / span;
  const place = (x, y, z) => { const [rx, rz] = R.apply(x - centre[0], z - centre[1]); return [rx * scale, (y - minY) * scale, rz * scale]; };
  const paws = {};
  pawPairs.forEach((pair, pi) => {
    for (const p of pair) {
      const [x, , z] = place(p.x, minY, p.z);
      const key = (pi === headEnd ? 'front' : 'hind') + (x > 0 ? 'L' : 'R');
      paws[key] = [+x.toFixed(4), 0, +z.toFixed(4)];
    }
  });
  if (Object.keys(paws).length !== 4) throw new Error('placement: paw quadrants not one each: ' + JSON.stringify(paws));
  return {
    scale, minY, centre, yawRad: -ang, headEndWidths: width, pawGap: gap, lowFrac,
    paws,
    apply(P) {
      const out = new Float32Array(P.length);
      for (let i = 0; i < P.length; i += 3) { const q = place(P[i], P[i + 1], P[i + 2]); out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2]; }
      return out;
    },
    applyNormals(N) {
      const out = new Float32Array(N.length);
      for (let i = 0; i < N.length; i += 3) { const [x, z] = R.apply(N[i], N[i + 2]); out[i] = x; out[i + 1] = N[i + 1]; out[i + 2] = z; }
      return out;
    },
    report() {
      return {method: 'paw contact patches (lowest band of vertices raised until its XZ occupancy grid has exactly four components; a paw lifted mid-stride appears later) split front/hind along the principal axis of the four centres and left/right across it; head end = larger max cross-section (occupied cells of slices across the body axis, beyond 25% of the paw spacing past each paw pair); heading hind->front paw midpoints rotated onto +Z; paw-patch centre at the origin; lowest vertex y=0; uniform scale',
        topHeightM: topHeight, scale: +scale.toFixed(6), yawDeg: +(-ang * 180 / Math.PI).toFixed(3), masterCentreXZ: centre.map(v => +v.toFixed(5)), masterMinY: +minY.toFixed(5),
        pawBandFractionOfHeight: lowFrac, masterHeightUnits: +span.toFixed(5), maxCrossSectionCellsPerEnd: width, pawsPlaced: paws};
    },
  };
}
