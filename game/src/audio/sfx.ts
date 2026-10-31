// Game SFX: Sound Lab clips only (root CLAUDE.md "Sound effects: Sound Lab only", user rule 2026-10-26).
//
// Every audible cue plays a bundled, relative derivative of a raw Sound Lab generation through
// WebAudio (bank.ts; provenance in public/assets/derivatives/audio-iteration05.json). There are no
// oscillators, no noise buffers and no synthesised fallback: a cue whose clip is missing or not yet
// decoded is SILENT and counted (debugState().bank.silentPlays / silentCues).
//
// Lifecycle: exactly ONE AudioContext for the page lifetime (never closed or recreated), one ambient
// system, and a single "desired" run state. Menus mute the master gain; the context is never
// suspended by the game, only resumed (reconciled against its real state after every settle). Any
// later user gesture also re-resumes a context the browser left suspended. Clip bytes download while
// the page loads; decodeAudioData runs in this context after the first gesture.
//
// Graph (built once in create(), reused for every station):
//   clip sources -> voice in -> [air/occlusion lowpass] -> panner -> master -> compressor -> out
//                            \-> send -> reverbIn -> preDelay -> convolver A|B -> wet A|B -> revOut -> master
//   player hit confirm (iteration 12): clip -> voice in -> StereoPanner (±0.3) -> master   (no PannerNode / lowpass)
//   flare burn loops (iteration 12): loop source -> fade -> level -> lowpass -> panner -> master (+ send)
//   ambient: looping bed clips (wind, rumble, HVAC, fridge, buzz) -> bed gains -> ambBus -> master
//            + a positional fridge-hum emitter (same clip) at the nearest vending machine / cooler.
// Processing only: panners, filters, gains, playback-rate jitter and convolution reverb (reverb.ts).
// Bounded cost: voice cap + priorities, HRTF cap, per-category token buckets, distance culling,
// 2 convolvers total.

import {ClipBank, type Clip, type CueId} from './bank';
import {FAN_SOUND, audibleFans, type FanSource} from './fanSound'; // task studio-alpha-track2-round2-20261031-01 (R4): fan noise
import {makeIR} from './reverb';
import type {ImpactFamily} from '../physics/chunks';
import {VOCAL_GATE, vocalGain} from '../ai/vocalReach'; // Task office-overhaul-20261030 (lane AUDIO): enemy vocals by navigable route

/**
 * Task office-overhaul-20261030 (lane AUDIO, user #4 "over grunting" through the office floors): navigable route (m) from the
 * listener's player to a world point; Infinity = out of reach. The game passes its shared field (ai/vocalReach.ts VocalReach);
 * without one (tests, tools) enemy vocals keep the straight-line behaviour (the vocal voice cap still applies).
 */
export interface VocalReachQuery { pathTo(x: number, y: number, z: number): number }
/** Enemy vocal category (VOCAL_GATE in ai/vocalReach.ts): idle / chase moans and growls, or the alert when it first sees the player. */
export type VocalKind = 'idle' | 'alert';

type Desired = 'running' | 'suspended';
export type RoomKind = 'large' | 'medium' | 'small' | 'tunnel';
/** Impact surfaces; 'glass' / 'sheet' (thin sheet metal) are iteration-06 Lane D breaking cues. */
export type Surface = 'concrete' | 'tile' | 'metal' | 'flesh' | 'wood' | 'glass' | 'sheet';
/** Iteration 06 (Lane D): one-shot breakage cues (glass shatter, wood break, rubble fall, flesh tear). */
export type BreakCue = 'breakGlass' | 'breakWood' | 'debrisFall' | 'fleshTear';
export type CasingKind = 'rifle' | 'shell';
interface Pos { x: number; y: number; z: number }
/** Eye height over the feet (m): the fan storey gate compares the listener's feet with a fan's floor. */
const FAN_EYE_H = 1.6;
type BedName = 'wind' | 'rumble' | 'hvac' | 'fridge' | 'buzz';
const BED_CUE: Record<BedName, CueId> = {wind: 'bedWind', rumble: 'bedRumble', hvac: 'bedHvac', fridge: 'bedFridge', buzz: 'bedBuzz'};

/** Reverb + weapon slap-back character per room kind. */
export const ROOMS: Record<RoomKind, {len: number; rt: number; pre: number; wet: number; er: number; flutter: number; damp: number; slap: number; slaps: number}> = {
  tunnel: {len: 3.0, rt: 2.6, pre: 0.02, wet: 0.5, er: 0.05, flutter: 0.024, damp: 1.1, slap: 0.13, slaps: 2},
  large: {len: 2.4, rt: 2.0, pre: 0.03, wet: 0.45, er: 0.06, flutter: 0, damp: 0.9, slap: 0.11, slaps: 1},
  medium: {len: 1.2, rt: 0.9, pre: 0.012, wet: 0.34, er: 0.03, flutter: 0, damp: 1.4, slap: 0, slaps: 0},
  small: {len: 0.5, rt: 0.38, pre: 0.004, wet: 0.26, er: 0.012, flutter: 0, damp: 2.2, slap: 0, slaps: 0},
};

interface BedProfile { wind: number; rumble: number; hvac: number; fridge: number; buzz: number; drips: number; creaks: number; rumbles: number; flickers: number }
const BED = (wind: number, rumble: number, hvac: number, fridge: number, buzz: number, drips: number, creaks: number, rumbles: number, flickers = 0.1): BedProfile => ({wind, rumble, hvac, fridge, buzz, drips, creaks, rumbles, flickers});
/** Ambient bed mix per area type (0..1 per bed; event rates are per-minute-ish weights). */
const BEDS: Record<string, BedProfile> = {
  'platform': BED(1, 1, 0.15, 0, 0.2, 0.3, 0.5, 1, 0.2),
  'track': BED(1, 1, 0, 0, 0, 0.5, 0.6, 1, 0),
  'passage': BED(0.45, 0.55, 0.45, 0, 0.25, 0.2, 0.3, 0.6, 0.2),
  'exit-stair': BED(0.6, 0.4, 0.3, 0, 0.2, 0.2, 0.3, 0.4, 0.15),
  'fare-hall': BED(0.15, 0.4, 0.9, 0.15, 0.2, 0, 0.2, 0.5, 0.15),
  'concourse': BED(0.15, 0.4, 1, 0.25, 0.15, 0, 0.2, 0.5, 0.1),
  'food-court': BED(0.05, 0.3, 0.9, 1, 0.2, 0.1, 0.1, 0.4, 0.1),
  'retail-arcade': BED(0.1, 0.35, 0.85, 0.5, 0.25, 0, 0.2, 0.4, 0.15),
  'service-corridor': BED(0.1, 0.45, 0.3, 0, 1, 0.8, 0.8, 0.5, 0.6),
  'utility': BED(0, 0.4, 0.2, 0.6, 0.9, 0.6, 0.6, 0.4, 0.5),
  'washroom': BED(0, 0.25, 0.35, 0, 0.5, 1, 0.2, 0.3, 0.4),
  'stock-room': BED(0, 0.25, 0.2, 0.3, 0.35, 0.3, 0.5, 0.3, 0.3),
  'storage': BED(0, 0.25, 0.12, 0, 0.3, 0.3, 0.5, 0.3, 0.3),
  'agent-office': BED(0, 0.2, 0.25, 0.2, 0.3, 0.1, 0.2, 0.3, 0.2),
  'crew-room': BED(0, 0.2, 0.2, 0.4, 0.3, 0.2, 0.2, 0.3, 0.2),
  'supply-closet': BED(0, 0.18, 0.05, 0, 0.25, 0.3, 0.3, 0.25, 0.3),
  'janitor-closet': BED(0, 0.18, 0.05, 0, 0.25, 0.6, 0.3, 0.25, 0.3),
};
const BEDS_BY_KIND: Record<RoomKind, BedProfile> = {
  tunnel: BEDS['platform'], large: BEDS['concourse'], medium: BEDS['passage'], small: BEDS['storage'],
};
/**
 * Bed gains at profile level 1. Bed clips are RMS-levelled to -20 dBFS in the pipeline, so these
 * set the absolute ambience level (first estimate; tune by ear).
 */
const BED_GAIN: Record<BedName, number> = {wind: 0.3, rumble: 0.34, hvac: 0.2, fridge: 0.1, buzz: 0.08};
/** Global ambience trim (single knob for the final ear pass). */
export const AMBIENT_LEVEL = 1;

/**
 * Per-cue mix gain. One-shot clips are peak-normalised to -1 dBFS in the pipeline, so these are the
 * relative levels of the mix (first estimates; tune by ear in one place).
 */
export const CUE_GAIN: Record<CueId, number> = {
  rifleShot: 1, shotgunShot: 1, pistolShot: 1, shotgunPump: 0.42, shellInsert: 0.4, rifleMagOut: 0.38, rifleMagIn: 0.42, rifleCharge: 0.45,
  rifleMagDrop: 0.3, dryFire: 0.35, equip: 0.28, hitTick: 0.22, hitKill: 0.32,
  impactConcrete: 0.55, impactTile: 0.55, impactMetal: 0.5, impactWood: 0.55, impactFlesh: 0.5,
  impactGlass: 0.5, impactSheetMetal: 0.48, fleshTear: 0.42, breakGlass: 0.62, breakWood: 0.58, debrisFall: 0.32,
  itemCan: 0.34, itemLight: 0.3, chunkFlesh: 0.34, propTopple: 0.5, // iteration 07 (Lane K)
  casingBrass: 0.3, casingHull: 0.32, bodyFall: 0.6,
  stepConcrete: 0.16, stepTile: 0.16, stepConcreteRun: 0.2, stepTileRun: 0.2, stepConcreteSneak: 0.14, stepTileSneak: 0.14,
  jump: 0.16, land: 0.3, crouch: 0.13, ladder: 0.24,
  zombieGroan: 0.55, zombieGroanDeep: 0.6, zombieAttack: 0.6, zombieDeath: 0.6, zombieStep: 0.26, zombieStepHeavy: 0.3,
  creatureGrowl: 0.5, creatureSnarl: 0.6, creatureBite: 0.58, creatureYelp: 0.55, creatureDeath: 0.6, creatureStep: 0.24, // iteration 07 (Lane Q)
  // Task track1-siren-blightbelly-20261031 (lane AUDIO): the t1-* clips are LOUDNESS-levelled (hum / hiss -18, scream -16 LUFS; burst peak-bound), so these gains set the
  // mix directly (derivatives/audio-track1.json mixCalibration, momentary max at the source): scream -15.8 LUFS = the loudest enemy
  // vocal (+2.7 LU over a zombie groan, +1.3 over a zombie death; peak -6.7 dBFS, through the existing compressor — no clipping
  // jump); hum -24.3 (soft, ~6 LU under a groan); burst -20.8 with a -1.9 dBFS transient; hiss -24.9 (~ a flesh tear).
  sirenHum: 0.3, sirenScream: 0.9, blightBurst: 0.9, blightHiss: 0.32,
  hurt: 0.45, death: 0.55, heartbeat: 0.4, breath: 0.12, cough: 0.38, // cough: restrained player vocal (gas feedback), below hurt
  bedWind: 1, bedRumble: 1, bedHvac: 1, bedFridge: 1, bedBuzz: 1,
  drip: 0.2, creak: 0.26, clank: 0.2, trainDistant: 0.55, flicker: 0.1,
  cabinetOpen: 0.4, cabinetClose: 0.42, crateOpen: 0.4, crateClose: 0.42, vendingPry: 0.42, vendingClose: 0.4,
  coolerOpen: 0.38, coolerClose: 0.38, drawerOpen: 0.38, search: 0.24,
  pickup: 0.3, heal: 0.3, eatChips: 0.3, eatChocolate: 0.3, eatBeans: 0.3, eatNoodles: 0.3, eat: 0.3,
  drinkCola: 0.3, drinkWater: 0.3, drinkJuice: 0.3, denied: 0.22, click: 0.3, win: 0.35,
  // Iteration 12 (AUDIO): flashlight battery + thrown flare. flareBurn is an RMS -20 dBFS loop (positional, rolls off);
  // the others are peak -1 dBFS one-shots. flashlightFlicker is deliberately faint (a failing contact at the hand).
  batteryInsert: 0.4, flareIgnite: 0.55, flareBurn: 0.5, flareOut: 0.45, flashlightFlicker: 0.13,
};

