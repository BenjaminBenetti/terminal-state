// Task studio-skywalk-variety-20261107-231448-01 (lane DRESS; user: "the smaller shops all have the 'tile' walls, this really contributes
// to them feeling the same. Perhaps the walls of stores could vary a bit."): the SMALL SHOPS' interior palettes (world/skywaysShopFinish.ts,
// world/skywaysArch.ts), render only — so on real layouts of version 4 (live), 3 (gen/skyways/legacy80) and 2 (gen/skyways/legacy77):
//  - pure: seven palettes, every shop use mapped, distinct wall / floor signatures, the reserved rows at the top of the Mall finish table,
//    an impact class per key;
//  - every small storefront unit's walls / floor take its use's palette (the ramen restaurant's rooms too), never the Subway shop tile;
//    the anchors, the station's own areas and every other class never take a shop key; several palettes per level;
//  - draw-neutral: the palettes are finish ROWS of the Mall's per-vertex programs — at most one wall and one floor mesh per 48 m chunk
//    holding small-shop surfaces, the vertex rows are palette rows, the table rows hold the palette data;
//  - impacts take the palette's class; a Mall build after a Skyways build leaves the reserved rows alone (it allocates far below them).
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, FLOOR} from '../src/gen/grid';
import {STORE_PURPOSES} from '../src/gen/purposes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {CHUNK_M} from '../src/world/levelGeometry';
import {MALL_FINISH_ATTR, MALL_TABLE_ROWS, floorRow, mallSurfaceMaterial, mallTableData, wallRow} from '../src/world/mallSurfaces';
import {
  SKYWAYS_SHOP_PALETTES, SKYWAYS_SHOP_PALETTE_IDS, SKYWAYS_SHOP_PALETTE_OF, SKYWAYS_SHOP_ROW0, SKYWAYS_SHOP_TABLE_ROWS, skywaysShopFloorKey,
  skywaysShopImpact, skywaysShopPaletteOfRow, skywaysShopRows, skywaysShopWallKey, type SkywaysShopPalette,
} from '../src/world/skywaysShopFinish';
import {finishClass} from '../src/damage/impactFinish';

installCanvasShim(false);
const LOG = '/tmp/skyways-shop-palettes.log';
let mats: WorldMaterials;
const CASES = [{seed: 1, v: 4}, {seed: 4, v: 3}, {seed: 3, v: 2}] as const;
const built = new Map<string, {L: StationLayout; w: BuiltWorld}>();
const world = (seed: number, v: number) => {
  const k = `${seed}/${v}`;
  let e = built.get(k);
  if (!e) {
    const L = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: v} as never);
    built.set(k, (e = {L, w: buildWorld(L, mats, {})}));
  }
  return e;
};
beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); fs.writeFileSync(LOG, ''); });
const close = (a: ArrayLike<number>, b: readonly number[], eps = 1e-5) => b.every((x, i) => Math.abs(a[i] - x) <= eps);
const rowData = (r: number) => Array.from(mallTableData().subarray(r * 16, r * 16 + 16));

describe('small-shop palettes: the data', () => {
  it('seven palettes, every shop use mapped, distinct signatures, reserved rows at the top of the Mall finish table, impact classes', () => {
    expect(SKYWAYS_SHOP_PALETTE_IDS.length).toBeGreaterThanOrEqual(5);
    expect(SKYWAYS_SHOP_PALETTE_IDS.length).toBeLessThanOrEqual(7);
    for (const use of Object.keys(STORE_PURPOSES)) expect(SKYWAYS_SHOP_PALETTE_IDS, use).toContain(SKYWAYS_SHOP_PALETTE_OF[use as keyof typeof SKYWAYS_SHOP_PALETTE_OF]);
    for (const p of SKYWAYS_SHOP_PALETTE_IDS) expect(Object.values(SKYWAYS_SHOP_PALETTE_OF), `${p} is used`).toContain(p);
    const wallSig = (p: SkywaysShopPalette) => { const w = SKYWAYS_SHOP_PALETTES[p].wall; return `${w.upper}:${w.upperColor}:${w.lower}:${w.lowerColor}`; };
    const floorSig = (p: SkywaysShopPalette) => { const f = SKYWAYS_SHOP_PALETTES[p].floor; return `${f.code}:${f.a}`; };
    expect(new Set(SKYWAYS_SHOP_PALETTE_IDS.map(wallSig)).size).toBe(SKYWAYS_SHOP_PALETTE_IDS.length);
    expect(new Set(SKYWAYS_SHOP_PALETTE_IDS.map(floorSig)).size).toBe(SKYWAYS_SHOP_PALETTE_IDS.length);
    expect(SKYWAYS_SHOP_TABLE_ROWS).toBe(MALL_TABLE_ROWS);
    const rows = SKYWAYS_SHOP_PALETTE_IDS.flatMap(p => [skywaysShopRows(p).wall, skywaysShopRows(p).floor]);
    expect(new Set(rows).size).toBe(rows.length);
    for (const r of rows) { expect(r).toBeGreaterThanOrEqual(SKYWAYS_SHOP_ROW0); expect(r).toBeLessThan(MALL_TABLE_ROWS); }
    for (const p of SKYWAYS_SHOP_PALETTE_IDS) {
      const wk = skywaysShopWallKey(p), fk = skywaysShopFloorKey(p), f = SKYWAYS_SHOP_PALETTES[p];
      expect(skywaysShopPaletteOfRow(skywaysShopRows(p).wall)).toEqual({palette: p, kind: 'wall'});
      expect(skywaysShopPaletteOfRow(skywaysShopRows(p).floor)).toEqual({palette: p, kind: 'floor'});
      expect(skywaysShopImpact(wk)).toBe(f.impact.wall);
      expect(finishClass(wk)).toBe(f.impact.wall);
      expect(finishClass(fk)).toBe(f.impact.floor);
    }
    expect(finishClass('skyways-shop-wall')).not.toBeNull();
    expect(finishClass('skyways-shop-floor')).not.toBeNull();
  });
});

