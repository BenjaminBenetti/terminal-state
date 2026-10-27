// Lower-garment (pants) stage and per-body fit (iteration 06). Pants are fitted to each body DIRECTLY
// (no canonical retarget): a 2.5D row-wise profile fit that suits A-pose bodies standing upright.
//  stage (once per source, body independent): nominal placement (+Z facing, hem at y = 0, 1 unit
//    tall), simplify / unwrap / bake in that space -> low-poly mesh + texture shared by every body.
//  frame: per 1 cm row of the pants: waist top, crotch (highest row where the two leg tubes are still
//    separate clusters), per leg the cluster centre + robust half extents (x, z), above the crotch the
//    whole-slice centre + half extents.
//  fit to body B: piecewise-linear height map (hem -> ankle + offset, crotch -> body crotch - drop,
//    waist -> body hip joint + waistAboveHip); every row is re-centred on the body's own leg / pelvis
//    centre and scaled by a global hip-width scale, grown per row only where the body's limb or
//    pelvis (+ ease) would poke through (the pants keep their own silhouette where they are loose);
//    leg and waist maps blend over a crotch band; displacement smoothing; then (fit.mjs) push-out,
//    weight transfer WITHOUT the skirt rule (each pant leg follows its own thigh/shin), leg masks.
import {bounds, similarity, rotateNormals, weldByPosition, computeNormals, vertexAdjacency} from './mesh.mjs';
import {lowPolyAndBake} from './stage-mesh.mjs';
import {bucketByHeight, clusterXZ} from './slices.mjs';
import {JOINT_NAMES} from './skin.mjs';

const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (a, q) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };

/** Robust centre/half-extents of a vertex subset. */
function rowStats(pos, ids) {
  const xs = ids.map(i => pos[i * 3]), zs = ids.map(i => pos[i * 3 + 2]);
  const x0 = pct(xs, 0.03), x1 = pct(xs, 0.97), z0 = pct(zs, 0.03), z1 = pct(zs, 0.97);
  return {cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: Math.max(0.01, (x1 - x0) / 2), hz: Math.max(0.01, (z1 - z0) / 2), n: ids.length};
}

/** Smooth a per-row array of objects (gaussian over +-r rows) for the numeric keys. */
function smoothRows(rows, keys, r = 4) {
  const n = rows.length;
  return rows.map((row, k) => {
    if (!row) return null;
    const out = {...row};
    for (const key of keys) { let a = 0, c = 0; for (let d = -r; d <= r; d++) { const q = rows[k + d]; if (!q) continue; const w = Math.exp(-(d * d) / (r * r / 2)); a += w * q[key]; c += w; } out[key] = a / c; }
    return out;
  });
}

/** Pants frame from (welded) positions: waist, crotch, per-row leg / pelvis profiles. */
export function measurePants(pos) {
  const b = bounds(pos), y0 = b.min[1], y1 = b.max[1], H = y1 - y0, step = 0.01 * H;
  const {buckets} = bucketByHeight(pos, y0, y1 + step, step);
  const slices = buckets.map(ids => clusterXZ(pos, ids, 0.012 * H, 4));
  // crotch: scanning down from 85% of the height, the first row whose two biggest clusters sit either
  // side of x = 0 (the leg tubes separate)
  let crotchK = null;
  for (let k = Math.floor(0.85 * buckets.length); k > 0.2 * buckets.length; k--) {
    const cl = [...slices[k]].sort((a, c) => c.count - a.count).slice(0, 2);
    if (cl.length === 2 && Math.min(cl[0].count, cl[1].count) > 0.25 * Math.max(cl[0].count, cl[1].count) && cl[0].bx * cl[1].bx < 0) { crotchK = k; break; }
  }
  if (crotchK == null) throw new Error('pants: crotch (leg split) not found');
  const crotchY = y0 + (crotchK + 1) * step;
  const legs = {L: [], R: []}, top = [];
  for (let k = 0; k < buckets.length; k++) {
    const ids = buckets[k];
    if (k <= crotchK) {
      for (const [s, sg] of [['L', 1], ['R', -1]]) {
        const own = ids.filter(i => pos[i * 3] * sg > 0);
        legs[s][k] = own.length >= 6 ? rowStats(pos, own) : null;
      }
      top[k] = null;
    } else { top[k] = ids.length >= 6 ? rowStats(pos, ids) : null; legs.L[k] = legs.R[k] = null; }
  }
  // fill gaps by nearest valid row
  const fill = rows => { const n = rows.length; for (let k = 1; k < n; k++) if (!rows[k]) rows[k] = rows[k - 1]; for (let k = n - 2; k >= 0; k--) if (!rows[k]) rows[k] = rows[k + 1]; return rows; };
  const legRows = {L: smoothRows(fill(legs.L.slice(0, crotchK + 1)), ['cx', 'cz', 'hx', 'hz']), R: smoothRows(fill(legs.R.slice(0, crotchK + 1)), ['cx', 'cz', 'hx', 'hz'])};
  const topRows = smoothRows(fill(top.slice(crotchK + 1)), ['cx', 'cz', 'hx', 'hz']);
  const hipRow = topRows[Math.min(topRows.length - 1, Math.round(0.3 * topRows.length))];
  return {y0, y1, H, step, crotchY, crotchK, legRows, topRows, hip: hipRow,
    legAt: (s, y) => legRows[s][clamp(Math.floor((y - y0) / step), 0, crotchK)],
    topAt: y => topRows[clamp(Math.floor((y - y0) / step) - crotchK - 1, 0, topRows.length - 1)]};
}

