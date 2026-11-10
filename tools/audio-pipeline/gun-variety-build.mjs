#!/usr/bin/env node
// Task studio-weapon-soundlab-audio-20261110-063407-01: runtime derivatives of the SIX NEW GUNS' OWN SOUNDS (user: "the guns all use the
// same default gun noises, the sound lab server we setup is still available, please use that!"). Each weapon-variety gun gets its own
// Sound Lab shot (a dry single shot per bullet; two takes for the full-auto Hornet and Stub) and its own reload mechanics — magazine out /
// in, the Coach Gun's barrels breaking open / snapping shut — sliced from one reload take per gun. Generated through
// tools/audio-pipeline/soundlab_runner.py (one fsynced intent per POST; whole-second durations; SOUND_LAB_MAX_POSTS 24 on one ledger;
// /tmp/ll-soundlab.lock) from a plan kept with the private raw archive (the prompts stay private). This builder makes NO Sound Lab call: it
// edits the generated clips only (trim / fades / level) and never creates sound.
//
// Cue ids follow the weapon-id convention of game/src/audio/gunVoices.ts: `gun` + PascalCase(weapon id) + part (Shot / MagOut / MagIn /
// BreakOpen / BreakClose), so the held weapon's id finds its cues with no second list of guns.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/weapon-soundlab-audio-20261110-063407/audio) {queue.json,
//   raw/<id>.wav, raw/<id>.sidecar.json}, each raw verified against its runner sidecar SHA-256; the baseline shot / magazine raws (their
//   recorded runtime windows) as the loudness references.
// Outputs: game/public/assets/audio/gun-*.mp3, game/src/audio/manifest.gunVariety.generated.ts (cue list + clips + mix gains, merged by
//   bank.ts / sfx.ts), game/public/assets/derivatives/audio-gun-variety.json (provenance: job ids, seeds, hashes — NO prompt text, NO
//   private paths), the NOTICE / CREDITS block, tools/release/public-inputs.json (only these paths).
//
// Ops: mono downmix (mean) -> trim [a, b] + cosine fades -> peak -1 dBFS -> (multi-take cues) the louder take lowered to the quietest
//   take's momentary-max loudness, so rapid fire varies without volume spikes -> MP3 (lamejs, mono; shots 128 kbps, mechanics 96 kbps).
// Mix: CUE_GAIN per cue = 10^((target - measured) / 20), capped at 1 (no boost): the target is the baseline family's loudness at the
//   source (pistol / rifle / shotgun shot, rifle magazine out / in) measured the same way from the baseline raws' runtime windows.
// Structural QC only (the worker cannot listen): onsets, rise, quiet fraction, centroid / bands, peak, DC, edge levels, BS.1770 loudness.
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/gun-variety-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {structure, loudness} from './lib/structural.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-weapon-soundlab-audio-20261110-063407-01';
const RAW_REL = 'reference/tasks/weapon-soundlab-audio-20261110-063407/audio';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.gunVariety.generated.ts');
const PROV_REL = 'assets/derivatives/audio-gun-variety.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run');
const JOB_CAP = 24;
const BYTE_CAP = 200 * 1024;
const sha = b => createHash('sha256').update(b).digest('hex');
const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3);

/** Loudness references: the baseline cues' runtime windows (their derivative records) and how the game plays them (call gain x CUE_GAIN). */
const I05 = 'reference/tasks/vertical-slice-iteration05-20261026/audio/raw', I11 = 'reference/tasks/pistol-hit-audio-20261028/audio/raw';
const REFERENCE = {
  pistolShot: {gain: 0.9, takes: [[`${I11}/i11-pistol-shot-01.wav`, 0.001, 0.2766, 0.1102]]}, // WEAPON_SHOT_CUES.pistol.gain 0.9 x CUE_GAIN 1
  rifleShot: {gain: 1, takes: [1, 2, 3, 4].map(i => [`${I05}/rifle-shot-0${i}.wav`, 0, 1.6, 0.3])},
  shotgunShot: {gain: 1, takes: [1, 2, 3].map(i => [`${I05}/shotgun-shot-b-0${i}.wav`, null, null, 0.35])}, // windows read from the record
  rifleMagOut: {gain: 0.38, takes: [1, 2].map(i => [`${I05}/rifle-mag-out-b-0${i}.wav`, null, null, 0.06])},
  rifleMagIn: {gain: 0.42, takes: [1, 2].map(i => [`${I05}/rifle-mag-in-b-0${i}.wav`, null, null, 0.06])},
};

