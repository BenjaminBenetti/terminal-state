#!/usr/bin/env node
// Task studio-market-bar-20261108-225231-01 (lane AUDIO): runtime derivatives of the MARKET set — user: "Subtle cash-register sound on
// buy/sell." "Background chatter; screams from fleeing survivors and angry grunts from attackers." (+ the brief's retch for the player's
// throw-up). Planned by tools/audio-pipeline/market-audio-plan.py and generated through tools/audio-pipeline/soundlab_runner.py (one
// fsynced intent per POST; whole-second durations; SOUND_LAB_MAX_POSTS 12; /tmp/ll-soundlab.lock): ONE take per cue (6 jobs), the
// variants TRIMMED out of a take (the scream take holds five separate screams, the grunt take three of its four grunts, the register take the clack /
// ding and the drawer). This builder makes NO Sound Lab call: it edits the generated clips only (trim / fades / loop crossfade /
// level) and never creates sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/market-bar-20261108-225231/audio) {queue.json, raw/<id>.wav,
//   raw/<id>.sidecar.json}; each raw is verified against its runner sidecar SHA-256 (and the lab's recorded request).
// Outputs: game/public/assets/audio/market-*.mp3, game/src/audio/manifest.marketBar.generated.ts (merged into bank.ts CLIP_MANIFEST),
//   game/public/assets/derivatives/audio-market-bar.json (provenance + structural metrics + the mix calibration; NO prompt text and NO
//   private paths / file names — the prompts stay with the private raw takes, the public record carries their SHA-256), the NOTICE /
//   CREDITS block, tools/release/public-inputs.json (only these paths).
//   With --qc: one structural QC image per derivative (+ an overview) into $SOUND_LAB_AUDIO_DIR/qc (private; never in Git).
//
// Levels: one-shot VOICES (screams, grunts, the retch) are loudness-levelled (ITU-R BS.1770 integrated, mono) to a per-cue target under
// a -1 dBFS sample-peak ceiling, so the variants of a cue sit at one level; the register is peak -1 dBFS (a transient); the murmur loops
// RMS -20 dBFS (the bed convention) under -1 dBFS. CUE_GAIN (audio/sfx.ts) then places each cue in the mix: `MIX` = its target
// momentary-max loudness at the source (before distance / occlusion / master), set against the existing cues' calibration
// (derivatives/audio-track1.json mixCalibration.reference: zombie groan -18.5, zombie attack -20.3, player hurt -24.0, cough -25.9).
// Structural QC only (the worker cannot listen): every gate below describes signal structure, not how it sounds.
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/market-audio-build.mjs [--dry-run] [--qc]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {structure, loudness, publicMetrics} from './lib/structural.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-market-bar-20261108-225231-01';
const RAW_REL = 'reference/tasks/market-bar-20261108-225231/audio';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.marketBar.generated.ts');
const PROV_REL = 'assets/derivatives/audio-market-bar.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run'), QC = process.argv.includes('--qc');
const LOOP_MARGIN_S = 0.1, PEAK_CEIL_DB = -1, KBPS = 64;
const BYTE_CAP = 260 * 1024;
const JOB_CAP = 12;
const sha = b => createHash('sha256').update(b).digest('hex');

/** The runtime cues of this build (game/src/audio/bank.ts CUES). */
export const CUES_MARKET_BAR = ['marketCash', 'marketChatter', 'marketBarChatter', 'marketScream', 'marketGrunt', 'marketRetch'];

/**
 * Target momentary-max loudness of each cue AT THE SOURCE (derivative x CUE_GAIN), LUFS — the mix (first estimates for the user's ear
 * pass). Screams: just under a zombie groan (-18.5), over a zombie attack (-20.3): a panicked human voice is clearly heard yet never
 * the loudest thing in a gunfight (a gunshot peaks at -1 dBFS at CUE 1; the screamers run AWAY, distance takes more). Grunts: ~ a zombie
 * attack, over the player's own hurt (-24.0). Retch: the player's own vocal, just over the hurt grunt. Register: SUBTLE (user) — under
 * the cough (-25.9). Murmur loops (integrated, at the panner's reference distance, crowd level 1): a low bed ~6 LU over the HVAC bed.
 */
