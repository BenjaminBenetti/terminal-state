// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): the defense sentry's test fixture — a fake train equipment system
// (craft/equipmentApi.ts: units with a real clamped hopper, plugs, the parked / riding switch) and a host of the game's REAL objects for
// world/sentryTurret.ts: a generated layout, its Levels, the REAL parked train runtime (world/playerTrain.ts: the car's volume and
// collider boxes in layout.props / the prop index), the real Player and Inventory, real ZombieActors (stripped GLB: no texture decoding
// in Node) — with recording effects / sound / damage-system / ragdoll stand-ins.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {loadStripped} from './openablesFixture';
import {LEVELS} from '../../src/levels/registry';
import type {LevelId} from '../../src/levels/types';
import {levelsOf} from '../../src/gen/levels';
import {PropIndex} from '../../src/core/physics';
import {mulberry32} from '../../src/core/rng';
import {Player} from '../../src/player/player';
import {Inventory} from '../../src/items/inventory';
import {WarmupRegistry} from '../../src/render/warmup';
import type {StationLayout} from '../../src/gen/stationTypes';
import {playerTrainPlacement, trainToWorld, type TrainPlacement} from '../../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../../src/world/playerTrainSpec';
import {installPlayerTrain, type PlayerTrainRuntime} from '../../src/world/playerTrain';
import {PlayerTrainRecord} from '../../src/run/playerTrain';
import {MODEL_FILES} from '../../src/assets/manifest';
import {ZombieLookLibrary} from '../../src/ai/outfits';
import {ZombieActor} from '../../src/ai/zombieActor';
import {createEnemyActor, type EnemyActor} from '../../src/ai/creatureArchetypes';
import {EQUIPMENT, type EquipmentKind} from '../../src/craft/equipment';
import type {EquipmentSystemLike, EquipmentUnit, EquipmentUse} from '../../src/craft/equipmentApi';
import {turretPivot, type V3} from '../../src/craft/sentry';
import {SentryTurretSystem, type SentryEnemy, type SentryHost, type SentryOptions} from '../../src/world/sentryTurret';

export const DT = 1 / 60;

/** A live unit as the equipment system hands it out: the hopper clamps like the contract says (0..cap, whole rounds). */
export class FakeUnit implements EquipmentUnit {
  readonly def;
  mode: 'world' | 'cargo' | 'held' = 'world';
  plug: number | null = null;
  ammo = 0;
  readonly slots = null;
  readonly storeVersion = 0;
  /** Every value setAmmo was asked for (in order). */
  readonly asked: number[] = [];
  constructor(readonly uid: string, readonly kind: EquipmentKind = 'sentry', ammo = 0) {
    this.def = EQUIPMENT[kind];
    this.ammo = ammo;
  }
  setAmmo(n: number): number {
    this.asked.push(n);
    this.ammo = Math.max(0, Math.min(this.def.ammoCap, Math.floor(n)));
    return this.ammo;
  }
  touchStore(): void { /* no store */ }
  setOpen(): void { /* no lid */ }
  worldPose(): null { return null; }
}

/** The equipment system as the sentry sees it (craft/equipmentApi.ts EquipmentSystemLike). */
export class FakeEquipment implements EquipmentSystemLike {
  readonly list: FakeUnit[] = [];
  /** The train is parked in a live world (active() answers only then). */
  parked = true;
  readonly uses: Partial<Record<EquipmentKind, EquipmentUse>> = {};
  readonly plugListeners: ((u: EquipmentUnit, plugged: boolean) => void)[] = [];
  units(): readonly EquipmentUnit[] { return this.list; }
  plugged(kind: EquipmentKind): EquipmentUnit | null {
    let best: FakeUnit | null = null;
    for (const u of this.list) if (u.kind === kind && u.plug !== null && (!best || u.plug < best.plug!)) best = u;
    return best;
  }
  active(kind: EquipmentKind): EquipmentUnit | null { return this.parked ? this.plugged(kind) : null; }
  craftBlock(): string | null { return 'not in this fixture'; }
  craft(): EquipmentUnit | null { return null; }
  storesAboard(): never[] { return []; }
  add(uid: string, ammo = 0, plug: number | null = null, kind: EquipmentKind = 'sentry'): FakeUnit {
    const u = new FakeUnit(uid, kind, ammo);
    this.list.push(u);
    if (plug !== null) this.connect(u, plug);
    return u;
  }
  connect(u: FakeUnit, plug: number): void { u.plug = plug; for (const l of this.plugListeners) l(u, true); }
  disconnect(u: FakeUnit): void { u.plug = null; for (const l of this.plugListeners) l(u, false); }
}

