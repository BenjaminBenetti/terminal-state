// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY, user: "better performance, especially stuttering"): the shelf
// filler's MOVING sets, prepared before the warm-up.
//
// A filler piece that starts moving leaves its chunk's merged rest mesh and is drawn by a small InstancedMesh per (family, archetype,
// label) while it moves (world/shelfStock.ts). The modelled props' sets are made at build; the AUTHORED filler's are made by the
// first piece of each (archetype, label) that moves — and a set that is too small is replaced by a bigger one. three r186 gives every
// InstancedMesh its own node build (the object's uuid is part of its cache key) and, off the attribute-instancing levels, its own
// programs and pipeline: so the first shot into a shelf built one variant per archetype it knocked loose, in that frame. First-use
// census after a complete 'full' warm-up (Node, three's real WebGPURenderer on a no-op device; one piece of every set knocked loose):
// Subway 67 builds + 67 pipelines, Skyways 123 + 123, Mall 81 builds (shared programs there), Office 7, Market 13, Bunker 10,
// Reactor 19.
//
// prepareStockMovingSets makes every set of the station exist — hidden, empty, sized for ALL pieces of its (family, archetype, label),
// so it never has to grow — through the stock's own per-frame entry (ShelfStock.frame, the FillerView the physics drives): the real
// factory, material, instance colours and flags. Game.refreshRuntimeVariants calls it before a warm-up / the journey's preparation
// plans the scene ('full' mode only: on a software rasterizer every program lands in system RAM, so 'view' keeps them on demand), and
// the sets are a registered warm-up pool (stockMovingSets). Nothing of the pieces, their bodies or the rest meshes changes; a set
// made here keeps the shadow flags a set made on first use has (the station marked its casters before).
import * as THREE from 'three';
import type {FillerPiece} from '../physics/fillerStock';

/** The part of world/shelfStock.ts ShelfStock this needs (its public surface). */
export interface StockMovingHost {
  readonly group: THREE.Object3D;
  readonly filler: {readonly pieces: readonly FillerPiece[]; moving(): FillerPiece[]};
  /** FillerView.frame: draws exactly `moving` with the moving sets (creating / growing them), hides every other set. */
  frame(moving: readonly FillerPiece[]): void;
}

/** The stock's moving sets right now: its only instanced meshes (the rest meshes are merged, non-instanced chunks). */
export function stockMovingSets(stock: {readonly group: THREE.Object3D}): THREE.InstancedMesh[] {
  return stock.group.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh === true);
}

/**
 * Make the moving set of every (family, archetype, label) present, at the capacity of all its pieces, then show exactly what is moving
 * right now again (nothing, before play). Returns the number of sets. Idempotent.
 */
export function prepareStockMovingSets(stock: StockMovingHost): number {
  const pieces = stock.filler.pieces;
  if (!pieces.length) return stockMovingSets(stock).length;
  stock.frame(pieces);
  stock.frame(stock.filler.moving());
  return stockMovingSets(stock).length;
}
