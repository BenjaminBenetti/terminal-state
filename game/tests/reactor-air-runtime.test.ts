// Task reactor-build-20261101 (lane AIR): the Reactor air RUNTIME with a fake Game host — the EXPOSURE integration through the
// existing gas system (depth term only when layout.reactor; every other level unchanged; the mask protects; the fallback haze), the
// GENERATOR hold / start state machine (hold E 2 s with the ring, cancels, crank -> running, fan spool, staged clearing, alerts +
// bounded pulses, exhaust, audio seam absent / present), PERSISTENCE through the shared REACTOR_LANE record (RESTART's parts kept,
// rebuild without re-spool / re-crank), the HUD air line, and the whole generator route walked WITHOUT a mask: no damage, no deadlock.
// Task reactor-playtest-round2-20261102 (lane GAS, USER DESIGN CHANGE — "the final generator to clear the fog out of the bottom level
// should jam … you must wear a gas mask down there. Once the reactor comes on line then the fog at the bottom will clear out"): the
// route WITHOUT a mask now ends at the final generator's deck (it stands in cleared air, as before), but that generator JAMS
// (gen/reactor/gasJam.ts), so the core floor stays deadly unmasked until the reactor is online. The old "zero damage down to the core
// floor" walk and the future-start-time case (it used the now jammed generator 2) are rewritten for that intent, not cut: the
// rebase case runs on a working generator, and the jam has its own state machine / persistence / visuals tests below.
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GAS} from '../src/world/gas/field';
import {installGas, type GasHost, type GasSystem} from '../src/world/gas/system';
import {GENERATOR_CLEAR_S, REACTOR_AIR, ReactorAir} from '../src/world/reactor/air';
import {REACTOR_GEN, aimGenerator, generatorPhase, installReactorAir, layoutRect, reactorAirRuntime, reactorClearAll, type ReactorAirHost, type ReactorAirRuntime} from '../src/world/reactor/generators';
import {REACTOR_LANE, emptyReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {setReactorVisuals} from '../src/world/reactor/visuals';
import type {StationLayout} from '../src/gen/stationTypes';
import type {ReactorInfo} from '../src/gen/reactor/reactorTypes';
import {fixtureInfo, fixtureLayout} from './reactor-air-fixture';
import {JAM_TEXT, REACTOR_JAM} from '../src/gen/reactor/gasJam'; // task reactor-playtest-round2-20261102 (lane GAS)

const dpsOf = (c: number) => GAS.DPS_MAX * Math.min(1, Math.max(0, (c - GAS.THRESHOLD) / (1 - GAS.THRESHOLD)));

interface FakeBrain { alive: boolean; x: number; y: number; z: number; state: string; stats: {radius: number}; heard: number[]; hear(x: number, z: number, r: number, y?: number): void }
const brain = (x: number, y: number, z: number): FakeBrain => ({alive: true, x, y, z, state: 'idle', stats: {radius: 0.3}, heard: [], hear(_x, _z, r) { this.heard.push(r); }});

/** Gas system + Reactor runtime on one fake Game host (install order as in the Game constructor: gas first). */
function rig(layout: StationLayout, o: {sfx?: unknown; zombies?: FakeBrain[]; store?: Map<string, unknown>} = {}) {
  let clock = 0;
  const keys = {E: false};
  const camPos = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, -1);
  const toasts: string[] = [], rings: (number | null)[] = [], depthUploads: unknown[] = [], smoke: {x: number; y: number; z: number; stopped: boolean}[] = [];
  const store = o.store ?? new Map<string, unknown>();
  const tiers = layout.reactor?.tiers ?? [{level: 0, baseY: 0}];
  const hits: number[] = [];
  const h = {
    player: {x: 0, y: 0, z: 0, eye: 1.62, alive: true, climbing: false, hp: 1e6, yaw: 0, pitch: 0, takeDamage(a: number) { hits.push(a); this.hp -= a; }},
    camera: {getWorldPosition: (v: THREE.Vector3) => v.copy(camPos), getWorldDirection: (v: THREE.Vector3) => v.copy(camDir), updateMatrixWorld() {}},
    input: {down: (c: string) => c === 'KeyE' && keys.E, clears: 0},
    hud: {setHoldRing: (p: number | null) => { rings.push(p); }, toast: (t: string) => { toasts.push(t); }},
    levels: {
      raycast: () => ({t: Infinity, kind: 'none'}),
      lineOfSight: () => true,
      levelAt: (_x: number, _z: number, y: number) => { let best: {level: number; baseY: number} | null = null; for (const t of tiers) if (t.baseY <= y + 0.5 && (!best || t.baseY > best.baseY)) best = t; return best?.level ?? 0; },
      list: tiers.map(t => ({baseY: t.baseY})),
      count: tiers.length,
    },
    zombies: (o.zombies ?? []).map(b => ({brain: b, ragdolled: false})),
    layout,
    tower: {office: null},
    atmosphere: {
      active: true, setGasLayer() {}, setDepthGas: (d: unknown) => { depthUploads.push(d); },
      addSmokeEmitter: (e: {x: number; y: number; z: number}) => { const r = {...e, stopped: false}; smoke.push(r); return {id: smoke.length, get alive() { return !r.stopped; }, emitting: true, setPos() {}, update() {}, stop() { r.stopped = true; }}; },
    },
    atmosphereBypass: null as string | null,
    run: {laneStore: (k: string) => store.get(k), setLaneStore: (k: string, d: unknown) => { store.set(k, d); }},
    get clock() { return clock; },
    state: 'playing',
    sfx: o.sfx ?? {},
    frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    interactHandlers: [] as (() => boolean)[],
    promptProviders: [] as (() => string | null)[],
    inputOwners: [] as (() => boolean)[],
    stateListeners: [] as ((s: never, p: never) => void)[],
    bulletHitHandlers: [] as unknown[],
    gas: null as unknown as GasSystem,
  };
  h.gas = installGas(h as unknown as GasHost);
  const rt = installReactorAir(h as unknown as ReactorAirHost);
  const api = {
    h, rt, gas: h.gas, keys, toasts, rings, depthUploads, smoke, store, hits,
    get clock() { return clock; },
    build: () => { for (const s of h.sectionHooks) s.build?.(layout); },
    teardown: () => { for (const s of h.sectionHooks) s.teardown?.(); },
    tick: (dt = 0.1, n = 1) => { for (let i = 0; i < n; i++) { clock += dt; for (const f of h.frameHooks) f(dt); } },
    /** Run `seconds` of play in 0.1 s frames. */
    run: (seconds: number) => api.tick(0.1, Math.round(seconds / 0.1)),
    place: (x: number, y: number, z: number) => { Object.assign(h.player, {x, y, z, eye: y + 1.62}); camPos.set(x, y + 1.62, z); },
    aim: (x: number, y: number, z: number) => { camPos.set(h.player.x, h.player.eye, h.player.z); camDir.set(x, y, z).sub(camPos).normalize(); },
    look: (dx: number, dy: number, dz: number) => { camDir.set(dx, dy, dz).normalize(); },
    pressE: () => { keys.E = true; for (const f of h.interactHandlers) if (f()) return true; return false; },
    prompt: () => { for (const f of h.promptProviders) { const p = f(); if (p) return p; } return null; },
    /** Stand at generator `id`'s use point aiming at its panel. */
    goGen: (id: number) => { const g = layout.reactor!.generators[id]; api.place(g.use.x, g.y, g.use.z); api.aim(g.panel.x, g.panel.y, g.panel.z); },
    /** Hold E on the aimed generator until it starts (HOLD_S + a frame). */
    holdStart: () => { expect(api.pressE()).toBe(true); api.run(REACTOR_GEN.HOLD_S + 0.15); api.keys.E = false; },
    state: () => store.get(REACTOR_LANE) as ReactorRunState | undefined,
  };
  return api;
}

