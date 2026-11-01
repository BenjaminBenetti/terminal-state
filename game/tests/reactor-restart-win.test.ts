// Task reactor-build-20261101 (lane RESTART): THE WIN — the pure timeline (world/reactor/restartWin.ts: tiers bottom-up, fans only
// up, clearAll once, toasts once, finish = end state) and the runtime (world/reactor/restart.ts on a fake host: the rods hold starts
// it, ARCH's visuals get the tiers in bottom-up order, the light pool's circuit 2 ramps 0 -> 1, AIR's clearAll once, the milestone
// once; a rebuilt restarted world comes back at the end state without a replay or a second milestone).
import {afterEach, describe, expect, it} from 'vitest';
import {VENT_TOWERS, WIN, WIN_TEXT, WinSequence, circuitAt, planWin, tierStartAt, towersDoneAt, winDoneAt, type WinSink} from '../src/world/reactor/restartWin';
import {setReactorVisuals, type ReactorVisuals} from '../src/world/reactor/visuals';
import {FUSE_CARTRIDGE_ID, REACTOR_KEY_ID} from '../src/world/reactor/restartLogic';
import {aimAt, buildRestart, fakeHost, reactorInfoFixture} from './helpers/reactorRestartFixture';
import {ReactorRestart} from '../src/world/reactor/restart';
import {REACTOR_AIR} from '../src/world/reactor/air';

interface Rec { core: number[]; tiers: [number, number][]; fans: [number, number][]; circuit: number[]; air: number[]; toasts: string[]; towers: number }
function recSink(): {sink: WinSink; rec: Rec} {
  const rec: Rec = {core: [], tiers: [], fans: [], circuit: [], air: [], toasts: [], towers: 0};
  return {rec, sink: {
    coreGlow: k => rec.core.push(k), tierPower: (l, k) => rec.tiers.push([l, k]), fanSpeed: (id, k) => rec.fans.push([id, k]),
    circuit: k => rec.circuit.push(k), clearAir: d => rec.air.push(d), toast: t => rec.toasts.push(t), towers: () => { rec.towers++; },
  }};
}

function fakeVisuals() {
  const calls = {core: [] as number[], tiers: [] as [number, number][], fans: [] as [number, number][]};
  const v: ReactorVisuals = {setCoreGlow: k => calls.core.push(k), setTierPower: (l, k) => calls.tiers.push([l, k]), setFanSpeed: (id, k) => calls.fans.push([id, k]), setGeneratorRunning: () => {}};
  return {v, calls};
}

const firstLit = (tiers: [number, number][]) => { const out: number[] = []; for (const [l, k] of tiers) if (k > 0 && !out.includes(l)) out.push(l); return out; };

afterEach(() => { setReactorVisuals(null); });

