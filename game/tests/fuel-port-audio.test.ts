// Task studio-beta-train-fuel-system-20261106-024923-01 (lane PORT): the train FUEL cues in audio/sfx.ts — engineStall / fuelPour /
// hoseConnect / cartRoll over the fake WebAudio context + fake Sound Lab bank (tests/helpers/fakeAudio.ts), and the shipped clips'
// manifest / provenance (the 3 local Sound Lab jobs, whole seconds, NOT auditioned).
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CUE_GAIN, FUEL_AUDIO, Sfx} from '../src/audio/sfx';
import {CUES} from '../src/audio/bank';
import {CLIP_MANIFEST_FUEL} from '../src/audio/manifest.fuel.generated';
import {FakeCtx, Src, fakeBank} from './helpers/fakeAudio';

const settle = () => new Promise(r => setTimeout(r, 40));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A running Sfx over a fake context whose sources record their stop time. */
async function audio() {
  const made: FakeCtx[] = [];
  const {bank, buffers} = fakeBank({variants: 1});
  const sfx = new Sfx(() => {
    const c = new FakeCtx();
    const mk = c.createBufferSource.bind(c);
    c.createBufferSource = () => { const s = mk() as Src & {stopAt?: number}; s.stop = (t?: number) => { s.stopAt = t ?? c.currentTime; }; return s; };
    made.push(c);
    return c as unknown as AudioContext;
  }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  return {sfx, ctx: made[0], buffers};
}
type Rec = Src & {stopAt?: number};

describe('Sfx fuel cues', () => {
  it('are safe with no audio context (Node / before the first gesture): nothing plays, nothing throws', () => {
    const sfx = new Sfx(() => null as unknown as AudioContext, fakeBank().bank); // a factory that yields no context
    expect(sfx.engineStall()).toBe(0);
    expect(sfx.fuelPour()).toBe(0);
    expect(() => { sfx.stopFuelPour(); sfx.hoseConnect(true); sfx.hoseConnect(false, {x: 1, y: 1, z: 1}); sfx.cartRoll(0.7); sfx.cartRoll(0); sfx.stopCartRoll(); sfx.pause(); }).not.toThrow();
    sfx.init(); // the factory yields nothing: still no context
    expect(sfx.engineStall()).toBe(0);
    expect(sfx.fuelAudioState()).toMatchObject({cart: false, stall: false, pour: false});
    // and a plain Sfx in Node (no window, no factory)
    const bare = new Sfx(undefined, fakeBank().bank);
    expect(bare.engineStall()).toBe(0);
    expect(() => bare.cartRoll(1)).not.toThrow();
  });

  it('engineStall: ONE non-looping take per call; a second call cuts the first (never stacked, never a loop)', async () => {
    const {sfx, ctx} = await audio();
    const s0 = ctx.started.length;
    expect(sfx.engineStall()).toBeGreaterThan(0);
    const first = ctx.started.slice(s0) as Rec[];
    expect(first).toHaveLength(1);
    expect(first[0].loop).toBe(false);
    expect(first[0].stopAt).toBeDefined(); // a one-shot ends by itself (playClip schedules its end)
    const scheduledEnd = first[0].stopAt!;
    expect(sfx.fuelAudioState().stall).toBe(true);
    ctx.currentTime += 0.1;
    sfx.engineStall();
    const second = ctx.started.slice(s0 + 1) as Rec[];
    expect(second).toHaveLength(1);
    expect(first[0].stopAt!).toBeLessThan(scheduledEnd); // the first was cut early
    ctx.currentTime += 5;
    expect(sfx.fuelAudioState().stall).toBe(false);
    expect(ctx.started.length).toBe(s0 + 2); // nothing re-triggers by itself
  });

  it('fuelPour plays once; stopFuelPour cuts it (a cancelled pour)', async () => {
    const {sfx, ctx} = await audio();
    const s0 = ctx.started.length;
    expect(sfx.fuelPour()).toBeGreaterThan(0);
    const src = ctx.started[s0] as Rec;
    expect(ctx.started.length).toBe(s0 + 1);
    expect(src.loop).toBe(false);
    const end = src.stopAt!;
    sfx.stopFuelPour();
    expect(src.stopAt!).toBeLessThan(end);
    expect(sfx.fuelAudioState().pour).toBe(false); // released (its sources fade out over FUEL_AUDIO.pour.cutFade)
    expect(src.stopAt! - ctx.currentTime).toBeLessThanOrEqual(FUEL_AUDIO.pour.cutFade + 0.03);
  });

  it('hoseConnect reuses existing clips (magazine seat / release + click), positional at the cap', async () => {
    const {sfx, ctx, buffers} = await audio();
    const s0 = ctx.started.length;
    sfx.hoseConnect(true, {x: 2, y: 1.9, z: -1.5});
    sfx.hoseConnect(false);
    const played = ctx.started.slice(s0);
    expect(played).toHaveLength(4);
    for (const s of played) expect(buffers.has(s.buffer)).toBe(true);
    expect(FUEL_AUDIO.hose.on.cue).toBe('rifleMagIn');
    expect(FUEL_AUDIO.hose.off.cue).toBe('rifleMagOut');
  });

  it('cartRoll: one loop channel while rolling (never restarted per frame), eased to the speed; stops at 0 after the idle time, on pause and a new world', async () => {
    const {sfx, ctx} = await audio();
    const s0 = ctx.started.length;
    for (let i = 0; i < 60; i++) { ctx.currentTime += 1 / 60; sfx.cartRoll(0.3 + 0.01 * (i % 5), {x: 1, y: 0.3, z: 2}); }
    const loops = ctx.started.slice(s0) as Rec[];
    expect(loops).toHaveLength(1);
    expect(loops[0].loop).toBe(true);
    expect(loops[0].stopAt).toBeUndefined();
    expect(sfx.fuelAudioState()).toMatchObject({cart: true, cartStarts: 1});
    // the channel starts from silence: its fade gain begins at 0 and only a target is set (never a jump to full level)
    const fade = loops[0].outputs[0].outputs[0] as unknown as {gain: {value: number}};
    expect(fade.gain.value).toBeLessThanOrEqual(CUE_GAIN.cartRoll);
    // speed 0: fades, and is released after idleStopS unless it rolls again
    sfx.cartRoll(0);
    sfx.cartRoll(0);
    expect(sfx.fuelAudioState().cart).toBe(true);
    sfx.cartRoll(0.5); // rolls again before the idle time: the same channel
    expect(ctx.started.length).toBe(s0 + 1);
    sfx.cartRoll(0);
    await wait(FUEL_AUDIO.cart.idleStopS * 1000 + 80);
    expect(sfx.fuelAudioState()).toMatchObject({cart: false, cartStops: 1});
    expect(loops[0].stopAt).toBeDefined();
    // pause stops it at once; a new world too
    sfx.cartRoll(0.8);
    expect(sfx.fuelAudioState().cartStarts).toBe(2);
    sfx.pause();
    expect(sfx.fuelAudioState().cart).toBe(false);
    sfx.cartRoll(0.8); // paused: nothing starts
    expect(sfx.fuelAudioState().cart).toBe(false);
    sfx.resume();
    sfx.cartRoll(0.8);
    expect(sfx.fuelAudioState().cart).toBe(true);
    sfx.setWorld({occlusion: null});
    expect(sfx.fuelAudioState().cart).toBe(false);
    expect(ctx.oscillatorCalls).toBe(0);
  });
});

describe('fuel clips (local Sound Lab, 3 jobs of the 6 allowed)', () => {
  it('manifest + provenance: three cues, whole-second requests, not auditioned, conditional licence', () => {
    for (const cue of ['engineStall', 'fuelPour', 'cartRoll'] as const) {
      expect(CUES as readonly string[]).toContain(cue);
      expect(CUE_GAIN[cue]).toBeGreaterThan(0);
      expect(CLIP_MANIFEST_FUEL[cue]).toHaveLength(1);
    }
    expect(CLIP_MANIFEST_FUEL.cartRoll[0].loop).toBeTruthy();
    const prov = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../public/assets/derivatives/audio-fuel.json', import.meta.url)), 'utf8'));
    expect(prov.derivatives).toHaveLength(3);
    expect(prov.generatedBy).toMatch(/3 jobs of a 6-job cap/);
    expect(prov.license).toMatchObject({gameReady: false, approved: false});
    expect(prov.license.review).toMatch(/NOT LISTENED TO/);
    for (const d of prov.derivatives) {
      expect(Number.isInteger(d.source.seconds)).toBe(true);
      expect(d.source.prompt).toMatch(/^TrackType: SFX/);
      expect(d.source.jobId).toMatch(/^\d{8}T\d{6}-\d+$/);
    }
    const notice = fs.readFileSync(fileURLToPath(new URL('../public/assets/audio/NOTICE.md', import.meta.url)), 'utf8');
    expect(notice).toContain('../derivatives/audio-fuel.json');
  });
});
