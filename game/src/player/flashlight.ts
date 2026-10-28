// Iteration 12 (LIGHT): the flashlight BATTERY (mandate C), the player's soft BODY GLOW and publishing both into the shared
// light-source registry (world/lightSources.ts) that the AI / atmosphere read. Pure battery logic (FlashlightBattery, no
// three.js state) plus a small rig (PlayerLight) that drives the camera SpotLight and the glow PointLight.
//
// Battery (all in play time: Game.update only runs while 'playing', so pause / inventory / menus / death freeze the drain):
//  - charge 0..1, START 80 % on every spawn / new station / retry; drains only while the light is ON at 1/420 per second,
//    i.e. a full battery lasts 7 min of continuous light (80 % start = 5.6 min); the flicker band (below 25 %) is the
//    last 105 s of light. Off = no drain.
//  - >= 25 %: stable light (output 1).
//  - < 25 %: flicker amount a = (0.25 - charge) / 0.25 (LINEAR, 0 at 25 % .. 1 at 0 %). The light alternates between
//    stable stretches and short soft DIPS (an alternating renewal process, not a strobe):
//      * dip length       D ~ uniform [0.10, 0.34] s (mean 0.22 s), smooth envelope: 20 % fade down, hold, 45 % fade back;
//      * gap between dips G = a dead time g0 then a constant-hazard wait of rate 1 / (S - g0) evaluated with the CURRENT a
//        (so it follows the draining charge), i.e. G = g0 + Exp(mean S - g0) at a fixed charge, where
//        S = D_mean * (1 - 0.4a) / (0.4a) and g0 = min(0.12 s, S / 2);
//      => the long-run FRACTION OF LIGHT-ON TIME SPENT DIMMED = E[D] / (E[D] + E[G]) = 0.4 * a, exactly linear in a
//         (renewal-reward theorem; ~1 dip per 11 s at 24 %, ~1 per 0.9 s at 12.5 %, ~1 per 0.55 s near 0 %).
//      * dip depth (brightness removed at the bottom) = clamp(0.45 + 0.55a +- 0.1), so dips go from a half-dim near 25 %
//         to full cut-outs near 0 %; plus a steady brown-out of 1 - 0.3a.
//    Output below 0.15 counts as OFF (the beam's light source is inactive in that instant).
//  - 0 %: the light dies (off); F only gives a dry click until a battery is used.
//  - A `battery` item (items.ts recharge: 1) refills to 100 % and switches a dead light back on; it is refused at >= 99 %.
// Body glow: warm orange PointLight 0.22 cd, 2.0 m cutoff (decay 2) at chest height, always on, NEVER attracts (range 0):
// enough to keep the floor under you / a wall within ~1 m from total black; at 1.5 m from the glow it is ~1/4 of that, past
// 2.0 m nothing (the 34 cd flashlight stays the only real torch).

import * as THREE from 'three';
import type {LightSource, LightSources} from '../world/lightSources';

export const BATTERY = {
  /** Charge on spawn / new station / retry. */
  start: 0.8,
  /** Seconds of continuous light from 100 % to empty. */
  fullSeconds: 420,
  /** Charge lost per second while the light is on (1 / fullSeconds). */
  drainPerSec: 1 / 420,
  /** Flicker starts below this charge. */
  flickerBelow: 0.25,
  /** A battery item is refused at or above this charge. */
  refuseAt: 0.99,
  /** One-shot HUD warnings (re-armed by a refill). */
  lowWarn: 0.25,
  critWarn: 0.1,
} as const;

export const FLICKER = {
  /** Long-run fraction of light-on time spent inside a dip at flicker amount 1. */
  dutyMax: 0.4,
  dipMin: 0.1,
  dipMax: 0.34,
  /** Floor of a gap between dips (s), capped at half the mean gap so the mean stays exact. */
  minGap: 0.12,
  depthBase: 0.45,
  depthSlope: 0.55,
  depthJitter: 0.1,
  /** Steady dimming 1 - brownout * a below 25 %. */
  brownout: 0.3,
  /** Output below this = the light counts as off. */
  offBelow: 0.15,
  /** Dip envelope: fraction of the dip spent fading down / back up. */
  attack: 0.2,
  release: 0.45,
} as const;

/** Flicker amount: 0 at >= 25 % charge, rising LINEARLY to 1 at 0 %. */
export function flickerAmount(charge: number): number {
  return Math.max(0, Math.min(1, (BATTERY.flickerBelow - charge) / BATTERY.flickerBelow));
}

