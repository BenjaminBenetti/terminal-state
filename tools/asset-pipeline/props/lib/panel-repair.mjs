// Task mall-round2-20261031 (Studio Beta, lane PROPS, M04): LOCAL REPAIRS of a broken flat panel in a Meshy derivative (no regeneration;
// the raw master is untouched). Pure, deterministic gltf-transform helpers applied by build-mall-track3.mjs EDITS in the final derivative
// frame (front -Z, grounded, centred), measured with CPU plane-layer maps / depth maps / z-fight probes (task evidence lanes/PROPS-*).
//
// User: "the back of the 'cooler' prop has some messed up geometry" (M30 open multideck, label 'open cooler'). Measured on
// mall-multideck-open-cooler.glb: its inner back wall (z +0.340, the wall a shopper sees through the open front) is a ZERO-THICKNESS
// DOUBLE SHEET — a -Z-facing and a +Z-facing triangle layer in the same plane over 78 % of the wall (double-sided material: both drawn,
// z-fighting) — with two large wedge-shaped HOLES (21 %, ~0.53 m2, a 'V') where neither layer exists, so the inside of the outer back
// shell 13 cm behind shows through; the refine texture of that outer back even carries a painted ghost of the shelves seen through the
// V. One shelf piece (1.20 m shelf, its centre-right segment) is warped: a front corner raised 11 cm.
//
//   rebuildPanel     removes every triangle of an axis-plane slab inside a rectangle (both facings) and closes the rectangle with ONE
//                    clean quad facing `facing`, UV-mapped linearly onto a small UNIFORM patch of the model's own atlas (measured inside
//                    the wall's own texture island: flat normal, even colour) — non-degenerate UVs, so derivative-based tangent frames
//                    (no TANGENT attribute) stay valid.
//   snapVertices     moves the vertices inside a box onto a plane coordinate (the warped corner back onto its shelf plane); their normals
//                    become the axis direction with their current sign.
//   cleanPanelGhosts refills texels of a painted ghost on an axis-plane face (restricted to a 3D region of that face) from clean texels
//                    of the same face in every map (base colour, metallic-roughness, normal), like clutter-split cleanSupportTexture.
import {compactPrimitive} from '@gltf-transform/functions';

/** Triangles of a primitive as index triples. */
function triIndex(prim) {
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = idx ? idx.getScalar(i) : i;
  return out;
}
const AX = [[1, 2], [2, 0], [0, 1]]; // in-plane axes (right-handed: a x b = axis)
const r5 = v => +v.toFixed(5);

function faceOf(pos, I, t) {
  const p = [0, 1, 2].map(k => pos.getElement(I[t + k], [0, 0, 0]));
  const e1 = [0, 1, 2].map(k => p[1][k] - p[0][k]), e2 = [0, 1, 2].map(k => p[2][k] - p[0][k]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n);
  return {p, n: l > 0 ? n.map(x => x / l) : [0, 0, 0], area: l / 2};
}

/**
 * Rear-panel rebuild. `rect` = [a0, a1, b0, b1] on the two in-plane axes (axis 2 -> x, y). Removes triangles whose three vertices lie
 * within `tol` of the plane `at` and inside the rectangle (+1 mm), with |normal . axis| >= 0.98; adds one quad (2 triangles) over the
 * rectangle at `at`, normal = facing * axis, UV = uv.centre + uv.perMetre * (in-plane offset from the rectangle centre) (v follows -b, the
 * glTF image-down convention). The single primitive must carry POSITION / NORMAL / TEXCOORD_0 only (checked). Returns a provenance record.
 */
