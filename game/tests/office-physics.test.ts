// Task office-interactions-layout-20261030 (lane PHYS): the office's movable furniture reacts to bullets AND to walking into it
// (root CLAUDE.md "Props — core design rules" 2 / 3; docs/prop-affordances.md section 3). Node tests (cannon-es, no WebGL):
//  - the audit: every prop kind of PROP_DEFS has a PROP_PHYSICS_AUDIT row (damage/physicsAudit.ts) with an honest reason, and the
//    row agrees with the live physics (dynamicKind); the Subway's dynamic kinds / masses are pinned (unchanged by this pass);
//  - every dynamic office kind gets a body, reacts to a shot (moves / tips), to a walker moving into it (office contact wake), and
//    then sleeps to a static body; the monitor goes loose ON its desk (host-top slab: never falls into the desk); static kinds
//    never move; mass ordering is sane (a chair moves more than the camera pedestal, a bean bag barely moves under a pistol round);
//  - a generated office level: contact wake only near the walker (never the tower, never far AI), budgets respected, the
//    detach reserve kept, no dynamic prop starting deep inside a neighbour;
//  - loot: a holder never wakes by contact; a shot spill holder spills its finite lots exactly once (same ids / counts); a moving
//    chair lifts a lot it hits off its holder exactly once;
//  - the elevator cab: resting / moving loose props ride its dy and are swept out of a shutting doorway;
//  - task office-props-physics-scale-20261030 (lane PHYS): the Subway wakes by contact too (its light kinds carry calibrated
//    castor / pad contacts, damage/materials.ts SUBWAY_CONTACT; tests/contact-physics.test.ts covers them in depth); holders
//    still shots only, a light kind on a host stays static.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, rowLayout} from './helpers/openablesFixture';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {levelsOf, type Level} from '../src/gen/levels';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../src/gen/props';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {OFFICE_KINDS, officeKindAsset, officeModelKey} from '../src/gen/office/kinds';
import {OFFICE_PHYS} from '../src/gen/office/physics';
import {PHYS_MATS, PROP_PHYSICS, ALL_PROP_KINDS, SUBWAY_CONTACT, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT, unclassifiedPhysicsKinds} from '../src/damage/physicsAudit';
import {PhysicsSystem} from '../src/physics/world';
import {CONTACT_RANGE, CONTACT_RESERVE, MAX_DYNAMIC_PROPS, dynamicKind, type PickupLike, type Walker} from '../src/physics/dynamicItems';
import {SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import {isLootHolderKind} from '../src/items/loot';
import {isSpillHolderKind, openableSpec} from '../src/world/openablesSpec';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager, type ContainerEvent} from '../src/world/containers';
import {buildWorld} from '../src/world/builder';
import {PropDamage} from '../src/damage/propDamage';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

installCanvasShim(false);
{
  // the item label atlas clips its cells (the no-raster shim has no clip): a no-op is enough here
  const ctx = (document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx) as {clip?: () => void};
  proto.clip ??= () => {};
}

const DT = 1 / 60;
const run = (ph: PhysicsSystem, s: number, each?: () => void) => { for (let t = 0; t < s - 1e-9; t += DT) { ph.update(DT); each?.(); } };
const PELLET = 15 * SHOT_IMPULSE_PER_DAMAGE, RIFLE = 24 * SHOT_IMPULSE_PER_DAMAGE, PISTOL = 17 * SHOT_IMPULSE_PER_DAMAGE;

/** 24 x 16 m room: solid border, floor at 0. */
function room(props: PropPlacement[]) {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : FLOOR);
  return {grid: g, props, trench: {floorY: -1.15}};
}

function place(kind: PropKind, x: number, z: number, y = 0, extra: Partial<PropPlacement> = {}): PropPlacement {
  const {hx, hz} = footprint(kind, 0);
  return {kind, x, z, y, rot: 0, area: 0, hx, hz, h: PROP_DEFS[kind].h, blocksSight: false, variant: 0, ...extra};
}

/** A stand-in render mesh per detached prop (its matrix = the prop pose, driven by the body like the real detached meshes). */
function detacher(o: {room?: () => number} = {}) {
  const meshes = new Map<PropPlacement, THREE.Mesh>();
  return {
    meshes,
    d: {
      detachForPhysics: (p: PropPlacement) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
        m.matrixAutoUpdate = false;
        m.matrix.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1));
        meshes.set(p, m);
        return [m];
      },
      ...(o.room ? {detachRoom: o.room} : {}),
    },
  };
}

/** Pose of a detached prop (its stand-in mesh): position of its placement origin + how far its up axis tipped (rad). */
function pose(m: THREE.Mesh): {p: THREE.Vector3; tilt: number} {
  const p = new THREE.Vector3().setFromMatrixPosition(m.matrix);
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m.matrix));
  return {p, tilt: up.angleTo(new THREE.Vector3(0, 1, 0))};
}

function officeWorld(props: PropPlacement[]) {
  const ph = new PhysicsSystem(null);
  ph.build(room(props));
  ph.dynamicItems.contactWake = true; // office rules (a tower world switches them on by itself: StaticQuery.capAbove)
  const det = detacher();
  ph.dynamicItems.detacher = det.d;
  return {ph, det};
}

const DYNAMIC_OFFICE = OFFICE_KINDS.filter(k => OFFICE_PHYS[k].dynamic);
/** A zero-scale instance matrix (damage/propDamage.ts hides a detached prop's shared instances with makeScale(0, 0, 0)). */
const hiddenM = (m: THREE.Matrix4) => [0, 1, 2, 4, 5, 6, 8, 9, 10].every(i => m.elements[i] === 0);
/** Instances of a shared InstancedMesh not hidden by a zero-scale matrix. */
function visibleInstances(im: THREE.InstancedMesh): number {
  let n = 0;
  const m = new THREE.Matrix4();
  for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); if (!hiddenM(m)) n++; }
  return n;
}
const STATIC_OFFICE = OFFICE_KINDS.filter(k => !OFFICE_PHYS[k].dynamic);

