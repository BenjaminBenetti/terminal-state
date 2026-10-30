// Task office-props-physics-scale-20261030 (lane PHYS; user: "I love how the chairs interact when I walk in to them … things like
// the luggage in the subway … needed to be shot first … All physics objects should always be interactable, without needing to be
// shot first"). Node tests (cannon-es, the real PropDamage over the real built world, no WebGL):
//  - the audit: every light dynamic kind (Subway + Office) wakes by contact with a calibrated castor / pad material; holders still
//    shots only; Subway masses unchanged; anchored / kept / holder kinds static;
//  - a REAL Player (W key, the game's own movement + prop collision) walks into a Subway rolling suitcase, an office chair and an
//    imported Subway prop in the Office: each moves; no shot, no aim ray (the damage system is not even constructed);
//  - the chair feel is unchanged: the walk-in / buckshot numbers recorded before this pass are reproduced exactly;
//  - the detach budget never runs out: far more contact wakes than MAX_DETACHED_HARD, resting props handed back to their shared
//    instances AT THEIR NEW POSE (no pop, drawn exactly once), far bullet-marked props reclaimed last; contact keeps working;
//  - bounded: only the walked-into props wake, the simulating budget holds, resting loose props' static bodies leave the cannon
//    world with their chunk; bullets still promote props (also reclaimed ones).
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {DT, approach, contactRig, renderPose, settle, stand, walkForward, type ContactRig} from './helpers/contactWalk';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../src/gen/props';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {OFFICE_KINDS} from '../src/gen/office/kinds';
import {OFFICE_PHYS} from '../src/gen/office/physics';
import {ALL_PROP_KINDS, SUBWAY_CONTACT, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {MAX_DETACHED} from '../src/damage/propDamage';
import {SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import {PhysicsSystem} from '../src/physics/world';
import {CONTACT_RESERVE, MAX_DYNAMIC_PROPS, dynamicKind, type Walker} from '../src/physics/dynamicItems';
import {isLootHolderKind} from '../src/items/loot';
import {isSpillHolderKind} from '../src/world/openablesSpec';

installCanvasShim(false);
{
  // the item label atlas clips its cells (the no-raster shim has no clip): a no-op is enough here
  const ctx = (document as unknown as {createElement(t: string): {getContext(k: string): object}}).createElement('canvas').getContext('2d');
  const proto = Object.getPrototypeOf(ctx) as {clip?: () => void};
  proto.clip ??= () => {};
}

const PELLET = 15 * SHOT_IMPULSE_PER_DAMAGE, RIFLE = 24 * SHOT_IMPULSE_PER_DAMAGE;
/** The hard detach cap of damage/propDamage.ts (shots / physics may exceed the soft cap up to it). */
const MAX_DETACHED_HARD = 96;
const hiddenM = (m: THREE.Matrix4) => [0, 1, 2, 4, 5, 6, 8, 9, 10].every(i => m.elements[i] === 0);
const fresh = <T extends {props: PropPlacement[]}>(l: T): T => ({...l, props: l.props.map(p => ({...p}))});

/** No shot and no aim ray: any call fails the test. */
function forbidShots(rig: ContactRig): void {
  const di = rig.ph.dynamicItems as unknown as Record<string, unknown>;
  for (const k of ['shootProp', 'shootPickup', 'rayHits']) di[k] = () => { throw new Error(`${k} used: the player must not need to shoot / aim`); };
}

/** First prop of `kinds` (in order) that can go loose and has a free side to walk in from. */
function target(rig: ContactRig, kinds: readonly string[], level?: number): {p: PropPlacement; i: number; at: NonNullable<ReturnType<typeof approach>>} | null {
  for (const k of kinds) {
    for (let i = 0; i < rig.layout.props.length; i++) {
      const p = rig.layout.props[i];
      if (p.kind !== k || (level !== undefined && (p.level ?? 0) !== level) || !rig.ph.dynamicItems.isDynamicProp(p) || !renderPose(rig, p)) continue;
      const at = approach(rig, p);
      if (at) return {p, i, at};
    }
  }
  return null;
}

/** 24 x 16 m room: solid border, floor at 0. */
function room(props: PropPlacement[]) {
  const g = new Grid(48, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) g.set(x, y, x < 2 || y < 2 || x >= 46 || y >= 30 ? SOLID : FLOOR);
  return {grid: g, props, trench: {floorY: -1.15}};
}
function place(kind: PropKind, x: number, z: number): PropPlacement {
  const {hx, hz} = footprint(kind, 0);
  return {kind, x, z, y: 0, rot: 0, area: 0, hx, hz, h: PROP_DEFS[kind].h, blocksSight: false, variant: 0};
}
/** A lone prop in a room with a stand-in mesh driven by its body (as tests/office-physics.test.ts). */
function lone(kind: PropKind, x: number, z: number, wake: boolean | null) {
  const p = place(kind, x, z);
  const ph = new PhysicsSystem(null);
  ph.build(room([p]));
  ph.dynamicItems.contactWake = wake;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
  ph.dynamicItems.detacher = {detachForPhysics: q => {
    m.matrixAutoUpdate = false;
    m.matrix.compose(new THREE.Vector3(q.x, q.y, q.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    return [m];
  }};
  const pose = () => ({p: new THREE.Vector3().setFromMatrixPosition(m.matrix), tilt: new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m.matrix)).angleTo(new THREE.Vector3(0, 1, 0))});
  return {p, ph, pose};
}

// ---------------------------------------------------------------------------------------------

describe('every light physics prop wakes by contact (Subway and Office), holders by shots only', () => {
  it('audit: every dynamic non-holder kind has `contact` with a calibrated castor / pad material; Subway masses unchanged', () => {
    const rows: string[] = [];
    for (const k of ALL_PROP_KINDS) {
      const r = PROP_PHYSICS_AUDIT[k];
      if (r.cls !== 'dynamic') continue;
      const ph = propPhysics(k);
      expect(r.contact, k).toBe(!!ph.contact && !isLootHolderKind(k)); // the audit is the live physics
      if (isLootHolderKind(k)) { expect(isSpillHolderKind(k), k).toBe(true); expect(r.contact, k).toBe(false); continue; }
      expect(r.contact, k).toBe(true);
      expect(['castor', 'pad'], k).toContain(ph.mat);
      rows.push(`${k}:${ph.mat}`);
    }
    // every Subway contact row is a light dynamic kind (or an id kept for a later integration), never a static one
    for (const k of Object.keys(SUBWAY_CONTACT)) if (k in PROP_DEFS) expect(dynamicKind(k), k).toBe(true);
    // Subway kinds keep their iteration-07 masses (only the contact material / wake changed)
    const sub = Object.fromEntries(ALL_PROP_KINDS.filter(k => PROP_PHYSICS_AUDIT[k].src === 'subway' && PROP_PHYSICS_AUDIT[k].cls === 'dynamic').sort().map(k => [k, PROP_PHYSICS_AUDIT[k].mass]));
    expect(sub).toEqual({
      babyStroller: 9, basketStack: 3, bicycle: 13, bin: 7, coatRack: 6, crowdBarrier: 16, drumFan: 14, fireExtinguisher: 6, foldingBarricade: 6, foldingChair: 4,
      handToolbox: 6, handTruck: 14, ingredientBin: 8, ivPole: 4, mopBucketWringer: 8, newspaperBundles: 12, officeSwivelChair: 12, paperShredder: 10, pedestalFan: 5,
      plasticStackChair: 3, rollingSuitcase: 9, spinnerRack: 14, stepLadder: 7, trashBagPile: 8, tripodWorkLight: 6, wetDryVac: 8, wetFloorSign: 1.2, wheelchair: 15,
      wheelieBin: 12,
    });
    // wheeled kinds roll, the Lane A trash can keeps its iteration-07 contact (shots only: its bullet response is unchanged)
    for (const k of ['rollingSuitcase', 'babyStroller', 'wheelchair', 'handTruck', 'wheelieBin', 'officeSwivelChair']) expect(propPhysics(k).mat, k).toBe('castor');
    for (const k of ['plasticStackChair', 'foldingChair', 'wetFloorSign', 'trashBagPile', 'fireExtinguisher']) expect(propPhysics(k).mat, k).toBe('pad');
    expect(propPhysics('bin')).toMatchObject({mass: 7, mat: 'metal', shape: 'cylinder'});
    expect(propPhysics('bin').contact ?? false).toBe(false);
    // deliberate static exceptions stay static, with their reason
    for (const k of ['janitorCart', 'crtTvCart', 'mobileWhiteboard', 'physicianScale']) expect(PROP_PHYSICS_AUDIT[k]).toMatchObject({cls: 'static', why: 'kept'});
    console.info(`[contact] ${rows.length} contact kinds: ${rows.join(' ')}`);
  });

  it('a REAL Player walks (W) into a Subway rolling suitcase: it rolls / tips away, the player walks on — no shot, no aim', () => {
    const rig = contactRig(fresh(generateStation(424242)));
    forbidShots(rig);
    const t = target(rig, ['rollingSuitcase'])!;
    expect(t, 'a reachable rolling suitcase').toBeTruthy();
    const before = renderPose(rig, t.p)!;
    expect(before.detached).toBe(false); // drawn by its shared instance until touched
    stand(rig, t.at);
    const x0 = rig.player.x, z0 = rig.player.z;
    let wokeAt = -1;
    walkForward(rig, 1.0, i => { if (wokeAt < 0 && t.p.h === 0) wokeAt = i; });
    settle(rig, 4);
    const after = renderPose(rig, t.p)!;
    const st = rig.ph.dynamicItems.stats();
    const walked = Math.hypot(rig.player.x - x0, rig.player.z - z0);
    console.info(`[suitcase] #${t.i} woke at frame ${wokeAt}, moved ${after.p.distanceTo(before.p).toFixed(2)} m, player walked ${walked.toFixed(2)} m, contacts ${st.counts.contacts}, pushes ${st.counts.pushes}`);
    expect(wokeAt).toBeGreaterThanOrEqual(0);
    expect(st.counts.contacts).toBeGreaterThanOrEqual(1);
    expect(st.counts.shots).toBe(0);
    expect(t.p.h).toBe(0); // loose: no AABB stopping the player any more
    expect(after.p.distanceTo(before.p)).toBeGreaterThan(0.5);
    expect(walked).toBeGreaterThan(2); // not stopped at the suitcase (before this pass: stopped dead, 1.0 m)
    expect(st.propsAwake).toBe(0); // and it came to rest
  });

  it('a REAL Player walks into an office chair: it rolls ahead (the chair the user likes)', () => {
    const rig = contactRig(fresh(generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'})));
    forbidShots(rig);
    const t = target(rig, ['officeChair'])!;
    expect(t).toBeTruthy();
    const before = renderPose(rig, t.p)!;
    stand(rig, t.at);
    const x0 = rig.player.x, z0 = rig.player.z;
    walkForward(rig, 1.0);
    settle(rig, 4);
    const moved = renderPose(rig, t.p)!.p.distanceTo(before.p), walked = Math.hypot(rig.player.x - x0, rig.player.z - z0);
    console.info(`[chair] #${t.i} L${t.p.level} moved ${moved.toFixed(3)} m, player walked ${walked.toFixed(2)} m`);
    expect(rig.ph.dynamicItems.stats().counts.shots).toBe(0);
    expect(moved).toBeGreaterThan(1);
    expect(walked).toBeGreaterThan(2);
  });

  it('a REAL Player walks into an imported Subway prop standing in the Office: it moves without a shot', () => {
    const rig = contactRig(fresh(generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'})));
    forbidShots(rig);
    const imported = ['rollingSuitcase', 'plasticStackChair', 'officeSwivelChair', 'ivPole', 'fireExtinguisher', 'ingredientBin', 'mopBucketWringer', 'foldingBarricade', 'trashBagPile', 'tripodWorkLight'];
    const t = target(rig, imported)!;
    expect(t, 'an imported Subway prop with a free side').toBeTruthy();
    expect(OFFICE_KINDS as readonly string[]).not.toContain(t.p.kind);
    expect(rig.ph.dynamicItems.officeRules).toBe(true); // a tower world
    const before = renderPose(rig, t.p)!;
    stand(rig, t.at);
    walkForward(rig, 1.0);
    settle(rig, 4);
    const moved = renderPose(rig, t.p)!.p.distanceTo(before.p);
    console.info(`[imported] ${t.p.kind} #${t.i} L${t.p.level} moved ${moved.toFixed(2)} m`);
    expect(t.p.h).toBe(0);
    expect(moved).toBeGreaterThan(0.3);
    expect(rig.ph.dynamicItems.stats().counts.shots).toBe(0);
  });

  it('chair feel unchanged: the walk-in and buckshot numbers recorded before this pass are reproduced', () => {
    // recorded on the pre-pass code (lanes/PHYS.notes 19:20Z): lone prop, walker 1.4 m/s x 150 frames, then 20 s rest; 9 pellets
    const walk = (k: PropKind, wake: boolean | null) => {
      const {p, ph, pose} = lone(k, 10, 8, wake);
      const w: Walker = {id: {}, x: p.x - p.hx - 1.1, z: p.z, y: 0, r: 0.3, wake: true};
      ph.dynamicItems.walkers = () => [w];
      for (let i = 0; i < 150; i++) { w.x += 1.4 * DT; ph.update(DT); }
      const at = pose().p.x - 10;
      ph.dynamicItems.walkers = () => [];
      for (let i = 0; i < 1200; i++) ph.update(DT);
      return {at, rest: pose().p.x - 10, pushes: ph.dynamicItems.stats().counts.pushes};
    };
    const shot = (k: PropKind) => {
      const {p, ph, pose} = lone(k, 8, 6, true);
      for (let i = 0; i < 9; i++) ph.dynamicItems.shootProp(p, 0, new THREE.Vector3(p.x - p.hx, p.h * 0.5, p.z + (i - 4.5) * 0.01), new THREE.Vector3(1, 0, 0), PELLET);
      for (let i = 0; i < 600; i++) ph.update(DT);
      return pose().p.x - 8;
    };
    for (const wake of [true, null] as const) { // an office room / automatic rules: the chair is a contact kind, same either way
      const c = walk('officeChair', wake), e = walk('executiveChair', wake);
      expect(c.at).toBeCloseTo(2.6114, 3); expect(c.rest).toBeCloseTo(2.9940, 3); expect(c.pushes).toBe(70);
      expect(e.at).toBeCloseTo(2.6194, 3); expect(e.rest).toBeCloseTo(3.0763, 3); expect(e.pushes).toBe(60);
    }
    expect(shot('officeChair')).toBeCloseTo(0.1855, 3);
    expect(shot('executiveChair')).toBeCloseTo(0.0598, 3);
  });

  it('every Subway contact kind is shoved ahead (or tipped) without the walker reaching into it, then rests — in a Subway-rules world', () => {
    const rows: string[] = [];
    for (const k of Object.keys(SUBWAY_CONTACT).filter(k => k in PROP_DEFS && dynamicKind(k) && !isLootHolderKind(k)) as PropKind[]) {
      const {p, ph, pose} = lone(k, 10, 8, null);
      expect(ph.dynamicItems.officeRules, k).toBe(false); // not a tower: only the contact kinds' own rules apply
      const w: Walker = {id: {}, x: p.x - p.hx - 1.1, z: p.z, y: 0, r: 0.3, wake: true};
      ph.dynamicItems.walkers = () => [w];
      const half = p.hx * (propPhysics(k).fit ?? 1);
      let into = 0;
      for (let i = 0; i < 150; i++) {
        w.x += 1.4 * DT; ph.update(DT);
        if (p.h === 0 && pose().tilt < 0.2) into = Math.max(into, w.x + w.r - (pose().p.x - half));
      }
      expect(ph.dynamicItems.stats().counts.contacts, k).toBe(1);
      const {p: at, tilt} = pose();
      rows.push(`${k} dx ${(at.x - 10).toFixed(2)} tilt ${(tilt * 57.3).toFixed(0)} into ${into.toFixed(2)}`);
      expect(into, k).toBeLessThan(0.15);
      expect(at.x - 10 + tilt, k).toBeGreaterThan(0.15);
      ph.dynamicItems.walkers = () => [];
      for (let i = 0; i < 1200; i++) ph.update(DT);
      expect(ph.dynamicItems.stats().propsAwake, k).toBe(0);
    }
    console.info(`[subway walk] ${rows.join(' | ')}`);
  });

  it('anchored / kept / holder kinds never move when walked into; a light prop on a host stays put (Subway station)', () => {
    const layout = fresh(generateStation(424242));
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    ph.dynamicItems.detacher = {detachForPhysics: () => [new THREE.Mesh()]};
    const kinds = ['bench', 'ticketMachine', 'janitorCart', 'column', 'bin', 'vending'];
    const tried: string[] = [];
    for (const kind of kinds) {
      const p = layout.props.find(q => q.kind === kind && q.h > 0.3 && !q.mounted);
      if (!p) continue;
      tried.push(kind);
      const h0 = p.h;
      const w: Walker = {id: {}, x: p.x - p.hx - 1.0, z: p.z, y: p.y, r: 0.3, wake: true};
      ph.dynamicItems.walkers = () => [w];
      for (let i = 0; i < 90; i++) { w.x += 1.4 * DT; ph.update(DT); }
      expect(p.h, kind).toBe(h0);
    }
    expect(tried.length).toBeGreaterThanOrEqual(4);
    expect(ph.dynamicItems.stats().counts.contacts).toBe(0);
    const top = layout.props.find(q => q.kind === 'handToolbox' && q.host !== undefined);
    if (top) expect(ph.dynamicItems.isDynamicProp(top)).toBe(false);
  });

  it('bullets still promote: a shot Subway suitcase goes loose, slides / tips and rests (as before, plus its castor contact)', () => {
    const {p, ph, pose} = lone('rollingSuitcase', 8, 6, null);
    expect(ph.dynamicItems.isDynamicProp(p)).toBe(true); // DamageSystem.hitWorld's test
    for (let i = 0; i < 9; i++) expect(ph.dynamicItems.shootProp(p, 0, new THREE.Vector3(p.x - p.hx, p.h * 0.6, p.z), new THREE.Vector3(1, -0.05, 0).normalize(), PELLET)).toBe(true);
    expect(p.h).toBe(0);
    let minY = Infinity;
    for (let i = 0; i < 720; i++) { ph.update(DT); minY = Math.min(minY, pose().p.y); }
    const moved = Math.hypot(pose().p.x - 8, pose().p.z - 6);
    console.info(`[suitcase shot] moved ${moved.toFixed(2)} m tilt ${(pose().tilt * 57.3).toFixed(0)}`);
    expect(moved + pose().tilt).toBeGreaterThan(0.05);
    expect(moved).toBeLessThan(3);
    expect(minY).toBeGreaterThan(-0.05);
    expect(ph.dynamicItems.stats().propsAwake).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the detach budget never runs out: resting props hand their render back at their new pose', () => {
  it('a hundred-plus contact wakes across the tower: every prop walked into wakes, detached <= MAX_DETACHED, reattached exactly where it rests, bounded bodies', () => {
    const rig = contactRig(fresh(generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'})));
    const {ph, pd, layout} = rig;
    // the shared instance's world matrix of every candidate before anything moves (reattach check: same model-to-body relation)
    const instWorld = (p: PropPlacement) => {
      const e = pd.index.inst.get(p)![0];
      const m = new THREE.Matrix4();
      e.mesh.getMatrixAt(e.index, m);
      e.mesh.updateWorldMatrix(true, false);
      return m.premultiply(e.mesh.matrixWorld);
    };
    const targets = layout.props.map((p, i) => ({p, i})).filter(({p}) => (p.level ?? 0) >= 2 && ph.dynamicItems.isDynamicProp(p) && !isLootHolderKind(p.kind)
      && !propPhysics(p.kind).onHost && (pd.index.inst.get(p)?.length ?? 0) > 0).slice(0, 130);
    expect(targets.length).toBe(130);
    const start = new Map(targets.map(({p}) => [p, {inst: instWorld(p), x: p.x, y: p.y, z: p.z, rot: p.rot}]));
    const w: Walker = {id: {}, x: 0, z: 0, y: 0, r: 0.3, wake: true};
    rig.others = [];
    ph.dynamicItems.walkers = () => [w];
    let maxDetached = 0, maxAwake = 0, maxBodies = 0, missed = 0;
    for (const [k, {p}] of targets.entries()) {
      if (p.h === 0) continue; // already shoved loose by an earlier approach
      w.x = p.x - p.hx - 1.0; w.z = p.z; w.y = p.y;
      ph.update(DT);
      for (let i = 0; i < 45; i++) {
        w.x += 1.4 * DT; ph.update(DT);
        maxDetached = Math.max(maxDetached, pd.detachedCount); maxAwake = Math.max(maxAwake, ph.dynamicItems.stats().propsAwake); maxBodies = Math.max(maxBodies, ph.world!.bodies.length);
      }
      if (p.h !== 0) { missed++; console.info(`[budget] target ${k} ${p.kind} not woken`); }
    }
    const st = ph.dynamicItems.stats();
    console.info(`[budget] ${targets.length} targets, ${st.counts.contacts} contact wakes, missed ${missed}, reclaimed ${st.counts.reclaimed}, redetached ${st.counts.redetached}, max detached ${maxDetached}, max awake ${maxAwake}, max world bodies ${maxBodies}`);
    expect(missed).toBe(0); // contact keeps working long after MAX_DETACHED_HARD wakes
    expect(st.counts.contacts).toBeGreaterThan(MAX_DETACHED_HARD);
    expect(st.counts.reclaimed).toBeGreaterThan(st.counts.contacts - MAX_DETACHED);
    expect(maxDetached).toBeLessThanOrEqual(MAX_DETACHED);
    expect(MAX_DETACHED - pd.detachedCount).toBeGreaterThanOrEqual(CONTACT_RESERVE);
    expect(maxAwake).toBeLessThanOrEqual(MAX_DYNAMIC_PROPS);
    expect(maxBodies).toBeLessThan(400);
    // everything settles: the cannon world holds no resting loose prop once nothing simulates (their chunks are inactive)
    ph.dynamicItems.walkers = () => [];
    settle(rig, 25);
    const end = ph.dynamicItems.stats();
    expect(end.propsAwake).toBe(0);
    expect(end.resting).toBeGreaterThanOrEqual(targets.length);
    expect(end.restingInWorld).toBe(0);
    expect(ph.world!.bodies.length).toBeLessThan(10);
    // every loose prop is drawn exactly once: by its own meshes (instance hidden) or by its shared instance at its NEW pose
    const own = new Set(pd.group.children.map(o => o.name));
    let attached = 0;
    for (const {p, i} of targets) {
      const e = pd.index.inst.get(p)!;
      const m = new THREE.Matrix4();
      e[0].mesh.getMatrixAt(e[0].index, m);
      const detached = !!pd.states.get(p)?.parts;
      expect(hiddenM(m), `${p.kind} #${i}`).toBe(detached);
      expect(own.has(`damaged-${p.kind}-${i}`), `${p.kind} #${i}`).toBe(detached);
      if (detached) continue;
      attached++;
      // reattached where it rests: instance = body pose x (the start relation of body and model)
      const ent = (ph.dynamicItems as unknown as {ents: Map<PropPlacement, {body: {position: THREE.Vector3; quaternion: THREE.Quaternion}; center: THREE.Vector3}>}).ents.get(p)!;
      const s0 = start.get(p)!;
      const body0 = new THREE.Matrix4().compose(new THREE.Vector3(s0.x, s0.y, s0.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s0.rot), new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(ent.center.x, ent.center.y, ent.center.z));
      const body1 = new THREE.Matrix4().compose(new THREE.Vector3(ent.body.position.x, ent.body.position.y, ent.body.position.z), new THREE.Quaternion(ent.body.quaternion.x, ent.body.quaternion.y, ent.body.quaternion.z, ent.body.quaternion.w), new THREE.Vector3(1, 1, 1));
      const want = body1.clone().multiply(body0.invert()).multiply(s0.inst);
      const got = instWorld(p);
      for (let k = 0; k < 16; k++) expect(got.elements[k], `${p.kind} #${i} [${k}]`).toBeCloseTo(want.elements[k], 4);
    }
    expect(attached).toBeGreaterThan(targets.length - MAX_DETACHED);
    // no orphan own meshes: every one belongs to a detached prop
    let ownMeshes = 0;
    for (const s of pd.states.values()) ownMeshes += s.parts?.filter(q => q.mesh.parent === pd.group).length ?? 0;
    expect(pd.group.children.filter(o => o.name !== 'damage-warmup').length).toBe(ownMeshes);
  });

  it('a reclaimed prop wakes again by contact (re-detached at the same pose, no pop) and by a bullet', () => {
    const rig = contactRig(fresh(generateStation(424242)));
    const {ph, pd} = rig;
    const t = target(rig, ['rollingSuitcase'])!;
    stand(rig, t.at);
    walkForward(rig, 0.6);
    settle(rig, 4);
    expect(t.p.h).toBe(0);
    expect(pd.states.get(t.p)?.parts).toBeTruthy();
    // hand its render back (the reclaim the budget triggers: the oldest resting prop goes first)
    const reclaim = () => (ph.dynamicItems as unknown as {reclaim(n: number): number}).reclaim(1);
    expect(reclaim()).toBe(1);
    expect(pd.states.get(t.p)?.parts).toBeFalsy();
    const rest = renderPose(rig, t.p)!;
    expect(rest.detached).toBe(false);
    // walk into it again: drawn by its own meshes again exactly where its instance was, then shoved
    const at = rig.player;
    const dir = new THREE.Vector3(rest.p.x - at.x, 0, rest.p.z - at.z).normalize();
    at.yaw = Math.atan2(-dir.x, -dir.z);
    let first: THREE.Vector3 | null = null;
    walkForward(rig, 1.2, () => { const r = renderPose(rig, t.p)!; if (!first && r.detached) first = r.p.clone(); });
    expect(ph.dynamicItems.stats().counts.redetached).toBeGreaterThanOrEqual(1);
    expect(first).toBeTruthy();
    expect(first!.distanceTo(rest.p)).toBeLessThan(0.08); // no pop: the first own-mesh frame is where it rested (+ <= one frame's shove)
    settle(rig, 4);
    const moved = renderPose(rig, t.p)!.p.distanceTo(rest.p);
    expect(moved).toBeGreaterThan(0.3);
    // reclaim again, then a bullet: re-detached and knocked
    expect(reclaim()).toBe(1);
    expect(pd.states.get(t.p)?.parts).toBeFalsy();
    const before = renderPose(rig, t.p)!.p.clone();
    const ent = (ph.dynamicItems as unknown as {ents: Map<PropPlacement, {body: {position: THREE.Vector3}}>}).ents.get(t.p)!;
    const bp = ent.body.position;
    const hits = ph.dynamicItems.rayHits(new THREE.Vector3(bp.x - 3, bp.y, bp.z), new THREE.Vector3(1, 0, 0), 6, []);
    expect(hits[0]?.prop).toBe(t.p); // still hit-tested as a loose prop while drawn by its shared instance
    pd.hit({prop: t.p, index: t.i, point: hits[0].point, dir: new THREE.Vector3(1, 0, 0), normal: hits[0].normal, damage: 24});
    expect(ph.dynamicItems.shootProp(t.p, t.i, hits[0].point, new THREE.Vector3(1, 0, 0), RIFLE * 3)).toBe(true);
    settle(rig, 5);
    expect(renderPose(rig, t.p)!.p.distanceTo(before)).toBeGreaterThan(0.02);
    expect(pd.group.children.filter(o => o.name === `damaged-${t.p.kind}-${t.i}`).length).toBeGreaterThan(0); // its own meshes, once
  });

  it('far bullet-marked props give their slots back when the budget is full; near marks stay; contact still wakes the suitcase', () => {
    const rig = contactRig(fresh(generateStation(424242)));
    const {ph, pd, layout} = rig;
    const t = target(rig, ['rollingSuitcase'])!;
    stand(rig, t.at);
    // fill the soft cap with bullet marks: far static props first, then a few within 10 m of the player
    const dist = (p: PropPlacement) => Math.hypot(p.x - t.at.x, p.z - t.at.z);
    const marked = layout.props.map((p, i) => ({p, i})).filter(({p}) => ['table', 'bench', 'column', 'shelf', 'stockShelf', 'shopCounter', 'cabinetLow', 'cabinetTall'].includes(p.kind) && p.h > 0.3);
    const far = marked.filter(({p}) => dist(p) > 40), near = marked.filter(({p}) => dist(p) < 10).slice(0, 4);
    expect(far.length).toBeGreaterThan(MAX_DETACHED);
    for (const {p, i} of [...near, ...far]) {
      pd.hit({prop: p, index: i, point: new THREE.Vector3(p.x, p.y + p.h * 0.5, p.z + p.hz), dir: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(0, 0, 1), damage: 24});
      if (pd.detachedCount >= MAX_DETACHED) break;
    }
    expect(pd.detachedCount).toBe(MAX_DETACHED);
    const nearMarked = near.filter(({p}) => pd.states.get(p)?.parts);
    expect(nearMarked.length).toBeGreaterThan(0);
    // the player walks into the suitcase: slots come back from the far marked props, not the near ones
    walkForward(rig, 1.0);
    settle(rig, 3);
    expect(t.p.h).toBe(0);
    expect(rig.ph.dynamicItems.stats().counts.contacts).toBeGreaterThanOrEqual(1);
    for (const {p} of nearMarked) expect(pd.states.get(p)?.parts, p.kind).toBeTruthy();
    expect(MAX_DETACHED - pd.detachedCount).toBeGreaterThanOrEqual(CONTACT_RESERVE);
    // a reclaimed far prop keeps its damage state (a later hit detaches it again); its shared instance is shown where it was
    const back = far.find(({p}) => pd.states.get(p) && !pd.states.get(p)!.parts)!;
    expect(back).toBeTruthy();
    expect(pd.states.get(back.p)!.hits).toBe(1);
    const e = pd.index.inst.get(back.p)![0];
    const m = new THREE.Matrix4();
    e.mesh.getMatrixAt(e.index, m);
    expect(hiddenM(m)).toBe(false);
    void ph;
  });
});

// ---------------------------------------------------------------------------------------------

describe('bounded: a walk through the Subway wakes only what is walked into', () => {
  it('real Player down a station: only props it touched are loose, at most MAX_DYNAMIC_PROPS simulate, AI far away wakes nothing', () => {
    const rig = contactRig(fresh(generateStation(7)));
    const {ph, layout} = rig;
    forbidShots(rig);
    // a zombie walking into a light prop far from the player (> CONTACT_RANGE): never wakes it
    const farProp = layout.props.find(p => ph.dynamicItems.isDynamicProp(p) && !isLootHolderKind(p.kind) && Math.hypot(p.x - layout.playerSpawn.x, p.z - layout.playerSpawn.z) > 40)!;
    expect(farProp).toBeTruthy();
    const ghost: Walker = {id: {}, x: farProp.x - farProp.hx - 1.0, z: farProp.z, y: farProp.y, r: 0.3};
    rig.others = [ghost];
    let walkedInto = 0, maxAwake = 0;
    const touched: PropPlacement[] = [];
    for (const kind of Object.keys(SUBWAY_CONTACT)) {
      const t = target(rig, [kind]);
      if (!t || Math.hypot(t.p.x - farProp.x, t.p.z - farProp.z) < 15) continue;
      stand(rig, t.at);
      ghost.x = farProp.x - farProp.hx - 1.0;
      walkForward(rig, 0.8, () => { ghost.x += 1.2 * DT; maxAwake = Math.max(maxAwake, ph.dynamicItems.stats().propsAwake); });
      if (t.p.h === 0) { walkedInto++; touched.push(t.p); }
    }
    settle(rig, 20);
    const st = ph.dynamicItems.stats();
    console.info(`[station walk] ${walkedInto} kinds walked into, ${st.props} loose, ${st.counts.contacts} contacts, max awake ${maxAwake}, world bodies ${ph.world!.bodies.length}`);
    expect(walkedInto).toBeGreaterThanOrEqual(8);
    expect(farProp.h).toBeGreaterThan(0); // the far zombie woke nothing
    expect(maxAwake).toBeLessThanOrEqual(MAX_DYNAMIC_PROPS);
    expect(st.props).toBeLessThan(walkedInto * 3); // only what was walked into (and what it was shoved into)
    for (const p of ph.dynamicItems.looseProps()) expect(Math.min(...touched.map(q => Math.hypot(q.x - p.x, q.z - p.z)))).toBeLessThan(4);
    expect(st.propsAwake).toBe(0);
    expect(st.restingInWorld).toBe(0);
    expect(st.counts.shots).toBe(0);
  });
});

void OFFICE_PHYS;
