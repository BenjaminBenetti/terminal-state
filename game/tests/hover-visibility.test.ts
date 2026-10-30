// Task office-overhaul-20261030 (lane INTERACT), user feedback #12: "mousing over some small items like water bottles causes them
// to go invisible". Regression tests over the REAL selection paths, every item kind (water, cola, juice, food, batteries, flares,
// medical items, gear, ammo):
//  - world/lootDisplay.ts: an aimed loot lot leaves its instanced batch and is drawn by a pulsing highlight copy. The root cause
//    was the per-item copy being cached INSIDE the containers group across stations, so the next station's level culler
//    (world/levelCulling.ts, registered over the containers group by game.ts) registered it with the box of the lot it had last
//    highlighted and moved it to the cull layer — the hovered item vanished. Here: several builds with a real LevelCuller each,
//    the drawn instance count of every kind before / during / after hover, layers vs the camera, the copy's world transform.
//  - world/containers.ts target() -> update() -> refresh() on a real ContainerManager, rebuilt twice with a culler each time.
//  - world/pickups.ts (loose items) and world/groundBag.ts: the look-at highlight only changes emissive — never visibility,
//    layers, parenting or the material count.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, rowLayout} from './helpers/openablesFixture';
import {ITEMS, itemDef} from '../src/items/items';
import {Inventory} from '../src/items/inventory';
import {LotDisplay, type LotInstance} from '../src/world/lootDisplay';
import {PickupManager} from '../src/world/pickups';
import {GroundBag} from '../src/world/groundBag';
import {LevelCuller} from '../src/world/levelCulling';
import {LevelColumns} from '../src/world/levelGeometry';
import {FLOOR, Grid} from '../src/gen/grid';
import type {Level} from '../src/gen/levels';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type Holder} from '../src/world/containers';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

/** Every item that can rest on a holder / lie loose: all non-weapon catalogue items (weapons lie as gun pickups). */
const KINDS = Object.keys(ITEMS).filter(id => itemDef(id).kind !== 'weapon');

/** A flat single-storey hall (cells 0.5 m) the culler can work on: W x H cells, 4 m ceiling. */
function hall(W = 140, H = 30): {levels: Level[]; cols: LevelColumns; grid: Grid} {
  const g = new Grid(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { g.set(x, y, FLOOR); g.ceil[g.idx(x, y)] = 4; }
  const levels: Level[] = [{id: 0, role: 'main', grid: g, baseY: 0} as Level];
  return {levels, cols: new LevelColumns(levels), grid: g};
}

const camAt = (x: number, z: number, lookX = x, lookZ = z - 5) => {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  c.position.set(x, 1.6, z);
  c.lookAt(lookX, 1.0, lookZ);
  c.updateMatrixWorld(true);
  return c;
};

/** Visible through its whole parent chain up to `root`, and attached to it. */
function shownUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    if (p === root) return true;
    p = p.parent;
  }
  return false;
}

/**
 * Instances of `itemId` a camera draws under `root`: the batch's live instance count (first part; every part has the same count)
 * plus 1 for a shown highlight copy whose every mesh is on a camera layer. Anything on the cull layer is not drawn.
 */
function drawn(root: THREE.Object3D, cam: THREE.Camera, itemId: string): number {
  let n = 0, batchSeen = false;
  root.traverse(o => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && im.name === `loot-${itemId}` && !batchSeen) {
      batchSeen = true;
      if (shownUnder(im, root) && im.layers.test(cam.layers)) n += im.count;
    }
    if (o.name === `loot-highlight-${itemId}` && shownUnder(o, root)) {
      const meshes: THREE.Mesh[] = [];
      o.traverse(x => { if ((x as THREE.Mesh).isMesh) meshes.push(x as THREE.Mesh); });
      if (meshes.length && meshes.every(m => m.visible && m.layers.test(cam.layers))) n++;
    }
  });
  return n;
}

const lotAt = (id: number, itemId: string, x: number, z: number): LotInstance => ({id, itemId, matrix: new THREE.Matrix4().makeTranslation(x, 0.9, z)});