const TYPE_ROOM: Record<string, RoomKind> = {
  'platform': 'tunnel', 'track': 'tunnel',
  'concourse': 'large', 'food-court': 'large', 'retail-arcade': 'large', 'fare-hall': 'large',
  'passage': 'medium', 'service-corridor': 'medium', 'exit-stair': 'medium', 'washroom': 'medium', 'stock-room': 'medium',
  'agent-office': 'small', 'crew-room': 'small', 'utility': 'small', 'storage': 'small', 'supply-closet': 'small', 'janitor-closet': 'small',
};
/** Track 2 (VIS): ambience-bed key of an area for Sfx.setRoom: a track tunnel takes the track-bed mix, others their type. */
export function ambienceTypeFor(area: {type: string}): string {
  return (area as {ext?: string}).ext === 'tunnel' ? 'track' : area.type;
}

/** Public, hard-floored areas (terrazzo/tile) -> crisper footsteps. */
const TILE_FLOOR = new Set(['passage', 'fare-hall', 'concourse', 'food-court', 'retail-arcade', 'washroom', 'exit-stair']);

/** Map a generated area (any RoomType, incl. ones added later) to a reverb room kind. */
export function roomKindFor(area: {type: string; kind?: string; w?: number; h?: number}): RoomKind {
  // Track 2 (VIS): the track tunnels beyond the beds ring like the bed itself; service annexes go by their room types.
  if ((area as {ext?: string}).ext === 'tunnel') return 'tunnel';
  const m2 = (area.w ?? 0) * (area.h ?? 0) * 0.25; // cells are 0.5 m
  const known = TYPE_ROOM[area.type];
  if (known === 'large' && m2 > 0 && m2 < 90) return 'medium';
  if (known === 'small' && m2 > 140) return 'medium';
  if (known) return known;
  if (area.kind === 'platform') return 'tunnel';
  if (area.kind === 'closet') return 'small';
  if (area.kind === 'passage' || area.kind === 'service') return 'medium';
  if (area.kind === 'concourse') return m2 > 0 && m2 < 90 ? 'medium' : 'large';
  return m2 > 260 ? 'large' : m2 > 55 ? 'medium' : 'small';
}

/** Positions of humming fixtures (vending machines, stall coolers) for the positional hum emitter. */
export function humEmitters(props: readonly {kind: string; x: number; y: number; z: number; h: number}[]): Pos[] {
  return props.filter(p => p.kind === 'vending' || p.kind === 'stall' || p.kind === 'shopCooler' || p.kind === 'fridge').map(p => ({x: p.x, y: p.y + Math.min(1.2, p.h * 0.6), z: p.z}));
}

/** Container / loot-holder kind -> door/lid cues (surfaces without a door only rummage). */
const OPEN_CUE: Record<string, CueId> = {
  cabinetTall: 'cabinetOpen', cabinetLow: 'cabinetOpen', gunLocker: 'cabinetOpen', medCabinet: 'cabinetOpen', staffLockers: 'cabinetOpen', locker: 'cabinetOpen',
  // vending: no open cue — pry() already plays the strain + latch snap that ends in the opening
  crate: 'crateOpen', fridge: 'coolerOpen', shopCooler: 'coolerOpen',
  desk: 'drawerOpen', monitorDesk: 'drawerOpen', kitchenette: 'cabinetOpen',
};
const CLOSE_CUE: Record<string, CueId> = {
  cabinetTall: 'cabinetClose', cabinetLow: 'cabinetClose', gunLocker: 'cabinetClose', medCabinet: 'cabinetClose', staffLockers: 'cabinetClose', locker: 'cabinetClose',
  crate: 'crateClose', vending: 'vendingClose', fridge: 'coolerClose', shopCooler: 'coolerClose',
  desk: 'drawerOpen', monitorDesk: 'drawerOpen', kitchenette: 'cabinetClose',
};
const EAT_CUE: Record<string, CueId> = {chips: 'eatChips', chocolate: 'eatChocolate', beans: 'eatBeans', noodles: 'eatNoodles'};
const DRINK_CUE: Record<string, CueId> = {cola: 'drinkCola', water: 'drinkWater', juice: 'drinkJuice'};
/** Iteration 07 (Lane K): rigid item / chunk contact families -> Sound Lab cues (bank i07k + reused impacts). */
const PHYS_CUE: Record<ImpactFamily, CueId> = {can: 'itemCan', light: 'itemLight', heavy: 'impactMetal', prop: 'propTopple', flesh: 'chunkFlesh', stone: 'debrisFall', wood: 'impactWood', glass: 'impactGlass', metal: 'impactSheetMetal'};
const IMPACT_CUE: Record<Surface, CueId> = {concrete: 'impactConcrete', tile: 'impactTile', metal: 'impactMetal', wood: 'impactWood', flesh: 'impactFlesh', glass: 'impactGlass', sheet: 'impactSheetMetal'};

/**
 * `fg` = a foreground (listener-relative) player hit confirm, bounded by HIT_CONFIRM.maxVoices. `vocal` (task
 * office-overhaul-20261030, lane AUDIO) = an enemy vocal's rank distance (m) in the VOCAL_GATE.cap simultaneous vocals.
 */
interface Voice { inp: GainNode; nodes: AudioNode[]; srcs: AudioScheduledSourceNode[]; pending: number; end: number; hrtf: boolean; fg?: boolean; vocal?: number }
interface VoiceOpts {
  /** World position; omitted = at the listener (player's own sounds, UI). */
  at?: Pos;
  gain?: number;
  /** Reverb send (0..1). */
  send?: number;
  /** 0 = expendable (casings, steps), 1 = normal, 2 = never dropped (own gunshots, pain). */
  pri?: number;
  ref?: number;
  rolloff?: number;
  maxDist?: number;
  hrtf?: boolean;
  occlude?: boolean;
  /** Cap on the occlusion amount (0..1) so a slab / wall muffles but never silences. */
  occMax?: number;
  /** Listener-relative voices only (no `at`): StereoPannerNode pan -1..1 (iteration 12 foreground hit confirm). */
  pan?: number;
  /** Foreground hit-confirm voice (counted against HIT_CONFIRM.maxVoices). */
  fg?: boolean;
}
type FilterSpec = {type: BiquadFilterType; freq: number; q?: number};
interface PlayOpts {
  gain?: number;
  /** Playback-rate multiplier (pitch + speed). */
  rate?: number;
  delay?: number;
  /** Random +/- fraction applied to the rate (default 0.03). */
  jitter?: number;
  /** Random +/- dB applied to the gain (default 1). */
  gainJitter?: number;
  filter?: FilterSpec;
}

const MAX_VOICES = 44;
const MAX_HRTF = 6;
/** Token buckets: [refill per second, burst]. */
const BUCKETS = {casing: [22, 6], impact: [26, 6], step: [10, 4], fall: [9, 3], drip: [3, 2], confirm: [14, 4], flicker: [3, 2]} as const;
type BucketName = keyof typeof BUCKETS;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Shared panner maxDistance (makePanner). NB: per the Web Audio spec it only limits the 'linear' model; 'inverse' keeps falling. */
const PANNER_MAX_DIST = 90;
/**
 * Iteration 12 (AUDIO lane, user feedback #5 "enemy hit feedback sound is not audible at long distances", still failing after
 * iteration 11): the player's confirmed enemy hit is a FOREGROUND, listener-relative layer of the SAME Sound Lab impactFlesh clip.
 *
 * Why iteration 11 (panned voice, gain floor 0.4, capped occlusion) stayed inaudible at range — measured offline from the raws:
 *  1. Same instant as the gunshot. fire() calls shot() then hitConfirm() in one frame, so the confirm started 0–8 ms after the shot.
 *     The flesh clips (80–240 ms) carry their energy at 10–30 ms (−11..−12 dBFS per 10 ms window at unity) — exactly the gunshot's
 *     own peak (pistol −14 dBFS, rifle −11..−15, shotgun −11..−14 per 10 ms, x game gain): simultaneous masking at its worst moment.
 *  2. Level. At range it was CUE 0.5 x floor 0.4 = 0.2 (−14 dB), x(1 − 0.45·0.5) with capped occlusion = 0.155 (−16 dB): its peak
 *     window sat ~12–16 dB under the gunshot's. Even a 2 m hit (0.5) was ~4 dB under the pistol.
 *  3. The distance compensation (x1 → x12.6 at 60 m) was applied BEFORE the panner, so it multiplied the reverb send too:
 *     at 60 m the convolver got ~5x the dry level, turning the confirm into a diffuse wash under the gunshot's own room tail.
 *  4. Air-absorption + occlusion lowpass (17 kHz/(1 + 0.04 d), x0.54 at the occlusion cap: ~3.7 kHz at 37 m) removed the slap.
 *  5. The compensation assumed the 'inverse' panner clamps at maxDistance 90 m; the spec only clamps 'linear' (minor, > 90 m).
 *  Not causes: the gunshot duck() only dips the ambience bus (never voices); the 44-voice cap only bites in floods; the master
 *  compressor is linked (it scales gunshot and confirm alike).
 *
 * Now: impactFlesh -> voice in -> StereoPanner (pan = HIT_CONFIRM.pan · sin(azimuth)) -> master -> compressor -> out, plus a
 * fixed small room send. No PannerNode, no distance or occlusion term, no lowpass, no maxDist cull, exempt from the voice cap
 * (pri 2) but bounded by its own voice cap + token bucket. Scheduled HIT_CONFIRM.delay after the shot onset (past the gunshot's
 * transient peak; still perceptually immediate), and while it sounds the player's own shot voice and the reverb return dip lightly.
 * Shotgun: one confirm per enemy per shot (game.ts aggregates pellets; the enemy key de-duplicates here as well); extra enemies of
 * the same shot are staggered and quieter. Misses never call it. World / corpse / NPC / chunk impacts keep impact()/physImpact().
 */
export const HIT_CONFIRM = {
  /** Final linear gain on the −1 dBFS impactFlesh clip (fixed; iteration 11 was 0.5 near and 0.155–0.2 at range). */
  level: 0.65,
  /** Max |pan| toward the hit (restrained: direction hint only). */
  pan: 0.3,
  /** Seconds after the player's shot onset (pistol/rifle transient peak is 5–35 ms into the clip). */
  delay: 0.05,
  /** A shot is "the same shot" for this long (s): the per-enemy de-dup + stagger window. */
  shotWindow: 0.25,
  /** Additional enemies hit by the same shot: each `stagger` s later and x`multiGain` quieter than the previous. */
  stagger: 0.03,
  multiGain: 0.75,
  /** Concurrent foreground confirm voices (own cap; the shared 44-voice cap does not apply). */
  maxVoices: 4,
  /** Fixed reverb send (not distance scaled). */
  send: 0.12,
  /** While a confirm sounds: player shot voice x shotDip, reverb return x reverbDip, held dipHold s, recovering with dipRelease. */
  shotDip: 0.6,
  reverbDip: 0.75,
  dipHold: 0.09,
  dipRelease: 0.06,
} as const;

