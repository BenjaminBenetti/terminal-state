#!/usr/bin/env node
// Task studio-bb-production-20261112-234540-01 (lane AUDIO): runtime derivatives of BB'S VOICE — the laugh set shared by all four looks
// of the small crawling undead: the loud eerie cackle when it notices the player (the gameplay tell), the quiet giggle now and then while
// one is near, the rising squeal of its pounce (it starts with the wind-up and is loudest at the launch), a short toy-like squawk when it
// is shot, and a laugh that winds down when it dies. Planned by tools/audio-pipeline/bb-plan.py (ids, cues, whole-second durations,
// seeds; the prompt text stays with the private raw archive) and generated through tools/audio-pipeline/soundlab_runner.py (one fsynced
// intent per POST; bounded batches, each under its own durable SOUND_LAB_MAX_POSTS; /tmp/ll-soundlab.lock). This builder makes NO Sound
// Lab call: it edits the generated clips only (trim / fades / level) and never creates sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/bb-production-20261112-234540/audio) {queue.json, raw/<id>.wav,
//   raw/<id>.sidecar.json}, each raw verified against its runner sidecar SHA-256 (and the lab's recorded request against the queue);
//   game/public/assets/derivatives/audio-track1.json (the existing cues' mix calibration: the loudness references).
// Outputs: game/public/assets/audio/bb-*.mp3, game/src/audio/manifest.bb.generated.ts (cue list + clips + mix gains, merged by bank.ts;
//   sfx.ts CUE_GAIN carries the same gains), game/public/assets/derivatives/audio-bb.json (provenance: job ids, seeds, hashes, structural
//   metrics, the mix calibration — NO prompt text, NO private paths), the NOTICE sentence / CREDITS block, tools/release/public-inputs.json
//   (only these paths). With --qc: one structural QC image per derivative into $SOUND_LAB_AUDIO_DIR/qc/built (private; never in Git).
//
// Ops: mono downmix (mean) -> window DC removal -> trim [a, b] + cosine fades -> peak -1 dBFS -> the takes of a cue lowered to the
//   quietest take's momentary-max loudness (variants sit at one level) -> MP3 (lamejs, mono; cackle / pounce 128 kbps, the others 96).
// Mix: CUE_GAIN per cue = 10^((target - measured) / 20), capped at 1 (no boost): `MIX` = the cue's momentary-max loudness AT THE SOURCE
//   (derivative x CUE_GAIN, before distance / occlusion / master), set against the existing cues' calibration.
// Structural QC only (the worker cannot listen): every gate below describes signal structure, not how it sounds.
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/bb-build.mjs [--dry-run] [--qc]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {structure, loudness, envelopeDb, publicMetrics} from './lib/structural.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-bb-production-20261112-234540-01';
const RAW_REL = 'reference/tasks/bb-production-20261112-234540/audio';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.bb.generated.ts');
const PROV_REL = 'assets/derivatives/audio-bb.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run'), QC = process.argv.includes('--qc');
const BYTE_CAP = 300 * 1024;
const PEAK_CEIL_DB = -1;
const sha = b => createHash('sha256').update(b).digest('hex');
const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3);

/** Runtime cue order (decode priority: the cackle — the tell — first). */
const CUE_ORDER = ['bbCackle', 'bbGiggle', 'bbPounce', 'bbHurt', 'bbDeath'];
const KIND = {bbCackle: 'cackle', bbGiggle: 'giggle', bbPounce: 'pounce', bbHurt: 'hurt', bbDeath: 'death'};
const KBPS = {bbCackle: 128, bbGiggle: 96, bbPounce: 128, bbHurt: 96, bbDeath: 96};
/** The pounce cue starts with the wind-up tell; the leap launches this long after it (game/src/ai/bb.ts BB_POUNCE.windupS; pinned by tests/bb-audio.test.ts). */
const POUNCE_WINDUP_S = 0.55;

/**
 * Target momentary-max loudness of each cue AT THE SOURCE (derivative x CUE_GAIN), LUFS — first estimates for the user's ear pass, set
 * against the existing calibration (derivatives/audio-track1.json mixCalibration: zombie groan -18.5, zombie death -17.1, zombie attack
 * -20.3, Siren wake scream -15.8, Siren hum -24.3, the player's hurt grunt -24.0):
 *  - cackle: the "it has seen you" tell — 2 LU over a zombie groan, just under the Siren's wake scream (the loudest enemy vocal);
 *  - giggle: quiet and near — 6.5 LU under a groan (about the Siren's hum / the Screacher's wheeze);
 *  - pounce: its loudest moment (the launch) as loud as the cackle; the clip starts about 10 dB lower and builds to it;
 *  - hurt: a short squawk — 1.2 LU under a zombie attack;
 *  - death: the wind-down — 1 LU under a groan (a clear kill confirmation, softer than a zombie's death).
 */
const MIX = {
  bbCackle: {targetLufs: -16.5, basis: 'zombieGroan', why: '2 LU over a zombie groan, 0.7 LU under the Siren\'s wake scream (the tell carries)'},
  bbGiggle: {targetLufs: -25, basis: 'zombieGroan', why: '6.5 LU under a zombie groan (about the Siren\'s hum)'},
  bbPounce: {targetLufs: -16.5, basis: 'zombieAttack', why: 'its loudest moment (the launch) as loud as the cackle, 3.8 LU over a zombie attack; the clip starts about 10 dB lower'},
  bbHurt: {targetLufs: -21.5, basis: 'zombieAttack', why: '1.2 LU under a zombie attack'},
  bbDeath: {targetLufs: -19.5, basis: 'zombieGroan', why: '1 LU under a zombie groan, 2.4 LU under a zombie death'},
};