export function rebuildPanel(doc, {axis, at, tol, facing, rect, uv}) {
  const [ia, ib] = AX[axis];
  const [a0, a1, b0, b1] = rect;
  const rec = {axis, at, tol, facing, rect, uv, removed: {tris: 0, facingPlus: 0, facingMinus: 0, areaM2: 0}, added: 0};
  const prims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
  if (prims.length !== 1) throw new Error(`rebuildPanel: expected one primitive, got ${prims.length}`);
  const prim = prims[0];
  const sem = prim.listSemantics().sort().join(',');
  if (sem !== 'NORMAL,POSITION,TEXCOORD_0') throw new Error(`rebuildPanel: unsupported attributes ${sem}`);
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tex = prim.getAttribute('TEXCOORD_0');
  for (const a of [pos, nor, tex]) if (a.getNormalized() || !(a.getArray() instanceof Float32Array)) throw new Error('rebuildPanel: quantised attributes are unsupported');
  const I = triIndex(prim), keep = [];
  for (let t = 0; t < I.length; t += 3) {
    const f = faceOf(pos, I, t);
    const inSlab = f.p.every(q => Math.abs(q[axis] - at) <= tol && q[ia] >= a0 - 1e-3 && q[ia] <= a1 + 1e-3 && q[ib] >= b0 - 1e-3 && q[ib] <= b1 + 1e-3);
    if (inSlab && Math.abs(f.n[axis]) >= 0.98) {
      rec.removed.tris++; rec.removed[f.n[axis] > 0 ? 'facingPlus' : 'facingMinus']++; rec.removed.areaM2 += f.area;
      continue;
    }
    keep.push(I[t], I[t + 1], I[t + 2]);
  }
  if (!rec.removed.tris) throw new Error('rebuildPanel: nothing selected');
  // the new quad: corners (a0,b0) (a1,b0) (a1,b1) (a0,b1)
  const base = pos.getCount();
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  const corners = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  const P = corners.map(([a, b]) => { const q = [0, 0, 0]; q[axis] = at; q[ia] = a; q[ib] = b; return q; });
  const N = [0, 0, 0]; N[axis] = facing;
  const U = corners.map(([a, b]) => [uv.centre[0] + uv.perMetre * (a - ca), uv.centre[1] - uv.perMetre * (b - cb)]);
  const grow = (acc, rows) => { const n = acc.getElementSize(), old = acc.getArray(), out = new Float32Array(old.length + rows.length * n); out.set(old); rows.forEach((r, i) => out.set(r, old.length + i * n)); acc.setArray(out); };
  grow(pos, P); grow(nor, [N, N, N, N]); grow(tex, U);
  // (ia, ib) counter-clockwise faces +axis: keep that order for facing +1, reverse it for facing -1
  const quad = facing > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  for (const k of quad) keep.push(base + k);
  rec.added = 2;
  const idx = prim.getIndices();
  idx.setArray(base + 4 > 65535 ? new Uint32Array(keep) : new (idx.getArray().constructor)(keep));
  compactPrimitive(prim); // drop the vertices only the removed triangles used
  rec.removed.areaM2 = r5(rec.removed.areaM2);
  rec.addedAreaM2 = r5((a1 - a0) * (b1 - b0));
  return rec;
}

/** Moves every vertex inside `box` ({min, max}) to coordinate `value` along `axis`; normals -> axis direction (current sign). */
export function snapVertices(doc, {box, axis, value}) {
  let verts = 0;
  const inBox = q => q.every((x, k) => x >= box.min[k] && x <= box.max[k]);
  for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) {
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
    const q = [0, 0, 0], n = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, q);
      if (!inBox(q)) continue;
      q[axis] = value; pos.setElement(i, q);
      if (nor) { nor.getElement(i, n); const s = Math.sign(n[axis]) || 1; const m = [0, 0, 0]; m[axis] = s; nor.setElement(i, m); }
      verts++;
    }
  }
  if (!verts) throw new Error('snapVertices: nothing selected');
  return {box, axis, value, verts};
}

