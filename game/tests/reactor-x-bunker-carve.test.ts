// Task reactor-expansion-20261101 (lane BUNKER): THE BUNKER carver on a stand-alone complex slot (tests/reactor-x-bunker-fixture.ts),
// across seeds, all four inward directions and region shapes: stays inside its region, opens onto the gallery through the entrance,
// every space connected (and the loops), the program (rooms, size, heights, doorways), the dead-end armoury, the blast door's
// threshold, the generator (inside the hall, use point clear), determinism and time. Pure data (no browser).
//
// Task reactor-playtest-round2-20261102 (lane BUNKER): the bunker is now a SEEDED ROOM GRAPH (user: "the layout … is much to normal
// right now … it should be random! with logical rooms flowing in to one another!"). Intent changes, not coverage cuts: the old fixed
// plan's keys (two spine corridors 'spineW' / 'spineE') are gone, so the "two ways into the hall" check now covers EVERY door outside
// the entry chain (stronger than the old spine doors only). New: doors sit on shared walls, functional adjacency (an independent spec
// of which rooms may open onto which), and VARIETY across 16 seeds on one fixed slot (topology hashes, geometry up to translation, the
// muster / entry / hall / optional-room variants).
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR, STEP_UP} from '../src/gen/grid';
import {carveBunker, BUNKER_FAILS} from '../src/gen/reactor/complex/bunker';
import {BUNKER} from '../src/gen/reactor/complex/bunkerPlan';
import {BLAST} from '../src/gen/reactor/complex/bunkerKinds';
import {doorSide} from '../src/gen/placeKit';
import {ROOM_PURPOSES} from '../src/gen/purposes';
import type {ComplexCarve, ComplexSlot} from '../src/gen/reactor/complex/types';
import type {Area, Door} from '../src/gen/stationTypes';
import {BASE, fixture, type Fixture} from './reactor-x-bunker-fixture';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** The variety sample: 16 seeds on ONE fixed slot (only the seed varies). */
const VARIETY = Array.from({length: 16}, (_, i) => 101 + i * 7);
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

/** A room key's class: corridors other than the muster corridor are 'corr', duplicates lose their number ('store2' -> 'store'). */
const klass = (k: string) => (/^corr\d+$/.test(k) ? 'corr' : k.replace(/\d+$/, ''));
const keysOf = (c: ComplexCarve, f: Fixture) => { const m = new Map<number, string>(c.rooms.map(r => [r.area, r.key])); m.set(f.slot.frontArea, 'gallery'); return m; };
/** The bunker's doors (both sides bunker areas or the gallery), with their two room keys. */
function doorPairs(c: ComplexCarve, f: Fixture): {d: Door; a: string; b: string}[] {
  const keys = keysOf(c, f);
  return f.k.doors.filter(d => keys.has(d.a) && keys.has(d.b)).map(d => ({d, a: keys.get(d.a)!, b: keys.get(d.b)!}));
}

