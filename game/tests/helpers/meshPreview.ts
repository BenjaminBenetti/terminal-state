// CPU preview renderer for built station meshes (wall-treatment QA; no WebGL). Perspective or
// orthographic camera, z-buffer, near-plane clipping, perspective-correct UV / colour interpolation,
// texture sampling from canvas-shim images (map, alphaTest, vertex colours, transparency pass), the
// dominant-axis world mapping of world-mapped materials, instanced meshes, and a simple flashlight +
// fill lighting. Approximate on purpose: it shows composition, scale, alignment and seams, not the
// game's lighting.
//
// Task track2-round2 R1 (lane CONCRETE), OPT-IN only (`mips` / `pbr`; without them the output is byte-identical to before):
//  - `mips`: box-filtered mip chains (colour in linear light, like an sRGB texture's GPU mips) sampled trilinearly at the LOD of
//    the pixel's screen-space texel footprint, with up to `aniso` taps along the footprint's major axis (EXT_texture_filter_
//    anisotropic-style; 1 = the software-rasterizer cap, 16 = the surfaces' native request). Shows what survives minification.
//  - `pbr`: linear-light shading with the normal map (world-mapping axis frame or mesh-UV frame, normalScale), roughness map,
//    Lambert + GGX, three's SpotLight model for the flashlight, point lights shaped like the baked light field's fixtures
//    (gain x power x emission lobe x window / (d^2 + 0.3)), the world-mapping macro tone + floor grime, exp2 fog and ACES
//    filmic tone mapping. Still approximate: no shadows / occlusion, no decay hook, no light-field bounce, no bloom.
import * as THREE from 'three';
import type {ShimCanvas} from './canvas2d';
import {wmNoiseCpu} from '../../src/world/surfaceNodes';

export interface PreviewCam {
  pos: [number, number, number];
  target: [number, number, number];
  fov?: number;
  /** Orthographic: metres covered by the image height (view along pos -> target). */
  ortho?: number;
  near?: number;
  far?: number;
}
export interface PreviewOpts {
  width: number;
  height: number;
  /** Flashlight from the camera (default true) and ambient fill. */
  flashlight?: boolean;
  ambient?: number;
  fog?: number;
  /** Opt-in (R1): mip-mapped sampling with up to `aniso` anisotropic taps (1 = software cap, 16 = native request). */
  mips?: {aniso: number};
  /** Opt-in (R1): linear-light PBR-ish shading (normal / roughness maps, flashlight spot + fixture lights, fog, ACES). */
  pbr?: PreviewPbr;
}

/** A fixture-like light (baked light-field model: gain x power x lobe x window(R) / (d^2 + 0.3)). */
export interface PreviewLight { pos: [number, number, number]; intensity: number; range: number; color?: [number, number, number] }
export interface PreviewPbr {
  lights?: PreviewLight[];
  /** three SpotLight from the eye along the view: intensity (cd), angle (rad), penumbra, decay, distance. Null = off. */
  flashlight?: {intensity: number; angle: number; penumbra: number; decay: number; distance: number; color?: [number, number, number]} | null;
  /** Constant hemisphere irradiance (sky / ground linear colours x intensity). */
  ambient?: {sky: [number, number, number]; ground: [number, number, number]; intensity: number};
  exposure?: number;
  fogDensity?: number;
  fogColor?: [number, number, number];
  /** World y of the local floor (world-mapping floor grime on vertical faces). */
  floorY?: number;
}

