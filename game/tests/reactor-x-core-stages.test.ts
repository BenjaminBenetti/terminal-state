// Task reactor-expansion-20261101 (lane CORE): THE STAGED STARTUP — each restart state maps to the expected visual levels (fuses ->
// switchgear lamps, breaker -> control power, valve -> pressure / sight glasses, pump -> blue flow + rotors + blue light, key -> armed,
// rods -> the core: goop / green light / turbine), the visuals restore instantly and idempotently (no one-shots to replay), ease over
// time otherwise, and the ReactorVisuals seam carries setRestartState from the restart runtime (build + every change).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {emptyReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {CORE_EASE, CORE_LOOK, coreLook, coreStageTargets, easeLevels, lampColor, type CoreStageLevels} from '../src/world/reactor/coreStages';
import {CoreVisuals} from '../src/world/reactor/coreVisuals';
import {ReactorArchVisuals} from '../src/world/reactor/archVisuals';
import type {CoreHeroLayout} from '../src/world/reactor/coreHero';
import {setReactorVisuals} from '../src/world/reactor/visuals';
import {FUSE_CARTRIDGE_ID, REACTOR_KEY_ID} from '../src/world/reactor/restartLogic';
import {installCanvasShim} from './helpers/canvas2d';
import {buildRestart, fakeHost} from './helpers/reactorRestartFixture';

/** The restart chain, one step at a time (the order the rules allow). */
function chain(): {name: string; s: ReactorRunState}[] {
  const s = emptyReactorState(3, 3), out: {name: string; s: ReactorRunState}[] = [];
  const snap = (name: string) => out.push({name, s: JSON.parse(JSON.stringify(s))});
  snap('dormant');
  s.fuses[0] = true; snap('fuse 1');
  s.fuses[1] = true; snap('fuse 2');
  s.breaker = true; snap('breaker');
  s.valve = true; snap('valve');
  s.pump = true; snap('pump');
  s.keyInserted = true; snap('key');
  s.rods = true; s.restarted = true; s.restartedAt = 100; snap('rods');
  return out;
}

const run = (v: CoreVisuals, s: number, dt = 0.05) => { for (let t = 0; t < s; t += dt) v.tick(dt); };

describe('stage mapping (pure)', () => {
  const steps = chain();
  const T = Object.fromEntries(steps.map(q => [q.name, coreStageTargets(q.s)])) as Record<string, CoreStageLevels>;
  const look = (n: string) => coreLook(T[n]);

  it('each state change moves exactly its own levels', () => {
    expect(T.dormant).toEqual({fuse0: 0, fuse1: 0, power: 0, pressure: 0, flow: 0, armed: 0, core: 0});
    expect(T['fuse 1']).toMatchObject({fuse0: 1, fuse1: 0, power: 0});
    expect(T['fuse 2']).toMatchObject({fuse0: 1, fuse1: 1, power: 0});
    expect(T.breaker).toMatchObject({fuse0: 2, fuse1: 2, power: 1, pressure: 0});
    expect(T.valve).toMatchObject({power: 1, pressure: 1, flow: 0});
    expect(T.pump).toMatchObject({pressure: 1, flow: 1, armed: 0});
    expect(T.key).toMatchObject({flow: 1, armed: 1, core: 0});
    expect(T.rods).toMatchObject({armed: 1, core: 1});
  });

  it('the look: dormant green already glows, the restart is dramatically brighter; blue only once pressurised, strong with the pump', () => {
    const d = look('dormant');
    expect(d.goop).toBeGreaterThan(0.4); // clearly green from the rim before anything is done
    expect(d.green).toBeGreaterThan(50);
    expect(d.blue).toBe(0);
    expect(d.flowGlow).toBe(0);
    expect(d.pumpRev).toBe(0);
    expect(d.turbineRev).toBe(0);
    for (const n of ['fuse 1', 'fuse 2', 'breaker']) expect(look(n)).toEqual(d); // control power: the lamps change, not the liquids
    const v = look('valve');
    expect(v.fill).toBe(1);
    expect(v.blue).toBeGreaterThan(0);
    expect(v.flowSpeed).toBe(0); // pressurised, not flowing
    const p = look('pump');
    expect(p.flowSpeed).toBeGreaterThan(1);
    expect(p.pumpRev).toBeGreaterThan(1);
    expect(p.blue).toBeGreaterThan(v.blue * 4);
    expect(p.flowGlow).toBeGreaterThan(v.flowGlow * 4);
    const r = look('rods');
    expect(r.green).toBeGreaterThanOrEqual(d.green * 3.5);
    expect(r.goop).toBeGreaterThanOrEqual(d.goop * 2.5);
    expect(r.churn).toBeGreaterThan(d.churn * 3);
    expect(r.turbineRev).toBeGreaterThan(1);
    expect(r.blue).toBeGreaterThan(p.blue);
  });

  it('status lamps: fuses red -> amber seated -> green powered; valve amber; pump blue; key amber; rods green', () => {
    const c = (g: Parameters<typeof lampColor>[0], n: string) => lampColor(g, T[n], [0, 0, 0]);
    expect(c('fuse0', 'dormant')[0]).toBeGreaterThan(c('fuse0', 'dormant')[1] * 5); // red
    const amber = c('fuse0', 'fuse 1');
    expect(amber[0]).toBeGreaterThan(1); expect(amber[1]).toBeGreaterThan(0.5); expect(amber[2]).toBeLessThan(0.2);
    expect(c('fuse1', 'fuse 1')[0]).toBeGreaterThan(c('fuse1', 'fuse 1')[1] * 5); // the second slot still empty: red
    const green = c('fuse0', 'breaker');
    expect(green[1]).toBeGreaterThan(green[0] * 4);
    expect(c('power', 'fuse 2')[0]).toBeGreaterThan(c('power', 'fuse 2')[1] * 5);
    expect(c('power', 'breaker')[1]).toBeGreaterThan(1);
    expect(Math.max(...c('valve', 'breaker'))).toBeLessThan(0.05);
    expect(c('valve', 'valve')[0]).toBeGreaterThan(1);
    expect(c('pump', 'pump')[2]).toBeGreaterThan(1.5);
    expect(c('key', 'key')[0]).toBeGreaterThan(1);
    expect(c('rods', 'key')[1]).toBeLessThan(0.05);
    expect(c('rods', 'rods')[1]).toBeGreaterThan(1);
  });

  it('ramps: lamps switch fast, the glasses fill over ~3 s, the pumps spool over ~4 s, the core wakes over ~6 s', () => {
    const cur = {...T.breaker}, target = T.valve;
    easeLevels(cur, target, 1.5);
    expect(cur.pressure).toBeGreaterThan(0.4);
    expect(cur.pressure).toBeLessThan(0.6);
    easeLevels(cur, target, 2);
    expect(cur.pressure).toBe(1);
    expect(CORE_EASE.flow).toBe(4);
    expect(CORE_EASE.core).toBe(6);
    expect(CORE_EASE.power).toBeLessThan(0.5);
    expect(easeLevels(cur, target, 0.1)).toBe(false); // settled: nothing moves
  });
});

