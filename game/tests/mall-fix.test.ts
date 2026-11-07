// Task mall-playtest-revision-20261031 (lane FIX): focused tests for the mall playtest fixes U03 / U04 / U06 (U08: anisotropy.test.ts).
//  - U04 "hitboxes missing on the round pillars": the atrium columns are layout props (gen/mall/columns.ts, kind atriumColumn,
//    round: true) — exact circular contact (no invisible square corners), exact cylinder bullet hits, nav blocked cells on their
//    own storey only, tops at a real ceiling, storey separation — on the synthetic station + 3 floor fixture (nested openings).
//  - U03 "station platform has iron pillars going to no ceiling": station columns / hung plates need a real ceiling at their top
//    (gen/stationDress.ts ceilingAtTop); every column prop of a generated mall ends at a drawn ceiling.
//  - U06 "vault asset has flickering on the door / messed up triangles": the gun safe derivative has ONE layer per plane (no
//    coplanar duplicate triangles), its openable spec has an inner plate and a hinge on the knuckle axis.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {CELL, FLOOR, Grid, PathFinder} from '../src/gen/grid';
import {levelsOf, rayCylinder} from '../src/gen/levels';
import {PropIndex, moveCircle, pushOutOfCircle} from '../src/core/physics';
import {ATRIUM_COLUMN, insidePoly, placeAtriumColumns, slabOpenings} from '../src/gen/mall/columns';
import {ceilingAtTop, hungRoofed} from '../src/gen/stationDress';
import {Rng} from '../src/core/rng';
import {mallFixture} from './helpers/mallFixture';
import type {PropPlacement} from '../src/gen/props';
import {OPENABLE_SPECS} from '../src/world/openablesSpec';

const REPO = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------------------------------------------------------
// U04

function fixtureWithColumns() {
  const F = mallFixture({lights: false});
  const blockedBefore = F.levels.map(l => Uint8Array.from(l.grid.blocked));
  const rep = placeAtriumColumns(F.layout, new Rng(7));
  const cols = F.layout.props.filter(p => p.kind === 'atriumColumn');
  return {F, rep, cols, blockedBefore};
}
const FX = fixtureWithColumns();

