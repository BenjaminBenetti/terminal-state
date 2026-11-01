// Task reactor-build-20261101 (lane AIR): the Reactor's DEPTH GAS model (world/reactor/air.ts) — strata monotonic + smooth with gentle
// banding; the shared render / exposure table; staged clearing timing (spool, three readable stages top-first, 45–60 s); persistence
// round trip through the run's REACTOR_LANE record (never re-rolls, never decreases); the RESTART win's clearAll; and the generator
// route's NO-DEADLOCK property (generator k stands in air below the damage threshold once the zones above are clear).
import {describe, expect, it} from 'vitest';
import {GAS} from '../src/world/gas/field';
import {CROUCH_EYE, STAND_EYE} from '../src/player/player';
import {GENERATOR_CLEAR_S, REACTOR_AIR, ReactorAir, clearAt, fanSpool, stageOf, stagedClear, stagedClearTime, terrace} from '../src/world/reactor/air';
import {emptyReactorState, loadReactorState} from '../src/world/reactor/runState';
import {fixtureInfo, type FixtureZone} from './reactor-air-fixture';

const RECT = {x0: 0, z0: 0, x1: 80, z1: 80};
const airOf = (info = fixtureInfo(), state = emptyReactorState(info.generators.length, info.zones.length)) => new ReactorAir(info, RECT, state);

/** Seeded random zone stacks (top-down, optional gaps, any concentrations) for property checks. */
function randomZones(seed: number): FixtureZone[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = 2 + Math.floor(rnd() * 3);
  const out: FixtureZone[] = [];
  let y = -(1 + rnd() * 5), c = 0.08 + rnd() * 0.2;
  for (let k = 0; k < n; k++) {
    const H = 5 + rnd() * 14, gap = rnd() < 0.3 ? rnd() * 3 : 0;
    const cTop = Math.max(0.05, c + (rnd() - 0.4) * 0.15), cBottom = Math.min(0.95, cTop + rnd() * 0.3);
    out.push({yTop: y, yBottom: y - H, cTop, cBottom});
    y -= H + gap;
    c = cBottom;
  }
  return out;
}