export interface Call { name: string; args: unknown[] }

/** Records every call of any method (the sound: Sfx; the effects). Vectors are copied at the call. */
export function recorder(): {target: never; calls: Call[]; count(name: string): number; of(name: string): Call[]} {
  const calls: Call[] = [];
  const copy = (a: unknown) => (a instanceof THREE.Vector3 ? a.clone() : a);
  const target = new Proxy({}, {
    get: (_t, name) => typeof name === 'string' && name !== 'then' ? (...args: unknown[]) => { calls.push({name, args: args.map(copy)}); return true; } : undefined,
  }) as never;
  return {target, calls, count: name => calls.filter(c => c.name === name).length, of: name => calls.filter(c => c.name === name)};
}

const layouts = new Map<string, StationLayout>();
export function layoutOf(level: LevelId, seed: number): StationLayout {
  const k = `${level}:${seed}`;
  let l = layouts.get(k);
  if (!l) { l = LEVELS[level].generate(LEVELS[level].entry, {levelSeed: seed}); layouts.set(k, l); }
  return l;
}

export interface SentryWorldOpts extends SentryOptions {
  level?: LevelId;
  seed?: number;
  /** Rounds in the sentry's hopper, the plug it is on (null: not plugged in). */
  ammo?: number;
  plug?: number | null;
  /** No sentry unit at all. */
  noUnit?: boolean;
}

const live: {rt: PlayerTrainRuntime; sys: SentryTurretSystem}[] = [];
/** afterEach: every world of this file torn down (the layouts and their Levels are shared between tests). */
export function teardownSentryWorlds(): void {
  for (const {rt, sys} of live.splice(0)) { sys.teardown(); if (rt.train) rt.teardown(); }
}

