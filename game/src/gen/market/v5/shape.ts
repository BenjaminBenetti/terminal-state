// Task studio-survivor-market-crevice-20261116-074419: THE CREVICE's shape record (layout.market.crevice, gen/market/marketTypes.ts
// MarketCrevice) from its carve — the container boxes (paint, front, openings, closed or lived in), the bridge decks, the chasm — in world
// metres, for the look (world/marketArch.ts paints, the crevice view's container frames / windows / bridges). Pure and deterministic.

import {CELL} from '../../grid';
import type {Door, Rect, StationLayout} from '../../stationTypes';
import type {CrevEdgeRun, MarketCrevContainer, MarketCrevice} from '../marketTypes';
import {CREVICE} from './frame';
import type {CreviceCarve} from './carve';
import {ENVELOPE} from '../v6/envelope';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const box = (r: Rect) => ({x0: r3(r.x * CELL), z0: r3(r.y * CELL), x1: r3((r.x + r.w) * CELL), z1: r3((r.y + r.h) * CELL)});

/** layout.market.crevice of a carved (and dressed) crevice. */
export function creviceShape(layout: StationLayout, cc: CreviceCarve): MarketCrevice {
  const containers: MarketCrevContainer[] = cc.containers.map(c => {
    const along = c.face === 'E' || c.face === 'W';
    // its openings: the doors in its front wall column (the carve's opening; the den's entry / a shop's wide front included)
    const front = c.door;
    const doors: Door[] = front ? layout.doors.filter(d => (d.level ?? 0) === c.level && d.x === front.x && d.y === front.y && d.w === front.w && d.h === front.h) : [];
    const openings = doors.map(d => ({s0: r3((along ? d.y : d.x) * CELL), s1: r3((along ? d.y + d.h : d.x + d.w) * CELL), h: r3(d.height), wide: c.wide}));
    return {...box(c.box), y: cc.bases[c.level], level: c.level, face: c.face, paint: c.paint, use: c.use, area: c.area, openings, backroom: c.back !== undefined || c.backDoor === null};
  });
  const out: MarketCrevice = {
    topY: CREVICE.topY, hallY: CREVICE.hallY, chasmY: CREVICE.chasmY, bases: [...cc.bases], cont: CREVICE.cont,
    chasm: box(cc.chasm),
    containers,
    bridges: cc.bridges.map(b => ({...box(b.rect), y: cc.bases[b.level], level: b.level, area: b.area})),
  };
  // (layout version 6, task studio-market-irregular-envelope-20261116-210503-01: the irregular envelope — gen/market/v6/envelope.ts)
  const env = cc.envelope;
  if (env) {
    out.topY = r3(env.stamp.high);
    out.chasmY = r3(env.stamp.deepest);
    out.envelope = {
      sky: r3(env.stamp.low), rock: ENVELOPE.rock,
      clefts: env.plan.clefts.map(p => ({...box(cc.M({x: p.x, y: p.y, w: p.w, h: p.h})), y: r3(p.floor)})),
      alcoves: cc.pockets.filter(p => p.deep).length,
    };
  }
  // (layout version 7, task studio-market-irregular-settlement-20261117-003819-01: the irregular settlement — the pit's runs, each storey's
  // walk edge over the drop per world side, row by row)
  const st = cc.settle;
  if (st) {
    const R = cc.rows, edges: {W: CrevEdgeRun[]; E: CrevEdgeRun[]}[] = [];
    for (let L = 0; L < CREVICE.bands; L++) {
      const e: {W: CrevEdgeRun[]; E: CrevEdgeRun[]} = {W: [], E: []};
      const y0 = L ? R.z0 : R.chasm0, y1 = L ? R.z1 : R.chasm1;
      for (const s of ['W', 'E'] as const) {
        // (canonical side s stands on the world side its fronts face away from: world west when its fronts face east)
        const ws: 'W' | 'E' = (s === 'W') !== cc.f.mirror ? 'W' : 'E', list = e[ws];
        for (let y = y0; y < y1; y++) {
          const last = st.walkCols(s, L, y)[1], x = r3((ws === 'W' ? last + 1 : last) * CELL), q = list[list.length - 1];
          if (q && q.x === x && Math.abs(q.z1 - y * CELL) < 1e-6) q.z1 = r3((y + 1) * CELL); else list.push({z0: r3(y * CELL), z1: r3((y + 1) * CELL), x});
        }
      }
      edges.push(e);
    }
    out.settlement = {pit: st.pit.map(box), edges};
  }
  return out;
}
