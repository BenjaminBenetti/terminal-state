// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, resource teardown: the user asked for sound teardown).
//
// three r186's Geometries.initGeometry registers ONE 'dispose' listener per geometry, kept in a strong Map
// (Geometries._geometryDisposeListeners), and that closure captures the FIRST render object that drew the geometry (it reads the
// object's node attributes at the geometry's dispose to release them too). So until the GEOMETRY is disposed, that render object
// stays reachable after it was disposed itself (its object or material disposed, or three re-keyed it: RenderObjects.get disposes a
// render object whose cache key changed and creates a new one) — and with it its released pipeline (out of three's cache, usedTimes
// 0, never reused), the GPU shader modules of that pipeline, its bind groups and uniform buffers, its object and material. Shared /
// cached geometries live for the page, so every such render object stayed for the session. Measured in the real Game (st-00,
// Subway -> Surface Run district): 647 disposed render objects alive holding 92 released pipelines after the lift ride, 269 holding 48
// after the loading-screen route (the ride re-keys more: what it draws in the transit gap is drawn again under the destination's
// lights) — the ride's "+44 pipelines / +84 shader modules" over the loading screen.
//
// installGeometryDisposeRef: three's initGeometry is given a stand-in that holds the render object WEAKLY (its geometry and node
// attributes read through it while the render object is alive). three's own listener and bookkeeping are unchanged: the geometry's
// dispose releases its index / attributes / wireframe and, while that render object is alive, its node attributes — exactly as before.
// When the render object was collected first, its node attributes went with it (their GPU buffers are collected with them).
// No program, pipeline or node build changes: only memory that three can no longer use is let go. Both backends (a common-renderer
// module).

interface RenderObjectLike { geometry: object; getAttributes(): readonly unknown[] }
interface GeometriesLike { initGeometry(renderObject: RenderObjectLike): void; _geometryDisposeListeners?: unknown }

/** Installs and stand-ins handed to three (QA / tests). */
export const geometryDisposeRefStats = {installs: 0, weak: 0};

const installed = new WeakSet<object>();

/** A render object as three's geometry listener reads it, holding the real one weakly. */
function weakStandIn(renderObject: RenderObjectLike): RenderObjectLike {
  const ref = new WeakRef(renderObject);
  const geometry = renderObject.geometry; // (the geometry initialised: three's listener is keyed by it and keeps it anyway)
  return {
    get geometry() { return ref.deref()?.geometry ?? geometry; },
    getAttributes() { return ref.deref()?.getAttributes() ?? []; },
  };
}

/** Wrap `renderer`'s Geometries.initGeometry (after renderer.init()). Idempotent; false when the renderer has none. */
export function installGeometryDisposeRef(renderer: unknown): boolean {
  const g = (renderer as {_geometries?: GeometriesLike | null} | null)?._geometries;
  if (!g || typeof g.initGeometry !== 'function' || !(g._geometryDisposeListeners instanceof Map)) return false;
  if (installed.has(g)) return true;
  installed.add(g);
  geometryDisposeRefStats.installs++;
  const init = g.initGeometry.bind(g);
  g.initGeometry = (renderObject: RenderObjectLike) => {
    geometryDisposeRefStats.weak++;
    init(weakStandIn(renderObject));
  };
  return true;
}
