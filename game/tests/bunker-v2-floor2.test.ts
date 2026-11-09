// Task studio-bunker-rework-20261109-205115-01: THE BUNKER v2 — storey 2 (HABITATION, gen/bunker/v2/floor2.ts + floor2Dress.ts).
// Over eight seeds (each generated once): the whole level stays valid; the habitation programme is all there with its purposes; the
// commons is exactly the V12 void at its full clear height and nothing else on the storey is taller than a hall; a real mix of scales
// (the 11.6 m nave, 4-6 m halls, 3 m rooms and 2 m streets); the anchors served by one open area each; the gen-0 plant room; the
// declared hazards (at most a weak laundry leak); the compositions (the lamp ring, the hearth, the stage, the refectory, the quarters'
// personal storage); no food holders outside the kitchen / pantry; budgets; determinism.

import {beforeAll, describe, expect, it} from 'vitest';
import {generateBunkerLevel} from '../src/gen/bunker/index';
import {bunkerIssues} from '../src/gen/bunker/validate';
import {bunkerV2Issues} from '../src/gen/bunker/v2/validate';
import {bunkerSpine, V2_BASES} from '../src/gen/bunker/v2/spine';
import {F2_DOORS, F2_PLAN} from '../src/gen/bunker/v2/floor2';
import {F2_DRESS_STATS} from '../src/gen/bunker/v2/floor2Dress';
import {CELL, FLOOR} from '../src/gen/grid';
import {HOLDER_LOTS} from '../src/items/lootTables';
import {isOpenableKind} from '../src/world/openablesSpec';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const SEEDS = [9001, 16920, 4401, 12320, 7, 31337, 2024, 555];
const LV = 2, BASE = V2_BASES[LV];
const sp = bunkerSpine();

interface Run { L: StationLayout; areas: Record<string, Area>; dress: typeof F2_DRESS_STATS }
const RUNS = new Map<number, Run>();

/** The storey's areas by plan key (matched by rect: the carve keeps the plan's rects). */
function byKey(L: StationLayout): Record<string, Area> {
  const out: Record<string, Area> = {};
  for (const s of F2_PLAN) {
    const a = L.areas.find(q => (q.level ?? 0) === LV && q.x === s.rect.x && q.y === s.rect.y && q.w === s.rect.w && q.h === s.rect.h);
    if (a) out[s.key] = a;
  }
  return out;
}

beforeAll(() => {
  for (const seed of SEEDS) {
    const L = generateBunkerLevel({levelSeed: seed});
    RUNS.set(seed, {L, areas: byKey(L), dress: JSON.parse(JSON.stringify(F2_DRESS_STATS))});
  }
}, 120_000);

const run = (seed: number): Run => RUNS.get(seed)!;
const relClear = (a: Area) => a.ceil - BASE;

