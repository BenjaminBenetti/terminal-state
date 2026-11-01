// Task studio-alpha-track2-round2-20261031-01 (R4, audio): the annex fans' noise. STRUCTURAL evidence on a fake WebAudio context
// (routing, voice bound, storey gate, occlusion, world change / pause lifecycle) — NOT an audition: the recording is the accepted
// bed-hvac-02-loop (Sound Lab, iteration 05) and nobody listened to the result on the build worker.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CLIP_MANIFEST} from '../src/audio/bank';
import {FAN_RADIUS_SCALE, FAN_SOUND, audibleFans, fanSources, type FanSource} from '../src/audio/fanSound';
import {Sfx} from '../src/audio/sfx';
import {FakeCtx, fakeBank, type Node, type Src} from './helpers/fakeAudio';
import {freshLayout} from './helpers/annexRoute';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settle = () => new Promise(r => setTimeout(r, 40));
const fan = (x: number, z: number, floorY = 0, rate = 1): FanSource => ({x, y: floorY + 1.1, z, floorY, kind: 'fanWall', rate});

async function setup() {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 2});
  const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  const ctx = made[0];
  const hvac = new Set(bank.get('bedHvac').map(c => c.buffer as unknown));
  return {sfx, ctx, hvacSrcs: () => ctx.started.filter(s => hvac.has(s.buffer))};
}
/** Walk a source's outputs down to its fan channel's gain / panner. */
const gainOf = (s: Src) => (s.outputs[0] as unknown as {gain: {value: number}}).gain.value;
const pannerOf = (s: Src) => { let n: Node = s.outputs[0]; while (n && n.kind !== 'panner') n = n.outputs[0]; return n as unknown as {positionX: {value: number}; positionZ: {value: number}}; };
const tick = (sfx: Sfx, x: number, y: number, z: number) => { for (let k = 0; k < 13; k++) sfx.setListener(x, y, z, 0); };

