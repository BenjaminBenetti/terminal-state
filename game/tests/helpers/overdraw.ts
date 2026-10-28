// Iteration 08 (Lane G): per-mesh draw/overdraw estimate for a camera pose (Node, no GL): frustum-visible
// draw calls, triangles, NaN / huge triangles and front-facing covered pixels after clipping to the screen.
import * as THREE from 'three';

export interface MeshCost { name: string; calls: number; tris: number; px: number; nan: number; huge: number; maxEdge: number }

/** Clip a polygon (clip-space vec4s) against the 6 frustum planes. */
function clipPoly(poly: THREE.Vector4[]): THREE.Vector4[] {
  const planes: ((v: THREE.Vector4) => number)[] = [
    v => v.w + v.x, v => v.w - v.x, v => v.w + v.y, v => v.w - v.y, v => v.w + v.z, v => v.w - v.z,
  ];
  let out = poly;
  for (const d of planes) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      const da = d(a), db = d(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push(a.clone().lerp(b, t)); }
    }
    if (!out.length) return out;
  }
  return out;
}

export function overdraw(root: THREE.Object3D, cam: THREE.PerspectiveCamera, W: number, H: number): MeshCost[] {
  root.updateMatrixWorld(true);
  cam.updateMatrixWorld(true);
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const fr = new THREE.Frustum().setFromProjectionMatrix(vp);
  const res = new Map<string, MeshCost>();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const m = new THREE.Matrix4(), im = new THREE.Matrix4(), sph = new THREE.Sphere();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.layers.test(cam.layers)) return;
    let par = mesh.parent; let vis = true; while (par) { if (!par.visible) vis = false; par = par.parent; } if (!vis) return;
    const geo = mesh.geometry;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? mesh as THREE.InstancedMesh : null;
    if (inst) { if (!inst.boundingSphere) inst.computeBoundingSphere(); sph.copy(inst.boundingSphere!); } else { if (!geo.boundingSphere) geo.computeBoundingSphere(); sph.copy(geo.boundingSphere!); }
    sph.applyMatrix4(mesh.matrixWorld);
    if (mesh.frustumCulled && !fr.intersectsSphere(sph)) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    const dbl = mat.side === THREE.DoubleSide, back = mat.side === THREE.BackSide;
    const key = mesh.name.replace(/@.*$/, '') || mesh.type;
    let c = res.get(key); if (!c) res.set(key, (c = {name: key, calls: 0, tris: 0, px: 0, nan: 0, huge: 0, maxEdge: 0}));
    c.calls++;
    const P = geo.attributes.position, idx = geo.index;
    const nt = (idx ? idx.count : P.count) / 3;
    for (let k = 0; k < (inst ? inst.count : 1); k++) {
      m.copy(mesh.matrixWorld);
      if (inst) { inst.getMatrixAt(k, im); m.multiply(im); }
      c.tris += nt;
      for (let t = 0; t < nt; t++) {
        const ia = idx ? idx.getX(3 * t) : 3 * t, ib = idx ? idx.getX(3 * t + 1) : 3 * t + 1, ic = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
        A.fromBufferAttribute(P, ia).applyMatrix4(m); B.fromBufferAttribute(P, ib).applyMatrix4(m); C.fromBufferAttribute(P, ic).applyMatrix4(m);
        if (![A, B, C].every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))) { c.nan++; continue; }
        const e = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A));
        if (e > c.maxEdge) c.maxEdge = e;
        if (e > 200) c.huge++;
        const poly = clipPoly([A, B, C].map(v => new THREE.Vector4(v.x, v.y, v.z, 1).applyMatrix4(vp)));
        if (poly.length < 3) continue;
        let area = 0;
        const pts = poly.map(v => [(v.x / v.w * 0.5 + 0.5) * W, (v.y / v.w * 0.5 + 0.5) * H]);
        for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
        area /= 2; // > 0 = counter-clockwise = front face
        if (dbl) c.px += Math.abs(area); else if (back ? area < 0 : area > 0) c.px += Math.abs(area);
      }
    }
  });
  return [...res.values()].sort((a, b) => b.px - a.px);
}