const calls: {fan: Map<number, number>; gen: [number, number][]} = {fan: new Map(), gen: []};
beforeEach(() => {
  calls.fan.clear();
  calls.gen.length = 0;
  setReactorVisuals({setFanSpeed: (id, s) => { calls.fan.set(id, s); }, setGeneratorRunning: (id, l) => { calls.gen.push([id, l]); }, setCoreGlow() {}, setTierPower() {}});
});
afterEach(() => setReactorVisuals(null));

describe('reactor air: exposure through the existing gas system', () => {
  it('other levels: no layout.reactor -> no depth term at all (even with a depth source set), the fast path, the runtime inert', () => {
    const r = rig(fixtureLayout(null));
    r.build();
    expect(r.rt.air).toBeNull();
    expect(r.gas.depth).toBeNull();
    // a stray depth source on a non-reactor layout is ignored
    const info = fixtureInfo();
    r.gas.depth = new ReactorAir(info, {x0: 0, z0: 0, x1: 80, z1: 80}, emptyReactorState(3, 3));
    r.place(40, -30, 40);
    r.run(2);
    expect(r.gas.exposure).toMatchObject({c: 0, dps: 0, damage: 0, source: null});
    expect(r.hits).toEqual([]);
    expect(r.gas.hud.shown.tag).toBe('');
    expect(r.depthUploads).toEqual([]);
    expect(r.pressE()).toBe(false);
    expect(r.prompt()).toBeNull();
    expect(r.rt.hud.shown.text).toBe('');
  });

  it('the Reactor: c = the depth gas at the eye -> the same threshold / dps / damage / HUD path (source depth)', () => {
    const r = rig(fixtureLayout());
    r.build();
    expect(r.gas.depth).toBe(r.rt.air);
    expect(r.depthUploads.length).toBe(1); // the strata table went to the volumetric pass at build
    r.place(40, -34, 40);
    r.tick(0.1);
    const c = r.rt.air!.depthGasAt(40, -34 + 1.62, 40);
    expect(c).toBeGreaterThan(0.6);
    expect(r.gas.exposure.c).toBeCloseTo(c, 9);
    expect(r.gas.exposure.depth).toBeCloseTo(c, 9);
    expect(r.gas.exposure.source).toBe('depth');
    expect(r.gas.exposure.dps).toBeCloseTo(dpsOf(c), 9);
    expect(r.hits[0]).toBeCloseTo(dpsOf(c) * 0.1, 9);
    expect(r.gas.hud.shown.tag).toBe('TOXIC GAS');
    expect(r.gas.hud.shown.haze).toBe(0); // the volumetric pass draws it
    // the rim is clean
    r.place(30, 0, 10);
    r.tick(0.1);
    expect(r.gas.exposure).toMatchObject({c: 0, dps: 0, source: null});
    expect(r.gas.hud.shown.tag).toBe('');
  });

  it('the mask protects (the existing protection rule), and the fallback haze covers the depth gas when the volumetric pass is off', () => {
    const r = rig(fixtureLayout());
    r.build();
    r.place(40, -30, 40);
    r.gas.protection = () => true;
    r.run(1);
    expect(r.gas.exposure.protected).toBe(true);
    expect(r.gas.exposure.dps).toBe(0);
    expect(r.hits).toEqual([]);
    expect(r.gas.hud.shown.tag).toBe('FILTERING');
    r.gas.protection = () => false;
    (r.h.atmosphere as {active: boolean}).active = false;
    r.tick(0.1);
    expect(r.gas.exposure.source).toBe('depth');
    // task reactor-expansion-20261101 (lane GASLIGHT): the fallback is the in-engine fog tint now (no CSS screen haze, CLAUDE.md rule)
    expect(r.gas.exposure.fallback).toBeGreaterThan(0.2);
    expect(r.gas.hud.shown.haze).toBe(0);
  });

  it('teardown: the depth source never outlives its world (gas.depth null, table withdrawn, HUD line hidden)', () => {
    const r = rig(fixtureLayout());
    r.build();
    r.place(24, -7, 37);
    r.run(0.5);
    expect(r.rt.hud.shown.text).toMatch(/^Tier 1 · Zone 1 · /);
    r.teardown();
    expect(r.gas.depth).toBeNull();
    expect(r.depthUploads.at(-1)).toBeNull();
    expect(r.rt.hud.shown.text).toBe('');
    expect(r.rt.air).toBeNull();
  });
});

