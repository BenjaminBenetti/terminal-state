// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): a SYNTHETIC Surface Run district for the gas parity tests
// (tests/surface-gas*.test.ts) — small (60 x 42 m), two storeys, the contract's shapes exactly (gen/surface/surfaceTypes.ts; facade
// ring = 1 SOLID cell, doorway cells carved in the ring with the interior's area, window spans IN the ring), plus a fake Game holding the
// REAL gas system (world/gas/system.ts), the REAL Surface air runtime (world/surface/air.ts) and a REAL VolumetricAtmosphere's gas
// layers / column map:
//  - B0 x 6..24, z 6..20: two storeys (levels 0 + 1), a CLOSED street door on its south facade, intact / cracked / boarded panes north;
//  - B1 x 32..50, z 6..20: one storey, a CLOSED door, a GEN 'broken' pane column north (pre-breached at the first build);
//  - B2 x 32..50, z 26..38: one storey, a SMASHED doorway north (a permanent opening);
//  - the command tent x 6..13, z 26..32 (canvas ring, a 3-cell doorway east), the street everywhere else (outdoor area 0).
import {vi} from 'vitest';
import * as THREE from 'three';
import {CELL, FLOOR, Grid} from '../../src/gen/grid';
import {levelsOf} from '../../src/gen/levels';
import {PropIndex} from '../../src/core/physics';
import type {Area, StationLayout} from '../../src/gen/stationTypes';
import type {SurfaceBuilding, SurfaceEntrance, SurfaceInfo, SurfaceWindowSpan, SRect} from '../../src/gen/surface/surfaceTypes';
import type {WorldHit} from '../../src/combat/hitscan';
import type {WorldMaterials} from '../../src/world/materials';
import {installGas, type GasHost, type GasSystem} from '../../src/world/gas/system';
import {installSurfaceAir, type SurfaceAirRuntime} from '../../src/world/surface/air';
import {VolumetricAtmosphere} from '../../src/render/volumetric';
import {TRUCK_SPEC} from '../../src/world/surface/truckSpec';

export const SA_W = 120, SA_H = 84;
export const SA_Y = {street: 0, upper: 3.5, ceil0: 3.2, ceil1: 6.6, sky: 40} as const;
export const SA_B0: SRect = {x0: 6, z0: 6, x1: 24, z1: 20};
export const SA_B1: SRect = {x0: 32, z0: 6, x1: 50, z1: 20};
export const SA_B2: SRect = {x0: 32, z0: 26, x1: 50, z1: 38};
export const SA_TENT: SRect = {x0: 6, z0: 26, x1: 13, z1: 32};
/** Street points (outdoors), interior points of each building (level 0), B0's upper storey. */
export const SA_AT = {street: {x: 28, z: 23}, b0: {x: 15, z: 13}, b0door: {x: 15, z: 18.6}, b1: {x: 41, z: 13}, b2: {x: 41, z: 32}, tent: {x: 9.5, z: 29}} as const;

const cellOf = (m: number) => Math.round(m / CELL);

