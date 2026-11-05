// Task runtime-variant-warmup-20261105 (user, after the native Office recapture: "Warm up anything you can basically! many of the
// stutters are warm up stutters"): the RUNTIME-VARIANT PROTOTYPE POOL — hidden meshes built by the game's real runtime factories for
// render variants that only appear through normal play, so the loading-screen warm-up (render/warmup.ts, a registered pool) and the
// train journey's paced preparation (render/journeyCompile.ts, the same planner) compile them before their first real use.
//
// Measured in the recapture (Chrome / WebGPU, GAME69): aiming at a server rack TOOK IT OVER (world/openables.ts: a closed, idle holder
// is drawn instanced; aimed at / opened / damaged it gets its own NON-instanced meshes) and built 6 node variants in 66.8 ms, then a
// ~100 ms GPU-side stall; shooting props built `damaged-*` shadow variants and a lab bench's own-mesh variant; a torn Blightbelly
// chunk built `chunk:BlightbellyBodyMaterial`. three r186 keys a node build / pipeline by the material's VALUES (not its identity;
// textures only by mapping + sampler), the geometry attribute layout, instancing (an InstancedMesh by its own uuid), the bone count,
// receiveShadow, the lights / fog / environment and the render context — so a hidden prototype with the real factory's material
// values, geometry layout and shadow flags, in the station scene, makes the later real mesh a cache hit (scene AND shadow pass:
// casters among the prototypes get the warm-up's shadow frames / the journey's shadow lane).
//
// Families (each built by its subsystem's pure prototype method — nothing of the holder / prop / actor / loot / physics / RNG state
// is touched; see the callers in game.ts refreshRuntimeVariants):
//  - takeover   world/openables.ts OpenableSet.takeoverPrototypes: every attached kind's own meshes (moving parts, plates / trays,
//               interiors; the accent role material; the own-mesh shadow flags rule);
//  - highlight  world/containers.ts: the aim highlight clone (the SAME cached clone gameplay uses) on aimable meshes;
//  - damaged    damage/propDamage.ts PropDamage.variantPrototypes: the damage-hooked node material on detached shared instances
//               (non-instanced), merged-chunk extracts (non-indexed) and holders' own meshes, with the source's shadow flags;
//  - flesh      physics/chunks.ts PhysChunks.fleshPrototypes: chunkMaterial per distinct enemy layer-material signature on the
//               patch / flap geometry layout (position, normal, uv, colour; non-indexed).
// The pool keeps one prototype per variant key (variantKey: a structural mirror of three's key, for de-duplication only; a caster
// whose material has a map / colour / mask / cast node keeps its material INSTANCE in the key: ownShadowNodes), stays
// HIDDEN under the station scene for the world's lifetime (three's caches are reference-counted: a removed / disposed prototype
// would let a build be freed before its first real use) and is cleared with the world; geometries / materials the pool itself
// created are released through the caller's retire queue (after the next warm-up, like every other station release).

import * as THREE from 'three';
import type {NodeMaterial} from 'three/webgpu';
import {copyNodeHooks} from './nodeHooks';
import {geometryKey} from './warmup';

/** One family of prototypes as a subsystem built them. */
export interface VariantFamily {
  name: 'takeover' | 'highlight' | 'damaged' | 'flesh' | string;
  meshes: readonly THREE.Mesh[];
}

/** What the pool releases when cleared (only what the prototype builders created for it — never shared runtime resources). */
export interface VariantOwned {
  geometries?: readonly THREE.BufferGeometry[];
  materials?: readonly THREE.Material[];
}

const SKIP = /^(is[A-Z]|_)|^(visible|version|uuid|name|opacity|userData)$/;
const protoKeys = new Map<unknown, string[]>();

/** Own keys + prototype getters, as three r186's RenderObject getKeys. */
function keysOf(obj: object): string[] {
  const keys = Object.keys(obj);
  let pk = protoKeys.get(obj.constructor);
  if (!pk) {
    pk = [];
    for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptors(p);
      for (const k in d) if (typeof d[k].get === 'function') pk.push(k);
    }
    protoKeys.set(obj.constructor, pk);
  }
  for (const k of pk) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/**
 * The material part of three r186's render-object cache key, structurally (RenderObject.getMaterialCacheKey: customProgramCacheKey,
 * every property but identity fields; numbers on / off except `side`; a texture by its mapping + sampler; other objects as present).
 * For DE-DUPLICATING prototypes only: a difference it misses costs one more (cache-hit) compile, never a wrong render.
 */