export function sentryWorld(o: SentryWorldOpts = {}) {
  const lay = layoutOf(o.level ?? 'subway', o.seed ?? 4242);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  scene.add(camera);
  const levels = levelsOf(lay);
  const player = new Player();
  const toasts: {text: string; warn: boolean}[] = [];
  const sfx = recorder(), fx = recorder(), dmg = recorder();
  const ragdolls: {target: SentryEnemy; impulse: {dir: THREE.Vector3; point: THREE.Vector3; strength: number; bone?: string}}[] = [];
  const lights: THREE.Vector3[] = [];
  const shadows: THREE.Object3D[] = [];
  const eq = new FakeEquipment();
  const host = {
    scene, camera, player, zombies: [] as SentryEnemy[], levels, layout: lay, propIndex: new PropIndex(levels, lay.props),
    trainPlacement: playerTrainPlacement(lay) as TrainPlacement | null,
    sfx: sfx.target as unknown, fx: fx.target as unknown,
    damage: {
      beginShot: () => { dmg.calls.push({name: 'beginShot', args: []}); },
      hitZombie: (...args: unknown[]) => { dmg.calls.push({name: 'hitZombie', args: args.map(a => (a instanceof THREE.Vector3 ? a.clone() : a))}); },
      structuralClassAt: () => 'concrete',
    },
    hud: {toast: (text: string, warn?: boolean) => { toasts.push({text, warn: !!warn}); }}, warmRegistry: new WarmupRegistry(),
    physics: {
      propsChanged: () => {},
      ragdoll: (target: SentryEnemy, impulse: never) => { ragdolls.push({target, impulse}); target.ragdolled = true; return true; },
    },
    atmosphere: {markShadows: (root: THREE.Object3D) => { shadows.push(root); }},
    bulletHitHandlers: [] as ((wh: never, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[],
    npcMuzzleLight: (at: THREE.Vector3) => { lights.push(at.clone()); },
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    sectionModelKeys: [] as ((l: StationLayout) => readonly string[])[],
    state: 'playing', world: null, input: {down: () => false}, run: {current: {level: o.level ?? 'subway', section: 'main'}, campaign: null},
    playerTrain: new PlayerTrainRecord(), trainRide: {riding: false, moving: false},
    inv: new Inventory(), stats: {kills: 0, shots: 0, hits: 0, headshots: 0}, rand: mulberry32(0x5e7), trainEquipment: eq,
    trainRuntime: undefined as unknown as PlayerTrainRuntime,
  };
  const rt = installPlayerTrain(host as never);
  host.trainRuntime = rt;
  const sys = new SentryTurretSystem(host as unknown as SentryHost, {model: o.model ?? (() => null), rand: o.rand}).install();
  live.push({rt, sys});
  for (const s of host.sectionHooks) s.build?.(lay);
  const p = rt.train?.placement ?? null;
  const unit = o.noUnit ? null : eq.add('eq-1', o.ammo ?? 0, o.plug === undefined ? 0 : o.plug);
  // the player: inside the car at its front end (far from every line of fire over the roof)
  if (p) { const at = trainToWorld(p, 5, SPEC.floorY, 0); player.spawn(at.x, at.z, 0, at.y); }
  const W = {
    host, lay, levels, rt, sys, eq, unit: unit as FakeUnit, p: p as TrainPlacement, player, toasts, sfx, fx, dmg, ragdolls, lights, shadows,
    /** The pivot in the world. */
    pivot(): V3 { const L = turretPivot(SPEC); return trainToWorld(p!, L.x, L.y, L.z); },
    /** A world point at train-local (lx, lz) standing on whatever floor is there near the car floor's height (null: nothing to stand on). */
    stand(lx: number, lz: number): V3 | null {
      const w = trainToWorld(p!, lx, 0, lz), f = levels.supportAt(w.x, w.z, p!.floorY + 0.25, 0.4)?.floor;
      return f === undefined || !Number.isFinite(f) ? null : {x: w.x, y: f, z: w.z};
    },
    /** Frames of `seconds`: the sentry's frame hook, then the enemies' bodies follow their brains (Game.updateZombies' part). */
    run(seconds: number, each?: (t: number) => void): void {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) {
        sys.update(DT);
        for (const z of host.zombies) syncBody(z);
        each?.((i + 1) * DT);
      }
    },
    /** Frames until `done()` (at most `max` seconds); returns the seconds run. */
    until(done: () => boolean, max = 6): number {
      let t = 0;
      while (!done() && t < max) { W.run(DT); t += DT; }
      return t;
    },
    /** Rise fully (the deploy time and a frame). */
    deploy(): void { W.run(1); },
    /** The times (s from now) of the shots fired during `seconds`. */
    shotTimes(seconds: number): number[] {
      const out: number[] = [];
      let n = sys.counts.shots;
      W.run(seconds, t => { if (sys.counts.shots !== n) { n = sys.counts.shots; out.push(t); } });
      return out;
    },
  };
  return W;
}
export type SentryWorld = ReturnType<typeof sentryWorld>;

// ---------------------------------------------------------------------------------------------------------------------------------
// Real enemies

const models: Record<string, GLTF> = {};
let looks: ZombieLookLibrary | null = null;
const actorRand = mulberry32(0xc0ba7);

/** beforeAll: the zombie body (stripped GLB). */
export async function loadZombieModels(): Promise<void> {
  if (looks) return;
  models.zombieBody_lastshift = await loadStripped(MODEL_FILES.zombieBody_lastshift.url);
  looks = new ZombieLookLibrary(models);
}

/** The body follows the brain (feet height on decks / stairs) and its hit volumes are current. */
export function syncBody(z: SentryEnemy): void {
  const a = z as unknown as Partial<EnemyActor>;
  if (typeof a.syncTransform !== 'function' || typeof a.updateVolumes !== 'function' || !a.root || !a.brain) return;
  if (a.ragdolled || !a.brain.alive) return;
  a.syncTransform();
  a.root.position.y = a.brain.y;
  a.root.updateMatrixWorld(true);
  a.updateVolumes();
}

/** A real zombie standing with its feet at `feet` (posed in its idle clip, hit volumes current: built like Game.spawnEnemy). */
export function placeZombie(feet: V3, yaw = 0.4): EnemyActor {
  if (!looks) throw new Error('loadZombieModels() first');
  const spawn = {x: feet.x, z: feet.z, yaw, type: 'shambler' as const, area: 0, y: feet.y};
  const {actor} = createEnemyActor(spawn, models, actorRand, () => new ZombieActor(looks!.build({body: 'lastshift', wear: {}}), spawn, actorRand));
  actor.brain.y = feet.y;
  for (let i = 0; i < 4; i++) {
    actor.animate(1 / 30, 'Idle', 0);
    actor.syncTransform();
    actor.root.position.y = actor.brain.y;
    actor.updateVolumes();
  }
  return actor;
}