describe('loot highlight copy (world/lootDisplay.ts) — every item kind', () => {
  it('before / during / after hover each kind is drawn exactly once; the copy sits on the lot, glows and is on a camera layer', () => {
    const d = new LotDisplay();
    const scene = new THREE.Scene();
    scene.add(d.group);
    d.allocate(new Map(KINDS.map(k => [k, 1])));
    const lots = KINDS.map((k, i) => lotAt(i + 1, k, 1 + i * 0.6, 3));
    const cam = camAt(10, 8);
    d.show(lots, null);
    for (const k of KINDS) expect(drawn(scene, cam, k), `${k} before`).toBe(1);
    for (const l of lots) {
      d.show(lots, l.id);
      d.pulse(1.234);
      scene.updateMatrixWorld(true);
      for (const k of KINDS) expect(drawn(scene, cam, k), `${k} while ${l.itemId} is hovered`).toBe(1);
      const hl = d.highlightObject!;
      expect(hl.name).toBe(`loot-highlight-${l.itemId}`);
      expect(new THREE.Vector3().setFromMatrixPosition(hl.matrixWorld).distanceTo(new THREE.Vector3().setFromMatrixPosition(l.matrix))).toBeLessThan(1e-9);
      const em: number[] = [];
      hl.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined; for (const x of m ? (Array.isArray(m) ? m : [m]) : []) if (x.emissive) em.push(x.emissive.r); });
      expect(em.length, `${l.itemId} highlight materials`).toBeGreaterThan(0);
      expect(Math.max(...em), `${l.itemId} glows`).toBeGreaterThan(0.05);
    }
    d.show(lots, null);
    for (const k of KINDS) expect(drawn(scene, cam, k), `${k} after`).toBe(1);
    expect(d.highlightObject).toBeNull();
  });

  it('across several stations with a level culler each (as game.ts registers the containers group), a hovered item never vanishes', () => {
    const {levels, cols} = hall();
    const d = new LotDisplay();
    const containers = new THREE.Group(); // game.ts: the ContainerManager group (holds the display group) is culler-registered
    containers.add(d.group);
    const scene = new THREE.Scene();
    scene.add(containers);
    const station = (x0: number, eyeX: number) => {
      d.allocate(new Map(KINDS.map(k => [k, 1])));
      const culler = new LevelCuller(levels, cols, () => 0);
      culler.maxDistance = 20; // fog culling: far boxes go to the cull layer
      culler.register(containers);
      const cam = camAt(eyeX, 5, eyeX - 100, 3); // looking west down the hall, over this station's lots
      culler.update(cam, true);
      return {culler, cam, lots: KINDS.map((k, i) => lotAt(i + 1, k, x0 + (i % 12) * 0.4, 3 + Math.floor(i / 12) * 0.5))};
    };
    // station 1: every kind hovered at the WEST end
    const s1 = station(2, 10);
    for (const l of s1.lots) {
      d.show(s1.lots, l.id);
      scene.updateMatrixWorld(true);
      s1.culler.update(s1.cam, true);
      expect(drawn(scene, s1.cam, l.itemId), `station 1 ${l.itemId}`).toBe(1);
    }
    d.clear(); // leaveSection -> containers.clear()
    // station 2 (a new level / Retry): lots at the EAST end, 60 m from where the copies were last shown
    const s2 = station(62, 70);
    const underCopy = (o: THREE.Object3D | null): boolean => !!o && (o.name.startsWith('loot-highlight') || underCopy(o.parent));
    expect(s2.culler.entries.some(e => underCopy(e.obj)), 'copies never registered with a culler').toBe(false);
    for (const l of s2.lots) {
      d.show(s2.lots, l.id);
      scene.updateMatrixWorld(true);
      s2.culler.update(s2.cam, true);
      expect(drawn(scene, s2.cam, l.itemId), `station 2 ${l.itemId} while hovered`).toBe(1);
    }
    // station 2: also hover far-west lots once (a culler that knew the copies would cull them there), then a third station
    d.show(s1.lots, s1.lots[0].id);
    s2.culler.update(camAt(70, 5, 170, 3), true); // (facing east: the west lots are behind)
    d.clear();
    const s3 = station(30, 38);
    for (const l of s3.lots) {
      d.show(s3.lots, l.id);
      scene.updateMatrixWorld(true);
      s3.culler.update(s3.cam, true);
      expect(drawn(scene, s3.cam, l.itemId), `station 3 ${l.itemId} while hovered`).toBe(1);
    }
    d.show(s3.lots, null);
    for (const k of KINDS) expect(drawn(scene, s3.cam, k), `station 3 ${k} after`).toBe(1);
  });
});

