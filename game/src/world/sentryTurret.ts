// Task studio-train-crafting-v1-20261111-225628-01 (lane SENTRY): a movable console that plugs into the train and is fed real 5.56 mm
// rounds; a roof turret deploys and fires them at nearby enemies through the game's normal line-of-sight combat; crafted empty, no free
// round — THE DEFENSE SENTRY'S RUNTIME (Game.sentryTurret). The rules and every number are
// craft/sentry.ts (SENTRY); the look is world/sentryTurretView.ts; the unit itself (the console on its hand truck, the plug, its saved
// `ammo`) is the equipment system's (world/trainEquipment.ts) — this module only knows craft/equipmentApi.ts.
//
// installSentryTurret(game, {rand}) is called ONCE from the Game constructor (after the train equipment; `rand` = the game's level random
// stream, handed in the way installBlightBurst gets it); it only REGISTERS: the console's use
// (EquipmentSystemLike.uses.sentry) and a plug listener, a frame hook (only while playing), section hooks (build = attach the turret to
// the car's view root, everything transient reset; teardown = stowed and hidden), a state listener (leaving 'playing' drops the target)
// and the warm pool 'train-turret' (the turret's materials compile on the loading screen; its flash / tracer / impacts are the existing
// 'effects' pool's). No new light, sound file or texture.
//
// THE CONSOLE ([E] on the sentry module's console face): TAP = every carried 5.56 mm round (pockets / quick slots) the hopper has room
// for goes in (craft/sentry.ts loadHopper); HOLD = the loaded rounds come back as ordinary stacks, as many as fit (unloadHopper).
// Plugged in or not; not while the train moves. The unit's `ammo` is the ONLY state (saved by the equipment system): the turret's pose,
// target and cooldown are transient and reset on every build.
// THE TURRET exists (is drawn) only while the sentry is ACTIVE (plugged into the PARKED train in a live world: EquipmentSystemLike.
// active), LOADED and there is HEADROOM over the roof mount (headroom(): the bed's ceiling over the swept disc — Levels.ceilingOver —
// and any prop box hanging there; the placement only guarantees gen/playerTrain.ts TRAIN_CLEAR.ceiling above the roof). It stands on the
// car's middle roof hatch (craft/trainFixtures.ts turretMount), rises out of it in SENTRY.deployS, scans slowly, tracks its target and
// sinks again when the sentry is unplugged / empty / the doors close for a departure; once the ride MOVES, at a teardown or without a
// parked car it is hidden at once.
// FIRE (single aimed shots, SENTRY.interval apart, one loaded round each — the round leaves the hopper BEFORE the shot):
//  - targets: the living, standing, awake enemies (Game.zombies; never a ragdoll, a dormant / rising Siren, or anything that is not an
//    enemy: market people are not in that list) within SENTRY.range of the turret's yaw axis on any storey; every SENTRY.repick s the
//    NEAREST one with a clear shot (pickTarget: bounded — at most SENTRY.maxChecks enemies are refused by the world rays per pick; the
//    ones under the eaves are refused by the roof rule / the elevation stops for free and never hide a clear target behind them);
//  - a clear shot to the enemy's upper torso, else its head, from the PIVOT of the turret turned to point at it (the tilt axis is ahead
//    of the yaw axis: craft/sentry.ts turretPivotToward): inside the elevation stops, the OWN-HULL rule, then from the VIRTUAL ORIGIN
//    (craft/sentry.ts) the game's normal pair — Levels.lineOfSight and the bullet's world ray reaching the point (Game.echoScan's test)
//    — and the player's body not within SENTRY.safeRadius of the line (it holds fire rather than shoot past the player);
//  - the shot: tested again from the pivot AT THE YAW THE GUN HAS, then that aim line + a small cone (the random source handed in at
//    install; a draw that would clip the hull falls back to the aim line), then exactly the player's bullet (Game.fire): physics/
//    merchOnHost.ts raycastShot, combat/enemyRay.ts nearestEnemyHit — so it can miss, hit a limb / the head / another enemy in front,
//    a wall, a prop or glass (Game.bulletHitHandlers) —, the rifle's damage x falloff (from the pivot) x part multiplier through
//    brain.damage FROM THE TRAIN (the enemies come for the train as they would for a gunman standing in it under the turret), the
//    wound / blood through the damage system, knockback, the hurt cue; a kill = stats.kills, the death cue and a ragdoll with the
//    rifle's impulse. A world hit is the survivors' impact (market/combat/marketCombat.ts: the material's chips / mark / sound; no
//    lasting damage). The player's own shot statistics, hit marker and hit confirm are never touched.
//    Each shot: the positional rifle cue (Sfx.npcShot), flash + tracer + the shared muzzle light, and gunfire noise at the train
//    (ai/brain.ts alertListeners, the rifle's radius).
// It does not fire while the game is not 'playing' (frame hooks do not run), while riding, or with the player dead. Enemies do not
// attack the turret; with several sentries plugged in only the active one (the lowest plug) has a turret.

