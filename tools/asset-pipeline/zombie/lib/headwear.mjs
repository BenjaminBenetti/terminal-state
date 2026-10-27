// Iteration 07 (Lane W): headwear fitted to the measured CRANIUM, not to hair / hood / head bounds.
//
// Iteration 06 scaled hats from a real-world width at 45% of the item height x the head envelope width
// (hair and ears included) and then LIFTED them until the brim cleared the eyes: the hard hat ended up
// ~0.27 m wide and floated 5-9 cm above the crown ("too big, looks silly").
//
// measureHead(B): plane slices of the Head-weighted outer skin give, per 1 cm level, the envelope width
//   / length; landmarks: nose tip (front-most midline point near the Head joint), brow = nose + 4.5 cm,
//   forehead (front-most midline point 3 cm above the brow). Hair cannot be separated from skull
//   geometrically (nor reliably by colour on these textures), so the CRANIUM is the envelope above the
//   ears (brow + 1.5 .. 6 cm) capped by adult anthropometric maxima (head breadth <= 17 cm, head
//   length <= 20.8 cm) - extra envelope is hair, which a hat compresses; cranium top = min(envelope top,
//   brow + 10.5 cm, the adult glabella-vertex height); cranium centre aligned to the face (forehead minus half the length), not to a bun
//   or hood.
// fitHat(stage, cfg, B): the item (nominal space, opening at y = 0, facing +Z) is measured at its band
//   level (where a head band / sweatband sits; per item); per-axis scale so the band's outer width /
//   length = cranium + 2 x (gap + shell thickness) (gap = suspension clearance: hard hat ~2 cm, caps /
//   beanies snug), the height so the inside of the crown clears the cranium top (+ suspension) when the
//   band sits `bandAboveBrow` above the brow; proportions clamped to plausible ranges; placed level,
//   centred on the cranium. Head triangles above the band inside the band ellipse (x 1.3, hair) are
//   hidden (hair compressed under the hat); the face below the band stays visible. Stats report the
//   final item dimensions and how they relate to the cranium (tests assert real-world ranges).
import {JOINT_NAMES} from './skin.mjs';
import {TriGrid} from './penetration.mjs';

const HEAD = JOINT_NAMES.indexOf('Head');
const r4 = v => +(+v).toFixed(4);

function sliceSegments(P, I, tris, y) {
  const pts = [];
  for (const t of tris) {
    for (let e = 0; e < 3; e++) {
      const a = I[t * 3 + e] * 3, b = I[t * 3 + (e + 1) % 3] * 3;
      const ya = P[a + 1], yb = P[b + 1];
      if ((ya - y) * (yb - y) >= 0) continue;
      const u = (y - ya) / (yb - ya);
      pts.push([P[a] + u * (P[b] - P[a]), P[a + 2] + u * (P[b + 2] - P[a + 2])]);
    }
  }
  return pts;
}

/**
 * Cranium + face landmarks of body B (welded low mesh + skin weights). Per 5 mm level the REQUIRED box a
 * hat must contain: the head envelope clamped to the anthropometric cranium box (breadth <= maxBreadth
 * = 17 cm, length <= maxLength = 20.8 cm, centred on the face: forehead minus half the length). Hair
 * cannot be told from skin reliably on these AI textures (tested: dark zombie skin, dirt and hair overlap
 * in colour), so an envelope beyond the anthropometric cranium is treated as hair and compressed; a
 * bare head (heavyset: 17.6 cm) is contained whole.
 */
