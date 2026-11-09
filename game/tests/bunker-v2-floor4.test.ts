// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 4, MAINTENANCE & WATER (gen/bunker/v2/floor4.ts, floor4Dress.ts)
// over a bounded seed set: the whole level valid (bunkerIssues + bunkerV2Issues), the programme present, the spatial rhythm (huge
// plant halls vs cramped service runs), the anchors served, the V45 well's railed gallery rim on three sides, the generator gen-2 in
// the auxiliary power room, the hazards (the strong chlorine leak in a one-door dead end, damp / aged areas), the storey budget and
// determinism. Each seed is generated once per file.

import {describe, expect, it} from 'vitest';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {bunkerIssues} from '../src/gen/bunker/validate';
import {bunkerV2Issues} from '../src/gen/bunker/v2/validate';
import {BUNKER_V2_STATS} from '../src/gen/bunker/v2/index';
import {bunkerSpine} from '../src/gen/bunker/v2/spine';
import {FLOOR_4} from '../src/gen/bunker/v2/floor4';
import {FLOOR4_DRESS_STATS} from '../src/gen/bunker/v2/floor4Dress';
import {GAS_STRONG} from '../src/gen/bunker/hazards';
import {spawnProfile} from '../src/ai/spawnTables';
import {CELL, FLOOR} from '../src/gen/grid';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const LV = 4, BASE = -28;
const SEEDS = Array.from({length: 8}, (_, k) => 4401 + k * 7919);
const START_CELLS = spawnProfile('bunker').contexts.station?.placement.startCells ?? 36;

interface Rec { layout: StationLayout; ms: number; dress: typeof FLOOR4_DRESS_STATS }
const cache = new Map<number, Rec>();
function gen(seed: number): Rec {
  let r = cache.get(seed);
  if (!r) {
    const layout = generateBunkerLevel({levelSeed: seed});
    r = {layout, ms: BUNKER_V2_STATS.ms, dress: JSON.parse(JSON.stringify(FLOOR4_DRESS_STATS))};
    cache.set(seed, r);
  }
  return r;
}
const storey = (l: StationLayout): Area[] => l.areas.filter(a => (a.level ?? 0) === LV && a.role !== 'stair' && a.role !== 'landing');
const byLabel = (l: StationLayout, label: string): Area | undefined => storey(l).find(a => a.label === label);
const m2 = (a: Area) => a.w * a.h * CELL * CELL;
const clear = (a: Area) => a.ceil - BASE;

/** (lead, integration: storey 5's nave rises through this storey's slab — its decor is not this storey's) */
const inNave = (d: {x0: number; z0: number; x1: number; z1: number; y0: number}): boolean => {
  const v = bunkerSpine().voids.find(q => q.id === 'V45')!.rect, cx = (d.x0 + d.x1) / 2 / 0.5, cz = (d.z0 + d.z1) / 2 / 0.5;
  return d.y0 < BASE + 0.05 && cx >= v.x && cx < v.x + v.w && cz >= v.y && cz < v.y + v.h;
};

