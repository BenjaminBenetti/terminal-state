// Task studio-turnstile-user-model-20261112-004550-01: the Turnstile (G07), the user's own model of the selected shotgun concept B — a
// six-shell top-break revolving 12-gauge. Covers: its handling (double action / semi ~0.55 s between shots, six shells, quick draw,
// mobile, a broad short-range pattern; 12-gauge only); the shell-by-shell break reload (3.9 s for a full cylinder, a partial reload loads
// only the missing shells, a short reserve loads what it has, a trigger press stops it after the current shell, a switch keeps what went
// in, nothing fires while open); its sounds (the shared shotgun shot without a pump rack, the Coach Gun's open / close, a shell insert
// per shell); the cooked model (registry, the real GLB: one Barrels part turning about the model's own hinge pin, the frame staying put,
// the downsized PBR maps, no source names); and the pools (the shotgun category, the Gun and Weapon slots, uniform, one bundle of
// 12-gauge). The save / memory / delivery / Lockbox paths are registry-driven (weapon-variety-loot, weapon-runtime-delivery,
// train-lockbox-grant). No browser, no git history.
// + task studio-turnstile-cylinder-rotation-20261112-034833-01 (the user: "I want it to rotate as you shoot!"): the Cylinder part (a child of
// Barrels on the cylinder's own axis) turns one chamber per actual shot in the real Viewmodel, and only there.
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ImageUtils, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';

vi.mock('../src/world/canvasTextures', () => ({canvasTexture: () => new THREE.Texture()}));

const {WEAPONS, WeaponController, weaponAmmoItem, reserveFor} = await import('../src/weapons/weapons');
type TriggerInput = import('../src/weapons/weapons').TriggerInput;
const {VARIETY_GUN_LENGTHS} = await import('../src/weapons/varietyGuns');
const {VARIETY_WEAPONS, VARIETY_GUN_IDS} = await import('../src/weapons/varietyIds');
const {WEAPON_VARIETY_MODELS} = await import('../src/assets/weaponVarietyModels.generated');
const {GunParts, BREAK_ANGLE, CYLINDER_INDEX, cylinderTurn} = await import('../src/weapons/gunParts');
const {Viewmodel} = await import('../src/weapons/viewmodel');
const {reloadCueTime} = await import('../src/weapons/gunHandling');
const {Inventory} = await import('../src/items/inventory');
const {ITEMS} = await import('../src/items/items');
const {GUN_CATEGORIES, GUN_LEAVES, MELEE_LEAVES, slotRows, gunAmmo, familyBundle, identityAvailable, weaponLength, HOST_MAX_M, weaponFindPlan, inWeaponPool,
  sectionWeaponPool, WEAPON_POOL_VERSION, WEAPON_POOL_LANE} = await import('../src/items/weaponVariety');
const {WEAPON_FIND_AMMO} = await import('../src/gen/weaponFinds');
const {LEVELS} = await import('../src/levels/registry');
const {sectionId} = await import('../src/levels/types');
const {createMemory} = await import('../src/run/memory');
const {Harness} = await import('./helpers/saveFixture');
const {saveFileText, restoreRun} = await import('../src/save/serialize');
const {parseSaveText} = await import('../src/save/validate');
type StationLayout = import('../src/gen/stationTypes').StationLayout;
type PickupPlacement = import('../src/gen/stationTypes').PickupPlacement;
type SectionMemory = import('../src/run/memory').SectionMemory;
const {WEAPON_VARIETY_ICONS} = await import('../src/ui/weaponVarietyIcons');
const {EJECTION_PORTS} = await import('../src/physics/world');
const {gunCue} = await import('../src/audio/gunVoices');
const {Sfx} = await import('../src/audio/sfx');
const {CUES} = await import('../src/audio/bank');
type CueId = import('../src/audio/bank').CueId;
const {FakeCtx, fakeBank} = await import('./helpers/fakeAudio');

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const DT = 1 / 60;
const idle: TriggerInput = {held: false, pressed: false, reload: false, lowered: false};
const T = WEAPONS.turnstile;
const R = T.reload as {kind: 'break'; start: number; eject: number; each: number; end: number};