describe('Bunker v2 storey 2 — habitation', () => {
  it('the whole level is valid on every seed', () => {
    for (const seed of SEEDS) {
      const {L} = run(seed);
      const issues = [...bunkerIssues(L), ...bunkerV2Issues(L)];
      expect(issues, `seed ${seed}`).toEqual([]);
      expect(L.bunker?.version).toBe(2);
    }
  });

  it('carries the whole habitation programme with living purposes', () => {
    for (const seed of SEEDS) {
      const {areas} = run(seed);
      for (const s of F2_PLAN) expect(areas[s.key], `seed ${seed} ${s.key}`).toBeDefined();
      expect(areas.kitchen.purpose).toBe('staff-room');
      expect(areas.pantry.purpose).toBe('stock-room');
      expect(areas.latrines.type).toBe('washroom');
      expect(areas.plant.purpose).toBe('generator-room');
      expect(areas.games.purpose).toBe('locker-room');
      for (const k of ['dormA', 'dormB', 'school', 'nursery', 'laundry', 'westSt', 'southSt']) expect(areas[k].purpose, k).toBe('reactor-bunker-dormitory');
      // one dormitory houses the families
      expect([areas.dormA.label, areas.dormB.label].sort()).toEqual(['Dormitory', 'Family quarters']);
      // every planned opening is a door of the layout between the right two areas
      for (const [ka, kb, gap] of F2_DOORS) {
        const d = run(seed).L.doors.find(q => (q.level ?? 0) === LV && q.x === gap.x && q.y === gap.y && q.w === gap.w && q.h === gap.h);
        expect(d, `${ka}-${kb}`).toBeDefined();
        expect(new Set([d!.a, d!.b])).toEqual(new Set([areas[ka].id, areas[kb].id]));
      }
    }
  });

  it('the commons is exactly the V12 void at its full height; nothing else rises above a hall', () => {
    const v = sp.voids.find(q => q.id === 'V12')!;
    for (const seed of SEEDS) {
      const {L, areas} = run(seed);
      const c = areas.commons;
      expect({x: c.x, y: c.y, w: c.w, h: c.h}).toEqual(v.rect);
      expect(c.ceil).toBeCloseTo(v.ceil, 2);
      expect(relClear(c)).toBeCloseTo(11.6, 1);
      for (const a of L.areas) if ((a.level ?? 0) === LV && a.id !== c.id && a.role !== 'stair') expect(relClear(a), a.label).toBeLessThanOrEqual(6.7);
    }
  });

  it('mixes real changes of scale: the nave, halls, rooms and tight streets', () => {
    const {areas} = run(SEEDS[0]);
    const m2 = (a: Area) => a.w * a.h * CELL * CELL;
    // the great shared room and the open civic block round it (mess + landing open wide into it)
    expect(m2(areas.commons)).toBeGreaterThanOrEqual(160);
    expect(m2(areas.commons) + m2(areas.mess) + m2(areas.landing)).toBeGreaterThanOrEqual(450);
    const halls = Object.values(areas).filter(a => relClear(a) >= 4.2 && relClear(a) <= 6.4);
    expect(halls.length).toBeGreaterThanOrEqual(4);
    const rooms = Object.values(areas).filter(a => relClear(a) <= 3.6 && Math.min(a.w, a.h) >= 8);
    expect(rooms.length).toBeGreaterThanOrEqual(8);
    // the streets / aisles: 2-3 m wide and long (the constrained spaces)
    for (const k of ['westSt', 'southSt', 'arcade']) {
      expect(Math.min(areas[k].w, areas[k].h) * CELL, k).toBeLessThanOrEqual(2.0);
      expect(Math.max(areas[k].w, areas[k].h) * CELL, k).toBeGreaterThanOrEqual(19);
    }
    // the wide openings onto the commons: the mess front 8 m, three arches each side
    const commonsDoors = F2_DOORS.filter(([a, b]) => a === 'commons' || b === 'commons');
    expect(commonsDoors.length).toBe(7);
    expect(Math.max(...commonsDoors.map(([, , g]) => Math.max(g.w, g.h) * CELL))).toBeGreaterThanOrEqual(8);
  });

  it('serves every anchor apron with one open, unfurnished area', () => {
    for (const seed of SEEDS) {
      const {L, areas} = run(seed);
      const g = L.levels[LV].grid;
      for (const an of sp.storeys[LV].anchors) {
        const ids = new Set<number>();
        for (let y = an.apron.y; y < an.apron.y + an.apron.h; y++) for (let x = an.apron.x; x < an.apron.x + an.apron.w; x++) {
          const i = g.idx(x, y);
          expect(g.cells[i], `${an.id} ${x},${y}`).toBe(FLOOR);
          expect(g.blocked[i], `${an.id} blocked ${x},${y}`).toBe(0);
          ids.add(g.area[i]);
        }
        expect(ids.size, an.id).toBe(1);
        const want = an.id === 'stairB' ? areas.lobby : areas.landing;
        expect([...ids][0], an.id).toBe(want.id);
      }
    }
  });

  it('stands generator gen-0 in the habitation plant room, reached by the stairs', () => {
    for (const seed of SEEDS) {
      const {L, areas} = run(seed);
      const gen = L.bunker!.generators.find(q => q.id === 'gen-0')!;
      expect(gen.level).toBe(LV);
      expect(gen.area).toBe(areas.plant.id);
      expect(gen.label).toMatch(/Habitation plant room/);
      // the plant room opens off the service landing, the service stair's own area
      expect(L.doors.some(d => (d.a === areas.plant.id && d.b === areas.lobby.id) || (d.b === areas.plant.id && d.a === areas.lobby.id))).toBe(true);
    }
  });

  it('declares its hazards: at most a weak leak, in the laundry; the aged dormitory', () => {
    let leaks = 0;
    for (const seed of SEEDS) {
      const {L, areas} = run(seed);
      const zones = L.bunker!.gasZones.filter(z => z.level === LV);
      expect(zones.length).toBeLessThanOrEqual(1);
      for (const z of zones) {
        leaks++;
        expect(z.strength).toBeLessThan(0.5);
        expect(L.levels[LV].grid.area[z.cells[0]]).toBe(areas.laundry.id);
      }
      expect(L.bunker!.damp.some(id => (L.areas[id].level ?? 0) === LV)).toBe(false);
      // the plain dormitory is the aged one: no lit fixture in it
      const plain = areas.dormA.label === 'Dormitory' ? areas.dormA : areas.dormB;
      expect(['dark', 'dim']).toContain(plain.lighting);
    }
    expect(leaks).toBeGreaterThan(0);
    expect(leaks).toBeLessThan(SEEDS.length);
  });

  it('builds its compositions: the lamp ring, the hearth, the stage, the refectory, the green walk', () => {
    for (const seed of SEEDS) {
      const {L, areas, dress} = run(seed);
      expect(dress.skipped, `seed ${seed}`).toEqual([]);
      for (const n of ['hearth bed', 'stage', 'servery', 'planting trough']) expect(dress.built, `seed ${seed}`).toContain(n);
      expect(dress.built.filter(b => b.startsWith('refectory')).length).toBe(3);
      // the lamp ring: eight fixtures hung in the well, 6.4 m up
      const ring = L.lights.filter(l => l.area === areas.commons.id && Math.abs(l.y - BASE - 6.38) < 0.05);
      expect(ring.length).toBe(8);
      const inCommons = (k: string) => L.props.filter(p => p.area === areas.commons.id && p.kind === k).length;
      expect(inCommons('planterTree')).toBeGreaterThanOrEqual(2);
      expect(inCommons('bench')).toBeGreaterThanOrEqual(3);
      expect(L.props.filter(p => p.area === areas.green.id && (p.kind === 'planterTree' || p.kind === 'pottedPlantSmall' || p.kind === 'deadPlant')).length).toBeGreaterThanOrEqual(4);
      expect(L.props.some(p => p.area === areas.games.id && p.kind === 'pingPongTable')).toBe(true);
      expect(L.props.some(p => p.area === areas.school.id && p.kind === 'mobileWhiteboard')).toBe(true);
      expect(L.props.some(p => p.area === areas.nursery.id && p.kind === 'rockingHorse')).toBe(true);
    }
  });

  it('stocks living loot: personal storage in the quarters, food only by the kitchen / pantry purposes', () => {
    const FOOD = new Set(['fridge', 'kitchenette', 'stockShelf', 'snackRack', 'vending', 'chestFreezer', 'shopCooler', 'breadRack']);
    for (const seed of SEEDS) {
      const {L, areas} = run(seed);
      const mine = L.props.filter(p => (p.level ?? 0) === LV);
      // personal storage: a footlocker or locker for the sleepers of both quarters
      for (const k of ['dormA', 'dormB']) {
        const inQ = mine.filter(p => p.area === areas[k].id);
        expect(inQ.filter(p => p.kind === 'bunkBed').length, `${seed} ${k} bunks`).toBeGreaterThanOrEqual(5);
        expect(inQ.filter(p => p.kind === 'footlocker' || p.kind === 'staffLockers').length, `${seed} ${k} storage`).toBeGreaterThanOrEqual(6);
      }
      // openable storage (lockers, footlockers, cabinets, crates, bins …) — the living storey's finds
      const holders = mine.filter(p => (isOpenableKind(p.kind) || HOLDER_LOTS[p.kind] !== undefined) && !FOOD.has(p.kind) && !['table', 'desk', 'toiletStall'].includes(p.kind));
      expect(holders.length, `seed ${seed} holders`).toBeGreaterThanOrEqual(25);
      expect(holders.length, `seed ${seed} holders`).toBeLessThanOrEqual(60);
      // food holders stand only where the station dresser put them by purpose (the kitchen, the pantry)
      for (const p of mine) if (FOOD.has(p.kind)) expect([areas.kitchen.id, areas.pantry.id], `${seed} ${p.kind} in ${L.areas[p.area].label}`).toContain(p.area);
    }
  });

  it('keeps within the storey budgets', () => {
    for (const seed of SEEDS) {
      const {L, dress} = run(seed);
      const props = L.props.filter(p => (p.level ?? 0) === LV).length;
      const lights = L.lights.filter(l => (l.level ?? 0) === LV).length;
      expect(props, `seed ${seed} props`).toBeLessThanOrEqual(165);
      expect(lights, `seed ${seed} lights`).toBeLessThanOrEqual(85);
      expect(dress.decor, `seed ${seed} decor`).toBeLessThanOrEqual(150);
    }
  });

  it('is deterministic', () => {
    const seed = SEEDS[1];
    const a = run(seed).L, b = generateBunkerLevel({levelSeed: seed});
    const pick = (L: StationLayout) => JSON.stringify({
      areas: L.areas.filter(q => (q.level ?? 0) === LV).map(q => [q.x, q.y, q.w, q.h, q.ceil, q.label, q.purpose, q.lighting]),
      props: L.props.filter(p => (p.level ?? 0) === LV).map(p => [p.kind, p.x, p.y, p.z, p.rot]),
      decor: L.decor.filter(d => d.y0 >= BASE - 0.5 && d.y1 <= BASE + 12).map(d => [d.m, d.x0, d.y0, d.z0, d.x1, d.y1, d.z1]),
      lights: L.lights.filter(l => (l.level ?? 0) === LV).map(l => [l.x, l.y, l.z, l.broken]),
      signs: L.signs.filter(s => (s.level ?? 0) === LV).map(s => [s.text, s.x, s.z]),
    });
    expect(pick(b)).toBe(pick(a));
  });
});
