// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): a VERSION-2 Surface Run district's FOG-PRESSURE BOUNDARY on the
// generator side (gen/surface/fogFiller.ts; the field world/surface/fogPressure.ts). User: "Replace the visible perimeter wall with
// thickening outer fog and enough bounded filler blocks to hide the finite edge; the user authorizes extra outer padding if needed. Keep
// the meaningful core, not a content / draw-distance cut." On GEN's REAL districts over many seeds and every host:
//  - the record by version: v2 carries `boundary` and no cordon; v1 keeps its cordon and no boundary;
//  - CLEAR holds the meaningful district: every enterable / destination / host building, the checkpoint, its tent and map table, the
//    truck, the portal, the depot (its block, shed features, recoverables), the core and the inner streets — pressure 0 at all of them;
//  - the RAMP reaches pressure 1 FOG_BOUNDARY.ramp m out, the EDGE lies >= 25 m beyond that on every side; the field rises outward;
//  - the finite geometry: a thin SOLID ring round the walkable ground, an open outdoor apron reachable from the streets out to the edge;
//  - the padding is BOUNDED (grid, light-field bytes under the renderer's bound) and the content is the v1 district's (enterables);
//  - deterministic.
import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {SURFACE_GEN_STATS, generateSurfaceDistrict} from '../src/gen/surface/index';
import {FOG_BOUNDARY} from '../src/gen/surface/fogFiller';
import type {SRect, SurfaceInfo} from '../src/gen/surface/surfaceTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {FOG_PRESSURE, fogPressureAt} from '../src/world/surface/fogPressure';
import {SURFACE_AIR, columnTop, surfaceOutdoorGasAt, surfaceOutdoorMap} from '../src/world/surface/airMask';
import {MAX_GROUPS, MAX_SLOTS, fieldDepth, giDepth} from '../src/world/lightField';
import {FIELD_CUBE_BYTES} from '../src/world/enhancedLighting';

const HOSTS = ['subway', 'office', 'mall'] as const;
const SEEDS = Array.from({length: 12}, (_, i) => i + 1);
const cache = new Map<string, {L: StationLayout; stats: typeof SURFACE_GEN_STATS}>();
const gen = (seed: number, v: 1 | 2) => {
  const k = `${seed}:${v}`;
  let hit = cache.get(k);
  if (!hit) {
    const L = generateSurfaceDistrict(HOSTS[seed % 3], {levelSeed: seed, surfaceVersion: v});
    cache.set(k, (hit = {L, stats: structuredClone(SURFACE_GEN_STATS)}));
  }
  return hit;
};
const v2 = (seed: number) => gen(seed, 2).L;
const within = (outer: SRect, r: SRect, pad = 0) => r.x0 >= outer.x0 + pad - 1e-6 && r.z0 >= outer.z0 + pad - 1e-6 && r.x1 <= outer.x1 - pad + 1e-6 && r.z1 <= outer.z1 - pad + 1e-6;
const pt = (x: number, z: number): SRect => ({x0: x, z0: z, x1: x, z1: z});
const box = (r: SRect) => `[${r.x0}, ${r.z0} .. ${r.x1}, ${r.z1}]`;
const fieldBytes = (L: StationLayout) => {
  const S = Math.min(MAX_SLOTS, L.levels.length || 1), depth = fieldDepth(S) + MAX_GROUPS + giDepth(S);
  return Math.ceil(L.grid.w / 2) * Math.ceil(L.grid.h / 2) * depth * 4; // (a district's field is uploaded at X / Z scale 2: lookDaylight.ts)
};

describe('surface fog boundary: the record by version', () => {
  it('a v2 district carries the boundary and no cordon wall band; a v1 district its cordon and no boundary', () => {
    for (const seed of [1, 2, 3]) {
      const a = gen(seed, 1).L.surface!, b = v2(seed).surface!;
      expect(a.v).toBe(1);
      expect(a.cordon, `v1 ${seed}`).toBeTruthy();
      expect(a.boundary).toBeUndefined();
      expect(b.v).toBe(2);
      expect(b.cordon, `v2 ${seed}`).toBeUndefined();
      const B = b.boundary!;
      expect(B.ramp).toBe(FOG_BOUNDARY.ramp);
      expect(within(B.edge, B.clear)).toBe(true);
      expect(within(B.edge, b.extent)).toBe(true);
      expect(within(B.clear, b.core), `core ${box(b.core)} in clear ${box(B.clear)}`).toBe(true);
      // the grid is exactly the walkable edge plus its last-resort ring
      expect(B.edge.x0).toBeCloseTo(FOG_BOUNDARY.band * CELL, 9);
      expect(B.edge.z0).toBeCloseTo(FOG_BOUNDARY.band * CELL, 9);
      expect(B.edge.x1).toBeCloseTo((v2(seed).grid.w - FOG_BOUNDARY.band) * CELL, 9);
      expect(B.edge.z1).toBeCloseTo((v2(seed).grid.h - FOG_BOUNDARY.band) * CELL, 9);
    }
  }, 120_000);
});