/** A hand-built hero layout + a fake built layer (uniforms + a rotor / lamp InstancedMesh stand-in). */
function fakeCore() {
  const hero = {lamps: [{group: 'fuse0'}, {group: 'power'}, {group: 'pump'}, {group: 'rods'}], wheels: [{}, {}]} as unknown as CoreHeroLayout;
  const colors: number[][] = [[], [], [], []], mats: number[] = [];
  const u = {time: {value: 0}, goop: {value: 0}, churn: {value: 0}, flowGlow: {value: 0}, flowShift: {value: 0}, fill: {value: 0}};
  const lamps = {setColorAt: (i: number, c: {r: number; g: number; b: number}) => { colors[i] = [c.r, c.g, c.b]; }, instanceColor: {needsUpdate: false}};
  const wheels = {setMatrixAt: (i: number) => { mats.push(i); }, instanceMatrix: {needsUpdate: false}};
  const basis = () => new THREE.Matrix4();
  const built = {uniforms: u, lamps, wheels, wheelInfo: [{basis: basis(), r: 1, kind: 'rcp', angle: 0}, {basis: basis(), r: 1, kind: 'turbine', angle: 0}]};
  return {v: new CoreVisuals(built as never, hero), u, colors, mats, built};
}

describe('CoreVisuals: idempotent, instant restore, eased changes', () => {
  const steps = chain();
  const S = Object.fromEntries(steps.map(q => [q.name, q.s])) as Record<string, ReactorRunState>;

  it('an instant restore jumps straight to the stage (a rebuilt restarted world comes back running); the same state again does nothing', () => {
    const {v, u, colors} = fakeCore();
    v.setRestartState(S.rods, true);
    expect(v.level).toEqual(coreStageTargets(S.rods));
    expect(u.goop.value).toBeCloseTo(CORE_LOOK.goopAlive);
    expect(u.flowGlow.value).toBeCloseTo(CORE_LOOK.flowRun);
    expect(u.fill.value).toBe(1);
    expect(colors[3][1]).toBeGreaterThan(1); // rods lamp green
    const before = v.state();
    for (let k = 0; k < 5; k++) v.setRestartState(S.rods, false);
    expect(v.counts.ignored).toBe(5);
    expect(v.state().level).toEqual(before.level);
    // a second instant restore (rebuild / reload) of the same record: same levels, no transition
    v.setRestartState(S.rods, true);
    expect(v.level).toEqual(before.level);
  });

  it('a live change eases: the pump spools the flow up over ~4 s, the rotors turn only while flowing, the lamps recolour on change only', () => {
    const {v, u, mats, colors} = fakeCore();
    v.setRestartState(S.valve, true);
    run(v, 1);
    expect(mats.length).toBe(0); // nothing turns before the pump
    const recolors = v.counts.recolors;
    run(v, 1);
    expect(v.counts.recolors).toBe(recolors); // settled: no lamp writes per frame
    v.setRestartState(S.pump, false);
    run(v, 1);
    expect(v.level.flow).toBeGreaterThan(0.2);
    expect(v.level.flow).toBeLessThan(0.3);
    expect(u.flowGlow.value).toBeGreaterThan(0.2);
    expect(mats.length).toBeGreaterThan(0); // the pump flywheel turns
    const shift0 = u.flowShift.value;
    run(v, 4);
    expect(v.level.flow).toBe(1);
    expect(u.flowShift.value).not.toBe(shift0); // the dashes stream
    expect(colors[2][2]).toBeGreaterThan(1.5); // pump lamp blue
    // the core: rods -> the goop / green ramp over ~6 s (setCoreGlow from the win sequence pulls it along)
    v.setRestartState(S.rods, false);
    run(v, 3);
    expect(v.level.core).toBeGreaterThan(0.4);
    expect(v.level.core).toBeLessThan(0.6);
    v.setCoreGlow(0.9);
    expect(v.level.core).toBeGreaterThanOrEqual(0.9);
    run(v, 3);
    expect(v.level.core).toBe(1);
    expect(v.lightLook().green).toBeGreaterThan(CORE_LOOK.greenAlive * 0.9);
  });

  it('setCoreGlow never wakes the core while the rods are in (dormant stays dormant)', () => {
    const {v} = fakeCore();
    v.setRestartState(S.key, true);
    v.setCoreGlow(1);
    expect(v.level.core).toBe(0);
  });

  it('the ReactorVisuals seam: ARCH visuals forward setRestartState / setCoreGlow / tick to the core', () => {
    const {v} = fakeCore();
    const arch = new ReactorArchVisuals(null, null, null);
    arch.core = v;
    arch.setRestartState(S.pump, true);
    expect(v.level.flow).toBe(1);
    arch.setRestartState(S.rods, false);
    arch.tick(1);
    expect(v.level.core).toBeGreaterThan(0.1);
    arch.setCoreGlow(1);
    expect(v.level.core).toBe(1);
  });
});

