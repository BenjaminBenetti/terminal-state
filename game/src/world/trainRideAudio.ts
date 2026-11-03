// Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN, item 17): the moving player train's SOUND — existing Sound Lab assets
// only (no new clip, no generation), all through the Sfx master (the volume setting applies; pause / menus silence the master).
//
// Layers (the listener rides in the car: non-positional):
//  - RUMBLE: the 'bedRumble' bed loop (Sfx.rideLoop) — the under-floor motor / wheel rumble; level, rate and lowpass follow the speed
//    continuously (eased), swelling from silence as the car pulls away (start), steady at cruise, sinking with it under the brakes
//    (decel) and gone at the stop;
//  - AIR: the 'bedWind' bed loop — the tunnel air rush, rising with the square of the speed (only really heard at cruise);
//  - RUN: 'trainDistant' windows (low-passed, slowed) at speed, never struck while arriving (a window never rings past the stop);
//  - CLACK: 'clank' (bright, short) as each bogie crosses a rail joint (RIDE_JOSTLE.jointStep), louder with speed;
//  - one-shots: the brake release + 'creak' on departure, the brake 'creak' when the service brake starts, the stop 'clank'.
// Lifecycle (TrainRide drives it): step() every ride frame; silence() on pause / a menu / any non-playing state (loops kept, level 0:
// they resume with the next ride frame); stop() on the stop at a platform, reset (new game / load / death / main menu / failed
// journey) and dispose — the loops fade out and are released: NO hum while parked.

import {RIDE_JOSTLE} from './trainRideLocal';

/** Mix / tuning (gains are x the cue's CUE_GAIN; speeds m/s). */
export const RIDE_AUDIO = {
  /** Speed at which the layers reach their cruise mix (= RIDE.cruise). */
  cruise: 15,
  /** Below this speed the loops are silent (the car at rest). */
  rest: 0.05,
  /** The rumble swells in over the first `swell` m/s (the start blend). */
  swell: 1.6,
  rumble: {level: [0.12, 0.62] as const, rate: [0.72, 1.12] as const, lowpass: [420, 1500] as const, send: 0.12},
  air: {level: 0.42, rate: [0.8, 1.15] as const, lowpass: [700, 3200] as const, send: 0.08},
  /** Easing (s) of level / rate / lowpass changes; the pause silence; the release at the stop / reset. */
  tau: 0.3, pauseFade: 0.12, stopFade: 0.6,
  run: {every: 7, minK: 0.4, gain: 0.22, maxDur: 8.5, fadeOut: 2.2, lowpass: 1100},
  clack: {gain: [0.06, 0.16] as const, rate: [1.45, 1.85] as const, lowpass: 1700},
} as const;

/** The Sfx surface used (structural: tests pass a fake). */
export interface RideLoopLike {
  setLevel(k: number, tauS?: number): void;
  setRate(r: number, tauS?: number): void;
  setLowpass(hz: number, tauS?: number): void;
  stop(fadeS?: number): void;
  readonly playing: boolean;
}
interface RideSfx {
  rideLoop?(cue: 'bedRumble' | 'bedWind', o?: {send?: number}): RideLoopLike | null;
  voice?(o: object): unknown;
  play?(v: unknown, cue: string, o?: object): unknown;
}

export type RideCueOpts = {rate?: number; gain?: number; maxDur?: number; fadeOut?: number; delay?: number; filter?: {type: BiquadFilterType; freq: number; q?: number}};

