// Task track3-eaton-centre-20261031 (lane ARCH): The Eaton's Center architecture — finishes, atrium, atrium engine support.
//  - program -> finish mapping: distinct per program, never the station's tile / painted block or the office's plasterboard,
//    bounded material count (6 surface materials, one program per kind; finish rows per vertex), warm-up coverage;
//  - the glass roof: transparent, never a flashlight shadow caster, no opaque ceiling over the void (the vault instead);
//  - glass balustrades on EVERY void edge of every ring (exactly GEN's collision rails), columns outboard, the glass shaft tower;
//  - atrium culling: from the platform every ring and the roof are drawn (depth-buffered oracle: no visible mesh culled), back of
//    house deeper than the portal margin stays hidden when seen from another storey, the void is unseen from a corridor facing
//    away; bounded sight tests;
//  - light field: daylight through the roof reaches the plaza (mostly from above), top rings brighter than bottom rings, a
//    back-of-house corridor 16 m from the void gets none, slabs never leak; slots / bands within the engine limits;
//  - the TSL graphs build cleanly on both backends (WGSL / GLSL);
//  - the REAL generated mall (GEN, seed 12345 galleria): finishes per program, balustrades, render cost (draw calls / triangles);
//  - old levels unchanged: the Subway and the Office never reach the mall paths (no mall meshes / attributes / atrium tiles; the
//    light-field bytes are identical with the mall sky hook spread in).
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {buildBoth} from './helpers/tslShaders';
import {visibleMeshes} from './helpers/visibleMeshes';
import {MALL_FIX, mallFixture, mallY} from './helpers/mallFixture';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {generateStation, type StationLayout} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {generateMallLevel} from '../src/gen/mall/index';
import {bakeLightField, sampleField, type BakedField} from '../src/world/lightField';
import {stationLevels} from '../src/world/levelGeometry';
import {ATRIUM_MARGIN, ATRIUM_SIGHT_TESTS, CULL_LAYER} from '../src/world/levelCulling';
import {markShadows} from '../src/render/volumetric';
import {planWarmup} from '../src/render/warmup';
import {
  FLOOR as FLOOR_CODE, GALLERY_FLOOR, PLAZA_FLOOR, PROGRAM_FINISH, SPACE_FINISH, WALL, bohClass, finishSignature, stockFinish,
} from '../src/world/mallFinishes';
import {MALL_FINISH_ATTR, MALL_TABLE_ROWS, mallSurfaceMaterial, mallTableData} from '../src/world/mallSurfaces';
import {MALL_SURFACE_MATERIALS, mallDressMaterials, packAtlas, splitFinishKey} from '../src/world/mallArch';
import {SKY, bakeSkylight, mallSkyField} from '../src/world/mallSkylight';
import {MALL_FOG, MallAtmosphere, fogTransmittance, mallQaPoses} from '../src/world/mallAtmosphere';
import {MOOD} from '../src/world/lights';
import {treatmentOf} from '../src/world/wallDetailPlan';
import type {MallProgram} from '../src/gen/mall/mallTypes';
import {readTowerInfo} from '../src/world/towerShared';
import {buildElevatorView, planElevator} from '../src/world/elevator';

installCanvasShim(false);

const PROGRAMS = Object.keys(PROGRAM_FINISH) as MallProgram[];
const STATION_WALLS = ['tileLower', 'tileUpper', 'tileBase', 'paint', 'tileShop'];
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const F = mallFixture();
let fixtureWorld: BuiltWorld | null = null;
const fw = (): BuiltWorld => (fixtureWorld ??= buildWorld(F.layout, mats(), {}));
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const matOf = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
const row = (r: number, k: number) => Array.from(mallTableData().subarray((r * 4 + k) * 4, (r * 4 + k) * 4 + 4));
const cam = (pos: [number, number, number], target: [number, number, number]): THREE.PerspectiveCamera => {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, MALL_FOG.far);
  c.position.set(...pos);
  c.lookAt(...target);
  c.updateMatrixWorld(true);
  return c;
};
const culled = (m: THREE.Object3D) => (m.layers.mask >>> 0) === ((1 << CULL_LAYER) >>> 0);

