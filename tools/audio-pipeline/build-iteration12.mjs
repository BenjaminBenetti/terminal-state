// Iteration 12 (task studio-atmosphere-light-survival-20261028-01, AUDIO lane): runtime derivatives of the FIVE authorized
// Sound Lab jobs for the flashlight battery + thrown flare (battery insert, flare ignite, flare burn loop, flare burn-out,
// failing-flashlight flicker). Reads reference/tasks/atmosphere-light-survival-20261028/audio/raw/<id>.wav (each verified against
// its runner sidecar + terminal SHA-256) and writes game/public/assets/audio/i12-*.mp3,
// game/src/audio/manifest.iteration12.generated.ts and game/public/assets/derivatives/audio-iteration12.json.
// Ops: mono downmix, onset / event trims, a gentle high-pass on the flicker (removes LF thumps), cosine fades, a slow level
// flattening + equal-power crossfaded seamless loop with periodic margins for the burn, peak (-1 dBFS) or RMS (-20 dBFS) levelling,
// MP3. Edits the generated clips only; never creates sound.
// Usage: node tools/audio-pipeline/build-iteration12.mjs
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const TASK = 'reference/tasks/atmosphere-light-survival-20261028/audio';
const AUDIO = path.join(ROOT, TASK);
const OUT_DIR = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.iteration12.generated.ts');
const PROV = path.join(ROOT, 'game/public/assets/derivatives/audio-iteration12.json');
const LOOP_MARGIN_S = 0.3;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const LAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@breezystack/lamejs/package.json'), 'utf8')).version;

/**
 * Per-clip recipes (one raw per cue; each raw is the cue's single authorized job).
 *  sequence  first onset -> end of the last audible event (whole multi-click / sputter sequence kept, natural gaps included)
 *  lead      `leadS` before the loudest onset (the whoosh) -> end of the event: keeps the scrape-hiss run-up, drops the long pre-roll
 *  loop      most level-stable region, slow level flattening (no fast dynamics touched), equal-power crossfade, periodic margins
 *  slices    the strongest separate onsets become variants (short crackles)
 */
const RECIPES = {
  'i12-battery-insert-01': {cue: 'batteryInsert', mode: 'sequence', tailDb: -45, holdMs: 60, maxS: 1.4, fadeIn: 0.002, fadeOut: 0.08, kbps: 96},
  'i12-flare-ignite-01': {cue: 'flareIgnite', mode: 'lead', leadS: 0.5, tailDb: -50, holdMs: 60, maxS: 1.6, fadeIn: 0.06, fadeOut: 0.12, kbps: 96},
  'i12-flare-burn-01': {cue: 'flareBurn', mode: 'loop', lenS: 3.5, xfS: 0.4, searchS: [0.3, 1.0], agcWinS: 0.4, agcMaxDb: 12, kbps: 112},
  'i12-flare-out-01': {cue: 'flareOut', mode: 'sequence', tailDb: -50, holdMs: 80, maxS: 2.6, fadeIn: 0.004, fadeOut: 0.25, kbps: 96},
  'i12-flashlight-flicker-01': {cue: 'flashlightFlicker', mode: 'slices', hpHz: 120, riseDb: 9, floorDb: -24, minGapS: 0.1, maxS: 0.3, minS: 0.018, tailDb: -30, holdMs: 25, padMs: 12, n: 4, fadeIn: 0.002, fadeOut: 0.02, kbps: 96},
};

const r4 = v => +v.toFixed(4);

/**
 * Last 5 ms hop (sample) at or after `from` whose envelope is above `tailDb` (rel. the clip peak) and at least 6 dB above the
 * take's noise floor (10th-percentile envelope), plus `holdMs`, capped at from + maxS.
 */
