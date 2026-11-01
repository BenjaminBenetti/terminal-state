#!/usr/bin/env node
// Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO; user: "It needs unique 'squishy sounds' to really sell
// its swamp creature feel."): runtime derivatives of the Strainer's Sound Lab takes — wet squelching footfalls (sliced), a wet arm
// swing (one-shots), the fleshy claw-contact squelch (one-shots) and a short wet squish when it is shot (leftover wet-slap groups of
// a footstep take, no extra job). The jobs ran through tools/audio-pipeline/soundlab_runner.py (plan: strainer-plan.py; one
// fsynced intent per POST; whole-second durations; SOUND_LAB_MAX_POSTS); this builder makes NO Sound Lab call. It edits the
// generated clips only and never creates sound.
//
// Inputs (read-only, never modified): reference/tasks/strainer-reach-squish-20261101-201110/audio/{queue.json, ledger/<id>/
//   terminal.json, raw/<id>.wav, raw/<id>.sidecar.json, raw/<id>.lab.json}. Each raw is verified against its ledger terminal +
//   runner sidecar SHA-256 and the lab sidecar against the runner sidecar's labSidecarSha256 before use.
// Outputs: game/public/assets/audio/strainer-*.mp3, game/src/audio/manifest.strainer.generated.ts (merged into bank.ts
//   CLIP_MANIFEST), game/public/assets/derivatives/audio-strainer.json (provenance), and the private QC record next to the raws
//   (QC.json, qc/*.png raw gate images, qc/built/*.png shipped-derivative images).
//
// Ops per derivative: mono downmix (mean) -> trim (one-shots: first frame above the start threshold minus a short pre-roll, to the
//   end of the CONNECTED active run; slices: one wet-footfall GROUP = a connected active run of the footstep take) -> cosine fades
//   -> peak normalisation to -1 dBFS (the iteration-05 convention of the zombie steps / swings / flesh impacts it plays beside;
//   CUE_GAIN in audio/sfx.ts sets the mix) -> MP3 (lamejs, mono, 128 kbps).
// Gate: every raw and every derivative must pass the Strainer STRUCTURAL gate below (a failing take / slice is excluded and
//   recorded, never shipped). The clips were NOT listened to on the worker (no audio output): the user taste-tests in game.
//
// Usage: node tools/audio-pipeline/strainer-build.mjs [--dry-run]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as S from './lib/structural.mjs';
import {renderQc, stackPngs} from './lib/qc-render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK_DIR = 'reference/tasks/strainer-reach-squish-20261101-201110';
const AUDIO = path.join(ROOT, TASK_DIR, 'audio'), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.strainer.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-strainer.json');
const QC_DIR = path.join(AUDIO, 'qc'), QC_BUILT = path.join(QC_DIR, 'built');
const DRY = process.argv.includes('--dry-run');
const LAME_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;
const KBPS = 128, PEAK_DB = -1;

/** The runtime cues of this build (game/src/audio/bank.ts CUES). */
export const CUES_STRAINER = ['strainerStep', 'strainerSwing', 'strainerContact', 'strainerSquish'];
/**
 * Intended mix gains (audio/sfx.ts CUE_GAIN; a test keeps them equal). Set from mixCalibration below (event level = the loudest
 * 50 ms RMS of a variant at the source, x CUE_GAIN, before distance / occlusion / master):
 *  - strainerStep ~ +2 dB over a heavy zombie step at ITS chase gain (it is the bigger, wetter body, still under the vocals);
 *  - strainerSwing ~ 4 dB under the zombie attack snarl that starts the same swing (a supporting whoosh, not a second vocal);
 *  - strainerContact ~ the player's pain grunt / the foreground hit confirm it lands with (the key "you were clawed" feedback);
 *  - strainerSquish ~ 4.5 dB under the player's foreground hit confirm at the source (flavour on a hit, never masking the confirm;
 *    it is positional, so quieter again with distance).
 */
export const CUE_GAIN_STRAINER = {strainerStep: 0.38, strainerSwing: 0.36, strainerContact: 0.6, strainerSquish: 0.32};

/**
 * Recipes. Thresholds re the take's loudest 5 ms frame (and >= the take's 3rd-percentile floor + 8 dB).
 *  step:    one variant per wet-footfall GROUP (connected active run, gaps <= maxGapS) of a footstep take: the `perTake` loudest
 *           passing groups; capped at maxS (< the 0.8 s chase footfall interval) with a fade.
 *  squish:  the next `n` loudest passing groups of `fromTake` that are not footsteps (same take, no extra job), shorter.
 *  swing / contact: one-shot = the connected active run that holds the take's peak.
 */
export const RECIPES_STRAINER = {
  // maxGapS 0.2: a slap and its own squelch tail (up to ~0.15 s apart in the takes) stay ONE footfall
  strainerStep: {kind: 'stepSlice', takes: ['strainer-step-01', 'strainer-step-02'], perTake: 4, startDb: -40, maxGapS: 0.2, preS: 0.004, holdMs: 40, fadeIn: 0.002, fadeOut: 0.08, maxS: 0.55, minS: 0.12},
  strainerSquish: {kind: 'stepSlice', fromTake: 'strainer-step-01', n: 3, startDb: -40, maxGapS: 0.2, preS: 0.004, holdMs: 30, fadeIn: 0.002, fadeOut: 0.06, maxS: 0.4, minS: 0.1},
  strainerSwing: {kind: 'swing', startDb: -35, maxGapS: 0.12, preS: 0.01, holdMs: 40, fadeIn: 0.006, fadeOut: 0.1, maxS: 1.4},
  strainerContact: {kind: 'contact', startDb: -40, maxGapS: 0.1, preS: 0.002, holdMs: 40, fadeIn: 0.0015, fadeOut: 0.08, maxS: 0.7},
};

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

