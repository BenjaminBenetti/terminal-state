#!/usr/bin/env node
// Task studio-screacher-production-20261110-221858-01 (lane AUDIO): runtime derivatives of THE SCREACHER'S VOICE — the headless enemy's
// echolocation scream (the audible tell of every echo pulse), its short frenzy shriek (also played quieter / higher when it is hurt), its
// quiet wet idle wheeze and its death gurgle. Generated through tools/audio-pipeline/soundlab_runner.py (one fsynced intent per POST;
// whole-second durations; SOUND_LAB_MAX_POSTS 12 on one ledger; /tmp/ll-soundlab.lock) from a plan kept with the private raw archive (the
// prompts stay private). This builder makes NO Sound Lab call: it edits the generated clips only (trim / fades / level) and never
// creates sound. Its footsteps, body falls and hit impacts reuse existing cues (no clips here).
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/screacher-production-20261110-221858/audio) {queue.json,
//   raw/<id>.wav, raw/<id>.sidecar.json}, each raw verified against its runner sidecar SHA-256 (and the lab's recorded request);
//   game/public/assets/derivatives/audio-track1.json (the existing cues' mix calibration: the loudness references).
// Outputs: game/public/assets/audio/screacher-*.mp3, game/src/audio/manifest.screacher.generated.ts (cue list + clips + mix gains, merged
//   by bank.ts; sfx.ts CUE_GAIN carries the same gains), game/public/assets/derivatives/audio-screacher.json (provenance: job ids, seeds,
//   hashes, structural metrics, the mix calibration — NO prompt text, NO private paths), the NOTICE sentence / CREDITS block,
//   tools/release/public-inputs.json (only these paths). With --qc: one structural QC image per derivative into $SOUND_LAB_AUDIO_DIR/qc/built
//   (private; never in Git).
//
// Ops: mono downmix (mean) -> window DC removal -> trim [a, b] + cosine fades -> peak -1 dBFS -> the takes of a cue lowered to the
//   quietest take's momentary-max loudness (variants sit at one level) -> MP3 (lamejs, mono; scream / shriek 128 kbps, wheeze / death 96).
// Mix: CUE_GAIN per cue = 10^((target - measured) / 20), capped at 1 (no boost): `MIX` = the cue's momentary-max loudness AT THE SOURCE
//   (derivative x CUE_GAIN, before distance / occlusion / master), set against the existing cues' calibration.
// Structural QC only (the worker cannot listen): every gate below describes signal structure, not how it sounds.
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/screacher-build.mjs [--dry-run] [--qc]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {structure, loudness, envelopeDb, publicMetrics} from './lib/structural.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-screacher-production-20261110-221858-01';
const RAW_REL = 'reference/tasks/screacher-production-20261110-221858/audio';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.screacher.generated.ts');
const PROV_REL = 'assets/derivatives/audio-screacher.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run'), QC = process.argv.includes('--qc');
const JOB_CAP = 12;
const BYTE_CAP = 220 * 1024;
const PEAK_CEIL_DB = -1;
const sha = b => createHash('sha256').update(b).digest('hex');
const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3);

/** Runtime cue order (decode priority: the scream first). */
const CUE_ORDER = ['screacherScream', 'screacherShriek', 'screacherWheeze', 'screacherDeath'];
const KIND = {screacherScream: 'scream', screacherShriek: 'shriek', screacherWheeze: 'wheeze', screacherDeath: 'death'};
const KBPS = {screacherScream: 128, screacherShriek: 128, screacherWheeze: 96, screacherDeath: 96};