/**
 * Per accepted take: its derivative window. The windows were placed on the takes' 5 ms envelopes (private QC):
 *  - cackle: takes 02 / 03 / 04 are ONE request with three seeds — one family: ten bursts in 1.8 s at about 5.6 per second that get
 *    quieter, pitched syllables at 520-780 Hz under bright breath noise; each window runs from the silence before the first burst to
 *    the silence after the tenth (a stray 40-70 ms blip 0.2 s later is left out). Take 05 is the other request: twelve bursts in 2 s
 *    whose pitch steps down (about 1.08 kHz -> 680 -> 430 Hz); it begins sounding at the take's first sample (a 20 ms fade-in) and ends
 *    in the silence before a separate steady sound.
 *  - giggle: four takes (two requests x two seeds), 4-6 voiced syllables each (f0 about 380-480 Hz) inside 0.7-1.0 s; take 03 keeps its
 *    two quieter trailing syllables, the others end in the silence after their main run.
 *  - pounce: takes 03 / 07 / 08 are one request with three seeds — one continuous squeal (main partial 3.1-3.3 kHz) that holds a
 *    steady level, then steps up about 10 dB to its loudest part 0.7-0.9 s into the event while that partial drifts up 1.5-3
 *    semitones (to 3.6-3.7 kHz): the build is mostly one of level, the pitch rise is small. Each window starts INSIDE the squeal's
 *    steady early part (already sounding: audible from the first frame, a 12 ms fade-in) so that the loud part arrives about 0.5 s
 *    after the clip start — at the launch, 0.55 s after the wind-up tell begins. Takes 03 / 07 end with a second short squeal after
 *    a 0.1 s gap, take 08 holds its loud part for 0.5 s.
 *  - hurt: the first squawk of each take (0.2-0.24 s, a 15-25 ms attack, noisy with a partial near 1.15 kHz), cut from silence to
 *    silence; the takes' separate steady squeak 0.13-0.15 s later is left out.
 *  - death: take 02 — five voiced laugh syllables whose pitch steps down by more than an octave (YIN readings from about 650-690 Hz
 *    to 155-200 Hz), ended with a 60 ms fade inside the last low syllable (a louder, higher blip follows it in the take and is left
 *    out). Take 03 — a pulse train at one pitch (600-670 Hz) whose bursts get about 10 dB quieter and lose their voicing over 1 s:
 *    a toy running down by level, not by pitch.
 */
const PLAN = {
  'bb-cackle-02': [{cue: 'bbCackle', a: 0.115, b: 1.935, fadeIn: 0.005, fadeOut: 0.03}],
  'bb-cackle-03': [{cue: 'bbCackle', a: 0.12, b: 1.935, fadeIn: 0.005, fadeOut: 0.03}],
  'bb-cackle-04': [{cue: 'bbCackle', a: 0.11, b: 1.93, fadeIn: 0.005, fadeOut: 0.03}],
  'bb-cackle-05': [{cue: 'bbCackle', a: 0, b: 2.02, fadeIn: 0.02, fadeOut: 0.02}],
  'bb-giggle-01': [{cue: 'bbGiggle', a: 0.13, b: 1.085, fadeIn: 0.01, fadeOut: 0.02}],
  'bb-giggle-02': [{cue: 'bbGiggle', a: 0.115, b: 0.99, fadeIn: 0.01, fadeOut: 0.015}],
  'bb-giggle-03': [{cue: 'bbGiggle', a: 0.135, b: 1.38, fadeIn: 0.01, fadeOut: 0.015}],
  'bb-giggle-04': [{cue: 'bbGiggle', a: 0.085, b: 0.985, fadeIn: 0.01, fadeOut: 0.015}],
  'bb-pounce-03': [{cue: 'bbPounce', a: 0.44, b: 1.51, fadeIn: 0.012, fadeOut: 0.03}],
  'bb-pounce-07': [{cue: 'bbPounce', a: 0.44, b: 1.5, fadeIn: 0.012, fadeOut: 0.03}],
  'bb-pounce-08': [{cue: 'bbPounce', a: 0.42, b: 1.53, fadeIn: 0.012, fadeOut: 0.03}],
  'bb-hurt-01': [{cue: 'bbHurt', a: 0.185, b: 0.44, fadeIn: 0.004, fadeOut: 0.02}],
  'bb-hurt-02': [{cue: 'bbHurt', a: 0.15, b: 0.405, fadeIn: 0.004, fadeOut: 0.015}],
  'bb-hurt-03': [{cue: 'bbHurt', a: 0.33, b: 0.55, fadeIn: 0.004, fadeOut: 0.015}],
  'bb-death-02': [{cue: 'bbDeath', a: 1.185, b: 2.29, fadeIn: 0.01, fadeOut: 0.06}],
  'bb-death-03': [{cue: 'bbDeath', a: 0.215, b: 1.24, fadeIn: 0.008, fadeOut: 0.02}],
};
/**
 * Generated but not shipped, recorded publicly by job id with the reason (the raws stay in the private archive): `rejected` = the
 * take's structure does not fit its cue; `spare` = a usable further take of an accepted request, left out to keep the set small.
 */
