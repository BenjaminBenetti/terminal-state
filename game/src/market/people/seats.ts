// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): what a bar patron sits on — a 'drink' spot (layout v3: a stool at the bar
// counter or a seat at a bar table) is seated when a seat prop stands at it, else the patron stands at the counter. Pure.
//  - the seat height: a P7 model's measured seat surface (gen/props07.catalog.ts: the largest open surface 0.3..0.95 m up), else by the
//    kind's name (a stool 0.72 m, a chair / bench / seat 0.45 m, a sofa / couch / armchair 0.42 m); anything else is no seat.
import {P7_MODELS, type P7Surface} from '../../gen/props07.catalog';
import type {PropPlacement} from '../../gen/props';
import type {MarketSpot} from '../../gen/market/marketTypes';

/** A seat prop within this of a spot (m) is the spot's seat. */
export const SEAT_REACH = 0.6;

/** A seat kind's seat height above its base (m), or null when the kind is no seat. */
export function seatHeightOf(kind: string): number | null {
  if (/repair|grinder|lab|work|wheel/i.test(kind)) return null; // (benches you work at, a wheelchair: not a patron's seat)
  const named = /stool/i.test(kind) ? 0.72 : /sofa|couch|armchair/i.test(kind) ? 0.42 : /chair|^bench$|mallbench|seat/i.test(kind) ? 0.45 : null;
  if (named === null) return null;
  const m = (P7_MODELS as Readonly<Record<string, {surfaces: readonly P7Surface[]}>>)[kind];
  const s = m?.surfaces.filter(q => q.y >= 0.3 && q.y <= 0.95 && q.clear >= 0.3).sort((a, b) => b.area - a.area)[0];
  return s ? +s.y.toFixed(3) : named;
}

/** The seat at a spot: its centre (x, z) and the seat top's world height, or null (a standing post). */
export function seatAt(spot: MarketSpot, props: readonly PropPlacement[] | undefined): {x: number; z: number; y: number; prop: number} | null {
  if (!props) return null;
  let best: {x: number; z: number; y: number; prop: number} | null = null, bd = SEAT_REACH;
  props.forEach((p, i) => {
    if (p.mounted || (p.level ?? 0) !== spot.level || Math.abs(p.y - spot.y) > 0.35) return;
    const h = seatHeightOf(p.kind);
    if (h === null) return;
    const d = Math.hypot(p.x - spot.x, p.z - spot.z);
    if (d < bd) { bd = d; best = {x: p.x, z: p.z, y: p.y + h, prop: i}; }
  });
  return best;
}
