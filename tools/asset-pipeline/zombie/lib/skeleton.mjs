// Joint estimation from horizontal cross-sections of the (game-space) body master.
// Heights of features that are visible in the geometry (feet, crotch, armpits, neck, head top,
// wrists) are measured; joints that have no visible landmark (hip, knee, elbow centres) use
// anthropometric ratios BETWEEN measured landmarks, and are then centred in the measured limb
// cross-section. Every value and method is logged into the manifest.
import {bucketByHeight, clusterXZ, summarize, fitLine} from './slices.mjs';

export const JOINTS = [
  ['Root', null], ['Hips', 'Root'], ['Spine', 'Hips'], ['Chest', 'Spine'], ['Neck', 'Chest'], ['Head', 'Neck'],
  ['L_UpperArm', 'Chest'], ['L_Forearm', 'L_UpperArm'], ['L_Hand', 'L_Forearm'],
  ['R_UpperArm', 'Chest'], ['R_Forearm', 'R_UpperArm'], ['R_Hand', 'R_Forearm'],
  ['L_Thigh', 'Hips'], ['L_Shin', 'L_Thigh'], ['L_Foot', 'L_Shin'],
  ['R_Thigh', 'Hips'], ['R_Shin', 'R_Thigh'], ['R_Foot', 'R_Shin'],
];

const r3 = v => v.map(x => +x.toFixed(4));

