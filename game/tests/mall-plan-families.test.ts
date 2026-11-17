// Task studio-mall-layout-variety-20261117-005520-01: the Mall's PLAN FAMILIES (gen/mall/plans.ts) and its parking-lot WINDOW WALLS
// (gen/mall/windows.ts, world/mallWindows.ts), behind the Mall's layout version (gen/mall/layoutVersion.ts):
//  - the version policy (a visited mall without a record stays version 1, a new one records the current version) and Game's lane stamp;
//  - the roll: version 1 = the atrium family's variant exactly; version 2 = one plan-family roll on its own salt (the atrium family keeps
//    ~40 % of seeds and EXACTLY its version-1 variant, the three plan families share the rest evenly);
//  - an atrium seed at version 2 = its version-1 layout + only the append-only window records (no core change);
//  - each plan family at a natural seed: valid, its signature structure (bridge decks / the promenade's glazing on every storey), shops,
//    anchors, a food court, every storey pair linked, street exits + the Surface Run's usable door;
//  - the window walls' generator contract (collider SOLID, the view volume free of the mall, heads under the ceiling, walkway in front,
//    clear of the exits and the lift, daylight) and its render on a real build (three meshes on the street exits' materials + the cars, the
//    lot inside the view and off every open cell, no glass mesh of its own, the cut, the culler's aperture gate: drawn from the glass,
//    never visible-but-culled, not submitted facing away);
//  - no tower windows / roof air: the window walls' breakable panes and their gas are the Mall's own window source (task studio-mall-
//    parking-glass-followup-20261117-043548-01: tests/mall-window-gas.test.ts; the cars: tests/mall-vehicles.test.ts).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {visibleMeshes} from './helpers/visibleMeshes';
import {CELL, FLOOR, SOLID, VOID} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/station';
import {
  MALL_LAYOUT_LANE, MALL_LAYOUT_VERSION, MALL_PLAN_VARIANTS, MALL_VARIANTS, WINDOW, generateMallLevel, mallIssues, mallLayoutVersionFor,
  mallPlanFamilyOf, mallVariantAt, windowColliderCells,
} from '../src/gen/mall/index';
import {mallAtriumVariantOf} from '../src/gen/mall/frame';
import {mallQaPose} from '../src/gen/mall/qa';
import {shopFit} from '../src/gen/mall/shops';
import type {MallWindowWall} from '../src/gen/mall/mallTypes';
import {carveMallAccess} from '../src/gen/surface/accessDoor';
import {createRun} from '../src/run/runState';
import {LEVELS} from '../src/levels/registry';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {CULL_LAYER} from '../src/world/levelCulling';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import {streetExitMaterials} from '../src/world/mallStreetExit';
import {windowWallSpecs} from '../src/world/mallWindows';
import {readTowerInfo} from '../src/world/towerShared';
import {roofAirOf} from '../src/world/roofAir';

installCanvasShim(false);

/** Natural seeds (no forced variant): version 2 rolls these families; seeds 1 / 3 / 11 roll the atrium family at both versions. */
const FAMILY_SEEDS = {promenade: 2, galleria: 5, crossroads: 7} as const;
const ATRIUM_SEEDS = [1, 3, 11];
/** The window walls' generator contract: two natural seeds per plan family. */
const CONTRACT_SEEDS = [2, 4, 5, 13, 7, 8];

const cache = new Map<string, StationLayout>();
const gen = (seed: number, version?: number): StationLayout => {
  const key = `${seed}:${version ?? 'cur'}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = generateMallLevel({levelSeed: seed, startWeapon: 'pistol', ...(version !== undefined ? {layoutVersion: version} : {})})));
  return L;
};
const DAYLIGHT = [0.78, 0.98, 0.86];

function layoutHash(l: unknown): string {
  const json = JSON.stringify(l, (_k, v) => {
    if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let x = 2166136261; for (let i = 0; i < b.length; i++) x = Math.imul(x ^ b[i], 16777619); return `#${b.length}:${x >>> 0}`; }
    return v;
  });
  let x = 2166136261;
  for (let i = 0; i < json.length; i++) x = Math.imul(x ^ json.charCodeAt(i), 16777619);
  return `${json.length}:${(x >>> 0).toString(16)}`;
}

