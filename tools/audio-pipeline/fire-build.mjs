#!/usr/bin/env node
// Task studio-flamethrower-fire-20261114-031614-01 (lane AUDIO): runtime derivatives of the FLAMETHROWER + FIRE set — the fuel jet
// lighting (flameIgnite), the running jet's roar LOOP (flameRoar), the jet cutting off (flameOut), an open fire's bed LOOP for burning
// patches and burning props (fireBurn), something catching fire (fireCatch), a burnt prop caving in (fireCollapse) and the crunch +
// ember crackle that settles after it (fireEmbers). Planned by tools/audio-pipeline/fire-plan.py (ids, cues, whole-second durations,
// seeds; the prompt text stays with the private raw archive) and generated through tools/audio-pipeline/soundlab_runner.py (one fsynced
// intent per POST; bounded batches, each under its own durable SOUND_LAB_MAX_POSTS; /tmp/ll-soundlab.lock). This builder makes NO Sound
// Lab call: it edits the generated clips only (trim / fades / loop crossfade / level) and never creates sound.
//
// Inputs (read-only): $SOUND_LAB_AUDIO_DIR (default reference/tasks/flamethrower-fire-20261114-031614/audio) {queue.json, raw/<id>.wav,
//   raw/<id>.sidecar.json}, each raw verified against its runner sidecar SHA-256 (and the lab's recorded request against the queue);
//   game/public/assets/derivatives/audio-track1.json + audio-chipper.json (the existing cues' mix calibration: the loudness references).
// Outputs: game/public/assets/audio/fire-*.mp3, game/src/audio/manifest.fire.generated.ts (cue list + clips + mix gains, merged by
//   bank.ts; sfx.ts CUE_GAIN spreads the same gains), game/public/assets/derivatives/audio-fire.json (provenance: job ids, seeds,
//   hashes, structural metrics, the mix calibration — NO prompt text, NO private paths), the NOTICE sentence / CREDITS block,
//   tools/release/public-inputs.json (only these paths). With --qc: one structural QC image per derivative into
//   $SOUND_LAB_AUDIO_DIR/qc/built (private; never in Git).
//
// Ops: mono downmix (mean) -> window DC removal -> one-shots: trim [a, b] + cosine fades + peak -1 dBFS, the takes of a cue lowered to
//   the quietest take's momentary-max loudness (variants sit at one level); loops: the most stationary window (lib/dsp
//   stationaryRegion) -> equal-power crossfaded loop (makeLoop) with periodic decoder margins (withLoopMargins) + RMS -20 dBFS under a
//   -1 dBFS peak ceiling (the bed / machine-loop convention) -> MP3 (lamejs, mono; one-shots 96 kbps, the roar loop 64, the fire bed 80).
// Mix: CUE_GAIN per cue = 10^((target - measured) / 20), capped at 1 (no boost): `MIX` = the cue's loudness AT THE SOURCE (derivative x
//   CUE_GAIN, before distance / occlusion / master) — one-shots by their maximum momentary loudness, loops integrated — set against the
//   existing cues' calibration.
// Structural QC only (the worker cannot listen): every gate below describes signal structure, not how it sounds. A flame roar is
//   legitimately steady broadband noise, so the two loops are NOT gated by the generic "noise wall" rule of lib/structural cueVerdict:
//   they are judged by envelope steadiness (0.5 s blocks), turbulence (50 ms level spread), crackle transients and band shares (and the
//   viewed spectrogram images of the private QC); the values that rule reads are recorded with each loop.
//
// Usage: SOUND_LAB_AUDIO_DIR=<dir> node tools/audio-pipeline/fire-build.mjs [--dry-run] [--qc]

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mp3Encoder} from '@breezystack/lamejs';
import {readWav, toInt16} from './lib/wav.mjs';
import * as D from './lib/dsp.mjs';
import {structure, loudness, envelopeDb, publicMetrics} from './lib/structural.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK = 'studio-flamethrower-fire-20261114-031614-01';
const RAW_REL = 'reference/tasks/flamethrower-fire-20261114-031614/audio';
const AUDIO = process.env.SOUND_LAB_AUDIO_DIR || path.join(ROOT, RAW_REL), RAW = path.join(AUDIO, 'raw');
const OUT = path.join(ROOT, 'game/public/assets/audio');
const MANIFEST_TS = path.join(ROOT, 'game/src/audio/manifest.fire.generated.ts');
const PROV_REL = 'assets/derivatives/audio-fire.json';
const NOTICE_REL = 'assets/audio/NOTICE.md', CREDITS_REL = 'assets/CREDITS.md';
const ALLOW = path.join(ROOT, 'tools/release/public-inputs.json');
const DRY = process.argv.includes('--dry-run'), QC = process.argv.includes('--qc');
const BYTE_CAP = 260 * 1024;
const PEAK_CEIL_DB = -1;
const LOOP_MARGIN_S = 0.1;
const sha = b => createHash('sha256').update(b).digest('hex');
const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2), r3 = v => +v.toFixed(3);

/** Runtime cue order (decode priority: the held weapon's own sounds first). */
const CUE_ORDER = ['flameIgnite', 'flameRoar', 'flameOut', 'fireBurn', 'fireCatch', 'fireCollapse', 'fireEmbers'];
const KIND = {flameIgnite: 'ignite', flameRoar: 'roar', flameOut: 'out', fireBurn: 'burn', fireCatch: 'catch', fireCollapse: 'collapse', fireEmbers: 'embers'};
const LOOPS = new Set(['flameRoar', 'fireBurn']);
const KBPS = {flameIgnite: 96, flameRoar: 64, flameOut: 96, fireBurn: 80, fireCatch: 96, fireCollapse: 96, fireEmbers: 96};
/** File name stem per cue (a loop is one file; one-shot takes are numbered). */
const NAME = {flameIgnite: 'fire-flame-ignite', flameRoar: 'fire-flame-roar-loop', flameOut: 'fire-flame-out', fireBurn: 'fire-burn-loop', fireCatch: 'fire-catch',
  fireCollapse: 'fire-collapse', fireEmbers: 'fire-embers'};

