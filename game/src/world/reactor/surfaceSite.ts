// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): WHERE THE SURFACE IS — the bounded open-air plaza round the
// pit roof's single aperture that lane ENDING makes walkable (its sealed rim door -> the walled U-stair -> the surface storey,
// gen/reactor/reactorTypes.ts ReactorSurface). Pure (no three.js).
//
// `surfaceSiteOf(layout)` is the ONE adapter every surface reader uses (the city plan, the rain's shelter map, the eye gate, the wet
// film, the plaza parapet): lane ENDING's record `layout.reactor.surface` when present, else a PROVISIONAL site from the pit roof (the
// ground at the roof line, the aperture, the roof slab's footprint as the walk area) so the visuals build on a layout without it.
// Nothing is stored twice.

import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo, ReactorRect, ReactorSurfaceEdge} from '../../gen/reactor/reactorTypes';
import {roofOpeningOf} from '../../gen/reactor/roofOpening';

/** A roofed volume on the surface (ENDING's stair head house): no rain under `roofY` inside `rect`. */
export interface SurfaceShelter { rect: ReactorRect; roofY: number }

/** The surface as the outside visuals need it (world m, absolute y). */
export interface SurfaceSite {
  /** The surface storey's layout.levels index (null: the provisional site, no storey of its own). */
  level: number | null;
  /** The deck / outdoor ground height and the plaza parapet line (the boundary columns are solid up to it). */
  y: number;
  parapetY: number;
  /** The roof aperture (the beam rises through it): radius, ENDING's parapet ring round it and its keep-off radius. */
  hole: {x: number; z: number; r: number; ringR0: number; ringR1: number; keepR: number};
  /** The walkable outdoor cells (row-merged rects) and their bounding rect. */
  walk: readonly ReactorRect[];
  bounds: ReactorRect;
  /** The plaza's outer boundary segments (normal OUT of the deck): the parapet / rubble line. */
  edges: readonly ReactorSurfaceEdge[];
  /** Roofed volumes (no rain under them). */
  shelters: readonly SurfaceShelter[];
  /** The stair up from the rim door (its footprint and the rim / surface ends): indoors. */
  stairs: {rect: ReactorRect; y0: number; y1: number} | null;
  /** Lane ENDING's contract (true) or the provisional pit-roof site (false). */
  contract: boolean;
}

const cache = new WeakMap<object, SurfaceSite | null>();

/** The surface site of a Reactor layout (null: no Reactor, or a closed roof — no aperture, no surface). Memoised per record. */
export function surfaceSiteOf(layout: Pick<StationLayout, 'reactor'>): SurfaceSite | null {
  const info = layout.reactor;
  if (!info) return null;
  const hit = cache.get(info);
  // (a record that gained ENDING's `surface` after a first read is re-derived)
  if (hit !== undefined && (hit === null || hit.contract || !info.surface)) return hit;
  const site = siteOf(info);
  cache.set(info, site);
  return site;
}

/** The rect's four boundary edges (normals out): the provisional plaza's parapet line. */
const rectEdges = (b: ReactorRect): ReactorSurfaceEdge[] => [
  {x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z0, nx: 0, nz: -1}, {x0: b.x0, z0: b.z1, x1: b.x1, z1: b.z1, nx: 0, nz: 1},
  {x0: b.x0, z0: b.z0, x1: b.x0, z1: b.z1, nx: -1, nz: 0}, {x0: b.x1, z0: b.z0, x1: b.x1, z1: b.z1, nx: 1, nz: 0},
];

function siteOf(info: ReactorInfo): SurfaceSite | null {
  const s = info.surface;
  if (s) {
    const h = s.hole;
    return {
      level: s.level, y: s.y, parapetY: s.parapetY,
      hole: {x: h.x, z: h.z, r: h.r, ringR0: h.parapet.r0, ringR1: h.parapet.r1, keepR: h.keepR},
      walk: s.walk.length ? s.walk : [s.bounds], bounds: s.bounds, edges: s.edges.length ? s.edges : rectEdges(s.bounds),
      shelters: [{rect: s.head.rect, roofY: s.head.top}],
      stairs: {rect: s.stairs.rect, y0: s.stairs.bottom.y, y1: s.stairs.top.y}, contract: true,
    };
  }
  const o = roofOpeningOf(info);
  if (!o) return null;
  // PROVISIONAL: the roof slab over the pit outline is the walkable surface (no ENDING record on this layout)
  const b = info.pit.bounds, y = info.pit.roofY;
  return {
    level: null, y, parapetY: y + 1.1, hole: {x: o.x, z: o.z, r: o.r, ringR0: o.r, ringR1: o.r + 0.45, keepR: o.r + 0.6},
    walk: [{...b}], bounds: {...b}, edges: rectEdges(b), shelters: [], stairs: null, contract: false,
  };
}

/** The eye gate tunables (m). */
export const SURFACE_GATE = {
  /** The eye counts as outside within this margin round the plaza bounds, from this far below the deck up. */
  pad: 2, below: 0.6,
  /** In the exit stair the surface shows from this far below the deck (the exit's opening comes into view on the top flight). */
  stairsBelow: 7,
} as const;

const inRect = (r: ReactorRect, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;

/**
 * THE EYE GATE: may the surface (city, outdoor sky, near rain) be seen from `eye`? True on / over the plaza and on the top of the exit
 * stair; false everywhere in the pit and its rock rooms (the whole surface group is then invisible: 0 draws, no traversal).
 */
export function surfaceEyeOutside(site: SurfaceSite, eye: {x: number; y: number; z: number}): boolean {
  if (eye.y >= site.y - SURFACE_GATE.below && inRect(site.bounds, eye.x, eye.z, SURFACE_GATE.pad)) return true;
  const s = site.stairs;
  return !!s && eye.y >= site.y - SURFACE_GATE.stairsBelow && eye.y <= s.y1 + 4 && inRect(s.rect, eye.x, eye.z, 0.5);
}

/** In the open air (outside, not in the stair below the deck, not under a shelter): the rain bed's / the outdoor weight. */
export function surfaceEyeOpen(site: SurfaceSite, eye: {x: number; y: number; z: number}): boolean {
  if (eye.y < site.y - SURFACE_GATE.below || !surfaceEyeOutside(site, eye)) return false;
  return !site.shelters.some(s => inRect(s.rect, eye.x, eye.z) && eye.y < s.roofY);
}
