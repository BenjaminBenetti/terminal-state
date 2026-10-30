// Task gasmask-breach-20261030 (lane GAS): the local infectious gas field (world/gas/field.ts) and its exposure / persistence
// (world/gas/system.ts).
//  - synthetic storeys: the front leaves the pane and evolves over time (never instantly); walls, a sealed room, a neighbour
//    room reached only round the corridor and the other storeys are respected; the pool radius bounds an open plan and a
//    corridor-end window; overlapping breaches stay capped at 1 with no runaway, sleep at steady state and cost the same box;
//    the shared sampler (bilinear x height profile);
//  - the REAL generated office (gen/office): rooms with a breakable pane fill to ~0.8 in 25-40 s and the spill beyond their
//    doorways falls below 0.15 within ~3.5 m (the measured numbers are printed), no other storey ever gets gas;
//  - exposure: one damage calculation per frame from the eye concentration (threshold, dps, protection, never per breach,
//    never the hit pipeline), the HUD tag / hint / haze, persistence through RUN's lane store with a bounded fast-forward.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {GAS, GasField, gasProfile} from '../src/world/gas/field';
import {GasSystem, installGas, type GasHost} from '../src/world/gas/system';
import {WINDOWS_LANE, WindowBreaches, sourceCells} from '../src/world/windowBreach';
import {planWindows, type WindowPlan, type WindowView} from '../src/world/officeWindows';
import {readTowerInfo} from '../src/world/towerShared';
import {generateOfficeLevel} from '../src/gen/office/index';
import type {StationLayout} from '../src/gen/stationTypes';
import type {WorldHit} from '../src/combat/hitscan';

// ---------------------------------------------------------------------------------------------
// Synthetic storey (cells; CELL = 0.5 m):
//   room A   x 2..17, y 2..13  (8 x 6 m, area 0): the window wall is row 1 (solid), the pane's room-side cells y 2, x 6..9
//   wall     column x 18 with a doorway y 7..9 (1.5 m, area 1) into
//   corridor x 19..21, y 2..77 (1.5 x 38 m, area 1)
//   room B   x 2..17, y 15..26 (area 2): shares the solid row y 14 with room A, door only to the corridor at y 22..24
//   room C   x 2..17, y 28..36 (area 3): sealed (no opening at all)
//   open     x 24..83, y 2..41 (30 x 20 m open plan, area 4): its own window at y 2, x 50..53 — joined to the corridor at y 30..32
const W = 90, H = 80;
function storey(base: number, ceilH = 2.9): Grid {
  const g = new Grid(W, H);
  const carve = (x0: number, y0: number, x1: number, y1: number, area: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = area; g.floor[i] = base; g.ceil[i] = base + ceilH; }
  };
  carve(2, 2, 17, 13, 0);
  carve(18, 7, 18, 9, 1);
  carve(19, 2, 21, 77, 1);
  carve(2, 15, 17, 26, 2);
  carve(18, 22, 18, 24, 2);
  carve(2, 28, 17, 36, 3);
  carve(24, 2, 83, 41, 4);
  carve(22, 30, 23, 32, 4);
  return g;
}
const idx = (x: number, y: number) => y * W + x;
const PANE_A = [6, 7, 8, 9].map(x => idx(x, 2));
const PANE_OPEN = [50, 51, 52, 53].map(x => idx(x, 2));
const PANE_CORRIDOR_END = [19, 20, 21].map(x => idx(x, 77));
const run = (f: GasField, seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) f.tick(dt); };
const cAt = (f: GasField, level: number, x: number, y: number) => { const s = f.storey(level)!; return s.c[(y - s.oy) * s.dw + (x - s.ox)]; };
const meanOf = (f: GasField, level: number, pred: (x: number, y: number) => boolean) => {
  const s = f.storey(level)!; let t = 0, n = 0;
  for (let y = 0; y < s.dh; y++) for (let x = 0; x < s.dw; x++) if (s.open[y * s.dw + x] && pred(x + s.ox, y + s.oy)) { t += s.c[y * s.dw + x]; n++; }
  return n ? t / n : 0;
};
const maxOf = (f: GasField, level: number, pred: (x: number, y: number) => boolean) => {
  const s = f.storey(level)!; let m = 0;
  for (let y = 0; y < s.dh; y++) for (let x = 0; x < s.dw; x++) if (pred(x + s.ox, y + s.oy)) m = Math.max(m, s.c[y * s.dw + x]);
  return m;
};
const inA = (x: number, y: number) => x >= 2 && x <= 17 && y >= 2 && y <= 13;
const inB = (x: number, y: number) => x >= 2 && x <= 17 && y >= 15 && y <= 26;
const inC = (x: number, y: number) => x >= 2 && x <= 17 && y >= 28 && y <= 36;