describe('reactor air: the strata (uncleared)', () => {
  it('0 above the top zone and outside the layout rect; thickening downward, monotonic, no hard steps, gentle bands', () => {
    const a = airOf(), Z = a.zones;
    expect(a.strataAt(0)).toBe(0);
    expect(a.strataAt(Z[0].yTop + 0.01)).toBe(0);
    expect(a.depthGasAt(40, 5, 40)).toBe(0);
    expect(a.depthGasAt(-1, -30, 40)).toBe(0);
    expect(a.depthGasAt(40, -30, 81)).toBe(0);
    let prev = 0, maxStep = 0;
    const dy = 0.02;
    for (let y = 0; y >= a.yLo; y -= dy) {
      const c = a.strataAt(y);
      expect(c, `monotonic at y ${y.toFixed(2)}`).toBeGreaterThanOrEqual(prev - 1e-9);
      maxStep = Math.max(maxStep, c - prev);
      prev = c;
    }
    // no hard steps: the steepest change is a gentle gradient (< 0.25 / m: the zone-top blends and the band slopes), never a jump
    expect(maxStep / dy).toBeLessThan(0.25);
    // it does thicken downward: thin under the rim, thick at the core floor
    expect(a.strataAt(Z[0].yTop - 3)).toBeLessThan(0.3);
    expect(a.strataAt(a.zones[Z.length - 1].yBottom + 0.5)).toBeGreaterThan(0.75);
    // gentle banding inside a zone: the local gradient varies (terraces), but never reverses
    const z = Z[1], grads: number[] = [];
    for (let t = 0.3; t < 0.98; t += 0.02) { // below the zone-top blend (TR)
      const y = z.yTop - t * z.H;
      grads.push((a.strataAt(y - 0.01) - a.strataAt(y + 0.01)) / 0.02);
    }
    const mean = (z.cBottom - z.cTop) / z.H;
    expect(Math.min(...grads)).toBeLessThan(0.5 * mean);
    expect(Math.max(...grads)).toBeGreaterThan(1.4 * mean);
    expect(Math.min(...grads)).toBeGreaterThanOrEqual(-1e-9);
  });

  it('terrace is monotonic and fixed at the zone ends; concentrations are made non-decreasing with depth', () => {
    expect(terrace(0)).toBe(0);
    expect(terrace(1)).toBeCloseTo(1, 12);
    for (let t = 0; t < 1; t += 0.001) expect(terrace(t + 0.001)).toBeGreaterThanOrEqual(terrace(t) - 1e-12);
    // a zone that would start thinner than the one above ends is lifted (thickening downward)
    const a = airOf(fixtureInfo({zones: [{yTop: -2, yBottom: -10, cTop: 0.2, cBottom: 0.6}, {yTop: -10, yBottom: -20, cTop: 0.3, cBottom: 0.4}]}));
    expect(a.zones[1].cTop).toBeCloseTo(0.6, 9);
    expect(a.zones[1].cBottom).toBeCloseTo(0.6, 9);
  });

  it('property: monotonic + continuous for random zone stacks (gaps, odd concentrations)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = airOf(fixtureInfo({zones: randomZones(seed)}));
      let prev = 0;
      for (let y = 0.5; y >= a.yLo; y -= 0.025) {
        const c = a.strataAt(y);
        expect(c, `seed ${seed} y ${y.toFixed(3)}`).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(c - prev, `seed ${seed} step at ${y.toFixed(3)}`).toBeLessThan(0.03);
        expect(c).toBeLessThanOrEqual(1);
        prev = c;
      }
    }
  });

  it('the render / exposure table follows the analytic strata (linear between TABLE_N samples) and depthGasAt reads it', () => {
    const a = airOf();
    expect(a.table.length).toBe(REACTOR_AIR.TABLE_N);
    expect(a.table[REACTOR_AIR.TABLE_N - 1]).toBe(0); // the top sample sits at the top zone's top
    let worst = 0;
    for (let y = a.yHi; y >= a.yLo; y -= 0.05) worst = Math.max(worst, Math.abs(a.tableAt(y) - a.strataAt(y)));
    expect(worst).toBeLessThan(0.012);
    expect(a.depthGasAt(40, -30, 40)).toBe(a.tableAt(-30));
    expect(a.depthGasAt(1, -30, 79)).toBe(a.tableAt(-30)); // stratified by depth only (rooms cut into the rock too)
    const t = a.renderTable();
    expect(t.yLo).toBe(a.yLo);
    expect(t.yHi).toBe(a.yHi);
    expect(t.rect).toEqual(RECT);
  });
});

