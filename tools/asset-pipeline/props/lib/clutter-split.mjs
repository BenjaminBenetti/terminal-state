// Task office-props-physics-scale-20261030 (lane FURN): LOCAL SEPARATION of loose clutter baked into a furniture model.
//
// User (2026-10-30): "all the beakers and lab equipment on top are part of the model, they shouldn't be! They must be cut out in to
// there own assets. And placed randomly on top. ... Never bake items on top of furnature in to the furnature model always place props
// on top instead." / "monitors are baked in to desk model instead of being placed on top" / "The display case should be seperated
// from the bread, and the bread should be a food item."
//
// Pure, deterministic gltf-transform helpers used by build-office-overhaul.mjs on a derivative in its MANIFEST frame (rotated so the
// front faces -Z, scaled to the manifest size, grounded, centred — exactly the frame of the previous runtime GLB, where the selection
// boxes below were measured with CPU renders). Meshy reconstructs loose objects as separate connected pieces resting on the furniture
// (the worktop / shelves stay intact underneath), so:
//   1. triangles are grouped into CONNECTED COMPONENTS (vertices welded by quantised position);
//   2. a per-asset predicate marks the components that are loose clutter (standing on the worktop / desk top / display shelves);
//   3. the furniture BODY keeps every other component (no new geometry; nothing under the clutter was missing: see the evidence);
//   4. one representative instance of each distinct object type (a selection box around its components' bbox centres) is copied out
//      as its own model; every other clutter instance (duplicates, tubing, papers, trays) is dropped — the game places the
//      extracted types back on the furniture as separate physics props / loot items (seeded, finite);
//   5. each extracted model is scaled to ITS OWN real size (the baked copies were drawn at the furniture's miniature scale, and the
//      trading desk's accessories ~30 % oversized), grounded and centred, and keeps its own small crop of the source atlas (base
//      colour / metallic-roughness / normal cropped to the part's UV bounds, Lanczos-resized, JPEG): no duplicate giant textures.
import {cloneDocument, compactPrimitive, getBounds, prune, transformMesh} from '@gltf-transform/functions';

/** Triangles of a primitive as index triples (non-indexed primitives get an implicit index). */
function triIndex(prim) {
  const idx = prim.getIndices();
  const n = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = idx ? idx.getScalar(i) : i;
  return out;
}

/**
 * Connected components of every mesh primitive in `doc` (vertices welded by position quantised to `eps` m, within a primitive).
 * Returns [{prim, tri: Uint32Array (triangle -> component id), comps: [{id, n, min, max, centre}]}] with component ids unique doc-wide.
 */
export function components(doc, eps = 1e-4) {
  const out = [];
  let base = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), I = triIndex(prim);
    const key = new Map(), weld = new Int32Array(pos.getCount());
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const k = `${Math.round(v[0] / eps)},${Math.round(v[1] / eps)},${Math.round(v[2] / eps)}`;
      let w = key.get(k);
      if (w === undefined) key.set(k, (w = key.size));
      weld[i] = w;
    }
    const parent = Int32Array.from({length: key.size}, (_, i) => i);
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let t = 0; t < I.length; t += 3) {
      const a = find(weld[I[t]]), b = find(weld[I[t + 1]]), c = find(weld[I[t + 2]]);
      parent[b] = a; parent[find(c)] = find(a);
    }
    const ids = new Map(), tri = new Uint32Array(I.length / 3), comps = [];
    for (let t = 0; t < I.length; t += 3) {
      const r = find(weld[I[t]]);
      let c = ids.get(r);
      if (c === undefined) { ids.set(r, (c = comps.length)); comps.push({id: base + c, n: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}); }
      tri[t / 3] = base + c;
      const cc = comps[c];
      cc.n++;
      for (let k = 0; k < 3; k++) {
        pos.getElement(I[t + k], v);
        for (let q = 0; q < 3; q++) { cc.min[q] = Math.min(cc.min[q], v[q]); cc.max[q] = Math.max(cc.max[q], v[q]); }
      }
    }
    for (const c of comps) c.centre = [0, 1, 2].map(q => (c.min[q] + c.max[q]) / 2);
    out.push({mesh, prim, tri, comps});
    base += comps.length;
  }
  return out;
}

