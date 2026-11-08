// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): THE SURVIVOR MARKET version 2's shared record (layout.market v = 2,
// gen/market/marketTypes.ts) — the six stalls (counter, trader, customer point, DISPLAY SURFACES) and the residents' spots — from the
// furnished layout. Pure and deterministic.
//
// A stall's displays are the real surfaces of its display fixtures (counter tops, shelf tiers, plank shelving, the medicine cabinet's
// shelves, the gun shop's felt display bench): the same item-collision surfaces the loot / physics code knows for those kinds
// (items/lootLayout.ts holderSurfaces of an empty-keyed holder; a solid fixture's box top), in world space after the upper storeys were
// lifted, each with its free height (`clear`) and its fixture (`host`), nearest the stall's customer spot first — the WARES lane stands the
// stall's real, owned stock there (market/wares/slots.ts: the first ones it shows). Spots: version 1's rule (clear, flat floor of their storey, nudged to the nearest clear cell of their area
// within 1.5 m, else dropped), storeys 0 and 1 only (the residents never climb the rooftop ladders).

import type {Rng} from '../../../core/rng';
import {PROP_DEFS, SHELF_TIER_Y, type PropPlacement} from '../../props';
import {holderSurfaces, type SurfaceHolder, type SurfaceOptions} from '../../../items/lootLayout';
import {isLootHolderKind} from '../../../items/loot';
import type {Grid} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import {MARKET_STALLS, type MarketDisplaySlot, type MarketLayout, type MarketSpot, type MarketStall, type MarketStallId} from '../marketTypes';
import {MARKET_POPULATION, marketStandOk} from '../spots';
import type {SettleCarve} from './carve';
import {SURF_TOP, type DisplaySource, type SettleAnchors} from './dress';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** At most this many of the homes' beds / other posts become resident spots (seeded pick). */
export const SETTLE_HOME_SPOTS = {sleep: 2, other: 2} as const;

/** Surface options as the runtime's loot holders use them (world/containers.ts: the measured shelf tiers). */
function surfaceOptions(): SurfaceOptions {
  const sh = PROP_DEFS.shelf;
  return {shelf: {tierY: SHELF_TIER_Y, w: sh.w, d: sh.d, h: sh.h}};
}

/** A display fixture's surface in its prop frame (y above its base; x along its width, z toward its front; its free height), or null. */
export function displaySurface(p: PropPlacement, surface: number): {y: number; x0: number; x1: number; z0: number; z1: number; clear: number} | null {
  const def = PROP_DEFS[p.kind];
  if (surface === SURF_TOP) return {y: def.h + 0.002, x0: -def.w / 2 + 0.06, x1: def.w / 2 - 0.06, z0: -def.d / 2 + 0.06, z1: def.d / 2 - 0.06, clear: 0.5};
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
  return {x: r3(p.x + cx * c + cz * sn), z: r3(p.z - cx * sn + cz * c), y: r3(p.y + s.y), level: p.level ?? 0, yaw: r3(p.rot), w: r3(s.x1 - s.x0), d: r3(s.z1 - s.z0),
    clear: r3(Math.min(0.6, s.clear)), host: src.prop};
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
    // nearest the customer spot first (the counter tops, the side shelving, then the back wall), ties by fixture / height
    const far = (q: MarketDisplaySlot) => Math.hypot(q.x - d.front.x, q.z - d.front.z, q.y - (y + 1.6));
    const displays = d.displays.map(src => displaySlotOf(layout, src)).filter((q): q is MarketDisplaySlot => !!q)
      .sort((p, q) => far(p) - far(q) || (p.host ?? 0) - (q.host ?? 0) || p.y - q.y);
    stalls.push({
      id, name: names[id], area: d.area,
      counter: {...d.counter, x: r3((d.counter.x0 + d.counter.x1) / 2), z: r3((d.counter.z0 + d.counter.z1) / 2), y, level: d.level},
      trader: {x: d.trader.x, z: d.trader.z, y, level: d.level, yaw: d.trader.yaw},
      front: {x: d.front.x, z: d.front.z, y, level: d.level},
      displays,
    });
  }
  const spots: MarketSpot[] = [];
  // the homes are private: only a few of their beds / tables are resident posts (the residents live out in the lanes, the yard, the
  // catwalks, the kitchen, the workshop and the services — a lived-in place you SEE), never one per home
  const isHome = (area: number) => /Home$|home$/.test(layout.areas[area]?.label ?? '');
  const homeUses = rng.shuffle(anchors.uses.filter(u => isHome(u.area)).map(u => u));
  const keepHome = new Set([...homeUses.filter(u => u.kind === 'sleep').slice(0, SETTLE_HOME_SPOTS.sleep), ...homeUses.filter(u => u.kind !== 'sleep').slice(0, SETTLE_HOME_SPOTS.other)]);
  for (const u of anchors.uses) {
    if (u.level > 1 || (isHome(u.area) && !keepHome.has(u))) continue;
    const g = layout.levels[u.level].grid;
    const p = nudge(g, u.x, u.z, u.area);
    if (!p || spots.some(s => s.level === u.level && Math.hypot(s.x - p.x, s.z - p.z) < 0.9)) continue;
    spots.push({kind: u.kind, x: r3(p.x), z: r3(p.z), y: base(u.level), level: u.level, yaw: r3(u.yaw), area: u.area});
  }
  const [r0, r1] = MARKET_POPULATION.residents;
  return {v: 2, stalls, spots, residents: rng.int(r0, r1)};
}
