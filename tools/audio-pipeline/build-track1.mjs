#!/usr/bin/env node
// Task track1-siren-blightbelly-20261031 (lane AUDIO, studio-track1-siren-blightbelly-20261031-01): runtime derivatives of the
// SIX authorized Sound Lab jobs for the new enemies — Siren hum (2 takes) / scream (2), Blightbelly burst (1) / gas hiss (1).
// The primary ran the jobs (tools/audio-pipeline/soundlab_runner.py, one fsynced intent per POST, whole-second durations);
// this builder makes NO Sound Lab call. It edits the generated clips only and never creates sound.
//
// Inputs (read-only, never modified): reference/tasks/track1-siren-blightbelly-20261031/audio/{queue.json, ledger/<id>/terminal.json,
//   raw/<id>.wav, raw/<id>.sidecar.json, raw/<id>.lab.json}. Each raw is verified against its ledger terminal + runner sidecar
//   SHA-256 and the lab sidecar against the runner sidecar's labSidecarSha256 before use.
// Outputs: game/public/assets/audio/t1-*.mp3, game/src/audio/manifest.track1.generated.ts (merged into bank.ts CLIP_MANIFEST),
//   game/public/assets/derivatives/audio-track1.json (provenance). With --audition also the portable audition pack
//   reference/tasks/track1-siren-blightbelly-20261031/audition/ (built MP3s, raw WAVs + lab sidecars, QC images, README, metadata).
//
// Ops per take: mono downmix (mean) -> trim (first frame above the start threshold, minus a short pre-roll, to the end of the
//   CONNECTED active run: gaps longer than maxGapS end it) -> cosine fades -> loudness normalisation (ITU-R BS.1770 K-weighted,
//   gated integrated LUFS, per-cue target) capped by a -1 dBFS sample-peak ceiling -> MP3 (lamejs, mono, 128 kbps).
// Gate: every raw and every derivative must pass the per-cue STRUCTURAL gate (tools/audio-pipeline/lib/structural.mjs
//   cueVerdict); a failing take is excluded (recorded), never shipped. The clips were NOT listened to on the worker.
//
// Design (documented in the provenance): the Siren hum ships as SHORT PHRASES, not a seamless loop — each raw is one complete
//   melodic phrase (4–5.5 s) with its own start and end; the Siren lane plays one phrase, waits a randomised gap, plays the next
//   (variants alternate). A loop would need a crossfade inside held notes (hum-02 ends ~1 octave below where it starts) and
//   would repeat mechanically every few seconds; phrases also re-run the vocal route / storey gate at every start and stop
//   cleanly on wake (fade of the current phrase).
//
// Usage: node tools/audio-pipeline/build-track1.mjs [--dry-run] [--audition]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16, writeWav} from './lib/wav.mjs';
import * as S from './lib/structural.mjs';
import {renderQc, stackPngs} from './lib/qc-render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK_DIR = 'reference/tasks/track1-siren-blightbelly-20261031';
const AUDIO = path.join(ROOT, TASK_DIR, 'audio'), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.track1.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-track1.json');
const AUDITION = path.join(ROOT, TASK_DIR, 'audition');
const QC_BUILT = path.join(AUDIO, 'qc', 'built');
const DRY = process.argv.includes('--dry-run'), PACK = process.argv.includes('--audition');
const LAME_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;

/**
 * Per-cue recipe. startDb / tailDb: thresholds re the take's loudest 5 ms frame (and >= the take's noise floor + 6 dB).
 * lufs: integrated loudness target of the derivative (the -1 dBFS peak ceiling wins when lower). Mix levels are CUE_GAIN in
 * audio/sfx.ts (CUE_GAIN_TRACK1 below documents the intended values; a test keeps them equal).
 */
