#!/usr/bin/env node
// Task studio-reactor-surface-ending-20261102-213051-01 (lane AUDIO): runtime derivatives of THE REACTOR's ENDING set — the blue-beam
// IGNITION one-shot (user: "the reactor needs to have a noise when the blue beam shoots out the top!") and the surface RAIN loop
// ("It should be raining!"). The Sound Lab takes were planned by tools/audio-pipeline/reactor-ending-plan.py and generated through
// tools/audio-pipeline/soundlab_runner.py (one fsynced intent per POST; whole-second durations; SOUND_LAB_MAX_POSTS 6;
// /tmp/ll-soundlab.lock). This builder makes NO Sound Lab call: it edits the generated clips only (trim / fades / loop crossfade /
// level) and never creates sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/reactor-surface-ending-20261102-213051/audio/raw) {queue.json,
//   raw/<id>.wav, raw/<id>.sidecar.json}; each raw is verified against its runner sidecar SHA-256. Structural QC (envelopes, the
//   ignition's crack, quiet fraction, spectral centroid, spectrogram images) is recorded privately next to the raws (QC.md; the worker
//   cannot listen: the user taste-tests in game). The MIX CALIBRATION also reads the STARTUP / machine raws named by the shipped
//   provenance (audio-reactor-startup.json, audio-reactor.json; read-only) to rebuild the layers that sound at ONLINE.
// Outputs: game/public/assets/audio/{reactor-beam,surface-rain-loop}.mp3, game/src/audio/manifest.reactorEnding.generated.ts (merged
//   into bank.ts CLIP_MANIFEST; + BEAM_IGNITION_CRACK_S), game/public/assets/derivatives/audio-reactor-ending.json (provenance + the mix
//   calibration, no URLs), the NOTICE / CREDITS block, tools/release/public-inputs.json (only these paths).
//
// Ops: mono downmix (mean) -> the ignition: trim [a, b] (the whoosh swell, the crack, the column hum's decay) + cosine fades + peak
//   -1 dBFS; the rain: the most stationary window (lib/dsp stationaryRegion) -> equal-power crossfaded loop (makeLoop) with periodic
//   decoder margins (withLoopMargins) + RMS -20 dBFS (the bed convention) -> MP3 (lamejs, mono, 64 kbps: lamejs keeps 44.1 kHz there,
//   lower rates resample to 32 kHz, which the bank contract refuses). HARD cap: <= 90 KB of new runtime audio (the release pack's
//   headroom).
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> [REFERENCE_ROOT=<checkout holding reference/>] node tools/audio-pipeline/reactor-ending-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-reactor-surface-ending-20261102-213051-01';
const RAW_REL = 'reference/tasks/reactor-surface-ending-20261102-213051/audio/raw';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
/** Where the private reference/ mount lives (a git worktree has none of its own: REFERENCE_ROOT=<main checkout>). */
const REF_ROOT = process.env.REFERENCE_ROOT || ROOT;
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.reactorEnding.generated.ts');
const PROV_REL = 'assets/derivatives/audio-reactor-ending.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run');
const LOOP_MARGIN_S = 0.1;
/** The brief's HARD cap on NEW runtime audio bytes (the release pack sits at its 200 MiB host limit). */
const BYTE_CAP = 90 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');

/** The runtime cues of this build (game/src/audio/bank.ts CUES). */
export const CUES_REACTOR_ENDING = ['reactorBeam', 'bedRain'];

/**
 * Per clip (from the structural QC, audio/raw/QC.md):
 *  - beam: a 0.4 s whoosh swell from 0.13 s, the broadband CRACK at 0.53 s (energy above 2 kHz +12 dB in 30 ms, to ~10 kHz), a
 *    second crackle at 0.97 s, the column hum's partials (~170 / 350 / 700 Hz) decaying -12 dB/s to silence at ~3.0 s. The
 *    derivative keeps the swell: the runtime starts it BEAM_IGNITION_CRACK_S before the beam fires so the crack lands on the beam.
 *  - rain: steady broadband rain (level spread 1.2 dB, droplet streaks to 10 kHz) with one louder splash at 3.0 s and a hard end
 *    at 9.85 s; the loop comes from the steadiest window after the splash.
 */
