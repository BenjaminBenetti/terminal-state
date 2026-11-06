// Task studio-beta-train-fuel-system-20261106-024923-01 (lane CART): Node hosts for the fuel cart tests (no browser / renderer):
//  - flatRoom(): a hand-built one-storey Levels (walls round a 10 x 6 m room, a 1.15 m drop at x >= 7 m like a platform edge) — the
//    controller's collision / floor rules in isolation;
//  - stationHost(): a generated station with the REAL PlayerTrainRuntime + TrainRide + Player, installed in Game's order (the carts
//    after the gas mask, i.e. BEFORE the train runtime and the ride) — ownership, the hose, cargo through a ride.
import * as THREE from 'three';
import {CELL, FLOOR, Grid, SOLID} from '../../src/gen/grid';
import {Levels, levelsOf} from '../../src/gen/levels';
import {PropIndex} from '../../src/core/physics';
import {Player, type MoveInput} from '../../src/player/player';
import {WarmupRegistry} from '../../src/render/warmup';
import type {StationLayout} from '../../src/gen/stationTypes';
import {playerTrainPlacement, trainSpawnPose, type TrainPlacement} from '../../src/gen/playerTrain';
import {PlayerTrainRecord} from '../../src/run/playerTrain';
import {installPlayerTrain, type PlayerTrainRuntime} from '../../src/world/playerTrain';
import {installTrainRide, type TrainRide} from '../../src/world/trainRide';
import {FuelCarts, type FuelCartHost} from '../../src/world/fuelCarts';
import {BASE_MODIFIERS, combineModifiers} from '../../src/player/modifiers';

export const DT = 1 / 60;

export class Keys implements MoveInput {
  held = new Set<string>();
  hits = new Set<string>();
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.hits.has(c); }
}

/** A 10 x 6 m room (0.5 m cells, walls all round), floor 0, ceiling 3; x >= dropX is 1.15 m lower (a platform edge). */
export function flatRoom(dropX = 7): Levels {
  const w = 22, h = 14;
  const grid = new Grid(w, h);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const i = grid.idx(cx, cy);
    if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) { grid.cells[i] = SOLID; continue; }
    grid.cells[i] = FLOOR;
    grid.area[i] = 0;
    const low = (cx + 0.5) * CELL >= dropX;
    grid.floor[i] = low ? -1.15 : 0;
    grid.ceil[i] = 3;
  }
  return new Levels([{id: 0, role: 'main', grid, baseY: 0}], [], []);
}

export interface CartTestHost extends FuelCartHost {
  player: Player;
  playerTrain: PlayerTrainRecord;
  keys: Keys;
  toasts: string[];
  sfxCalls: string[];
  modifierSources: (() => {speedMult?: number})[];
  hitListeners: ((hit: never) => void)[];
  stateListeners: ((s: never, p: never) => void)[];
  promptProviders: (() => string | null)[];
  inputOwners: (() => boolean)[];
  sectionPreloads: ((l: never) => Promise<void>)[];
  pools: Record<string, () => readonly THREE.Object3D[]>;
}

function baseHost(levels: Levels, layout: StationLayout | null, placement: TrainPlacement | null) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const toasts: string[] = [], sfxCalls: string[] = [], pools: Record<string, () => readonly THREE.Object3D[]> = {};
  const warm = new WarmupRegistry();
  const add = warm.addPool.bind(warm);
  warm.addPool = (n: string, f: () => readonly THREE.Object3D[]) => { pools[n] = f; add(n, f); };
  const host = {
    scene, camera, player: new Player(), keys: new Keys(), zombies: [] as never[],
    levels, layout, propIndex: layout ? new PropIndex(levels, layout.props) : null, trainPlacement: placement,
    trainRuntime: null as PlayerTrainRuntime | null, trainRide: null as TrainRide | null,
    playerTrain: new PlayerTrainRecord(),
    sfx: {
      hoseConnect: (on: boolean) => { sfxCalls.push(`hose:${on}`); }, fuelPour: () => { sfxCalls.push('pour'); },
      cartRoll: (v: number) => { sfxCalls.push(`roll:${v}`); }, denied: () => { sfxCalls.push('denied'); },
    },
    hud: {toast: (t: string) => { toasts.push(t); }}, toasts, sfxCalls, pools,
    warmRegistry: warm, physics: {propsChanged: () => {}},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {holders?(l: never): void; build?(l: never): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: never) => Promise<void>)[],
    inputOwners: [] as (() => boolean)[], modifierSources: [] as (() => {speedMult?: number})[], hitListeners: [] as ((h: never) => void)[],
    bulletHitHandlers: [] as never[],
    state: 'playing', world: {culler: {register: () => {}, release: () => {}}}, run: {current: {level: 'subway', section: 'main'}},
    gear: {placeRules: [] as ((x: number, y: number, z: number, level: number) => string | null)[]}, mats: null,
  };
  return host;
}