function activeEnd(x, sr, from, {tailDb, holdMs, maxS}) {
  const hop = Math.round(sr * 0.005), env = D.envelope(x, hop);
  let pk = 0;
  for (const e of env) pk = Math.max(pk, e);
  const floor = [...env].sort((p, q) => p - q)[Math.floor(env.length * 0.1)];
  const thr = Math.max(pk * D.dbToLin(tailDb), floor * D.dbToLin(6));
  let last = Math.floor(from / hop);
  for (let h = Math.floor(from / hop); h < env.length; h++) if (env[h] > thr) last = h;
  return Math.min(x.length, from + Math.round(maxS * sr), (last + 1) * hop + Math.round(holdMs / 1000 * sr));
}

/**
 * End of the event starting at `a`: the first point after its peak (within 60 ms) where the 5 ms envelope stays below
 * max(event peak + tailDb, noise floor + 6 dB) for holdMs; capped at `cap`.
 */
function eventEndFloor(x, sr, a, cap, {tailDb, holdMs, padMs = 0}) {
  const hop = Math.round(sr * 0.005), all = D.envelope(x, hop), floor = [...all].sort((p, q) => p - q)[Math.floor(all.length * 0.1)];
  const env = D.envelope(x.subarray(a, cap), hop);
  let ph = 0;
  for (let h = 0; h < Math.min(env.length, 12); h++) if (env[h] > env[ph]) ph = h;
  const thr = Math.max(env[ph] * D.dbToLin(tailDb), floor * D.dbToLin(6)), hold = Math.max(1, Math.round(holdMs / 5));
  let below = 0;
  for (let h = ph + 1; h < env.length; h++) {
    if (env[h] < thr) { if (++below >= hold) return Math.min(cap, a + (h - hold + 1) * hop + Math.round(padMs / 1000 * sr)); } else below = 0;
  }
  return cap;
}