/**
 * Painted ghost on a flat face: the faces lying on the plane `at` (+-tol, |n . axis| >= 0.9 toward `facing`) are rasterised in UV space;
 * a texel is a ghost CANDIDATE only where its interpolated 3D position lies inside `region` ({min, max}); a candidate whose 5 x 5 local
 * mean departs from the face's median colour by more than `thresh` (max channel, 0-255) is a ghost (dilated 2 texels inside the region)
 * and copies a clean texel of the same face nearby (deterministic PRNG; sources >= 3 texels inside the face) in every map. `all: true`
 * refills EVERY face texel inside the region (a low-contrast ghost on a plain finish that a threshold only catches in fragments); the
 * sources then come from the face outside the region. `clone: {along, by}` (a clone stamp instead of scattered random texels, which
 * leave a speckled patch): a ghost texel at 3D point q copies the face texel at q shifted by `by` m along axis `along`, away from the
 * region's centre (found through the face's own UVs; a shifted point that misses the face or lands on a ghost falls back to the random
 * pick) — the finish keeps its grain and its gradient across the other axis. Returns counts.
 */
export async function cleanPanelGhosts(doc, sharp, {axis, at, tol, facing, region, thresh = 10, all = false, clone = null}) {
  const faces = [];
  const mats = new Set();
  for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0');
    if (!uv) continue;
    const I = triIndex(prim);
    for (let t = 0; t < I.length; t += 3) {
      const f = faceOf(pos, I, t);
      if (f.n[axis] * facing < 0.9 || !f.p.every(q => Math.abs(q[axis] - at) <= tol)) continue;
      faces.push({p: f.p, uv: [0, 1, 2].map(k => uv.getElement(I[t + k], [0, 0]))});
      mats.add(prim.getMaterial());
    }
  }
  const report = {axis, at, tol, facing, region, ...(all ? {all: true} : {thresh}), ...(clone ? {clone} : {}), faces: faces.length};
  if (!faces.length) throw new Error('cleanPanelGhosts: no face selected');
  const slots = [];
  for (const m of mats) for (const [slot, tex] of [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]]) {
    if (tex && !slots.some(s => s.tex === tex)) slots.push({slot, tex});
  }
  const decode = async tex => { const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, W: info.width, H: info.height}; };
  const base = slots.find(s => s.slot === 'baseColor');
  if (!base) throw new Error('cleanPanelGhosts: no base colour map');
  const B = await decode(base.tex);
  const {W, H} = B;
  const M = new Uint8Array(W * H), R = new Uint8Array(W * H), Q = new Map(); // Q: 3D point of each region texel (clone stamp)
  const inR = q => q.every((x, k) => x >= region.min[k] && x <= region.max[k]);
  for (const f of faces) {
    const s = f.uv.map(([u, v]) => [u * W, v * H]);
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])) + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
      const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      const i = y * W + x;
      M[i] = 1;
      const q = [0, 1, 2].map(k => w0 * f.p[0][k] + w1 * f.p[1][k] + w2 * f.p[2][k]);
      if (inR(q)) { R[i] = 1; if (clone && !Q.has(i)) Q.set(i, q); }
    }
  }
  const med = [0, 1, 2].map(ch => { const h = new Uint32Array(256); let n = 0; for (let i = 0; i < W * H; i++) if (M[i]) { h[B.data[i * 3 + ch]]++; n++; } let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= n / 2) return v; } return 0; });
  const G = new Uint8Array(W * H);
  let masked = 0, candidates = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!M[i]) continue;
    masked++;
    if (!R[i]) continue;
    candidates++;
    if (all) { G[i] = 1; continue; }
    const s = [0, 0, 0]; let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || !M[yy * W + xx]) continue;
      const j = (yy * W + xx) * 3; s[0] += B.data[j]; s[1] += B.data[j + 1]; s[2] += B.data[j + 2]; n++;
    }
    if (Math.max(...[0, 1, 2].map(ch => Math.abs(s[ch] / n - med[ch]))) > thresh) G[i] = 1;
  }
  const G2 = G.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!G[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && R[yy * W + xx]) G2[yy * W + xx] = 1; }
  }
  let ghosts = 0; for (let i = 0; i < W * H; i++) ghosts += G2[i];
  const srcOK = new Uint8Array(W * H), pool = [];
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = y * W + x;
    if (!M[i] || G2[i]) continue;
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!M[i + dy * W + dx] || G2[i + dy * W + dx]) { ok = false; break; }
    if (ok) { srcOK[i] = 1; pool.push(i); }
  }
  if (!pool.length) throw new Error('cleanPanelGhosts: no clean source texels');
  let seed = 0x2545f491;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const source = new Map();
  const [ia, ib] = AX[axis];
  const mid = clone ? (region.min[clone.along] + region.max[clone.along]) / 2 : 0;
  const texelAt = q => { // the face texel under 3D point q (projected on the plane), or -1
    for (const f of faces) {
      const a = f.p[0], b = f.p[1], c = f.p[2];
      const d = (b[ia] - a[ia]) * (c[ib] - a[ib]) - (c[ia] - a[ia]) * (b[ib] - a[ib]);
      if (Math.abs(d) < 1e-12) continue;
      const w1 = ((q[ia] - a[ia]) * (c[ib] - a[ib]) - (c[ia] - a[ia]) * (q[ib] - a[ib])) / d, w2 = ((b[ia] - a[ia]) * (q[ib] - a[ib]) - (q[ia] - a[ia]) * (b[ib] - a[ib])) / d, w0 = 1 - w1 - w2;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const u = w0 * f.uv[0][0] + w1 * f.uv[1][0] + w2 * f.uv[2][0], v = w0 * f.uv[0][1] + w1 * f.uv[1][1] + w2 * f.uv[2][1];
      const tx = Math.min(W - 1, Math.max(0, Math.floor(u * W))), ty = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
      return ty * W + tx;
    }
    return -1;
  };
  let cloned = 0;
  for (let i = 0; i < W * H; i++) {
    if (!G2[i]) continue;
    const x = i % W, y = (i - x) / W;
    let src = -1;
    if (clone && Q.has(i)) {
      const q = Q.get(i).slice();
      q[clone.along] += q[clone.along] < mid ? -clone.by : clone.by;
      const j = texelAt(q);
      if (j >= 0 && M[j] && !G2[j]) { src = j; cloned++; }
    }
    for (let t = 0; t < 128 && src < 0; t++) {
      const r = 6 + t * 3, xx = Math.round(x + (rnd() * 2 - 1) * r), yy = Math.round(y + (rnd() * 2 - 1) * r);
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && srcOK[yy * W + xx]) src = yy * W + xx;
    }
    source.set(i, src >= 0 ? src : pool[Math.floor(rnd() * pool.length)]);
  }
  Object.assign(report, {masked, candidates, ghostTexels: ghosts, median: med, sources: pool.length, ...(clone ? {cloned} : {})});
  for (const s of slots) {
    const D = s === base ? B : await decode(s.tex);
    for (const [i, j] of source) {
      const x = i % W, y = (i - x) / W, sx = j % W, sy = (j - sx) / W;
      const di = Math.min(D.H - 1, Math.floor((y + 0.5) * D.H / H)) * D.W + Math.min(D.W - 1, Math.floor((x + 0.5) * D.W / W));
      const si = Math.min(D.H - 1, Math.floor((sy + 0.5) * D.H / H)) * D.W + Math.min(D.W - 1, Math.floor((sx + 0.5) * D.W / W));
      for (let ch = 0; ch < 3; ch++) D.data[di * 3 + ch] = D.data[si * 3 + ch];
    }
    s.tex.setImage(new Uint8Array(await sharp(D.data, {raw: {width: D.W, height: D.H, channels: 3}}).png().toBuffer())).setMimeType('image/png');
    report[s.slot] = `${D.W}x${D.H}`;
  }
  return report;
}
