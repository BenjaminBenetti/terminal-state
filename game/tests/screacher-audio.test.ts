// Task studio-screacher-production-20261110-221858-01 (lane AUDIO): the headless Screacher's voice — its echolocation scream (the audible
// tell of every echo pulse), the frenzy shriek (also the hurt yelp, quieter / higher), the idle wheeze and the death gurgle: registration,
// the shipped Sound Lab derivatives + hash-only provenance + mix calibration, and the Sfx behaviour (world-positioned voices, the scream
// outside the vocal cap / route gate and the shared voice cap, per-Screacher rate limits, bounded voices, no loop) on a fake Web Audio
// graph. The clips were NOT listened to (structural QC only): nothing here says how they sound.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {VOCAL_GATE, inverseGain} from '../src/ai/vocalReach';
import {CLIP_MANIFEST, CUES, type CueId} from '../src/audio/bank';
import {CLIP_BYTES_SCREACHER, CLIP_GAPS_SCREACHER, CLIP_MANIFEST_SCREACHER, SCREACHER_CUES, SCREACHER_CUE_GAIN} from '../src/audio/manifest.screacher.generated';
import {CUE_GAIN, HIT_CONFIRM, SCREACHER_AUDIO, Sfx, TRACK1_VOICE, type VocalReachQuery} from '../src/audio/sfx';
import {FakeCtx, fakeBank, type Node, type Panner, type Src} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const pub = (p: string) => path.join(GAME, 'public', p);
const settle = () => new Promise(r => setTimeout(r, 40));
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const SCR = ['screacherScream', 'screacherShriek', 'screacherWheeze', 'screacherDeath'] as const;
const KINDS = ['scream', 'shriek', 'hurt', 'wheeze', 'death'] as const;

