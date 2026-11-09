// Task studio-bunker-rework-20261109-205115-01: the Bunker v2's storey 3 (SERVICES & MEDICAL, gen/bunker/v2/floor3.ts): the whole
// level valid, the service street's programme, its openness and mix of scales, the anchors served, the generator room, the declared
// hazards (the isolation ward's medium leak, the cylinder store's seeded weak one), the dressing's landmarks, its budgets, determinism.
//
// (While storey 4 is still the lead's placeholder it proposes only a medium leak; the pipeline needs a strong one somewhere, so this
// test lifts storey 4's own proposals to strong when it has none: the placeholder's leak is in its one-door dead-end room. Once the
// real storey 4 proposes its strong leak this wrapper changes nothing.)

import {describe, expect, it} from 'vitest';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {bunkerIssues} from '../src/gen/bunker/validate';
import {GAS_STRENGTH} from '../src/gen/bunker/hazards';
import {generateBunkerV2, BUNKER_V2_STATS} from '../src/gen/bunker/v2/index';
import {bunkerV2Issues} from '../src/gen/bunker/v2/validate';
import {BUNKER_V2_FLOORS} from '../src/gen/bunker/v2/floors';
import type {BunkerFloorModule} from '../src/gen/bunker/v2/floorApi';
import {bunkerSpine} from '../src/gen/bunker/v2/spine';
import {FLOOR_3, F3_CLEAR} from '../src/gen/bunker/v2/floor3';
import {F3_DRESS_STATS} from '../src/gen/bunker/v2/floor3Dress';
import {isContainerKind} from '../src/items/loot';

const LV = 3;
const SEEDS = [9001, 16920, 4401, 12320, 20239, 28158, 36077, 77];
const f4 = BUNKER_V2_FLOORS[4];
const floor4: BunkerFloorModule = {...f4, carve(c) {
  const r = f4.carve(c);
  if (r && !(r.gas ?? []).some(g => g.strength === 'strong')) r.gas = (r.gas ?? []).map(g => ({...g, strength: 'strong' as const}));
  return r;
}};

interface Gen { L: StationLayout; ms: number; issues: string[]; stats: typeof F3_DRESS_STATS }
const cache = new Map<number, Gen>();
function gen(seed: number): Gen {
  let g = cache.get(seed);
  if (!g) {
    const L = generateBunkerV2({levelSeed: seed} as never, {floors: {4: floor4}});
    g = {L, ms: BUNKER_V2_STATS.ms, issues: [...bunkerIssues(L, {startCells: 36}), ...bunkerV2Issues(L)], stats: JSON.parse(JSON.stringify(F3_DRESS_STATS))};
    cache.set(seed, g);
  }
  return g;
}
const byLabel = (L: StationLayout, label: string) => L.areas.filter(a => (a.level ?? 0) === LV && a.label === label);
const one = (L: StationLayout, label: string) => { const q = byLabel(L, label); expect(q.length, label).toBe(1); return q[0]; };
const m2 = (a: {w: number; h: number}) => a.w * a.h * CELL * CELL;
const clear = (L: StationLayout, a: {ceil: number}) => a.ceil - L.levels[LV].baseY;
const doorsOf = (L: StationLayout, id: number) => L.doors.filter(d => d.a === id || d.b === id);