export function detectSkeleton(pos) {
  const log = {};
  const n = pos.length / 3;
  let H = 0; for (let i = 0; i < n; i++) H = Math.max(H, pos[i * 3 + 1]);
  const step = 0.01;
  const {buckets} = bucketByHeight(pos, 0, H + step, step);
  const slices = buckets.map((b, k) => ({y: (k + 0.5) * step, clusters: clusterXZ(pos, b, 0.02, 5)}));
  const at = y => slices[Math.max(0, Math.min(slices.length - 1, Math.floor(y / step)))];
  const central = s => s.clusters.reduce((best, c) => (c.minX <= 0.02 && c.maxX >= -0.02 && (!best || c.count > best.count)) ? c : best, null);

  // --- feet & ankles ---
  const footIds = {L: [], R: []};
  for (let i = 0; i < n; i++) if (pos[i * 3 + 1] < 0.04) (pos[i * 3] > 0 ? footIds.L : footIds.R).push(i);
  const foot = {L: summarize(pos, footIds.L), R: summarize(pos, footIds.R)};
  const legCluster = (y, side) => at(y).clusters.filter(c => Math.abs(c.bx) < 0.35 && (side === 'L' ? c.bx > 0 : c.bx < 0)).sort((a, b) => b.count - a.count)[0];
  const ext = (y, side) => { const c = legCluster(y, side); return c ? c.maxZ - c.minZ : NaN; };
  const shinDepth = median([0.15, 0.17, 0.19, 0.21, 0.23].map(y => (ext(y, 'L') + ext(y, 'R')) / 2));
  let ankleTransition = 0.12;
  for (let y = 0.03; y < 0.25; y += step) if ((ext(y, 'L') + ext(y, 'R')) / 2 < 1.3 * shinDepth) { ankleTransition = y; break; }
  const ankleY = Math.min(0.13, Math.max(0.07, ankleTransition - 0.015));
  log.feet = {L: r3([foot.L.bx, foot.L.minY, foot.L.bz]), R: r3([foot.R.bx, foot.R.minY, foot.R.bz]), toeZ: +Math.max(foot.L.maxZ, foot.R.maxZ).toFixed(4), shinDepth: +shinDepth.toFixed(4), ankleTransitionY: +ankleTransition.toFixed(3), ankleY: +ankleY.toFixed(3), method: 'boot depth widens >1.3x shin depth below ankle; joint 1.5 cm under transition'};

  // --- crotch: lowest height where the two leg clusters merge ---
  let crotchY = null;
  for (let y = 0.3; y < H * 0.7; y += step) {
    const legs = at(y).clusters.filter(c => Math.abs(c.bx) < 0.35);
    if (legs.length === 1 && legs[0].minX < 0 && legs[0].maxX > 0) { crotchY = y; break; }
  }
  if (crotchY == null) throw new Error('skeleton: crotch not found');

  // --- arms: clusters separated from the central torso cluster ---
  const armSlices = {L: [], R: []};
  for (const s of slices) {
    if (s.y < crotchY - 0.2) continue;
    const c0 = central(s);
    if (!c0) continue;
    for (const c of s.clusters) {
      if (c === c0) continue;
      if (c.minX > c0.maxX) armSlices.L.push({y: s.y, c});
      else if (c.maxX < c0.minX) armSlices.R.push({y: s.y, c});
    }
  }
  const arms = {};
  for (const side of ['L', 'R']) {
    const list = armSlices[side].filter(a => Math.abs(a.c.bx) > 0.25 || a.y > crotchY);
    const armpitY = Math.max(...list.map(a => a.y));
    const ids = list.flatMap(a => a.c.ids);
    const tipY = Math.min(...list.map(a => a.y));
    // pass 1 axis from slices between armpit and mid-arm
    const mid = (armpitY + tipY) / 2;
    let line = fitLine(list.filter(a => a.y <= armpitY - 0.02 && a.y >= mid).map(a => [a.c.bx, a.y, a.c.bz]));
    if ((side === 'L' && line.dir[0] < 0) || (side === 'R' && line.dir[0] > 0)) line.dir = line.dir.map(v => -v);
    // radius profile along the axis
    const prof = profileAlong(pos, ids, line);
    const tip = prof.tTip;
    let wristT = null, wristR = Infinity;
    for (const b of prof.bins) if (b.t > tip - 0.27 && b.t < tip - 0.11 && b.n > 10 && b.r < wristR) { wristR = b.r; wristT = b.t; }
    const wristC = sectionCentroid(pos, ids, line, wristT, 0.012);
    // pass 2 axis: slices from armpit down to wrist height
    line = fitLine(list.filter(a => a.y <= armpitY - 0.02 && a.y >= wristC[1]).map(a => [a.c.bx, a.y, a.c.bz]));
    if ((side === 'L' && line.dir[0] < 0) || (side === 'R' && line.dir[0] > 0)) line.dir = line.dir.map(v => -v);
    const handTip = line.center.map((v, k) => v + line.dir[k] * tip);
    arms[side] = {armpitY, wrist: wristC, handTip, dir: line.dir, line, ids, wristRadius: wristR};
    log['arm_' + side] = {armpitY: +armpitY.toFixed(3), forearmAxisDir: r3(line.dir), forearmAngleFromVerticalDeg: +(Math.acos(-line.dir[1]) * 180 / Math.PI).toFixed(1), wristT: +wristT.toFixed(3), wristRadius: +wristR.toFixed(4), tipT: +tip.toFixed(3)};
  }

  // --- neck & head ---
  const torsoW = y => { const c = central(at(y)); return c ? c.maxX - c.minX : NaN; };
  const armpitY = Math.min(arms.L.armpitY, arms.R.armpitY);
  let neckMinY = null, neckW = Infinity;
  for (let y = armpitY + 0.1; y < H - 0.12; y += step) { const w = torsoW(y); if (w < neckW) { neckW = w; neckMinY = y; } }
  let neckBaseY = neckMinY;
  for (let y = neckMinY; y > armpitY; y -= step) { if (torsoW(y) > 1.9 * neckW) { neckBaseY = y + step; break; } }
  const headPivotY = neckBaseY + 0.4 * (H - neckBaseY);
  log.neck = {neckMinY: +neckMinY.toFixed(3), neckWidth: +neckW.toFixed(4), neckBaseY: +neckBaseY.toFixed(3), headTop: +H.toFixed(4), headPivotY: +headPivotY.toFixed(3), method: 'narrowest slice above shoulders; base where width >1.9x neck; head pivot at 40% base->top'};

  // --- shoulders: acromion = where the top-surface slope (neck -> lateral) steepens past -0.8;
  //     glenohumeral centre 5 cm below and 2 cm medial of it, centred in the shoulder slab depth.
  //     (Horizontal slices cannot see the upper arm: the raised elbow is at armpit height.)
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    const a = arms[side];
    const yProbe = (a.armpitY + neckBaseY) / 2; // shoulder height band, z of the extrapolated arm axis there
    const zc = a.line.center[2] + ((yProbe - a.line.center[1]) / a.line.dir[1]) * a.line.dir[2];
    const x0 = neckW / 2 + 0.01;
    const tops = [];
    for (let k = 0; k < 32; k++) {
      const x = x0 + k * 0.01; let top = -Infinity;
      for (let i = 0; i < n; i++) {
        if (Math.abs(sg * pos[i * 3] - x) > 0.005 || Math.abs(pos[i * 3 + 2] - zc) > 0.06) continue;
        const y = pos[i * 3 + 1]; if (y < neckMinY && y > top) top = y;
      }
      tops.push({x, top});
    }
    if (process.env.ZDEBUG) console.log(side, JSON.stringify(tops.map(t => [+t.x.toFixed(2), +t.top.toFixed(3)])));
    let acr = null, plateau = false;
    for (let k = 1; k < tops.length - 1; k++) {
      const slope = (tops[k + 1].top - tops[k - 1].top) / 0.02;
      if (!plateau) { if (slope > -0.6) plateau = true; continue; } // skip the neck -> trapezius drop
      if (k + 4 >= tops.length) break;
      const slope4 = (tops[k + 4].top - tops[k].top) / 0.04; // sustained steepening = deltoid, not a collar step
      if (slope4 < -0.8) { acr = tops[k]; break; }
    }
    if (!acr) throw new Error('skeleton: acromion not found ' + side);
    const jx = acr.x - 0.02, jy = acr.top - 0.05;
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { if (Math.abs(sg * pos[i * 3] - jx) > 0.01 || Math.abs(pos[i * 3 + 1] - jy) > 0.02) continue; z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
    a.shoulder = [sg * jx, jy, (z0 + z1) / 2];
    const wall = central(at(a.armpitY - 0.015));
    a.armpitPt = [sg === 1 ? wall.maxX : wall.minX, a.armpitY, a.shoulder[2]];
    a.acromionPt = [sg * acr.x, acr.top, a.shoulder[2]];
    const elbowGuess = a.shoulder.map((v, k) => v + 0.54 * (a.wrist[k] - v));
    a.elbow = sectionCentroid(pos, a.ids, a.line, dotSub(elbowGuess, a.line.center, a.line.dir), 0.012);
    const ua = a.elbow.map((v, k) => v - a.shoulder[k]); const ul = Math.hypot(...ua);
    Object.assign(log['arm_' + side], {acromion: [+(sg * acr.x).toFixed(3), +acr.top.toFixed(4)], shoulderSlabZ: [+z0.toFixed(3), +z1.toFixed(3)], upperArmAngleFromVerticalDeg: +(Math.acos(-ua[1] / ul) * 180 / Math.PI).toFixed(1),
      method: 'arm = slice clusters separated from torso; forearm PCA axis; wrist = min radius 11-27 cm from tip; shoulder from acromion (top-surface slope over 4 cm < -0.8 after the trapezius plateau) -5 cm/-2 cm medial, slab-centred in z; elbow 54% shoulder->wrist centred in limb section'});
  }

  // --- hips & legs ---
  const hipY = Math.min(crotchY + 0.18, Math.max(crotchY + 0.06, 0.49 * H));
  const thigh = {L: legCluster(crotchY - 0.04, 'L'), R: legCluster(crotchY - 0.04, 'R')};
  const legs = {};
  for (const side of ['L', 'R']) {
    const sh = legCluster(ankleY + 0.04, side);
    const ankle = [sh.bx, ankleY, sh.bz];
    const hip = [0.8 * thigh[side].bx, hipY, null];
    const kneeY = ankleY + 0.5 * (hipY - ankleY);
    const kc = legCluster(kneeY, side);
    const knee = [kc.bx, kneeY, kc.bz];
    const f = foot[side];
    const toe = [f.bx, 0.03, f.maxZ - 0.02];
    legs[side] = {hip, knee, ankle, toe};
  }
  const pelvis = central(at(hipY));
  const pelvisZ = pelvis.minZ + 0.45 * (pelvis.maxZ - pelvis.minZ);
  legs.L.hip[2] = legs.R.hip[2] = pelvisZ;
  log.legs = {crotchY: +crotchY.toFixed(3), hipY: +hipY.toFixed(3), thighCentreX: [+thigh.L.bx.toFixed(4), +thigh.R.bx.toFixed(4)], method: 'crotch = lowest merge of leg clusters; hip height = 0.49H clamped to crotch+[0.06,0.18]; hip x = 0.8 x thigh centre 4 cm below crotch; knee at 50% ankle->hip, centred in leg section; ankle centred in shin section'};

  // Symmetrize paired joints (A-pose is symmetric; raw values are logged).
  const pairs = [['armpitPt', arms], ['acromionPt', arms], ['shoulder', arms], ['elbow', arms], ['wrist', arms], ['handTip', arms], ['hip', legs], ['knee', legs], ['ankle', legs], ['toe', legs]];
  log.rawPaired = {};
  for (const [k, obj] of pairs) {
    const a = obj.L[k], b = obj.R[k];
    log.rawPaired[k] = {L: r3(a), R: r3(b)};
    const x = (a[0] - b[0]) / 2, y = (a[1] + b[1]) / 2, z = (a[2] + b[2]) / 2;
    obj.L[k] = [x, y, z]; obj.R[k] = [-x, y, z];
  }
  const spineZ = y => { const c = central(at(y)); return c.minZ + 0.42 * (c.maxZ - c.minZ); };
  const spineY = hipY + 0.30 * (neckBaseY - hipY), chestY = hipY + 0.66 * (neckBaseY - hipY);
  const neckC = central(at(neckMinY));
  const J = {
    Root: [0, 0, 0],
    Hips: [0, hipY, pelvisZ],
    Spine: [0, spineY, spineZ(spineY)],
    Chest: [0, chestY, spineZ(chestY)],
    Neck: [0, neckBaseY, neckC.bz - 0.01],
    Head: [0, headPivotY, neckC.bz],
    L_UpperArm: arms.L.shoulder, L_Forearm: arms.L.elbow, L_Hand: arms.L.wrist,
    R_UpperArm: arms.R.shoulder, R_Forearm: arms.R.elbow, R_Hand: arms.R.wrist,
    L_Thigh: legs.L.hip, L_Shin: legs.L.knee, L_Foot: legs.L.ankle,
    R_Thigh: legs.R.hip, R_Shin: legs.R.knee, R_Foot: legs.R.ankle,
  };
  for (const k in J) J[k] = r3(J[k]);
  const ends = {Head: r3([0, H, neckC.bz]), L_Hand: r3(arms.L.handTip), R_Hand: r3(arms.R.handTip), L_Foot: r3(legs.L.toe), R_Foot: r3(legs.R.toe)};
  const cut = {L: {A: r3(arms.L.armpitPt), T: r3(arms.L.acromionPt)}, R: {A: r3(arms.R.armpitPt), T: r3(arms.R.acromionPt)}};
  log.shoulderCutPlanes = {...cut, method: 'plane through armpit wall point A and acromion T, containing the front-back axis'};
  const heelZ = +(Math.min(foot.L.minZ, foot.R.minZ) + 0.01).toFixed(4);
  // torso wall profile (half-width of the central cluster per height) used to keep the arm
  // flood fill from leaking down the flank below the armpit
  const wall = {y0: +(crotchY - 0.1).toFixed(3), step, L: [], R: []};
  for (let y = crotchY - 0.1; y <= armpitY + 0.05; y += step) {
    const c = central(at(y)); wall.L.push(c ? +c.maxX.toFixed(4) : 0); wall.R.push(c ? +(-c.minX).toFixed(4) : 0);
  }
  const torso = {y0: 0.3, step, rows: []};
  for (let y = 0.3; y < H; y += step) { const c = central(at(y)); torso.rows.push(c ? [c.maxX - c.minX, c.maxZ - c.minZ, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2].map(v => +v.toFixed(4)) : null); }
  return {joints: J, ends, cut, heelZ, wall, torso, hipY, kneeY: J.L_Shin[1], ankleY, headY: J.Head[1], neckY: J.Neck[1], H, crotchY, armpitY, arms, legs, neckBaseY, log};
}