describe('reactor air: generators (hold E -> crank -> running -> fans -> staged clearing)', () => {
  it('aiming: the panel within reach from the use point; not when looking away, standing far off or at another deck', () => {
    const info = fixtureInfo(), g = info.generators[1];
    const eye = {x: g.use.x, y: g.y + 1.62, z: g.use.z}, feet = {x: g.use.x, y: g.y, z: g.use.z};
    const d = new THREE.Vector3(g.panel.x - eye.x, g.panel.y - eye.y, g.panel.z - eye.z).normalize();
    expect(aimGenerator(info.generators, eye, d, feet)?.id).toBe(1);
    expect(aimGenerator(info.generators, eye, {x: 0, y: 0, z: 1}, feet)).toBeNull();
    expect(aimGenerator(info.generators, {...eye, z: eye.z + 4}, d, {...feet, z: feet.z + 4})).toBeNull();
    expect(aimGenerator(info.generators, {...eye, y: eye.y - 5}, d, {...feet, y: feet.y - 5})).toBeNull();
  });

  it('hold E 2 s with the ring -> started (persisted), cranking 1.5 s -> running, fans spool 8 s, the zone clears in stages', () => {
    const r = rig(fixtureLayout());
    r.build();
    r.goGen(1);
    r.tick(0.05);
    expect(r.rt.target).toBe(1);
    expect(r.prompt()).toBe('<b>Hold [E]</b> Start auxiliary generator (Zone 2 extraction fans)');
    expect(r.pressE()).toBe(true);
    expect(r.h.inputOwners.some(f => f())).toBe(true); // no shot while holding
    r.run(1.9);
    expect(r.rt.state!.generators[1].started).toBe(false);
    expect(r.rings.at(-1)).toBeGreaterThan(0.9);
    expect(r.prompt()).toMatch(/Starting the auxiliary generator/);
    const t = r.clock;
    r.run(0.2);
    expect(r.rt.state!.generators[1]).toEqual({started: true, startedAt: expect.closeTo(t + 0.1, 6)});
    expect(r.rings.at(-1)).toBeNull();
    expect(r.toasts.at(-1)).toMatch(/Zone 2 extraction fans spooling up/);
    expect((r.state()!).generators[1].started).toBe(true); // saved at once
    expect(calls.gen).toContainEqual([1, REACTOR_GEN.CRANK_LEVEL]);
    expect(r.prompt()).toMatch(/cranking/);
    const t0 = r.rt.state!.generators[1].startedAt;
    r.run(REACTOR_AIR.CRANK_S);
    expect(calls.gen.at(-1)).toEqual([1, 1]);
    expect(generatorPhase(r.rt.state!.generators[1], r.clock)).toBe('running');
    // the zone's fans spool up (ARCH eases the blades toward these)
    expect(calls.fan.get(2)!).toBeLessThan(0.3);
    r.run(REACTOR_AIR.SPOOL_S + 0.2);
    expect(calls.fan.get(2)).toBe(1);
    expect(calls.fan.get(3)).toBe(1);
    expect(calls.fan.get(0)).toBe(0); // other zones' fans stay still
    expect(r.rt.hud.shown).toEqual({text: 'Tier 1 · Zone 1 · toxic air · fans off', tone: 'toxic'}); // this deck's own zone is untouched
    // the HUD line on this deck (Tier 1 = zone 0, untouched) and down in zone 2's tier
    r.place(30, -17.5, 50);
    r.run(0.3);
    expect(r.rt.hud.shown.text).toMatch(/^Tier 2 · Zone 2 · air clearing \d+ %$/);
    r.run(t0 + GENERATOR_CLEAR_S + 0.5 - r.clock);
    expect(r.rt.state!.zoneClear[1]).toBe(1);
    expect(r.rt.hud.shown).toEqual({text: 'Tier 2 · Zone 2 · air clear', tone: 'clear'});
    expect(r.state()!.zoneClear[1]).toBe(1); // the stage saves reached the store
    // a running generator: E is consumed (status only), never a second start
    r.goGen(1);
    r.tick(0.05);
    expect(r.prompt()).toBe('Auxiliary generator running · Zone 2 fans: air clear');
    expect(r.pressE()).toBe(true);
    r.run(3);
    expect(r.rt.counts.starts).toBe(1);
  });

  it('the hold cancels on release, look-away, moving, cleared input and death — nothing starts', () => {
    const r = rig(fixtureLayout());
    r.build();
    const cases: [string, () => void][] = [
      ['release', () => { r.keys.E = false; }],
      ['look away', () => r.look(0, 0, 1)],
      ['move', () => { r.h.player.x += 0.5; }],
      ['clears', () => { r.h.input.clears++; }],
      ['death', () => { r.h.player.alive = false; }],
    ];
    for (const [name, act] of cases) {
      r.h.player.alive = true;
      r.goGen(0);
      r.tick(0.05);
      expect(r.pressE(), name).toBe(true);
      r.run(1);
      act();
      r.run(0.2);
      expect(r.rt.hold, name).toBeNull();
      r.keys.E = true;
      r.goGen(0); // back on the panel, E still down: no silent restart of the old hold
      r.run(2);
      r.keys.E = false;
      expect(r.rt.state!.generators[0].started, name).toBe(false);
    }
    expect(r.rt.counts.starts).toBe(0);
  });

  it('LOUD: one big alert at start (40 m) then bounded smaller pulses for 90 s, then quiet; no spawning', () => {
    const near = brain(30, 0, 30), mid = brain(24 + 30, -7, 37), far = brain(24, -7, 37 + 45), dead = brain(25, 0, 30);
    dead.alive = false;
    const r = rig(fixtureLayout(), {zombies: [near, mid, far, dead]});
    r.build();
    r.goGen(0);
    r.tick(0.05);
    r.holdStart();
    expect(near.heard).toEqual([REACTOR_GEN.ALERT_START_M]);
    expect(mid.heard).toEqual([REACTOR_GEN.ALERT_START_M]);
    expect(far.heard).toEqual([]);
    expect(dead.heard).toEqual([]);
    r.run(200);
    const pulses = REACTOR_GEN.ALERT_WINDOW_S / REACTOR_GEN.ALERT_PULSE_EVERY_S;
    expect(r.rt.counts.pulses).toBe(pulses);
    expect(near.heard.length).toBe(1 + pulses);
    expect(near.heard.slice(1).every(x => x === REACTOR_GEN.ALERT_PULSE_M)).toBe(true);
    expect(mid.heard.length).toBe(1); // beyond the pulses' radius
    expect(r.h.zombies.length).toBe(4);
  });

  it('exhaust: one smoke emitter for the nearest running generator (re-added only if evicted); audio seam absent = silent', () => {
    const r = rig(fixtureLayout());
    r.build();
    r.goGen(0);
    r.tick(0.05);
    r.holdStart();
    r.run(5);
    expect(r.smoke.length).toBe(1);
    r.smoke[0].stopped = true; // evicted by the smoke pool (flares)
    r.run(1);
    expect(r.smoke.length).toBe(2);
    r.place(40, -34, 40); // far from every running generator
    r.run(1);
    expect(r.smoke[1].stopped).toBe(true);
    expect(r.rt.counts.cues).toBe(0);
    expect(r.rt.counts.loops).toBe(0);
  });

  it('audio seam present: the start cue once, one generator loop + one fan loop (after the start cue), stopped at teardown', () => {
    const played: string[] = [], loops: {cue: string; stopped: boolean}[] = [];
    const sfx = {
      reactorCue: (cue: string) => { played.push(cue); return true; },
      reactorLoop: (cue: string) => { const l = {cue, stopped: false}; loops.push(l); return {stop() { l.stopped = true; }, get playing() { return !l.stopped; }}; },
    };
    const r = rig(fixtureLayout(), {sfx});
    r.build();
    r.goGen(0);
    r.tick(0.05);
    r.holdStart();
    expect(played).toEqual(['reactorGeneratorStart']);
    r.run(REACTOR_GEN.LOOP_AFTER_S - 2.5);
    expect(loops.map(l => l.cue)).toEqual(['reactorFanLoop']);
    r.run(30);
    expect(loops.map(l => l.cue).sort()).toEqual(['reactorFanLoop', 'reactorGeneratorLoop']);
    r.teardown();
    expect(loops.every(l => l.stopped)).toBe(true);
  });
});