// ---------------------------------------------------------------------------------------------

describe('physics-affordance audit (PROP_PHYSICS_AUDIT): every prop kind classified, honest, in step with the live physics', () => {
  it('no unclassified kind; every row agrees with dynamicKind; static rows carry a reason, dynamic rows a plausible body', () => {
    expect(unclassifiedPhysicsKinds()).toEqual([]);
    expect(Object.keys(PROP_PHYSICS_AUDIT).sort()).toEqual([...ALL_PROP_KINDS].sort());
    for (const k of ALL_PROP_KINDS) {
      const r = PROP_PHYSICS_AUDIT[k];
      expect(r.kind).toBe(k);
      expect(r.cls, k).toBe(dynamicKind(k) ? 'dynamic' : 'static');
      expect(r.how.length, k).toBeGreaterThan(8);
      if (r.cls === 'static') { expect(r.why, k).toBeTruthy(); continue; }
      expect(r.mass!, k).toBeGreaterThan(0.5);
      expect(r.mass!, k).toBeLessThanOrEqual(50);
      expect(Object.keys(PHYS_MATS), k).toContain(r.mat);
      // holders only ever go loose through the spill path, and never by contact
      if (isLootHolderKind(k)) { expect(isSpillHolderKind(k), k).toBe(true); expect(r.contact, k).toBe(false); }
    }
  });

  it('office / company / support kinds come from gen/office/physics.ts (this pass); every one is classified there', () => {
    for (const k of OFFICE_KINDS) {
      expect(OFFICE_PHYS[k], k).toBeTruthy();
      expect(PROP_PHYSICS_AUDIT[k].src).toBe('office');
      expect(propPhysics(k).dynamic).toBe(OFFICE_PHYS[k].dynamic);
    }
    // the brief's movable family is dynamic; the heavy / built-in family static
    for (const k of ['officeChair', 'executiveChair', 'loungeArmchair', 'beanBag', 'pottedPlantSmall', 'deadPlant', 'officeMonitor', 'officeWhiteboard', 'gumballJar',
      'archiveBoxes', 'giantTeddy', 'rockingHorse', 'catTree', 'dressForm', 'clothingRack', 'tvCamera', 'vitalsMonitor', 'satelliteModel', 'telescope']) expect(PROP_PHYSICS_AUDIT[k].cls, k).toBe('dynamic');
    for (const k of ['officeFiling', 'serverRack', 'receptionDesk', 'lawBookcase', 'vaultSafe', 'kegerator', 'arcadeCabinet', 'newsDesk', 'tradingDesk', 'cubiclePartition',
      'lobbySofa', 'chesterfieldSofa', 'parcelPallet', 'planterTree', 'conferenceTable']) expect(PROP_PHYSICS_AUDIT[k].cls, k).toBe('static');
    console.info(`[audit] office: ${DYNAMIC_OFFICE.length} dynamic (${DYNAMIC_OFFICE.join(', ')}), ${STATIC_OFFICE.length} static`);
  });

  it('Subway kinds keep their classes and masses; their contact (castor / pad + wake) comes from SUBWAY_CONTACT only, never on-host', () => {
    const sub = ALL_PROP_KINDS.filter(k => PROP_PHYSICS_AUDIT[k].src === 'subway');
    const dyn = Object.fromEntries(sub.filter(k => PROP_PHYSICS_AUDIT[k].cls === 'dynamic').sort().map(k => [k, PROP_PHYSICS_AUDIT[k].mass]));
    console.info(`[subway] ${JSON.stringify(dyn)}`);
    expect(dyn).toEqual({
      babyStroller: 9, basketStack: 3, bicycle: 13, bin: 7, coatRack: 6, crowdBarrier: 16, drumFan: 14, fireExtinguisher: 6, foldingBarricade: 6, foldingChair: 4,
      handToolbox: 6, handTruck: 14, ingredientBin: 8, ivPole: 4, mopBucketWringer: 8, newspaperBundles: 12, officeSwivelChair: 12, paperShredder: 10, pedestalFan: 5,
      plasticStackChair: 3, rollingSuitcase: 9, spinnerRack: 14, stepLadder: 7, trashBagPile: 8, tripodWorkLight: 6, wetDryVac: 8, wetFloorSign: 1.2, wheelchair: 15,
      wheelieBin: 12,
    });
    for (const k of sub) {
      const ph = propPhysics(k);
      expect(!!ph.onHost, k).toBe(false);
      // task office-props-physics-scale-20261030 (lane PHYS): calibrated contact + wake exactly for the SUBWAY_CONTACT kinds
      const overlay = !!SUBWAY_CONTACT[k] && ph.dynamic;
      expect(ph.mat === 'castor' || ph.mat === 'pad' || !!ph.contact || ph.fit !== undefined, k).toBe(overlay);
      expect(PROP_PHYSICS_AUDIT[k].contact ?? false, k).toBe(overlay && !isLootHolderKind(k));
    }
    // every office row of PROP_PHYSICS is an office kind (no Subway id overwritten)
    for (const k of Object.keys(PROP_PHYSICS)) if (PROP_PHYSICS[k].mat === 'castor' || PROP_PHYSICS[k].mat === 'pad' || PROP_PHYSICS[k].onHost || PROP_PHYSICS[k].contact) expect(OFFICE_KINDS as readonly string[]).toContain(k);
  });

  it('docs/prop-affordances.md names the audit and the office physics table', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../docs/prop-affordances.md', import.meta.url)), 'utf8');
    for (const s of ['PROP_PHYSICS_AUDIT', 'game/src/damage/physicsAudit.ts', 'game/src/gen/office/physics.ts', 'OFFICE_PHYS', 'tests/office-physics.test.ts']) expect(doc).toContain(s);
  });
});