const PLAN = {
  'reactor-beam-01': {kind: 'oneshot', a: 0.08, b: 3.2, fadeIn: 0.03, fadeOut: 0.3, kbps: 64},
  'surface-rain-01': {kind: 'loop', len: 5.2, xf: 0.5, minStart: 3.5, endGuard: 0.4, kbps: 64},
};
/**
 * The ONLINE moment's mix — the runtime values (sfx.ts CUE_GAIN x world/reactor/startupAudio.ts STARTUP_MIX; reactor-ending-audio.test.ts
 * ties them to this provenance). `before` = lane STARTUP's ONLINE (the impact and the deep thump at call gain 1); `after` = with the
 * beam: the ignition (high-passed at 120 Hz: the ONLINE impact keeps the sub) and the impact / thump making room for it, so the
 * worst-case sum stays under full scale (the calibration below; before the beam it was already over).
 */
const CUE = {reactorSurge: 0.85, reactorOnline: 1, reactorStage: 0.75, reactorBreaker: 0.6, reactorBeam: 1};
const MIX = {before: {online: 1, thump: 1, beam: 0}, after: {online: 0.7, thump: 0.6, beam: 0.75}, beamHighpassHz: 120, thumpRate: 0.62, tierGain: 0.85, tierRate: 0.82};

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

/** bank.ts leadOffset on PCM: the first sample above -50 dB re the peak, minus the 0.5 ms guard (s). */
function leadOffset(x, sr) {
  let pk = 0;
  for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  const thr = pk * Math.pow(10, -50 / 20);
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > thr) return Math.max(0, i / sr - 0.0005);
  return 0;
}

/** Second-order (two cascaded one-pole) high-pass at `hz`. */
function highpass(x, sr, hz) {
  const a = Math.exp(-2 * Math.PI * hz / sr), h = new Float32Array(x.length);
  let y1 = 0, x1 = 0, y2 = 0, x2 = 0;
  for (let i = 0; i < x.length; i++) { const v = a * (y1 + x[i] - x1); x1 = x[i]; y1 = v; const u = a * (y2 + v - x2); x2 = v; y2 = u; h[i] = u; }
  return h;
}

/** The CRACK: onset (s) of the strongest > 2 kHz burst within `withinS` — the first 10 ms frame before its maximum that is within 12 dB of it. */
function crackOnset(x, sr, withinS = 1.2) {
  const h = highpass(x, sr, 2000), F = Math.round(0.01 * sr), e = [];
  for (let f = 0; (f + 1) * F <= Math.min(x.length, Math.round(withinS * sr)); f++) { let s = 0; for (let i = f * F; i < (f + 1) * F; i++) s += h[i] * h[i]; e.push(10 * Math.log10(s / F + 1e-18)); }
  const mx = Math.max(...e), at = e.indexOf(mx);
  let on = at;
  while (on > 0 && e[on - 1] > mx - 12) on--;
  // the burst must stand out of the swell: its maximum >= 9 dB over the mean of the 100 ms before its onset
  const pre = e.slice(Math.max(0, on - 10), on), preDb = pre.length ? 10 * Math.log10(pre.reduce((p, q) => p + Math.pow(10, q / 10), 0) / pre.length) : -180;
  return {onsetS: +(on * 0.01).toFixed(3), peakS: +(at * 0.01).toFixed(3), riseOverSwellDb: +(mx - preDb).toFixed(1)};
}

/** Linear-interpolation resample for a playback RATE r (a playbackRate of r plays the clip r x faster). */
function atRate(x, r) {
  if (r === 1) return x;
  const n = Math.floor((x.length - 1) / r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * r, k = Math.floor(p), f = p - k; out[i] = x[k] * (1 - f) + x[k + 1] * f; }
  return out;
}

/** A shipped one-shot's PCM rebuilt from its raw + its recorded ops (trim a-b, cosine fades, peak -1 dBFS). */
function rebuildOneShot(rawFile, a, b, fadeIn, fadeOut) {
  const w = readWav(fs.readFileSync(path.join(REF_ROOT, rawFile))), sr = w.sampleRate;
  const chs = D.slice([D.downmix(w.channels)], Math.round(a * sr), Math.round(b * sr));
  D.fade(chs, sr, fadeIn, fadeOut);
  D.normalisePeak(chs, -1);
  return chs[0];
}

