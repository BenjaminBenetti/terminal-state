// Task reactor-expansion-20261101 (lane BUNKER): THE BUNKER carver on a stand-alone complex slot (tests/reactor-x-bunker-fixture.ts),
// across seeds, all four inward directions and region shapes: stays inside its region, opens onto the gallery through the entrance,
// every space connected (and the loops), the program (rooms, size, heights, doorways), the dead-end armoury, the blast door's
// threshold, the generator (inside the hall, use point clear), determinism and time. Pure data (no browser).
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, STEP_UP} from '../src/gen/grid';
import {carveBunker, BUNKER_FAILS} from '../src/gen/reactor/complex/bunker';
import {BUNKER} from '../src/gen/reactor/complex/bunkerPlan';
import {BLAST} from '../src/gen/reactor/complex/bunkerKinds';
import {ROOM_PURPOSES} from '../src/gen/purposes';
import type {ComplexCarve, ComplexSlot} from '../src/gen/reactor/complex/types';
import {BASE, fixture, type Fixture} from './reactor-x-bunker-fixture';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const INWARD: ComplexSlot['inward'][] = ['S', 'N', 'E', 'W'];
const SHAPES: [number, number][] = [[80, 64], [64, 80], [96, 72]];

function carve(seed: number, inward: ComplexSlot['inward'], along = 80, deep = 64, o: Parameters<typeof fixture>[4] = {}): {f: Fixture; c: ComplexCarve} {
  const f = fixture(seed, inward, along, deep, o);
  const c = carveBunker({k: f.k, rng: f.rng, slot: f.slot, levelOpt: f.levelOpt});
  if (!c) throw new Error(`no carve: seed ${seed} ${inward} ${along}x${deep} ${JSON.stringify(BUNKER_FAILS)}`);
  return {f, c};
}

/** Cell BFS on level 1 from the gallery through walkable neighbours (FLOOR, step <= STEP_UP); returns the reached cell set. */
function reach(f: Fixture, blockedDoor?: number): Set<number> {
  const g = f.k.grid(1), front = f.k.areas[f.slot.frontArea];
  const start = g.idx(front.x + 1, front.y + 1);
  const seen = new Set<number>([start]), q = [start];
  const skip = blockedDoor !== undefined ? new Set<number>((() => { const d = f.k.doors[blockedDoor], out: number[] = []; for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) out.push(g.idx(x, y)); return out; })()) : null;
  while (q.length) {
    const i = q.pop()!;
    const x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = g.idx(x + dx, y + dy);
      if (seen.has(j) || g.cells[j] !== FLOOR || skip?.has(j)) continue;
      if (Math.abs(g.floor[j] - g.floor[i]) > STEP_UP + 1e-6) continue;
      seen.add(j); q.push(j);
    }
  }
  return seen;
}