// ---------------------------------------------------------------------------------------------

describe('dynamic office kinds: a body on demand, shots and walkers move them, then they sleep to a static body', () => {
  const floorKinds = DYNAMIC_OFFICE.filter(k => !propPhysics(k).onHost);
  /** Holders (a spill holder like the archive boxes) wake by shots only. */
  const walkKinds = floorKinds.filter(k => !isLootHolderKind(k));

  it('every floor-standing dynamic kind reacts to a buckshot volley (moves / tips), stays on the floor and settles', () => {
    const rows: string[] = [];
    for (const k of floorKinds) {
      const p = place(k, 8, 6);
      const {ph, det} = officeWorld([p]);
      expect(ph.dynamicItems.isDynamicProp(p), k).toBe(true);
      // 9 pellets into its upper half from the west
      const y = p.h * 0.7, x = p.x - p.hx;
      for (let i = 0; i < 9; i++) expect(ph.dynamicItems.shootProp(p, 0, new THREE.Vector3(x, y + (i % 3) * 0.03, p.z + (i - 4) * 0.03), new THREE.Vector3(1, -0.05, 0).normalize(), PELLET), k).toBe(true);
      expect(p.h, k).toBe(0); // no AABB left at the old place
      let minY = Infinity;
      run(ph, 12, () => { minY = Math.min(minY, pose(det.meshes.get(p)!).p.y); });
      const {p: at, tilt} = pose(det.meshes.get(p)!);
      const moved = Math.hypot(at.x - 8, at.z - 6);
      rows.push(`${k} ${propPhysics(k).mass}kg moved ${moved.toFixed(3)} tilt ${(tilt * 57.3).toFixed(0)}`);
      expect(moved + tilt, k).toBeGreaterThan(0.005);
      expect(moved, k).toBeLessThan(3);
      expect(minY, k).toBeGreaterThan(-0.05); // never through the floor
      expect(ph.dynamicItems.stats().propsAwake, k).toBe(0); // asleep: a static body at its final pose
      expect(ph.dynamicItems.rayHits(new THREE.Vector3(at.x, 3, at.z), new THREE.Vector3(0, -1, 0), 4, []).length, k).toBe(1);
    }
    console.info(`[shot] ${rows.join(' | ')}`);
  });

  it('every floor-standing dynamic kind wakes when the player walks into it (no shot first), is shoved along, then sleeps', () => {
    const rows: string[] = [];
    expect(walkKinds.length).toBeGreaterThan(15);
    for (const k of walkKinds) {
      const p = place(k, 10, 8);
      const {ph, det} = officeWorld([p]);
      const w: Walker = {id: {}, x: p.x - p.hx - 0.3 - 0.8, z: p.z, y: 0, r: 0.3, wake: true};
      ph.dynamicItems.walkers = () => [w];
      const half = p.hx * (propPhysics(k).fit ?? 1);
      let into = 0; // how far the walker's circle reaches into the shoved prop's collider (the camera would clip into it)
      for (let i = 0; i < 150; i++) {
        w.x += 1.4 * DT; ph.update(DT);
        const m = det.meshes.get(p);
        if (m && pose(m).tilt < 0.2) into = Math.max(into, w.x + w.r - (pose(m).p.x - half));
      }
      expect(ph.dynamicItems.stats().counts.contacts, k).toBe(1);
      expect(p.h, k).toBe(0);
      const {p: at, tilt} = pose(det.meshes.get(p)!);
      rows.push(`${k} dx ${(at.x - 10).toFixed(2)} tilt ${(tilt * 57.3).toFixed(0)} into ${into.toFixed(2)}`);
      expect(into, k).toBeLessThan(0.15);
      expect((at.x - 10) + tilt, k).toBeGreaterThan(0.15); // shoved ahead (or tipped over)
      ph.dynamicItems.walkers = () => [];
      run(ph, 20);
      expect(ph.dynamicItems.stats().propsAwake, k).toBe(0);
    }
    console.info(`[walk] ${rows.join(' | ')}`);
  });

  it('a walker brushing past / walking away / far AI never wakes a prop; AI near the player does', () => {
    const chair = place('officeChair', 10, 8), chair2 = place('officeChair', 20, 14), chair3 = place('officeChair', 10, 14);
    const {ph} = officeWorld([chair, chair2, chair3]);
    const player: Walker = {id: {}, x: 10, z: 8 - chair.hz - 0.35, y: 0, r: 0.3, wake: true}; // beside it, walking along +x
    const far: Walker = {id: {}, x: 20 - chair2.hx - 1.1, z: 14, y: 0, r: 0.3}; // > CONTACT_RANGE from the player, walking into chair 2
    ph.dynamicItems.walkers = () => [player, far];
    for (let i = 0; i < 90; i++) { player.x += 1.4 * DT; far.x += 1.4 * DT; ph.update(DT); expect(Math.hypot(far.x - player.x, far.z - player.z)).toBeGreaterThan(CONTACT_RANGE); }
    expect(ph.dynamicItems.stats().counts.contacts).toBe(0);
    expect(chair.h).toBeGreaterThan(0);
    expect(chair2.h).toBeGreaterThan(0);
    // a zombie walking into chair 3 within CONTACT_RANGE of the player wakes it
    const near: Walker = {id: {}, x: 10 - chair3.hx - 1.1, z: 14, y: 0, r: 0.3};
    player.x = 12; player.z = 11;
    ph.dynamicItems.walkers = () => [player, near];
    for (let i = 0; i < 90; i++) { near.x += 1.4 * DT; ph.update(DT); }
    expect(chair3.h).toBe(0);
    expect(ph.dynamicItems.stats().counts.contacts).toBe(1);
  });

  it('the monitor goes loose ON its desk (host-top slab: it never drops into the desk through the split loot surface) and can fall off it', () => {
    const desk = place('desk', 8, 6);
    const mon = place('officeMonitor', 8 - 0.05, 6, desk.y + desk.h, {host: 0});
    const {ph, det} = officeWorld([desk, mon]);
    // the desk's item collision as in the game: its top surface split round the monitor's cut (a gap right under it)
    ph.holderBoxes = q => q === desk ? [new THREE.Box3(new THREE.Vector3(desk.x - 0.73, 0, desk.z - 0.35), new THREE.Vector3(desk.x - 0.36, desk.h, desk.z + 0.35)),
      new THREE.Box3(new THREE.Vector3(desk.x + 0.26, desk.h - 0.06, desk.z - 0.35), new THREE.Vector3(desk.x + 0.73, desk.h, desk.z + 0.35))] : null;
    expect(ph.dynamicItems.isDynamicProp(mon)).toBe(true);
    // a walker at the desk front is out of reach (raised prop; not a floor prop)
    const w: Walker = {id: {}, x: desk.x, z: desk.z + desk.hz + 0.3, y: 0, r: 0.3, wake: true};
    ph.dynamicItems.walkers = () => [w];
    for (let i = 0; i < 30; i++) { w.z -= 0.4 * DT; ph.update(DT); }
    expect(mon.h).toBeGreaterThan(0);
    ph.dynamicItems.walkers = () => [];
    // one rifle round into the screen: it rocks / slides but stays on the desk top
    expect(ph.dynamicItems.shootProp(mon, 1, new THREE.Vector3(mon.x, mon.y + 0.28, mon.z + 0.18), new THREE.Vector3(0, -0.1, -1).normalize(), RIFLE)).toBe(true);
    expect(ph.dynamicItems.stats().counts.hostSlabs).toBe(1);
    let lowest = Infinity;
    run(ph, 6, () => { lowest = Math.min(lowest, pose(det.meshes.get(mon)!).p.y); });
    expect(lowest).toBeGreaterThan(desk.h - 0.05);
    expect(ph.dynamicItems.stats().propsAwake).toBe(0);
    // a buckshot volley from the side knocks it over / off: wherever it ends it is on the desk top or on the floor, never inside the desk
    for (let i = 0; i < 9; i++) ph.dynamicItems.shootProp(mon, 1, new THREE.Vector3(mon.x - 0.27, desk.h + 0.3, mon.z), new THREE.Vector3(1, -0.1, 0).normalize(), PELLET);
    const inside = (v: THREE.Vector3) => Math.abs(v.x - desk.x) < desk.hx - 0.05 && Math.abs(v.z - desk.z) < desk.hz - 0.05 && v.y < desk.h - 0.06 && v.y > 0.08;
    let wasInside = false;
    run(ph, 10, () => { if (inside(pose(det.meshes.get(mon)!).p)) wasInside = true; });
    expect(wasInside).toBe(false);
    const end = pose(det.meshes.get(mon)!).p;
    expect(end.y > desk.h - 0.06 || end.y < 0.3).toBe(true);
  });

  it('the reception counter-well monitor (not on its host top face) and on-top decor of a dynamic host stay static', () => {
    const rd = place('receptionDesk', 8, 6);
    const mon = place('officeMonitor', 8, 6, 0.74, {host: 0});
    const plant = place('pottedPlantSmall', 14, 6), book = place('officeMonitor', 14, 6, plant.h, {host: 2});
    const {ph} = officeWorld([rd, mon, plant, book]);
    expect(ph.dynamicItems.isDynamicProp(mon)).toBe(false); // inside the counter's solid box
    expect(ph.dynamicItems.isDynamicProp(book)).toBe(false); // its host can move
    expect(ph.dynamicItems.isDynamicProp(plant)).toBe(false); // something rests on it: no floating stack
  });

  it('static office kinds never move: no body for shots, no contact wake, the AABB stays', () => {
    for (const k of STATIC_OFFICE) {
      const p = place(k, 12, 8);
      const h0 = p.h;
      const {ph} = officeWorld([p]);
      expect(ph.dynamicItems.isDynamicProp(p), k).toBe(false);
      expect(ph.dynamicItems.shootProp(p, 0, new THREE.Vector3(p.x - p.hx, 0.6, p.z), new THREE.Vector3(1, 0, 0), RIFLE), k).toBe(false);
      const w: Walker = {id: {}, x: p.x - p.hx - 1.1, z: p.z, y: 0, r: 0.3, wake: true};
      ph.dynamicItems.walkers = () => [w];
      for (let i = 0; i < 60; i++) { w.x += 1.4 * DT; ph.update(DT); }
      expect(ph.dynamicItems.stats().counts.contacts, k).toBe(0);
      expect(p.h, k).toBe(h0);
      expect(ph.dynamicItems.looseProps().length, k).toBe(0);
    }
  });

  it('mass ordering: the same volley moves a chair more than the camera pedestal; a pistol round barely moves a bean bag', () => {
    const moveOf = (k: PropKind, n: number, j: number) => {
      const p = place(k, 8, 6);
      const {ph, det} = officeWorld([p]);
      for (let i = 0; i < n; i++) ph.dynamicItems.shootProp(p, 0, new THREE.Vector3(p.x - p.hx, p.h * 0.5, p.z + (i - n / 2) * 0.01), new THREE.Vector3(1, 0, 0), j);
      run(ph, 10);
      const {p: at} = pose(det.meshes.get(p)!);
      return Math.hypot(at.x - 8, at.z - 6);
    };
    const chair = moveOf('officeChair', 9, PELLET), cam = moveOf('tvCamera', 9, PELLET), bag = moveOf('beanBag', 1, PISTOL), teddy = moveOf('giantTeddy', 9, PELLET);
    console.info(`[mass] chair ${chair.toFixed(3)} m, tv camera ${cam.toFixed(3)} m, bean bag (pistol) ${bag.toFixed(3)} m, teddy ${teddy.toFixed(3)} m`);
    expect(chair).toBeGreaterThan(cam * 2);
    expect(chair).toBeGreaterThan(0.1); // a chair slides (castors)
    expect(bag).toBeLessThan(0.03);
  });
});

