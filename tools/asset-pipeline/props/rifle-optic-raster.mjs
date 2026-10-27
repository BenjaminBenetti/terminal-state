// Iteration04 Lane E: tiny CPU rasterizer for rifle-optic QA (no browser/WebGL available to this lane).
// Perspective or orthographic camera looking down -Z of view space (three.js convention), near-plane clipping,
// perspective-correct attribute interpolation, z-buffer, back-face culling, per-fragment JS "shaders" and
// straight alpha blending. It approximates — it does not reproduce — three.js PBR shading; images made with it
// are labelled as CPU approximations.
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';

export class Raster {
  /** bg: {data: Uint8Array RGB, w, h} (resampled to W x H by the caller) or [r, g, b]. */
  constructor(W, H, bg = [235, 235, 235]) {
    this.W = W; this.H = H;
    this.color = new Float32Array(W * H * 3);
    this.depth = new Float32Array(W * H).fill(Infinity);
    if (Array.isArray(bg)) for (let i = 0; i < W * H; i++) { this.color[3 * i] = bg[0]; this.color[3 * i + 1] = bg[1]; this.color[3 * i + 2] = bg[2]; }
    else for (let i = 0; i < W * H * 3; i++) this.color[i] = bg.data[i];
    this.cam = {kind: 'persp', fovY: 54, near: 0.01};
  }
  /** {kind:'persp', fovY(deg), near} or {kind:'ortho', cx, cy, halfH} (view-space x/y window centred on cx,cy). */
  setCamera(cam) { this.cam = cam; }

  project(x, y, z) {
    const {W, H} = this, c = this.cam;
    if (c.kind === 'persp') {
      const t = Math.tan(c.fovY * Math.PI / 360), w = -z;
      return [(x / w / (t * W / H) * 0.5 + 0.5) * W, (0.5 - y / w / t * 0.5) * H, w];
    }
    return [((x - c.cx) / (c.halfH * W / H) * 0.5 + 0.5) * W, (0.5 - (y - c.cy) / c.halfH * 0.5) * H, -z];
  }

  /**
   * Draw triangles. V: view-space positions (Float32Array xyz), I: indices, A: optional per-vertex attribute arrays
   * {name: {data, size}} interpolated perspective-correctly. shade(frag) -> [r,g,b,a] (0-255, a 0-1) or null (discard).
   * frag = {x, y (pixel), w (view depth), pos [view xyz], n [flat view-space face normal], attrs {name: [..]}, front}.
   * opts: cull 'back' | 'front' | 'none', depthTest, depthWrite, colorWrite.
   */
  draw(V, I, A, shade, opts = {}) {
    const {cull = 'back', depthTest = true, depthWrite = true, colorWrite = true, depthBias = 0} = opts;
    const near = this.cam.kind === 'persp' ? this.cam.near : -Infinity;
    const names = Object.keys(A ?? {});
    for (let f = 0; f < I.length; f += 3) {
      let poly = [I[f], I[f + 1], I[f + 2]].map(i => ({p: [V[3 * i], V[3 * i + 1], V[3 * i + 2]], a: names.map(nm => Array.from(A[nm].data.subarray(i * A[nm].size, (i + 1) * A[nm].size)))}));
      // face normal (view space, from unclipped triangle)
      const [a, b, c] = poly.map(v => v.p);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      // near clip (z <= -near)
      if (this.cam.kind === 'persp') {
        const out = [];
        for (let k = 0; k < poly.length; k++) {
          const P = poly[k], Q = poly[(k + 1) % poly.length];
          const pin = P.p[2] <= -near, qin = Q.p[2] <= -near;
          if (pin) out.push(P);
          if (pin !== qin) {
            const t = (-near - P.p[2]) / (Q.p[2] - P.p[2]);
            out.push({p: P.p.map((x, j) => x + (Q.p[j] - x) * t), a: P.a.map((arr, j) => arr.map((x, m) => x + (Q.a[j][m] - x) * t))});
          }
        }
        poly = out;
        if (poly.length < 3) continue;
      }
      const S = poly.map(v => this.project(v.p[0], v.p[1], v.p[2]));
      // orientation in screen space (y down): CCW in NDC => negative area here
      let area = 0;
      for (let k = 0; k < S.length; k++) { const p = S[k], q = S[(k + 1) % S.length]; area += p[0] * q[1] - q[0] * p[1]; }
      const front = area < 0;
      if ((cull === 'back' && !front) || (cull === 'front' && front)) continue;
      for (let k = 1; k + 1 < poly.length; k++) this.tri([poly[0], poly[k], poly[k + 1]], [S[0], S[k], S[k + 1]], names, shade, {depthTest, depthWrite, colorWrite, depthBias, n: [nx, ny, nz], front});
    }
  }

