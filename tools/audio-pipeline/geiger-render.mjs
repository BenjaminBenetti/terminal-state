// Task studio-reactor-glowing-zombies-20261115-013245-01 (lane AUDIO): OFFLINE, deterministic procedural synthesis of the Geiger-counter
// tick set heard near the Reactor's irradiated zombies. The user authorized "free local Sound Lab or procedural audio ... for Geiger
// clicks" (no paid generation; private masters / provenance outside Git; ship only normal cooked runtime assets). This script is the
// masters' generator. It runs on a build machine only, never in the game: the game plays the cooked MP3 derivatives
// (tools/audio-pipeline/geiger-build.mjs) through the ordinary clip bank (game/src/audio/bank.ts), and the runtime stays clip-only.
//
// Physical model of ONE discharge:
//  - excitation: the GM tube's avalanche makes a short current pulse (0.1-0.4 ms). The driver stage AC-couples it into a small
//    piezo / speaker, which sees the pulse's rising edge, its falling edge (opposite sign, a little weaker) and the coupling capacitor's
//    slow recovery. The recovery carries the remaining area, so the excitation sums to exactly zero (no DC). A little seeded avalanche
//    noise rides on the pulse (Hann-windowed, mean removed).
//  - resonator bank (RBJ constant-peak band-pass biquads, which have zeros at DC and Nyquist): the piezo / cone (~3.2 kHz, Q 6-10), a
//    faint upper piezo mode (~6.6 kHz), the housing (~1.15 kHz, Q 2-4) and a faint low body thump (~200 Hz, Q 0.6-0.8: ~3 ms), plus a
//    little of the edge itself, all through a small-speaker low-pass (8.5-10.5 kHz).
//  - each discharge is windowed to exact silence between WINDOW.fromMs and WINDOW.toMs after its onset. Its ringing is already below
//    -60 dB before WINDOW.fromMs (recorded per take in the sidecar's analysis), so the window only guarantees the end.
// Per take (seeded, small): resonances +-8 %, Q, mode levels, pulse width (~0.18 ms +-20 %) / edge length / fall ratio / recovery /
// noise. SINGLE takes have one
// discharge. CLUSTER takes have 2-4 discharges 6-35 ms apart with slightly varied amplitudes (the high count rates). Each mode level is a
// peak level relative to the piezo mode for the NOMINAL excitation, so a take's own excitation still shifts the balance.
//
// Output (the external raw-asset mount, NOT Git): <reference>/tasks/reactor-glowing-zombies-20261115-013245/audio/raw/<id>.wav (mono,
// 48 kHz, 16-bit PCM, peak -3 dBFS) + <id>.json (seed, params, sha256, sample rate, length, analysis) + index.json. A re-run is
// byte-identical. An existing master is never overwritten: identical bytes are a no-op, different bytes stop the run (a changed model
// needs new take ids, and older masters are kept).
// Usage: node tools/audio-pipeline/geiger-render.mjs [--reference <reference mount dir>]
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeWav, readWav} from './lib/wav.mjs';

export const RENDERER = 'tools/audio-pipeline/geiger-render.mjs';
export const RENDERER_VERSION = 1;
export const TASK = 'reactor-glowing-zombies-20261115-013245';
export const SR = 48000;
/** Master peak before 16-bit quantisation (the build re-normalises its derivative). */
export const MASTER_PEAK_DBFS = -3;
/** Silence before the first discharge (room for the build's resampler) and after the last discharge's window. */
export const LEAD_MS = 3, TAIL_MS = 30;
/** Per-discharge window: 1 until fromMs, cosine to exactly 0 at toMs (after the discharge onset). */
export const WINDOW = {fromMs: 11, toMs: 17};
/** Nominal model; `var` = the +- fraction a take's resonance frequency may move. Ranges are [min, max] (uniform, seeded). */
export const MODEL = {
  modes: [
    {name: 'piezo', f: 3200, var: 0.08, q: [7, 9.5], levelDb: [0, 0]},
    {name: 'piezoUpper', f: 6600, var: 0.08, q: [10, 13], levelDb: [-16, -12]},
    {name: 'housing', f: 1150, var: 0.08, q: [2.5, 3.5], levelDb: [-8, -5]},
    {name: 'body', f: 200, var: 0.08, q: [0.6, 0.8], levelDb: [-14, -10]},
  ],
  directLevelDb: [-13, -10],
  speakerLowpassHz: [8500, 10500],
  // One detector: its GM pulse (the model's physical range is 0.1-0.4 ms) sits at ~0.18 ms and varies only a little per take. (A wide
  // spread would move the edge pair's spectral notch, 1 / width, onto the piezo resonance and turn some ticks into housing "tocks".)
  excitation: {widthMs: [0.15, 0.22], edgeMs: [0.035, 0.055], fallRel: [0.7, 0.85], recoveryMs: [0.35, 0.6], noiseMix: [0.08, 0.22]},
  nominalExcitation: {widthMs: 0.18, edgeMs: 0.045, fallRel: 0.78, recoveryMs: 0.45, noiseMix: 0},
  cluster: {gapMs: [6, 35], amp: [0.75, 1]},
};
/** The takes: 6 single discharges, 3 clusters (2, 3, 4 discharges). Seeds are fixed. */
export const TAKES = [
  {id: 'geiger-click-01', cue: 'geigerClick', seed: 15110101, discharges: 1},
  {id: 'geiger-click-02', cue: 'geigerClick', seed: 15110102, discharges: 1},
  {id: 'geiger-click-03', cue: 'geigerClick', seed: 15110103, discharges: 1},
  {id: 'geiger-click-04', cue: 'geigerClick', seed: 15110104, discharges: 1},
  {id: 'geiger-click-05', cue: 'geigerClick', seed: 15110105, discharges: 1},
  {id: 'geiger-click-06', cue: 'geigerClick', seed: 15110106, discharges: 1},
  {id: 'geiger-cluster-01', cue: 'geigerCluster', seed: 15110201, discharges: 2},
  {id: 'geiger-cluster-02', cue: 'geigerCluster', seed: 15110202, discharges: 3},
  {id: 'geiger-cluster-03', cue: 'geigerCluster', seed: 15110203, discharges: 4},
];