export const RECIPES_T1 = {
  sirenHum: {kind: 'hum', lufs: -18, startDb: -40, tailDb: -40, maxGapS: 0.15, preS: 0.01, holdMs: 80, fadeIn: 0.015, fadeOut: 0.25, maxS: 6},
  sirenScream: {kind: 'scream', lufs: -16, startDb: -40, tailDb: -42, maxGapS: 0.12, preS: 0.003, holdMs: 60, fadeIn: 0.003, fadeOut: 0.12, maxS: 2.6},
  blightBurst: {kind: 'burst', lufs: -16, startDb: -40, tailDb: -45, maxGapS: 0.1, preS: 0.002, holdMs: 60, fadeIn: 0.001, fadeOut: 0.12, maxS: 1.2},
  blightHiss: {kind: 'hiss', lufs: -18, startDb: -40, tailDb: -42, maxGapS: 0.15, preS: 0.01, holdMs: 40, fadeIn: 0.02, fadeOut: 0.8, maxS: 4},
};
export const CUES_T1 = Object.keys(RECIPES_T1);
const KBPS = 128, PEAK_CEIL_DB = -1;
/** Intended mix gains (audio/sfx.ts CUE_GAIN) — the scream is the loudest enemy vocal, the hum soft. See mixCalibration. */
export const CUE_GAIN_TRACK1 = {sirenHum: 0.3, sirenScream: 0.9, blightBurst: 0.9, blightHiss: 0.32};

const sha256 = b => createHash('sha256').update(b).digest('hex');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const r3 = v => +v.toFixed(3), r4 = v => +v.toFixed(4);

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

/** Trim points (samples): first 5 ms frame above the start threshold minus preS; end of the connected active run + holdMs. */
function trimPoints(x, sr, rc) {
  const hop = Math.round(sr * 0.005), env = S.envelopeDb(x, sr, 0.005);
  const pk = Math.max(...env), floor = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.03)]; // 3rd percentile: the take's quietest frames
  const thrStart = Math.max(pk + rc.startDb, floor + 6), thrTail = Math.max(pk + rc.tailDb, floor + 6);
  const first = env.findIndex(e => e > thrStart);
  const maxGap = Math.round(rc.maxGapS / 0.005), cap = first + Math.round(rc.maxS / 0.005);
  let last = first, gap = 0;
  for (let h = first; h < Math.min(env.length, cap); h++) {
    if (env[h] > thrTail) { last = h; gap = 0; } else if (++gap > maxGap) break;
  }
  const a = Math.max(0, first * hop - Math.round(rc.preS * sr));
  const b = Math.min(x.length, (last + 1) * hop + Math.round(rc.holdMs / 1000 * sr), a + Math.round(rc.maxS * sr));
  return {a, b, thrStartDbfs: +thrStart.toFixed(1), thrTailDbfs: +thrTail.toFixed(1), floorDbfs: +floor.toFixed(1)};
}

function fade(x, sr, inS, outS) {
  const n = x.length, fi = Math.min(n, Math.round(inS * sr)), fo = Math.min(n, Math.round(outS * sr));
  for (let i = 0; i < fi; i++) x[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fi);
  for (let i = 0; i < fo; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fo);
}

