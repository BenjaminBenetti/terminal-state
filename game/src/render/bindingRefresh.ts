// Task studio-death-retry-render-fix-20261114-044607-01 (the user's Chrome / WebGPU report: only after dying and loading the last save the
// station is obscured while the HUD and the held weapon stay clear; resizing the window restores it, but at some angles the world stops
// turning while the fog moves): shared texture NODES whose texture is swapped at run time.
//
// three r186 re-reads a render object's per-object bind group (its sampled textures among them) only on a FULL refresh. Its
// NodeMaterialObserver.needsRefresh answers SHARED / NONE for an object whose transform, material, geometry, lights and pass size did not
// change, and the object keeps drawing with the GPU bind group it was built with. A texture node shared by many materials whose .value is
// swapped — the station light field (world/lightFieldNode.ts LF.tex, bound per station) — therefore never reaches the render objects that
// outlive the swap unchanged. In the game those are the parked car's persistent parts (the fuel cap, the equipment plugs) when the SAME
// station is rebuilt with the car at the same pose: Load last save after a death, or Pause > Main menu > Continue in one session (a fresh
// page builds new render objects; a different station moves the car). Once the previous station's field is released (after the new
// station's warm-up), their bind group names a DESTROYED texture, and WebGPU rejects the whole command buffer of the station's scene pass
// on every frame that draws one of them: the scene target keeps an old frame while the fog, the composite and the held weapon follow the
// camera (the obscured view; the angles where the world seems not to turn). A window resize changes the pass's buffer size, which is part
// of three's equality check, so every render object refreshed once — why a resize helped.
//
// refreshTextureBindings() — called by every swap of a shared texture node (lightFieldNode, decay, exterior, flareLight) — starts a new
// epoch, and the renderer's needsRefresh (wrapped once by installBindingRefresh) gives each render object ONE full refresh at its next
// draw after it: three's own update path re-reads the node's current texture and builds the bind group with it, before the draw. No
// program or pipeline is rebuilt, uniform writes go through the usual path (render/uploadDedupe.ts skips the unchanged ones), and an
// object drawn later (culled meanwhile) is refreshed when it is next drawn. Both backends (the wrapper is the renderer's, not WebGPU's).
import {RenderObjectRefreshType} from 'three/webgpu';

/** Epoch bumps and the refreshes they forced (QA / tests). */
export const bindingRefreshStats = {installs: 0, bumps: 0, forced: 0};

let epoch = 0;

/** A shared texture node's texture was swapped: every render object re-reads its texture bindings at its next draw (once). */
export function refreshTextureBindings(): void {
  epoch++;
  bindingRefreshStats.bumps++;
}

/** The epoch each render object last refreshed in (a property on three's RenderObject: one compare per draw). */
const EPOCH = Symbol('textureBindingEpoch');
const installed = new WeakSet<object>();

interface Nodes { needsRefresh(renderObject: object): number }

/** Wrap `renderer`'s needsRefresh (after renderer.init(): three creates its node manager there). False when it has none. */
export function installBindingRefresh(renderer: unknown): boolean {
  const nodes = (renderer as {_nodes?: Nodes | null} | null)?._nodes;
  if (!nodes || typeof nodes.needsRefresh !== 'function') return false;
  if (installed.has(nodes)) return true;
  installed.add(nodes);
  bindingRefreshStats.installs++;
  const needsRefresh = nodes.needsRefresh.bind(nodes);
  nodes.needsRefresh = (renderObject: object) => {
    const type = needsRefresh(renderObject); // (always asked: the observer keeps its own state in sync)
    const ro = renderObject as {[EPOCH]?: number};
    if (ro[EPOCH] === epoch) return type;
    ro[EPOCH] = epoch;
    if (type === RenderObjectRefreshType.FULL) return type;
    bindingRefreshStats.forced++;
    return RenderObjectRefreshType.FULL;
  };
  return true;
}