describe('Reactor bunker carver (lane BUNKER)', () => {
  it('fits every seed x inward direction x region shape, inside its region, opening onto the gallery', () => {
    for (const seed of SEEDS) for (const inward of INWARD) for (const [along, deep] of SHAPES) {
      const {f, c} = carve(seed, inward, along, deep);
      const R = f.slot.region, g = f.k.grid(1);
      const tag = `seed ${seed} ${inward} ${along}x${deep}`;
      for (const id of c.areas) {
        const a = f.k.areas[id];
        expect(a.x >= R.x && a.y >= R.y && a.x + a.w <= R.x + R.w && a.y + a.h <= R.y + R.h, `${tag} ${a.label} inside`).toBe(true);
        expect(a.level, tag).toBe(1);
        expect(a.floorY, tag).toBe(BASE);
      }
      // the entry is the lock, joined to the gallery through the entrance span
      expect(c.entryArea, tag).toBe(c.areas[0]);
      const ent = f.k.doors.find(d => d.x === f.slot.entrance.x && d.y === f.slot.entrance.y && d.w === f.slot.entrance.w && d.h === f.slot.entrance.h);
      expect(ent, tag).toBeTruthy();
      expect([ent!.a, ent!.b].sort()).toEqual([f.slot.frontArea, c.entryArea].sort());
      // nothing carved outside the region on this storey except the gallery
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const i = g.idx(x, y);
        if (g.cells[i] !== FLOOR || g.area[i] === f.slot.frontArea) continue;
        expect(x >= R.x && y >= R.y && x < R.x + R.w && y < R.y + R.h, `${tag} cell ${x},${y}`).toBe(true);
      }
    }
  });

  it('every space is connected from the gallery; at least two ways from the muster corridor to the generator hall (loops)', () => {
    for (const seed of SEEDS) for (const inward of INWARD) {
      const {f, c} = carve(seed, inward);
      const g = f.k.grid(1), tag = `seed ${seed} ${inward}`;
      const seen = reach(f);
      for (const id of c.areas) {
        const a = f.k.areas[id];
        for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
          const i = g.idx(x, y);
          if (g.cells[i] === FLOOR) expect(seen.has(i), `${tag} ${a.label} cell ${x},${y}`).toBe(true);
        }
      }
      // area graph: cycle rank >= 2; the hall stays reachable without any one door between the muster corridor and it
      const ids = new Set(c.areas);
      const edges = f.k.doors.filter(d => ids.has(d.a) && ids.has(d.b));
      expect(edges.length - ids.size + 1, tag).toBeGreaterThanOrEqual(2);
      const hall = c.rooms.find(r => r.key === 'hall')!.area, hallCell = (() => { const a = f.k.areas[hall]; return g.idx(a.x + 1, a.y + 1); })();
      const spineDoors = f.k.doors.map((d, i) => [d, i] as const).filter(([d]) => [d.a, d.b].some(x => c.rooms.find(r => r.area === x && (r.key === 'spineW' || r.key === 'spineE'))));
      for (const [, i] of spineDoors) expect(reach(f, i).has(hallCell), `${tag} hall without door ${i}`).toBe(true);
    }
  });

  it('the program: >= 8 spaces of the bunker brief, >= 600 m2 walkable, real heights / doorways, a dead-end armoury', () => {
    const KEYS = ['lock', 'decon', 'guard', 'muster', 'spineW', 'spineE', 'mess', 'hall', 'switch', 'armoury', 'dorm', 'filtration', 'infirmary', 'radio'];
    for (const seed of SEEDS) for (const inward of ['S', 'E'] as const) {
      const {f, c} = carve(seed, inward);
      const g = f.k.grid(1), tag = `seed ${seed} ${inward}`;
      const keys = c.rooms.map(r => r.key);
      for (const k of KEYS) expect(keys, `${tag} ${k}`).toContain(k);
      expect(c.rooms.length, tag).toBeGreaterThanOrEqual(15);
      let cells = 0;
      for (const id of c.areas) { const a = f.k.areas[id]; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.cells[g.idx(x, y)] === FLOOR && g.area[g.idx(x, y)] === id) cells++; }
      expect(cells * CELL * CELL, tag).toBeGreaterThanOrEqual(600);
      for (const r of c.rooms) {
        const a = f.k.areas[r.area], clear = a.ceil - BASE;
        expect(a.ceil, `${tag} ${r.key} ceilMax`).toBeLessThanOrEqual(f.slot.ceilMax + 1e-9);
        expect(clear, `${tag} ${r.key} clear`).toBeGreaterThanOrEqual(3.0);
        if (r.key !== 'hall') expect(clear, `${tag} ${r.key} clear`).toBeLessThanOrEqual(4.0 + 1e-9);
        expect(a.purpose && ROOM_PURPOSES[a.purpose], `${tag} ${r.key} purpose ${a.purpose}`).toBeTruthy();
        expect(a.label, tag).toBe(r.label);
        // corridors >= 2 m wide
        if (r.role === 'corridor') expect(Math.min(a.w, a.h) * CELL, `${tag} ${r.key}`).toBeGreaterThanOrEqual(2.0);
      }
      expect(f.k.areas[c.rooms.find(r => r.key === 'hall')!.area].ceil - BASE, tag).toBeGreaterThan(4.5);
      // doorways: >= 1.5 m wide (one cell deep, or the 2-cell bulkhead), 2.3-3.1 m tall
      const ids = new Set(c.areas);
      for (const d of f.k.doors.filter(q => ids.has(q.b))) {
        const width = (d.h === 1 || (d.w > d.h && d.h <= 2 && d.w >= 3) ? d.w : d.h) * CELL;
        expect(width, `${tag} door ${d.id}`).toBeGreaterThanOrEqual(1.5);
        expect(d.height, `${tag} door ${d.id}`).toBeGreaterThanOrEqual(2.3);
      }
      // the armoury is a dead end (one door, off the generator hall)
      const arm = c.rooms.find(r => r.key === 'armoury')!.area, hall = c.rooms.find(r => r.key === 'hall')!.area;
      const armDoors = f.k.doors.filter(d => d.a === arm || d.b === arm);
      expect(armDoors.length, tag).toBe(1);
      expect([armDoors[0].a, armDoors[0].b]).toContain(hall);
    }
  });

  it('the blast door bulkhead: a 1.5 m lane over a raised threshold (risers <= 0.3 m) inside the round opening; clear 2.1 m above it', () => {
    for (const seed of SEEDS) for (const inward of INWARD) {
      const {f, c} = carve(seed, inward);
      const g = f.k.grid(1), tag = `seed ${seed} ${inward}`;
      const lock = c.rooms.find(r => r.key === 'lock')!.area, decon = c.rooms.find(r => r.key === 'decon')!.area;
      const bh = f.k.doors.find(d => d.a === lock && d.b === decon)!;
      expect(bh, tag).toBeTruthy();
      expect(Math.max(bh.w, bh.h), tag).toBe(3);
      expect(Math.min(bh.w, bh.h), tag).toBe(BUNKER.bulkhead);
      const floors = new Set<number>(), ceils = new Set<number>();
      for (let y = bh.y; y < bh.y + bh.h; y++) for (let x = bh.x; x < bh.x + bh.w; x++) { floors.add(g.floor[g.idx(x, y)]); ceils.add(g.ceil[g.idx(x, y)]); }
      expect([...floors].map(v => +(v - BASE).toFixed(2)), tag).toEqual([BLAST.sill]);
      expect(Math.min(...ceils) - Math.max(...floors), tag).toBeGreaterThanOrEqual(2.1 + 0.12 - 1e-6);
      // walking the lane through the bulkhead: every riser <= 0.3 m, the sill level one row out each side (under the frame's
      // proud faces), back to the room floor 4 cells out on both sides
      const alongX = bh.h === BUNKER.bulkhead;
      for (let a = 0; a < 3; a++) {
        const prof: number[] = [];
        for (let t = -4; t < BUNKER.bulkhead + 4; t++) {
          const [x, y] = alongX ? [bh.x + a, bh.y + t] : [bh.x + t, bh.y + a];
          expect(g.cells[g.idx(x, y)], `${tag} lane ${x},${y}`).toBe(FLOOR);
          prof.push(g.floor[g.idx(x, y)]);
        }
        expect(prof[0], tag).toBe(BASE);
        expect(prof[prof.length - 1], tag).toBe(BASE);
        for (let t = 1; t < prof.length; t++) expect(Math.abs(prof[t] - prof[t - 1]), tag).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('places the zone generator inside the generator hall: skid on its floor, the use point walkable, off the skid, facing it', () => {
    for (const seed of SEEDS) for (const inward of INWARD) {
      const {f, c} = carve(seed, inward);
      const g = f.k.grid(1), tag = `seed ${seed} ${inward}`;
      const hall = c.rooms.find(r => r.key === 'hall')!.area;
      expect(c.generator.area, tag).toBe(hall);
      const ft = c.generator.foot;
      expect(ft.w * ft.h, tag).toBe(32);
      for (let y = ft.y - 2; y < ft.y + ft.h + 2; y++) for (let x = ft.x - 2; x < ft.x + ft.w + 2; x++) {
        expect(g.cells[g.idx(x, y)], `${tag} skid ring ${x},${y}`).toBe(FLOOR);
        expect(g.area[g.idx(x, y)], tag).toBe(hall);
      }
      const {x, y, yaw} = c.generator.use;
      expect(g.area[g.idx(x, y)], tag).toBe(hall);
      expect(x >= ft.x && x < ft.x + ft.w && y >= ft.y && y < ft.y + ft.h, tag).toBe(false);
      // facing: forward (-sin yaw, -cos yaw) points at the skid's centre
      const cx = ft.x + ft.w / 2, cy = ft.y + ft.h / 2, dx = cx - (x + 0.5), dy = cy - (y + 0.5), n = Math.hypot(dx, dy);
      expect((-Math.sin(yaw) * dx - Math.cos(yaw) * dy) / n, tag).toBeGreaterThan(0.95);
      // long axis along the hall's long side
      expect(Math.abs(c.generator.yaw) < 1e-6 ? ft.w > ft.h : ft.h > ft.w, tag).toBe(true);
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const sig = (c: ComplexCarve, f: Fixture) => JSON.stringify({areas: c.areas.map(id => f.k.areas[id]), doors: f.k.doors, gen: c.generator, rooms: c.rooms});
    const a = carve(5, 'E'), b = carve(5, 'E');
    expect(sig(a.c, a.f)).toBe(sig(b.c, b.f));
    expect(new Set(SEEDS.map(s => { const r = carve(s, 'S'); return sig(r.c, r.f); })).size).toBe(SEEDS.length);
  });

  it('returns null (host fallback) when the region is too small; carves fast (< 60 ms)', () => {
    const f = fixture(1, 'S', 50, 50);
    expect(carveBunker({k: f.k, rng: f.rng, slot: f.slot, levelOpt: f.levelOpt})).toBeNull();
    // the entrance outside the region's edge, an off-centre entrance, a wide entrance, a low ceilMax still fit
    carve(2, 'W', 80, 64, {edge: false});
    carve(3, 'S', 80, 64, {at: 0.15});
    carve(4, 'N', 80, 64, {at: 0.85, ew: 8});
    const low = carve(6, 'E', 80, 64, {ceil: BASE + 4.2});
    for (const id of low.c.areas) expect(low.f.k.areas[id].ceil).toBeLessThanOrEqual(BASE + 4.2 + 1e-9);
    const t0 = performance.now();
    for (const seed of SEEDS) carve(seed, 'S');
    expect((performance.now() - t0) / SEEDS.length).toBeLessThan(60);
  });
});
