// Task track3-eaton-centre-20261031 (lane ARCH) -> task mall-playtest-revision-20261031 (lane ARCH): the mall's architecture —
// finishes, atrium, atrium engine support — REWRITTEN for the revised design (station + three retail floors, a small irregular atrium
// whose openings widen upward, glass only over the top opening, corridors beyond the atrium, no bridges):
//  - program -> finish mapping: distinct per program, never the station's tile / painted block or the office's plasterboard,
//    bounded material count (6 surface materials, one program per kind; finish rows per vertex), warm-up coverage;
//  - the glass roof over the TOP opening only (vault over its largest rectangle + flat glazing + clerestory on the polygon), never a
//    flashlight shadow caster, no opaque ceiling under it; slab edges of every storey's band are white fascias;
//  - U02: the Office's exterior toxic murk + drifting gas visible ONLY outside the glass (above the vault apex / the deck, beyond the
//    roof edge), drawn before every glass, no fog pasted inside; the mall has NO indoor gas hazard (the gas system stays inert);
//  - U07: the glass elevator's landing doorways are real apertures in the shaft wall at every stop (no painted wall);
//  - D06: lane SHOPS' ad records + ARCH's gallery billboards drawn on atlas pages (fictional brands, the seeded mall name);
//  - glass balustrades on EVERY opening edge of every floor (exactly the collision rails), the glass shaft tower;
//  - atrium culling: from the platform / the galleries every storey and the roof render (depth-buffered oracle: no visible mesh
//    culled), a service corridor facing away sees no atrium and culls the other storeys;
//  - light field: daylight through the roof reaches the plaza (mostly from above), the top floor more than the bottom, none in the
//    service corridor, slabs never leak; the TSL graphs build on WGSL + GLSL;
//  - the REAL generated mall (lane GEN): finishes per program, balustrades, render cost, the depth oracle;
//  - old levels unchanged: the Subway and the Office never reach the mall paths.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {buildBoth} from './helpers/tslShaders';
import {visibleMeshes} from './helpers/visibleMeshes';
import {MALL_FIX, inOpening, mallFixture, mallY} from './helpers/mallFixture';
import {CELL, FLOOR, SOLID, rampHeight} from '../src/gen/grid';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {generateStation, type StationLayout} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {bakeLightField, sampleField, type BakedField} from '../src/world/lightField';
import {OVERLAP_STATS, stationLevels} from '../src/world/levelGeometry';
import {ATRIUM_SIGHT_TESTS, CULL_LAYER} from '../src/world/levelCulling';
import {markShadows} from '../src/render/volumetric';
import {planWarmup} from '../src/render/warmup';
import {
  FLOOR as FLOOR_CODE, GALLERY_FLOOR, PLAZA_FLOOR, PROGRAM_FINISH, WALL, bohClass, finishSignature, stockFinish,
} from '../src/world/mallFinishes';
import {MALL_FINISH_ATTR, MALL_TABLE_ROWS, mallSurfaceMaterial, mallTableData} from '../src/world/mallSurfaces';
import {MALL_SURFACE_MATERIALS, mallDressMaterials, maxRect, packAtlas, pointInPoly, splitFinishKey} from '../src/world/mallArch';
import {SKY, bakeSkylight, mallSkyField} from '../src/world/mallSkylight';
import {MALL_FOG, MallAtmosphere, fogTransmittance, mallQaPoses} from '../src/world/mallAtmosphere';
import {GAS_SHEETS, MALL_EXT_ORDER, MALL_SKY, mallGasCurtainMaterial, mallGasMaterial, mallSkyMaterial, mallSkyPalette} from '../src/world/mallExterior';
import {EXT_FOG, exteriorFogOpacity} from '../src/world/exterior';
import {AD_GLOW, GALLERY_AD, GALLERY_LIGHTBOX, adAtlasMaterial, adGlowOf, type MallAd} from '../src/world/mallAds';
import {AD_ART_IDS, mallAdArtSummary} from '../src/assets/mallAdArt'; // task mall-round4 (lane ADS)
import {MOOD} from '../src/world/lights';
import {treatmentOf} from '../src/world/wallDetailPlan';
import type {MallProgram} from '../src/gen/mall/mallTypes';
import {readTowerInfo} from '../src/world/towerShared';
import {roofAirOf} from '../src/world/roofAir';
import {installGas, type GasHost} from '../src/world/gas/system';
import {PropDamage} from '../src/damage/propDamage';
import {buildElevatorView, planElevator} from '../src/world/elevator';

