// Task reactor-playtest-round2-20261102 (lane STARTUP): THE STARTUP AUDIO DIRECTOR — "real punch and depth as the reactor comes to life
// ... play noise as the control rods are removed! We need audio feedback big time!". It plays the startup score (startupPlan.ts) on the
// Sound Lab startup set (audio/manifest.reactorStartup.generated.ts) + the existing Reactor machine clips, all WORLD-PLACED through
// Sfx.reactorCue / reactorLoop (audio/sfx.ts: the machine chain — panner, air / occlusion lowpass, reverb send, voice cap):
//  - per stage, on a LIVE change of the restart record: a contactor thump at the control (STAGE_THUMP) — the existing fuse / breaker /
//    valve / pump / key cues still play from restart.ts — and the machine BED at the core that BUILDS with every stage (bedAt);
//  - the CONTROL RODS: while the rod hold runs (restart.ts: the handle slides up over 4 s), the rod drive loop at the console AND at the
//    CRDM drives on the vessel, its rate rising with the handle; a completed hold stops it with the heavy stop clunk at both, a let-go
//    with a light clunk; leaving play (menu / pause) stops it silently;
//  - the WIN (the restart's WinSequence clock): the SURGE at the core as the rods come out (over the existing startup swell), the ONLINE
//    impact + a deep thump as the beam fires, each tier's lights clunking on up the pit (the existing breaker clip), the beacon motor at
//    the nearest turning beacon.
// Bounded: at most 4 loops of its own (bed, two rod drives while the rods move, one beacon motor) + one-shots through the shared voice
// cap (the surge / ONLINE impact at priority 2). Nothing replays on a build / reload / revisit (the baseline is taken at build; a
// restored or QA-jumped win clock crosses no cue). Silent when audio is not running (the Sfx returns null / no-ops).

import type {StageEvent, StageSnap, WinCue} from './startupPlan';
import {STAGE_THUMP, bedAt, cuesCrossed, rodRate, stageEvents, winCues} from './startupPlan';

interface P3 { x: number; y: number; z: number }
type Cue = 'reactorStage' | 'reactorRodStop' | 'reactorSurge' | 'reactorOnline' | 'reactorBreaker';
type LoopCue = 'reactorBed' | 'reactorRodLoop' | 'reactorBeacon';
interface CueOpts { gain?: number; rate?: number; delay?: number; ref?: number; maxDist?: number; pri?: number }
/** What the director needs from audio/sfx.ts (duck-typed: tests record, an older Sfx stays silent). */
export interface StartupSfx {
  reactorCue?(cue: Cue, x: number, y: number, z: number, o?: CueOpts): void;
  reactorLoop?(cue: LoopCue, x: number, y: number, z: number, o?: {ref?: number; far?: number; level?: number; rate?: number}): StartupLoop | null;
}
export interface StartupLoop { setPos(x: number, y: number, z: number): void; stop(fadeS?: number): void; setLevel?(k: number, tauS?: number): void; setRate?(r: number, tauS?: number): void; readonly playing: boolean }

/** Mix of the director's cues (distances m). */
export const STARTUP_MIX = {
  /** Machine one-shots at a control (the stage thump): the panner's reference distance. */
  stageRef: 4,
  /** The core's events are heard pit-wide: surge / ONLINE reference distance and range. */
  coreRef: 12, coreMax: 220,
  /** Bed loop: reference distance at the core, its audible range (it must carry to the control room and up the pit). */
  bedRef: 10, bedFar: 120,
  /** Rod drive: at the console (close) and at the CRDM drives (heard from the control room). */
  rodRef: 2.5, crdmRef: 8, crdmGain: 0.8,
  /** Tier power clunks (the existing breaker clip): gain, rate at the bottom and per rank up the pit. */
  tierGain: 0.85, tierRate: 0.82, tierRateStep: 0.045, tierRef: 6, tierMax: 90,
  /** Beacon motor: one voice at the nearest turning beacon within `near` m (re-picked every `pickS`). */
  beaconNear: 18, beaconRef: 1.5, pickS: 0.5,
  /** A loop request that came back null (audio not running yet) is retried after this long. */
  retryS: 1,
} as const;

/** Where the director's sounds come from (the runtime fills it per world). */
export interface StartupSites {
  core: P3;
  /** The CRDM drives on the vessel head (the rods). */
  crdm: P3;
  /** A control's sound point (its mounted overlay), null when the control is not built. */
  control(id: 'fuse-0' | 'fuse-1' | 'breaker' | 'valve' | 'pump' | 'keyswitch' | 'rods'): P3 | null;
  /** A tier's clunk point near the listener (by bottom-up rank), null = none. */
  tier(rank: number, listener: P3): P3 | null;
  /** The nearest turning beacon head within `near` m of the listener, null = none. */
  beacon(listener: P3, near: number): P3 | null;
}