import * as THREE from 'three';
import type {Game} from '../game';
import {alertListeners, type ZombieBrain} from '../ai/brain';
import {enemyCues, type EnemyActor} from '../ai/creatureArchetypes';
import type {Sfx} from '../audio/sfx';
import {TRAIN_EQUIPMENT_MODELS} from '../assets/trainEquipment.generated';
import {nearestEnemyHit, type RayVolume} from '../combat/enemyRay';
import {raycastWorld, type WorldHit} from '../combat/hitscan';
import {moveCircle, type PropIndex} from '../core/physics';
import type {EquipmentSystemLike, EquipmentUnit} from '../craft/equipmentApi';
import {
  SENTRY, aimAngles, aimPoint, barrelDir, clearOfBody, hullExit, loadHopper, ownHullClear, pickTarget, turnToward, turretMuzzle,
  turretPivot, turretPivotToward, turretReach, turretSweep, unloadHopper, wrapAngle, type AmmoInventory, type V3,
} from '../craft/sentry';
import {turretMount} from '../craft/trainFixtures';
import {DAMAGE_MATERIALS, propDamageSpec} from '../damage/materials';
import {BODY_CLEAR, type Levels} from '../gen/levels';
import type {TrainPlacement} from '../gen/playerTrain';
import type {PropPlacement} from '../gen/props';
import {itemDef} from '../items/items';
import {coneDir} from '../market/combat/npcGun';
import {raycastShot} from '../physics/merchOnHost';
import type {KillImpulse} from '../physics/ragdoll';
import {killImpulseStrength} from '../physics/world';
import type {WarmupRegistry} from '../render/warmup';
import {WEAPONS, WeaponController, type WeaponDef} from '../weapons/weapons';
import {PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';
import {SentryTurretView} from './sentryTurretView';

/** Prompt / toast texts. */
export const SENTRY_TEXT = {
  moving: 'Not while the train is moving',
  noHeadroom: 'no headroom for the roof turret at this platform',
  unplugged: 'not plugged in',
  unloadHint: 'hold <b>[E]</b> to unload',
  load: (short: string, carried: number, ammo: number, cap: number) => `<b>[E]</b> Load ${short} (${carried} carried) · sentry ${ammo}/${cap} rounds`,
  noneCarried: (short: string, ammo: number, cap: number) => `Sentry ${ammo}/${cap} rounds — no ${short} carried`,
  full: (ammo: number, cap: number) => `Sentry ${ammo}/${cap} rounds — full`,
  ride: (ammo: number, cap: number) => `Sentry ${ammo}/${cap} rounds — not while the train is moving`,
  loaded: (n: number, ammo: number, cap: number) => `Loaded ${n} round${n === 1 ? '' : 's'} — sentry ${ammo}/${cap}`,
  nothingToLoad: (short: string) => `No ${short} rounds carried`,
  hopperFull: (cap: number) => `The sentry is full — ${cap}/${cap} rounds`,
  unloaded: (n: number, left: number) => left > 0 ? `Unloaded ${n} round${n === 1 ? '' : 's'} — no room for the other ${left}` : `Unloaded ${n} round${n === 1 ? '' : 's'} — the sentry is empty`,
  nothingToUnload: 'The sentry is empty',
  noRoom: (ammo: number, cap: number) => `No room to unload — sentry ${ammo}/${cap} rounds`,
  empty: (short: string) => `Sentry out of ammunition — load ${short} at its console`,
  plugNoHeadroom: 'Sentry: no headroom for the roof turret at this platform',
} as const;

/** An enemy as the sentry reads it (ai/creatureArchetypes.ts EnemyActor satisfies it). */
export interface SentryEnemy {
  readonly brain: {
    readonly alive: boolean; x: number; y: number; z: number; state: string; readonly climbing?: boolean;
    readonly stats: {radius: number; height?: number};
    damage(amount: number, fromX: number, fromZ: number, fromY?: number): boolean;
    hear(x: number, z: number, radius: number, y?: number): void;
  };
  ragdolled: boolean;
  hitFlash: number;
  readonly hitVolumes: readonly RayVolume[];
}

/** What the sentry needs from Game (structural: Node tests drive it with a fake host and the game's real combat objects). */
export interface SentryHost {
  state: string;
  player: {x: number; y: number; z: number; eye: number; alive: boolean};
  /** The carried inventory (re-read on every use: a load / Retry replaces it). */
  inv: AmmoInventory;
  hud: {toast(text: string, warn?: boolean): void};
  trainEquipment?: EquipmentSystemLike | null;
  zombies: readonly SentryEnemy[];
  levels: Levels;
  layout: {props: PropPlacement[]; trench: {floorY: number}; mall?: unknown; reactor?: unknown};
  propIndex?: PropIndex | null;
  trainRuntime?: {view: {root: THREE.Object3D} | null; train?: {placement: TrainPlacement} | null; spec?: PlayerTrainSpec};
  trainRide?: {riding: boolean; moving?: boolean} | null;
  stats: {kills: number};
  sfx?: unknown;
  fx?: {
    impact?(pos: THREE.Vector3, normal: THREE.Vector3, surface: never, opts?: object): void;
    muzzleFlash?(pos: THREE.Vector3, dir: THREE.Vector3, big: boolean): void;
    tracer?(from: THREE.Vector3, to: THREE.Vector3): void;
  } | null;
  damage?: {
    beginShot(): void;
    hitZombie(z: never, point: THREE.Vector3, dir: THREE.Vector3, part: 'head' | 'torso' | 'limb', shot: {damage: number; pellet: boolean; weapon: string}): unknown;
    structuralClassAt?(kind: 'wall' | 'floor' | 'ceiling', level: number | undefined, point: THREE.Vector3, normal: THREE.Vector3): string;
  } | null;
  physics?: {ragdoll(target: never, impulse: KillImpulse | null): boolean} | null;
  /** A bullet's world hit offered to the lane handlers first (Game.bulletHitHandlers: window glass, carts, …). */
  bulletHitHandlers?: ((wh: WorldHit, point: THREE.Vector3, dir: THREE.Vector3, shot: number, damage: number) => boolean)[];
  /** Someone else's muzzle flash lights the scene (Game.npcMuzzleLight). */
  npcMuzzleLight?(at: THREE.Vector3): void;
  propModels?: {get(key: string): {scene: THREE.Object3D} | undefined};
  atmosphere?: {markShadows(root: THREE.Object3D, structure: boolean): void};
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: never): void; teardown?(): void}[];
  stateListeners?: ((s: never, prev: never) => void)[];
  warmRegistry: WarmupRegistry;
}

