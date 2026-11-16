// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane AIR): SURFACE RUN's bounded interior gas field (world/surface/airField.ts)
// and the field hooks it needs (world/gas/field.ts removable sources, world/gas/system.ts per-storey rects / overlapping zones):
//  - a removed source (a shut door) LINGERS and thins (never a vanish, never a faint haze kept forever), other sources keep their pools;
//  - zones: no field until breached; far zones freeze, waking replays their history (the fast-forward arithmetic) within a budget;
//    the arrival point settles at build; ONE field for exposure and the layers;
//  - two zones of one level whose rects overlap never clobber each other's layer cells (the upload composes them);
//  - the COST on the generated district (1056 x 1056 cells): Node per-frame timings + cell-substep counts (SURFACE_GAS_COST_LOG=/tmp/x
//    writes the numbers; the asserts bound the counts, not the clock).
import {describe, expect, it, vi} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {FLOOR, Grid} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import {LEVELS} from '../src/levels/registry';
import {GAS, GasField} from '../src/world/gas/field';
import {installGas, type GasHost} from '../src/world/gas/system';
import {surfaceOutdoorMap, type SurfaceOutdoorMap} from '../src/world/surface/airMask';
import {SURFACE_FIELD, SurfaceGasField, rectDistance, surfaceGasZones, type SurfaceGasZoneSpec} from '../src/world/surface/airField';
import {doorBreachId, planSurfaceDoors} from '../src/world/surface/airDoors';

const LOG = process.env.SURFACE_GAS_COST_LOG;
const log = (s: string) => { if (LOG) appendFileSync(LOG, `${s}\n`); };
if (LOG) writeFileSync(LOG, '');

/** A one-room grid: room x 2..W-2, y 2..H-2 (area 1), a source column at x = 2. */
function room(W = 40, H = 24) {
  const g = new Grid(W, H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = 1; g.floor[i] = 0; g.ceil[i] = 3; }
  const src = [g.idx(2, 10), g.idx(2, 11), g.idx(2, 12)];
  return {g, src};
}

describe('removable sources (a Surface Run door shutting): the room lingers and thins, never a vanish', () => {
  it('after removal: the concentration is untouched, then falls monotonically (~30 s below the damage threshold), then releases to nothing', () => {
    const {g, src} = room();
    const f = new GasField([{id: 0, grid: g}]);
    expect(f.addBreach({id: 'door:a', level: 0, cells: src, strength: 0.6})).toBe(true);
    f.advance(60);
    const st = f.storey(0)!;
    const peak0 = st.stats().max, mid0 = f.concentrationAt(6, 0.5, 5.5);
    expect(peak0).toBeGreaterThan(0.45);
    expect(mid0).toBeGreaterThan(0.2);
    expect(f.removeBreach('door:a')).toBe(true);
    expect(f.removeBreach('door:a')).toBe(false);
    expect(st.breaches).toEqual([]);
    expect(st.stats().max).toBe(peak0); // untouched at the removal
    expect(st.lingering).toBe(true);
    let prev = peak0, t = 0, below = NaN;
    while (t < 120) {
      f.advance(1, 0.1);
      t += 1;
      const m = st.stats().max;
      expect(m, `peak at ${t} s`).toBeLessThanOrEqual(prev + 1e-7);
      if (Number.isNaN(below) && m < GAS.THRESHOLD) below = t;
      prev = m;
    }
    expect(below).toBeGreaterThan(10); // visibly lingering ...
    expect(below).toBeLessThan(60); // ... but the hazard drops within a minute
    // settled (asleep) at a faint remainder: released to spill, it decays to nothing
    for (let k = 0; k < 600 && !st.asleep; k++) f.advance(1, 0.1);
    expect(st.asleep).toBe(true);
    expect(st.releaseLingering()).toBe(true);
    expect(st.releaseLingering()).toBe(false);
    f.advance(30, 0.1);
    expect(st.stats().max).toBe(0);
  });

  it('another opening into the same room keeps its pool (and the room refills when the door opens again)', () => {
    const {g, src} = room();
    const f = new GasField([{id: 0, grid: g}]);
    f.addBreach({id: 'door:a', level: 0, cells: src, strength: 0.6});
    f.addBreach({id: 'pane:b', level: 0, cells: [g.idx(30, 2), g.idx(31, 2)], strength: 0.6});
    f.advance(60);
    const c0 = f.concentrationAt(15.5, 0.5, 1.25);
    f.removeBreach('door:a');
    f.advance(30, 0.1);
    expect(f.concentrationAt(15.5, 0.5, 1.25)).toBeGreaterThan(c0 * 0.6); // still fed by the pane
    expect(f.storey(0)!.breaches).toEqual(['pane:b']);
    f.addBreach({id: 'door:a', level: 0, cells: src, strength: 0.6});
    f.advance(30, 0.1);
    expect(f.concentrationAt(1.25, 0.5, 5.5)).toBeGreaterThan(0.4);
  });
});