/** Counters (QA / tests). */
export interface StartupAudioCounts { stage: number; rodLoops: number; rodStops: number; rodLetGo: number; surge: number; online: number; tiers: number; bedStarts: number; beacon: number; replaysBlocked: number }

const STAGE_SITE: Readonly<Record<StageEvent, 'fuse-1' | 'breaker' | 'valve' | 'pump' | 'keyswitch' | 'rods'>> = {fuse: 'fuse-1', fuses: 'fuse-1', breaker: 'breaker', valve: 'valve', pump: 'pump', key: 'keyswitch', rods: 'rods'};

export class StartupAudio {
  readonly counts: StartupAudioCounts = {stage: 0, rodLoops: 0, rodStops: 0, rodLetGo: 0, surge: 0, online: 0, tiers: 0, bedStarts: 0, beacon: 0, replaysBlocked: 0};
  bed: StartupLoop | null = null;
  rod: StartupLoop | null = null;
  crdm: StartupLoop | null = null;
  beacon: StartupLoop | null = null;
  private snap: StageSnap | null = null;
  private cues: WinCue[] = [];
  private lastWinT = -1;
  private holding = false;
  private silenced = false;
  private bedRetry = 0;
  private rodRetry = 0;
  private beaconT = 0;
  private beaconAt: P3 | null = null;
  private time = 0;

  constructor(private readonly sfx: () => StartupSfx | null) {}

  /** A new world: the baseline (nothing replays), the bed at the restored stage (a running machine, not a replay). */
  build(snap: StageSnap, winT: number | null, tiers: number): void {
    this.stopAll(0.05);
    this.snap = {...snap};
    this.cues = winCues(tiers);
    this.lastWinT = winT ?? -1;
    if (winT !== null) this.counts.replaysBlocked += this.cues.filter(c => c.at <= winT).length; // (QA: what a naive replay would have played)
    this.holding = false;
    this.bedRetry = 0;
    this.time = 0;
  }

  /** The world is gone: every loop fades. */
  teardown(): void {
    this.stopAll(0.4);
    this.snap = null;
  }

  /** Leaving play (menu / pause / death): the rod drive stops at once and silently (the hold is let go by restart.ts too). */
  pause(): void {
    if (this.rod || this.crdm) { this.rod?.stop(0.05); this.crdm?.stop(0.05); this.rod = this.crdm = null; this.silenced = true; }
  }

