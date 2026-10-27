// CPU preview renderer for procedural box props (texture QA only, no WebGL): perspective z-buffer,
// the same dominant-axis world-metre projection, floor grime and tint rules as the runtime shader
// (world/materials.ts worldMapped), face-mapped panels from per-face 0..1 UVs, simple hemi + key light.
import * as THREE from 'three';
import type {ShapePart} from '../../src/gen/propShapes';
import type {ShimCanvas} from './canvas2d';

export interface RenderBox { part: ShapePart; mat: THREE.Material; tint?: number; at?: [number, number, number] }
type V3 = [number, number, number];

// Unit-cube faces: corners BL, BR, TR, TL as seen from outside, outward normal.
const FACES: {n: V3; c: V3[]}[] = [
  {n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]},
  {n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]},
  {n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]},
  {n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]},
  {n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]},
  {n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]},
];
const UVS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const srgb = (c: THREE.Color): V3 => { const h = c.getHex(); return [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]; };

interface Tri { p: V3[]; uv: [number, number][]; n: V3; mat: THREE.MeshStandardMaterial; tint: V3 }

function boxTris(b: RenderBox): Tri[] {
  const [sx, sy, sz] = b.part.s, [px, py, pz] = b.part.p, rx = b.part.rx ?? 0, at = b.at ?? [0, 0, 0];
  const cr = Math.cos(rx), sr = Math.sin(rx);
  const xf = (v: V3): V3 => { const x = v[0] * sx / 2, y = v[1] * sy / 2, z = v[2] * sz / 2; return [x + px + at[0], y * cr - z * sr + py + at[1], y * sr + z * cr + pz + at[2]]; };
  const rn = (n: V3): V3 => [n[0], n[1] * cr - n[2] * sr, n[1] * sr + n[2] * cr];
  const tint = b.tint === undefined ? [1, 1, 1] as V3 : srgb(new THREE.Color(b.tint));
  const out: Tri[] = [];
  for (const f of FACES) {
    const c = f.c.map(xf), n = rn(f.n), mat = b.mat as THREE.MeshStandardMaterial;
    out.push({p: [c[0], c[1], c[2]], uv: [UVS[0], UVS[1], UVS[2]], n, mat, tint}, {p: [c[0], c[2], c[3]], uv: [UVS[0], UVS[2], UVS[3]], n, mat, tint});
  }
  return out;
}

function sample(t: THREE.Texture | null, u: number, v: number): [number, number, number, number] {
  if (!t) return [1, 1, 1, 1];
  const c = t.image as unknown as ShimCanvas;
  const wrap = t.wrapS === THREE.RepeatWrapping;
  const fu = wrap ? u - Math.floor(u) : Math.min(0.9999, Math.max(0, u)), fv = wrap ? v - Math.floor(v) : Math.min(0.9999, Math.max(0, v));
  const x = Math.min(c.width - 1, Math.floor(fu * c.width)), y = Math.min(c.height - 1, Math.floor((1 - fv) * c.height)); // flipY
  const i = (y * c.width + x) * 4;
  return [c.data[i] / 255, c.data[i + 1] / 255, c.data[i + 2] / 255, c.data[i + 3] / 255];
}

