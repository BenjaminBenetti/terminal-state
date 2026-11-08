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
import {STRAINER_SWING_PEAK_S} from './manifest.strainer.generated'; // lane AUDIO (strainer squish set): each swing clip's peak time

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
  rifleMagDrop: 0.3, dryFire: 0.35, equip: 0.28, hitTick: 0.22, hitKill: 0.32, headHit: 0.5,
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
  // Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO): the strainer-* clips are peak -1 dBFS (iteration-05
  // convention); these gains set the mix (derivatives/audio-strainer.json mixCalibration, loudest 50 ms at the source): step -21.7 dB
  // (~+2 dB over a heavy zombie step at its chase gain), swing -21.1 (~4 dB under the attack snarl), contact -19.3 (between the hurt
  // grunt -18.2 and the foreground hit confirm -20.0), squish -24.3 (~4.5 dB under that confirm, positional: quieter with distance).
  strainerStep: 0.38, strainerSwing: 0.36, strainerContact: 0.6, strainerSquish: 0.32,
  // Task reactor-build-20261101 (primary): the Reactor's machine set (tools/audio-pipeline/reactor-build.mjs). One-shots are peak
  // -1 dBFS, the loops RMS -20 dBFS (the bed / flare-loop convention). The generator start is deliberately LOUD (it is the noise that
  // pulls the dead onto the landing); the running loops sit under combat; the core startup swell is the win's sound.
  reactorGeneratorStart: 0.85, reactorGeneratorLoop: 0.55, reactorFanLoop: 0.4, reactorBreaker: 0.6, reactorFuse: 0.4, reactorValve: 0.5, reactorPump: 0.55, reactorStartup: 0.8, reactorHum: 0.45,
  // Task reactor-playtest-round2-20261102 (lane STARTUP, tools/audio-pipeline/reactor-startup-build.mjs; world/reactor/startupAudio.ts): the
  // startup set. One-shots peak -1 dBFS, loops RMS -20 dBFS. The ONLINE impact is the loudest Reactor event (the win's hit), the surge
  // swells under it, the stage thump is the per-step punch (scaled per stage by the director), the rod drive / beacon motor sit under
  // the machines; the bed is the deep layer that BUILDS with the stages (its level is driven live: MachineLoopHandle.setLevel).
  reactorSurge: 0.85, reactorOnline: 1, reactorRodLoop: 0.55, reactorRodStop: 0.75, reactorBed: 0.6, reactorStage: 0.75, reactorBeacon: 0.32,
  // Task reactor-surface-ending-20261102 (lane AUDIO, tools/audio-pipeline/reactor-ending-build.mjs): the blue-beam ignition (peak -1 dBFS;
  // its per-call mix, high-pass and the room the ONLINE impact makes for it: world/reactor/startupAudio.ts STARTUP_MIX, calibrated in
  // derivatives/audio-reactor-ending.json mixCalibration) and the surface rain bed (RMS -20 dBFS; its level: RAIN_BED).
  reactorBeam: 1, bedRain: 1,
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
  // Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT, tools/audio-pipeline/fuel-build.mjs): the stall / pour one-shots
  // are peak -1 dBFS, the cart loop RMS -20 dBFS (the bed / flare-loop convention). The stall is under the floor of the car the player
  // stands in (a refused departure: clearly heard, under a gunshot); the pour is at the hands (between pickup and heal); the cart rumble
  // sits in the footsteps' level band at walking pace.
  engineStall: 0.55, fuelPour: 0.42, cartRoll: 0.4,
  // (task studio-skyways-level-20261106-054448-01: the prize car; round 2, task skyways-vehicle-20261107 lane AUDIO — see CAR_AUDIO: the
  // engine loops are RMS -20 dBFS mid-range layers now (idle 0.42 -> 0.55, drive 0.5 -> 0.6); start / brake peak -1 dBFS, the reverse whine
  // loop RMS -20 dBFS (a layer over the engine))
  carIdle: 0.55, carDrive: 0.6, carStart: 0.6, carReverse: 0.28, carBrake: 0.5, carSkid: 0.45, carDoor: 0.6,
  // Task studio-skyways-destinations-20261106-170011-01 (lane AUDIO, tools/audio-pipeline/skyways-destinations-build.mjs; LOCATION_AUDIO): the
  // loops are RMS -20 dBFS under a -1 dBFS peak ceiling (the sparse tick loop is peak-bound: -30.7 dBFS RMS, -26 LUFS), the chime peak
  // -1 dBFS. The location loops sit in the bed band (under the fans / the cart); the chime is a bell across a court: heard, under a
  // gunshot. First estimates for the ear pass (derivatives/audio-skyways-destinations.json).
  clockTick: 0.5, clockChime: 0.7, arcadeAttract: 0.26, projectorRun: 0.22,
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
// (task studio-skyways-level-20261106-054448, lane FOOD: the ramen bowls / bento chew with the generic 'eat' take; the bubble tea's
// straw-and-cup drink uses the carton-and-gulps take)
const DRINK_CUE: Record<string, CueId> = {cola: 'drinkCola', water: 'drinkWater', juice: 'drinkJuice', bubble_tea: 'drinkJuice'};
/**
 * Iteration 07 (Lane K): rigid item / chunk contact families -> Sound Lab cues (bank i07k + reused impacts). Task mall-round2-20261031
 * (lane AUDIO, M01): 'cardboard' -> its body cue; physImpact layers it per CARDBOARD_AUDIO.thud.
 */
export const PHYS_CUE: Readonly<Record<ImpactFamily, CueId>> = {can: 'itemCan', light: 'itemLight', heavy: 'impactMetal', prop: 'propTopple', cardboard: 'land', flesh: 'chunkFlesh', stone: 'debrisFall', wood: 'impactWood', glass: 'impactGlass', metal: 'impactSheetMetal'};
/** Web Audio BiquadFilter lowpass Q is in dB: -3.01 dB = Butterworth (flat passband, no resonant bump at the cutoff). */
const LP_FLAT_Q_DB = -3.01;
/**
 * Task mall-round2-20261031 (lane AUDIO, M01; user: "cardboard boxes play the metal clanking sound when being pushed around, should
 * actually be more of a cardboard sound" — a general statement, every level). Cause (traced): every loose prop struck as family 'prop'
 * -> propTopple, the Sound Lab take of "a metal trash can knocked over, toppling and clanging onto a concrete floor, a hollow metallic
 * crash followed by a short rolling rattle" (i07k-prop-topple-*: ~1.05 s to -30 dB, bright energy kept long after the strike), and
 * nothing at all sounded while a prop slid. Loose props of damage class cardboard (physics/dynamicItems.ts propImpactFamily) now strike
 * as 'cardboard' and, while sliding on their floor, sound a paced drag (dynamicItems.ts PROP_DRAG -> propDrag / propDragStop). Both
 * reuse ACCEPTED Sound Lab clips already in the bank; the only processing is playback rate, a flat lowpass and a truncation fade
 * (no new clip, no synthesis):
 *  - thud: 'land' ("a person in boots landing hard on a concrete floor, a heavy thud with a clothing rustle": dull, non-tonal, <= 85 ms
 *    to -30 dB) as the body + a short 'jump' layer ("a short boot scuff on concrete with a quick clothing rustle") as the papery slap.
 *    Rate (cardboardThudRate) falls with the prop's mass (a 3 kg carton sounds lighter than a 28 kg archive stack), rises a little with
 *    impact speed. Same detection, throttle and 'fall' bucket as before.
 *  - drag: one 'jump' scuff (lowpassed, slowed, truncated to maxDur) per drag tick; one voice per prop (a new tick hands over from the
 *    previous one in `handoff` s), at most `maxVoices` at once plus its own 'drag' token bucket; propDragStop fades it in `release` s.
 * Not chosen (structural measurements, reference/tasks/mall-round2-20261031/evidence/audio): hitKill (the player's kill confirm),
 * zombieStep (enemy footsteps), itemLight / search (strongly tonal: whitened tonality 0.44 / 0.45 vs land 0.02), crateClose (woody
 * 0.34 s tail). Levels / rates are first estimates for an ear pass — this routing was NOT auditioned.
 */
export const CARDBOARD_AUDIO = {
  thud: {
    body: {cue: 'land', gain: 1.4, lowpass: 2400},
    slap: {cue: 'jump', gain: 1.6, rateMul: 0.78, lowpass: 3000, maxDur: 0.16, fade: 0.04},
    /** Rate: `rateLight` at <= `lightKg`, minus `perDouble` per doubling of mass, floored at `rateHeavy`; x (`speed0` + `speedK` x s). */
    rateLight: 1.3, rateHeavy: 0.95, lightKg: 3, perDouble: 0.11, speed0: 0.94, speedK: 0.1,
    base: 0.35, ref: 1.6, rolloff: 1.4, send: 0.3, maxDist: 22, jitter: 0.06,
  },
  drag: {
    cue: 'jump', gain: 1.6, lowpass: 3000, rate: [0.84, 0.96], level: [0.35, 1], fast: 2.5, maxDur: 0.26, fade: 0.05,
    ref: 1.3, rolloff: 1.5, send: 0.2, maxDist: 16, jitter: 0.06, gainJitter: 1.5, maxVoices: 3, handoff: 0.03, release: 0.06,
  },
} as const satisfies {thud: {body: CueRef; slap: CueRef; [k: string]: unknown}; drag: CueRef};
type CueRef = {cue: CueId; [k: string]: unknown};

/** M01: playback rate of a cardboard thud for a prop of `mass` kg (undefined: a light carton) at normalised impact speed s (0..1). */
export function cardboardThudRate(mass: number | undefined, s: number): number {
  const T = CARDBOARD_AUDIO.thud, m = mass !== undefined && mass > 0 && Number.isFinite(mass) ? mass : T.lightKg;
  const r = Math.max(T.rateHeavy, Math.min(T.rateLight, T.rateLight - T.perDouble * Math.log2(m / T.lightKg)));
  return r * (T.speed0 + T.speedK * clamp01(s));
}
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
  /**
   * Task mall-round2-20261031 (lane AUDIO, M01): play at most this long (s of output, after the rate), ending with a `fadeOut` s
   * linear fade (default 0.04) — a bounded window of a longer clip. Absent: the whole clip, as before.
   */
  maxDur?: number;
  fadeOut?: number;
}

const MAX_VOICES = 44;
const MAX_HRTF = 6;
/** Token buckets: [refill per second, burst]. */
const BUCKETS = {casing: [22, 6], impact: [26, 6], step: [10, 4], fall: [9, 3], drip: [3, 2], confirm: [14, 4], flicker: [3, 2],
  drag: [10, 3]} as const; // task mall-round2-20261031 (lane AUDIO, M01): cardboard drag ticks, all props together
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
  /**
   * (task studio-general-armor-20261107-231448-01, user: "a different impact sound when you hit the zombies head ... better feedback when you hit the weak spot")
   * Final linear gain of the headHit skull crack (−1 dBFS takes) layered on the same confirm voice, same onset, when the shot's confirmed
   * hit part is the HEAD (never a miss / torso / aim near the head). A first estimate (not auditioned on the worker): the bright crack
   * (centroid 4-5 kHz) over the wet thwack (the flesh layer stays) — distinct without masking it.
   */
  headLevel: 0.6,
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
  /** Task reactor-build-20261101: audible range of this loop (default FLARE_LOOP.far; a machine loop: MACHINE_LOOP.far). */
  far?: number;
}
/**
 * Task reactor-build-20261101 (primary): the Reactor's MACHINE loops (auxiliary generator running, a zone's extraction fans, the
 * restarted core's hum) and machine one-shots (generator start, breaker, fuse, valve, pump, core startup) — the flare-loop chain
 * (fade -> level -> air / occlusion lowpass -> panner -> master + reverb send) with a bigger reference distance: machines are loud.
 * Bounded: at most MACHINE_LOOP.max loops (the oldest fades to make room); every loop stops on a new world (setWorld).
 */
