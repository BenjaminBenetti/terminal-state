// Task studio-reactor-surface-ending-20261102-213051-01 (lane SURFACE): WHERE THE SURFACE IS — the bounded outdoor area round the pit
// roof's single aperture that lane ENDING makes walkable (its sealed rim door -> the stairs -> the surface storey). Pure (no three.js).
//
// `surfaceSiteOf(layout)` is the ONE adapter every surface reader uses (the city plan, the rain's shelter map, the eye gate, the wet
// film): lane ENDING's record `layout.reactor.surface` when present, else a PROVISIONAL site from the pit roof — the ground at the
// roof line (pit.roofY), the aperture (gen/reactor/roofOpening.ts roofOpeningOf) and the roof slab's footprint (pit.bounds) as the walk
// area. Nothing is stored twice.

import type {StationLayout} from '../../gen/stationTypes';
import type {ReactorInfo, ReactorRect} from '../../gen/reactor/reactorTypes';
import {roofOpeningOf} from '../../gen/reactor/roofOpening';

/** A roofed volume on the surface (the stair head-house): no rain under `roofY` inside `rect`. */
export interface SurfaceShelter { rect: ReactorRect; roofY: number }

/** The surface as the outside visuals need it (world m, absolute y). */
export interface SurfaceSite {
  /** The surface storey's layout.levels index (null: not a level of its own — the provisional site). */
  level: number | null;
  /** The outdoor ground / walk height. */
  y: number;
  /** The roof aperture (a disc in the ground plane; the beam rises through it). */
  hole: {x: number; z: number; r: number};
  /** The walkable outdoor area (one or more rects) and its bounding rect. */
  walk: readonly ReactorRect[];
  bounds: ReactorRect;
  /** Roofed volumes (no rain under them). */
  shelters: readonly SurfaceShelter[];
  /** The stairs up from the rim door (their box: the eye on them may see out through the exit). */
  stairs: {rect: ReactorRect; y0: number; y1: number} | null;
  /** Lane ENDING's contract (true) or the provisional pit-roof site (false). */
  contract: boolean;
}

/**
 * Lane ENDING's record (the shape the lead relayed: `layout.reactor.surface = {level, y, bounds, walkRect(s), hole, door, stairs}`),
 * read defensively: any field may be absent or named slightly differently while the contract lands.
 */
interface EndingSurfaceLike {
  level?: number; y?: number; baseY?: number;
  bounds?: ReactorRect;
  walk?: readonly ReactorRect[]; walkRects?: readonly ReactorRect[]; walkRect?: ReactorRect;
  hole?: {x: number; z: number; r: number};
  stairs?: {rect?: ReactorRect; bounds?: ReactorRect; y0?: number; y1?: number; bottomY?: number; topY?: number};
  shelters?: readonly SurfaceShelter[];
  headHouse?: {rect: ReactorRect; roofY: number};
}

const okRect = (r: ReactorRect | undefined): r is ReactorRect => !!r && [r.x0, r.z0, r.x1, r.z1].every(Number.isFinite) && r.x1 > r.x0 && r.z1 > r.z0;
const union = (list: readonly ReactorRect[]): ReactorRect => ({
  x0: Math.min(...list.map(r => r.x0)), z0: Math.min(...list.map(r => r.z0)), x1: Math.max(...list.map(r => r.x1)), z1: Math.max(...list.map(r => r.z1)),
});

const cache = new WeakMap<object, SurfaceSite | null>();

/** The surface site of a Reactor layout (null: no Reactor, or a closed roof — no aperture, no surface). Memoised per reactor record. */
export function surfaceSiteOf(layout: Pick<StationLayout, 'reactor'>): SurfaceSite | null {
  const info = layout.reactor;
  if (!info) return null;
  const hit = cache.get(info);
  // (a record that gained ENDING's `surface` after a first read is re-derived)
  if (hit !== undefined && (hit === null || hit.contract || !(info as {surface?: unknown}).surface)) return hit;
  const site = siteOf(info);
  cache.set(info, site);
  return site;
}

