// Task studio-reactor-glowing-zombies-20261115-013245-01: what an IRRADIATED zombie does to the player near it — slow radiation damage
// and a Geiger counter — and the lifetime of its glow (skin + light). The rule of who is irradiated: ai/irradiated.ts.
//
// User: "Within a few metres, the player takes slow radiation damage and hears Geiger-counter feedback. Choose/document conservative
// radius, damage/falloff and distance-ramped click intensity ... Bound combined exposure so a group does not cause an accidental instant
// kill. No new equipment requirement or unrequested corpse/cargo radiation mechanic; clean up exposure/audio/lights on death/despawn/leave."
//
// DISTANCE: from the player's feet to the zombie's feet, in 3D, and only on the same storey (|dy| <= RADIATION.storeyM: a zombie on the
// walkway below / above never doses through the slab). No line-of-sight attenuation (radiation is not light): a wall between does not
// shield, but the radius is small (4 m) — documented, deliberately simple.
// DOSE (only LIVING irradiated zombies; a corpse is inert):
//  - one zombie: RADIATION.peakHpS (1 hp/s) within fullAtM (1.2 m: touching), falling off quadratically to 0 at radiusM (4 m):
//    rate(d) = peak x ((radius - d) / (radius - fullAt))^2 — 2 m 0.65 hp/s, 2.5 m 0.29, 3 m 0.13, 3.5 m 0.03;
//  - a group: the sum, SOFT-CAPPED above one zombie's peak: total = S for S <= peak, else peak + (cap - peak)(1 - e^-(S - peak)/(cap - peak))
//    (continuous, slope 1 at the knee, never above capHpS = 2.5 hp/s) — a 100 hp player takes at least 40 s of radiation alone to die,
//    in any crowd;
//  - applied through Player.takeDamage (the ordinary health / death path) in whole hit points as the dose accrues (no burst, no
//    rounding up: a fraction left when the exposure ends is forgotten), with the HUD's pain vignette at most every painEveryS. No
//    armour / mask / equipment changes it (none is required or added). Active play time only (Game frameHooks: 'playing', not the
//    transit gap; a menu / pause / death stops it). Enemy hits are unaffected.
// GEIGER (any living irradiated zombie within GEIGER.audibleM = 7 m, same storey — the ticks start ~3 m before the dose does):
//  - one zombie: a random (Poisson) count rate of maxRate x (fullAt / max(d, fullAt))^2 (inverse square, like a real counter), faded in
//    over the outer edgeM — 22 / s touching, 8 / s at 2 m, 2 / s at 4 m, ~1 / s at 5.5 m, 0 at 7 m;
//  - a group: the same soft cap (knee maxRate, ceiling capRate 32 / s); above clusterFrom (12 / s) a growing share is played as burst
//    takes of ~clusterTicks ticks each (so a hot reading is a crackle, not a capped voice pool);
//  - each tick's loudness ramps with the reading (Sfx.geigerClick k = rate / maxRate: GEIGER_AUDIO.floor .. 1), through the master (the
//    volume / mute settings apply); silent while paused (the audio context is suspended) and stopped by any state change.
// GLOW: a living irradiated zombie glows at full strength; when it dies its skin's emission and its light fade to 0 over
// RADIATION.glowFadeS (its green skin colour stays: it is still an irradiated body). A body picked up / torn down leaves the list.

import * as THREE from 'three';
import {GlowLightPool, GLOW_LIGHT, type GlowScatterHost, type GlowSource} from './glowLights';

export const RADIATION = {
  /** Dose radius (m, feet to feet) and the touching distance of the full dose. */
  radiusM: 4,
  fullAtM: 1.2,
  /** Hp / s of one zombie at fullAtM or nearer, and the ceiling of any group. */
  peakHpS: 1,
  capHpS: 2.5,
  /** Same storey: |player feet - zombie feet| at most this (m). */
  storeyM: 2.5,
  /** The pain vignette at most this often (s) while the dose runs. */
  painEveryS: 1.5,
  /** The radiation toast again only after this long (s) without a dose. */
  toastQuietS: 20,
  /** A dead irradiated zombie's glow fades out over this (s). */
  glowFadeS: 1.8,
} as const;

