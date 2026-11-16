// Task studio-rt-flashlight-compute-20261115-233136-01: the TRACED flashlight bounce as lit materials read it (the RT variant of the
// full field light only: world/lightFieldNode.ts LightFieldLight.rt; WebGPU only — the WebGL 2 fallback never builds it).
//
// render/rt/ computes, each frame before the scene pass, the bounce irradiance E at a low-resolution grid of RECEIVERS — the
// surfaces the main camera sees through each grid cell, found by tracing the camera's rays through the station's geometry — and
// writes two textures (render/rt/rtKernels.ts, `compose`):
//   RTB.E  rgba16float: rgb = E (linear, the light field's convention: a Lambert surface shows albedo x E / pi), a = the receiver's
//          plane offset dot(n, p - eye) (m);
//   RTB.N  rgba8unorm:  rgb = the receiver's unit normal x 0.5 + 0.5, a = its class (1 a traced mesh, 0.5 a proxy such as a
//          character's capsule, 0 none: sky / nothing within reach).
// A fragment projects its world position with the MAIN camera's view-projection of that frame (RTB.viewProj — not the camera of the
// pass drawing it: the glass mirror's fragments look up the main view too), takes the 2 x 2 receivers round that point and keeps a
// receiver only when the fragment lies on its plane (within RTB.grid.z + RTB.grid.w x the distance from the eye; a proxy's own wider
// tolerance) and faces its way; the kept ones are blended by their bilinear weights. No receiver kept (a surface no grid cell sees:
// thinner than a cell, behind another one, off screen, inside the mirror's view only) = no traced bounce there.
// Gated: RTB.cam.w = 0 (flashlight off, nothing bound, the RT path not running) skips everything; the sum is then exactly zero.
// Only plain render-group uniforms and two sampled textures (no sampler: texel loads), no uniform buffer of its own.

import * as THREE from 'three';
import {StorageTexture, type Node} from 'three/webgpu';
import * as TSL from 'three/tsl';
import {fetchTexel, plainTexture} from '../render/textureFetch';

// three's per-kind TSL typings reject most mixed chains (as in render/volumetricShaders.ts)
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;
const {Fn, If, abs, clamp, dot, float, floor, ivec2, length, max, renderGroup, select, smoothstep, texture, uniform, vec2, vec3, vec4} = TSL as unknown as Record<string, N>;

/** A 1 x 1 stand-in of the format the runtime's textures have (zero: nothing is read before the runtime binds its own). */
function placeholder(type: THREE.TextureDataType, name: string): StorageTexture {
  const t = new StorageTexture(1, 1);
  t.type = type;
  t.format = THREE.RGBAFormat;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.name = name;
  return t;
}

/** The format of RTB.E / RTB.N (render/rt/rtGpu.ts makes its textures with these). */
export const RT_E_TYPE = THREE.HalfFloatType;
export const RT_N_TYPE = THREE.UnsignedByteType;
export const rtTexture = (w: number, h: number, kind: 'E' | 'N'): StorageTexture => {
  const t = placeholder(kind === 'E' ? RT_E_TYPE : RT_N_TYPE, kind === 'E' ? 'rt-bounce-E' : 'rt-bounce-N');
  const image = t.image as {width: number; height: number};
  image.width = w;
  image.height = h;
  return t;
};

/** Receiver plane tolerance: a fragment within RT_TOLERANCE.base + RT_TOLERANCE.perMetre x its distance from the eye lies on it. */
export const RT_TOLERANCE = {base: 0.04, perMetre: 0.012, proxy: 0.35} as const;

/**
 * The global nodes (render-group uniforms + the two texture nodes the runtime points at its own textures, refreshing bindings).
 * viewProj: the main camera's projection x view of this frame; cam: xyz the eye, w the gate (1 = a traced bounce is bound);
 * grid: x / y the receiver grid's size, z / w the plane tolerance (RT_TOLERANCE.base / perMetre).
 */
export const RTB = {
  // (task studio-cpu-submit-parallelism-20261116-205022-01: plain base nodes, looked up through fetchTexel — render/textureFetch.ts)
  E: plainTexture(texture(placeholder(RT_E_TYPE, 'rt-bounce-E'))),
  N: plainTexture(texture(placeholder(RT_N_TYPE, 'rt-bounce-N'))),
  viewProj: uniform(new THREE.Matrix4()).setGroup(renderGroup).setName('rtViewProj'),
  cam: uniform(new THREE.Vector4(0, 0, 0, 0)).setGroup(renderGroup).setName('rtCam'),
  grid: uniform(new THREE.Vector4(1, 1, RT_TOLERANCE.base, RT_TOLERANCE.perMetre)).setGroup(renderGroup).setName('rtGrid'),
};

const lookup = Fn(([p, nrm]: [N, N]) => {
  const out = n(vec3(0, 0, 0)).toVar();
  If(n(RTB.cam).w.greaterThan(0.5), () => {
    const clip = n(RTB.viewProj).mul(vec4(p, 1));
    If(n(clip).w.greaterThan(1e-4), () => {
      const ndc = n(clip).xy.div(n(clip).w);
      const size = n(RTB.grid).xy;
      // (row 0 is the top of the view: the receivers' grid is laid out like the screen)
      const g = n(vec2(n(ndc).x.mul(0.5).add(0.5), n(ndc).y.mul(-0.5).add(0.5))).mul(size).sub(0.5);
      const i0 = floor(g), f = n(g).sub(i0);
      const rel = n(p).sub(n(RTB.cam).xyz);
      const tol = n(RTB.grid).z.add(n(RTB.grid).w.mul(length(rel)));
      const hi = ivec2(n(size).sub(1));
      const sum = n(vec4(0, 0, 0, 0)).toVar();
      for (let k = 0; k < 4; k++) {
        const dx = k & 1, dy = k >> 1;
        const c = n(clamp(n(ivec2(i0)).add(ivec2(dx, dy)), ivec2(0, 0), hi));
        // (no uv-transform matrix per lookup: an identity mat3 uniform + an object-level update each — render/textureFetch.ts)
        const e = n(fetchTexel(RTB.E, c)), nn = n(fetchTexel(RTB.N, c));
        const nt = n(nn.xyz).mul(2).sub(1), cls = nn.w;
        const proxy = n(cls).lessThan(0.75);
        const plane = abs(n(dot(nt, rel)).sub(e.w));
        const ok = n(plane).lessThanEqual(select(proxy, max(tol, float(RT_TOLERANCE.proxy)), tol)).and(n(cls).greaterThan(0.25));
        const facing = select(proxy, smoothstep(-0.3, 0.4, dot(nt, nrm)), smoothstep(0.35, 0.8, dot(nt, nrm)));
        const wb = n(dx ? f.x : float(1).sub(f.x)).mul(dy ? f.y : float(1).sub(f.y));
        const w = n(select(ok, n(wb).mul(facing), float(0)));
        sum.addAssign(vec4(n(e.xyz).mul(w), w));
      }
      If(n(sum).w.greaterThan(1e-4), () => { out.assign(n(sum).xyz.div(n(sum).w)); });
    });
  });
  return out;
});

/**
 * The traced bounce's irradiance at world point `p` on a surface with unit world normal `normal` (vec3, the light field's
 * convention), for the lighting context's irradiance — in place of world/flashBounce.ts flashBounceIrradiance. Zero while the gate
 * is off.
 */
export function rtBounceIrradiance(p: Node, normal: Node): Node {
  return n(lookup(p, normal));
}
