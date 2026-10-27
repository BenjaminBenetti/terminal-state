// Iteration 07 (Lane K): shot impulses on physical items + proper physics chunks. Node tests (no WebGL):
// a shot can moves / tips / rolls, collides with the floor, settles and SLEEPS (body retired); its render
// transform, targeting anchor and ray collider follow it (nothing left at the old spot); loot lots are
// lifted off their holder into pickups with the same item / count (never duplicated, never lost) and fall
// from shelf tiers; the item budget freezes (never deletes) the oldest; world / flesh chunks are real
// bounded bodies that land on per-cell floors and are cleaned up on New Station; zombie flesh / cloth
// patches are cut from the POSED skinned mesh (animated and ragdolled) and leave a persistent tear;
// step cost stays within budget.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {installCanvasShim} from './helpers/canvas2d';
import {FLOOR, Grid, SOLID, VOID} from '../src/gen/grid';
import {generateStation} from '../src/gen/station';
import type {PropPlacement} from '../src/gen/props';
import {PhysicsSystem} from '../src/physics/world';
import {MAX_DYNAMIC_ITEMS, type PickupLike} from '../src/physics/dynamicItems';
import {MAX_FLESH_CHUNKS, MAX_WORLD_CHUNK_BODIES} from '../src/physics/chunks';
import {holderBoxes} from '../src/physics/holderShapes';
import {extractPatch} from '../src/damage/fleshPatch';
import {DamageSystem, SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import {installWounds, woundsOf} from '../src/damage/wounds';
import {DEBRIS_TOTAL_CAP} from '../src/damage/debris';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {ContainerManager} from '../src/world/containers';
import {PickupManager} from '../src/world/pickups';
import {Inventory} from '../src/items/inventory';
import {ZombieActor} from '../src/ai/zombieActor';

installCanvasShim(false);
{
  const ctx0 = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document.createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx0) as Record<string, unknown>;
  for (const k of ['clip', 'setLineDash', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse']) if (typeof proto[k] !== 'function') proto[k] = () => {};
}

function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 24 x 16 m room: solid border, floor, a raised 0.6 m dais (x 2..6 m) and a track-bed trench (z 12..15 m). */
function testLayout(props: PropPlacement[] = []) {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
    const border = x < 2 || y < 2 || x >= 46 || y >= 30;
    g.set(x, y, border ? SOLID : y >= 24 ? VOID : FLOOR);
  }
  return {grid: g, props, trench: {floorY: -1.15}};
}

/** A cola-can-like pickup (model origin bottom-centre, 6.6 x 12.2 cm). */
function can(x: number, y: number, z: number, id = 'cola'): PickupLike {
  const obj = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12);
  geo.translate(0, 0.061, 0);
  obj.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));
  obj.position.set(x, y, z);
  const scene = new THREE.Group();
  scene.add(obj);
  scene.updateMatrixWorld(true);
  return {stack: {itemId: id, uid: 1, count: 1}, x, y, z, obj};
}

function run(ph: PhysicsSystem, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) { ph.update(1 / 60); each?.(); }
}

