// Task reactor-build-20261101 (lane RESTART): the restart's pure rules (world/reactor/restartLogic.ts) — order, prerequisites, parts
// consumed exactly once, no duplicate fuses, task statuses, the next-step line, and the persisted record (read-modify-write of the
// record shared with lane AIR, the monotonic mirror, Retry / travel with a real RunState).
import {describe, expect, it} from 'vitest';
import {Inventory} from '../src/items/inventory';
import {REACTOR_LANE, emptyReactorState, loadReactorState, reactorTasks} from '../src/world/reactor/runState';
import {
  FUSE_CARTRIDGE_ID, HOLD_S, REACTOR_KEY_ID, RESTART_CONTROL_IDS, blocker, controlDone, controlPrompt,
  nextStepText, operate, readRestartState, taskLine, writeRestartState, type RestartControlId,
} from '../src/world/reactor/restartLogic';
import {newRun, reactorInfoFixture} from './helpers/reactorRestartFixture';

const withParts = (fuses: number, key: number): Inventory => {
  const inv = new Inventory();
  if (fuses) inv.add(inv.makeStack(FUSE_CARTRIDGE_ID, fuses));
  if (key) inv.add(inv.makeStack(REACTOR_KEY_ID, key));
  return inv;
};

describe('reactor restart rules', () => {
  it('a full restart in the credible order: fuses -> breaker -> valve -> pump -> key -> rods', () => {
    const s = emptyReactorState(2, 2), inv = withParts(2, 1);
    const order: RestartControlId[] = ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch', 'rods'];
    for (const id of order) {
      const r = operate(s, id, inv, 42);
      expect(r.ok, `${id}: ${r.ok ? '' : r.why}`).toBe(true);
      expect(controlDone(s, id)).toBe(true);
    }
    expect(s).toMatchObject({breaker: true, valve: true, pump: true, keyInserted: true, rods: true, restarted: true, restartedAt: 42});
    expect(s.fuses).toEqual([true, true]);
    expect(inv.count(FUSE_CARTRIDGE_ID)).toBe(0);
    expect(inv.count(REACTOR_KEY_ID)).toBe(0);
    expect(reactorTasks(s)).toEqual({key: 'done', power: 'done', coolant: 'done', rods: 'done'});
  });

  it('prerequisites refuse with a reason and change nothing', () => {
    const s = emptyReactorState(2, 2), none = withParts(0, 0);
    const before = JSON.stringify(s);
    expect(operate(s, 'fuse-0', none, 0)).toMatchObject({ok: false, done: false});
    expect(operate(s, 'breaker', none, 0)).toMatchObject({ok: false, why: expect.stringMatching(/Replace the burnt fuses first/)});
    expect(operate(s, 'pump', none, 0)).toMatchObject({ok: false, why: expect.stringMatching(/control power.*valve|valve.*power/i)});
    expect(operate(s, 'keyswitch', none, 0)).toMatchObject({ok: false, why: expect.stringMatching(/startup key/)});
    expect(operate(s, 'rods', none, 0)).toMatchObject({ok: false, why: expect.stringMatching(/Rod control locked/)});
    expect(JSON.stringify(s)).toBe(before);
    // the valve is a manual handwheel: no power needed; the pump then still needs control power
    expect(operate(s, 'valve', none, 0).ok).toBe(true);
    expect(operate(s, 'pump', none, 0)).toMatchObject({ok: false, why: expect.stringMatching(/No control power/)});
    // rods need key AND pump
    const inv = withParts(2, 1);
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'pump'] as const) expect(operate(s, id, inv, 0).ok).toBe(true);
    expect(operate(s, 'rods', inv, 0)).toMatchObject({ok: false, why: expect.stringMatching(/startup key/)});
    expect(operate(s, 'keyswitch', inv, 0).ok).toBe(true);
    expect(operate(s, 'rods', inv, 0).ok).toBe(true);
  });

  it('every part is consumed exactly once; a filled slot never takes a second cartridge', () => {
    const s = emptyReactorState(2, 2), inv = withParts(3, 1);
    expect(operate(s, 'fuse-0', inv, 0).ok).toBe(true);
    expect(inv.count(FUSE_CARTRIDGE_ID)).toBe(2);
    const again = operate(s, 'fuse-0', inv, 0);
    expect(again).toMatchObject({ok: false, done: true});
    expect(inv.count(FUSE_CARTRIDGE_ID)).toBe(2); // no duplicate fuse in the same slot
    expect(operate(s, 'fuse-1', inv, 0)).toMatchObject({ok: true, event: {type: 'fuse', slot: 1, installed: 2}});
    expect(inv.count(FUSE_CARTRIDGE_ID)).toBe(1); // exactly two consumed for two slots
    expect(operate(s, 'keyswitch', inv, 0).ok).toBe(true);
    expect(operate(s, 'keyswitch', inv, 0)).toMatchObject({ok: false, done: true});
    expect(inv.count(REACTOR_KEY_ID)).toBe(0);
    // a take that fails (count lied) changes nothing
    const s2 = emptyReactorState(2, 2);
    const liar = {count: () => 1, take: () => 0};
    expect(operate(s2, 'fuse-0', liar, 0).ok).toBe(false);
    expect(s2.fuses).toEqual([false, false]);
  });

  it('hold times, prompts and the HUD task line', () => {
    expect(HOLD_S).toMatchObject({breaker: 1, valve: 3, rods: 4, pump: 0, keyswitch: 0, 'fuse-0': 0, 'fuse-1': 0});
    expect(RESTART_CONTROL_IDS).toHaveLength(7);
    const s = emptyReactorState(2, 2), inv = withParts(1, 0);
    expect(controlPrompt(s, 'fuse-0', inv)).toContain('[E]</b> Fit a fuse cartridge');
    expect(controlPrompt(s, 'breaker', inv)).toContain('replace the burnt fuses first');
    expect(controlPrompt(s, 'valve', inv)).toContain('Hold [E]');
    expect(controlPrompt(s, 'valve', inv, 0.5)).toContain('50 %');
    expect(controlPrompt(s, 'rods', inv)).toMatch(/^Control rods · needs/);
    expect(blocker(s, 'valve', inv)).toBeNull();
    // task reactor-surface-ending-20261102 (lane OBJECTIVES, intent change): ROUTE order (the key lies on the core floor now), the
    // current task marked (was "Key · Power · Coolant · Rods", unmarked)
    expect(taskLine(s).html).toBe('<span class="rt ready now">▸ Power</span> · <span class="rt blocked">Coolant</span> · <span class="rt ready">Key</span> · <span class="rt blocked">Rods</span>');
    s.keyInserted = true;
    expect(taskLine(s).html).toContain('<span class="rt done">✓ Key</span>');
  });

  it('the next-step line walks the crew order and names the sites / where the parts are', () => {
    const info = reactorInfoFixture();
    const s = emptyReactorState(2, 2);
    // (lane OBJECTIVES, intent change) the key lies in the core floor's control room: fetched after the coolant, not first
    expect(nextStepText(s, info, withParts(0, 0))).toBe('Next: find spare fuse cartridges — Tier 2 stores');
    expect(nextStepText(s, info, withParts(0, 1))).toBe('Next: find spare fuse cartridges — Tier 2 stores');
    expect(nextStepText(s, info, withParts(2, 0))).toBe('Next: replace the burnt fuses — switchgear (Tier 2)');
    s.fuses = [true, true];
    expect(nextStepText(s, info, withParts(0, 1))).toBe('Next: close the main breaker — switchgear (Tier 2)');
    s.breaker = true; s.valve = true; s.pump = true;
    expect(nextStepText(s, info, withParts(0, 0))).toBe('Next: find the startup key — Control room · Core floor');
    expect(nextStepText(s, info, withParts(0, 1))).toBe('Next: insert the startup key — control room (Core floor)');
    s.keyInserted = true;
    expect(nextStepText(s, info, withParts(0, 0))).toBe('Next: withdraw the control rods — control room (Core floor)');
  });
});