describe('surface fog boundary: CLEAR holds the meaningful district (many seeds, every host)', () => {
  it('every enterable / destination / host building, the checkpoint, tent, map table, truck, portal, depot and core: inside clear, pressure 0', () => {
    for (const seed of SEEDS) {
      const S: SurfaceInfo = v2(seed).surface!, C = S.boundary!.clear, tag = `seed ${seed} ${S.host}`;
      const must: [string, SRect, number?][] = [];
      for (const b of S.buildings) if (b.enterable || b.destination || b.host) must.push([`building ${b.id} ${b.kind}${b.host ? ` (${b.host})` : ''}`, b.footprint]);
      must.push(['checkpoint', S.checkpoint.rect], ['tent', S.checkpoint.tent.rect], ['map table', pt(S.checkpoint.mapTable.read.x, S.checkpoint.mapTable.read.z)]);
      // the truck's parking pose, with room for its body (about 6.6 m long) on every side
      must.push(['truck', pt(S.truck.x, S.truck.z), 4]);
      must.push(['portal', pt(S.portal.pose.x, S.portal.pose.z)], ['portal trigger', S.portal.trigger]);
      const depot = S.buildings[S.depot.building];
      must.push(['depot', depot.footprint], ['depot block', S.blocks[depot.block].rect]);
      for (const r of S.depot.recoverables) must.push([`recoverable ${r.kind}`, pt(r.pose.x, r.pose.z)]);
      const F = S.depot.features;
      if (F) {
        for (const t of F.tracks) must.push(['shed track', t]);
        for (const p of F.pits) must.push(['shed pit', p]);
        if (F.crane) must.push(['shed crane', F.crane]);
      }
      for (const l of S.lots ?? []) if (l.block === depot.block) must.push([`depot lot ${l.use}`, l.rect]);
      must.push(['core', S.core]);
      expect(must.length).toBeGreaterThan(20);
      for (const [what, r, pad] of must) {
        expect(within(C, r, pad ?? 0), `${tag}: ${what} ${box(r)} in clear ${box(C)}`).toBe(true);
        for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z1], [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]]) expect(fogPressureAt(S.boundary, x, z)).toBe(0);
      }
    }
  }, 300_000);

  it('the streets: the drivable grid inside the outer ring is clear; every other run leads into it or is the perimeter road out in the fog, never at the edge', () => {
    for (const seed of SEEDS) {
      const S = v2(seed).surface!, B = S.boundary!, e = B.edge;
      let inner = 0, perimeter = 0;
      for (const st of S.streets) {
        let max = 0, min = Infinity;
        for (let k = 0; k <= 32; k++) {
          const t = k / 32, x = st.ax + (st.bx - st.ax) * t, z = st.az + (st.bz - st.az) * t, p = fogPressureAt(B, x, z);
          max = Math.max(max, p); min = Math.min(min, p);
          // every street stands well inside the walkable edge (>= 15 m): the perimeter road fades into the fog, never into the ring
          expect(Math.min(x - e.x0, e.x1 - x, z - e.z0, e.z1 - z), `seed ${seed} street ${st.id} ${st.name}`).toBeGreaterThanOrEqual(15);
        }
        if (max === 0) inner++;
        else if (min > 0) {
          // wholly out in the fog: a run of the perimeter road (along the clear rect) or an alley of an outer-ring block
          perimeter++;
          if (st.rank !== 'lane') expect(max - min, `seed ${seed} street ${st.id} ${st.name}: a road outside clear runs along it`).toBeLessThan(0.05);
        }
        // else: a stub from the inner grid out to the perimeter road (starts in clear)
      }
      expect(inner / S.streets.length, `seed ${seed}: share of streets wholly in clear`).toBeGreaterThan(0.5);
      expect(perimeter, `seed ${seed}: the perimeter road's runs`).toBeLessThanOrEqual(S.streets.length * 0.3);
    }
  }, 300_000);
});

