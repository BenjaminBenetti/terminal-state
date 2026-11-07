// Task studio-beta-skyways-vehicle-20261107-054512-01 (lane AUDIO): the prize car's sound, round 2 (user, Game 77: "car feels bad, mostly
// audio", "actual engine audible", "improve arcade feedback especially audio").
//
// ROOT CAUSE (audio/sfx.ts CAR_AUDIO; derivatives/audio-skyways-car.json revision.round1): the wiring played the engine — one channel,
// never torn down by the per-frame calls, the panner at unity 1.8 m from the driver's ear — but the round-1 loops were SUB-BASS only
// (centroid 47 / 74 Hz, the share above 180 Hz -20.3 / -12.4 dB) at CUE 0.42 and a 0.85x idle rate: the idle's audible band reached the
// master at about -48 dBFS. The first block proves that before -> after with the REAL Sfx over the fake WebAudio context; the rest pins
// the round-2 behaviour (engine start, rpm-driven loops, the reverse whine, the brake-to-stop, the car's impacts, the stop / pause / menu /
// new-world paths, never two engine channels) and the wiring in the REAL SkywaysCar. NOT an audition: nobody listened to these clips.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CAR_AUDIO, CUE_GAIN, Sfx} from '../src/audio/sfx';
import {CUES} from '../src/audio/bank';
import {CLIP_MANIFEST_SKYWAYS_CAR} from '../src/audio/manifest.skywaysCar.generated';
import {CAR_SPEC, carToWorld} from '../src/world/skywaysCarSpec';
import {CAR_PHYS} from '../src/world/skywaysCarPhysics';
import {CAR_RT, CAR_SOUND, sfxCarAudio, type SkywaysCar} from '../src/world/skywaysCar';
import {FakeCtx, Panner, Param, fakeBank, type Node as FakeNode, type Src} from './helpers/fakeAudio';
import {DT, carHost, frame, press, teardown, type CarTestHost} from './helpers/skywaysCarHost';

const settle = () => new Promise(r => setTimeout(r, 40));
type Rec = Src & {stopAt?: number};
async function audio(only?: readonly (typeof CUES)[number][]) {
  const made: FakeCtx[] = [];
  const {bank} = fakeBank({variants: 1, only});
  const sfx = new Sfx(() => {
    const c = new FakeCtx();
    const mk = c.createBufferSource.bind(c);
    c.createBufferSource = () => { const s = mk() as Rec; s.stop = (t?: number) => { s.stopAt = t ?? c.currentTime; }; return s; };
    made.push(c);
    return c as unknown as AudioContext;
  }, bank);
  sfx.init();
  sfx.suspend(false);
  await settle();
  return {sfx, ctx: made[0], bank};
}
const bufOf = (sfx: Sfx, cue: string) => (sfx as unknown as {bank: {get(c: string): readonly {buffer: unknown}[]}}).bank.get(cue)[0]?.buffer;
const startedOf = (ctx: FakeCtx, sfx: Sfx, cue: string) => ctx.started.filter(s => s.buffer === bufOf(sfx, cue)) as Rec[];
const db = (g: number) => 20 * Math.log10(Math.max(1e-9, g));

interface Metrics { rmsDbfs: number; centroidHz: number; shareAbove180HzDb: number; shareAbove355HzDb: number; loopSeam?: {wrapJump: number; meanStep: number} }
const PROV = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../public/assets/derivatives/audio-skyways-car.json', import.meta.url)), 'utf8')) as {
  revision: {round1: Record<'carIdle' | 'carDrive', {clip: string; metrics: Metrics}>}; derivatives: {cue: string; url: string; metrics: Metrics; source: {clip: string}}[]};
const now = (cue: string) => PROV.derivatives.find(d => d.cue === cue)!.metrics;

