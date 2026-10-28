// CPU preview renderer for built station meshes (wall-treatment QA; no WebGL). Perspective or
// orthographic camera, z-buffer, near-plane clipping, perspective-correct UV / colour interpolation,
// texture sampling from canvas-shim images (map, alphaTest, vertex colours, transparency pass), the
// dominant-axis world mapping of world-mapped materials, instanced meshes, and a simple flashlight +
// fill lighting. Approximate on purpose: it shows composition, scale, alignment and seams, not the
// game's lighting.
import * as THREE from 'three';
import type {ShimCanvas} from './canvas2d';

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
  for (let i = 0; i < W * H; i++) img.set([0.02, 0.02, 0.025], i * 3);
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
      }
    }
  }
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < img.length; i++) buf[i] = Math.max(0, Math.min(255, Math.round(img[i] * 255)));
  return buf;
}

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
