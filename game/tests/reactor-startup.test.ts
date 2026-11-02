// Task reactor-playtest-round2-20261102 (lane STARTUP): the Reactor coming to life — user: "sound design of reactor power up needs to be
// improved ... spinning orange lights as the building comes to life ... play noise as the control rods are removed!" and "when the
// reactor comes online the fog visible through the roof should clear, with a blue beam shooting up in to the sky ... it should caste
// light and illuminate the area." Checks:
//  - the startup score (pure): stage diffs, the bed building per stage, the win's cue times, live crossings vs jumps;
//  - the audio director on a recording Sfx: one cue set per stage, the rod drive synced to the rod hold (one loop pair, rate rising
//    with the handle, the stop clunk / the let-go clunk / silent on pause), the surge / ONLINE / tier clunks on the win clock, bounded
//    loops, NO replay on a rebuild / reload / QA jump;
//  - the runtime on the fake restart host (the real ReactorRestart): stages -> cues, the hold, the beam firing at ONLINE, a rebuilt
//    restarted world restored at once (beam up, sky clear, no cue), the bounded boot-time light set (never changes);
//  - the beacons on real layouts: mounted on solid wall (no doorway / room behind, nothing walking through the head), per storey,
//    spread, the body touching the wall and the head seated on the pedestal; three instanced meshes; they turn only when powered;
//  - the ONLINE sky: the outdoor air over the roof clears through ONE function (exposure = what the march draws, at every clearing).
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {codeToSeed} from '../src/core/rng';
import type {StationLayout} from '../src/gen/stationTypes';
import {SOLID} from '../src/gen/grid';
import {WIN, planWin, tierStartAt} from '../src/world/reactor/restartWin';
import {HOLD_S, FUSE_CARTRIDGE_ID, REACTOR_KEY_ID} from '../src/world/reactor/restartLogic';
import {ReactorRestart} from '../src/world/reactor/restart';
import {setReactorVisuals} from '../src/world/reactor/visuals';
import {STAGE_THUMP, STARTUP, beamAt, beaconPowerAt, bedAt, cuesCrossed, rodRate, skyClearAt, stageEvents, winCues, type StageSnap} from '../src/world/reactor/startupPlan';
import {StartupAudio, type StartupSfx, type StartupSites} from '../src/world/reactor/startupAudio';
import {BEACONS, openBehind, planBeacons, walkwayAt} from '../src/world/reactor/startupBeaconPlan';
import {BEACON_LIGHTS, BeaconLights, BeaconVisuals, beaconBodyGeometry, beaconDomeGeometry} from '../src/world/reactor/startupBeacons';
import {BEAM, OnlineSky, beamSpan} from '../src/world/reactor/startupSky';
import {ReactorStartup} from '../src/world/reactor/startup';
import {REACTOR_AIR, ReactorAir} from '../src/world/reactor/air';
import {emptyReactorState} from '../src/world/reactor/runState';
import {layoutRect} from '../src/world/reactor/generators';
import {REACTOR_OUTDOOR, REACTOR_SKY_CLEAR, outdoorGasAt} from '../src/world/gaslightRules';
import {roofOpeningOf} from '../src/gen/reactor/roofOpening';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import type {FogUniforms} from '../src/render/volumetricShaders';
import {MALL_SKY, MALL_SKY_U} from '../src/world/mallExterior';
import {aimAt, fakeHost, type FakeHost} from './helpers/reactorRestartFixture';

afterEach(() => { setReactorVisuals(null); MALL_SKY_U.gas.value = MALL_SKY.gas; });

const S0: StageSnap = {fuses: 0, breaker: false, valve: false, pump: false, key: false, rods: false, restarted: false};
const SEEDS = [codeToSeed('000070S')!, 637474, 218558];
const layouts = new Map<number, StationLayout>();
const real = (seed: number) => { let L = layouts.get(seed); if (!L) layouts.set(seed, (L = LEVELS.reactor.generate('main', {levelSeed: seed}))); return L; };

// ---------------------------------------------------------------------------------------------------------------------------------
// A recording Sfx (the machine API of audio/sfx.ts)

interface Rec { cue: string; x: number; y: number; z: number; gain?: number; rate?: number; pri?: number }
interface LoopRec { cue: string; x: number; y: number; z: number; playing: boolean; rates: number[]; levels: number[]; stops: number[]; moved: number }
function recSfx(up = true) {
  const cues: Rec[] = [], loops: LoopRec[] = [];
  const sfx: StartupSfx & {reactorLoop: NonNullable<StartupSfx['reactorLoop']>} = {
    reactorCue: (cue, x, y, z, o) => { cues.push({cue, x, y, z, gain: o?.gain, rate: o?.rate, pri: o?.pri}); },
    reactorLoop: (cue, x, y, z, o) => {
      if (!up) return null;
      const r: LoopRec = {cue, x, y, z, playing: true, rates: o?.rate !== undefined ? [o.rate] : [], levels: o?.level !== undefined ? [o.level] : [], stops: [], moved: 0};
      loops.push(r);
      return {get playing() { return r.playing; }, setPos() { r.moved++; }, stop(f?: number) { r.playing = false; r.stops.push(f ?? -1); },
        setLevel(k: number) { r.levels.push(k); }, setRate(v: number) { r.rates.push(v); }};
    },
  };
  return {sfx, cues, loops, live: () => loops.filter(l => l.playing)};
}

