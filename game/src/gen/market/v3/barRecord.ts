// Task studio-market-bar-20261108-225231-01 (lane BAR): layout version 3's record — version 2's record (gen/market/v2/record.ts: the six
// stalls, the residents' spots) plus THE BAR: its bartender's stall (counter, post, customer spot, the display surfaces on the backbar
// shelving: the bar's real, owned stock stands there — market/wares) and the patrons' 'drink' posts (one per stool / chair seat, the
// clear floor beside it, facing the counter / the table; `seat` names the stool / chair). Pure and deterministic.

import type {Rng} from '../../../core/rng';
import type {Grid} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import {BAR_STALL, type MarketDisplaySlot, type MarketLayout, type MarketSpot} from '../marketTypes';
import {marketStandOk} from '../spots';
import {displaySlotOf} from '../v2/record';
import type {SettleCarve} from '../v2/carve';
import type {BarCarve} from './barCarve';
import type {BarDressed} from './barDress';

/** The bar's patron posts: at most / at least this many 'drink' spots. */
export const BAR_SPOTS = {max: 10, min: 6} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The nearest clear stand point of `area` within `r` cells of (x, z) that `ok` accepts (cell centres, nearest first), or null. */
function standNear(g: Grid, x: number, z: number, area: number, ok: (x: number, z: number) => boolean, r = 3): {x: number; z: number} | null {
  const [cx, cy] = g.cellOf(x, z);
  let best: {x: number; z: number} | null = null, bd = Infinity;
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    if (!g.inBounds(cx + ox, cy + oy) || g.area[g.idx(cx + ox, cy + oy)] !== area) continue;
    const [wx, wz] = g.center(cx + ox, cy + oy), d = Math.hypot(wx - x, wz - z);
    if (d < bd - 1e-9 && marketStandOk(g, wx, wz) && ok(wx, wz)) { best = {x: wx, z: wz}; bd = d; }
  }
  return best;
}

/** Adds the bar (its stall, its 'drink' posts) to a version-2 record and makes it version 3. */
export function barRecord(layout: StationLayout, sc: SettleCarve, bc: BarCarve, d: BarDressed, name: string, rng: Rng, m: MarketLayout): MarketLayout {
  const y = sc.bases[1], s = d.stall;
  // the backbar's surfaces, nearest the bartender first (ties by fixture / height): what the wares show first
  const near = (q: MarketDisplaySlot) => Math.hypot(q.x - s.trader.x, q.z - s.trader.z, q.y - (y + 1.2));
  const displays = s.displays.map(src => displaySlotOf(layout, src)).filter((q): q is MarketDisplaySlot => !!q)
    .sort((p, q) => near(p) - near(q) || (p.host ?? 0) - (q.host ?? 0) || p.y - q.y);
  const stalls = [...m.stalls, {
    id: BAR_STALL, name, area: s.area,
    counter: {...s.counter, x: r3((s.counter.x0 + s.counter.x1) / 2), z: r3((s.counter.z0 + s.counter.z1) / 2), y, level: 1},
    trader: {x: s.trader.x, z: s.trader.z, y, level: 1, yaw: s.trader.yaw},
    front: {x: s.front.x, z: s.front.z, y, level: 1},
    displays,
  }];
  // the patrons' posts: the seats in a seeded order (stools and chairs mixed), the nearest clear floor beside each — never the customer's
  // trading spot or the bartender's post, never within 0.9 m of another spot
  const g = layout.levels[1].grid, spots: MarketSpot[] = [...m.spots], drink: MarketSpot[] = [];
  const free = (px: number, pz: number) => Math.hypot(px - s.front.x, pz - s.front.z) >= 0.9 && Math.hypot(px - s.trader.x, pz - s.trader.z) >= 0.9
    && !spots.some(q => q.level === 1 && Math.hypot(q.x - px, q.z - pz) < 0.9);
  for (const seat of rng.shuffle(d.seats.slice())) {
    if (drink.length >= BAR_SPOTS.max) break;
    const p = standNear(g, seat.x, seat.z, bc.area, free);
    if (!p) continue;
    const q: MarketSpot = {kind: 'drink', x: r3(p.x), z: r3(p.z), y, level: 1, yaw: r3(Math.atan2(-(seat.faceX - p.x), -(seat.faceZ - p.z))), area: bc.area, seat: seat.prop};
    spots.push(q);
    drink.push(q);
  }
  return {...m, v: 3, stalls, spots};
}