export const MIX = {marketScream: -19.5, marketGrunt: -21, marketRetch: -23, marketCash: -28, marketChatter: -31, marketBarChatter: -31};

/**
 * Per derivative: the window in its take (s; chosen from the takes' 10 ms envelopes — every voice take holds separate events with
 * silence between, the floor ~-61 dBFS), fades, the level rule. Loops: a stationary window (lib/dsp stationaryRegion) of `len` + an
 * equal-power crossfade `xf`. `gate`: the structural check of the derivative (kind below).
 */
const PLAN = [
  // the register: two clacks (0.2 / 0.27 s), the ding's transient at 0.35 s with its ring (7.6 kHz / 2.8 kHz partials) decaying to ~1 s;
  // the drawer's clunk at 1.40 s. Variant 1 = the clack + ding; variant 2 = clack + ding + the drawer.
  {cue: 'marketCash', name: 'market-cash-01', clip: 'market-cash-01', a: 0.18, b: 1.0, fadeIn: 0.003, fadeOut: 0.3, level: 'peak', gate: 'register'},
  // (the gap between the ding's ring-out and the drawer, 0.98-1.36 s, holds only the take's faint steady model hum: dipped 18 dB)
  {cue: 'marketCash', name: 'market-cash-02', clip: 'market-cash-01', a: 0.18, b: 1.56, fadeIn: 0.003, fadeOut: 0.06, dip: {a: 0.98, b: 1.36, db: -18, ramp: 0.04}, level: 'peak', gate: 'register'},
  // murmur loops (the market hall: steady, ±0.7 dB over 0.5 s blocks; the bar: livelier, ±2 dB)
  {cue: 'marketChatter', name: 'market-chatter-loop', clip: 'market-chatter-01', kind: 'loop', len: 9, xf: 1, minStart: 0.3, endGuard: 0.4, gate: 'murmur'},
  {cue: 'marketBarChatter', name: 'market-bar-chatter-loop', clip: 'market-chatter-bar-01', kind: 'loop', len: 9, xf: 1, minStart: 0.3, endGuard: 0.4, gate: 'murmur'},
  // five separate screams (events 0.36-1.56, 1.96-3.35, 4.18-5.03, 5.66-6.20, 6.63-7.36 s above -50 dBFS)
  ...[[0.34, 1.6], [1.94, 3.39], [4.16, 5.07], [5.64, 6.24], [6.61, 7.4]].map(([a, b], i) => ({cue: 'marketScream', name: `market-scream-0${i + 1}`, clip: 'market-scream-01', a, b, fadeIn: 0.006, fadeOut: 0.08, level: {lufs: -16}, gate: 'scream'})),
  // three separate chest grunts (events 1.61-2.05, 2.27-2.78, 3.06-3.50 s; f0 ~110-140 Hz, falling). The take's 4th event (3.70-4.20 s:
  // a held, breathier ~685 Hz tone, voiced 0.36) fails the grunt gate's voice criterion and is NOT shipped.
  ...[[1.59, 2.09], [2.25, 2.82], [3.04, 3.54]].map(([a, b], i) => ({cue: 'marketGrunt', name: `market-grunt-0${i + 1}`, clip: 'market-grunt-01', a, b, fadeIn: 0.006, fadeOut: 0.05, level: {lufs: -18}, gate: 'grunt'})),
  // the retch: a gag (0.36-0.60 s), the heave (0.77-1.60 s, voiced, rising), the sputter / splash (1.65-1.93 s)
  {cue: 'marketRetch', name: 'market-retch-01', clip: 'market-retch-01', a: 0.33, b: 1.98, fadeIn: 0.006, fadeOut: 0.06, level: {lufs: -18}, gate: 'retch'},
];