/**
 * Target loudness of each cue AT THE SOURCE (derivative x CUE_GAIN), LUFS — first estimates for the user's ear pass, set against the
 * existing calibration (derivatives/audio-track1.json: zombie groan -18.5, zombie attack -20.3, shotgun shot -17.6 at their loudest
 * 400 ms; derivatives/audio-chipper.json: the chipper's wet grind loop -25.1, its motor loop -27.9 integrated):
 *  - the roar: the player's own weapon, close and continuous — 1 LU over the chipper's wet grind, 5.5 LU under a zombie groan's loudest
 *    400 ms and 3.7 under an attack snarl, so enemy vocals are not masked (its energy is mostly under 300 Hz, theirs above);
 *  - the ignition: the whoomp 4 LU over the roar it hands over to (about a zombie attack); its roaring part sits near the roar's level;
 *  - the cut-off: its first 0.12 s sit 1-2 dB (plain RMS) over the roar it takes over from, then it falls away (2 LU under the roar
 *    by its loudest 400 ms, which already includes the fall);
 *  - the fire bed: the chipper motor's bed level at one fire's reference distance (three beds near the listener sum to about the roar);
 *  - catching fire: a soft whoomp at a prop, 1.7 LU under a zombie attack; the collapse: a burnt prop caving in, about a zombie attack /
 *    the chipper's body feed; the embers: the crunch + crackle layer 5 LU under the collapse hit.
 */
const MIX = {
  flameIgnite: {targetLufs: -20, basis: 'zombieAttack', why: 'the whoomp of the jet lighting: 4 LU over the roar it hands over to, about a zombie attack (-20.3), 2.4 LU under a shotgun shot'},
  flameRoar: {targetLufs: -24, basis: 'chipperGrind', why: 'the player\'s own weapon, close and continuous: 1 LU over the chipper\'s wet grind, 5.5 LU under a zombie groan\'s loudest 400 ms (-18.5) and 3.7 under an attack snarl, so enemy vocals are not masked'},
  flameOut: {targetLufs: -26, basis: 'chipperGrind', why: 'the jet cutting off: its first 0.12 s sit 1-2 dB over the fading roar (a last puff, see handover), then it falls away'},
  fireBurn: {targetLufs: -28, basis: 'chipperMotor', why: 'one fire\'s bed at its reference distance: the chipper motor\'s bed level; three beds near the listener sum to about the roar'},
  fireCatch: {targetLufs: -22, basis: 'zombieAttack', why: 'something catching fire: a soft whoomp at the prop, 1.7 LU under a zombie attack'},
  fireCollapse: {targetLufs: -20, basis: 'zombieAttack', why: 'a burnt prop caving in: about a zombie attack (-20.3) / the chipper\'s body feed (-20.9)'},
  fireEmbers: {targetLufs: -25, basis: 'zombieAttack', why: 'the crunch + ember crackle that settles after the collapse hit: a layer 5 LU under it'},
};

/**
 * Per accepted take: its shipped cue and its derivative window / loop search. Placed on the takes' 5 ms / 50 ms envelopes and 0.5 s
 * block levels (private QC; spectrogram images viewed; nothing listened to):
 *  - roar (take 04, the fourth wording): continuous from 0.09 s to 10.1 s; its 0.5 s blocks stay within about 1 dB over any 7.5 s, the
 *    50 ms level wanders 1.2-1.5 dB (turbulence), about two small crackle transients a second; 80 % of its energy is under 300 Hz
 *    with a bright layer over it (above 1 kHz: -11.8 dB of the whole, the 8 kHz octave -17 dB). The loop is the steadiest 7 s window
 *    that ends before the take's fall.
 *  - burn (take 02): a steady low flutter (0.5 s blocks within 0.9 dB) under 12-14 broadband crackle transients a second (crest
 *    21-25 dB), active 0.04-11.2 s. The loop is the steadiest 7 s window.
 *  - ignite (takes 01 / 02: one request, two seeds — one family): silent to 0.09 s, a rise to the loudest 50 ms at 0.2 s (99 % of it
 *    under 300 Hz: the whoomp), then a roaring plateau 5-10 dB lower that holds to 0.95-1.05 s. Each window runs from the silence
 *    before the rise into the plateau, which a 0.3 s fade hands over to the roar loop.
 *  - out (take 01, and take 02 of a second wording): take 01's window opens inside its loud last part (0.14 s at roar level), then a
 *    0.8 s fall with small bumps to silence; take 02's opens 0.22 s before its abrupt 0.2 s / 30 dB fall. Neither take has the
 *    hot-metal ticks that were asked for after the fall.
 *  - catch (takes 01 / 02: one request, two seeds): one swell from silence (loudest 0.25-0.3 s after the window start, 86-90 % under
 *    300 Hz), a flutter 15 dB lower, silence 0.7-0.85 s after the start.
 *  - collapse (take 02): the take's heavy hit alone — a 15 ms attack (peak -1.4 dBFS in the take, 81 % under 300 Hz) and a 0.45 s
 *    low decay; its two earlier, smaller knocks are left out so that the hit leads the clip (the prop gives way when the cue starts).
 *  - embers (take 01 of the collapse request): from its loudest mid crunch (the cue starts with the collapse hit) through the nine
 *    sharp broadband snaps that follow over 1.4 s; almost nothing under 300 Hz, so it carries no weight of its own.
 */
const PLAN = {
  'fire-flame-ignite-01': {cue: 'flameIgnite', a: 0.08, b: 0.95, fadeIn: 0.005, fadeOut: 0.3},
  'fire-flame-ignite-02': {cue: 'flameIgnite', a: 0.075, b: 0.95, fadeIn: 0.005, fadeOut: 0.3},
  'fire-flame-roar-04': {cue: 'flameRoar', len: 7, xf: 0.5, minStart: 1, endGuard: 2.5},
  'fire-flame-out-01': {cue: 'flameOut', a: 1.86, b: 2.84, fadeIn: 0.02, fadeOut: 0.1},
  'fire-flame-out-02': {cue: 'flameOut', a: 1.5, b: 1.95, fadeIn: 0.02, fadeOut: 0.05},
  'fire-burn-02': {cue: 'fireBurn', len: 7, xf: 0.5, minStart: 1, endGuard: 1.5},
  'fire-catch-01': {cue: 'fireCatch', a: 0.14, b: 0.84, fadeIn: 0.01, fadeOut: 0.04},
  'fire-catch-02': {cue: 'fireCatch', a: 0.11, b: 0.98, fadeIn: 0.01, fadeOut: 0.05},
  'fire-collapse-02': {cue: 'fireCollapse', a: 2.05, b: 2.66, fadeIn: 0.003, fadeOut: 0.08},
  'fire-collapse-01': {cue: 'fireEmbers', a: 1.43, b: 2.86, fadeIn: 0.005, fadeOut: 0.05},
};
/**
 * Generated but not shipped, recorded publicly by job id with the reason (the raws stay in the private archive): `rejected` = the
 * take's structure does not fit its cue (replaced through a later batch with an adjusted wording).
 */