describe('mall finishes: program -> finish mapping (pure data)', () => {
  it('every program has a distinct wall + floor signature; wall and floor patterns and colours differ between programs', () => {
    const sigs = new Map<string, MallProgram>();
    for (const p of PROGRAMS) {
      const s = finishSignature(PROGRAM_FINISH[p]);
      expect(sigs.has(s), `${p} shares its finish with ${sigs.get(s)}`).toBe(false);
      sigs.set(s, p);
    }
    // floors: pattern + base colour distinct per program (no two shops on the same floor)
    const floors = new Set(PROGRAMS.map(p => `${PROGRAM_FINISH[p].floor.code}:${PROGRAM_FINISH[p].floor.a}`));
    expect(floors.size).toBe(PROGRAMS.length);
    // walls: the (upper pattern, upper colour, lower pattern, lower colour) quadruple distinct per program
    const walls = new Set(PROGRAMS.map(p => { const w = PROGRAM_FINISH[p].wall; return `${w.upper}:${w.upperColor}:${w.lower}:${w.lowerColor}`; }));
    expect(walls.size).toBe(PROGRAMS.length);
    // at least 8 different wall patterns and 7 floor patterns across the programs (not one wall recoloured)
    expect(new Set(PROGRAMS.flatMap(p => [PROGRAM_FINISH[p].wall.upper, PROGRAM_FINISH[p].wall.lower])).size).toBeGreaterThanOrEqual(8);
    expect(new Set(PROGRAMS.map(p => PROGRAM_FINISH[p].floor.code)).size).toBeGreaterThanOrEqual(7);
    // the brief's examples
    expect(PROGRAM_FINISH.guns.wall.upper).toBe(WALL.concrete);
    expect(PROGRAM_FINISH.guns.wall.lower).toBe(WALL.plank);
    expect(PROGRAM_FINISH.pharmacy.floor.code).toBe(FLOOR_CODE.vinyl);
    expect(PROGRAM_FINISH['food-court'].floor.code).toBe(FLOOR_CODE.checker);
    expect(PROGRAM_FINISH.clothing.floor.code).toBe(FLOOR_CODE.plank);
    expect(PROGRAM_FINISH.books.wall.lower).toBe(WALL.plank);
    expect(PLAZA_FLOOR.code).toBe(FLOOR_CODE.rings);
    // galleries: a distinct terrazzo palette per ring
    expect(new Set(GALLERY_FLOOR.slice(1).map(f => f.a)).size).toBe(6);
  });

  it('back-of-house classes and stock rooms take the brand accent; the wall-detail pass never gives mall walls a station treatment', () => {
    expect(bohClass({type: 'storage', label: 'Service corridor'})).toBe('corridor');
    expect(bohClass({type: 'stair-core', label: 'Service stair'})).toBe('core');
    expect(bohClass({type: 'washroom', label: 'Washroom'})).toBe('wash');
    expect(bohClass({label: 'Loading dock'})).toBe('plant');
    expect(bohClass({label: 'Stock room'})).toBe('stock');
    expect(stockFinish('guns').wall.trim).toBe(PROGRAM_FINISH.guns.wall.trim);
    expect(stockFinish('guns').wall.lowerColor).not.toBe(stockFinish('pharmacy').wall.lowerColor);
    expect(treatmentOf({zone: 'shop', finish: 'mall-wall|3'})).toBe('mallWall');
    expect(treatmentOf({zone: 'service', finish: 'mall-wall-boh|9'})).toBe('mallService');
    expect(splitFinishKey('mall-floor-boh|17')).toEqual({base: 'mall-floor-boh', row: 17});
    expect(splitFinishKey('terrazzo')).toEqual({base: 'terrazzo', row: -1});
  });
});