export const MACHINE_LOOP = {max: 10, ref: 4, rolloff: 1, fadeIn: 1.2, fadeOut: 1.5, send: 0.3, far: 70, maxDist: 80} as const;
// (task reactor-playtest-round2-20261102, lane STARTUP: max 6 -> 10 — three running generators + three fan zones already filled 6, so the
// restarted core's hum evicted a generator loop that re-requested itself and evicted the next; the startup director adds at most three
// bounded loops: the machine bed, the rod drive while the rods move, one beacon motor.)
export type MachineLoopCue = 'reactorGeneratorLoop' | 'reactorFanLoop' | 'reactorHum' | 'reactorBed' | 'reactorRodLoop' | 'reactorBeacon';
export type MachineCue = 'reactorGeneratorStart' | 'reactorBreaker' | 'reactorFuse' | 'reactorValve' | 'reactorPump' | 'reactorStartup'
  | 'reactorSurge' | 'reactorOnline' | 'reactorRodStop' | 'reactorStage' | 'reactorBeam';
/** Task reactor-playtest-round2-20261102 (lane STARTUP): a machine one-shot's mix (gain x CUE_GAIN, playback rate, start delay s, panner
 *  reference distance / audible range m, priority: 2 = never dropped by the voice cap — the win's surge / ONLINE impact).
 *  Task reactor-surface-ending-20261102 (lane AUDIO): + an optional filter on the clip (the beam ignition is high-passed: processing). */
export interface MachineCueOpts { gain?: number; rate?: number; delay?: number; ref?: number; maxDist?: number; pri?: number; filter?: FilterSpec }

/**
 * Task reactor-surface-ending-20261102 (lane AUDIO; user: "It should be raining!"): the surface RAIN bed — ONE page-lifetime looping
 * channel (the Sound Lab rain loop, created the first time rain is asked for, never re-created): loop -> gain -> low-pass -> the ambient
 * bus (pause mute, shot ducking). Sfx.rainBed(level, muffle) sets it: `level` 0..1 = how much rain reaches the listener (0 = none: the
 * world/reactor/audioRain.ts director decides — outside on the surface after the win), `muffle` 0..1 = sheltered (indoors / the
 * stairwell: the low-pass closes to `muffledHz` and the level drops to `shelterLevel`). Gains are eased (`tauS`), never stepped.
 */
// (task reactor-surface-redesign-credits-20261103, user: "the rain effect is to loud, drop its sound by about 50%": the bed's own gain
// 0.34 -> 0.17; the master volume, the shelter muffle and every other bus unchanged)
export const RAIN_BED = {gain: 0.17, openHz: 18000, muffledHz: 700, shelterLevel: 0.45, tauS: 0.5} as const;
/** A machine loop's live controls (lane STARTUP: the bed builds with the stages, the rod drive follows the rod motion). */
export interface MachineLoopHandle extends FlareBurnHandle {
  /** Level k (x CUE_GAIN; 1 = the cue's mix level), eased with time constant tauS. */
  setLevel(k: number, tauS?: number): void;
  /** Playback rate (processing of the clip: the machine spins up / down), eased with time constant tauS. */
  setRate(r: number, tauS?: number): void;
}
const NOOP_FLARE: FlareBurnHandle = {setPos() {}, stop() {}, playing: false};

/**
 * Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN, item 17): a non-positional looping layer of the moving player train
 * (Sfx.rideLoop). Level k multiplies the cue's mix gain (CUE_GAIN); rate / lowpass are processing of the clip; all eased (tauS).
 */
export interface RideLoopHandle {
  setLevel(k: number, tauS?: number): void;
  setRate(r: number, tauS?: number): void;
  setLowpass(hz: number, tauS?: number): void;
  /** Fade out (s) and release. Idempotent. */
  stop(fadeS?: number): void;
  readonly playing: boolean;
}

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

/**
 * Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO; user: "It needs unique 'squishy sounds' to really sell its
 * swamp creature feel."): the Strainer's OWN Sound Lab cues (clips strainer-*.mp3, tools/audio-pipeline/strainer-build.mjs;
 * provenance derivatives/audio-strainer.json). All world-placed movement / combat cues (never route-gated like vocals; occlusion
 * muffles them; footfalls keep the enemy cross-storey step gate). Its VOICE stays the existing zombie calls (ai/strainer.ts).
 *  - gait: wet squelching footfalls on the foot PLANTS of its own Walk / Run clips (tools/asset-pipeline/enemy/lib/strainer-clips.mjs
 *    CLIP_SPECS cycle / authored ground speed; footCycle plants the left foot at phase 0 and the right at 0.5). The clip's time scale
 *    mirrors ai/strainerActor.ts animate (ground speed / (clip ground speed x actor scale), clamped 0.35..1.8), so the cadence follows
 *    the REAL ground speed. Silent below minSpeed (standing still) and outside the locomotion clips. Shares the enemy 'step' token
 *    bucket; at most step.max footfalls sound at once (several Strainers never stack into a constant squelch).
 *  - swing: ONE wet arm-swing whoosh per swing (brain.attackSeq), started so that the clip's loudest 20 ms (STRAINER_SWING_PEAK_S)
 *    lands on the claw's impact frame (brain attackImpact). A swing that leaves the attack state before its whoosh starts stays
 *    silent. It carries no impact, so it also sounds on a miss (the arm still swings). At most swing.max at once.
 *  - contact: the fleshy claw-contact squelch ONLY for a connecting claw (game.ts hurtPlayer, attacker 'strainer'; never on a miss),
 *    at the player's chest toward the attacker; pri 2 (the shared voice cap never drops it); at most contact.max at once.
 *  - squish: a short wet squish when it is shot but not killed (EnemyCues.hurt): at most one per squish.minGapS per Strainer
 *    (shotgun pellets / bursts) and squish.max at once.
 */
export const STRAINER_AUDIO = {
  gait: {Walk: {cycleS: 2.6, groundSpeed: 0.42}, Run: {cycleS: 1.6, groundSpeed: 1.35}, timeScaleMin: 0.35, timeScaleMax: 1.8, minSpeed: 0.15, minGapS: 0.25},
  /** Footfall voice: call gain min(gainMax, gainBase + gainPerMps x speed) — x0.86 at the 0.42 m/s wander, x1.0 at the 1.35 m/s chase. */
  step: {ref: 1.5, rolloff: 1.3, maxDist: 20, send: 0.28, max: 3, gainBase: 0.8, gainPerMps: 0.15, gainMax: 1.2, jitter: 0.06, gainJitter: 1.5},
  /** `fitS`: the whoosh may start this much later than ideal (one frame or two); variants whose peak exceeds the impact are skipped. */
  swing: {ref: 2, rolloff: 1.15, maxDist: 30, send: 0.4, max: 2, jitter: 0.03, gainJitter: 1, fitS: 0.034},
  contact: {ref: 1.2, rolloff: 1, maxDist: 8, send: 0.25, max: 2, offsetM: 0.35, chestDropM: 0.35, jitter: 0.04, gainJitter: 1},
  squish: {ref: 1.8, rolloff: 1.2, maxDist: 26, send: 0.35, max: 2, minGapS: 0.45, jitter: 0.08, gainJitter: 1.5},
} as const;
export const STRAINER_CUE_IDS = ['strainerStep', 'strainerSwing', 'strainerContact', 'strainerSquish'] as const satisfies readonly CueId[];
type StrainerVoiceKind = 'step' | 'swing' | 'contact' | 'squish';

/** Weapon sound kinds (WeaponDef.sound). */
/**
 * Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train FUEL cues. engineStall / fuelPour play one Sound Lab take
 * once per call (a sounding one is cut first: never stacked, never looped); hoseConnect reuses the magazine seat / release clips, lower
 * and heavier, with the switch click (no new clip); cartRoll is ONE page-lifetime channel (the cart rolling loop): created while the cart
 * rolls, its level / rate / lowpass eased to the speed, faded and released after `idleStopS` at speed 0, at once on pause / a new world.
 */
export const FUEL_AUDIO = {
  stall: {send: 0.2},
  pour: {send: 0.1, cutFade: 0.12},
  hose: {on: {cue: 'rifleMagIn' as CueId, rate: 0.68, gain: 0.9}, off: {cue: 'rifleMagOut' as CueId, rate: 0.72, gain: 0.8}, click: {rate: 0.75, gain: 0.55, delay: 0.05}},
  cart: {rate: [0.72, 1.12] as const, level: [0.35, 1] as const, lowpass: [900, 5200] as const, tau: 0.08, idleStopS: 0.4, stopFade: 0.12, ref: 2.2, rolloff: 1.1, send: 0.12, minK: 0.01},
} as const;

/**
 * Task studio-skyways-level-20261106-054448 (lane CAR2): the Skyways PRIZE CAR (Sound Lab clips; provenance derivatives/audio-skyways-car.json).
 *
 * Round 2 (task studio-beta-skyways-vehicle-20261107-054512-01, lane AUDIO; user, Game 77: "car feels bad, mostly audio", "actual engine
 * audible"). ROOT CAUSE (measured; the wiring was intact — one channel, never torn down per frame, the panner at unity gain 1.8 m from the
 * driver's ear): the round-1 engine loops were SUB-BASS only — spectral centroid 47 / 74 Hz, the share above 180 Hz -20.3 / -12.4 dB of
 * the loop (derivatives/audio-skyways-car.json revision.round1) — and the idle played at 0.85x (lower still) at CUE 0.42: its content
 * above 180 Hz reached the master at about -48 dBFS. Laptop speakers / earbuds reproduce almost nothing below ~150 Hz and the ear is
 * ~25 dB less sensitive at 50 Hz than at 1 kHz: the engine was effectively silent. Round 2: mid-range engine layers (share above
 * 180 Hz -2.2 / -3.5 dB), rates that never go below 1x at idle, higher gains, and the arcade cues the car lacked:
 *  - carEngine: ONE page-lifetime channel (one panner) of three loops — idle, drive, reverse whine — every target eased (setTargetAtTime,
 *    `tau`; unchanged values cost nothing). The engine "rpm" (0 idle .. 1 top) = `rpm.speed` x speed01 + `rpm.throttle` x throttle01 (the
 *    pedal revs the engine before the car is fast: an audible pull-away), clamped. Idle / drive crossfade by rpm (equal power; the idle
 *    keeps `idleFloor`); their playbackRates rise with rpm (`idleRate`, `driveRate`). Reverse (`reverse01` = 0..1 of the reverse top
 *    speed): the gearbox-whine layer comes in with the speed (`reverse.level`, `reverse.rate`) — a sound the forward gears never make.
 *  - Getting in (`rev`): the carStart one-shot (starter whirr, the catch, an idle) at the engine `start.delayS` after the door (so the
 *    latch and the starter do not mask each other), the loops held under it and faded in from `start.holdS` into it (sooner —
 *    `start.catchS` — when the throttle is already held); no carStart clip: the round-1 blip (`rev`).
 *  - stopCarEngine (getting out / death / teardown): the loops fade (`stopFade`) while their rate sinks to `stopRate` x (a spin-down), the
 *    start one-shot is cut; a pause / menu / a new world: the same at once (0.05 s). Nothing starts while audio is paused.
 *  - carBrake: the brake-to-stop (squeal, scrub, the suspension settling) — once per stop from a real brake (world/skywaysCar.ts CAR_SOUND),
 *    level by the speed it braked from; carSkid: one tyre-skid take, at most every `skid.minGapS`; carDoor: the door; carImpact: the car's
 *    own contacts — the body against the world (metal crash + topple rattle) or a body it hits (flesh slap + body thump), scaled by the
 *    closing speed, never more often than `impact.minGapS` per kind. Positional (`at`; omitted = at the listener).
 * Levels / rates are first estimates for the user's ear pass — the clips were NOT auditioned (structural QC only).
 */
