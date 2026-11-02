#!/usr/bin/env node
// Task studio-reactor-playtest-round2-20261102-061947-01 (lane STARTUP): runtime derivatives of THE REACTOR's STARTUP set — the Sound
// Lab takes planned by tools/audio-pipeline/reactor-startup-plan.py and generated through tools/audio-pipeline/soundlab_runner.py (one
// fsynced intent per POST; whole-second durations; SOUND_LAB_MAX_POSTS 12; /tmp/ll-soundlab.lock). This builder makes NO Sound Lab
// call: it edits the generated clips only (trim / fades / loop crossfade / level) and never creates sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/reactor-playtest-round2-20261102-061947/audio/raw) {queue.json,
//   raw/<id>.wav, raw/<id>.sidecar.json}; each raw is verified against its runner sidecar SHA-256. Structural QC (envelopes,
//   quiet fraction, spectral centroid, spectrogram images) is recorded privately next to the raws (QC.md; the worker cannot listen:
//   the user taste-tests in game).
// Outputs: game/public/assets/audio/reactor-{surge,online,rod-loop,rod-stop,bed,stage,beacon}*.mp3,
//   game/src/audio/manifest.reactorStartup.generated.ts (merged into bank.ts CLIP_MANIFEST), game/public/assets/derivatives/
//   audio-reactor-startup.json (provenance, no URLs), the NOTICE / CREDITS block, tools/release/public-inputs.json (only these paths).
//
// Ops: mono downmix (mean) -> one-shots: trim [a, b] + cosine fades + peak normalisation to -1 dBFS; loops: the most stationary
//   window (lib/dsp stationaryRegion) or a fixed start -> equal-power crossfaded loop (makeLoop) with periodic decoder margins
//   (withLoopMargins) + RMS normalisation to -20 dBFS (the bed convention) -> MP3 (lamejs, mono, 64 kbps: lamejs keeps 44.1 kHz there —
//   at 48 / 56 kbps it resamples to 32 kHz, which the bank contract (audio-bank.test.ts) refuses — within the brief's <= 220 KB of new
//   runtime audio).
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/reactor-startup-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-reactor-playtest-round2-20261102-061947-01';
const RAW_REL = 'reference/tasks/reactor-playtest-round2-20261102-061947/audio/raw';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.reactorStartup.generated.ts');
const PROV_REL = 'assets/derivatives/audio-reactor-startup.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run');
const LOOP_MARGIN_S = 0.1;
/** The brief's cap on NEW runtime audio bytes (the release pack's headroom). */
const BYTE_CAP = 220 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');

/** The runtime cues of this build (game/src/audio/bank.ts CUES). */
export const CUES_REACTOR_STARTUP = ['reactorSurge', 'reactorOnline', 'reactorRodLoop', 'reactorRodStop', 'reactorBed', 'reactorStage', 'reactorBeacon'];

/**
 * Per clip (from the structural QC, audio/raw/QC.md): one-shot window [a, b] (s) with fades, or a loop of `len` s (a stationary
 * window search inside [minStart, end - endGuard], or a fixed `start`) with an equal-power crossfade `xf`; `kbps` = MP3 bitrate.
 *  - surge: the take's first 1.6 s are a slow sub swell; the derivative starts mid-swell and keeps the hard cut at 7.74 s (the ONLINE
 *    boom lands on it: the runtime starts it dur s before the core is fully awake).
 *  - online: broadband transient then a ~3.9 s sub rumble tail.
 *  - rod loop: the steady servo / ratchet body before the take's 3.3 s dropout.
 *  - bed: the take swells in (0-2.5 s) and out (7-10 s); the >= 5 s bed loop (the bank's bed rule) comes from the steadiest window.
 *  - beacon: regular gear ticks; a fixed 2.0 s window with a short crossfade (ticks never smear).
 */
const PLAN = {
  'reactor-surge-01': {kind: 'oneshot', a: 1.6, b: 7.74, fadeIn: 0.12, fadeOut: 0.04, kbps: 64},
  'reactor-online-01': {kind: 'oneshot', a: 0, b: 4.0, fadeIn: 0.002, fadeOut: 0.35, kbps: 64},
  'reactor-rod-loop-01': {kind: 'loop', len: 2.3, xf: 0.3, minStart: 0.5, endGuard: 2.8, kbps: 64},
  'reactor-rod-stop-01': {kind: 'oneshot', a: 0, b: 1.15, fadeIn: 0.002, fadeOut: 0.15, kbps: 64},
  'reactor-bed-01': {kind: 'loop', len: 5.2, xf: 0.5, minStart: 1.5, endGuard: 1.5, kbps: 64},
  'reactor-stage-01': {kind: 'oneshot', a: 0, b: 2.4, fadeIn: 0.002, fadeOut: 0.3, kbps: 64},
  'reactor-beacon-01': {kind: 'loop', len: 2.0, xf: 0.04, seam: [0.4, 1.2], kbps: 64},
};

