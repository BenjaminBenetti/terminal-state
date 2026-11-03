// Task studio-reactor-surface-ending-20261102 (lane ENDING): THE SURFACE EXIT. User: "speed up gas clear around the reactor by 2x. Also
// when the gas is done clearing around the reactor a new objectives should pop up for the player, in the middle of the screen (stays in
// middle for about 10 seconds then moves to objective area on the left). Telling the player that "external doors open". There should be
// an external sealed door on the top level that now becomes open. This door should lead up a set of stairs, towards a surface area,
// where the player may emerge in to the outside world! This area will be roughly situated around the hole on the roof."
// On REAL generated Reactors (pure: no renderer / DOM):
//  - the core's gas clear after ONLINE runs 20 s (was 40: 2x), progressive, drawn = hurting; the trigger fires only at its completion;
//  - the centre message holds ~10 s, moves to the objective area and IS the objective line there; persistence (no replay on a rebuild /
//    reload), the pause holds it;
//  - the sealed door: closed to bodies / bullets / paths before, open after; the stair walkable from the rim to the surface (a real path);
//  - the surface: one bounded walkable plaza round the opening (railed, kept off), open sky over it, the hole looks / shoots down into
//    the pit, the outdoors above the parapet line, the head house solid; its record fills lane SURFACE's contract; deterministic.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR, PathFinder, SOLID} from '../src/gen/grid';
import {Levels, levelsOf} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {REACTOR_LEVELS} from '../src/gen/reactor/frame';
import {SURFACE, SURFACE_LEVEL, surfaceDoorCells} from '../src/gen/reactor/surface';
import {roofOpeningOf} from '../src/gen/reactor/roofOpening';
import {REACTOR_AIR, ReactorAir} from '../src/world/reactor/air';
import {layoutRect} from '../src/world/reactor/generators';
import {REACTOR_LANE, emptyReactorState, loadReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {WIN} from '../src/world/reactor/restartWin';
import {STARTUP, skyClearAt} from '../src/world/reactor/startupPlan';
import {outdoorGasAt, reactorOutdoorGas} from '../src/world/gaslightRules';
import {ENDING, coreAirCleared, doorOpenAt, endingStage, messageAt} from '../src/world/reactor/endingLogic';
import {ReactorEnding} from '../src/world/reactor/ending';
import {OBJECTIVE_TEXT, objectiveHtml} from '../src/world/reactor/objectiveText';
import {mapMarkers} from '../src/world/reactor/mapBoardPlan';
import {fakeHost, newRun} from './helpers/reactorRestartFixture';
import {buildWorld} from '../src/world/builder';
import {WorldMaterials} from '../src/world/materials';
import {CULL_LAYER} from '../src/world/levelCulling';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);

const SEEDS = [9100, 218558, 637474, 3, 70];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => { let L = cache.get(seed); if (!L) cache.set(seed, (L = LEVELS.reactor.generate('main', {levelSeed: seed}))); return L; };
const EYE = 1.62;

/** A restarted record (the full chain) with the given zone fractions. */
function restartedState(L: StationLayout, zoneClear: number): ReactorRunState {
  const r = L.reactor!;
  return {...emptyReactorState(r.generators.length, r.zones.length), fuses: [true, true], breaker: true, valve: true, pump: true, keyInserted: true, rods: true, restarted: true, restartedAt: 100, zoneClear: r.zones.map(() => zoneClear)};
}

/** The ending runtime on a fake host around a REAL layout (the record path: no AIR / RESTART runtime on this host). */
function endingHost(L: StationLayout, run = newRun()) {
  const h = fakeHost(run);
  const lv = levelsOf(L);
  h.layout = L;
  h.levels = {raycast: (o, d, m) => lv.raycast(o, d, m), levelAt: (x, z, y) => lv.levelAt(x, z, y)};
  const e = new ReactorEnding(h as never).install();
  return {h, e};
}

