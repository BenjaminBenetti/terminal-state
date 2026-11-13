// Task studio-bb-models-20261112-234540-01: joints of the four BB bodies (toddler-sized baby-like creatures, variants lullaby /
// binky / teddy / changeling) on the SHARED 18-joint skeleton (zombie/lib/skeleton.mjs JOINTS: same names / hierarchy, identity
// rest rotations). The bind is the generated STANDING relaxed A-pose (the implementation lead's contract BB-ASSET-CONTRACT v1):
// legs apart, arms held clear of the trunk, head upright, +Z facing, feet midpoint at the origin, floor y = 0, metres, height
// 0.85 m to the top of the head (headwear included).
//
// Why landmarks: the shared detectors (zombie/lib/skeleton.mjs, enemy/lib/tpose-skeleton.mjs) place joints with ADULT ratios,
// and generic rules did not hold across these four bodies (a bonnet with frills, a bear hood with ears, puff sleeves, a vest
// hem, a quilted snowsuit whose thighs touch at the midline). So the joints that clothing hides are LANDMARKS measured once per
// body on gridded orthographic renders of the placed mesh (front / side / back, 2.5 cm grid; BB_LANDMARKS below): the shoulder
// joint (x, y), the armpit height, the crotch height, the Neck and Head joints and the skull sphere. Everything else is MEASURED
// on the welded mesh here, with logged rules:
//   shoulder z = the centre of the body's depth at the landmark (x, y);
//   arm centreline (per side, never mirrored) = tracked from the fingertip (the side's most lateral vertex) inward through slabs
//        perpendicular to the shoulder -> fingertip line: per plane the mesh's section points are split into 2-D clusters
//        (`arm.gapM` single linkage) and the cluster nearest the previous centre is the arm (centre = the middle of its extent,
//        lightly smoothed); wrist = the thinnest tracked section (p90 radius)
//        within +-`wristRefine` of `handFrac` of shoulder -> fingertip; elbow = the tracked centre at `elbowFrac` of shoulder ->
//        wrist;
//   feet / ankles: soles below `soleM`; ankle = 1 cm under the height where the leg's depth falls below `ankle.ratio` x the shin
//        depth (clamped), centred in the leg section;
//   hip = crotch + `hipAboveCrotch`, centred in the thigh section just below the crotch; knee = the landmark height when the
//        body shows its knee (patches / pads), else `kneeFrac` of ankle -> hip, centred in the leg section;
//   spine / chest: `spineFrac` / `chestFrac` of hips -> neck, z at `torsoZFrac` of the central depth from the back.
// Legs and arms are measured per side and kept as measured (each body keeps its own proportions).
export const BB_SKELETON_OPTIONS = {
  step: 0.005,
  arm: {stepM: 0.004, gapM: 0.008, maxRadiusM: 0.09, trackJumpM: 0.025, smooth: 2},
  elbowFrac: 0.5,
  handFrac: 0.27, wristRefine: 0.015,
  soleM: 0.012,
  ankle: {clamp: [0.03, 0.09], ratio: 1.3},
  hipAboveCrotch: 0.045,
  kneeFrac: 0.47,
  spineFrac: 0.36, chestFrac: 0.72, torsoZFrac: 0.48,
};

/**
 * Per-body landmarks, metres in the placed frame (0.85 m tall, +Z facing, +X = the character's left), read on gridded renders
 * of the placed raw mesh (front / side / back, 2.5 cm grid) and verified on joint-overlay renders:
 *   shoulder [x, y]: the glenohumeral joint (mirrored in x per side; z is measured), midway between the armpit and the shoulder
 *     top, just inside the trunk's outline;
 *   pitY: the armpit (the arm's underside meets the trunk);
 *   crotchY: the top of the gap between the legs (front and back views agree); kneeY (optional): knee pads / patches;
 *   neck / head: the Neck joint (the base of the neck at the collar) and the Head joint (the top of the neck under the skull,
 *     behind the jaw, ~ear-lobe height);
 *   skull: the head hit sphere (the cranium without bonnet frills, hood, bear ears or real ears).
 */
