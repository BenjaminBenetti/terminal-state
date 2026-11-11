// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane AUDIO): the train CHIPPER's sound — the five Sound Lab cues' registration
// (bank CUES / manifest / CUE_GAIN / hash-only provenance / allowlist; the head-hit clips and the gun-variety voices untouched) and
// audio/chipperAudio.ts over a fake machine Sfx (start / feed / grind / stop / silence / frame, the re-request after a world change or an
// eviction, never a second loop) and over the real Sfx on the fake WebAudio context. Nothing here listens to the clips.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {CHIPPER_AUDIO, ChipperAudio} from '../src/audio/chipperAudio';
import {CLIP_MANIFEST, CUES} from '../src/audio/bank';
import {CUE_GAIN, MACHINE_LOOP, Sfx, type MachineCue, type MachineLoopCue} from '../src/audio/sfx';
import {CLIP_BYTES_CHIPPER, CLIP_GAPS_CHIPPER, CLIP_MANIFEST_CHIPPER} from '../src/audio/manifest.chipper.generated';
import {CLIP_MANIFEST_HEAD_HIT} from '../src/audio/manifest.headHit.generated';
import {CLIP_MANIFEST_GUN_VARIETY, GUN_VARIETY_CUES, GUN_VARIETY_CUE_GAIN} from '../src/audio/manifest.gunVariety.generated';
import {CLIP_MANIFEST as CLIP_MANIFEST_I05} from '../src/audio/manifest.generated';
import {CLIP_MANIFEST_I06} from '../src/audio/manifest.iteration06.generated';
import {CLIP_MANIFEST_I07K} from '../src/audio/manifest.iteration07k.generated';
import {CLIP_MANIFEST_I07Q} from '../src/audio/manifest.iteration07q.generated';
import {CLIP_MANIFEST_I11} from '../src/audio/manifest.iteration11.generated';
import {CLIP_MANIFEST_I12} from '../src/audio/manifest.iteration12.generated';
import {CLIP_MANIFEST_COUGH} from '../src/audio/manifest.cough.generated';
import {CLIP_MANIFEST_T1} from '../src/audio/manifest.track1.generated';
import {CLIP_MANIFEST_STRAINER} from '../src/audio/manifest.strainer.generated';
import {CLIP_MANIFEST_REACTOR} from '../src/audio/manifest.reactor.generated';
import {CLIP_MANIFEST_REACTOR_STARTUP} from '../src/audio/manifest.reactorStartup.generated';
import {CLIP_MANIFEST_REACTOR_ENDING} from '../src/audio/manifest.reactorEnding.generated';
import {CLIP_MANIFEST_FUEL} from '../src/audio/manifest.fuel.generated';
import {CLIP_MANIFEST_SKYWAYS_CAR} from '../src/audio/manifest.skywaysCar.generated';
import {CLIP_MANIFEST_SKYWAYS_DESTINATIONS} from '../src/audio/manifest.skywaysDestinations.generated';
import {CLIP_MANIFEST_MARKET_BAR} from '../src/audio/manifest.marketBar.generated';
import {FakeCtx, fakeBank} from './helpers/fakeAudio';

/** Every other build's manifest (the bank spreads the chipper's last: a name clash would silently shadow a cue). */
const manifests = {CLIP_MANIFEST_I05, CLIP_MANIFEST_I06, CLIP_MANIFEST_I07K, CLIP_MANIFEST_I07Q, CLIP_MANIFEST_I11, CLIP_MANIFEST_I12, CLIP_MANIFEST_COUGH,
  CLIP_MANIFEST_T1, CLIP_MANIFEST_STRAINER, CLIP_MANIFEST_REACTOR, CLIP_MANIFEST_REACTOR_STARTUP, CLIP_MANIFEST_REACTOR_ENDING, CLIP_MANIFEST_FUEL,
  CLIP_MANIFEST_SKYWAYS_CAR, CLIP_MANIFEST_SKYWAYS_DESTINATIONS, CLIP_MANIFEST_HEAD_HIT, CLIP_MANIFEST_MARKET_BAR, CLIP_MANIFEST_GUN_VARIETY};

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const CHIPPER_CUES = ['chipperMotor', 'chipperGrind', 'chipperFeed', 'chipperStart', 'chipperStop'] as const;
const LOOPS = new Set<string>(['chipperMotor', 'chipperGrind']);
const settle = () => new Promise(r => setTimeout(r, 40));
const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/audio-chipper.json'), 'utf8'));

