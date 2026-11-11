// Task studio-screacher-production-20261110-221858-01 (lane RIG): landmark -> joint estimation for the four SCREACHER bodies
// (headless lanky humanoids, variants sc01..sc04) on the SHARED 18-joint skeleton (zombie/lib/skeleton.mjs JOINTS: same
// names / hierarchy). Returns the structure of zombie/lib/skeleton.mjs detectSkeleton (joints, ends, cut, wall, heelZ,
// crotchY, hipY, ..., log) so zombie/lib/pose.mjs Rig consumes it unchanged, plus what lib/screacher-skin.mjs needs: the
// stump and the per-vertex arm / leg labels found by mesh topology.
//
// Why not detectSkeleton itself: it is tuned for upright A-pose humans WITH A NECK AND A HEAD (narrowest slice above the
// shoulders, head pivot at 40 % neck base -> top) and for arms that stand clear of the torso as separate 2 cm slice clusters.
// A Screacher has no head (a short neck stump is the top of the mesh) and its long arms hang in the RELAXED pose as
// generated, the sleeves touching the flanks and the hands beside the thighs. Every joint is therefore measured on the
// body's own WELDED MESH with explicit, logged rules:
//   sections: per 1 cm height the mesh-connected cross-section loops (triangles crossing the plane, joined through shared
//        vertices): a sleeve / arm tube that merely touches the jacket is still its own loop (point-cloud clusters merge);
//   feet / ankles: the generic rule (foot depth > 1.3 x shin depth below the ankle);
//   crotch: the lowest height with a cross-section loop spanning both legs; hip height = the family fraction of the height
//        clamped to the crotch; knee height = the family long-shin fraction of the height (visible on the bare knees of SC04
//        and through the torn knees of SC02; trousers hide the others), centred in the leg section;
//   arms (per side, never mirrored into each other before the symmetry test): the arm loops are tracked from the clearest
//        mid-arm section up into the sleeve; cloth armpit = where the body loop swallows the arm; below it the arm is the
//        mesh piece flooded from that section (every finger / thumb belongs to it exactly); wrist = the first thin section
//        above the hand; shoulder = the upper-arm centreline extended up to a fixed inset under the shoulder top surface;
//        elbow = where the upper-arm and forearm centrelines meet when the arm is visibly bent, else a fixed fraction of
//        shoulder -> wrist, centred in the arm section;
//   stump: the neck column under the topmost loop; `Neck` = its base between the shoulders (where the column widens into
//        the shoulder line, at least `minStump` below the top), `Head` = a TECHNICAL joint just under the top of the stump
//        (no head geometry exists); stump.top = the centre of the stump's top;
//   spine: mid-sagittal band depth per height, joint at `frac` of the depth from the back.
// Legs are symmetrised (pose.mjs Rig uses one leg length); arm joints are symmetrised only when the two measured sides
// already agree within `symTol` (a lopsided body keeps its two different arms: per-side joints).
import {fitLine} from '../../zombie/lib/slices.mjs';

export const SKELETON_OPTIONS = {
  step: 0.01,
  loop: {minTris: 4, minPerimeter: 0.03},
  hip: {heightFrac: 0.58, aboveCrotch: [0.03, 0.16], xFactor: 0.8},
  knee: {heightFrac: 0.395},
  arm: {trackTol: 0.05, minPerimeter: 0.08, wristWindow: [0.14, 0.36], wristSlack: 1.12, shoulderInset: 0.055, innerTopInset: 0.045, elbowFrac: 0.54, bend: {minAngleDeg: 10, frac: [0.38, 0.64]}, symTol: 0.03, tipBand: 0.04},
  stump: {refBelowTop: 0.02, widen: 0.15, narrow: 0.06, minStump: 0.09, headBelowTop: 0.012, rim: 0.02},
  spine: {midBand: 0.05, frac: 0.45},
};

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[s.length >> 1]; };

/**
 * Mesh-connected cross-section loops of the welded mesh at height y: the triangles crossing the plane, grouped through
 * shared vertices; per group the bbox of the plane intersection points, its centre and the summed segment length.
 */
export function sectionLoops(mesh, tris, y, O = SKELETON_OPTIONS.loop) {
  const P = mesh.pos, I = mesh.idx;
  const par = new Map();
  const find = x => { let r = x; while (par.get(r) !== r) r = par.get(r); while (par.get(x) !== r) { const n = par.get(x); par.set(x, r); x = n; } return r; };
  for (const t of tris) for (let k = 0; k < 3; k++) { const v = I[t + k]; if (!par.has(v)) par.set(v, v); }
  for (const t of tris) { const a = find(I[t]); par.set(find(I[t + 1]), a); par.set(find(I[t + 2]), a); }
  const groups = new Map();
  for (const t of tris) {
    const r = find(I[t]);
    let g = groups.get(r);
    if (!g) groups.set(r, g = {n: 0, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, per: 0, ts: []});
    g.ts.push(t);
    // plane intersection segment of the triangle
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = I[t + k] * 3, b = I[t + (k + 1) % 3] * 3, ya = P[a + 1] - y, yb = P[b + 1] - y;
      if ((ya <= 0 && yb > 0) || (ya > 0 && yb <= 0)) { const u = ya / (ya - yb); pts.push([P[a] + (P[b] - P[a]) * u, P[a + 2] + (P[b + 2] - P[a + 2]) * u]); }
    }
    if (pts.length < 2) continue;
    g.n++;
    g.per += Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    for (const q of pts) { if (q[0] < g.x0) g.x0 = q[0]; if (q[0] > g.x1) g.x1 = q[0]; if (q[1] < g.z0) g.z0 = q[1]; if (q[1] > g.z1) g.z1 = q[1]; }
  }
  const out = [];
  for (const g of groups.values()) { if (g.n < O.minTris || g.per < O.minPerimeter) continue; out.push({...g, y, cx: (g.x0 + g.x1) / 2, cz: (g.z0 + g.z1) / 2, wx: g.x1 - g.x0, wz: g.z1 - g.z0}); }
  return out.sort((a, b) => a.cx - b.cx);
}

