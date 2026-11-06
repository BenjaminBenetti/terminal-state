// Task static-batching-warmup-20261105 (user: "group static meshes in to single draw calls, across all levels … programatically"):
// how a level's REPEATED STATIC geometry is grouped into draw calls — one rule shared by every builder that batches it (world/builder.ts
// model props via chunkInstances — p7 props, Office furniture, storefront fittings —, world/openables.ts + world/containers.ts holder
// bodies / closed parts, world/storefrontBuilder.ts merged purpose-prop parts), on every level (Subway, Office, Mall, Reactor and
// their annexes).
//
// Census (tests/rendercpu-batch-census.test.ts, the real worlds, the busiest start-pose view): the architecture is already one mesh
// per material per 48 m chunk (builder accumulators) — merging plain meshes further within a chunk would save 1-2 draws on three
// levels — but every model prop / holder kind was one InstancedMesh per model part per 12-18 m chunk: the Subway's busiest view drew
// 159 prop + 103 holder batches (of 414 scene draws; 45 + 15 more in the torch shadow pass), e.g. the ceiling fixture model 29 times.
// A spatial chunk only pays for itself where its instances are expensive to draw: cheap repeated geometry (fixtures, benches, signs'
// parts, bins, small kit) costs a draw per chunk per part for a handful of triangles each. So:
//  - COHORTS ARE PER LEVEL, always (the level / slab / storey culling unit of world/levelCulling.ts — a batch never spans storeys). The
//    Subway / Office holders and purpose fixtures were not split per storey: on the Office's stacked storeys that alone cut the mean
//    draws of 48 views by 22 % and their triangles by 24 % (a batch was drawn whenever any storey it spanned was);
//  - a CHEAP model (its instances on that level total <= STATIC_COHORTS.levelTriangles, all parts) takes STATIC_COHORTS.coarseM (48 m,
//    the architecture's chunk) cohorts instead of the builder's 12-18 m chunks — on levels whose culler does NOT occlusion-cull per box
//    (`coarse`: no atrium / slab occlusion: the Subway, the Office). Where it does (the Mall's atrium, the Reactor's pit), fine boxes are
//    what the slab / storey occlusion removes draws with: coarser cohorts measured +6 % mean draws there, so they keep their chunks;
//  - heavier models keep their builder's chunks everywhere (fine frustum culling where the triangles are).
// Measured (48 views per level: the start pose + 5 enemy spawns x 8 yaws, scene + torch shadow draws after the culler; mean / p90 /
// max): Subway 304 / 497 / 539 -> 292 / 452 / 492, Office 195 / 319 / 366 -> 147 / 229 / 278; Mall / Reactor unchanged. A whole-level
// cohort (one per level) was worse on three levels: its box intersects nearly every view and the torch shadow cone.
// Identity is unchanged: the same instances, matrices, colours and materials in fewer InstancedMesh / merged meshes; damage finds a
// prop's instance / triangles by its position / box (damage/propDamage.ts RenderIndex), holders keep one slot per closed part.

import type * as THREE from 'three';

export const STATIC_COHORTS = {
  /** A model whose instances on one level total at most this many triangles (all parts) is CHEAP: it takes coarse cohorts. */
  levelTriangles: 20_000,
  /** The cohort of a cheap model: this many metres (the architecture's chunk, world/levelGeometry.ts CHUNK_M); Infinity = the whole level. */
  coarseM: 48,
};

/** Triangles one draw of `geo` submits. */
export function trianglesOf(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
}

/**
 * Group `items` into cohorts, per level (`at(item).level`): with `coarse`, a cheap model (`count x trisPerItem <= budget` on that
 * level) in STATIC_COHORTS.coarseM-metre cohorts (the whole level when Infinity); otherwise / heavier: `chunkM`-metre chunks. Keys:
 * `<level>:*` (whole level), `<level>:c<cx>,<cz>` (coarse), `<level>:<cx>,<cz>` (chunk). Insertion order is the items' order.
 */
export function planCohorts<T>(items: readonly T[], at: (item: T) => {x: number; z: number; level: number}, chunkM: number, trisPerItem: number,
  coarse: boolean, budget = STATIC_COHORTS.levelTriangles): Map<string, {level: number; whole: boolean; list: T[]}> {
  const perLevel = new Map<number, number>();
  for (const it of items) { const l = at(it).level; perLevel.set(l, (perLevel.get(l) ?? 0) + 1); }
  const out = new Map<string, {level: number; whole: boolean; list: T[]}>();
  for (const it of items) {
    const p = at(it);
    const cheap = coarse && (perLevel.get(p.level) ?? 0) * trisPerItem <= budget, c = STATIC_COHORTS.coarseM;
    const whole = cheap && !Number.isFinite(c);
    const key = whole ? `${p.level}:*` : cheap ? `${p.level}:c${Math.floor(p.x / c)},${Math.floor(p.z / c)}` : `${p.level}:${Math.floor(p.x / chunkM)},${Math.floor(p.z / chunkM)}`;
    let e = out.get(key);
    if (!e) out.set(key, (e = {level: p.level, whole, list: []}));
    e.list.push(it);
  }
  return out;
}
