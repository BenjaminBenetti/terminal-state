// Task studio-reactor-glowing-zombies-20261115-013245-01 (lane AUDIO): runtime derivatives of the PROCEDURAL Geiger-counter tick masters
// (tools/audio-pipeline/geiger-render.mjs; the user authorized procedural audio for the Geiger clicks, no paid generation). Reads
// <reference>/tasks/reactor-glowing-zombies-20261115-013245/audio/raw/<id>.wav, verifies each against its sidecar's SHA-256 AND
// re-renders it from its seed (the bytes must match: the masters are reproducible from the committed script), and writes
// game/public/assets/audio/geiger-*.mp3, game/src/audio/manifest.geiger.generated.ts and game/public/assets/derivatives/audio-geiger.json.
// Ops (processing only, no new sound): 48 -> 44.1 kHz Kaiser-windowed sinc resample (the bank's MP3s are 44.1 kHz), trim to 0.25 ms before
// the onset (a 0.25 ms cosine fade-in over that near-silent lead, so the tick's attack stays sharp) through the discharge window / the
// -80 dB point + 2 ms, peak-normalise to -1 dBFS, a 3 ms silent tail, MP3 (lamejs, mono, 128 kbps; the encoder's constant priming delay
// is skipped by the bank's leadOffset). The provenance records a STRUCTURAL analysis of every take (peak, decay to -40 / -60 dB, spectral
// centroid / peak, band shares, discharges found) and the mix calibration against the UI click / heartbeat / hit tick (their raws,
// rebuilt from their recorded ops). Nobody listened to these clips on the worker.
// Usage: node tools/audio-pipeline/geiger-build.mjs [--reference <reference mount dir>]
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {loudness} from './lib/structural.mjs';
import {MODEL, RENDERER, RENDERER_VERSION, SR as MASTER_SR, TAKES, TASK, WINDOW, analyseClick, masterBytes, rawDirFor} from './geiger-render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ai = process.argv.indexOf('--reference');
const REFERENCE = ai > 0 ? path.resolve(process.argv[ai + 1]) : path.join(ROOT, 'reference');
const RAW = rawDirFor(REFERENCE);
const OUT_DIR = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.geiger.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-geiger.json');
const sha256 = b => createHash('sha256').update(b).digest('hex');
const LAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;
const SR = 44100;
const RECIPE = {onsetDb: -50, leadMs: 0.25, endDb: -80, holdMs: 2, tailMs: 3, peakDbfs: -1, kbps: 128, resample: {halfTaps: 32, kaiserBeta: 8.6, cutoffReNyquist: 0.9}};
const CUES = ['geigerClick', 'geigerCluster'];
/**
 * Mix calibration (structural, NOT an audition): the loudest 400 ms K-weighted window (BS.1770 momentary; each clip zero-padded to
 * 400 ms, so a short clip's level is its energy over that window) of each reference AT ITS GAME GAIN, from its raw rebuilt with its
 * recorded ops. The game gains are audio/sfx.ts's at build time (tests/geiger-audio.test.ts checks they still match). A single tick at
 * k = 1 sits at the flashlight click's level (TARGET_RE_CLICK_LU 0), under the heartbeat; k = 0 is 0.55 x of that (-5.2 dB), so the
 * radius edge stays a soft tick. Ticks come in streams: several inside 400 ms sum over one click (the caller's rate decides how
 * prominent the counter gets). The cluster cue keeps the same per-tick gain.
 */