describe('the core gas clear after ONLINE: 2x faster, progressive, drawn = hurting', () => {
  it('REACTOR_AIR.CLEAR_ALL_S is 20 s (was 40 s) and the win hands exactly that to AIR', () => {
    expect(REACTOR_AIR.CLEAR_ALL_S).toBe(20);
    expect(WIN.airDurationS).toBe(REACTOR_AIR.CLEAR_ALL_S);
  });

  it('seed 9100: the whole pit clears over 20 s from WIN.airAtS, thinning progressively; the trigger is only at its completion', () => {
    const L = level(9100), info = L.reactor!, st = emptyReactorState(info.generators.length, info.zones.length);
    const air = new ReactorAir(info, layoutRect(L), st);
    const core = info.tiers[info.tiers.length - 1], x = info.core.x + info.core.radius + 2, z = info.core.z, y = core.baseY + EYE;
    st.restarted = true; // (the rods are out at t = 0)
    air.clearAll(REACTOR_AIR.CLEAR_ALL_S, WIN.airAtS);
    let prev = Infinity, firstDone = -1;
    for (let t = 0; t <= WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S + 2; t += 0.25) {
      air.update(t);
      const c = air.depthGasAt(x, y, z);
      expect(c, `t ${t}`).toBeLessThanOrEqual(prev + 1e-9); // only ever thins
      expect(c).toBeCloseTo(air.tableAt(y), 9); // the exposure reads the table the march draws
      prev = c;
      const done = coreAirCleared({restarted: true, zoneClear: info.zones.map(q => air.clearOf(q.id))});
      if (done && firstDone < 0) firstDone = t;
      if (t < WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S - 0.5) expect(done, `t ${t}`).toBe(false);
    }
    expect(firstDone).toBeGreaterThanOrEqual(WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S - 0.25);
    expect(firstDone).toBeLessThanOrEqual(WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S + 0.25);
    // half way the core floor's air is still visibly there, at the end it is gone
    const st2 = emptyReactorState(info.generators.length, info.zones.length), air2 = new ReactorAir(info, layoutRect(L), st2);
    air2.clearAll(REACTOR_AIR.CLEAR_ALL_S, 0);
    air2.update(0);
    const c0 = air2.depthGasAt(x, y, z);
    air2.update(REACTOR_AIR.CLEAR_ALL_S / 2);
    const cHalf = air2.depthGasAt(x, y, z);
    expect(cHalf).toBeGreaterThan(c0 * 0.05);
    expect(cHalf).toBeLessThan(c0 * 0.95);
    air2.update(REACTOR_AIR.CLEAR_ALL_S + 0.01);
    expect(air2.depthGasAt(x, y, z)).toBe(0);
  }, 60_000);

  it('the trigger rule: restarted AND every zone fully clear — never at power on / the rod press / a partial clear', () => {
    expect(coreAirCleared({restarted: false, zoneClear: [1, 1, 1]})).toBe(false); // the generators alone never open the doors
    expect(coreAirCleared({restarted: true, zoneClear: [1, 1, 0]})).toBe(false); // the rod press: the core floor still gassed
    expect(coreAirCleared({restarted: true, zoneClear: [1, 1, 0.999]})).toBe(false);
    expect(coreAirCleared({restarted: true, zoneClear: [1, 1, 1]})).toBe(true);
    expect(coreAirCleared({restarted: true, zoneClear: []})).toBe(false);
  });

  it('the surface air is clear (and harmless) by the time the doors open — and on any rebuilt world', () => {
    const L = level(9100), info = L.reactor!, s = info.surface!, rect = layoutRect(L);
    const tOpen = WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S;
    expect(tOpen).toBeGreaterThan(STARTUP.onlineAtS);
    const o = reactorOutdoorGas(info.pit.roofY, rect, skyClearAt(tOpen));
    for (const r of s.walk.slice(0, 40)) {
      const x = (r.x0 + r.x1) / 2, z = (r.z0 + r.z1) / 2;
      expect(outdoorGasAt(o, x, s.y + EYE, z), 'eye on the plaza at the opening').toBe(0);
      expect(outdoorGasAt(o, x, s.y + 0.3, z)).toBe(0);
      expect(outdoorGasAt(reactorOutdoorGas(info.pit.roofY, rect, 1), x, s.y + EYE, z)).toBe(0);
    }
  }, 60_000);
});