/** Restrained stereo pan toward a hit: HIT_CONFIRM.pan x sin(azimuth) in the listener's horizontal plane (+ = right). */
export function hitConfirmPan(listener: {x: number; z: number; yaw: number}, x: number, z: number): number {
  const dx = x - listener.x, dz = z - listener.z, d = Math.hypot(dx, dz);
  if (!(d > 1e-6)) return 0;
  const right = (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / d; // right = (cos yaw, 0, -sin yaw)
  return Math.max(-HIT_CONFIRM.pan, Math.min(HIT_CONFIRM.pan, HIT_CONFIRM.pan * right));
}

/**
 * Iteration 12 (AUDIO): a burning flare's positional loop. Bounded to FLARE_LOOP.max at once (the oldest is faded out to make room);
 * every loop is stopped on a new station (setWorld) and by stopFlares().
 */
export const FLARE_LOOP = {max: 4, ref: 1.6, rolloff: 1.1, fadeIn: 0.25, fadeOut: 0.6, send: 0.35, update: 0.2, far: 40} as const;
/** Handle returned by Sfx.flareBurnStart (a no-op handle when audio is not running or the clip is missing). */
export interface FlareBurnHandle {
  /** Move the loop with the flare (cheap; the occlusion / air filter refreshes every FLARE_LOOP.update s). */
  setPos(x: number, y: number, z: number): void;
  /** Fade out (s, default FLARE_LOOP.fadeOut) and release. Idempotent. */
  stop(fadeS?: number): void;
  readonly playing: boolean;
}
interface FlareLoop {
  src: AudioBufferSourceNode; fade: GainNode; level: GainNode; filter: BiquadFilterNode; panner: PannerNode; nodes: AudioNode[];
  pos: Pos; next: number; stopped: boolean;
}
const NOOP_FLARE: FlareBurnHandle = {setPos() {}, stop() {}, playing: false};

/**
 * Task track1-siren-blightbelly-20261031 (lane AUDIO): the new enemies' Sound Lab cues (clips t1-*.mp3, tools/audio-pipeline/build-track1.mjs; provenance
 * derivatives/audio-track1.json). All world-placed. The hum is an enemy VOCAL ('idle': navigable-route gate, vocal cap, occlusion /
 * storey rules — vocal()); the wake scream an 'alert' vocal (sight rule + alert bias, pri 2); the burst / hiss are combat cues (never
 * route-gated, like enemy deaths; occlusion muffles them through walls / slabs). Scream, burst and hiss sound at most ONCE per enemy
 * (the id object); a hum phrase is one voice per Siren. Hum pacing belongs to the caller (ai/sirenCues.ts SIREN_HUM_PACE).
 */
export const SIREN_HUM = {ref: 2.2, rolloff: 1.1, maxDist: 24, send: 0.45, fadeOutS: 0.35, jitter: 0.02} as const;
export const TRACK1_VOICE = {
  scream: {ref: 2.4, rolloff: 1, maxDist: 44, send: 0.55, humFadeS: 0.12},
  burst: {ref: 2.5, rolloff: 1, maxDist: 45, send: 0.55},
  /** At most `max` gas hisses sound at once (the oldest fades out to make room). */
  hiss: {ref: 2, rolloff: 1.1, maxDist: 30, send: 0.4, max: 3, fadeOutS: 0.4},
} as const;
export const TRACK1_CUE_IDS = ['sirenHum', 'sirenScream', 'blightBurst', 'blightHiss'] as const satisfies readonly CueId[];

/** Weapon sound kinds (WeaponDef.sound). */
export type WeaponSoundKind = 'rifle' | 'shotgun' | 'pistol';

/**
 * Shot cue per weapon kind. 'pistol' (iteration 11) plays its own dedicated Sound Lab pistol shot ('pistolShot',
 * assets/audio/i11-pistol-shot-01.mp3, one authorized Sound Lab job; provenance derivatives/audio-iteration11-pistol.json),
 * replacing the pitched rifle-shot fallback. Its reload/dry cues still reuse the rifle/dry Sound Lab clips.
 */
export const WEAPON_SHOT_CUES: Record<WeaponSoundKind, {cue: CueId; rate: number; gain: number; reused?: string}> = {
  rifle: {cue: 'rifleShot', rate: 1, gain: 1},
  shotgun: {cue: 'shotgunShot', rate: 1, gain: 1},
  pistol: {cue: 'pistolShot', rate: 1, gain: 0.9},
};

export class Sfx {
  /** AudioContexts ever created by any Sfx (QA: must stay 1 per page). */
  static contextsCreated = 0;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private readonly bank: ClipBank;
  private ambient: AudioScheduledSourceNode[] = [];
  private volume = 0.7;
  muted = false;
  private desired: Desired = 'suspended';
  private inflight = 0;
  private retries = 0;
  private soundsStarted = 0;
  private ambientLoops = 0;
  // spatial + reverb
  private reverbIn: GainNode | null = null;
  private preDelay: DelayNode | null = null;
  private slots: {conv: ConvolverNode; wet: GainNode; kind: RoomKind | null; connected: boolean; timer: ReturnType<typeof setTimeout> | null}[] = [];
  private activeSlot = 0;
  private irCache = new Map<RoomKind, AudioBuffer>();
  private convolversCreated = 0;
  private roomKind: RoomKind = 'medium';
  private areaType = '';
  private floor: 'tile' | 'concrete' = 'concrete';
  private listener: Pos & {yaw: number} = {x: 0, y: 1.6, z: 0, yaw: 0};
  private voices: Voice[] = [];
  private coughVoice: Voice | null = null; // task gas-mask-roof-feedback-20261030: the one cough that may be sounding
  private pannersCreated = 0;
  private dropped = 0;
  private culled = 0;
  private tokens: Record<BucketName, {n: number; t: number}> = {casing: {n: 6, t: 0}, impact: {n: 6, t: 0}, step: {n: 4, t: 0}, fall: {n: 3, t: 0}, drip: {n: 2, t: 0}, confirm: {n: 4, t: 0}, flicker: {n: 2, t: 0}};
  // Iteration 12 (AUDIO): foreground hit confirm — the latest player shot (onset time, voice) and its confirms so far.
  private revOut: GainNode | null = null;
  private shotAt = -Infinity;
  private shotVoice: Voice | null = null;
  private shotConfirms = 0;
  private shotConfirmed = new WeakSet<object>();
  private confirms = 0;
  // Iteration 12 (AUDIO): burning flare loops (bounded, FLARE_LOOP.max).
  private flareLoops: FlareLoop[] = [];
  // Task track1-siren-blightbelly-20261031 (lane AUDIO): the sounding hum phrase per Siren, the live gas hisses, once-per-enemy memories and counters (debugState().t1).
  private t1Hums = new Map<object, Voice>();
  private t1Hisses: Voice[] = [];
  private t1Once = {scream: new WeakSet<object>(), burst: new WeakSet<object>(), hiss: new WeakSet<object>()};
  private t1Stats = {hums: 0, humsSilent: 0, screams: 0, bursts: 0, hisses: 0, repeats: 0};
  /** Iteration 08 (Lane B): `y` = the source height (3D occlusion through slabs on stacked levels). */
  private occlusion: ((x: number, z: number, y?: number) => number) | null = null;
  // Task office-overhaul-20261030 (lane AUDIO): enemy vocal gate (navigable route) + counters (debugState().vocal).
  private reach: VocalReachQuery | null = null;
  private vstats = {played: 0, gated: 0, sight: 0, capped: 0, stolen: 0, steps: 0};
  private reloadVoice: Voice | null = null;
  private lastReloadEmpty = false;
  private gait = new WeakMap<object, number>();
  // ambient system (page lifetime)
  private ambBus: GainNode | null = null;
  private beds: Partial<Record<BedName, GainNode>> = {};
  private bedSources: Partial<Record<BedName, AudioBufferSourceNode>> = {};
  private emitterGain: GainNode | null = null;
  private emitterSrc: AudioBufferSourceNode | null = null;
  private emitterPanner: PannerNode | null = null;
  private emitters: Pos[] = [];
  // (R4, round 2) the service annexes' fans: a FIXED pool of FAN_SOUND.voices page-lifetime channels (the bedHvac recording) that
  // follow the nearest audible fans on the listener's storey; never more voices, never re-created
  private fans: FanSource[] = [];
  private fanCh: {g: GainNode; lp: BiquadFilterNode; pan: PannerNode; src: AudioBufferSourceNode | null; on: FanSource | null}[] = [];
  private emitterTick = 0;
  private emitterOn = false;
  private profile: BedProfile = BEDS['passage'];
  private nextEvent = {drip: 3, creak: 8, rumble: 6, flicker: 12};
  // vitals
  private heartT = 0;
  private breathT = 0;
  private winded = false;

  /** factory/bank are for tests; the game uses the browser AudioContext and the bundled clip manifest. */
  constructor(private readonly factory?: () => AudioContext, bank?: ClipBank) {
    this.bank = bank ?? new ClipBank();
    // Download clip bytes while the page loads (no AudioContext or gesture needed for fetch).
    if (!bank && !factory && typeof window !== 'undefined' && typeof fetch === 'function') this.bank.prefetch();
  }

  /** Call from every user gesture that enters play: creates the context once, then resumes it. */
  init(): void {
    if (!this.ctx && !this.create()) return;
    this.resume();
  }

  private create(): boolean {
    let ctx: AudioContext | null = null;
    try {
      if (this.factory) ctx = this.factory();
      else if (typeof window !== 'undefined') {
        const AC = window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
        if (AC) ctx = new AC();
      }
    } catch {
      ctx = null;
    }
    if (!ctx) return false;
    this.ctx = ctx;
    Sfx.contextsCreated++;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.buildReverb(ctx);
    this.startAmbient();
    // Decode the bundled Sound Lab clips in this context; each cue becomes playable as it lands
    // (beds attach their loops then). Until then a cue is silent — there is no stand-in sound.
    this.bank.onCueReady = cue => this.onCueReady(cue);
    for (const name of Object.keys(BED_CUE) as BedName[]) if (this.bank.has(BED_CUE[name])) this.attachBed(name);
    void this.bank.load(ctx);
    // The other rooms' IRs build off the gesture tick in small timer steps so neither Start nor a
    // later room change hitches.
    const steps = (['tunnel', 'large', 'small'] as RoomKind[]).map(k => () => { this.ir(k); });
    const step = () => { const f = steps.shift(); if (!f) return; try { f(); } catch { /* built lazily on use */ } setTimeout(step, 16); };
    setTimeout(step, 30);
    ctx.addEventListener?.('statechange', () => { if (this.inflight === 0) this.sync(); });
    if (typeof window !== 'undefined') {
      // Safety net: if the browser refused or reverted a resume, the next click/key fixes it.
      const kick = () => { if (this.ctx && this.desired === 'running' && this.ctx.state !== 'running') { this.retries = 0; this.sync(); } };
      window.addEventListener('pointerdown', kick, true);
      window.addEventListener('keydown', kick, true);
    }
    return true;
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyGain();
  }
  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }
  private applyGain(): void {
    if (!this.ctx) return;
    const g = this.master.gain, t = this.ctx.currentTime;
    // currentTime is frozen while suspended: cancel first so repeated calls never stack events.
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.muted || this.desired !== 'running' ? 0 : this.volume, t, 0.05);
  }

  /** paused=true: quiet menus; paused=false: run. The latest request always wins. */
  suspend(paused: boolean): void {
    if (paused) this.pause(); else this.resume();
  }
  resume(): void {
    this.desired = 'running';
    this.retries = 0;
    this.sync();
    this.applyGain();
  }
  /**
   * Menus silence the master gain instead of suspending the context: suspend()/resume() races
   * across New Station/pause left Firefox stuck suspended. The context is only ever resumed.
   */
  pause(): void {
    this.desired = 'suspended';
    this.applyGain();
  }

  /** Issue the op for the desired state now (keeps user-gesture timing), reconcile after settle. */
  private sync(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (this.desired !== 'running' || (ctx.state === 'running' && this.inflight === 0)) return;
    const want = this.desired;
    this.inflight++;
    let op: Promise<void>;
    try {
      op = want === 'running' ? ctx.resume() : ctx.suspend();
    } catch (e) {
      op = Promise.reject(e);
    }
    op.then(() => undefined, () => undefined).then(() => {
      this.inflight--;
      if (this.inflight > 0 || ctx.state === 'closed') return;
      if (this.desired !== 'running' || ctx.state === 'running') { this.retries = 0; return; }
      if (this.retries++ < 4) this.sync();
    });
  }

  /** QA/test view of the audio lifecycle, the clip bank and the spatial/ambient systems. */
  debugState(): {contexts: number; state: string; desired: Desired; ambientLoops: number; ambientSources: number; sounds: number; room: RoomKind; area: string; floor: string; voices: number; hrtfVoices: number; panners: number; convolvers: number; dropped: number; culled: number; emitters: number; emitterOn: boolean; fans: {sources: number; channels: number; active: number; looping: number}; beds: Record<string, number>; bedsPlaying: string[]; listener: {x: number; y: number; z: number; yaw: number}; bank: ReturnType<ClipBank['stats']>; confirmVoices: number; confirms: number; flareLoops: number; vocal: {voices: number; gate: boolean; played: number; gated: number; sight: number; capped: number; stolen: number; steps: number}; t1: {humVoices: number; hissVoices: number; hums: number; humsSilent: number; screams: number; bursts: number; hisses: number; repeats: number}} {
    const beds: Record<string, number> = {};
    for (const k of ['wind', 'rumble', 'hvac', 'fridge', 'buzz'] as const) beds[k] = this.profile[k];
    return {
      contexts: Sfx.contextsCreated, state: this.ctx?.state ?? 'none', desired: this.desired, ambientLoops: this.ambientLoops,
      ambientSources: this.ambient.length, sounds: this.soundsStarted, room: this.roomKind, area: this.areaType, floor: this.floor,
      voices: this.voices.length, hrtfVoices: this.voices.filter(v => v.hrtf).length, panners: this.pannersCreated,
      convolvers: this.convolversCreated, dropped: this.dropped, culled: this.culled, emitters: this.emitters.length, emitterOn: this.emitterOn,
      fans: {sources: this.fans.length, channels: this.fanCh.length, active: this.fanCh.filter(c => c.on).length, looping: this.fanCh.filter(c => c.src).length},
      beds, bedsPlaying: (Object.keys(this.bedSources) as BedName[]), listener: {...this.listener}, bank: this.bank.stats(),
      confirmVoices: this.voices.filter(v => v.fg).length, confirms: this.confirms, flareLoops: this.flareLoops.filter(l => !l.stopped).length,
      vocal: {voices: this.voices.filter(v => v.vocal !== undefined && v.end > (this.ctx?.currentTime ?? 0)).length, gate: !!this.reach, ...this.vstats},
      t1: {humVoices: [...this.t1Hums.values()].filter(v => v.end > (this.ctx?.currentTime ?? 0)).length, hissVoices: this.t1Hisses.filter(v => v.end > (this.ctx?.currentTime ?? 0)).length, ...this.t1Stats}, // track1 (lane AUDIO)
    };
  }

  /** Cues requested while menus have audio paused are dropped instead of bursting on resume. */
  private get live(): AudioContext | null {
    return this.desired === 'running' ? this.ctx : null;
  }

  // ---------------------------------------------------------------------------------------
  // Spatial plumbing

  /** Camera position + yaw (forward = (-sin yaw, 0, -cos yaw)); call every frame while playing. */
  setListener(x: number, y: number, z: number, yaw: number): void {
    const L = this.listener;
    L.x = x; L.y = y; L.z = z; L.yaw = yaw;
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener as AudioListener & {setPosition?: (x: number, y: number, z: number) => void; setOrientation?: (a: number, b: number, c: number, d: number, e: number, f: number) => void};
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l) {
      if (l.positionX && l.forwardX) {
        l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
        l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz;
        l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
      } else {
        l.setPosition?.(x, y, z);
        l.setOrientation?.(fx, 0, fz, 0, 1, 0);
      }
    }
    if (++this.emitterTick >= 12) { this.emitterTick = 0; this.updateEmitter(); this.updateFans(); this.updateLoops(false); }
  }

  /**
   * Per-station hooks: occlusion (0 = clear .. 1 = blocked) and humming fixture positions. Iteration 12: a new station
   * (new occlusion) also fades out every burning-flare loop of the previous one.
   */
  setWorld(o: {occlusion?: ((x: number, z: number, y?: number) => number) | null; emitters?: Pos[]; fans?: readonly FanSource[]}): void {
    if (o.occlusion !== undefined) { this.occlusion = o.occlusion; this.stopFlares(0.05); this.stopTrack1Cues(0.05); } // track1 (lane AUDIO): hums / hisses too
    if (o.emitters) { this.emitters = o.emitters.slice(0, 256); this.emitterTick = 99; }
    if (o.fans) { // (R4) a new world's fans: every channel lets go of the old ones (fade), the next tick picks again
      this.fans = o.fans.slice(0, 64);
      const t = this.ctx?.currentTime ?? 0;
      for (const ch of this.fanCh) { ch.on = null; ch.g.gain.cancelScheduledValues(t); ch.g.gain.setTargetAtTime(0, t, 0.08); }
      this.emitterTick = 99;
    }
  }

  /** Task office-overhaul-20261030 (lane AUDIO): the built world's navigable-route source for enemy vocals (null = straight line). */
  setVocalReach(r: VocalReachQuery | null): void {
    this.reach = r;
  }

  private prune(now: number): void {
    if (!this.voices.length) return;
    this.voices = this.voices.filter(v => {
      if (v.end > now) return true;
      if (v.pending <= 0) this.release(v);
      return false;
    });
  }
  private release(v: Voice): void {
    for (const n of v.nodes) { try { n.disconnect(); } catch { /* already gone */ } }
    v.nodes.length = 0;
  }

  private take(b: BucketName): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const [rate, burst] = BUCKETS[b];
    const s = this.tokens[b], now = ctx.currentTime;
    s.n = Math.min(burst, s.n + Math.max(0, now - s.t) * rate);
    s.t = now;
    if (s.n < 1) { this.dropped++; return false; }
    s.n -= 1;
    return true;
  }

  private dist(p: Pos): number {
    const L = this.listener;
    return Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z);
  }

  private setPannerPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    else (p as unknown as {setPosition?: (x: number, y: number, z: number) => void}).setPosition?.(x, y, z);
  }

  private makePanner(ctx: AudioContext, hrtf: boolean, ref: number, rolloff: number): PannerNode {
    const p = ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = PANNER_MAX_DIST;
    this.pannersCreated++;
    return p;
  }

  /** One sound event: clip layers connect to the returned voice input. */
  private voice(o: VoiceOpts = {}): Voice | null {
    const ctx = this.live;
    if (!ctx) return null;
    const now = ctx.currentTime;
    this.prune(now);
    const pri = o.pri ?? 1;
    const cap = pri >= 2 ? Infinity : pri === 1 ? MAX_VOICES : MAX_VOICES * 0.65;
    if (this.voices.length >= cap) { this.dropped++; return null; }
    let dist = 0, occ = 0;
    if (o.at) {
      dist = this.dist(o.at);
      if (dist > (o.maxDist ?? 45)) { this.culled++; return null; }
      if (o.occlude !== false && this.occlusion && dist > 1.5) occ = Math.min(o.occMax ?? 1, clamp01(this.occlusion(o.at.x, o.at.z, o.at.y)));
    }
    const inp = ctx.createGain();
    inp.gain.value = (o.gain ?? 1) * (1 - 0.45 * occ);
    const nodes: AudioNode[] = [inp];
    let out: AudioNode = inp;
    let hrtf = false;
    if (o.at) {
      // air absorption with distance, plus a heavy lowpass when the source is around a corner
      const cutoff = Math.min(20000, 17000 / (1 + dist * 0.04)) * (occ > 0 ? 0.08 + 0.92 * (1 - occ) : 1);
      if (cutoff < 12000) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5;
        out = out.connect(f);
        nodes.push(f);
      }
      hrtf = !!o.hrtf && this.voices.filter(v => v.hrtf).length < MAX_HRTF;
      const p = this.makePanner(ctx, hrtf, o.ref ?? 1.6, o.rolloff ?? 1);
      this.setPannerPos(p, o.at.x, o.at.y, o.at.z);
      out.connect(p).connect(this.master);
      nodes.push(p);
    } else if (o.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      // Iteration 12: listener-relative voice with a restrained stereo position (no distance model at all).
      const sp = ctx.createStereoPanner();
      sp.pan.value = Math.max(-1, Math.min(1, o.pan));
      out = out.connect(sp);
      nodes.push(sp);
      out.connect(this.master);
    } else out.connect(this.master);
    // The diffuse field stays fairly constant with distance (dry falls off faster): wetter when far.
    const send = (o.send ?? 0) * (o.at ? 1 / (1 + dist / 30) : 1);
    if (send > 0.001 && this.reverbIn) {
      const s = ctx.createGain();
      s.gain.value = send;
      out.connect(s).connect(this.reverbIn);
      nodes.push(s);
    }
    const v: Voice = {inp, nodes, srcs: [], pending: 0, end: now + 0.05, hrtf, fg: !!o.fg};
    this.voices.push(v);
    return v;
  }

  /** Play one specific decoded clip into a voice (gain/rate/filter are processing of the clip). */
  private playClip(v: Voice, cue: CueId, clip: Clip, o: PlayOpts = {}): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const t = ctx.currentTime + (o.delay ?? 0);
    const rate = Math.max(0.25, (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.jitter ?? 0.03)));
    const g = (o.gain ?? 1) * CUE_GAIN[cue] * Math.pow(10, ((Math.random() * 2 - 1) * (o.gainJitter ?? 1)) / 20);
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.playbackRate.value = rate;
    const gn = ctx.createGain();
    gn.gain.value = g;
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type; f.frequency.value = o.filter.freq; f.Q.value = o.filter.q ?? 0.7;
      node = node.connect(f);
    }
    node.connect(gn).connect(v.inp);
    const dur = clip.dur / rate;
    this.soundsStarted++;
    v.pending++;
    v.srcs.push(src);
    v.end = Math.max(v.end, t + dur + 0.02);
    src.onended = () => { if (--v.pending <= 0) this.release(v); };
    src.start(t, clip.offset);
    src.stop(t + dur + 0.02);
    return dur;
  }

  /** Random variant of a cue (none = silent gap, counted by the bank). Returns the clip played. */
  private play(v: Voice | null, cue: CueId, o: PlayOpts = {}): Clip | null {
    if (!v || !this.ctx) return null;
    const clip = this.bank.pick(cue);
    if (clip) this.playClip(v, cue, clip, o);
    return clip;
  }

  // ---------------------------------------------------------------------------------------
  // Rooms / reverb

  private buildReverb(ctx: AudioContext): void {
    if (this.reverbIn || !ctx.createConvolver) return;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.preDelay = ctx.createDelay ? ctx.createDelay(0.2) : null;
    let feed: AudioNode = this.reverbIn;
    if (this.preDelay) { this.preDelay.delayTime.value = ROOMS[this.roomKind].pre; feed = this.reverbIn.connect(this.preDelay); }
    // Iteration 12: one shared return (dipped lightly while a foreground hit confirm sounds; otherwise unity).
    this.revOut = ctx.createGain();
    this.revOut.gain.value = 1;
    this.revOut.connect(this.master);
    for (let i = 0; i < 2; i++) {
      const conv = ctx.createConvolver();
      conv.normalize = true;
      this.convolversCreated++;
      const wet = ctx.createGain();
      wet.gain.value = 0;
      conv.connect(wet).connect(this.revOut);
      this.slots.push({conv, wet, kind: null, connected: false, timer: null});
    }
    this.feed = feed;
    this.loadSlot(0, this.roomKind);
    this.slots[0].wet.gain.value = ROOMS[this.roomKind].wet;
    this.activeSlot = 0;
  }
  private feed: AudioNode | null = null;

  private ir(kind: RoomKind): AudioBuffer {
    let b = this.irCache.get(kind);
    if (!b) { b = makeIR(this.ctx!, ROOMS[kind]); this.irCache.set(kind, b); }
    return b;
  }

  private loadSlot(i: number, kind: RoomKind): void {
    const s = this.slots[i];
    if (!s || !this.ctx) return;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (!s.connected && this.feed) { this.feed.connect(s.conv); s.connected = true; }
    if (s.kind === kind) return;
    try {
      s.conv.buffer = this.ir(kind);
    } catch {
      // Some engines refuse a second buffer: swap in a fresh convolver for this slot.
      if (s.connected && this.feed) { try { this.feed.disconnect(s.conv); } catch { /* noop */ } }
      try { s.conv.disconnect(); } catch { /* noop */ }
      const conv = this.ctx.createConvolver();
      conv.normalize = true;
      this.convolversCreated++;
      conv.buffer = this.ir(kind);
      conv.connect(s.wet);
      this.feed?.connect(conv);
      s.conv = conv;
      s.connected = true;
    }
    s.kind = kind;
  }

  /** Reverb character + ambience bed for the player's current space. Cheap when unchanged. */
  setRoom(kind: RoomKind, area?: string): void {
    const a = area ?? '';
    if (kind === this.roomKind && a === this.areaType) return;
    const kindChanged = kind !== this.roomKind;
    this.roomKind = kind;
    this.areaType = a;
    this.floor = TILE_FLOOR.has(a) ? 'tile' : 'concrete';
    this.profile = BEDS[a] ?? BEDS_BY_KIND[kind];
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kindChanged && this.slots.length === 2) {
      const cur = this.activeSlot, next = this.slots[cur].kind === kind ? cur : 1 - cur;
      if (next !== cur) {
        this.loadSlot(next, kind);
        const old = this.slots[cur];
        old.wet.gain.cancelScheduledValues(t);
        old.wet.gain.setTargetAtTime(0, t, 0.3);
        // Idle convolver stops costing CPU once its tail has rung out.
        if (old.timer) clearTimeout(old.timer);
        const ringOut = (1.6 + ROOMS[old.kind ?? 'tunnel'].len) * 1000;
        old.timer = setTimeout(() => {
          old.timer = null;
          if (this.slots[this.activeSlot] !== old && old.connected && this.feed) { try { this.feed.disconnect(old.conv); } catch { /* noop */ } old.connected = false; }
        }, ringOut);
        this.activeSlot = next;
      }
      const s = this.slots[this.activeSlot];
      s.wet.gain.cancelScheduledValues(t);
      s.wet.gain.setTargetAtTime(ROOMS[kind].wet, t, 0.3);
      this.preDelay?.delayTime.setTargetAtTime(ROOMS[kind].pre, t, 0.15);
    }
    this.applyBeds(1.2);
  }

  // ---------------------------------------------------------------------------------------
  // Ambient system: page-lifetime singleton (never stopped, never duplicated)

  /** Bus + bed gains + emitter panner, once per page. Bed loops attach when their clips decode. */
  private startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || this.ambBus) return;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.master);
    this.ambBus = bus;
    for (const name of Object.keys(BED_CUE) as BedName[]) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(bus);
      this.beds[name] = g;
    }
    // Positional emitter: the nearest vending machine / cooler hums where it stands (fridge clip).
    const em = ctx.createGain();
    em.gain.value = 0;
    const pan = this.makePanner(ctx, false, 1.2, 1.5);
    em.connect(pan).connect(bus);
    this.emitterGain = em;
    this.emitterPanner = pan;
    // (R4) fan channels: gain -> highpass -> lowpass (occlusion / distance) -> panner -> the ambient bus (shot ducking, pause mute)
    for (let k = 0; k < FAN_SOUND.voices; k++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = FAN_SOUND.highpassHz; hp.Q.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = FAN_SOUND.lowpassHz; lp.Q.value = 0.5;
      const fp = this.makePanner(ctx, false, FAN_SOUND.ref, FAN_SOUND.rolloff);
      g.connect(hp).connect(lp).connect(fp).connect(bus);
      this.fanCh.push({g, lp, pan: fp, src: null, on: null});
    }
    this.ambientLoops++;
    this.applyBeds(0.05);
  }

  private onCueReady(cue: CueId): void {
    for (const name of Object.keys(BED_CUE) as BedName[]) if (BED_CUE[name] === cue) this.attachBed(name);
  }

  private loopSource(clip: Clip, out: AudioNode): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    const a = clip.loopStart ?? clip.offset, b = clip.loopEnd ?? clip.offset + clip.dur;
    src.loopStart = a;
    src.loopEnd = b;
    src.connect(out);
    src.start(ctx.currentTime, a + Math.random() * Math.max(0, b - a)); // random phase per page
    this.ambient.push(src);
    return src;
  }

  /** Start a bed's looping clip once (page lifetime); fridge also feeds the positional emitter. */
  private attachBed(name: BedName): void {
    const g = this.beds[name];
    if (!g || this.bedSources[name]) return;
    const clip = this.bank.pick(BED_CUE[name]);
    if (!clip) return;
    const src = this.loopSource(clip, g);
    if (src) this.bedSources[name] = src;
    if (name === 'fridge' && this.emitterGain && !this.emitterSrc) this.emitterSrc = this.loopSource(clip, this.emitterGain);
    // (R4) the fans reuse the accepted HVAC recording (fan hum + duct air), one looping source per channel, random phase each
    if (name === 'hvac') for (const ch of this.fanCh) if (!ch.src) ch.src = this.loopSource(clip, ch.g);
  }

  /** (R4) Point the fixed fan channels at the nearest audible fans (storey-gated, occlusion-muffled); fade the rest out. */
  private updateFans(): void {
    const ctx = this.ctx;
    if (!ctx || !this.fanCh.length) return;
    const L = this.listener, t = ctx.currentTime;
    const picks = this.fans.length ? audibleFans(this.fans, L, L.y - FAN_EYE_H, this.fanCh.length) : [];
    const keep = new Set(picks.map(p => p.fan));
    const free = this.fanCh.filter(ch => !ch.on || !keep.has(ch.on));
    for (const ch of free) if (ch.on) { ch.on = null; ch.g.gain.cancelScheduledValues(t); ch.g.gain.setTargetAtTime(0, t, 0.4); }
    for (const p of picks) {
      let ch = this.fanCh.find(c => c.on === p.fan);
      if (!ch) {
        ch = free.shift();
        if (!ch) continue;
        ch.on = p.fan;
        this.setPannerPos(ch.pan, p.fan.x, p.fan.y, p.fan.z);
        if (ch.src) ch.src.playbackRate.setTargetAtTime(p.fan.rate, t, 0.05);
      }
      const occ = this.occlusion && p.dist > 1.5 ? clamp01(this.occlusion(p.fan.x, p.fan.z, p.fan.y)) : 0;
      ch.g.gain.cancelScheduledValues(t);
      ch.g.gain.setTargetAtTime(FAN_SOUND.gain * AMBIENT_LEVEL * (1 - 0.6 * occ), t, 0.4);
      ch.lp.frequency.setTargetAtTime(FAN_SOUND.lowpassHz * (occ > 0 ? 0.12 + 0.88 * (1 - occ) : 1), t, 0.3);
    }
  }

  private applyBeds(tc: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, p = this.profile, L = AMBIENT_LEVEL;
    const set = (k: BedName, v: number) => { const g = this.beds[k]; if (g) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(v * L, t, tc); } };
    set('wind', p.wind * BED_GAIN.wind);
    set('rumble', (0.25 + 0.75 * p.rumble) * BED_GAIN.rumble);
    set('hvac', p.hvac * BED_GAIN.hvac);
    set('fridge', p.fridge * BED_GAIN.fridge);
    set('buzz', p.buzz * BED_GAIN.buzz);
  }

  private updateEmitter(): void {
    const ctx = this.ctx, g = this.emitterGain, pan = this.emitterPanner;
    if (!ctx || !g || !pan) return;
    let best: Pos | null = null, bd = 16;
    for (const e of this.emitters) { const d = this.dist(e); if (d < bd) { bd = d; best = e; } }
    const on = !!best;
    if (best) this.setPannerPos(pan, best.x, best.y, best.z);
    if (on !== this.emitterOn) {
      this.emitterOn = on;
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(on ? 0.35 * AMBIENT_LEVEL : 0, t, 0.5);
    }
  }

  /** Brief "ear compression" after loud own shots: beds dip and recover. */
  private duck(depth: number): void {
    const ctx = this.live, b = this.ambBus;
    if (!ctx || !b) return;
    const t = ctx.currentTime;
    b.gain.cancelScheduledValues(t);
    b.gain.setTargetAtTime(depth, t, 0.008);
    b.gain.setTargetAtTime(1, t + 0.07, 0.45);
  }

  private around(minR: number, maxR: number, y = 1.5): Pos {
    const a = Math.random() * Math.PI * 2, r = rnd(minR, maxR), L = this.listener;
    return {x: L.x + Math.cos(a) * r, y: rnd(y * 0.6, y * 1.4), z: L.z + Math.sin(a) * r};
  }

  /** Area-dependent one-shot ambience (drips, creaks, distant trains, flicker). Call every frame while playing. */
  ambience(dt: number): void {
    if (!this.live) return;
    const p = this.profile, e = this.nextEvent;
    e.drip -= dt * p.drips;
    e.creak -= dt * p.creaks;
    e.rumble -= dt * p.rumbles;
    e.flicker -= dt * p.flickers;
    if (e.drip <= 0) {
      e.drip = rnd(2.5, 7);
      if (this.take('drip')) this.play(this.voice({at: this.around(2.5, 9, 1), send: 0.9, pri: 0, ref: 1.2, rolloff: 1, occlude: false}), 'drip', {jitter: 0.12});
    }
    if (e.creak <= 0) {
      e.creak = rnd(9, 22);
      const v = this.voice({at: this.around(8, 18, 2), send: 1, pri: 0, ref: 2, rolloff: 1, occlude: false});
      this.play(v, Math.random() < 0.5 ? 'clank' : 'creak', {jitter: 0.08});
    }
    if (e.rumble <= 0) {
      e.rumble = rnd(14, 30);
      this.play(this.voice({at: this.around(15, 30, 1), send: 0.6, pri: 0, occlude: false, ref: 6, rolloff: 0.6, maxDist: 60}), 'trainDistant', {jitter: 0.05, filter: {type: 'lowpass', freq: 900}});
    }
    if (e.flicker <= 0) {
      e.flicker = rnd(12, 30);
      this.play(this.voice({at: this.around(2, 7, 2.6), send: 0.4, pri: 0, ref: 1.5, rolloff: 1.2, occlude: false}), 'flicker', {jitter: 0.04});
    }
  }

  /** Low-health heartbeat and post-sprint breathing; hp/stamina as 0..1 fractions. */
  vitals(dt: number, hp: number, stamina: number): void {
    if (!this.live) return;
    if (hp > 0 && hp < 0.35) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        const k = (0.35 - hp) / 0.35;
        this.heartT = 1.05 - 0.4 * k;
        this.play(this.voice({pri: 1, gain: 0.5 + 0.5 * k}), 'heartbeat', {jitter: 0.02, gainJitter: 0.5, filter: {type: 'lowpass', freq: 900}});
      }
    } else this.heartT = 0;
    if (stamina < 0.2) this.winded = true;
    else if (stamina > 0.6) this.winded = false;
    if (this.winded) {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        const clip = this.play(this.voice({pri: 0, send: 0.05}), 'breath', {jitter: 0.04});
        this.breathT = Math.max(0.8, (clip?.dur ?? 0.9) + rnd(0.05, 0.2));
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Weapons (player-local)

  shot(kind: WeaponSoundKind): void {
    const v = this.voice({send: 1, pri: 2});
    if (!v) return;
    // Iteration 12: a new shot — the hit confirms of THIS shot are timed from its onset and de-duplicated per enemy.
    this.shotAt = this.ctx!.currentTime;
    this.shotVoice = v;
    this.shotConfirms = 0;
    this.shotConfirmed = new WeakSet();
    const big = kind === 'shotgun', map = WEAPON_SHOT_CUES[kind] ?? WEAPON_SHOT_CUES.rifle, cue: CueId = map.cue;
    const clip = this.bank.pick(cue);
    if (clip) {
      const rate = rnd(0.97, 1.03) * map.rate;
      this.playClip(v, cue, clip, {rate, jitter: 0, gain: map.gain});
      // discrete slap-back from far walls in long/big spaces: delayed, darkened copies of the same take
      const room = ROOMS[this.roomKind];
      for (let i = 0; i < room.slaps; i++) {
        this.playClip(v, cue, clip, {rate, jitter: 0, gain: (big ? 0.16 : 0.12) * map.gain / (i + 1), gainJitter: 0, delay: room.slap * (i + 1) * rnd(0.9, 1.1), filter: {type: 'lowpass', freq: 1100}});
      }
    }
    this.duck(big ? 0.4 : kind === 'pistol' ? 0.7 : 0.6);
    if (big) this.pump(0.42);
  }
  /** Dry-fire hammer click. */
  dry(kind: WeaponSoundKind = 'rifle'): void {
    this.play(this.voice({send: 0.15}), 'dryFire', {rate: kind === 'shotgun' ? 0.85 : kind === 'pistol' ? 1.12 : 1});
  }
  /** Small switch click (flashlight); pitch nudges the playback rate. */
  click(pitch = 1): void {
    this.play(this.voice(), 'click', {rate: Math.max(0.6, Math.min(1.6, 0.85 + 0.15 * pitch))});
  }
  private stopReload(): void {
    const v = this.reloadVoice;
    this.reloadVoice = null;
    if (!v) return;
    for (const s of v.srcs) { try { s.stop(); } catch { /* already stopped */ } }
  }
  reloadStart(kind: WeaponSoundKind, empty = false): void {
    this.stopReload();
    this.lastReloadEmpty = empty;
    const v = this.voice({send: 0.15, pri: 1});
    this.reloadVoice = v;
    if (kind === 'pistol') {
      // Pistol lane: the existing Sound Lab rifle magazine cues, pitched up and timed to the 1.4 s / 1.65 s reload.
      const T = empty ? 1.65 : 1.4;
      this.play(v, 'rifleMagOut', {delay: 0.04, rate: 1.25, gain: 0.85});
      if (empty) this.play(v, 'rifleMagDrop', {delay: 0.42, gain: 0.6, rate: 1.3});
      this.play(v, 'rifleMagIn', {delay: T * 0.5, rate: 1.25, gain: 0.85});
    } else if (kind === 'rifle') {
      const T = empty ? 2.55 : 2.1;
      this.play(v, 'rifleMagOut', {delay: 0.05});
      if (empty) this.play(v, 'rifleMagDrop', {delay: 0.62, gain: 0.8}); // spent mag hits the floor
      this.play(v, 'rifleMagIn', {delay: T * 0.5});
    } else {
      this.play(v, 'equip', {gain: 0.7, rate: 1.05});
    }
  }
  reloadEnd(kind: WeaponSoundKind): void {
    this.reloadVoice = null;
    if (kind === 'shotgun') { this.pump(); return; }
    const v = this.voice({send: 0.2});
    if (this.lastReloadEmpty) this.play(v, 'rifleCharge', kind === 'pistol' ? {rate: 1.35, gain: 0.8} : {}); // charging handle / slide release
    else this.play(v, 'dryFire', {gain: 0.6, rate: 1.15}); // small seat/tap click
  }
  shellIn(): void {
    this.play(this.voice({send: 0.12}), 'shellInsert', {delay: rnd(0, 0.015), jitter: 0.05});
  }
  /** Pump-action rack: back stroke then forward lock ("chk-chk"). */
  pump(delay = 0): void {
    this.play(this.voice({send: 0.25, pri: 1}), 'shotgunPump', {delay});
  }
  equip(): void {
    this.stopReload();
    this.play(this.voice({send: 0.1}), 'equip');
  }

  // ---------------------------------------------------------------------------------------
  // Player body / UI

  pickup(): void { this.play(this.voice(), 'pickup', {jitter: 0.05}); }
  denied(): void { this.play(this.voice(), 'denied', {jitter: 0.01}); }
  heal(): void { this.play(this.voice({send: 0.08}), 'heal'); }
  /** Player footstep by floor finish and gait; the reverb send tells the room size. */
  footstep(sprint: boolean, crouched = false): void {
    const tile = this.floor === 'tile';
    const cue: CueId = crouched ? (tile ? 'stepTileSneak' : 'stepConcreteSneak') : sprint ? (tile ? 'stepTileRun' : 'stepConcreteRun') : (tile ? 'stepTile' : 'stepConcrete');
    this.play(this.voice({send: 0.3, pri: 1, gain: crouched ? 0.8 : sprint ? 1.1 : 1}), cue, {jitter: 0.05, gainJitter: 1.5});
  }
  /** Hand/boot on a ladder rung; `at` positions it (another climber), omitted = the player. */
  ladder(at?: Pos): void {
    this.play(this.voice({at, send: 0.25, pri: at ? 0 : 1, ref: 2, maxDist: 25}), 'ladder', {jitter: 0.05, gainJitter: 1.5});
  }
  hitTick(kill: boolean): void { this.play(this.voice(), kill ? 'hitKill' : 'hitTick', {jitter: 0.02, gainJitter: 0.5}); }
  /** Pain grunt (varied). */
  hurt(): void { this.play(this.voice({send: 0.2, pri: 2}), 'hurt', {jitter: 0.04}); }
  /**
   * Task gas-mask-roof-feedback-20261030: one player cough (listener-relative, a little room send), never two at once — the
   * previous one is cut. Returns the clip's length (s; 0 = nothing played) so the caller can pace the next one (audio/cough.ts).
   */
  cough(): number {
    this.stopCough();
    const v = this.voice({send: 0.08, pri: 1});
    const clip = this.play(v, 'cough', {jitter: 0.03, gainJitter: 1.5});
    this.coughVoice = clip ? v : null;
    return clip ? clip.dur : 0;
  }
  /** Silence a cough that is still sounding (lifecycle: death, menus, a new section). */
  stopCough(): void {
    const v = this.coughVoice;
    this.coughVoice = null;
    if (!v) return;
    for (const s of v.srcs) { try { s.stop(); } catch { /* already stopped */ } }
  }
  /** Push-off scuff when leaving the ground. */
  jump(): void { this.play(this.voice({send: 0.2}), 'jump'); }
  /** Landing thud; strength 0..1 (fall impact). */
  land(strength: number): void {
    const s = clamp01(strength);
    this.play(this.voice({send: 0.3 + s * 0.2}), 'land', {gain: 0.3 + 0.7 * s, rate: 1.08 - 0.12 * s});
  }
  /** Clothing rustle when crouching (down) or standing (up). */
  crouch(down: boolean): void { this.play(this.voice(), 'crouch', {rate: down ? 0.95 : 1.07, gain: down ? 1 : 0.8}); }
  /**
   * Lane KNIFE (knife-melee-20261030): the player's knife swing. No blade-whoosh clip exists in the Sound Lab bank and no
   * generation is authorized, so the existing 'crouch' clip (a short heavy-jacket rustle) is reused, quicker and brighter,
   * as the arm's slash; the contact itself is the existing flesh confirm / impact cues. Never a gunshot.
   */
  meleeSwing(): void { this.play(this.voice(), 'crouch', {rate: 1.38, gain: 0.95, jitter: 0.05}); }
  /**
   * Task gasmask-breach-20261030 (mask lane): the gas mask pulled on / taken off (Q). No mask / strap clip exists in the Sound Lab
   * bank and no generation is authorized, so the existing 'crouch' rustle is reused, lower and softer (rubber and straps). The
   * hit-confirm mix is untouched.
   */
  maskRustle(on: boolean): void { this.play(this.voice(), 'crouch', {rate: on ? 0.8 : 0.9, gain: on ? 0.75 : 0.6, jitter: 0.03}); }
  /** Container/holder opened; kind is the holder kind (cabinet*, crate, vending, fridge, desk, shelf...). */
  containerOpen(kind: string, at?: Pos): void {
    const cue = OPEN_CUE[kind];
    if (!cue) return; // open surfaces (shelves, counters, stalls) have no door: search() rummages
    this.play(this.voice({at, send: 0.3, ref: 2.5, hrtf: true}), cue);
  }
  containerClose(kind: string, at?: Pos): void {
    const cue = CLOSE_CUE[kind];
    if (!cue) return;
    this.play(this.voice({at, send: 0.35, ref: 2.5, hrtf: true}), cue, kind === 'desk' || kind === 'monitorDesk' ? {rate: 1.15, gain: 0.8} : {});
  }
  /** Prying a stuck holder open (vending machine door): strain + latch snap. */
  pry(kind: string, at?: Pos): void {
    if (kind !== 'vending') return;
    this.play(this.voice({at, send: 0.3, ref: 2.5, hrtf: true}), 'vendingPry', {jitter: 0.02});
  }
  /** Rummage rustle while searching a container. */
  search(): void { this.play(this.voice({send: 0.15}), 'search', {jitter: 0.06}); }
  /** Eating: item id picks the take (chips, chocolate, beans, noodles; other foods chew). */
  eat(item?: string): void { this.play(this.voice({send: 0.08}), (item && EAT_CUE[item]) || 'eat', {jitter: 0.02}); }
  /** Drinking: item id picks the take (cola, water, juice; other drinks use water). */
  drink(item?: string): void { this.play(this.voice({send: 0.08}), (item && DRINK_CUE[item]) || 'drinkWater', {jitter: 0.02}); }
  death(): void { this.play(this.voice({pri: 2, send: 0.3}), 'death', {jitter: 0.02}); }
  win(): void { this.play(this.voice({pri: 2, send: 0.4}), 'win', {jitter: 0, gainJitter: 0}); }

  // ---------------------------------------------------------------------------------------
  // World sounds (positional)

  /** Bullet impact at a world point. */
  impact(x: number, y: number, z: number, surface: Surface): void {
    if (!this.live || !this.take('impact')) return;
    const v = this.voice({at: {x, y, z}, ref: 2, rolloff: 1.05, send: 0.5, pri: 0, maxDist: 50});
    this.play(v, IMPACT_CUE[surface], {delay: Math.random() * 0.008, jitter: 0.08});
  }
  /**
   * Iteration 12 (AUDIO, user #5): player-confirmed enemy hit — the impactFlesh clip as a FOREGROUND listener-relative layer
   * (see HIT_CONFIRM for the routing and why iteration 11 was inaudible). Same level at 2 m and 90 m; only the stereo pan
   * (±HIT_CONFIRM.pan) depends on where the hit is. `enemy` (the actor) de-duplicates within one shot: one confirm per enemy
   * per shot even if a caller reports every pellet. Own token bucket + own voice cap; `y` is unused (no distance model).
   */
  hitConfirm(x: number, _y: number, z: number, enemy?: object): void {
    const ctx = this.live;
    if (!ctx) return;
    const now = ctx.currentTime;
    const sameShot = now - this.shotAt <= HIT_CONFIRM.shotWindow;
    if (enemy && sameShot && this.shotConfirmed.has(enemy)) return;
    this.prune(now);
    if (this.voices.filter(v => v.fg).length >= HIT_CONFIRM.maxVoices) { this.dropped++; return; }
    if (!this.take('confirm')) return;
    const k = sameShot ? this.shotConfirms : 0;
    const delay = sameShot ? Math.max(0, this.shotAt + HIT_CONFIRM.delay + k * HIT_CONFIRM.stagger - now) : 0;
    const v = this.voice({pri: 2, fg: true, pan: hitConfirmPan(this.listener, x, z), send: HIT_CONFIRM.send});
    const clip = this.play(v, 'impactFlesh', {delay, jitter: 0.04, gainJitter: 0, gain: HIT_CONFIRM.level * Math.pow(HIT_CONFIRM.multiGain, k) / CUE_GAIN.impactFlesh});
    if (!clip) return;
    this.confirms++;
    if (sameShot) {
      this.shotConfirms++;
      if (enemy) this.shotConfirmed.add(enemy);
    }
    this.dipForConfirm(now + delay);
  }

  /** Light, brief dip of the player's own shot voice and of the reverb return around a confirm's onset `t`. */
  private dipForConfirm(t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const a = Math.max(ctx.currentTime, t - 0.005), b = t + HIT_CONFIRM.dipHold;
    const dip = (g: AudioParam, depth: number) => {
      g.cancelScheduledValues(a);
      g.setTargetAtTime(depth, a, 0.006);
      g.setTargetAtTime(1, b, HIT_CONFIRM.dipRelease);
    };
    const sv = this.shotVoice;
    if (sv && sv.nodes.length && sv.end > ctx.currentTime) dip(sv.inp.gain, HIT_CONFIRM.shotDip);
    if (this.revOut) dip(this.revOut.gain, HIT_CONFIRM.reverbDip);
  }
  /**
   * Iteration 06 (Lane D): material breakage at a world point — glass shatter, wood break, rubble
   * pattering down, flesh tear. strength 0..1 scales gain/pitch. Shares the impact token bucket.
   */
  breakage(cue: BreakCue, x: number, y: number, z: number, strength = 1): void {
    if (!this.live || !this.take('impact')) return;
    const s = clamp01(strength);
    const v = this.voice({at: {x, y, z}, ref: cue === 'fleshTear' ? 1.6 : 2.2, rolloff: 1.05, send: 0.5, pri: cue === 'breakGlass' || cue === 'breakWood' ? 1 : 0, maxDist: 45, gain: 0.45 + 0.55 * s});
    this.play(v, cue, {delay: cue === 'debrisFall' ? 0.05 + Math.random() * 0.08 : Math.random() * 0.01, jitter: 0.07, rate: 1.04 - 0.08 * s});
  }
  /** Ejected brass (rifle) / plastic hull (shell) bouncing; speed m/s at contact. */
  casing(x: number, y: number, z: number, speed: number, kind: CasingKind): void {
    if (!this.live || speed < 0.35) return;
    const L = this.listener;
    if (Math.hypot(x - L.x, z - L.z) > 14) { this.culled++; return; }
    if (!this.take('casing')) return;
    const s = Math.min(1, speed / 4);
    const v = this.voice({at: {x, y, z}, ref: 0.9, rolloff: 1.6, send: 0.3, pri: 0, maxDist: 14, occlude: false, gain: 0.15 + 0.6 * Math.pow(s, 0.8)});
    this.play(v, kind === 'shell' ? 'casingHull' : 'casingBrass', {rate: 0.9 + 0.15 * s, jitter: 0.06});
  }
  /**
   * Iteration 07 (Lane K): a rigid item / chunk / loose prop striking the station at `speed` m/s —
   * can: aluminium can / tin clatter; light: bottle / box / bag knock; heavy: a dropped gun; prop: a
   * trash can toppling; flesh: a torn chunk slapping down; stone / wood / glass / metal: chips (low).
   */
  physImpact(x: number, y: number, z: number, speed: number, family: ImpactFamily): void {
    if (!this.live || speed < 0.6) return;
    const L = this.listener;
    if (Math.hypot(x - L.x, z - L.z) > 24) { this.culled++; return; }
    if (!this.take(family === 'prop' ? 'fall' : 'casing')) return;
    const s = clamp01(speed / 5);
    const base = family === 'prop' ? 0.45 : family === 'stone' || family === 'wood' || family === 'glass' || family === 'metal' ? 0.1 : 0.25;
    const v = this.voice({at: {x, y, z}, ref: family === 'prop' ? 1.8 : 1.1, rolloff: 1.4, send: 0.35, pri: 0, maxDist: 24, gain: base + (1 - base) * 0.75 * Math.pow(s, 0.8)});
    this.play(v, PHYS_CUE[family], {rate: 0.92 + 0.16 * s, jitter: 0.07});
  }
  /** Ragdoll / corpse hitting the ground; strength 0..1. Rate-limited for multi-bone contacts. */
  bodyFall(x: number, y: number, z: number, strength: number): void {
    const s = clamp01(strength);
    if (!this.live || s < 0.06 || !this.take('fall')) return;
    const v = this.voice({at: {x, y, z}, ref: 1.8, rolloff: 1.1, send: 0.45, pri: 1, maxDist: 30, gain: 0.25 + 0.75 * s});
    this.play(v, 'bodyFall', {rate: 1.02 - s * 0.08, jitter: 0.06});
  }
  /**
   * Task office-overhaul-20261030 (lane AUDIO, user #4: zombies moaning through the floors above — "over grunting"): one enemy
   * VOCAL voice (idle / chase moan or growl, or the alert). With a reach source (the game's ai/vocalReach.ts field) it is heard
   * along the NAVIGABLE route: silent beyond VOCAL_GATE[kind].limit m of path, otherwise the panner's straight-line roll-off is
   * corrected to the route length (vocalGain: a slab with a long stair route between = strongly attenuated or silent). A source
   * in clear 3D line of sight (the occlusion test: no wall / slab between) is heard by the straight line as before. At most
   * VOCAL_GATE.cap vocals sound at once: a nearer (alert-biased) one fades out the farthest playing one, else it is dropped.
   * Spatial panning, HRTF, occlusion filter and reverb send are unchanged (voice()). Returns the voice or null.
   */
  private vocal(kind: VocalKind, o: VoiceOpts & {at: Pos}): Voice | null {
    const ctx = this.live;
    if (!ctx) return null;
    const straight = this.dist(o.at);
    if (straight > (o.maxDist ?? 45)) { this.culled++; return null; }
    let gain = 1, rank = straight;
    if (this.reach) {
      const spec = VOCAL_GATE[kind], path = this.reach.pathTo(o.at.x, o.at.y, o.at.z);
      gain = vocalGain(path, straight, spec.limit, spec.fade, o.ref ?? 1.6, o.rolloff ?? 1);
      if (gain >= VOCAL_GATE.minGain) rank = Math.max(straight, path);
      else if (this.occlusion && (straight <= 1.5 || this.occlusion(o.at.x, o.at.z, o.at.y) <= 0)) { gain = 1; this.vstats.sight++; } // in sight
      else { this.vstats.gated++; return null; }
    }
    if (kind === 'alert') rank *= VOCAL_GATE.alertBias;
    // vocal voice cap: the nearest / most relevant win
    const now = ctx.currentTime;
    let n = 0, far: Voice | null = null;
    for (const v of this.voices) {
      if (v.vocal === undefined || v.end <= now) continue;
      n++;
      if (!far || v.vocal > far.vocal!) far = v;
    }
    if (n >= VOCAL_GATE.cap) {
      if (!far || rank >= far.vocal! - VOCAL_GATE.steal) { this.vstats.capped++; return null; }
      const t = now, s = VOCAL_GATE.stealFade;
      far.inp.gain.cancelScheduledValues(t);
      far.inp.gain.setTargetAtTime(0, t, s / 3);
      for (const src of far.srcs) { try { src.stop(t + s + 0.02); } catch { /* already stopped */ } }
      far.vocal = undefined;
      far.end = Math.min(far.end, t + s + 0.03);
      this.vstats.stolen++;
    }
    const v = this.voice({...o, gain: (o.gain ?? 1) * gain});
    if (v) { v.vocal = rank; this.vstats.played++; }
    return v;
  }

  /**
   * Task office-overhaul-20261030 (lane AUDIO): an enemy footfall / rung clank at feet height `y`. Same storey as the listener
   * (within ~1.8 m of the player's feet): unchanged. Another storey: only with a navigable route of <= VOCAL_GATE.steps m (no
   * footsteps through the slab from the floor above). No reach source: unchanged.
   */
  private stepHeard(x: number, y: number, z: number): boolean {
    if (!this.reach || Math.abs(y - (this.listener.y - 1.3)) <= 2.1) return true;
    if (this.reach.pathTo(x, y, z) <= VOCAL_GATE.steps) return true;
    this.vstats.steps++;
    return false;
  }

  /**
   * Iteration 07 (Lane Q): the rat/dog creature's positional Sound Lab vocals (growl idle/threat,
   * snarl on alert, bite on the lunge, yelp when hit, death). Missing clips stay silent (bank gaps).
   * Task office-overhaul-20261030 (lane AUDIO): growl / snarl are enemy vocals (vocal(): navigable-route gate + cap; `alert` =
   * it just saw the player); bite / yelp / death are combat cues and never gated.
   */
  creature(cue: 'growl' | 'snarl' | 'bite' | 'yelp' | 'death', x: number, y: number, z: number, alert = false): void {
    const id: CueId = cue === 'growl' ? 'creatureGrowl' : cue === 'snarl' ? 'creatureSnarl' : cue === 'bite' ? 'creatureBite' : cue === 'yelp' ? 'creatureYelp' : 'creatureDeath';
    const near = cue === 'bite' || cue === 'yelp';
    const o = {at: {x, y, z}, hrtf: true, ref: near ? 1.8 : 2.2, rolloff: 1.15, send: 0.5, pri: cue === 'growl' ? 0 : 1, maxDist: cue === 'growl' ? 26 : 36};
    const v = cue === 'growl' || cue === 'snarl' ? this.vocal(alert ? 'alert' : 'idle', o) : this.voice(o);
    this.play(v, id, {jitter: 0.06});
  }
  /** Rat/dog paw scrabble: per-creature stride accumulator (short quick strides), positional, low. */
  creatureGait(id: object, x: number, z: number, speed: number, dt: number, y = 0): void {
    if (!this.live || speed < 0.2) return;
    const stride = speed > 2 ? 0.55 : 0.32;
    let d = (this.gait.get(id) ?? Math.random() * stride) + speed * dt;
    if (d >= stride) {
      d -= stride;
      const L = this.listener;
      if (Math.hypot(x - L.x, z - L.z) <= 16 && this.stepHeard(x, y, z) && this.take('step')) { // lane AUDIO: cross-storey gate
        const v = this.voice({at: {x, y: y + 0.03, z}, ref: 1.2, rolloff: 1.5, send: 0.22, pri: 0, maxDist: 16, gain: Math.min(1.2, 0.55 + speed * 0.12)});
        this.play(v, 'creatureStep', {jitter: 0.1, gainJitter: 2});
      }
    }
    this.gait.set(id, d);
  }
  /**
   * Zombie vocal, HRTF-positioned; `deep` = heavy/coated build. Task office-overhaul-20261030 (lane AUDIO): an enemy vocal
   * (vocal(): navigable-route gate + vocal cap); `alert` = the groan when it first sees the player.
   */
  groan(x: number, y: number, z: number, deep: boolean, alert = false): void {
    const v = this.vocal(alert ? 'alert' : 'idle', {at: {x, y, z}, hrtf: true, ref: 2.2, rolloff: 1.1, send: 0.6, pri: 1, maxDist: 34});
    this.play(v, deep ? 'zombieGroanDeep' : 'zombieGroan', {jitter: 0.07});
  }
  zombieAttack(x: number, y: number, z: number): void {
    this.play(this.voice({at: {x, y, z}, hrtf: true, ref: 2, rolloff: 1.2, send: 0.45, pri: 1, maxDist: 30}), 'zombieAttack', {jitter: 0.06});
  }
  zombieDeath(x: number, y: number, z: number): void {
    this.play(this.voice({at: {x, y, z}, hrtf: true, ref: 2.2, rolloff: 1.1, send: 0.55, pri: 1, maxDist: 40}), 'zombieDeath', {jitter: 0.06});
  }
  /** Accumulates stride per zombie (keyed by any object) and plays footfalls; call per frame. `y` = feet height. */
  zombieGait(id: object, x: number, z: number, speed: number, dt: number, heavy: boolean, y = 0): void {
    if (!this.live || speed < 0.15) return;
    const stride = heavy ? 0.9 : 0.75;
    let d = (this.gait.get(id) ?? Math.random() * stride) + speed * dt;
    if (d >= stride) { d -= stride; this.zombieStep(x, z, heavy, speed, y); }
    this.gait.set(id, d);
  }
  zombieStep(x: number, z: number, heavy: boolean, speed = 1, y = 0): void {
    const L = this.listener;
    if (Math.hypot(x - L.x, z - L.z) > 18) return;
    if (!this.stepHeard(x, y, z)) return; // lane AUDIO: no footsteps through the slab from another storey
    if (!this.take('step')) return;
    const v = this.voice({at: {x, y: y + 0.05, z}, ref: 1.4, rolloff: 1.4, send: 0.25, pri: 0, maxDist: 18, gain: Math.min(1.3, 0.6 + speed * 0.25)});
    this.play(v, heavy ? 'zombieStepHeavy' : 'zombieStep', {jitter: 0.06, gainJitter: 1.5});
  }
  /** A zombie on a ladder: positional rung clanks at a climbing cadence; call per frame while it climbs. */
  zombieClimb(id: object, x: number, y: number, z: number, dt: number): void {
    if (!this.live) return;
    let t = (this.gait.get(id) ?? Math.random() * 0.45) + dt;
    if (t >= 0.45) {
      t -= 0.45;
      const L = this.listener;
      if (Math.hypot(x - L.x, z - L.z) <= 20 && this.stepHeard(x, y, z) && this.take('step')) this.ladder({x, y: y + 0.6, z}); // lane AUDIO gate
    }
    this.gait.set(id, t);
  }

  // ---------------------------------------------------------------------------------------
  // Iteration 12 (AUDIO lane): flashlight battery + thrown flare (Sound Lab clips i12-*; silent gaps until decoded)

  /** A fresh battery clicked into the flashlight (player-local). */
  batteryInsert(): void { this.play(this.voice({send: 0.08, pri: 1}), 'batteryInsert', {jitter: 0.02}); }
  /** Faint electrical crackle of a failing flashlight (player-local); strength 0..1. Own bucket (3/s, burst 2), expendable. */
  flashlightFlicker(strength = 1): void {
    if (!this.live || !this.take('flicker')) return;
    this.play(this.voice({send: 0.04, pri: 0, gain: 0.55 + 0.45 * clamp01(strength)}), 'flashlightFlicker', {jitter: 0.06, gainJitter: 1.5});
  }
  /** A flare struck alight at a world point (usually the player's hand): scrape + whoosh. */
  flareIgnite(x: number, y: number, z: number): void {
    this.play(this.voice({at: {x, y, z}, ref: 2, rolloff: 1, send: 0.35, pri: 1, maxDist: 40}), 'flareIgnite', {jitter: 0.03});
  }
  /** A flare sputtering out / dying fizz at a world point (stop its burn loop with the handle). */
  flareOut(x: number, y: number, z: number): void {
    this.play(this.voice({at: {x, y, z}, ref: FLARE_LOOP.ref, rolloff: FLARE_LOOP.rolloff, send: 0.4, pri: 1, maxDist: 36}), 'flareOut', {jitter: 0.04});
  }

  /**
   * A burning flare's spatial hiss loop at a world point. Returns a handle: setPos() follows the flare (thrown / rolling),
   * stop() fades it out. At most FLARE_LOOP.max loops (the oldest fades to make room); all stop on a new station.
   * Silent no-op handle when audio is paused / not started or the clip is missing (counted as a silent play).
   */
  flareBurnStart(x: number, y: number, z: number): FlareBurnHandle {
    const ctx = this.live;
    if (!ctx) return NOOP_FLARE;
    const clip = this.bank.pick('flareBurn');
    if (!clip) return NOOP_FLARE;
    this.flareLoops = this.flareLoops.filter(l => !l.stopped);
    while (this.flareLoops.length >= FLARE_LOOP.max) this.endLoop(this.flareLoops[0], 0.15);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    const a = clip.loopStart ?? clip.offset, b = clip.loopEnd ?? clip.offset + clip.dur;
    src.loopStart = a;
    src.loopEnd = b;
    src.playbackRate.value = rnd(0.96, 1.04); // two flares never phase into one
    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.gain.setTargetAtTime(CUE_GAIN.flareBurn, now, FLARE_LOOP.fadeIn / 3);
    const level = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const panner = this.makePanner(ctx, false, FLARE_LOOP.ref, FLARE_LOOP.rolloff);
    src.connect(fade).connect(level).connect(filter).connect(panner).connect(this.master);
    const nodes: AudioNode[] = [src, fade, level, filter, panner];
    if (this.reverbIn) {
      const s = ctx.createGain();
      s.gain.value = FLARE_LOOP.send;
      filter.connect(s).connect(this.reverbIn);
      nodes.push(s);
    }
    const loop: FlareLoop = {src, fade, level, filter, panner, nodes, pos: {x, y, z}, next: 0, stopped: false};
    this.setPannerPos(panner, x, y, z);
    this.loopFilter(loop, true);
    src.onended = () => { for (const n of loop.nodes) { try { n.disconnect(); } catch { /* already gone */ } } loop.nodes.length = 0; };
    src.start(now, a + Math.random() * Math.max(0, b - a));
    this.soundsStarted++;
    this.flareLoops.push(loop);
    const self = this;
    return {
      setPos(px: number, py: number, pz: number) {
        if (loop.stopped) return;
        loop.pos.x = px; loop.pos.y = py; loop.pos.z = pz;
        self.setPannerPos(loop.panner, px, py, pz);
        if (self.ctx && self.ctx.currentTime >= loop.next) self.loopFilter(loop, false);
      },
      stop(fadeS?: number) { self.endLoop(loop, fadeS ?? FLARE_LOOP.fadeOut); },
      get playing() { return !loop.stopped; },
    };
  }

  /** Fade out every burning-flare loop (new station / retry / death). */
  stopFlares(fadeS = 0.1): void {
    for (const l of this.flareLoops.slice()) this.endLoop(l, fadeS);
    this.flareLoops = [];
  }

  /** Air absorption + occlusion lowpass and level for one loop (same law as voice()); silent but alive beyond FLARE_LOOP.far. */
  private loopFilter(l: FlareLoop, immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || l.stopped) return;
    const t = ctx.currentTime, d = this.dist(l.pos);
    const occ = this.occlusion && d > 1.5 ? clamp01(this.occlusion(l.pos.x, l.pos.z, l.pos.y)) : 0;
    const cutoff = Math.min(20000, 17000 / (1 + d * 0.04)) * (occ > 0 ? 0.08 + 0.92 * (1 - occ) : 1);
    const lvl = d > FLARE_LOOP.far ? 0 : 1 - 0.45 * occ;
    l.next = t + FLARE_LOOP.update;
    if (immediate) { l.filter.frequency.value = cutoff; l.level.gain.value = lvl; return; }
    l.filter.frequency.setTargetAtTime(cutoff, t, 0.08);
    l.level.gain.setTargetAtTime(lvl, t, 0.12);
  }

  /** Refresh every live loop's filter/level as the listener moves (setListener cadence). */
  private updateLoops(force: boolean): void {
    if (!this.flareLoops.length) return;
    const t = this.ctx?.currentTime ?? 0;
    for (const l of this.flareLoops) if (!l.stopped && (force || t >= l.next)) this.loopFilter(l, false);
  }

  private endLoop(l: FlareLoop, fadeS: number): void {
    const i = this.flareLoops.indexOf(l);
    if (i >= 0) this.flareLoops.splice(i, 1);
    if (l.stopped) return;
    l.stopped = true;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, f = Math.max(0.01, fadeS);
    l.fade.gain.cancelScheduledValues(t);
    l.fade.gain.setTargetAtTime(0, t, f / 3);
    try { l.src.stop(t + f + 0.05); } catch { /* already stopped */ }
  }

  // ---------------------------------------------------------------------------------------
  // Task track1-siren-blightbelly-20261031 (lane AUDIO): Siren hum / scream, Blightbelly burst / gas hiss (Sound Lab clips t1-*;
  // silent no-ops when audio is paused / not started or a clip is missing). See SIREN_HUM / TRACK1_VOICE.

  /**
   * One short hum PHRASE (a whole Sound Lab take, 4.4–5.5 s) at a dormant Siren's mouth. An enemy vocal ('idle': navigable-route
   * gate, vocal cap, occlusion / storey rules). Returns the phrase length (s); 0 = nothing played (gated / culled / paused / clip
   * missing / a phrase of this Siren still sounding / she already screamed). The caller paces the next phrase (dur + a gap).
   */
  sirenHum(id: object, x: number, y: number, z: number): number {
    const ctx = this.live;
    if (!ctx || this.t1Once.scream.has(id)) return 0;
    this.sweepTrack1(ctx.currentTime);
    if (this.t1Hums.has(id)) return 0; // one phrase at a time per Siren
    const v = this.vocal('idle', {at: {x, y, z}, hrtf: true, ref: SIREN_HUM.ref, rolloff: SIREN_HUM.rolloff, send: SIREN_HUM.send, pri: 1, maxDist: SIREN_HUM.maxDist});
    const clip = this.play(v, 'sirenHum', {jitter: SIREN_HUM.jitter, gainJitter: 0.5});
    if (!v || !clip) { this.t1Stats.humsSilent++; return 0; }
    this.t1Hums.set(id, v);
    this.t1Stats.hums++;
    return clip.dur;
  }

  /** Fade this Siren's sounding hum phrase (wake / death / despawn). Idempotent; plays nothing. */
  sirenHumStop(id: object, fadeS: number = SIREN_HUM.fadeOutS): void {
    const v = this.t1Hums.get(id);
    if (!v) return;
    this.t1Hums.delete(id);
    this.fadeVoice(v, fadeS);
  }

  /**
   * The Siren's wake scream: fades her hum, then ONE piercing scream ('alert' vocal, pri 2). At most once per Siren (`id`): a
   * repeated call returns false and plays nothing (no scream farming); the first call is remembered even if nothing could sound.
   * Level: CUE_GAIN.sirenScream through the existing master compressor (no extra gain stage). Returns true when a scream started.
   */
  sirenScream(id: object, x: number, y: number, z: number): boolean {
    if (this.t1Once.scream.has(id)) { this.t1Stats.repeats++; return false; }
    this.t1Once.scream.add(id);
    this.sirenHumStop(id, TRACK1_VOICE.scream.humFadeS);
    const s = TRACK1_VOICE.scream;
    const v = this.vocal('alert', {at: {x, y, z}, hrtf: true, ref: s.ref, rolloff: s.rolloff, send: s.send, pri: 2, maxDist: s.maxDist});
    const ok = !!this.play(v, 'sirenScream', {jitter: 0.02, gainJitter: 0.5});
    if (ok) this.t1Stats.screams++;
    return ok;
  }

  /**
   * The Blightbelly's pustule / gas burst at death (combat cue: never route-gated; occlusion muffles it). At most once per
   * Blightbelly (`id`): several pellets on the killing frame or a revisit play nothing more. Returns true when it started.
   */
  blightBurst(id: object, x: number, y: number, z: number): boolean {
    if (this.t1Once.burst.has(id)) { this.t1Stats.repeats++; return false; }
    this.t1Once.burst.add(id);
    const b = TRACK1_VOICE.burst;
    const ok = !!this.play(this.voice({at: {x, y, z}, hrtf: true, ref: b.ref, rolloff: b.rolloff, send: b.send, pri: 2, maxDist: b.maxDist}), 'blightBurst', {jitter: 0.04, gainJitter: 0.5});
    if (ok) this.t1Stats.bursts++;
    return ok;
  }

  /**
   * The gas venting from the burst body (a ~3.9 s hiss that fades), positional, `delayS` after now (e.g. 0.15 after blightBurst).
   * At most once per Blightbelly and TRACK1_VOICE.hiss.max at once (the oldest fades). Returns true when it started.
   */
  blightHiss(id: object, x: number, y: number, z: number, delayS = 0): boolean {
    if (this.t1Once.hiss.has(id)) { this.t1Stats.repeats++; return false; }
    this.t1Once.hiss.add(id);
    const ctx = this.live;
    if (!ctx) return false;
    this.sweepTrack1(ctx.currentTime);
    const h = TRACK1_VOICE.hiss;
    while (this.t1Hisses.length >= h.max) this.fadeVoice(this.t1Hisses.shift()!, 0.15);
    const v = this.voice({at: {x, y, z}, ref: h.ref, rolloff: h.rolloff, send: h.send, pri: 1, maxDist: h.maxDist});
    if (!this.play(v, 'blightHiss', {delay: Math.max(0, Math.min(2, delayS)), jitter: 0.03, gainJitter: 0.5}) || !v) return false;
    this.t1Hisses.push(v);
    this.t1Stats.hisses++;
    return true;
  }

  /** Fade every sounding Siren hum and gas hiss (a new section via setWorld, or the caller's teardown). */
  stopTrack1Cues(fadeS = 0.1): void {
    for (const v of this.t1Hums.values()) this.fadeVoice(v, fadeS);
    this.t1Hums.clear();
    for (const v of this.t1Hisses) this.fadeVoice(v, fadeS);
    this.t1Hisses = [];
  }

  /** Drop hum / hiss bookkeeping of voices that already ended (bounded maps / lists). */
  private sweepTrack1(now: number): void {
    for (const [k, v] of this.t1Hums) if (v.end <= now) this.t1Hums.delete(k);
    if (this.t1Hisses.length) this.t1Hisses = this.t1Hisses.filter(v => v.end > now);
  }

  /** Fade a voice to silence over `fadeS` and stop its sources (vocal-steal style); it leaves the vocal cap at once. */
  private fadeVoice(v: Voice, fadeS: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, f = Math.max(0.01, fadeS);
    v.inp.gain.cancelScheduledValues(t);
    v.inp.gain.setTargetAtTime(0, t, f / 3);
    for (const src of v.srcs) { try { src.stop(t + f + 0.02); } catch { /* already stopped */ } }
    v.vocal = undefined;
    v.end = Math.min(v.end, t + f + 0.03);
  }
}
