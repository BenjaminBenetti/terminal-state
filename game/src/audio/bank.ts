// Sound Lab clip bank: the ONLY source of game SFX (root CLAUDE.md "Sound effects: Sound Lab only").
//
// Every clip is a bundled, relative static derivative of a raw Sound Lab generation (provenance:
// public/assets/derivatives/audio-iteration05.json). Bytes are fetched while the page loads (no
// AudioContext needed); decodeAudioData runs in the game's single AudioContext after the first user
// gesture. A cue with no decoded clip is SILENT (counted in stats().silentPlays) — never synthesised.

import {CLIP_MANIFEST as CLIP_MANIFEST_I05, type ClipRef} from './manifest.generated';
import {CLIP_MANIFEST_I06} from './manifest.iteration06.generated';
import {CLIP_MANIFEST_I07K} from './manifest.iteration07k.generated';
import {CLIP_MANIFEST_I07Q} from './manifest.iteration07q.generated';
import {CLIP_MANIFEST_I11} from './manifest.iteration11.generated';
import {CLIP_MANIFEST_I12} from './manifest.iteration12.generated';
import {CLIP_MANIFEST_COUGH} from './manifest.cough.generated'; // task gas-mask-roof-feedback-20261030: the player's gas cough
import {CLIP_MANIFEST_T1} from './manifest.track1.generated'; // Task track1-siren-blightbelly-20261031 (lane AUDIO): Siren / Blightbelly
import {CLIP_MANIFEST_STRAINER} from './manifest.strainer.generated'; // Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO): the Strainer's squish set
import {CLIP_MANIFEST_REACTOR} from './manifest.reactor.generated'; // task reactor-build-20261101 (primary): the Reactor's machine set
import {CLIP_MANIFEST_REACTOR_STARTUP} from './manifest.reactorStartup.generated'; // task reactor-playtest-round2-20261102 (lane STARTUP): the startup set
import {CLIP_MANIFEST_REACTOR_ENDING} from './manifest.reactorEnding.generated'; // task reactor-surface-ending-20261102 (lane AUDIO): the beam ignition + surface rain
import {CLIP_MANIFEST_FUEL} from './manifest.fuel.generated'; // task train-fuel-system-20261106 (lane PORT): engine stall, fuel pour, fuel cart rolling
import {CLIP_MANIFEST_SKYWAYS_CAR} from './manifest.skywaysCar.generated'; // task studio-skyways-level-20261106-054448-01: the prize car's engine loops, skid, door
import {CLIP_MANIFEST_SKYWAYS_DESTINATIONS} from './manifest.skywaysDestinations.generated';
import {CLIP_MANIFEST_MARKET_BAR} from './manifest.marketBar.generated'; // task studio-market-bar-20261108-225231-01 (lane AUDIO): the market set
import {CLIP_MANIFEST_GUN_VARIETY, GUN_VARIETY_CUES} from './manifest.gunVariety.generated'; // task studio-weapon-soundlab-audio-20261110-063407-01: the six new guns' own shots / reloads (audio/gunVoices.ts)
import {CLIP_MANIFEST_HEAD_HIT} from './manifest.headHit.generated'; // task studio-general-armor-20261107-231448-01: the head-hit skull crack // task skyways-destinations-20261106 (lane AUDIO): clock tick / chime, arcade, projector
import {CLIP_MANIFEST_SCREACHER, SCREACHER_CUES} from './manifest.screacher.generated'; // task studio-screacher-production-20261110-221858-01 (lane AUDIO): the Screacher's voice (echo scream, shriek, wheeze, death)

