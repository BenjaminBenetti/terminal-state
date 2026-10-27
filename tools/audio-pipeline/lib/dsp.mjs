// Offline clip editing for Sound Lab raws: analysis, trim, onset slicing, fades, levelling, seamless loops.
// Pure JS math on decoded samples. This edits generated clips; it never creates sound.

export const dbToLin = db => Math.pow(10, db / 20);
export const linToDb = v => 20 * Math.log10(Math.max(1e-9, v));

export function downmix(chs) {
  if (chs.length === 1) return Float32Array.from(chs[0]);
  const n = chs[0].length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of chs) s += c[i]; out[i] = s / chs.length; }
  return out;
}

export function peak(chs) {
  let m = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > m) m = a; }
  return m;
}

export function rms(chs, a = 0, b = chs[0].length) {
  let s = 0, n = 0;
  for (const c of chs) for (let i = a; i < b; i++) { s += c[i] * c[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

/** RMS envelope over `hop`-sample windows (mono reference signal). */
export function envelope(x, hop) {
  const n = Math.floor(x.length / hop), env = new Float32Array(n);
  for (let h = 0; h < n; h++) {
    let s = 0;
    for (let i = h * hop, e = i + hop; i < e; i++) s += x[i] * x[i];
    env[h] = Math.sqrt(s / hop);
  }
  return env;
}

function percentile(arr, p) {
  const s = Array.from(arr).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
}

/** Whole-raw QC metrics (5 ms envelope). `flatDb` = 10th-percentile minus max envelope: near 0 = sustained. */
export function analyse(chs, sr) {
  const x = downmix(chs), hop = Math.round(sr * 0.005), env = envelope(x, hop);
  let emax = 0;
  for (const e of env) emax = Math.max(emax, e);
  let clipped = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= 0.999) clipped++;
  let zc = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) zc++;
  const active = env.filter(e => e > emax * dbToLin(-30)).length * hop / sr;
  return {
    durationS: +(x.length / sr).toFixed(3), peakDb: +linToDb(peak(chs)).toFixed(1), rmsDb: +linToDb(rms(chs)).toFixed(1),
    flatDb: +(linToDb(percentile(env, 0.1)) - linToDb(emax)).toFixed(1), activeS: +active.toFixed(3),
    zcrPerS: Math.round(zc / (x.length / sr)), clippedFrac: +(clipped / (chs.length * x.length)).toFixed(5),
  };
}

/**
 * Onsets (sample indices) on a 5 ms envelope: a rise of `riseDb` above the running minimum of the
 * previous `lookMs`, above `floorDb` relative to the clip max, at least `minGapS` after the last one.
 */
export function onsets(x, sr, {riseDb = 9, floorDb = -30, minGapS = 0.25, lookMs = 40} = {}) {
  const hop = Math.round(sr * 0.005), env = envelope(x, hop);
  let emax = 0;
  for (const e of env) emax = Math.max(emax, e);
  const floor = emax * dbToLin(floorDb), look = Math.max(1, Math.round(lookMs / 5)), out = [];
  let last = -Infinity;
  for (let h = 1; h < env.length; h++) {
    if (env[h] < floor) continue;
    let mn = Infinity;
    for (let k = Math.max(0, h - look); k < h; k++) mn = Math.min(mn, env[k]);
    if (h === 1 && env[0] >= floor) mn = 0; // event already sounding at t=0
    if (linToDb(env[h]) - linToDb(mn) >= riseDb && (h - last) * hop / sr >= minGapS) {
      // refine back to where this hop's rise began (first hop above 1/4 of it)
      let s = h;
      while (s > 0 && env[s - 1] > env[h] * 0.25 && env[s - 1] < env[s]) s--;
      out.push(s * hop);
      last = h;
    }
  }
  return out;
}

/**
 * End of the event that starts at `a` (sample): the first point after the event peak where the 5 ms
 * envelope stays below `tailDb` (rel. event peak) for `holdMs`; when `split`, also stop before a new
 * rise of `riseDb` once the event has decayed by `decayDb`. Capped at a + maxS.
 */
export function eventEnd(x, sr, a, {maxS = 1, tailDb = -45, holdMs = 40, split = true, riseDb = 10, decayDb = 15} = {}) {
  const hop = Math.round(sr * 0.005), cap = Math.min(x.length, a + Math.round(maxS * sr));
  const env = envelope(x.subarray(a, cap), hop);
  if (!env.length) return cap;
  let ph = 0;
  const searchPeak = Math.min(env.length, Math.round(0.25 * sr / hop)); // event peak within its first 250 ms
  for (let h = 0; h < searchPeak; h++) if (env[h] > env[ph]) ph = h;
  const pk = env[ph], tail = pk * dbToLin(tailDb), hold = Math.max(1, Math.round(holdMs / 5));
  let below = 0, mn = pk;
  for (let h = ph + 1; h < env.length; h++) {
    if (env[h] < tail) { if (++below >= hold) return a + (h - hold + 1) * hop; } else below = 0;
    mn = Math.min(mn, env[h]);
    if (split && linToDb(mn) <= linToDb(pk) + -decayDb && linToDb(env[h]) - linToDb(mn) >= riseDb) {
      return a + Math.max(ph + 1, h - 2) * hop; // next event begins: cut just before it
    }
  }
  return cap;
}

export function slice(chs, a, b) { return chs.map(c => c.slice(a, b)); }

/** Cosine fade in/out (seconds) in place. */
export function fade(chs, sr, inS, outS) {
  const n = chs[0].length, fi = Math.min(n, Math.round(inS * sr)), fo = Math.min(n, Math.round(outS * sr));
  for (const c of chs) {
    for (let i = 0; i < fi; i++) c[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fi);
    for (let i = 0; i < fo; i++) c[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fo);
  }
  return chs;
}

export function gain(chs, g) { for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g; return chs; }

/** Peak-normalise to `peakDb`; returns the applied gain (dB). */
export function normalisePeak(chs, peakDb = -1) {
  const p = peak(chs);
  if (p < 1e-6) return 0;
  const g = dbToLin(peakDb) / p;
  gain(chs, g);
  return linToDb(g);
}

/** RMS-normalise to `rmsDb` with a peak ceiling; returns applied gain (dB). */
export function normaliseRms(chs, rmsDb = -20, ceilDb = -1) {
  const r = rms(chs), p = peak(chs);
  if (r < 1e-7) return 0;
  const g = Math.min(dbToLin(rmsDb) / r, dbToLin(ceilDb) / Math.max(p, 1e-9));
  gain(chs, g);
  return linToDb(g);
}

/**
 * Seamless loop of `lenS` from source start `startS` with an equal-power crossfade of `xfS`
 * (the loop's first xf seconds blend in the material that follows the loop end). Returns L-sample
 * channels where out[L-1] -> out[0] is continuous.
 */
export function makeLoop(chs, sr, startS, lenS, xfS) {
  const s0 = Math.round(startS * sr), L = Math.round(lenS * sr), X = Math.round(xfS * sr);
  if (s0 + L + X > chs[0].length) throw new Error('source too short for loop');
  return chs.map(c => {
    const out = c.slice(s0, s0 + L);
    for (let i = 0; i < X; i++) {
      const t = (i + 0.5) / X, a = Math.sin(t * Math.PI / 2), b = Math.cos(t * Math.PI / 2);
      out[i] = c[s0 + i] * a + c[s0 + L + i] * b;
    }
    return out;
  });
}

/**
 * Most stationary region for a loop: start (s) of the `spanS` window whose 0.5 s block levels vary
 * least, preferring windows near the clip's loudest sustained level (skips fade-ins/outs).
 * Returns {startS, stdDb, meanDb, maxBlockDb}.
 */
export function stationaryRegion(x, sr, spanS, {minStartS = 0.5, endGuardS = 0.3} = {}) {
  const blk = Math.round(0.5 * sr), env = envelope(x, blk).map(linToDb);
  const maxBlock = Math.max(...env), nb = Math.ceil(spanS / 0.5);
  let best = null;
  for (let s = Math.ceil(minStartS / 0.5); s + nb <= env.length - Math.ceil(endGuardS / 0.5) + 1 && s + nb <= env.length; s++) {
    const w = env.slice(s, s + nb), mean = w.reduce((p, q) => p + q, 0) / nb;
    const std = Math.sqrt(w.reduce((p, q) => p + (q - mean) ** 2, 0) / nb);
    const score = std + Math.max(0, maxBlock - mean - 6) * 0.5;
    if (!best || score < best.score) best = {score, startS: s * 0.5, stdDb: std, meanDb: mean};
  }
  if (!best) return {startS: minStartS, stdDb: NaN, meanDb: NaN, maxBlockDb: maxBlock};
  return {startS: best.startS, stdDb: +best.stdDb.toFixed(2), meanDb: +best.meanDb.toFixed(1), maxBlockDb: +maxBlock.toFixed(1)};
}

/** Periodic margins around a loop so decoders' priming/padding never lands inside [M, M+L). */
export function withLoopMargins(chs, sr, marginS) {
  const L = chs[0].length, M = Math.min(L, Math.round(marginS * sr));
  return chs.map(c => {
    const out = new Float32Array(L + 2 * M);
    out.set(c.subarray(L - M), 0);
    out.set(c, M);
    out.set(c.subarray(0, M), M + L);
    return out;
  });
}

/** N non-overlapping windows of `winS` with the highest RMS (for continuous textures like rummaging). */
export function loudestWindows(x, sr, n, winS, skipS = 0.05) {
  const W = Math.round(winS * sr), hop = Math.round(sr * 0.01), cand = [];
  for (let a = Math.round(skipS * sr); a + W <= x.length; a += hop) {
    let s = 0;
    for (let i = a; i < a + W; i += 4) s += x[i] * x[i];
    cand.push([s, a]);
  }
  cand.sort((p, q) => q[0] - p[0]);
  const picked = [];
  for (const [, a] of cand) {
    if (picked.every(p => Math.abs(p - a) >= W)) picked.push(a);
    if (picked.length >= n) break;
  }
  return picked.sort((p, q) => p - q);
}