const NOT_USED = {
  'fire-flame-roar-01': {kind: 'rejected', reason: 'a steady continuous roar (0.5 s blocks within 0.4 dB), but dark: 90 % of its energy under 300 Hz, the octaves fall about 8 dB each above 250 Hz and the band above 1 kHz is 21.9 dB under the whole — a deep rumble with almost no rushing hiss; replaced by the fourth wording'},
  'fire-flame-roar-02': {kind: 'rejected', reason: 'the second wording returned the same dark family: 88 % under 300 Hz, the band above 1 kHz 20.3 dB under the whole; replaced by the fourth wording'},
  'fire-flame-roar-03': {kind: 'rejected', reason: 'a band-limited hiss (centroid 3.9 kHz, 0.3 % of the energy under 300 Hz) at an almost constant level (50 ms spread 0.35 dB) that slowly sinks 3 dB: a gas hiss with no roar body and no turbulence'},
  'fire-burn-01': {kind: 'rejected', reason: 'six separate 1.0-2.6 s surges that fall to silence between them (0.5 s block levels from -25 to -51 dBFS): no steady bed to loop; the second wording gave the steady fire'},
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
/** Integrated loudness of a loop played twice (no edge effect at the block grid). */
function loopIntegrated(lp, sr) {
  const y = new Float64Array(lp.length * 2);
  y.set(lp); y.set(lp, lp.length);
  return loudness(y, sr).integratedLufs;
}
/** Structural loop-seam check: the sample step across the wrap vs the median / 99th-percentile step, and the 50 ms RMS either side (dB). */
function seam(lp, sr) {
  const L = lp.length, steps = new Float64Array(L - 1);
  for (let i = 1; i < L; i++) steps[i - 1] = Math.abs(lp[i] - lp[i - 1]);
  const sorted = Float64Array.from(steps).sort(), med = sorted[sorted.length >> 1] || 1e-9, p99 = sorted[Math.floor(sorted.length * 0.99)];
  const wrap = Math.abs(lp[0] - lp[L - 1]), W = Math.round(0.05 * sr);
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += lp[i] * lp[i]; return Math.sqrt(s / Math.max(1, b - a)); };
  // the texture's own 50 ms -> 50 ms level changes inside the loop (a crackling fire varies far more than a steady jet)
  const jumps = [];
  for (let a = 0; a + 2 * W <= L; a += W) jumps.push(Math.abs(D.linToDb(rms(a + W, a + 2 * W)) - D.linToDb(rms(a, a + W))));
  jumps.sort((x, y) => x - y);
  return {wrapStep: +wrap.toExponential(3), medianStep: +med.toExponential(3), wrapOverMedian: r2(wrap / med), wrapOverP99: r2(wrap / p99),
    levelJumpDb: r2(D.linToDb(rms(0, W)) - D.linToDb(rms(L - W, L))), adjacentJumpP95Db: r2(jumps[Math.floor(jumps.length * 0.95)] ?? 0)};
}
/** Seconds from the clip start to the first `hopS` frame within `db` of the clip's loudest `hopS` frame. */
function timeToWithin(x, sr, db, hopS = 0.005) {
  const env = envelopeDb(x, sr, hopS), mx = Math.max(...env);
  return r3(env.findIndex(e => e >= mx - db) * hopS);
}
/** Crackle transients: 5 ms frames that stand `riseDb` over the median of the preceding 40 ms, at least `minGapS` apart (count). */
function crackles(x, sr, {riseDb = 6, minGapS = 0.02} = {}) {
  const env = envelopeDb(x, sr, 0.005);
  let n = 0, last = -Infinity;
  for (let h = 8; h < env.length; h++) {
    const w = [...env.slice(h - 8, h)].sort((p, q) => p - q);
    if (env[h] - w[4] >= riseDb && (h - last) * 0.005 >= minGapS) { n++; last = h; }
  }
  return n;
}
/** Standard deviation (dB) of the 0.5 s block levels (how steady a bed is). */
function blockStd(x, sr) {
  const b = [...D.envelope(x, Math.round(0.5 * sr))].map(D.linToDb), mean = b.reduce((p, q) => p + q, 0) / b.length;
  return r2(Math.sqrt(b.reduce((p, q) => p + (q - mean) ** 2, 0) / b.length));
}

