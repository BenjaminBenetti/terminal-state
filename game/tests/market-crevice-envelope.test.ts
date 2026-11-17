// Task studio-market-irregular-envelope-20261116-210503-01: THE SURVIVOR MARKET's layout version 6 — version 5's crevice settlement
// inside an IRREGULAR ENVELOPE (gen/market/v6/envelope.ts) over a seed sample, both mirror states:
//  - the version policy: 6 for new / unvisited markets; a recorded 1-5 stays what it was — a recorded 5 regenerates byte for byte the
//    shipped version 5 (fingerprints of origin/main aeec54a4's generator; the envelope draws on its own stream);
//    (re-pinned by task studio-market-irregular-settlement-20261117-003819-01: new / unvisited markets build version 7 now — this envelope
//    around an irregular settlement floorplan, market-crevice-settlement.test.ts; a recorded 6 regenerates byte for byte the shipped
//    version 6: fingerprints of origin/main dc27a8d4's generator)
//  - every layout validates (creviceIssues + the envelope's rules) within the generation budget; deterministic; the settlement kept
//    (containers both sides on four storeys, bridges on every terrace, the stalls / bar / den);
//  - NO FLAT LID: many overhead heights (none dominant), the high slot's line moving sideways down the crevice, the two sides' overhead
//    different, the edges changing from row to row; headroom kept over the top terrace;
//  - the end clefts out of reach, the top terrace's alcoves; the chasm's bed shelved at several depths, the walks still railed and no
//    railing inside the chasm;
//  - kept: the flat 1.5 m way from the train to the heavy shops and the den; the residents' ladder-free graph;
//  - the finishes (world/marketArch.ts): the overhead rock above the rock line, the vault concrete under it, the clefts rock (never the
//    track's ballast), the atrium's sky line the envelope's lowest overhead.
import {describe, expect, it} from 'vitest';
import * as crypto from 'node:crypto';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {CELL, FLOOR, PathFinder, VOID} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {LEVELS} from '../src/levels/registry';
import {CREVICE_GEN_STATS, MARKET_LAYOUT_LANE, MARKET_LAYOUT_VERSION, creviceIssues, generateMarketLevel, marketLayoutIssues, marketLayoutVersionFor} from '../src/gen/market/index';
import {MARKET_STALLS_ALL} from '../src/gen/market/marketTypes';
import {ENVELOPE} from '../src/gen/market/v6/envelope';
import {CREVICE} from '../src/gen/market/v5/frame';
import {crevOf} from '../src/gen/market/v5/art';
import {CREVICE_KEYS} from '../src/world/marketArch';
import {usesCreviceTextures} from '../src/world/marketTextures';
import {marketBridgeModelKeys} from '../src/world/marketCrevice';
import {MARKET_PEOPLE} from '../src/market/marketPeople';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 42, 777, 4242, 9001, 31337, 20261116];
// (one untimed generation first: a worker's first layout also compiles the generator — ~350 ms here against ~80-190 ms warm; the budget
// below is per layout)
generateMarketLevel({levelSeed: 99, layoutVersion: 6});
const runs = SEEDS.map(seed => {
  const L = generateMarketLevel({levelSeed: seed, layoutVersion: 6});
  return {seed, L, ms: CREVICE_GEN_STATS.ms, attempts: CREVICE_GEN_STATS.attempts};
});

/** Version 6 fingerprints of origin/main dc27a8d4's generator (task studio-market-irregular-settlement-20261117-003819-01: computed on it
 *  before that change and on its branch: identical). */
