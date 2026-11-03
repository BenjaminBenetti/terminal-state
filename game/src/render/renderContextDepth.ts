// Task studio-performance-recorder-20261103-043629 (lane RENDER-CPU, user: "stuttering on new visuals is defiantly worse now,
// especially turning the camera around in the mall causes the spike. CPU spike for sure."): the warm-up compiled the station into a
// render context the real frame never draws with.
//
// three r186 keys a RenderContext by (render target attachments, MRT, CALL DEPTH): `RenderContexts.get(target, mrt, callDepth)`, and
// a render object's material cache key — hence its node build and its render-object identity — includes that context's id. A
// top-level `renderer.render()` runs at call depth 0; a render issued while another one is running (a PassNode drawing its scene
// inside a RenderPipeline's quad render) runs at depth 1. `renderer.compileAsync()` always asks for depth 0. The game draws the
// station through the atmosphere's RenderPipeline (render/volumetric.ts: `pass(scene, camera)` inside `pipeline.render()`), i.e. at
// depth 1, so render/warmup.ts compiled every representative into the depth-0 context of the right target: node builds the real
// frame never looked up. Only what the warm-up drew through REAL hidden frames (the flashlight-shadow casters) and the final view
// frame was warm; every other group and every pooled effect built its node graph on first sight in play (Node census on the real
// mall, tests/rendercpu-warmup-context.test.ts; a three-only probe shows the same: 4 builds at compile, 5 again on the first frame).
//
// The fix keeps three's async compile and only gives it the right context:
//  - renderContextDepth(): the call depth at which a render target is drawn, recorded during one real frame (no guessing three's or
//    the pipeline's nesting);
//  - compileAtDepth(): runs a compileAsync call (its context is taken synchronously at the call) with that depth.
// Both wrap `renderer._renderContexts.get` (three r186's RenderContexts, an internal) for the duration of one synchronous call and
// restore it in `finally`; with no such internal (another three version) they do nothing and report null / run the call as is.

interface ContextsLike { get(target: unknown, mrt?: unknown, callDepth?: number): unknown }
type RendererLike = {_renderContexts?: ContextsLike};

function contexts(renderer: unknown): ContextsLike | null {
  const rc = (renderer as RendererLike | null)?._renderContexts;
  return rc && typeof rc.get === 'function' ? rc : null;
}

/** The call depth at which `target` is first drawn during `frame()` (null: not drawn, or no three RenderContexts to observe). */
export function renderContextDepth(renderer: unknown, target: unknown, frame: () => void): number | null {
  const rc = contexts(renderer);
  if (!rc || target === null || target === undefined) { frame(); return null; }
  const get = rc.get;
  let depth: number | null = null;
  rc.get = function (this: ContextsLike, t: unknown, mrt: unknown = null, d = 0) {
    if (depth === null && t === target && d >= 0) depth = d; // (-1: three's clear-only context)
    return get.call(this, t, mrt, d);
  };
  try { frame(); } finally { rc.get = get; }
  return depth;
}

/**
 * Run `call` (a synchronous call that takes its render context synchronously, e.g. `renderer.compileAsync(...)`, which returns its
 * promise after projecting the scene) so that contexts requested at depth 0 are the depth-`depth` ones. depth 0 / no internal: as is.
 */
export function compileAtDepth<T>(renderer: unknown, depth: number, call: () => T): T {
  const rc = depth > 0 ? contexts(renderer) : null;
  if (!rc) return call();
  const get = rc.get;
  rc.get = function (this: ContextsLike, t: unknown, mrt: unknown = null, d = 0) { return get.call(this, t, mrt, d === 0 ? depth : d); };
  try { return call(); } finally { rc.get = get; }
}

/**
 * Task studio-performance-recorder-20261103 (lane RENDER-CPU, journey follow-up): run `call` (a synchronous `renderer.render`) as if it
 * were nested `offset` levels deep: every context it asks for (the scene pass, and the flashlight's shadow pass nested in it) is the
 * one the real frame uses at that nesting. The clear-only context (-1) is left alone. offset 0 / no internal: as is.
 */
export function renderAtDepthOffset<T>(renderer: unknown, offset: number, call: () => T): T {
  const rc = offset > 0 ? contexts(renderer) : null;
  if (!rc) return call();
  const get = rc.get;
  rc.get = function (this: ContextsLike, t: unknown, mrt: unknown = null, d = 0) { return get.call(this, t, mrt, d >= 0 ? d + offset : d); };
  try { return call(); } finally { rc.get = get; }
}
