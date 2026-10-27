#!/usr/bin/env node
// Lane S (iteration 05): Sound Lab raw WAVs -> runtime MP3 derivatives + manifest + provenance.
//
// Inputs (never modified): reference/tasks/vertical-slice-iteration05-20261026/audio/raw/<clip>.wav
//   + <clip>.lab.json (lab sidecar, byte-exact) + <clip>.sidecar.json (Lane S sidecar).
// Outputs:
//   game/public/assets/audio/*.mp3                         runtime derivatives (relative URLs)
//   game/src/audio/manifest.generated.ts                   cue -> clips (bundled; no runtime manifest fetch)
//   game/public/assets/derivatives/audio-iteration05.json  provenance: every derivative names its raw source
//   reference/.../audio/qc.json                            per-raw QC metrics + use/reject decision
//   <clip>.sidecar.json "derivatives" field (atomic rewrite of OUR sidecar; the lab sidecar is untouched)
// Every derivative is a NEW file; the raw WAV bytes are re-hashed and must match the sidecar.
//
// Usage: node tools/audio-pipeline/build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {RECIPES} from './recipes.mjs';
import {CUES} from './cues.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUDIO = path.join(ROOT, 'reference/tasks/vertical-slice-iteration05-20261026/audio');
const RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-iteration05.json');
const QC = path.join(AUDIO, 'qc.json');
const DRY = process.argv.includes('--dry-run');
const LOOP_MARGIN_S = 0.3;
const LAME_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;

/** Manual listening/inspection exclusions (clip id -> reason). Empty unless a human/QC note adds one. */
const EXCLUDE = {};

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
    const l = ints[0].subarray(i, i + B);
    const out = chs.length > 1 ? enc.encodeBuffer(l, ints[1].subarray(i, i + B)) : enc.encodeBuffer(l);
    if (out.length) parts.push(Buffer.from(out));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

const NOTICE = `# Audio notice — The Last Line (prototype)

Every sound effect in this folder is a derivative (trim, fade, mono downmix, loudness levelling, seamless loop,
MP3 encoding) of a raw clip generated with the user's local Last Line Sound Lab CPU 0.1.0
(Stable Audio 3 Small-SFX, stabilityai/stable-audio-3-small-sfx via stabilityai/stable-audio-3-optimized,
w8a8 profile). Per-file sources, prompts, seeds and hashes: ../derivatives/audio-iteration05.json
(iteration-06 breaking cues i06-*.mp3: ../derivatives/audio-iteration06.json).

Powered by Stability AI.

- Model weights: Stability AI Community License Agreement (Last Updated 2024-07-05).
- Text encoder / tokenizer (T5Gemma): Gemma Terms of Use (Last modified 2026-04-01).
- Status: conditional prototype status, not production or commercial clearance. Outputs may not be used to build
  or improve a foundational generative AI model. Unreviewed by ear on the build worker; not approved, not game-ready.
- No synthesised, stock, downloaded or hosted audio is included.
`;