describe('mall build (synthetic multi-storey void fixture): finishes resolve per space', () => {
  it('shop walls / floors take their program finish rows; corridors are back of house; nothing uses the station or office walls', () => {
    const w = fw();
    expect(w.mallArch).toBeTruthy();
    expect(w.officeArch).toBeUndefined();
    const arch = w.mallArch!;
    const shopOf = new Map(F.shops.map(s => [s.area, s]));
    let shopFaces = 0, corridorFaces = 0, galleryFaces = 0, fascias = 0;
    const rowsByProgram = new Map<MallProgram, Set<number>>();
    for (const f of w.wallFaces) {
      if (f.level === 0 && !f.finish.startsWith('mall-')) continue; // station storey outside the atrium: subway finishes
      expect(f.finish.startsWith('mall-'), `face L${f.level} area ${f.area} finish ${f.finish}`).toBe(true);
      expect(STATION_WALLS.includes(f.finish)).toBe(false);
      expect(f.finish.startsWith('office-')).toBe(false);
      const {base, row: r} = splitFinishKey(f.finish);
      const shop = shopOf.get(f.area);
      if (shop && !f.slope) {
        shopFaces++;
        expect(base).toBe('mall-wall');
        const want = PROGRAM_FINISH[shop.program].wall;
        expect(row(r, 0)[3]).toBe(want.upper);
        expect(row(r, 1)[3]).toBe(want.lower);
        (rowsByProgram.get(shop.program) ?? rowsByProgram.set(shop.program, new Set()).get(shop.program)!).add(r);
      } else if (F.corridors.flat().includes(f.area)) { corridorFaces++; expect(base).toMatch(/^mall-wall-boh(~d[NSEW])?$/); }
      else if (F.gallery.includes(f.area)) galleryFaces++;
      if (row(r, 0)[3] === WALL.fascia) {
        fascias++;
        expect(f.level).toBe(0);
        expect(f.y1).toBeLessThanOrEqual(MALL_FIX.spring + 0.051);
      }
    }
    expect(shopFaces).toBeGreaterThan(100);
    expect(corridorFaces).toBeGreaterThan(10);
    expect(galleryFaces).toBeGreaterThan(10);
    expect(fascias, 'the void slab edges are white fascias').toBeGreaterThan(20);
    // one row per program: programs never share a wall row
    const all = [...rowsByProgram.values()].map(s => [...s]);
    expect(new Set(all.flat()).size).toBe(all.reduce((n, s) => n + s.length, 0));
    expect(rowsByProgram.size).toBe(new Set(F.shops.map(s => s.program)).size);
    expect(arch.summary().rows).toBeLessThan(MALL_TABLE_ROWS);
  });

  it('floors: plaza rings at the pit bottom (not on the track bed), ring-tinted gallery terrazzo, the program floor in every shop', () => {
    const w = fw();
    const arch = w.mallArch!;
    const L0 = F.levels[0];
    // the plaza court cell outside the void, a platform cell, a track-bed cell
    const cell = (x: number, z: number) => Math.floor(z / CELL) * L0.grid.w + Math.floor(x / CELL);
    const plaza = arch.floorKey(0, cell(10, 15));
    expect(plaza).toMatch(/^mall-floor\|/);
    expect(row(splitFinishKey(plaza!).row, 0)[3]).toBe(FLOOR_CODE.rings);
    expect(arch.floorKey(0, cell(30, 36))).toBeNull(); // track bed (VOID): ballast stays
    // galleries differ per ring
    const g1 = arch.floorKey(1, cell(18, 22)), g6 = arch.floorKey(6, cell(18, 22));
    expect(g1).not.toBe(g6);
    expect(row(splitFinishKey(g1!).row, 0)[3]).toBe(FLOOR_CODE.terrazzo);
    // a shop's floor is its program's
    const s = F.shops.find(q => q.program === 'food-court')!;
    const a = F.layout.areas[s.area];
    const k = arch.floorKey(s.level, (a.y + 2) * L0.grid.w + a.x + 2);
    expect(row(splitFinishKey(k!).row, 0)[3]).toBe(FLOOR_CODE.checker);
    // the corridor floor is back of house
    const c = F.layout.areas[F.corridors[0][0]];
    expect(arch.floorKey(1, (c.y + 1) * L0.grid.w + c.x + 5)).toMatch(/^mall-floor-boh(~d[NSEW])?\|/);
  });

  it('every mall surface mesh carries one finish row per vertex; at most 6 surface materials (shared programs) and a bounded material count', () => {
    const w = fw();
    const surf = new Set<THREE.Material>(), all = new Set<THREE.Material>();
    for (const m of meshes(w.group)) {
      const mat = matOf(m);
      all.add(mat);
      if (!(mat as {isMallSurface?: boolean}).isMallSurface) continue;
      surf.add(mat);
      const a = m.geometry.getAttribute(MALL_FINISH_ATTR);
      expect(a, m.name).toBeTruthy();
      expect(a.count).toBe(m.geometry.attributes.position.count);
      for (let i = 0; i < a.count; i++) { const v = a.getX(i); expect(v >= 0 && v < MALL_TABLE_ROWS && Number.isInteger(v)).toBe(true); }
    }
    expect(surf.size).toBeLessThanOrEqual(MALL_SURFACE_MATERIALS);
    expect(surf.size).toBeGreaterThanOrEqual(5);
    // mall-specific materials in the scene: surfaces + dressing + sign atlas page(s) + banners (bounded, whatever the shop count)
    const mallMats = [...all].filter(m => m.name.startsWith('mall-'));
    expect(mallMats.length).toBeLessThanOrEqual(32);
    // ring storeys never draw the station's tile / painted block architecture
    const stationKeys = new Set(STATION_WALLS.map(k => { try { return (mats() as WorldMaterials).get(k as never).name; } catch { return k; } }));
    for (const m of meshes(w.group)) if (m.name.startsWith('arch-') && (m.userData.level ?? 0) > 0) expect(stationKeys.has(matOf(m).name), m.name).toBe(false);
  });
});