describe('reactor restart persistence', () => {
  it('round trip through the run lane store keeps every RESTART field', () => {
    const run = newRun();
    const s = emptyReactorState(2, 2), inv = withParts(2, 1);
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch'] as const) operate(s, id, inv, 0);
    writeRestartState(run, REACTOR_LANE, 2, 2, s);
    const back = readRestartState(run, REACTOR_LANE, 2, 2);
    expect(back).toEqual(s);
    // plain JSON (the Retry snapshot is a structuredClone of section memory)
    expect(JSON.parse(JSON.stringify(run.laneStore(REACTOR_LANE)))).toEqual(run.laneStore(REACTOR_LANE));
  });

  it("read-modify-write keeps lane AIR's generators / zoneClear exactly as stored", () => {
    const run = newRun();
    const air = emptyReactorState(2, 2);
    air.generators[1] = {started: true, startedAt: 12.5};
    air.zoneClear = [1, 0.4];
    run.setLaneStore(REACTOR_LANE, air);
    const mine = readRestartState(run, REACTOR_LANE, 2, 2);
    operate(mine, 'valve', withParts(0, 0), 0);
    mine.generators[1].started = false; // a stale in-memory copy must not overwrite AIR's fields
    writeRestartState(run, REACTOR_LANE, 2, 2, mine);
    const stored = loadReactorState(run.laneStore(REACTOR_LANE), 2, 2);
    expect(stored.generators[1]).toEqual({started: true, startedAt: 12.5});
    expect(stored.zoneClear).toEqual([1, 0.4]);
    expect(stored.valve).toBe(true);
  });

  it("both lanes read-merge-write: AIR saving its keys after us never wipes ours (and ours never wipe AIR's)", () => {
    const run = newRun();
    const s = readRestartState(run, REACTOR_LANE, 2, 2);
    operate(s, 'fuse-0', withParts(1, 0), 0);
    writeRestartState(run, REACTOR_LANE, 2, 2, s);
    // lane AIR's save (world/reactor/generators.ts): read the stored record, set ONLY generators / zoneClear, write back
    const cur = loadReactorState(run.laneStore(REACTOR_LANE), 2, 2);
    cur.generators[0] = {started: true, startedAt: 3};
    cur.zoneClear[0] = 0.5;
    run.setLaneStore(REACTOR_LANE, cur);
    const back = readRestartState(run, REACTOR_LANE, 2, 2);
    expect(back.fuses).toEqual([true, false]);
    expect(back.generators[0]).toEqual({started: true, startedAt: 3});
    // one record only (no side store)
    expect(Object.keys(run.memory().lanes)).toEqual([REACTOR_LANE]);
  });

  it('travel keeps the record; Retry restores the level-entry snapshot; a new run starts clean', () => {
    const run = newRun();
    const entry = run.levelMemories('reactor' as never); // taken when the level was entered (nothing done yet)
    const s = readRestartState(run, REACTOR_LANE, 2, 2);
    operate(s, 'valve', withParts(0, 0), 0);
    writeRestartState(run, REACTOR_LANE, 2, 2, s);
    // travel away and back: section memory is kept
    run.current = {level: 'subway' as never, section: 'main'};
    run.current = {level: 'reactor' as never, section: 'main'};
    expect(readRestartState(run, REACTOR_LANE, 2, 2).valve).toBe(true);
    // Retry level: the entry snapshot's memories replace this level's
    run.restoreLevelMemories('reactor' as never, entry);
    expect(readRestartState(run, REACTOR_LANE, 2, 2).valve).toBe(false);
    expect(readRestartState(newRun(), REACTOR_LANE, 2, 2)).toEqual(emptyReactorState(2, 2));
  });
});
