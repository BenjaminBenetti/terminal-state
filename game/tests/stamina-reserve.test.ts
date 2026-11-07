// Task studio-alpha-survival-controls-20261107-060450-01 (user: "Increase player stamina 25 %"): the sprint RESERVE is 125 units (was 100)
// at the same flow — 24 units / s while sprinting, 18 units / s recovery after 0.9 s, 15 units to start a sprint — so a full sprint lasts
// 25 % longer (4.17 s -> 5.21 s) and nothing becomes unlimited. The meter (`stamina`) stays a 0-100 % fill of that reserve: the HUD bar,
// the saves (validated 0..100: an old save keeps its fraction) and the breathing cue read it unchanged.
import {describe, expect, it} from 'vitest';
import {
  Player, SPRINT_SPEED, STAMINA_CAPACITY, STAMINA_PCT_PER_UNIT, STAMINA_REGEN, STAMINA_REGEN_DELAY, STAMINA_SPRINT_DRAIN, STAMINA_SPRINT_START, type MoveInput,
} from '../src/player/player';
import {FLOOR, Grid} from '../src/gen/grid';

class Keys implements MoveInput {
  held = new Set<string>();
  taps = new Set<string>();
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.taps.has(c); }
}

function hall(): Grid {
  const g = new Grid(40, 400);
  for (let y = 2; y < 398; y++) for (let x = 2; x < 38; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.ceil[i] = 3; }
  return g;
}
const opts = {aiming: false, speedMult: 1, canSprint: true};
const DT = 1 / 120;

describe('stamina: a 25 % larger sprint reserve, the same flow', () => {
  it('the reserve and its rates', () => {
    expect(STAMINA_CAPACITY).toBe(125);
    expect([STAMINA_SPRINT_DRAIN, STAMINA_REGEN, STAMINA_REGEN_DELAY, STAMINA_SPRINT_START]).toEqual([24, 18, 0.9, 15]);
    expect(STAMINA_PCT_PER_UNIT).toBeCloseTo(0.8, 12);
  });

  it('a full sprint lasts 125 / 24 = 5.21 s (was 4.17 s), then recovers to full in 125 / 18 = 6.94 s after the 0.9 s pause', () => {
    const g = hall(), p = new Player(), k = new Keys();
    p.spawn(10, 195, 0); // facing -Z down the long hall
    expect(p.stamina).toBe(100);
    k.held.add('KeyW'); k.held.add('ShiftLeft');
    let t = 0, peak = 0;
    p.update(DT, k, g, null, opts); t += DT;
    expect(p.sprinting).toBe(true);
    while (p.sprinting && t < 20) { p.update(DT, k, g, null, opts); t += DT; peak = Math.max(peak, p.speed); }
    expect(t).toBeCloseTo(STAMINA_CAPACITY / STAMINA_SPRINT_DRAIN, 1); // 5.21 s
    expect(t / (100 / STAMINA_SPRINT_DRAIN)).toBeCloseTo(1.25, 1); // +25 % over the former 100-unit reserve
    expect(peak).toBeLessThanOrEqual(SPRINT_SPEED + 1e-6); // the sprint itself is not faster
    expect(p.stamina).toBe(0);
    // release: recovery waits the pause, then refills the bigger reserve at the same 18 units / s
    k.held.clear();
    let r = 0;
    while (p.stamina < 100 && r < 30) { p.update(DT, k, g, null, opts); r += DT; }
    expect(r).toBeCloseTo(STAMINA_REGEN_DELAY + STAMINA_CAPACITY / STAMINA_REGEN, 1); // 0.9 + 6.94 s
    expect(p.stamina).toBe(100); // the meter stays 0-100 %
  });

  it('a sprint starts only above 15 units (12 % of the meter); an exhausted sprint stops, nothing is unlimited', () => {
    const g = hall(), p = new Player(), k = new Keys();
    p.spawn(10, 195, 0);
    k.held.add('KeyW'); k.held.add('ShiftLeft');
    p.stamina = STAMINA_SPRINT_START * STAMINA_PCT_PER_UNIT - 0.1; // 11.9 %
    p.update(DT, k, g, null, opts);
    expect(p.sprinting).toBe(false);
    p.stamina = STAMINA_SPRINT_START * STAMINA_PCT_PER_UNIT + 0.1; // 12.1 %
    p.update(DT, k, g, null, opts);
    expect(p.sprinting).toBe(true);
    // per second of sprint: 24 units = 19.2 % of the meter (was 24 %)
    const s0 = p.stamina = 80;
    for (let i = 0; i < 120; i++) p.update(DT, k, g, null, opts);
    expect(s0 - p.stamina).toBeCloseTo(STAMINA_SPRINT_DRAIN * STAMINA_PCT_PER_UNIT, 1);
  });
});