export function materialKey(m: THREE.Material): string {
  let k = `${m.type}|`;
  try { k += (m as {customProgramCacheKey?: () => string}).customProgramCacheKey?.() ?? ''; } catch { k += m.uuid; }
  for (const p of keysOf(m)) {
    if (SKIP.test(p)) continue;
    const v = (m as unknown as Record<string, unknown>)[p];
    if (typeof v === 'function') continue;
    if (v === null || v === undefined) k += `${String(v)},`;
    else if (typeof v === 'number') k += p === 'side' ? `${v},` : v !== 0 ? '1,' : '0,';
    else if (typeof v === 'object') {
      const t = v as THREE.Texture;
      k += t.isTexture ? `{${t.mapping}${t.magFilter}${t.minFilter}${t.wrapS}${t.wrapT}${(t as {wrapR?: number}).wrapR ?? ''}},` : '{},';
    } else k += `${String(v)},`;
  }
  return k;
}

/** One prototype per distinct draw variant: object kind, material key(s), geometry layout, bones, shadow flags. */
export function variantKey(o: THREE.Mesh): string {
  const mats = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];
  const kind = (o as THREE.SkinnedMesh).isSkinnedMesh ? 'skin' : (o as THREE.InstancedMesh).isInstancedMesh ? `inst:${o.uuid}` : 'mesh';
  const bones = (o as THREE.SkinnedMesh).skeleton?.bones.length ?? 0;
  const key = (m: THREE.Material) => materialKey(m) + (o.castShadow && ownShadowNodes(m) ? `#${m.uuid}` : '');
  return `${kind}|${mats.map(key).join('+')}|${geometryKey(o.geometry)}|${bones}|${o.receiveShadow ? 1 : 0}|${o.castShadow ? 1 : 0}`;
}

/**
 * True when three r186 builds the shadow-pass variant of a caster PER MATERIAL INSTANCE: Renderer._getShadowNodes makes the shadow
 * override's colour / mask / cast nodes from the caster material's own map / colorNode / castShadowNode / mask nodes (reference(...,
 * material) nodes, cached per material), so two value-equal materials with a map draw the same scene variant but two shadow
 * variants (probed: a value-equal clone with a map built its own shadow program; one without a map shared it).
 */
export function ownShadowNodes(m: THREE.Material): boolean {
  const n = m as THREE.Material & {map?: THREE.Texture | null; colorNode?: unknown; castShadowNode?: unknown; maskNode?: unknown; maskShadowNode?: unknown};
  return !!(n.map as THREE.Texture | null | undefined)?.isTexture || !!n.colorNode || !!n.castShadowNode || !!n.maskNode || !!n.maskShadowNode;
}

/**
 * True when three r186 draws `m` in two passes — a transparent DoubleSide material that is not forceSinglePass: renderObject /
 * _renderTransparents set `side` to BackSide, then FrontSide, for the draws. compileAsync only QUEUES the work and builds it after
 * the side was restored, so it builds the DoubleSide variant, which those draws never use (probed: a hidden glass prototype compiled
 * at side 2, the first real draw built sides 1 and 0). The pool adds side proxies for such prototypes (RuntimeVariantPool.rebuild).
 */
export function drawsDoublePass(m: THREE.Material): boolean {
  return m.transparent === true && m.side === THREE.DoubleSide && m.forceSinglePass === false;
}

/** A copy of `m` drawn like the real material in one of its double-pass draws (node hooks + alphaTest kept: NodeMaterial.copy drops it). */
function sideCopy(m: THREE.Material, side: THREE.Side): THREE.Material {
  const c = m.clone();
  c.alphaTest = m.alphaTest;
  if ((m as unknown as NodeMaterial).isNodeMaterial) copyNodeHooks(m as unknown as NodeMaterial, c as unknown as NodeMaterial);
  c.side = side;
  return c;
}