/** Structural gate of a derivative per cue kind (NOT a listening test). Thresholds follow the cue definitions of the lane brief. */
function gate(kind, m, x, sr, {edges, seamQc, loopS}) {
  const c = [];
  const req = (name, ok, value, need) => c.push({name, ok: !!ok, value, need});
  const b = m.spectral.bands, low = b['0-300Hz'] ?? 0, above1k = r3((b['1000-3000Hz'] ?? 0) + (b['3000-8000Hz'] ?? 0) + (b['8000-22050Hz'] ?? 0));
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  req('no clipping, under the ceiling', m.clippedFrac < 1e-4 && m.peakDbfs <= PEAK_CEIL_DB + 0.1, {clippedFrac: m.clippedFrac, peakDbfs: m.peakDbfs}, `no clipped samples, peak <= ${PEAK_CEIL_DB} dBFS`);
  req('no DC', Math.abs(mean) <= 3e-3, +mean.toExponential(1), '|mean| <= 0.003');
  const dur = m.durationS, t6 = timeToWithin(x, sr, 6), ck = crackles(x, sr);
  const extra = {timeToWithin6DbS: t6, lowShare: low, above1kShare: above1k, crackles: ck, cracklesPerS: r2(ck / dur)};
  if (kind === 'roar' || kind === 'burn') {
    const bs = blockStd(x, sr);
    // the generic rule of lib/structural cueVerdict, recorded but NOT applied to a flame loop (see the header)
    const wall = m.levelSpreadDb < 2 && m.spectral.flatness >= 0.35 && m.pitch.voicedFrac < 0.1;
    Object.assign(extra, {blockStdDb: bs, levelSpread50msDb: m.levelSpreadDb, crestDb: m.crestDb,
      noiseWallRule: {applied: false, wouldFire: wall, levelSpreadDb: m.levelSpreadDb, flatness: m.spectral.flatness, voicedFrac: m.pitch.voicedFrac,
        why: 'a flame is legitimately steady broadband noise: judged by block steadiness, turbulence, crackle transients and band shares instead'}});
    req('a bed-length loop', loopS >= 5, loopS, '>= 5 s');
    req('no click at the wrap', seamQc.wrapOverP99 <= 1, seamQc.wrapOverP99, 'the sample step across the wrap <= the loop\'s own 99th-percentile step');
    const lim = Math.min(6, Math.max(3, seamQc.adjacentJumpP95Db));
    req('no level step at the wrap', Math.abs(seamQc.levelJumpDb) <= lim, seamQc.levelJumpDb, `the 50 ms level across the wrap within ${lim} dB (3 dB, or the texture's own 95th-percentile 50 ms change, never over 6 dB)`);
    req('steady (no surges, no fade)', bs <= 1.5, bs, '0.5 s block levels within 1.5 dB (standard deviation)');
    req('unpitched', m.pitch.voicedFrac <= 0.1, m.pitch.voicedFrac, 'voiced <= 0.1');
    if (kind === 'roar') {
      req('turbulent, neither a flat wall nor a pulse', m.levelSpreadDb >= 0.5 && m.levelSpreadDb <= 3, m.levelSpreadDb, '50 ms level spread 0.5-3 dB');
      req('a roar body', low >= 0.5, low, '>= 50 % of the energy under 300 Hz');
      req('a bright layer over it (not a rumble alone)', above1k >= 0.03, above1k, '>= 3 % of the energy above 1 kHz');
    } else {
      req('crackles and pops', ck / dur >= 5 && m.crestDb >= 15, {cracklesPerS: r2(ck / dur), crestDb: m.crestDb}, '>= 5 crackle transients a second, crest >= 15 dB');
      req('a flame bed under them', low >= 0.4, low, '>= 40 % of the energy under 300 Hz');
    }
  } else {
    req('no click at the edges (faded to zero)', Math.abs(x[0]) < 1e-3 && Math.abs(x[x.length - 1]) < 1e-3, {first: +x[0].toExponential(1), last: +x[x.length - 1].toExponential(1)}, 'first / last sample ~ 0');
    if (kind === 'ignite') {
      // the roaring part after the whoomp: the mean level 0.3-0.6 s into the clip against the clip's loudest 50 ms frame
      const env50 = [...envelopeDb(x, sr, 0.05)], mx = Math.max(...env50), mid = env50.slice(6, 12), holdDb = r1(10 * Math.log10(mid.reduce((p, e) => p + Math.pow(10, e / 10), 0) / mid.length) - mx);
      Object.assign(extra, {holdDb});
      req('short (0.6-1.0 s)', dur >= 0.6 && dur <= 1.0, dur, '0.6-1.0 s');
      req('the whoomp arrives quickly', t6 <= 0.2, t6, 'within 6 dB of its loudest 5 ms frame <= 0.2 s after the clip start');
      req('a low whoomp', low >= 0.7, low, '>= 70 % of the energy under 300 Hz');
      req('the roar holds after it (hands over to the loop)', holdDb >= -15, holdDb, 'the level 0.3-0.6 s in within 15 dB of the loudest 50 ms frame');
      req('starts in silence', edges.startDb <= -24, edges.startDb, 'the cut start >= 24 dB under the take peak');
    } else if (kind === 'out') {
      req('short (0.4-1.2 s)', dur >= 0.4 && dur <= 1.2, dur, '0.4-1.2 s');
      req('starts at the roar (takes over from the fading loop)', t6 <= 0.1, t6, 'within 6 dB of its loudest 5 ms frame <= 0.1 s after the clip start');
      req('falls away', m.decay.lastMinusFirstDb <= -12, m.decay.lastMinusFirstDb, 'last quarter >= 12 dB under the first quarter');
      req('ends in silence', edges.endDb <= -24, edges.endDb, 'the cut end >= 24 dB under the take peak');
    } else if (kind === 'catch') {
      req('short (0.5-1.0 s)', dur >= 0.5 && dur <= 1.0, dur, '0.5-1.0 s');
      req('a swell, not a click', t6 >= 0.05 && t6 <= 0.4, t6, 'within 6 dB of its loudest 5 ms frame 0.05-0.4 s after the clip start');
      req('a low whoomp', low >= 0.7, low, '>= 70 % of the energy under 300 Hz');
      req('starts and ends in silence', edges.startDb <= -24 && edges.endDb <= -24, edges, 'both cuts >= 24 dB under the take peak');
    } else if (kind === 'collapse') {
      req('short (0.4-1.0 s)', dur >= 0.4 && dur <= 1.0, dur, '0.4-1.0 s');
      req('the hit leads', t6 <= 0.05, t6, 'within 6 dB of its loudest 5 ms frame <= 0.05 s after the clip start');
      req('weight', low >= 0.6, low, '>= 60 % of the energy under 300 Hz');
      req('decays', m.decay.lastMinusFirstDb <= -10, m.decay.lastMinusFirstDb, 'last quarter >= 10 dB under the first quarter');
      req('ends in silence', edges.endDb <= -24, edges.endDb, 'the cut end >= 24 dB under the take peak');
    } else if (kind === 'embers') {
      req('the settle (1.0-2.0 s)', dur >= 1.0 && dur <= 2.0, dur, '1.0-2.0 s');
      req('the crunch comes with the hit', t6 <= 0.1, t6, 'within 6 dB of its loudest 5 ms frame <= 0.1 s after the clip start');
      req('a crackle shower', ck >= 6, ck, '>= 6 crackle transients');
      req('bright snaps', m.spectral.centroidHz >= 1500, m.spectral.centroidHz, 'centroid >= 1.5 kHz');
      req('ends in silence', edges.endDb <= -24, edges.endDb, 'the cut end >= 24 dB under the take peak');
    } else throw new Error(`unknown gate ${kind}`);
  }
  return {kind, pass: c.every(q => q.ok), failed: c.filter(q => !q.ok).map(q => q.name), ...extra, criteria: c};
}

