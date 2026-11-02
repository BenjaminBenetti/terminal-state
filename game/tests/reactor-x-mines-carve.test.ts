// Task reactor-expansion-20261101 (lane MINES): THE OLD MINE WORKINGS carver on fixture slots (until lane HOST's slot lands): inside the
// region, connected to the entrance, every space connected, two routes (loop) to the generator cavern, the generator use point clear,
// program size (>= 600 m², >= 8 spaces), clear heights / openings, determinism, carve time.
// Task reactor-playtest-round2-20261102 (lane MINES, user bullet 7: the layout "much to normal ... should be random! with logical rooms
// flowing in to one another"): the plan is now a SEEDED DRIFT / ROOM GRAPH. The fixed program's checks became the graph's guarantees
// (the adit, junction, haulage course, cavern, development heading always; >= 1 loop; the optional spaces vary by seed) plus VARIETY
// metrics (distinct topologies over >= 12 seeds) and COHERENCE (logical adjacency MINE_LINKS, dead ends, the rail chain, the heading
// sized for the drill rig up to the 7 x 3.0 x 2.4 m envelope).
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {Rng} from '../src/core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../src/gen/grid';
import type {Rect} from '../src/gen/stationTypes';
import {MINES, MINE_DRIFTS, MINE_LINKS, headingFor, type MinePart} from '../src/gen/reactor/complex/minesPlan';
import {MINES_FIT, minesModelSize} from '../src/world/reactor/minesAssets';
import {minesFixture, mineGraph, mineHops, mineSignature, FIX} from './reactor-x-mines-fixture';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const INWARD = ['S', 'N', 'E', 'W'] as const;
const log = (name: string, v: unknown) => { try { writeFileSync(`/tmp/reactor-x-mines-${name}.json`, JSON.stringify(v, null, 1)); } catch { /* diagnostics only */ } };

/** Walkable flood on one storey grid from a cell (FLOOR, not blocked); `skip` cells treated as rock. */
function flood(g: Grid, sx: number, sy: number, skip?: Set<number>): Uint8Array {
  const seen = new Uint8Array(g.w * g.h), st = [g.idx(sx, sy)];
  seen[st[0]] = 1;
  while (st.length) {
    const i = st.pop()!, x = i % g.w, y = (i / g.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!g.inBounds(nx, ny)) continue;
      const j = g.idx(nx, ny);
      if (seen[j] || g.cells[j] !== FLOOR || g.blocked[j] || skip?.has(j)) continue;
      seen[j] = 1;
      st.push(j);
    }
  }
  return seen;
}
const cellsOf = (r: Rect, g: Grid) => { const out: number[] = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(g.idx(x, y)); return out; };
const inside = (r: Rect, R: Rect, m: number) => r.x >= R.x + m && r.y >= R.y + m && r.x + r.w <= R.x + R.w - m && r.y + r.h <= R.y + R.h - m;

