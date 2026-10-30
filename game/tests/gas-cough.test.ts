// Task gas-mask-roof-feedback-20261030 (item 1): the player's cough while toxic gas hurts them — pacing / one voice / lifecycle
// (audio/cough.ts), and the shipped Sound Lab takes (manifest, files, provenance, allowlist).
import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {COUGH, CoughFeedback, installCough} from '../src/audio/cough';
import {CLIP_MANIFEST, CUES} from '../src/audio/bank';
import {CUE_GAIN} from '../src/audio/sfx';

const pub = (rel: string) => fileURLToPath(new URL(`../public/${rel}`, import.meta.url));

/** A fake Sfx whose coughs last `dur` s; records when coughs start / stop on the simulated clock. */
function fakeSfx(dur = 1.4) {
  const log = {starts: [] as number[], stops: 0, now: 0};
  return {log, sfx: {cough: () => { log.starts.push(log.now); return dur; }, stopCough: () => { log.stops++; }}};
}
/** Run `seconds` of frames at `dt`, hurting per `hurting(t)`. */
function run(c: CoughFeedback, log: {now: number}, seconds: number, hurting: (t: number) => boolean, dt = 1 / 60) {
  const end = log.now + seconds;
  while (log.now < end - 1e-9) { c.update(dt, hurting(log.now)); log.now += dt; }
}
const rand = () => 0.5; // mid-range delays: deterministic

describe('cough pacing', () => {
  it('never coughs in clean air or while protected (not hurting)', () => {
    const {log, sfx} = fakeSfx(), c = new CoughFeedback(sfx, rand);
    run(c, log, 30, () => false);
    expect(log.starts).toEqual([]);
  });

  it('first cough shortly after the damage starts, then spaced by the clip + a randomised gap; one at a time', () => {
    const {log, sfx} = fakeSfx(1.4), c = new CoughFeedback(sfx, rand);
    run(c, log, 20, () => true);
    expect(log.starts[0]).toBeGreaterThanOrEqual(COUGH.first[0] - 1e-6);
    expect(log.starts[0]).toBeLessThanOrEqual(COUGH.first[1] + 1 / 60);
    for (let i = 1; i < log.starts.length; i++) {
      const gap = log.starts[i] - log.starts[i - 1];
      expect(gap).toBeGreaterThanOrEqual(1.4 + COUGH.gap[0] - 1e-6); // never overlapping, never faster than the gap
      expect(gap).toBeLessThanOrEqual(1.4 + COUGH.gap[1] + 1 / 30);
    }
    expect(log.starts.length).toBeGreaterThanOrEqual(4);
    expect(log.starts.length).toBeLessThanOrEqual(6);
  });

  it('frame rate does not change the cadence (tiny or large frames, many updates per second)', () => {
    const a = fakeSfx(), b = fakeSfx();
    const ca = new CoughFeedback(a.sfx, rand), cb = new CoughFeedback(b.sfx, rand);
    run(ca, a.log, 20, () => true, 1 / 240);
    run(cb, b.log, 20, () => true, 0.05);
    expect(Math.abs(a.log.starts.length - b.log.starts.length)).toBeLessThanOrEqual(1);
  });

  it('flickering in and out of gas does not spam: a rest after every cough', () => {
    const {log, sfx} = fakeSfx(1.0), c = new CoughFeedback(sfx, rand);
    run(c, log, 20, t => Math.floor(t / 0.25) % 2 === 0); // hurting 0.25 s on / 0.25 s off
    for (let i = 1; i < log.starts.length; i++) expect(log.starts[i] - log.starts[i - 1]).toBeGreaterThanOrEqual(1.0 + COUGH.rest - 1e-6);
  });

  it('reset (left play / death) silences a sounding cough and starts over', () => {
    const {log, sfx} = fakeSfx(), c = new CoughFeedback(sfx, rand);
    run(c, log, 1, () => true);
    expect(log.starts.length).toBe(1);
    c.reset();
    expect(log.stops).toBe(1);
  });

  it('installCough: only unprotected damage while playing and alive; leaving play resets', () => {
    const {log, sfx} = fakeSfx();
    const host = {state: 'playing', player: {alive: true}, gas: {exposure: {dps: 0, protected: false}}, sfx,
      frameHooks: [] as ((dt: number) => void)[], stateListeners: [] as ((s: never, p: never) => void)[]};
    const c = installCough(host);
    const tick = (s: number) => { for (let t = 0; t < s; t += 1 / 60) { host.frameHooks.forEach(h => h(1 / 60)); log.now += 1 / 60; } };
    tick(3);
    expect(c.coughs).toBe(0); // clean air
    host.gas.exposure = {dps: 4, protected: true};
    tick(3);
    expect(c.coughs).toBe(0); // a working mask: no damage, no cough
    host.gas.exposure = {dps: 4, protected: false};
    tick(1);
    expect(c.coughs).toBe(1);
    host.player.alive = false;
    tick(10);
    expect(c.coughs).toBe(1); // dead: silent
    (host.stateListeners as unknown as ((s: string) => void)[]).forEach(f => f('dead'));
    expect(log.stops).toBeGreaterThanOrEqual(1);
  });
});

describe('shipped cough takes', () => {
  const prov = JSON.parse(readFileSync(pub('assets/derivatives/audio-cough.json'), 'utf8')) as {
    derivatives: {url: string; bytes: number; sha256: string; durationS: number; source: {clip: string; jobId: string; seed: number}; structural: {quietFrac: number; coughEvents: number}}[];
    excluded: {id: string}[]};

  it('the cue is registered with every structurally usable take and a restrained gain', () => {
    expect(CUES).toContain('cough');
    expect(CUE_GAIN.cough).toBeLessThan(CUE_GAIN.hurt);
    const clips = CLIP_MANIFEST.cough;
    expect(clips.map(c => c.url).sort()).toEqual(prov.derivatives.map(d => d.url).sort());
    expect(clips.length).toBeGreaterThanOrEqual(5);
  });

  it('files match their provenance; takes are distinct jobs / seeds; excluded takes are not shipped', () => {
    const seeds = new Set<number>(), jobs = new Set<string>();
    for (const d of prov.derivatives) {
      const b = readFileSync(pub(d.url));
      expect(b.length).toBe(d.bytes);
      expect(createHash('sha256').update(b).digest('hex')).toBe(d.sha256);
      expect(d.structural.quietFrac).toBeGreaterThanOrEqual(0.15); // discrete cough bursts, not continuous noise
      expect(d.durationS).toBeGreaterThan(0.5);
      expect(d.durationS).toBeLessThan(3.1);
      seeds.add(d.source.seed); jobs.add(d.source.jobId);
    }
    expect(seeds.size).toBe(prov.derivatives.length);
    expect(jobs.size).toBe(prov.derivatives.length);
    for (const e of prov.excluded) expect(CLIP_MANIFEST.cough.some(c => c.src === e.id)).toBe(false);
  });
});