const NOT_USED = {
  'bb-cackle-01': {kind: 'spare', reason: 'a second take of the request behind cackle take 05 (the same family: 15 bursts in 2 s that thin out, a partial near 1 kHz); the cue ships four takes — three of the other request and one of this one'},
  'bb-pounce-01': {kind: 'spare', reason: 'the same rising squeal as the shipped three, but the take stops 0.2 s after its loud part begins: cut to put that part at the launch it is 0.78 s long, under the 0.9-1.3 s cue'},
  'bb-pounce-02': {kind: 'rejected', reason: 'six separate voiced syllables (f0 about 450-600 Hz) that get louder, the loud ones 1.2-1.75 s into the take: a laugh-like staccato, not the one continuous rising squeal of the accepted request'},
  'bb-pounce-04': {kind: 'rejected', reason: 'the rising glide is there, but the take is loudest 0.27 s after its start and then declines by about 10 dB: it does not build to a loud part at the launch'},
  'bb-pounce-05': {kind: 'rejected', reason: 'quiet separate syllables (24-30 dB under the peak), then one loud 0.25 s shriek 1.35 s into the take: nothing audible at once before the loud part'},
  'bb-pounce-06': {kind: 'rejected', reason: 'the rising glide is there, but the take is loudest 0.23 s after its start and only returns to within 3 dB of that near its end: it does not build to a loud part at the launch'},
  'bb-death-01': {kind: 'rejected', reason: 'ten unvoiced clicks (60-95 ms each, centroid about 5 kHz, voiced 5 %) that slow down and decay: a ratchet running out with no laugh or voice in it; replaced by takes 02 / 03 of two new wordings'},
};

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}
/** Max momentary (400 ms) loudness, zero-padded to one full block so a short one-shot measures like a long one. */
function momentaryMax(x, sr) {
  const n = Math.max(x.length, Math.round(0.4 * sr)), y = new Float64Array(n);
  y.set(x);
  return loudness(y, sr).momentaryMaxLufs;
}
/** Seconds from the clip start to the first `hopS` frame within `db` of the clip's loudest `hopS` frame. */
function timeToWithin(x, sr, db, hopS = 0.005) {
  const env = envelopeDb(x, sr, hopS), mx = Math.max(...env);
  return r3(env.findIndex(e => e >= mx - db) * hopS);
}
/**
 * Laugh bursts: prominent peaks of the 5 ms envelope smoothed over 25 ms — a peak within `floorDb` of the loudest one that stands
 * `promDb` above the lowest point between it and the next higher frame on each side (or the clip edge), at least `minGapS` apart.
 * Returns the count, the rate over the bursting span (per second), the median interval and the median dip between neighbours (dB).
 */
function bursts(x, sr, {floorDb = -24, promDb = 5, minGapS = 0.07} = {}) {
  const raw = envelopeDb(x, sr, 0.005), n = raw.length, env = new Float64Array(n);
  for (let h = 0; h < n; h++) { let s = 0, c = 0; for (let k = Math.max(0, h - 2); k <= Math.min(n - 1, h + 2); k++) { s += Math.pow(10, raw[k] / 10); c++; } env[h] = 10 * Math.log10(s / c + 1e-20); }
  const mx = Math.max(...env), keep = [];
  for (let h = 1; h < n - 1; h++) {
    if (!(env[h] > mx + floorDb && env[h] >= env[h - 1] && env[h] > env[h + 1])) continue;
    let lo = env[h], l = h;
    while (l > 0 && env[l - 1] <= env[h]) { l--; lo = Math.min(lo, env[l]); }
    const leftMin = lo;
    lo = env[h];
    let q = h;
    while (q < n - 1 && env[q + 1] <= env[h]) { q++; lo = Math.min(lo, env[q]); }
    if (env[h] - Math.max(leftMin, lo) >= promDb) keep.push(h);
  }
  const out = [];
  for (const h of keep) {
    const last = out[out.length - 1];
    if (last !== undefined && (h - last) * 0.005 < minGapS) { if (env[h] > env[last]) out[out.length - 1] = h; }
    else out.push(h);
  }
  const t = out.map(h => h * 0.005), iv = t.slice(1).map((v, i) => v - t[i]).sort((p, q) => p - q);
  const dips = out.slice(1).map((h, i) => { let lo = Infinity; for (let k = out[i]; k <= h; k++) lo = Math.min(lo, env[k]); return Math.min(env[out[i]], env[h]) - lo; }).sort((p, q) => p - q);
  return {count: out.length, ratePerS: t.length > 1 ? r2((t.length - 1) / (t[t.length - 1] - t[0])) : null, medianIntervalS: iv.length ? r3(iv[iv.length >> 1]) : null,
    medianDipDb: dips.length ? r1(dips[dips.length >> 1]) : null, timesS: t.map(r3)};
}
/** Frequency (Hz) of the strongest spectral bin in [lo, hi] Hz over the STFT frames whose centre lies in [t0, t1] s. */
function dominantHz(m, sr, t0, t1, lo, hi) {
  const st = m._stft, acc = new Float64Array(st.N / 2 + 1);
  let used = 0;
  for (let f = 0; f < st.frames.length; f++) if (st.times[f] >= t0 && st.times[f] <= t1) { for (let k = 0; k < acc.length; k++) acc[k] += st.frames[f][k]; used++; }
  if (!used) return null;
  const binHz = sr / st.N;
  let best = 0, bk = 0;
  for (let k = Math.ceil(lo / binHz); k <= Math.floor(hi / binHz); k++) if (acc[k] > best) { best = acc[k]; bk = k; }
  return Math.round(bk * binHz);
}
/** Median YIN f0 (Hz) of the voiced, active frames whose centre lies in [t0, t1] s (null: fewer than six, i.e. under 70 ms of pitch). */
function medianF0(m, t0, t1) {
  const v = m._track.filter((p, i) => m._actMask[i] && p.f0 > 0 && p.ap <= 0.3 && p.t >= t0 && p.t <= t1).map(p => p.f0).sort((p, q) => p - q);
  return v.length >= 6 ? Math.round(v[v.length >> 1]) : null;
}
const semis = (f, ref) => 12 * Math.log2(f / ref);