const sha256 = b => createHash('sha256').update(b).digest('hex');
const r4 = v => +v.toFixed(4);
const dbToLin = db => Math.pow(10, db / 20);
const linToDb = v => 20 * Math.log10(Math.max(1e-12, v));

/** mulberry32 (a small, fixed PRNG; 32-bit integer math only, deterministic across platforms), its seed first scrambled by the murmur3
 *  finaliser so neighbouring seeds give unrelated streams. */
export function rng32(seed) {
  let a = seed >>> 0;
  a = Math.imul(a ^ (a >>> 16), 0x85ebca6b) >>> 0;
  a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35) >>> 0;
  a = (a ^ (a >>> 16)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uni = (rnd, [a, b]) => a + (b - a) * rnd();

/** RBJ biquad coefficients (normalised by a0). */
function bandpass(f, q, sr) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return {b: [al / a0, 0, -al / a0], a: [-2 * Math.cos(w) / a0, (1 - al) / a0]};
}
function lowpass(f, q, sr) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  return {b: [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0], a: [-2 * c / a0, (1 - al) / a0]};
}
function biquad(x, {b, a}) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const peakAbs = x => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; };

/**
 * One discharge's excitation (length n samples): +edge at 0, -fallRel x edge at the pulse width, Hann-windowed mean-free avalanche noise
 * over the pulse, and the coupling recovery (an exponential carrying the remaining area) — sums to exactly zero.
 */
function excitation(e, n, sr, rnd) {
  const x = new Float64Array(n);
  const E = Math.max(2, Math.round(e.edgeMs / 1000 * sr)), W = Math.max(1, Math.round(e.widthMs / 1000 * sr));
  const edge = Array.from({length: E}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / E));
  for (let i = 0; i < E; i++) { x[i] += edge[i]; x[W + i] -= e.fallRel * edge[i]; }
  if (e.noiseMix > 0) {
    const L = W + E, w = Array.from({length: L}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / L));
    const nz = w.map(wi => (rnd() * 2 - 1) * wi);
    const m = nz.reduce((p, q) => p + q, 0) / w.reduce((p, q) => p + q, 0);
    for (let i = 0; i < L; i++) x[i] += e.noiseMix * (nz[i] - m * w[i]);
  }
  let area = 0;
  for (const v of x) area += v;
  const tau = e.recoveryMs / 1000 * sr, start = W + E, R = Math.min(n - start, Math.ceil(tau * 7));
  let rs = 0;
  const rec = Array.from({length: R}, (_, j) => { const v = Math.exp(-j / tau); rs += v; return v; });
  for (let j = 0; j < R; j++) x[start + j] -= area * rec[j] / rs;
  return x;
}

