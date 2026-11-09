// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2's CARGO LIFT record (layout.bunker.lift) from the spine's shaft. Pure.
// The shaft (gen/bunker/v2/spine.ts V2.shaft) is solid on every storey grid with a 1-cell wall ring; the car's interior is the ring's
// inside (4 x 5 m: a fuel cart, furniture and the player at once), its gate the north wall's inner span at every stop. The landing
// call panel sits on the shaft's north face west of the gate (the pier between the shaft and the main stair core).

import {CELL} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import type {BunkerLiftInfo} from '../bunkerTypes';
import {V2, V2_BASES, V2_LEVELS, type BunkerSpine} from './spine';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The car's gate clear width (m): the cab's 4 m width less the gate returns (the car's control panel stands on one). */
export const LIFT_GATE_W = 3.2;

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
      callPanel: {x: r3(doorX - LIFT_GATE_W / 2 - 0.45), y: r3(V2_BASES[L] + 1.25), z: r3(shaft.z0 - 0.02)},
    });
  }
  return {cab, shaft, doorSide: 'N', door: {x: doorX, z: cab.z0, width: LIFT_GATE_W}, cabHeight: V2.liftCabH, gateHeight: V2.liftDoorH, stops, home: 0};
}

/** Short stop labels (buttons / indicator): the station 'S', the shelter storeys '1' .. '5'. */
export const LIFT_STOP_LABELS: readonly string[] = ['S', '1', '2', '3', '4', '5'];

/**
 * The Office-v2-shaped record of a version-2 Bunker's cargo lift for the elevator runtime (world/towerShared.ts readTowerInfo ->
 * world/towerRuntime.ts: ONE physically travelling car, its Levels volume, gates, panels): stop `floor` = the storey index, labels
 * 'S' / '1'..'5', the freight car's look and gate height, the car parked at its home stop (the station) until it has power. Null
 * without a lift (version 1, every other level).
 */
export function bunkerTowerRecord(layout: Pick<StationLayout, 'bunker' | 'levels'>): Record<string, unknown> | null {
  const b = layout.bunker, lift = b?.lift;
  if (!b || !lift || !layout.levels?.length) return null;
  const storeys = b.storeys.map(s => ({floor: s.level, levelId: s.level, baseY: s.baseY, label: LIFT_STOP_LABELS[s.level] ?? String(s.level), name: s.label, clear: 3.2}));
  const doorZ = lift.cab.z0;
  return {
    version: 2,
    floors: storeys.map(s => s.floor),
    floorHeight: 7,
    groundY: 0,
    storeys,
    elevator: {
      cab: {...lift.cab}, shaft: {...lift.shaft}, doorSide: lift.doorSide,
      door: {...lift.door},
      cabHeight: lift.cabHeight,
      doorHeight: lift.gateHeight,
      cargo: true,
      home: lift.stops[lift.home]?.level ?? 0,
      panel: {x: r3(lift.door.x + lift.door.width / 2 + 0.2), dy: 1.25, z: r3(doorZ + 0.03)},
      stops: lift.stops.map(s => ({floor: s.level, levelId: s.level, y: s.y, area: s.area, callPanel: {...s.callPanel}, landing: {...s.landing}})),
    },
    windows: [],
    exterior: {...lift.shaft},
    stairs: {well: null, landings: []},
    name: b.name,
  };
}
