// Generic garment stage (generalised from coat.mjs, which stays untouched for build-zombie.mjs):
// fit any ghost-mannequin upper-body garment source (sleeved jacket/coat or sleeveless vest) onto
// the CANONICAL body (Last-shift) once:
//  1. nominal placement (+Z facing, hem at 0, 1.2 units tall), slice landmarks (sleeves optional);
//  2. global fit: garment armpit/armhole -> body armpit - drop; width from the body chest x ease
//     (uniform scale, aspect preserved) unless a hem target is configured (coat: knee);
//     depth from the body depth + ease (clamped);
//  3. simplify / unwrap / bake in that space (same path as the bodies, one texture per garment);
//  4. sleeved garments: fit skeleton on the garment sleeves, per-bone maps fit -> body arm bones
//     (rotation + length) blended by fit-skeleton weights (sleeve retarget);
//  5. optional back-drape taper; bind-pose push-out; weight transfer from the canonical body.
// The result (low-poly mesh + UVs + texture + canonical weights) is then retargeted per body by
// fit.mjs, so every body shares the garment's UV layout and texture.
import {buildGrid} from './bake.mjs';
import {similarity, rotateNormals, bounds, weldByPosition, computeNormals} from './mesh.mjs';
import {lowPolyAndBake, scaleAbout} from './stage-mesh.mjs';
import {bucketByHeight, clusterXZ, fitLine} from './slices.mjs';
import {computeSkinWeights, transferWeights, JOINT_NAMES} from './skin.mjs';
import {frameRot, qRot, V} from './pose.mjs';
import {pushOut} from './coat.mjs';

const r3 = v => v.map(x => +x.toFixed(4));

/** Slice landmarks of a garment: hem/top, optional sleeves (separated clusters), width profile. */
export function measureGarment(pos, {neckHalf = 0.07} = {}) {
  const n = pos.length / 3;
  let y0 = Infinity, H = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, pos[i * 3 + 1]); H = Math.max(H, pos[i * 3 + 1]); }
  const step = 0.01;
  const {buckets} = bucketByHeight(pos, y0, H + step, step);
  const slices = buckets.map((b, k) => ({y: y0 + (k + 0.5) * step, ids: b, clusters: clusterXZ(pos, b, 0.02, 5)}));
  const at = y => slices[Math.max(0, Math.min(slices.length - 1, Math.floor((y - y0) / step)))];
  const central = s => s.clusters.reduce((best, c) => (c.minX <= 0.03 && c.maxX >= -0.03 && (!best || c.count > best.count)) ? c : best, null);
  // whole-slice extent (all clusters) and the central torso cluster
  const extent = s => { let a = Infinity, b = -Infinity, za = Infinity, zb = -Infinity; for (const c of s.clusters) { a = Math.min(a, c.minX); b = Math.max(b, c.maxX); za = Math.min(za, c.minZ); zb = Math.max(zb, c.maxZ); } return {minX: a, maxX: b, minZ: za, maxZ: zb}; };
  const sleeves = {L: [], R: []};
  for (const s of slices) {
    const c0 = central(s); if (!c0) continue;
    for (const c of s.clusters) { if (c === c0) continue; if (c.minX > c0.maxX && c.bx > c0.maxX + 0.02) sleeves.L.push({y: s.y, c}); else if (c.maxX < c0.minX && c.bx < c0.minX - 0.02) sleeves.R.push({y: s.y, c}); }
  }
  const out = {hemY: y0, topY: H, sides: {}, slices, central, at, extent, sleeved: false};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    const bySlice = new Map();
    for (const a of sleeves[side]) { const k = Math.round(a.y / step); if (!bySlice.has(k) || bySlice.get(k).c.count < a.c.count) bySlice.set(k, a); }
    const ks = [...bySlice.keys()].sort((a, b) => b - a);
    const runs = [];
    for (const k of ks) { const r = runs[runs.length - 1]; if (r && r.last - k <= 2) { r.items.push(bySlice.get(k)); r.last = k; } else runs.push({last: k, items: [bySlice.get(k)]}); }
    const best = runs.sort((a, b) => b.items.length - a.items.length)[0];
    // a sleeve must be a long run (> 12 cm nominal) hanging well outside the torso
    if (!best || best.items.length < 12) { out.sides[side] = null; continue; }
    const list = best.items;
    const armpitY = Math.max(...list.map(a => a.y));
    const ids = list.flatMap(a => a.c.ids);
    let line = fitLine(list.filter(a => a.y <= armpitY - 0.02).map(a => [a.c.bx, a.y, a.c.bz]));
    if (line.dir[0] * sg < 0) line.dir = line.dir.map(v => -v);
    let tMax = -Infinity;
    for (const i of ids) tMax = Math.max(tMax, (pos[i * 3] - line.center[0]) * line.dir[0] + (pos[i * 3 + 1] - line.center[1]) * line.dir[1] + (pos[i * 3 + 2] - line.center[2]) * line.dir[2]);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of ids) {
      const t = (pos[i * 3] - line.center[0]) * line.dir[0] + (pos[i * 3 + 1] - line.center[1]) * line.dir[1] + (pos[i * 3 + 2] - line.center[2]) * line.dir[2];
      if (t < tMax - 0.03) continue;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i * 3 + k]); hi[k] = Math.max(hi[k], pos[i * 3 + k]); }
    }
    const cuff = lo.map((v, k) => (v + hi[k]) / 2);
    const zc = line.center[2] + ((armpitY + 0.12 - line.center[1]) / line.dir[1]) * line.dir[2];
    const wallC = central(at(armpitY - 0.015));
    out.sides[side] = {armpitY, line, ids, tMax, cuff, armpitPt: [sg > 0 ? wallC.maxX : wallC.minX, armpitY, zc]};
  }
  out.sleeved = !!(out.sides.L && out.sides.R);
  if (out.sleeved) out.armpitY = (out.sides.L.armpitY + out.sides.R.armpitY) / 2;
  else {
    // sleeveless: armhole bottom = lowest height (above 30% of the garment) where the side seams
    // stop closing the loop: the central cluster loses most of its front-to-back depth (front and
    // back panels become separate pieces either side of the armholes)
    out.sides = {L: null, R: null};
    const depth = y => { const c = central(at(y)); return c ? c.maxZ - c.minZ : 0; };
    const ref = Math.max(...[0.25, 0.3, 0.35, 0.4].map(f => depth(y0 + f * (H - y0))));
    let ah = null;
    for (let y = y0 + 0.3 * (H - y0); y < H - 0.05; y += step) if (depth(y) < 0.6 * ref && depth(y + step) < 0.6 * ref) { ah = y; break; }
    out.armholeMethod = ah != null ? 'central-cluster depth < 60% of the lower-torso depth (side seam gone)' : 'fallback 55% of garment height';
    out.armpitY = ah ?? y0 + 0.55 * (H - y0);
  }
  return out;
}