/** 2nd-order Butterworth high-pass (RBJ biquad), in place. */
function highpass(x, sr, hz) {
  const w = 2 * Math.PI * hz / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + al, b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, b2 = (1 + cw) / 2 / a0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

/** Slow level flattening of x[a, b): gain = median level / (power-smoothed level over ±winS/2), clamped to ±maxDb. */
function flatten(x, sr, a, b, winS, maxDb) {
  const seg = x.slice(a, b), hop = Math.round(sr * 0.01), env = D.envelope(seg, hop), half = Math.max(1, Math.round(winS / 2 / 0.01));
  const sm = env.map((_, h) => { let s = 0, n = 0; for (let k = Math.max(0, h - half); k <= Math.min(env.length - 1, h + half); k++) { s += env[k] ** 2; n++; } return Math.sqrt(s / n); });
  const target = [...sm].sort((p, q) => p - q)[Math.floor(sm.length / 2)];
  const g = sm.map(v => Math.min(D.dbToLin(maxDb), Math.max(D.dbToLin(-maxDb), target / Math.max(v, 1e-9))));
  let gMin = Infinity, gMax = 0;
  for (let i = 0; i < seg.length; i++) {
    const p = i / hop - 0.5, h0 = Math.max(0, Math.min(g.length - 1, Math.floor(p))), h1 = Math.min(g.length - 1, h0 + 1), f = Math.max(0, Math.min(1, p - h0));
    const gi = g[h0] * (1 - f) + g[h1] * f;
    gMin = Math.min(gMin, gi); gMax = Math.max(gMax, gi);
    seg[i] *= gi;
  }
  return {seg, minGainDb: +D.linToDb(gMin).toFixed(2), maxGainDb: +D.linToDb(gMax).toFixed(2), targetDb: +D.linToDb(target).toFixed(1)};
}

/** Level (dB) of the 0.25 s blocks of x[a, b): std + the spread, for picking the most even loop source. */
function blockStats(x, sr, a, b) {
  const blk = Math.round(0.25 * sr), lv = [];
  for (let i = a; i + blk <= b; i += blk) lv.push(D.linToDb(D.rms([x], i, i + blk)));
  const mean = lv.reduce((p, q) => p + q, 0) / lv.length;
  return {std: Math.sqrt(lv.reduce((p, q) => p + (q - mean) ** 2, 0) / lv.length), spread: Math.max(...lv) - Math.min(...lv), mean};
}

function derive(id, r, x, sr) {
  const ops = [{op: 'downmix', to: 'mono', how: 'mean of channels'}];
  const res = [];
  const oneShot = (chs, a, b, label, extra = []) => {
    const outS = Math.min(r.fadeOut, (b - a) / sr * 0.4);
    D.fade(chs, sr, r.fadeIn, outS);
    const g = D.normalisePeak(chs, -1);
    res.push({chs, label, ops: [...ops, ...extra, {op: 'trim', startS: r4(a / sr), endS: r4(b / sr)}, {op: 'fade', inS: r.fadeIn, outS: r4(outS), curve: 'cosine'}, {op: 'normalise', peakDbfs: -1, gainDb: +g.toFixed(2)}]});
  };
  if (r.mode === 'sequence') {
    const on = D.onsets(x, sr, {riseDb: 6, floorDb: -30, minGapS: 0.05});
    const a = Math.max(0, (on.length ? on[0] : 0) - Math.round(0.004 * sr));
    const b = activeEnd(x, sr, a, r);
    oneShot(D.slice([x], a, b), a, b, '', [{op: 'select', mode: 'sequence', note: 'first onset to the end of the last event above ' + r.tailDb + ' dB re peak (+' + r.holdMs + ' ms); natural gaps kept'}]);
  } else if (r.mode === 'lead') {
    const on = D.onsets(x, sr, {riseDb: 9, floorDb: -24, minGapS: 0.1});
    const hop = Math.round(sr * 0.005), env = D.envelope(x, hop);
    let best = on[0] ?? 0, bestPk = -1;
    for (const o of on) { let pk = 0; for (let h = Math.floor(o / hop); h < Math.min(env.length, Math.floor(o / hop) + 40); h++) pk = Math.max(pk, env[h]); if (pk > bestPk) { bestPk = pk; best = o; } }
    const a = Math.max(0, best - Math.round(r.leadS * sr));
    const b = activeEnd(x, sr, best, r);
    oneShot(D.slice([x], a, b), a, b, '', [{op: 'select', mode: 'lead', mainOnsetS: r4(best / sr), leadS: r.leadS, note: 'keeps the last ' + r.leadS + ' s of the scrape-hiss run-up before the loudest onset (the ignition whoosh) and the whoosh to its tail'}]);
  } else if (r.mode === 'loop') {
    const L = Math.round(r.lenS * sr), X = Math.round(r.xfS * sr);
    let best = null;
    for (let s = r.searchS[0]; s <= r.searchS[1] + 1e-9; s += 0.05) {
      const a = Math.round(s * sr);
      if (a + L + X > x.length) break;
      const st = blockStats(x, sr, a, a + L + X), score = st.std + 0.25 * st.spread;
      if (!best || score < best.score) best = {s, a, score, ...st};
    }
    const fl = flatten(x, sr, best.a, best.a + L + X, r.agcWinS, r.agcMaxDb);
    const loop = D.makeLoop([fl.seg], sr, 0, L / sr, X / sr);
    const after = blockStats(loop[0], sr, 0, loop[0].length);
    const g = D.normaliseRms(loop, -20, -1);
    // seam check: 50 ms RMS either side of the wrap (out[L-1] -> out[0] is sample-continuous by construction)
    const w = Math.round(0.05 * sr), seamDb = +(D.linToDb(D.rms(loop, 0, w)) - D.linToDb(D.rms(loop, L - w, L))).toFixed(2);
    const withM = D.withLoopMargins(loop, sr, LOOP_MARGIN_S);
    res.push({chs: withM, label: 'loop', loop: {start: LOOP_MARGIN_S, length: +(L / sr).toFixed(6)}, loopInfo: {sourceStartS: r4(best.a / sr), sourceEndS: r4((best.a + L) / sr), crossfadeSourceEndS: r4((best.a + L + X) / sr), seamDb, levelStdDbBefore: +best.std.toFixed(2), levelStdDbAfter: +after.std.toFixed(2)},
      ops: [...ops,
        {op: 'loop-region', sourceStartS: r4(best.a / sr), lengthS: r4(L / sr), crossfadeS: r.xfS, searchedS: r.searchS, regionLevelStdDb: +best.std.toFixed(2), regionLevelSpreadDb: +best.spread.toFixed(2), note: 'most level-even 0.25 s-block region of the take'},
        {op: 'level-flatten', windowS: r.agcWinS, targetDb: fl.targetDb, minGainDb: fl.minGainDb, maxGainDb: fl.maxGainDb, note: 'slow power-smoothed gain ride over the loop source so the start and end of the region match; sputter/crackle dynamics (< 0.2 s) untouched'},
        {op: 'loop', lengthS: r4(L / sr), crossfadeS: r.xfS, curve: 'equal-power', seamDb, levelStdDbAfter: +after.std.toFixed(2), note: 'loop head blends in the material after the loop end (D.makeLoop)'},
        {op: 'normalise', rmsDbfs: -20, peakCeilingDbfs: -1, gainDb: +g.toFixed(2)},
        {op: 'loop-margins', marginS: LOOP_MARGIN_S, note: 'periodic copies before/after so MP3 priming/padding stays outside [start, start+length)'}]});
  } else if (r.mode === 'slices') {
    const hp = highpass(Float32Array.from(x), sr, r.hpHz);
    const pre = [{op: 'highpass', hz: r.hpHz, order: 2, design: 'Butterworth (RBJ biquad)', note: 'removes sub-bass thumps / DC steps under the crackles'}];
    const on = D.onsets(hp, sr, {riseDb: r.riseDb, floorDb: r.floorDb, minGapS: r.minGapS});
    const segs = [];
    for (let i = 0; i < on.length; i++) {
      const a = Math.max(0, on[i] - Math.round(0.004 * sr));
      const next = i + 1 < on.length ? on[i + 1] - Math.round(0.006 * sr) : hp.length;
      const cap = Math.min(next, a + Math.round(r.maxS * sr));
      const b = eventEndFloor(hp, sr, a, cap, r);
      if (b - a < sr * r.minS) continue;
      segs.push({a, b, pk: D.peak([hp.subarray(a, b)])});
    }
    segs.sort((p, q) => q.pk - p.pk);
    segs.slice(0, r.n).sort((p, q) => p.a - q.a).forEach((s, i) => oneShot(D.slice([hp], s.a, s.b), s.a, s.b, `s${String(i + 1).padStart(2, '0')}`, [...pre, {op: 'select', mode: 'slice', onsetIndex: i, of: segs.length}]));
  }
  return res;
}

function encode(ch, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(ch), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const o = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (o.length) parts.push(Buffer.from(o)); }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')).clips;
const manifest = {}, gaps = [], derivs = [];
let bytes = 0;
for (const [id, r] of Object.entries(RECIPES)) {
  const clip = queue.find(c => c.id === id);
  if (!clip || clip.cue !== r.cue) throw new Error(`${id}: not in the queue as ${r.cue}`);
  const termPath = path.join(AUDIO, 'ledger', id, 'terminal.json');
  const term = fs.existsSync(termPath) ? JSON.parse(fs.readFileSync(termPath, 'utf8')) : null;
  if (term?.state !== 'done') { gaps.push(r.cue); console.log(`${id}: no done job (${term?.state ?? 'none'}) -> silent gap`); continue; }
  const wavBytes = fs.readFileSync(path.join(AUDIO, 'raw', `${id}.wav`));
  const side = JSON.parse(fs.readFileSync(path.join(AUDIO, 'raw', `${id}.sidecar.json`), 'utf8'));
  const rawSha = sha256(wavBytes);
  if (rawSha !== side.rawSha256 || rawSha !== term.rawSha256) throw new Error(`${id}: raw bytes changed (sha mismatch) — refusing`);
  const w = readWav(wavBytes), sr = w.sampleRate;
  const metrics = D.analyse(w.channels, sr);
  const parts = derive(id, r, D.downmix(w.channels), sr);
  if (!parts.length) { gaps.push(r.cue); console.log(`${id}: no usable region -> silent gap`); continue; }
  for (const p of parts) {
    const name = p.label ? `${id}-${p.label}` : id;
    const mp3 = encode(p.chs[0], sr, r.kbps);
    fs.writeFileSync(path.join(OUT_DIR, `${name}.mp3`), mp3);
    bytes += mp3.length;
    const durS = r4(p.chs[0].length / sr);
    (manifest[r.cue] ??= []).push({url: `assets/audio/${name}.mp3`, dur: durS, ...(p.loop ? {loop: p.loop} : {}), src: id});
    derivs.push({file: `game/public/assets/audio/${name}.mp3`, url: `assets/audio/${name}.mp3`, bytes: mp3.length, sha256: sha256(mp3), cue: r.cue, durationS: durS, channels: 1, sampleRate: sr, codec: 'mp3', kbps: r.kbps,
      ...(p.loop ? {loop: p.loop, loopInfo: p.loopInfo} : {}),
      source: {clip: id, rawFile: `${TASK}/raw/${id}.wav`, rawSha256: rawSha, rawBytes: wavBytes.length, labFile: side.labFile ?? term.labFile, jobId: term.jobId,
        prompt: clip.prompt, negativePrompt: clip.negative_prompt, seed: clip.seed, steps: clip.steps, cfg: clip.cfg, seconds: clip.seconds, profile: side.model?.profile ?? null, modelRevision: side.model?.revision ?? null},
      rawMetrics: metrics,
      ops: [...p.ops, {op: 'encode', codec: 'mp3', encoder: `@breezystack/lamejs ${LAME} (LGPL-3.0, build-time only)`, kbps: r.kbps}]});
    console.log(`${name}: ${r.cue} ${durS}s ${mp3.length} B sha ${sha256(mp3).slice(0, 12)}${p.loop ? ` loop ${JSON.stringify(p.loop)} ${JSON.stringify(p.loopInfo)}` : ''} ops ${JSON.stringify(p.ops.filter(o => o.op === 'trim' || o.op === 'select').map(o => o.op === 'trim' ? `${o.startS}-${o.endS}` : o.mode))}`);
  }
}
const order = Object.values(RECIPES).map(r => r.cue);
fs.writeFileSync(MANIFEST_TS, `// GENERATED by tools/audio-pipeline/build-iteration12.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/assets/derivatives/audio-iteration12.json. Cues absent here are SILENT gaps (no fallback).

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_I12: Readonly<Record<string, readonly ClipRef[]>> = {
${order.filter(c => manifest[c]).map(c => ` ${c}: [\n${manifest[c].map(m => `  ${JSON.stringify(m)},`).join('\n')}\n ],`).join('\n')}
};

/** Cues this build should have produced but could not${gaps.length ? '' : ' (none)'}. */
export const CLIP_GAPS_I12: readonly string[] = ${JSON.stringify(gaps)};
/** Total bytes of this build's derivatives. */
export const CLIP_BYTES_I12 = ${bytes};
`);
const prov = {task: 'studio-atmosphere-light-survival-20261028-01', generatedBy: 'tools/audio-pipeline/build-iteration12.mjs',
  policy: 'Sound Lab only: derivatives of FIVE freshly authorized Sound Lab jobs (one per cue, no retries/rerolls; 6th authorization unused) for the iteration-12 flashlight battery and thrown flare. No synthesis, stock or hosted audio; DSP editing only.',
  license: {status: 'Conditional prototype: Stability AI Community License + Gemma terms; not production/commercial clearance. Unreviewed by ear on the worker.', gameReady: false},
  rawArchive: `${TASK}/ (raw WAVs + lab sidecars in raw/, intents/ACKs/terminals in ledger/, runner.log, queue.json)`,
  gaps, derivatives: derivs};
fs.writeFileSync(PROV, JSON.stringify(prov, null, 1) + '\n');
console.log(`total ${derivs.length} derivatives, ${bytes} B; gaps: ${gaps.length ? gaps.join(', ') : 'none'}`);
