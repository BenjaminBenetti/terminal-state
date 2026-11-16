// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): ON FOOT IN A VERSION-2 DISTRICT'S OUTER FOG. User: "On foot in
// excessive pressure, gas protection must not fully negate damage; show 'Gas pressure too high'. Make the barrier work for pedestrians /
// protective gear too, while preserving normal gas / mask / filter / airtank rules elsewhere. Don't just make the old wall invisible or
// allow a protected walk to the map edge." With the REAL gas system (world/gas/system.ts) reading the REAL outdoor air of GEN's REAL
// districts (world/surface/airMask.ts over surface.boundary):
//  - the pure rules (world/surface/fogAir.ts): the pressure damage, the concentration, the bank over every walkable height;
//  - protected below FOG_PRESSURE.foot: no damage (FILTERING); past it: damage THROUGH the mask, TOXIC GAS + "Gas pressure too high";
//  - a protected walk at the fastest pace the game allows dies past pressure 1 and well before the edge, on every side;
//  - sheltered (the sealed cab), indoors: no pressure; a v1 district, a world without the pressure source: the normal rules exactly;
//  - the pressure SOUND (world/surface/fogRuntime.ts): bounded loops, the state / lifecycle rules, the QA hooks.
import {describe, expect, it, vi} from 'vitest';
import {generateSurfaceDistrict} from '../src/gen/surface/index';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL} from '../src/gen/grid';
import {GAS} from '../src/world/gas/field';
import {installGas, type GasHost, type GasSystem, type OutdoorAirSource} from '../src/world/gas/system';
import {GAS_PRESSURE_HINT} from '../src/ui/gasHud';
import {FOG_PRESSURE, fogPressureAt} from '../src/world/surface/fogPressure';
import {FOG_AIR, fogBank, fogConcentration, fogDensity, fogPressureDps, fogPressureHigh, fogThicken} from '../src/world/surface/fogAir';
import {SURFACE_AIR, columnTop, outdoorWeight, surfaceAirPressureAt, surfaceOutdoorGasAt, surfaceOutdoorMap, surfacePressureAt, type CabVolume} from '../src/world/surface/airMask';
import {FOG_AUDIO, SurfaceFogRuntime, installSurfaceFog, surfaceFogQaApi, surfaceFogRuntime, type SurfaceFogHost} from '../src/world/surface/fogRuntime';
import {SPRINT_SPEED, STAMINA_CAPACITY, STAMINA_SPRINT_DRAIN, WALK_SPEED} from '../src/player/player';
import {GEAR_ITEMS, GEAR_SLOTS} from '../src/items/gear';
import {BEER_TUNING} from '../src/items/beers';

const cache = new Map<string, StationLayout>();
const district = (seed: number, v: 1 | 2 = 2): StationLayout => {
  const k = `${seed}:${v}`;
  let L = cache.get(k);
  if (!L) cache.set(k, (L = generateSurfaceDistrict((['subway', 'office', 'mall'] as const)[seed % 3], {levelSeed: seed, surfaceVersion: v})));
  return L;
};
const dpsAt = (c: number) => GAS.DPS_MAX * Math.min(1, Math.max(0, (c - GAS.THRESHOLD) / (1 - GAS.THRESHOLD)));

/** A Game-shaped host around the REAL gas system, its outdoor air the district's own (as world/surface/air.ts wires it, cab aside). */
function gasWorld(L: StationLayout, source: 'district' | 'field' | 'no-pressure' = 'district') {
  const m = surfaceOutdoorMap(L)!;
  const player = {x: 0, z: 0, y: 0, eye: 1.6, alive: true, hp: 100,
    takeDamage(a: number) { if (!this.alive) return; this.hp = Math.max(0, this.hp - a); if (this.hp <= 0) this.alive = false; }};
  const h = {
    player, layout: L, tower: {office: null}, atmosphere: {active: true, setGasLayer: vi.fn(), setGasFallback: vi.fn()},
    run: {laneStore: () => undefined, setLaneStore: vi.fn()}, clock: 0, state: 'playing',
    frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], stateListeners: [] as ((s: never, p: never) => void)[],
  };
  const sys: GasSystem = installGas(h as unknown as GasHost);
  const B = L.surface!.boundary ?? null;
  const air: OutdoorAirSource = {
    gasAt: (x, y, z) => surfaceOutdoorGasAt(m, x, y, z),
    // 'field': open ground all the way (the worst case: no building column ever keeps the pressure off)
    ...(source === 'no-pressure' ? {} : {
      pressureAt: source === 'field' ? (x: number, y: number, z: number) => fogPressureAt(B, x, z) * fogBank(y) : (x: number, y: number, z: number) => surfacePressureAt(m, x, y, z),
      pressureDps: fogPressureDps,
    }),
  };
  sys.outdoorAir = air;
  const at = (x: number, z: number, eye = 1.6, dt = 0) => { Object.assign(player, {x, z, y: eye - 1.6, eye}); sys.frame(dt); return sys.exposure; };
  return {h, sys, m, player, at, B};
}