/** Structural gate of a derivative per cue kind (NOT a listening test). Thresholds follow the cue definitions of the lane brief. */
function gate(kind, m, x, sr, edges) {
  const c = [];
  const req = (name, ok, value, need) => c.push({name, ok: !!ok, value, need});
  const b = m.spectral.bands, voiceBand = (b['300-1000Hz'] ?? 0) + (b['1000-3000Hz'] ?? 0) + (b['3000-8000Hz'] ?? 0);
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  const noiseWall = m.levelSpreadDb < 2 && m.spectral.flatness >= 0.35 && m.pitch.voicedFrac < 0.1;
  req('not a broadband noise wall', !noiseWall, {levelSpreadDb: m.levelSpreadDb, flatness: m.spectral.flatness, voicedFrac: m.pitch.voicedFrac}, 'NOT (spread < 2 dB AND flatness >= 0.35 AND voiced < 0.1)');
  req('no clipping, under the ceiling', m.clippedFrac < 1e-4 && m.peakDbfs <= PEAK_CEIL_DB + 0.1, {clippedFrac: m.clippedFrac, peakDbfs: m.peakDbfs}, `no clipped samples, peak <= ${PEAK_CEIL_DB} dBFS`);
  req('no DC', Math.abs(mean) <= 3e-3, +mean.toExponential(1), '|mean| <= 0.003');
  req('no click at the edges (faded to zero)', Math.abs(x[0]) < 1e-3 && Math.abs(x[x.length - 1]) < 1e-3, {first: +x[0].toExponential(1), last: +x[x.length - 1].toExponential(1)}, 'first / last sample ~ 0');
  req('voice band, not a hiss or a rumble', voiceBand >= 0.8 && m.spectral.flatness <= 0.3, {share300to8000Hz: r2(voiceBand), flatness: m.spectral.flatness}, '>= 80 % of the energy in 300-8000 Hz, flatness <= 0.3');
  const bu = bursts(x, sr), t6 = timeToWithin(x, sr, 6), dur = m.durationS;
  const extra = {timeToWithin6DbS: t6, bursts: bu.count, burstRatePerS: bu.ratePerS, burstDipDb: bu.medianDipDb};
  if (kind === 'cackle') {
    req('a long laugh (1.5-2.5 s)', dur >= 1.5 && dur <= 2.5, dur, '1.5-2.5 s');
    req('a train of discrete bursts at a laugh rate', bu.count >= 6 && bu.ratePerS >= 3 && bu.ratePerS <= 9 && bu.medianDipDb >= 10, {bursts: bu.count, ratePerS: bu.ratePerS, medianDipDb: bu.medianDipDb}, '>= 6 bursts at 3-9 per second, median dip between neighbours >= 10 dB');
    req('loud quickly (the tell)', t6 <= 0.2, t6, 'within 6 dB of its loudest 5 ms frame <= 0.2 s after the clip start');
    req('trails off', m.decay.lastMinusFirstDb <= -3, m.decay.lastMinusFirstDb, 'last quarter >= 3 dB under the first quarter');
    req('ends in silence', edges.endDb <= -24, edges.endDb, 'the cut end >= 24 dB under the take peak');
  } else if (kind === 'giggle') {
    req('short (0.7-1.5 s)', dur >= 0.7 && dur <= 1.5, dur, '0.7-1.5 s');
    req('a few discrete bursts at a laugh rate', bu.count >= 3 && bu.ratePerS >= 3 && bu.ratePerS <= 9 && bu.medianDipDb >= 10, {bursts: bu.count, ratePerS: bu.ratePerS, medianDipDb: bu.medianDipDb}, '>= 3 bursts at 3-9 per second, median dip >= 10 dB');
    req('pitched syllables in a small high voice', m.pitch.voicedFrac >= 0.2 && m.pitch.f0MedianHz >= 250 && m.pitch.f0MedianHz <= 800, {voicedFrac: m.pitch.voicedFrac, f0MedianHz: m.pitch.f0MedianHz}, 'voiced >= 0.2, median f0 250-800 Hz');
    req('soft, not shrill', m.spectral.centroidHz <= 1500, m.spectral.centroidHz, 'centroid <= 1.5 kHz');
    req('starts and ends in silence', edges.startDb <= -24 && edges.endDb <= -24, edges, 'both cuts >= 24 dB under the take peak');
  } else if (kind === 'pounce') {
    // 20 ms frames: when the clip first comes within 3 dB of its loudest 20 ms frame; the level of its first 0.3 s against its loudest 0.1 s
    const env20 = [...envelopeDb(x, sr, 0.02)], mx20 = Math.max(...env20), loudAtS = r2(env20.findIndex(e => e >= mx20 - 3) * 0.02);
    const pw = arr => 10 * Math.log10(arr.reduce((p, e) => p + Math.pow(10, e / 10), 0) / arr.length);
    let best = -Infinity;
    for (let i = 0; i + 5 <= env20.length; i++) best = Math.max(best, pw(env20.slice(i, i + 5)));
    const buildDb = r1(best - pw(env20.slice(0, 15))), t16 = timeToWithin(x, sr, 16);
    // the squeal's main partial (the strongest bin in 2-4.5 kHz): over the clip's first 0.15 s against the first 0.1 s of its loud part
    const f0 = dominantHz(m, sr, 0, 0.15, 2000, 4500), f1 = dominantHz(m, sr, loudAtS, loudAtS + 0.1, 2000, 4500), riseSt = f0 && f1 ? r1(semis(f1, f0)) : null;
    Object.assign(extra, {audibleWithinS: t16, loudAtS, buildDb, partialStartHz: f0, partialLoudHz: f1, riseSt});
    req('the wind-up and the leap (0.9-1.3 s)', dur >= 0.9 && dur <= 1.3, dur, '0.9-1.3 s');
    req('audible at once (the warning)', t16 <= 0.05, t16, 'within 16 dB of its loudest 5 ms frame <= 0.05 s after the clip start');
    req('loudest at the launch', loudAtS >= POUNCE_WINDUP_S - 0.15 && loudAtS <= POUNCE_WINDUP_S + 0.15, loudAtS, `first within 3 dB of its loudest 20 ms frame ${r2(POUNCE_WINDUP_S - 0.15)}-${r2(POUNCE_WINDUP_S + 0.15)} s after the clip start (the leap launches at ${POUNCE_WINDUP_S} s)`);
    req('builds', buildDb >= 6, buildDb, 'its loudest 0.1 s >= 6 dB over its first 0.3 s');
    req('a pitched, bright squeal that does not sink', m.pitch.voicedFrac >= 0.4 && riseSt !== null && riseSt >= -0.5 && m.spectral.centroidHz >= 2000, {voicedFrac: m.pitch.voicedFrac, riseSt, centroidHz: m.spectral.centroidHz}, 'voiced >= 0.4, centroid >= 2 kHz, its main partial (2-4.5 kHz) at the loud part not lower than at the clip start (>= -0.5 semitones; the measured rise is recorded as riseSt)');
    req('ends in silence', edges.endDb <= -24, edges.endDb, 'the cut end >= 24 dB under the take peak');
  } else if (kind === 'hurt') {
    req('short (0.2-0.6 s)', dur >= 0.2 && dur <= 0.6, dur, '0.2-0.6 s');
    req('fast attack', t6 <= 0.04, t6, 'within 6 dB of its loudest 5 ms frame <= 0.04 s after the clip start');
    req('one event', bu.count <= 2, bu.count, '<= 2 bursts');
    req('a bright squawk', m.spectral.centroidHz >= 2000, m.spectral.centroidHz, 'centroid >= 2 kHz');
    req('starts and ends in silence', edges.startDb <= -24 && edges.endDb <= -24, edges, 'both cuts >= 24 dB under the take peak');
  } else if (kind === 'death') {
    const third = dur / 3, fA = medianF0(m, 0, third), fB = medianF0(m, 2 * third, dur), pitchDropSt = fA && fB ? r1(semis(fB, fA)) : null;
    Object.assign(extra, {f0FirstThirdHz: fA, f0LastThirdHz: fB, pitchDropSt});
    req('short (0.7-1.3 s)', dur >= 0.7 && dur <= 1.3, dur, '0.7-1.3 s');
    req('a train of bursts', bu.count >= 4, bu.count, '>= 4 bursts');
    req('winds down', (pitchDropSt !== null && pitchDropSt <= -7) || m.decay.lastMinusFirstDb <= -4, {pitchDropSt, lastMinusFirstDb: m.decay.lastMinusFirstDb}, 'the pitch of its last third >= 7 semitones under its first third, OR its last quarter >= 4 dB under its first quarter');
    req('starts in silence', edges.startDb <= -24, edges.startDb, 'the cut start >= 24 dB under the take peak');
  } else throw new Error(`unknown gate ${kind}`);
  return {kind, pass: c.every(q => q.ok), failed: c.filter(q => !q.ok).map(q => q.name), ...extra, criteria: c};
}

