#!/usr/bin/env node
// Task studio-skyways-level-20261106-054448-01 (lead): runtime derivatives of the Skyways PRIZE-CAR set. Round 2 (task
// studio-beta-skyways-vehicle-20261107-054512-01, lane AUDIO): the engine loops rebuilt from mid-range takes + the arcade cues.
//
// Why round 2 (structural measurements, never an audition; the private root-cause note: reference/tasks/skyways-vehicle-20261107-054512/
// audio/ROOT-CAUSE.md): the round-1 engine idle / drive loops (car-engine-idle-01 / -drive-01) were SUB-BASS only (spectral centroid 48 /
// 76 Hz, 99.8 % of the energy under 300 Hz; the idle's content above 180 Hz at -47.7 dBFS at the game's gain) — laptop speakers / earbuds
// reproduce almost nothing there and the ear is ~25 dB less sensitive at 50 Hz: the engine was effectively inaudible although the
// wiring played it. Round 2 (8 local Sound Lab jobs, tools/audio-pipeline/skyways-car2-plan.py): the idle = the mid-range mechanical take
// idle-03 with the lumpy sub-bass take idle-02 mixed under it as the body; the drive = drive-02's steadiest 1.2 s mid-range growl (twice)
// over round 1's steady drive-01 as the body (no round-2 drive take held a steady pitch: drive-03 / -04 sweep, rejected); new: the engine
// START one-shot, the REVERSE-gear whine loop, the BRAKE-to-stop one-shot. The round-1 skid / door are rebuilt unchanged (same bytes).
//
// Planned by tools/audio-pipeline/skyways-car-plan.py (round 1) / skyways-car2-plan.py (round 2) and generated through
// tools/audio-pipeline/soundlab_runner.py (one fsynced intent per POST; whole-second durations; SOUND_LAB_MAX_POSTS; /tmp/ll-soundlab.lock).
// This builder makes NO Sound Lab call: it edits the generated clips only (trim / fades / loop crossfade / layer mix / level) and never
// creates sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (round 1, default reference/tasks/skyways-level-20261106-054448/audio) and
//   $SOUND_LAB_AUDIO_DIR_V2 (round 2, default reference/tasks/skyways-vehicle-20261107-054512/audio), each {queue.json, raw/<id>.wav,
//   raw/<id>.sidecar.json}; each raw is verified against its runner sidecar SHA-256.
// Outputs: game/public/assets/audio/car-*.mp3, game/src/audio/manifest.skywaysCar.generated.ts (merged into bank.ts CLIP_MANIFEST),
//   game/public/assets/derivatives/audio-skyways-car.json (provenance + structural metrics, no URLs), the NOTICE / CREDITS block,
//   tools/release/public-inputs.json (only these paths).
//
// Usage: [SOUND_LAB_AUDIO_DIR=<round-1 dir>] [SOUND_LAB_AUDIO_DIR_V2=<round-2 dir>] node tools/audio-pipeline/skyways-car-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {stft} from './lib/structural.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-skyways-level-20261106-054448-01', TASK2 = 'studio-beta-skyways-vehicle-20261107-054512-01';
const R1 = {rel: 'reference/tasks/skyways-level-20261106-054448/audio', env: 'SOUND_LAB_AUDIO_DIR', task: TASK, jobs: '4 jobs of the Skyways task\'s 12-job cap'};
const R2 = {rel: 'reference/tasks/skyways-vehicle-20261107-054512/audio', env: 'SOUND_LAB_AUDIO_DIR_V2', task: TASK2, jobs: '8 jobs of the Skyways rework\'s 8-job audio allowance'};
for (const r of [R1, R2]) r.dir = process.env[r.env] || path.join(ROOT, r.rel);
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.skywaysCar.generated.ts');
const PROV_REL = 'assets/derivatives/audio-skyways-car.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run');
const LOOP_MARGIN_S = 0.1;
const BYTE_CAP = 140 * 1024;
const KBPS = 64;
const sha = b => createHash('sha256').update(b).digest('hex');

/** The runtime cues of this build (game/src/audio/bank.ts CUES). */
export const CUES_SKYWAYS_CAR = ['carIdle', 'carDrive', 'carStart', 'carReverse', 'carBrake', 'carSkid', 'carDoor'];