export const BB_LANDMARKS = {
  lullaby: {shoulder: [0.115, 0.540], pitY: 0.480, crotchY: 0.236, neck: [0, 0.595, -0.020], head: [0, 0.640, -0.030], skull: {centre: [0, 0.710, -0.032], radius: 0.088}},
  binky: {shoulder: [0.105, 0.580], pitY: 0.530, crotchY: 0.350, kneeY: 0.235, neck: [0, 0.645, 0.005], head: [0, 0.700, -0.002], skull: {centre: [0, 0.765, -0.015], radius: 0.083}},
  teddy: {shoulder: [0.110, 0.500], pitY: 0.455, crotchY: 0.258, neck: [0, 0.535, -0.020], head: [0, 0.580, -0.022], skull: {centre: [0, 0.670, -0.012], radius: 0.098}},
  changeling: {shoulder: [0.120, 0.550], pitY: 0.500, crotchY: 0.280, kneeY: 0.205, neck: [0, 0.600, -0.010], head: [0, 0.645, -0.020], skull: {centre: [-0.008, 0.745, -0.022], radius: 0.094}},
};

const r4 = v => Array.isArray(v) ? v.map(x => +(+x).toFixed(4)) : +(+v).toFixed(4);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const nrm = a => mul(a, 1 / (len(a) || 1));
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