/**
 * Per accepted take: its derivative window(s) and cue. Shots: the single report from just before its onset through the decay (tail
 * faded), one bullet each. Reloads: two slices of the one take — magazine out (start of the reload) / magazine in (mid-reload), the
 * Coach Gun's lever + barrels swinging open / barrels snapped shut. `ref` = the baseline family whose loudness the cue matches. Every
 * magazine-in slice ends before the reload does (it plays at half the gun's reload time), so the reload's end cue (seat click / the
 * charging handle after an empty magazine) stays the one end sound — the Longslide's in slice stops before its take's slide snap.
 */
const SHOT = {fadeIn: 0.002, kbps: 128}, MECH = {fadeIn: 0.004, fadeOut: 0.05, kbps: 96};
const PLAN = {
  'hornet-shot-03': [{cue: 'gunHornetShot', ref: 'pistolShot', a: 0.295, b: 0.62, fadeOut: 0.14, ...SHOT}],
  'hornet-shot-05': [{cue: 'gunHornetShot', ref: 'pistolShot', a: 0.27, b: 0.58, fadeOut: 0.12, ...SHOT}],
  'longslide-shot-01': [{cue: 'gunLongslideShot', ref: 'pistolShot', a: 0, b: 0.62, fadeOut: 0.25, ...SHOT}],
  'stub-shot-01': [{cue: 'gunStubShot', ref: 'rifleShot', a: 0, b: 0.42, fadeOut: 0.15, ...SHOT}],
  'stub-shot-02': [{cue: 'gunStubShot', ref: 'rifleShot', a: 0.285, b: 0.7, fadeOut: 0.15, ...SHOT}],
  'overwatch-shot-01': [{cue: 'gunOverwatchShot', ref: 'rifleShot', a: 0, b: 0.45, fadeOut: 0.15, ...SHOT}],
  'coach-shot-01': [{cue: 'gunCoachGunShot', ref: 'shotgunShot', a: 0.005, b: 0.8, fadeOut: 0.3, ...SHOT}],
  'thresher-shot-01': [{cue: 'gunThresherShot', ref: 'shotgunShot', a: 0, b: 0.7, fadeOut: 0.25, ...SHOT}],
  'hornet-reload-01': [{cue: 'gunHornetMagOut', ref: 'rifleMagOut', a: 0.08, b: 0.36, ...MECH}, {cue: 'gunHornetMagIn', ref: 'rifleMagIn', a: 1.58, b: 2.14, ...MECH}],
  'longslide-reload-01': [{cue: 'gunLongslideMagOut', ref: 'rifleMagOut', a: 0.17, b: 0.56, ...MECH}, {cue: 'gunLongslideMagIn', ref: 'rifleMagIn', a: 1.66, b: 2.3, ...MECH}],
  'stub-reload-01': [{cue: 'gunStubMagOut', ref: 'rifleMagOut', a: 0.29, b: 0.56, ...MECH}, {cue: 'gunStubMagIn', ref: 'rifleMagIn', a: 1.86, b: 2.52, ...MECH}],
  'overwatch-reload-01': [{cue: 'gunOverwatchMagOut', ref: 'rifleMagOut', a: 0.06, b: 0.58, ...MECH}, {cue: 'gunOverwatchMagIn', ref: 'rifleMagIn', a: 1.76, b: 2.08, ...MECH}],
  'thresher-reload-01': [{cue: 'gunThresherMagOut', ref: 'rifleMagOut', a: 0.06, b: 0.42, ...MECH}, {cue: 'gunThresherMagIn', ref: 'rifleMagIn', a: 1.2, b: 1.72, ...MECH}],
  'coach-reload-01': [{cue: 'gunCoachGunBreakOpen', ref: 'rifleMagOut', a: 0.22, b: 0.56, ...MECH}, {cue: 'gunCoachGunBreakClose', ref: 'rifleMagIn', a: 1.96, b: 2.4, ...MECH}],
};
/** Generated but not used (structural rejection, recorded publicly by job id; the raws stay in the private archive). */
const REJECTED = {
  'hornet-shot-01': 'two comparable reports 0.3 s apart (not one shot per bullet) and a bright hiss burst with almost no body (0-300 Hz share 0.02, spectral flatness 0.43)',
  'hornet-shot-02': 'failed the transient-onset gate (a pre-click 0.13 s before the report) and a hiss burst with almost no body (0-300 Hz share 0.006, flatness 0.49)',
  'hornet-shot-04': 'a boomy low blast an octave below the accepted take 03 (centroid 0.75 vs 1.49 kHz, 0-300 Hz share 0.76 vs 0.22) with a large sub-sonic offset (window mean -0.027): it would alternate badly with 03 in full-auto fire; replaced by take 05 (take 03\'s request, a new seed)',
};
/** The two full-auto guns' cycle (game/src/weapons/varietyGuns.ts interval) — for the rapid-fire overlap check below. */
const AUTO = {gunHornetShot: 0.07, gunStubShot: 0.09};
/** Runtime cue order (decode priority: shots first). */
const CUE_ORDER = ['gunHornetShot', 'gunLongslideShot', 'gunStubShot', 'gunOverwatchShot', 'gunCoachGunShot', 'gunThresherShot',
  'gunHornetMagOut', 'gunHornetMagIn', 'gunLongslideMagOut', 'gunLongslideMagIn', 'gunStubMagOut', 'gunStubMagIn',
  'gunOverwatchMagOut', 'gunOverwatchMagIn', 'gunThresherMagOut', 'gunThresherMagIn', 'gunCoachGunBreakOpen', 'gunCoachGunBreakClose'];

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}
/** Max momentary (400 ms) loudness of one channel, zero-padded to one full block so short one-shots measure like long ones. */
function momentaryMax(x, sr) {
  const n = Math.max(x.length, Math.round(0.4 * sr)), y = new Float64Array(n);
  y.set(x);
  return loudness(y, sr).momentaryMaxLufs;
}
/** Channel-power mean of the per-channel momentary maxima (a stereo baseline plays both channels; a mono derivative plays L = R). */
function momentaryMaxChannels(chs, sr) {
  const p = chs.map(c => Math.pow(10, momentaryMax(c, sr) / 10));
  return 10 * Math.log10(p.reduce((s, v) => s + v, 0) / p.length);
}
function windowOf(file) {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/audio-iteration05.json'), 'utf8'));
  const d = doc.derivatives.find(x => x.source?.rawFile === file);
  const t = d?.ops?.find(o => o.op === 'trim');
  if (!t) throw new Error(`no recorded runtime window for ${file}`);
  return [t.startS, t.endS];
}
function referenceLufs(cue) {
  const ref = REFERENCE[cue], vals = [];
  for (const [file, a0, b0, fo] of ref.takes) {
    const [a, b] = a0 === null ? windowOf(file) : [a0, b0];
    const w = readWav(fs.readFileSync(path.join(ROOT, file))), sr = w.sampleRate;
    const chs = D.slice(w.channels.map(c => Float64Array.from(c)), Math.round(a * sr), Math.min(w.channels[0].length, Math.round(b * sr)));
    D.fade(chs, sr, 0.002, fo);
    D.normalisePeak(chs, -1);
    vals.push(momentaryMaxChannels(chs, sr));
  }
  const mean = 10 * Math.log10(vals.reduce((s, v) => s + Math.pow(10, v / 10), 0) / vals.length);
  return {cue, takes: vals.map(r1), atSourceLufs: r1(mean + 20 * Math.log10(ref.gain)), playGain: ref.gain};
}

