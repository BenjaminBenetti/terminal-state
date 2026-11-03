// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU): per-frame CPU in the flashlight's shadow pass.
//
// three r186 draws a shadow map with ONE shared override material per light (ShadowBaseNode's shadow material: scene.overrideMaterial)
// and, per caster, copies the caster's alphaTest onto it (Renderer.renderObject: `overrideMaterial.alphaTest = material.alphaTest`).
// Material's alphaTest setter bumps `version` whenever the value crosses 0. With alpha-tested casters (the mall's wall-detail cavity
// decals, banners, ad cut-outs; the Reactor's cut-out atlases) interleaved with opaque ones in the depth-sorted list, the shared
// material's version changes several times per frame, so EVERY caster's shadow render object finds `version !== material.version`
// and rebuilds its full material cache key (RenderObject.getCacheKey: a string over ~100 material properties + a hash) — on every
// frame, for every caster in the torch cone. Node census on the real mall (t3a, the real three WebGPU path on a no-op device):
// 70-260 key rebuilds per frame, ~6-8 ms of a ~25 ms Node frame; the keys come out equal (nothing is rebuilt), it is pure overhead.
//
// The fix: casters with alphaTest > 0 are drawn with a TWIN of the light's shadow material (a clone made once, alphaTest > 0 forever),
// the rest with the original (alphaTest 0 forever): neither ever crosses 0, so no render object re-keys. Exact: three applies the same
// per-caster properties (shadow colour / depth / position nodes, side, alphaTest value, alpha map, transparency, displacement) to
// whichever override it draws with, and each render object's key — hence its node build and shader — is the one it had before
// (tests/rendercpu-shadow-override.test.ts: identical shadow shaders per caster, the same casters per frame, 0 key rebuilds).
// Installed on the game's renderer (WebGPU and WebGL 2 share three's Renderer.renderObject); without that method it does nothing.

import type * as THREE from 'three';

type ShadowMat = THREE.Material & {isShadowPassMaterial?: boolean; fog?: boolean};
type RenderObjectFn = (object: THREE.Object3D, scene: THREE.Scene, camera: THREE.Camera, geometry: unknown, material: THREE.Material & {allowOverride?: boolean}, ...rest: unknown[]) => unknown;

const twins = new WeakMap<ShadowMat, ShadowMat>();
const installed = new WeakSet<object>();

/** Counters (QA / tests): casters drawn with a twin, twins made. */
export const shadowTwinStats = {draws: 0, twins: 0};

function twinOf(o: ShadowMat): ShadowMat {
  let t = twins.get(o);
  if (!t) {
    t = o.clone() as ShadowMat;
    // (fields three's shadow-material factory sets after construction, which copy() may not carry)
    t.isShadowPassMaterial = true;
    t.name = o.name;
    t.blending = o.blending;
    if (o.fog !== undefined) t.fog = o.fog;
    twins.set(o, t);
    shadowTwinStats.twins++;
  }
  return t;
}

/** The twin of a light's shadow material, if one was made (tests). */
export const shadowTwin = (o: THREE.Material): THREE.Material | undefined => twins.get(o as ShadowMat);

/**
 * Wrap `renderer.renderObject` so alpha-tested casters draw the shadow pass with the twin override (see above). Idempotent; returns
 * whether it is (now) installed.
 */
export function installShadowAlphaTwin(renderer: unknown): boolean {
  const r = renderer as {renderObject?: RenderObjectFn} | null;
  if (!r || typeof r.renderObject !== 'function') return false;
  if (installed.has(r)) return true;
  const inner = r.renderObject;
  r.renderObject = function (this: unknown, object, scene, camera, geometry, material, ...rest) {
    const o = scene?.overrideMaterial as ShadowMat | null | undefined;
    if (o && o.isShadowPassMaterial === true && material && material.allowOverride === true && material.alphaTest > 0) {
      scene.overrideMaterial = twinOf(o);
      shadowTwinStats.draws++;
      try { return inner.call(this, object, scene, camera, geometry, material, ...rest); } finally { scene.overrideMaterial = o; }
    }
    return inner.call(this, object, scene, camera, geometry, material, ...rest);
  };
  installed.add(r);
  return true;
}