describe('small-shop palettes on real Skyways layouts (versions 4, 3, 2)', () => {
  for (const {seed, v} of CASES) {
    it(`seed ${seed} v${v}: every small storefront unit takes its use's palette (walls + floor); anchors / station / others never do`, () => {
      const {L, w} = world(seed, v);
      const a = w.skywaysArch!;
      const used = new Set<SkywaysShopPalette>();
      let units = 0;
      for (const sf of L.storefronts) {
        if (sf.unit < 0) continue;
        const p = a.shopPalette(sf.unit);
        if (sf.anchor) { expect(p, `${sf.name}: an anchor`).toBeNull(); continue; }
        expect(p, `${sf.name} (${sf.use})`).toBe(SKYWAYS_SHOP_PALETTE_OF[sf.use]);
        used.add(p!);
        units++;
      }
      const r = L.skyways!.restaurant;
      if (r) expect(a.shopPalette(r.area), 'the ramen dining room').toBe('eatery');
      // walls: every face of a small shop takes its palette; nothing else takes a shop key; no Subway shop tile left in a shop
      let shopFaces = 0;
      for (const f of w.wallFaces) {
        const cls = a.classOf(f.area), p = cls === 'shop' ? a.shopPalette(f.area) : null;
        if (p) { expect(f.finish, `${L.areas[f.area].label}`).toBe(skywaysShopWallKey(p)); shopFaces++; continue; }
        expect(f.finish.startsWith('skyways-shop-'), `${L.areas[f.area]?.label} (${cls}) ${f.finish}`).toBe(false);
      }
      const leftTile = w.wallFaces.filter(f => f.finish === 'tileShop' && a.classOf(f.area) === 'shop');
      expect(leftTile.map(f => L.areas[f.area].label), 'small-shop faces still on the Subway tile').toEqual([]);
      // floors: a cell of every small shop takes its palette's floor
      for (const ar of L.areas) {
        if (a.classOf(ar.id) !== 'shop') continue;
        const p = a.shopPalette(ar.id), g = L.levels[ar.level ?? 0].grid;
        let i = -1;
        for (let y = ar.y; y < ar.y + ar.h && i < 0; y++) for (let x = ar.x; x < ar.x + ar.w; x++) { const j = g.idx(x, y); if (g.cells[j] === FLOOR && g.area[j] === ar.id && g.rampIdx[j] < 0) { i = j; break; } }
        if (i < 0) continue;
        expect(a.floorKey(ar.level ?? 0, i), `${ar.label} floor`).toBe(p ? skywaysShopFloorKey(p) : null);
      }
      fs.appendFileSync(LOG, `seed ${seed} v${v}: ${units} small storefront units, ${shopFaces} shop wall faces, palettes ${[...used].sort().join(',')}\n`);
      expect(units).toBeGreaterThan(10);
      expect(used.size, 'several palettes in one level').toBeGreaterThanOrEqual(4);
    });

    it(`seed ${seed} v${v}: draw-neutral — the Mall finish-row programs, one wall / floor mesh per chunk, palette rows per vertex`, () => {
      const {L, w} = world(seed, v);
      const a = w.skywaysArch!, wallMat = mallSurfaceMaterial('wall'), floorMat = mallSurfaceMaterial('floor');
      const used = a.usedMaterials();
      expect(used.get('skyways-shop-wall')).toBe(wallMat);
      expect(used.get('skyways-shop-floor')).toBe(floorMat);
      const meshes: {wall: THREE.Mesh[]; floor: THREE.Mesh[]} = {wall: [], floor: []};
      w.group.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.material === wallMat) meshes.wall.push(m); if (m.material === floorMat) meshes.floor.push(m); });
      // the chunks holding small-shop surfaces (the builder's 48 m chunks per storey)
      const wallChunks = new Set<string>(), floorChunks = new Set<string>();
      for (const f of w.wallFaces) {
        if (!f.finish.startsWith('skyways-shop-')) continue;
        const alongX = Math.abs(f.z0 - f.z1) < 1e-9, plane = alongX ? f.z0 : f.x0, s0 = alongX ? f.x0 : f.z0, s1 = alongX ? f.x1 : f.z1;
        // (a sloped face — a flight's flank — goes to the builder's stair pseudo-level chunk at its midpoint: world/builder.ts STAIR_LEVEL)
        if (f.slope) { const m = (s0 + s1) / 2; wallChunks.add(`S:${alongX ? Math.floor(m / CHUNK_M) : Math.floor(plane / CHUNK_M)},${alongX ? Math.floor(plane / CHUNK_M) : Math.floor(m / CHUNK_M)}:${f.level}`); continue; }
        for (let c = Math.floor(s0 / CHUNK_M); c * CHUNK_M < s1 - 1e-6; c++) wallChunks.add(`${f.level}:${alongX ? c : Math.floor(plane / CHUNK_M)},${alongX ? Math.floor(plane / CHUNK_M) : c}`);
      }
      for (const lv of L.levels) {
        const g = lv.grid;
        for (let i = 0; i < g.w * g.h; i++) if (g.cells[i] === FLOOR && a.classOf(g.area[i]) === 'shop' && a.shopPalette(g.area[i])) floorChunks.add(`${lv.id}:${Math.floor((i % g.w) * CELL / CHUNK_M)},${Math.floor(Math.floor(i / g.w) * CELL / CHUNK_M)}`);
      }
      fs.appendFileSync(LOG, `seed ${seed} v${v}: shop wall meshes ${meshes.wall.length} (chunks ${wallChunks.size}), shop floor meshes ${meshes.floor.length} (chunks ${floorChunks.size}); station group ${JSON.stringify(w.stats)}\n`);
      expect(meshes.wall.length).toBeGreaterThan(0);
      expect(meshes.wall.length).toBeLessThanOrEqual(wallChunks.size);
      expect(meshes.floor.length).toBeGreaterThan(0);
      expect(meshes.floor.length).toBeLessThanOrEqual(floorChunks.size + 1);
      // the vertex rows are palette rows of the right kind; the table holds the palettes
      for (const [kind, list] of [['wall', meshes.wall], ['floor', meshes.floor]] as const) for (const m of list) {
        const at = m.geometry.getAttribute(MALL_FINISH_ATTR);
        expect(at, m.name).toBeTruthy();
        for (let i = 0; i < at.count; i++) expect(skywaysShopPaletteOfRow(at.getX(i))?.kind, `${m.name} row ${at.getX(i)}`).toBe(kind);
      }
      for (const p of SKYWAYS_SHOP_PALETTE_IDS) {
        expect(close(rowData(skywaysShopRows(p).wall), wallRow(SKYWAYS_SHOP_PALETTES[p].wall).flat()), `${p} wall row`).toBe(true);
        expect(close(rowData(skywaysShopRows(p).floor), floorRow(SKYWAYS_SHOP_PALETTES[p].floor).flat()), `${p} floor row`).toBe(true);
      }
      // a bullet on a shop wall takes the palette's class
      const f = w.wallFaces.find(q => q.finish.startsWith('skyways-shop-') && Math.abs(q.z0 - q.z1) < 1e-9 && q.y1 - q.y0 > 2)!;
      const Lidx = L.levels.findIndex(l => l.id === f.level);
      const key = w.finishAt!('wall', Lidx, (f.x0 + f.x1) / 2, f.y0 + 1.8, f.z0, 0, f.nz);
      expect(key).toBe(f.finish);
      expect(finishClass(key)).toBe(SKYWAYS_SHOP_PALETTES[skywaysShopPaletteOfRow(Number(f.finish.split('|')[1]))!.palette].impact.wall);
    });
  }

  it('a Mall build after a Skyways build leaves the reserved palette rows alone (it allocates its own rows far below them)', () => {
    world(CASES[0].seed, CASES[0].v);
    const before = SKYWAYS_SHOP_PALETTE_IDS.flatMap(p => [rowData(skywaysShopRows(p).wall), rowData(skywaysShopRows(p).floor)]);
    const M = LEVELS.mall.generate('main', {levelSeed: 1, startWeapon: 'pistol'} as never);
    const mw = buildWorld(M, mats, {});
    const rows = mw.mallArch!.summary().rows;
    fs.appendFileSync(LOG, `mall seed 1: ${rows} finish rows (reserved from ${SKYWAYS_SHOP_ROW0})\n`);
    expect(rows).toBeLessThan(SKYWAYS_SHOP_ROW0);
    const after = SKYWAYS_SHOP_PALETTE_IDS.flatMap(p => [rowData(skywaysShopRows(p).wall), rowData(skywaysShopRows(p).floor)]);
    expect(after).toEqual(before);
    expect(mw.skywaysArch).toBeFalsy();
  });
});