/** Per-body leg / pelvis profiles (rows every 1 cm) from the welded body + its skin weights. */
export function bodyLegFrame(B) {
  const P = B.low.welded.pos, n = P.length / 3, J = B.skel.joints, sw = B.weldedWeights;
  const step = 0.01, nRows = Math.ceil(B.skel.H / step) + 1;
  const side = {L: new Set(['L_Thigh', 'L_Shin', 'L_Foot'].map(j => JOINT_NAMES.indexOf(j))), R: new Set(['R_Thigh', 'R_Shin', 'R_Foot'].map(j => JOINT_NAMES.indexOf(j)))};
  const rows = {L: Array.from({length: nRows}, () => []), R: Array.from({length: nRows}, () => []), T: Array.from({length: nRows}, () => [])};
  for (let i = 0; i < n; i++) {
    const k = Math.floor(P[i * 3 + 1] / step); if (k < 0 || k >= nRows) continue;
    const j = sw.joints[i * 4];
    if (side.L.has(j)) rows.L[k].push(i); else if (side.R.has(j)) rows.R[k].push(i);
    // pelvis rows: everything that is not an arm / hand (arms hang beside the hips in the A-pose)
    if (!/Arm|Forearm|Hand/.test(JOINT_NAMES[j])) rows.T[k].push(i);
  }
  const prof = {};
  for (const s of ['L', 'R', 'T']) {
    const r = rows[s].map(ids => ids.length >= 8 ? rowStats(P, ids) : null);
    for (let k = 1; k < nRows; k++) if (!r[k]) r[k] = r[k - 1];
    for (let k = nRows - 2; k >= 0; k--) if (!r[k]) r[k] = r[k + 1];
    prof[s] = smoothRows(r, ['cx', 'cz', 'hx', 'hz'], 3);
  }
  const at = (s, y) => prof[s][clamp(Math.floor(y / step), 0, nRows - 1)];
  return {at, crotchY: B.skel.crotchY, hipY: B.skel.hipY, ankleY: J.L_Foot[1], kneeY: J.L_Shin[1], spineY: J.Spine[1]};
}

/**
 * Fit nominal pants positions (welded) to body B. Returns new positions + stats.
 * cfg.fit: {ease, waistAboveHip, crotchDrop, hemAboveAnkle}
 */