describe('bunker v2 storey 3: services & medical (the service street)', () => {
  it('the whole level is valid on every seed, and quick', () => {
    for (const s of SEEDS) {
      const g = gen(s);
      expect(g.issues, `seed ${s}`).toEqual([]);
      expect(g.L.bunker?.version).toBe(2);
      expect(g.ms, `seed ${s} ms`).toBeLessThan(6000);
    }
  });

  it('carries its programme: the street, the depot, the fabrication hall, the plant room, the infirmary and its isolation ward', () => {
    for (const s of SEEDS) {
      const {L} = gen(s);
      expect(byLabel(L, 'Service street').length, `seed ${s}`).toBe(2);
      for (const label of ['Supply depot', 'Freight lobby', 'Laundry', 'Fabrication hall', 'Works yard', 'Services plant room', 'Medical gas store', 'Washroom',
        'Infirmary hall', 'Casualty ward', 'Clinical corridor', 'Treatment room', 'Dispensary', 'Medical stores', 'Isolation airlock', 'Isolation ward']) one(L, label);
      expect(one(L, 'Services plant room').purpose).toBe('generator-room');
      expect(one(L, 'Treatment room').purpose).toBe('first-aid-room');
      expect(one(L, 'Fabrication hall').purpose).toBe('workshop');
      // the medical rooms read medical (loot by purpose)
      for (const label of ['Infirmary hall', 'Casualty ward', 'Isolation ward', 'Medical gas store']) expect(one(L, label).purpose, label).toBe('reactor-bunker-decon');
    }
    expect(FLOOR_3.level).toBe(3);
  });

  it('is open and varied in scale: a long tall street, two big working halls, low wards and tight clinical rooms', () => {
    for (const s of SEEDS) {
      const {L} = gen(s);
      const street = byLabel(L, 'Service street');
      const len = street.reduce((t, a) => t + a.h * CELL, 0);
      expect(len, `seed ${s} street length`).toBeGreaterThanOrEqual(45);
      for (const a of street) { expect(a.w * CELL).toBeGreaterThanOrEqual(5.5); expect(clear(L, a)).toBeCloseTo(F3_CLEAR.street, 2); }
      const depot = one(L, 'Supply depot'), fab = one(L, 'Fabrication hall');
      expect(m2(depot), `seed ${s} depot`).toBeGreaterThanOrEqual(380);
      expect(clear(L, depot)).toBeCloseTo(6.4, 2);
      expect(m2(fab), `seed ${s} fab`).toBeGreaterThanOrEqual(250);
      expect(clear(L, fab)).toBeGreaterThanOrEqual(5.9);
      // the largest open space of the storey (the depot) is far bigger than any room
      const mine = L.areas.filter(a => (a.level ?? 0) === LV && a.role !== 'stair' && a.role !== 'landing');
      const big = mine.reduce((p, q) => (m2(q) > m2(p) ? q : p));
      expect(big.label).toBe('Supply depot');
      // constrained clinical rooms: small, low, off a 2.5 m corridor
      const small = mine.filter(a => m2(a) <= 45 && clear(L, a) <= 3.45);
      expect(small.length, `seed ${s} small rooms`).toBeGreaterThanOrEqual(3);
      const corr = one(L, 'Clinical corridor');
      expect(Math.min(corr.w, corr.h) * CELL).toBeLessThanOrEqual(2.5);
      expect(clear(L, corr)).toBeLessThanOrEqual(3.0);
      // heights stay inside the storey's bands; doors 2.4-3.0 m
      for (const a of mine) expect(clear(L, a), a.label).toBeLessThanOrEqual(6.4 + 1e-6);
      for (const d of L.doors) if ((d.level ?? 0) === LV && mine.some(a => a.id === d.a) && mine.some(a => a.id === d.b)) { expect(d.height).toBeGreaterThanOrEqual(2.4); expect(d.height).toBeLessThanOrEqual(3.0); }
    }
  });

  it('serves every anchor apron with one of its areas, kept clear (main stair → infirmary hall, service stair → works yard, lift → freight lobby)', () => {
    const sp = bunkerSpine();
    const want: Record<string, string> = {stairA: 'Infirmary hall', stairB: 'Works yard', lift: 'Freight lobby'};
    for (const s of SEEDS) {
      const {L} = gen(s);
      const g = L.levels[LV].grid;
      for (const an of sp.storeys[LV].anchors) {
        const a = one(L, want[an.id]);
        for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) {
          const i = g.idx(x, y);
          expect(g.cells[i] === FLOOR && g.area[i] === a.id && !g.blocked[i], `seed ${s} ${an.id} ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('stands generator gen-1 in its plant room, against a wall, reached by stairs', () => {
    for (const s of SEEDS) {
      const {L} = gen(s);
      const gens = L.bunker!.generators.filter(q => q.level === LV);
      expect(gens.length).toBe(1);
      const plant = one(L, 'Services plant room');
      expect(gens[0].id).toBe('gen-1');
      expect(gens[0].area).toBe(plant.id);
      expect(gens[0].label).toContain('Services plant room');
      expect(m2(plant)).toBeGreaterThanOrEqual(100);
      // its doors open off the works yard, where the service stair lands
      expect(doorsOf(L, plant.id).some(d => d.a === one(L, 'Works yard').id || d.b === one(L, 'Works yard').id)).toBe(true);
    }
  });

  it('declares its hazards: the isolation ward a medium leak behind its airlock (a one-door dead end), the cylinder store sometimes a weak one, never strong', () => {
    let weak = 0;
    for (const s of SEEDS) {
      const {L} = gen(s);
      const zones = L.bunker!.gasZones.filter(z => z.level === LV);
      const g = L.levels[LV].grid;
      const iso = one(L, 'Isolation ward'), cyl = one(L, 'Medical gas store');
      expect(doorsOf(L, iso.id).length).toBe(1);
      const isoZ = zones.filter(z => z.cells.every(i => g.area[i] === iso.id));
      expect(isoZ.length, `seed ${s}`).toBe(1);
      expect(isoZ[0].strength).toBeGreaterThanOrEqual(GAS_STRENGTH.medium[0]);
      expect(isoZ[0].strength).toBeLessThanOrEqual(GAS_STRENGTH.medium[1]);
      for (const z of zones) {
        expect(z.strength).toBeLessThan(0.8);
        const a = g.area[z.cells[0]];
        expect([iso.id, cyl.id]).toContain(a);
        if (a === cyl.id) { weak++; expect(z.strength).toBeLessThanOrEqual(GAS_STRENGTH.weak[1]); }
      }
      expect(L.bunker!.damp.some(id => (L.areas[id].level ?? 0) === LV)).toBe(false);
    }
    expect(weak).toBeGreaterThan(0);
    expect(weak).toBeLessThan(SEEDS.length);
  });

  it('dresses its landmarks: the depot racks, the crane hall, the ward bays, the isolation cubicles, the street islands; within its budgets', () => {
    for (const s of SEEDS) {
      const {L, stats} = gen(s);
      const depot = one(L, 'Supply depot'), ward = one(L, 'Casualty ward'), iso = one(L, 'Isolation ward');
      const props = L.props.filter(p => (p.level ?? 0) === LV);
      expect(stats.skipped, `seed ${s}`).toEqual([]);
      expect(props.filter(p => p.area === depot.id && p.kind === 'annexMachine').length, `seed ${s} racks`).toBeGreaterThanOrEqual(4);
      expect(props.filter(p => p.area === ward.id && p.kind === 'wheeledStretcher').length, `seed ${s} ward beds`).toBeGreaterThanOrEqual(4);
      expect(props.filter(p => p.area === iso.id && p.kind === 'wheeledStretcher').length, `seed ${s} isolation beds`).toBeGreaterThanOrEqual(2);
      expect(stats.cubicles).toBeGreaterThanOrEqual(2);
      const street = byLabel(L, 'Service street').map(a => a.id);
      expect(props.filter(p => street.includes(p.area) && p.kind === 'planterTree').length, `seed ${s} street islands`).toBeGreaterThanOrEqual(1);
      // budgets (the lead's per-storey targets): props <= ~150 (incl. the collision-only footprints), lights <= ~75, decor <= ~150,
      // 25-45 openable loot containers
      const base = L.levels[LV].baseY;
      expect(props.length, `seed ${s} props`).toBeLessThanOrEqual(155);
      expect(props.filter(p => p.kind !== 'annexMachine').length, `seed ${s} rendered props`).toBeLessThanOrEqual(140);
      expect(L.lights.filter(l => (l.level ?? 0) === LV).length, `seed ${s} lights`).toBeLessThanOrEqual(75);
      expect(L.decor.filter(d => d.y0 > base - 0.5 && d.y0 < base + 6.9).length, `seed ${s} decor`).toBeLessThanOrEqual(150);
      const boxes = props.filter(p => isContainerKind(p.kind));
      expect(boxes.length, `seed ${s} containers`).toBeGreaterThanOrEqual(25);
      expect(boxes.length, `seed ${s} containers`).toBeLessThanOrEqual(45);
      // the storey's finds read medical / services: most containers stock medical, storage or workshop loot
      const lootOf = (p: (typeof props)[number]) => p.purpose ?? L.areas[p.area]?.purpose ?? '';
      const themed = boxes.filter(p => ['first-aid-room', 'supply-closet', 'reactor-bunker-decon', 'storage', 'workshop', 'generator-room'].includes(lootOf(p)));
      expect(themed.length / boxes.length, `seed ${s} themed`).toBeGreaterThanOrEqual(0.6);
      expect(boxes.some(p => p.kind === 'fridge' || p.kind === 'kitchenette' || p.kind === 'vending')).toBe(false);
      // nothing of this storey's own on a held apron / in front of the generator
      for (const p of props) expect(p.kind === 'annexMachine' ? p.h : 0).toBeLessThanOrEqual(6.4);
    }
  });

  it('is deterministic', () => {
    const fp = (L: StationLayout) => JSON.stringify({
      areas: L.areas.filter(a => (a.level ?? 0) === LV).map(a => [a.label, a.x, a.y, a.w, a.h, a.ceil, a.purpose]),
      props: L.props.filter(p => (p.level ?? 0) === LV).map(p => [p.kind, p.x, p.z, p.y, p.rot]),
      lights: L.lights.filter(l => (l.level ?? 0) === LV).map(l => [l.x, l.z, l.broken]),
      gas: L.bunker!.gasZones,
    });
    const a = fp(gen(9001).L);
    const b = fp(generateBunkerV2({levelSeed: 9001} as never, {floors: {4: floor4}}));
    expect(b).toBe(a);
  });
});