export const GEIGER = {
  audibleM: 7,
  /** Count rate (ticks / s) of one zombie at fullAtM or nearer, the soft-cap knee (= maxRate) and its ceiling. */
  fullAtM: 1.2,
  maxRate: 22,
  capRate: 32,
  /** Fade-in width at the audible edge (m). */
  edgeM: 1.5,
  /** Above this rate a growing share of the ticks is burst takes of about clusterTicks ticks each. */
  clusterFrom: 12,
  clusterTicks: 3,
  /** Events started in one frame at most (a long frame never machine-guns the backlog). */
  maxPerFrame: 4,
} as const;

const soft = (sum: number, knee: number, cap: number): number => {
  if (!(sum > 0)) return 0;
  if (sum <= knee) return sum;
  const span = cap - knee;
  return knee + span * (1 - Math.exp(-(sum - knee) / span));
};

/** One zombie's dose rate (hp / s) at distance d (m). */
export function doseRate(d: number): number {
  const R = RADIATION;
  if (!(d < R.radiusM)) return 0;
  if (d <= R.fullAtM) return R.peakHpS;
  const t = (R.radiusM - d) / (R.radiusM - R.fullAtM);
  return R.peakHpS * t * t;
}

/** A group's dose rate from the sum of its members' (soft cap: never above RADIATION.capHpS). */
export function combinedDose(sum: number): number {
  return soft(sum, RADIATION.peakHpS, RADIATION.capHpS);
}

/** One zombie's Geiger count rate (ticks / s) at distance d (m). */
export function clickRate(d: number): number {
  const G = GEIGER;
  if (!(d < G.audibleM)) return 0;
  const near = G.fullAtM / Math.max(d, G.fullAtM);
  return G.maxRate * near * near * Math.min(1, (G.audibleM - d) / G.edgeM);
}

/** A group's count rate from the sum of its members' (soft cap: never above GEIGER.capRate). */
export function combinedClicks(sum: number): number {
  return soft(sum, GEIGER.maxRate, GEIGER.capRate);
}

/** The share of a count rate played as burst takes (0 at / below clusterFrom, rising to 1 at capRate). */
export function clusterShare(rate: number): number {
  const G = GEIGER;
  return Math.max(0, Math.min(1, (rate - G.clusterFrom) / (G.capRate - G.clusterFrom)));
}

export interface GeigerSfx {
  /** One tick (`k` 0..1 loudness ramp; `cluster`: a burst take) — audio/sfx.ts. */
  geigerClick(k: number, cluster?: boolean): void;
}

/**
 * The Geiger counter's tick scheduler: a time-rescaled Poisson process (each event spends an exponential budget at the current rate),
 * so the reading changes with distance at once without restarting its randomness. Singles and bursts have their own budgets.
 */
export class GeigerCounter {
  ticks = 0;
  bursts = 0;
  private single: number;
  private burst: number;

  constructor(private readonly sfx: GeigerSfx, private readonly rand: () => number = Math.random) {
    this.single = this.expo();
    this.burst = this.expo();
  }

  /** One play frame at count rate `rate` (ticks / s). */
  update(dt: number, rate: number): void {
    if (!(dt > 0) || !(rate > 0)) return;
    const share = clusterShare(rate), k = Math.min(1, rate / GEIGER.maxRate);
    const singles = rate * (1 - share), bursts = rate * share / GEIGER.clusterTicks;
    let started = 0;
    this.single -= singles * dt;
    while (this.single <= 0) {
      if (started < GEIGER.maxPerFrame) { this.sfx.geigerClick(k, false); this.ticks++; started++; this.single += this.expo(); } else { this.single = this.expo(); break; }
    }
    this.burst -= bursts * dt;
    while (this.burst <= 0) {
      if (started < GEIGER.maxPerFrame) { this.sfx.geigerClick(k, true); this.bursts++; started++; this.burst += this.expo(); } else { this.burst = this.expo(); break; }
    }
  }

