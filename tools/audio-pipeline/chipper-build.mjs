#!/usr/bin/env node
// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane AUDIO): runtime derivatives of the train CHIPPER set — the electric motor's
// running LOOP, the wet GRIND loop (the rotor chewing a body, layered over the motor), the body FEED one-shot (a heavy wet body onto
// the steel hopper), the motor's spin-up START and its wind-down STOP. Planned by tools/audio-pipeline/chipper-plan.py (ids, cues,
// whole-second durations, seeds; the prompt text stays with the private raw archive) and generated through
// tools/audio-pipeline/soundlab_runner.py (one fsynced intent per POST; SOUND_LAB_MAX_POSTS 12 on one ledger; /tmp/ll-soundlab.lock).
// This builder makes NO Sound Lab call: it edits the generated clips only (trim / fades / loop crossfade / level) and never creates
// sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/corpse-chipper-fuel-20261110-235304/audio) {queue.json,
//   raw/<id>.wav, raw/<id>.sidecar.json}; each raw is verified against its runner sidecar SHA-256 and its recorded request against the
//   queue. Structural QC only (the worker cannot listen: the user taste-tests in game).
// Outputs: game/public/assets/audio/chipper-{motor-loop,grind-loop,feed,start,stop}.mp3, game/src/audio/manifest.chipper.generated.ts
//   (merged into bank.ts CLIP_MANIFEST), game/public/assets/derivatives/audio-chipper.json (provenance: job ids, seeds, hashes — NO
//   prompt text, NO private paths), the NOTICE / CREDITS block, tools/release/public-inputs.json (only these paths).
//
// Ops: mono downmix (mean) -> one-shots: trim [a, b] + cosine fades + peak -1 dBFS; loops: the most stationary window
//   (lib/dsp stationaryRegion) -> equal-power crossfaded loop (makeLoop) with periodic decoder margins (withLoopMargins) + RMS -20 dBFS
//   (the bed / machine-loop convention) -> MP3 (lamejs, mono, 64 kbps at 44.1 kHz). Loop seams are checked structurally (the sample
//   step across the wrap vs the clip's typical step; the 50 ms level either side). Cap: <= 200 KB of new runtime audio.
// Mix: a suggested CUE_GAIN per cue = 10^((target - measured) / 20), capped at 1 (no boost), recorded in the provenance mixCalibration;
//   audio/sfx.ts CUE_GAIN carries these values (first estimates for the ear pass; the test pins them to this record).
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/chipper-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {loudness} from './lib/structural.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-corpse-chipper-fuel-20261110-235304-01';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, 'reference/tasks/corpse-chipper-fuel-20261110-235304/audio'), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.chipper.generated.ts');
const PROV_REL = 'assets/derivatives/audio-chipper.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run');
const JOB_CAP = 12;
const LOOP_MARGIN_S = 0.1;
const BYTE_CAP = 200 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');
const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3);

/** The runtime cues of this build (game/src/audio/bank.ts CUES). */
export const CUES_CHIPPER = ['chipperMotor', 'chipperGrind', 'chipperFeed', 'chipperStart', 'chipperStop'];

/**
 * Per clip (structural QC of the raw, 0.1 s levels / 0.25 s spectral centroid; nothing listened to):
 *  - motor: fade-in to 0.7 s, a steady tonal machine body 0.7-7.0 s (-16..-21 dB, flatness 0.03, half the energy under 300 Hz), a
 *    decay from 7.1 s, silent from 9.3 s: the loop comes from the steadiest window inside 0.8-8.4 s;
 *  - grind: a continuous irregular crunching texture 0.2-7.9 s (spread 7 dB, flatness 0.25: not a noise wall), thinning after 7.9 s;
 *    the loop comes from the steadiest window inside 1.5-7.9 s;
 *  - feed: a faint lead-in at 0.13 s, the heavy hit at 0.30 s (peak at 0.42 s, 80 % of the energy under 300 Hz), down 30 dB by 1.1 s,
 *    a low tail to ~1.9 s, silence after;
 *  - start: a clunk at 0.1 s, a rising whine (centroid 1.4 -> 2.4 kHz over ~2 s), a steady body to 3.5 s, silence from 4.4 s;
 *  - stop: a clunk at 0.1 s, the running level to ~3 s, a falling level 3.0-4.5 s, a last rattle at 4.6 s, silence from 4.9 s (a faint
 *    stray blip at 5.3 s is trimmed off).
 * `target`: the cue's loudness at the source (LUFS, after CUE_GAIN): one-shots by their maximum momentary loudness, loops integrated.
 */
