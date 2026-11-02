// Task reactor-expansion-20261101 (lane BUNKER): THE BUNKER in the REAL Reactor level (generateReactorLevel, lane HOST's slots) over
// eight seeds: hosted every time (no landing fallback), the whole level valid (reactorIssues incl. complexIssues, doorway lanes,
// reachability, placements on their floors), zone 0's generator in the generator hall, the dress hook's furniture / hero props /
// machinery / plates where they belong (prop rules: storage opens, kinds classified, loot from the room's purpose), the blast door
// lined up with its lane, timing. Focused (no browser).
// Task reactor-playtest-round2-20261102 (lane BUNKER): 12 seeds (the seeded room graph: each level's shelter a different room graph /
// floor plan in the real host slot, every room on the floor-map boards with its label).
import {writeFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {generateReactorLevel, reactorAttempt, reactorIssues, REACTOR_GEN_STATS} from '../src/gen/reactor/index';
import {COMPLEX_HOST_STATS, complexIssues} from '../src/gen/reactor/complex/host';
import {BUNKER_DRESS_STATS} from '../src/gen/reactor/complex/bunkerDress';
import {BLAST, BUNKER_KINDS, BUNKER_PROP_DEFS} from '../src/gen/reactor/complex/bunkerKinds';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS} from '../src/gen/props';
import {OPENABLE_AUDIT, isOpenableKind} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {purposeLoot} from '../src/gen/purposes';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {bunkerModelOrigin, bunkerModelPlacements} from '../src/world/reactor/bunkerModels';
import {planStoreys} from '../src/world/reactor/mapBoardPlan';
import type {StationLayout} from '../src/gen/stationTypes';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const cache = new Map<number, StationLayout>();
const ms: number[] = [];
const gen = (seed: number) => {
  let L = cache.get(seed);
  if (!L) {
    L = generateReactorLevel({levelSeed: seed});
    cache.set(seed, L);
    ms.push((COMPLEX_HOST_STATS.ms.bunker ?? NaN) + BUNKER_DRESS_STATS.ms);
  }
  return L;
};
const bunkerOf = (L: StationLayout) => L.reactor!.complexes!.find(c => c.id === 'bunker')!;
const room = (L: StationLayout, key: string) => bunkerOf(L).rooms.find(r => r.key === key);