const queueDoc = JSON.parse(fs.readFileSync(path.join(AUDIO, 'queue.json'), 'utf8')), queue = queueDoc.clips;
for (const c of queue) if (!PLAN[c.id] === !NOT_USED[c.id]) throw new Error(`${c.id}: must be either planned or recorded as not used`);
for (const id of [...Object.keys(PLAN), ...Object.keys(NOT_USED)]) if (!queue.some(c => c.id === id)) throw new Error(`${id}: not in the queue`);

const derivs = [], notUsed = [];
for (const c of queue) {
  const side = JSON.parse(fs.readFileSync(path.join(RAW, `${c.id}.sidecar.json`), 'utf8'));
  const rawBuf = fs.readFileSync(path.join(RAW, `${c.id}.wav`));
  if (sha(rawBuf) !== side.rawSha256) throw new Error(`${c.id}: raw sha mismatch`);
  if (side.request?.prompt !== c.prompt || side.request?.seed !== c.seed || side.request?.seconds !== c.seconds) throw new Error(`${c.id}: the lab's recorded request differs from the plan`);
  const jobId = side.job?.id ?? side.jobId ?? null;
  if (!/^\d{8}T\d{6}-\d+$/.test(String(jobId))) throw new Error(`${c.id}: no Sound Lab job id in the runner sidecar`);
  // public source record: hashes / ids / request numbers only — no prompt text, no private path or lab file name
  const source = {clip: c.id, jobId, seed: side.request.seed, seconds: side.request.seconds, steps: side.request.steps, cfg: side.request.cfg,
    rawSha256: side.rawSha256, rawBytes: side.rawBytes, labSidecarSha256: side.labSidecarSha256, promptSha256: sha(Buffer.from(side.request.prompt, 'utf8'))};
  if (NOT_USED[c.id]) { notUsed.push({cue: c.cue, ...source, ...NOT_USED[c.id]}); continue; }
  const p = PLAN[c.id];
  if (!LOOPS.has(p.cue) === !!p.len) throw new Error(`${c.id}: a loop cue needs a loop plan, a one-shot a window`);
  const w = readWav(rawBuf), sr = w.sampleRate;
  if (sr !== 44100) throw new Error(`${c.id}: sample rate ${sr} (the bank contract is 44.1 kHz)`);
  const mono = D.downmix(w.channels);
  let rawPk = 0;
  for (const v of mono) rawPk = Math.max(rawPk, Math.abs(v));
  // the take was asked for one cue and may ship as another (recorded: the queue is append-only, its cue label is never rewritten)
  const asked = c.cue === p.cue ? {} : {askedAs: c.cue};
  if (p.len) {
    const reg = D.stationaryRegion(mono, sr, p.len + p.xf, {minStartS: p.minStart, endGuardS: p.endGuard});
    const A = Math.round(reg.startS * sr), B = A + Math.round((p.len + p.xf) * sr);
    if (B > mono.length) throw new Error(`${c.id}: loop window runs past the take`);
    let dc = 0;
    for (let i = A; i < B; i++) dc += mono[i];
    dc /= B - A;
    const src = Float32Array.from(mono, v => v - dc);
    const lp = D.makeLoop([src], sr, reg.startS, p.len, p.xf);
    const seamQc = seam(lp[0], sr);
    const chs = D.withLoopMargins(lp, sr, LOOP_MARGIN_S);
    const g = D.normaliseRms(chs, -20, PEAK_CEIL_DB);
    const M = Math.round(LOOP_MARGIN_S * sr), L = lp[0].length;
    derivs.push({...p, take: c.id, source, asked, sr, x: chs[0], body: chs[0].subarray(M, M + L), seamQc,
      loop: {start: LOOP_MARGIN_S, length: +(L / sr).toFixed(6)}, window: {startS: reg.startS, endS: r3(reg.startS + p.len + p.xf)},
      ops: ['mono', `stationary window from ${reg.startS} s (std ${reg.stdDb} dB over 0.5 s blocks, searched from ${p.minStart} s, end guard ${p.endGuard} s)`, `remove DC (${dc.toExponential(1)})`,
        `loop ${p.len} s, equal-power crossfade ${p.xf} s`, `margins ${LOOP_MARGIN_S} s`, `rms -20 dBFS under a ${PEAK_CEIL_DB} dBFS peak ceiling (${g.toFixed(1)} dB)`]});
  } else {
    const A = Math.round(p.a * sr), B = Math.min(mono.length, Math.round(p.b * sr));
    // edge levels before the fades, re the take's peak sample (5 ms outside the cut + 0.5 ms inside it)
    const edge = (i, out) => { let e = 0; for (let k = Math.max(0, i - (out < 0 ? 220 : 22)); k < Math.min(mono.length, i + (out < 0 ? 22 : 220)); k++) e = Math.max(e, Math.abs(mono[k])); return r1(D.linToDb(e / rawPk)); };
    const chs = D.slice([Float32Array.from(mono)], A, B);
    let dc = 0;
    for (const v of chs[0]) dc += v;
    dc /= chs[0].length;
    for (let i = 0; i < chs[0].length; i++) chs[0][i] -= dc;
    D.fade(chs, sr, p.fadeIn, p.fadeOut);
    const g = D.normalisePeak(chs, PEAK_CEIL_DB);
    derivs.push({...p, take: c.id, source, asked, sr, x: chs[0], body: chs[0], edges: {startDb: edge(A, -1), endDb: edge(B, 1)}, window: {startS: p.a, endS: p.b},
      ops: ['mono', `remove DC (${dc.toExponential(1)})`, `trim ${p.a}-${p.b} s`, `cosine fades ${p.fadeIn} / ${p.fadeOut} s`, `peak ${PEAK_CEIL_DB} dBFS (${g.toFixed(1)} dB)`]});
  }
}