/** Expected long-run fraction of light-on time spent dimmed (inside a dip) at this charge: 0.4 * flickerAmount. */
export function dipDuty(charge: number): number {
  return FLICKER.dutyMax * flickerAmount(charge);
}

export const MEAN_DIP = (FLICKER.dipMin + FLICKER.dipMax) / 2;

/** Mean gap between dips (s) for flicker amount a > 0 (makes E[D] / (E[D] + E[G]) = dutyMax * a). */
export function meanGap(a: number): number {
  const duty = FLICKER.dutyMax * Math.max(1e-6, Math.min(1, a));
  return MEAN_DIP * (1 - duty) / duty;
}

const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** Dip envelope over its normalised time u (0..1): 0 -> 1 (fade down), hold, 1 -> 0 (fade back). */
export function dipEnvelope(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  if (u < FLICKER.attack) return smooth(u / FLICKER.attack);
  if (u > 1 - FLICKER.release) return smooth((1 - u) / FLICKER.release);
  return 1;
}

export type BatteryEvent = 'low' | 'critical' | 'died' | 'dip';

export class FlashlightBattery {
  charge: number = BATTERY.start;
  on = true;
  /** The light went out because the battery ran flat (a refill switches it back on). */
  died = false;
  /** Brightness multiplier this frame (0 = off). */
  output = 1;
  /** Diagnostics: light-on time inside the flicker band, time inside dips, dip count. */
  readonly stats = {flickerTime: 0, dipTime: 0, dips: 0};
  private phase: 'stable' | 'dip' = 'stable';
  /** Stable phase: time since the last dip, the unit-exponential hazard budget (< 0 = not drawn yet) and the hazard used. */
  private stableT = 0;
  private budget = -1;
  private acc = 0;
  /** Dip phase: time left, length, depth. */
  private dipT = 0;
  private dipLen = 0;
  private dipDepth = 0;
  private warned = 0;

  constructor(private readonly rng: () => number = Math.random, readonly drainPerSec: number = BATTERY.drainPerSec) {
    this.reset();
  }

  /** New station / retry / death: START charge, light on, no dip in progress. */
  reset(charge: number = BATTERY.start): void {
    this.charge = Math.max(0, Math.min(1, charge));
    this.on = this.charge > 0;
    this.died = !this.on;
    this.calm();
    this.warned = this.charge <= BATTERY.critWarn ? 2 : this.charge <= BATTERY.lowWarn ? 1 : 0;
    this.stats.flickerTime = this.stats.dipTime = this.stats.dips = 0;
    this.output = this.compute();
  }

  get dead(): boolean { return this.charge <= 0; }
  /** Current flicker amount (0 while the battery is above 25 %). */
  get flicker(): number { return this.charge > 0 ? flickerAmount(this.charge) : 0; }
  /** The light is actually putting light out this frame (on, charged, not in the bottom of a dip). */
  get emitting(): boolean { return this.output >= FLICKER.offBelow; }
  get dipping(): boolean { return this.phase === 'dip'; }
  /** Rounded percentage for the HUD. */
  get percent(): number { return Math.ceil(this.charge * 100 - 1e-9); }

  /** F: toggle; with a flat battery the light stays off ('dead': dry click only). */
  toggle(): 'on' | 'off' | 'dead' {
    if (this.dead) { this.on = false; this.output = 0; return 'dead'; }
    this.on = !this.on;
    this.died = false;
    this.calm();
    this.output = this.compute();
    return this.on ? 'on' : 'off';
  }

  /** QA / settings: force on/off (refused while flat). */
  setOn(v: boolean): void {
    if (v === this.on) return;
    if (v && this.dead) return;
    this.toggle();
  }

  /** Why a battery item cannot be used now (null = OK). */
  refuseReason(): string | null {
    return this.charge >= BATTERY.refuseAt ? 'Flashlight battery is already full' : null;
  }

  /** A battery item was used: charge to `to` (1 = 100 %); a light that had died comes back on. */
  refill(to = 1): boolean {
    if (this.refuseReason()) return false;
    this.charge = Math.max(this.charge, Math.min(1, to));
    if (this.died) this.on = true; // a light that ran flat comes back on; one the player switched off stays off
    this.died = false;
    this.warned = 0;
    this.calm();
    this.output = this.compute();
    return true;
  }