const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[3] && p[1] >= b[1] && p[1] <= b[4] && p[2] >= b[2] && p[2] <= b[5];

/**
 * Labels every component 'body', 'drop' or a part id: `clutter(c)` says it is loose clutter; a clutter component whose bbox centre
 * lies in a part's `box` belongs to that part (the representative instance); other clutter is dropped.
 */
export function classify(comps, spec) {
  const label = new Map();
  for (const pc of comps) for (const c of pc.comps) {
    if (!spec.clutter(c)) { label.set(c.id, 'body'); continue; }
    const part = Object.entries(spec.parts).find(([, p]) => inBox(c.centre, p.box));
    // `skip(c)`: a component inside the selection box that is not part of the object (loose tubing curling out of a microscope)
    label.set(c.id, part && !part[1].skip?.(c) ? part[0] : 'drop');
  }
  return label;
}

/** Keeps only the triangles whose component label is `keep` in every primitive of `doc` (unused vertices compacted away). */
function keepTriangles(doc, keep) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const I = triIndex(prim), kept = [];
    for (let t = 0; t < I.length; t += 3) if (keep(mesh, prim, t / 3)) kept.push(I[t], I[t + 1], I[t + 2]);
    let acc = prim.getIndices();
    if (!acc) { acc = doc.createAccessor().setType('SCALAR').setBuffer(doc.getRoot().listBuffers()[0]); prim.setIndices(acc); }
    acc.setArray(new Uint32Array(kept));
    if (kept.length) compactPrimitive(prim); else prim.dispose();
  }
  for (const mesh of doc.getRoot().listMeshes()) if (!mesh.listPrimitives().length) mesh.dispose();
}

/** Uniform scale about the origin, then grounded (min y = 0) and centred on x / z. Returns the bounds after. */
export function scaleGroundCentre(doc, k) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (k !== 1) for (const m of doc.getRoot().listMeshes()) transformMesh(m, [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]);
  const b = getBounds(scene);
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2, 1];
  for (const m of doc.getRoot().listMeshes()) transformMesh(m, T);
  return getBounds(scene);
}

/** A quarter turn about +Y (x' = z, z' = -x): lays a part's long axis along X (the item-model convention: w = the long side). */
function quarterTurn(doc) {
  for (const m of doc.getRoot().listMeshes()) transformMesh(m, [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]);
}

export const extentOf = (b, axis) => {
  const e = [0, 1, 2].map(k => b.max[k] - b.min[k]);
  return axis === 'h' ? e[1] : axis === 'w' ? e[0] : axis === 'd' ? e[2] : Math.max(...e);
};

/**
 * Splits `doc` (manifest frame) in place into the furniture body and returns the extracted parts as separate documents.
 * spec: {clutter(c), parts: {id: {box, sizeM, sizeAxis, longX?}}}. Returns {label, comps, parts: [{id, doc, before: {min, max}, tris}],
 * removed: {tris, comps}} — `before` = the representative's bounds where it stood on the furniture (manifest frame).
 */
