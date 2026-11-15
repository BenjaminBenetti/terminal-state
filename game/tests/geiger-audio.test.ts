// Task studio-reactor-glowing-zombies-20261115-013245-01 (lane AUDIO): the player's Geiger counter near the irradiated zombies. The ticks
// are PROCEDURAL clips rendered offline by tools/audio-pipeline/geiger-render.mjs (user-authorized for the Geiger clicks; no paid
// generation) and cooked by tools/audio-pipeline/geiger-build.mjs; at runtime they are ordinary bundled clips (no synthesis). These tests
// check registration, the bundled bytes against their provenance, reproducibility of the masters from their seeds, and the Web Audio
// graph of Sfx.geigerClick with a fake context. They are not a listening test.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CLIP_MANIFEST, CUES, ClipBank, type Clip, type CueId} from '../src/audio/bank';
import {CLIP_BYTES_GEIGER, CLIP_GAPS_GEIGER, CLIP_MANIFEST_GEIGER, GEIGER_CUES, GEIGER_CUE_GAIN} from '../src/audio/manifest.geiger.generated';
import {CUE_GAIN, GEIGER_AUDIO, Sfx} from '../src/audio/sfx';
import {FakeCtx, Panner, Src, fakeBank, fakeBuffer, type Node as FakeNode} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const settle = () => new Promise(r => setTimeout(r, 40));
const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/audio-geiger.json'), 'utf8'));
type Deriv = {url: string; bytes: number; sha256: string; cue: string; durationS: number; source: {clip: string; seed: number; discharges: number; rawSha256: string; rawFile: string; generator: string; procedural: boolean; jobId: null};
  structural: {peakDbfs: number; dcMean: number; decayTo40DbMs: number; decayTo60DbMs: number; centroidHz: number; spectralPeakHz: number; dischargesFound: number; dischargeOffsetsMs: number[]}};
const derivs = prov.derivatives as Deriv[];

/** The fake bank, with the Geiger cues' takes at their real (manifest) lengths: the voice cap / bucket bounds depend on them. */
function geigerBank(): ClipBank {
  const {bank} = fakeBank({variants: 3});
  const clips: Partial<Record<CueId, Clip[]>> = {};
  for (const cue of CUES) clips[cue] = [...bank.get(cue)];
  for (const cue of GEIGER_CUES) clips[cue] = CLIP_MANIFEST_GEIGER[cue].map(r => ({buffer: fakeBuffer(r.dur + 0.03) as unknown as AudioBuffer, offset: 0.025, dur: r.dur, src: r.src}));
  return ClipBank.fromClips(clips);
}

async function setup() {
  const made: FakeCtx[] = [];
  const bank = geigerBank();
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  sfx.setListener(0, 1.6, 0, 0);
  const of = (cue: 'geigerClick' | 'geigerCluster') => new Set(bank.get(cue).map(c => c.buffer as unknown));
  const single = of('geigerClick'), cluster = of('geigerCluster');
  const started = (set: Set<unknown>) => ctx.started.filter(s => set.has(s.buffer));
  return {sfx, ctx, single: () => started(single), cluster: () => started(cluster)};
}
/** source -> clip gain -> voice input (playClip without a filter). */
const clipGain = (s: Src) => s.outputs[0] as FakeNode & {gain: {value: number}};
const voiceIn = (s: Src) => clipGain(s).outputs[0] as FakeNode & {gain: {value: number}};

