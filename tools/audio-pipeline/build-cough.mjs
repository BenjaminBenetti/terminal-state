// Task gas-mask-roof-feedback-20261030 (studio-alpha-gas-mask-roof-feedback-20261030-01, AUDIO): runtime derivatives of the TEN
// authorized Sound Lab player-cough jobs (one job per take; no retries/rerolls). Reads
// reference/tasks/gas-mask-roof-feedback-20261030/audio/raw/<id>.wav (each verified against its runner sidecar + terminal SHA-256)
// and writes game/public/assets/audio/cough-*.mp3, game/src/audio/manifest.cough.generated.ts and
// game/public/assets/derivatives/audio-cough.json.
// Ops (as the iteration-05 one-shot vocals): mono downmix, first onset -> end of the last cough above the tail threshold,
// cosine fades, peak-normalise to -1 dBFS, MP3. Edits the generated clips only; never creates sound. The provenance records a
// STRUCTURAL analysis of every take (onsets, active time, level, spectral centroid, envelope similarity between takes): the
// clips were not listened to on the worker.
// Usage: node tools/audio-pipeline/build-cough.mjs
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
/**
 * Raw sources, in order: the original 10 authorized jobs (closed ledger; five takes were continuous noise and stay excluded)
 * and the cough-completion batches (task cough-completion-20261030, user-authorized regenerations at whole-second durations).
 */
const SOURCES = [
  {dir: 'reference/tasks/gas-mask-roof-feedback-20261030/audio', task: 'studio-alpha-gas-mask-roof-feedback-20261030-01', label: 'original 10-job allowance (closed)'},
  {dir: 'reference/tasks/cough-completion-20261030/audio/batch1', task: 'studio-alpha-cough-completion-20261030-01', label: 'completion batch 1 (5 jobs)'},
];
const OUT_DIR = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.cough.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-cough.json');
const sha256 = b => createHash('sha256').update(b).digest('hex');
const LAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;
const RECIPE = {tailDb: -42, holdMs: 90, fadeIn: 0.004, fadeOut: 0.09, kbps: 96, onset: {riseDb: 9, floorDb: -30, minGapS: 0.12}};
/**
 * Structural cough gate (the takes are not listened to on the worker): a cough take is discrete bursts with near-silence between
 * / after them. A raw whose 5 ms envelope never drops 30 dB below its peak for at least QUIET_MIN of the take is continuous
 * broadband noise, not a usable cough (five of the ten jobs — every 1.5 s / 2.5 s request — came back like that); such a take
 * gets NO runtime derivative and is recorded under `excluded` with its numbers. Its raw stays archived.
 */
const QUIET_DB = -30, QUIET_MIN = 0.15;
function quietFrac(x, sr) {
  const env = D.envelope(x, Math.round(sr * 0.005));
  let pk = 0;
  for (const e of env) pk = Math.max(pk, e);
  return env.filter(e => e < pk * D.dbToLin(QUIET_DB)).length / env.length;
}
const r3 = v => +v.toFixed(3);

/** Last 5 ms hop at or after `from` above max(tailDb re peak, noise floor + 6 dB), plus holdMs. */
function activeEnd(x, sr, from) {
  const hop = Math.round(sr * 0.005), env = D.envelope(x, hop);
  let pk = 0;
  for (const e of env) pk = Math.max(pk, e);
  const floor = [...env].sort((p, q) => p - q)[Math.floor(env.length * 0.1)];
  const thr = Math.max(pk * D.dbToLin(RECIPE.tailDb), floor * D.dbToLin(6));
  let last = Math.floor(from / hop);
  for (let h = Math.floor(from / hop); h < env.length; h++) if (env[h] > thr) last = h;
  return Math.min(x.length, (last + 1) * hop + Math.round(RECIPE.holdMs / 1000 * sr));
}

/** Spectral centroid (Hz) of the active part: 2048-point DFT frames (Hann), energy-weighted. Coarse, for QC only. */
function centroid(x, sr) {
  const N = 1024, hop = 1024;
  let num = 0, den = 0;
  for (let s = 0; s + N <= x.length; s += hop) {
    let e = 0;
    for (let i = 0; i < N; i++) e += x[s + i] * x[s + i];
    if (e < 1e-6 * N) continue;
    for (let k = 1; k < N / 2; k += 4) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)), a = 2 * Math.PI * k * i / N;
        re += x[s + i] * w * Math.cos(a); im -= x[s + i] * w * Math.sin(a);
      }
      const m = re * re + im * im;
      num += m * k * sr / N; den += m;
    }
  }
  return den > 0 ? Math.round(num / den) : 0;
}

