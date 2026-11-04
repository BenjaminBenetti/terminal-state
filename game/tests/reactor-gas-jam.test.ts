// Task reactor-playtest-round2-20261102 (lane GAS, user bullet 8 — a DESIGN CHANGE that supersedes "the mask is optional all the way
// down"): "the final generator to clear the fog out of the bottom level should jam … you must wear a gas mask down there. Once the
// reactor comes on line then the fog at the bottom will clear out." On REAL generated layouts:
//  - the rule (gen/reactor/gasJam.ts): the deepest zone's generator (the waste repository's, tier 4) jams; the upper ones work;
//  - the air: a started flag can never clear the jammed zone; only the reactor ONLINE (clearAll) does, never a fuse / breaker / valve /
//    pump / key (the restart runtime calls the clearing only after the rods);
//  - the gear path: the guaranteed mask + filters lie UPSTREAM of the jammed zone, in air the working generators clear (no gear lock),
//    and their filter time covers the real core-floor travel + work (paths on the core floor's grid) with margin;
//  - every surface agrees: the pit board, the switchgear board, the next step, the floor maps (marker + banner).
// (The generator's stall / prompt / toast / persistence state machine: tests/reactor-air-runtime.test.ts.)
// Task reactor-surface-ending-20261102 (lane OBJECTIVES, user INTENT CHANGES): "the objective text is to wordy, saying "core floor
// generator is jammed" … The player will know its jammed when they try to start it" — the HUD objective no longer carries the jam /
// mask paragraph (asserted ABSENT below; the board marks stay, terse); "the key for reactor start should be on the bottom floor" — the
// budgeted core route now fetches the key on the core floor (stairs -> valve -> pump -> key -> key switch -> rods).
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {rollLevelGear} from '../src/levels/gearAdapter';
import {GAS} from '../src/world/gas/field';
import {FILTER_LIFE_S} from '../src/items/gear';
import {WALK_SPEED} from '../src/player/player';
import {REACTOR_AIR, ReactorAir} from '../src/world/reactor/air';
import {layoutRect} from '../src/world/reactor/generators';
import {REACTOR_LANE, emptyReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {HOLD_S, nextStepText} from '../src/world/reactor/restartLogic';
import {WIN} from '../src/world/reactor/restartWin';
import {drawReactorScreen, screenPixels, type ScreenModel} from '../src/world/reactor/restartScreens';
import {MAP_PX, mapMarkers, markerOpen, planStoreys, storeyWarning} from '../src/world/reactor/mapBoardPlan';
import {drawMapFace} from '../src/world/reactor/mapBoardDraw';
import {JAM_TEXT, reactorJam} from '../src/gen/reactor/gasJam';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {buildRestart, fakeHost} from './helpers/reactorRestartFixture';
import {installCanvasShim} from './helpers/canvas2d';
import type {StationLayout} from '../src/gen/stationTypes';
import type {ReactorInfo} from '../src/gen/reactor/reactorTypes';

const SEEDS = [9100, 218558, 637474];
const SUPPLY_SEEDS = [9100, 218558, 637474, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const EYE = 1.6;
const cache = new Map<number, StationLayout>();
/** The level as the game generates it: with the run's gear roll (masks / filters included). */
const level = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = LEVELS.reactor.generate('main', {levelSeed: seed, gear: rollLevelGear(seed, 'reactor', ['main']).main}); cache.set(seed, L); }
  return L;
};
const out: string[] = [];
const report = () => { if (process.env.LL_GAS_OUT) writeFileSync(process.env.LL_GAS_OUT, out.join('\n') + '\n', {flag: 'a'}); };
/** The air with every zone ABOVE the jammed one cleared (the working generators' route) at game clock 0. */
const upperCleared = (L: StationLayout, r: ReactorInfo) => {
  const st = emptyReactorState(r.generators.length, r.zones.length), jam = reactorJam(r)!;
  for (const z of r.zones) if (z.id !== jam.zone) st.zoneClear[z.id] = 1;
  const air = new ReactorAir(r, layoutRect(L), st);
  air.update(0, true);
  return {st, air, jam};
};

