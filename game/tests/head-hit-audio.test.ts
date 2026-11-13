// Task studio-general-armor-20261107-231448-01 (user: "lets have a different impact sound when you hit the zombies head ... This will give
// better feedback when you hit the weak spot"): a confirmed HEAD hit layers the headHit skull crack (two Sound Lab takes, local, 2 of a
// 4-job allowance) on the same foreground hit confirm voice — never a miss, a torso / limb hit, or an aim near the head. The damage
// multipliers are unchanged. These tests check the Web Audio graph with a fake context — they are not a listening test.
import fs from 'node:fs';
import {describe, expect, it} from 'vitest';
import {CUE_GAIN, HIT_CONFIRM, Sfx} from '../src/audio/sfx';
import {CLIP_MANIFEST, CUES} from '../src/audio/bank';
import {CLIP_MANIFEST_HEAD_HIT} from '../src/audio/manifest.headHit.generated';
import {FakeCtx, fakeBank} from './helpers/fakeAudio';
import {WEAPONS} from '../src/weapons/weapons';

const settle = () => new Promise(r => setTimeout(r, 40));
const src = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

async function setup() {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 2});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  sfx.setListener(0, 1.6, 0, 0);
  const of = (cue: 'impactFlesh' | 'headHit') => new Set(bank.get(cue).map(c => c.buffer as unknown));
  const flesh = of('impactFlesh'), head = of('headHit');
  return {sfx, ctx, flesh: () => ctx.started.filter(s => flesh.has(s.buffer)), head: () => ctx.started.filter(s => head.has(s.buffer))};
}

describe('head-hit feedback: a distinct skull crack on a confirmed head hit', () => {
  it('the cue is in the bank: two generated takes, short one-shots, bundled', () => {
    expect(CUES).toContain('headHit');
    expect(CLIP_MANIFEST.headHit).toEqual(CLIP_MANIFEST_HEAD_HIT.headHit);
    expect(CLIP_MANIFEST.headHit.map(c => c.url)).toEqual(['assets/audio/head-hit-01.mp3', 'assets/audio/head-hit-02.mp3']);
    for (const c of CLIP_MANIFEST.headHit) {
      expect(c.dur).toBeGreaterThan(0.2);
      expect(c.dur).toBeLessThan(0.4);
      expect(fs.statSync(new URL(`../public/${c.url}`, import.meta.url)).size).toBeGreaterThan(1000);
    }
    expect(CUE_GAIN.headHit).toBeGreaterThan(0);
  });

  it('a head hit plays the flesh confirm AND the crack, same voice, same onset; a body hit only the flesh confirm', async () => {
    const {sfx, ctx, flesh, head} = await setup();
    sfx.shot('rifle');
    sfx.hitConfirm(0, 1.4, -20, {}, false);
    expect([flesh().length, head().length]).toEqual([1, 0]);
    ctx.currentTime += 1;
    sfx.shot('rifle');
    sfx.hitConfirm(0, 1.4, -20, {}, true);
    expect([flesh().length, head().length]).toEqual([2, 1]);
    const f = flesh()[1], h = head()[0];
    expect(h.startArgs[0]).toBeCloseTo(f.startArgs[0], 6); // the same onset (after the gunshot's transient)
    // the same voice: both sources feed the same voice input
    const voiceIn = (s: typeof f) => s.outputs[0].outputs[0];
    expect(voiceIn(h)).toBe(voiceIn(f));
    // its level: headLevel on the -1 dBFS take
    expect((h.outputs[0] as unknown as {gain: {value: number}}).gain.value).toBeCloseTo(HIT_CONFIRM.headLevel, 6);
    expect(sfx.headConfirms).toBe(1);
  });

  it('once per enemy per shot (a shotgun\'s pellets on one head are one crack); another enemy of the same shot gets its own', async () => {
    const {sfx, head} = await setup();
    const a = {}, b = {};
    sfx.shot('shotgun');
    sfx.hitConfirm(0, 1.4, -5, a, true);
    sfx.hitConfirm(0, 1.4, -5, a, true);
    expect(head().length).toBe(1);
    sfx.hitConfirm(1, 1.4, -6, b, true);
    expect(head().length).toBe(2);
  });

  it('the game passes the CONFIRMED hit part: guns (any pellet of the shot that hit this enemy\'s head volume) and the knife', () => {
    const game = src('game.ts');
    expect(game).toMatch(/e\.head \|\|= bestPart === 'head';/); // set only from the hit volume the ray hit
    // (task studio-bb-production-20261112-234540-01, re-pin: the same confirmed part, minus the crack on a NON-GRAPHIC body — BB; the
    // confirm itself, the head damage and the headshot count are unchanged: tests/bb-nongraphic.test.ts)
    expect(game).toMatch(/this\.sfx\.hitConfirm\(e\.point\.x, e\.point\.y, e\.point\.z, z, e\.head && !z\.nonGraphic\);/);
    expect(game).toMatch(/this\.sfx\.hitConfirm\(point\.x, point\.y, point\.z, z, res\.part === 'head' && !z\.nonGraphic\);/);
    expect(game).toMatch(/if \(e\.head\) this\.stats\.headshots\+\+;/);
    // corpses / world / misses never call hitConfirm with a head flag (corpse hits keep impact())
    expect(game.match(/hitConfirm\(/g)?.length).toBe(2);
  });

  it('no damage rebalance: the head multipliers are unchanged (rifle 2.5, pistol 2.4, shotgun 1.8, knife 2)', () => {
    const m = Object.fromEntries(Object.values(WEAPONS).map(w => [w.id, w.headMult]));
    expect(m).toMatchObject({rifle: 2.5, pistol: 2.4, shotgun: 1.8, knife: 2});
  });
});