  /**
   * Per frame (while playing): `snap` = the restart record now, `rodHold` = the rod hold's progress 0..1 (null: none), `winT` = the
   * live win clock (null: not restarted), `listener` = the eye.
   */
  frame(dt: number, snap: StageSnap, rodHold: number | null, winT: number | null, sites: StartupSites, listener: P3): void {
    const sfx = this.sfx();
    this.time += dt;
    const prev = this.snap ?? snap;
    // 1. stage steps (a LIVE change of the record)
    for (const ev of stageEvents(prev, snap)) {
      const t = STAGE_THUMP[ev], at = sites.control(STAGE_SITE[ev]);
      if (t && at) { this.cue(sfx, 'reactorStage', at, {gain: t.gain, rate: t.rate, ref: STARTUP_MIX.stageRef}); this.counts.stage++; }
    }
    // 2. the rods: the drive runs while the handle moves; the stop clunk when they are out; a light clunk when let go
    const holdingNow = rodHold !== null;
    if (holdingNow) {
      const at = sites.control('rods');
      if (at && (!this.rod?.playing) && this.time >= this.rodRetry) {
        this.rod = sfx?.reactorLoop?.('reactorRodLoop', at.x, at.y, at.z, {ref: STARTUP_MIX.rodRef, rate: rodRate(rodHold)}) ?? null;
        this.crdm = sfx?.reactorLoop?.('reactorRodLoop', sites.crdm.x, sites.crdm.y, sites.crdm.z, {ref: STARTUP_MIX.crdmRef, level: STARTUP_MIX.crdmGain, rate: rodRate(rodHold) * 0.9}) ?? null;
        if (this.rod) this.counts.rodLoops++;
        else this.rodRetry = this.time + 0.25;
      }
      this.rod?.setRate?.(rodRate(rodHold), 0.15);
      this.crdm?.setRate?.(rodRate(rodHold) * 0.9, 0.15);
    } else if (this.holding) {
      const done = snap.rods && !prev.rods, at = sites.control('rods');
      this.rod?.stop(done ? 0.06 : 0.12);
      this.crdm?.stop(done ? 0.06 : 0.2);
      this.rod = this.crdm = null;
      if (!this.silenced && at) {
        if (done) {
          this.cue(sfx, 'reactorRodStop', at, {gain: 1, ref: STARTUP_MIX.rodRef});
          this.cue(sfx, 'reactorRodStop', sites.crdm, {gain: 1, rate: 0.82, ref: STARTUP_MIX.crdmRef, maxDist: 120});
          this.counts.rodStops++;
        } else {
          this.cue(sfx, 'reactorRodStop', at, {gain: 0.45, rate: 1.3, ref: STARTUP_MIX.rodRef});
          this.counts.rodLetGo++;
        }
      }
    }
    if (holdingNow) this.silenced = false;
    this.holding = holdingNow;
    // 3. the win's timed cues (only a LIVE step crosses them)
    if (winT !== null) {
      for (const c of cuesCrossed(this.cues, this.lastWinT, winT)) {
        if (c.kind === 'surge') { this.cue(sfx, 'reactorSurge', sites.core, {gain: 1, ref: STARTUP_MIX.coreRef, maxDist: STARTUP_MIX.coreMax, pri: 2}); this.counts.surge++; }
        else if (c.kind === 'online') {
          this.cue(sfx, 'reactorOnline', sites.core, {gain: 1, ref: STARTUP_MIX.coreRef, maxDist: STARTUP_MIX.coreMax, pri: 2});
          this.cue(sfx, 'reactorStage', sites.core, {gain: 1, rate: 0.62, ref: STARTUP_MIX.coreRef, maxDist: 160, pri: 2});
          this.counts.online++;
        } else {
          const at = sites.tier(c.rank ?? 0, listener);
          if (at) { this.cue(sfx, 'reactorBreaker', at, {gain: STARTUP_MIX.tierGain, rate: STARTUP_MIX.tierRate + STARTUP_MIX.tierRateStep * (c.rank ?? 0), ref: STARTUP_MIX.tierRef, maxDist: STARTUP_MIX.tierMax}); this.counts.tiers++; }
        }
      }
      this.lastWinT = winT;
    }
    // 4. the machine bed at the core: builds with the stages
    const b = bedAt(snap, winT);
    if (b) {
      if (!this.bed?.playing && this.time >= this.bedRetry) {
        this.bed = sfx?.reactorLoop?.('reactorBed', sites.core.x, sites.core.y, sites.core.z, {ref: STARTUP_MIX.bedRef, far: STARTUP_MIX.bedFar, level: b.level, rate: b.rate}) ?? null;
        if (this.bed) this.counts.bedStarts++;
        else this.bedRetry = this.time + STARTUP_MIX.retryS;
      } else if (this.bed) { this.bed.setLevel?.(b.level, 1.2); this.bed.setRate?.(b.rate, 1.2); }
    } else if (this.bed) { this.bed.stop(1); this.bed = null; }
    // 5. the beacon motor at the nearest turning beacon
    this.beaconT -= dt;
    if (this.beaconT <= 0) {
      this.beaconT = STARTUP_MIX.pickS;
      const at = sites.beacon(listener, STARTUP_MIX.beaconNear);
      if (!at) { if (this.beacon) { this.beacon.stop(0.6); this.beacon = null; } }
      else if (this.beacon?.playing) { if (!this.beaconAt || at.x !== this.beaconAt.x || at.y !== this.beaconAt.y || at.z !== this.beaconAt.z) this.beacon.setPos(at.x, at.y, at.z); }
      else { this.beacon = sfx?.reactorLoop?.('reactorBeacon', at.x, at.y, at.z, {ref: STARTUP_MIX.beaconRef, far: STARTUP_MIX.beaconNear + 6}) ?? null; if (this.beacon) this.counts.beacon++; }
      this.beaconAt = at;
    }
    this.snap = {...snap};
  }

  /** Live loops (QA / tests): at most 4. */
  get loops(): number {
    return [this.bed, this.rod, this.crdm, this.beacon].filter(l => l?.playing).length;
  }

  private cue(sfx: StartupSfx | null, cue: Cue, at: P3, o: CueOpts): void {
    try { sfx?.reactorCue?.(cue, at.x, at.y, at.z, o); } catch { /* audio is never fatal */ }
  }

  private stopAll(fade: number): void {
    for (const l of [this.bed, this.rod, this.crdm, this.beacon]) l?.stop(fade);
    this.bed = this.rod = this.crdm = this.beacon = null;
    this.beaconAt = null;
  }
}
