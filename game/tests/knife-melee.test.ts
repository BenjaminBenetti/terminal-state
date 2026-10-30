// Lane KNIFE (task knife-melee-20261030): the user's knife as the first melee weapon — the runtime derivative contract, the
// NewGame kit (knife IN ADDITION to the unchanged pistol kit) and its carryover, the damage numbers against the real enemy
// stats, the contact sweep (reach, walls / props / slabs, misses), one target and one damage per swing at the swing cadence,
// ammo independence, cancellation (switch / menus / lowering), and the first-person viewmodel (held model, slash through the
// crosshair, warm-up coverage). CPU only (no renderer, no browser).
// Lane FEEL (task knife-windup-20261030): updated to the new contract — 30 body / 60 head (2 head / 4 body hits on a standard
// zombie), reach 1.125 m, hold to wind up / release to swing (no auto-repeat), the upright carry; knife-windup.test.ts has the
// detailed windup / tap / cancellation / pose coverage.

import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {levelFixture, FIX} from './helpers/levelFixture';

vi.mock('../src/world/canvasTextures', async orig => ({...(await orig<object>()), canvasTexture: () => new THREE.Texture()}));
installCanvasShim(false);

const {WEAPONS, WeaponController, meleeDefOf, weaponAmmoItem, reserveFor, meleeCadence} = await import('../src/weapons/weapons');
type TriggerInput = import('../src/weapons/weapons').TriggerInput;
type WeaponEvent = import('../src/weapons/weapons').WeaponEvent;
const {KNIFE_RAYS, meleeDamage, meleeHitsToKill, meleeRayDirs, resolveMelee} = await import('../src/combat/melee');
type MeleeTarget<T> = import('../src/combat/melee').MeleeTarget<T>;
const {KNIFE_POSES, meleePoseOffset} = await import('../src/weapons/meleeView'); // lane FEEL: stage-driven poses
const {Viewmodel} = await import('../src/weapons/viewmodel');
const {Inventory, MELEE_REF} = await import('../src/items/inventory');
const {ITEMS, itemDef} = await import('../src/items/items');
const {ICONS} = await import('../src/ui/icons');
const {MODEL_FILES} = await import('../src/assets/manifest');
// task knife-windup-20261030 (lane SLOT): the knife lives in the dedicated melee slot (MELEE_REF, key ~), no longer quick slot 3
const {starterInventory} = await import('../src/run/starter');
const {takeSnapshot, restoreCarry} = await import('../src/run/snapshot');
const {capturePickups, restorePickup} = await import('../src/run/worldMemory');
const {PickupManager} = await import('../src/world/pickups');
const {Survival} = await import('../src/player/survival');
const {FlashlightBattery} = await import('../src/player/flashlight');
const {ZOMBIE_STATS, ZombieBrain} = await import('../src/ai/brain');
const {RATDOG_STATS} = await import('../src/ai/creatureActor');
const {Grid, FLOOR, SOLID, CELL} = await import('../src/gen/grid');
const {levelsOf} = await import('../src/gen/levels');
const {raycastWorld} = await import('../src/combat/hitscan');

