// Task track1-siren-blightbelly-20261031 (lane AUDIO): the Siren hum / scream and Blightbelly burst / gas hiss cues — registration,
// shipped Sound Lab derivatives + provenance + mix calibration, and the Sfx behaviour (once-per-enemy, one hum phrase per Siren,
// route gate, fades, bounded hisses, section cleanup) on a fake WebAudio context. The clips were NOT listened to (structural QC).
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CLIP_MANIFEST, CUES, type CueId} from '../src/audio/bank';
import {CLIP_BYTES_T1, CLIP_GAPS_T1, CLIP_MANIFEST_T1} from '../src/audio/manifest.track1.generated';
import {CUE_GAIN, SIREN_HUM, Sfx, TRACK1_CUE_IDS, TRACK1_VOICE, type VocalReachQuery} from '../src/audio/sfx';
import {FakeCtx, fakeBank, type Node, type Src} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p: string) => path.join(GAME, 'public', p);
const settle = () => new Promise(r => setTimeout(r, 40));
const T1 = ['sirenHum', 'sirenScream', 'blightBurst', 'blightHiss'] as const;

interface Deriv {
  url: string; bytes: number; sha256: string; cue: string; durationS: number; kbps: number;
  source: {clip: string; rawSha256: string; prompt: string; seed: number; jobId: string; model: string; profile: string; rawVerdict: {pass: boolean}};
  structural: {peakDbfs: number; loudness: {integratedLufs: number}; verdict: {pass: boolean; kind: string}; pitch: {notes: number; noteSteps: number}};
  ops: {op: string; bound?: string; peakCeilingDbfs?: number}[];
}
interface Mix { cueGain: number; mixMomentaryMaxLufs: number; mixPeakDbfs: number }
const prov = JSON.parse(fs.readFileSync(pub('assets/derivatives/audio-track1.json'), 'utf8')) as {
  task: string; auditioned: boolean; license: {status: string; gameReady: boolean; approved: boolean; review: string}; soundLab: {model: string; jobs: number};
  excluded: unknown[]; gaps: string[]; derivatives: Deriv[]; totals: {bytes: number}; design: Record<string, string>;
  mixCalibration: {new: Record<string, Mix>; reference: Record<string, Mix>};
};

async function setup(only?: readonly CueId[]) {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 2, only});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  sfx.setListener(0, 1.6, 0, 0);
  const of = (cue: CueId) => { const b = new Set(bank.get(cue).map(c => c.buffer as unknown)); return ctx.started.filter(s => b.has(s.buffer)); };
  return {sfx, ctx, of};
}
/** The gain node a source feeds (per-clip gain = CUE_GAIN x opts) and the voice input it feeds. */
const clipGain = (s: Src) => (s.outputs[0] as unknown as {gain: {value: number}}).gain.value;
const voiceIn = (s: Src) => s.outputs[0].outputs[0] as unknown as Node & {gain: {value: number}};

