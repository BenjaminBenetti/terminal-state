// Task track1-siren-blightbelly-20261031 (lane RIGS): 18-joint skeleton estimation on a NATIVE (unchanged) humanoid in a T- or
// A-pose, placed in game space (feet on y = 0, facing +Z, +X = character left, metres). Same joint names / hierarchy / output
// shape as zombie/lib/skeleton.mjs detectSkeleton (which assumes an A-pose with arms separated in horizontal slices and fails on
// T-poses / long hair). Works on dense deterministic SURFACE SAMPLES (sparse smart-topology meshes leave holes in 1 cm slices)
// with an optional per-sample hair weight (hair is ignored for torso / neck measurements).
//  - feet / ankles / crotch / hips / knees: as detectSkeleton (measured feet, depth-transition ankle, leg-cluster merge
//    crotch, hip = 0.49 H clamped to crotch + [0.06, 0.18], knee 50 % ankle -> hip centred in the leg section);
//  - arms: axis from slices PERPENDICULAR to the provisional shoulder -> fingertip line (any arm angle), wrist = min section
//    radius 11-27 cm (x H / 1.78) from the tip, armpit junction = where the arm section merges with the torso, shoulder joint
//    on the axis 1 cm medial of the junction, elbow 54 % shoulder -> wrist re-centred in its section;
//  - neck / head: non-hair front-midline profile (the throat plateau and the chin step), neck base where the profile reaches
//    the throat plateau, head pivot 40 % neck base -> top (detectSkeleton's rule);
//  - spine / chest: 30 % / 66 % hip -> neck base, z at 42 % of the non-hair torso depth.
// Every measured value and every ratio fallback is logged.
import {JOINTS} from '../../zombie/lib/skeleton.mjs';
import {cluster2, slab} from './surface.mjs';

const r3 = v => v.map(x => +x.toFixed(4));
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export {JOINTS};

/**
 * @param pts game-space surface samples (Float32Array xyz)
 * @param hair per-sample hair weight (0..1) or null
 */