describe('R4 fan sound: an accepted existing recording, fixed voices, storey / distance / occlusion aware', () => {
  it('the source is the accepted HVAC loop (fan hum + duct air) from the shipped manifest; no new file, no synthesis', () => {
    const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/audio-iteration05.json'), 'utf8'));
    const rec = JSON.stringify(prov);
    expect(rec).toContain('bed-hvac-02-loop.mp3');
    expect(rec).toMatch(/steady ventilation system, air rushing through ducts and a constant fan hum/);
    expect(CLIP_MANIFEST.bedHvac.map(r => r.url)).toContain('assets/audio/bed-hvac-02-loop.mp3');
  });

  it('positions: every fanWall / fanUnit record of a fresh annex level, at hub height, on its annex floor; none without annexes', () => {
    const L = freshLayout('subway', 1043);
    const machines = L.extensions!.machines!.filter(m => m.kind === 'fanWall' || m.kind === 'fanUnit');
    const fans = fanSources(L);
    expect(fans.length).toBe(machines.length);
    expect(fans.length).toBeGreaterThan(0);
    fans.forEach((f, i) => {
      const m = machines[i];
      expect(f.floorY).toBe(m.y);
      expect(f.y - m.y).toBeGreaterThan(0.8);
      expect(Math.hypot(f.x - m.x, f.z - m.z)).toBeLessThan(Math.max(m.w, m.d)); // inside its own footprint
      expect(f.rate).toBeGreaterThanOrEqual(0.9);
      expect(f.rate).toBeLessThanOrEqual(1.1);
    });
    expect(fanSources(freshLayout('subway', 1))).toEqual([]);
  });

  it('selection: nearest first, within range, same storey only, at most the voice pool', () => {
    const fans = [fan(3, 0), fan(1, 0), fan(10, 0), fan(90, 0), fan(1, 0.5, 5)];
    const got = audibleFans(fans, {x: 0, y: 1.6, z: 0}, 0, 2);
    expect(got.map(g => g.fan)).toEqual([fans[1], fans[0]]);
    expect(audibleFans(fans, {x: 0, y: 1.6, z: 0}, 0, 9).map(g => g.fan)).not.toContain(fans[3]); // beyond maxDist
    expect(audibleFans(fans, {x: 0, y: 1.6, z: 0}, 0, 9).map(g => g.fan)).not.toContain(fans[4]); // the storey above
    expect(audibleFans(fans, {x: 0, y: 6.6, z: 0}, 5, 9).map(g => g.fan)).toEqual([fans[4]]);
    expect(FAN_SOUND.voices).toBe(2);
  });

  it('round 3: the radius is 5x round 2 — cut-off 70 m, and the inverse law scaled so 5 d sounds like d did (not just a later cut-off)', () => {
    expect(FAN_RADIUS_SCALE).toBe(5);
    expect(FAN_SOUND.maxDist).toBe(70);
    expect(FAN_SOUND.ref).toBeCloseTo(7, 9);
    // WebAudio 'inverse' distance model: g(d) = ref / (ref + rolloff (max(d, ref) - ref))
    const g = (d: number, ref: number) => ref / (ref + FAN_SOUND.rolloff * (Math.max(d, ref) - ref));
    for (const d of [2, 5, 10, 14]) expect(g(5 * d, FAN_SOUND.ref)).toBeCloseTo(g(d, 1.4), 9);
    // a fan 40 m down the corridor is now in range (it was cut off beyond 14 m) at the level round 2 had at 8 m
    expect(audibleFans([fan(40, 0)], {x: 0, y: 1.6, z: 0}, 0).length).toBe(1);
  });

  it('runtime: fixed channels on the HVAC clip, follow the listener, muffle when occluded, release on a world change; nothing leaks', async () => {
    const {sfx, ctx, hvacSrcs} = await setup();
    tick(sfx, 0, 1.6, 0);
    const before = ctx.nodes.length;
    const srcs = () => hvacSrcs().filter(s => s.outputs[0] && pannerOf(s));
    // the bed itself + FAN_SOUND.voices fan loops, started once (page lifetime)
    expect(hvacSrcs().length).toBe(1 + FAN_SOUND.voices);
    expect(ctx.oscillatorCalls).toBe(0);
    let occluded = false;
    sfx.setWorld({occlusion: () => (occluded ? 1 : 0), fans: [fan(2, 0, 0, 0.95), fan(-4, 0, 0, 1.05), fan(9, 0)]});
    tick(sfx, 0, 1.6, 0);
    const fanSrcs = srcs();
    expect(fanSrcs.length).toBe(FAN_SOUND.voices);
    const on = fanSrcs.filter(s => gainOf(s) > 0);
    expect(on.length).toBe(2);
    expect(on.map(s => pannerOf(s).positionX.value).sort((a, b) => a - b)).toEqual([-4, 2]);
    expect(on.map(s => s.playbackRate.value).sort()).toEqual([0.95, 1.05]);
    expect(sfx.debugState().fans).toEqual({sources: 3, channels: 2, active: 2, looping: 2});
    const clear = Math.max(...on.map(gainOf));
    occluded = true;
    tick(sfx, 0, 1.6, 0);
    expect(Math.max(...on.map(gainOf))).toBeLessThan(clear);
    occluded = false;
    // walk away (beyond range) -> silent; another storey -> silent
    tick(sfx, 200, 1.6, 0);
    expect(fanSrcs.every(s => gainOf(s) === 0)).toBe(true);
    tick(sfx, 0, 6.6, 0);
    expect(fanSrcs.every(s => gainOf(s) === 0)).toBe(true);
    tick(sfx, 0, 1.6, 0);
    expect(fanSrcs.filter(s => gainOf(s) > 0).length).toBe(2);
    // a new world without annexes releases every fan; repeated world changes create no nodes or sources
    for (let k = 0; k < 5; k++) { sfx.setWorld({fans: k % 2 ? [] : [fan(1, 1)]}); tick(sfx, 0, 1.6, 0); }
    sfx.setWorld({fans: []});
    tick(sfx, 0, 1.6, 0);
    expect(fanSrcs.every(s => gainOf(s) === 0)).toBe(true);
    expect(sfx.debugState().fans.active).toBe(0);
    expect(hvacSrcs().length).toBe(1 + FAN_SOUND.voices);
    expect(ctx.nodes.length).toBe(before);
    // pause: the page master mutes (the fans ride the ambient bus); resume restores — no per-fan teardown needed
    sfx.suspend(true);
    await settle();
    sfx.suspend(false);
    await settle();
    expect(hvacSrcs().length).toBe(1 + FAN_SOUND.voices);
  });
});