export async function splitClutter(doc, spec) {
  const comps = components(doc);
  const label = classify(comps, spec);
  const compOf = new Map();
  for (const pc of comps) compOf.set(pc.prim, pc);
  const labelOf = (prim, t) => label.get(compOf.get(prim).tri[t]);
  const parts = [];
  for (const [id, p] of Object.entries(spec.parts)) {
    const pd = cloneDocument(doc);
    // cloneDocument keeps the property order: map the clone's primitives back to the source's by position in the lists
    const srcPrims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
    const dstPrims = pd.getRoot().listMeshes().flatMap(m => m.listPrimitives());
    const back = new Map(dstPrims.map((q, i) => [q, srcPrims[i]]));
    keepTriangles(pd, (_m, prim, t) => labelOf(back.get(prim), t) === id);
    await pd.transform(prune());
    const scene = pd.getRoot().getDefaultScene() ?? pd.getRoot().listScenes()[0];
    if (!pd.getRoot().listMeshes().length) throw new Error(`part ${id}: selection box matched no clutter component`);
    const before = getBounds(scene);
    if (p.longX && (before.max[2] - before.min[2]) > (before.max[0] - before.min[0])) quarterTurn(pd);
    const ref = extentOf(getBounds(scene), p.sizeAxis);
    const after = scaleGroundCentre(pd, p.sizeM / ref);
    const tris = pd.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((q, pr) => q + pr.getIndices().getCount() / 3, 0), 0);
    parts.push({id, doc: pd, before: {min: before.min.map(v => +v.toFixed(4)), max: before.max.map(v => +v.toFixed(4))}, scale: p.sizeM / ref, after, tris});
  }
  let removed = 0;
  const dropped = new Set();
  keepTriangles(doc, (_m, prim, t) => { const l = labelOf(prim, t); if (l !== 'body') { removed++; dropped.add(compOf.get(prim).tri[t]); } return l === 'body'; });
  return {label, comps, parts, removed: {tris: removed, comps: dropped.size}};
}

/**
 * Crops the textures of a part document to the UV bounds its triangles use (+ a few texels of gutter), so the part carries only its
 * own patch of the source atlas, resized so the longer side is at most `px`, as JPEG `quality`. UVs are remapped to the crop.
 * Every material texture of the part (base colour, metallic-roughness, normal) shares TEXCOORD_0 and gets the same crop.
 */
export async function cropPartTextures(doc, sharp, px, quality = 85) {
  const prims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  const t = [0, 0];
  for (const p of prims) {
    const uv = p.getAttribute('TEXCOORD_0');
    if (!uv) continue;
    for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, t); u0 = Math.min(u0, t[0]); v0 = Math.min(v0, t[1]); u1 = Math.max(u1, t[0]); v1 = Math.max(v1, t[1]); }
  }
  const texes = doc.getRoot().listTextures();
  if (!texes.length || !Number.isFinite(u0)) return null;
  if (u0 < -1e-4 || v0 < -1e-4 || u1 > 1 + 1e-4 || v1 > 1 + 1e-4) throw new Error('part UVs outside [0, 1]: no crop');
  const crops = [];
  for (const tex of texes) {
    const img = Buffer.from(tex.getImage());
    const meta = await sharp(img).metadata();
    const W = meta.width, H = meta.height, g = 4;
    const left = Math.max(0, Math.floor(u0 * W) - g), top = Math.max(0, Math.floor(v0 * H) - g);
    const right = Math.min(W, Math.ceil(u1 * W) + g), bottom = Math.min(H, Math.ceil(v1 * H) + g);
    crops.push({tex, W, H, left, top, width: right - left, height: bottom - top});
  }
  // one crop rectangle in UV space (all maps of a Meshy material share the atlas layout; sizes may differ)
  const c0 = crops[0];
  const cu0 = c0.left / c0.W, cv0 = c0.top / c0.H, cu1 = (c0.left + c0.width) / c0.W, cv1 = (c0.top + c0.height) / c0.H;
  for (const c of crops) {
    const left = Math.round(cu0 * c.W), top = Math.round(cv0 * c.H), width = Math.max(1, Math.round(cu1 * c.W) - left), height = Math.max(1, Math.round(cv1 * c.H) - top);
    const s = Math.min(1, px / Math.max(width, height));
    const out = await sharp(Buffer.from(c.tex.getImage())).extract({left, top, width, height})
      .resize(Math.max(8, Math.round(width * s)), Math.max(8, Math.round(height * s)), {kernel: 'lanczos3'}).jpeg({quality}).toBuffer();
    c.tex.setImage(new Uint8Array(out)).setMimeType('image/jpeg').setURI('');
  }
  for (const uv of new Set(prims.map(p => p.getAttribute('TEXCOORD_0')).filter(Boolean))) {
    const arr = uv.getArray().slice();
    for (let i = 0; i < arr.length; i += 2) { arr[i] = (arr[i] - cu0) / (cu1 - cu0); arr[i + 1] = (arr[i + 1] - cv0) / (cv1 - cv0); }
    uv.setArray(arr);
  }
  return {uv: [cu0, cv0, cu1, cv1].map(v => +v.toFixed(4)), share: +((cu1 - cu0) * (cv1 - cv0)).toFixed(4)};
}