describe('the restart runtime drives setRestartState (on build, on every change, restored on rebuild)', () => {
  it('build -> instant restore; each completed control -> one live call with the new state; a rebuild restores instantly', () => {
    const calls: {s: ReactorRunState; instant: boolean}[] = [];
    const vis = {setFanSpeed() {}, setGeneratorRunning() {}, setCoreGlow() {}, setTierPower() {},
      setRestartState(s: Readonly<ReactorRunState>, instant: boolean) { calls.push({s: JSON.parse(JSON.stringify(s)), instant}); }};
    const un = installCanvasShim(false);
    setReactorVisuals(vis);
    try {
      const h = fakeHost();
      const rt = buildRestart(h);
      rt.frame(0.016);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.every(c => c.instant)).toBe(true);
      const n0 = calls.length;
      h.inv.add(h.inv.makeStack(FUSE_CARTRIDGE_ID, 2));
      h.inv.add(h.inv.makeStack(REACTOR_KEY_ID, 1));
      for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch'] as const) expect(rt.qaOperate(id).ok, id).toBe(true);
      const live = calls.slice(n0);
      expect(live.length).toBe(6);
      expect(live.every(c => !c.instant)).toBe(true);
      expect(live.map(c => coreStageTargets(c.s))).toEqual([
        {fuse0: 1, fuse1: 0, power: 0, pressure: 0, flow: 0, armed: 0, core: 0},
        {fuse0: 1, fuse1: 1, power: 0, pressure: 0, flow: 0, armed: 0, core: 0},
        {fuse0: 2, fuse1: 2, power: 1, pressure: 0, flow: 0, armed: 0, core: 0},
        {fuse0: 2, fuse1: 2, power: 1, pressure: 1, flow: 0, armed: 0, core: 0},
        {fuse0: 2, fuse1: 2, power: 1, pressure: 1, flow: 1, armed: 0, core: 0},
        {fuse0: 2, fuse1: 2, power: 1, pressure: 1, flow: 1, armed: 1, core: 0},
      ]);
      // a repeated press (already done) sends nothing new
      expect(rt.qaOperate('pump').ok).toBe(false);
      expect(calls.length).toBe(n0 + 6);
      // travel away and back: the rebuilt world is restored instantly at the reached stage
      rt.teardown();
      const n1 = calls.length;
      rt.build(h.layout);
      rt.frame(0.016);
      const back = calls.slice(n1);
      expect(back.length).toBeGreaterThanOrEqual(1);
      expect(back.every(c => c.instant)).toBe(true);
      expect(coreStageTargets(back[back.length - 1].s)).toEqual({fuse0: 2, fuse1: 2, power: 1, pressure: 1, flow: 1, armed: 1, core: 0});
    } finally {
      setReactorVisuals(null);
      un();
    }
  });
});
