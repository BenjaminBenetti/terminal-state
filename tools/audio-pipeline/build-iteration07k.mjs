#!/usr/bin/env node
// Iteration 07 (Lane K, physics: shot impulses + physics chunks): Sound Lab raw WAVs -> runtime MP3 derivatives +
// manifest + provenance for the FEW cues the 79-cue bank (iteration 05 + 06) lacks for dynamic physical items and
// physics chunks (soda can knocked over, light plastic/cardboard item fall, wet flesh chunk slap, metal trash can topple).
//
// Inputs (never modified): reference/tasks/vertical-slice-iteration07-20261026/audio-k/raw/<clip>.wav + <clip>.lab.json
//   (lab sidecar, byte-exact) + <clip>.sidecar.json (runner sidecar), produced by tools/audio-pipeline/soundlab_runner.py
//   with SOUND_LAB_AUDIO_DIR pointing at that folder, run inside `flock /tmp/ll-soundlab.lock` (shared with Lane Q).
// Outputs (all NEW files; the iteration-05/06 derivatives, manifests and provenance are untouched):
//   game/public/assets/audio/i07k-*.mp3
//   game/src/audio/manifest.iteration07k.generated.ts   (merged into the runtime bank by the Lane K owner in bank.ts)
//   game/public/assets/derivatives/audio-iteration07k.json
//   reference/.../iteration07/audio-k/{qc.json,README.md} and the runner sidecars' "derivatives" field
// Same derivative operations as build.mjs / build-iteration06.mjs (onset trim, cosine fades, mono downmix,
// -1 dBFS peak, MP3 encode). Each MP3 is structurally verified by walking its MPEG-1 Layer III frame chain.
//
// Usage: node tools/audio-pipeline/build-iteration07k.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUDIO = path.join(ROOT, 'reference/tasks/vertical-slice-iteration07-20261026/audio-k');
const RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.iteration07k.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-iteration07k.json');
const QC = path.join(AUDIO, 'qc.json');
const DRY = process.argv.includes('--dry-run');
const LAME_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;
const LICENSE_STATUS = 'conditional prototype, not commercially cleared';

const ONE = {tailDb: -45, split: false, fadeIn: 0.002, fadeOut: 0.06, requireDecay: true, kbps: 96};
/** Recipes per new cue (one-shots; positional, mono). Caps from the raws' 100 ms envelopes: the can's roll bursts
 *  run to ~1.4 s (a 1.2 s cap cut mid-roll), and a late second plastic tap at 1.1-1.3 s is excluded by a 1.0 s cap
 *  that lands in the quiet gap before it. */
export const RECIPES_I07K = {
  itemCan: {...ONE, maxS: 1.45, tailDb: -48, holdMs: 160, fadeOut: 0.15},
  itemLight: {...ONE, maxS: 1.0, holdMs: 120, fadeOut: 0.12},
  chunkFlesh: {...ONE, maxS: 0.9, holdMs: 60, fadeOut: 0.08},
  propTopple: {...ONE, maxS: 1.6, tailDb: -48, holdMs: 200, fadeOut: 0.2},
};
export const CUES_I07K = Object.keys(RECIPES_I07K);

