// Task studio-beta-fuel-feedback-20261106-064128-01 (lane ASSET): a deterministic BACK-LABEL REPAIR of a Meshy single-view derivative.
//
// User (fuel can): "Fuel spelled in reverse on the back side, looks good otherwise". Meshy's single-image image-to-3D paints the hidden
// back broad side with the FRONT's stencil seen "through" the model: the back texel at world (x, y) carries the front's paint at the
// same (x, y), so from behind the word reads mirrored. This is PROCESSING of the model's own Meshy maps (no generation, no new art, no
// reprojection of other images): inside a feathered label region of the back panel, every texel takes the paint of the SAME back
// panel at the mirrored position (2 * axisX - x, y), which turns the back's own stencil the right way round; every other texel of
// every map is kept bit-for-bit (the caller then re-encodes as before).
//
// Texture-space resampling, island-independent (Meshy atlases are many small rotated / flipped islands; the letters cross several):
//   1. every triangle is rasterised in UV space (texel centres) -> an owner map;
//   2. a texel owned by a BACK-panel triangle (face normal z <= -nzMin) gets its 3D point p (barycentric) and a region weight w(p)
//      (1 inside the box, smoothstep feather to 0 over `feather` m outside it); w > 0 -> the mirrored point q = (2 * axisX - p.x, p.y)
//      is located on the back panel (2D point location among back triangles; the outermost surface toward -Z wins) and every map is
//      sampled there BILINEARLY from the ORIGINAL decoded texture (never from partially written output);
//   3. base colour and metallic-roughness: out = lerp(orig, sample, w);
//      normal (tangent space, glTF / three.js derivative frame without TANGENT: T = grad u, B = -grad v, common scale): the sampled
//      perturbation is mirrored in WORLD space (reflection x -> 2 * axisX - x) and re-expressed in the target texel's own frame (a 2x2
//      map from the source frame to the target frame, z kept; this is the "negate tangent X" of an unrotated island, generalised to
//      Meshy's rotated / flipped islands), then lerped with the original by w and renormalised;
//   4. seams: gutter texels (owned by no triangle) within `dilate` texels whose NEAREST owned texel was repaired copy that texel's
//      new value in every map (classic UV padding), so bilinear / mip sampling at island edges never mixes in the stale mirrored paint;
//      gutter texels nearer to another island keep their value.
// Returns a report; the repaired textures are written back losslessly (PNG) for the caller's normal re-encode.