/** 48-point normalised envelope signature (for take-to-take similarity). */
function signature(x, sr) {
  const env = D.envelope(x, Math.round(sr * 0.005)), n = 48, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * env.length / n), b = Math.max(a + 1, Math.floor((i + 1) * env.length / n));
    let s = 0;
    for (let k = a; k < b; k++) s += env[k];
    out[i] = s / (b - a);
  }
  const m = out.reduce((p, q) => p + q, 0) / n;
  let v = 0;
  for (let i = 0; i < n; i++) { out[i] -= m; v += out[i] * out[i]; }
  const sd = Math.sqrt(v) || 1;
  return out.map(q => q / sd);
}

function encode(ch, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(ch), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

const manifest = [], derivs = [], gaps = [], sigs = [], excluded = [];
for (const src of SOURCES) for (const clip of JSON.parse(fs.readFileSync(path.join(ROOT, src.dir, 'queue.json'), 'utf8')).clips) {
  const TASK = src.dir, AUDIO = path.join(ROOT, TASK);
  const id = clip.id;
  const termPath = path.join(AUDIO, 'ledger', id, 'terminal.json');
  if (!fs.existsSync(termPath)) { gaps.push(`${id}: no terminal record`); continue; }
  const term = JSON.parse(fs.readFileSync(termPath, 'utf8'));
  if (term.state !== 'done') { gaps.push(`${id}: ${term.state}`); continue; }
  const raw = fs.readFileSync(path.join(AUDIO, 'raw', `${id}.wav`));
  const side = JSON.parse(fs.readFileSync(path.join(AUDIO, 'raw', `${id}.sidecar.json`), 'utf8'));
  const rawSha = sha256(raw);
  if (rawSha !== term.rawSha256 || (side.rawSha256 && rawSha !== side.rawSha256)) throw new Error(`${id}: raw SHA-256 mismatch`);
  const w = readWav(raw), sr = w.sampleRate, rawQc = D.analyse(w.channels, sr);
  const x = D.downmix(w.channels);
  const qf = quietFrac(x, sr);
  if (qf < QUIET_MIN) {
    excluded.push({id, batch: src.label, jobId: term.jobId, rawSha256: rawSha, seconds: clip.seconds, reason: `structural QC: continuous signal — only ${(qf * 100).toFixed(1)} % of 5 ms frames are ${-QUIET_DB} dB below the peak (cough takes need >= ${QUIET_MIN * 100} %); no discrete cough bursts`, rawQc});
    continue;
  }
  const on = D.onsets(x, sr, RECIPE.onset);
  if (!on.length) { gaps.push(`${id}: no onset found`); continue; }
  const a = on[0], b = activeEnd(x, sr, a);
  const chs = D.slice([x], a, b);
  const outS = Math.min(RECIPE.fadeOut, (b - a) / sr * 0.3);
  D.fade(chs, sr, RECIPE.fadeIn, outS);
  const g = D.normalisePeak(chs, -1);
  const y = chs[0], durS = r3(y.length / sr);
  const events = D.onsets(y, sr, RECIPE.onset).length;
  const mp3 = encode(y, sr, RECIPE.kbps);
  const name = id; // cough-NN-<kind>
  fs.writeFileSync(path.join(OUT_DIR, `${name}.mp3`), mp3);
  manifest.push({url: `assets/audio/${name}.mp3`, dur: durS, src: id});
  sigs.push({id, sig: signature(y, sr)});
  derivs.push({file: `game/public/assets/audio/${name}.mp3`, url: `assets/audio/${name}.mp3`, bytes: mp3.length, sha256: sha256(mp3), cue: 'cough', durationS: durS,
    source: {clip: id, batch: src.label, task: src.task, rawFile: `${TASK}/raw/${id}.wav`, rawSha256: rawSha, jobId: term.jobId, labFile: term.labFile, prompt: clip.prompt, seed: clip.seed, seconds: clip.seconds,
      steps: clip.steps, cfg: clip.cfg, rawQc},
    structural: {quietFrac: +qf.toFixed(3), coughEvents: events, activeS: D.analyse([y], sr).activeS, peakDb: +D.linToDb(D.peak([y])).toFixed(1), rmsDb: +D.linToDb(D.rms([y])).toFixed(1),
      centroidHz: centroid(y, sr), zcrPerS: D.analyse([y], sr).zcrPerS},
    ops: [{op: 'downmix', to: 'mono'}, {op: 'trim', startS: r3(a / sr), endS: r3(b / sr), note: `first onset to the end of the last cough above ${RECIPE.tailDb} dB re peak (+${RECIPE.holdMs} ms)`},
      {op: 'fade', inS: RECIPE.fadeIn, outS: r3(outS), curve: 'cosine'}, {op: 'normalise', peakDbfs: -1, gainDb: +g.toFixed(2)},
      {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME} (LGPL-3.0, build-time only)`, kbps: RECIPE.kbps}]});
}
// take-to-take envelope similarity (Pearson on the 48-point signatures): reported so near-duplicate takes would be visible
const pairs = [];
for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
  let c = 0;
  for (let k = 0; k < 48; k++) c += sigs[i].sig[k] * sigs[j].sig[k];
  pairs.push({a: sigs[i].id, b: sigs[j].id, envelopeCorr: r3(c)});
}
pairs.sort((p, q) => q.envelopeCorr - p.envelopeCorr);

fs.writeFileSync(MANIFEST_TS, `// GENERATED by tools/audio-pipeline/build-cough.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/assets/derivatives/audio-cough.json. Task gas-mask-roof-feedback-20261030: the player's cough while toxic gas hurts.

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_COUGH: Readonly<Record<string, readonly ClipRef[]>> = {
 cough: [
${manifest.map(m => `  ${JSON.stringify(m)},`).join('\n')}
 ],
};

/** Cues of this build without a clip (silent gaps). */
export const CLIP_GAPS_COUGH: readonly string[] = ${JSON.stringify(manifest.length ? [] : ['cough'])};

/** Total bytes of this build's derivatives. */
export const CLIP_BYTES_COUGH = ${derivs.reduce((s, d) => s + d.bytes, 0)};
`);
const bytes = derivs.reduce((s, d) => s + d.bytes, 0);
const prov = {task: 'studio-alpha-gas-mask-roof-feedback-20261030-01 + studio-alpha-cough-completion-20261030-01', generatedBy: 'tools/audio-pipeline/build-cough.mjs',
  policy: 'Sound Lab only: one derivative per freshly authorized Sound Lab cough job (distinct prompts / seeds; no pitch / rate variants, no stacking). Original 10-job allowance (closed): five takes failed the structural cough gate and are excluded; the user then authorized regenerations, and completion batch 1 (5 jobs, whole-second durations) replaced them. Takes failing the gate are never shipped',
  license: {status: 'Conditional prototype: Stability AI Community License + Gemma terms; not production/commercial clearance. Not listened to on the worker: structural analysis only (see structural / similarity).', gameReady: false, notice: 'game/public/assets/audio/NOTICE.md'},
  lab: 'http://10.0.0.59:7871 (Last Line Sound Lab CPU 0.1.0; stabilityai/stable-audio-3-small-sfx @ 05ca3857, weights stable-audio-3-optimized @ 08b17423, profile w8a8)',
  rawArchive: SOURCES.map(x => `${x.dir}/ (raw WAVs + lab sidecars in raw/, intents/ACKs/terminals in ledger/, runner.log, queue.json, PLAN.json)`),
  auditioned: false,
  gaps, excluded, qcGate: {quietDb: QUIET_DB, quietMinFrac: QUIET_MIN, note: 'continuous takes are not shipped; their replacements came from completion batch 1'}, totalBytes: bytes, similarity: {method: '48-point mean-removed, unit-norm 5 ms envelope signatures; Pearson r', highest: pairs.slice(0, 5)}, derivatives: derivs};
fs.writeFileSync(PROV, JSON.stringify(prov, null, 1) + '\n');
console.log(`total ${derivs.length} derivatives, ${bytes} B; gaps: ${gaps.length ? gaps.join(', ') : 'none'}; excluded: ${excluded.map(e => e.id).join(', ') || 'none'}`);
for (const d of derivs) console.log(d.source.clip, d.durationS + 's', 'events', d.structural.coughEvents, 'active', d.structural.activeS, 'centroid', d.structural.centroidHz, 'Hz', 'rms', d.structural.rmsDb);
console.log('most similar pairs', JSON.stringify(pairs.slice(0, 3)));