/** Loudness of existing comparable cues, re-derived from their raws + recorded ops (when the reference mount is present). */
function mixCalibration(sfxSrc) {
  const REF = ['zombieGroan', 'zombieAttack', 'zombieDeath', 'creatureSnarl', 'creatureGrowl', 'hurt', 'cough', 'breakGlass', 'fleshTear', 'shotgunShot'];
  const gainOf = cue => { const m = sfxSrc.match(new RegExp(`\\b${cue}: ([0-9.]+)`)); return m ? +m[1] : null; };
  const out = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'game/public/assets/derivatives')).filter(n => n.startsWith('audio-') && n !== 'audio-track1.json')) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives', f), 'utf8'));
    for (const d of p.derivatives ?? []) {
      if (!REF.includes(d.cue) || !fs.existsSync(path.join(ROOT, d.source.rawFile))) continue;
      if ((d.ops ?? []).some(o => !['downmix', 'trim', 'fade', 'normalise', 'encode'].includes(o.op))) continue;
      const w = readWav(fs.readFileSync(path.join(ROOT, d.source.rawFile))), sr = w.sampleRate;
      const x = new Float32Array(w.channels[0].length);
      for (const c of w.channels) for (let i = 0; i < x.length; i++) x[i] += c[i] / w.channels.length;
      const tr = d.ops.find(o => o.op === 'trim'), nm = d.ops.find(o => o.op === 'normalise'), g = Math.pow(10, (nm?.gainDb ?? 0) / 20);
      const y = x.slice(Math.round(tr.startS * sr), Math.round(tr.endS * sr)).map(v => v * g);
      const lu = S.loudness(y, sr);
      (out[d.cue] ??= {cueGain: gainOf(d.cue), takes: []}).takes.push(lu);
    }
  }
  const rows = {};
  for (const [cue, v] of Object.entries(out)) {
    const avg = k => v.takes.reduce((s, q) => s + q[k], 0) / v.takes.length, gDb = v.cueGain ? 20 * Math.log10(v.cueGain) : NaN;
    rows[cue] = {takes: v.takes.length, integratedLufs: +avg('integratedLufs').toFixed(1), momentaryMaxLufs: +avg('momentaryMaxLufs').toFixed(1), cueGain: v.cueGain,
      mixMomentaryMaxLufs: +(avg('momentaryMaxLufs') + gDb).toFixed(1)};
  }
  return rows;
}

