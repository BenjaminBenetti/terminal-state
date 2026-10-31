// Task mall-playtest-revision-20261031 (lane SHOPS, U09; user: "lot of randomly placed vending machines in the middle of the main mall
// walking areas. vending machines should always have their back to a wall"). The station dresser's wall primitives (gen/placeKit.ts
// placeAgainstWall / rowAlongWall, gen/compose.ts wall clusters) took an area's bounding-rect side for a wall; a mall gallery / court /
// platform side is often open floor (the next gallery rect, a bridge, the plaza) or the atrium void. In a mall layout (a storey with
// the retail 'ring' role: PlaceCtx.strictWalls) a wall placement now needs a solid wall behind its whole width, and a vending machine
// keeps VENDING_CLEAR_AHEAD of open floor in front (approach + passing lane, reserved). Subway / Office output is unchanged.
// Layout-agnostic: a tiny synthetic gallery (open east side, void south side, a shopfront opening in its north wall) + one generated
// mall (cached) checked with the same geometry rules.

import {describe, expect, it} from 'vitest';
import {Rng} from '../src/core/rng';
import {CELL, FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import type {Level, LevelRole} from '../src/gen/levels';
import {PROP_DEFS} from '../src/gen/props';
import {VENDING_CLEAR_AHEAD, levelGrid, makePlaceCtx, placeAgainstWall, rowAlongWall, strictWalls} from '../src/gen/placeKit';
import type {Area, Door, StationLayout} from '../src/gen/stationTypes';
import {generateMallLevel} from '../src/gen/mall/index';

/** Geometry defects of every vending machine of a layout (empty = all good). */
function vendingDefects(layout: StationLayout, o: {lane?: (a: Area) => boolean} = {}): string[] {
  const def = PROP_DEFS.vending, out: string[] = [];
  const aps = new Map<number, Uint8Array>();
  const ap = (lv: number) => { let a = aps.get(lv); if (!a) aps.set(lv, (a = makePlaceCtx(layout, new Rng(1), lv).aperture)); return a; };
  const links = (layout as {levelLinks?: {lower: number; upper: number; bottom: {x: number; z: number}; top: {x: number; z: number}}[]}).levelLinks ?? [];
  for (const p of layout.props) {
    if (p.kind !== 'vending') continue;
    const lv = p.level ?? 0, g = levelGrid(layout, lv), a = layout.areas[p.area];
    const tag = `vending @${p.x.toFixed(2)},${p.z.toFixed(2)} L${lv} ${a?.label ?? p.area}`;
    const fx = Math.sin(p.rot), fz = Math.cos(p.rot), lx = Math.cos(p.rot), lz = -Math.sin(p.rot);
    const lat = [-def.w / 2 + 0.1, 0, def.w / 2 - 0.1];
    // 1. its back is a real wall: 0.2 m behind the back face, over its width, solid cells that are not an aperture (void / railing)
    for (const s of lat) {
      const [cx, cy] = g.cellOf(p.x - fx * (def.d / 2 + 0.2) + lx * s, p.z - fz * (def.d / 2 + 0.2) + lz * s);
      const i = g.inBounds(cx, cy) ? g.idx(cx, cy) : -1;
      if (i < 0 || g.cells[i] !== SOLID || ap(lv)[i]) { out.push(`${tag}: no wall behind (${i < 0 ? 'out' : g.cells[i] === FLOOR ? 'open floor' : g.cells[i] === VOID ? 'void' : 'aperture'})`); break; }
    }
    // 2. it faces open floor: walkable approach (>= 1 m) in front; in a walkway (`lane`) the passing lane too
    const need = o.lane?.(a) ? VENDING_CLEAR_AHEAD : 1.0;
    let ahead = Infinity;
    for (const s of lat) {
      let d = 0;
      for (; d < need; d += 0.25) { const [cx, cy] = g.cellOf(p.x + fx * (def.d / 2 + d + 0.125) + lx * s, p.z + fz * (def.d / 2 + d + 0.125) + lz * s); if (!g.walkable(cx, cy)) break; }
      ahead = Math.min(ahead, d);
    }
    if (ahead < need - 1e-6) out.push(`${tag}: only ${ahead} m open in front (needs ${need})`);
    // 3. never in a doorway / shopfront entry: footprint >= 1 m from every door opening of its storey
    for (const d of layout.doors) {
      if ((d.level ?? layout.areas[d.a]?.level ?? 0) !== lv) continue;
      const gx = Math.max(d.x * CELL - (p.x + p.hx), 0, (p.x - p.hx) - (d.x + d.w) * CELL), gz = Math.max(d.y * CELL - (p.z + p.hz), 0, (p.z - p.hz) - (d.y + d.h) * CELL);
      if (Math.hypot(gx, gz) < 1.0 - 1e-6) { out.push(`${tag}: ${Math.hypot(gx, gz).toFixed(2)} m from door ${d.id}`); break; }
    }
    // 4. never at a vertical-link mouth: >= 2.5 m from every stair / escalator / ladder stand point on its storey
    for (const k of links) for (const [L, q] of [[k.lower, k.bottom], [k.upper, k.top]] as const) {
      if (L === lv && Math.hypot(q.x - p.x, q.z - p.z) < 2.5) out.push(`${tag}: ${Math.hypot(q.x - p.x, q.z - p.z).toFixed(2)} m from link ${k.lower}-${k.upper}`);
    }
  }
  return out;
}

/**
 * Synthetic gallery storey: area A (x 2..21, z 6..15 cells = 10 x 5 m) continues east into area B (open floor behind A's east side),
 * a solid wall north (with a 2 m shopfront opening into a shop at x 8..11), the atrium void south (rows 16..17), a wall west.
 * `role` of storey 1 decides whether the layout is a mall ('ring') or not.
 */
function gallery(role: LevelRole): {layout: StationLayout; A: Area; B: Area} {
  const W = 48, H = 24, g0 = new Grid(W, H), g1 = new Grid(W, H);
  const areas: Area[] = [];
  const add = (x: number, y: number, w: number, h: number, type: Area['type'], label: string): Area => {
    const a = {id: areas.length, x, y, w, h, kind: 'concourse', type, label, ceil: 4, parent: -1, depth: 0, publicSpace: true, lighting: 'lit', level: 0} as Area;
    areas.push(a);
    for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) { const i = g0.idx(cx, cy); g0.cells[i] = FLOOR; g0.area[i] = a.id; g0.ceil[i] = 4; }
    return a;
  };
  const A = add(2, 6, 20, 10, 'retail-arcade', 'Gallery A'), B = add(22, 6, 24, 10, 'retail-arcade', 'Gallery B');
  const shop = add(6, 0, 8, 5, 'shop', 'Shop');
  for (let cx = 0; cx < W; cx++) for (const cy of [16, 17]) g0.cells[g0.idx(cx, cy)] = VOID;
  const door: Door = {id: 0, x: 8, y: 5, w: 4, h: 1, a: A.id, b: shop.id, height: 3, arch: false, shopfront: true};
  for (let cx = 8; cx < 12; cx++) { const i = g0.idx(cx, 5); g0.cells[i] = FLOOR; g0.area[i] = A.id; g0.ceil[i] = 3; }
  const levels: Level[] = [{id: 0, role: 'main', grid: g0, baseY: 0}, {id: 1, role, grid: g1, baseY: 5}];
  const layout = {seed: 1, attempt: 0, name: 'U09', grid: g0, areas, doors: [door], props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: [], decor: [],
    levels, levelLinks: [], traversal: {stairs: [], ladders: [], underpasses: []}, rails: []} as unknown as StationLayout;
  return {layout, A, B};
}