/**
 * Per output (windows chosen from the takes' structural profiles: 0.1 s level / 0.05 s centroid / YIN f0 scans in the private ledger).
 * Loops: every layer is its own seamless loop (makeLoop: `start`, the loop length — or `grain` repeated to it —, an equal-power `xf`),
 * RMS-levelled to -20 dBFS, scaled by `gain`, summed; the sum RMS -20 dBFS under a -1 dBFS ceiling. One-shots: trim a..b, fades, peak -1.
 */
const PLAN = [
  // the audible layer: mechanical mid-range idle (centroid ~1.7 kHz; 0.1 s level std ~1 dB from 1.9 s) + the body: lumpy sub-bass
  // firing pulses (21 Hz envelope modulation) at -3 dB
  {cue: 'carIdle', name: 'car-engine-idle-loop', kind: 'loop', len: 2.4, layers: [
    {r: R2, clip: 'car-engine-idle-03', role: 'mechanical mid-range (audible layer)', start: 1.9, xf: 0.4, gain: 1},
    {r: R2, clip: 'car-engine-idle-02', role: 'sub-bass firing pulses (body)', start: 1.72, xf: 0.4, gain: 0.7}]},
  // the audible layer: drive-02's steadiest window (1.28-2.68 s: centroid ~315 Hz, +0.006 octave drift, 0.05 s level std 1.5 dB) as a
  // 1.2 s grain played twice + the body: round 1's steady drive growl (stationary from 1.5 s) at -6 dB
  {cue: 'carDrive', name: 'car-engine-drive-loop', kind: 'loop', len: 2.4, layers: [
    {r: R2, clip: 'car-engine-drive-02', role: 'mid-range growl (audible layer)', start: 1.28, grain: 1.2, xf: 0.2, gain: 1},
    {r: R1, clip: 'car-engine-drive-01', role: 'steady sub-bass growl (body)', start: 1.5, xf: 0.4, gain: 0.5}]},
  // starter whirr 0-0.5 s (centroid ~1.5 kHz), the catch 0.5-0.7 s, a mid-range idle (~300 Hz) to 1.5 s, decay to 2.5 s, silence after
  {cue: 'carStart', name: 'car-engine-start', kind: 'oneshot', r: R2, clip: 'car-engine-start-01', a: 0, b: 2.6, fadeIn: 0.003, fadeOut: 0.3},
  // a tonal gearbox whine (~1130 Hz, 28 dB over its band median) over a low hum (90-180 Hz; the engine loops already carry that band):
  // high-passed so the layer is the whine — distinct from the engine. The whine PULSES every ~0.7 s (5 ms envelope above 700 Hz: bursts
  // at 0.64 / 1.37 / 2.05-2.17 / 2.6 s): the loop spans two of those periods from just after a pulse, so the cadence stays regular
  {cue: 'carReverse', name: 'car-reverse-loop', kind: 'loop', len: 1.42, layers: [
    {r: R2, clip: 'car-reverse-01', role: 'reverse-gear whine', start: 0.7, xf: 0.3, gain: 1, highpass: 700}]},
  // the squeal / scrub 0.1-0.8 s (centroid 1.3-1.9 kHz), the suspension clunk at ~1.3 s, silence after ~1.7 s
  {cue: 'carBrake', name: 'car-brake', kind: 'oneshot', r: R2, clip: 'car-brake-01', a: 0.05, b: 1.75, fadeIn: 0.005, fadeOut: 0.15},
  // (round 1, unchanged) skid: the squeal 0.1-0.8 s, decay to 1.0 s; door: the latch 0-0.3 s, the open 0.3-0.5 s, the shut at 1.4 s
  {cue: 'carSkid', name: 'car-skid', kind: 'oneshot', r: R1, clip: 'car-skid-01', a: 0.05, b: 1.05, fadeIn: 0.01, fadeOut: 0.2},
  {cue: 'carDoor', name: 'car-door', kind: 'oneshot', r: R1, clip: 'car-door-01', a: 0, b: 1.75, fadeIn: 0.005, fadeOut: 0.15},
];

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

