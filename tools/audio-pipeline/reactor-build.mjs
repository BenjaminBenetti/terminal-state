#!/usr/bin/env node
// Task studio-reactor-build-20261101-205236-01 (primary): runtime derivatives of THE REACTOR's machine set — the Sound Lab takes
// planned by tools/audio-pipeline/reactor-plan.py and generated through tools/audio-pipeline/soundlab_runner.py (one fsynced intent
// per POST; whole-second durations; SOUND_LAB_MAX_POSTS 12; /tmp/ll-soundlab.lock). This builder makes NO Sound Lab call: it edits
// the generated clips only (trim / fades / loop crossfade / level) and never creates sound.
//
// Inputs (read-only): reference/tasks/reactor-build-20261101-205236/audio/{queue.json, raw/<id>.wav, raw/<id>.sidecar.json}; each raw
//   is verified against its runner sidecar SHA-256. Structural QC (envelopes) is recorded privately in audio/QC.md (the worker cannot
//   listen: the user taste-tests in game).
// Outputs: game/public/assets/audio/reactor-*.mp3, game/src/audio/manifest.reactor.generated.ts (merged into bank.ts CLIP_MANIFEST),
//   game/public/assets/derivatives/audio-reactor.json (provenance, no URLs), tools/release/public-inputs.json (only these paths).
//
// Ops: mono downmix (mean) -> one-shots: trim [a, b] + cosine fades + peak normalisation to -1 dBFS; loops: the most stationary
//   window (lib/dsp stationaryRegion) -> equal-power crossfaded loop (makeLoop) with periodic decoder margins (withLoopMargins) +
//   RMS normalisation to -20 dBFS (the bed convention) -> MP3 (lamejs, mono, 128 kbps).
//
// Usage: node tools/audio-pipeline/reactor-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-reactor-build-20261101-205236-01';
const AUDIO = path.join(ROOT, 'reference/tasks/reactor-build-20261101-205236/audio'), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.reactor.generated.ts');
const PROV_REL = 'assets/derivatives/audio-reactor.json';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run');
const KBPS = 128, LOOP_MARGIN_S = 0.3, LOOP_XF_S = 0.6;
const sha = b => createHash('sha256').update(b).digest('hex');

/** The runtime cues of this build (game/src/audio/bank.ts CUES). */
export const CUES_REACTOR = ['reactorGeneratorStart', 'reactorGeneratorLoop', 'reactorFanLoop', 'reactorBreaker', 'reactorFuse', 'reactorValve', 'reactorPump', 'reactorStartup', 'reactorHum'];

/** Per clip: one-shot window [a, b] (s) or a loop of `len` s (stationary window search). From the structural QC (audio/QC.md). */
const PLAN = {
  'reactor-gen-start-01': {kind: 'oneshot', a: 0, b: 5.6},
  'reactor-gen-loop-01': {kind: 'loop', len: 7, minStart: 1.0},
  'reactor-fan-loop-01': {kind: 'loop', len: 6, minStart: 0.5, endGuard: 2.2},
  'reactor-breaker-01': {kind: 'oneshot', a: 0, b: 1.4},
  'reactor-fuse-01': {kind: 'oneshot', a: 0.55, b: 1.6},
  'reactor-valve-01': {kind: 'oneshot', a: 0, b: 3.0},
  'reactor-pump-01': {kind: 'oneshot', a: 0, b: 4.8},
  'reactor-startup-01': {kind: 'oneshot', a: 0, b: 9.4},
  'reactor-hum-01': {kind: 'loop', len: 8, minStart: 0.5},
};

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
    D.fade(chs, sr, p.a > 0 ? 0.01 : 0.004, 0.25);
    const g = D.normalisePeak(chs, -1);
    ops = [`mono`, `trim ${p.a}-${p.b} s`, 'cosine fades', `peak -1 dBFS (${g.toFixed(1)} dB)`];
  } else {
    const reg = D.stationaryRegion(mono[0], sr, p.len + LOOP_XF_S, {minStartS: p.minStart, endGuardS: p.endGuard ?? 0.3});
    const lp = D.makeLoop(mono, sr, reg.startS, p.len, LOOP_XF_S);
    chs = D.withLoopMargins(lp, sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, -1);
    loop = {start: LOOP_MARGIN_S, length: +(lp[0].length / sr).toFixed(6)};
    ops = ['mono', `stationary window from ${reg.startS} s (std ${reg.stdDb} dB)`, `loop ${p.len} s, equal-power crossfade ${LOOP_XF_S} s`, `margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS (${g.toFixed(1)} dB)`];
  }
  const mp3 = encodeMp3(chs[0], sr, KBPS);
  const name = c.id.replace(/-01$/, '') + (loop ? '-loop' : '') + '.mp3';
  const url = `assets/audio/${name}`;
  const dur = +(chs[0].length / sr).toFixed(4);
  (manifest[c.cue] ??= []).push({url, dur, ...(loop ? {loop} : {}), src: c.id});
  files.push({url, buf: mp3});
  prov.push({cue: c.cue, clip: c.id, url, bytes: mp3.length, sha256: sha(mp3), dur, ...(loop ? {loop} : {}), ops,
    source: {rawSha256: side.rawSha256, seconds: side.request.seconds, seed: side.request.seed, steps: side.request.steps, cfg: side.request.cfg, prompt: side.request.prompt}});
}
for (const cue of CUES_REACTOR) if (!manifest[cue]) throw new Error(`cue ${cue} has no clip`);
console.log(JSON.stringify(prov.map(p => ({cue: p.cue, url: p.url, bytes: p.bytes, dur: p.dur, loop: p.loop})), null, 1));
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/reactor-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (primary): THE REACTOR's machine set — auxiliary generator start + running
// loop, extraction-fan loop, switchgear breaker / fuse, coolant valve / pump, the core's startup swell + running hum loop.

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_REACTOR: Readonly<Record<string, readonly ClipRef[]>> = {
${Object.entries(manifest).map(([cue, refs]) => ` ${cue}: [\n${refs.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-reactor-20261101', task: TASK, lane: 'primary',
  status: 'runtime derivatives of the Reactor machine set generated for this project with the existing LOCAL Sound Lab (narrow reactor / generator ambience allowed by the Reactor build brief; 9 jobs of a 12-job cap, every first take accepted); unapproved prototype, no licence or commercial clearance implied; structurally QC-ed, not auditioned by ear on the worker',
  rebuild: 'node tools/audio-pipeline/reactor-build.mjs', plan: 'tools/audio-pipeline/reactor-plan.py', kbps: KBPS, clips: prov};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=).{0,20}/i); if (hit) throw new Error(`URL-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);
const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
const mine = new Set([...files.map(f => f.url), PROV_REL]);
const add = [...mine].map(p => { const b = fs.readFileSync(path.join(ROOT, 'game/public', p)); return {path: p, bytes: b.length, sha256: sha(b)}; });
allow.files = [...allow.files.filter(f => !mine.has(f.path)), ...add].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
console.log('wrote', files.length, 'clips +', path.relative(ROOT, MANIFEST_TS), PROV_REL);