/**
 * Runtime manifest: the iteration-05 bank plus the iteration-06 material-breaking cues
 * (tools/audio-pipeline/build-iteration06.mjs; provenance derivatives/audio-iteration06.json), the iteration-07/11 cues and
 * the iteration-12 light-survival cues (tools/audio-pipeline/build-iteration12.mjs; provenance derivatives/audio-iteration12.json).
 * Task track1-siren-blightbelly-20261031 (lane AUDIO): + the Siren hum / scream and Blightbelly burst / gas hiss
 * (tools/audio-pipeline/build-track1.mjs; provenance derivatives/audio-track1.json). Task studio-alpha-strainer-reach-squish-
 * 20261101-201110-01 (lane AUDIO): + the Strainer's wet footfalls / arm swing / claw contact / hit squish (tools/audio-pipeline/
 * strainer-build.mjs; provenance derivatives/audio-strainer.json).
 */
export const CLIP_MANIFEST: Readonly<Record<string, readonly ClipRef[]>> = {...CLIP_MANIFEST_I05, ...CLIP_MANIFEST_I06, ...CLIP_MANIFEST_I07K, ...CLIP_MANIFEST_I07Q, ...CLIP_MANIFEST_I11, ...CLIP_MANIFEST_I12, ...CLIP_MANIFEST_COUGH, ...CLIP_MANIFEST_T1, ...CLIP_MANIFEST_STRAINER, ...CLIP_MANIFEST_REACTOR, ...CLIP_MANIFEST_REACTOR_STARTUP, ...CLIP_MANIFEST_REACTOR_ENDING, ...CLIP_MANIFEST_FUEL, ...CLIP_MANIFEST_SKYWAYS_CAR, ...CLIP_MANIFEST_SKYWAYS_DESTINATIONS, ...CLIP_MANIFEST_HEAD_HIT, ...CLIP_MANIFEST_MARKET_BAR, ...CLIP_MANIFEST_GUN_VARIETY, ...CLIP_MANIFEST_SCREACHER};

