// Task studio-survivor-market-crevice-20261116-074419: THE CREVICE's shape record (layout.market.crevice, gen/market/marketTypes.ts
// MarketCrevice) from its carve — the container boxes (paint, front, openings, closed or lived in), the bridge decks, the chasm — in world
// metres, for the look (world/marketArch.ts paints, the crevice view's container frames / windows / bridges). Pure and deterministic.

import {CELL} from '../../grid';
import type {Door, Rect, StationLayout} from '../../stationTypes';
import type {MarketCrevContainer, MarketCrevice} from '../marketTypes';
import {CREVICE} from './frame';
import type {CreviceCarve} from './carve';

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
  return {
    topY: CREVICE.topY, hallY: CREVICE.hallY, chasmY: CREVICE.chasmY, bases: [...cc.bases], cont: CREVICE.cont,
    chasm: box(cc.chasm),
    containers,
    bridges: cc.bridges.map(b => ({...box(b.rect), y: cc.bases[b.level], level: b.level, area: b.area})),
  };
}