export interface SentryOptions {
  /** The cooked turret's scene (default: the prop library's TRAIN_EQUIPMENT_MODELS.turret; null = none yet: the stand-in). */
  model?: () => THREE.Object3D | null;
  /**
   * The spread's random source, called twice per round. The game hands in its level stream (`{rand: () => this.rand()}`: re-seeded
   * per level, so it is read through the closure at each shot). Default Math.random — Node tests that do not care.
   */
  rand?: () => number;
}

/** The headroom over the roof mount (world y / m). */
export interface SentryHeadroom {
  /** The turret can stand deployed here. */
  ok: boolean;
  /** The lowest thing over the turret's swept disc (Infinity: open). */
  ceil: number;
  /** ceil - (the mount + the turret's highest reach). */
  clearance: number;
}

/** One shot, for QA / tests (the same object, overwritten per shot). */
export interface SentryShot {
  /** What the round met. */
  result: 'enemy' | 'world' | 'none';
  part: 'head' | 'torso' | 'limb' | null;
  /** Damage dealt to an enemy (0 otherwise), the distance from the pivot (m), a kill. */
  damage: number;
  dist: number;
  killed: boolean;
  /** The round's end point, the virtual origin and the pivot its line started at (world). */
  end: V3;
  origin: V3;
  pivot: V3;
  /** The rounds left after it. */
  ammo: number;
}

interface Scratch { x: number; y: number; z: number }
const v0 = (): Scratch => ({x: 0, y: 0, z: 0});

export class SentryTurretSystem {
  readonly spec: PlayerTrainSpec;
  readonly view: SentryTurretView;
  /** The round it fires (the rifle's). */
  readonly def: WeaponDef = WEAPONS[SENTRY.weapon];
  /** 0 stowed (hidden) .. 1 deployed. */
  deploy = 0;
  yaw = 0;
  pitch: number = SENTRY.scanPitch;
  target: SentryEnemy | null = null;
  targetPart: 'torso' | 'head' = 'torso';
  /** Counters (QA / tests). */
  readonly counts = {shots: 0, hits: 0, kills: 0, worldHits: 0, misses: 0, picks: 0, lineTests: 0, rayTests: 0, holds: 0, hullFallbacks: 0, noises: 0, loaded: 0, unloaded: 0, attached: 0, emptied: 0};
  /** The last shot (QA / tests; null: none since the last build). */
  lastShot: SentryShot | null = null;
  private readonly shot: SentryShot = {result: 'none', part: null, damage: 0, dist: 0, killed: false, end: v0(), origin: v0(), pivot: v0(), ammo: 0};
  private cooldown = 0;
  private pickT = 0;
  private unitUid: string | null = null;
  private shotSeq = 0;
  private room: SentryHeadroom | null = null;
  private roomFor: TrainPlacement | null = null;
  private shadowsFor: THREE.Object3D | null = null;
  private readonly rand: () => number;
  // per-call scratch (nothing is allocated per frame): the line of fire last asked for — its pivot (train-local / world), direction
  // (world / train-local), length, and where it leaves the car's outline
  private readonly pivotL = v0();
  private readonly pivotW = v0();
  private readonly dirW = v0();
  private readonly dirL = v0();
  private readonly aim = v0();
  private readonly originW = v0();
  private readonly feet = v0();
  private readonly barrel = v0();
  private readonly muzzleL = v0();
  private readonly ang = {yaw: 0, pitch: 0};
  private readonly head = v0();
  private lineT = 0;
  private lineD = 0;
  private clearPart: 'torso' | 'head' = 'torso';
  private mountWX = 0;
  private mountWZ = 0;
  private readonly dist2 = (z: SentryEnemy): number => {
    if (!this.valid(z)) return Infinity;
    const dx = z.brain.x - this.mountWX, dz = z.brain.z - this.mountWZ;
    return dx * dx + dz * dz;
  };
  /** pickTarget's question: true = a clear shot; false = refused by the world rays (costly); null = refused by the own roof / the stops (free). */
  private readonly clear = (z: SentryEnemy): boolean | null => {
    const n = this.counts.rayTests;
    if (this.clearShot(z)) return true;
    return this.counts.rayTests === n ? null : false;
  };

  constructor(readonly host: SentryHost, readonly opts: SentryOptions = {}) {
    this.spec = host.trainRuntime?.spec ?? PLAYER_TRAIN_SPEC;
    this.view = new SentryTurretView(this.spec);
    this.rand = opts.rand ?? Math.random;
  }

  // --- registration --------------------------------------------------------------------------------------------------