describe('the centre message, the objective and persistence', () => {
  it('timing: centre for ~10 s of play, a short move, then docked; the objective line is the message only once docked', () => {
    expect(ENDING.centreS).toBeGreaterThanOrEqual(9);
    expect(ENDING.centreS).toBeLessThanOrEqual(11);
    expect(messageAt(null).phase).toBe('none');
    expect(messageAt(0).phase).toBe('centre');
    expect(messageAt(ENDING.centreS - 0.01).phase).toBe('centre');
    expect(messageAt(ENDING.centreS + ENDING.moveS / 2).phase).toBe('moving');
    expect(messageAt(ENDING.centreS + ENDING.moveS / 2).k).toBeCloseTo(0.5, 6);
    expect(messageAt(ENDING.centreS + ENDING.moveS).phase).toBe('docked');
    const open = {doors: true, openedAt: 1, announced: true, surfaced: false};
    expect(endingStage({...open, doors: false}, 'none')).toBe('sealed');
    expect(endingStage(open, 'centre')).toBe('announcing');
    expect(endingStage(open, 'moving')).toBe('announcing');
    expect(endingStage(open, 'docked')).toBe('doors');
    expect(endingStage(open, 'none')).toBe('doors'); // a rebuilt open world: docked
    expect(endingStage({...open, surfaced: true}, 'docked')).toBe('surfaced');
    expect(OBJECTIVE_TEXT.ending.message.toLowerCase()).toBe('external doors open'); // the user's words
    expect(OBJECTIVE_TEXT.ending.doors.toLowerCase().startsWith('external doors open')).toBe(true); // the docked line IS the message
    // concise: one short line plus the storey (OBJECTIVES' style)
    const html = objectiveHtml({state: restartedState(level(9100), 1), waking: false, tier: OBJECTIVE_TEXT.ending.storey, stage: OBJECTIVE_TEXT.ending.doors});
    expect(html).toBe(`<div>${OBJECTIVE_TEXT.ending.doors}</div><div class="tier">Surface</div>`);
    expect(OBJECTIVE_TEXT.ending.doors.length).toBeLessThan(48);
    expect(doorOpenAt(0)).toBe(0);
    expect(doorOpenAt(ENDING.doorOpenS)).toBe(1);
  });

  for (const seed of [9100, 637474]) {
    it(`seed ${seed}: the runtime — sealed until the core air clears, the event once, the message timeline, no replay on rebuild / reload`, () => {
      const L = level(seed), s = L.reactor!.surface!, g0 = L.grid;
      const {h, e} = endingHost(L);
      // the reactor online, the clearing running (60 %): sealed
      h.run.setLaneStore(REACTOR_LANE, restartedState(L, 0.6));
      for (const k of h.sectionHooks) k.build?.(L);
      const cells = surfaceDoorCells(s, g0);
      expect(cells.length).toBeGreaterThanOrEqual(4);
      expect(e.sealed).toBe(true);
      for (const i of cells) expect(g0.cells[i]).toBe(SOLID);
      expect(e.stageFn()).toBeNull();
      for (let i = 0; i < 40; i++) h.frameHooks.forEach(f => f(0.25));
      expect(e.ending.doors).toBe(false);
      expect(e.messagePhase).toBe('none');
      // almost clear: still sealed; fully clear: the event
      h.run.setLaneStore(REACTOR_LANE, restartedState(L, 0.999));
      for (let i = 0; i < 8; i++) h.frameHooks.forEach(f => f(0.25));
      expect(e.ending.doors).toBe(false);
      h.run.setLaneStore(REACTOR_LANE, {...restartedState(L, 1), ending: loadReactorState(h.run.laneStore(REACTOR_LANE), 3, 3).ending});
      h.frameHooks.forEach(f => f(0.25)); // the 4 Hz record poll
      h.frameHooks.forEach(f => f(0.25));
      expect(e.ending.doors).toBe(true);
      expect(e.counts.opened).toBe(1);
      // persisted at once (open + announced): a rebuild / reload starts open and docked
      const rec = loadReactorState(h.run.laneStore(REACTOR_LANE), L.reactor!.generators.length, L.reactor!.zones.length);
      expect(rec.ending.doors && rec.ending.announced).toBe(true);
      expect(e.messagePhase).toBe('centre');
      expect(e.stageFn()).toBeNull(); // the centre message is up: the old line stays meanwhile
      // the leaves slide: the doorway opens when they are open
      expect(e.sealed).toBe(true);
      let t = 0.25;
      while (t < ENDING.doorOpenS + 0.3) { h.frameHooks.forEach(f => f(0.1)); t += 0.1; }
      expect(e.sealed).toBe(false);
      for (const i of cells) expect(g0.cells[i]).toBe(FLOOR);
      // the pause holds it: no frames, no time (Game.update runs only in play)
      for (const f of h.stateListeners ?? []) (f as (s: string) => void)('paused');
      const held = e.msgT;
      for (const f of h.stateListeners ?? []) (f as (s: string) => void)('playing');
      expect(e.msgT).toBe(held);
      // centre for ~10 s of play, then the move, then the objective line
      while ((e.msgT ?? 0) < ENDING.centreS - 0.2) h.frameHooks.forEach(f => f(0.2));
      expect(e.messagePhase).toBe('centre');
      for (let i = 0; i < 3; i++) h.frameHooks.forEach(f => f(0.2));
      expect(e.messagePhase).toBe('moving');
      for (let i = 0; i < 6; i++) h.frameHooks.forEach(f => f(0.2));
      expect(e.messagePhase).toBe('docked');
      expect(e.stageFn()).toBe(OBJECTIVE_TEXT.ending.doors);
      expect(e.counts.messages).toBe(1);
      // a rebuild (revisit): open, docked, no second message, the doorway open at once
      for (const k of h.sectionHooks) k.teardown?.();
      for (const i of cells) expect(g0.cells[i]).toBe(FLOOR); // the layout keeps its generated grid
      for (const k of h.sectionHooks) k.build?.(L);
      expect(e.sealed).toBe(false);
      expect(e.messagePhase).toBe('none');
      expect(e.stageFn()).toBe(OBJECTIVE_TEXT.ending.doors);
      for (let i = 0; i < 20; i++) h.frameHooks.forEach(f => f(0.25));
      expect(e.counts.messages).toBe(1);
      expect(e.counts.opened).toBe(1);
      for (const k of h.sectionHooks) k.teardown?.();
      // a reload (a new runtime on the same run record): the same
      const {h: h2, e: e2} = endingHost(L, h.run);
      for (const k of h2.sectionHooks) k.build?.(L);
      expect(e2.sealed).toBe(false);
      expect(e2.stageFn()).toBe(OBJECTIVE_TEXT.ending.doors);
      for (let i = 0; i < 8; i++) h2.frameHooks.forEach(f => f(0.25));
      expect(e2.counts.messages + e2.counts.opened).toBe(0);
      // standing on the surface: the last stage (persisted)
      h2.player.x = s.exit.x - Math.sin(s.exit.yaw) * 2; h2.player.z = s.exit.z - Math.cos(s.exit.yaw) * 2; h2.player.y = s.y;
      h2.frameHooks.forEach(f => f(0.25));
      expect(e2.ending.surfaced).toBe(true);
      expect(e2.stageFn()).toBe(OBJECTIVE_TEXT.ending.surfaced);
      expect(loadReactorState(h2.run.laneStore(REACTOR_LANE), 3, 3).ending.surfaced).toBe(true);
      for (const k of h2.sectionHooks) k.teardown?.();
    }, 120_000);
  }

  it('a travel away mid-clear: the doors open on the return (the clearing resumes from its start), the message shows then, once', () => {
    const L = level(9100);
    const {h, e} = endingHost(L);
    h.run.setLaneStore(REACTOR_LANE, restartedState(L, 0.3));
    for (const k of h.sectionHooks) k.build?.(L);
    h.frameHooks.forEach(f => f(0.25));
    for (const k of h.sectionHooks) k.teardown?.(); // the player leaves
    h.run.setLaneStore(REACTOR_LANE, {...restartedState(L, 1), ending: loadReactorState(h.run.laneStore(REACTOR_LANE), 3, 3).ending}); // AIR resumed it on the return
    for (const k of h.sectionHooks) k.build?.(L);
    expect(e.sealed).toBe(true);
    h.frameHooks.forEach(f => f(0.3));
    expect(e.ending.doors).toBe(true);
    expect(e.messagePhase).toBe('centre');
    expect(e.counts.messages).toBe(1);
    for (const k of h.sectionHooks) k.teardown?.();
  }, 60_000);

  it('the sealed door prompt: aimed at it from the gallery; the map shows the exit only once the doors are open', () => {
    const L = level(9100), s = L.reactor!.surface!;
    const {h, e} = endingHost(L);
    h.run.setLaneStore(REACTOR_LANE, restartedState(L, 0.2));
    for (const k of h.sectionHooks) k.build?.(L);
    const d = s.door;
    h.camera.position.set(d.x + d.nx * 2.2, d.y + 1.6, d.z + d.nz * 2.2);
    h.camera.lookAt(d.x, d.y + 1.4, d.z);
    h.camera.updateMatrixWorld(true);
    h.frameHooks.forEach(f => f(0.1));
    expect(e.prompt).toBe(OBJECTIVE_TEXT.ending.sealed);
    h.camera.lookAt(d.x - d.nx * 5 + 30, d.y + 1.4, d.z + 30); // away
    h.camera.updateMatrixWorld(true);
    h.frameHooks.forEach(f => f(0.1));
    expect(e.prompt).toBeNull();
    // (lead QA) while the leaves slide open the doors are open in the record: the prompt never says SEALED then
    e.qaOpen(true);
    h.camera.lookAt(d.x, d.y + 1.4, d.z);
    h.camera.updateMatrixWorld(true);
    h.frameHooks.forEach(f => f(0.05));
    if (e.sealed) expect(e.prompt).toBe(OBJECTIVE_TEXT.ending.opening);
    expect(e.prompt).not.toBe(OBJECTIVE_TEXT.ending.sealed);
    const src = (st: ReactorRunState) => ({info: L.reactor!, state: st, carried: () => 0, pickups: () => [], levelAt: () => 0});
    expect(mapMarkers(src(restartedState(L, 0.5))).some(m => m.kind === 'exit')).toBe(false);
    const ex = mapMarkers(src(restartedState(L, 1))).find(m => m.kind === 'exit')!;
    expect(ex).toBeTruthy();
    expect(ex.level).toBe(0);
    expect(Math.hypot(ex.x - d.x, ex.z - d.z)).toBeLessThan(0.01);
    for (const k of h.sectionHooks) k.teardown?.();
  }, 60_000);
});

