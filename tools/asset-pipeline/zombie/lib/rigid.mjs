// Rigid head / face wearables (iteration 06): hats, helmets, masks. The item is NOT deformed: per
// body it is uniformly scaled to the head and placed by a contact solve, then weighted 100% to Head.
//  stage (once per source): nominal placement (+Z facing, bottom at y = 0, 0.25 units tall), low poly,
//    unwrap, bake.
//  head frame of body B: head vertices (dominant joint Head), top of head, max width over the
//    cranium, cranium centre (x, z) and an estimated head height (1.5 x width) for face landmarks.
//  hat ('hat'): scale = head width x ease / item width at `widthLevel` of its height; centred on the
//    cranium; DROP solve: rasterise the item's TOP surface (minus a shell thickness = its inner
//    surface, valid for hollow AND closed reconstructions) and the head's highest surface into a
//    2 mm (x, z) height field and lower the item until it rests on the head (`gap` > 0 = suspension
//    clearance, < 0 = allowed hair compression).
//  face ('face'): scale from the face width; the item's top edge at `topAt` x head height below the
//    top of the head; FORWARD solve on an (x, y) depth field (item front surface minus a shell
//    thickness vs frontmost head/neck surface): the face ends up inside the mask shell/volume.
import {bounds, similarity, rotateNormals} from './mesh.mjs';
import {lowPolyAndBake} from './stage-mesh.mjs';
import {JOINT_NAMES} from './skin.mjs';

const HEAD = JOINT_NAMES.indexOf('Head'), NECK = JOINT_NAMES.indexOf('Neck');

