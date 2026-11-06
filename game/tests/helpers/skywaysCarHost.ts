// Task studio-skyways-level-20261106-054448 (lane CAR): a Node host for the prize car's system tests (no browser / renderer): the REAL
// Player and ZombieBrain, the car installed exactly like Game (registries; E handler + prompt first), fakes for what other lanes own
// (dynamicItems shove calls, the damage system's prop hits, the gas system's panes, Game.blastKill's bookkeeping, the run's lane store),
// and frame() in Game.update's order: E -> interact handlers; the player slot (the car's stepPlayer while driving, else Player.update);
// the lane frame hooks (after the zombies); the camera.
import * as THREE from 'three';
import {Player} from '../../src/player/player';
import {ZombieBrain} from '../../src/ai/brain';
import {WarmupRegistry} from '../../src/render/warmup';
import type {Levels} from '../../src/gen/levels';
import type {PropPlacement} from '../../src/gen/props';
import type {SkywaysCarSpawn} from '../../src/gen/skyways/skywaysTypes';
import {PropIndex} from '../../src/core/physics';
import {SkywaysCar, type DriveInput, type SkywaysCarHost} from '../../src/world/skywaysCar';
import type {PaneRef} from '../../src/world/windowBreach';
import {hallLevels} from './skywaysCarWorld';

export const DT = 1 / 60;

export class DriveKeys implements DriveInput {
  held = new Set<string>();
  hits = new Set<string>();
  mousePressed = [false, false, false];
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.hits.has(c); }
}

export interface TestZombie { brain: ZombieBrain; ragdolled: boolean; root: THREE.Object3D; syncTransform(): void }

export function zombie(x: number, z: number, y = 0): TestZombie {
  const brain = new ZombieBrain('shambler', x, z, 0);
  brain.y = y;
  const root = new THREE.Object3D();
  return {brain, ragdolled: false, root, syncTransform() { root.position.set(brain.x, 0, brain.z); }};
}

export interface FakePane { id: string; level: number; along: 'x' | 'z'; glass: number; a0: number; a1: number; y0: number; y1: number }

/** Minimal PaneRefs for the gas system's window index (what the car reads: plan.level / along / glass, pane span / heights). */
export function paneRefs(list: FakePane[]): Map<string, PaneRef> {
  return new Map(list.map(p => [p.id, {id: p.id, plan: {level: p.level, along: p.along, glass: p.glass, n: [0, -1], panes: []}, pane: {a0: p.a0, a1: p.a1, y0: p.y0, y1: p.y1}} as unknown as PaneRef]));
}

export interface CarTestHost extends SkywaysCarHost {
  player: Player;
  keys: DriveKeys;
  zombies: TestZombie[];
  toasts: string[];
  sfxCalls: string[];
  /** (lane CAR2) Every per-frame carEngine call (speed01, throttle01) since the last engine start. */
  engineLog: {k: number; th: number}[];
  store: Map<string, unknown>;
  kills: {z: TestZombie; dir: THREE.Vector3; point: THREE.Vector3}[];
  shoves: {prop: PropPlacement; index: number; impulse: number; t: number}[];
  propHits: {prop: number; damage: number}[];
  broken: string[];
  windows: Map<string, PaneRef>;
  frameNo: number;
  inputOwners: (() => boolean)[];
  promptProviders: (() => string | null)[];
  stateListeners: ((s: never, p: never) => void)[];
  gear: {placeRules: ((x: number, y: number, z: number, level: number) => string | null)[]};
}