/** Loop start in [from, to] (5 ms steps) whose seam windows (start and start + len, xf long) are the quietest: a tick never straddles it. */
function quietSeam(x, sr, from, to, len, xf) {
  const W = Math.max(1, Math.round(xf * sr)), L = Math.round(len * sr);
  const e = a => { let s = 0; for (let i = a; i < a + W && i < x.length; i++) s += x[i] * x[i]; return s; };
  let best = from, bv = Infinity;
  for (let t = from; t <= to + 1e-9; t += 0.005) {
    const a = Math.round(t * sr);
    if (a + L + W > x.length) break;
    const v = e(a) + e(a + L);
    if (v < bv) { bv = v; best = +t.toFixed(3); }
  }
  return best;
}

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8'));
const manifest = {}, files = [], prov = [];
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
  } else {
    let startS = p.start, how;
    if (p.seam) {
      startS = quietSeam(mono[0], sr, p.seam[0], p.seam[1], p.len, p.xf);
      how = `quietest seam from ${startS} s (searched ${p.seam[0]}-${p.seam[1]} s)`;
    } else if (startS === undefined) {
      const reg = D.stationaryRegion(mono[0], sr, p.len + p.xf, {minStartS: p.minStart, endGuardS: p.endGuard ?? 0.3});
      startS = reg.startS;
      how = `stationary window from ${reg.startS} s (std ${reg.stdDb} dB over 0.5 s blocks)`;
    } else how = `fixed window from ${startS} s`;
    const lp = D.makeLoop(mono, sr, startS, p.len, p.xf);
    chs = D.withLoopMargins(lp, sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, -1);
    loop = {start: LOOP_MARGIN_S, length: +(lp[0].length / sr).toFixed(6)};
    ops = ['mono', how, `loop ${p.len} s, equal-power crossfade ${p.xf} s`, `margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS (${g.toFixed(1)} dB)`];
  }
  const mp3 = encodeMp3(chs[0], sr, p.kbps);
  ops.push(`mp3 mono ${p.kbps} kbps`);
  const name = c.id.replace(/-01$/, '') + (loop && !c.id.includes('loop') ? '-loop' : '') + '.mp3';
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
for (const cue of CUES_REACTOR_STARTUP) if (!manifest[cue]) throw new Error(`cue ${cue} has no clip`);
const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(15), p.url.padEnd(36), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(5), 's', p.loop ? `loop ${p.loop.start}+${p.loop.length}` : 'one-shot', '|', p.ops.join(' · '));
console.log(`total ${total} bytes (cap ${BYTE_CAP})`);
if (total > BYTE_CAP) throw new Error(`new runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/reactor-startup-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (lane STARTUP): THE REACTOR's STARTUP set — the power-up
// surge, the ONLINE energy impact, the control-rod drive loop + its stop clunk, the deep machine bed loop, the power-stage contactor
// thump and the rotating beacon's motor loop (world/reactor/startupAudio.ts).

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_REACTOR_STARTUP: Readonly<Record<string, readonly ClipRef[]>> = {
${Object.entries(manifest).map(([cue, refs]) => ` ${cue}: [\n${refs.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_REACTOR_STARTUP: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_REACTOR_STARTUP = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-reactor-startup-20261102', task: TASK, lane: 'STARTUP',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the round-2 brief's reactor startup / control-rod audio allowance; ${queue.clips.length} jobs of a 12-job cap, every first take accepted)`,
  plannedBy: 'tools/audio-pipeline/reactor-startup-plan.py', rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/reactor-startup-build.mjs',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (envelope, quiet fraction, spectral centroid, per-second level / centroid, spectrogram). The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  kbps: 'per clip (ops)', derivatives: prov};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=).{0,20}/i); if (hit) throw new Error(`URL-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: name the Reactor sets' provenance files (idempotent: replaces the sentence's tail once)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
const NOTICE_ADD = '; the Reactor machine set reactor-*.mp3: ../derivatives/audio-reactor.json and its startup set (power-up surge, online impact,\ncontrol-rod drive / stop, machine bed, stage thump, beacon motor): ../derivatives/audio-reactor-startup.json)';
if (!notice.includes('audio-reactor-startup.json')) {
  const tail = '../derivatives/audio-strainer.json).';
  if (!notice.includes(tail)) throw new Error('NOTICE.md: expected sentence tail not found');
  notice = notice.replace(tail, '../derivatives/audio-strainer.json' + NOTICE_ADD + '.');
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN reactor-startup-audio-20261102 (reactor-startup-build.mjs) -->', E = '<!-- END reactor-startup-audio-20261102 -->';
const block = `${B}
## The Reactor: startup audio (power-up, control rods, beacons)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the round-2
Reactor brief's startup / control-rod audio allowance (${queue.clips.length} jobs of a 12-job cap). Powered by Stability AI. Stability AI
Community License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives
(trim, fades, loops, levelling, MP3) built by \`tools/audio-pipeline/reactor-startup-build.mjs\` (provenance:
\`assets/derivatives/audio-reactor-startup.json\`). Not reviewed by ear on the build worker. Raw takes are kept outside Git.

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
