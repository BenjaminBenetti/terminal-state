#!/usr/bin/env node
// Task studio-general-armor-20261107-231448-01: runtime derivatives of the HEAD-HIT cue (user: "a different impact sound when you hit the
// zombies head ... better feedback when you hit the weak spot") — two takes of one bony skull crack, layered over the flesh hit confirm
// only on a CONFIRMED head hit (game/src/audio/sfx.ts headHit). Planned by tools/audio-pipeline/headhit-plan.py and generated through
// tools/audio-pipeline/soundlab_runner.py (one fsynced intent per POST; whole-second durations; SOUND_LAB_MAX_POSTS 4; /tmp/ll-soundlab.lock;
// 2 jobs used). This builder makes NO Sound Lab call: it edits the generated clips only (trim / fades / level) and never creates sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/skywalk-and-general-feedback-20261107-231448/general/audio)
//   {queue.json, raw/<id>.wav, raw/<id>.sidecar.json}; each raw is verified against its runner sidecar SHA-256.
// Outputs: game/public/assets/audio/head-hit-0{1,2}.mp3, game/src/audio/manifest.headHit.generated.ts (merged into bank.ts CLIP_MANIFEST),
//   game/public/assets/derivatives/audio-head-hit.json (provenance, no URLs), the NOTICE / CREDITS block, tools/release/public-inputs.json
//   (only these paths). Structural QC (worker cannot listen): each take one fast transient (rise 10-15 ms, active to ~0.3 s, quiet after),
//   no clipping, spectral centroid 3.9 / 5.0 kHz (a bright crack, unvoiced) — distinct from the wet impactFlesh thwack.
//
// Ops: mono downmix (mean) -> trim [a, b] + cosine fades + peak -1 dBFS -> MP3 (lamejs, mono, 64 kbps at 44.1 kHz). Cap: <= 24 KB.
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/headhit-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-general-armor-20261107-231448-01';
const RAW_REL = 'reference/tasks/skywalk-and-general-feedback-20261107-231448/general/audio';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.headHit.generated.ts');
const PROV_REL = 'assets/derivatives/audio-head-hit.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run');
const LOOP_MARGIN_S = 0.1;
const BYTE_CAP = 24 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');

/** The runtime cue of this build (game/src/audio/bank.ts CUES). */
export const CUES_HEAD_HIT = ['headHit'];

/** Per take: the crack (onset 30-40 ms, peak 40-55 ms) to its ring-out (~0.3 s), the tail faded. */
const PLAN = {
  'head-hit-01': {kind: 'oneshot', a: 0.03, b: 0.32, fadeIn: 0.004, fadeOut: 0.09, kbps: 64},
  'head-hit-02': {kind: 'oneshot', a: 0.02, b: 0.32, fadeIn: 0.004, fadeOut: 0.09, kbps: 64},
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
  if (sr !== 44100) throw new Error(`${c.id}: sample rate ${sr} (the bank contract is 44.1 kHz)`);
  const mono = [D.downmix(w.channels)];
  let chs, loop = null, ops;
  if (p.kind === 'oneshot') {
    chs = D.slice(mono, Math.round(p.a * sr), Math.min(mono[0].length, Math.round(p.b * sr)));
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    const g = D.normalisePeak(chs, -1);
    ops = ['mono', `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`, `peak -1 dBFS (${g.toFixed(1)} dB)`];
  } else {
    const reg = D.stationaryRegion(mono[0], sr, p.len + p.xf, {minStartS: p.minStart, endGuardS: p.endGuard});
    const lp = D.makeLoop(mono, sr, reg.startS, p.len, p.xf);
    chs = D.withLoopMargins(lp, sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, -1);
    loop = {start: LOOP_MARGIN_S, length: +(lp[0].length / sr).toFixed(6)};
    ops = ['mono', `stationary window from ${reg.startS} s (std ${reg.stdDb} dB over 0.5 s blocks, searched from ${p.minStart} s)`,
      `loop ${p.len} s, equal-power crossfade ${p.xf} s`, `margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS (${g.toFixed(1)} dB)`];
  }
  const mp3 = encodeMp3(chs[0], sr, p.kbps);
  ops.push(`mp3 mono ${p.kbps} kbps`);
  const name = `${c.id}.mp3`;
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
for (const cue of CUES_HEAD_HIT) if (!manifest[cue]) throw new Error(`cue ${cue} has no clip`);

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(12), p.url.padEnd(38), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', p.loop ? `loop ${p.loop.start}+${p.loop.length}` : 'one-shot', '|', p.ops.join(' · '));
console.log(`total ${total} bytes (cap ${BYTE_CAP})`);
if (total > BYTE_CAP) throw new Error(`new runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/headhit-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK}: the HEAD-HIT cue — a bony skull crack layered over the flesh hit confirm on a
// confirmed head hit (audio/sfx.ts headHit).

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_HEAD_HIT: Readonly<Record<string, readonly ClipRef[]>> = {
${Object.entries(manifest).map(([cue, refs]) => ` ${cue}: [\n${refs.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_HEAD_HIT: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_HEAD_HIT = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-head-hit-20261107', task: TASK, lane: 'GENERAL',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's local Sound Lab allowance; ${queue.clips.length} jobs of a 4-job cap, both first takes accepted)`,
  plannedBy: 'tools/audio-pipeline/headhit-plan.py', rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/headhit-build.mjs',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (5 ms envelope, onsets, peak, spectral centroid / bands). The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  kbps: 64, derivatives: prov};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=).{0,20}/i); if (hit) throw new Error(`URL-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: name this set's provenance file (idempotent: replaces the sentence's tail once)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
if (!notice.includes('audio-head-hit.json')) {
  const tail = 'skyways-projector-loop.mp3): ../derivatives/audio-skyways-destinations.json).';
  if (!notice.includes(tail)) throw new Error('NOTICE.md: expected sentence tail not found');
  notice = notice.replace(tail, 'skyways-projector-loop.mp3): ../derivatives/audio-skyways-destinations.json; the head-hit set (skull crack\nhead-hit-01.mp3, head-hit-02.mp3): ../derivatives/audio-head-hit.json).');
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN head-hit-audio-20261107 (headhit-build.mjs) -->', E = '<!-- END head-hit-audio-20261107 -->';
const block = `${B}
## Head-hit audio (skull crack)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the general
feedback task's local Sound Lab allowance (${queue.clips.length} jobs of a 4-job cap). Powered by Stability AI. Stability AI Community
License + Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by \`tools/audio-pipeline/headhit-build.mjs\` (provenance: \`assets/derivatives/audio-head-hit.json\`). Not
reviewed by ear on the build worker. Raw takes are kept outside Git.

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