describe('reactor air: persistence (REACTOR_LANE shared with lane RESTART)', () => {
  it('save keeps RESTART parts; a rebuild restores running generators / spun fans at once (no re-crank, no re-spool), clearing continues', () => {
    const store = new Map<string, unknown>();
    const seeded = emptyReactorState(3, 3);
    seeded.fuses = [true, false];
    seeded.keyInserted = true;
    store.set(REACTOR_LANE, JSON.parse(JSON.stringify(seeded)));
    const played: string[] = [];
    const r = rig(fixtureLayout(), {store, sfx: {reactorCue: (c: string) => { played.push(c); }}});
    r.build();
    r.goGen(0);
    r.tick(0.05);
    r.holdStart();
    r.run(25);
    const f = r.rt.state!.zoneClear[0];
    expect(f).toBeGreaterThan(0.2);
    r.teardown();
    const saved = r.state()!;
    expect(saved.fuses).toEqual([true, false]);
    expect(saved.keyInserted).toBe(true);
    expect(saved.generators[0].started).toBe(true);
    expect(saved.zoneClear[0]).toBeCloseTo(f, 6);
    // away for a while (the clock runs on elsewhere), then back
    r.tick(20);
    calls.fan.clear();
    calls.gen.length = 0;
    r.build();
    expect(calls.gen).toContainEqual([0, 1]); // running at once
    expect(calls.fan.get(0)).toBe(1);
    expect(r.rt.state!.zoneClear[0]).toBeGreaterThan(f);
    expect(played).toEqual(['reactorGeneratorStart']); // never cranked again
    r.run(GENERATOR_CLEAR_S);
    expect(r.rt.state!.zoneClear[0]).toBe(1);
    expect(r.state()!.fuses).toEqual([true, false]);
  });

  it('a lost / future start time never re-spools from zero: the saved fraction stands', () => {
    // (lane GAS: on generator 1 — generator 2 is the jammed final one now; its legacy record is the next test)
    const store = new Map<string, unknown>();
    const s = emptyReactorState(3, 3);
    s.generators[1] = {started: true, startedAt: 1e9};
    s.zoneClear[1] = 0.5;
    store.set(REACTOR_LANE, s);
    const r = rig(fixtureLayout(), {store});
    r.build();
    expect(r.rt.state!.zoneClear[1]).toBeCloseTo(0.5, 9);
    expect(generatorPhase(r.rt.state!.generators[1], r.clock)).toBe('running');
    r.run(5);
    expect(r.rt.state!.zoneClear[1]).toBeGreaterThan(0.5);
  });

  it('(lane GAS) a record from before the jam with the final generator started: not running now, its saved fraction stands, never rises', () => {
    const store = new Map<string, unknown>();
    const s = emptyReactorState(3, 3);
    s.generators[2] = {started: true, startedAt: 5};
    s.zoneClear[2] = 0.5;
    store.set(REACTOR_LANE, s);
    const r = rig(fixtureLayout(), {store});
    r.tick(0.1, 100);
    r.build();
    expect(r.rt.state!.generators[2].started).toBe(false);
    expect(r.rt.generators()[2]).toMatchObject({phase: 'jammed', jammed: true, started: false});
    r.run(GENERATOR_CLEAR_S);
    expect(r.rt.state!.zoneClear[2]).toBeCloseTo(0.5, 9); // never re-gassed, never cleared further by the dead generator
    r.teardown();
    expect((store.get(REACTOR_LANE) as ReactorRunState).generators[2].started).toBe(false);
    expect((store.get(REACTOR_LANE) as ReactorRunState).jam.generator).toBe(2);
  });

  it('RESTART win: reactorClearAll() clears the whole pit and persists; a restored win mid-clearing resumes', () => {
    const r = rig(fixtureLayout());
    r.build();
    expect(reactorAirRuntime()).toBe(r.rt);
    expect(reactorClearAll(10)).toBe(true);
    r.run(10.5);
    expect(r.rt.state!.zoneClear).toEqual([1, 1, 1]);
    expect(r.state()!.zoneClear).toEqual([1, 1, 1]);
    // restored: the win flag set by RESTART, zones only partly clear -> the clearing resumes
    const store = new Map<string, unknown>();
    const s = emptyReactorState(3, 3);
    Object.assign(s, {fuses: [true, true], breaker: true, valve: true, pump: true, keyInserted: true, rods: true, restarted: true, restartedAt: 0, zoneClear: [0.4, 0.2, 0]});
    store.set(REACTOR_LANE, s);
    const q = rig(fixtureLayout(), {store});
    q.tick(1);
    q.build();
    q.run(REACTOR_AIR.CLEAR_ALL_S + 1);
    expect(q.rt.state!.zoneClear).toEqual([1, 1, 1]);
  });
});