type V3 = [number, number, number];
interface Tex { w: number; h: number; d: Uint8ClampedArray | Uint8Array; repeat: boolean; offset: [number, number]; rep: [number, number] }
const texCache = new WeakMap<THREE.Texture, Tex | null>();
function texOf(t: THREE.Texture | null | undefined): Tex | null {
  if (!t) return null;
  if (texCache.has(t)) return texCache.get(t)!;
  const img = t.image as unknown as ShimCanvas | {width: number; height: number; data?: Uint8ClampedArray};
  const d = (img as ShimCanvas).data;
  const r = d ? {w: img.width, h: img.height, d, repeat: t.wrapS === THREE.RepeatWrapping, offset: [t.offset.x, t.offset.y] as [number, number], rep: [t.repeat.x, t.repeat.y] as [number, number]} : null;
  texCache.set(t, r);
  return r;
}
function sample(t: Tex, u: number, v: number, out: number[]): void {
  u = u * t.rep[0] + t.offset[0]; v = v * t.rep[1] + t.offset[1];
  if (t.repeat) { u -= Math.floor(u); v -= Math.floor(v); } else { u = Math.min(0.9999, Math.max(0, u)); v = Math.min(0.9999, Math.max(0, v)); }
  // Bilinear, flipY (v = 0 is the image bottom).
  const fx = u * t.w - 0.5, fy = (1 - v) * t.h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const W = t.w, H = t.h;
  const wrapX = (x: number) => (t.repeat ? ((x % W) + W) % W : Math.min(W - 1, Math.max(0, x)));
  const wrapY = (y: number) => (t.repeat ? ((y % H) + H) % H : Math.min(H - 1, Math.max(0, y)));
  const xa = wrapX(x0), xb = wrapX(x0 + 1), ya = wrapY(y0), yb = wrapY(y0 + 1);
  for (let k = 0; k < 4; k++) {
    const p00 = t.d[(ya * W + xa) * 4 + k], p10 = t.d[(ya * W + xb) * 4 + k], p01 = t.d[(yb * W + xa) * 4 + k], p11 = t.d[(yb * W + xb) * 4 + k];
    out[k] = ((p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay) / 255;
  }
}

// ---- opt-in (R1): mip chains + trilinear / anisotropic sampling ---------------------------------------------
interface Mip { w: number; h: number; d: Float32Array }
interface MipTex { levels: Mip[]; repeat: boolean; offset: [number, number]; rep: [number, number] }
const mipCache = new WeakMap<THREE.Texture, MipTex | null>();
const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Box-filtered mip chain of a texture (colour textures filtered in linear light, as GPU mips of an sRGB format are). */
export function mipChain(t: THREE.Texture | null | undefined): MipTex | null {
  if (!t) return null;
  if (mipCache.has(t)) return mipCache.get(t)!;
  const b = texOf(t);
  if (!b) { mipCache.set(t, null); return null; }
  const srgb = t.colorSpace === THREE.SRGBColorSpace;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgb ? srgbToLin(i / 255) : i / 255;
  const d0 = new Float32Array(b.w * b.h * 4);
  for (let i = 0; i < b.w * b.h; i++) { for (let k = 0; k < 3; k++) d0[i * 4 + k] = lut[b.d[i * 4 + k]]; d0[i * 4 + 3] = b.d[i * 4 + 3] / 255; }
  const levels: Mip[] = [{w: b.w, h: b.h, d: d0}];
  for (let m = levels[0]; m.w > 1 || m.h > 1; m = levels[levels.length - 1]) {
    const w = Math.max(1, m.w >> 1), h = Math.max(1, m.h >> 1), d = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xa = Math.min(m.w - 1, 2 * x), xb = Math.min(m.w - 1, 2 * x + 1), ya = Math.min(m.h - 1, 2 * y), yb = Math.min(m.h - 1, 2 * y + 1);
      for (let k = 0; k < 4; k++) d[(y * w + x) * 4 + k] = (m.d[(ya * m.w + xa) * 4 + k] + m.d[(ya * m.w + xb) * 4 + k] + m.d[(yb * m.w + xa) * 4 + k] + m.d[(yb * m.w + xb) * 4 + k]) / 4;
    }
    levels.push({w, h, d});
  }
  const r: MipTex = {levels, repeat: b.repeat, offset: b.offset, rep: b.rep};
  mipCache.set(t, r);
  return r;
}