// ---------------------------------------------------------------------------------------------

describe('a generated office level: bounded, local, the tower never wakes', () => {
  const generated = generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'});
  /** The level with its own prop placements (loose props zero their box: tests never share them). */
  const fresh = () => ({...generated, props: generated.props.map(p => ({...p}))});
  const layout = fresh();

  it('contact wake is on in every world; the office rules for uncalibrated kinds switch on by themselves in the tower only', () => {
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    expect(ph.dynamicItems.contactOn).toBe(true);
    expect(ph.dynamicItems.officeRules).toBe(true);
    const sub = new PhysicsSystem(null);
    sub.build(generateStation(424242));
    expect(sub.dynamicItems.contactOn).toBe(true); // task office-props-physics-scale-20261030: the Subway too
    expect(sub.dynamicItems.officeRules).toBe(false);
  });

  it('no dynamic office prop starts inside a neighbour deeper than 2 cm (no pop when it wakes)', () => {
    let worst = 0, what = '', n = 0;
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    for (const p of layout.props) {
      if (!OFFICE_PHYS[p.kind as keyof typeof OFFICE_PHYS]?.dynamic || p.mounted || !ph.dynamicItems.isDynamicProp(p)) continue;
      n++;
      const fit = propPhysics(p.kind).fit ?? 1;
      const ax = p.hx * fit, az = p.hz * fit;
      for (const q of layout.props) {
        if (q === p || q.h <= 0.02 || q.mounted || q.host !== undefined && q.y > p.y + 0.05) continue;
        if ((q.level ?? 0) !== (p.level ?? 0) || q.y >= p.y + p.h - 0.02 || q.y + q.h <= p.y + 0.02) continue;
        if (p.host !== undefined && layout.props[p.host] === q && p.y >= q.y + q.h - 0.03) continue; // resting on its host
        const ox = Math.min(p.x + ax, q.x + q.hx) - Math.max(p.x - ax, q.x - q.hx), oz = Math.min(p.z + az, q.z + q.hz) - Math.max(p.z - az, q.z - q.hz);
        const pen = Math.min(ox, oz);
        if (ox > 0 && oz > 0 && pen > worst) { worst = pen; what = `${p.kind} in ${q.kind}`; }
      }
    }
    console.info(`[overlap] ${n} loose-able office props, worst ${worst.toFixed(3)} m (${what})`);
    expect(worst).toBeLessThan(0.02);
  });

  it('walking through a storey wakes only the props walked into; budgets / reserve hold; far storeys and far AI untouched', () => {
    const layout = fresh();
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    let detached = 0;
    const det = detacher({room: () => 64 - detached});
    ph.dynamicItems.detacher = {detachForPhysics: p => { detached++; return det.d.detachForPhysics(p); }, detachRoom: det.d.detachRoom};
    const storey = 3;
    // floor props only (the walker here is teleported to each one's base height; on-host monitors stand on desks)
    const targets = layout.props.map((p, i) => ({p, i})).filter(({p}) => (p.level ?? 0) === storey && ph.dynamicItems.isDynamicProp(p) && !isLootHolderKind(p.kind) && !propPhysics(p.kind).onHost);
    expect(targets.length).toBeGreaterThan(10);
    const other = layout.props.filter(p => (p.level ?? 0) === 6 && ph.dynamicItems.isDynamicProp(p) && !isLootHolderKind(p.kind))[0];
    expect(other).toBeTruthy();
    const player: Walker = {id: {}, x: 0, z: 0, y: 0, r: 0.3, wake: true};
    // a zombie on storey 6 walking into a chair there (far from the player): never wakes it
    const ghost: Walker = {id: {}, x: other.x - other.hx - 1.0, z: other.z, y: other.y, r: 0.3};
    ph.dynamicItems.walkers = () => [player, ghost];
    const touched: {x: number; z: number}[] = [];
    let maxAwake = 0;
    for (const {p} of targets) {
      if (p.h <= 0.02) continue; // already shoved loose by an earlier approach
      player.x = p.x - p.hx - 1.0; player.z = p.z; player.y = p.y;
      ghost.x = other.x - other.hx - 1.0;
      touched.push({x: player.x, z: player.z});
      ph.update(DT);
      for (let i = 0; i < 45; i++) { player.x += 1.4 * DT; ghost.x += 1.0 * DT; ph.update(DT); maxAwake = Math.max(maxAwake, ph.dynamicItems.stats().propsAwake); }
      touched.push({x: player.x, z: player.z});
    }
    const loose = ph.dynamicItems.looseProps();
    const st = ph.dynamicItems.stats();
    console.info(`[level] ${targets.length} candidates on storey ${storey}, ${st.counts.contacts} contact wakes, ${loose.length} loose, max awake ${maxAwake}, detached ${detached}`);
    expect(maxAwake).toBeLessThanOrEqual(MAX_DYNAMIC_PROPS);
    expect(st.counts.contacts).toBeGreaterThan(5);
    expect(64 - detached).toBeGreaterThanOrEqual(CONTACT_RESERVE); // the reserve for bullet marks is kept
    expect(other.h).toBeGreaterThan(0); // the far zombie woke nothing
    for (const p of loose) {
      expect(p.level ?? 0).toBe(storey); // the rest of the tower never woke
      expect(Math.min(...touched.map(t => Math.hypot(t.x - p.x, t.z - p.z)))).toBeLessThan(2.5);
    }
    // everything settles; the cannon world holds only the bounded statics + resting loose props
    ph.dynamicItems.walkers = () => [];
    run(ph, 25);
    expect(ph.dynamicItems.stats().propsAwake).toBe(0);
    expect(ph.dynamicItems.awake).toBe(0);
  });

  it('shooting a dozen props across the level never simulates more than the budget at once; all come to rest', () => {
    const layout = fresh();
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    const det = detacher();
    ph.dynamicItems.detacher = det.d;
    const list = layout.props.map((p, i) => ({p, i})).filter(({p}) => ph.dynamicItems.isDynamicProp(p) && !isLootHolderKind(p.kind)).slice(0, 12);
    let maxAwake = 0;
    for (const {p, i} of list) {
      ph.dynamicItems.shootProp(p, i, new THREE.Vector3(p.x - p.hx, p.y + p.h * 0.6, p.z), new THREE.Vector3(1, 0, 0), RIFLE * 3);
      for (let k = 0; k < 6; k++) { ph.update(DT); maxAwake = Math.max(maxAwake, ph.dynamicItems.stats().propsAwake); }
    }
    expect(maxAwake).toBeLessThanOrEqual(MAX_DYNAMIC_PROPS);
    run(ph, 25, () => { maxAwake = Math.max(maxAwake, ph.dynamicItems.stats().propsAwake); });
    expect(maxAwake).toBeLessThanOrEqual(MAX_DYNAMIC_PROPS);
    expect(ph.dynamicItems.stats().propsAwake).toBe(0);
    expect(ph.dynamicItems.stats().pending).toBe(0);
  });
  it('office MODEL instances detach cleanly: own meshes with the model\'s geometry + materials, the shared instance hidden, no doubling, never culled, warm-up covers them', () => {
    const layout = fresh();
    // stand-in "Meshy" models (two meshes, named textured materials) for the dynamic kinds the builder instances from the library
    const tex = new THREE.Texture();
    // (task office-props-physics-scale-20261030, lane FURN: `sy` squashes the stand-in for the squat 1.3 m bean bag, so the builder's
    // uniform footprint fit keeps both meshes in the prop's box as the real model does)
    const model = (name: string, sy = 1): GLTF => {
      const scene = new THREE.Group();
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5 * sy, 0.6), new THREE.MeshStandardMaterial({name: `${name}-seat`, map: tex}));
      a.position.y = 0.25 * sy;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5 * sy, 0.1), new THREE.MeshStandardMaterial({name: `${name}-back`, color: 0x223344}));
      b.position.set(0, 0.75 * sy, -0.25);
      scene.add(a, b);
      scene.updateMatrixWorld(true);
      return {scene} as unknown as GLTF;
    };
    const lib: Record<string, GLTF> = {};
    for (const k of ['officeChair', 'executiveChair', 'officeMonitor', 'beanBag'] as const) lib[officeModelKey(officeKindAsset(k)!)] = model(k, k === 'beanBag' ? PROP_DEFS.beanBag.h / PROP_DEFS.beanBag.w : 1);
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(layout, mats, lib);
    const pd = new PropDamage();
    pd.build(layout.props, [w.group]);
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    ph.dynamicItems.detacher = pd;
    for (const kind of ['officeChair', 'executiveChair', 'officeMonitor', 'beanBag']) {
      const i = layout.props.findIndex(p => p.kind === kind && ph.dynamicItems.isDynamicProp(p));
      expect(i, kind).toBeGreaterThanOrEqual(0);
      const p = layout.props[i];
      const entries = pd.index.inst.get(p) ?? [];
      expect(entries.length, kind).toBe(2); // both model meshes found (not a box stand-in)
      for (const e of entries) expect((e.mesh.material as THREE.Material).name.startsWith(kind), kind).toBe(true);
      const shownBefore = entries.map(e => visibleInstances(e.mesh));
      expect(ph.dynamicItems.shootProp(p, i, new THREE.Vector3(p.x - p.hx, p.y + p.h * 0.6, p.z), new THREE.Vector3(1, 0, 0), PELLET * 6), kind).toBe(true);
      const own = pd.group.children.filter(o => o.name === `damaged-${kind}-${i}`) as THREE.Mesh[];
      expect(own.length, kind).toBe(2);
      entries.forEach((e, k) => {
        const m = new THREE.Matrix4();
        e.mesh.getMatrixAt(e.index, m);
        expect(hiddenM(m), kind).toBe(true); // the shared instance is hidden …
        expect(visibleInstances(e.mesh), kind).toBe(shownBefore[k] - 1); // … only this one (no other prop touched)
        const mine = own.find(o => o.geometry === e.mesh.geometry)!; // … and drawn once, by its own mesh with the model's geometry
        expect(mine, kind).toBeTruthy();
        const src = e.mesh.material as THREE.MeshStandardMaterial, got = mine.material as THREE.MeshStandardMaterial;
        expect(got.name, kind).toBe(src.name);
        expect(got.map, kind).toBe(src.map);
        let root: THREE.Object3D = mine;
        while (root.parent) root = root.parent;
        expect(root, kind).toBe(pd.group); // outside every culler-registered root: never moved to the cull layer
      });
      const before = own.map(o => o.matrix.clone());
      run(ph, 3);
      expect(own.some((o, k) => !o.matrix.equals(before[k])), kind).toBe(true); // they follow the body
      expect(pd.group.children.filter(o => o.name === `damaged-${kind}-${i}`).length, kind).toBe(2); // still exactly once
    }
    // warm-up: the damage pipeline of every dynamic office kind's shared material is pre-compiled with the station
    const warm = (PropDamage as unknown as {warmMats: Map<THREE.Material, THREE.Material>}).warmMats;
    pd.warmup();
    for (const [p, list] of pd.index.inst) if (OFFICE_PHYS[p.kind as keyof typeof OFFICE_PHYS]?.dynamic) for (const e of list) expect(warm.has(e.mesh.material as THREE.Material), p.kind).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