const queueDoc = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')), queue = queueDoc.clips;
for (const c of queue) if (!PLAN[c.id] === !NOT_USED[c.id]) throw new Error(`${c.id}: must be either planned or recorded as not used`);
for (const id of [...Object.keys(PLAN), ...Object.keys(NOT_USED)]) if (!queue.some(c => c.id === id)) throw new Error(`${id}: not in the queue`);

const derivs = [], notUsed = [];
for (const c of queue) {
  const side = JSON.parse(fs.readFileSync(path.join(RAW, `${c.id}.sidecar.json`), 'utf8'));
  const rawBuf = fs.readFileSync(path.join(RAW, `${c.id}.wav`));
  if (sha(rawBuf) !== side.rawSha256) throw new Error(`${c.id}: raw sha mismatch`);
  if (side.request?.prompt !== c.prompt || side.request?.seed !== c.seed || side.request?.seconds !== c.seconds) throw new Error(`${c.id}: the lab's recorded request differs from the plan`);
  const jobId = side.job?.id ?? side.jobId ?? null;
  if (!/^\d{8}T\d{6}-\d+$/.test(String(jobId))) throw new Error(`${c.id}: no Sound Lab job id in the runner sidecar`);
  // public source record: hashes / ids / request numbers only — no prompt text, no private path or lab file name
  const source = {clip: c.id, jobId, seed: side.request.seed, seconds: side.request.seconds, steps: side.request.steps, cfg: side.request.cfg,
    rawSha256: side.rawSha256, rawBytes: side.rawBytes, labSidecarSha256: side.labSidecarSha256, promptSha256: sha(Buffer.from(side.request.prompt, 'utf8'))};
  if (NOT_USED[c.id]) { notUsed.push({cue: c.cue, ...source, ...NOT_USED[c.id]}); continue; }
  const w = readWav(rawBuf), sr = w.sampleRate;
  if (sr !== 44100) throw new Error(`${c.id}: sample rate ${sr} (the bank contract is 44.1 kHz)`);
  const mono = D.downmix(w.channels);
  let rawPk = 0;
  for (const v of mono) rawPk = Math.max(rawPk, Math.abs(v));
  for (const p of PLAN[c.id]) {
    if (p.cue !== c.cue) throw new Error(`${c.id}: planned for ${c.cue}, not ${p.cue}`);
    const A = Math.round(p.a * sr), B = Math.min(mono.length, Math.round(p.b * sr));
    // edge levels before the fades, re the take's peak sample (5 ms outside the cut + 0.5 ms inside it)
    const edge = (i, out) => { let e = 0; for (let k = Math.max(0, i - (out < 0 ? 220 : 22)); k < Math.min(mono.length, i + (out < 0 ? 22 : 220)); k++) e = Math.max(e, Math.abs(mono[k])); return r1(D.linToDb(e / rawPk)); };
    const chs = D.slice([Float64Array.from(mono)], A, B);
    let dc = 0;
    for (const v of chs[0]) dc += v;
    dc /= chs[0].length;
    for (let i = 0; i < chs[0].length; i++) chs[0][i] -= dc;
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    const g = D.normalisePeak(chs, PEAK_CEIL_DB);
    derivs.push({...p, take: c.id, source, sr, x: chs[0], edges: {startDb: edge(A, -1), endDb: edge(B, 1)},
      ops: ['mono', `remove DC (${dc.toExponential(1)})`, `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`, `peak ${PEAK_CEIL_DB} dBFS (${g.toFixed(1)} dB)`]});
  }
}

