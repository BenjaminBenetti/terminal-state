// Task studio-market-irregular-settlement-20261117-003819-01: THE SURVIVOR MARKET's layout version 7 — version 6's enveloped crevice on an
// IRREGULAR SETTLEMENT FLOORPLAN (gen/market/v7/settlement.ts) over a seed sample, both mirror states:
//  - the default for new / unvisited markets (a recorded 5 / 6 regenerates byte for byte: market-crevice-envelope.test.ts);
//  - every layout validates (creviceIssues: the envelope's rules + the settlement's — every walk 2.5 m or more, the pit 3.5 m or more,
//    row by row) within the generation budget; deterministic; the settlement kept (containers both sides on four storeys, bridges on
//    every terrace, the stalls / bar / den) and as dense as version 6's;
//  - NOT SQUARE: every terrace edge over the drop steps (each storey and side its own sections), the two sides differ, the storeys stand
//    at different setbacks, the sections' breaks are staggered from storey to storey, the pit's walkable outline steps too;
//  - the stepped outline railed along the drop, nothing railed inside the pit; every walk section reachable without a ladder; the flat
//    1.5 m way from the train to the heavy shops and the den;
//  - the residents: the homes keep version 6's hiding corners, a route's leg up a whole flight is never squared into a step;
//  - the art follows the outline (the bridges' cabled bays only over the pit, the lines' ends on their own storey's edge) and the
//    finishes the pit's own runs (its bed the chasm's, the low walks never).
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {CELL, FLOOR, PathFinder, SOLID, VOID, type Waypoint} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {LEVELS} from '../src/levels/registry';
import {CREVICE_GEN_STATS, MARKET_LAYOUT_VERSION, creviceIssues, generateMarketLevel, marketLayoutIssues} from '../src/gen/market/index';
import {MARKET_STALLS_ALL} from '../src/gen/market/marketTypes';
import {SETTLEMENT} from '../src/gen/market/v7/settlement';
import {CREVICE_DRESS_QA} from '../src/gen/market/v5/dress';
import {creviceBridgePieces, creviceLines} from '../src/gen/market/v5/art';
import {CREVICE_KEYS} from '../src/world/marketArch';
import {MARKET_BRIDGE_KIT} from '../src/assets/marketBridgeKit.generated';
import {MARKET_PEOPLE, MarketPeople, type MarketPeopleHost} from '../src/market/marketPeople';
import {marketRefuges} from '../src/market/people/refuges';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 42, 777, 4242, 9001, 31337, 20261116];
// (one untimed generation first: a worker's first layout also compiles the generator; the budget below is per layout)
generateMarketLevel({levelSeed: 99, layoutVersion: 7});
const runs = SEEDS.map(seed => {
  const L = generateMarketLevel({levelSeed: seed, layoutVersion: 7});
  return {seed, L, ms: CREVICE_GEN_STATS.ms, attempts: CREVICE_GEN_STATS.attempts};
});

