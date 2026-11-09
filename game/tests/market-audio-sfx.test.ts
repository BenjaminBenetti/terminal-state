// Task studio-market-bar-20261108-225231-01 (lane AUDIO): the market set in audio/sfx.ts on the fake WebAudio graph — the register is ONE
// listener-relative cue; a person's scream / grunt is a world voice that follows them and fades, capped per kind; the retch never stacks;
// the crowd murmur is at most three positional loop channels on the AMBIENT bus (own-shot ducking, pause mute) that follow their groups,
// fade when the groups go and are released on a new world; the mix gains are the build's calibration; the public provenance carries
// hashes, never prompt text or private paths.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CUE_GAIN, MARKET_AUDIO, Sfx} from '../src/audio/sfx';
import {CLIP_MANIFEST_MARKET_BAR} from '../src/audio/manifest.marketBar.generated';
import {FakeCtx, fakeBank, type Node as FakeNode, type Src} from './helpers/fakeAudio';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settle = () => new Promise(r => setTimeout(r, 40));

async function rig() {
  const made: FakeCtx[] = [];
  const {bank, buffers} = fakeBank({variants: 3});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  const priv = sfx as unknown as {ambBus: FakeNode; master: FakeNode; crowdCh: {pan: FakeNode & {positionX: {value: number}}; g: {gain: {value: number}}; src: Src; cue: string}[]};
  return {sfx, ctx, buffers, priv};
}
/** Every node downstream of `n` (the graph is a DAG). */
const reach = (n: FakeNode, seen = new Set<FakeNode>()): Set<FakeNode> => { for (const o of n.outputs) if (!seen.has(o)) { seen.add(o); reach(o, seen); } return seen; };

describe('market set: register / voices / retch', () => {
  it('the register is ONE listener-relative cue per call (no panner), counted', async () => {
    const {sfx, ctx} = await rig();
    const s0 = ctx.started.length, p0 = sfx.debugState().panners;
    expect(sfx.marketCash()).toBe(true);
    expect(ctx.started.length - s0).toBe(1);
    expect(sfx.debugState().panners).toBe(p0); // at the player: no PannerNode
    expect(sfx.marketAudioState().cash).toBe(1);
    sfx.suspend(true); // menus: requested cues are dropped, never queued
    expect(sfx.marketCash()).toBe(false);
  });

  it('a person\'s scream / grunt is a positional world voice that follows them and fades on stop; at most MARKET_AUDIO[kind].max at once', async () => {
    const {sfx, ctx} = await rig();
    const p0 = sfx.debugState().panners;
    const h = sfx.marketVoice('scream', 5, 1.55, 5, {rate: 1.05})!;
    expect(h.playing).toBe(true);
    expect(sfx.debugState().panners).toBe(p0 + 1);
    const pan = ctx.nodes.filter(n => n.kind === 'panner').at(-1) as FakeNode & {positionX: {value: number}; positionZ: {value: number}};
    h.setPos(7, 1.55, 8);
    expect([pan.positionX.value, pan.positionZ.value]).toEqual([7, 8]);
    h.stop(0.1);
    expect(h.playing).toBe(false);
    h.setPos(9, 1.55, 9); // stopped: no longer moves
    expect(pan.positionX.value).toBe(7);
    // the cap: max screams at once (a stopped one has left it), then dropped; grunts have their own cap
    ctx.currentTime += 5;
    const live = Array.from({length: MARKET_AUDIO.scream.max}, (_, i) => sfx.marketVoice('scream', i, 1.5, 3));
    expect(live.every(Boolean)).toBe(true);
    expect(sfx.marketVoice('scream', 9, 1.5, 3)).toBeNull();
    expect(sfx.marketVoice('grunt', 9, 1.5, 3)).not.toBeNull();
    const st = sfx.marketAudioState();
    expect([st.screamVoices, st.gruntVoices, st.capped, st.screams, st.grunts]).toEqual([MARKET_AUDIO.scream.max, 1, 1, MARKET_AUDIO.scream.max + 1, 1]);
    // past the panner's audible range: culled (no voice)
    expect(sfx.marketVoice('grunt', 400, 1.5, 400)).toBeNull();
  });

  it('the retch never stacks: a second one cuts the first', async () => {
    const {sfx, ctx} = await rig();
    const s0 = ctx.started.length;
    expect(sfx.marketRetch()).toBeGreaterThan(0);
    expect(sfx.marketRetch()).toBeGreaterThan(0);
    expect(ctx.started.length - s0).toBe(2);
    const st = sfx.marketAudioState();
    expect([st.retches, st.retch]).toEqual([2, true]);
  });
});

