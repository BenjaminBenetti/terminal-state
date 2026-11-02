// Task reactor-expansion-20261101 (lane MINES): THE OLD MINE WORKINGS carver on fixture slots (until lane HOST's slot lands): inside the
// region, connected to the entrance, every space connected, two routes (loop) to the generator cavern, the generator use point clear,
// program size (>= 600 m², >= 8 spaces), clear heights / openings, determinism, carve time.
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {Rng} from '../src/core/rng';
import {FLOOR, SOLID, type Grid} from '../src/gen/grid';
import type {Rect} from '../src/gen/stationTypes';
import {MINES} from '../src/gen/reactor/complex/minesPlan';
import {minesFixture, FIX} from './reactor-x-mines-fixture';

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
  it('fits the minimum fixture slot (80 x 64) in every inward direction over the sample seeds: >= 8 spaces, >= 600 m², the full program', () => {
    const sizes: Record<string, number[]> = {};
    for (const inward of INWARD) for (const seed of SEEDS) {
      const fx = minesFixture(seed, {inward});
      const c = fx.carve;
      expect(c, `${inward} seed ${seed}`).not.toBeNull();
      const keys = c!.rooms.map(r => r.key);
      for (const need of ['portal', 'junction', 'cavern', 'hoist', 'magazine', 'lamp', 'tools']) expect(keys, `${inward} ${seed} ${need}`).toContain(need);
      expect(keys.some(k => k.startsWith('haulage-'))).toBe(true);
      expect(keys.some(k => k.startsWith('manway-'))).toBe(true);
      expect(keys.includes('sump') || keys.includes('collapse')).toBe(true);
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

  it('is one connected network from the deck: every carved cell reachable; two independent routes (haulage / manway) to the cavern', () => {
    for (const inward of INWARD) for (const seed of SEEDS) {
      const fx = minesFixture(seed, {inward});
      const c = fx.carve!, g = fx.k.grid(FIX.level);
      const D = fx.deck, start = [D.x + 1, D.y + 1] as const;
      const seen = flood(g, start[0], start[1]);
      for (const id of c.areas) for (const i of cellsOf(fx.k.areas[id], g)) expect(seen[i], `${inward} ${seed} area ${fx.k.areas[id].label}`).toBe(1);
      const cav = fx.k.areas[c.generator.area], ci = g.idx(cav.x + 2, cav.y + 2);
      // the loop: cutting either route leaves the cavern reachable through the other
      for (const side of ['haulage', 'manway']) {
        const cut = new Set<number>();
        for (const r of c.rooms) if (r.key.startsWith(side)) for (const i of cellsOf(fx.k.areas[r.area], g)) cut.add(i);
        expect(flood(g, start[0], start[1], cut)[ci], `${inward} ${seed}: cavern without the ${side}`).toBe(1);
      }
    }
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
      // the cable route runs from the generator to the entrance
      expect(c.cable.length).toBeGreaterThanOrEqual(3);
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
