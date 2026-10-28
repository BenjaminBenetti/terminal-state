// Iteration 12 (ARCH): a depth-buffered visibility oracle for culling tests (Node, no GL).
//
// Rasterises every mesh under `root` (ignoring layers, i.e. as if nothing were culled) into a small
// z-buffer for a camera and reports which meshes own visible pixels. Back faces are skipped like the GPU
// (single-sided materials), and non-depth-writing materials (decals, glass) never occlude. A culler is
// correct for a pose when no mesh in this set sits on the cull layer.
import * as THREE from 'three';

interface Cached { tri: Float32Array; side: THREE.Side; occluder: boolean; sphere: THREE.Sphere }
const cache = new WeakMap<THREE.Mesh, Cached>();

/** World-space triangles of a mesh (instances expanded), cached (station meshes never move). */
function cached(mesh: THREE.Mesh): Cached {
  let c = cache.get(mesh);
  if (c) return c;
  const geo = mesh.geometry;
  const P = geo.attributes.position, idx = geo.index;
  const nt = (idx ? idx.count : P.count) / 3;
  const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? mesh as THREE.InstancedMesh : null;
  const n = inst ? inst.count : 1;
  const tri = new Float32Array(nt * 9 * n);
  const m = new THREE.Matrix4(), im = new THREE.Matrix4(), v = new THREE.Vector3();
  let o = 0;
  for (let k = 0; k < n; k++) {
    m.copy(mesh.matrixWorld);
    if (inst) { inst.getMatrixAt(k, im); m.multiply(im); }
    for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) {
      v.fromBufferAttribute(P, idx ? idx.getX(3 * t + j) : 3 * t + j).applyMatrix4(m);
      tri[o++] = v.x; tri[o++] = v.y; tri[o++] = v.z;
    }
  }
  const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
  const box = new THREE.Box3();
  for (let i = 0; i < tri.length; i += 3) box.expandByPoint(v.set(tri[i], tri[i + 1], tri[i + 2]));
  c = {tri, side: mat.side, occluder: mat.depthWrite !== false && !mat.transparent, sphere: box.isEmpty() ? new THREE.Sphere() : box.getBoundingSphere(new THREE.Sphere())};
  cache.set(mesh, c);
  return c;
}

/**
 * Meshes owning at least `minPx` visible pixels (W x H raster) within `maxDist` of the eye, for `cam`.
 * `filter` limits which meshes are considered (all of them still occlude).
 */
export function visibleMeshes(root: THREE.Object3D, cam: THREE.PerspectiveCamera, W = 96, H = 54, opts: {maxDist?: number; minPx?: number; samples?: Map<THREE.Mesh, [number, number, number][]>} = {}): Map<THREE.Mesh, number> {
  const maxDist = opts.maxDist ?? Infinity, minPx = opts.minPx ?? 2;
  root.updateMatrixWorld(true);
  cam.updateMatrixWorld(true);
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const fr = new THREE.Frustum().setFromProjectionMatrix(vp);
  const e = vp.elements;
  const depth = new Float32Array(W * H).fill(Infinity);
  const owner = new Int32Array(W * H).fill(-1);
  const meshes: THREE.Mesh[] = [];
  const late: number[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    let p = mesh.parent;
    while (p) { if (!p.visible) return; p = p.parent; }
    const c = cached(mesh);
    if (!c.tri.length || !fr.intersectsSphere(c.sphere)) return;
    meshes.push(mesh);
  });
  const counts = new Float64Array(meshes.length);
  // Clip-space polygon scratch (x, y, z, w) and the near-plane clip.
  const clipNear = (poly: number[][]): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = a[3] + a[2], db = b[3] + b[2];
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]); }
    }
    return out;
  };
  const raster = (mi: number, write: boolean, side: THREE.Side, tri: Float32Array) => {
    for (let t = 0; t < tri.length; t += 9) {
      const poly: number[][] = [];
      let allOut = true;
      for (let j = 0; j < 3; j++) {
        const x = tri[t + 3 * j], y = tri[t + 3 * j + 1], z = tri[t + 3 * j + 2];
        const cx = e[0] * x + e[4] * y + e[8] * z + e[12], cy = e[1] * x + e[5] * y + e[9] * z + e[13];
        const cz = e[2] * x + e[6] * y + e[10] * z + e[14], cw = e[3] * x + e[7] * y + e[11] * z + e[15];
        poly.push([cx, cy, cz, cw]);
        if (cw > 0 && Math.abs(cx) <= cw * 1.05 && Math.abs(cy) <= cw * 1.05) allOut = false;
      }
      // Quick reject: every vertex beyond one side plane.
      if (allOut) {
        let rej = false;
        for (const [k, s] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) if (poly.every(v => s * v[k] > v[3] && v[3] > 0)) rej = true;
        if (rej || poly.every(v => v[3] + v[2] < 0)) continue;
      }
      const cl = clipNear(poly);
      if (cl.length < 3) continue;
      const sp = cl.map(v => [(v[0] / v[3] * 0.5 + 0.5) * W, (v[1] / v[3] * 0.5 + 0.5) * H, v[3]]);
      // Fan triangulation of the clipped polygon.
      for (let k = 1; k + 1 < sp.length; k++) {
        const A = sp[0], B = sp[k], C = sp[k + 1];
        const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
        if (Math.abs(area) < 1e-12) continue;
        if (side === THREE.FrontSide && area < 0) continue;
        if (side === THREE.BackSide && area > 0) continue;
        const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
        const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
          const qx = px + 0.5, qy = py + 0.5;
          let w0 = (B[0] - qx) * (C[1] - qy) - (C[0] - qx) * (B[1] - qy);
          let w1 = (C[0] - qx) * (A[1] - qy) - (A[0] - qx) * (C[1] - qy);
          let w2 = (A[0] - qx) * (B[1] - qy) - (B[0] - qx) * (A[1] - qy);
          if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const s = w0 + w1 + w2;
          // Perspective-correct view depth: 1/w interpolates linearly in screen space.
          const iw = (w0 / A[2] + w1 / B[2] + w2 / C[2]) / s;
          const d = 1 / iw;
          const pi = py * W + px;
          if (write) { if (d < depth[pi]) { depth[pi] = d; owner[pi] = mi; } } else if (d < depth[pi] - 1e-3 && d <= maxDist) counts[mi]++;
        }
      }
    }
  };
  meshes.forEach((mesh, mi) => { const c = cached(mesh); if (c.occluder) raster(mi, true, c.side, c.tri); else late.push(mi); });
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] < 0 || depth[i] > maxDist) continue;
    counts[owner[i]]++;
    if (opts.samples) {
      const m = meshes[owner[i]];
      let l = opts.samples.get(m);
      if (!l) opts.samples.set(m, (l = []));
      l.push([i % W, Math.floor(i / W), depth[i]]);
    }
  }
  for (const mi of late) { const c = cached(meshes[mi]); raster(mi, false, c.side, c.tri); }
  const out = new Map<THREE.Mesh, number>();
  meshes.forEach((m, i) => { if (counts[i] >= minPx) out.set(m, counts[i]); });
  return out;
}