describe('shot impulses on loose items', () => {
  it('a shot can tips / rolls / slides, stays on the floor, settles, sleeps and its anchor + collider follow', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    const p = can(8, 0, 6);
    const sounds: string[] = [];
    ph.audio = {physImpact: (_x, _y, _z, _s, f) => sounds.push(f)};
    // rifle bullet from the left at eye height toward the can's upper half
    const origin = new THREE.Vector3(5.5, 1.6, 6.02), aim = new THREE.Vector3(8, 0.09, 6);
    const dir = aim.clone().sub(origin).normalize();
    const hits = ph.dynamicItems.rayHits(origin, dir, 10, [p]);
    expect(hits.length).toBe(1);
    expect(ph.dynamicItems.shootPickup(p, hits[0].point, dir, 24 * SHOT_IMPULSE_PER_DAMAGE)).toBe(true);
    expect(ph.dynamicItems.stats().itemsAwake).toBe(1);
    let maxSpeed = 0, minY = Infinity, maxTilt = 0, stepped = 0;
    const t0 = performance.now();
    run(ph, 6, () => {
      stepped++;
      const pos = p.obj.position;
      minY = Math.min(minY, pos.y);
      maxTilt = Math.max(maxTilt, new THREE.Vector3(0, 1, 0).applyQuaternion(p.obj.quaternion).angleTo(new THREE.Vector3(0, 1, 0)));
      maxSpeed = Math.max(maxSpeed, Math.hypot(pos.x - 8, pos.z - 6));
    });
    const ms = (performance.now() - t0) / stepped;
    const moved = Math.hypot(p.obj.position.x - 8, p.obj.position.z - 6);
    console.info(`[can] moved ${moved.toFixed(2)} m, tilt ${(maxTilt * 57.3).toFixed(0)} deg, minY ${minY.toFixed(3)}, ${ms.toFixed(3)} ms/frame, sounds ${sounds.join(',')}`);
    expect(moved).toBeGreaterThan(0.25); // it really went somewhere
    expect(moved).toBeLessThan(8);
    expect(maxTilt).toBeGreaterThan(0.5); // tipped / tumbled, not just slid upright
    expect(minY).toBeGreaterThan(-0.02); // never through the floor (model origin = can bottom / side)
    // settled + slept: body retired, the pickup simply rests
    expect(ph.dynamicItems.stats().itemsAwake).toBe(0);
    expect(ph.stats().bodies).toBe(0);
    const c = new THREE.Box3().setFromObject(p.obj);
    expect(c.min.y).toBeGreaterThan(-0.01);
    expect(c.min.y).toBeLessThan(0.02);
    // targeting anchor follows the item (PickupManager aims at y + 0.08)
    const centre = c.getCenter(new THREE.Vector3());
    expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeLessThan(0.02);
    expect(Math.abs(p.y + 0.08 - centre.y)).toBeLessThan(0.03);
    // the ray collider moved with it: the old spot is empty, the new spot is hit
    const old = ph.dynamicItems.rayHits(new THREE.Vector3(8, 0.06, 5), new THREE.Vector3(0, 0, 1), 3, [p]);
    if (moved > 0.12) expect(old.length).toBe(0);
    const now = ph.dynamicItems.rayHits(new THREE.Vector3(centre.x, 1.5, centre.z), new THREE.Vector3(0, -1, 0), 3, [p]);
    expect(now.length).toBe(1);
    expect(sounds).toContain('can');
    expect(ms).toBeLessThan(2.5);
  });

  it('pool cap: shooting more items than the budget freezes the oldest (never deletes); all resume and settle', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    const items: PickupLike[] = [];
    for (let i = 0; i < MAX_DYNAMIC_ITEMS + 8; i++) items.push(can(5 + (i % 8) * 0.5, 0, 5 + Math.floor(i / 8) * 0.6, i % 2 ? 'cola' : 'beans'));
    for (const p of items) ph.dynamicItems.shootPickup(p, p.obj.position.clone().add(new THREE.Vector3(-0.03, 0.08, 0)), new THREE.Vector3(1, 0.1, 0.05).normalize(), 1.3);
    const s = ph.dynamicItems.stats();
    expect(s.itemsAwake).toBeLessThanOrEqual(MAX_DYNAMIC_ITEMS);
    expect(s.items).toBe(items.length); // every item still tracked, none removed
    expect(s.counts.frozen).toBeGreaterThan(0);
    for (const p of items) expect(p.obj.parent).not.toBeNull();
    let maxAwake = 0;
    run(ph, 10, () => { maxAwake = Math.max(maxAwake, ph.dynamicItems.stats().itemsAwake); });
    expect(maxAwake).toBeLessThanOrEqual(MAX_DYNAMIC_ITEMS);
    expect(ph.dynamicItems.stats().counts.reactivated).toBeGreaterThan(0);
    expect(ph.dynamicItems.stats().pending).toBe(0);
    expect(ph.dynamicItems.stats().itemsAwake).toBe(0);
    for (const p of items) {
      const b = new THREE.Box3().setFromObject(p.obj);
      expect(b.min.y).toBeGreaterThan(-0.02); // rests on the floor, nothing floating far above or sunk
      expect(b.min.y).toBeLessThan(0.15);
    }
    // a taken pickup's body is dropped
    ph.dynamicItems.shootPickup(items[0], items[0].obj.position.clone(), new THREE.Vector3(0, 0, 1), 1);
    items[0].obj.parent!.remove(items[0].obj);
    ph.update(1 / 60);
    expect(ph.dynamicItems.stats().items).toBe(items.length - 1);
    ph.build(testLayout()); // New Station
    expect(ph.dynamicItems.stats().items).toBe(0);
    expect(ph.stats().bodies).toBe(0);
  });

  it('a flying can knocks a resting neighbour over (knock-on activation: it gets a body before the contact)', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    const a = can(8, 0, 6), b = can(8.25, 0, 6);
    ph.dynamicItems.pickups = () => [a, b];
    ph.dynamicItems.shootPickup(a, new THREE.Vector3(7.967, 0.07, 6), new THREE.Vector3(1, 0.05, 0).normalize(), 1.6);
    run(ph, 5);
    expect(ph.dynamicItems.stats().counts.knockOn).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(b.obj.position.x - 8.25, b.obj.position.z - 6)).toBeGreaterThan(0.05); // b was pushed by the contact
    expect(ph.dynamicItems.stats().itemsAwake).toBe(0);
  });

  it('cans fall off a raised step down onto the track bed (per-cell floor heights)', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    const p = can(8, 0, 11.85);
    ph.dynamicItems.shootPickup(p, new THREE.Vector3(8, 0.06, 11.82), new THREE.Vector3(0, 0, 1), 1.3);
    run(ph, 6);
    const b = new THREE.Box3().setFromObject(p.obj);
    expect(p.obj.position.z).toBeGreaterThan(12);
    expect(b.min.y).toBeGreaterThan(-1.17);
    expect(b.min.y).toBeLessThan(-1.08); // resting on the trench floor (-1.15)
  });
});

