// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): THE DISTRICT'S SURROUNDINGS — what stands beyond the cordon (the
// playable boundary GEN places: a SOLID ring round `surface.extent`), so the edge reads CLOSED and the city goes on into the murk:
//  - BERMS: rubble mounds heaped against the outside of the cordon wall (the Office kit's rubble pile, scaled up; their crests show
//    over the wall's coping); where a street runs into the cordon the wall itself is a steel-plate barricade (arch.ts);
//  - COLLAPSED BLOCKS just beyond: low ruins sunk into their own rubble (the Reactor's ruined-city kit + the Office ruins);
//  - THE FAR CITY: tall ruined towers / apartments fading into the fog (fewer, bigger silhouettes: no LODs exist).
// Reuses only delivered, approved models (world/reactor/surfaceKit.ts SURFACE_KIT entries: Meshy maps kept; no new art). PURE (no
// three.js): placements + a triangle budget; the runtime (look.ts) instances them per sector. Deterministic from the district seed.

import type {SRect, SurfaceInfo} from '../../gen/surface/surfaceTypes';
import {mulberry32} from '../../core/rng';
import {SURFACE_KIT, type SurfaceKitEntry} from '../reactor/surfaceKit';

export type FarBand = 'berm' | 'collapsed' | 'far';

export interface FarPlacement {
  /** SURFACE_KIT entry id and its lazy-library key. */
  entry: string; key: string;
  x: number; y: number; z: number; yaw: number; s: number;
  band: FarBand;
  /** Sector round the district centre (instancing / frustum culling). */
  sector: number;
}

export interface FarCityPlan {
  extent: SRect;
  centre: {x: number; z: number};
  placements: FarPlacement[];
  /** The ground ring's outer radius (m from the centre). */
  groundR: number;
  tris: number;
  stats: Record<string, number>;
}

/** Bands (m outside the extent), spacing, triangle budgets. */
export const FAR_CITY = {
  sectors: 8,
  // berms: the step is the closest spacing; each cordon side gets a quarter of the budget and spreads it evenly (a
  // long side gets wider gaps, never a bare side); piles scaled to show above the 3.4 m cordon wall
  berm: {from: 1.5, to: 9, step: 12, scale: [2.6, 3.6] as const, sink: 0.22, tris: 480_000},
  collapsed: {from: 18, to: 62, cell: 30, fill: 0.55, sinkMin: 0.12, sinkMax: 0.4, tris: 380_000},
  far: {from: 64, to: 230, cell: 52, fill: 0.34, tris: 420_000},
  /** The ground ring reaches past the fog's cull distance. */
  groundR: 360,
} as const;

const BERM_IDS = ['rubblePile'];
const COLLAPSED_IDS = ['cityStorefronts', 'cityGarage', 'cityApartment', 'ruinedMidrise'];
const FAR_IDS = ['cityHighrise', 'ruinedTower', 'cityApartment', 'ruinedMidrise'];

/** Every lazy-library key the surroundings may use (game.ts sectionModelKeys). */
export const FAR_CITY_KEYS: readonly string[] = [...new Set([...BERM_IDS, ...COLLAPSED_IDS, ...FAR_IDS].map(id => SURFACE_KIT.find(e => e.id === id)?.key).filter((k): k is string => !!k))];

export const sectorOf = (cx: number, cz: number, x: number, z: number, n: number = FAR_CITY.sectors): number => {
  const a = Math.atan2(z - cz, x - cx);
  return Math.min(n - 1, Math.max(0, Math.floor(((a + Math.PI) / (Math.PI * 2)) * n)));
};