describe('bunker v2 storey 4: maintenance & water', () => {
  it('the whole level is valid on every seed (bunkerIssues + bunkerV2Issues)', () => {
    const bad: string[] = [];
    for (const s of SEEDS) {
      const {layout} = gen(s);
      const issues = [...bunkerIssues(layout, {startCells: START_CELLS}), ...bunkerV2Issues(layout)];
      if (issues.length) bad.push(`${s}: ${issues.slice(0, 4).join(' | ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('the programme is present: plant halls, the water plant, the crew side, the damaged drainage wing', () => {
    const need = ['Reservoir hall', 'Water treatment', 'Chlorination room', 'Air filtration plant', 'Boiler house', 'Auxiliary power room', 'Pump hall',
      'Core gallery', 'Cooling feed gallery', 'West catwalk', 'Freight hall', 'Maintenance workshop', 'Maintenance stores', 'Crew room', 'Crew washroom',
      'North pipe run', 'Pipe run', 'Service passage', 'Drainage gallery', 'Flooded sump', 'Sewage ejector room'];
    for (const s of SEEDS) {
      const {layout} = gen(s);
      for (const n of need) expect(byLabel(layout, n), `${s} ${n}`).toBeTruthy();
      // every storey-4 area carries its own purpose (never a drawn subway one) except the open galleries round the well
      for (const a of storey(layout)) if (a.role !== 'catwalk') expect(a.purpose, `${s} ${a.label}`).toBeTruthy();
      // the maintenance loot palette: workshop / plant / stores purposes, no food-service purpose on this storey
      for (const a of storey(layout)) expect(['staff-room', 'stock-room', 'agent-office', 'lost-property']).not.toContain(a.purpose);
      // the identity compositions were built: the cistern tank, the pump rows, the boilers
      const props = layout.props.filter(p => (p.level ?? 0) === LV);
      const pumpHall = byLabel(layout, 'Pump hall')!;
      expect(props.filter(p => p.kind === 'bunkerCoolantPump' && p.area === pumpHall.id).length, `${s} pumps`).toBeGreaterThanOrEqual(4);
      const res = byLabel(layout, 'Reservoir hall')!;
      expect(props.some(p => p.kind === 'annexMachine' && p.area === res.id && p.hx * p.hz * 4 >= 60), `${s} cistern`).toBe(true);
      expect(gen(s).dress.boilers, `${s} boilers`).toBeGreaterThanOrEqual(1);
    }
  });

  it('spatial rhythm: huge plant halls (6.4 m) against cramped service runs (<= 2.5 m wide, 3 m low)', () => {
    for (const s of SEEDS) {
      const {layout} = gen(s);
      const all = storey(layout);
      const halls = all.filter(a => a.kind === 'room' && m2(a) >= 100);
      const tall = all.filter(a => clear(a) >= 6.0);
      const runs = all.filter(a => a.kind === 'service' && Math.min(a.w, a.h) * CELL <= 2.5 && clear(a) <= 3.3);
      const small = all.filter(a => a.kind === 'room' && m2(a) <= 60);
      expect(Math.max(...all.map(m2)), `${s} largest`).toBeGreaterThanOrEqual(280);
      expect(halls.length, `${s} halls`).toBeGreaterThanOrEqual(6);
      expect(tall.length, `${s} tall halls`).toBeGreaterThanOrEqual(3);
      expect(runs.length, `${s} runs`).toBeGreaterThanOrEqual(3);
      expect(small.length, `${s} small rooms`).toBeGreaterThanOrEqual(3);
      // nothing taller than a hall may be inside a storey
      for (const a of all) expect(clear(a), `${s} ${a.label}`).toBeLessThanOrEqual(6.4 + 1e-6);
      // the axis: the freight hall opens into the pump hall, the pump hall onto the core gallery (wide openings)
      const fh = byLabel(layout, 'Freight hall')!, ph = byLabel(layout, 'Pump hall')!, ga = byLabel(layout, 'Core gallery')!;
      const wide = (p: Area, q: Area) => layout.doors.some(d => ((d.a === p.id && d.b === q.id) || (d.a === q.id && d.b === p.id)) && Math.max(d.w, d.h) >= 10);
      expect(wide(fh, ph) && wide(ph, ga), `${s} axis`).toBe(true);
    }
  });

  it('serves every anchor apron of storey 4 with one of its areas, kept clear', () => {
    const fr = bunkerSpine().storeys[LV];
    for (const s of SEEDS) {
      const {layout} = gen(s);
      const g = layout.levels[LV].grid;
      const mine = new Set(storey(layout).map(a => a.id));
      for (const an of fr.anchors) {
        const ids = new Set<number>();
        for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) {
          const i = g.idx(x, y);
          expect(g.cells[i], `${s} ${an.id}`).toBe(FLOOR);
          expect(g.blocked[i], `${s} ${an.id} blocked`).toBeFalsy();
          ids.add(g.area[i]);
        }
        expect(ids.size, `${s} ${an.id}`).toBe(1);
        expect(mine.has([...ids][0]), `${s} ${an.id}`).toBe(true);
      }
      // the main stair and the cargo lift both open into the freight hall (one loading bay)
      const fh = byLabel(layout, 'Freight hall')!;
      for (const id of ['stairA', 'lift'] as const) {
        const an = fr.anchors.find(q => q.id === id)!;
        expect(g.area[g.idx(an.apron.x, an.apron.y)], `${s} ${id}`).toBe(fh.id);
      }
    }
  });

  it('the V45 well: never carved on storey 4, a walkable railed rim on its north, east and west sides', () => {
    const well = bunkerSpine().storeys[LV].well!;
    const r = well.rect;
    for (const s of SEEDS) {
      const {layout} = gen(s);
      const g = layout.levels[LV].grid;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) expect(g.cells[g.idx(x, y)]).not.toBe(FLOOR);
      const rim = (x0: number, y0: number, x1: number, y1: number) => {
        let n = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.cells[g.idx(x, y)] === FLOOR) n++;
        return n;
      };
      expect(rim(r.x, r.y - 1, r.x + r.w - 1, r.y - 1), `${s} north rim`).toBeGreaterThanOrEqual(r.w - 1);
      expect(rim(r.x + r.w, r.y, r.x + r.w, r.y + r.h - 1), `${s} east rim`).toBe(r.h);
      expect(rim(r.x - 1, r.y + 1, r.x - 1, r.y + r.h - 1), `${s} west rim`).toBeGreaterThanOrEqual(r.h - 2);
      // railed: rails on storey 4 run along the well's edges (derived)
      const rails = (layout.rails ?? []).filter(q => q.level === LV && q.x0 >= r.x * CELL - 0.01 && q.x1 <= (r.x + r.w) * CELL + 0.01 + 0.5 && q.z0 >= r.y * CELL - 0.6 && q.z1 <= (r.y + r.h) * CELL + 0.01);
      const len = rails.reduce((t, q) => t + Math.hypot(q.x1 - q.x0, q.z1 - q.z0), 0);
      expect(len, `${s} rail length`).toBeGreaterThanOrEqual((r.w + r.h) * CELL);
    }
  });

  it('gen-2 stands in the auxiliary power room (damp), reached from the stairs', () => {
    for (const s of SEEDS) {
      const {layout} = gen(s);
      const b = layout.bunker!;
      const g2 = b.generators.find(q => q.id === 'gen-2')!;
      expect(g2.level).toBe(LV);
      expect(layout.areas[g2.area].label).toBe('Auxiliary power room');
      expect(b.damp).toContain(g2.area);
      expect(layout.props[g2.prop].area).toBe(g2.area);
    }
  });

  it('hazards and light: the strong chlorine leak in a one-door dead end, a weak sewer leak, damp water plant, an aged drainage wing, the main line lit', () => {
    for (const s of SEEDS) {
      const {layout} = gen(s);
      const b = layout.bunker!, g = layout.levels[LV].grid;
      const zones = b.gasZones.filter(z => z.level === LV);
      const cl = byLabel(layout, 'Chlorination room')!, ej = byLabel(layout, 'Sewage ejector room')!;
      const strong = zones.filter(z => z.strength >= GAS_STRONG);
      expect(strong.length, `${s}`).toBe(1);
      expect(strong[0].cells.every(i => g.area[i] === cl.id), `${s} strong in the chlorination room`).toBe(true);
      expect(layout.doors.filter(d => d.a === cl.id || d.b === cl.id).length).toBe(1);
      expect(cl.kind).toBe('room');
      expect(zones.some(z => z.strength < 0.5 && z.cells.every(i => g.area[i] === ej.id)), `${s} weak`).toBe(true);
      for (const n of ['Reservoir hall', 'Water treatment', 'Pump hall', 'Auxiliary power room', 'Drainage gallery', 'Flooded sump']) expect(b.damp, `${s} ${n}`).toContain(byLabel(layout, n)!.id);
      for (const n of ['Drainage gallery', 'Flooded sump', 'Sewage ejector room']) expect(['dark', 'dim'], `${s} ${n}`).toContain(byLabel(layout, n)!.lighting);
      // the main line on steady power: lit, with working fixtures
      for (const n of ['Freight hall', 'Pump hall', 'Core gallery']) {
        const a = byLabel(layout, n)!;
        expect(a.lighting, `${s} ${n}`).toBe('lit');
        const own = layout.lights.filter(l => l.area === a.id);
        expect(own.length, `${s} ${n} fixtures`).toBeGreaterThan(0);
        expect(own.every(l => !l.broken), `${s} ${n} working`).toBe(true);
      }
    }
  });

  it('stays inside the storey budget (props <= 150, lights <= 75, decor <= 150) and the generation time', () => {
    for (const s of SEEDS) {
      const {layout, ms} = gen(s);
      const props = layout.props.filter(p => (p.level ?? 0) === LV).length;
      const lights = layout.lights.filter(l => (l.level ?? 0) === LV).length;
      const decor = layout.decor.filter(d => d.y0 >= BASE - 0.5 && d.y1 <= BASE + 7.01 && !inNave(d)).length;
      expect(props, `${s} props`).toBeLessThanOrEqual(150);
      expect(lights, `${s} lights`).toBeLessThanOrEqual(75);
      expect(decor, `${s} decor`).toBeLessThanOrEqual(150);
      expect(ms, `${s} ms`).toBeLessThan(6000);
    }
  });

  it('is deterministic (same seed, same storey)', () => {
    const s = SEEDS[0];
    const a = gen(s).layout;
    const b = generateBunkerLevel({levelSeed: s});
    const sig = (l: StationLayout) => JSON.stringify({
      areas: storey(l).map(q => [q.label, q.x, q.y, q.w, q.h, q.ceil, q.purpose]),
      doors: l.doors.filter(d => d.level === LV).map(d => [d.x, d.y, d.w, d.h]),
      props: l.props.filter(p => (p.level ?? 0) === LV).map(p => [p.kind, p.x, p.y, p.z, p.rot]),
      decor: l.decor.filter(d => d.y0 >= BASE - 0.5 && d.y1 <= BASE + 7.01 && !inNave(d)).length,
    });
    expect(sig(b)).toBe(sig(a));
    expect(FLOOR_4.level).toBe(LV);
  });
});
