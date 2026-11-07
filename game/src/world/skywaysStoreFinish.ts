// Task studio-alpha-skyways-shops-20261107-054512-01 (primary): THE SKYWAYS MAJOR STORES' OWN FINISHES — each anchor shop's sales floor /
// upper floor / zones take its store's wall / floor / ceiling (gen/skyways/stores/<family>.ts `finish`: wood panelling in the bookshop,
// …) instead of the default storefront tile. Render-only (no save state behind a wall), so every layout version gets it. Built with
// the Office architecture's materials (world/officeArch.ts: one program per surface kind, the Codex office textures, the decay hook):
// one material per (store, role) key, registered in SkywaysArch like its other finishes; never a global WallMaterial mutation.

import type {Area, StationLayout} from '../gen/stationTypes';
import type {SkywaysShopFamily} from '../gen/skyways/skywaysTypes';
import {SKYWAYS_STORES} from '../gen/skyways/stores/index';
import type {StoreCeilKind, StoreFloorKind, StoreWall} from '../gen/skyways/stores/types';
import {LOWER, type WallSpec} from './officeArch';

/** The role of an anchor area inside its store. */
export type StoreRole = 'floor' | 'upper' | 'zones';

export interface StoreAreaFinish {
  family: SkywaysShopFamily;
  role: StoreRole;
  wall: StoreWall;
  floor: readonly [StoreFloorKind, number | undefined];
  ceil: readonly [StoreCeilKind, number | undefined];
}

/** A store wall as the Office wall material's spec. */
export function storeWallSpec(w: StoreWall): WallSpec {
  return {paint: w.paint, lower: w.lower, trim: w.trim, kind: LOWER[w.kind], lowerTop: w.lowerTop, skirt: w.skirt, rail: w.rail, peel: w.peel, panel: w.panel};
}

/** The impact class of a store wall (a full-height wood / stone / tile / concrete finish is that; else the plaster above a dado). */
export function storeWallClass(w: StoreWall): 'wood' | 'terrazzo' | 'tile' | 'concrete' | 'plaster' {
  if (w.lowerTop < 3.5) return 'plaster';
  return w.kind === 'wood' ? 'wood' : w.kind === 'stone' ? 'terrazzo' : w.kind === 'tile' ? 'tile' : w.kind === 'concrete' ? 'concrete' : 'plaster';
}

/**
 * Per area id: the store finish of every anchor area of a layout (the sales floor and its pieces round a two-level shop's stair well,
 * the upper floor and its pieces, the zones). The back rooms keep the back-of-house finish.
 */
export function storeAreaFinishes(layout: Pick<StationLayout, 'areas' | 'skyways'>): Map<number, StoreAreaFinish> {
  const out = new Map<number, StoreAreaFinish>();
  for (const an of layout.skyways?.anchors ?? []) {
    const spec = SKYWAYS_STORES[an.family];
    if (!spec) continue;
    const f = spec.finish;
    const put = (id: number, role: StoreRole) => {
      const v = role === 'upper' ? f.upper : role === 'zones' ? f.zones : undefined;
      out.set(id, {family: an.family, role, wall: v?.wall ?? f.wall, floor: v?.floor ?? f.floor, ceil: v?.ceil ?? f.ceil});
    };
    const zones = new Set(an.zones);
    put(an.floor, 'floor');
    if (an.upper !== undefined) put(an.upper, 'upper');
    for (const z of an.zones) put(z, 'zones');
    const isPiece = (a: Area, parent: number) => a.parent === parent && a.type === 'shop' && !zones.has(a.id);
    for (const a of layout.areas) {
      if (isPiece(a, an.floor)) put(a.id, 'floor');
      else if (an.upper !== undefined && isPiece(a, an.upper)) put(a.id, 'upper');
    }
  }
  return out;
}
