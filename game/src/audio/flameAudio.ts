// Task studio-flamethrower-fire-20261114-031614-01 (lane AUDIO): the FLAMETHROWER'S and the FIRE'S SOUND — fire/sound.ts FlameSound over
// audio/sfx.ts. Cues are Sound Lab derivatives (audio/bank.ts flameIgnite / flameRoar / flameOut / fireBurn / fireCatch / fireCollapse /
// fireEmbers; tools/audio-pipeline/fire-build.mjs, provenance derivatives/audio-fire.json; levels: sfx.ts CUE_GAIN = the build's mix
// calibration); a missing clip is silent. The tank refill and the dry trigger reuse existing cues (the jerrycan pour, the dry click).
// Played through the machine API of audio/sfx.ts (reactorCue one-shots, reactorLoop loops: the panner / air / occlusion chain) and
// Sfx.flameIgnite (the one one-shot that is cut when the trigger is released inside it).
// CONTRACT (fire/sound.ts; the fire code calls exactly these methods):
//  - streamOn(x, y, z): the jet lights at the muzzle — the ignition whoomp, and the roar LOOP comes up at once under it (its level is
//    set past the machine pool's slow fade-in). Idempotent while the stream is on (never a second roar);
//  - streamOff(dry): the roar fades in FLAME_AUDIO.jet.roarOutS, a still-sounding ignition is cut, the cut-off take plays at the
//    muzzle (`dry` = the tank ran empty: the same takes lower and slower);
//  - frame(dt, muzzle, fires): the muzzle this frame (the roar follows it) and the burning places to voice — at most FIRE_VOICES fire-bed
//    loops, each at its place with its `level`; a bed whose place left the list fades out and is released (an empty list = all of them).
//    A loop that should sound but was stopped (Sfx.setWorld on a world change, the bounded machine pool making room) is requested again;
//  - ignite(x, y, z) / burnOut(x, y, z): a prop catching fire (a soft whoomp) / a burnt prop caving in (the heavy hit + the ember
//    crackle layer over it);
//  - refill(seconds): the pour into the worn tank (at most `seconds` of it); the returned function cuts that pour (cancelled);
//  - dry(): the dry click; silence(): everything ends at once (no cut-off cue).
// BOUNDS (rapid tapping, a flickering fire list, audio paused / not started):
//  - a new roar loop at most once per jet.roarGapS, and each stopped one is gone within roarOutS + 0.05 s: never more than two exist;
//    while the trigger is held a lost roar is requested again at most once per jet.retryS;
//  - the ignition and the cut-off at most once per jet.igniteGapS / jet.outGapS (Sfx.flameIgnite also cuts a sounding ignition first);
//  - a fire bed requests a loop at most once per fire.retryS whatever the reason (a new place, an eviction, a missing clip), and a
//    released loop is gone within fire.fadeS + 0.05 s: never more than two loops per bed, three beds;
//  - simultaneous catch / collapse cues are staggered by fire.staggerS (never the same take on the same sample), at most
//    fire.staggerMax waiting (more are dropped);
//  - beds whose owner stopped calling frame() (no frame for fire.staleS) are released by the next call of any method.
// The roar is requested with `keep`: the machine pool makes room with another loop first (the player's own weapon); the fire beds are
// ordinary pool members. Allocation-free per frame: the option objects and the bed table are preallocated; a loop is only created on
// a press, a new burning place or a (rate-limited) re-request.

import {FIRE_VOICES, type FireVoice, type FlameSound} from '../fire/sound';
import type {MachineCueOpts, MachineLoopHandle, Sfx} from './sfx';

