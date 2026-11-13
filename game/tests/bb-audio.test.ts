// Task studio-bb-production-20261112-234540-01 (lane AUDIO): BB's voice — one laugh set for all four looks: the cackle when it notices
// the player (the tell), the quiet giggle of a calm one nearby, the pounce squeal (started with the wind-up, loudest at the launch), the
// hurt squawk and the wind-down death. Registration, the shipped Sound Lab derivatives + hash-only provenance + mix calibration, and the
// Sfx behaviour (world-positioned voices at the mouth, the route / storey gates asked at the floor below the body, the cackle outside
// the vocal cap and the shared voice cap, per-BB rate limits, one throat, bounded voices, no loop) on a fake Web Audio graph.
// The clips were NOT listened to (structural QC only): nothing here says how they sound.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {BB_POUNCE, BB_SENSE, BB_VOICE_Y} from '../src/ai/bb';
import {VOCAL_GATE, VOCAL_REACH, VocalReach, inverseGain, vocalGain} from '../src/ai/vocalReach';
import {CLIP_MANIFEST, CUES, type CueId} from '../src/audio/bank';
import {BB_CUE_GAIN, BB_VOICE_CUES, CLIP_BYTES_BB, CLIP_GAPS_BB, CLIP_MANIFEST_BB} from '../src/audio/manifest.bb.generated';
import {BB_AUDIO, CUE_GAIN, Sfx, type BbVoiceKind, type VocalReachQuery} from '../src/audio/sfx';
import {FLOOR, Grid} from '../src/gen/grid';
import {FakeCtx, fakeBank, type Node, type Panner, type Src} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const pub = (p: string) => path.join(GAME, 'public', p);
const settle = () => new Promise(r => setTimeout(r, 40));
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const BB = ['bbCackle', 'bbGiggle', 'bbPounce', 'bbHurt', 'bbDeath'] as const;
const KINDS = ['cackle', 'giggle', 'pounce', 'hurt', 'death'] as const satisfies readonly BbVoiceKind[];
const CUE_OF: Record<BbVoiceKind, (typeof BB)[number]> = {cackle: 'bbCackle', giggle: 'bbGiggle', pounce: 'bbPounce', hurt: 'bbHurt', death: 'bbDeath'};

interface Source { clip: string; jobId: string; seed: number; seconds: number; steps: number; cfg: number; rawSha256: string; rawBytes: number; labSidecarSha256: string; promptSha256: string }
interface Gate {
  kind: string; pass: boolean; failed: string[]; timeToWithin6DbS: number; bursts: number; burstRatePerS: number | null; burstDipDb: number | null;
  audibleWithinS?: number; loudAtS?: number; buildDb?: number; riseSt?: number; pitchDropSt?: number | null;
}
interface Deriv {
  cue: string; url: string; bytes: number; sha256: string; dur: number; window: {startS: number; endS: number}; ops: string[]; gate: Gate;
  metrics: {durationS: number; peakDbfs: number; clippedFrac: number; loudness: {momentaryMaxLufs: number}; spectral: {centroidHz: number; flatness: number};
    pitch: {voicedFrac: number; f0MedianHz: number | null}; decay: {lastMinusFirstDb: number}};
  source: Source;
}
interface Mix { basis: string; targetLufs: number; measuredLufs: number; cueGain: number; atSourceLufs: number; atSourcePeakDbfs: number; variants: number }
const provText = fs.readFileSync(pub('assets/derivatives/audio-bb.json'), 'utf8');
const prov = JSON.parse(provText) as {
  asset: string; task: string; lane: string; generatedBy: string;
  soundLab: {jobs: number; accepted: number; rejected: number; spare: number; numericCap: number | null; paidOrExternal: number};
  license: {status: string; review: string; gameReady: boolean; approved: boolean}; design: Record<string, string>;
  mixCalibration: {references: Record<string, number>; cues: Record<string, Mix>; pounceWindupS: number};
  derivatives: Deriv[]; notUsedRaws: (Source & {cue: string; kind: 'rejected' | 'spare'; reason: string})[];
};