const GAME = fileURLToPath(new URL('..', import.meta.url));
const ROOT = path.join(GAME, '..');
const KNIFE = WEAPONS.knife;
const sha = (b: Buffer | Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const idle: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const DT = 1 / 60;

// ---------------------------------------------------------------------------------------------------------------------
describe('knife derivative (user upload -> knife-user.glb): file, hash, triangles, size, axes, provenance', () => {
  const prov = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/user-knife-20261030.json'), 'utf8'));
  const file = path.join(GAME, 'public', MODEL_FILES.knife.url);

  it('provenance: the user upload (sha f82d4872…), generation 0, no provider / licence claim, reproducible tool', () => {
    expect(prov.generation).toBe(0);
    expect(prov.source.sha256).toBe('f82d48727f3720f387490900fa36a690fd519d0a3b4ebbfcfbd4635b53e03d4b');
    expect(prov.source.bytes).toBe(10_951_220);
    expect([prov.source.triangles, prov.source.vertices]).toEqual([72_790, 39_206]);
    expect(prov.status).toMatch(/USER-UPLOADED/);
    expect(prov.status).toMatch(/not provider or licence proof/);
    expect(prov.rebuild).toBe('node tools/asset-pipeline/weapons/build-knife.mjs');
    expect(fs.existsSync(path.join(ROOT, 'tools/asset-pipeline/weapons/build-knife.mjs'))).toBe(true);
    expect(prov.convention).toMatch(/tip -Z/);
    expect(prov.source.axes).toBe('tip -X, pommel +X, spine +Y, edge -Y');
  });

  it('the shipped GLB is exactly the recorded derivative and the manifest points at it', () => {
    expect(MODEL_FILES.knife.url).toBe('assets/models/knife-user.glb');
    const bytes = fs.readFileSync(file);
    expect(sha(bytes)).toBe(prov.output.sha256);
    expect(bytes.length).toBe(prov.output.bytes);
    expect(Math.abs(bytes.length - MODEL_FILES.knife.bytes)).toBeLessThan(20_000);
    expect(bytes.length).toBeLessThan(1_500_000); // a viewmodel-sized asset (the source is 10.95 MB)
  });

  it('viewmodel budget: a few thousand triangles, <= 1024 px textures (base / metal-rough / normal), black emissive dropped', async () => {
    const doc = await new NodeIO().read(file);
    const r = doc.getRoot();
    const prim = r.listMeshes()[0].listPrimitives()[0];
    const tris = prim.getIndices()!.getCount() / 3;
    expect(r.listMeshes().length).toBe(1);
    expect(tris).toBe(prov.output.triangles);
    expect(tris).toBeGreaterThan(2_000);
    expect(tris).toBeLessThan(10_000);
    const mat = r.listMaterials()[0];
    expect(mat.getBaseColorTexture()).toBeTruthy();
    expect(mat.getMetallicRoughnessTexture()).toBeTruthy();
    expect(mat.getNormalTexture()).toBeTruthy();
    expect(mat.getEmissiveTexture()).toBeNull();
    expect(mat.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(r.listTextures().length).toBe(3);
    for (const t of r.listTextures()) expect(Math.max(...t.getSize()!)).toBeLessThanOrEqual(1024);
  });

  it('metres at a real knife length, grip pivot at the origin, tip -Z, Grip / Tip markers', async () => {
    const doc = await new NodeIO().read(file);
    const r = doc.getRoot();
    const node = r.listNodes().find(n => n.getMesh())!;
    expect(node.getRotation().map(v => +v.toFixed(6))).toEqual([0, -0.707107, 0, 0.707107]); // rotateY(-90deg): source -X tip -> -Z, +Y kept
    const M = node.getWorldMatrix(), pos = node.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const w = [0, 1, 2].map(k => M[k] * v[0] + M[4 + k] * v[1] + M[8 + k] * v[2] + M[12 + k]);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
    }
    expect(max[2] - min[2]).toBeGreaterThan(0.30); // overall length ~0.32 m
    expect(max[2] - min[2]).toBeLessThan(0.335);
    for (const k of [0, 1]) expect(Math.max(-min[k], max[k])).toBeLessThan(0.04); // guard / blade within ~±4 cm across
    expect(-min[2]).toBeGreaterThan(3 * max[2]); // the long blade runs to -Z, the short handle end (pommel) to +Z
    const marker = (n: string) => r.listNodes().find(x => x.getName() === n)!.getTranslation();
    expect(marker('Grip')).toEqual([0, 0, 0]);
    const tip = marker('Tip');
    expect(tip[2]).toBeCloseTo(min[2], 2);
    expect(Math.hypot(tip[0], tip[1])).toBeLessThan(0.015); // the point lies near the blade axis (clip point, a little spine-side)
    expect(tip[1]).toBeGreaterThan(0); // spine +Y: the clip point sits toward the spine
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('NewGame kit: the knife IN ADDITION to the unchanged pistol kit; carryover / Retry / NewGame / dropped', () => {
  // (the grenade slot counts: since the office overhaul the starting flare lives there, thrown with G)
  // task knife-windup-20261030 (lane SLOT): the knife lives in the dedicated melee slot (~), not quick slot 3 — the kit checks
  // below follow it there; melee-slot.test.ts covers the slot itself (rules, ~ key, snapshot v3 / legacy migration, HUD).
  const kitWithoutKnife = (inv: InstanceType<typeof Inventory>) => inv.hotbar.concat(inv.pack, inv.throwSlot, inv.meleeSlot).filter(s => s && s.itemId !== 'knife')
    .map(s => `${s!.itemId}x${s!.count}${s!.mag !== undefined ? `@${s!.mag}` : ''}`).sort();
  const knives = (inv: InstanceType<typeof Inventory>) => inv.allStacks(true).filter(s => s.itemId === 'knife');

  it('fresh spawn: pistol (full magazine, selected), 45 x 9mm, flare, bandage — plus the knife in the melee slot (quick slot 3 stays empty)', () => {
    const inv = starterInventory('pistol');
    expect(inv.hotbar[0]).toMatchObject({itemId: 'pistol', count: 1, mag: WEAPONS.pistol.magazine});
    expect(inv.selected).toBe(0);
    expect(inv.meleeSelected).toBe(false);
    expect(inv.selectedStack()).toBe(inv.hotbar[0]);
    expect(inv.count(weaponAmmoItem(WEAPONS.pistol)!)).toBe(45);
    expect(inv.count('flare')).toBe(1);
    expect(inv.hotbar[4]).toMatchObject({itemId: 'bandage', count: 1});
    expect(inv.melee).toMatchObject({itemId: 'knife', count: 1, mag: 0});
    expect(inv.get(MELEE_REF)).toBe(inv.melee);
    expect(inv.hotbar[2]).toBeNull();
    expect(inv.hotbar.some(s => s?.itemId === 'knife')).toBe(false);
    expect(knives(inv).length).toBe(1);
    expect(inv.invariants()).toEqual([]);
    expect(itemDef('knife')).toMatchObject({kind: 'weapon', weaponId: 'knife', stackMax: 1, icon: 'knife'});
    expect(ICONS.knife).toMatch(/^<svg/);
    // the rifle fallback kit (pistol art gate off) gets it too
    const rifle = starterInventory('rifle');
    expect(rifle.hotbar[0]).toMatchObject({itemId: 'rifle', mag: 30});
    expect(rifle.melee).toMatchObject({itemId: 'knife'});
    expect(rifle.hotbar.some(s => s?.itemId === 'knife')).toBe(false);
  });

  it('the rest of the kit is exactly what it was before the knife (nothing removed or reduced)', () => {
    const inv = starterInventory('pistol');
    expect(kitWithoutKnife(inv)).toEqual([`${weaponAmmoItem(WEAPONS.pistol)}x45`, 'bandagex1', 'flarex1', `pistolx1@${WEAPONS.pistol.magazine}`]);
  });

  it('Retry restores the knife exactly as carried at level entry; NewGame always hands out one fresh knife', () => {
    const inv = starterInventory('pistol');
    const player = {hp: 80, stamina: 60, damageTaken: 20};
    const survival = new Survival(), battery = new FlashlightBattery(() => 0.5);
    const stats = {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0};
    const snap = takeSnapshot({level: 'subway', section: 'main', arrival: {kind: 'start'}}, {inv, player, survival, battery, participants: [], stats}, {});
    inv.detach(MELEE_REF); // dropped after entering the level
    expect(knives(inv).length).toBe(0);
    for (let round = 0; round < 2; round++) {
      const restored = restoreCarry(snap, {player, survival, battery, stats});
      expect(knives(restored).length).toBe(1);
      expect(restored.melee).toMatchObject({itemId: 'knife', mag: 0});
      expect(restored.invariants()).toEqual([]);
    }
    for (let i = 0; i < 3; i++) expect(knives(starterInventory('pistol')).length).toBe(1);
  });

  it('travel keeps the same inventory (in-place snapshot load): one knife, no duplicate, same uid', () => {
    const inv = starterInventory('pistol');
    const uid = inv.melee!.uid;
    inv.loadJSON(inv.toJSON()); // Game.installInventory path
    expect(knives(inv).map(s => s.uid)).toEqual([uid]);
    expect(inv.melee!.uid).toBe(uid);
  });

  it('a dropped knife is a normal pickup: remembered by the section and restored once (mag 0, no ammo) — back into the melee slot', () => {
    const inv = starterInventory('pistol');
    const pm = new PickupManager({});
    const dropped = inv.detach(MELEE_REF)!;
    pm.add(dropped, 1, 0, 2, 0.4);
    const recs = capturePickups(pm.list, () => undefined);
    expect(recs.map(r => r.stack.itemId)).toEqual(['knife']);
    const pm2 = new PickupManager({});
    const back = restorePickup(pm2, inv, recs[0]);
    expect(back.stack).toMatchObject({itemId: 'knife', count: 1, mag: 0});
    expect(inv.add(back.stack)).toBe(0);
    expect(inv.melee).toBe(back.stack); // fills the empty melee slot (same object), no quick slot used
    expect(knives(inv).length).toBe(1);
    expect(inv.invariants()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('knife damage vs the real enemy numbers (lane FEEL nerf: two head hits, body hits scaled up)', () => {
  it('30 body / 60 head: an ordinary zombie (shambler, 100 hp) takes 2 head hits or 4 body hits (torso and limbs alike)', () => {
    const hp = ZOMBIE_STATS.shambler.hp;
    expect(hp).toBe(100);
    expect([KNIFE.damage, KNIFE.headMult, KNIFE.limbMult]).toEqual([30, 2, 1]);
    expect([meleeDamage(KNIFE, 'torso'), meleeDamage(KNIFE, 'limb'), meleeDamage(KNIFE, 'head')]).toEqual([30, 30, 60]);
    expect(meleeDamage(KNIFE, 'head')).toBeLessThan(hp); // no more one-hit head kill
    expect(meleeHitsToKill(KNIFE, 'head', hp)).toBe(2);
    expect(meleeHitsToKill(KNIFE, 'torso', hp)).toBe(4);
    expect(meleeHitsToKill(KNIFE, 'limb', hp)).toBe(4);
    expect(meleeDamage(KNIFE, 'head') + 2 * meleeDamage(KNIFE, 'torso')).toBeGreaterThanOrEqual(hp); // or 1 head + 2 body
  });

  it('documented other enemies (stats unchanged): coated zombie 165 hp = 3 head / 6 body hits; rats / dogs 44 hp = 1 head / 2 body', () => {
    expect(ZOMBIE_STATS.coated.hp).toBe(165);
    expect(meleeHitsToKill(KNIFE, 'head', ZOMBIE_STATS.coated.hp)).toBe(3);
    expect(meleeHitsToKill(KNIFE, 'torso', ZOMBIE_STATS.coated.hp)).toBe(6);
    expect(meleeHitsToKill(KNIFE, 'limb', ZOMBIE_STATS.coated.hp)).toBe(6);
    expect(RATDOG_STATS.hp).toBe(44);
    expect(meleeHitsToKill(KNIFE, 'head', RATDOG_STATS.hp)).toBe(1);
    expect(meleeHitsToKill(KNIFE, 'torso', RATDOG_STATS.hp)).toBe(2);
    expect(meleeHitsToKill(KNIFE, 'limb', RATDOG_STATS.hp)).toBe(2);
    expect(Object.keys(ZOMBIE_STATS).sort()).toEqual(['coated', 'shambler']); // every enemy type is documented above
  });

  it('end to end on ZombieBrain: one head hit does NOT kill, the second does; body hits 1-3 do not (no stagger), the 4th does', () => {
    const head = new ZombieBrain('shambler', 0, 0, 0);
    expect(head.damage(meleeDamage(KNIFE, 'head'), 1, 0, 0, {stagger: false})).toBe(false);
    expect(head.alive).toBe(true);
    expect(head.state).not.toBe('stagger');
    expect(head.damage(meleeDamage(KNIFE, 'head'), 1, 0, 0, {stagger: false})).toBe(true);
    expect(head.alive).toBe(false);
    const body = new ZombieBrain('shambler', 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      expect(body.damage(meleeDamage(KNIFE, 'torso'), 1, 0, 0, {stagger: false})).toBe(false);
      expect(body.state).not.toBe('stagger'); // no stun-lock: it keeps closing / swinging
    }
    expect(body.aware).toBe(true);
    expect(body.damage(meleeDamage(KNIFE, 'torso'), 1, 0, 0, {stagger: false})).toBe(true);
    // contrast: the same amount from a gun path staggers (unchanged gun behaviour)
    const gun = new ZombieBrain('shambler', 0, 0, 0);
    gun.damage(meleeDamage(KNIFE, 'torso'), 1, 0, 0);
    expect(gun.state).toBe('stagger');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
type Z = {name: string};
/** A standing zombie-sized target at feet (x, y, z): head sphere 1.65 m, torso capsule 0.95-1.45 m, an arm capsule. */
function zombieAt(name: string, x: number, z: number, y = 0): MeleeTarget<Z> {
  return {id: {name}, alive: true, x, y, z, volumes: [
    {part: 'head', a: {x, y: y + 1.65, z}, b: null, r: 0.12},
    {part: 'torso', a: {x, y: y + 0.95, z}, b: {x, y: y + 1.45, z}, r: 0.2},
    {part: 'limb', a: {x, y: y + 1.4, z: z + 0.25}, b: {x, y: y + 0.85, z: z + 0.3}, r: 0.06},
  ]};
}
/** Open 20 x 20 m floor (cells FLOOR), optional SOLID cells. */
function openGrid(solid: [number, number][] = []) {
  const g = new Grid(40, 40);
  for (let y = 1; y < 39; y++) for (let x = 1; x < 39; x++) g.cells[g.idx(x, y)] = FLOOR;
  for (const [x, y] of solid) g.cells[g.idx(x, y)] = SOLID;
  return g;
}
/** Camera basis looking along (dx, dy, dz) from the eye. */
function basis(dx: number, dy: number, dz: number) {
  const l = Math.hypot(dx, dy, dz), f = {x: dx / l, y: dy / l, z: dz / l};
  const rl = Math.hypot(f.z, f.x) || 1, right = {x: -f.z / rl, y: 0, z: f.x / rl}; // f x up
  const up = {x: right.y * f.z - right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y - right.y * f.x};
  return meleeRayDirs(f, right, up, KNIFE.melee!.rays);
}

describe('contact sweep: reach, occlusion by walls / props / slabs, misses stay misses', () => {
  const EYE = {x: 5, y: 1.62, z: 5};
  const world = (g: InstanceType<typeof Grid>, props: Parameters<typeof raycastWorld>[1] = []) =>
    (o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, max: number) => raycastWorld(g, props, o, d, max, -1);

  it('the sweep pattern is a narrow centre-first fan (±~10° across, ±~4° up / down)', () => {
    expect(KNIFE.melee!.rays).toBe(KNIFE_RAYS);
    expect(KNIFE_RAYS[0]).toEqual([0, 0]);
    for (const [y, p] of KNIFE_RAYS) { expect(Math.abs(y)).toBeLessThanOrEqual(0.18); expect(Math.abs(p)).toBeLessThanOrEqual(0.07); }
    expect(KNIFE.range).toBe(1.125); // lane FEEL: exactly 25 % less than the original 1.5 m
    expect(KNIFE.range).toBeCloseTo(1.5 * 0.75, 12);
  });

  it('lane FEEL reach 1.125 m: just inside hits, just outside misses; a head 1.3 m out (hit by the old 1.5 m reach) is now a miss', () => {
    const g = openGrid();
    // head sphere (r 0.12) at eye height 1.65 vs eye 1.62: its near surface is ~ (feet distance - 0.12) along the centre ray
    const at = (dx: number) => resolveMelee(EYE, basis(1, 0.03, 0).slice(0, 1), KNIFE.range, [zombieAt('z', EYE.x + dx, 5)], world(g));
    expect(at(1.2)).toMatchObject({kind: 'enemy', part: 'head'}); // surface ~1.08 m
    expect(at(1.2)!.t).toBeLessThanOrEqual(KNIFE.range);
    expect(at(1.3)).toBeNull(); // surface ~1.18 m: beyond 1.125
    expect(resolveMelee(EYE, basis(1, 0.03, 0).slice(0, 1), 1.5, [zombieAt('z', EYE.x + 1.3, 5)], world(g))).toMatchObject({kind: 'enemy'});
  });

  it('in reach: the head (aimed at it) and the body (aimed lower) — classified by the zombie hit zones', () => {
    const g = openGrid();
    const zb = zombieAt('a', 6.1, 5);
    const head = resolveMelee(EYE, basis(1, 0.03, 0), KNIFE.range, [zb], world(g));
    expect(head).toMatchObject({kind: 'enemy', part: 'head', ray: 0});
    const body = resolveMelee(EYE, basis(1, -0.35, 0), KNIFE.range, [zb], world(g));
    expect(body).toMatchObject({kind: 'enemy', part: 'torso', ray: 0});
    expect(body!.t).toBeLessThanOrEqual(KNIFE.range);
  });

  it('beyond reach: no hit (a zombie 2.6 m away is out of knife range though in plain sight)', () => {
    const g = openGrid();
    expect(resolveMelee(EYE, basis(1, 0.03, 0), KNIFE.range, [zombieAt('far', 7.6, 5)], world(g))).toBeNull();
    // the same zombie is hit by a long ray (the reach is what stops it)
    expect(resolveMelee(EYE, basis(1, 0.03, 0), 5, [zombieAt('far', 7.6, 5)], world(g))).toMatchObject({kind: 'enemy'});
  });

  it('aimed away / past the fan: a miss stays a miss', () => {
    const g = openGrid();
    expect(resolveMelee(EYE, basis(0, 0.03, 1), KNIFE.range, [zombieAt('a', 6.1, 5)], world(g))).toBeNull();
    expect(resolveMelee(EYE, basis(1, 0.03, 0), KNIFE.range, [zombieAt('side', 6.0, 5.75)], world(g))).toBeNull(); // 0.75 m to the side
    expect(resolveMelee(EYE, basis(1, 0.03, 0), KNIFE.range, [zombieAt('edge', 6.0, 5.2)], world(g))).toMatchObject({kind: 'enemy'}); // inside the fan
  });

  it('a wall between the eye and the zombie stops the blade (world contact, no enemy damage)', () => {
    const wallX = Math.floor(5.5 / CELL); // a SOLID cell column at x 5.5..6.0
    const g = openGrid(Array.from({length: 38}, (_, i) => [wallX, i + 1] as [number, number]));
    const res = resolveMelee(EYE, basis(1, 0.03, 0), KNIFE.range, [zombieAt('behind', 6.6, 5)], world(g));
    expect(res?.kind).toBe('world');
    expect(res).toMatchObject({surface: 'wall'});
  });

  it('a prop box between stops it too (exact prop AABB through the same raycast as bullets)', () => {
    const g = openGrid();
    const crate = {kind: 'crate', x: 5.55, z: 5, y: 0, rot: 0, area: 0, hx: 0.25, hz: 0.6, h: 2.0, blocksSight: true, variant: 0} as Parameters<typeof raycastWorld>[1][number];
    const res = resolveMelee(EYE, basis(1, 0.03, 0), KNIFE.range, [zombieAt('behind', 6.3, 5)], world(g, [crate]));
    expect(res).toMatchObject({kind: 'world', surface: 'prop'});
  });

  it('a slab between storeys stops it (stacked levels: a blade ray low over the deck, a target just under the deck slab)', () => {
    const fx = levelFixture();
    const L = levelsOf(fx);
    const x = 21, z = 6; // on the upper deck (level 1), over platform A
    // lane FEEL: from 0.6 m over the deck (crouched eye height 1.02 m + the 0.35 m slab would put the target beyond the 1.125 m reach)
    const eye = {x, y: FIX.upperY + 0.6, z};
    const below: MeleeTarget<Z> = {id: {name: 'below'}, alive: true, x, z, volumes: [{part: 'head', a: {x, y: FIX.underDeckCeil - 0.15, z}, b: null, r: 0.12}]};
    const down = [{x: 0, y: -1, z: 0}];
    const res = resolveMelee(eye, down, KNIFE.range, [below], (o, d, max) => raycastWorld(L, fx.props, o, d, max, fx.trench.floorY));
    expect(res).toMatchObject({kind: 'world', surface: 'floor'});
    // control: without world occlusion the same ray would reach it (so the slab is what stopped the blade)
    expect(resolveMelee(eye, down, KNIFE.range, [below], () => ({t: Infinity, kind: 'none'}))).toMatchObject({kind: 'enemy'});
  });

  it('dead enemies are never targets; a corpse in front blocks the ray like it blocks bullets', () => {
    const g = openGrid();
    const dead = {...zombieAt('dead', 6.1, 5), alive: false};
    expect(resolveMelee(EYE, basis(1, 0.03, 0), KNIFE.range, [dead], world(g))).toBeNull();
    const live = zombieAt('live', 6.0, 5); // in reach (lane FEEL: 1.125 m), but behind the corpse
    expect(resolveMelee(EYE, basis(1, 0.02, 0).slice(0, 1), KNIFE.range, [live], world(g))).toMatchObject({kind: 'enemy'}); // control
    const corpse = (_o: unknown, _d: unknown, maxT: number) => (0.6 < maxT ? {t: 0.6, tag: 'corpse'} : null);
    const res = resolveMelee(EYE, basis(1, 0.02, 0).slice(0, 1), KNIFE.range, [live], world(g), corpse);
    expect(res).toMatchObject({kind: 'corpse', corpse: {tag: 'corpse'}});
  });
});

// ---------------------------------------------------------------------------------------------------------------------
function equippedKnife(withAmmo = false) {
  const inv = starterInventory('pistol');
  if (!withAmmo) for (const s of inv.allStacks()) if (itemDef(s.itemId).kind === 'ammo') inv.take(s.itemId, s.count);
  const wc = new WeaponController();
  wc.equip(inv.melee); // lane SLOT: the knife lives in the melee slot (~)
  wc.update(1, idle, inv); // finish the 0.3 s equip
  expect(wc.phase).toBe('idle');
  return {inv, wc};
}
function run(wc: InstanceType<typeof WeaponController>, inv: InstanceType<typeof Inventory>, seconds: number, input: Partial<TriggerInput>) {
  const out: {t: number; e: WeaponEvent}[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) for (const e of wc.update(DT, {...idle, ...input}, inv)) out.push({t: (i + 1) * DT, e});
  return out;
}
/** Lane FEEL: click spam — a fresh press (down) every other frame, up in between (Input.mousePressed is one frame long). */
function clicks(wc: InstanceType<typeof WeaponController>, inv: InstanceType<typeof Inventory>, seconds: number, input: Partial<TriggerInput> = {}) {
  const out: {t: number; e: WeaponEvent}[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) for (const e of wc.update(DT, {...idle, ...input, ...(i % 2 ? {} : {pressed: true, held: true})}, inv)) out.push({t: (i + 1) * DT, e});
  return out;
}

describe('one target, one damage per swing, at the swing cadence', () => {
  it('two zombies in a line: only the nearer one is struck (no area clear)', () => {
    const g = openGrid();
    const res = resolveMelee({x: 5, y: 1.62, z: 5}, basis(1, 0.03, 0), KNIFE.range, [zombieAt('far', 6.05, 5), zombieAt('near', 5.75, 5)],
      (o, d, max) => raycastWorld(g, [], o, d, max, -1));
    expect(res).toMatchObject({kind: 'enemy', target: {name: 'near'}});
  });

  it('lane FEEL: holding the button never repeats — ONE windup, nothing until the release, then ONE swing with ONE contact', () => {
    const {inv, wc} = equippedKnife();
    const ev = [...run(wc, inv, DT, {held: true, pressed: true}), ...run(wc, inv, 2.0, {held: true})];
    expect(ev.map(x => x.e.type)).toEqual(['windup']);
    const rel = run(wc, inv, 1.0, {});
    expect(rel.map(x => x.e.type)).toEqual(['swing', 'contact']);
    expect((rel[0].e as {swing: number}).swing).toBe((rel[1].e as {swing: number}).swing);
    expect(rel[1].t - rel[0].t).toBeGreaterThanOrEqual(KNIFE.melee!.strike - DT - 1e-9);
    expect(rel[1].t - rel[0].t).toBeLessThanOrEqual(KNIFE.melee!.strike + 1e-9);
    expect([...ev, ...rel].some(x => x.e.type === 'fire' || x.e.type === 'dry' || x.e.type === 'reloadStart')).toBe(false);
  });

  it('lane FEEL: one tap per cycle swings every 0.65 s (windup + sweep + recovery); each swing has exactly ONE contact', () => {
    const {inv, wc} = equippedKnife();
    expect(meleeCadence(KNIFE.melee!)).toBeCloseTo(KNIFE.interval, 9);
    const ev: {t: number; e: WeaponEvent}[] = [];
    for (let i = 0; i < Math.round(2.05 / DT); i++) for (const e of wc.update(DT, i % 39 === 0 ? {...idle, pressed: true} : idle, inv)) ev.push({t: (i + 1) * DT, e});
    const swings = ev.filter(x => x.e.type === 'swing'), contacts = ev.filter(x => x.e.type === 'contact');
    // taps at 0, 0.65, 1.30, 1.95 s -> 4 windups; swings at ~0.15, 0.80, 1.45 s (the 4th tap's swing is still ahead at 2.05 s)
    expect(ev.filter(x => x.e.type === 'windup').length).toBe(4);
    expect(swings.length).toBe(3);
    expect(contacts.length).toBe(3);
    expect(swings[0].t).toBeCloseTo(KNIFE.melee!.windup, 1);
    for (let i = 1; i < swings.length; i++) expect(swings[i].t - swings[i - 1].t).toBeCloseTo(KNIFE.interval, 1);
    contacts.forEach((c, i) => expect((c.e as {swing: number}).swing).toBe((swings[i].e as {swing: number}).swing));
    expect(new Set(contacts.map(c => (c.e as {swing: number}).swing)).size).toBe(contacts.length);
  });

  it('spamming clicks cannot beat the cadence', () => {
    const {inv, wc} = equippedKnife();
    let swings = 0; // a click every other frame (down, up, down, ...)
    for (let i = 0; i < 60; i++) swings += wc.update(DT, i % 2 ? idle : {...idle, pressed: true, held: true}, inv).filter(e => e.type === 'swing').length;
    expect(swings).toBe(2); // 1 s: windup + swing at ~0.15 s, the remembered click's windup after the recovery -> swing at ~0.80 s
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('ammo independence: the knife never needs, counts or takes ammo', () => {
  it('works with zero ammo anywhere and leaves the inventory untouched', () => {
    const {inv, wc} = equippedKnife(false);
    expect(inv.allStacks().filter(s => itemDef(s.itemId).kind === 'ammo')).toEqual([]);
    const before = JSON.stringify(inv.toJSON());
    const ev = clicks(wc, inv, 3, {reload: true});
    expect(ev.filter(x => x.e.type === 'contact').length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(inv.toJSON())).toBe(before);
    expect(wc.stack!.mag).toBe(0);
    expect(wc.canReload(inv)).toBe(false);
    expect(ev.some(x => x.e.type === 'reloadStart' || x.e.type === 'dry')).toBe(false);
    expect(weaponAmmoItem(KNIFE)).toBeNull();
    expect(reserveFor(KNIFE, inv)).toBe(0);
    expect(KNIFE.caliber).toBeUndefined();
  });

  it('with ammo carried, slashing does not spend a single round', () => {
    const {inv, wc} = equippedKnife(true);
    const ammo = weaponAmmoItem(WEAPONS.pistol)!;
    const n = inv.count(ammo), mag = inv.hotbar[0]!.mag;
    expect(clicks(wc, inv, 3, {reload: true}).filter(x => x.e.type === 'contact').length).toBeGreaterThanOrEqual(4);
    expect(inv.count(ammo)).toBe(n);
    expect(inv.hotbar[0]!.mag).toBe(mag);
  });

  it('melee helpers: meleeDefOf finds only the knife', () => {
    expect(meleeDefOf('knife')).toBe(KNIFE);
    for (const id of ['pistol', 'rifle', 'shotgun', 'bandage', null]) expect(meleeDefOf(id)).toBeNull();
    expect(Object.values(ITEMS).filter(d => d.kind === 'weapon' && meleeDefOf(d.id)).map(d => d.id)).toEqual(['knife']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('cancellation: switching, menus / death / travel and lowering never leave a stale contact or a gun shot', () => {
  const contactsIn = (ev: {e: WeaponEvent}[]) => ev.filter(x => x.e.type === 'contact').length;

  it('switching to the pistol mid-windup (button still held, then released): no swing / contact ever arrives and the pistol does not fire', () => {
    const {inv, wc} = equippedKnife(true);
    const ev0 = [...run(wc, inv, DT, {pressed: true, held: true}), ...run(wc, inv, DT * 2, {held: true})];
    expect(ev0.map(x => x.e.type)).toEqual(['windup']);
    const mag = inv.hotbar[0]!.mag;
    wc.equip(inv.hotbar[0]); // key 1 / wheel / Q (Game latches the still-held button: the gun sees no trigger until a new press)
    const ev = [...run(wc, inv, 0.5, {}), ...run(wc, inv, 1.0, {})]; // the release afterwards
    expect(contactsIn(ev)).toBe(0);
    expect(ev.some(x => x.e.type === 'fire' || x.e.type === 'swing')).toBe(false);
    expect(inv.hotbar[0]!.mag).toBe(mag);
    expect(wc.swinging).toBe(false);
  });

  it('cancelSwing (Game.setState leaving play: pause, inventory, focus loss, death, loading / travel): no swing or contact afterwards', () => {
    const {inv, wc} = equippedKnife();
    run(wc, inv, DT, {pressed: true, held: true});
    run(wc, inv, DT * 3, {held: true});
    expect(wc.swinging).toBe(true);
    expect(wc.cancelSwing()).toBe(true); // a windup (an attack) was pending
    const ev = run(wc, inv, 1, {}); // the mouse comes up later: nothing
    expect(ev).toEqual([]);
    expect(wc.cancelSwing()).toBe(false); // nothing to cancel
    // a released swing cancelled before its contact: no contact either
    run(wc, inv, DT, {pressed: true});
    run(wc, inv, KNIFE.melee!.windup + DT, {}); // the tap's swing has started
    expect(wc.meleeStage).toBe('swing');
    expect(wc.cancelSwing()).toBe(true);
    expect(contactsIn(run(wc, inv, 1, {}))).toBe(0);
  });

  it('a cancel after the release keeps the remaining swing + recovery time as cooldown (re-opening a menu never skips it)', () => {
    const {inv, wc} = equippedKnife();
    run(wc, inv, DT, {pressed: true});
    run(wc, inv, KNIFE.melee!.windup + DT, {}); // the swing has started
    expect(wc.meleeStage).toBe('swing');
    wc.cancelSwing();
    const early = run(wc, inv, DT, {pressed: true}); // a click right away is remembered, but the windup waits for the cooldown
    expect(early.filter(x => x.e.type === 'windup').length).toBe(0);
    const wait = run(wc, inv, KNIFE.melee!.sweep + KNIFE.melee!.recovery - 0.1, {});
    expect(wait.filter(x => x.e.type === 'windup').length).toBe(0);
    const later = run(wc, inv, 0.2, {});
    expect(later.filter(x => x.e.type === 'windup').length).toBe(1);
  });

  it('lowered (sprint / item use / climbing / a lane UI) cancels a windup or a swing before contact; after contact the recovery runs out', () => {
    const a = equippedKnife();
    run(a.wc, a.inv, DT, {pressed: true, held: true});
    const ev = [...run(a.wc, a.inv, 0.5, {lowered: true, held: true}), ...run(a.wc, a.inv, 1, {})]; // then released: nothing
    expect(contactsIn(ev)).toBe(0);
    expect(ev.filter(x => x.e.type === 'swing').length).toBe(0);
    const b = equippedKnife();
    const evb = [...run(b.wc, b.inv, DT, {pressed: true}), ...run(b.wc, b.inv, 0.3, {})];
    expect(contactsIn(evb)).toBe(1);
    expect(contactsIn(run(b.wc, b.inv, 1, {lowered: true}))).toBe(0);
  });

  it('Game wiring: leaving play cancels the swing; contact is ignored unless alive and playing; held-button latch on switch', () => {
    const src = fs.readFileSync(path.join(GAME, 'src/game.ts'), 'utf8');
    expect(src).toMatch(/if \(s !== 'playing'\) \{[^\n]*this\.weapon\.cancelSwing\(\);/);
    const fn = src.slice(src.indexOf('private meleeContact('), src.indexOf('private meleeContact(') + 300);
    expect(fn).toMatch(/!this\.player\.alive \|\| this\.state !== 'playing'/);
    expect(src).toMatch(/this\.weapon\.def\?\.melee \|\| WEAPONS\[def\.weaponId!\]\?\.melee\)\) this\.lmbLatch = true/);
    expect(src).toMatch(/this\.aiming = !!wdef && !wdef\.melee &&/); // right click does nothing with the knife
    expect(src).toMatch(/\{stagger: false\}/);
    expect(fn.length).toBeGreaterThan(0);
    // lane FEEL: wiped input / a lane UI / a button latched away mid-windup cancel (never a release that swings); the whoosh is
    // the release ('swing'), the windup is silent; the viewmodel gets the melee stage
    expect(src).toMatch(/lowered: [^\n]*\(!!wdef\.melee && \(laneOwns \|\| \(this\.lmbLatch && this\.weapon\.winding\)\)\), clears: inp\.clears\}/);
    expect(src).toMatch(/e\.type === 'swing'\) this\.sfx\.meleeSwing\(\)/);
    expect(src).not.toMatch(/e\.type === 'windup'\)[^\n]*sfx/);
    expect(src).toMatch(/melee: this\.weapon\.meleePose/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('first-person knife: held model, carry pose in view, slash through the crosshair, warm-up coverage', async () => {
  const pub = (url: string) => path.join(GAME, 'public', url);
  async function gltfOf(url: string): Promise<GLTF> { // textures stripped: no DOM image decoding in node
    const d = await new NodeIO().read(pub(url));
    for (const t of d.getRoot().listTextures()) t.dispose();
    const bin = await new NodeIO().writeBinary(d);
    return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  }
  const knife = await gltfOf(MODEL_FILES.knife.url);
  const stub = {scene: new THREE.Group()} as unknown as GLTF;
  // lane FEEL: the viewmodel reads the melee stage (WeaponController.meleePose) instead of a swing time
  type Stage = 'windup' | 'ready' | 'swing' | 'recover' | null;
  const view = (stage: Stage, t = 0) => ({moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0, melee: {stage, t}});
  function make() {
    const vm = new Viewmodel({rifle: stub, shotgun: stub, knife}, {});
    vm.setAspect(16 / 9);
    vm.setItem('knife');
    vm.update(1, view(null)); // equip raise done
    return vm;
  }
  const tipNdc = (vm: InstanceType<typeof Viewmodel>) => {
    vm.scene.updateMatrixWorld(true);
    const holder = vm.warmRoots().find(r => r.getObjectByName('knife') && r.getObjectByName('Tip'))!;
    return holder.getObjectByName('Tip')!.getWorldPosition(new THREE.Vector3()).project(vm.camera);
  };

  it('the knife is a held item of the viewmodel and is covered by the "weapons and held items" warm-up roots', () => {
    const vm = make();
    const roots = vm.warmRoots();
    const holder = roots.find(r => r !== roots[0] && r.getObjectByName('knife'));
    expect(holder).toBeTruthy();
    expect(holder!.visible).toBe(true); // selected
    const mesh = holder!.getObjectByName('knife') as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.frustumCulled).toBe(false); // never culled away in the overlay pass
  });

  it('lane FEEL carry pose: the blade stands up (tip well above the guard), right of the crosshair, inside the near / far range', () => {
    const vm = make();
    const p = tipNdc(vm);
    expect(p.x).toBeGreaterThan(0.1);
    expect(p.x).toBeLessThan(0.6);
    expect(Math.abs(p.y)).toBeLessThan(0.3);
    expect(p.z).toBeGreaterThan(-1);
    expect(p.z).toBeLessThan(1);
  });

  it('swing: raised out to the right, the tip on the crosshair at contact, swept to the left after, back at rest at the end', () => {
    const m = KNIFE.melee!;
    const vm = make();
    const rest = tipNdc(vm);
    vm.update(0, view('ready', 0));
    const cocked = tipNdc(vm);
    vm.update(0, view('swing', m.strike));
    const hit = tipNdc(vm);
    vm.update(0, view('swing', m.sweep));
    const through = tipNdc(vm);
    vm.update(0, view('recover', m.recovery - 1e-6));
    const back = tipNdc(vm);
    expect(cocked.x).toBeGreaterThan(rest.x); // drawn back to the right
    expect(cocked.y).toBeGreaterThan(rest.y + 0.4); // and raised
    expect(Math.hypot(hit.x, hit.y)).toBeLessThan(0.12); // the blade point crosses the crosshair at contact
    expect(through.x).toBeLessThan(hit.x); // swept on to the left
    expect(back.distanceTo(rest)).toBeLessThan(0.01);
    // pure offsets: zero in the carry, continuous across the stage boundaries
    expect(meleePoseOffset(null, 0, m)).toEqual({x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0});
    const a = meleePoseOffset('windup', m.windup, m), b = meleePoseOffset('ready', 0, m), c = meleePoseOffset('swing', 0, m);
    for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) { expect(a[k]).toBeCloseTo(b[k], 6); expect(b[k]).toBeCloseTo(c[k], 6); }
    expect(KNIFE.view.hip).toEqual([...KNIFE_POSES.carry.pos]);
  });
});