/** Triangles of a primitive as index triples (non-indexed primitives get an implicit index). */
function triIndex(prim) {
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = idx ? idx.getScalar(i) : i;
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.sqrt(dot(a, a));

/** Surface gradients of u and v on a triangle (in its plane): grad . E1 = du1, grad . E2 = du2. */
function uvGradients(p, uv) {
  const e1 = sub(p[1], p[0]), e2 = sub(p[2], p[0]);
  const du1 = uv[1][0] - uv[0][0], du2 = uv[2][0] - uv[0][0], dv1 = uv[1][1] - uv[0][1], dv2 = uv[2][1] - uv[0][1];
  const a = dot(e1, e1), b = dot(e1, e2), c = dot(e2, e2), det = a * c - b * b;
  if (!(Math.abs(det) > 1e-24)) return null;
  const solve = (r1, r2) => { const x = (c * r1 - b * r2) / det, y = (a * r2 - b * r1) / det; return [0, 1, 2].map(k => x * e1[k] + y * e2[k]); };
  const gu = solve(du1, du2), gv = solve(dv1, dv2);
  const s = 1 / Math.max(len(gu), len(gv));
  if (!Number.isFinite(s)) return null;
  // three.js (no TANGENT attribute): T = grad u, B = grad v, one common scale; GLTFLoader sets normalScale.y = -1 -> image-up = -grad v
  return {T: gu.map(x => x * s), B: gv.map(x => -x * s)};
}

/** Coordinates of w in the (non-orthonormal) basis e1, e2 of a plane (least squares / Gram system). */
function coords(w, e1, e2) {
  const a = dot(e1, e1), b = dot(e1, e2), c = dot(e2, e2), det = a * c - b * b;
  const r1 = dot(e1, w), r2 = dot(e2, w);
  return [(c * r1 - b * r2) / det, (a * r2 - b * r1) / det];
}

/**
 * Mirror the back panel's label region of `material`'s base colour / metallic-roughness / normal maps in place.
 * @param doc       gltf-transform Document in its FINAL frame (front +Z, the label's broad back side facing -Z)
 * @param sharp     the sharp module (decode / lossless re-encode)
 * @param opts      {region: {halfWidth, y0, y1}, axisX = 0, feather, nzMin = 0.05, dilate = 8}: region / feather in metres; nzMin: back-facing
 *                  triangles are those with face normal z <= -nzMin (0.05 = any back-facing slope, so steep ridge flanks find their mirror)
 */
export async function mirrorBackLabel(doc, sharp, {region, axisX = 0, feather, nzMin = 0.05, dilate = 8}) {
  const root = doc.getRoot();
  const mats = root.listMaterials();
  if (mats.length !== 1) throw new Error(`mirrorBackLabel: expected one material, got ${mats.length}`);
  const mat = mats[0];
  const prims = root.listMeshes().flatMap(m => m.listPrimitives()).filter(p => p.getMaterial() === mat);
  if (prims.length !== 1) throw new Error(`mirrorBackLabel: expected one primitive, got ${prims.length}`);
  const prim = prims[0];
  for (const n of root.listNodes()) if (n.getMesh() && n.getMatrix().some((v, i) => v !== [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i])) throw new Error('mirrorBackLabel: node transforms must be baked');
  const slots = [['baseColor', mat.getBaseColorTexture()], ['metallicRoughness', mat.getMetallicRoughnessTexture()], ['normal', mat.getNormalTexture()]];
  for (const [slot, t] of slots) if (!t) throw new Error(`mirrorBackLabel: no ${slot} texture`);
  for (const ti of [mat.getBaseColorTextureInfo(), mat.getMetallicRoughnessTextureInfo(), mat.getNormalTextureInfo()]) if (ti.getTexCoord() !== 0) throw new Error('mirrorBackLabel: TEXCOORD_0 only');
  if (mat.getNormalScale() !== 1) throw new Error('mirrorBackLabel: normal scale 1 expected');
  const maps = [];
  for (const [slot, tex] of slots) {
    const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true});
    maps.push({slot, tex, src: data, out: Buffer.from(data), W: info.width, H: info.height});
  }
  const {W, H} = maps[0];
  if (maps.some(m => m.W !== W || m.H !== H)) throw new Error('mirrorBackLabel: the three maps must share one size');

  // triangles (final frame), UVs, face normals, vertex normals, derivative tangent frames
  const pos = prim.getAttribute('POSITION'), uvA = prim.getAttribute('TEXCOORD_0');
  const I = triIndex(prim);
  const tris = [];
  for (let t = 0; t < I.length; t += 3) {
    const p = [0, 1, 2].map(k => pos.getElement(I[t + k], [0, 0, 0]));
    const uv = [0, 1, 2].map(k => uvA.getElement(I[t + k], [0, 0]));
    for (const q of uv) if (q[0] < 0 || q[0] > 1 || q[1] < 0 || q[1] > 1) throw new Error('mirrorBackLabel: UVs outside [0, 1]');
    const fn = cross(sub(p[1], p[0]), sub(p[2], p[0])), l = len(fn);
    tris.push({p, uv, n: l > 0 ? fn.map(x => x / l) : [0, 0, 0], frame: uvGradients(p, uv)});
  }
  const back = tris.map((t, i) => i).filter(i => tris[i].n[2] <= -nzMin && tris[i].frame);

  // 2D point location on the back panel (x / y buckets)
  const G = 0.005;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const i of back) for (const q of tris[i].p) { bx0 = Math.min(bx0, q[0]); by0 = Math.min(by0, q[1]); bx1 = Math.max(bx1, q[0]); by1 = Math.max(by1, q[1]); }
  const cols = Math.floor((bx1 - bx0) / G) + 1, rows = Math.floor((by1 - by0) / G) + 1;
  const buckets = Array.from({length: cols * rows}, () => []);
  for (const i of back) {
    const ps = tris[i].p;
    const c0 = Math.floor((Math.min(ps[0][0], ps[1][0], ps[2][0]) - bx0) / G), c1 = Math.floor((Math.max(ps[0][0], ps[1][0], ps[2][0]) - bx0) / G);
    const r0 = Math.floor((Math.min(ps[0][1], ps[1][1], ps[2][1]) - by0) / G), r1 = Math.floor((Math.max(ps[0][1], ps[1][1], ps[2][1]) - by0) / G);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * cols + c].push(i);
  }
  const locate = (x, y) => {
    const c = Math.floor((x - bx0) / G), r = Math.floor((y - by0) / G);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    let best = null;
    for (const i of buckets[r * cols + c]) {
      const [a, b, cc] = tris[i].p;
      const d = (b[0] - a[0]) * (cc[1] - a[1]) - (cc[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(d) < 1e-14) continue;
      const w1 = ((x - a[0]) * (cc[1] - a[1]) - (cc[0] - a[0]) * (y - a[1])) / d, w2 = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / d, w0 = 1 - w1 - w2;
      if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * cc[2];
      if (!best || z < best.z) best = {i, w: [w0, w1, w2], z}; // the outermost back surface (toward -Z) wins
    }
    return best;
  };
  const weight = p => {
    const dx = Math.max(0, Math.abs(p[0] - axisX) - region.halfWidth), dy = Math.max(0, region.y0 - p[1], p[1] - region.y1);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= feather) return 0;
    const s = 1 - d / feather;
    return s * s * (3 - 2 * s);
  };
  const bilinear = (m, u, v, out) => {
    const fx = Math.min(W - 1, Math.max(0, u * W - 0.5)), fy = Math.min(H - 1, Math.max(0, v * H - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    for (let ch = 0; ch < 3; ch++) {
      const a = m.src[(y0 * W + x0) * 3 + ch], b = m.src[(y0 * W + x1) * 3 + ch], c = m.src[(y1 * W + x0) * 3 + ch], d = m.src[(y1 * W + x1) * 3 + ch];
      out[ch] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
    }
    return out;
  };

  // 1. owner map (texel centres; first triangle wins on overlaps)
  const owner = new Int32Array(W * H).fill(-1);
  tris.forEach((t, i) => {
    const U = t.uv.map(q => [q[0] * W - 0.5, q[1] * H - 0.5]);
    const d = (U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (U[1][1] - U[0][1]);
    if (Math.abs(d) < 1e-12) return;
    const x0 = Math.max(0, Math.floor(Math.min(U[0][0], U[1][0], U[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(U[0][0], U[1][0], U[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(U[0][1], U[1][1], U[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(U[0][1], U[1][1], U[2][1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const w1 = ((x - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (y - U[0][1])) / d;
      const w2 = ((U[1][0] - U[0][0]) * (y - U[0][1]) - (x - U[0][0]) * (U[1][1] - U[0][1])) / d;
      if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
      if (owner[y * W + x] < 0) owner[y * W + x] = i;
    }
  });

  // 2./3. repaired texels
  const isBack = new Uint8Array(tris.length);
  for (const i of back) isBack[i] = 1;
  const changed = new Uint8Array(W * H);
  const report = {texels: 0, feathered: 0, missingSource: 0, gutter: 0, maxWeight: 0};
  const s3 = [0, 0, 0], nOrig = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x, ti = owner[k];
    if (ti < 0 || !isBack[ti]) continue;
    const t = tris[ti];
    const U = t.uv.map(q => [q[0] * W - 0.5, q[1] * H - 0.5]);
    const d = (U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (U[1][1] - U[0][1]);
    const w1 = ((x - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (y - U[0][1])) / d;
    const w2 = ((U[1][0] - U[0][0]) * (y - U[0][1]) - (x - U[0][0]) * (U[1][1] - U[0][1])) / d, w0 = 1 - w1 - w2;
    const p = [0, 1, 2].map(c => w0 * t.p[0][c] + w1 * t.p[1][c] + w2 * t.p[2][c]);
    const w = weight(p);
    if (w <= 0) continue;
    const hit = locate(2 * axisX - p[0], p[1]);
    if (!hit) { report.missingSource++; continue; }
    const tq = tris[hit.i];
    const su = hit.w[0] * tq.uv[0][0] + hit.w[1] * tq.uv[1][0] + hit.w[2] * tq.uv[2][0], sv = hit.w[0] * tq.uv[0][1] + hit.w[1] * tq.uv[1][1] + hit.w[2] * tq.uv[2][1];
    report.texels++;
    if (w < 1) report.feathered++;
    report.maxWeight = Math.max(report.maxWeight, w);
    changed[k] = 1;
    for (const m of maps) {
      bilinear(m, su, sv, s3);
      const o = k * 3;
      if (m.slot !== 'normal') {
        for (let ch = 0; ch < 3; ch++) m.out[o + ch] = Math.round(m.src[o + ch] * (1 - w) + s3[ch] * w);
        continue;
      }
      // tangent-space normal: source frame (tq) -> world reflection x -> -x -> target frame (t)
      const ms = s3.map(c => c / 127.5 - 1);
      const RT = [-tq.frame.T[0], tq.frame.T[1], tq.frame.T[2]], RB = [-tq.frame.B[0], tq.frame.B[1], tq.frame.B[2]];
      const a = coords(RT, t.frame.T, t.frame.B), b = coords(RB, t.frame.T, t.frame.B);
      const mm = [a[0] * ms[0] + b[0] * ms[1], a[1] * ms[0] + b[1] * ms[1], ms[2]];
      let l = len(mm) || 1;
      for (let ch = 0; ch < 3; ch++) nOrig[ch] = m.src[o + ch] / 127.5 - 1;
      const lo = len(nOrig) || 1;
      const mix = [0, 1, 2].map(ch => nOrig[ch] / lo * (1 - w) + mm[ch] / l * w);
      l = len(mix) || 1;
      for (let ch = 0; ch < 3; ch++) m.out[o + ch] = Math.max(0, Math.min(255, Math.round((mix[ch] / l + 1) * 127.5)));
    }
  }

  // 4. gutter padding: unowned texels near a repaired texel copy their nearest owned texel when that one was repaired
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!changed[y * W + x]) continue;
    for (let dy = -dilate; dy <= dilate; dy++) for (let dx = -dilate; dx <= dilate; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && owner[yy * W + xx] < 0) near[yy * W + xx] = 1;
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!near[k]) continue;
    let best = -1, bd = Infinity;
    for (let dy = -dilate; dy <= dilate; dy++) for (let dx = -dilate; dx <= dilate; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || owner[yy * W + xx] < 0) continue;
      const dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = yy * W + xx; }
    }
    if (best < 0 || !changed[best]) continue;
    report.gutter++;
    for (const m of maps) for (let ch = 0; ch < 3; ch++) m.out[k * 3 + ch] = m.out[best * 3 + ch];
  }

  report.backTriangles = back.length;
  report.maps = {};
  for (const m of maps) {
    let diff = 0;
    for (let k = 0; k < W * H; k++) if (m.out[k * 3] !== m.src[k * 3] || m.out[k * 3 + 1] !== m.src[k * 3 + 1] || m.out[k * 3 + 2] !== m.src[k * 3 + 2]) diff++;
    report.maps[m.slot] = {size: [W, H], changedTexels: diff};
    m.tex.setImage(new Uint8Array(await sharp(m.out, {raw: {width: W, height: H, channels: 3}}).png({compressionLevel: 1}).toBuffer())).setMimeType('image/png');
  }
  return report;
}