function encodeMp3(x, sr, kbps) {
  const enc = new Mp3Encoder(1, sr, kbps), ints = toInt16(x), parts = [];
  for (let i = 0; i < ints.length; i += 1152) { const b = enc.encodeBuffer(ints.subarray(i, i + 1152)); if (b.length) parts.push(Buffer.from(b)); }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

const queue = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')).clips;
if (queue.length > JOB_CAP) throw new Error(`queue holds ${queue.length} clips: over the ${JOB_CAP}-job allowance`);
const takes = new Map();
function take(clip) {
  if (takes.has(clip)) return takes.get(clip);
  const c = queue.find(q => q.id === clip);
  if (!c) throw new Error(`${clip}: not in the queue`);
  const side = JSON.parse(fs.readFileSync(path.join(RAW, `${clip}.sidecar.json`), 'utf8'));
  const rawBuf = fs.readFileSync(path.join(RAW, `${clip}.wav`));
  if (sha(rawBuf) !== side.rawSha256) throw new Error(`${clip}: raw sha mismatch`);
  if (side.request?.prompt !== c.prompt || side.request?.seed !== c.seed) throw new Error(`${clip}: the lab's recorded request differs from the plan`);
  const w = readWav(rawBuf);
  if (w.sampleRate !== 44100) throw new Error(`${clip}: sample rate ${w.sampleRate} (the bank contract is 44.1 kHz)`);
  const jobId = side.job?.id ?? side.jobId ?? null;
  if (!/^\d{8}T\d{6}-\d+$/.test(String(jobId))) throw new Error(`${clip}: no Sound Lab job id in the runner sidecar`);
  // public source record: hashes / ids / request numbers only — no prompt text, no private path or lab file name
  const source = {clip, jobId, seed: side.request.seed, seconds: side.request.seconds, steps: side.request.steps, cfg: side.request.cfg,
    rawSha256: side.rawSha256, rawBytes: side.rawBytes, labSidecarSha256: side.labSidecarSha256, promptSha256: sha(Buffer.from(side.request.prompt, 'utf8'))};
  const t = {mono: [D.downmix(w.channels)], sr: w.sampleRate, source, cue: c.cue};
  takes.set(clip, t);
  return t;
}

const r2 = v => +v.toFixed(2);
/** Structural gate of a derivative (NOT a listening test). */
function gate(kind, m, x, sr) {
  const c = [];
  const req = (name, ok, value, need) => c.push({name, ok: !!ok, value, need});
  const noiseWall = m.levelSpreadDb < 2 && m.spectral.flatness >= 0.35 && m.pitch.voicedFrac < 0.1;
  req('not a broadband noise wall', !noiseWall, {levelSpreadDb: m.levelSpreadDb, flatness: m.spectral.flatness, voicedFrac: m.pitch.voicedFrac}, 'NOT (spread < 2 dB AND flatness >= 0.35 AND voiced < 0.1)');
  req('no clipping', m.clippedFrac < 1e-4, m.clippedFrac, '< 0.0001');
  const b = m.spectral.bands, above1k = (b['1000-3000Hz'] ?? 0) + (b['3000-8000Hz'] ?? 0) + (b['8000-22050Hz'] ?? 0);
  const below1k = (b['0-300Hz'] ?? 0) + (b['300-1000Hz'] ?? 0);
  if (kind === 'register') {
    // clacks / a bell strike / a drawer clunk: impulsive (high crest factor), the loudest moment early, mostly quiet, bright, decaying
    req('impulsive (transients)', m.crestDb >= 14, m.crestDb, 'crest factor >= 14 dB');
    req('loudest moment early', m.attack.peakS <= 0.4 * m.durationS, {peakS: m.attack.peakS, durationS: m.durationS}, 'peak in the first 40 %');
    req('bright (bell / metal)', m.spectral.centroidHz >= 2000, m.spectral.centroidHz, 'centroid >= 2 kHz');
    req('decays', m.decay.slopeDbPerS < 0, m.decay.slopeDbPerS, 'slope < 0');
  } else if (kind === 'murmur') {
    req('sustained', m.activeFrac >= 0.95, m.activeFrac, 'active >= 0.95');
    req('steady level', m.levelSpreadDb <= 4, m.levelSpreadDb, '50 ms level spread <= 4 dB');
    req('voice band', m.spectral.centroidHz >= 250 && m.spectral.centroidHz <= 1500 && below1k + (b['1000-3000Hz'] ?? 0) >= 0.9, {centroidHz: m.spectral.centroidHz, shareUnder3k: r2(below1k + (b['1000-3000Hz'] ?? 0))}, 'centroid 250-1500 Hz, >= 90 % under 3 kHz');
    req('not tonal (no single drone)', m.pitch.voicedFrac <= 0.6, m.pitch.voicedFrac, 'voiced <= 0.6');
  } else if (kind === 'scream') {
    req('one event', m.quietFrac <= 0.25, m.quietFrac, 'quiet <= 0.25');
    req('rises fast', m.attack.riseMs <= 450, m.attack.riseMs, '<= 450 ms');
    req('bright', m.spectral.centroidHz >= 1000 && above1k >= 0.5, {centroidHz: m.spectral.centroidHz, shareAbove1k: r2(above1k)}, 'centroid >= 1 kHz, >= 50 % above 1 kHz');
    req('a voice (pitched)', m.pitch.voicedFrac >= 0.4 && m.pitch.f0MedianHz >= 250, {voicedFrac: m.pitch.voicedFrac, f0MedianHz: m.pitch.f0MedianHz}, 'voiced >= 0.4, f0 >= 250 Hz');
  } else if (kind === 'grunt') {
    req('one event', m.quietFrac <= 0.25, m.quietFrac, 'quiet <= 0.25');
    req('short', m.durationS >= 0.3 && m.durationS <= 0.8, m.durationS, '0.3-0.8 s');
    req('a voice (pitched)', m.pitch.voicedFrac >= 0.4, {voicedFrac: m.pitch.voicedFrac, f0MedianHz: m.pitch.f0MedianHz}, 'voiced >= 0.4');
    req('low (chest voice)', m.spectral.centroidHz <= 1200 && below1k >= 0.6, {centroidHz: m.spectral.centroidHz, shareUnder1k: r2(below1k)}, 'centroid <= 1.2 kHz, >= 60 % under 1 kHz');
  } else if (kind === 'retch') {
    req('a voice in it', m.pitch.voicedFrac >= 0.2, m.pitch.voicedFrac, 'voiced >= 0.2');
    req('one action', m.durationS >= 0.8 && m.durationS <= 2.5, m.durationS, '0.8-2.5 s');
    req('ends', m.decay.activeEndS <= m.durationS - 0.02, {activeEndS: m.decay.activeEndS, durationS: m.durationS}, 'active end before the clip end');
  } else throw new Error(`unknown gate ${kind}`);
  return {kind, pass: c.every(q => q.ok), failed: c.filter(q => !q.ok).map(q => q.name), criteria: c};
}

/** Loop-seam continuity of a loop derivative (wrap jump vs the mean step; level of its last / first 50 ms). */
function seam(x, sr, loopN) {
  const M = Math.round(LOOP_MARGIN_S * sr), w = Math.round(0.05 * sr), body = x.subarray(M, M + loopN);
  const r = (a, b) => D.rms([body.subarray(a, b)]);
  let step = 0;
  for (let i = 1; i < loopN; i++) step += Math.abs(body[i] - body[i - 1]);
  return {wrapJump: +Math.abs(body[loopN - 1] - body[0]).toFixed(4), meanStep: +(step / (loopN - 1)).toFixed(4), edgeLevelDb: +(D.linToDb(r(0, w)) - D.linToDb(r(loopN - w, loopN))).toFixed(2)};
}

const manifest = {}, files = [], prov = [], qcInputs = [], gateFailures = [];
for (const p of PLAN) {
  const t = take(p.clip), sr = t.sr;
  if (t.cue !== p.cue) throw new Error(`${p.name}: take ${p.clip} was planned for ${t.cue}, not ${p.cue}`);
  let chs, loop = null, ops;
  if (p.kind === 'loop') {
    const reg = D.stationaryRegion(t.mono[0], sr, p.len + p.xf, {minStartS: p.minStart, endGuardS: p.endGuard});
    const lp = D.makeLoop(t.mono, sr, reg.startS, p.len, p.xf);
    chs = D.withLoopMargins(lp, sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, PEAK_CEIL_DB);
    loop = {start: LOOP_MARGIN_S, length: +(lp[0].length / sr).toFixed(6)};
    ops = ['mono', `stationary window from ${reg.startS} s (std ${reg.stdDb} dB over 0.5 s blocks)`, `loop ${p.len} s, equal-power crossfade ${p.xf} s`,
      `margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS (${g.toFixed(1)} dB)`];
  } else {
    chs = D.slice(t.mono, Math.round(p.a * sr), Math.min(t.mono[0].length, Math.round(p.b * sr)));
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    ops = ['mono', `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`];
    if (p.dip) { // a cosine-ramped attenuation of a window (take time): an edit of the take, never added sound
      const g = D.dbToLin(p.dip.db), r = p.dip.ramp, x = chs[0];
      for (let i = 0; i < x.length; i++) {
        const tt = p.a + i / sr;
        if (tt <= p.dip.a - r || tt >= p.dip.b + r) continue;
        const k = tt < p.dip.a ? (p.dip.a - tt) / r : tt > p.dip.b ? (tt - p.dip.b) / r : 0; // 1 outside .. 0 inside
        const w = 0.5 - 0.5 * Math.cos(Math.PI * k);
        x[i] *= g + (1 - g) * w;
      }
      ops.push(`dip ${p.dip.db} dB over ${p.dip.a}-${p.dip.b} s (take time; ${r} s cosine ramps)`);
    }
    if (p.level === 'peak') {
      const g = D.normalisePeak(chs, PEAK_CEIL_DB);
      ops.push(`peak ${PEAK_CEIL_DB} dBFS (${g.toFixed(1)} dB)`);
    } else {
      const pre = loudness(chs[0], sr).integratedLufs, pk = D.peak(chs);
      const gL = p.level.lufs - pre, gP = PEAK_CEIL_DB - D.linToDb(pk), gDb = Math.min(gL, gP);
      D.gain(chs, D.dbToLin(gDb));
      ops.push(`loudness ${p.level.lufs} LUFS integrated under a ${PEAK_CEIL_DB} dBFS peak ceiling (${gDb.toFixed(1)} dB, ${gL <= gP ? 'loudness target' : 'peak ceiling'})`);
    }
  }
  const mp3 = encodeMp3(chs[0], sr, KBPS);
  ops.push(`mp3 mono ${KBPS} kbps`);
  const url = `assets/audio/${p.name}.mp3`;
  const dur = +(chs[0].length / sr).toFixed(4);
  // structural metrics of the shipped samples (a loop: its body, without the margins)
  const body = loop ? chs[0].subarray(Math.round(LOOP_MARGIN_S * sr), Math.round(LOOP_MARGIN_S * sr) + Math.round(loop.length * sr)) : chs[0];
  const m = structure(body, sr), lu = loudness(body, sr), gt = gate(p.gate, m, body, sr);
  if (!gt.pass) gateFailures.push(`${p.name}: structural gate '${p.gate}' failed: ${JSON.stringify(gt.criteria.filter(q => !q.ok))}`);
  const metrics = {...publicMetrics(m), loudness: lu, ...(loop ? {loopSeam: seam(chs[0], sr, Math.round(loop.length * sr))} : {})};
  delete metrics.pitch?.segments;
  (manifest[p.cue] ??= []).push({url, dur, ...(loop ? {loop} : {}), src: p.clip});
  files.push({url, buf: mp3});
  prov.push({cue: p.cue, url, bytes: mp3.length, sha256: sha(mp3), dur, ...(loop ? {loop} : {}), ...(p.kind === 'loop' ? {} : {window: {startS: p.a, endS: p.b}}), ops, gate: gt, metrics, source: t.source});
  qcInputs.push({name: p.name, m, lu, gt});
}
for (const cue of CUES_MARKET_BAR) if (!manifest[cue]) throw new Error(`cue ${cue} has no clip`);

// The mix: CUE_GAIN per cue from its derivatives' mean momentary-max (one-shots) / integrated (loops) loudness and the MIX target.
const mixCalibration = {};
for (const cue of CUES_MARKET_BAR) {
  const ds = prov.filter(d => d.cue === cue), isLoop = !!ds[0].loop;
  const meas = ds.reduce((s, d) => s + (isLoop ? d.metrics.loudness.integratedLufs : d.metrics.loudness.momentaryMaxLufs), 0) / ds.length;
  const cueGain = Math.min(1, +Math.pow(10, (MIX[cue] - meas) / 20).toFixed(2));
  const pk = Math.max(...ds.map(d => d.metrics.peakDbfs));
  mixCalibration[cue] = {measure: isLoop ? 'integrated LUFS' : 'momentary-max LUFS (mean of variants)', measuredLufs: +meas.toFixed(1), targetLufs: MIX[cue], cueGain,
    mixLufs: +(meas + 20 * Math.log10(cueGain)).toFixed(1), mixPeakDbfs: +(pk + 20 * Math.log10(cueGain)).toFixed(1), variants: ds.length};
}

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(17), p.url.padEnd(40), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(7), 's', p.loop ? `loop ${p.loop.start}+${p.loop.length}` : 'one-shot',
  `| peak ${p.metrics.peakDbfs} rms ${p.metrics.rmsDbfs} I ${p.metrics.loudness.integratedLufs} Mmax ${p.metrics.loudness.momentaryMaxLufs} quiet ${p.metrics.quietFrac} cen ${p.metrics.spectral.centroidHz} voiced ${p.metrics.pitch.voicedFrac} f0 ${p.metrics.pitch.f0MedianHz} rise ${p.metrics.attack.riseMs}${p.metrics.loopSeam ? ' seam ' + JSON.stringify(p.metrics.loopSeam) : ''} | ${p.gate.pass ? 'PASS' : 'FAIL'}`);
