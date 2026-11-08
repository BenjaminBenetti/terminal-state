// Task studio-skywalk-encounters-20261108-074144-01 (lane STORES): how the Skywalk's MALL STORE FAMILIES (layout version >= 5) are DRAWN —
// render only, node:
//  - their walls / floor take the programme's own Mall finish (world/mallFinishes.ts PROGRAM_FINISH) as reserved rows of the small shops'
//    per-vertex programs (world/skywaysMallFinish.ts), just below the palettes' rows and far above a Mall build's own allocation;
//  - draw-neutral: the same 'skyways-shop-wall' / 'skyways-shop-floor' keys and materials — at most one small-shop wall / floor mesh per
//    48 m chunk holding small-shop surfaces, every vertex row a palette or Mall store row of the right kind;
//  - every other small shop keeps its use's palette (version 4 unchanged: tests/skyways-shop-palettes.test.ts);
//  - bullet impacts on a Mall store's wall / floor take the finish's class;
//  - the fascia: each Mall store's slot of the ONE lettering atlas is drawn in the Mall brand style (its plate colour under the sign state).
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, FLOOR} from '../src/gen/grid';
import {storefrontParts} from '../src/gen/storefronts';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {buildStorefronts} from '../src/world/storefrontBuilder';
import {CHUNK_M} from '../src/world/levelGeometry';
import {MALL_FINISH_ATTR, MALL_TABLE_ROWS, floorRow, mallSurfaceMaterial, mallTableData, wallRow} from '../src/world/mallSurfaces';
import {SKYWAYS_SHOP_PALETTE_OF, SKYWAYS_SHOP_ROW0, skywaysShopPaletteOfRow, skywaysShopWallKey} from '../src/world/skywaysShopFinish';
import {
  SKYWAYS_MALL_ROW0, skywaysMallFinish, skywaysMallFloorKey, skywaysMallImpact, skywaysMallImpactOf, skywaysMallRowOf, skywaysMallRows, skywaysMallWallKey,
} from '../src/world/skywaysMallFinish';
import {SKYWAYS_MALL_STORE_PROGRAMS, skywaysMallStoresOf} from '../src/gen/skyways/skywaysMallStores';
import {mallFasciaLight} from '../src/world/skywaysMallFascia';
import {BRAND_STYLE} from '../src/world/mallArch';
import {finishClass} from '../src/damage/impactFinish';

const LOG = '/tmp/skyways-mall-stores-view.log';
let mats: WorldMaterials;
let L: StationLayout;
let w: BuiltWorld;
let seed = 0;
const rowData = (r: number) => Array.from(mallTableData().subarray(r * 16, r * 16 + 16));
const close = (a: ArrayLike<number>, b: readonly number[], eps = 1e-5) => b.every((x, i) => Math.abs(a[i] - x) <= eps);

beforeAll(() => {
  installCanvasShim(false);
  fs.writeFileSync(LOG, '');
  mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  // the first seed whose map lets at least two Mall stores (found, not hard-coded)
  for (let s = 1; s <= 8 && !seed; s++) {
    const l = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol', layoutVersion: 5} as never) as StationLayout;
    if (skywaysMallStoresOf(l).length >= 2) { seed = s; L = l; }
  }
  w = buildWorld(L, mats, {});
}, 900_000);