/** Renders boxes from a yaw/pitch 3/4 view; returns size x size RGB. */
export function renderProps(boxes: RenderBox[], size: number, yawDeg = 35, pitchDeg = 18): Buffer {
  const tris = boxes.flatMap(boxTris);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t.p) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  const ctr: V3 = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const rad = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2;
  const fov = 45 * Math.PI / 180, dist = rad / Math.sin(fov / 2) * 1.02;
  const yw = yawDeg * Math.PI / 180, pt = pitchDeg * Math.PI / 180;
  const fwd: V3 = [-Math.sin(yw) * Math.cos(pt), -Math.sin(pt), -Math.cos(yw) * Math.cos(pt)];
  const eye: V3 = [ctr[0] - fwd[0] * dist, ctr[1] - fwd[1] * dist, ctr[2] - fwd[2] * dist];
  const right: V3 = [Math.cos(yw), 0, -Math.sin(yw)];
  const up: V3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const f = size / 2 / Math.tan(fov / 2);
  const proj = (p: V3): V3 => {
    const d: V3 = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    return [size / 2 + (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / z * f, size / 2 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z * f, z];
  };
  const img = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const g = 0.16 + 0.1 * y / size; img.set([g, g, g * 1.05], (y * size + x) * 3); }
  const zb = new Float32Array(size * size).fill(Infinity);
  const L: V3 = [0.35, 0.8, 0.5], ll = Math.hypot(...L);
  const pass = (transparent: boolean) => {
    for (const t of tris) {
      if (!!t.mat.transparent !== transparent) continue;
      const toEye: V3 = [eye[0] - t.p[0][0], eye[1] - t.p[0][1], eye[2] - t.p[0][2]];
      if (t.n[0] * toEye[0] + t.n[1] * toEye[1] + t.n[2] * toEye[2] <= 0) continue;
      const s = t.p.map(proj);
      if (s.some(v => v[2] <= 0.05)) continue;
      const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
      const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      const m = t.mat, wm = m.userData.worldMapping as {span: [number, number]; grime?: [number, number]; topAlongZ?: boolean} | undefined;
      const col = srgb(m.color), an = t.n.map(Math.abs) as V3;
      const lambert = 0.38 + 0.8 * Math.max(0, (t.n[0] * L[0] + t.n[1] * L[1] + t.n[2] * L[2]) / ll) + 0.12 * Math.max(0, t.n[1]);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const w0 = ((s[1][1] - s[2][1]) * (x + 0.5 - s[2][0]) + (s[2][0] - s[1][0]) * (y + 0.5 - s[2][1])) / den;
        const w1 = ((s[2][1] - s[0][1]) * (x + 0.5 - s[2][0]) + (s[0][0] - s[2][0]) * (y + 0.5 - s[2][1])) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // perspective-correct weights
        const q0 = w0 / s[0][2], q1 = w1 / s[1][2], q2 = w2 / s[2][2], qs = q0 + q1 + q2;
        const z = 1 / qs, k = y * size + x;
        if (z >= zb[k]) continue;
        const P = [0, 1, 2].map(i => (t.p[0][i] * q0 + t.p[1][i] * q1 + t.p[2][i] * q2) / qs) as V3;
        let u: number, v: number;
        if (wm) {
          const uv = an[0] >= an[1] && an[0] >= an[2] ? [P[2], P[1]] : an[1] >= an[2] ? (wm.topAlongZ ? [P[2], P[0]] : [P[0], P[2]]) : [P[0], P[1]];
          u = uv[0] / wm.span[0]; v = uv[1] / wm.span[1];
        } else { u = (t.uv[0][0] * q0 + t.uv[1][0] * q1 + t.uv[2][0] * q2) / qs; v = (t.uv[0][1] * q0 + t.uv[1][1] * q1 + t.uv[2][1] * q2) / qs; }
        const tx = sample(m.map, u, v);
        let grime = 1;
        if (wm?.grime) grime = 1 - wm.grime[0] * (1 - smooth(0, wm.grime[1], P[1])) * (1 - smooth(0.5, 0.8, an[1]));
        const em = m.emissiveMap ? sample(m.emissiveMap, u, v) : null;
        const rgb = [0, 1, 2].map(i => tx[i] * col[i] * t.tint[i] * grime * lambert + (em ? em[i] * m.emissiveIntensity * 0.7 : 0));
        if (transparent) {
          const a = tx[3] * m.opacity;
          for (let i = 0; i < 3; i++) img[k * 3 + i] = img[k * 3 + i] * (1 - a) + rgb[i] * a;
        } else {
          zb[k] = z;
          for (let i = 0; i < 3; i++) img[k * 3 + i] = rgb[i];
        }
      }
    }
  };
  pass(false);
  pass(true);
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < img.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(img[i] * 255)));
  return out;
}