  tri(vs, S, names, shade, o) {
    const {W, H} = this;
    const persp = this.cam.kind === 'persp';
    const iw = S.map(s => persp ? 1 / s[2] : 1);
    const x0 = Math.max(0, Math.floor(Math.min(S[0][0], S[1][0], S[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(S[0][0], S[1][0], S[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(S[0][1], S[1][1], S[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(S[0][1], S[1][1], S[2][1])));
    const den = (S[1][1] - S[2][1]) * (S[0][0] - S[2][0]) + (S[2][0] - S[1][0]) * (S[0][1] - S[2][1]);
    if (Math.abs(den) < 1e-12) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const b0 = ((S[1][1] - S[2][1]) * (px - S[2][0]) + (S[2][0] - S[1][0]) * (py - S[2][1])) / den;
      const b1 = ((S[2][1] - S[0][1]) * (px - S[2][0]) + (S[0][0] - S[2][0]) * (py - S[2][1])) / den;
      const b2 = 1 - b0 - b1;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;
      const q0 = b0 * iw[0], q1 = b1 * iw[1], q2 = b2 * iw[2], qs = q0 + q1 + q2;
      const w0 = q0 / qs, w1 = q1 / qs, w2 = q2 / qs;
      const depth = (persp ? 1 / qs : b0 * S[0][2] + b1 * S[1][2] + b2 * S[2][2]) + o.depthBias;
      const k = y * W + x;
      if (o.depthTest && depth >= this.depth[k]) continue;
      const pos = [0, 1, 2].map(j => w0 * vs[0].p[j] + w1 * vs[1].p[j] + w2 * vs[2].p[j]);
      const attrs = {};
      names.forEach((nm, j) => { attrs[nm] = vs[0].a[j].map((v, m) => w0 * v + w1 * vs[1].a[j][m] + w2 * vs[2].a[j][m]); });
      const c = shade ? shade({x, y, w: depth, pos, n: o.n, attrs, front: o.front}) : [0, 0, 0, 1];
      if (!c) continue;
      if (o.depthWrite) this.depth[k] = depth;
      if (!o.colorWrite) continue;
      const al = c[3] ?? 1;
      for (let ch = 0; ch < 3; ch++) this.color[3 * k + ch] = this.color[3 * k + ch] * (1 - al) + c[ch] * al;
    }
  }

  async save(file, {downsample = 1, overlaySvg = null} = {}) {
    const buf = Buffer.alloc(this.W * this.H * 3);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.max(0, Math.min(255, Math.round(this.color[i])));
    let img = sharp(buf, {raw: {width: this.W, height: this.H, channels: 3}});
    if (downsample > 1) img = sharp(await img.resize(Math.round(this.W / downsample), Math.round(this.H / downsample), {kernel: 'lanczos3'}).png().toBuffer());
    if (overlaySvg) img = img.composite([{input: Buffer.from(overlaySvg)}]);
    await img.png().toFile(file);
  }
}

/** Load every mesh primitive of a GLB with world transforms baked: [{node, P, N, UV, I, material:{name, alphaMode, baseColorFactor, doubleSided}, tex}] */
export async function loadGlb(file) {
  const doc = await new NodeIO().read(file);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P0 = prim.getAttribute('POSITION').getArray(), UV = prim.getAttribute('TEXCOORD_0')?.getArray() ?? null, I = prim.getIndices().getArray();
      const P = new Float32Array(P0.length);
      for (let i = 0; i < P0.length; i += 3) { const x = P0[i], y = P0[i + 1], z = P0[i + 2]; P[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14]; }
      const mat = prim.getMaterial(); const t = mat?.getBaseColorTexture();
      let tex = null;
      if (t) { const {data, info} = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({resolveWithObject: true}); tex = {data, w: info.width, h: info.height}; }
      out.push({node: node.getName(), P, UV, I, tex, material: {name: mat?.getName(), alphaMode: mat?.getAlphaMode(), baseColorFactor: mat?.getBaseColorFactor(), doubleSided: mat?.getDoubleSided(), emissive: mat?.getEmissiveFactor()}});
    }
  }
  return out;
}

/** Bilinear-free nearest texture lookup with repeat wrapping; returns [r,g,b] 0-255. */
export function sample(tex, u, v) {
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(tex.w - 1, Math.floor(u * tex.w)), y = Math.min(tex.h - 1, Math.floor(v * tex.h)), i = 3 * (y * tex.w + x);
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
}

/** Transform model positions by a column-major 4x4 matrix (three.js Matrix4.elements) into a new Float32Array. */
export function transform(P, e) {
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; out[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
  return out;
}
