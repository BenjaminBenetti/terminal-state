// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): THE SURVIVOR MARKET version 2's shared record (layout.market v = 2,
// gen/market/marketTypes.ts) — the six stalls (counter, trader, customer point, DISPLAY SURFACES) and the residents' spots — from the
// furnished layout. Pure and deterministic.
//
// A stall's displays are the real surfaces of its display fixtures (counter tops, shelf tiers, plank shelving, the medicine cabinet's
// shelves, the gun rack's cradle shelf, table tops): the same surfaces the loot / physics code knows for those kinds (items/lootLayout.ts
// holderSurfaces; a plain fixture's box top), in world space after the upper storeys were lifted — the WARES lane stands the stall's
// real, owned stock there. Spots: version 1's rule (clear, flat floor of their storey, nudged to the nearest clear cell of their area
// within 1.5 m, else dropped), storeys 0 and 1 only (the residents never climb the rooftop ladders).

import type {Rng} from '../../../core/rng';
import {PROP_DEFS, SHELF_TIER_Y, type PropPlacement} from '../../props';
import {holderSurfaces, type SurfaceHolder, type SurfaceOptions} from '../../../items/lootLayout';
import {isLootHolderKind} from '../../../items/loot';
import {GUN_RACK_SHELF_Y} from '../../mall/kinds';
import type {Grid} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import {MARKET_STALLS, type MarketDisplaySlot, type MarketLayout, type MarketSpot, type MarketStall, type MarketStallId} from '../marketTypes';
import {MARKET_POPULATION, marketStandOk} from '../spots';
import type {SettleCarve} from './carve';
import {SURF_GUN_RACK, SURF_TOP, type DisplaySource, type SettleAnchors} from './dress';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Surface options as the runtime's loot holders use them (world/containers.ts: the measured shelf tiers). */
function surfaceOptions(): SurfaceOptions {
  const sh = PROP_DEFS.shelf;
  return {shelf: {tierY: SHELF_TIER_Y, w: sh.w, d: sh.d, h: sh.h}};
}

/** A display fixture's surface in its prop frame (y above its base; x along its width, z toward its front), or null. */
export function displaySurface(p: PropPlacement, surface: number): {y: number; x0: number; x1: number; z0: number; z1: number} | null {
  const def = PROP_DEFS[p.kind];
  if (surface === SURF_TOP) return {y: def.h + 0.002, x0: -def.w / 2 + 0.06, x1: def.w / 2 - 0.06, z0: -def.d / 2 + 0.06, z1: def.d / 2 - 0.06};
  if (surface === SURF_GUN_RACK) return {y: GUN_RACK_SHELF_Y + 0.002, x0: -def.w / 2 + 0.12, x1: def.w / 2 - 0.12, z0: -Math.min(0.1, def.d / 2 - 0.03), z1: Math.min(0.1, def.d / 2 - 0.03)};
  if (!isLootHolderKind(p.kind)) return null;
  return holderSurfaces(p.kind as SurfaceHolder, def, surfaceOptions())[surface] ?? null;
}

/** The world display slot of a display source (absolute y: props are lifted onto their storey by now). */
export function displaySlotOf(layout: StationLayout, src: DisplaySource): MarketDisplaySlot | null {
  const p = layout.props[src.prop];
  if (!p) return null;
  const s = displaySurface(p, src.surface);
  if (!s) return null;
  const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, c = Math.cos(p.rot), sn = Math.sin(p.rot);
  return {x: r3(p.x + cx * c + cz * sn), z: r3(p.z - cx * sn + cz * c), y: r3(p.y + s.y), level: p.level ?? 0, yaw: r3(p.rot), w: r3(s.x1 - s.x0), d: r3(s.z1 - s.z0)};
}

/** The nearest clear stand point of `area` within `r` cells of (x, z) (cell centres; the point itself first), or null. */
function nudge(g: Grid, x: number, z: number, area: number, r = 3): {x: number; z: number} | null {
  if (marketStandOk(g, x, z) && g.area[g.idx(...g.cellOf(x, z))] === area) return {x, z};
  const [cx, cy] = g.cellOf(x, z);
  for (let d = 1; d <= r; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) {
    if (Math.max(Math.abs(ox), Math.abs(oy)) !== d || !g.inBounds(cx + ox, cy + oy)) continue;
    if (g.area[g.idx(cx + ox, cy + oy)] !== area) continue;
    const [wx, wz] = g.center(cx + ox, cy + oy);
    if (marketStandOk(g, wx, wz)) return {x: wx, z: wz};
  }
  return null;
}

/** layout.market (version 2) of a furnished settlement. */
export function settleRecord(layout: StationLayout, sc: SettleCarve, anchors: SettleAnchors, names: Record<MarketStallId, string>, rng: Rng): MarketLayout {
  const base = (lv: number) => sc.bases[lv] ?? 0;
  const stalls: MarketStall[] = [];
  for (const id of MARKET_STALLS) {
    const d = anchors.stalls.find(s => s.id === id);
    if (!d) continue;
    const y = base(d.level);
    const displays = d.displays.map(src => displaySlotOf(layout, src)).filter((q): q is MarketDisplaySlot => !!q);
    stalls.push({
      id, name: names[id], area: d.area,
      counter: {...d.counter, x: r3((d.counter.x0 + d.counter.x1) / 2), z: r3((d.counter.z0 + d.counter.z1) / 2), y, level: d.level},
      trader: {x: d.trader.x, z: d.trader.z, y, level: d.level, yaw: d.trader.yaw},
      front: {x: d.front.x, z: d.front.z, y, level: d.level},
      displays,
    });
  }
  const spots: MarketSpot[] = [];
  for (const u of anchors.uses) {
    if (u.level > 1) continue;
    const g = layout.levels[u.level].grid;
    const p = nudge(g, u.x, u.z, u.area);
    if (!p || spots.some(s => s.level === u.level && Math.hypot(s.x - p.x, s.z - p.z) < 0.9)) continue;
    spots.push({kind: u.kind, x: r3(p.x), z: r3(p.z), y: base(u.level), level: u.level, yaw: r3(u.yaw), area: u.area});
  }
  const [r0, r1] = MARKET_POPULATION.residents;
  return {v: 2, stalls, spots, residents: rng.int(r0, r1)};
}
