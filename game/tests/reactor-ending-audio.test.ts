// Task reactor-surface-ending-20261102 (lane AUDIO): the Reactor's ENDING audio — user: "the reactor needs to have a noise when the blue
// beam shoots out the top!" and, for the new surface ending, "It should be raining!". Checks:
//  - the BEAM IGNITION on the win clock: ONE cue, timed so its crack (BEAM_IGNITION_CRACK_S into the clip, measured by the builder)
//    lands as the beam fires; a live step crosses it once, a restore / QA jump / rebuilt world never; on the real restart runtime the
//    crack lands within one frame of the beam becoming visible; at the beam column point nearest the listener (pit-wide, heard from
//    the rim on real layouts), high-passed, priority 2; the voices at ONLINE stay bounded and the director's loops stay <= 4;
//  - the MIX: the shipped provenance's calibration (sample-exact worst-case sum at ONLINE) is under full scale with the beam, and its
//    gains are the runtime's (CUE_GAIN x STARTUP_MIX); the bytes stay within the brief's 90 KB;
//  - the RAIN: silent before the win at every height; after it full in the open above the roof, muffled + fading under the roof,
//    nothing deep inside; a registered surface exposure (lane SURFACE / ENDING) wins over the default; the runtime drives it and a
//    teardown silences it; the Sfx bed is ONE looping channel (created once, on first use), low-passed when sheltered.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import {STARTUP, beamCueAt, cuesCrossed, winCues, type StageSnap} from '../src/world/reactor/startupPlan';
import {STARTUP_MIX, StartupAudio, type StartupSfx, type StartupSites} from '../src/world/reactor/startupAudio';
import {ReactorStartup} from '../src/world/reactor/startup';
import {ReactorRestart} from '../src/world/reactor/restart';
import {FUSE_CARTRIDGE_ID, REACTOR_KEY_ID} from '../src/world/reactor/restartLogic';
import {setReactorVisuals} from '../src/world/reactor/visuals';
import {beamSpan} from '../src/world/reactor/startupSky';
import {RAIN_AUDIO, RainAudio, defaultRainExposure, rainExposureOf, rainMix, setRainExposure, surfaceRainExposure, type RainSfx} from '../src/world/reactor/audioRain';
import type {ReactorSurface} from '../src/gen/reactor/reactorTypes';
import {BEAM_IGNITION_CRACK_S, CLIP_BYTES_REACTOR_ENDING, CLIP_MANIFEST_REACTOR_ENDING} from '../src/audio/manifest.reactorEnding.generated';
import {CUE_GAIN, RAIN_BED, Sfx} from '../src/audio/sfx';
import {MALL_SKY, MALL_SKY_U} from '../src/world/mallExterior';
import {FakeCtx, fakeBank, type Node as FakeNode, type Param} from './helpers/fakeAudio';
import {aimAt, fakeHost, type FakeHost} from './helpers/reactorRestartFixture';

afterEach(() => { setReactorVisuals(null); MALL_SKY_U.gas.value = MALL_SKY.gas; });

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROV = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/audio-reactor-ending.json'), 'utf8'));
const FRAME = 1 / 60;
const WON: StageSnap = {fuses: 2, breaker: true, valve: true, pump: true, key: true, rods: true, restarted: true};

interface Rec { cue: string; x: number; y: number; z: number; gain?: number; rate?: number; pri?: number; filter?: {type: string; freq: number}; t?: number }
function recSfx(clock: () => number | undefined = () => undefined) {
  const cues: Rec[] = [], rain: {level: number; muffle: number}[] = [];
  let loops = 0;
  const sfx: StartupSfx & RainSfx = {
    reactorCue: (cue, x, y, z, o) => { cues.push({cue, x, y, z, gain: o?.gain, rate: o?.rate, pri: o?.pri, filter: o?.filter, t: clock()}); },
    reactorLoop: () => { loops++; return {playing: true, setPos() {}, stop() {}, setLevel() {}, setRate() {}}; },
    rainBed: (level, muffle) => { rain.push({level, muffle}); },
  };
  return {sfx, cues, rain, loops: () => loops};
}