export const FLAME_AUDIO = {
  jet: {
    /** Panner reference distance (m): the muzzle is always inside it, so the wielder hears the roar at its source level. */
    ref: 2.5,
    /** Audible range of the roar loop (m) and of the jet's one-shots (m). */
    far: 45, maxDist: 50,
    /** The roar's level is set with this time constant (s) right after its request (the pool's own fade-in is 1.2 s: far too slow). */
    roarInTauS: 0.03,
    /** The roar's fade on streamOff (s). */
    roarOutS: 0.12,
    /** A new roar loop at most once per roarGapS (s); while the trigger is held, a lost one is re-requested at most once per retryS. */
    roarGapS: 0.2, retryS: 1,
    /** The ignition whoomp / the cut-off at most once per this (s); a release inside the ignition take fades it over igniteCutS. */
    igniteGapS: 0.35, outGapS: 0.25, igniteCutS: 0.1,
    /** The tank ran dry under the trigger: the cut-off takes lower and slower (processing). */
    dry: {gain: 0.7, rate: 0.82},
    /** The dry click at most once per this (s). */
    dryGapS: 0.15,
  },
  fire: {
    /** Panner reference distance of a fire bed and of the fire one-shots (m), the beds' audible range (m), the one-shots' (m). */
    ref: 3, far: 22, maxDist: 35,
    /** A burning place within this (m) of a sounding bed is that bed's fire (the bed follows it). */
    sameM: 2.5,
    /** FireVoice.level 0..1 -> bed level: floor + (1 - floor) * level (a dying patch still crackles). */
    floor: 0.3,
    /** A bed's level change is sent when it moved by levelStep, eased with levelTauS (s); its position eases with moveTauS (s). */
    levelStep: 0.03, levelTauS: 0.35, moveTauS: 0.12,
    /** A released bed's fade (s); a bed requests a loop at most once per retryS (s). */
    fadeS: 0.8, retryS: 1,
    /** Beds are released by the next call when frame() has not run for this long (s). */
    staleS: 0.75,
    /** Simultaneous catch / collapse cues: each starts staggerS after the last, at most staggerMax waiting. */
    staggerS: 0.07, staggerMax: 4,
    /** The ember crackle layer over a collapse hit: its start after the hit (s). */
    embersDelayS: 0.03,
  },
  /** Everything fades over this on silence() (s). */
  silenceFadeS: 0.05,
} as const;

/** Wall clock in seconds (the default; tests inject their own). */
const wallClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const fin3 = (x: number, y: number, z: number): boolean => Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);

/** One fire-bed slot: its loop (null = none sounding), where it is and where it should be, its level and what was last sent. */
interface Bed {
  h: MachineLoopHandle | null;
  on: boolean; used: boolean;
  x: number; y: number; z: number;
  tx: number; ty: number; tz: number;
  level: number; sent: number;
  /** Clock time of the next allowed loop request of this bed. */
  retryAt: number;
}

export class FlameAudio implements FlameSound {
  private streaming = false;
  private roar: MachineLoopHandle | null = null;
  /** Clock times: the last roar request, the next allowed one, the last ignition / cut-off / dry click, the last frame(). */
  private roarReqAt = -Infinity;
  private roarNext = -Infinity;
  private igniteAt = -Infinity;
  private outAt = -Infinity;
  private dryAt = -Infinity;
  private frameAt = -Infinity;
  /** The next free start time of a staggered catch / collapse cue. */
  private catchNext = -Infinity;
  private collapseNext = -Infinity;
  /** The muzzle (the last finite one). */
  private mx = 0;
  private my = 0;
  private mz = 0;
  private readonly beds: Bed[] = [];
  private readonly pending: boolean[] = [];
  /** The pour this object started that may still be sounding: its serial and its end (clock time). */
  private pourId = 0;
  private pourEnd = -Infinity;
  private readonly igniteOpts: MachineCueOpts = {ref: FLAME_AUDIO.jet.ref, maxDist: FLAME_AUDIO.jet.maxDist, pri: 2};
  private readonly outOpts: MachineCueOpts = {ref: FLAME_AUDIO.jet.ref, maxDist: FLAME_AUDIO.jet.maxDist, pri: 2, gain: 1, rate: 1};
  private readonly roarOpts = {ref: FLAME_AUDIO.jet.ref, far: FLAME_AUDIO.jet.far, keep: true};
  private readonly bedOpts = {ref: FLAME_AUDIO.fire.ref, far: FLAME_AUDIO.fire.far, level: 1};
  private readonly fireOpts: MachineCueOpts = {ref: FLAME_AUDIO.fire.ref, maxDist: FLAME_AUDIO.fire.maxDist, delay: 0};
  /** QA counters: cues asked of the Sfx, loop requests (a request may come back null: audio not running or the clip missing). */
  private readonly counts = {ignites: 0, outs: 0, catches: 0, collapses: 0, dropped: 0, roarRequests: 0, bedRequests: 0};

