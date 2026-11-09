// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): what a bar patron sits on — a 'drink' spot (layout v3: a stool at the bar
// counter or a seat at a bar table) is seated on its seat, else the patron stands at the counter. Pure.
//  - the seat: the spot's own `seat` (layout v3 names the stool / chair prop it belongs to), else the nearest seat prop within SEAT_REACH;
//  - its height: a known kind's seat top (the counter stool's padded top = its height, the café chair's 0.43 m), a P7 model's measured
//    seat surface (gen/props07.catalog.ts: the largest open surface 0.3..0.95 m up), else by the kind's name (a stool 0.72 m, a chair /
//    bench / seat 0.45 m, a sofa / couch / armchair 0.42 m); anything else is no seat.
import {P7_MODELS, type P7Surface} from '../../gen/props07.catalog';
import type {PropPlacement} from '../../gen/props';
import type {MarketSpot} from '../../gen/market/marketTypes';

/** A seat prop within this of a spot (m) is the spot's seat (a spot that does not name its seat). */
export const SEAT_REACH = 0.6;

/** Seat tops of known kinds (m above the base; `null` = the prop's own height: a stool's padded top). */
const KNOWN_SEATS: Readonly<Record<string, number | null>> = {
  skyMuStool: null, // (gen/skyways/stores/musicShapes.ts: a counter stool, its seat at its full 0.66 m height)
  cafeChair: 0.43, // (gen/mall/kinds.ts: the seat board at 0.41 + 0.02)
};

/** A seat kind's seat height above its base (m; `h` = the placed prop's height), or null when the kind is no seat. */
export function seatHeightOf(kind: string, h?: number): number | null {
  if (kind in KNOWN_SEATS) return KNOWN_SEATS[kind] ?? (h !== undefined && h >= 0.35 && h <= 0.95 ? h : 0.66);
  if (/repair|grinder|lab|work|wheel/i.test(kind)) return null; // (benches you work at, a wheelchair: not a patron's seat)
  const named = /stool/i.test(kind) ? (h !== undefined && h >= 0.35 && h <= 0.95 ? h : 0.72) : /sofa|couch|armchair/i.test(kind) ? 0.42 : /chair|^bench$|mallbench|seat/i.test(kind) ? 0.45 : null;
  if (named === null) return null;
  const m = (P7_MODELS as Readonly<Record<string, {surfaces: readonly P7Surface[]}>>)[kind];
  const s = m?.surfaces.filter(q => q.y >= 0.3 && q.y <= 0.95 && q.clear >= 0.3).sort((a, b) => b.area - a.area)[0];
  return s ? +s.y.toFixed(3) : named;
}

/** The seat at a spot: its centre (x, z) and the seat top's world height, or null (a standing post). */
export function seatAt(spot: MarketSpot, props: readonly PropPlacement[] | undefined): {x: number; z: number; y: number; prop: number} | null {
  if (!props) return null;
  if (spot.seat !== undefined) {
    const p = props[spot.seat], h = p ? seatHeightOf(p.kind, p.h) : null;
    if (p && h !== null) return {x: p.x, z: p.z, y: p.y + h, prop: spot.seat};
  }
  let best: {x: number; z: number; y: number; prop: number} | null = null, bd = SEAT_REACH;
  props.forEach((p, i) => {
    if (p.mounted || (p.level ?? 0) !== spot.level || Math.abs(p.y - spot.y) > 0.35) return;
    const h = seatHeightOf(p.kind, p.h);
    if (h === null) return;
    const d = Math.hypot(p.x - spot.x, p.z - spot.z);
    if (d < bd) { bd = d; best = {x: p.x, z: p.z, y: p.y + h, prop: i}; }
  });
  return best;
}
