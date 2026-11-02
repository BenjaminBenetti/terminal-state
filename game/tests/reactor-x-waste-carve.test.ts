// Task reactor-expansion-20261101 (lane WASTE): THE NUCLEAR-WASTE REPOSITORY carver + dress on a fixture slot (tests/reactor-x-waste-
// fixture.ts) over >= 8 seeds and every inward side: inside the region, connected to the entrance, every space connected, >= 2 loops,
// the generator reachable with a clear use point, program size, determinism, prop rules, timing.
// Task studio-reactor-playtest-round2-20261102 (lane WASTE): the plan is now a SEEDED ROOM GRAPH (user: "Just like the subway it should
// be random! with logical rooms flowing in to one another!") — the fixed 11-key program, its fixed "two disjoint routes" cut set and
// the 20 m vault minimum are replaced (intent change, not a coverage cut) by the COHERENCE rules every generation keeps
// (tests/reactor-x-waste-graph.ts: the logical entry sequence, the sealed controlled area, the service side, >= 2 loops) and the
// VARIETY the user asked for (24 seeds on ONE slot: distinct graphs, hall positions, vault shapes, optional rooms, switchgear homes).
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS} from '../src/gen/props';
import {OPENABLE_FRONT, propBlocksDoorway} from '../src/gen/placeKit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS} from '../src/damage/materials';
import type {StationLayout} from '../src/gen/stationTypes';
import {WASTE_DRESS_STATS} from '../src/gen/reactor/complex/wasteDress';
import {WASTE_CARVE_FAILS} from '../src/gen/reactor/complex/waste';
import {WASTE_DRUM_CAP} from '../src/gen/reactor/complex/wasteTypes';
import {WASTE_KINDS} from '../src/gen/reactor/complex/wastePlan';
import {FIX_LEVEL, wasteFixture, type WasteFixture} from './reactor-x-waste-fixture';
import {WASTE_REQUIRED, wasteCoherence, wasteSignature} from './reactor-x-waste-graph';

const SIDES = ['S', 'E', 'N', 'W'] as const;
const CASES = Array.from({length: 8}, (_, i) => ({seed: 101 + i * 7, inward: SIDES[i % 4], off: [0, -14, 12, 5, -6, 16, -18, 0][i]}));
const cache = new Map<string, WasteFixture>();
const fx = (c: {seed: number; inward: 'N' | 'S' | 'E' | 'W'; off: number}): WasteFixture => {
  const key = `${c.seed}:${c.inward}:${c.off}`;
  let f = cache.get(key);
  if (!f) { f = wasteFixture(c.seed, c.inward, {off: c.off}); cache.set(key, f); }
  return f;
};

/** BFS over walkable (FLOOR, unblocked) cells of the complex's storey from a cell; `skip` areas are treated as walls. */
function reach(L: StationLayout, from: [number, number], skip: ReadonlySet<number> = new Set(), ignoreBlocked = false): Int32Array {
  const g = L.levels[FIX_LEVEL].grid, d = new Int32Array(g.w * g.h).fill(-1), q: number[] = [];
  const s = g.idx(from[0], from[1]);
  d[s] = 0; q.push(s);
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!g.inBounds(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (d[j] >= 0 || g.cells[j] !== FLOOR || (!ignoreBlocked && g.blocked[j]) || skip.has(g.area[j])) continue;
      d[j] = d[i] + 1; q.push(j);
    }
  }
  return d;
}