describe('Geiger ticks: registration and bundled clips', () => {
  it('two bank cues (one decode block), six single takes + three cluster takes, the build\'s mix gain, no gap', () => {
    expect([...GEIGER_CUES]).toEqual(['geigerClick', 'geigerCluster']);
    const at = (CUES as readonly string[]).indexOf('geigerClick');
    expect((CUES as readonly string[]).slice(at, at + 2)).toEqual(['geigerClick', 'geigerCluster']);
    expect(CLIP_GAPS_GEIGER).toEqual([]);
    expect(CLIP_MANIFEST_GEIGER.geigerClick).toHaveLength(6);
    expect(CLIP_MANIFEST_GEIGER.geigerCluster).toHaveLength(3);
    for (const cue of GEIGER_CUES) {
      expect(CLIP_MANIFEST[cue]).toEqual(CLIP_MANIFEST_GEIGER[cue]);
      expect(CUE_GAIN[cue]).toBe(GEIGER_CUE_GAIN[cue]);
      expect(CUE_GAIN[cue]).toBe(prov.mixCalibration.cues[cue].cueGain); // the build's calibration is the mix
      expect(CUE_GAIN[cue]).toBeGreaterThan(0);
      expect(CUE_GAIN[cue]).toBeLessThanOrEqual(1);
      for (const ref of CLIP_MANIFEST[cue]) {
        expect(ref.url).toMatch(/^assets\/audio\/geiger-(click|cluster)-\d\d\.mp3$/);
        expect(ref.loop).toBeUndefined();
        expect(ref.dur).toBeLessThan(cue === 'geigerClick' ? 0.03 : 0.12); // short transients
      }
    }
    // no other generated manifest names one of these cues
    const dir = path.join(GAME, 'src/audio');
    for (const f of fs.readdirSync(dir).filter(n => /^manifest\..*generated\.ts$/.test(n) && n !== 'manifest.geiger.generated.ts')) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const cue of GEIGER_CUES) expect(new RegExp(`^\\s*['"]?${cue}['"]?\\s*[:,]`, 'm').test(text), `${f}: ${cue}`).toBe(false);
    }
  });

  it('every clip exists on disk with its recorded size and SHA-256 (manifest = provenance = CLIP_BYTES)', () => {
    let bytes = 0;
    const urls = GEIGER_CUES.flatMap(c => CLIP_MANIFEST_GEIGER[c].map(r => ({...r, cue: c})));
    expect(derivs.map(d => d.url).sort()).toEqual(urls.map(u => u.url).sort());
    for (const r of urls) {
      const d = derivs.find(e => e.url === r.url)!;
      const b = fs.readFileSync(path.join(GAME, 'public', r.url));
      expect(b.length, r.url).toBe(d.bytes);
      expect(sha(b), r.url).toBe(d.sha256);
      expect(d.cue).toBe(r.cue);
      expect(d.source.clip).toBe(r.src);
      expect(d.durationS).toBe(r.dur);
      expect([b[0], b[1] & 0xfe]).toEqual([0xff, 0xfa]); // MPEG-1 Layer III frame sync, no ID3
      expect((b[2] >> 2) & 3).toBe(0); // 44.1 kHz
      bytes += b.length;
    }
    expect(bytes).toBe(CLIP_BYTES_GEIGER);
    expect(bytes).toBe(prov.totalBytes);
    expect(bytes).toBeLessThan(32 * 1024);
  });

  it('procedural provenance: the committed renderer re-creates every private master byte for byte from its seed', async () => {
    expect(prov.procedural).toBe(true);
    expect(prov.auditioned).toBe(false);
    expect(prov.review).toMatch(/NOT LISTENED TO/);
    expect(prov.license.gameReady).toBe(false);
    expect(prov.license.status).toMatch(/Conditional prototype/);
    expect(prov.license.status).toMatch(/no third-party/i);
    const R = await import(pathToFileURL(path.join(ROOT, 'tools/audio-pipeline/geiger-render.mjs')).href) as {
      TAKES: {id: string; cue: string; seed: number; discharges: number}[]; masterBytes: (t: unknown) => {wav: Buffer}; RENDERER: string };
    expect(R.TAKES.map(t => t.id).sort()).toEqual(derivs.map(d => d.source.clip).sort());
    for (const t of R.TAKES) {
      const d = derivs.find(e => e.source.clip === t.id)!;
      expect([d.source.procedural, d.source.generator, d.source.seed, d.source.discharges, d.cue, d.source.jobId]).toEqual([true, R.RENDERER, t.seed, t.discharges, t.cue, null]);
      const wav = R.masterBytes(t).wav;
      expect(sha(wav), t.id).toBe(d.source.rawSha256);
      const raw = path.join(ROOT, d.source.rawFile); // the external raw mount, when present: unchanged
      if (fs.existsSync(raw)) expect(sha(fs.readFileSync(raw))).toBe(d.source.rawSha256);
    }
  });

  it('structure of each take (not an audition): sharp, short, centred on the piezo band, the rendered discharge count, no DC', () => {
    for (const d of derivs) {
      const s = d.structural;
      expect(s.peakDbfs).toBeCloseTo(-1, 1);
      expect(Math.abs(s.dcMean)).toBeLessThan(1e-4);
      expect(s.decayTo60DbMs).toBeLessThanOrEqual(20);
      expect(s.decayTo40DbMs).toBeLessThan(s.decayTo60DbMs);
      expect(s.centroidHz).toBeGreaterThan(2500);
      expect(s.centroidHz).toBeLessThan(4000);
      expect(s.dischargesFound).toBe(d.source.discharges);
      if (d.cue === 'geigerClick') expect(d.source.discharges).toBe(1);
      else {
        expect(d.source.discharges).toBeGreaterThanOrEqual(2);
        expect(d.source.discharges).toBeLessThanOrEqual(4);
        const o = s.dischargeOffsetsMs;
        for (let i = 1; i < o.length; i++) { expect(o[i] - o[i - 1]).toBeGreaterThan(5); expect(o[i] - o[i - 1]).toBeLessThan(37); }
      }
    }
    expect(new Set(derivs.filter(d => d.cue === 'geigerCluster').map(d => d.source.discharges))).toEqual(new Set([2, 3, 4]));
  });

  it('the audio notice and the credits name the procedural set honestly; the Sound Lab notices stay', () => {
    const notice = fs.readFileSync(path.join(GAME, 'public/assets/audio/NOTICE.md'), 'utf8');
    expect(notice).toMatch(/## Geiger-counter ticks \(geiger-\*\.mp3\)[\s\S]*not Sound Lab clips[\s\S]*tools\/audio-pipeline\/geiger-render\.mjs[\s\S]*\.\.\/derivatives\/audio-geiger\.json/);
    expect(notice).toMatch(/No synthesised, stock, downloaded or hosted audio is included, except the procedural Geiger-counter ticks/);
    expect(notice).toMatch(/Powered by Stability AI/);
    expect(notice).toMatch(/conditional prototype status, not production or commercial clearance/);
    const credits = fs.readFileSync(path.join(GAME, 'public/assets/CREDITS.md'), 'utf8');
    const block = /<!-- BEGIN geiger-audio-20261115[^>]*-->([\s\S]*?)<!-- END geiger-audio-20261115 -->/.exec(credits)?.[1] ?? '';
    expect(block).toMatch(/tools\/audio-pipeline\/geiger-render\.mjs/);
    expect(block).toMatch(/No Sound Lab,\s+no generative model and no third-party/);
    expect(block).toMatch(/conditional prototype status is unchanged, not production or\s+commercial clearance/);
    expect(block).toMatch(/Not reviewed by ear/);
  });

  // The lead updates tools/release/public-inputs.json at integration (the audio lane does not edit it): this pins that it did.
  it('the release allowlist lists every Geiger clip, the provenance, the notice and the credits at their current bytes', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    const listed = new Map(allow.files.map(f => [f.path, f]));
    for (const d of derivs) expect(listed.get(d.url), d.url).toEqual({path: d.url, bytes: d.bytes, sha256: d.sha256});
    expect(allow.files.filter(f => /^assets\/audio\/geiger-/.test(f.path)).map(f => f.path).sort()).toEqual(derivs.map(d => d.url).sort());
    for (const p of ['assets/derivatives/audio-geiger.json', 'assets/audio/NOTICE.md', 'assets/CREDITS.md']) {
      const buf = fs.readFileSync(path.join(GAME, 'public', p));
      expect(listed.get(p), p).toEqual({path: p, bytes: buf.length, sha256: sha(buf)});
    }
  });

  it('the mix calibration used the game\'s current reference gains, and a full-exposure tick sits under the heartbeat', () => {
    const ref = prov.mixCalibration.references;
    expect([ref.click.gameGain, ref.heartbeatMax.gameGain, ref.heartbeatMin.gameGain, ref.hitTick.gameGain]).toEqual([CUE_GAIN.click, CUE_GAIN.heartbeat, CUE_GAIN.heartbeat * 0.5, CUE_GAIN.hitTick]);
    const c = prov.mixCalibration.cues.geigerClick;
    expect(Math.abs(c.atK1Lufs - (ref.click.momentaryLufs + prov.mixCalibration.targetReClickLu))).toBeLessThanOrEqual(0.15);
    expect(c.atK1Lufs).toBeLessThan(ref.heartbeatMin.momentaryLufs);
    expect(c.atK0Lufs).toBeLessThan(c.atK1Lufs - 5);
    expect(c.atK1PeakDbfs).toBeLessThanOrEqual(-1);
  });
});