  constructor(readonly sfx: Sfx, private readonly clock: () => number = wallClock) {
    for (let i = 0; i < FIRE_VOICES; i++) {
      this.beds.push({h: null, on: false, used: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, level: 0, sent: 0, retryAt: -Infinity});
      this.pending.push(false);
    }
  }

  streamOn(x: number, y: number, z: number): void {
    if (fin3(x, y, z)) { this.mx = x; this.my = y; this.mz = z; }
    const now = this.clock();
    this.sweep(now);
    if (this.streaming) return;
    this.streaming = true;
    if (now - this.igniteAt >= FLAME_AUDIO.jet.igniteGapS) {
      this.igniteAt = now;
      this.counts.ignites++;
      try { this.sfx.flameIgnite(this.mx, this.my, this.mz, this.igniteOpts); } catch { /* audio is never fatal */ }
    }
    this.ensureRoar(now);
  }

  streamOff(dry: boolean): void {
    const now = this.clock();
    this.sweep(now);
    if (!this.streaming) return;
    this.streaming = false;
    const J = FLAME_AUDIO.jet;
    this.endRoar(J.roarOutS);
    try { this.sfx.stopFlameIgnite(J.igniteCutS); } catch { /* audio is never fatal */ }
    if (now - this.outAt >= J.outGapS) {
      this.outAt = now;
      this.counts.outs++;
      this.outOpts.gain = dry ? J.dry.gain : 1;
      this.outOpts.rate = dry ? J.dry.rate : 1;
      try { this.sfx.reactorCue('flameOut', this.mx, this.my, this.mz, this.outOpts); } catch { /* audio is never fatal */ }
    }
  }

  frame(dt: number, muzzle: {x: number; y: number; z: number} | null, fires: readonly FireVoice[]): void {
    const now = this.clock();
    this.frameAt = now;
    if (muzzle && fin3(muzzle.x, muzzle.y, muzzle.z)) { this.mx = muzzle.x; this.my = muzzle.y; this.mz = muzzle.z; }
    if (this.roar) {
      if (this.roar.playing) this.roar.setPos(this.mx, this.my, this.mz);
      else this.roar = null; // a world change / the pool made room: ensureRoar asks again
    }
    if (this.streaming) this.ensureRoar(now);
    this.assignBeds(fires);
    this.driveBeds(now, Number.isFinite(dt) && dt > 0 ? dt : 0);
  }

  ignite(x: number, y: number, z: number): void {
    if (!fin3(x, y, z)) return;
    const now = this.clock();
    this.sweep(now);
    const delay = this.stagger(now, this.catchNext);
    if (delay < 0) return;
    this.catchNext = now + delay + FLAME_AUDIO.fire.staggerS;
    this.counts.catches++;
    this.fireOpts.delay = delay;
    try { this.sfx.reactorCue('fireCatch', x, y, z, this.fireOpts); } catch { /* audio is never fatal */ }
  }

