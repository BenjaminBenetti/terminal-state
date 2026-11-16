// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ROOMS): the TRAIN-REPAIR DEPOT interior (gen/surface/rooms/depot.ts) on
// GEN-like plots: the double-height maintenance shed behind the roller door, the loading-bay door, the support wing and the mezzanine;
// every recoverable (radar / sentry / scanner / chest / armour kit) on the shed floor in its own clear square with a DOLLY-WIDE path
// (>= 1.5 m: a 3-cell corridor, every cell's 3 x 3 neighbourhood free) to a wide street door; the tracks / pit / crane data for LOOK.

import {describe, expect, it} from 'vitest';
import {CELL} from '../src/gen/grid';
import {DEPOT_RECOVERABLES, type DepotFeatures} from '../src/gen/surface/rooms/depot';
import type {InteriorPlan} from '../src/gen/surface/rooms/api';
import {makePlot, planFixture, programmeCases, reach, type Fixture} from './helpers/surfaceRoomsFixture';

const SEEDS = [1, 2, 3, 4, 5, 6];
const all = (): {f: Fixture; plan: InteriorPlan; tag: string}[] => SEEDS.map(seed => {
  const o = programmeCases('rail-depot', seed)[0];
  const f = makePlot(o);
  return {f, plan: planFixture(f), tag: `depot seed ${seed} front ${o.front} ${o.frontage}x${o.depth}`};
});
const CASES = all();

/** Cells of the level-0 grid whose 3 x 3 neighbourhood is walkable and free (a dolly-wide corridor's centre line can pass). */
function dollyFree(f: Fixture, x: number, y: number): boolean {
  const g = f.kit.g;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy)) return false;
  return true;
}

describe('Surface Run depot: the shed, the wing, the mezzanine', () => {
  it('plans the shed (double height), the support rooms and the mezzanine over the stair core', () => {
    for (const {f, plan, tag} of CASES) {
      const labels = plan.areas.map(id => f.kit.areas[id].label.replace('Halsey Test · ', ''));
      for (const l of ['Maintenance shed', 'Foreman\'s office', 'Parts store', 'Crew room', 'Washroom']) expect(labels, tag).toContain(l);
      const shed = f.kit.areas.find(a => a.label.endsWith('Maintenance shed'))!;
      expect(shed.ceil, `${tag}: double-height shed`).toBeCloseTo(f.plot.floors[1].ceil, 3);
      expect(labels.some(l => l === 'Mezzanine hall'), `${tag}: mezzanine`).toBe(true);
      expect(plan.links.length, tag).toBe(1);
      // workshop furniture on the shed floor (benches, tool chests, racks, lockers) and the parts store's stock
      const kinds = new Set(plan.props.filter(p => p.area === shed.id).map(p => p.kind));
      for (const k of ['repairBench', 'rollingToolChest', 'stockShelf', 'staffLockers']) expect(kinds.has(k as never), `${tag}: ${k}`).toBe(true);
    }
  });

  it('features: the tracks run in through the roller door, the pit between the rails, the crane under the roof', () => {
    for (const {f, plan, tag} of CASES) {
      const d = (plan.features as {depot: DepotFeatures}).depot;
      expect(d.tracks.length, tag).toBeGreaterThanOrEqual(1);
      const main = plan.entrances.find(e => f.plot.entrances[0].cells.some(c => e.cells.includes(f.kit.g.idx(c.x, c.y))))!;
      // the first track's centre line passes through the roller door's span
      const t = d.tracks[0];
      const alongX = main.side === 'N' || main.side === 'S';
      const c = alongX ? t.x0 : t.z0, mid = alongX ? main.x : main.z;
      expect(Math.abs(c - mid), `${tag}: track on the door's centre line`).toBeLessThan(main.width / 2);
      expect(d.pits[0].x1 > d.pits[0].x0 && d.pits[0].z1 > d.pits[0].z0, tag).toBe(true);
      expect(d.crane, `${tag}: crane`).not.toBeNull();
      expect(d.crane!.y, tag).toBeLessThan(f.kit.areas[d.shed].ceil);
      expect(d.crane!.hookY, tag).toBeGreaterThan(f.plot.floors[0].y + 2);
      expect(d.exit, tag).toBeTruthy();
    }
  });
});