installCanvasShim(false);
// every string drawn on a canvas during this file (the seeded name must reach the signage; no fixed name ever)
const drawn: string[] = [];
{
  const proto = Object.getPrototypeOf((document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d')) as {fillText: (t: string, x: number, y: number) => void};
  const orig = proto.fillText;
  proto.fillText = function (t: string, x: number, y: number) { drawn.push(String(t)); return orig.call(this, t, x, y); };
}

const PROGRAMS = Object.keys(PROGRAM_FINISH) as MallProgram[];
const STATION_WALLS = ['tileLower', 'tileUpper', 'tileBase', 'paint', 'tileShop'];
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
// two shop ads (lane SHOPS' record shape) so the fixture exercises the ad renderer: a decal on a (virtual) glass plane and a poster
const F = mallFixture();
const fashion = F.shops.find(s => s.program === 'clothing')!;
const FIX_ADS: MallAd[] = [
  {kind: 'decal', program: 'clothing', shop: fashion.id, level: fashion.level, x: (fashion.frontage.x0 + fashion.frontage.x1) / 2 + 2, y: mallY(fashion.level) + 1.5, z: 12.25, nx: 0, nz: 1, w: 0.9, h: 1.2, seed: 11},
  {kind: 'poster', program: 'clothing', shop: fashion.id, level: fashion.level, x: 8, y: mallY(fashion.level) + 2.2, z: 2.5 + 0.015, nx: 0, nz: 1, w: 0.9, h: 1.0, seed: 12},
  // task mall-round3 (lane SHOPS, R5): a backlit menu board, a (dim) kiosk-cart header sign (double-faced), a dead lightbox
  {kind: 'menu', program: 'food-court', shop: fashion.id, level: fashion.level, x: 11, y: mallY(fashion.level) + 2.4, z: 2.5 + 0.05, nx: 0, nz: 1, w: 2.0, h: 0.6, seed: 13, slot: 'menu', glow: 1, cuisine: 'burger'},
  {kind: 'cart', program: 'kiosk', level: fashion.level, x: 20, y: mallY(fashion.level) + 1.6 + 0.03 + 0.21, z: 20, nx: 0, nz: 1, w: 1.1, h: 0.42, seed: 14, slot: 'cart', glow: 0.4, brand: 'Pretzel Twist'},
  {kind: 'lightbox', program: 'clothing', shop: fashion.id, level: fashion.level, x: 5, y: mallY(fashion.level) + 1.6, z: 2.5 + 0.06, nx: 0, nz: 1, w: 1.0, h: 1.7, seed: 15, slot: 'display', glow: 0},
];
(F.layout.mall as unknown as {ads: MallAd[]}).ads = FIX_ADS;
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
/** World triangles of a mesh (index-aware): centroid + bounds. */
const tris = (q: THREE.Mesh): {c: THREE.Vector3; lo: THREE.Vector3; hi: THREE.Vector3}[] => {
  q.updateMatrixWorld(true);
  const P = q.geometry.attributes.position, idx = q.geometry.index, n = idx ? idx.count : P.count, out = [];
  for (let t = 0; t < n; t += 3) {
    const v = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(P, idx ? idx.getX(t + k) : t + k).applyMatrix4(q.matrixWorld));
    out.push({c: v[0].clone().add(v[1]).add(v[2]).divideScalar(3), lo: v[0].clone().min(v[1]).min(v[2]), hi: v[0].clone().max(v[1]).max(v[2])});
  }
  return out;
};
const TOP = mallY(MALL_FIX.rings) + MALL_FIX.clear;

describe('mall finishes: program -> finish mapping (pure data)', () => {
  it('every program has a distinct wall + floor signature; wall and floor patterns and colours differ between programs', () => {
    const sigs = new Map<string, MallProgram>();
    for (const p of PROGRAMS) {
      const s = finishSignature(PROGRAM_FINISH[p]);
      expect(sigs.has(s), `${p} shares its finish with ${sigs.get(s)}`).toBe(false);
      sigs.set(s, p);
    }
    const floors = new Set(PROGRAMS.map(p => `${PROGRAM_FINISH[p].floor.code}:${PROGRAM_FINISH[p].floor.a}`));
    expect(floors.size).toBe(PROGRAMS.length);
    const walls = new Set(PROGRAMS.map(p => { const w = PROGRAM_FINISH[p].wall; return `${w.upper}:${w.upperColor}:${w.lower}:${w.lowerColor}`; }));
    expect(walls.size).toBe(PROGRAMS.length);
    expect(new Set(PROGRAMS.flatMap(p => [PROGRAM_FINISH[p].wall.upper, PROGRAM_FINISH[p].wall.lower])).size).toBeGreaterThanOrEqual(8);
    expect(new Set(PROGRAMS.map(p => PROGRAM_FINISH[p].floor.code)).size).toBeGreaterThanOrEqual(7);
    expect(PROGRAM_FINISH.guns.wall.upper).toBe(WALL.concrete);
    expect(PROGRAM_FINISH.guns.wall.lower).toBe(WALL.plank);
    expect(PROGRAM_FINISH.pharmacy.floor.code).toBe(FLOOR_CODE.vinyl);
    expect(PROGRAM_FINISH['food-court'].floor.code).toBe(FLOOR_CODE.checker);
    expect(PROGRAM_FINISH.clothing.floor.code).toBe(FLOOR_CODE.plank);
    expect(PROGRAM_FINISH.books.wall.lower).toBe(WALL.plank);
    expect(PLAZA_FLOOR.code).toBe(FLOOR_CODE.rings);
    // galleries: a distinct terrazzo palette per floor (the first three are the revised mall's floors)
    expect(new Set(GALLERY_FLOOR.slice(1, 4).map(f => f.a)).size).toBe(3);
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

describe('mall build (synthetic revised fixture: station + 3 floors, openings widening upward): finishes resolve per space', () => {
  it('shop walls take their program rows; the service corridor is back of house; slab edges of every band are fascias below the springing line', () => {
    const w = fw();
    expect(w.mallArch).toBeTruthy();
    expect(w.officeArch).toBeUndefined();
    const arch = w.mallArch!;
    const shopOf = new Map(F.shops.map(s => [s.area, s]));
    const service = new Set(F.corridors.map(c => c[0])), publicCorr = new Set(F.corridors.map(c => c[1]));
    let shopFaces = 0, corridorFaces = 0, galleryFaces = 0;
    const fasciaLevels = new Set<number>();
    const rowsByProgram = new Map<MallProgram, Set<number>>();
    for (const f of w.wallFaces) {
      if (f.level === 0 && !f.finish.startsWith('mall-')) continue; // station storey outside the atrium: subway finishes
      expect(f.finish.startsWith('mall-'), `face L${f.level} area ${f.area} finish ${f.finish}`).toBe(true);
      expect(STATION_WALLS.includes(f.finish)).toBe(false);
      expect(f.finish.startsWith('office-')).toBe(false);
      const {base, row: r} = splitFinishKey(f.finish);
      if (row(r, 0)[3] === WALL.fascia) {
        fasciaLevels.add(f.level);
        expect(f.y1).toBeLessThanOrEqual(MALL_FIX.spring + 0.051);
        continue;
      }
      const shop = shopOf.get(f.area);
      if (shop && !f.slope) {
        shopFaces++;
        expect(base).toBe('mall-wall');
        const want = PROGRAM_FINISH[shop.program].wall;
        expect(row(r, 0)[3]).toBe(want.upper);
        expect(row(r, 1)[3]).toBe(want.lower);
        (rowsByProgram.get(shop.program) ?? rowsByProgram.set(shop.program, new Set()).get(shop.program)!).add(r);
      } else if (service.has(f.area)) { corridorFaces++; expect(base).toMatch(/^mall-wall-boh(~d[NSEW])?$/); }
      else if (F.gallery.includes(f.area) || publicCorr.has(f.area)) { galleryFaces++; expect(base).toBe('mall-wall'); }
    }
    expect(shopFaces).toBeGreaterThan(60);
    expect(corridorFaces).toBeGreaterThan(5);
    expect(galleryFaces).toBeGreaterThan(10);
    // the station band (slab 1) and the jutting galleries of floors 1 and 2 (slabs 2, 3 + the roof edge) all carry fascias
    expect([...fasciaLevels].sort()).toEqual([0, 1, 2]);
    const all = [...rowsByProgram.values()].map(s => [...s]);
    expect(new Set(all.flat()).size).toBe(all.reduce((n, s) => n + s.length, 0));
    expect(rowsByProgram.size).toBe(new Set(F.shops.map(s => s.program)).size);
    expect(arch.summary().rows).toBeLessThan(MALL_TABLE_ROWS);
  });

  it('floors: plaza rings at the pit bottom (not on the track bed), floor-tinted gallery terrazzo, the program floor in every shop', () => {
    const w = fw();
    const arch = w.mallArch!;
    const L0 = F.levels[0];
    const cell = (x: number, z: number) => Math.floor(z / CELL) * L0.grid.w + Math.floor(x / CELL);
    const plaza = arch.floorKey(0, cell(10, 15));
    expect(plaza).toMatch(/^mall-floor\|/);
    expect(row(splitFinishKey(plaza!).row, 0)[3]).toBe(FLOOR_CODE.rings);
    expect(arch.floorKey(0, cell(30, 31))).toBeNull(); // track bed (VOID): ballast stays
    const g1 = arch.floorKey(1, cell(14, 26)), g3 = arch.floorKey(3, cell(14, 26));
    expect(g1).not.toBe(g3);
    expect(row(splitFinishKey(g1!).row, 0)[3]).toBe(FLOOR_CODE.terrazzo);
    const s = F.shops.find(q => q.program === 'food-court')!;
    const a = F.layout.areas[s.area];
    const k = arch.floorKey(s.level, (a.y + 2) * L0.grid.w + a.x + 2);
    expect(row(splitFinishKey(k!).row, 0)[3]).toBe(FLOOR_CODE.checker);
    const c = F.layout.areas[F.corridors[0][0]];
    expect(arch.floorKey(1, c.y * L0.grid.w + c.x + 5)).toMatch(/^mall-floor-boh(~d[NSEW])?\|/);
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
    const mallMats = [...all].filter(m => m.name.startsWith('mall-'));
    expect(mallMats.length).toBeLessThanOrEqual(36);
    const stationKeys = new Set(STATION_WALLS.map(k => { try { return (mats() as WorldMaterials).get(k as never).name; } catch { return k; } }));
    for (const m of meshes(w.group)) if (m.name.startsWith('arch-') && (m.userData.level ?? 0) > 0) expect(stationKeys.has(matOf(m).name), m.name).toBe(false);
  });
});

describe('mall atrium: the glass roof over the TOP opening, balustrades, columns, shaft', () => {
  it('glass only over the top opening (vault on its largest rectangle + flat glazing + clerestory on its polygon); transparent, never a shadow caster; no ceiling under it', () => {
    const w = fw(), arch = w.mallArch!;
    const glass = meshes(w.group).find(m => m.name === 'mall-roof-glass')!;
    expect(glass).toBeTruthy();
    const gm = matOf(glass);
    expect(gm.transparent).toBe(true);
    // (U02, primary's browser check: it writes depth so the interior haze march stops at the glass — no bright veil outside)
    expect(gm.depthWrite).toBe(true);
    markShadows(w.group, true, true);
    expect(glass.castShadow).toBe(false);
    expect(meshes(w.group).find(m => m.name === 'mall-roof-steel')!.castShadow).toBe(true);
    for (const m of meshes(w.group).filter(q => matOf(q).name.startsWith('mall-glass'))) expect(m.castShadow).toBe(false);
    // the vault rectangle lies inside the polygon; every roof-glass triangle lies over the polygon (horizontal) or on its edges
    const poly = MALL_FIX.openings[2];
    const v = arch.vaultRect();
    for (const [x, z] of [[v.x0 + 0.1, v.z0 + 0.1], [v.x1 - 0.1, v.z0 + 0.1], [v.x0 + 0.1, v.z1 - 0.1], [v.x1 - 0.1, v.z1 - 0.1]]) expect(pointInPoly(poly, x, z)).toBe(true);
    expect((v.x1 - v.x0) * (v.z1 - v.z0)).toBeGreaterThan(300);
    expect(arch.stats.flatGlazingM2, 'the polygon beyond the vault is glazed flat').toBeGreaterThan(40);
    const near = (x: number, z: number) => pointInPoly(poly, x, z) || [[0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]].some(([dx, dz]) => pointInPoly(poly, x + dx, z + dz));
    for (const t of tris(glass)) expect(near(t.c.x, t.c.z), `roof glass at ${t.c.x.toFixed(2)}, ${t.c.z.toFixed(2)}`).toBe(true);
    // no arch ceiling triangle under the glazed polygon at / above the springing line; the jutting galleries have none either
    let over = 0, ceilTris = 0;
    for (const m of meshes(w.group)) {
      if (!/ceil|arch-/.test(m.name) || (m as THREE.InstancedMesh).isInstancedMesh) continue;
      const N = m.geometry.attributes.normal, idx = m.geometry.index;
      if (!N) continue;
      for (const t of tris(m)) {
        void idx;
        if (t.hi.y - t.lo.y > 0.01) continue; // horizontal only
        const P = m.geometry.attributes.position; void P;
        ceilTris++;
        if (pointInPoly(poly, t.c.x, t.c.z) && t.c.y >= TOP - 0.05 && t.c.y < MALL_FIX.spring - 0.05 && !/floor/.test(m.name)) over++;
      }
    }
    expect(ceilTris).toBeGreaterThan(100);
    expect(over, 'no ceiling under the glass').toBe(0);
    expect(arch.stats.roofPanes).toBeGreaterThan(30);
    expect(arch.stats.arches).toBeGreaterThanOrEqual(3);
  });

  it('maxRect: the largest axis-aligned rectangle of a cell mask', () => {
    const mask = ['....', '.###', '####', '.##.'].map(r => [...r].map(c => c === '#'));
    expect(maxRect(4, 4, (x, y) => mask[y][x])).toEqual({x0: 1, y0: 1, x1: 4, y1: 3});
    expect(maxRect(2, 2, () => false)).toBeNull();
  });

  it('a glass balustrade covers EVERY opening edge of every floor (the collision rails, all drawn)', () => {
    const w = fw();
    const owned = w.rails.filter(r => r.level !== 0);
    const len = owned.reduce((s, r) => s + Math.hypot(r.x1 - r.x0, r.z1 - r.z0), 0);
    expect(w.mallArch!.stats.balustradeM).toBeCloseTo(len, 3);
    const Wd = F.levels[0].grid.w;
    for (let L = 1; L <= MALL_FIX.rings; L++) {
      const g = F.levels[L].grid;
      let edges = 0, covered = 0;
      for (let i = 0; i < Wd * g.h; i++) {
        if (g.cells[i] !== FLOOR) continue;
        const x = i % Wd, y = (i - x) / Wd;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (y + dy) * Wd + x + dx;
          if (g.cells[j] !== SOLID || !inOpening(L, (x + dx + 0.5) * CELL, (y + dy + 0.5) * CELL)) continue; // not this floor's opening
          edges++;
          const ex = (x + 0.5 + dx * 0.5) * CELL, ez = (y + 0.5 + dy * 0.5) * CELL;
          if (owned.some(r => r.level === L && Math.abs(dx ? r.x0 - ex : r.z0 - ez) < 0.12 && Math.abs(dx ? r.x1 - ex : r.z1 - ez) < 0.12
            && (dx ? Math.min(r.z0, r.z1) - 0.01 <= ez && Math.max(r.z0, r.z1) + 0.01 >= ez : Math.min(r.x0, r.x1) - 0.01 <= ex && Math.max(r.x0, r.x1) + 0.01 >= ex))) covered++;
        }
      }
      expect(edges, `floor ${L} opening edges`).toBeGreaterThan(60);
      expect(covered, `floor ${L}: every opening edge railed`).toBe(edges);
      expect(meshes(w.group).filter(m => m.name.startsWith('mall-balustrade-glass') && m.userData.level === L).length, `floor ${L} glass`).toBeGreaterThan(0);
    }
  });

  it('no column ends in open air (v2 without column records draws none); the glass shaft tower; signage with the SEEDED name, banners', () => {
    const w = fw();
    const st = w.mallArch!.stats;
    expect(st.columns, 'v2 atrium widens upward: columns only as records (lane FIX)').toBe(0);
    expect(st.droppedFaces).toBeGreaterThan(0);
    expect(st.shaftPanels).toBe(3 * 4);
    expect(st.signs).toBe(F.shops.length);
    expect(st.labels).toBeGreaterThan(0);
    expect(st.banners).toBeGreaterThan(0);
    expect(meshes(w.group).filter(m => m.name.startsWith('mall-sign-faces')).length).toBeLessThanOrEqual(2);
    const {pages} = packAtlas([...Array(30)].map(() => ({width: 768, height: 120})).concat([...Array(30)].map(() => ({width: 128, height: 128}))));
    expect(pages.length).toBeLessThanOrEqual(2);
    expect(st.downlights).toBe(F.layout.lights.filter(l => (l.level ?? 0) > 0).length);
    // the seeded name reaches the banners; no fixed mall name is drawn anywhere
    expect(drawn.some(t => t === F.layout.mall.name.toUpperCase())).toBe(true);
    expect(drawn.some(t => /EATON/i.test(t))).toBe(false);
  });
});

describe('U02 + U07 + D06 on the fixture build', () => {
  it('U02: the exterior murk + drifting gas exist ONLY outside the glass (above the vault apex / the deck, beyond the roof), drawn before every glass, unfogged', () => {
    const w = fw(), arch = w.mallArch!;
    const sky = meshes(w.group).find(m => m.name === 'mall-sky')!, gas = meshes(w.group).find(m => m.name === 'mall-exterior-gas')!, curtain = meshes(w.group).find(m => m.name === 'mall-exterior-gas-curtain')!;
    for (const m of [sky, gas, curtain]) { expect(m, 'exterior mesh').toBeTruthy(); expect((matOf(m) as {fog?: boolean}).fog).toBe(false); expect(matOf(m).depthWrite).toBe(false); }
    expect(matOf(sky)).toBe(mallSkyMaterial());
    expect(matOf(gas)).toBe(mallGasMaterial());
    expect(matOf(curtain)).toBe(mallGasCurtainMaterial());
    expect(arch.stats.exteriorGas).toBeGreaterThanOrEqual(4);
    // render order: the gas after the opaque world (transparent list) and before every glass of the mall
    expect(matOf(gas).transparent && matOf(curtain).transparent).toBe(true);
    const glassOrders = meshes(w.group).filter(m => /glass/.test(matOf(m).name)).map(m => m.renderOrder);
    expect(glassOrders.length).toBeGreaterThan(3);
    expect(Math.max(gas.renderOrder, curtain.renderOrder)).toBeLessThan(Math.min(...glassOrders));
    expect(sky.renderOrder).toBe(MALL_EXT_ORDER.sky);
    // outside only: every gas vertex is above the building's deck; below the vault apex only outside the vault's footprint;
    // the curtain stands beyond the glazed opening; nothing lies inside a storey (all shop / gallery ceilings are below the deck)
    const deck = TOP + 0.62, v = arch.vaultRect(), poly = MALL_FIX.openings[2];
    for (const t of tris(gas)) {
      expect(t.lo.y).toBeGreaterThan(deck);
      if (t.lo.y < MALL_FIX.apex) expect(t.c.x < v.x0 || t.c.x > v.x1 || t.c.z < v.z0 || t.c.z > v.z1).toBe(true);
      if (pointInPoly(poly, t.c.x, t.c.z)) expect(t.lo.y, 'over the glazing: above the glass').toBeGreaterThan(MALL_FIX.spring + 0.5);
    }
    for (const t of tris(curtain)) { expect(t.lo.y).toBeGreaterThanOrEqual(deck - 0.05); expect(pointInPoly(poly, t.c.x, t.c.z)).toBe(false); }
    // every storey's interior ceiling / roof is below the gas: the opaque world hides it except through the glass
    for (const st of F.layout.mall.storeys) expect(st.baseY + st.clear).toBeLessThan(deck);
    // the mall haze (scene fog) is unchanged by the exterior (a separate atmosphere: inside stays the light dusty haze)
    expect(MALL_FOG.density).toBe(0.0115);
  });

  it('U02 palette: the exterior IS the Office murk — its hue, at least its saturation, dark overhead (no pale overcast), gas visible against it, the Office fog density on the curtain', () => {
    const w = fw(), arch = w.mallArch!;
    const srgb = (c: readonly number[]) => c.map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    const hsv = (c: readonly number[]) => {
      const [r, g, b] = srgb(c), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const h = d === 0 ? 0 : mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
      return {h: (h + 360) % 360, s: mx ? d / mx : 0, v: mx};
    };
    const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const office = hsv(EXT_FOG.color);
    expect(office.h).toBeGreaterThan(80); // the Office murk: a sickly yellow-green
    expect(office.h).toBeLessThan(105);
    const pal = mallSkyPalette();
    for (const [k, c] of Object.entries(pal)) {
      const q = hsv(c);
      expect(Math.abs(q.h - office.h), `${k} hue ${q.h.toFixed(1)} vs the Office ${office.h.toFixed(1)}`).toBeLessThan(8);
      expect(q.s, `${k} saturation`).toBeGreaterThanOrEqual(office.s - 1e-6);
      expect(q.s, `${k} not neon`).toBeLessThan(0.65);
    }
    // dark overhead: the zenith is a deep murky green, nowhere near the old pale overcast (sRGB value 0.51, saturation 0.12)
    const z = hsv(pal.zenith);
    expect(z.v).toBeLessThan(0.5);
    expect(z.v).toBeGreaterThan(0.25);
    expect(z.s).toBeGreaterThan(0.3);
    expect(lum(pal.zenith)).toBeLessThan(0.17);
    expect(lum(pal.horizon)).toBeLessThan(lum(pal.zenith));
    // the gas reads against the sky both ways: lit rims brighter, dense cores darker
    expect(lum(pal.gasLit)).toBeGreaterThan(lum(pal.zenith) * 1.4);
    expect(lum(pal.gasCore)).toBeLessThan(lum(pal.zenith) * 0.7);
    // depth: five sheets over the apex at distinct heights (parallax) + the roof layer + the curtain
    expect(GAS_SHEETS.length).toBe(5);
    expect(new Set(GAS_SHEETS).size).toBe(5);
    expect(arch.stats.exteriorGas).toBe(GAS_SHEETS.length + 1);
    // the curtain carries the Office fog's opacity at its distance from the roof (EXT_FOG density, world/exterior.ts)
    const r = MALL_FIX.roof, half = Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2;
    expect(arch.stats.exteriorCurtain).toBeCloseTo(Math.min(0.9, exteriorFogOpacity(half + 6, 12, 12)), 6);
    expect(arch.stats.exteriorCurtain).toBeGreaterThan(0.3);
    expect(MALL_SKY.gas).toBeGreaterThan(0.4);
    // the daylight through the glass is a little greener (the light of the murk), still ~unit luminance and plausible
    const [tr, tg, tb] = SKY.tint;
    expect(tg).toBe(Math.max(tr, tg, tb));
    expect(tb).toBeLessThan(tr);
    expect(lum(SKY.tint)).toBeGreaterThan(0.85);
    expect(lum(SKY.tint)).toBeLessThanOrEqual(1);
  });

  it('U02: NO indoor gas hazard in the mall — the gas system stays inert (no field, no roof air, no exposure, no damage, no claimed hits)', () => {
    const L = F.layout;
    expect(roofAirOf(L)).toBeNull();
    const info = readTowerInfo(L)!;
    expect(info.windows.length).toBe(0);
    const hits: number[] = [], layers: number[] = [];
    let clock = 0;
    const h = {
      player: {x: MALL_FIX.start.x, z: MALL_FIX.start.z, y: 0, eye: 1.6, alive: true, takeDamage(a: number) { hits.push(a); }},
      layout: L, tower: {office: {info, windows: null}},
      atmosphere: {active: true, setGasLayer: (slot: number) => { layers.push(slot); }}, atmosphereBypass: null,
      run: {laneStore: () => undefined, setLaneStore: () => {}},
      get clock() { return clock; }, state: 'playing',
      frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
      stateListeners: [] as ((s: never, p: never) => void)[], bulletHitHandlers: [] as ((...a: never[]) => boolean)[],
    };
    const sys = installGas(h as unknown as GasHost);
    h.sectionHooks[0].build!(L);
    expect(sys.field).toBeNull();
    expect(sys.roof).toBeNull();
    expect(sys.windows).toBeNull();
    // under the atrium, a top-floor gallery at the opening, a jutting gallery open to the glass, a shop on the top floor
    for (const [x, z, lv] of [[MALL_FIX.start.x, MALL_FIX.start.z, 0], [14, 26, 3], [19.2, 27, 1], [8, 6, 3]] as const) {
      Object.assign(h.player, {x, z, y: mallY(lv), eye: mallY(lv) + 1.6});
      for (let t = 0; t < 2; t += 1 / 30) { clock += 1 / 30; for (const fn of h.frameHooks) fn(1 / 30); }
      expect(sys.exposure.c, `exposure at ${x},${z} L${lv}`).toBe(0);
      expect(sys.exposure.dps).toBe(0);
      expect(sys.exposure.source).toBeNull();
    }
    expect(hits).toEqual([]);
    expect(layers).toEqual([]);
    expect(sys.exposure.damage).toBe(0);
  });

  it('U07: every stop of the glass elevator has a real doorway in the shaft wall (an opening in the wall face; no wall triangle in the aperture); the rig skin is open there too', () => {
    const w = fw();
    const info = readTowerInfo(F.layout)!.elevator!;
    expect(info.doorSide).toBe('N');
    const plan = planElevator(info);
    const G = plan.gate, plane = MALL_FIX.shaft.z0;
    for (const st of info.stops) {
      // the door-side wall face(s) of that storey on the shaft plane carry the opening (door width x the gate's clear height)
      const fs = w.wallFaces.filter(f => f.level === st.levelId && Math.abs(f.z0 - plane) < 1e-6 && Math.abs(f.z1 - plane) < 1e-6 && Math.min(f.x0, f.x1) < info.door.x && Math.max(f.x0, f.x1) > info.door.x);
      expect(fs.length, `L${st.levelId} door-side face`).toBeGreaterThan(0);
      // (a run may be split into a dado band and an upper band: every band below the door head carries the cut up to the head)
      let reach = st.y;
      for (const f of fs.filter(q => q.y0 < st.y + plan.doorH - 1e-3).sort((a, b) => a.y0 - b.y0)) {
        const a0 = Math.min(f.x0, f.x1);
        const o = f.openings.find(q => a0 + q.s0 <= info.door.x - G.hw + 1e-3 && a0 + q.s1 >= info.door.x + G.hw - 1e-3);
        expect(o, `L${st.levelId} band ${f.y0}: the doorway is cut`).toBeTruthy();
        expect(o!.top).toBeGreaterThanOrEqual(Math.min(st.y + plan.doorH, f.y1) - 1e-3);
        expect(f.y0).toBeLessThanOrEqual(reach + 1e-3);
        reach = Math.max(reach, o!.top);
      }
      expect(reach, `L${st.levelId}: cut up to the door head`).toBeGreaterThanOrEqual(st.y + plan.doorH - 1e-3);
    }
    // no arch wall triangle inside any aperture box (door width x clear height x the wall depth)
    const walls = meshes(w.group).filter(m => /^mall-arch-wall|^arch-wall/.test(m.name));
    expect(walls.length).toBeGreaterThan(0);
    const inAperture = (c: THREE.Vector3) => info.stops.some(st => Math.abs(c.x - info.door.x) < G.hw - 0.03 && c.y > st.y + 0.05 && c.y < st.y + plan.doorH - 0.05 && c.z > plane - 0.02 && c.z < plane + G.depth + 0.02);
    for (const m of walls) for (const t of tris(m)) expect(inAperture(t.c), `${m.name} triangle in a doorway at ${t.c.toArray().map(n => n.toFixed(2))}`).toBe(false);
    // the glass car rig's inner skin of the landing wall leaves the same holes
    const view = buildElevatorView(plan, mats(), {glass: true});
    const skin = view.root.getObjectByName('tower-rig-static') as THREE.Mesh;
    for (const t of tris(skin)) expect(inAperture(t.c) && t.c.z < plane + 0.45, `rig triangle in a doorway at ${t.c.toArray().map(n => n.toFixed(2))}`).toBe(false);
  });

  it('D06: lane SHOPS\' ad records + ARCH gallery billboards render on atlas pages (instanced per page / storey), fictional brand text, frames on the wall', () => {
    const w = fw(), arch = w.mallArch!;
    expect(arch.stats.shopAds).toBe(FIX_ADS.length);
    expect(arch.stats.galleryAds).toBeGreaterThan(0);
    const faces = meshes(w.group).filter(m => m.name.startsWith('mall-ad-faces') || m.name.startsWith('mall-ad-decals')) as THREE.InstancedMesh[];
    const n = faces.reduce((s, m) => s + m.count, 0);
    const two = (a: MallAd) => a.kind === 'decal' || a.kind === 'cart'; // decals / (R5) kiosk-cart headers: both faces
    expect(n).toBe(arch.ads.filter(a => !two(a)).length + 2 * arch.ads.filter(two).length);
    // (R5) opaque faces packed per storey (about one page each), the few decals on a shared page: one mesh per page and storey
    const storeys = new Set(arch.ads.map(a => a.level)).size;
    expect(faces.length).toBeLessThanOrEqual(2 * storeys + 1);
    expect(arch.stats.adMeshes).toBe(faces.length);
    expect(arch.stats.adPages).toBeLessThanOrEqual(faces.length);
    for (const m of faces.filter(q => q.name.startsWith('mall-ad-faces'))) expect(new Set(faces.filter(q => q.name.startsWith('mall-ad-faces') && matOf(q) === matOf(m)).map(q => q.userData.level)).size).toBe(1); // a page per storey
    for (const m of faces) expect(Number.isInteger(m.userData.level)).toBe(true);
    // (R5) backlight: opaque pages carry aGlow per instance (= the record's glow: lit kinds; posters 0) and the emissive node; decals none
    const glowSum = faces.filter(m => m.name.startsWith('mall-ad-faces')).reduce((s, m) => s + Array.from((m.geometry.getAttribute('aGlow') as THREE.BufferAttribute).array as Float32Array).reduce((a, b) => a + b, 0), 0);
    const want = arch.ads.reduce((s, a) => s + adGlowOf(a) * (a.kind === 'cart' ? 2 : a.kind === 'decal' ? 0 : 1), 0);
    expect(glowSum).toBeCloseTo(want, 3);
    expect(adGlowOf(FIX_ADS[0])).toBe(0); // decal
    expect(adGlowOf(FIX_ADS[1])).toBe(0); // paper poster
    expect(adGlowOf(FIX_ADS[2])).toBe(1); // menu board lit
    expect(adGlowOf(FIX_ADS[3])).toBe(0.4); // a dim cart header
    expect(adGlowOf(FIX_ADS[4])).toBe(0); // a dead lightbox
    expect(arch.stats.litAds).toBe(arch.ads.filter(a => adGlowOf(a) > 0).length);
    for (const m of faces) {
      const mat = matOf(m) as THREE.Material & {emissiveNode?: unknown};
      if (m.name.startsWith('mall-ad-faces')) { expect(mat.name).toBe('mall-ad-atlas'); expect(mat.emissiveNode).toBeTruthy(); }
      else { expect(mat.name).toBe('mall-ad-decal-atlas'); expect(m.geometry.getAttribute('aGlow')).toBeUndefined(); expect(mat.alphaTest).toBe(0.5); }
    }
    // (R5) the kiosk-cart header: a slim box standing on its canopy line (record bottom - border), centred on the record
    const cart = FIX_ADS[3], frameTris = tris(meshes(w.group).find(m => m.name === `mall-ad-frames-${cart.level}`)!).filter(t => Math.abs(t.c.x - 20) < 0.7 && Math.abs(t.c.z - 20) < 0.2);
    expect(frameTris.length).toBeGreaterThan(0);
    expect(Math.min(...frameTris.map(t => t.lo.y))).toBeCloseTo(cart.y - cart.h / 2 - 0.03, 3);
    expect(Math.max(...frameTris.map(t => t.hi.z)) - Math.min(...frameTris.map(t => t.lo.z))).toBeCloseTo(0.06, 3);
    // gallery billboards: storey-correct height, on public walls of the plaza / galleries, bounded per storey
    for (const a of arch.ads.filter(q => q.slot === 'gallery' && q.kind === 'billboard')) {
      expect(a.program).toBe('mall');
      expect(a.y - mallY(a.level)).toBeCloseTo(GALLERY_AD.y, 5);
      expect(a.glow).toBeDefined();
    }
    const per = new Map<number, number>(), perLb = new Map<number, number>();
    for (const a of arch.ads.filter(q => q.slot === 'gallery' && q.kind === 'billboard')) per.set(a.level, (per.get(a.level) ?? 0) + 1);
    for (const c of per.values()) expect(c).toBeLessThanOrEqual(GALLERY_AD.perStorey);
    // (R5) gallery wall lightboxes: eye level, backlit, advertising a real store of the mall (its brand), bounded per storey
    for (const a of arch.ads.filter(q => q.slot === 'gallery' && q.kind === 'lightbox')) {
      expect(a.y - mallY(a.level)).toBeCloseTo(GALLERY_LIGHTBOX.y, 5);
      expect(a.glow).toBeDefined();
      if (a.shop) expect(F.shops.find(q => q.id === a.shop)?.program).toBe(a.program);
      perLb.set(a.level, (perLb.get(a.level) ?? 0) + 1);
    }
    for (const c of perLb.values()) expect(c).toBeLessThanOrEqual(GALLERY_LIGHTBOX.perStorey);
    expect(drawn.includes('PRETZEL TWIST')).toBe(true); // (R5) the cart's own kiosk brand
    // brand text: the shop's fictional brand and the seeded mall name are drawn on the ads
    expect(drawn.includes(fashion.brand.toUpperCase())).toBe(true);
    expect(drawn.includes(F.layout.mall.name.toUpperCase())).toBe(true);
    // task mall-round4 (lane ADS): every face maps to a shipped Codex image; none is held in Node, so every face drew the plain palette
    // fill (never substitute drawn art) — and nothing stays held after the atlas build
    expect(arch.adArt.drawn).toBe(0);
    expect(arch.adArt.fallback).toBe(arch.ads.length);
    expect(Object.values(arch.adArt.byTheme).reduce((s, v) => s + (v ?? 0), 0)).toBe(arch.ads.length);
    for (const id of Object.keys(arch.adArt.byTheme)) expect(AD_ART_IDS).toContain(id);
    expect(mallAdArtSummary().held).toEqual([]);
    // the poster record (1.5 cm proud) has its frame on the wall plane (z = 2.5 + the unit's wall... the shop's back wall z = 2.5)
    const frames = meshes(w.group).filter(m => m.name === `mall-ad-frames-${fashion.level}`);
    expect(frames.length).toBe(1);
    const back = tris(frames[0]).filter(t => Math.abs(t.c.x - 8) < 0.6 && t.c.z < 3);
    expect(back.length).toBeGreaterThan(0);
    expect(Math.min(...back.map(t => t.lo.z))).toBeCloseTo(2.5, 2);
  });
});

describe('mall atrium engine: view-dependent culling through the widening atrium', () => {
  it('from the platform every storey and the roof render (no visible mesh culled)', () => {
    const w = fw();
    const c = cam([MALL_FIX.start.x, 1.6, MALL_FIX.start.z], [30, 20, MALL_FIX.start.z - 2]);
    w.culler.update(c, true);
    const st = w.culler.atriumStats;
    expect(st.seen).toBe(true);
    expect(st.sightTests).toBeLessThanOrEqual(ATRIUM_SIGHT_TESTS);
    expect([...w.culler.stats.visibleLevels].sort()).toEqual([0, 1, 2, 3]);
    const vis = visibleMeshes(w.group, c, 96, 54, {minPx: 2});
    const bad = [...vis].filter(([m]) => culled(m)).map(([m, n]) => `${m.name} L${m.userData.level} ${n}px`);
    expect(bad, 'visible but culled').toEqual([]);
    expect([...vis.keys()].some(m => m.name === 'mall-roof-glass' || m.name === 'mall-roof-steel')).toBe(true);
  });

  it('from gallery edges on floors 1, 2 and 3 (and a jutting gallery): the other storeys across the atrium render, nothing visible is culled', () => {
    const w = fw();
    for (const [L, pos, target] of [
      [1, [21, mallY(1) + 1.6, 27], [32, mallY(1) - 3, 27]], [1, [19.2, mallY(1) + 1.6, 30], [38, mallY(1) + 6, 22]], [2, [42, mallY(2) + 1.6, 30], [26, mallY(2) - 4, 26]],
      [3, [15.5, mallY(3) + 1.6, 26], [36, mallY(3) - 8, 28]], [3, [30, mallY(3) + 1.6, 38.5], [30, mallY(3) + 4, 18]],
    ] as [number, [number, number, number], [number, number, number]][]) {
      const c = cam(pos, target);
      w.culler.update(c, true);
      expect(w.culler.atriumStats.seen, `L${L} ${pos}`).toBe(true);
      const vis = visibleMeshes(w.group, c, 96, 54, {minPx: 2});
      const bad = [...vis].filter(([m]) => culled(m)).map(([m, n]) => `${m.name} L${m.userData.level} ${n}px`);
      expect(bad, `L${L} ${pos}`).toEqual([]);
    }
  });

  it('in the service corridor facing away from the atrium the atrium is unseen and the other storeys are culled', () => {
    const w = fw();
    const c = cam([30, mallY(2) + 1.6, 53], [30, mallY(2) + 1.6, 60]);
    w.culler.update(c, true);
    expect(w.culler.atriumStats.seen).toBe(false);
    expect(w.culler.stats.visibleLevels).toEqual([2]);
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

  it('reaches the plaza (mostly from above), the top floor more than the bottom, none in the service corridor; slabs never leak', () => {
    withSky ??= bake(true); noSky ??= bake(false);
    expect(withSky.stats.cut).toBe(0);
    expect(withSky.stats.extra!.skyCols).toBeGreaterThan(400);
    const plat = irr(withSky, 28, 0.15, 27) - irr(noSky, 28, 0.15, 27);
    expect(plat, 'plaza daylight').toBeGreaterThan(0.6);
    const s = sampleField(withSky, 28, 0.15, 27, [1, 1, 1], [0, 1, 0]);
    expect(s.dir[1], 'light comes from above').toBeGreaterThan(0.8);
    const gal = (L: number) => irr(withSky!, 15.5, mallY(L) + 0.1, 26) - irr(noSky!, 15.5, mallY(L) + 0.1, 26);
    expect(gal(3)).toBeGreaterThan(gal(1));
    expect(gal(3)).toBeGreaterThan(0.02);
    for (const L of [1, 2, 3]) expect(Math.abs(irr(withSky, 30, mallY(L) + 0.1, 53) - irr(noSky, 30, mallY(L) + 0.1, 53)), `corridor L${L}`).toBeLessThan(1e-3);
    const court = irr(withSky, 9, 0.15, 13) - irr(noSky, 9, 0.15, 13);
    expect(court).toBeLessThan(plat * 0.5);
  });

  it('the bake is deterministic and bounded; glazing follows the roof polygon', () => {
    withSky ??= bake(true);
    const again = bake(true);
    expect(Buffer.from(again.data).equals(Buffer.from(withSky.data))).toBe(true);
    const ex = withSky.stats.extra!;
    expect(ex.voxels).toBeLessThan(ex.receivers * 4);
    expect(SKY.reach).toBeLessThanOrEqual(14);
    const empty = bakeSkylight({W: 4, H: 4, cell: CELL, slots: [], layers: [], E: [], D: [], EL: [], bands: {start: new Int32Array(17), f: new Float32Array(0), c: new Float32Array(0)}}, {roofY: 30, glazed: new Uint8Array(16)});
    expect(empty.skyCols).toBe(0);
  });
});

describe('mall atmosphere, QA poses, warm-up and shader builds', () => {
  it('the mall haze keeps the roof and the far galleries in view; three QA poses exist on the fixture', () => {
    expect(fogTransmittance(36)).toBeGreaterThan(0.75);
    expect(fogTransmittance(100)).toBeGreaterThan(0.2);
    expect(fogTransmittance(36, 0.043)).toBeLessThan(0.1);
    const poses = mallQaPoses(F.layout);
    expect(poses.map(p => p.name.split('-')[0])).toEqual(['platform', 'gallery', 'shop']);
    const g = poses[1];
    expect(F.levels[g.level].grid.cells[Math.floor(g.z / CELL) * MALL_FIX.W + Math.floor(g.x / CELL)]).toBe(FLOOR);
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
    host.sectionHooks[0].build!(generateStation(4242));
    expect((scene.fog as THREE.FogExp2).density).toBe(MOOD.fogDensity);
    expect(atm.active).toBe(false);
  });

  it('the warm-up plans every material of the mall scene (culled meshes included)', () => {
    const w = fw();
    w.culler.update(cam([30, mallY(2) + 1.6, 53], [30, mallY(2) + 1.6, 60]), true);
    const c = new THREE.PerspectiveCamera();
    const plan = planWarmup(w.group, {mode: 'full', cameraMask: c.layers.mask});
    const planned = new Set(plan.items.map(i => matOf(i.object as THREE.Mesh)));
    const missing = new Set<string>();
    for (const m of meshes(w.group)) if (!planned.has(matOf(m)) && !plan.items.some(i => matOf(i.object as THREE.Mesh) === matOf(m))) missing.add(matOf(m).name || matOf(m).type);
    expect([...missing]).toEqual([]);
    const names = new Set([...planned].map(m => m.name));
    for (const n of ['mall-wall', 'mall-floor', 'mall-ceiling', 'mall-glass-roof', 'mall-glass-rail', 'mall-white-steel', 'mall-sky', 'mall-exterior-gas', 'mall-exterior-gas-curtain', 'mall-ad-atlas', 'mall-ad-decal-atlas']) expect(names.has(n), n).toBe(true);
  });

  it('every mall TSL graph builds cleanly on WGSL and GLSL (surface kinds with the finish attribute, glass, the exterior sky / gas)', () => {
    const lights = () => [new THREE.SpotLight(0xffffff, 1)];
    const geo = () => { const g = new THREE.PlaneGeometry(1, 1); g.setAttribute(MALL_FINISH_ATTR, new THREE.Float32BufferAttribute(new Float32Array(4).fill(3), 1)); return g; };
    for (const [k, boh] of [['wall', false], ['floor', true], ['ceiling', false]] as const) {
      for (const sh of buildBoth(new THREE.Mesh(geo(), mallSurfaceMaterial(k, boh)), {lights: lights()})) {
        expect(sh.errors, `${k} ${sh.backend}`).toEqual([]);
        expect(sh.fragment.length).toBeGreaterThan(1000);
      }
    }
    const d = mallDressMaterials(mats());
    for (const m of [d.glassRoof, d.glassRail, d.sky, d.whiteSteel, d.columnTile, mallGasMaterial(), mallGasCurtainMaterial()]) {
      for (const sh of buildBoth(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m), {lights: lights()})) expect(sh.errors, `${m.name} ${sh.backend}`).toEqual([]);
    }
    // task mall-round3 (lane SHOPS, R5): the ad atlas pages — emissive backlight from the atlas x per-instance aGlow x AD_GLOW (opaque),
    // the cut-out vinyl page (no backlight)
    const atlas = new THREE.DataTexture(new Uint8Array(16).fill(200), 2, 2);
    for (const cut of [false, true]) {
      const g = new THREE.PlaneGeometry(1, 1);
      const im = new THREE.InstancedMesh(g, adAtlasMaterial(atlas, cut), 2);
      g.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 1, 1, 0, 0, 0.5, 0.5]), 4));
      if (!cut) g.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array([1, 0]), 1));
      for (const sh of buildBoth(im, {lights: lights()})) {
        expect(sh.errors, `ad atlas cut=${cut} ${sh.backend}`).toEqual([]);
        if (!cut) expect(sh.vertex + sh.fragment).toMatch(/aGlow/);
      }
    }
    expect(AD_GLOW.value).toBeGreaterThan(0.3);
  });
});