/** The room host (no train): carts installed, the world "built". */
export function roomHost(levels = flatRoom(), placement: TrainPlacement | null = null) {
  const h = baseHost(levels, null, placement) as unknown as CartTestHost;
  const carts = new FuelCarts(h).install();
  for (const s of h.sectionHooks) s.build?.(undefined as never);
  return {h, carts};
}

/** A generated station with the real train runtime + ride; the player spawned in the car. */
export function stationHost(L: StationLayout, opts: {build?: boolean} = {}) {
  const levels = levelsOf(L);
  const h = baseHost(levels, L, playerTrainPlacement(L)) as unknown as CartTestHost & {trainRuntime: PlayerTrainRuntime; trainRide: TrainRide; layout: StationLayout};
  const carts = new FuelCarts(h).install(); // (Game order: after the gas mask = before the train runtime and the ride)
  const rt = installPlayerTrain(h as never);
  h.trainRuntime = rt;
  const ride = installTrainRide(h as never, rt);
  h.trainRide = ride;
  if (opts.build !== false) build(h, L);
  return {h, carts, rt, ride};
}

/** Game.buildSection's tail: the level fields, then every section hook (holders phase, then build); the player at the train spawn. */
export function build(h: CartTestHost & {layout?: StationLayout | null}, L: StationLayout, spawn = true): void {
  const levels = levelsOf(L);
  Object.assign(h, {layout: L, levels, propIndex: new PropIndex(levels, L.props), trainPlacement: playerTrainPlacement(L)});
  for (const s of h.sectionHooks) s.holders?.(L as never); // (Game: right after the loot holders are built — task fuel-feedback)
  for (const s of h.sectionHooks) s.build?.(L as never);
  if (spawn && h.trainPlacement && !h.trainRide?.riding) {
    const pose = trainSpawnPose(L, h.trainPlacement);
    h.player.spawn(pose.x, pose.z, pose.yaw, pose.y);
  }
}

export function teardown(h: CartTestHost): void {
  for (const s of h.sectionHooks) s.teardown?.();
}

/** Game.updateCamera (+ the ride's tilt). */
export function syncCamera(h: CartTestHost): void {
  const P = h.player;
  h.camera.position.set(P.x, P.eye, P.z);
  h.camera.rotation.set(P.pitch, P.yaw, 0);
  (h.trainRide as TrainRide | null)?.tiltCamera(h.camera);
  h.camera.updateMatrixWorld(true);
}

/**
 * One Game.update frame in its order: E -> interact handlers; the player (ride mode or the world body, the modifier sources' speed);
 * the camera; the lane frame hooks. The camera is synced first too (Game's aim reads last frame's camera).
 */
export function frame(h: CartTestHost, dt = DT): void {
  syncCamera(h);
  if (h.keys.hits.has('KeyE')) for (const f of h.interactHandlers) if (f()) break;
  const mods = combineModifiers(h.modifierSources.length ? h.modifierSources as never : [() => ({...BASE_MODIFIERS})]);
  const opts = {aiming: false, speedMult: mods.speedMult, canSprint: false};
  const ride = h.trainRide as TrainRide | null;
  if (ride?.riding) ride.stepPlayer(dt, h.keys, opts);
  else if (h.levels) h.player.update(dt, h.keys, h.levels, h.propIndex, opts);
  syncCamera(h);
  for (const f of h.frameHooks) f(dt);
  h.keys.hits.clear();
}

export function run(h: CartTestHost, seconds: number, until?: () => boolean): number {
  let t = 0;
  for (; t < seconds - 1e-9; t += DT) { frame(h); if (until?.()) break; }
  return t;
}

/** Press a key for one frame. */
export function press(h: CartTestHost, code: string): void {
  h.keys.hits.add(code);
  frame(h);
}

/** Turn the player to look at a world point (yaw / pitch) and sync the camera. */
export function lookAt(h: CartTestHost, x: number, y: number, z: number): void {
  const P = h.player, ex = P.x, ey = P.eye, ez = P.z;
  const dx = x - ex, dy = y - ey, dz = z - ez;
  P.yaw = Math.atan2(-dx, -dz);
  P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  syncCamera(h);
}