describe('the Mall store rows: data', () => {
  it('one wall + one floor row per pool programme, below the palettes\' rows, the programme\'s Mall finish, keys of the small-shop programs', () => {
    const n = SKYWAYS_MALL_STORE_PROGRAMS.length;
    expect(SKYWAYS_MALL_ROW0).toBe(SKYWAYS_SHOP_ROW0 - 2 * n);
    const rows = SKYWAYS_MALL_STORE_PROGRAMS.flatMap(p => [skywaysMallRows(p).wall, skywaysMallRows(p).floor]);
    expect(new Set(rows).size).toBe(rows.length);
    for (const r of rows) { expect(r).toBeGreaterThanOrEqual(SKYWAYS_MALL_ROW0); expect(r).toBeLessThan(SKYWAYS_SHOP_ROW0); expect(skywaysShopPaletteOfRow(r)).toBeNull(); }
    for (const p of SKYWAYS_MALL_STORE_PROGRAMS) {
      expect(skywaysMallRowOf(skywaysMallRows(p).wall)).toEqual({program: p, kind: 'wall'});
      expect(skywaysMallRowOf(skywaysMallRows(p).floor)).toEqual({program: p, kind: 'floor'});
      expect(skywaysMallWallKey(p)).toBe(`skyways-shop-wall|${skywaysMallRows(p).wall}`);
      expect(skywaysMallFloorKey(p)).toBe(`skyways-shop-floor|${skywaysMallRows(p).floor}`);
      expect(finishClass(skywaysMallWallKey(p))).toBe(skywaysMallImpactOf(p, 'wall'));
      expect(finishClass(skywaysMallFloorKey(p))).toBe(skywaysMallImpactOf(p, 'floor'));
      expect(skywaysMallImpact(skywaysMallWallKey(p))).not.toBeNull();
    }
    // the palettes' keys keep their classes
    expect(finishClass(skywaysShopWallKey('cafe'))).toBe('plaster');
    expect(skywaysMallImpact(skywaysShopWallKey('cafe'))).toBeNull();
    // (the women's fashion store: blush plaster over oak, pale planks; the jeweller: black marble on white marble)
    expect(skywaysMallImpactOf('womenswear', 'floor')).toBe('wood');
    expect(skywaysMallImpactOf('jewelry', 'wall')).toBe('terrazzo');
    expect(SKYWAYS_SHOP_ROW0).toBeLessThan(MALL_TABLE_ROWS);
  });
});

