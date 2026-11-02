// Task mall-lingerie-20261102-221554 — TYPED STUB written by lane CONTEXT for lane FIT's API (LANES.md "Contracts"): the same exported
// names and signatures, so the spawn context / look plumbing (ai/spawnLook.ts, game.ts) builds and is tested before lane FIT lands.
// Lane FIT's real module (the fitted sets, their bodies, the look) REPLACES this file when lane/ling-fit is merged.
//
// Until then there is no fitted set: lingerieLook returns a body without garments, which WardrobeLibrary.isValid rejects (the pale
// bodies require an upper AND a lower garment) — ai/spawnLook.ts then gives the spawn the ordinary, fully clothed wardrobe pick.
// A body is never shown without a top and a bottom garment.

import {hashString, mulberry32} from '../core/rng';
import type {ZombieLook} from './wardrobe';

/** The six lingerie designs (user reference images; Meshy T2.5 garments fitted by lane FIT). */
export type LingerieSetId = 'lingerie-green' | 'lingerie-purple' | 'lingerie-blush' | 'lingerie-black' | 'lingerie-red' | 'lingerie-ivory';

export interface LingerieSetDef {
  id: LingerieSetId;
  label: string;
  /** ZOMBIE_BODIES ids the set is fitted to (lane BODY's pale bodies). */
  bodies: readonly string[];
}

/** The fitted sets (lane FIT). Stub: none fitted yet. */
export const LINGERIE_SETS: readonly LingerieSetDef[] = [];

/** The three store-local bodies (lane BODY's ZOMBIE_BODIES ids). */
const BODIES = ['paleGaze', 'paleRevenant', 'paleApparition'] as const;

/**
 * The lingerie look of store-local spawn `spawnIndex` of the layout seeded `seed`: deterministic per (seed, index) — the same on every
 * rebuild (revisit, streaming, Retry), independent of every other stream. Stub: a body without a set (rejected by isValid).
 */
export function lingerieLook(seed: number, spawnIndex: number): ZombieLook {
  const rand = mulberry32(hashString(`lingerie-look:${spawnIndex}`, seed >>> 0));
  rand();
  return {body: BODIES[Math.floor(rand() * BODIES.length)], wear: {}};
}
