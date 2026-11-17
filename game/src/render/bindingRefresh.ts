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
//
// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, resource teardown): a NEW render object's first bind groups
// RESURRECTED a released station's texture. three r186 copies a render object's per-object bindings from its node build's template
// (NodeBuilderState.createBindings: Binding.clone), and a template's sampled texture is the node's value AT THAT BUILD — the station the
// material was first built in. Bindings._createBindings then uploads each sampled binding's `texture` (textures.updateTexture) BEFORE
// the binding reads its node (`update()` in _update): an object first drawn at a later station re-created the earlier station's light
// field / decay field on the GPU (disposed at its release: three uploads a disposed texture again) — the right texture was bound one
// step later, the old one stayed alive for the session, one more per station whose node builds were captured (measured in the real
// Game: decay-field 1 -> 2 -> 3 live after two round trips by either crossing; the lift ride's frames in the transit gap made the first
// one appear on the way up). syncNewBindings: before those first bind groups are created, every sampled binding takes its node's
// CURRENT value through three's own setter (which resets its version / generation, so the following update still rebuilds and tracks
// the group exactly as three's path does). Only groups not created yet are touched; once per render object.
import {RenderObjectRefreshType} from 'three/webgpu';

/** Epoch bumps and the refreshes they forced (QA / tests); `synced` = new render objects' sampled bindings re-pointed at the node's texture. */
export const bindingRefreshStats = {installs: 0, bumps: 0, forced: 0, synced: 0};

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
interface SampledBinding { isSampledTexture?: boolean; textureNode?: {value?: unknown} | null; texture?: unknown }
interface BindGroupLike { bindings: SampledBinding[] }
interface BindingsLike { _createBindings(groups: BindGroupLike[]): unknown; get(group: object): {bindGroup?: unknown} }

/**
 * Wrap three's Bindings._createBindings (a render object's first bind groups): each sampled binding of a group not created yet takes its
 * node's current texture first (the template's may be a released station's; see the header). False when the renderer has none.
 */
function syncNewBindings(renderer: unknown): boolean {
  const b = (renderer as {_bindings?: BindingsLike | null} | null)?._bindings;
  if (!b || typeof b._createBindings !== 'function' || typeof b.get !== 'function') return false;
  if (installed.has(b)) return true;
  installed.add(b);
  const create = b._createBindings.bind(b);
  b._createBindings = (groups: BindGroupLike[]) => {
    for (const g of groups) {
      if (b.get(g).bindGroup !== undefined) continue; // (a shared group already created: three's update path keeps it)
      for (const s of g.bindings) {
        const v = s.isSampledTexture ? s.textureNode?.value : undefined;
        if (v && s.texture !== v) { s.texture = v; bindingRefreshStats.synced++; }
      }
    }
    return create(groups);
  };
  return true;
}

/** Wrap `renderer`'s needsRefresh (after renderer.init(): three creates its node manager there). False when it has none. */
export function installBindingRefresh(renderer: unknown): boolean {
  const nodes = (renderer as {_nodes?: Nodes | null} | null)?._nodes;
  if (!nodes || typeof nodes.needsRefresh !== 'function') return false;
  syncNewBindings(renderer);
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