function fingerprint(l: StationLayout): string {
  const g = l.levels.map(L => crypto.createHash('sha256').update(Buffer.from(L.grid.cells)).update(Buffer.from(L.grid.area.buffer)).update(Buffer.from(L.grid.floor.buffer)).update(Buffer.from(L.grid.ceil.buffer)).update(Buffer.from(L.grid.blocked)).update(Buffer.from(L.grid.sightBlocked)).digest('hex'));
  const s = JSON.stringify({g, areas: l.areas, doors: l.doors, props: l.props, lights: l.lights, signs: l.signs, market: l.market, rails: l.rails, links: l.levelLinks, spawn: l.playerSpawn, lad: l.traversal.ladders, st: l.traversal.stairs, name: l.name});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Cells (storey 0) a body / cargo carrier reaches from the start: walkable, off the stairs, a 0.5 m clear disc, no floor step. */
function carryField(L: StationLayout): Uint8Array {
  const g = L.grid, W = g.w, n = g.cells.length, seen = new Uint8Array(n);
  const ok = (i: number) => { const x = i % W, y = (i / W) | 0, [cx, cz] = g.center(x, y); return g.walkable(x, y) && g.rampIdx[i] < 0 && g.circleClear(cx, cz, 0.5); };
  const [sx, sy] = g.cellOf(L.playerSpawn.x, L.playerSpawn.z), s = g.idx(sx, sy);
  if (!ok(s)) return seen;
  const q = [s];
  seen[s] = 1;
  while (q.length) {
    const c = q.pop()!, x = c % W;
    for (const j of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
      if (j < 0 || j >= n || seen[j] || !ok(j) || Math.abs(g.floorOf(j) - g.floorOf(c)) > 0.2) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}
const carryNear = (L: StationLayout, f: Uint8Array, x: number, z: number, r = 1.2) => {
  const g = L.grid;
  for (let i = 0; i < f.length; i++) if (f[i]) { const [cx, cz] = g.center(i % g.w, (i / g.w) | 0); if (Math.hypot(cx - x, cz - z) <= r) return true; }
  return false;
};

/** A storey's edge over the drop on one world side: its x at each crevice row's centre (NaN off its runs). */
const edgeRows = (L: StationLayout, lv: number, side: 'W' | 'E'): number[] => {
  const cr = L.market!.crevice!, runs = cr.settlement!.edges[lv][side], out: number[] = [];
  for (let z = cr.chasm.z0 + CELL / 2; z < cr.chasm.z1; z += CELL) out.push(runs.find(q => z >= q.z0 && z < q.z1)?.x ?? NaN);
  return out;
};
/** Where an edge steps (z, m). */
const stepsOf = (L: StationLayout, lv: number, side: 'W' | 'E') => {
  const cr = L.market!.crevice!, e = cr.settlement!.edges[lv][side], out: number[] = [];
  for (let k = 1; k < e.length; k++) if (e[k].x !== e[k - 1].x && e[k].z0 > cr.chasm.z0 && e[k].z0 < cr.chasm.z1) out.push(e[k].z0);
  return out;
};

describe('Survivor Market layout version 7 (the irregular settlement floorplan)', () => {
  it('the default for new / unvisited markets; every seed validates within the budget; deterministic; the settlement kept', () => {
    expect(MARKET_LAYOUT_VERSION).toBe(7);
    expect(LEVELS.market.generate('main', {levelSeed: 42}).market?.v).toBe(7);
    for (const {seed, L, ms, attempts} of runs) {
      expect(creviceIssues(L), `seed ${seed}`).toEqual([]);
      expect(marketLayoutIssues(L), `seed ${seed}`).toEqual([]);
      expect(ms, `seed ${seed} gen ms`).toBeLessThan(400);
      expect(attempts, `seed ${seed} attempts`).toBeLessThanOrEqual(4);
      expect(L.market!.v).toBe(7);
      expect(L.market!.stalls.map(s => s.id)).toEqual([...MARKET_STALLS_ALL]);
      expect(L.market!.den).toBeTruthy();
      const cr = L.market!.crevice!, mid = (cr.chasm.x0 + cr.chasm.x1) / 2;
      expect(cr.envelope, `seed ${seed} envelope`).toBeTruthy();
      expect(cr.settlement, `seed ${seed} settlement`).toBeTruthy();
      expect(cr.containers.length, `seed ${seed} containers`).toBeGreaterThanOrEqual(38);
      for (let lv = 0; lv < 4; lv++) for (const west of [true, false]) {
        expect(cr.containers.some(c => c.level === lv && ((c.x0 + c.x1) / 2 < mid) === west), `seed ${seed} storey ${lv} ${west ? 'west' : 'east'}`).toBe(true);
      }
      expect(new Set(cr.bridges.map(b => b.level)), `seed ${seed} bridge storeys`).toEqual(new Set([1, 2, 3]));
      const rooms = new Set(cr.containers.filter(c => c.area >= 0).map(c => c.area));
      for (const s of L.market!.stalls) if (s.id !== 'bar') expect(rooms.has(s.area), `seed ${seed} stall ${s.id}`).toBe(true);
    }
    for (const {seed, L} of runs.slice(0, 3)) {
      expect(fingerprint(generateMarketLevel({levelSeed: seed, layoutVersion: 7}))).toBe(fingerprint(L));
      const v6 = generateMarketLevel({levelSeed: seed, layoutVersion: 6});
      expect(L.name).toBe(v6.name);
      expect(L.market!.stalls.map(s => s.id)).toEqual(v6.market!.stalls.map(s => s.id));
    }
    const mirrored = runs.map(r => r.L.market!.den!.door.x < r.L.grid.w * CELL / 2);
    expect(new Set(mirrored).size).toBe(2);
  });

  it('as dense as version 6: containers, open homes / shops, props, lights and resident posts over the sample', () => {
    const sum = (f: (L: StationLayout) => number, v: 6 | 7) => runs.reduce((s, r) => s + f(v === 7 ? r.L : generateMarketLevel({levelSeed: r.seed, layoutVersion: 6})), 0);
    const cont = (L: StationLayout) => L.market!.crevice!.containers.length, open = (L: StationLayout) => L.market!.crevice!.containers.filter(c => c.area >= 0).length;
    const posts = (L: StationLayout) => L.market!.spots.length;
    expect(sum(cont, 7)).toBeGreaterThanOrEqual(0.97 * sum(cont, 6));
    expect(sum(open, 7)).toBeGreaterThanOrEqual(0.93 * sum(open, 6));
    expect(sum(L => L.props.length, 7)).toBeGreaterThanOrEqual(sum(L => L.props.length, 6));
    expect(sum(L => L.lights.length, 7)).toBeGreaterThanOrEqual(sum(L => L.lights.length, 6));
    expect(sum(posts, 7)).toBeGreaterThanOrEqual(0.95 * sum(posts, 6));
    // (the plazas: some seeds' wide walk sections get a seating group)
    expect(runs.filter(r => (CREVICE_DRESS_QA.get(r.L)?.counts.plaza ?? 0) > 0).length).toBeGreaterThanOrEqual(3);
  });

  it('not square: every terrace edge steps on its own, the sides differ, the storeys stand at different setbacks, the breaks staggered', () => {
    const spreads: number[] = [];
    for (const {seed, L} of runs) {
      const cr = L.market!.crevice!, st = cr.settlement!, mid = (cr.chasm.x0 + cr.chasm.x1) / 2;
      let stepped = 0;
      for (let lv = 0; lv < 4; lv++) for (const side of ['W', 'E'] as const) {
        const xs = edgeRows(L, lv, side).filter(Number.isFinite);
        expect(xs.length, `seed ${seed} storey ${lv} ${side} edge rows`).toBeGreaterThan(0);
        if (new Set(xs).size >= 2) stepped++;
      }
      expect(stepped, `seed ${seed} stepped edges of 8`).toBeGreaterThanOrEqual(6);
      // the two sides are no mirror image: their edges' distances from the crevice's centre line differ on most rows somewhere up the storeys
      let differ = 0, rows = 0;
      for (let lv = 1; lv < 4; lv++) {
        const w = edgeRows(L, lv, 'W'), e = edgeRows(L, lv, 'E');
        for (let k = 0; k < w.length; k++) { rows++; if (Math.abs((mid - w[k]) - (e[k] - mid)) > 0.25) differ++; }
      }
      expect(differ / rows, `seed ${seed} rows where the sides differ`).toBeGreaterThan(0.5);
      // the storeys stand at different setbacks: each terrace's mean walk width (its own walk cells per crevice row, off the bridges' rows)
      // differs from storey to storey (over the sample below: a stair bay holds its section flush, as on version 5, so now and then one
      // side's storeys come out close)
      const zr0 = Math.round(cr.chasm.z0 / CELL), zr1 = Math.round(cr.chasm.z1 / CELL), xm = mid / CELL;
      const onBridge = (y: number) => cr.bridges.some(b => (y + 0.5) * CELL > b.z0 - 0.5 && (y + 0.5) * CELL < b.z1 + 0.5);
      for (const west of [true, false]) {
        const means = [1, 2, 3].map(lv => {
          const g = L.levels[lv].grid;
          let s = 0, n = 0;
          for (let y = zr0; y < zr1; y++) {
            if (onBridge(y)) continue;
            let c = 0;
            for (let x = 0; x < g.w; x++) { const i = g.idx(x, y), a = L.areas[g.area[i]]; if ((x < xm) === west && g.cells[i] === FLOOR && a?.role === 'catwalk' && a.level === lv) c++; }
            s += c; n++;
          }
          return s / n * CELL;
        });
        spreads.push(Math.max(...means) - Math.min(...means));
      }
      // the sections' breaks: a storey's edge never steps on the same row as the storey under it (staggered)
      for (const side of ['W', 'E'] as const) for (let lv = 2; lv < 4; lv++) {
        const lower = stepsOf(L, lv - 1, side);
        for (const z of stepsOf(L, lv, side)) expect(lower.every(q => Math.abs(q - z) >= 1), `seed ${seed} ${side} storey ${lv} step at ${z}`).toBe(true);
      }
      // the pit's walkable outline steps: runs of different widths, every one 3.5 m or more
      expect(new Set(st.pit.map(p => p.x1 - p.x0)).size, `seed ${seed} pit widths`).toBeGreaterThanOrEqual(2);
      for (const p of st.pit) expect(p.x1 - p.x0, `seed ${seed} pit run`).toBeGreaterThanOrEqual(SETTLEMENT.pitMin * CELL - 1e-6);
    }
    // (the storeys' setbacks over the sample: never one ribbon repeated; most sides' storeys 0.5 m or more apart, typically about 1 m)
    spreads.sort((p, q) => p - q);
    expect(spreads[0]).toBeGreaterThan(0.1);
    expect(spreads.filter(v => v >= 0.5).length / spreads.length).toBeGreaterThanOrEqual(0.85);
    expect(spreads[spreads.length >> 1]).toBeGreaterThanOrEqual(0.8);
  });

  it('the stepped outline railed along the drop, nothing railed inside the pit; every walk section reachable, no ladder', () => {
    for (const {seed, L} of runs) {
      const cr = L.market!.crevice!, st = cr.settlement!;
      // storey 0: the pit's stepped edges (each run's x0 / x1 over its rows) railed at least 85 % of their length, nothing inside a run
      let want = 0, got = 0;
      for (const p of st.pit) for (const xe of [p.x0, p.x1]) {
        want += p.z1 - p.z0;
        for (const r of L.rails) {
          if (r.level !== 0 || Math.abs(r.x0 - xe) > 0.01 || Math.abs(r.x1 - xe) > 0.01) continue;
          got += Math.max(0, Math.min(p.z1, Math.max(r.z0, r.z1)) - Math.max(p.z0, Math.min(r.z0, r.z1)));
        }
        const inside = L.rails.filter(r => r.level === 0 && Math.min(r.x0, r.x1) > p.x0 + 0.01 && Math.max(r.x0, r.x1) < p.x1 - 0.01 && Math.min(r.z0, r.z1) > p.z0 + 0.01 && Math.max(r.z0, r.z1) < p.z1 - 0.01);
        expect(inside, `seed ${seed}`).toEqual([]);
      }
      expect(got / want, `seed ${seed} pit edge railed`).toBeGreaterThanOrEqual(0.85);
      // the terraces: each storey's edge over the chasm's rows railed where no bridge or stair meets it (>= 70 % of its length)
      for (let lv = 1; lv < 4; lv++) {
        let w = 0, g = 0;
        for (const side of ['W', 'E'] as const) for (const q of st.edges[lv][side]) {
          const z0 = Math.max(q.z0, cr.chasm.z0), z1 = Math.min(q.z1, cr.chasm.z1);
          if (z1 <= z0) continue;
          w += z1 - z0;
          for (const r of L.rails) {
            if (r.level !== lv || Math.abs(r.x0 - q.x) > 0.01 || Math.abs(r.x1 - q.x) > 0.01) continue;
            g += Math.max(0, Math.min(z1, Math.max(r.z0, r.z1)) - Math.max(z0, Math.min(r.z0, r.z1)));
          }
        }
        expect(g / w, `seed ${seed} storey ${lv} edge railed`).toBeGreaterThanOrEqual(0.7);
      }
    }
    // a stair run's rock side, one storey up: no wider terrace walk than version 5's (the band's own back wall column) — residents'
    // routes smoothed across a wider walk up there hug the run's wall and stall
    for (const {seed, L} of runs) {
      let wide = 0;
      for (let lv = 0; lv + 1 < L.levels.length; lv++) {
        const g = L.levels[lv].grid, up = L.levels[lv + 1].grid;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.rampIdx[i] < 0 || up.rampIdx[i] < 0) continue;
          const x = i % g.w;
          for (const d of [-1, 1]) {
            const j = i + d, j2 = i + 2 * d;
            if (x + 2 * d < 0 || x + 2 * d >= g.w || g.cells[j] !== SOLID || g.cells[j2] !== SOLID) continue;
            if (up.cells[j] === FLOOR && up.cells[j2] === FLOOR && up.rampIdx[j2] < 0 && up.floorOf(j2) > up.floorOf(i) + 0.6 && L.areas[up.area[j2]]?.role === 'catwalk') wide++;
          }
        }
      }
      expect(wide, `seed ${seed} upper walk wider than a column over a stair run's wall`).toBe(0);
    }
    // every walk section (low walk / terrace part) reachable from the general store's trader without a ladder
    for (const {seed, L} of runs.slice(0, 4)) {
      const pf = new PathFinder(levelsOf(L)), m = L.market!, hub = m.stalls.find(s => s.id === 'general')!.trader;
      const parts = L.areas.filter(a => a.role === 'catwalk' || a.label === 'Low walk');
      expect(parts.length, `seed ${seed} walk sections`).toBeGreaterThan(12);
      for (const a of parts) {
        const g = L.levels[a.level ?? 0].grid;
        let cell = -1;
        for (let y = a.y; y < a.y + a.h && cell < 0; y++) for (let x = a.x; x < a.x + a.w; x++) { const i = g.idx(x, y); if (g.cells[i] === FLOOR && g.area[i] === a.id && g.rampIdx[i] < 0) { cell = i; break; } }
        expect(cell, `seed ${seed} area ${a.id} has a floor cell`).toBeGreaterThanOrEqual(0);
        const [x, z] = g.center(cell % g.w, (cell / g.w) | 0), y = g.floorOf(cell);
        expect(pf.find(hub.x, hub.z, x, z, 0.34, MARKET_PEOPLE.maxExpand, {ay: hub.y, by: y, noLinks: true}), `seed ${seed}: hub -> ${a.label} ${a.id}@${a.level}`).not.toBeNull();
      }
    }
  });

  it('kept: the heavy shops and the den by the train on a flat 1.5 m way; every resident post on one ladder-free graph', () => {
    for (const {seed, L} of runs) {
      const f = carryField(L), m = L.market!;
      expect(m.stalls.filter(q => q.front.level === 0).map(q => q.id).sort(), `seed ${seed}`).toEqual(['fuel', 'general', 'gun', 'scrap']);
      for (const s of m.stalls.filter(q => q.front.level === 0)) expect(carryNear(L, f, s.front.x, s.front.z), `seed ${seed} ${s.id}`).toBe(true);
      const den = m.den!, ch = L.props[den.chute.prop];
      expect(carryNear(L, f, den.front.x, den.front.z), `seed ${seed} den front`).toBe(true);
      expect(carryNear(L, f, ch.x, ch.z, 1.2 + Math.max(ch.hx, ch.hz)), `seed ${seed} den chute`).toBe(true);
    }
    for (const {seed, L} of runs.slice(0, 4)) {
      const pf = new PathFinder(levelsOf(L)), m = L.market!;
      const posts = [...m.spots.map(s => ({x: s.x, z: s.z, y: s.y, what: `spot ${s.kind}@${s.level}`})), ...m.stalls.map(s => ({...s.trader, what: `trader ${s.id}`}))];
      const hub = m.stalls.find(s => s.id === 'general')!.trader;
      for (const p of posts) {
        expect(pf.find(hub.x, hub.z, p.x, p.z, 0.34, MARKET_PEOPLE.maxExpand, {ay: hub.y, by: p.y, noLinks: true}), `seed ${seed}: hub -> ${p.what}`).not.toBeNull();
        expect(pf.find(p.x, p.z, hub.x, hub.z, 0.34, MARKET_PEOPLE.maxExpand, {ay: p.y, by: hub.y, noLinks: true}), `seed ${seed}: ${p.what} -> hub`).not.toBeNull();
      }
    }
  });

  it('residents: the homes keep version 6\'s hiding corners; a route\'s leg up a whole flight is never squared into a "step"', () => {
    // (a home much under 5 m has no slot 1.25 m off its door once furnished: market/people/refuges.ts; fleers then fall back to bunks)
    const slots = (L: StationLayout) => marketRefuges(L, levelsOf(L)).filter(r => r.kind === 'home').reduce((s, r) => s + r.slots.length, 0);
    const v7 = runs.reduce((s, r) => s + slots(r.L), 0), v6 = runs.reduce((s, r) => s + slots(generateMarketLevel({levelSeed: r.seed, layoutVersion: 6})), 0);
    expect(v7).toBeGreaterThanOrEqual(0.95 * v6);
    // MarketPeople.squareSteps: a bent walk's string-pulled leg from a flight's foot diagonally up past its head stays one leg (its
    // "corner" was the floor above beside the foot, 2.5 m over the walker, who stood there for good)
    for (const {seed, L} of runs.slice(0, 4)) {
      const people = new MarketPeople({levels: levelsOf(L)} as unknown as MarketPeopleHost);
      for (const f of L.traversal.stairs) {
        const lo = f.bottom, hi = f.top, along = f.axis === 'z' ? Math.sign(hi.z - lo.z) : Math.sign(hi.x - lo.x);
        for (const off of [-1.5, 1.5]) {
          const end = f.axis === 'z' ? [hi.x + off, hi.z + along * 3] : [hi.x + along * 3, hi.z + off];
          const leg: Waypoint[] = [[lo.x, lo.z, undefined, lo.y], [end[0], end[1], undefined, hi.y]];
          expect(people.squareSteps(leg, lo.y), `seed ${seed} flight ${f.id} off ${off}`).toEqual(leg);
        }
      }
    }
  });

  it('the art follows the outline: cabled bridge bays only over the pit, every line end on its own storey\'s edge', () => {
    for (const {seed, L} of runs) {
      const cr = L.market!.crevice!, st = cr.settlement!;
      for (const p of creviceBridgePieces(L, MARKET_BRIDGE_KIT)) {
        if (p.piece !== 'Mid') continue;
        const b = cr.bridges[p.bridge];
        for (const q of st.pit) if (q.z1 > b.z0 + 1e-6 && q.z0 < b.z1 - 1e-6) expect(p.x0 >= q.x0 - 1e-3 && p.x1 <= q.x1 + 1e-3, `seed ${seed} bridge ${p.bridge} cabled bay over a walk`).toBe(true);
      }
      const ends = st.edges.flatMap(e => [...e.W, ...e.E]);
      const lines = creviceLines(L);
      expect(lines.length, `seed ${seed} lines`).toBeGreaterThan(3);
      for (const l of lines) for (const pl of l.poles) {
        expect(ends.some(q => Math.abs(q.x - pl.x) <= 0.05 && pl.z >= q.z0 - 1e-3 && pl.z <= q.z1 + 1e-3), `seed ${seed} pole at ${pl.x},${pl.z}`).toBe(true);
      }
    }
  });

  it('the finishes: the pit\'s own runs are the chasm (its bed keyed so), the low walks never; the atrium over the open crevice', () => {
    for (const seed of [7, 42]) {
      const L = runs.find(r => r.seed === seed)!.L, st = L.market!.crevice!.settlement!;
      const w = buildWorld(L, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
      const arch = w.marketArch!.crevice!, g = L.levels[0].grid;
      const inPit = (x: number, z: number) => st.pit.some(p => x >= p.x0 && x < p.x1 && z >= p.z0 && z < p.z1);
      let bed = 0, walks = 0;
      for (let i = 0; i < g.cells.length; i++) {
        const [x, z] = g.center(i % g.w, (i / g.w) | 0);
        expect(arch.inChasm(x, z), `cell ${i}`).toBe(inPit(x, z));
        if (g.cells[i] === VOID && inPit(x, z)) { expect(arch.voidFloorKey(0, i)).toBe(CREVICE_KEYS.chasm); bed++; }
        if (g.cells[i] === FLOOR && !inPit(x, z) && arch.inChasm(x, z) === false && L.areas[g.area[i]]?.label === 'Low walk') walks++;
      }
      expect(bed).toBeGreaterThan(400);
      expect(walks).toBeGreaterThan(400);
      expect(w.culler.atriumTileCount).toBeGreaterThan(60);
      expect(w.culler.atriumTileCount).toBeLessThan(300);
    }
  });
});
