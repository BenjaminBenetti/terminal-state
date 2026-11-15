// Task frame-budget-deferral-20261030 (lane MEASURE): the opt-in frame profiler (debug/updateProfile.ts) — off it is inert
// (no clock read, no write), on it tiles a frame into laps + nested spans in fixed typed arrays, and its read-out (per-span
// avg / p95 / max / frames / calls / share, the slowest frames with their dominant spans) is exact on a controlled clock.

import {afterEach, describe, expect, it, vi} from 'vitest';
import {HOOK_SLOTS, PARENT, S, SPAN_ABOUT, SPAN_COUNT, UpdateProfiler} from '../src/debug/updateProfile';

let clock = 0;
const useClock = () => vi.spyOn(performance, 'now').mockImplementation(() => clock);
afterEach(() => { vi.restoreAllMocks(); });

/** One synthetic play frame: input 1 ms, ai 2 ms (vocal 0.5, two brains 0.6 each with a 0.4 ms path in the first), hooks
 *  (hook0 0.25), render.cull 0.1, render.draw 3 ms, + `extraAi` ms of path in the second brain. */
function frame(p: UpdateProfiler, extraAi = 0): void {
  p.frameBegin();
  clock += 0.2; // idle
  p.lap(S.input); clock += 1;
  p.lap(S.ai);
  p.begin(S.vocal); clock += 0.5; p.end(S.vocal);
  p.begin(S.brain); p.begin(S.path); clock += 0.4; p.end(S.path); clock += 0.2; p.end(S.brain);
  p.begin(S.brain); p.begin(S.path); clock += extraAi; p.end(S.path); clock += 0.6; p.end(S.brain);
  clock += 0.3; // ai rest
  p.lap(S.hooks); p.begin(S.hook0); clock += 0.25; p.end(S.hook0);
  p.lap(S.cull); clock += 0.1;
  p.lap(S.draw); clock += 3;
  p.frameEnd();
}

describe('update profiler: off = inert', () => {
  it('reads no clock and writes nothing while off (every call is one boolean check)', () => {
    const spy = useClock();
    const p = new UpdateProfiler(16);
    for (let k = 0; k < 50; k++) frame(p, 1);
    expect(spy).not.toHaveBeenCalled();
    expect(p.count).toBe(0);
    expect(p.ms.every(v => v === 0) && p.total.every(v => v === 0) && p.calls.every(v => v === 0)).toBe(true);
    expect(p.report().frames).toBe(0);
  });

  it('costs next to nothing off (2 M span calls well under 100 ms on any CI machine)', () => {
    const p = new UpdateProfiler(16);
    const t0 = Date.now();
    for (let k = 0; k < 500_000; k++) { p.frameBegin(); p.lap(S.ai); p.begin(S.path); p.end(S.path); p.frameEnd(); }
    expect(Date.now() - t0).toBeLessThan(100);
    expect(p.count).toBe(0);
  });
});