// loudness per derivative; the one-shot takes of a cue: the louder ones lowered to the quietest take's momentary-max (variants sit at one level)
const byCue = new Map();
for (const d of derivs) { d.lufs = d.loop ? loopIntegrated(d.body, d.sr) : momentaryMax(d.x, d.sr); (byCue.get(d.cue) ?? byCue.set(d.cue, []).get(d.cue)).push(d); }
for (const [cue, list] of byCue) {
  if (LOOPS.has(cue)) { if (list.length !== 1) throw new Error(`${cue}: exactly one loop take`); continue; }
  const q = Math.min(...list.map(d => d.lufs));
  for (const d of list) if (d.lufs - q > 0.05) {
    const g = Math.pow(10, (q - d.lufs) / 20);
    for (let i = 0; i < d.x.length; i++) d.x[i] *= g;
    d.ops.push(`matched to the cue's quietest take (${(20 * Math.log10(g)).toFixed(1)} dB)`);
    d.lufs = momentaryMax(d.x, d.sr);
  }
}

// the mix: CUE_GAIN per cue from the measured loudness and the MIX target; references from the existing calibration
const t1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/audio-track1.json'), 'utf8')).mixCalibration;
const chip = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public/assets/derivatives/audio-chipper.json'), 'utf8')).mixCalibration.cues;
const references = {zombieGroan: t1.reference.zombieGroan?.mixMomentaryMaxLufs, zombieAttack: t1.reference.zombieAttack?.mixMomentaryMaxLufs, shotgunShot: t1.reference.shotgunShot?.mixMomentaryMaxLufs,
  chipperGrind: chip.chipperGrind?.atSourceLufs, chipperMotor: chip.chipperMotor?.atSourceLufs};
for (const [k, v] of Object.entries(references)) if (!Number.isFinite(v)) throw new Error(`no calibration for the reference cue ${k}`);
const rmsDb = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return D.linToDb(Math.sqrt(s / Math.max(1, b - a))); };
const mix = {};
for (const cue of CUE_ORDER) {
  const list = byCue.get(cue);
  if (!list?.length) throw new Error(`cue ${cue} has no clip`);
  const measured = Math.max(...list.map(d => d.lufs)), T = MIX[cue];
  const gain = Math.min(1, r2(Math.pow(10, (T.targetLufs - measured) / 20)));
  let pk = 0;
  for (const d of list) for (const v of d.x) pk = Math.max(pk, Math.abs(v));
  mix[cue] = {measure: LOOPS.has(cue) ? 'integrated (loop x2)' : 'max momentary', basis: T.basis, why: T.why, targetLufs: T.targetLufs, measuredLufs: r1(measured), cueGain: gain,
    atSourceLufs: r1(measured + 20 * Math.log10(gain)), atSourcePeakDbfs: r1(D.linToDb(pk * gain)), vsReferenceLu: r1(measured + 20 * Math.log10(gain) - references[T.basis]), variants: list.length};
}
// the hand-overs between the roar loop and the one-shots around it (plain RMS at the source, dBFS): the ignition's roaring part
// (0.4-0.7 s into each clip) and the cut-off's first 0.12 s against the loop's own level
const gDb = cue => 20 * Math.log10(mix[cue].cueGain);
const handover = {
  roarRmsDbfs: r1(rmsDb(byCue.get('flameRoar')[0].body) + gDb('flameRoar')),
  igniteHoldRmsDbfs: byCue.get('flameIgnite').map(d => r1(rmsDb(d.x, Math.round(0.4 * d.sr), Math.round(0.7 * d.sr)) + gDb('flameIgnite'))),
  outStartRmsDbfs: byCue.get('flameOut').map(d => r1(rmsDb(d.x, Math.round(0.02 * d.sr), Math.round(0.14 * d.sr)) + gDb('flameOut'))),
};

// structural record per derivative (NOT a listening test) + the gate
const files = [], prov = [], manifest = {}, qcInputs = [], gateFailures = [];
const count = new Map();
for (const cue of CUE_ORDER) for (const d of byCue.get(cue)) {
  const n = (count.get(d.cue) ?? 0) + 1;
  count.set(d.cue, n);
  const name = d.loop ? NAME[d.cue] : `${NAME[d.cue]}-${String(n).padStart(2, '0')}`, url = `assets/audio/${name}.mp3`;
  const m = structure(d.body, d.sr), lu = loudness(d.body, d.sr);
  const gt = gate(KIND[d.cue], m, d.body, d.sr, {edges: d.edges, seamQc: d.seamQc, loopS: d.loop?.length});
  if (!gt.pass) gateFailures.push(`${name} (${d.take}): structural gate '${gt.kind}' failed: ${JSON.stringify(gt.criteria.filter(q => !q.ok))}`);
  const kbps = KBPS[d.cue], mp3 = encodeMp3(d.x, d.sr, kbps), dur = +(d.x.length / d.sr).toFixed(4);
  const metrics = {...publicMetrics(m), loudness: {integratedLufs: lu.integratedLufs, ...(d.loop ? {loopIntegratedLufs: r1(d.lufs)} : {momentaryMaxLufs: r1(d.lufs)})}, ...(d.edges ? {edgesDb: d.edges} : {})};
  delete metrics.pitch?.segments;
  (manifest[d.cue] ??= []).push({url, dur, ...(d.loop ? {loop: d.loop} : {}), src: d.take});
  files.push({url, buf: mp3});
  prov.push({cue: d.cue, ...d.asked, url, bytes: mp3.length, sha256: sha(mp3), dur, ...(d.loop ? {loop: d.loop, seam: d.seamQc} : {}), window: d.window, ops: [...d.ops, `mp3 mono ${kbps} kbps`], gate: gt, metrics, source: d.source});
  qcInputs.push({name, m, lu, gt});
}