export function measureHead(B, {maxBreadth = 0.17, maxLength = 0.208, browAboveNose = 0.045} = {}) {
  const P = B.low.welded.pos, I = B.low.welded.idx, sw = B.weldedWeights;
  const isHead = v => sw.joints[v * 4] === HEAD && sw.weights[v * 4] > 0.5;
  const tris = [];
  for (let t = 0; t < I.length / 3; t++) { let k = 0; for (let c = 0; c < 3; c++) if (isHead(I[t * 3 + c])) k++; if (k >= 2) tris.push(t); }
  let top = -Infinity, cxs = 0, cn = 0;
  for (const t of tris) for (let c = 0; c < 3; c++) { const v = I[t * 3 + c]; top = Math.max(top, P[v * 3 + 1]); cxs += P[v * 3]; cn++; }
  const midX = cxs / cn;
  const hj = B.skel.joints.Head;
  // nose tip: front-most point near the midline around the Head joint height
  let nose = null;
  for (const t of tris) for (let c = 0; c < 3; c++) {
    const v = I[t * 3 + c], x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (Math.abs(x - midX) > 0.02 || y < hj[1] - 0.06 || y > hj[1] + 0.05) continue;
    if (!nose || z > nose[2]) nose = [x, y, z];
  }
  const browY = nose[1] + browAboveNose;
  const raw = [];
  for (let y = browY - 0.06; y < top - 0.003; y += 0.005) {
    const pts = sliceSegments(P, I, tris, y);
    if (pts.length < 6) continue;
    const e = {x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity};
    let fz = -Infinity;
    for (const [x, z] of pts) {
      e.x0 = Math.min(e.x0, x); e.x1 = Math.max(e.x1, x); e.z0 = Math.min(e.z0, z); e.z1 = Math.max(e.z1, z);
      if (Math.abs(x - midX) < 0.02) fz = Math.max(fz, z);
    }
    raw.push({y, env: e, frontZ: fz, cx: (e.x0 + e.x1) / 2});
  }
  const near = yy => raw.reduce((b, l) => Math.abs(l.y - yy) < Math.abs(b.y - yy) ? l : b, raw[0]);
  const fh = near(browY + 0.03);
  const foreheadZ = Number.isFinite(fh.frontZ) ? fh.frontZ : fh.env.z1;
  const bandLv = raw.filter(l => l.y >= browY + 0.015 && l.y <= browY + 0.06);
  const cx = bandLv.reduce((a, l) => a + l.cx, 0) / bandLv.length;
  const envB = Math.max(...bandLv.map(l => l.env.x1 - l.env.x0)), envL = Math.max(...bandLv.map(l => l.env.z1 - l.env.z0));
  // anthropometric cranium box (face aligned): hair beyond it may be compressed
  const capL = Math.min(envL, maxLength), cz0 = foreheadZ - capL / 2;
  const capX0 = cx - maxBreadth / 2, capX1 = cx + maxBreadth / 2, capZ0 = foreheadZ - capL, capZ1 = foreheadZ;
  const levels = raw.map(l => {
    const req = {x0: Math.max(l.env.x0, capX0), x1: Math.min(l.env.x1, capX1), z0: Math.max(l.env.z0, capZ0), z1: Math.min(l.env.z1, capZ1 + 0.01)};
    return {y: l.y, env: l.env, req, w: req.x1 - req.x0, l: req.z1 - req.z0};
  });
  const reqAt = y => { const l = levels.reduce((b, q) => Math.abs(q.y - y) < Math.abs(b.y - y) ? q : b, levels[0]); return l; };
  const band = levels.filter(l => l.y >= browY + 0.015 && l.y <= browY + 0.06);
  const breadth = Math.max(...band.map(l => l.w)), length = Math.max(...band.map(l => l.l));
  // cranium top: min(envelope top, brow + 10.5 cm = adult glabella-vertex height); taller envelope = hair
  const skullTop = Math.min(top, browY + 0.105);
  const bz = band.reduce((a, l) => a + (l.req.z0 + l.req.z1) / 2, 0) / band.length;
  return {top, skullTop, noseY: nose[1], noseZ: nose[2], browY, foreheadZ, envelope: {breadth: envB, length: envL}, breadth, length, cx, cz: bz, czFace: cz0,
    hairAllowance: {sides: Math.max(0, (envB - breadth) / 2), top: Math.max(0, top - skullTop)}, levels, reqAt, tris};
}

/** Slice an item (nominal space) at height y: outer width, back-half length x 2 (peaks / visors excluded), centre. */
function itemBand(P, y, h) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  for (let i = 0; i < P.length / 3; i++) {
    if (Math.abs(P[i * 3 + 1] - y) > 0.025 * h) continue;
    n++; x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]);
  }
  return {w: x1 - x0, cx: (x0 + x1) / 2, zBack: z0, zFront: z1, l: z1 - z0, n};
}

/**
 * Fit a hat (stage = rigidStage result, nominal space) to body B. cfg.fit (mode 'hat07'):
 *  bandLevel (fraction of item height where the head band sits), gapSide / gapFB (clearance from the
 *  required cranium box to the inside of the shell), gapTop (crown suspension), thick (shell),
 *  bandAboveBrow, lengthFrom: 'back' (length = 2 x the back half: front peaks / visors excluded) | 'full'.
 * The shell must contain the required cranium box (skin always, hair up to the anthropometric cranium)
 * at the band AND at every full-ring level between the rim and the band (no rim sinking into skin).
 */
