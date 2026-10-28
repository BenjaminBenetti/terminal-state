// Iteration 08 (Lane A): the generator's multi-level program — every family stacks an upper level
// (decks over the platforms, crossover bridges and light wells over the tracks, rooms) and a lower
// service level (crossing beneath the platforms and track beds, gallery, plant rooms) over the main
// level, joined by enclosed stair cores. Pure data checks on generated stations (no three.js).

import {describe, expect, it} from 'vitest';
import {ARCHETYPES, generateAttempt, generateStation, validateLayout, MIN_ZOMBIE_SPAWN_CELLS, type Archetype, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR, SOLID, VOID, type Grid} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {
  LEVEL_LOWER, LEVEL_UPPER, LOWER_CEIL, LOWER_FLOOR, MIN_HEADROOM, MIN_OVERLAP_M2, SLAB, UPPER_CLEAR,
  apertureOf, deriveRails, levelDistance, levelIssues, levelMetrics,
} from '../src/gen/levelGen';
import {doorClearVolumes, doorwayIssues} from '../src/gen/doorways';
import {SERVICE_LAMP} from '../src/gen/levelGenDress';
import {traversalIssues} from '../src/gen/traversal';

const cache = new Map<string, StationLayout>();
const gen = (seed: number, archetype?: Archetype) => {
  const k = `${seed}:${archetype ?? ''}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = generateStation(seed, archetype ? {archetype} : {})));
  return l;
};
/** Three stations per family (forced archetype) + a natural seed sample. */
const PER_ARCH = ARCHETYPES.flatMap((a, i) => [0, 1, 2].map(k => gen(9001 + i * 7919 + k * 104729, a)));
const NATURAL = Array.from({length: 6}, (_, i) => gen((i * 2654435761 + 12345) >>> 0));
/** The deep family's island variant (seed 711) next to its side variants. */
const DEEP_ISLAND = gen(711, 'deep');
const SAMPLE = () => [...PER_ARCH, DEEP_ISLAND, ...NATURAL];
const tagOf = (l: StationLayout) => `${l.seed}/${l.archetype}`;
const isOpen = (g: Grid, i: number) => g.cells[i] === FLOOR || g.cells[i] === VOID;

describe('multi-level stations (iteration 08, Lane A)', () => {
  it('is deterministic per seed (every level grid, links, rails, level spawns)', () => {
    for (const a of ARCHETYPES) {
      const s = 31337 + a.length;
      const p = generateStation(s, {archetype: a}), q = generateStation(s, {archetype: a});
      expect(p.levels.length).toBe(q.levels.length);
      p.levels.forEach((L, i) => {
        const M = q.levels[i];
        expect(L.baseY).toBe(M.baseY);
        expect(Buffer.from(L.grid.cells).equals(Buffer.from(M.grid.cells))).toBe(true);
        expect(Buffer.from(L.grid.floor.buffer).equals(Buffer.from(M.grid.floor.buffer))).toBe(true);
        expect(Buffer.from(L.grid.ceil.buffer).equals(Buffer.from(M.grid.ceil.buffer))).toBe(true);
        expect(Buffer.from(L.grid.area.buffer).equals(Buffer.from(M.grid.area.buffer))).toBe(true);
      });
      expect(JSON.stringify(p.levelLinks)).toBe(JSON.stringify(q.levelLinks));
      expect(JSON.stringify(p.rails)).toBe(JSON.stringify(q.rails));
      expect(JSON.stringify(p.levelPlan)).toBe(JSON.stringify(q.levelPlan));
      expect(p.zombies).toEqual(q.zombies);
      expect(p.pickups).toEqual(q.pickups);
    }
  });

  it('every family stacks three levels with real X/Z overlap over the platforms AND the tracks, and stair connectors', () => {
    const fam = new Set<string>();
    for (const l of SAMPLE()) {
      const tag = tagOf(l);
      expect(l.levels.map(L => L.role), tag).toEqual(['main', 'upper', 'lower']);
      expect(l.levels[0].grid).toBe(l.grid);
      for (const L of l.levels) { expect(L.grid.w).toBe(l.grid.w); expect(L.grid.h).toBe(l.grid.h); expect(L.grid.ramps).toBe(l.grid.ramps); }
      const g0 = l.grid, gu = l.levels[LEVEL_UPPER].grid, gl = l.levels[LEVEL_LOWER].grid;
      const plats = new Set(l.platforms);
      let upPlat = 0, upBed = 0, loPlat = 0, loBed = 0;
      for (let i = 0; i < g0.cells.length; i++) {
        const onPlat = g0.cells[i] === FLOOR && plats.has(g0.area[i]), onBed = g0.cells[i] === VOID;
        if (gu.cells[i] === FLOOR && gu.rampIdx[i] < 0) { if (onPlat) upPlat++; if (onBed) upBed++; }
        if (gl.cells[i] === FLOOR && gl.rampIdx[i] < 0) { if (onPlat) loPlat++; if (onBed) loBed++; }
      }
      const m2 = (n: number) => n * CELL * CELL;
      expect(m2(upPlat), `${tag} upper over platforms`).toBeGreaterThan(80);
      expect(m2(upBed), `${tag} upper over the tracks (bridges / catwalks)`).toBeGreaterThan(15);
      expect(m2(loPlat), `${tag} lower beneath platforms`).toBeGreaterThan(40);
      expect(m2(loBed), `${tag} lower beneath the tracks`).toBeGreaterThan(40);
      const m = levelMetrics(l);
      expect(m.overlapUpperM2, tag).toBeGreaterThanOrEqual(MIN_OVERLAP_M2);
      expect(m.overlapLowerM2, tag).toBeGreaterThanOrEqual(MIN_OVERLAP_M2);
      expect(m.upLinks, tag).toBeGreaterThanOrEqual(2);
      expect(m.downLinks, tag).toBeGreaterThanOrEqual(1);
      expect(m.wellsM2, `${tag} light wells`).toBeGreaterThan(20);
      fam.add(l.archetype);
    }
    expect([...fam].sort()).toEqual([...ARCHETYPES].sort());
    expect(DEEP_ISLAND.areas[DEEP_ISLAND.platform].edge, 'deep island variant').toBe('NS');
  });

  it('upper and lower levels hold purposeful spaces (decks, crossover bridges, control room; crossing, gallery, plant rooms)', () => {
    for (const l of PER_ARCH) {
      const tag = tagOf(l), p = l.levelPlan!;
      const up = l.areas.filter(a => a.level === LEVEL_UPPER), lo = l.areas.filter(a => a.level === LEVEL_LOWER);
      for (const a of [...up, ...lo]) {
        expect(a.floorY, `${tag} ${a.label}`).toBe(a.level === LEVEL_UPPER ? p.hu : LOWER_FLOOR);
        expect(a.ceil - a.floorY!, `${tag} ${a.label} headroom`).toBeGreaterThanOrEqual(MIN_HEADROOM);
      }
      // One deck per platform of the stacked block (interchange: line 2's island stays single-level).
      expect(up.filter(a => a.role === 'upper-concourse').length, tag).toBe(new Set(p.cores.map(c => c.platform)).size);
      expect(up.filter(a => a.role === 'crossover').length, tag).toBeGreaterThanOrEqual(2);
      expect(up.some(a => a.purpose === 'security-office'), `${tag} security control room`).toBe(true);
      if (l.areas[l.platform].edge === 'NS') expect(up.some(a => a.role === 'catwalk'), `${tag} island catwalk`).toBe(true);
      for (const a of up.filter(x => x.role === 'catwalk')) expect(Math.min(a.w, a.h) * CELL).toBeGreaterThanOrEqual(1.5);
      expect(lo.some(a => a.role === 'service-crossing'), tag).toBe(true);
      expect(lo.some(a => a.role === 'service-gallery'), tag).toBe(true);
      const plant = lo.filter(a => a.kind === 'room');
      expect(plant.length, `${tag} plant rooms`).toBeGreaterThanOrEqual(2);
      for (const a of plant) expect(['pump-room', 'electrical-room', 'storage', 'signal-room']).toContain(a.purpose);
      // Stair cores are public, lit routes; the levels' labels are what the HUD shows.
      for (const c of p.cores) expect(l.areas[c.lobby].type).toBe('stair-core');
    }
  });

  it('every walkable cell on every level is reachable from the spawn (stairs carved into both grids, ladders)', () => {
    for (const l of SAMPLE()) {
      const [sx, sy] = l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const dist = levelDistance(l.levels, sx, sy);
      for (const L of l.levels) {
        const g = L.grid;
        let bad = 0, walk = 0;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] !== FLOOR || g.blocked[i]) continue;
          walk++;
          if (dist[L.id][i] < 0) bad++;
        }
        expect(walk, `${tagOf(l)} level ${L.id}`).toBeGreaterThan(200);
        expect(bad, `${tagOf(l)} level ${L.id} unreachable cells`).toBe(0);
      }
    }
  });

  it('loops: platform A -> upper -> platform B and platform A -> lower -> platform B are both open (single islands: two cores)', () => {
    for (const l of PER_ARCH) {
      const tag = tagOf(l), p = l.levelPlan!;
      const W = l.grid.w;
      // BFS restricted to the stair cores and ONE stacked level (no main-level halls, bed or ladders).
      const reach = (via: number, from: number[], allow: (lv: number, i: number) => boolean) => {
        const seen = l.levels.map(L => new Uint8Array(L.grid.cells.length));
        const q: [number, number][] = from.map(i => [0, i]);
        for (const i of from) seen[0][i] = 1;
        while (q.length) {
          const [lv, c] = q.pop()!;
          const g = l.levels[lv].grid;
          for (let M = 0; M < l.levels.length; M++) {
            const gm = l.levels[M].grid;
            if (M !== lv && !seen[M][c] && gm.cells[c] === FLOOR && Math.abs(gm.floorOf(c) - g.floorOf(c)) < 0.05 && allow(M, c)) { seen[M][c] = 1; q.push([M, c]); }
          }
          for (const j of [c - 1, c + 1, c - W, c + W]) {
            if (seen[lv][j] || g.cells[j] !== FLOOR || g.blocked[j] || !allow(lv, j)) continue;
            if (Math.abs(g.floorOf(j) - g.floorOf(c)) > 0.45) continue;
            seen[lv][j] = 1; q.push([lv, j]);
          }
        }
        void via;
        return seen;
      };
      const coreArea = (a: number) => a >= 0 && l.areas[a]?.type === 'stair-core';
      const cellsOf = (area: number) => { const g = l.grid, out: number[] = []; const a = l.areas[area]; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (g.area[g.idx(x, y)] === area) out.push(g.idx(x, y)); return out; };
      const lobbies = p.cores.map(c => c.lobby);
      const allowUpper = (lv: number, i: number) => lv === LEVEL_UPPER || coreArea(l.levels[lv].grid.area[i]) && (lv !== LEVEL_LOWER);
      const allowLower = (lv: number, i: number) => lv === LEVEL_LOWER || coreArea(l.levels[lv].grid.area[i]) && (lv !== LEVEL_UPPER);
      const [first, ...rest] = lobbies;
      const viaUp = reach(LEVEL_UPPER, cellsOf(first), allowUpper);
      for (const o of rest) expect(cellsOf(o).some(i => viaUp[0][i]), `${tag} lobby ${first} -> upper -> lobby ${o}`).toBe(true);
      const downCores = p.cores.filter(c => c.down >= 0);
      if (downCores.length >= 2) {
        const viaLo = reach(LEVEL_LOWER, cellsOf(downCores[0].lobby), allowLower);
        for (const c of downCores.slice(1)) expect(cellsOf(c.lobby).some(i => viaLo[0][i]), `${tag} lobby -> lower -> lobby`).toBe(true);
      }
      expect(lobbies.length, `${tag} at least two cores (a loop)`).toBeGreaterThanOrEqual(2);
    }
  });

  it('slabs and headroom: no band overlaps the slab of another (>= 0.35 m); walkable level bands >= 2.4 m; flights >= 2.1 m', () => {
    for (const l of SAMPLE()) {
      const tag = tagOf(l), n = l.grid.cells.length;
      let stacked = 0;
      for (let i = 0; i < n; i++) {
        const bands: [number, number, number][] = [];
        for (const L of l.levels) {
          const g = L.grid;
          if (!isOpen(g, i)) continue;
          const f = g.floorOf(i), c = g.hasCeil(i) ? g.ceil[i] : Infinity;
          if (bands.some(b => Math.abs(b[0] - f) < 1e-4 && Math.abs(b[1] - c) < 1e-4)) continue; // a stair run shared by two grids
          bands.push([f, c, L.id]);
          if (L.id && g.cells[i] === FLOOR) {
            const lim = g.rampIdx[i] >= 0 ? 2.1 : MIN_HEADROOM;
            const isDoor = l.doors.some(d => (d.level ?? l.areas[d.a].level ?? 0) === L.id && i % l.grid.w >= d.x && i % l.grid.w < d.x + d.w && Math.floor(i / l.grid.w) >= d.y && Math.floor(i / l.grid.w) < d.y + d.h);
            if (!isDoor) expect(c - f, `${tag} level ${L.id} cell ${i} headroom`).toBeGreaterThanOrEqual(lim - 1e-3);
          }
        }
        if (bands.length < 2) continue;
        stacked++;
        bands.sort((a, b) => a[0] - b[0]);
        for (let k = 1; k < bands.length; k++) expect(bands[k][0] - bands[k - 1][1], `${tag} cell ${i} slab between ${bands[k - 1][2]} and ${bands[k][2]}`).toBeGreaterThanOrEqual(SLAB - 1e-3);
      }
      expect(stacked * CELL * CELL, `${tag} stacked m²`).toBeGreaterThan(2 * MIN_OVERLAP_M2);
      const p = l.levelPlan!;
      expect(p.upperCeil - p.hu).toBeCloseTo(UPPER_CLEAR, 5);
      expect(p.lowerCeil).toBeCloseTo(LOWER_CEIL, 5);
      expect(l.trench.floorY - LOWER_CEIL).toBeGreaterThanOrEqual(SLAB - 1e-6);
    }
  });

  it('light wells: closed on the upper grid while the track-bed band rises to the upper ceiling; every well edge is railed', () => {
    let railM = 0;
    for (const l of SAMPLE()) {
      const tag = tagOf(l), p = l.levelPlan!;
      const gu = l.levels[LEVEL_UPPER].grid, g0 = l.grid;
      const ap = apertureOf(gu);
      expect(ap, `${tag} upper apertures registered`).toBeDefined();
      for (const w of p.wells) for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) {
        const i = g0.idx(x, y);
        expect(gu.cells[i], `${tag} well closed upstairs`).toBe(SOLID);
        expect(g0.cells[i]).toBe(VOID);
        expect(g0.ceil[i]).toBeCloseTo(p.upperCeil, 5);
        expect(ap![i]).toBe(1);
      }
      // Rails: exactly the derived well edges, in Lane G's format, and they satisfy Lane B's drop rule (no unrailed drop).
      expect(l.rails).toEqual(deriveRails(l.levels));
      expect(levelsOf(l).unrailedDrops(), `${tag} unrailed drops`).toEqual([]);
      for (const r of l.rails) {
        expect(r.level).toBe(LEVEL_UPPER);
        expect(r.y0).toBeCloseTo(p.hu, 5);
        expect(Math.hypot(r.nx, r.nz)).toBeCloseTo(1, 6);
        // The walkable side is an upper floor cell, the other side an aperture.
        const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
        const [ax, ay] = gu.cellOf(mx + r.nx * 0.1, mz + r.nz * 0.1), [bx, by] = gu.cellOf(mx - r.nx * 0.1, mz - r.nz * 0.1);
        expect(gu.cells[gu.idx(ax, ay)]).toBe(FLOOR);
        expect(ap![gu.idx(bx, by)]).toBe(1);
        railM += Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      }
    }
    expect(railM).toBeGreaterThan(400);
  });

  it('stairs: links land on open, flat, >= 1.2 x 1.8 m landings on the right levels; doors and placements stay clear on every level', () => {
    for (const l of SAMPLE()) {
      const tag = tagOf(l);
      expect(levelIssues(l), tag).toEqual([]);
      expect(traversalIssues(l), tag).toEqual([]);
      expect(doorwayIssues(l), tag).toEqual([]);
      for (const k of l.levelLinks) {
        for (const [pt, lv] of [[k.bottom, k.lower], [k.top, k.upper]] as const) {
          const g = l.levels[lv].grid, [cx, cy] = g.cellOf(pt.x, pt.z), i = g.idx(cx, cy);
          expect(g.cells[i], `${tag} link ${k.id} level ${lv}`).toBe(FLOOR);
          expect(g.floorAt(pt.x, pt.z)).toBeCloseTo(pt.y, 2);
        }
      }
      // Openings on the upper / lower levels exist and keep a walk-through volume at their own height.
      const vols = doorClearVolumes(l);
      for (const lv of [LEVEL_UPPER, LEVEL_LOWER]) {
        const mine = vols.filter(v => (l.doors[v.door].level ?? 0) === lv);
        expect(mine.length, `${tag} doors on level ${lv}`).toBeGreaterThan(0);
        for (const v of mine) expect(v.y0).toBeCloseTo(l.levels[lv].baseY + 0.02, 5);
      }
    }
  });

  it('no prop, light, pickup or spawn floats, sinks, stands in a stair run or over a light well', () => {
    let lv = 0;
    for (const l of SAMPLE()) {
      const tag = tagOf(l);
      const gridOf = (level?: number) => l.levels[level ?? 0].grid;
      for (const p of l.props) {
        if (!p.level) continue;
        lv++;
        const g = gridOf(p.level), [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(g.cells[i], `${tag} ${p.kind}`).toBe(FLOOR);
        expect(g.rampIdx[i]).toBe(-1);
        expect(p.y).toBeGreaterThanOrEqual(g.floorOf(i) - 0.02);
        expect(p.y + p.h, `${tag} ${p.kind} through the ceiling`).toBeLessThanOrEqual(g.ceil[i] + 0.05);
      }
      for (const z of l.zombies) {
        const g = gridOf(z.level), [cx, cy] = g.cellOf(z.x, z.z), i = g.idx(cx, cy);
        expect(g.cells[i]).toBe(FLOOR);
        expect(g.rampIdx[i], `${tag} zombie on stairs`).toBe(-1);
        expect(z.y ?? 0).toBeCloseTo(g.floorOf(i), 5);
      }
      for (const p of l.pickups) {
        if (!p.level) continue;
        const g = gridOf(p.level), [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(g.cells[i]).toBe(FLOOR);
        expect(g.rampIdx[i]).toBe(-1);
        expect(p.y).toBeGreaterThanOrEqual(g.floorOf(i) - 1e-6);
        expect(p.y).toBeLessThan(g.floorOf(i) + 2);
      }
      for (const s of l.signs) {
        if (!s.level) continue;
        const g = gridOf(s.level), [cx, cy] = g.cellOf(s.x, s.z);
        if (!s.hang) continue;
        const i = g.idx(cx, cy);
        expect(isOpen(g, i), `${tag} hanging "${s.text}" over a closed cell`).toBe(true);
        expect(s.y).toBeLessThan(g.ceil[i]);
        expect(s.y - g.floorOf(i)).toBeGreaterThan(2.0);
      }
    }
    expect(lv, 'level props exist (Lane P dressing on the levels)').toBeGreaterThan(50);
  });

  it('lighting: upper public spaces lit, the service level mostly dim / dark; zombies and supplies on both levels', () => {
    let lowerDark = 0, lower = 0, zu = 0, zl = 0, pu = 0, pl = 0;
    for (const l of PER_ARCH) {
      const tag = tagOf(l);
      for (const a of l.areas) {
        if (a.level === LEVEL_UPPER && a.publicSpace) expect(a.lighting, `${tag} ${a.label}`).toBe('lit');
        if (a.level === LEVEL_LOWER) { lower++; if (a.lighting !== 'lit') lowerDark++; }
      }
      expect(l.zombies.length).toBeGreaterThanOrEqual(11);
      expect(l.zombies.length).toBeLessThanOrEqual(16);
      zu += l.zombies.filter(z => z.level === LEVEL_UPPER).length;
      zl += l.zombies.filter(z => z.level === LEVEL_LOWER).length;
      pu += l.pickups.filter(p => p.level === LEVEL_UPPER).length;
      pl += l.pickups.filter(p => p.level === LEVEL_LOWER).length;
      const [sx, sy] = l.grid.cellOf(l.playerSpawn.x, l.playerSpawn.z);
      const dist = levelDistance(l.levels, sx, sy);
      for (const z of l.zombies.filter(q => q.level)) {
        const g = l.levels[z.level!].grid;
        expect(dist[z.level!][g.idx(...g.cellOf(z.x, z.z))]).toBeGreaterThanOrEqual(MIN_ZOMBIE_SPAWN_CELLS);
      }
    }
    expect(lowerDark / lower, 'service level mostly dim / dark').toBeGreaterThan(0.6);
    expect(zu, 'zombies upstairs').toBeGreaterThanOrEqual(PER_ARCH.length);
    expect(zl, 'zombies downstairs').toBeGreaterThanOrEqual(PER_ARCH.length * 0.8);
    expect(pu + pl, 'loose supplies on the levels').toBeGreaterThanOrEqual(PER_ARCH.length);
  });

  it('the service level is dark but readable: sparse working dim lamps along the crossing / gallery, at stair feet and plant-room doors', () => {
    for (const l of SAMPLE()) {
      const tag = tagOf(l), p = l.levelPlan!;
      const live = (area: number) => l.lights.filter(x => x.area === area && !x.broken && !x.dying);
      for (const id of [p.crossing, p.gallery]) {
        const a = l.areas[id];
        expect(a.lighting, `${tag} ${a.label}`).toBe('dim');
        const lamps = live(id);
        for (const x of lamps) {
          expect(x.level).toBe(LEVEL_LOWER);
          expect(x.warm).toBe(true);
          expect(x.power, `${tag} low output`).toBeLessThanOrEqual(SERVICE_LAMP.landmark + 1e-6);
          expect(x.y).toBeCloseTo(p.lowerCeil - 0.02, 2);
        }
        // No stretch longer than ~11 m without a working lamp along the passage.
        const alongX = a.w >= a.h;
        const s = lamps.map(x => (alongX ? x.x : x.z)).sort((q, r) => q - r);
        const s0 = (alongX ? a.x : a.y) * CELL, s1 = (alongX ? a.x + a.w : a.y + a.h) * CELL;
        const gaps = [s[0] - s0, ...s.slice(1).map((v, i) => v - s[i]), s1 - s[s.length - 1]];
        expect(Math.max(...gaps), `${tag} ${a.label} lamp gap`).toBeLessThanOrEqual(11.5);
        // Sparse, not lit: at most one working lamp per 6 m.
        expect(lamps.length, `${tag} ${a.label} lamp count`).toBeLessThanOrEqual(Math.ceil((s1 - s0) / 6) + 3);
      }
      for (const k of l.levelLinks.filter(q => q.lower === LEVEL_LOWER)) {
        expect(live(p.crossing).some(x => Math.hypot(x.x - k.bottom.x, x.z - k.bottom.z) < 2.6), `${tag} lamp at the stair foot`).toBe(true);
      }
      for (const id of p.lowerRooms) {
        const R = l.areas[id];
        const d = l.doors.find(q => q.b === id && q.a === p.gallery)!;
        const dx = (d.x + d.w / 2) * CELL, dz = (d.y + 0.5) * CELL;
        expect(live(p.gallery).some(x => Math.hypot(x.x - dx, x.z - dz) < 2.7), `${tag} lamp outside ${R.label}`).toBe(true);
        const own = l.lights.filter(x => x.area === id);
        expect(own.some(x => !x.broken), `${tag} ${R.label} has a working / flickering / sputtering lamp`).toBe(true);
      }
    }
  });

  it('wayfinding between levels uses the sign system (UPPER CONCOURSE / SERVICE LEVEL / platform numbers)', () => {
    for (const l of PER_ARCH) {
      const tag = tagOf(l);
      const t = l.signs.map(s => s.text);
      expect(t.some(x => x.startsWith('UPPER CONCOURSE')), tag).toBe(true);
      expect(t.some(x => x.startsWith('SERVICE LEVEL')), tag).toBe(true);
      expect(l.signs.some(s => s.level === LEVEL_UPPER && /PLATFORM .* STAIRS DOWN/.test(s.text)), tag).toBe(true);
      expect(l.signs.some(s => s.level === LEVEL_LOWER && /PLATFORM .* STAIRS UP/.test(s.text)), tag).toBe(true);
      expect(l.signs.some(s => s.level === LEVEL_UPPER && s.text.startsWith('CROSSOVER')), tag).toBe(true);
      expect(l.signs.filter(s => s.arrow === 'up' || s.arrow === 'down').length, tag).toBeGreaterThan(6);
    }
  });

  it('raw generation attempts validate (retries hide nothing structural) and generation time stays reasonable', () => {
    let n = 0, ok = 0, ms = 0;
    const issues = new Map<string, number>();
    for (const [i, a] of ARCHETYPES.entries()) for (let s = 0; s < 4; s++) {
      const t0 = performance.now();
      const l = generateAttempt(70001 + i * 977 + s * 31, 0, a);
      ms += performance.now() - t0;
      if (!l) continue;
      n++;
      const iss = validateLayout(l).filter(x => /level|slab|headroom|flight|link|rail|well|stairs/.test(x));
      if (!iss.length) ok++;
      for (const x of iss) issues.set(x.replace(/[-\d.,]+/g, '#'), (issues.get(x.replace(/[-\d.,]+/g, '#')) ?? 0) + 1);
    }
    expect(n).toBeGreaterThan(8);
    expect([...issues.entries()], 'level-program issues in raw attempts').toEqual([]);
    expect(ok).toBe(n);
    // Shared CI / worker machines: a generous bound; the per-seed budget is asserted in station.test.ts.
    expect(ms / 24, 'mean raw attempt time (ms)').toBeLessThan(1500);
  });
});