export interface VariantPoolStats {
  /** Per family: prototypes offered / kept after de-duplication. */
  families: Record<string, {offered: number; kept: number}>;
  /** Prototypes in the pool now (side proxies included); casters among them (shadow-pass variants). */
  prototypes: number;
  casters: number;
  /** Side proxies added for double-pass prototypes (drawsDoublePass); copies whose key did not match the real draw (dropped). */
  sideProxies: number;
  sideMismatch: number;
  /** Main-thread ms of the last rebuild (building + de-duplicating; the compile is the warm-up's). */
  ms: number;
  /** Rebuilds / clears so far (QA). */
  rebuilds: number;
}

export class RuntimeVariantPool {
  /** The hidden pool root (in the station scene; register it as a warm-up pool). Never shown. */
  readonly root = new THREE.Group();
  stats: VariantPoolStats = {families: {}, prototypes: 0, casters: 0, sideProxies: 0, sideMismatch: 0, ms: 0, rebuilds: 0};
  private owned: {geometries: Set<THREE.BufferGeometry>; materials: Set<THREE.Material>} = {geometries: new Set(), materials: new Set()};

  constructor() {
    this.root.name = 'runtime-variants';
    this.root.visible = false;
    this.root.matrixAutoUpdate = false;
  }

  /** Replace the prototypes (the previous ones are cleared first; their owned resources go to `retire`). */
  rebuild(families: readonly VariantFamily[], owned: VariantOwned = {}, retire?: (fn: () => void) => void, now: () => number = () => performance.now()): VariantPoolStats {
    const t0 = now();
    this.clear(retire);
    const seen = new Set<string>();
    const stats: VariantPoolStats = {families: {}, prototypes: 0, casters: 0, sideProxies: 0, sideMismatch: 0, ms: 0, rebuilds: this.stats.rebuilds + 1};
    for (const f of families) {
      const s = (stats.families[f.name] ??= {offered: 0, kept: 0});
      for (const m of f.meshes) {
        s.offered++;
        const key = variantKey(m);
        if (seen.has(key)) continue;
        seen.add(key);
        m.name = `runtime-variant:${f.name}:${m.name || 'mesh'}`;
        m.matrixAutoUpdate = false;
        m.updateMatrixWorld(true);
        this.root.add(m);
        s.kept++;
        stats.prototypes++;
        if (m.castShadow) stats.casters++;
        // a double-pass material: its BackSide / FrontSide draws as one-pass copies (the scene-pass variants three's two draws key;
        // value-equal keys share the build). The prototype itself stays: real draws (the hidden frames, the shadow pass) use it.
        const mat = m.material as THREE.Material;
        if (Array.isArray(m.material) || !drawsDoublePass(mat)) continue;
        for (const side of [THREE.BackSide, THREE.FrontSide] as const) {
          const c = sideCopy(mat, side);
          mat.side = side;
          const want = materialKey(mat);
          mat.side = THREE.DoubleSide;
          if (materialKey(c) !== want) { c.dispose(); stats.sideMismatch++; continue; }
          const proxy = new THREE.Mesh(m.geometry, c);
          proxy.receiveShadow = m.receiveShadow; // (not a caster: the shadow pass draws the prototype's own variant)
          const pk = variantKey(proxy);
          if (seen.has(pk)) { c.dispose(); continue; }
          seen.add(pk);
          proxy.name = `${m.name}:${side === THREE.BackSide ? 'back' : 'front'}Side`;
          proxy.matrixAutoUpdate = false;
          this.root.add(proxy);
          this.owned.materials.add(c);
          stats.prototypes++;
          stats.sideProxies++;
        }
      }
    }
    for (const g of owned.geometries ?? []) this.owned.geometries.add(g);
    for (const m of owned.materials ?? []) this.owned.materials.add(m);
    this.root.updateMatrixWorld(true);
    stats.ms = now() - t0;
    this.stats = stats;
    return stats;
  }

  /** Remove every prototype; release what the pool owns (deferred through `retire`, else now). */
  clear(retire?: (fn: () => void) => void): void {
    for (const c of [...this.root.children]) this.root.remove(c);
    const geos = [...this.owned.geometries], mats = [...this.owned.materials];
    this.owned = {geometries: new Set(), materials: new Set()};
    const release = () => { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); };
    if (geos.length || mats.length) { if (retire) retire(release); else release(); }
    this.stats = {families: {}, prototypes: 0, casters: 0, sideProxies: 0, sideMismatch: 0, ms: 0, rebuilds: this.stats.rebuilds};
  }
}