/** Draw a take's parameters from its seed (fixed draw order: modes, direct, lowpass, then per discharge). */
export function takeParams(take) {
  const rnd = rng32(take.seed);
  const modes = MODEL.modes.map(m => ({name: m.name, f: r4(m.f * (1 + (rnd() * 2 - 1) * m.var)), q: r4(uni(rnd, m.q)), levelDb: r4(uni(rnd, m.levelDb))}));
  const directLevelDb = r4(uni(rnd, MODEL.directLevelDb)), speakerLowpassHz = r4(uni(rnd, MODEL.speakerLowpassHz));
  const X = MODEL.excitation, discharges = [];
  let at = 0;
  for (let k = 0; k < take.discharges; k++) {
    if (k > 0) at = r4(at + uni(rnd, MODEL.cluster.gapMs));
    discharges.push({atMs: at, amp: take.discharges > 1 ? r4(uni(rnd, MODEL.cluster.amp)) : 1, widthMs: r4(uni(rnd, X.widthMs)), edgeMs: r4(uni(rnd, X.edgeMs)),
      fallRel: r4(uni(rnd, X.fallRel)), recoveryMs: r4(uni(rnd, X.recoveryMs)), noiseMix: r4(uni(rnd, X.noiseMix)), noiseSeed: (rnd() * 4294967296) >>> 0});
  }
  return {modes, directLevelDb, speakerLowpassHz, discharges};
}

/** One discharge rendered and windowed (Float64Array of WINDOW.toMs). */
function renderDischarge(p, d, sr) {
  const n = Math.round(WINDOW.toMs / 1000 * sr), n0 = Math.round(WINDOW.fromMs / 1000 * sr);
  const ref = excitation(MODEL.nominalExcitation, n, sr, null), exc = excitation(d, n, sr, rng32(d.noiseSeed));
  const y = new Float64Array(n);
  const add = (resp, refPeak, levelDb) => { const g = dbToLin(levelDb) / refPeak; for (let i = 0; i < n; i++) y[i] += g * resp[i]; };
  for (const m of p.modes) {
    const co = bandpass(m.f, m.q, sr);
    add(biquad(exc, co), peakAbs(biquad(ref, co)), m.levelDb);
  }
  add(exc, peakAbs(ref), p.directLevelDb);
  const out = biquad(y, lowpass(p.speakerLowpassHz, Math.SQRT1_2, sr));
  for (let i = n0; i < n; i++) out[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - n0) / (n - n0));
  for (let i = 0; i < n; i++) out[i] *= d.amp;
  return out;
}

/** The take as float samples at SR, peak MASTER_PEAK_DBFS, plus its parameters. */
export function renderTake(take, sr = SR) {
  const p = takeParams(take), last = p.discharges[p.discharges.length - 1];
  const lead = Math.round(LEAD_MS / 1000 * sr), len = lead + Math.round((last.atMs + WINDOW.toMs + TAIL_MS) / 1000 * sr);
  const x = new Float64Array(len);
  for (const d of p.discharges) {
    const y = renderDischarge(p, d, sr), o = lead + Math.round(d.atMs / 1000 * sr);
    for (let i = 0; i < y.length; i++) x[o + i] += y[i];
  }
  const g = dbToLin(MASTER_PEAK_DBFS) / peakAbs(x);
  for (let i = 0; i < len; i++) x[i] *= g;
  return {params: p, samples: Float32Array.from(x), onsets: p.discharges.map(d => lead + Math.round(d.atMs / 1000 * sr))};
}

/** The 16-bit WAV master bytes of a take (deterministic). */
export function masterBytes(take) {
  const r = renderTake(take);
  return {...r, wav: writeWav([r.samples], SR)};
}

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const cr = Math.cos(ang * k), ci = Math.sin(ang * k), a = i + k, b = a + len / 2;
      const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}

/**
 * Structural analysis of a click take (no listening): peak (dBFS), DC mean, energy-weighted spectral centroid, strongest spectral
 * peak, band energy shares, and the decay of the LAST discharge from its own peak to -40 / -60 dB (re that peak) and to -60 dB re
 * the take's peak (ms; the last sample whose magnitude reaches the threshold). Rectangular FFT window: the take starts and ends in
 * silence, so the whole click is in the frame.
 */
