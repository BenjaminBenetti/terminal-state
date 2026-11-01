// Task reactor-build-20261101 (lane AIR): hand-built Reactor fixtures for the AIR tests (lane GEN builds the real generator in
// parallel; the lead adds real-layout checks once generateReactorLevel lands). Not a test file (no .test.ts suffix).
import {FLOOR, Grid} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import type {ReactorFan, ReactorGenerator, ReactorInfo, ReactorTier, ReactorZone} from '../src/gen/reactor/reactorTypes';

export interface FixtureZone { yTop: number; yBottom: number; cTop: number; cBottom: number }

/**
 * A Reactor: rim at y 0, one walkway tier per zone at the given deck heights, the core floor at `floorY`. Zone k's generator stands on
 * the deck of zone k-1's tier (zone 0's on the rim) — the contract's no-deadlock rule. Pit 40 x 40 m centred at (40, 40).
 */
export function fixtureInfo(o: {zones?: FixtureZone[]; decks?: number[]; floorY?: number} = {}): ReactorInfo {
  const zonesIn = o.zones ?? [
    {yTop: -3, yBottom: -13.5, cTop: 0.16, cBottom: 0.32},
    {yTop: -13.5, yBottom: -22.5, cTop: 0.32, cBottom: 0.5},
    {yTop: -22.5, yBottom: -36.5, cTop: 0.5, cBottom: 0.8},
  ];
  const floorY = o.floorY ?? Math.min(-36, zonesIn[zonesIn.length - 1].yBottom + 0.5);
  // walkway tier k (level k + 1) inside zone k, default 4 m below its top; the core floor last
  const decks = o.decks ?? zonesIn.map(z => z.yTop - Math.min(4, (z.yTop - z.yBottom) / 2));
  const tiers: ReactorTier[] = [{level: 0, index: 0, role: 'rim', label: 'Rim', baseY: 0, zone: -1, color: 0xc8a030}];
  zonesIn.forEach((_z, k) => tiers.push({level: k + 1, index: k + 1, role: k === 0 ? 'upper' : 'middle', label: `Tier ${k + 1}`, baseY: decks[k], zone: k, color: 0x40a0c0}));
  tiers.push({level: zonesIn.length + 1, index: zonesIn.length + 1, role: 'core', label: 'Core floor', baseY: floorY, zone: zonesIn.length - 1, color: 0xc04040});
  const zones: ReactorZone[] = zonesIn.map((z, k) => ({id: k, ...z, levels: [k + 1], generator: k, fans: [2 * k, 2 * k + 1]}));
  const generators: ReactorGenerator[] = zonesIn.map((_, k) => {
    const y = k === 0 ? 0 : decks[k - 1], x = 24, zc = 26 + 9 * k;
    return {
      id: k, zone: k, level: k, area: 0, x, z: zc, y, yaw: 0, size: {w: 3, d: 1.6, h: 2},
      use: {x, z: zc + 2, yaw: 0, level: k}, panel: {x, y: y + 1.2, z: zc + 0.85},
      cable: [{x, y: y + 2, z: zc}, {x: 20, y: (zonesIn[k].yTop + zonesIn[k].yBottom) / 2, z: zc}],
    };
  });
  const fans: ReactorFan[] = zonesIn.flatMap((z, k) => [0, 1].map(j => ({id: 2 * k + j, zone: k, level: k + 1, x: j ? 60 : 20, y: (z.yTop + z.yBottom) / 2, z: 40, nx: j ? -1 : 1, nz: 0, radius: 1.8})));
  return {
    version: 1, name: 'Reactor',
    pit: {outline: [{x: 20, z: 20}, {x: 60, z: 20}, {x: 60, z: 60}, {x: 20, z: 60}], bounds: {x0: 20, z0: 20, x1: 60, z1: 60}, cx: 40, cz: 40, rimY: 0, floorY, roofY: 14, variant: 'fixture'},
    tiers, zones, generators, fans, sites: [], components: [], screens: [], decks: [], towers: [],
    crane: {axis: 'x', railY: 12, a0: 20, a1: 60, b0: 24, b1: 56, bridgeAt: 40, trolleyAt: 40, hookY: 4},
    pipeBanks: [], core: {x: 40, z: 40, radius: 6, y0: floorY, y1: floorY + 9}, markers: [],
    start: {x: 30, z: 10, yaw: 0, level: 0},
    arrival: {platform: 0, trench: 0, track: 0, axis: 'x', stop0: 0, stop1: 60, doorSide: 'N', maxLength: 60},
    routes: [],
  };
}

/** A layout carrying `reactor` (or not): one open 80 x 80 m grid shared by every level (levels at the tiers' deck heights). */
export function fixtureLayout(info: ReactorInfo | null = fixtureInfo()): StationLayout {
  const g = new Grid(160, 160);
  for (let i = 0; i < g.cells.length; i++) { g.cells[i] = FLOOR; g.ceil[i] = 3; }
  const bases = info ? info.tiers.map(t => t.baseY) : [0];
  return {
    grid: g, levels: bases.map((b, i) => ({id: i, role: i ? 'upper' : 'main', grid: g, baseY: b})), props: [], areas: [], zombies: [], pickups: [], seed: 1,
    ...(info ? {reactor: info} : {}),
  } as unknown as StationLayout;
}