/**
 * Target momentary-max loudness of each cue AT THE SOURCE (derivative x CUE_GAIN), LUFS — first estimates for the user's ear pass, set
 * against the existing calibration (derivatives/audio-track1.json mixCalibration: zombie groan -18.5, zombie death -17.1, zombie attack
 * -20.3, Siren wake scream -15.8, Siren hum -24.3, the player's hurt grunt -24.0):
 *  - scream: the echo tell — as loud at the source as the Siren's wake scream, the loudest enemy vocal (+2.7 LU over a groan);
 *  - shriek: the frenzy bark — over a groan, under the echo scream (the hurt yelp is the same takes at the Sfx's call gain: `HURT`);
 *  - wheeze: quiet and near — 6 LU under a groan (about the Siren's hum);
 *  - death: a collapsing gurgle — 1 LU under a groan (softer than a zombie's death rattle, still a clear kill confirmation).
 */
const MIX = {
  screacherScream: {targetLufs: -15.8, basis: 'sirenScream', why: 'as loud at the source as the Siren\'s wake scream (the loudest enemy vocal)'},
  screacherShriek: {targetLufs: -17.5, basis: 'zombieGroan', why: '1 LU over a zombie groan, 1.7 LU under the echo scream'},
  screacherWheeze: {targetLufs: -24.5, basis: 'zombieGroan', why: '6 LU under a zombie groan (about the Siren\'s hum)'},
  screacherDeath: {targetLufs: -19.5, basis: 'zombieGroan', why: '1 LU under a zombie groan, 2.4 LU under a zombie death'},
};
/** The hurt yelp = the shriek takes at this call gain / playback rate (mirrors audio/sfx.ts SCREACHER_AUDIO.hurt; pinned by tests/screacher-audio.test.ts). */
const HURT = {gain: 0.55, rate: 1.15};

/**
 * Per accepted take: its derivative window(s). The windows were placed on the takes' 5 ms envelopes (private QC):
 *  - scream (takes 01 / 03 / 04: one request, three seeds — one family: a single ~2.1-2.4 s event with a dominant partial near 1.33 kHz
 *    and broadband roughness): the start is cut ~0.1 s INTO the take's own rise (which takes ~0.23 s from silence to its plateau) so the
 *    clip is within 6 dB of its loudest moment inside 0.1 s (the hard onset of the tell); the end is cut in the take's own decline with
 *    a long cosine fade (it falls off). 1.8-1.9 s.
 *  - shriek (takes 03 / 04: one request, two seeds): one short unvoiced rasp burst each; the quiet first step of the take is trimmed so
 *    the clip stays 0.5 s long and reaches its loud part ~0.15 s in; the end is the take's own fast decay.
 *  - wheeze: take 02 is one 2 s rattling low-mid noise with a natural pause at 0.93 s = two breaths; take 01's first two short bursts
 *    (a silence between) = one double breath.
 *  - death: the whole gurgle (two sputtering phrases) from inside its quiet rising start to its own end.
 */
