// Task reactor-expansion-20261101 (lane CONTROLS): reads a cooked (uncompressed) GLB's triangles in model space for the mounted-control
// tests (no three.js loader in Node): positions through each mesh node's translation, interleaved buffer views honoured. Plus a
// Möller–Trumbore ray cast over a transformed triangle soup.
import fs from 'node:fs';
import path from 'node:path';

export type V3 = [number, number, number];
export type Tri = [V3, V3, V3];

const MODELS = path.resolve(__dirname, '../../public/assets/models');
const cache = new Map<string, Tri[]>();

/** Model-space triangles of game/public/assets/models/<file>. */
export function glbTris(file: string): Tri[] {
  const hit = cache.get(file);
  if (hit) return hit;
  const f = fs.readFileSync(path.join(MODELS, file));
  const jl = f.readUInt32LE(12);
  const j = JSON.parse(f.subarray(20, 20 + jl).toString('utf8'));
  const off = 20 + jl, bl = f.readUInt32LE(off), bin = f.subarray(off + 8, off + 8 + bl);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const acc = (i: number): number[] => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView];
    const n = ({SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4} as Record<string, number>)[a.type];
    const es = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? n * es, start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[] = [];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = start + k * stride + c * es;
      out.push(a.componentType === 5126 ? dv.getFloat32(o, true) : es === 4 ? dv.getUint32(o, true) : es === 2 ? dv.getUint16(o, true) : dv.getUint8(o));
    }
    return out;
  };
  const tris: Tri[] = [];
  for (const node of j.nodes) {
    if (node.mesh === undefined) continue;
    const t: V3 = node.translation ?? [0, 0, 0];
    for (const p of j.meshes[node.mesh].primitives) {
      const P = acc(p.attributes.POSITION), I = acc(p.indices);
      const v = (i: number): V3 => [P[i * 3] + t[0], P[i * 3 + 1] + t[1], P[i * 3 + 2] + t[2]];
      for (let k = 0; k < I.length; k += 3) tris.push([v(I[k]), v(I[k + 1]), v(I[k + 2])]);
    }
  }
  cache.set(file, tris);
  return tris;
}

/** Nearest hit t (>= 0, <= maxT) of the ray o + t d over `tris`, or null. */
export function rayTris(tris: readonly Tri[], o: V3, d: V3, maxT = Infinity): number | null {
  let best: number | null = null;
  for (const [a, b, c] of tris) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tx = o[0] - a[0], ty = o[1] - a[1], tz = o[2] - a[2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t >= 0 && t <= maxT && (best === null || t < best)) best = t;
  }
  return best;
}

/** Triangles mapped through f (model -> world). */
export function mapTris(tris: readonly Tri[], f: (x: number, y: number, z: number) => {x: number; y: number; z: number}): Tri[] {
  return tris.map(t => t.map(v => { const w = f(v[0], v[1], v[2]); return [w.x, w.y, w.z] as V3; }) as Tri);
}

/** Model-space AABB of a triangle soup. */
export function trisBox(tris: readonly Tri[]): {min: V3; max: V3} {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of t) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
  return {min, max};
}