/** An open outdoor street-level spot at field pressure ~p north of the clear rect (the runtime's own pose finder). */
function spotAt(L: StationLayout, p: number, side: 'N' | 'S' | 'W' | 'E' = 'N') {
  const rt = new SurfaceFogRuntime({layout: L, player: {x: 0, y: 0, z: 0, eye: 1.6, alive: true}, gas: {exposure: {c: 0, dps: 0, protected: false}},
    frameHooks: [], sectionHooks: []} as SurfaceFogHost);
  rt.build(L);
  const q = rt.poseAt(p, side);
  expect(q, `a spot at p ${p} ${side}`).not.toBe(null);
  return q!;
}

describe('surface fog pressure: the pure rules (world/surface/fogAir.ts)', () => {
  it('pressure damage: 0 up to FOG_PRESSURE.foot, continuous, FOG_AIR.dps at 1, rising beyond, capped', () => {
    expect(fogPressureDps(0)).toBe(0);
    expect(fogPressureDps(FOG_PRESSURE.foot)).toBe(0);
    expect(fogPressureDps(FOG_PRESSURE.foot + 1e-6)).toBeLessThan(1e-6);
    expect(fogPressureDps(1)).toBeCloseTo(FOG_AIR.dps, 9);
    expect(fogPressureDps(1 + 1e-9)).toBeCloseTo(FOG_AIR.dps, 6);
    let prev = 0;
    for (let p = FOG_PRESSURE.foot; p <= 3; p += 0.01) { const d = fogPressureDps(p); expect(d).toBeGreaterThanOrEqual(prev); prev = d; }
    expect(fogPressureDps(10)).toBe(FOG_AIR.dpsMax);
    expect(fogPressureDps(NaN)).toBe(0);
    expect(fogPressureHigh(FOG_PRESSURE.foot)).toBe(false);
    expect(fogPressureHigh(FOG_PRESSURE.foot + 0.01)).toBe(true);
    // well past what the unprotected gas does at its worst: the mask cannot hold it
    expect(fogPressureDps(1)).toBeGreaterThan(GAS.DPS_MAX);
  });

  it('the air thickens with the pressure: C .. 1 at pressure 1 (never above), the look by fogThicken; the bank covers every walkable height', () => {
    const C = SURFACE_AIR.C;
    expect(fogConcentration(C, 0, 1.6)).toBe(C);
    expect(fogConcentration(C, 0.5, 1.6)).toBeCloseTo(C + (1 - C) * 0.5, 9);
    expect(fogConcentration(C, 1, 1.6)).toBeCloseTo(1, 9);
    expect(fogConcentration(C, 3, 1.6)).toBeCloseTo(1, 9);
    expect(fogConcentration(0, 1, 1.6)).toBe(0);
    expect(fogThicken(0, 1.6)).toBe(1);
    expect(fogDensity(C, 0, 1.6)).toBe(1);
    let prev = 1;
    for (let p = 0.05; p <= FOG_AIR.cap; p += 0.05) { const d = fogDensity(C, p, 1.6); expect(d).toBeGreaterThan(prev); prev = d; }
    expect(fogThicken(5, 1.6)).toBe(fogThicken(FOG_AIR.cap, 1.6));
    // the bank: full at every walkable height (every storey of real districts, any reachable roof, an eye over it), gone high over the
    // street (never a green sky dome); the outer ring's shells (out in the pressure) stand wholly inside it
    let top = 0, outerTop = 0;
    for (const seed of [1, 2, 3]) {
      const L = district(seed), S = L.surface!;
      for (const lv of L.levels) top = Math.max(top, lv.baseY);
      for (const b of S.buildings) {
        if (b.roofAccess) top = Math.max(top, b.roofAccess.y);
        const f = b.footprint;
        if (fogPressureAt(S.boundary, (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2) > 0) outerTop = Math.max(outerTop, b.roofY ?? b.height);
      }
    }
    expect(top + 2).toBeLessThan(FOG_AIR.bank.y0);
    expect(outerTop).toBeGreaterThan(0);
    expect(outerTop).toBeLessThan(FOG_AIR.bank.y0);
    expect(fogBank(top + 2)).toBe(1);
    expect(fogBank(FOG_AIR.bank.y1)).toBe(0);
    expect(fogConcentration(C, 1, FOG_AIR.bank.y1 + 10)).toBe(C);
  }, 120_000);
});

describe('surface fog pressure: the gas system on foot (a real v2 district)', () => {
  it('protected below foot: no damage, FILTERING; past foot: damage THROUGH the mask, TOXIC GAS + "Gas pressure too high"', () => {
    const L = district(1), g = gasWorld(L);
    g.sys.protection = () => true;
    for (const p of [0, 0.2, 0.33]) {
      const s = spotAt(L, p), e = g.at(s.x, s.z, 1.6, 0.1);
      expect(e.pressure).toBeCloseTo(s.p, 9);
      expect(e.c).toBeCloseTo(fogConcentration(SURFACE_AIR.C, s.p, 1.6), 9);
      expect(e.protected).toBe(true);
      expect(e.dps, `p ${s.p}`).toBe(0);
      expect(e.pressureDps).toBe(0);
      expect(g.sys.hud.shown.tag).toBe('FILTERING');
      expect(g.sys.hud.shown.hint).not.toBe(GAS_PRESSURE_HINT);
    }
    const hp0 = g.player.hp;
    for (const p of [0.4, 0.7, 1, 1.3]) {
      const s = spotAt(L, p), e = g.at(s.x, s.z, 1.6, 0.1);
      expect(e.pressure).toBeCloseTo(s.p, 9);
      expect(e.protected).toBe(true); // the mask still works on the gas itself …
      expect(e.pressureDps, `p ${s.p}`).toBeCloseTo(fogPressureDps(s.p), 9);
      expect(e.dps).toBeCloseTo(e.pressureDps!, 9); // … but not on the pressure
      expect(e.dps).toBeGreaterThan(0);
      expect(g.sys.hud.shown.tag).toBe('TOXIC GAS');
      expect(g.sys.hud.shown.hint).toBe(GAS_PRESSURE_HINT);
      expect(g.sys.hud.shown.vignette).toBeGreaterThan(0);
    }
    expect(g.player.hp).toBeLessThan(hp0);
    // unprotected out there: the thicker gas's own damage + the pressure's
    g.sys.protection = () => false;
    const s = spotAt(L, 0.7), e = g.at(s.x, s.z, 1.6, 0.1);
    expect(e.dps).toBeCloseTo(dpsAt(e.c) + fogPressureDps(s.p), 9);
    expect(dpsAt(e.c)).toBeGreaterThan(dpsAt(SURFACE_AIR.C));
    expect(g.sys.hud.shown.hint).toBe(GAS_PRESSURE_HINT);
  }, 120_000);

  it('a protected walk at the fastest pace dies past pressure 1 and well before the edge, on every side', () => {
    // the fastest the game allows: a full sprint reserve, work boots and the speed lager, then walking at the same bonuses
    // (every gear piece's speed bonus, the best per slot: any future speed gear counts too)
    const gearBonus = GEAR_SLOTS.reduce((k, slot) => k * Math.max(1, ...Object.values(GEAR_ITEMS).map(d => (d.gear?.slot === slot ? d.gear.speedMult ?? 1 : 1))), 1);
    const bonus = gearBonus * BEER_TUNING.speedMult, sprintS = STAMINA_CAPACITY / STAMINA_SPRINT_DRAIN;
    expect(bonus).toBeGreaterThan(1);
    for (const seed of [1, 2, 3]) {
      const L = district(seed), B = L.surface!.boundary!, c = B.clear, e = B.edge;
      for (const side of ['N', 'S', 'W', 'E'] as const) {
        const g = gasWorld(L, 'field');
        g.sys.protection = () => true;
        const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
        let x = side === 'W' ? c.x0 : side === 'E' ? c.x1 : mx, z = side === 'N' ? c.z0 : side === 'S' ? c.z1 : mz;
        const dx = side === 'W' ? -1 : side === 'E' ? 1 : 0, dz = side === 'N' ? -1 : side === 'S' ? 1 : 0;
        const toEdge = () => (side === 'W' ? x - e.x0 : side === 'E' ? e.x1 - x : side === 'N' ? z - e.z0 : e.z1 - z);
        const dt = 1 / 30;
        let t = 0;
        while (g.player.alive && toEdge() > 0) {
          const v = (t < sprintS ? SPRINT_SPEED : WALK_SPEED) * bonus;
          x += dx * v * dt; z += dz * v * dt; t += dt;
          g.at(x, z, 1.6, dt);
        }
        const tag = `seed ${seed} side ${side}: died ${toEdge().toFixed(1)} m before the edge at p ${fogPressureAt(B, x, z).toFixed(2)} after ${t.toFixed(1)} s`;
        expect(g.player.alive, tag).toBe(false);
        expect(fogPressureAt(B, x, z), tag).toBeGreaterThan(FOG_PRESSURE.full);
        expect(toEdge(), tag).toBeGreaterThan(10);
      }
    }
  }, 120_000);

  it('standing protected just short of foot pressure for a minute: unharmed (the barrier is the pressure, not the mask rules)', () => {
    const L = district(2), g = gasWorld(L), s = spotAt(L, 0.3, 'E');
    g.sys.protection = () => true;
    for (let k = 0; k < 600; k++) g.at(s.x, s.z, 1.6, 0.1);
    expect(g.player.hp).toBe(100);
  }, 120_000);

  it('sheltered (the sealed cab) / inside a building column: no pressure; the cab volume cuts it like the gas', () => {
    const L = district(1), g = gasWorld(L), s = spotAt(L, 1.2);
    g.sys.protection = () => true;
    g.sys.shelter = () => true;
    const e = g.at(s.x, s.z, 1.6, 0.5);
    expect([e.c, e.pressure, e.pressureDps, e.dps]).toEqual([0, 0, 0, 0]);
    expect(g.player.hp).toBe(100);
    g.sys.shelter = () => false;
    // the cab volume (world/surface/airMask.ts): 0 inside it, the full pressure just outside
    const cab: CabVolume = {x: s.x, y: 1.4, z: s.z, yaw: 0, pitch: 0, hx: 1, hy: 1, hz: 1.5};
    expect(surfaceAirPressureAt(g.m, cab, s.x, 1.6, s.z)).toBe(0);
    expect(surfaceAirPressureAt(g.m, cab, s.x + 3, 1.6, s.z)).toBeCloseTo(surfacePressureAt(g.m, s.x + 3, 1.6, s.z), 12);
    expect(surfacePressureAt(g.m, s.x + 3, 1.6, s.z)).toBeGreaterThan(1);
    // a building column out in the ramp (an outer-ring shell): its own column keeps the pressure out below its top, like the gas
    const B = L.surface!.boundary!;
    const shell = L.surface!.buildings.find(b => fogPressureAt(B, (b.footprint.x0 + b.footprint.x1) / 2, (b.footprint.z0 + b.footprint.z1) / 2) > 0.5)!;
    expect(shell).toBeTruthy();
    const bx = (shell.footprint.x0 + shell.footprint.x1) / 2, bz = (shell.footprint.z0 + shell.footprint.z1) / 2, top = columnTop(g.m, bx, bz);
    expect(top).toBeGreaterThan(2);
    expect(surfacePressureAt(g.m, bx, 1.6, bz)).toBe(0);
    expect(surfacePressureAt(g.m, bx, top + 1, bz)).toBeCloseTo(fogPressureAt(B, bx, bz) * outdoorWeight(g.m, bx, top + 1, bz), 12);
  }, 120_000);
});

describe('surface fog pressure: the normal rules elsewhere, exactly', () => {
  it('a v1 district: no boundary, no pressure anywhere (out to its cordon); protected = no damage; the outdoor air C x weight as before', () => {
    const L = district(1, 1), g = gasWorld(L);
    expect(g.m.boundary).toBe(null);
    expect(g.B).toBe(null);
    g.sys.protection = () => true;
    const E = L.surface!.extent;
    for (const [x, z] of [[E.x0 + 2, (E.z0 + E.z1) / 2], [(E.x0 + E.x1) / 2, E.z1 - 2], [E.x1 - 2, E.z0 + 2]]) {
      expect(surfacePressureAt(g.m, x, 1.6, z)).toBe(0);
      expect(surfaceOutdoorGasAt(g.m, x, 1.6, z)).toBe(SURFACE_AIR.C * outdoorWeight(g.m, x, 1.6, z));
      const e = g.at(x, z, 1.6, 0.5);
      expect(e.pressure).toBe(0);
      expect(e.dps).toBe(0);
      expect(g.sys.hud.shown.hint).not.toBe(GAS_PRESSURE_HINT);
    }
    expect(g.player.hp).toBe(100);
    g.sys.protection = () => false;
    const e = g.at(E.x0 + 2, (E.z0 + E.z1) / 2, 1.6, 0);
    if (e.c > 0) expect(e.dps).toBeCloseTo(dpsAt(e.c), 12);
  }, 120_000);

  it('an outdoor source without the pressure term (every other world shape): the exposure exactly the old formula', () => {
    const L = district(1), g = gasWorld(L, 'no-pressure'), s = spotAt(L, 1.3);
    const e = g.at(s.x, s.z, 1.6, 0);
    expect(e.pressure).toBe(0);
    expect(e.pressureDps).toBe(0);
    expect(e.dps).toBeCloseTo(dpsAt(e.c), 12);
    g.sys.protection = () => true;
    expect(g.at(s.x, s.z, 1.6, 0).dps).toBe(0);
    expect(g.sys.hud.shown.tag).toBe('FILTERING');
  }, 120_000);
});

describe('surface fog pressure: the sound and the QA hooks (world/surface/fogRuntime.ts)', () => {
  type Loop = {cue: string; level: number; rate: number; lowpass: number; playing: boolean; stops: number};
  const fakeSfx = () => {
    const loops: Loop[] = [];
    return {loops, rideLoop(cue: 'bedRumble' | 'bedWind') {
      const l: Loop = {cue, level: 0, rate: 1, lowpass: 0, playing: true, stops: 0};
      loops.push(l);
      return {setLevel: (k: number) => { l.level = k; }, setRate: (r: number) => { l.rate = r; }, setLowpass: (hz: number) => { l.lowpass = hz; },
        stop: () => { l.playing = false; l.stops++; }, get playing() { return l.playing; }};
    }};
  };
  const host = (L: StationLayout) => {
    const sfx = fakeSfx();
    const h = {layout: L, player: {x: 0, y: 0, z: 0, eye: 1.6, alive: true}, gas: {exposure: {c: 0.6, dps: 0, protected: true, pressure: 0, pressureDps: 0}}, sfx, state: 'playing',
      frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], stateListeners: [] as ((s: never, p: never) => void)[]};
    const rt = installSurfaceFog(h as unknown as SurfaceFogHost);
    const frame = (dt: number) => { for (const f of h.frameHooks) f(dt); };
    return {h, sfx, rt, frame};
  };

  it('two bounded loops from the warn pressure, following it; silenced off play; released below warn, on death, at teardown and the next build', () => {
    const L = district(1), {h, sfx, rt, frame} = host(L);
    for (const s of h.sectionHooks) s.build?.(L);
    expect(rt.boundary).toEqual(L.surface!.boundary);
    frame(0.1);
    expect(sfx.loops.length).toBe(0);
    h.gas.exposure.pressure = FOG_PRESSURE.warn + 0.01;
    frame(0.1);
    expect(sfx.loops.map(l => l.cue).sort()).toEqual(['bedRumble', 'bedWind']);
    const low = sfx.loops.find(l => l.cue === 'bedRumble')!.level;
    h.gas.exposure.pressure = 1;
    for (let k = 0; k < 50; k++) frame(0.1);
    expect(sfx.loops.length).toBe(2); // never more than these two
    const r = sfx.loops.find(l => l.cue === 'bedRumble')!, w = sfx.loops.find(l => l.cue === 'bedWind')!;
    expect(r.level).toBeGreaterThan(low);
    expect(r.level).toBeLessThanOrEqual(FOG_AUDIO.rumble.level[1]);
    expect(w.level).toBeGreaterThan(0);
    expect(rt.summary()).toMatchObject({v2: true, audio: {playing: true}});
    // a menu / the map: quiet (the loops stay, the next play frame mixes again)
    for (const l of h.stateListeners as unknown as ((s: string, p: string) => void)[]) l('paused', 'playing');
    expect([r.level, w.level]).toEqual([0, 0]);
    frame(0.1);
    expect(r.level).toBeGreaterThan(0);
    // below warn: mixed out, released after idleS
    h.gas.exposure.pressure = 0;
    frame(0.1);
    expect(r.playing).toBe(true);
    for (let t = 0; t < FOG_AUDIO.idleS + 0.2; t += 0.1) frame(0.1);
    expect([r.playing, w.playing]).toEqual([false, false]);
    // back out: two NEW loops; death releases them
    h.gas.exposure.pressure = 0.5;
    frame(0.1);
    expect(sfx.loops.length).toBe(4);
    h.player.alive = false;
    frame(0.1);
    expect(sfx.loops.every(l => !l.playing)).toBe(true);
    h.player.alive = true;
    frame(0.1);
    expect(sfx.loops.length).toBe(6);
    for (const s of h.sectionHooks) s.teardown?.();
    expect(sfx.loops.every(l => !l.playing)).toBe(true);
    expect(rt.boundary).toBe(null);
    frame(0.1);
    expect(sfx.loops.length).toBe(6); // inert between worlds
    expect(rt.counts).toMatchObject({builds: 1, teardowns: 1, starts: 3, stops: 3});
  }, 120_000);

  it('inert in a v1 district (and without sound): never starts', () => {
    const L = district(1, 1), {h, sfx, rt, frame} = host(L);
    for (const s of h.sectionHooks) s.build?.(L);
    h.gas.exposure.pressure = 2;
    for (let k = 0; k < 10; k++) frame(0.1);
    expect(rt.boundary).toBe(null);
    expect(sfx.loops.length).toBe(0);
    expect(rt.summary()).toEqual({v2: false});
    const q = host(district(1)), quiet = q.h as {sfx?: unknown};
    delete quiet.sfx;
    for (const s of q.h.sectionHooks) s.build?.(district(1));
    q.h.gas.exposure.pressure = 1;
    q.frame(0.1);
    expect(q.rt.playing).toBe(false);
  }, 120_000);

  it('QA: surfaceFog() reports the boundary / the eye\'s pressure; surfaceFogPose(p) stands on open outdoor ground at that pressure looking out', () => {
    const L = district(2), {h} = host(L);
    for (const s of h.sectionHooks) s.build?.(L);
    expect(surfaceFogRuntime()).not.toBe(null);
    const tp = vi.fn(() => true), api = surfaceFogQaApi(tp);
    const B = L.surface!.boundary!, m = surfaceOutdoorMap(L)!;
    for (const [p, side, yaw] of [[0.5, 'N', 0], [1, 'S', Math.PI], [0.8, 'W', Math.PI / 2], [1.2, 'E', -Math.PI / 2]] as const) {
      const q = api.surfaceFogPose(p, side)!;
      expect(q).not.toBe(null);
      expect(q.yaw).toBe(yaw);
      expect(Math.abs(q.p - p), `${side} ${p}`).toBeLessThan(0.02);
      expect(tp).toHaveBeenLastCalledWith(q.x, q.z, q.yaw, 0);
      expect(columnTop(m, q.x, q.z)).toBe(0);
      expect(api.surfaceFogAt(q.x, q.z)).toBeCloseTo(fogPressureAt(B, q.x, q.z), 12);
      expect(Math.floor(q.x / CELL) * CELL).toBeLessThan(q.x);
    }
    Object.assign(h.gas.exposure, {pressure: 0.9, pressureDps: fogPressureDps(0.9), dps: fogPressureDps(0.9)});
    expect(api.surfaceFog()).toMatchObject({v2: true, boundary: B, pressureAtEye: 0.9, high: true, levels: FOG_PRESSURE});
  }, 120_000);
});