describe('the door, the stair and the surface on real generated Reactors', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: the record, the door sealed (bodies / bullets / paths) and open (a real walk rim -> surface), the bounded railed plaza`, () => {
      const L = level(seed), info = L.reactor!, s = info.surface!, g0 = L.grid;
      expect(s).toBeTruthy();
      // the record (lane SURFACE's contract): every field
      expect(s.version).toBe(1);
      expect(s.level).toBe(SURFACE_LEVEL);
      expect(L.levels.length).toBe(REACTOR_LEVELS + 1);
      const LS = L.levels[s.level];
      expect(LS.role).toBe('roof');
      expect(LS.baseY).toBe(s.y);
      expect(s.y).toBeCloseTo(info.pit.roofY + SURFACE.slab, 6);
      expect(s.parapetY).toBeCloseTo(s.y + SURFACE.parapet, 6);
      expect(s.ceil).toBeGreaterThan(s.y + 2.4);
      const o = roofOpeningOf(info)!;
      expect(s.hole).toMatchObject({x: o.x, z: o.z, r: o.r});
      expect(s.hole.parapet.r0).toBeLessThan(o.r); // the railing stands on the curb, never over the deck
      expect(s.hole.parapet.r1).toBeGreaterThan(o.r + CELL * Math.SQRT2); // the apron covers the opening's stepped cell edge
      expect(s.hole.parapet.top).toBeCloseTo(s.y + 1.1, 6);
      expect(s.hole.keepR).toBe(o.r);
      expect(s.walk.length).toBeGreaterThan(5);
      expect(s.edges.length).toBeGreaterThan(4);
      expect(s.stairs.flights.length).toBeGreaterThanOrEqual(6);
      expect(s.head.top).toBeGreaterThan(s.parapetY);
      for (const k of ['lower', 'stair', 'upper', 'plaza'] as const) expect(L.areas[s.areas[k]]).toBeTruthy();
      // a few tens of metres round the hole, centred on it
      const bw = s.bounds.x1 - s.bounds.x0, bd = s.bounds.z1 - s.bounds.z0;
      expect(bw).toBeGreaterThan(45); expect(bw).toBeLessThan(80);
      expect(bd).toBeGreaterThan(45); expect(bd).toBeLessThan(80);
      expect(s.hole.x).toBeGreaterThan(s.bounds.x0 + 15); expect(s.hole.x).toBeLessThan(s.bounds.x1 - 15);
      expect(s.hole.z).toBeGreaterThan(s.bounds.z0 + 15); expect(s.hole.z).toBeLessThan(s.bounds.z1 - 15);
      // the door: on the rim, in a pit wall (never the station's north wall), a flat rim deck in front
      expect(s.door.level).toBe(0);
      expect(s.door.z).toBeGreaterThan(info.pit.bounds.z0 + 2);
      expect(L.areas[s.door.front].role?.startsWith('reactor-')).toBe(true);
      const cells = surfaceDoorCells(s, g0);
      expect(cells.length).toBe(SURFACE.door.w);
      for (const i of cells) expect(g0.cells[i]).toBe(FLOOR);
      const fx = s.door.x + s.door.nx * 1.6, fz = s.door.z + s.door.nz * 1.6;
      // the walk (a real path search: PathFinder over every storey) from the gallery in front of the door to 2 m out of the exit on the plaza
      const ex = s.exit.x - Math.sin(s.exit.yaw) * 2, ez = s.exit.z - Math.cos(s.exit.yaw) * 2;
      const lv = levelsOf(L);
      const path = new PathFinder(lv).find(fx, fz, ex, ez, 0.34, 400_000, {ay: 0, by: s.y});
      expect(path, 'rim -> surface path').not.toBeNull();
      const last = path![path!.length - 1];
      expect(Math.hypot(last[0] - ex, last[1] - ez)).toBeLessThan(1);
      expect(last[3] ?? s.y).toBeCloseTo(s.y, 1);
      expect(path!.some(w => (w[3] ?? 0) > s.y / 2 - 1 && (w[3] ?? 0) < s.y / 2 + 1)).toBe(true); // through the turn landing
      // walkable support all along the route (bodies stand on the flights)
      for (const w of path!) expect(lv.supportAt(w[0], w[1], (w[3] ?? 0) + 0.3, 0.6), `support at ${w}`).toBeTruthy();
      // SEALED: the doorway's cells closed — no path, the body stops, a bullet / sight line stops at the door
      const saved = cells.map(i => g0.cells[i]);
      for (const i of cells) g0.cells[i] = SOLID;
      try {
        const lv2 = new Levels(L.levels, L.levelLinks, L.rails);
        expect(new PathFinder(lv2).find(fx, fz, ex, ez, 0.34, 400_000, {ay: 0, by: s.y})).toBeNull();
        expect(lv2.circleClear(s.door.x, s.door.z, 0.34, 0)).toBe(false);
        const eye = {x: fx, y: 1.5, z: fz}, toIn = {x: -s.door.nx, y: 0, z: -s.door.nz};
        const hit = lv2.raycast(eye, toIn, 20);
        expect(hit.kind).toBe('wall');
        expect(hit.t).toBeLessThan(1.6 + 0.3);
        expect(lv2.lineOfSight(eye, {x: s.door.x - s.door.nx * 3, y: 1.5, z: s.door.z - s.door.nz * 3})).toBe(false);
      } finally { cells.forEach((i, k) => { g0.cells[i] = saved[k]; }); }
      // OPEN: the same shot passes the doorway into the passage
      expect(lv.raycast({x: fx, y: 1.5, z: fz}, {x: -s.door.nx, y: 0, z: -s.door.nz}, 3).t).toBeGreaterThan(2.2);
      // the plaza: bounded (every walkable cell enclosed by deck / the keep-off ring / the passage / closed rock), kept off the hole
      const gS = LS.grid, plaza = s.areas.plaza, upper = s.areas.upper;
      let walk = 0;
      for (let i = 0; i < gS.cells.length; i++) {
        if (gS.cells[i] !== FLOOR || gS.area[i] !== plaza) continue;
        const x = i % gS.w, y = (i - x) / gS.w;
        expect(x > 0 && y > 0 && x < gS.w - 1 && y < gS.h - 1).toBe(true);
        if (gS.blocked[i]) continue;
        walk++;
        const nx = Math.max(x * CELL, Math.min((x + 1) * CELL, s.hole.x)) - s.hole.x, nz = Math.max(y * CELL, Math.min((y + 1) * CELL, s.hole.z)) - s.hole.z;
        expect(Math.hypot(nx, nz)).toBeGreaterThanOrEqual(s.hole.keepR - 1e-6);
        for (const j of [i - 1, i + 1, i - gS.w, i + gS.w]) {
          const ok = gS.cells[j] === SOLID || (gS.cells[j] === FLOOR && (gS.area[j] === plaza || gS.area[j] === upper));
          expect(ok, `plaza cell ${x},${y} -> ${j}`).toBe(true);
        }
      }
      expect(walk * CELL * CELL).toBeGreaterThan(SURFACE.minWalkM2);
      // the opening's edge is railed (its walkable side): no unrailed drop on the surface storey
      expect(lv.unrailedDrops().filter(d => d.level === s.level)).toEqual([]);
      expect(L.rails.filter(r => r.level === s.level && r.hidden).length).toBeGreaterThan(8);
      // at the railing, looking / shooting down the shaft: the rays reach deep into the pit (below the rim everywhere round the ring,
      // the core's vessel / floor from part of it — the deck edge is cell-stepped: 0.34-1.05 m from the railing)
      let belowRim = 0, toCore = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
        let d = s.hole.r;
        while (d < s.hole.r + 3 && !lv.circleClear(s.hole.x + ux * d, s.hole.z + uz * d, 0.34, s.y)) d += 0.05;
        const px = s.hole.x + ux * d, pz = s.hole.z + uz * d, eye = {x: px, y: s.y + EYE, z: pz};
        let deepest = Infinity;
        for (const slope of [0.6, 1, 1.5, 2, 3, 4.5]) {
          const dir = new THREE.Vector3(-ux, -slope, -uz).normalize(), h = lv.raycast(eye, dir, 300);
          if (h.kind === 'none') continue;
          deepest = Math.min(deepest, eye.y + dir.y * h.t);
        }
        if (deepest < info.pit.rimY) belowRim++;
        if (deepest < info.core.y1 + 0.5) toCore++;
      }
      expect(belowRim).toBeGreaterThanOrEqual(14); // (a tower leg's reserved column can stand under the opening's edge)
      expect(toCore).toBeGreaterThanOrEqual(4);
      // the open sky over the plaza; the outdoors above the parapet line; the parapet line (and the head house) solid
      const m = s.walk[Math.floor(s.walk.length / 2)], mx = (m.x0 + m.x1) / 2, mz = (m.z0 + m.z1) / 2;
      expect(lv.raycast({x: mx, y: s.y + EYE, z: mz}, {x: 0, y: 1, z: 0}, 300).kind).toBe('none');
      const e0 = s.edges.find(q => Math.hypot(q.x1 - q.x0, q.z1 - q.z0) > 3)!;
      const ox = (e0.x0 + e0.x1) / 2 - e0.nx * 1.5, oz = (e0.z0 + e0.z1) / 2 - e0.nz * 1.5;
      expect(lv.raycast({x: ox, y: s.y + 0.5, z: oz}, {x: e0.nx, y: 0, z: e0.nz}, 5).kind).toBe('wall');
      expect(lv.raycast({x: ox, y: s.y + 2.5, z: oz}, {x: e0.nx, y: 0, z: e0.nz}, 5).kind).toBe('none');
      const st = s.stairs.top;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const hh = lv.raycast({x: st.x, y: s.y + 2.2, z: st.z}, {x: dx, y: 0, z: dz}, 30);
        if (hh.kind === 'none') continue; // (out of the mouth onto the plaza, then up the open sky)
        expect(['wall', 'ceiling']).toContain(hh.kind); // (a flight's pitched ceiling counts: solid either way)
        expect(hh.t).toBeLessThan(12);
      }
    }, 120_000);
  }

  it('seed 9100, the built world: from the railing the level culler shows the pit down the shaft (the core floor drawn); from the rim the plaza deck stays culled under the slab', () => {
    const L = level(9100), info = L.reactor!, s = info.surface!;
    const w = buildWorld(L as never, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    w.group.updateMatrixWorld(true);
    const core = info.tiers[info.tiers.length - 1].level;
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
    // at the railing (the deck's stepped edge, toward the exit), looking steeply down the shaft at the core
    const ax = s.exit.x - s.hole.x, az = s.exit.z - s.hole.z, L0 = Math.hypot(ax, az), lvs = levelsOf(L);
    let d = s.hole.r;
    while (d < s.hole.r + 3 && !lvs.circleClear(s.hole.x + ax / L0 * d, s.hole.z + az / L0 * d, 0.34, s.y)) d += 0.05;
    cam.position.set(s.hole.x + ax / L0 * d, s.y + EYE, s.hole.z + az / L0 * d);
    cam.lookAt(info.core.x, info.core.y1, info.core.z);
    w.culler.update(cam, true);
    const culled = (m: THREE.Object3D) => ((m.layers.mask >>> 0) === ((1 << CULL_LAYER) >>> 0));
    let coreShown = 0, coreAll = 0;
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.userData.level === core) { coreAll++; if (!culled(o)) coreShown++; } });
    expect(coreAll).toBeGreaterThan(0);
    expect(coreShown, 'core-floor meshes drawn from the railing').toBeGreaterThan(0);
    // from the rim gallery looking up the pit away from the opening: no surface-storey mesh is drawn (they stand over the slab)
    const b = info.pit.bounds;
    cam.position.set(b.x0 + 3, 1.6, b.z0 + 3);
    cam.lookAt(b.x0 + 8, info.pit.roofY, b.z0 + 8);
    w.culler.update(cam, true);
    // (known over-draw: the culler joins the surface to the pit's atrium tiles, so up to a few of the plaza's floor chunks — they face
    // up, invisible from below — are still submitted; nothing else of the surface storey)
    const shown: string[] = [];
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.userData.level === s.level && !culled(o)) shown.push(o.name); });
    expect(shown.length, shown.join(', ')).toBeLessThanOrEqual(6);
    expect(shown.every(n => /floor/.test(n)), shown.join(', ')).toBe(true);
  }, 180_000);

  it('deterministic: the same seed gives the same surface exit', () => {
    const a = LEVELS.reactor.generate('main', {levelSeed: SEEDS[1]}), b = level(SEEDS[1]);
    expect(JSON.stringify(a.reactor!.surface)).toBe(JSON.stringify(b.reactor!.surface));
    expect([...a.levels[SURFACE_LEVEL].grid.cells]).toEqual([...b.levels[SURFACE_LEVEL].grid.cells]);
  }, 120_000);

  it('varies across seeds (the wall, the door spot, the plaza outline)', () => {
    const walls = new Set<string>(), doors = new Set<string>(), shapes = new Set<string>();
    for (const seed of SEEDS) {
      const s = level(seed).reactor!.surface!, p = level(seed).reactor!.pit.bounds;
      walls.add(`${Math.sign(Math.round(s.door.nx))},${Math.sign(Math.round(s.door.nz))}`);
      doors.add(`${(s.door.x - p.x0).toFixed(1)},${(s.door.z - p.z0).toFixed(1)}`);
      shapes.add(`${s.walk.length}:${s.edges.length}`);
    }
    expect(walls.size).toBeGreaterThanOrEqual(2);
    expect(doors.size).toBe(SEEDS.length);
    expect(shapes.size).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
