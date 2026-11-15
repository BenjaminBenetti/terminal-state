// Task baked-gi-visual-uplift-20261115-004324 (lane MIRROR): the live glass mirror (render/glassMirror.ts) without a GPU —
//  - the pane-space camera against EXPLICIT reflection geometry (the law of reflection, both axes, both sides, both clip-space
//    conventions): the texel a glass fragment reads from its world position is the one the mirror camera drew the reflected
//    point into; upright, not flipped; nothing behind the glass;
//  - the drawn window: world-anchored texel grid, the caps, the pad; clipping a pane to the main camera's frustum;
//  - the shader: the GENERATED GLSL of glassMirrorSample run on the CPU equals the CPU mapping; one sampled texture and no
//    uniform buffer more on glass under the mirror light, nothing at all without it;
//  - selection: the plane in view, hysteresis, the fade of a change, shot-out panes, the distance cap, line of sight;
//  - the draw: the scene pass's signature and call depth, glass left out (no feedback), renderer state and shadow flags restored
//    — also when the draw throws — and no material or light flag touched.
// The proof on the real Game (builds / pipelines / render contexts / shadow draws) is tests/glass-mirror-game.test.ts.
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GLSLNodeBuilder, MeshStandardNodeMaterial, NodeMaterial, QuadMesh, WGSLNodeBuilder, WebGPURenderer} from 'three/webgpu';
import {Fn, cameraPosition, uniform} from 'three/tsl';
import {
  GLASS_MIRROR, GLASS_MIRROR_CAPS, GLASS_MIRROR_TUNING, GM, GlassMirror, PaneCamera, clipPane, glassMirrorSample, isGlassMirrorPlaceholder, mirrorAlpha, mirrorCameraPose,
  mirrorFace, mirrorUv, mirrorWindow, type MirrorFace, type MirrorRenderer, type MirrorScenePass, type MirrorWindow, type PaneView,
} from '../src/render/glassMirror';
import {GlassPane, type GlassPlane} from '../src/world/glassPanes';
import type {PropPlacement} from '../src/gen/props';
import {tagReflect} from '../src/render/reflectTag';
import {bindingRefreshStats} from '../src/render/bindingRefresh';
import {installLightFieldNode} from '../src/world/lightFieldNode';
import {installReflectNode, stationReflectLight} from '../src/world/reflectionNode';
import {rendererFor} from './helpers/fogCompile';
import {BUILTINS, mainBody, runFlow, type Env, type Val} from './helpers/glslEval';

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
  readonly draws: {target: THREE.RenderTarget | null; mrt: unknown; viewport: number[]; camera: THREE.Camera; autoClear: boolean[]; toneMapping: THREE.ToneMapping; outputColorSpace: string; flags: boolean[]; drawn: THREE.Object3D[]; layers: number; transparent: boolean; opaque: boolean}[] = [];
  private current: THREE.Object3D[] = [];
  lights: THREE.SpotLight[] = [];
  getRenderTarget() { return this.target; }
  setRenderTarget(t: THREE.RenderTarget | null) { this.target = t; }
  getMRT() { return this.mrt; }
  setMRT(m: unknown) { this.mrt = m; return this; }
  getRenderObjectFunction() { return this.fn; }
  setRenderObjectFunction(f: unknown) { this.fn = f; }
  getDrawingBufferSize(v: THREE.Vector2) { return v.copy(this.size); }
  renderObject(...a: unknown[]) { this.current.push(a[0] as THREE.Object3D); }
  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.current = [];
    // three: every renderable through the render-object function (or renderObject itself)
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const f = (this.fn ?? this.renderObject.bind(this)) as (...a: unknown[]) => void;
      f.call(this, mesh, scene, camera, mesh.geometry, mesh.material, null, null, null, null);
    });
    this.draws.push({
      target: this.target, mrt: this.mrt, viewport: this.target ? this.target.viewport.toArray() : [], camera, autoClear: [this.autoClear, this.autoClearColor, this.autoClearDepth, this.autoClearStencil],
      toneMapping: this.toneMapping, outputColorSpace: this.outputColorSpace, flags: this.lights.flatMap(l => [l.shadow.autoUpdate, l.shadow.needsUpdate]), drawn: this.current,
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
