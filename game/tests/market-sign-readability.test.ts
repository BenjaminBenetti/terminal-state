// Task studio-market-readable-shop-signs-20261118-022405-01: "Signs on shops are covered by other objects often so the player cannot read
// the signs!" — THE SURVIVOR MARKET's shop signs readable from its walkways, a recorded market's layout kept:
//  - the walkway views: for every board / blade / notice (kind 'info') of a sample of markets, versions 3-7, from each walkable floor
//    cell 1.5-9 m in front of its face (within 65 degrees of it, eye 1.6 m, a clear line to the plate through the sign's own storey), the
//    share of views that lose >= a quarter of the lettering to the market's decor (props, other signs and their rods, lamp fixtures:
//    gen/doorways.ts decorVolumes) stays under a quarter. On origin/main 1e08fa41 a crevice wall lamp (gen/market/v5/dress.ts, 0.75 m
//    out at 2.2-2.4 m) stood through the blade at a shop door's end or in front of a board, the bar's name board hung behind its backbar
//    lamps (and version 3 / 4's behind the counter's pendants): such signs lost a quarter of their lettering from EVERY view;
//  - existing markets: a recorded version 3-7 regenerates everything but where some lamps and signs hang byte for byte as origin/main
//    1e08fa41's generator did (digests computed on it and on this branch: identical) — the grids, areas, doors, props, the market record
//    (stalls, stock, people, cargo), pickups, zombies, the generation attempt, and the same lamps and signs in the same order, their text,
//    kind, height, rotation, colour and state (a lamp's x / z and canopy area and a sign's x / y / z may move).

import {describe, expect, it} from 'vitest';
import crypto from 'node:crypto';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {decorVolumes, signDims} from '../src/gen/doorways';
import {generateMarketLevel} from '../src/gen/market/index';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';

/** The walkway check's limits: a view is bad when >= HIDDEN of the lettering samples are behind decor; a sign fails at SHARE bad views. */
const HIDDEN = 0.25, SHARE = 0.25;

function hits(ax: number, ay: number, az: number, bx: number, by: number, bz: number, b: {x0: number; x1: number; y0: number; y1: number; z0: number; z1: number}): boolean {
  let t0 = 0, t1 = 1;
  const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az], lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
    let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Per info sign: walkway views and the bad ones (see the header). */
function walkwayViews(L: StationLayout): {text: string; level: number; views: number; bad: number}[] {
  const vols = decorVolumes(L);
  const out: {text: string; level: number; views: number; bad: number}[] = [];
  L.signs.forEach((s, i) => {
    if (s.kind !== 'info') return;
    const lv = s.level ?? 0, g = L.levels[lv].grid, {w, h} = signDims(s);
    const nx = Math.sin(s.rot), nz = Math.cos(s.rot), ux = Math.cos(s.rot), uz = -Math.sin(s.rot), front = s.hang ? 0.03 : 0.09;
    const pts: [number, number, number][] = [];
    for (let fu = -0.4; fu < 0.45; fu += 0.1) for (const fv of [-0.25, 0, 0.25]) pts.push([s.x + ux * fu * w + nx * front, s.y + fv * h, s.z + uz * fu * w + nz * front]);
    // (the sign itself, its back-to-back twin and their rods are not in the way)
    const own = new Set([i]);
    L.signs.forEach((q, j) => { if (q.text === s.text && Math.hypot(q.x - s.x, q.z - s.z) < 0.06 && Math.abs(q.y - s.y) < 0.01) own.add(j); });
    const near = vols.filter(v => !((v.source === 'sign' || v.source === 'signRod') && own.has(Number(v.ref.split('#').pop())))
      && Math.max(v.x0 - s.x, s.x - v.x1, v.z0 - s.z, s.z - v.z1) < 10);
    const [scx, scy] = g.cellOf(s.x, s.z);
    let views = 0, bad = 0;
    for (let cy = scy - 20; cy <= scy + 20; cy++) for (let cx = scx - 20; cx <= scx + 20; cx++) {
      if (!g.inBounds(cx, cy)) continue;
      const ci = g.idx(cx, cy);
      if (g.cells[ci] !== FLOOR || g.rampIdx[ci] >= 0 || g.blocked[ci]) continue;
      const ex = (cx + 0.5) * CELL, ez = (cy + 0.5) * CELL, ey = g.floorOf(ci) + 1.6;
      const dx = ex - s.x, dz = ez - s.z, dist = Math.hypot(dx, dz), along = dx * nx + dz * nz;
      if (dist < 1.5 || dist > 9 || along < 0.3 || along / dist < Math.cos(65 * Math.PI / 180)) continue;
      const P = [s.x + nx * front, s.y, s.z + nz * front], n = Math.ceil(Math.hypot(P[0] - ex, P[1] - ey, P[2] - ez) / 0.1);
      let walled = false;
      for (let k = 1; k < n - 1 && !walled; k++) {
        const t = k / n, x = ex + (P[0] - ex) * t, y = ey + (P[1] - ey) * t, z = ez + (P[2] - ez) * t, [qx, qy] = g.cellOf(x, z);
        walled = !g.inBounds(qx, qy) || g.cells[g.idx(qx, qy)] === SOLID || y > g.ceilAt(x, z) - 0.02;
      }
      if (walled) continue;
      views++;
      const hidden = pts.filter(p => near.some(b => hits(ex, ey, ez, p[0], p[1], p[2], b))).length;
      if (hidden >= HIDDEN * pts.length) bad++;
    }
    out.push({text: s.text, level: lv, views, bad});
  });
  return out;
}

