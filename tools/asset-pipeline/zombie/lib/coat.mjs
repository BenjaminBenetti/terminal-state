// Coat stage: fit the separately generated empty coat onto the body, bake it, retarget its
// sleeves onto the body's arm bones and skin it to the SAME skeleton.
//  1. global fit (per-axis scale + translation) from measured landmarks: coat armpit -> body
//     armpit - 3.5 cm, hem -> just below the knee joint, torso width/depth with ease;
//  2. simplify / unwrap / bake in that space (same as the body);
//  3. measure the coat's own sleeve "fit skeleton" (shoulder pivot from the yoke corner, cuff),
//     skin the coat to it, then deform with per-bone maps fit-bone -> body-bone (rotation + length
//     scale along the bone). The shoulder blend keeps the deformation continuous;
//  4. the same weights then drive the coat with the body skeleton.
import {loadMaster} from './master.mjs';
import {buildGrid} from './bake.mjs';
import {vertexAdjacency, faceNormalsAreas} from './mesh.mjs';
import {similarity, rotateNormals, bounds, weldByPosition, computeNormals} from './mesh.mjs';
import {lowPolyAndBake, scaleAbout} from './stage-mesh.mjs';
import {bucketByHeight, clusterXZ, summarize, fitLine} from './slices.mjs';
import {computeSkinWeights, transferWeights, JOINT_NAMES} from './skin.mjs';
import {frameRot, qRot, V} from './pose.mjs';

const r3 = v => v.map(x => +x.toFixed(4));

/** Landmarks of a garment (or body) from horizontal slices: hem, top, sleeves, yoke corner. */
export function measureGarment(pos, {neckHalf = 0.07} = {}) {
  const n = pos.length / 3;
  let y0 = Infinity, H = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, pos[i * 3 + 1]); H = Math.max(H, pos[i * 3 + 1]); }
  const step = 0.01;
  const {buckets} = bucketByHeight(pos, y0, H + step, step);
  const slices = buckets.map((b, k) => ({y: y0 + (k + 0.5) * step, clusters: clusterXZ(pos, b, 0.02, 5)}));
  const at = y => slices[Math.max(0, Math.min(slices.length - 1, Math.floor((y - y0) / step)))];
  const central = s => s.clusters.reduce((best, c) => (c.minX <= 0.03 && c.maxX >= -0.03 && (!best || c.count > best.count)) ? c : best, null);
  const sleeves = {L: [], R: []};
  for (const s of slices) {
    const c0 = central(s); if (!c0) continue;
    for (const c of s.clusters) { if (c === c0) continue; if (c.minX > c0.maxX) sleeves.L.push({y: s.y, c}); else if (c.maxX < c0.minX) sleeves.R.push({y: s.y, c}); }
  }
  const out = {hemY: y0, topY: H, sides: {}, slices, central, at};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    // contiguous run of slices hanging from the armpit (largest separate cluster per slice);
    // drops hem fringe fragments that are also "separate" from the central cluster
    const bySlice = new Map();
    for (const a of sleeves[side]) { const k = Math.round(a.y / step); if (!bySlice.has(k) || bySlice.get(k).c.count < a.c.count) bySlice.set(k, a); }
    const ks = [...bySlice.keys()].sort((a, b) => b - a);
    const runs = [];
    for (const k of ks) { const r = runs[runs.length - 1]; if (r && r.last - k <= 2) { r.items.push(bySlice.get(k)); r.last = k; } else runs.push({last: k, items: [bySlice.get(k)]}); }
    const list = runs.sort((a, b) => b.items.length - a.items.length)[0].items; // longest run = the sleeve
    const armpitY = Math.max(...list.map(a => a.y));
    const ids = list.flatMap(a => a.c.ids);
    let line = fitLine(list.filter(a => a.y <= armpitY - 0.02).map(a => [a.c.bx, a.y, a.c.bz]));
    if (line.dir[0] * sg < 0) line.dir = line.dir.map(v => -v);
    let tMax = -Infinity;
    for (const i of ids) tMax = Math.max(tMax, (pos[i * 3] - line.center[0]) * line.dir[0] + (pos[i * 3 + 1] - line.center[1]) * line.dir[1] + (pos[i * 3 + 2] - line.center[2]) * line.dir[2]);
    // cuff opening centre: bbox centre of the last 3 cm of the sleeve along its axis
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of ids) {
      const t = (pos[i * 3] - line.center[0]) * line.dir[0] + (pos[i * 3 + 1] - line.center[1]) * line.dir[1] + (pos[i * 3 + 2] - line.center[2]) * line.dir[2];
      if (t < tMax - 0.03) continue;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i * 3 + k]); hi[k] = Math.max(hi[k], pos[i * 3 + k]); }
    }
    const cuff = lo.map((v, k) => (v + hi[k]) / 2);
    // yoke corner ("acromion"): walk the top-surface profile from the sleeve inward and stop at
    // the first flattening (searching from outside avoids the hood/collar behind the neck)
    const yProbe = armpitY + 0.12;
    const zc = line.center[2] + ((yProbe - line.center[1]) / line.dir[1]) * line.dir[2];
    const tops = [];
    for (let k = 0; k < 45; k++) {
      const x = neckHalf + k * 0.01; let top = -Infinity;
      for (let i = 0; i < n; i++) { if (Math.abs(sg * pos[i * 3] - x) > 0.005 || Math.abs(pos[i * 3 + 2] - zc) > 0.08) continue; if (pos[i * 3 + 1] > top) top = pos[i * 3 + 1]; }
      tops.push({x, top});
    }
    const xOut = Math.abs(line.center[0] + ((armpitY + 0.03 - line.center[1]) / line.dir[1]) * line.dir[0]);
    let kOut = tops.findIndex(t => t.x >= xOut); if (kOut < 0) kOut = tops.length - 4;
    let acr = null;
    for (let k = Math.min(kOut, tops.length - 4); k >= 0; k--) {
      if (!Number.isFinite(tops[k].top) || !Number.isFinite(tops[k + 3].top)) continue;
      if ((tops[k + 3].top - tops[k].top) / 0.03 > -0.6) { acr = tops[k + 1]; break; }
    }
    const wallC = central(at(armpitY - 0.015));
    out.sides[side] = {armpitY, line, ids, tMax, cuff, acromion: acr ? [sg * acr.x, acr.top, zc] : null, armpitPt: [sg > 0 ? wallC.maxX : wallC.minX, armpitY, zc], tops};
  }
  return out;
}

