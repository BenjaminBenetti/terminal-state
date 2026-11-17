// Task studio-survivor-market-crevice-20261116-074419 (lane DRESS): THE CREVICE's record (layout.market v = 5, gen/market/marketTypes.ts)
// from the furnished layout — version 2 / 3's contract: the six stalls in MARKET_STALLS order then the bar (BAR_STALL) — counter, trader,
// customer point, the display surfaces (gen/market/v2/record.ts displaySlotOf: the real item-collision surfaces of their fixtures, in
// world space after the upper storeys were lifted; a shop's nearest its customer first, the bar's nearest the bartender first) — and the
// residents' spots: the furniture's posts (version 2's rule: clear, flat floor of their own area, nudged to the nearest clear cell within
// 1.5 m, else dropped; never within 0.9 m of another), over ALL FOUR storeys (the crevice's stairs join them: no ladders), the homes'
// posts only a few (SETTLE_HOME_SPOTS: homes are private), and the bar patrons' 'drink' posts beside their stools / chairs (version 3's
// rule, gen/market/v3/barRecord.ts). Never a spot on the platform's train side, nor one the walks cannot reach on foot (the stairs only).
// Pure and deterministic.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR, type Grid} from '../../grid';
import {levelDistance} from '../../levelGen';
import type {StationLayout} from '../../stationTypes';
import {BAR_STALL, MARKET_STALLS, type MarketDisplaySlot, type MarketLayout, type MarketSpot, type MarketStall, type MarketStallId} from '../marketTypes';
import {MARKET_POPULATION, marketStandOk} from '../spots';
import {displaySlotOf, SETTLE_HOME_SPOTS} from '../v2/record';
import {BAR_SPOTS} from '../v3/barRecord';
import type {StallDressed2} from '../v2/dress';
import type {CreviceCarve} from './carve';
import {CREVICE_DRESS, type CreviceAnchors} from './dress';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The nearest clear stand point of `area` within `r` cells of (x, z) that `ok` accepts (the point itself first, then cell centres by
 *  ring), or null. */
function standNear(g: Grid, x: number, z: number, area: number, ok: (x: number, z: number) => boolean, r = 3): {x: number; z: number} | null {
  const here = g.cellOf(x, z);
  if (g.inBounds(...here) && g.area[g.idx(...here)] === area && marketStandOk(g, x, z) && ok(x, z)) return {x, z};
  let best: {x: number; z: number} | null = null, bd = Infinity;
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    const cx = here[0] + ox, cy = here[1] + oy;
    if (!g.inBounds(cx, cy) || g.area[g.idx(cx, cy)] !== area) continue;
    const [wx, wz] = g.center(cx, cy), d = Math.hypot(wx - x, wz - z);
    if (d < bd - 1e-9 && marketStandOk(g, wx, wz) && ok(wx, wz)) { best = {x: wx, z: wz}; bd = d; }
  }
  return best;
}

/** layout.market (version 5, or 6: the same crevice in its irregular envelope — task studio-market-irregular-envelope-20261116-210503-01)
 *  of a furnished crevice. */
