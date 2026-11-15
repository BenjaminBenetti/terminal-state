// Task baked-gi-visual-uplift-20261115-004324 (lane MIRROR): the live glass mirror (render/glassMirror.ts) without a GPU —
//  - the pane-space camera against EXPLICIT reflection geometry (the law of reflection, both axes, both sides, both clip-space
//    conventions): the texel a glass fragment reads from its world position is the one the mirror camera drew the reflected
//    point into; upright, not flipped; nothing behind the glass;
//  - the drawn window: world-anchored texel grid, the caps, the pad; clipping a pane to the main camera's frustum;
//  - the shader: the GENERATED GLSL of glassMirrorSample run on the CPU equals the CPU mapping; one sampled texture and no
//    uniform buffer more on glass under the mirror light, nothing at all without it;
//  - selection: the plane in view, hysteresis, the fade of a change, shot-out panes, the distance cap, line of sight;
//  - the draw: the scene pass's signature and call depth, glass left out (no feedback), renderer state and shadow flags restored
//    — also when the draw throws — and no material or light flag touched;
//  - instanced pools in the draw: one is drawn only when an instance of it is inside the mirror's frustum (the glass to the reach,
//    the window's four sides), judged against the test's own view-space frustum (helpers/mirrorFrustum.ts).
// The proof on the real Game (builds / pipelines / render contexts / shadow draws) is tests/glass-mirror-game.test.ts.
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {GLSLNodeBuilder, MeshStandardNodeMaterial, NodeMaterial, QuadMesh, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';
import {Fn, cameraPosition, positionLocal, uniform, vec4} from 'three/tsl';
import {
  GLASS_MIRROR, GLASS_MIRROR_CAPS, GLASS_MIRROR_TUNING, GM, GlassMirror, PaneCamera, clipPane, glassMirrorSample, isGlassMirrorPlaceholder, mirrorAlpha, mirrorCameraPose,
  mirrorFace, mirrorUv, mirrorWindow, type MirrorFace, type MirrorRenderer, type MirrorScenePass, type MirrorWindow, type PaneView,
} from '../src/render/glassMirror';
import {GlassPane, collectGlassPlanes, type GlassPlane} from '../src/world/glassPanes';
import type {PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {LEVELS} from '../src/levels/registry';
import {tagReflect} from '../src/render/reflectTag';
import {cabGlassMaterial} from '../src/world/elevator';
import {bindingRefreshStats} from '../src/render/bindingRefresh';
import {installLightFieldNode} from '../src/world/lightFieldNode';
import {installReflectNode, stationReflectLight} from '../src/world/reflectionNode';
import {rendererFor} from './helpers/fogCompile';
import {BUILTINS, mainBody, runFlow, type Env, type Val} from './helpers/glslEval';
import {sphereReach, viewDirection, windowPoint} from './helpers/mirrorFrustum';

const face0 = (): MirrorFace => ({side: 1, nx: 1, nz: 0, d: 0, dist: 0, sigma: 1});
const win0 = (): MirrorWindow => ({a0: 0, a1: 1, y0: 0, y1: 1, texel: 1, w: 1, h: 1});
const plane = (axis: 'x' | 'z', coord: number, u0: number, u1: number, y0 = 0.3, y1 = 2.3, o: {half?: number; id?: string; prop?: PropPlacement | null; broken?: (p: PropPlacement) => boolean; panes?: [number, number][]} = {}): GlassPlane => {
  const half = o.half ?? 0.01;
  const spans = o.panes ?? [[u0, u1]];
  return {id: o.id ?? `${axis}0:${coord.toFixed(3)}`, axis, coord, half, u0, u1, y0, y1, slot: 0, panes: spans.map(([a, b]) => new GlassPane(a, b, y0, y1, coord, half, 'storefront', o.prop ?? null, o.broken ?? null))};
};
const eyeCam = (pos: [number, number, number], look: [number, number, number], fov = 60, aspect = 16 / 9): THREE.PerspectiveCamera => {
  const c = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
  c.position.set(...pos);
  c.lookAt(...look);
  c.updateMatrixWorld(true);
  return c;
};

// ---------------------------------------------------------------------------------------------
describe('the mirrored face', () => {
  it('names the side the eye is on, the face toward it and the along-coordinate, for both axes and both sides', () => {
    const f = face0();
    // an 'x' plane at x = 5 (2 cm glass), eye at larger x: the face is x = 5.01, its normal +x
    mirrorFace({axis: 'x', coord: 5, half: 0.01}, 8, 2, f);
    expect([f.side, f.nx, f.nz, f.sigma]).toEqual([1, 1, 0, 1]);
    expect(f.d).toBeCloseTo(5.01, 12); expect(f.dist).toBeCloseTo(2.99, 12);
    // the other side: the face is x = 4.99, its normal -x
    mirrorFace({axis: 'x', coord: 5, half: 0.01}, 1, 2, f);
    expect([f.side, f.nx, f.nz, f.sigma]).toEqual([-1, -1, 0, -1]);
    expect(-f.d).toBeCloseTo(4.99, 12); expect(f.dist).toBeCloseTo(3.99, 12);
    // a 'z' plane at z = -3
    mirrorFace({axis: 'z', coord: -3, half: 0.01}, 0, 1, f);
    expect([f.side, f.nx, f.nz, f.sigma]).toEqual([1, 0, 1, -1]);
    expect(f.d).toBeCloseTo(-2.99, 12); expect(f.dist).toBeCloseTo(3.99, 12);
    mirrorFace({axis: 'z', coord: -3, half: 0.01}, 0, -7, f);
    expect([f.side, f.nx, f.nz, f.sigma]).toEqual([-1, 0, -1, 1]);
    expect(f.dist).toBeCloseTo(3.99, 12);
    // inside the glass: distance 0, never negative
    mirrorFace({axis: 'z', coord: -3, half: 0.01}, 0, -3.004, f);
    expect(f.dist).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the pane-space camera against explicit reflection geometry', () => {
  const cases: {name: string; axis: 'x' | 'z'; coord: number; eye: [number, number, number]}[] = [
    {name: "'z' plane, eye on the +z side", axis: 'z', coord: 2, eye: [1.2, 1.6, 5.1]},
    {name: "'z' plane, eye on the -z side", axis: 'z', coord: 2, eye: [-0.7, 1.45, -1.3]},
    {name: "'x' plane, eye on the +x side", axis: 'x', coord: -4, eye: [-1.1, 1.7, 3.3]},
    {name: "'x' plane, eye on the -x side", axis: 'x', coord: -4, eye: [-9.5, 1.2, -2.2]},
  ];
  // a little LCG: fixed sample points
  let seed = 12345;
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  for (const c of cases) {
    it(`${c.name}: a fragment's texel is where the mirror camera drew the reflected point; upright; not flipped; the glass is the near plane`, () => {
      const P = plane(c.axis, c.coord, -6, 6, 0.3, 2.6);
      const [ex, ey, ez] = c.eye;
      const f = mirrorFace(P, ex, ez, face0());
      const n = new THREE.Vector3(f.nx, 0, f.nz);
      const sd = (p: THREE.Vector3): number => f.nx * p.x + f.nz * p.z - f.d;
      const E = new THREE.Vector3(ex, ey, ez);
      expect(sd(E)).toBeCloseTo(f.dist, 12);
      // the window: the whole pane in the mirror's own along-coordinate
      const a0 = f.sigma > 0 ? P.u0 : -P.u1, a1 = f.sigma > 0 ? P.u1 : -P.u0;
      const win = mirrorWindow(a0, a1, P.y0, P.y1, 0.004, 1024, 512, win0());
      expect(win.a0).toBeLessThanOrEqual(a0); expect(win.a1).toBeGreaterThanOrEqual(a1);
      for (const [cs, reversed] of [[THREE.WebGLCoordinateSystem, false], [THREE.WebGPUCoordinateSystem, false], [THREE.WebGPUCoordinateSystem, true]] as const) {
        const cam = new PaneCamera();
        cam.coordinateSystem = cs;
        (cam as unknown as {_reversedDepth: boolean})._reversedDepth = reversed;
        mirrorCameraPose(f, win, ex, ey, ez, GLASS_MIRROR.reach, cam);
        cam.updateProjectionMatrix();
        // the camera sits at the mirrored eye, a proper rotation, its inverse exact
        const pos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        const mirrored = E.clone().addScaledVector(n, -2 * sd(E));
        expect(pos.distanceTo(mirrored)).toBeLessThan(1e-12);
        expect(cam.matrixWorld.determinant()).toBeCloseTo(1, 12);
        const id = new THREE.Matrix4().multiplyMatrices(cam.matrixWorld, cam.matrixWorldInverse).elements;
        new THREE.Matrix4().elements.forEach((v, i) => expect(id[i]).toBeCloseTo(v, 12));
        expect(cam.near).toBeCloseTo(f.dist, 12);
        const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        const project = (X: THREE.Vector3): {u: number; v: number; z: number; w: number} => {
          const q = new THREE.Vector4(X.x, X.y, X.z, 1).applyMatrix4(vp);
          return {u: (q.x / q.w + 1) / 2, v: (1 - q.y / q.w) / 2, z: q.z / q.w, w: q.w};
        };
        for (let k = 0; k < 40; k++) {
          // a point of the room on the eye's side of the glass, up to ~14 m out
          const along = (rnd() - 0.5) * 16, out = 0.05 + rnd() * 14, y = rnd() * 3.2;
          const X = new THREE.Vector3(c.axis === 'x' ? 0 : along, y, c.axis === 'x' ? along : 0).addScaledVector(n, f.d + out);
          expect(sd(X)).toBeCloseTo(out, 9);
          // where the eye sees it in the glass: the ray to its mirror image crosses the face at Q
          const Xm = X.clone().addScaledVector(n, -2 * sd(X));
          const t = sd(E) / (sd(E) + sd(X));
          const Q = E.clone().lerp(Xm, t);
          expect(Math.abs(sd(Q))).toBeLessThan(1e-9);
          // (the law of reflection at Q: the eye ray mirrored about the normal points at X)
          const dIn = Q.clone().sub(E).normalize(), dOut = dIn.clone().addScaledVector(n, -2 * dIn.dot(n));
          expect(dOut.distanceTo(X.clone().sub(Q).normalize())).toBeLessThan(1e-9);
          // the texel the glass fragment at Q reads (from its world position alone) is the one the mirror camera drew X into
          const drawn = project(X), [u, v] = mirrorUv(f, win, Q.x, Q.y, Q.z);
          expect(drawn.u).toBeCloseTo(u, 9);
          expect(drawn.v).toBeCloseTo(v, 9);
          expect(drawn.w).toBeGreaterThan(0);
        }
        // the glass itself is the near plane; what lies behind it (the shop) is cut; the far plane is `reach` beyond
        const onGlass = new THREE.Vector3(c.axis === 'x' ? 0 : 0.4, 1.3, c.axis === 'x' ? 0.4 : 0).addScaledVector(n, f.d);
        const zNear = cs === THREE.WebGLCoordinateSystem ? -1 : reversed ? 1 : 0, zFar = cs === THREE.WebGLCoordinateSystem ? 1 : reversed ? 0 : 1;
        expect(project(onGlass).z).toBeCloseTo(zNear, 9);
        expect(project(onGlass.clone().addScaledVector(n, GLASS_MIRROR.reach)).z).toBeCloseTo(zFar, 9);
        const behind = project(onGlass.clone().addScaledVector(n, -0.5)).z;
        expect(reversed ? behind > 1 : behind < zNear).toBe(true);
        // upright: straight up on the glass is up in the picture (v runs down); the picture's u runs with the camera's right
        const [u0, v0] = mirrorUv(f, win, onGlass.x, 1.0, onGlass.z), [u1, v1] = mirrorUv(f, win, onGlass.x, 2.0, onGlass.z);
        expect(u1).toBeCloseTo(u0, 12); expect(v1).toBeLessThan(v0);
        // not flipped: seen by the eye (looking at the glass), a thing on the eye's right appears on the right of its screen
        const main = eyeCam(c.eye, [ex - f.nx, ey, ez - f.nz]);
        const right = new THREE.Vector3().setFromMatrixColumn(main.matrixWorld, 0);
        const screenX = (p: THREE.Vector3): number => p.clone().project(main).x;
        const reflectionOf = (X: THREE.Vector3): THREE.Vector3 => E.clone().lerp(X.clone().addScaledVector(n, -2 * sd(X)), sd(E) / (sd(E) + sd(X)));
        const base = E.clone().addScaledVector(n, 1.5); // 1.5 m behind the eye
        const XR = base.clone().addScaledVector(right, 1.2), XL = base.clone().addScaledVector(right, -1.2);
        expect(screenX(reflectionOf(XR))).toBeGreaterThan(0);
        expect(screenX(reflectionOf(XL))).toBeLessThan(0);
        // ... and the mirror camera drew the right-hand thing where that fragment reads
        const QR = reflectionOf(XR), [ur] = mirrorUv(f, win, QR.x, QR.y, QR.z);
        expect(project(XR).u).toBeCloseTo(ur, 9);
      }
    });
  }

  it('an eye on the glass: the camera keeps a 5 cm near distance behind the face', () => {
    const P = plane('z', 0, -2, 2);
    const f = mirrorFace(P, 0.3, 0.012, face0()); // 2 mm in front of the face
    const cam = new PaneCamera();
    mirrorCameraPose(f, {a0: -2, a1: 2, y0: 0, y1: 2}, 0.3, 1.6, 0.012, GLASS_MIRROR.reach, cam);
    expect(cam.near).toBe(GLASS_MIRROR.minDistance);
    expect(new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).z).toBeCloseTo(0.01 - GLASS_MIRROR.minDistance, 12);
  });

  it('PaneCamera keeps its off-axis frustum when three asks it to re-derive the projection (a coordinate-system change)', () => {
    const cam = new PaneCamera();
    cam.left = -0.3; cam.right = 1.1; cam.top = 0.7; cam.bottom = -0.9; cam.near = 2; cam.far = 42;
    cam.coordinateSystem = THREE.WebGPUCoordinateSystem;
    cam.updateProjectionMatrix(); // (Renderer._updateCamera does exactly this)
    const want = new THREE.Matrix4().makePerspective(-0.3, 1.1, 0.7, -0.9, 2, 42, THREE.WebGPUCoordinateSystem, false);
    expect(cam.projectionMatrix.elements).toEqual(want.elements);
    expect(cam.projectionMatrixInverse.elements).toEqual(want.clone().invert().elements);
    expect(cam.matrixAutoUpdate).toBe(false);
    expect(cam.matrixWorldAutoUpdate).toBe(false);
    // a PerspectiveCamera by fov / aspect would be symmetric: this one is not
    expect(cam.projectionMatrix.elements[8]).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the drawn window', () => {
  it('covers the box plus the pad on a world-anchored texel grid, inside the caps', () => {
    const w = mirrorWindow(1.237, 4.911, 0.3, 2.42, 0.004, 1024, 512, win0());
    const pad = GLASS_MIRROR.padTexels * w.texel;
    expect(w.a0).toBeLessThanOrEqual(1.237 - pad + 1e-9); expect(w.a1).toBeGreaterThanOrEqual(4.911 + pad - 1e-9);
    expect(w.y0).toBeLessThanOrEqual(0.3 - pad + 1e-9); expect(w.y1).toBeGreaterThanOrEqual(2.42 + pad - 1e-9);
    expect(w.w).toBeLessThanOrEqual(1024); expect(w.h).toBeLessThanOrEqual(512);
    // edges on whole texels; the size is the extent in texels
    for (const e of [w.a0, w.a1, w.y0, w.y1]) expect(Math.abs(e / w.texel - Math.round(e / w.texel))).toBeLessThan(1e-9);
    expect((w.a1 - w.a0) / w.texel).toBeCloseTo(w.w, 9);
    expect((w.y1 - w.y0) / w.texel).toBeCloseTo(w.h, 9);
    // the texel is a power of sqrt(2), no finer than the screen needs
    expect(Math.abs(Math.log2(w.texel) * 2 - Math.round(Math.log2(w.texel) * 2))).toBeLessThan(1e-9);
    expect(w.texel).toBeGreaterThanOrEqual(0.004 / GLASS_MIRROR.density - 1e-12);
  });

  it('does not swim: a small move of the box keeps the texel grid (same texel, edges on the same lattice)', () => {
    const a = mirrorWindow(1.237, 4.911, 0.3, 2.42, 0.0040, 1024, 512, win0());
    const b = mirrorWindow(1.251, 4.903, 0.3, 2.42, 0.0041, 1024, 512, win0());
    expect(b.texel).toBe(a.texel);
    expect(Math.abs((b.a0 - a.a0) / a.texel - Math.round((b.a0 - a.a0) / a.texel))).toBeLessThan(1e-9);
    expect(b.y1).toBe(a.y1);
  });

  it('a box too large for the cap gets a coarser texel, never a larger picture; a tiny one the minimum size', () => {
    const big = mirrorWindow(-11, 11, 0.3, 2.4, 0.001, 1024, 512, win0());
    expect(big.w).toBeLessThanOrEqual(1024); expect(big.h).toBeLessThanOrEqual(512);
    expect(big.texel).toBeGreaterThan(22 / 1024);
    expect(big.a0).toBeLessThanOrEqual(-11); expect(big.a1).toBeGreaterThanOrEqual(11);
    const small = mirrorWindow(0, 1.5, 0.3, 2.4, 0.004, 96, 64, win0());
    expect(small.w).toBeLessThanOrEqual(96); expect(small.h).toBeLessThanOrEqual(64);
    expect(small.y0).toBeLessThanOrEqual(0.3); expect(small.y1).toBeGreaterThanOrEqual(2.4);
    const tiny = mirrorWindow(0, 0.01, 1, 1.01, 0.01, 1024, 512, win0());
    expect(tiny.w).toBeGreaterThanOrEqual(GLASS_MIRROR.minTexels); expect(tiny.h).toBeGreaterThanOrEqual(GLASS_MIRROR.minTexels);
  });
});

// ---------------------------------------------------------------------------------------------
describe('clipping a pane to the main camera', () => {
  const view = (): PaneView => ({area: 0, u0: Infinity, u1: -Infinity, y0: Infinity, y1: -Infinity});
  const vpOf = (c: THREE.PerspectiveCamera): THREE.Matrix4 => new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);

  it('a pane filling the view covers the whole screen; its visible box is the frustum footprint', () => {
    const c = eyeCam([0, 1.5, 2], [0, 1.5, 0], 60, 1);
    const v = view();
    const area = clipPane('z', 0, -50, 50, -50, 50, vpOf(c), v);
    expect(area).toBeCloseTo(4, 9);
    const half = 2 * Math.tan(THREE.MathUtils.degToRad(30));
    expect(v.u0).toBeCloseTo(-half, 9); expect(v.u1).toBeCloseTo(half, 9);
    expect(v.y0).toBeCloseTo(1.5 - half, 9); expect(v.y1).toBeCloseTo(1.5 + half, 9);
  });

  it('a small pane in view: its own box and its projected area; behind the camera or off to the side: nothing', () => {
    const c = eyeCam([0, 1.5, 4], [0, 1.5, 0], 60, 1);
    const v = view();
    const area = clipPane('z', 0, -0.5, 0.5, 1, 2, vpOf(c), v);
    // 1 m x 1 m at 4 m: (1 / (4 tan 30)) ^ 2 of the screen's 2 x 2
    const side = 1 / (4 * Math.tan(THREE.MathUtils.degToRad(30)));
    expect(area).toBeCloseTo(side * side, 9);
    expect([v.u0, v.u1, v.y0, v.y1].map(x => +x.toFixed(9))).toEqual([-0.5, 0.5, 1, 2]);
    expect(clipPane('z', 8, -0.5, 0.5, 1, 2, vpOf(c), view())).toBe(0); // behind the eye
    expect(clipPane('z', 0, 30, 31, 1, 2, vpOf(c), view())).toBe(0); // far off to the side
    // an 'x' plane seen from +x
    const cx = eyeCam([3, 1.5, 0], [0, 1.5, 0], 60, 1);
    const vx = view();
    expect(clipPane('x', 0, -0.5, 0.5, 1, 2, vpOf(cx), vx)).toBeCloseTo((1 / (3 * Math.tan(THREE.MathUtils.degToRad(30)))) ** 2, 9);
    expect([vx.u0, vx.u1]).toEqual([-0.5, 0.5]);
  });

  it('a pane crossing the screen edge and the near plane is cut there (areas add up; the box grows over panes)', () => {
    const c = eyeCam([0, 1.5, 1], [3, 1.5, 0], 70, 16 / 9); // looking along the glass
    const v = view();
    const whole = clipPane('z', 0, -4, 12, 0.3, 2.3, vpOf(c), v);
    expect(whole).toBeGreaterThan(0.2); expect(whole).toBeLessThan(4);
    expect(v.u0).toBeGreaterThan(-4); // (cut by the left screen edge, not the pane's own end)
    expect(v.u1).toBeCloseTo(12, 6);
    // two halves of the same pane add up to the whole, in one accumulating view
    const w = view();
    const left = clipPane('z', 0, -4, 3, 0.3, 2.3, vpOf(c), w), right = clipPane('z', 0, 3, 12, 0.3, 2.3, vpOf(c), w);
    expect(left + right).toBeCloseTo(whole, 9);
    expect(w.area).toBeCloseTo(whole, 9);
    expect([w.u0, w.u1, w.y0, w.y1].map(x => +x.toFixed(6))).toEqual([v.u0, v.u1, v.y0, v.y1].map(x => +x.toFixed(6)));
  });
});

// ---------------------------------------------------------------------------------------------
describe('the shader', () => {
  /** glassMirrorSample on a quad, its generated GLSL run on the CPU: the uv it looks up (the fake texture returns it) and the alpha. */
  function harness(): (p: [number, number, number], nrm: [number, number, number], eye: [number, number, number]) => {uv: [number, number] | null; rgb: number[]; a: number} {
    const P = uniform(new THREE.Vector3()), Nw = uniform(new THREE.Vector3());
    const m = new NodeMaterial();
    m.fragmentNode = Fn(() => (glassMirrorSample(P as never, Nw as never) as unknown as {toVar(n: string): never}).toVar('gmProbe'))() as never;
    const quad = new QuadMesh(m);
    const B = new (GLSLNodeBuilder as unknown as new (o: unknown, r: unknown) => {
      scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; build(): void; fragmentShader: string;
      uniforms: {fragment: {name: string; type: string; node: unknown}[]};
    })(quad, rendererFor('glsl'));
    B.scene = new THREE.Scene(); B.camera = new THREE.OrthographicCamera(); B.material = m;
    B.build();
    const code = mainBody(B.fragmentShader), unis = B.uniforms.fragment;
    expect(B.fragmentShader).toContain('textureLod'); // (an explicit level: legal inside the branches)
    return (p, nrm, eye) => {
      const env: Env = new Map();
      for (const u of unis) {
        const node = u.node as {value?: unknown};
        if (node === P) env.set(u.name, [...p]);
        else if (node === Nw) env.set(u.name, [...nrm]);
        else if (node === (cameraPosition as unknown) || u.name === 'cameraPosition') env.set(u.name, [...eye]);
        else if (node === GM.plane) env.set(u.name, GM.plane.value.toArray());
        else if (node === GM.rect) env.set(u.name, GM.rect.value.toArray());
        else if (node === GM.params) env.set(u.name, GM.params.value.toArray());
        else env.set(u.name, 0); // the sampler, three's flip-Y flag (off: the fake lookup returns the uv it was given)
      }
      let uv: [number, number] | null = null;
      const fns = {
        ...BUILTINS,
        textureLod: (a: Val[]) => { const q = a[1] as number[]; uv = [q[0], q[1]]; return [0.25, 0.5, 0.75, 1]; },
        lessThan: (a: Val[]) => (a[0] as number) < (a[1] as number),
      };
      const out = runFlow(code, env, fns, 'gmProbe') as number[];
      // (the var is declared at zero first; run to the end for its final value)
      runFlow(code, env, fns);
      const fin = (env.get('gmProbe') as number[] | undefined) ?? out;
      return {uv, rgb: fin.slice(0, 3), a: fin[3]};
    };
  }

  it('the generated GLSL of glassMirrorSample equals the CPU mapping: uv from the world position, alpha by plane / window / distance / strength', () => {
    const run = harness();
    const P = plane('z', 2, -6, 6, 0.3, 2.6), eye: [number, number, number] = [1.2, 1.6, 5.1];
    const f = mirrorFace(P, eye[0], eye[2], face0());
    const win = mirrorWindow(-3.2, 2.9, 0.3, 2.6, 0.004, 1024, 512, win0());
    const W = 1280, H = 720;
    const set = (strength: number) => {
      GM.plane.value.set(f.nx, f.nz, f.d, strength);
      GM.rect.value.set(win.a0, win.y1, 1 / (win.a1 - win.a0), 1 / (win.y1 - win.y0));
      GM.params.value.set(win.w / W, win.h / H, GLASS_MIRROR.edgeTexels / Math.max(win.w, win.h), 1.5);
    };
    try {
      set(1);
      const nrm: [number, number, number] = [0, 0, 1];
      let lit = 0;
      for (const [x, y] of [[0.4, 1.3], [-2.9, 0.5], [1.7, 2.4], [-1.05, 1.99], [2.2, 0.9]] as const) {
        const p: [number, number, number] = [x, y, f.d]; // on the face (z = d for this plane)
        const r = run(p, nrm, eye), a = mirrorAlpha(f, win, p[0], p[1], p[2], nrm, eye, 1);
        expect(a).toBeGreaterThan(0.9);
        expect(r.a).toBeCloseTo(a, 9);
        const [u, v] = mirrorUv(f, win, p[0], p[1], p[2]);
        expect(r.uv).not.toBeNull();
        expect(r.uv![0]).toBeCloseTo(u * win.w / W, 9);
        expect(r.uv![1]).toBeCloseTo(v * win.h / H, 9);
        // rgb = the texel times the gain
        expect(r.rgb[0]).toBeCloseTo(0.25 * 1.5, 9); expect(r.rgb[2]).toBeCloseTo(0.75 * 1.5, 9);
        lit++;
      }
      expect(lit).toBe(5);
      // off the plane (another pane 30 cm behind), a face edge-on, outside the window, beyond the cap: no lookup at all, alpha 0
      const offs: [[number, number, number], [number, number, number], [number, number, number]][] = [
        [[0.4, 1.3, f.d - 0.3], nrm, eye], [[0.4, 1.3, f.d], [1, 0, 0], eye], [[0.4, 1.3, f.d], [0, 1, 0], eye],
        [[win.a1 * -1 - 0.5, 1.3, f.d], nrm, eye], [[0.4, win.y1 + 0.2, f.d], nrm, eye], [[0.4, 1.3, f.d], nrm, [0.4, 1.6, f.d + 13]],
      ];
      for (const [p, nn, e] of offs) {
        const r = run(p, nn, e);
        expect(mirrorAlpha(f, win, p[0], p[1], p[2], nn, e, 1)).toBe(0);
        expect(r.a).toBe(0); expect(r.uv).toBeNull(); expect(r.rgb).toEqual([0, 0, 0]);
      }
      // the soft edge and the distance fade: between 0 and 1, the same number on both sides
      const edgeP: [number, number, number] = [-(win.a0 + win.texel * 1.2) * 1, 1.3, f.d]; // 1.2 texels inside the window's a0 edge (a = -x here)
      const re = run(edgeP, nrm, eye), ae = mirrorAlpha(f, win, edgeP[0], edgeP[1], edgeP[2], nrm, eye, 1);
      expect(ae).toBeGreaterThan(0.05); expect(ae).toBeLessThan(0.95);
      expect(re.a).toBeCloseTo(ae, 9);
      const farEye: [number, number, number] = [0.4, 1.6, f.d + GLASS_MIRROR.cap * 0.9];
      const rf = run([0.4, 1.6, f.d], nrm, farEye), af = mirrorAlpha(f, win, 0.4, 1.6, f.d, nrm, farEye, 1);
      expect(af).toBeGreaterThan(0.2); expect(af).toBeLessThan(0.8);
      expect(rf.a).toBeCloseTo(af, 9);
      // strength scales it; inactive (strength 0): nothing, no lookup
      set(0.4);
      expect(run([0.4, 1.3, f.d], nrm, eye).a).toBeCloseTo(0.4, 9);
      set(0);
      const off = run([0.4, 1.3, f.d], nrm, eye);
      expect(off.a).toBe(0); expect(off.uv).toBeNull();
    } finally {
      GM.plane.value.set(1, 0, 0, 0); GM.rect.value.set(0, 0, 1, 1); GM.params.value.set(0, 0, 1, 1);
    }
  });

  type Backend = 'glsl' | 'wgsl';
  const renderers = new Map<Backend, WebGPURenderer>();
  function lit(backend: Backend): WebGPURenderer {
    let r = renderers.get(backend);
    if (r) return r;
    const canvas = {getContext: () => null, style: {}, addEventListener() {}, removeEventListener() {}, width: 1, height: 1};
    r = new WebGPURenderer({canvas: canvas as unknown as HTMLCanvasElement, forceWebGL: backend === 'glsl'});
    (r as unknown as {hasFeature: () => boolean}).hasFeature = () => false;
    (r as unknown as {hasCompatibility: () => boolean}).hasCompatibility = () => false;
    (r.backend as unknown as {capabilities: unknown}).capabilities = {getUniformBufferLimit: () => 16384};
    r.toneMapping = THREE.ACESFilmicToneMapping;
    expect(installLightFieldNode(r)).toBe(true);
    expect(installReflectNode(r)).toBe(true);
    renderers.set(backend, r);
    return r;
  }
  function compile(backend: Backend, material: THREE.Material, lights: THREE.Light[]): string {
    const r = lit(backend), mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const scene = new THREE.Scene();
    scene.add(mesh);
    for (const l of lights) if (!l.parent) scene.add(l);
    const errors: string[] = [];
    const oe = console.error, ow = console.warn;
    console.error = console.warn = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
    try {
      const B = backend === 'glsl' ? GLSLNodeBuilder : WGSLNodeBuilder;
      const b = new B(mesh, r) as unknown as {scene: THREE.Scene; camera: THREE.Camera; material: THREE.Material; context: {material: THREE.Material}; lightsNode: unknown; build(): void; fragmentShader: string};
      b.scene = scene;
      b.camera = new THREE.PerspectiveCamera();
      b.material = material;
      b.context.material = material;
      b.lightsNode = (r as unknown as {lighting: {getNode(s: THREE.Scene): {setLights(l: THREE.Light[]): unknown}}}).lighting.getNode(scene).setLights(lights);
      b.build();
      expect(errors, `${backend}: a clean build`).toEqual([]);
      return b.fragmentShader;
    } finally {
      console.error = oe; console.warn = ow;
      scene.remove(mesh);
      for (const l of lights) scene.remove(l);
    }
  }
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  function bindings(backend: Backend, frag: string): {textures: number; ubos: number} {
    if (backend === 'wgsl') return {textures: count(frag, /var\s+\w+\s*:\s*texture_\w+(<\w+>)?\s*;/g), ubos: count(frag, /var<uniform>/g)};
    return {textures: count(frag, /uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler\w+\s+\w+;/g), ubos: count(frag, /layout\s*\(\s*std140\s*\)\s*uniform/g)};
  }

  it('the mirror light is a second session-wide light; under it ONLY glass gains the mirror: one sampled texture, no uniform buffer more, on both backends', () => {
    // (stationReflectLight(full, mirror): the mirror is the SECOND choice — with the plain shading and with the full one)
    const mats = {
      glass: () => tagReflect(new MeshStandardNodeMaterial({metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.42}), 'glass'),
      window: () => tagReflect(new MeshStandardNodeMaterial({metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.42}), 'window'),
      // (task train-glass-reflection-fix-20261115-213533: a cab's glass is never a mirror plane — the same probes-only program)
      cab: () => tagReflect(new MeshStandardNodeMaterial({metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.42}), 'cab'),
      steel: () => new MeshStandardNodeMaterial({metalness: 0.45, roughness: 0.4}),
      tile: () => tagReflect(new MeshStandardNodeMaterial({metalness: 0, roughness: 0.3}), 'gloss'),
      wall: () => new MeshStandardNodeMaterial({metalness: 0, roughness: 0.8}),
    };
    const rows: string[] = [];
    for (const full of [false, true]) {
      const plain = stationReflectLight(full), mirror = stationReflectLight(full, true);
      expect(mirror).not.toBe(plain);
      expect(stationReflectLight(full, true)).toBe(mirror);
      expect(stationReflectLight(full, false)).toBe(plain);
      expect([mirror.mirror, plain.mirror, mirror.full, plain.full]).toEqual([true, false, full, full]);
      expect(mirror.id).not.toBe(plain.id); // (a light's id is in three's program key)
      expect(mirror.castShadow).toBe(false);
      for (const backend of ['wgsl', 'glsl'] as const) {
        for (const [k, make] of Object.entries(mats)) {
          const a = compile(backend, make(), [plain, new THREE.HemisphereLight()]);
          const b = compile(backend, make(), [mirror, new THREE.HemisphereLight()]);
          const ba = bindings(backend, a), bb = bindings(backend, b), tag = `${backend} ${k}${full ? ' (full shading)' : ''}`;
          rows.push(`${tag}: probes ${a.length} chars ${JSON.stringify(ba)} -> mirror light ${b.length} chars ${JSON.stringify(bb)}`);
          expect(bb.ubos, `${tag}: no uniform buffer more`).toBe(ba.ubos);
          expect(bb.ubos).toBeLessThanOrEqual(12);
          if (k === 'glass') {
            expect(bb.textures, `${tag}: + the mirror picture`).toBe(ba.textures + 1);
            expect(bb.textures).toBeLessThanOrEqual(16);
            expect(b).not.toBe(a);
            expect(b).toContain(backend === 'wgsl' ? 'textureSampleLevel' : 'textureLod');
            // the picture is looked up once, behind the plane test; the probes behind "not a full mirror"
            expect(count(b, /cameraPosition/g)).toBeGreaterThan(count(a, /cameraPosition/g));
            expect(/[^\x00-\x7F]/.test(b)).toBe(false);
          } else {
            // every other class is the same program text under either reflecting light
            expect(bb.textures, tag).toBe(ba.textures);
            expect(b.length, tag).toBe(a.length);
          }
        }
      }
    }
    // (the four reflecting lights are four lights)
    expect(new Set([stationReflectLight(), stationReflectLight(true), stationReflectLight(false, true), stationReflectLight(true, true)].map(l => l.id)).size).toBe(4);
    console.log(rows.join('\n'));
    // the globals a program is built against: a placeholder picture, the mirror inactive
    expect(isGlassMirrorPlaceholder(GM.tex.value)).toBe(true);
    expect(GM.plane.value.w).toBe(0);
  });

  // Task train-glass-reflection-fix-20261115-213533: the train's +X door leaves are mirrored instances (player-train-fit.test.ts), whose
  // triangles wind against their normals — a two-sided normal flipped by the winding faces away from the eye there, and the Fresnel
  // response reads a face-on pane as grazing. The cab glass's normal faces the eye from the geometry alone: its program never reads
  // the front-facing builtin, where the same two-sided glass without that normal does.
  it("a cab's glass shades with a normal facing the eye, never by the winding: both backends, both reflecting lights", () => {
    const FRONT = /gl_FrontFacing|front_facing/;
    const plain = () => tagReflect(new MeshStandardNodeMaterial({metalness: 0, roughness: 0.08, transparent: true, opacity: 0.2, side: THREE.DoubleSide}), 'cab');
    for (const backend of ['wgsl', 'glsl'] as const) for (const mirror of [false, true]) {
      const lights = () => [stationReflectLight(true, mirror), new THREE.HemisphereLight()];
      const cab = compile(backend, cabGlassMaterial(), lights());
      const control = compile(backend, plain(), lights());
      expect(FRONT.test(control), `${backend}: a two-sided material's normal follows the winding`).toBe(true);
      expect(FRONT.test(cab), `${backend}${mirror ? ' (mirror light)' : ''}: the cab glass's does not`).toBe(false);
      expect(bindings(backend, cab), `${backend}: the same bindings (the probes)`).toEqual(bindings(backend, control));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// A renderer that records what the mirror does to it.

class FakeRenderer implements MirrorRenderer {
  target: THREE.RenderTarget | null = null;
  mrt: unknown = 'the-mrt';
  fn: unknown = null;
  autoClear = false; autoClearColor = true; autoClearDepth = false; autoClearStencil = true;
  toneMapping: THREE.ToneMapping = THREE.ACESFilmicToneMapping;
  outputColorSpace: string = THREE.SRGBColorSpace;
  transparent = true; opaque = false;
  size = new THREE.Vector2(1280, 720);
  boom: Error | null = null;
  /** (drawn / mats: the object and the material of every renderObject call of the draw, in order) */
  readonly draws: {target: THREE.RenderTarget | null; mrt: unknown; viewport: number[]; camera: THREE.Camera; autoClear: boolean[]; toneMapping: THREE.ToneMapping; outputColorSpace: string; flags: boolean[]; drawn: THREE.Object3D[]; mats: THREE.Material[]; layers: number; transparent: boolean; opaque: boolean}[] = [];
  private current: THREE.Object3D[] = [];
  private currentMats: THREE.Material[] = [];
  lights: THREE.SpotLight[] = [];
  getRenderTarget() { return this.target; }
  setRenderTarget(t: THREE.RenderTarget | null) { this.target = t; }
  getMRT() { return this.mrt; }
  setMRT(m: unknown) { this.mrt = m; return this; }
  getRenderObjectFunction() { return this.fn; }
  setRenderObjectFunction(f: unknown) { this.fn = f; }
  getDrawingBufferSize(v: THREE.Vector2) { return v.copy(this.size); }
  renderObject(...a: unknown[]) { this.current.push(a[0] as THREE.Object3D); this.currentMats.push(a[4] as THREE.Material); }
  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.current = []; this.currentMats = [];
    scene.updateMatrixWorld(); // (three: the scene's world matrices, once per render call)
    // three: every renderable through the render-object function (or renderObject itself) — a mesh with a material array once per
    // geometry group, with that group's material
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const f = (this.fn ?? this.renderObject.bind(this)) as (...a: unknown[]) => void;
      if (Array.isArray(mesh.material)) for (const g of mesh.geometry.groups) f.call(this, mesh, scene, camera, mesh.geometry, mesh.material[g.materialIndex ?? 0], g, null, null, null);
      else f.call(this, mesh, scene, camera, mesh.geometry, mesh.material, null, null, null, null);
    });
    this.draws.push({
      target: this.target, mrt: this.mrt, viewport: this.target ? this.target.viewport.toArray() : [], camera, autoClear: [this.autoClear, this.autoClearColor, this.autoClearDepth, this.autoClearStencil],
      toneMapping: this.toneMapping, outputColorSpace: this.outputColorSpace, flags: this.lights.flatMap(l => [l.shadow.autoUpdate, l.shadow.needsUpdate]), drawn: this.current, mats: this.currentMats,
      layers: camera.layers.mask, transparent: this.transparent, opaque: this.opaque,
    });
    if (this.boom) throw this.boom;
  }
  state(): unknown[] {
    return [this.target, this.mrt, this.fn, this.autoClear, this.autoClearColor, this.autoClearDepth, this.autoClearStencil, this.toneMapping, this.outputColorSpace, this.transparent, this.opaque];
  }
}

function sceneTarget(w = 1280, h = 720, samples = 4): THREE.RenderTarget {
  const t = new THREE.RenderTarget(w, h, {type: THREE.HalfFloatType, samples});
  const d = new THREE.DepthTexture(w, h);
  (d as unknown as {isRenderTargetTexture: boolean}).isRenderTargetTexture = true;
  t.depthTexture = d;
  return t;
}

function world(): {scene: THREE.Scene; wall: THREE.Mesh; glass: THREE.Mesh; glass2: THREE.Mesh; torch: THREE.SpotLight; other: THREE.SpotLight} {
  const scene = new THREE.Scene();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial({roughness: 0.8}));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tagReflect(new MeshStandardNodeMaterial({transparent: true, opacity: 0.4}), 'glass'));
  const glass2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), tagReflect(new THREE.MeshStandardMaterial({transparent: true, opacity: 0.2}), 'glass'));
  const torch = new THREE.SpotLight(0xffffff, 30);
  torch.castShadow = true;
  torch.shadow.autoUpdate = true; torch.shadow.needsUpdate = true;
  const other = new THREE.SpotLight(0xffffff, 1); // a shadow-capable light that does not cast
  other.shadow.autoUpdate = true; other.shadow.needsUpdate = false;
  scene.add(wall, glass, glass2, torch, other);
  return {scene, wall, glass, glass2, torch, other};
}

afterEach(() => {
  GM.plane.value.set(1, 0, 0, 0); GM.rect.value.set(0, 0, 1, 1); GM.params.value.set(0, 0, 1, 1);
});

// ---------------------------------------------------------------------------------------------
describe('selection', () => {
  const pass = (): MirrorScenePass | null => null;

  it('picks the plane in view, fades it in, keeps it until another is clearly better, and fades through a change', () => {
    // A: a wall of glass at z = 0 seen from +z; B: a pane at x = 4 seen from -x... both near the eye
    const A = plane('z', 0, -3, 3, 0.3, 2.3, {id: 'A'}), B = plane('x', 4, -1, 5, 0.3, 2.3, {id: 'B'});
    const gm = new GlassMirror({scenePass: pass});
    gm.setPlanes([A, B]);
    const eye: [number, number, number] = [1, 1.6, 2.5];
    const facingA = eyeCam(eye, [1, 1.5, 0]), facingB = eyeCam(eye, [4, 1.5, 2.5]);
    const dt = 1 / 60, steps = Math.ceil(GLASS_MIRROR.fade / dt);
    expect(gm.select(facingA, dt)).toBe(A);
    expect(gm.debug().strength as number).toBeGreaterThan(0);
    expect(gm.debug().strength as number).toBeLessThan(1);
    for (let i = 0; i < steps + 1; i++) expect(gm.select(facingA, dt)).toBe(A);
    expect(gm.debug().strength).toBe(1);
    // turn to face B squarely: A (now at the screen edge or gone) is replaced — fading out first while it is still in view
    const between = eyeCam(eye, [4, 1.5, 0.4]); // both in view, B larger
    let sawFade = false, switched = 0;
    for (let i = 0; i < 3 * steps && gm.plane !== B; i++) {
      const before = gm.debug().strength as number;
      gm.select(between, dt);
      if (gm.plane === A && (gm.debug().strength as number) < before) sawFade = true;
      switched = i;
    }
    expect(gm.plane).toBe(B);
    expect(sawFade).toBe(true);
    expect(switched).toBeGreaterThanOrEqual(steps - 2); // (not at once: A faded out over the fade time)
    for (let i = 0; i < steps + 1; i++) gm.select(facingB, dt);
    expect(gm.plane).toBe(B); expect(gm.debug().strength).toBe(1);
    // hysteresis: back at the in-between view the two are close — B stays (no flip-flop), for as long as we look
    for (let i = 0; i < 4 * steps; i++) expect(gm.select(between, dt)).toBe(B);
    // looking away from all glass: nothing; looking back: at once (nothing to fade out)
    const away = eyeCam(eye, [-5, 1.5, 9]);
    expect(gm.select(away, dt)).toBeNull();
    expect(gm.debug().strength).toBe(0);
    expect(gm.select(facingA, dt)).toBe(A);
  });

  it('never picks a plane beyond the cap, on another storey, with all its panes shot out, or that the eye cannot see', () => {
    const broken = new Set<PropPlacement>();
    const prop = {kind: 'shopGlazing', h: 2.4} as unknown as PropPlacement, prop2 = {kind: 'booth', h: 2.7} as unknown as PropPlacement;
    const A = plane('z', 0, -3, 3, 0.3, 2.3, {id: 'A', prop, broken: p => broken.has(p)});
    const far = plane('z', -GLASS_MIRROR.cap - 4, -3, 3, 0.3, 2.3, {id: 'far'});
    const upstairs = plane('z', 0, -3, 3, 6.3, 8.3, {id: 'upstairs'});
    const cam = eyeCam([0, 1.6, 3], [0, 1.5, 0]);
    let visible = true;
    const sightCalls: number[][] = [];
    const gm = new GlassMirror({scenePass: pass, sight: (...a) => { sightCalls.push(a); return visible; }});
    gm.setPlanes([far, upstairs]);
    expect(gm.select(cam)).toBeNull();
    gm.setPlanes([far, upstairs, A]);
    expect(gm.select(cam)).toBe(A);
    // the sight test runs from the eye to a point just in front of the face
    expect(sightCalls.length).toBeGreaterThan(0);
    expect(sightCalls[0].slice(0, 3)).toEqual([0, 1.6, 3]);
    expect(sightCalls[0][5]).toBeGreaterThan(0); expect(sightCalls[0][5]).toBeLessThan(0.2);
    // a wall in between
    visible = false;
    expect(gm.select(cam)).toBeNull();
    visible = true;
    expect(gm.select(cam)).toBe(A);
    // shot out, by the layout (the blocker cut down to its plinth) ...
    prop.h = 0.3;
    expect(gm.select(cam)).toBeNull();
    prop.h = 2.4;
    expect(gm.select(cam)).toBe(A);
    // ... or by the damage state
    broken.add(prop);
    expect(gm.select(cam)).toBeNull();
    broken.clear();
    // a plane with one pane gone still mirrors: only the intact pane counts
    const two = plane('z', 0, -3, 3, 0.3, 2.3, {id: 'two', panes: [[-3, -0.2], [0.2, 3]], prop: prop2, broken: p => broken.has(p)});
    const gm2 = new GlassMirror({scenePass: pass});
    gm2.setPlanes([two]);
    expect(gm2.select(cam)).toBe(two);
    // setPlanes(null): no mirror
    gm2.setPlanes(null);
    expect(gm2.select(cam)).toBeNull();
    expect(gm2.debug().planes).toBe(0);
  });

  // Task studio-baked-gi-visual-uplift-20261115-004324-01: the sight probes stand GLASS_MIRROR.probe in front of the glass and, when
  // none of those is seen, GLASS_MIRROR.standoff (just past a grid cell).
  it('sight: a second ring of probes a cell out finds glass that stands in sight-blocking cells; a pane behind a wall is seen from neither ring', () => {
    expect(GLASS_MIRROR.standoff).toBeGreaterThan(0.5); // (past one 0.5 m grid cell)
    expect(GLASS_MIRROR.probe).toBeLessThan(0.2);
    // a pane at z = 0 seen from z = 3; `wall`: nothing is seen across the plane z = wall (a sight test of the test's own)
    const A = plane('z', 0, -3, 3, 0.3, 2.3, {id: 'A'});
    const cam = eyeCam([0, 1.6, 3], [0, 1.5, 0]);
    let wall = NaN;
    const calls: {z: number; seen: boolean}[] = [];
    const gm = new GlassMirror({scenePass: pass, sight: (_ax, _ay, az, _bx, _by, bz) => { const seen = !((az - wall) * (bz - wall) < 0); calls.push({z: bz, seen}); return seen; }});
    gm.setPlanes([A]);
    const ring1 = A.half + GLASS_MIRROR.probe, ring2 = A.half + GLASS_MIRROR.standoff;
    const look = (): GlassPlane | null => { calls.length = 0; return gm.select(cam); };
    // nothing in the way: the first probe sees it — one call, in the first ring
    expect(look()).toBe(A);
    expect(calls.map(c => [+c.z.toFixed(6), c.seen])).toEqual([[+ring1.toFixed(6), true]]);
    // the glass stands in cells that block sight up to 0.3 m in front of it (a booth's own footprint): the first ring's three
    // probes are blocked, the second ring's first one is seen
    wall = 0.3;
    expect(look()).toBe(A);
    expect(calls.map(c => [+c.z.toFixed(6), c.seen])).toEqual([[+ring1.toFixed(6), false], [+ring1.toFixed(6), false], [+ring1.toFixed(6), false], [+ring2.toFixed(6), true]]);
    // a wall a metre in front of the pane: both rings are behind it — three probes each, none seen, no mirror
    wall = 1;
    expect(look()).toBeNull();
    expect(calls.map(c => [+c.z.toFixed(6), c.seen])).toEqual([...Array(3).fill([+ring1.toFixed(6), false]), ...Array(3).fill([+ring2.toFixed(6), false])]);
    // an eye closer to the glass than the second ring stands: that ring is 0.9 of the eye's distance, never behind the eye
    const close = eyeCam([0, 1.6, 0.4], [0, 1.5, 0]);
    wall = 0.2;
    calls.length = 0;
    expect(gm.select(close)).toBe(A);
    expect(calls.length).toBe(4);
    expect(calls[3].seen).toBe(true);
    expect(calls[3].z).toBeGreaterThan(wall);
    expect(calls[3].z).toBeLessThan(0.4);
    expect(calls[3].z).toBeCloseTo(A.half + (0.4 - A.half) * 0.9, 9);
  });

  it('sight on the real Subway (seed 93, the game\'s own line of sight): the ticket booth\'s panes are seen through the second ring; glass with both rings blocked is never picked', () => {
    const L = LEVELS.subway.generate('main', {levelSeed: 93}) as StationLayout, levels = levelsOf(L);
    const a = {x: 0, y: 0, z: 0}, b = {x: 0, y: 0, z: 0};
    const calls: {x: number; z: number; seen: boolean}[] = [];
    // (as Game.syncGlassMirror wires it)
    const sight = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean => {
      a.x = ax; a.y = ay; a.z = az; b.x = bx; b.y = by; b.z = bz;
      const seen = levels.lineOfSight(a, b);
      calls.push({x: bx, z: bz, seen});
      return seen;
    };
    const planes = collectGlassPlanes(L);
    const gm = new GlassMirror({scenePass: pass, sight});
    gm.setPlanes(planes);
    // standing beside the booth, looking at its side pane
    const eye: [number, number, number] = [249.43, 1.62, 22.9];
    const got = gm.select(eyeCam(eye, [246.13, 1.5, 24]));
    expect(got).not.toBeNull();
    expect([got!.axis, +got!.coord.toFixed(1), got!.panes.every(p => p.source === 'booth')]).toEqual(['x', 247.2, true]);
    // its probes: the three of the first ring stand in the booth's own footprint cells and are blocked; the second ring is seen
    const side = eye[0] >= got!.coord ? 1 : -1;
    const at = (off: number) => calls.filter(c => Math.abs(c.x - (got!.coord + side * (got!.half + off))) < 1e-9);
    expect(at(GLASS_MIRROR.probe).map(c => c.seen)).toEqual([false, false, false]);
    expect(at(GLASS_MIRROR.standoff).some(c => c.seen)).toBe(true);

    // every plane of the main level, from eyes around it (on clear floor, looking at its middle): it is picked only when one of its
    // probes is seen, and when all six are blocked (a wall in between) it never is
    let picked = 0, viaSecond = 0, blocked = 0, views = 0;
    for (const P of planes) {
      if (P.slot !== 0) continue;
      const one = new GlassMirror({scenePass: pass, sight});
      one.setPlanes([P]);
      const um = (P.u0 + P.u1) / 2, ym = (P.y0 + P.y1) / 2;
      for (const d of [-9, -6, -3.5, -2, 2, 3.5, 6, 9]) for (const s of [-7, -3.5, 0, 3.5, 7]) {
        const c = P.coord + d, u = um + s, x = P.axis === 'x' ? c : u, z = P.axis === 'x' ? u : c;
        if (!(x > 1 && z > 1 && x < L.grid.w * 0.5 - 1 && z < L.grid.h * 0.5 - 1) || !L.grid.circleClear(x, z, 0.3)) continue;
        const floor = L.grid.floorAt(x, z);
        if (!(Math.abs(floor) < 0.2)) continue; // (the concourse floor, not a track bed)
        calls.length = 0;
        const sel = one.select(eyeCam([x, floor + 1.62, z], P.axis === 'x' ? [P.coord, ym, um] : [um, ym, P.coord]));
        views++;
        const seen = calls.some(q => q.seen);
        if (sel) { picked++; expect(sel).toBe(P); expect(seen, `${P.id} from ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(true); if (calls.length > 3) viaSecond++; }
        else if (calls.length > 0) { expect(seen).toBe(false); expect(calls.length, 'both rings were tried').toBe(6); blocked++; }
      }
    }
    console.log(`glass-mirror sight, Subway 93: ${planes.length} planes, ${views} views, ${picked} picked (${viaSecond} through the second ring), ${blocked} with both rings blocked`);
    expect(picked).toBeGreaterThan(20);
    expect(viaSecond).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });

  it('a sliver of glass at the screen edge is not worth a mirror; selection allocates nothing', () => {
    const A = plane('z', 0, -3, 3, 0.3, 2.3, {id: 'A'});
    const gm = new GlassMirror({scenePass: pass});
    gm.setPlanes([A]);
    // looking almost along the glass, away from it: only a thin strip of it in view
    const cam = eyeCam([2.9, 1.6, 0.4], [9, 1.6, 2.6]);
    expect(gm.select(cam)).toBeNull();
    // (no allocation: the same scratch is reused — a smoke check that repeated calls keep working and stay stable)
    const facing = eyeCam([0, 1.6, 3], [0, 1.5, 0]);
    const first = gm.select(facing);
    for (let i = 0; i < 200; i++) expect(gm.select(facing)).toBe(first);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the draw', () => {
  const A = plane('z', 0, -3, 3, 0.3, 2.3, {id: 'A'});
  const cam = (): THREE.PerspectiveCamera => { const c = eyeCam([0.5, 1.6, 3], [0, 1.5, 0]); c.layers.mask = 0b1011; return c; };
  const settle = (gm: GlassMirror, c: THREE.PerspectiveCamera): void => { for (let i = 0; i < 20; i++) gm.select(c, 1 / 60); };

  it("draws the scene from the mirrored eye into a target of the scene pass's signature, leaves glass out, and restores everything", () => {
    const st = sceneTarget(1280, 720, 4), W = world();
    const r = new FakeRenderer();
    r.lights = [W.torch, W.other];
    const prev = sceneTarget(64, 64, 0);
    r.target = prev;
    const custom = () => {};
    r.fn = custom;
    const gm = new GlassMirror({scenePass: () => ({target: st, depth: 1}), cap: GLASS_MIRROR_CAPS.standard});
    gm.setPlanes([A]);
    const c = cam();
    settle(gm, c);
    const visibleBefore = [W.wall, W.glass, W.glass2].map(m => (m.material as THREE.Material).visible);
    const before = r.state(), bumps = bindingRefreshStats.bumps;
    expect(isGlassMirrorPlaceholder(GM.tex.value)).toBe(true);
    expect(gm.render(r, W.scene, c)).toBe(true);
    expect(r.draws.length).toBe(1);
    const d = r.draws[0], t = d.target!;
    // the target: the scene pass's signature at the cap's size, linear, its own depth texture of the same kind
    expect(t).not.toBe(st);
    expect([t.width, t.height, t.samples, t.texture.type, t.texture.format, t.texture.colorSpace, t.depthBuffer, t.stencilBuffer]).toEqual([...GLASS_MIRROR_CAPS.standard, 4, st.texture.type, st.texture.format, st.texture.colorSpace, st.depthBuffer, st.stencilBuffer]);
    expect([t.depthTexture!.type, t.depthTexture!.format]).toEqual([st.depthTexture!.type, st.depthTexture!.format]);
    expect(t.depthTexture).not.toBe(st.depthTexture);
    expect((t.depthTexture as unknown as {isRenderTargetTexture: boolean}).isRenderTargetTexture).toBe(true);
    expect([t.texture.minFilter, t.texture.magFilter, t.texture.generateMipmaps]).toEqual([THREE.LinearFilter, THREE.LinearFilter, false]);
    // the draw's state: no MRT, cleared, the scene pass's output state, the mirror camera with the MAIN camera's layers
    expect(d.mrt).toBeNull();
    expect(d.autoClear).toEqual([true, true, true, true]);
    expect(d.toneMapping).toBe(THREE.NoToneMapping);
    expect(d.outputColorSpace).toBe(THREE.ColorManagement.workingColorSpace);
    expect([d.transparent, d.opaque]).toEqual([true, true]);
    expect(d.camera).toBe(gm.camera);
    expect(d.layers).toBe(0b1011);
    expect(c.layers.mask).toBe(0b1011);
    // a sub-viewport at the top-left of the target, inside the cap
    const dbg = gm.debug() as {window: {size: [number, number]}; target: {size: number[]; samples: number}; drawn: number; skipped: number};
    expect(d.viewport).toEqual([0, 0, dbg.window.size[0], dbg.window.size[1]]);
    expect(dbg.window.size[0]).toBeLessThanOrEqual(1024); expect(dbg.window.size[1]).toBeLessThanOrEqual(512);
    // no shadow pass during it: every shadow light's flags off, then exactly as they were
    expect(d.flags).toEqual([false, false, false, false]);
    expect([W.torch.shadow.autoUpdate, W.torch.shadow.needsUpdate, W.other.shadow.autoUpdate, W.other.shadow.needsUpdate]).toEqual([true, true, true, false]);
    expect([W.torch.visible, W.torch.castShadow, W.other.castShadow]).toEqual([true, true, false]);
    // glass was not drawn (no feedback), everything else was; no material flag was touched
    expect(d.drawn).toEqual([W.wall]);
    expect([dbg.drawn, dbg.skipped]).toEqual([1, 2]);
    expect([W.wall, W.glass, W.glass2].map(m => (m.material as THREE.Material).visible)).toEqual(visibleBefore);
    // the renderer is exactly as before (target, MRT, the custom render-object function, clear flags, output state)
    expect(r.state()).toEqual(before);
    expect(r.fn).toBe(custom);
    // the picture is bound now (once: one binding refresh) and the uniforms describe this draw
    expect(GM.tex.value).toBe(t.texture);
    expect(bindingRefreshStats.bumps).toBe(bumps + 1);
    expect(GM.plane.value.toArray()).toEqual([0, 1, 0.01, 1]);
    const win = dbg.window as unknown as {a: [number, number]; y: [number, number]};
    expect(GM.rect.value.x).toBeCloseTo(win.a[0], 3); expect(GM.rect.value.y).toBeCloseTo(win.y[1], 3);
    expect(GM.params.value.x).toBeCloseTo(dbg.window.size[0] / t.width, 12); expect(GM.params.value.y).toBeCloseTo(dbg.window.size[1] / t.height, 12);
    expect(GM.params.value.w).toBe(GLASS_MIRROR_TUNING.gain);
    // a second frame: the same target (never re-allocated), no further binding refresh
    expect(gm.render(r, W.scene, c)).toBe(true);
    expect(r.draws[1].target).toBe(t);
    expect(bindingRefreshStats.bumps).toBe(bumps + 1);
    expect((gm.debug() as {targets: number}).targets).toBe(1);
    // the mirror camera: at the mirrored eye, looking back through the glass
    const p = new THREE.Vector3().setFromMatrixPosition(gm.camera.matrixWorld);
    expect(p.x).toBeCloseTo(0.5, 12); expect(p.y).toBeCloseTo(1.6, 12); expect(p.z).toBeCloseTo(0.01 - (3 - 0.01), 12);
    expect(gm.camera.position.distanceTo(p)).toBeLessThan(1e-9);
    // dispose: the placeholder is bound again (one more refresh), the mirror inactive, the target released
    let released = 0;
    t.addEventListener('dispose', () => { released++; });
    gm.dispose();
    expect(isGlassMirrorPlaceholder(GM.tex.value)).toBe(true);
    expect(GM.plane.value.w).toBe(0);
    expect(bindingRefreshStats.bumps).toBe(bumps + 2);
    expect(released).toBe(1);
    expect(gm.render(r, W.scene, c)).toBe(false);
    expect(r.draws.length).toBe(2);
  });

  // Task train-glass-reflection-fix-20261115-213533: a cab's glass (the train's windows and door leaves, the glass lift) never samples
  // the picture (its program has no lookup: the mirror light test below), so it is drawn into the mirror like any other surface.
  it("a cab's glass is drawn into the mirror: only 'glass' is left out", () => {
    const st = sceneTarget(1280, 720, 4), W = world();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cabGlassMaterial());
    W.scene.add(cab);
    const r = new FakeRenderer();
    const gm = new GlassMirror({scenePass: () => ({target: st, depth: 1}), cap: GLASS_MIRROR_CAPS.standard});
    gm.setPlanes([A]);
    const c = cam();
    settle(gm, c);
    expect(gm.render(r, W.scene, c)).toBe(true);
    expect(r.draws[0].drawn).toEqual([W.wall, cab]);
    expect((gm.debug() as {skipped: number}).skipped).toBe(2);
    gm.dispose();
  });

  it('restores the renderer and the shadow flags when the draw throws, stays off afterwards, and never throws into the frame', () => {
    const st = sceneTarget(), W = world();
    const r = new FakeRenderer();
    r.lights = [W.torch, W.other];
    const gm = new GlassMirror({scenePass: () => ({target: st, depth: 1})});
    gm.setPlanes([A]);
    const c = cam();
    settle(gm, c);
    const before = r.state();
    r.boom = new Error('device lost in the mirror pass');
    const oe = console.error;
    const logged: unknown[][] = [];
    console.error = (...a: unknown[]) => { logged.push(a); };
    try {
      expect(gm.render(r, W.scene, c)).toBe(false);
    } finally { console.error = oe; }
    expect(logged.length).toBe(1);
    expect(r.state()).toEqual(before);
    expect([W.torch.shadow.autoUpdate, W.torch.shadow.needsUpdate, W.other.shadow.autoUpdate, W.other.shadow.needsUpdate]).toEqual([true, true, true, false]);
    expect(GM.plane.value.w).toBe(0);
    expect(isGlassMirrorPlaceholder(GM.tex.value)).toBe(true); // (never bound: the picture was not drawn)
    expect((gm.debug() as {failed: string}).failed).toContain('device lost');
    // off for good: no further draw, no selection
    r.boom = null;
    expect(gm.render(r, W.scene, c)).toBe(false);
    expect(r.draws.length).toBe(1);
    expect(gm.select(c)).toBeNull();
    gm.dispose();
  });

  it('draws nothing without a scene pass (the direct path), without a plane, or while the plane is out of view — and is inactive then', () => {
    const st = sceneTarget(), W = world();
    const r = new FakeRenderer();
    let pass: MirrorScenePass | null = null;
    const gm = new GlassMirror({scenePass: () => pass});
    gm.setPlanes([A]);
    const c = cam();
    settle(gm, c);
    const before = r.state();
    expect(gm.render(r, W.scene, c)).toBe(false); // no scene pass
    pass = {target: st, depth: 1};
    expect(gm.render(r, W.scene, c)).toBe(true);
    expect(GM.plane.value.w).toBe(1);
    // the camera turned away since the selection: nothing to draw this frame, inactive
    const away = eyeCam([0.5, 1.6, 3], [0.5, 1.6, 9]);
    expect(gm.render(r, W.scene, away)).toBe(false);
    expect(GM.plane.value.w).toBe(0);
    // no plane selected
    gm.select(away);
    expect(gm.plane).toBeNull();
    expect(gm.render(r, W.scene, c)).toBe(false);
    expect(r.draws.length).toBe(1);
    expect(r.state()).toEqual(before);
    // a scene target not yet sized (1 x 1 before the first frame): not drawn
    settle(gm, c);
    pass = {target: sceneTarget(1, 1, 4), depth: 1};
    expect(gm.render(r, W.scene, c)).toBe(false);
    gm.dispose();
  });

  it('prime(): one draw with no plane in view (the warm-up), bound but never shown', () => {
    const st = sceneTarget(), W = world();
    const r = new FakeRenderer();
    const gm = new GlassMirror({scenePass: () => ({target: st, depth: 1})});
    gm.setPlanes([A, plane('x', 30, 0, 4, 0.3, 2.3, {id: 'far'})]);
    const away = eyeCam([0.5, 1.6, 3], [0.5, 1.6, 9]);
    expect(gm.render(r, W.scene, away)).toBe(false);
    gm.prime();
    expect(gm.render(r, W.scene, away)).toBe(true);
    expect(r.draws.length).toBe(1);
    expect(GM.tex.value).toBe(r.draws[0].target!.texture);
    expect(GM.plane.value.w).toBe(0); // (strength 0: no glass shows it)
    expect(gm.render(r, W.scene, away)).toBe(false); // once
    expect(r.draws.length).toBe(1);
    gm.dispose();
  });

  it('follows the scene target: a new signature re-creates the target (placeholder bound in between) — at the cap\'s size, or matched to the scene target\'s', () => {
    const W = world(), r = new FakeRenderer();
    let st = sceneTarget(1280, 720, 4);
    const gm = new GlassMirror({scenePass: () => ({target: st, depth: 1}), match: true});
    gm.setPlanes([A]);
    const c = cam();
    settle(gm, c);
    expect(gm.render(r, W.scene, c)).toBe(true);
    const t0 = r.draws[0].target!;
    let released = 0;
    t0.addEventListener('dispose', () => { released++; });
    st = sceneTarget(1920, 1080, 0); // a quality / size change rebuilt the scene pass
    expect(gm.render(r, W.scene, c)).toBe(true);
    const t1 = r.draws[1].target!;
    expect(t1).not.toBe(t0);
    expect([t1.width, t1.height, t1.samples]).toEqual([1920, 1080, 0]);
    expect(released).toBe(1);
    expect(GM.tex.value).toBe(t1.texture);
    gm.dispose();
    // the default: exactly the cap, whatever the scene target's size (a size change of the scene target alone re-creates
    // nothing; another sample count does); a viewport that would equal the drawing buffer is nudged
    const r2 = new FakeRenderer();
    const gm2 = new GlassMirror({scenePass: () => ({target: st, depth: 1}), cap: [512, 256]});
    gm2.setPlanes([A]);
    settle(gm2, c);
    expect(gm2.render(r2, W.scene, c)).toBe(true);
    const t2 = r2.draws[0].target!;
    expect([t2.width, t2.height, t2.samples]).toEqual([512, 256, 0]);
    st = sceneTarget(2560, 1440, 0);
    expect(gm2.render(r2, W.scene, c)).toBe(true);
    expect(r2.draws[1].target).toBe(t2);
    st = sceneTarget(2560, 1440, 4);
    expect(gm2.render(r2, W.scene, c)).toBe(true);
    const t3 = r2.draws[2].target!;
    expect(t3).not.toBe(t2);
    expect([t3.width, t3.height, t3.samples]).toEqual([512, 256, 4]);
    const [, , vw, vh] = r2.draws[0].viewport;
    expect(vw).toBeLessThanOrEqual(512); expect(vh).toBeLessThanOrEqual(256);
    r2.size.set(vw, vh); // the drawing buffer happens to be exactly the viewport's size
    expect(gm2.render(r2, W.scene, c)).toBe(true);
    const v2 = r2.draws[3].viewport;
    expect(v2[2] !== vw || v2[3] !== vh).toBe(true);
    gm2.dispose();
  });

  it('draws as far as the reflected path reaches (eye to glass to the thing), and leaves out an instanced pool with nothing in it', () => {
    const W = world(), r = new FakeRenderer(), st = sceneTarget(1280, 720, 4);
    const empty = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial(), 8);
    empty.count = 0;
    const filled = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial(), 8);
    filled.count = 3;
    W.scene.add(empty, filled);
    const gm = new GlassMirror({scenePass: () => ({target: st, depth: 1})});
    gm.setPlanes([A]);
    const c = cam(); // (3 m in front of the glass, less the glass's half thickness)
    settle(gm, c);
    expect(gm.render(r, W.scene, c)).toBe(true);
    expect(r.draws[0].drawn).toEqual([W.wall, filled]);
    const mc = r.draws[0].camera as THREE.PerspectiveCamera;
    const eyeToGlass = (gm.debug() as {eyeDistance: number}).eyeDistance;
    expect(eyeToGlass).toBeGreaterThan(2.9);
    expect(mc.near).toBeCloseTo(eyeToGlass, 3);
    expect(mc.far).toBeCloseTo(GLASS_MIRROR.reach, 3); // the camera sits at the mirrored eye: its far distance IS the path length
    filled.count = 0; empty.count = 2; // (pools fill and drain in play)
    expect(gm.render(r, W.scene, c)).toBe(true);
    expect(r.draws[1].drawn).toEqual([W.wall, empty]);
    gm.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// Task studio-baked-gi-visual-uplift-20261115-004324-01 (lane TESTS): instanced pools in the mirror's draw. three culls an
// InstancedMesh by one sphere round ALL its instances (a station-wide pool is always "in view"); the mirror's render-object function
// draws a pool only when one of its instances' own spheres meets the mirror's frustum. Every place below is built from the mirror
// camera's own window (helpers/mirrorFrustum.ts: view space, no projection matrix) and checked to be clearly inside or outside.
describe('the draw: instanced pools', () => {
  const A = plane('z', 0, -3, 3, 0.3, 2.3, {id: 'A'});
  /** The pools' geometry: a 0.2 m cube (its bounding sphere: its centre, RADIUS). */
  const cube = (): THREE.BufferGeometry => new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const RADIUS = 0.1 * Math.sqrt(3);
  /** The cube in `k` material groups (indices 0..k-1). */
  const grouped = (k: number): THREE.BufferGeometry => { const g = cube(); g.clearGroups(); for (let i = 0; i < k; i++) g.addGroup(i * 36 / k, 36 / k, i); return g; };
  const plain = (): THREE.Material => new MeshStandardNodeMaterial();
  /** Materials that place their vertices in the shader (the instance matrices do not say where the pool is drawn). */
  const moved = (): THREE.Material => { const m = new MeshStandardNodeMaterial(); m.positionNode = positionLocal.add(1) as never; return m; };
  const shaped = (): THREE.Material => { const m = new MeshStandardNodeMaterial(); m.vertexNode = vec4(positionLocal, 1) as never; return m; };
  const CONVENTIONS = [
    {name: 'WebGL clip space', cs: THREE.WebGLCoordinateSystem, reversed: false},
    {name: 'WebGPU clip space', cs: THREE.WebGPUCoordinateSystem, reversed: false},
    {name: 'WebGPU clip space with reversed depth', cs: THREE.WebGPUCoordinateSystem, reversed: true},
  ] as const;

  afterEach(() => { vi.restoreAllMocks(); });

  /** A mirror in front of pane A (the eye 3 m from it), one plain wall in the scene, and places inside / outside its frustum. */
  function stage(convention: (typeof CONVENTIONS)[number] = CONVENTIONS[1]) {
    const st = sceneTarget(1280, 720, 4), r = new FakeRenderer(), scene = new THREE.Scene();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial({roughness: 0.8}));
    wall.name = 'wall';
    scene.add(wall);
    const gm = new GlassMirror({scenePass: () => ({target: st, depth: 1})});
    // (three gives a camera the renderer's clip-space convention when it first draws with it; the mirror's projection follows it)
    gm.camera.coordinateSystem = convention.cs;
    (gm.camera as unknown as {_reversedDepth: boolean})._reversedDepth = convention.reversed;
    gm.setPlanes([A]);
    const c = eyeCam([0.5, 1.6, 3], [0, 1.5, 0]);
    for (let i = 0; i < 20; i++) gm.select(c, 1 / 60);
    const draw = (camera: THREE.PerspectiveCamera = c): {names: string[]; mats: THREE.Material[]; pools: number} => {
      expect(gm.render(r, scene, camera)).toBe(true);
      const d = r.draws[r.draws.length - 1];
      return {names: d.drawn.map(o => o.name), mats: d.mats, pools: gm.stats.pools};
    };
    // one draw before any pool exists: the mirror camera of this view (the eye stands still: the same for every draw below)
    const first = draw();
    expect([first.names, first.pools]).toEqual([['wall'], 0]);
    const mc = gm.camera, n = mc.near, f = mc.far;
    expect([mc.coordinateSystem, mc.reversedDepth]).toEqual([convention.cs, convention.reversed]);
    expect(f).toBeCloseTo(GLASS_MIRROR.reach, 3);
    const P = {
      inside: windowPoint(mc, 0.5, 0.5, n + 3), // 3 m in front of the glass, in the middle of the window
      nearGlass: windowPoint(mc, 0.7, 0.4, n + 0.5),
      farEnd: windowPoint(mc, 0.3, 0.6, f - 2),
      behindGlass: windowPoint(mc, 0.5, 0.5, n * 0.8), // on the shop's side of the pane: between the mirrored eye and the glass
      behindEye: windowPoint(mc, 0.5, 0.5, -2),
      beyond: windowPoint(mc, 0.5, 0.5, f + 2),
      left: windowPoint(mc, -1, 0.5, n + 3), right: windowPoint(mc, 2, 0.5, n + 3), above: windowPoint(mc, 0.5, 2, n + 3), below: windowPoint(mc, 0.5, -1, n + 3),
    };
    const outs = [P.behindGlass, P.behindEye, P.beyond, P.left, P.right, P.above, P.below];
    // clearly inside (the cube's whole sphere and 0.1 m more) or clearly outside (its sphere by 0.2 m), by the test's own frustum
    for (const p of [P.inside, P.nearGlass, P.farEnd]) expect(sphereReach(mc, p.x, p.y, p.z, 0)).toBeGreaterThan(RADIUS + 0.1);
    for (const p of outs) expect(sphereReach(mc, p.x, p.y, p.z, RADIUS)).toBeLessThan(-0.2);
    const put = (mesh: THREE.InstancedMesh, i: number, p: THREE.Vector3, scale = 1, q = new THREE.Quaternion()): void => {
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(p, q, new THREE.Vector3(scale, scale, scale)));
    };
    const pool = (name: string, at: THREE.Vector3[], o: {material?: THREE.Material | THREE.Material[]; geometry?: THREE.BufferGeometry; parent?: THREE.Object3D} = {}): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(o.geometry ?? cube(), o.material ?? plain(), Math.max(1, at.length));
      mesh.name = name;
      mesh.count = at.length;
      at.forEach((p, i) => put(mesh, i, p));
      (o.parent ?? scene).add(mesh);
      return mesh;
    };
    return {gm, r, scene, wall, c, mc, P, outs, put, pool, draw};
  }

  for (const convention of CONVENTIONS) {
    it(`${convention.name}: a pool with an instance inside the mirror's frustum is drawn; one with none (behind the glass, behind the mirrored eye, beyond the reach, off any side) is left out and counted`, () => {
      const S = stage(convention), {P, outs, pool, mc} = S;
      pool('inside', [P.inside]);
      pool('near the glass', [P.nearGlass]);
      pool('at the far end', [P.farEnd]);
      pool('behind the glass', [P.behindGlass]);
      pool('behind the mirrored eye', [P.behindEye]);
      pool('beyond the reach', [P.beyond]);
      pool('left', [P.left]); pool('right', [P.right]); pool('above', [P.above]); pool('below', [P.below]);
      pool('all over, none inside', outs);
      pool('the first of many inside', [P.inside, ...outs]);
      pool('one in the middle inside', [...outs.slice(0, 4), P.farEnd, ...outs.slice(4)]);
      pool('only the last inside', [...Array.from({length: 9}, () => outs).flat(), P.nearGlass]); // 63 outside, then the one
      // a sphere that crosses a plane of the frustum reaches into it
      const acrossGlass = windowPoint(mc, 0.5, 0.5, mc.near - RADIUS / 2), acrossFar = windowPoint(mc, 0.5, 0.5, mc.far + RADIUS / 2);
      for (const p of [acrossGlass, acrossFar]) {
        expect(sphereReach(mc, p.x, p.y, p.z, 0)).toBeLessThan(0);
        expect(sphereReach(mc, p.x, p.y, p.z, RADIUS)).toBeGreaterThan(0.05);
      }
      pool('across the glass', [acrossGlass]);
      pool('across the far plane', [acrossFar]);
      // not the pool test's business: a plain mesh (three culls those itself), glass (left out as glass)
      const far = new THREE.Mesh(cube(), plain());
      far.name = 'a plain mesh beyond the reach';
      far.position.copy(P.beyond);
      S.scene.add(far);
      pool('glass, inside', [P.inside], {material: tagReflect(new MeshStandardNodeMaterial({transparent: true, opacity: 0.4}), 'glass')});
      const d = S.draw();
      expect(d.names).toEqual([
        'wall', 'inside', 'near the glass', 'at the far end', 'the first of many inside', 'one in the middle inside', 'only the last inside', 'across the glass', 'across the far plane',
        'a plain mesh beyond the reach',
      ]);
      expect(d.pools).toBe(8);
      expect(S.gm.debug()).toMatchObject({drawn: 10, pools: 8, skipped: 1});
      // the same answer draw after draw (the counter is the last draw's, not a running total)
      for (let i = 0; i < 3; i++) { const again = S.draw(); expect([again.names, again.pools]).toEqual([d.names, d.pools]); }
      S.gm.dispose();
    });
  }

  it('instances that move between draws: the answer is this draw\'s; the instance that was inside last time is asked first, and is no answer once it has left', () => {
    const S = stage(), {P, put} = S;
    const tests = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere');
    const asked = (): number => { const k = tests.mock.calls.length; tests.mockClear(); return k; };
    const p = S.pool('p', [P.left, P.behindGlass, P.beyond, P.right]);
    const out = {names: ['wall'], pools: 1}, drawn = {names: ['wall', 'p'], pools: 0};
    expect(S.draw()).toMatchObject(out);
    expect(asked()).toBe(4);
    put(p, 2, P.inside); // (one moved into view)
    expect(S.draw()).toMatchObject(drawn);
    expect(asked()).toBeLessThanOrEqual(4);
    expect(S.draw()).toMatchObject(drawn);
    expect(asked(), 'the one that was inside is asked first').toBe(1);
    put(p, 2, P.beyond); // (and out again)
    expect(S.draw()).toMatchObject(out);
    expect(asked(), 'every instance once, the one asked first not twice').toBe(4);
    put(p, 0, P.farEnd); // (another one in)
    expect(S.draw()).toMatchObject(drawn);
    expect(S.draw()).toMatchObject(drawn);
    asked();
    // the pool shrinks: an instance past `count` is not there
    put(p, 0, P.left); put(p, 3, P.inside);
    p.count = 2;
    expect(S.draw()).toMatchObject(out);
    expect(asked()).toBe(2);
    p.count = 4;
    expect(S.draw()).toMatchObject(drawn);
    // ... also when the instance that was inside last time is the one past the new count
    p.count = 3;
    expect(S.draw()).toMatchObject(out);
    expect(asked()).toBeLessThanOrEqual(4 + 3);
    put(p, 1, P.nearGlass);
    expect(S.draw()).toMatchObject(drawn);
    p.count = 4;
    expect(S.draw()).toMatchObject(drawn);
    S.gm.dispose();
  });

  it('where an instance is: its own matrix (scale, rotation), the geometry\'s own centre, the mesh\'s and its parent\'s matrixWorld; one scaled to nothing is not there', () => {
    const S = stage(), {P, mc, put, pool} = S;
    // half a metre past the reach: the cube's own sphere does not come back in, one four times the size does
    const past = windowPoint(mc, 0.5, 0.5, mc.far + 0.5);
    expect(sphereReach(mc, past.x, past.y, past.z, RADIUS)).toBeLessThan(-0.2);
    expect(sphereReach(mc, past.x, past.y, past.z, 4 * RADIUS)).toBeGreaterThan(0.1);
    // the instance's own scale
    put(pool('scaled to nothing', [P.inside, P.left]), 0, P.inside, 0);
    put(pool('a thousandth of its size', [P.inside]), 0, P.inside, 0.001);
    pool('past the reach', [past]);
    put(pool('past the reach, four times the size', [past]), 0, past, 4);
    // its rotation and the geometry's own centre: a cube modelled 4 m off its origin, turned toward the mirrored eye / away from it
    const off = (): THREE.BufferGeometry => cube().translate(4, 0, 0);
    const toward = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), viewDirection(mc).negate());
    const away = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), viewDirection(mc));
    put(pool('origin beyond the reach, the cube turned back inside', [P.beyond], {geometry: off()}), 0, P.beyond, 1, toward);
    put(pool('origin inside, the cube turned out beyond the reach', [P.farEnd], {geometry: off()}), 0, P.farEnd, 1, away);
    // the mesh's own matrixWorld: its position, a parent's, its scale
    const shift = viewDirection(mc).multiplyScalar(100);
    const local = P.inside.clone().sub(shift);
    expect(sphereReach(mc, local.x, local.y, local.z, RADIUS)).toBeLessThan(-0.2);
    pool('moved inside by the mesh', [local]).position.copy(shift);
    pool('moved outside by the mesh', [P.inside]).position.copy(shift);
    const group = new THREE.Group();
    group.position.copy(shift);
    S.scene.add(group);
    pool('moved inside by a parent', [local], {parent: group});
    const tenfold = P.inside.clone().multiplyScalar(10);
    expect(sphereReach(mc, tenfold.x, tenfold.y, tenfold.z, RADIUS)).toBeLessThan(-0.2);
    pool('brought inside by the mesh\'s scale', [tenfold]).scale.setScalar(0.1);
    pool('past the reach, four times the size by the mesh\'s scale', [past.clone().multiplyScalar(1 / 4)]).scale.setScalar(4);
    const d = S.draw();
    expect(d.names).toEqual([
      'wall', 'a thousandth of its size', 'past the reach, four times the size', 'origin beyond the reach, the cube turned back inside',
      'moved inside by the mesh', 'moved inside by a parent', 'brought inside by the mesh\'s scale', 'past the reach, four times the size by the mesh\'s scale',
    ]);
    expect(d.pools).toBe(4);
    S.gm.dispose();
  });

  it('always drawn: a pool that asks not to be culled, a material that places its vertices in the shader (asked per material group); a pool of several materials is answered and counted once', () => {
    const S = stage(), {P, pool} = S;
    const tests = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere');
    const outs = [P.left, P.beyond, P.behindGlass];
    pool('not culled', outs).frustumCulled = false;
    pool('position node', outs, {material: moved()});
    pool('vertex node', outs, {material: shaped()});
    const m1 = [plain(), moved()], m2 = [shaped(), plain()], m3 = [plain(), plain(), plain()], m4 = [plain(), plain()];
    pool('plain + position node', outs, {material: m1, geometry: grouped(2)});
    pool('vertex node + plain', outs, {material: m2, geometry: grouped(2)});
    pool('three materials, outside', outs, {material: m3, geometry: grouped(3)});
    pool('two materials, one instance inside', [...outs, P.inside], {material: m4, geometry: grouped(2)});
    const d = S.draw();
    expect(d.names).toEqual(['wall', 'not culled', 'position node', 'vertex node', 'plain + position node', 'vertex node + plain', 'two materials, one instance inside', 'two materials, one instance inside']);
    // of a mixed pool only the group whose material moves its vertices; of a pool in view every group
    const want = [m1[1], m2[0], m4[0], m4[1]];
    d.mats.slice(4).forEach((m, i) => expect(m === want[i], `material of draw ${4 + i}`).toBe(true));
    expect(d.pools, 'the two mixed pools and the three-material one, each once').toBe(3);
    expect(tests, 'each asked pool\'s instances once, not once per material group').toHaveBeenCalledTimes(3 + 3 + 3 + 4);
    S.gm.dispose();
  });

  it('a draw the warm-up asked for (prime) leaves no pool out, once; an empty pool draws nothing in either', () => {
    const S = stage(), {P, pool} = S;
    const built = vi.spyOn(THREE.Frustum.prototype, 'setFromProjectionMatrix'), tests = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere');
    pool('inside', [P.inside]);
    pool('outside', [P.left, P.beyond]);
    pool('empty', [P.inside]).count = 0;
    const culled = {names: ['wall', 'inside'], pools: 1}, all = {names: ['wall', 'inside', 'outside'], pools: 0};
    expect(S.draw()).toMatchObject(culled);
    built.mockClear(); tests.mockClear();
    S.gm.prime();
    expect(S.draw()).toMatchObject(all);
    expect(S.gm.debug()).toMatchObject({drawn: 3, pools: 0});
    expect([built.mock.calls.length, tests.mock.calls.length], 'nothing is asked in a primed draw').toEqual([0, 0]);
    // the next draws are ordinary ones again
    expect(S.draw()).toMatchObject(culled);
    expect(S.draw()).toMatchObject(culled);
    // the warm-up's own case — no plane in view, the nearest one drawn unseen: everything as well, and once
    const turnedAway = eyeCam([0.5, 1.6, 3], [0.5, 1.6, 9]);
    expect(S.gm.render(S.r, S.scene, turnedAway)).toBe(false);
    S.gm.prime();
    expect(S.draw(turnedAway)).toMatchObject(all);
    expect(GM.plane.value.w).toBe(0);
    expect(S.gm.render(S.r, S.scene, turnedAway)).toBe(false);
    expect(S.draw()).toMatchObject(culled);
    S.gm.dispose();
  });

  it('the work of a draw: the frustum once and only when a pool asks, a pool\'s instances once, and the same scratch frustum, matrix and sphere every time (nothing allocated per pool or per draw)', () => {
    const S = stage(), {P, pool, mc} = S;
    const built = vi.spyOn(THREE.Frustum.prototype, 'setFromProjectionMatrix'), tests = vi.spyOn(THREE.Frustum.prototype, 'intersectsSphere');
    const counts = (): number[] => [built.mock.calls.length, tests.mock.calls.length];
    // no pool to ask (none at all; then an empty one, one that is not culled, one moved in the shader): no frustum is built
    S.draw();
    pool('empty', [P.inside]).count = 0;
    pool('not culled', [P.left]).frustumCulled = false;
    pool('position node', [P.left], {material: moved()});
    expect(S.draw()).toMatchObject({names: ['wall', 'not culled', 'position node'], pools: 0});
    expect(counts()).toEqual([0, 0]);
    // 50 instances in three material groups, only the last one inside; ten more in another pool, all outside
    const g3 = grouped(3), bounds = vi.spyOn(g3, 'computeBoundingSphere');
    pool('many', [...Array.from({length: 49}, (_, i) => S.outs[i % S.outs.length]), P.inside], {material: [plain(), plain(), plain()], geometry: g3});
    pool('others', Array.from({length: 10}, (_, i) => S.outs[i % S.outs.length]));
    expect(S.draw()).toMatchObject({names: ['wall', 'not culled', 'position node', 'many', 'many', 'many'], pools: 1});
    expect(counts()).toEqual([1, 50 + 10]);
    for (let i = 0; i < 5; i++) expect(S.draw()).toMatchObject({pools: 1});
    expect(counts(), 'per draw: one frustum; "many" by the instance that was inside last time, "others" all ten').toEqual([1 + 5, 60 + 5 * (1 + 10)]);
    expect(bounds, 'the geometry\'s sphere is computed once').toHaveBeenCalledTimes(1);
    // the same objects every time: one frustum, one matrix handed to it, one sphere asked
    expect(new Set(built.mock.contexts).size).toBe(1);
    expect(new Set(built.mock.calls.map(a => a[0])).size).toBe(1);
    expect(new Set(tests.mock.calls.map(a => a[0])).size).toBe(1);
    // ... and it is the mirror camera's frustum: this draw's projection x view, in the camera's own clip-space convention
    const last = built.mock.calls[built.mock.calls.length - 1];
    expect(last[0].elements).toEqual(new THREE.Matrix4().multiplyMatrices(mc.projectionMatrix, mc.matrixWorldInverse).elements);
    expect([last[1], last[2]]).toEqual([mc.coordinateSystem, mc.reversedDepth]);
    S.gm.dispose();
  });
});