/**
 * GHOSTS: Meshy painted the loose objects' footprints, shadows and see-through silhouettes INTO the support surfaces' texture (the
 * lab worktop shows rings / rectangles where the glassware stood, the desk top dark monitor feet and the keyboard, the bakery deck and
 * glass shelves blurred loaves). Removing the geometry leaves those painted ghosts, so the support faces are cleaned in the BODY's
 * own maps: the up-facing faces at the given support heights (manifest frame, `tol` m) are rasterised in UV space; inside that mask a
 * texel whose locally averaged colour departs from the surface's median colour by more than `thresh` (0-255, max channel) is a ghost
 * (dilated 2 texels) and is refilled from its clean neighbours (onion-peel diffusion), the metallic-roughness map likewise, the
 * normal map with the clean texels' mean (flat) normal. Nothing outside the support faces' texels changes. Returns per-map counts.
 */
export async function cleanSupportTexture(doc, sharp, supports, thresh = 34, debugPng = null) {
  const uvTris = [];
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], ta = [0, 0], tb = [0, 0], tc = [0, 0];
  const mats = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), I = triIndex(prim);
    if (!uv) continue;
    for (let t = 0; t < I.length; t += 3) {
      pos.getElement(I[t], a); pos.getElement(I[t + 1], b); pos.getElement(I[t + 2], c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
      if (ny / nl < 0.9) continue;
      if (!supports.some(s => [a, b, c].every(p => Math.abs(p[1] - s.y) <= s.tol && (!s.x || (p[0] >= s.x[0] && p[0] <= s.x[1]))))) continue;
      uv.getElement(I[t], ta); uv.getElement(I[t + 1], tb); uv.getElement(I[t + 2], tc);
      uvTris.push([[...ta], [...tb], [...tc]]);
      mats.add(prim.getMaterial());
    }
  }
  const report = {faces: uvTris.length};
  if (!uvTris.length) return report;
  const slots = [];
  for (const m of mats) {
    for (const [slot, tex] of [['baseColor', m.getBaseColorTexture()], ['metallicRoughness', m.getMetallicRoughnessTexture()], ['normal', m.getNormalTexture()]]) {
      if (tex && !slots.some(s => s.tex === tex)) slots.push({slot, tex});
    }
  }
  const decode = async tex => { const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); return {data, W: info.width, H: info.height}; };
  const maskFor = (W, H) => {
    const M = new Uint8Array(W * H);
    for (const tri of uvTris) {
      const p = tri.map(([u, v]) => [u * W, v * H]);
      const x0 = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])) + 1);
      const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[2][0] - px) * (p[1][1] - py)) / area;
        const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / area;
        const w2 = 1 - w0 - w1, e = -0.02; // texel centres inside (a hair of slack so seams between faces close)
        if (w0 >= e && w1 >= e && w2 >= e) M[y * W + x] = 1;
      }
    }
    return M;
  };
  // ghost detection on the base colour map
  const base = slots.find(s => s.slot === 'baseColor');
  if (!base) return report;
  const B = await decode(base.tex);
  const {W, H} = B, M = maskFor(W, H);
  const med = [0, 1, 2].map(ch => { const h = new Uint32Array(256); let n = 0; for (let i = 0; i < W * H; i++) if (M[i]) { h[B.data[i * 3 + ch]]++; n++; } let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= n / 2) return v; } return 0; });
  // locally averaged colour (box 5x5 over mask texels) vs the median
  const R = 2, G = new Uint8Array(W * H);
  let ghosts = 0, masked = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!M[i]) continue;
    masked++;
    const s = [0, 0, 0];
    let n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || !M[yy * W + xx]) continue;
      const j = (yy * W + xx) * 3; s[0] += B.data[j]; s[1] += B.data[j + 1]; s[2] += B.data[j + 2]; n++;
    }
    if (Math.max(...[0, 1, 2].map(ch => Math.abs(s[ch] / n - med[ch]))) > thresh) G[i] = 1;
  }
  // dilate the ghosts by 2 texels (inside the mask)
  const G2 = G.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!G[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && M[yy * W + xx]) G2[yy * W + xx] = 1; }
  }
  // clean islands enclosed by ghosts (dark keys of the painted keyboard pass the colour test) are part of the ghost: every clean
  // 4-connected region smaller than `minClean` texels becomes ghost too, so the fill only ever samples the real surface
  const minClean = Math.max(64, Math.round(W * H / 1600)), seen = new Uint8Array(W * H), stack = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!M[i0] || G2[i0] || seen[i0]) continue;
    const region = [];
    stack.push(i0); seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop(); region.push(i);
      const x = i % W, y = (i - x) / W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || seen[j] || !M[j] || G2[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (region.length < minClean) for (const i of region) G2[i] = 1;
  }
  for (let i = 0; i < W * H; i++) ghosts += G2[i];
  report.masked = masked; report.ghostTexels = ghosts; report.median = med;
  if (debugPng) { // QA: the base map with the support mask (blue tint) and the ghosts (red)
    const dbg = Buffer.from(B.data);
    for (let i = 0; i < W * H; i++) if (M[i]) { if (G2[i]) { dbg[i * 3] = 255; dbg[i * 3 + 1] = 0; dbg[i * 3 + 2] = 0; } else dbg[i * 3 + 2] = Math.min(255, dbg[i * 3 + 2] + 90); }
    await sharp(dbg, {raw: {width: W, height: H, channels: 3}}).resize(1024).png().toFile(debugPng);
    const mg = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) mg[i] = M[i] ? (G2[i] ? 255 : 120) : 0;
    await sharp(mg, {raw: {width: W, height: H, channels: 1}}).png().toFile(debugPng.replace(/\.png$/, '-mask.png'));
  }
  // fill: every ghost texel copies a CLEAN texel of the same surface nearby (random offset, growing radius; deterministic PRNG) —
  // the support textures are fine noise (wood speckle, black resin, frosted glass), so sampled texels blend where a smooth diffusion
  // would smear; sources stay 3 texels inside the surface (never the UV gutter). The same source map is applied to every map.
  const srcOK = new Uint8Array(W * H), pool = [];
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    const i = y * W + x;
    if (!M[i] || G2[i]) continue;
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!M[i + dy * W + dx]) { ok = false; break; }
    if (ok) { srcOK[i] = 1; pool.push(i); }
  }
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const source = new Map();
  for (let i = 0; i < W * H; i++) {
    if (!G2[i] || !pool.length) continue;
    const x = i % W, y = (i - x) / W;
    let src = -1;
    for (let t = 0; t < 96 && src < 0; t++) {
      const r = 6 + t * 2, xx = Math.round(x + (rnd() * 2 - 1) * r), yy = Math.round(y + (rnd() * 2 - 1) * r);
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && srcOK[yy * W + xx]) src = yy * W + xx;
    }
    source.set(i, src >= 0 ? src : pool[Math.floor(rnd() * pool.length)]);
  }
  report.sources = pool.length;
  const fill = (data, w, h, C) => {
    for (const [i, j] of source) {
      const x = i % W, y = (i - x) / W, sx = j % W, sy = (j - sx) / W;
      const di = Math.min(h - 1, Math.floor((y + 0.5) * h / H)) * w + Math.min(w - 1, Math.floor((x + 0.5) * w / W));
      const si = Math.min(h - 1, Math.floor((sy + 0.5) * h / H)) * w + Math.min(w - 1, Math.floor((sx + 0.5) * w / W));
      for (let ch = 0; ch < C; ch++) data[di * C + ch] = data[si * C + ch];
    }
  };
  for (const s of slots) {
    const D = s === base ? B : await decode(s.tex);
    fill(D.data, D.W, D.H, 3);
    const png = await sharp(D.data, {raw: {width: D.W, height: D.H, channels: 3}}).png().toBuffer();
    if (debugPng && s === base) await sharp(png).toFile(debugPng.replace(/\.png$/, '-filled.png'));
    s.tex.setImage(new Uint8Array(png)).setMimeType('image/png');
    report[s.slot] = `${D.W}x${D.H}`;
  }
  return report;
}