const V6_SHIPPED: Record<number, string> = {
  1: 'af7ac93a3e6f6c35', 2: '1d50e14a587812dc', 3: 'c70fafd688bc1431', 6: '76abe82e05fe3045', 7: '7a38172bb2e344d3', 16: 'bc406c2d97f01697',
  42: '95f48d1cedf20ce4', 777: 'f3d95b73d37fb219', 4242: '6f79c5853a3b20e2', 9001: '1f07e5d21262b140', 31337: '4462e2950f2182d3',
  20261116: '1891406ce66fc2d0',
};
/** Version 5 fingerprints of origin/main aeec54a4's generator (computed on it before this change and on this branch: identical). */
const V5_SHIPPED: Record<number, string> = {
  1: 'e946af16c107f1da', 2: '3e7b8ddd81c598b9', 3: 'eff544739592b5ea', 6: '2211edd83cf39d40', 7: 'da986df4ae039cc9', 16: 'fbbe3127697223e4',
  42: 'b276a550a65a0781', 777: 'd128f2bb54d272f9', 4242: '34dca8edc6773f2a', 9001: '6f0e84ceea6b7ef7', 31337: '9179d1efdfb2372b',
};
function fingerprint(l: StationLayout): string {
  const g = l.levels.map(L => crypto.createHash('sha256').update(Buffer.from(L.grid.cells)).update(Buffer.from(L.grid.area.buffer)).update(Buffer.from(L.grid.floor.buffer)).update(Buffer.from(L.grid.ceil.buffer)).update(Buffer.from(L.grid.blocked)).update(Buffer.from(L.grid.sightBlocked)).digest('hex'));
  const s = JSON.stringify({g, areas: l.areas, doors: l.doors, props: l.props, lights: l.lights, signs: l.signs, market: l.market, rails: l.rails, links: l.levelLinks, spawn: l.playerSpawn, lad: l.traversal.ladders, st: l.traversal.stairs, name: l.name});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** The top boxes' roof line: an open band ending above it is the crevice's overhead. */
const ROOF = CREVICE.bases[CREVICE.bases.length - 1] + CREVICE.cont + 0.5;
/** Per layout-grid cell: the highest overhead over it (NaN: none — rock, a roofed room, the hall's vault). */
function overhead(L: StationLayout): Float32Array {
  const g = L.grid, out = new Float32Array(g.w * g.h).fill(NaN);
  for (const lv of L.levels) for (let i = 0; i < out.length; i++) {
    const c = lv.grid.cells[i];
    if ((c === FLOOR || c === VOID) && lv.grid.ceil[i] > ROOF && !(lv.id > 0 && c === VOID) && !(lv.grid.ceil[i] <= out[i])) out[i] = lv.grid.ceil[i];
  }
  return out;
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

/** Every non-instanced triangle of a built world: centre, normal y, material. */
function triangles(group: THREE.Object3D): {c: THREE.Vector3; ny: number; m: THREE.Material}[] {
  const out: {c: THREE.Vector3; ny: number; m: THREE.Material}[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const p = mesh.geometry.getAttribute('position'), idx = mesh.geometry.index;
    if (!p) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    const count = idx ? idx.count : p.count;
    for (let k = 0; k + 2 < count; k += 3) {
      const [i0, i1, i2] = idx ? [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)] : [k, k + 1, k + 2];
      a.fromBufferAttribute(p, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p, i1).applyMatrix4(mesh.matrixWorld);
      d.fromBufferAttribute(p, i2).applyMatrix4(mesh.matrixWorld);
      n.subVectors(b, a).cross(e.subVectors(d, a));
      const len = n.length();
      if (len < 1e-9) continue;
      out.push({c: a.clone().add(b).add(d).multiplyScalar(1 / 3), ny: n.y / len, m: mat});
    }
  });
  return out;
}