function fade(x, sr, inS, outS) {
  const n = x.length, fi = Math.min(n, Math.round(inS * sr)), fo = Math.min(n, Math.round(outS * sr));
  for (let i = 0; i < fi; i++) x[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fi);
  for (let i = 0; i < fo; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fo);
}

/**
 * Connected active runs ("groups") of a take on the 5 ms envelope: frames above max(peak + startDb, floor + 8) joined across
 * gaps <= maxGapS. Returns [{a, b (frames), peakDb, energy}], plus the thresholds.
 */
function groups(x, sr, rc) {
  const env = S.envelopeDb(x, sr, 0.005);
  const pk = Math.max(...env), floor = [...env].sort((p, q) => p - q)[Math.floor(env.length * 0.03)];
  const thr = Math.max(pk + rc.startDb, floor + 8), maxGap = Math.round(rc.maxGapS / 0.005);
  const out = [];
  let cur = null, gap = 0;
  for (let h = 0; h < env.length; h++) {
    if (env[h] > thr) {
      if (!cur) cur = {a: h, b: h, peakDb: env[h], energy: 0};
      cur.b = h; gap = 0;
      cur.peakDb = Math.max(cur.peakDb, env[h]);
      cur.energy += Math.pow(10, env[h] / 10);
    } else if (cur && ++gap > maxGap) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return {groups: out, thrDbfs: +thr.toFixed(1), floorDbfs: +floor.toFixed(1), peakDbfs: +pk.toFixed(1), env};
}

/**
 * Sample span of a group: pre-roll before its first frame to its last frame + hold, capped at maxS. Footfall / squish slices
 * (`env` given) start at the group's MAIN transient instead when a quieter lead-in precedes it by > 40 ms: the rise start of the
 * loudest frame (walking back while within 20 dB of it) — the slap lands at the start of the slice (and on the foot plant).
 */
function spanOf(g, x, sr, rc, env = null) {
  const hop = Math.round(sr * 0.005);
  let f0 = g.a;
  if (env) {
    let ph = g.a;
    for (let h = g.a; h <= g.b; h++) if (env[h] > env[ph]) ph = h;
    let s = ph;
    while (s > g.a && env[s - 1] > env[ph] - 20) s--;
    if (s - g.a > 8) f0 = s;
  }
  const a = Math.max(0, f0 * hop - Math.round(rc.preS * sr));
  const b = Math.min(x.length, (g.b + 1) * hop + Math.round(rc.holdMs / 1000 * sr), a + Math.round(rc.maxS * sr));
  return {a, b, leadInS: r3((f0 - g.a) * 0.005)};
}

/** Loudest 50 ms RMS (dBFS, unweighted): the event level of a short transient (BS.1770 400 ms blocks smear it). */
function eventLevelDb(x, sr) {
  const W = Math.round(0.05 * sr), hop = Math.round(0.005 * sr);
  let best = 0;
  for (let a = 0; a + W <= Math.max(W, x.length); a += hop) {
    let s = 0;
    for (let i = a; i < Math.min(x.length, a + W); i++) s += x[i] * x[i];
    best = Math.max(best, s / W);
  }
  return +S.linToDb(Math.sqrt(best)).toFixed(1);
}

/** Seconds from the AUDIBLE start (bank.ts leadOffset: first sample above -50 dB re peak, minus 0.5 ms) to the loudest 20 ms RMS. */
function peakFromAudibleStart(x, sr) {
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  const thr = pk * Math.pow(10, -50 / 20);
  let first = 0;
  while (first < x.length && Math.abs(x[first]) <= thr) first++;
  const W = Math.round(0.02 * sr), hop = Math.round(0.005 * sr);
  let best = -1, at = 0;
  for (let a = 0; a + W <= x.length; a += hop) {
    let s = 0;
    for (let i = a; i < a + W; i++) s += x[i] * x[i];
    if (s > best) { best = s; at = a + W / 2; }
  }
  return r3(Math.max(0, (at - first) / sr + 0.0005));
}

/**
 * Strainer structural gate per kind (NOT a listening test). Every criterion is reported with its measured value; `pass` = all
 * required ones hold. The known Sound Lab failure (continuous broadband noise / drone with no structure) fails every kind.
 *  - stepTake:  a footstep take — >= 5 separate wet-footfall groups, mostly silent between them (quiet >= 50 %), unvoiced.
 *  - stepSlice: one footfall / squish — transient onset (rise <= 120 ms, peak in the first 250 ms), unvoiced, decays inside the slice.
 *  - swing:     one airy / fleshy WHOOSH — unvoiced, no narrow tonal band (no band > 75 % of the energy), ONE connected event of
 *               0.3–1.4 s holding >= 85 % of the energy, ending in silence before the clip end.
 *  - contact:   one hit — transient onset (rise <= 100 ms), unvoiced, short (main event <= 0.8 s) and decaying.
 */
export function strainerVerdict(kind, m, extra = {}) {
  const c = [];
  const req = (name, ok, value, need) => c.push({name, ok: !!ok, value, need, required: true});
  const info = (name, value) => c.push({name, value, required: false});
  const noiseWall = m.levelSpreadDb < 2 && m.spectral.flatness >= 0.35 && m.pitch.voicedFrac < 0.1;
  req('not a broadband noise wall / drone', !noiseWall, {levelSpreadDb: m.levelSpreadDb, flatness: m.spectral.flatness, voicedFrac: m.pitch.voicedFrac}, 'NOT (spread < 2 dB AND flatness >= 0.35 AND voiced < 0.1)');
  req('audible (not near-silent)', m.peakDbfs > -45, m.peakDbfs, '> -45 dBFS');
  req('no clipping', m.clippedFrac < 1e-4, m.clippedFrac, '< 0.0001');
  const maxBand = Math.max(...Object.values(m.spectral.bands));
  if (kind === 'stepTake') {
    req('separate footfall groups', (extra.groups ?? 0) >= 5, extra.groups, '>= 5');
    req('silent between steps', m.quietFrac >= 0.5, m.quietFrac, 'quiet >= 0.5');
    req('unvoiced (no voice / tone)', m.pitch.voicedFrac <= 0.2, m.pitch.voicedFrac, '<= 0.2');
  } else if (kind === 'stepSlice') {
    req('transient onset', m.attack.riseMs <= 120 && m.attack.peakS <= 0.25, {riseMs: m.attack.riseMs, peakS: m.attack.peakS}, 'rise <= 120 ms, peak <= 0.25 s');
    req('unvoiced (no voice / tone)', m.pitch.voicedFrac <= 0.25, m.pitch.voicedFrac, '<= 0.25');
    req('decays', m.decay.lastMinusFirstDb <= -6, m.decay.lastMinusFirstDb, 'last quarter <= -6 dB vs first');
    req('long enough', m.durationS >= (extra.minS ?? 0.1), m.durationS, `>= ${extra.minS ?? 0.1} s`);
    info('low-end share (0–300 Hz, body)', m.spectral.bands['0-300Hz']);
  } else if (kind === 'swing') {
    req('unvoiced (no voice / tone)', m.pitch.voicedFrac <= 0.2, {voicedFrac: m.pitch.voicedFrac, f0MedianHz: m.pitch.f0MedianHz}, '<= 0.2');
    req('no narrow tonal band', maxBand <= 0.75, {maxBandShare: r3(maxBand)}, 'no band > 75 % of the energy');
    req('one connected whoosh', extra.mainS >= 0.3 && extra.mainS <= 1.4 && extra.mainShare >= 0.85, {mainS: extra.mainS, mainShare: extra.mainShare}, 'main event 0.3–1.4 s holding >= 85 % of the energy');
    // (a derivative is trimmed at the end of its run by construction: the raw must show the silence after it)
    if (!extra.derivative) req('ends in silence', m.decay.activeEndS <= m.durationS - 0.3, {activeEndS: m.decay.activeEndS, durationS: m.durationS}, 'active end <= duration - 0.3 s');
  } else if (kind === 'contact') {
    req('transient onset', m.attack.riseMs <= 100, m.attack.riseMs, '<= 100 ms');
    req('unvoiced (no voice / tone)', m.pitch.voicedFrac <= 0.2, m.pitch.voicedFrac, '<= 0.2');
    req('short hit', extra.mainS <= 0.8, extra.mainS, 'main event <= 0.8 s');
    if (extra.derivative) req('decays', m.decay.lastMinusFirstDb <= -10 && m.decay.slopeDbPerS < 0, {lastMinusFirstDb: m.decay.lastMinusFirstDb, slopeDbPerS: m.decay.slopeDbPerS}, 'last quarter <= -10 dB vs first, slope < 0');
    else req('decays', (m.decay.activeEndS <= m.durationS - 0.5 || m.decay.lastMinusFirstDb <= -15) && m.decay.slopeDbPerS < 0,
      {activeEndS: m.decay.activeEndS, lastMinusFirstDb: m.decay.lastMinusFirstDb, slopeDbPerS: m.decay.slopeDbPerS}, 'ends >= 0.5 s early or -15 dB, slope < 0');
  } else throw new Error(`unknown kind ${kind}`);
  const pass = c.filter(x => x.required).every(x => x.ok);
  return {kind, pass, failed: c.filter(x => x.required && !x.ok).map(x => x.name), criteria: c};
}

/** Reference cues' levels, re-derived from their raws + recorded ops (when the reference mount is present). */
function mixCalibration(sfxSrc) {
  const REF = ['zombieStepHeavy', 'zombieStep', 'zombieAttack', 'impactFlesh', 'hurt', 'bodyFall', 'zombieGroanDeep', 'blightBurst'];
  const gainOf = cue => { const m = sfxSrc.match(new RegExp(`\\b${cue}: ([0-9.]+)`)); return m ? +m[1] : null; };
  const acc = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'game/public/assets/derivatives')).filter(n => n.startsWith('audio-') && n !== 'audio-strainer.json')) {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives', f), 'utf8'));
    for (const d of p.derivatives ?? []) {
      if (!REF.includes(d.cue) || !fs.existsSync(path.join(ROOT, d.source.rawFile))) continue;
      if ((d.ops ?? []).some(o => !['downmix', 'trim', 'fade', 'normalise', 'encode'].includes(o.op))) continue;
      const w = readWav(fs.readFileSync(path.join(ROOT, d.source.rawFile))), sr = w.sampleRate;
      const x = new Float32Array(w.channels[0].length);
      for (const ch of w.channels) for (let i = 0; i < x.length; i++) x[i] += ch[i] / w.channels.length;
      const tr = d.ops.find(o => o.op === 'trim'), nm = d.ops.find(o => o.op === 'normalise'), g = Math.pow(10, (nm?.gainDb ?? 0) / 20);
      const y = x.slice(Math.round(tr.startS * sr), Math.round(tr.endS * sr)).map(v => v * g);
      (acc[d.cue] ??= {cueGain: gainOf(d.cue), ev: [], mm: []});
      acc[d.cue].ev.push(eventLevelDb(y, sr));
      acc[d.cue].mm.push(S.loudness(y, sr).momentaryMaxLufs);
    }
  }
  const out = {};
  for (const [cue, v] of Object.entries(acc)) {
    const avg = a => a.reduce((s, q) => s + q, 0) / a.length, gDb = v.cueGain ? 20 * Math.log10(v.cueGain) : NaN;
    out[cue] = {takes: v.ev.length, eventLevelDbfs: +avg(v.ev).toFixed(1), momentaryMaxLufs: +avg(v.mm).toFixed(1), cueGain: v.cueGain,
      mixEventLevelDb: +(avg(v.ev) + gDb).toFixed(1), mixMomentaryMaxLufs: +(avg(v.mm) + gDb).toFixed(1)};
  }
  return out;
}