describe('Reactor waste repository (lane WASTE): carve on a fixture slot', () => {
  it('carves the full program on every seed / inward side / entrance offset, inside the region', () => {
    for (const c of CASES) {
      const f = fx(c);
      expect(f.carve, `seed ${c.seed} ${c.inward}: ${JSON.stringify(WASTE_CARVE_FAILS)}`).not.toBeNull();
      const C = f.carve!, L = f.layout!, R = f.slot.region;
      expect(C.id).toBe('waste');
      expect(C.areas.length).toBeGreaterThanOrEqual(8);
      expect(C.entryArea).toBe(C.areas[0]);
      // the required spaces (by kind), every space of the program's vocabulary
      const kinds = new Set(L.reactorWaste!.graph!.rooms.map(r => r.kind));
      for (const k of WASTE_REQUIRED) expect(kinds.has(k), `seed ${c.seed}: ${k}`).toBe(true);
      for (const k of kinds) expect(k in WASTE_KINDS, k).toBe(true);
      expect(C.rooms.map(r => r.area)).toEqual(C.areas);
      for (const r of C.rooms) expect(r.label.length, r.key).toBeGreaterThan(3);
      // every area inside the region with one cell of wall kept inside its edge (canvas = grid: the fixture crops at the origin)
      for (const id of C.areas) {
        const a = L.areas[id];
        expect(a.level).toBe(FIX_LEVEL);
        expect(a.x >= R.x + 1 && a.y >= R.y + 1 && a.x + a.w <= R.x + R.w - 1 && a.y + a.h <= R.y + R.h - 1, `${a.label}`).toBe(true);
        expect(a.ceil).toBeLessThanOrEqual(f.slot.ceilMax + 1e-6);
        expect(a.ceil - f.slot.baseY).toBeGreaterThanOrEqual(3.2 - 1e-6);
      }
      // every door of the complex: >= 1.5 m wide (3 cells), >= 2.4 m tall; only the entrance crosses the region edge
      const mine = new Set(C.areas);
      const doors = L.doors.filter(d => mine.has(d.a) || mine.has(d.b));
      // (a tree has areas - 1 doors; >= 2 loops add >= 2 more; + the entrance)
      expect(doors.length).toBeGreaterThanOrEqual(C.areas.length + 2);
      for (const d of doors) {
        expect(Math.max(d.w, d.h) * CELL).toBeGreaterThanOrEqual(1.5);
        expect(d.height).toBeGreaterThanOrEqual(2.4 - 1e-6);
        const inside = d.x >= R.x + 1 && d.y >= R.y + 1 && d.x + d.w <= R.x + R.w - 1 && d.y + d.h <= R.y + R.h - 1;
        if (!inside) expect(d.a === f.slot.frontArea || d.b === f.slot.frontArea).toBe(true);
      }
      expect(doors.filter(d => d.a === f.slot.frontArea || d.b === f.slot.frontArea).length).toBe(1);
      // halls are tall, rooms 3-3.6 m
      for (const r of L.reactorWaste!.graph!.rooms) {
        const ceil = L.areas[r.area].ceil - f.slot.baseY;
        if (['bay', 'vault', 'cask'].includes(r.kind)) expect(ceil, r.key).toBeGreaterThanOrEqual(5.0);
        if (['hp', 'lockers', 'control', 'pump', 'switch', 'store', 'hotcell'].includes(r.kind)) { expect(ceil, r.key).toBeGreaterThanOrEqual(3.0); expect(ceil, r.key).toBeLessThanOrEqual(3.6); }
      }
    }
  });

  it('is substantial: >= 800 m² of floor, a drum vault (>= 14 m long, the vaults >= 110 m²), a cask hall (>= 10.5 m both ways), >= 11 spaces', () => {
    for (const c of CASES) {
      const f = fx(c), L = f.layout!, C = f.carve!, G = L.reactorWaste!.graph!;
      let cells = 0;
      for (const id of C.areas) { const a = L.areas[id]; cells += a.w * a.h; }
      expect(cells * CELL * CELL, `seed ${c.seed}`).toBeGreaterThanOrEqual(800);
      // (the vault's shape is seeded now: long and narrow or squarer, its racks along or across it)
      const vaults = G.rooms.filter(r => r.kind === 'vault').map(r => L.areas[r.area]);
      expect(Math.max(...vaults.map(v => Math.max(v.w, v.h))) * CELL).toBeGreaterThanOrEqual(14);
      expect(vaults.reduce((n, v) => n + v.w * v.h, 0) * CELL * CELL).toBeGreaterThanOrEqual(110);
      const k = L.areas[G.rooms.find(r => r.kind === 'cask')!.area];
      expect(Math.min(k.w, k.h) * CELL).toBeGreaterThanOrEqual(10.5);
      expect(C.areas.length).toBeGreaterThanOrEqual(11);
    }
  });

  it('connects to the entrance: every walkable cell of the complex is reachable from the deck after dressing; coherent; >= 2 loops', () => {
    for (const c of CASES) {
      const f = fx(c), L = f.layout!, C = f.carve!, g = L.levels[FIX_LEVEL].grid;
      const d = reach(L, f.deckCell);
      const mine = new Set(C.areas);
      let bad = 0;
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && !g.blocked[i] && mine.has(g.area[i]) && d[i] < 0) bad++;
      expect(bad, `seed ${c.seed} ${c.inward}: unreachable cells`).toBe(0);
      // the logical sequence, the sealed controlled area, the service side, >= 2 loops (tests/reactor-x-waste-graph.ts)
      expect(wasteCoherence(L, f.slot.frontArea), `seed ${c.seed} ${c.inward}`).toEqual([]);
      // the plant is reached on the cells too with every controlled space closed (the service side: no detour through the vaults)
      const G = L.reactorWaste!.graph!, ctrl = new Set(G.rooms.filter(r => r.zone === 'controlled').map(r => r.area));
      const pa = L.areas[G.rooms.find(r => r.kind === 'plant')!.area];
      expect(reach(L, f.deckCell, ctrl, true)[g.idx(pa.x + 1, pa.y + 1)], `seed ${c.seed}: plant behind the controlled area`).toBeGreaterThanOrEqual(0);
      // the area graph has cycles (doors - areas + 1 >= 2 over the complex + the deck)
      const doors = L.doors.filter(q => mine.has(q.a) && mine.has(q.b));
      expect(doors.length - C.areas.length + 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('places the zone generator in the plant: skid inside, use point reachable and clear, facing the skid', () => {
    for (const c of CASES) {
      const f = fx(c), L = f.layout!, C = f.carve!, g = L.levels[FIX_LEVEL].grid;
      const G = C.generator;
      expect(G.area).toBe(C.rooms.find(r => r.role === 'generator')!.area);
      expect(G.foot.w * G.foot.h).toBe(32);
      for (let y = G.foot.y; y < G.foot.y + G.foot.h; y++) for (let x = G.foot.x; x < G.foot.x + G.foot.w; x++) expect(g.area[g.idx(x, y)]).toBe(G.area);
      const ui = g.idx(G.use.x, G.use.y);
      expect(g.area[ui]).toBe(G.area);
      expect(g.blocked[ui]).toBe(0);
      const [ux, uz] = g.center(G.use.x, G.use.y);
      expect(g.circleClear(ux, uz, 0.3)).toBe(true);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) expect(g.blocked[g.idx(G.use.x + dx, G.use.y + dy)], `seed ${c.seed}: use zone`).toBe(0);
      expect(reach(L, f.deckCell)[ui]).toBeGreaterThanOrEqual(0);
      // the use yaw faces the skid (camera convention forward = (-sin, -cos))
      const fx0 = (G.foot.x + G.foot.w / 2) * CELL - ux, fz0 = (G.foot.y + G.foot.h / 2) * CELL - uz;
      expect(-Math.sin(G.use.yaw) * fx0 + -Math.cos(G.use.yaw) * fz0).toBeGreaterThan(0.5);
      // the skid's long axis yaw: along x -> 0 / pi, along z -> +-pi/2
      if (G.foot.w > G.foot.h) expect(Math.abs(Math.sin(G.yaw))).toBeLessThan(1e-3); else expect(Math.abs(Math.cos(G.yaw))).toBeLessThan(1e-3);
    }
  });

  it('is deterministic (same seed, same slot: identical carve, dressing and decor)', () => {
    const c = CASES[3];
    const a = wasteFixture(c.seed, c.inward, {off: c.off}), b = wasteFixture(c.seed, c.inward, {off: c.off});
    const pick = (f: WasteFixture) => JSON.stringify({areas: f.layout!.areas, doors: f.layout!.doors, props: f.layout!.props, lights: f.layout!.lights, signs: f.layout!.signs, decor: f.layout!.reactorWaste, gen: f.carve!.generator});
    expect(pick(a)).toBe(pick(b));
    // a different seed varies the plan
    const d = wasteFixture(c.seed + 1, c.inward, {off: c.off});
    expect(JSON.stringify(d.layout!.areas.slice(-12).map(q => [q.x, q.y, q.w, q.h]))).not.toBe(JSON.stringify(a.layout!.areas.slice(-12).map(q => [q.x, q.y, q.w, q.h])));
  });

  it('dresses by function: drum racks, banded pallets, casks, showers, the hot cell, fans, plates, lamps; within the drum cap', () => {
    for (const c of CASES) {
      const f = fx(c), L = f.layout!, D = L.reactorWaste!;
      expect(D, `seed ${c.seed}`).toBeTruthy();
      expect(D.level).toBe(FIX_LEVEL);
      const n = (p: string) => D.models.filter(m => m.piece === p).length;
      expect(n('wasteDrum')).toBeGreaterThanOrEqual(60);
      expect(n('wasteDrum')).toBeLessThanOrEqual(WASTE_DRUM_CAP);
      expect(n('storageCask')).toBeGreaterThanOrEqual(2);
      expect(n('deconShower')).toBeGreaterThanOrEqual(1);
      expect(n('hotCellWindow')).toBe(1);
      // (the real level asserts the console and switchgear per seed: tests/reactor-x-waste-level.test.ts)
      expect(n('switchgear') + n('controlConsole')).toBeGreaterThanOrEqual(1);
      expect(n('controlConsole')).toBe(1);
      expect(D.fans.length).toBeGreaterThanOrEqual(1);
      expect(D.stripes.length).toBeGreaterThanOrEqual(6);
      // (user bullet 13, via lane PROPS: the floating status beacons are REMOVED — a user-requested removal, not a coverage cut)
      expect(D.beacons.length).toBe(0);
      // the generator's sign wall (lane GAS's status / jam board): on a wall of the plant, clear of every plate in the plant
      const pl = L.areas[f.carve!.generator.area], gs = D.genSign!;
      expect(gs, `seed ${c.seed}: genSign`).toBeTruthy();
      const onX = Math.abs(gs.x - pl.x * CELL) < 0.05 || Math.abs(gs.x - (pl.x + pl.w) * CELL) < 0.05, onZ = Math.abs(gs.z - pl.y * CELL) < 0.05 || Math.abs(gs.z - (pl.y + pl.h) * CELL) < 0.05;
      expect(onX || onZ).toBe(true);
      expect(gs.x).toBeGreaterThanOrEqual(pl.x * CELL - 0.05); expect(gs.x).toBeLessThanOrEqual((pl.x + pl.w) * CELL + 0.05);
      expect(gs.z).toBeGreaterThanOrEqual(pl.y * CELL - 0.05); expect(gs.z).toBeLessThanOrEqual((pl.y + pl.h) * CELL + 0.05);
      for (const sg of L.signs) if ((sg.level ?? 0) === FIX_LEVEL && sg.area === pl.id) expect(Math.hypot(sg.x - gs.x, sg.z - gs.z) > gs.w / 2 + 0.3 || Math.abs(sg.y - gs.y) > 0.6, `sign "${sg.text}" on the generator's sign wall`).toBe(true);
      // the hot-cell window sits in the hot-cell gallery when the plan keeps one (a gallery whose walls the station dresser's
      // fittings took is relabelled the sample counting room, its window in the processing room)
      const hot = D.graph!.rooms.find(r => r.kind === 'hotcell' && r.label === 'Hot-cell gallery'), hw = D.models.find(m => m.piece === 'hotCellWindow')!;
      if (hot) { const a = L.areas[hot.area]; expect(hw.x >= a.x * CELL - 0.01 && hw.x <= (a.x + a.w) * CELL + 0.01 && hw.z >= a.y * CELL - 0.01 && hw.z <= (a.y + a.h) * CELL + 0.01, `seed ${c.seed}: hot cell in its gallery`).toBe(true); }
      const mine = new Set(f.carve!.areas);
      const tags = L.props.filter(p => p.kind === 'annexMachine' && mine.has(p.area)).map(p => p.purpose);
      expect(tags.filter(t => t === 'waste:rack').length).toBeGreaterThanOrEqual(3);
      expect(tags.filter(t => t === 'waste:cask').length).toBe(n('storageCask'));
      expect(L.signs.filter(s => mine.has(s.area) || s.area === f.slot.frontArea).length).toBeGreaterThanOrEqual(8);
      expect(L.lights.filter(l => mine.has(l.area)).length).toBeGreaterThanOrEqual(20);
      // every model sits on the complex's floor
      for (const m of D.models) if (m.piece !== 'wasteDrum') expect(m.y).toBeCloseTo(f.slot.baseY, 3);
    }
  });

  it('follows the prop rules: on the floor, under the ceiling, no overlaps, door lanes clear, classified kinds, open access strips, aisles >= 1.2 m', () => {
    for (const c of CASES) {
      const f = fx(c), L = f.layout!, g = L.levels[FIX_LEVEL].grid, mine = new Set(f.carve!.areas);
      const props = L.props.filter(p => (p.level ?? 0) === FIX_LEVEL && mine.has(p.area));
      expect(props.length).toBeGreaterThan(40);
      const audited = new Set(OPENABLE_AUDIT.map(e => e.kind));
      for (const p of props) {
        const [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(g.cells[i]).toBe(FLOOR);
        expect(g.area[i], `${p.kind} area`).toBe(p.area);
        expect(p.y).toBeGreaterThanOrEqual(f.slot.baseY - 0.02);
        expect(p.y + p.h).toBeLessThanOrEqual(L.areas[p.area].ceil + 0.05);
        expect(audited.has(p.kind), `${p.kind} classified`).toBe(true);
        if (PROP_DEFS[p.kind]?.physics?.dynamic || PROP_PHYSICS[p.kind]?.dynamic) expect(p.kind === 'annexMachine').toBe(false);
        if (p.kind === 'annexMachine' || p.mounted) expect(propBlocksDoorway(L, p.x, p.z, p.hx, p.hz, p.y, p.h), `${p.purpose ?? p.kind} in a doorway`).toBeNull();
      }
      // what the complex's dress adds never overlaps any prop (3D boxes; on-top decor excluded)
      const added = new Set(L.props.slice(f.firstProp ?? 0));
      const floor = props.filter(p => p.host === undefined);
      for (let a = 0; a < floor.length; a++) for (let b = a + 1; b < floor.length; b++) {
        const p = floor[a], q = floor[b];
        if (!added.has(p) && !added.has(q)) continue;
        // (0.05 m: the cell grid's placement epsilon is 0.04 m)
        const ov = Math.min(p.x + p.hx, q.x + q.hx) - Math.max(p.x - p.hx, q.x - q.hx) > 0.05 && Math.min(p.z + p.hz, q.z + q.hz) - Math.max(p.z - p.hz, q.z - q.hz) > 0.05
          && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 0.05;
        expect(ov, `${p.purpose ?? p.kind} overlaps ${q.purpose ?? q.kind} (seed ${c.seed})`).toBe(false);
      }
      // openables placed by the dress keep their swing / drawer strip open
      for (const p of props) {
        const sw = OPENABLE_FRONT[p.kind];
        if (!sw || p.mounted) continue;
        // the far end of the strip (its near end may share a cell with the holder's own quantized footprint)
        const fx2 = Math.round(Math.sin(p.rot)), fz2 = Math.round(Math.cos(p.rot)), def = PROP_DEFS[p.kind];
        const [sx, sy] = g.cellOf(p.x + fx2 * (def.d / 2 + sw - 0.06), p.z + fz2 * (def.d / 2 + sw - 0.06));
        expect(g.walkable(sx, sy), `${p.kind} front strip (seed ${c.seed})`).toBe(true);
      }
      // drum-rack aisles: any two racks of the vault are >= 1.2 m apart (or end-to-end in a row with a cross gap)
      const racks = props.filter(p => p.purpose === 'waste:rack');
      for (let a = 0; a < racks.length; a++) for (let b = a + 1; b < racks.length; b++) {
        const p = racks[a], q = racks[b];
        const gx = Math.max(p.x - p.hx, q.x - q.hx) - Math.min(p.x + p.hx, q.x + q.hx), gz = Math.max(p.z - p.hz, q.z - q.hz) - Math.min(p.z + p.hz, q.z + q.hz);
        expect(Math.max(gx, gz), `rack gap (seed ${c.seed})`).toBeGreaterThanOrEqual(1.2 - 1e-3);
      }
      // casks keep >= 1.2 m aisles between them
      const casks = props.filter(p => p.purpose === 'waste:cask');
      for (let a = 0; a < casks.length; a++) for (let b = a + 1; b < casks.length; b++) {
        const p = casks[a], q = casks[b];
        const gx = Math.max(p.x - p.hx, q.x - q.hx) - Math.min(p.x + p.hx, q.x + q.hx), gz = Math.max(p.z - p.hz, q.z - q.hz) - Math.min(p.z + p.hz, q.z + q.hz);
        expect(Math.max(gx, gz)).toBeGreaterThanOrEqual(1.2 - 1e-3);
      }
      // storage the complex adds opens (an openable / loot-holder kind), and some loose things move
      const kinds = new Set(props.map(p => p.kind));
      expect([...kinds].some(k => ['staffLockers', 'cabinetTall', 'cabinetLow', 'filingCabinet', 'crate', 'firstAidWallKit', 'aedWallCabinet', 'wheelieBin'].includes(k))).toBe(true);
      expect(props.some(p => PROP_PHYSICS[p.kind]?.dynamic)).toBe(true);
    }
  });

  it('varies the facility per seed on ONE slot (24 seeds): the graph, hall positions, vault shapes, optional rooms, the switchgear home', () => {
    const sigs = Array.from({length: 24}, (_, i) => {
      const f = wasteFixture(500 + i * 13, 'S', {off: 4});
      expect(wasteCoherence(f.layout!, f.slot.frontArea), `seed ${500 + i * 13}`).toEqual([]);
      return wasteSignature(f.layout!, f.slot.region, 'S');
    });
    const distinct = (k: (s: typeof sigs[number]) => string | number) => new Set(sigs.map(k)).size;
    // (the fixed program of round 1 had ONE graph, two with its optional link, every hall in the same band)
    expect(distinct(s => s.topo)).toBeGreaterThanOrEqual(20);
    expect(distinct(s => s.geo)).toBeGreaterThanOrEqual(18);
    expect(distinct(s => s.cask)).toBeGreaterThanOrEqual(4);
    expect(distinct(s => s.plant)).toBeGreaterThanOrEqual(4);
    expect(distinct(s => s.vault)).toBeGreaterThanOrEqual(10);
    expect(distinct(s => s.corridors)).toBeGreaterThanOrEqual(2);
    expect(distinct(s => s.loops)).toBeGreaterThanOrEqual(2);
    expect(distinct(s => s.deadEnds)).toBeGreaterThanOrEqual(2);
    expect(distinct(s => s.switchgear)).toBeGreaterThanOrEqual(2);
    // optional spaces come and go
    for (const k of ['hotcell', 'pump', 'store']) {
      const n = sigs.filter(s => s.optional.includes(k)).length;
      expect(n, k).toBeGreaterThan(0);
      expect(n, k).toBeLessThan(sigs.length);
    }
  });

  it('carves fast (< 60 ms mean) and dresses in bounded time', () => {
    let tot = 0, n = 0;
    for (const c of CASES) { const f = wasteFixture(c.seed + 1000, c.inward, {off: c.off, dressIt: false}); if (f.carve) { tot += f.carveMs; n++; } }
    expect(n).toBe(CASES.length);
    expect(tot / n).toBeLessThan(60);
    fx(CASES[0]);
    expect(WASTE_DRESS_STATS.ms).toBeLessThan(400);
  });

  it('returns null (the host keeps the generator on its landing) when the region cannot hold the program', () => {
    expect(wasteFixture(5, 'S', {U: 50, V: 40, dressIt: false}).carve).toBeNull();
  });
});