/** Every cue the game can play, in decode-priority order (most frequent / important first). */
export const CUES = [
  'rifleShot', 'shotgunShot',
  // Iteration 11 (tools/audio-pipeline/build-iteration11-pistol.mjs): the dedicated Sound Lab pistol shot.
  'pistolShot',
  'impactConcrete', 'impactTile', 'impactMetal', 'impactWood', 'impactFlesh',
  // Iteration 06 (Lane D): material breaking — glass hit/shatter, sheet metal, wood break, rubble, flesh tear.
  'impactGlass', 'impactSheetMetal', 'fleshTear', 'breakGlass', 'breakWood', 'debrisFall',
  // Iteration 07 (Lane K, tools/audio-pipeline/build-iteration07k.mjs): shot items / chunks / light props landing.
  'itemCan', 'itemLight', 'chunkFlesh', 'propTopple',
  'stepConcrete', 'stepTile', 'stepConcreteRun', 'stepTileRun', 'stepConcreteSneak', 'stepTileSneak',
  'zombieGroan', 'zombieGroanDeep', 'zombieAttack', 'zombieDeath', 'zombieStep', 'zombieStepHeavy',
  // Iteration 07 (Lane Q, tools/asset-pipeline/creature/build-audio.mjs): rat/dog creature vocals + paw scrabble.
  'creatureGrowl', 'creatureSnarl', 'creatureBite', 'creatureYelp', 'creatureDeath', 'creatureStep',
  // Task track1-siren-blightbelly-20261031 (lane AUDIO, tools/audio-pipeline/build-track1.mjs): Siren hum phrases + wake scream,
  // Blightbelly death burst + gas-venting hiss.
  'sirenHum', 'sirenScream', 'blightBurst', 'blightHiss',
  // Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO, tools/audio-pipeline/strainer-build.mjs): the Strainer's
  // wet squelching footfalls, wet arm-swing whoosh, fleshy claw-contact squelch and the short wet squish when it is shot.
  'strainerStep', 'strainerSwing', 'strainerContact', 'strainerSquish',
  // Task studio-screacher-production-20261110-221858-01 (lane AUDIO, tools/audio-pipeline/screacher-build.mjs): the headless Screacher's
  // voice out of its open throat — the echolocation scream (the tell of each echo pulse), the frenzy shriek (also its hurt, quieter),
  // the idle wheeze, the death gurgle.
  ...SCREACHER_CUES,
  // Task reactor-build-20261101 (primary, tools/audio-pipeline/reactor-build.mjs): the Reactor's machines — auxiliary generator start +
  // running loop, extraction-fan loop, switchgear breaker / fuse, coolant valve / pump, the core's startup swell + running hum loop.
  'reactorGeneratorStart', 'reactorGeneratorLoop', 'reactorFanLoop', 'reactorBreaker', 'reactorFuse', 'reactorValve', 'reactorPump', 'reactorStartup', 'reactorHum',
  // Task reactor-playtest-round2-20261102 (lane STARTUP, tools/audio-pipeline/reactor-startup-build.mjs): the power-up surge, the ONLINE
  // energy impact, the control-rod drive loop + stop clunk, the machine bed loop, the power-stage contactor thump, the beacon motor loop.
  'reactorSurge', 'reactorOnline', 'reactorRodLoop', 'reactorRodStop', 'reactorBed', 'reactorStage', 'reactorBeacon',
  // Task reactor-surface-ending-20261102 (lane AUDIO, tools/audio-pipeline/reactor-ending-build.mjs): the blue-beam ignition one-shot
  // and the surface rain bed loop.
  'reactorBeam', 'bedRain',
  // Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT, tools/audio-pipeline/fuel-build.mjs): the engine stall (a departure
  // refused for fuel), the jerrycan pour at the fuel cap, the fuel cart's rolling loop.
  'engineStall', 'fuelPour', 'cartRoll',
  // Task studio-skyways-level-20261106-054448-01 (tools/audio-pipeline/skyways-car-build.mjs): the prize car's engine idle / drive loops,
  // its tyre skid and its door; (round 2, task skyways-vehicle-20261107, lane AUDIO) its engine start, reverse-gear whine loop, brake stop.
  'carIdle', 'carDrive', 'carStart', 'carReverse', 'carBrake', 'carSkid', 'carDoor',
  // Task studio-skyways-destinations-20261106-170011-01 (lane AUDIO, tools/audio-pipeline/skyways-destinations-build.mjs): the location
  // sounds — the Clock Court's tick loop and bell chime, the Starfall Arcade's attract loop, the Aurora Picture House's projector loop.
  'clockTick', 'clockChime', 'arcadeAttract', 'projectorRun',
  // Task studio-market-bar-20261108-225231-01 (lane AUDIO, tools/audio-pipeline/market-audio-build.mjs): the market — the subtle cash register on a
  // successful buy / sell, the crowd murmur loops (the market hall, the bar), the fleeing survivors' panic screams, the fighters' angry grunts,
  // the player's retch (market/audio/marketSounds.ts).
  'marketCash', 'marketChatter', 'marketBarChatter', 'marketScream', 'marketGrunt', 'marketRetch',
  'casingBrass', 'casingHull', 'bodyFall', 'hurt', 'hitTick', 'hitKill',
  // task studio-general-armor-20261107-231448-01 (tools/audio-pipeline/headhit-build.mjs): the skull crack layered on the hit confirm of a confirmed HEAD hit.
  'headHit',
  'bedWind', 'bedRumble', 'bedHvac', 'bedFridge', 'bedBuzz',
  'shotgunPump', 'shellInsert', 'rifleMagOut', 'rifleMagIn', 'rifleCharge', 'rifleMagDrop', 'dryFire', 'equip',
  // Task studio-weapon-soundlab-audio-20261110-063407-01 (tools/audio-pipeline/gun-variety-build.mjs): the weapon-variety guns' own shots
  // and reload mechanics, named by weapon id (audio/gunVoices.ts).
  ...GUN_VARIETY_CUES,
  'jump', 'land', 'crouch', 'ladder', 'heartbeat', 'breath', 'death',
  'drip', 'creak', 'clank', 'trainDistant', 'flicker',
  'cabinetOpen', 'cabinetClose', 'crateOpen', 'crateClose', 'vendingPry', 'vendingClose', 'coolerOpen', 'coolerClose', 'drawerOpen', 'search',
  'pickup', 'heal', 'eatChips', 'eatChocolate', 'eatBeans', 'eatNoodles', 'eat', 'drinkCola', 'drinkWater', 'drinkJuice',
  'denied', 'click', 'win',
  // Iteration 12 (AUDIO lane, tools/audio-pipeline/build-iteration12.mjs): flashlight battery + thrown flare.
  'batteryInsert', 'flareIgnite', 'flareBurn', 'flareOut', 'flashlightFlicker',
  // Task gas-mask-roof-feedback-20261030 (tools/audio-pipeline/build-cough.mjs): the player coughing while toxic gas hurts them.
  'cough',
] as const;
export type CueId = (typeof CUES)[number];