function torsoAt(skel, y) {
  const T = skel.torso; const k = Math.max(0, Math.min(T.rows.length - 1, Math.round((y - T.y0) / T.step)));
  const [w, d, cx, cz] = T.rows[k]; return {w, d, cx, cz};
}
function torsoStats(G, y) { const c = G.central(G.at(y)); return c ? {w: c.maxX - c.minX, d: c.maxZ - c.minZ, cx: (c.minX + c.maxX) / 2, cz: (c.minZ + c.maxZ) / 2, minZ: c.minZ, maxZ: c.maxZ} : null; }

export async function buildCoat({skel, rigDesc, options, skinOptions, cached, bodyWelded, bodyWeights}) {
  const stage = await cached('coat', async () => {
    const m = await loadMaster('coat');
    const b = bounds(m.pos);
    // nominal space: face +Z, 1.2 units tall, hem at 0, centred in x/z on the bbox
    const s0 = 1.2 / (b.max[1] - b.min[1]);
    const nominal = {scale: s0, pivot: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2], flipFacing: true, offset: [0, 0, 0]};
    const posN = similarity(m.pos, nominal);
    const nrmN = rotateNormals(m.nrm, true);
    const G = measureGarment(weldByPosition(posN, nrmN, m.idx).pos);
    const coatArmpit = (G.sides.L.armpitY + G.sides.R.armpitY) / 2;
    // ---- global fit
    const bodyArmpit = skel.armpitY, hemTarget = skel.kneeY - 0.035;
    const armpitTarget = bodyArmpit - 0.035;
    const sy = (armpitTarget - hemTarget) / (coatArmpit - G.hemY);
    const ty = hemTarget - G.hemY * sy;
    const level = coatArmpit - 0.08 * (coatArmpit - G.hemY);
    const bodyLevel = level * sy + ty;
    const cs = torsoStats(G, level);
    const bs = torsoAt(skel, bodyLevel);
    let sx = Math.min(1.0 * sy, Math.max(0.8 * sy, (bs.w * 1.18 + 0.02) / cs.w));
    let sz = Math.min(1.0 * sy, Math.max(0.7 * sy, (bs.d + 0.07) / cs.d));
    const tx = -cs.cx * sx;
    const tz = bs.cz - cs.cz * sz;
    const fit = {nominal: {scale: +s0.toFixed(6), pivot: r3(nominal.pivot), flipFacing: true}, scale: r3([sx, sy, sz]), translate: r3([tx, ty, tz]),
      landmarks: {coatArmpitNominal: +coatArmpit.toFixed(4), coatHemNominal: +G.hemY.toFixed(4), coatTopNominal: +G.topY.toFixed(4), bodyArmpit: +bodyArmpit.toFixed(4), armpitTarget: +armpitTarget.toFixed(4), hemTarget: +hemTarget.toFixed(4),
        level: {coatNominalY: +level.toFixed(4), bodyY: +bodyLevel.toFixed(4), coatWidth: +cs.w.toFixed(4), coatDepth: +cs.d.toFixed(4), bodyWidth: +bs.w.toFixed(4), bodyDepth: +bs.d.toFixed(4)}},
      method: 'per-axis scale+translate: coat armpit -> body armpit - 3.5 cm, hem -> knee joint - 3.5 cm; width = 1.18 x body + 2 cm, depth = body + 7 cm (clamped to 0.8-1.0 / 0.7-1.0 of vertical scale); centred on the body chest'};
    const posG = scaleAbout(posN, [sx, sy, sz], [0, 0, 0], [tx, ty, tz]);
    // normals under non-uniform scale: n' ~ n / s
    const nrmG = new Float32Array(nrmN.length);
    for (let i = 0; i < nrmN.length; i += 3) { const x = nrmN[i] / sx, y = nrmN[i + 1] / sy, z = nrmN[i + 2] / sz, l = Math.hypot(x, y, z) || 1; nrmG[i] = x / l; nrmG[i + 1] = y / l; nrmG[i + 2] = z / l; }
    const high = {pos: posG, nrm: nrmG, uv: m.uv, idx: m.idx};
    const O = options;
    const r = await lowPolyAndBake(high, m, {targetTris: O.targetTris, faceRegion: () => ({region: 0, density: 1}), unwrapOpts: O.unwrap, bakeSize: O.bake.size, bakeOpts: {cage: O.bake.cage, rayBelow: O.bake.rayBelow}, baseSize: O.textures.baseColor, mrSize: O.textures.metallicRoughness, quality: O.textures.jpegQuality});
    // garment landmarks in game space (from the fitted high-poly)
    const Gg = measureGarment(weldByPosition(posG, nrmG, m.idx).pos);
    const sides = {};
    for (const s of ['L', 'R']) { const {ids, line, slices, tops, ...rest} = Gg.sides[s]; sides[s] = {...rest, line: {center: line.center, dir: line.dir}}; }
    const wall = {y0: +(Gg.hemY).toFixed(3), step: 0.01, L: [], R: []};
    for (let y = Gg.hemY; y <= Math.max(Gg.sides.L.armpitY, Gg.sides.R.armpitY) + 0.05; y += 0.01) { const c = Gg.central(Gg.at(y)); wall.L.push(c ? +c.maxX.toFixed(4) : 0); wall.R.push(c ? +(-c.minX).toFixed(4) : 0); }
    return {fit, low: r.low, enc: r.enc, stats: r.stats, garment: {hemY: Gg.hemY, topY: Gg.topY, sides, wall},
      master: {id: m.id, uploadId: m.uploadId, file: m.file, sha256: m.sha256Verified, bytes: m.bytes, triangles: m.triangles, vertices: m.vertices, material: m.material, textures: {baseColor: [m.baseColor.width, m.baseColor.height, m.baseColor.mimeType], metallicRoughness: [m.metallicRoughness.width, m.metallicRoughness.height, m.metallicRoughness.mimeType]}}};
  });

  // ---- coat fit-skeleton (its own sleeves) and retarget onto the body skeleton
  const J = skel.joints, gs = stage.garment.sides;
  const fitJoints = {...J}, fitEnds = {...skel.ends}, fitCut = {};
  const retarget = {};
  for (const s of ['L', 'R']) {
    const g = gs[s], sg = s === 'L' ? 1 : -1;
    // The globally fitted coat already surrounds the body's shoulder, so the sleeve pivots at the
    // BODY shoulder joint; only sleeve direction and length are retargeted (yoke-corner detection
    // on the coat is unreliable next to the hood/collar). Coat wrist = cuff opening centre.
    // The measurable (separated) part of the sleeve is its forearm part; its axis passes within a
    // few mm of the body's elbow. Fit joints: shoulder = body shoulder (the globally fitted yoke
    // already surrounds it), elbow = closest point of the sleeve axis to the body elbow,
    // wrist = cuff opening centre. The upper sleeve maps ~identity, the forearm part is re-aimed.
    const bS = J[s + '_UpperArm'], bE = J[s + '_Forearm'];
    const sh = bS;
    const elbow = V.add(g.line.center, V.mul(g.line.dir, V.dot(V.sub(bE, g.line.center), g.line.dir)));
    const wrist = V.sub(g.cuff, V.mul(g.line.dir, 0.015));
    fitJoints[s + '_UpperArm'] = sh; fitJoints[s + '_Forearm'] = elbow; fitJoints[s + '_Hand'] = wrist;
    fitEnds[s + '_Hand'] = V.add(g.cuff, V.mul(g.line.dir, 0.02));
    const A = [g.armpitPt[0], g.armpitPt[1], sh[2]];
    fitCut[s] = {A, T: [A[0] + sg * 0.02, A[1] + 0.3, sh[2]]};
    // body targets: coat wrist lands 2 cm past the body wrist (cuff covers the wrist)
    const bSh = J[s + '_UpperArm'], bEl = J[s + '_Forearm'], bWr = J[s + '_Hand'];
    const bWrist = V.add(bWr, V.mul(V.norm(V.sub(bWr, bEl)), 0.02));
    retarget[s] = {fitElbowOffsetFromBodyElbow: r3(V.sub(elbow, bE)), fitShoulder: r3(sh), fitElbow: r3(elbow), fitWrist: r3(wrist), bodyShoulder: bSh, bodyElbow: bEl, bodyWristTarget: r3(bWrist), cuff: r3(g.cuff), sleeveAxis: r3(g.line.dir), coatArmpit: r3(A)};
  }
  const fitRig = {...rigDesc, joints: fitJoints, ends: fitEnds, cut: fitCut, wall: stage.garment.wall, wallMargin: 0.01};
  const sw = computeSkinWeights(stage.low.welded, fitRig, {kind: 'coat', coatThighMax: options.thighFollow, ...skinOptions});

  // per-bone maps fit -> body (rotation between bone directions + scale along the bone)
  const maps = {};
  for (const s of ['L', 'R']) {
    const R = retarget[s];
    const seg = (a0, a1, b0, b1) => {
      const d0 = V.sub(a1, a0), d1 = V.sub(b1, b0), L0 = V.len(d0), L1 = V.len(d1);
      const u0 = V.norm(d0), u1 = V.norm(d1);
      const side = [0, 0, 1];
      const q = frameRot(u0, V.cross(u0, side), u1, V.cross(u1, side));
      return {a0, b0, u0, k: L1 / L0, q};
    };
    maps[s + '_UpperArm'] = seg(R.fitShoulder, R.fitElbow, R.bodyShoulder, R.bodyElbow);
    maps[s + '_Forearm'] = seg(R.fitElbow, R.fitWrist, R.bodyElbow, R.bodyWristTarget);
    maps[s + '_Hand'] = {...maps[s + '_Forearm']};
    R.upperArmScale = +maps[s + '_UpperArm'].k.toFixed(4); R.forearmScale = +maps[s + '_Forearm'].k.toFixed(4);
  }
  const apply = (name, p) => {
    const M = maps[name]; if (!M) return p;
    const d = V.sub(p, M.a0);
    const along = V.dot(d, M.u0);
    const scaled = V.add(d, V.mul(M.u0, along * (M.k - 1)));
    return V.add(M.b0, qRot(M.q, scaled));
  };
  const W = stage.low.welded, nw = W.pos.length / 3;
  // back-drape taper: the reconstruction flares the back panel like a cape; pull coat points
  // that lie behind the body's back surface toward it, more strongly toward the hem
  const tp = options.backTaper;
  const backZ = y => { const T = skel.torso; let k = Math.round((Math.max(y, skel.hipY) - T.y0) / T.step); k = Math.max(0, Math.min(T.rows.length - 1, k)); while (k < T.rows.length - 1 && !T.rows[k]) k++; const [, d, , cz] = T.rows[k]; return cz - d / 2; };
  const taperPos = new Float32Array(W.pos);
  let tapered = 0;
  for (let i = 0; i < nw; i++) {
    const y = taperPos[i * 3 + 1], z = taperPos[i * 3 + 2];
    const zb = backZ(y) - tp.clearance;
    if (z >= zb) continue;
    const yFull = skel.hipY; // full taper at and below the hip joint, none above fullAboveY
    const k = 1 - (1 - tp.hemFactor) * (1 - Math.min(1, Math.max(0, (y - yFull) / (tp.fullAboveY - yFull))));
    taperPos[i * 3 + 2] = zb + (z - zb) * k; tapered++;
  }
  const def = new Float32Array(W.pos.length);
  for (let i = 0; i < nw; i++) {
    const p = [taperPos[i * 3], taperPos[i * 3 + 1], taperPos[i * 3 + 2]];
    let acc = [0, 0, 0];
    for (let k = 0; k < 4; k++) { const w = sw.weights[i * 4 + k]; if (!w) continue; acc = V.add(acc, V.mul(apply(JOINT_NAMES[sw.joints[i * 4 + k]], p), w)); }
    def[i * 3] = acc[0]; def[i * 3 + 1] = acc[1]; def[i * 3 + 2] = acc[2];
  }
  const push = pushOut(def, W.idx, bodyWelded, options.pushOut);
  const dn = computeNormals(def, W.idx);
  // final coat weights: transfer from the skinned body onto the fitted/retargeted coat
  const tw = transferWeights({pos: def, idx: W.idx}, bodyWelded, bodyWeights, rigDesc, {thighMax: options.thighFollow, smoothIters: 3, grid: buildGrid(bodyWelded.pos, bodyWelded.idx, 0.03)});
  const low = stage.low, n = low.weldId.length;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = low.weldId[i];
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = def[s * 3 + k]; nrm[i * 3 + k] = dn[s * 3 + k]; }
    for (let k = 0; k < 4; k++) { joints[i * 4 + k] = tw.joints[s * 4 + k]; weights[i * 4 + k] = tw.weights[s * 4 + k]; }
  }
  return {...stage, low: {...low, pos, nrm}, joints, weights, skinStats: {fitSkeletonWeights: sw.stats, final: tw.stats}, retarget, pushOut: push, backTaper: {...tp, verticesTapered: tapered}, fitJoints: Object.fromEntries(Object.entries(fitJoints).map(([k, v]) => [k, r3(v)]))};
}