/**
 * GLASS (task office-props-physics-scale-20261030, lane FURN, primary follow-up): the bakery case's customer glass, inner pane and
 * glazed top were PAINTED glass on the opaque body (a player at the customer side saw an opaque box, the loaves only from the open
 * staff side). The glass triangles move to their own node 'glass' with the SAME glass material contract as the shop-cooler fix
 * (task model-touchups-20261030, lane GLASS: base (0.092, 0.101, 0.1035) alpha 0.2, roughness 0.06, metallic 0, BLEND, double
 * sided, untextured; GLTFLoader makes it transparent + depthWrite false, so it never casts the flashlight shadow — render/
 * volumetric.ts markShadows / world/openables.ts takeover). Selected in the manifest frame: triangles of the case's MAIN shell
 * component (the largest) above `minY`, inside |x| < `maxX`, whose base colour at the centroid is glassy (saturation < `sat`, value
 * > `minV`). Returns {tris, area} moved.
 */
export const GLASS_MATERIAL = {baseColor: [0.092, 0.101, 0.1035, 0.2], roughness: 0.06, metallic: 0};
export async function splitGlass(doc, sharp, {minY, maxX, sat = 0.22, minV = 110}) {
  const pcs = components(doc);
  const pc = pcs.reduce((best, q) => (q.comps.reduce((s, c) => s + c.n, 0) > best.comps.reduce((s, c) => s + c.n, 0) ? q : best));
  const main = pc.comps.reduce((best, c) => (c.n > best.n ? c : best));
  const prim = pc.prim, mesh = pc.mesh;
  const tex = prim.getMaterial()?.getBaseColorTexture();
  if (!tex) throw new Error('splitGlass: no base colour map');
  const {data, info} = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), I = triIndex(prim);
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], ta = [0, 0], tb = [0, 0], tc = [0, 0];
  const glass = [], rest = [];
  let area = 0;
  for (let t = 0; t < I.length; t += 3) {
    let isGlass = false;
    if (pc.tri[t / 3] === main.id) {
      pos.getElement(I[t], a); pos.getElement(I[t + 1], b); pos.getElement(I[t + 2], c);
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      if (cy > minY && Math.abs(cx) < maxX) {
        uv.getElement(I[t], ta); uv.getElement(I[t + 1], tb); uv.getElement(I[t + 2], tc);
        const u = (ta[0] + tb[0] + tc[0]) / 3, v = (ta[1] + tb[1] + tc[1]) / 3;
        const o = (Math.min(info.height - 1, Math.max(0, Math.floor(v * info.height))) * info.width + Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width)))) * 3;
        const r = data[o], g = data[o + 1], bl = data[o + 2], mx = Math.max(r, g, bl);
        isGlass = mx > minV && (mx - Math.min(r, g, bl)) / mx < sat;
        if (isGlass) {
          const e1 = b.map((x, q) => x - a[q]), e2 = c.map((x, q) => x - a[q]);
          area += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
        }
      }
    }
    (isGlass ? glass : rest).push(I[t], I[t + 1], I[t + 2]);
  }
  if (!glass.length) throw new Error('splitGlass: no glass triangles selected');
  const gp = prim.clone();
  prim.getIndices().setArray(new Uint32Array(rest));
  compactPrimitive(prim);
  const idx = doc.createAccessor().setType('SCALAR').setBuffer(doc.getRoot().listBuffers()[0]).setArray(new Uint32Array(glass));
  gp.setIndices(idx);
  for (const s of gp.listSemantics()) if (s !== 'POSITION' && s !== 'NORMAL') gp.setAttribute(s, null); // untextured glass
  const G = GLASS_MATERIAL;
  gp.setMaterial(doc.createMaterial(`${prim.getMaterial().getName()}-glass`).setBaseColorFactor(G.baseColor).setAlphaMode('BLEND').setDoubleSided(true)
    .setRoughnessFactor(G.roughness).setMetallicFactor(G.metallic));
  compactPrimitive(gp);
  const gm = doc.createMesh(`${mesh.getName()}-glass`).addPrimitive(gp);
  const node = doc.createNode('glass').setMesh(gm);
  (doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]).addChild(node);
  return {tris: glass.length / 3, area: +area.toFixed(4)};
}