export function fitHat(stage, cfg, B) {
  const f = cfg.fit;
  const W = stage.low.welded, P0 = W.pos, n = P0.length / 3;
  let ymin = Infinity, ymax = -Infinity; for (let i = 0; i < n; i++) { ymin = Math.min(ymin, P0[i * 3 + 1]); ymax = Math.max(ymax, P0[i * 3 + 1]); }
  const h = ymax - ymin;
  const yb = ymin + f.bandLevel * h;
  const bandN = itemBand(P0, yb, h);
  // band ring centre line (z) from its left / right extremes (front peaks / visors excluded)
  let zl = 0, zr = 0, nl = 0, nr = 0;
  for (let i = 0; i < n; i++) { if (Math.abs(P0[i * 3 + 1] - yb) > 0.025 * h) continue; const x = P0[i * 3]; if (x > bandN.cx + 0.4 * bandN.w) { zl += P0[i * 3 + 2]; nl++; } else if (x < bandN.cx - 0.4 * bandN.w) { zr += P0[i * 3 + 2]; nr++; } }
  const zMid = nl && nr ? (zl / nl + zr / nr) / 2 : (bandN.zBack + bandN.zFront) / 2;
  const lenOf = sl => f.lengthFrom === 'back' ? 2 * (zMid - sl.zBack) : sl.l;
  const bandL = lenOf(bandN);
  const bandCz = f.lengthFrom === 'back' ? zMid : (bandN.zBack + bandN.zFront) / 2;
  // full-ring item levels between the rim and the band (containment checks)
  const rings = [];
  for (let k = 0.02; k < f.bandLevel; k += 0.02) { const sl = itemBand(P0, ymin + k * h, h); if (sl.n >= 12 && sl.w >= 0.7 * bandN.w && lenOf(sl) >= 0.7 * bandL) rings.push({k, ...sl, L: lenOf(sl)}); }
  const hd = measureHead(B, f.head ?? {});
  const thick = f.thick ?? 0.004, gx = f.gapSide + thick, gz = f.gapFB + thick;
  const bandY = hd.browY + f.bandAboveBrow;
  const rb = hd.reqAt(bandY);
  let sx = (rb.w + 2 * gx) / bandN.w, sz = (rb.l + 2 * gz) / bandL, sy = 1, ty = 0;
  const clampR = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const crownOuter = hd.skullTop + (f.gapTop ?? 0) + thick - bandY;
  let syClamped = false;
  const ringLog = [];
  for (let it = 0; it < 3; it++) {
    const sxy = (sx + sz) / 2, syR = f.syRatio ?? [0.75, 1.15];
    const sy0 = crownOuter / (ymax - yb);
    sy = clampR(sy0, syR[0] * sxy, syR[1] * sxy); syClamped = sy !== sy0;
    sz = clampR(sz, (f.szRatio ?? [0.95, 1.45])[0] * sx, (f.szRatio ?? [0.95, 1.45])[1] * sx);
    ty = bandY - yb * sy;
    // containment below the band: grow (never shrink) so every ring holds the required cranium box
    let gsx = sx, gsz = sz;
    for (const r of (f.rings === false ? [] : rings)) {
      const y = (ymin + r.k * h) * sy + ty, q = hd.reqAt(y);
      if (y < hd.browY - 0.005) continue; // brims / peaks / cuffs below the brow are not head rings (ears, eyes)
      gsx = Math.max(gsx, (q.w + 2 * gx) / r.w); gsz = Math.max(gsz, (q.l + 2 * gz) / r.L);
    }
    gsx = Math.min(gsx, 1.12 * sx); gsz = Math.min(gsz, 1.12 * sz);
    if (gsx <= sx * 1.001 && gsz <= sz * 1.001) break;
    sx = gsx; sz = gsz;
  }
  for (const r of rings) { const y = (ymin + r.k * h) * sy + ty, q = hd.reqAt(y); if (y >= hd.browY - 0.005) ringLog.push({y: r4(y), clearSideM: r4((r.w * sx - q.w) / 2 - thick), clearFrontBackM: r4((r.L * sz - q.l) / 2 - thick)}); }
  const tx = hd.cx - bandN.cx * sx, tz = hd.cz - bandCz * sz + (f.zShift ?? 0);
  // eye clearance: the item's lowest point in front of the eyes stays above the upper eyelid line
  const eyeY = hd.noseY + (f.eyeAboveNose ?? 0.032);
  let frontLow = Infinity;
  for (let i = 0; i < n; i++) { const x = P0[i * 3] * sx + tx, z = P0[i * 3 + 2] * sz + tz; if (Math.abs(x - hd.cx) < 0.045 && z > hd.noseZ - 0.05) frontLow = Math.min(frontLow, P0[i * 3 + 1] * sy + ty); }
  const eyeLift = frontLow < eyeY ? eyeY - frontLow : 0;
  ty += eyeLift;
  let pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = P0[i * 3] * sx + tx; pos[i * 3 + 1] = P0[i * 3 + 1] * sy + ty; pos[i * 3 + 2] = P0[i * 3 + 2] * sz + tz; }
  // seat solve: a small forward pitch (back of the rim up, peak down - how hats are worn) and lift that
  // minimise head skin / hair sitting OVER the rim (rim edge dipping into the nape or temples), keeping
  // the eye line clear; ties keep the smaller change
  const seat = seatSolve(pos, W.idx, B, hd, bandY, eyeY, f);
  pos = seat.pos;
  const b = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity};
  for (let i = 0; i < n; i++) { b.x0 = Math.min(b.x0, pos[i * 3]); b.x1 = Math.max(b.x1, pos[i * 3]); b.y0 = Math.min(b.y0, pos[i * 3 + 1]); b.y1 = Math.max(b.y1, pos[i * 3 + 1]); b.z0 = Math.min(b.z0, pos[i * 3 + 2]); b.z1 = Math.max(b.z1, pos[i * 3 + 2]); }
  const bandYFinal = yb * sy + ty + seat.lift;
  const g = new TriGrid(pos, W.idx, 0.02);
  const above = g.ray(hd.cx, hd.skullTop, hd.cz, 0, 1, 0, 0.3);
  const crownClearM = above ? above.t - thick : null;
  return {pos, transform: {scale: [sx, sy, sz].map(r4), translate: [tx, ty, tz].map(r4)}, head: hd, bandY: bandYFinal,
    stats: {mode: 'hat07: cranium-fitted band + crown (lib/headwear.mjs)',
      cranium: {breadthM: r4(hd.breadth), lengthM: r4(hd.length), envelopeBreadthM: r4(hd.envelope.breadth), envelopeLengthM: r4(hd.envelope.length), topM: r4(hd.skullTop), meshTopM: r4(hd.top), browY: r4(hd.browY), noseY: r4(hd.noseY), hairAllowanceM: {sides: r4(hd.hairAllowance.sides), top: r4(hd.hairAllowance.top)}},
      item: {widthM: r4(b.x1 - b.x0), lengthM: r4(b.z1 - b.z0), heightM: r4(b.y1 - b.y0), bandWidthM: r4(bandN.w * sx), bandLengthM: r4(bandL * sz), bandY: r4(bandYFinal), bandAboveBrowM: r4(bandYFinal - hd.browY), topAboveCraniumM: r4(b.y1 - hd.skullTop), crownClearanceM: crownClearM == null ? null : r4(crownClearM), eyeLiftM: r4(eyeLift)},
      seat: seat.stats,
      containment: {bandClearSideM: r4((bandN.w * sx - rb.w) / 2 - thick), bandClearFrontBackM: r4((bandL * sz - rb.l) / 2 - thick), rings: ringLog},
      ratios: {widthToCraniumBreadth: r4((b.x1 - b.x0) / hd.breadth), bandToCraniumBreadth: r4(bandN.w * sx / hd.breadth)},
      params: {bandLevel: f.bandLevel, gapSide: f.gapSide, gapFB: f.gapFB, gapTop: f.gapTop ?? 0, thick, bandAboveBrow: f.bandAboveBrow, syClamped}}};
}