/** The old placement pattern a gallery dresser runs (random wall spots + rows on the open / void sides). */
function dressGallery(layout: StationLayout, A: Area, B: Area, seed: number): number {
  const ctx = makePlaceCtx(layout, new Rng(seed), 0);
  let n = 0;
  for (let i = 0; i < 6; i++) if (placeAgainstWall(ctx, A, 'vending', {front: 1.0})) n++;
  for (let i = 0; i < 4; i++) if (placeAgainstWall(ctx, B, 'vending', {sides: ['W', 'S', 'N'], front: 1.0})) n++;
  n += rowAlongWall(ctx, A, 'E', 'vending', {max: 2, front: 1.0}).length; // behind: B's open floor
  n += rowAlongWall(ctx, A, 'S', 'vending', {max: 2, front: 1.0}).length; // behind: the atrium void
  return n;
}

describe('U09: mall vending machines stand with their back to a real wall', () => {
  it('only a layout with a retail ring storey (the mall) is strict; the Subway / Office roles are not', () => {
    expect(strictWalls(gallery('ring').layout)).toBe(true);
    for (const r of ['upper', 'lower', 'office', 'roof', 'main'] as LevelRole[]) {
      const {layout} = gallery(r);
      expect(strictWalls(layout), r).toBe(false);
      expect(makePlaceCtx(layout, new Rng(1), 0).strictWalls, r).toBeUndefined();
    }
  });

  it('synthetic gallery: the old rule floats machines on open floor / the void edge; the mall rule backs every one against the wall', () => {
    let oldBad = 0, mallPlaced = 0;
    for (const seed of [1, 2, 3]) {
      const old = gallery('upper');
      dressGallery(old.layout, old.A, old.B, seed);
      oldBad += vendingDefects(old.layout).filter(s => s.includes('no wall behind')).length;
      const mall = gallery('ring');
      mallPlaced += dressGallery(mall.layout, mall.A, mall.B, seed);
      expect(vendingDefects(mall.layout, {lane: () => true}), `seed ${seed}`).toEqual([]);
      // every mall machine faces into the gallery from its north wall (the only solid wall long enough), never the open east side
      for (const p of mall.layout.props) expect(Math.abs(Math.cos(p.rot) - 1) < 1e-6 || p.x - p.hx < 1.6, `${p.x},${p.z} rot ${p.rot}`).toBe(true);
    }
    expect(oldBad, 'the old rule reproduces the defect').toBeGreaterThan(0);
    expect(mallPlaced, 'the mall rule still finds real wall spots').toBeGreaterThan(0);
  });

  it('a strict machine reserves its passing lane: later dressing cannot fill the 2.4 m in front of it', () => {
    const {layout, A} = gallery('ring');
    const ctx = makePlaceCtx(layout, new Rng(4), 0);
    const v = placeAgainstWall(ctx, A, 'vending', {sides: ['N'], front: 1.0});
    expect(v).not.toBeNull();
    const fz = Math.cos(v!.rot);
    for (let d = PROP_DEFS.vending.d / 2 + 0.25; d < PROP_DEFS.vending.d / 2 + VENDING_CLEAR_AHEAD; d += 0.5) {
      const [cx, cy] = ctx.g.cellOf(v!.x, v!.z + fz * d);
      expect(ctx.keep[ctx.g.idx(cx, cy)], `keep at ${d.toFixed(2)} m`).toBe(1);
    }
  });

  const mall = (() => { let L: StationLayout | null = null; return () => (L ??= generateMallLevel({levelSeed: 0x7ea3c1, startWeapon: 'rifle'})); })();
  it('generated mall: every vending machine backed by a wall, facing open floor, clear of doors / link mouths; few per retail storey', () => {
    const L = mall();
    expect(strictWalls(L), 'the mall keeps a retail ring storey (gen/levels.ts LevelRole) — else its wall placements are not strict').toBe(true);
    const vend = L.props.filter(p => p.kind === 'vending');
    expect(vend.length).toBeGreaterThan(0);
    // galleries (retail-arcade walkways) keep the full passing lane; elsewhere the approach (a landmark may stand ~2 m off)
    expect(vendingDefects(L, {lane: a => a?.type === 'retail-arcade'})).toEqual([]);
    const perStorey = new Map<number, number>();
    for (const p of vend) perStorey.set(p.level ?? 0, (perStorey.get(p.level ?? 0) ?? 0) + 1);
    for (const [lv, n] of perStorey) expect(n, `storey ${lv}`).toBeLessThanOrEqual(lv === 0 ? 20 : 8);
  });
});