function torsoAt(skel, y) {
  const T = skel.torso; let k = Math.max(0, Math.min(T.rows.length - 1, Math.round((y - T.y0) / T.step)));
  while (!T.rows[k] && k < T.rows.length - 1) k++;
  const [w, d, cx, cz] = T.rows[k]; return {w, d, cx, cz};
}
function sliceStats(G, y) {
  const s = G.at(y), c = G.central(s);
  if (G.sleeved && c) return {w: c.maxX - c.minX, d: c.maxZ - c.minZ, cx: (c.minX + c.maxX) / 2, cz: (c.minZ + c.maxZ) / 2};
  const e = G.extent(s); // sleeveless / open fronts: the whole slice is the torso
  return {w: e.maxX - e.minX, d: e.maxZ - e.minZ, cx: (e.minX + e.maxX) / 2, cz: (e.minZ + e.maxZ) / 2};
}

/**
 * @param getMaster async () => loaded source (source.mjs); only called when the stage is not cached
 * @param cfg garment config (see variants.config.mjs)
 * @param C canonical body {skel, rigDesc, welded (low welded), weights (welded skin weights)}
 * @param cached (key, fn) stage cache
 */
export async function garmentCanonical(getMaster, cfg, C, cached, skinOptions) {
  const {skel, rigDesc} = C;
  const stage = await cached('garment-' + cfg.id, async () => {
    const master = await getMaster();
    const b = bounds(master.pos);
    const facing = cfg.facing ?? -1; // F16 SV / Pixal3D sources face -Z (verified per asset in QA previews)
    const s0 = 1.2 / (b.max[1] - b.min[1]);
    const nominal = {scale: s0, pivot: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2], flipFacing: facing < 0, offset: [0, 0, 0]};
    const posN = similarity(master.pos, nominal);
    const nrmN = rotateNormals(master.nrm, facing < 0);
    const G = measureGarment(weldByPosition(posN, nrmN, master.idx).pos);
    const gArmpit = G.armpitY;
    // ---- global fit
    const armpitTarget = skel.armpitY - cfg.fit.armpitDrop;
    const level = gArmpit - 0.08 * (gArmpit - G.hemY);
    const cs = sliceStats(G, level);
    let sx, sy;
    if (cfg.fit.hem === 'knee') {
      const hemTarget = skel.kneeY - 0.035;
      sy = (armpitTarget - hemTarget) / (gArmpit - G.hemY);
      const bs0 = torsoAt(skel, level * sy + (hemTarget - G.hemY * sy));
      sx = Math.min(1.0 * sy, Math.max(0.8 * sy, (bs0.w * cfg.fit.widthEase + cfg.fit.widthAdd) / cs.w));
    } else {
      // aspect-preserving: scale from width at the chest level (body level estimated iteratively)
      let s = 1;
      for (let it = 0; it < 4; it++) { const bodyLevel = armpitTarget - (gArmpit - level) * s; const bs0 = torsoAt(skel, bodyLevel); s = (bs0.w * cfg.fit.widthEase + cfg.fit.widthAdd) / cs.w; }
      sx = s; sy = s * (cfg.fit.lengthScale ?? 1);
    }
    // 'top' anchor (vests): the shoulder straps rest on the trapezius at the neck base; deep
    // armholes make the armhole bottom a poor height anchor
    const ty = cfg.fit.anchor === 'top' ? skel.neckBaseY + (cfg.fit.topOffset ?? 0) - G.topY * sy : armpitTarget - gArmpit * sy;
    const bodyLevel = level * sy + ty;
    const bs = torsoAt(skel, bodyLevel);
    const sz = Math.min(cfg.fit.depthMax * sy, Math.max(cfg.fit.depthMin * sy, (bs.d + cfg.fit.depthAdd) / cs.d));
    const tx = -cs.cx * sx;
    const tz = bs.cz - cs.cz * sz + (cfg.fit.zShift ?? 0);
    const fit = {nominal: {scale: +s0.toFixed(6), pivot: r3(nominal.pivot), flipFacing: facing < 0}, scale: r3([sx, sy, sz]), translate: r3([tx, ty, tz]), sleeved: G.sleeved,
      landmarks: {garmentArmpitNominal: +gArmpit.toFixed(4), garmentHemNominal: +G.hemY.toFixed(4), garmentTopNominal: +G.topY.toFixed(4), bodyArmpit: +skel.armpitY.toFixed(4), armpitTarget: +armpitTarget.toFixed(4),
        level: {garmentNominalY: +level.toFixed(4), bodyY: +bodyLevel.toFixed(4), garmentWidth: +cs.w.toFixed(4), garmentDepth: +cs.d.toFixed(4), bodyWidth: +bs.w.toFixed(4), bodyDepth: +bs.d.toFixed(4)}},
      method: cfg.fit.hem === 'knee'
        ? `per-axis scale+translate: armpit -> body armpit - ${cfg.fit.armpitDrop} m, hem -> knee joint - 3.5 cm; width = ${cfg.fit.widthEase} x body + ${cfg.fit.widthAdd} m (clamped 0.8-1.0 of vertical); depth = body + ${cfg.fit.depthAdd} m (clamped ${cfg.fit.depthMin}-${cfg.fit.depthMax})`
        : `aspect-preserving scale from width = ${cfg.fit.widthEase} x body chest + ${cfg.fit.widthAdd} m${cfg.fit.lengthScale ? ` (length x${cfg.fit.lengthScale})` : ''}; ${cfg.fit.anchor === 'top' ? `garment top -> body neck base ${cfg.fit.topOffset ?? 0} m` : `${G.sleeved ? 'armpit' : 'armhole bottom'} -> body armpit - ${cfg.fit.armpitDrop} m`}; depth = body + ${cfg.fit.depthAdd} m (clamped ${cfg.fit.depthMin}-${cfg.fit.depthMax} of vertical)`};
    const posG = scaleAbout(posN, [sx, sy, sz], [0, 0, 0], [tx, ty, tz]);
    const nrmG = new Float32Array(nrmN.length);
    for (let i = 0; i < nrmN.length; i += 3) { const x = nrmN[i] / sx, y = nrmN[i + 1] / sy, z = nrmN[i + 2] / sz, l = Math.hypot(x, y, z) || 1; nrmG[i] = x / l; nrmG[i + 1] = y / l; nrmG[i + 2] = z / l; }
    const high = {pos: posG, nrm: nrmG, uv: master.uv, idx: master.idx};
    const O = cfg;
    const r = await lowPolyAndBake(high, master, {targetTris: O.targetTris, faceRegion: () => ({region: 0, density: 1}), unwrapOpts: O.unwrap, bakeSize: O.bake.size, bakeOpts: {cage: O.bake.cage, rayBelow: O.bake.rayBelow}, baseSize: O.textures.baseColor, mrSize: O.textures.metallicRoughness, quality: O.textures.jpegQuality});
    const Gg = measureGarment(weldByPosition(posG, nrmG, master.idx).pos);
    const sides = {};
    for (const s of ['L', 'R']) { if (!Gg.sides[s]) { sides[s] = null; continue; } const {ids, line, ...rest} = Gg.sides[s]; sides[s] = {...rest, line: {center: line.center, dir: line.dir}}; }
    const wall = {y0: +(Gg.hemY).toFixed(3), step: 0.01, L: [], R: []};
    for (let y = Gg.hemY; y <= Gg.armpitY + 0.05; y += 0.01) { const c = Gg.central(Gg.at(y)); wall.L.push(c ? +c.maxX.toFixed(4) : 0); wall.R.push(c ? +(-c.minX).toFixed(4) : 0); }
    return {fit, low: r.low, enc: {baseJpg: r.enc.baseJpg, mrJpg: r.enc.mrJpg, basePreview: r.enc.basePreview}, stats: r.stats, garment: {hemY: Gg.hemY, topY: Gg.topY, armpitY: Gg.armpitY, sleeved: Gg.sleeved, sides, wall},
      master: {id: master.id, file: master.file, sha256: master.sha256Verified, bytes: master.bytes, triangles: master.triangles, vertices: master.vertices, material: master.material, textures: {baseColor: [master.baseColor.width, master.baseColor.height, master.baseColor.mimeType], metallicRoughness: [master.metallicRoughness.width, master.metallicRoughness.height, master.metallicRoughness.mimeType]}}};
  });

  const W = stage.low.welded, nw = W.pos.length / 3;
  let def = new Float32Array(W.pos);
  let retarget = null, fitJointsOut = null, fitStats = null;
  // garment regions (0 torso panel, 1 left sleeve, 2 right sleeve): iteration-06 weight transfer keeps
  // arm weights off the torso panels below the armpit (no 'batwing' panels when the arms rise)
  let region = new Int8Array(nw);
  // ---- back-drape taper (optional): pull points behind the body's back surface toward it
  const tp = cfg.backTaper;
  let tapered = 0;
  if (tp) {
    const backZ = y => { const T = skel.torso; let k = Math.round((Math.max(y, skel.hipY) - T.y0) / T.step); k = Math.max(0, Math.min(T.rows.length - 1, k)); while (k < T.rows.length - 1 && !T.rows[k]) k++; const [, d, , cz] = T.rows[k]; return cz - d / 2; };
    for (let i = 0; i < nw; i++) {
      const y = def[i * 3 + 1], z = def[i * 3 + 2];
      const zb = backZ(y) - tp.clearance;
      if (z >= zb) continue;
      const yFull = skel.hipY;
      const k = 1 - (1 - tp.hemFactor) * (1 - Math.min(1, Math.max(0, (y - yFull) / (tp.fullAboveY - yFull))));
      def[i * 3 + 2] = zb + (z - zb) * k; tapered++;
    }
  }
  // ---- sleeve retarget onto the canonical arm bones (sleeved garments only)
  if (stage.garment.sleeved) {
    const J = skel.joints, gs = stage.garment.sides;
    const fitJoints = {...J}, fitEnds = {...skel.ends}, fitCut = {};
    retarget = {};
    for (const s of ['L', 'R']) {
      const g = gs[s], sg = s === 'L' ? 1 : -1;
      const bS = J[s + '_UpperArm'], bE = J[s + '_Forearm'], bW = J[s + '_Hand'];
      const elbow = V.add(g.line.center, V.mul(g.line.dir, V.dot(V.sub(bE, g.line.center), g.line.dir)));
      const wrist = V.sub(g.cuff, V.mul(g.line.dir, 0.015));
      fitJoints[s + '_UpperArm'] = bS; fitJoints[s + '_Forearm'] = elbow; fitJoints[s + '_Hand'] = wrist;
      fitEnds[s + '_Hand'] = V.add(g.cuff, V.mul(g.line.dir, 0.02));
      const A = [g.armpitPt[0], g.armpitPt[1], bS[2]];
      fitCut[s] = {A, T: [A[0] + sg * 0.02, A[1] + 0.3, bS[2]]};
      // long sleeves: the cuff lands 2 cm past the body wrist; shorter sleeves keep their length
      const fitForearm = V.len(V.sub(wrist, elbow)), bodyForearm = V.len(V.sub(bW, bE));
      const long = fitForearm > 0.6 * bodyForearm;
      const bWrist = long ? V.add(bW, V.mul(V.norm(V.sub(bW, bE)), cfg.cuffPastWrist ?? 0.02)) : V.add(bE, V.mul(V.norm(V.sub(bW, bE)), fitForearm));
      retarget[s] = {fitElbowOffsetFromBodyElbow: r3(V.sub(elbow, bE)), fitShoulder: r3(bS), fitElbow: r3(elbow), fitWrist: r3(wrist), bodyShoulder: bS, bodyElbow: bE, bodyWristTarget: r3(bWrist), cuff: r3(g.cuff), sleeveAxis: r3(g.line.dir), garmentArmpit: r3(A), longSleeve: long};
    }
    const fitRig = {...rigDesc, joints: fitJoints, ends: fitEnds, cut: fitCut, wall: stage.garment.wall, wallMargin: 0.01};
    // weights on the untapered stage mesh (as coat.mjs), applied to the tapered positions
    const sw = computeSkinWeights(W, fitRig, {kind: 'coat', coatThighMax: cfg.thighFollow ?? 0.45, ...skinOptions});
    fitStats = sw.stats;
    region = Int8Array.from(sw.region);
    const maps = {};
    for (const s of ['L', 'R']) {
      const R = retarget[s];
      const seg = (a0, a1, b0, b1) => {
        const d0 = V.sub(a1, a0), d1 = V.sub(b1, b0), L0 = V.len(d0), L1 = V.len(d1);
        const u0 = V.norm(d0), u1 = V.norm(d1), side = [0, 0, 1];
        return {a0, b0, u0, k: L1 / L0, q: frameRot(u0, V.cross(u0, side), u1, V.cross(u1, side))};
      };
      maps[s + '_UpperArm'] = seg(R.fitShoulder, R.fitElbow, R.bodyShoulder, R.bodyElbow);
      maps[s + '_Forearm'] = seg(R.fitElbow, R.fitWrist, R.bodyElbow, R.bodyWristTarget);
      maps[s + '_Hand'] = {...maps[s + '_Forearm']};
      R.upperArmScale = +maps[s + '_UpperArm'].k.toFixed(4); R.forearmScale = +maps[s + '_Forearm'].k.toFixed(4);
    }
    const apply = (name, p) => {
      const M = maps[name]; if (!M) return p;
      const d = V.sub(p, M.a0), along = V.dot(d, M.u0);
      return V.add(M.b0, qRot(M.q, V.add(d, V.mul(M.u0, along * (M.k - 1)))));
    };
    const out = new Float32Array(W.pos.length);
    for (let i = 0; i < nw; i++) {
      const p = [def[i * 3], def[i * 3 + 1], def[i * 3 + 2]];
      let acc = [0, 0, 0];
      for (let k = 0; k < 4; k++) { const w = sw.weights[i * 4 + k]; if (!w) continue; acc = V.add(acc, V.mul(apply(JOINT_NAMES[sw.joints[i * 4 + k]], p), w)); }
      out[i * 3] = acc[0]; out[i * 3 + 1] = acc[1]; out[i * 3 + 2] = acc[2];
    }
    def = out;
    fitJointsOut = Object.fromEntries(Object.entries(fitJoints).map(([k, v]) => [k, r3(v)]));
  }
  const push = pushOut(def, W.idx, C.welded, cfg.pushOut);
  const tw = transferWeights({pos: def, idx: W.idx}, C.welded, C.weights, rigDesc, {thighMax: cfg.thighFollow ?? 0.45, smoothIters: 3, grid: buildGrid(C.welded.pos, C.welded.idx, 0.03), region, armpitY: skel.armpitY});
  return {...stage, canonical: {pos: def, idx: W.idx, nrm: computeNormals(def, W.idx), joints: tw.joints, weights: tw.weights, region},
    skinStats: {fitSkeletonWeights: fitStats, final: tw.stats}, retarget, pushOut: push, backTaper: tp ? {...tp, verticesTapered: tapered} : null, fitJoints: fitJointsOut};
}