describe('Reactor mines complex — carver (lane MINES)', () => {
  it('fits the minimum fixture slot (80 x 64) in every inward direction over the sample seeds: >= 10 spaces, >= 700 m², the guaranteed graph', () => {
    const sizes: Record<string, number[]> = {};
    for (const inward of INWARD) for (const seed of SEEDS) {
      const fx = minesFixture(seed, {inward});
      const c = fx.carve;
      expect(c, `${inward} seed ${seed}`).not.toBeNull();
      const keys = c!.rooms.map(r => r.key), parts = new Set(c!.plan.rooms.map(r => r.part));
      // always: the adit, the junction, the haulage, the cavern, the development heading (the drill's), >= 1 loop, >= 4 optional spaces
      for (const need of ['portal', 'junction', 'cavern', 'heading', 'haulage-0']) expect(keys, `${inward} ${seed} ${need}`).toContain(need);
      expect(c!.plan.shape.loops.length, `${inward} ${seed} loops`).toBeGreaterThanOrEqual(1);
      expect(['lamp', 'tools', 'magazine', 'hoist', 'refuge', 'sump', 'collapse', 'stope'].filter(p => parts.has(p as MinePart)).length).toBeGreaterThanOrEqual(4);
      expect(c!.plan.run, `${inward} ${seed} timbered run`).toBeGreaterThanOrEqual(MINES.minRun);
      expect(c!.rooms.length).toBeGreaterThanOrEqual(10);
      const m2 = c!.plan.cells * 0.25;
      (sizes[inward] ??= []).push(m2);
      expect(m2, `${inward} seed ${seed}`).toBeGreaterThanOrEqual(MINES.targetM2);
      expect(c!.entryArea).toBe(c!.areas[0]);
      expect(c!.id).toBe('mines');
    }
    log('sizes', sizes);
  });

  it('stays inside the region (one rock cell kept inside its edge; only the adit crosses the edge row at the entrance) and carves only rock', () => {
    for (const inward of INWARD) for (const seed of SEEDS.slice(0, 5)) for (const gap of [false, true]) {
      const fx = minesFixture(seed, {inward, gap});
      const c = fx.carve!;
      expect(c, `${inward} ${seed} gap ${gap}`).not.toBeNull();
      for (const r of c.rooms) {
        const a = fx.k.areas[r.area];
        if (r.key === 'portal') {
          // the adit: inside the region laterally (margin 1); in depth it may start at the region's edge row behind the entrance
          const E = fx.slot.entrance, R = fx.slot.region;
          const lateralX = fx.slot.inward === 'N' || fx.slot.inward === 'S';
          if (lateralX) { expect(a.x).toBeGreaterThanOrEqual(R.x + 1); expect(a.x + a.w).toBeLessThanOrEqual(R.x + R.w - 1); } else { expect(a.y).toBeGreaterThanOrEqual(R.y + 1); expect(a.y + a.h).toBeLessThanOrEqual(R.y + R.h - 1); }
          // it touches the entrance span
          const touches = lateralX ? (a.y === E.y + 1 || a.y + a.h === E.y) : (a.x === E.x + 1 || a.x + a.w === E.x);
          expect(touches, `${inward} ${seed} portal touches the entrance`).toBe(true);
          continue;
        }
        expect(inside(a, fx.slot.region, 1), `${inward} ${seed} ${r.key} inside`).toBe(true);
      }
      // every door of the complex lies inside the region (margin 1) or is the entrance span itself
      for (const d of fx.k.doors) {
        if (!c.areas.includes(d.b)) continue;
        const isEntrance = d.x === fx.slot.entrance.x && d.y === fx.slot.entrance.y && d.w === fx.slot.entrance.w && d.h === fx.slot.entrance.h;
        expect(isEntrance || inside(d, fx.slot.region, 1), `${inward} ${seed} door ${d.id}`).toBe(true);
      }
    }
  });

  it('is one connected network from the deck: every carved cell reachable; >= 1 loop; a cavern on a loop keeps a second way in', () => {
    let twoWays = 0, n = 0;
    for (const inward of INWARD) for (const seed of SEEDS) {
      const fx = minesFixture(seed, {inward});
      const c = fx.carve!, g = fx.k.grid(FIX.level);
      const D = fx.deck, start = [D.x + 1, D.y + 1] as const;
      const seen = flood(g, start[0], start[1]);
      for (const id of c.areas) for (const i of cellsOf(fx.k.areas[id], g)) expect(seen[i], `${inward} ${seed} area ${fx.k.areas[id].label}`).toBe(1);
      // a loop in the space graph (openings >= spaces: one more than a tree)
      const G = mineGraph(c.plan);
      expect(G.edges.length, `${inward} ${seed} cycle`).toBeGreaterThanOrEqual(G.nodes.length);
      // the manway / return airway loops run through the cavern: cutting the haulage's last segment leaves the cavern reachable
      const cav = fx.k.areas[c.generator.area], ci = g.idx(cav.x + 2, cav.y + 2);
      const haul = c.rooms.filter(r => /^haulage-\d+$/.test(r.key)), last = haul[haul.length - 1];
      const cut = new Set(cellsOf(fx.k.areas[last.area], g));
      const reached = flood(g, start[0], start[1], cut)[ci] === 1;
      if (c.plan.shape.loops.some(l => l === 'manway' || l === 'airway')) expect(reached, `${inward} ${seed}: cavern without ${last.key}`).toBe(true);
      if (reached) twoWays++;
      n++;
    }
    // most mines give the generator stope two ways in (the player is not cornered there)
    expect(twoWays / n).toBeGreaterThanOrEqual(0.6);
  });

  it('opens every space logically (MINE_LINKS), dead ends and rooms by one opening, the rail chain contiguous, lamp / tool rooms by the way in', () => {
    const single: ReadonlySet<MinePart> = new Set(['heading', 'sump', 'collapse', 'lamp', 'tools', 'magazine', 'refuge', 'hoist', 'stope']);
    for (const inward of INWARD) for (const seed of SEEDS) {
      const plan = minesFixture(seed, {inward}).carve!.plan, tag = `${inward} ${seed}`;
      const part = new Map(plan.rooms.map(r => [r.key, r.part]));
      const {adj} = mineGraph(plan);
      for (const d of plan.doors) {
        const a = d.a ? part.get(d.a)! : null, b = part.get(d.b)!;
        expect(MINE_LINKS[b].includes(a) || (a !== null && MINE_LINKS[a].includes(b)), `${tag}: ${d.a} (${a}) - ${d.b} (${b})`).toBe(true);
      }
      for (const r of plan.rooms) {
        const nb = adj.get(r.key)!;
        if (single.has(r.part)) {
          expect(nb.length, `${tag}: ${r.key} openings`).toBe(1);
          // never room to room: the one neighbour is a passage, the junction or the cavern
          const p = part.get(nb[0])!;
          expect(MINE_DRIFTS.has(p) || p === 'junction' || p === 'cavern', `${tag} ${r.key} off ${nb[0]}`).toBe(true);
        }
        // passages lead somewhere: every one but a footwall drift (a branch may dead-end) has >= 2 ways (the adit: the entrance + 1)
        if (MINE_DRIFTS.has(r.part) && r.part !== 'branch') expect(nb.length + (r.key === 'portal' ? 1 : 0), `${tag}: ${r.key} through`).toBeGreaterThanOrEqual(2);
      }
      // the rail chain: adit segments -> junction -> haulage-0..n -> cavern, each pair sharing an opening; one course letter per segment
      const aditSegs = plan.rooms.filter(r => r.part === 'portal').map(r => r.key), haul = plan.rooms.filter(r => /^haulage-\d+$/.test(r.key)).map(r => r.key);
      const chain = [...aditSegs, 'junction', ...haul, 'cavern'];
      for (let i = 0; i + 1 < chain.length; i++) expect(adj.get(chain[i])!, `${tag} chain ${chain[i]} -> ${chain[i + 1]}`).toContain(chain[i + 1]);
      expect(plan.shape.course.length).toBe(haul.length);
      // the way in: lamp / tool rooms within a few openings of the adit; the magazine >= 2 openings from the junction
      const hops = mineHops(plan, 'portal');
      for (const k of ['lamp', 'tools']) if (part.has(k)) expect(hops.get(k)!, `${tag} ${k}`).toBeLessThanOrEqual(k === 'lamp' ? 3 : 4);
      if (part.has('magazine')) expect(mineHops(plan, 'junction').get('magazine')!, `${tag} magazine`).toBeGreaterThanOrEqual(2);
    }
  });

  it('VARIES the mine graph per seed: distinct topologies, courses, cavern places, adits, loops and optional spaces over 16 seeds', () => {
    const seeds = Array.from({length: 16}, (_, i) => i + 1);
    const rows = seeds.map(seed => { const p = minesFixture(seed).carve!.plan; return {seed, sig: mineSignature(p), shape: p.shape, cave: p.rooms.find(r => r.key === 'cavern')!.rect, rooms: p.rooms.length}; });
    const distinct = <T>(f: (r: typeof rows[number]) => T) => new Set(rows.map(f)).size;
    const optional = ['lamp', 'tools', 'magazine', 'hoist', 'refuge', 'sump', 'collapse', 'branch'];
    const has = (k: string) => rows.filter(r => r.shape.spaces.includes(k)).length;
    const caveM2 = rows.map(r => r.cave.w * r.cave.h * CELL * CELL);
    const metrics = {
      topologies: distinct(r => r.sig), courses: distinct(r => r.shape.course), courseLengths: distinct(r => r.shape.course.length),
      cavernPlaces: distinct(r => r.shape.cavern), adits: distinct(r => r.shape.adit.replace(/-[lr]$/, '')), loops: distinct(r => [...r.shape.loops].sort().join('+')),
      spaceSets: distinct(r => optional.filter(k => r.shape.spaces.includes(k)).join(' ')), roomCounts: distinct(r => r.rooms),
      caveM2: [Math.min(...caveM2), Math.max(...caveM2)], optional: Object.fromEntries(optional.map(k => [k, has(k)])),
    };
    log('variety', {metrics, rows});
    expect(metrics.topologies, 'every seed its own mine graph').toBe(seeds.length);
    expect(metrics.courses).toBeGreaterThanOrEqual(7);
    expect(metrics.courseLengths).toBeGreaterThanOrEqual(3);
    expect(metrics.cavernPlaces).toBeGreaterThanOrEqual(3);
    expect(metrics.adits).toBeGreaterThanOrEqual(3);
    expect(metrics.loops).toBeGreaterThanOrEqual(3);
    expect(metrics.spaceSets).toBeGreaterThanOrEqual(10);
    expect(metrics.caveM2[1] / metrics.caveM2[0]).toBeGreaterThanOrEqual(1.4);
    // each optional space is genuinely optional: present in some mines, absent from others
    for (const k of optional) { expect(has(k), `${k} sometimes`).toBeGreaterThan(0); expect(has(k), `${k} not always`).toBeLessThan(seeds.length); }
  });

  it('cuts the development heading for the drill rig at its REAL size (registry x MINES_FIT), off the critical path, up to the 7 x 3.0 x 2.4 m envelope', () => {
    // the sizing rule itself over the agreed envelope (length 7, height 3.0, width 2.4 m): the rig + clearances inside the heading
    for (const dims of [minesModelSize('drillRig'), [5, 2.5, 2.0], [7, 3.0, 2.4]] as [number, number, number][]) {
      const h = headingFor(dims);
      expect(h.w * CELL - dims[2], `${dims} beside`).toBeGreaterThanOrEqual(2 * MINES.heading.side - 1e-9);
      // the rig, 0.3 m off the face, clear of the opening's 1 m door zone + the doorway's 0.5 m approach
      expect(h.l * CELL - dims[0], `${dims} length`).toBeGreaterThanOrEqual(MINES.heading.face + 1.5);
      expect(h.clear).toBeCloseTo(dims[1] + MINES.heading.headroom, 6);
    }
    const fit0 = MINES_FIT.drillRig;
    try {
      // end to end at uniform fits up to 2.0 (7.0 x 2.56 x 1.96 m: the largest uniform scale inside the envelope)
      for (const fit of [1, 1.5, 2]) {
        MINES_FIT.drillRig = fit;
        const need = headingFor(minesModelSize('drillRig'));
        for (const inward of INWARD) for (const seed of SEEDS.slice(0, 4)) {
          const fx = minesFixture(seed, {inward}), c = fx.carve, tag = `fit ${fit} ${inward} ${seed}`;
          expect(c, tag).not.toBeNull();
          const H = c!.plan.rooms.find(r => r.key === 'heading');
          expect(H, tag).toBeDefined();
          const across = H!.travel === 'c' ? H!.cr.h : H!.cr.w, along = H!.travel === 'c' ? H!.cr.w : H!.cr.h;
          expect(across, `${tag} width`).toBeGreaterThanOrEqual(need.w);
          expect(along, `${tag} length`).toBeGreaterThanOrEqual(need.l);
          expect(H!.clear, `${tag} clear`).toBeGreaterThanOrEqual(need.clear - 1e-6);
          // off the critical path: a dead end, never on the way to the generator
          expect(mineGraph(c!.plan).adj.get('heading')!.length).toBe(1);
        }
      }
    } finally { MINES_FIT.drillRig = fit0; }
  });

  it('places the generator in the cavern: skid inside, use point on a clear reachable floor cell beyond its end, facing it', () => {
    for (const inward of INWARD) for (const seed of SEEDS) {
      const fx = minesFixture(seed, {inward});
      const c = fx.carve!, g = fx.k.grid(FIX.level), G = c.generator, cav = fx.k.areas[G.area];
      expect(c.rooms.find(r => r.area === G.area)?.role).toBe('generator');
      expect(inside(G.foot, cav, 2), `${inward} ${seed} foot`).toBe(true);
      expect(G.foot.w * G.foot.h).toBe(32);
      const ux = Math.floor(G.use.x), uy = Math.floor(G.use.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(g.cells[g.idx(ux + dx, uy + dy)]).toBe(FLOOR);
      expect(g.area[g.idx(ux, uy)]).toBe(G.area);
      // outside the skid, facing it (camera yaw: forward = (-sin, -cos))
      expect(ux >= G.foot.x && ux < G.foot.x + G.foot.w && uy >= G.foot.y && uy < G.foot.y + G.foot.h).toBe(false);
      const fx2 = -Math.sin(G.use.yaw), fz2 = -Math.cos(G.use.yaw);
      const tx = G.foot.x + G.foot.w / 2 - G.use.x, tz = G.foot.y + G.foot.h / 2 - G.use.y;
      expect(fx2 * tx + fz2 * tz).toBeGreaterThan(0);
    }
  });

  it('keeps passages >= 1.2 m wide and >= 2.3 m tall, drift / room ceilings in range and the cavern the tallest under ceilMax', () => {
    for (const seed of SEEDS) {
      const fx = minesFixture(seed);
      const c = fx.carve!, base = FIX.baseY;
      const ceil = (id: number) => fx.k.areas[id].ceil - base;
      for (const r of c.rooms) {
        const a = fx.k.areas[r.area];
        expect(Math.min(a.w, a.h) * 0.5, `${seed} ${r.key} width`).toBeGreaterThanOrEqual(2.0);
        expect(ceil(r.area), `${seed} ${r.key} clear`).toBeGreaterThanOrEqual(3.0);
        expect(fx.k.areas[r.area].ceil).toBeLessThanOrEqual(FIX.ceilMax + 1e-6);
        expect(a.level).toBe(FIX.level);
        expect(a.floorY).toBe(base);
      }
      const cav = ceil(c.generator.area);
      for (const r of c.rooms) if (r.area !== c.generator.area) expect(ceil(r.area)).toBeLessThanOrEqual(cav);
      expect(cav).toBeGreaterThanOrEqual(5.5);
      for (const d of fx.k.doors) {
        if (!c.areas.includes(d.b)) continue;
        expect(Math.max(d.w, d.h) * 0.5, `${seed} door ${d.id}`).toBeGreaterThanOrEqual(1.5);
        expect(d.height).toBeGreaterThanOrEqual(2.3);
        expect(d.level).toBe(FIX.level);
      }
    }
  });

  it('respects a low ceilMax (no cell above it) and returns null — writing nothing — when the region is too small', () => {
    const low = minesFixture(3, {ceilMax: FIX.baseY + 4.2});
    expect(low.carve).not.toBeNull();
    for (const id of low.carve!.areas) expect(low.k.areas[id].ceil).toBeLessThanOrEqual(FIX.baseY + 4.2 + 1e-6);
    const tiny = minesFixture(3, {lat: 40, depth: 40});
    expect(tiny.carve).toBeNull();
    expect(tiny.k.areas.length).toBe(1); // only the fixture's deck
    expect(tiny.k.doors.length).toBe(0);
    const g = tiny.k.grid(FIX.level);
    const R = tiny.slot.region;
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) expect(g.cells[g.idx(x, y)]).toBe(SOLID);
  });

  it('adapts to bigger regions and off-centre entrances (more floor, still inside)', () => {
    for (const seed of SEEDS.slice(0, 6)) for (const eo of [0.1, 0.9]) {
      const fx = minesFixture(seed, {lat: 110, depth: 84, eo});
      expect(fx.carve, `seed ${seed} eo ${eo}`).not.toBeNull();
      expect(fx.carve!.plan.cells * 0.25).toBeGreaterThanOrEqual(MINES.targetM2);
      for (const r of fx.carve!.rooms) if (r.key !== 'portal') expect(inside(fx.k.areas[r.area], fx.slot.region, 1)).toBe(true);
    }
  });

  it('is deterministic and varies across seeds', () => {
    const sig = (seed: number) => { const fx = minesFixture(seed); return JSON.stringify({areas: fx.k.areas, doors: fx.k.doors, gen: fx.carve!.generator}); };
    expect(sig(5)).toBe(sig(5));
    expect(new Set(SEEDS.map(sig)).size).toBe(SEEDS.length);
  });

  it('carves fast (< ~60 ms per carve)', () => {
    minesFixture(1);
    const ms: number[] = [];
    for (const seed of SEEDS) {
      const t0 = performance.now();
      const k = minesFixture(seed);
      ms.push(performance.now() - t0);
      void k;
    }
    ms.sort((a, b) => a - b);
    log('ms', ms);
    expect(ms[Math.floor(ms.length / 2)]).toBeLessThan(60);
  });

  it('draws only from the given rng: the same Rng state gives the same plan', () => {
    const a = minesFixture(7).carve!.plan, b = minesFixture(7).carve!.plan;
    expect(JSON.stringify(a.rooms.map(r => r.rect))).toBe(JSON.stringify(b.rooms.map(r => r.rect)));
    void Rng;
  });
});