  /** Lifecycle (menus, death, a new section): a fresh reading next time (nothing sounds on: the ticks are a few ms). */
  reset(): void {
    this.single = this.expo();
    this.burst = this.expo();
  }

  private expo(): number {
    return -Math.log(Math.max(1e-9, 1 - this.rand()));
  }
}

/** An irradiated zombie as the system needs it (ai/zombieActor.ts ZombieActor). */
export interface IrradiatedActor {
  readonly root: THREE.Object3D;
  readonly scale: number;
  readonly brain: {readonly alive: boolean};
}

interface Tracked {
  readonly actor: IrradiatedActor;
  /** Glow strength 0..1 (skin emission + light): 1 alive, fading after death. */
  glow: number;
  readonly light: GlowSource;
}

/** The player as the dose needs it (player/player.ts: feet position). */
export interface DosedPlayer {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly alive: boolean;
  takeDamage(amount: number): void;
}

export interface IrradiationEnv {
  player(): DosedPlayer | null;
  /** The eye (the glow lights follow the zombies nearest it). */
  eye(out: THREE.Vector3): THREE.Vector3;
  pain?(amount: number): void;
  toast?(text: string): void;
  /** A tracked actor's glow changed (ai/irradiatedSkin.ts: its skin's emission). */
  glow?(actor: IrradiatedActor, strength: number): void;
}

export const RADIATION_TOAST = 'Radiation! Keep away from the glowing ones';

/** This frame's exposure (QA / tests / HUD). */
export interface RadiationExposure {
  /** Combined dose rate (hp / s) and count rate (ticks / s) applied this frame. */
  dps: number;
  cps: number;
  /** Living irradiated zombies dosing / audible; the nearest one's distance (m, Infinity: none on this storey). */
  dosing: number;
  audible: number;
  nearestM: number;
}

/** The game's irradiation (Game: one; inert where no irradiated zombie stands). */
export class Irradiation {
  readonly geiger: GeigerCounter;
  readonly lights: GlowLightPool;
  readonly exposure: RadiationExposure = {dps: 0, cps: 0, dosing: 0, audible: 0, nearestM: Infinity};
  /** Hp dealt by radiation since the station was built (QA / tests). */
  dealt = 0;
  private readonly tracked: Tracked[] = [];
  private readonly sources: GlowSource[] = [];
  private owed = 0;
  private t = 0;
  private painAt = -Infinity;
  private painOwed = 0;
  private lastDoseAt = -Infinity;
  private readonly eye = new THREE.Vector3();

  constructor(parent: THREE.Object3D, sfx: GeigerSfx, private readonly env: IrradiationEnv, rand: () => number = Math.random) {
    this.geiger = new GeigerCounter(sfx, rand);
    this.lights = new GlowLightPool(parent);
  }

  set smoke(s: GlowScatterHost | null) { this.lights.smoke = s; }

  /** Irradiated actors tracked (alive or fading). */
  get count(): number { return this.tracked.length; }

  /** Track an irradiated zombie (Game.spawnEnemy). Idempotent. */
  adopt(actor: IrradiatedActor): void {
    if (this.tracked.some(t => t.actor === actor)) return;
    const t: Tracked = {actor, glow: actor.brain.alive ? 1 : 0, light: {key: actor, x: 0, y: 0, z: 0, strength: 0}};
    this.tracked.push(t);
    this.env.glow?.(actor, t.glow);
  }

  /** Stop tracking one (a body picked up / removed: no dose, no ticks, its light released next frame). */
  forget(actor: IrradiatedActor): void {
    const i = this.tracked.findIndex(t => t.actor === actor);
    if (i >= 0) { this.env.glow?.(actor, 0); this.tracked.splice(i, 1); }
  }

  /** The glow strength of a tracked actor (undefined: not tracked). */
  glowOf(actor: IrradiatedActor): number | undefined {
    return this.tracked.find(t => t.actor === actor)?.glow;
  }