describe('surface fog boundary: the ramp, the edge, the field', () => {
  it(`pressure 1 at ramp (${FOG_BOUNDARY.ramp} m) out; the edge >= ${FOG_BOUNDARY.margin} m (>= 25) beyond that on every side`, () => {
    expect(FOG_BOUNDARY.margin).toBeGreaterThanOrEqual(25);
    expect(FOG_BOUNDARY.ramp).toBeGreaterThanOrEqual(30); // long enough to read as natural thickening, not a wall of fog
    for (const seed of SEEDS) {
      const B = v2(seed).surface!.boundary!, c = B.clear, e = B.edge;
      const sides = {W: c.x0 - e.x0, E: e.x1 - c.x1, N: c.z0 - e.z0, S: e.z1 - c.z1};
      for (const [s, d] of Object.entries(sides)) expect(d - B.ramp, `seed ${seed} side ${s}: p=1 to the edge`).toBeGreaterThanOrEqual(25 - 1e-6);
      const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
      expect(fogPressureAt(B, c.x0 - B.ramp, mz)).toBeCloseTo(1, 9);
      expect(fogPressureAt(B, mx, c.z1 + B.ramp)).toBeCloseTo(1, 9);
      for (const [x, z] of [[e.x0, mz], [e.x1, mz], [mx, e.z0], [mx, e.z1]]) expect(fogPressureAt(B, x, z)).toBeGreaterThanOrEqual(1 + 25 / B.ramp - 1e-9);
    }
  }, 300_000);

  it('the pressure rises monotonically outward from the core in every direction (0 in clear, strictly rising beyond)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const S = v2(seed).surface!, B = S.boundary!, c = B.clear, e = B.edge;
      const cx = (S.core.x0 + S.core.x1) / 2, cz = (S.core.z0 + S.core.z1) / 2;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        let prev = 0, out = false;
        for (let t = 0; ; t += 0.5) {
          const x = cx + dx * t, z = cz + dz * t;
          if (x < e.x0 || x > e.x1 || z < e.z0 || z > e.z1) break;
          const p = fogPressureAt(B, x, z), inC = x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1;
          if (inC) expect(p).toBe(0);
          expect(p, `seed ${seed} dir ${k} t ${t}`).toBeGreaterThanOrEqual(prev);
          if (out && !inC) expect(p).toBeGreaterThan(prev);
          out = !inC;
          prev = p;
        }
        expect(prev, `seed ${seed} dir ${k}: past pressure 1 by the edge`).toBeGreaterThan(FOG_PRESSURE.full);
      }
    }
  }, 120_000);
});

describe('surface fog boundary: the finite geometry', () => {
  it('a thin SOLID last-resort ring round the walkable ground; the apron out to the edge is open outdoor ground, reachable from the streets', () => {
    for (const seed of [1, 2, 3]) {
      const L = v2(seed), S = L.surface!, B = S.boundary!, g = L.levels.find(l => l.id === 0)!.grid, W = g.w, H = g.h, b = FOG_BOUNDARY.band;
      // the ring: every cell within `band` of the grid's border is SOLID
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < b || y < b || x >= W - b || y >= H - b) expect(g.cells[y * W + x], `ring ${x},${y}`).toBe(SOLID);
      // the walkable ground's bounding box is the edge
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.cells[y * W + x] === FLOOR) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      expect([x0 * CELL, y0 * CELL, (x1 + 1) * CELL, (y1 + 1) * CELL]).toEqual([B.edge.x0, B.edge.z0, B.edge.x1, B.edge.z1]);
      // the apron (between the old playable rect and the edge): every cell open street-grade outdoor ground under the open sky
      const outdoor = new Set(S.outdoorAreas), m = surfaceOutdoorMap(L)!;
      const E = S.extent;
      let apron = 0;
      for (let y = b; y < H - b; y++) for (let x = b; x < W - b; x++) {
        const px = (x + 0.5) * CELL, pz = (y + 0.5) * CELL;
        if (px > E.x0 && px < E.x1 && pz > E.z0 && pz < E.z1) continue;
        const i = y * W + x;
        expect(g.cells[i], `apron ${x},${y}`).toBe(FLOOR);
        expect(outdoor.has(g.area[i])).toBe(true);
        expect(g.floor[i]).toBe(0);
        if ((x + y) % 97 === 0) {
          expect(columnTop(m, px, pz)).toBe(0);
          expect(surfaceOutdoorGasAt(m, px, 1.6, pz)).toBeGreaterThan(SURFACE_AIR.C); // the outer fog's thicker air (pressure > 0 out here)
        }
        apron++;
      }
      expect(apron).toBeGreaterThan(0);
      expect((S.lots ?? []).filter(l => l.label === 'Rubble verge').length).toBeGreaterThan(0);
      // reachable: a flood over level-0 FLOOR from the portal reaches the edge's middle on all four sides
      const seen = new Uint8Array(W * H), q = new Int32Array(W * H);
      const s0 = Math.floor(S.portal.pose.z / CELL) * W + Math.floor(S.portal.pose.x / CELL);
      let qh = 0, qt = 0;
      const push = (i: number) => { if (!seen[i] && g.cells[i] === FLOOR) { seen[i] = 1; q[qt++] = i; } };
      push(s0);
      expect(qt, 'the portal stands on FLOOR').toBe(1);
      while (qh < qt) {
        const i = q[qh++], x = i % W, y = (i - x) / W;
        if (x > 0) push(i - 1);
        if (x < W - 1) push(i + 1);
        if (y > 0) push(i - W);
        if (y < H - 1) push(i + W);
      }
      const mx = Math.floor(W / 2), my = Math.floor(H / 2);
      let hits = 0;
      for (const [x, y] of [[b, my], [W - b - 1, my], [mx, b], [mx, H - b - 1]]) {
        let any = false;
        for (let k = -40; k <= 40 && !any; k++) { const xx = x === mx ? x + k : x, yy = y === my ? y + k : y; any = !!seen[yy * W + xx]; }
        if (any) hits++;
      }
      expect(hits, `seed ${seed}: the edge reachable on every side`).toBe(4);
    }
  }, 300_000);
});