async function main() {
  const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')).clips;
  const derivs = [], excluded = [], manifest = {}, previews = {}, renders = [];
  for (const c of queue) {
    const rc = RECIPES_T1[c.cue];
    if (!rc) throw new Error(`no recipe for cue ${c.cue}`);
    const term = JSON.parse(fs.readFileSync(path.join(AUDIO, 'ledger', c.id, 'terminal.json'), 'utf8'));
    if (term.state !== 'done') { excluded.push({clip: c.id, cue: c.cue, reason: `ledger state ${term.state}`}); continue; }
    const wavPath = path.join(RAW, `${c.id}.wav`), side = JSON.parse(fs.readFileSync(path.join(RAW, `${c.id}.sidecar.json`), 'utf8'));
    const wav = fs.readFileSync(wavPath), rawSha = sha256(wav);
    if (rawSha !== term.rawSha256 || rawSha !== side.rawSha256) throw new Error(`${c.id}: raw SHA-256 mismatch — refusing`);
    const labBytes = fs.readFileSync(path.join(RAW, side.labSidecarFile));
    if (sha256(labBytes) !== side.labSidecarSha256) throw new Error(`${c.id}: lab sidecar SHA-256 mismatch — refusing`);
    const w = readWav(wav), sr = w.sampleRate;
    const x = new Float32Array(w.channels[0].length);
    for (const ch of w.channels) for (let i = 0; i < x.length; i++) x[i] += ch[i] / w.channels.length;
    const rawM = S.structure(x, sr), rawV = S.cueVerdict(rc.kind, rawM), rawLu = S.loudness(x, sr);
    if (!rawV.pass) { excluded.push({clip: c.id, cue: c.cue, jobId: term.jobId, rawSha256: rawSha, reason: `raw structural gate: ${rawV.failed.join(', ')}`, rawVerdict: rawV}); continue; }
    const t = trimPoints(x, sr, rc);
    const y = x.slice(t.a, t.b);
    const outS = Math.min(rc.fadeOut, (t.b - t.a) / sr * 0.3);
    fade(y, sr, rc.fadeIn, outS);
    const pre = S.loudness(y, sr);
    let pk = 0;
    for (const v of y) pk = Math.max(pk, Math.abs(v));
    const gLufs = rc.lufs - pre.integratedLufs, gPeak = PEAK_CEIL_DB - S.linToDb(pk), gDb = Math.min(gLufs, gPeak);
    const g = Math.pow(10, gDb / 20);
    for (let i = 0; i < y.length; i++) y[i] *= g;
    const m = S.structure(y, sr), v = S.cueVerdict(rc.kind, m), lu = S.loudness(y, sr);
    if (!v.pass) { excluded.push({clip: c.id, cue: c.cue, jobId: term.jobId, rawSha256: rawSha, reason: `derivative structural gate: ${v.failed.join(', ')}`, verdict: v}); continue; }
    const mp3 = encodeMp3(y, sr, KBPS), file = `${c.id}.mp3`, url = `assets/audio/${file}`, durS = r4(y.length / sr);
    previews[c.id] = {y, sr};
    renders.push({id: c.id, cue: c.cue, seed: c.seed, m, v, lu, sr});
    // noise floor = RMS of the raw OUTSIDE the trimmed span (the 'silence' the take came with), after the applied gain
    let fs2 = 0, fn = 0;
    for (let i = 0; i < x.length; i++) if (i < t.a || i >= t.b) { fs2 += x[i] * x[i]; fn++; }
    const outsideDbfs = fn >= 0.05 * sr ? +S.linToDb(Math.sqrt(fs2 / fn)).toFixed(1) : null;
    const floorAfterDbfs = outsideDbfs === null ? null : +(outsideDbfs + gDb).toFixed(1);
    derivs.push({file: `game/public/${url}`, url, bytes: mp3.length, sha256: sha256(mp3), cue: c.cue, durationS: durS, channels: 1, sampleRate: sr, codec: 'mp3', kbps: KBPS,
      source: {clip: c.id, rawFile: rel(wavPath), rawSha256: rawSha, rawBytes: wav.length, labFile: term.labFile, labSidecar: rel(path.join(RAW, side.labSidecarFile)), labSidecarSha256: side.labSidecarSha256,
        runnerSidecar: rel(path.join(RAW, `${c.id}.sidecar.json`)), jobId: term.jobId, prompt: c.prompt, negativePrompt: c.negative_prompt ?? '', seed: c.seed, steps: c.steps, cfg: c.cfg, seconds: c.seconds,
        model: side.model?.modelCard?.repo ?? null, modelRevision: side.model?.modelCard?.revision ?? null, weightsRepo: side.model?.weightsRepo ?? null, weightsRevision: side.model?.revision ?? null, profile: side.model?.profile ?? null,
        rawChannels: w.channels.length, rawLoudness: rawLu, rawStructural: S.publicMetrics(rawM), rawVerdict: {pass: rawV.pass, failed: rawV.failed}},
      structural: {...S.publicMetrics(m), loudness: lu, verdict: v, noiseFloor: {outsideTrimRmsDbfs: outsideDbfs, outsideTrimS: r3(fn / sr), afterGainDbfs: floorAfterDbfs, belowDerivativePeakDb: floorAfterDbfs === null ? null : +(m.peakDbfs - floorAfterDbfs).toFixed(1),
        note: 'RMS of the raw outside the trimmed span, after the applied gain. 4/6 raws (both screams, hum-02, the burst) carry the same decoder idle floor in their silent parts (harmonics of 44100/256 = 172.27 Hz, -60.8 dBFS RMS): it is trimmed away and lies under the fades / under the sound inside the span'}},
      ops: [{op: 'downmix', to: 'mono', how: 'mean of channels'},
        {op: 'trim', startS: r4(t.a / sr), endS: r4(t.b / sr), startThresholdDbfs: t.thrStartDbfs, tailThresholdDbfs: t.thrTailDbfs, maxGapS: rc.maxGapS, holdMs: rc.holdMs, note: 'first frame above the start threshold (minus pre-roll) to the end of the connected active run'},
        {op: 'fade', inS: rc.fadeIn, outS: r4(outS), curve: 'cosine'},
        {op: 'normalise', method: 'ITU-R BS.1770 integrated loudness (K-weighted, gated), mono', targetLufs: rc.lufs, peakCeilingDbfs: PEAK_CEIL_DB, gainDb: +gDb.toFixed(2), bound: gLufs <= gPeak ? 'loudness target' : 'peak ceiling'},
        {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME_VERSION} (LGPL-3.0, build-time only)`, kbps: KBPS}]});
    (manifest[c.cue] ??= []).push({url, dur: durS, src: c.id});
    if (!DRY) writeAtomic(path.join(OUT, file), mp3);
  }
  const gaps = CUES_T1.filter(k => !manifest[k]?.length);
  const totalBytes = derivs.reduce((s, d) => s + d.bytes, 0);
  const side0 = JSON.parse(fs.readFileSync(path.join(RAW, `${queue[0].id}.sidecar.json`), 'utf8'));
  const sfxSrc = fs.readFileSync(path.join(ROOT, 'game/src/audio/sfx.ts'), 'utf8');
  const calib = mixCalibration(sfxSrc);
  const mixOf = cue => {
    const ds = derivs.filter(d => d.cue === cue), mm = ds.reduce((s, d) => s + d.structural.loudness.momentaryMaxLufs, 0) / Math.max(1, ds.length);
    return {integratedLufs: +(ds.reduce((s, d) => s + d.structural.loudness.integratedLufs, 0) / Math.max(1, ds.length)).toFixed(1), momentaryMaxLufs: +mm.toFixed(1),
      cueGain: CUE_GAIN_TRACK1[cue], mixMomentaryMaxLufs: +(mm + 20 * Math.log10(CUE_GAIN_TRACK1[cue])).toFixed(1), mixPeakDbfs: +(Math.max(...ds.map(d => d.structural.peakDbfs)) + 20 * Math.log10(CUE_GAIN_TRACK1[cue])).toFixed(1)};
  };
  const prov = {
    task: 'studio-track1-siren-blightbelly-20261031-01', lane: 'AUDIO (Siren hum / scream, Blightbelly burst / gas hiss)', generatedBy: 'tools/audio-pipeline/build-track1.mjs',
    policy: 'Sound Lab only: one runtime derivative per authorized Sound Lab job of the initial 6-job batch (authorization.json soundLab.initialMaxPostJobs = 6; the primary was the sole submitter; no retries / rerolls; whole-second durations). No synthesis, stock, pitch / rate variants or layering. Takes failing the structural gate are never shipped (none failed). The Siren claw swipes and Blightbelly attacks reuse existing cues (zombieAttack / impactFlesh / zombieDeath / fleshTear / bodyFall).',
    license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
      kitStatus: side0.license?.status ?? null, review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (envelope, spectrum, pitch track, loudness). Human audition required — portable pack reference/tasks/track1-siren-blightbelly-20261031/audition/.', gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
    auditioned: false,
    soundLab: {endpoint: 'http://10.0.0.59:7871', kit: side0.kit ?? null, model: side0.model?.modelCard?.repo ?? null, modelRevision: side0.model?.modelCard?.revision ?? null,
      weightsRepo: side0.model?.weightsRepo ?? null, weightsRevision: side0.model?.revision ?? null, profile: side0.model?.profile ?? null, upstreamCode: side0.upstreamCode ?? null,
      runner: 'tools/audio-pipeline/soundlab_runner.py (primary; flock /tmp/ll-soundlab.lock; SOUND_LAB_MAX_POSTS=6)', jobs: queue.length},
    rawArchive: `${TASK_DIR}/audio/ (raw WAVs + lab / runner sidecars in raw/, intents / ACKs / terminals in ledger/, runner.log, queue.json, PLAN.json, QC.json + qc/*.png)`,
    design: {
      sirenHum: 'Short PHRASES, not a seamless loop: each raw is one complete melodic phrase (start + end of its own); the Siren plays one phrase, then a randomised gap (audio/sfx.ts SIREN_HUM.gapS), variants alternate. Reasons: a loop would crossfade inside held notes (hum-02 ends ~1 octave below its start), would repeat mechanically, and could not re-run the vocal route / storey gate per phrase; a phrase fades out cleanly on wake.',
      sirenScream: 'One-shot with a short tail: the raw scream body plus its own ~60–120 ms release (the raws cut off sharply, as prompted); the room tail comes from the game reverb send. Loudest enemy vocal through the existing master compressor (no limiter bypass, no extra gain stage).',
      blightBurst: 'One-shot transient + decay (peak-ceiling bound: the burst is impulsive).',
      blightHiss: 'One-shot ~3.7 s broadband gas hiss that fades (long 0.8 s cosine fade over the raw\'s own decay); played once at the burst point after the burst.',
    },
    loudness: {method: 'ITU-R BS.1770-4 K-weighting, 400 ms blocks / 75 % overlap, -70 LUFS absolute + -10 LU relative gate (mono); sample peak (no true-peak oversampling)', targets: Object.fromEntries(CUES_T1.map(k => [k, {targetLufs: RECIPES_T1[k].lufs, peakCeilingDbfs: PEAK_CEIL_DB}]))},
    mixCalibration: {note: 'Per-cue momentary-max loudness at the source (derivative x CUE_GAIN, before distance / occlusion / master). Reference cues re-derived from their raws + recorded ops. Target: scream = the loudest enemy vocal, ~2.7 LU above a zombie groan and ~1.3 LU above a zombie death (brightness at 1–3 kHz adds perceived piercing quality); hum soft, ~6 LU under a groan; burst near a zombie death with a -1 dBFS transient; hiss ~ flesh-tear / hurt level.',
      new: Object.fromEntries(CUES_T1.filter(k => manifest[k]).map(k => [k, mixOf(k)])), reference: calib},
    qc: {gate: 'tools/audio-pipeline/lib/structural.mjs cueVerdict (raw AND derivative must pass)', rawQc: `${TASK_DIR}/audio/QC.json`, images: `${TASK_DIR}/audio/qc/*.png (raws), ${TASK_DIR}/audio/qc/built/*.png (shipped derivatives, pre-MP3)`},
    totals: {derivatives: derivs.length, bytes: totalBytes, cuesCovered: Object.keys(manifest).length, cues: CUES_T1.length}, gaps, excluded, derivatives: derivs,
  };
  const body = CUES_T1.filter(k => manifest[k]?.length).map(k => ` ${k}: [\n${manifest[k].map(m => `  ${JSON.stringify(m)},`).join('\n')}\n ],`).join('\n');
  const ts = `// GENERATED by tools/audio-pipeline/build-track1.mjs from the Sound Lab raws — do not edit by hand.\n` +
    `// Provenance: public/assets/derivatives/audio-track1.json. Task track1-siren-blightbelly-20261031 (lane AUDIO): Siren hum / scream,\n` +
    `// Blightbelly burst / gas hiss. Cues absent here are SILENT gaps (no fallback).\n\n` +
    `import type {ClipRef} from './manifest.generated';\n\n` +
    `export const CLIP_MANIFEST_T1: Readonly<Record<string, readonly ClipRef[]>> = {\n${body}\n};\n\n` +
    `/** Cues of this build without a clip (silent gaps). */\nexport const CLIP_GAPS_T1: readonly string[] = ${JSON.stringify(gaps)};\n\n` +
    `/** Total bytes of this build's derivatives. */\nexport const CLIP_BYTES_T1 = ${totalBytes};\n`;
  if (!DRY) {
    writeAtomic(MANIFEST_TS, ts);
    writeAtomic(PROV, JSON.stringify(prov, null, 1) + '\n');
  }
  if (!DRY) {
    // structural QC images of exactly what ships (post trim / fade / gain, pre-MP3)
    fs.mkdirSync(QC_BUILT, {recursive: true});
    const imgs = [];
    for (const q of renders) imgs.push(await renderQc(path.join(QC_BUILT, `${q.id}.png`), {title: `${q.id} · cue ${q.cue} · seed ${q.seed}`, label: 'SHIPPED DERIVATIVE (pre-MP3)', m: q.m, verdict: q.v, lu: q.lu, sr: q.sr}));
    if (imgs.length) await stackPngs(imgs, path.join(QC_BUILT, 'overview.png'));
  }
  if (PACK && !DRY) audition(prov, previews);
  console.log(`derivatives ${derivs.length}, ${(totalBytes / 1e3).toFixed(1)} kB; cues ${Object.keys(manifest).length}/${CUES_T1.length}; gaps: ${gaps.join(', ') || 'none'}; excluded: ${excluded.map(e => e.clip).join(', ') || 'none'}`);
  for (const d of derivs) {
    const nb = d.ops.find(o => o.op === 'normalise'), tr = d.ops.find(o => o.op === 'trim');
    console.log(`  ${d.source.clip.padEnd(20)} ${d.durationS.toFixed(2)} s [${tr.startS}–${tr.endS}] ${d.structural.loudness.integratedLufs} LUFS (Mmax ${d.structural.loudness.momentaryMaxLufs}) peak ${d.structural.peakDbfs} gain ${nb.gainDb} dB (${nb.bound}) ${d.bytes} B ${d.structural.verdict.pass ? 'PASS' : 'FAIL'} floor ${d.structural.noiseFloor.belowDerivativePeakDb} dB below peak`);
  }
  console.log('mix (new):', JSON.stringify(prov.mixCalibration.new));
  console.log('mix (reference):', JSON.stringify(Object.fromEntries(Object.entries(calib).map(([k, v]) => [k, v.mixMomentaryMaxLufs]))));
}

/** Portable audition pack (worker cannot listen): built MP3s + raw WAVs + lab sidecars + QC images + in-game-order previews. */
function audition(prov, previews) {
  const dirs = ['built', 'raw', 'qc', 'preview'].map(d => path.join(AUDITION, d));
  for (const d of dirs) fs.mkdirSync(d, {recursive: true});
  const files = [];
  const copy = (src, dst) => { fs.copyFileSync(src, dst); files.push({file: rel(dst).replace(`${TASK_DIR}/audition/`, ''), bytes: fs.statSync(dst).size, sha256: sha256(fs.readFileSync(dst))}); };
  for (const d of prov.derivatives) {
    copy(path.join(ROOT, d.file), path.join(AUDITION, 'built', path.basename(d.file)));
    copy(path.join(ROOT, d.source.rawFile), path.join(AUDITION, 'raw', path.basename(d.source.rawFile)));
    copy(path.join(ROOT, d.source.labSidecar), path.join(AUDITION, 'raw', path.basename(d.source.labSidecar)));
  }
  for (const f of fs.existsSync(path.join(AUDIO, 'qc')) ? fs.readdirSync(path.join(AUDIO, 'qc')).filter(n => n.endsWith('.png')) : []) copy(path.join(AUDIO, 'qc', f), path.join(AUDITION, 'qc', f));
  fs.mkdirSync(path.join(AUDITION, 'qc', 'built'), {recursive: true});
  for (const f of fs.existsSync(QC_BUILT) ? fs.readdirSync(QC_BUILT).filter(n => n.endsWith('.png')) : []) copy(path.join(QC_BUILT, f), path.join(AUDITION, 'qc', 'built', f));
  // Audition-only previews (NOT shipped): the derivatives in the order / relative mix gains the game uses them.
  const sr = 44100, gap = s => new Float32Array(Math.round(s * sr));
  const join = parts => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Float32Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const scaled = (id, g) => previews[id] ? previews[id].y.map(v => v * g) : new Float32Array(0);
  const G = CUE_GAIN_TRACK1;
  const siren = join([scaled('t1-siren-hum-01', G.sirenHum), gap(3), scaled('t1-siren-hum-02', G.sirenHum), gap(2.5), scaled('t1-siren-hum-01', G.sirenHum).subarray(0, Math.round(1.6 * sr)).map((v, i, a) => v * Math.min(1, (a.length - i) / (0.12 * sr))), gap(0.05), scaled('t1-siren-scream-01', G.sirenScream), gap(2), scaled('t1-siren-scream-02', G.sirenScream), gap(0.5)]);
  const burst = scaled('t1-blight-burst-01', G.blightBurst), hiss = scaled('t1-blight-hiss-01', G.blightHiss), off = Math.round(0.15 * sr);
  const blight = new Float32Array(Math.max(burst.length, off + hiss.length) + Math.round(0.5 * sr));
  for (let i = 0; i < burst.length; i++) blight[i] += burst[i];
  for (let i = 0; i < hiss.length; i++) blight[off + i] += hiss[i];
  for (const [name, y] of [['preview-siren-hum-hum-wake-scream.wav', siren], ['preview-blightbelly-burst-then-hiss.wav', blight]]) {
    const dst = path.join(AUDITION, 'preview', name);
    writeAtomic(dst, writeWav([y], sr));
    files.push({file: `preview/${name}`, bytes: fs.statSync(dst).size, sha256: sha256(fs.readFileSync(dst))});
  }
  const meta = {task: prov.task, lane: 'AUDIO', builtBy: prov.generatedBy, listening: prov.license.review, license: prov.license.status,
    clips: prov.derivatives.map(d => ({cue: d.cue, built: `built/${path.basename(d.file)}`, raw: `raw/${path.basename(d.source.rawFile)}`, durationS: d.durationS, integratedLufs: d.structural.loudness.integratedLufs,
      peakDbfs: d.structural.peakDbfs, seed: d.source.seed, jobId: d.source.jobId, prompt: d.source.prompt, structuralVerdict: d.structural.verdict.pass ? 'PASS' : 'FAIL', qcImage: `qc/${d.source.clip}.png`})),
    mixGains: CUE_GAIN_TRACK1, files};
  writeAtomic(path.join(AUDITION, 'metadata.json'), JSON.stringify(meta, null, 1) + '\n');
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const rows = meta.clips.map(c => `| ${c.cue} | \`${c.built}\` | \`${c.raw}\` | ${c.durationS.toFixed(2)} | ${c.integratedLufs} | ${c.seed} | ${c.prompt.replace(/^TrackType: SFX, /, '').replace(/\|/g, '\\|')} |`).join('\n');
  writeAtomic(path.join(AUDITION, 'README.md'), `# Track 1 audio audition pack — Siren + Blightbelly

Task studio-track1-siren-blightbelly-20261031-01, lane AUDIO. Regenerate with \`node tools/audio-pipeline/build-track1.mjs --audition\`.

**Nobody has listened to these yet.** The build worker has no audio output; every check so far is structural (envelope,
spectrogram, pitch track, loudness — see \`qc/*.png\` and \`../audio/QC.json\`). Please listen before treating any of this as approved.

- \`built/\` — the exact MP3s the game ships (\`game/public/assets/audio/t1-*.mp3\`): trimmed, faded, mono, loudness-levelled.
- \`raw/\` — the untouched Sound Lab WAVs (byte-exact) + their lab sidecars.
- \`preview/\` — audition-only WAVs, not shipped: the derivatives in game order at their relative mix gains
  (two hum phrases with gaps, a hum cut by the wake, scream 01, scream 02; burst then the gas hiss 0.15 s later).
- \`qc/\` — one structural QC image per raw (envelope + log-frequency spectrogram + f0 track) and \`overview.png\`; \`qc/built/\` the same for the shipped derivatives.

Things worth listening for: does each hum read as a woman humming a melody (not an instrument / whistle)? Is the scream a
voice — scream 01 is dominated by one strong partial near 1.4–1.7 kHz (structurally whistle-like; could read as a shriek or
as a tone)? Does the burst read as a wet pop rather than a gunshot? Is the hiss gas rather than wind / static?

Mix gains (audio/sfx.ts CUE_GAIN): ${Object.entries(CUE_GAIN_TRACK1).map(([k, v]) => `${k} ${v}`).join(', ')}. License: ${prov.license.status}

| cue | built | raw | s | LUFS | seed | prompt (after "TrackType: SFX, ") |
|---|---|---|---|---|---|---|
${rows}

Pack size: ${(total / 1048576).toFixed(2)} MiB (${files.length} files).
`);
  console.log(`audition pack: ${files.length + 2} files, ${(total / 1048576).toFixed(2)} MiB -> ${rel(AUDITION)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