  /** One play frame (active play time only). */
  frame(dt: number): void {
    const step = Math.max(0, dt);
    this.t += step;
    const p = this.env.player();
    const live = !!p && p.alive;
    let dose = 0, clicks = 0, dosing = 0, audible = 0, nearest = Infinity;
    const src = this.sources;
    src.length = 0;
    for (const t of this.tracked) {
      const a = t.actor, alive = a.brain.alive;
      const g = alive ? 1 : Math.max(0, t.glow - step / RADIATION.glowFadeS);
      if (g !== t.glow) { t.glow = g; this.env.glow?.(a, g); }
      const pos = a.root.position;
      if (t.glow > 0) {
        t.light.x = pos.x; t.light.y = pos.y + GLOW_LIGHT.lift * a.scale; t.light.z = pos.z; t.light.strength = t.glow;
        src.push(t.light);
      }
      if (!alive || !live) continue;
      const dy = p!.y - pos.y;
      if (Math.abs(dy) > RADIATION.storeyM) continue;
      const d = Math.hypot(p!.x - pos.x, dy, p!.z - pos.z);
      nearest = Math.min(nearest, d);
      const r = doseRate(d), c = clickRate(d);
      if (r > 0) { dose += r; dosing++; }
      if (c > 0) { clicks += c; audible++; }
    }
    const dps = combinedDose(dose), cps = combinedClicks(clicks);
    Object.assign(this.exposure, {dps, cps, dosing, audible, nearestM: nearest});
    if (live && dps > 0 && step > 0) {
      this.owed += dps * step;
      const whole = Math.floor(this.owed);
      if (whole >= 1) {
        this.owed -= whole;
        p!.takeDamage(whole);
        this.dealt += whole;
        this.painOwed += whole;
        if (this.t - this.lastDoseAt > RADIATION.toastQuietS) this.env.toast?.(RADIATION_TOAST);
        this.lastDoseAt = this.t;
      }
      if (this.painOwed > 0 && this.t - this.painAt >= RADIATION.painEveryS) { this.env.pain?.(this.painOwed); this.painOwed = 0; this.painAt = this.t; }
    } else this.owed = 0;
    if (live) this.geiger.update(step, cps);
    this.lights.frame(step, src, this.env.eye(this.eye));
  }

  /** Left play (menus, death): no ticks carry over, the dose fraction is forgotten. Lights / glow stay as they are. */
  pause(): void {
    this.geiger.reset();
    this.owed = 0;
    this.painOwed = 0;
    Object.assign(this.exposure, {dps: 0, cps: 0, dosing: 0, audible: 0, nearestM: Infinity});
  }

  /** The station is torn down (travel / Retry / new game / leaving): nothing tracked, every light dark and released. */
  clear(): void {
    for (const t of this.tracked) this.env.glow?.(t.actor, 0);
    this.tracked.length = 0;
    this.sources.length = 0;
    this.lights.clear();
    this.pause();
    this.dealt = 0;
    this.lastDoseAt = this.painAt = -Infinity;
  }
}

interface IrradiationHost {
  readonly state: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly player: DosedPlayer;
  readonly sfx: GeigerSfx;
  readonly hud: {pain(amount: number): void; toast(text: string, warn?: boolean): void};
  readonly frameHooks: ((dt: number) => void)[];
  readonly stateListeners: ((state: never, prev: never) => void)[];
  readonly sectionHooks: {teardown?(): void}[];
}

/** Wire it to the game (once, at boot): the pool's lights join the scene now; frame hook, state listener and section teardown. */
export function installIrradiation(game: IrradiationHost, glow?: IrradiationEnv['glow']): Irradiation {
  const irr = new Irradiation(game.scene, game.sfx, {
    player: () => game.player,
    eye: out => game.camera.getWorldPosition(out),
    pain: amount => game.hud.pain(amount),
    toast: text => game.hud.toast(text, true),
    glow,
  });
  game.frameHooks.push(dt => { if (game.state === 'playing') irr.frame(dt); });
  (game.stateListeners as ((s: string) => void)[]).push(s => { if (s !== 'playing') irr.pause(); });
  game.sectionHooks.push({teardown: () => irr.clear()});
  return irr;
}
