// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2's CARGO LIFT record (layout.bunker.lift) from the spine's shaft. Pure.
// The shaft (gen/bunker/v2/spine.ts V2.shaft) is solid on every storey grid with a 1-cell wall ring; the car's interior is the ring's
// inside (4 x 5 m: a fuel cart, furniture and the player at once), its gate the north wall's inner span at every stop. The landing
// call panel sits on the shaft's north face west of the gate (the pier between the shaft and the main stair core).

import {CELL} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import type {BunkerLiftInfo} from '../bunkerTypes';
import {V2, V2_BASES, V2_LEVELS, type BunkerSpine} from './spine';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The car's gate clear width (m): the cab's width less its gate posts. */
export const LIFT_GATE_W = 3.6;

export function liftRecord(layout: StationLayout, sp: BunkerSpine): BunkerLiftInfo {
  const s = sp.shaft;
  const shaft = {x0: s.x * CELL, z0: s.y * CELL, x1: (s.x + s.w) * CELL, z1: (s.y + s.h) * CELL};
  const cab = {x0: shaft.x0 + CELL, z0: shaft.z0 + CELL, x1: shaft.x1 - CELL, z1: shaft.z1 - CELL};
  const doorX = r3((cab.x0 + cab.x1) / 2);
  const stops: BunkerLiftInfo['stops'] = [];
  for (let L = 0; L < V2_LEVELS; L++) {
    const an = sp.storeys[L].anchors.find(a => a.id === 'lift')!;
    const g = layout.levels[L].grid, i = g.idx(an.apron.x + Math.floor(an.apron.w / 2), an.apron.y + an.apron.h - 1);
    stops.push({
      level: L, y: V2_BASES[L], area: g.area[i],
      landing: {x: doorX, z: r3(shaft.z0 - 1.2)},
      callPanel: {x: r3(shaft.x0 - 0.25), y: r3(V2_BASES[L] + 1.25), z: r3(shaft.z0 - 0.02)},
    });
  }
  return {cab, shaft, doorSide: 'N', door: {x: doorX, z: cab.z0, width: LIFT_GATE_W}, cabHeight: V2.liftCabH, gateHeight: V2.liftDoorH, stops, home: 0};
}