/** Head skin / hair vertices sitting over the rim: outward ray misses the item, inward ray meets its outer face within `depth`. */
function rimContacts(pos, idx, B, bandY, depth = 0.04) {
  const g = new TriGrid(pos, idx, 0.02), P = B.low.pos, N = B.low.nrm, J = B.joints, NECK = JOINT_NAMES.indexOf('Neck');
  let k = 0;
  for (let v = 0; v < P.length / 3; v++) {
    if (J[v * 4] !== HEAD && J[v * 4] !== NECK) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    if (y < bandY - 0.08 || y > bandY + 0.02) continue;
    if (g.ray(x - nx * 1e-4, y - ny * 1e-4, z - nz * 1e-4, nx, ny, nz, 0.06)) continue;
    if (g.ray(x + nx * 1e-4, y + ny * 1e-4, z + nz * 1e-4, -nx, -ny, -nz, depth, 0.0002, null, true)) k++;
  }
  return k;
}
function seatSolve(pos0, idx, B, hd, bandY, eyeY, f) {
  const n = pos0.length / 3, yc = bandY, zc = hd.cz;
  const place = (deg, lift) => {
    const t = deg * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t), p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const y = pos0[i * 3 + 1] - yc, z = pos0[i * 3 + 2] - zc; p[i * 3] = pos0[i * 3]; p[i * 3 + 1] = yc + y * c - z * sn + lift; p[i * 3 + 2] = zc + y * sn + z * c; }
    return p;
  };
  const eyeOk = p => { for (let i = 0; i < n; i++) if (Math.abs(p[i * 3] - hd.cx) < 0.045 && p[i * 3 + 2] > hd.noseZ - 0.05 && p[i * 3 + 1] < eyeY) return false; return true; };
  const base = rimContacts(pos0, idx, B, bandY);
  let best = {deg: 0, lift: 0, k: base, pos: pos0};
  for (const deg of f.pitchRange ?? [0, 2, 4, 6, 8]) for (const lift of f.liftRange ?? [0, 0.004, 0.008, 0.012]) {
    if (!deg && !lift) continue;
    const p = place(deg, lift);
    if (!eyeOk(p)) continue;
    const k = rimContacts(p, idx, B, bandY + lift);
    if (k < best.k - 2 || (k <= best.k && deg + lift * 500 < best.deg + best.lift * 500)) best = {deg, lift, k, pos: p};
  }
  return {pos: best.pos, lift: best.lift, stats: {pitchDeg: best.deg, liftM: best.lift, rimContactVerticesBefore: base, rimContactVerticesAfter: best.k, method: 'forward pitch 0-8 deg about the band centre + lift 0-12 mm minimising head vertices sitting over the rim (eye line kept clear)'}};
}