/** A decoded clip. `offset` skips decoder priming silence (MP3 encoder/decoder delay). */
export interface Clip {
  buffer: AudioBuffer;
  /** Playback start inside the buffer (s). */
  offset: number;
  /** Audible length from offset (s). */
  dur: number;
  /** Seamless loop region (buffer time, s) for ambience beds. */
  loopStart?: number;
  loopEnd?: number;
  src: string;
}

export type Fetcher = (url: string) => Promise<ArrayBuffer>;
type Manifest = Readonly<Record<string, readonly ClipRef[]>>;

/** First sample above `thresholdDb` relative to the buffer peak, minus a 0.5 ms guard (seconds). */
export function leadOffset(buf: AudioBuffer, thresholdDb = -50): number {
  let peak = 0;
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    chans.push(d);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  if (peak <= 0) return 0;
  const thr = peak * Math.pow(10, thresholdDb / 20);
  let first = buf.length;
  for (const d of chans) {
    const lim = Math.min(first, d.length);
    for (let i = 0; i < lim; i++) if (Math.abs(d[i]) > thr) { first = i; break; }
  }
  if (first >= buf.length) return 0;
  return Math.max(0, first / buf.sampleRate - 0.0005);
}

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Callback + promise forms: older Safari only supports the callbacks.
    const p = ctx.decodeAudioData(data, resolve, e => reject(e ?? new Error('decode failed')));
    if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

export class ClipBank {
  private clips = new Map<CueId, Clip[]>();
  private last = new Map<CueId, number>();
  private bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private loading: Promise<void> | null = null;
  state: 'idle' | 'loading' | 'ready' = 'idle';
  readonly failed: {url: string; reason: string}[] = [];
  silentPlays = 0;
  readonly silentCues = new Set<string>();
  /** Called once per cue as soon as its clips are decoded (beds attach their loops here). */
  onCueReady: ((cue: CueId) => void) | null = null;

  constructor(private readonly manifest: Manifest = CLIP_MANIFEST, private readonly fetcher?: Fetcher, private readonly fixed = false) {}

  /** A bank of already-decoded clips (tests / tools); load() is then a no-op. */
  static fromClips(clips: Partial<Record<CueId, Clip[]>>): ClipBank {
    const b = new ClipBank({}, undefined, true);
    for (const [k, v] of Object.entries(clips)) if (v?.length) b.clips.set(k as CueId, v);
    b.state = 'ready';
    return b;
  }

  private resolve(url: string): string {
    if (typeof document !== 'undefined' && document.baseURI) return new URL(url, document.baseURI).href;
    return url;
  }