// ---------------------------------------------------------------------------------------

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

function station(seed: number) {
  const layout = generateStation(seed);
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const world = buildWorld(layout, mats, {});
  const inv = new Inventory();
  const cm = new ContainerManager({}, mats, () => inv);
  cm.build(layout);
  const pickups = new PickupManager({});
  const ph = new PhysicsSystem(null);
  ph.build(layout);
  ph.holderBoxes = p => cm.physicsBoxes(p);
  const sys = new DamageSystem(null, null);
  sys.rand = mulberry(5);
  sys.build(layout, mats, [world.group, cm.group], {
    ownMeshes: p => cm.ownMeshes(p),
    onBreak: e => { const h = cm.holderFor(e.prop); if (h) cm.breakHolder(h, e.kind); ph.propsChanged(e.prop.x, e.prop.z); },
    pickups: () => pickups.list,
    physics: ph,
    lots: (o, d, maxT) => cm.shotLots(o, d, maxT),
    detachLot: (h, lotId) => {
      const r = cm.detachLot(h as Parameters<typeof cm.detachLot>[0], lotId);
      if (!r) return null;
      const st = inv.makeStack(r.lot.itemId, r.lot.count);
      st.count = r.lot.count;
      return pickups.addAt(st, r.matrix, {holder: r.holder, lot: r.lot.id});
    },
  });
  return {layout, mats, world, cm, inv, pickups, ph, sys};
}