describe('chipper cues: registration (5 local Sound Lab jobs of the 12 allowed)', () => {
  it('every new cue is a bank cue with exactly its one clip, a mix gain and the machine API type', () => {
    const loopCues: MachineLoopCue[] = ['chipperMotor', 'chipperGrind'];
    const oneShots: MachineCue[] = ['chipperFeed', 'chipperStart', 'chipperStop'];
    expect([...loopCues, ...oneShots].sort()).toEqual([...CHIPPER_CUES].sort());
    expect(Object.keys(CLIP_MANIFEST_CHIPPER).sort()).toEqual([...CHIPPER_CUES].sort());
    expect(CLIP_GAPS_CHIPPER).toEqual([]);
    let bytes = 0;
    for (const cue of CHIPPER_CUES) {
      expect(CUES as readonly string[]).toContain(cue);
      expect(CLIP_MANIFEST[cue]).toEqual(CLIP_MANIFEST_CHIPPER[cue]);
      expect(CLIP_MANIFEST[cue]).toHaveLength(1);
      const ref = CLIP_MANIFEST[cue][0];
      expect(ref.url).toMatch(/^assets\/audio\/chipper-[a-z-]+\.mp3$/);
      if (LOOPS.has(cue)) expect(ref.loop!.length).toBeGreaterThan(5); // the >= 5 s machine-bed rule (audio-bank.test)
      else expect(ref.loop).toBeUndefined();
      bytes += fs.statSync(path.join(GAME, 'public', ref.url)).size;
      expect(CUE_GAIN[cue]).toBeGreaterThan(0);
      expect(CUE_GAIN[cue]).toBeLessThanOrEqual(1);
      expect(CUE_GAIN[cue]).toBe(prov.mixCalibration.cues[cue].cueGain); // the build's loudness calibration is the mix
    }
    expect(bytes).toBe(CLIP_BYTES_CHIPPER);
    expect(bytes).toBeLessThan(200 * 1024);
    expect(MACHINE_LOOP.max).toBeGreaterThanOrEqual(12); // a full Reactor (10) + the chipper's two loops never evict back and forth
  });

  it('shadows no other cue, and leaves the head-hit clips and the gun-variety voices as they were', () => {
    for (const [name, m] of Object.entries(manifests)) for (const cue of CHIPPER_CUES) expect(Object.keys(m), name).not.toContain(cue);
    expect(CLIP_MANIFEST.headHit).toEqual(CLIP_MANIFEST_HEAD_HIT.headHit);
    expect(CLIP_MANIFEST.headHit.map(c => c.url)).toEqual(['assets/audio/head-hit-01.mp3', 'assets/audio/head-hit-02.mp3']);
    expect(CUE_GAIN.headHit).toBe(0.5);
    expect(GUN_VARIETY_CUES).toHaveLength(18);
    for (const cue of GUN_VARIETY_CUES) {
      expect(CLIP_MANIFEST[cue]).toEqual(CLIP_MANIFEST_GUN_VARIETY[cue]);
      expect(CUE_GAIN[cue]).toBe(GUN_VARIETY_CUE_GAIN[cue]);
    }
  });

  it('provenance is hash-only (no prompt text, no private path), whole seconds, not auditioned, conditional licence; notice + allowlist', () => {
    expect(prov.derivatives).toHaveLength(5);
    expect(prov.generatedBy).toMatch(/5 jobs of a 12-job cap/);
    expect(prov.license).toMatchObject({gameReady: false, approved: false});
    expect(prov.license.status).toMatch(/Conditional prototype/);
    expect(prov.license.review).toMatch(/NOT LISTENED TO/);
    const text = JSON.stringify(prov);
    expect(text).not.toMatch(/TrackType|reference\/|\.wav|https?:/);
    const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    const listed = new Map(allow.files.map(f => [f.path, f]));
    for (const d of prov.derivatives) {
      expect(Number.isInteger(d.source.seconds)).toBe(true);
      expect(d.source.prompt).toBeUndefined();
      expect(d.source.rawFile).toBeUndefined();
      expect(d.source.promptSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(d.source.rawSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(d.source.jobId).toMatch(/^\d{8}T\d{6}-\d+$/);
      const buf = fs.readFileSync(path.join(GAME, 'public', d.url));
      expect(createHash('sha256').update(buf).digest('hex')).toBe(d.sha256);
      expect(listed.get(d.url)).toEqual({path: d.url, bytes: buf.length, sha256: d.sha256});
      if (d.loop) expect(d.seam.wrapOverP99).toBeLessThanOrEqual(1); // structural loop-seam check (no click at the wrap)
    }
    for (const p of ['assets/derivatives/audio-chipper.json', 'assets/audio/NOTICE.md', 'assets/CREDITS.md']) {
      const buf = fs.readFileSync(path.join(GAME, 'public', p));
      expect(listed.get(p)?.sha256, p).toBe(createHash('sha256').update(buf).digest('hex'));
    }
    const notice = fs.readFileSync(path.join(GAME, 'public/assets/audio/NOTICE.md'), 'utf8');
    expect(notice).toMatch(/the train chipper set \([^)]*chipper-motor-loop\.mp3[^)]*\): \.\.\/derivatives\/audio-chipper\.json/);
    expect(notice).toMatch(/Powered by Stability AI/);
    expect(notice).toMatch(/conditional prototype status, not production or commercial clearance/);
    expect(fs.readFileSync(path.join(GAME, 'public/assets/CREDITS.md'), 'utf8')).toMatch(/BEGIN train-chipper-audio-20261111[\s\S]*conditional prototype status[\s\S]*END train-chipper-audio-20261111/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// ChipperAudio over a fake machine Sfx

class FakeLoop {
  stopped = false;
  stopFade: number | null = null;
  setPosCalls = 0;
  pos: [number, number, number];
  constructor(readonly cue: string, x: number, y: number, z: number, public rate: number) { this.pos = [x, y, z]; }
  setPos(x: number, y: number, z: number) { this.pos = [x, y, z]; this.setPosCalls++; }
  stop(f?: number) { if (!this.stopped) { this.stopped = true; this.stopFade = f ?? null; } }
  setLevel() {}
  setRate(r: number) { this.rate = r; }
  get playing() { return !this.stopped; }
}
class FakeSfx {
  live = true;
  cues: {cue: string; at: [number, number, number]; ref?: number; maxDist?: number}[] = [];
  loops: FakeLoop[] = [];
  reactorCue(cue: string, x: number, y: number, z: number, o: {ref?: number; maxDist?: number} = {}) { this.cues.push({cue, at: [x, y, z], ref: o.ref, maxDist: o.maxDist}); }
  reactorLoop(cue: string, x: number, y: number, z: number, o: {rate?: number} = {}) {
    if (!this.live) return null;
    const l = new FakeLoop(cue, x, y, z, o.rate ?? 1);
    this.loops.push(l);
    return l;
  }
  /** Sfx.setWorld -> stopMachines: every machine loop ends. */
  setWorld() { for (const l of this.loops) l.stop(0.05); }
  playing(cue: string) { return this.loops.filter(l => l.cue === cue && l.playing); }
  count(cue: string) { return this.cues.filter(c => c.cue === cue).length; }
}
function rig() {
  const sfx = new FakeSfx();
  const clock = {t: 100};
  const audio = new ChipperAudio(sfx as unknown as Sfx, () => clock.t);
  /** Run frames at 60 Hz for `s` seconds with the machine at x (it rides in the moving train). */
  const run = (s: number, x = 3) => { for (let i = 0; i < Math.round(s * 60); i++) { clock.t += 1 / 60; audio.frame(x, 1, -2); } };
  return {sfx, clock, audio, run};
}

describe('ChipperAudio (fake machine Sfx)', () => {
  it('start: ONE spin-up cue at the machine, the motor loop takes over after spinUpS, once; start() while running is a no-op', () => {
    const {sfx, audio, run} = rig();
    audio.start(2, 1, -2);
    expect(sfx.cues).toEqual([{cue: 'chipperStart', at: [2, 1, -2], ref: CHIPPER_AUDIO.ref, maxDist: CHIPPER_AUDIO.maxDist}]);
    expect(sfx.loops).toHaveLength(0);
    run(CHIPPER_AUDIO.spinUpS - 0.2);
    expect(sfx.loops).toHaveLength(0); // the spin-up take is still running up
    run(0.4);
    expect(sfx.playing('chipperMotor')).toHaveLength(1);
    run(5, 4.5); // the train moves: the loop follows, no second loop
    expect(sfx.loops).toHaveLength(1);
    expect(sfx.loops[0].pos).toEqual([4.5, 1, -2]);
    expect(sfx.loops[0].setPosCalls).toBeGreaterThan(250);
    audio.start(4.5, 1, -2);
    expect(sfx.count('chipperStart')).toBe(1);
    run(1);
    expect(sfx.loops).toHaveLength(1);
    expect(audio.debugState()).toMatchObject({running: true, motor: true, grind: false});
  });

  it('feed: one hopper cue per body, at the machine', () => {
    const {sfx, audio} = rig();
    audio.feed(1, 1.2, 0);
    audio.feed(1.5, 1.2, 0);
    expect(sfx.cues.map(c => [c.cue, c.at[0]])).toEqual([['chipperFeed', 1], ['chipperFeed', 1.5]]);
    expect(sfx.loops).toHaveLength(0);
  });

  it('grind: the wet layer over the motor while on (one loop; the motor bogs), faded out when off; the motor keeps running', () => {
    const {sfx, audio, run} = rig();
    audio.start(3, 1, -2);
    run(2);
    const motor = sfx.playing('chipperMotor')[0];
    audio.grind(true);
    audio.grind(true);
    expect(sfx.playing('chipperGrind')).toHaveLength(1);
    expect(motor.rate).toBe(CHIPPER_AUDIO.grindMotorRate);
    run(20); // one body: ~20 s of grinding
    expect(sfx.loops).toHaveLength(2);
    audio.grind(false);
    const g = sfx.loops.find(l => l.cue === 'chipperGrind')!;
    expect(g.stopped).toBe(true);
    expect(g.stopFade).toBe(CHIPPER_AUDIO.grindFadeS);
    expect(motor.playing).toBe(true);
    expect(motor.rate).toBe(1);
    run(3);
    expect(sfx.loops).toHaveLength(2); // nothing re-requested
  });

  it('stop: the wind-down cue, every loop ends (the motor under the wind-down), nothing comes back; a second stop is silent', () => {
    const {sfx, audio, run} = rig();
    audio.start(3, 1, -2);
    run(2);
    audio.grind(true);
    run(1);
    audio.stop(3, 1, -2);
    expect(sfx.count('chipperStop')).toBe(1);
    const [motor, grind] = sfx.loops;
    expect([motor.stopped, motor.stopFade, grind.stopped, grind.stopFade]).toEqual([true, CHIPPER_AUDIO.stopMotorFadeS, true, CHIPPER_AUDIO.grindFadeS]);
    run(5);
    expect(sfx.loops).toHaveLength(2);
    audio.stop(3, 1, -2);
    expect(sfx.count('chipperStop')).toBe(1);
    expect(audio.debugState()).toMatchObject({running: false, grinding: false, motor: false, grind: false});
  });

  it('a world change (Sfx.setWorld stops machine loops) or an eviction: frame() re-requests the loops that should run — no spin-up, no double', () => {
    const {sfx, audio, run} = rig();
    audio.start(3, 1, -2);
    run(2);
    audio.grind(true);
    run(2);
    sfx.setWorld(); // the train arrives in a new station: Sfx stops every machine loop
    expect(sfx.playing('chipperMotor')).toHaveLength(0);
    run(1 / 60, 7);
    expect(sfx.playing('chipperMotor')).toHaveLength(1);
    expect(sfx.playing('chipperGrind')).toHaveLength(1);
    expect(sfx.playing('chipperMotor')[0].pos).toEqual([7, 1, -2]);
    expect(sfx.playing('chipperMotor')[0].rate).toBe(CHIPPER_AUDIO.grindMotorRate); // re-requested under load
    expect(sfx.count('chipperStart')).toBe(1);
    run(3, 7);
    expect(sfx.loops).toHaveLength(4);
    // the bounded machine pool evicts the grind layer: it comes back within retryS, once
    sfx.playing('chipperGrind')[0].stop(0.4);
    run(CHIPPER_AUDIO.retryS + 0.1, 7);
    expect(sfx.playing('chipperGrind')).toHaveLength(1);
    expect(sfx.loops).toHaveLength(5);
  });

  it('while audio is not running (paused / before the first gesture) a wanted loop is re-requested at most once per retryS, never every frame', () => {
    const {sfx, audio, run} = rig();
    sfx.live = false;
    audio.start(3, 1, -2);
    audio.grind(true);
    run(4);
    const requests = audio.debugState().motorRequests + audio.debugState().grindRequests;
    expect(requests).toBeGreaterThan(0);
    expect(requests).toBeLessThanOrEqual(2 * (Math.ceil(4 / CHIPPER_AUDIO.retryS) + 1));
    sfx.live = true;
    run(CHIPPER_AUDIO.retryS + 0.1);
    expect(sfx.playing('chipperMotor')).toHaveLength(1);
    expect(sfx.playing('chipperGrind')).toHaveLength(1);
  });

  it('silence: everything ends at once, no wind-down cue, nothing comes back; start() afterwards spins up again', () => {
    const {sfx, audio, run} = rig();
    audio.start(3, 1, -2);
    run(2);
    audio.grind(true);
    audio.silence();
    expect(sfx.loops.every(l => l.stopped && l.stopFade === CHIPPER_AUDIO.silenceFadeS)).toBe(true);
    expect(sfx.count('chipperStop')).toBe(0);
    run(5);
    expect(sfx.loops).toHaveLength(2);
    audio.silence(); // idempotent
    audio.start(3, 1, -2);
    expect(sfx.count('chipperStart')).toBe(2);
    run(2);
    expect(sfx.playing('chipperMotor')).toHaveLength(1);
  });

  it('ignores a non-finite position and never throws when the Sfx does', () => {
    const {sfx, audio} = rig();
    audio.feed(1, 1, 1);
    audio.feed(Number.NaN, 1, 1);
    expect(sfx.cues[1].at).toEqual([1, 1, 1]);
    const broken = new ChipperAudio({reactorCue() { throw new Error('x'); }, reactorLoop() { throw new Error('x'); }} as unknown as Sfx, () => 50);
    expect(() => { broken.start(0, 0, 0); broken.grind(true); broken.frame(0, 0, 0); broken.feed(0, 0, 0); broken.stop(0, 0, 0); broken.silence(); }).not.toThrow();
  });
});

describe('ChipperAudio over the real Sfx (fake WebAudio context + fake Sound Lab bank)', () => {
  it('plays only bank clips: the motor / grind loops loop, setWorld ends them and frame() brings them back at the machine', async () => {
    const made: FakeCtx[] = [];
    const {bank, buffers} = fakeBank({variants: 1});
    const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
    sfx.init();
    sfx.suspend(false);
    await settle();
    const ctx = made[0], clock = {t: 0};
    const audio = new ChipperAudio(sfx, () => clock.t);
    const of = (cue: 'chipperMotor' | 'chipperGrind') => ctx.started.filter(s => s.buffer === bank.get(cue)[0].buffer);
    const s0 = ctx.started.length;
    audio.start(2, 1, -1);
    expect(ctx.started.length).toBe(s0 + 1); // the spin-up one-shot
    expect(ctx.started[s0].buffer).toBe(bank.get('chipperStart')[0].buffer);
    clock.t = 2; ctx.currentTime = 2;
    audio.frame(2, 1, -1);
    audio.grind(true);
    expect(of('chipperMotor')).toHaveLength(1);
    expect(of('chipperGrind')).toHaveLength(1);
    expect(of('chipperMotor')[0].loop).toBe(true);
    expect(of('chipperGrind')[0].loop).toBe(true);
    for (let i = 0; i < 120; i++) { clock.t += 1 / 60; ctx.currentTime += 1 / 60; audio.frame(2 + i * 0.01, 1, -1); }
    expect(of('chipperMotor')).toHaveLength(1);
    sfx.setWorld({occlusion: null}); // a new station
    clock.t += 1 / 60; ctx.currentTime += 1 / 60;
    audio.frame(4, 1, -1);
    expect(of('chipperMotor')).toHaveLength(2);
    expect(of('chipperGrind')).toHaveLength(2);
    audio.feed(4, 1, -1);
    audio.stop(4, 1, -1);
    expect(ctx.started.filter(s => s.buffer === bank.get('chipperFeed')[0].buffer)).toHaveLength(1);
    expect(ctx.started.filter(s => s.buffer === bank.get('chipperStop')[0].buffer)).toHaveLength(1);
    for (const s of ctx.started) expect(buffers.has(s.buffer)).toBe(true);
    expect(ctx.oscillatorCalls).toBe(0);
  });
});