const total = files.reduce((s, f) => s + f.buf.length, 0);
for (const p of prov) console.log(p.cue.padEnd(12), p.url.padEnd(40), String(p.bytes).padStart(6), 'B', String(p.dur).padStart(6), 's', p.loop ? `loop ${p.loop.start}+${p.loop.length} I ${p.metrics.loudness.loopIntegratedLufs}` : `M ${p.metrics.loudness.momentaryMaxLufs}`,
  `pk ${p.metrics.peakDbfs}`, `rms ${p.metrics.rmsDbfs}`, `t6 ${p.gate.timeToWithin6DbS}`, `low ${p.gate.lowShare}`, `>1k ${p.gate.above1kShare}`, `cen ${p.metrics.spectral.centroidHz}`, `flat ${p.metrics.spectral.flatness}`, `crk ${p.gate.crackles} (${p.gate.cracklesPerS}/s)`,
  p.loop ? `blocks ${p.gate.blockStdDb} spread ${p.gate.levelSpread50msDb} crest ${p.gate.crestDb} seam ${JSON.stringify(p.seam)} wall ${p.gate.noiseWallRule.wouldFire}` : `l-f ${p.metrics.decay.lastMinusFirstDb} edges ${p.metrics.edgesDb.startDb}/${p.metrics.edgesDb.endDb}${p.gate.holdDb !== undefined ? ` hold ${p.gate.holdDb}` : ''}`,
  '|', p.window.startS, '-', p.window.endS, p.gate.pass ? 'PASS' : 'FAIL');
for (const [c, m] of Object.entries(mix)) console.log('mix', c.padEnd(12), `measured ${m.measuredLufs} target ${m.targetLufs} gain ${m.cueGain} -> ${m.atSourceLufs} LUFS, peak ${m.atSourcePeakDbfs} dBFS (${m.vsReferenceLu >= 0 ? '+' : ''}${m.vsReferenceLu} LU vs ${m.basis} ${references[m.basis]})`);
console.log('handover', JSON.stringify(handover));
const accepted = Object.keys(PLAN).length, rejectedN = notUsed.filter(q => q.kind === 'rejected').length, spareN = notUsed.filter(q => q.kind === 'spare').length;
console.log(`total ${total} bytes (cap ${BYTE_CAP}); ${queue.length} jobs; accepted ${accepted}, rejected ${rejectedN}, spare ${spareN}`);
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
  fs.writeFileSync(path.join(dir, 'derivatives-metrics.json'), JSON.stringify({listening: 'NOT LISTENED TO: structural numbers only', mix, handover, derivatives: prov}, null, 1) + '\n');
  console.log('qc:', pngs.length, 'images in', dir);
}
if (gateFailures.length) throw new Error(`${gateFailures.length} derivative(s) failed their structural gate (nothing written)`);
if (DRY) process.exit(0);

for (const f of files) fs.writeFileSync(path.join(OUT, path.basename(f.url)), f.buf);
const ts = `// GENERATED by tools/audio-pipeline/fire-build.mjs from the Sound Lab raws — do not edit by hand.
// Provenance: public/${PROV_REL}. Task ${TASK} (lane AUDIO): the flamethrower + fire set — the
// jet lighting, its roar loop, its cut-off, the fire bed loop of burning patches / props, something catching fire, a burnt prop caving
// in and the ember crackle that settles after it (audio/flameAudio.ts over audio/sfx.ts fireCue / reactorLoop).

import type {ClipRef} from './manifest.generated';

/** This build's runtime cues, in decode-priority order (bank.ts CUES). */
export const FIRE_CUES = [
${CUE_ORDER.map(c => `  '${c}',`).join('\n')}
] as const;
export type FireCue = (typeof FIRE_CUES)[number];

export const CLIP_MANIFEST_FIRE: Readonly<Record<string, readonly ClipRef[]>> = {
${CUE_ORDER.map(cue => ` ${cue}: [\n${manifest[cue].map(r => `  ${JSON.stringify(r)},`).join('\n')}\n ],`).join('\n')}
};
/**
 * Mix gain per cue (sfx.ts CUE_GAIN spreads these numbers) = 10^((target - measured) / 20), capped at 1: the cue's loudness at the
 * source (one-shots: loudest 400 ms; loops: integrated) against the existing calibration. Measured / target LUFS in the provenance
 * (mixCalibration). First estimates for the ear pass (not auditioned).
 */
export const FIRE_CUE_GAIN: Readonly<Record<FireCue, number>> = {
${CUE_ORDER.map(c => `  ${c}: ${mix[c].cueGain}, // ${mix[c].measuredLufs} -> ${mix[c].atSourceLufs} LUFS at the source (target ${mix[c].targetLufs}: ${mix[c].why})`).join('\n')}
};
/** Cues of this build without a clip (none). */
export const CLIP_GAPS_FIRE: readonly string[] = [];
/** Bytes of this build's bundled clips. */
export const CLIP_BYTES_FIRE = ${total};
`;
fs.writeFileSync(MANIFEST_TS, ts);
const provDoc = {schema: 'last-line-derivative/1', asset: 'audio-fire-20261114', task: TASK, lane: 'AUDIO',
  generatedBy: `the existing LOCAL Sound Lab through tools/audio-pipeline/soundlab_runner.py (the task's audio authorization: the free local service inside the task as useful, without numerical permission caps, nothing paid or external; ${queue.length} jobs in bounded batches, each under its own durable POST cap — ${accepted} takes shipped, ${rejectedN} structurally rejected, ${spareN} spares)`,
  soundLab: {jobs: queue.length, accepted, rejected: rejectedN, spare: spareN, numericCap: null, paidOrExternal: 0},
  plannedBy: 'tools/audio-pipeline/fire-plan.py (ids, cues, durations, seeds; the prompt text stays with the private raw archive)',
  rebuild: 'SOUND_LAB_AUDIO_DIR=<raw dir> node tools/audio-pipeline/fire-build.mjs',
  reuse: 'Checked first (audio/bank.ts): the tank refill plays the existing jerrycan pour (fuelPour) and the dry trigger the existing dry click (dryFire), no new clip. The only fire in the bank is the road flare (a striker scrape, a sputtering chemical hiss loop, a dying fizz): no pressurised fuel jet, no open wood fire, nothing that whoomps alight or caves in. So these seven cues were generated; no flare clip stands in for any of them.',
  privacy: 'This public record names each raw take by its Sound Lab job id, seed and SHA-256 (raw take, lab sidecar, prompt). The prompt text, the raw takes and their paths stay in the private raw archive (independent backup), not in Git.',
  license: {status: 'Conditional prototype status: Stability AI Community License (2024-07-05) + Gemma Terms of Use (2026-04-01). Not production or commercial clearance. "Powered by Stability AI" if distributed. Outputs may not be used to build or improve a foundational generative AI model.',
    kitStatus: 'Conditional. Not commercially cleared by this kit.', review: 'NOT LISTENED TO on the worker (no audio output): structural analysis only (5 ms / 50 ms envelopes, 0.5 s block levels, 50 ms level spread, crackle transients, time to the loud part, spectrogram images (viewed), spectral centroid / bands / flatness, peak, DC, slice-edge levels, loop-seam step / level jump, BS.1770 loudness). `metrics` / `gate` describe signal structure only, never how a clip sounds: whether the roar reads as a flamethrower, the bed as a fire and the mix sits right in play needs an ear. The roar / burn loops are steady broadband noise by nature and are not gated by the generic noise-wall rule (each loop records the values that rule reads). The user taste-tests in game.',
    gameReady: false, approved: false, notice: 'game/public/assets/audio/NOTICE.md'},
  design: {
    flameIgnite: 'Two takes of one request (two seeds, one family): silent before a rise to the loudest 50 ms about 0.12 s after the clip start (almost all of it under 300 Hz: the whoomp), then a roaring part 5-10 dB lower that a 0.3 s fade hands over to the roar loop. No distinct valve hiss leads it.',
    flameRoar: 'One 7 s loop of the fourth wording: a continuous broadband roar, about 80 % of its energy under 300 Hz with a bright layer over it; its 0.5 s blocks stay within about 1 dB and the 50 ms level wanders a little over 1 dB (turbulence). Three earlier takes were rejected: two were a dark rumble with almost nothing above 1 kHz, one a thin hiss with no body.',
    flameOut: 'Two takes of two wordings: one opens at roar level and falls over 0.8 s with small bumps, the other holds 0.2 s and drops 30 dB in 0.2 s. Neither has the hot-metal ticks that were asked for after the fall. The audio layer plays the same takes lower and slower for a tank that ran dry.',
    fireBurn: 'One 7 s loop of the second wording: a steady low flutter under a dozen broadband crackle transients a second. The first wording returned separate surges with silence between them and was rejected.',
    fireCatch: 'Two takes of one request (two seeds, one family): one low swell from silence, loudest about 0.3 s in, a short flutter, silence.',
    fireCollapse: 'One take: its single heavy hit (a 15 ms attack, most of the energy under 300 Hz) with a 0.45 s low decay; two earlier, smaller knocks of the take are left out so that the hit leads the clip.',
    fireEmbers: 'The other take of the collapse request, shipped as a layer: from its loudest mid crunch through the sharp bright snaps that follow over 1.4 s. It has almost no low end, so the audio layer plays it WITH the collapse hit (the weight) — no single take had both with the hit first.'},
  loudness: {method: 'ITU-R BS.1770-4 K-weighting, 400 ms blocks / 75 % overlap, mono; one-shots: maximum momentary loudness (zero-padded to one block); loops: integrated loudness of the loop played twice; sample peak (no true-peak oversampling)'},
  mixCalibration: {note: 'CUE_GAIN (audio/sfx.ts spreads FIRE_CUE_GAIN of the generated manifest: the same numbers) per cue = 10^((target - measured) / 20), capped at 1 (no boost): the target is the cue\'s loudness AT THE SOURCE (derivative x CUE_GAIN, before distance / occlusion / master), set against the existing cues\' calibration (derivatives/audio-track1.json, derivatives/audio-chipper.json). Never above the -1 dBFS ceiling. `handover` = plain RMS at the source (dBFS) of the roar loop, of each ignition take\'s roaring part (0.4-0.7 s in) and of each cut-off take\'s first 0.12 s. First estimates for the ear pass (not auditioned).',
    references, cues: mix, handover},
  derivatives: prov, notUsedRaws: notUsed};