describe('market set: the crowd murmur channels', () => {
  it('at most three loop channels into the AMBIENT bus (shot ducking / pause mute), level = CUE_GAIN x group level, following their groups', async () => {
    const {sfx, ctx, priv} = await rig();
    const groups = [
      {x: 4, y: 1.5, z: 0, level: 1, cue: 'marketChatter' as const}, {x: -8, y: 1.5, z: 3, level: 0.5, cue: 'marketChatter' as const},
      {x: 0, y: 4.5, z: 9, level: 0.7, cue: 'marketBarChatter' as const}, {x: 20, y: 1.5, z: 20, level: 1, cue: 'marketChatter' as const},
    ];
    sfx.crowdChatter(groups);
    const st = sfx.marketAudioState();
    expect(st.crowd.length).toBe(MARKET_AUDIO.crowd.voices); // the 4th group gets no channel
    expect(st.crowd.map(c => c.cue)).toEqual(['marketChatter', 'marketChatter', 'marketBarChatter']);
    expect(st.crowd.map(c => +c.level.toFixed(4))).toEqual([CUE_GAIN.marketChatter, CUE_GAIN.marketChatter * 0.5, CUE_GAIN.marketBarChatter * 0.7].map(v => +v.toFixed(4)));
    for (const c of priv.crowdCh) {
      expect(c.src.loop).toBe(true);
      expect(c.pan.outputs).toEqual([priv.ambBus]); // the ambient bus, never straight into the master
      expect(reach(c.src).has(priv.master)).toBe(true);
    }
    // the groups drift: the same channels follow (no new loop); the level eases to the new count
    const s0 = ctx.started.length;
    sfx.crowdChatter([{...groups[0], x: 5, level: 0.6}, {...groups[1], z: 4}, groups[2]]);
    expect(ctx.started.length).toBe(s0);
    expect(sfx.marketAudioState().crowd[0]).toMatchObject({x: 5, level: expect.closeTo(CUE_GAIN.marketChatter * 0.6, 5)});
    // a group that moved far is a new place: the old channel fades, a new one starts
    sfx.crowdChatter([{...groups[0], x: 40}]);
    const after = sfx.marketAudioState();
    expect([after.crowd.length, after.crowdFading]).toEqual([1, 3]);
    expect(ctx.started.length).toBe(s0 + 1);
  });

  it('[] fades every channel out (and releases it); a new world releases them too; nothing synthesised', async () => {
    const {sfx, ctx, buffers, priv} = await rig();
    sfx.crowdChatter([{x: 3, y: 1.5, z: 3, level: 1, cue: 'marketChatter'}, {x: -3, y: 1.5, z: 3, level: 1, cue: 'marketBarChatter'}]);
    expect(sfx.marketAudioState().crowd.length).toBe(2);
    sfx.crowdChatter([]);
    let st = sfx.marketAudioState();
    expect([st.crowd.length, st.crowdFading, st.crowdStops]).toEqual([0, 2, 2]);
    expect(priv.crowdCh.every(c => c.g.gain.value === 0)).toBe(true); // (the fake param jumps to the eased target)
    ctx.currentTime += MARKET_AUDIO.crowd.fadeOut + 1;
    sfx.crowdChatter([]);
    expect(priv.crowdCh.length).toBe(0); // released after the fade
    sfx.crowdChatter([{x: 3, y: 1.5, z: 3, level: 1, cue: 'marketChatter'}]);
    sfx.setWorld({occlusion: null}); // a new station / world
    st = sfx.marketAudioState();
    expect([st.crowd.length, st.crowdFading]).toEqual([0, 1]);
    // invalid / silent groups never start a channel
    const s0 = ctx.started.length;
    sfx.crowdChatter([{x: NaN, y: 1, z: 1, level: 1, cue: 'marketChatter'}, {x: 1, y: 1, z: 1, level: 0, cue: 'marketChatter'}, {x: 1, y: 1, z: 1, level: 1, cue: 'bedWind' as never}]);
    expect(ctx.started.length).toBe(s0);
    for (const s of ctx.started) expect(buffers.has(s.buffer)).toBe(true);
    expect(ctx.oscillatorCalls).toBe(0);
  });

  it('occlusion muffles and lowers a channel (like the fans)', async () => {
    const {sfx} = await rig();
    sfx.setWorld({occlusion: () => 1});
    sfx.crowdChatter([{x: 6, y: 1.5, z: 0, level: 1, cue: 'marketChatter'}]);
    expect(sfx.marketAudioState().crowd[0].level).toBeCloseTo(CUE_GAIN.marketChatter * (1 - MARKET_AUDIO.crowd.occlusion), 5);
  });
});