describe('reactor air: the generator route WITHOUT a mask — no deadlock down to the final generator, which JAMS (lane GAS design change)', () => {
  it('rim generator -> clear -> walk to generator 1 (zone 0 deck) -> the final generator: zero gas damage; it jams, the core floor needs the mask until online', () => {
    const layout = fixtureLayout(), info = layout.reactor as ReactorInfo;
    const r = rig(layout);
    r.build();
    const jam = r.rt.jam!;
    expect(jam.generator).toBe(2); // the deepest zone's
    for (const g of info.generators) {
      r.goGen(g.id);
      r.run(1); // standing there unmasked, before starting it
      expect(r.gas.exposure.c, `at generator ${g.id}`).toBeLessThan(GAS.THRESHOLD);
      r.holdStart();
      expect(r.rt.state!.generators[g.id].started, `generator ${g.id}`).toBe(g.id !== jam.generator);
      r.run(GENERATOR_CLEAR_S + 1);
    }
    expect(r.hits).toEqual([]);
    expect(r.gas.exposure.damage).toBe(0);
    expect(r.rt.state!.zoneClear).toEqual([1, 1, 0]); // the bottom stays gassed
    // the core floor unmasked is deadly; with the mask (+ filter) the existing protection rule holds
    r.place(40, info.pit.floorY, 40);
    r.run(1);
    expect(r.gas.exposure.c).toBeGreaterThan(0.5);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.rt.hud.shown).toEqual({text: 'Core floor · Zone 3 · toxic air · fans jammed — gas mask on', tone: 'toxic'});
    const hurt = r.hits.length;
    r.gas.protection = () => true;
    r.run(2);
    expect(r.hits.length).toBe(hurt);
    expect(r.gas.exposure.c).toBeGreaterThan(0.5); // the mask never hides the gas: same c, only no damage
    r.gas.protection = () => false;
    // the reactor ONLINE (the win's clearAll) clears the bottom: then the core floor breathes
    expect(reactorClearAll(REACTOR_AIR.CLEAR_ALL_S)).toBe(true);
    r.run(REACTOR_AIR.CLEAR_ALL_S + 1);
    expect(r.rt.state!.zoneClear[2]).toBe(1);
    const n = r.hits.length;
    r.run(2);
    expect(r.gas.exposure.c).toBeLessThan(GAS.HUD_MIN);
    expect(r.hits.length).toBe(n);
    // the same walk straight down without the generators would hurt (the route matters)
    const q = rig(fixtureLayout());
    q.build();
    q.goGen(1);
    q.run(1);
    expect(q.gas.exposure.c).toBeGreaterThan(GAS.THRESHOLD);
    expect(q.hits.length).toBeGreaterThan(0);
  });

  it('layoutRect covers every level grid', () => {
    expect(layoutRect(fixtureLayout())).toEqual({x0: 0, z0: 0, x1: 80, z1: 80});
    void (null as unknown as ReactorAirRuntime);
  });
});