export const CAR_AUDIO = {
  rpm: {speed: 0.85, throttle: 0.3}, idleRate: [1, 1.35] as const, driveRate: [0.85, 1.6] as const, idleFloor: 0.15, tau: 0.1,
  reverse: {level: [0.35, 1] as const, rate: [0.85, 1.2] as const, min: 0.02},
  start: {delayS: 0.3, holdS: 0.9, catchS: 0.55, fadeS: 0.6, send: 0.08},
  rev: {s: 0.6, peak: 0.6}, stopFade: 0.5, stopRate: 0.55, ref: 2.5, rolloff: 1, send: 0.05, eps: 0.004,
  brake: {minGapS: 1, base: 0.55, send: 0.15, ref: 2.5, maxDist: 35},
  skid: {minGapS: 0.9, send: 0.15, ref: 3, maxDist: 40},
  door: {send: 0.15, ref: 2, maxDist: 30},
  impact: {minGapS: {car: 0.12, flesh: 0.06} as const, from: {car: 1.5, flesh: 0.5} as const, full: 9, base: 0.4, ref: 2.5, rolloff: 1.1, send: 0.35, maxDist: 40,
    car: {cue: 'impactMetal' as CueId, gain: 1, rate: [1, 0.82] as const, layer: {cue: 'propTopple' as CueId, gain: 0.9, rate: [0.95, 0.8] as const}},
    flesh: {cue: 'impactFlesh' as CueId, gain: 1.2, rate: [1.02, 0.88] as const, layer: {cue: 'bodyFall' as CueId, gain: 0.8, rate: [1.05, 0.9] as const}}},
} as const;

/**
 * Task studio-skyways-destinations-20261106-170011-01 (lane AUDIO): LOCATION emitters — a destination's own looping sound where it stands
 * (the Clock Court's tower movement, the Starfall Arcade's attract mode, the Aurora Picture House's projector; Sound Lab clips, provenance
 * derivatives/audio-skyways-destinations.json; world/skywaysDestAudio.ts derives the list from layout.skyways). A small sibling of the
 * nearest-hum emitter / fan channels: Sfx.setLocationEmitters (per section; [] clears; a new world clears) keeps at most `max`; at the
 * emitter tick the nearest `voices` in their own `range` (and, with a `floorY`, on the listener's storey: feet within `band`) sound — one
 * channel each (loop -> gain -> panner (inverse law, `ref` per cue) -> the ambient bus: the beds' shot ducking and pause / menu mute),
 * created from silence when an emitter is first heard and eased in (`tau`), faded out and released (`fadeOut`) when it leaves that set;
 * at most `voices` sounding + `voices` fading channels exist (an older fading one is cut). Occlusion-free. Level: CUE_GAIN x the
 * emitter's `gain` x an edge fade over the last `edge` of its range (no pop at the cut-off). The clock CHIME: while the listener hears
 * a clockTick emitter within `chime.range`, its in-range time counts down — the first strike `chime.firstS` s after first arriving, then
 * every `chime.minS`..`chime.maxS` s (a sequence seeded by the clock list; never sooner, never stacked) — one clockChime one-shot at the
 * clock (a bell carries: its own reference distance / range).
 */
