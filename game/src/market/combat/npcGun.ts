// Task studio-market-rework-20261108-074144-01 (lane COMBAT): a hostile survivor's REAL gun — the player's own weapon definition
// (weapons/weapons.ts WEAPONS: magazine, pellets, range, damage falloff, reload times, sound kind) handled by an NPC: cadence (single shots
// / short bursts), the magazine, reloads, inaccuracy, and where a round that reaches the player lands on the body. Pure (no three.js).
//
// Damage TO THE PLAYER: per round / pellet `def.damage x falloff(distance) x damageScale` is the RAW hit; it goes through the player's
// one incoming hit pipeline as an enemy attack (Game.applyPlayerHit: the global enemy x2 once, then the worn armour pool, the injury
// save, armour wear), like a zombie's claw. The scale keeps a survivor's round in a zombie claw's range (raw 10) so a fire fight is very
// dangerous without being an instant kill per round.
import {rayCapsule, type Vec3} from '../../combat/hitscan';
import {WEAPONS, WeaponController, type WeaponDef} from '../../weapons/weapons';
import type {HitLocation} from '../../player/hits';
import type {MarketGunId} from './record';

export interface NpcGunSpec {
  /** Seconds between rounds of a burst / between single shots (min, max). */
  interval: readonly [number, number];
  /** Rounds per burst (min, max) and the pause after a burst (min, max). */
  burst: readonly [number, number];
  pause: readonly [number, number];
  /** Cone half-angle (rad) of a round (a shotgun's pellets use the gun's own hip spread round that line). */
  spread: number;
  /** Aim error at the target (m, ~1 sigma) of each burst's aim point. */
  aimError: number;
  /** Seconds the aim point lags the player (a moving player is missed more). */
  lag: number;
  /** Seconds from seeing the player to the first round (min, max). */
  reaction: readonly [number, number];
  /** Raw damage per round / pellet vs the player's own def.damage (before the enemy x2). */
  damageScale: number;
  /** Engagement range (m): farther, the shooter closes in. */
  range: number;
  /** The NPC's reload time vs the player's (a calm reload is not a drill). */
  reloadMult: number;
}

export const NPC_GUNS: Readonly<Record<MarketGunId, NpcGunSpec>> = {
  // pistol 17 x 0.5 = raw 8.5 (17 after the enemy x2; zombie claw raw 10)
  pistol: {interval: [0.42, 0.75], burst: [1, 1], pause: [0, 0], spread: 0.03, aimError: 0.22, lag: 0.28, reaction: [0.45, 0.9], damageScale: 0.5, range: 28, reloadMult: 1.3},
  // rifle 24 x 0.38 = raw 9.1 per round, bursts of 2-4
  rifle: {interval: [0.13, 0.18], burst: [2, 4], pause: [0.75, 1.35], spread: 0.026, aimError: 0.24, lag: 0.3, reaction: [0.55, 1.0], damageScale: 0.38, range: 40, reloadMult: 1.3},
  // shotgun 9 pellets x 15 x 0.28 = raw 4.2 each (all nine point blank = raw 38), falling off past 7 m
  shotgun: {interval: [1.05, 1.5], burst: [1, 1], pause: [0, 0], spread: 0.01, aimError: 0.16, lag: 0.25, reaction: [0.5, 0.95], damageScale: 0.28, range: 16, reloadMult: 1.25},
};

/** Raw damage of one round / pellet of `gun` reaching the player `dist` m away (before the player's hit pipeline). */
export function npcRoundDamage(gun: MarketGunId, dist: number): number {
  const def = WEAPONS[gun];
  return def.damage * WeaponController.falloff(def, dist) * NPC_GUNS[gun].damageScale;
}

/** Seconds a reload of `gun` takes the NPC with `mag` rounds left (magazine: the empty / tactical time; shells: one at a time). */
export function npcReloadTime(gun: MarketGunId, mag: number, spare: number): number {
  const def: WeaponDef = WEAPONS[gun], R = def.reload, k = NPC_GUNS[gun].reloadMult;
  if (R.kind === 'magazine') return (mag > 0 ? R.time : R.emptyTime) * k;
  const shells = Math.max(1, Math.min(def.magazine - mag, spare));
  return (R.start + R.each * shells + R.end) * k;
}

/** A shooter's gun state: magazine, spare rounds, cadence (bursts), reloads. Deterministic given its random stream. */
export class NpcGun {
  readonly def: WeaponDef;
  readonly spec: NpcGunSpec;
  /** Seconds until the next round may leave. */
  cooldown = 0;
  /** Rounds left in the current burst. */
  private burstLeft = 0;
  /** > 0 while reloading: seconds left. */
  reloadT = 0;
  reloadTotal = 0;
  readonly counts = {rounds: 0, reloads: 0};

  constructor(readonly gun: MarketGunId, public mag: number, public spare: number, private readonly rand: () => number) {
    this.def = WEAPONS[gun];
    this.spec = NPC_GUNS[gun];
  }

