/**
 * Task studio-graphics-gpu-materials-toggle-20261114-212239-01 (JS heap): one copy of each shader text.
 *
 * three r186 keeps the generated shader text on every node-builder state (`vertexShader` / `fragmentShader`, one state per
 * material x object-kind x pass variant) and again as the key of its program maps (`Pipelines.programs.vertex / .fragment`, one
 * ProgrammableStage per DISTINCT text). The engine flattens a state's concatenated string the first time it is looked up in that
 * map, and from then on the state holds its own flat copy — even when another state already produced exactly that text.
 * Measured with the real Game (Skyways, Enhanced lighting On / Reflections High, after the load): 1150 states held 133.8 M
 * characters of shader text of which 23.1 M were distinct — about 118 MB of a 497 MB live JS heap in duplicate strings, which every
 * full garbage collection has to carry.
 *
 * shareShaderText() points each state at the program map's own string (the same text, so nothing three does with it changes: the
 * state's text is only ever read back as a key of those maps). A state is visited once (and again only while its programs do not
 * exist yet); when nothing was built since the last call it returns after three size reads. It reads three's private fields
 * defensively: anything missing or of another shape and it does nothing.
 */
interface StateLike { vertexShader?: unknown; fragmentShader?: unknown }
interface StageLike { code?: unknown }
interface RendererInternals {
  _nodes?: {nodeBuilderCache?: unknown};
  _pipelines?: {programs?: {vertex?: unknown; fragment?: unknown}};
}

export interface ShaderTextShare {
  /** Node-builder states pointed at the program maps' strings so far. */
  states: number;
  /** Characters of text those states no longer hold a copy of (an upper bound: the state a program was created from already held the map's own string). */
  chars: number;
}

const visited = new WeakMap<object, {done: WeakSet<object>; sizes: number; total: ShaderTextShare}>();

/** What shareShaderText has done for `renderer` so far (QA / tests). */
export function shaderTextShared(renderer: object): ShaderTextShare {
  const v = visited.get(renderer);
  return v ? {...v.total} : {states: 0, chars: 0};
}

/** Share the shader text of the states built since the last call (see the module comment). Returns how many states it changed. */
export function shareShaderText(renderer: object | null | undefined): number {
  const R = renderer as RendererInternals | null | undefined;
  const cache = R?._nodes?.nodeBuilderCache, vertex = R?._pipelines?.programs?.vertex, fragment = R?._pipelines?.programs?.fragment;
  if (!(cache instanceof Map) || !(vertex instanceof Map) || !(fragment instanceof Map)) return 0;
  let v = visited.get(renderer as object);
  if (!v) visited.set(renderer as object, (v = {done: new WeakSet(), sizes: -1, total: {states: 0, chars: 0}}));
  // (sizes only: a state or program that replaced a disposed one changes nothing a later build would not change again)
  const sizes = cache.size * 1048576 + vertex.size * 1024 + fragment.size;
  if (sizes === v.sizes) return 0;
  v.sizes = sizes;
  let changed = 0;
  const V = vertex as Map<string, StageLike>, F = fragment as Map<string, StageLike>;
  for (const st of cache.values() as IterableIterator<StateLike | null>) {
    if (!st || typeof st !== 'object' || v.done.has(st)) continue;
    const vs = st.vertexShader, fs = st.fragmentShader; // (a compute state has neither)
    const sv = typeof vs === 'string' ? V.get(vs) : null, sf = typeof fs === 'string' ? F.get(fs) : null;
    if ((typeof vs === 'string' && !sv) || (typeof fs === 'string' && !sf)) continue; // a program not created yet: again once the maps have grown
    if (sv && typeof vs === 'string' && sv.code === vs) { st.vertexShader = sv.code; v.total.chars += vs.length; }
    if (sf && typeof fs === 'string' && sf.code === fs) { st.fragmentShader = sf.code; v.total.chars += fs.length; }
    v.done.add(st);
    v.total.states++;
    changed++;
  }
  return changed;
}