function bilerpLevel(t: MipTex, m: Mip, u: number, v: number, out: number[], wgt: number): void {
  if (t.repeat) { u -= Math.floor(u); v -= Math.floor(v); } else { u = Math.min(0.9999, Math.max(0, u)); v = Math.min(0.9999, Math.max(0, v)); }
  const fx = u * m.w - 0.5, fy = (1 - v) * m.h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, W = m.w, H = m.h;
  const wrapX = (x: number) => (t.repeat ? ((x % W) + W) % W : Math.min(W - 1, Math.max(0, x)));
  const wrapY = (y: number) => (t.repeat ? ((y % H) + H) % H : Math.min(H - 1, Math.max(0, y)));
  const xa = wrapX(x0), xb = wrapX(x0 + 1), ya = wrapY(y0), yb = wrapY(y0 + 1);
  for (let k = 0; k < 4; k++) {
    const p00 = m.d[(ya * W + xa) * 4 + k], p10 = m.d[(ya * W + xb) * 4 + k], p01 = m.d[(yb * W + xa) * 4 + k], p11 = m.d[(yb * W + xb) * 4 + k];
    out[k] += wgt * ((p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay);
  }
}
function trilinear(t: MipTex, u: number, v: number, lod: number, out: number[], wgt: number): void {
  const top = t.levels.length - 1, l = Math.min(top, Math.max(0, lod)), l0 = Math.floor(l), f = l - l0;
  bilerpLevel(t, t.levels[l0], u, v, out, wgt * (1 - f));
  if (f > 0 && l0 < top) bilerpLevel(t, t.levels[l0 + 1], u, v, out, wgt * f);
}

/** Texel-footprint statistics of the last anisotropic samples (LOD histogram for reports). */
export const mipStats = {lodSum: 0, samples: 0, taps: 0};

/**
 * Sample with the LOD of the screen footprint (uv derivatives per pixel in x / y) and up to `maxAniso` taps along its major
 * axis: n = min(ceil(Pmax / Pmin), maxAniso), lod = log2(Pmax / n) (EXT_texture_filter_anisotropic reference); 1 = trilinear.
 */
export function sampleFootprint(t: MipTex, u: number, v: number, dudx: number, dvdx: number, dudy: number, dvdy: number, maxAniso: number, out: number[]): number {
  u = u * t.rep[0] + t.offset[0]; v = v * t.rep[1] + t.offset[1];
  dudx *= t.rep[0]; dudy *= t.rep[0]; dvdx *= t.rep[1]; dvdy *= t.rep[1];
  const W = t.levels[0].w, H = t.levels[0].h;
  const px = Math.hypot(dudx * W, dvdx * H), py = Math.hypot(dudy * W, dvdy * H);
  const pmax = Math.max(px, py, 1e-9), pmin = Math.max(Math.min(px, py), 1e-9);
  const n = Math.max(1, Math.min(Math.ceil(pmax / pmin - 1e-6), Math.max(1, Math.floor(maxAniso))));
  const lod = Math.log2(pmax / n);
  out[0] = out[1] = out[2] = out[3] = 0;
  if (n === 1) trilinear(t, u, v, lod, out, 1);
  else {
    const [au, av] = px >= py ? [dudx, dvdx] : [dudy, dvdy];
    for (let i = 0; i < n; i++) { const o = (i + 0.5) / n - 0.5; trilinear(t, u + au * o, v + av * o, lod, out, 1 / n); }
  }
  mipStats.lodSum += Math.max(0, lod); mipStats.samples++; mipStats.taps += n;
  return lod;
}

/** three's ACESFilmicToneMapping (exposure / 0.6, RRT + ODT fit), linear in, linear out (clamped). */
export function acesFilmic(c: number[], exposure: number): number[] {
  const e = exposure / 0.6, r = c[0] * e, g = c[1] * e, b = c[2] * e;
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.076 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b];
  const f = i.map(v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081));
  return [1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2], -0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2], -0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2]].map(v => Math.min(1, Math.max(0, v)));
}

interface Vert { p: V3; n: V3; uv: [number, number]; c: V3 }