let uid = 91000;
function rig(mag: number, reserve: number) {
  const inv = new Inventory();
  if (reserve) inv.add(inv.makeStack('ammo_12ga', reserve));
  const stack = {uid: uid++, itemId: 'turnstile', count: 1, mag};
  const wc = new WeaponController();
  wc.equip(stack as never);
  wc.update(2, idle, inv);
  expect(wc.phase).toBe('idle');
  return {inv, wc, stack};
}
type Ev = ReturnType<InstanceType<typeof WeaponController>['update']>[number];
/** Frames of `seconds`; per frame the input (or a function of the frame index); the events with their time. */
function run(r: ReturnType<typeof rig>, seconds: number, input: Partial<TriggerInput> | ((i: number) => Partial<TriggerInput>) = {}): (Ev & {t: number})[] {
  const out: (Ev & {t: number})[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) for (const e of r.wc.update(DT, {...idle, ...(typeof input === 'function' ? input(i) : input)}, r.inv)) out.push({...e, t: (i + 1) * DT});
  return out;
}
const count = (ev: Ev[], type: Ev['type']) => ev.filter(e => e.type === type).length;

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Turnstile: handling (selected B)', () => {
  it('a registered variety shotgun on 12-gauge only: the G07 asset, six shells, the shared 12-gauge reserve', () => {
    expect(VARIETY_GUN_IDS).toContain('turnstile');
    expect(VARIETY_WEAPONS.turnstile).toEqual({asset: 'G07', name: 'Turnstile', family: 'shotgun', caliber: '12ga'});
    expect([T.caliber, T.magazine, T.auto, T.sound, T.shotCycle, T.reload.kind]).toEqual(['12ga', 6, false, 'shotgun', 'none', 'break']);
    expect(weaponAmmoItem(T)).toBe('ammo_12ga');
    expect(weaponAmmoItem(T)).toBe(weaponAmmoItem(WEAPONS.shotgun));
    const r = rig(0, 9);
    expect(reserveFor(T, r.inv)).toBe(9);
  });

  it('double action: one shot per press, never faster than 0.55 s, six then dry; holding the trigger fires once', () => {
    const r = rig(6, 0);
    const shots = run(r, 5, {pressed: true, held: true}).filter(e => e.type === 'fire').map(e => e.t);
    expect(shots.length).toBe(6);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i] - shots[i - 1]).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(shots[i] - shots[i - 1]).toBeLessThan(0.55 + 2 * DT);
    }
    expect(r.stack.mag).toBe(0);
    const held = rig(6, 0);
    expect(count(run(held, 3, i => ({pressed: i === 0, held: true})), 'fire')).toBe(1);
    expect(held.stack.mag).toBe(5);
  });

  it('quick draw, mobile and broad / short against the pump; slower to put rounds out per shot (no strict upgrade)', () => {
    const P = WEAPONS.shotgun;
    expect(T.equipTime).toBeLessThan(P.equipTime);
    expect(T.moveMult).toBeGreaterThan(P.moveMult);
    expect(T.spreadHip).toBeGreaterThanOrEqual(P.spreadHip);
    expect(T.spreadAim).toBeGreaterThan(P.spreadAim);
    expect(T.range).toBeLessThan(P.range);
    expect(T.falloffStart).toBeLessThanOrEqual(P.falloffStart);
    expect(T.interval).toBeLessThan(P.interval); // double action vs the pump's cycle
    expect(T.damage * T.pellets).toBeLessThan(P.damage * P.pellets); // each shot hits lighter
    expect(R.start + T.magazine * R.each + R.end).toBeCloseTo(3.9, 9);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Turnstile: shell-by-shell break reload', () => {
  const total = (r: ReturnType<typeof rig>) => (r.stack.mag ?? 0) + r.inv.count('ammo_12ga');

  it('a full cylinder: open, six single shells (one every 0.5 s), close; 3.9 s; the action opens fully and closes again', () => {
    const r = rig(0, 20);
    expect(r.wc.update(DT, {...idle, reload: true}, r.inv).map(e => e.type)).toEqual(['reloadStart']);
    const opens: number[] = [];
    const ev: (Ev & {t: number})[] = [];
    for (let i = 0; i < 400 && !ev.some(e => e.type === 'reloadEnd'); i++) {
      for (const e of r.wc.update(DT, idle, r.inv)) ev.push({...e, t: (i + 2) * DT});
      opens.push(r.wc.actionOpen);
    }
    const shells = ev.filter(e => e.type === 'shellIn').map(e => e.t), end = ev.find(e => e.type === 'reloadEnd')!.t;
    expect(shells.length).toBe(6);
    expect(shells[0]).toBeCloseTo(R.start + R.each, 1);
    for (let i = 1; i < 6; i++) expect(shells[i] - shells[i - 1]).toBeCloseTo(R.each, 1);
    expect(end).toBeCloseTo(3.9, 1);
    expect([r.stack.mag, r.inv.count('ammo_12ga')]).toEqual([6, 14]);
    expect(Math.max(...opens)).toBe(1);
    expect(opens.at(-1)).toBe(0);
    expect([r.wc.reloading, r.wc.actionOpen]).toEqual([false, 0]);
  });

  it('partial: four left loads only the two missing shells (1.9 s); a short reserve loads what it has; a full cylinder will not open', () => {
    const part = rig(4, 20);
    part.wc.update(DT, {...idle, reload: true}, part.inv);
    const ev = run(part, 3);
    expect(count(ev, 'shellIn')).toBe(2);
    expect(ev.find(e => e.type === 'reloadEnd')!.t).toBeCloseTo(R.start + 2 * R.each + R.end, 1);
    expect([part.stack.mag, part.inv.count('ammo_12ga')]).toEqual([6, 18]);
    const short = rig(0, 3);
    short.wc.update(DT, {...idle, reload: true}, short.inv);
    expect(count(run(short, 4), 'shellIn')).toBe(3);
    expect([short.stack.mag, short.inv.count('ammo_12ga'), short.wc.canReload(short.inv)]).toEqual([3, 0, false]);
    const full = rig(6, 20);
    expect(full.wc.canReload(full.inv)).toBe(false);
    expect(full.wc.update(DT, {...idle, reload: true}, full.inv)).toEqual([]);
  });

  it('cancel: a trigger press with a shell loaded finishes the shell going in, closes and fires on the next press; an empty cylinder keeps loading', () => {
    const r = rig(0, 20);
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    expect(count(run(r, R.start + 2 * R.each + 0.1), 'shellIn')).toBe(2);
    const rest = run(r, R.each + R.end + 0.2, i => ({pressed: i === 0, held: i === 0}));
    expect(count(rest, 'fire')).toBe(0);
    expect(count(rest, 'shellIn')).toBe(1); // the third was already going in
    expect(count(rest, 'reloadEnd')).toBe(1);
    expect([r.stack.mag, r.inv.count('ammo_12ga'), r.wc.reloading]).toEqual([3, 17, false]);
    expect(count(run(r, 0.1, i => ({pressed: i === 0, held: i === 0})), 'fire')).toBe(1);
    expect(r.stack.mag).toBe(2);
    // presses while empty cannot interrupt (nothing to fire): the first shell goes in; the next press stops it after the shell then
    // under way (two in), never a shot while open
    const e = rig(0, 20);
    e.wc.update(DT, {...idle, reload: true}, e.inv);
    const ev = run(e, 3, i => ({pressed: i % 9 === 0, held: i % 9 === 0}));
    const end = ev.findIndex(x => x.type === 'reloadEnd'), first = ev.findIndex(x => x.type === 'fire');
    expect(end).toBeGreaterThanOrEqual(0);
    expect(first === -1 || first > end).toBe(true);
    expect(count(ev.slice(0, end), 'shellIn')).toBe(2);
  });

  it('a weapon switch mid-reload keeps exactly the shells already in; nothing is lost or minted', () => {
    const r = rig(0, 10);
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    run(r, R.start + 2 * R.each + 0.05);
    expect([r.stack.mag, r.inv.count('ammo_12ga')]).toEqual([2, 8]);
    r.wc.equip({uid: uid++, itemId: 'pistol', count: 1, mag: 15} as never);
    expect(r.wc.actionOpen).toBe(0);
    r.wc.equip(r.stack as never);
    run(r, 1);
    expect([r.wc.reloading, r.stack.mag, r.inv.count('ammo_12ga')]).toEqual([false, 2, 8]);
  });

  it('fuzz: 20 000 random frames conserve rounds, keep 0..6 loaded and never fire while open', () => {
    let seed = 7654321;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const r = rig(6, 30), start = total(r), other = {uid: uid++, itemId: 'pistol', count: 1, mag: 15};
    let fired = 0, held = false;
    for (let i = 0; i < 20000; i++) {
      const x = rnd();
      if (x < 0.002) { r.wc.equip(other as never); r.wc.equip(r.stack as never); }
      const pressed = x > 0.97;
      held = pressed || (held && x > 0.1);
      const open = r.wc.reloading;
      const f = count(r.wc.update(DT, {...idle, pressed, held, reload: x > 0.5 && x < 0.505, lowered: x > 0.6 && x < 0.62}, r.inv), 'fire');
      if (f) expect(open, `frame ${i}`).toBe(false);
      fired += f;
      expect(r.stack.mag).toBeGreaterThanOrEqual(0);
      expect(r.stack.mag).toBeLessThanOrEqual(6);
      expect(total(r) + fired).toBe(start);
    }
    expect(fired).toBeGreaterThan(10);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Turnstile: existing sounds only', () => {
  async function setup() {
    const made: InstanceType<typeof FakeCtx>[] = [];
    const {bank} = fakeBank({variants: 2});
    const sfx = new Sfx(() => { const c = new FakeCtx(); made.push(c); return c as unknown as AudioContext; }, bank);
    sfx.init();
    sfx.suspend(false);
    await new Promise(r => setTimeout(r, 40));
    const ctx = made[0], owner = new Map<unknown, CueId>();
    for (const cue of CUES) for (const c of bank.get(cue)) owner.set(c.buffer, cue);
    const played = (from: number) => ctx.started.slice(from).map(s => owner.get(s.buffer));
    return {sfx, ctx, played};
  }

  it('no own cue: the shot is the shared shotgun shot (no pump rack); the break shares the Coach Gun\'s open / close', () => {
    expect([gunCue('turnstile', 'Shot'), gunCue('turnstile', 'MagOut'), gunCue('turnstile', 'MagIn')]).toEqual([null, null, null]);
    expect([gunCue('turnstile', 'BreakOpen'), gunCue('turnstile', 'BreakClose')]).toEqual([gunCue('coach_gun', 'BreakOpen'), gunCue('coach_gun', 'BreakClose')]);
    expect(gunCue('turnstile', 'BreakOpen')).toBe('gunCoachGunBreakOpen');
  });

  it('the game\'s calls for a shot and a full reload play: shotgun shot; open, six shell inserts, close', async () => {
    const {sfx, ctx, played} = await setup();
    ctx.currentTime += 5;
    let n = ctx.started.length;
    sfx.shot(T.sound, T.shotCycle, T.id);
    expect(played(n)[0]).toBe('shotgunShot');
    expect(played(n)).not.toContain('shotgunPump'); // double action: no pump rack
    ctx.currentTime += 5;
    n = ctx.started.length;
    sfx.reloadStart(T.reloadCue ?? T.sound, true, reloadCueTime(T, true), T.id);
    for (let i = 0; i < 6; i++) sfx.shellIn();
    sfx.breakClose(T.sound, T.id);
    expect(played(n)).toEqual(['gunCoachGunBreakOpen', ...Array(6).fill('shellInsert'), 'gunCoachGunBreakClose']);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
const M = WEAPON_VARIETY_MODELS.turnstile!;
const file = path.join(PUBLIC, M.url);
/** The shipped GLB: its document, and a three.js load of it without the maps (Node has no image decoder). */
async function parsed(): Promise<{gltf: GLTF; doc: Awaited<ReturnType<NodeIO['read']>>}> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const stripped = await io.read(file);
  for (const t of stripped.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(stripped);
  const gltf = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  return {gltf, doc};
}

describe('the Turnstile: the user\'s model, cooked', () => {
  it('registry: G07 at 0.80 m, the five markers, the Barrels + Cylinder parts, the hinge inside the model', () => {
    expect([M.id, M.itemId, M.kind, M.url, M.length, VARIETY_GUN_LENGTHS.turnstile, weaponLength('turnstile')]).toEqual(['G07', 'turnstile', 'gun', 'assets/models/weapon-turnstile.glb', 0.8, 0.8, 0.8]);
    expect(M.parts).toEqual(['Barrels', 'Cylinder']);
    expect(Object.keys(M.markers).sort()).toEqual(['Eject', 'Grip', 'Hinge', 'Muzzle', 'Sight']);
    for (const [name, p] of Object.entries(M.markers)) for (let k = 0; k < 3; k++) {
      expect(p![k], `${name}[${k}]`).toBeGreaterThanOrEqual(M.bounds.min[k] - 1e-6);
      expect(p![k], `${name}[${k}]`).toBeLessThanOrEqual(M.bounds.max[k] + 1e-6);
    }
    expect(M.markers.Muzzle![2]).toBeCloseTo(M.bounds.min[2], 6);
    expect(M.markers.Hinge![2]).toBeLessThan(M.markers.Grip![2]); // the pin sits ahead of the grip, under the cylinder
    expect(M.length).toBeLessThanOrEqual(HOST_MAX_M);
    expect(EJECTION_PORTS.turnstile).toBeUndefined(); // a revolver keeps its hulls until it is broken open
  });

  it('the shipped GLB: one material with its three PBR maps downsized (2048 / 1024 / 1024 JPEG), no source names, ~3 MB', async () => {
    const {doc} = await parsed();
    const root = doc.getRoot();
    expect(fs.statSync(file).size).toBeLessThan(3.5e6);
    expect(root.listMaterials().length).toBe(1);
    const mat = root.listMaterials()[0];
    const size = (t: ReturnType<typeof mat.getBaseColorTexture>) => [ImageUtils.getSize(t!.getImage()!, t!.getMimeType()), t!.getMimeType()];
    expect([size(mat.getBaseColorTexture()), size(mat.getMetallicRoughnessTexture()), size(mat.getNormalTexture())])
      .toEqual([[[2048, 2048], 'image/jpeg'], [[1024, 1024], 'image/jpeg'], [[1024, 1024], 'image/jpeg']]);
    expect(root.listNodes().map(n => n.getName()).sort()).toEqual(['Barrels', 'Cylinder', 'Eject', 'Grip', 'Hinge', 'Muzzle', 'Sight', 'turnstile']);
    expect(root.listMeshes().map(m => m.getName()).sort()).toEqual(['Barrels', 'Cylinder', 'turnstile']);
    // every other name (scene, material, textures) is the cook's own; the generator string is the repo script
    const names = [...root.listScenes(), ...root.listMaterials(), ...root.listTextures()].map(o => o.getName());
    for (const n of names) expect(n).toMatch(/^weapon-turnstile(-[A-Za-z]+)?$/);
    expect(names.length).toBe(5);
    const glb = fs.readFileSync(file), json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()); // (the reader restamps it)
    expect(json.asset.generator).toBe('Terminal State tools/asset-pipeline/weapons/build-turnstile.mjs (glTF-Transform)');
    const prov = fs.readFileSync(path.join(PUBLIC, 'assets/derivatives/weapon-turnstile.json'), 'utf8');
    expect(prov).not.toMatch(/https?:|reference\/|\/workspace|portal|token=/i);
    expect(JSON.parse(prov).textures.map((t: {slot: string; size: number[]}) => [t.slot, t.size[0]])).toEqual([['baseColor', 2048], ['metallicRoughness', 1024], ['normal', 1024]]);
  });

  it('the break: the Barrels (cylinder + barrel) turn about the model\'s own hinge pin, the muzzle drops, the frame stays, closed again after', async () => {
    const {gltf} = await parsed();
    const scene = gltf.scene;
    const parts = GunParts.find(scene)!;
    expect(parts.barrels).not.toBeNull();
    expect(parts.magazine).toBeNull();
    const bar = scene.getObjectByName('Barrels')!, frame = scene.getObjectByName('turnstile')!;
    const hinge = new THREE.Vector3(...M.markers.Hinge!);
    const boxOf = (o: THREE.Object3D) => { scene.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
    // the barrels' own frame point at the hinge: it stays where it is through the turn
    scene.updateMatrixWorld(true);
    const hingeInBar = bar.worldToLocal(hinge.clone()), muzzle = new THREE.Vector3(...M.markers.Muzzle!), muzzleInBar = bar.worldToLocal(muzzle.clone());
    const closed = boxOf(bar), frameBox = boxOf(frame);
    expect(closed.min.z).toBeCloseTo(M.bounds.min[2], 3); // the barrels assembly carries the muzzle
    parts.apply(null, 1);
    scene.updateMatrixWorld(true);
    expect(bar.localToWorld(hingeInBar.clone()).distanceTo(hinge)).toBeLessThan(1e-6);
    const open = boxOf(bar), reach = hinge.z - muzzle.z;
    expect(bar.localToWorld(muzzleInBar.clone()).y).toBeLessThan(muzzle.y - reach * Math.sin(BREAK_ANGLE) * 0.9);
    expect(open.min.y).toBeLessThan(closed.min.y - 0.1); // the barrel's real geometry goes down with it
    expect(boxOf(frame).equals(frameBox)).toBe(true);
    parts.apply(null, 0);
    expect(boxOf(bar).min.distanceTo(closed.min)).toBeLessThan(1e-9);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Turnstile: the cylinder turns as it fires (one chamber per actual shot)', () => {
  const STEP = 2 * Math.PI / T.magazine; // six chambers: 60 deg
  const view = {moving: 0, sprint: false, aiming: false, lookDX: 0, lookDY: 0, reloading: false, reloadProgress: 0, using: false, useProgress: 0, bobT: 0};
  /** A node's turn about its own +Z (its rest has no rotation), in (-pi, pi]. */
  const turnOf = (o: THREE.Object3D) => {
    expect(Math.hypot(o.quaternion.x, o.quaternion.y)).toBeLessThan(1e-9);
    const a = 2 * Math.atan2(o.quaternion.z, o.quaternion.w);
    return Math.atan2(Math.sin(a), Math.cos(a));
  };
  const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
  /** The real Viewmodel holding the shipped model (its own clone), settled at the hip. */
  async function held() {
    const {gltf} = await parsed();
    const vm = new Viewmodel({} as never, {});
    expect(vm.addModel('turnstile', gltf)).toBe(true);
    vm.setItem('turnstile');
    for (let i = 0; i < 20; i++) vm.update(0.05, view);
    return {gltf, vm, cyl: vm.scene.getObjectByName('Cylinder')!, bar: vm.scene.getObjectByName('Barrels')!, body: vm.scene.getObjectByName('turnstile')!};
  }

  it('the GLB: the cylinder + its ratchet are a Cylinder child of Barrels, its node on the cylinder\'s measured axis; no triangle added or lost', async () => {
    const {gltf} = await parsed();
    const s = gltf.scene, bar = s.getObjectByName('Barrels')!, cyl = s.getObjectByName('Cylinder')!, body = s.getObjectByName('turnstile')!;
    expect(cyl.parent).toBe(bar);
    const tris = (o: THREE.Object3D) => (o as THREE.Mesh).geometry.index!.count / 3;
    expect([tris(cyl), tris(bar) + tris(cyl) + tris(body)]).toEqual([3079 + 103, M.tris]);
    expect(cyl.quaternion.equals(new THREE.Quaternion())).toBe(true);
    s.updateMatrixWorld(true);
    const at = cyl.getWorldPosition(new THREE.Vector3());
    const prov = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'assets/derivatives/weapon-turnstile.json'), 'utf8'));
    expect(at.distanceTo(new THREE.Vector3(...prov.processing.cylinderAxis.at as [number, number, number]))).toBeLessThan(1e-6);
    expect(prov.processing.cylinderAxis.radius).toBeCloseTo(0.039, 3); // 78 mm across
    // the round body is centred on that axis (its box within 1 mm), which lies between the cylinder's faces
    const box = new THREE.Box3().setFromObject(cyl);
    expect(Math.hypot((box.min.x + box.max.x) / 2 - at.x, (box.min.y + box.max.y) / 2 - at.y)).toBeLessThan(0.001);
    expect(at.z).toBeGreaterThan(box.min.z);
    expect(at.z).toBeLessThan(M.markers.Eject![2]); // the rear face
    expect(prov.revisions.map((r: {task: string}) => r.task)).toEqual(['studio-turnstile-cylinder-rotation-20261112-034833-01']);
    expect(prov.limitations.join(' ')).toMatch(/eight flutes for six shells/);
  });

  it('a turn is rigid about that axis, clockwise seen from behind; the frame and the Barrels stay where they are', async () => {
    const {gltf} = await parsed();
    const s = gltf.scene, cyl = s.getObjectByName('Cylinder')!, bar = s.getObjectByName('Barrels')!, body = s.getObjectByName('turnstile')!;
    const parts = GunParts.find(s, T.magazine)!;
    expect(parts.cylinder).not.toBeNull();
    s.updateMatrixWorld(true);
    const at = cyl.getWorldPosition(new THREE.Vector3()), before = cyl.matrixWorld.clone(), barM = bar.matrixWorld.clone(), bodyM = body.matrixWorld.clone();
    const top = cyl.worldToLocal(at.clone().add(new THREE.Vector3(0, 0.039, 0)));
    parts.index();
    parts.apply(null, 0, CYLINDER_INDEX.delay + CYLINDER_INDEX.time);
    s.updateMatrixWorld(true);
    const want = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(new THREE.Matrix4().makeRotationZ(-STEP))
      .multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z)).multiply(before);
    for (let i = 0; i < 16; i++) expect(Math.abs(cyl.matrixWorld.elements[i] - want.elements[i]), `element ${i}`).toBeLessThan(1e-9);
    expect(cyl.localToWorld(top.clone()).x).toBeGreaterThan(at.x + 0.03); // the top went right (+X), seen from behind
    expect([bar.matrixWorld.equals(barM), body.matrixWorld.equals(bodyM)]).toEqual([true, true]);
  });

  it('held (the real Viewmodel): each shot turns it one chamber as the kick comes down and it rests there; six shots = one turn; the loaded model never turns', async () => {
    const {gltf, vm, cyl, bar, body} = await held();
    const src = gltf.scene.getObjectByName('Cylinder')!;
    const barQ = bar.quaternion.clone(), barP = bar.position.clone(), bodyQ = body.quaternion.clone(), bodyP = body.position.clone();
    expect(turnOf(cyl)).toBe(0);
    for (let k = 1; k <= 6; k++) {
      vm.fire(T);
      vm.update(CYLINDER_INDEX.delay - 0.01, view);
      expect(near(turnOf(cyl), -(k - 1) * STEP), `shot ${k} kicking`).toBe(true); // not yet: the gun is still thrown up
      vm.update(0.01 + CYLINDER_INDEX.time / 2, view);
      expect(near(turnOf(cyl), -(k - 0.5) * STEP), `shot ${k} halfway`).toBe(true);
      vm.update(CYLINDER_INDEX.time / 2 + 0.01, view);
      expect(near(turnOf(cyl), -k * STEP), `shot ${k} done`).toBe(true);
      vm.update(0.3, view);
      expect(near(turnOf(cyl), -k * STEP), `shot ${k} resting`).toBe(true);
    }
    expect(Math.abs(turnOf(cyl))).toBeLessThan(1e-9);
    expect([bar.quaternion.equals(barQ), bar.position.equals(barP), body.quaternion.equals(bodyQ), body.position.equals(bodyP)]).toEqual([true, true, true, true]);
    expect(src.quaternion.equals(new THREE.Quaternion())).toBe(true); // the shared loaded model (pickups / warm-up clone it) stays at rest
    vm.fire(WEAPONS.shotgun); // a shot that is not the held gun's turns nothing
    vm.update(0.5, view);
    expect(Math.abs(turnOf(cyl))).toBeLessThan(1e-9);
  });

  it('actual shots only: the controller\'s fire events turn it, a dry press does not; broken open for the reload it goes with the barrels and keeps its turn', async () => {
    const {vm, cyl, bar, body} = await held();
    const inFrame = () => body.worldToLocal(cyl.getWorldPosition(new THREE.Vector3())); // the cylinder's place on the gun (not the moving hands)
    const drive = (r: ReturnType<typeof rig>, seconds: number, input: (i: number) => Partial<TriggerInput> = () => ({})) => {
      const ev = {fire: 0, dry: 0, shellIn: 0, open: 0};
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        for (const e of r.wc.update(DT, {...idle, ...input(i)}, r.inv)) {
          if (e.type === 'fire') { ev.fire++; vm.fire(e.def); } // as game.ts: a 'fire' event -> Game.fire -> Viewmodel.fire
          else if (e.type === 'dry') ev.dry++;
          else if (e.type === 'shellIn') ev.shellIn++;
        }
        vm.update(DT, {...view, reloading: r.wc.reloading, reloadProgress: r.wc.progress, actionOpen: r.wc.actionOpen});
        ev.open = Math.max(ev.open, r.wc.actionOpen);
      }
      return ev;
    };
    const press = (i: number) => ({pressed: i % 36 === 0, held: i % 36 === 0}); // a press every 0.6 s
    const one = rig(1, 0);
    expect(drive(one, 1.8, press)).toMatchObject({fire: 1, dry: 2});
    expect(near(turnOf(cyl), -STEP)).toBe(true);
    // a fresh six with a reserve: two shots, then the break reload
    const r = rig(6, 6);
    expect(drive(r, 1.2, press).fire).toBe(2);
    expect(near(turnOf(cyl), -3 * STEP)).toBe(true);
    r.wc.update(DT, {...idle, reload: true}, r.inv);
    const atRest = inFrame();
    let seenOpen = false;
    for (let i = 0; i < 400 && r.wc.reloading; i++) {
      drive(r, DT);
      if (r.wc.actionOpen === 1 && !seenOpen) {
        seenOpen = true;
        expect(bar.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(BREAK_ANGLE, 6); // the barrels are down
        expect(inFrame().distanceTo(atRest)).toBeGreaterThan(0.02); // ... and the cylinder with them
        expect(near(turnOf(cyl), -3 * STEP)).toBe(true); // shells going in do not turn it
      }
    }
    expect([seenOpen, r.wc.reloading, r.stack.mag]).toEqual([true, false, 6]);
    expect(near(turnOf(cyl), -3 * STEP)).toBe(true);
    expect(inFrame().distanceTo(atRest)).toBeLessThan(1e-9);
  });

  it('no other gun has a Cylinder; a model without one ignores shots; each index ends before the next shot', () => {
    expect(Object.values(WEAPON_VARIETY_MODELS).filter(m => m!.parts.includes('Cylinder')).map(m => m!.itemId)).toEqual(['turnstile']);
    // a break action without a cylinder (the Coach Gun's layout): a shot moves nothing
    const root = new THREE.Group(), barrels = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.4)), hinge = new THREE.Object3D();
    barrels.name = 'Barrels';
    barrels.position.set(0, -0.02, -0.1);
    hinge.name = 'Hinge';
    hinge.position.copy(barrels.position);
    root.add(barrels, hinge);
    const parts = GunParts.find(root, 2)!;
    expect(parts.cylinder).toBeNull();
    const q = barrels.quaternion.clone(), p = barrels.position.clone();
    parts.index();
    parts.apply(null, 0, 1);
    expect([parts.cylinderAngle, barrels.quaternion.equals(q), barrels.position.equals(p)]).toEqual([0, true, true]);
    const {delay, time} = CYLINDER_INDEX;
    expect([cylinderTurn(0, 1, 0), cylinderTurn(0, 1, delay), cylinderTurn(0, 1, delay + time / 2), cylinderTurn(0, 1, delay + time), cylinderTurn(0, 1, 9)].map(v => +v.toFixed(12))).toEqual([0, 0, 0.5, 1, 1]);
    expect(delay + time).toBeLessThan(T.interval - 0.1); // it rests on the chamber before the next shot can come
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Turnstile: item and pools (uniform, the ammo budget unchanged)', () => {
  it('an ordinary weapon item with its icon and a plausible loose-item body', () => {
    expect(ITEMS.turnstile).toMatchObject({id: 'turnstile', kind: 'weapon', stackMax: 1, weaponId: 'turnstile', icon: 'turnstile'});
    expect(ITEMS.turnstile.description).toMatch(/12-gauge/);
    expect(WEAPON_VARIETY_ICONS.turnstile).toMatch(/^<svg/);
    expect(new Inventory().makeStack('turnstile', 1).mag).toBe(6);
    expect(identityAvailable('turnstile')).toBe(true);
  });

  it('a fourth shotgun-category leaf; the Gun and Weapon slots share uniformly; one find = one standard 12-gauge bundle (6 + 6)', () => {
    expect(GUN_CATEGORIES.shotgun).toEqual(['shotgun', 'coach_gun', 'thresher', 'turnstile']);
    expect(slotRows('shotgun').find(([id]) => id === 'turnstile')![1]).toBeCloseTo(1 / 4, 12);
    expect(slotRows('gun').find(([id]) => id === 'turnstile')![1]).toBeCloseTo(1 / 10, 12);
    expect(slotRows('weapon').find(([id]) => id === 'turnstile')![1]).toBeCloseTo(1 / 20, 12);
    const weapon = slotRows('weapon');
    const guns = weapon.filter(([id]) => GUN_LEAVES.includes(id));
    expect(guns.reduce((t, [, w]) => t + w, 0)).toBeCloseTo(0.5, 12); // the total gun share is unchanged
    expect(new Set(guns.map(([, w]) => w.toFixed(12))).size).toBe(1);
    expect(gunAmmo('12ga', T.magazine, 1)).toEqual({loaded: 6, box: 6});
    expect(familyBundle('shotgun')).toEqual({caliber: '12ga', loaded: 6, box: 6, total: 12});
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
describe('the Turnstile: pool versions (a station already seen keeps its finds)', () => {
  /** A synthetic layout: `n` finds cycling pistol / rifle / shotgun, each with its paired box, in one area of `purpose`. */
  function synth(n: number, purpose: string, seed = 2026): StationLayout {
    const pickups: PickupPlacement[] = [];
    for (let k = 0; k < n; k++) {
      const family = (['pistol', 'rifle', 'shotgun'] as const)[k % 3], x = (k % 100) * 6, z = Math.floor(k / 100) * 6;
      pickups.push({itemId: family, count: 1, x, y: 0, z, area: 0} as PickupPlacement);
      const [ammo, cnt] = WEAPON_FIND_AMMO[family];
      pickups.push({itemId: ammo, count: cnt, x: x + 1.5, y: 0, z, area: 0} as PickupPlacement);
    }
    return {seed, pickups, areas: [{id: 0, type: 'storage', purpose}]} as unknown as StationLayout;
  }
  /** game.ts buildSectionSteps' order: the entry is counted, the section's pool read, the plan made, the pool recorded with its finds. */
  function spawn(layout: StationLayout, level: string, mem: SectionMemory) {
    mem.visits++;
    const pool = sectionWeaponPool(mem.lanes, mem.visits - 1);
    const plan = weaponFindPlan(layout, level, mem.id, {pool});
    if (plan.finds.length) mem.lanes[WEAPON_POOL_LANE] = pool;
    return plan;
  }
  const ids = (p: ReturnType<typeof weaponFindPlan>) => p.finds.map(f => f.itemId);

  it('version 1 is exactly the pre-Turnstile pool (rows, and main\'s own picks); version 2 only adds the Turnstile', () => {
    expect(WEAPON_POOL_VERSION).toBe(2);
    expect([inWeaponPool('turnstile', 1), inWeaponPool('turnstile', 2), GUN_LEAVES.filter(id => id !== 'turnstile').every(id => inWeaponPool(id, 1))]).toEqual([false, true, true]);
    const nine = GUN_LEAVES.filter(id => id !== 'turnstile');
    expect(slotRows('weapon', 1)).toEqual([...nine.map(id => [id, 0.5 / 9]), ...MELEE_LEAVES.map(id => [id, 0.5 / 7])]);
    expect(slotRows('gun', 1)).toEqual(nine.map(id => [id, 1 / 9]));
    expect(slotRows('shotgun', 1)).toEqual(['shotgun', 'coach_gun', 'thresher'].map(id => [id, 1 / 3]));
    expect(slotRows('melee', 1)).toEqual(slotRows('melee'));
    // the picks main (before the Turnstile) made for these finds (recorded from main's items/weaponVariety.ts), reproduced by version 1
    const golden = {
      storage: [
        'thresher', 'longslide', 'machete', 'machete', 'knife', 'overwatch', 'machete', 'machete', 'crowbar', 'track_shovel', 'knife', 'slugger',
        'overwatch', 'crowbar', 'crowbar', 'machete', 'longslide', 'sledgehammer', 'coach_gun', 'fire_axe', 'crowbar', 'track_shovel', 'shotgun',
        'slugger'
      ],
      'mall-guns': [
        'stub', 'hornet', 'shotgun', 'shotgun', 'stub', 'longslide', 'overwatch', 'shotgun', 'coach_gun', 'thresher', 'stub', 'coach_gun', 'longslide',
        'coach_gun', 'coach_gun', 'shotgun', 'hornet', 'coach_gun', 'rifle', 'overwatch', 'coach_gun', 'thresher', 'rifle', 'thresher'
      ],
    };
    for (const purpose of ['storage', 'mall-guns'] as const) expect(ids(weaponFindPlan(synth(24, purpose), 'bunker', 'bunker:main@st-7', {pool: 1})), purpose).toEqual(golden[purpose]);
    // over many finds version 1 never realizes the Turnstile; the current pool does
    for (const purpose of ['storage', 'mall-guns']) {
      const old = weaponFindPlan(synth(3000, purpose), 'subway', 'subway:main', {pool: 1}), now = weaponFindPlan(synth(3000, purpose), 'subway', 'subway:main');
      expect(ids(old)).not.toContain('turnstile');
      expect(ids(now)).toContain('turnstile');
    }
  });

  it('sectionWeaponPool: a recorded version wins (clamped); entered before without one = version 1; a first entry = the current pool', () => {
    expect(sectionWeaponPool({[WEAPON_POOL_LANE]: 1}, 3)).toBe(1);
    expect(sectionWeaponPool({[WEAPON_POOL_LANE]: 2}, 0)).toBe(2);
    expect(sectionWeaponPool({[WEAPON_POOL_LANE]: 99}, 0)).toBe(WEAPON_POOL_VERSION);
    expect(sectionWeaponPool({[WEAPON_POOL_LANE]: 'x'}, 1)).toBe(1);
    expect(sectionWeaponPool({}, 1)).toBe(1);
    expect(sectionWeaponPool({}, 0)).toBe(WEAPON_POOL_VERSION);
    expect(sectionWeaponPool(undefined, 0)).toBe(WEAPON_POOL_VERSION);
  });

  it('Continue of an OLD save (its station entered, never captured, no record) re-spawns main\'s finds; a new first entry records its pool and keeps it through a save', () => {
    const level = 'bunker' as const, layout = LEVELS[level].generate('main', {levelSeed: 3333, startWeapon: 'pistol'});
    const key = {level, section: 'main'};
    expect(weaponFindPlan(layout, level, sectionId(key)).finds.length).toBeGreaterThan(0);
    // an old save's current station: visits 1, pickups null, no lane -> version 1 = exactly what the old build realized there
    const old = {...createMemory(key), visits: 1};
    expect(ids(spawn(layout, level, old))).toEqual(ids(weaponFindPlan(layout, level, old.id, {pool: 1})));
    expect(old.lanes[WEAPON_POOL_LANE]).toBe(1);
    // a first entry with this build: the current pool, recorded; the arrival save keeps it; Continue re-spawns the same finds
    const h = new Harness(), mem = h.run.memory(h.run.current);
    const first = ids(spawn(layout, level, mem));
    expect([mem.visits, mem.lanes[WEAPON_POOL_LANE], mem.pickups]).toEqual([1, WEAPON_POOL_VERSION, null]);
    const parsed = parseSaveText(saveFileText(h.file()));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    const back = new Harness();
    expect(restoreRun(parsed.value.run, back.target()).failed).toEqual([]);
    const again = back.run.memory(back.run.current);
    expect(again.lanes[WEAPON_POOL_LANE]).toBe(WEAPON_POOL_VERSION);
    expect(ids(spawn(layout, level, again))).toEqual(first);
    // a section without weapon finds records nothing (its memory is unchanged)
    const empty = {...layout, pickups: layout.pickups.filter(p => !['pistol', 'rifle', 'shotgun'].includes(p.itemId))};
    const none = createMemory({level, section: 'main', station: 'st-99'});
    expect(spawn(empty, level, none).finds).toEqual([]);
    expect(none.lanes).toEqual({});
  });
});