export function surfaceAirFixture(): StationLayout {
  const levels = [0, 1].map(id => ({id, role: (id === 0 ? 'main' : 'upper') as 'main' | 'upper', grid: new Grid(SA_W, SA_H), baseY: id === 0 ? SA_Y.street : SA_Y.upper}));
  const areas: Area[] = [];
  const area = (type: string, kind: string, level: number, r: SRect, ceil: number, floorY: number): number => {
    const id = areas.length;
    areas.push({id, kind, type, label: `${type} ${id}`, ceil, parent: -1, depth: 0, publicSpace: true, lighting: 'lit',
      x: cellOf(r.x0), y: cellOf(r.z0), w: cellOf(r.x1) - cellOf(r.x0), h: cellOf(r.z1) - cellOf(r.z0), level, floorY} as unknown as Area);
    return id;
  };
  const fill = (lv: number, r: SRect, cell: number, a: number, floor: number, ceil: number) => {
    const g = levels[lv].grid;
    for (let y = cellOf(r.z0); y < cellOf(r.z1); y++) for (let x = cellOf(r.x0); x < cellOf(r.x1); x++) {
      const i = g.idx(x, y);
      g.cells[i] = cell; g.area[i] = a; g.floor[i] = floor; g.ceil[i] = ceil;
    }
  };
  const inner = (r: SRect): SRect => ({x0: r.x0 + CELL, z0: r.z0 + CELL, x1: r.x1 - CELL, z1: r.z1 - CELL});
  const street = area('street', 'concourse', 0, {x0: 0, z0: 0, x1: SA_W * CELL, z1: SA_H * CELL}, SA_Y.sky, 0);
  fill(0, {x0: CELL, z0: CELL, x1: (SA_W - 1) * CELL, z1: (SA_H - 1) * CELL}, FLOOR, street, 0, SA_Y.sky);
  // the footprints: SOLID (ring + everything), then each interior
  for (const r of [SA_B0, SA_B1, SA_B2, SA_TENT]) fill(0, r, 0, -1, 0, 0);
  const r0 = area('shop', 'room', 0, inner(SA_B0), SA_Y.ceil0, 0), r1 = area('office', 'room', 1, inner(SA_B0), SA_Y.ceil1, SA_Y.upper);
  const r2 = area('shop', 'room', 0, inner(SA_B1), SA_Y.ceil0, 0), r3 = area('shop', 'room', 0, inner(SA_B2), SA_Y.ceil0, 0);
  const tentA = area('room', 'room', 0, inner(SA_TENT), 2.6, 0);
  fill(0, inner(SA_B0), FLOOR, r0, 0, SA_Y.ceil0);
  fill(1, inner(SA_B0), FLOOR, r1, SA_Y.upper, SA_Y.ceil1);
  fill(0, inner(SA_B1), FLOOR, r2, 0, SA_Y.ceil0);
  fill(0, inner(SA_B2), FLOOR, r3, 0, SA_Y.ceil0);
  fill(0, inner(SA_TENT), FLOOR, tentA, 0, 2.6);
  const g0 = levels[0].grid;
  // doorways: ring cells carved FLOOR with the interior's area (GEN's rule)
  const doorway = (id: string, b: number, side: 'N' | 'S', x0: number, x1: number, zFace: number, a: number, door: SurfaceEntrance['door']): SurfaceEntrance => {
    const row = side === 'S' ? cellOf(zFace) - 1 : cellOf(zFace);
    const cells: number[] = [];
    for (let x = cellOf(x0); x < cellOf(x1); x++) { const i = g0.idx(x, row); if (door !== 'boarded') { g0.cells[i] = FLOOR; g0.area[i] = a; g0.floor[i] = 0; g0.ceil[i] = 2.6; } cells.push(i); }
    return {id, building: b, level: 0, x: (x0 + x1) / 2, z: zFace, side, width: x1 - x0, height: 2.6, inner: a, outer: street, door, cells};
  };
  const e0 = doorway('b0-e0', 0, 'S', 14, 16, SA_B0.z1, r0, 'closed');
  const e1 = doorway('b1-e0', 1, 'S', 40, 42, SA_B1.z1, r2, 'closed');
  const e2 = doorway('b2-e0', 2, 'N', 40, 42, SA_B2.z0, r3, 'smashed');
  // the tent's doorway: 3 ring cells on its east wall
  for (let y = 57; y < 60; y++) { const i = g0.idx(25, y); g0.cells[i] = FLOOR; g0.area[i] = tentA; g0.floor[i] = 0; g0.ceil[i] = 2.1; }
  const span = (id: string, b: number, level: number, x0: number, x1: number, z0: number, panes: SurfaceWindowSpan['panes'], room: number): SurfaceWindowSpan =>
    ({id, building: b, level, x0, z0, x1, z1: z0 + CELL, side: 'N', sill: 0.9, head: 2.4, panes, room});
  const windows: SurfaceWindowSpan[] = [
    span('w0', 0, 0, 9, 13, SA_B0.z0, ['intact', 'cracked', 'boarded'], r0),
    span('w1', 0, 1, 9, 13, SA_B0.z0, ['intact', 'intact'], r1),
    span('w2', 1, 0, 37, 43, SA_B1.z0, ['intact', 'broken', 'intact'], r2),
  ];
  const bld = (id: number, footprint: SRect, height: number, lv: number[], ar: number[], ents: SurfaceEntrance[], wins: string[]): SurfaceBuilding =>
    ({id, block: 0, kind: 'shop', programme: 'grocery', name: `B${id}`, footprint, storeys: lv.length, height, facade: 'brick', condition: 'damaged',
      enterable: true, destination: true, levels: lv, areas: ar, entrances: ents, windows: wins} as unknown as SurfaceBuilding);
  const surface = {
    v: 1, name: 'Fixture Heights', host: 'subway', seed: 4242, extent: {x0: 0, z0: 0, x1: SA_W * CELL, z1: SA_H * CELL}, core: {x0: 0, z0: 0, x1: SA_W * CELL, z1: SA_H * CELL},
    cols: 1, rows: 1, blocks: [], streets: [],
    buildings: [bld(0, SA_B0, 7.4, [0, 1], [r0, r1], [e0], ['w0', 'w1']), bld(1, SA_B1, 4.2, [0], [r2], [e1], ['w2']), bld(2, SA_B2, 4.2, [0], [r3], [e2], [])],
    windows, outdoorAreas: [street],
    portal: {kind: 'stair', pose: {x: 28, z: 23, yaw: 0, level: 0, y: 0}, trigger: {x0: 27, x1: 29, z0: 22, z1: 24, y0: 0, y1: 2.5}, building: null, label: 'Back down'},
    checkpoint: {area: street, rect: {x0: 4, z0: 24, x1: 16, z1: 34}, tent: {rect: SA_TENT, area: tentA, door: {x: 12.75, z: 29.25, side: 'E'}}, mapTable: {prop: -1, read: {x: 9, z: 28, yaw: 0, level: 0, y: 0}}},
    truck: {x: 28, z: 30, yaw: 0, level: 0, y: 0}, depot: {building: 1, recoverables: []},
    outdoor: {areas: [street], spawnZones: [], safe: {x0: 0, z0: 0, x1: 1, z1: 1}}, notes: [],
    storeys: [{level: 0, label: 'Street', y: 0}, {level: 1, label: 'Upper floor', y: SA_Y.upper}],
  } as unknown as SurfaceInfo;
  return {
    seed: 4242, attempt: 0, name: 'Surface fixture', archetype: 'side-mezzanine', towards: ['', ''], grid: g0, areas, doors: [], props: [], lights: [], signs: [], pickups: [],
    zombies: [], storefronts: [], decor: [], playerSpawn: {x: 28, z: 23, yaw: 0}, trench: {x0: 0, x1: 0, z0: 0, z1: 0, floorY: 0, platformX0: 0, platformX1: 0, tracks: [], third: [], columns: false, ceil: 0},
    trenches: [], platform: street, platforms: [street], levels, levelLinks: [], rails: [], surface,
  } as unknown as StationLayout;
}

