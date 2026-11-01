// Task studio-alpha-beyond-station-round4-20261101-01 (lane ASSET): landmark -> joint estimation for the STRAINER body on
// the SHARED 18-joint skeleton (zombie/lib/skeleton.mjs JOINTS: same names / hierarchy). Returns the same structure as
// zombie/lib/skeleton.mjs detectSkeleton (joints, ends, cut, wall, heelZ, crotchY, hipY, ... , log) so zombie/lib/skin.mjs,
// zombie/lib/pose.mjs Rig and zombie/lib/clipsolve.mjs consume it unchanged.
//
// Why not detectSkeleton itself: it is tuned for upright A-pose humans and fails on this body (the generic rules assume a
// narrow neck above the shoulders, arms hanging close to the torso with a wrist 11-27 cm from the hand tip and a flat
// trapezius plateau). The Strainer is hunched (the head / crown projects forward over the chest, no narrow neck slice), its
// arms are spread ~44 deg below horizontal with 0.45 m clawed hands and a long thin distal forearm, the shoulders slope
// straight into a high spiked trapezius, and its knees are slightly bent forward in the bind. Here every joint is measured
// from the body's own geometry with explicit, logged rules (same slice / cluster primitives, zombie/lib/slices.mjs):
//   feet / ankles / crotch / hip height: the generic rules (copied);
//   knee: the patella = most forward point of the leg's front surface, joint just below it, centred in the leg section;
//   hip joint x / z: the thigh centreline (leg-section centres below the crotch) extrapolated to the hip height;
//   arm: PCA axis of the clean mid-arm, then perpendicular sections every 1 cm -> centreline + radius; shoulder = the upper
//        arm centreline extended a fixed inset past the first clean (torso-free) section; wrist = distal end of the thin
//        distal-forearm run (section radius below `thinR`) where the palm starts; elbow on the centreline at `elbowFrac` of
//        the shoulder -> wrist chord; hand end = farthest claw tip along the hand direction;
//   spine: mid-sagittal band (|x| < midBand) back / front per height, joint at `frac` of the depth from the back;
//   neck / head: neck base a fixed height above the shoulder joints (the hunched upper back has no narrow neck); head pivot
//        at `headPivotFrac` of neck base -> top, centred in the neck section; head end = the crown's farthest point.
import {bucketByHeight, clusterXZ, summarize, fitLine} from '../../zombie/lib/slices.mjs';

export const SKELETON_OPTIONS = {
  knee: {belowPatella: 0.02, searchAboveAnkle: 0.3, searchBelowCrotch: 0.1},
  hip: {xFactor: 0.8, thighFit: [0.25, 0.04]},
  arm: {axisX: [0.5, 0.85], armpitTol: 0.08, sectionHalf: 0.006, sectionReach: 0.2, step: 0.01, upperBand: [0.22, 0.04], aboveArmpit: 0.02, elbowFrac: 0.45, thinR: 0.034},
  neck: {aboveShoulder: 0.06, headPivotFrac: 0.4, headFrac: 0.5},
  spine: {midBand: 0.04, frac: 0.45, runGap: 0.03},
};

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => mul(a, 1 / (len(a) || 1));
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[s.length >> 1]; };
const pctl = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };

/** @param pos dense, welded MAIN-BODY point cloud in game space (+Z facing, feet at y = 0). */
export function detectStrainerSkeleton(pos, O = SKELETON_OPTIONS) {
  const log = {};
  const n = pos.length / 3;
  const P = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  let H = 0; for (let i = 0; i < n; i++) H = Math.max(H, pos[i * 3 + 1]);
  const step = 0.01;
  const {buckets} = bucketByHeight(pos, 0, H + step, step);
  const slices = buckets.map((b, k) => ({y: (k + 0.5) * step, clusters: clusterXZ(pos, b, 0.02, 5)}));
  const at = y => slices[Math.max(0, Math.min(slices.length - 1, Math.floor(y / step)))];
  const central = s => s.clusters.reduce((best, c) => (c.minX <= 0.02 && c.maxX >= -0.02 && (!best || c.count > best.count)) ? c : best, null);
  const legCluster = (y, side) => at(y).clusters.filter(c => Math.abs(c.bx) < 0.35 && (side === 'L' ? c.bx > 0 : c.bx < 0)).sort((a, b) => b.count - a.count)[0];

  // ---- feet & ankles (generic rules, zombie/lib/skeleton.mjs)
  const footIds = {L: [], R: []};
  for (let i = 0; i < n; i++) if (pos[i * 3 + 1] < 0.04) (pos[i * 3] > 0 ? footIds.L : footIds.R).push(i);
  const foot = {L: summarize(pos, footIds.L), R: summarize(pos, footIds.R)};
  const ext = (y, side) => { const c = legCluster(y, side); return c ? c.maxZ - c.minZ : NaN; };
  const shinDepth = median([0.15, 0.17, 0.19, 0.21, 0.23].map(y => (ext(y, 'L') + ext(y, 'R')) / 2));
  let ankleTransition = 0.12;
  for (let y = 0.03; y < 0.25; y += step) if ((ext(y, 'L') + ext(y, 'R')) / 2 < 1.3 * shinDepth) { ankleTransition = y; break; }
  const ankleY = Math.min(0.13, Math.max(0.07, ankleTransition - 0.015));
  log.feet = {L: r4([foot.L.bx, foot.L.minY, foot.L.bz]), R: r4([foot.R.bx, foot.R.minY, foot.R.bz]), toeZ: r4(Math.max(foot.L.maxZ, foot.R.maxZ)), heelZ: r4(Math.min(foot.L.minZ, foot.R.minZ)), shinDepth: r4(shinDepth), ankleTransitionY: r4(ankleTransition), ankleY: r4(ankleY), method: 'generic (zombie/lib/skeleton.mjs): foot depth widens > 1.3x shin depth below the ankle; joint 1.5 cm under the transition, clamped 0.07..0.13 m'};

  // ---- crotch: lowest height where the two leg clusters merge
  let crotchY = null;
  for (let y = 0.3; y < H * 0.7; y += step) {
    const legs = at(y).clusters.filter(c => Math.abs(c.bx) < 0.35);
    if (legs.length === 1 && legs[0].minX < 0 && legs[0].maxX > 0) { crotchY = y; break; }
  }
  if (crotchY == null) throw new Error('strainer skeleton: crotch not found');
  const hipY = Math.min(crotchY + 0.18, Math.max(crotchY + 0.06, 0.49 * H));

  // ---- legs
  const legs = {}, legLog = {};
  for (const side of ['L', 'R']) {
    // knee: patella = most forward leg front surface between ankle + 0.3 m and crotch - 0.1 m
    let pat = null;
    for (let y = ankleY + O.knee.searchAboveAnkle; y < crotchY - O.knee.searchBelowCrotch; y += step) { const c = legCluster(y, side); if (c && (!pat || c.maxZ > pat.z)) pat = {y, z: c.maxZ}; }
    const kneeY = pat.y - O.knee.belowPatella;
    const kc = legCluster(kneeY, side);
    const knee = [kc.bx, kneeY, kc.bz];
    const sh = legCluster(ankleY + 0.04, side);
    const ankle = [sh.bx, ankleY, sh.bz];
    // thigh centreline extrapolated to the hip height
    const pts = [];
    for (let y = crotchY - O.hip.thighFit[0]; y <= crotchY - O.hip.thighFit[1]; y += step) { const c = legCluster(y, side); if (c) pts.push([c.bx, y, c.bz]); }
    const tl = fitLine(pts);
    const tAt = (hipY - tl.center[1]) / tl.dir[1];
    const hipC = add(tl.center, mul(tl.dir, tAt));
    const thighTop = legCluster(crotchY - 0.04, side);
    const hip = [O.hip.xFactor * thighTop.bx, hipY, hipC[2]];
    const f = foot[side];
    legs[side] = {hip, knee, ankle, toe: [f.bx, 0.03, f.maxZ - 0.02]};
    legLog[side] = {patella: r4([pat.y, pat.z]), kneeSection: r4([kc.minZ, kc.maxZ]), thighLineAtHip: r4(hipC)};
  }
  log.legs = {crotchY: r4(crotchY), hipY: r4(hipY), ...legLog, method: `crotch = lowest merge of the leg clusters; hip height = 0.49H clamped to crotch+[0.06, 0.18] (generic); hip x = ${O.hip.xFactor} x thigh centre 4 cm below the crotch (generic), hip z = thigh-section centreline (crotch-${O.hip.thighFit[0]}..-${O.hip.thighFit[1]} m) extrapolated to the hip height; knee = ${O.knee.belowPatella} m below the patella (most forward leg front surface), centred in the leg section; ankle centred in the shin section`};

  // ---- arms
  const arms = {}, cut = {};
  let armpitMin = Infinity;
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    const pts = [];
    for (let i = 0; i < n; i++) { const x = sg * pos[i * 3]; if (x > O.arm.axisX[0] && x < O.arm.axisX[1] && pos[i * 3 + 1] > crotchY + 0.1) pts.push(P(i)); }
    const L = fitLine(pts);
    if (L.dir[0] * sg < 0) L.dir = mul(L.dir, -1);
    // armpit: highest slice where the ARM cluster (the one the arm axis passes through) is still separate from the central
    // torso cluster (the spiked shoulder tops form separate slice clusters too: they are not on the arm axis)
    const axisX = y => sg * (L.center[0] + L.dir[0] * (y - L.center[1]) / L.dir[1]);
    let armpitY = -Infinity;
    for (const s of slices) {
      if (s.y < crotchY) continue;
      const c0 = central(s); if (!c0) continue;
      const ax = axisX(s.y);
      for (const c of s.clusters) {
        if (c === c0 || !(sg > 0 ? c.minX > c0.maxX : c.maxX < c0.minX)) continue;
        const lo = Math.min(sg * c.minX, sg * c.maxX), hi = Math.max(sg * c.minX, sg * c.maxX);
        if (lo - O.arm.armpitTol < ax && ax < hi + O.arm.armpitTol) armpitY = Math.max(armpitY, s.y);
      }
    }
    armpitMin = Math.min(armpitMin, armpitY);
    // perpendicular sections along the axis
    const cand = [];
    for (let i = 0; i < n; i++) if (sg * pos[i * 3] > 0.2) cand.push(i);
    const sec = [];
    for (let t = -0.5; t <= 0.8; t += O.arm.step) {
      const a = add(L.center, mul(L.dir, t));
      const S = [];
      for (const i of cand) { const q = P(i), tt = dot(sub(q, L.center), L.dir); if (Math.abs(tt - t) < O.arm.sectionHalf && len(sub(q, a)) < O.arm.sectionReach) S.push(q); }
      if (S.length < 8) continue;
      const lo = [0, 1, 2].map(k => Math.min(...S.map(q => q[k]))), hi = [0, 1, 2].map(k => Math.max(...S.map(q => q[k])));
      const c = lo.map((v, k) => (v + hi[k]) / 2);
      const r = S.map(q => { const v = sub(q, c); return len(sub(v, mul(L.dir, dot(v, L.dir)))); });
      sec.push({t: +t.toFixed(3), c, r50: median(r), n: S.length});
    }
    // shoulder: the clean upper-arm centreline (sections whose centre lies armpit - upperBand[0] .. armpit - upperBand[1]
    // below the armpit: separate from the torso) evaluated `aboveArmpit` above the armpit (inside the deltoid mass)
    const tMid = 0;
    const upper = sec.filter(s => s.c[1] <= armpitY - O.arm.upperBand[1] && s.c[1] >= armpitY - O.arm.upperBand[0]);
    const ul = fitLine(upper.map(s => s.c));
    if (ul.dir[1] > 0) ul.dir = mul(ul.dir, -1); // pointing down the arm
    const shoulder = add(ul.center, mul(ul.dir, (armpitY + O.arm.aboveArmpit - ul.center[1]) / ul.dir[1]));
    const clean = upper[0];
    // wrist: distal end of the longest run of thin sections (beyond the mid-arm)
    let best = null, run = null;
    for (const s of sec) {
      if (s.t <= tMid) continue;
      if (s.r50 < O.arm.thinR) { if (!run) run = {a: s, b: s, k: 0}; run.b = s; run.k++; if (!best || run.k > best.k) best = {...run}; }
      else run = null;
    }
    if (!best) throw new Error('strainer skeleton: no thin wrist run ' + side);
    const wrist = best.b.c;
    // elbow: centreline point at elbowFrac of the shoulder -> wrist chord
    const chord = sub(wrist, shoulder), cl = len(chord), cu = mul(chord, 1 / cl);
    let elbowS = null;
    for (const s of sec) { const f = dot(sub(s.c, shoulder), cu) / cl; if (!elbowS || Math.abs(f - O.arm.elbowFrac) < Math.abs(elbowS.f - O.arm.elbowFrac)) elbowS = {...s, f}; }
    const elbow = elbowS.c;
    // hand end: farthest point along the hand direction (wrist -> hand centroid)
    const handPts = cand.map(P).filter(q => dot(sub(q, wrist), L.dir) > 0 && len(sub(q, wrist)) < 0.7 && q[1] < wrist[1] + 0.05);
    const hc = mul(handPts.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / handPts.length);
    const hd = norm(sub(hc, wrist));
    const proj = handPts.map(q => dot(sub(q, wrist), hd));
    const handTip = add(wrist, mul(hd, pctl(proj, 0.998)));
    // acromion: top surface over the shoulder (2 cm lateral of the joint) in the shoulder slab
    const xT = sg * shoulder[0] + 0.02;
    let topY = -Infinity;
    for (let i = 0; i < n; i++) { if (Math.abs(sg * pos[i * 3] - xT) > 0.01 || Math.abs(pos[i * 3 + 2] - shoulder[2]) > 0.08 || pos[i * 3 + 1] > shoulder[1] + 0.3) continue; topY = Math.max(topY, pos[i * 3 + 1]); }
    const wall = central(at(armpitY - 0.015));
    const armpitPt = [sg > 0 ? wall.maxX : wall.minX, armpitY, shoulder[2]];
    const acromionPt = [sg * xT, topY, shoulder[2]];
    arms[side] = {armpitY, shoulder, elbow, wrist, handTip, dir: L.dir, armpitPt, acromionPt};
    log['arm_' + side] = {axis: {center: r4(L.center), dir: r4(L.dir), degBelowHorizontal: r4(Math.asin(-L.dir[1]) * 180 / Math.PI)}, armpitY: r4(armpitY), upperArmSections: upper.length, firstCleanSection: {t: clean.t, c: r4(clean.c), r50: r4(clean.r50)}, upperArmDir: r4(ul.dir),
      thinRun: {from: best.a.t, to: best.b.t, sections: best.k}, elbowSection: {t: elbowS.t, frac: r4(elbowS.f)}, handDir: r4(hd), acromionTop: r4(topY),
      sections: sec.map(s => [s.t, ...r4(s.c), r4(s.r50)])};
  }
  log.arms = {method: `PCA axis of the arm between |x| ${O.arm.axisX.join('..')} m; armpit = highest slice where the cluster on that axis (+-${O.arm.armpitTol} m) is separate from the central torso cluster; perpendicular sections every ${O.arm.step} m (+-${O.arm.sectionHalf} m, points within ${O.arm.sectionReach} m) -> bbox-centre centreline + median radius; shoulder = the upper-arm centreline (sections centred ${O.arm.upperBand[0]}..${O.arm.upperBand[1]} m below the armpit, torso-free) evaluated ${O.arm.aboveArmpit} m above the armpit; wrist = distal end of the longest run of sections thinner than ${O.arm.thinR} m (the palm starts there); elbow = centreline section at ${O.arm.elbowFrac} of the shoulder -> wrist chord; hand end = 99.8th pct along wrist -> hand centroid; acromion = top surface 2 cm lateral of the joint`};

  // ---- spine / neck / head (mid-sagittal band)
  // mid-sagittal band (|x| < midBand, 1.6 cm slab) split into surface runs at z gaps > runGap: run 0 = the back skin,
  // run 1 = the first front surface (chest / throat); the face grille bars and the frond curtain hang further in front
  const midSection = y => {
    const zs = [];
    for (let i = 0; i < n; i++) if (Math.abs(pos[i * 3]) < O.spine.midBand && Math.abs(pos[i * 3 + 1] - y) < 0.008) zs.push(pos[i * 3 + 2]);
    zs.sort((a, b) => a - b);
    const runs = [];
    for (const z of zs) { const r = runs[runs.length - 1]; if (!r || z - r[1] > O.spine.runGap) runs.push([z, z]); else r[1] = z; }
    return {back: runs[0][0], front: (runs[1] || runs[0])[1], runs: runs.length};
  };
  const midZ = (y, f) => { const s = midSection(y); return s.back + f * (s.front - s.back); };
  const shoulderY = (arms.L.shoulder[1] + arms.R.shoulder[1]) / 2;
  const neckBaseY = shoulderY + O.neck.aboveShoulder;
  const headPivotY = neckBaseY + O.neck.headPivotFrac * (H - neckBaseY);
  const ns = midSection(headPivotY);
  const thighZ = (legs.L.hip[2] + legs.R.hip[2]) / 2;
  const J = {
    Root: [0, 0, 0],
    Hips: [0, hipY, thighZ],
    Spine: [0, hipY + 0.30 * (neckBaseY - hipY), midZ(hipY + 0.30 * (neckBaseY - hipY), O.spine.frac)],
    Chest: [0, hipY + 0.66 * (neckBaseY - hipY), midZ(hipY + 0.66 * (neckBaseY - hipY), O.spine.frac)],
    Neck: [0, neckBaseY, midZ(neckBaseY, O.spine.frac)],
    Head: [0, headPivotY, midZ(headPivotY, O.neck.headFrac)],
  };
  // symmetrise paired joints (bind is symmetric; raw values logged)
  log.rawPaired = {};
  for (const [k, obj] of [['shoulder', arms], ['elbow', arms], ['wrist', arms], ['handTip', arms], ['armpitPt', arms], ['acromionPt', arms], ['hip', legs], ['knee', legs], ['ankle', legs], ['toe', legs]]) {
    const a = obj.L[k], b = obj.R[k];
    log.rawPaired[k] = {L: r4(a), R: r4(b)};
    const x = (a[0] - b[0]) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2;
    obj.L[k] = [x, y, z]; obj.R[k] = [-x, y, z];
  }
  Object.assign(J, {
    L_UpperArm: arms.L.shoulder, L_Forearm: arms.L.elbow, L_Hand: arms.L.wrist, R_UpperArm: arms.R.shoulder, R_Forearm: arms.R.elbow, R_Hand: arms.R.wrist,
    L_Thigh: legs.L.hip, L_Shin: legs.L.knee, L_Foot: legs.L.ankle, R_Thigh: legs.R.hip, R_Shin: legs.R.knee, R_Foot: legs.R.ankle,
  });
  for (const k in J) J[k] = r4(J[k]);
  // head end: the crown point farthest from the head pivot (above the neck base)
  let far = null;
  for (let i = 0; i < n; i++) { if (pos[i * 3 + 1] < neckBaseY || Math.abs(pos[i * 3]) > 0.15) continue; const d = len(sub(P(i), J.Head)); if (!far || d > far.d) far = {d, p: P(i)}; }
  const ends = {Head: r4([0, far.p[1], far.p[2]]), L_Hand: r4(arms.L.handTip), R_Hand: r4(arms.R.handTip), L_Foot: r4(legs.L.toe), R_Foot: r4(legs.R.toe)};
  for (const s of ['L', 'R']) cut[s] = {A: r4(arms[s].armpitPt), T: r4(arms[s].acromionPt)};
  log.spine = {neckBaseY: r4(neckBaseY), headPivotY: r4(headPivotY), neckSectionAtHeadPivot: r4([ns.back, ns.front]), headEnd: ends.Head,
    midSections: [1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0].map(y => { const s = midSection(y); return [y, r4(s.back), r4(s.front), s.runs]; }),
    method: `spine joints at 30 / 66 % hip -> neck base (generic heights); z at ${O.spine.frac} of the mid-sagittal depth: back skin -> first front surface (|x| < ${O.spine.midBand} m slab split into surface runs at > ${O.spine.runGap} m z gaps, so the face grille / frond curtain hanging in front of the chest is not counted); neck base ${O.neck.aboveShoulder} m above the shoulder joints (hunched: no narrow neck slice); head pivot at ${O.neck.headPivotFrac} of neck base -> top, z at ${O.neck.headFrac} of the neck section there (back skin -> throat); head end = farthest crown point (|x| < 0.15) from the pivot`};
  const armpitY = armpitMin;
  const heelZ = r4(Math.min(foot.L.minZ, foot.R.minZ) + 0.01);
  const wall = {y0: r4(crotchY - 0.1), step, L: [], R: []};
  for (let y = crotchY - 0.1; y <= armpitY + 0.05; y += step) { const c = central(at(y)); wall.L.push(c ? r4(c.maxX) : 0); wall.R.push(c ? r4(-c.minX) : 0); }
  const torso = {y0: 0.3, step, rows: []};
  for (let y = 0.3; y < H; y += step) { const c = central(at(y)); torso.rows.push(c ? r4([c.maxX - c.minX, c.maxZ - c.minZ, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2]) : null); }
  return {joints: J, ends, cut, heelZ, wall, torso, hipY, kneeY: J.L_Shin[1], ankleY, headY: J.Head[1], neckY: J.Neck[1], H, crotchY, armpitY, arms, legs, neckBaseY, log};
}
