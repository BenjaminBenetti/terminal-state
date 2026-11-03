// Task reactor-playtest-round2-20261102 (lane STARTUP): THE STARTUP SCORE as pure data — user: "sound design of reactor power up needs
// to be improved. There should be real punch and depth as the reactor comes to life. As well as spinning orange lights as the building
// comes to life! We really need to give good feedback as the player wins! Also play noise as the control rods are removed!" and "when
// the reactor comes online the fog visible through the roof should clear, with a blue beam shooting up in to the sky, from the reactor,
// it should caste light and illuminate the area." No three.js / DOM: world/reactor/startup*.ts apply it, the tests read it.
//
// Driven ONLY by the restart runtime (world/reactor/restart.ts: its persisted record, its live hold and its WinSequence clock), so:
//  - stage cues fire on a LIVE change of the record (a snapshot diff), never on a build / reload / revisit (the baseline is taken at
//    build) — nothing replays;
//  - the win's cues fire when the live win clock CROSSES their time; a restored win (finish(): t past the end) and a QA jump (a step
//    over MAX_STEP_S) cross nothing;
//  - the ONLINE sky / beam / beacons are pure functions of the win clock: a rebuilt restarted world is at the end state at once.
//
//  stage            at the control (punch)                       the core's machine BED (deep loop at the core: level / rate)
//  fuse 2 of 2      stage thump, light (relay)                   -
//  breaker          stage thump, heavy                           starts: 0.3 / 0.82 (control power hum)
//  valve            stage thump, low                             0.42 / 0.86
//  pump             stage thump                                  0.6 / 0.9
//  key              stage thump, bright                          0.7 / 0.94
//  rods (hold E)    ROD DRIVE loop at the console + the CRDM, rising with the handle; let go: a short clunk; done: the STOP CLUNK
//  rods done (t 0)  the SURGE swells at the core (6 s) over the existing startup swell; the bed climbs to 1 / 1.06; the core floor's
//                   beacons spin up and the orange wave climbs the pit (BEACON lead)
//  ONLINE (t 6)     the ONLINE impact + a deep stage thump at the core; the BLUE BEAM fires up through the roof opening; the sky over
//                   the roof starts to clear (SKY); the existing hum joins
//  t 6 .. 24        each tier's lights clunk on (the existing breaker clip at that tier, pitch rising up the pit)

//  (task reactor-surface-ending-20261102, lane AUDIO — user: "the reactor needs to have a noise when the blue beam shoots out the top!")
//  ONLINE - crack  the BEAM IGNITION at the beam column: its whoosh swell leads in, its CRACK lands as the beam fires (beamCueAt)

import type {ReactorRunState} from './runState';
import {WIN, tierStartAt} from './restartWin';
import {BEAM_IGNITION_CRACK_S} from '../../audio/manifest.reactorEnding.generated';

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const smooth = (v: number) => { const x = clamp01(v); return x * x * (3 - 2 * x); };

/** Every startup tunable (times s from the rods being withdrawn = the win clock; distances m). */
export const STARTUP = {
  /** ONLINE: the core is fully awake (restartWin's core ramp): the impact, the beam fires, the sky starts to clear. */
  onlineAtS: WIN.coreS,
  /** The beam's head climbs from the vessel to the sky in this long. */
  beamRiseS: 1.1,
  /** The sky over the roof clears from ONLINE over this long (the outdoor gas thins and lifts: gaslightRules.ts reactorOutdoorGas). */
  skyClearS: 28,
  /** Beacons: the orange wave starts on the core floor when the rods come out and reaches the rim tierSpan later (each ramps in
   *  WIN.tierRampS), i.e. tierStartS ahead of the floodlights; revolutions per second at full power. */
  beaconLeadS: WIN.tierStartS,
  beaconRev: 1.15,
  /** A win-clock step larger than this is a jump (restore / QA finish): it crosses no cue. */
  maxStepS: 1,
} as const;

/** The restart record's stage as a snapshot (what the director diffs). */
export interface StageSnap { fuses: number; breaker: boolean; valve: boolean; pump: boolean; key: boolean; rods: boolean; restarted: boolean }

export const stageSnap = (s: Readonly<ReactorRunState>): StageSnap => ({
  fuses: s.fuses.filter(Boolean).length, breaker: s.breaker, valve: s.valve, pump: s.pump, key: s.keyInserted, rods: s.rods, restarted: s.restarted,
});

export type StageEvent = 'fuse' | 'fuses' | 'breaker' | 'valve' | 'pump' | 'key' | 'rods';