/** The driver's ear (the seated eye) and the engine (CAR_RT.engineAt) of a car at the origin, yaw 0 — world positions. */
const EAR = {x: CAR_SPEC.eye.x, y: CAR_SPEC.eye.y, z: CAR_SPEC.eye.z};
const ENGINE = {x: CAR_RT.engineAt.x, y: CAR_RT.engineAt.y, z: CAR_RT.engineAt.z};
/** Web Audio's 'inverse' distance law (the panner the engine channel made). */
function pannerGain(p: Panner, d: number): number {
  return p.refDistance / (p.refDistance + p.rolloffFactor * (Math.max(d, p.refDistance) - p.refDistance));
}

describe('ROOT CAUSE: the engine reached the ear, but only as sub-bass (before -> after, the real Sfx)', () => {
  it('the wiring was intact: one channel, never torn down by the per-frame Sfx calls Game makes; the engine panner at unity gain at the ear', async () => {
    const {sfx, ctx} = await audio();
    sfx.setWorld({occlusion: () => 0}); // the station build: the only setWorld({occlusion}) call (game.ts buildStation), BEFORE anyone drives
    sfx.setListener(EAR.x, EAR.y, EAR.z, 0);
    sfx.carEngine(0, 0, ENGINE, {rev: true});
    for (let i = 0; i < 600; i++) { // 10 s of driving frames: the car's own call + Game's audio span (listener, room, vitals, ambience)
      ctx.currentTime += DT;
      sfx.carEngine(Math.min(1, i / 300), i % 120 < 90 ? 1 : 0, ENGINE);
      sfx.setListener(EAR.x, EAR.y, EAR.z, 0);
      sfx.setRoom('large', 'concourse');
      sfx.vitals(DT, 1, 1);
      sfx.ambience(DT);
    }
    expect(sfx.carAudioState()).toMatchObject({engine: true, starts: 1, stops: 0});
    const pans = ctx.nodes.filter((n): n is Panner => n instanceof Panner && n.refDistance === CAR_AUDIO.ref);
    expect(pans.length).toBeGreaterThanOrEqual(1);
    const d = Math.hypot(EAR.x - ENGINE.x, EAR.y - ENGINE.y, EAR.z - ENGINE.z);
    expect(d).toBeLessThan(2);
    expect(pannerGain(pans[0], d)).toBe(1); // inside the reference distance: no distance loss at all
  });

  it('the clips: round 1 sub-bass only (inaudible on small speakers) -> round 2 mid-range; the idle at the ear: ~-48 -> ~-27 dBFS above 180 Hz', async () => {
    const r1 = PROV.revision.round1;
    // round 1 (the measured shipped loops): the energy sat under 100 Hz, almost none above 180 Hz
    expect(r1.carIdle.metrics.centroidHz).toBeLessThan(60);
    expect(r1.carDrive.metrics.centroidHz).toBeLessThan(90);
    expect(r1.carIdle.metrics.shareAbove180HzDb).toBeLessThan(-18);
    expect(r1.carDrive.metrics.shareAbove180HzDb).toBeLessThan(-10);
    // round 2: most of the energy is in the band every speaker reproduces
    for (const cue of ['carIdle', 'carDrive'] as const) {
      expect(now(cue).centroidHz).toBeGreaterThan(250);
      expect(now(cue).shareAbove180HzDb).toBeGreaterThan(-4);
      expect(now(cue).rmsDbfs).toBeCloseTo(-20, 0);
    }
    // the idle at the driver's ear through the real Sfx: the gain the channel schedules x the panner's distance gain x the clip's
    // measured level above 180 Hz. Round 1 = CUE 0.42 with the idle weight 1 at rest (the round-1 code, main be3173d).
    const {sfx, ctx} = await audio();
    sfx.setListener(EAR.x, EAR.y, EAR.z, 0);
    sfx.carEngine(0, 0, ENGINE);
    const st = sfx.carAudioState(), pan = ctx.nodes.find((n): n is Panner => n instanceof Panner && n.refDistance === CAR_AUDIO.ref)!;
    const g = pannerGain(pan, Math.hypot(EAR.x - ENGINE.x, EAR.y - ENGINE.y, EAR.z - ENGINE.z));
    const before = r1.carIdle.metrics.rmsDbfs + r1.carIdle.metrics.shareAbove180HzDb + db(0.42 * g);
    const after = now('carIdle').rmsDbfs + now('carIdle').shareAbove180HzDb + db(st.idle * g);
    expect(before).toBeLessThan(-45); // the bug: the audible band of the idle ~25 dB under an ambience bed
    expect(after).toBeGreaterThan(-30);
    expect(after - before).toBeGreaterThan(18);
    expect(st.idleRate).toBeGreaterThanOrEqual(1); // round 1 played the idle at 0.85x (lower still); round 2 never below 1x
    fs.writeFileSync('/tmp/skyways-car-audio-rootcause.json', JSON.stringify({before, after, idleGain: st.idle, pannerGain: g, round1: r1, round2: {carIdle: now('carIdle'), carDrive: now('carDrive')}}, null, 1));
  });

  it('the shipped car clips: one each, the provenance names this build (the engine loops are the round-2 layers)', () => {
    for (const cue of ['carIdle', 'carDrive', 'carStart', 'carReverse', 'carBrake', 'carSkid', 'carDoor']) {
      expect(CLIP_MANIFEST_SKYWAYS_CAR[cue], cue).toHaveLength(1);
      const d = PROV.derivatives.find(x => x.cue === cue)!;
      expect(d.url).toBe(CLIP_MANIFEST_SKYWAYS_CAR[cue][0].url);
      expect(d.source.clip).toBe(CLIP_MANIFEST_SKYWAYS_CAR[cue][0].src);
    }
    expect(CLIP_MANIFEST_SKYWAYS_CAR.carIdle[0].src).not.toBe(PROV.revision.round1.carIdle.clip);
    for (const cue of ['carIdle', 'carDrive', 'carReverse']) {
      const s = now(cue).loopSeam!;
      expect(s.wrapJump).toBeLessThan(Math.max(0.03, 4 * s.meanStep)); // the wrap is an ordinary sample step (no click)
    }
  });
});