const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8'));
const manifest = {}, files = [], prov = [];
let crack = null, beamPcm = null, beamLead = 0;
for (const c of queue.clips) {
  const p = PLAN[c.id];
  if (!p) throw new Error(`no derivative plan for ${c.id}`);
  const side = JSON.parse(fs.readFileSync(path.join(RAW, `${c.id}.sidecar.json`), 'utf8'));
  const rawBuf = fs.readFileSync(path.join(RAW, `${c.id}.wav`));
  if (sha(rawBuf) !== side.rawSha256) throw new Error(`${c.id}: raw sha mismatch`);
  const w = readWav(rawBuf), sr = w.sampleRate;
  const mono = [D.downmix(w.channels)];
  let chs, loop = null, ops;
  if (p.kind === 'oneshot') {
    chs = D.slice(mono, Math.round(p.a * sr), Math.min(mono[0].length, Math.round(p.b * sr)));
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    const g = D.normalisePeak(chs, -1);
    ops = ['mono', `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`, `peak -1 dBFS (${g.toFixed(1)} dB)`];
    if (c.cue === 'reactorBeam') {
      const k = crackOnset(chs[0], sr);
      if (!(k.riseOverSwellDb >= 9)) throw new Error(`${c.id}: no crack standing out of the swell (${k.riseOverSwellDb} dB)`);
      beamLead = leadOffset(chs[0], sr);
      crack = {...k, fromPlayStartS: +(k.onsetS - beamLead).toFixed(3), leadOffsetS: +beamLead.toFixed(4)};
      beamPcm = chs[0];
      ops.push(`crack onset ${k.onsetS} s (peak ${k.peakS} s, +${k.riseOverSwellDb} dB over the swell above 2 kHz)`);
    }
  } else {
    const reg = D.stationaryRegion(mono[0], sr, p.len + p.xf, {minStartS: p.minStart, endGuardS: p.endGuard ?? 0.3});
    const lp = D.makeLoop(mono, sr, reg.startS, p.len, p.xf);
    chs = D.withLoopMargins(lp, sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, -1);
    loop = {start: LOOP_MARGIN_S, length: +(lp[0].length / sr).toFixed(6)};
    ops = ['mono', `stationary window from ${reg.startS} s (std ${reg.stdDb} dB over 0.5 s blocks, searched from ${p.minStart} s)`,
      `loop ${p.len} s, equal-power crossfade ${p.xf} s`, `margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS (${g.toFixed(1)} dB)`];
  }
  const mp3 = encodeMp3(chs[0], sr, p.kbps);
  ops.push(`mp3 mono ${p.kbps} kbps`);
  const name = c.id.replace(/-01$/, '') + (loop ? '-loop' : '') + '.mp3';
  const url = `assets/audio/${name}`;
  const dur = +(chs[0].length / sr).toFixed(4);
  (manifest[c.cue] ??= []).push({url, dur, ...(loop ? {loop} : {}), src: c.id});
  files.push({url, buf: mp3});
  const jobId = side.job?.id ?? side.jobId ?? null;
  if (!/^\d{8}T\d{6}-\d+$/.test(String(jobId))) throw new Error(`${c.id}: no Sound Lab job id in the runner sidecar`);
  prov.push({cue: c.cue, url, bytes: mp3.length, sha256: sha(mp3), dur, ...(loop ? {loop} : {}), ops,
    source: {clip: c.id, rawFile: `${RAW_REL}/raw/${c.id}.wav`, rawSha256: side.rawSha256, rawBytes: side.rawBytes,
      labFile: side.labFile, labSidecarSha256: side.labSidecarSha256, jobId, prompt: side.request.prompt, seed: side.request.seed, seconds: side.request.seconds, steps: side.request.steps, cfg: side.request.cfg}});
}
for (const cue of CUES_REACTOR_ENDING) if (!manifest[cue]) throw new Error(`cue ${cue} has no clip`);
if (!crack || !beamPcm) throw new Error('no beam ignition crack measured');

