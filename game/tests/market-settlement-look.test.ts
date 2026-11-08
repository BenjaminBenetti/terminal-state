// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): the LOOK of the Survivor Market's layout version 2 — the builder's
// container paints (every exterior wall takes its container's paint: the existing Codex corrugated textures tinted, arch-owned steel for
// impacts), plywood-lined container interiors and floors, corrugated rooftops; the art derived from the layout (gen/market/v2/art.ts):
// fans high over the yard / lanes only, an awning on the lane side of every stall / tea / kitchen / repair opening (never under a
// bridge), laundry / cable lines across the lanes high over every walking band; world/marketVisuals.ts builds them.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {buildMarketView} from '../src/world/marketVisuals';
import {MARKET_KEYS, MARKET_PAINTS, marketPaintKey, settleAreaClass} from '../src/world/marketArch';
import {finishClass} from '../src/damage/impactFinish';
import {isArchFinish} from '../src/world/finishAt';
import {marketAwnings, marketFans} from '../src/gen/market/art';
import {settleLines} from '../src/gen/market/v2/art';
import {SETTLE} from '../src/gen/market/v2/frame';
import {generateMarketLevel} from '../src/gen/market/index';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
const L = generateMarketLevel({levelSeed: 77}) as StationLayout;

describe('the Survivor Market look, layout version 2', () => {
  it('the builder paints the containers (several paints), plywood inside, corrugated rooftops; every key arch-owned', () => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(L, mats, {});
    expect(w.marketArch?.v2).toBe(true);
    const names = new Set<string>();
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) names.add(((o as THREE.Mesh).material as THREE.Material).name || o.name); });
    const used = [...names];
    const paints = MARKET_PAINTS.map((_, i) => marketPaintKey(i)).filter(k => used.includes(k));
    expect(paints.length).toBeGreaterThanOrEqual(4);
    for (const k of [MARKET_KEYS.ply, MARKET_KEYS.deck, MARKET_KEYS.roof]) expect(used, k).toContain(k);
    for (const k of [...MARKET_PAINTS.map((_, i) => marketPaintKey(i)), ...Object.values(MARKET_KEYS)]) { expect(isArchFinish(k)).toBe(true); expect(finishClass(k), k).not.toBeNull(); }
    // floors: plywood containers / catwalks, corrugated rooftops, concrete lanes; the platform keeps its slab
    const arch = w.marketArch!, g0 = L.grid;
    const cellOfArea = (lv: number, pred: (a: StationLayout['areas'][number]) => boolean) => {
      const g = L.levels[lv].grid;
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === 1 && g.area[i] >= 0 && pred(L.areas[g.area[i]]) && g.rampIdx[i] < 0) return i;
      return -1;
    };
    expect(arch.floorKey(0, cellOfArea(0, a => a.kind === 'room'))).toBe(MARKET_KEYS.deck);
    expect(arch.floorKey(0, cellOfArea(0, a => a.label === 'Market Lane'))).toBe('concrete');
    expect(arch.floorKey(1, cellOfArea(1, a => a.kind === 'concourse'))).toBe(MARKET_KEYS.deck);
    expect(arch.floorKey(2, cellOfArea(2, () => true))).toBe(MARKET_KEYS.roof);
    expect(arch.floorKey(0, g0.idx(...g0.cellOf(L.playerSpawn.x, L.playerSpawn.z)))).toBeNull();
    expect(settleAreaClass(L.areas[L.platform])).toBe('platform');
  });

  it('fans high over open floor, awnings on the lane side of the openings (never under a bridge), lines high across the lanes', () => {
    const open = (x: number, z: number) => { const i = L.grid.idx(...L.grid.cellOf(x, z)); return L.levels[1].grid.cells[i] === 0 && L.levels[2].grid.cells[i] === 0 && L.grid.ceil[i] >= SETTLE.roofY - 0.05; };
    const fans = marketFans(L);
    expect(fans.length).toBeGreaterThanOrEqual(2);
    for (const f of fans) {
      expect(f.y).toBeGreaterThan(SETTLE.bases[2] + 0.6); // higher than even a rooftop walker could reach, over open floor only
      expect(f.y + f.rod).toBeCloseTo(SETTLE.roofY, 6); // hung from the shed roof
      for (const [dx, dz] of [[0, 0], [f.r, 0], [-f.r, 0], [0, f.r], [0, -f.r]]) expect(open(f.x + dx, f.z + dz)).toBe(true);
    }
    const aw = marketAwnings(L);
    // every stall's opening has its awning, unless a bridge covers that frontage of the lane
    for (const s of L.market!.stalls) {
      const d = L.doors.find(q => q.b === s.area)!, north = L.areas[s.area].y > d.y, z = north ? d.y * CELL - 0.5 : (d.y + 1) * CELL + 0.5;
      let bridged = false;
      for (let x = d.x * CELL; x <= (d.x + d.w) * CELL; x += 0.25) if (L.grid.ceilAt(x, z) < SETTLE.bases[1]) bridged = true;
      expect(aw.some(a => a.stall === s.id) || bridged, s.id).toBe(true);
    }
    expect(aw.length).toBeGreaterThanOrEqual(4);
    for (const a of aw) {
      expect(a.yEdge).toBeGreaterThanOrEqual(2.4);
      expect(a.yWall).toBeLessThan(SETTLE.bases[1]); // under the catwalk edge
      const zOut = a.z + a.dir! * (a.depth - 0.05), xm = (a.x0 + a.x1) / 2;
      const i = L.grid.idx(...L.grid.cellOf(xm, zOut));
      expect(L.areas[L.grid.area[i]].kind).toBe('concourse'); // reaches out over the lane
      expect(L.grid.ceil[i]).toBeGreaterThan(a.yWall); // no bridge over it
    }
    const lines = settleLines(L);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) {
      expect(l.y - l.sag - 0.7).toBeGreaterThan(SETTLE.bases[1] + 1.2); // laundry hangs well above the lane and the catwalk walkers' heads
      expect(open((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2)).toBe(true);
      expect(Math.abs(l.z1 - l.z0) / CELL).toBeGreaterThanOrEqual(6); // across a whole lane (catwalk edge to catwalk edge)
    }
    const v = buildMarketView(L)!;
    expect(v.awnings).toBe(aw.length);
    expect(v.lines).toBe(lines.length);
    expect(v.root.getObjectByName('market-laundry')).toBeDefined();
    expect(v.root.getObjectByName('market-lines')).toBeDefined();
  });
});