function sites(): StartupSites {
  const ctl = (x: number) => ({x, y: -20, z: 5});
  return {
    core: {x: 0, y: -25, z: 0}, crdm: {x: 0, y: -16, z: 0},
    control: id => ({'fuse-0': ctl(1), 'fuse-1': ctl(2), breaker: ctl(3), valve: ctl(4), pump: ctl(5), keyswitch: ctl(6), rods: ctl(7)} as Record<string, {x: number; y: number; z: number}>)[id] ?? null,
    tier: rank => ({x: 10, y: -30 + rank * 6, z: 0}),
    beacon: () => null,
    beam: L => ({x: 0, y: Math.min(140, Math.max(-14, L.y)), z: 0}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the beam ignition on the win clock', () => {
  it('ONE cue, its crack landing as the beam fires; a live step crosses it once, a jump / restore never', () => {
    expect(BEAM_IGNITION_CRACK_S).toBe(PROV.beamIgnition.crack.fromPlayStartS); // the builder's measurement, shipped as data
    expect(BEAM_IGNITION_CRACK_S).toBeGreaterThan(0.1);
    expect(BEAM_IGNITION_CRACK_S).toBeLessThan(1); // a short lead-in, not a second event
    expect(PROV.beamIgnition.crack.riseOverSwellDb).toBeGreaterThanOrEqual(9); // a real crack out of the swell (> 2 kHz)
    const c = winCues(6), beam = c.filter(q => q.kind === 'beam');
    expect(beam).toHaveLength(1);
    expect(beam[0].at).toBeCloseTo(STARTUP.onlineAtS - BEAM_IGNITION_CRACK_S, 9);
    expect(beamCueAt() + BEAM_IGNITION_CRACK_S).toBeCloseTo(STARTUP.onlineAtS, 9);
    let n = 0;
    for (let t = 0; t < 40; t += FRAME) n += cuesCrossed(c, t, t + FRAME).filter(q => q.kind === 'beam').length;
    expect(n).toBe(1);
    expect(cuesCrossed(c, 2, 2 + STARTUP.maxStepS + 0.5)).toEqual([]); // QA finish / restore jump
    expect(cuesCrossed(c, -1, Infinity)).toEqual([]);
  });

  it('the director: at the beam column nearest the listener, high-passed, priority 2, once; the ONLINE impact makes room; bounded', () => {
    const r = recSfx(), st = sites(), a = new StartupAudio(() => r.sfx);
    a.build({...WON, rods: false, restarted: false}, null, 6);
    const eye = {x: 3, y: -20, z: 8};
    let t = 0;
    a.frame(FRAME, WON, null, 0, st, eye);
    while (t < 30) { t += FRAME; a.frame(FRAME, WON, null, t, st, eye); }
    const beam = r.cues.filter(q => q.cue === 'reactorBeam');
    expect(beam).toHaveLength(1);
    expect(beam[0]).toMatchObject({x: 0, y: -14, z: 0, gain: STARTUP_MIX.beamGain, pri: 2, filter: {type: 'highpass', freq: STARTUP_MIX.beamHighpassHz}});
    expect(a.counts.beam).toBe(1);
    const on = r.cues.find(q => q.cue === 'reactorOnline')!;
    expect(on.gain).toBe(STARTUP_MIX.onlineGain);
    expect(r.cues.find(q => q.cue === 'reactorStage' && q.rate === 0.62)!.gain).toBe(STARTUP_MIX.onlineThumpGain);
    // the order: surge .. beam (its swell) .. ONLINE; within the ignition's window at most 4 one-shots start (beam, ONLINE, thump, a tier)
    const order = r.cues.map(q => q.cue);
    expect(order.indexOf('reactorSurge')).toBeLessThan(order.indexOf('reactorBeam'));
    expect(order.indexOf('reactorBeam')).toBeLessThan(order.indexOf('reactorOnline'));
    const i0 = order.indexOf('reactorBeam'), win = r.cues.slice(i0, order.indexOf('reactorOnline') + 3);
    expect(win.length).toBeLessThanOrEqual(4);
    expect(a.loops).toBeLessThanOrEqual(4); // the ignition is a one-shot: no loop
    // heard from the rim: the listener's height picks the column point
    const r2 = recSfx(), b = new StartupAudio(() => r2.sfx), rim = {x: 30, y: 2, z: 0};
    b.build({...WON, rods: false, restarted: false}, null, 6);
    for (let t2 = 0; t2 < 8; t2 += FRAME) b.frame(FRAME, WON, null, t2, st, rim);
    expect(r2.cues.find(q => q.cue === 'reactorBeam')).toMatchObject({x: 0, y: 2, z: 0});
  });

  it('NO replay: a rebuilt / restored world, a QA jump, a menu pause between swell and crack never repeat it', () => {
    const st = sites();
    for (const winT of [Infinity, 50]) {
      const r = recSfx(), a = new StartupAudio(() => r.sfx);
      a.build(WON, winT, 6);
      for (let i = 0; i < 400; i++) a.frame(FRAME, WON, null, winT === Infinity ? Infinity : winT + i * FRAME, st, {x: 0, y: 0, z: 0});
      expect(r.cues.filter(q => q.cue === 'reactorBeam'), String(winT)).toEqual([]);
    }
    const r = recSfx(), a = new StartupAudio(() => r.sfx);
    a.build(WON, 0.5, 6);
    a.frame(FRAME, WON, null, 0.6, st, {x: 0, y: 0, z: 0});
    a.frame(FRAME, WON, null, 60, st, {x: 0, y: 0, z: 0}); // reactorWinFinish
    expect(r.cues).toEqual([]);
    // the win clock stops while the game is paused (no frames): resuming continues the clock, the cue is crossed once only
    const p = recSfx(), d = new StartupAudio(() => p.sfx);
    d.build({...WON, rods: false, restarted: false}, null, 6);
    let t = 0;
    d.frame(FRAME, WON, null, 0, st, {x: 0, y: 0, z: 0});
    while (t < beamCueAt() + 0.1) { t += FRAME; d.frame(FRAME, WON, null, t, st, {x: 0, y: 0, z: 0}); }
    d.pause();
    while (t < 12) { t += FRAME; d.frame(FRAME, WON, null, t, st, {x: 0, y: 0, z: 0}); }
    expect(p.cues.filter(q => q.cue === 'reactorBeam')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The runtime on the restart's fake host (the real ReactorRestart drives it)

function rig(h: FakeHost = fakeHost()) {
  let rt: ReactorRestart | null = null;
  const r = recSfx(() => rt?.win?.t);
  h.sfx = r.sfx;
  rt = new ReactorRestart(h).install();
  rt.recordMilestone = () => true;
  rt.clearAir = () => true;
  const su = new ReactorStartup(h as never).install();
  for (const s of h.sectionHooks) s.build?.(h.layout);
  const tick = (dt = FRAME, n = 1) => { for (let i = 0; i < n; i++) { h.clockS += dt; for (const f of h.frameHooks) f(dt); } };
  return {h, rt, su, r, tick};
}

function toTheRods(x: ReturnType<typeof rig>): void {
  x.h.inv.add(x.h.inv.makeStack(FUSE_CARTRIDGE_ID, 2));
  x.h.inv.add(x.h.inv.makeStack(REACTOR_KEY_ID, 1));
  for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch'] as const) { expect(x.rt.qaOperate(id).ok, id).toBe(true); x.tick(0.1, 2); }
}

describe('the ignition on the real restart runtime (fake host)', () => {
  it('the crack lands within one frame of the beam becoming visible, at the column, once over the whole win', () => {
    const x = rig();
    toTheRods(x);
    aimAt(x.h, x.rt, 'rods');
    x.h.keys.add('KeyE');
    expect(x.rt.interact()).toBe(true);
    while (!x.rt.state!.rods) x.tick();
    x.h.keys.delete('KeyE');
    let visibleAt: number | null = null;
    while (x.rt.win!.t < STARTUP.onlineAtS + 1) { x.tick(); if (visibleAt === null && x.su.sky!.beam.visible) visibleAt = x.rt.win!.t; }
    const beam = x.r.cues.filter(q => q.cue === 'reactorBeam');
    expect(beam).toHaveLength(1);
    expect(visibleAt).not.toBeNull();
    const crackAt = beam[0].t! + BEAM_IGNITION_CRACK_S;
    expect(Math.abs(crackAt - visibleAt!)).toBeLessThan(FRAME + 1e-6);
    const span = beamSpan(x.h.layout.reactor!), eye = x.h.camera.getWorldPosition(new THREE.Vector3());
    expect(beam[0]).toMatchObject({x: span.x, z: span.z, pri: 2});
    expect(beam[0].y).toBeCloseTo(Math.min(span.y1, Math.max(span.y0, eye.y)), 6);
    while (!x.rt.win!.done) x.tick(0.1);
    x.tick(0.1, 100);
    expect(x.r.cues.filter(q => q.cue === 'reactorBeam')).toHaveLength(1);
    // travel away and back: the rebuilt (restored) world plays no ignition
    for (const s of x.h.sectionHooks) s.teardown?.();
    const y = rig(fakeHost(x.h.run, x.h.inv));
    expect(y.rt.state!.restarted).toBe(true);
    y.tick(0.1, 200);
    expect(y.r.cues.filter(q => q.cue === 'reactorBeam')).toEqual([]);
    expect(y.su.sky!.beam.visible).toBe(true);
  });
});

describe('heard from the rim (real layouts)', () => {
  it('every rim-mouth point is within the ignition range, its panner gain >= -10 dB at the column point at rim height', () => {
    for (const seed of [codeToSeed('000070S')!, 218558]) {
      const L = LEVELS.reactor.generate('main', {levelSeed: seed}), info = L.reactor!, span = beamSpan(info);
      const ear = info.pit.rimY + 1.6;
      expect(ear).toBeGreaterThan(span.y0);
      for (const p of info.pit.outline) {
        const d = Math.hypot(p.x - span.x, p.z - span.z); // the column point at ear height: horizontal distance only
        expect(d).toBeLessThan(STARTUP_MIX.coreMax);
        const g = STARTUP_MIX.coreRef / (STARTUP_MIX.coreRef + Math.max(0, d - STARTUP_MIX.coreRef)); // PannerNode 'inverse', rolloff 1
        expect(20 * Math.log10(g), `seed ${seed}`).toBeGreaterThan(-10);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the mix (shipped calibration) and the bytes', () => {
  it('ONLINE + the ignition stays under full scale worst case; the calibrated gains are the runtime gains', () => {
    const cal = PROV.mixCalibration;
    expect(cal.skipped).toBeUndefined();
    expect(cal.after.peakDbfs).toBeLessThan(0);
    expect(cal.after.peakDbfs).toBeLessThan(cal.before.peakDbfs); // the beam did not raise the ONLINE peak
    expect(cal.after.momentaryMaxLufs).toBeGreaterThan(cal.before.momentaryMaxLufs - 1); // and the moment is not weaker
    expect(cal.mix.after).toEqual({online: STARTUP_MIX.onlineGain, thump: STARTUP_MIX.onlineThumpGain, beam: STARTUP_MIX.beamGain});
    expect(cal.mix.beamHighpassHz).toBe(STARTUP_MIX.beamHighpassHz);
    for (const k of ['reactorSurge', 'reactorOnline', 'reactorStage', 'reactorBreaker', 'reactorBeam'] as const) expect(cal.cueGains[k], k).toBe(CUE_GAIN[k]);
    expect(cal.mix.tierGain).toBe(STARTUP_MIX.tierGain);
    expect(cal.mix.tierRate).toBe(STARTUP_MIX.tierRate);
  });

  it('two clips, within the brief\'s 90 KB of new runtime audio; the rain is a >= 5 s bed loop', () => {
    expect(Object.keys(CLIP_MANIFEST_REACTOR_ENDING).sort()).toEqual(['bedRain', 'reactorBeam']);
    expect(CLIP_BYTES_REACTOR_ENDING).toBeLessThanOrEqual(90 * 1024);
    let bytes = 0;
    for (const refs of Object.values(CLIP_MANIFEST_REACTOR_ENDING)) for (const r of refs) bytes += fs.statSync(path.join(GAME, 'public', r.url)).size;
    expect(bytes).toBe(CLIP_BYTES_REACTOR_ENDING);
    expect(CLIP_MANIFEST_REACTOR_ENDING.bedRain[0].loop!.length).toBeGreaterThan(5);
    expect(CLIP_MANIFEST_REACTOR_ENDING.reactorBeam[0].loop).toBeUndefined();
    expect(PROV.derivatives.map((d: {source: {jobId: string}}) => d.source.jobId)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the surface rain', () => {
  const ROOF = 14;
  it('roof-line fallback (no surface contract): full in the open over the roof, muffled + fading just under it, nothing deeper', () => {
    expect(defaultRainExposure(ROOF + 1.6, ROOF)).toEqual({level: 1, muffle: 0});
    const top = defaultRainExposure(ROOF + 0.4, ROOF); // coming up the last steps
    expect(top.muffle).toBeGreaterThan(0); expect(top.muffle).toBeLessThan(1); expect(top.level).toBeGreaterThan(RAIN_AUDIO.indoorLevel);
    const under = defaultRainExposure(ROOF - 2, ROOF);
    expect(under.muffle).toBe(1); expect(under.level).toBeGreaterThan(0); expect(under.level).toBeLessThan(RAIN_AUDIO.indoorLevel);
    expect(defaultRainExposure(ROOF - 20, ROOF).level).toBe(0);
    let prev = Infinity;
    for (let y = ROOF + 3; y > ROOF - 12; y -= 0.25) { const e = defaultRainExposure(y, ROOF); expect(e.level).toBeLessThanOrEqual(prev + 1e-9); prev = e.level; } // monotone going down
  });

  // lane ENDING's contract (gen/reactor/reactorTypes.ts ReactorSurface), hand-built: the door on the rim (level 0, y 0) at x 0..2,
  // a stair climbing z 24 -> 30 to the deck (y 15, level 6), the head house x 0..6 / z 30..36 with its exit at x 6.5, the plaza beyond
  const A = {lower: 101, stair: 102, upper: 103, plaza: 104};
  const SURF = {version: 1, level: 6, y: 15, ceil: 30, parapetY: 16.1, bounds: {x0: 0, z0: 10, x1: 40, z1: 50}, walk: [], edges: [],
    hole: {x: 20, z: 20, r: 8, parapet: {r0: 8, r1: 8.3, top: 16.1}, keepR: 9},
    door: {level: 0, x: 1, y: 0, z: 20, yaw: 0, nx: 1, nz: 0, w: 1.6, h: 2.4, rect: {x0: 0, z0: 19, x1: 2, z1: 21}, front: 7, cells: []},
    stairs: {flights: [], link: 0, bottom: {x: 3, y: 0, z: 24, level: 0}, top: {x: 3, y: 15, z: 30, level: 6}, rect: {x0: 0, z0: 23.5, x1: 6, z1: 30}},
    head: {rect: {x0: 0, z0: 30, x1: 6, z1: 36}, top: 18}, exit: {x: 6.5, y: 15, z: 33, yaw: 0}, areas: A} as ReactorSurface;
  const inR = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  const LEVELS6 = [{grid: {areaAt: (x: number, z: number) => (inR(x, z, 0, 18, 2, 23.5) ? A.lower : 1)}}, undefined, undefined, undefined, undefined, undefined,
    {grid: {areaAt: (x: number, z: number) => (inR(x, z, 0, 30, 6, 36) ? A.upper : inR(x, z, 0, 23.5, 6, 30) ? A.stair : A.plaza)}}];

  it('the surface rule (lane ENDING contract): plaza open; head house / stair muffled, fading in as they climb; nothing elsewhere', () => {
    const at = (x: number, y: number, z: number) => surfaceRainExposure(SURF, LEVELS6, {x, y, z});
    expect(at(20, 16.6, 40)).toEqual({level: 1, muffle: 0}); // the plaza
    expect(at(20, 16.0, 40)).toEqual({level: 1, muffle: 0}); // crouched on the plaza
    expect(at(20, 1.6, 5)).toEqual({level: 0, muffle: 1}); // the rim storey
    expect(at(20, -22.4, 20)).toEqual({level: 0, muffle: 1}); // the core floor
    // the climb: behind the door -> up the stair -> the head house -> its exit -> the plaza: louder and opener every step
    const path = [at(1, 1.6, 21), at(3, 1.8, 24.5), at(3, 6.6, 26.5), at(3, 11.6, 28.5), at(3, 16.6, 31), at(1, 16.6, 35), at(5.5, 16.6, 33), at(9, 16.6, 33)];
    expect(path[0]).toEqual({level: RAIN_AUDIO.lowerLevel, muffle: 1});
    for (const e of path.slice(1, 4)) expect(e.muffle).toBe(1); // the stair: sheltered
    for (let i = 1; i < path.length; i++) expect(path[i].level, `step ${i}`).toBeGreaterThanOrEqual(path[i - 1].level - 1e-9);
    expect(path[6].level).toBeGreaterThan(path[5].level); // the exit end of the head house is louder than its far end ...
    expect(path[6].muffle).toBeLessThan(path[5].muffle); // ... and opener
    expect(path[7]).toEqual({level: 1, muffle: 0});
    // the runtime chooses it whenever the Reactor carries a surface contract (the hook still wins)
    const host = {}, r = recSfx(), rain = new RainAudio(host, () => r.sfx), info = {pit: {roofY: 14}, surface: SURF} as never;
    for (let i = 0; i < 12; i++) rain.frame(FRAME, {x: 3, y: 11.6, z: 28.5}, 1, info, LEVELS6);
    expect(rain.shown.source).toBe('surface');
    expect(r.rain[r.rain.length - 1].muffle).toBe(1);
    for (let i = 0; i < 12; i++) rain.frame(FRAME, {x: 20, y: 1.6, z: 5}, 1, info, LEVELS6); // the rim storey: the roof line would not matter
    expect(r.rain[r.rain.length - 1].level).toBe(0);
    setRainExposure(host, () => ({level: 0.3, muffle: 0.2}));
    for (let i = 0; i < 12; i++) rain.frame(FRAME, {x: 20, y: 16.6, z: 40}, 1, info, LEVELS6);
    expect(rain.shown.source).toBe('hook');
    expect(r.rain[r.rain.length - 1]).toEqual({level: 0.3, muffle: 0.2});
    setRainExposure(host, null);
  });

  it('only after the win: the sky\'s clearing gates it at every height; a registered surface exposure wins', () => {
    for (const y of [ROOF + 2, ROOF, ROOF - 3]) expect(rainMix(defaultRainExposure(y, ROOF), 0).level).toBe(0);
    expect(rainMix(defaultRainExposure(ROOF + 2, ROOF), 1)).toEqual({level: 1, muffle: 0});
    expect(rainMix(defaultRainExposure(ROOF + 2, ROOF), 0.5).level).toBeCloseTo(0.5, 9);
    expect(rainMix(null, 1).level).toBe(0);
    const host = {}, r = recSfx(), rain = new RainAudio(host, () => r.sfx), info = {pit: {roofY: ROOF}} as never;
    rain.frame(FRAME, {x: 0, y: ROOF + 2, z: 0}, 0, info); // on the surface but not won (cannot happen in play): silent
    expect(r.rain.filter(q => q.level > 0)).toEqual([]);
    rain.frame(FRAME, {x: 0, y: ROOF + 2, z: 0}, 1, info);
    expect(r.rain[r.rain.length - 1]).toEqual({level: 1, muffle: 0});
    expect(rain.shown.source).toBe('roofline');
    setRainExposure(host, eye => (eye.x > 5 ? {level: 0.4, muffle: 0.8} : null)); // lane SURFACE: a shelter at x > 5
    expect(rainExposureOf(host)).toBeTypeOf('function');
    for (let i = 0; i < 12; i++) rain.frame(FRAME, {x: 9, y: ROOF + 2, z: 0}, 1, info);
    expect(r.rain[r.rain.length - 1]).toEqual({level: 0.4, muffle: 0.8});
    expect(rain.shown.source).toBe('hook');
    for (let i = 0; i < 12; i++) rain.frame(FRAME, {x: 0, y: ROOF + 2, z: 0}, 1, info); // null: the default rule
    expect(r.rain[r.rain.length - 1]).toEqual({level: 1, muffle: 0});
    setRainExposure(host, null);
    // bounded sends: a steady minute re-sends about once a second, a change at most every sendS
    const n0 = r.rain.length;
    for (let i = 0; i < 3600; i++) rain.frame(FRAME, {x: 0, y: ROOF + 2, z: 0}, 1, info);
    expect(r.rain.length - n0).toBeLessThanOrEqual(Math.ceil(60 / RAIN_AUDIO.refreshS) + 1);
    rain.stop();
    expect(r.rain[r.rain.length - 1].level).toBe(0);
  });

  it('the runtime: a restored won world on the surface rains, inside the building it is silent; teardown silences it', () => {
    const a = rig();
    toTheRods(a);
    expect(a.rt.qaOperate('rods').ok).toBe(true);
    a.tick(0.1, 3);
    for (const s of a.h.sectionHooks) s.teardown?.();
    const b = rig(fakeHost(a.h.run, a.h.inv)), roof = b.h.layout.reactor!.pit.roofY;
    expect(b.rt.state!.restarted).toBe(true);
    b.h.camera.position.set(20, roof + 1.8, 20); b.h.camera.updateMatrixWorld(true);
    b.tick(FRAME, 10);
    expect(b.su.shown.clear).toBe(1);
    expect(b.r.rain[b.r.rain.length - 1]).toEqual({level: 1, muffle: 0});
    b.h.camera.position.set(12, -22.7, 32); b.h.camera.updateMatrixWorld(true); // the control room on the core floor
    b.tick(FRAME, 10);
    expect(b.r.rain[b.r.rain.length - 1].level).toBe(0);
    b.h.camera.position.set(20, roof + 1.8, 20); b.h.camera.updateMatrixWorld(true);
    b.tick(FRAME, 10);
    for (const s of b.h.sectionHooks) s.teardown?.();
    expect(b.r.rain[b.r.rain.length - 1].level).toBe(0);
    expect((b.su.qa() as {rain: {level: number}}).rain.level).toBe(0);
    // not won yet: the rain stays silent wherever the eye is
    const c = rig();
    c.h.camera.position.set(20, c.h.layout.reactor!.pit.roofY + 1.8, 20); c.h.camera.updateMatrixWorld(true);
    c.tick(FRAME, 30);
    expect(c.r.rain.filter(q => q.level > 0)).toEqual([]);
  });

  it('the Sfx bed: ONE looping channel created on first use, eased gain, low-passed + quieter when sheltered', async () => {
    const made: FakeCtx[] = [];
    const {bank, buffers} = fakeBank({variants: 1});
    const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
    sfx.init();
    sfx.suspend(false);
    await new Promise(r => setTimeout(r, 40));
    const ctx = made[0], s0 = ctx.started.length;
    sfx.rainBed(0, 0);
    expect(ctx.started.length).toBe(s0); // never asked for: no channel, no source
    sfx.rainBed(1, 0);
    expect(ctx.started.length).toBe(s0 + 1);
    const src = ctx.started[ctx.started.length - 1];
    expect(src.loop).toBe(true);
    expect(buffers.has(src.buffer)).toBe(true);
    const g = src.outputs[0] as FakeNode & {gain: Param}, lp = g.outputs[0] as FakeNode & {frequency: Param};
    expect(g.gain.value).toBeCloseTo(RAIN_BED.gain, 9);
    expect(lp.frequency.value).toBeCloseTo(RAIN_BED.openHz, 6);
    sfx.rainBed(1, 1);
    expect(g.gain.value).toBeCloseTo(RAIN_BED.gain * RAIN_BED.shelterLevel, 9);
    expect(lp.frequency.value).toBeCloseTo(RAIN_BED.muffledHz, 6);
    for (let i = 0; i < 200; i++) sfx.rainBed((i % 10) / 10, (i % 3) / 2);
    sfx.rainBed(0, 0);
    expect(g.gain.value).toBe(0);
    expect(ctx.started.length).toBe(s0 + 1); // never re-created
    expect(sfx.debugState().rain).toEqual({level: 0, muffle: 0, looping: true});
    expect(ctx.oscillatorCalls).toBe(0);
  });
});