describe('a real version-5 Skywalk with Mall stores', () => {
  it('each Mall store\'s walls / floor take its programme\'s Mall finish rows; every other small shop keeps its palette', () => {
    expect(seed, 'a seed with two Mall stores within 1..8').toBeGreaterThan(0);
    const a = w.skywaysArch!;
    const stores = skywaysMallStoresOf(L);
    const units = new Map(stores.map(sf => [sf.unit, sf.mall!]));
    let mallFaces = 0, mallFloors = 0;
    for (const f of w.wallFaces) {
      const p = units.get(f.area) as (typeof SKYWAYS_MALL_STORE_PROGRAMS)[number] | undefined;
      if (p) {
        if (a.classOf(f.area) === 'shop' && f.finish.startsWith('skyways-shop-')) { expect(f.finish, L.areas[f.area].label).toBe(skywaysMallWallKey(p)); mallFaces++; }
        continue;
      }
      const r = /^skyways-shop-wall\|(\d+)$/.exec(f.finish);
      if (r) expect(skywaysMallRowOf(Number(r[1])), `${L.areas[f.area]?.label}: a Mall row outside a Mall store`).toBeNull();
    }
    for (const [unit, p] of units) {
      const ar = L.areas[unit], g = L.levels[ar.level ?? 0].grid;
      let i = -1;
      for (let y = ar.y; y < ar.y + ar.h && i < 0; y++) for (let x = ar.x; x < ar.x + ar.w; x++) { const j = g.idx(x, y); if (g.cells[j] === FLOOR && g.area[j] === unit && g.rampIdx[j] < 0) { i = j; break; } }
      expect(a.floorKey(ar.level ?? 0, i), `${ar.label} floor`).toBe(skywaysMallFloorKey(p as (typeof SKYWAYS_MALL_STORE_PROGRAMS)[number]));
      expect(a.mallStoreProgram(unit)).toBe(p);
      mallFloors++;
    }
    // the other small storefront units: their use's palette as before
    for (const sf of L.storefronts) if (sf.unit >= 0 && !sf.anchor && !sf.mall) expect(a.shopPalette(sf.unit), sf.name).toBe(SKYWAYS_SHOP_PALETTE_OF[sf.use]);
    fs.appendFileSync(LOG, `seed ${seed} v5: ${stores.length} Mall stores (${stores.map(sf => `${sf.mall} "${sf.name}"`).join(', ')}): ${mallFaces} wall faces, ${mallFloors} floors on their Mall rows\n`);
    expect(mallFaces).toBeGreaterThanOrEqual(stores.length * 3);
  });

  it('draw-neutral: the same programs, at most one small-shop wall / floor mesh per chunk, rows per vertex are palette or Mall store rows', () => {
    const wallMat = mallSurfaceMaterial('wall'), floorMat = mallSurfaceMaterial('floor');
    const meshes: {wall: THREE.Mesh[]; floor: THREE.Mesh[]} = {wall: [], floor: []};
    w.group.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.material === wallMat) meshes.wall.push(m); if (m.material === floorMat) meshes.floor.push(m); });
    const wallChunks = new Set<string>(), floorChunks = new Set<string>();
    for (const f of w.wallFaces) {
      if (!f.finish.startsWith('skyways-shop-')) continue;
      const alongX = Math.abs(f.z0 - f.z1) < 1e-9, plane = alongX ? f.z0 : f.x0, s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1;
      if (f.slope) { const m = (s0 + s1) / 2; wallChunks.add(`S:${alongX ? Math.floor(m / CHUNK_M) : Math.floor(plane / CHUNK_M)},${alongX ? Math.floor(plane / CHUNK_M) : Math.floor(m / CHUNK_M)}:${f.level}`); continue; }
      for (let c = Math.floor(s0 / CHUNK_M); c * CHUNK_M < s1 - 1e-6; c++) wallChunks.add(`${f.level}:${alongX ? c : Math.floor(plane / CHUNK_M)},${alongX ? Math.floor(plane / CHUNK_M) : c}`);
    }
    const a = w.skywaysArch!;
    for (const lv of L.levels) {
      const g = lv.grid;
      for (let i = 0; i < g.w * g.h; i++) if (g.cells[i] === FLOOR && a.classOf(g.area[i]) === 'shop' && (a.shopPalette(g.area[i]) || a.mallStoreProgram(g.area[i]))) floorChunks.add(`${lv.id}:${Math.floor((i % g.w) * CELL / CHUNK_M)},${Math.floor(Math.floor(i / g.w) * CELL / CHUNK_M)}`);
    }
    fs.appendFileSync(LOG, `seed ${seed} v5: shop wall meshes ${meshes.wall.length} (chunks ${wallChunks.size}), floor meshes ${meshes.floor.length} (chunks ${floorChunks.size}); ${JSON.stringify(w.stats)}\n`);
    expect(meshes.wall.length).toBeGreaterThan(0);
    expect(meshes.wall.length).toBeLessThanOrEqual(wallChunks.size);
    expect(meshes.floor.length).toBeLessThanOrEqual(floorChunks.size + 1);
    let mallRows = 0;
    for (const [kind, list] of [['wall', meshes.wall], ['floor', meshes.floor]] as const) for (const m of list) {
      const at = m.geometry.getAttribute(MALL_FINISH_ATTR);
      for (let i = 0; i < at.count; i++) {
        const r = at.getX(i), pal = skywaysShopPaletteOfRow(r), ms = skywaysMallRowOf(r);
        expect(pal?.kind ?? ms?.kind, `${m.name} row ${r}`).toBe(kind);
        if (ms) mallRows++;
      }
    }
    expect(mallRows, 'Mall store vertices in the shared small-shop meshes').toBeGreaterThan(0);
    for (const p of SKYWAYS_MALL_STORE_PROGRAMS) {
      expect(close(rowData(skywaysMallRows(p).wall), wallRow(skywaysMallFinish(p).wall).flat()), `${p} wall row`).toBe(true);
      expect(close(rowData(skywaysMallRows(p).floor), floorRow(skywaysMallFinish(p).floor).flat()), `${p} floor row`).toBe(true);
    }
    // a bullet on a Mall store wall takes its finish's class
    const units = new Set(skywaysMallStoresOf(L).map(sf => sf.unit));
    const f = w.wallFaces.find(q => units.has(q.area) && q.finish.startsWith('skyways-shop-') && Math.abs(q.z0 - q.z1) < 1e-9 && q.y1 - q.y0 > 2);
    if (f) {
      const key = w.finishAt!('wall', L.levels.findIndex(l => l.id === f.level), (f.x0 + f.x1) / 2, f.y0 + 1.8, f.z0, 0, f.nz);
      expect(key).toBe(f.finish);
      expect(finishClass(key)).toBe(skywaysMallImpact(f.finish));
    }
  });

  it('the fascia: each Mall store\'s slot of the lettering atlas is its Mall brand plate (colour under the sign state)', () => {
    const restore = installCanvasShim(true);
    try {
      const g = new THREE.Group();
      buildStorefronts(g, L, {mat: () => new THREE.MeshBasicMaterial(), models: {}, instanceModel: () => 0});
      const mesh = g.getObjectByName('shopfront-fascia') as THREE.Mesh;
      expect(mesh).toBeTruthy();
      const img = (mesh.material as THREE.MeshStandardMaterial).map!.image as {width: number; height: number; data: Uint8ClampedArray};
      const uv = mesh.geometry.getAttribute('uv');
      // the atlas's face order: storefrontParts' fascia faces, storefront by storefront (world/storefrontBuilder.ts buildStorefronts)
      const order: number[] = [];
      for (const sf of L.storefronts) for (const fc of storefrontParts(L, sf, {anchorSign: true}).faces) if (fc.kind === 'fascia') order.push(sf.id);
      expect(order.length).toBe(uv.count / 4);
      let checked = 0;
      for (const sf of skywaysMallStoresOf(L)) {
        const i = order.indexOf(sf.id);
        expect(i, sf.name).toBeGreaterThanOrEqual(0);
        const u0 = uv.getX(i * 4), v0 = uv.getY(i * 4), u1 = uv.getX(i * 4 + 2), v1 = uv.getY(i * 4 + 2);
        const x0 = Math.round(u0 * img.width), x1 = Math.round(u1 * img.width), y0 = Math.round((1 - v1) * img.height), y1 = Math.round((1 - v0) * img.height);
        const st = BRAND_STYLE[sf.mall!], k = mallFasciaLight(sf.sign), bg = parseInt(st.bg.slice(1), 16);
        const want = [((bg >> 16) & 255) * k, ((bg >> 8) & 255) * k, (bg & 255) * k];
        // plate samples away from the lettering (the slot's left / right margins, upper third)
        let near = 0, n = 0;
        for (const fx of [0.01, 0.02, 0.98, 0.99]) for (const fy of [0.08, 0.18, 0.28]) {
          const x = Math.min(img.width - 1, Math.floor(x0 + (x1 - x0) * fx)), y = Math.min(img.height - 1, Math.floor(y0 + (y1 - y0) * fy)), o = (y * img.width + x) * 4;
          n++;
          if (Math.abs(img.data[o] - want[0]) + Math.abs(img.data[o + 1] - want[1]) + Math.abs(img.data[o + 2] - want[2]) <= 60) near++;
        }
        expect(near, `${sf.name} (${sf.mall}, ${sf.sign}): plate ${st.bg} x ${k}`).toBeGreaterThanOrEqual(Math.ceil(n * 0.5));
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(2);
    } finally { restore(); installCanvasShim(false); }
  }, 300_000);

  it('a Mall build after leaves the Mall store rows alone (it allocates its own rows below them)', () => {
    const before = SKYWAYS_MALL_STORE_PROGRAMS.flatMap(p => [rowData(skywaysMallRows(p).wall), rowData(skywaysMallRows(p).floor)]);
    const M = LEVELS.mall.generate('main', {levelSeed: 1, startWeapon: 'pistol'} as never);
    const mw = buildWorld(M, mats, {});
    const rows = mw.mallArch!.summary().rows;
    fs.appendFileSync(LOG, `mall seed 1: ${rows} finish rows (Mall store rows from ${SKYWAYS_MALL_ROW0})\n`);
    expect(rows).toBeLessThan(SKYWAYS_MALL_ROW0);
    expect(SKYWAYS_MALL_STORE_PROGRAMS.flatMap(p => [rowData(skywaysMallRows(p).wall), rowData(skywaysMallRows(p).floor)])).toEqual(before);
  }, 600_000);
});