/** A hall world with the car spawned (the build hooks run); `props` go into layout.props and the PropIndex. */
export function carHost(o: {spawn?: Partial<SkywaysCarSpawn>; props?: PropPlacement[]; levels?: Levels; panes?: FakePane[]; build?: boolean} = {}) {
  const levels = o.levels ?? hallLevels();
  const props = o.props ?? [];
  const spawn: SkywaysCarSpawn = {x: 15, y: 0, z: 15, yaw: 0, level: 0, area: 0, ...o.spawn};
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const store = new Map<string, unknown>(), toasts: string[] = [], sfxCalls: string[] = [], engineLog: {k: number; th: number}[] = [];
  const kills: CarTestHost['kills'] = [], shoves: CarTestHost['shoves'] = [], propHits: CarTestHost['propHits'] = [], broken: string[] = [];
  const windows = paneRefs(o.panes ?? []);
  const h = {
    scene, camera, player: new Player(), keys: new DriveKeys(), zombies: [] as TestZombie[], frameNo: 0,
    levels, propIndex: new PropIndex(levels, props),
    layout: {props, skyways: {addon: {id: 'prize-car', car: spawn}}} as never,
    run: {laneStore: (lane: string) => store.get(lane), setLaneStore: (lane: string, v: unknown) => { if (v === undefined) store.delete(lane); else store.set(lane, structuredClone(v)); }},
    store, toasts, sfxCalls, engineLog, kills, shoves, propHits, broken, windows,
    hud: {toast: (t: string) => { toasts.push(t); }},
    sfx: {
      physImpact: (_x: number, _y: number, _z: number, s: number, fam: string) => { sfxCalls.push(`impact:${fam}:${s.toFixed(1)}`); },
      denied: () => { sfxCalls.push('denied'); }, impact: () => { sfxCalls.push('bullet'); },
      // (lane CAR2) the car set: the engine's start (rev) / stop, its per-frame speed + throttle, the skid, the door
      carEngine: (k: number, th: number, _at: unknown, o?: {rev?: boolean}) => { if (o?.rev) { sfxCalls.push('engine:start'); engineLog.length = 0; } else engineLog.push({k, th}); },
      stopCarEngine: () => { sfxCalls.push('engine:stop'); },
      carSkid: () => { sfxCalls.push('skid'); return true; },
      carDoor: () => { sfxCalls.push('door'); },
    },
    state: 'playing',
    frameHooks: [] as ((dt: number) => void)[], interactHandlers: [] as (() => boolean)[], sectionHooks: [] as {build?(l: never): void; teardown?(): void}[],
    warmRegistry: new WarmupRegistry(), promptProviders: [] as (() => string | null)[], inputOwners: [] as (() => boolean)[],
    stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: never) => Promise<void>)[], bulletHitHandlers: [] as never[],
    physics: {dynamicItems: {
      walkers: (() => [{id: {}, x: 0, z: 0, y: 0, r: 0.3, wake: true}]) as (() => readonly {id: object; x: number; z: number; y: number; r: number; wake?: boolean}[]) | null,
      shootProp(prop: PropPlacement, index: number, _p: THREE.Vector3, _d: THREE.Vector3, impulse: number) {
        shoves.push({prop, index, impulse, t: h.frameNo});
        prop.h = 0; // loose from now on: no longer an AABB obstacle (dynamicItems.entForProp)
        return true;
      },
      rayHits: () => [],
    }},
    damage: {hitWorld: (wh: {prop: number}, _p: THREE.Vector3, _d: THREE.Vector3, shot: {damage: number}) => { propHits.push({prop: wh.prop, damage: shot.damage}); return {}; }},
    gas: {windows: windows.size ? {refs: windows, broken: (id: string) => broken.includes(id)} : null, breakPane: (id: string) => { if (broken.includes(id)) return false; broken.push(id); return true; }},
    blastKill: (z: TestZombie, dir: THREE.Vector3, point: THREE.Vector3) => { kills.push({z, dir: dir.clone(), point: point.clone()}); z.ragdolled = true; },
    gear: {placeRules: [] as ((x: number, y: number, z: number, level: number) => string | null)[]},
    trainRide: null, fx: null, use: null as unknown,
  };
  const host = h as unknown as CarTestHost;
  const car = new SkywaysCar(host).install();
  if (o.build !== false) build(host);
  return {h: host, car};
}

export function build(h: CarTestHost): void {
  for (const s of h.sectionHooks) s.build?.(h.layout as never);
}

export function teardown(h: CarTestHost): void {
  for (const s of h.sectionHooks) s.teardown?.();
}

export function syncCamera(h: CarTestHost): void {
  const P = h.player;
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  h.camera.updateMatrixWorld(true);
}

/** One Game.update frame in its order (the car steps the player while driving). */
export function frame(h: CarTestHost, car: SkywaysCar, dt = DT): void {
  h.frameNo++;
  syncCamera(h);
  if (h.keys.hits.has('KeyE')) for (const f of h.interactHandlers) if (f()) break;
  if (car.driving) car.stepPlayer(dt, h.keys);
  else if (h.levels) h.player.update(dt, h.keys, h.levels, h.propIndex, {aiming: false, speedMult: 1, canSprint: false});
  for (const f of h.frameHooks) f(dt);
  syncCamera(h);
  h.keys.hits.clear();
  h.keys.mousePressed[0] = false;
}

export function run(h: CarTestHost, car: SkywaysCar, seconds: number, until?: () => boolean): number {
  let t = 0;
  for (; t < seconds - 1e-9; t += DT) { frame(h, car); if (until?.()) break; }
  return t;
}

export function press(h: CarTestHost, car: SkywaysCar, code: string): void {
  h.keys.hits.add(code);
  frame(h, car);
}

/** Turn the player to look at a world point. */
export function lookAt(h: CarTestHost, x: number, y: number, z: number): void {
  const P = h.player, dx = x - P.x, dy = y - P.eye, dz = z - P.z;
  P.yaw = Math.atan2(-dx, -dz);
  P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  syncCamera(h);
}
