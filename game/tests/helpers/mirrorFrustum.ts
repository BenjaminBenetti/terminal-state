// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane TESTS): the glass mirror's frustum on the tests' own terms — in the
// mirror camera's VIEW space, from the off-axis window the camera was given (left / right / top / bottom at the near distance, near,
// far). No projection matrix, so no clip-space convention (WebGL / WebGPU, reversed depth) enters it: independent of the pool test
// in render/glassMirror.ts, which asks three's Frustum built from projection x view.
import * as THREE from 'three';

/** What these checks read of the mirror camera (render/glassMirror.ts PaneCamera). */
export interface WindowCamera {
  left: number; right: number; top: number; bottom: number; near: number; far: number;
  matrixWorld: THREE.Matrix4; matrixWorldInverse: THREE.Matrix4;
}

/**
 * How far a sphere reaches into the camera's frustum (m): the least of its centre's signed distances to the six planes, plus its
 * radius. >= 0: it meets all six half-spaces (what a sphere-against-planes cull keeps); < 0: it lies wholly outside one of them.
 * With radius 0: how deep a point is inside (negative: outside).
 */
export function sphereReach(cam: WindowCamera, x: number, y: number, z: number, radius: number): number {
  const e = cam.matrixWorldInverse.elements;
  const vx = e[0] * x + e[4] * y + e[8] * z + e[12], vy = e[1] * x + e[5] * y + e[9] * z + e[13], d = -(e[2] * x + e[6] * y + e[10] * z + e[14]);
  const n = cam.near;
  // (a side plane holds the eye and one edge of the window at the near distance)
  return radius + Math.min(
    d - n, cam.far - d,
    (vx * n - cam.left * d) / Math.hypot(n, cam.left), (cam.right * d - vx * n) / Math.hypot(n, cam.right),
    (vy * n - cam.bottom * d) / Math.hypot(n, cam.bottom), (cam.top * d - vy * n) / Math.hypot(n, cam.top));
}

/**
 * The world point `depth` metres along the camera's view axis on the eye's ray through the window's (s, t): s 0..1 from its left
 * edge to its right one, t 0..1 from its bottom to its top (outside 0..1: beside the window).
 */
export function windowPoint(cam: WindowCamera, s: number, t: number, depth: number, out = new THREE.Vector3()): THREE.Vector3 {
  const k = depth / cam.near;
  return out.set((cam.left + (cam.right - cam.left) * s) * k, (cam.bottom + (cam.top - cam.bottom) * t) * k, -depth).applyMatrix4(cam.matrixWorld);
}

/** The camera's view direction (world, unit). */
export function viewDirection(cam: WindowCamera, out = new THREE.Vector3()): THREE.Vector3 {
  return out.setFromMatrixColumn(cam.matrixWorld, 2).negate().normalize();
}

const _m = new THREE.Matrix4(), _c = new THREE.Vector3();

/**
 * The farthest any instance of a pool reaches into the frustum (sphereReach of the geometry's bounding sphere under the instance's
 * matrix and the mesh's matrixWorld). An instance scaled to nothing is not there (`there` counts the others).
 *  - tight: the sphere's radius scaled by the combined matrix's largest axis scale (three's Sphere.applyMatrix4);
 *  - loose: by the product of the two matrices' largest axis scales (never smaller).
 */
export function poolReach(cam: WindowCamera, mesh: THREE.InstancedMesh): {tight: number; loose: number; there: number} {
  const g = mesh.geometry;
  if (g.boundingSphere === null) g.computeBoundingSphere();
  const bs = g.boundingSphere!, world = mesh.matrixWorld.getMaxScaleOnAxis(), count = Math.min(mesh.count, mesh.instanceMatrix.count);
  let tight = -Infinity, loose = -Infinity, there = 0;
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, _m);
    const own = _m.getMaxScaleOnAxis();
    if (!(own > 1e-6)) continue;
    there++;
    _m.premultiply(mesh.matrixWorld);
    _c.copy(bs.center).applyMatrix4(_m);
    tight = Math.max(tight, sphereReach(cam, _c.x, _c.y, _c.z, bs.radius * _m.getMaxScaleOnAxis()));
    loose = Math.max(loose, sphereReach(cam, _c.x, _c.y, _c.z, bs.radius * world * own));
  }
  return {tight, loose, there};
}