/** Everything of a market but where its lamps and signs hang. */
function kept(l: StationLayout): string {
  const g = l.levels.map(L => crypto.createHash('sha256').update(Buffer.from(L.grid.cells)).update(Buffer.from(L.grid.area.buffer)).update(Buffer.from(L.grid.floor.buffer)).update(Buffer.from(L.grid.ceil.buffer)).update(Buffer.from(L.grid.blocked)).update(Buffer.from(L.grid.sightBlocked)).digest('hex'));
  const s = JSON.stringify({g, areas: l.areas, doors: l.doors, props: l.props, market: l.market, rails: l.rails, links: l.levelLinks, spawn: l.playerSpawn,
    lad: l.traversal.ladders, st: l.traversal.stairs, name: l.name, pickups: l.pickups, zombies: l.zombies, attempt: l.attempt,
    lights: l.lights.map(({x, z, area, ...q}) => q), signs: l.signs.map(({x, y, z, ...q}) => q)});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** kept() of origin/main 1e08fa41's generator (computed on it side by side with this branch: identical). */
const KEPT_SHIPPED: Record<number, Record<number, string>> = {
  3: {1: '8024a486f7b8dd34', 2: 'dd12280dd122b9ea', 42: 'b08fe79bb2377085'},
  4: {1: '289ade461b874313', 2: 'c19d87ab8e065da6', 42: 'cd945042b117e5a5'},
  5: {1: 'e318e227eef2fab9', 2: 'ae831d53fbd32a2f', 42: 'a791faa9599efe76'},
  6: {1: '7850f21adf0e20c5', 2: 'cc657fc1faa60d9c', 42: '24752cafadbf1b27'},
  7: {1: '650a43c2191faa3b', 2: 'a7c6e4ba768be87f', 42: '7a6b0db6af111182'},
};

/** The walkway sample: [version, seeds]. */
const WALKWAY: [number, number[]][] = [[7, [1, 2, 3, 42]], [6, [1, 42]], [5, [1, 2]], [4, [2]], [3, [2, 42]]];

describe('Survivor Market signs readable from the walkways', () => {
  for (const [v, seeds] of WALKWAY) {
    it(`version ${v}: no board, blade or notice loses a quarter of its lettering to decor from a quarter of its walkway views`, () => {
      for (const seed of seeds) {
        const L = generateMarketLevel({levelSeed: seed, layoutVersion: v});
        const res = walkwayViews(L);
        expect(res.length, `seed ${seed}`).toBeGreaterThan(10);
        expect(res.reduce((n, r) => n + r.views, 0), `seed ${seed}: walkway views`).toBeGreaterThan(50 * res.length);
        for (const r of res) {
          if (r.views) expect(r.bad / r.views, `seed ${seed} "${r.text}" (storey ${r.level}): ${r.bad} of ${r.views} views lose >= a quarter`).toBeLessThan(SHARE);
        }
      }
    });
  }

  it('a recorded version 3-7 market regenerates as before but for where some lamps and signs hang', () => {
    for (const [v, pins] of Object.entries(KEPT_SHIPPED)) {
      for (const [s, want] of Object.entries(pins)) {
        expect(kept(generateMarketLevel({levelSeed: Number(s), layoutVersion: Number(v)})), `version ${v} seed ${s}`).toBe(want);
      }
    }
    expect(kept(LEVELS.market.generate('main', {levelSeed: 42, layoutVersion: 7}))).toBe(KEPT_SHIPPED[7][42]);
  });
});