/** 2nd-order (RBJ cookbook, Q 0.707) high-pass over a whole take, before any loop is cut (no filter transient at a seam). */
function highpass(x, sr, f0) {
  const w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), a0 = 1 + al;
  const b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = (1 + c) / 2 / a0, a1 = -2 * c / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

const queues = new Map();
function take(r, clip) {
  if (!queues.has(r)) queues.set(r, JSON.parse(fs.readFileSync(path.join(r.dir, 'queue.json'), 'utf8')).clips);
  const c = queues.get(r).find(q => q.id === clip);
  if (!c) throw new Error(`${clip}: not in ${r.rel}/queue.json`);
  const raw = path.join(r.dir, 'raw');
  const side = JSON.parse(fs.readFileSync(path.join(raw, `${clip}.sidecar.json`), 'utf8'));
  const rawBuf = fs.readFileSync(path.join(raw, `${clip}.wav`));
  if (sha(rawBuf) !== side.rawSha256) throw new Error(`${clip}: raw sha mismatch`);
  const w = readWav(rawBuf);
  if (w.sampleRate !== 44100) throw new Error(`${clip}: sample rate ${w.sampleRate} (the bank contract is 44.1 kHz)`);
  const jobId = side.job?.id ?? side.jobId ?? null;
  if (!/^\d{8}T\d{6}-\d+$/.test(String(jobId))) throw new Error(`${clip}: no Sound Lab job id in the runner sidecar`);
  const source = {clip, rawFile: `${r.rel}/raw/${clip}.wav`, rawSha256: side.rawSha256, rawBytes: side.rawBytes, labFile: side.labFile,
    labSidecarSha256: side.labSidecarSha256, jobId, task: r.task, prompt: side.request.prompt, seed: side.request.seed, seconds: side.request.seconds,
    steps: side.request.steps, cfg: side.request.cfg};
  return {mono: [D.downmix(w.channels)], sr: w.sampleRate, source};
}

/** Structural metrics of a derivative's samples (public; NOT an audition): level, band shares, centroid, loop-seam continuity. */
function metrics(x, sr, loopN) {
  const S = stft(x, sr, 4096, 1024), binHz = sr / S.N;
  let tot = 0, a180 = 0, a355 = 0, cen = 0;
  for (const p of S.frames) for (let k = 1; k < p.length; k++) { const hz = k * binHz; tot += p[k]; cen += p[k] * hz; if (hz >= 180) a180 += p[k]; if (hz >= 355) a355 += p[k]; }
  const db = v => +(10 * Math.log10(Math.max(1e-12, v))).toFixed(1);
  const m = {rmsDbfs: +D.linToDb(D.rms([x])).toFixed(1), peakDbfs: +D.linToDb(D.peak([x])).toFixed(1), centroidHz: Math.round(cen / Math.max(1e-20, tot)),
    shareAbove180HzDb: db(a180 / tot), shareAbove355HzDb: db(a355 / tot)};
  if (loopN) {
    // the loop body sits at [M, M + loopN): its wrap (last sample -> first) and the level of its last / first 50 ms
    const M = Math.round(LOOP_MARGIN_S * sr), w = Math.round(0.05 * sr), body = x.subarray(M, M + loopN);
    const r = (a, b) => D.rms([body.subarray(a, b)]);
    m.loopSeam = {wrapJump: +Math.abs(body[loopN - 1] - body[0]).toFixed(4), meanStep: +(body.reduce((s, v, i) => i ? s + Math.abs(v - body[i - 1]) : s, 0) / (loopN - 1)).toFixed(4),
      edgeLevelDb: +(D.linToDb(r(0, w)) - D.linToDb(r(loopN - w, loopN))).toFixed(2)};
  }
  return m;
}