// --- Wave 2 (task office-props-physics-scale-20261030, lane FURN): local FURNITURE-ONLY proportion edits ---------------------------
// (catalog review, lane SCALE: furniture whose LENGTH is right but whose HEIGHT is a toy's — a uniform scale cannot fix it.)

/** Unique POSITION accessors of every primitive. */
const positionAccessors = doc => [...new Set(doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).map(p => p.getAttribute('POSITION')).filter(Boolean))];

/**
 * LEG EXTENSION: every vertex above the leg line `cut` (manifest frame) moves up by `dy`, so the triangles crossing the line — the legs
 * only, `cut` is chosen where nothing but legs exists — stretch and everything above (top, frame, rods, net) moves rigidly. Returns
 * {moved, stretched} vertex / triangle counts.
 */
export function legExtend(doc, cut, dy) {
  let moved = 0;
  for (const acc of positionAccessors(doc)) {
    const a = acc.getArray().slice();
    for (let i = 1; i < a.length; i += 3) if (a[i] > cut) { a[i] += dy; moved++; }
    acc.setArray(a);
  }
  let stretched = 0;
  for (const prim of doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())) {
    const pos = prim.getAttribute('POSITION'), I = triIndex(prim), v = [0, 0, 0];
    for (let t = 0; t < I.length; t += 3) {
      let lo = Infinity, hi = -Infinity;
      for (let q = 0; q < 3; q++) { pos.getElement(I[t + q], v); lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
      if (lo <= cut && hi > cut + dy) stretched++;
    }
  }
  return {moved, stretched};
}

