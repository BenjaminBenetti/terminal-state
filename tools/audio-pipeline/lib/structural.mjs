// Task track1-siren-blightbelly-20261031 (lane AUDIO): STRUCTURAL analysis of Sound Lab raws / derivatives (no listening).
// Pure JS on decoded samples (Node stdlib only): radix-2 FFT, spectral centroid / flatness / band shares, YIN pitch track,
// envelope shape (attack, decay, quiet fraction, level spread). Used by tools/audio-pipeline/build-track1.mjs and the task's
// QC script to detect the known broadband-noise failure mode (flat envelope, flat spectrum, no pitch) and to check that a take
// has the structure its cue needs. These numbers describe signal structure only — they are not an audition.

export const dbToLin = db => Math.pow(10, db / 20);
export const linToDb = v => 20 * Math.log10(Math.max(1e-9, v));
const r = (v, d = 3) => (Number.isFinite(v) ? +v.toFixed(d) : null);

/** In-place iterative radix-2 FFT (re, im: Float64Array of power-of-two length). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const hannCache = new Map();
function hann(N) {
  let w = hannCache.get(N);
  if (!w) { w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); hannCache.set(N, w); }
  return w;
}

/** Power spectra of Hann frames: {frames: Float64Array[] (N/2+1 bins), hop, N, times (s), rms per frame}. */
export function stft(x, sr, N = 2048, hop = 512) {
  const w = hann(N), frames = [], times = [], rmsF = [];
  for (let s = 0; s + N <= x.length; s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let e = 0;
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * w[i]; e += x[s + i] * x[s + i]; }
    fft(re, im);
    const p = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    frames.push(p); times.push((s + N / 2) / sr); rmsF.push(Math.sqrt(e / N));
  }
  return {frames, hop, N, times, rms: rmsF};
}

/** RMS envelope (dB) over `hopS` windows. */
export function envelopeDb(x, sr, hopS = 0.005) {
  const hop = Math.max(1, Math.round(sr * hopS)), n = Math.floor(x.length / hop), out = new Float64Array(n);
  for (let h = 0; h < n; h++) { let s = 0; for (let i = h * hop; i < (h + 1) * hop; i++) s += x[i] * x[i]; out[h] = linToDb(Math.sqrt(s / hop)); }
  return out;
}

/**
 * YIN f0 per frame (de Cheveigné & Kawahara 2002: difference function, cumulative-mean normalisation, absolute threshold,
 * parabolic interpolation). Returns {f0 (Hz or 0 = unvoiced), ap (aperiodicity 0..1)} per frame of `N` samples every `hop`.
 */
export function yin(x, sr, {N = 2048, hop = 512, fmin = 70, fmax = 1600, threshold = 0.15} = {}) {
  const tauMin = Math.max(2, Math.floor(sr / fmax)), tauMax = Math.min(Math.floor(N / 2), Math.ceil(sr / fmin));
  const out = [], d = new Float64Array(tauMax + 1);
  for (let s = 0; s + N <= x.length; s += hop) {
    const W = N - tauMax;
    for (let tau = 1; tau <= tauMax; tau++) {
      let acc = 0;
      for (let i = 0; i < W; i++) { const v = x[s + i] - x[s + i + tau]; acc += v * v; }
      d[tau] = acc;
    }
    // cumulative mean normalised difference
    let run = 0, best = -1, bestV = Infinity;
    const cm = new Float64Array(tauMax + 1);
    cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = run > 0 ? d[tau] * tau / run : 1; }
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cm[tau] < threshold) { while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; bestV = cm[tau]; break; }
      if (cm[tau] < bestV) { bestV = cm[tau]; best = tau; }
    }
    let f0 = 0;
    if (best > 0 && bestV < threshold * 2.4) {
      const a = cm[best - 1] ?? cm[best], b = cm[best], c = cm[best + 1] ?? cm[best];
      const den = a - 2 * b + c, off = Math.abs(den) > 1e-12 ? 0.5 * (a - c) / den : 0;
      f0 = sr / (best + Math.max(-1, Math.min(1, off)));
    }
    out.push({t: (s + N / 2) / sr, f0, ap: Math.min(1, bestV)});
  }
  return out;
}

const semis = (f, ref) => 12 * Math.log2(f / ref);