describe('Sfx: the round-2 engine channel', () => {
  it('getting in: the engine START plays at the engine, the loops wait under its crank and fade in after start.holdS (sooner with the pedal)', async () => {
    const {sfx, ctx} = await audio();
    sfx.carEngine(0, 0, ENGINE, {rev: true});
    let st = sfx.carAudioState();
    expect(st).toMatchObject({engine: true, starts: 1, startCues: 1, start: true, hold: 0, idle: 0, drive: 0});
    expect(startedOf(ctx, sfx, 'carStart')).toHaveLength(1);
    const A = CAR_AUDIO.start;
    expect(startedOf(ctx, sfx, 'carStart')[0].startArgs[0]).toBeCloseTo(ctx.currentTime + A.delayS, 9); // after the door's latch
    for (let t = 0; t < A.delayS + A.holdS - 0.05; t += DT) { ctx.currentTime += DT; sfx.carEngine(0, 0, ENGINE); }
    expect(sfx.carAudioState().idle).toBe(0); // still under the crank
    for (let t = 0; t < A.fadeS + 0.1; t += DT) { ctx.currentTime += DT; sfx.carEngine(0, 0, ENGINE); }
    st = sfx.carAudioState();
    expect(st.hold).toBe(1);
    expect(st.idle).toBeCloseTo(CUE_GAIN.carIdle, 2); // clearly idling (a target moves only by more than CAR_AUDIO.eps)
    // the pedal already held: in after the catch
    const b = await audio();
    b.sfx.carEngine(0, 0, ENGINE, {rev: true});
    for (let t = 0; t < A.delayS + A.catchS + A.fadeS / 2; t += DT) { b.ctx.currentTime += DT; b.sfx.carEngine(0.02, 1, ENGINE); }
    expect(b.sfx.carAudioState().hold).toBeGreaterThan(0.3);
    // a second start while the first still sounds cuts it (never two), still ONE channel
    const c = await audio();
    c.sfx.carEngine(0, 0, ENGINE, {rev: true});
    const first = startedOf(c.ctx, c.sfx, 'carStart')[0], natural = first.stopAt!;
    c.ctx.currentTime += 0.1;
    c.sfx.carEngine(0, 0, ENGINE, {rev: true});
    expect(c.sfx.carAudioState()).toMatchObject({starts: 1, startCues: 2, start: true});
    expect(first.stopAt!).toBeLessThan(natural);
    expect(first.stopAt!).toBeLessThanOrEqual(c.ctx.currentTime + 0.08);
  });

  it('the rpm: the pedal revs the engine at a standstill (an audible pull-away), speed carries it to the top; rates rise, the drive takes over', async () => {
    const {sfx, ctx} = await audio();
    const s0 = ctx.started.length; // (the ambience beds loop too)
    sfx.carEngine(0, 0, ENGINE);
    const rest = sfx.carAudioState();
    expect(rest).toMatchObject({rpm: 0, drive: 0});
    ctx.currentTime += 0.1;
    sfx.carEngine(0, 1, ENGINE); // W held, not moving yet
    const pull = sfx.carAudioState();
    expect(pull.rpm).toBeCloseTo(CAR_AUDIO.rpm.throttle, 6);
    expect(pull.drive).toBeGreaterThan(0.2 * CUE_GAIN.carDrive);
    expect(pull.rate).toBeGreaterThan(rest.rate);
    expect(pull.idleRate).toBeGreaterThan(rest.idleRate);
    ctx.currentTime += 0.1;
    sfx.carEngine(1, 1, ENGINE);
    const top = sfx.carAudioState();
    expect(top.rpm).toBe(1);
    expect(top.rate).toBeCloseTo(CAR_AUDIO.driveRate[1], 6);
    expect(top.drive).toBeCloseTo(CUE_GAIN.carDrive, 6);
    expect(top.idle).toBeCloseTo(CUE_GAIN.carIdle * CAR_AUDIO.idleFloor, 6);
    ctx.currentTime += 0.1;
    sfx.carEngine(1, 0, ENGINE); // coasting at speed: a little lower than on the pedal
    expect(sfx.carAudioState().rpm).toBeCloseTo(CAR_AUDIO.rpm.speed, 6);
    expect(ctx.started.slice(s0)).toHaveLength(3); // (idle, drive, reverse) never restarted
    expect(sfx.carAudioState().starts).toBe(1);
  });

  it('reverse: the gearbox whine comes in with the reverse speed (level and rate rise) and leaves going forward', async () => {
    const {sfx, ctx} = await audio();
    sfx.carEngine(0, 0, ENGINE);
    expect(sfx.carAudioState().reverse).toBe(0);
    let last = 0;
    for (const r of [0.1, 0.4, 0.7, 1]) {
      ctx.currentTime += 0.1;
      sfx.carEngine(r * CAR_PHYS.reverseMax / CAR_PHYS.forwardMax, 1, ENGINE, {reverse01: r});
      const st = sfx.carAudioState();
      expect(st.reverse).toBeGreaterThan(last);
      last = st.reverse;
    }
    expect(last).toBeCloseTo(CUE_GAIN.carReverse * CAR_AUDIO.reverse.level[1], 6);
    expect(sfx.carAudioState().reverseRate).toBeCloseTo(CAR_AUDIO.reverse.rate[1], 6);
    ctx.currentTime += 0.1;
    sfx.carEngine(0.2, 1, ENGINE);
    expect(sfx.carAudioState().reverse).toBe(0);
    // no reverse clip in the bank: the engine still runs (two loops), silently without the whine
    const b = await audio(CUES.filter(c => c !== 'carReverse'));
    const s0 = b.ctx.started.length;
    b.sfx.carEngine(0.1, 1, ENGINE, {reverse01: 0.8});
    expect(b.sfx.carAudioState()).toMatchObject({engine: true, reverse: 0});
    expect(b.ctx.started.slice(s0)).toHaveLength(2);
  });

  it('getting out: the loops fade while they wind down (stopRate x) and the start is cut; pause / a new world: off at once, no wind-down; nothing starts while paused', async () => {
    const {sfx, ctx} = await audio();
    const s0 = ctx.started.length;
    sfx.carEngine(0, 0, ENGINE, {rev: true});
    ctx.currentTime += 0.3;
    sfx.carEngine(0.5, 1, ENGINE);
    const st = sfx.carAudioState(), loops = ctx.started.slice(s0).filter(s => s.loop) as Rec[];
    expect(loops).toHaveLength(3);
    sfx.stopCarEngine();
    expect(sfx.carAudioState()).toMatchObject({engine: false, start: false, stops: 1});
    for (const s of loops) expect(s.stopAt! - ctx.currentTime).toBeCloseTo(CAR_AUDIO.stopFade + 0.05, 6);
    expect((loops[1].playbackRate as unknown as Param).value).toBeCloseTo(st.rate * CAR_AUDIO.stopRate, 6); // the drive loop winds down
    expect(startedOf(ctx, sfx, 'carStart')[0].stopAt).toBeLessThanOrEqual(ctx.currentTime + 0.2);
    // pause (a menu): at once, no wind-down; nothing starts until play resumes
    const s1 = ctx.started.length;
    sfx.carEngine(0.5, 1, ENGINE);
    const r2 = sfx.carAudioState().rate, loops2 = ctx.started.slice(s1) as Rec[];
    expect(loops2).toHaveLength(3);
    sfx.pause();
    expect(sfx.carAudioState().engine).toBe(false);
    for (const s of loops2) expect(s.stopAt! - ctx.currentTime).toBeLessThanOrEqual(0.1 + 1e-9);
    expect((loops2[1].playbackRate as unknown as Param).value).toBeCloseTo(r2, 6);
    const n = ctx.started.length;
    sfx.carEngine(0.5, 1, ENGINE, {rev: true});
    expect(ctx.started.length).toBe(n);
    expect(sfx.carBrake(ENGINE)).toBe(false);
    expect(sfx.carImpact(0, 0, 0, 8, 'car')).toBe(false);
    sfx.resume();
    sfx.carEngine(0.5, 1, ENGINE);
    expect(sfx.carAudioState()).toMatchObject({engine: true, starts: 3});
    sfx.setWorld({occlusion: null}); // a new world (travel / Retry / Load / New game)
    expect(sfx.carAudioState().engine).toBe(false);
  });

  it('carBrake: one brake-stop take, level by strength, at most every brake.minGapS; carImpact: car = metal crash + topple, flesh = slap + thump, per-kind rate limit', async () => {
    const {sfx, ctx} = await audio();
    expect(sfx.carBrake(ENGINE, 0.2)).toBe(true);
    expect(sfx.carBrake(ENGINE, 1)).toBe(false);
    ctx.currentTime += CAR_AUDIO.brake.minGapS + 0.01;
    expect(sfx.carBrake(ENGINE, 1)).toBe(true);
    expect(startedOf(ctx, sfx, 'carBrake')).toHaveLength(2);
    // the two brake voices' input gains: base .. 1 by strength
    const gains = ctx.nodes.filter((n): n is FakeNode & {gain: Param} => 'gain' in n && n.outputs.some(o => o instanceof Panner && o.refDistance === CAR_AUDIO.brake.ref)).map(n => n.gain.value);
    expect(Math.max(...gains)).toBeGreaterThan(Math.min(...gains));
    const s0 = ctx.started.length;
    ctx.currentTime += 1;
    expect(sfx.carImpact(1, 0.6, 1, 8, 'car')).toBe(true);
    expect(sfx.carImpact(1, 0.6, 1, 8, 'car')).toBe(false); // a scrape reports every frame: rate-limited
    expect(sfx.carImpact(1, 0.8, 1, 6, 'flesh')).toBe(true); // (the other kind is not)
    const played = ctx.started.slice(s0).map(s => s.buffer);
    expect(played).toEqual([bufOf(sfx, 'impactMetal'), bufOf(sfx, 'propTopple'), bufOf(sfx, 'impactFlesh'), bufOf(sfx, 'bodyFall')]);
    ctx.currentTime += CAR_AUDIO.impact.minGapS.car + 0.01;
    expect(sfx.carImpact(1, 0.6, 1, CAR_AUDIO.impact.from.car - 0.1, 'car')).toBe(false); // a nudge: nothing
    expect(sfx.carImpact(1, 0.6, 1, 3, 'car')).toBe(true);
    expect(sfx.carAudioState()).toMatchObject({brakes: 2, impacts: 3});
    expect(ctx.oscillatorCalls).toBe(0);
  });
});