const manifest = {}, files = [], prov = [];
for (const p of PLAN) {
  let chs, loop = null, ops, source, layers;
  if (p.kind === 'oneshot') {
    const t = take(p.r, p.clip), sr = t.sr;
    chs = D.slice(t.mono, Math.round(p.a * sr), Math.min(t.mono[0].length, Math.round(p.b * sr)));
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    const g = D.normalisePeak(chs, -1);
    ops = ['mono', `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`, `peak -1 dBFS (${g.toFixed(1)} dB)`];
    source = t.source;
  } else {
    const sr = 44100, L = Math.round(p.len * sr), sum = new Float32Array(L);
    ops = ['mono'];
    layers = [];
    for (const l of p.layers) {
      const t = take(l.r, l.clip);
      if (l.highpass) { t.mono = [highpass(t.mono[0], sr, l.highpass)]; ops.push(`${l.clip}: high-pass ${l.highpass} Hz (2nd-order, Q 0.707)`); }
      let lp = D.makeLoop(t.mono, sr, l.start, l.grain ?? p.len, l.xf);
      if (l.grain) {
        const reps = p.len / l.grain;
        if (Math.abs(reps - Math.round(reps)) > 1e-9) throw new Error(`${p.cue}: grain ${l.grain} s does not tile ${p.len} s`);
        const one = lp[0], out = new Float32Array(L);
        for (let i = 0; i < L; i++) out[i] = one[i % one.length];
        lp = [out];
      }
      if (lp[0].length !== L) throw new Error(`${p.cue}: layer ${l.clip} is ${lp[0].length} samples, the loop ${L}`);
      const lg = D.normaliseRms(lp, -20, 0);
      for (let i = 0; i < L; i++) sum[i] += lp[0][i] * l.gain;
      ops.push(`${l.clip}: loop from ${l.start} s, ${l.grain ? `${l.grain} s grain x${Math.round(p.len / l.grain)}` : `${p.len} s`}, equal-power crossfade ${l.xf} s, rms -20 dBFS (${lg.toFixed(1)} dB) x ${l.gain}`);
      layers.push({role: l.role, gain: l.gain, window: {startS: l.start, lengthS: l.grain ?? p.len, crossfadeS: l.xf, ...(l.grain ? {repeats: Math.round(p.len / l.grain)} : {})},
        ...(l.highpass ? {highpassHz: l.highpass} : {}), source: t.source});
    }
    if (layers.length > 1) ops.push(`layers summed (${p.layers.map(l => l.gain).join(' : ')})`);
    chs = D.withLoopMargins([sum], sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, -1);
    loop = {start: LOOP_MARGIN_S, length: +(L / sr).toFixed(6)};
    ops.push(`margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS (${g.toFixed(1)} dB)`);
    source = layers[0].source;
  }
  const sr = 44100, mp3 = encodeMp3(chs[0], sr, KBPS);
  ops.push(`mp3 mono ${KBPS} kbps`);
  const url = `assets/audio/${p.name}.mp3`;
  const dur = +(chs[0].length / sr).toFixed(4);
  (manifest[p.cue] ??= []).push({url, dur, ...(loop ? {loop} : {}), src: source.clip});
  files.push({url, buf: mp3});
  prov.push({cue: p.cue, url, bytes: mp3.length, sha256: sha(mp3), dur, ...(loop ? {loop} : {}), ops, metrics: metrics(chs[0], sr, loop ? Math.round(loop.length * sr) : 0),
    source, ...(layers && layers.length > 1 ? {layers} : {})});
}
for (const cue of CUES_SKYWAYS_CAR) if (!manifest[cue]) throw new Error(`cue ${cue} has no clip`);
// The round-1 engine loops (no longer shipped), re-cut exactly as round 1 did (stationary from 1.5 s, 2.4 s, crossfade 0.4 s, rms -20
// dBFS) and measured the same way — the public before / after evidence (game/tests/skyways-car-audio.test.ts reads it).
const round1 = {};
for (const [cue, clip] of [['carIdle', 'car-engine-idle-01'], ['carDrive', 'car-engine-drive-01']]) {
  const t = take(R1, clip), lp = D.withLoopMargins(D.makeLoop(t.mono, t.sr, 1.5, 2.4, 0.4), t.sr, LOOP_MARGIN_S);
  D.normaliseRms(lp, -20, -1);
  round1[cue] = {clip, jobId: t.source.jobId, rawSha256: t.source.rawSha256, metrics: metrics(lp[0], t.sr, Math.round(2.4 * t.sr))};
}
console.log('round 1 (before):', JSON.stringify(round1));

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(11), p.url.padEnd(36), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', p.loop ? `loop ${p.loop.start}+${p.loop.length}` : 'one-shot', '|', JSON.stringify(p.metrics), '|', p.ops.join(' · '));
console.log(`total ${total} bytes (cap ${BYTE_CAP})`);
if (total > BYTE_CAP) throw new Error(`runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/skyways-car-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (round 2: ${TASK2}): the Skyways PRIZE-CAR set — the engine idle /
// drive loops, the engine start, the reverse-gear whine loop, the brake-to-stop, the tyre skid and the door (audio/sfx.ts carEngine /
// carSkid / carBrake / carDoor).

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_SKYWAYS_CAR: Readonly<Record<string, readonly ClipRef[]>> = {
${Object.entries(manifest).map(([cue, refs]) => ` ${cue}: [\n${refs.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_SKYWAYS_CAR: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_SKYWAYS_CAR = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-skyways-car-20261106', task: TASK, lane: 'lead', revision: {task: TASK2, lane: 'AUDIO',
  why: 'the round-1 engine loops were sub-bass only (centroid 48 / 76 Hz; 99.8 % of the energy under 300 Hz): effectively inaudible on small speakers. Round 2: mid-range engine layers + engine start / reverse whine / brake-to-stop.',
  round1},
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (round 1: ${R1.jobs}; round 2: ${R2.jobs})`,
  plannedBy: 'tools/audio-pipeline/skyways-car-plan.py (round 1), tools/audio-pipeline/skyways-car2-plan.py (round 2)',
  rebuild: 'SOUND_LAB_AUDIO_DIR=<round-1 raw dir> SOUND_LAB_AUDIO_DIR_V2=<round-2 raw dir> node tools/audio-pipeline/skyways-car-build.mjs',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (band levels, spectral centroid, YIN f0 / envelope-modulation tracks, loop-seam continuity, peak, silence). `metrics` describe signal structure only. The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  kbps: KBPS, derivatives: prov};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=).{0,20}/i); if (hit) throw new Error(`URL-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: this set's sentence (rewritten in place between its fixed head and tail)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
{
  const head = 'the Skyways prize-car set (', tail = '): ../derivatives/audio-skyways-car.json';
  const sentence = `${head}engine idle /\ndrive loops car-engine-idle-loop.mp3 / car-engine-drive-loop.mp3, engine start car-engine-start.mp3, reverse whine loop\ncar-reverse-loop.mp3, brake stop car-brake.mp3, tyre skid car-skid.mp3, door car-door.mp3${tail}`;
  const i0 = notice.indexOf(head), i1 = notice.indexOf(tail);
  if (i0 >= 0 && i1 > i0) notice = notice.slice(0, i0) + sentence + notice.slice(i1 + tail.length);
  else {
    const fuelTail = 'fuel cart rolling loop fuel-cart-roll-loop.mp3): ../derivatives/audio-fuel.json';
    if (!notice.includes(fuelTail)) throw new Error('NOTICE.md: expected sentence anchor not found');
    notice = notice.replace(fuelTail, `${fuelTail}; ${sentence}`);
  }
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN skyways-car-audio-20261106 (skyways-car-build.mjs) -->', E = '<!-- END skyways-car-audio-20261106 -->';
const jobsOf = p => [...new Set([p.source, ...(p.layers ?? []).map(l => l.source)].map(s => s.jobId))].join(' + ');
const block = `${B}
## Skyways prize-car audio (engine idle / drive loops, engine start, reverse whine, brake stop, tyre skid, door)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the Skyways
task's local Sound Lab allowance (round 1: ${R1.jobs}) and the rework's (round 2: ${R2.jobs}). Powered by Stability AI.
Stability AI Community License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime
derivatives (trim, fades, loop, layer mix, levelling, MP3) built by \`tools/audio-pipeline/skyways-car-build.mjs\` (provenance:
\`assets/derivatives/audio-skyways-car.json\`). Not reviewed by ear on the build worker. Raw takes are kept outside Git.

${prov.map(p => `- \`${p.url}\` — ${p.cue} (Sound Lab ${p.layers?.length > 1 ? "jobs" : "job"} ${jobsOf(p)})`).join('\n')}
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