export async function rigidStage(master, cfg) {
  const facing = cfg.facing ?? -1;
  // optional trim: geometry trailing BEHIND the item by more than `trimBehind` x its height (loose
  // head-strap loops of a mask cannot wrap a head as a rigid part) is removed before simplification
  let idx = master.idx, trim = null;
  if (cfg.trimBehind) {
    const b0 = bounds(master.pos), H0 = b0.max[1] - b0.min[1], sg = facing < 0 ? -1 : 1;
    const zf = i => sg * master.pos[i * 3 + 2];
    let front = -Infinity; for (let i = 0; i < master.pos.length / 3; i++) front = Math.max(front, zf(i));
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) if ([idx[t], idx[t + 1], idx[t + 2]].some(v => front - zf(v) < cfg.trimBehind * H0)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    trim = {trimBehindFractionOfHeight: cfg.trimBehind, trianglesRemoved: (idx.length - keep.length) / 3, reason: 'loose strap loops trailing behind the item (a rigid item cannot wrap them around a head)'};
    idx = Uint32Array.from(keep);
  }
  const used = new Uint8Array(master.pos.length / 3); for (const v of idx) used[v] = 1;
  const b = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
  for (let i = 0; i < used.length; i++) if (used[i]) for (let k = 0; k < 3; k++) { const v = master.pos[i * 3 + k]; if (v < b.min[k]) b.min[k] = v; if (v > b.max[k]) b.max[k] = v; }
  const s0 = 0.25 / (b.max[1] - b.min[1]);
  const nominal = {scale: s0, pivot: [(b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2], flipFacing: facing < 0, offset: [0, 0, 0]};
  const high = {pos: similarity(master.pos, nominal), nrm: rotateNormals(master.nrm, facing < 0), uv: master.uv, idx};
  const r = await lowPolyAndBake(high, master, {targetTris: cfg.targetTris, faceRegion: () => ({region: 0, density: 1}), unwrapOpts: cfg.unwrap, bakeSize: cfg.bake.size, bakeOpts: {cage: cfg.bake.cage, rayBelow: cfg.bake.rayBelow}, baseSize: cfg.textures.baseColor, mrSize: cfg.textures.metallicRoughness, quality: cfg.textures.jpegQuality});
  return {nominal: {scale: +s0.toFixed(6), pivot: nominal.pivot.map(v => +v.toFixed(5)), flipFacing: facing < 0}, trim, low: r.low, enc: {baseJpg: r.enc.baseJpg, mrJpg: r.enc.mrJpg}, stats: r.stats,
    master: {id: master.id, file: master.file, sha256: master.sha256Verified, bytes: master.bytes, triangles: master.triangles, vertices: master.vertices, material: master.material, textures: {baseColor: [master.baseColor.width, master.baseColor.height, master.baseColor.mimeType], metallicRoughness: [master.metallicRoughness.width, master.metallicRoughness.height, master.metallicRoughness.mimeType]}}};
}

/**
 * Head frame of a body (welded low mesh + skin weights): top of head, cranium width above the ears,
 * cranium centre, and face landmarks for masks - nose tip (front-most head vertex near the centre
 * line between neck base and brow), chin (lowest front vertex) and cheek width at mouth level.
 */
export function headFrame(B) {
  const P = B.low.welded.pos, n = P.length / 3, sw = B.weldedWeights;
  const ids = [];
  for (let i = 0; i < n; i++) if (sw.joints[i * 4] === HEAD && sw.weights[i * 4] > 0.5) ids.push(i);
  let top = -Infinity; for (const i of ids) top = Math.max(top, P[i * 3 + 1]);
  const widthAt = (y, half = 0.006, zMin = -Infinity) => {
    let a = Infinity, b = -Infinity;
    for (const i of ids) { const yy = P[i * 3 + 1]; if (yy < y - half || yy > y + half || P[i * 3 + 2] < zMin) continue; a = Math.min(a, P[i * 3]); b = Math.max(b, P[i * 3]); }
    return b > a ? b - a : 0;
  };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const i of ids) if (P[i * 3 + 1] > top - 0.12) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // cranium width above the ears (hair included: hats sit on hair)
  let wMax = 0; for (let y = top - 0.10; y <= top - 0.045; y += 0.005) wMax = Math.max(wMax, widthAt(y));
  const neckBase = B.skel.neckBaseY;
  let nose = null;
  // search band: 4 cm above the neck base .. 60% of the way to the top (fringes / bangs on the
  // forehead can stick out further than the nose)
  const yHi = Math.min(top - 0.08, neckBase + 0.6 * (top - neckBase));
  for (const i of ids) { const y = P[i * 3 + 1]; if (y < neckBase + 0.04 || y > yHi || Math.abs(P[i * 3] - cx) > 0.03) continue; if (!nose || P[i * 3 + 2] > nose[2]) nose = [P[i * 3], y, P[i * 3 + 2]]; }
  let chin = Infinity;
  if (nose) for (const i of ids) { if (P[i * 3 + 2] < nose[2] - 0.045 || Math.abs(P[i * 3] - cx) > 0.04) continue; chin = Math.min(chin, P[i * 3 + 1]); }
  if (!nose) nose = [cx, top - 0.13, z1];
  if (!(chin < nose[1])) chin = nose[1] - 0.07;
  // anthropometric guard: nose tip -> chin bottom is 5.5-9 cm (a slim neck close behind the jaw line
  // otherwise reads as 'chin')
  chin = Math.min(nose[1] - 0.055, Math.max(nose[1] - 0.09, chin));
  // cheek width at mouth level over the FRONT of the head only (side hair / ears excluded)
  const cheekW = widthAt(nose[1] - 0.03, 0.006, nose[2] - 0.07);
  return {top, width: wMax, cx, cz, depth: z1 - z0, noseY: nose[1], noseZ: nose[2], chinY: chin, cheekWidth: cheekW, headHeight: top - chin, ids};
}