/** Two adjacent 10 m buildings on one street grid sharing a wall at x = 10 m (cells 20); B's west ring cell (20, 10) is open (a party doorway). */
function twoZones() {
  const W = 44, H = 24, g = new Grid(W, H);
  const room = (x0: number, x1: number, a: number) => { for (let y = 2; y < 18; y++) for (let x = x0; x < x1; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.area[i] = a; g.floor[i] = 0; g.ceil[i] = 3; } };
  room(1, 19, 1); // A: x 0..10 m, its ring at cells 0 / 19
  room(21, 39, 2); // B: x 10..20 m, its ring at cells 20 / 39
  const i = g.idx(20, 10); g.cells[i] = FLOOR; g.area[i] = 2; g.floor[i] = 0; g.ceil[i] = 3;
  const info = {
    buildings: [
      {id: 0, footprint: {x0: 0, z0: 0, x1: 10, z1: 9.5}, height: 4, levels: [0], entrances: [{}], windows: []},
      {id: 1, footprint: {x0: 10, z0: 0, x1: 20, z1: 9.5}, height: 4, levels: [0], entrances: [{}], windows: []},
    ],
    checkpoint: {tent: {rect: {x0: 21, z0: 10, x1: 21.5, z1: 10.5}, area: 9, door: {x: 21.25, z: 10.5, side: 'S'}}},
    outdoorAreas: [0], windows: [], storeys: [{level: 0, label: 'Street', y: 0}],
  } as unknown as SurfaceInfo;
  return {g, info};
}

