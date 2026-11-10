// Room reverb kernels for the ConvolverNodes (PROCESSING ONLY).
//
// An impulse response is a filter kernel: it is only ever assigned to ConvolverNode.buffer and is
// never played by a source, so on its own it makes no sound — the convolvers only colour Sound Lab
// clips sent to them. (Moved unchanged from the retired synth.ts, whose procedural sample banks were
// removed in iteration 05: every audible cue is now a Sound Lab clip.)

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): mulberry()'s step on a state held in `s[0]` (the same
 * stream) — ONE function for every sliced kernel (SlicedIR), where mulberry() makes a new closure per kernel.
 */
function mulberryStep(s: Uint32Array): number {
  s[0] = (s[0] + 0x6d2b79f5) >>> 0;
  let t = s[0];
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Stereo room impulse response: early reflections + darkening exponential tail (+ flutter for tunnels). */
export function makeIR(ctx: BaseAudioContext, r: {len: number; rt: number; pre: number; er: number; flutter: number; damp: number}): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.max(16, Math.floor(r.len * sr));
  const buf = ctx.createBuffer(2, n, sr);
  const k = 6.91 / r.rt; // 60 dB decay over rt
  const rand = mulberry(Math.floor(r.len * 1000 + r.rt * 77));
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0, a = 1;
    const onset = Math.max(1, Math.floor(r.er * sr));
    for (let i = 0; i < n; i++) {
      if ((i & 63) === 0) {
        const t = i / sr, fc = Math.max(500, 9000 * Math.exp(-t * r.damp * 2));
        a = 1 - Math.exp(-2 * Math.PI * Math.min(fc, sr * 0.45) / sr);
      }
      lp += a * ((rand() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-k * i / sr) * Math.min(1, i / onset) * 0.6;
    }
    // early reflections (different per ear -> width)
    const taps = 10;
    for (let j = 0; j < taps; j++) {
      const t = r.er * 0.15 + rand() * r.er * 1.6;
      const i = Math.floor(t * sr);
      if (i < n) d[i] += (rand() < 0.5 ? -1 : 1) * 0.7 * Math.exp(-k * t) * (1 - j / (taps * 1.3));
    }
    if (r.flutter > 0) {
      for (let t = r.flutter * (0.8 + rand() * 0.4); t < r.len * 0.6; t += r.flutter * (0.94 + rand() * 0.12)) {
        const i = Math.floor(t * sr);
        if (i < n) d[i] += (rand() < 0.5 ? -1 : 1) * 0.35 * Math.exp(-k * 1.25 * t);
      }
    }
  }
  return buf;
}

/**
 * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): noise samples one slice of a sliced kernel may write
 * (`startIR`). One whole kernel is 48 000 (small) to 288 000 (tunnel) samples at 48 kHz: built in one go it was one main-thread
 * task of milliseconds to tens of milliseconds, which landed in play frames when the first gesture entered play.
 */
export const IR_SLICE_SAMPLES = 16384;

/** A room kernel being generated in slices (`startIR`). */
export interface IrJob {
  /** The kernel: complete — bit for bit what `makeIR` returns — only once `done`. */
  readonly buffer: AudioBuffer;
  readonly done: boolean;
  /** Noise samples written so far, over both channels (of `total`). */
  readonly written: number;
  readonly total: number;
  /** Writes at most `maxSamples` more noise samples (plus the few taps that close a channel); true once the kernel is complete. */
  step(maxSamples?: number): boolean;
}

/**
 * `makeIR` as a resumable job: the same loops in the same order on the same random stream (per channel: the noise tail, then its
 * early reflections, then its flutter taps), stopped and resumed inside the noise loop. The loops are prototype methods and the
 * random stream one shared step function on the job's state, not closures made per kernel: a new closure per kernel made the
 * optimised loop of the previous kernel bail out on the next kernel's first slice (Node: 4.6-6.1 ms for that slice, ~0.6 ms others).
 */