describe('track1 cue registration + shipped Sound Lab derivatives', () => {
  it('registers the four cues (bank CUES, CUE_GAIN, merged manifest) with no silent gap', () => {
    expect(TRACK1_CUE_IDS).toEqual(T1);
    for (const c of T1) {
      expect(CUES).toContain(c);
      expect(CUE_GAIN[c]).toBeGreaterThan(0);
      expect(CLIP_MANIFEST[c]).toBe(CLIP_MANIFEST_T1[c]);
    }
    expect(CLIP_GAPS_T1).toEqual([]);
    // the authorized 6-job batch: 2 hums, 2 screams, 1 burst, 1 hiss — one derivative per job, nothing else
    expect(Object.fromEntries(T1.map(c => [c, CLIP_MANIFEST_T1[c].length]))).toEqual({sirenHum: 2, sirenScream: 2, blightBurst: 1, blightHiss: 1});
    expect(CLIP_MANIFEST_T1.sirenHum.map(r => r.src)).toEqual(['t1-siren-hum-01', 't1-siren-hum-02']);
  });

  it('clips are bundled relative MP3s matching their provenance (hash, bytes, duration bands per cue)', () => {
    const band: Record<string, [number, number]> = {sirenHum: [3.5, 6], sirenScream: [1, 2.6], blightBurst: [0.2, 1.2], blightHiss: [2, 4]};
    let bytes = 0;
    for (const c of T1) for (const r of CLIP_MANIFEST_T1[c]) {
      expect(r.url).toMatch(/^assets\/audio\/t1-[a-z0-9-]+\.mp3$/);
      const b = fs.readFileSync(pub(r.url));
      bytes += b.length;
      const d = prov.derivatives.find(x => x.url === r.url)!;
      expect(d, r.url).toBeTruthy();
      expect(createHash('sha256').update(b).digest('hex')).toBe(d.sha256);
      expect(d.bytes).toBe(b.length);
      expect(d.cue).toBe(c);
      expect(r.dur).toBe(d.durationS);
      expect(r.dur).toBeGreaterThanOrEqual(band[c][0]);
      expect(r.dur).toBeLessThanOrEqual(band[c][1]);
      expect(r.loop).toBeUndefined(); // the hum ships as phrases, not a loop (prov.design.sirenHum)
    }
    expect(bytes).toBe(CLIP_BYTES_T1);
    expect(bytes).toBe(prov.totals.bytes);
    expect(bytes).toBeLessThan(400_000);
  });

  it('provenance: Sound Lab model, prompts / seeds / jobs, conditional licence, NOT auditioned, every take passes the structural gate', () => {
    expect(prov.task).toBe('studio-track1-siren-blightbelly-20261031-01');
    expect(prov.soundLab.model).toBe('stabilityai/stable-audio-3-small-sfx');
    expect(prov.soundLab.jobs).toBe(6);
    expect(prov.license.status).toMatch(/Conditional prototype/);
    expect(prov.license.gameReady).toBe(false);
    expect(prov.license.approved).toBe(false);
    expect(prov.auditioned).toBe(false);
    expect(prov.license.review).toMatch(/NOT LISTENED/);
    expect(prov.excluded).toEqual([]);
    expect(prov.gaps).toEqual([]);
    expect(prov.design.sirenHum).toMatch(/PHRASES, not a seamless loop/);
    expect(prov.derivatives.length).toBe(6);
    expect(new Set(prov.derivatives.map(d => d.source.seed)).size).toBe(6);
    for (const d of prov.derivatives) {
      expect(d.source.prompt).toMatch(/^TrackType: SFX, /);
      expect(Number.isInteger(d.source.seed)).toBe(true);
      expect(d.source.jobId).toMatch(/^20261031T\d{6}-\d+$/);
      expect(d.source.rawSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(d.source.model).toBe('stabilityai/stable-audio-3-small-sfx');
      expect(d.source.profile).toBe('w8a8');
      expect(d.source.rawVerdict.pass).toBe(true);
      expect(d.structural.verdict.pass, d.source.clip).toBe(true);
      expect(d.structural.peakDbfs).toBeLessThanOrEqual(-0.9); // -1 dBFS sample-peak ceiling
      expect(d.ops.map(o => o.op)).toEqual(['downmix', 'trim', 'fade', 'normalise', 'encode']);
      expect(d.kbps).toBe(128);
    }
    // the hums are melodic phrases (held notes with steps) and loudness-matched to each other (raw takes were 14 LU apart)
    const hums = prov.derivatives.filter(d => d.cue === 'sirenHum');
    for (const h of hums) expect(h.structural.pitch.noteSteps).toBeGreaterThanOrEqual(2);
    expect(Math.abs(hums[0].structural.loudness.integratedLufs - hums[1].structural.loudness.integratedLufs)).toBeLessThanOrEqual(0.5);
  });

  it('mix: the scream is the loudest enemy vocal without a clipping jump; the hum is soft (CUE_GAIN = provenance calibration)', () => {
    const m = prov.mixCalibration.new, ref = prov.mixCalibration.reference;
    for (const c of T1) expect(m[c].cueGain, c).toBe(CUE_GAIN[c]);
    const vocals = ['zombieGroan', 'zombieDeath', 'zombieAttack', 'creatureSnarl', 'creatureGrowl'].map(k => ref[k].mixMomentaryMaxLufs);
    expect(m.sirenScream.mixMomentaryMaxLufs).toBeGreaterThan(Math.max(...vocals)); // perceptually the loudest enemy vocal
    expect(m.sirenScream.mixMomentaryMaxLufs).toBeLessThanOrEqual(ref.zombieGroan.mixMomentaryMaxLufs + 4); // ... but no big jump
    expect(m.sirenScream.mixPeakDbfs).toBeLessThanOrEqual(-6); // headroom before the master compressor
    expect(m.sirenHum.mixMomentaryMaxLufs).toBeLessThanOrEqual(ref.zombieGroan.mixMomentaryMaxLufs - 4); // soft
    expect(m.blightBurst.mixPeakDbfs).toBeLessThanOrEqual(-1);
    expect(m.blightHiss.mixMomentaryMaxLufs).toBeLessThan(m.blightBurst.mixMomentaryMaxLufs);
  });
});

describe('Siren hum / scream (Sfx)', () => {
  it('one hum phrase per Siren while it sounds; returns the phrase length; again after it ended', async () => {
    const {sfx, ctx, of} = await setup();
    const a = {}, b = {};
    const d = sfx.sirenHum(a, 3, 0.5, 3);
    expect(d).toBeGreaterThan(0);
    expect(of('sirenHum').length).toBe(1);
    expect(sfx.sirenHum(a, 3, 0.5, 3)).toBe(0); // still sounding: no second voice for the same Siren
    expect(sfx.sirenHum(b, -3, 0.5, 3)).toBeGreaterThan(0); // another Siren hums independently
    expect(of('sirenHum').length).toBe(2);
    expect(ctx.nodes.filter(n => n.kind === 'panner').length).toBeGreaterThanOrEqual(2); // positional
    ctx.currentTime += d + 0.2;
    expect(sfx.sirenHum(a, 3, 0.5, 3)).toBeGreaterThan(0);
    expect(sfx.debugState().t1).toMatchObject({hums: 3});
  });

  it('wake: the scream fades her hum and sounds exactly once per Siren; she never hums again', async () => {
    const {sfx, ctx, of} = await setup();
    const s = {};
    sfx.sirenHum(s, 2, 0.5, 2);
    const hum = of('sirenHum')[0];
    ctx.currentTime += 0.1;
    expect(sfx.sirenScream(s, 2, 0.5, 2)).toBe(true);
    expect(voiceIn(hum).gain.value).toBe(0); // hum faded (fake setTargetAtTime lands at once)
    expect(of('sirenScream').length).toBe(1);
    const g = clipGain(of('sirenScream')[0]) / CUE_GAIN.sirenScream;
    expect(g).toBeGreaterThan(0.94); // +-0.5 dB jitter only: no extra gain stage
    expect(g).toBeLessThan(1.06);
    for (let i = 0; i < 5; i++) { ctx.currentTime += 1; expect(sfx.sirenScream(s, 2, 0.5, 2)).toBe(false); }
    expect(of('sirenScream').length).toBe(1);
    ctx.currentTime += 10;
    expect(sfx.sirenHum(s, 2, 0.5, 2)).toBe(0);
    expect(sfx.debugState().t1).toMatchObject({screams: 1, repeats: 5});
    sfx.sirenHumStop(s); sfx.sirenHumStop({}); // idempotent / unknown: harmless
  });

  it('the scream is never dropped by the shared voice cap (pri 2); the hum is', async () => {
    const {sfx, ctx, of} = await setup();
    for (let i = 0; i < 60; i++) sfx.pickup(); // fill the 44-voice cap with listener-relative one-shots
    expect(sfx.sirenHum({}, 2, 0.5, 2)).toBe(0);
    expect(sfx.sirenScream({}, 2, 0.5, 2)).toBe(true);
    expect(of('sirenScream').length).toBe(1);
    ctx.currentTime += 1;
  });

  it('hum follows the enemy-vocal route gate (silent behind a slab with no route; heard in clear sight)', async () => {
    const {sfx, ctx, of} = await setup();
    const far: VocalReachQuery = {pathTo: () => Infinity};
    let blocked = 1;
    sfx.setWorld({occlusion: () => blocked});
    sfx.setVocalReach(far);
    expect(sfx.sirenHum({}, 6, 4.9, 0)).toBe(0); // storey above, no route
    expect(sfx.debugState().vocal.gated).toBeGreaterThan(0);
    expect(sfx.sirenScream({}, 6, 4.9, 0)).toBe(false); // the wake scream obeys the same gate (it is remembered: once)
    blocked = 0;
    ctx.currentTime += 1;
    expect(sfx.sirenHum({}, 6, 0.5, 0)).toBeGreaterThan(0); // clear line of sight: heard by the straight line
    expect(sfx.sirenScream({}, 6, 0.5, 0)).toBe(true);
    expect(of('sirenScream').length).toBe(1);
    expect(sfx.sirenHum({}, SIREN_HUM.maxDist + 2, 0.5, 0)).toBe(0); // beyond reach: culled
  });

  it('paused audio or a missing clip stays silent (no stand-in sound)', async () => {
    const {sfx, ctx} = await setup(['rifleShot']);
    expect(sfx.sirenHum({}, 2, 0.5, 2)).toBe(0);
    expect(sfx.blightBurst({}, 2, 1, 2)).toBe(false);
    expect(ctx.oscillatorCalls).toBe(0);
    expect(sfx.debugState().bank.silentCues.sort()).toEqual(['blightBurst', 'sirenHum']);
    sfx.suspend(true);
    const s0 = ctx.started.length;
    expect(sfx.sirenScream({}, 2, 0.5, 2)).toBe(false);
    expect(ctx.started.length).toBe(s0);
  });
});

describe('Blightbelly burst / gas hiss (Sfx)', () => {
  it('burst and hiss sound once per Blightbelly, positional; the hiss can be delayed after the burst', async () => {
    const {sfx, ctx, of} = await setup();
    const b = {};
    ctx.currentTime = 10;
    expect(sfx.blightBurst(b, 4, 1.1, 4)).toBe(true);
    for (let i = 0; i < 4; i++) expect(sfx.blightBurst(b, 4, 1.1, 4)).toBe(false); // several pellets on the killing frame
    expect(of('blightBurst').length).toBe(1);
    expect(sfx.blightHiss(b, 4, 1.1, 4, 0.15)).toBe(true);
    expect(sfx.blightHiss(b, 4, 1.1, 4, 0.15)).toBe(false);
    const hiss = of('blightHiss');
    expect(hiss.length).toBe(1);
    expect(hiss[0].startArgs[0]).toBeCloseTo(10.15, 6);
    expect(sfx.blightBurst({}, -4, 1.1, 4)).toBe(true); // a different Blightbelly bursts on its own
    expect(sfx.debugState().t1).toMatchObject({bursts: 2, hisses: 1, repeats: 5});
  });

  it('at most TRACK1_VOICE.hiss.max hisses at once (the oldest fades); a new section fades hums and hisses', async () => {
    const {sfx, of} = await setup();
    for (let i = 0; i < TRACK1_VOICE.hiss.max + 1; i++) expect(sfx.blightHiss({}, i, 1, 2)).toBe(true);
    const hisses = of('blightHiss');
    expect(voiceIn(hisses[0]).gain.value).toBe(0); // oldest faded
    expect(sfx.debugState().t1.hissVoices).toBe(TRACK1_VOICE.hiss.max);
    sfx.sirenHum({}, 2, 0.5, 2);
    expect(sfx.debugState().t1.humVoices).toBe(1);
    sfx.setWorld({occlusion: () => 0}); // new section
    expect(sfx.debugState().t1).toMatchObject({humVoices: 0, hissVoices: 0});
    for (const s of hisses) expect(voiceIn(s).gain.value).toBe(0);
    expect(voiceIn(of('sirenHum')[0]).gain.value).toBe(0);
  });
});
