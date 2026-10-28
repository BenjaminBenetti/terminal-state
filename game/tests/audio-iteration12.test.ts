// Iteration 12 (AUDIO lane): flashlight battery + thrown flare cues (Sound Lab clips; graph/lifecycle checks with a fake context).
import {describe, expect, it} from 'vitest';
import {CLIP_GAPS_I12, CLIP_MANIFEST_I12} from '../src/audio/manifest.iteration12.generated';
import {FLARE_LOOP, Sfx} from '../src/audio/sfx';
import {FakeCtx, fakeBank, type Panner} from './helpers/fakeAudio';
import type {CueId} from '../src/audio/bank';

const settle = () => new Promise(r => setTimeout(r, 40));
const NEW_CUES = ['batteryInsert', 'flareIgnite', 'flareBurn', 'flareOut', 'flashlightFlicker'] as const;

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

describe('iteration-12 cue bank', () => {
  it('every new cue has a bundled Sound Lab derivative (no gaps); the burn is a 3-4 s seamless loop', () => {
    expect(CLIP_GAPS_I12).toEqual([]);
    for (const c of NEW_CUES) expect(CLIP_MANIFEST_I12[c]?.length ?? 0, c).toBeGreaterThan(0);
    const burn = CLIP_MANIFEST_I12.flareBurn[0];
    expect(burn.loop).toBeTruthy();
    expect(burn.loop!.length).toBeGreaterThanOrEqual(3);
    expect(burn.loop!.length).toBeLessThanOrEqual(4);
    expect(burn.dur).toBeGreaterThanOrEqual(burn.loop!.start + burn.loop!.length);
    expect(CLIP_MANIFEST_I12.flashlightFlicker.length).toBeGreaterThanOrEqual(2); // variants for repeated flickers
  });
});

describe('flare burn loop', () => {
  it('is a spatial looping voice that follows the flare and fades out on stop()', async () => {
    const {sfx, ctx, of} = await setup();
    const p0 = ctx.nodes.filter(n => n.kind === 'panner').length;
    const h = sfx.flareBurnStart(4, 0.1, -6);
    expect(h.playing).toBe(true);
    const [src] = of('flareBurn');
    expect(src.loop).toBe(true);
    expect(src.loopEnd).toBeGreaterThan(src.loopStart);
    const pans = ctx.nodes.filter(n => n.kind === 'panner') as Panner[];
    expect(pans.length).toBe(p0 + 1);
    const p = pans.at(-1)!;
    expect([p.positionX.value, p.positionY.value, p.positionZ.value]).toEqual([4, 0.1, -6]);
    h.setPos(5, 0.2, -7);
    expect([p.positionX.value, p.positionY.value, p.positionZ.value]).toEqual([5, 0.2, -7]);
    expect(sfx.debugState().flareLoops).toBe(1);
    h.stop();
    expect(h.playing).toBe(false);
    expect(sfx.debugState().flareLoops).toBe(0);
    h.stop(); // idempotent
    h.setPos(9, 9, 9); // ignored after stop
    expect(p.positionX.value).toBe(5);
  });

  it('is bounded (the oldest makes room) and every loop stops on a new station', async () => {
    const {sfx, ctx} = await setup();
    const hs = Array.from({length: FLARE_LOOP.max + 3}, (_, i) => { ctx.currentTime += 0.1; return sfx.flareBurnStart(i, 0.1, -3); });
    expect(sfx.debugState().flareLoops).toBe(FLARE_LOOP.max);
    expect(hs.slice(0, 3).every(h => !h.playing)).toBe(true);
    expect(hs.slice(3).every(h => h.playing)).toBe(true);
    sfx.setWorld({occlusion: () => 0, emitters: []}); // newStation()
    expect(sfx.debugState().flareLoops).toBe(0);
    expect(hs.every(h => !h.playing)).toBe(true);
    sfx.flareBurnStart(1, 0.1, 1);
    sfx.stopFlares();
    expect(sfx.debugState().flareLoops).toBe(0);
  });

  it('occlusion and distance muffle it (lowpass + level) but never cut the loop', async () => {
    const {sfx, ctx} = await setup();
    let occ = 0;
    sfx.setWorld({occlusion: () => occ});
    sfx.flareBurnStart(0, 0.1, -10);
    const filters = ctx.nodes.filter(n => 'frequency' in n) as unknown as {frequency: {value: number}}[];
    const f = filters.at(-1)!, clear = f.frequency.value;
    occ = 1;
    for (let i = 0; i < 12; i++) { ctx.currentTime += 0.05; sfx.setListener(0, 1.6, 0, 0); }
    expect(f.frequency.value).toBeLessThan(clear * 0.2);
    expect(sfx.debugState().flareLoops).toBe(1);
  });

  it('is a silent no-op handle while paused or when the clip is missing', async () => {
    const {sfx, of} = await setup();
    sfx.suspend(true);
    const h = sfx.flareBurnStart(1, 0, 1);
    expect(h.playing).toBe(false);
    expect(of('flareBurn').length).toBe(0);
    h.setPos(2, 0, 2);
    h.stop();
    const m = await setup(['rifleShot']);
    const h2 = m.sfx.flareBurnStart(1, 0, 1);
    expect(h2.playing).toBe(false);
    expect(m.sfx.debugState().bank.silentCues).toContain('flareBurn');
  });
});

describe('battery / flare one-shots / flicker', () => {
  it('battery insert + flicker are listener-local; ignite / out are positional', async () => {
    const {sfx, ctx, of} = await setup();
    const panners = () => ctx.nodes.filter(n => n.kind === 'panner').length;
    let p0 = panners();
    sfx.batteryInsert();
    sfx.flashlightFlicker(0.3);
    expect(panners()).toBe(p0);
    expect(of('batteryInsert').length).toBe(1);
    expect(of('flashlightFlicker').length).toBe(1);
    p0 = panners();
    sfx.flareIgnite(0.3, 1.3, -0.4);
    sfx.flareOut(8, 0.1, -12);
    expect(panners()).toBe(p0 + 2);
    expect(of('flareIgnite').length).toBe(1);
    expect(of('flareOut').length).toBe(1);
  });

  it('flicker crackles are rate-limited (burst 2, 3/s) so a per-frame caller cannot spam them', async () => {
    const {sfx, ctx, of} = await setup();
    for (let i = 0; i < 30; i++) sfx.flashlightFlicker(1);
    expect(of('flashlightFlicker').length).toBe(2);
    for (let i = 0; i < 60; i++) { ctx.currentTime += 1 / 60; sfx.flashlightFlicker(1); }
    expect(of('flashlightFlicker').length).toBeLessThanOrEqual(2 + 3 + 1);
  });
});
