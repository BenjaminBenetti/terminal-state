// Task studio-corpse-chipper-fuel-20261110-235304-01: the train CHIPPER'S SOUND — positional at the machine (it rides in the train: the
// runtime passes its world position every frame). Cues are Sound Lab derivatives (audio/bank.ts chipperMotor / chipperGrind /
// chipperFeed / chipperStart / chipperStop; tools/audio-pipeline/chipper-build.mjs, provenance derivatives/audio-chipper.json; levels:
// sfx.ts CUE_GAIN); a missing clip is silent. Played through the machine API of audio/sfx.ts (reactorCue one-shots, reactorLoop loops:
// the panner / air / occlusion chain of the Reactor's machines).
// CONTRACT (world/chipper.ts calls exactly these methods):
//  - start(): the motor spins up (the spin-up one-shot) and its running loop takes over CHIPPER_AUDIO.spinUpS later (fading in under the
//    spin-up's own fade). Idempotent while running (never a second spin-up or a second motor loop);
//  - feed(): a body drops into the hopper (one-shot);
//  - grind(on): the wet grinding layer (a loop over the motor while a body is being processed; the motor bogs a little under load:
//    playback rate, processing). The layer follows its own flag: grind(true) sounds even if the motor was never started;
//  - stop(): the motor winds down (one-shot) and every loop ends (the motor fades under the wind-down's running part). A no-op when
//    nothing runs (no wind-down for a machine that is already off);
//  - frame(x, y, z): the machine's world position this frame (moves the loops). Sfx.setWorld stops machine loops on a world change and
//    the bounded machine-loop pool can evict one: frame() re-requests a loop that should be running but was stopped (no spin-up cue),
//    at most once per CHIPPER_AUDIO.retryS per loop (audio not started / paused / a missing clip never re-requests every frame);
//  - silence(): end everything at once (pause / teardown / a load), no wind-down cue; the machine is then OFF for its audio: call
//    start() / grind(true) again to bring it back.
// Allocation-free per frame: the option objects are preallocated; a loop is only created on start / grind / a (rate-limited) re-request.

import type {MachineCueOpts, MachineLoopHandle, Sfx} from './sfx';

export const CHIPPER_AUDIO = {
  /** Panner reference distance (m): a compact machine in a train car (the Reactor machines use 4). */
  ref: 2.5,
  /** Audible range of the loops (m) and of the one-shots (m). */
  far: 45, maxDist: 50,
  /** The motor loop is requested this long after start(): the spin-up take reaches running speed at ~1.5-2 s and fades out from 2.2 s,
   *  while the loop fades in (Sfx MACHINE_LOOP.fadeIn 1.2 s). */
  spinUpS: 1.5,
  /** A stopped loop that should run is re-requested at most once per retryS (s). */
  retryS: 1,
  /** Motor playback rate while grinding (bogs under load) and the ease time constant (s). */
  grindMotorRate: 0.95, rateTauS: 0.6,
  /** Fade-outs (s): the grind layer when a body is done, the motor under the wind-down take, everything on silence(). */
  grindFadeS: 0.35, stopMotorFadeS: 0.6, silenceFadeS: 0.05,
} as const;