/** Union bbox of loops. */
function union(loops, y) {
  const u = {y, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, per: 0, n: 0, loops: loops.length};
  for (const l of loops) { u.x0 = Math.min(u.x0, l.x0); u.x1 = Math.max(u.x1, l.x1); u.z0 = Math.min(u.z0, l.z0); u.z1 = Math.max(u.z1, l.z1); u.per = Math.max(u.per, l.per); u.n += l.n; }
  u.cx = (u.x0 + u.x1) / 2; u.cz = (u.z0 + u.z1) / 2; u.wx = u.x1 - u.x0; u.wz = u.z1 - u.z0; u.size = Math.sqrt(Math.max(1e-6, u.wx * u.wz));
  return u;
}

/** @param mesh welded, placed body mesh {pos, idx} in game space (+Z facing, feet at y = 0, metres). */
export function detectScreacherSkeleton(mesh, O = SKELETON_OPTIONS) {
  const log = {};
  const P = mesh.pos, I = mesh.idx, n = P.length / 3, step = O.step;
  let H = 0; for (let i = 0; i < n; i++) H = Math.max(H, P[i * 3 + 1]);
  const nS = Math.ceil(H / step);
  // triangles per slice
  const perSlice = Array.from({length: nS}, () => []); // (slice k is the plane y = (k + 0.5) x step)
  for (let t = 0; t < I.length; t += 3) {
    const ya = P[I[t] * 3 + 1], yb = P[I[t + 1] * 3 + 1], yc = P[I[t + 2] * 3 + 1];
    const lo = Math.min(ya, yb, yc), hi = Math.max(ya, yb, yc);
    for (let k = Math.max(0, Math.ceil((lo - step / 2) / step - 1e-9)); k < nS; k++) { const y = (k + 0.5) * step; if (y > hi) break; if (y >= lo) perSlice[k].push(t); }
  }
  const slices = perSlice.map((tris, k) => ({y: (k + 0.5) * step, loops: sectionLoops(mesh, tris, (k + 0.5) * step, O.loop)}));
  const kOf = y => Math.max(0, Math.min(nS - 1, Math.floor(y / step)));
  const isCentral = l => l.x0 <= 0.02 && l.x1 >= -0.02;
  const sideOf = l => l.cx >= 0 ? 'L' : 'R';

  // ---------------------------------------------------------------- arms: the arm loops per side
  // vertex adjacency (CSR) for the arm flood
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) deg[I[t + k] + 1] += 2;
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const adj = new Uint32Array(deg[n]), fill = Uint32Array.from(deg.subarray(0, n));
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k]; adj[fill[a]++] = I[t + (k + 1) % 3]; adj[fill[a]++] = I[t + (k + 2) % 3]; }
  const armRun = {};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    // seed: the outermost non-central loop of the side with the largest clear gap to the next loop inside it
    let seed = null;
    for (const s of slices) {
      if (s.y < 0.3 * H || s.y > 0.92 * H) continue;
      const mine = s.loops.filter(l => !isCentral(l) && sideOf(l) === side && l.per >= O.arm.minPerimeter).sort((a, b) => sg * b.cx - sg * a.cx);
      if (!mine.length) continue;
      const outer = mine[0], inner = s.loops.filter(l => l !== outer && (isCentral(l) || sideOf(l) === side) && l.per >= O.arm.minPerimeter && sg * l.cx < sg * outer.cx);
      if (!inner.length) continue;
      const innerEdge = Math.max(...inner.map(l => sg > 0 ? l.x1 : -l.x0)), outerEdge = sg > 0 ? outer.x0 : -outer.x1;
      const gap = outerEdge - innerEdge;
      if (gap > 0.01 && (!seed || gap > seed.gap)) seed = {gap, y: s.y, k: kOf(s.y), loop: outer};
    }
    if (!seed) throw new Error('screacher skeleton: no clear arm section ' + side);
    // (1) proximity track up from the seed (sleeve tube + the arm inside it are separate loops at the same place)
    const near = (l, prev) => !isCentral(l) && sideOf(l) === side && (Math.hypot(l.cx - prev.cx, l.cz - prev.cz) < O.arm.trackTol
      || (l.cx > prev.x0 - 0.015 && l.cx < prev.x1 + 0.015 && l.cz > prev.z0 - 0.015 && l.cz < prev.z1 + 0.015));
    const members = new Array(nS).fill(null);
    const track = (k0, dir) => {
      let prev = union([seed.loop], seed.y);
      for (let k = k0; k >= 0 && k < nS; k += dir) {
        const cand = slices[k].loops.filter(l => near(l, prev));
        if (!cand.length) break;
        prev = union(cand, slices[k].y);
        members[k] = cand;
      }
    };
    track(seed.k, 1); track(seed.k - 1, -1);
    // cloth armpit: going up from the seed, the first slice whose body (central) loop reaches out over the tracked arm
    let kTopRun = seed.k; while (kTopRun + 1 < nS && members[kTopRun + 1]) kTopRun++;
    let kPit = kTopRun + 1;
    for (let k = seed.k; k <= kTopRun; k++) {
      const c = slices[k].loops.filter(isCentral), u = union(members[k], slices[k].y);
      const reach = c.length ? Math.max(...c.map(l => sg > 0 ? l.x1 : -l.x0)) : 0;
      if (reach > sg * u.cx - 0.01) { kPit = k; break; }
    }
    // (2) below the cloth armpit the arm is a mesh piece of its own: flood from the seed loop over vertices under the armpit
    //     height -> every finger / thumb loop belongs to the arm exactly (no distance guess beside the thigh)
    //     (the ceiling starts 2 cm under the armpit and is lowered until the flood no longer reaches the body: bare arms
    //     join the flank in a skin fold between two slices)
    let inArm = null, count = 0, kCeil = kPit - 2, lowered = 0;
    for (;; kCeil--, lowered++) {
      if (lowered > 10 || kCeil <= seed.k) throw new Error(`screacher skeleton: the ${side} arm is fused to the body below its cloth armpit (flood reached the midline)`);
      const yCeil = slices[kCeil].y + step / 2;
      inArm = new Uint8Array(n); count = 0;
      const stack = [];
      for (const t of seed.loop.ts) for (let k = 0; k < 3; k++) { const v = I[t + k]; if (!inArm[v] && P[v * 3 + 1] < yCeil) { inArm[v] = 1; stack.push(v); } }
      let leak = false;
      while (stack.length && !leak) {
        const v = stack.pop(); count++;
        if (sg * P[v * 3] < 0.03) leak = true;
        for (let e = deg[v]; e < deg[v + 1]; e++) { const u = adj[e]; if (!inArm[u] && P[u * 3 + 1] < yCeil) { inArm[u] = 1; stack.push(u); } }
      }
      if (!leak) break;
    }
    const sections = new Array(nS).fill(null);
    for (let k = 0; k < nS; k++) {
      const flood = k <= kCeil ? slices[k].loops.filter(l => !isCentral(l) && l.ts.some(t => inArm[I[t]] || inArm[I[t + 1]] || inArm[I[t + 2]])) : [];
      const all = [...new Set([...(members[k] || []), ...flood])];
      if (!all.length) continue;
      members[k] = all;
      sections[k] = union(all, slices[k].y);
    }
    // keep one contiguous run through the seed
    let kLo = seed.k, kHi = seed.k;
    while (kLo > 0 && sections[kLo - 1]) kLo--;
    while (kHi + 1 < nS && sections[kHi + 1]) kHi++;
    for (let k = 0; k < nS; k++) if (k < kLo || k > kHi) { sections[k] = null; members[k] = null; }
    armRun[side] = {sg, sections, members, kLo, kHi, kPit, inArm, floodVertices: count, floodCeilingY: slices[kCeil].y + step / 2, seed: {y: seed.y, gap: seed.gap}};
  }

  // ---------------------------------------------------------------- body loops (everything that is not an arm loop)
  const bodyLoops = k => slices[k].loops.filter(l => !(armRun.L.members[k]?.includes(l) || armRun.R.members[k]?.includes(l)));
  const legSection = (y, side) => {
    const sg = side === 'L' ? 1 : -1, k = kOf(y);
    const ls = bodyLoops(k).filter(l => l.per >= 0.06);
    const own = ls.filter(l => !isCentral(l) && sideOf(l) === side);
    if (own.length) return union(own, slices[k].y);
    // above the crotch (or touching trouser legs): the central loops clipped at x = 0
    const c = ls.filter(isCentral);
    if (!c.length) return null;
    const u = union(c, slices[k].y);
    return sg > 0 ? {...u, x0: 0, cx: u.x1 / 2, wx: u.x1} : {...u, x1: 0, cx: u.x0 / 2, wx: -u.x0};
  };

  // ---------------------------------------------------------------- feet & ankles (generic rule on the leg sections)
  const foot = {};
  for (const side of ['L', 'R']) {
    const f = {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minY: Infinity};
    for (let i = 0; i < n; i++) { if (P[i * 3 + 1] >= 0.04 || (side === 'L') !== (P[i * 3] > 0)) continue; f.minX = Math.min(f.minX, P[i * 3]); f.maxX = Math.max(f.maxX, P[i * 3]); f.minZ = Math.min(f.minZ, P[i * 3 + 2]); f.maxZ = Math.max(f.maxZ, P[i * 3 + 2]); f.minY = Math.min(f.minY, P[i * 3 + 1]); }
    foot[side] = {...f, bx: (f.minX + f.maxX) / 2, bz: (f.minZ + f.maxZ) / 2};
  }
  const ext = (y, side) => { const c = legSection(y, side); return c ? c.wz : NaN; };
  const shinDepth = median([0.15, 0.17, 0.19, 0.21, 0.23].map(y => (ext(y, 'L') + ext(y, 'R')) / 2));
  let ankleTransition = 0.12;
  for (let y = 0.03; y < 0.25; y += step) if ((ext(y, 'L') + ext(y, 'R')) / 2 < 1.3 * shinDepth) { ankleTransition = y; break; }
  const ankleY = Math.min(0.13, Math.max(0.07, ankleTransition - 0.015));
  log.feet = {L: r4([foot.L.bx, foot.L.minY, foot.L.bz]), R: r4([foot.R.bx, foot.R.minY, foot.R.bz]), toeZ: r4(Math.max(foot.L.maxZ, foot.R.maxZ)), heelZ: r4(Math.min(foot.L.minZ, foot.R.minZ)), shinDepth: r4(shinDepth), ankleTransitionY: r4(ankleTransition), ankleY: r4(ankleY),
    method: 'generic (zombie/lib/skeleton.mjs) on the mesh cross-sections: foot depth widens > 1.3x shin depth below the ankle; joint 1.5 cm under the transition, clamped 0.07..0.13 m'};

  // ---------------------------------------------------------------- crotch, hips, knees
  let crotchY = null;
  for (let k = kOf(0.3); k < kOf(0.7 * H); k++) {
    const span = l => l.x0 < -0.03 && l.x1 > 0.03 && l.per > 0.3;
    if (bodyLoops(k).some(span) && bodyLoops(k + 1).some(span) && bodyLoops(k + 2).some(span)) { crotchY = slices[k].y - step / 2; break; }
  }
  if (crotchY == null) throw new Error('screacher skeleton: crotch not found');
  const hipY = Math.min(crotchY + O.hip.aboveCrotch[1], Math.max(crotchY + O.hip.aboveCrotch[0], O.hip.heightFrac * H));
  const legs = {}, legLog = {};
  for (const side of ['L', 'R']) {
    const sh = legSection(ankleY + 0.04, side);
    const ankle = [sh.cx, ankleY, sh.cz];
    const kneeY = O.knee.heightFrac * H;
    const kc = legSection(kneeY, side);
    const knee = [kc.cx, kneeY, kc.cz];
    const th = legSection(crotchY - 0.04, side);
    // hip z: the thigh section centreline (crotch - 0.22 .. crotch - 0.04) extrapolated to the hip height
    const pts = [];
    for (let y = crotchY - 0.22; y <= crotchY - 0.04; y += step) { const c = legSection(y, side); if (c) pts.push([c.cx, y, c.cz]); }
    const tl = fitLine(pts);
    const hipC = add(tl.center, mul(tl.dir, (hipY - tl.center[1]) / tl.dir[1]));
    const hip = [O.hip.xFactor * th.cx, hipY, hipC[2]];
    const f = foot[side];
    legs[side] = {hip, knee, ankle, toe: [f.bx, 0.03, f.maxZ - 0.02]};
    legLog[side] = {kneeSection: r4([kc.x0, kc.x1, kc.z0, kc.z1]), thighLineAtHip: r4(hipC), thighCentreX: r4(th.cx)};
  }
  log.legs = {crotchY: r4(crotchY), hipY: r4(hipY), ...legLog,
    method: `crotch = lowest height where a cross-section loop spans both legs (3 consecutive slices); hip height = ${O.hip.heightFrac} H (family proportion) clamped to crotch + [${O.hip.aboveCrotch.join(', ')}] m; hip x = ${O.hip.xFactor} x thigh section centre 4 cm below the crotch (generic), hip z = thigh centreline (crotch - 0.22 .. - 0.04 m) extrapolated to the hip height; knee height = ${O.knee.heightFrac} H (the family's long-shin proportion, measured on the bare knees of SC04 and through the torn knees of SC02; trousers hide the knees of the others), centred in the leg section; ankle centred in the shin section`};

  // ---------------------------------------------------------------- top surface (for the shoulder inset)
  // highest intersection of the vertical line through (x, z) with the mesh; median over a small 5-point stencil
  const topAt = (x, z) => {
    let top = -Infinity;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * P[a + 1] + v * P[b + 1] + w * P[c + 1];
      if (y > top) top = y;
    }
    return top;
  };
  const topOver = (x, z) => median([[0, 0], [0.01, 0], [-0.01, 0], [0, 0.02], [0, -0.02]].map(([dx, dz]) => topAt(x + dx, z + dz)));

  // ---------------------------------------------------------------- arms: wrist, shoulder, elbow, hand tip
  const arms = {}, cut = {};
  for (const side of ['L', 'R']) {
    const R = armRun[side], sg = R.sg, S = R.sections;
    const secAt = y => { let k = kOf(y); k = Math.max(R.kLo, Math.min(R.kHi, k)); for (let d = 0; d < 12; d++) { if (S[k - d]) return S[k - d]; if (S[k + d]) return S[k + d]; } return null; };
    const armpitY = slices[Math.min(nS - 1, R.kPit)].y - step / 2, tipY0 = slices[R.kLo].y - step / 2, runTopY = slices[R.kHi].y + step / 2;
    // hand tip: the centre of the finger-tip sections (lowest `tipBand`), at the height of the lowest vertex under them
    const lowS = []; for (let k = R.kLo; k <= R.kHi && slices[k].y < tipY0 + O.arm.tipBand; k++) if (S[k]) lowS.push(S[k]);
    const low = union(lowS, tipY0);
    let tipY = Infinity;
    for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (y > tipY0 + 0.03 || x < low.x0 - 0.02 || x > low.x1 + 0.02 || z < low.z0 - 0.02 || z > low.z1 + 0.02) continue; if (y < tipY) tipY = y; }
    const tip = [low.cx, tipY, low.cz];
    // wrist: the first thin section above the hand
    let minSize = Infinity; const win = [];
    for (let k = R.kLo; k <= R.kHi; k++) { const s = S[k]; if (!s) continue; const d = s.y - tip[1]; if (d < O.arm.wristWindow[0] || d > O.arm.wristWindow[1]) continue; win.push(s); minSize = Math.min(minSize, s.size); }
    const wristS = win.find(s => s.size <= O.arm.wristSlack * minSize);
    const wrist = [wristS.cx, wristS.y, wristS.cz];
    // shoulder + elbow, solved together: line A = the upper-arm centreline (sections above the elbow), line B = the forearm
    // centreline (wrist .. below the elbow); shoulder = A at the inset under the shoulder top; elbow = where A and B meet
    const band = (y0, y1) => { const pts = []; for (let k = R.kLo; k <= R.kHi; k++) { const s = S[k]; if (s && s.y >= y0 && s.y <= y1) pts.push([s.cx, s.y, s.cz]); } return pts; };
    const lineDown = pts => { const l = fitLine(pts); if (l.dir[1] > 0) l.dir = mul(l.dir, -1); return l; };
    const upperTop = Math.min(runTopY - 0.03, armpitY + 0.12);
    let shoulder = null, elbow = null, upper = null, fore = null, elbowHow = null, topY = null, yJ = null, angle = 0, frac = 0;
    let eY = wrist[1] + 0.5 * (armpitY + 0.12 - wrist[1]);
    for (let pass = 0; pass < 6; pass++) {
      let pu = band(eY + 0.04, upperTop);
      if (pu.length < 4) pu = band(upperTop - 0.08, upperTop + 0.03);
      upper = lineDown(pu);
      const onLine = y => add(upper.center, mul(upper.dir, (y - upper.center[1]) / upper.dir[1]));
      yJ = armpitY + 0.1;
      for (let it = 0; it < 6; it++) {
        const q = onLine(yJ);
        topY = topOver(q[0], q[2]);
        let yN = topY - O.arm.shoulderInset;
        if (runTopY > armpitY + 0.08) yN = Math.min(yN, runTopY - O.arm.innerTopInset); // a separate inner arm: its own top bounds the joint
        if (Math.abs(yN - yJ) < 5e-4) { yJ = yN; break; }
        yJ = yN;
      }
      shoulder = onLine(yJ);
      const pf = band(wrist[1] + 0.01, eY - 0.04);
      fore = pf.length >= 4 ? lineDown(pf) : null;
      const chord = sub(wrist, shoulder), cl = len(chord), cu = mul(chord, 1 / cl);
      let cand = null;
      if (fore) {
        // closest points of the two lines
        const d1 = upper.dir, d2 = fore.dir, r = sub(upper.center, fore.center), b = dot(d1, d2), c = dot(d1, r), f = dot(d2, r), den = 1 - b * b;
        angle = Math.acos(Math.max(-1, Math.min(1, b))) * 180 / Math.PI;
        if (den > 1e-6) { const t1 = (b * f - c) / den, t2 = (f - b * c) / den; cand = mul(add(add(upper.center, mul(d1, t1)), add(fore.center, mul(d2, t2))), 0.5); }
      }
      frac = cand ? dot(sub(cand, shoulder), cu) / cl : 0;
      if (cand && angle >= O.arm.bend.minAngleDeg && frac >= O.arm.bend.frac[0] && frac <= O.arm.bend.frac[1]) { elbow = cand; elbowHow = 'bend'; }
      else {
        const g = add(shoulder, mul(chord, O.arm.elbowFrac));
        const s = secAt(g[1]);
        elbow = s && Math.abs(s.y - g[1]) < 0.03 ? [s.cx, g[1], s.cz] : g;
        elbowHow = 'fraction';
      }
      if (Math.abs(elbow[1] - eY) < 2e-3) break;
      eY = elbow[1];
    }
    const pitK = Math.max(0, R.kPit - 2);
    const wallLoops = bodyLoops(pitK);
    const wallX = Math.max(...wallLoops.map(l => sg > 0 ? l.x1 : -l.x0));
    const armpitPt = [sg * wallX, armpitY, shoulder[2]];
    const acromionPt = [shoulder[0] + sg * 0.02, topY, shoulder[2]];
    arms[side] = {armpitY, shoulder, elbow, wrist, handTip: tip, dir: upper.dir, armpitPt, acromionPt, wristSize: wristS.size};
    log['arm_' + side] = {seed: r4([R.seed.y, R.seed.gap]), floodVertices: R.floodVertices, floodCeilingY: r4(R.floodCeilingY), trackedY: r4([tipY0, runTopY]), clothArmpitY: r4(armpitY), handTip: r4(tip), wristWindowMinSize: r4(minSize), wristSection: r4([wristS.y, wristS.size]),
      upperArmDir: r4(upper.dir), upperArmDegFromVertical: r4(Math.acos(Math.min(1, -upper.dir[1])) * 180 / Math.PI), forearmDir: fore ? r4(fore.dir) : null, shoulderTopSurfaceY: r4(topY), elbowRule: elbowHow, elbowAngleDeg: r4(angle), elbowChordFrac: r4(frac),
      sections: S.map(s => s && [r4(s.y), r4(s.cx), r4(s.cz), r4(s.wx), r4(s.wz), s.loops]).filter(Boolean).filter((_, i) => i % 3 === 0)};
  }
  log.arms = {method: `per side: the arm cross-section loops (mesh-connected, not spanning the midline) tracked from the clearest mid-arm section (largest gap to the body) up while a separate loop exists (track tolerance ${O.arm.trackTol} m: a sleeve tube and the arm inside it are separate loops at the same place); cloth armpit = first height where the body loop reaches over the tracked arm centre; below it the arm is the mesh piece flooded from the seed loop under the armpit height (every finger / thumb loop belongs to it exactly; the build stops if that flood reaches the midline); hand tip = lowest vertex under the lowest sections; wrist = the lowest section ${O.arm.wristWindow.join('..')} m above the tip within ${O.arm.wristSlack} x the thinnest there (section size = sqrt(width x depth)); shoulder = the upper-arm centreline (line fit of the section centres from 4 cm above the elbow up) at ${O.arm.shoulderInset} m under the shoulder top surface (and at most ${O.arm.innerTopInset} m under the top of a separate inner arm); elbow = where the upper-arm line and the forearm line (section centres wrist .. 4 cm under the elbow) meet (midpoint of their closest points) when they make >= ${O.arm.bend.minAngleDeg} deg and meet at ${O.arm.bend.frac.join('..')} of the shoulder -> wrist chord, else at ${O.arm.elbowFrac} of the chord centred in the arm section (solved together, iterated); acromion = top surface 2 cm lateral of the joint`};

  // ---------------------------------------------------------------- stump (neck column under the topmost loop)
  const kTop = (() => { for (let k = nS - 1; k >= 0; k--) if (slices[k].loops.length) return k; return nS - 1; })();
  const rim = {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, n: 0};
  for (let i = 0; i < n; i++) { if (P[i * 3 + 1] < H - O.stump.rim) continue; rim.x0 = Math.min(rim.x0, P[i * 3]); rim.x1 = Math.max(rim.x1, P[i * 3]); rim.z0 = Math.min(rim.z0, P[i * 3 + 2]); rim.z1 = Math.max(rim.z1, P[i * 3 + 2]); rim.n++; }
  const stumpTop = [(rim.x0 + rim.x1) / 2, H - O.stump.rim / 2, (rim.z0 + rim.z1) / 2];
  // the column: per slice the widest loop that contains the column axis; the axis follows the narrowest containing loop
  let axis = [stumpTop[0], stumpTop[2]];
  const column = [];
  for (let k = kTop; k >= kOf(H - 0.3); k--) {
    const cont = slices[k].loops.filter(l => axis[0] > l.x0 - 0.01 && axis[0] < l.x1 + 0.01 && axis[1] > l.z0 - 0.01 && axis[1] < l.z1 + 0.01);
    if (!cont.length) continue;
    const outer = cont.reduce((a, b) => (b.wx > a.wx ? b : a)), inner = cont.filter(l => l.wx >= 0.06).reduce((a, b) => (!a || b.wx < a.wx ? b : a), null) || outer;
    column.push({y: slices[k].y, w: outer.wx, inner: [inner.cx, inner.cz, inner.wx]});
    if (inner.wx < 0.2) axis = [inner.cx, inner.cz];
  }
  const ref = column.find(c => c.y <= H - O.stump.refBelowTop) || column[0];
  const wRef = Math.max(0.08, ref.w);
  const baseRow = column.find(c => c.y < ref.y && c.w > wRef + O.stump.widen);
  const stumpBaseY = baseRow ? baseRow.y + step / 2 : H - O.stump.minStump;
  const neckBaseY = Math.min(stumpBaseY, H - O.stump.minStump);
  // the Neck is centred in the neck column: the lowest row at / above the neck base whose innermost loop is still the narrow column
  const narrow = column.filter(c => c.y >= neckBaseY - step && c.inner[2] <= wRef + O.stump.narrow);
  const neckRow = narrow.length ? narrow.reduce((a, c) => (c.y < a.y ? c : a)) : ref;
  const headY = H - O.stump.headBelowTop;
  const headRow = column.reduce((a, c) => (Math.abs(c.y - headY) < Math.abs(a.y - headY) ? c : a));
  const stumpHalfWidth = wRef / 2;

  // ---------------------------------------------------------------- spine (mid-sagittal band)
  // depth of the body in the mid-sagittal band at height y, from the mesh cross-section segments (not from sparse vertices)
  const midSection = y => {
    let z0 = Infinity, z1 = -Infinity; const B = O.spine.midBand, k0 = kOf(y);
    y = (k0 + 0.5) * step; // the slice plane
    for (const t of perSlice[k0]) {
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const a = I[t + k] * 3, b = I[t + (k + 1) % 3] * 3, ya = P[a + 1] - y, yb = P[b + 1] - y;
        if ((ya <= 0 && yb > 0) || (ya > 0 && yb <= 0)) { const u = ya / (ya - yb); pts.push([P[a] + (P[b] - P[a]) * u, P[a + 2] + (P[b + 2] - P[a + 2]) * u]); }
      }
      if (pts.length < 2) continue;
      let [p, q] = pts;
      if (p[0] > q[0]) [p, q] = [q, p];
      if (q[0] < -B || p[0] > B) continue;
      const zAt = x => (q[0] - p[0] < 1e-9 ? p[1] : p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]));
      for (const z of [zAt(Math.max(p[0], -B)), zAt(Math.min(q[0], B))]) { if (z < z0) z0 = z; if (z > z1) z1 = z; }
    }
    return {back: z0, front: z1};
  };
  const midZ = y => { const s = midSection(y); return s.back + O.spine.frac * (s.front - s.back); };
  const thighZ = (legs.L.hip[2] + legs.R.hip[2]) / 2;
  const spineY = hipY + 0.30 * (neckBaseY - hipY), chestY = hipY + 0.66 * (neckBaseY - hipY);
  const J = {
    Root: [0, 0, 0],
    Hips: [0, hipY, thighZ],
    Spine: [0, spineY, midZ(spineY)],
    Chest: [0, chestY, midZ(chestY)],
    Neck: [neckRow.inner[0], neckBaseY, neckRow.inner[1]],
    Head: [headRow.inner[0], headY, headRow.inner[1]],
  };
  log.stump = {top: r4(stumpTop), rimVertices: rim.n, refWidth: r4(wRef), stumpBaseY: r4(stumpBaseY), neckBaseY: r4(neckBaseY), headY: r4(headY), column: column.filter((_, i) => i % 2 === 0).slice(0, 12).map(c => [r4(c.y), r4(c.w), ...r4(c.inner)]),
    method: `no head: the topmost mesh loop is the top of the neck stump; stump.top = bbox centre (x, z) of the vertices in the top ${O.stump.rim} m, y = the middle of that rim; the column = per 1 cm slice the loops containing the stump axis (the axis follows the narrowest containing loop); stump base = highest slice whose widest containing loop is more than ${O.stump.widen} m wider than the stump ${O.stump.refBelowTop} m under the top (the shoulder line); Neck = min(stump base, top - ${O.stump.minStump} m), centred in the neck column (the lowest slice at / above it whose innermost containing loop is at most ${O.stump.narrow} m wider than the stump); Head = TECHNICAL joint ${O.stump.headBelowTop} m under the top, centred in the stump (no head geometry)`};
  log.spine = {method: `spine joints at 30 / 66 % hip -> neck base (generic heights), x = 0; z at ${O.spine.frac} of the mid-sagittal depth (|x| < ${O.spine.midBand} m)`, midSections: [spineY, chestY].map(y => { const s = midSection(y); return r4([y, s.back, s.front]); })};

  // ---------------------------------------------------------------- paired joints
  log.rawPaired = {};
  const sym = (obj, keys) => { for (const k of keys) { const a = obj.L[k], b = obj.R[k]; const x = (a[0] - b[0]) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2; obj.L[k] = [x, y, z]; obj.R[k] = [-x, y, z]; } };
  for (const [k, obj] of [['shoulder', arms], ['elbow', arms], ['wrist', arms], ['handTip', arms], ['armpitPt', arms], ['acromionPt', arms], ['hip', legs], ['knee', legs], ['ankle', legs], ['toe', legs]]) log.rawPaired[k] = {L: r4(obj.L[k]), R: r4(obj.R[k])};
  sym(legs, ['hip', 'knee', 'ankle', 'toe']);
  const mirrorGap = Math.max(...['shoulder', 'elbow', 'wrist', 'handTip'].map(k => len(sub(arms.L[k], [-arms.R[k][0], arms.R[k][1], arms.R[k][2]]))));
  const armsSymmetric = mirrorGap <= O.arm.symTol;
  if (armsSymmetric) sym(arms, ['shoulder', 'elbow', 'wrist', 'handTip', 'armpitPt', 'acromionPt']);
  log.symmetry = {legs: 'symmetrised (paired average; one leg length in the pose rig)', armMirrorGapM: r4(mirrorGap), arms: armsSymmetric ? `symmetrised (the two measured sides agree within ${O.arm.symTol} m)` : `per-side joints kept (the measured sides differ by more than ${O.arm.symTol} m: a lopsided body is not symmetrised)`};
  Object.assign(J, {
    L_UpperArm: arms.L.shoulder, L_Forearm: arms.L.elbow, L_Hand: arms.L.wrist, R_UpperArm: arms.R.shoulder, R_Forearm: arms.R.elbow, R_Hand: arms.R.wrist,
    L_Thigh: legs.L.hip, L_Shin: legs.L.knee, L_Foot: legs.L.ankle, R_Thigh: legs.R.hip, R_Shin: legs.R.knee, R_Foot: legs.R.ankle,
  });
  for (const k in J) J[k] = r4(J[k]);
  const ends = {Head: r4([stumpTop[0], H, stumpTop[2]]), L_Hand: r4(arms.L.handTip), R_Hand: r4(arms.R.handTip), L_Foot: r4(legs.L.toe), R_Foot: r4(legs.R.toe)};
  for (const s of ['L', 'R']) cut[s] = {A: r4(arms[s].armpitPt), T: r4(arms[s].acromionPt)};
  log.shoulderCutPlanes = {...cut, method: 'plane through the cloth-armpit wall point A and the acromion T, containing the front-back axis (zombie/lib/skin.mjs)'};

  // torso wall: per height the outer |x| of everything that is NOT a tracked arm loop (flank, hip, thigh), from below the
  // lower hand tip up past the armpits; keeps the arm flood of zombie/lib/skin.mjs out of the flanks / thighs beside the hands
  const armpitY = Math.min(arms.L.armpitY, arms.R.armpitY);
  const wallY0 = Math.max(0.05, Math.min(arms.L.handTip[1], arms.R.handTip[1]) - 0.1);
  const wall = {y0: r4(wallY0), step, L: [], R: []};
  for (let y = wallY0; y <= Math.max(arms.L.armpitY, arms.R.armpitY) + 0.05; y += step) {
    // above the crotch the body is the loops spanning the midline; below it the leg loops (never an arm / finger loop)
    const ls = bodyLoops(kOf(y)).filter(l => isCentral(l) || y < crotchY + 0.02);
    wall.L.push(r4(Math.max(0, ...ls.map(l => l.x1)))); wall.R.push(r4(Math.max(0, ...ls.map(l => -l.x0))));
  }
  // ---------------------------------------------------------------- vertex labels by TOPOLOGY (for lib/screacher-skin.mjs)
  // arm[v] = 1 (L) / 2 (R): arm material below that side's cloth armpit = the flooded arm piece + every vertex of a triangle of
  // a tracked arm loop (sleeve tube, cuff) + what hangs on those; leg[v] = 1 / 2: a vertex of a leg loop below the crotch.
  const armLabel = new Uint8Array(n), legLabel = new Uint8Array(n), centralMark = new Uint8Array(n);
  const kCrotch = kOf(crotchY - step / 2);
  const pitY = id => slices[Math.min(nS - 1, armRun[id === 1 ? 'L' : 'R'].kPit)].y - step / 2;
  for (let k = 0; k < nS; k++) for (const l of slices[k].loops) {
    let id = 0, leg = 0;
    for (const side of ['L', 'R']) { const R = armRun[side]; if (k < R.kPit && R.members[k]?.includes(l)) id = side === 'L' ? 1 : 2; }
    if (!id && !isCentral(l) && k <= kCrotch && !(armRun.L.members[k]?.includes(l) || armRun.R.members[k]?.includes(l))) leg = l.cx >= 0 ? 1 : 2;
    const central = !id && isCentral(l);
    for (const t of l.ts) for (let e = 0; e < 3; e++) { const v = I[t + e]; if (id) { if (P[v * 3 + 1] < pitY(id)) armLabel[v] = id; } else { if (central) centralMark[v] = 1; if (leg && P[v * 3 + 1] < crotchY) legLabel[v] = leg; } }
  }
  for (const side of ['L', 'R']) { const R = armRun[side], id = side === 'L' ? 1 : 2; for (let v = 0; v < n; v++) if (R.inArm[v]) armLabel[v] = id; }
  // everything that hangs on the arm below the cloth armpit belongs to it: flood from the labelled vertices over mesh edges,
  // never through a vertex of a body (midline-spanning) loop, never above the armpit, never across to the body's side: torn
  // sleeve hems / cuff tatters whose own little loops lie too far from the arm centre to be tracked, in-between vertices
  let closed = 0;
  {
    const stack = [];
    for (let v = 0; v < n; v++) if (armLabel[v]) stack.push(v);
    while (stack.length) {
      const v = stack.pop(), id = armLabel[v], sg = id === 1 ? 1 : -1, yMax = pitY(id);
      for (let e = deg[v]; e < deg[v + 1]; e++) {
        const u = adj[e];
        if (armLabel[u] || centralMark[u] || P[u * 3 + 1] >= yMax || sg * P[u * 3] < 0.03) continue;
        armLabel[u] = id; closed++; stack.push(u);
      }
    }
  }
  for (let v = 0; v < n; v++) if (armLabel[v]) legLabel[v] = 0;
  const count = (arr, id) => { let c = 0; for (const x of arr) if (x === id) c++; return c; };
  log.labels = {armL: count(armLabel, 1), armR: count(armLabel, 2), legL: count(legLabel, 1), legR: count(legLabel, 2), armClosureVertices: closed,
    method: 'topology labels on the welded mesh: arm = the arm piece flooded under the cloth armpit + the vertices of the tracked arm loops (sleeve tubes) below the cloth armpit + everything mesh-connected to those below the armpit without passing a vertex of a body (midline-spanning) loop (torn sleeve hems, cuff tatters); leg = the vertices of the leg loops below the crotch'};

  const heelZ = r4(Math.min(foot.L.minZ, foot.R.minZ) + 0.01);
  const torso = {y0: 0.3, step, rows: []};
  for (let y = 0.3; y < H; y += step) { const c = bodyLoops(kOf(y)).filter(isCentral); if (!c.length) { torso.rows.push(null); continue; } const u = union(c, y); torso.rows.push(r4([u.wx, u.wz, u.cx, u.cz])); }
  return {joints: J, ends, cut, heelZ, wall, torso, hipY, kneeY: J.L_Shin[1], ankleY, headY: J.Head[1], neckY: J.Neck[1], H, crotchY, armpitY, arms, legs, neckBaseY,
    stump: {top: r4(stumpTop), halfWidth: r4(stumpHalfWidth), baseY: r4(stumpBaseY)}, armsSymmetric, labels: {arm: armLabel, leg: legLabel}, log};
}