function siteOf(info: ReactorInfo): SurfaceSite | null {
  const o = roofOpeningOf(info);
  const e = (info as {surface?: EndingSurfaceLike}).surface;
  if (e) {
    const walk = [...(e.walk ?? e.walkRects ?? (e.walkRect ? [e.walkRect] : []))].filter(okRect);
    const bounds = okRect(e.bounds) ? e.bounds : walk.length ? union(walk) : null;
    const hole = e.hole && [e.hole.x, e.hole.z, e.hole.r].every(Number.isFinite) ? e.hole : o;
    const y = Number.isFinite(e.y) ? e.y! : Number.isFinite(e.baseY) ? e.baseY! : info.pit.roofY;
    if (bounds && hole) {
      const st = e.stairs, sr = st?.rect ?? st?.bounds;
      const shelters = [...(e.shelters ?? []), ...(e.headHouse ? [e.headHouse] : [])].filter(s => okRect(s.rect) && Number.isFinite(s.roofY));
      return {
        level: Number.isInteger(e.level) ? e.level! : null, y, hole: {x: hole.x, z: hole.z, r: hole.r}, walk: walk.length ? walk : [bounds], bounds, shelters,
        stairs: okRect(sr) ? {rect: sr, y0: st!.y0 ?? st!.bottomY ?? info.pit.rimY, y1: st!.y1 ?? st!.topY ?? y} : null, contract: true,
      };
    }
  }
  if (!o) return null;
  // PROVISIONAL: the roof slab over the pit outline is the walkable surface (until lane ENDING's record lands)
  const b = info.pit.bounds;
  return {level: null, y: info.pit.roofY, hole: {x: o.x, z: o.z, r: o.r}, walk: [{...b}], bounds: {...b}, shelters: [], stairs: null, contract: false};
}

/** The surface tunables (m). */
export const SURFACE_GATE = {
  /** The eye counts as outside within this margin round the surface bounds, from this far below the ground up. */
  pad: 2, below: 0.6,
  /** On the exit stairs the surface shows from this far below the ground (the exit's opening is in view near the top). */
  stairsBelow: 7,
} as const;

/**
 * THE EYE GATE: may the surface (city, outdoor sky, rain field) be seen from `eye`? True on / over the surface area and on the upper
 * exit stairs; false everywhere in the pit and its rock rooms (the whole surface group is then invisible: 0 draws, no traversal).
 */
export function surfaceEyeOutside(site: SurfaceSite, eye: {x: number; y: number; z: number}): boolean {
  const b = site.bounds, P = SURFACE_GATE.pad;
  if (eye.y >= site.y - SURFACE_GATE.below && eye.x >= b.x0 - P && eye.x <= b.x1 + P && eye.z >= b.z0 - P && eye.z <= b.z1 + P) return true;
  const s = site.stairs;
  if (s && eye.y >= site.y - SURFACE_GATE.stairsBelow && eye.y <= s.y1 + 3 && eye.x >= s.rect.x0 - 0.5 && eye.x <= s.rect.x1 + 0.5 && eye.z >= s.rect.z0 - 0.5 && eye.z <= s.rect.z1 + 0.5) return true;
  return false;
}

/** Fully in the open (not on the stairs below the ground, not under a shelter): the rain bed / outdoor sky weight. */
export function surfaceEyeOpen(site: SurfaceSite, eye: {x: number; y: number; z: number}): boolean {
  if (eye.y < site.y - SURFACE_GATE.below || !surfaceEyeOutside(site, eye)) return false;
  return !site.shelters.some(s => eye.x >= s.rect.x0 && eye.x <= s.rect.x1 && eye.z >= s.rect.z0 && eye.z <= s.rect.z1 && eye.y < s.roofY);
}