const PLAN = {
  'chipper-motor-loop-01': {kind: 'loop', name: 'chipper-motor-loop', len: 5.5, xf: 0.5, minStart: 0.8, endGuard: 1.6, kbps: 64, target: -28,
    why: 'the running motor: a bed in the car the player stands in, above the market murmur beds (-31), under every combat cue'},
  'chipper-grind-loop-01': {kind: 'loop', name: 'chipper-grind-loop', len: 5.5, xf: 0.5, minStart: 1.5, endGuard: 2.1, kbps: 64, target: -25,
    why: 'the wet grind over the motor while a body is processed: clearly heard, under combat'},
  'chipper-feed-01': {kind: 'oneshot', name: 'chipper-feed', a: 0.1, b: 2.0, fadeIn: 0.01, fadeOut: 0.5, kbps: 64, target: -21,
    why: 'a heavy body landing in the hopper: about an enemy attack (-20.3) / a market grunt (-21)'},
  'chipper-start-01': {kind: 'oneshot', name: 'chipper-start', a: 0, b: 3.2, fadeIn: 0.005, fadeOut: 1.0, kbps: 64, target: -26,
    why: 'the switch clunk + spin-up: its steady part hands over to the motor loop (-28) as it fades, ~2 dB above it (no step)'},
  'chipper-stop-01': {kind: 'oneshot', name: 'chipper-stop', a: 0, b: 5.2, fadeIn: 0.005, fadeOut: 0.35, kbps: 64, target: -26,
    why: 'the switch clunk + coast-down to silence: its running part takes over from the fading motor loop (-28) at about its level'},
};
/** Raws rejected by structural QC (replaced through batch B), with the reason. None: every first take was accepted. */
const REJECTED = {};

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}
/** Max momentary (400 ms) loudness, zero-padded to one full block so short one-shots measure like long ones. */
function momentaryMax(x, sr) {
  const n = Math.max(x.length, Math.round(0.4 * sr)), y = new Float64Array(n);
  y.set(x);
  return loudness(y, sr).momentaryMaxLufs;
}
/** Integrated loudness of a loop played twice (no edge effect at the block grid). */
function loopIntegrated(lp, sr) {
  const y = new Float64Array(lp.length * 2);
  y.set(lp); y.set(lp, lp.length);
  return loudness(y, sr).integratedLufs;
}
/** Structural loop-seam check: the sample step across the wrap vs the median step, and the 50 ms RMS either side (dB). */
function seam(lp, sr) {
  const L = lp.length, steps = new Float64Array(L - 1);
  for (let i = 1; i < L; i++) steps[i - 1] = Math.abs(lp[i] - lp[i - 1]);
  const sorted = Float64Array.from(steps).sort(), med = sorted[sorted.length >> 1] || 1e-9, p99 = sorted[Math.floor(sorted.length * 0.99)];
  const wrap = Math.abs(lp[0] - lp[L - 1]), W = Math.round(0.05 * sr);
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += lp[i] * lp[i]; return Math.sqrt(s / Math.max(1, b - a)); };
  // the texture's own 50 ms -> 50 ms level changes inside the loop (an irregular grind varies far more than a steady motor)
  const jumps = [];
  for (let a = 0; a + 2 * W <= L; a += W) jumps.push(Math.abs(D.linToDb(rms(a + W, a + 2 * W)) - D.linToDb(rms(a, a + W))));
  jumps.sort((x, y) => x - y);
  return {wrapStep: +wrap.toExponential(3), medianStep: +med.toExponential(3), wrapOverMedian: r2(wrap / med), wrapOverP99: r2(wrap / p99),
    levelJumpDb: r2(D.linToDb(rms(0, W)) - D.linToDb(rms(L - W, L))), adjacentJumpP95Db: r2(jumps[Math.floor(jumps.length * 0.95)] ?? 0)};
}