describe('market set: assets, mix and provenance', () => {
  const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/audio-market-bar.json'), 'utf8'));

  it('every cue has its clips (variants trimmed from one take each); the murmurs are >= 5 s loops', () => {
    expect(Object.keys(CLIP_MANIFEST_MARKET_BAR).sort()).toEqual(['marketBarChatter', 'marketCash', 'marketChatter', 'marketGrunt', 'marketRetch', 'marketScream']);
    expect(CLIP_MANIFEST_MARKET_BAR.marketScream.length).toBeGreaterThanOrEqual(3);
    expect(CLIP_MANIFEST_MARKET_BAR.marketGrunt.length).toBeGreaterThanOrEqual(3);
    for (const c of ['marketChatter', 'marketBarChatter']) for (const r of CLIP_MANIFEST_MARKET_BAR[c]) expect(r.loop!.length).toBeGreaterThanOrEqual(5);
    // one Sound Lab job per cue (6 of the task's 12-job cap)
    expect(new Set(prov.derivatives.map((d: {source: {jobId: string}}) => d.source.jobId)).size).toBe(6);
  });

  it('CUE_GAIN is the build\'s mix calibration; every derivative passed its structural gate', () => {
    for (const [cue, m] of Object.entries(prov.mixCalibration.cues as Record<string, {cueGain: number}>)) expect(CUE_GAIN[cue as keyof typeof CUE_GAIN], cue).toBe(m.cueGain);
    for (const d of prov.derivatives) expect(d.gate.pass, d.url).toBe(true);
    // subtle register: under every voice of the set and under the cough (-25.9) at the source
    const mix = prov.mixCalibration.cues;
    expect(mix.marketCash.mixLufs).toBeLessThan(-25.9);
    expect(mix.marketScream.mixLufs).toBeLessThan(-18.5); // under a zombie groan
  });

  it('the public provenance names hashes only: no prompt text, no private path, no URL; conditional licence, not auditioned', () => {
    const txt = JSON.stringify(prov);
    expect(txt).not.toMatch(/TrackType|reference\/|\.wav|https?:|sfx_/);
    expect(prov.license.gameReady).toBe(false);
    expect(prov.license.status).toMatch(/Conditional prototype/);
    expect(prov.license.review).toMatch(/NOT LISTENED TO/);
    const notice = fs.readFileSync(path.join(GAME, 'public/assets/audio/NOTICE.md'), 'utf8');
    expect(notice).toMatch(/the market set \([\s\S]*\): \.\.\/derivatives\/audio-market-bar\.json/);
    expect(notice).toMatch(/Powered by Stability AI/);
  });
});
