// Task studio-skywalk-variety-20261107-231448-01 (lane PERF, user: "looking in some directions causes lag. Report attached."): the
// SKYWAYS' see-through structure for the level culler's slab + same- / cross-storey occlusion and its window rule (world/levelCulling.ts
// SeeRect / WindowSpan). Pure.
//
// The native trace (Ambry Hill, +15 storey, turning on the spot): CPU render submission tracked the draw count (~21 us / draw over all
// passes) — facing east 840-980 draws (19-20 ms), facing the other way 300-500 (7-10 ms); GPU ~6 ms. The Skyways culler had no
// occlusion options (only the mall and the Reactor did), so every mesh of the storey in the frustum and inside the fog was submitted:
// other buildings' shops, back rooms, holders and dressing behind their walls, in the scene pass AND the flashlight's shadow pass.
// The occlusion rules treat a grid column with no free band over a storey's height range as a drawn wall (every free band's border is
// drawn by the builder). Two kinds of Skyways structure break that and are passed here as see-through rects:
//  - every GLAZED SPAN (layout.skyways.windows: bridge sides, building facades, the boarded street doors): SOLID wall cells whose
//    room-side faces are cut out (world/skywaysWindows.ts cutSkywaysWindows) — open over the span's own heights (sill .. head above its
//    storey floor) only, so a window never opens another storey or a slab plane; the same spans are the culler's WINDOW TILES (another
//    storey seen through glass);
//  - the OUTDOOR AIR: every cell outside every building footprint (streets, the lots between the buildings, the margins), solid on every
//    grid and drawn as nothing but the exterior scenery — open from the street (groundY) up: on the street and skyway storeys and across
//    the skyway slab plane, never on the underground storey or across the street surface over it. Over a BRIDGE tube the air stops at
//    its deck slab (SKYWAYS_EXT.deckDepth under the deck floor .. the floor): its glass sides and roof are see-through, its deck is not.
// Everything else that is see-through stands in open columns already (atria: the court's band rises to the roof glass; skylight wells;
// storefront glass, balustrades and doors are props / parts in free cells). Conservative by construction: a see rect only ever opens.

import {CELL} from '../gen/grid';
import type {StationLayout} from '../gen/stationTypes';
import type {SkywaysRect} from '../gen/skyways/skywaysTypes';
import type {SeeRect, WindowSpan} from './levelCulling';
import {SKYWAYS_EXT, bridgeOuter} from './skywaysExterior';

/** The glazed spans as the culler's window tiles (their storey, open heights); [] without layout.skyways. */
export function skywaysWindowSpans(layout: Pick<StationLayout, 'skyways'>): WindowSpan[] {
  return (layout.skyways?.windows ?? []).map(w => ({x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, y0: w.baseY + w.sill, y1: w.baseY + w.head, level: w.level}));
}

/** The Skyways' see-through rects (windows over their own heights, the outdoor air from the street up); [] without layout.skyways. */
export function skywaysOcclusionSee(layout: Pick<StationLayout, 'grid' | 'skyways'>): SeeRect[] {
  const info = layout.skyways;
  if (!info) return [];
  const out: SeeRect[] = skywaysWindowSpans(layout).map(({x0, z0, x1, z1, y0, y1}) => ({x0, z0, x1, z1, y0, y1}));
  // the outdoor air: per band of grid rows between building / bridge edges, the x runs outside every footprint and bridge tube
  const tubes = info.bridges.map(b => ({rect: bridgeOuter(b), deck: info.storeys.find(s => s.level === b.level)?.baseY ?? b.level}));
  const solid: SkywaysRect[] = [...info.buildings.map(b => b.rect), ...tubes.map(t => t.rect)];
  const W = layout.grid.w * CELL, H = layout.grid.h * CELL;
  const zs = [...new Set([0, H, ...solid.flatMap(r => [r.z0, r.z1])].map(z => Math.min(H, Math.max(0, z))))].sort((a, b) => a - b);
  for (let k = 0; k + 1 < zs.length; k++) {
    const z0 = zs[k], z1 = zs[k + 1];
    if (z1 - z0 < 1e-6) continue;
    const zm = (z0 + z1) / 2;
    const cover = solid.filter(r => r.z0 < zm && r.z1 > zm).map(r => [r.x0, r.x1] as const).sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const [a, b] of cover) {
      if (a > x + 1e-6) out.push({x0: x, z0, x1: Math.min(a, W), z1, y0: info.groundY});
      x = Math.max(x, b);
    }
    if (W > x + 1e-6) out.push({x0: x, z0, x1: W, z1, y0: info.groundY});
  }
  // over a bridge tube: the air under its deck slab, and everything above its deck floor (the glazed sides and roof)
  for (const t of tubes) {
    out.push({...t.rect, y0: info.groundY, y1: t.deck - SKYWAYS_EXT.deckDepth});
    out.push({...t.rect, y0: t.deck});
  }
  return out;
}