  private fetchBytes(url: string): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(url);
    if (!p) {
      const f: Fetcher = this.fetcher ?? (async u => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      });
      p = f(this.resolve(url)).catch(e => { this.failed.push({url, reason: e instanceof Error ? e.message : String(e)}); return null; });
      this.bytes.set(url, p);
    }
    return p;
  }

  /**
   * Start downloading every clip in the background (no AudioContext needed; safe during the loading
   * screen). Two requests at a time so the model/texture loads keep most connections; load() fetches
   * anything still missing immediately.
   */
  prefetch(): void {
    if (this.fixed || this.prefetching) return;
    this.prefetching = true;
    const urls: string[] = [];
    for (const cue of CUES) for (const ref of this.manifest[cue] ?? []) urls.push(ref.url);
    let i = 0;
    const worker = async () => { while (i < urls.length) await this.fetchBytes(urls[i++]); };
    void worker();
    void worker();
  }
  private prefetching = false;

  /** Decode every clip into ctx (once per page). Cues become playable one by one, in CUES order. */
  load(ctx: BaseAudioContext): Promise<void> {
    if (this.fixed) return Promise.resolve();
    if (this.loading) return this.loading;
    this.state = 'loading';
    const jobs: {cue: CueId; ref: ClipRef}[] = [];
    for (const cue of CUES) for (const ref of this.manifest[cue] ?? []) jobs.push({cue, ref});
    const pending = new Map<CueId, number>();
    for (const j of jobs) pending.set(j.cue, (pending.get(j.cue) ?? 0) + 1);
    const settle = (cue: CueId) => {
      const n = (pending.get(cue) ?? 1) - 1;
      pending.set(cue, n);
      if (n === 0 && this.clips.get(cue)?.length) { try { this.onCueReady?.(cue); } catch { /* listener errors stay local */ } }
    };
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const {cue, ref} = jobs[next++];
        try {
          const data = await this.fetchBytes(ref.url);
          if (data) {
            const buffer = await decode(ctx, data);
            const offset = leadOffset(buffer);
            const clip: Clip = {buffer, offset, dur: Math.max(0.01, Math.min(ref.dur, buffer.duration - offset)), src: ref.src};
            if (ref.loop) {
              clip.loopStart = offset + ref.loop.start;
              clip.loopEnd = Math.min(buffer.duration, clip.loopStart + ref.loop.length);
            }
            let list = this.clips.get(cue);
            if (!list) this.clips.set(cue, (list = []));
            list.push(clip);
          }
        } catch (e) {
          this.failed.push({url: ref.url, reason: e instanceof Error ? e.message : String(e)});
        }
        settle(cue);
      }
    };
    this.loading = Promise.all([worker(), worker(), worker()]).then(() => { this.state = 'ready'; });
    return this.loading;
  }

  has(cue: CueId): boolean {
    return !!this.clips.get(cue)?.length;
  }

  get(cue: CueId): readonly Clip[] {
    return this.clips.get(cue) ?? [];
  }

  /** Random variant, never the same one twice in a row (when there are 2+). Null = silent gap. */
  pick(cue: CueId): Clip | null {
    const list = this.clips.get(cue);
    if (!list?.length) {
      this.silentPlays++;
      this.silentCues.add(cue);
      return null;
    }
    if (list.length === 1) return list[0];
    const prev = this.last.get(cue) ?? -1;
    let i = Math.floor(Math.random() * (list.length - 1));
    if (i >= prev && prev >= 0) i++;
    this.last.set(cue, i);
    return list[i];
  }

  stats(): {state: string; cues: number; clips: number; manifestClips: number; gaps: string[]; failed: number; silentPlays: number; silentCues: string[]} {
    let clips = 0, manifestClips = 0;
    for (const v of this.clips.values()) clips += v.length;
    for (const cue of CUES) manifestClips += this.manifest[cue]?.length ?? 0;
    return {
      state: this.state, cues: this.clips.size, clips, manifestClips: this.fixed ? clips : manifestClips,
      gaps: CUES.filter(c => this.fixed ? !this.clips.has(c) : !(this.manifest[c]?.length)),
      failed: this.failed.length, silentPlays: this.silentPlays, silentCues: [...this.silentCues],
    };
  }
}