console.log('mix:', JSON.stringify(mixCalibration));
console.log(`total ${total} bytes (cap ${BYTE_CAP})`);
for (const f of gateFailures) console.log('GATE FAIL', f);
if (total > BYTE_CAP) throw new Error(`runtime audio ${total} B exceeds the ${BYTE_CAP} B cap`);

if (QC) {
  const {renderQc, stackPngs} = await import('./lib/qc-render.mjs');
  const dir = path.join(AUDIO, 'qc');
  fs.mkdirSync(dir, {recursive: true});
  const pngs = [];
  for (const q of qcInputs) {
    const f = path.join(dir, `${q.name}.derivative.png`);
    await renderQc(f, {title: q.name, label: 'shipped derivative', m: q.m, verdict: {kind: q.gt.kind, pass: q.gt.pass, failed: q.gt.failed}, lu: q.lu});
    pngs.push(f);
  }
  await stackPngs(pngs, path.join(dir, 'derivatives-overview.png'));
  fs.writeFileSync(path.join(dir, 'derivatives-metrics.json'), JSON.stringify({mixCalibration, derivatives: prov}, null, 1) + '\n');
  console.log('qc:', pngs.length, 'images in', dir);
}
if (gateFailures.length) throw new Error(`${gateFailures.length} derivative(s) failed their structural gate (nothing written)`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/market-audio-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (lane AUDIO): the MARKET set — the subtle cash register on a
// successful buy / sell, the crowd murmur loops (the market hall, the bar), the fleeing survivors' panic screams, the fighters' angry
// grunts, the player's retch (audio/sfx.ts marketCash / crowdChatter / marketVoice / marketRetch; market/audio/marketAudio.ts).

import type {ClipRef} from './manifest.generated';

export const CLIP_MANIFEST_MARKET_BAR: Readonly<Record<string, readonly ClipRef[]>> = {
${Object.entries(manifest).map(([cue, refs]) => ` ${cue}: [\n${refs.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_MARKET_BAR: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_MARKET_BAR = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-market-bar-20261108', task: TASK, lane: 'AUDIO',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's local Sound Lab allowance: ${queue.length} jobs of a ${JOB_CAP}-job cap, every first take accepted; the rest of the allowance closed unused)`,
  plannedBy: 'tools/audio-pipeline/market-audio-plan.py', rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/market-audio-build.mjs',
  privacy: 'This public record names each raw take by its Sound Lab job id, seed and SHA-256 (raw WAV, lab sidecar, prompt). The prompt text, the raw takes and their paths stay in the private raw archive (independent backup), not in Git.',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (5 ms / 50 ms envelopes, quiet fraction, onsets, spectrogram images, spectral centroid / bands, YIN voicing, clipping, BS.1770 loudness, loop-seam continuity). `metrics` / `gate` describe signal structure only. The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  loudness: {method: 'ITU-R BS.1770-4 K-weighting, 400 ms blocks / 75 % overlap, -70 LUFS absolute + -10 LU relative gate (mono); sample peak (no true-peak oversampling)'},
  mixCalibration: {note: 'CUE_GAIN (audio/sfx.ts) per cue = 10^((target - measured) / 20): the target is the cue\'s loudness AT THE SOURCE (derivative x CUE_GAIN, before distance / occlusion / master), set against the existing cues (derivatives/audio-track1.json mixCalibration.reference: zombie groan -18.5, zombie attack -20.3, player hurt -24.0, cough -25.9 momentary-max LUFS). First estimates for the ear pass.',
    cues: mixCalibration},
  kbps: KBPS, derivatives: prov};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=|reference\/|\.wav|TrackType).{0,20}/i); if (hit) throw new Error(`URL / private path / prompt-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: this set's sentence (rewritten in place between its fixed head and tail; first added after the head-hit set's)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
{
  const head = 'the market set (', tail = '): ../derivatives/audio-market-bar.json';
  const sentence = `${head}cash register market-cash-01.mp3 / market-cash-02.mp3, crowd murmur loops\nmarket-chatter-loop.mp3 / market-bar-chatter-loop.mp3, panic screams market-scream-01..05.mp3, angry grunts market-grunt-01..03.mp3,\nretch market-retch-01.mp3; seeds and hashes only, the prompts stay with the private raw takes${tail}`;
  const i0 = notice.indexOf(head), i1 = notice.indexOf(tail);
  if (i0 >= 0 && i1 > i0) notice = notice.slice(0, i0) + sentence + notice.slice(i1 + tail.length);
  else {
    const anchor = '../derivatives/audio-head-hit.json).';
    if (!notice.includes(anchor)) throw new Error('NOTICE.md: expected sentence anchor not found');
    notice = notice.replace(anchor, `../derivatives/audio-head-hit.json; ${sentence}).`);
  }
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN market-bar-audio-20261108 (market-audio-build.mjs) -->', E = '<!-- END market-bar-audio-20261108 -->';
const block = `${B}
## Market audio (cash register, crowd murmur, panic screams, angry grunts, retch)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the market bar
task's local Sound Lab allowance (${queue.length} jobs of a ${JOB_CAP}-job cap). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades, loop,
levelling, MP3) built by \`tools/audio-pipeline/market-audio-build.mjs\` (provenance: \`assets/derivatives/audio-market-bar.json\`). Not
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