export type LocationCue = 'clockTick' | 'arcadeAttract' | 'projectorRun';
export interface LocationEmitter {
  x: number; y: number; z: number;
  cue: LocationCue;
  /** Level multiplier (x CUE_GAIN; 1 = the cue's mix level). */
  gain: number;
  /** Audible range (m, 3D). */
  range: number;
  /** Optional storey gate: the emitter's floor (absolute m); heard only with the listener's feet within `band` (default LOCATION_AUDIO.band). */
  floorY?: number;
  band?: number;
}
export const LOCATION_AUDIO = {
  // (task studio-skyways-rework-20261107-054512-01: the clock court-local — tick ref 4 -> 2 m; chime trigger 25 -> 8 m (= the tick's range),
  // carry 90 -> 40 m)
  max: 32, voices: 2, ref: {clockTick: 2, arcadeAttract: 6, projectorRun: 3} as const, rolloff: 1, band: 2.4, edge: 0.25, tau: 0.35, fadeOut: 0.8, eps: 0.004,
  chime: {range: 8, firstS: [6, 14] as const, minS: 60, maxS: 90, maxStepS: 0.5, ref: 8, rolloff: 1, maxDist: 40, send: 0.5},
} as const;
const LOCATION_CUES: ReadonlySet<string> = new Set<LocationCue>(['clockTick', 'arcadeAttract', 'projectorRun']);
/** A deterministic 0..1 value per (seed, n) (the chime sequence). */
function hash01(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
interface LocationChannel { e: LocationEmitter; src: AudioBufferSourceNode; g: GainNode; v: number; released: number }

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
  // Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the sounding stall / pour (one each) and the cart rolling channel
  private stallVoice: Voice | null = null;
  private pourVoice: Voice | null = null;
  private cart: {src: AudioBufferSourceNode; fade: GainNode; lp: BiquadFilterNode; pan: PannerNode; k: number; idle: ReturnType<typeof setTimeout> | null} | null = null;
  private cartStats = {starts: 0, stops: 0};
  // Task skyways-level-20261106 (lane CAR2): the prize car's engine channel (both loops; null while nobody drives) + counters
  // (round 2, lane AUDIO: + the reverse whine loop, per-loop rates, the start one-shot's voice and the startup hold)
  private engine: {idle: AudioBufferSourceNode; drive: AudioBufferSourceNode; rev: AudioBufferSourceNode | null; gi: GainNode; gd: GainNode; gr: GainNode | null;
    pan: PannerNode; ri: number; rd: number; rr: number; vi: number; vd: number; vr: number; rpm: number; revT: number; startT: number; hold: number} | null = null;
  private engineStart: Voice | null = null;
  private carStats = {starts: 0, stops: 0, revs: 0, startCues: 0, skids: 0, doors: 0, brakes: 0, impacts: 0};
  private skidAt = -Infinity;
  private brakeAt = -Infinity;
  private carImpactAt = {car: -Infinity, flesh: -Infinity};
  // Task skyways-destinations-20261106 (lane AUDIO): the location emitters (LOCATION_AUDIO), their channels, the clock chime's countdown
  private locations: LocationEmitter[] = [];
  private locCh: LocationChannel[] = [];
  private locChime = {seed: 0, n: 0, left: Infinity, t: -1};
  private locStats = {starts: 0, stops: 0, cuts: 0, chimes: 0};
  private pannersCreated = 0;
  private dropped = 0;
  private culled = 0;
  private tokens: Record<BucketName, {n: number; t: number}> = {casing: {n: 6, t: 0}, impact: {n: 6, t: 0}, step: {n: 4, t: 0}, fall: {n: 3, t: 0}, drip: {n: 2, t: 0}, confirm: {n: 4, t: 0}, flicker: {n: 2, t: 0},
    drag: {n: 3, t: 0}};
  // Task mall-round2-20261031 (lane AUDIO, M01): the sounding drag voice per sliding cardboard prop + counters (debugState().drag).
  private drags = new Map<object, Voice>();
  private dragStats = {ticks: 0, stops: 0, capped: 0, handoffs: 0};
  // Iteration 12 (AUDIO): foreground hit confirm — the latest player shot (onset time, voice) and its confirms so far.
  private revOut: GainNode | null = null;
  private shotAt = -Infinity;
  private shotVoice: Voice | null = null;
  private shotConfirms = 0;
  private shotConfirmed = new WeakSet<object>();
  private confirms = 0;
  /** Head-hit skull cracks played (task studio-general-armor-20261107-231448-01; QA / tests). */
  headConfirms = 0;
  // Iteration 12 (AUDIO): burning flare loops (bounded, FLARE_LOOP.max).
  private flareLoops: FlareLoop[] = [];
  /** Task reactor-build-20261101: the Reactor's machine loops (bounded: MACHINE_LOOP.max). */
  private machineLoops: FlareLoop[] = [];
  /** Task reactor-surface-ending-20261102 (lane AUDIO): the surface rain bed's one channel (RAIN_BED; null until rain is first asked for). */
  private rain: {g: GainNode; lp: BiquadFilterNode; src: AudioBufferSourceNode | null; level: number; muffle: number} | null = null;
  // Task track1-siren-blightbelly-20261031 (lane AUDIO): the sounding hum phrase per Siren, the live gas hisses, once-per-enemy memories and counters (debugState().t1).
  private t1Hums = new Map<object, Voice>();
  private t1Hisses: Voice[] = [];
  private t1Once = {scream: new WeakSet<object>(), burst: new WeakSet<object>(), hiss: new WeakSet<object>()};
  private t1Stats = {hums: 0, humsSilent: 0, screams: 0, bursts: 0, hisses: 0, repeats: 0};
  // Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO): per-Strainer gait phase / swing / squish memories (keyed
  // by the actor, weak), the sounding voices per Strainer cue (own caps) and counters (debugState().strainer).
  private sGait = new WeakMap<object, {clip: 'Walk' | 'Run' | null; ph: number; last: number}>();
  private sSwing = new WeakMap<object, {seq: number; t: number; clip: Clip | null; peak: number; done: boolean}>();
  private sSwingLast: string | null = null;
  private sSquishAt = new WeakMap<object, number>();
  private sVoices: Record<StrainerVoiceKind, Voice[]> = {step: [], swing: [], contact: [], squish: []};
  private sStats = {steps: 0, swings: 0, contacts: 0, squishes: 0, capped: 0, limited: 0};
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
    this.stopCartRoll(0.05); // task train-fuel-system (lane PORT): the cart rumble never waits out a menu
    this.stopCarEngine(0.05); // (lane CAR2) the Skyways car's engine too
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
  debugState(): {contexts: number; state: string; desired: Desired; ambientLoops: number; ambientSources: number; sounds: number; room: RoomKind; area: string; floor: string; voices: number; hrtfVoices: number; panners: number; convolvers: number; dropped: number; culled: number; emitters: number; emitterOn: boolean; fans: {sources: number; channels: number; active: number; looping: number}; beds: Record<string, number>; bedsPlaying: string[]; listener: {x: number; y: number; z: number; yaw: number}; bank: ReturnType<ClipBank['stats']>; confirmVoices: number; confirms: number; flareLoops: number; vocal: {voices: number; gate: boolean; played: number; gated: number; sight: number; capped: number; stolen: number; steps: number}; t1: {humVoices: number; hissVoices: number; hums: number; humsSilent: number; screams: number; bursts: number; hisses: number; repeats: number}; drag: {voices: number; ticks: number; stops: number; capped: number; handoffs: number}; strainer: {voices: Record<StrainerVoiceKind, number>; steps: number; swings: number; contacts: number; squishes: number; capped: number; limited: number}; rain: {level: number; muffle: number; looping: boolean}} {
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
      drag: {voices: [...this.drags.values()].filter(v => v.end > (this.ctx?.currentTime ?? 0)).length, ...this.dragStats}, // M01 (lane AUDIO)
      strainer: {voices: {step: this.sLive('step'), swing: this.sLive('swing'), contact: this.sLive('contact'), squish: this.sLive('squish')}, ...this.sStats}, // lane AUDIO (strainer squish set)
      rain: {level: Math.max(0, this.rain?.level ?? 0), muffle: Math.max(0, this.rain?.muffle ?? 0), looping: !!this.rain?.src}, // lane AUDIO (surface ending)
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
    if (++this.emitterTick >= 12) { this.emitterTick = 0; this.updateEmitter(); this.updateFans(); this.updateLoops(false); this.updateLocations(); } // (+ skyways-destinations lane AUDIO: the location emitters)
  }

  /**
   * Per-station hooks: occlusion (0 = clear .. 1 = blocked) and humming fixture positions. Iteration 12: a new station
   * (new occlusion) also fades out every burning-flare loop of the previous one.
   */
  setWorld(o: {occlusion?: ((x: number, z: number, y?: number) => number) | null; emitters?: Pos[]; fans?: readonly FanSource[]}): void {
    if (o.occlusion !== undefined) { this.occlusion = o.occlusion; this.stopFlares(0.05); this.stopMachines(0.05); this.stopTrack1Cues(0.05); this.stopDrags(0.05); this.stopCartRoll(0.05); this.stopCarEngine(0.05); this.setLocationEmitters([], 0.05); } // track1 (lane AUDIO): hums / hisses too; M01: drags; train-fuel (lane PORT): the cart rumble; lane CAR2: the car engine; skyways-destinations (lane AUDIO): the location emitters
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
    const full = clip.dur / rate;
    const dur = o.maxDur !== undefined && o.maxDur > 0 ? Math.min(full, o.maxDur) : full;
    if (dur < full) { // M01: a truncated window fades out instead of clicking off
      const f = Math.min(o.fadeOut ?? 0.04, dur * 0.5);
      gn.gain.setValueAtTime(g, t + dur - f);
      gn.gain.linearRampToValueAtTime(0, t + dur);
    }
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

  /**
   * Task studio-market-rework-20261108-074144-01 (lane COMBAT): a hostile survivor's gunshot at a world point — the SAME shot take as the
   * player's own gun of that kind (WEAPON_SHOT_CUES), positional (distance, occlusion, reverb send), never dropped (pri 2). It never
   * starts the player's hit-confirm window (shotAt is the player's own shot only).
   */
  npcShot(kind: WeaponSoundKind, x: number, y: number, z: number): void {
    const v = this.voice({at: {x, y, z}, ref: 3.2, rolloff: 0.9, send: 0.9, pri: 2, maxDist: 120, occMax: 0.75});
    const map = WEAPON_SHOT_CUES[kind] ?? WEAPON_SHOT_CUES.rifle;
    this.play(v, map.cue, {rate: rnd(0.96, 1.04) * map.rate, jitter: 0, gain: map.gain});
    if (kind === 'shotgun') this.play(this.voice({at: {x, y, z}, ref: 2, rolloff: 1.1, send: 0.25, pri: 1, maxDist: 35}), 'shotgunPump', {delay: 0.42});
  }

  /**
   * (lane COMBAT) A hostile survivor's reload at a world point, `seconds` long: the player's reload cues of that kind, positional (the
   * magazine out / in and the charging handle; a shotgun's shells one by one, then the pump).
   */
  npcReload(kind: WeaponSoundKind, x: number, y: number, z: number, seconds: number, shells = 1): void {
    const at = {x, y, z}, o = {at, ref: 1.8, rolloff: 1.2, send: 0.2, pri: 1, maxDist: 30};
    if (kind === 'shotgun') {
      const n = Math.max(1, Math.min(8, shells)), step = seconds / (n + 1);
      for (let i = 0; i < n; i++) this.play(this.voice(o), 'shellInsert', {delay: step * (i + 0.6), jitter: 0.05});
      this.play(this.voice(o), 'shotgunPump', {delay: Math.max(0, seconds - 0.35)});
      return;
    }
    const rate = kind === 'pistol' ? 1.25 : 1;
    this.play(this.voice(o), 'rifleMagOut', {delay: 0.05, rate});
    this.play(this.voice(o), 'rifleMagIn', {delay: seconds * 0.6, rate});
    this.play(this.voice(o), 'rifleCharge', {delay: Math.max(0, seconds - 0.3), rate: kind === 'pistol' ? 1.35 : 1});
  }

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
  hitConfirm(x: number, _y: number, z: number, enemy?: object, head = false): void {
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
    // the head: the skull crack on the same voice, same onset (task studio-general-armor-20261107-231448-01)
    if (head && this.play(v, 'headHit', {delay, jitter: 0.03, gainJitter: 0, gain: HIT_CONFIRM.headLevel * Math.pow(HIT_CONFIRM.multiGain, k) / CUE_GAIN.headHit})) this.headConfirms++;
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
   * Task mall-round2-20261031 (lane AUDIO, M01): cardboard: a loose cardboard prop's soft thud (CARDBOARD_AUDIO.thud; `mass` kg sets
   * its weight); every other family is unchanged.
   */
  physImpact(x: number, y: number, z: number, speed: number, family: ImpactFamily, mass?: number): void {
    if (!this.live || speed < 0.6) return;
    const L = this.listener;
    if (Math.hypot(x - L.x, z - L.z) > 24) { this.culled++; return; }
    if (!this.take(family === 'prop' || family === 'cardboard' ? 'fall' : 'casing')) return;
    const s = clamp01(speed / 5);
    if (family === 'cardboard') {
      const T = CARDBOARD_AUDIO.thud, rate = cardboardThudRate(mass, s);
      const v = this.voice({at: {x, y, z}, ref: T.ref, rolloff: T.rolloff, send: T.send, pri: 0, maxDist: T.maxDist, gain: T.base + (1 - T.base) * 0.75 * Math.pow(s, 0.8)});
      if (this.play(v, T.body.cue, {rate, jitter: T.jitter, gain: T.body.gain, filter: {type: 'lowpass', freq: T.body.lowpass, q: LP_FLAT_Q_DB}})) {
        this.play(v, T.slap.cue, {rate: rate * T.slap.rateMul, jitter: T.jitter, gain: T.slap.gain, filter: {type: 'lowpass', freq: T.slap.lowpass, q: LP_FLAT_Q_DB}, maxDur: T.slap.maxDur, fadeOut: T.slap.fade});
      }
      return;
    }
    const base = family === 'prop' ? 0.45 : family === 'stone' || family === 'wood' || family === 'glass' || family === 'metal' ? 0.1 : 0.25;
    const v = this.voice({at: {x, y, z}, ref: family === 'prop' ? 1.8 : 1.1, rolloff: 1.4, send: 0.35, pri: 0, maxDist: 24, gain: base + (1 - base) * 0.75 * Math.pow(s, 0.8)});
    this.play(v, PHYS_CUE[family], {rate: 0.92 + 0.16 * s, jitter: 0.07});
  }
  /**
   * Task mall-round2-20261031 (lane AUDIO, M01): one drag tick of the cardboard prop `id` sliding along its floor at `speed` m/s
   * (physics/dynamicItems.ts paces the ticks, PROP_DRAG; never per frame) — a short lowpassed 'jump' scuff (CARDBOARD_AUDIO.drag). One
   * voice per prop: a still-sounding previous tick hands over (fades in `handoff` s). Bounded by distance, `maxVoices` drag voices at
   * once (further props wait for the next tick), the 'drag' token bucket and the expendable (pri 0) voice cap.
   */
  propDrag(x: number, y: number, z: number, speed: number, id: object): void {
    const ctx = this.live;
    if (!ctx || !(speed > 0.05)) return;
    const D = CARDBOARD_AUDIO.drag, L = this.listener, now = ctx.currentTime;
    const prev = this.drags.get(id);
    if (prev) { this.drags.delete(id); if (prev.end > now) { this.fadeVoice(prev, D.handoff); this.dragStats.handoffs++; } }
    if (Math.hypot(x - L.x, z - L.z) > D.maxDist) { this.culled++; return; }
    let n = 0;
    for (const [k, v] of this.drags) { if (v.end > now) n++; else this.drags.delete(k); }
    if (n >= D.maxVoices) { this.dragStats.capped++; return; }
    if (!this.take('drag')) return;
    const s = clamp01(speed / D.fast);
    const v = this.voice({at: {x, y, z}, ref: D.ref, rolloff: D.rolloff, send: D.send, pri: 0, maxDist: D.maxDist, gain: D.level[0] + (D.level[1] - D.level[0]) * s});
    const clip = this.play(v, D.cue, {rate: D.rate[0] + (D.rate[1] - D.rate[0]) * s, jitter: D.jitter, gainJitter: D.gainJitter, gain: D.gain,
      filter: {type: 'lowpass', freq: D.lowpass, q: LP_FLAT_Q_DB}, maxDur: D.maxDur, fadeOut: D.fade});
    if (!v || !clip) return;
    this.drags.set(id, v);
    this.dragStats.ticks++;
  }
  /** M01: the prop `id` stopped sliding (or stopped simulating): its sounding drag fades out in CARDBOARD_AUDIO.drag.release s. Idempotent. */
  propDragStop(id: object): void {
    const v = this.drags.get(id);
    if (!v) return;
    this.drags.delete(id);
    const ctx = this.ctx;
    if (ctx && v.end > ctx.currentTime) { this.fadeVoice(v, CARDBOARD_AUDIO.drag.release); this.dragStats.stops++; }
  }
  /** M01: every sounding drag fades out (a new station). */
  private stopDrags(fadeS: number): void {
    const ctx = this.ctx;
    for (const v of this.drags.values()) if (ctx && v.end > ctx.currentTime) this.fadeVoice(v, fadeS);
    this.drags.clear();
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

  /**
   * Task reactor-build-20261101 (primary): a Reactor machine one-shot at a world point (generator start, breaker, fuse, valve, pump,
   * the core's startup swell). Silent when audio is paused / not started or the clip is missing.
   */
  reactorCue(cue: MachineCue, x: number, y: number, z: number, o: MachineCueOpts = {}): void {
    this.play(this.voice({at: {x, y, z}, ref: o.ref ?? MACHINE_LOOP.ref, rolloff: MACHINE_LOOP.rolloff, send: MACHINE_LOOP.send, pri: o.pri ?? 1, maxDist: o.maxDist ?? MACHINE_LOOP.maxDist}), cue,
      {jitter: 0.02, gainJitter: 0.5, gain: o.gain, rate: o.rate, delay: o.delay, filter: o.filter}); // (lane STARTUP: + per-call mix; lane AUDIO: + filter)
  }

  /**
   * Task reactor-build-20261101 (primary): a Reactor machine's spatial running loop at a world point (a running generator, a zone's
   * extraction fans, the restarted core's hum). Returns a handle like flareBurnStart (no-op when audio is not running or the clip is
   * missing). At most MACHINE_LOOP.max (the oldest fades to make room); all stop on a new world.
   */
  reactorLoop(cue: MachineLoopCue, x: number, y: number, z: number, o: {ref?: number; far?: number; level?: number; rate?: number} = {}): MachineLoopHandle | null {
    const ctx = this.live;
    if (!ctx) return null;
    const clip = this.bank.pick(cue);
    if (!clip) return null;
    this.machineLoops = this.machineLoops.filter(l => !l.stopped);
    while (this.machineLoops.length >= MACHINE_LOOP.max) this.endLoop(this.machineLoops[0], 0.4);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    const a = clip.loopStart ?? clip.offset, b = clip.loopEnd ?? clip.offset + clip.dur;
    src.loopStart = a;
    src.loopEnd = b;
    const jit = rnd(0.97, 1.03); // two machines never phase into one
    src.playbackRate.value = jit * (o.rate ?? 1);
    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.gain.setTargetAtTime(CUE_GAIN[cue] * (o.level ?? 1), now, MACHINE_LOOP.fadeIn / 3);
    const level = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const panner = this.makePanner(ctx, false, o.ref ?? MACHINE_LOOP.ref, MACHINE_LOOP.rolloff);
    src.connect(fade).connect(level).connect(filter).connect(panner).connect(this.master);
    const nodes: AudioNode[] = [src, fade, level, filter, panner];
    if (this.reverbIn) {
      const sn = ctx.createGain();
      sn.gain.value = MACHINE_LOOP.send;
      filter.connect(sn).connect(this.reverbIn);
      nodes.push(sn);
    }
    const loop: FlareLoop = {src, fade, level, filter, panner, nodes, pos: {x, y, z}, next: 0, stopped: false, far: o.far ?? MACHINE_LOOP.far};
    this.setPannerPos(panner, x, y, z);
    this.loopFilter(loop, true);
    src.onended = () => { for (const n of loop.nodes) { try { n.disconnect(); } catch { /* already gone */ } } loop.nodes.length = 0; };
    src.start(now, a + Math.random() * Math.max(0, b - a));
    this.soundsStarted++;
    this.machineLoops.push(loop);
    const self = this;
    return {
      setPos(px: number, py: number, pz: number) {
        if (loop.stopped) return;
        loop.pos.x = px; loop.pos.y = py; loop.pos.z = pz;
        self.setPannerPos(loop.panner, px, py, pz);
      },
      stop(fadeS?: number) { self.endLoop(loop, fadeS ?? MACHINE_LOOP.fadeOut); },
      get playing() { return !loop.stopped; },
      // task reactor-playtest-round2-20261102 (lane STARTUP): live level / rate (no new nodes)
      setLevel(k: number, tauS = 0.4) {
        const c = self.ctx;
        if (loop.stopped || !c || !Number.isFinite(k)) return;
        loop.fade.gain.cancelScheduledValues(c.currentTime);
        loop.fade.gain.setTargetAtTime(CUE_GAIN[cue] * Math.max(0, k), c.currentTime, Math.max(0.01, tauS));
      },
      setRate(r: number, tauS = 0.4) {
        const c = self.ctx;
        if (loop.stopped || !c || !Number.isFinite(r)) return;
        loop.src.playbackRate.cancelScheduledValues(c.currentTime);
        loop.src.playbackRate.setTargetAtTime(jit * Math.max(0.25, Math.min(4, r)), c.currentTime, Math.max(0.01, tauS));
      },
    };
  }

  /**
   * Task reactor-surface-ending-20261102 (lane AUDIO): the surface rain bed (RAIN_BED). `level` 0..1 (0 = silent), `muffle` 0..1
   * (sheltered: low-passed and quieter). Cheap when unchanged; the channel and its one looping source are created once, the first time
   * rain is heard (never before the clip is decoded: no silent-play counting while it loads).
   */
  rainBed(level: number, muffle = 0): void {
    const ctx = this.ctx, bus = this.ambBus;
    if (!ctx || !bus) return;
    const lv = clamp01(Number.isFinite(level) ? level : 0), mf = clamp01(Number.isFinite(muffle) ? muffle : 0);
    let r = this.rain;
    if (!r) {
      if (lv <= 0) return;
      const g = ctx.createGain();
      g.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = RAIN_BED.openHz; lp.Q.value = 0.5;
      g.connect(lp).connect(bus);
      r = this.rain = {g, lp, src: null, level: -1, muffle: -1};
    }
    if (!r.src && lv > 0 && this.bank.has('bedRain')) { const clip = this.bank.pick('bedRain'); if (clip) r.src = this.loopSource(clip, r.g); }
    if (Math.abs(lv - r.level) < 0.004 && Math.abs(mf - r.muffle) < 0.004) return;
    r.level = lv; r.muffle = mf;
    const t = ctx.currentTime;
    r.g.gain.cancelScheduledValues(t);
    r.g.gain.setTargetAtTime(RAIN_BED.gain * AMBIENT_LEVEL * lv * (1 - (1 - RAIN_BED.shelterLevel) * mf), t, RAIN_BED.tauS / 3);
    r.lp.frequency.cancelScheduledValues(t);
    r.lp.frequency.setTargetAtTime(RAIN_BED.openHz * Math.pow(RAIN_BED.muffledHz / RAIN_BED.openHz, mf), t, RAIN_BED.tauS / 3);
  }

  // ---------------------------------------------------------------------------------------
  // Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train FUEL cues (FUEL_AUDIO; silent no-ops when audio is
  // paused / not started or a clip is missing).

  /**
   * The train engine refusing to start for want of fuel (crank, cough, die): ONE take per call, under the floor of the car the player
   * stands in (listener-relative, a little room). A stall still sounding is cut first (never two, never a loop). Returns the clip's length
   * (s; 0 = nothing played).
   */
  engineStall(): number {
    this.cutVoice(this.stallVoice, 0.06);
    const v = this.voice({send: FUEL_AUDIO.stall.send, pri: 1});
    const clip = this.play(v, 'engineStall', {jitter: 0.02, gainJitter: 0.5});
    this.stallVoice = clip ? v : null;
    return clip ? clip.dur : 0;
  }

  /**
   * One fuel can poured into the train's filler neck (at the hands). A pour still sounding is cut first. Returns the clip's length (s;
   * 0 = nothing played). stopFuelPour() cuts it (a cancelled pour).
   */
  fuelPour(): number {
    this.cutVoice(this.pourVoice, 0.05);
    const v = this.voice({send: FUEL_AUDIO.pour.send, pri: 1});
    const clip = this.play(v, 'fuelPour', {jitter: 0.03, gainJitter: 0.8});
    this.pourVoice = clip ? v : null;
    return clip ? clip.dur : 0;
  }

  /** A sounding pour fades out (the pour was cancelled: nothing poured). Plays nothing. */
  stopFuelPour(): void {
    this.cutVoice(this.pourVoice, FUEL_AUDIO.pour.cutFade);
    this.pourVoice = null;
  }

  /**
   * The fuel hose's nozzle seated in the train's fuel cap (`on`) or pulled out: the existing magazine seat / release clips, lower and
   * heavier (a steel nozzle), with the switch click as the latch. `at` = the cap (world), omitted = at the listener.
   */
  hoseConnect(on: boolean, at?: Pos): void {
    const H = FUEL_AUDIO.hose, m = on ? H.on : H.off;
    const v = this.voice({at, send: 0.15, pri: 1, ref: 2, maxDist: 30});
    this.play(v, m.cue, {rate: m.rate, gain: m.gain, jitter: 0.02});
    this.play(v, 'click', {rate: H.click.rate, gain: H.click.gain, delay: H.click.delay, jitter: 0.03});
  }

  /**
   * The fuel cart's wheels rolling (call it every frame the cart is simulated): `speed01` 0..1 of its push speed (0 = stopped), `at` = the
   * cart (world; omitted = at the listener). ONE channel for the page: created on the first rolling call (from silence, eased in — never a
   * restart at full volume), then only its targets move (unchanged values cost nothing); at 0 it fades and is released after
   * FUEL_AUDIO.cart.idleStopS unless the cart rolls again. Paused audio / a menu / a new world stop it at once.
   */
  cartRoll(speed01: number, at?: Pos): void {
    const C = FUEL_AUDIO.cart, ctx = this.live;
    const k = Number.isFinite(speed01) ? clamp01(speed01) : 0;
    if (!ctx) { this.stopCartRoll(0.05); return; }
    let c = this.cart;
    if (k < C.minK) {
      if (!c) return;
      if (c.k !== 0) {
        c.k = 0;
        c.fade.gain.cancelScheduledValues(ctx.currentTime);
        c.fade.gain.setTargetAtTime(0, ctx.currentTime, C.tau / 2);
      }
      const mine = c;
      if (!c.idle) c.idle = setTimeout(() => { if (this.cart === mine) this.stopCartRoll(0.02); }, C.idleStopS * 1000);
      return;
    }
    if (!c) {
      const clip = this.bank.pick('cartRoll');
      if (!clip) return;
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.loop = true;
      const a = clip.loopStart ?? clip.offset, b = clip.loopEnd ?? clip.offset + clip.dur;
      src.loopStart = a;
      src.loopEnd = b;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = C.lowpass[0];
      const fade = ctx.createGain();
      fade.gain.value = 0;
      const pan = this.makePanner(ctx, false, C.ref, C.rolloff);
      src.connect(lp).connect(fade).connect(pan).connect(this.master);
      const nodes: AudioNode[] = [src, lp, fade, pan];
      if (this.reverbIn) {
        const sn = ctx.createGain();
        sn.gain.value = C.send;
        fade.connect(sn).connect(this.reverbIn);
        nodes.push(sn);
      }
      src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } } nodes.length = 0; };
      src.start(ctx.currentTime, a + Math.random() * Math.max(0, b - a));
      this.soundsStarted++;
      this.cartStats.starts++;
      c = this.cart = {src, fade, lp, pan, k: 0, idle: null};
    }
    if (c.idle) { clearTimeout(c.idle); c.idle = null; }
    const p = at ?? this.listener;
    this.setPannerPos(c.pan, p.x, p.y, p.z);
    if (Math.abs(k - c.k) < 0.01) return;
    c.k = k;
    const t = ctx.currentTime, lerp = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * k;
    c.fade.gain.cancelScheduledValues(t);
    c.fade.gain.setTargetAtTime(CUE_GAIN.cartRoll * lerp(C.level), t, C.tau);
    c.src.playbackRate.cancelScheduledValues(t);
    c.src.playbackRate.setTargetAtTime(lerp(C.rate), t, C.tau);
    c.lp.frequency.cancelScheduledValues(t);
    c.lp.frequency.setTargetAtTime(lerp(C.lowpass), t, C.tau);
  }

  /** The cart rolling channel fades out and is released (speed 0 for idleStopS, pause, a new world, the cart system's dispose). Plays nothing. */
  stopCartRoll(fadeS: number = FUEL_AUDIO.cart.stopFade): void {
    const c = this.cart;
    if (!c) return;
    this.cart = null;
    if (c.idle) clearTimeout(c.idle);
    this.cartStats.stops++;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, f = Math.max(0.01, fadeS);
    c.fade.gain.cancelScheduledValues(t);
    c.fade.gain.setTargetAtTime(0, t, f / 3);
    try { c.src.stop(t + f + 0.05); } catch { /* already stopped */ }
  }

  /** QA / tests: the fuel cues' live state (the cart channel exists / its speed; stall / pour sounding). Plays nothing. */
  fuelAudioState(): {cart: boolean; cartK: number; cartStarts: number; cartStops: number; stall: boolean; pour: boolean} {
    const now = this.ctx?.currentTime ?? 0;
    return {cart: !!this.cart, cartK: this.cart?.k ?? 0, cartStarts: this.cartStats.starts, cartStops: this.cartStats.stops,
      stall: !!this.stallVoice && this.stallVoice.end > now, pour: !!this.pourVoice && this.pourVoice.end > now};
  }

  /**
   * The Skyways prize car's engine while someone drives it (every frame): `speed01` 0..1 of its top speed, `throttle01` 0..1 (the pedal
   * held in the direction of travel), `at` = the engine (world; omitted = the listener), `reverse01` 0..1 of the reverse top speed while
   * reversing. ONE channel (CAR_AUDIO: idle + drive + reverse-whine loops, one panner): created from silence on the first call — `rev`
   * (getting in) plays the engine start and holds the loops under it —, then only its targets move. Paused audio: nothing starts (a
   * running one was stopped).
   */
  carEngine(speed01: number, throttle01: number, at?: Pos, o: {rev?: boolean; reverse01?: number} = {}): void {
    const A = CAR_AUDIO, ctx = this.live;
    if (!ctx) { this.stopCarEngine(0.05); return; }
    const fin = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? clamp01(v) : 0);
    const k = fin(speed01), th = fin(throttle01), rv = fin(o.reverse01);
    const p = at ?? this.listener;
    let e = this.engine;
    if (!e) {
      const ci = this.bank.pick('carIdle'), cd = this.bank.pick('carDrive');
      if (!ci || !cd) return;
      const cr = this.bank.has('carReverse') ? this.bank.pick('carReverse') : null;
      const pan = this.makePanner(ctx, false, A.ref, A.rolloff);
      const nodes: AudioNode[] = [pan];
      const loop = (clip: NonNullable<typeof ci>): [AudioBufferSourceNode, GainNode] => {
        const src = ctx.createBufferSource();
        src.buffer = clip.buffer;
        src.loop = true;
        const a = clip.loopStart ?? clip.offset, b = clip.loopEnd ?? clip.offset + clip.dur;
        src.loopStart = a;
        src.loopEnd = b;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(pan);
        nodes.push(src, g);
        src.start(ctx.currentTime, a + Math.random() * Math.max(0, b - a));
        this.soundsStarted++;
        return [src, g];
      };
      const [idle, gi] = loop(ci), [drive, gd] = loop(cd);
      const [rev, gr] = cr ? loop(cr) : [null, null];
      pan.connect(this.master);
      if (this.reverbIn) {
        const sn = ctx.createGain();
        sn.gain.value = A.send;
        pan.connect(sn).connect(this.reverbIn);
        nodes.push(sn);
      }
      idle.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } } nodes.length = 0; };
      this.carStats.starts++;
      e = this.engine = {idle, drive, rev, gi, gd, gr, pan, ri: -1, rd: -1, rr: -1, vi: -1, vd: -1, vr: -1, rpm: 0, revT: -Infinity, startT: -Infinity, hold: 1};
    }
    const t = ctx.currentTime;
    if (o.rev) {
      // getting in: the start one-shot at the engine (a sounding one is cut first), the loops held silent under its crank / catch
      this.carStats.revs++;
      this.cutVoice(this.engineStart, 0.05);
      this.engineStart = null;
      const v = this.bank.has('carStart') ? this.voice({at: {x: p.x, y: p.y, z: p.z}, send: A.start.send, pri: 1, ref: A.ref, rolloff: A.rolloff, maxDist: 40, occlude: false}) : null;
      if (v && this.play(v, 'carStart', {jitter: 0.02, gainJitter: 0.5, delay: A.start.delayS})) { this.engineStart = v; e.startT = t + A.start.delayS; e.hold = 0; this.carStats.startCues++; }
      else e.revT = t; // no start clip: the round-1 blip
    }
    this.setPannerPos(e.pan, p.x, p.y, p.z);
    const S = A.start, since = t - e.startT;
    if (e.hold < 1) e.hold = Math.max(e.hold, clamp01((since - (th > 0 ? S.catchS : S.holdS)) / S.fadeS)); // (never falls back)
    const r = t - e.revT < A.rev.s ? A.rev.peak * (1 - (t - e.revT) / A.rev.s) : 0;
    const rpm = e.rpm = Math.max(r, clamp01(A.rpm.speed * k + A.rpm.throttle * th));
    const lerp = (q: readonly [number, number], f: number) => q[0] + (q[1] - q[0]) * f;
    const ri = lerp(A.idleRate, rpm), rd = lerp(A.driveRate, rpm), rr = lerp(A.reverse.rate, rv);
    const vi = e.hold * CUE_GAIN.carIdle * (A.idleFloor + (1 - A.idleFloor) * Math.cos((rpm * Math.PI) / 2));
    const vd = e.hold * CUE_GAIN.carDrive * Math.sin((rpm * Math.PI) / 2);
    const vr = e.gr && rv > A.reverse.min ? e.hold * CUE_GAIN.carReverse * lerp(A.reverse.level, rv) : 0;
    const ease = (param: AudioParam, v: number, was: number): number => {
      if (Math.abs(v - was) < A.eps) return was;
      param.cancelScheduledValues(t);
      param.setTargetAtTime(v, t, A.tau);
      return v;
    };
    e.ri = ease(e.idle.playbackRate, ri, e.ri);
    e.rd = ease(e.drive.playbackRate, rd, e.rd);
    e.vi = ease(e.gi.gain, vi, e.vi);
    e.vd = ease(e.gd.gain, vd, e.vd);
    if (e.rev && e.gr) { e.rr = ease(e.rev.playbackRate, rr, e.rr); e.vr = ease(e.gr.gain, vr, e.vr); }
  }

  /**
   * The car's engine fades out and is released (getting out, death, teardown: `stopFade` with the spin-down; pause, a new world: at once).
   * A sounding engine start is cut. Plays nothing.
   */
  stopCarEngine(fadeS: number = CAR_AUDIO.stopFade): void {
    const ctx = this.ctx;
    this.cutVoice(this.engineStart, Math.min(fadeS, 0.15));
    this.engineStart = null;
    const e = this.engine;
    if (!e) return;
    this.engine = null;
    this.carStats.stops++;
    if (!ctx) return;
    const t = ctx.currentTime, f = Math.max(0.01, fadeS);
    for (const g of [e.gi, e.gd, e.gr]) if (g) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, f / 3); }
    if (f >= 0.2) { // (getting out) the engine winds down as it fades
      for (const [src, r] of [[e.idle, e.ri], [e.drive, e.rd], [e.rev, e.rr]] as const) {
        if (!src || !(r > 0)) continue;
        src.playbackRate.cancelScheduledValues(t);
        src.playbackRate.setTargetAtTime(r * CAR_AUDIO.stopRate, t, f / 2);
      }
    }
    for (const src of [e.idle, e.drive, e.rev]) if (src) { try { src.stop(t + f + 0.05); } catch { /* already stopped */ } }
  }

  /**
   * The brake-to-stop (a real brake brought the car to rest: the squeal, the scrub, the suspension settling), at the car. `strength` 0..1
   * (the speed it braked from) sets the level; at most one every CAR_AUDIO.brake.minGapS. True = it played.
   */
  carBrake(at?: Pos, strength = 1): boolean {
    const B = CAR_AUDIO.brake, ctx = this.live;
    if (!ctx || ctx.currentTime - this.brakeAt < B.minGapS) return false;
    const s = Number.isFinite(strength) ? clamp01(strength) : 1;
    const v = this.voice({at, send: B.send, pri: 1, ref: B.ref, maxDist: B.maxDist, gain: B.base + (1 - B.base) * s});
    if (!this.play(v, 'carBrake', {jitter: 0.04, gainJitter: 1})) return false;
    this.brakeAt = ctx.currentTime;
    this.carStats.brakes++;
    return true;
  }

  /**
   * One of the car's contacts at `speed` m/s closing: 'car' = its body against the world (the metal crash + the topple rattle, heavier with
   * speed), 'flesh' = a body it hit (the flesh slap + the body thump). Level / rate by the speed from impact.from[what] to impact.full;
   * at most one per kind every impact.minGapS (a scrape along a wall reports every frame). True = it played.
   */
  carImpact(x: number, y: number, z: number, speed: number, what: 'car' | 'flesh'): boolean {
    const I = CAR_AUDIO.impact, ctx = this.live;
    if (!ctx || !(speed >= I.from[what])) return false;
    const now = ctx.currentTime;
    if (now - this.carImpactAt[what] < I.minGapS[what]) return false;
    const s = clamp01((speed - I.from[what]) / (I.full - I.from[what])), P = I[what];
    const lerp = (q: readonly [number, number]) => q[0] + (q[1] - q[0]) * s;
    const v = this.voice({at: {x, y, z}, ref: I.ref, rolloff: I.rolloff, send: I.send, pri: 1, maxDist: I.maxDist, gain: I.base + (1 - I.base) * Math.pow(s, 0.7)});
    if (!this.play(v, P.cue, {rate: lerp(P.rate), jitter: 0.05, gain: P.gain})) return false;
    this.play(v, P.layer.cue, {rate: lerp(P.layer.rate), jitter: 0.05, gain: P.layer.gain, delay: 0.004});
    this.carImpactAt[what] = now;
    this.carStats.impacts++;
    return true;
  }

  /** A tyre skid (a hard brake / handbrake turn at speed): one take, at most every CAR_AUDIO.skid.minGapS. True = it played. */
  carSkid(at?: Pos): boolean {
    const S = CAR_AUDIO.skid, ctx = this.live;
    if (!ctx || ctx.currentTime - this.skidAt < S.minGapS) return false;
    const v = this.voice({at, send: S.send, pri: 1, ref: S.ref, maxDist: S.maxDist});
    if (!this.play(v, 'carSkid', {jitter: 0.04, gainJitter: 1})) return false;
    this.skidAt = ctx.currentTime;
    this.carStats.skids++;
    return true;
  }

  /** The car's door (getting in or out), at the door. */
  carDoor(at?: Pos): void {
    const D = CAR_AUDIO.door;
    const v = this.voice({at, send: D.send, pri: 1, ref: D.ref, maxDist: D.maxDist});
    if (this.play(v, 'carDoor', {jitter: 0.03, gainJitter: 1})) this.carStats.doors++;
  }

  /**
   * QA / tests: the car cues' live state — the engine channel, its rpm and current targets (`rate` = the drive loop's rate, `idleRate`,
   * `reverseRate`; gains `idle` / `drive` / `reverse`), the startup hold (0 under the start one-shot .. 1), a start sounding, counters.
   * Plays nothing.
   */
  carAudioState(): {engine: boolean; rpm: number; rate: number; idleRate: number; reverseRate: number; idle: number; drive: number; reverse: number; hold: number;
    start: boolean; starts: number; stops: number; revs: number; startCues: number; skids: number; doors: number; brakes: number; impacts: number} {
    const e = this.engine, now = this.ctx?.currentTime ?? 0, g = (v: number | undefined) => Math.max(0, v ?? 0);
    return {engine: !!e, rpm: e?.rpm ?? 0, rate: g(e?.rd), idleRate: g(e?.ri), reverseRate: g(e?.rr), idle: g(e?.vi), drive: g(e?.vd), reverse: g(e?.vr),
      hold: e?.hold ?? 0, start: !!this.engineStart && this.engineStart.end > now, ...this.carStats};
  }

  // ---------------------------------------------------------------------------------------
  // Task studio-skyways-destinations-20261106-170011-01 (lane AUDIO): LOCATION emitters (LOCATION_AUDIO)

  /**
   * This section's location emitters (copied; invalid entries dropped; at most LOCATION_AUDIO.max). Every sounding channel fades out
   * (`fadeS`) — the next emitter tick picks again — and the clock chime's countdown restarts for the new clock list. [] = none.
   */
  setLocationEmitters(list: readonly LocationEmitter[], fadeS: number = LOCATION_AUDIO.fadeOut): void {
    const ok = (e: LocationEmitter) => LOCATION_CUES.has(e.cue) && [e.x, e.y, e.z, e.gain, e.range].every(Number.isFinite) && e.range > 0 && e.gain >= 0;
    this.locations = list.filter(ok).slice(0, LOCATION_AUDIO.max).map(e => ({...e}));
    for (const c of this.locCh) this.releaseLocation(c, fadeS);
    this.trimLocationFades();
    const clocks = this.locations.filter(e => e.cue === 'clockTick');
    const C = LOCATION_AUDIO.chime, s = this.locChime;
    s.seed = clocks.reduce((h, e) => Math.imul(h ^ Math.round(e.x * 10) ^ (Math.round(e.z * 10) << 11), 16777619) >>> 0, 2166136261);
    s.n = 0;
    s.left = clocks.length ? C.firstS[0] + (C.firstS[1] - C.firstS[0]) * hash01(s.seed, 0) : Infinity;
    s.t = -1;
    if (this.locations.length) this.emitterTick = 99; // pick at the next listener update (clearing needs no early tick: released above)
  }

  /** An emitter the listener can hear from here: its storey gate (feet within the band of its floor), then its distance (null = not). */
  private locHeard(e: LocationEmitter, feetY: number): number | null {
    if (e.floorY !== undefined && Math.abs(feetY - e.floorY) > (e.band ?? LOCATION_AUDIO.band)) return null;
    const d = this.dist(e);
    return d < e.range ? d : null;
  }

  /** The emitter tick: point channels at the nearest audible emitters, ease their levels, run the clock chime's countdown. */
  private updateLocations(): void {
    const ctx = this.ctx, bus = this.ambBus;
    if (!ctx || !bus) return;
    const A = LOCATION_AUDIO, t = ctx.currentTime, feet = this.listener.y - FAN_EYE_H;
    this.locCh = this.locCh.filter(c => c.released < 0 || t < c.released + A.fadeOut + 0.1);
    if (!this.locations.length && !this.locCh.length) return;
    const near: {e: LocationEmitter; d: number}[] = [];
    for (const e of this.locations) { const d = this.locHeard(e, feet); if (d !== null) near.push({e, d}); }
    near.sort((p, q) => p.d - q.d);
    const picks = near.slice(0, A.voices), keep = new Set(picks.map(p => p.e));
    for (const c of this.locCh) if (c.released < 0 && !keep.has(c.e)) this.releaseLocation(c, A.fadeOut);
    this.trimLocationFades();
    for (const {e, d} of picks) {
      let c = this.locCh.find(q => q.e === e && q.released < 0);
      if (!c) {
        if (!this.bank.has(e.cue)) continue; // not decoded yet: silent until it is (no silent-play count per tick)
        const clip = this.bank.pick(e.cue);
        if (!clip) continue;
        const src = ctx.createBufferSource();
        src.buffer = clip.buffer;
        src.loop = true;
        const a = clip.loopStart ?? clip.offset, b = clip.loopEnd ?? clip.offset + clip.dur;
        src.loopStart = a;
        src.loopEnd = b;
        const g = ctx.createGain();
        g.gain.value = 0;
        const pan = this.makePanner(ctx, false, A.ref[e.cue], A.rolloff);
        this.setPannerPos(pan, e.x, e.y, e.z);
        src.connect(g).connect(pan).connect(bus);
        const nodes: AudioNode[] = [src, g, pan];
        src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } } nodes.length = 0; };
        src.start(t, a + Math.random() * Math.max(0, b - a));
        this.soundsStarted++;
        this.locStats.starts++;
        c = {e, src, g, v: -1, released: -1};
        this.locCh.push(c);
      }
      const edge = clamp01((e.range - d) / Math.max(0.5, A.edge * e.range));
      const v = CUE_GAIN[e.cue] * e.gain * AMBIENT_LEVEL * edge;
      if (Math.abs(v - c.v) < A.eps) continue;
      c.v = v;
      c.g.gain.cancelScheduledValues(t);
      c.g.gain.setTargetAtTime(v, t, A.tau);
    }
    // the clock chime: in-range time counts down (paused audio: nothing counts, nothing strikes)
    const C = A.chime, s = this.locChime;
    const dt = s.t < 0 ? 0 : Math.min(C.maxStepS, Math.max(0, t - s.t));
    s.t = t;
    if (!this.live || !Number.isFinite(s.left)) return;
    let clock: LocationEmitter | null = null, bd: number = C.range;
    for (const e of this.locations) if (e.cue === 'clockTick') { const d = this.locHeard(e, feet); if (d !== null && d < bd) { bd = d; clock = e; } }
    if (!clock) return;
    s.left -= dt;
    if (s.left > 0) return;
    s.left = C.minS + (C.maxS - C.minS) * hash01(s.seed, ++s.n);
    const v = this.voice({at: clock, send: C.send, pri: 1, ref: C.ref, rolloff: C.rolloff, maxDist: C.maxDist, occlude: false});
    if (this.play(v, 'clockChime', {jitter: 0.01, gainJitter: 0.5})) this.locStats.chimes++;
  }

  /** A location channel fades out (`fadeS`) and its loop stops (kept in the list until the fade ends: the fading bound). Plays nothing. */
  private releaseLocation(c: LocationChannel, fadeS: number): void {
    if (c.released >= 0) return;
    const ctx = this.ctx;
    c.released = ctx?.currentTime ?? 0;
    this.locStats.stops++;
    if (!ctx) return;
    const t = ctx.currentTime, f = Math.max(0.01, fadeS);
    c.g.gain.cancelScheduledValues(t);
    c.g.gain.setTargetAtTime(0, t, f / 3);
    try { c.src.stop(t + f + 0.05); } catch { /* already stopped */ }
  }

  /** The fading bound: beyond LOCATION_AUDIO.voices fading channels, the oldest are cut now (a quick ramp, then stop). Plays nothing. */
  private trimLocationFades(): void {
    const ctx = this.ctx;
    const fading = this.locCh.filter(q => q.released >= 0);
    while (fading.length > LOCATION_AUDIO.voices) {
      const old = fading.shift()!, t = ctx?.currentTime ?? 0;
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setTargetAtTime(0, t, 0.01);
      try { old.src.stop(t + 0.04); } catch { /* already stopped */ }
      this.locCh.splice(this.locCh.indexOf(old), 1);
      this.locStats.cuts++;
    }
  }

  /** QA / tests: the location emitters' live state (emitters, sounding / fading channels and their cues, the chime countdown, counters). */
  locationAudioState(): {emitters: number; sounding: LocationCue[]; fading: number; chimeIn: number; starts: number; stops: number; cuts: number; chimes: number} {
    const live = this.locCh.filter(c => c.released < 0);
    return {emitters: this.locations.length, sounding: live.map(c => c.e.cue), fading: this.locCh.length - live.length, chimeIn: this.locChime.left, ...this.locStats};
  }

  /** Cut a one-shot voice that may still be sounding (stall / pour): its sources fade over `fadeS` and stop. */
  private cutVoice(v: Voice | null, fadeS: number): void {
    const ctx = this.ctx;
    if (!v || !ctx || v.end <= ctx.currentTime) return;
    const t = ctx.currentTime, f = Math.max(0.01, fadeS);
    v.inp.gain.cancelScheduledValues(t);
    v.inp.gain.setTargetAtTime(0, t, f / 3);
    for (const src of v.srcs) { try { src.stop(t + f + 0.02); } catch { /* already stopped */ } }
    v.end = Math.min(v.end, t + f + 0.03);
  }

  /** Task reactor-build-20261101: fade out every machine loop (new world). */
  stopMachines(fadeS = 0.1): void {
    for (const l of this.machineLoops.slice()) this.endLoop(l, fadeS);
    this.machineLoops = [];
  }

  /** Fade out every burning-flare loop (new station / retry / death). */
  stopFlares(fadeS = 0.1): void {
    for (const l of this.flareLoops.slice()) this.endLoop(l, fadeS);
    this.flareLoops = [];
  }

  /**
   * Task studio-beta-campaign-polish-20261103-063841-01 (lane TRAIN, item 17): a NON-positional looping layer of the moving player train
   * (the listener rides in the car) — an existing bed loop through a lowpass into the MASTER (the volume setting applies; pause / menus
   * silence it with the master). Starts silent; setLevel / setRate / setLowpass follow the car's speed; stop() fades it out and releases
   * its nodes. Null when audio is not running or the clip is missing. The caller owns the lifecycle (world/trainRideAudio.ts stops it on
   * the stop at a platform, a reset, a failed journey and dispose): nothing here is tied to a station world.
   */
  rideLoop(cue: 'bedRumble' | 'bedWind', o: {send?: number} = {}): RideLoopHandle | null {
    const ctx = this.live;
    if (!ctx) return null;
    const clip = this.bank.pick(cue);
    if (!clip) return null;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.loop = true;
    const a = clip.loopStart ?? clip.offset, b = clip.loopEnd ?? clip.offset + clip.dur;
    src.loopStart = a;
    src.loopEnd = b;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.5;
    const fade = ctx.createGain();
    fade.gain.value = 0;
    src.connect(filter).connect(fade).connect(this.master);
    const nodes: AudioNode[] = [src, filter, fade];
    const send = o.send ?? 0;
    if (send > 0.001 && this.reverbIn) {
      const sn = ctx.createGain();
      sn.gain.value = send;
      fade.connect(sn).connect(this.reverbIn);
      nodes.push(sn);
    }
    let stopped = false;
    src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } } nodes.length = 0; };
    src.start(now, a + Math.random() * Math.max(0, b - a));
    this.soundsStarted++;
    const self = this, base = CUE_GAIN[cue];
    const ease = (prm: AudioParam, v: number, tauS: number) => {
      const c = self.ctx;
      if (stopped || !c || !Number.isFinite(v)) return;
      prm.cancelScheduledValues(c.currentTime);
      prm.setTargetAtTime(v, c.currentTime, Math.max(0.01, tauS));
    };
    return {
      setLevel(k: number, tauS = 0.3) { ease(fade.gain, base * Math.max(0, k), tauS); },
      setRate(r: number, tauS = 0.3) { ease(src.playbackRate, Math.max(0.25, Math.min(4, r)), tauS); },
      setLowpass(hz: number, tauS = 0.3) { ease(filter.frequency, Math.max(40, Math.min(20000, hz)), tauS); },
      stop(fadeS = 0.4) {
        if (stopped) return;
        stopped = true;
        const c = self.ctx;
        if (!c) return;
        const t = c.currentTime, f = Math.max(0.01, fadeS);
        fade.gain.cancelScheduledValues(t);
        fade.gain.setTargetAtTime(0, t, f / 3);
        try { src.stop(t + f + 0.05); } catch { /* already stopped */ }
      },
      get playing() { return !stopped; },
    };
  }

  /** Air absorption + occlusion lowpass and level for one loop (same law as voice()); silent but alive beyond FLARE_LOOP.far. */
  private loopFilter(l: FlareLoop, immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || l.stopped) return;
    const t = ctx.currentTime, d = this.dist(l.pos);
    const occ = this.occlusion && d > 1.5 ? clamp01(this.occlusion(l.pos.x, l.pos.z, l.pos.y)) : 0;
    const cutoff = Math.min(20000, 17000 / (1 + d * 0.04)) * (occ > 0 ? 0.08 + 0.92 * (1 - occ) : 1);
    const lvl = d > (l.far ?? FLARE_LOOP.far) ? 0 : 1 - 0.45 * occ;
    l.next = t + FLARE_LOOP.update;
    if (immediate) { l.filter.frequency.value = cutoff; l.level.gain.value = lvl; return; }
    l.filter.frequency.setTargetAtTime(cutoff, t, 0.08);
    l.level.gain.setTargetAtTime(lvl, t, 0.12);
  }

  /** Refresh every live loop's filter/level as the listener moves (setListener cadence). */
  private updateLoops(force: boolean): void {
    if (!this.flareLoops.length && !this.machineLoops.length) return;
    const t = this.ctx?.currentTime ?? 0;
    for (const l of this.flareLoops) if (!l.stopped && (force || t >= l.next)) this.loopFilter(l, false);
    for (const l of this.machineLoops) if (!l.stopped && (force || t >= l.next)) this.loopFilter(l, false); // task reactor-build-20261101
  }

  private endLoop(l: FlareLoop, fadeS: number): void {
    const i = this.flareLoops.indexOf(l);
    if (i >= 0) this.flareLoops.splice(i, 1);
    const j = this.machineLoops.indexOf(l); // task reactor-build-20261101
    if (j >= 0) this.machineLoops.splice(j, 1);
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

  // ---------------------------------------------------------------------------------------
  // Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO): the Strainer's squish set (Sound Lab clips strainer-*;
  // silent no-ops when audio is paused / not started or a clip is missing). See STRAINER_AUDIO.

  /**
   * Per-frame Strainer gait: advances its Walk / Run clip phase like ai/strainerActor.ts does (`clip` = the actor's current clip;
   * anything else = not walking, `scale` = the actor's root scale) and plays one wet footfall on each foot plant (phase 0.5 / 1.0)
   * while the real ground speed `speed` (m/s) is >= STRAINER_AUDIO.gait.minSpeed. `y` = feet height.
   */
  strainerGait(id: object, x: number, z: number, speed: number, dt: number, clip: string | null, y = 0, scale = 1): void {
    const G = STRAINER_AUDIO.gait, P = STRAINER_AUDIO.step;
    let s = this.sGait.get(id);
    if (!s) { s = {clip: null, ph: 0, last: -Infinity}; this.sGait.set(id, s); }
    if (clip !== 'Walk' && clip !== 'Run') { s.clip = null; return; }
    if (s.clip !== clip) { s.clip = clip; s.ph = 0; } // the actor (re)starts a newly played clip at time 0: the left foot planted
    const spec = G[clip];
    const ts = Math.max(G.timeScaleMin, Math.min(G.timeScaleMax, speed / (spec.groundSpeed * (scale || 1)))) || 1;
    const prev = s.ph;
    s.ph += Math.max(0, dt) * ts / spec.cycleS;
    const plant = (prev < 0.5 && s.ph >= 0.5) || s.ph >= 1;
    if (s.ph >= 1) s.ph -= Math.floor(s.ph);
    const ctx = this.live;
    if (!plant || !ctx || speed < G.minSpeed || ctx.currentTime - s.last < G.minGapS) return;
    const L = this.listener;
    if (Math.hypot(x - L.x, z - L.z) > P.maxDist || !this.stepHeard(x, y, z)) return; // no footfalls through the slab from another storey
    if (this.sLive('step') >= P.max) { this.sStats.capped++; return; }
    if (!this.take('step')) return;
    s.last = ctx.currentTime;
    const v = this.strainerVoice('step', {at: {x, y: y + 0.05, z}, ref: P.ref, rolloff: P.rolloff, send: P.send, pri: 0, maxDist: P.maxDist,
      gain: Math.min(P.gainMax, P.gainBase + P.gainPerMps * speed)});
    if (this.play(v, 'strainerStep', {jitter: P.jitter, gainJitter: P.gainJitter})) this.sStats.steps++;
  }

  /**
   * The Strainer's wet arm-swing whoosh for swing `seq` (brain.attackSeq). Call EVERY frame while it is in its attack state, with
   * the brain's attackImpact (s after the swing started) and the frame dt: the first call of a new swing picks a variant (one whose
   * peak fits before the impact; never the same as the last swing when there is a choice), later calls count the swing time, and
   * the whoosh starts once the impact is its peak away — its loudest 20 ms lands on the claw's impact frame. Once per swing.
   * Returns true on the call that started it.
   */
  strainerSwing(id: object, seq: number, impactS: number, dt: number, x: number, y: number, z: number): boolean {
    const W = STRAINER_AUDIO.swing;
    let s = this.sSwing.get(id);
    if (!s || s.seq !== seq) {
      s = {seq, t: 0, clip: null, peak: 0, done: false};
      this.sSwing.set(id, s);
      const all = this.bank.get('strainerSwing'), peakOf = (c: Clip) => STRAINER_SWING_PEAK_S[c.src] ?? 0;
      if (!all.length) this.bank.pick('strainerSwing'); // counted silent gap (no stand-in sound)
      else {
        const fit = all.filter(c => peakOf(c) <= impactS);
        const pool = fit.length ? fit : [all.reduce((p, c) => (peakOf(c) < peakOf(p) ? c : p))];
        const fresh = pool.length > 1 ? pool.filter(c => c.src !== this.sSwingLast) : pool;
        s.clip = fresh[Math.floor(Math.random() * fresh.length)] ?? pool[0];
        s.peak = peakOf(s.clip);
        this.sSwingLast = s.clip.src;
      }
    } else s.t += Math.max(0, dt);
    if (s.done) return false;
    const left = impactS - s.t; // s until the claws land
    if (left > s.peak + W.fitS) return false;
    s.done = true;
    if (!s.clip) return false;
    const v = this.strainerVoice('swing', {at: {x, y, z}, hrtf: true, ref: W.ref, rolloff: W.rolloff, send: W.send, pri: 1, maxDist: W.maxDist});
    if (!v || !this.ctx) return false;
    this.playClip(v, 'strainerSwing', s.clip, {delay: Math.max(0, left - s.peak), jitter: W.jitter, gainJitter: W.gainJitter});
    this.sStats.swings++;
    return true;
  }

  /**
   * The fleshy claw-contact squelch of a CONNECTING Strainer swipe (game.ts hurtPlayer, attacker 'strainer' — it never runs for a
   * miss): placed at the player's chest, STRAINER_AUDIO.contact.offsetM toward the attacker at (fromX, fromZ). Returns true when it played.
   */
  strainerContact(fromX: number, fromZ: number): boolean {
    const C = STRAINER_AUDIO.contact, L = this.listener;
    const dx = fromX - L.x, dz = fromZ - L.z, d = Math.hypot(dx, dz), k = d > 1e-6 ? Math.min(C.offsetM, d) / d : 0;
    const v = this.strainerVoice('contact', {at: {x: L.x + dx * k, y: L.y - C.chestDropM, z: L.z + dz * k}, ref: C.ref, rolloff: C.rolloff, send: C.send, pri: 2, maxDist: C.maxDist, occlude: false});
    const ok = !!this.play(v, 'strainerContact', {jitter: C.jitter, gainJitter: C.gainJitter});
    if (ok) this.sStats.contacts++;
    return ok;
  }

  /** A short wet squish at a shot (not killed) Strainer's body: at most one per STRAINER_AUDIO.squish.minGapS per Strainer. Returns true when it played. */
  strainerSquish(id: object, x: number, y: number, z: number): boolean {
    const ctx = this.live, Q = STRAINER_AUDIO.squish;
    if (!ctx) return false;
    const last = this.sSquishAt.get(id);
    if (last !== undefined && ctx.currentTime - last < Q.minGapS) { this.sStats.limited++; return false; }
    const v = this.strainerVoice('squish', {at: {x, y, z}, hrtf: true, ref: Q.ref, rolloff: Q.rolloff, send: Q.send, pri: 1, maxDist: Q.maxDist});
    if (!this.play(v, 'strainerSquish', {jitter: Q.jitter, gainJitter: Q.gainJitter})) return false;
    this.sSquishAt.set(id, ctx.currentTime);
    this.sStats.squishes++;
    return true;
  }

  /** Sounding voices of one Strainer cue (drops ended ones). */
  private sLive(kind: StrainerVoiceKind): number {
    const now = this.ctx?.currentTime ?? 0;
    const list = this.sVoices[kind].filter(v => v.end > now);
    this.sVoices[kind] = list;
    return list.length;
  }

  /** A Strainer cue voice within its own cap (STRAINER_AUDIO[kind].max); null = capped / culled / paused. Plays nothing itself. */
  private strainerVoice(kind: StrainerVoiceKind, o: VoiceOpts & {at: Pos}): Voice | null {
    if (!this.live) return null;
    if (this.sLive(kind) >= STRAINER_AUDIO[kind].max) { this.sStats.capped++; return null; }
    const v = this.voice(o);
    if (v) this.sVoices[kind].push(v);
    return v;
  }
}