  /** Advance by dt seconds of PLAY time (0 / negative: no change). */
  update(dt: number): BatteryEvent[] {
    const ev: BatteryEvent[] = [];
    if (!(dt > 0)) { this.output = this.compute(); return ev; }
    if (this.on && this.charge > 0) {
      this.charge = Math.max(0, this.charge - this.drainPerSec * dt);
      if (this.charge <= BATTERY.critWarn && this.warned < 2 && this.charge > 0) { this.warned = 2; ev.push('critical'); }
      else if (this.charge <= BATTERY.lowWarn && this.warned < 1 && this.charge > 0) { this.warned = 1; ev.push('low'); }
      if (this.charge <= 0) {
        this.on = false;
        this.died = true;
        this.calm();
        this.output = 0;
        ev.push('died');
        return ev;
      }
      this.advanceFlicker(dt, ev);
    } else this.calm();
    this.output = this.compute();
    return ev;
  }

  /** No dip in progress, a fresh stable phase (outside the flicker band, light off, toggled, refilled). */
  private calm(): void {
    this.phase = 'stable';
    this.stableT = 0;
    this.budget = -1;
    this.acc = 0;
    this.dipT = 0;
  }

  private unitExp(): number {
    return -Math.log(1 - Math.min(0.999999, this.rng()));
  }

  /**
   * Alternating renewal process evaluated with the CURRENT amount a (so it follows the draining charge exactly): a stable
   * stretch is a dead time g0 = min(0.12 s, S / 2) followed by a constant-hazard wait of rate 1 / (S - g0) (a unit-
   * exponential budget integrated over time), i.e. mean S(a); then a dip of uniform length [0.10, 0.34] s.
   */
  private advanceFlicker(dt: number, ev: BatteryEvent[]): void {
    const a = this.flicker;
    if (a <= 0) { this.calm(); return; }
    this.stats.flickerTime += dt;
    const S = meanGap(a), g0 = Math.min(FLICKER.minGap, S / 2), rate = 1 / (S - g0);
    let left = dt;
    for (let guard = 0; left > 1e-12 && guard < 64; guard++) {
      if (this.phase === 'dip') {
        const step = Math.min(left, this.dipT);
        this.dipT -= step;
        left -= step;
        this.stats.dipTime += step;
        if (this.dipT > 1e-12) break;
        this.calm();
        continue;
      }
      if (this.budget < 0) { this.budget = this.unitExp(); this.acc = 0; }
      if (this.stableT < g0) {
        const step = Math.min(left, g0 - this.stableT);
        this.stableT += step;
        left -= step;
        if (left <= 1e-12) break;
      }
      const toFire = (this.budget - this.acc) / rate;
      if (toFire > left) { this.acc += rate * left; this.stableT += left; break; }
      left -= toFire;
      this.phase = 'dip';
      this.dipLen = this.dipT = FLICKER.dipMin + this.rng() * (FLICKER.dipMax - FLICKER.dipMin);
      this.dipDepth = Math.max(0, Math.min(1, FLICKER.depthBase + FLICKER.depthSlope * a + (this.rng() * 2 - 1) * FLICKER.depthJitter));
      this.stats.dips++;
      if (this.dipDepth > 0.7) ev.push('dip');
    }
  }

  private compute(): number {
    if (!this.on || this.charge <= 0) return 0;
    const a = this.flicker;
    let m = 1 - FLICKER.brownout * a;
    if (this.phase === 'dip' && this.dipLen > 0) m *= 1 - this.dipDepth * dipEnvelope(1 - this.dipT / this.dipLen);
    return Math.max(0, m);
  }
}

/**
 * Use ONE battery item: refused (null consumed, the reason returned) at >= 99 % charge; otherwise `consumeOne()` removes
 * exactly one item and only if it did is the battery refilled to `to`. Returns null on success.
 */