/** Distance from (x, z) to the rect (0 inside). */
const outside = (r: SRect, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * The surroundings of a district. `available(key)`: the model is delivered and loaded (undelivered entries drop out; an empty band
 * keeps its ground).
 */
export function farCityPlan(S: SurfaceInfo, available: (key: string) => boolean = () => true, kit: readonly SurfaceKitEntry[] = SURFACE_KIT): FarCityPlan {
  const E = S.extent, cx = (E.x0 + E.x1) / 2, cz = (E.z0 + E.z1) / 2;
  const rng = mulberry32(((S.seed >>> 0) ^ 0x5f3759df) >>> 0 || 1);
  const byId = new Map(kit.map(e => [e.id, e]));
  const ok = (ids: readonly string[]) => ids.map(id => byId.get(id)).filter((e): e is SurfaceKitEntry => !!e && available(e.key));
  const placements: FarPlacement[] = [];
  const stats: Record<string, number> = {berm: 0, collapsed: 0, far: 0, skipped: 0};
  let tris = 0;
  const add = (e: SurfaceKitEntry, band: FarBand, x: number, y: number, z: number, yaw: number, s: number, budget: {left: number}): boolean => {
    if (e.tris > budget.left) { stats.skipped++; return false; }
    budget.left -= e.tris;
    tris += e.tris;
    placements.push({entry: e.id, key: e.key, x, y, z, yaw, s, band, sector: sectorOf(cx, cz, x, z)});
    stats[band]++;
    return true;
  };
  // --- berms: mounds along the outside of each cordon side ---
  const berm = ok(BERM_IDS), B = FAR_CITY.berm;
  if (berm.length) {
    const avg = berm.reduce((a, e) => a + e.tris, 0) / berm.length;
    const sides: [number, number, number, number, number, number][] = [
      // start x / z, direction x / z, outward x / z
      [E.x0, E.z0, 1, 0, 0, -1], [E.x1, E.z0, 0, 1, 1, 0], [E.x1, E.z1, -1, 0, 0, 1], [E.x0, E.z1, 0, -1, -1, 0],
    ];
    for (const [sx, sz, dx, dz, ox, oz] of sides) {
      const len = Math.abs(dx) ? E.x1 - E.x0 : E.z1 - E.z0, bb = {left: B.tris / 4};
      const step = Math.max(B.step, (len / Math.max(1, Math.floor(bb.left / avg))) * 1.1);
      for (let s = step * 0.5; s < len; s += step * (0.8 + rng() * 0.4)) {
        const e = berm[Math.floor(rng() * berm.length)];
        const d = B.from + rng() * (B.to - B.from), sc = B.scale[0] + rng() * (B.scale[1] - B.scale[0]);
        add(e, 'berm', sx + dx * s + ox * d, -B.sink * e.dims[1] * sc, sz + dz * s + oz * d, rng() * Math.PI * 2, sc, bb);
      }
    }
  }
  // --- the collapsed and far rings: jittered cells round the extent, filled by chance ---
  const ring = (band: 'collapsed' | 'far', ids: readonly string[]) => {
    const R = FAR_CITY[band], list = ok(ids), bud = {left: R.tris};
    if (!list.length) return;
    const x0 = E.x0 - R.to, z0 = E.z0 - R.to, x1 = E.x1 + R.to, z1 = E.z1 + R.to;
    const cells: [number, number][] = [];
    for (let z = z0; z < z1; z += R.cell) for (let x = x0; x < x1; x += R.cell) {
      const px = x + R.cell * (0.25 + rng() * 0.5), pz = z + R.cell * (0.25 + rng() * 0.5), d = outside(E, px, pz);
      if (d >= R.from && d <= R.to) cells.push([px, pz]);
    }
    // nearest first (the budget favours what is seen clearest), a seeded shuffle within distance bands
    cells.sort((a, b) => Math.floor(outside(E, a[0], a[1]) / 20) - Math.floor(outside(E, b[0], b[1]) / 20) || rng() - 0.5);
    for (const [px, pz] of cells) {
      if (rng() > R.fill) continue;
      // tall pieces further out (the skyline), low ones near the cordon
      const d = outside(E, px, pz), far = (d - R.from) / Math.max(1, R.to - R.from);
      const w = list.map(e => (band === 'far' ? e.dims[1] * (0.4 + far) : 1 / (1 + e.dims[1] / 20)));
      let t = rng() * w.reduce((a, b) => a + b, 0), e = list[0];
      for (let k = 0; k < list.length; k++) { t -= w[k]; if (t <= 0) { e = list[k]; break; } }
      const sc = e.scale[0] + rng() * (e.scale[1] - e.scale[0]);
      // collapsed: sunk into its own rubble; far: grounded (fog hides the base)
      const sink = band === 'collapsed' ? FAR_CITY.collapsed.sinkMin + rng() * (FAR_CITY.collapsed.sinkMax - FAR_CITY.collapsed.sinkMin) : 0;
      // front toward the district (a facade, not a back, faces the player), jittered
      const yaw = Math.atan2(cx - px, cz - pz) + (e.front === 1 ? 0 : Math.PI) + (rng() - 0.5) * 0.5;
      if (!add(e, band, px, -sink * e.dims[1] * sc, pz, yaw, sc, bud)) continue;
      if (band === 'collapsed' && berm.length && rng() < 0.6) {
        const r = berm[0], a = rng() * Math.PI * 2, rr = Math.max(e.dims[0], e.dims[2]) * sc * 0.45;
        add(r, 'collapsed', px + Math.cos(a) * rr, -0.25 * r.dims[1], pz + Math.sin(a) * rr, rng() * Math.PI * 2, 1.6 + rng() * 1.4, bud);
      }
    }
  };
  ring('collapsed', COLLAPSED_IDS);
  ring('far', FAR_IDS);
  return {extent: E, centre: {x: cx, z: cz}, placements, groundR: FAR_CITY.groundR, tris, stats};
}