describe('mall atrium: glass roof, balustrades, columns, shaft', () => {
  it('the roof glazing is transparent, never casts the flashlight shadow, and no opaque ceiling covers the void', () => {
    const w = fw();
    const glass = meshes(w.group).find(m => m.name === 'mall-roof-glass')!;
    expect(glass).toBeTruthy();
    const gm = matOf(glass);
    expect(gm.transparent).toBe(true);
    expect(gm.depthWrite).toBe(false);
    markShadows(w.group, true, true);
    expect(glass.castShadow).toBe(false);
    expect(meshes(w.group).find(m => m.name === 'mall-roof-steel')!.castShadow).toBe(true);
    for (const m of meshes(w.group).filter(q => q.name.startsWith('mall-glass') || matOf(q).name.startsWith('mall-glass'))) expect(m.castShadow).toBe(false);
    // no arch ceiling triangle over the void interior at / above the springing line
    const v = MALL_FIX.void;
    let over = 0, ceilTris = 0;
    for (const m of meshes(w.group)) {
      if (!/ceil|arch-/.test(m.name) || (m as THREE.InstancedMesh).isInstancedMesh) continue;
      const P = m.geometry.attributes.position, N = m.geometry.attributes.normal, idx = m.geometry.index;
      if (!N) continue;
      const n = idx ? idx.count : P.count;
      for (let t = 0; t < n; t += 3) {
        const ia = idx ? idx.getX(t) : t;
        if (N.getY(ia) > -0.9) continue; // downward-facing only
        ceilTris++;
        const cx = (P.getX(ia) + P.getX(idx ? idx.getX(t + 1) : t + 1) + P.getX(idx ? idx.getX(t + 2) : t + 2)) / 3;
        const cz = (P.getZ(ia) + P.getZ(idx ? idx.getX(t + 1) : t + 1) + P.getZ(idx ? idx.getX(t + 2) : t + 2)) / 3;
        if (cx > v.x0 + 0.3 && cx < v.x1 - 0.3 && cz > v.z0 + 0.3 && cz < v.z1 - 0.3 && P.getY(ia) >= MALL_FIX.spring - 0.5) over++;
      }
    }
    expect(ceilTris).toBeGreaterThan(100);
    expect(over).toBe(0);
    const st = w.mallArch!.stats;
    expect(st.roofPanes).toBeGreaterThan(30);
    expect(st.arches).toBeGreaterThanOrEqual(5);
  });

  it('a glass balustrade covers EVERY void edge of every ring (the collision rails, all drawn), plus the bridge sides', () => {
    const w = fw();
    const owned = w.rails.filter(r => r.level !== 0);
    const len = owned.reduce((s, r) => s + Math.hypot(r.x1 - r.x0, r.z1 - r.z0), 0);
    expect(w.mallArch!.stats.balustradeM).toBeCloseTo(len, 3);
    // every gallery cell edge facing a void cell (closed on that ring, a void column below) is on a rail run of that ring
    const g0 = F.levels[0].grid, Wd = g0.w;
    for (let L = 1; L <= MALL_FIX.rings; L++) {
      const g = F.levels[L].grid;
      let edges = 0, covered = 0;
      for (let i = 0; i < Wd * g0.h; i++) {
        if (g.cells[i] !== FLOOR) continue;
        const x = i % Wd, y = (i - x) / Wd;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (y + dy) * Wd + x + dx;
          if (g.cells[j] !== SOLID || g0.cells[j] === SOLID || g0.ceil[j] < MALL_FIX.spring) continue; // not a void neighbour
          if (w.mallArch!.atrium[j] !== 1) continue;
          edges++;
          // edge midpoint
          const ex = (x + 0.5 + dx * 0.5) * CELL, ez = (y + 0.5 + dy * 0.5) * CELL;
          if (owned.some(r => r.level === L && Math.abs(dx ? r.x0 - ex : r.z0 - ez) < 0.12 && Math.abs(dx ? r.x1 - ex : r.z1 - ez) < 0.12
            && (dx ? Math.min(r.z0, r.z1) - 0.01 <= ez && Math.max(r.z0, r.z1) + 0.01 >= ez : Math.min(r.x0, r.x1) - 0.01 <= ex && Math.max(r.x0, r.x1) + 0.01 >= ex))) covered++;
        }
      }
      expect(edges, `ring ${L} void edges`).toBeGreaterThan(100);
      expect(covered, `ring ${L}: every void edge railed`).toBe(edges);
      const glass = meshes(w.group).filter(m => m.name.startsWith('mall-balustrade-glass') && m.userData.level === L);
      expect(glass.length, `ring ${L} glass`).toBeGreaterThan(0);
    }
  });

  it('columns stand outboard in clear void columns; the glass shaft tower replaces the atrium-facing shaft walls; signage and banners exist', () => {
    const w = fw();
    const st = w.mallArch!.stats;
    expect(st.columns).toBeGreaterThanOrEqual(4);
    expect(st.droppedFaces).toBeGreaterThan(0);
    expect(st.shaftPanels).toBeGreaterThan(0);
    expect(st.signs).toBe(F.shops.length);
    expect(st.labels).toBeGreaterThan(0);
    expect(st.banners).toBeGreaterThan(0);
    // one sign atlas page for the fixture's 72 shops (brand fascias, blades, level labels)
    expect(meshes(w.group).filter(m => m.name.startsWith('mall-sign-faces')).length).toBeLessThanOrEqual(2);
    const {pages} = packAtlas([...Array(80)].map(() => ({width: 768, height: 120})).concat([...Array(80)].map(() => ({width: 128, height: 128}))));
    expect(pages.length).toBeLessThanOrEqual(3);
    // every ring downlight can is instanced per storey; no tube fixture model on the rings
    expect(st.downlights).toBe(F.layout.lights.filter(l => (l.level ?? 0) > 0).length);
  });
});