export function estimateSkeleton(pts, hair = null) {
  const log = {};
  const n = pts.length / 3;
  const skin = i => !hair || hair[i] < 0.5;
  let H = 0; for (let i = 0; i < n; i++) H = Math.max(H, pts[i * 3 + 1]);
  const k = H / 1.78; // anthropometric distances of detectSkeleton are for a 1.78 m body
  const sliceY = (y, half = 0.005, f = skin) => slab(pts, 1, y, half, f);
  const clustersAt = (y, f = skin) => cluster2(pts, sliceY(y, 0.005, f), 0, 2, 0.015 * Math.max(1, k), 4);
  const central = cs => cs.reduce((b, c) => (c.min[0] <= 0.02 && c.max[0] >= -0.02 && (!b || c.count > b.count)) ? c : b, null);

  // --- feet & ankles ---
  const foot = {L: {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity}, R: null};
  foot.R = {...foot.L};
  for (let i = 0; i < n; i++) {
    if (pts[i * 3 + 1] > 0.04 * k) continue;
    const f = pts[i * 3] > 0 ? foot.L : foot.R, x = pts[i * 3], z = pts[i * 3 + 2];
    f.x0 = Math.min(f.x0, x); f.x1 = Math.max(f.x1, x); f.z0 = Math.min(f.z0, z); f.z1 = Math.max(f.z1, z); f.y0 = Math.min(f.y0, pts[i * 3 + 1]);
  }
  for (const s of ['L', 'R']) { const f = foot[s]; f.bx = (f.x0 + f.x1) / 2; f.bz = (f.z0 + f.z1) / 2; }
  const legCluster = (y, side) => clustersAt(y).filter(c => Math.abs(c.c[0]) < 0.35 * k && (side === 'L' ? c.c[0] > 0 : c.c[0] < 0)).sort((a, b) => b.count - a.count)[0];
  const ext = (y, side) => { const c = legCluster(y, side); return c ? c.max[1] - c.min[1] : NaN; };
  const shinDepth = median([0.15, 0.17, 0.19, 0.21, 0.23].map(y => (ext(y * k, 'L') + ext(y * k, 'R')) / 2));
  let ankleTransition = 0.12 * k;
  for (let y = 0.03 * k; y < 0.25 * k; y += 0.005) if ((ext(y, 'L') + ext(y, 'R')) / 2 < 1.3 * shinDepth) { ankleTransition = y; break; }
  const ankleY = Math.min(0.13 * k, Math.max(0.07 * k, ankleTransition - 0.015 * k));
  log.feet = {L: r3([foot.L.bx, foot.L.y0, foot.L.bz]), R: r3([foot.R.bx, foot.R.y0, foot.R.bz]), toeZ: +Math.max(foot.L.z1, foot.R.z1).toFixed(4), heelZ: +Math.min(foot.L.z0, foot.R.z0).toFixed(4),
    shinDepth: +shinDepth.toFixed(4), ankleTransitionY: +ankleTransition.toFixed(3), ankleY: +ankleY.toFixed(3), method: 'depth (z extent) of the leg section widens >1.3x the shin depth below the ankle; joint 1.5 cm (x H/1.78) under the transition'};

  // --- crotch: lowest height where the two leg clusters merge into one crossing x = 0 ---
  let crotchY = null;
  for (let y = 0.3 * k; y < H * 0.7; y += 0.005) {
    const legs = clustersAt(y).filter(c => Math.abs(c.c[0]) < 0.35 * k);
    if (legs.length === 1 && legs[0].min[0] < 0 && legs[0].max[0] > 0) { crotchY = y; break; }
  }
  if (crotchY == null) throw new Error('skeleton: crotch not found');

  // --- hips & legs ---
  const hipY = Math.min(crotchY + 0.18 * k, Math.max(crotchY + 0.06 * k, 0.49 * H));
  // thigh sections 4 cm below the crotch (or the first height further down where both legs are separate sections)
  let thighY = crotchY - 0.04 * k, thigh = null;
  for (; thighY > crotchY - 0.25 * k; thighY -= 0.005) { const t = {L: legCluster(thighY, 'L'), R: legCluster(thighY, 'R')}; if (t.L && t.R) { thigh = t; break; } }
  if (!thigh) throw new Error('skeleton: thigh sections not found');
  const pelvis = central(clustersAt(hipY));
  const pelvisZ = pelvis.min[1] + 0.45 * (pelvis.max[1] - pelvis.min[1]);
  const legs = {};
  for (const side of ['L', 'R']) {
    const sh = legCluster(ankleY + 0.04 * k, side);
    const kneeY = ankleY + 0.5 * (hipY - ankleY);
    const kc = legCluster(kneeY, side);
    legs[side] = {hip: [0.8 * thigh[side].c[0], hipY, pelvisZ], knee: [kc.c[0], kneeY, kc.c[1]], ankle: [sh.c[0], ankleY, sh.c[1]], toe: [foot[side].bx, 0.03 * k, foot[side].z1 - 0.02 * k]};
  }
  log.legs = {crotchY: +crotchY.toFixed(3), hipY: +hipY.toFixed(3), thighSectionY: +thighY.toFixed(3), thighCentreX: [+thigh.L.c[0].toFixed(4), +thigh.R.c[0].toFixed(4)], pelvisZ: +pelvisZ.toFixed(4),
    method: 'crotch = lowest merge of the leg sections (non-hair samples); hip height = 0.49H clamped to crotch+[0.06,0.18] (x H/1.78); hip x = 0.8 x thigh centre 4 cm below the crotch; knee at 50% ankle->hip, centred in the leg section; ankle centred in the shin section'};

  // --- arms (perpendicular slices along the arm axis) ---
  const arms = {};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    // fingertip: farthest skin sample laterally above the crotch
    let tip = null;
    for (let i = 0; i < n; i++) { if (!skin(i) || pts[i * 3 + 1] < crotchY) continue; const x = sg * pts[i * 3]; if (!tip || x > tip[0] * sg) tip = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]; }
    let S0 = [sg * 0.1 * k, 0.78 * H, 0];
    let axis = {c: S0, d: nrm(sub(tip, S0))};
    const section = (c, d, half = 0.004) => {
      const ids = [];
      for (let i = 0; i < n; i++) { if (!skin(i)) continue; const q = [pts[i * 3] - c[0], pts[i * 3 + 1] - c[1], pts[i * 3 + 2] - c[2]]; if (Math.abs(dot(q, d)) < half) ids.push(i); }
      return ids;
    };
    // in-plane basis
    const basis = d => { const u = nrm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); return [u, cross(d, u)]; };
    const nearestCluster = (c, d) => {
      const ids = section(c, d);
      const [u, v] = basis(d);
      const P2 = new Float32Array(ids.length * 3);
      ids.forEach((i, j) => { const q = [pts[i * 3] - c[0], pts[i * 3 + 1] - c[1], pts[i * 3 + 2] - c[2]]; P2[j * 3] = dot(q, u); P2[j * 3 + 1] = 0; P2[j * 3 + 2] = dot(q, v); });
      const cl = cluster2(P2, [...ids.keys()], 0, 2, 0.012, 3);
      let best = null, bd = Infinity;
      for (const q of cl) { const dd = Math.hypot(q.c[0], q.c[1]); if (dd < bd) { bd = dd; best = q; } }
      if (!best) return null;
      const centre = add(c, add(mul(u, best.c[0]), mul(v, best.c[1])));
      // radius: 90th percentile distance of the cluster's samples to its centre
      const rs = best.ids.map(j => Math.hypot(P2[j * 3] - best.c[0], P2[j * 3 + 2] - best.c[1])).sort((a, b) => a - b);
      return {centre, ext: [best.max[0] - best.min[0], best.max[1] - best.min[1]], r: rs[Math.floor(rs.length * 0.9)] ?? 0, count: best.count, dist: bd};
    };
    let span = 0, samples = [];
    for (let pass = 0; pass < 3; pass++) {
      span = dot(sub(tip, axis.c), axis.d);
      samples = [];
      for (let t = 0.04; t <= 0.995; t += 0.01) {
        const c = add(axis.c, mul(axis.d, t * span));
        const s = nearestCluster(c, axis.d);
        if (s) samples.push({t, ...s});
      }
      // refit the axis through section centres of the arm proper (35-80 % of the span: upper arm + forearm)
      const pick = samples.filter(s => s.t > 0.35 && s.t < 0.8 && s.dist < 0.08);
      const cen = pick.reduce((a, s) => add(a, s.centre), [0, 0, 0]).map(v => v / pick.length);
      let d = axis.d;
      for (let it = 0; it < 50; it++) { // principal direction
        let acc = [0, 0, 0];
        for (const s of pick) { const q = sub(s.centre, cen); acc = add(acc, mul(q, dot(q, d))); }
        d = nrm(acc);
      }
      if (dot(d, axis.d) < 0) d = mul(d, -1);
      // move the axis origin medially to the torso midline-ish start (x = sg * 0.06 H)
      const tt = (sg * 0.06 * H - cen[0]) / d[0];
      axis = {c: add(cen, mul(d, tt)), d};
    }
    span = dot(sub(tip, axis.c), axis.d);
    const at = t => add(axis.c, mul(axis.d, t));
    const tipT = span;
    // wrist: minimum section radius 11-27 cm (x k) from the tip
    let wristT = null, wristR = Infinity;
    for (const s of samples) { const tt = s.t * span; if (tt > tipT - 0.27 * k && tt < tipT - 0.11 * k && s.r < wristR && s.count > 6) { wristR = s.r; wristT = tt; } }
    // junction with the torso: walking medially from 40 % of the span, the first section whose extent jumps > 1.7x the
    // median upper-arm extent (the section now includes the chest wall / shoulder girdle)
    const upper = samples.filter(s => s.t > 0.3 && s.t < 0.5).map(s => Math.max(...s.ext));
    const armExt = median(upper);
    let juncT = null;
    for (const s of [...samples].sort((a, b) => b.t - a.t)) { if (s.t >= 0.4) continue; if (Math.max(...s.ext) > 1.7 * armExt) { juncT = s.t * span; break; } }
    if (juncT == null) throw new Error('skeleton: arm/torso junction not found ' + side);
    const sec = t => nearestCluster(at(t), axis.d);
    const wrist = sec(wristT)?.centre ?? at(wristT);
    // shoulder joint: centre of the first arm-only section (1.5 cm lateral of the junction), moved 2 cm medially along the
    // axis (the humeral head sits inside the deltoid, medial of where the arm section separates from the chest wall). The
    // section centre is used rather than the extrapolated axis: the axis bends forward toward the hand.
    const js = nearestCluster(at(juncT + 0.015 * k), axis.d);
    const shoulder = sub(js?.centre ?? at(juncT + 0.015 * k), mul(axis.d, 0.02 * k));
    const elbowGuess = add(shoulder, mul(sub(wrist, shoulder), 0.54));
    const elbow = sec(dot(sub(elbowGuess, axis.c), axis.d))?.centre ?? elbowGuess;
    // junction section bounds for the cut plane: underside (armpit) and top (acromion) of the arm at the junction
    const armR = (js?.ext ? Math.max(...js.ext) : armExt) / 2;
    const armpitPt = [shoulder[0], shoulder[1] - armR, shoulder[2]];
    const acromionPt = [shoulder[0] + sg * 0.01 * k, shoulder[1] + armR, shoulder[2]];
    arms[side] = {shoulder, elbow, wrist, handTip: at(tipT), armpitPt, acromionPt, dir: axis.d, armpitY: armpitPt[1], wristRadius: wristR};
    log['arm_' + side] = {axisDir: r3(axis.d), angleBelowHorizontalDeg: +(Math.asin(-axis.d[1]) * 180 / Math.PI).toFixed(1), tip: r3(tip), wristFromTipM: +(tipT - wristT).toFixed(3), wristRadius: +wristR.toFixed(4),
      upperArmSectionM: +armExt.toFixed(4), junctionFromAxisOriginM: +juncT.toFixed(3), method: 'axis = principal line of perpendicular-section centres (35-80% of the shoulder->fingertip span, 3 passes); wrist = min 90th-pct section radius 11-27 cm from the tip; junction = first section medial of 40% wider than 1.7x the upper-arm section; shoulder joint = centre of the arm section 1.5 cm lateral of the junction moved 2 cm medially along the axis; elbow 54% shoulder->wrist re-centred'};
  }

  // --- neck & head from the non-hair front midline profile ---
  const shoulderY = (arms.L.shoulder[1] + arms.R.shoulder[1]) / 2;
  const front = [];
  for (let y = shoulderY; y <= H; y += 0.005) {
    let zf = -Infinity;
    for (const i of sliceY(y, 0.0025)) if (Math.abs(pts[i * 3]) < 0.015 * Math.max(1, k)) zf = Math.max(zf, pts[i * 3 + 2]);
    front.push({y, zf});
  }
  const neckBand = front.filter(f => f.y > shoulderY + 0.02 * k && f.y < shoulderY + 0.16 * k && Number.isFinite(f.zf));
  const throatZ = Math.min(...neckBand.map(f => f.zf));
  const throatY = neckBand.find(f => f.zf === throatZ)?.y ?? shoulderY + 0.08 * k;
  let neckBaseY = shoulderY + 0.03 * k, chinY = null;
  for (const f of front) if (f.y < throatY && Number.isFinite(f.zf) && f.zf <= throatZ + 0.012 * k) { neckBaseY = f.y; break; }
  for (const f of front) if (f.y > throatY && Number.isFinite(f.zf) && f.zf >= throatZ + 0.04 * k) { chinY = f.y; break; }
  const headPivotY = neckBaseY + 0.4 * (H - neckBaseY);
  // head depth (all samples incl. hair above the chin) for the head joint / end z
  let hz0 = Infinity, hz1 = -Infinity, hx = 0;
  for (let i = 0; i < n; i++) if (pts[i * 3 + 1] > (chinY ?? headPivotY)) { hz0 = Math.min(hz0, pts[i * 3 + 2]); hz1 = Math.max(hz1, pts[i * 3 + 2]); if (skin(i)) hx = Math.max(hx, Math.abs(pts[i * 3])); }
  const neckZ = throatZ - 0.05 * k, headZ = throatZ - 0.045 * k;
  log.neck = {shoulderAxisY: +shoulderY.toFixed(3), throatFrontZ: +throatZ.toFixed(4), throatY: +throatY.toFixed(3), neckBaseY: +neckBaseY.toFixed(3), chinY: chinY && +chinY.toFixed(3), headTop: +H.toFixed(4), headPivotY: +headPivotY.toFixed(3),
    neckZ: +neckZ.toFixed(4), headZ: +headZ.toFixed(4), headDepthZ: [+hz0.toFixed(3), +hz1.toFixed(3)],
    method: 'non-hair front midline (|x| < 1.5 cm): throat plateau = min front z 2-16 cm above the shoulder axis; neck base = lowest height reaching the plateau +1.2 cm; chin = first step +4 cm above the throat; head pivot 40% neck base -> top; neck / head joints 5.0 / 4.5 cm behind the throat surface (x H/1.78)'};

  // --- spine / chest ---
  const spineZ = y => { const c = central(clustersAt(y)); return c ? c.min[1] + 0.42 * (c.max[1] - c.min[1]) : pelvisZ; };
  const spineY = hipY + 0.30 * (neckBaseY - hipY), chestY = hipY + 0.66 * (neckBaseY - hipY);

  // symmetrise paired joints (the bind pose is symmetric; raw values logged)
  const pairs = [['armpitPt', arms], ['acromionPt', arms], ['shoulder', arms], ['elbow', arms], ['wrist', arms], ['handTip', arms], ['hip', legs], ['knee', legs], ['ankle', legs], ['toe', legs]];
  log.rawPaired = {};
  for (const [key, obj] of pairs) {
    const a = obj.L[key], b = obj.R[key];
    log.rawPaired[key] = {L: r3(a), R: r3(b)};
    const x = (a[0] - b[0]) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2;
    obj.L[key] = [x, y, z]; obj.R[key] = [-x, y, z];
  }
  const J = {
    Root: [0, 0, 0], Hips: [0, hipY, pelvisZ], Spine: [0, spineY, spineZ(spineY)], Chest: [0, chestY, spineZ(chestY)],
    Neck: [0, neckBaseY, neckZ], Head: [0, headPivotY, headZ],
    L_UpperArm: arms.L.shoulder, L_Forearm: arms.L.elbow, L_Hand: arms.L.wrist,
    R_UpperArm: arms.R.shoulder, R_Forearm: arms.R.elbow, R_Hand: arms.R.wrist,
    L_Thigh: legs.L.hip, L_Shin: legs.L.knee, L_Foot: legs.L.ankle,
    R_Thigh: legs.R.hip, R_Shin: legs.R.knee, R_Foot: legs.R.ankle,
  };
  for (const key in J) J[key] = r3(J[key]);
  const ends = {Head: r3([0, H, (hz0 + hz1) / 2]), L_Hand: r3(arms.L.handTip), R_Hand: r3(arms.R.handTip), L_Foot: r3(legs.L.toe), R_Foot: r3(legs.R.toe)};
  const cut = {L: {A: r3(arms.L.armpitPt), T: r3(arms.L.acromionPt)}, R: {A: r3(arms.R.armpitPt), T: r3(arms.R.acromionPt)}};
  const heelZ = +(Math.min(foot.L.z0, foot.R.z0) + 0.01 * k).toFixed(4);
  const armpitY = Math.min(arms.L.armpitY, arms.R.armpitY);
  // torso wall profile (half-width of the central non-hair cluster per height) for the skin flood (skin.mjs `wall`)
  const step = 0.01, wall = {y0: +(crotchY - 0.1).toFixed(3), step, L: [], R: []};
  for (let y = crotchY - 0.1; y <= armpitY + 0.05; y += step) { const c = central(clustersAt(y)); wall.L.push(c ? +c.max[0].toFixed(4) : 0); wall.R.push(c ? +(-c.min[0]).toFixed(4) : 0); }
  log.validation = validateSkeleton({joints: J, H});
  return {joints: J, ends, cut, heelZ, wall, hipY, kneeY: J.L_Shin[1], ankleY, headY: J.Head[1], neckY: J.Neck[1], H, crotchY, armpitY, neckBaseY, chinY, shoulderY,
    arms: {L: {dir: r3(arms.L.dir), wristRadius: +arms.L.wristRadius.toFixed(4)}, R: {dir: r3(arms.R.dir), wristRadius: +arms.R.wristRadius.toFixed(4)}}, headHalfWidth: +hx.toFixed(4), headDepth: +(hz1 - hz0).toFixed(4), log};
}