describe('Survivor Market layout version 6 (the crevice\'s irregular envelope)', () => {
  it('the version policy: 7 for new / unvisited markets, a recorded 1-6 kept; a recorded 5 / 6 regenerates the shipped version exactly', () => {
    expect(MARKET_LAYOUT_VERSION).toBe(7);
    expect(marketLayoutVersionFor(undefined)).toBe(7);
    expect(marketLayoutVersionFor({visits: 0, lanes: {}})).toBe(7);
    expect(marketLayoutVersionFor({visits: 2, lanes: {}})).toBe(1);
    for (const v of [1, 2, 3, 4, 5, 6, 7]) expect(marketLayoutVersionFor({visits: 4, lanes: {[MARKET_LAYOUT_LANE]: {v}}})).toBe(v);
    for (const [s, want] of Object.entries(V5_SHIPPED)) {
      expect(fingerprint(generateMarketLevel({levelSeed: Number(s), layoutVersion: 5})), `seed ${s}`).toBe(want);
    }
    expect(fingerprint(LEVELS.market.generate('main', {levelSeed: 42, layoutVersion: 5}))).toBe(V5_SHIPPED[42]);
    expect(generateMarketLevel({levelSeed: 42, layoutVersion: 5}).market!.crevice!.envelope).toBeUndefined();
    for (const [s, want] of Object.entries(V6_SHIPPED)) {
      expect(fingerprint(generateMarketLevel({levelSeed: Number(s), layoutVersion: 6})), `seed ${s} (version 6)`).toBe(want);
    }
    expect(fingerprint(LEVELS.market.generate('main', {levelSeed: 42, layoutVersion: 6}))).toBe(V6_SHIPPED[42]);
    const L6 = generateMarketLevel({levelSeed: 42, layoutVersion: 6});
    expect([L6.market!.v, !!L6.market!.crevice!.envelope, L6.market!.crevice!.settlement]).toEqual([6, true, undefined]);
    // the default (no recorded version) builds the enveloped crevice, on its irregular settlement floorplan (version 7)
    const L = LEVELS.market.generate('main', {levelSeed: 42});
    expect(L.market?.v).toBe(7);
    expect(L.market!.crevice!.envelope).toBeTruthy();
    expect(L.market!.crevice!.settlement).toBeTruthy();
  });

  it('every seed validates within the budget; deterministic; the settlement kept', () => {
    for (const {seed, L, ms, attempts} of runs) {
      expect(creviceIssues(L), `seed ${seed}`).toEqual([]);
      expect(marketLayoutIssues(L), `seed ${seed}`).toEqual([]);
      expect(ms, `seed ${seed} gen ms`).toBeLessThan(400);
      expect(attempts, `seed ${seed} attempts`).toBeLessThanOrEqual(4);
      expect(L.market!.v).toBe(6);
      expect(L.market!.stalls.map(s => s.id)).toEqual([...MARKET_STALLS_ALL]);
      expect(L.market!.den).toBeTruthy();
      const cr = L.market!.crevice!, mid = (cr.chasm.x0 + cr.chasm.x1) / 2;
      expect(cr.containers.length, `seed ${seed} containers`).toBeGreaterThanOrEqual(36);
      for (let lv = 0; lv < 4; lv++) for (const west of [true, false]) {
        expect(cr.containers.some(c => c.level === lv && ((c.x0 + c.x1) / 2 < mid) === west), `seed ${seed} storey ${lv} ${west ? 'west' : 'east'}`).toBe(true);
      }
      expect(new Set(cr.bridges.map(b => b.level)), `seed ${seed} bridge storeys`).toEqual(new Set([1, 2, 3]));
      const rooms = new Set(cr.containers.filter(c => c.area >= 0).map(c => c.area));
      for (const s of L.market!.stalls) if (s.id !== 'bar') expect(rooms.has(s.area), `seed ${seed} stall ${s.id}`).toBe(true);
    }
    for (const {seed, L} of runs.slice(0, 3)) {
      expect(fingerprint(generateMarketLevel({levelSeed: seed, layoutVersion: 6}))).toBe(fingerprint(L));
      expect(L.name).toBe(generateMarketLevel({levelSeed: seed, layoutVersion: 5}).name);
    }
    const mirrored = runs.map(r => { const den = r.L.market!.den!; return den.door.x < r.L.grid.w * CELL / 2; });
    expect(new Set(mirrored).size).toBe(2);
  });

  it('no flat lid: the overhead steps over many heights, its high slot wanders sideways, the sides differ, no edge runs straight', () => {
    for (const {seed, L} of runs) {
      const g = L.grid, W = g.w, cr = L.market!.crevice!, env = cr.envelope!;
      const over = overhead(L);
      const heights = new Map<number, number>();
      let n = 0;
      for (const h of over) if (Number.isFinite(h)) {
        expect(h, `seed ${seed}`).toBeGreaterThanOrEqual(ENVELOPE.low - 1e-3);
        expect(h, `seed ${seed}`).toBeLessThanOrEqual(ENVELOPE.high + 1e-3);
        const k = Math.round(h * 20);
        heights.set(k, (heights.get(k) ?? 0) + 1);
        n++;
      }
      expect(n, `seed ${seed} overhead cells`).toBeGreaterThan(3000);
      expect(heights.size, `seed ${seed} overhead heights`).toBeGreaterThanOrEqual(25);
      expect(Math.max(...heights.values()) / n, `seed ${seed} the most common height's share`).toBeLessThan(0.2);
      expect(env.sky).toBeGreaterThanOrEqual(ENVELOPE.low - 1e-3);
      expect(cr.topY, `seed ${seed} the highest overhead`).toBeGreaterThan(CREVICE.topY);
      // the slot (each crevice row's highest overhead): its centre moves sideways down the crevice, to both sides of the centre line
      const xm = (cr.chasm.x0 + cr.chasm.x1) / 2 / CELL;
      const z0 = Math.round(cr.chasm.z0 / CELL), z1 = Math.round(cr.chasm.z1 / CELL);
      const centres: number[] = [];
      let changed = 0, rows = 0;
      for (let y = z0; y < z1; y++) {
        let top = -Infinity;
        for (let x = 0; x < W; x++) { const h = over[y * W + x]; if (h > top) top = h; }
        let sx = 0, sn = 0;
        for (let x = 0; x < W; x++) if (over[y * W + x] >= top - 0.01) { sx += x + 0.5; sn++; }
        centres.push(sx / sn);
        if (y > z0) {
          rows++;
          for (let x = 0; x < W; x++) {
            const a = over[y * W + x], b = over[(y - 1) * W + x];
            if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 0.01) { changed++; break; }
          }
        }
      }
      expect(Math.max(...centres) - Math.min(...centres), `seed ${seed} the slot's sideways travel (cells)`).toBeGreaterThanOrEqual(8);
      expect(centres.some(c => c < xm - 2) && centres.some(c => c > xm + 2), `seed ${seed} the slot crosses the centre line`).toBe(true);
      // the overhead's profile changes from one row to the next on most rows (wandering edges, not long straight ones)
      expect(changed / rows, `seed ${seed} rows whose profile changes`).toBeGreaterThan(0.6);
      // the two sides differ: the overhead against its mirror across the crevice's centre line
      let pairs = 0, differ = 0;
      for (let y = z0; y < z1; y++) for (let x = 0; x < Math.floor(xm); x++) {
        const xr = Math.round(2 * xm - x - 1);
        const a = over[y * W + x], b = over[y * W + xr];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        pairs++;
        if (Math.abs(a - b) > 0.3) differ++;
      }
      expect(differ / pairs, `seed ${seed} asymmetry`).toBeGreaterThan(0.4);
    }
  });

  it('headroom: the top terrace and its nooks / alcoves keep 3.5 m or more under the overhead', () => {
    for (const {seed, L} of runs) {
      const lv = L.levels[3], g = lv.grid;
      let walks = 0;
      for (let i = 0; i < g.cells.length; i++) {
        if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0) continue;
        const a = L.areas[g.area[i]];
        if (!a?.publicSpace) continue;
        expect(g.ceil[i] - g.floorOf(i), `seed ${seed} cell ${i} ${a.label}`).toBeGreaterThanOrEqual(3.5 - 1e-3);
        if (a.role === 'catwalk') walks++;
      }
      expect(walks).toBeGreaterThan(200);
      // the top storey's nooks / alcoves: sheltered under their own soffits (no longer open to the crevice's top)
      const nooks = L.areas.filter(a => a.label === 'Terrace nook' && a.level === 3);
      expect(nooks.length, `seed ${seed} top nooks`).toBeGreaterThanOrEqual(2);
      for (const a of nooks) {
        expect(a.ceil, `seed ${seed} nook ${a.id}`).toBeGreaterThanOrEqual(ENVELOPE.nook[0] - 1e-3);
        expect(a.ceil, `seed ${seed} nook ${a.id}`).toBeLessThanOrEqual(ENVELOPE.alcove.soffit[1] + 1e-3);
      }
      expect(L.market!.crevice!.envelope!.alcoves, `seed ${seed} alcoves`).toBeGreaterThanOrEqual(2);
    }
  });

  it('the end clefts: rock voids at both ends of the crevice, high over the top terrace, never walked', () => {
    for (const {seed, L} of runs) {
      const cr = L.market!.crevice!, env = cr.envelope!;
      expect(env.clefts.some(c => c.z1 <= cr.chasm.z0), `seed ${seed} north cleft`).toBe(true);
      expect(env.clefts.some(c => c.z0 >= cr.chasm.z1), `seed ${seed} south cleft`).toBe(true);
      let cells = 0;
      for (const lv of L.levels.slice(1)) {
        const g = lv.grid;
        for (let i = 0; i < g.cells.length; i++) {
          if (g.cells[i] !== VOID) continue;
          cells++;
          expect(g.area[i]).toBe(-1);
          expect(g.floorOf(i), `seed ${seed}`).toBeGreaterThanOrEqual(CREVICE.bases[3] + 3);
          expect(g.ceil[i] - g.floorOf(i)).toBeGreaterThanOrEqual(2);
        }
      }
      expect(cells, `seed ${seed} cleft cells`).toBeGreaterThan(20);
      // no stair / ladder / link reaches one
      for (const k of L.levelLinks) expect(Math.max(k.lower, k.upper) <= 3).toBe(true);
      for (const l of L.traversal.ladders) expect(l.topY).toBeLessThan(CREVICE.bases[3] + 1);
    }
  });

  it('down: the chasm\'s bed shelved at several depths under railed walks; no railing inside the chasm', () => {
    for (const {seed, L} of runs) {
      const g = L.grid, cr = L.market!.crevice!, ch = cr.chasm;
      const depths = new Set<number>();
      const deep: number[] = [];
      const z0 = Math.round(ch.z0 / CELL), z1 = Math.round(ch.z1 / CELL), x0 = Math.round(ch.x0 / CELL), x1 = Math.round(ch.x1 / CELL);
      for (let y = z0; y < z1; y++) {
        let lo = Infinity, sx = 0, sn = 0;
        for (let x = x0; x < x1; x++) {
          const i = y * g.w + x;
          expect(g.cells[i], `seed ${seed} chasm cell`).toBe(VOID);
          const f = g.floorOf(i);
          expect(f, `seed ${seed} bed under a railing's drop`).toBeLessThanOrEqual(ENVELOPE.bed.lipMax + 1e-3);
          depths.add(Math.round(f * 20));
          lo = Math.min(lo, f);
        }
        for (let x = x0; x < x1; x++) if (g.floorOf(y * g.w + x) <= lo + 0.01) { sx += x; sn++; }
        deep.push(sx / sn);
      }
      expect(depths.size, `seed ${seed} bed depths`).toBeGreaterThanOrEqual(6);
      expect(cr.chasmY, `seed ${seed} deepest`).toBeLessThanOrEqual(ENVELOPE.bed.cleftD[1] + 1e-3);
      // the deep cleft winds: its line moves across the bed
      expect(Math.max(...deep) - Math.min(...deep), `seed ${seed} the cleft's travel`).toBeGreaterThanOrEqual(3);
      // the low walks' edges railed along the chasm, nothing railed inside it
      for (const xe of [ch.x0, ch.x1]) {
        const len = L.rails.filter(r => r.level === 0 && Math.abs(r.x0 - xe) < 0.01 && Math.abs(r.x1 - xe) < 0.01).reduce((s, r) => s + Math.abs(r.z1 - r.z0), 0);
        expect(len, `seed ${seed} rail along x ${xe}`).toBeGreaterThanOrEqual(0.9 * (ch.z1 - ch.z0));
      }
      const inside = L.rails.filter(r => r.level === 0 && Math.min(r.x0, r.x1) > ch.x0 + 0.01 && Math.max(r.x0, r.x1) < ch.x1 - 0.01 && Math.min(r.z0, r.z1) > ch.z0 + 0.01 && Math.max(r.z0, r.z1) < ch.z1 - 0.01);
      expect(inside, `seed ${seed}`).toEqual([]);
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

  describe('the finishes (world/marketArch.ts)', () => {
    const built = new Map<number, {L: StationLayout; w: BuiltWorld; mats: WorldMaterials}>();
    const world = (seed: number) => {
      let b = built.get(seed);
      if (!b) {
        const L = runs.find(r => r.seed === seed)!.L;
        const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
        built.set(seed, (b = {L, w: buildWorld(L, mats, {}), mats}));
      }
      return b;
    };

    it('the crevice look and the bridge kit on version 6', () => {
      const {L, w} = world(7);
      expect(w.marketArch?.v5).toBe(true);
      expect(w.marketArch?.crevice).toBeTruthy();
      expect(usesCreviceTextures(L)).toBe(true);
      expect(crevOf(L)).toBe(L.market!.crevice);
      expect(marketBridgeModelKeys(L).length).toBe(1);
    });

    for (const seed of [7, 42]) {
      it(`seed ${seed}: the overhead rock above the rock line, the vault concrete under it; the clefts rock; the bed shelved, never ballast`, () => {
        const {L, w, mats} = world(seed);
        const arch = w.marketArch!, env = L.market!.crevice!.envelope!, ch = L.market!.crevice!.chasm;
        const want = (y: number) => (y >= env.rock - 0.02 ? CREVICE_KEYS.top : CREVICE_KEYS.vault);
        let rock = 0, concrete = 0, clefts = 0;
        for (const lv of L.levels) {
          const g = lv.grid;
          for (let i = 0; i < g.cells.length; i++) {
            const c = g.cells[i], y = g.ceil[i];
            if (c === VOID && lv.id > 0) {
              expect(arch.voidFloorKey(lv.id, i)).toBe(CREVICE_KEYS.top);
              expect(arch.voidCeilKey(lv.id, i, y)).toBe(CREVICE_KEYS.top);
              clefts++;
              continue;
            }
            if ((c !== FLOOR && c !== VOID) || y < env.sky - 0.02) continue;
            const k = c === FLOOR ? arch.ceilKey(lv.id, g.area[i], i, y) : arch.voidCeilKey(lv.id, i, y);
            if (k === false) continue; // (under a bridge deck: the bridge model)
            expect(k, `L${lv.id} cell ${i} at ${y}`).toBe(want(y));
            if (k === CREVICE_KEYS.top) rock++; else concrete++;
          }
        }
        expect(rock).toBeGreaterThan(500);
        expect(concrete).toBeGreaterThan(500);
        expect(clefts).toBeGreaterThan(20);
        // drawn: ceilings in both keys over the crevice, the clefts' rock up there, no ballast anywhere up there or in the chasm
        const tris = triangles(w.group), ballast = mats.get('ballast');
        const high = tris.filter(t => t.c.y > ROOF);
        expect(high.some(t => t.ny < -0.9 && t.m.name === CREVICE_KEYS.top)).toBe(true);
        expect(high.some(t => t.ny < -0.9 && t.m.name === CREVICE_KEYS.vault)).toBe(true);
        expect(high.some(t => t.ny > 0.9 && t.m.name === CREVICE_KEYS.top)).toBe(true); // a cleft's floor
        expect(high.some(t => t.m === ballast)).toBe(false);
        const inChasm = (p: THREE.Vector3) => p.x > ch.x0 + 0.05 && p.x < ch.x1 - 0.05 && p.z > ch.z0 + 0.05 && p.z < ch.z1 - 0.05;
        const bed = tris.filter(t => t.ny > 0.9 && inChasm(t.c) && t.c.y < ENVELOPE.bed.lipMax + 0.01);
        expect(new Set(bed.map(t => Math.round(t.c.y * 20))).size).toBeGreaterThanOrEqual(4);
        for (const t of bed) expect(t.m.name).toBe(CREVICE_KEYS.chasm);
        expect(tris.some(t => t.m === ballast && inChasm(t.c))).toBe(false);
      });
    }

    it('the culler\'s atrium: the open crevice columns under the envelope (its sky line the lowest overhead), not the hall or a cleft', () => {
      for (const seed of [7, 42]) {
        const {L, w} = world(seed);
        const env = L.market!.crevice!.envelope!, atr = w.marketArch!.atrium, g = L.grid, plat = L.areas[L.platform];
        let n = 0;
        for (let i = 0; i < atr.length; i++) {
          if (!atr[i]) continue;
          n++;
          expect(L.levels.some(lv => (lv.grid.cells[i] === FLOOR || lv.grid.cells[i] === VOID) && lv.grid.ceil[i] >= env.sky - 0.05), `cell ${i}`).toBe(true);
          // (a cleft column holds nothing but rock under its void)
          expect(L.levels.slice(1).some(lv => lv.grid.cells[i] === VOID)).toBe(false);
        }
        for (let y = plat.y; y < plat.y + plat.h; y++) for (let x = plat.x; x < plat.x + plat.w; x++) expect(atr[y * g.w + x]).toBe(0);
        const ch = L.market!.crevice!.chasm;
        expect(atr[g.idx(...g.cellOf((ch.x0 + ch.x1) / 2, (ch.z0 + ch.z1) / 2 + 0.3))]).toBe(1);
        expect(n).toBeGreaterThan(2000);
        expect(w.culler.atriumTileCount).toBeGreaterThan(60);
        expect(w.culler.atriumTileCount).toBeLessThan(260);
      }
    });
  });
});