describe('surface fog boundary: bounded padding, the v1 content kept, deterministic', () => {
  it('the padded grid and its light field stay bounded (under the renderer\'s field bound); generation time is unchanged in kind', () => {
    const reach = Math.round((FOG_BOUNDARY.ramp + FOG_BOUNDARY.margin) / CELL) + FOG_BOUNDARY.band;
    for (const seed of SEEDS) {
      const a = gen(seed, 1), b = gen(seed, 2);
      expect(b.L.grid.w - a.L.grid.w, `seed ${seed} padding x`).toBeLessThanOrEqual(2 * reach);
      expect(b.L.grid.h - a.L.grid.h, `seed ${seed} padding z`).toBeLessThanOrEqual(2 * reach);
      expect(b.L.grid.w).toBeGreaterThanOrEqual(a.L.grid.w);
      expect((b.L.grid.w * b.L.grid.h) / (a.L.grid.w * a.L.grid.h), `seed ${seed} cells v2 / v1`).toBeLessThan(1.2);
      expect(fieldBytes(b.L), `seed ${seed} field bytes`).toBeLessThan(FIELD_CUBE_BYTES);
    }
  }, 300_000);

  it('the same district content as v1: blocks, streets, enterable and destination buildings, the host / depot buildings', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const A = gen(seed, 1).L.surface!, B = v2(seed).surface!;
      expect(B.blocks.length).toBe(A.blocks.length);
      expect(B.streets.length).toBe(A.streets.length);
      expect(B.streets.map(s => s.name)).toEqual(A.streets.map(s => s.name));
      expect(B.name).toBe(A.name);
      expect(B.buildings.filter(b => b.enterable).length, `seed ${seed} enterable`).toBe(A.buildings.filter(b => b.enterable).length);
      expect(B.buildings.filter(b => b.destination).length, `seed ${seed} destinations`).toBe(A.buildings.filter(b => b.destination).length);
      expect(B.buildings.filter(b => b.host).map(b => b.host).sort()).toEqual(A.buildings.filter(b => b.host).map(b => b.host).sort());
      expect(B.buildings[B.depot.building].kind).toBe(A.buildings[A.depot.building].kind);
    }
  }, 300_000);

  it('deterministic: the same seed builds the same v2 district (boundary and grid)', () => {
    const a = v2(2), b = generateSurfaceDistrict(HOSTS[2 % 3], {levelSeed: 2, surfaceVersion: 2});
    const h = (L: StationLayout) => createHash('sha256').update(Buffer.from(L.grid.cells.buffer)).update(Buffer.from(L.grid.floor.buffer)).digest('hex');
    expect(b.surface!.boundary).toEqual(a.surface!.boundary);
    expect(h(b)).toBe(h(a));
  }, 120_000);
});
