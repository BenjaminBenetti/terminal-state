// Task reactor-build-20261101 (lane RESTART): hand-built ReactorInfo + a fake Game host for the restart tests (lane GEN builds the
// real generator in parallel; these tests never depend on it).

import * as THREE from 'three';
import type {ReactorControl, ReactorInfo, ReactorScreen} from '../../src/gen/reactor/reactorTypes';
import type {StationLayout} from '../../src/gen/stationTypes';
import {Inventory} from '../../src/items/inventory';
import {RunState} from '../../src/run/runState';
import type {LevelSeeds} from '../../src/run/runState';
import {ReactorRestart, type RestartHost} from '../../src/world/reactor/restart';

/** A control `id` at (x, y, z) on a wall whose room side is +z; the stand point 1.0 m in front. */
const ctl = (id: string, x: number, y: number, z: number, level: number): ReactorControl => ({id, at: {x, y, z}, stand: {x, z: z + 1.0, yaw: 0, level}, yaw: Math.PI});
const screen = (id: ReactorScreen['id'], x: number, y: number, z: number, level: number): ReactorScreen => ({id, level, x, y, z, yaw: Math.PI, w: 1.6, h: 1.0});

/** Rim (level 0, y 0), Tier 1 (level 1, -8), Tier 2 (level 2, -16: switchgear + pump hall), Core floor (level 3, -24: control room). */
export function reactorInfoFixture(): ReactorInfo {
  return {
    version: 1, name: 'Reactor',
    pit: {outline: [{x: 0, z: 0}, {x: 40, z: 0}, {x: 40, z: 40}, {x: 0, z: 40}], bounds: {x0: 0, z0: 0, x1: 40, z1: 40}, cx: 20, cz: 20, rimY: 0, floorY: -24, roofY: 14, variant: 'test'},
    tiers: [
      {level: 0, index: 0, role: 'rim', label: 'Rim', baseY: 0, zone: -1, color: 0xc9a227},
      {level: 1, index: 1, role: 'upper', label: 'Tier 1', baseY: -8, zone: 0, color: 0x2f7fbf},
      {level: 2, index: 2, role: 'deep', label: 'Tier 2', baseY: -16, zone: 1, color: 0xbf5a2f},
      {level: 3, index: 3, role: 'core', label: 'Core floor', baseY: -24, zone: 1, color: 0x7f2fbf},
    ],
    zones: [
      {id: 0, yTop: -4, yBottom: -12, cTop: 0.1, cBottom: 0.3, levels: [1], generator: 0, fans: [0]},
      {id: 1, yTop: -12, yBottom: -26, cTop: 0.3, cBottom: 0.6, levels: [2, 3], generator: 1, fans: [1, 2, 3]},
    ],
    generators: [
      {id: 0, zone: 0, level: 0, area: 0, x: 5, z: 5, y: 0, yaw: 0, size: {w: 5, d: 1.6, h: 2.4}, use: {x: 5, z: 7, yaw: 0, level: 0}, panel: {x: 5, y: 1.2, z: 6}, cable: []},
      {id: 1, zone: 1, level: 1, area: 0, x: 5, z: 5, y: -8, yaw: 0, size: {w: 5, d: 1.6, h: 2.4}, use: {x: 5, z: 7, yaw: 0, level: 1}, panel: {x: 5, y: -6.8, z: 6}, cable: []},
    ],
    fans: [
      {id: 0, zone: 0, level: 1, x: 0.5, y: -6, z: 20, nx: 1, nz: 0, radius: 1.2},
      {id: 1, zone: 1, level: 2, x: 0.5, y: -14, z: 20, nx: 1, nz: 0, radius: 1.2},
      {id: 2, zone: 1, level: 3, x: 0.5, y: -22, z: 20, nx: 1, nz: 0, radius: 1.2},
      {id: 3, zone: 1, level: 3, x: 39.5, y: -22, z: 20, nx: -1, nz: 0, radius: 1.2},
    ],
    sites: [
      {id: 'rimOffice', level: 0, area: 1, rect: {x0: 2, z0: 2, x1: 8, z1: 8}, controls: [{id: 'statusBoard', at: {x: 3, y: 1.5, z: 2}, stand: {x: 3, z: 3, yaw: 0, level: 0}, yaw: Math.PI}]},
      {id: 'switchgear', level: 2, area: 2, rect: {x0: 10, z0: 2, x1: 16, z1: 8}, controls: [ctl('fuse-0', 11, -14.6, 2, 2), ctl('fuse-1', 13, -14.6, 2, 2), ctl('breaker', 15, -14.7, 2, 2)]},
      {id: 'pumpHall', level: 2, area: 3, rect: {x0: 20, z0: 2, x1: 28, z1: 8}, controls: [ctl('valve', 22, -15, 2, 2), ctl('pump', 26, -14.8, 2, 2)]},
      {id: 'control', level: 3, area: 4, rect: {x0: 10, z0: 30, x1: 18, z1: 36}, controls: [ctl('keyswitch', 12, -22.9, 30, 3), ctl('rods', 15, -22.8, 30, 3)]},
    ],
    components: [
      // task reactor-surface-ending-20261102 (lane OBJECTIVES): the key lies in the core floor's control room (was the rim office)
      {item: 'reactor_key', pickup: 0, level: 3, area: 4, where: 'Control room · Core floor'},
      {item: 'fuse_cartridge', pickup: 1, level: 2, area: 5, where: 'Tier 2 stores'},
      {item: 'fuse_cartridge', pickup: 2, level: 2, area: 5, where: 'Tier 2 stores'},
    ],
    screens: [screen('pitBoard', 6, 1.6, 2, 0), screen('switchgearBoard', 14, -14.2, 2, 2), screen('pumpBoard', 24, -14.2, 2, 2), screen('controlMonitor', 16, -22.4, 30, 3)],
    decks: [], towers: [],
    crane: {axis: 'x', railY: 12, a0: 0, a1: 40, b0: 5, b1: 35, bridgeAt: 20, trolleyAt: 20, hookY: 0},
    pipeBanks: [], core: {x: 20, z: 20, radius: 7, y0: -24, y1: -14}, markers: [],
    start: {x: 4, z: 4, yaw: 0, level: 0},
    arrival: {platform: 0, trench: 0, track: 0, axis: 'x', stop0: 0, stop1: 40, doorSide: 'N', maxLength: 60},
    routes: [],
  };
}