describe('update profiler: on', () => {
  it('tiles the frame into laps, nests spans, counts calls; no per-frame allocation of its arrays', () => {
    useClock();
    const p = new UpdateProfiler(8);
    const arrays = [p.ms, p.calls, p.total];
    p.startRecording();
    frame(p, 0);
    expect(p.count).toBe(1);
    const o = 0 * SPAN_COUNT;
    expect(p.total[0]).toBeCloseTo(0.2 + 1 + 0.5 + 0.6 + 0.6 + 0.3 + 0.25 + 0.1 + 3, 5);
    expect(p.ms[o + S.idle]).toBeCloseTo(0.2, 5);
    expect(p.ms[o + S.input]).toBeCloseTo(1, 5);
    expect(p.ms[o + S.ai]).toBeCloseTo(2.0, 5); // inclusive of its nested spans
    expect(p.ms[o + S.vocal]).toBeCloseTo(0.5, 5);
    expect(p.ms[o + S.brain]).toBeCloseTo(1.2, 5);
    expect(p.ms[o + S.path]).toBeCloseTo(0.4, 5);
    expect(p.calls[o + S.path]).toBe(2);
    expect(p.calls[o + S.brain]).toBe(2);
    expect(p.ms[o + S.hooks]).toBeCloseTo(0.25, 5);
    expect(p.ms[o + S.hook0]).toBeCloseTo(0.25, 5);
    expect(p.ms[o + S.draw]).toBeCloseTo(3, 5);
    // the laps (top-level spans) sum to the frame
    let laps = 0;
    for (let id = 0; id < SPAN_COUNT; id++) if (PARENT[id] < 0) laps += p.ms[o + id];
    expect(laps).toBeCloseTo(p.total[0], 5);
    for (let k = 0; k < 40; k++) frame(p, k % 7 === 3 ? 12 : 0);
    expect([p.ms, p.calls, p.total]).toEqual(arrays);
    expect(p.ms).toBe(arrays[0]);
    expect(p.count).toBe(8); // ring capacity
  });

  it('reports avg / p95 / max / frames / calls / share over a window and the spike frames with their dominant spans', () => {
    useClock();
    const p = new UpdateProfiler(100);
    p.hookNames = ['injuries', 'gear'];
    p.startRecording();
    for (let k = 0; k < 20; k++) frame(p, k === 13 ? 25 : 0); // frame 13: a 25 ms path search
    const r = p.report();
    expect(r.frames).toBe(20);
    const span = (n: string) => r.spans.find(s => s.name === n)!;
    expect(span('ai.path').count).toBe(40);
    expect(span('ai.path').frames).toBe(20);
    expect(span('ai.path').max).toBeCloseTo(25.4, 4);
    expect(span('ai.path').avg).toBeCloseTo((0.4 * 20 + 25) / 20, 4);
    expect(span('ai.path').parent).toBe('ai.brain');
    expect(span('render.draw').p95).toBeCloseTo(3, 4);
    expect(span('hook.injuries').avg).toBeCloseTo(0.25, 4);
    expect(span('hook.injuries').parent).toBe('hooks');
    expect(r.spans.some(s => s.name === 'hook.gear')).toBe(true); // named, even with no calls
    expect(r.spans.some(s => s.name.startsWith('hook.2'))).toBe(false); // unnamed and unused: omitted
    const shares = r.spans.filter(s => s.parent === null).reduce((a, s) => a + s.share, 0);
    expect(shares).toBeCloseTo(1, 6);
    // the slowest frame: 6 frames ago (newest = 19), dominated by the path search
    expect(r.spikes[0].age).toBe(6);
    expect(r.spikes[0].ms).toBeGreaterThan(30);
    expect(r.spikes[0].dominant[0].name).toBe('ai.path');
    expect(r.spikes[0].dominant[0].ms).toBeCloseTo(25.4, 4);
    expect(r.update.max).toBeCloseTo(1 + 2 + 25 + 0.25, 4);
    // window: the newest 5 frames do not contain the spike
    const w = p.report({window: 5});
    expect(w.frames).toBe(5);
    expect(w.spans.find(s => s.name === 'ai.path')!.max).toBeCloseTo(0.4, 4);
  });

  // Task studio-baked-gi-visual-uplift-20261115-004324-01: the glass mirror's own scene draw is a span inside the draw lap
  it('a spike frame with the glass mirror: the draw is listed without the mirror\'s share and the mirror on its own; with no mirror time it is plain render.draw', () => {
    useClock();
    const p = new UpdateProfiler(16);
    p.startRecording();
    /** A play frame: input 1 ms, then a draw lap of `draw` ms, `mirror` of them inside the mirror span (null: no mirror, no span). */
    const drawn = (draw: number, mirror: number | null) => {
      p.frameBegin();
      p.lap(S.input); clock += 1;
      p.lap(S.draw);
      if (mirror !== null) { p.begin(S.mirror); clock += mirror; p.end(S.mirror); }
      clock += draw - (mirror ?? 0);
      p.frameEnd();
    };
    drawn(9, 4); // a plane in view
    drawn(7, 0); // the station is lit with the mirror, no plane in view: one call, no time
    drawn(5, null); // no mirror at all
    const r = p.report();
    expect(r.spikes.map(s => [s.age, +s.ms.toFixed(4)])).toEqual([[2, 10], [1, 8], [0, 6]]); // slowest first
    const dominant = r.spikes.map(s => s.dominant.map(d => [d.name, +d.ms.toFixed(4), d.count]));
    expect(dominant[0]).toEqual([['render.draw (excl. mirror)', 5, 1], ['render.mirror', 4, 1], ['input', 1, 1]]);
    expect(dominant[1]).toEqual([['render.draw', 7, 1], ['input', 1, 1]]);
    expect(dominant[2]).toEqual([['render.draw', 5, 1], ['input', 1, 1]]);
    // the span table stays inclusive (the draw lap holds the mirror, which names it as its parent), and counts the mirror's calls
    const span = (n: string) => r.spans.find(s => s.name === n)!;
    expect(span('render.draw').max).toBeCloseTo(9, 4);
    expect(span('render.mirror')).toMatchObject({parent: 'render.draw', count: 2, frames: 2});
    expect(span('render.mirror').max).toBeCloseTo(4, 4);
    expect(PARENT[S.mirror]).toBe(S.draw);
    let laps = 0;
    for (let id = 0; id < SPAN_COUNT; id++) if (PARENT[id] < 0) laps += p.ms[id]; // (slot 0: the first frame) the mirror is not a lap
    expect(laps).toBeCloseTo(p.total[0], 5);
    expect(SPAN_ABOUT['render.mirror']).toBeTruthy();
    // a window in which the mirror never ran does not list its span
    p.reset();
    drawn(5, null);
    expect(p.report().spans.some(s => s.name === 'render.mirror')).toBe(false);
  });

  it('frames without a world update (menus / warm-up) are not recorded; stop / reset', () => {
    useClock();
    const p = new UpdateProfiler(10);
    p.startRecording();
    p.frameBegin(); p.lap(S.cull); clock += 2; p.lap(S.draw); clock += 2; p.frameEnd(); // a menu redraw: no 'input' lap
    expect(p.count).toBe(0);
    frame(p);
    expect(p.count).toBe(1);
    p.reset();
    expect(p.count).toBe(0);
    expect(p.on).toBe(true);
    p.stopRecording();
    frame(p);
    expect(p.count).toBe(0);
  });

  it('documents every top-level span and has room for the game frame hooks', () => {
    const p = new UpdateProfiler(4);
    for (let id = 0; id < S.hook0; id++) expect(SPAN_ABOUT[p.name(id)], p.name(id)).toBeTruthy();
    expect(HOOK_SLOTS).toBeGreaterThanOrEqual(7); // injuries, gear, gas mask, tower, office atmosphere, gas (+ QA walker)
  });
});
