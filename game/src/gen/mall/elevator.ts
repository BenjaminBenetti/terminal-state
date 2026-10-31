// Task track3-eaton-centre-20261031 (lane GEN): the mall's GLASS ELEVATOR as the Office elevator runtime reads it. Pure data.
//
// world/towerRuntime.ts builds ONE physically travelling cab per world from world/towerShared.ts readTowerInfo (the Office's
// layout.office v2 record: cab / shaft / door side / door / panel / stops with call panels and landings). The mall has no office
// record; `mallTowerRecord` derives the same v2 shape from layout.mall.elevators[0] (the cab rides the shaft through the station
// and every retail floor — task mall-playtest-revision-20261031: 4 stops, station + floors 1..3; the shaft is SOLID on every storey
// grid, the cab is a Levels dynamic volume) — no windows, no exterior city. The door faces the gallery walkway (away from the
// atrium; the shaft stands in the court's north strip, its landing on the walkway / the Fountain court); short storey labels
// ('S', '1' … '3') suit the cab buttons.
// The glass cab / shaft look is lane ARCH's (the runtime's view is the Office cab until then).

import type {StationLayout} from '../stationTypes';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Office-v2-shaped record of the mall's (first) elevator for readTowerInfo; null when the layout has none. */
export function mallTowerRecord(layout: Pick<StationLayout, 'mall' | 'levels' | 'grid'>): Record<string, unknown> | null {
  const m = layout.mall;
  const e = m?.elevators[0];
  if (!m || !e || !layout.levels?.length) return null;
  const vz = (m.void.bounds.z0 + m.void.bounds.z1) / 2;
  const side: 'N' | 'S' = (e.shaft.z0 + e.shaft.z1) / 2 < vz ? 'N' : 'S';
  const n = side === 'N' ? -1 : 1;
  const cx = r3((e.cab.x0 + e.cab.x1) / 2);
  const doorZ = side === 'N' ? e.cab.z0 : e.cab.z1;
  const wallZ = side === 'N' ? e.shaft.z0 : e.shaft.z1;
  const width = 1.5;
  const landing = {x: cx, z: r3(wallZ + n * 0.75)};
  const g = layout.grid;
  // task mall-round2-20261031 (lane RUNTIME, M02): `name` = the storey's HUD name ('Subway' / 'Level 1') for the button prompts; the
  // runtime shows these short labels on every button / indicator (no Office 'L' numbering: the station is not a second lobby)
  const storeys = m.storeys.map(s => ({floor: s.level, levelId: s.level, baseY: s.baseY, label: s.level === 0 ? 'S' : String(s.level), name: s.label, clear: s.clear}));
  return {
    version: 2,
    floors: storeys.map(s => s.floor),
    floorHeight: storeys.length > 1 ? r3(storeys[1].baseY - storeys[0].baseY) : 5,
    groundY: 0,
    storeys,
    elevator: {
      cab: {...e.cab}, shaft: {...e.shaft}, doorSide: side,
      door: {x: cx, z: r3(doorZ), width},
      cabHeight: 2.6,
      panel: {x: r3(cx + width / 2 + 0.25), dy: 1.2, z: r3(doorZ - n * 0.03)},
      stops: e.stops.map(s => {
        const lg = layout.levels[s.level]?.grid ?? g;
        const [lx, ly] = lg.cellOf(landing.x, landing.z);
        return {
          floor: s.level, levelId: s.level, y: s.y, area: lg.inBounds(lx, ly) ? lg.area[lg.idx(lx, ly)] : -1,
          callPanel: {x: r3(cx + width / 2 + 0.3), y: r3(s.y + 1.2), z: r3(wallZ + n * 0.03)},
          landing: {...landing},
        };
      }),
    },
    windows: [],
    exterior: {...m.void.bounds},
    stairs: {well: null, landings: []},
    name: m.name,
  };
}
