// Iteration 06 (Lane F): chained material shader hooks.
//
// three.js materials have ONE `onBeforeCompile` callback and ONE `customProgramCacheKey`. Several
// systems patch the same materials (iteration-04 world-space texturing, iteration-05 tube glow fog,
// iteration-06 zombie wounds / damage chips / wardrobe), so assigning `material.onBeforeCompile = ...`
// directly silently drops whatever was installed before. Every lane uses `addShaderHook` instead:
//
//   addShaderHook(material, 'damage-chips', shader => { shader.fragmentShader = ... });
//
// - hooks run in registration order, AFTER any hook that was assigned directly before the first
//   addShaderHook call (that one is kept and called first);
// - re-adding the same key replaces that hook in place (idempotent installs, no double patching);
// - the program cache key is extended with every hook key, so materials with different hook sets
//   never share a compiled program (and materials with the same set do);
// - if something later overwrites `onBeforeCompile` directly, the next addShaderHook call adopts the
//   foreign hook as the new base, so registered hooks are never lost;
// - Material.clone()/copy() do not copy callbacks: use cloneWithShaderHooks / copyShaderHooks.
//
// The iteration-05 global light-field patch (world/lightField.ts) edits THREE.ShaderChunk once at
// startup, which every program picks up before any onBeforeCompile hook runs, so it composes with
// these hooks by construction.

import * as THREE from 'three';

export type ShaderHook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

interface HookState {
  /** Hook that was on the material before the helper took over (called first). */
  base: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;
  /** Cache key contribution of the base hook / pre-existing customProgramCacheKey. */
  baseKey: (this: THREE.Material) => string;
  hooks: Map<string, ShaderHook>;
  /** The wrapper we installed (to detect later direct overwrites). */
  wrapper: THREE.Material['onBeforeCompile'];
  keyFn: THREE.Material['customProgramCacheKey'];
}

const states = new WeakMap<THREE.Material, HookState>();
const DEFAULT_HOOK = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_KEY = THREE.Material.prototype.customProgramCacheKey;

function install(material: THREE.Material, carry?: Map<string, ShaderHook>): HookState {
  const base = material.onBeforeCompile;
  const ownKey = material.customProgramCacheKey;
  // three's default key is onBeforeCompile.toString(): once we wrap, that would be the wrapper's
  // source for every material, so capture the ORIGINAL hook's source instead.
  const baseKey: HookState['baseKey'] = ownKey !== DEFAULT_KEY ? ownKey : base === DEFAULT_HOOK ? () => '' : () => base.toString();
  const st: HookState = {base, baseKey, hooks: new Map(carry ?? []), wrapper: DEFAULT_HOOK, keyFn: DEFAULT_KEY};
  st.wrapper = function (this: THREE.Material, shader, renderer) {
    if (st.base !== DEFAULT_HOOK) st.base.call(material, shader, renderer);
    for (const fn of st.hooks.values()) fn.call(material, shader, renderer);
  };
  st.keyFn = function (this: THREE.Material) {
    return `${st.baseKey.call(material)}|hooks:${[...st.hooks.keys()].join(',')}`;
  };
  material.onBeforeCompile = st.wrapper;
  material.customProgramCacheKey = st.keyFn;
  states.set(material, st);
  return st;
}

function stateOf(material: THREE.Material): HookState {
  const st = states.get(material);
  if (st && material.onBeforeCompile === st.wrapper && material.customProgramCacheKey === st.keyFn) return st;
  // First hook, or someone replaced our wrapper/key directly: adopt what is there now as the base.
  return install(material, st?.hooks);
}

/**
 * Chain `fn` onto `material`'s onBeforeCompile under `key` (replacing an earlier hook with the same
 * key) and extend its program cache key. Marks the material for recompilation.
 */
export function addShaderHook(material: THREE.Material, key: string, fn: ShaderHook): void {
  if (!key || /[|,]/.test(key)) throw new Error(`addShaderHook: invalid key "${key}"`);
  const st = stateOf(material);
  st.hooks.set(key, fn);
  material.needsUpdate = true;
}

/** Remove a hook by key (no-op if absent). */
export function removeShaderHook(material: THREE.Material, key: string): boolean {
  const st = states.get(material);
  if (!st || !st.hooks.delete(key)) return false;
  material.needsUpdate = true;
  return true;
}

export function hasShaderHook(material: THREE.Material, key: string): boolean {
  return states.get(material)?.hooks.has(key) ?? false;
}

/** Registered hook keys in run order (excluding a pre-existing direct hook). */
export function shaderHookKeys(material: THREE.Material): string[] {
  return [...(states.get(material)?.hooks.keys() ?? [])];
}

/** Re-apply `src`'s base hook/key and registered hooks to `dst` (three's copy()/clone() drop callbacks). */
export function copyShaderHooks(src: THREE.Material, dst: THREE.Material): void {
  const st = states.get(src);
  if (!st) {
    if (src.onBeforeCompile !== DEFAULT_HOOK) dst.onBeforeCompile = src.onBeforeCompile;
    if (src.customProgramCacheKey !== DEFAULT_KEY) dst.customProgramCacheKey = src.customProgramCacheKey;
    dst.needsUpdate = true;
    return;
  }
  dst.onBeforeCompile = st.base;
  states.delete(dst);
  const d = install(dst);
  // Same base hook as the source, so the same base key.
  d.baseKey = st.baseKey;
  for (const [k, fn] of st.hooks) d.hooks.set(k, fn);
  dst.needsUpdate = true;
}

/** material.clone() that keeps every chained shader hook. */
export function cloneWithShaderHooks<M extends THREE.Material>(material: M): M {
  const c = material.clone() as M;
  copyShaderHooks(material, c);
  return c;
}