describe('the bunker in the real Reactor level (lane BUNKER)', () => {
  it('is hosted on tier 1 for every seed and the whole level validates (reactorIssues incl. complexIssues)', () => {
    const report: string[] = [];
    for (const seed of SEEDS) {
      const L = gen(seed);
      const b = bunkerOf(L);
      const issues = reactorIssues(L);
      report.push(`seed ${seed}: ${b ? `${b.rooms.length} rooms on level ${b.level}` : 'NOT HOSTED'}; issues ${JSON.stringify(issues)}; complex ${JSON.stringify(complexIssues(L))}; dress ${JSON.stringify(BUNKER_DRESS_STATS)}`);
      expect(b, `seed ${seed}`).toBeTruthy();
      expect(b.level).toBe(1);
      expect(b.zone).toBe(0);
      expect(issues, `seed ${seed}`).toEqual([]);
      expect(BUNKER_DRESS_STATS.filled, `seed ${seed} pockets filled`).toBe(0);
    }
    writeFileSync('/tmp/bunker-level-report.txt', report.join('\n'));
  });

  it('zone 0\'s generator stands in the generator hall, its use point clear', () => {
    for (const seed of SEEDS) {
      const L = gen(seed), b = bunkerOf(L), gen0 = L.reactor!.generators.find(g => g.zone === 0)!;
      expect(gen0.area, `seed ${seed}`).toBe(room(L, 'hall')!.area);
      expect(L.levels[1].grid.circleClear(gen0.use.x, gen0.use.z, 0.3), `seed ${seed}`).toBe(true);
      expect(b.generator).toBe(gen0.id);
      // its cable (host: through the complex and out of the entrance) keeps head height over every bunker floor it crosses — it goes
      // round the blast door's raised threshold
      const g = L.levels[1].grid, ids = new Set(b.areas), c = gen0.cable;
      for (let i = 1; i + 1 < c.length; i++) for (let t = 0; t <= 16; t++) {
        const x = c[i].x + (c[i + 1].x - c[i].x) * t / 16, z = c[i].z + (c[i + 1].z - c[i].z) * t / 16, y = c[i].y + (c[i + 1].y - c[i].y) * t / 16;
        const [cx, cy] = g.cellOf(x, z);
        if (!g.inBounds(cx, cy) || !ids.has(g.area[g.idx(cx, cy)]) || g.cells[g.idx(cx, cy)] !== FLOOR) continue;
        expect(y - g.floorOf(g.idx(cx, cy)), `seed ${seed} cable over ${cx},${cy}`).toBeGreaterThanOrEqual(1.95);
      }
    }
  });

  it('dresses by function: bunks + footlockers in the dormitories, gun lockers in the armoury, the console, filtration units, the switchboard, day tanks, the blast door', () => {
    for (const seed of SEEDS) {
      const L = gen(seed), tag = `seed ${seed}`;
      const inRoom = (key: string, kind: string) => { const r = room(L, key); return r ? L.props.filter(p => p.area === r.area && p.kind === kind).length : -1; };
      expect(inRoom('dorm', 'bunkBed'), tag).toBeGreaterThanOrEqual(4);
      expect(inRoom('dorm', 'footlocker'), tag).toBeGreaterThanOrEqual(2);
      expect(inRoom('dorm', 'staffLockers'), tag).toBeGreaterThanOrEqual(1);
      expect(inRoom('armoury', 'gunLocker'), tag).toBeGreaterThanOrEqual(2);
      expect(inRoom('radio', 'radioConsole'), tag).toBe(1);
      expect(inRoom('filtration', 'airFilterUnit'), tag).toBeGreaterThanOrEqual(1);
      expect(inRoom('hall', 'electricalPanel'), tag).toBeGreaterThanOrEqual(1);
      expect(inRoom('hall', 'annexMachine'), `${tag} day tank(s) + the skid`).toBeGreaterThanOrEqual(2);
      expect(inRoom('mess', 'table'), tag).toBeGreaterThanOrEqual(2);
      const bd = L.props.filter(p => p.kind === 'blastDoor');
      expect(bd.length, tag).toBe(5);
      expect(bd.filter(p => p.variant === 0).length, tag).toBe(1);
      expect(bunkerModelPlacements(L, 'blastDoor').length, tag).toBe(1);
    }
  });

  it('every prop the bunker holds stands on its own floor, inside its ceiling, never in a doorway lane; storage opens / holds purpose loot', () => {
    const profile = lootProfile('reactor');
    for (const seed of SEEDS) {
      const L = gen(seed), b = bunkerOf(L), ids = new Set(b.areas), g = L.levels[1].grid, tag = `seed ${seed}`;
      for (const p of L.props.filter(q => ids.has(q.area))) {
        expect(p.level, `${tag} ${p.kind}`).toBe(1);
        const [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(g.cells[i], `${tag} ${p.kind} on floor`).toBe(FLOOR);
        if (!p.mounted && p.host === undefined && p.kind !== 'noticeBoard') expect(Math.abs(p.y - g.floorOf(i)), `${tag} ${p.kind} y ${p.y} floor ${g.floorOf(i)}`).toBeLessThan(0.03);
        expect(p.y + p.h, `${tag} ${p.kind} ceiling`).toBeLessThanOrEqual(g.ceil[i] + 0.05);
        // storage: an openable container or an existing holder with a purpose / own loot table in this room
        if (isLootHolderKind(p.kind)) {
          const t = holderTable(p.kind, p.purpose ?? L.areas[p.area].purpose ?? '', profile);
          expect(t.rows.length + (t.source === 'fixture' ? 1 : 0), `${tag} ${p.kind} in ${L.areas[p.area].label} has loot rows`).toBeGreaterThan(0);
        }
      }
      // the bunker's custom purposes' holders resolve to their named tables
      for (const key of ['dorm', 'armoury']) {
        const a = L.areas[room(L, key)!.area];
        for (const k of ['footlocker', 'gunLocker', 'cabinetTall', 'crate', 'staffLockers']) expect(purposeLoot(a.purpose, k), `${tag} ${key} ${k}`).toBeDefined();
      }
    }
  });

  it('classifies every hero kind (openables + physics audits), real-size footprints from the cooked models', () => {
    for (const k of BUNKER_KINDS) {
      expect(OPENABLE_AUDIT.filter(e => e.kind === k).length, k).toBe(1);
      expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('static');
      expect(isOpenableKind(k), k).toBe(false);
      expect(PROP_DEFS[k], k).toBe(BUNKER_PROP_DEFS[k]);
    }
    expect(PROP_DEFS.radioConsole.h).toBeCloseTo(1.5698 * 1.125, 2);
    expect(PROP_DEFS.bunkBed.w).toBeCloseTo(2.0, 3);
  });

  it('the blast door\'s render anchor lines the round opening up with the lane through the bulkhead', () => {
    for (const seed of SEEDS) {
      const L = gen(seed), tag = `seed ${seed}`;
      const lock = room(L, 'lock')!.area, decon = room(L, 'decon')!.area;
      const d = L.doors.find(q => q.a === lock && q.b === decon)!;
      const p = bunkerModelPlacements(L, 'blastDoor')[0];
      const [ox, oz] = bunkerModelOrigin(p);
      // the opening's centre (model x = BLAST.openX) sits on the lane's centre line; the body centre on the bulkhead's
      const c = Math.cos(p.rot), s = Math.sin(p.rot), zc = (BLAST.bodyZ[0] + BLAST.bodyZ[1]) / 2;
      const wx = ox + BLAST.openX * c + zc * s, wz = oz - BLAST.openX * s + zc * c;
      expect(Math.abs(wx - (d.x + d.w / 2) * CELL), tag).toBeLessThan(0.05);
      expect(Math.abs(wz - (d.y + d.h / 2) * CELL), tag).toBeLessThan(0.05);
    }
  });

  it('never seals a floor pocket: seed 2800420178 attempt 0 (props once closed 3 decontamination cells off) validates, one attempt', () => {
    const L = reactorAttempt({levelSeed: 2800420178}, 0)!;
    expect(L).toBeTruthy();
    expect(reactorIssues(L)).toEqual([]);
    expect(BUNKER_DRESS_STATS.filled).toBe(0);
    generateReactorLevel({levelSeed: 2800420178});
    expect(REACTOR_GEN_STATS.attempts).toBe(1);
  });

  it('every level seed builds a different shelter (room graph + floor plan up to translation); every room is on the map boards', () => {
    const graphs = new Set<string>(), plans = new Set<string>();
    for (const seed of SEEDS) {
      const L = gen(seed), b = bunkerOf(L), tag = `seed ${seed}`;
      const key = new Map(b.rooms.map(r => [r.area, r.key.replace(/^corr\d+$/, 'corr').replace(/\d+$/, '')]));
      const ids = new Set(b.areas);
      const pairs = L.doors.filter(d => ids.has(d.a) && ids.has(d.b)).map(d => [key.get(d.a)!, key.get(d.b)!].sort().join('-')).sort();
      graphs.add(`${b.rooms.map(r => key.get(r.area)).sort().join(',')}|${pairs.join(',')}`);
      const lock = L.areas[room(L, 'lock')!.area];
      plans.add(b.rooms.map(r => { const a = L.areas[r.area]; return `${key.get(r.area)}:${a.x - lock.x},${a.y - lock.y},${a.w}x${a.h}`; }).sort().join(' '));
      // the floor-map boards label every bunker space (corridors by the wing of the rooms on them)
      const st = planStoreys(L, L.reactor!).storeys.find(s => s.level === b.level)!;
      for (const r of b.rooms) {
        const a = L.areas[r.area];
        expect(st.rooms.some(q => q.label === r.label.toUpperCase() && Math.abs(q.x - (a.x + a.w / 2) * CELL) < 1e-6), `${tag} ${r.key} on the map`).toBe(true);
        if (r.role === 'corridor') expect(r.label, tag).toMatch(/^(Muster corridor|Quarters corridor|Plant corridor|Operations corridor|Service passage)( [B-D])?$/);
      }
    }
    expect(graphs.size).toBe(SEEDS.length);
    expect(plans.size).toBe(SEEDS.length);
  });

  it('carves + dresses inside the budget (< 60 ms per level)', () => {
    for (const seed of SEEDS) gen(seed);
    const med = ms.filter(Number.isFinite).sort((a, b) => a - b)[Math.floor(ms.length / 2)];
    expect(med).toBeLessThan(60);
  });
});