/** The stage steps completed from `a` to `b` (a LIVE change), in order. `fuses` = every slot filled. */
export function stageEvents(a: Readonly<StageSnap>, b: Readonly<StageSnap>, slots = 2): StageEvent[] {
  const out: StageEvent[] = [];
  if (b.fuses > a.fuses) out.push(b.fuses >= slots ? 'fuses' : 'fuse');
  if (b.breaker && !a.breaker) out.push('breaker');
  if (b.valve && !a.valve) out.push('valve');
  if (b.pump && !a.pump) out.push('pump');
  if (b.key && !a.key) out.push('key');
  if (b.rods && !a.rods) out.push('rods');
  return out;
}

/** A stage's punch: the contactor thump at the control (gain x CUE_GAIN, playback rate). */
export const STAGE_THUMP: Readonly<Record<StageEvent, {gain: number; rate: number} | null>> = {
  fuse: null,
  fuses: {gain: 0.4, rate: 1.35},
  breaker: {gain: 1, rate: 0.9},
  valve: {gain: 0.55, rate: 0.78},
  pump: {gain: 0.8, rate: 1},
  key: {gain: 0.6, rate: 1.15},
  rods: null, // the rods have their own stop clunk + the surge
};

/** The core's machine BED (level x CUE_GAIN, playback rate) at a stage; null = silent (no control power yet). */
export function bedAt(s: Readonly<StageSnap>, winT: number | null): {level: number; rate: number} | null {
  if (!s.breaker) return null;
  if (s.rods || s.restarted) {
    const k = winT === null ? 1 : smooth(winT / STARTUP.onlineAtS);
    return {level: 0.75 + 0.25 * k, rate: 0.96 + 0.1 * k};
  }
  if (s.key) return {level: 0.7, rate: 0.94};
  if (s.pump) return {level: 0.6, rate: 0.9};
  if (s.valve) return {level: 0.42, rate: 0.86};
  return {level: 0.3, rate: 0.82};
}

/** The rod drive's playback rate over the hold's progress 0..1 (the motor works harder as the rods climb). */
export const rodRate = (p: number): number => 0.86 + 0.28 * clamp01(p);

/** Beam 0..1 at win time t (the head's height fraction: 0 before ONLINE, climbing over beamRiseS) and its brightness. */
export function beamAt(t: number): {head: number; on: number} {
  if (!(t >= STARTUP.onlineAtS)) return {head: 0, on: 0};
  const u = (t - STARTUP.onlineAtS) / STARTUP.beamRiseS;
  return {head: clamp01(u), on: 0.35 + 0.65 * smooth(u)};
}

/** The sky clearing 0..1 at win time t (0 before ONLINE). */
export const skyClearAt = (t: number): number => (t >= STARTUP.onlineAtS ? smooth((t - STARTUP.onlineAtS) / STARTUP.skyClearS) : 0);

/** Beacon power 0..1 of the tier with bottom-up rank `rank` of `n` at win time t: the orange wave, beaconLeadS ahead of the lights. */
export const beaconPowerAt = (t: number, rank: number, n: number): number =>
  smooth((t + STARTUP.beaconLeadS - tierStartAt(rank, n)) / WIN.tierRampS);

/** A timed win cue. */
export interface WinCue { at: number; kind: 'surge' | 'online' | 'tier' | 'beam'; rank?: number }

/** Lane AUDIO: the beam ignition's start on the win clock — its crack (BEAM_IGNITION_CRACK_S into the clip) lands as the beam fires. */
export const beamCueAt = (): number => Math.max(0, STARTUP.onlineAtS - Math.max(0, BEAM_IGNITION_CRACK_S));

/** The win's timed cues for n tiers (bottom-up ranks). */
export function winCues(n: number): WinCue[] {
  const out: WinCue[] = [{at: 0, kind: 'surge'}, {at: beamCueAt(), kind: 'beam'}, {at: STARTUP.onlineAtS, kind: 'online'}];
  for (let r = 0; r < n; r++) out.push({at: tierStartAt(r, n), kind: 'tier', rank: r});
  return out.sort((a, b) => a.at - b.at);
}

/** The cues a live win step from t0 to t1 crosses: (t0, t1] (t0 < 0 = the win just started: includes t = 0); none for a jump. */
export function cuesCrossed(cues: readonly WinCue[], t0: number, t1: number): WinCue[] {
  if (!(t1 > t0) || t1 - Math.max(0, t0) > STARTUP.maxStepS) return [];
  return cues.filter(c => (t0 < 0 ? c.at >= 0 : c.at > t0) && c.at <= t1);
}