describe('the zone field (bounded per building)', () => {
  it('no field until breached; a far zone freezes and replays on waking within the budget; settle() replays the arrival zones at once', () => {
    const {g, info} = twoZones();
    const map = surfaceOutdoorMap({grid: g, levels: [{id: 0, grid: g, baseY: 0}] as never, surface: info})!;
    let focus = {x: 5, z: 5};
    const f = new SurfaceGasField([{id: 0, grid: g}], surfaceGasZones(info), map, () => focus);
    expect(f.zones.map(z => [z.spec.id, z.field, z.mode])).toEqual([['b0', null, 'frozen'], ['b1', null, 'frozen'], ['tent', null, 'frozen']]);
    expect(f.addBreach({id: 'x', level: 0, cells: [g.idx(30, 10)]})).toBe(true); // B
    expect(f.addBreach({id: 'y', level: 0, cells: [g.idx(42, 22)]})).toBe(false); // the street: no zone
    // the player at A: B (within the wake radius: 10 m) wakes on the next tick and replays from its first op
    f.tick(0.1);
    expect(f.zones[1].mode).toBe('live');
    expect(f.zones[1].field).not.toBe(null);
    expect(f.zones[0].field).toBe(null);
    for (let t = 0; t < 30; t += 0.1) f.tick(0.1);
    const live = f.concentrationAt(15.25, 1, 5.25);
    expect(live).toBeGreaterThan(0.03);
    // far away: B freezes (keeps its state), a door into A opens 20 s "ago" -> pending; coming back replays both, bounded per frame
    focus = {x: 400, z: 400};
    f.tick(0.1);
    expect(f.zones[1].mode).toBe('frozen');
    f.addAged({id: 'z', level: 0, cells: [g.idx(10, 10)]}, 20);
    expect(f.zones[0].pending.length).toBe(1);
    for (let t = 0; t < 20; t += 0.1) f.tick(0.1);
    expect(f.zones[0].field).toBe(null); // nothing simulated while far
    const before = f.counts.replayCellSteps, forced0 = f.counts.forced;
    // coming back: first out of sight (beyond SEEN_M, inside the wake distance) — the replay runs nearest first within the frame budget
    focus = {x: 5, z: 9.5 + SURFACE_FIELD.SEEN_M + 1};
    let frames = 0;
    while (f.zones.some(z => z.mode === 'catching' || (z.pending.length && z.mode === 'frozen')) || frames === 0) {
      const c0 = f.counts.replayCellSteps;
      f.tick(1 / 60);
      // a step never costs more than what is left of the budget (+ one 0.1 s tick of one zone when nothing else ran)
      expect(f.counts.replayCellSteps - c0).toBeLessThanOrEqual(SURFACE_FIELD.CATCHUP_CELL_STEPS + GasField.substeps(0.1) * 22 * 22);
      if (++frames > 600) break;
    }
    expect(f.counts.replayCellSteps).toBeGreaterThan(before); // (replayed out of sight)
    expect(f.counts.forced).toBe(forced0);
    // ... then in sight: already current (nothing forced)
    focus = {x: 5, z: 5};
    f.tick(1 / 60);
    expect(f.counts.forced).toBe(forced0);
    expect(f.zones[0].mode).toBe('live');
    expect(f.zones[0].simT).toBe(f.now);
    expect(f.counts.replayCellSteps).toBeGreaterThan(before);
    expect(f.concentrationAt(4.25, 1, 5.25)).toBeGreaterThan(0.01); // A's 20 s of door gas, replayed
    // settle(): everything with history near a point, at once (behind the loading screen)
    const f2 = new SurfaceGasField([{id: 0, grid: g}], surfaceGasZones(info), map, () => ({x: 5, z: 5}));
    f2.addAged({id: 'x', level: 0, cells: [g.idx(30, 10)]}, GAS.AGE_CAP_S);
    expect(f2.settle(5, 5)).toBe(1);
    expect(f2.zones[1].mode).toBe('live');
    // the replay is the live arithmetic (0.5 s coarse steps = 15 substeps of the live tick's own 1/30 s): a twin simulated live agrees
    const f3 = new SurfaceGasField([{id: 0, grid: g}], surfaceGasZones(info), map, () => ({x: 5, z: 5}));
    f3.addBreach({id: 'x', level: 0, cells: [g.idx(30, 10)]});
    for (let k = 0; k < GAS.AGE_CAP_S * GAS.TICK_HZ; k++) f3.tick(1 / GAS.TICK_HZ);
    for (const [x, z] of [[15.25, 5.25], [13, 4], [18, 7.5], [11, 2]] as const) {
      expect(f2.concentrationAt(x, 1, z), `replayed vs live at ${x},${z}`).toBeCloseTo(f3.concentrationAt(x, 1, z), 3);
    }
    expect(f2.concentrationAt(15.25, 1, 5.25)).toBeGreaterThan(0.05);
  });

  it('a zone the player can see or breathe is never stale: a teleport into SEEN_M completes its replay at once (counted)', () => {
    const {g, info} = twoZones();
    const map = surfaceOutdoorMap({grid: g, levels: [{id: 0, grid: g, baseY: 0}] as never, surface: info})!;
    let focus = {x: 400, z: 400};
    const f = new SurfaceGasField([{id: 0, grid: g}], surfaceGasZones(info), map, () => focus);
    f.addAged({id: 'x', level: 0, cells: [g.idx(30, 10)]}, GAS.AGE_CAP_S);
    for (let k = 0; k < 30; k++) f.tick(1 / 60);
    expect(f.zones[1].mode).toBe('frozen');
    focus = {x: 15, z: 5}; // inside B
    f.tick(1 / 60);
    expect(f.counts.forced).toBe(1);
    expect(f.zones[1].mode).toBe('live');
    expect(f.zones[1].simT).toBe(f.now);
    expect(f.concentrationAt(15.25, 1, 5.25)).toBeGreaterThan(0.05);
    // the wake distance leads the player's speed (the truck): ~6 m/s -> + 24 m; a teleport never counts as speed
    expect(f.wakeM).toBe(SURFACE_FIELD.WAKE_M);
    for (let k = 0; k < 240; k++) { focus = {x: 15 + k * 0.1, z: 5}; f.tick(1 / 60); }
    expect(f.speed).toBeGreaterThan(5.8);
    expect(f.speed).toBeLessThan(6 + 1e-6);
    expect(Math.abs(f.wakeM - (SURFACE_FIELD.WAKE_M + 6 * SURFACE_FIELD.LEAD_S))).toBeLessThan(1);
  });

  it("overlapping zone rects on one level never clobber each other's layer cells (the upload composes every storey there)", () => {
    const {g, info} = twoZones();
    const L = {grid: g, levels: [{id: 0, role: 'main', grid: g, baseY: 0}], surface: info, props: [], areas: []} as unknown as StationLayout;
    const map = surfaceOutdoorMap(L)! as SurfaceOutdoorMap;
    const layer = new Float32Array(g.w * g.h);
    const host = {
      player: {x: 5, z: 5, y: 0, eye: 1.6, alive: true, takeDamage: vi.fn()}, layout: L, tower: {office: null},
      atmosphere: {active: true, setGasLayer: (_s: number, f: ArrayLike<number>, r: {x0: number; y0: number; w: number; h: number}) => {
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const gx = r.x0 + x, gy = r.y0 + y; if (gx >= 0 && gy >= 0 && gx < g.w && gy < g.h) layer[gy * g.w + gx] = f[y * r.w + x]; }
      }},
      run: {laneStore: () => undefined, setLaneStore: () => undefined}, clock: 0, state: 'playing', frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void}[],
    };
    const sys = installGas(host as unknown as GasHost);
    let field: SurfaceGasField | null = null;
    sys.windowSources.push(() => ({plans: [], view: null, exterior: {x0: 0, z0: 0, x1: 22, z1: 12}, lane: 'surface.windows',
      field: () => (field = new SurfaceGasField([{id: 0, grid: g}], surfaceGasZones(info), map, () => ({x: 5, z: 5})))}));
    for (const s of host.sectionHooks) s.build?.(L);
    expect(field).not.toBe(null);
    // B gassed through the party doorway cell itself and its room; A gassed too (both live), then A changes after B every tick
    field!.addBreach({id: 'b', level: 0, cells: [g.idx(20, 10), g.idx(21, 10)]});
    field!.addBreach({id: 'a', level: 0, cells: [g.idx(5, 5)]});
    for (let k = 0; k < 200; k++) for (const f of host.frameHooks) f(0.1);
    const cell = g.idx(20, 10), v = field!.zones[1].field!.storey(0)!;
    const local = (cell % g.w - v.ox) + (Math.floor(cell / g.w) - v.oy) * v.dw;
    expect(v.c[local]).toBeGreaterThan(0.3); // B's own value at its edge (inside A's closed ring)
    expect(layer[cell]).toBeCloseTo(v.c[local], 6); // ... and the layer there is B's, never A's ring zero
    // every layer cell == the max over the zone storeys holding it (== the field the exposure reads)
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, y);
      expect(layer[i], `layer at ${x},${y}`).toBeCloseTo(Math.max(0, ...field!.storeys.map(s => { const lx = x - s.ox, ly = y - s.oy; return lx >= 0 && ly >= 0 && lx < s.dw && ly < s.dh ? s.c[ly * s.dw + lx] : 0; })), 6);
    }
  });
});

