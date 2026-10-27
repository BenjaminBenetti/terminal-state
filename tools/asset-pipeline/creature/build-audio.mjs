#!/usr/bin/env node
// Iteration 07 (Lane Q, rat/dog quadruped creature): Sound Lab raw WAVs -> runtime MP3 derivatives + manifest + provenance
// for the creature's own vocal/foley cues (growl, snarl, bite, yelp, death, paw step). Adapted from
// tools/audio-pipeline/build-iteration06.mjs (same DSP ops, QC rejects, provenance fields, policy and license text).
//
// Inputs (never modified): reference/tasks/vertical-slice-iteration07-20261026/audio-q/raw/<clip>.wav + <clip>.lab.json
//   (lab sidecar, byte-exact) + <clip>.sidecar.json (runner sidecar), produced by tools/audio-pipeline/soundlab_runner.py
//   with SOUND_LAB_AUDIO_DIR pointing at that folder, one clip per `flock /tmp/ll-soundlab.lock` hold (shared with Lane K).
// Outputs (all NEW files; the iteration-05/06 derivatives, manifests and provenance are untouched):
//   game/public/assets/audio/i07q-*.mp3
//   game/src/audio/manifest.iteration07q.generated.ts   (integrated into the runtime bank by Lane Q's main agent)
//   game/public/assets/derivatives/audio-iteration07-creature.json
//   reference/.../iteration07/audio-q/{qc.json,README.md} and the runner sidecars' "derivatives" field
// Ops: onset trim, cosine fades, mono downmix, -1 dBFS peak, MP3 encode. Edits generated clips only; never creates sound.
//
// Usage: node tools/asset-pipeline/creature/build-audio.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from '../../audio-pipeline/lib/wav.mjs';
import * as D from '../../audio-pipeline/lib/dsp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AUDIO = path.join(ROOT, 'reference/tasks/vertical-slice-iteration07-20261026/audio-q');
const RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.iteration07q.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-iteration07-creature.json');
const QC = path.join(AUDIO, 'qc.json');
const DRY = process.argv.includes('--dry-run');
const LAME_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;