describe('reactor air: the final generator JAMS (task reactor-playtest-round2-20261102, lane GAS — user design change)', () => {
  it('the hold cranks it, then it seizes: a clear prompt / toast / lamps / sound, never started, its zone never clears, the press is not silent', () => {
    const jammedCalls: [number, boolean][] = [];
    setReactorVisuals({setFanSpeed: (id, s) => { calls.fan.set(id, s); }, setGeneratorRunning: (id, l) => { calls.gen.push([id, l]); }, setCoreGlow() {}, setTierPower() {}, setGeneratorJammed: (id, on) => { jammedCalls.push([id, on]); }});
    const played: [string, number | undefined][] = [];
    const sfx = {voice: () => ({}), play: (_v: unknown, cue: string, o?: {delay?: number}) => { played.push([cue, o?.delay]); }};
    const z = brain(26, -20, 48);
    const r = rig(fixtureLayout(), {sfx, zombies: [z]});
    r.build();
    expect(r.rt.jam).toMatchObject({generator: 2, zone: 2});
    expect(jammedCalls).toContainEqual([2, true]); // its fault lamp flashes from the start (the boards say it too)
    r.goGen(2);
    r.tick(0.05);
    expect(r.prompt()).toBe(JAM_TEXT.promptTry(2));
    r.holdStart();
    expect(r.rt.state!.generators[2].started).toBe(false);
    expect(r.rt.counts.starts).toBe(0);
    expect(r.rt.counts.stalls).toBe(1);
    expect(r.toasts.at(-1)).toBe(JAM_TEXT.stalled(2));
    expect(r.toasts.at(-1)).toMatch(/JAMMED.*gas mask.*online/);
    expect(calls.gen).toContainEqual([2, REACTOR_GEN.CRANK_LEVEL]); // it cranks (the body shakes)…
    expect(played.map(p => p[0])).toEqual(['creak', 'clank']); // the starter strains, then the clank of the seize
    expect(played[1][1]).toBe(REACTOR_JAM.STALL_S);
    expect(z.heard).toEqual([REACTOR_GEN.ALERT_PULSE_M]); // noisy, but a short attempt
    expect(r.prompt()).toBe(JAM_TEXT.promptStalling(2));
    expect(r.pressE()).toBe(true); // consumed while it cranks: no second hold
    expect(r.rt.hold).toBeNull();
    r.keys.E = false;
    r.run(REACTOR_JAM.STALL_S + 0.2);
    expect(calls.gen.at(-1)).toEqual([2, 0]); // …then it seizes and stands still
    expect(r.rt.generators()[2]).toMatchObject({phase: 'jammed', jammed: true, stalls: 1, started: false});
    expect(r.prompt()).toBe(JAM_TEXT.promptJammed(2));
    // its zone's fans never turn, the bottom never clears by generator — however long you wait
    r.run(GENERATOR_CLEAR_S * 2);
    expect(calls.fan.get(4) ?? 0).toBe(0);
    expect(calls.fan.get(5) ?? 0).toBe(0);
    expect(r.rt.state!.zoneClear[2]).toBe(0);
    expect(r.rt.air!.stats().zones[2]).toMatchObject({jammed: true, clear: 0});
    // try again: the same honest stall (counted), still not started
    r.goGen(2);
    r.tick(0.05);
    r.holdStart();
    r.run(REACTOR_JAM.STALL_S + 0.2);
    expect(r.rt.counts.stalls).toBe(2);
    expect(r.rt.state!.generators[2].started).toBe(false);
    // the QA start is refused the same way (no back door)
    expect(r.rt.start(2, 'qa')).toBe(false);
    expect(r.rt.state!.generators[2].started).toBe(false);
  });

  it('the working generators are untouched: generator 1 still starts and clears its zone (the jam is only the final one)', () => {
    const r = rig(fixtureLayout());
    r.build();
    r.goGen(1);
    r.tick(0.05);
    r.holdStart();
    expect(r.rt.state!.generators[1].started).toBe(true);
    r.run(GENERATOR_CLEAR_S + 1);
    expect(r.rt.state!.zoneClear[1]).toBe(1);
    expect(r.rt.counts.stalls).toBe(0);
  });

  it('persistent: the jam record (generator, stalls) is saved, a rebuild / revisit shows the same jam, RESTART\'s parts are kept', () => {
    const store = new Map<string, unknown>();
    const r = rig(fixtureLayout(), {store});
    r.build();
    r.goGen(2);
    r.tick(0.05);
    r.holdStart();
    const rec = store.get(REACTOR_LANE) as ReactorRunState;
    expect(rec.jam).toMatchObject({generator: 2, stalls: 1});
    // RESTART writes its parts (read-merge-write): the jam stays as stored
    const cur = JSON.parse(JSON.stringify(rec)) as ReactorRunState;
    cur.fuses = [true, true]; cur.breaker = true;
    store.set(REACTOR_LANE, cur);
    r.teardown();
    const back = store.get(REACTOR_LANE) as ReactorRunState;
    expect(back.jam).toMatchObject({generator: 2, stalls: 1});
    expect(back.breaker).toBe(true);
    // a revisit: jammed at once (no fresh try needed), the stalled prompt, the bottom still gassed
    const q = rig(fixtureLayout(), {store});
    q.build();
    expect(q.rt.state!.jam).toMatchObject({generator: 2, stalls: 1});
    q.goGen(2);
    q.tick(0.05);
    expect(q.prompt()).toBe(JAM_TEXT.promptJammed(2));
    expect(q.rt.state!.zoneClear[2]).toBe(0);
    // only the reactor online clears the bottom
    expect(reactorClearAll(5)).toBe(true);
    q.run(5.5);
    expect(q.rt.state!.zoneClear[2]).toBe(1);
    expect(q.rt.zoneStatus(2)).toEqual({text: 'air clear', tone: 'clear'});
  });
});