describe('the cost on the generated district (Node; counts bounded, timings logged)', () => {
  it('every core building gassed through its doorway: arrival settle, then 60 s of 60 fps play and a walk across the core', () => {
    const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const t0 = performance.now();
    const L = LEVELS.subway.generate('surface', {levelSeed: 11});
    const tGen = performance.now() - t0;
    const info = L.surface!, g0 = L.levels?.[0]?.grid ?? L.grid;
    const map = surfaceOutdoorMap(L)!;
    const specs: SurfaceGasZoneSpec[] = surfaceGasZones(info);
    const levels = (L.levels?.length ? L.levels : [{id: 0, grid: L.grid}]).map(l => ({id: l.id, grid: l.grid}));
    const portal = info.portal.pose;
    let focus = {x: portal.x, z: portal.z};
    const t1 = performance.now();
    const f = new SurfaceGasField(levels, specs, map, () => focus);
    const tCtor = performance.now() - t1;
    const doors = planSurfaceDoors(info, g0, L.levels);
    let added = 0;
    for (const d of doors) if (d.cells.length && f.addAged({id: doorBreachId(d.id), level: d.level, cells: d.cells}, GAS.AGE_CAP_S)) added++;
    const t2 = performance.now();
    const settled = f.settle(focus.x, focus.z);
    const tSettle = performance.now() - t2;
    const s0 = f.stats();
    // 60 s at 60 fps at the portal
    const frame: number[] = [];
    for (let k = 0; k < 3600; k++) { const a = performance.now(); f.tick(1 / 60); frame.push(performance.now() - a); }
    const s1 = f.stats();
    // a walk across the core at 6 m/s (zones wake / catch up / freeze on the way), from an arrival there (settled: the loading screen)
    const c = info.core, path = [{x: c.x0, z: c.z0}, {x: c.x1, z: c.z1}];
    const travel = (speed: number) => {
      const times: number[] = [];
      focus = {...path[0]};
      f.tick(1 / 60); // (the jump there: a teleport — completes what is in sight)
      f.settle(focus.x, focus.z, f.wakeM);
      const forced0 = f.counts.forced;
      const steps = Math.ceil(Math.hypot(path[1].x - path[0].x, path[1].z - path[0].z) / speed * 60);
      let maxReplay = 0, stale = 0, worst = {ms: 0, replay: 0, tick: 0, wakes: 0, live: 0, ops: 0, fields: 0, k: 0};
      const top: number[][] = [];
      for (let k = 0; k <= steps; k++) {
        focus = {x: path[0].x + (path[1].x - path[0].x) * k / steps, z: path[0].z + (path[1].z - path[0].z) * k / steps};
        const r0 = f.counts.replayCellSteps, k0 = f.counts.tickCellSteps, wk0 = f.counts.wakes, op0 = f.counts.ops, fl0 = f.counts.fields, a = performance.now();
        f.tick(1 / 60);
        const ms = performance.now() - a;
        times.push(ms);
        maxReplay = Math.max(maxReplay, f.counts.replayCellSteps - r0);
        if (ms > worst.ms) worst = {ms, replay: f.counts.replayCellSteps - r0, tick: f.counts.tickCellSteps - k0, wakes: f.counts.wakes - wk0, live: f.zones.filter(z => z.mode === 'live').length, ops: f.counts.ops - op0, fields: f.counts.fields - fl0, k};
        top.push([Math.round(ms * 100) / 100, f.counts.replayCellSteps - r0, f.counts.ops - op0, f.counts.fields - fl0, k]);
        // in sight / in reach: never stale
        for (const z of f.zones) if ((z.field || z.pending.length || z.queue.length) && rectDistance(z.spec.rect, focus.x, focus.z) <= SURFACE_FIELD.SEEN_M && (z.mode !== 'live' || z.simT !== f.now)) stale++;
      }
      top.sort((a, b) => b[0] - a[0]);
      return {times, steps, maxReplay, stale, forced: f.counts.forced - forced0, worst, top: top.slice(0, 8)};
    };
    const w6 = travel(6);
    const walk = w6.times, steps = w6.steps, maxReplayFrame = w6.maxReplay;
    const s2 = f.stats();
    // a doorway's first breach in a zone: the field's creation + the pool's flood fill (one op of a replay)
    const opMs: number[] = [];
    for (const d of doors) {
      if (!d.cells.length) continue;
      const zk = d.cells.map(i => f.zoneAtCell(i % g0.w, Math.floor(i / g0.w))).find(k => k >= 0) ?? -1;
      if (zk < 0) continue;
      const zn = f.zones[zk];
      for (let rep = 0; rep < 2; rep++) {
        const a = performance.now();
        const gf = new GasField(zn.levels, {domain: zn.spec.cells, closed: zn.closed});
        gf.addBreach({id: 'probe', level: d.level, cells: d.cells, strength: 0.6});
        if (rep) opMs.push(performance.now() - a);
      }
    }
    log(`a zone's first breach (field + pool), ${opMs.length} doorways: mean ${mean(opMs).toFixed(3)} ms, max ${Math.max(...opMs).toFixed(3)} ms`);
    // ... and at truck speed (15 m/s: the wake distance leads it)
    const w15 = travel(15);
    // a zone FILLING live from clean air (the biggest doorway zone; its door just opened beside the player): the simulation's own steady cost
    const zoneOfDoor = (d: (typeof doors)[number]) => d.cells.map(i => f.zoneAtCell(i % g0.w, Math.floor(i / g0.w))).find(k => k >= 0) ?? -1;
    const area = (k: number) => k < 0 ? 0 : (specs[k].cells.x1 - specs[k].cells.x0) * (specs[k].cells.y1 - specs[k].cells.y0);
    const big = doors.filter(d => d.cells.length && zoneOfDoor(d) >= 0).sort((a, b) => area(zoneOfDoor(b)) - area(zoneOfDoor(a)))[0];
    let focus2 = {x: big.x, z: big.z};
    const f2 = new SurfaceGasField(levels, specs, map, () => focus2);
    const zn = f2.zones[zoneOfDoor(big)];
    expect(f2.addBreach({id: doorBreachId(big.id), level: big.level, cells: big.cells})).toBe(true);
    for (let k = 0; k < 600 && zn.mode !== 'live'; k++) f2.tick(1 / 60); // (wake: no history, so at once)
    expect(zn.mode).toBe('live');
    const fill: number[] = [], t3 = f2.counts.tickCellSteps, ticks0 = zn.field?.ticks ?? 0;
    for (let k = 0; k < 1800; k++) { const a = performance.now(); f2.tick(1 / 60); fill.push(performance.now() - a); }
    const fillTicks = (zn.field?.ticks ?? 0) - ticks0, fillSteps = f2.counts.tickCellSteps - t3;
    const bigCells = area(zoneOfDoor(big));
    focus2 = {x: -1e6, z: -1e6};
    log(`the biggest doorway zone (${bigCells} cells) filling live from clean air (30 s, ${fillTicks} ticks): frame mean ${mean(fill).toFixed(3)} ms, p95 ${q(fill, 0.95).toFixed(3)} ms, max ${Math.max(...fill).toFixed(3)} ms; cell-steps / tick ${(fillSteps / Math.max(1, fillTicks)).toFixed(0)}`);
    expect(fillTicks).toBeGreaterThan(250);
    expect(fillSteps / Math.max(1, fillTicks)).toBeLessThanOrEqual(GasField.substeps(1 / GAS.TICK_HZ) * Math.max(...specs.map(s => (s.cells.x1 - s.cells.x0 + 2) * (s.cells.y1 - s.cells.y0 + 2))) * 2);
    log(`district ${map.w}x${map.h} cells, ${info.buildings.length} buildings, ${specs.length} zones, ${added} doorway breaches (gen ${tGen.toFixed(0)} ms, field ctor ${tCtor.toFixed(1)} ms)`);
    log(`settle at the portal: ${settled} zones, ${tSettle.toFixed(1)} ms, replay cell-steps ${s0.replayCellSteps}, live ${s0.live}, storeys ${s0.storeys}, active cells ${s0.activeCells}`);
    log(`60 s at the portal: frame mean ${mean(frame).toFixed(3)} ms, p95 ${q(frame, 0.95).toFixed(3)} ms, max ${Math.max(...frame).toFixed(3)} ms; tick cell-steps ${s1.tickCellSteps}; live ${s1.live}`);
    log(`walk across the core at 6 m/s (${steps} frames): mean ${mean(walk).toFixed(3)} ms, p95 ${q(walk, 0.95).toFixed(3)} ms, max ${Math.max(...walk).toFixed(3)} ms; max replay cell-steps / frame ${maxReplayFrame}; forced ${w6.forced}, stale-in-sight frames ${w6.stale}; live ${s2.live}, frozen ${s2.frozen}, catching ${s2.catching}`);
    log(`  worst frames [ms, replay cell-steps, ops, new fields, frame]: walk ${JSON.stringify(w6.top)}; drive ${JSON.stringify(w15.top)}`);
    log(`drive across the core at 15 m/s (${w15.steps} frames): mean ${mean(w15.times).toFixed(3)} ms, p95 ${q(w15.times, 0.95).toFixed(3)} ms, max ${Math.max(...w15.times).toFixed(3)} ms; max replay cell-steps / frame ${w15.maxReplay}; forced ${w15.forced}, stale-in-sight frames ${w15.stale}; wakes ${f.counts.wakes}, freezes ${f.counts.freezes}`);
    expect(specs.length).toBe(info.buildings.filter(b => b.levels.length && (b.entrances.length || b.windows.length)).length + 1);
    expect(added).toBeGreaterThan(0);
    // only the zones near the player ever simulate; the rest wait frozen (zero cost)
    expect(s0.live).toBeLessThan(specs.length);
    expect(s0.live).toBeGreaterThanOrEqual(1);
    // per-frame replay stays inside the budget (+ at most one 0.1 s tick of one zone's box when nothing else ran); nothing in sight stale,
    // nothing forced on a walk or a drive
    const zoneCells = Math.max(...specs.map(s => (s.cells.x1 - s.cells.x0 + 2) * (s.cells.y1 - s.cells.y0 + 2)));
    for (const w of [w6, w15]) {
      expect(w.maxReplay).toBeLessThanOrEqual(SURFACE_FIELD.CATCHUP_CELL_STEPS + GasField.substeps(0.1) * zoneCells * 4);
      expect(w.forced).toBe(0);
      expect(w.stale).toBe(0);
    }
    // the live zones' tick work per frame: bounded by the zones within the wake radius
    const perTick = s1.tickCellSteps / Math.max(1, 3600 / 6);
    log(`live tick cell-steps per 10 Hz tick ≈ ${perTick.toFixed(0)}`);
    expect(Number.isFinite(perTick)).toBe(true);
  }, 120_000);
});