  install(): this {
    const h = this.host;
    h.frameHooks.push(dt => this.update(dt));
    h.sectionHooks.push({build: () => this.build(), teardown: () => this.teardown()});
    h.stateListeners?.push(((s: string) => { if (s !== 'playing') this.dropTarget(); }) as (s: never, p: never) => void);
    h.warmRegistry.addPool('train-turret', () => this.warmRoots());
    this.ensureUse();
    return this;
  }

  private useOwner: EquipmentSystemLike | null = null;
  /** The console's use + the plug listener, registered once the equipment system exists. */
  private ensureUse(): void {
    const eq = this.host.trainEquipment ?? null;
    if (!eq || eq === this.useOwner) return;
    eq.uses.sentry = {prompt: u => this.prompt(u), tap: u => this.tap(u)};
    eq.plugListeners.push((u, on) => this.onPlug(u, on));
    this.useOwner = eq;
  }

  // --- the console: real rounds in, real rounds out ------------------------------------------------------------------

  /** The unit can be loaded / unloaded now: standing in the world (not riding as cargo), the train not on a ride. */
  private usable(u: EquipmentUnit): boolean {
    return u.mode === 'world' && !this.host.trainRide?.riding;
  }

  /** The look-at line of the console face. */
  prompt(u: EquipmentUnit): string | null {
    const item = u.def.ammoItem, cap = u.def.ammoCap, a = u.ammo;
    if (!item || !cap) return null;
    if (!this.usable(u)) return SENTRY_TEXT.ride(a, cap);
    const carried = this.host.inv.count(item);
    let s = a >= cap ? SENTRY_TEXT.full(a, cap) : carried <= 0 ? SENTRY_TEXT.noneCarried(ammoShort(u), a, cap) : SENTRY_TEXT.load(ammoShort(u), carried, a, cap);
    if (a > 0) s += ` · ${SENTRY_TEXT.unloadHint}`;
    if (u.plug === null) s += ` · ${SENTRY_TEXT.unplugged}`;
    else if (this.isActive(u) && !this.headroom().ok) s += ` · ${SENTRY_TEXT.noHeadroom}`;
    return s;
  }

  /** [E] tapped on the console: load every carried round there is room for. Always handled (the console face never grabs the truck). */
  tap(u: EquipmentUnit): boolean {
    const h = this.host, cap = u.def.ammoCap;
    if (!u.def.ammoItem || !cap) return false;
    if (!this.usable(u)) { this.deny(SENTRY_TEXT.moving); return true; }
    const n = loadHopper(h.inv, u);
    if (n > 0) {
      this.counts.loaded += n;
      h.hud.toast(SENTRY_TEXT.loaded(n, u.ammo, cap));
      (h.sfx as Partial<Sfx> | null | undefined)?.shellIn?.();
    } else this.deny(u.ammo >= cap ? SENTRY_TEXT.hopperFull(cap) : SENTRY_TEXT.nothingToLoad(ammoShort(u)));
    return true;
  }

  /** [E] held on the console: unload — the rounds back into the inventory, as many as fit. */
  hold(u: EquipmentUnit): boolean {
    const h = this.host, cap = u.def.ammoCap;
    if (!u.def.ammoItem || !cap) return false;
    if (!this.usable(u)) { this.deny(SENTRY_TEXT.moving); return true; }
    if (u.ammo <= 0) { this.deny(SENTRY_TEXT.nothingToUnload); return true; }
    const n = unloadHopper(h.inv, u, itemDef(u.def.ammoItem).stackMax);
    if (n > 0) {
      this.counts.unloaded += n;
      h.hud.toast(SENTRY_TEXT.unloaded(n, u.ammo), u.ammo > 0);
      (h.sfx as Partial<Sfx> | null | undefined)?.pickup?.();
    } else this.deny(SENTRY_TEXT.noRoom(u.ammo, cap));
    return true;
  }

  private deny(text: string): void {
    this.host.hud.toast(text, true);
    (this.host.sfx as Partial<Sfx> | null | undefined)?.denied?.();
  }

  /** A sentry was plugged in where the turret cannot stand: say so once (the benefit toast is the equipment system's). */
  private onPlug(u: EquipmentUnit, on: boolean): void {
    if (u.kind !== 'sentry') return;
    this.pickT = 0;
    if (on && this.isActive(u) && !this.headroom().ok) this.host.hud.toast(SENTRY_TEXT.plugNoHeadroom, true);
  }

  private isActive(u: EquipmentUnit): boolean {
    return this.host.trainEquipment?.active('sentry') === u;
  }

  // --- the fixture ---------------------------------------------------------------------------------------------------

  /** Parent the turret to the current train view (none: detached). Cheap when already there. */
  attach(): boolean {
    const view = this.host.trainRuntime?.view ?? null, root = this.view.root;
    if (!view) { if (root.parent) root.removeFromParent(); return false; }
    if (root.parent !== view.root) {
      view.root.add(root);
      this.counts.attached++;
      this.dress();
    }
    this.ensureModel();
    return true;
  }

  /** The cooked model once the library has it (else the stand-in stays). */
  private ensureModel(): void {
    const src = this.opts.model ? this.opts.model() : this.host.propModels?.get(TRAIN_EQUIPMENT_MODELS.turret.key)?.scene ?? null;
    const had = this.view.model;
    if (this.view.setModel(src) && this.view.model !== had) this.dress();
  }