describe('U04 round atrium columns: generation-time records', () => {
  it('places round column records under every slab edge of the nested openings (storeys 0..2), tops at the real ceiling', () => {
    const {F, rep, cols} = FX;
    expect(cols.length).toBe(rep.placed.length);
    expect(cols.length).toBeGreaterThanOrEqual(6);
    const byLevel = new Map<number, number>();
    for (const p of rep.placed) byLevel.set(p.level, (byLevel.get(p.level) ?? 0) + 1);
    expect([...byLevel.keys()].sort()).toEqual([0, 1, 2]); // station under floor 1, floor 1 under floor 2, floor 2 under floor 3
    const ops = slabOpenings(F.layout);
    for (const [i, p] of cols.entries()) {
      const r = rep.placed[i], lv = p.level ?? 0, g = F.levels[lv].grid;
      expect(p.round).toBe(true);
      expect(p.hx).toBe(ATRIUM_COLUMN.r);
      expect(p.hz).toBe(ATRIUM_COLUMN.r);
      expect(lv).toBe(r.under - 1);
      expect(p.y).toBeCloseTo(F.levels[lv].baseY, 6); // stands on its storey floor
      // ends at the ceiling over its footprint: a real, closed ceiling (never the roof apex / open air)
      expect(p.y + p.h).toBeCloseTo(r.top, 6);
      expect(ceilingAtTop(g, p.x, p.z, p.hx, p.hz, p.y + p.h)).toBe(true);
      expect(p.y + p.h).toBeLessThan(F.layout.mall.roof.springY - 0.5);
      const [cx, cy] = g.cellOf(p.x, p.z);
      expect(g.ceil[g.idx(cx, cy)]).toBeCloseTo(p.y + p.h, 2);
      // under the slab of the floor above: outside that floor's opening
      const op = ops.find(o => o.level === r.under)!;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) expect(insidePoly(op.outline, p.x + dx * p.hx, p.z + dz * p.hz)).toBe(false);
      // centred on a cell corner: the 0.68 m column blocks exactly 2 x 2 cells
      expect(p.x / CELL).toBeCloseTo(Math.round(p.x / CELL), 6);
      expect(p.z / CELL).toBeCloseTo(Math.round(p.z / CELL), 6);
    }
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      if ((cols[i].level ?? 0) === (cols[j].level ?? 0)) expect(Math.hypot(cols[i].x - cols[j].x, cols[i].z - cols[j].z)).toBeGreaterThanOrEqual(ATRIUM_COLUMN.gap - 1e-6);
    }
  });

  it('marks blocked + sightBlocked exactly on its 2 x 2 footprint cells, on its OWN storey grid only', () => {
    const {F, cols, blockedBefore} = FX;
    for (const p of cols) {
      const lv = p.level ?? 0;
      const x0 = Math.floor((p.x - p.hx) / CELL), x1 = Math.floor((p.x + p.hx) / CELL), y0 = Math.floor((p.z - p.hz) / CELL), y1 = Math.floor((p.z + p.hz) / CELL);
      expect(x1 - x0 + 1).toBe(2);
      expect(y1 - y0 + 1).toBe(2);
      for (const [L, lev] of F.levels.entries()) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const i = lev.grid.idx(cx, cy);
        const mine = L === lv;
        if (mine) { expect(lev.grid.blocked[i]).toBe(1); expect(lev.grid.sightBlocked[i]).toBe(1); }
        else if (!cols.some(q => (q.level ?? 0) === L && Math.abs(q.x - p.x) < 0.7 && Math.abs(q.z - p.z) < 0.7)) expect(lev.grid.blocked[i]).toBe(blockedBefore[L][i]);
      }
    }
    // the walkable ring stays walkable around every column (no pinch / disconnection)
    for (const p of cols) {
      const g = F.levels[p.level ?? 0].grid;
      for (const [dx, dz] of [[-1.0, 0], [1.0, 0], [0, -1.0], [0, 1.0]]) { const [cx, cy] = g.cellOf(p.x + dx, p.z + dz); expect(g.walkable(cx, cy)).toBe(true); }
    }
  });

  it('player / zombie contact is the visible circle: no walk-through centre, no invisible square corner (exact at 8 headings)', () => {
    const {F, cols} = FX;
    const L = levelsOf(F.layout);
    const idx = new PropIndex(L, F.layout.props);
    const r = 0.3; // player radius (zombies 0.34: same rule)
    for (const p of cols) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, dx = Math.cos(a), dz = Math.sin(a);
        // walk from 2 m out straight at the centre
        let x = p.x + dx * 2, z = p.z + dz * 2;
        for (let s = 0; s < 120; s++) [x, z] = moveCircle(L, idx, x, z, -dx * 0.03, -dz * 0.03, r, p.y, 1.8);
        const d = Math.hypot(x - p.x, z - p.z);
        expect(d, `column (${p.x}, ${p.z}) heading ${k * 45} deg`).toBeGreaterThanOrEqual(r + p.hx - 1e-3);
        // diagonal headings: a square collider would stop at 0.34 * sqrt(2) + 0.3 = 0.78 m; the round one at 0.64 m
        expect(d).toBeLessThan(r + p.hx + 0.02);
      }
    }
  });

  it('collision keeps storeys apart: a body on the floor above walks over a column top of the storey below', () => {
    const {F, cols} = FX;
    const L = levelsOf(F.layout), idx = new PropIndex(L, F.layout.props);
    const p = cols.find(q => (q.level ?? 0) === 0)!;
    const feetAbove = F.levels[1].baseY; // above the column's top (station ceiling under the floor-1 slab)
    expect(p.y + p.h).toBeLessThan(feetAbove);
    const out = moveCircle(L, idx, p.x + 0.05, p.z, 0.01, 0, 0.3, feetAbove, 1.8);
    // no push from the column (the floor-1 grid's own cells may still block: compare against a props-free move)
    const bare = moveCircle(L, new PropIndex(L, []), p.x + 0.05, p.z, 0.01, 0, 0.3, feetAbove, 1.8);
    expect(out[0]).toBeCloseTo(bare[0], 6);
    expect(out[1]).toBeCloseTo(bare[1], 6);
  });

  it('bullets / melee / flashlight rays hit the exact cylinder, never pass the centre, never hit outside the round face', () => {
    const {F, cols} = FX;
    const L = levelsOf(F.layout);
    for (const p of cols) {
      const yMid = p.y + Math.min(1.4, p.h / 2);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + 0.1, dx = Math.cos(a), dz = Math.sin(a);
        // from 1.0 m out: inside the column's guaranteed walkable ring (+-1.5 m square), so no wall stands between
        const o = {x: p.x - dx * 1.0, y: yMid, z: p.z - dz * 1.0};
        const h = L.raycast(o, {x: dx, y: 0, z: dz}, 10, {props: F.layout.props});
        expect(h.kind, `centre ray ${k}`).toBe('prop');
        expect(F.layout.props[h.prop!]).toBe(p);
        expect(h.t).toBeCloseTo(1.0 - p.hx, 3);
        // grazing rays: 0.30 m off-axis hits, 0.40 m off-axis misses — even on the diagonal, where a square box would still hit
        const ox = -dz, oz = dx;
        const hit = L.raycast({x: o.x + ox * 0.3, y: yMid, z: o.z + oz * 0.3}, {x: dx, y: 0, z: dz}, 10, {props: F.layout.props});
        expect(hit.kind === 'prop' && F.layout.props[hit.prop!] === p).toBe(true);
        const miss = L.raycast({x: o.x + ox * 0.4, y: yMid, z: o.z + oz * 0.4}, {x: dx, y: 0, z: dz}, 10, {props: F.layout.props});
        expect(miss.kind === 'prop' && F.layout.props[miss.prop!] === p).toBe(false);
      }
      // a ray above the column's top (on the floor above) never hits it
      if ((p.level ?? 0) === 0) {
        const above = L.raycast({x: p.x - 3, y: F.levels[1].baseY + 1.4, z: p.z}, {x: 1, y: 0, z: 0}, 10, {props: F.layout.props});
        expect(above.kind === 'prop' && F.layout.props[above.prop!] === p).toBe(false);
      }
    }
  });

  it('enemy navigation routes around a column (blocked cells, path radius 0.34) and a straight walk line through it is refused', () => {
    const {F, cols} = FX;
    const L = levelsOf(F.layout);
    const pf = new PathFinder(L);
    let checked = 0;
    for (const p of cols) {
      const lv = p.level ?? 0, g = F.levels[lv].grid;
      // a pair of points 1.6 m either side of the column along x (both walkable)
      const a = {x: p.x - 1.6, z: p.z}, b = {x: p.x + 1.6, z: p.z};
      const ca = g.cellOf(a.x, a.z), cb = g.cellOf(b.x, b.z);
      if (!g.walkable(ca[0], ca[1]) || !g.walkable(cb[0], cb[1])) continue;
      expect(L.walkLineClear(a.x, p.y + 0.05, a.z, b.x, b.z, 0.34, p.y + 0.05)).toBe(false);
      const path = pf.find(a.x, a.z, b.x, b.z, 0.34, 26000, {ay: p.y + 0.05, by: p.y + 0.05});
      expect(path, `path around (${p.x}, ${p.z})`).toBeTruthy();
      // every leg of the (string-pulled) path keeps a walker's body clear of the visible column
      const pts = [[a.x, a.z], ...path!.map(w => [w[0], w[1]]), [b.x, b.z]];
      let minD = Infinity;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.z - z0) * dz) / l2)) : 0;
        minD = Math.min(minD, Math.hypot(p.x - (x0 + dx * t), p.z - (z0 + dz * t)));
      }
      expect(minD, `path leg through column (${p.x}, ${p.z})`).toBeGreaterThanOrEqual(p.hx + 0.3);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('pure helpers: circle push-out and ray-cylinder (side, caps, inside origin, parallel misses)', () => {
    expect(pushOutOfCircle(2, 0, 0.3, 0, 0, 0.34)).toBeNull();
    const p = pushOutOfCircle(0.5, 0, 0.3, 0, 0, 0.34)!;
    expect(0.5 + p[0]).toBeCloseTo(0.64, 9);
    expect(p[1]).toBe(0);
    const c = (o: [number, number, number], d: [number, number, number]) => rayCylinder({x: o[0], y: o[1], z: o[2]}, {x: d[0], y: d[1], z: d[2]}, 0, 0, 0.34, 0, 4);
    expect(c([-2, 1, 0], [1, 0, 0])).toMatchObject({t: expect.closeTo(1.66, 9), n: [-1, 0, 0]});
    expect(c([0, 6, 0], [0, -1, 0])).toMatchObject({t: expect.closeTo(2, 9), n: [0, 1, 0]}); // top cap
    expect(c([0, -1, 0.1], [0, 1, 0])).toMatchObject({t: expect.closeTo(1, 9), n: [0, -1, 0]}); // bottom cap
    expect(c([0, 1, 0], [1, 0, 0])!.t).toBe(0); // inside
    expect(c([-2, 1, 0.35], [1, 0, 0])).toBeNull(); // passes beside
    expect(c([-2, 4.5, 0], [1, 0, 0])).toBeNull(); // passes above
    expect(c([0.5, -1, 0], [0, 1, 0])).toBeNull(); // vertical, outside
  });

  it('only gen/mall/columns.ts and the Reactor\'s round machines (core vessel, waste casks / drums) set `round` (Subway / Office props keep their box collision)', () => {
    const src = path.join(REPO, 'game/src');
    const hits: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) walk(q); else if (/\.ts$/.test(f) && fs.readFileSync(q, 'utf8').split('\n').some(l => !/^\s*(\/\/|\*)/.test(l) && /\.round = true|round: true/.test(l))) hits.push(path.relative(src, q)); } }; // code lines only (doc comments may name the flag)
    walk(src);
    // task reactor-expansion-20261101: the Reactor's core vessel (coreFloor.ts) and waste repository casks (wasteDress.ts) are cylinders
    // task train-fuel-system-20261106-024923: world/fuelCarts.ts gives fuel carts riding as CARGO a round footprint in the riding car's own
    // train-local collision model only (never a level prop: Subway / Office station props are untouched)
    // task studio-skyways-level-20261106-054448 (lane ADDON): the Skyways add-on's cylinders — the mascot statues' round plinths
    // (addonConvention.ts, on the stage deck; addonFrame.ts putRound, on the floor) and the prize ring's round-based stanchions
    // (addonFrame.ts putRound) — Skyways-only kinds; Subway / Office station props still keep their box collision
    // task studio-skyways-destinations-20261106-170011-01 (lane LANDMARKS): the Skyways landmark heroes' cylinders — the fig tree's ring
    // bench / planter / trunk, the fountain's basin / column, the orrery's sphere (gen/skyways/destinations/landmarks.ts) — Skyways-only
    // (same task, lanes SHOPS-A / SHOPS-B): the anchor shops' round tables and stanchions — the bookshop's tiered tables and café bistro
    // tables (shopsA.ts lattice / skywaysShopsAKit.ts putRound), the arcade's prize-ring stanchions (skywaysShopsBKit.ts putRound) —
    // placed inside Skyways anchors only
    // (task studio-skyways-rework-20261107-054512-01) + their frozen GAME77 copies (gen/skyways/legacy77/: the generator of the Skyways
    // stations entered before the rework) — Skyways-only, the same placements
    expect(hits.sort()).toEqual(['gen/mall/columns.ts', 'gen/reactor/complex/wasteDress.ts', 'gen/reactor/coreFloor.ts', 'gen/skyways/addonConvention.ts',
      'gen/skyways/addonFrame.ts', 'gen/skyways/destinations/landmarks.ts', 'gen/skyways/destinations/shopsA.ts',
      'gen/skyways/destinations/skywaysShopsAKit.ts', 'gen/skyways/destinations/skywaysShopsBKit.ts',
      'gen/skyways/legacy77/addonConvention.ts', 'gen/skyways/legacy77/addonFrame.ts', 'gen/skyways/legacy77/destinations/landmarks.ts',
      'gen/skyways/legacy77/destinations/shopsA.ts', 'gen/skyways/legacy77/destinations/skywaysShopsAKit.ts',
      'gen/skyways/legacy77/destinations/skywaysShopsBKit.ts',
      // (task studio-alpha-skyways-shops-20261107-054512-01) the major stores' round furniture (layout v3, Skyways anchors only): the bookshop's
      // and the outfitter's round tiered tables (books / lanterns), the cinema's queue stanchions and round pieces (cinemaKit putRound)
      'gen/skyways/stores/booksDress.ts', 'gen/skyways/stores/cinemaDress.ts', 'gen/skyways/stores/cinemaKit.ts', 'gen/skyways/stores/outfitterDress.ts',
      'world/fuelCarts.ts']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// U03

describe('U03 station columns end at a real ceiling', () => {
  it('ceilingAtTop: a raised (open-air / bridge) cell ceiling over the footprint refuses; the area ceiling and unset test grids pass', () => {
    const g = new Grid(10, 10);
    for (let i = 0; i < g.cells.length; i++) { g.cells[i] = FLOOR; g.floor[i] = 0; g.ceil[i] = 4.4; }
    expect(ceilingAtTop(g, 2.5, 2.5, 0.25, 0.25, 4.4)).toBe(true);
    g.ceil[g.idx(5, 4)] = 40; // under the atrium: the carve raises the cell ceiling to the roof apex
    expect(ceilingAtTop(g, 2.5, 2.25, 0.25, 0.25, 4.4)).toBe(false); // footprint cells (4..5, 4)
    expect(ceilingAtTop(g, 1.25, 1.25, 0.25, 0.25, 4.4)).toBe(true);
    g.ceil[g.idx(1, 1)] = 9.65; // under a bridge deck
    expect(ceilingAtTop(g, 0.75, 0.75, 0.25, 0.25, 4.4)).toBe(false);
    const bare = new Grid(4, 4); // hand-built grid without ceilings: no information -> unchanged behaviour
    expect(ceilingAtTop(bare, 1, 1, 0.25, 0.25, 4.4)).toBe(true);
  });
});

/**
 * U03 + U04 on a GENERATED mall: every station `column` and every round `atriumColumn` ends at a drawn ceiling; no hung plate
 * under open air.
 */
export function columnEndpointIssues(layout: {props: PropPlacement[]; levels?: {grid: Grid}[]; grid: Grid; mall?: {roof: {springY: number}}; signs: {x: number; z: number; y: number; hang?: boolean; area: number; level?: number}[]; areas: {ceil: number}[]}): string[] {
  const out: string[] = [];
  const gridOf = (lv: number) => layout.levels?.[lv]?.grid ?? layout.grid;
  const spring = layout.mall?.roof.springY ?? Infinity;
  for (const p of layout.props) {
    if (p.kind !== 'column' && p.kind !== 'atriumColumn') continue;
    const g = gridOf(p.level ?? 0), top = p.y + p.h;
    const x0 = Math.floor((p.x - p.hx + 0.04) / CELL), x1 = Math.floor((p.x + p.hx - 0.04) / CELL), y0 = Math.floor((p.z - p.hz + 0.04) / CELL), y1 = Math.floor((p.z + p.hz - 0.04) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = g.ceil[g.idx(cx, cy)];
      if (c > top + 0.05 || c >= spring - 0.5) out.push(`${p.kind} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) L${p.level ?? 0} top ${top.toFixed(2)} under ceiling ${c.toFixed(2)}`);
    }
  }
  for (const s of layout.signs) if (s.hang && !hungRoofed(gridOf(s.level ?? 0), s.x, s.z, (s as {rot?: number}).rot ?? 0, (s as {w?: number}).w ?? 1.2, layout.areas[s.area].ceil)) out.push(`hung sign '${(s as {text?: string}).text ?? ''}' (${(s as {kind?: string}).kind ?? ''}) at (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) L${s.level ?? 0} y ${s.y} area ${s.area} ceil ${layout.areas[s.area].ceil} under open air`);
  return out;
}

describe('U03 / U04 on the generated mall (layout-agnostic endpoint check)', () => {
  // (lane GEN rewrites the generator in parallel: this one test needs a generator that builds; the fixture tests above carry U04)
  it('no station column, atrium column or hung plate ends in open air', async () => {
    const {generateMallLevel} = await import('../src/gen/mall/index');
    const L = generateMallLevel({levelSeed: 0x7ea3c1, startWeapon: 'rifle'}) as unknown as Parameters<typeof columnEndpointIssues>[0];
    expect(columnEndpointIssues(L)).toEqual([]);
    // every round atrium column record is a round prop on its own storey (gen/mall/columns.ts wired into the generator)
    const cols = L.props.filter(q => q.kind === 'atriumColumn');
    expect(cols.length).toBeGreaterThan(0);
    for (const p of cols) { expect(p.round).toBe(true); expect(p.hx).toBe(ATRIUM_COLUMN.r); }
    // the real collision / bullet paths on the generated level: walk into and shoot three columns
    const lv = levelsOf(L as never), idx = new PropIndex(lv, L.props);
    for (const p of cols.slice(0, 3)) {
      let x = p.x + 1.0, z = p.z;
      for (let s = 0; s < 60; s++) [x, z] = moveCircle(lv, idx, x, z, -0.03, 0, 0.3, p.y, 1.8);
      expect(Math.hypot(x - p.x, z - p.z)).toBeGreaterThanOrEqual(0.3 + p.hx - 1e-3);
      const h = lv.raycast({x: p.x + 1.0, y: p.y + 1.4, z: p.z}, {x: -1, y: 0, z: 0}, 5, {props: L.props});
      expect(h.kind).toBe('prop');
      expect(L.props[h.prop!]).toBe(p);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// U06

/** Coplanar same-plane overlap area (m2) between triangles of a GLB inside a box, read with the repo's gltf-transform. */
async function coplanarOverlap(file: string, box: {min: number[]; max: number[]}): Promise<{sameFacing: number; opposite: number; tris: number}> {
  const {NodeIO} = await import('@gltf-transform/core');
  const doc = await new NodeIO().read(file);
  const T: {P: number[][]; z: number; dir: number}[] = [];
  for (const m of doc.getRoot().listMeshes()) for (const pr of m.listPrimitives()) {
    const pos = pr.getAttribute('POSITION')!, idx = pr.getIndices()!;
    for (let t = 0; t < idx.getCount(); t += 3) {
      const v = [0, 1, 2].map(k => pos.getElement(idx.getScalar(t + k), [0, 0, 0]));
      if (!v.every(p => p.every((x, k) => x >= box.min[k] && x <= box.max[k]))) continue;
      if (Math.max(...v.map(p => p[2])) - Math.min(...v.map(p => p[2])) > 0.001) continue;
      const a = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      if (Math.abs(a) < 1e-9) continue;
      T.push({P: v.map(p => [p[0], p[1]]), z: v[0][2], dir: Math.sign(a)});
    }
  }
  // overlap by sampling a 2 mm grid over the box (exact enough for a regression: any duplicate layer is cm-scale)
  let same = 0, opp = 0;
  const inside = (P: number[][], x: number, y: number) => { let s = 0; for (let i = 0; i < 3; i++) { const a = P[i], b = P[(i + 1) % 3]; const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (Math.abs(c) < 1e-12) continue; const sg = Math.sign(c); if (s && sg !== s) return false; s = sg; } return true; };
  const step = 0.002;
  for (let x = box.min[0] + step / 2; x < box.max[0]; x += step) for (let y = box.min[1] + step / 2; y < box.max[1]; y += step) {
    const all = T.filter(t => inside(t.P, x, y));
    if (all.length < 2) continue;
    // per plane (same z within 0.5 mm): 2+ same-facing = duplicate layer, front + back = opposite-facing duplicate
    let s2 = false, o2 = false;
    for (const t0 of all) {
      const h = all.filter(t => Math.abs(t.z - t0.z) < 5e-4);
      const f = h.filter(t => t.dir === h[0].dir).length, o = h.length - f;
      if (Math.max(f, o) >= 2) s2 = true; else if (f && o) o2 = true;
    }
    if (s2) same += step * step; else if (o2) opp += step * step;
  }
  return {sameFacing: same, opposite: opp, tris: T.length};
}

describe('U06 gun safe (M35) door: no coplanar duplicate layers; the openable has an inner plate and a hinge on its knuckles', () => {
  const GLB = path.join(REPO, 'game/public/assets/models/mall-gun-safe-tall.glb');
  it('the door plane carries exactly one layer (was ~0.75 m2 of 2-3 stacked layers): no same-plane overlap, no opposite-facing duplicate', async () => {
    const door = await coplanarOverlap(GLB, {min: [-0.31, 0.12, -0.245], max: [0.31, 1.68, -0.225]});
    expect(door.tris).toBeGreaterThan(20);
    expect(door.sameFacing).toBeLessThan(2e-4); // < 2 cm2 of numerical edge samples
    expect(door.opposite).toBeLessThan(2e-4);
    const back = await coplanarOverlap(GLB, {min: [-0.42, -0.01, 0.29], max: [0.42, 1.81, 0.31]});
    expect(back.sameFacing + back.opposite).toBeLessThan(2e-4);
  }, 30_000);

  it('provenance records the local repair (raw source unchanged, edits.coplanarDedupe), dims unchanged', () => {
    const prov = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/mall-track3-20261031.json'), 'utf8'));
    const o = prov.outputs.find((q: {id: string}) => q.id === 'gun-safe-tall');
    expect(o.edits.coplanarDedupe.length).toBe(2);
    expect(o.edits.coplanarDedupe[0].overlapRemovedM2).toBeGreaterThan(0.5);
    expect(o.output.dims).toEqual([0.8225, 1.8, 0.5998]);
    const buf = fs.readFileSync(GLB);
    expect(o.output.bytes).toBe(buf.length);
    const allow = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8'));
    const e = allow.files.find((f: {path: string}) => f.path === 'assets/models/mall-gun-safe-tall.glb');
    expect(e.bytes).toBe(buf.length);
    expect(e.sha256).toBe(o.output.sha256);
  });

  it('openable spec: one derived door whose region holds the whole hinge knuckles, pivot on the knuckle axis, an inner plate inside the leaf', () => {
    const s = OPENABLE_SPECS.gunSafeTall;
    expect(s.parts.length).toBe(1);
    const part = s.parts[0];
    expect(part.move.type).toBe('hinge');
    // knuckles (prop frame): x 0.256..0.305, z 0.223..0.277, y 0.213..0.412 and 1.374..1.565 -> axis (0.2805, 0.250)
    const pv = (part.move as {pivot: readonly number[]}).pivot;
    expect(pv[0]).toBeCloseTo(0.2805, 3);
    expect(pv[2]).toBeCloseTo(0.25, 3);
    const inRegion = (x: number, y: number, z: number) => part.region!.some(b => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5]);
    for (const [y0, y1] of [[0.213, 0.412], [1.374, 1.565]]) for (const y of [y0 + 0.01, (y0 + y1) / 2, y1 - 0.01]) for (const [x, z] of [[0.3, 0.25], [0.2805, 0.27], [0.262, 0.25]]) expect(inRegion(x, y, z), `knuckle point ${x},${y},${z}`).toBe(true);
    // the bezel / frame beside the door (x > 0.29 in the frame plane z 0.242, between the knuckles) stays on the body
    expect(inRegion(0.3, 0.9, 0.242)).toBe(false);
    const pl = part.plate!;
    expect(pl).toBeTruthy();
    const b = part.region![0];
    expect(pl[0]).toBeGreaterThanOrEqual(b[0]); expect(pl[3]).toBeLessThanOrEqual(b[3]);
    expect(pl[1]).toBeGreaterThanOrEqual(b[1]); expect(pl[4]).toBeLessThanOrEqual(b[4]);
    expect(pl[2]).toBeGreaterThanOrEqual(b[2]); expect(pl[5]).toBeLessThan(0.2354); // behind the door face
  });
});