const TARGET_RE_CLICK_LU = 0;
const REFERENCES = [
  {key: 'click', cue: 'click', gain: 0.3, prov: 'audio-iteration05.json', urls: ['assets/audio/flashlight-click-01.mp3', 'assets/audio/flashlight-click-02.mp3'], note: 'Sfx.click(): the flashlight switch click, CUE_GAIN.click 0.3'},
  {key: 'heartbeatMax', cue: 'heartbeat', gain: 0.4, lowpassHz: 900, prov: 'audio-iteration05.json', urls: ['assets/audio/heartbeat-01-s01.mp3', 'assets/audio/heartbeat-01-s02.mp3', 'assets/audio/heartbeat-01-s03.mp3', 'assets/audio/heartbeat-01-s04.mp3'], note: 'Sfx.vitals() heartbeat at its strongest (CUE_GAIN 0.4 x voice gain 1, 900 Hz low-pass)'},
  {key: 'heartbeatMin', cue: 'heartbeat', gain: 0.2, lowpassHz: 900, prov: 'audio-iteration05.json', urls: ['assets/audio/heartbeat-01-s01.mp3', 'assets/audio/heartbeat-01-s02.mp3', 'assets/audio/heartbeat-01-s03.mp3', 'assets/audio/heartbeat-01-s04.mp3'], note: 'the heartbeat at its softest (voice gain 0.5)'},
  {key: 'hitTick', cue: 'hitTick', gain: 0.22, prov: 'audio-iteration05.json', urls: ['assets/audio/hit-tick-01.mp3', 'assets/audio/hit-tick-02.mp3'], note: 'Sfx.hitTick(false), CUE_GAIN.hitTick 0.22'},
];
const r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3);

function besselI0(x) {
  let s = 1, t = 1;
  for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-14 * s) break; }
  return s;
}
/** Band-limited resampling: Kaiser-windowed sinc (linear phase), cutoff = cutoffReNyquist x the lower Nyquist. */
function resample(x, from, to, {halfTaps, kaiserBeta, cutoffReNyquist}) {
  const step = from / to, fc = cutoffReNyquist * Math.min(1, to / from) / 2, i0 = besselI0(kaiserBeta);
  const n = Math.floor(x.length / step), y = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const t = j * step, c = Math.floor(t);
    let s = 0;
    for (let k = c - halfTaps + 1; k <= c + halfTaps; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = t - k, u = d / halfTaps;
      if (Math.abs(u) >= 1) continue;
      const w = besselI0(kaiserBeta * Math.sqrt(1 - u * u)) / i0, a = 2 * Math.PI * fc * d;
      s += x[k] * 2 * fc * (d === 0 ? 1 : Math.sin(a) / a) * w;
    }
    y[j] = s;
  }
  return y;
}

/** RBJ low-pass (the playClip filter: Q 0.7) for the heartbeat reference. */
function lowpass(x, f, q, sr) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
  const b = [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0], a = [-2 * c / a0, (1 - al) / a0], y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

/** Loudest 400 ms K-weighted window (LUFS) of x x gain, zero-padded to >= 400 ms. */
function momentary(x, sr, gain = 1) {
  const n = Math.max(x.length, Math.round(0.4 * sr)), y = new Float32Array(n);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * gain;
  return loudness(y, sr).momentaryMaxLufs;
}

/** Discharges found structurally: 0.25 ms RMS envelope maxima >= -12 dB re its peak, with a >= 15 dB dip between neighbours. */
function discharges(x, sr) {
  const hop = Math.max(1, Math.round(sr * 0.00025)), env = D.envelope(x, hop);
  let pk = 0;
  for (const e of env) pk = Math.max(pk, e);
  const ev = [];
  for (let h = 1; h + 1 < env.length; h++) {
    if (!(env[h] >= pk * D.dbToLin(-12) && env[h] >= env[h - 1] && env[h] > env[h + 1])) continue;
    const prev = ev[ev.length - 1];
    if (prev === undefined) { ev.push(h); continue; }
    let dip = Infinity;
    for (let i = prev; i <= h; i++) dip = Math.min(dip, env[i]);
    if (dip < Math.min(env[prev], env[h]) * D.dbToLin(-15)) ev.push(h); // a new discharge
    else if (env[h] > env[prev]) ev[ev.length - 1] = h; // the same one, its louder maximum
  }
  return ev.map(h => h * hop);
}