describe('reactor gas: the final generator jams — the rule and the air (lane GAS)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: the deepest zone's generator (waste repository, tier 4) jams, the upper two work; only the reactor online clears the bottom`, () => {
      const L = level(seed), r = L.reactor!, jam = reactorJam(r)!;
      const core = r.tiers[r.tiers.length - 1];
      expect(jam).not.toBeNull();
      expect(jam.zone).toBe(core.zone);
      expect(jam.levels).toEqual([core.level]);
      expect(r.complexes!.find(c => c.id === 'waste')!.generator).toBe(jam.generator);
      expect(r.generators.filter(g => g.id !== jam.generator).length).toBe(2);
      const {st, air} = upperCleared(L, r);
      expect(air.jammedZone).toBe(jam.zone);
      // the jammed generator's use point is breathable (you can reach it and try it), the core floor is deadly
      const g = r.generators.find(q => q.id === jam.generator)!;
      expect(air.depthGasAt(g.use.x, L.levels[g.use.level].baseY + EYE, g.use.z)).toBeLessThan(GAS.THRESHOLD);
      const coreEye = () => air.depthGasAt(r.core.x + r.core.radius + 3, core.baseY + EYE, r.core.z);
      expect(coreEye()).toBeGreaterThan(0.5);
      // a started flag (a stale / forged record) never clears the jammed zone, however long
      st.generators[jam.generator] = {started: true, startedAt: 0};
      air.update(10_000);
      expect(air.clearOf(jam.zone)).toBe(0);
      expect(coreEye()).toBeGreaterThan(0.5);
      // the reactor online (the win's clearAll): the bottom clears
      air.clearAll(REACTOR_AIR.CLEAR_ALL_S, 10_000);
      air.update(10_000 + REACTOR_AIR.CLEAR_ALL_S + 0.1);
      expect(air.clearOf(jam.zone)).toBe(1);
      expect(coreEye()).toBeLessThan(GAS.HUD_MIN);
    }, 60_000);
  }
});

describe('reactor gas: the required mask + filters lie upstream with enough filter time (lane GAS)', () => {
  it('every seed: the one mask and every filter lie on storeys above the jammed zone, in air the working generators clear (no gear lock)', () => {
    for (const seed of SUPPLY_SEEDS) {
      const L = level(seed), r = L.reactor!, {air, jam} = upperCleared(L, r);
      const finds = L.pickups.filter(p => p.itemId === 'gas_mask' || p.itemId === 'gas_filter');
      const masks = finds.filter(p => p.itemId === 'gas_mask'), filters = finds.filter(p => p.itemId === 'gas_filter');
      expect(masks.length, `seed ${seed} masks`).toBe(MASK_LOOT.levels.reactor.masks[0]);
      expect(filters.length, `seed ${seed} filters`).toBeGreaterThanOrEqual(MASK_LOOT.levels.reactor.filters[0]);
      for (const p of finds) {
        const lv = p.level ?? 0;
        expect(jam.levels.includes(lv), `seed ${seed} ${p.itemId} on storey ${lv}`).toBe(false);
        expect(air.depthGasAt(p.x, p.y + EYE, p.z), `seed ${seed} ${p.itemId} air`).toBeLessThan(GAS.THRESHOLD);
      }
    }
  }, 240_000);

  for (const seed of SEEDS) {
    it(`seed ${seed}: the guaranteed upstream filter time (unchanged counts, 37.5 s filters) measured against the real core-floor route (stairs -> valve -> pump -> key -> key switch -> rods -> online)`, () => {
      const L = level(seed), r = L.reactor!, {st, air, jam} = upperCleared(L, r);
      const coreLv = jam.levels[0], g = L.levels[coreLv].grid;
      const stand = (id: string) => { for (const s of r.sites) { const c = s.controls.find(q => q.id === id); if (c) return c.stand; } throw new Error(id); };
      const cellOf = (x: number, z: number) => g.cellOf(x, z);
      /** Walking metres on the core floor's grid: 4-connected cell steps (CELL 0.5 m), an overestimate on diagonals (conservative). */
      const rawDist = (a: {x: number; z: number}, b: {x: number; z: number}) => {
        const [ax, ay] = cellOf(a.x, a.z), [bx, by] = cellOf(b.x, b.z);
        const d = g.distanceField(ax, ay)[g.idx(bx, by)];
        return d < 0 ? -1 : d * 0.5;
      };
      const dist = (a: {x: number; z: number}, b: {x: number; z: number}) => {
        const d = rawDist(a, b);
        expect(d, `path ${a.x},${a.z} -> ${b.x},${b.z}`).toBeGreaterThanOrEqual(0);
        return d;
      };
      // every way down onto the core floor (stairs / ladders) that reaches the pump hall on foot: the farthest one is budgeted
      const chain0 = stand('valve');
      const entries = L.levelLinks.filter(l => l.lower === coreLv).map(l => rawDist(l.bottom, chain0)).filter(d => d >= 0);
      expect(entries.length).toBeGreaterThan(0);
      // (lane OBJECTIVES) the startup key lies on the core floor now: fetched between the pump and the key switch
      const keyC = r.components.find(c => c.item === 'reactor_key')!, kp = L.pickups[keyC.pickup];
      expect(keyC.level).toBe(coreLv);
      const chain = [stand('valve'), stand('pump'), {x: kp.x, z: kp.z, level: keyC.level}, stand('keyswitch'), stand('rods')];
      for (const c of chain) expect(c.level).toBe(coreLv); // the deep tasks are on the jammed storey: the mask is required
      let inner = 0;
      for (let i = 0; i + 1 < chain.length; i++) inner += dist(chain[i], chain[i + 1]);
      const walkM = Math.max(...entries) + inner;
      // after the rods: the clearing starts at WIN.airAtS; the eye at the rods is safe once it drops below the threshold
      const rods = chain[4];
      air.clearAll(REACTOR_AIR.CLEAR_ALL_S, WIN.airAtS);
      let tClear = WIN.airAtS;
      while (air.depthGasAt(rods.x, L.levels[coreLv].baseY + EYE, rods.z) >= GAS.THRESHOLD && tClear < 200) { tClear += 0.25; air.update(tClear); }
      expect(tClear).toBeLessThan(WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S);
      void st;
      const work = HOLD_S.valve + HOLD_S.rods + 3 * 1.0; // three presses (pump, take the key, the key switch) with their approach
      const once = walkM / WALK_SPEED + work + tClear;
      const budget = 2 * (walkM / WALK_SPEED) + work + tClear + 60; // detours + 60 s of fighting
      // the guaranteed supply (the smallest roll): the mask's fitted filter + the spare filters, all upstream (previous test)
      const minSupply = FILTER_LIFE_S * MASK_LOOT.foundFilter[0] + FILTER_LIFE_S * MASK_LOOT.levels.reactor.filters[0];
      const fitted = L.pickups.find(p => p.itemId === 'gas_mask')!.filter ?? 0;
      const actual = fitted + FILTER_LIFE_S * L.pickups.filter(p => p.itemId === 'gas_filter').length;
      // task filter-tension-airtank-20261104-072836 (user: "Do not increase loot in the reactor at all … we simply changing the items
      // statistics"; Main: no "finish the Reactor with only on-site supplies" requirement): a filter lasts 37.5 s now, so the on-site supply
      // (counts UNCHANGED) no longer covers the masked core route by itself — by design the player arrives prepared (scavenged spares, an
      // Airtank Backpack). Pinned instead: the unchanged counts and the supply in the new units; the route budget is still measured.
      expect(MASK_LOOT.levels.reactor).toEqual({masks: [1, 1], filters: [3, 5]});
      expect(minSupply).toBeCloseTo(37.5 * 0.35 + 37.5 * 3, 9);
      expect(budget).toBeGreaterThan(0);
      expect(actual).toBeGreaterThanOrEqual(minSupply - 1e-9);
      out.push(`seed ${seed} core route: walk ${walkM.toFixed(0)} m (${(walkM / WALK_SPEED).toFixed(0)} s at ${WALK_SPEED} m/s), holds/presses ${work.toFixed(0)} s, online -> breathable ${tClear.toFixed(1)} s; one pass ${once.toFixed(0)} s, budget ${budget.toFixed(0)} s; filter supply ${actual.toFixed(0)} s (worst roll ${minSupply.toFixed(0)} s)`);
      report(); out.length = 0;
    }, 60_000);
  }
});

describe('reactor gas: every surface agrees about the jam (lane GAS)', () => {
  let uninstall: () => void = () => {};
  beforeAll(() => { uninstall = installCanvasShim(false); });
  afterAll(() => uninstall());

  /** A recording 2D context (texts only; measureText 0.62 em per glyph, as tests/reactor-x-controls-screens.test.ts). */
  const recorder = () => {
    const texts: {s: string; x: number; y: number; px: number; align: string}[] = [];
    const st = {font: '10px monospace', textAlign: 'left'};
    const px = () => parseFloat(/(\d+(?:\.\d+)?)px/.exec(st.font)?.[1] ?? '10');
    const noop = () => {};
    const ctx = {
      set font(v: string) { st.font = v; }, get font() { return st.font; },
      set textAlign(v: string) { st.textAlign = v; }, get textAlign() { return st.textAlign; },
      textBaseline: 'middle', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
      measureText: (t: string) => ({width: [...t].length * px() * 0.62}),
      fillText: (s: string, x: number, y: number) => { texts.push({s, x, y, px: px(), align: st.textAlign}); },
      fillRect: noop, strokeRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop, closePath: noop,
      save: noop, restore: noop, setLineDash: noop,
    };
    return {ctx: ctx as unknown as CanvasRenderingContext2D, texts};
  };
  const outside = (texts: {s: string; x: number; y: number; px: number; align: string}[], W: number, H: number) => texts.filter(t => {
    const w = [...t.s].length * t.px * 0.62, x0 = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
    return x0 < 2 - 1e-6 || x0 + w > W - 2 + 1e-6 || t.y - t.px / 2 < 0 || t.y + t.px / 2 > H;
  }).map(t => t.s);

  it('seed 9100: the pit / switchgear boards, the next step and the floor maps all say the core floor is gassed (mask) until online', () => {
    const L = level(9100), r = L.reactor!, jam = reactorJam(r)!, core = jam.levels[0];
    const st = emptyReactorState(r.generators.length, r.zones.length);
    const model = (s: ReactorRunState): ScreenModel => ({state: s, tiers: r.tiers, zones: r.zones, winT: s.restarted ? 99 : null, towers: [], core: 0, pumpK: 0, next: '', jamZone: jam.zone});
    const draw = (id: 'pitBoard' | 'switchgearBoard', s: ReactorRunState) => {
      const sc = r.screens.find(q => q.id === id)!, {pw, ph} = screenPixels(sc.w, sc.h), {ctx, texts} = recorder();
      drawReactorScreen(ctx, id, model(s), pw, ph);
      expect(outside(texts, pw, ph), `${id} texts outside the canvas`).toEqual([]);
      return texts.map(t => t.s).join(' | ');
    };
    // (task reactor-ending-polish-20261104, user: "the map indicates that the last generator is jammed. It shouldn't instead the player
    // should discover this them selfs when they try to start the generator") BEFORE any start attempt nothing announces the jam: the pit
    // board's core-floor row reads like any zone still to start, the floor maps mark the generator as one more to start (an open X), no
    // jam banner / legend — the jam itself is unchanged (an attempt still seizes; reactor-air-runtime / generators tests)
    expect(draw('pitBoard', st)).not.toContain(JAM_TEXT.board);
    {
      const ms0 = mapMarkers({info: r, state: st, carried: () => 0, pickups: () => [], levelAt: () => 0});
      const g0 = ms0.find(m => m.kind === 'generator' && m.id === jam.generator)!;
      expect(g0.state).toBe('need');
      expect(markerOpen(g0)).toBe(true);
      for (const t of r.tiers) expect(storeyWarning(r, st, t.level), t.label).toBeNull();
      const plan0 = planStoreys(L, r);
      for (const storey of plan0.storeys) {
        const {ctx, texts} = recorder();
        drawMapFace(ctx, MAP_PX.w, MAP_PX.h, {plan: plan0, storey, markers: ms0.filter(m => m.level === storey.level), you: null, board: null, warn: storeyWarning(r, st, storey.level),
          floors: plan0.storeys.map(q => ({level: q.level, label: q.label, need: 1, selected: q.level === storey.level, here: false}))});
        const all = texts.map(t => t.s).join(' | ');
        expect(all.includes(JAM_TEXT.legend) || all.includes(JAM_TEXT.map), storey.label).toBe(false);
      }
    }
    // AFTER a start was tried there (the attempt stalls and persists jam.stalls), the jam is known: the pit board shows the core
    // floor's row JAMMED · MASK; the other zones their clearing bars
    const tried: ReactorRunState = {...st, jam: {generator: jam.generator, stalls: 1, at: 1}};
    expect(draw('pitBoard', tried)).toContain(JAM_TEXT.board);
    expect(draw('pitBoard', tried).split(JAM_TEXT.board).length - 1).toBe(1);
    // the switchgear board (tier 4, the last stop before the core floor) warns once control power is on
    const powered = {...st, fuses: [true, true], breaker: true};
    expect(draw('switchgearBoard', powered).replace(/ \| /g, ' ')).toContain(JAM_TEXT.switchgear);
    // the next step to the core floor names the mask; a step upstream does not
    const mask = {levels: jam.levels, note: JAM_TEXT.next};
    expect(nextStepText(powered, r, {count: () => 1}, mask)).toMatch(/pump hall \(Core floor\) · gas mask$/); // (lane OBJECTIVES: terse)
    // (lane OBJECTIVES) the key on the core floor: its find step names the mask too
    expect(nextStepText({...powered, valve: true, pump: true}, r, {count: () => 0}, mask)).toBe('Next: find the startup key — Control room · Core floor · gas mask');
    expect(nextStepText({...st}, r, {count: () => 1}, mask)).not.toContain(JAM_TEXT.next); // fuses first: the switchgear, tier 4
    // the floor maps (once the jam is known): the jammed generator's own mark (not an open X), the banner on the core storey only
    const ms = mapMarkers({info: r, state: tried, carried: () => 0, pickups: () => [], levelAt: () => 0});
    const gm = ms.find(m => m.kind === 'generator' && m.id === jam.generator)!;
    expect(gm.state).toBe('jammed');
    expect(markerOpen(gm)).toBe(false);
    for (const t of r.tiers) expect(storeyWarning(r, tried, t.level), t.label).toBe(t.level === core ? JAM_TEXT.map : null);
    const plan = planStoreys(L, r);
    for (const storey of [plan.storeys.find(s => s.level === core)!, plan.storeys.find(s => s.level === gm.level)!]) {
      const {ctx, texts} = recorder();
      drawMapFace(ctx, MAP_PX.w, MAP_PX.h, {plan, storey, markers: ms.filter(m => m.level === storey.level), you: null, board: null, warn: storeyWarning(r, tried, storey.level),
        floors: plan.storeys.map(s => ({level: s.level, label: s.label, need: 1, selected: s.level === storey.level, here: false}))});
      const all = texts.map(t => t.s).join(' | ');
      expect(all.includes(JAM_TEXT.map), storey.label).toBe(storey.level === core);
      if (storey.level === gm.level) expect(all).toContain(JAM_TEXT.legend);
      expect(outside(texts, MAP_PX.w, MAP_PX.h).filter(s => !/YOU ARE HERE|^H|^[A-Z ]+$|^[KFBVPSRG]\d?$/.test(s)), storey.label).toEqual([]);
    }
    // online (restarted): every warning goes; the clearing runs
    const online = {...powered, valve: true, pump: true, keyInserted: true, rods: true, restarted: true, restartedAt: 1, jam: tried.jam};
    expect(draw('pitBoard', online)).not.toContain(JAM_TEXT.board);
    expect(draw('switchgearBoard', online)).not.toContain('jammed');
    expect(storeyWarning(r, online, core)).toBeNull();
    expect(nextStepText(online, r, {count: () => 0}, mask)).not.toContain(JAM_TEXT.next);
  }, 60_000);

  // (lane OBJECTIVES, intent change: the HUD objective carried JAM_TEXT.objective "Core floor gassed — its generator is jammed …"; the
  // user: too wordy, the jam is learnt at the generator) — the objective says NOTHING about the jam / mask in any state now
  it('the restart runtime: the HUD objective has no jam / mask text, and the bottom clears ONLY at online — never at a fuse / breaker / valve / pump / key', () => {
    const h = fakeHost(), rt = buildRestart(h);
    const cleared: number[] = [];
    rt.clearAir = d => { cleared.push(d); return true; };
    rt.frame(0.3);
    const noJam = (why: string) => expect(rt.objective, why).not.toMatch(/jam|mask|filter|gassed|toxic/i);
    noJam('fresh'); // the fixture's deepest zone (its generator) jams too
    const give = (id: string) => h.inv.add(h.inv.makeStack(id, 1));
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch']) {
      expect(rt.qaOperate(id, give).ok, id).toBe(true);
      for (let i = 0; i < 40; i++) rt.frame(0.25); // 10 s after each step
      expect(cleared, `after ${id}`).toEqual([]);
      noJam(`after ${id}`);
    }
    expect(rt.qaOperate('rods').ok).toBe(true);
    for (let i = 0; i < Math.ceil((WIN.airAtS + 1) / 0.25); i++) rt.frame(0.25);
    expect(cleared).toEqual([WIN.airDurationS]); // once, at online
    noJam('online');
    void REACTOR_LANE;
  });
});