describe('win timeline', () => {
  const info = reactorInfoFixture();
  const plan = planWin(info.tiers, info.fans);

  it('orders the tiers bottom-up (core floor first) and ranks every fan with its tier', () => {
    expect(plan.tiers).toEqual([3, 2, 1, 0]);
    expect([...plan.fanRank.entries()]).toEqual([[0, 2], [1, 1], [2, 0], [3, 0]]);
    expect(tierStartAt(0, 4)).toBe(WIN.tierStartS);
    expect(tierStartAt(3, 4) + WIN.tierRampS).toBeCloseTo(WIN.tierStartS + WIN.tierSpanS, 6);
    expect(WIN.tierSpanS).toBeGreaterThanOrEqual(15); // "over ~20 s"
    expect(WIN.coreS).toBeGreaterThanOrEqual(5);
    expect(WIN.airDurationS).toBe(REACTOR_AIR.CLEAR_ALL_S); // the same whole-pit clearing AIR resumes on a rebuild
  });

  it('steps: core ramps first, tiers light bottom-up, fans only go up (to 1, once each), clearAll once, each toast once', () => {
    const {sink, rec} = recSink();
    const w = new WinSequence(plan, sink);
    let lastCirc = 0;
    for (let t = 0; t < winDoneAt(4) + 3; t += 0.05) {
      w.step(0.05);
      const c = circuitAt(w.t, 4);
      expect(c).toBeGreaterThanOrEqual(lastCirc - 1e-9); // the light only ever rises
      lastCirc = c;
    }
    expect(w.done).toBe(true);
    expect(rec.core[rec.core.length - 1]).toBe(1);
    expect(rec.core.every((k, i) => i === 0 || k >= rec.core[i - 1])).toBe(true);
    expect(firstLit(rec.tiers)).toEqual([3, 2, 1, 0]);
    for (const l of [0, 1, 2, 3]) expect(rec.tiers.filter(x => x[0] === l).pop()![1]).toBe(1);
    expect(rec.fans.map(f => f[1])).toEqual([1, 1, 1, 1]);
    expect(rec.fans.map(f => f[0]).sort()).toEqual([0, 1, 2, 3]);
    expect(rec.fans.slice(0, 2).map(f => f[0]).sort()).toEqual([2, 3]); // the core floor's fans first
    expect(rec.air).toEqual([WIN.airDurationS]);
    expect(rec.toasts).toEqual([WIN_TEXT.restarted, WIN_TEXT.allOnline]);
    expect(rec.circuit[rec.circuit.length - 1]).toBe(1);
    expect(w.towerStates()).toEqual(VENT_TOWERS.map(() => 'online'));
    expect(towersDoneAt()).toBeLessThanOrEqual(winDoneAt(4));
    // bounded calls: a long sequence sends a few hundred values, not one per frame per tier
    expect(rec.tiers.length).toBeLessThan(4 * 120);
  });

  it('finish() jumps to the end state without toasts (clearAir sent once if never sent)', () => {
    const {sink, rec} = recSink();
    const w = new WinSequence(plan, sink);
    w.finish();
    expect(rec.core).toEqual([1]);
    expect(rec.tiers.map(t => t[1])).toEqual([1, 1, 1, 1]);
    expect(rec.fans).toHaveLength(4);
    expect(rec.air).toEqual([WIN.airDurationS]);
    expect(rec.toasts).toEqual([]);
    expect(rec.circuit).toEqual([1]);
    expect(w.done).toBe(true);
  });

  it('the surface towers power one by one (standby -> power received -> online)', () => {
    const {sink} = recSink();
    const w = new WinSequence(plan, sink);
    w.step(WIN.towerStartS + 0.1);
    expect(w.towerStates()).toEqual(['power', 'standby', 'standby', 'standby', 'standby', 'standby']);
    w.step(WIN.towerSpinS);
    expect(w.towerStates().slice(0, 2)).toEqual(['online', 'power']);
  });
});