const queueDoc = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')), queue = queueDoc.clips;
if (queue.length > JOB_CAP) throw new Error(`queue holds ${queue.length} clips: over the ${JOB_CAP}-job allowance`);
for (const c of queue) if (!PLAN[c.id] && !REJECTED[c.id]) throw new Error(`${c.id}: neither planned nor recorded as rejected`);

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
  if (REJECTED[c.id]) { rejected.push({...source, reason: REJECTED[c.id]}); continue; }
  const w = readWav(rawBuf), sr = w.sampleRate;
  if (sr !== 44100) throw new Error(`${c.id}: sample rate ${sr} (the bank contract is 44.1 kHz)`);
  const mono = D.downmix(w.channels);
  let rawPk = 0;
  for (const v of mono) rawPk = Math.max(rawPk, Math.abs(v));
  for (const p of PLAN[c.id]) {
    const A = Math.round(p.a * sr), B = Math.min(mono.length, Math.round(p.b * sr));
    // edge levels before the fades (a slice must not start or end inside a loud event)
    // (5 ms outside the cut + 0.5 ms inside it)
    const edge = (i, out) => { let e = 0; for (let k = Math.max(0, i - (out < 0 ? 220 : 22)); k < Math.min(mono.length, i + (out < 0 ? 22 : 220)); k++) e = Math.max(e, Math.abs(mono[k])); return r1(D.linToDb(e / rawPk)); };
    const chs = D.slice([Float64Array.from(mono)], A, B);
    let dc = 0;
    for (const v of chs[0]) dc += v;
    dc /= chs[0].length;
    for (let i = 0; i < chs[0].length; i++) chs[0][i] -= dc;
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    const g = D.normalisePeak(chs, -1);
    derivs.push({...p, take: c.id, source, sr, x: chs[0], ops: ['mono', `remove DC (${dc.toExponential(1)})`, `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`, `peak -1 dBFS (${g.toFixed(1)} dB)`],
      edges: {startDb: edge(A, -1), endDb: edge(B, 1)}});
  }
}