function loadRaw(c) {
  const term = JSON.parse(fs.readFileSync(path.join(AUDIO, 'ledger', c.id, 'terminal.json'), 'utf8'));
  if (term.state !== 'done') return {term};
  const wavPath = path.join(RAW, `${c.id}.wav`), side = JSON.parse(fs.readFileSync(path.join(RAW, `${c.id}.sidecar.json`), 'utf8'));
  const wav = fs.readFileSync(wavPath), rawSha = sha256(wav);
  if (rawSha !== term.rawSha256 || rawSha !== side.rawSha256) throw new Error(`${c.id}: raw SHA-256 mismatch — refusing`);
  const labBytes = fs.readFileSync(path.join(RAW, side.labSidecarFile));
  if (sha256(labBytes) !== side.labSidecarSha256) throw new Error(`${c.id}: lab sidecar SHA-256 mismatch — refusing`);
  const w = readWav(wav), sr = w.sampleRate;
  const x = new Float32Array(w.channels[0].length);
  for (const ch of w.channels) for (let i = 0; i < x.length; i++) x[i] += ch[i] / w.channels.length;
  return {term, side, wav, wavPath, rawSha, x, sr, channels: w.channels.length};
}

async function main() {
  const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')).clips;
  const byId = new Map(queue.map(c => [c.id, c]));
  const raws = new Map(), rawQc = [], excluded = [], derivs = [], manifest = {}, renders = [], peaks = {};
  for (const c of queue) raws.set(c.id, loadRaw(c));

  // ---- raw gates (one image each) ----
  for (const c of queue) {
    const R = raws.get(c.id);
    if (!R.x) { excluded.push({clip: c.id, cue: c.cue, reason: `ledger state ${R.term.state}`}); continue; }
    const m = S.structure(R.x, R.sr), lu = S.loudness(R.x, R.sr);
    let v;
    if (c.cue === 'strainerStep') {
      const G = groups(R.x, R.sr, RECIPES_STRAINER.strainerStep);
      v = strainerVerdict('stepTake', m, {groups: G.groups.length});
      R.groups = G;
    } else {
      const rc = RECIPES_STRAINER[c.cue], G = groups(R.x, R.sr, rc);
      const tot = G.groups.reduce((s, g) => s + g.energy, 0) || 1, main = G.groups.reduce((p, g) => (!p || g.energy > p.energy ? g : p), null);
      R.main = main; R.groups = G;
      const extra = {mainS: main ? r3((main.b - main.a + 1) * 0.005) : 0, mainShare: main ? r3(main.energy / tot) : 0};
      v = strainerVerdict(rc.kind, m, extra);
    }
    R.verdict = v;
    rawQc.push({clip: c.id, cue: c.cue, jobId: R.term.jobId, seed: c.seed, seconds: c.seconds, rawSha256: R.rawSha, channels: R.channels, loudness: lu,
      groups: R.groups ? {count: R.groups.groups.length, thresholdDbfs: R.groups.thrDbfs, floorDbfs: R.groups.floorDbfs, startsS: R.groups.groups.map(g => r3(g.a * 0.005))} : null,
      structural: S.publicMetrics(m), verdict: v});
    if (!DRY) {
      fs.mkdirSync(QC_DIR, {recursive: true});
      renders.push(await renderQc(path.join(QC_DIR, `${c.id}.png`), {title: `${c.id} · cue ${c.cue} · seed ${c.seed}`, label: 'RAW', m, verdict: v, lu, sr: R.sr}));
    }
    if (!v.pass) excluded.push({clip: c.id, cue: c.cue, jobId: R.term.jobId, rawSha256: R.rawSha, reason: `raw structural gate (${v.kind}): ${v.failed.join(', ')}`,
      detail: c.id === 'strainer-swing-02' ? 'two separate clusters 1.1 s apart; 87 % of the energy in 300–1000 Hz with a rising ~500 -> 650 Hz pitch track (voiced 44 %): droplet "bloops" / a whistle, not a whoosh. Replaced by strainer-swing-03 (plan batch B).' : undefined});
  }
  if (renders.length && !DRY) await stackPngs(renders, path.join(QC_DIR, 'overview-raw.png'));

  // ---- derivatives ----
  const built = [];
  const emit = (cue, c, R, a, b, rc, file, label, extraOps = []) => {
    const y = R.x.slice(a, b);
    const outS = Math.min(rc.fadeOut, (b - a) / R.sr * 0.3);
    fade(y, R.sr, rc.fadeIn, outS);
    let pk = 0;
    for (const v of y) pk = Math.max(pk, Math.abs(v));
    const gDb = PEAK_DB - S.linToDb(pk), g = Math.pow(10, gDb / 20);
    for (let i = 0; i < y.length; i++) y[i] *= g;
    const m = S.structure(y, R.sr), lu = S.loudness(y, R.sr);
    const extra = rc.kind === 'stepSlice' ? {minS: rc.minS} : (() => {
      const G = groups(y, R.sr, rc), tot = G.groups.reduce((s, q) => s + q.energy, 0) || 1, main = G.groups.reduce((p, q) => (!p || q.energy > p.energy ? q : p), null);
      return {mainS: main ? r3((main.b - main.a + 1) * 0.005) : 0, mainShare: main ? r3(main.energy / tot) : 0, derivative: true};
    })();
    const v = strainerVerdict(rc.kind, m, extra);
    if (!v.pass) {
      excluded.push({clip: c.id, cue, label, jobId: R.term.jobId, rawSha256: R.rawSha, startS: r4(a / R.sr), reason: `derivative structural gate (${v.kind}): ${v.failed.join(', ')}`,
        values: Object.fromEntries(v.criteria.filter(q => q.required && !q.ok).map(q => [q.name, q.value]))});
      return null;
    }
    const mp3 = encodeMp3(y, R.sr, KBPS), url = `assets/audio/${file}`, durS = r4(y.length / R.sr);
    // noise floor = RMS of the raw OUTSIDE every shipped span is not meaningful for slices; report the take's quiet floor after the gain
    const floorAfter = R.groups ? +(R.groups.floorDbfs + gDb).toFixed(1) : null;
    const d = {file: `game/public/${url}`, url, bytes: mp3.length, sha256: sha256(mp3), cue, durationS: durS, channels: 1, sampleRate: R.sr, codec: 'mp3', kbps: KBPS,
      source: {clip: c.id, slice: label || null, rawFile: rel(R.wavPath), rawSha256: R.rawSha, rawBytes: R.wav.length, labFile: R.term.labFile, labSidecar: rel(path.join(RAW, R.side.labSidecarFile)),
        labSidecarSha256: R.side.labSidecarSha256, runnerSidecar: rel(path.join(RAW, `${c.id}.sidecar.json`)), jobId: R.term.jobId, prompt: c.prompt, negativePrompt: c.negative_prompt ?? '',
        seed: c.seed, steps: c.steps, cfg: c.cfg, seconds: c.seconds, model: R.side.model?.modelCard?.repo ?? null, modelRevision: R.side.model?.modelCard?.revision ?? null,
        weightsRepo: R.side.model?.weightsRepo ?? null, weightsRevision: R.side.model?.revision ?? null, profile: R.side.model?.profile ?? null, rawChannels: R.channels,
        rawVerdict: {kind: R.verdict.kind, pass: R.verdict.pass, failed: R.verdict.failed}},
      structural: {...S.publicMetrics(m), loudness: lu, eventLevelDbfs: eventLevelDb(y, R.sr), verdict: v,
        noiseFloor: {takeQuietFloorDbfs: R.groups?.floorDbfs ?? null, afterGainDbfs: floorAfter, belowDerivativePeakDb: floorAfter === null ? null : +(m.peakDbfs - floorAfter).toFixed(1),
          note: 'the take\'s 3rd-percentile 5 ms level (its silence: the Sound Lab decoder idle floor, harmonics of 172.27 Hz) after the applied gain; inside a slice it lies under the sound / the fades'}},
      ops: [{op: 'downmix', to: 'mono', how: 'mean of channels'},
        {op: 'trim', startS: r4(a / R.sr), endS: r4(b / R.sr), ...extraOps[0]},
        {op: 'fade', inS: rc.fadeIn, outS: r4(outS), curve: 'cosine'},
        {op: 'normalise', method: 'sample peak', peakDbfs: PEAK_DB, gainDb: +gDb.toFixed(2)},
        {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME_VERSION} (LGPL-3.0, build-time only)`, kbps: KBPS}]};
    if (cue === 'strainerSwing') { d.peakFromAudibleStartS = peakFromAudibleStart(y, R.sr); peaks[c.id] = d.peakFromAudibleStartS; }
    derivs.push(d);
    (manifest[cue] ??= []).push({url, dur: durS, src: c.id});
    built.push({id: file.replace(/\.mp3$/, ''), cue, seed: c.seed, m, v, lu, sr: R.sr});
    if (!DRY) writeAtomic(path.join(OUT, file), mp3);
    return d;
  };

  // footsteps: the perTake loudest passing groups of each take (time order inside a take); leftover passing groups of the squish take
  const stepRc = RECIPES_STRAINER.strainerStep, sqRc = RECIPES_STRAINER.strainerSquish;
  for (const id of stepRc.takes) {
    const c = byId.get(id), R = raws.get(id);
    if (!R?.verdict?.pass) continue;
    const env = R.groups.env;
    const cands = R.groups.groups.map((g, i) => ({g, i, ...spanOf(g, R.x, R.sr, stepRc, env)})).filter(s => s.b - s.a >= stepRc.minS * R.sr);
    const ranked = [...cands].sort((p, q) => q.g.peakDb - p.g.peakDb);
    const used = new Set();
    let n = 0;
    for (const s of ranked) {
      if (n >= stepRc.perTake) break;
      const d = emit('strainerStep', c, R, s.a, s.b, stepRc, `${id}-s${String(n + 1).padStart(2, '0')}.mp3`, `group ${s.i + 1} @ ${r3(s.g.a * 0.005)} s`,
        [{groupStartS: r3(s.g.a * 0.005), groupEndS: r3((s.g.b + 1) * 0.005), leadInSkippedS: s.leadInS, maxS: stepRc.maxS, note: 'one wet-footfall group (connected active run), from its main transient'}]);
      used.add(s.i);
      if (d) n++;
    }
    if (id === sqRc.fromTake) {
      let k = 0;
      for (const s of ranked.filter(q => !used.has(q.i))) {
        if (k >= sqRc.n) break;
        const sp = spanOf(s.g, R.x, R.sr, sqRc, env);
        const d = emit('strainerSquish', c, R, sp.a, sp.b, sqRc, `strainer-squish-${String(k + 1).padStart(2, '0')}.mp3`, `group ${s.i + 1} @ ${r3(s.g.a * 0.005)} s`,
          [{groupStartS: r3(s.g.a * 0.005), groupEndS: r3((s.g.b + 1) * 0.005), leadInSkippedS: sp.leadInS, maxS: sqRc.maxS, note: 'a wet-slap group of the footstep take NOT used as a footstep, from its main transient'}]);
        if (d) k++;
      }
    }
  }
  // one-shots: the connected run holding the take's peak
  for (const c of queue.filter(q => q.cue === 'strainerSwing' || q.cue === 'strainerContact')) {
    const R = raws.get(c.id);
    if (!R?.verdict?.pass) continue;
    const rc = RECIPES_STRAINER[c.cue], sp = spanOf(R.main, R.x, R.sr, rc);
    emit(c.cue, c, R, sp.a, sp.b, rc, `${c.id}.mp3`, '', [{startThresholdDbfs: R.groups.thrDbfs, maxGapS: rc.maxGapS, holdMs: rc.holdMs, note: 'the connected active run holding the take\'s peak'}]);
  }

  const gaps = CUES_STRAINER.filter(k => !manifest[k]?.length);
  const totalBytes = derivs.reduce((s, d) => s + d.bytes, 0);
  const side0 = raws.get(queue[0].id).side;
  const sfxSrc = fs.readFileSync(path.join(ROOT, 'game/src/audio/sfx.ts'), 'utf8');
  const calib = mixCalibration(sfxSrc);
  const mixOf = cue => {
    const ds = derivs.filter(d => d.cue === cue), avg = f => ds.reduce((s, d) => s + f(d), 0) / Math.max(1, ds.length), gDb = 20 * Math.log10(CUE_GAIN_STRAINER[cue]);
    return {variants: ds.length, eventLevelDbfs: +avg(d => d.structural.eventLevelDbfs).toFixed(1), momentaryMaxLufs: +avg(d => d.structural.loudness.momentaryMaxLufs).toFixed(1),
      cueGain: CUE_GAIN_STRAINER[cue], mixEventLevelDb: +(avg(d => d.structural.eventLevelDbfs) + gDb).toFixed(1), mixMomentaryMaxLufs: +(avg(d => d.structural.loudness.momentaryMaxLufs) + gDb).toFixed(1),
      mixPeakDbfs: +(Math.max(...ds.map(d => d.structural.peakDbfs)) + gDb).toFixed(1)};
  };
  const ledger = queue.map(c => {
    const R = raws.get(c.id), intents = fs.readdirSync(path.join(AUDIO, 'ledger', c.id)).filter(n => n.endsWith('.intent.json')).length;
    return {clip: c.id, cue: c.cue, seconds: c.seconds, seed: c.seed, steps: c.steps, cfg: c.cfg, prompt: c.prompt, posts: intents, state: R.term.state, jobId: R.term.jobId ?? null,
      rawSha256: R.rawSha ?? null, rawBytes: R.wav?.length ?? null, structuralVerdict: R.verdict ? (R.verdict.pass ? 'PASS' : `FAIL: ${R.verdict.failed.join(', ')}`) : null,
      shipped: derivs.filter(d => d.source.clip === c.id).map(d => d.url)};
  });
  const prov = {
    task: 'studio-alpha-strainer-reach-squish-20261101-201110-01', lane: 'AUDIO (Strainer squish set: wet footfalls, arm swing, claw contact, hit squish)',
    generatedBy: 'tools/audio-pipeline/strainer-build.mjs', plannedBy: 'tools/audio-pipeline/strainer-plan.py',
    userRequest: 'It needs unique "squishy sounds" to really sell its swamp creature feel. (2026-11-01)',
    policy: 'Sound Lab only (the user\'s existing local service, bounded Strainer-only authorization: at most ~8 jobs, stop at the first acceptable takes). 7 jobs: batch A (6) + one replacement (batch B) for the one structurally rejected take; no rerolls of acceptable takes; whole-second durations. No synthesis, stock, layering or pitch / rate variants in the files (the game applies its usual small playback-rate jitter). The squish reuses footfall groups of strainer-step-01 that are not shipped as footsteps (no extra job). Takes / slices failing the structural gate are never shipped. The Strainer keeps its existing zombie voice cues (deep groan, alert, attack snarl, death).',
    license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
      kitStatus: side0.license?.status ?? null, review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (envelope, groups, spectrogram, pitch track, levels). The user taste-tests in game.', gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
    auditioned: false,
    soundLab: {endpoint: 'http://10.0.0.59:7871', kit: side0.kit ?? null, model: side0.model?.modelCard?.repo ?? null, modelRevision: side0.model?.modelCard?.revision ?? null,
      weightsRepo: side0.model?.weightsRepo ?? null, weightsRevision: side0.model?.revision ?? null, profile: side0.model?.profile ?? null, upstreamCode: side0.upstreamCode ?? null,
      runner: 'tools/audio-pipeline/soundlab_runner.py (flock /tmp/ll-soundlab.lock; SOUND_LAB_MAX_POSTS=6 for batch A, 7 for batch B; allowance 8)', jobs: queue.length},
    usage: {allowanceJobs: 8, posts: ledger.reduce((s, l) => s + l.posts, 0), submitted: queue.length, succeeded: ledger.filter(l => l.state === 'done').length, failed: ledger.filter(l => l.state !== 'done').length,
      structurallyRejected: ledger.filter(l => l.structuralVerdict && l.structuralVerdict !== 'PASS').map(l => l.clip), jobs: ledger},
    rawArchive: `${TASK_DIR}/audio/ (raw WAVs + lab / runner sidecars in raw/, intents / ACKs / terminals in ledger/, runner.log, queue.json, PLAN.json, QC.json + qc/*.png) — private, never in Git`,
    design: {
      strainerStep: 'Wet squelching footfalls REPLACING the Strainer\'s borrowed heavy zombie gait: one variant per wet-footfall group (slap + squelch tail) of two 10 s footstep takes (4 + 4). Played on the foot plants of its own Walk / Run clips (left plant at phase 0, right at 0.5; the actor\'s clip time scale = ground speed / clip ground speed, clamped 0.35–1.8): silent when standing still (ground speed < 0.15 m/s) and outside the locomotion clips. audio/sfx.ts STRAINER_AUDIO.step.',
      strainerSwing: 'One wet arm-swing whoosh per swing, aligned so its loudest 20 ms lands on the claw\'s impact frame (peakFromAudibleStartS per clip; the brain lands the swipe attackImpact s after the swing starts). A swing interrupted (stagger / death) before its whoosh starts stays silent. Plays on a miss too (the arm still swings) — it carries no impact.',
      strainerContact: 'The fleshy claw-contact squelch: ONLY when the claw connects (brain out.attackHit -> game.ts hurtPlayer, attacker \'strainer\'), never on a miss; at the player\'s chest, toward the attacker.',
      strainerSquish: 'A short wet squish when the Strainer is shot but not killed (EnemyCues.hurt), rate-limited per Strainer (STRAINER_AUDIO.squish.minGapS) and capped.',
    },
    swingPeaks: peaks,
    loudness: {method: 'sample-peak normalisation to -1 dBFS (iteration-05 convention); eventLevel = loudest 50 ms RMS (unweighted dBFS); momentary max = ITU-R BS.1770-4 400 ms block (mono)'},
    mixCalibration: {note: 'Per-cue level at the source (derivative x CUE_GAIN, before distance / occlusion / master). Reference cues re-derived from their raws + recorded ops. Targets (mixEventLevelDb = loudest 50 ms RMS x CUE_GAIN): strainerStep ~ +2 dB over a heavy zombie step at its chase call gain (coated chase 1.75 m/s: x1.04; the Strainer step call gain at its 1.35 m/s chase is x1.0); swing ~4 dB under the zombie attack snarl; contact ~ between the player hurt grunt and the foreground hit confirm (impactFlesh x HIT_CONFIRM.level 0.65 -> -20.0 dB); squish ~4.5 dB under that hit confirm at the source (positional: quieter with distance).',
      new: Object.fromEntries(CUES_STRAINER.filter(k => manifest[k]).map(k => [k, mixOf(k)])), reference: calib},
    qc: {gate: 'strainerVerdict in tools/audio-pipeline/strainer-build.mjs (raw AND derivative must pass)', rawQc: `${TASK_DIR}/audio/QC.json`, images: `${TASK_DIR}/audio/qc/*.png (raws), ${TASK_DIR}/audio/qc/built/*.png (shipped derivatives, pre-MP3)`},
    totals: {derivatives: derivs.length, bytes: totalBytes, cuesCovered: Object.keys(manifest).length, cues: CUES_STRAINER.length}, gaps, excluded, derivatives: derivs,
  };
  const body = CUES_STRAINER.filter(k => manifest[k]?.length).map(k => ` ${k}: [\n${manifest[k].map(m => `  ${JSON.stringify(m)},`).join('\n')}\n ],`).join('\n');
  const ts = `// GENERATED by tools/audio-pipeline/strainer-build.mjs from the Sound Lab raws — do not edit by hand.\n` +
    `// Provenance: public/assets/derivatives/audio-strainer.json. Task studio-alpha-strainer-reach-squish-20261101-201110-01 (lane AUDIO):\n` +
    `// the Strainer's wet footfalls, arm swing, claw contact and hit squish. Cues absent here are SILENT gaps (no fallback).\n\n` +
    `import type {ClipRef} from './manifest.generated';\n\n` +
    `export const CLIP_MANIFEST_STRAINER: Readonly<Record<string, readonly ClipRef[]>> = {\n${body}\n};\n\n` +
    `/** Seconds from each swing clip's audible start to its loudest 20 ms (keyed by ClipRef.src): aligned to the claw's impact. */\n` +
    `export const STRAINER_SWING_PEAK_S: Readonly<Record<string, number>> = ${JSON.stringify(peaks)};\n\n` +
    `/** Cues of this build without a clip (silent gaps). */\nexport const CLIP_GAPS_STRAINER: readonly string[] = ${JSON.stringify(gaps)};\n\n` +
    `/** Total bytes of this build's derivatives. */\nexport const CLIP_BYTES_STRAINER = ${totalBytes};\n`;
  if (!DRY) {
    writeAtomic(MANIFEST_TS, ts);
    writeAtomic(PROV, JSON.stringify(prov, null, 1) + '\n');
    writeAtomic(path.join(AUDIO, 'QC.json'), JSON.stringify({task: prov.task, builder: prov.generatedBy, note: 'Raw structural QC (not a listening test).', raws: rawQc, excluded,
      shipped: derivs.map(d => ({url: d.url, cue: d.cue, clip: d.source.clip, slice: d.source.slice, durationS: d.durationS, bytes: d.bytes, sha256: d.sha256, verdict: d.structural.verdict.pass}))}, null, 1) + '\n');
    fs.mkdirSync(QC_BUILT, {recursive: true});
    const imgs = [];
    for (const q of built) imgs.push(await renderQc(path.join(QC_BUILT, `${q.id}.png`), {title: `${q.id} · cue ${q.cue} · seed ${q.seed}`, label: 'SHIPPED DERIVATIVE (pre-MP3)', m: q.m, verdict: q.v, lu: q.lu, sr: q.sr}));
    if (imgs.length) await stackPngs(imgs, path.join(QC_BUILT, 'overview.png'));
  }
  console.log(`derivatives ${derivs.length}, ${(totalBytes / 1e3).toFixed(1)} kB; cues ${Object.keys(manifest).length}/${CUES_STRAINER.length}; gaps: ${gaps.join(', ') || 'none'}`);
  for (const r of rawQc) console.log(`  raw ${r.clip.padEnd(20)} ${r.verdict.pass ? 'PASS' : 'FAIL ' + r.verdict.failed.join(', ')} groups=${r.groups?.count} starts=${r.groups?.startsS.join(',')}`);
  for (const d of derivs) {
    const tr = d.ops.find(o => o.op === 'trim'), nm = d.ops.find(o => o.op === 'normalise');
    console.log(`  ${path.basename(d.url).padEnd(26)} ${d.cue.padEnd(15)} ${d.durationS.toFixed(3)} s [${tr.startS}–${tr.endS}] ev ${d.structural.eventLevelDbfs} Mmax ${d.structural.loudness.momentaryMaxLufs} gain ${nm.gainDb} dB ${d.bytes} B ${d.peakFromAudibleStartS !== undefined ? 'peak@' + d.peakFromAudibleStartS + ' s ' : ''}rise ${d.structural.attack.riseMs} ms voiced ${d.structural.pitch.voicedFrac} floor ${d.structural.noiseFloor.belowDerivativePeakDb} dB below peak`);
  }
  for (const e of excluded) console.log(`  EXCLUDED ${e.clip}${e.label ? ' ' + e.label : ''}: ${e.reason}${e.values ? ' ' + JSON.stringify(e.values) : ''}`);
  console.log('mix (new):', JSON.stringify(prov.mixCalibration.new));
  console.log('mix (reference):', JSON.stringify(Object.fromEntries(Object.entries(calib).map(([k, v]) => [k, {ev: v.mixEventLevelDb, mm: v.mixMomentaryMaxLufs, g: v.cueGain}]))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