describe('loot lots become loose physical items (finite loot preserved)', () => {
  it('a can on a shelf tier is lifted off its holder (same id / count), drops tier to tier, and is taken exactly once', () => {
    type St = ReturnType<typeof station>;
    type H = St['cm']['all'][number];
    let st: St | null = null;
    let pick: {h: H; lot: H['state']['lots'][number]} | null = null;
    for (const seed of [424242, 1717, 90210, 31337, 2024, 77]) {
      st = station(seed);
      for (const h of st.cm.all) {
        if (!(h.kind === 'shelf' || h.kind === 'stockShelf') || !h.state.open) continue;
        const l = h.state.lots.find(x => x.y > 0.5);
        if (l) { pick = {h, lot: l}; break; }
      }
      if (pick) break;
    }
    expect(pick, 'a shelf with a lot above the bottom tier').toBeTruthy();
    const {cm, ph, sys, pickups, inv} = st!;
    const {h, lot} = pick!;
    const before = {lots: h.state.lots.length, count: lot.count, itemId: lot.itemId, total: cm.all.reduce((n, x) => n + x.state.lots.reduce((m, l) => m + l.count, 0), 0)};
    const at = cm.lotPoint(h, lot)!;
    const front = new THREE.Vector3(Math.sin(h.prop.rot), 0, Math.cos(h.prop.rot));
    const origin = new THREE.Vector3(at.x, at.y + 0.15, at.z).addScaledVector(front, 1.6);
    const dir = new THREE.Vector3(at.x, at.y, at.z).sub(origin).normalize();
    // the shot first meets the shelf's AABB (a loot holder): the lot inside it is still reached
    const n = sys.knockPickups(origin, dir, 1.6 - 0.2, {t: 1.6 - 0.2, kind: 'prop', nx: front.x, ny: 0, nz: front.z, prop: st!.layout.props.indexOf(h.prop)}, {damage: 24, pellet: false, weapon: 'rifle'});
    expect(n).toBeGreaterThanOrEqual(1);
    expect(h.state.lots.find(l => l.id === lot.id)).toBeUndefined(); // off the holder: can never be taken twice
    expect(h.state.lots.length).toBe(before.lots - 1);
    const pk = pickups.list.find(p => p.fromLot?.lot === lot.id);
    expect(pk).toBeTruthy();
    expect(pk!.stack.itemId).toBe(before.itemId);
    expect(pk!.stack.count).toBe(before.count);
    const y0 = pk!.obj.position.y;
    run(ph, 6);
    expect(ph.dynamicItems.stats().itemsAwake).toBe(0);
    const b = new THREE.Box3().setFromObject(pk!.obj);
    expect(b.min.y).toBeGreaterThan(st!.layout.grid.floorAt(pk!.x, pk!.z) - 0.03); // never through a tier / the floor
    expect(pk!.obj.position.y).toBeLessThan(y0 + 0.05);
    // finite loot: holders + loose pickup together still hold exactly what was rolled
    const total = cm.all.reduce((n2, x) => n2 + x.state.lots.reduce((m, l) => m + l.count, 0), 0) + pk!.stack.count;
    expect(total).toBe(before.total);
    // take it: inventory gets exactly that count once; the pickup is gone; the holder never gives it again
    const got = pk!.stack.count - inv.add(pk!.stack);
    pickups.remove(pk!);
    expect(got).toBe(before.count);
    expect(inv.count(before.itemId)).toBe(before.count);
    ph.update(1 / 60);
    expect(ph.dynamicItems.stats().items).toBe(0);
  });

  it('holder collision: shelves give tier slabs (not one solid box); enclosed holders get walls; broken holders nothing', () => {
    const shelf: PropPlacement = {kind: 'shelf', x: 4, z: 3, y: 0, rot: 0, area: 0, hx: 0.6, hz: 0.225, h: 1.85, blocksSight: false, variant: 0};
    const tiers = [0.128, 0.625, 1.182, 1.739].map(y => ({y, x0: -0.55, x1: 0.55, z0: -0.2, z1: 0.2, clear: 0.4}));
    const boxes = holderBoxes(shelf, tiers)!;
    expect(boxes.length).toBe(4);
    // between two tiers the shelf is open (an item can sit at y 0.7 inside the unit)
    for (const b of boxes) expect(b.containsPoint(new THREE.Vector3(4, 0.7, 3))).toBe(false);
    expect(boxes.some(b => Math.abs(b.max.y - 0.625) < 1e-6)).toBe(true);
    const crate: PropPlacement = {kind: 'crate', x: 2, z: 2, y: 0, rot: Math.PI / 2, area: 0, hx: 0.22, hz: 0.31, h: 0.432, blocksSight: false, variant: 0};
    const cb = holderBoxes(crate, [{y: 0.03, x0: -0.27, x1: 0.27, z0: -0.18, z1: 0.18, clear: 0.3}, {y: 0.05, x0: -0.27, x1: 0.27, z0: -0.18, z1: 0.18, clear: 0.3}])!;
    expect(cb.length).toBeGreaterThanOrEqual(5); // floor + walls + roof
    expect(holderBoxes(crate, [{y: 0.05, x0: -0.27, x1: 0.27, z0: -0.18, z1: 0.18, clear: 0.3}], {broken: true})).toEqual([]);
    const vending: PropPlacement = {kind: 'vending', x: 2, z: 2, y: 0, rot: 0, area: 0, hx: 0.475, hz: 0.425, h: 1.85, blocksSight: true, variant: 0};
    expect(holderBoxes(vending, [{y: 0, x0: -0.4, x1: 0.4, z0: 0.45, z1: 0.9, clear: 1}])).toBeNull(); // spill area outside: stays solid
  });
});

