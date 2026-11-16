// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's facade style keys — the list the district generator
// chooses from (SurfaceBuilding.facade) and lane LOOK implements (world/surface/look*.ts / arch*.ts). Pure data, no three.js.
//
// One key = one facade FAMILY (materials, window rhythm, storefront treatment, roof line). LOOK may vary colour / trim per building from
// the building's id; GEN never invents a key outside this list (tests: every generated building's facade is listed here).

import type {SurfaceBuildingKind} from './surfaceTypes';

export interface SurfaceFacade {
  id: string;
  /** What LOOK should draw (short brief). */
  look: string;
  /** Building kinds GEN gives it (QA: the generator stays within these). */
  kinds: readonly SurfaceBuildingKind[];
}

export const SURFACE_FACADES = [
  {id: 'brick-retail', look: 'red / brown brick main-street block: glazed shopfronts with sign bands at street level, punched sash windows above, cornice parapet',
    kinds: ['store', 'residential', 'ruin']},
  {id: 'brick-residential', look: 'brick walk-up apartments: punched windows on every storey, fire escapes on the street face, plain parapet', kinds: ['residential', 'ruin']},
  {id: 'stucco', look: 'painted stucco / render over block: faded pastel, simple storefronts, flat roof with a low parapet', kinds: ['store', 'residential', 'centre', 'ruin']},
  {id: 'concrete-office', look: 'precast concrete office: horizontal ribbon windows, a recessed glazed lobby at street level, flat roof plant', kinds: ['office', 'civic', 'ruin']},
  {id: 'glass-office', look: 'curtain-wall glass office: mullion grid, many panes cracked / missing on damaged buildings, a glazed lobby', kinds: ['office']},
  {id: 'precast-centre', look: 'small shopping centre / strip mall: long glazed frontage under a deep canopy fascia with tenant signs, blank precast flanks', kinds: ['centre']},
  {id: 'industrial-shed', look: 'steel-framed shed / warehouse: corrugated cladding, high clerestory, large roller doors, a sawtooth or low-pitch roof', kinds: ['depot', 'industrial', 'parking', 'ruin']},
  {id: 'civic-stone', look: 'stone / dressed-block civic building: tall windows, a stepped entrance with a canopy, the institution name over the door', kinds: ['civic']},
  {id: 'transit-headhouse', look: 'subway entrance headhouse: low steel-and-glass canopy over a stair down, the line roundel / station name over the mouth', kinds: ['civic']},
  {id: 'tent-canvas', look: 'military command tent: olive canvas over a frame, a roll-up flap door, guy ropes / stakes', kinds: ['civic']},
] as const satisfies readonly SurfaceFacade[];

export type SurfaceFacadeId = typeof SURFACE_FACADES[number]['id'];
export const SURFACE_FACADE_IDS: readonly SurfaceFacadeId[] = SURFACE_FACADES.map(f => f.id);

export function isSurfaceFacade(id: string): id is SurfaceFacadeId {
  return (SURFACE_FACADE_IDS as readonly string[]).includes(id);
}