const provBuf = Buffer.from(JSON.stringify(provDoc, null, 1) + '\n');
{ const hit = provBuf.toString().match(/.{0,60}(https?:|Signature=|token=|reference\/|\.wav|TrackType).{0,20}/i); if (hit) throw new Error(`URL / private path / prompt-like string in public provenance: ...${hit[0]}...`); }
fs.writeFileSync(path.join(ROOT, 'game/public', PROV_REL), provBuf);

// NOTICE: this set's sentence (rewritten in place between its fixed head and tail; first added at the end of the per-set list)
const noticePath = path.join(ROOT, 'game/public', NOTICE_REL);
let notice = fs.readFileSync(noticePath, 'utf8');
{
  const head = 'the flamethrower and fire set (', tail = '): ../derivatives/audio-fire.json';
  const sentence = `${head}jet ignition, roar loop, cut-off, fire bed loop, catching fire, collapse, ember crackle,\nfire-*.mp3; seeds and hashes only, the prompts stay with the private raw takes${tail}`;
  const i0 = notice.indexOf(head), i1 = notice.indexOf(tail);
  if (i0 >= 0 && i1 > i0) notice = notice.slice(0, i0) + sentence + notice.slice(i1 + tail.length);
  else {
    const anchor = '.json).\n\nPowered by Stability AI.';
    if (notice.split(anchor).length !== 2) throw new Error('NOTICE.md: expected sentence anchor not found');
    notice = notice.replace(anchor, `.json; ${sentence}).\n\nPowered by Stability AI.`);
  }
  fs.writeFileSync(noticePath, notice);
}
// CREDITS: one marked block (rewritten in place on a rebuild; other lanes' blocks are never touched)
const creditsPath = path.join(ROOT, 'game/public', CREDITS_REL);
let credits = fs.readFileSync(creditsPath, 'utf8');
const B = '<!-- BEGIN flamethrower-fire-audio-20261114 (fire-build.mjs) -->', E = '<!-- END flamethrower-fire-audio-20261114 -->';
const block = `${B}
## Flamethrower and fire audio (jet ignition, roar loop, cut-off, fire bed loop, catching fire, collapse, ember crackle)
Generated for this project with the user's local Last Line Sound Lab CPU 0.1.0 (Stable Audio 3 Small-SFX, w8a8) under the flamethrower
task's audio authorization (the free local service only; ${queue.length} jobs, ${accepted} takes shipped). Powered by Stability AI. Stability AI Community License +
Gemma Terms of Use; conditional prototype status, not production or commercial clearance. Runtime derivatives (trim, fades, loop,
levelling, MP3) built by \`tools/audio-pipeline/fire-build.mjs\` (provenance: \`assets/derivatives/audio-fire.json\`). Not
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
