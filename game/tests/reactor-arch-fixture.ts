// Task reactor-build-20261101 (lane ARCH): a hand-built B-like ReactorInfo for the ARCH kit tests (lane GEN builds the real generator
// in parallel). Not a test file (no .test.ts suffix). Pit 44 x 36 m (x 20..64, z 20..56), rim 0, tiers -10 / -20 / -31, core floor
// -48, roof 14: west-wall galleries + a generator landing, a bridge across at tier 2, a tower deck, two lattice towers, the crane,
// an organ pipe bank on the east wall, four fans on the south wall, three generators, the vessel, tier bands, three restart sites
// (switchgear / pump hall / control room) and the pit status board.
import type {ReactorInfo} from '../src/gen/reactor/reactorTypes';

export const ARCH_FIX = {pit: {x0: 20, z0: 20, x1: 64, z1: 56}, tiers: [0, -10, -20, -31, -48], roofY: 14} as const;

export function archFixtureInfo(): ReactorInfo {
  const [rim, t1, t2, t3, core] = ARCH_FIX.tiers;
  const colors = [0xc8a030, 0x3f8fbf, 0x4fa04a, 0xc07a30, 0xb83a3a];
  const labels = ['Rim', 'Tier 1', 'Tier 2', 'Tier 3', 'Core floor'];
  const roles = ['rim', 'upper', 'middle', 'deep', 'core'] as const;
  const tiers = ARCH_FIX.tiers.map((y, i) => ({level: i, index: i, role: roles[i], label: labels[i], baseY: y, zone: i - 1, color: colors[i]}));
  const zones = [0, 1, 2].map(k => ({id: k, yTop: ARCH_FIX.tiers[k] - 2, yBottom: ARCH_FIX.tiers[k + 1] - 2, cTop: 0.15 + 0.15 * k, cBottom: 0.3 + 0.2 * k, levels: [k + 1], generator: k, fans: k < 2 ? [2 * k, 2 * k + 1] : []}));
  const gen = (id: number, x: number, z: number, y: number) => ({
    id, zone: id, level: id, area: 0, x, z, y, yaw: Math.PI / 2, size: {w: 4.4, d: 1.8, h: 2.4},
    use: {x: x + 2.2, z, yaw: Math.PI / 2, level: id}, panel: {x: x + 1.05, y: y + 1.2, z: z + 1.2},
    cable: [{x: x, y: y + 2.6, z}, {x: x, y: y + 2.6, z: 54}, {x: 30, y: y - 4, z: 55.6}],
  });
  return {
    version: 1, name: 'Reactor',
    pit: {outline: [{x: 20, z: 20}, {x: 64, z: 20}, {x: 64, z: 56}, {x: 20, z: 56}], bounds: {...ARCH_FIX.pit}, cx: 42, cz: 38, rimY: rim, floorY: core, roofY: ARCH_FIX.roofY, variant: 'fixture-b'},
    tiers, zones,
    generators: [gen(0, 23, 27, t1), gen(1, 23, 40, t2), gen(2, 23, 30, t3)],
    fans: [0, 1, 2, 3].map(i => ({id: i, zone: i >> 1, level: (i >> 1) + 1, x: 34 + (i & 1) * 14, y: (i >> 1 ? -26 : -15), z: 56, nx: 0, nz: -1, radius: 1.4})),
    sites: [
      {id: 'switchgear', level: 2, area: 1, rect: {x0: 8, z0: 30, x1: 18, z1: 42}, controls: [
        {id: 'fuse-0', at: {x: 17.4, y: t2 + 1.2, z: 33}, stand: {x: 16.2, z: 33, yaw: 0, level: 2}, yaw: -Math.PI / 2},
        {id: 'fuse-1', at: {x: 17.4, y: t2 + 1.2, z: 34.2}, stand: {x: 16.2, z: 34.2, yaw: 0, level: 2}, yaw: -Math.PI / 2},
        {id: 'breaker', at: {x: 17.4, y: t2 + 1.2, z: 35.4}, stand: {x: 16.2, z: 35.4, yaw: 0, level: 2}, yaw: -Math.PI / 2},
      ]},
      {id: 'pumpHall', level: 3, area: 2, rect: {x0: 66, z0: 28, x1: 82, z1: 44}, controls: [
        {id: 'valve', at: {x: 81.3, y: t3 + 1.1, z: 31}, stand: {x: 80, z: 31, yaw: 0, level: 3}, yaw: Math.PI / 2},
        {id: 'pump', at: {x: 81, y: t3 + 0.9, z: 38}, stand: {x: 79.4, z: 38, yaw: 0, level: 3}, yaw: Math.PI / 2},
      ]},
      {id: 'control', level: 4, area: 3, rect: {x0: 6, z0: 40, x1: 18, z1: 52}, controls: [
        {id: 'rods', at: {x: 6.6, y: core + 1.0, z: 45}, stand: {x: 8, z: 45, yaw: 0, level: 4}, yaw: -Math.PI / 2},
        {id: 'keyswitch', at: {x: 6.6, y: core + 1.0, z: 47.5}, stand: {x: 8, z: 47.5, yaw: 0, level: 4}, yaw: -Math.PI / 2},
      ]},
    ],
    components: [],
    screens: [
      {id: 'pitBoard', level: 0, x: 30, y: 1.9, z: 19.95, yaw: Math.PI, w: 2.4, h: 1.2},
      {id: 'controlMonitor', level: 4, x: 6.5, y: core + 1.6, z: 50, yaw: -Math.PI / 2, w: 1.0, h: 0.7},
    ],
    decks: [
      ...[t1, t2, t3].map((y, i) => ({kind: 'gallery' as const, level: i + 1, rect: {x0: 20, z0: 22, x1: 24, z1: 54}, y})),
      {kind: 'landing', level: 1, rect: {x0: 20, z0: 24, x1: 28, z1: 31}, y: t1},
      {kind: 'bridge', level: 2, rect: {x0: 24, z0: 36.5, x1: 64, z1: 39}, y: t2},
      {kind: 'tower', level: 3, rect: {x0: 40, z0: 44, x1: 46, z1: 50}, y: t3},
      {kind: 'stair-landing', level: 1, rect: {x0: 20, z0: 50, x1: 23, z1: 53}, y: -5},
      {kind: 'gallery', level: 0, rect: {x0: 20, z0: 20, x1: 64, z1: 23}, y: rim},
    ],
    towers: [{x: 43, z: 47, hx: 2.5, hz: 2.5, y0: core, y1: 10}, {x: 54, z: 30, hx: 2, hz: 2, y0: core, y1: t2}],
    crane: {axis: 'x', railY: 11, a0: 21, a1: 63, b0: 22, b1: 54, bridgeAt: 38, trolleyAt: 40, hookY: -6},
    pipeBanks: [{x0: 64, z0: 26, x1: 64, z1: 48, nx: -1, nz: 0, y0: core, y1: 12, depth: 1.6}],
    core: {x: 42, z: 38, radius: 7, y0: core, y1: core + 12},
    markers: tiers.slice(1).map(t => ({level: t.level, y0: t.baseY + 3, y1: t.baseY + 3.8, color: t.color, text: `${t.label.toUpperCase()}  ${t.baseY} M`})),
    start: {x: 30, z: 10, yaw: 0, level: 0},
    arrival: {platform: 0, trench: 0, track: 0, axis: 'x', stop0: 10, stop1: 60, doorSide: 'N', maxLength: 60},
    routes: [],
  };
}