describe('win in the runtime (fake host)', () => {
  function restartAll(h: ReturnType<typeof fakeHost>, rt: ReturnType<typeof buildRestart>): void {
    h.inv.add(h.inv.makeStack(FUSE_CARTRIDGE_ID, 2));
    h.inv.add(h.inv.makeStack(REACTOR_KEY_ID, 1));
    for (const id of ['fuse-0', 'fuse-1', 'breaker', 'valve', 'pump', 'keyswitch'] as const) expect(rt.qaOperate(id).ok, id).toBe(true);
    // the rods: a real 4 s hold of E while looking at the rod control
    aimAt(h, rt, 'rods');
    h.keys.add('KeyE');
    expect(rt.interact()).toBe(true);
    for (let i = 0; i < 41; i++) rt.frame(0.1);
    h.keys.delete('KeyE');
  }

  it('the rods start the sequence: tiers bottom-up through ARCH, circuit 2 ramps, clearAll once, milestone once, run continues', () => {
    const {v, calls} = fakeVisuals();
    setReactorVisuals(v);
    const air: number[] = [];
    const h = fakeHost();
    const rt = buildRestart(h);
    rt.clearAir = d => { air.push(d); return true; };
    let milestones = 0;
    rt.recordMilestone = () => { milestones++; return true; };
    expect(h.lightPool.circuitLevel).toEqual([null, null, 0]); // powered fixtures dark until the restart
    expect(calls.core).toEqual([0]);
    expect(calls.tiers.map(t => t[1])).toEqual([0, 0, 0, 0]);
    restartAll(h, rt);
    expect(rt.state!.restarted).toBe(true);
    expect(rt.win).not.toBeNull();
    for (let i = 0; i < 400; i++) rt.frame(0.1);
    expect(rt.win!.done).toBe(true);
    expect(firstLit(calls.tiers)).toEqual([3, 2, 1, 0]);
    expect(calls.core[calls.core.length - 1]).toBe(1);
    expect(h.lightPool.circuitLevel![2]).toBe(1);
    expect(air).toEqual([WIN.airDurationS]);
    expect(milestones).toBe(1);
    expect(rt.counts.milestones).toBe(1);
    expect(h.toasts.map(t => t.text)).toEqual(expect.arrayContaining([WIN_TEXT.restarted, WIN_TEXT.allOnline]));
    expect(h.toasts.filter(t => t.text === WIN_TEXT.restarted)).toHaveLength(1);
    expect(h.state).toBe('playing'); // no forced end / reset
    // rods done: pressing again only reports
    aimAt(h, rt, 'rods');
    expect(rt.interact()).toBe(true);
    expect(milestones).toBe(1);
  });

  it("audio through the lead's Sfx machine API: one-shots per control, ONE core hum loop (re-requested until audio runs)", () => {
    const cues: string[] = [];
    let loops = 0, audioUp = false;
    const handle = {playing: true, setPos() {}, stop() { handle.playing = false; }};
    const h = fakeHost();
    h.sfx = {reactorCue: (c: string) => { cues.push(c); }, reactorLoop: (c: string) => { loops++; expect(c).toBe('reactorHum'); return audioUp ? handle : null; }};
    const rt = buildRestart(h);
    rt.clearAir = () => true;
    restartAll(h, rt);
    expect(cues).toEqual(['reactorFuse', 'reactorFuse', 'reactorBreaker', 'reactorValve', 'reactorPump', 'reactorStartup']);
    for (let i = 0; i < 40; i++) rt.frame(0.1); // audio not running: re-requested about once a second
    expect(loops).toBeGreaterThanOrEqual(2);
    expect(loops).toBeLessThanOrEqual(5);
    audioUp = true;
    for (let i = 0; i < 40; i++) rt.frame(0.1);
    const n = loops;
    for (let i = 0; i < 100; i++) rt.frame(0.1);
    expect(loops).toBe(n); // one handle kept
    rt.teardown();
    expect(handle.playing).toBe(false);
  });

  it("lane AIR's clearAll is retried until AIR's air exists, then called exactly once", () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    const air: number[] = [];
    let built = false;
    rt.clearAir = d => { if (!built) return false; air.push(d); return true; };
    restartAll(h, rt);
    for (let i = 0; i < 100; i++) rt.frame(0.1); // past WIN.airAtS, AIR not built yet
    expect(air).toEqual([]);
    built = true;
    for (let i = 0; i < 10; i++) rt.frame(0.1);
    expect(air).toEqual([WIN.airDurationS]);
    expect(rt.counts.airCalls).toBe(1);
  });

  it('a rebuilt restarted world: end state at once (no replay, no toasts, no second milestone), ARCH re-applied when it registers late', () => {
    const h = fakeHost();
    const rt = buildRestart(h);
    restartAll(h, rt);
    for (let i = 0; i < 50; i++) rt.frame(0.1); // travel away mid-sequence
    rt.teardown();
    const h2 = fakeHost(h.run, h.inv);
    const air: number[] = [];
    const rt2 = new ReactorRestart(h2).install();
    rt2.clearAir = d => { air.push(d); return true; };
    for (const s of h2.sectionHooks) s.build?.(h2.layout);
    let milestones = 0;
    rt2.recordMilestone = () => { milestones++; return true; };
    expect(rt2.state!.restarted).toBe(true);
    expect(rt2.win!.done).toBe(true);
    expect(h2.lightPool.circuitLevel).toEqual([null, null, 1]);
    for (let i = 0; i < 5; i++) rt2.frame(0.1);
    expect(air).toEqual([]); // AIR resumes its own whole-pit clearing from the stored restartedAt
    const {v, calls} = fakeVisuals();
    setReactorVisuals(v); // ARCH's build after ours
    rt2.frame(0.016);
    expect(calls.core).toEqual([1]);
    expect(calls.tiers.map(t => t[1])).toEqual([1, 1, 1, 1]);
    expect(calls.fans.map(f => f[1])).toEqual([1, 1, 1, 1]);
    expect(h2.toasts).toEqual([]);
    expect(milestones).toBe(0);
    // the switch keeps the key, the bays keep their cartridges
    const key = rt2.root!.getObjectByName('inserted-key')!;
    expect(key.visible).toBe(true);
    const seated: boolean[] = [];
    rt2.root!.traverse(o => { if (o.name === 'seated-cartridge') seated.push(o.visible); });
    expect(seated).toEqual([true, true]);
  });
});