  get reloading(): boolean { return this.reloadT > 0; }
  /** Out of rounds altogether (magazine and spares). */
  get dry(): boolean { return this.mag <= 0 && this.spare <= 0; }
  /** A round can leave now. */
  get ready(): boolean { return !this.reloading && this.mag > 0 && this.cooldown <= 0; }
  /** The next round starts a new burst (a fresh aim point). */
  get burstStart(): boolean { return this.burstLeft <= 0; }

  /** Advance the timers; returns 'reloaded' on the frame a reload completes. */
  tick(dt: number): 'reloaded' | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadT <= 0) return null;
    this.reloadT -= dt;
    if (this.reloadT > 0) return null;
    this.reloadT = 0;
    const n = Math.min(this.def.magazine - this.mag, this.spare);
    this.mag += n;
    this.spare -= n;
    this.counts.reloads++;
    this.burstLeft = 0;
    return 'reloaded';
  }

  /** One round leaves (the caller checked `ready`): its pellet count. The cadence follows the gun's burst pattern. */
  fire(): number {
    const S = this.spec, r = this.rand;
    if (this.burstLeft <= 0) this.burstLeft = S.burst[0] + Math.floor(r() * (S.burst[1] - S.burst[0] + 1));
    this.mag--;
    this.burstLeft--;
    this.counts.rounds++;
    const lerp = (a: readonly [number, number]) => a[0] + r() * (a[1] - a[0]);
    // a pump / slide / trigger reset never beats the player's own gun (def.interval)
    this.cooldown = Math.max(this.def.interval, lerp(S.interval)) + (this.burstLeft <= 0 ? lerp(S.pause) : 0);
    return this.def.pellets;
  }

  /** Start a reload (no-op without spares or with a full magazine). */
  startReload(): boolean {
    if (this.reloading || this.spare <= 0 || this.mag >= this.def.magazine) return false;
    this.reloadTotal = this.reloadT = npcReloadTime(this.gun, this.mag, this.spare);
    return true;
  }
}

/** What an NPC round reads of the player (feet y, world eye height, facing, stance). */
export interface PlayerBody { x: number; y: number; z: number; eye: number; yaw: number; radius: number }
/** The body above the eye (player/player.ts HEAD_ABOVE_EYE). */
const HEAD_ABOVE_EYE = 0.12;
/** Body capsule radius (m): the player's collision radius less clothing slack. */
const BODY_R = 0.26;

/** The player's centre of mass (an NPC's aim point). */
export function playerChest(p: PlayerBody): Vec3 {
  const top = p.eye + HEAD_ABOVE_EYE;
  return {x: p.x, y: p.y + (top - p.y) * 0.62, z: p.z};
}

/**
 * A round o + d t (unit d) against the player's body capsule (feet to the top of the head) before `maxT` (the world hit): null, or the
 * distance and the body part it lands on — by height (head above 87 % of the stature, legs below 48 %), arms off the torso's sides.
 */
export function playerBulletHit(o: Vec3, d: Vec3, maxT: number, p: PlayerBody): {t: number; location: HitLocation} | null {
  const top = p.eye + HEAD_ABOVE_EYE, r = Math.min(BODY_R, p.radius);
  const t = rayCapsule(o, d, {x: p.x, y: p.y + r, z: p.z}, {x: p.x, y: top - r, z: p.z}, r);
  if (!(t < maxT)) return null;
  const hx = o.x + d.x * t, hy = o.y + d.y * t, hz = o.z + d.z * t;
  const h = (hy - p.y) / Math.max(0.5, top - p.y);
  let location: HitLocation;
  if (h >= 0.87) location = 'head';
  else if (h <= 0.48) location = 'leg';
  else {
    const side = Math.abs((hx - p.x) * Math.cos(p.yaw) - (hz - p.z) * Math.sin(p.yaw)); // along the player's right axis
    location = side > 0.15 ? 'arm' : 'torso';
  }
  return {t, location};
}

/** A direction inside a cone of half-angle `spread` round unit `d` (uniform over the disc, like Game.fire's pellets). */
export function coneDir(d: Vec3, spread: number, rand: () => number): Vec3 {
  if (spread <= 0) return {...d};
  // an orthonormal basis round d
  const ax = Math.abs(d.y) < 0.95 ? {x: 0, y: 1, z: 0} : {x: 1, y: 0, z: 0};
  let rx = d.y * ax.z - d.z * ax.y, ry = d.z * ax.x - d.x * ax.z, rz = d.x * ax.y - d.y * ax.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * d.z - rz * d.y, uy = rz * d.x - rx * d.z, uz = rx * d.y - ry * d.x;
  const a = rand() * Math.PI * 2, r = Math.tan(spread * Math.sqrt(rand()));
  const x = d.x + (rx * Math.cos(a) + ux * Math.sin(a)) * r, y = d.y + (ry * Math.cos(a) + uy * Math.sin(a)) * r, z = d.z + (rz * Math.cos(a) + uz * Math.sin(a)) * r;
  const l = Math.hypot(x, y, z) || 1;
  return {x: x / l, y: y / l, z: z / l};
}