/** reference/.../audio/README.md: contract, run summary, QC, and the cue -> file -> raw -> seed/prompt table. */
function readme(queue, terminals, qc, manifest, derivs, gaps, totalBytes) {
  const sup = fs.existsSync(path.join(AUDIO, 'superseded.json')) ? JSON.parse(fs.readFileSync(path.join(AUDIO, 'superseded.json'), 'utf8')).clips : {};
  const states = {};
  for (const t of terminals.values()) states[t.state] = (states[t.state] ?? 0) + 1;
  const byClip = new Map();
  for (const d of derivs) { const l = byClip.get(d.source.clip) ?? []; l.push(path.basename(d.file)); byClip.set(d.source.clip, l); }
  const qcById = new Map(qc.map(q => [q.clip, q]));
  const esc = s => String(s).replace(/\|/g, '\\|');
  const rows = [];
  for (const cue of CUES) {
    for (const c of queue.filter(q => q.cue === cue)) {
      const t = terminals.get(c.id), q = qcById.get(c.id);
      if (!t || t.state !== 'done') continue;
      const files = byClip.get(c.id) ?? [];
      const use = files.length ? `${files.length}: ${files.map(f => '`' + f.replace(/\.mp3$/, '') + '`').join(' ')}` : `not bundled — ${q?.reject ?? ''}`;
      rows.push(`| ${cue} | ${use} | \`raw/${c.id}.wav\` | ${t.jobId ?? ''} | ${c.seed} | ${c.seconds} | ${esc(c.prompt.replace(/^TrackType: SFX, /, ''))} |`);
    }
  }
  return `# Iteration 05 Sound Lab SFX (Lane S)

Generated by \`tools/audio-pipeline/build.mjs\` — regenerate, don't hand-edit. Task studio-slice-iteration05-20261026-01.

All game SFX come from the user's Sound Lab (root CLAUDE.md "Sound effects: Sound Lab only"). This folder keeps every
raw WAV byte-exact with the lab's own sidecar (\`raw/<clip>.lab.json\`) and a Lane S sidecar (\`raw/<clip>.sidecar.json\`:
prompt, seed, steps, CFG, seconds, model revision, profile, license status, raw + derivative SHA-256, job id, timestamps).
Runtime derivatives are new files in \`game/public/assets/audio/\`; provenance \`game/public/assets/derivatives/audio-iteration05.json\`.

## API contract used (read from kit 0.1.0 \`app/server.py\`; the served page/JS are byte-identical to the kit source)
- \`GET /api/status\` → ready / busy / profile / limits / terms / model (checked before every submit; busy = wait, never interfere)
- \`POST /api/generate\` JSON \`{prompt, negative_prompt, seconds, steps, cfg, seed}\` → \`202 {job}\` (409 = busy / not prepared)
- \`GET /api/job\` (current or last job), \`GET /api/outputs\` (latest 40), \`GET /outputs/<day>/<file>.wav|.json\`
- No Origin header (same-origin check only applies when one is sent), normal Host, no trial POSTs.

## Run
- Plan: \`tools/audio-pipeline/plan.py\` → \`queue.json\` (append-only, deterministic seeds); steps 8 (upstream distilled default), CFG 1.
- Runner: \`tools/audio-pipeline/soundlab_runner.py\` (detached setsid/nohup; one job at a time; exclusive fsynced intent
  before every POST; ACK + terminal per clip in \`ledger/<clip>/\`; GET-only reconciliation; log \`runner.log\`).
- Queue ${queue.length} planned clips → terminals: ${Object.entries(states).map(([k, v]) => `${k} ${v}`).join(', ')}. No failed or lost jobs.
- **Duration finding:** every 1.5 s / 2.5 s take (12 impacts, 3 shotgun blasts, 2 zombie attacks) came back as a sustained drone
  with no transient; integer lengths (1, 2, 3, 6–20 s) gave clean one-shots (the user's own 2.0 s trials of the same preset prompts
  were clean too). The remaining ${Object.keys(sup).length} half-second entries were superseded BEFORE submission (\`superseded.json\`,
  no intent, no job) and re-planned at integer lengths as batch B (\`-b-\` ids). The drone raws are kept and QC-rejected.
- Diagnosis only: 4 of the user's own trial outputs were read with GET for comparison (not copied here, not bundled).

## Derivatives
- ${derivs.length} runtime clips, ${(totalBytes / 1e6).toFixed(2)} MB MP3 (44.1 kHz; mono 96 kbps, own gunshots stereo 160 kbps, wide beds stereo 128 kbps).
- Ops per recipe (\`tools/audio-pipeline/recipes.mjs\`): mono downmix (positional cues), onset trim / multi-event slicing / loudest windows,
  cosine fades, peak-normalise to −1 dBFS (one-shots) or RMS −20 dBFS (beds), equal-power crossfaded seamless loops from the most
  stationary region with 0.3 s periodic margins (MP3 priming never lands inside the loop), MP3 encode (@breezystack/lamejs, build-time only).
- QC (\`qc.json\`): one-shot recipes reject takes whose envelope never decays (10th-percentile vs max > −35 dB); one bed take per bed
  cue is bundled (the most stationary); everything else used.
- Cues covered: ${Object.keys(manifest).length}/${CUES.length}. Silent gaps: ${gaps.length ? gaps.join(', ') : 'none'}.

## License
Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01): **conditional prototype status, not production or
commercial clearance**. "Powered by Stability AI" (shipped in \`game/public/assets/audio/NOTICE.md\`). Unreviewed by ear on the worker —
a human must audition; nothing here is approved or game-ready.

## Rebuild
\`\`\`
python3 -I tools/audio-pipeline/plan.py        # append-only queue
setsid nohup python3 -I tools/audio-pipeline/soundlab_runner.py >/dev/null 2>&1 &   # resumes / reconciles, never resubmits
node tools/audio-pipeline/build.mjs --verbose  # derivatives + manifest + provenance + this README
\`\`\`

## Clips (cue → runtime files → raw source → job / seed / seconds / prompt)
| cue | runtime derivatives | raw | job id | seed | s | prompt (after "TrackType: SFX, ") |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

/** Loop region of a bed take: the most stationary lenS + crossfade span. */
function loopRegion(raw, r, sr) {
  const dur = raw[0].length / sr;
  const lenS = Math.min(r.lenS, dur - r.xfS - 1.0);
  return {...D.stationaryRegion(D.downmix(raw), sr, lenS + r.xfS, {minStartS: 0.5}), lenS};
}

/** Cut derivative regions out of one raw per its recipe. Returns [{chs, ops, label}]. */
function derive(raw, r, sr) {
  const src = r.stereo && raw.length > 1 ? raw : [D.downmix(raw)];
  const mono = D.downmix(raw);
  const ops = r.stereo && raw.length > 1 ? [] : [{op: 'downmix', to: 'mono', how: 'mean of channels'}];
  const res = [];
  const finish = (a, b, label, extra = []) => {
    const chs = D.slice(src, a, b);
    D.fade(chs, sr, r.fadeIn ?? 0.002, Math.min(r.fadeOut ?? 0.05, (b - a) / sr * 0.4));
    const g = D.normalisePeak(chs, -1);
    res.push({chs, label, ops: [...ops, {op: 'trim', startS: +(a / sr).toFixed(4), endS: +(b / sr).toFixed(4)}, ...extra,
      {op: 'fade', inS: r.fadeIn ?? 0.002, outS: +Math.min(r.fadeOut ?? 0.05, (b - a) / sr * 0.4).toFixed(4), curve: 'cosine'},
      {op: 'normalise', peakDbfs: -1, gainDb: +g.toFixed(2)}]});
  };
  if (r.mode === 'oneshot') {
    const on = D.onsets(mono, sr, {riseDb: 6, floorDb: -30, minGapS: 0.05});
    const first = on.length ? on[0] : 0;
    const a = Math.max(0, first - Math.round(0.004 * sr));
    const b = D.eventEnd(mono, sr, a, {maxS: r.maxS, tailDb: r.tailDb, split: r.split, holdMs: r.holdMs ?? 40});
    if (b - a > sr * 0.03) finish(a, b, '');
  } else if (r.mode === 'slices') {
    const on = D.onsets(mono, sr, {riseDb: r.riseDb, floorDb: r.floorDb, minGapS: r.minGapS});
    const segs = [];
    for (let i = 0; i < on.length; i++) {
      const a = Math.max(0, on[i] - Math.round(0.004 * sr));
      const next = i + 1 < on.length ? on[i + 1] - Math.round(0.006 * sr) : mono.length;
      const cap = Math.min(next, a + Math.round(r.maxS * sr));
      const b = Math.min(cap, D.eventEnd(mono, sr, a, {maxS: (cap - a) / sr, tailDb: r.tailDb, split: r.split ?? true, holdMs: r.holdMs ?? 40}));
      if (b - a < sr * (r.minS ?? 0.07)) continue;
      segs.push({a, b, pk: D.peak([mono.subarray(a, b)])});
    }
    segs.sort((p, q) => q.pk - p.pk);
    const keep = segs.slice(0, r.n).sort((p, q) => p.a - q.a);
    keep.forEach((s, i) => finish(s.a, s.b, `s${String(i + 1).padStart(2, '0')}`));
  } else if (r.mode === 'windows') {
    const W = Math.round(r.winS * sr);
    D.loudestWindows(mono, sr, r.n, r.winS).forEach((a, i) => finish(a, a + W, `w${String(i + 1).padStart(2, '0')}`));
  } else if (r.mode === 'loop') {
    const reg = loopRegion(raw, r, sr);
    const loop = D.makeLoop(src, sr, reg.startS, reg.lenS, r.xfS);
    const g = D.normaliseRms(loop, -20, -1);
    const withM = D.withLoopMargins(loop, sr, LOOP_MARGIN_S);
    res.push({chs: withM, label: 'loop', loop: {start: LOOP_MARGIN_S, length: +(loop[0].length / sr).toFixed(6)}, ops: [...ops,
      {op: 'loop', sourceStartS: reg.startS, lengthS: +reg.lenS.toFixed(4), crossfadeS: r.xfS, curve: 'equal-power', regionStdDb: reg.stdDb,
        note: 'most stationary region (skips the take\'s fade-in); loop head blends in the material after the loop end'},
      {op: 'normalise', rmsDbfs: -20, peakCeilingDbfs: -1, gainDb: +g.toFixed(2)},
      {op: 'loop-margins', marginS: LOOP_MARGIN_S, note: 'periodic copies before/after so MP3 priming/padding stays outside [start, start+length)'}]});
  }
  return res;
}

function main() {
  if (!fs.existsSync(RAW)) throw new Error(`no raw folder ${RAW}`);
  const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')).clips;
  const byId = new Map(queue.map(c => [c.id, c]));
  const terminals = new Map();
  for (const c of queue) {
    const t = path.join(AUDIO, 'ledger', c.id, 'terminal.json');
    if (fs.existsSync(t)) terminals.set(c.id, JSON.parse(fs.readFileSync(t, 'utf8')));
  }
  const qc = [], derivs = [], manifest = {}, written = new Set();
  if (!DRY) fs.mkdirSync(OUT, {recursive: true});
  // Beds loop continuously: keep only the most stationary take per bed cue (others stay raw-only).
  const bedBest = new Map();
  for (const c of queue) {
    const r = RECIPES[c.cue];
    if (r?.mode !== 'loop' || terminals.get(c.id)?.state !== 'done') continue;
    const w = readWav(fs.readFileSync(path.join(RAW, `${c.id}.wav`)));
    const reg = loopRegion(w.channels, r, w.sampleRate), cur = bedBest.get(c.cue);
    if (!cur || reg.stdDb < cur.stdDb) bedBest.set(c.cue, {id: c.id, stdDb: reg.stdDb});
  }
  for (const c of queue) {
    const term = terminals.get(c.id);
    if (!term || term.state !== 'done') { qc.push({clip: c.id, cue: c.cue, state: term?.state ?? 'pending', used: false}); continue; }
    const wavPath = path.join(RAW, `${c.id}.wav`), sidePath = path.join(RAW, `${c.id}.sidecar.json`);
    const wavBytes = fs.readFileSync(wavPath), side = JSON.parse(fs.readFileSync(sidePath, 'utf8'));
    const rawSha = sha256(wavBytes);
    if (rawSha !== side.rawSha256) throw new Error(`${c.id}: raw bytes changed (sha mismatch) — refusing`);
    const r = RECIPES[c.cue];
    if (!r) throw new Error(`no recipe for cue ${c.cue}`);
    const w = readWav(wavBytes), sr = w.sampleRate;
    const m = D.analyse(w.channels, sr);
    let reject = null;
    if (EXCLUDE[c.id]) reject = `excluded: ${EXCLUDE[c.id]}`;
    else if (m.peakDb < -45) reject = 'near-silent raw';
    else if (r.mode !== 'loop' && r.requireDecay && m.flatDb > -35) reject = `sustained envelope (flat ${m.flatDb} dB: never decays) — not a one-shot (the ${c.seconds}s drone failure mode)`;
    else if (r.mode === 'loop' && bedBest.get(c.cue)?.id !== c.id) reject = `alternative bed take not bundled (less stationary than ${bedBest.get(c.cue)?.id}, std ${bedBest.get(c.cue)?.stdDb} dB)`;
    const entry = {clip: c.id, cue: c.cue, seconds: c.seconds, seed: c.seed, state: 'done', metrics: m, used: !reject, reject: reject ?? undefined, derivatives: []};
    qc.push(entry);
    if (reject) continue;
    const parts = derive(w.channels, r, sr);
    if (!parts.length) { entry.used = false; entry.reject = 'no event found by the trimmer'; continue; }
    const sideDerivs = [];
    for (const p of parts) {
      const kbps = r.kbps ?? 96;
      const mp3 = encodeMp3(p.chs, sr, p.chs.length > 1 ? kbps : Math.min(kbps, 112));
      const file = `${c.id}${p.label ? '-' + p.label : ''}.mp3`;
      const url = `assets/audio/${file}`;
      const durS = +(p.chs[0].length / sr).toFixed(4);
      const d = {file: `game/public/${url}`, url, bytes: mp3.length, sha256: sha256(mp3), cue: c.cue, durationS: durS, channels: p.chs.length,
        sampleRate: sr, codec: 'mp3', kbps: p.chs.length > 1 ? kbps : Math.min(kbps, 112), loop: p.loop,
        source: {clip: c.id, rawFile: rel(wavPath), rawSha256: rawSha, labFile: side.labFile, labSidecar: rel(path.join(RAW, side.labSidecarFile)),
          jobId: side.job?.id ?? terminals.get(c.id)?.jobId ?? null, prompt: c.prompt, seed: c.seed, steps: c.steps, cfg: c.cfg, seconds: c.seconds,
          profile: side.model?.profile, modelRevision: side.model?.revision},
        ops: [...p.ops, {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME_VERSION} (LGPL-3.0, build-time only)`, kbps: p.chs.length > 1 ? kbps : Math.min(kbps, 112)}]};
      derivs.push(d);
      entry.derivatives.push(file);
      sideDerivs.push({file: d.file, sha256: d.sha256, bytes: d.bytes, ops: d.ops.map(o => o.op)});
      (manifest[c.cue] ??= []).push({url, dur: durS, ...(p.loop ? {loop: p.loop} : {}), src: c.id});
      written.add(file);
      if (!DRY) writeAtomic(path.join(OUT, file), mp3);
    }
    if (!DRY && JSON.stringify(side.derivatives ?? []) !== JSON.stringify(sideDerivs)) writeAtomic(sidePath, JSON.stringify({...side, derivatives: sideDerivs}, null, 1) + '\n');
  }
  const gaps = CUES.filter(k => !manifest[k]?.length);
  const unknown = Object.keys(manifest).filter(k => !CUES.includes(k));
  if (unknown.length) throw new Error(`manifest cues not in CUES: ${unknown.join(', ')}`);
  const totalBytes = derivs.reduce((s, d) => s + d.bytes, 0);
  const firstSide = derivs.length ? JSON.parse(fs.readFileSync(path.join(RAW, `${derivs[0].source.clip}.sidecar.json`), 'utf8')) : {};
  const prov = {
    task: 'studio-slice-iteration05-20261026-01', lane: 'S', generatedBy: 'tools/audio-pipeline/build.mjs', policy: 'Root CLAUDE.md "Sound effects: Sound Lab only (user rule, 2026-10-26)": every runtime SFX is a derivative of a Sound Lab raw; no synthesis, stock or hosted audio; missing cues stay silent and are listed as gaps.',
    soundLab: {endpoint: 'http://10.0.0.59:7871', kit: firstSide.kit ?? null, profile: firstSide.model?.profile ?? null, modelCard: firstSide.model?.modelCard ?? null,
      weightsRepo: firstSide.model?.weightsRepo ?? null, revision: firstSide.model?.revision ?? null, upstreamCode: firstSide.upstreamCode ?? null},
    license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
      kitStatus: firstSide.license?.status ?? null, review: 'Unreviewed by ear on the worker; human audition required.', gameReady: false, approved: false},
    rawFolder: rel(RAW), totals: {derivatives: derivs.length, bytes: totalBytes, cuesCovered: Object.keys(manifest).length, cues: CUES.length},
    gaps, derivatives: derivs,
    rejectedRaws: qc.filter(q => q.state === 'done' && !q.used).map(q => ({clip: q.clip, cue: q.cue, reason: q.reject})),
  };
  const body = CUES.filter(k => manifest[k]?.length).map(k => ` ${k}: [\n${manifest[k].map(c => `  ${JSON.stringify(c)},`).join('\n')}\n ],`).join('\n');
  const ts = `// GENERATED by tools/audio-pipeline/build.mjs from Sound Lab raws — do not edit by hand.\n` +
    `// Provenance: public/assets/derivatives/audio-iteration05.json. Cues absent here are SILENT gaps (no fallback).\n\n` +
    `export interface ClipRef { url: string; dur: number; loop?: {start: number; length: number}; src: string }\n\n` +
    `export const CLIP_MANIFEST: Readonly<Record<string, readonly ClipRef[]>> = {\n${body}\n};\n\n` +
    `export const CLIP_GAPS: readonly string[] = ${JSON.stringify(gaps)};\n\nexport const CLIP_BYTES = ${totalBytes};\n`;
  if (!DRY) {
    // i06-*.mp3 belong to tools/audio-pipeline/build-iteration06.mjs (iteration-06 breaking cues): never deleted here.
    for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !written.has(f) && !f.startsWith('i06-')) fs.unlinkSync(path.join(OUT, f));
    writeAtomic(MANIFEST_TS, ts);
    writeAtomic(PROV, JSON.stringify(prov, null, 1) + '\n');
    writeAtomic(QC, JSON.stringify({generatedAt: new Date().toISOString(), raws: qc}, null, 1) + '\n');
    writeAtomic(path.join(OUT, 'NOTICE.md'), NOTICE);
    writeAtomic(path.join(AUDIO, 'README.md'), readme(queue, terminals, qc, manifest, derivs, gaps, totalBytes));
  }
  const rej = qc.filter(q => q.state === 'done' && !q.used);
  console.log(`raws done ${qc.filter(q => q.state === 'done').length}, used ${qc.filter(q => q.used).length}, rejected ${rej.length}; derivatives ${derivs.length}, ${(totalBytes / 1e6).toFixed(2)} MB; cues ${Object.keys(manifest).length}/${CUES.length}`);
  for (const q of rej) console.log(`  rejected ${q.clip}: ${q.reject}`);
  if (process.argv.includes('--verbose')) for (const [k, v] of Object.entries(manifest)) console.log(`  ${k.padEnd(18)} ${v.length} × [${v.map(x => x.dur.toFixed(2)).join(' ')}]`);
  if (gaps.length) console.log(`  GAPS (silent): ${gaps.join(', ')}`);
}

main();