describe('real holder targeting (world/containers.ts target -> update -> refresh), rebuilt with a culler each time', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  /** A row of shelves along a 60 m hall wall; the first seed whose shelves hold lots at both ends. */
  function hallWithLots(): {layout: ReturnType<typeof rowLayout>; cm: ContainerManager} {
    for (let seed = 1; seed < 80; seed++) {
      const layout = rowLayout(new Array(44).fill('shelf'), {seed, gap: 0.15});
      const cm = new ContainerManager({}, mats, () => new Inventory());
      cm.build(layout);
      const withLots = cm.all.filter(h => h.state.lots.length);
      if (withLots.some(h => h.prop.x < 12) && withLots.some(h => h.prop.x > 40)) return {layout, cm};
    }
    throw new Error('no seed with lots at both ends');
  }
  const aimAt = (cm: ContainerManager, h: Holder, grid: Grid) => {
    const l = h.state.lots[0];
    const b = h.lotBoxes.get(l.id)!;
    const c = b.getCenter(new THREE.Vector3());
    const eye = new THREE.Vector3(c.x, 1.55, c.z + 1.1);
    const dir = c.clone().sub(eye).normalize();
    const t = cm.target(eye, dir, grid);
    return {t, eye, l};
  };

  it('the aimed lot stays drawn (copy on a camera layer) on the first station and after two rebuilds', () => {
    const {layout, cm} = hallWithLots();
    const grid = layout.grid as Grid;
    const levels: Level[] = [{id: 0, role: 'main', grid, baseY: 0} as Level];
    const cols = new LevelColumns(levels);
    const scene = new THREE.Scene();
    scene.add(cm.group);
    const run = (pick: (hs: Holder[]) => Holder) => {
      const culler = new LevelCuller(levels, cols, () => 0);
      culler.maxDistance = 15;
      culler.register(cm.group);
      const h = pick(cm.all.filter(x => x.state.lots.length));
      const {t, eye, l} = aimAt(cm, h, grid);
      expect(t?.lot?.id, 'the lot is targeted').toBe(l.id);
      cm.update(1 / 60, 0.5);
      scene.updateMatrixWorld(true);
      const cam = camAt(eye.x, eye.z, eye.x, eye.z - 2);
      culler.update(cam, true);
      const shown = h.state.lots.filter(x => x.itemId === l.itemId).length;
      // every lot of this kind on the holder is drawn (the aimed one by its copy) — nothing vanished
      expect(drawn(cm.group, cam, l.itemId)).toBeGreaterThanOrEqual(shown);
      let copy: THREE.Object3D | null = null;
      cm.group.traverse(o => { if (o.name === `loot-highlight-${l.itemId}` && o.visible) copy = o; });
      expect(copy, `${l.itemId} highlight copy`).not.toBeNull();
      // look away: back into the batch
      cm.target(eye, new THREE.Vector3(0, 1, 0), grid);
      cm.update(1 / 60, 0.6);
      culler.update(cam, true);
      expect(drawn(cm.group, cam, l.itemId)).toBeGreaterThanOrEqual(shown);
      return l.itemId;
    };
    run(hs => hs[0]); // west end
    cm.build(layout); // Retry level / re-entering: same ContainerManager, new culler
    run(hs => hs[hs.length - 1]); // east end, ~40 m away
    cm.build(layout);
    run(hs => hs[Math.floor(hs.length / 2)]);
  });
});

describe('loose pickups and grounded bags: the look-at highlight only changes emissive', () => {
  it('PickupManager.target / update over every item kind: visibility, layers, parent and meshes never change', () => {
    const pm = new PickupManager({});
    const inv = new Inventory();
    const scene = new THREE.Scene();
    scene.add(pm.group);
    const g = hall(40, 12).grid;
    const ps = KINDS.map((k, i) => pm.add(inv.makeStack(k, 1), 1 + (i % 18) * 1.0, 0, 1 + Math.floor(i / 18) * 2.5, 0));
    const state = () => ps.map(p => { const out: string[] = []; p.obj.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(`${o.visible}|${o.layers.mask}|${(o as THREE.Mesh).geometry.uuid}`); }); return `${p.obj.parent === pm.group}|${p.obj.visible}|${out.join(',')}`; });
    const before = state();
    for (const p of ps) {
      const eye = new THREE.Vector3(p.x, 1.6, p.z + 0.9);
      const dir = new THREE.Vector3(p.x, p.y + 0.08, p.z).sub(eye).normalize();
      expect(pm.target(eye, dir, g), p.stack.itemId).toBe(p);
      pm.update(0.4);
      expect(Math.max(...p.mats.map(m => m.emissive?.r ?? 0)), `${p.stack.itemId} glows`).toBeGreaterThan(0.05);
      expect(state()).toEqual(before);
    }
    pm.target(new THREE.Vector3(0, 1e6, 0), new THREE.Vector3(0, -1, 0), g);
    pm.update(0.5);
    expect(state()).toEqual(before);
    expect(pm.list).toHaveLength(KINDS.length);
  });

  it('a grounded bag glows when aimed and stays visible', () => {
    const inv = new Inventory();
    const b = new GroundBag('bag:1', inv.makeStack('backpack', 1), {x: 1, y: 0, z: 1, yaw: 0, level: 0});
    const vis = () => { const v: boolean[] = []; b.obj.traverse(o => v.push(o.visible)); return v.join(); };
    const v0 = vis();
    b.glow(0.2);
    expect(vis()).toBe(v0);
    expect(Math.max(...b.mats.map(m => m.emissive.r))).toBeGreaterThan(0.1);
  });
});