function sites(): StartupSites & {beaconOn: boolean} {
  const ctl = (x: number) => ({x, y: -20, z: 5});
  const s = {
    beaconOn: false,
    core: {x: 0, y: -25, z: 0}, crdm: {x: 0, y: -16, z: 0},
    control: (id: string) => ({'fuse-0': ctl(1), 'fuse-1': ctl(2), breaker: ctl(3), valve: ctl(4), pump: ctl(5), keyswitch: ctl(6), rods: ctl(7)} as Record<string, {x: number; y: number; z: number}>)[id] ?? null,
    tier: (rank: number) => ({x: 10, y: -30 + rank * 6, z: 0}),
    beacon: () => (s.beaconOn ? {x: 9, y: -26, z: 0} : null),
  };
  return s as StartupSites & {beaconOn: boolean};
}

// ---------------------------------------------------------------------------------------------------------------------------------

describe('the startup score (pure)', () => {
  it('a live record change names each completed step once, in order; every power stage has its thump', () => {
    expect(stageEvents(S0, {...S0, fuses: 1})).toEqual(['fuse']);
    expect(stageEvents({...S0, fuses: 1}, {...S0, fuses: 2})).toEqual(['fuses']);
    expect(stageEvents({...S0, fuses: 2}, {...S0, fuses: 2, breaker: true})).toEqual(['breaker']);
    expect(stageEvents(S0, {...S0, fuses: 2, breaker: true, valve: true, pump: true, key: true, rods: true})).toEqual(['fuses', 'breaker', 'valve', 'pump', 'key', 'rods']);
    expect(stageEvents({...S0, breaker: true}, {...S0, breaker: true})).toEqual([]);
    for (const ev of ['fuses', 'breaker', 'valve', 'pump', 'key'] as const) expect(STAGE_THUMP[ev]!.gain, ev).toBeGreaterThan(0);
    expect(STAGE_THUMP.breaker!.gain).toBe(Math.max(...Object.values(STAGE_THUMP).map(t => t?.gain ?? 0))); // control power: the heaviest
  });

  it('the core bed is silent before control power and BUILDS with every stage, to full at ONLINE', () => {
    expect(bedAt(S0, null)).toBeNull();
    const chain: StageSnap[] = [{...S0, fuses: 2, breaker: true}];
    for (const k of ['valve', 'pump', 'key', 'rods'] as const) chain.push({...chain[chain.length - 1], [k]: true});
    const lv = chain.map((s, i) => bedAt(s, i === chain.length - 1 ? 0 : null)!);
    for (let i = 1; i < lv.length; i++) { expect(lv[i].level).toBeGreaterThan(lv[i - 1].level); expect(lv[i].rate).toBeGreaterThan(lv[i - 1].rate); }
    const on = bedAt({...chain[4], restarted: true}, STARTUP.onlineAtS)!;
    expect(on.level).toBe(1);
    expect(bedAt({...chain[4], restarted: true}, Infinity)).toEqual(on); // a restored world: the running machine at once
  });

  it('the win: surge at 0, ONLINE at the core ramp end, tier clunks bottom-up; a live step crosses them, a jump never does', () => {
    const c = winCues(6);
    expect(c[0]).toEqual({at: 0, kind: 'surge'});
    expect(c.find(q => q.kind === 'online')!.at).toBe(WIN.coreS);
    const tiers = c.filter(q => q.kind === 'tier');
    expect(tiers.map(q => q.rank)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tiers.map(q => q.at)).toEqual([0, 1, 2, 3, 4, 5].map(r => tierStartAt(r, 6)));
    expect(cuesCrossed(c, -1, 0).map(q => q.kind)).toEqual(['surge']); // the win just started (t = 0)
    expect(cuesCrossed(c, 5.9, 6.0).map(q => q.kind)).toEqual(['online', 'tier']); // ONLINE + the core floor's lights
    expect(cuesCrossed(c, 6.0, 6.1)).toEqual([]);
    expect(cuesCrossed(c, 2, 2 + STARTUP.maxStepS + 0.5)).toEqual([]); // a QA finish / restore jump
    expect(cuesCrossed(c, -1, Infinity)).toEqual([]);
    let n = 0;
    for (let t = 0; t < 40; t += 0.05) n += cuesCrossed(c, t, t + 0.05).length;
    expect(n + cuesCrossed(c, -1, 0).length).toBe(c.length); // each exactly once when stepped live
  });

  it('beam, sky and beacons are pure functions of the win clock: dark before, the end state at once when restored', () => {
    expect(beamAt(-1)).toEqual({head: 0, on: 0});
    expect(beamAt(STARTUP.onlineAtS - 0.01).on).toBe(0);
    expect(beamAt(STARTUP.onlineAtS + STARTUP.beamRiseS / 2).head).toBeCloseTo(0.5, 6);
    expect(beamAt(Infinity)).toEqual({head: 1, on: 1});
    expect(skyClearAt(STARTUP.onlineAtS)).toBe(0);
    expect(skyClearAt(STARTUP.onlineAtS + STARTUP.skyClearS)).toBe(1);
    expect(skyClearAt(Infinity)).toBe(1);
    // the orange wave: the core floor turns as the rods come out, the rim last, every tier at full once restored
    expect(beaconPowerAt(0, 0, 6)).toBe(0);
    expect(beaconPowerAt(WIN.tierRampS, 0, 6)).toBe(1);
    expect(beaconPowerAt(WIN.tierRampS, 5, 6)).toBe(0);
    expect(beaconPowerAt(WIN.tierSpanS, 5, 6)).toBe(1);
    for (let r = 0; r < 6; r++) expect(beaconPowerAt(Infinity, r, 6)).toBe(1);
    expect(rodRate(1)).toBeGreaterThan(rodRate(0));
  });
});