/**
 * Hat mask: Head-weighted body triangles whose vertices are all above (band - 4 mm) and inside the
 * band ellipse x `spread` (hair under the hat is compressed / hidden; face and nape below the band stay).
 */
export function hatMask(B, fit, {spread = 1.3, below = 0.004, rimDepth = 0.03, itemIdx = null} = {}) {
  const P = B.low.pos, I = B.low.idx, J = B.joints, n = I.length / 3;
  // skin the hat rim / cuff sits UNDER (the rim surface is right beneath it): poking vertices
  const poke = new Uint8Array(P.length / 3);
  if (itemIdx) {
    const g = new TriGrid(fit.pos, itemIdx, 0.02), N = B.low.nrm, NECK = JOINT_NAMES.indexOf('Neck');
    for (let v = 0; v < P.length / 3; v++) {
      if (J[v * 4] !== HEAD && J[v * 4] !== NECK) continue;
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      if (y < fit.bandY - 0.07) continue;
      if (g.ray(x - nx * 1e-4, y - ny * 1e-4, z - nz * 1e-4, nx, ny, nz, 0.06)) continue;
      if (g.ray(x + nx * 1e-4, y + ny * 1e-4, z + nz * 1e-4, -nx, -ny, -nz, rimDepth, 0.0002, null, true)) poke[v] = 1;
    }
  }
  const hd = fit.head;
  const ax = (fit.stats.item.bandWidthM / 2) * spread, az = (fit.stats.item.bandLengthM / 2) * spread;
  const hide = new Uint8Array(n);
  let hidden = 0, rimHidden = 0;
  for (let t = 0; t < n; t++) {
    if (poke[I[t * 3]] + poke[I[t * 3 + 1]] + poke[I[t * 3 + 2]] >= 2) { hide[t] = 1; hidden++; rimHidden++; continue; }
    let ok = true;
    for (let c = 0; c < 3; c++) {
      const v = I[t * 3 + c];
      if (J[v * 4] !== HEAD && J[v * 4] !== JOINT_NAMES.indexOf('Neck')) { ok = false; break; }
      const x = P[v * 3] - hd.cx, y = P[v * 3 + 1], z = P[v * 3 + 2] - hd.cz;
      if (y < fit.bandY - below || (x * x) / (ax * ax) + (z * z) / (az * az) > 1) { ok = false; break; }
    }
    if (ok) { hide[t] = 1; hidden++; }
  }
  return {hide, hidden, total: n, fraction: +(hidden / n).toFixed(4), rimHidden, method: `Head triangles entirely above the hat band - ${below * 1000} mm and inside the band ellipse x ${spread} (hair compressed under the hat), plus head triangles the rim / cuff sits under (>= 2 vertices whose inward ray meets the item within ${rimDepth * 1000} mm); face / ears / nape below the band stay visible`};
}