export function creviceRecord(layout: StationLayout, cc: CreviceCarve, anchors: CreviceAnchors, names: Record<MarketStallId, string>, rng: Rng, v: 5 | 6 = 5): MarketLayout {
  const base = (lv: number) => cc.bases[lv] ?? 0;
  const stallOf = (d: StallDressed2, nearX: number, nearZ: number, nearY: number): MarketStall => {
    const y = base(d.level);
    const far = (q: MarketDisplaySlot) => Math.hypot(q.x - nearX, q.z - nearZ, q.y - nearY);
    const displays = d.displays.map(src => displaySlotOf(layout, src)).filter((q): q is MarketDisplaySlot => !!q)
      .sort((p, q) => far(p) - far(q) || (p.host ?? 0) - (q.host ?? 0) || p.y - q.y);
    return {
      id: d.id, name: names[d.id], area: d.area,
      counter: {...d.counter, x: r3((d.counter.x0 + d.counter.x1) / 2), z: r3((d.counter.z0 + d.counter.z1) / 2), y, level: d.level},
      trader: {x: d.trader.x, z: d.trader.z, y, level: d.level, yaw: d.trader.yaw},
      front: {x: d.front.x, z: d.front.z, y, level: d.level},
      displays,
    };
  };
  const stalls: MarketStall[] = [];
  for (const id of MARKET_STALLS) {
    const d = anchors.stalls.find(s => s.id === id);
    if (d) stalls.push(stallOf(d, d.front.x, d.front.z, base(d.level) + 1.6));
  }
  const barD = anchors.stalls.find(s => s.id === BAR_STALL);
  const bar = barD ? stallOf(barD, barD.trader.x, barD.trader.z, base(barD.level) + 1.2) : null;
  if (bar) stalls.push(bar);

  // --- the residents' posts (all four storeys; a few of the homes'), never on the platform's train side ----------------------------
  const spots: MarketSpot[] = [];
  const P = cc.platform, edgeZ = P.edge === 'N' ? P.y * CELL : (P.y + P.h) * CELL;
  // on foot from the platform (the stairs only): a post in a room the walks cannot reach is never kept
  const g0 = layout.levels[0].grid;
  let start: [number, number] | null = null;
  for (let y = P.y; y < P.y + P.h && !start; y++) for (let x = P.x + (P.w >> 1); x < P.x + P.w; x++) if (g0.cells[g0.idx(x, y)] === FLOOR && !g0.blocked[g0.idx(x, y)] && g0.area[g0.idx(x, y)] === P.id) { start = [x, y]; break; }
  const walk = start ? levelDistance(layout.levels, start[0], start[1], 0, layout.levelLinks.filter(k => k.kind === 'stairs')) : null;
  const onFoot = (lv: number, x: number, z: number) => !walk || walk[lv][g0.idx(...g0.cellOf(x, z))] >= 0;
  const trainSide = (lv: number, area: number, z: number) => lv === 0 && area === P.id && Math.abs(z - edgeZ) < CREVICE_DRESS.trainSide;
  const free = (lv: number, x: number, z: number) => !spots.some(s => s.level === lv && Math.hypot(s.x - x, s.z - z) < 0.9)
    && !stalls.some(st => st.trader.level === lv && (Math.hypot(st.trader.x - x, st.trader.z - z) < 0.9 || Math.hypot(st.front.x - x, st.front.z - z) < 0.9));
  const homes = rng.shuffle(anchors.uses.filter(u => u.home));
  const keepHome = new Set([...homes.filter(u => u.kind === 'sleep').slice(0, SETTLE_HOME_SPOTS.sleep), ...homes.filter(u => u.kind !== 'sleep').slice(0, SETTLE_HOME_SPOTS.other)]);
  for (const u of anchors.uses) {
    if (u.home && !keepHome.has(u)) continue;
    const g = layout.levels[u.level]?.grid;
    if (!g) continue;
    const p = standNear(g, u.x, u.z, u.area, (x, z) => free(u.level, x, z) && !trainSide(u.level, u.area, z) && onFoot(u.level, x, z));
    if (!p) continue;
    spots.push({kind: u.kind, x: r3(p.x), z: r3(p.z), y: base(u.level), level: u.level, yaw: u.yaw, area: u.area});
  }
  // the bar's patrons: one post beside each seat (a seeded order of stools and chairs), facing the counter / its table
  if (bar) {
    const g = layout.levels[1].grid, y = base(1);
    let n = 0;
    for (const seat of rng.shuffle(anchors.bar.seats.slice())) {
      if (n >= BAR_SPOTS.max) break;
      const p = standNear(g, seat.x, seat.z, anchors.bar.area, (x, z) => free(1, x, z) && onFoot(1, x, z));
      if (!p) continue;
      spots.push({kind: 'drink', x: r3(p.x), z: r3(p.z), y, level: 1, yaw: r3(Math.atan2(-(seat.faceX - p.x), -(seat.faceZ - p.z))), area: anchors.bar.area, seat: seat.prop});
      n++;
    }
  }
  const [r0, r1] = MARKET_POPULATION.residents;
  return {v, stalls, spots, residents: rng.int(r0, r1)};
}
