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

/**
 * Runtime manifest: the iteration-05 bank plus the iteration-06 material-breaking cues
 * (tools/audio-pipeline/build-iteration06.mjs; provenance derivatives/audio-iteration06.json).
 */
export const CLIP_MANIFEST: Readonly<Record<string, readonly ClipRef[]>> = {...CLIP_MANIFEST_I05, ...CLIP_MANIFEST_I06, ...CLIP_MANIFEST_I07K, ...CLIP_MANIFEST_I07Q};

/** Every cue the game can play, in decode-priority order (most frequent / important first). */
export const CUES = [
  'rifleShot', 'shotgunShot', 'impactConcrete', 'impactTile', 'impactMetal', 'impactWood', 'impactFlesh',
  // Iteration 06 (Lane D): material breaking — glass hit/shatter, sheet metal, wood break, rubble, flesh tear.
  'impactGlass', 'impactSheetMetal', 'fleshTear', 'breakGlass', 'breakWood', 'debrisFall',
  // Iteration 07 (Lane K, tools/audio-pipeline/build-iteration07k.mjs): shot items / chunks / light props landing.
  'itemCan', 'itemLight', 'chunkFlesh', 'propTopple',
  'stepConcrete', 'stepTile', 'stepConcreteRun', 'stepTileRun', 'stepConcreteSneak', 'stepTileSneak',
  'zombieGroan', 'zombieGroanDeep', 'zombieAttack', 'zombieDeath', 'zombieStep', 'zombieStepHeavy',
  // Iteration 07 (Lane Q, tools/asset-pipeline/creature/build-audio.mjs): rat/dog creature vocals + paw scrabble.
  'creatureGrowl', 'creatureSnarl', 'creatureBite', 'creatureYelp', 'creatureDeath', 'creatureStep',
  'casingBrass', 'casingHull', 'bodyFall', 'hurt', 'hitTick', 'hitKill',
  'bedWind', 'bedRumble', 'bedHvac', 'bedFridge', 'bedBuzz',
  'shotgunPump', 'shellInsert', 'rifleMagOut', 'rifleMagIn', 'rifleCharge', 'rifleMagDrop', 'dryFire', 'equip',
  'jump', 'land', 'crouch', 'ladder', 'heartbeat', 'breath', 'death',
  'drip', 'creak', 'clank', 'trainDistant', 'flicker',
  'cabinetOpen', 'cabinetClose', 'crateOpen', 'crateClose', 'vendingPry', 'vendingClose', 'coolerOpen', 'coolerClose', 'drawerOpen', 'search',
  'pickup', 'heal', 'eatChips', 'eatChocolate', 'eatBeans', 'eatNoodles', 'eat', 'drinkCola', 'drinkWater', 'drinkJuice',
  'denied', 'click', 'win',
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