function twoStoreys() {
  return [{id: 2, grid: storey(10)}, {id: 3, grid: storey(14.4)}];
}

describe('gas field: a breach fills its room over time, bounded by walls, storeys and the pool radius (synthetic storeys)', () => {
  it('the front leaves the pane and advances over seconds — never instantly; the room fills toward ~0.8+', () => {
    const f = new GasField(twoStoreys());
    expect(f.addBreach({id: 'a', level: 2, cells: PANE_A})).toBe(true);
    expect(f.storeys.map(s => s.level)).toEqual([2]);
    run(f, 0.5);
    expect(cAt(f, 2, 7, 3)).toBeGreaterThan(0.01); // gas at the pane after half a second
    expect(cAt(f, 2, 7, 10)).toBe(0); // 4 m into the room: nothing yet
    const means: number[] = [];
    let far = -1;
    for (let t = 1; t <= 40; t++) {
      run(f, 1);
      means.push(meanOf(f, 2, inA));
      if (far < 0 && cAt(f, 2, 15, 12) > 0.2) far = t; // the far corner (~6.5 m away)
    }
    for (let i = 1; i < means.length; i++) expect(means[i]).toBeGreaterThanOrEqual(means[i - 1] - 1e-6); // builds up monotonically
    expect(means[1]).toBeLessThan(0.15); // 2 s: a front, not a filled room
    expect(far).toBeGreaterThan(4);
    expect(far).toBeLessThan(25);
    expect(means[39]).toBeGreaterThan(0.8);
  });

  it('walls: a sealed room never gets gas; the neighbour room behind a shared wall gets only the faint spill round the corridor; the other storey none', () => {
    const f = new GasField(twoStoreys());
    f.addBreach({id: 'a', level: 2, cells: PANE_A});
    run(f, 120, 0.1);
    expect(maxOf(f, 2, inC)).toBe(0); // sealed: exactly nothing, though 7 m from the breach
    expect(maxOf(f, 2, inB)).toBeLessThan(0.05); // 0.5 m wall from room A, but ~8 m round through the corridor
    expect(meanOf(f, 2, inA)).toBeGreaterThan(0.8);
    expect(f.storey(3)).toBe(null); // storey 3 (same plan, straight above) has no field at all
    // the shared sampler: room A on storey 2 is gassed, the same column on storey 3 is clear
    expect(f.concentrationAt(4.5, 10 + 1.0, 4)).toBeGreaterThan(0.6);
    expect(f.concentrationAt(4.5, 14.4 + 1.0, 4)).toBe(0);
    // the spill down the corridor: < 0.15 within 3.5 m beyond the doorway (column x 18)
    const corridor = (y0: number) => maxOf(f, 2, (x, y) => x >= 19 && x <= 21 && Math.abs(y - 8) >= y0);
    expect(corridor(7)).toBeLessThan(0.15);
    expect(corridor(12)).toBeLessThan(0.03);
  });

  it('pool radius: an open-plan window fills ~10 walking metres of its space, not the floor; a corridor-end window fills ~10 m of the corridor', () => {
    const f = new GasField(twoStoreys());
    f.addBreach({id: 'open', level: 2, cells: PANE_OPEN});
    f.addBreach({id: 'end', level: 2, cells: PANE_CORRIDOR_END});
    run(f, 120, 0.1);
    const dPane = (x: number, y: number) => Math.hypot(x - 51.5, y - 2) * CELL;
    expect(meanOf(f, 2, (x, y) => x >= 24 && dPane(x, y) < 5)).toBeGreaterThan(0.7);
    expect(maxOf(f, 2, (x, y) => x >= 24 && dPane(x, y) > 15)).toBeLessThan(0.1);
    expect(maxOf(f, 2, (x, y) => x >= 24 && dPane(x, y) > 18)).toBeLessThan(0.02);
    // corridor end (y 77): ~10 m of the corridor fills; 3.5 m past the pool it is below 0.15
    const along = (y: number) => meanOf(f, 2, (x, yy) => x >= 19 && x <= 21 && yy === y);
    expect(along(74)).toBeGreaterThan(0.6);
    expect(along(77 - 20 - 7)).toBeLessThan(0.15);
    expect(along(77 - 20 - 14)).toBeLessThan(0.02);
  });

  it('overlapping breaches: capped at 1 (no stacking), no runaway; the field sleeps at steady state; cost tracks the active box, not the breach count', () => {
    const one = new GasField(twoStoreys()), two = new GasField(twoStoreys());
    one.addBreach({id: 'a', level: 2, cells: PANE_A});
    two.addBreach({id: 'a', level: 2, cells: PANE_A});
    two.addBreach({id: 'b', level: 2, cells: [10, 11, 12, 13].map(x => idx(x, 2))});
    two.addBreach({id: 'c', level: 2, cells: PANE_A}); // the same cells twice: still one source
    let peak = 0;
    for (let t = 0; t < 300; t++) { run(two, 1, 0.1); run(one, 1, 0.1); peak = Math.max(peak, two.storey(2)!.stats().max); }
    expect(peak).toBeLessThanOrEqual(GAS.CAP);
    const s1 = one.storey(2)!.stats(), s2 = two.storey(2)!.stats();
    expect(s2.poolMean).toBeGreaterThanOrEqual(s1.poolMean - 1e-6);
    expect(s2.poolMean).toBeLessThanOrEqual(1);
    expect(Math.abs(s2.poolMean - s1.poolMean)).toBeLessThan(0.1); // combine, never add
    // bounded: steady state reached and asleep (no ticks / uploads), the box stays the room + spill
    expect(s1.asleep && s2.asleep).toBe(true);
    const box = (b: [number, number, number, number]) => (b[2] - b[0] + 1) * (b[3] - b[1] + 1);
    expect(box(s2.box!)).toBeLessThanOrEqual(box(s1.box!) * 1.1);
    expect(box(s1.box!)).toBeLessThan(W * H / 3);
    two.drainChanged();
    run(two, 2, 0.1);
    expect(two.drainChanged()).toEqual([]); // asleep: nothing to upload
    two.addBreach({id: 'd', level: 2, cells: PANE_OPEN});
    expect(two.storey(2)!.asleep).toBe(false); // a new breach wakes it
  });

  it('fixed 10 Hz tick with stable substeps (3 per tick at D 1.6, dx 0.5); a long frame never catches up beyond 3 ticks', () => {
    expect(GasField.substeps(1 / GAS.TICK_HZ)).toBe(3);
    expect(GAS.D * (1 / GAS.TICK_HZ / 3) / (CELL * CELL)).toBeLessThan(0.25);
    const f = new GasField(twoStoreys());
    f.addBreach({id: 'a', level: 2, cells: PANE_A});
    expect(f.tick(0.05)).toBe(0);
    expect(f.tick(0.05)).toBe(1);
    expect(f.tick(5)).toBe(GAS.MAX_TICKS_PER_FRAME);
    expect(f.tick(0.05)).toBe(0); // the backlog was dropped
    // frame-rate independent: 30 fps and 144 fps give the same field
    const a = new GasField(twoStoreys()), b = new GasField(twoStoreys());
    a.addBreach({id: 'a', level: 2, cells: PANE_A}); b.addBreach({id: 'a', level: 2, cells: PANE_A});
    run(a, 10, 1 / 30); run(b, 10, 1 / 144);
    expect(Math.abs(meanOf(a, 2, inA) - meanOf(b, 2, inA))).toBeLessThan(0.02);
  });

  it('fast-forward (coarse steps) reproduces the ticked field', () => {
    const ticked = new GasField(twoStoreys()), ff = new GasField(twoStoreys());
    ticked.addBreach({id: 'a', level: 2, cells: PANE_A}); ff.addBreach({id: 'a', level: 2, cells: PANE_A});
    run(ticked, 40, 0.1);
    const t0 = performance.now();
    ff.advance(40);
    const ms = performance.now() - t0;
    expect(Math.abs(meanOf(ff, 2, inA) - meanOf(ticked, 2, inA))).toBeLessThan(0.03);
    expect(Math.abs(cAt(ff, 2, 18, 8) - cAt(ticked, 2, 18, 8))).toBeLessThan(0.05);
    expect(ms).toBeLessThan(2000);
  });

  it('shared sampler: bilinear between cell centres x the height profile (1 at the floor, 0.65 at the ceiling, nothing outside the band)', () => {
    const f = new GasField(twoStoreys());
    f.addBreach({id: 'a', level: 2, cells: PANE_A});
    run(f, 60, 0.1);
    const x = (4 + 0.5) * CELL, z = (6 + 0.5) * CELL, c = cAt(f, 2, 4, 6);
    expect(f.concentrationAt(x, 10, z)).toBeCloseTo(c, 5);
    expect(f.concentrationAt(x, 10 + 2.9, z)).toBeCloseTo(c * (1 - GAS.HEIGHT_FALLOFF), 5);
    expect(f.concentrationAt(x, 10 + 1.6, z)).toBeCloseTo(c * (1 - GAS.HEIGHT_FALLOFF * 1.6 / 2.9), 5);
    expect(f.concentrationAt(x, 10 + 3.2, z)).toBe(0);
    const mid = f.concentrationAt((5 + 0.5) * CELL - 0.25, 10, z);
    expect(mid).toBeCloseTo((cAt(f, 2, 4, 6) + cAt(f, 2, 5, 6)) / 2, 5);
    expect(gasProfile(11, 10, 12.9)).toBeCloseTo(1 - GAS.HEIGHT_FALLOFF / 2.9, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// The REAL generated office.

const office = new Map<number, StationLayout>();
const officeLevel = (seed: number) => { let l = office.get(seed); if (!l) office.set(seed, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'} as never))); return l; };

function officeField(L: StationLayout) {
  const info = readTowerInfo(L)!;
  const ex = info.exterior, shaft = L.office!.elevator.shaft;
  const domain = {x0: Math.floor(ex.x0 / CELL) - 1, y0: Math.floor(ex.z0 / CELL) - 1, x1: Math.ceil(ex.x1 / CELL) + 1, y1: Math.ceil(ex.z1 / CELL) + 1};
  const closed = (cx: number, cy: number) => { const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL; return x > shaft.x0 && x < shaft.x1 && z > shaft.z0 && z < shaft.z1; };
  return new GasField(L.levels.filter(l => l.id >= 1 && l.id <= 8).map(l => ({id: l.id, grid: l.grid})), {domain, closed});
}

describe('gas field on the REAL generated office: room fill time and spill beyond the doorways (measured)', () => {
  it('closed rooms with a breakable pane reach 0.8 in ~25-40 s; 3.5 m beyond their doorways the spill is < 0.15; no other storey', () => {
    const rows: string[] = [], fills: number[] = [];
    let rooms = 0;
    for (const seed of [12345, 777]) {
      const L = officeLevel(seed), info = readTowerInfo(L)!;
      const W8 = new WindowBreaches(planWindows(info));
      const seen = new Set<string>();
      for (const ref of W8.refs.values()) {
        if (ref.plan.level < 2 || ref.plan.level > 8) continue;
        const g = L.levels[ref.plan.level].grid, cells = sourceCells(ref, g);
        if (!cells.length) continue;
        const room = g.area[cells[0]], label = L.areas[room]?.label ?? '';
        // enclosed rooms (meeting, break, storage, exec ...): not the open plan / corridor / lobby spaces
        const roomCells: number[] = [];
        for (let i = 0; i < g.cells.length; i++) if (g.cells[i] !== SOLID && g.area[i] === room) roomCells.push(i);
        if (roomCells.length > 340 || /open|corridor|lobby|reception|studio|lounge/i.test(label) || seen.has(label)) continue;
        seen.add(label);
        const f = officeField(L);
        expect(f.addBreach({id: ref.id, level: ref.plan.level, cells})).toBe(true);
        const s = f.storey(ref.plan.level)!;
        const local = (gi: number) => s.c[s.local(gi)];
        const roomMean = () => roomCells.reduce((t, i) => t + local(i), 0) / roomCells.length;
        let t08 = -1;
        const at: Record<number, number> = {};
        for (let t = 1; t <= 90; t++) {
          run(f, 1, 0.1);
          const m = roomMean();
          if (t08 < 0 && m >= 0.8) t08 = t;
          if (t === 5 || t === 10 || t === 20) at[t] = m;
        }
        // walking distance (BFS, 4-neighbour) from the room through the gas-open cells outside it
        const dist = new Map<number, number>(roomCells.map(i => [i, 0]));
        let q = [...roomCells];
        for (let d = 1; q.length && d <= 30; d++) {
          const nq: number[] = [];
          for (const i of q) for (const j of [i - 1, i + 1, i - g.w, i + g.w]) {
            const lj = s.local(j);
            if (dist.has(j) || lj < 0 || !s.open[lj]) continue;
            dist.set(j, d); nq.push(j);
          }
          q = nq;
        }
        const spill = (m: number) => { let mx = 0; for (const [i, d] of dist) if (d * CELL >= m) mx = Math.max(mx, local(i)); return mx; };
        const s35 = spill(3.5), s2 = spill(2);
        const m90 = roomMean();
        rows.push(`seed ${seed} floor ${ref.plan.level} ${label.padEnd(34)} ${String(roomCells.length * 0.25).padStart(5)} m²  t(0.8)=${t08}s  5s ${at[5].toFixed(2)} 10s ${at[10].toFixed(2)} 20s ${at[20].toFixed(2)} 90s ${m90.toFixed(2)}  spill@2m ${s2.toFixed(3)} @3.5m ${s35.toFixed(3)}`);
        expect(s35, label).toBeLessThan(0.15); // every room: < 0.15 by 3.5 m beyond its doorways
        expect(f.storeys.map(x => x.level)).toEqual([ref.plan.level]); // never another storey
        // a semi-open bay (joined to an open plan by a wide opening) leaks most of its gas: a lower plateau by design
        if (/bay/i.test(label)) { expect(m90, label).toBeGreaterThan(0.1); continue; }
        // a small private office (< 25 m²) fills fast to the plateau its doorway allows (~0.8)
        if (roomCells.length < 100) { expect(m90, label).toBeGreaterThan(0.7); expect(at[5], label).toBeGreaterThan(0.1); continue; }
        expect(at[5], label).toBeLessThan(0.2); // a front at 5 s, not a filled room
        expect(t08, label).toBeGreaterThanOrEqual(20);
        expect(t08, label).toBeLessThanOrEqual(45);
        fills.push(t08);
        rooms++;
      }
    }
    fills.sort((a, b) => a - b);
    console.info(`gas fill / spill on generated offices (GAS.D ${GAS.D}, FILL_RATE ${GAS.FILL_RATE}, K_POOL ${GAS.K_POOL}, K_SPILL ${GAS.K_SPILL}, POOL_RADIUS_M ${GAS.POOL_RADIUS_M}):\n${rows.join('\n')}\n`
      + `rooms >= 25 m²: t(mean 0.8) min ${fills[0]} s, median ${fills[fills.length >> 1]} s, max ${fills[fills.length - 1]} s`);
    expect(rooms).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------------------------
// Exposure + persistence (GasSystem with a fake host on the real office).

function host(L: StationLayout) {
  const info = readTowerInfo(L)!;
  const plans: WindowPlan[] = planWindows(info);
  const view = {root: new THREE.Group(), glass: [], geometries: [], cracked: null, panes: new Map()} as unknown as WindowView;
  const store = new Map<string, unknown>();
  const layers: number[] = [];
  const hits: number[] = [];
  let clock = 0;
  const h = {
    // (a deep HP pool: ~6 hp/s in a filled room kills a 100 hp player; the death test sets 100)
    player: {x: 0, z: 0, y: 0, eye: 1.6, alive: true, hp: 1e6, takeDamage(a: number) { hits.push(a); this.hp -= a; if (this.hp <= 0) this.alive = false; }},
    layout: L,
    tower: {office: {info, windows: {plans, view}}},
    atmosphere: {active: true, setGasLayer: (slot: number) => { layers.push(slot); }},
    atmosphereBypass: null as string | null,
    run: {laneStore: (k: string) => store.get(k), setLaneStore: (k: string, v: unknown) => { if (v === undefined) store.delete(k); else store.set(k, structuredClone(v)); }},
    get clock() { return clock; },
    state: 'playing',
    frameHooks: [] as ((dt: number) => void)[],
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    stateListeners: [] as ((s: never, p: never) => void)[],
    bulletHitHandlers: [] as ((wh: WorldHit, p: THREE.Vector3, d: THREE.Vector3, shot: number) => boolean)[],
  };
  const step = (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) { clock += dt; for (const fn of h.frameHooks) fn(dt); } };
  return {h, store, layers, hits, step, plans};
}

/** A closed-room breakable pane of floor `level` (its gas fills the room) and a stand point in that room. */
function roomPane(L: StationLayout, sys: GasSystem, level: number) {
  for (const ref of sys.windows!.refs.values()) {
    if (ref.plan.level !== level) continue;
    const g = L.levels[level].grid, cells = sourceCells(ref, g);
    if (!cells.length) continue;
    const label = L.areas[g.area[cells[0]]]?.label ?? '';
    if (!/meeting|break|storage|exec|copy/i.test(label)) continue;
    const out = ref.plan.n[0] + ref.plan.n[1], a = (ref.pane.a0 + ref.pane.a1) / 2, c = ref.plan.inner - out * 1.5;
    return {ref, x: ref.plan.along === 'x' ? a : c, z: ref.plan.along === 'x' ? c : a, floor: L.levels[level].baseY};
  }
  throw new Error('no room pane');
}

describe('exposure: one damage calculation per frame from the eye concentration; protection; HUD; persistence', () => {
  it('below the threshold nothing; inside the gas dps = 8 · (c − 0.12) / 0.88 per frame via takeDamage once; protected: no damage, FILTERING', () => {
    const L = officeLevel(12345);
    const {h, hits, step} = host(L);
    const sys = installGas(h as unknown as GasHost);
    h.sectionHooks[0].build!(L);
    expect(sys.field).not.toBe(null);
    const p = roomPane(L, sys, 4);
    Object.assign(h.player, {x: p.x, z: p.z, y: p.floor, eye: p.floor + 1.6});
    expect(sys.breakPane(p.ref.id)).toBe(true);
    // the first frames: the gas has not reached the eye yet (never instant damage)
    step(0.5);
    expect(hits.length).toBe(0);
    expect(sys.exposure.c).toBeLessThan(GAS.THRESHOLD);
    step(40);
    const e = sys.exposure;
    expect(e.c).toBeGreaterThan(0.5);
    expect(e.dps).toBeCloseTo(GAS.DPS_MAX * Math.min(1, (e.c - GAS.THRESHOLD) / (1 - GAS.THRESHOLD)), 6);
    // exactly one takeDamage per frame while exposed, dps · dt each
    const before = hits.length;
    step(1);
    expect(hits.length - before).toBe(60);
    expect(hits[hits.length - 1]).toBeCloseTo(sys.exposure.dps / 60, 6);
    expect(sys.hud.shown.tag).toBe('TOXIC GAS');
    expect(sys.hud.shown.hint).toBe('Put on your gas mask (Q)');
    expect(sys.hud.shown.vignette).toBeGreaterThan(0);
    expect(sys.hud.shown.haze).toBe(0); // the volumetric gas is drawn: no screen haze
    // protected (mask on + filter > 0, wired by the primary): no damage, FILTERING
    sys.protection = () => true;
    const n = hits.length;
    step(2);
    expect(hits.length).toBe(n);
    expect(sys.exposure).toMatchObject({protected: true, dps: 0});
    expect(sys.hud.shown).toMatchObject({tag: 'FILTERING', vignette: 0});
    // volumetrics off: a haze proportional to the eye concentration (damage never comes from gas you cannot see)
    h.atmosphere.active = false;
    step(0.1);
    expect(sys.hud.shown.haze).toBeGreaterThan(0.2);
  });

  it('an unprotected 100 hp player standing in a filled room dies (~6 hp/s at eye height); the damage stops with death', () => {
    const L = officeLevel(12345);
    const {h, hits, step} = host(L);
    const sys = installGas(h as unknown as GasHost);
    h.sectionHooks[0].build!(L);
    const p = roomPane(L, sys, 4);
    Object.assign(h.player, {x: p.x, z: p.z, y: p.floor, eye: p.floor + 1.6, hp: 100});
    sys.breakPane(p.ref.id);
    let died = -1;
    for (let t = 0; t < 90 && died < 0; t += 0.5) { step(0.5); if (!h.player.alive) died = t; }
    expect(died).toBeGreaterThan(15); // the gas needs time to arrive and build up
    expect(died).toBeLessThan(60);
    const n = hits.length;
    step(2);
    expect(hits.length).toBe(n);
  });

  it('two overlapping breaches never double the damage: still ONE calculation per frame, capped by c ≤ 1', () => {
    const L = officeLevel(12345);
    const {h, hits, step} = host(L);
    const sys = installGas(h as unknown as GasHost);
    h.sectionHooks[0].build!(L);
    const p = roomPane(L, sys, 5);
    Object.assign(h.player, {x: p.x, z: p.z, y: p.floor, eye: p.floor + 1.0});
    sys.breakPane(p.ref.id);
    // a neighbour pane of the same span (same room) breaks too
    const other = [...sys.windows!.refs.values()].find(r => r.plan === p.ref.plan && r.id !== p.ref.id);
    if (other) sys.breakPane(other.id);
    step(60);
    const f0 = hits.length;
    step(1);
    expect(hits.length - f0).toBe(60);
    expect(Math.max(...hits)).toBeLessThanOrEqual(GAS.DPS_MAX / 60 + 1e-9);
    expect(sys.exposure.c).toBeLessThanOrEqual(1);
  });

  it('persistence: teardown saves panes + breach ages to the lane store; a rebuild restores looks and fast-forwards the gas (age capped at 90 s); a fresh run has none', () => {
    const L = officeLevel(12345);
    const {h, store, step} = host(L);
    const sys = installGas(h as unknown as GasHost);
    h.sectionHooks[0].build!(L);
    const p = roomPane(L, sys, 3);
    sys.breakPane(p.ref.id);
    const cracked = [...sys.windows!.refs.values()].find(r => r.plan.level === 6)!;
    sys.windows!.impact(cracked, 1, 0);
    step(30, 0.1);
    const live = sys.field!.storey(3)!.stats();
    h.sectionHooks[0].teardown!();
    expect(sys.field).toBe(null);
    const rec = store.get(WINDOWS_LANE) as {v: number; hits: Record<string, number>; broken: Record<string, number>};
    expect(rec.v).toBe(1);
    expect(rec.hits).toEqual({[cracked.id]: 1});
    expect(Object.keys(rec.broken)).toEqual([p.ref.id]);
    expect(rec.broken[p.ref.id]).toBeCloseTo(30, 0);
    // rebuild (Subway -> Office travel): restored at section build, the gas fast-forwarded by the breach age
    h.sectionHooks[0].build!(L);
    expect(sys.windows!.broken(p.ref.id)).toBe(true);
    expect(sys.windows!.state.get(cracked.id)?.hits).toBe(1);
    const back = sys.field!.storey(3)!.stats();
    expect(Math.abs(back.poolMean - live.poolMean)).toBeLessThan(0.05);
    expect(Math.abs(back.activeCells - live.activeCells)).toBeLessThan(live.activeCells * 0.1);
    // a long time away: the age is capped (bounded fast-forward)
    store.set(WINDOWS_LANE, {...rec, broken: {[p.ref.id]: 100000}});
    h.sectionHooks[0].teardown!();
    store.set(WINDOWS_LANE, {...rec, broken: {[p.ref.id]: 100000}});
    const t0 = performance.now();
    h.sectionHooks[0].build!(L);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect((store.get(WINDOWS_LANE) as typeof rec).broken[p.ref.id]).toBe(100000); // the stored record itself is untouched by a build
    h.sectionHooks[0].teardown!();
    expect((store.get(WINDOWS_LANE) as typeof rec).broken[p.ref.id]).toBeLessThanOrEqual(90);
    // NewGame = a fresh run (empty lane store): nothing broken, no gas
    store.clear();
    h.sectionHooks[0].build!(L);
    expect(sys.windows!.state.size).toBe(0);
    expect(sys.field!.storeys).toEqual([]);
  });

  it('the Subway (no office windows) is inert: no field, no handler claims a hit, no HUD', () => {
    const L = officeLevel(12345);
    const {h, step} = host(L);
    (h.tower as {office: unknown}).office = null;
    const sys = installGas(h as unknown as GasHost);
    h.sectionHooks[0].build!(L);
    expect(sys.field).toBe(null);
    const wh = {t: 1, kind: 'wall', nx: 0, ny: 0, nz: 1, level: 3} as WorldHit;
    expect(h.bulletHitHandlers[0](wh, new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 1)).toBe(false);
    step(1);
    expect(sys.hud.shown.tag).toBe('');
  });
});