// the takes of a cue: the louder ones lowered to the quietest take's momentary-max loudness (variants sit at one level)
const byCue = new Map();
for (const d of derivs) { d.lufs = momentaryMax(d.x, d.sr); (byCue.get(d.cue) ?? byCue.set(d.cue, []).get(d.cue)).push(d); }
for (const list of byCue.values()) {
  const q = Math.min(...list.map(d => d.lufs));
  for (const d of list) if (d.lufs - q > 0.05) {
    const g = Math.pow(10, (q - d.lufs) / 20);
    for (let i = 0; i < d.x.length; i++) d.x[i] *= g;
    d.ops.push(`matched to the cue's quietest take (${(20 * Math.log10(g)).toFixed(1)} dB)`);
    d.lufs = momentaryMax(d.x, d.sr);
  }
}

// the mix: CUE_GAIN per cue from the matched takes' momentary-max loudness and the MIX target; references from the existing calibration
const t1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/audio-track1.json'), 'utf8')).mixCalibration;
const refOf = k => (t1.reference[k] ?? t1.new[k])?.mixMomentaryMaxLufs;
const references = Object.fromEntries(['zombieGroan', 'zombieDeath', 'zombieAttack', 'hurt', 'sirenScream', 'sirenHum'].map(k => [k, refOf(k)]));
for (const [k, v] of Object.entries(references)) if (!Number.isFinite(v)) throw new Error(`no calibration for the reference cue ${k}`);
const mix = {};
for (const cue of CUE_ORDER) {
  const list = byCue.get(cue);
  if (!list?.length) throw new Error(`cue ${cue} has no clip`);
  const measured = Math.max(...list.map(d => d.lufs)), T = MIX[cue];
  const gain = Math.min(1, r2(Math.pow(10, (T.targetLufs - measured) / 20)));
  let pk = 0;
  for (const d of list) for (const v of d.x) pk = Math.max(pk, Math.abs(v));
  mix[cue] = {basis: T.basis, why: T.why, targetLufs: T.targetLufs, measuredLufs: r1(measured), cueGain: gain, atSourceLufs: r1(measured + 20 * Math.log10(gain)),
    atSourcePeakDbfs: r1(D.linToDb(pk * gain)), vsReferenceLu: r1(measured + 20 * Math.log10(gain) - references[T.basis]), variants: list.length};
}

// structural record per derivative (NOT a listening test) + the gate
const files = [], prov = [], manifest = {}, qcInputs = [], gateFailures = [];
const count = new Map();
for (const cue of CUE_ORDER) for (const d of byCue.get(cue)) {
  const n = (count.get(d.cue) ?? 0) + 1;
  count.set(d.cue, n);
  const name = `${d.cue.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}-${String(n).padStart(2, '0')}`, url = `assets/audio/${name}.mp3`;
  const m = structure(d.x, d.sr), lu = loudness(d.x, d.sr), gt = gate(KIND[d.cue], m, d.x, d.sr, d.edges);
  if (!gt.pass) gateFailures.push(`${name} (${d.take}): structural gate '${gt.kind}' failed: ${JSON.stringify(gt.criteria.filter(q => !q.ok))}`);
  const kbps = KBPS[d.cue], mp3 = encodeMp3(d.x, d.sr, kbps), dur = +(d.x.length / d.sr).toFixed(4);
  const metrics = {...publicMetrics(m), loudness: {integratedLufs: lu.integratedLufs, momentaryMaxLufs: r1(d.lufs)}, edgesDb: d.edges};
  delete metrics.pitch?.segments;
  (manifest[d.cue] ??= []).push({url, dur, src: d.take});
  files.push({url, buf: mp3});
  prov.push({cue: d.cue, url, bytes: mp3.length, sha256: sha(mp3), dur, window: {startS: d.a, endS: d.b}, ops: [...d.ops, `mp3 mono ${kbps} kbps`], gate: gt, metrics, source: d.source});
  qcInputs.push({name, m, lu, gt});
}

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(9), p.url.padEnd(32), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', `M ${p.metrics.loudness.momentaryMaxLufs}`, `pk ${p.metrics.peakDbfs}`, `t6 ${p.gate.timeToWithin6DbS}`,
  `bursts ${p.gate.bursts}@${p.gate.burstRatePerS} dip ${p.gate.burstDipDb}`, `cen ${p.metrics.spectral.centroidHz}`, `flat ${p.metrics.spectral.flatness}`, `voiced ${p.metrics.pitch.voicedFrac}`, `f0 ${p.metrics.pitch.f0MedianHz}`,
  `l-f ${p.metrics.decay.lastMinusFirstDb}`, `edges ${p.metrics.edgesDb.startDb}/${p.metrics.edgesDb.endDb}`,
  p.gate.kind === 'pounce' ? `audible ${p.gate.audibleWithinS} loudAt ${p.gate.loudAtS} build ${p.gate.buildDb} rise ${p.gate.riseSt} st (${p.gate.partialStartHz}->${p.gate.partialLoudHz})` : p.gate.kind === 'death' ? `pitch ${p.gate.f0FirstThirdHz}->${p.gate.f0LastThirdHz} (${p.gate.pitchDropSt} st)` : '',
  p.gate.pass ? 'PASS' : 'FAIL');
