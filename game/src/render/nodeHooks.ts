// Iteration 13 (primary contract; see reference/tasks/fog-webgpu-20261028/design.md): composable TSL node "hooks" for
// node materials — the WebGPURenderer replacement for the GLSL `addShaderHook` / onBeforeCompile injections, which node
// materials ignore. Several systems still layer onto the SAME material (surface world-mapping, 30-year decay, damage
// craters / chips, wounds, glow fog …), so each registers an ordered STAGE function; `applyNodeHooks` folds them into the
// material's node slots. Each stage receives the node produced by the previous stage (or the material's base node) and
// returns the new node. Base sampling changes (e.g. world-space UVs) belong in the material factory, not in a stage.
//
// Usage:
//   addNodeHook(mat, {key: 'decay', stage: 'color', order: 200, fn: (prev, ctx) => mix(prev, grime, amount)});
//   (call applyNodeHooks(mat) after the last add; addNodeHook does it for you)

import type {Node, NodeMaterial} from 'three/webgpu';

export type NodeStage = 'color' | 'opacity' | 'roughness' | 'metalness' | 'normal' | 'emissive' | 'ao' | 'position' | 'output';

/** Slot on a NodeMaterial that each stage writes. */
export const STAGE_SLOT: Record<NodeStage, string> = {
  color: 'colorNode', opacity: 'opacityNode', roughness: 'roughnessNode', metalness: 'metalnessNode',
  normal: 'normalNode', emissive: 'emissiveNode', ao: 'aoNode', position: 'positionNode', output: 'outputNode',
};

export interface NodeHookCtx {
  material: NodeMaterial;
  /** Previous node in the chain for this stage (the material's base node, or null when the slot had none). */
  base: Node | null;
}

export interface NodeHook {
  /** Unique per material; re-adding the same key replaces that hook in place. */
  key: string;
  stage: NodeStage;
  /** Lower runs first (base 0; surface mapping 100; decay 200; damage 300; effects 400). */
  order: number;
  fn: (prev: Node | null, ctx: NodeHookCtx) => Node | null;
}

interface HookState { base: Partial<Record<NodeStage, Node | null>>; hooks: Map<string, NodeHook> }
const states = new WeakMap<NodeMaterial, HookState>();

function stateOf(mat: NodeMaterial): HookState {
  let st = states.get(mat);
  if (!st) {
    st = {base: {}, hooks: new Map()};
    states.set(mat, st);
  }
  return st;
}

/** Register (or replace by key) a stage hook and rebuild the material's node slots. */
export function addNodeHook(mat: NodeMaterial, hook: NodeHook): void {
  const st = stateOf(mat);
  // capture the slot's base node the first time a stage is hooked (the factory's node, or null)
  if (!(hook.stage in st.base)) st.base[hook.stage] = ((mat as unknown as Record<string, Node | null>)[STAGE_SLOT[hook.stage]] ?? null);
  st.hooks.set(hook.key, hook);
  applyNodeHooks(mat);
}

export function removeNodeHook(mat: NodeMaterial, key: string): boolean {
  const st = states.get(mat);
  if (!st || !st.hooks.delete(key)) return false;
  applyNodeHooks(mat);
  return true;
}

export function hasNodeHook(mat: NodeMaterial, key: string): boolean {
  return states.get(mat)?.hooks.has(key) ?? false;
}

export function nodeHookKeys(mat: NodeMaterial): string[] {
  return [...(states.get(mat)?.hooks.values() ?? [])].sort((a, b) => a.order - b.order).map(h => h.key);
}

/** Fold every stage's hooks (by order) over its base node into the material's slots; marks the material dirty. */
export function applyNodeHooks(mat: NodeMaterial): void {
  const st = states.get(mat);
  if (!st) return;
  const byStage = new Map<NodeStage, NodeHook[]>();
  for (const h of st.hooks.values()) (byStage.get(h.stage) ?? byStage.set(h.stage, []).get(h.stage)!).push(h);
  for (const [stage, hooks] of byStage) {
    hooks.sort((a, b) => a.order - b.order);
    const base = st.base[stage] ?? null;
    let node: Node | null = base;
    for (const h of hooks) node = h.fn(node, {material: mat, base});
    (mat as unknown as Record<string, Node | null>)[STAGE_SLOT[stage]] = node;
  }
  mat.needsUpdate = true;
}

/** Copy hooks (and captured bases) to a cloned material (Material.clone() does not copy them). */
export function copyNodeHooks(src: NodeMaterial, dst: NodeMaterial): void {
  const st = states.get(src);
  if (!st) return;
  states.set(dst, {base: {...st.base}, hooks: new Map(st.hooks)});
  applyNodeHooks(dst);
}