  /** Every mesh carries the car's level (the culler's tag); the shadows are marked once per look (like the car's other fixtures). */
  private dress(): void {
    const level = this.host.trainRuntime?.train?.placement.level ?? 0;
    this.view.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.userData.level = level; });
    const look = this.view.model ?? this.view.root;
    if (this.shadowsFor !== look) { this.host.atmosphere?.markShadows(this.view.root, false); this.shadowsFor = look; }
  }

  private warmRoots(): THREE.Object3D[] {
    return this.attach() ? [this.view.root] : [];
  }

  /** The parked car's placement (null: no car built here, or it is on a ride). */
  private parked(): TrainPlacement | null {
    const h = this.host;
    return h.trainRide?.riding ? null : h.trainRuntime?.train?.placement ?? null;
  }

  /**
   * THE HEADROOM over the roof mount at the parked car's place (cached per placement): the bed's ceiling over the disc the turning
   * turret sweeps, and any prop box hanging into that disc above the car's roof. No parked car: not ok.
   */
  headroom(): SentryHeadroom {
    const h = this.host, p = h.trainRuntime?.train?.placement ?? null;
    if (!p || !h.levels) return NO_ROOM;
    if (this.room && this.roomFor === p) return this.room;
    const m = turretMount(this.spec), r = turretSweep();
    const wx = p.x + p.front * m.x, wz = p.z + p.front * m.z, wy = p.railTopY + m.y, top = wy + turretReach();
    let ceil = h.levels.ceilingOver(wx, wz, r, wy);
    if (Number.isNaN(ceil)) ceil = Infinity;
    // a prop above the car's roof box over the disc (a beam, a sign, a duct): its underside is the ceiling there
    const roofTop = p.railTopY + this.spec.roofY + 0.01;
    for (const q of h.layout.props) {
      if (q.y + q.h <= roofTop || q.y >= ceil) continue;
      const nx = Math.max(q.x - q.hx, Math.min(wx, q.x + q.hx)), nz = Math.max(q.z - q.hz, Math.min(wz, q.z + q.hz));
      if ((wx - nx) ** 2 + (wz - nz) ** 2 >= r * r) continue;
      ceil = Math.max(q.y, roofTop);
    }
    this.room = {ok: ceil - top >= SENTRY.headroom, ceil, clearance: ceil - top};
    this.roomFor = p;
    return this.room;
  }

  // --- lifecycle -----------------------------------------------------------------------------------------------------

  build(): void {
    this.ensureUse();
    this.reset();
    this.attach();
  }

  teardown(): void {
    this.reset();
    // the riding car keeps its view (and the stowed, hidden turret on it); else the turret leaves the scene with the car
    if (!(this.host.trainRide?.riding && this.view.root.parent)) this.view.root.removeFromParent();
  }

  /** Everything transient back to nothing: stowed and hidden, no target, no cooldown, no cached headroom. */
  private reset(): void {
    this.deploy = 0;
    this.yaw = 0;
    this.pitch = SENTRY.scanPitch;
    this.cooldown = 0;
    this.pickT = 0;
    this.unitUid = null;
    this.room = null;
    this.roomFor = null;
    this.lastShot = null;
    this.dropTarget();
    this.view.pose(0, this.yaw, this.pitch);
  }

  private dropTarget(): void {
    this.target = null;
    this.pickT = 0;
  }

  // --- per frame -----------------------------------------------------------------------------------------------------

  update(dt: number): void {
    const h = this.host;
    if (h.state !== 'playing') return; // (the frame hooks run in play only; a paused / ended game moves nothing here either way)
    const unit = h.trainEquipment?.active('sentry') ?? null;
    if (!unit && this.deploy === 0) { this.unitUid = null; this.target = null; return; } // no active sentry, nothing showing: nothing to do
    if ((unit?.uid ?? null) !== this.unitUid) { this.unitUid = unit?.uid ?? null; this.dropTarget(); this.cooldown = 0; }
    const p = this.parked();
    const can = !!unit && unit.ammo > 0 && !!p && this.attach() && this.headroom().ok;
    // no parked car to stand on, or the ride moves: hidden at once; else it rises / sinks
    if (!h.trainRuntime?.train || h.trainRide?.moving || !this.view.root.parent) this.deploy = 0;
    else this.deploy = can ? Math.min(1, this.deploy + dt / SENTRY.deployS) : Math.max(0, this.deploy - dt / SENTRY.deployS);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (can && this.deploy >= 1) this.track(dt, unit!, p!);
    else this.target = null;
    this.view.pose(this.deploy, this.yaw, this.pitch);
  }

  /** A candidate: living, on its feet, awake, with a body to hit. */
  private valid(z: SentryEnemy): boolean {
    const b = z.brain;
    return b.alive && !z.ragdolled && b.state !== 'dormant' && b.state !== 'rise' && z.hitVolumes.length > 0;
  }

  /** The deployed turret: pick, track, fire. */
  private track(dt: number, unit: EquipmentUnit, p: TrainPlacement): void {
    const h = this.host;
    this.setMount(p);
    let t = this.target;
    if (t && !this.valid(t)) { t = this.target = null; this.pickT = 0; }
    this.pickT -= dt;
    if (this.pickT <= 0) {
      this.pickT = SENTRY.repick;
      this.counts.picks++;
      t = this.target = pickTarget(h.zombies, this.dist2, this.clear);
      if (t) this.targetPart = this.clearPart;
    }
    if (!t || !aimPoint(t.hitVolumes, this.targetPart, this.aim)) {
      // idle: a slow sweep round the car
      this.yaw = wrapAngle(this.yaw + SENTRY.scanRate * dt);
      this.pitch = turnToward(this.pitch, SENTRY.scanPitch, SENTRY.pitchRate * dt);
      return;
    }
    if (!this.lineTo(this.aim, p)) return;
    aimAngles(this.dirL, this.ang);
    this.yaw = turnToward(this.yaw, this.ang.yaw, SENTRY.yawRate * dt);
    this.pitch = turnToward(this.pitch, Math.max(SENTRY.pitchMin, Math.min(SENTRY.pitchMax, this.ang.pitch)), SENTRY.pitchRate * dt);
    if (this.cooldown > 0 || !h.player.alive) return;
    barrelDir(this.yaw, this.pitch, this.barrel);
    if (this.barrel.x * this.dirL.x + this.barrel.y * this.dirL.y + this.barrel.z * this.dirL.z < Math.cos(SENTRY.align)) return;
    this.fire(unit, t, p);
  }

  /** The turret's yaw axis in the world for the parked car at `p`: the range is measured from it, the gunman's place is under it. */
  private setMount(p: TrainPlacement): void {
    const m = turretMount(this.spec);
    this.mountWX = p.x + p.front * m.x; this.mountWZ = p.z + p.front * m.z;
  }

  /**
   * THE LINE OF FIRE to world point `to`, into the scratch: its pivot (train-local + world), unit direction (world + train-local) and
   * length. The pivot is that of the turret turned to point at `to` (no `yaw`: a clear-shot test for a target the gun is not on yet),
   * or of the turret turned `yaw` (the gun's own yaw: a shot). False: no length.
   */
  private lineTo(to: V3, p: TrainPlacement, yaw = NaN): boolean {
    const L = this.pivotL, o = this.pivotW;
    // (world <-> train-local is exact: the parked yaw is 0 / PI, `front` = +1 / -1)
    if (Number.isNaN(yaw)) turretPivotToward((to.x - p.x) * p.front, (to.z - p.z) * p.front, this.spec, L);
    else turretPivot(yaw, this.spec, L);
    o.x = p.x + p.front * L.x; o.y = p.railTopY + L.y; o.z = p.z + p.front * L.z;
    const dx = to.x - o.x, dy = to.y - o.y, dz = to.z - o.z, d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return false;
    this.lineD = d;
    this.dirW.x = dx / d; this.dirW.y = dy / d; this.dirW.z = dz / d;
    this.dirL.x = this.dirW.x * p.front; this.dirL.y = this.dirW.y; this.dirL.z = this.dirW.z * p.front;
    return true;
  }

  /**
   * A CLEAR SHOT to world point `to` from the pivot of the turret turned to point at it (or turned `yaw`: the gun's own, at the
   * trigger): within the elevation stops, over the car's own roof (ownHullClear), then from the virtual origin the sight line and the
   * bullet's world ray reach it, and the player's body is not near the line.
   */
  clearTo(to: V3, p: TrainPlacement, yaw = NaN): boolean {
    const h = this.host;
    this.counts.lineTests++;
    if (!this.lineTo(to, p, yaw)) return false;
    const d = this.lineD, pitch = Math.asin(Math.max(-1, Math.min(1, this.dirL.y)));
    if (pitch < SENTRY.pitchMin || pitch > SENTRY.pitchMax) return false;
    if (!ownHullClear(this.pivotL, this.dirL, d, this.spec)) return false;
    const tx = hullExit(this.pivotL, this.dirL, d, this.spec);
    if (tx === null) return false;
    this.lineT = tx;
    const o = this.originW;
    o.x = this.pivotW.x + this.dirW.x * tx; o.y = this.pivotW.y + this.dirW.y * tx; o.z = this.pivotW.z + this.dirW.z * tx;
    this.counts.rayTests++;
    if (!h.levels.lineOfSight(o, to)) return false;
    const rest = d - tx;
    const wh = raycastWorld(h.levels, h.layout.props, o, this.dirW, rest, h.layout.trench.floorY);
    if (!(wh.kind === 'none' || wh.t >= rest - SENTRY.reach)) return false;
    const pl = h.player;
    if (pl.alive) {
      this.feet.x = pl.x; this.feet.y = pl.y; this.feet.z = pl.z;
      if (!clearOfBody(this.pivotW, to, this.feet, pl.eye)) { this.counts.holds++; return false; }
    }
    return true;
  }

  /**
   * A clear shot at an enemy: its upper torso, else its head (the part into `clearPart`, the point into `aim`, the line into the
   * scratch) — for the turret turned to point at it, or turned `yaw`.
   */
  private clearShot(z: SentryEnemy, yaw = NaN): boolean {
    const p = this.host.trainRuntime?.train?.placement;
    if (!p) return false;
    if (aimPoint(z.hitVolumes, 'torso', this.aim) && this.clearTo(this.aim, p, yaw)) { this.clearPart = 'torso'; return true; }
    if (aimPoint(z.hitVolumes, 'head', this.aim) && this.clearTo(this.aim, p, yaw)) { this.clearPart = 'head'; return true; }
    return false;
  }

  /** The gunman's place for the AI (where a hit / the noise came from): under the turret's axis on the car's floor — a spot feet can go to. */
  private from(p: TrainPlacement, out: V3): V3 {
    out.x = this.mountWX; out.y = p.floorY; out.z = this.mountWZ;
    return out;
  }

  /** One aimed shot at the tracked target (the barrel is on it, the cooldown is over). */
  private fire(unit: EquipmentUnit, t: SentryEnemy, p: TrainPlacement): void {
    const h = this.host, def = this.def;
    // the line is tested again at the trigger, from the pivot at the yaw the gun has now: the target moved, a door closed, the player
    // stepped in
    if (!this.clearShot(t, this.yaw)) { this.dropTarget(); this.cooldown = SENTRY.repick; return; }
    if (this.clearPart !== this.targetPart) { this.targetPart = this.clearPart; return; } // (the other part now: swing onto it first)
    // the round leaves the hopper FIRST: never a shot without one
    const before = unit.ammo;
    if (before <= 0) return;
    const left = unit.setAmmo(before - 1);
    if (!(left < before)) return;
    this.cooldown = SENTRY.interval;
    this.counts.shots++;
    this.shotSeq++;
    // the aim line + the cone; a draw that would clip the car's own roof keeps to the aim line
    const c = coneDir(this.dirW, SENTRY.spread, this.rand);
    const dl = this.dirL;
    dl.x = c.x * p.front; dl.y = c.y; dl.z = c.z * p.front;
    let tx = ownHullClear(this.pivotL, dl, def.range, this.spec, 0) ? hullExit(this.pivotL, dl, def.range, this.spec) : null;
    if (tx === null) {
      this.counts.hullFallbacks++;
      c.x = this.dirW.x; c.y = this.dirW.y; c.z = this.dirW.z;
      tx = this.lineT;
    }
    const o = this.originW;
    o.x = this.pivotW.x + c.x * tx; o.y = this.pivotW.y + c.y * tx; o.z = this.pivotW.z + c.z * tx;
    // the player's bullet from here on (Game.fire): the world ray, then the nearest enemy volume before it
    const wh = raycastShot(h.levels, h.layout.props, o, c, def.range - tx, h.layout.trench.floorY);
    const eh = nearestEnemyHit(o, c, wh.t, h.zombies);
    const bestT = eh ? eh.t : wh.t, dist = tx + bestT;
    const end = new THREE.Vector3(o.x + c.x * bestT, o.y + c.y * bestT, o.z + c.z * bestT), dir = new THREE.Vector3(c.x, c.y, c.z);
    const base = def.damage * WeaponController.falloff(def, dist);
    const S = this.shot;
    S.result = 'none'; S.part = null; S.damage = 0; S.dist = dist; S.killed = false; S.ammo = left;
    S.end.x = end.x; S.end.y = end.y; S.end.z = end.z; S.origin.x = o.x; S.origin.y = o.y; S.origin.z = o.z;
    S.pivot.x = this.pivotW.x; S.pivot.y = this.pivotW.y; S.pivot.z = this.pivotW.z;
    h.damage?.beginShot();
    if (eh) {
      const z = eh.enemy, part = eh.part;
      const amount = base * (part === 'head' ? def.headMult : part === 'limb' ? def.limbMult : 1);
      h.damage?.hitZombie(z as never, end, dir, part, {damage: amount, pellet: false, weapon: def.id});
      const f = this.from(p, this.head);
      const killed = z.brain.damage(amount, f.x, f.z, f.y);
      z.hitFlash = 1;
      const b = z.brain, k = def.knockback * (killed ? 1.4 : 1);
      if (h.propIndex && !b.climbing) [b.x, b.z] = moveCircle(h.levels, h.propIndex, b.x, b.z, c.x * k, c.z * k, b.stats.radius, b.y, b.stats.height ?? BODY_CLEAR);
      this.counts.hits++;
      S.result = 'enemy'; S.part = part; S.damage = amount; S.killed = killed;
      if (killed) this.kill(z, dir, end, part === 'head');
      else if (h.sfx) enemyCues(z as unknown as EnemyActor).hurt(h.sfx as Sfx, z as unknown as EnemyActor);
      if (killed && z === this.target) this.dropTarget();
    } else if (wh.kind !== 'none') {
      this.counts.worldHits++;
      S.result = 'world';
      this.worldHit(wh, end, dir, base);
    } else this.counts.misses++;
    this.lastShot = S;
    // seen and heard: the flash at the muzzle, the tracer, the shared muzzle light, the positional rifle shot
    const m = turretMuzzle(this.yaw, this.pitch, this.spec, this.muzzleL);
    const muzzle = new THREE.Vector3(p.x + p.front * m.x, p.railTopY + m.y, p.z + p.front * m.z);
    h.fx?.muzzleFlash?.(muzzle, dir, false);
    h.fx?.tracer?.(muzzle, end);
    h.npcMuzzleLight?.(muzzle);
    (h.sfx as Partial<Sfx> | null | undefined)?.npcShot?.(def.sound, muzzle.x, muzzle.y, muzzle.z);
    this.noise(p);
    if (left <= 0) {
      this.counts.emptied++;
      this.dropTarget();
      h.hud.toast(SENTRY_TEXT.empty(ammoShort(unit)), true);
    }
  }

  /** A kill by the turret: the game's kill bookkeeping (Game.blastKill's, with the rifle's impulse) — the tally, the death cue, the ragdoll. */
  private kill(z: SentryEnemy, dir: THREE.Vector3, point: THREE.Vector3, head: boolean): void {
    const h = this.host;
    this.counts.kills++;
    h.stats.kills++;
    if (h.sfx) enemyCues(z as unknown as EnemyActor).death(h.sfx as Sfx, z as unknown as EnemyActor);
    h.physics?.ragdoll(z as never, {dir, point, strength: killImpulseStrength(this.def.id, 1, 1), bone: head ? 'head' : undefined});
  }

  /** The round on a surface: the lane handlers first (glass, carts), else the survivors' impact — the material's chips / mark / sound. */
  private worldHit(wh: WorldHit, point: THREE.Vector3, dir: THREE.Vector3, damage: number): void {
    const h = this.host;
    const hs = h.bulletHitHandlers;
    if (hs) for (let i = 0; i < hs.length; i++) if (hs[i](wh, point, dir, -this.shotSeq, damage)) return; // (ids below 0: never one of the player's trigger pulls)
    const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz), props = h.layout.props;
    let spec = DAMAGE_MATERIALS.concrete;
    if (wh.kind === 'prop' && wh.prop !== undefined && props[wh.prop]) spec = DAMAGE_MATERIALS[propDamageSpec(props[wh.prop].kind).cls];
    else if ((wh.kind === 'wall' || wh.kind === 'floor' || wh.kind === 'ceiling') && h.damage?.structuralClassAt) {
      const cls = h.damage.structuralClassAt(wh.kind, wh.level, point, n) as keyof typeof DAMAGE_MATERIALS;
      spec = DAMAGE_MATERIALS[cls] ?? spec;
    }
    h.fx?.impact?.(point, n, spec.fx as never, {chips: 3});
    (h.sfx as Partial<Sfx> | null | undefined)?.impact?.(point.x, point.y, point.z, spec.sound);
  }

  /** Gunfire at the train: the enemies in earshot hear it (walls / slabs muffle: the sight line is the turret's own). */
  private noise(p: TrainPlacement): void {
    const h = this.host, Lv = h.levels, zs = h.zombies;
    if (!zs.length) return;
    const src = this.from(p, {x: 0, y: 0, z: 0}), eye = this.pivotW, head = this.head;
    const bases = Lv.count > 1 ? Lv.list.map(l => l.baseY) : null;
    alertListeners(zs.map(z => z.brain) as unknown as ZombieBrain[], src, this.def.noise,
      b => { head.x = b.x; head.y = b.y + 1.5; head.z = b.z; return Lv.lineOfSight(eye, head); }, bases, !!h.layout.mall || !!h.layout.reactor);
    this.counts.noises++;
  }

  // --- QA ------------------------------------------------------------------------------------------------------------

  /** QA / tests: a compact state report. */
  qa(): {
    unit: string | null; plugged: boolean; ammo: number; cap: number; attached: boolean; model: boolean; deployed: boolean; deploy: number;
    visible: boolean; yaw: number; pitch: number; headroom: SentryHeadroom | null; target: {x: number; y: number; z: number; part: string} | null;
    cooldown: number; shots: number; counts: SentryTurretSystem['counts']; lastShot: SentryShot | null;
  } {
    const u = this.host.trainEquipment?.active('sentry') ?? null, t = this.target, r = this.host.trainRuntime?.train ? this.headroom() : null;
    const n = (v: number) => (Number.isFinite(v) ? +v.toFixed(3) : v);
    return {
      unit: u?.uid ?? null, plugged: !!u, ammo: u?.ammo ?? 0, cap: u?.def.ammoCap ?? 0, attached: !!this.view.root.parent, model: !!this.view.model,
      deployed: this.deploy >= 1, deploy: n(this.deploy), visible: this.view.root.visible, yaw: n(this.yaw), pitch: n(this.pitch),
      headroom: r ? {ok: r.ok, ceil: n(r.ceil), clearance: n(r.clearance)} : null,
      target: t ? {x: n(t.brain.x), y: n(t.brain.y), z: n(t.brain.z), part: this.targetPart} : null,
      cooldown: n(this.cooldown), shots: this.counts.shots, counts: {...this.counts}, lastShot: this.lastShot ? {...this.lastShot, end: {...this.lastShot.end}, origin: {...this.lastShot.origin}, pivot: {...this.lastShot.pivot}} : null,
    };
  }
}

/** The short name of the rounds a unit takes (its def's ammo item: '5.56mm'). */
function ammoShort(u: EquipmentUnit): string {
  return u.def.ammoItem ? itemDef(u.def.ammoItem).short : 'ammunition';
}
const NO_ROOM: SentryHeadroom = Object.freeze({ok: false, ceil: -Infinity, clearance: -Infinity});

/**
 * Installs the sentry (one call in the Game constructor, after the train equipment; registries only). The game passes its level random
 * stream: installSentryTurret(this, {rand: () => this.rand()}).
 */
export function installSentryTurret(game: Game, opts: SentryOptions = {}): SentryTurretSystem {
  const host: SentryHost = game; // (compile-time: Game really has every member the sentry reads)
  return new SentryTurretSystem(host, opts).install();
}

/** QA hook (spread into window.__LL) for the lead's short serial browser spot check. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sentryQaApi(game: unknown): Record<string, (...a: any[]) => unknown> {
  const g = game as {sentryTurret?: SentryTurretSystem};
  return {
    /** The sentry: the active unit / its rounds, the turret (attached, deployed, pose, headroom), the target, the shots and the last one. */
    sentry: () => g.sentryTurret?.qa() ?? null,
  };
}