// multi-take cues: the louder take lowered to the quietest take's momentary-max loudness (no random volume spikes in rapid fire)
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
const refs = Object.fromEntries(Object.keys(REFERENCE).map(c => [c, referenceLufs(c)]));
const mix = {};
for (const cue of CUE_ORDER) {
  const list = byCue.get(cue);
  if (!list?.length) throw new Error(`cue ${cue} has no clip`);
  const ref = refs[list[0].ref], measured = Math.max(...list.map(d => d.lufs));
  const gain = Math.min(1, r2(Math.pow(10, (ref.atSourceLufs - measured) / 20)));
  mix[cue] = {reference: list[0].ref, targetLufs: ref.atSourceLufs, measuredLufs: r1(measured), cueGain: gain, atSourceLufs: r1(measured + 20 * Math.log10(gain))};
}

// structural record per derivative (NOT a listening test) + the gate
const files = [], prov = [], manifest = {};
const count = new Map();
for (const d of derivs) {
  const n = (count.get(d.cue) ?? 0) + 1;
  count.set(d.cue, n);
  const stem = d.cue.replace(/^gun/, 'gun-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const name = `${stem}-${String(n).padStart(2, '0')}.mp3`, url = `assets/audio/${name}`;
  const m = structure(d.x, d.sr), ons = D.onsets(d.x, d.sr, {riseDb: 10, floorDb: -30, minGapS: 0.06});
  let pk = 0, mean = 0;
  for (const v of d.x) { pk = Math.max(pk, Math.abs(v)); mean += v; }
  const isShot = /Shot$/.test(d.cue);
  // a second report = a later attack (>= 150 ms after the first) out of a near-silent gap (>= 20 dB below it over the 50 ms before)
  // and within 12 dB of the loudest: one shot per bullet. A boom's own ripples / the action clack inside one report are not re-attacks
  // from silence (the baseline rifle / shotgun takes ripple like this too).
  const hop = Math.round(d.sr * 0.005), env = D.envelope(d.x, hop), emax = Math.max(...env);
  let second = -Infinity;
  for (const o of ons.filter(o => o - ons[0] >= 0.15 * d.sr)) {
    const h = Math.floor(o / hop);
    let pre = Infinity, post = 0;
    for (let k = Math.max(0, h - 10); k < h; k++) pre = Math.min(pre, env[k]);
    for (let k = h; k < Math.min(env.length, h + 16); k++) post = Math.max(post, env[k]);
    if (D.linToDb(post / Math.max(pre, 1e-9)) >= 20) second = Math.max(second, D.linToDb(post / emax));
  }
  const gate = {
    peakDbfs: r1(D.linToDb(pk)), dc: +(mean / d.x.length).toExponential(1), clipped: pk >= 0.999, edgesDb: d.edges,
    onsetsS: ons.map(o => r3(o / d.sr)), riseMs: m.attack.riseMs, activeEndS: m.decay.activeEndS, centroidHz: m.spectral.centroidHz,
    flatness: m.spectral.flatness, low0to300: m.spectral.bands['0-300Hz'], momentaryMaxLufs: r1(d.lufs),
    ...(isShot ? {secondReportDb: Number.isFinite(second) ? r1(second) : null} : {}),
  };
  const fails = [];
  if (gate.clipped || gate.peakDbfs > -0.9) fails.push('peak');
  if (Math.abs(mean / d.x.length) > 3e-3) fails.push('dc'); // after the window's DC removal: the mean of a faded transient (< -50 dBFS)
  // a cut inside an event — except a take whose report starts at its very first sample (a = 0: the cosine fade-in is the onset)
  if ((d.a > 0 && d.edges.startDb > -24) || d.edges.endDb > -24) fails.push('slice edge inside an event');
  const riseCap = d.ref === 'shotgunShot' ? 60 : 30; // a shotgun boom builds slower (the baseline shotgun take: 35 ms)
  if (isShot && (m.attack.riseMs > riseCap || second > -12)) fails.push(m.attack.riseMs > riseCap ? 'slow onset' : 'second report');
  if (fails.length) throw new Error(`${name}: structural gate failed (${fails.join(', ')}) ${JSON.stringify(gate)}`);
  const mp3 = encodeMp3(d.x, d.sr, d.kbps);
  const dur = +(d.x.length / d.sr).toFixed(4);
  (manifest[d.cue] ??= []).push({url, dur, src: d.take});
  files.push({url, buf: mp3});
  prov.push({cue: d.cue, url, bytes: mp3.length, sha256: sha(mp3), dur, window: {startS: d.a, endS: d.b}, ops: [...d.ops, `mp3 mono ${d.kbps} kbps`], gate, source: d.source});
}

// rapid fire: N shots at the gun's cycle (alternating takes, cue gain, no jitter) summed — the overlap stays below full scale
const rapid = {};
for (const [cue, dt] of Object.entries(AUTO)) {
  const list = byCue.get(cue), sr = list[0].sr, N = 12, hop = Math.round(dt * sr);
  const len = hop * (N - 1) + Math.max(...list.map(d => d.x.length)), y = new Float64Array(len);
  for (let s = 0; s < N; s++) { const x = list[s % list.length].x; for (let i = 0; i < x.length; i++) y[s * hop + i] += x[i] * mix[cue].cueGain; }
  let pk = 0;
  for (const v of y) pk = Math.max(pk, Math.abs(v));
  rapid[cue] = {intervalS: dt, shots: N, sumPeakDbfs: r1(D.linToDb(pk)), singlePeakDbfs: r1(D.linToDb(Math.pow(10, -1 / 20) * mix[cue].cueGain))};
  if (pk >= 1) throw new Error(`${cue}: ${N} shots at ${dt} s sum to ${D.linToDb(pk).toFixed(1)} dBFS (clipped overlap)`);
}

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(22), p.url.padEnd(44), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', `M ${p.gate.momentaryMaxLufs}`, `cen ${p.gate.centroidHz}`, `low ${p.gate.low0to300}`, `rise ${p.gate.riseMs}`, `edges ${p.gate.edgesDb.startDb}/${p.gate.edgesDb.endDb}`, p.gate.secondReportDb !== undefined ? `2nd ${p.gate.secondReportDb}` : '');
for (const [c, r] of Object.entries(refs)) console.log('reference', c.padEnd(12), r.takes.join(' / '), '-> at source', r.atSourceLufs);
for (const [c, m] of Object.entries(mix)) console.log('mix', c.padEnd(22), `measured ${m.measuredLufs} target ${m.targetLufs} (${m.reference}) gain ${m.cueGain} -> ${m.atSourceLufs}`);
for (const [c, r] of Object.entries(rapid)) console.log('rapid', c, JSON.stringify(r));
console.log(`total ${total} bytes (cap ${BYTE_CAP}); ${queue.length} jobs of ${JOB_CAP}; rejected ${rejected.length}`);
if (total > BYTE_CAP) throw new Error(`new runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/gun-variety-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK}: the six weapon-variety guns' OWN sounds — a shot per gun
// (two takes for the full-auto Hornet / Stub) and its reload mechanics (magazine out / in; the Coach Gun's break open / close). Cue ids
// follow the weapon-id convention of audio/gunVoices.ts (gun + PascalCase(weapon id) + part).

import type {ClipRef} from './manifest.generated';

/** This build's runtime cues, in decode-priority order (bank.ts CUES). */
export const GUN_VARIETY_CUES = [
${CUE_ORDER.map(c => `  '${c}',`).join('\n')}
] as const;
export type GunVarietyCue = (typeof GUN_VARIETY_CUES)[number];

export const CLIP_MANIFEST_GUN_VARIETY: Readonly<Record<string, readonly ClipRef[]>> = {
${CUE_ORDER.map(cue => ` ${cue}: [\n${manifest[cue].map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/**
 * Mix gain per cue (sfx.ts CUE_GAIN) = 10^((target - measured) / 20), capped at 1: each cue's loudness at the source matches its baseline
 * family (pistol / rifle / shotgun shot, rifle magazine out / in) as the game plays it. Measured / target momentary-max LUFS in the provenance.
 */
export const GUN_VARIETY_CUE_GAIN: Readonly<Record<GunVarietyCue, number>> = {
${CUE_ORDER.map(c => `  ${c}: ${mix[c].cueGain}, // ${mix[c].reference}: ${mix[c].measuredLufs} -> ${mix[c].atSourceLufs} (target ${mix[c].targetLufs})`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_GUN_VARIETY: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_GUN_VARIETY = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-gun-variety-20261110', task: TASK, lane: 'AUDIO',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's local Sound Lab allowance: ${queue.length} jobs of a ${JOB_CAP}-job cap including retries — 14 planned + 3 replacement Hornet takes for structurally rejected ones; the rest of the allowance closed unused)`,
  plannedBy: 'a plan kept with the private raw archive (the prompts stay private)', rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/gun-variety-build.mjs',
  privacy: 'This public record names each raw take by its Sound Lab job id, seed and SHA-256 (raw WAV, lab sidecar, prompt). The prompt text, the raw takes and their paths stay in the private raw archive (independent backup), not in Git.',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (5 ms envelopes, onsets, rise, quiet fraction, spectrogram images, spectral centroid / bands / flatness, peak, DC, slice-edge levels, BS.1770 loudness, a rapid-fire overlap sum). `gate` describes signal structure only. The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  loudness: {method: 'ITU-R BS.1770-4 K-weighting, 400 ms blocks / 75 % overlap (one-shots zero-padded to one block), maximum momentary loudness; per channel, power-averaged for the stereo baselines; sample peak (no true-peak oversampling)'},
  mixCalibration: {note: 'CUE_GAIN (audio/sfx.ts, from GUN_VARIETY_CUE_GAIN) per cue = 10^((target - measured) / 20), capped at 1 (no boost): the target is the baseline family\'s loudness at the source (derivative x call gain x CUE_GAIN, before distance / room / master), measured the same way from the baseline raws\' recorded runtime windows. First estimates for the ear pass.',
    references: refs, cues: mix, rapidFire: rapid},
  derivatives: prov, rejectedRaws: rejected};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=|reference\/|\.wav|TrackType).{0,20}/i); if (hit) throw new Error(`URL / private path / prompt-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: this set's sentence (rewritten in place between its fixed head and tail; first added after the market set's)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
{
  const head = 'the weapon-variety gun set (', tail = '): ../derivatives/audio-gun-variety.json';
  const sentence = `${head}shots, magazine out / in and the coach gun's break open / close,\ngun-*.mp3; seeds and hashes only, the prompts stay with the private raw takes${tail}`;
  const i0 = notice.indexOf(head), i1 = notice.indexOf(tail);
  if (i0 >= 0 && i1 > i0) notice = notice.slice(0, i0) + sentence + notice.slice(i1 + tail.length);
  else {
    const anchor = '../derivatives/audio-market-bar.json).';
    if (!notice.includes(anchor)) throw new Error('NOTICE.md: expected sentence anchor not found');
    notice = notice.replace(anchor, `../derivatives/audio-market-bar.json; ${sentence}).`);
  }
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN gun-variety-audio-20261110 (gun-variety-build.mjs) -->', E = '<!-- END gun-variety-audio-20261110 -->';
const block = `${B}
## Weapon-variety gun audio (shots, magazine out / in, break open / close)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the gun audio
task's local Sound Lab allowance (${queue.length} jobs of a ${JOB_CAP}-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades,
levelling, MP3) built by \`tools/audio-pipeline/gun-variety-build.mjs\` (provenance: \`assets/derivatives/audio-gun-variety.json\`). Not
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