describe('reactor air: staged clearing', () => {
  it('timing: crank -> 8 s fan spool -> three stages (ramp 12 s, hold 6 s) -> clear in 45–60 s', () => {
    const A = REACTOR_AIR, t0 = A.CRANK_S + A.SPOOL_S;
    expect(GENERATOR_CLEAR_S).toBeGreaterThanOrEqual(45);
    expect(GENERATOR_CLEAR_S).toBeLessThanOrEqual(60);
    expect(fanSpool(0)).toBe(0);
    expect(fanSpool(A.CRANK_S)).toBe(0);
    expect(fanSpool(A.CRANK_S + A.SPOOL_S / 2)).toBeCloseTo(0.5, 6);
    expect(fanSpool(t0)).toBe(1);
    expect(stagedClear(t0)).toBe(0);
    expect(stagedClear(t0 + A.STAGE_RAMP_S)).toBeCloseTo(1 / 3, 9);
    expect(stagedClear(t0 + A.STAGE_RAMP_S + A.STAGE_HOLD_S)).toBeCloseTo(1 / 3, 9); // a readable hold
    expect(stagedClear(t0 + 2 * A.STAGE_RAMP_S + A.STAGE_HOLD_S)).toBeCloseTo(2 / 3, 9);
    expect(stagedClear(GENERATOR_CLEAR_S)).toBe(1);
    expect(stagedClear(GENERATOR_CLEAR_S + 1000)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= GENERATOR_CLEAR_S + 2; t += 0.05) { const f = stagedClear(t); expect(f).toBeGreaterThanOrEqual(prev - 1e-12); prev = f; }
    expect([0, 0.2, 1 / 3, 0.5, 2 / 3, 0.9, 1].map(stageOf)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    for (const f of [0.05, 0.3, 0.5, 0.8, 0.99]) expect(stagedClear(stagedClearTime(f))).toBeCloseTo(f, 4);
  });

  it('space: the top of the zone clears first, then down (after stage 1 the top third is clean, the bottom still full)', () => {
    expect(clearAt(0.5, 0)).toBe(0);
    expect(clearAt(0.5, 1)).toBe(1);
    // zone 0 (clean air above it: no feathering from an uncleared zone)
    const info = fixtureInfo(), st = emptyReactorState(3, 3), a = airOf(info, st), z = a.zones[0];
    st.generators[0] = {started: true, startedAt: 100};
    const t0 = 100 + REACTOR_AIR.CRANK_S + REACTOR_AIR.SPOOL_S;
    a.update(t0 + REACTOR_AIR.STAGE_RAMP_S + 1); // inside the first hold
    expect(st.zoneClear[0]).toBeCloseTo(1 / 3, 6);
    const yAt = (t: number) => z.yTop - t * z.H;
    expect(a.tableAt(yAt(0.15))).toBeLessThan(0.01);
    expect(a.tableAt(yAt(0.25))).toBeLessThan(0.05);
    expect(a.tableAt(yAt(0.6))).toBeGreaterThan(0.95 * a.strataAt(yAt(0.6)));
    expect(a.tableAt(yAt(0.95))).toBeGreaterThan(0.95 * a.strataAt(yAt(0.95)));
    // the other zones are untouched
    expect(st.zoneClear[1]).toBe(0);
    expect(st.zoneClear[2]).toBe(0);
    // stage 2: the middle third follows, the bottom still full
    a.update(t0 + 2 * REACTOR_AIR.STAGE_RAMP_S + REACTOR_AIR.STAGE_HOLD_S + 1);
    expect(st.zoneClear[0]).toBeCloseTo(2 / 3, 6);
    expect(a.tableAt(yAt(0.5))).toBeLessThan(0.01);
    expect(a.tableAt(yAt(0.92))).toBeGreaterThan(0.9 * a.strataAt(yAt(0.92)));
    a.update(100 + GENERATOR_CLEAR_S);
    expect(st.zoneClear[0]).toBe(1);
    for (let t = 0.02; t <= 1; t += 0.05) expect(a.tableAt(yAt(t)), `t ${t}`).toBeLessThan(0.01);
    // a cleared zone below an uncleared one: the gas above feathers into its top TR metres only (smooth, no step), clear below
    const st2 = emptyReactorState(3, 3), b = airOf(info, st2), z2 = b.zones[2];
    st2.zoneClear[2] = 1;
    b.update(0, true);
    expect(b.tableAt(z2.yTop - 0.1)).toBeGreaterThan(GAS.THRESHOLD);
    for (let y = z2.yTop - z2.TR - 0.8; y > z2.yBottom; y -= 0.5) expect(b.tableAt(y)).toBeLessThan(0.01);
  });

  it('the table is rebuilt (version++) only when a fraction moved; nothing changes while nothing runs', () => {
    const st = emptyReactorState(3, 3), a = airOf(fixtureInfo(), st);
    const v = a.version;
    for (let t = 0; t < 100; t += 1) expect(a.update(t)).toBe(false);
    expect(a.version).toBe(v);
    st.generators[0] = {started: true, startedAt: 0};
    expect(a.update(5)).toBe(false); // spooling: the air has not moved yet
    expect(a.update(15)).toBe(true);
    expect(a.version).toBe(v + 1);
  });

  it('persistence: the REACTOR_LANE record round trip replays from startedAt / the saved fraction — no re-roll, no decrease, no re-spool', () => {
    const info = fixtureInfo(), st = emptyReactorState(3, 3), a = airOf(info, st);
    st.generators[1] = {started: true, startedAt: 50};
    a.update(50 + 30);
    const f = st.zoneClear[1];
    expect(f).toBeGreaterThan(0.3);
    expect(f).toBeLessThan(0.7);
    // through the run lane store as plain data (JSON) and back
    const back = loadReactorState(JSON.parse(JSON.stringify(st)), 3, 3);
    const b = airOf(info, back);
    expect(b.clearOf(1)).toBeCloseTo(f, 9); // the saved fraction at once (no re-spool from zero)
    b.update(50 + 30);
    expect(Array.from(b.table)).toEqual(Array.from(a.table));
    b.update(50 + 45);
    expect(back.zoneClear[1]).toBeGreaterThan(f);
    // a saved fraction never decreases even if its start time were lost
    const lost = loadReactorState({...JSON.parse(JSON.stringify(st)), generators: []}, 3, 3);
    const c = airOf(info, lost);
    c.update(1e6);
    expect(lost.zoneClear[1]).toBeCloseTo(f, 9);
    // garbage / foreign records load as clean state
    expect(loadReactorState({v: 2, zoneClear: [1, 1, 1]}, 3, 3).zoneClear).toEqual([0, 0, 0]);
    expect(loadReactorState({v: 1, zoneClear: [7, -3, 'x']}, 3, 3).zoneClear).toEqual([1, 0, 0]);
  });

  it('clearAll (the RESTART win): every zone -> 1 over the duration, monotonic with the staged clearing, then ends itself', () => {
    const st = emptyReactorState(3, 3), a = airOf(fixtureInfo(), st);
    st.generators[0] = {started: true, startedAt: 0};
    a.update(30);
    const f0 = st.zoneClear[0];
    a.clearAll(20, 30);
    expect(a.clearingAll).toBe(true);
    a.update(40);
    expect(st.zoneClear[0]).toBeGreaterThanOrEqual(f0);
    expect(st.zoneClear[2]).toBeCloseTo(0.5, 6);
    a.update(50);
    expect(st.zoneClear).toEqual([1, 1, 1]);
    expect(a.clearingAll).toBe(false);
    expect(Math.max(...a.table)).toBe(0); // the pit is clear
  });
});

describe('reactor air: the generator route never deadlocks', () => {
  /** Zones < k cleared, zones >= k uncleared. */
  const clearedAbove = (n: number, k: number) => { const st = emptyReactorState(n, n); for (let i = 0; i < k; i++) st.zoneClear[i] = 1; return st; };

  it('fixture: generator k (on a deck of zone k-1, the rim for k = 0) breathes below the damage threshold standing or crouched', () => {
    const info = fixtureInfo();
    for (const g of info.generators) {
      const k = g.zone, a = new ReactorAir(info, RECT, clearedAbove(info.zones.length, k));
      a.update(0, true);
      for (const eye of [STAND_EYE, CROUCH_EYE, 0.3]) {
        const c = a.depthGasAt(g.use.x, g.y + eye, g.use.z);
        expect(c, `generator ${g.id} eye +${eye}`).toBeLessThan(GAS.THRESHOLD);
        expect(c).toBeLessThan(GAS.HUD_MIN); // not even the warning
      }
      // and the zone below is genuinely toxic (the generator matters)
      expect(a.depthGasAt(g.use.x, info.zones[k].yBottom + 1, g.use.z)).toBeGreaterThan(GAS.THRESHOLD);
    }
  });

  it('property: random stacks / deck heights / pit depths — a deck anywhere in zone k-1 (or on its boundary) is safe once zones < k clear', () => {
    let checks = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const zones = randomZones(seed * 7919);
      for (let k = 0; k < zones.length; k++) {
        for (const u of [0, 0.37, 0.81, 1]) {
          // deck of generator k: the rim (k = 0) or a height inside zone k-1's band (u = 1: on the boundary with zone k)
          const deck = k === 0 ? 0 : zones[k - 1].yTop - u * (zones[k - 1].yTop - zones[k - 1].yBottom);
          const decks = zones.map((z, i) => (i === k - 1 ? deck : z.yTop - 1));
          const info = fixtureInfo({zones, decks});
          const a = new ReactorAir(info, RECT, clearedAbove(zones.length, k));
          a.update(0, true);
          const g = info.generators[k];
          for (const eye of [STAND_EYE, CROUCH_EYE]) expect(a.depthGasAt(g.use.x, g.y + eye, g.use.z), `seed ${seed} k ${k} u ${u}`).toBeLessThan(GAS.THRESHOLD);
          checks++;
        }
      }
    }
    expect(checks).toBeGreaterThan(400);
  });
});