/** Anthropometric sanity ranges (fractions of height). Reported (not thrown): the Siren is stylised (long claws, short arms). */
export function validateSkeleton({joints: J, H}) {
  const out = [];
  const L = (a, b) => len(sub(J[a], J[b]));
  const chk = (name, v, lo, hi) => out.push({name, value: +(+v).toFixed(3), range: [lo, hi], ok: v >= lo && v <= hi});
  chk('hipY/H', J.Hips[1] / H, 0.44, 0.58);
  chk('neckY/H', J.Neck[1] / H, 0.78, 0.9);
  chk('shoulderY/H', J.L_UpperArm[1] / H, 0.74, 0.88);
  chk('shoulderHalfWidth/H', J.L_UpperArm[0] / H, 0.06, 0.14);
  chk('upperArm/H', L('L_UpperArm', 'L_Forearm') / H, 0.1, 0.2);
  chk('forearm/H', L('L_Forearm', 'L_Hand') / H, 0.09, 0.19);
  chk('thigh/H', L('L_Thigh', 'L_Shin') / H, 0.17, 0.27);
  chk('shin/H', L('L_Shin', 'L_Foot') / H, 0.17, 0.27);
  chk('ankleY/H', J.L_Foot[1] / H, 0.03, 0.09);
  for (const [nm] of JOINTS) if (!(J[nm] && J[nm].every(Number.isFinite))) out.push({name: 'finite ' + nm, ok: false});
  return out;
}