// ---------------------------------------------------------------------------------------------------------------------------------
// MIX CALIBRATION at ONLINE (no listening: sample arithmetic). Every layer that sounds within a second of the beam firing, rebuilt from
// its raw + recorded ops, at its runtime gain (CUE_GAIN x the director's gain) and playback rate, worst-case +0.5 dB gain jitter
// (Sfx.reactorCue gainJitter) on every layer, all at the listener's distance <= the panner reference (unity distance gain: the loudest
// case), summed sample by sample and scaled by the default master volume (Sfx volume 0.7) -> the peak at the master compressor's input
// (dBFS), BEFORE (lane STARTUP's ONLINE) and AFTER (with the beam). The reverb sends (diffuse, spread over seconds) are left out.
// ONLINE = t 0; the surge started at -6 s (its hard cut at +0.14 s); the ignition starts BEAM_IGNITION_CRACK_S early.
const SR = 44100, JIT = Math.pow(10, 0.5 / 20), MASTER = 0.7;
const startupProv = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/audio-reactor-startup.json'), 'utf8'));
const machineProv = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/audio-reactor.json'), 'utf8'));
const rawOf = (pv, url) => pv.derivatives.find(d => d.url === url)?.source.rawFile;
/** WebAudio BiquadFilterNode 'highpass' (Audio EQ Cookbook; Q in dB as the spec reads it for lowpass / highpass). */
function biquadHighpass(x, f0, qDb = 0.7) {
  const w0 = 2 * Math.PI * f0 / SR, al = Math.sin(w0) / (2 * Math.pow(10, qDb / 20)), c = Math.cos(w0);
  const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; out[i] = y; }
  return out;
}
const SRC = [
  // [layer, raw, a, b, fadeIn, fadeOut, CUE_GAIN, rate, start s re ONLINE, mix key (null: fixed call gain 1 / the tier gain)]
  ['surge (its hard cut)', rawOf(startupProv, 'assets/audio/reactor-surge.mp3'), 1.6, 7.74, 0.12, 0.04, CUE.reactorSurge, 1, -6, null],
  ['ONLINE impact', rawOf(startupProv, 'assets/audio/reactor-online.mp3'), 0, 4.0, 0.002, 0.35, CUE.reactorOnline, 1, 0, 'online'],
  [`deep stage thump (rate ${MIX.thumpRate})`, rawOf(startupProv, 'assets/audio/reactor-stage.mp3'), 0, 2.4, 0.002, 0.3, CUE.reactorStage, MIX.thumpRate, 0, 'thump'],
  [`core-floor tier clunk (breaker, rate ${MIX.tierRate})`, rawOf(machineProv, 'assets/audio/reactor-breaker.mp3'), 0, 1.4, 0.004, 0.25, CUE.reactorBreaker * MIX.tierGain, MIX.tierRate, 0, null],
];
const missing = SRC.filter(l => !l[1] || !fs.existsSync(path.join(REF_ROOT, l[1])));
let calibration;
if (missing.length) {
  calibration = {skipped: `raw(s) not mounted: ${missing.map(l => l[0]).join(', ')}`};
  console.warn('mix calibration skipped:', calibration.skipped);
} else {
  const {loudness} = await import('./lib/structural.mjs');
  const t0 = -6.2, t1 = 4.5, N = Math.round((t1 - t0) * SR);
  const pcm = SRC.map(([, raw, a, b, fi, fo, , rate]) => atRate(rebuildOneShot(raw, a, b, fi, fo), rate));
  const beamX = biquadHighpass(beamPcm.subarray(Math.round(beamLead * SR)), MIX.beamHighpassHz); // playback starts at the bank's lead offset
  const beamStart = -crack.fromPlayStartS; // the cue fires this long before ONLINE: the crack lands on ONLINE
  const sum = m => {
    const bus = new Float64Array(N);
    const add = (x, g, startS) => { const o = Math.round((startS - t0) * SR); for (let i = 0; i < x.length; i++) { const j = o + i; if (j >= 0 && j < N) bus[j] += x[i] * g * JIT; } };
    SRC.forEach(([, , , , , , cue, , at, key], i) => add(pcm[i], cue * (key ? m[key] : 1), at));
    if (m.beam > 0) add(beamX, CUE.reactorBeam * m.beam, beamStart);
    let pk = 0, at = 0;
    for (let j = Math.round((-1 - t0) * SR); j < Math.round((2 - t0) * SR); j++) { const v = Math.abs(bus[j]); if (v > pk) { pk = v; at = j; } }
    const win = Float32Array.from(bus.subarray(Math.round((-0.5 - t0) * SR), Math.round((3.5 - t0) * SR)), v => v * MASTER);
    const lu = loudness(win, SR);
    return {peakDbfs: +D.linToDb(pk * MASTER).toFixed(2), peakAtS: +(at / SR + t0).toFixed(3), momentaryMaxLufs: lu.momentaryMaxLufs, integratedLufs: lu.integratedLufs};
  };
  const before = sum(MIX.before), after = sum(MIX.after);
  calibration = {moment: 'ONLINE (the beam fires) = t 0 s; peak window -1 .. +2 s, loudness window -0.5 .. +3.5 s', masterVolume: MASTER, gainJitterDb: 0.5,
    distance: 'unity (the listener within every panner reference: the loudest case)', cueGains: CUE, mix: MIX,
    layers: [...SRC.map(([name, , , , , , cue, rate, at, key]) => ({name, cueGain: cue, callGain: key ? {before: MIX.before[key], after: MIX.after[key]} : 1, rate, startS: at})),
      {name: 'BEAM ignition (high-passed)', cueGain: CUE.reactorBeam, callGain: {before: 0, after: MIX.after.beam}, rate: 1, startS: +beamStart.toFixed(3), highpassHz: MIX.beamHighpassHz}],
    before, after,
    note: 'sample-exact sum of the rebuilt derivatives (pre-MP3 PCM), reverb sends excluded. "No clipping" bound: after.peakDbfs < 0 dBFS at the master compressor input (before the beam the ONLINE moment already peaked over full scale there).'};
  console.log('mix @ ONLINE before', JSON.stringify(before), '\n             after ', JSON.stringify(after));
  if (!(after.peakDbfs < 0)) throw new Error(`ONLINE + beam worst-case peak ${after.peakDbfs} dBFS is not under full scale`);
}

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(12), p.url.padEnd(34), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', p.loop ? `loop ${p.loop.start}+${p.loop.length}` : 'one-shot', '|', p.ops.join(' · '));
console.log('crack', JSON.stringify(crack));
console.log(`total ${total} bytes (cap ${BYTE_CAP})`);
if (total > BYTE_CAP) throw new Error(`new runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/reactor-ending-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (lane AUDIO): THE REACTOR's ENDING set — the blue-beam
// IGNITION (a whoosh swell, the crack, the column hum's decay: world/reactor/startupAudio.ts) and the surface RAIN loop
// (audio/surfaceRain.ts, Sfx.rainBed).

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_REACTOR_ENDING: Readonly<Record<string, readonly ClipRef[]>> = {
${Object.entries(manifest).map(([cue, refs]) => ` ${cue}: [\n${refs.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_REACTOR_ENDING: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_REACTOR_ENDING = ${total};
/** The ignition's CRACK: s after the clip's first audible sample (bank.ts leadOffset). The director starts the clip this long before
 *  the beam fires, so the crack lands on the beam (the swell leads into it). */
export const BEAM_IGNITION_CRACK_S = ${crack.fromPlayStartS};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-reactor-ending-20261102', task: TASK, lane: 'AUDIO',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's blue-beam / rain allowance; ${queue.clips.length} jobs of a 6-job cap, every first take accepted)`,
  plannedBy: 'tools/audio-pipeline/reactor-ending-plan.py', rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/reactor-ending-build.mjs',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (envelope, the crack above 2 kHz, quiet fraction, spectral centroid, per-0.25 s level / centroid, spectrogram). The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  kbps: 'per clip (ops)', beamIgnition: {crack, mix: {cueGain: CUE.reactorBeam, callGain: MIX.after.beam, highpassHz: MIX.beamHighpassHz, onlineGain: MIX.after.online, onlineThumpGain: MIX.after.thump}}, mixCalibration: calibration, derivatives: prov};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=).{0,20}/i); if (hit) throw new Error(`URL-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: name this set's provenance file (idempotent: replaces the sentence's tail once)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
if (!notice.includes('audio-reactor-ending.json')) {
  const tail = '../derivatives/audio-reactor-startup.json).';
  if (!notice.includes(tail)) throw new Error('NOTICE.md: expected sentence tail not found');
  notice = notice.replace(tail, '../derivatives/audio-reactor-startup.json; its ending set (the blue-beam ignition reactor-beam.mp3, the\nsurface rain loop surface-rain-loop.mp3): ../derivatives/audio-reactor-ending.json).');
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN reactor-ending-audio-20261102 (reactor-ending-build.mjs) -->', E = '<!-- END reactor-ending-audio-20261102 -->';
const block = `${B}
## The Reactor: ending audio (the blue-beam ignition, the surface rain)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the surface-
ending task's blue-beam / rain allowance (${queue.clips.length} jobs of a 6-job cap). Powered by Stability AI. Stability AI Community
License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
loop, levelling, MP3) built by \`tools/audio-pipeline/reactor-ending-build.mjs\` (provenance: \`assets/derivatives/audio-reactor-ending.json\`).
Not reviewed by ear on the build worker. Raw takes are kept outside Git.

${prov.map(p => `- \`${p.url}\` — ${p.cue} (Sound Lab job ${p.source.jobId})`).join('\n')}
${E}`;
const i0 = credits.indexOf(B), i1 = credits.indexOf(E);
credits = i0 >= 0 && i1 > i0 ? credits.slice(0, i0) + block + credits.slice(i1 + E.length) : credits.replace(/\n*$/, '\n\n') + block + '\n';
fs.writeFileSync(creditsPath, credits);

const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
const mine = new Set([...files.map(f => f.url), PROV_REL, NOTICE_REL, CREDITS_REL]);
const add = [...mine].map(p => { const b = fs.readFileSync(path.join(ROOT, 'game/public', p)); return {path: p, bytes: b.length, sha256: sha(b)}; });
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log('wrote', files.length, 'clips +', path.relative(ROOT, MANIFEST_TS), PROV_REL, NOTICE_REL, CREDITS_REL);