describe('mall atrium engine: view-dependent culling through the void', () => {
  it('from the platform every ring and the roof render (no visible mesh culled); back of house far from the void is hidden', () => {
    const w = fw();
    const c = cam([MALL_FIX.start.x, 1.6, MALL_FIX.start.z], [36, 30, MALL_FIX.start.z + 0.5]);
    w.culler.update(c, true);
    const st = w.culler.atriumStats;
    expect(st.seen).toBe(true);
    expect(st.sightTests).toBeLessThanOrEqual(ATRIUM_SIGHT_TESTS);
    expect([...w.culler.stats.visibleLevels].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const vis = visibleMeshes(w.group, c, 96, 54, {minPx: 2});
    const bad = [...vis].filter(([m]) => culled(m)).map(([m, n]) => `${m.name} L${m.userData.level} ${n}px`);
    expect(bad, 'visible but culled').toEqual([]);
    expect([...vis.keys()].some(m => m.name === 'mall-roof-glass' || m.name === 'mall-roof-steel')).toBe(true);
    // back-of-house meshes of rings 2..6 deeper than ATRIUM_MARGIN from the void (the service corridors) are culled from the platform
    const boh = meshes(w.group).filter(m => /mall-arch-(wall|floor|ceil)-boh/.test(m.name) && (m.userData.level ?? 0) >= 2);
    expect(boh.length).toBeGreaterThan(10);
    const far = boh.filter(m => { const b = new THREE.Box3().setFromObject(m); return b.max.z < MALL_FIX.void.z0 - ATRIUM_MARGIN || b.min.z > MALL_FIX.void.z1 + ATRIUM_MARGIN; });
    expect(far.every(m => m.name.endsWith('-deep')), 'deep back of house has its own meshes').toBe(true);
    expect(far.length).toBeGreaterThan(5);
    expect(far.filter(m => !culled(m)).map(m => m.name)).toEqual([]);
  });

  it('from gallery edges on rings 1, 3 and 6 and from the bridge: the other rings across the void render, nothing visible is culled', () => {
    const w = fw();
    for (const [L, pos, target] of [
      [1, [26, mallY(1) + 1.6, 22.5], [36, mallY(1) - 2, 36]], [1, [26, mallY(1) + 1.6, 22.5], [36, mallY(1) + 4, 44]], [3, [44, mallY(3) + 1.6, 42], [30, mallY(3) + 8, 26]],
      [6, [18, mallY(6) + 1.6, 32], [45, mallY(6) - 10, 32]], [3, [35, mallY(3) + 1.6, 28], [35, mallY(3) - 6, 39]],
    ] as [number, [number, number, number], [number, number, number]][]) {
      const c = cam(pos, target);
      w.culler.update(c, true);
      expect(w.culler.atriumStats.seen, `L${L} ${pos}`).toBe(true);
      expect(w.culler.stats.visibleLevels.length, `L${L} ${pos}`).toBe(7);
      const vis = visibleMeshes(w.group, c, 96, 54, {minPx: 2});
      const bad = [...vis].filter(([m]) => culled(m)).map(([m, n]) => `${m.name} L${m.userData.level} ${n}px`);
      expect(bad, `L${L} ${pos}`).toEqual([]);
    }
  });

  it('in a back-of-house corridor facing away from the void the atrium is unseen and other storeys are culled', () => {
    const w = fw();
    const c = cam([30, mallY(4) + 1.6, 1.5], [30, mallY(4) + 1.6, -10]);
    w.culler.update(c, true);
    expect(w.culler.atriumStats.seen).toBe(false);
    expect(w.culler.stats.visibleLevels).toEqual([4]);
    const r1 = meshes(w.group).filter(m => m.userData.level === 1 && m.name.startsWith('mall-arch'));
    expect(r1.length).toBeGreaterThan(0);
    expect(r1.every(culled)).toBe(true);
    const vis = visibleMeshes(w.group, c, 96, 54, {minPx: 2});
    expect([...vis].filter(([m]) => culled(m)).map(([m]) => m.name)).toEqual([]);
  });
});

describe('mall atrium engine: daylight through the glass roof (light field)', () => {
  let withSky: BakedField | null = null, noSky: BakedField | null = null;
  const bake = (sky: boolean): BakedField => bakeLightField({grid: F.layout.grid, lights: F.layout.lights, trenchFloorY: MALL_FIX.bedY, levels: stationLevels(F.layout), ...(sky ? mallSkyField(F.layout, CELL) : {})});
  const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const irr = (f: BakedField, x: number, y: number, z: number, n: [number, number, number] = [0, 1, 0]) => { const s = sampleField(f, x, y, z, [1, 1, 1], n); return lum(s.amb) + lum(s.dirColor) * Math.max(0, s.dir[0] * n[0] + s.dir[1] * n[1] + s.dir[2] * n[2]); };

  it('reaches the plaza (mostly from above), more on the top rings than the bottom, none in a corridor 16 m away; within the engine limits', () => {
    withSky ??= bake(true); noSky ??= bake(false);
    expect(withSky.slots).toBe(7);
    expect(withSky.stats.bands!).toBeLessThanOrEqual(12);
    expect(withSky.stats.cut).toBe(0);
    const ex = withSky.stats.extra!;
    expect(ex.skyCols).toBeGreaterThan(1000);
    // the platform under the void: daylight from above
    const pz = MALL_FIX.start.z;
    const plat = irr(withSky, 32, 0.15, pz) - irr(noSky, 32, 0.15, pz);
    expect(plat, 'plaza daylight').toBeGreaterThan(0.8);
    const s = sampleField(withSky, 32, 0.15, pz, [1, 1, 1], [0, 1, 0]);
    expect(s.dir[1], 'light comes from above').toBeGreaterThan(0.85);
    // galleries 1.5 m from the void edge: the top ring gets more daylight than the bottom ring
    const gz = MALL_FIX.void.z0 - 1.8;
    const gal = (L: number) => irr(withSky!, 30, mallY(L) + 0.1, gz) - irr(noSky!, 30, mallY(L) + 0.1, gz);
    expect(gal(6)).toBeGreaterThan(gal(1));
    expect(gal(1)).toBeGreaterThan(0.02);
    // the back-of-house corridor (21.5 m beyond the void edge, walls between) gets none
    for (const L of [1, 3, 6]) expect(Math.abs(irr(withSky, 30, mallY(L) + 0.1, 1.5) - irr(noSky, 30, mallY(L) + 0.1, 1.5)), `corridor L${L}`).toBeLessThan(1e-3);
    // a slab never leaks: under the ring-1 gallery slab at the plaza (outside the void) far less than under the void
    const court = irr(withSky, 30, 0.15, 15) - irr(noSky, 30, 0.15, 15);
    expect(court).toBeLessThan(plat * 0.5);
  });

  it('the bake is deterministic and bounded (receivers within reach, block-shared evaluation)', () => {
    withSky ??= bake(true);
    const again = bake(true);
    expect(Buffer.from(again.data).equals(Buffer.from(withSky.data))).toBe(true);
    const ex = withSky.stats.extra!;
    expect(ex.voxels).toBeLessThan(ex.receivers * 4);
    expect(SKY.reach).toBeLessThanOrEqual(14);
    // a mall with no glazing adds nothing
    const empty = bakeSkylight({W: 4, H: 4, cell: CELL, slots: [], layers: [], E: [], D: [], EL: [], bands: {start: new Int32Array(17), f: new Float32Array(0), c: new Float32Array(0)}}, {roofY: 30, glazed: new Uint8Array(16)});
    expect(empty.skyCols).toBe(0);
  });
});

describe('mall atmosphere, QA poses, warm-up and shader builds', () => {
  it('the mall haze keeps the roof and the far galleries in view; three QA poses exist on the fixture', () => {
    expect(fogTransmittance(36)).toBeGreaterThan(0.75);
    expect(fogTransmittance(100)).toBeGreaterThan(0.2);
    expect(fogTransmittance(36, 0.043)).toBeLessThan(0.1); // the subway fog would hide the roof
    const poses = mallQaPoses(F.layout);
    expect(poses.map(p => p.name.split('-')[0])).toEqual(['platform', 'gallery', 'shop']);
  });

  it('the atmosphere hook applies the mall haze / far plane / culler distance on a mall build and restores the indoor values', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(MOOD.fogColor, MOOD.fogDensity);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
    const host = {scene, camera, sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], world: {culler: {maxDistance: 60}}};
    const atm = new MallAtmosphere(host);
    host.sectionHooks[0].build!(F.layout);
    expect((scene.fog as THREE.FogExp2).density).toBe(MALL_FOG.density);
    expect(camera.far).toBe(MALL_FOG.far);
    expect(host.world.culler.maxDistance).toBeGreaterThan(200);
    host.sectionHooks[0].teardown!();
    expect((scene.fog as THREE.FogExp2).density).toBe(MOOD.fogDensity);
    expect((scene.fog as THREE.FogExp2).color.getHex()).toBe(MOOD.fogColor);
    expect(camera.far).toBe(70);
    // a non-mall build never touches the values
    host.sectionHooks[0].build!(generateStation(4242));
    expect((scene.fog as THREE.FogExp2).density).toBe(MOOD.fogDensity);
    expect(atm.active).toBe(false);
  });

  it('the warm-up plans every material of the mall scene (culled meshes included)', () => {
    const w = fw();
    w.culler.update(cam([30, mallY(4) + 1.6, 1.5], [30, mallY(4) + 1.6, -10]), true); // most of the mall culled now
    const c = new THREE.PerspectiveCamera();
    const plan = planWarmup(w.group, {mode: 'full', cameraMask: c.layers.mask});
    const planned = new Set(plan.items.map(i => matOf(i.object as THREE.Mesh)));
    const missing = new Set<string>();
    for (const m of meshes(w.group)) if (!planned.has(matOf(m))) {
      // covered when another object with the same material + geometry layout is a representative (same three cache key)
      const same = plan.items.some(i => matOf(i.object as THREE.Mesh) === matOf(m));
      if (!same) missing.add(matOf(m).name || matOf(m).type);
    }
    expect([...missing]).toEqual([]);
    const names = new Set([...planned].map(m => m.name));
    for (const n of ['mall-wall', 'mall-floor', 'mall-ceiling', 'mall-glass-roof', 'mall-glass-rail', 'mall-white-steel', 'mall-sky']) expect(names.has(n), n).toBe(true);
  });

  it('every mall TSL graph builds cleanly on WGSL and GLSL (surface kinds with the finish attribute, glass, sky)', () => {
    const lights = () => [new THREE.SpotLight(0xffffff, 1)];
    const geo = () => { const g = new THREE.PlaneGeometry(1, 1); g.setAttribute(MALL_FINISH_ATTR, new THREE.Float32BufferAttribute(new Float32Array(4).fill(3), 1)); return g; };
    for (const [k, boh] of [['wall', false], ['floor', true], ['ceiling', false]] as const) {
      for (const sh of buildBoth(new THREE.Mesh(geo(), mallSurfaceMaterial(k, boh)), {lights: lights()})) {
        expect(sh.errors, `${k} ${sh.backend}`).toEqual([]);
        expect(sh.fragment.length).toBeGreaterThan(1000);
      }
    }
    const d = mallDressMaterials(mats());
    for (const m of [d.glassRoof, d.glassRail, d.sky, d.whiteSteel, d.columnTile]) {
      for (const sh of buildBoth(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m), {lights: lights()})) expect(sh.errors, `${m.name} ${sh.backend}`).toEqual([]);
    }
  });
});