/** Render meshes of `root` (Mesh + InstancedMesh, single materials) to an RGB buffer. */
export function renderMeshes(root: THREE.Object3D, cam: PreviewCam, opt: PreviewOpts): Buffer {
  const {width: W, height: H} = opt;
  root.updateMatrixWorld(true);
  const eye = cam.pos, tgt = cam.target;
  const fwd = norm([tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]);
  let right = norm(cross(fwd, [0, 1, 0]));
  if (!Number.isFinite(right[0])) right = [1, 0, 0];
  const up = cross(right, fwd);
  const near = cam.near ?? 0.05, far = cam.far ?? 40;
  const f = H / 2 / Math.tan(((cam.fov ?? 70) * Math.PI) / 360);
  const ortho = cam.ortho ? H / cam.ortho : 0;
  const toCam = (p: V3): V3 => { const d: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]]; return [dot(d, right), dot(d, up), dot(d, fwd)]; };
  const proj = (c: V3): [number, number] => ortho ? [W / 2 + c[0] * ortho, H / 2 - c[1] * ortho] : [W / 2 + (c[0] / c[2]) * f, H / 2 - (c[1] / c[2]) * f];
  const img = new Float32Array(W * H * 3);
  // R1 opt-in: linear HDR accumulation (tone-mapped at the end) when `pbr`; footprint sampling when `mips` (or `pbr`).
  const pbr = opt.pbr ?? null, adv = !!(pbr || opt.mips), maxAniso = opt.mips?.aniso ?? 1;
  const fogCol: V3 = pbr?.fogColor ?? [0.0027, 0.0033, 0.003];
  for (let i = 0; i < W * H; i++) img.set(pbr ? fogCol : [0.02, 0.02, 0.025], i * 3);
  const zb = new Float32Array(W * H).fill(Infinity);
  const amb = opt.ambient ?? 0.32, flash = opt.flashlight ?? true, fogK = opt.fog ?? 0.035;
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.visible && !Array.isArray(m.material)) meshes.push(m); });
  const px = [0, 0, 0, 0];
  const passes: boolean[] = [false, true];
  for (const transparent of passes) {
    for (const mesh of meshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!!mat.transparent !== transparent) continue;
      if (!mat.isMeshStandardMaterial && !(mat as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial) continue;
      const g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, C = g.attributes.color;
      if (!P) continue;
      const map = texOf(mat.map);
      const wm = mat.userData?.worldMapping as {span: [number, number]; topAlongZ?: boolean} | undefined;
      const base: V3 = [mat.color.r, mat.color.g, mat.color.b].map(v => Math.pow(v, 1 / 2.2)) as V3;
      const useVC = !!mat.vertexColors && !!C;
      const alphaTest = mat.alphaTest ?? 0;
      const opacity = mat.opacity ?? 1;
      const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
      const count = inst ? inst.count : 1;
      // R1 opt-in: mip chains of the material's maps, linear base colour, world-mapping macro / grime values.
      const mm = adv ? {
        map: mipChain(mat.map), normal: pbr ? mipChain(mat.normalMap) : null, rough: pbr ? mipChain(mat.roughnessMap) : null,
        metal: pbr ? mipChain(mat.metalnessMap) : null, emis: pbr ? mipChain(mat.emissiveMap) : null,
        ns: (mat.normalScale ?? new THREE.Vector2(1, 1)) as THREE.Vector2,
        basic: !!(mat as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial && !mat.isMeshStandardMaterial,
        grime: (mat as unknown as {wmGrime?: THREE.Vector3}).wmGrime ?? null,
      } : null;
      const im = new THREE.Matrix4(), mw = new THREE.Matrix4(), nm = new THREE.Matrix3();
      const idx = g.index;
      const triCount = (idx ? idx.count : P.count) / 3;
      for (let k = 0; k < count; k++) {
        mw.copy(mesh.matrixWorld);
        if (inst) { inst.getMatrixAt(k, im); mw.multiply(im); }
        nm.getNormalMatrix(mw);
        // Cheap reject: bounding sphere vs camera distance.
        if (g.boundingSphere) {
          const c = g.boundingSphere.center.clone().applyMatrix4(mw);
          const cc = toCam([c.x, c.y, c.z]);
          const r = g.boundingSphere.radius * mw.getMaxScaleOnAxis();
          if (cc[2] + r < near || cc[2] - r > far) continue;
          if (!ortho && cc[2] > r && (Math.abs(cc[0]) - r > cc[2] * W / 2 / f + 1 || Math.abs(cc[1]) - r > cc[2] * H / 2 / f + 1)) continue;
        }
        const vtx = (i: number): Vert => {
          const v = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(mw);
          const n = N ? new THREE.Vector3(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize() : new THREE.Vector3(0, 1, 0);
          return {p: [v.x, v.y, v.z], n: [n.x, n.y, n.z], uv: UV ? [UV.getX(i), UV.getY(i)] : [0, 0], c: useVC ? [C.getX(i), C.getY(i), C.getZ(i)] : [1, 1, 1]};
        };
        for (let t = 0; t < triCount; t++) {
          const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          let vs = [vtx(ia), vtx(ib), vtx(ic)];
          const cs = vs.map(v => toCam(v.p));
          if (cs.every(c => c[2] < near) || cs.every(c => c[2] > far)) continue;
          // Back-face cull (materials are FrontSide).
          const e1 = sub(vs[1].p, vs[0].p), e2 = sub(vs[2].p, vs[0].p), gn = cross(e1, e2);
          const toEye = ortho ? [-fwd[0], -fwd[1], -fwd[2]] as V3 : sub(eye, vs[0].p);
          if (mat.side !== THREE.DoubleSide && dot(gn, toEye) <= 0) continue;
          // Near clip.
          let poly: {v: Vert; c: V3}[] = vs.map((v, i) => ({v, c: cs[i]}));
          if (!ortho && cs.some(c => c[2] < near)) poly = clipNear(poly, near);
          for (let j = 1; j + 1 < poly.length; j++) raster([poly[0], poly[j], poly[j + 1]]);
        }
      }
      function raster(tri: {v: Vert; c: V3}[]): void {
        const s = tri.map(t => proj(t.c));
        const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]);
        if (Math.abs(den) < 1e-9) return;
        const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
        const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
        if (x1 < x0 || y1 < y0) return;
        const iz = tri.map(t => (ortho ? 1 : 1 / t.c[2]));
        // R1 opt-in: perspective-correct barycentrics at any screen point (footprint derivatives) + the mesh-UV tangent frame.
        const bary = (sx: number, sy: number): V3 => {
          const a0 = ((s[1][1] - s[2][1]) * (sx - s[2][0]) + (s[2][0] - s[1][0]) * (sy - s[2][1])) / den;
          const a1 = ((s[2][1] - s[0][1]) * (sx - s[2][0]) + (s[0][0] - s[2][0]) * (sy - s[2][1])) / den;
          const b0 = a0 * iz[0], b1 = a1 * iz[1], b2 = (1 - a0 - a1) * iz[2], bs = b0 + b1 + b2;
          return [b0 / bs, b1 / bs, b2 / bs];
        };
        let uvT: V3 | null = null, uvB: V3 | null = null;
        if (mm && !wm) {
          const e1 = sub(tri[1].v.p, tri[0].v.p), e2 = sub(tri[2].v.p, tri[0].v.p);
          const du1 = tri[1].v.uv[0] - tri[0].v.uv[0], dv1 = tri[1].v.uv[1] - tri[0].v.uv[1], du2 = tri[2].v.uv[0] - tri[0].v.uv[0], dv2 = tri[2].v.uv[1] - tri[0].v.uv[1];
          const r = du1 * dv2 - du2 * dv1;
          if (Math.abs(r) > 1e-12) {
            uvT = norm([0, 1, 2].map(i => (e1[i] * dv2 - e2[i] * dv1) / r) as V3);
            uvB = norm([0, 1, 2].map(i => (e2[i] * du1 - e1[i] * du2) / r) as V3);
          }
        }
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const w0 = ((s[1][1] - s[2][1]) * (x + 0.5 - s[2][0]) + (s[2][0] - s[1][0]) * (y + 0.5 - s[2][1])) / den;
          const w1 = ((s[2][1] - s[0][1]) * (x + 0.5 - s[2][0]) + (s[0][0] - s[2][0]) * (y + 0.5 - s[2][1])) / den;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
          const q0 = w0 * iz[0], q1 = w1 * iz[1], q2 = w2 * iz[2], qs = q0 + q1 + q2;
          const z = ortho ? w0 * tri[0].c[2] + w1 * tri[1].c[2] + w2 * tri[2].c[2] : 1 / qs;
          const k = y * W + x;
          if (z > zb[k] + 1e-6) continue;
          const L = (a: number, b: number, c: number) => (a * q0 + b * q1 + c * q2) / qs;
          const p: V3 = [0, 1, 2].map(i => L(tri[0].v.p[i], tri[1].v.p[i], tri[2].v.p[i])) as V3;
          let u: number, v: number;
          const nrm = norm([0, 1, 2].map(i => L(tri[0].v.n[i], tri[1].v.n[i], tri[2].v.n[i])) as V3);
          if (wm) {
            const an = nrm.map(Math.abs);
            const uv = an[0] >= an[1] && an[0] >= an[2] ? [p[2], p[1]] : an[1] >= an[2] ? (wm.topAlongZ ? [p[2], p[0]] : [p[0], p[2]]) : [p[0], p[1]];
            u = uv[0] / wm.span[0]; v = uv[1] / wm.span[1];
          } else { u = L(tri[0].v.uv[0], tri[1].v.uv[0], tri[2].v.uv[0]); v = L(tri[0].v.uv[1], tri[1].v.uv[1], tri[2].v.uv[1]); }
          if (mm) { advPixel(x, y, k, z, p, nrm, u, v, [0, 1, 2].map(i => L(tri[0].v.c[i], tri[1].v.c[i], tri[2].v.c[i]))); continue; }
          if (map) sample(map, u, v, px); else { px[0] = px[1] = px[2] = px[3] = 1; }
          let a = px[3] * opacity;
          if (alphaTest > 0 && px[3] < alphaTest) continue;
          const vc = [0, 1, 2].map(i => L(tri[0].v.c[i], tri[1].v.c[i], tri[2].v.c[i]));
          // Light: flashlight from the eye (cone + falloff) + ambient + a weak overhead fill.
          const toE = norm(sub(eye, p)), dist = Math.hypot(eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]);
          const cone = Math.max(0, (dot(norm(sub(p, eye)), fwd) - 0.82) / 0.18);
          const fl = flash ? (1.5 * Math.max(0, dot(nrm, toE)) * Math.min(1, cone * 1.5)) / (1 + 0.05 * dist * dist) : 0.55 * Math.max(0, dot(nrm, toE));
          const lit = amb + fl + 0.12 * Math.max(0, nrm[1]);
          const fog = Math.exp(-fogK * dist);
          const emis = (mat.emissiveMap || (mat.emissive && mat.emissiveIntensity > 0 && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0)) ? 0.5 : 0;
          const out = [0, 1, 2].map(i => (px[i] * base[i] * vc[i] * (lit + emis)) * fog + 0.02 * (1 - fog));
          if (transparent) {
            for (let i = 0; i < 3; i++) img[k * 3 + i] = img[k * 3 + i] * (1 - a) + out[i] * a;
          } else {
            zb[k] = z;
            for (let i = 0; i < 3; i++) img[k * 3 + i] = out[i];
            a = 1;
          }
        }
        /** R1 opt-in pixel: footprint-filtered maps; `pbr` = linear-light shading, else the legacy lighting in sRGB space. */
        function advPixel(x: number, y: number, k: number, z: number, p: V3, nrm: V3, u: number, v: number, vc: number[]): void {
          const M = mm!;
          const an = nrm.map(Math.abs), axis = an[0] >= an[1] && an[0] >= an[2] ? 0 : an[1] >= an[2] ? 1 : 2;
          const uvAt = (b: V3): [number, number] => {
            if (wm) {
              const q = [0, 1, 2].map(i => b[0] * tri[0].v.p[i] + b[1] * tri[1].v.p[i] + b[2] * tri[2].v.p[i]);
              const st = axis === 0 ? [q[2], q[1]] : axis === 1 ? (wm.topAlongZ ? [q[2], q[0]] : [q[0], q[2]]) : [q[0], q[1]];
              return [st[0] / wm.span[0], st[1] / wm.span[1]];
            }
            return [b[0] * tri[0].v.uv[0] + b[1] * tri[1].v.uv[0] + b[2] * tri[2].v.uv[0], b[0] * tri[0].v.uv[1] + b[1] * tri[1].v.uv[1] + b[2] * tri[2].v.uv[1]];
          };
          const ux = uvAt(bary(x + 1.5, y + 0.5)), uy = uvAt(bary(x + 0.5, y + 1.5));
          const fp = [ux[0] - u, ux[1] - v, uy[0] - u, uy[1] - v] as const;
          const at = (t: MipTex, out: number[]) => sampleFootprint(t, u, v, fp[0], fp[1], fp[2], fp[3], maxAniso, out);
          const c = [1, 1, 1, 1];
          if (M.map) at(M.map, c);
          if (alphaTest > 0 && c[3] < alphaTest) return;
          let a = c[3] * opacity;
          const dist = Math.hypot(eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]);
          let out: number[];
          if (!pbr) {
            // mips only: the legacy lighting on the footprint-filtered colour (back in the map's own encoding)
            const srgb = mat.map?.colorSpace === THREE.SRGBColorSpace;
            const s3 = [0, 1, 2].map(i => (srgb ? linToSrgb(c[i]) : c[i]));
            const toE = norm(sub(eye, p)), cone = Math.max(0, (dot(norm(sub(p, eye)), fwd) - 0.82) / 0.18);
            const fl = flash ? (1.5 * Math.max(0, dot(nrm, toE)) * Math.min(1, cone * 1.5)) / (1 + 0.05 * dist * dist) : 0.55 * Math.max(0, dot(nrm, toE));
            const lit = amb + fl + 0.12 * Math.max(0, nrm[1]), fog = Math.exp(-fogK * dist);
            out = [0, 1, 2].map(i => (s3[i] * base[i] * vc[i] * lit) * fog + 0.02 * (1 - fog));
          } else {
            const col = [mat.color.r * c[0] * vc[0], mat.color.g * c[1] * vc[1], mat.color.b * c[2] * vc[2]];
            const V: V3 = ortho ? [-fwd[0], -fwd[1], -fwd[2]] : norm(sub(eye, p));
            let Nn: V3 = mat.side === THREE.DoubleSide && dot(nrm, V) < 0 ? [-nrm[0], -nrm[1], -nrm[2]] : nrm;
            let rough = mat.roughness ?? 1, metal = mat.metalness ?? 0;
            const tmp = [0, 0, 0, 0];
            if (M.rough) { at(M.rough, tmp); rough *= tmp[1]; }
            if (M.metal) { at(M.metal, tmp); metal *= tmp[2]; }
            if (wm && M.grime) {
              const G = M.grime, floorW = (1 - smooth(0, G.y, p[1] - (pbr.floorY ?? 0))) * (1 - smooth(0.5, 0.8, an[1]));
              const shade = (1 - G.x * floorW) * (1 + G.z * (wmNoiseCpu(p[0] * 0.7, p[1] * 0.7, p[2] * 0.7) - 0.5) * 2);
              for (let i = 0; i < 3; i++) col[i] *= shade;
              rough = Math.min(1, rough + G.x * 0.3 * floorW);
            }
            if (M.normal) {
              const T: V3 | null = wm ? (axis === 0 ? [0, 0, 1] : axis === 1 ? (wm.topAlongZ ? [0, 0, 1] : [1, 0, 0]) : [1, 0, 0]) : uvT;
              const B: V3 | null = wm ? (axis === 0 ? [0, 1, 0] : axis === 1 ? (wm.topAlongZ ? [1, 0, 0] : [0, 0, 1]) : [0, 1, 0]) : uvB;
              if (T && B) {
                at(M.normal, tmp);
                const tx = (tmp[0] * 2 - 1) * M.ns.x, ty = (tmp[1] * 2 - 1) * M.ns.y, tz = tmp[2] * 2 - 1;
                const To = norm(sub(T, scl(Nn, dot(Nn, T)))), Bo = norm(sub(B, scl(Nn, dot(Nn, B))));
                Nn = norm([To[0] * tx + Bo[0] * ty + Nn[0] * tz, To[1] * tx + Bo[1] * ty + Nn[1] * tz, To[2] * tx + Bo[2] * ty + Nn[2] * tz]);
              }
            }
            if (M.basic) out = col;
            else {
              rough = Math.min(1, Math.max(0.04, rough));
              const a2 = rough ** 4, diff = col.map(q => q * (1 - metal)), F0 = col.map(q => 0.04 * (1 - metal) + q * metal);
              const NdV = Math.max(1e-4, dot(Nn, V));
              const acc = [0, 0, 0];
              const light = (Ld: V3, E: number, lc: readonly number[], iso = 0) => {
                if (iso > 0) for (let i = 0; i < 3; i++) acc[i] += diff[i] / Math.PI * iso * E * lc[i];
                const NdL = dot(Nn, Ld);
                if (NdL <= 0 || E <= 0) return;
                const Hh = norm([Ld[0] + V[0], Ld[1] + V[1], Ld[2] + V[2]]), NdH = Math.max(0, dot(Nn, Hh)), VdH = Math.max(0, dot(V, Hh));
                const dd = NdH * NdH * (a2 - 1) + 1, D = a2 / (Math.PI * dd * dd);
                const gv = NdL * Math.sqrt(NdV * NdV * (1 - a2) + a2), gl = NdV * Math.sqrt(NdL * NdL * (1 - a2) + a2), Vis = 0.5 / Math.max(gv + gl, 1e-6);
                const fw = Math.pow(1 - VdH, 5);
                for (let i = 0; i < 3; i++) acc[i] += (diff[i] / Math.PI + (F0[i] + (1 - F0[i]) * fw) * Vis * D) * E * NdL * lc[i];
              };
              const fl = pbr.flashlight;
              if (fl) {
                const Ld = norm(sub(eye, p)), cosA = dot(norm(sub(p, eye)), fwd);
                const spot = smooth(Math.cos(fl.angle), Math.cos(fl.angle * (1 - fl.penumbra)), cosA);
                let att = 1 / Math.max(Math.pow(dist, fl.decay), 0.01);
                if (fl.distance > 0) att *= Math.pow(Math.min(1, Math.max(0, 1 - Math.pow(dist / fl.distance, 4))), 2);
                light(Ld, fl.intensity * att * spot, fl.color ?? [1, 0.905, 0.761]);
              }
              for (const l of pbr.lights ?? []) {
                const dv = sub(l.pos, p), d2 = dot(dv, dv), R2 = l.range * l.range;
                if (d2 >= R2) continue;
                const d = Math.sqrt(d2), down = dv[1] > 0 ? dv[1] / d : 0, q = d2 / R2;
                const E = l.intensity * (0.16 + 0.84 * down * down) * (1 - q * q) * (1 - q * q) / (d2 + 0.3);
                light([dv[0] / d, dv[1] / d, dv[2] / d], E, l.color ?? [0.88, 1.03, 0.92], 0.17);
              }
              const am = pbr.ambient;
              if (am) { const hw = 0.5 + 0.5 * Nn[1]; for (let i = 0; i < 3; i++) acc[i] += diff[i] * (am.ground[i] + (am.sky[i] - am.ground[i]) * hw) * am.intensity; }
              if (mat.emissive && mat.emissiveIntensity > 0) {
                const e = [1, 1, 1, 1];
                if (M.emis) at(M.emis, e);
                acc[0] += mat.emissive.r * mat.emissiveIntensity * e[0]; acc[1] += mat.emissive.g * mat.emissiveIntensity * e[1]; acc[2] += mat.emissive.b * mat.emissiveIntensity * e[2];
              }
              out = acc;
            }
            const ff = 1 - Math.exp(-Math.pow((pbr.fogDensity ?? 0) * dist, 2));
            out = out.map((q, i) => q * (1 - ff) + fogCol[i] * ff);
          }
          if (transparent) for (let i = 0; i < 3; i++) img[k * 3 + i] = img[k * 3 + i] * (1 - a) + out[i] * a;
          else { zb[k] = z; for (let i = 0; i < 3; i++) img[k * 3 + i] = out[i]; a = 1; }
        }
      }
    }
  }
  const buf = Buffer.alloc(W * H * 3);
  if (pbr) {
    const ex = pbr.exposure ?? 0.78;
    for (let i = 0; i < W * H; i++) {
      const t = acesFilmic([img[i * 3], img[i * 3 + 1], img[i * 3 + 2]], ex);
      for (let c = 0; c < 3; c++) buf[i * 3 + c] = Math.round(linToSrgb(t[c]) * 255);
    }
    return buf;
  }
  for (let i = 0; i < img.length; i++) buf[i] = Math.max(0, Math.min(255, Math.round(img[i] * 255)));
  return buf;
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const scl = (a: readonly number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

function clipNear(poly: {v: Vert; c: V3}[], near: number): {v: Vert; c: V3}[] {
  const out: {v: Vert; c: V3}[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a.c[2] >= near, inb = b.c[2] >= near;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (near - a.c[2]) / (b.c[2] - a.c[2]);
      const lerp = (x: number[], y: number[]) => x.map((v, j) => v + (y[j] - v) * t);
      out.push({c: lerp(a.c, b.c) as V3, v: {p: lerp(a.v.p, b.v.p) as V3, n: lerp(a.v.n, b.v.n) as V3, uv: lerp(a.v.uv, b.v.uv) as [number, number], c: lerp(a.v.c, b.v.c) as V3}});
    }
  }
  return out;
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