/**
 * Pitch-contour summary over voiced, active frames: voiced fraction, median f0, range (semitones, 5th–95th percentile),
 * note segments (runs of >= minNoteS within ±0.8 st, after a 3-frame median), distinct note steps (adjacent segments
 * >= 1 st apart) and the total pitch movement (st). A melody-like contour = several voiced notes with steps between them.
 */
export function pitchContour(track, activeMask, {minNoteS = 0.12, hopS = 512 / 44100, maxAp = 0.3} = {}) {
  const v = track.map((p, i) => (activeMask[i] && p.f0 > 0 && p.ap <= maxAp ? p.f0 : 0));
  const act = activeMask.filter(Boolean).length || 1;
  const voiced = v.filter(f => f > 0);
  if (voiced.length < 3) return {voicedFrac: r(voiced.length / act), f0MedianHz: null, rangeSt: 0, notes: 0, noteSteps: 0, movementSt: 0, segments: []};
  const sorted = [...voiced].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const p5 = sorted[Math.floor(sorted.length * 0.05)], p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  // 3-frame median smoothing on voiced runs (octave-jump guard)
  const sm = v.map((f, i) => {
    if (!f) return 0;
    const w = [v[i - 1], f, v[i + 1]].filter(q => q > 0).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  const segs = [];
  let cur = null;
  for (let i = 0; i < sm.length; i++) {
    const f = sm[i];
    if (f > 0 && cur && Math.abs(semis(f, cur.ref)) <= 0.8) { cur.n++; cur.sum += semis(f, med); cur.end = i; continue; }
    if (cur && cur.n * hopS >= minNoteS) segs.push(cur);
    cur = f > 0 ? {start: i, end: i, n: 1, ref: f, sum: semis(f, med)} : null;
  }
  if (cur && cur.n * hopS >= minNoteS) segs.push(cur);
  const notes = segs.map(s => ({t0: r(s.start * hopS, 2), t1: r((s.end + 1) * hopS, 2), st: r(s.sum / s.n, 2), hz: Math.round(med * Math.pow(2, s.sum / s.n / 12))}));
  let steps = 0, move = 0;
  for (let i = 1; i < notes.length; i++) { const dSt = Math.abs(notes[i].st - notes[i - 1].st); move += dSt; if (dSt >= 1) steps++; }
  return {voicedFrac: r(voiced.length / act), f0MedianHz: Math.round(med), f0P5Hz: Math.round(p5), f0P95Hz: Math.round(p95), rangeSt: r(semis(p95, p5), 2),
    notes: notes.length, noteSteps: steps, movementSt: r(move, 2), segments: notes};
}

/**
 * Whole-clip structural metrics (mono). Frames below `activeDb` re the loudest 50 ms frame are "inactive" (excluded from the
 * spectral / pitch averages). `quietFrac` = share of 5 ms frames >= 30 dB below the peak frame (cough gate convention).
 */
export function structure(x, sr, {activeDb = -35} = {}) {
  let pk = 0, ss = 0, clipped = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; ss += x[i] * x[i]; if (a >= 0.999) clipped++; }
  const rmsAll = Math.sqrt(ss / Math.max(1, x.length));
  const env5 = envelopeDb(x, sr, 0.005), env50 = envelopeDb(x, sr, 0.05);
  const e5max = Math.max(...env5), e50max = Math.max(...env50);
  const quietFrac = env5.filter(e => e < e5max - 30).length / env5.length;
  const activeFrac50 = env50.filter(e => e > e50max + activeDb).length / env50.length;
  // level spread over active 50 ms frames (a flat noise wall has a tiny spread)
  const act50 = [...env50].filter(e => e > e50max + activeDb);
  const mean50 = act50.reduce((p, q) => p + q, 0) / Math.max(1, act50.length);
  const spread50 = Math.sqrt(act50.reduce((p, q) => p + (q - mean50) ** 2, 0) / Math.max(1, act50.length));
  // attack: first 5 ms frame within 20 dB of the peak frame, the peak frame, rise time between first > -40 dB and peak - 3 dB
  const onIdx = env5.findIndex(e => e > e5max - 40), pkIdx = env5.indexOf(e5max);
  const nearPk = env5.findIndex(e => e > e5max - 3);
  // decay: level of the last 25 % of the ACTIVE span vs the first 25 % (dB), and the slope after the peak (dB/s, 50 ms frames)
  const a50 = env50.findIndex(e => e > e50max + activeDb);
  let b50 = env50.length - 1;
  while (b50 > a50 && !(env50[b50] > e50max + activeDb)) b50--;
  const span = Math.max(1, b50 - a50 + 1), q = Math.max(1, Math.floor(span / 4));
  const lin = arr => arr.reduce((p, e) => p + Math.pow(10, e / 10), 0) / Math.max(1, arr.length);
  const firstQ = 10 * Math.log10(lin([...env50.slice(a50, a50 + q)]) + 1e-18), lastQ = 10 * Math.log10(lin([...env50.slice(b50 - q + 1, b50 + 1)]) + 1e-18);
  const pk50 = env50.indexOf(e50max);
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let h = pk50; h < env50.length; h++) { if (!(env50[h] > e50max - 60)) continue; const t = h * 0.05; sx += t; sy += env50[h]; sxx += t * t; sxy += t * env50[h]; n++; }
  const slope = n > 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
  // spectral: centroid, flatness, rolloff 85 %, band shares over active frames
  const S = stft(x, sr, 2048, 512), binHz = sr / S.N;
  const fMax = Math.max(...S.rms);
  let cen = 0, cenW = 0, flatAcc = 0, flatN = 0, roll = 0;
  const bands = [[0, 300], [300, 1000], [1000, 3000], [3000, 8000], [8000, sr / 2]], bandE = new Float64Array(bands.length);
  const actMask = S.rms.map(v => v > fMax * dbToLin(activeDb));
  for (let f = 0; f < S.frames.length; f++) {
    if (!actMask[f]) continue;
    const p = S.frames[f];
    let num = 0, den = 0, logSum = 0, cnt = 0;
    for (let k = 1; k < p.length; k++) {
      num += p[k] * k * binHz; den += p[k];
      const hz = k * binHz;
      for (let b = 0; b < bands.length; b++) if (hz >= bands[b][0] && hz < bands[b][1]) bandE[b] += p[k];
      if (hz >= 100 && hz <= 10000) { logSum += Math.log(p[k] + 1e-20); cnt++; }
    }
    if (den > 0) { cen += num; cenW += den; }
    // flatness (Wiener entropy) over 100 Hz–10 kHz: 1 = white noise, ~0 = pure tones
    let am = 0;
    for (let k = 1; k < p.length; k++) { const hz = k * binHz; if (hz >= 100 && hz <= 10000) am += p[k]; }
    am /= Math.max(1, cnt);
    if (am > 0) { flatAcc += Math.exp(logSum / cnt) / am; flatN++; }
    let acc = 0;
    for (let k = 1; k < p.length; k++) { acc += p[k]; if (acc >= 0.85 * den) { roll += k * binHz; break; } }
  }
  const nAct = actMask.filter(Boolean).length || 1;
  const bandTot = bandE.reduce((p, q) => p + q, 0) || 1;
  const track = yin(x, sr, {N: 2048, hop: 512});
  const pitch = pitchContour(track, actMask.slice(0, track.length), {hopS: 512 / sr});
  const durS = x.length / sr;
  return {
    durationS: r(durS), peakDbfs: r(linToDb(pk), 1), rmsDbfs: r(linToDb(rmsAll), 1), crestDb: r(linToDb(pk) - linToDb(rmsAll), 1),
    clippedFrac: r(clipped / Math.max(1, x.length), 5), quietFrac: r(quietFrac), activeFrac: r(activeFrac50),
    levelSpreadDb: r(spread50, 2),
    attack: {onsetS: r(onIdx * 0.005), peakS: r(pkIdx * 0.005), riseMs: r((nearPk - onIdx) * 5, 0)},
    decay: {firstQuarterDb: r(firstQ, 1), lastQuarterDb: r(lastQ, 1), lastMinusFirstDb: r(lastQ - firstQ, 1), slopeDbPerS: r(slope, 1), activeEndS: r((b50 + 1) * 0.05, 2)},
    spectral: {centroidHz: Math.round(cen / Math.max(1e-20, cenW)), flatness: r(flatAcc / Math.max(1, flatN)), rolloff85Hz: Math.round(roll / nAct),
      bands: Object.fromEntries(bands.map((b, i) => [`${b[0]}-${Math.round(b[1])}Hz`, r(bandE[i] / bandTot)]))},
    pitch,
    _track: track, _stft: S, _env5: env5, _actMask: actMask,
  };
}