describe('the startup audio director (recording Sfx)', () => {
  function walk(a: StartupAudio, st: StartupSites, snap: StageSnap, frames = 1, hold: number | null = null, winT: number | null = null): void {
    for (let i = 0; i < frames; i++) a.frame(0.1, snap, hold, winT, st, {x: 0, y: -20, z: 8});
  }

  it('per stage: a thump at the control; the bed starts at control power and builds; the rods drive while the handle moves', () => {
    const r = recSfx(), st = sites(), a = new StartupAudio(() => r.sfx);
    a.build(S0, null, 6);
    walk(a, st, S0, 3);
    expect(r.cues).toEqual([]);
    let s: StageSnap = {...S0, fuses: 1};
    walk(a, st, s);
    expect(r.cues).toEqual([]); // the first fuse: restart.ts's own fuse cue only
    s = {...s, fuses: 2}; walk(a, st, s);
    s = {...s, breaker: true}; walk(a, st, s, 3);
    s = {...s, valve: true}; walk(a, st, s, 3);
    s = {...s, pump: true}; walk(a, st, s, 3);
    s = {...s, key: true}; walk(a, st, s, 3);
    expect(r.cues.map(c => [c.cue, c.x, c.gain, c.rate])).toEqual([
      ['reactorStage', 2, STAGE_THUMP.fuses!.gain, STAGE_THUMP.fuses!.rate], ['reactorStage', 3, STAGE_THUMP.breaker!.gain, STAGE_THUMP.breaker!.rate],
      ['reactorStage', 4, STAGE_THUMP.valve!.gain, STAGE_THUMP.valve!.rate], ['reactorStage', 5, STAGE_THUMP.pump!.gain, STAGE_THUMP.pump!.rate],
      ['reactorStage', 6, STAGE_THUMP.key!.gain, STAGE_THUMP.key!.rate],
    ]);
    // ONE bed loop at the core, started at the breaker and levelled up per stage (never re-requested while it plays)
    const beds = r.loops.filter(l => l.cue === 'reactorBed');
    expect(beds).toHaveLength(1);
    expect([beds[0].x, beds[0].y, beds[0].z]).toEqual([st.core.x, st.core.y, st.core.z]);
    const lv = [...new Set(beds[0].levels)];
    expect(lv).toEqual([...lv].sort((p, q) => p - q));
    expect(lv.length).toBeGreaterThanOrEqual(4);
    // the rod hold: one drive at the console + one at the CRDM, rate rising with the handle, ONE stop clunk at each when the rods are out
    r.cues.length = 0;
    for (let i = 0; i <= 40; i++) walk(a, st, s, 1, i / 40);
    const rods = r.loops.filter(l => l.cue === 'reactorRodLoop');
    expect(rods).toHaveLength(2);
    expect(rods.map(l => [l.x, l.y, l.z])).toEqual([[7, -20, 5], [st.crdm.x, st.crdm.y, st.crdm.z]]);
    for (const l of rods) { expect(l.playing).toBe(true); for (let i = 1; i < l.rates.length; i++) expect(l.rates[i]).toBeGreaterThanOrEqual(l.rates[i - 1]); }
    expect(rods[0].rates[rods[0].rates.length - 1]).toBeCloseTo(rodRate(1), 6);
    expect(a.loops).toBeLessThanOrEqual(4);
    s = {...s, rods: true, restarted: true};
    walk(a, st, s, 1, null, 0);
    expect(rods.every(l => !l.playing)).toBe(true);
    expect(r.cues.filter(c => c.cue === 'reactorRodStop').map(c => [c.x, c.gain])).toEqual([[7, 1], [st.crdm.x, 1]]);
    expect(r.cues.filter(c => c.cue === 'reactorSurge')).toHaveLength(1); // the rods are out: the surge at the core, same frame
    expect(r.cues.find(c => c.cue === 'reactorSurge')!.pri).toBe(2);
    expect(a.counts).toMatchObject({stage: 5, rodLoops: 1, rodStops: 1, rodLetGo: 0, surge: 1});
  });

  it('the win on its live clock: ONLINE (+ a deep thump) at the core, every tier clunks once bottom-up with rising pitch; the beacon motor', () => {
    const r = recSfx(), st = sites(), a = new StartupAudio(() => r.sfx);
    const s: StageSnap = {fuses: 2, breaker: true, valve: true, pump: true, key: true, rods: true, restarted: true};
    a.build({...s, rods: false, restarted: false}, null, 6);
    let t = 0;
    walk(a, st, s, 1, null, 0);
    while (t < 30) { t += 0.1; if (t > 10) st.beaconOn = true; walk(a, st, s, 1, null, t); }
    expect(r.cues.filter(c => c.cue === 'reactorSurge')).toHaveLength(1);
    expect(r.cues.filter(c => c.cue === 'reactorOnline')).toHaveLength(1);
    expect(r.cues.filter(c => c.cue === 'reactorOnline')[0]).toMatchObject({x: st.core.x, y: st.core.y, z: st.core.z, pri: 2});
    const tiers = r.cues.filter(c => c.cue === 'reactorBreaker');
    expect(tiers.map(c => c.y)).toEqual([0, 1, 2, 3, 4, 5].map(k => -30 + k * 6));
    for (let i = 1; i < tiers.length; i++) expect(tiers[i].rate!).toBeGreaterThan(tiers[i - 1].rate!);
    expect(r.loops.filter(l => l.cue === 'reactorBeacon')).toHaveLength(1);
    expect(a.loops).toBeLessThanOrEqual(4);
  });

  it('NO replay: a rebuilt / reloaded / revisited world (any stage, restarted or not) plays no stage, rod or win cue', () => {
    for (const s of [{...S0, fuses: 2, breaker: true, valve: true}, {fuses: 2, breaker: true, valve: true, pump: true, key: true, rods: true, restarted: true}] as StageSnap[]) {
      const r = recSfx(), st = sites(), a = new StartupAudio(() => r.sfx);
      a.build(s, s.restarted ? Infinity : null, 6);
      for (let i = 0; i < 300; i++) walk(a, st, s, 1, null, s.restarted ? Infinity : null);
      expect(r.cues, JSON.stringify(s)).toEqual([]);
      expect(r.loops.filter(l => l.cue === 'reactorBed')).toHaveLength(1); // the running machine (a loop, not a replay)
      if (s.restarted) expect(a.counts.replaysBlocked).toBe(winCues(6).length);
    }
    // a QA jump of the live clock (reactorWinFinish) crosses nothing either
    const r = recSfx(), st = sites(), a = new StartupAudio(() => r.sfx);
    const s: StageSnap = {fuses: 2, breaker: true, valve: true, pump: true, key: true, rods: true, restarted: true};
    a.build(s, 0.5, 6);
    walk(a, st, s, 1, null, 0.6);
    walk(a, st, s, 1, null, 60);
    expect(r.cues).toEqual([]);
  });

  it('let go early: the drive stops with a light clunk; leaving play: it stops at once, silently; audio not running: retried, never stacked', () => {
    const r = recSfx(), st = sites(), a = new StartupAudio(() => r.sfx);
    const s: StageSnap = {fuses: 2, breaker: true, valve: true, pump: true, key: true, rods: false, restarted: false};
    a.build(s, null, 6);
    for (let i = 0; i < 10; i++) walk(a, st, s, 1, i / 40);
    walk(a, st, s, 1, null);
    expect(r.loops.filter(l => l.cue === 'reactorRodLoop').every(l => !l.playing)).toBe(true);
    expect(r.cues.map(c => [c.cue, c.gain])).toEqual([['reactorRodStop', 0.45]]);
    expect(a.counts.rodLetGo).toBe(1);
    // a menu mid-hold: the restart lets go too; nothing sounds when play resumes
    r.cues.length = 0;
    for (let i = 0; i < 10; i++) walk(a, st, s, 1, i / 40);
    a.pause();
    expect(r.loops.filter(l => l.cue === 'reactorRodLoop').every(l => !l.playing)).toBe(true);
    walk(a, st, s, 5, null);
    expect(r.cues).toEqual([]);
    // audio not up yet: loop requests come back null and are retried at a bounded rate
    const down = recSfx(false), b = new StartupAudio(() => down.sfx);
    let asked = 0;
    const orig = down.sfx.reactorLoop;
    down.sfx.reactorLoop = (...args) => { asked++; return orig(...args); };
    b.build(s, null, 6);
    for (let i = 0; i < 50; i++) b.frame(0.1, s, null, null, st, {x: 0, y: 0, z: 0});
    expect(asked).toBeGreaterThan(2);
    expect(asked).toBeLessThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The runtime on the restart's fake host (the real ReactorRestart drives it)

function startupRig(h: FakeHost = fakeHost()) {
  const r = recSfx();
  h.sfx = r.sfx;
  const scene0 = h.scene.children.length;
  const rt = new ReactorRestart(h).install();
  rt.recordMilestone = () => true;
  rt.clearAir = () => true;
  const su = new ReactorStartup(h as never).install();
  const lightsAdded = h.scene.children.filter(o => (o as THREE.Light).isLight).length;
  for (const s of h.sectionHooks) s.build?.(h.layout);
  const tick = (dt = 0.1, n = 1) => { for (let i = 0; i < n; i++) { h.clockS += dt; for (const f of h.frameHooks) f(dt); } };
  return {h, rt, su, r, tick, lightsAdded, scene0};
}

describe('the startup runtime (fake host, the real restart runtime)', () => {
  it('stages -> thumps at the controls, the rod hold -> the drive + stop clunk, the win -> surge, ONLINE, the beam fires; bounded lights', () => {
    const {h, rt, su, r, tick, lightsAdded} = startupRig();
    expect(lightsAdded).toBe(BEACON_LIGHTS.count + 2); // 3 beacon SpotLights + the beam's 2 PointLights, at boot
    expect(su.sky!.beam.visible).toBe(false);
    h.inv.add(h.inv.makeStack(FUSE_CARTRIDGE_ID, 2));
    h.inv.add(h.inv.makeStack(REACTOR_KEY_ID, 1));
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch'] as const) { expect(rt.qaOperate(id).ok, id).toBe(true); tick(0.1, 2); }
    expect(r.cues.filter(c => c.cue === 'reactorStage')).toHaveLength(5);
    expect(r.loops.filter(l => l.cue === 'reactorBed')).toHaveLength(1);
    // the rods: a real 4 s hold of E at the rod control
    aimAt(h, rt, 'rods');
    h.keys.add('KeyE');
    expect(rt.interact()).toBe(true);
    const rodsAt = rt.controls.find(c => c.id === 'rods')!.m.pick;
    for (let i = 0; i < 20; i++) tick(0.1);
    const drive = r.loops.filter(l => l.cue === 'reactorRodLoop');
    expect(drive).toHaveLength(2);
    expect(Math.hypot(drive[0].x - rodsAt.x, drive[0].z - rodsAt.z)).toBeLessThan(0.3);
    expect(drive[0].playing).toBe(true);
    for (let i = 0; i < 22; i++) tick(0.1);
    h.keys.delete('KeyE');
    expect(rt.state!.rods).toBe(true);
    expect(drive.every(l => !l.playing)).toBe(true);
    expect(r.cues.filter(c => c.cue === 'reactorRodStop')).toHaveLength(2);
    expect(r.cues.filter(c => c.cue === 'reactorSurge')).toHaveLength(1);
    // to ONLINE: the impact, the beam climbs from the vessel into the sky, its lights cast
    while (rt.win!.t < STARTUP.onlineAtS + STARTUP.beamRiseS + 0.2) tick(0.1);
    expect(r.cues.filter(c => c.cue === 'reactorOnline')).toHaveLength(1);
    expect(su.sky!.beam.visible).toBe(true);
    expect(su.sky!.u.on.value).toBe(1);
    expect(su.sky!.u.head.value).toBeGreaterThan(h.layout.reactor!.pit.roofY + 50);
    expect(su.beamLights.mid.intensity).toBeGreaterThan(0);
    expect(su.beamLights.roof.intensity).toBeGreaterThan(0);
    while (!rt.win!.done) tick(0.1);
    tick(0.1, 300);
    expect(su.shown.clear).toBe(1);
    expect(MALL_SKY_U.gas.value).toBe(0); // the outside gas sheets over the opening are gone
    expect(r.cues.filter(c => c.cue === 'reactorBreaker').length).toBeGreaterThan(0); // restart.ts's breaker + the tier clunks
    expect(h.scene.children.filter(o => (o as THREE.Light).isLight).length).toBe(lightsAdded); // the light set never changed
    su.teardown();
    expect(MALL_SKY_U.gas.value).toBe(MALL_SKY.gas);
    expect(su.beamLights.mid.intensity).toBe(0);
  });

  it('a rebuilt restarted world: beam up, sky clear, no startup cue at all; the light set is unchanged', () => {
    const a = startupRig();
    a.h.inv.add(a.h.inv.makeStack(FUSE_CARTRIDGE_ID, 2));
    a.h.inv.add(a.h.inv.makeStack(REACTOR_KEY_ID, 1));
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch', 'rods'] as const) { expect(a.rt.qaOperate(id).ok, id).toBe(true); a.tick(0.1); }
    a.tick(0.1, 20); // travel away mid-sequence
    for (const s of a.h.sectionHooks) s.teardown?.();
    const h2 = fakeHost(a.h.run, a.h.inv);
    const b = startupRig(h2);
    expect(b.rt.state!.restarted).toBe(true);
    b.tick(0.1, 100);
    expect(b.r.cues.filter(c => /^reactor(Stage|RodStop|Surge|Online|Breaker)$/.test(c.cue))).toEqual([]);
    expect(b.su.sky!.beam.visible).toBe(true);
    expect(b.su.sky!.u.on.value).toBe(1);
    expect(b.su.shown.clear).toBe(1);
    expect(b.su.audio.counts.replaysBlocked).toBeGreaterThan(0);
    expect(b.r.loops.filter(l => l.cue === 'reactorBed')).toHaveLength(1);
  });

  it('a menu mid rod-hold stops the drive at once (state listener), no clunk on resume', () => {
    const {h, rt, r, tick} = startupRig();
    h.inv.add(h.inv.makeStack(FUSE_CARTRIDGE_ID, 2));
    h.inv.add(h.inv.makeStack(REACTOR_KEY_ID, 1));
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch'] as const) rt.qaOperate(id);
    aimAt(h, rt, 'rods');
    h.keys.add('KeyE');
    rt.interact();
    tick(0.1, 10);
    const drive = r.loops.filter(l => l.cue === 'reactorRodLoop');
    expect(drive.some(l => l.playing)).toBe(true);
    h.state = 'paused';
    for (const f of h.stateListeners!) (f as unknown as (s: string, p: string) => void)('paused', 'playing');
    expect(drive.every(l => !l.playing)).toBe(true);
    h.state = 'playing';
    h.keys.delete('KeyE');
    r.cues.length = 0;
    tick(0.1, 5);
    expect(r.cues.filter(c => c.cue === 'reactorRodStop')).toEqual([]);
    expect(rt.state!.rods).toBe(false);
    expect(HOLD_S.rods).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The beacons on real layouts

describe('the orange beacons (real layouts)', () => {
  it('mounted on solid pit wall on every storey (rim .. core floor), spread, nothing walking through them; deterministic', () => {
    for (const seed of SEEDS) {
      const L = real(seed), info = L.reactor!, b = planBeacons(L);
      expect(b).toEqual(planBeacons(L));
      expect(b.length).toBeLessThanOrEqual(BEACONS.perStorey * info.tiers.length);
      for (const t of info.tiers) {
        const mine = b.filter(s => s.tier === t.level);
        expect(mine.length, `${seed} ${t.label}`).toBeGreaterThanOrEqual(2);
        for (const p of mine) for (const q of mine) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(BEACONS.minGap);
      }
      for (const s of b) {
        const tag = `${seed} T${s.tier} (${s.x}, ${s.y}, ${s.z})`;
        expect(Math.hypot(s.nx, s.nz)).toBeCloseTo(1, 2);
        expect((info.pit.cx - s.x) * s.nx + (info.pit.cz - s.z) * s.nz, tag).toBeGreaterThan(0); // facing into the pit
        // the plate is bolted to solid wall: behind it nothing is open on any storey over the whole beacon height
        expect(openBehind(L, s.x - s.nx * 0.25, s.y + BEACONS.plate.y, s.z - s.nz * 0.25, BEACONS.plate.h / 2, BEACONS.plate.h / 2 + BEACONS.head.h), tag).toBe(false);
        // ... and the face itself is open air in front: the head's band on its level holds the whole head
        const g = L.levels[s.level].grid, [cx, cy] = g.cellOf(s.head.x, s.head.z), i = g.idx(cx, cy);
        expect(g.cells[i], tag).not.toBe(SOLID);
        expect(g.floorOf(i), tag).toBeLessThan(s.y - 0.3);
        expect(g.ceilAt(s.head.x, s.head.z), tag).toBeGreaterThanOrEqual(s.y + BEACONS.head.h + BEACONS.ceilClear - 1e-6);
        // over the deck, above the wall lamp, out of every walkway / flight
        expect(s.y - s.deckY, tag).toBeGreaterThan(3);
        expect(walkwayAt(L, s.head.x, s.y, s.head.z), tag).toBe(false);
      }
    }
  });

  it('the body touches the wall, the head sits on the pedestal (never floating); 3 instanced meshes, one material each, shared', () => {
    const body = beaconBodyGeometry(), dome = beaconDomeGeometry();
    body.computeBoundingBox(); dome.computeBoundingBox();
    expect(body.boundingBox!.min.z).toBeCloseTo(0, 4); // the plate's back on the wall face
    expect(body.boundingBox!.max.y).toBeCloseTo(Math.max(BEACONS.head.collar, BEACONS.plate.y + BEACONS.plate.h / 2), 4); // the collar / plate top
    expect(dome.boundingBox!.min.y + BEACONS.head.h / 2).toBeCloseTo(BEACONS.head.collar, 4); // the lens starts on the collar
    expect(dome.boundingBox!.max.y + BEACONS.head.h / 2).toBeCloseTo(BEACONS.head.h, 4);
    const L = real(SEEDS[0]), spots = planBeacons(L);
    const v1 = new BeaconVisuals(spots), v2 = new BeaconVisuals(spots);
    const meshes: THREE.InstancedMesh[] = [];
    v1.group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.InstancedMesh); });
    expect(meshes).toHaveLength(3);
    for (const m of meshes) { expect(m.count).toBe(spots.length); expect(m.castShadow).toBe(false); expect(m.userData.levels.length).toBeGreaterThan(0); }
    expect(v1.dome.material).toBe(v2.dome.material);
    expect(v1.body.material).toBe(v2.body.material);
    expect(v1.flare.material).toBe(v2.flare.material);
    // the head's centre stands over the pedestal (out along the normal) at the planned height
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    spots.forEach((s, i) => {
      v1.body.getMatrixAt(i, m);
      p.set(0, 0, BEACONS.out).applyMatrix4(m);
      expect(Math.hypot(p.x - s.head.x, p.z - s.head.z)).toBeLessThan(1e-3);
      expect(s.head.y - p.y).toBeCloseTo(BEACONS.head.h / 2, 3);
    });
    v1.dispose(); v2.dispose();
  });

  it('they turn only when powered (rate x power), stay put when dark; the real lights follow the 3 nearest powered ones', () => {
    const L = real(SEEDS[1]), spots = planBeacons(L), v = new BeaconVisuals(spots);
    const v0 = v.dome.instanceMatrix.version;
    expect(v.update(0.1, () => 0, STARTUP.beaconRev)).toBe(0);
    expect(v.dome.instanceMatrix.version).toBe(v0); // no matrix writes while all dark
    const a0 = Float32Array.from(v.angle);
    expect(v.update(0.1, i => (i === 0 ? 1 : i === 1 ? 0.5 : 0), STARTUP.beaconRev)).toBe(2);
    const turned = (i: number) => (((v.angle[i] - a0[i]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(turned(0)).toBeCloseTo(0.1 * STARTUP.beaconRev * Math.PI * 2, 4);
    expect(turned(1)).toBeCloseTo(0.05 * STARTUP.beaconRev * Math.PI * 2, 4);
    expect(v.angle[2]).toBe(a0[2]);
    const lights = new BeaconLights();
    const eye = {x: spots[0].head.x, y: spots[0].head.y, z: spots[0].head.z};
    for (let i = 0; i < 5; i++) v.update(0.1, () => 0, STARTUP.beaconRev);
    expect(lights.update(0.3, v, eye)).toBe(0);
    for (let i = 0; i < 5; i++) v.update(0.1, () => 1, STARTUP.beaconRev);
    let lit = 0;
    for (let i = 0; i < 10; i++) lit = lights.update(0.1, v, eye);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThanOrEqual(BEACON_LIGHTS.count);
    expect(lights.lights).toHaveLength(BEACON_LIGHTS.count);
    const near = [...spots.keys()].sort((p, q) => Math.hypot(spots[p].head.x - eye.x, spots[p].head.y - eye.y, spots[p].head.z - eye.z) - Math.hypot(spots[q].head.x - eye.x, spots[q].head.y - eye.y, spots[q].head.z - eye.z));
    expect(lights.assigned.includes(near[0])).toBe(true);
    // the spot sweeps with its beacon's reflector
    const k = lights.assigned.indexOf(near[0]), s = lights.lights[k], d = new THREE.Vector3();
    v.facing(near[0], d);
    expect((s.target.position.x - s.position.x) * d.x + (s.target.position.z - s.position.z) * d.z).toBeGreaterThan(5);
    v.dispose();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The ONLINE sky: the outdoor gas over the roof clears through ONE function

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function renderOutdoor(u: FogUniforms, x: number, y: number, z: number): number {
  const r = u.depthRect.value as THREE.Vector4, o = u.depthOut.value as THREE.Vector4;
  if (!(u.depthOn.value > 0.5) || x < r.x || x > r.z || z < r.y || z > r.w) return 0;
  return o.z * sstep(o.x, o.y, y);
}

describe('the ONLINE sky (real layout)', () => {
  it('outdoor air over the roof: exposure == what the march draws at every clearing, thinning and lifting to nothing', () => {
    const L = real(SEEDS[0]), info = L.reactor!;
    const st = emptyReactorState(info.generators.length, info.zones.length);
    const air = new ReactorAir(info, layoutRect(L), st);
    const a = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
    a.setStation(L, null);
    const o = roofOpeningOf(info)!;
    let prevTop = Infinity;
    for (const k of [0, 0.2, 0.5, 0.8, 1]) {
      air.setOutdoorClear(k);
      expect(air.update(1, false) || k === 0).toBe(true); // a clearing change re-uploads the render table
      a.setDepthGas(air.renderTable());
      a.sync(new THREE.Scene(), new THREE.PerspectiveCamera(), 1);
      expect(air.renderTable().outdoor).toBe(air.outdoor); // the SAME object the exposure reads
      for (let y = info.pit.roofY; y < info.pit.roofY + 30; y += 0.5) {
        const hz = air.depthGasAt(o.x, y, o.z);
        expect(hz).toBeCloseTo(outdoorGasAt(air.outdoor, o.x, y, o.z), 9);
        expect(renderOutdoor(a.u, o.x, y, o.z), `k ${k} y ${y}`).toBeCloseTo(hz, 6);
      }
      const top = air.depthGasAt(o.x, info.pit.roofY + 40, o.z);
      expect(top).toBeCloseTo(REACTOR_OUTDOOR.c * (1 - k), 6);
      expect(top).toBeLessThanOrEqual(prevTop);
      prevTop = top;
      expect(air.outdoor!.y0).toBeCloseTo(info.pit.roofY + REACTOR_OUTDOOR.rampLo + REACTOR_SKY_CLEAR.lift * k, 6);
    }
    expect(prevTop).toBe(0);
    // the strata are untouched by the sky clearing (that is lane GAS's / AIR's)
    const ref = new ReactorAir(info, layoutRect(L), emptyReactorState(info.generators.length, info.zones.length));
    for (let y = info.pit.floorY; y < info.pit.rimY; y += 0.7) expect(air.tableAt(y)).toBe(ref.tableAt(y));
    // clearing again to 0 (a new world) brings the surface air back exactly
    air.setOutdoorClear(0);
    expect(air.depthGasAt(o.x, info.pit.roofY + 40, o.z)).toBeCloseTo(REACTOR_OUTDOOR.c, 6);
    expect(REACTOR_AIR.CHANGE_EPS).toBeGreaterThan(0);
  });

  it('the beam: additive, emissive, from the vessel up through the single roof opening into the sky; one draw, no shadow', () => {
    for (const seed of SEEDS) {
      const L = real(seed), info = L.reactor!, o = roofOpeningOf(info)!;
      const sky = new OnlineSky(info, L.levels.map(l => l.id));
      const span = beamSpan(info);
      expect(Math.hypot(span.x - o.x, span.z - o.z) + BEAM.glow).toBeLessThan(o.r); // the whole beam passes through the opening
      expect(span.y0).toBeGreaterThan(info.core.y0);
      expect(span.y0).toBeLessThan(info.core.y1 + 4);
      expect(span.y1).toBeGreaterThan(info.pit.roofY + 100);
      const m = sky.beam.material as THREE.Material;
      expect(m.blending).toBe(THREE.AdditiveBlending);
      expect(m.depthWrite).toBe(false);
      expect(m.transparent).toBe(true);
      expect(m.side).toBe(THREE.FrontSide);
      expect(sky.beam.castShadow).toBe(false);
      expect(sky.beam.visible).toBe(false);
      sky.apply(beamAt(Infinity), 1);
      expect(sky.beam.visible).toBe(true);
      expect(sky.dome!.visible).toBe(true);
      expect(sky.group.children).toHaveLength(2);
      sky.dispose();
    }
  });

  it('the runtime writes the clearing into the built air (exposure + render) and the outside gas uniform; restores it on teardown', () => {
    const L = real(SEEDS[2]), info = L.reactor!;
    const air = new ReactorAir(info, layoutRect(L), emptyReactorState(info.generators.length, info.zones.length));
    const h = fakeHost();
    h.layout = L;
    const su = new ReactorStartup(h as never).install();
    let win: {t: number} | null = null;
    const state = {...emptyReactorState(0, 0), fuses: [true, true], breaker: true, valve: true, pump: true, keyInserted: true, rods: true, restarted: true};
    su.findRestart = () => ({state, win, hold: null, controls: []}) as never;
    su.findAir = () => air;
    win = {t: 0};
    su.build(L);
    const o = roofOpeningOf(info)!;
    const at = () => air.depthGasAt(o.x, info.pit.roofY + 40, o.z);
    expect(at()).toBeCloseTo(REACTOR_OUTDOOR.c, 6);
    for (let t = 0; t <= STARTUP.onlineAtS + STARTUP.skyClearS / 2; t += 0.1) { win.t = t; su.frame(0.1); }
    expect(at()).toBeCloseTo(REACTOR_OUTDOOR.c * (1 - skyClearAt(win.t)), 3);
    expect(MALL_SKY_U.gas.value).toBeCloseTo(MALL_SKY.gas * (1 - skyClearAt(win.t)), 3);
    expect(su.beacons!.stats().lit).toBe(su.beacons!.spots.length); // the orange wave reached the rim
    for (let t = win.t; t <= STARTUP.onlineAtS + STARTUP.skyClearS + 1; t += 0.1) { win.t = t; su.frame(0.1); }
    expect(at()).toBe(0);
    su.teardown();
    expect(MALL_SKY_U.gas.value).toBe(MALL_SKY.gas);
    // a restored world (no live sequence, restarted): clear at once
    win = null;
    const air2 = new ReactorAir(info, layoutRect(L), emptyReactorState(info.generators.length, info.zones.length));
    su.findAir = () => air2;
    su.build(L);
    expect(air2.depthGasAt(o.x, info.pit.roofY + 40, o.z)).toBe(0);
    expect(su.sky!.beam.visible).toBe(true);
    expect(su.beacons!.stats().lit).toBe(su.beacons!.spots.length);
    expect(planWin(info.tiers, info.fans).tiers.length).toBe(info.tiers.length);
    su.teardown();
  });
});