describe('the REAL generated mall (lane GEN, seed 12345 galleria): finishes, balustrades, render cost', () => {
  let real: {layout: StationLayout; w: BuiltWorld} | null = null;
  const get = () => {
    if (!real) {
      const layout = generateMallLevel({levelSeed: 12345, startWeapon: 'rifle'} as never, {variant: 'galleria'} as never) as StationLayout;
      real = {layout, w: buildWorld(layout, mats(), {})};
    }
    return real;
  };

  it('every shop wall takes its program finish, galleries / back of house theirs; balustrades on every ring rail; render cost bounded', () => {
    const {layout, w} = get();
    const m = layout.mall!;
    const shopOf = new Map(m.shops.map(s => [s.area, s]));
    let checked = 0;
    for (const f of w.wallFaces) {
      const s = shopOf.get(f.area);
      if (!s || f.slope) continue;
      const {base, row: r} = splitFinishKey(f.finish);
      expect(base, `${s.id} ${s.program}`).toBe('mall-wall');
      expect(row(r, 0)[3]).toBe(PROGRAM_FINISH[s.program].wall.upper);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
    expect(w.wallFaces.filter(f => f.level > 0).every(f => f.finish.startsWith('mall-'))).toBe(true);
    const st = w.mallArch!.stats;
    const ringRails = w.rails.filter(r => r.level !== m.void.floorLevel);
    expect(st.balustradeRuns).toBeGreaterThan(0);
    expect(st.balustradeRuns).toBeLessThanOrEqual(ringRails.length);
    expect(st.columns).toBeGreaterThan(4);
    expect(st.signs).toBeGreaterThan(40);
    // render cost: the whole mall (every storey, every prop) and the atrium dressing alone
    const total = w.stats, mallMeshes = meshes(w.group).filter(q => q.name.startsWith('mall-'));
    const atriumTris = st.triangles;
    console.log(`[mall render cost] build: ${total.meshes} meshes, ${total.triangles} tris, ${total.archMeshes} arch meshes; atrium dressing ${st.meshes} meshes / ${Math.round(atriumTris)} tris / ${st.ms.toFixed(0)} ms; mall-named meshes ${mallMeshes.length}`);
    expect(st.meshes).toBeLessThan(260);
    expect(atriumTris).toBeLessThan(80000);
    expect(total.archMeshes).toBeLessThan(700);
    // visible draw calls from the platform look-up pose (culled + frustum)
    const p = mallQaPoses(layout)[0];
    const c = cam([p.x, 1.6, p.z], [p.look.x, p.look.y, p.look.z]);
    w.culler.maxDistance = 220;
    w.culler.update(c, true);
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
    let calls = 0, tris = 0;
    for (const q of meshes(w.group)) {
      if (culled(q)) continue;
      if (!q.geometry.boundingSphere) q.geometry.computeBoundingSphere();
      const sph = q.geometry.boundingSphere!.clone().applyMatrix4(q.matrixWorld);
      if (!fr.intersectsSphere(sph)) continue;
      calls++;
      tris += ((q.geometry.index ? q.geometry.index.count : q.geometry.attributes.position.count) / 3) * ((q as THREE.InstancedMesh).count ?? 1);
    }
    console.log(`[mall render cost] platform look-up: ${calls} draw calls, ${Math.round(tris)} tris (culler: ${JSON.stringify(w.culler.atriumStats)})`);
    expect(w.culler.atriumStats.seen).toBe(true);
    expect(calls).toBeLessThan(1400);
    // the depth-buffered oracle on the real mall: from the platform look-up and the ring-3 gallery void edge nothing visible is culled
    for (const q of mallQaPoses(layout).slice(0, 2)) {
      const by = m.storeys.find(st2 => st2.level === q.level)?.baseY ?? 0;
      const cq = cam([q.x, by + 1.6, q.z], [q.look.x, q.look.y, q.look.z]);
      w.culler.update(cq, true);
      const vis = visibleMeshes(w.group, cq, 96, 54, {minPx: 3});
      expect([...vis].filter(([mm]) => culled(mm)).map(([mm, n]) => `${mm.name} L${mm.userData.level} ${n}px`), q.name).toEqual([]);
    }
  });
});

describe('the glass elevator: shaft tower on the non-door sides (lane GEN door side), a glass car', () => {
  it('the mall car is glass above the wainscot (no wood / mirror panels); the office car is unchanged', () => {
    const layout = generateMallLevel({levelSeed: 12345, startWeapon: 'rifle'} as never, {variant: 'galleria'} as never) as StationLayout;
    const info = readTowerInfo(layout)!;
    expect(info?.elevator).toBeTruthy();
    const plan = planElevator(info.elevator!);
    const names = (glass: boolean) => meshes(buildElevatorView(plan, mats(), {glass}).root).map(m => m.name);
    const g = names(true), o = names(false);
    expect(g).toContain('tower-cab-glass');
    expect(g).not.toContain('tower-cab-wood');
    expect(o).toContain('tower-cab-wood');
    expect(o).not.toContain('tower-cab-glass');
    const glassMesh = meshes(buildElevatorView(plan, mats(), {glass: true}).root).find(m => m.name === 'tower-cab-glass')!;
    expect(matOf(glassMesh).transparent).toBe(true);
    // the shaft tower: the landing-door side keeps its wall, the three others are glass on every storey
    const w = buildWorld(layout, mats(), {});
    expect(w.mallArch!.stats.shaftPanels).toBeGreaterThanOrEqual(3 * 6);
    // riding the glass car (the culler's eye override inside the solid shaft): the atrium stays seen, every storey renders
    const e = layout.mall!.elevators[0], cx = (e.cab.x0 + e.cab.x1) / 2, cz = (e.cab.z0 + e.cab.z1) / 2;
    const vb = layout.mall!.void.bounds, y3 = layout.mall!.storeys.find(q => q.level === 3)!.baseY;
    w.culler.eyeOverride = 3;
    w.culler.update(cam([cx, y3 + 1.6, cz], [(vb.x0 + vb.x1) / 2, y3, (vb.z0 + vb.z1) / 2]), true);
    expect(w.culler.atriumStats.seen).toBe(true);
    expect(w.culler.stats.visibleLevels.length).toBe(7);
    w.culler.eyeOverride = null;
  });
});

describe('old levels unchanged: the Subway and the Office never reach the mall paths', () => {
  const noMall = (w: BuiltWorld) => {
    expect(w.mallArch).toBeUndefined();
    expect(w.culler.atriumTileCount).toBe(0);
    for (const m of meshes(w.group)) {
      expect(m.name.startsWith('mall-'), m.name).toBe(false);
      expect(m.geometry.getAttribute(MALL_FINISH_ATTR), m.name).toBeUndefined();
    }
  };
  it('a generated Subway station and the Office build without any mall mesh, attribute or atrium tile', () => {
    const s = generateStation(4242);
    noMall(buildWorld(s, mats(), {}));
    const o = generateOfficeLevel({levelSeed: 777, startWeapon: 'pistol'} as never);
    const w = buildWorld(o, mats(), {});
    noMall(w);
    expect(w.officeArch).toBeTruthy();
  });

  it('the light-field bytes of a Subway station are identical with the mall sky hook spread in (it is {} there)', () => {
    const s = generateStation(9001);
    expect(mallSkyField(s, CELL)).toEqual({});
    const src = {grid: s.grid, lights: s.lights, trenchFloorY: s.trench.floorY, levels: stationLevels(s)};
    const a = bakeLightField(src), b = bakeLightField({...src, ...mallSkyField(s, CELL)});
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(b.stats.extra).toBeUndefined();
  });
});

void SPACE_FINISH;