describe('light dynamic props', () => {
  it('a shot trash can goes loose (no AABB left behind), rocks / slides under buckshot, rests as a static body and walkers shove it', () => {
    const bin: PropPlacement = {kind: 'bin', x: 8, z: 6, y: 0, rot: 0, area: 0, hx: 0.275, hz: 0.275, h: 0.95, blocksSight: false, variant: 0};
    const L = testLayout([bin]);
    const ph = new PhysicsSystem(null);
    ph.build(L);
    const meshes = [new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.95), new THREE.MeshStandardMaterial())];
    meshes[0].matrixAutoUpdate = false;
    meshes[0].matrix.makeTranslation(8, 0.475, 6);
    ph.dynamicItems.detacher = {detachForPhysics: () => meshes};
    expect(ph.dynamicItems.isDynamicProp(bin)).toBe(true);
    // 9 pellets into its upper half from the west
    for (let i = 0; i < 9; i++) ph.dynamicItems.shootProp(bin, 0, new THREE.Vector3(7.73, 0.75 + (i % 3) * 0.04, 6 + (i - 4) * 0.02), new THREE.Vector3(1, -0.05, 0).normalize(), 15 * SHOT_IMPULSE_PER_DAMAGE);
    expect(bin.h).toBe(0); // no longer an AABB obstacle / hitscan box at the old place
    run(ph, 6);
    const m = meshes[0].matrix, p = new THREE.Vector3().setFromMatrixPosition(m);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m));
    console.info(`[bin] moved ${Math.hypot(p.x - 8, p.z - 6).toFixed(2)} m, up.y ${up.y.toFixed(2)}`);
    expect(Math.hypot(p.x - 8, p.z - 6) + (1 - up.y)).toBeGreaterThan(0.05);
    expect(p.y).toBeGreaterThan(0.2); // centre above the floor (standing 0.475 / lying 0.275)
    expect(ph.dynamicItems.stats().propsAwake).toBe(0); // resting: static body
    expect(ph.stats().bodies).toBeGreaterThanOrEqual(1);
    // hit-tested as an oriented box at its new pose
    expect(ph.dynamicItems.rayHits(new THREE.Vector3(p.x, 2, p.z), new THREE.Vector3(0, -1, 0), 3, []).length).toBe(1);
    // a walker pushes it
    const before = p.clone();
    const walker = {id: {}, x: p.x - 1, z: p.z, y: 0, r: 0.3};
    ph.dynamicItems.walkers = () => [walker];
    for (let i = 0; i < 90; i++) { walker.x += 1.4 / 60; ph.update(1 / 60); }
    const after = new THREE.Vector3().setFromMatrixPosition(meshes[0].matrix);
    expect(after.x - before.x).toBeGreaterThan(0.1);
    expect(ph.dynamicItems.stats().counts.pushes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------

describe('physical world chunks', () => {
  it('big pieces are bounded rigid bodies: they land on the real floors, sleep, hand back to debris; New Station clears', () => {
    const L = generateStation(424242);
    const ph = new PhysicsSystem(null);
    ph.build(L);
    const sys = new DamageSystem(null, null);
    sys.rand = mulberry(3);
    sys.debris.rand = mulberry(4);
    sys.build(L, null, [], {physics: ph});
    const sp = L.playerSpawn;
    const y0 = L.grid.floorAt(sp.x, sp.z);
    let maxBodies = 0;
    for (let i = 0; i < 60; i++) {
      sys.burst(new THREE.Vector3(sp.x + (i % 5) * 0.2, y0 + 1.2, sp.z), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -0.2, -1).normalize(), i % 2 ? 'concrete' : 'tile', new THREE.Color(0.6, 0.6, 0.6));
      ph.update(1 / 60);
      sys.update(1 / 60);
      maxBodies = Math.max(maxBodies, ph.chunks.stats().worldBodies);
    }
    expect(maxBodies).toBeLessThanOrEqual(MAX_WORLD_CHUNK_BODIES);
    expect(sys.counts.worldChunks).toBeGreaterThan(30);
    for (let i = 0; i < 60 * 10; i++) { ph.update(1 / 60); sys.update(1 / 60); }
    expect(ph.chunks.stats().worldBodies).toBe(0); // all slept / retired (hard cap 9 s)
    expect(sys.debris.live).toBeLessThanOrEqual(DEBRIS_TOTAL_CAP);
    const rest = sys.debris.list(400).filter(p => p.rest);
    expect(rest.length).toBeGreaterThan(10);
    for (const p of rest) expect(p.y).toBeGreaterThan(L.grid.floorAt(p.x, p.z) - 0.05); // on (not through) the floor
    ph.build(L);
    expect(ph.stats().bodies).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------

async function realZombie(): Promise<GLTF> {
  const io = new NodeIO();
  const doc = await io.read(fileURLToPath(new URL('../public/assets/models/zombie-rigged.glb', import.meta.url)));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

describe('zombie flesh / cloth chunks cut from the posed mesh', () => {
  it('extracts the shot patch in a running pose and in a ragdolled pose, leaves a tear, bounded per actor and overall', async () => {
    const gltf = await realZombie();
    const L = testLayout();
    const ph = new PhysicsSystem(null);
    ph.build(L);
    const sys = new DamageSystem(null, null);
    sys.rand = mulberry(11);
    sys.build({...L, areas: [], trenches: [], props: [], name: 't', seed: 1} as unknown as Parameters<DamageSystem['build']>[0], null, [], {physics: ph});
    let seed = 5;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const z = new ZombieActor(gltf, {x: 8, z: 6, yaw: 0.4, type: 'coated', area: 0}, rand);
    sys.installZombie(z);
    for (let i = 0; i < 24; i++) {
      z.brain.x += 2.3 / 60 * Math.sin(0.4); z.brain.z += 2.3 / 60 * Math.cos(0.4);
      z.animate(1 / 60, 'Run', 2.3);
      z.syncTransform();
      z.updateVolumes();
    }
    const w = woundsOf(z)!;
    // chest shot from the front (the zombie faces +yaw)
    const fwd = new THREE.Vector3(Math.sin(z.brain.yaw), 0, Math.cos(z.brain.yaw));
    const chest = z.bone('Spine')!.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0));
    const point = chest.clone().addScaledVector(fwd, 0.22);
    const dir = fwd.clone().negate();
    sys.beginShot();
    sys.hitZombie(z, point, dir, 'torso', {damage: 24, pellet: false, weapon: 'rifle'});
    const s1 = ph.chunks.stats();
    expect(sys.counts.patches + sys.counts.flaps).toBe(1);
    expect(s1.flesh).toBe(1);
    expect(sys.counts.patches).toBe(1); // a real patch of the posed surface (not a fallback flap)
    expect(w.tears).toBe(1);
    const chunk = ph.chunks.listFlesh()[0];
    // the piece starts where the body surface was hit in THIS pose (not the bind pose)
    expect(Math.hypot(chunk.x - point.x, chunk.y - point.y, chunk.z - point.z)).toBeLessThan(0.2);
    expect(chunk.tris).toBeGreaterThan(8);
    // the wound became a persistent missing area
    expect(w.wounds[0].strength).toBe(1);
    // ragdoll pose: kill, simulate a little, shoot the corpse's thigh
    z.brain.damage(999, 8, 0);
    expect(ph.ragdoll(z, {dir: {x: -fwd.x, y: -0.1, z: -fwd.z}, point: {x: chest.x, y: chest.y, z: chest.z}, strength: 38})).toBe(true);
    for (let i = 0; i < 40; i++) ph.update(1 / 60);
    z.root.updateMatrixWorld(true);
    const thighA = z.bone('L_Thigh')!.getWorldPosition(new THREE.Vector3()), thighB = z.bone('L_Shin')!.getWorldPosition(new THREE.Vector3());
    const mid = thighA.clone().lerp(thighB, 0.5);
    const from = mid.clone().add(new THREE.Vector3(0.6, 0.9, 0.3));
    const d2 = mid.clone().sub(from).normalize();
    const vols = sys.corpseHit([z], from, d2, 5);
    expect(vols).toBeTruthy();
    const hitAt = from.clone().addScaledVector(d2, vols!.t);
    sys.beginShot();
    sys.hitZombie(z, hitAt, d2, vols!.part, {damage: 24, pellet: false, weapon: 'rifle'}, true);
    expect(sys.counts.patches + sys.counts.flaps).toBe(2);
    const last = ph.chunks.listFlesh().at(-1)!;
    expect(Math.hypot(last.x - hitAt.x, last.y - hitAt.y, last.z - hitAt.z)).toBeLessThan(0.25); // cut from the RAGDOLLED pose
    // let everything land: chunks rest on the floor and sleep
    run(ph, 6);
    for (const c of ph.chunks.listFlesh()) { expect(c.y).toBeGreaterThan(-0.02); expect(c.y).toBeLessThan(0.3); expect(c.awake).toBe(false); }
    // bounded: per actor (MAX_TEARS_PER_ACTOR) and overall (MAX_FLESH_CHUNKS)
    for (let i = 0; i < 40; i++) {
      sys.beginShot();
      const zp = z.bone('Spine')!.getWorldPosition(new THREE.Vector3());
      sys.hitZombie(z, zp.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(0, -1, 0), 'torso', {damage: 24, pellet: false, weapon: 'rifle'}, true);
    }
    expect(w.tears).toBeLessThanOrEqual(12);
    expect(ph.chunks.stats().flesh).toBeLessThanOrEqual(MAX_FLESH_CHUNKS);
    ph.build(L); // New Station
    expect(ph.chunks.stats().flesh).toBe(0);
    expect(ph.chunks.group.children.length).toBe(0);
  });

  it('extractPatch bakes the CURRENT skinned positions: same rest point in two poses -> two different world places, same triangles', async () => {
    const gltf = await realZombie();
    let seed = 9;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const z = new ZombieActor(gltf, {x: 3, z: 3, yaw: 0, type: 'shambler', area: 0}, rand);
    installWounds(z);
    const w = woundsOf(z)!;
    const body = w.layers.find(l => l.slot === 'body')!;
    z.root.updateMatrixWorld(true);
    // a rest-space point on the body's front surface: the vertex with max z near chest height
    const pos = body.mesh.geometry.attributes.position as THREE.BufferAttribute;
    let best = 0, bz = -Infinity;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > 1.1 && y < 1.3 && Math.abs(pos.getX(i)) < 0.05 && pos.getZ(i) > bz) { bz = pos.getZ(i); best = i; } }
    const rest = new THREE.Vector3().fromBufferAttribute(pos, best);
    const a = extractPatch(body, rest, new THREE.Vector3(0, 0, -1), 0.05, {thickness: 0.02})!;
    expect(a).toBeTruthy();
    expect(a.tris).toBeGreaterThan(4);
    const world0 = new THREE.Vector3();
    body.mesh.getVertexPosition(best, world0);
    world0.applyMatrix4(body.mesh.matrixWorld);
    expect(a.position.distanceTo(world0)).toBeLessThan(0.08);
    expect(a.normal.z).toBeGreaterThan(0.3); // faces forward (toward the shooter)
    // new pose: bend the spine + turn and move the actor
    z.bone('Spine')!.rotation.x += 0.6;
    z.root.rotation.y = 1.9;
    z.root.position.set(-2, 0, 5);
    z.root.updateMatrixWorld(true);
    const b = extractPatch(body, rest, new THREE.Vector3(0, 0, -1), 0.05, {thickness: 0.02})!;
    expect(b.tris).toBe(a.tris); // the same surface patch (rest space)
    const world1 = new THREE.Vector3();
    body.mesh.getVertexPosition(best, world1);
    world1.applyMatrix4(body.mesh.matrixWorld);
    expect(world1.distanceTo(world0)).toBeGreaterThan(1);
    expect(b.position.distanceTo(world1)).toBeLessThan(0.08); // follows the pose
    const g = b.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < g.count; i++) expect(Number.isFinite(g.getX(i) + g.getY(i) + g.getZ(i))).toBe(true);
    expect(b.half.y).toBeGreaterThanOrEqual(0.004);
  });
});