/** A minimal StationLayout around the info (the runtime reads layout.reactor / levels / grid / seed only). */
export function reactorLayoutFixture(info: ReactorInfo = reactorInfoFixture()): StationLayout {
  return {reactor: info, levels: [], seed: 0x5eed} as unknown as StationLayout;
}

export interface FakeHost extends RestartHost {
  keys: Set<string>;
  toasts: {text: string; warn: boolean}[];
  ring: (number | null)[];
  clockS: number;
  hits: ((hit: never) => void)[];
  wall: boolean;
  zombieAt: {x: number; z: number; y: number} | null;
  run: RunState;
  inv: Inventory;
  lightPool: {circuitLevel: [number | null, number | null, number | null] | null};
  layout: StationLayout;
}

export function newRun(): RunState {
  return new RunState({seeds: {subway: 1, office: 2, mall: 3, reactor: 0x7ea} as unknown as LevelSeeds, start: {level: 'reactor' as never, section: 'main'}});
}

/** A fake Game host: real Inventory / RunState, a camera, scripted keys / walls / zombies, captured toasts and hold ring. */
export function fakeHost(run: RunState = newRun(), inv: Inventory = new Inventory()): FakeHost {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  const h: FakeHost = {
    scene: new THREE.Scene(), camera, player: {x: 0, y: 0, z: 0, alive: true, climbing: false}, zombies: [],
    levels: {
      raycast: () => (h.wall ? {kind: 'wall', t: 0.4} : {kind: 'none', t: Infinity}),
      levelAt: () => 2,
    },
    layout: reactorLayoutFixture(), inv, keys: new Set(),
    input: {down: (c: string) => h.keys.has(c), clears: 0},
    toasts: [], ring: [],
    hud: {toast: (text: string, warn = false) => { h.toasts.push({text, warn}); }, setHoldRing: (p: number | null) => { h.ring.push(p); }},
    sfx: null, run, clockS: 100,
    get clock() { return h.clockS; },
    state: 'playing', lightPool: {circuitLevel: null},
    interactHandlers: [], frameHooks: [], sectionHooks: [], promptProviders: [], stateListeners: [], inputOwners: [], hitListeners: [], hits: [],
    warmRegistry: {addPool: () => {}}, world: null, wall: false, zombieAt: null,
  };
  h.hits = h.hitListeners as never;
  return h;
}

/** Stand at a control's stand pose (eye 1.6 m above its floor) and look at it. */
export function aimAt(h: FakeHost, rt: ReactorRestart, id: string): void {
  const e = rt.controls.find(x => x.id === id);
  if (!e) throw new Error(`no control ${id}`);
  // task reactor-expansion-20261101 (lane CONTROLS): the pick volume is the control mounted ON its host face (e.m.pick), not c.at
  const p = e.m.pick;
  h.player.x = e.c.stand.x; h.player.z = e.c.stand.z; h.player.y = e.c.at.y - 1.2;
  h.camera.position.set(e.c.stand.x, e.c.at.y + 0.1, e.c.stand.z);
  h.camera.lookAt(p.x, p.y, p.z);
  h.camera.updateMatrixWorld(true);
}

/** Install + build the runtime on the fake host (a fresh world). */
export function buildRestart(h: FakeHost): ReactorRestart {
  const rt = new ReactorRestart(h).install();
  rt.recordMilestone = () => true;
  for (const s of h.sectionHooks) s.build?.(h.layout);
  return rt;
}