describe('the wiring in the real SkywaysCar (fake host, the real Sfx)', () => {
  /** Game's frame order for the audio: the car's step + hooks, then the listener follows the eye. */
  const step = (h: CarTestHost, car: SkywaysCar, ctx: FakeCtx, sfx: Sfx, seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      ctx.currentTime += DT;
      frame(h, car);
      sfx.setListener(h.player.x, h.player.eye, h.player.z, h.player.yaw);
      if (until?.()) break;
    }
  };
  const enter = (h: CarTestHost, car: SkywaysCar, ctx: FakeCtx, sfx: Sfx) => {
    const b = car.body!, d = carToWorld(b.x, b.z, b.yaw, CAR_SPEC.exits.left.x, CAR_SPEC.exits.left.z), door = carToWorld(b.x, b.z, b.yaw, -(CAR_SPEC.width / 2 - 0.05), CAR_SPEC.exits.left.z);
    h.player.place(d.x, d.z, 0, b.y);
    step(h, car, ctx, sfx, DT);
    const P = h.player, dx = door.x - P.x, dy = b.y + 0.9 - P.eye, dz = door.z - P.z;
    P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    step(h, car, ctx, sfx, DT);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(true);
  };

  it('in: door + START, idle after the crank; W: rpm / rates rise; S at speed: the skid, then the brake-to-stop ONCE; reversing: the whine; out: door, engine off', async () => {
    const {sfx, ctx} = await audio();
    const {h, car} = carHost({spawn: {x: 15, z: 27}});
    h.sfx = sfx;
    enter(h, car, ctx, sfx);
    expect(sfx.carAudioState()).toMatchObject({engine: true, starts: 1, startCues: 1, doors: 1});
    step(h, car, ctx, sfx, CAR_AUDIO.start.delayS + CAR_AUDIO.start.holdS + CAR_AUDIO.start.fadeS + 0.2);
    const idle = sfx.carAudioState();
    expect(idle.idle).toBeCloseTo(CUE_GAIN.carIdle, 2);
    h.keys.held.add('KeyW');
    step(h, car, ctx, sfx, 3, () => car.body!.v > CAR_RT.skidSpeed + 3);
    const fast = sfx.carAudioState();
    expect(fast.rpm).toBeGreaterThan(0.5);
    expect(fast.rate).toBeGreaterThan(idle.rate + 0.3);
    expect(fast.drive).toBeGreaterThan(idle.drive);
    h.keys.held.clear();
    h.keys.held.add('KeyS'); // a hard brake at speed: the skid now, the brake-stop at the end
    step(h, car, ctx, sfx, 3, () => car.body!.v <= 0);
    expect(sfx.carAudioState()).toMatchObject({skids: 1, brakes: 1});
    step(h, car, ctx, sfx, 0.4); // S held on: it reverses — the whine
    expect(car.body!.v).toBeLessThan(-1);
    expect(-car.body!.v).toBeLessThan(CAR_SOUND.brakeMin);
    const slowBack = sfx.carAudioState();
    expect(slowBack.reverse).toBeGreaterThan(0);
    expect(slowBack.brakes).toBe(1); // reversing away is no second stop
    h.keys.held.clear();
    h.keys.held.add('KeyW'); // W while reversing brakes it: a slow brake (< CAR_SOUND.brakeMin) makes no brake-stop
    step(h, car, ctx, sfx, 2, () => car.body!.v >= 0);
    h.keys.held.clear();
    expect(sfx.carAudioState()).toMatchObject({brakes: 1, reverse: 0});
    h.keys.held.add('KeyS'); // reverse at full speed: the whine at its top; W brakes it from there: a reverse brake-stop
    step(h, car, ctx, sfx, 2, () => car.body!.v <= -CAR_PHYS.reverseMax + 1e-6);
    const fullBack = sfx.carAudioState();
    expect(fullBack.reverse).toBeGreaterThan(slowBack.reverse);
    expect(fullBack.reverseRate).toBeGreaterThan(slowBack.reverseRate);
    h.keys.held.clear();
    h.keys.held.add('KeyW');
    step(h, car, ctx, sfx, 2, () => car.body!.v >= 0);
    h.keys.held.clear();
    expect(sfx.carAudioState().brakes).toBe(2);
    step(h, car, ctx, sfx, 0.3);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    expect(sfx.carAudioState()).toMatchObject({engine: false, stops: 1, doors: 2});
    const n = ctx.started.length;
    step(h, car, ctx, sfx, 0.5);
    expect(ctx.started.length).toBe(n); // the empty car is silent
    expect(CAR_SOUND.brakeMin).toBeLessThan(CAR_RT.skidSpeed + 3);
  });

  it('coasting to a stop makes no brake sound; death / a menu / a teardown stop the engine; a pause stops it in Sfx and the next frame brings it back (no start)', async () => {
    const {sfx, ctx} = await audio();
    const {h, car} = carHost({spawn: {x: 15, z: 27}});
    h.sfx = sfx;
    enter(h, car, ctx, sfx);
    h.keys.held.add('KeyW');
    step(h, car, ctx, sfx, 3, () => car.body!.v > CAR_SOUND.brakeMin + 2);
    h.keys.held.clear();
    step(h, car, ctx, sfx, 8, () => Math.abs(car.body!.v) < 0.05);
    expect(sfx.carAudioState()).toMatchObject({brakes: 0, engine: true});
    // pause: Game's setState -> Sfx.suspend(true) -> pause (the engine off); the driver stays in; play again -> the next frame re-creates it
    sfx.suspend(true);
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('paused', 'playing');
    expect(sfx.carAudioState().engine).toBe(false);
    expect(car.driving).toBe(true);
    sfx.suspend(false);
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('playing', 'paused');
    step(h, car, ctx, sfx, DT);
    expect(sfx.carAudioState()).toMatchObject({engine: true, starts: 2, startCues: 1});
    // death
    h.player.alive = false;
    step(h, car, ctx, sfx, DT);
    expect(car.driving).toBe(false);
    expect(sfx.carAudioState().engine).toBe(false);
    h.player.alive = true;
    // the main menu
    enter(h, car, ctx, sfx);
    sfx.suspend(true);
    for (const f of h.stateListeners) (f as (s: string, p: string) => void)('title', 'playing');
    expect(sfx.carAudioState()).toMatchObject({engine: false, start: false});
    expect(car.driving).toBe(false);
    sfx.suspend(false);
    // a teardown while driving
    enter(h, car, ctx, sfx);
    teardown(h);
    expect(sfx.carAudioState()).toMatchObject({engine: false, start: false});
    expect(car.driving).toBe(false);
  });

  it('impacts go through Sfx.carImpact when present (the car / flesh cues), else the generic contact cues', () => {
    const calls: string[] = [];
    const withCar = sfxCarAudio(() => ({carImpact: (_x: number, _y: number, _z: number, s: number, w: string) => { calls.push(`car:${w}:${s}`); return true; },
      physImpact: () => { calls.push('phys'); }}));
    withCar.impact(0, 0, 0, 7, 'car');
    withCar.impact(0, 0, 0, 5, 'flesh');
    const generic = sfxCarAudio(() => ({physImpact: (_x: number, _y: number, _z: number, s: number, f: string) => { calls.push(`phys:${f}:${s}`); }}));
    generic.impact(0, 0, 0, 7, 'car');
    expect(calls).toEqual(['car:car:7', 'car:flesh:5', 'phys:prop:5']);
    // the engine call carries reverse01 only while reversing
    const eng: unknown[] = [];
    const a = sfxCarAudio(() => ({carEngine: (_k: number, _t: number, _at: unknown, o?: unknown) => { eng.push(o); }}));
    a.engine(0.2, 1, 0, 0, 0);
    a.engine(0.2, 1, 0, 0, 0, 0.6);
    expect(eng).toEqual([undefined, {reverse01: 0.6}]);
  });
});