function encode(ch, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(ch), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}
/** MPEG-1 Layer III frame walk (no decoding): frames, sample rate, samples. Throws on a broken chain. */
function mp3Frames(b) {
  const BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], SRS = [44100, 48000, 32000];
  let off = 0, frames = 0, sampleRate = 0, samples = 0;
  if (b.toString('ascii', 0, 3) === 'ID3') off = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff || (b[off + 1] & 0xe0) !== 0xe0) throw new Error(`lost frame sync at byte ${off}`);
    const ver = (b[off + 1] >> 3) & 3, layer = (b[off + 1] >> 1) & 3, bri = b[off + 2] >> 4, sri = (b[off + 2] >> 2) & 3, pad = (b[off + 2] >> 1) & 1;
    if (ver !== 3 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) throw new Error(`not an MPEG-1 Layer III frame at ${off}`);
    sampleRate = SRS[sri]; samples += 1152; frames++;
    off += Math.floor(144 * BR[bri] * 1000 / sampleRate) + pad;
  }
  return {frames, sampleRate, samples};
}

// --- the takes ---------------------------------------------------------------------------------------------------------------------
if (!fs.existsSync(RAW)) throw new Error(`no raw folder ${RAW} (run tools/audio-pipeline/geiger-render.mjs, or pass --reference <the raw-asset mount>)`);
const index = JSON.parse(fs.readFileSync(path.join(RAW, 'index.json'), 'utf8'));
if (index.renderer !== RENDERER || index.rendererVersion !== RENDERER_VERSION) throw new Error('index.json names another renderer / version');
const manifest = Object.fromEntries(CUES.map(c => [c, []])), derivs = [], levels = Object.fromEntries(CUES.map(c => [c, []]));
for (const take of TAKES) {
  const entry = index.takes.find(t => t.id === take.id);
  if (!entry) throw new Error(`${take.id}: not in index.json`);
  const raw = fs.readFileSync(path.join(RAW, `${take.id}.wav`)), side = JSON.parse(fs.readFileSync(path.join(RAW, `${take.id}.json`), 'utf8'));
  const rawSha = sha256(raw);
  if (rawSha !== side.sha256 || rawSha !== entry.sha256) throw new Error(`${take.id}: raw SHA-256 mismatch (sidecar / index)`);
  if (side.seed !== take.seed || side.discharges !== take.discharges) throw new Error(`${take.id}: sidecar seed / discharges differ from the renderer's TAKES`);
  const again = masterBytes(take);
  if (sha256(again.wav) !== rawSha) throw new Error(`${take.id}: re-rendering from seed ${take.seed} does not reproduce the master (the renderer changed: new take ids needed)`);
  const w = readWav(raw);
  if (w.sampleRate !== MASTER_SR || w.channels.length !== 1) throw new Error(`${take.id}: expected a mono ${MASTER_SR} Hz master`);
  const x = resample(w.channels[0], MASTER_SR, SR, RECIPE.resample);
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  let onset = 0;
  while (onset < x.length && Math.abs(x[onset]) <= pk * D.dbToLin(RECIPE.onsetDb)) onset++;
  let last = onset;
  for (let i = onset; i < x.length; i++) if (Math.abs(x[i]) > pk * D.dbToLin(RECIPE.endDb)) last = i;
  const lastOnset48 = side.onsetSamples[side.onsetSamples.length - 1], firstOnset48 = side.onsetSamples[0];
  const lastWindowEnd = Math.round((lastOnset48 - firstOnset48) * SR / MASTER_SR) + onset + Math.round(WINDOW.toMs / 1000 * SR);
  const a = Math.max(0, onset - Math.round(RECIPE.leadMs / 1000 * SR));
  const b = Math.min(x.length, Math.max(last + Math.round(RECIPE.holdMs / 1000 * SR), lastWindowEnd));
  const body = x.slice(a, b);
  for (let i = 0; i < onset - a; i++) body[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / (onset - a)); // the 0.25 ms lead (below -50 dB re peak)
  const y = new Float32Array(body.length + Math.round(RECIPE.tailMs / 1000 * SR));
  y.set(body);
  const g = D.normalisePeak([y], RECIPE.peakDbfs);
  const durS = +(y.length / SR).toFixed(4);
  const on44 = side.onsetSamples.map(o => Math.round((o - firstOnset48) * SR / MASTER_SR) + onset - a);
  const analysis = analyseClick(y, SR, on44[on44.length - 1]);
  const found = discharges(y, SR);
  if (found.length !== take.discharges) throw new Error(`${take.id}: ${found.length} discharges found structurally, ${take.discharges} rendered`);
  if (analysis.decayTo60DbMs > 20) throw new Error(`${take.id}: decays too slowly (${analysis.decayTo60DbMs} ms to -60 dB)`);
  const mp3 = encode(y, SR, RECIPE.kbps), frames = mp3Frames(mp3);
  if (frames.sampleRate !== SR || frames.samples / SR < durS) throw new Error(`${take.id}: MP3 frame chain does not cover the clip`);
  fs.writeFileSync(path.join(OUT_DIR, `${take.id}.mp3`), mp3);
  const lufs = momentary(y, SR);
  levels[take.cue].push(lufs);
  manifest[take.cue].push({url: `assets/audio/${take.id}.mp3`, dur: durS, src: take.id});
  derivs.push({file: `game/public/assets/audio/${take.id}.mp3`, url: `assets/audio/${take.id}.mp3`, bytes: mp3.length, sha256: sha256(mp3), cue: take.cue, durationS: durS,
    mp3: {frames: frames.frames, sampleRate: frames.sampleRate, kbps: RECIPE.kbps, decodeCheck: 'MPEG-1 Layer III frame chain OK (not decoded on the worker)'},
    source: {clip: take.id, procedural: true, generator: RENDERER, generatorVersion: RENDERER_VERSION, seed: take.seed, discharges: take.discharges, params: side.params,
      rawFile: `reference/tasks/${TASK}/audio/raw/${take.id}.wav`, rawSha256: rawSha, rawSampleRate: MASTER_SR, rawBits: 16, rawSamples: side.samples, rawAnalysis: side.analysis,
      reRendered: 'byte-identical', jobId: null},
    structural: {...analysis, dischargesFound: found.length, dischargeOffsetsMs: found.map(s => r2(s / SR * 1000)), momentaryLufsAtUnity: lufs},
    ops: [{op: 'resample', fromHz: MASTER_SR, toHz: SR, filter: `Kaiser-windowed sinc, ${RECIPE.resample.halfTaps * 2} taps, beta ${RECIPE.resample.kaiserBeta}, cutoff ${RECIPE.resample.cutoffReNyquist} x 22.05 kHz`},
      {op: 'trim', startS: +(a / SR).toFixed(5), endS: +(b / SR).toFixed(5), note: `${RECIPE.leadMs} ms before the first sample over ${RECIPE.onsetDb} dB re peak, to the later of the last discharge window (${WINDOW.toMs} ms) and the ${RECIPE.endDb} dB point + ${RECIPE.holdMs} ms`},
      {op: 'fade', inS: +((onset - a) / SR).toFixed(5), outS: 0, curve: 'cosine', note: 'fade-in over the near-silent lead only; the decay is the discharge window of the master'},
      {op: 'pad', tailS: RECIPE.tailMs / 1000}, {op: 'normalise', peakDbfs: RECIPE.peakDbfs, gainDb: r2(g)},
      {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME} (LGPL-3.0, build-time only)`, kbps: RECIPE.kbps, note: 'constant encoder priming delay, skipped by the bank (leadOffset)'}]});
}

// --- mix calibration -----------------------------------------------------------------------------------------------------------------
const refProv = new Map();
const references = {};
for (const ref of REFERENCES) {
  if (!refProv.has(ref.prov)) refProv.set(ref.prov, JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives', ref.prov), 'utf8')));
  const vals = [];
  for (const url of ref.urls) {
    const d = refProv.get(ref.prov).derivatives.find(e => e.url === url);
    if (!d) throw new Error(`${url}: not in ${ref.prov}`);
    const rawPath = path.join(REFERENCE, path.relative('reference', d.source.rawFile));
    const raw = fs.readFileSync(rawPath);
    if (sha256(raw) !== d.source.rawSha256) throw new Error(`${url}: reference raw SHA-256 mismatch`);
    const w = readWav(raw), sr = w.sampleRate;
    const trim = d.ops.find(o => o.op === 'trim'), fade = d.ops.find(o => o.op === 'fade');
    const chs = D.slice([D.downmix(w.channels)], Math.round(trim.startS * sr), Math.round(trim.endS * sr));
    D.fade(chs, sr, fade.inS, fade.outS);
    D.normalisePeak(chs, -1);
    const y = ref.lowpassHz ? lowpass(chs[0], ref.lowpassHz, 0.7, sr) : chs[0];
    vals.push(momentary(y, sr, ref.gain));
  }
  const mean = vals.reduce((p, q) => p + q, 0) / vals.length;
  references[ref.key] = {cue: ref.cue, gameGain: ref.gain, lowpassHz: ref.lowpassHz ?? null, clips: ref.urls.length, momentaryLufs: r2(mean), perClip: vals, note: ref.note};
}
const meanOf = a => a.reduce((p, q) => p + q, 0) / a.length;
const unity = meanOf(levels.geigerClick);
const target = references.click.momentaryLufs + TARGET_RE_CLICK_LU;
const cueGain = Math.min(1, r2(Math.pow(10, (target - unity) / 20)));
const atK = (lu, k) => r2(lu + 20 * Math.log10(cueGain * (0.55 + 0.45 * k)));
const cues = {};
for (const c of CUES) {
  const u = meanOf(levels[c]);
  cues[c] = {cueGain, variants: levels[c].length, momentaryLufsAtUnity: r2(u), atK1Lufs: atK(u, 1), atK0Lufs: atK(u, 0), atK1PeakDbfs: r2(RECIPE.peakDbfs + 20 * Math.log10(cueGain))};
}
const GAIN = Object.fromEntries(CUES.map(c => [c, cueGain]));

// --- outputs ---------------------------------------------------------------------------------------------------------------------------
const bytes = derivs.reduce((s, d) => s + d.bytes, 0);
fs.writeFileSync(MANIFEST_TS, `// GENERATED by tools/audio-pipeline/geiger-build.mjs from the procedural masters of tools/audio-pipeline/geiger-render.mjs — do not edit
// by hand. Provenance: public/assets/derivatives/audio-geiger.json. Task studio-reactor-glowing-zombies-20261115-013245-01 (lane AUDIO):
// the Geiger-counter ticks heard near the Reactor's irradiated zombies (audio/sfx.ts geigerClick) — single discharges and 2-4 tick
// clusters for high count rates. Rendered offline; at runtime these are ordinary bundled clips.

import type {ClipRef} from './manifest.generated';

/** This build's runtime cues, in decode-priority order (bank.ts CUES). */
export const GEIGER_CUES = ${JSON.stringify(CUES)} as const;
export type GeigerCue = (typeof GEIGER_CUES)[number];

export const CLIP_MANIFEST_GEIGER: Readonly<Record<GeigerCue, readonly ClipRef[]>> = {
${CUES.map(c => ` ${c}: [\n${manifest[c].map(m => `  ${JSON.stringify(m)},`).join('\n')}\n ],`).join('\n')}
};

/** Per-cue mix gains = the build's calibration (derivatives/audio-geiger.json mixCalibration): a single tick at full exposure sits at
 *  ${TARGET_RE_CLICK_LU} LU re the flashlight click (momentary, at the source); the cluster takes keep the same per-tick gain. */
export const GEIGER_CUE_GAIN: Readonly<Record<GeigerCue, number>> = ${JSON.stringify(GAIN)};

/** Cues of this build without a clip (none). */
export const CLIP_GAPS_GEIGER: readonly string[] = ${JSON.stringify(CUES.filter(c => !manifest[c].length))};

/** Total bytes of this build's derivatives. */
export const CLIP_BYTES_GEIGER = ${bytes};
`);
const prov = {asset: 'audio-geiger-20261115', task: 'studio-reactor-glowing-zombies-20261115-013245-01 (lane AUDIO)', generatedBy: 'tools/audio-pipeline/geiger-build.mjs', procedural: true,
  generator: {script: RENDERER, version: RENDERER_VERSION, sampleRate: MASTER_SR, model: MODEL, window: WINDOW, note: 'Deterministic, seeded offline synthesis (one GM discharge = a short AC-coupled pulse into a band-pass resonator bank: piezo / upper piezo mode / housing / body, plus a little of the edge, through a small-speaker low-pass). Every master re-renders byte-identically from its seed; the build checks that.'},
  policy: 'Procedural Geiger-counter ticks, user-authorized for this task ("free local Sound Lab or procedural audio ... for Geiger clicks"; no paid generation). Rendered OFFLINE by the repository\'s own script; the runtime plays them as ordinary bundled clips (no oscillator, noise buffer or synthesis at runtime). Private 48 kHz masters + sidecars stay in the external raw-asset mount, outside Git.',
  license: {status: 'Conditional prototype (the repository\'s prototype status, unchanged): procedural clips rendered by the repository\'s own script from fixed seeds. No Sound Lab, no generative model, no third-party, stock, sampled or downloaded audio. Not production / commercial clearance.', gameReady: false, notice: 'game/public/assets/audio/NOTICE.md'},
  review: 'NOT LISTENED TO on the worker: structural analysis only (peak, decay, spectral centroid / peak, band shares, discharges found, momentary loudness). The MP3s were frame-walked, not decoded. Gains are first estimates for an ear pass.',
  auditioned: false,
  rawArchive: `reference/tasks/${TASK}/audio/raw/ (48 kHz 16-bit masters, per-take sidecars, index.json)`,
  recipe: RECIPE,
  mixCalibration: {method: 'loudest 400 ms K-weighted window (BS.1770 momentary; short clips zero-padded to 400 ms) at the game gain; references rebuilt from their raws with their recorded ops', targetReClickLu: TARGET_RE_CLICK_LU,
    gainLaw: 'voice gain = 0.55 + 0.45 k (k = exposure 0..1) x CUE_GAIN', references, cues},
  gaps: CUES.filter(c => !manifest[c].length), totalBytes: bytes, derivatives: derivs};
fs.writeFileSync(PROV, JSON.stringify(prov, null, 1) + '\n');
console.log(`total ${derivs.length} derivatives, ${bytes} B; cueGain ${cueGain} (unity ${r2(unity)} LUFS, target ${r2(target)})`);
for (const [k, v] of Object.entries(references)) console.log(`ref ${k}: ${v.momentaryLufs} LUFS at gain ${v.gameGain}`);
for (const c of CUES) console.log(c, JSON.stringify(cues[c]));
for (const d of derivs) console.log(d.source.clip, d.durationS + 's', d.bytes + 'B', 'found', d.structural.dischargesFound, '-40dB', d.structural.decayTo40DbMs, '-60dB', d.structural.decayTo60DbMs, 'centroid', d.structural.centroidHz, 'peakHz', d.structural.spectralPeakHz, 'lufs', d.structural.momentaryLufsAtUnity, 'dc', d.structural.dcMean);
