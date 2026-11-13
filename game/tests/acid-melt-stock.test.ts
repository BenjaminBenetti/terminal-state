// Task studio-refinement-batch-20261113-035659-01 (lane MELT): a STOCKED shelf dissolving (world/acidMelt.ts) — its dressed filler stock
// (world/shelfStock.ts + physics/fillerStock.ts: the real shelf.glb boards, the real PhysicsSystem, attached as Game.buildSection does)
// never floats on the vanished boards: the boards leave the filler's way, every piece resting on them wakes ('support') and falls to the
// floor below; none is lost or duplicated; the shelf's collider goes and it yields its one salvage.
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installStockCanvas, loadModel, stockProp} from './helpers/stockHelpers';
import {FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import type {PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import {PhysicsSystem} from '../src/physics/world';
import {FILLER_TUNING} from '../src/physics/fillerStock';
import {ShelfStock} from '../src/world/shelfStock';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {sectionId, type SectionKey} from '../src/levels/types';
import {AcidMelt, MELT, propSalvage, type AcidMeltHost} from '../src/world/acidMelt';

let uninstall: () => void = () => {};
let shelf: GLTF;
beforeAll(async () => { uninstall = await installStockCanvas(false); shelf = await loadModel('shelf.glb'); });
afterAll(() => uninstall());

/** A walled hall (floor 0) with a track bed strip (tests/shelfStock-physics.test.ts). */
function hall(props: PropPlacement[], seed = 77) {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : y >= 24 ? VOID : FLOOR);
  return {grid: g, props, trench: {floorY: -1.15}, areas: [{purpose: 'convenience'}], seed};
}

describe('acid melt: a stocked shelf', () => {
  it('its filler falls to the floor when the boards dissolve (none lost); its collider goes; one salvage', () => {
    const sh = stockProp('stockShelf', 8, 3, {variant: 1});
    const L = hall([sh]);
    const ph = new PhysicsSystem(null);
    ph.build(L as never);
    const S = new ShelfStock();
    S.filler.attach(ph);
    ph.holderBoxes = p => S.physicsBoxes(p, null);
    S.build(L as never, {models: {shelf}});
    const mine = S.filler.pieces.filter(p => p.holder === 0);
    expect(mine.length).toBeGreaterThan(10);
    const high = mine.filter(p => p.p.y > 0.4).length;
    expect(high).toBeGreaterThan(5);
    // the melt on the Game's registries over this world (the shelf drawn by the shared render: a stand-in render index)
    const key: SectionKey = {level: 'subway', section: 'main'};
    const lanes = new Map<string, unknown>();
    const pickups = new PickupManager({});
    const host = {
      scene: new THREE.Scene(), run: {current: key, laneStore: (l: string, k: SectionKey = key) => lanes.get(`${sectionId(k)}/${l}`), setLaneStore: (l: string, d: unknown, k: SectionKey = key) => { lanes.set(`${sectionId(k)}/${l}`, d); }},
      layout: L as unknown as StationLayout, levels: null, propIndex: {props: L.props}, inv: new Inventory(), pickups, containers: null, physics: ph,
      damage: {props: {index: {inst: new Map([[sh, [{mesh: null, index: 0}]]]), merged: []}, retire: () => ({meshes: [], geometries: []}), isRetired: () => false}},
      stock: S, sectionLayoutHooks: [] as AcidMeltHost['sectionLayoutHooks'], sectionHooks: [] as AcidMeltHost['sectionHooks'], frameHooks: [] as AcidMeltHost['frameHooks'],
    };
    const melt = new AcidMelt(host as unknown as AcidMeltHost).install();
    for (const f of host.sectionLayoutHooks) f(L as never, key, undefined as never, 'build');
    for (const s of host.sectionHooks) s.build?.(L as never);
    const ref = melt.inDisc(sh.x, 0, sh.z, 0.3).find(r => r.key === 'p:0')!;
    expect(ref).toBeTruthy();
    expect(melt.start(ref)).toBe(true);
    const was = new Map(mine.map(p => [p, p.p.clone()]));
    for (let t = 0; t < MELT.seconds + 0.1; t += 1 / 60) { ph.update(1 / 60); melt.tick(1 / 60); }
    // its collider goes: no box in the chunk builder (h 0), its boards out of the filler's way
    expect(sh.h).toBe(0);
    for (const b of S.physicsBoxes(sh, null) ?? []) expect(b.max.y).toBeLessThan(-1000);
    // the first batch falls now, within the filler's body pool; there are more than it holds: the rest wait their turn (never put back to
    // rest in the air by the pool's own room-making, which retires the oldest CALM body — a just-woken one)
    expect(mine.length).toBeGreaterThan(FILLER_TUNING.maxActive);
    expect(S.filler.awake).toBeGreaterThan(10);
    expect(S.filler.awake).toBeLessThanOrEqual(FILLER_TUNING.maxActive);
    expect((melt.qa() as {falling: number}).falling).toBeGreaterThan(0);
    for (let t = 0; t < 8; t += 1 / 60) { ph.update(1 / 60); melt.tick(1 / 60); }
    expect(S.filler.awake).toBe(0);
    expect((melt.qa() as {falling: number}).falling).toBe(0);
    expect(melt.counts.stuck).toBe(0);
    // none lost / duplicated; none still up where it was; each on the floor or on another piece (a heap under the vanished boards)
    const after = S.filler.pieces.filter(p => p.holder === 0);
    expect(after).toHaveLength(mine.length);
    expect(new Set(after.map(p => p.id)).size).toBe(mine.length);
    const stillUp = after.filter(p => was.get(p)!.y > 0.25 && p.p.distanceTo(was.get(p)!) < 0.05).map(p => p.id);
    expect(stillUp, 'pieces still where the boards were').toEqual([]);
    const overlap = (a: THREE.Box3, b: THREE.Box3) => a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z;
    const unsupported = after.filter(p => p.box.min.y > 0.03 && !after.some(q => q !== p && overlap(p.box, q.box) && q.box.min.y < p.box.min.y && q.box.max.y > p.box.min.y - 0.03));
    expect(unsupported.map(p => [p.id, +p.box.min.y.toFixed(2)]), 'pieces resting on nothing').toEqual([]);
    for (const p of after) { expect(p.box.min.y).toBeGreaterThan(-0.03); expect(p.p.y).toBeLessThan(0.7); }
    const salv = pickups.list.filter(p => p.stack.itemId === ELECTRICAL_PARTS || p.stack.itemId === SCRAP_METAL);
    expect(salv.map(p => p.stack.itemId)).toEqual([propSalvage(sh.kind)]);
  }, 60000);
});