describe('layout version policy and the roll', () => {
  it('a visited mall without a record stays version 1; a recorded version is kept; a new / never-entered mall builds the current (2)', () => {
    expect(MALL_LAYOUT_VERSION).toBe(2);
    expect(mallLayoutVersionFor(undefined)).toBe(2);
    expect(mallLayoutVersionFor({visits: 0, lanes: {}})).toBe(2);
    expect(mallLayoutVersionFor({visits: 3, lanes: {}})).toBe(1);
    expect(mallLayoutVersionFor({visits: 3, lanes: {[MALL_LAYOUT_LANE]: {v: 2}}})).toBe(2);
    expect(mallLayoutVersionFor({visits: 0, lanes: {[MALL_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    for (const bad of [{v: 0}, {v: 9}, {v: 1.5}, {v: '2'}, null]) expect(mallLayoutVersionFor({visits: 2, lanes: {[MALL_LAYOUT_LANE]: bad}})).toBe(1);
  });

  it('a campaign station: an old visited mall keeps version 1, a new one records version 2 on its first build (Game.generateSection)', () => {
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 7, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const oldKey = {level: 'mall' as const, section: 'main', station: 'st-old'}, newKey = {level: 'mall' as const, section: 'main', station: 'st-new'};
    run.memory(oldKey).visits = 2;
    const version = (k: typeof oldKey) => {
      const v = mallLayoutVersionFor(run.peekMemory(k));
      if (run.laneStore(MALL_LAYOUT_LANE, k) === undefined) run.setLaneStore(MALL_LAYOUT_LANE, {v}, k);
      return v;
    };
    expect([version(oldKey), version(newKey)]).toEqual([1, 2]);
    run.memory(newKey).visits++;
    expect([version(oldKey), version(newKey)]).toEqual([1, 2]);
    expect([run.laneStore(MALL_LAYOUT_LANE, oldKey), run.laneStore(MALL_LAYOUT_LANE, newKey)]).toEqual([{v: 1}, {v: 2}]);
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game.ts'), 'utf8');
    expect(src).toMatch(/key\.level === 'mall' && key\.section === 'main' \? mallLayoutVersionFor\(run\.peekMemory\(key\)\)/);
    expect(src).toMatch(/key\.level === 'mall' && key\.section === 'main' \? MALL_LAYOUT_LANE/);
    expect(src).toMatch(/run\.setLaneStore\(versionLane, \{v: layoutVersion\}, key\)/);
  });

  it('version 1 = the atrium roll exactly; version 2: the atrium family ~40 % (its version-1 variant), the plan families evenly', () => {
    const N = 3000, count = new Map<string, number>();
    for (let s = 1; s <= N; s++) {
      const v1 = mallVariantAt(s, 1), v2 = mallVariantAt(s, 2);
      expect(v1).toBe(mallAtriumVariantOf(s));
      if (mallPlanFamilyOf(v2) === 'atrium') expect(v2, `seed ${s}`).toBe(v1);
      count.set(mallPlanFamilyOf(v2), (count.get(mallPlanFamilyOf(v2)) ?? 0) + 1);
    }
    expect((count.get('atrium') ?? 0) / N).toBeGreaterThan(0.36);
    expect((count.get('atrium') ?? 0) / N).toBeLessThan(0.44);
    for (const f of MALL_PLAN_VARIANTS) {
      expect((count.get(f) ?? 0) / N, f).toBeGreaterThan(0.17);
      expect((count.get(f) ?? 0) / N, f).toBeLessThan(0.23);
    }
    // the natural example seeds
    expect(Object.entries(FAMILY_SEEDS).every(([f, s]) => mallVariantAt(s, 2) === f)).toBe(true);
    for (const s of ATRIUM_SEEDS) { expect(MALL_VARIANTS).toContain(mallVariantAt(s, 2)); expect(mallVariantAt(s, 2)).toBe(mallVariantAt(s, 1)); }
  });
});

describe('an atrium seed at version 2 = its version-1 layout + only the window records', () => {
  it('identical core (grids, areas, shops, props, loot, spawns, exits, lights); additions = layout.mall.windows + their virtual daylight', () => {
    for (const s of ATRIUM_SEEDS) {
      const a = gen(s, 1), b = gen(s, 2);
      expect(a.mall!.windows, `seed ${s}: version 1 has no window record`).toBeUndefined();
      const n = a.lights.length, extra = b.lights.slice(n);
      expect(JSON.stringify(b.lights.slice(0, n))).toBe(JSON.stringify(a.lights));
      const bands = new Set((b.mall!.windows ?? []).flatMap(w => w.bands.map(q => q.level)));
      for (const l of extra) expect(l.virtual && JSON.stringify(l.tint) === JSON.stringify(DAYLIGHT) && bands.has(l.level!), `seed ${s}: an added light is window daylight`).toBe(true);
      const core = {...b, lights: b.lights.slice(0, n), mall: {...b.mall!, windows: undefined}};
      expect(layoutHash(core), `seed ${s} (${b.mall!.variant})`).toBe(layoutHash(a));
    }
  }, 120_000);
});

describe('the plan families at natural seeds', () => {
  for (const [family, seed] of Object.entries(FAMILY_SEEDS)) {
    it(`${family} (seed ${seed}): valid; shops, anchors, a food court; every storey pair linked; street exits + the Surface Run door; its signature`, () => {
      const L = gen(seed), m = L.mall!;
      expect(m.variant).toBe(family);
      expect(mallIssues(L)).toEqual([]);
      const fits = m.shops.map(s => shopFit(s)!);
      expect(m.shops.length).toBeGreaterThanOrEqual(22);
      expect(m.shops.length).toBeLessThanOrEqual(36);
      expect(fits.filter(f => f.kind === 'anchor').length).toBeGreaterThanOrEqual(1);
      expect(fits.filter(f => f.kind === 'food').length).toBeGreaterThanOrEqual(2);
      for (let lv = 1; lv < L.levels.length; lv++) expect(m.shops.filter(s => s.level === lv).length, `level ${lv} shops`).toBeGreaterThanOrEqual(6);
      for (let lv = 0; lv + 1 < L.levels.length; lv++) expect(m.verticals.some(v => v.lower === lv && v.upper === lv + 1 && v.kind !== 'service-stair'), `link ${lv}-${lv + 1}`).toBe(true);
      expect((m.exits ?? []).length).toBeGreaterThanOrEqual(1);
      const access = carveMallAccess(L, seed);
      expect(access?.exit && (m.exits ?? []).some(e => e.id === access.exit)).toBe(true);
      const wins = m.windows ?? [];
      expect(wins.some(w => w.kind === 'designed'), 'the designed glazed end').toBe(true);
      if (family === 'promenade') expect(Math.max(...wins.map(w => w.bands.length)), 'the promenade is glazed on every storey').toBe(L.levels.length - 1);
      else {
        // bridge decks across the void (never stacked): floored deck cells on their storey, walkway at both ends
        const decks = m.bridges.filter(b => b.level >= 2);
        expect(decks.length, 'bridge decks').toBeGreaterThanOrEqual(1);
        for (const b of decks) {
          const g = L.levels[b.level].grid;
          let cells = 0;
          for (let i = 0; i < g.cells.length; i++) if (g.area[i] === b.area) { cells++; expect(g.cells[i]).toBe(FLOOR); }
          expect(cells * CELL * CELL, 'deck area').toBeGreaterThan(20);
          expect(b.width).toBeGreaterThanOrEqual(3);
          // the record's centre line: from / to on the deck's edges, a walkway (not the deck) just beyond each end
          const len = Math.hypot(b.to.x - b.from.x, b.to.z - b.from.z), ux = (b.to.x - b.from.x) / len, uz = (b.to.z - b.from.z) / len;
          for (const [p, sgn] of [[b.from, -1], [b.to, 1]] as const) {
            const inner = g.idx(Math.floor((p.x - sgn * ux * 0.25) / CELL), Math.floor((p.z - sgn * uz * 0.25) / CELL));
            const outer = g.idx(Math.floor((p.x + sgn * ux * 0.25) / CELL), Math.floor((p.z + sgn * uz * 0.25) / CELL));
            expect(g.area[inner], 'the record lies on its deck').toBe(b.area);
            expect(g.cells[outer], 'a floor beyond the deck end').toBe(FLOOR);
            expect(g.area[outer], 'a walkway beyond the deck end').not.toBe(b.area);
            expect(L.areas[g.area[outer]].publicSpace).toBe(true);
          }
        }
      }
    }, 60_000);
  }
});

describe('window walls: the generator contract', () => {
  const all = (): [StationLayout, MallWindowWall][] => CONTRACT_SEEDS.flatMap(s => (gen(s).mall!.windows ?? []).map(w => [gen(s), w] as [StationLayout, MallWindowWall]));
  const overlap = (a: {x0: number; z0: number; x1: number; z1: number}, b: {x0: number; z0: number; x1: number; z1: number}, m = 0) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.z0 < b.z1 + m && b.z0 < a.z1 + m;

  it('collider SOLID; the view volume free of every storey (nothing below reaching the lot); heads under the ceiling; walkway in front', () => {
    expect(CONTRACT_SEEDS.map(s => mallPlanFamilyOf(gen(s).mall!.variant as never))).toEqual(['promenade', 'promenade', 'galleria', 'galleria', 'crossroads', 'crossroads']);
    expect(all().length).toBeGreaterThanOrEqual(6);
    for (const [L, w] of all()) {
      const g1 = L.levels[1].grid, W = g1.w, H = g1.h, sg = w.side === 'N' || w.side === 'W' ? -1 : 1, alongX = w.side === 'N' || w.side === 'S';
      for (const {level, cells} of windowColliderCells(L, w)) for (const i of cells) expect(L.levels[level].grid.cells[i], `${w.id} collider L${level}`).toBe(SOLID);
      const x0 = Math.round(w.view.x0 / CELL), x1 = Math.round(w.view.x1 / CELL), z0 = Math.round(w.view.z0 / CELL), z1 = Math.round(w.view.z1 / CELL);
      expect(Math.abs(alongX ? z1 - z0 : x1 - x0) * CELL, `${w.id} view depth`).toBeGreaterThanOrEqual(WINDOW.viewDepth[0] * CELL);
      for (let y = Math.max(0, z0); y < Math.min(H, z1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const i = y * W + x;
        for (const lv of L.levels) {
          const c = lv.grid.cells[i];
          if (lv.id >= 1) expect(c, `${w.id} view L${lv.id}`).toBe(SOLID);
          else if (c !== SOLID) expect(lv.grid.ceil[i], `${w.id} view: the station below stays under the lot`).toBeLessThanOrEqual(w.streetY - WINDOW.slab + 1e-6);
        }
      }
      expect(w.view.y0).toBeLessThan(w.streetY);
      // a free cell round the view's sides / far end (its lot never stands on the mall's own wall face); the plan families' exits too
      const ring = (v: {x0: number; z0: number; x1: number; z1: number}, label: string) => {
        const a0 = Math.round(v.x0 / CELL) - 1, a1 = Math.round(v.x1 / CELL) + 1, b0 = Math.round(v.z0 / CELL) - 1, b1 = Math.round(v.z1 / CELL) + 1;
        for (let y = Math.max(0, b0); y < Math.min(H, b1); y++) for (let x = Math.max(0, a0); x < Math.min(W, a1); x++) {
          if (x > a0 && x < a1 - 1 && y > b0 && y < b1 - 1) continue;
          // (the near face is the facade: the walkway / the exit's hall may lie behind it)
          for (const lv of L.levels) if (lv.id >= 1 && lv.grid.cells[y * W + x] !== SOLID) expect(onNearFace(v, x, y, label), `${label} view ring L${lv.id} at ${x},${y}`).toBe(true);
        }
      };
      const onNearFace = (v: {x0: number; z0: number; x1: number; z1: number}, x: number, y: number, label: string) => {
        const e = label === w.id ? {side: w.side} : (L.mall!.exits ?? []).find(q => q.id === label)!;
        const a0 = Math.round(v.x0 / CELL) - 1, a1 = Math.round(v.x1 / CELL), b0 = Math.round(v.z0 / CELL) - 1, b1 = Math.round(v.z1 / CELL);
        return e.side === 'N' ? y === b1 : e.side === 'S' ? y === b0 : e.side === 'W' ? x === a1 : x === a0;
      };
      ring(w.view, w.id);
      for (const e of L.mall!.exits ?? []) ring(e.view, e.id);
      for (const b of w.bands) {
        const g = L.levels[b.level].grid;
        expect(b.y0).toBeCloseTo(L.levels[b.level].baseY, 3);
        expect(b.y1 - b.y0, `${w.id} L${b.level} glazing height`).toBeGreaterThan(2.5);
        expect(b.y1 - b.y0).toBeLessThanOrEqual(WINDOW.maxBand + 1e-6);
        for (let s = w.s0 + CELL / 2; s < w.s1; s += CELL) for (const d of [0.25, 0.75]) {
          const px = alongX ? s : w.plane - sg * d, pz = alongX ? w.plane - sg * d : s, i = g.idx(Math.floor(px / CELL), Math.floor(pz / CELL));
          expect(g.cells[i], `${w.id} L${b.level} walkway in front at ${s}`).toBe(FLOOR);
          expect(L.areas[g.area[i]].publicSpace, `${w.id} public walkway`).toBe(true);
          if (d === 0.25) expect(b.y1, `${w.id} L${b.level} head under the ceiling`).toBeLessThanOrEqual(g.ceil[i] - WINDOW.headDrop + 1e-6);
        }
      }
    }
  }, 60_000);

  it('clear of the street exits, the glass lift and each other; daylight on every glazed storey', () => {
    for (const [L, w] of all()) {
      const m = L.mall!;
      for (const e of m.exits ?? []) for (const r of [e.collider, e.view]) for (const q of [w.collider, w.view]) expect(overlap(q, r), `${w.id} vs ${e.id}`).toBe(false);
      for (const el of m.elevators) expect(overlap(w.collider, el.shaft, 2), `${w.id} vs the lift`).toBe(false);
      for (const o of m.windows!) if (o !== w) expect(overlap(o.view, w.view) || overlap(o.collider, w.collider), `${w.id} vs ${o.id}`).toBe(false);
      for (const b of w.bands) {
        const mine = L.lights.filter(l => l.virtual && l.level === b.level && JSON.stringify(l.tint) === JSON.stringify(DAYLIGHT)
          && (w.side === 'N' || w.side === 'S' ? l.x >= w.s0 && l.x <= w.s1 && Math.abs(l.z - w.plane) < 1.5 : l.z >= w.s0 && l.z <= w.s1 && Math.abs(l.x - w.plane) < 1.5));
        expect(mine.length, `${w.id} L${b.level} daylight`).toBeGreaterThanOrEqual(2);
        for (const l of mine) expect(l.y).toBeLessThanOrEqual(b.y1);
      }
    }
  });

  it('version 1 never has windows; the window walls add no tower windows / roof air (their panes are the Mall\'s own gas window source)', () => {
    for (const s of ATRIUM_SEEDS) expect(windowWallSpecs(gen(s, 1))).toEqual([]);
    for (const s of Object.values(FAMILY_SEEDS)) {
      const L = gen(s);
      expect(readTowerInfo(L)!.windows.length).toBe(0);
      expect(roofAirOf(L)).toBeNull();
    }
  });
});

describe('window walls: the render on a real build (promenade, seed 2)', () => {
  const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  let world: BuiltWorld | null = null;
  const L = () => gen(FAMILY_SEEDS.promenade);
  const fw = (): BuiltWorld => (world ??= buildWorld(L(), mats(), {}));
  const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
  const winMeshes = (w: BuiltWorld) => meshes(w.group).filter(m => m.name.startsWith('mall-window-'));
  const culled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === ((1 << CULL_LAYER) >>> 0);
  const verts = (q: THREE.Mesh): THREE.Vector3[] => {
    q.updateMatrixWorld(true);
    const P = q.geometry.attributes.position, out: THREE.Vector3[] = [];
    for (let i = 0; i < P.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(q.matrixWorld));
    return out;
  };

  it('three meshes per wall on the street exits\' materials (the panes are the runtime\'s), tagged with the glazed storeys + aperture; bounded cost', () => {
    const w = fw(), wins = L().mall!.windows!;
    expect(w.mallArch!.stats.windowWalls).toBe(wins.length);
    const exitMats = new Set(streetExitMaterials());
    for (const r of wins) {
      const mine = winMeshes(w).filter(m => m.userData.windowWall === r.id);
      // (no model record here: no car drawn; the cooked wrecks: tests/mall-vehicles.test.ts)
      expect(mine.map(m => m.name.replace(`mall-window-${r.id}-`, '')).sort()).toEqual(['fog', 'frame', 'lot']);
      for (const m of mine) {
        expect(m.userData.levels).toEqual(r.bands.map(b => b.level));
        const a = m.userData.aperture as {s0: number; s1: number; y0: number; y1: number};
        expect([a.s0, a.s1, a.y0, a.y1].every(Number.isFinite) && a.s1 > a.s0 && a.y1 > a.y0).toBe(true);
        expect(exitMats.has(m.material as THREE.Material), `${m.name} material`).toBe(true);
        expect(m.castShadow).toBe(false);
      }
    }
    for (const c of w.mallArch!.stats.windowCost) {
      expect(c.meshes).toBe(3);
      expect(c.stalls, `${c.id} stalls`).toBeGreaterThan(10);
      expect(c.carSpots, `${c.id} car spots`).toBeGreaterThan(3);
      expect(c.cars).toBe(0); // (no model loaded)
      expect(c.triangles, `${c.id} triangles`).toBeLessThan(60_000);
    }
  }, 120_000);

  it('the lot stays inside the view volume, under the roof deck and off every open cell; no glass of its own; each storey\'s wall carries the cut', () => {
    const w = fw(), layout = L(), specs = w.mallArch!.windowWalls(), g0 = layout.levels[0].grid;
    for (const r of layout.mall!.windows!) {
      const s = specs.find(q => q.id === r.id)!, mine = winMeshes(w).filter(m => m.userData.windowWall === r.id);
      for (const m of mine.filter(q => /-(lot|fog)$/.test(q.name))) for (const q of verts(m)) {
        expect(q.x >= r.view.x0 - 0.06 && q.x <= r.view.x1 + 0.06 && q.z >= r.view.z0 - 0.06 && q.z <= r.view.z1 + 0.06, `${m.name} in view`).toBe(true);
        expect(q.y, `${m.name} above the view floor`).toBeGreaterThanOrEqual(r.view.y0 - 1e-6);
        expect(q.y, `${m.name} under the roof deck`).toBeLessThanOrEqual(Math.min(s.capY, r.view.y1) + 1e-6);
        const cx = Math.floor(q.x / CELL), cz = Math.floor(q.z / CELL);
        if (cx < 0 || cz < 0 || cx >= g0.w || cz >= g0.h) continue;
        for (const lv of layout.levels) {
          const i = cz * g0.w + cx, c = lv.grid.cells[i];
          if (c === FLOOR || c === VOID) expect(q.y < lv.grid.floorOf(i) - 0.05 || q.y > lv.grid.ceil[i] + 0.05, `${m.name} inside an open cell of L${lv.id}`).toBe(true);
        }
      }
      // the panes (in the collider: visual = collision) are world/mallWindowPanes.ts's breakable runtime glass: tests/mall-window-gas.test.ts
      expect(mine.some(m => /glass/.test(m.name)), `${r.id}: no static glass`).toBe(false);
      const alongX = r.side === 'N' || r.side === 'S';
      for (const b of r.bands) {
        const fs = w.wallFaces.filter(f => f.level === b.level && (alongX ? Math.abs(f.z0 - r.plane) < 1e-6 && Math.abs(f.z1 - r.plane) < 1e-6 : Math.abs(f.x0 - r.plane) < 1e-6 && Math.abs(f.x1 - r.plane) < 1e-6));
        expect(fs.some(f => f.openings.some(o => o.top >= Math.min(b.y1, f.y1) - 1e-6)), `${r.id} L${b.level}: the glazing is cut`).toBe(true);
      }
    }
  }, 120_000);

  it('culling: drawn from the glass with the lot in view; nothing visible is culled from the glass / platform / court; not submitted facing away', () => {
    const w = fw(), layout = L();
    w.culler.maxDistance = Math.min(Math.sqrt(-Math.log(0.002)) / MALL_FOG.density, MALL_FOG.far);
    const eye = (p: {x: number; y: number; z: number; yaw: number; pitch: number}, turn = 0) => {
      const c = new THREE.PerspectiveCamera(75, 960 / 540, 0.05, MALL_FOG.far);
      c.position.set(p.x, p.y + 1.62, p.z); c.rotation.set(turn ? 0 : p.pitch, p.yaw + turn, 0, 'YXZ'); c.updateMatrixWorld(true); c.updateProjectionMatrix();
      return c;
    };
    const check = (c: THREE.PerspectiveCamera, label: string) => {
      w.culler.update(c, true);
      const vis = visibleMeshes(w.group, c, 128, 72, {minPx: 1});
      expect([...vis].filter(([m]) => culled(m)).map(([m, n]) => `${m.name} ${n}px`), `${label}: visible but culled`).toEqual([]);
      return vis;
    };
    for (const [k, r] of layout.mall!.windows!.entries()) {
      const p = mallQaPose(layout, 'window-wall', k)!;
      expect(p, `${r.id} pose`).not.toBeNull();
      expect(p.level).toBe(r.bands[r.bands.length - 1].level);
      const mine = winMeshes(w).filter(m => m.userData.windowWall === r.id);
      const vis = check(eye(p), `${r.id} at the glass`);
      expect(mine.every(m => !culled(m)), `${r.id}: drawn`).toBe(true);
      expect(vis.get(mine.find(m => m.name.endsWith('-lot'))!) ?? 0, `${r.id}: lot pixels`).toBeGreaterThan(200);
      check(eye(p, Math.PI), `${r.id} facing away`);
      expect(mine.every(culled), `${r.id} facing away: not submitted`).toBe(true);
    }
    for (const name of ['platform-lookup', 'court'] as const) check(eye(mallQaPose(layout, name)!), name);
    expect(mallQaPose(gen(ATRIUM_SEEDS[0], 1), 'window-wall')).toBeNull();
  }, 120_000);
});