describe('loot: never floats, duplicates, vanishes or re-rolls when its holder / a neighbour moves', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

  it('a spill holder never wakes by contact; shot, it spills its finite lots exactly once (same ids / counts), never again', () => {
    // + the office's archive box stack once it is a spill holder with a loot table (lane OPEN's openable)
    const archive = isSpillHolderKind('archiveBoxes') && !!(openableSpec('archiveBoxes') as {loot?: unknown} | null)?.loot;
    for (const kind of ['bin', ...(archive ? ['archiveBoxes'] : [])]) {
      const events: ContainerEvent[] = [];
      const cm = new ContainerManager({}, mats, () => new Inventory());
      cm.onEvent = e => events.push(e);
      let layout = rowLayout([kind], {back: 3.5});
      for (let seed = 1; seed < 120; seed++) {
        layout = rowLayout([kind], {seed, back: 3.5});
        cm.build(layout);
        if (cm.openList[0]?.state.lots.length) break;
      }
      const h = cm.openList[0];
      expect(h, kind).toBeTruthy();
      const lots = h.state.lots.map(l => [l.id, l.itemId, l.count]);
      if (kind === 'bin') expect(lots.length, kind).toBeGreaterThan(0); // (the archive stack's own roll / fit is lane OPEN's: may be empty here)
      else console.info(`[spill] ${kind}: ${lots.length} lot(s) in the fixture`);
      const ph = new PhysicsSystem(null);
      ph.build(layout);
      ph.dynamicItems.contactWake = true;
      ph.holderBoxes = p => cm.physicsBoxes(p);
      ph.dynamicItems.detacher = detacher().d;
      ph.dynamicItems.holderLoose = p => cm.goLoose(p);
      // walk straight into it: holders never wake by contact (shots only)
      const w: Walker = {id: {}, x: h.prop.x, z: h.prop.z + h.prop.hz + 1.2, y: 0, r: 0.3, wake: true};
      ph.dynamicItems.walkers = () => [w];
      for (let i = 0; i < 60; i++) { w.z -= 1.4 * DT; ph.update(DT); }
      expect(ph.dynamicItems.stats().counts.contacts, kind).toBe(0);
      expect(h.state.lots.map(l => [l.id, l.itemId, l.count]), kind).toEqual(lots);
      ph.dynamicItems.walkers = () => [];
      expect(ph.dynamicItems.isDynamicProp(h.prop), kind).toBe(true);
      const volley = () => { for (let i = 0; i < 9; i++) ph.dynamicItems.shootProp(h.prop, 0, new THREE.Vector3(h.prop.x - 0.25, h.prop.y + 0.7, h.prop.z), new THREE.Vector3(1, -0.05, 0).normalize(), PELLET); };
      volley();
      run(ph, 2);
      volley();
      run(ph, 6);
      const spills = events.filter(e => e.type === 'spill');
      expect(spills.length, kind).toBe(1);
      expect(spills[0].spilled!.map(s => [s.lot.id, s.lot.itemId, s.lot.count]), kind).toEqual(lots);
      expect(h.state.lots.length, kind).toBe(0);
    }
  });

  it('a chair shoved into a shelf lifts the lot it hits off the holder exactly once (pickup with the same item / count)', () => {
    const chair = place('officeChair', 8, 6);
    const {ph} = officeWorld([chair]);
    // one lot standing on the floor-level tier of a holder just east of the chair
    const holder = {lots: [{id: 1, itemId: 'cola', count: 1, box: new THREE.Box3(new THREE.Vector3(8.7, 0.05, 5.9), new THREE.Vector3(8.77, 0.17, 5.97))}]};
    const pickups: PickupLike[] = [];
    let lifted = 0;
    ph.dynamicItems.pickups = () => pickups;
    ph.dynamicItems.liftLots = box => {
      const out: PickupLike[] = [];
      for (const l of [...holder.lots]) {
        if (!l.box.intersectsBox(box)) continue;
        holder.lots.splice(holder.lots.indexOf(l), 1);
        lifted++;
        const obj = new THREE.Group();
        const geo = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12);
        geo.translate(0, 0.061, 0);
        obj.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));
        obj.position.set(8.735, 0.05, 5.935);
        new THREE.Group().add(obj);
        const pk: PickupLike = {stack: {itemId: l.itemId, uid: 1, count: l.count}, x: obj.position.x, y: obj.position.y, z: obj.position.z, obj};
        pickups.push(pk);
        out.push(pk);
      }
      return out;
    };
    const w: Walker = {id: {}, x: chair.x - chair.hx - 1.0, z: 6, y: 0, r: 0.3, wake: true};
    ph.dynamicItems.walkers = () => [w];
    for (let i = 0; i < 120; i++) { w.x += 1.6 * DT; ph.update(DT); }
    ph.dynamicItems.walkers = () => [];
    run(ph, 6);
    expect(lifted).toBe(1);
    expect(holder.lots.length + pickups.length).toBe(1); // conserved: never duplicated, never lost
    expect(pickups[0].stack).toMatchObject({itemId: 'cola', count: 1});
    expect(ph.dynamicItems.stats().counts.knockOn).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the elevator cab: loose props inside ride its dy (resting and moving) and leave a shutting doorway', () => {
  // Levels 0 (station hall, floor 0), 1 and 2 (office storeys at 4.4 / 8.8; a SOLID shaft x 9.5..13, z 9.5..12.5); the cab
  // interior x 10..12.5, z 10..12 as a Levels dynamic volume (physics: kinematic floor / ceiling slabs, shaft walls solid).
  const base = (L: number) => L * 4.4;
  function cabWorld(props: PropPlacement[]) {
    const levels: Level[] = [0, 1, 2].map(L => {
      const g = new Grid(40, 30);
      for (let y = 2; y <= 27; y++) for (let x = 2; x <= 37; x++) { g.set(x, y, FLOOR); const i = g.idx(x, y); g.floor[i] = base(L); g.ceil[i] = base(L) + (L ? 3.0 : 4.0); }
      if (L >= 1) for (let y = 19; y <= 24; y++) for (let x = 19; x <= 25; x++) g.set(x, y, SOLID);
      return {id: L, role: L === 0 ? 'main' : 'office', grid: g, baseY: base(L)} as Level;
    });
    const layout = {seed: 1, grid: levels[0].grid, levels, levelLinks: [], rails: [], trench: {floorY: -1.15}, props};
    const v = levelsOf(layout).addDynamicVolume({x0: 10, z0: 10, x1: 12.5, z1: 12, floorY: base(1), ceilY: base(1) + 2.6, level: 1, gates: [], stops: [base(1), base(2)]});
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    const det = detacher();
    ph.dynamicItems.detacher = det.d;
    expect(ph.dynamicItems.contactOn).toBe(true); // a tower world
    return {ph, det, v};
  }
  const ride = (ph: PhysicsSystem, v: {floorY: number; ceilY: number}, to: number, each?: () => void) => {
    while (Math.abs(v.floorY - to) > 1e-9) {
      const step = Math.sign(to - v.floorY) * Math.min(1.5 * DT, Math.abs(to - v.floorY));
      v.floorY += step; v.ceilY += step;
      ph.update(DT);
      each?.();
    }
  };

  it('a resting loose chair rides 1 -> 2 exactly; a shoved one rides without sinking into the cab floor', () => {
    const chair = place('officeChair', 11.25, 11, base(1), {level: 1});
    const {ph, det, v} = cabWorld([chair]);
    expect(ph.dynamicItems.isDynamicProp(chair)).toBe(true);
    ph.dynamicItems.shootProp(chair, 0, new THREE.Vector3(chair.x - 0.2, base(1) + 0.7, chair.z), new THREE.Vector3(1, 0, 0), RIFLE);
    run(ph, 4);
    expect(ph.dynamicItems.stats().propsAwake).toBe(0); // resting: a static body
    const y0 = pose(det.meshes.get(chair)!).p.y;
    ride(ph, v, base(2));
    const y1 = pose(det.meshes.get(chair)!).p.y;
    expect(y1 - y0).toBeCloseTo(base(2) - base(1), 5);
    expect(chair.y).toBeCloseTo(base(2), 5);
    expect(ph.dynamicItems.stats().counts.carried).toBeGreaterThan(0);
    // shoved while the cab goes back down: it keeps riding on the cab floor
    ph.dynamicItems.shootProp(chair, 0, new THREE.Vector3(chair.x - 0.2, base(2) + 0.7, chair.z), new THREE.Vector3(1, 0, 0), PELLET * 6);
    let lowest = Infinity;
    ride(ph, v, base(1), () => { lowest = Math.min(lowest, pose(det.meshes.get(chair)!).p.y - v.floorY); });
    run(ph, 5);
    expect(lowest).toBeGreaterThan(-0.05);
    const end = pose(det.meshes.get(chair)!).p;
    expect(end.y - base(1)).toBeGreaterThan(-0.05);
    expect(end.y - base(1)).toBeLessThan(1.0);
    expect(end.x > 10 && end.x < 12.5 && end.z > 10 && end.z < 12).toBe(true);
  });

  it('relocate(): a resting loose prop in a doorway the doors shut on is moved to the nearer side', () => {
    const plant = place('pottedPlantSmall', 6, 6, base(1), {level: 1});
    const {ph, det} = cabWorld([plant]);
    ph.dynamicItems.shootProp(plant, 0, new THREE.Vector3(plant.x, base(1) + 0.3, plant.z - 0.2), new THREE.Vector3(0, 0, 1), 0.05); // just wake it
    run(ph, 4);
    const before = pose(det.meshes.get(plant)!).p;
    const n = ph.dynamicItems.relocate((x, _y, z) => (Math.abs(x - before.x) < 0.5 && Math.abs(z - before.z) < 0.5 ? [x, z - 0.6] : null));
    expect(n).toBe(1);
    const after = pose(det.meshes.get(plant)!).p;
    expect(after.z).toBeCloseTo(before.z - 0.6, 5);
    expect(plant.z).toBeCloseTo(after.z, 5);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the Subway: contact wake for its light kinds (task office-props-physics-scale-20261030), holders by shots only', () => {
  it('a suitcase walked into wakes; a trash can (spill holder) walked into stays put; no on-host decor', () => {
    const layout = generateStation(424242);
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    expect(ph.dynamicItems.contactOn).toBe(true);
    ph.dynamicItems.detacher = detacher().d;
    const bin = layout.props.find(p => p.kind === 'bin' && ph.dynamicItems.isDynamicProp(p))!;
    expect(bin).toBeTruthy();
    const h0 = bin.h;
    const w: Walker = {id: {}, x: bin.x - bin.hx - 1.0, z: bin.z, y: bin.y, r: 0.3, wake: true};
    ph.dynamicItems.walkers = () => [w];
    for (let i = 0; i < 90; i++) { w.x += 1.4 * DT; ph.update(DT); }
    expect(bin.h).toBe(h0);
    expect(ph.dynamicItems.stats().counts.contacts).toBe(0);
    const bag = layout.props.find(p => p.kind === 'rollingSuitcase' && ph.dynamicItems.isDynamicProp(p))!;
    expect(bag).toBeTruthy();
    w.x = bag.x - bag.hx - 1.0; w.z = bag.z; w.y = bag.y;
    ph.update(DT);
    for (let i = 0; i < 60; i++) { w.x += 1.4 * DT; ph.update(DT); }
    expect(bag.h).toBe(0);
    expect(ph.dynamicItems.stats().counts.contacts).toBe(1);
    // a light kind standing on a host (toolbox on a crate / cabinet) stays static in the Subway
    const top = layout.props.find(p => p.host !== undefined && dynamicKind(p.kind));
    if (top) expect(ph.dynamicItems.isDynamicProp(top)).toBe(false);
  });
});