/** Plays an EXISTING cue through the Sfx master, non-positional (the listener rides in the car); guarded, best effort. */
export function rideCue(sfx: unknown, cue: string, o: RideCueOpts = {}): boolean {
  const s = sfx as RideSfx | null;
  if (!s || typeof s.voice !== 'function' || typeof s.play !== 'function') return false;
  try {
    const v = s.voice({send: 0.22, pri: 1});
    if (!v) return false;
    s.play(v, cue, {jitter: 0.03, gainJitter: 0.5, ...o});
    return true;
  } catch { return false; }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class TrainRideAudio {
  rumble: RideLoopLike | null = null;
  air: RideLoopLike | null = null;
  /** The levels last set (x CUE_GAIN), for QA / tests. */
  readonly level = {rumble: 0, air: 0};
  readonly counts = {loops: 0, stops: 0, silences: 0, clacks: 0, runs: 0, cues: 0};
  private runT = 1e9;
  private joints: [number, number] = [0, 0];
  private silent = true;

  /** `sfx`: the game's Sfx (read on use: it may be replaced / initialised later). */
  constructor(private readonly sfx: () => unknown) {}

  /** A ride begins (depart): the joint counters start at the car's travelled distance, the run timer fresh. */
  begin(dist: number): void {
    const J = RIDE_JOSTLE;
    this.joints = [Math.floor((dist - J.bogie) / J.jointStep), Math.floor((dist + J.bogie) / J.jointStep)];
    this.runT = 1e9;
  }

  /** One-shot (counted). */
  cue(cue: string, o: RideCueOpts = {}): void {
    if (rideCue(this.sfx(), cue, o)) this.counts.cues++;
  }

  /** Every ride frame: the layers follow the speed (m/s, unsigned) and the travelled distance; `arriving` = on the final approach. */
  step(dt: number, speed: number, dist: number, arriving: boolean): void {
    const A = RIDE_AUDIO, sfx = this.sfx() as RideSfx | null;
    const v = Number.isFinite(speed) ? Math.max(0, speed) : 0, k = clamp01(v / A.cruise);
    const moving = v >= A.rest;
    // the loops exist while the car moves (created on the first moving frame; a missing clip / paused audio: retried next frame)
    if (moving && sfx && typeof sfx.rideLoop === 'function') {
      if (!this.rumble?.playing) { this.rumble = sfx.rideLoop('bedRumble', {send: A.rumble.send}); if (this.rumble) this.counts.loops++; }
      if (!this.air?.playing) { this.air = sfx.rideLoop('bedWind', {send: A.air.send}); if (this.air) this.counts.loops++; }
    }
    const swell = clamp01(v / A.swell);
    const rl = moving ? lerp(A.rumble.level[0], A.rumble.level[1], k) * swell : 0;
    const al = moving ? A.air.level * k * k : 0;
    this.level.rumble = rl;
    this.level.air = al;
    this.silent = false;
    if (this.rumble) {
      this.rumble.setLevel(rl, A.tau);
      this.rumble.setRate(lerp(A.rumble.rate[0], A.rumble.rate[1], k), A.tau);
      this.rumble.setLowpass(lerp(A.rumble.lowpass[0], A.rumble.lowpass[1], k), A.tau);
    }
    if (this.air) {
      this.air.setLevel(al, A.tau);
      this.air.setRate(lerp(A.air.rate[0], A.air.rate[1], k), A.tau);
      this.air.setLowpass(lerp(A.air.lowpass[0], A.air.lowpass[1], k), A.tau);
    }
    if (!moving) { this.runT = 1e9; return; }
    // the run layer at speed (never on the final approach: a window must not ring past the stop)
    this.runT += dt;
    if (!arriving && k > A.run.minK && this.runT >= A.run.every) {
      this.runT = 0;
      this.counts.runs++;
      this.cue('trainDistant', {rate: 0.6 + 0.25 * k, gain: A.run.gain * k, maxDur: A.run.maxDur, fadeOut: A.run.fadeOut, filter: {type: 'lowpass', freq: A.run.lowpass}});
    }
    // each bogie over a rail joint
    const J = RIDE_JOSTLE;
    for (let i = 0; i < 2; i++) {
      const n = Math.floor((dist + (i === 0 ? -J.bogie : J.bogie)) / J.jointStep);
      if (n === this.joints[i]) continue;
      this.joints[i] = n;
      this.counts.clacks++;
      this.cue('clank', {rate: lerp(A.clack.rate[0], A.clack.rate[1], k), gain: lerp(A.clack.gain[0], A.clack.gain[1], k), maxDur: 0.35, fadeOut: 0.08, filter: {type: 'lowpass', freq: A.clack.lowpass}});
    }
  }

  /** Pause / a menu / any non-playing state: the loops go quiet (kept: the next ride frame brings them back with the speed). */
  silence(): void {
    if (this.silent) return;
    this.silent = true;
    this.counts.silences++;
    this.level.rumble = this.level.air = 0;
    this.rumble?.setLevel(0, RIDE_AUDIO.pauseFade / 3);
    this.air?.setLevel(0, RIDE_AUDIO.pauseFade / 3);
  }

  /** The stop / reset / failed journey / dispose: the loops fade out and are released (no hum while parked). */
  stop(fadeS: number = RIDE_AUDIO.stopFade): void {
    const had = !!(this.rumble || this.air);
    this.rumble?.stop(fadeS);
    this.air?.stop(fadeS);
    this.rumble = this.air = null;
    this.level.rumble = this.level.air = 0;
    this.silent = true;
    this.runT = 1e9;
    if (had) this.counts.stops++;
  }

  /** True while a loop is alive (QA / tests: false = nothing can hum). */
  get playing(): boolean {
    return !!(this.rumble?.playing || this.air?.playing);
  }
}