export function analyseClick(x, sr, lastOnset) {
  let pk = 0, dc = 0;
  for (const v of x) { pk = Math.max(pk, Math.abs(v)); dc += v; }
  dc /= x.length;
  let lp = lastOnset, lpk = 0;
  for (let i = lastOnset; i < Math.min(x.length, lastOnset + Math.round(0.004 * sr)); i++) if (Math.abs(x[i]) > lpk) { lpk = Math.abs(x[i]); lp = i; }
  const lastAbove = thr => { let l = lp; for (let i = lp; i < x.length; i++) if (Math.abs(x[i]) >= thr) l = i; return l; };
  const ms = i => +((i - lp) / sr * 1000).toFixed(2);
  let N = 1;
  while (N < x.length) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(x);
  fft(re, im);
  let num = 0, den = 0, best = 0, bestK = 0;
  const bands = [[0, 400], [400, 2000], [2000, 5000], [5000, sr / 2]], be = [0, 0, 0, 0];
  for (let k = 1; k < N / 2; k++) {
    const f = k * sr / N, m = re[k] * re[k] + im[k] * im[k];
    num += f * m; den += m;
    if (m > best) { best = m; bestK = k; }
    for (let b = 0; b < 4; b++) if (f >= bands[b][0] && f < bands[b][1]) be[b] += m;
  }
  const tot = be.reduce((p, q) => p + q, 0) || 1;
  return {
    peakDbfs: +linToDb(pk).toFixed(2), dcMean: +dc.toExponential(2),
    decayTo40DbMs: ms(lastAbove(lpk * dbToLin(-40))), decayTo60DbMs: ms(lastAbove(lpk * dbToLin(-60))), decayTo60DbReTakePeakMs: ms(lastAbove(pk * dbToLin(-60))),
    centroidHz: Math.round(num / den), spectralPeakHz: Math.round(bestK * sr / N),
    bandShares: {below400: +(be[0] / tot).toFixed(3), from400to2k: +(be[1] / tot).toFixed(3), from2kto5k: +(be[2] / tot).toFixed(3), above5k: +(be[3] / tot).toFixed(3)},
  };
}

export function rawDirFor(reference) { return path.join(reference, 'tasks', TASK, 'audio', 'raw'); }

function main() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const ai = process.argv.indexOf('--reference');
  const reference = ai > 0 ? path.resolve(process.argv[ai + 1]) : path.join(ROOT, 'reference');
  if (!fs.existsSync(path.join(reference, 'tasks', TASK))) throw new Error(`no task folder ${path.join(reference, 'tasks', TASK)} (pass --reference <the raw-asset mount>)`);
  const dir = rawDirFor(reference);
  fs.mkdirSync(dir, {recursive: true});
  const index = {task: TASK, renderer: RENDERER, rendererVersion: RENDERER_VERSION, sampleRate: SR, bits: 16, channels: 1, model: MODEL, window: WINDOW, leadMs: LEAD_MS, tailMs: TAIL_MS,
    masterPeakDbfs: MASTER_PEAK_DBFS, procedural: true, auditioned: false, note: 'Procedural masters rendered offline by the repository\'s own script (no Sound Lab, no model, no third-party or stock audio). Not listened to on the worker: structural analysis only.', takes: []};
  for (const take of TAKES) {
    const {params, samples, onsets, wav} = masterBytes(take);
    const hash = sha256(wav), wavPath = path.join(dir, `${take.id}.wav`);
    let state = 'written';
    if (fs.existsSync(wavPath)) {
      if (sha256(fs.readFileSync(wavPath)) !== hash) throw new Error(`${take.id}: an existing master differs from this render — never overwritten; use a new take id`);
      state = 'unchanged';
    } else fs.writeFileSync(wavPath, wav);
    const back = readWav(fs.readFileSync(wavPath));
    const analysis = analyseClick(back.channels[0], SR, onsets[onsets.length - 1]);
    if (analysis.peakDbfs > -0.5) throw new Error(`${take.id}: master too hot`);
    const side = {id: take.id, cue: take.cue, task: TASK, renderer: RENDERER, rendererVersion: RENDERER_VERSION, seed: take.seed, discharges: take.discharges, params,
      sampleRate: SR, bits: 16, channels: 1, samples: samples.length, durationS: +(samples.length / SR).toFixed(5), sha256: hash, bytes: wav.length,
      onsetSamples: onsets, analysis, auditioned: false};
    fs.writeFileSync(path.join(dir, `${take.id}.json`), JSON.stringify(side, null, 1) + '\n');
    index.takes.push({id: take.id, cue: take.cue, seed: take.seed, discharges: take.discharges, sha256: hash, bytes: wav.length, durationS: side.durationS});
    console.log(`${take.id} ${state} ${side.durationS}s ${wav.length}B peak ${analysis.peakDbfs} dc ${analysis.dcMean} -40dB ${analysis.decayTo40DbMs}ms -60dB ${analysis.decayTo60DbMs}ms centroid ${analysis.centroidHz}Hz peakHz ${analysis.spectralPeakHz} bands ${JSON.stringify(analysis.bandShares)}`);
  }
  const ip = path.join(dir, 'index.json'), txt = JSON.stringify(index, null, 1) + '\n';
  if (fs.existsSync(ip) && fs.readFileSync(ip, 'utf8') !== txt) throw new Error('index.json differs from this render — never overwritten');
  fs.writeFileSync(ip, txt);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