/**
 * Structural gate per cue kind (NOT a listening test). Every criterion is reported with its measured value; `pass` = all
 * required ones hold. Thresholds come from the cue definitions in the task brief; the tonal-vs-noise flatness cut (0.1)
 * was placed after the first measurement, midway (log scale) between the tonal takes (flatness <= 0.021) and the noise takes
 * (>= 0.20) — documented in the provenance. The known Sound Lab failure (continuous broadband noise with no structure:
 * flat envelope + flat spectrum + no pitch) fails every kind, including the hiss (which must FADE).
 *  - hum:    sustained tonal voice with pitch movement — voiced >= 50 % of active frames, flatness < 0.1, median f0 in the
 *            humming range 100–700 Hz, >= 3 held notes with >= 2 steps of >= 1 semitone (a melody-like contour), active >= 40 %.
 *  - scream: loud bright onset — rise to within 3 dB of the peak <= 600 ms after the onset, centroid >= 1200 Hz, >= 50 % of
 *            the energy above 1 kHz, peak >= -12 dBFS raw (loud, before normalisation), voiced/pitched >= 20 % (a voice, not a hiss).
 *  - burst:  transient + decay — rise <= 60 ms, the active span ends >= 0.5 s before the clip end or decays >= 15 dB
 *            (last vs first quarter), negative decay slope.
 *  - hiss:   broadband noise that fades — flatness >= 0.1, unvoiced (<= 20 % voiced), no band holds > 60 % of the energy,
 *            and it fades: last quarter >= 8 dB below the first quarter of the active span with a negative slope.
 */