class SlicedIR implements IrJob {
  readonly buffer: AudioBuffer;
  readonly total: number;
  private readonly r: {len: number; rt: number; er: number; flutter: number; damp: number};
  private readonly sr: number;
  private readonly n: number;
  private readonly k: number;
  private readonly onset: number;
  /** mulberry()'s state (mulberryStep on it: the same stream). */
  private readonly seed = new Uint32Array(1);
  // where the job stands: the channel, the next noise sample of it, and the noise loop's filter state
  private c = 0;
  private at = 0;
  private lp = 0;
  private a = 1;

  constructor(ctx: BaseAudioContext, r: {len: number; rt: number; pre: number; er: number; flutter: number; damp: number}) {
    this.r = r;
    this.sr = ctx.sampleRate;
    this.n = Math.max(16, Math.floor(r.len * this.sr));
    this.buffer = ctx.createBuffer(2, this.n, this.sr);
    this.total = 2 * this.n;
    this.k = 6.91 / r.rt; // 60 dB decay over rt
    this.seed[0] = Math.floor(r.len * 1000 + r.rt * 77) >>> 0;
    this.onset = Math.max(1, Math.floor(r.er * this.sr));
  }

  get done(): boolean {
    return this.c >= 2;
  }
  get written(): number {
    return Math.min(this.c, 2) * this.n + this.at;
  }

  step(maxSamples = IR_SLICE_SAMPLES): boolean {
    let left = Math.max(1, Math.floor(maxSamples));
    while (this.c < 2 && left > 0) {
      const d = this.buffer.getChannelData(this.c);
      const end = Math.min(this.n, this.at + left);
      left -= end - this.at;
      this.noise(d, this.at, end);
      this.at = end;
      if (end < this.n) break;
      // the channel's noise is complete: its taps (a few dozen single samples), then the next channel from a fresh filter state
      this.taps(d);
      this.c++;
      this.at = 0;
      this.lp = 0;
      this.a = 1;
    }
    return this.c >= 2;
  }

  /** makeIR's noise loop over samples [from, to) of one channel (the filter state rides on the job between slices). */
  private noise(d: Float32Array, from: number, to: number): void {
    const r = this.r, sr = this.sr, k = this.k, onset = this.onset, seed = this.seed;
    let lp = this.lp, a = this.a;
    for (let i = from; i < to; i++) {
      if ((i & 63) === 0) {
        const t = i / sr, fc = Math.max(500, 9000 * Math.exp(-t * r.damp * 2));
        a = 1 - Math.exp(-2 * Math.PI * Math.min(fc, sr * 0.45) / sr);
      }
      lp += a * ((mulberryStep(seed) * 2 - 1) - lp);
      d[i] = lp * Math.exp(-k * i / sr) * Math.min(1, i / onset) * 0.6;
    }
    this.lp = lp;
    this.a = a;
  }

  /** makeIR's single-sample taps that close a channel. */
  private taps(d: Float32Array): void {
    const r = this.r, sr = this.sr, n = this.n, k = this.k, seed = this.seed;
    // early reflections (different per ear -> width)
    const taps = 10;
    for (let j = 0; j < taps; j++) {
      const t = r.er * 0.15 + mulberryStep(seed) * r.er * 1.6;
      const i = Math.floor(t * sr);
      if (i < n) d[i] += (mulberryStep(seed) < 0.5 ? -1 : 1) * 0.7 * Math.exp(-k * t) * (1 - j / (taps * 1.3));
    }
    if (r.flutter > 0) {
      for (let t = r.flutter * (0.8 + mulberryStep(seed) * 0.4); t < r.len * 0.6; t += r.flutter * (0.94 + mulberryStep(seed) * 0.12)) {
        const i = Math.floor(t * sr);
        if (i < n) d[i] += (mulberryStep(seed) < 0.5 ? -1 : 1) * 0.35 * Math.exp(-k * 1.25 * t);
      }
    }
  }
}

/**
 * Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PLAY): starts a room kernel as a job that is generated in slices
 * (`IrJob.step`). The finished buffer is `makeIR`'s bit for bit whatever the slice sizes were (`makeIR` stays the reference:
 * play-stutter-reverb-ir.test.ts compares the two on every room kind at 44.1 and 48 kHz).
 */
export function startIR(ctx: BaseAudioContext, r: {len: number; rt: number; pre: number; er: number; flutter: number; damp: number}): IrJob {
  return new SlicedIR(ctx, r);
}