const sha256 = b => createHash('sha256').update(b).digest('hex');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function encodeMp3(chs, sr, kbps) {
  const enc = new Mp3Encoder(chs.length, sr, kbps);
  const ints = chs.map(toInt16), parts = [], B = 1152;
  for (let i = 0; i < ints[0].length; i += B) {
    const out = enc.encodeBuffer(ints[0].subarray(i, i + B));
    if (out.length) parts.push(Buffer.from(out));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

const MP3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_SR = [44100, 48000, 32000];
/** Walk the MPEG-1 Layer III frame chain from byte 0 to EOF (no ID3/garbage allowed). */
function verifyMp3(buf, expectSr, expectChannels) {
  let off = 0, frames = 0, sr = 0, mono = true;
  while (off + 4 <= buf.length) {
    const h = buf.readUInt32BE(off);
    if ((h >>> 21) !== 0x7ff) return {ok: false, error: `no frame sync at byte ${off}`};
    const ver = (h >>> 19) & 3, layer = (h >>> 17) & 3, bi = (h >>> 12) & 15, si = (h >>> 10) & 3, pad = (h >>> 9) & 1, ch = (h >>> 6) & 3;
    if (ver !== 3 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return {ok: false, error: `bad header at byte ${off}`};
    sr = MP3_SR[si];
    if (ch !== 3) mono = false;
    const len = Math.floor(144000 * MP3_KBPS[bi] / sr) + pad;
    if (off + len > buf.length) return {ok: false, error: `truncated frame at byte ${off}`};
    off += len;
    frames++;
  }
  if (off !== buf.length) return {ok: false, error: `trailing ${buf.length - off} bytes`};
  const ok = frames > 0 && sr === expectSr && (expectChannels === 1 ? mono : !mono);
  return {ok, frames, sampleRate: sr, channels: mono ? 1 : 2, durationS: +(frames * 1152 / sr).toFixed(4), error: ok ? undefined : 'format mismatch'};
}

/** First event of the raw, trimmed at its tail (build.mjs 'oneshot' mode). */
function derive(raw, r, sr) {
  const mono = D.downmix(raw);
  const src = [mono];
  const on = D.onsets(mono, sr, {riseDb: 6, floorDb: -30, minGapS: 0.05});
  const a = Math.max(0, (on.length ? on[0] : 0) - Math.round(0.004 * sr));
  const b = D.eventEnd(mono, sr, a, {maxS: r.maxS, tailDb: r.tailDb, split: r.split, holdMs: r.holdMs ?? 40});
  if (b - a <= sr * 0.03) return null;
  const chs = D.slice(src, a, b);
  const outS = Math.min(r.fadeOut, (b - a) / sr * 0.4);
  D.fade(chs, sr, r.fadeIn, outS);
  const g = D.normalisePeak(chs, -1);
  return {chs, ops: [{op: 'downmix', to: 'mono', how: 'mean of channels'}, {op: 'trim', startS: +(a / sr).toFixed(4), endS: +(b / sr).toFixed(4)},
    {op: 'fade', inS: r.fadeIn, outS: +outS.toFixed(4), curve: 'cosine'}, {op: 'normalise', peakDbfs: -1, gainDb: +g.toFixed(2)}]};
}

function main() {
  const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')).clips;
  const qc = [], derivs = [], manifest = {};
  for (const c of queue) {
    const tp = path.join(AUDIO, 'ledger', c.id, 'terminal.json');
    const term = fs.existsSync(tp) ? JSON.parse(fs.readFileSync(tp, 'utf8')) : null;
    if (!term || term.state !== 'done') { qc.push({clip: c.id, cue: c.cue, state: term?.state ?? 'pending', used: false}); continue; }
    const wavPath = path.join(RAW, `${c.id}.wav`), sidePath = path.join(RAW, `${c.id}.sidecar.json`);
    const wavBytes = fs.readFileSync(wavPath), side = JSON.parse(fs.readFileSync(sidePath, 'utf8'));
    const rawSha = sha256(wavBytes);
    if (rawSha !== side.rawSha256) throw new Error(`${c.id}: raw bytes changed (sha mismatch) — refusing`);
    const labSideBytes = fs.readFileSync(path.join(RAW, side.labSidecarFile));
    if (sha256(labSideBytes) !== side.labSidecarSha256) throw new Error(`${c.id}: lab sidecar changed (sha mismatch) — refusing`);
    const r = RECIPES_I07K[c.cue];
    if (!r) throw new Error(`no recipe for cue ${c.cue}`);
    const w = readWav(wavBytes), sr = w.sampleRate;
    const m = D.analyse(w.channels, sr);
    let reject = null;
    if (m.peakDb < -45) reject = 'near-silent raw';
    else if (r.requireDecay && m.flatDb > -35) reject = `sustained envelope (flat ${m.flatDb} dB: never decays) — not a one-shot`;
    const entry = {clip: c.id, cue: c.cue, seconds: c.seconds, seed: c.seed, jobId: side.job?.id ?? term.jobId ?? null, state: 'done', metrics: m,
      used: !reject, reject: reject ?? undefined, derivatives: []};
    qc.push(entry);
    if (reject) continue;
    const p = derive(w.channels, r, sr);
    if (!p) { entry.used = false; entry.reject = 'no event found by the trimmer'; continue; }
    const kbps = r.kbps;
    const mp3 = encodeMp3(p.chs, sr, kbps);
    const check = verifyMp3(mp3, sr, 1);
    if (!check.ok) { entry.used = false; entry.reject = `MP3 frame verification failed: ${check.error}`; continue; }
    const file = `${c.id}.mp3`;
    const url = `assets/audio/${file}`;
    const durS = +(p.chs[0].length / sr).toFixed(4);
    const d = {file: `game/public/${url}`, url, bytes: mp3.length, sha256: sha256(mp3), cue: c.cue, durationS: durS, channels: 1, sampleRate: sr, codec: 'mp3', kbps,
      mp3Check: {frames: check.frames, frameChainDurationS: check.durationS, sampleRate: check.sampleRate, channels: check.channels},
      source: {clip: c.id, rawFile: rel(wavPath), rawSha256: rawSha, labFile: side.labFile, labSidecar: rel(path.join(RAW, side.labSidecarFile)),
        labSidecarSha256: side.labSidecarSha256, runnerSidecar: rel(sidePath),
        jobId: side.job?.id ?? term.jobId ?? null, prompt: c.prompt, negativePrompt: c.negative_prompt, seed: c.seed, steps: c.steps, cfg: c.cfg, seconds: c.seconds,
        profile: side.model?.profile, profileLabel: side.model?.profileLabel, modelCard: side.model?.modelCard, weightsRepo: side.model?.weightsRepo,
        modelRevision: side.model?.revision, licenseStatus: LICENSE_STATUS},
      ops: [...p.ops, {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME_VERSION} (LGPL-3.0, build-time only)`, kbps}]};
    derivs.push(d);
    entry.derivatives.push({file, bytes: d.bytes, sha256: d.sha256, durationS: durS, mp3Frames: check.frames, mp3FrameChainDurationS: check.durationS, decodeCheck: 'MPEG-1 Layer III frame chain OK'});
    (manifest[c.cue] ??= []).push({url, dur: durS, src: c.id});
    if (!DRY) {
      writeAtomic(path.join(OUT, file), mp3);
      const sideDerivs = [{file: d.file, sha256: d.sha256, bytes: d.bytes, ops: d.ops.map(o => o.op)}];
      if (JSON.stringify(side.derivatives ?? []) !== JSON.stringify(sideDerivs)) writeAtomic(sidePath, JSON.stringify({...side, derivatives: sideDerivs}, null, 1) + '\n');
    }
  }
  const gaps = CUES_I07K.filter(k => !manifest[k]?.length);
  const totalBytes = derivs.reduce((s, d) => s + d.bytes, 0);
  const firstSide = derivs.length ? JSON.parse(fs.readFileSync(path.join(RAW, `${derivs[0].source.clip}.sidecar.json`), 'utf8')) : {};
  const prov = {
    task: 'studio-slice-iteration07-20261026-01', lane: 'K (physics: shot impulses + physics chunks)', generatedBy: 'tools/audio-pipeline/build-iteration07k.mjs',
    policy: 'Root CLAUDE.md "Sound effects: Sound Lab only (user rule, 2026-10-26)": every runtime SFX is a derivative of a Sound Lab raw; no synthesis, stock or hosted audio; missing cues stay silent and are listed as gaps. Existing iteration-05/06 cues are reused for everything else.',
    soundLab: {endpoint: 'http://10.0.0.59:7871', kit: firstSide.kit ?? null, profile: firstSide.model?.profile ?? null, modelCard: firstSide.model?.modelCard ?? null,
      weightsRepo: firstSide.model?.weightsRepo ?? null, revision: firstSide.model?.revision ?? null, upstreamCode: firstSide.upstreamCode ?? null,
      lock: 'flock /tmp/ll-soundlab.lock (shared with Lane Q; one job in flight across lanes)'},
    license: {status: `${LICENSE_STATUS}: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Conditional prototype status, not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.`,
      kitStatus: firstSide.license?.status ?? null, review: 'Unreviewed by ear on the worker; human audition required.', gameReady: false, approved: false},
    rawFolder: rel(RAW), totals: {derivatives: derivs.length, bytes: totalBytes, cuesCovered: Object.keys(manifest).length, cues: CUES_I07K.length},
    gaps, derivatives: derivs,
    rejectedRaws: qc.filter(q => q.state === 'done' && !q.used).map(q => ({clip: q.clip, cue: q.cue, reason: q.reject})),
    notDone: qc.filter(q => q.state !== 'done').map(q => ({clip: q.clip, cue: q.cue, state: q.state})),
  };
  const body = CUES_I07K.filter(k => manifest[k]?.length).map(k => ` ${k}: [\n${manifest[k].map(c => `  ${JSON.stringify(c)},`).join('\n')}\n ],`).join('\n');
  const ts = `// GENERATED by tools/audio-pipeline/build-iteration07k.mjs from Sound Lab raws — do not edit by hand.\n` +
    `// Provenance: public/assets/derivatives/audio-iteration07k.json. Cues absent here are SILENT gaps (no fallback).\n\n` +
    `import type {ClipRef} from './manifest.generated';\n\n` +
    `export const CLIP_MANIFEST_I07K: Readonly<Record<string, readonly ClipRef[]>> = {\n${body}\n};\n\n` +
    `export const CLIP_GAPS_I07K: readonly string[] = ${JSON.stringify(gaps)};\n\nexport const CLIP_BYTES_I07K = ${totalBytes};\n`;
  const esc = s => String(s).replace(/\|/g, '\\|');
  const rows = [];
  for (const c of queue) {
    const q = qc.find(x => x.clip === c.id);
    const d = derivs.find(x => x.source.clip === c.id);
    rows.push(`| ${c.cue} | ${d ? '`' + path.basename(d.file) + '`' : `not bundled — ${q?.reject ?? q?.state ?? ''}`} | \`raw/${c.id}.wav\` | ${d?.source.jobId ?? q?.jobId ?? ''} | ${c.seed} | ${c.seconds} | ${esc(c.prompt.replace(/^TrackType: SFX, /, ''))} |`);
  }
  const readme = `# Iteration 07 Sound Lab SFX (Lane K — physics items and chunks)

Generated by \`tools/audio-pipeline/build-iteration07k.mjs\` — regenerate, don't hand-edit. Task studio-slice-iteration07-20261026-01.

Root CLAUDE.md "Sound effects: Sound Lab only": the existing 79-cue bank (iteration 05 + 06) is reused for every existing
impact/casing/body/breaking sound; only the cues it lacks for dynamic physical items and physics chunks were generated here:
${CUES_I07K.join(', ')}.

- Lab: user's Last Line Sound Lab CPU (http://10.0.0.59:7871), \`GET /api/status\` checked first inside the shared lock (ready, not busy).
- Shared lock: the status check and the whole runner run were inside \`flock /tmp/ll-soundlab.lock\` (shared with Lane Q), so only one
  job was in flight across lanes.
- Runner: \`tools/audio-pipeline/soundlab_runner.py\` (unchanged) with \`SOUND_LAB_AUDIO_DIR\` = this folder (one job at a time, never cancels
  user jobs, exclusive fsynced intent per POST in \`ledger/<clip>/\`, ACK + terminal recorded, GET-only reconciliation; log \`runner.log\`).
  The runner's sidecar text says "Lane S" (its iteration-05 author); these clips were planned and run by iteration-07 Lane K.
- Whole-second durations only (2 s). Steps 8, CFG 1. Seeds = parseInt(sha256("iteration07k:"+id).slice(0,8),16) & 0x7fffffff.
- Raw WAVs + lab sidecars kept byte-exact in \`raw/\`; runtime derivatives are NEW files \`game/public/assets/audio/i07k-*.mp3\`
  (provenance \`game/public/assets/derivatives/audio-iteration07k.json\`, manifest \`game/src/audio/manifest.iteration07k.generated.ts\`,
  exports \`CLIP_MANIFEST_I07K\`, \`CLIP_GAPS_I07K\`, \`CLIP_BYTES_I07K\`). Each MP3 is verified by walking its MPEG-1 Layer III frame chain.
- ${derivs.length} derivatives, ${(totalBytes / 1e6).toFixed(3)} MB; gaps: ${gaps.length ? gaps.join(', ') : 'none'}; QC rejects: ${prov.rejectedRaws.length}.
- License: Stability AI Community License + Gemma terms — ${LICENSE_STATUS} (conditional prototype status, not production/commercial clearance).
  Unreviewed by ear on the worker; nothing here is approved or game-ready.

| cue | runtime derivative | raw | job id | seed | s | prompt (after "TrackType: SFX, ") |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
  if (!DRY) {
    writeAtomic(MANIFEST_TS, ts);
    writeAtomic(PROV, JSON.stringify(prov, null, 1) + '\n');
    writeAtomic(QC, JSON.stringify({generatedAt: new Date().toISOString(), raws: qc}, null, 1) + '\n');
    writeAtomic(path.join(AUDIO, 'README.md'), readme);
  }
  console.log(`raws done ${qc.filter(q => q.state === 'done').length}, used ${qc.filter(q => q.used).length}; derivatives ${derivs.length}, ${(totalBytes / 1e3).toFixed(1)} kB; cues ${Object.keys(manifest).length}/${CUES_I07K.length}`);
  for (const q of qc.filter(q => !q.used)) console.log(`  not used ${q.clip}: ${q.reject ?? q.state}`);
  for (const [k, v] of Object.entries(manifest)) console.log(`  ${k.padEnd(18)} ${v.length} × [${v.map(x => x.dur.toFixed(2)).join(' ')}]`);
  if (gaps.length) console.log(`  GAPS (silent): ${gaps.join(', ')}`);
}

main();