// ---------------------------------------------------------------------------------------

describe('performance budget (Node, cannon-es)', () => {
  it('a full budget of items + world chunks + flesh chunks steps within a few ms per frame', () => {
    const ph = new PhysicsSystem(null);
    ph.build(testLayout());
    const items: PickupLike[] = [];
    for (let i = 0; i < MAX_DYNAMIC_ITEMS; i++) items.push(can(6 + (i % 4) * 0.4, 0.4 + Math.floor(i / 4) * 0.2, 6 + (i % 3) * 0.3, i % 2 ? 'cola' : 'water'));
    for (const p of items) ph.dynamicItems.shootPickup(p, p.obj.position.clone().add(new THREE.Vector3(0, 0.06, -0.02)), new THREE.Vector3(0.3, 0.2, 1).normalize(), 1.3);
    const R = mulberry(1);
    for (let i = 0; i < MAX_FLESH_CHUNKS; i++) {
      const geo = new THREE.BoxGeometry(0.08, 0.02, 0.06);
      ph.chunks.spawnFlesh(geo, new THREE.MeshStandardMaterial(), new THREE.Vector3(9 + R() * 2, 1 + R(), 8 + R()), new THREE.Quaternion(), new THREE.Vector3(0.04, 0.01, 0.03),
        {vel: new THREE.Vector3(R() * 2 - 1, R() * 2, R() * 2 - 1), spin: new THREE.Vector3(R() * 10, R() * 10, R() * 10), mat: 'flesh', density: 1050});
    }
    expect(ph.stats().dynamic.itemsAwake + ph.stats().chunks.awake).toBe(MAX_DYNAMIC_ITEMS + MAX_FLESH_CHUNKS);
    let worst = 0, total = 0, n = 0;
    for (let i = 0; i < 180; i++) {
      const t0 = performance.now();
      ph.update(1 / 60);
      const ms = performance.now() - t0;
      if (i > 5) { worst = Math.max(worst, ms); total += ms; n++; }
    }
    console.info(`[perf] ${MAX_DYNAMIC_ITEMS} items + ${MAX_FLESH_CHUNKS} flesh chunks: mean ${(total / n).toFixed(2)} ms/frame, worst ${worst.toFixed(2)} ms (Node)`);
    expect(total / n).toBeLessThan(6);
  });
});