export type SurfaceZombie = {brain: {x: number; z: number; y: number; alive: boolean; stats: {radius: number}}; ragdolled?: boolean};

/** A fake Game: the gas system, then the Surface air runtime (install order as in game.ts), a lane store, a real atmosphere. */
export function surfaceAirGame(L: StationLayout, mats: WorldMaterials, o: {active?: boolean; store?: Map<string, unknown>; at?: {x: number; z: number}; tentFlap?: (open: number) => void} = {}) {
  const store = o.store ?? new Map<string, unknown>();
  const atmo = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
  atmo.setStation(L, null);
  const levels = levelsOf(L as never);
  let clock = 0;
  const at = o.at ?? SA_AT.street;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050607, 0.03);
  const camera = new THREE.PerspectiveCamera();
  // (follow-up 1) the vehicle controller's seat / enclosure / body / spec (the REAL truck spec: its measured cab interior and seated eye,
  // world/surface/truckAnchors.generated.ts, in the vehicle's own frame)
  const car = {driving: false, enclosed: true as boolean | undefined,
    body: null as {x: number; y: number; z: number; yaw: number; pitch?: number} | null, spec: TRUCK_SPEC};
  const h = {
    scene, camera, mats, layout: L, levels, world: {culler: {register: vi.fn()}},
    player: {x: at.x, z: at.z, y: 0, eye: 1.6, yaw: 0, radius: 0.3, alive: true, takeDamage: vi.fn()},
    zombies: [] as SurfaceZombie[],
    warmRegistry: {addPool: vi.fn()}, tower: {office: null},
    atmosphere: {
      active: o.active ?? true, markShadows: vi.fn(),
      setGasLayer: (s: number, f: ArrayLike<number>, r: {x0: number; y0: number; w: number; h: number}) => atmo.setGasLayer(s, f, r),
      setGasFallback: (c: number) => atmo.setGasFallback(c),
      setCabSource: (src: Parameters<VolumetricAtmosphere['setCabSource']>[0]) => atmo.setCabSource(src),
    },
    skywaysCar: car,
    sfx: {impact: vi.fn(), breakage: vi.fn()}, fx: {impact: vi.fn()}, damage: {burst: vi.fn(() => 3)}, hud: {toast: vi.fn()}, physics: {propsChanged: vi.fn()},
    propIndex: new PropIndex(levels, L.props),
    run: {laneStore: (k: string) => store.get(k), setLaneStore: (k: string, v: unknown) => { if (v === undefined) store.delete(k); else store.set(k, structuredClone(v)); }},
    get clock() { return clock; }, set clock(v: number) { clock = v; },
    state: 'playing', frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[], stateListeners: [] as ((s: never, p: never) => void)[],
    interactHandlers: [] as (() => boolean)[], promptProviders: [] as (() => string | null)[],
    bulletHitHandlers: [] as ((wh: WorldHit, p: THREE.Vector3, d: THREE.Vector3, shot: number, damage: number) => boolean)[],
    gas: null as unknown as GasSystem,
  };
  const sys: GasSystem = installGas(h as unknown as GasHost);
  h.gas = sys;
  const air: SurfaceAirRuntime = installSurfaceAir(h as never);
  if (o.tentFlap) air.tentFlap = o.tentFlap; // (the architecture's own flap object, set before the section build)
  const place = (x: number, z: number, level = 0, yaw = h.player.yaw) => {
    const y = L.levels[level].baseY;
    Object.assign(h.player, {x, z, y, eye: y + 1.6, yaw});
    camera.position.set(x, y + 1.6, z);
    camera.updateMatrixWorld(true);
  };
  place(at.x, at.z);
  const build = () => { for (const s of h.sectionHooks) s.build?.(L); };
  const teardown = () => { for (const s of h.sectionHooks) s.teardown?.(); };
  const step = (seconds: number, dt = 0.1) => { for (let t = 0; t < seconds - 1e-9; t += dt) { clock += dt; for (const f of h.frameHooks) f(dt); } };
  /** The player's eye at (x, z) on `level` (or at absolute eye height `eyeY`), one zero-dt frame: this frame's exposure. */
  const eyeAt = (x: number, z: number, level = 0, eyeY?: number) => {
    place(x, z, level);
    if (eyeY !== undefined) { h.player.eye = eyeY; h.player.y = eyeY - 1.6; camera.position.y = eyeY; camera.updateMatrixWorld(true); }
    for (const f of h.frameHooks) f(0);
    return sys.exposure;
  };
  build();
  return {h, sys, air, atmo, store, build, teardown, step, eyeAt, place, levels, car};
}