async function setup(only?: readonly CueId[]) {
  const made: FakeCtx[] = [];
  const {bank, buffers} = fakeBank({variants: 2, only});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  sfx.setListener(0, 1.6, 0, 0);
  const of = (cue: CueId) => { const b = new Set(bank.get(cue).map(c => c.buffer as unknown)); return ctx.started.filter(s => b.has(s.buffer)); };
  return {sfx, ctx, of, made, buffers};
}
/** The gain node a source feeds (per-clip gain = CUE_GAIN x the call's gain x jitter) and the voice input that feeds. */
const clipGain = (s: Src) => (s.outputs[0] as unknown as {gain: {value: number}}).gain.value;
const voiceIn = (s: Src) => s.outputs[0].outputs[0] as unknown as Node & {gain: {value: number}};
/** Everything downstream of a source's voice input, in graph order (the optional air / occlusion low-pass, the panner, the sends). */
function chain(s: Src): Node[] {
  const out: Node[] = [], seen = new Set<Node>(), walk = (n: Node) => { for (const o of n.outputs) if (!seen.has(o)) { seen.add(o); out.push(o); walk(o); } };
  walk(voiceIn(s));
  return out;
}
const pannerOf = (s: Src) => chain(s).find(n => n.kind === 'panner') as Panner | undefined;
const lowpassOf = (s: Src) => chain(s).find(n => (n as unknown as {type?: string}).type === 'lowpass') as unknown as {frequency: {value: number}} | undefined;
/** No rate / gain jitter and a fixed take order: exact levels. */
const steady = () => vi.spyOn(Math, 'random').mockReturnValue(0.5);
/** A route source that reaches every point in `m` metres. */
const reachAll = (m: number): VocalReachQuery => ({pathTo: () => m});
const unreachable: VocalReachQuery = {pathTo: () => Infinity};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('BB cues: registration + shipped Sound Lab derivatives', () => {
  it('the five cues are in the bank (CUES, CUE_GAIN, merged manifest) with their takes and no silent gap', () => {
    expect(BB_VOICE_CUES).toEqual(BB);
    for (const c of BB) {
      expect(CUES).toContain(c);
      expect(CLIP_MANIFEST[c]).toBe(CLIP_MANIFEST_BB[c]);
      expect(CUE_GAIN[c]).toBeGreaterThan(0);
      expect(CUE_GAIN[c]).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(CLIP_MANIFEST_BB)).toEqual([...BB]);
    expect(CLIP_GAPS_BB).toEqual([]);
    // the brief's takes: cackle 3-4, giggle 3-4, pounce 2-3, hurt 2-3, death 2
    expect(Object.fromEntries(BB.map(c => [c, CLIP_MANIFEST_BB[c].length]))).toEqual({bbCackle: 4, bbGiggle: 4, bbPounce: 3, bbHurt: 3, bbDeath: 2});
    expect(CLIP_MANIFEST_BB.bbCackle.map(r => r.url)).toEqual([1, 2, 3, 4].map(i => `assets/audio/bb-cackle-0${i}.mp3`));
    // the Sfx spec names exactly these cues, one per kind (all four looks share them: nothing is keyed by a look)
    expect(KINDS.map(k => BB_AUDIO[k].cue)).toEqual([...BB]);
  });

  it('clips are bundled relative MP3s matching their provenance (hash, bytes) and the public-input allowlist, inside the cue length bands', () => {
    const allow = new Map((JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    // (the hurt squawks are 0.22-0.26 s: the takes' first squawk alone, under the 0.3-0.6 s first asked for — see the provenance design note)
    const band: Record<string, [number, number]> = {bbCackle: [1.5, 2.5], bbGiggle: [0.7, 1.5], bbPounce: [0.9, 1.3], bbHurt: [0.2, 0.6], bbDeath: [0.7, 1.3]};
    let bytes = 0;
    for (const c of BB) for (const r of CLIP_MANIFEST_BB[c]) {
      expect(r.url).toMatch(/^assets\/audio\/bb-[a-z0-9-]+\.mp3$/);
      const b = fs.readFileSync(pub(r.url));
      bytes += b.length;
      const d = prov.derivatives.find(x => x.url === r.url)!;
      expect(d, r.url).toBeTruthy();
      expect(sha(b)).toBe(d.sha256);
      expect(d.bytes).toBe(b.length);
      expect(d.cue).toBe(c);
      expect(d.source.clip).toBe(r.src);
      expect(r.dur).toBe(d.dur);
      expect(r.dur, r.url).toBeGreaterThanOrEqual(band[c][0]);
      expect(r.dur, r.url).toBeLessThanOrEqual(band[c][1]);
      expect(r.loop).toBeUndefined(); // one-shots: nothing loops
      expect(allow.get(r.url), r.url).toEqual({path: r.url, bytes: b.length, sha256: sha(b)});
    }
    expect(bytes).toBe(CLIP_BYTES_BB);
    expect(bytes).toBeLessThan(300 * 1024);
    expect(prov.derivatives.length).toBe(BB.reduce((s, c) => s + CLIP_MANIFEST_BB[c].length, 0));
    // the release allowlist names exactly this set's clips (no stray bb-* audio), its record and the notice it edited
    expect([...allow.keys()].filter(k => /^assets\/audio\/bb-/.test(k)).sort()).toEqual(prov.derivatives.map(d => d.url).sort());
    for (const rel of ['assets/derivatives/audio-bb.json', 'assets/audio/NOTICE.md']) {
      const b = fs.readFileSync(pub(rel));
      expect(allow.get(rel), rel).toEqual({path: rel, bytes: b.length, sha256: sha(b)});
    }
    const notice = fs.readFileSync(pub('assets/audio/NOTICE.md'), 'utf8');
    expect(notice).toContain('bb-*.mp3');
    expect(notice).toContain('../derivatives/audio-bb.json');
    expect(notice.split('the BB voice set (').length).toBe(2); // one sentence (the builder rewrites it in place)
    expect(notice).toMatch(/Powered by Stability AI/);
    expect(notice).toMatch(/conditional prototype status, not production or commercial clearance/);
    // the credits: one marked block that lists every clip with its Sound Lab job
    const credits = fs.readFileSync(pub('assets/CREDITS.md'), 'utf8');
    const block = credits.slice(credits.indexOf('<!-- BEGIN bb-audio-20261113'), credits.indexOf('<!-- END bb-audio-20261113 -->'));
    expect(block).toMatch(/Powered by Stability AI/);
    expect(block).toMatch(/conditional prototype status, not production or commercial clearance/);
    expect(block).toMatch(/Not\s+reviewed by ear/);
    for (const d of prov.derivatives) expect(block).toContain(`- \`${d.url}\` — ${d.cue} (Sound Lab job ${d.source.jobId})`);
    expect(credits.split('<!-- BEGIN bb-audio-20261113').length).toBe(2); // exactly one block
  });

  it('provenance is hash-only, the free local Sound Lab only, and says NOT LISTENED TO', () => {
    expect(prov.asset).toBe('audio-bb-20261113');
    expect(prov.task).toBe('studio-bb-production-20261112-234540-01');
    // the task's audio authorization: the existing free local service, no fixed attempt cap, nothing paid or external
    const S = prov.soundLab;
    expect(S).toEqual({jobs: 23, accepted: 16, rejected: 5, spare: 2, numericCap: null, paidOrExternal: 0});
    expect(S.accepted + S.rejected + S.spare).toBe(S.jobs);
    expect(prov.generatedBy).toMatch(/LOCAL Sound Lab/);
    const used = new Set(prov.derivatives.map(d => d.source.jobId)), unused = new Set(prov.notUsedRaws.map(r => r.jobId));
    expect(used.size).toBe(S.accepted);
    expect(unused.size).toBe(S.rejected + S.spare);
    expect(prov.notUsedRaws.filter(r => r.kind === 'rejected').length).toBe(S.rejected);
    expect([...used].filter(j => unused.has(j))).toEqual([]);
    for (const r of prov.notUsedRaws) expect(r.reason.length).toBeGreaterThan(40); // every unused take says why (a structural reason)
    // hash-only: job id, seed, request numbers and SHA-256s — no prompt text, no private path, no raw file name, no URL
    for (const s of [...prov.derivatives.map(d => d.source), ...prov.notUsedRaws]) {
      expect(s.jobId).toMatch(/^20261113T\d{6}-\d+$/);
      expect(s.jobId.endsWith(`-${s.seed}`)).toBe(true);
      expect(Number.isInteger(s.seed)).toBe(true);
      expect(Number.isInteger(s.seconds)).toBe(true); // whole-second requests only
      expect([s.steps, s.cfg]).toEqual([8, 1]);
      for (const h of [s.rawSha256, s.labSidecarSha256, s.promptSha256]) expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(s).filter(k => /^(prompt|negativePrompt|rawFile|labFile|labUrl|labSidecar|runnerSidecar)$/.test(k))).toEqual([]);
    }
    expect(provText).not.toMatch(/TrackType|https?:|reference\/|\.wav|"prompt"\s*:/i);
    // honest review status: structural only
    expect(prov.license.review).toMatch(/^NOT LISTENED TO/);
    expect(prov.license.status).toMatch(/Conditional prototype/);
    expect([prov.license.gameReady, prov.license.approved]).toEqual([false, false]);
    // every shipped clip passed its structural gate, under the -1 dBFS ceiling, unclipped
    for (const d of prov.derivatives) {
      expect(d.gate.kind).toBe(KINDS.find(k => CUE_OF[k] === d.cue));
      expect(d.gate.pass, d.url).toBe(true);
      expect(d.metrics.peakDbfs).toBeLessThanOrEqual(-0.9);
      expect(d.metrics.clippedFrac).toBe(0);
      expect(d.ops[d.ops.length - 1]).toMatch(/^mp3 mono (96|128) kbps$/);
    }
  });

  it('structure per cue (signal structure only): laugh-rate burst trains, the squeal loud at the launch, a short squawk, a wind-down', () => {
    const of = (c: string) => prov.derivatives.filter(d => d.cue === c);
    // cackle / giggle: discrete bursts at a laugh rate (3-9 per second); the cackle is loud at once (the tell), the giggle pitched and soft
    for (const d of [...of('bbCackle'), ...of('bbGiggle')]) {
      expect(d.gate.bursts, d.url).toBeGreaterThanOrEqual(d.cue === 'bbCackle' ? 6 : 3);
      expect(d.gate.burstRatePerS!, d.url).toBeGreaterThanOrEqual(3);
      expect(d.gate.burstRatePerS!, d.url).toBeLessThanOrEqual(9);
      expect(d.gate.burstDipDb!, d.url).toBeGreaterThanOrEqual(10);
    }
    for (const d of of('bbCackle')) expect(d.gate.timeToWithin6DbS, d.url).toBeLessThanOrEqual(0.2);
    for (const d of of('bbGiggle')) {
      expect(d.metrics.pitch.voicedFrac, d.url).toBeGreaterThanOrEqual(0.2);
      expect(d.metrics.pitch.f0MedianHz!, d.url).toBeGreaterThanOrEqual(250);
      expect(d.metrics.pitch.f0MedianHz!, d.url).toBeLessThanOrEqual(800);
      expect(d.metrics.spectral.centroidHz, d.url).toBeLessThanOrEqual(1500);
    }
    // pounce: the brain starts the cue WITH the wind-up tell, windupS before the launch — the clip is audible at once (the warning) and
    // reaches its loudest part at the launch; a change of BB_POUNCE.windupS needs the clips re-cut (tools/audio-pipeline/bb-build.mjs)
    expect(prov.mixCalibration.pounceWindupS).toBe(BB_POUNCE.windupS);
    for (const d of of('bbPounce')) {
      expect(d.gate.audibleWithinS!, d.url).toBeLessThanOrEqual(0.05);
      expect(Math.abs(d.gate.loudAtS! - BB_POUNCE.windupS), d.url).toBeLessThanOrEqual(0.15);
      expect(d.gate.buildDb!, d.url).toBeGreaterThanOrEqual(6);
      expect(d.gate.riseSt!, d.url).toBeGreaterThanOrEqual(-0.5); // (the build is mostly one of level: the measured pitch rise is small)
      expect(d.metrics.pitch.voicedFrac, d.url).toBeGreaterThanOrEqual(0.4);
      // it covers the wind-up and at least the shortest leap, and is over before the longest leap ends (windupS + maxFlightS)
      expect(d.dur).toBeGreaterThanOrEqual(BB_POUNCE.windupS + 0.25);
      expect(d.dur).toBeLessThanOrEqual(BB_POUNCE.windupS + BB_POUNCE.maxFlightS);
    }
    // hurt: one short bright event with a fast attack; death: a burst train that winds down (in pitch or in level)
    for (const d of of('bbHurt')) {
      expect(d.gate.timeToWithin6DbS, d.url).toBeLessThanOrEqual(0.04);
      expect(d.gate.bursts, d.url).toBeLessThanOrEqual(2);
      expect(d.metrics.spectral.centroidHz, d.url).toBeGreaterThanOrEqual(2000);
    }
    for (const d of of('bbDeath')) {
      expect(d.gate.bursts, d.url).toBeGreaterThanOrEqual(4);
      expect((d.gate.pitchDropSt ?? 0) <= -7 || d.metrics.decay.lastMinusFirstDb <= -4, d.url).toBe(true);
    }
  });

  it('the builder edits generated clips only (no network, no process spawning, no synthesis); the public plan holds no prompt text', () => {
    const src = fs.readFileSync(path.join(ROOT, 'tools/audio-pipeline/bb-build.mjs'), 'utf8');
    expect(src).not.toMatch(/\bfetch\(|node:https?|node:net|node:child_process|api\/generate|Math\.random|Math\.sin\(/);
    const plan = fs.readFileSync(path.join(ROOT, 'tools/audio-pipeline/bb-plan.py'), 'utf8');
    expect(plan).not.toMatch(/TrackType: SFX,/); // (it names the prompt prefix it checks for; no prompt follows it)
    expect(plan).not.toMatch(/urllib|urlopen|import requests|import socket|subprocess|http\.client/); // it plans; the runner alone talks to the lab
    expect(plan).toContain('PROMPTS.json'); // the wording is read from the private raw archive
  });

  it('mix: CUE_GAIN = the build\'s calibration; the cackle carries, the giggle is soft, never above the -1 dBFS ceiling', () => {
    const m = prov.mixCalibration.cues, ref = prov.mixCalibration.references;
    for (const c of BB) {
      expect(m[c].cueGain, c).toBe(CUE_GAIN[c]);
      expect(BB_CUE_GAIN[c], c).toBe(CUE_GAIN[c]);
      expect(m[c].variants).toBe(CLIP_MANIFEST_BB[c].length);
      expect(m[c].atSourcePeakDbfs).toBeLessThanOrEqual(-1);
    }
    expect(m.bbCackle.atSourceLufs).toBeGreaterThanOrEqual(ref.zombieGroan + 1.5); // the tell: clearly over a zombie groan
    expect(m.bbCackle.atSourceLufs).toBeLessThan(ref.sirenScream); // ... and under the loudest enemy vocal
    expect(Math.abs(m.bbPounce.atSourceLufs - m.bbCackle.atSourceLufs)).toBeLessThanOrEqual(0.5); // the squeal's loudest part = the cackle's level
    expect(m.bbGiggle.atSourceLufs).toBeLessThanOrEqual(ref.zombieGroan - 5); // quiet
    expect(m.bbHurt.atSourceLufs).toBeLessThan(ref.zombieAttack);
    expect(m.bbHurt.atSourceLufs).toBeGreaterThan(m.bbGiggle.atSourceLufs);
    expect(m.bbDeath.atSourceLufs).toBeLessThan(ref.zombieDeath);
    // the ceiling holds for every call: peak at the source x call gain x the largest gain jitter
    for (const k of KINDS) {
      const s = BB_AUDIO[k], peak = m[s.cue].atSourcePeakDbfs + 20 * Math.log10(s.gain) + s.gainJitter;
      expect(peak, k).toBeLessThanOrEqual(-1 + 1e-9);
    }
    // range by the panner law (dry level): the cackle at 28 m is well over a zombie groan at its own 34 m limit; the giggle is quiet by 12 m
    const at = (lufs: number, d: number, s: {ref: number; rolloff: number}) => lufs + 20 * Math.log10(inverseGain(d, s.ref, s.rolloff));
    const groanFar = at(ref.zombieGroan, 34, {ref: 2.2, rolloff: 1.1});
    expect(at(m.bbCackle.atSourceLufs, 28, BB_AUDIO.cackle)).toBeGreaterThan(groanFar + 3);
    expect(at(m.bbGiggle.atSourceLufs, 12, BB_AUDIO.giggle)).toBeLessThan(groanFar);
    expect(BB_AUDIO.cackle.maxDist).toBeGreaterThanOrEqual(30);
    expect(BB_AUDIO.cackle.maxDist).toBeLessThanOrEqual(VOCAL_GATE.alert.limit);
    expect(BB_AUDIO.giggle.maxDist).toBeGreaterThanOrEqual(16); // the brain giggles within 16 m
    expect(BB_AUDIO.giggle.maxDist).toBeLessThanOrEqual(18);
    for (const k of ['pounce', 'hurt', 'death'] as const) expect(BB_AUDIO[k].maxDist, k).toBeGreaterThanOrEqual(4 * BB_POUNCE.dropMaxM);
  });

  it('config bounds: small caps, short fades, and rate limits that never thin the brain\'s own cadence', () => {
    for (const k of KINDS) {
      const s = BB_AUDIO[k];
      expect(s.max, k).toBeGreaterThanOrEqual(1);
      expect(s.max, k).toBeLessThanOrEqual(3);
      expect(s.minGapS, k).toBeGreaterThanOrEqual(0.3);
      expect([s.gain, s.rate], k).toEqual([1, 1]);
      expect(s.jitter, k).toBeLessThanOrEqual(0.08); // a small pitch spread
      expect(s.gainJitter, k).toBeLessThanOrEqual(1.5);
      expect(s.send, k).toBeLessThanOrEqual(0.6);
      expect(s.occMax, k).toBeGreaterThan(0);
      expect(s.occMax, k).toBeLessThanOrEqual(1);
    }
    expect(KINDS.reduce((s, k) => s + BB_AUDIO[k].max, 0)).toBeLessThanOrEqual(12); // the whole family at once: a few voices
    expect([BB_AUDIO.cackle.pri, BB_AUDIO.pounce.pri]).toEqual([2, 2]); // the two tells are never dropped by the shared voice cap
    expect(BB_AUDIO.cackle.occMax).toBeLessThan(1); // present through a doorway
    // the brain: a cackle at most every cackleGapS, a giggle every 5-10 s, a pounce at most every windup + land + cooldown
    expect(BB_AUDIO.cackle.minGapS).toBeLessThan(BB_SENSE.cackleGapS);
    expect(BB_AUDIO.giggle.minGapS).toBeLessThan(5);
    expect(BB_AUDIO.pounce.minGapS).toBeLessThan(BB_POUNCE.windupS + BB_POUNCE.landS + BB_POUNCE.cooldownS);
    expect(BB_AUDIO.pounce.jitter * BB_POUNCE.windupS).toBeLessThanOrEqual(0.02); // the rate jitter moves the loud part by under 20 ms
    for (const f of [BB_AUDIO.stealFadeS, BB_AUDIO.throatFadeS, BB_AUDIO.deathCutS]) { expect(f).toBeGreaterThan(0.02); expect(f).toBeLessThanOrEqual(0.2); }
    // the gates are asked where a BB crawling on the floor below would be voicing (its mouth is BB_VOICE_Y over its feet)
    expect(Math.abs(BB_AUDIO.gateLiftM - BB_VOICE_Y)).toBeLessThanOrEqual(0.1);
    expect(BB_AUDIO.gateLiftM).toBeLessThan(VOCAL_REACH.up + VOCAL_REACH.down);
  });
});

describe('Sfx.bbVoice: the five kinds', () => {
  it('has the contract signature; each kind plays its cue once at the mouth on a positional voice, at its calibrated level, never looped', async () => {
    const {sfx, ctx, of, made} = await setup();
    expect(sfx.bbVoice.length).toBe(6);
    steady();
    vi.stubGlobal('fetch', vi.fn());
    const contexts = Sfx.contextsCreated;
    for (const k of KINDS) {
      ctx.currentTime += 5;
      const S = BB_AUDIO[k], s0 = ctx.started.length;
      expect(sfx.bbVoice(k, {}, 3, 0.32, -4, 0)).toBeUndefined(); // void: audio only, nothing for an AI to read back
      expect(ctx.started.length, k).toBe(s0 + 1); // exactly one source: one take, nothing layered
      const played = of(CUE_OF[k]);
      expect(played.length, k).toBe(1);
      const src = played[0], pan = pannerOf(src)!;
      expect([pan.positionX.value, pan.positionY.value, pan.positionZ.value]).toEqual([3, 0.32, -4]);
      expect([pan.distanceModel, pan.refDistance, pan.rolloffFactor]).toEqual(['inverse', S.ref, S.rolloff]);
      expect(pan.panningModel).toBe('HRTF');
      expect(clipGain(src)).toBeCloseTo(CUE_GAIN[CUE_OF[k]] * S.gain, 9); // the calibrated level, no extra gain stage
      expect(voiceIn(src).gain.value).toBe(1);
      expect(src.playbackRate.value).toBeCloseTo(S.rate, 9);
      expect(src.loop).toBe(false);
      expect(chain(src).length).toBeGreaterThanOrEqual(3); // ... -> panner -> master, plus the reverb send
    }
    // no new AudioContext, no fetch / decode per call, no oscillator
    expect([made.length, Sfx.contextsCreated, ctx.oscillatorCalls]).toEqual([1, contexts, 0]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('small pitch / level spread per call, inside the jitter bounds', async () => {
    const {sfx, ctx, of} = await setup();
    for (const [r, sign] of [[0, -1], [0.999999, 1]] as const) {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      for (const k of KINDS) {
        ctx.currentTime += 10;
        const S = BB_AUDIO[k], n = of(CUE_OF[k]).length;
        sfx.bbVoice(k, {}, 2, 0.3, 0, 0);
        const src = of(CUE_OF[k])[n];
        expect(src.playbackRate.value, k).toBeCloseTo(S.rate * (1 + sign * S.jitter), 4);
        expect(20 * Math.log10(clipGain(src) / CUE_GAIN[CUE_OF[k]]), k).toBeCloseTo(sign * S.gainJitter, 3);
      }
      vi.restoreAllMocks();
    }
  });

  it('each kind is culled past its own range; the giggle is a near sound', async () => {
    const {sfx, ctx} = await setup();
    for (const k of KINDS) {
      ctx.currentTime += 10;
      const s0 = ctx.started.length, culled = sfx.debugState().culled;
      sfx.bbVoice(k, {}, BB_AUDIO[k].maxDist + 1, 1.6, 0, 0);
      expect(ctx.started.length, k).toBe(s0);
      expect(sfx.debugState().culled, k).toBe(culled + 1);
      sfx.bbVoice(k, {}, BB_AUDIO[k].maxDist - 1, 1.6, 0, 0);
      expect(ctx.started.length, k).toBe(s0 + 1);
    }
    expect(BB_AUDIO.giggle.maxDist).toBeLessThan(BB_AUDIO.hurt.maxDist);
    expect(BB_AUDIO.hurt.maxDist).toBeLessThan(BB_AUDIO.cackle.maxDist);
  });

  it('bad coordinates play nothing; a bad gateY falls back to the mouth', async () => {
    const {sfx, ctx} = await setup();
    const s0 = ctx.started.length;
    sfx.bbVoice('cackle', {}, NaN, 0.3, 0, 0);
    sfx.bbVoice('pounce', {}, 0, Infinity, 0, 0);
    expect(ctx.started.length).toBe(s0);
    const asked: number[] = [];
    sfx.setVocalReach({pathTo: (_x, y) => { asked.push(y); return 5; }});
    sfx.bbVoice('cackle', {}, 4, 0.3, 0, NaN);
    expect(ctx.started.length).toBe(s0 + 1);
    expect(asked).toEqual([0.3]);
  });

  it('paused audio or a missing clip stays silent: no stand-in sound, no burst on resume', async () => {
    const {sfx, ctx} = await setup(['rifleShot']);
    for (const k of KINDS) sfx.bbVoice(k, {}, 3, 0.3, 3, 0);
    expect(ctx.started.length).toBe(0);
    expect(ctx.oscillatorCalls).toBe(0);
    expect(sfx.debugState().bank.silentCues.sort()).toEqual([...BB].sort());
    const t = await setup();
    t.sfx.suspend(true); // a menu
    const s0 = t.ctx.started.length, key = {};
    for (const k of KINDS) t.sfx.bbVoice(k, key, 3, 0.3, 3, 0);
    expect(t.ctx.started.length).toBe(s0);
    t.sfx.suspend(false);
    await settle();
    expect(t.ctx.started.length).toBe(s0); // nothing queued up while paused
    t.sfx.bbVoice('cackle', key, 3, 0.3, 3, 0); // ... and the paused calls did not use up the BB's rate limit
    expect(t.of('bbCackle').length).toBe(1);
  });
});

describe('Sfx.bbVoice: the route / storey gates use the floor below the body (gateY)', () => {
  it('cackle and giggle ask the route at gateY + gateLiftM; the panner stays at the real mouth; pounce / hurt / death ask nothing', async () => {
    const {sfx, ctx, of} = await setup();
    const asked: [number, number, number][] = [];
    sfx.setWorld({occlusion: () => 1}); // no line of sight: the route alone decides
    sfx.setVocalReach({pathTo: (x, y, z) => { asked.push([x, y, z]); return 6; }});
    for (const k of KINDS) { ctx.currentTime += 10; sfx.bbVoice(k, {}, 6, 3.28, 2, 0.5); } // a mouth under a 3.6 m ceiling; the floor below at 0.5
    expect(asked).toEqual([[6, 0.5 + BB_AUDIO.gateLiftM, 2], [6, 0.5 + BB_AUDIO.gateLiftM, 2]]);
    for (const k of KINDS) {
      const src = of(CUE_OF[k])[0];
      expect(src, k).toBeTruthy();
      expect(pannerOf(src)!.positionY.value, k).toBe(3.28); // the sound comes from the mouth, not from the floor
    }
    // without a floor height the gates fall back to the mouth
    asked.length = 0;
    ctx.currentTime += 10;
    sfx.bbVoice('giggle', {}, 6, 3.28, 2);
    expect(asked).toEqual([[6, 3.28, 2]]);
  });

  it('a mouth 3 m up over a reachable floor is heard; the same mouth over an unreachable floor is gated (fake route source)', async () => {
    const {sfx, ctx, of} = await setup();
    sfx.setWorld({occlusion: () => 1});
    // the route field as the game's behaves: a floor is found only up to VOCAL_REACH.down under the asked height
    const floorReach = (reachable: boolean): VocalReachQuery => ({pathTo: (_x, y) => (reachable && y >= 0 - VOCAL_REACH.up && y <= VOCAL_REACH.down ? 7 : Infinity)});
    for (const k of ['cackle', 'giggle'] as const) {
      ctx.currentTime += 10;
      const gated = sfx.debugState().vocal.gated;
      sfx.setVocalReach(floorReach(true));
      sfx.bbVoice(k, {}, 7, 3, 0, 0);
      expect(of(CUE_OF[k]).length, k).toBe(1); // heard like a BB on the floor under it
      expect(sfx.debugState().vocal.gated).toBe(gated);
      ctx.currentTime += 10;
      sfx.setVocalReach(floorReach(false));
      sfx.bbVoice(k, {}, 7, 3, 0, 0);
      expect(of(CUE_OF[k]).length, k).toBe(1); // the floor below it cannot be reached: silent
      expect(sfx.debugState().vocal.gated).toBe(gated + 1);
      // ... and this is what gateY is for: asked at the mouth itself (3 m up) the reachable floor would not be found
      ctx.currentTime += 10;
      sfx.setVocalReach(floorReach(true));
      sfx.bbVoice(k, {}, 7, 3, 0);
      expect(of(CUE_OF[k]).length, k).toBe(1);
      expect(sfx.debugState().vocal.gated).toBe(gated + 2);
    }
    // the gated calls did not use up the BB's rate limit (nothing sounded)
    const key = {};
    ctx.currentTime += 10;
    sfx.setVocalReach(floorReach(false));
    sfx.bbVoice('cackle', key, 7, 3, 0, 0);
    sfx.setVocalReach(floorReach(true));
    sfx.bbVoice('cackle', key, 7, 3, 0, 0);
    expect(of('bbCackle').length).toBe(2);
  });

  it('on the REAL route field: a ceiling crawler in the player\'s hall is heard, one over a sealed room is not', async () => {
    // one storey (floor 0, ceiling 3.6 m): the hall x 1..25 m the player stands in, and a room x 27..39 m behind a wall with no doorway
    const g = new Grid(80, 16);
    for (const [x0, x1] of [[2, 49], [54, 77]]) for (let y = 2; y <= 13; y++) for (let x = x0; x <= x1; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 3.6; }
    const reach = new VocalReach(g);
    reach.update(1, 20, 0, 4);
    for (let n = 0; reach.building && n < 5000; n++) reach.update(1 / 60, 20, 0, 4);
    const mouthY = 3.6 - BB_VOICE_Y; // hanging under the ceiling
    expect(reach.pathTo(12, 0 + BB_AUDIO.gateLiftM, 4)).toBeLessThan(10); // the floor below the hall crawler: 8 m of route
    expect(reach.pathTo(12, mouthY, 4)).toBe(Infinity); // its mouth is more than VOCAL_REACH.down above that floor
    expect(mouthY).toBeGreaterThan(VOCAL_REACH.down);
    expect(reach.pathTo(30, 0 + BB_AUDIO.gateLiftM, 4)).toBe(Infinity); // the sealed room's floor
    const {sfx, ctx, of} = await setup();
    sfx.setListener(20, 1.6, 4, 0);
    sfx.setWorld({occlusion: () => 1}); // (no sight rule: the route gate alone)
    sfx.setVocalReach(reach);
    for (const k of ['cackle', 'giggle'] as const) {
      ctx.currentTime += 10;
      sfx.bbVoice(k, {}, 12, mouthY, 4, 0);
      expect(of(CUE_OF[k]).length, k).toBe(1);
      expect(pannerOf(of(CUE_OF[k])[0])!.positionY.value).toBe(mouthY);
      ctx.currentTime += 10;
      sfx.bbVoice(k, {}, 30, mouthY, 4, 0); // 10 m away through the wall: no route
      expect(of(CUE_OF[k]).length, k).toBe(1);
    }
    // the combat cues are never route-gated: the sealed-room BB's squeal / squawk / death are heard (muffled by the wall)
    for (const k of ['pounce', 'hurt', 'death'] as const) { ctx.currentTime += 10; sfx.bbVoice(k, {}, 30, mouthY, 4, 0); expect(of(CUE_OF[k]).length, k).toBe(1); }
  });

  it('the cackle follows the route law: a detour lowers it, another storey without a route silences it, clear sight keeps it', async () => {
    const {sfx, ctx, of} = await setup();
    steady();
    const C = BB_AUDIO.cackle;
    // through a doorway: occluded line, a short route — present (the occlusion is capped: muffled and lowered, never silenced)
    sfx.setWorld({occlusion: () => 1});
    sfx.setVocalReach(reachAll(10));
    sfx.bbVoice('cackle', {}, 10, 0.3, 0, 0);
    const near = of('bbCackle')[0];
    const straight = Math.hypot(10, 1.6 - 0.3);
    expect(voiceIn(near).gain.value).toBeCloseTo(1 - 0.45 * C.occMax, 9); // the route is as long as the line: no route loss
    const lp = lowpassOf(near)!;
    expect(lp.frequency.value).toBeCloseTo((17000 / (1 + straight * 0.04)) * (0.08 + 0.92 * (1 - C.occMax)), 6);
    expect(lp.frequency.value).toBeGreaterThan(2 * 780); // the cackle's pitched syllables (520-780 Hz) stay under the muffled cutoff
    // a long way round (30 m of route for 10 m of line): lowered by the route law
    ctx.currentTime += 10;
    sfx.setVocalReach(reachAll(30));
    sfx.bbVoice('cackle', {}, 10, 0.3, 0, 0);
    const detour = vocalGain(30, straight, VOCAL_GATE.alert.limit, VOCAL_GATE.alert.fade, C.ref, C.rolloff);
    expect(detour).toBeLessThan(0.5);
    expect(voiceIn(of('bbCackle')[1]).gain.value).toBeCloseTo(detour * (1 - 0.45 * C.occMax), 9);
    // another storey with no route in range: silent
    ctx.currentTime += 10;
    sfx.setVocalReach(unreachable);
    const gated = sfx.debugState().vocal.gated;
    sfx.bbVoice('cackle', {}, 2, 4.7, 0, 4.4);
    sfx.bbVoice('giggle', {}, 2, 4.7, 0, 4.4);
    expect([of('bbCackle').length, of('bbGiggle').length]).toEqual([2, 0]);
    expect(sfx.debugState().vocal.gated).toBe(gated + 2);
    // in clear sight (an open void between): heard by the straight line
    ctx.currentTime += 10;
    sfx.setWorld({occlusion: () => 0});
    sfx.bbVoice('cackle', {}, 12, 0.3, 0, 0);
    expect(of('bbCackle').length).toBe(3);
    expect(voiceIn(of('bbCackle')[2]).gain.value).toBe(1);
  });

  it('pounce / hurt / death are combat cues: never route-gated, never counted against the vocal cap', async () => {
    const {sfx, ctx, of} = await setup();
    sfx.setWorld({occlusion: () => 1});
    sfx.setVocalReach(unreachable);
    for (const k of ['pounce', 'hurt', 'death'] as const) { ctx.currentTime += 10; sfx.bbVoice(k, {}, 3, 0.3, 0, 0); }
    expect([of('bbPounce').length, of('bbHurt').length, of('bbDeath').length]).toEqual([1, 1, 1]);
    expect(sfx.debugState().vocal.played).toBe(0);
    expect(sfx.debugState().vocal.voices).toBe(0);
  });
});

describe('Sfx.bbVoice: bounded', () => {
  it('the cackle is NOT thinned by the vocal cap that thins groans and takes no vocal slot; the giggle is an idle vocal', async () => {
    const {sfx, of} = await setup();
    for (let i = 0; i < VOCAL_GATE.cap; i++) sfx.groan(2 + i * 0.2, 1.6, 0, false); // three groaning zombies right beside the player
    expect(sfx.debugState().vocal.voices).toBe(VOCAL_GATE.cap);
    sfx.bbVoice('giggle', {}, 10, 0.3, 0, 0); // the giggle is capped like a groan
    expect(of('bbGiggle').length).toBe(0);
    expect(sfx.debugState().vocal.capped).toBe(1);
    sfx.bbVoice('cackle', {}, 10, 0.3, 0, 0); // the tell is not
    expect(of('bbCackle').length).toBe(1);
    expect(sfx.debugState().vocal.voices).toBe(VOCAL_GATE.cap); // ... and it takes no slot from the groans
    expect(sfx.debugState().vocal.capped).toBe(1);
  });

  it('cackle and pounce squeal are never dropped by the shared voice cap (pri 2); giggle / hurt / death can be', async () => {
    const {sfx, of} = await setup();
    for (let i = 0; i < 60; i++) sfx.pickup(); // fill the 44-voice cap
    expect(sfx.debugState().voices).toBeGreaterThanOrEqual(44);
    for (const k of ['giggle', 'hurt', 'death'] as const) sfx.bbVoice(k, {}, 5, 0.3, 0, 0);
    expect([of('bbGiggle').length, of('bbHurt').length, of('bbDeath').length]).toEqual([0, 0, 0]);
    sfx.bbVoice('cackle', {}, 5, 0.3, 0, 0);
    sfx.bbVoice('pounce', {}, 3, 0.3, 0, 0);
    expect([of('bbCackle').length, of('bbPounce').length]).toEqual([1, 1]);
  });

  it('per BB at most one cue of a kind per minGapS, independently per kind and per BB', async () => {
    const {sfx, ctx} = await setup();
    for (const k of KINDS) {
      ctx.currentTime += 20;
      const a = {}, b = {}, gap = BB_AUDIO[k].minGapS, t0 = ctx.currentTime, s0 = ctx.started.length, dropped = sfx.debugState().dropped;
      sfx.bbVoice(k, a, 4, 0.3, 0, 0);
      expect(ctx.started.length, k).toBe(s0 + 1);
      ctx.currentTime = t0 + gap * 0.9; // (past the 0.47 s fake clip for every kind but the hurt squawk)
      sfx.bbVoice(k, a, 4, 0.3, 0, 0); // too soon for this BB
      expect(ctx.started.length, k).toBe(s0 + 1);
      expect(sfx.debugState().dropped, k).toBe(dropped + 1);
      sfx.bbVoice(k, b, -4, 0.3, 0, 0); // another BB is not limited by it
      expect(ctx.started.length, k).toBe(s0 + 2);
      ctx.currentTime = t0 + gap + 0.5;
      sfx.bbVoice(k, a, 4, 0.3, 0, 0);
      expect(ctx.started.length, k).toBe(s0 + 3);
    }
    // the brain's own cadence always passes: a cackle every cackleGapS
    ctx.currentTime += 20;
    const key = {}, s0 = ctx.started.length;
    for (let i = 0; i < 3; i++) { sfx.bbVoice('cackle', key, 4, 0.3, 0, 0); ctx.currentTime += BB_SENSE.cackleGapS; }
    expect(ctx.started.length).toBe(s0 + 3);
    // the kinds do not limit each other: a hurt squawk right after a cackle plays
    ctx.currentTime += 20;
    const k2 = {}, s1 = ctx.started.length;
    sfx.bbVoice('cackle', k2, 4, 0.3, 0, 0);
    sfx.bbVoice('hurt', k2, 4, 0.3, 0, 0);
    expect(ctx.started.length).toBe(s1 + 2);
  });

  it('at most `max` of a kind sound at once (a pack never stacks into a wall of sound)', async () => {
    const {sfx, ctx} = await setup();
    for (const k of KINDS) {
      ctx.currentTime += 20;
      const s0 = ctx.started.length, max = BB_AUDIO[k].max;
      for (let i = 0; i < max + 4; i++) sfx.bbVoice(k, {}, 3 + i * 0.5, 0.3, 0, 0); // a pack, each a little farther
      expect(ctx.started.length, k).toBe(s0 + max);
    }
  });

  it('cackles: the nearest win (the farthest gives way, a farther new one is dropped); a gated newcomer takes nothing', async () => {
    const {sfx, of} = await setup();
    const max = BB_AUDIO.cackle.max;
    expect(max).toBe(2);
    sfx.bbVoice('cackle', {}, 10, 0.3, 0, 0);
    sfx.bbVoice('cackle', {}, 20, 0.3, 0, 0);
    sfx.bbVoice('cackle', {}, 30, 0.3, 0, 0); // a farther one: dropped
    expect(of('bbCackle').length).toBe(max);
    // a nearer one that the route gate silences must not cut a sounding cackle
    sfx.setWorld({occlusion: () => 1});
    sfx.setVocalReach(unreachable);
    sfx.bbVoice('cackle', {}, 4, 0.3, 0, 0);
    expect(of('bbCackle').map(s => voiceIn(s).gain.value)).toEqual([1, 1]);
    expect(of('bbCackle').length).toBe(max);
    sfx.setWorld({occlusion: null});
    sfx.setVocalReach(null);
    sfx.bbVoice('cackle', {}, 4, 0.3, 0, 0); // a nearer one: the farthest sounding cackle fades for it
    const all = of('bbCackle');
    expect(all.length).toBe(max + 1);
    expect(all.map(s => voiceIn(s).gain.value)).toEqual([1, 0, 1]);
    expect(all.map(s => pannerOf(s)!.positionX.value)).toEqual([10, 20, 4]);
    sfx.bbVoice('cackle', {}, 3, 0.3, 0, 0); // and again at once: the fading one no longer counts, the next farthest gives way
    expect(of('bbCackle').map(s => voiceIn(s).gain.value)).toEqual([0, 0, 1, 1]);
    expect(of('bbCackle').filter(s => voiceIn(s).gain.value > 0).length).toBe(max); // never more than `max` at full level
  });
});

describe('Sfx.bbVoice: one throat', () => {
  it('no giggle under its own sounding cackle / squeal; another BB giggles on; the dropped giggle keeps its turn', async () => {
    const {sfx, ctx, of} = await setup();
    const a = {}, b = {};
    ctx.currentTime = 50;
    sfx.bbVoice('cackle', a, 5, 0.3, 0, 0);
    ctx.currentTime += 0.1;
    sfx.bbVoice('giggle', a, 5, 0.3, 0, 0); // still cackling
    expect(of('bbGiggle').length).toBe(0);
    sfx.bbVoice('giggle', b, -5, 0.3, 0, 0); // another BB
    expect(of('bbGiggle').length).toBe(1);
    ctx.currentTime += 1; // the cackle ended (the dropped giggle did not use up the rate limit)
    sfx.bbVoice('giggle', a, 5, 0.3, 0, 0);
    expect(of('bbGiggle').length).toBe(2);
    ctx.currentTime += 10;
    sfx.bbVoice('pounce', a, 3, 0.3, 0, 0);
    ctx.currentTime += 0.1;
    sfx.bbVoice('giggle', a, 3, 0.3, 0, 0); // squealing
    expect(of('bbGiggle').length).toBe(2);
  });

  it('the pounce squeal takes the throat: its own cackle fades under it, and no cackle starts under its own squeal', async () => {
    const {sfx, ctx, of} = await setup();
    const a = {}, b = {};
    ctx.currentTime = 50;
    sfx.bbVoice('cackle', a, 3, 0.3, 0, 0);
    sfx.bbVoice('cackle', b, -3, 0.3, 0, 0);
    ctx.currentTime += 0.2;
    sfx.bbVoice('pounce', a, 3, 0.3, 0, 0); // it noticed the player close by and winds up at once
    const [ca, cb] = of('bbCackle');
    expect(of('bbPounce').length).toBe(1);
    expect([voiceIn(ca).gain.value, voiceIn(cb).gain.value]).toEqual([0, 1]); // (the other BB's cackle is not touched)
    expect(voiceIn(of('bbPounce')[0]).gain.value).toBe(1);
    // a BB that squeals does not start a cackle under it; once the squeal is over it may (the dropped one kept its turn)
    const c = {};
    ctx.currentTime += 10;
    sfx.bbVoice('pounce', c, 3, 0.3, 0, 0);
    ctx.currentTime += 0.1;
    sfx.bbVoice('cackle', c, 3, 0.3, 0, 0);
    expect(of('bbCackle').length).toBe(2);
    ctx.currentTime += 0.6;
    sfx.bbVoice('cackle', c, 3, 0.3, 0, 0);
    expect(of('bbCackle').length).toBe(3);
  });

  it('a dying BB stops what it was still voicing; the hurt squawk cuts nothing', async () => {
    const {sfx, ctx, of} = await setup();
    const a = {};
    ctx.currentTime = 50;
    sfx.bbVoice('cackle', a, 5, 0.3, 0, 0);
    ctx.currentTime += 0.1;
    sfx.bbVoice('hurt', a, 5, 0.3, 0, 0); // shot while cackling: it squawks over its own laugh
    const [cackle, squawk] = [of('bbCackle')[0], of('bbHurt')[0]];
    expect([voiceIn(cackle).gain.value, voiceIn(squawk).gain.value]).toEqual([1, 1]);
    ctx.currentTime += 0.1;
    sfx.bbVoice('death', a, 5, 0.2, 0, 0); // killed: the death plays, the cackle and the squawk fade
    expect(of('bbDeath').length).toBe(1);
    expect([voiceIn(cackle).gain.value, voiceIn(squawk).gain.value, voiceIn(of('bbDeath')[0]).gain.value]).toEqual([0, 0, 1]);
    // (an earlier, finished voice of another BB is not touched; a second death of the same BB inside minGapS is dropped)
    sfx.bbVoice('death', a, 5, 0.2, 0, 0);
    expect(of('bbDeath').length).toBe(1);
  });
});

describe('BB audio is audio only', () => {
  const sfxSrc = fs.readFileSync(path.join(GAME, 'src/audio/sfx.ts'), 'utf8');
  const a = sfxSrc.indexOf('  bbVoice(kind: BbVoiceKind'), b = sfxSrc.indexOf('// Task studio-market-bar-20261108-225231-01 (lane AUDIO): the MARKET set', a);
  const section = sfxSrc.slice(a, b);

  it('Sfx has no way back into the AI: no new import from ai/, no event or handler out of the BB section; the contract signature, exactly', () => {
    expect([...sfxSrc.matchAll(/from '\.\.\/ai\/([^']+)'/g)].map(m => m[1])).toEqual(['vocalReach']); // (the existing vocal-route gate only)
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(section).toContain('private bbThroat(');
    expect(section).not.toMatch(/dispatchEvent|emit\(|onCackle|onHeard|noise|callback|listener\(|=> void\)/i);
    expect(sfxSrc).toContain('  bbVoice(kind: BbVoiceKind, key: object, x: number, y: number, z: number, gateY?: number): void {');
    expect(sfxSrc).toContain("export type BbVoiceKind = 'cackle' | 'giggle' | 'pounce' | 'hurt' | 'death';");
  });

  it('no loop, no per-call decode, no timer and no synthesis in the BB section', () => {
    expect(section).not.toMatch(/\.loop\b|decodeAudioData|fetch\(|new AudioContext|createBufferSource|createOscillator|setInterval|setTimeout/);
  });
});
