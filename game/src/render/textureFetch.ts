/**
 * Task studio-graphics-gpu-materials-toggle-20261114-212239-01 (steady-state CPU): lookups of DATA textures without three's
 * uv-transform uniform.
 *
 * three r186 `TextureNode.clone()` builds the clone from the node's CURRENT uv node (`new TextureNode(value, this.uvNode, …)`, and the
 * constructor then sets `updateMatrix = uvNode === null`). The game's global texture nodes are uv-less base nodes whose `.value` is
 * swapped per station (`texture(placeholder)`), so every single `.load(uv)` / `.sample(uv)` of one is a clone with `updateMatrix`
 * left TRUE. Each such clone gets
 *  - its own mat3 uniform of `texture.matrix` in the drawing object's uniform buffer,
 *  - a mat3 x vec3 in front of the fetch in the shader, and
 *  - an OBJECT-level update: `texture.updateMatrix()` (a cos / sin and nine writes) once per clone, per render object, per pass,
 *    every frame — and the base node, built as the clones' reference, is one more. (WebGPU. On the WebGL2 fallback a lookup keeps
 *    an object-level update for three's flip-Y uniform either way; the mat3 and its multiply go there too.)
 * Measured with the real Game (Skyways, Enhanced lighting On / Reflections High): 48 probe-table fetches per reflecting world
 * material, about 27 such update nodes per drawn object on average — the largest part of what Enhanced lighting added to the
 * per-object refresh work of a frame. (A chain like `.sample(uv).level(0)` is not affected: its second clone already has a uv node.)
 *
 * These textures (probe table, decay field / detail, light-occlusion windows) never have an offset, repeat, rotation or centre:
 * their matrix is the identity, so the result is the same texel with or without it. A texture that IS transformed (a material map
 * with a repeat) must keep three's default and never go through these helpers.
 */
interface FetchNode {
  load(uv: unknown): FetchNode;
  sample(uv: unknown): FetchNode;
  /** (three's 3D / cube texture nodes ignore it and return nothing: never chain on the result) */
  setUpdateMatrix(value: boolean): unknown;
}

/** `base` itself without the uv-transform matrix (a uv-less global base node: it is built as the reference of every lookup of it). */
export function plainTexture<T>(base: T): T {
  (base as unknown as FetchNode).setUpdateMatrix(false);
  return base;
}

/** `base.load(texel)` (integer texel coordinates, no sampler) without the uv-transform matrix. */
export function fetchTexel<T>(base: T, texel: unknown): T {
  const t = (base as unknown as FetchNode).load(texel);
  t.setUpdateMatrix(false);
  return t as unknown as T;
}

/** `base.sample(uv)` without the uv-transform matrix. */
export function sampleAt<T>(base: T, uv: unknown): T {
  const t = (base as unknown as FetchNode).sample(uv);
  t.setUpdateMatrix(false);
  return t as unknown as T;
}