export function fitPantsToBody(pos, idx, F, B, cfg) {
  // per-body overrides (e.g. a body whose own jeans/belt sit high: the pants waist rises to cover it)
  const bf = bodyLegFrame(B), f = {...cfg.fit, ...(B.pantsFit ?? {})};
  const ease = f.ease ?? 0.012;
  const waistT = Math.min(bf.hipY + (f.waistAboveHip ?? 0.11), bf.spineY + (f.waistAboveSpineMax ?? 0.01));
  const crotchT = bf.crotchY - (f.crotchDrop ?? 0.03);
  const hemT = bf.ankleY + (f.hemAboveAnkle ?? -0.015);
  const yMap = y => y <= F.crotchY
    ? hemT + (y - F.y0) / (F.crotchY - F.y0) * (crotchT - hemT)
    : crotchT + (y - F.crotchY) / (F.y1 - F.crotchY) * (waistT - crotchT);
  // global scale from the hip rows (pants hip row vs body pelvis at the matching height)
  const hipYn = F.crotchY + 0.3 * (F.y1 - F.crotchY), bh = bf.at('T', yMap(hipYn));
  const gx = (bh.hx + ease) / F.hip.hx, gz = (bh.hz + ease) / F.hip.hz;
  const n = pos.length / 3, out = new Float32Array(n * 3);
  const kStats = {legGrowMax: 1, topGrowMax: 1};
  const mapRow = (p, src, dst, y1) => {
    // keep the pants silhouette (global scale) unless the body (+ease) needs more room on this row
    const kx = Math.max(gx, (dst.hx + ease) / src.hx), kz = Math.max(gz, (dst.hz + ease) / src.hz);
    return [dst.cx + (p[0] - src.cx) * clamp(kx, 0.4, 3), y1, dst.cz + (p[2] - src.cz) * clamp(kz, 0.4, 3), kx / gx, kz / gz];
  };
  const band = 0.05 * F.H;
  for (let i = 0; i < n; i++) {
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], y1 = yMap(p[1]);
    let leg = null, top = null;
    if (p[1] <= F.crotchY + band) {
      const s = p[0] >= 0 ? 'L' : 'R';
      leg = mapRow(p, F.legAt(s, Math.min(p[1], F.crotchY)), bf.at(s, Math.min(y1, crotchT)), y1);
      kStats.legGrowMax = Math.max(kStats.legGrowMax, leg[3], leg[4]);
    }
    if (p[1] >= F.crotchY - band) {
      top = mapRow(p, F.topAt(Math.max(p[1], F.crotchY + F.step)), bf.at('T', Math.max(y1, crotchT + 0.01)), y1);
      kStats.topGrowMax = Math.max(kStats.topGrowMax, top[3], top[4]);
    }
    let q;
    if (leg && top) { const t = ss(F.crotchY - band, F.crotchY + band, p[1]); q = [0, 1, 2].map(k => leg[k] * (1 - t) + top[k] * t); }
    else q = leg || top;
    out[i * 3] = q[0]; out[i * 3 + 1] = q[1]; out[i * 3 + 2] = q[2];
  }
  // displacement smoothing (row-wise maps can ripple)
  const {offs, adj} = vertexAdjacency(n, idx);
  let D = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) D[i] = out[i] - pos[i];
  for (let it = 0; it < 6; it++) {
    const N2 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const deg = offs[i + 1] - offs[i]; for (let c = 0; c < 3; c++) { let a = 0; for (let k = offs[i]; k < offs[i + 1]; k++) a += D[adj[k] * 3 + c]; N2[i * 3 + c] = deg ? 0.5 * D[i * 3 + c] + 0.5 * a / deg : D[i * 3 + c]; } }
    D = N2;
  }
  for (let i = 0; i < n * 3; i++) out[i] = pos[i] + D[i];
  return {pos: out, stats: {targets: {waistY: +waistT.toFixed(4), crotchY: +crotchT.toFixed(4), hemY: +hemT.toFixed(4)}, bodyOverrides: B.pantsFit ?? null, globalScale: [+gx.toFixed(3), +gz.toFixed(3)], easeM: ease, legRowGrowMax: +kStats.legGrowMax.toFixed(3), waistRowGrowMax: +kStats.topGrowMax.toFixed(3),
    method: 'row-wise profile fit: piecewise height map (hem->ankle, crotch->body crotch, waist->hip joint+offset); rows re-centred on the body leg/pelvis centres, global hip-width scale, grown per row only where body+ease needs room; crotch band blend; 6 smoothing passes'}};
}

/** Stage: nominal placement + low poly + bake (body independent). */
export async function pantsStage(master, cfg) {
  const b = bounds(master.pos);
  const facing = cfg.facing ?? -1;
  const s0 = 1.0 / (b.max[1] - b.min[1]);
  const nominal = {scale: s0, pivot: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2], flipFacing: facing < 0, offset: [0, 0, 0]};
  const posN = similarity(master.pos, nominal), nrmN = rotateNormals(master.nrm, facing < 0);
  const high = {pos: posN, nrm: nrmN, uv: master.uv, idx: master.idx};
  const r = await lowPolyAndBake(high, master, {targetTris: cfg.targetTris, faceRegion: () => ({region: 0, density: 1}), unwrapOpts: cfg.unwrap, bakeSize: cfg.bake.size, bakeOpts: {cage: cfg.bake.cage, rayBelow: cfg.bake.rayBelow}, baseSize: cfg.textures.baseColor, mrSize: cfg.textures.metallicRoughness, quality: cfg.textures.jpegQuality});
  const F = measurePants(weldByPosition(posN, nrmN, master.idx).pos);
  return {nominal: {scale: +s0.toFixed(6), pivot: nominal.pivot.map(v => +v.toFixed(5)), flipFacing: facing < 0}, low: r.low, enc: {baseJpg: r.enc.baseJpg, mrJpg: r.enc.mrJpg}, stats: r.stats,
    frameSummary: {crotchNominal: +F.crotchY.toFixed(4), hipHalf: [+F.hip.hx.toFixed(4), +F.hip.hz.toFixed(4)]},
    master: {id: master.id, file: master.file, sha256: master.sha256Verified, bytes: master.bytes, triangles: master.triangles, vertices: master.vertices, material: master.material, textures: {baseColor: [master.baseColor.width, master.baseColor.height, master.baseColor.mimeType], metallicRoughness: [master.metallicRoughness.width, master.metallicRoughness.height, master.metallicRoughness.mimeType]}}};
}

export {computeNormals};