const PLAN = {
  'screacher-scream-01': [{cue: 'screacherScream', a: 0.13, b: 2.0, fadeIn: 0.006, fadeOut: 0.3}],
  'screacher-scream-03': [{cue: 'screacherScream', a: 0.11, b: 2.0, fadeIn: 0.006, fadeOut: 0.5}], // (its plateau runs to 1.55 s: the longer fade follows the take's own decline)
  'screacher-scream-04': [{cue: 'screacherScream', a: 0.12, b: 2.0, fadeIn: 0.006, fadeOut: 0.3}],
  'screacher-shriek-03': [{cue: 'screacherShriek', a: 0.17, b: 0.69, fadeIn: 0.005, fadeOut: 0.03}],
  'screacher-shriek-04': [{cue: 'screacherShriek', a: 0.14, b: 0.65, fadeIn: 0.005, fadeOut: 0.03}],
  'screacher-wheeze-02': [{cue: 'screacherWheeze', a: 0.045, b: 0.915, fadeIn: 0.02, fadeOut: 0.03}, {cue: 'screacherWheeze', a: 0.925, b: 2.065, fadeIn: 0.01, fadeOut: 0.03}],
  'screacher-wheeze-01': [{cue: 'screacherWheeze', a: 0.095, b: 1.425, fadeIn: 0.01, fadeOut: 0.02}],
  'screacher-death-01': [{cue: 'screacherDeath', a: 0.23, b: 1.93, fadeIn: 0.01, fadeOut: 0.04}],
};
/** Generated but not used (structural rejection, recorded publicly by job id; the raws stay in the private archive). */
const REJECTED = {
  'screacher-scream-02': 'a nearly pure steady tone (f0 1.63 kHz within 1.1 semitones, voiced 83 %, spectral flatness 0.021: the register and tonality of the Siren\'s wake scream, whose take 01 measures f0 1.57 kHz / flatness 0.017) in a two-stage swell (loudest 1.1 s after its start, rise 685 ms): it fails the rough-voice criterion and, untrimmed, the hard onset; the cue ships three takes of the other request instead',
  'screacher-shriek-01': 'a 0.84 s rasp that swells for 0.7 s and stops at its loudest moment (rise 565 ms: no bark attack), in a darker band than the accepted pair (centroid 1.19 kHz, 41 % of the energy under 1 kHz: fails the bright criterion): replaced by takes 03 / 04',
  'screacher-shriek-02': 'its loud event is only 0.25 s long (under the 0.5-0.9 s cue), after a 24 dB quieter pre-sound 0.3 s earlier: replaced by takes 03 / 04',
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
/**
 * Level spread (dB): the standard deviation of the RMS envelope over `hopS` frames within 35 dB of the loudest one. At 20 ms frames it
 * measures a RATTLE (fast level fluctuation): the wheeze takes read 5.1-6.3 dB, steady sounds 1.0-1.8 dB (the scream takes' plateaus, the
 * Blightbelly gas hiss; private QC). 50 ms frames (structure().levelSpreadDb) average a rattle faster than ~20 Hz away (2.7 dB for the
 * second breath of wheeze take 02), so the wheeze gate reads the 20 ms figure.
 */
function spreadDb(x, sr, hopS) {
  const env = [...envelopeDb(x, sr, hopS)], mx = Math.max(...env), act = env.filter(e => e > mx - 35);
  const mean = act.reduce((p, q) => p + q, 0) / act.length;
  return r2(Math.sqrt(act.reduce((p, q) => p + (q - mean) ** 2, 0) / act.length));
}
/** Seconds from the clip start to the first 5 ms frame within `db` of the clip's loudest 5 ms frame. */
function timeToWithin(x, sr, db) {
  const env = envelopeDb(x, sr, 0.005), mx = Math.max(...env);
  return r3(env.findIndex(e => e >= mx - db) * 0.005);
}

/** Structural gate of a derivative per cue kind (NOT a listening test). Thresholds follow the cue definitions of the lane brief. */
function gate(kind, m, x, sr, edges) {
  const c = [];
  const req = (name, ok, value, need) => c.push({name, ok: !!ok, value, need});
  const b = m.spectral.bands, above1k = (b['1000-3000Hz'] ?? 0) + (b['3000-8000Hz'] ?? 0) + (b['8000-22050Hz'] ?? 0), below1k = (b['0-300Hz'] ?? 0) + (b['300-1000Hz'] ?? 0);
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  const noiseWall = m.levelSpreadDb < 2 && m.spectral.flatness >= 0.35 && m.pitch.voicedFrac < 0.1;
  req('not a broadband noise wall', !noiseWall, {levelSpreadDb: m.levelSpreadDb, flatness: m.spectral.flatness, voicedFrac: m.pitch.voicedFrac}, 'NOT (spread < 2 dB AND flatness >= 0.35 AND voiced < 0.1)');
  req('no clipping, under the ceiling', m.clippedFrac < 1e-4 && m.peakDbfs <= PEAK_CEIL_DB + 0.1, {clippedFrac: m.clippedFrac, peakDbfs: m.peakDbfs}, `no clipped samples, peak <= ${PEAK_CEIL_DB} dBFS`);
  req('no DC', Math.abs(mean) <= 3e-3, +mean.toExponential(1), '|mean| <= 0.003');
  req('no click at the edges (faded to zero)', Math.abs(x[0]) < 1e-3 && Math.abs(x[x.length - 1]) < 1e-3, {first: +x[0].toExponential(1), last: +x[x.length - 1].toExponential(1)}, 'first / last sample ~ 0');
  const t6 = timeToWithin(x, sr, 6), rattle = spreadDb(x, sr, 0.02);
  if (kind === 'scream') {
    req('long (1.4-1.9 s)', m.durationS >= 1.4 && m.durationS <= 1.9, m.durationS, '1.4-1.9 s');
    req('hard onset', t6 <= 0.1, t6, 'within 6 dB of its loudest 5 ms frame <= 0.1 s after the clip start');
    req('one sustained event', m.quietFrac <= 0.25, m.quietFrac, 'quiet <= 0.25');
    req('piercing', m.spectral.centroidHz >= 1200 && above1k >= 0.5, {centroidHz: m.spectral.centroidHz, shareAbove1k: r2(above1k)}, 'centroid >= 1200 Hz, >= 50 % above 1 kHz');
    req('a voice (pitched), not a hiss', m.pitch.voicedFrac >= 0.2, {voicedFrac: m.pitch.voicedFrac, f0MedianHz: m.pitch.f0MedianHz}, 'voiced >= 0.2');
    req('rough, not a pure tone', !(m.pitch.voicedFrac >= 0.8 && m.spectral.flatness <= 0.025), {voicedFrac: m.pitch.voicedFrac, flatness: m.spectral.flatness}, 'NOT (voiced >= 0.8 AND flatness <= 0.025)');
    req('falls off at the end', m.decay.lastMinusFirstDb <= -6, m.decay.lastMinusFirstDb, 'last quarter >= 6 dB under the first quarter');
  } else if (kind === 'shriek') {
    req('short (0.5-0.9 s)', m.durationS >= 0.5 && m.durationS <= 0.9, m.durationS, '0.5-0.9 s');
    req('loud quickly (no slow swell)', t6 <= 0.2, t6, 'within 6 dB of its loudest 5 ms frame <= 0.2 s after the clip start');
    req('bright', m.spectral.centroidHz >= 1200 && above1k >= 0.5, {centroidHz: m.spectral.centroidHz, shareAbove1k: r2(above1k)}, 'centroid >= 1200 Hz, >= 50 % above 1 kHz');
    req('a rasp (unvoiced)', m.pitch.voicedFrac <= 0.3, m.pitch.voicedFrac, 'voiced <= 0.3');
    req('ends in silence', edges.endDb <= -24, edges.endDb, 'the cut end >= 24 dB under the take peak');
  } else if (kind === 'wheeze') {
    req('a breath (0.8-1.6 s)', m.durationS >= 0.8 && m.durationS <= 1.6, m.durationS, '0.8-1.6 s');
    req('breath noise (unvoiced)', m.pitch.voicedFrac <= 0.3, m.pitch.voicedFrac, 'voiced <= 0.3');
    req('low-mid rasp (not a hiss, not a scream)', m.spectral.centroidHz <= 1500 && below1k >= 0.6, {centroidHz: m.spectral.centroidHz, shareUnder1k: r2(below1k)}, 'centroid <= 1.5 kHz, >= 60 % under 1 kHz');
    req('fluctuating level (wet / rattling)', rattle >= 3, rattle, '20 ms level spread >= 3 dB (a steady hiss reads < 2 dB)');
    req('starts and ends in silence', edges.startDb <= -24 && edges.endDb <= -24, edges, 'both cuts >= 24 dB under the take peak');
  } else if (kind === 'death') {
    req('one collapse (1.0-1.8 s)', m.durationS >= 1.0 && m.durationS <= 1.8, m.durationS, '1.0-1.8 s');
    req('a gurgle (mostly unvoiced)', m.pitch.voicedFrac <= 0.4, m.pitch.voicedFrac, 'voiced <= 0.4');
    req('low-mid (wet), not a hiss', below1k >= 0.5, r2(below1k), '>= 50 % under 1 kHz');
    req('sputtering level', m.levelSpreadDb >= 4, m.levelSpreadDb, '50 ms level spread >= 4 dB');
    req('ends in silence', edges.endDb <= -24, edges.endDb, 'the cut end >= 24 dB under the take peak');
  } else throw new Error(`unknown gate ${kind}`);
  return {kind, pass: c.every(q => q.ok), failed: c.filter(q => !q.ok).map(q => q.name), timeToWithin6DbS: t6, levelSpread20msDb: rattle, criteria: c};
}

const queueDoc = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')), queue = queueDoc.clips;
if (queue.length > JOB_CAP) throw new Error(`queue holds ${queue.length} clips: over the ${JOB_CAP}-job allowance`);
for (const c of queue) if (!PLAN[c.id] && !REJECTED[c.id]) throw new Error(`${c.id}: neither planned nor recorded as rejected`);
for (const id of [...Object.keys(PLAN), ...Object.keys(REJECTED)]) if (!queue.some(c => c.id === id)) throw new Error(`${id}: not in the queue`);

const derivs = [], rejected = [];
for (const c of queue) {
  const side = JSON.parse(fs.readFileSync(path.join(RAW, `${c.id}.sidecar.json`), 'utf8'));
  const rawBuf = fs.readFileSync(path.join(RAW, `${c.id}.wav`));
  if (sha(rawBuf) !== side.rawSha256) throw new Error(`${c.id}: raw sha mismatch`);
  if (side.request?.prompt !== c.prompt || side.request?.seed !== c.seed) throw new Error(`${c.id}: the lab's recorded request differs from the plan`);
  const jobId = side.job?.id ?? side.jobId ?? null;
  if (!/^\d{8}T\d{6}-\d+$/.test(String(jobId))) throw new Error(`${c.id}: no Sound Lab job id in the runner sidecar`);
  // public source record: hashes / ids / request numbers only — no prompt text, no private path or lab file name
  const source = {clip: c.id, jobId, seed: side.request.seed, seconds: side.request.seconds, steps: side.request.steps, cfg: side.request.cfg,
    rawSha256: side.rawSha256, rawBytes: side.rawBytes, labSidecarSha256: side.labSidecarSha256, promptSha256: sha(Buffer.from(side.request.prompt, 'utf8'))};
  if (REJECTED[c.id]) { rejected.push({cue: c.cue, ...source, reason: REJECTED[c.id]}); continue; }
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
if (references.sirenScream !== MIX.screacherScream.targetLufs) throw new Error('the scream target must equal the Siren wake scream\'s calibrated level');
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
const hurt = {takesOf: 'screacherShriek', callGain: HURT.gain, rate: HURT.rate, atSourceLufs: r1(mix.screacherShriek.atSourceLufs + 20 * Math.log10(HURT.gain)),
  note: 'the hurt yelp is the shriek takes at the Sfx call gain / playback rate (audio/sfx.ts SCREACHER_AUDIO.hurt): quieter and higher'};

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
for (const p of prov) console.log(p.cue.padEnd(16), p.url.padEnd(40), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', `M ${p.metrics.loudness.momentaryMaxLufs}`, `pk ${p.metrics.peakDbfs}`, `t6 ${p.gate.timeToWithin6DbS}`,
  `cen ${p.metrics.spectral.centroidHz}`, `flat ${p.metrics.spectral.flatness}`, `voiced ${p.metrics.pitch.voicedFrac}`, `f0 ${p.metrics.pitch.f0MedianHz}`, `quiet ${p.metrics.quietFrac}`, `spread ${p.metrics.levelSpreadDb}`,
  `l-f ${p.metrics.decay.lastMinusFirstDb}`, `edges ${p.metrics.edgesDb.startDb}/${p.metrics.edgesDb.endDb}`, p.gate.pass ? 'PASS' : 'FAIL');
for (const [c, m] of Object.entries(mix)) console.log('mix', c.padEnd(16), `measured ${m.measuredLufs} target ${m.targetLufs} gain ${m.cueGain} -> ${m.atSourceLufs} LUFS, peak ${m.atSourcePeakDbfs} dBFS (${m.vsReferenceLu >= 0 ? '+' : ''}${m.vsReferenceLu} LU vs ${m.basis} ${references[m.basis]})`);
console.log('mix hurt', JSON.stringify(hurt));
console.log(`total ${total} bytes (cap ${BYTE_CAP}); ${queue.length} jobs of ${JOB_CAP}; accepted ${Object.keys(PLAN).length}, rejected ${rejected.length}`);
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
  fs.writeFileSync(path.join(dir, 'derivatives-metrics.json'), JSON.stringify({mix, hurt, derivatives: prov}, null, 1) + '\n');
  console.log('qc:', pngs.length, 'images in', dir);
}
if (gateFailures.length) throw new Error(`${gateFailures.length} derivative(s) failed their structural gate (nothing written)`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/screacher-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (lane AUDIO): the Screacher's voice — the echolocation
// scream (the tell of every echo pulse), the frenzy shriek (also its hurt yelp, quieter / higher), the idle wheeze, the death gurgle
// (audio/sfx.ts screacherScream / screacherVoice, SCREACHER_AUDIO).

import type {ClipRef} from './manifest.generated';

/** This build's runtime cues, in decode-priority order (bank.ts CUES). */
export const SCREACHER_CUES = [
${CUE_ORDER.map(c => `  '${c}',`).join('\n')}
] as const;
export type ScreacherCue = (typeof SCREACHER_CUES)[number];

export const CLIP_MANIFEST_SCREACHER: Readonly<Record<string, readonly ClipRef[]>> = {
${CUE_ORDER.map(cue => ` ${cue}: [\n${manifest[cue].map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/**
 * Mix gain per cue (sfx.ts CUE_GAIN carries the same numbers) = 10^((target - measured) / 20), capped at 1: the cue's momentary-max
 * loudness at the source against the existing calibration. Measured / target LUFS in the provenance (mixCalibration).
 */
export const SCREACHER_CUE_GAIN: Readonly<Record<ScreacherCue, number>> = {
${CUE_ORDER.map(c => `  ${c}: ${mix[c].cueGain}, // ${mix[c].measuredLufs} -> ${mix[c].atSourceLufs} LUFS at the source (target ${mix[c].targetLufs}: ${mix[c].why})`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_SCREACHER: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_SCREACHER = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const accepted = Object.keys(PLAN).length;
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-screacher-20261110', task: TASK, lane: 'AUDIO',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's local Sound Lab allowance: ${queue.length} jobs of a ${JOB_CAP}-job cap including retries — ${accepted} takes accepted, ${rejected.length} structurally rejected and replaced; the rest of the allowance closed unused)`,
  soundLab: {allowance: JOB_CAP, jobs: queue.length, accepted, rejected: rejected.length, unusedClosed: JOB_CAP - queue.length, paidOrExternal: 0},
  plannedBy: 'a plan kept with the private raw archive (the prompts stay private)', rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/screacher-build.mjs',
  privacy: 'This public record names each raw take by its Sound Lab job id, seed and SHA-256 (raw take, lab sidecar, prompt). The prompt text, the raw takes and their paths stay in the private raw archive (independent backup), not in Git.',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (5 ms / 50 ms envelopes, onsets, time to the loud part, quiet fraction, spectrogram images, spectral centroid / bands / flatness, YIN voicing, peak, DC, slice-edge levels, BS.1770 loudness). `metrics` / `gate` describe signal structure only, never how a clip sounds. The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  design: {
    screacherScream: 'Three takes of ONE request (three seeds), one family: a single sustained event with a dominant partial near 1.33 kHz and broadband roughness. Each clip starts about 0.1 s into the take\'s own rise, so it is within 6 dB of its loudest moment inside 0.1 s (the hard onset of the tell), and ends in the take\'s own decline under a long fade.',
    screacherShriek: 'Two takes of one request (two seeds): one short unvoiced rasp burst each. Every shriek take the generator returned swells into its loud part; the accepted pair reaches it about 0.15 s after the clip start (the quiet first step is trimmed) and ends on the take\'s own fast decay. A harder bark attack was not obtained within the allowance.',
    screacherWheeze: 'Three breaths from two takes: a 2 s rattling low-mid noise with a natural pause (two breaths) and a pair of short bursts with a silence between (one double breath).',
    screacherDeath: 'One take: the whole gurgle (two sputtering phrases), from inside its quiet rising start to its own end.',
    reused: 'Footsteps, body falls and hit impacts reuse the existing cues (no clips in this set).',
    flag: 'The scream sits in the register of the Siren\'s wake scream (dominant partial 1.3 kHz vs 1.1-1.6 kHz) and is rougher by the numbers (flatness 0.03-0.05 vs 0.017-0.02); whether the two read as different creatures needs an ear.'},
  loudness: {method: 'ITU-R BS.1770-4 K-weighting, 400 ms blocks / 75 % overlap (one-shots zero-padded to one block), maximum momentary loudness, mono; sample peak (no true-peak oversampling)'},
  mixCalibration: {note: 'CUE_GAIN (audio/sfx.ts; the same numbers as SCREACHER_CUE_GAIN in the generated manifest) per cue = 10^((target - measured) / 20), capped at 1 (no boost): the target is the cue\'s momentary-max loudness AT THE SOURCE (derivative x CUE_GAIN, before distance / occlusion / master), set against the existing cues\' calibration (derivatives/audio-track1.json mixCalibration). Never above the -1 dBFS ceiling. First estimates for the ear pass (not auditioned).',
    references, cues: mix, hurt},
  derivatives: prov, rejectedRaws: rejected};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=|reference\/|\.wav|TrackType).{0,20}/i); if (hit) throw new Error(`URL / private path / prompt-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: this set's sentence (rewritten in place between its fixed head and tail; first added after the weapon-variety gun set's)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
{
  const head = 'the Screacher voice set (', tail = '): ../derivatives/audio-screacher.json';
  const sentence = `${head}echo scream, frenzy shriek, idle wheeze, death gurgle,\nscreacher-*.mp3; seeds and hashes only, the prompts stay with the private raw takes${tail}`;
  const i0 = notice.indexOf(head), i1 = notice.indexOf(tail);
  if (i0 >= 0 && i1 > i0) notice = notice.slice(0, i0) + sentence + notice.slice(i1 + tail.length);
  else {
    const anchor = '../derivatives/audio-gun-variety.json).';
    if (!notice.includes(anchor)) throw new Error('NOTICE.md: expected sentence anchor not found');
    notice = notice.replace(anchor, `../derivatives/audio-gun-variety.json; ${sentence}).`);
  }
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild; other lanes' blocks are never touched)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN screacher-audio-20261110 (screacher-build.mjs) -->', E = '<!-- END screacher-audio-20261110 -->';
const block = `${B}
## Screacher audio (echo scream, frenzy shriek, idle wheeze, death gurgle)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the Screacher
task's local Sound Lab allowance (${queue.length} jobs of a ${JOB_CAP}-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by \`tools/audio-pipeline/screacher-build.mjs\` (provenance: \`assets/derivatives/audio-screacher.json\`). Not
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