/**
 * FUNCTIONAL ADJACENCY (independent of the generator's own tables): the room classes each room may share a door with. Corridors
 * ('muster', 'corr') take whatever the rooms allow; the entry chain and the plant / living rooms are pinned.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  gallery: ['lock'],
  lock: ['gallery', 'decon', 'guard'],
  decon: ['lock', 'guard', 'muster', 'infirmary', 'lockers'],
  guard: ['lock', 'decon', 'muster', 'armoury', 'radio', 'warden', 'store'],
  hall: ['muster', 'corr', 'switch', 'armoury', 'filtration', 'workshop', 'stores', 'store'],
  switch: ['hall'],
  armoury: ['guard', 'warden', 'hall', 'muster', 'corr'],
  mess: ['muster', 'corr', 'rations', 'store'],
  rations: ['mess', 'muster', 'corr'],
  dorm: ['muster', 'corr', 'washroom', 'lockers'],
  washroom: ['muster', 'corr', 'dorm', 'infirmary'],
  lockers: ['muster', 'corr', 'dorm', 'decon'],
  filtration: ['muster', 'corr', 'hall', 'store'],
  infirmary: ['muster', 'corr', 'decon', 'washroom', 'store'],
  radio: ['muster', 'corr', 'guard', 'warden', 'store'],
  warden: ['muster', 'corr', 'guard', 'radio', 'armoury', 'store'],
  stores: ['muster', 'corr', 'hall', 'workshop'],
  workshop: ['muster', 'corr', 'hall', 'stores', 'store'],
  store: ['muster', 'corr', 'hall', 'workshop', 'mess', 'infirmary', 'filtration', 'guard', 'warden', 'radio'],
};

/** Weisfeiler-Lehman hash of the labelled room graph (classes as labels): different hashes = non-isomorphic room graphs. */
function wlHash(c: ComplexCarve, f: Fixture): string {
  const pairs = doorPairs(c, f), keys = [...new Set(c.rooms.map(r => r.key))];
  let label = new Map(keys.map(k => [k, klass(k)]));
  const adj = new Map(keys.map(k => [k, [] as string[]]));
  for (const {a, b} of pairs) if (adj.has(a) && adj.has(b)) { adj.get(a)!.push(b); adj.get(b)!.push(a); }
  for (let round = 0; round < 3; round++) label = new Map(keys.map(k => [k, `${label.get(k)}(${adj.get(k)!.map(n => label.get(n)).sort().join(',')})`]));
  return [...label.values()].sort().join('|');
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

  it('every space is connected from the gallery; the generator hall keeps two ways in (no single door outside the entry chain cuts it off)', () => {
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
      // area graph: cycle rank >= 2 (the guard post's way round the threshold + the hall's loop)
      const ids = new Set(c.areas);
      const edges = f.k.doors.filter(d => ids.has(d.a) && ids.has(d.b));
      expect(edges.length - ids.size + 1, tag).toBeGreaterThanOrEqual(2);
      const hall = c.rooms.find(r => r.key === 'hall')!.area, hallCell = (() => { const a = f.k.areas[hall]; return g.idx(a.x + 1, a.y + 1); })();
      const entry = new Set(c.rooms.filter(r => ['lock', 'decon', 'guard'].includes(r.key)).map(r => r.area));
      const core = f.k.doors.map((d, i) => [d, i] as const).filter(([d]) => ids.has(d.a) && ids.has(d.b) && !entry.has(d.a) && !entry.has(d.b));
      expect(core.length, tag).toBeGreaterThan(10);
      for (const [d, i] of core) expect(reach(f, i).has(hallCell), `${tag} hall without door ${i} (${f.k.areas[d.a].label} / ${f.k.areas[d.b].label})`).toBe(true);
    }
  });

  it('the program: the shelter brief\'s rooms, >= 600 m2 walkable (~900 typical), real heights / doorways, a dead-end armoury', () => {
    const KEYS = ['lock', 'decon', 'guard', 'muster', 'mess', 'hall', 'switch', 'armoury', 'dorm', 'washroom', 'filtration', 'infirmary', 'radio'];
    const m2: number[] = [];
    for (const seed of SEEDS) for (const inward of ['S', 'E'] as const) {
      const {f, c} = carve(seed, inward);
      const g = f.k.grid(1), tag = `seed ${seed} ${inward}`;
      const keys = c.rooms.map(r => r.key);
      for (const k of KEYS) expect(keys, `${tag} ${k}`).toContain(k);
      expect(new Set(keys).size, `${tag} unique keys`).toBe(keys.length);
      expect(c.rooms.length, tag).toBeGreaterThanOrEqual(15);
      let cells = 0;
      for (const id of c.areas) { const a = f.k.areas[id]; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.cells[g.idx(x, y)] === FLOOR && g.area[g.idx(x, y)] === id) cells++; }
      expect(cells * CELL * CELL, tag).toBeGreaterThanOrEqual(600);
      m2.push(cells * CELL * CELL);
      for (const r of c.rooms) {
        const a = f.k.areas[r.area], clear = a.ceil - BASE;
        expect(a.ceil, `${tag} ${r.key} ceilMax`).toBeLessThanOrEqual(f.slot.ceilMax + 1e-9);
        expect(clear, `${tag} ${r.key} clear`).toBeGreaterThanOrEqual(3.0);
        if (r.key !== 'hall') expect(clear, `${tag} ${r.key} clear`).toBeLessThanOrEqual(4.0 + 1e-9);
        expect(a.purpose && ROOM_PURPOSES[a.purpose], `${tag} ${r.key} purpose ${a.purpose}`).toBeTruthy();
        expect(a.label, tag).toBe(r.label);
        // corridors 2.5-3 m wide; rooms >= 4 m on their short side
        if (r.role === 'corridor') expect(Math.min(a.w, a.h) * CELL, `${tag} ${r.key}`).toBeGreaterThanOrEqual(2.5);
        else expect(Math.min(a.w, a.h) * CELL, `${tag} ${r.key}`).toBeGreaterThanOrEqual(4.0);
      }
      const hallA = f.k.areas[c.rooms.find(r => r.key === 'hall')!.area];
      expect(hallA.ceil - BASE, tag).toBeGreaterThan(4.5);
      expect(Math.max(hallA.w, hallA.h) * CELL, `${tag} hall long side`).toBeGreaterThanOrEqual(13);
      expect(Math.min(hallA.w, hallA.h) * CELL, `${tag} hall short side`).toBeGreaterThanOrEqual(8);
      // doorways: >= 1.5 m wide (one cell deep, or the 2-cell bulkhead), 2.3-3.1 m tall
      const ids = new Set(c.areas);
      for (const d of f.k.doors.filter(q => ids.has(q.b))) {
        const width = (d.h === 1 || (d.w > d.h && d.h <= 2 && d.w >= 3) ? d.w : d.h) * CELL;
        expect(width, `${tag} door ${d.id}`).toBeGreaterThanOrEqual(1.5);
        expect(d.height, `${tag} door ${d.id}`).toBeGreaterThanOrEqual(2.3);
        expect(d.height, `${tag} door ${d.id}`).toBeLessThanOrEqual(3.1 + 1e-9);
      }
      // the armoury is a dead end (one door)
      const arm = c.rooms.find(r => r.key === 'armoury')!.area;
      expect(f.k.doors.filter(d => d.a === arm || d.b === arm).length, tag).toBe(1);
    }
    expect(m2.reduce((s, v) => s + v, 0) / m2.length, `mean walkable m2 ${m2.map(v => v.toFixed(0)).join(' ')}`).toBeGreaterThanOrEqual(850);
  });

  it('every door sits on the one-cell wall its two rooms share (the bulkhead: the 2-cell blast-door lane between lock and decon)', () => {
    for (const seed of SEEDS) for (const inward of INWARD) {
      const {f, c} = carve(seed, inward);
      const g = f.k.grid(1), tag = `seed ${seed} ${inward}`;
      for (const {d, a, b} of doorPairs(c, f)) {
        const A = f.k.areas[d.a], B = f.k.areas[d.b];
        const bulk = a === 'lock' && b === 'decon';
        const deep = bulk ? BUNKER.bulkhead : 1;
        expect(Math.min(d.w, d.h), `${tag} ${a}/${b} depth`).toBe(deep);
        expect(Math.max(d.w, d.h), `${tag} ${a}/${b} width`).toBeGreaterThanOrEqual(3);
        // across the thin axis: one room on each side, along the whole gap
        const alongX = d.h === deep && d.w > deep;
        const inRect = (r: Area, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
        for (let t = 0; t < (alongX ? d.w : d.h); t++) {
          const [x0, y0] = alongX ? [d.x + t, d.y - 1] : [d.x - 1, d.y + t];
          const [x1, y1] = alongX ? [d.x + t, d.y + deep] : [d.x + deep, d.y + t];
          const sides = [inRect(A, x0, y0) && inRect(B, x1, y1), inRect(B, x0, y0) && inRect(A, x1, y1)];
          expect(sides.some(Boolean), `${tag} ${a}/${b} gap cell ${t}`).toBe(true);
          for (let k = 0; k < deep; k++) {
            const [cx, cy] = alongX ? [d.x + t, d.y + k] : [d.x + k, d.y + t];
            expect(g.cells[g.idx(cx, cy)], tag).toBe(FLOOR);
            // a door cell is never inside either room's rect (it is the wall between them)
            expect(inRect(A, cx, cy) || inRect(B, cx, cy), `${tag} ${a}/${b} door cell inside a room`).toBe(false);
          }
        }
      }
    }
  });

  it('rooms flow by function: every door joins rooms that belong together (the entry chain, the switch room off the hall, quiet dormitories …)', () => {
    for (const seed of [...SEEDS, ...VARIETY]) for (const inward of ['S', 'W'] as const) {
      const {f, c} = carve(seed, inward), tag = `seed ${seed} ${inward}`;
      const pairs = doorPairs(c, f);
      for (const {a, b} of pairs) {
        const A = klass(a), B = klass(b);
        if (ALLOWED[A]) expect(ALLOWED[A], `${tag} ${a} -> ${b}`).toContain(B);
        if (ALLOWED[B]) expect(ALLOWED[B], `${tag} ${b} -> ${a}`).toContain(A);
      }
      const nb = (k: string) => pairs.filter(p => p.a === k || p.b === k).map(p => (p.a === k ? p.b : p.a));
      // the entry chain in order: gallery -> lock -> decon (bulkhead) -> muster; the guard post opens into the lock and onto the clean side
      expect(nb('lock').sort(), tag).toEqual(['decon', 'gallery', 'guard']);
      expect(nb('decon'), tag).toContain('muster');
      expect(nb('guard'), tag).toContain('lock');
      expect(nb('guard').some(k => k === 'decon' || k === 'muster'), tag).toBe(true);
      expect(nb('switch'), tag).toEqual(['hall']);
      // the generator hall opens off the plant side of the skeleton (a corridor, never straight off the entry chain)
      expect(nb('hall').some(k => k === 'muster' || klass(k) === 'corr'), tag).toBe(true);
    }
  });

  it('VARIETY: 16 seeds on one slot give distinct room graphs and layouts (topology, geometry, entry, muster, hall, optional rooms)', () => {
    const wl = new Set<string>(), geo = new Set<string>(), muster = new Set<string>(), exit = new Set<string>(), guardTo = new Set<string>();
    const corridors = new Set<number>(), cycles = new Set<number>(), deadEnds = new Set<number>(), hallAt = new Set<string>(), hallAxis = new Set<string>();
    const optional = new Set<string>(), sizes = new Set<string>();
    const report: string[] = [];
    for (const seed of VARIETY) {
      const {f, c} = carve(seed, 'S');
      const pairs = doorPairs(c, f), A = (k: string) => f.k.areas[c.rooms.find(r => r.key === k)!.area];
      const lock = A('lock'), decon = A('decon'), hall = A('hall'), mu = A('muster');
      wl.add(wlHash(c, f));
      // geometry up to translation: every room rect relative to the lock
      geo.add(c.rooms.map(r => { const a = f.k.areas[r.area]; return `${klass(r.key)}:${a.x - lock.x},${a.y - lock.y},${a.w}x${a.h}`; }).sort().join(' '));
      // the muster corridor: across (its long side along the pit wall) or heading in; the decon's exit wall (back / side)
      muster.add(mu.w > mu.h ? 'across' : 'in');
      const dx = f.k.doors.find(d => (d.a === decon.id && d.b === mu.id) || (d.b === decon.id && d.a === mu.id))!;
      exit.add(doorSide(dx, decon) === 'S' ? 'back' : 'side');
      guardTo.add(pairs.some(p => (p.a === 'guard' && p.b === 'muster') || (p.b === 'guard' && p.a === 'muster')) ? 'muster' : 'decon');
      const ids = new Set(c.areas), edges = f.k.doors.filter(d => ids.has(d.a) && ids.has(d.b)).length;
      corridors.add(c.rooms.filter(r => r.role === 'corridor').length);
      cycles.add(edges - ids.size + 1);
      deadEnds.add(c.rooms.filter(r => f.k.doors.filter(d => d.a === r.area || d.b === r.area).length === 1).length);
      // the hall: which side of the entrance (along the wall) and how deep, its long axis
      const ex = f.slot.entrance.x + f.slot.entrance.w / 2, hx = hall.x + hall.w / 2, hy = hall.y + hall.h / 2 - f.slot.entrance.y;
      const at = `${hx < ex - 8 ? 'L' : hx > ex + 8 ? 'R' : 'C'}${hy < 44 ? 'mid' : 'back'}`;
      hallAt.add(at);
      hallAxis.add(hall.w >= hall.h ? 'along' : 'in');
      const opt = c.rooms.map(r => r.key).filter(k => ['warden', 'rations', 'stores', 'workshop', 'dorm2', 'lockers'].includes(k)).sort().join(',');
      optional.add(opt);
      sizes.add(['mess', 'dorm', 'hall'].map(k => `${A(k).w}x${A(k).h}`).join(' '));
      report.push(`seed ${seed}: ${c.rooms.length} rooms, corridors ${c.rooms.filter(r => r.role === 'corridor').length}, cycles ${edges - ids.size + 1}, muster ${mu.w > mu.h ? 'across' : 'in'}, hall ${at}, optional [${opt}]`);
    }
    const tag = report.join('\n');
    // every seed a different room graph (non-isomorphic labelled graphs) and a different floor plan, even up to translation
    expect(wl.size, tag).toBe(VARIETY.length);
    expect(geo.size, tag).toBe(VARIETY.length);
    // the entry and skeleton variants all occur
    expect(muster.size, tag).toBe(2);
    expect(exit.size, tag).toBe(2);
    expect(guardTo.size, tag).toBe(2);
    expect(corridors.size, tag).toBeGreaterThanOrEqual(3);
    expect(cycles.size, tag).toBeGreaterThanOrEqual(3);
    expect(deadEnds.size, tag).toBeGreaterThanOrEqual(3);
    // the hall turns up in different places / orientations; room sizes and the optional room sets differ
    expect(hallAt.size, tag).toBeGreaterThanOrEqual(4);
    expect(hallAxis.size, tag).toBe(2);
    expect(sizes.size, tag).toBe(VARIETY.length);
    expect(optional.size, tag).toBeGreaterThanOrEqual(8);
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
      // long axis along the skid's long side, which runs along the hall's long side
      expect(Math.abs(c.generator.yaw) < 1e-6 ? ft.w > ft.h : ft.h > ft.w, tag).toBe(true);
      const H = f.k.areas[hall];
      expect(ft.w > ft.h, tag).toBe(H.w >= H.h);
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const sig = (c: ComplexCarve, f: Fixture) => JSON.stringify({areas: c.areas.map(id => f.k.areas[id]), doors: f.k.doors, gen: c.generator, rooms: c.rooms});
    const a = carve(5, 'E'), b = carve(5, 'E');
    expect(sig(a.c, a.f)).toBe(sig(b.c, b.f));
    expect(new Set(SEEDS.map(s => { const r = carve(s, 'S'); return sig(r.c, r.f); })).size).toBe(SEEDS.length);
  });

  it('returns null (host fallback) when the region is too small; any entrance position / width / a low ceilMax fits; carves fast (< 60 ms)', () => {
    const f = fixture(1, 'S', 50, 50);
    expect(carveBunker({k: f.k, rng: f.rng, slot: f.slot, levelOpt: f.levelOpt})).toBeNull();
    // the entrance outside the region's edge, off-centre / near either end of the wall, a wide entrance, a low ceilMax still fit
    carve(2, 'W', 80, 64, {edge: false});
    for (const at of [0.08, 0.15, 0.3, 0.7, 0.85, 0.92]) for (const s of [3, 4, 9]) carve(s, (['S', 'N', 'E', 'W'] as const)[s % 4], 80, 64, {at});
    carve(4, 'N', 80, 64, {at: 0.85, ew: 8});
    const low = carve(6, 'E', 80, 64, {ceil: BASE + 4.2});
    for (const id of low.c.areas) expect(low.f.k.areas[id].ceil).toBeLessThanOrEqual(BASE + 4.2 + 1e-9);
    const t0 = performance.now();
    for (const seed of SEEDS) carve(seed, 'S');
    expect((performance.now() - t0) / SEEDS.length).toBeLessThan(60);
  });
});