export function cueVerdict(kind, m) {
  const c = [];
  const req = (name, ok, value, need) => c.push({name, ok: !!ok, value, need, required: true});
  const info = (name, value) => c.push({name, value, required: false});
  const noiseWall = m.levelSpreadDb < 2 && m.spectral.flatness >= 0.35 && m.pitch.voicedFrac < 0.1;
  req('not a broadband noise wall', !noiseWall, {levelSpreadDb: m.levelSpreadDb, flatness: m.spectral.flatness, voicedFrac: m.pitch.voicedFrac}, 'NOT (spread < 2 dB AND flatness >= 0.35 AND voiced < 0.1)');
  req('audible (not near-silent)', m.peakDbfs > -45, m.peakDbfs, '> -45 dBFS');
  req('no clipping', m.clippedFrac < 1e-4, m.clippedFrac, '< 0.0001');
  const above1k = (m.spectral.bands['1000-3000Hz'] ?? 0) + (m.spectral.bands['3000-8000Hz'] ?? 0) + (m.spectral.bands['8000-22050Hz'] ?? 0);
  const maxBand = Math.max(...Object.values(m.spectral.bands));
  if (kind === 'hum') {
    req('voiced (tonal voice)', m.pitch.voicedFrac >= 0.5, m.pitch.voicedFrac, '>= 0.5');
    req('tonal spectrum', m.spectral.flatness < 0.1, m.spectral.flatness, '< 0.1');
    req('humming register', m.pitch.f0MedianHz >= 100 && m.pitch.f0MedianHz <= 700, m.pitch.f0MedianHz, '100–700 Hz');
    req('melody-like contour', m.pitch.notes >= 3 && m.pitch.noteSteps >= 2, {notes: m.pitch.notes, steps: m.pitch.noteSteps, rangeSt: m.pitch.rangeSt}, '>= 3 notes, >= 2 steps >= 1 st');
    req('sustained', m.activeFrac >= 0.4, m.activeFrac, '>= 0.4');
  } else if (kind === 'scream') {
    req('fast rise to the peak', m.attack.riseMs <= 600, m.attack.riseMs, '<= 600 ms');
    req('bright', m.spectral.centroidHz >= 1200 && above1k >= 0.5, {centroidHz: m.spectral.centroidHz, shareAbove1k: r(above1k)}, 'centroid >= 1200 Hz, >= 50 % above 1 kHz');
    req('loud raw', m.peakDbfs >= -12, m.peakDbfs, '>= -12 dBFS');
    req('a voice (pitched)', m.pitch.voicedFrac >= 0.2, {voicedFrac: m.pitch.voicedFrac, f0MedianHz: m.pitch.f0MedianHz}, 'voiced >= 0.2');
    info('ends (active end s)', m.decay.activeEndS);
  } else if (kind === 'burst') {
    req('transient onset', m.attack.riseMs <= 60, m.attack.riseMs, '<= 60 ms');
    req('decays', (m.decay.activeEndS <= m.durationS - 0.5 || m.decay.lastMinusFirstDb <= -15) && m.decay.slopeDbPerS < 0,
      {activeEndS: m.decay.activeEndS, lastMinusFirstDb: m.decay.lastMinusFirstDb, slopeDbPerS: m.decay.slopeDbPerS}, 'ends >= 0.5 s early or -15 dB, slope < 0');
    info('low-end share (0–300 Hz, body)', m.spectral.bands['0-300Hz']);
  } else if (kind === 'hiss') {
    req('noise-like spectrum', m.spectral.flatness >= 0.1, m.spectral.flatness, '>= 0.1');
    req('unvoiced', m.pitch.voicedFrac <= 0.2, m.pitch.voicedFrac, '<= 0.2');
    req('broadband', maxBand <= 0.6, {maxBandShare: r(maxBand)}, 'no band > 60 %');
    req('fades out', m.decay.lastMinusFirstDb <= -8 && m.decay.slopeDbPerS < 0, {lastMinusFirstDb: m.decay.lastMinusFirstDb, slopeDbPerS: m.decay.slopeDbPerS}, 'last quarter <= -8 dB vs first, slope < 0');
  } else throw new Error(`unknown cue kind ${kind}`);
  const pass = c.filter(x => x.required).every(x => x.ok);
  return {kind, pass, failed: c.filter(x => x.required && !x.ok).map(x => x.name), criteria: c};
}