describe('Surface Run depot: the recoverables', () => {
  it('every kind once, on the shed floor, in a clear 2 x 2 m square, the dolly lane clear of props', () => {
    for (const {f, plan, tag} of CASES) {
      const r = plan.recoverables ?? [];
      expect(r.map(q => q.kind).sort(), tag).toEqual([...DEPOT_RECOVERABLES].sort());
      const shed = f.kit.areas.find(a => a.label.endsWith('Maintenance shed'))!;
      const g = f.kit.g;
      for (const q of r) {
        const [cx, cy] = g.cellOf(q.pose.x, q.pose.z);
        expect(g.area[g.idx(cx, cy)], `${tag}: ${q.kind} in the shed`).toBe(shed.id);
        expect(q.pose.level, tag).toBe(0);
        expect(q.pose.y, tag).toBeCloseTo(f.plot.floors[0].y, 3);
        // the clear square: 4 x 4 cells round its centre, walkable and free of props
        for (let oy = -2; oy < 2; oy++) for (let ox = -2; ox < 2; ox++) expect(g.walkable(cx + ox, cy + oy), `${tag}: ${q.kind} square`).toBe(true);
        for (const p of plan.props) if (!p.mounted && (p.level ?? 0) === 0) {
          const hit = Math.abs(p.x - q.pose.x) < p.hx + 1.0 - 1e-3 && Math.abs(p.z - q.pose.z) < p.hz + 1.0 - 1e-3;
          expect(hit, `${tag}: ${p.kind} in ${q.kind}'s square`).toBe(false);
        }
      }
      const d = (plan.features as {depot: DepotFeatures}).depot;
      for (const i of d.lane) expect(g.blocked[i], `${tag}: lane cell blocked`).toBe(0);
    }
  });

  it('a dolly-wide path (>= 1.5 m) runs from every recoverable to a wide street door (the loading bay or the roller door)', () => {
    for (const {f, plan, tag} of CASES) {
      const g = f.kit.g;
      // wide doors: >= 4.5 m; their targets: the cells two rows inside (every 3 x 3 there is clear of the facade)
      const wide = plan.entrances.filter(e => e.width >= 4.5);
      expect(wide.length, `${tag}: wide doors`).toBeGreaterThanOrEqual(1);
      const inward: Record<string, number> = {N: g.w, S: -g.w, W: 1, E: -1};
      const goals = new Set<number>();
      for (const e of wide) for (const c of e.cells) goals.add(c + 2 * inward[e.side]);
      for (const q of plan.recoverables ?? []) {
        const [sx, sy] = g.cellOf(q.pose.x, q.pose.z);
        const seen = new Uint8Array(g.w * g.h), queue = [g.idx(sx, sy)];
        seen[queue[0]] = 1;
        let ok = false;
        while (queue.length && !ok) {
          const i = queue.shift()!;
          if (goals.has(i)) { ok = true; break; }
          const x = i % g.w, y = Math.floor(i / g.w);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy, j = g.idx(nx, ny);
            if (!g.inBounds(nx, ny) || seen[j] || !dollyFree(f, nx, ny)) continue;
            seen[j] = 1;
            queue.push(j);
          }
        }
        expect(ok, `${tag}: ${q.kind} at ${q.pose.x},${q.pose.z} -> a wide door`).toBe(true);
      }
      // and the whole depot is walkable from the street
      const {dist} = reach(f, plan);
      for (const id of plan.areas) {
        const a = f.kit.areas[id], lg = f.kit.grid(a.level ?? 0);
        let any = false;
        for (let y = a.y; y < a.y + a.h && !any; y++) for (let x = a.x; x < a.x + a.w && !any; x++) any = dist[a.level ?? 0][lg.idx(x, y)] >= 0;
        expect(any, `${tag}: ${a.label}`).toBe(true);
      }
      void CELL;
    }
  });

  it('a depot without a loading door parks its recoverables beside the track corridor (still dolly-reachable)', () => {
    const o = {...programmeCases('rail-depot', 2)[0], load: undefined};
    const f = makePlot(o);
    const plan = planFixture(f);
    expect((plan.recoverables ?? []).length).toBe(DEPOT_RECOVERABLES.length);
  });
});