/** Rasterise triangles onto a 2D grid over axes (a, b), keeping min or max of axis c per cell. */
function field(pos, idx, triFilter, axes, cell, mode, grid) {
  const [A, Bx, Cx] = axes, out = grid.v;
  const nt = idx.length / 3;
  for (let t = 0; t < nt; t++) {
    if (triFilter && !triFilter(t)) continue;
    const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]].map(k => [pos[k * 3 + A], pos[k * 3 + Bx], pos[k * 3 + Cx]]);
    const ua = v.map(p => (p[0] - grid.a0) / cell), ub = v.map(p => (p[1] - grid.b0) / cell);
    const ia0 = Math.max(0, Math.floor(Math.min(...ua))), ia1 = Math.min(grid.na - 1, Math.ceil(Math.max(...ua)));
    const ib0 = Math.max(0, Math.floor(Math.min(...ub))), ib1 = Math.min(grid.nb - 1, Math.ceil(Math.max(...ub)));
    const den = (ub[1] - ub[2]) * (ua[0] - ua[2]) + (ua[2] - ua[1]) * (ub[0] - ub[2]);
    for (let ib = ib0; ib <= ib1; ib++) for (let ia = ia0; ia <= ia1; ia++) {
      const qa = ia + 0.5, qb = ib + 0.5;
      let w0, w1, w2;
      if (Math.abs(den) < 1e-12) { // degenerate in projection: use the vertices only
        continue;
      }
      w0 = ((ub[1] - ub[2]) * (qa - ua[2]) + (ua[2] - ua[1]) * (qb - ub[2])) / den;
      w1 = ((ub[2] - ub[0]) * (qa - ua[2]) + (ua[0] - ua[2]) * (qb - ub[2])) / den;
      w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      const c = w0 * v[0][2] + w1 * v[1][2] + w2 * v[2][2];
      const o = ib * grid.na + ia;
      if (mode === 'min' ? c < out[o] : c > out[o]) out[o] = c;
    }
    // vertices too (thin slivers)
    for (const p of v) {
      const ia = Math.floor((p[0] - grid.a0) / cell), ib = Math.floor((p[1] - grid.b0) / cell);
      if (ia < 0 || ib < 0 || ia >= grid.na || ib >= grid.nb) continue;
      const o = ib * grid.na + ia;
      if (mode === 'min' ? p[2] < out[o] : p[2] > out[o]) out[o] = p[2];
    }
  }
  return out;
}
function makeGrid(a0, a1, b0, b1, cell, fill) {
  const na = Math.ceil((a1 - a0) / cell) + 1, nb = Math.ceil((b1 - b0) / cell) + 1;
  return {a0, b0, na, nb, v: new Float32Array(na * nb).fill(fill)};
}