/** Single-linkage clusters of 2-D points (grid hash, cell = gap). Returns arrays of input indices. */
function clusters2d(pts, gap) {
  const parent = pts.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const grid = new Map(), key = (a, b) => a * 73856093 ^ b * 19349663;
  pts.forEach((p, i) => { const gx = Math.floor(p[0] / gap), gy = Math.floor(p[1] / gap); const k = key(gx, gy); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  pts.forEach((p, i) => {
    const gx = Math.floor(p[0] / gap), gy = Math.floor(p[1] / gap);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(key(gx + dx, gy + dy)) || []) {
      if (j <= i || (pts[j][0] - p[0]) ** 2 + (pts[j][1] - p[1]) ** 2 > gap * gap) continue;
      const a = find(i), b = find(j); if (a !== b) parent[b] = a;
    }
  });
  const out = new Map(); pts.forEach((_, i) => { const r = find(i); (out.get(r) || out.set(r, []).get(r)).push(i); });
  return [...out.values()];
}

/**
 * @param mesh welded, placed body {pos, idx} in game space (+Z facing, feet at y = 0, metres)
 * @param L the body's BB_LANDMARKS entry
 * @returns joints (+ the zombie/lib/pose.mjs Rig ends / heelZ), the skin's inputs (arm centrelines + radius profiles, the
 *   shoulder cut points, crotch / hip / neck / head heights) and the contract measurements (head sphere, contacts, ends), + log.
 */
export function detectBbSkeleton(mesh, L, O = BB_SKELETON_OPTIONS) {
  if (!L) throw new Error('bb skeleton: landmarks required (BB_LANDMARKS entry)');
  const log = {landmarks: L};
  const P = mesh.pos, n = P.length / 3;
  const pt = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  let H = 0; for (let i = 0; i < n; i++) H = Math.max(H, P[i * 3 + 1]);
  if (Math.abs(H - 0.85) > 0.005) throw new Error(`bb skeleton: the landmarks are for a 0.85 m placement (got ${H})`);
  const nS = Math.ceil(H / O.step) + 1;
  const byY = Array.from({length: nS}, () => []);
  for (let i = 0; i < n; i++) byY[Math.min(nS - 1, Math.floor(P[i * 3 + 1] / O.step))].push(i);
  const slab = (y0, y1) => { const out = []; for (let s = Math.max(0, Math.floor(y0 / O.step)); s <= Math.min(nS - 1, Math.floor(y1 / O.step)); s++) for (const i of byY[s]) { const y = P[i * 3 + 1]; if (y >= y0 && y < y1) out.push(i); } return out; };
  const depthMid = (x, y, hx = 0.012, hy = 0.008) => { const ids = slab(y - hy, y + hy).filter(i => Math.abs(P[i * 3] - x) < hx); if (ids.length < 3) return NaN; const zs = ids.map(i => P[i * 3 + 2]); return (Math.min(...zs) + Math.max(...zs)) / 2; };

  // ---------------------------------------------------------------- arms
  const arms = {};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    const S = [sg * L.shoulder[0], L.shoulder[1], depthMid(sg * L.shoulder[0], L.shoulder[1])];
    let tipI = -1; for (let i = 0; i < n; i++) if (tipI < 0 || sg * P[i * 3] > sg * P[tipI * 3]) tipI = i;
    const tip = pt(tipI), u = nrm(sub(tip, S)), Lfull = dot(sub(tip, S), u);
    const e1 = nrm(cross(u, [0, 0, 1])), e2 = cross(u, e1);
    // cross-sections of the MESH (triangle / plane intersections, not vertices: these low-poly bodies have few vertices per
    // slab) by planes perpendicular to the shoulder -> fingertip line every `stepM`, inward from the fingertip. Section points
    // (segment ends + midpoints) are split into 2-D single-linkage clusters (`gapM`: touching cloth shells join their limb);
    // the arm is the cluster nearest the previous centre; its centre = the middle of its 2-D extent
    const I = mesh.idx, tv = new Float32Array(n), near = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const q = sub(pt(i), S); tv[i] = dot(q, u); near[i] = sg * P[i * 3] > 0 && len(sub(q, mul(u, tv[i]))) < O.arm.maxRadiusM ? 1 : 0; }
    const tris = []; for (let t = 0; t < I.length; t += 3) if (near[I[t]] && near[I[t + 1]] && near[I[t + 2]]) tris.push(t);
    const section = tc => {
      const out = [];
      for (const t of tris) {
        const seg = [];
        for (let k = 0; k < 3; k++) {
          const ia = I[t + k], ib = I[t + (k + 1) % 3], da = tv[ia] - tc, db = tv[ib] - tc;
          if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) { const f = da / (da - db); const q = sub(add(pt(ia), mul(sub(pt(ib), pt(ia)), f)), S); seg.push([dot(q, e1), dot(q, e2)]); }
        }
        if (seg.length === 2) for (const f of [0, 0.5, 1]) out.push([seg[0][0] + (seg[1][0] - seg[0][0]) * f, seg[0][1] + (seg[1][1] - seg[0][1]) * f]);
      }
      return out;
    };
    const tip2 = (() => { const q = sub(tip, S); return [dot(q, e1), dot(q, e2)]; })();
    const track = [];
    let prev = null;
    for (let tc = Lfull - 0.006; tc > -0.005; tc -= O.arm.stepM) {
      const sp = section(tc);
      if (sp.length < 6) continue;
      const cl = clusters2d(sp, O.arm.gapM).filter(c => c.length >= 6).map(c => {
        const xs = c.map(j => sp[j][0]), ys = c.map(j => sp[j][1]);
        return {c, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, ext: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))};
      });
      let best = null;
      const ref = prev || {cx: tip2[0], cy: tip2[1]};
      for (const x of cl) { const d = Math.hypot(x.cx - ref.cx, x.cy - ref.cy); if (d < (prev ? O.arm.trackJumpM : 0.05) && (!best || d < best.d)) best = {...x, d}; }
      if (!best) continue;
      const rs = best.c.map(j => Math.hypot(sp[j][0] - best.cx, sp[j][1] - best.cy));
      track.push({t: tc, cx: best.cx, cy: best.cy, r90: pct(rs, 0.9), ext: best.ext, count: best.c.length});
      prev = best;
    }
    // light smoothing of the centreline (moving average over +-`smooth` samples), then 3-D centres
    for (let q = 0; q < track.length; q++) {
      const w = track.slice(Math.max(0, q - O.arm.smooth), q + O.arm.smooth + 1);
      track[q].sx = w.reduce((a, e) => a + e.cx, 0) / w.length; track[q].sy = w.reduce((a, e) => a + e.cy, 0) / w.length;
    }
    for (const e of track) e.cen = add(add(S, mul(u, e.t)), add(mul(e1, e.sx), mul(e2, e.sy)));
    track.sort((a, b) => a.t - b.t);
    const at = t => { let best = null; for (const e of track) if (!best || Math.abs(e.t - t) < Math.abs(best.t - t)) best = e; return best; };
    const wristT0 = O.handFrac > 0 ? Lfull - O.handFrac * Lfull : Lfull;
    let wristT = wristT0, wristR = Infinity;
    for (const e of track) if (Math.abs(e.t - wristT0) <= O.wristRefine && e.r90 < wristR) { wristR = e.r90; wristT = e.t; }
    const wrist = at(wristT).cen;
    const elbowT = O.elbowFrac * wristT;
    const elbow = at(elbowT).cen;
    // the clear arm's section radius (median over the elbow -> wrist half and the outer upper arm), for the skin's radius test
    const clearR = median(track.filter(e => e.t > 0.3 * wristT && e.t < 0.95 * wristT).map(e => e.r90));
    arms[side] = {sg, S, tip, tipI, u, Lfull, track: track.map(e => ({t: e.t, cen: e.cen, r90: e.r90, ext: e.ext, count: e.count})), elbow, wrist, wristT, elbowT, wristR, clearR,
      pit: [sg * (L.shoulder[0] + 0.01), L.pitY, S[2]], top: [sg * (L.shoulder[0] - 0.015), L.shoulder[1] + 0.045, S[2]]};
    log['arm' + side] = {shoulder: r4(S), tip: r4(tip), axis: r4(u), lengthToTip: r4(Lfull), tracked: track.length, clearRadiusP90: r4(clearR), wristRadiusP90: r4(wristR),
      elbow: r4(elbow), wrist: r4(wrist), lengths: {upper: r4(len(sub(elbow, S))), fore: r4(len(sub(wrist, elbow))), hand: r4(len(sub(tip, wrist)))}};
  }

  // ---------------------------------------------------------------- legs
  const legPts = (y0, y1, side) => slab(y0, y1).filter(i => (side === 'L' ? P[i * 3] > 0 : P[i * 3] < 0) && Math.abs(P[i * 3]) < 0.2);
  const feet = {};
  for (const side of ['L', 'R']) {
    const ids = legPts(0, O.soleM + 0.002, side);
    if (ids.length < 4) throw new Error(`bb skeleton: no ${side} sole`);
    const zs = ids.map(i => P[i * 3 + 2]), xs = ids.map(i => P[i * 3]);
    feet[side] = {x: (Math.min(...xs) + Math.max(...xs)) / 2, toeZ: Math.max(...zs), heelZ: Math.min(...zs)};
  }
  const depthAt = (y, side) => { const ids = legPts(y - 0.004, y + 0.004, side); if (ids.length < 4) return NaN; const zs = ids.map(i => P[i * 3 + 2]); return Math.max(...zs) - Math.min(...zs); };
  const centreLeg = (y, side, half = 0.006) => { for (const h of [half, 0.015, 0.03]) { const ids = legPts(y - h, y + h, side); if (ids.length < 3) continue; const xs = ids.map(i => P[i * 3]), zs = ids.map(i => P[i * 3 + 2]); return [(Math.min(...xs) + Math.max(...xs)) / 2, y, (Math.min(...zs) + Math.max(...zs)) / 2]; } throw new Error(`bb skeleton: no ${side} leg section at ${y}`); };
  const crotchY = L.crotchY, hipY = crotchY + O.hipAboveCrotch;
  const legJ = {};
  for (const side of ['L', 'R']) {
    const shinDepth = median([0.1, 0.12, 0.14].map(y => depthAt(y, side)));
    let trans = O.ankle.clamp[1];
    for (let y = 0.012; y < 0.12; y += O.step) if (depthAt(y, side) < O.ankle.ratio * shinDepth) { trans = y; break; }
    const ankleY = Math.min(O.ankle.clamp[1], Math.max(O.ankle.clamp[0], trans - 0.01));
    const ankle = centreLeg(ankleY + 0.01, side); ankle[1] = ankleY;
    const thighC = centreLeg(crotchY - 0.03, side, 0.008);
    const hip = [thighC[0], hipY, thighC[2]];
    const kneeY = L.kneeY ?? ankleY + O.kneeFrac * (hipY - ankleY);
    const knee = centreLeg(kneeY, side);
    legJ[side] = {ankle, knee, hip};
    log['leg' + side] = {sole: {x: r4(feet[side].x), toeZ: r4(feet[side].toeZ), heelZ: r4(feet[side].heelZ)}, shinDepth: r4(shinDepth), ankleTransitionY: r4(trans), ankle: r4(ankle), knee: r4(knee), hip: r4(hip), kneeFrom: L.kneeY != null ? 'landmark' : 'kneeFrac'};
  }

  // ---------------------------------------------------------------- spine
  const trunkDepth = y => { const ids = slab(y - 0.01, y + 0.01).filter(i => Math.abs(P[i * 3]) < 0.05); if (ids.length < 8) return null; const zs = ids.map(i => P[i * 3 + 2]); return {z0: pct(zs, 0.03), z1: pct(zs, 0.97)}; };
  const torsoZ = y => { const t = trunkDepth(y); return t ? t.z0 + O.torsoZFrac * (t.z1 - t.z0) : NaN; };
  const hipsZ = (legJ.L.hip[2] + legJ.R.hip[2]) / 2;
  const neckY = L.neck[1];
  const spineY = hipY + O.spineFrac * (neckY - hipY), chestY = hipY + O.chestFrac * (neckY - hipY);
  const joints = {
    Root: [0, 0, 0],
    Hips: [0, hipY, hipsZ],
    Spine: [0, spineY, torsoZ(spineY)],
    Chest: [0, chestY, torsoZ(chestY)],
    Neck: [...L.neck],
    Head: [...L.head],
  };
  for (const s of ['L', 'R']) {
    joints[s + '_UpperArm'] = arms[s].S; joints[s + '_Forearm'] = arms[s].elbow; joints[s + '_Hand'] = arms[s].wrist;
    joints[s + '_Thigh'] = legJ[s].hip; joints[s + '_Shin'] = legJ[s].knee; joints[s + '_Foot'] = legJ[s].ankle;
  }
  for (const [nm, v] of Object.entries(joints)) if (!v.every(Number.isFinite)) throw new Error(`bb skeleton: joint ${nm} not finite ${JSON.stringify(v)}`);
  for (const nm of Object.keys(joints)) joints[nm] = r4(joints[nm]);

  // ---------------------------------------------------------------- contract measurements
  // crown: the highest vertex over the skull centre's column (headwear included: the 0.85 m height)
  const sc = L.skull.centre;
  const crownIds = slab(sc[1], H + 1).filter(i => Math.hypot(P[i * 3] - sc[0], P[i * 3 + 2] - sc[2]) < 0.04);
  const crownY = Math.max(...crownIds.map(i => P[i * 3 + 1]));
  const ends = {Head: r4([sc[0] - joints.Head[0], crownY - joints.Head[1], sc[2] - joints.Head[2]])};
  const contact = {palm: {}, kneeFront: {}, toe: {}, heel: {}};
  for (const s of ['L', 'R']) {
    const A = arms[s], wr = joints[s + '_Hand'];
    ends[s + '_Hand'] = r4(sub(A.tip, wr));
    // palm: the hand's skin on its down / in side, at 40 % of wrist -> fingertip (palms face down and in in the bind)
    const hu = nrm(sub(A.tip, wr));
    let pn = sub([-A.sg * 0.5, -1, 0], mul(hu, dot([-A.sg * 0.5, -1, 0], hu))); pn = nrm(pn);
    const pc = add(wr, mul(sub(A.tip, wr), 0.4));
    const hand = []; for (let i = 0; i < n; i++) { const q = sub(pt(i), pc); if (Math.abs(dot(q, hu)) < 0.01 && len(sub(q, mul(hu, dot(q, hu)))) < 0.05) hand.push(i); }
    const reach = hand.length ? Math.max(...hand.map(i => dot(sub(pt(i), pc), pn))) : 0;
    contact.palm[s] = r4(sub(add(pc, mul(pn, reach)), wr));
    const kn = joints[s + '_Shin'], kIds = legPts(kn[1] - 0.008, kn[1] + 0.008, s);
    contact.kneeFront[s] = r4(Math.max(...kIds.map(i => P[i * 3 + 2])) - kn[2]);
    const an = joints[s + '_Foot'], fIds = legPts(0, an[1], s);
    let toe = null, heel = null;
    for (const i of fIds) { const p = pt(i); if (!toe || p[2] > toe[2]) toe = p; if (!heel || p[2] < heel[2]) heel = p; }
    toe = [toe[0], 0, toe[2]]; heel = [heel[0], 0, heel[2]];
    contact.toe[s] = r4(sub(toe, an)); contact.heel[s] = r4(sub(heel, an));
    ends[s + '_Foot'] = r4(sub(toe, an));
  }
  log.crown = {y: r4(crownY)};
  log.spine = {hips: joints.Hips, spine: joints.Spine, chest: joints.Chest};
  // zombie/lib/pose.mjs Rig reads ends.<side>_Foot as the toe tip in MODEL space and heelZ (model z of the heel)
  const rigEnds = {...ends, L_Foot: r4(add(joints.L_Foot, contact.toe.L)), R_Foot: r4(add(joints.R_Foot, contact.toe.R)),
    Head: r4(add(joints.Head, ends.Head)), L_Hand: r4(arms.L.tip), R_Hand: r4(arms.R.tip)};
  return {
    H: r4(H), joints, ends: rigEnds, endsRel: ends, heelZ: r4(Math.max(feet.L.heelZ, feet.R.heelZ)), crotchY: r4(crotchY), hipY: r4(hipY), neckY: r4(neckY), headY: r4(L.head[1]), crownY: r4(crownY),
    head: {centre: r4(sc), radius: r4(L.skull.radius)}, contact, arms, log, options: O,
  };
}
