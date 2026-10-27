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