/** Non-uniform scale along one axis (0 x, 2 z) about the origin (the manifest frame is centred): normals renormalised. */
export function scaleAxis(doc, axis, f) {
  for (const m of doc.getRoot().listMeshes()) {
    const S = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    S[axis * 5] = f;
    transformMesh(m, S);
  }
}

/**
 * PLINTH: the whole model is lifted by `dy` and a plain box (its own untextured dark material, node 'plinth') fills the space under
 * the footprint, inset by `inset` (m) — a console that came modelled sitting on the floor stands on its riser. Returns the box.
 */
export function addPlinth(doc, dy, inset, color = [0.045, 0.045, 0.05, 1]) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  for (const m of doc.getRoot().listMeshes()) transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, dy, 0, 1]);
  const b = getBounds(scene);
  const x0 = b.min[0] + inset, x1 = b.max[0] - inset, z0 = b.min[2] + inset, z1 = b.max[2] - inset, y0 = 0, y1 = dy;
  const P = [], N = [], I = [];
  const quad = (vs, n) => { const o = P.length / 3; for (const v of vs) { P.push(...v); N.push(...n); } I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
  quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
  quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
  quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
  const buf = doc.getRoot().listBuffers()[0];
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(P)))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(N)))
    .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array(I)))
    .setMaterial(doc.createMaterial('plinth').setBaseColorFactor(color).setRoughnessFactor(0.75).setMetallicFactor(0.1));
  scene.addChild(doc.createNode('plinth').setMesh(doc.createMesh('plinth').addPrimitive(prim)));
  return {x: [+x0.toFixed(4), +x1.toFixed(4)], z: [+z0.toFixed(4), +z1.toFixed(4)], h: dy};
}
