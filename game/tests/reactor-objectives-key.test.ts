// Task reactor-surface-ending-20261102 (lane OBJECTIVES). Two user intent changes (Reactor feedback round 2):
//  (2) "the objective text is to wordy, saying "core floor generator is jammed" and all that. Get rid of that, include only simple
//      objective indication. The player will know its jammed when they try to start it." -> the HUD objective (world/reactor/
//      objectiveText.ts) is one short line + the storey in every restart state, no jam / mask / hazard text; the jam is still told AT the
//      generator (its stall toast stays short; the full stall / lamp / prompt machine: tests/reactor-air-runtime.test.ts).
//  (3) "the key for reactor start should be on the bottom floor not the top floor." -> the startup key lies in the core floor's control
//      room (the key switch's room) on >= 12 seeds: reachable on foot from every way down onto the core floor, fetched on the masked
//      core route (its filter time measured; task filter-tension-airtank: 37.5 s filters, no on-site-only requirement), its map X where it actually lies, nothing
//      pointing at the rim office any more, the item id / record / persistence unchanged.
import {describe, expect, it} from 'vitest';
import {appendFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {rollLevelGear} from '../src/levels/gearAdapter';
import {REACTOR_KEY_WHERE} from '../src/gen/reactor/index';
import {levelsOf} from '../src/gen/levels';
import {FLOOR} from '../src/gen/grid';
import {GAS} from '../src/world/gas/field';
import {FILTER_LIFE_S} from '../src/items/gear';
import {WALK_SPEED} from '../src/player/player';
import {MASK_LOOT} from '../src/gen/maskLoot';
import {REACTOR_AIR, ReactorAir} from '../src/world/reactor/air';
import {layoutRect} from '../src/world/reactor/generators';
import {WIN} from '../src/world/reactor/restartWin';
import {REACTOR_LANE, emptyReactorState, loadReactorState, type ReactorRunState} from '../src/world/reactor/runState';
import {HOLD_S, REACTOR_KEY_ID, blocker, nextStepText} from '../src/world/reactor/restartLogic';
import {OBJECTIVE_TASK_ORDER, OBJECTIVE_TEXT, currentTask, objectiveHtml, taskLine} from '../src/world/reactor/objectiveText';
import {PLAN, mapMarkers, planStoreys} from '../src/world/reactor/mapBoardPlan';
import {JAM_TEXT, reactorJam} from '../src/gen/reactor/gasJam';
import {buildRestart, fakeHost} from './helpers/reactorRestartFixture';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [9100, 218558, 637474, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const EYE = 1.6;
const cache = new Map<number, StationLayout>();
/** The level as the game generates it (with the run's gear roll: masks / filters included). */
const level = (seed: number) => {
  let L = cache.get(seed);
  if (!L) { L = LEVELS.reactor.generate('main', {levelSeed: seed, gear: rollLevelGear(seed, 'reactor', ['main']).main}); cache.set(seed, L); }
  return L;
};

/** The HUD objective's visible lines (the text of each top-level div). */
const lines = (html: string) => [...html.matchAll(/<div[^>]*>(.*?)<\/div>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
/** No jam / mask / hazard explanation anywhere in the HUD objective. */
const NO_HAZARD = /jam|mask|filter|gas|toxic|generator|fan/i;
/** The longest a HUD objective line may be (characters): one short line. */
const MAX_LINE = 64;

describe('(2) the concise HUD objective: one short line + the storey, no jam paragraph (lane OBJECTIVES)', () => {
  it('pure: route order, the current task marked, every restart state short and hazard-free', () => {
    const s = emptyReactorState(3, 3);
    const expectCurrent: [Partial<ReactorRunState>, string | null][] = [
      [{}, 'power'], [{fuses: [true, false]}, 'power'], [{fuses: [true, true]}, 'power'], [{breaker: true}, 'coolant'], [{valve: true}, 'coolant'],
      [{pump: true}, 'key'], [{keyInserted: true}, 'rods'], [{rods: true}, null],
    ];
    for (const [patch, want] of expectCurrent) {
      Object.assign(s, patch);
      expect(currentTask(s), JSON.stringify(patch)).toBe(want);
      const tl = taskLine(s);
      expect(tl.current).toBe(want);
      const text = tl.html.replace(/<[^>]+>/g, '');
      // the four tasks in route order, the done ones ticked, at most one marked current (always a 'ready' one)
      const labels = OBJECTIVE_TASK_ORDER.map(id => OBJECTIVE_TEXT.tasks[id]);
      expect(text.replace(/[✓▸] /g, '').split(' · ')).toEqual(labels);
      expect((text.match(/▸/g) ?? []).length).toBe(want ? 1 : 0);
      if (want) { expect(text).toContain(`▸ ${OBJECTIVE_TEXT.tasks[want as 'power']}`); expect(tl.tasks[want as 'power']).toBe('ready'); }
      const html = objectiveHtml({state: s, waking: false, tier: 'Core floor'});
      expect(lines(html)).toHaveLength(2);
      for (const l of lines(html)) { expect(l.length, l).toBeLessThanOrEqual(MAX_LINE); expect(l, l).not.toMatch(NO_HAZARD); }
    }
    // after the restart: the waking / running lines, short; a later stage (lane ENDING) replaces the post-restart line only
    s.restarted = true;
    for (const waking of [true, false]) {
      const [l] = lines(objectiveHtml({state: s, waking, tier: ''}));
      expect(l).toBe(waking ? OBJECTIVE_TEXT.waking : OBJECTIVE_TEXT.running);
      expect(l.length).toBeLessThanOrEqual(MAX_LINE);
    }
    expect(lines(objectiveHtml({state: s, waking: false, tier: 'Rim', stage: 'External doors open'}))).toEqual(['External doors open', 'Rim']);
    expect(lines(objectiveHtml({state: emptyReactorState(3, 3), waking: false, tier: '', stage: 'External doors open'}))[0]).toMatch(/^Restart the reactor — /);
  });

  it('the runtime: the HUD objective stays one short hazard-free line (+ the storey) through every restart step, though the bottom is jammed', () => {
    const h = fakeHost(), rt = buildRestart(h);
    rt.clearAir = () => true;
    const give = (id: string) => h.inv.add(h.inv.makeStack(id, 1));
    const check = (why: string, first: RegExp) => {
      const ls = lines(rt.objective);
      expect(ls, why).toHaveLength(2);
      expect(ls[0], why).toMatch(first);
      expect(ls[1], why).toBe('Tier 2'); // the storey (the fixture's levelAt)
      for (const l of ls) { expect(l.length, `${why}: ${l}`).toBeLessThanOrEqual(MAX_LINE); expect(l, `${why}: ${l}`).not.toMatch(NO_HAZARD); }
      expect(rt.objective, why).not.toContain('class="jam"');
    };
    rt.frame(0.3);
    expect(rt.state!.zoneClear.length).toBeGreaterThan(1); // the fixture's deepest zone is the jammed one (gasJam rule)
    check('fresh', /^Restart the reactor — ▸ Power · Coolant · Key · Rods$/);
    const steps: [string, RegExp][] = [
      ['fuse-0', /▸ Power/], ['fuse-1', /▸ Power/], ['breaker', /✓ Power · ▸ Coolant/], ['valve', /▸ Coolant/],
      ['pump', /✓ Power · ✓ Coolant · ▸ Key · Rods$/], ['keyswitch', /✓ Power · ✓ Coolant · ✓ Key · ▸ Rods$/],
    ];
    for (const [id, want] of steps) {
      expect(rt.qaOperate(id, give).ok, id).toBe(true);
      rt.frame(0.3);
      check(`after ${id}`, want);
    }
    // a later stage's seam (lane ENDING) is ignored until the restart
    rt.objectiveStage = () => 'External doors open';
    rt.frame(0.3);
    check('stage before the restart', /^Restart the reactor — /);
    rt.objectiveStage = null;
    expect(rt.qaOperate('rods').ok).toBe(true);
    rt.frame(0.3);
    check('waking', new RegExp(`^${OBJECTIVE_TEXT.waking}$`));
    rt.qaFinishWin();
    rt.frame(0.3);
    check('running', new RegExp(`^${OBJECTIVE_TEXT.running}$`));
    rt.objectiveStage = () => 'External doors open';
    rt.frame(0.3);
    check('a later stage', /^External doors open$/);
  });

  it('the jam is learnt at the generator: its stall toast and prompts are short and name the jam; the HUD air line only says toxic', () => {
    expect(JAM_TEXT.stalled(2)).toMatch(/JAMMED/);
    expect(JAM_TEXT.stalled(2).length).toBeLessThanOrEqual(120);
    expect(JAM_TEXT.promptJammed(2)).toMatch(/JAMMED/);
    expect(JAM_TEXT.promptJammed(2).replace(/<[^>]+>/g, '').length).toBeLessThanOrEqual(90);
    expect(JAM_TEXT.hud).toMatch(/toxic/);
    expect(JAM_TEXT.hud).not.toMatch(/jam/i);
    // the board marks stay terse (optional detailed boards, not HUD paragraphs)
    for (const t of [JAM_TEXT.board, JAM_TEXT.map, JAM_TEXT.switchgear, JAM_TEXT.next, JAM_TEXT.legend]) expect(t.length, t).toBeLessThanOrEqual(48);
    expect(JAM_TEXT.switchgear).not.toMatch(/jam/i);
    expect(JAM_TEXT.map).not.toMatch(/jam/i);
    expect('objective' in JAM_TEXT).toBe(false);
  });
});

describe('(3) the startup key on the core floor (lane OBJECTIVES)', () => {
  it(`>= 12 seeds: the key lies in the core floor's control room, on open floor, off the stand points, reachable on foot from every way down`, () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(12);
    for (const seed of SEEDS) {
      const L = level(seed), r = L.reactor!, core = r.tiers[r.tiers.length - 1];
      expect(core.role).toBe('core');
      const keys = r.components.filter(c => c.item === REACTOR_KEY_ID);
      expect(keys.length, `seed ${seed}`).toBe(1);
      const key = keys[0], kp = L.pickups[key.pickup], ctl = r.sites.find(s => s.id === 'control')!;
      // the stable item id + its one finite pickup, on the core floor, in the key switch's room
      expect([kp.itemId, kp.count, kp.level ?? 0, key.level, key.area]).toEqual([REACTOR_KEY_ID, 1, core.level, core.level, ctl.area]);
      expect(ctl.level).toBe(core.level);
      expect(key.where).toBe(REACTOR_KEY_WHERE);
      expect(L.pickups.filter(p => p.itemId === REACTOR_KEY_ID).length, `seed ${seed}: one key in the level`).toBe(1);
      expect(r.components.some(c => c.item === REACTOR_KEY_ID && c.level === 0)).toBe(false);
      // on a walkable floor cell of its storey at the deck height, inside the control room's rect
      const g = L.levels[core.level].grid, [cx, cy] = g.cellOf(kp.x, kp.z), i = g.idx(cx, cy);
      expect(g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && g.area[i] === ctl.area, `seed ${seed}: open floor`).toBe(true);
      expect(Math.abs(kp.y - core.baseY), `seed ${seed}: on the deck`).toBeLessThan(0.3);
      expect(kp.x > ctl.rect.x0 && kp.x < ctl.rect.x1 && kp.z > ctl.rect.z0 && kp.z < ctl.rect.z1, `seed ${seed}: in the room`).toBe(true);
      // never under the operator's feet at the console (the key switch / rod control stand points), on the operator side of the console
      // (beyond its front face: forward(yaw) = (-sin yaw, -cos yaw) faces the operator), not out by the vessel opening
      for (const c of ctl.controls) expect(Math.hypot(kp.x - c.stand.x, kp.z - c.stand.z), `seed ${seed}: off the ${c.id} stand`).toBeGreaterThanOrEqual(1.2);
      const con = ctl.machines!.find(m => m.kind === 'console')!;
      expect((kp.x - con.x) * -Math.sin(con.yaw) + (kp.z - con.z) * -Math.cos(con.yaw), `seed ${seed}: operator side`).toBeGreaterThan(con.d / 2 + 0.5);
      // reachable on foot (the core grid) from every way down onto the core floor, back up again, and from it the key switch: no lock
      const field = g.distanceField(cx, cy);
      const downs = L.levelLinks.filter(k => k.lower === core.level);
      expect(downs.length).toBeGreaterThan(0);
      let back = 0;
      for (const k of downs) {
        const [bx, by] = g.cellOf(k.bottom.x, k.bottom.z);
        expect(g.distanceField(bx, by)[i], `seed ${seed}: from link ${k.id}`).toBeGreaterThanOrEqual(0);
        if (field[g.idx(bx, by)] >= 0) back++;
      }
      expect(back, `seed ${seed}: back up from the key`).toBeGreaterThan(0);
      const ks = ctl.controls.find(c => c.id === 'keyswitch')!.stand, [sx, sy] = g.cellOf(ks.x, ks.z);
      expect(field[g.idx(sx, sy)], `seed ${seed}: key -> key switch`).toBeGreaterThanOrEqual(0);
      expect(field[g.idx(sx, sy)] * 0.5, `seed ${seed}: the key is in the switch's room`).toBeLessThan(25);
    }
  }, 300_000);

  it('>= 12 seeds: the guaranteed upstream mask + filter time (unchanged counts, 37.5 s filters) measured against the masked core route WITH the key fetch (stairs -> valve -> pump -> key -> key switch -> rods -> online)', () => {
    for (const seed of SEEDS) {
      const L = level(seed), r = L.reactor!, jam = reactorJam(r)!, coreLv = jam.levels[0], g = L.levels[coreLv].grid;
      // the mask and every filter lie upstream of the gassed core floor (lane GAS's placement rule; the key fetch adds no gear lock)
      const finds = L.pickups.filter(p => p.itemId === 'gas_mask' || p.itemId === 'gas_filter');
      expect(finds.some(p => p.itemId === 'gas_mask'), `seed ${seed}: a mask`).toBe(true);
      for (const p of finds) expect(jam.levels.includes(p.level ?? 0), `seed ${seed} ${p.itemId}`).toBe(false);
      const stand = (id: string) => { for (const s of r.sites) { const c = s.controls.find(q => q.id === id); if (c) return c.stand; } throw new Error(id); };
      const key = r.components.find(c => c.item === REACTOR_KEY_ID)!, kp = L.pickups[key.pickup];
      const chain = [stand('valve'), stand('pump'), {x: kp.x, z: kp.z, level: key.level}, stand('keyswitch'), stand('rods')];
      for (const c of chain) expect(c.level, `seed ${seed}`).toBe(coreLv);
      const dist = (a: {x: number; z: number}, b: {x: number; z: number}) => {
        const [ax, ay] = g.cellOf(a.x, a.z), [bx, by] = g.cellOf(b.x, b.z), d = g.distanceField(ax, ay)[g.idx(bx, by)];
        expect(d, `seed ${seed}: path`).toBeGreaterThanOrEqual(0);
        return d * 0.5; // 4-connected cell steps: an overestimate on diagonals (conservative)
      };
      // every way down onto the core floor that reaches the pump hall on foot: the farthest one is budgeted (as reactor-gas-jam.test.ts)
      const [vx, vy] = g.cellOf(chain[0].x, chain[0].z), vi = g.idx(vx, vy);
      const entries = L.levelLinks.filter(k => k.lower === coreLv).map(k => { const [bx, by] = g.cellOf(k.bottom.x, k.bottom.z); return g.distanceField(bx, by)[vi]; }).filter(d => d >= 0).map(d => d * 0.5);
      expect(entries.length).toBeGreaterThan(0);
      let inner = 0;
      for (let i = 0; i + 1 < chain.length; i++) inner += dist(chain[i], chain[i + 1]);
      const walkM = Math.max(...entries) + inner;
      // online: the clearing starts at WIN.airAtS; the eye at the rods is safe once below the threshold (the real air, upper zones cleared)
      const st = emptyReactorState(r.generators.length, r.zones.length);
      for (const z of r.zones) if (z.id !== jam.zone) st.zoneClear[z.id] = 1;
      const air = new ReactorAir(r, layoutRect(L), st);
      air.update(0, true);
      air.clearAll(REACTOR_AIR.CLEAR_ALL_S, WIN.airAtS);
      const rods = chain[4];
      let tClear = WIN.airAtS;
      while (air.depthGasAt(rods.x, L.levels[coreLv].baseY + EYE, rods.z) >= GAS.THRESHOLD && tClear < 200) { tClear += 0.25; air.update(tClear); }
      expect(tClear).toBeLessThan(WIN.airAtS + REACTOR_AIR.CLEAR_ALL_S);
      const work = HOLD_S.valve + HOLD_S.rods + 3 * 1.0; // presses: the pump, taking the key, the key switch
      const budget = 2 * (walkM / WALK_SPEED) + work + tClear + 60; // detours + 60 s of fighting
      const minSupply = FILTER_LIFE_S * MASK_LOOT.foundFilter[0] + FILTER_LIFE_S * MASK_LOOT.levels.reactor.filters[0];
      // task filter-tension-airtank-20261104-072836 (user: "Do not increase loot in the reactor at all … we simply changing the items
      // statistics"; Main: no "finish the Reactor with only on-site supplies" requirement): a filter lasts 37.5 s now, so the on-site supply
      // (counts UNCHANGED) no longer covers the masked core route by itself — by design the player arrives prepared (scavenged spares, an
      // Airtank Backpack). Pinned instead: the unchanged counts and the supply in the new units; the route budget is still measured.
      expect(MASK_LOOT.levels.reactor).toEqual({masks: [1, 1], filters: [3, 5]});
      expect(minSupply).toBeCloseTo(37.5 * 0.35 + 37.5 * 3, 9);
      expect(budget, `seed ${seed}: walk ${walkM.toFixed(0)} m`).toBeGreaterThan(0);
      const detour = dist(chain[1], chain[2]) + dist(chain[2], chain[3]) - dist(chain[1], chain[3]);
      if (process.env.LL_OBJ_OUT) appendFileSync(process.env.LL_OBJ_OUT, `seed ${seed}: walk ${walkM.toFixed(0)} m (key detour ${detour.toFixed(1)} m), clear ${tClear.toFixed(1)} s, budget ${budget.toFixed(0)} s, worst-roll supply ${minSupply.toFixed(0)} s\n`);
    }
  }, 300_000);

  it('>= 12 seeds: the floor-map X is where the key actually lies (the core storey), nothing on the rim; the next step and the refusal point at the control room', () => {
    for (const seed of SEEDS) {
      const L = level(seed), r = L.reactor!, lv = levelsOf(L), core = r.tiers[r.tiers.length - 1].level;
      const key = r.components.find(c => c.item === REACTOR_KEY_ID)!, kp = L.pickups[key.pickup];
      const st = emptyReactorState(r.generators.length, r.zones.length);
      const ms = mapMarkers({info: r, state: st, carried: () => 0, pickups: id => L.pickups.filter(p => p.itemId === id), levelAt: (x, z, y) => lv.levelAt(x, z, y + 0.1)});
      const km = ms.filter(m => m.kind === 'key');
      expect(km.map(m => [m.x, m.z, m.level]), `seed ${seed}`).toEqual([[kp.x, kp.z, core]]);
      expect(ms.find(m => m.kind === 'keyswitch')!.level, `seed ${seed}: X and its key switch on one storey`).toBe(core);
      expect(ms.some(m => m.level === 0 && (m.kind === 'key' || m.kind === 'keyswitch')), `seed ${seed}: no key mark on the rim`).toBe(false);
      // on a drawn cell of the core storey's plan (findable on the map)
      const plan = planStoreys(L, r), sp = plan.storeys.find(s => s.level === core)!;
      const cx = Math.floor(kp.x / 0.5), cy = Math.floor(kp.z / 0.5);
      let drawn = false;
      for (let i = 0; i < sp.runs.length && !drawn; i += 4) if (sp.runs[i + 2] === cy && cx >= sp.runs[i] && cx < sp.runs[i + 1] && sp.runs[i + 3] === PLAN.room) drawn = true;
      expect(drawn, `seed ${seed}: the X on the control room's plan cell`).toBe(true);
      // the words: the next step after the coolant names the control room on the core floor (never the rim office)
      const mask = {levels: reactorJam(r)!.levels, note: JAM_TEXT.next};
      const cooled = {...st, fuses: [true, true], breaker: true, valve: true, pump: true};
      const next = nextStepText(cooled, r, {count: () => 0}, mask);
      expect(next).toBe(`Next: find the startup key — ${REACTOR_KEY_WHERE} · ${JAM_TEXT.next}`);
      for (const s of [st, {...st, fuses: [true, true]}, {...st, fuses: [true, true], breaker: true}, cooled]) {
        for (const n of [0, 2]) expect(nextStepText(s, r, {count: () => n}, mask), `seed ${seed}`).not.toMatch(/rim|office/i);
      }
    }
    // the refusal at the key switch (the runtime's hint: the key's room is the switch's room)
    const h = fakeHost(), rt = buildRestart(h);
    expect(blocker(rt.state!, 'keyswitch', h.inv, {key: 'it lies in this control room'})).toBe('The key switch needs the startup key — it lies in this control room');
    h.inv.add(h.inv.makeStack(REACTOR_KEY_ID, 1));
    expect(blocker(rt.state!, 'keyswitch', h.inv)).toBeNull();
  }, 300_000);

  it('stable and persistent: same seed -> same key pickup; inserted stays inserted across a rebuild (the run record), the map / HUD agree', () => {
    // regeneration never moves the key (revisits / Retry)
    const a = LEVELS.reactor.generate('main', {levelSeed: SEEDS[0], gear: rollLevelGear(SEEDS[0], 'reactor', ['main']).main}), b = level(SEEDS[0]);
    const ka = a.reactor!.components.find(c => c.item === REACTOR_KEY_ID)!, kb = b.reactor!.components.find(c => c.item === REACTOR_KEY_ID)!;
    expect(ka).toEqual(kb);
    expect(a.pickups[ka.pickup]).toEqual(b.pickups[kb.pickup]);
    // the runtime: take the key, turn it in the switch, rebuild the world on the same run -> still in (the item consumed once)
    const h = fakeHost(), rt = buildRestart(h);
    h.inv.add(h.inv.makeStack(REACTOR_KEY_ID, 1));
    expect(rt.qaOperate('keyswitch').ok).toBe(true);
    expect(h.inv.count(REACTOR_KEY_ID)).toBe(0);
    rt.frame(0.3);
    expect(lines(rt.objective)[0]).toContain('✓ Key');
    for (const s of h.sectionHooks) s.teardown?.();
    const stored = loadReactorState(h.run.laneStore(REACTOR_LANE), 2, 2);
    expect(stored.keyInserted).toBe(true);
    for (const s of h.sectionHooks) s.build?.(h.layout);
    expect(rt.state!.keyInserted).toBe(true);
    rt.frame(0.3);
    expect(lines(rt.objective)[0]).toContain('✓ Key');
    expect(rt.qaOperate('keyswitch').ok).toBe(false); // done: never a second key
    // the map: the key switch done, no key X anywhere
    const r = b.reactor!, st = {...emptyReactorState(r.generators.length, r.zones.length), keyInserted: true};
    const ms = mapMarkers({info: r, state: st, carried: () => 0, pickups: () => [], levelAt: () => 0});
    expect(ms.some(m => m.kind === 'key')).toBe(false);
    expect(ms.find(m => m.kind === 'keyswitch')!.state).toBe('done');
  }, 120_000);
});