describe('Sfx.geigerClick', () => {
  it('plays one take of the cue NON-positionally (centred, into the same master as the UI click), with a tiny room send', async () => {
    const {sfx, ctx, single, cluster} = await setup();
    const panners = ctx.nodes.filter(n => n instanceof Panner).length;
    sfx.geigerClick(0.5);
    expect([single().length, cluster().length]).toEqual([1, 0]);
    ctx.currentTime += 1;
    sfx.geigerClick(0.5, true);
    expect([single().length, cluster().length]).toEqual([1, 1]);
    expect(ctx.nodes.filter(n => n instanceof Panner).length).toBe(panners); // no PannerNode
    expect(ctx.nodes.some(n => 'pan' in n)).toBe(false); // no StereoPanner either: centred
    sfx.click();
    const uiClick = ctx.started[ctx.started.length - 1];
    const master = voiceIn(uiClick).outputs[0];
    for (const s of [single()[0], cluster()[0]]) {
      const outs = voiceIn(s).outputs;
      expect(outs[0]).toBe(master);
      expect(outs).toHaveLength(2); // master + the reverb send
      expect((outs[1] as FakeNode & {gain: {value: number}}).gain.value).toBeCloseTo(GEIGER_AUDIO.send, 6);
      expect(GEIGER_AUDIO.send).toBeLessThanOrEqual(0.05);
    }
  });

  it('gain = CUE_GAIN x (0.55 + 0.45 k), k clamped to 0..1; rate jitter within +-4 %', async () => {
    const {sfx, ctx, single} = await setup();
    const cases: [number, number][] = [[0, 0.55], [0.5, 0.775], [1, 1], [-3, 0.55], [7, 1], [Number.NaN, 0.55]];
    for (const [k, want] of cases) {
      ctx.currentTime += 1;
      sfx.geigerClick(k);
      const s = single()[single().length - 1];
      expect(voiceIn(s).gain.value, `k ${k}`).toBeCloseTo(want, 6);
      const g = clipGain(s).gain.value / CUE_GAIN.geigerClick;
      expect(g).toBeGreaterThanOrEqual(Math.pow(10, -GEIGER_AUDIO.gainJitter / 20) - 1e-9);
      expect(g).toBeLessThanOrEqual(Math.pow(10, GEIGER_AUDIO.gainJitter / 20) + 1e-9);
      expect(Math.abs(s.playbackRate.value - 1)).toBeLessThanOrEqual(0.04 + 1e-9);
    }
    expect(single()).toHaveLength(cases.length);
    // a louder exposure is louder
    ctx.currentTime += 1; sfx.geigerClick(0.1);
    ctx.currentTime += 1; sfx.geigerClick(0.9);
    const [lo, hi] = single().slice(-2);
    expect(voiceIn(hi).gain.value).toBeGreaterThan(voiceIn(lo).gain.value);
  });

  it('plays nothing while audio is paused (menus) and consumes no budget; plays again after resume', async () => {
    const {sfx, ctx, single, cluster} = await setup();
    sfx.suspend(true);
    for (let i = 0; i < 10; i++) { ctx.currentTime += 0.5; sfx.geigerClick(1); sfx.geigerClick(1, true); }
    expect([single().length, cluster().length]).toEqual([0, 0]);
    expect(sfx.geigerStats).toEqual({played: 0, capped: 0, limited: 0});
    sfx.suspend(false);
    await settle();
    ctx.currentTime += 1;
    sfx.geigerClick(1);
    expect(single()).toHaveLength(1);
  });

  it('bounded: its own token bucket and voice cap at one instant, refilled with time; expendable when the voice pool is busy', async () => {
    const {sfx, ctx, single} = await setup();
    for (let i = 0; i < 20; i++) sfx.geigerClick(1);
    expect(single()).toHaveLength(GEIGER_AUDIO.maxVoices); // 4 sounding at once (the bucket's burst is 6)
    expect(sfx.geigerStats.capped).toBe(16);
    ctx.currentTime += 1; // the ticks ended, the bucket refilled
    for (let i = 0; i < 3; i++) sfx.geigerClick(1);
    expect(single()).toHaveLength(GEIGER_AUDIO.maxVoices + 3);
    // a steady 60 / s request stream for 2 s is held near the bucket's 30 / s
    const s0 = single().length;
    for (let i = 0; i < 120; i++) { ctx.currentTime += 1 / 60; sfx.geigerClick(1); }
    expect(single().length - s0).toBeLessThanOrEqual(30 * 2 + 6);
    expect(single().length - s0).toBeGreaterThan(40);
    expect(sfx.geigerStats.limited).toBeGreaterThan(0);
    // a busy voice pool (30 gunshot voices): the tick is the one refused; a normal-priority cue still plays
    ctx.currentTime += 5;
    for (let i = 0; i < 30; i++) sfx.shot('rifle');
    const n = single().length, all = ctx.started.length;
    sfx.geigerClick(1);
    expect(single().length).toBe(n);
    sfx.pickup();
    expect(ctx.started.length).toBe(all + 1);
  });

  it('never creates an oscillator or a buffer; every source is a bank clip; sfx.ts / bank.ts stay synthesis-free', async () => {
    const {sfx, ctx} = await setup();
    const buffers0 = ctx.createdBuffers.length;
    for (let i = 0; i < 50; i++) { ctx.currentTime += 0.07; sfx.geigerClick(i / 49, i % 3 === 0); }
    expect(ctx.oscillatorCalls).toBe(0);
    expect(ctx.createdBuffers.length).toBe(buffers0);
    for (const s of ctx.started) expect(ctx.createdBuffers).not.toContain(s.buffer);
    expect(sfx.debugState().bank.silentPlays).toBe(0);
    for (const f of ['sfx.ts', 'bank.ts']) {
      const src = fs.readFileSync(path.join(GAME, 'src/audio', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(src, f).not.toMatch(/createOscillator|createBuffer\(|createPeriodicWave|getChannelData\([^)]*\)\s*\[[^\]]*\]\s*=/);
    }
  });
});