/** Wall clock in seconds (the default; tests inject their own). */
const wallClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export class ChipperAudio {
  private running = false;
  private grinding = false;
  private motor: MachineLoopHandle | null = null;
  private grindLoop: MachineLoopHandle | null = null;
  /** Clock time from which the motor loop may be requested (start() + spinUpS) / the next allowed re-request of each loop. */
  private motorAt = 0;
  private motorRetry = 0;
  private grindRetry = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  private readonly cueOpts: MachineCueOpts = {ref: CHIPPER_AUDIO.ref, maxDist: CHIPPER_AUDIO.maxDist};
  private readonly loopOpts = {ref: CHIPPER_AUDIO.ref, far: CHIPPER_AUDIO.far, rate: 1};
  /** QA counters: cues / loops requested (a loop request may come back null: audio not running or the clip missing). */
  private readonly counts = {cues: 0, motorRequests: 0, grindRequests: 0};

  constructor(readonly sfx: Sfx, private readonly clock: () => number = wallClock) {}

  start(x: number, y: number, z: number): void {
    this.at(x, y, z);
    if (this.running) return;
    this.running = true;
    this.cue('chipperStart');
    const now = this.clock();
    this.motorAt = now + CHIPPER_AUDIO.spinUpS;
    this.motorRetry = 0;
    this.ensure(now);
  }

  feed(x: number, y: number, z: number): void {
    this.at(x, y, z);
    this.cue('chipperFeed');
  }

  grind(on: boolean): void {
    if (on === this.grinding) return;
    this.grinding = on;
    if (on) {
      this.grindRetry = 0;
      this.ensure(this.clock());
    } else {
      this.grindLoop?.stop(CHIPPER_AUDIO.grindFadeS);
      this.grindLoop = null;
    }
    if (this.motor?.playing) this.motor.setRate(on ? CHIPPER_AUDIO.grindMotorRate : 1, CHIPPER_AUDIO.rateTauS);
  }

  stop(x: number, y: number, z: number): void {
    this.at(x, y, z);
    if (!this.running && !this.grinding && !this.motor && !this.grindLoop) return;
    this.cue('chipperStop');
    this.end(CHIPPER_AUDIO.stopMotorFadeS, CHIPPER_AUDIO.grindFadeS);
  }

  frame(x: number, y: number, z: number): void {
    this.at(x, y, z);
    if (this.motor) {
      if (this.motor.playing) this.motor.setPos(x, y, z);
      else this.motor = null;
    }
    if (this.grindLoop) {
      if (this.grindLoop.playing) this.grindLoop.setPos(x, y, z);
      else this.grindLoop = null;
    }
    if (this.running || this.grinding) this.ensure(this.clock());
  }

  silence(): void {
    this.end(CHIPPER_AUDIO.silenceFadeS, CHIPPER_AUDIO.silenceFadeS);
  }

  /** QA / test view (allocates: not for per-frame use). */
  debugState(): {running: boolean; grinding: boolean; motor: boolean; grind: boolean; cues: number; motorRequests: number; grindRequests: number} {
    return {running: this.running, grinding: this.grinding, motor: !!this.motor?.playing, grind: !!this.grindLoop?.playing, ...this.counts};
  }

  private at(x: number, y: number, z: number): void {
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) { this.x = x; this.y = y; this.z = z; }
  }

  private cue(cue: 'chipperStart' | 'chipperFeed' | 'chipperStop'): void {
    try { this.sfx.reactorCue(cue, this.x, this.y, this.z, this.cueOpts); this.counts.cues++; } catch { /* audio is never fatal */ }
  }

  /** Request each loop that should run and is not sounding (rate-limited per loop). */
  private ensure(now: number): void {
    if (this.running && now >= this.motorAt && !this.motor?.playing && now >= this.motorRetry) {
      this.motorRetry = now + CHIPPER_AUDIO.retryS;
      this.loopOpts.rate = this.grinding ? CHIPPER_AUDIO.grindMotorRate : 1;
      this.motor = this.loop('chipperMotor');
      this.counts.motorRequests++;
    }
    if (this.grinding && !this.grindLoop?.playing && now >= this.grindRetry) {
      this.grindRetry = now + CHIPPER_AUDIO.retryS;
      this.loopOpts.rate = 1;
      this.grindLoop = this.loop('chipperGrind');
      this.counts.grindRequests++;
    }
  }

  private loop(cue: 'chipperMotor' | 'chipperGrind'): MachineLoopHandle | null {
    try { return this.sfx.reactorLoop(cue, this.x, this.y, this.z, this.loopOpts); } catch { return null; }
  }

  private end(motorFadeS: number, grindFadeS: number): void {
    this.running = false;
    this.grinding = false;
    this.motor?.stop(motorFadeS);
    this.grindLoop?.stop(grindFadeS);
    this.motor = null;
    this.grindLoop = null;
  }
}