/** Fit a rigid item (stage low mesh, nominal space) to body B. Returns {pos (welded), weldedTransform, stats}. */
export function fitRigid(stage, cfg, B) {
  const W = stage.low.welded, P0 = W.pos, n = P0.length / 3;
  const f = cfg.fit, hf = headFrame(B);
  const bb = bounds(P0), h0 = bb.max[1] - bb.min[1];
  // item width at its width level
  const yl = bb.min[1] + (f.widthLevel ?? 0.45) * h0;
  let a = Infinity, b = -Infinity, za = Infinity, zb = -Infinity;
  for (let i = 0; i < n; i++) { if (Math.abs(P0[i * 3 + 1] - yl) > 0.03 * h0) continue; a = Math.min(a, P0[i * 3]); b = Math.max(b, P0[i * 3]); za = Math.min(za, P0[i * 3 + 2]); zb = Math.max(zb, P0[i * 3 + 2]); }
  const itemW = b - a, itemCx = (a + b) / 2, itemCz = (za + zb) / 2;
  // hats: real-world target width, adjusted gently by the cranium width (hair included, so only +-8%)
  let s = f.targetWidthM ? f.targetWidthM * Math.min(1.08, Math.max(0.92, Math.sqrt(hf.width / 0.17))) / itemW : hf.width * (f.widthEase ?? 1.1) / itemW;
  const BP = B.low.welded.pos, BI = B.low.welded.idx, sw = B.weldedWeights;
  const isHeadTri = (t, withNeck) => { for (let k = 0; k < 3; k++) { const j = sw.joints[BI[t * 3 + k] * 4]; if (j === HEAD || (withNeck && j === NECK)) return true; } return false; };
  const out = new Float32Array(n * 3);
  let tx, ty, tz, solve;
  if (f.mode === 'hat') {
    tx = hf.cx - itemCx * s; tz = hf.cz - itemCz * s + (f.zShift ?? 0);
    // start high, drop onto the head
    const yStart = hf.top + 0.05 - bb.min[1] * s;
    const cell = 0.002;
    const grid = () => makeGrid(hf.cx - 0.25, hf.cx + 0.25, hf.cz - 0.25, hf.cz + 0.25, cell, NaN);
    const gi = grid(); gi.v.fill(-Infinity); const gh = grid(); gh.v.fill(-Infinity);
    const Pi = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { Pi[i * 3] = P0[i * 3] * s + tx; Pi[i * 3 + 1] = P0[i * 3 + 1] * s + yStart; Pi[i * 3 + 2] = P0[i * 3 + 2] * s + tz; }
    // SHELL rule: the item's inner surface is taken as its OUTER (top) surface minus a shell
    // thickness, so hollow and closed (solid-reconstructed) hats rest the same way
    field(Pi, W.idx, null, [0, 2, 1], cell, 'max', gi);
    field(BP, BI, t => isHeadTri(t, false), [0, 2, 1], cell, 'max', gh);
    const thick = f.thickness ?? 0.012;
    // contact only over the CENTRAL crown (radius < `centralFrac` x item half width): brims and rims
    // sit around the head and may cover its sides (hidden by the body mask), the crown rests on top
    const rC = (f.centralFrac ?? 0.6) * itemW * s / 2;
    let need = -Infinity, cells = 0;
    for (let o = 0; o < gi.v.length; o++) {
      if (!(gi.v[o] > -Infinity && gh.v[o] > -Infinity)) continue;
      const ax = (o % gi.na + 0.5) * cell + gi.a0 - hf.cx, az = (Math.floor(o / gi.na) + 0.5) * cell + gi.b0 - hf.cz;
      if (Math.hypot(ax, az) > rC) continue;
      cells++; need = Math.max(need, gh.v[o] - (gi.v[o] - thick));
    }
    const gap = f.gap ?? 0;
    let lift = (need === -Infinity ? -0.05 : need) + gap; // >0: must go up; <0: can drop
    // eyes stay clear: the item's lowest point in front of the face centre stays above the eye line
    let frontLow = Infinity;
    for (let i = 0; i < n; i++) { const x = P0[i * 3] * s + tx, z = P0[i * 3 + 2] * s + tz; if (Math.abs(x - hf.cx) < 0.035 && z > hf.noseZ - 0.06) frontLow = Math.min(frontLow, P0[i * 3 + 1] * s + yStart + lift); }
    const eyeClear = hf.noseY + (f.clearAboveNose ?? 0.05);
    const eyeLift = frontLow < eyeClear ? eyeClear - frontLow : 0;
    lift += eyeLift;
    ty = yStart + lift;
    solve = {mode: 'drop onto head height field (2 mm cells): item top surface - shell thickness rests on the head; lifted if the front rim would cover the eyes', thicknessM: thick, contactCells: cells, gapM: gap, eyeClearLiftM: +eyeLift.toFixed(4), rimBelowHeadTopM: +(hf.top - (ty + bb.min[1] * s)).toFixed(4)};
  } else {
    // face items: vertical fit - item top at nose + `above`, bottom at chin - `below`; the scale is
    // raised if the item would be narrower than the cheeks x `minWidthEase`
    const topT = hf.noseY + (f.above ?? 0.07), botT = hf.chinY - (f.below ?? 0.02);
    s = (topT - botT) / h0;
    s = Math.max(s, hf.cheekWidth * (f.minWidthEase ?? 0.9) / itemW);
    tx = hf.cx - itemCx * s;
    ty = topT - bb.max[1] * s;
    const hh = hf.headHeight;
    const zStart = hf.cz - 0.3 - bb.min[2] * s; // far behind: solve forward
    const cell = 0.002;
    const mk = () => makeGrid(hf.cx - 0.25, hf.cx + 0.25, hf.top - 0.45, hf.top + 0.05, cell, NaN);
    const gi = mk(); gi.v.fill(-Infinity); const gh = mk(); gh.v.fill(-Infinity);
    const Pi = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { Pi[i * 3] = P0[i * 3] * s + tx; Pi[i * 3 + 1] = P0[i * 3 + 1] * s + ty; Pi[i * 3 + 2] = P0[i * 3 + 2] * s + zStart; }
    // SHELL rule (as hats): inner surface = item FRONT surface - shell thickness
    field(Pi, W.idx, null, [0, 1, 2], cell, 'max', gi);
    field(BP, BI, t => isHeadTri(t, true), [0, 1, 2], cell, 'max', gh);
    const thick = f.thickness ?? 0.006;
    // contact only over the central face window: the nose / mouth / eyes must sit inside the shell;
    // the rim seals onto forehead / cheeks / chin and may sink in slightly (the enclosed face
    // triangles are hidden by the body mask)
    // the contact zone is the nose / eyes / mouth window around the nose tip (`zone` = half sizes m)
    const [zx, zy0, zy1] = f.zone ?? [0.035, -0.035, 0.03];
    let need = -Infinity, cells = 0, bind = -1;
    for (let o = 0; o < gi.v.length; o++) {
      if (!(gi.v[o] > -Infinity && gh.v[o] > -Infinity)) continue;
      const ax = (o % gi.na + 0.5) * cell + gi.a0 - hf.cx, ay = (Math.floor(o / gi.na) + 0.5) * cell + gi.b0 - hf.noseY;
      if (Math.abs(ax) > zx || ay < zy0 || ay > zy1) continue;
      cells++; const d = gh.v[o] - (gi.v[o] - thick); if (d > need) { need = d; bind = o; }
    }
    const bindAt = bind < 0 ? null : [+((bind % gi.na + 0.5) * cell + gi.a0 - hf.cx).toFixed(3), +((Math.floor(bind / gi.na) + 0.5) * cell + gi.b0 - hf.top).toFixed(3)];
    const gap = f.gap ?? 0.002;
    tz = zStart + need + gap;
    solve = {mode: 'forward onto face/neck depth field (2 mm cells): item front surface - shell thickness clears the face', thicknessM: thick, contactCells: cells, gapM: gap, bindingCellXYRelHeadTopM: bindAt, itemTopY: +topT.toFixed(4), itemBottomY: +botT.toFixed(4), headHeightM: +hh.toFixed(4)};
  }
  for (let i = 0; i < n; i++) { out[i * 3] = P0[i * 3] * s + tx; out[i * 3 + 1] = P0[i * 3 + 1] * s + ty; out[i * 3 + 2] = P0[i * 3 + 2] * s + tz; }
  const halfW = itemW * s / 2;
  return {pos: out, transform: {scale: +s.toFixed(5), translate: [tx, ty, tz].map(v => +v.toFixed(5))},
    stats: {head: {topM: +hf.top.toFixed(4), craniumWidthM: +hf.width.toFixed(4), centre: [+hf.cx.toFixed(4), +hf.cz.toFixed(4)], noseY: +hf.noseY.toFixed(4), chinY: +hf.chinY.toFixed(4), cheekWidthM: +hf.cheekWidth.toFixed(4)}, itemWidthM: +(itemW * s).toFixed(4), solve,
      bulkHeadM: +Math.max(0, Math.min(0.04, (halfW - hf.width / 2) * 0.6)).toFixed(4),
      method: (f.mode === 'hat' ? (f.targetWidthM ? `uniform scale: item width at ${f.widthLevel} of its height = ${f.targetWidthM} m x sqrt(cranium width / 0.17) (clamped +-8%)` : `uniform scale = cranium width x ${f.widthEase} / item width at ${f.widthLevel} of its height`) : `uniform scale from nose + ${f.above ?? 0.07} m to chin - ${f.below ?? 0.02} m (>= cheeks x ${f.minWidthEase ?? 0.9})`) + `; ${solve.mode}; 100% Head weights (rigid)`}};
}