  burnOut(x: number, y: number, z: number): void {
    if (!fin3(x, y, z)) return;
    const now = this.clock();
    this.sweep(now);
    const delay = this.stagger(now, this.collapseNext);
    if (delay < 0) return;
    this.collapseNext = now + delay + FLAME_AUDIO.fire.staggerS;
    this.counts.collapses++;
    try {
      this.fireOpts.delay = delay;
      this.sfx.reactorCue('fireCollapse', x, y, z, this.fireOpts);
      this.fireOpts.delay = delay + FLAME_AUDIO.fire.embersDelayS;
      this.sfx.reactorCue('fireEmbers', x, y, z, this.fireOpts);
    } catch { /* audio is never fatal */ }
  }

  refill(seconds: number): () => void {
    const now = this.clock();
    this.sweep(now);
    const id = ++this.pourId;
    let dur = 0;
    try { dur = this.sfx.fuelPour(Number.isFinite(seconds) && seconds > 0 ? seconds : undefined); } catch { /* audio is never fatal */ }
    this.pourEnd = now + (Number.isFinite(dur) && dur > 0 ? dur : 0);
    return () => { if (id === this.pourId) this.endPour(); };
  }

  dry(): void {
    const now = this.clock();
    this.sweep(now);
    if (now - this.dryAt < FLAME_AUDIO.jet.dryGapS) return;
    this.dryAt = now;
    try { this.sfx.dry('shotgun'); } catch { /* audio is never fatal */ } // the existing dry click at its lower rate: a valve, not a hammer
  }

  silence(): void {
    const f = FLAME_AUDIO.silenceFadeS;
    this.streaming = false;
    this.endRoar(f);
    try { this.sfx.stopFlameIgnite(f); } catch { /* audio is never fatal */ }
    for (const b of this.beds) this.release(b, f);
    this.endPour();
  }

  /** QA / test view (allocates: not for per-frame use). */
  debugState(): {streaming: boolean; roar: boolean; beds: number; bedsOn: number; pouring: boolean; ignites: number; outs: number; catches: number; collapses: number; dropped: number; roarRequests: number; bedRequests: number} {
    return {streaming: this.streaming, roar: !!this.roar?.playing, beds: this.beds.filter(b => b.h?.playing).length, bedsOn: this.beds.filter(b => b.on).length,
      pouring: this.clock() < this.pourEnd, ...this.counts};
  }

  /** The roar loop while the trigger is held: requested when there is none (rate-limited), its level set at once. */
  private ensureRoar(now: number): void {
    if (this.roar) {
      if (this.roar.playing) return;
      this.roar = null;
    }
    if (now < this.roarNext) return;
    const J = FLAME_AUDIO.jet;
    this.roarReqAt = now;
    this.roarNext = now + J.retryS;
    this.counts.roarRequests++;
    let h: MachineLoopHandle | null = null;
    try {
      h = this.sfx.reactorLoop('flameRoar', this.mx, this.my, this.mz, this.roarOpts);
      h?.setLevel(1, J.roarInTauS);
    } catch { /* audio is never fatal */ }
    this.roar = h;
  }

  /** The roar ends (the trigger was released / silence): the next press may ask for a new loop roarGapS after the last request. */
  private endRoar(fadeS: number): void {
    try { this.roar?.stop(fadeS); } catch { /* audio is never fatal */ }
    this.roar = null;
    this.roarNext = Math.min(this.roarNext, this.roarReqAt + FLAME_AUDIO.jet.roarGapS);
  }

  /** Start delay (s) of a staggered one-shot whose queue is free from `next`; -1 = too many waiting (dropped, counted). */
  private stagger(now: number, next: number): number {
    const F = FLAME_AUDIO.fire, delay = Math.max(0, next - now);
    if (delay > F.staggerS * F.staggerMax) { this.counts.dropped++; return -1; }
    return delay;
  }