/** Strip the private arrays (for JSON). */
export function publicMetrics(m) {
  const o = {};
  for (const [k, v] of Object.entries(m)) if (!k.startsWith('_')) o[k] = v;
  return o;
}

/**
 * ITU-R BS.1770-4 style loudness (mono): K-weighting (high-shelf + RLB high-pass biquads, coefficients derived for `sr`),
 * 400 ms blocks with 75 % overlap, absolute (-70 LUFS) and relative (-10 LU) gating. Returns integrated LUFS and the
 * maximum momentary (400 ms) loudness. Mono = one channel at weight 1.
 */
export function loudness(x, sr) {
  // pre-filter (high shelf ~ +4 dB above 1.5 kHz) and RLB high-pass (~38 Hz), bilinear designs per BS.1770 reference
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    return {b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]};
  })();
  const hp = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / sr);
    const a0 = 1 + K / Q + K * K;
    return {b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]};
  })();
  const biquad = (inp, {b, a}) => {
    const out = new Float64Array(inp.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < inp.length; i++) {
      const v = b[0] * inp[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = inp[i]; y2 = y1; y1 = v; out[i] = v;
    }
    return out;
  };
  const k = biquad(biquad(x, shelf), hp);
  const B = Math.round(0.4 * sr), step = Math.round(0.1 * sr), blocks = [];
  for (let s = 0; s + B <= k.length; s += step) { let e = 0; for (let i = s; i < s + B; i++) e += k[i] * k[i]; blocks.push(e / B); }
  if (!blocks.length) { let e = 0; for (const v of k) e += v * v; blocks.push(e / Math.max(1, k.length)); }
  const L = z => -0.691 + 10 * Math.log10(z + 1e-20);
  const abs = blocks.filter(z => L(z) > -70);
  if (!abs.length) return {integratedLufs: null, momentaryMaxLufs: r(Math.max(...blocks.map(L)), 1)};
  const rel = L(abs.reduce((p, q) => p + q, 0) / abs.length) - 10;
  const g = abs.filter(z => L(z) > rel);
  return {integratedLufs: r(L(g.reduce((p, q) => p + q, 0) / g.length), 1), momentaryMaxLufs: r(Math.max(...blocks.map(L)), 1)};
}