const queueDoc = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')), queue = queueDoc.clips;
if (queue.length > JOB_CAP) throw new Error(`queue holds ${queue.length} clips: over the ${JOB_CAP}-job allowance`);
for (const c of queue) if (!PLAN[c.id] && !REJECTED[c.id]) throw new Error(`${c.id}: neither planned nor recorded as rejected`);

const manifest = {}, files = [], prov = [], rejected = [], mix = {};
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
  if (REJECTED[c.id]) { rejected.push({...source, reason: REJECTED[c.id]}); continue; }
  const p = PLAN[c.id];
  const w = readWav(rawBuf), sr = w.sampleRate;
  if (sr !== 44100) throw new Error(`${c.id}: sample rate ${sr} (the bank contract is 44.1 kHz)`);
  const mono = [D.downmix(w.channels)];
  let chs, loop = null, ops, seamQc = null, measured;
  if (p.kind === 'oneshot') {
    chs = D.slice(mono, Math.round(p.a * sr), Math.min(mono[0].length, Math.round(p.b * sr)));
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    const g = D.normalisePeak(chs, -1);
    ops = ['mono', `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`, `peak -1 dBFS (${g.toFixed(1)} dB)`];
    measured = momentaryMax(chs[0], sr);
  } else {
    const reg = D.stationaryRegion(mono[0], sr, p.len + p.xf, {minStartS: p.minStart, endGuardS: p.endGuard});
    const lp = D.makeLoop(mono, sr, reg.startS, p.len, p.xf);
    seamQc = seam(lp[0], sr);
    // a click = a wrap step beyond the clip's own 99th-percentile sample step; a level seam = a 50 ms level change across the wrap beyond
    // 3 dB or (an irregular texture) beyond its own 95th-percentile 50 ms -> 50 ms change, and never more than 6 dB
    if (seamQc.wrapOverP99 > 1 || Math.abs(seamQc.levelJumpDb) > Math.min(6, Math.max(3, seamQc.adjacentJumpP95Db))) throw new Error(`${c.id}: loop seam fails the structural check ${JSON.stringify(seamQc)}`);
    chs = D.withLoopMargins(lp, sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, -1);
    loop = {start: LOOP_MARGIN_S, length: +(lp[0].length / sr).toFixed(6)};
    ops = ['mono', `stationary window from ${reg.startS} s (std ${reg.stdDb} dB over 0.5 s blocks, searched from ${p.minStart} s, end guard ${p.endGuard} s)`,
      `loop ${p.len} s, equal-power crossfade ${p.xf} s`, `margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS (${g.toFixed(1)} dB)`];
    measured = loopIntegrated(chs[0].subarray(Math.round(LOOP_MARGIN_S * sr), Math.round(LOOP_MARGIN_S * sr) + lp[0].length), sr);
  }
  const cueGain = Math.min(1, +Math.pow(10, (p.target - measured) / 20).toFixed(2));
  mix[c.cue] = {measure: p.kind === 'loop' ? 'integrated (loop x2)' : 'max momentary', measuredLufs: r1(measured), targetLufs: p.target,
    cueGain, atSourceLufs: r1(measured + 20 * Math.log10(cueGain)), why: p.why};
  const mp3 = encodeMp3(chs[0], sr, p.kbps);
  ops.push(`mp3 mono ${p.kbps} kbps`);
  const url = `assets/audio/${p.name}.mp3`;
  const dur = +(chs[0].length / sr).toFixed(4);
  (manifest[c.cue] ??= []).push({url, dur, ...(loop ? {loop} : {}), src: c.id});
  files.push({url, buf: mp3});
  prov.push({cue: c.cue, url, bytes: mp3.length, sha256: sha(mp3), dur, ...(loop ? {loop, seam: seamQc} : {}), ops, source});
}
for (const cue of CUES_CHIPPER) if (!manifest[cue]) throw new Error(`cue ${cue} has no clip`);

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(13), p.url.padEnd(34), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', p.loop ? `loop ${p.loop.start}+${p.loop.length} seam ${JSON.stringify(p.seam)}` : 'one-shot', '|', p.ops.join(' · '));
for (const [cue, m] of Object.entries(mix)) console.log('mix', cue.padEnd(13), JSON.stringify(m));
console.log(`total ${total} bytes (cap ${BYTE_CAP})`);
if (total > BYTE_CAP) throw new Error(`new runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/chipper-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (lane AUDIO): the train CHIPPER set — the
// electric motor's running loop, the wet grind loop, the body feed, the spin-up and the wind-down (audio/chipperAudio.ts).

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_CHIPPER: Readonly<Record<string, readonly ClipRef[]>> = {
${Object.entries(manifest).map(([cue, refs]) => ` ${cue}: [\n${refs.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_CHIPPER: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_CHIPPER = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-chipper-20261111', task: TASK, lane: 'AUDIO',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's local Sound Lab allowance: ${queue.length} jobs of a ${JOB_CAP}-job cap including retries, every first take accepted; the rest of the allowance closed unused)`,
  plannedBy: 'tools/audio-pipeline/chipper-plan.py (ids, cues, durations, seeds; the prompt text stays with the private raw archive)',
  rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/chipper-build.mjs',
  reuse: 'Checked first (audio/bank.ts): the Reactor / Bunker machine cues are a diesel generator, fan air, a servo ratchet, a beacon motor and a pump with water; bodyFall is a dry thud on concrete; nothing grinds wet flesh and bone. So five cues were generated, one take each.',
  privacy: 'This public record names each raw take by its Sound Lab job id, seed and SHA-256 (raw WAV, lab sidecar, prompt). The prompt text, the raw takes and their paths stay in the private raw archive (independent backup), not in Git.',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (per-0.1 s level, per-0.25 s spectral centroid, spectrogram images, band shares, flatness, peak, clipping, silence, loop-seam step / level jump, BS.1770 loudness). The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  loudness: {method: 'ITU-R BS.1770-4 K-weighting, 400 ms blocks / 75 % overlap; one-shots: maximum momentary loudness (zero-padded to one block); loops: integrated loudness of the loop played twice; sample peak (no true-peak oversampling)'},
  mixCalibration: {note: 'CUE_GAIN (audio/sfx.ts) per cue = 10^((target - measured) / 20), capped at 1 (no boost): the target is the cue\'s loudness at the source (derivative x CUE_GAIN, before distance / room / master). First estimates for the ear pass.', cues: mix},
  kbps: 64, derivatives: prov, rejectedRaws: rejected};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=|reference\/|\.wav|TrackType).{0,20}/i); if (hit) throw new Error(`URL / private path / prompt-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: this set's sentence (rewritten in place between its fixed head and tail; first added after the gun set's)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
{
  const head = 'the train chipper set (', tail = '): ../derivatives/audio-chipper.json';
  const sentence = `${head}motor loop chipper-motor-loop.mp3, wet grind loop chipper-grind-loop.mp3, body feed\nchipper-feed.mp3, spin-up chipper-start.mp3, wind-down chipper-stop.mp3; seeds and hashes only, the prompts stay with the private raw takes${tail}`;
  const i0 = notice.indexOf(head), i1 = notice.indexOf(tail);
  if (i0 >= 0 && i1 > i0) notice = notice.slice(0, i0) + sentence + notice.slice(i1 + tail.length);
  else {
    const anchor = '../derivatives/audio-gun-variety.json).';
    if (!notice.includes(anchor)) throw new Error('NOTICE.md: expected sentence anchor not found');
    notice = notice.replace(anchor, `../derivatives/audio-gun-variety.json; ${sentence}).`);
  }
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN train-chipper-audio-20261111 (chipper-build.mjs) -->', E = '<!-- END train-chipper-audio-20261111 -->';
const block = `${B}
## Train chipper audio (motor loop, wet grind loop, body feed, spin-up, wind-down)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the chipper
task's local Sound Lab allowance (${queue.length} jobs of a ${JOB_CAP}-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades, loop,
levelling, MP3) built by \`tools/audio-pipeline/chipper-build.mjs\` (provenance: \`assets/derivatives/audio-chipper.json\`). Not reviewed
by ear on the build worker. Raw takes are kept outside Git.

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