  /** This frame's burning places onto the beds: a place near a sounding bed keeps it, the others take a free bed. */
  private assignBeds(fires: readonly FireVoice[]): void {
    const F = FLAME_AUDIO.fire, beds = this.beds, pending = this.pending, n = Math.min(fires.length, beds.length);
    for (const b of beds) b.used = false;
    for (let i = 0; i < n; i++) {
      const f = fires[i];
      pending[i] = !!f && fin3(f.x, f.y, f.z) && f.level > 0;
      if (!pending[i]) continue;
      let best: Bed | null = null, bd = F.sameM * F.sameM;
      for (const b of beds) {
        if (b.used || !b.on) continue;
        const dx = b.tx - f.x, dy = b.ty - f.y, dz = b.tz - f.z, d = dx * dx + dy * dy + dz * dz;
        if (d <= bd) { bd = d; best = b; }
      }
      if (best) { this.claim(best, f, false); pending[i] = false; }
    }
    for (let i = 0; i < n; i++) {
      if (!pending[i]) continue;
      // a free bed first; else the bed of a place that left the list (its loop fades where it was, a new one starts at the new place)
      let pick: Bed | null = null;
      for (const b of beds) if (!b.used && !b.on) { pick = b; break; }
      if (!pick) for (const b of beds) if (!b.used) { pick = b; break; }
      if (!pick) break;
      if (pick.on) this.release(pick, F.fadeS);
      this.claim(pick, fires[i], true);
    }
    for (const b of beds) if (!b.used && b.on) this.release(b, F.fadeS);
  }

  private claim(b: Bed, f: FireVoice, fresh: boolean): void {
    const F = FLAME_AUDIO.fire;
    b.used = true;
    b.on = true;
    b.tx = f.x; b.ty = f.y; b.tz = f.z;
    if (fresh) { b.x = f.x; b.y = f.y; b.z = f.z; }
    b.level = F.floor + (1 - F.floor) * Math.min(1, f.level);
  }

  private release(b: Bed, fadeS: number): void {
    try { b.h?.stop(fadeS); } catch { /* audio is never fatal */ }
    b.h = null;
    b.on = false;
    b.used = false;
  }

  /** Every claimed bed: its loop (requested when missing, rate-limited), its eased position, its level. */
  private driveBeds(now: number, dt: number): void {
    const F = FLAME_AUDIO.fire, k = dt > 0 ? 1 - Math.exp(-dt / F.moveTauS) : 1;
    for (const b of this.beds) {
      if (!b.on) continue;
      const dx = b.tx - b.x, dy = b.ty - b.y, dz = b.tz - b.z, moving = dx * dx + dy * dy + dz * dz > 1e-4;
      if (moving) { b.x += dx * k; b.y += dy * k; b.z += dz * k; }
      if (b.h && !b.h.playing) b.h = null; // a world change / the pool made room
      if (!b.h) {
        if (now < b.retryAt) continue;
        b.retryAt = now + F.retryS;
        this.counts.bedRequests++;
        this.bedOpts.level = b.level;
        try { b.h = this.sfx.reactorLoop('fireBurn', b.x, b.y, b.z, this.bedOpts); } catch { b.h = null; }
        b.sent = b.level;
        continue;
      }
      if (moving) b.h.setPos(b.x, b.y, b.z);
      if (Math.abs(b.level - b.sent) >= F.levelStep) { b.h.setLevel(b.level, F.levelTauS); b.sent = b.level; }
    }
  }

  /** Beds whose owner stopped calling frame() are released (the contract asks for one empty frame; this is the backstop). */
  private sweep(now: number): void {
    if (now - this.frameAt <= FLAME_AUDIO.fire.staleS) return;
    for (const b of this.beds) if (b.on) this.release(b, FLAME_AUDIO.fire.fadeS);
  }

  /** Cut the pour this object started if it may still be sounding (never a later pour of the train's fuel port). */
  private endPour(): void {
    if (this.clock() >= this.pourEnd) return;
    this.pourEnd = -Infinity;
    try { this.sfx.stopFuelPour(); } catch { /* audio is never fatal */ }
  }
}