const ONE = {tailDb: -45, split: false, fadeIn: 0.002, fadeOut: 0.06, requireDecay: true, kbps: 96};
/** Recipes per creature cue (one-shots; positional, mono). */
export const RECIPES_I07Q = {
  creatureGrowl: {...ONE, maxS: 2.4, tailDb: -45, holdMs: 200, fadeOut: 0.3, requireDecay: false}, // a growl may sustain
  creatureSnarl: {...ONE, maxS: 1.6, holdMs: 120, fadeOut: 0.15},
  creatureBite: {...ONE, maxS: 1.2, holdMs: 80, fadeOut: 0.1},
  creatureYelp: {...ONE, maxS: 1.2, holdMs: 100, fadeOut: 0.12},
  creatureDeath: {...ONE, maxS: 2.6, holdMs: 250, fadeOut: 0.35, requireDecay: false},
  // ONE footfall, iteration-06 first-event mode. Not split: each raw footfall is a claw click + pad/scrape sub-onset ~50 ms
  // later, and split:true cut at that sub-onset (50-55 ms clicks). Footfalls are >=0.3 s apart, so maxS 0.35 keeps one event.
  creatureStep: {...ONE, maxS: 0.35, holdMs: 30, fadeOut: 0.05},
};
export const CUES_I07Q = Object.keys(RECIPES_I07Q);

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
  return {chs, ops: [{op: 'downmix', to: 'mono', how: 'mean of channels'}, {op: 'trim', startS: +(a / sr).toFixed(4), endS: +(b / sr).toFixed(4), split: !!r.split},
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
    const r = RECIPES_I07Q[c.cue];
    if (!r) throw new Error(`no recipe for cue ${c.cue}`);
    const w = readWav(wavBytes), sr = w.sampleRate;
    const m = D.analyse(w.channels, sr);
    let reject = null;
    if (m.peakDb < -45) reject = 'near-silent raw';
    else if (r.requireDecay && m.flatDb > -35) reject = `sustained envelope (flat ${m.flatDb} dB: never decays) — not a one-shot`;
    const entry = {clip: c.id, cue: c.cue, seconds: c.seconds, seed: c.seed, state: 'done', metrics: m, used: !reject, reject: reject ?? undefined, derivatives: []};
    qc.push(entry);
    if (reject) continue;
    const p = derive(w.channels, r, sr);
    if (!p) { entry.used = false; entry.reject = 'no event found by the trimmer'; continue; }
    const kbps = r.kbps;
    const mp3 = encodeMp3(p.chs, sr, kbps);
    const file = `${c.id}.mp3`;
    const url = `assets/audio/${file}`;
    const durS = +(p.chs[0].length / sr).toFixed(4);
    const d = {file: `game/public/${url}`, url, bytes: mp3.length, sha256: sha256(mp3), cue: c.cue, durationS: durS, channels: 1, sampleRate: sr, codec: 'mp3', kbps,
      source: {clip: c.id, rawFile: rel(wavPath), rawSha256: rawSha, labFile: side.labFile, labSidecar: rel(path.join(RAW, side.labSidecarFile)),
        jobId: side.job?.id ?? term.jobId ?? null, prompt: c.prompt, seed: c.seed, steps: c.steps, cfg: c.cfg, seconds: c.seconds,
        profile: side.model?.profile, modelRevision: side.model?.revision},
      ops: [...p.ops, {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME_VERSION} (LGPL-3.0, build-time only)`, kbps}]};
    derivs.push(d);
    entry.derivatives.push(file);
    (manifest[c.cue] ??= []).push({url, dur: durS, src: c.id});
    if (!DRY) {
      writeAtomic(path.join(OUT, file), mp3);
      const sideDerivs = [{file: d.file, sha256: d.sha256, bytes: d.bytes, ops: d.ops.map(o => o.op)}];
      if (JSON.stringify(side.derivatives ?? []) !== JSON.stringify(sideDerivs)) writeAtomic(sidePath, JSON.stringify({...side, derivatives: sideDerivs}, null, 1) + '\n');
    }
  }
  const gaps = CUES_I07Q.filter(k => !manifest[k]?.length);
  const totalBytes = derivs.reduce((s, d) => s + d.bytes, 0);
  const firstSide = derivs.length ? JSON.parse(fs.readFileSync(path.join(RAW, `${derivs[0].source.clip}.sidecar.json`), 'utf8')) : {};
  const prov = {
    task: 'studio-slice-iteration07-20261026-01', lane: 'Q (rat/dog creature)', generatedBy: 'tools/asset-pipeline/creature/build-audio.mjs',
    policy: 'Root CLAUDE.md "Sound effects: Sound Lab only (user rule, 2026-10-26)": every runtime SFX is a derivative of a Sound Lab raw; no synthesis, stock or hosted audio; missing cues stay silent and are listed as gaps. Only the creature\'s own vocal/foley cues were generated here; bullet impacts, flesh and body-fall sounds reuse the iteration-05/06 banks.',
    soundLab: {endpoint: 'http://10.0.0.59:7871', kit: firstSide.kit ?? null, profile: firstSide.model?.profile ?? null, modelCard: firstSide.model?.modelCard ?? null,
      weightsRepo: firstSide.model?.weightsRepo ?? null, revision: firstSide.model?.revision ?? null, upstreamCode: firstSide.upstreamCode ?? null,
      sharedLock: 'flock /tmp/ll-soundlab.lock around every request (incl. status), one clip per hold; shared with iteration-07 Lane K'},
    license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
      kitStatus: firstSide.license?.status ?? null, review: 'Unreviewed by ear on the worker; human audition required.', gameReady: false, approved: false},
    rawFolder: rel(RAW), totals: {derivatives: derivs.length, bytes: totalBytes, cuesCovered: Object.keys(manifest).length, cues: CUES_I07Q.length},
    gaps, derivatives: derivs,
    rejectedRaws: qc.filter(q => q.state === 'done' && !q.used).map(q => ({clip: q.clip, cue: q.cue, reason: q.reject})),
    notDone: qc.filter(q => q.state !== 'done').map(q => ({clip: q.clip, cue: q.cue, state: q.state})),
  };
  const body = CUES_I07Q.filter(k => manifest[k]?.length).map(k => ` ${k}: [\n${manifest[k].map(c => `  ${JSON.stringify(c)},`).join('\n')}\n ],`).join('\n');
  const ts = `// GENERATED by tools/asset-pipeline/creature/build-audio.mjs from Sound Lab raws — do not edit by hand.\n` +
    `// Provenance: public/assets/derivatives/audio-iteration07-creature.json. Cues absent here are SILENT gaps (no fallback).\n\n` +
    `import type {ClipRef} from './manifest.generated';\n\n` +
    `export const CLIP_MANIFEST_I07Q: Readonly<Record<string, readonly ClipRef[]>> = {\n${body}\n};\n\n` +
    `export const CLIP_GAPS_I07Q: readonly string[] = ${JSON.stringify(gaps)};\n\nexport const CLIP_BYTES_I07Q = ${totalBytes};\n`;
  const esc = s => String(s).replace(/\|/g, '\\|');
  const rows = [];
  for (const c of queue) {
    const q = qc.find(x => x.clip === c.id);
    const d = derivs.find(x => x.source.clip === c.id);
    rows.push(`| ${c.cue} | ${d ? '`' + path.basename(d.file) + '` (' + d.durationS + ' s)' : `not bundled — ${q?.reject ?? q?.state ?? ''}`} | \`raw/${c.id}.wav\` | ${d?.source.jobId ?? ''} | ${c.seed} | ${c.seconds} | ${esc(c.prompt.replace(/^TrackType: SFX, /, ''))} |`);
  }
  const readme = `# Iteration 07 Sound Lab SFX (Lane Q — rat/dog quadruped creature)

Generated by \`tools/asset-pipeline/creature/build-audio.mjs\` — regenerate, don't hand-edit. Task studio-slice-iteration07-20261026-01.

Root CLAUDE.md "Sound effects: Sound Lab only": the iteration-05/06 banks are reused for bullet impacts, flesh and body falls;
only the creature's own vocal/foley cues were generated here: ${CUES_I07Q.join(', ')} (3 seeds per cue, same prompt).

- Lab: user's Last Line Sound Lab CPU (http://10.0.0.59:7871), \`GET /api/status\` checked first (ready, not busy).
- Shared lock: every Sound Lab request, including status checks, ran inside \`flock /tmp/ll-soundlab.lock …\` with ONE clip per
  lock hold, so only one job was in flight across iteration-07 Lanes Q and K; user jobs are waited for, never cancelled.
- Runner: \`tools/audio-pipeline/soundlab_runner.py <clip-id>\` with \`SOUND_LAB_AUDIO_DIR\` = this folder (one job at a time,
  exclusive fsynced intent per POST in \`ledger/<clip>/\`, ACK + terminal recorded, GET-only reconciliation; log \`runner.log\`).
  The runner's sidecar text says "Lane S" (its iteration-05 author); these clips were planned and run by iteration-07 Lane Q.
- Whole-second durations only (2 s; 3 s for growl and death) — iteration 05 found half-second takes drone. Steps 8, CFG 1.
- Raw WAVs + lab sidecars kept byte-exact in \`raw/\`; runtime derivatives are NEW files \`game/public/assets/audio/i07q-*.mp3\`
  (provenance \`game/public/assets/derivatives/audio-iteration07-creature.json\`, manifest \`game/src/audio/manifest.iteration07q.generated.ts\`).
  Derivative ops: onset trim (first event only; paw step = first footfall, capped at 0.35 s), cosine fades, mono, -1 dBFS peak, 96 kbps MP3.
- ${derivs.length} derivatives, ${(totalBytes / 1e6).toFixed(3)} MB; gaps: ${gaps.length ? gaps.join(', ') : 'none'}; QC rejects: ${prov.rejectedRaws.length}.
- License: Stability AI Community License + Gemma terms — conditional prototype status, not production/commercial clearance.
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
  console.log(`raws done ${qc.filter(q => q.state === 'done').length}, used ${qc.filter(q => q.used).length}; derivatives ${derivs.length}, ${(totalBytes / 1e3).toFixed(1)} kB; cues ${Object.keys(manifest).length}/${CUES_I07Q.length}`);
  for (const q of qc.filter(q => !q.used)) console.log(`  not used ${q.clip}: ${q.reject ?? q.state}`);
  for (const [k, v] of Object.entries(manifest)) console.log(`  ${k.padEnd(18)} ${v.length} × [${v.map(x => x.dur.toFixed(2)).join(' ')}]`);
  if (gaps.length) console.log(`  GAPS (silent): ${gaps.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