function median(a) { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s[s.length >> 1]; }
function dotSub(p, c, d) { return (p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1] + (p[2] - c[2]) * d[2]; }
function pointOnLineAtY(line, y) { const t = (y - line.center[1]) / line.dir[1]; return line.center.map((v, k) => v + t * line.dir[k]); }

function profileAlong(pos, ids, line) {
  const bins = new Map(); const ts = [];
  for (const i of ids) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const t = dotSub(p, line.center, line.dir);
    const q = line.center.map((v, k) => v + t * line.dir[k]);
    const r = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const k = Math.round(t / 0.01);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(r); ts.push(t);
  }
  ts.sort((a, b) => a - b);
  return {
    tTip: ts[Math.floor(ts.length * 0.998)],
    bins: [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, rs]) => { rs.sort((a, b) => a - b); return {t: k * 0.01, n: rs.length, r: rs[Math.floor(rs.length * 0.9)]}; }),
  };
}

function sectionCentroid(pos, ids, line, t0, half) {
  let s = [0, 0, 0], n = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const i of ids) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    if (Math.abs(dotSub(p, line.center, line.dir) - t0) > half) continue;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    n++;
  }
  if (!n) return line.center.map((v, k) => v + t0 * line.dir[k]);
  // bbox centre of the section, re-projected so it stays on the section plane
  s = lo.map((v, k) => (v + hi[k]) / 2);
  const dt = dotSub(s, line.center, line.dir) - t0;
  return s.map((v, k) => v - dt * line.dir[k]);
}

function surfaceTop(pos, x, z, rx, rz, yMin, yMax) {
  let top = -Infinity;
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    if (y < yMin || y > yMax) continue;
    if (Math.abs(pos[i * 3] - x) > rx || Math.abs(pos[i * 3 + 2] - z) > rz) continue;
    if (y > top) top = y;
  }
  return top;
}