interface Source { clip: string; jobId: string; seed: number; seconds: number; steps: number; cfg: number; rawSha256: string; rawBytes: number; labSidecarSha256: string; promptSha256: string }
interface Deriv {
  cue: string; url: string; bytes: number; sha256: string; dur: number; window: {startS: number; endS: number}; ops: string[];
  gate: {kind: string; pass: boolean; failed: string[]; timeToWithin6DbS: number; levelSpread20msDb: number};
  metrics: {durationS: number; peakDbfs: number; clippedFrac: number; loudness: {momentaryMaxLufs: number}; spectral: {centroidHz: number; flatness: number}; pitch: {voicedFrac: number}};
  source: Source;
}
interface Mix { basis: string; targetLufs: number; measuredLufs: number; cueGain: number; atSourceLufs: number; atSourcePeakDbfs: number; variants: number }
const provText = fs.readFileSync(pub('assets/derivatives/audio-screacher.json'), 'utf8');
const prov = JSON.parse(provText) as {
  asset: string; task: string; lane: string; soundLab: {allowance: number; jobs: number; accepted: number; rejected: number; unusedClosed: number; paidOrExternal: number};
  license: {status: string; review: string; gameReady: boolean; approved: boolean}; design: Record<string, string>;
  mixCalibration: {references: Record<string, number>; cues: Record<string, Mix>; hurt: {takesOf: string; callGain: number; rate: number; atSourceLufs: number}};
  derivatives: Deriv[]; rejectedRaws: (Source & {cue: string; reason: string})[];
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

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Screacher cues: registration + shipped Sound Lab derivatives', () => {
  it('the four cues are in the bank (CUES, CUE_GAIN, merged manifest) with their takes and no silent gap', () => {
    expect(SCREACHER_CUES).toEqual(SCR);
    for (const c of SCR) {
      expect(CUES).toContain(c);
      expect(CLIP_MANIFEST[c]).toBe(CLIP_MANIFEST_SCREACHER[c]);
      expect(CUE_GAIN[c]).toBeGreaterThan(0);
      expect(CUE_GAIN[c]).toBeLessThanOrEqual(1);
    }
    expect(Object.keys(CLIP_MANIFEST_SCREACHER)).toEqual([...SCR]);
    expect(CLIP_GAPS_SCREACHER).toEqual([]);
    // the brief's takes: the echo scream 3, the shriek 2, the wheeze 2-3, the death gurgle 1-2
    expect(Object.fromEntries(SCR.map(c => [c, CLIP_MANIFEST_SCREACHER[c].length]))).toEqual({screacherScream: 3, screacherShriek: 2, screacherWheeze: 3, screacherDeath: 1});
    expect(CLIP_MANIFEST_SCREACHER.screacherScream.map(r => r.url)).toEqual([1, 2, 3].map(i => `assets/audio/screacher-scream-0${i}.mp3`));
  });

  it('clips are bundled relative MP3s matching their provenance (hash, bytes) and the public-input allowlist, inside the cue length bands', () => {
    const allow = new Map((JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    const band: Record<string, [number, number]> = {screacherScream: [1.4, 1.9], screacherShriek: [0.5, 0.9], screacherWheeze: [0.8, 1.6], screacherDeath: [1.0, 1.8]};
    let bytes = 0;
    for (const c of SCR) for (const r of CLIP_MANIFEST_SCREACHER[c]) {
      expect(r.url).toMatch(/^assets\/audio\/screacher-[a-z0-9-]+\.mp3$/);
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
    expect(bytes).toBe(CLIP_BYTES_SCREACHER);
    expect(bytes).toBeLessThan(220 * 1024);
    expect(prov.derivatives.length).toBe(SCR.reduce((s, c) => s + CLIP_MANIFEST_SCREACHER[c].length, 0));
    // the release allowlist names exactly this set's clips (no stray screacher-* audio), its record and the notice it edited
    expect([...allow.keys()].filter(k => /^assets\/audio\/screacher-/.test(k)).sort()).toEqual(prov.derivatives.map(d => d.url).sort());
    for (const rel of ['assets/derivatives/audio-screacher.json', 'assets/audio/NOTICE.md']) {
      const b = fs.readFileSync(pub(rel));
      expect(allow.get(rel), rel).toEqual({path: rel, bytes: b.length, sha256: sha(b)});
    }
    const notice = fs.readFileSync(pub('assets/audio/NOTICE.md'), 'utf8');
    expect(notice).toContain('screacher-*.mp3');
    expect(notice).toContain('../derivatives/audio-screacher.json');
    expect(notice).toMatch(/Powered by Stability AI/);
    expect(notice).toMatch(/conditional prototype status, not production or commercial clearance/);
    // the credits: one marked block that lists every clip with its Sound Lab job
    const credits = fs.readFileSync(pub('assets/CREDITS.md'), 'utf8');
    const block = credits.slice(credits.indexOf('<!-- BEGIN screacher-audio-20261110'), credits.indexOf('<!-- END screacher-audio-20261110 -->'));
    expect(block).toMatch(/Powered by Stability AI/);
    expect(block).toMatch(/Not\s+reviewed by ear/);
    for (const d of prov.derivatives) expect(block).toContain(`- \`${d.url}\` — ${d.cue} (Sound Lab job ${d.source.jobId})`);
    expect(credits.split('<!-- BEGIN screacher-audio-20261110').length).toBe(2); // exactly one block (the builder rewrites it in place)
  });

  it('provenance is hash-only, inside the 12-job local allowance, and says NOT LISTENED TO', () => {
    expect(prov.asset).toBe('audio-screacher-20261110');
    expect(prov.task).toBe('studio-screacher-production-20261110-221858-01');
    // the allowance: one counter, at most 12 local jobs including retries; the unused ones closed; nothing paid or external
    const S = prov.soundLab;
    expect(S.allowance).toBe(12);
    expect(S.jobs).toBeLessThanOrEqual(12);
    expect(S.accepted + S.rejected).toBe(S.jobs);
    expect(S.unusedClosed).toBe(S.allowance - S.jobs);
    expect(S.paidOrExternal).toBe(0);
    const used = new Set(prov.derivatives.map(d => d.source.jobId)), thrown = new Set(prov.rejectedRaws.map(r => r.jobId));
    expect(used.size).toBe(S.accepted);
    expect(thrown.size).toBe(S.rejected);
    expect([...used].filter(j => thrown.has(j))).toEqual([]);
    for (const r of prov.rejectedRaws) expect(r.reason.length).toBeGreaterThan(40); // every unused take says why (a structural reason)
    // hash-only: job id, seed, request numbers and SHA-256s — no prompt text, no private path, no raw file name, no URL
    for (const s of [...prov.derivatives.map(d => d.source), ...prov.rejectedRaws]) {
      expect(s.jobId).toMatch(/^20261110T\d{6}-\d+$/);
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
    const kind: Record<string, string> = {screacherScream: 'scream', screacherShriek: 'shriek', screacherWheeze: 'wheeze', screacherDeath: 'death'};
    for (const d of prov.derivatives) {
      expect(d.gate.kind).toBe(kind[d.cue]);
      expect(d.gate.pass, d.url).toBe(true);
      expect(d.metrics.peakDbfs).toBeLessThanOrEqual(-0.9);
      expect(d.metrics.clippedFrac).toBe(0);
      expect(d.ops[d.ops.length - 1]).toMatch(/^mp3 mono (96|128) kbps$/);
    }
    // the echo scream: a hard onset (loud inside 0.1 s), pitched and rough; the wheeze: an unvoiced rattle
    for (const d of prov.derivatives.filter(x => x.cue === 'screacherScream')) {
      expect(d.gate.timeToWithin6DbS).toBeLessThanOrEqual(0.1);
      expect(d.metrics.pitch.voicedFrac).toBeGreaterThanOrEqual(0.2);
      expect(d.metrics.spectral.centroidHz).toBeGreaterThanOrEqual(1200);
    }
    for (const d of prov.derivatives.filter(x => x.cue === 'screacherWheeze')) {
      expect(d.metrics.pitch.voicedFrac).toBeLessThanOrEqual(0.3);
      expect(d.gate.levelSpread20msDb).toBeGreaterThanOrEqual(3);
    }
  });

  it('the builder edits generated clips only: no network, no process spawning, no synthesis', () => {
    const src = fs.readFileSync(path.join(ROOT, 'tools/audio-pipeline/screacher-build.mjs'), 'utf8');
    expect(src).not.toMatch(/\bfetch\(|node:https?|node:net|node:child_process|api\/generate|Math\.random|Math\.sin\(/);
  });

  it('mix: CUE_GAIN = the build\'s calibration; the scream at the Siren\'s level, the wheeze soft, never above the -1 dBFS ceiling', () => {
    const m = prov.mixCalibration.cues, ref = prov.mixCalibration.references;
    for (const c of SCR) {
      expect(m[c].cueGain, c).toBe(CUE_GAIN[c]);
      expect(SCREACHER_CUE_GAIN[c], c).toBe(CUE_GAIN[c]);
      expect(m[c].variants).toBe(CLIP_MANIFEST_SCREACHER[c].length);
      expect(m[c].atSourcePeakDbfs).toBeLessThanOrEqual(-1);
    }
    expect(Math.abs(m.screacherScream.atSourceLufs - ref.sirenScream)).toBeLessThanOrEqual(0.3); // about as loud at the source as the Siren's wake scream
    expect(m.screacherScream.atSourceLufs).toBeGreaterThan(ref.zombieGroan + 2); // ... so the loudest of its cues, well over a groan
    expect(m.screacherShriek.atSourceLufs).toBeLessThan(m.screacherScream.atSourceLufs);
    expect(m.screacherWheeze.atSourceLufs).toBeLessThanOrEqual(ref.zombieGroan - 4); // under a zombie groan
    expect(m.screacherDeath.atSourceLufs).toBeLessThan(ref.zombieDeath);
    // the hurt yelp: the shriek takes, quieter and higher (the builder's record mirrors the Sfx spec)
    const h = prov.mixCalibration.hurt;
    expect([h.takesOf, h.callGain, h.rate]).toEqual(['screacherShriek', SCREACHER_AUDIO.hurt.gain, SCREACHER_AUDIO.hurt.rate]);
    expect(SCREACHER_AUDIO.hurt.gain).toBeLessThan(1);
    expect(SCREACHER_AUDIO.hurt.rate).toBeGreaterThan(1);
    // the ceiling holds for every call: peak at the source x call gain x the largest gain jitter
    for (const k of KINDS) {
      const s = SCREACHER_AUDIO[k], peak = m[s.cue].atSourcePeakDbfs + 20 * Math.log10(s.gain) + s.gainJitter;
      expect(peak, k).toBeLessThanOrEqual(-1 + 1e-9);
    }
    // range by the panner law (dry level): the scream at 45 m is over a zombie groan at its own 34 m limit; the wheeze is quiet by 12 m
    const at = (lufs: number, d: number, s: {ref: number; rolloff: number}) => lufs + 20 * Math.log10(inverseGain(d, s.ref, s.rolloff));
    const groanFar = at(ref.zombieGroan, 34, {ref: 2.2, rolloff: 1.1});
    expect(at(m.screacherScream.atSourceLufs, 45, SCREACHER_AUDIO.scream)).toBeGreaterThan(groanFar + 3);
    expect(at(m.screacherScream.atSourceLufs, 45, SCREACHER_AUDIO.scream)).toBeGreaterThan(at(ref.sirenScream, 44, TRACK1_VOICE.scream)); // carries farther than the Siren's
    expect(at(m.screacherWheeze.atSourceLufs, 12, SCREACHER_AUDIO.wheeze)).toBeLessThan(groanFar);
    expect(SCREACHER_AUDIO.scream.maxDist).toBeGreaterThanOrEqual(45);
    expect(SCREACHER_AUDIO.shriek.maxDist).toBeGreaterThanOrEqual(30);
    expect(SCREACHER_AUDIO.wheeze.maxDist).toBeGreaterThanOrEqual(12);
    expect(SCREACHER_AUDIO.wheeze.maxDist).toBeLessThanOrEqual(14);
  });

  it('nothing else in the bank moved: every other cue id and mix gain is pinned', () => {
    // (task studio-corpse-chipper-fuel-20261110-235304-01: the train chipper's five cues are a second, separately pinned addition —
    // tests/chipper-audio.test.ts / audio-bank.test.ts; excluded here so the pins below still prove nothing ELSE moved)
    const CHIP = ['chipperMotor', 'chipperGrind', 'chipperFeed', 'chipperStart', 'chipperStop'];
    expect(CHIP.map(c => [CUES.includes(c as never), CUE_GAIN[c as keyof typeof CUE_GAIN]])).toEqual([[true, 0.42], [true, 0.52], [true, 0.6], [true, 0.27], [true, 0.32]]);
    // (task studio-bb-production-20261112-234540-01, lane AUDIO: BB's five voice cues are a third, separately pinned addition —
    // tests/bb-audio.test.ts / audio-bank.test.ts; excluded the same way)
    const BB = ['bbCackle', 'bbGiggle', 'bbPounce', 'bbHurt', 'bbDeath'];
    expect(BB.map(c => [CUES.includes(c as never), CUE_GAIN[c as keyof typeof CUE_GAIN]])).toEqual([[true, 0.81], [true, 0.41], [true, 0.53], [true, 0.45], [true, 0.91]]);
    const others = CUES.filter(c => !(SCR as readonly string[]).includes(c) && !CHIP.includes(c) && !BB.includes(c));
    expect(CUES.length).toBe(others.length + 4 + CHIP.length + BB.length);
    expect(Object.keys(CUE_GAIN).sort()).toEqual([...CUES].sort());
    expect(others.length).toBe(161);
    expect(sha(JSON.stringify(others))).toBe('3d4982c30a801d4287f78f2f519ffe942425d7ae775e9f90e1702dfcfa6bd521');
    expect(sha(JSON.stringify(others.map(c => [c, CUE_GAIN[c]])))).toBe('25eb2bac2c7ee959b1e8a256c877ac406214a1b7c4e1b1c228dad38a7c15314a');
    // spot values of the neighbours (the head-hit levels, the Siren, the zombies, the guns)
    expect([CUE_GAIN.headHit, HIT_CONFIRM.level, HIT_CONFIRM.headLevel]).toEqual([0.5, 0.65, 0.6]);
    expect([CUE_GAIN.sirenScream, CUE_GAIN.sirenHum, CUE_GAIN.zombieGroan, CUE_GAIN.zombieDeath, CUE_GAIN.zombieAttack]).toEqual([0.9, 0.3, 0.55, 0.6, 0.6]);
    expect([CUE_GAIN.rifleShot, CUE_GAIN.shotgunShot, CUE_GAIN.pistolShot]).toEqual([1, 1, 1]);
    expect(VOCAL_GATE.cap).toBe(3);
  });
});

describe('Sfx.screacherScream: the echolocation tell', () => {
  it('has the contract signatures; plays the scream cue at the given position on a positional voice, once, never looped', async () => {
    const {sfx, ctx, of, made} = await setup();
    expect([sfx.screacherScream.length, sfx.screacherVoice.length]).toEqual([4, 5]);
    steady();
    vi.stubGlobal('fetch', vi.fn());
    const contexts = Sfx.contextsCreated, s0 = ctx.started.length;
    expect(sfx.screacherScream({}, 12, 1.75, -9)).toBeUndefined(); // void: audio only, nothing for an AI to read back
    const played = of('screacherScream');
    expect(played.length).toBe(1);
    expect(ctx.started.length).toBe(s0 + 1); // exactly one source: one take of the scream cue, nothing layered
    const src = played[0], pan = pannerOf(src)!;
    expect(pan).toBeTruthy();
    expect([pan.positionX.value, pan.positionY.value, pan.positionZ.value]).toEqual([12, 1.75, -9]);
    expect([pan.distanceModel, pan.refDistance, pan.rolloffFactor]).toEqual(['inverse', SCREACHER_AUDIO.scream.ref, SCREACHER_AUDIO.scream.rolloff]);
    expect(pan.panningModel).toBe('HRTF');
    expect(clipGain(src)).toBeCloseTo(CUE_GAIN.screacherScream, 9); // the calibrated level, no extra gain stage
    expect(voiceIn(src).gain.value).toBe(1);
    expect(src.playbackRate.value).toBeCloseTo(1, 9);
    expect(src.loop).toBe(false);
    expect(chain(src).length).toBeGreaterThanOrEqual(3); // ... -> panner -> master, plus the reverb send
    // no new AudioContext, no fetch / decode per call, no oscillator
    expect([made.length, Sfx.contextsCreated, ctx.oscillatorCalls]).toEqual([1, contexts, 0]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is NOT silenced by the idle-vocal cap that thins groans, nor by the navigable-route gate; the wheeze follows both', async () => {
    const {sfx, ctx, of} = await setup();
    for (let i = 0; i < VOCAL_GATE.cap; i++) sfx.groan(2 + i * 0.2, 1.6, 0, false); // three groaning zombies right beside the player
    expect(sfx.debugState().vocal.voices).toBe(VOCAL_GATE.cap);
    sfx.groan(10, 1.6, 0, false); // a fourth, farther: the cap drops it
    expect(sfx.debugState().vocal.capped).toBe(1);
    sfx.screacherVoice('wheeze', {}, 10, 1.7, 0); // the wheeze is an idle vocal: capped like the groan
    expect(of('screacherWheeze').length).toBe(0);
    expect(sfx.debugState().vocal.capped).toBe(2);
    sfx.screacherScream({}, 10, 1.7, 0); // the scream is not
    expect(of('screacherScream').length).toBe(1);
    expect(sfx.debugState().vocal.voices).toBe(VOCAL_GATE.cap); // ... and it takes no vocal slot from the groans
    // the route gate: behind a wall with no navigable route a groan and a wheeze are silent; the scream is still heard
    ctx.currentTime += 5;
    const unreachable: VocalReachQuery = {pathTo: () => Infinity};
    sfx.setWorld({occlusion: () => 1});
    sfx.setVocalReach(unreachable);
    const gated = sfx.debugState().vocal.gated;
    sfx.groan(8, 1.6, 0, false);
    sfx.screacherVoice('wheeze', {}, 8, 1.7, 0);
    expect(sfx.debugState().vocal.gated).toBe(gated + 2);
    expect(of('screacherWheeze').length).toBe(0);
    sfx.screacherScream({}, 8, 1.7, 0);
    expect(of('screacherScream').length).toBe(2);
  });

  it('stays present round a corner: the occlusion is capped (muffled, lowered, never silenced)', async () => {
    const {sfx, of} = await setup();
    steady();
    sfx.setWorld({occlusion: () => 1}); // fully blocked line
    sfx.screacherScream({}, 20, 1.6, 0);
    const src = of('screacherScream')[0], occ = SCREACHER_AUDIO.scream.occMax;
    expect(occ).toBeLessThan(1);
    expect(voiceIn(src).gain.value).toBeCloseTo(1 - 0.45 * occ, 9); // -3.6 dB, not the full -5.2
    const lp = lowpassOf(src)!;
    expect(lp.frequency.value).toBeCloseTo((17000 / (1 + 20 * 0.04)) * (0.08 + 0.92 * (1 - occ)), 6);
    expect(lp.frequency.value).toBeGreaterThan(2 * 1339); // the scream's dominant partial (1.34 kHz) stays under the muffled cutoff
    expect(pannerOf(src)).toBeTruthy();
  });

  it('is heard from far in the open (45 m) and culled past its range', async () => {
    const {sfx, of} = await setup();
    sfx.screacherScream({}, 45, 1.6, 0);
    expect(of('screacherScream').length).toBe(1);
    const culled = sfx.debugState().culled;
    sfx.screacherScream({}, SCREACHER_AUDIO.scream.maxDist + 2, 1.6, 0);
    expect(of('screacherScream').length).toBe(1);
    expect(sfx.debugState().culled).toBe(culled + 1);
  });

  it('is never dropped by the shared voice cap (pri 2: a gunfight cannot swallow the tell); the shriek can be', async () => {
    const {sfx, of} = await setup();
    for (let i = 0; i < 60; i++) sfx.pickup(); // fill the 44-voice cap
    expect(sfx.debugState().voices).toBeGreaterThanOrEqual(44);
    sfx.screacherVoice('shriek', {}, 5, 1.7, 0);
    expect(of('screacherShriek').length).toBe(0);
    sfx.screacherScream({}, 5, 1.7, 0);
    expect(of('screacherScream').length).toBe(1);
  });

  it('per Screacher at most one scream per minGapS; a new scream replaces nothing; other Screachers scream on their own', async () => {
    const {sfx, ctx, of} = await setup();
    const a = {}, b = {}, gap = SCREACHER_AUDIO.scream.minGapS;
    ctx.currentTime = 100;
    sfx.screacherScream(a, 6, 1.7, 0);
    for (let i = 0; i < 5; i++) { ctx.currentTime += gap / 10; sfx.screacherScream(a, 6, 1.7, 0); } // a caller bug: the same pulse again
    expect(of('screacherScream').length).toBe(1);
    expect(voiceIn(of('screacherScream')[0]).gain.value).toBe(1); // the first scream was not cut or restarted
    sfx.screacherScream(b, -6, 1.7, 0);
    expect(of('screacherScream').length).toBe(2);
    ctx.currentTime = 100 + gap + 0.01;
    sfx.screacherScream(a, 6, 1.7, 0); // the next pulse
    expect(of('screacherScream').length).toBe(3);
    ctx.currentTime += 60;
    sfx.screacherScream(a, 6, 1.7, 0); // the ~60 s cadence is never limited
    expect(of('screacherScream').length).toBe(4);
  });

  it('bounded: at most `max` screams sound at once — the nearest win (the farthest gives way, a farther new one is dropped)', async () => {
    const {sfx, of} = await setup();
    const max = SCREACHER_AUDIO.scream.max;
    for (let i = 0; i < max; i++) sfx.screacherScream({}, 10 * (i + 1), 1.6, 0); // 10, 20, 30 m
    expect(of('screacherScream').length).toBe(max);
    sfx.screacherScream({}, 10 * (max + 1), 1.6, 0); // a farther one: dropped
    expect(of('screacherScream').length).toBe(max);
    sfx.screacherScream({}, 4, 1.6, 0); // a nearer one: the farthest sounding scream fades for it
    const all = of('screacherScream');
    expect(all.length).toBe(max + 1);
    expect(all.map(s => voiceIn(s).gain.value)).toEqual([1, 1, 0, 1]);
    expect(all.map(s => pannerOf(s)!.positionX.value)).toEqual([10, 20, 30, 4]);
    sfx.screacherScream({}, 3, 1.6, 0); // and again at once: the fading one no longer counts, the next farthest gives way
    expect(of('screacherScream').map(s => voiceIn(s).gain.value)).toEqual([1, 0, 0, 1, 1]);
    expect(of('screacherScream').filter(s => voiceIn(s).gain.value > 0).length).toBe(max); // never more than `max` at full level
  });

  it('paused audio or a missing clip stays silent: no stand-in sound, no burst on resume', async () => {
    const {sfx, ctx} = await setup(['rifleShot']);
    sfx.screacherScream({}, 3, 1.7, 3);
    sfx.screacherVoice('wheeze', {}, 3, 1.7, 3);
    expect(ctx.started.length).toBe(0);
    expect(ctx.oscillatorCalls).toBe(0);
    expect(sfx.debugState().bank.silentCues.sort()).toEqual(['screacherScream', 'screacherWheeze']);
    const t = await setup();
    t.sfx.suspend(true); // a menu
    const s0 = t.ctx.started.length, key = {};
    t.sfx.screacherScream(key, 3, 1.7, 3);
    for (const k of ['wheeze', 'shriek', 'hurt', 'death'] as const) t.sfx.screacherVoice(k, key, 3, 1.7, 3);
    expect(t.ctx.started.length).toBe(s0);
    t.sfx.suspend(false);
    await settle();
    expect(t.ctx.started.length).toBe(s0); // nothing queued up while paused
    t.sfx.screacherScream(key, 3, 1.7, 3); // ... and the paused calls did not use up the Screacher's rate limit
    expect(t.of('screacherScream').length).toBe(1);
  });

  it('bad coordinates play nothing', async () => {
    const {sfx, ctx} = await setup();
    const s0 = ctx.started.length;
    sfx.screacherScream({}, NaN, 1.7, 0);
    sfx.screacherVoice('shriek', {}, 0, Infinity, 0);
    expect(ctx.started.length).toBe(s0);
  });
});

describe('Sfx.screacherVoice: wheeze / shriek / hurt / death', () => {
  it('each kind routes to its cue on a positional voice with its own range and level; hurt = the shriek takes, quieter and higher', async () => {
    const {sfx, ctx, of} = await setup();
    steady();
    const cue: Record<(typeof KINDS)[number], CueId> = {scream: 'screacherScream', shriek: 'screacherShriek', hurt: 'screacherShriek', wheeze: 'screacherWheeze', death: 'screacherDeath'};
    let n = 0;
    for (const k of ['wheeze', 'shriek', 'hurt', 'death'] as const) {
      ctx.currentTime += 5;
      const S = SCREACHER_AUDIO[k], before = of(cue[k]).length, s0 = ctx.started.length;
      expect(S.cue).toBe(cue[k]);
      sfx.screacherVoice(k, {}, 3, 1.7, -4);
      expect(ctx.started.length, k).toBe(s0 + 1);
      const src = of(cue[k])[before], pan = pannerOf(src)!;
      expect(src, k).toBeTruthy();
      expect([pan.positionX.value, pan.positionY.value, pan.positionZ.value]).toEqual([3, 1.7, -4]);
      expect([pan.refDistance, pan.rolloffFactor]).toEqual([S.ref, S.rolloff]);
      expect(clipGain(src)).toBeCloseTo(CUE_GAIN[cue[k]] * S.gain, 9);
      expect(src.playbackRate.value).toBeCloseTo(S.rate, 9);
      expect(src.loop).toBe(false);
      n++;
    }
    expect(n).toBe(4);
    expect(of('screacherShriek').length).toBe(2); // the shriek and the hurt yelp share the shriek takes
    expect(of('screacherScream').length).toBe(0);
    // each is culled past its own range: the wheeze is a near sound
    for (const k of ['wheeze', 'shriek', 'hurt', 'death'] as const) {
      ctx.currentTime += 5;
      const s0 = ctx.started.length;
      sfx.screacherVoice(k, {}, SCREACHER_AUDIO[k].maxDist + 1, 1.6, 0);
      expect(ctx.started.length, k).toBe(s0);
      sfx.screacherVoice(k, {}, SCREACHER_AUDIO[k].maxDist - 1, 1.6, 0);
      expect(ctx.started.length, k).toBe(s0 + 1);
    }
    expect(SCREACHER_AUDIO.wheeze.maxDist).toBeLessThan(SCREACHER_AUDIO.shriek.maxDist);
    expect(SCREACHER_AUDIO.shriek.maxDist).toBeLessThan(SCREACHER_AUDIO.scream.maxDist);
  });

  it('shriek / hurt / death are combat cues: never route-gated, never counted against the vocal cap', async () => {
    const {sfx, ctx, of} = await setup();
    sfx.setWorld({occlusion: () => 1});
    sfx.setVocalReach({pathTo: () => Infinity});
    for (const k of ['shriek', 'hurt', 'death'] as const) { ctx.currentTime += 5; sfx.screacherVoice(k, {}, 7, 1.7, 0); }
    expect([of('screacherShriek').length, of('screacherDeath').length]).toEqual([2, 1]);
    expect(sfx.debugState().vocal.played).toBe(0);
  });

  it('the per-Screacher rate limits hold for every kind, independently per kind and per Screacher', async () => {
    const {sfx, ctx} = await setup();
    for (const k of ['wheeze', 'shriek', 'hurt', 'death'] as const) {
      ctx.currentTime += 20;
      const a = {}, b = {}, gap = SCREACHER_AUDIO[k].minGapS, t0 = ctx.currentTime, s0 = ctx.started.length;
      sfx.screacherVoice(k, a, 4, 1.7, 0);
      expect(ctx.started.length, k).toBe(s0 + 1);
      ctx.currentTime = t0 + gap * 0.5; // (>= the 0.47 s fake clip for the slow kinds; the hurt gap is shorter than the clip)
      sfx.screacherVoice(k, a, 4, 1.7, 0); // too soon for this Screacher
      expect(ctx.started.length, k).toBe(s0 + 1);
      sfx.screacherVoice(k, b, -4, 1.7, 0); // another Screacher is not limited by it
      expect(ctx.started.length, k).toBe(s0 + 2);
      ctx.currentTime = t0 + gap + 0.5;
      sfx.screacherVoice(k, a, 4, 1.7, 0);
      expect(ctx.started.length, k).toBe(s0 + 3);
    }
    expect(SCREACHER_AUDIO.hurt.minGapS).toBeGreaterThanOrEqual(0.3); // a shotgun's pellets / a burst are one yelp
    expect(SCREACHER_AUDIO.wheeze.minGapS).toBeGreaterThanOrEqual(1);
    // the kinds do not limit each other: a shriek and a hurt yelp right after a scream both play
    ctx.currentTime += 20;
    const key = {}, s0 = ctx.started.length;
    sfx.screacherScream(key, 4, 1.7, 0);
    sfx.screacherVoice('shriek', key, 4, 1.7, 0);
    sfx.screacherVoice('hurt', key, 4, 1.7, 0);
    expect(ctx.started.length).toBe(s0 + 3);
  });

  it('bounded: at most `max` of a kind sound at once (several Screachers never stack into a wall of sound)', async () => {
    const {sfx, ctx} = await setup();
    for (const k of ['wheeze', 'shriek', 'hurt', 'death'] as const) {
      ctx.currentTime += 20;
      const s0 = ctx.started.length, max = SCREACHER_AUDIO[k].max;
      for (let i = 0; i < max + 3; i++) sfx.screacherVoice(k, {}, 3 + i * 0.5, 1.7, 0);
      expect(ctx.started.length, k).toBe(s0 + max);
      expect(max).toBeLessThanOrEqual(3);
    }
    // the whole family at once: a few voices, not one per call
    const total = KINDS.reduce((s, k) => s + SCREACHER_AUDIO[k].max, 0);
    expect(total).toBeLessThanOrEqual(12);
  });

  it('one throat: no wheeze under its own scream; a dying Screacher stops what it was voicing', async () => {
    const {sfx, ctx, of} = await setup();
    const a = {}, b = {};
    ctx.currentTime = 50;
    sfx.screacherScream(a, 5, 1.7, 0);
    ctx.currentTime += 0.1;
    sfx.screacherVoice('wheeze', a, 5, 1.7, 0); // still screaming
    expect(of('screacherWheeze').length).toBe(0);
    sfx.screacherVoice('wheeze', b, -5, 1.7, 0); // another Screacher breathes on
    expect(of('screacherWheeze').length).toBe(1);
    ctx.currentTime += 1; // the scream ended (the dropped wheeze did not use up the rate limit)
    sfx.screacherVoice('wheeze', a, 5, 1.7, 0);
    expect(of('screacherWheeze').length).toBe(2);
    // killed mid-scream: the death gurgle plays and the scream fades
    ctx.currentTime += 10;
    sfx.screacherScream(a, 5, 1.7, 0);
    const scream = of('screacherScream')[1];
    expect(voiceIn(scream).gain.value).toBe(1);
    ctx.currentTime += 0.2;
    sfx.screacherVoice('death', a, 5, 0.9, 0);
    expect(of('screacherDeath').length).toBe(1);
    expect(voiceIn(scream).gain.value).toBe(0);
    expect(voiceIn(of('screacherScream')[0]).gain.value).toBe(1); // (an earlier, finished scream is not touched)
    // shot while screaming, then killed: the death stops BOTH what it was still voicing (the scream and the hurt yelp)
    const c = {};
    ctx.currentTime += 10;
    sfx.screacherScream(c, 5, 1.7, 0);
    ctx.currentTime += 0.1;
    sfx.screacherVoice('hurt', c, 5, 1.7, 0);
    ctx.currentTime += 0.1;
    sfx.screacherVoice('death', c, 5, 0.9, 0);
    const [s3, yelp, gurgle] = [of('screacherScream')[2], of('screacherShriek')[0], of('screacherDeath')[1]];
    expect([voiceIn(s3).gain.value, voiceIn(yelp).gain.value, voiceIn(gurgle).gain.value]).toEqual([0, 0, 1]);
  });
});

describe('the Screacher audio is audio only', () => {
  const sfxSrc = fs.readFileSync(path.join(GAME, 'src/audio/sfx.ts'), 'utf8');

  it('Sfx has no way back into AI: no new import from ai/, no callback or event out of the Screacher section', () => {
    expect([...sfxSrc.matchAll(/from '\.\.\/ai\/([^']+)'/g)].map(m => m[1])).toEqual(['vocalReach']); // (the existing vocal-route gate only)
    const a = sfxSrc.indexOf('  screacherScream(key: object'), b = sfxSrc.indexOf('// Task studio-market-bar-20261108-225231-01 (lane AUDIO): the MARKET set', a);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const section = sfxSrc.slice(a, b);
    expect(section).not.toMatch(/dispatchEvent|emit\(|onScream|onHeard|noise|callback|listener\(|=> void\)/i);
    // the two contract signatures, exactly
    expect(sfxSrc).toContain('  screacherScream(key: object, x: number, y: number, z: number): void {');
    expect(sfxSrc).toContain("  screacherVoice(kind: 'wheeze' | 'shriek' | 'hurt' | 'death', key: object, x: number, y: number, z: number): void {");
  });

  it('no loop and no per-call decode in the Screacher section', () => {
    const a = sfxSrc.indexOf('  screacherScream(key: object'), b = sfxSrc.indexOf('// Task studio-market-bar-20261108-225231-01 (lane AUDIO): the MARKET set', a);
    const section = sfxSrc.slice(a, b);
    expect(section).not.toMatch(/\.loop\b|decodeAudioData|fetch\(|new AudioContext|createBufferSource|setInterval|setTimeout/);
  });
});