for (const [c, m] of Object.entries(mix)) console.log('mix', c.padEnd(9), `measured ${m.measuredLufs} target ${m.targetLufs} gain ${m.cueGain} -> ${m.atSourceLufs} LUFS, peak ${m.atSourcePeakDbfs} dBFS (${m.vsReferenceLu >= 0 ? '+' : ''}${m.vsReferenceLu} LU vs ${m.basis} ${references[m.basis]})`);
const accepted = Object.keys(PLAN).length, rejectedN = notUsed.filter(q => q.kind === 'rejected').length, spareN = notUsed.filter(q => q.kind === 'spare').length;
console.log(`total ${total} bytes (cap ${BYTE_CAP}); ${queue.length} jobs; accepted ${accepted}, rejected ${rejectedN}, spare ${spareN}`);
for (const f of gateFailures) console.log('GATE FAIL', f);
if (total > BYTE_CAP) throw new Error(`new runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);

if (QC) {
  const {renderQc, stackPngs} = await import('./lib/qc-render.mjs');
  const dir = path.join(AUDIO, 'qc', 'built');
  fs.mkdirSync(dir, {recursive: true});
  const pngs = [];
  for (const q of qcInputs) {
    const f = path.join(dir, `${q.name}.png`);
    await renderQc(f, {title: q.name, label: 'shipped derivative (before MP3)', m: q.m, verdict: {kind: q.gt.kind, pass: q.gt.pass, failed: q.gt.failed}, lu: q.lu});
    pngs.push(f);
  }
  await stackPngs(pngs, path.join(dir, 'overview.png'));
  fs.writeFileSync(path.join(dir, 'derivatives-metrics.json'), JSON.stringify({mix, derivatives: prov}, null, 1) + '\n');
  console.log('qc:', pngs.length, 'images in', dir);
}
if (gateFailures.length) throw new Error(`${gateFailures.length} derivative(s) failed their structural gate (nothing written)`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/bb-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (lane AUDIO): BB's voice — the laugh set shared by all four
// looks: the cackle (it noticed the player), the quiet giggle, the rising pounce squeal, the hurt squawk, the wind-down death
// (audio/sfx.ts bbVoice, BB_AUDIO).

import type {ClipRef} from './manifest.generated';

/** This build's runtime cues, in decode-priority order (bank.ts CUES). */
export const BB_VOICE_CUES = [
${CUE_ORDER.map(c => `  '${c}',`).join('\n')}
] as const;
export type BbVoiceCue = (typeof BB_VOICE_CUES)[number];

export const CLIP_MANIFEST_BB: Readonly<Record<string, readonly ClipRef[]>> = {
${CUE_ORDER.map(cue => ` ${cue}: [\n${manifest[cue].map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/**
 * Mix gain per cue (sfx.ts CUE_GAIN carries the same numbers) = 10^((target - measured) / 20), capped at 1: the cue's momentary-max
 * loudness at the source against the existing calibration. Measured / target LUFS in the provenance (mixCalibration).
 */
export const BB_CUE_GAIN: Readonly<Record<BbVoiceCue, number>> = {
${CUE_ORDER.map(c => `  ${c}: ${mix[c].cueGain}, // ${mix[c].measuredLufs} -> ${mix[c].atSourceLufs} LUFS at the source (target ${mix[c].targetLufs}: ${mix[c].why})`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_BB: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_BB = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-bb-20261113', task: TASK, lane: 'AUDIO',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's audio authorization: the free local service inside the task, no fixed attempt cap, nothing paid or external; ${queue.length} jobs in bounded batches, each under its own durable POST cap — ${accepted} takes shipped, ${rejectedN} structurally rejected, ${spareN} usable spares not shipped)`,
  soundLab: {jobs: queue.length, accepted, rejected: rejectedN, spare: spareN, numericCap: null, paidOrExternal: 0},
  plannedBy: 'tools/audio-pipeline/bb-plan.py (ids, cues, durations, seeds; the prompt text stays with the private raw archive)',
  rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/bb-build.mjs',
  reuse: 'Checked first (audio/bank.ts): every enemy vocal in the bank is a groan, growl, snarl, hum, scream, shriek, wheeze or gurgle and the market voices are adult screams / grunts; nothing laughs. So the five cues were generated.',
  privacy: 'This public record names each raw take by its Sound Lab job id, seed and SHA-256 (raw take, lab sidecar, prompt). The prompt text, the raw takes and their paths stay in the private raw archive (independent backup), not in Git.',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (5 ms / 20 ms / 50 ms envelopes, laugh bursts — count, rate, dips —, time to the loud part, spectrogram images, spectral centroid / bands / flatness, strongest partial, YIN voicing and pitch, peak, DC, slice-edge levels, BS.1770 loudness). `metrics` / `gate` describe signal structure only, never how a clip sounds: whether a burst train reads as a laugh, and as an eerie one, needs an ear. The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  design: {
    bbCackle: 'Four takes of two requests. Takes 01-03 are one request with three seeds — one family: ten bursts in 1.8 s at about 5.6 per second that get quieter, pitched syllables at 520-780 Hz under bright breath noise, almost the same rhythm in all three. Take 04 is the other request: twelve bursts in 2 s whose pitch steps down.',
    bbGiggle: 'Four takes (two requests x two seeds): 4-6 voiced syllables each (median f0 about 380-480 Hz) inside 0.7-1.0 s; the third keeps two quieter trailing syllables.',
    bbPounce: `Three takes of one request: one continuous squeal (main partial 3.1-3.3 kHz). Each clip starts inside the squeal's steady early part (already sounding at the first frame) and steps up about 10 dB to its loudest part about 0.5 s later — the cue is started with the ${POUNCE_WINDUP_S} s wind-up tell, so the loud part meets the launch. The build is mostly one of level: the main partial drifts up only 1.5-3 semitones into the loud part (gate.riseSt). Two end with a second short squeal after a 0.1 s gap; the third holds its loud part.`,
    bbHurt: 'Three takes of two requests: the first squawk of each take (0.2-0.26 s, a 15-25 ms attack, noisy with a partial near 1.15 kHz). They are shorter than the 0.3-0.6 s first asked for: the takes hold a second, separate steady squeak 0.13-0.15 s later, which is left out.',
    bbDeath: 'Two takes of two requests: voiced laugh syllables whose pitch steps down by more than an octave (ended by a fade inside the last low syllable), and a pulse train at one pitch whose bursts get about 10 dB quieter and lose their voicing (it winds down by level, not by pitch). A first wording returned only unvoiced ratchet clicks and was rejected.',
    tone: 'Asked for as a creepy doll / haunted-nursery laugh. Hurt and death were asked for, and structurally read, as toy- and creature-like sounds (a squawk, a laugh running down), not as a crying or suffering child.'},
  loudness: {method: 'ITU-R BS.1770-4 K-weighting, 400 ms blocks / 75 % overlap (one-shots zero-padded to one block), maximum momentary loudness, mono; sample peak (no true-peak oversampling)'},
  mixCalibration: {note: 'CUE_GAIN (audio/sfx.ts; the same numbers as BB_CUE_GAIN in the generated manifest) per cue = 10^((target - measured) / 20), capped at 1 (no boost): the target is the cue\'s momentary-max loudness AT THE SOURCE (derivative x CUE_GAIN, before distance / occlusion / master), set against the existing cues\' calibration (derivatives/audio-track1.json mixCalibration). Never above the -1 dBFS ceiling. First estimates for the ear pass (not auditioned).',
    references, cues: mix, pounceWindupS: POUNCE_WINDUP_S},
  derivatives: prov, notUsedRaws: notUsed};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=|reference\/|\.wav|TrackType).{0,20}/i); if (hit) throw new Error(`URL / private path / prompt-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: this set's sentence (rewritten in place between its fixed head and tail; first added at the end of the per-set list)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
{
  const head = 'the BB voice set (', tail = '): ../derivatives/audio-bb.json';
  const sentence = `${head}cackle, giggle, pounce squeal, hurt squawk, wind-down death,\nbb-*.mp3; seeds and hashes only, the prompts stay with the private raw takes${tail}`;
  const i0 = notice.indexOf(head), i1 = notice.indexOf(tail);
  if (i0 >= 0 && i1 > i0) notice = notice.slice(0, i0) + sentence + notice.slice(i1 + tail.length);
  else {
    const anchor = '.json).\n\nPowered by Stability AI.';
    if (notice.split(anchor).length !== 2) throw new Error('NOTICE.md: expected sentence anchor not found');
    notice = notice.replace(anchor, `.json; ${sentence}).\n\nPowered by Stability AI.`);
  }
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild; other lanes' blocks are never touched)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN bb-audio-20261113 (bb-build.mjs) -->', E = '<!-- END bb-audio-20261113 -->';
const block = `${B}
## BB audio (cackle, giggle, pounce squeal, hurt squawk, wind-down death)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the BB task's
audio authorization (the free local service only; ${queue.length} jobs, ${accepted} takes shipped). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by \`tools/audio-pipeline/bb-build.mjs\` (provenance: \`assets/derivatives/audio-bb.json\`). Not
reviewed by ear on the build worker. Raw takes are kept outside Git.

${prov.map(p => `- \`${p.url}\` — ${p.cue} (Sound Lab job ${p.source.jobId})`).join('\n')}
${E}`;
const i0 = credits.indexOf(B), i1 = credits.indexOf(E);
credits = i0 >= 0 && i1 > i0 ? credits.slice(0, i0) + block + credits.slice(i1 + E.length) : credits.replace(/\n*$/, '\n\n') + block + '\n';
fs.writeFileSync(creditsPath, credits);

// the release allowlist: only this set's paths (+ the two shared documents it edited); every other entry is kept as it is
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
const mine = new Set([...files.map(f => f.url), PROV_REL, NOTICE_REL, CREDITS_REL]);
const add = [...mine].map(p => { const b = fs.readFileSync(path.join(ROOT, 'game/public', p)); return {path: p, bytes: b.length, sha256: sha(b)}; });
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log('wrote', files.length, 'clips +', path.relative(ROOT, MANIFEST_TS), PROV_REL, NOTICE_REL, CREDITS_REL);