describe('the REAL generated mall (lane GEN): finishes, balustrades, render cost, the depth oracle', () => {
  // (the generator is imported lazily: lane GEN's generator mid-change must not take the fixture tests of this file down)
  let real: {layout: StationLayout; w: BuiltWorld} | null = null;
  const get = async () => {
    if (!real) {
      const {generateMallLevel} = await import('../src/gen/mall/index');
      const layout = generateMallLevel({levelSeed: 12345, startWeapon: 'rifle'} as never) as StationLayout;
      real = {layout, w: buildWorld(layout, mats(), {})};
    }
    return real;
  };

  it('every shop wall takes its program finish; balustrades on every floor rail; the glass over the top opening; render cost bounded; nothing visible culled', async () => {
    const {layout, w} = await get();
    const m = layout.mall!;
    const shopOf = new Map(m.shops.map(s => [s.area, s]));
    let checked = 0;
    for (const f of w.wallFaces) {
      const s = shopOf.get(f.area);
      if (!s || f.slope) continue;
      const {base, row: r} = splitFinishKey(f.finish);
      if (row(r, 0)[3] === WALL.fascia) continue;
      expect(base, `${s.id} ${s.program}`).toBe('mall-wall');
      expect(row(r, 0)[3]).toBe(PROGRAM_FINISH[s.program].wall.upper);
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
    expect(w.wallFaces.filter(f => f.level > 0).every(f => f.finish.startsWith('mall-'))).toBe(true);
    const st = w.mallArch!.stats;
    expect(st.balustradeRuns).toBeGreaterThan(0);
    expect(st.signs).toBeGreaterThan(10);
    expect(st.exteriorGas).toBeGreaterThanOrEqual(4);
    const poly = m.roof.polygon ?? m.void.outline;
    const glass = meshes(w.group).find(q => q.name === 'mall-roof-glass')!;
    const near = (x: number, z: number) => [[0, 0], [0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]].some(([dx, dz]) => pointInPoly(poly, x + dx, z + dz));
    expect(tris(glass).every(t => near(t.c.x, t.c.z))).toBe(true);
    const total = w.stats, mallMeshes = meshes(w.group).filter(q => q.name.startsWith('mall-'));
    console.log(`[mall render cost] build: ${total.meshes} meshes, ${total.triangles} tris, ${total.archMeshes} arch meshes; atrium dressing ${st.meshes} meshes / ${Math.round(st.triangles)} tris / ${st.ms.toFixed(0)} ms; mall-named meshes ${mallMeshes.length}`);
    expect(st.meshes).toBeLessThan(200);
    expect(st.triangles).toBeLessThan(70000);
    expect(total.archMeshes).toBeLessThan(500);
    // U07 on GEN's real record: every stop's landing doorway is cut through the door-side wall up to the gate's clear height
    const lift = readTowerInfo(layout)!.elevator!;
    const lp = planElevator(lift), alongX = lift.doorSide === 'N' || lift.doorSide === 'S';
    const plane = lift.doorSide === 'N' ? lift.shaft.z0 : lift.doorSide === 'S' ? lift.shaft.z1 : lift.doorSide === 'W' ? lift.shaft.x0 : lift.shaft.x1;
    const c = alongX ? lift.door.x : lift.door.z;
    for (const st of lift.stops) {
      const fs = w.wallFaces.filter(f => f.level === st.levelId && (alongX ? Math.abs(f.z0 - plane) < 1e-6 && Math.abs(f.z1 - plane) < 1e-6 && Math.min(f.x0, f.x1) < c && Math.max(f.x0, f.x1) > c
        : Math.abs(f.x0 - plane) < 1e-6 && Math.abs(f.x1 - plane) < 1e-6 && Math.min(f.z0, f.z1) < c && Math.max(f.z0, f.z1) > c) && f.y0 < st.y + lp.doorH - 1e-3);
      expect(fs.length, `real mall L${st.levelId}: door-side faces`).toBeGreaterThan(0);
      for (const f of fs) {
        const a0 = alongX ? Math.min(f.x0, f.x1) : Math.min(f.z0, f.z1);
        expect(f.openings.some(o => a0 + o.s0 <= c - lp.gate.hw + 1e-3 && a0 + o.s1 >= c + lp.gate.hw - 1e-3 && o.top >= Math.min(st.y + lp.doorH, f.y1) - 1e-3), `real mall L${st.levelId}: doorway cut`).toBe(true);
      }
    }
    for (const q of mallQaPoses(layout).slice(0, 2)) {
      const by = m.storeys.find(s2 => s2.level === q.level)?.baseY ?? 0;
      const cq = cam([q.x, by + 1.6, q.z], [q.look.x, q.look.y, q.look.z]);
      w.culler.update(cq, true);
      const vis = visibleMeshes(w.group, cq, 96, 54, {minPx: 3});
      expect([...vis].filter(([mm]) => culled(mm)).map(([mm, n]) => `${mm.name} L${mm.userData.level} ${n}px`), q.name).toEqual([]);
    }
  });

  it('R5 (task mall-round3, lane SHOPS): gallery wall lightboxes on the real mall — on solid public wall, clear of doors / props, eye level, bounded', async () => {
    const {layout, w} = await get();
    const arch = w.mallArch!, L = GALLERY_LIGHTBOX;
    const lbs = arch.ads.filter(a => a.slot === 'gallery' && a.kind === 'lightbox');
    expect(lbs.length).toBeGreaterThan(4);
    const per = new Map<number, number>();
    for (const a of lbs) {
      per.set(a.level, (per.get(a.level) ?? 0) + 1);
      const base = layout.mall!.storeys.find(s2 => s2.level === a.level)!.baseY;
      expect(a.y - base).toBeCloseTo(L.y, 5);
      // solid wall right behind the whole face (5 samples across, at 0.7 m and 2.0 m above the floor)
      const g = layout.levels[a.level].grid, alongX = a.nz !== 0;
      for (const k of [-0.45, -0.2, 0, 0.2, 0.45]) {
        const bx = a.x - a.nx * (L.depth / 2 + 0.06) + (alongX ? k * a.w : 0), bz = a.z - a.nz * (L.depth / 2 + 0.06) + (alongX ? 0 : k * a.w);
        expect(g.cells[Math.floor(bz / CELL) * g.w + Math.floor(bx / CELL)], `lightbox ${a.x.toFixed(1)},${a.z.toFixed(1)} L${a.level} backed`).toBe(SOLID);
      }
      // the floor in front is walkable public space (never inside a shop or behind a counter)
      const fx = a.x + a.nx * 0.6, fz = a.z + a.nz * 0.6, fi = Math.floor(fz / CELL) * g.w + Math.floor(fx / CELL);
      expect(g.cells[fi]).toBe(FLOOR);
      // clear of props at the wall and of doors
      const near = (x: number, z: number, hx: number, hz: number, e: number) => alongX
        ? Math.abs(z - a.z) < hz + e && x + hx > a.x - a.w / 2 - e && x - hx < a.x + a.w / 2 + e
        : Math.abs(x - a.x) < hx + e && z + hz > a.z - a.w / 2 - e && z - hz < a.z + a.w / 2 + e;
      for (const p of layout.props) if ((p.level ?? 0) === a.level) expect(near(p.x, p.z, p.hx, p.hz, L.propClear - 0.01), `lightbox vs ${p.kind}`).toBe(false);
      for (const d of layout.doors) if (((d as {level?: number}).level ?? 0) === a.level) expect(near((d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL, d.w * CELL / 2, d.h * CELL / 2, L.doorClear - 0.01)).toBe(false);
    }
    for (const c of per.values()) expect(c).toBeLessThanOrEqual(L.perStorey);
    // every gallery ad pair on a storey keeps its spacing
    const gal = arch.ads.filter(a => a.slot === 'gallery');
    for (const a of gal) for (const b of gal) if (a !== b && a.level === b.level) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan((a.w + b.w) / 2 + 0.5);
  });

  it('shopfronts (lane SHOPS collision-only props): every glazing pane / closed shutter is drawn exactly over its collider; frontages face the walkway', async () => {
    const {layout, w} = await get();
    const props = layout.props.filter(p => (p.kind === 'shopGlazing' || p.kind === 'shopShutter') && p.shop === undefined);
    const st = w.mallArch!.stats;
    expect(st.glazing).toBe(props.filter(p => p.kind === 'shopGlazing').length);
    expect(st.shutters).toBe(props.filter(p => p.kind === 'shopShutter').length);
    const glass = meshes(w.group).filter(mm => mm.name.startsWith('shopfront-mall-glass')).flatMap(tris), shutter = meshes(w.group).filter(mm => mm.name.startsWith('shopfront-mall-shutter')).flatMap(tris);
    const inBox = (c: THREE.Vector3, p: (typeof props)[number], e: number) => c.x >= p.x - p.hx - e && c.x <= p.x + p.hx + e && c.z >= p.z - p.hz - e && c.z <= p.z + p.hz + e && c.y >= p.y - e && c.y <= p.y + p.h + e;
    for (const p of props) {
      const mine = (p.kind === 'shopGlazing' ? glass : shutter).filter(t => inBox(t.c, p, 0.03));
      expect(mine.length, `${p.kind} at ${p.x},${p.z} has a visual`).toBeGreaterThan(0);
      expect(Math.max(...mine.map(t => t.hi.y))).toBeLessThanOrEqual(p.y + p.h + 0.01);
    }
    const sf = meshes(w.group).filter(mm => mm.name.startsWith('shopfront-mall-') || mm.name.startsWith('mall-shutter-partial'));
    expect(sf.length).toBeLessThanOrEqual(4 * layout.mall!.storeys.length);
    const dmg = new PropDamage();
    dmg.build(layout.props, [w.group]);
    const pane = layout.props.find(q => q.kind === 'shopGlazing' && q.shop === undefined);
    if (pane) { const s = dmg.state(pane); expect(dmg.detach(s, true)).toBe(true); expect(s.parts!.some(q => q.glass)).toBe(true); }
  });
});

describe('the glass elevator: shaft tower on the non-door sides, a glass car', () => {
  it('the mall car is glass above the wainscot (no wood / mirror panels); the office car is unchanged', () => {
    const info = readTowerInfo(F.layout)!;
    const plan = planElevator(info.elevator!);
    const names = (glass: boolean) => meshes(buildElevatorView(plan, mats(), {glass}).root).map(m => m.name);
    const g = names(true), o = names(false);
    expect(g).toContain('tower-cab-glass');
    expect(g).not.toContain('tower-cab-wood');
    expect(o).toContain('tower-cab-wood');
    expect(o).not.toContain('tower-cab-glass');
    expect(matOf(meshes(buildElevatorView(plan, mats(), {glass: true}).root).find(m => m.name === 'tower-cab-glass')!).transparent).toBe(true);
    // riding the glass car (the culler's eye override inside the solid shaft): the atrium stays seen
    const w = fw();
    const e = F.layout.mall.elevators[0], cx = (e.cab.x0 + e.cab.x1) / 2, cz = (e.cab.z0 + e.cab.z1) / 2;
    w.culler.eyeOverride = 2;
    w.culler.update(cam([cx, mallY(2) + 1.6, cz], [30, mallY(2), 27]), true);
    expect(w.culler.atriumStats.seen).toBe(true);
    w.culler.eyeOverride = null;
  });
});

describe('old levels unchanged: the Subway and the Office never reach the mall paths', () => {
  const noMall = (w: BuiltWorld) => {
    expect(w.mallArch).toBeUndefined();
    expect(w.culler.atriumTileCount).toBe(0);
    for (const m of meshes(w.group)) {
      expect(m.name.startsWith('mall-'), m.name).toBe(false);
      expect(m.name.startsWith('shopfront-mall-'), m.name).toBe(false);
      expect(m.geometry.getAttribute(MALL_FINISH_ATTR), m.name).toBeUndefined();
    }
  };
  it('a generated Subway station and the Office build without any mall mesh, attribute or atrium tile', () => {
    const s = generateStation(4242);
    // (task mall-round3, lane FIX R1: the level geometry's same-column overlap subtraction never runs outside the mall's open wells, so
    // their wall faces are unchanged — counted on these already-built worlds)
    OVERLAP_STATS.subtracted = 0;
    noMall(buildWorld(s, mats(), {}));
    expect(OVERLAP_STATS.subtracted, 'Subway: overlapping-band subtractions').toBe(0);
    const o = generateOfficeLevel({levelSeed: 777, startWeapon: 'pistol'} as never);
    OVERLAP_STATS.subtracted = 0;
    const w = buildWorld(o, mats(), {});
    expect(OVERLAP_STATS.subtracted, 'Office: overlapping-band subtractions').toBe(0);
    noMall(w);
    expect(w.officeArch).toBeTruthy();
    // (lane FIX R1) the Office transit escalators keep their old geometry (the mall-only cladding / beam changes never reach them):
    // both cladding faces on the balustrade line, from 5 cm under the pitch
    const transit = w.group.getObjectByName('transit-stainless') as THREE.Mesh;
    const t = (o as {office?: {transit?: {escalators: {flights: number[]}[]}}}).office!.transit!.escalators[0];
    const q = o.traversal.stairs[t.flights[0]], r = o.grid.ramps[q.ramp];
    const pos = transit.geometry.getAttribute('position'), nor: number[] = [];
    let below = false;
    for (let i = 0; i < pos.count; i += 3) {
      const xs = [0, 1, 2].map(k => pos.getX(i + k));
      if (!xs.every(x => Math.abs(x - q.a0) < 1e-5)) continue;
      const e1 = [0, 1, 2].map(k => [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)][k] - [pos.getX(i), pos.getY(i), pos.getZ(i)][k]);
      const e2 = [0, 1, 2].map(k => [pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2)][k] - [pos.getX(i), pos.getY(i), pos.getZ(i)][k]);
      const nx = e1[1] * e2[2] - e1[2] * e2[1], l = Math.hypot(nx, e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
      if (l < 1e-9 || Math.abs(nx) / l < 0.99) continue;
      nor.push(Math.sign(nx));
      for (let k = 0; k < 3; k++) if (pos.getY(i + k) < rampHeight(r, pos.getZ(i + k)) - 0.04) below = true;
    }
    expect(new Set(nor).size, 'transit cladding: both faces').toBe(2);
    expect(below, 'transit cladding: from 5 cm under the pitch').toBe(true);
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