/** Closest point on triangle (Ericson) -> [point, faceIndex] helper for push-out. */
function closestOnTri(p, a, b, c) {
  const ab = V.sub(b, a), ac = V.sub(c, a), ap = V.sub(p, a);
  const d1 = V.dot(ab, ap), d2 = V.dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = V.sub(p, b), d3 = V.dot(ab, bp), d4 = V.dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return V.add(a, V.mul(ab, d1 / (d1 - d3)));
  const cp = V.sub(p, c), d5 = V.dot(ab, cp), d6 = V.dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return V.add(a, V.mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return V.add(b, V.mul(V.sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const den = 1 / (va + vb + vc);
  return V.add(a, V.add(V.mul(ab, vb * den), V.mul(ac, vc * den)));
}

/**
 * Bind-pose collision pass: coat vertices inside the body (or closer than `margin` outside it)
 * are pushed out along the body surface normal; the displacement is diffused over the coat mesh
 * so the fix does not crease the cloth. Mutates pos in place.
 */
export function pushOut(pos, idx, body, {margin = 0.012, radius = 0.06, rounds = 4, smoothIters = 6} = {}) {
  const grid = buildGrid(body.pos, body.idx, 0.03);
  const {FN} = faceNormalsAreas(body.pos, body.idx);
  const n = pos.length / 3;
  const {offs, adj} = vertexAdjacency(n, idx);
  const bp = i => [body.pos[i * 3], body.pos[i * 3 + 1], body.pos[i * 3 + 2]];
  const query = p => {
    const c = [0, 1, 2].map(k => Math.floor((p[k] - grid.min[k]) / grid.cell));
    let best = null, bd = radius;
    for (let z = c[2] - 2; z <= c[2] + 2; z++) for (let y = c[1] - 2; y <= c[1] + 2; y++) for (let x = c[0] - 2; x <= c[0] + 2; x++) {
      if (x < 0 || y < 0 || z < 0 || x >= grid.dims[0] || y >= grid.dims[1] || z >= grid.dims[2]) continue;
      const ci = (z * grid.dims[1] + y) * grid.dims[0] + x;
      for (let k = grid.start[ci]; k < grid.start[ci + 1]; k++) {
        const t = grid.tris[k];
        const q = closestOnTri(p, bp(body.idx[t * 3]), bp(body.idx[t * 3 + 1]), bp(body.idx[t * 3 + 2]));
        const d = V.len(V.sub(p, q));
        if (d < bd) { bd = d; best = {q, n: [FN[t * 3], FN[t * 3 + 1], FN[t * 3 + 2]], d}; }
      }
    }
    return best;
  };
  let inside0 = 0, maxPush = 0, pushed = 0;
  const total = new Float32Array(n * 3);
  for (let r = 0; r < rounds; r++) {
    const disp = new Float32Array(n * 3);
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const hit = query(p);
      if (!hit) continue;
      const signed = V.dot(V.sub(p, hit.q), hit.n);
      if (signed >= margin) continue;
      if (r === 0 && signed < 0) inside0++;
      const need = margin - signed;
      disp[i * 3] = hit.n[0] * need; disp[i * 3 + 1] = hit.n[1] * need; disp[i * 3 + 2] = hit.n[2] * need;
      cnt++;
    }
    if (!cnt) break;
    // diffuse: neighbours of pushed vertices move partially too (keeps the cloth smooth)
    let D = disp;
    for (let it = 0; it < smoothIters; it++) {
      const N2 = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        let sx = 0, sy = 0, sz = 0, c = 0;
        for (let k = offs[i]; k < offs[i + 1]; k++) { const u = adj[k]; sx += D[u * 3]; sy += D[u * 3 + 1]; sz += D[u * 3 + 2]; c++; }
        const own = [D[i * 3], D[i * 3 + 1], D[i * 3 + 2]], avg = c ? [sx / c, sy / c, sz / c] : own;
        // keep at least the required own push (max-preserving blend)
        for (let k = 0; k < 3; k++) N2[i * 3 + k] = 0.5 * own[k] + 0.5 * avg[k];
        if (V.len(own) > V.len([N2[i * 3], N2[i * 3 + 1], N2[i * 3 + 2]])) for (let k = 0; k < 3; k++) N2[i * 3 + k] = own[k];
      }
      D = N2;
    }
    for (let i = 0; i < n * 3; i++) { pos[i] += D[i]; total[i] += D[i]; }
    pushed = cnt;
  }
  for (let i = 0; i < n; i++) maxPush = Math.max(maxPush, Math.hypot(total[i * 3], total[i * 3 + 1], total[i * 3 + 2]));
  let moved = 0; for (let i = 0; i < n; i++) if (Math.hypot(total[i * 3], total[i * 3 + 1], total[i * 3 + 2]) > 1e-4) moved++;
  return {marginM: margin, verticesInsideBodyBefore: inside0, verticesMoved: moved, maxDisplacementM: +maxPush.toFixed(4), lastRoundViolations: pushed, rounds, smoothIters};
}