export function applyBatteryItem(b: FlashlightBattery, consumeOne: () => boolean, to = 1): string | null {
  const why = b.refuseReason();
  if (why) return why;
  if (!consumeOne()) return 'No battery to use';
  b.refill(to);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rig: SpotLight intensity, body glow, light-source publishing

export const BODY_GLOW = {color: 0xff8f4a, intensity: 0.22, distance: 2.0, decay: 2, /** above the feet */ height: 1.05, /** ahead of the body */ forward: 0.12} as const;

export const BEAM = {
  /** Enemies with line of sight within this distance of the beam spot notice it (scaled by the beam's brightness). */
  attractRange: 20,
  /** Beam spot raycast length (m) and refresh interval (s). */
  maxDist: 30,
  spotEvery: 0.1,
  /** The SpotLight's cone half-angle (game.ts: angle 0.58 rad). */
  cosHalfAngle: Math.cos(0.58),
} as const;

export interface V3 { x: number; y: number; z: number }

export interface PlayerLightWorld {
  sources: LightSources;
  /** Camera (eye) world position: the beam-spot ray starts here. */
  eye: V3;
  /** Player feet and facing (yaw), storey index. */
  feet: V3;
  yaw: number;
  level: number;
  /** Distance to the first surface along the unit ray (<= max), e.g. raycastWorld(levels, props, ...).t. */
  raycast(o: V3, d: V3, max: number): number;
}

export class PlayerLight {
  readonly battery: FlashlightBattery;
  readonly glow: THREE.PointLight;
  /** Registered sources (re-added if the registry was cleared). */
  beam: LightSource | null = null;
  body: LightSource | null = null;
  readonly spotPoint: V3 = {x: 0, y: 0, z: 0};
  private spotT = 0;
  private wasEmitting = false;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(readonly spot: THREE.SpotLight, readonly candela: number, rng: () => number = Math.random) {
    this.battery = new FlashlightBattery(rng);
    this.glow = new THREE.PointLight(BODY_GLOW.color, BODY_GLOW.intensity, BODY_GLOW.distance, BODY_GLOW.decay);
    this.glow.name = 'body-glow';
    this.glow.castShadow = false;
  }

  /** New station / retry: full START charge, light on; sources are re-registered on the next update. */
  reset(charge?: number): void {
    this.battery.reset(charge);
    this.beam = this.body = null;
    this.spotT = 0;
    this.wasEmitting = false;
    this.spot.intensity = this.candela * this.battery.output;
  }

  toggle(): 'on' | 'off' | 'dead' {
    const r = this.battery.toggle();
    this.spot.intensity = this.candela * this.battery.output;
    return r;
  }

  update(dt: number, w: PlayerLightWorld): BatteryEvent[] {
    const ev = this.battery.update(dt);
    const out = this.battery.output;
    this.spot.intensity = this.candela * out;
    const s = Math.sin(w.yaw), c = Math.cos(w.yaw);
    this.glow.position.set(w.feet.x - s * BODY_GLOW.forward, w.feet.y + BODY_GLOW.height, w.feet.z - c * BODY_GLOW.forward);

    const S = w.sources;
    if (!this.beam || !S.list.includes(this.beam)) {
      this.beam = S.add({kind: 'flashlight', active: false, x: 0, y: 0, z: 0, dir: {x: 0, y: 0, z: -1}, cosHalfAngle: BEAM.cosHalfAngle, spot: null, attractRange: 0, intensity: 0});
      this.wasEmitting = false;
    }
    if (!this.body || !S.list.includes(this.body)) {
      this.body = S.add({kind: 'bodyGlow', active: true, x: 0, y: 0, z: 0, dir: null, cosHalfAngle: 1, spot: null, attractRange: 0, intensity: 1});
    }

    // beam: emitter + direction from the camera-mounted SpotLight (camera matrices are current after updateCamera)
    const em = this.battery.emitting;
    this.spot.getWorldPosition(this.a);
    this.spot.target.getWorldPosition(this.b);
    this.b.sub(this.a).normalize();
    const B = this.beam;
    B.x = this.a.x; B.y = this.a.y; B.z = this.a.z;
    B.level = w.level;
    B.dir = {x: this.b.x, y: this.b.y, z: this.b.z};
    this.spotT -= dt;
    if (em && (this.spotT <= 0 || !this.wasEmitting)) {
      this.spotT = BEAM.spotEvery;
      const t = Math.max(0, Math.min(BEAM.maxDist, w.raycast(w.eye, B.dir, BEAM.maxDist)));
      this.spotPoint.x = w.eye.x + B.dir.x * t;
      this.spotPoint.y = w.eye.y + B.dir.y * t;
      this.spotPoint.z = w.eye.z + B.dir.z * t;
    }
    this.wasEmitting = em;
    B.active = em;
    B.intensity = em ? out : 0;
    B.attractRange = em ? BEAM.attractRange * out : 0;
    B.spot = em ? {...this.spotPoint} : null;

    const G = this.body;
    G.active = true;
    G.x = this.glow.position.x; G.y = this.glow.position.y; G.z = this.glow.position.z;
    G.level = w.level;
    G.spot = {x: G.x, y: G.y, z: G.z};
    G.attractRange = 0; // the glow never lures: it is only a very-near "not pitch black" fill
    G.intensity = 1;
    return ev;
  }
}
