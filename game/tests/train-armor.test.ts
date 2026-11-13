// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): the train armour in the game (world/trainArmor.ts runtime +
// world/trainArmorLayout.ts geometry) over a generated Subway station with the REAL train runtime, ride, Player and ZombieBrain
// (helpers/fuelCartsHost.ts stationHost: Game's install order and frame order — the lane frame hooks after the bodies moved):
//  - THE SEAM (Game.trainUpgrades): installed / block / install — refused without a parked car and while the train moves, once only;
//    a fitted kit shows, collides (parked: game.propIndex + layout.props; riding: the ride's local model) the moment install() succeeds;
//    a record load without it (Retry before the craft) takes all of that off again; a travel rebuild keeps it;
//  - THE CONTACT RULE (zombies only, parked only): a regular zombie (shambler) held against the blades dies after 5 s (+- 0.5) and is
//    alive after 4 s, through Game.blastKill; a coated one lasts longer; one 1 m away, one in an open doorway / in front of a door, the
//    player, a market person, a corpse, a ragdoll and a climbing one take nothing; nothing at all while the ride holds the car;
//  - THE LAYOUT: every door opening and its leaves' whole travel, every window and lamp stays clear; inside the platform gap, the ride
//    box (clear of the open portal gate leaves), under the transit signals, over the third rail / coverboard; the couplers inside the
//    ploughs; the parked colliders stop the real Player and an enemy's motor at the blades.
// (Corpus clearances on every level's placement: tests/train-armor-clearance.test.ts.)
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {EDGE_TO_TRACK, RAIL_TOP_ABOVE_BED, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {ZombieBrain, ZOMBIE_STATS} from '../src/ai/brain';
import {moveCircle} from '../src/core/physics';
import {raycastWorld} from '../src/combat/hitscan';
import {TRAIN_ARMOR_MODELS} from '../src/assets/trainArmor.generated';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {leafSpan, outerHalf} from '../src/world/playerTrainView';
import {RIDE_BOX} from '../src/world/ridePortal';
import {TRANSIT} from '../src/world/trainTransitTunnel';
import {ARMOR_CONTACT, TRAIN_ARMOR, armorContact, armorLayout, sideFreeSpans, trainArmorLayout, type ArmorPiece} from '../src/world/trainArmorLayout';
import {ARMOR_PREVIEW_ID, ARMOR_TEXT, TrainArmorSystem, type ArmorEnemy} from '../src/world/trainArmor';
import {DT, Keys, build, frame, run, stationHost, teardown, type CartTestHost} from './helpers/fuelCartsHost';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import type {TrainRide} from '../src/world/trainRide';

installCanvasShim(false);

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const L = trainArmorLayout();
const sides = (dir: -1 | 1) => L.pieces.filter(p => p.kind === 'side' && p.dir === dir);
const ends = L.pieces.filter(p => p.kind === 'end');

let models: {side: GLTF; end: GLTF};
beforeAll(async () => {
  models = {side: await loadStripped(TRAIN_ARMOR_MODELS.side.url), end: await loadStripped(TRAIN_ARMOR_MODELS.end.url)};
});

type H = CartTestHost & {trainRuntime: PlayerTrainRuntime; trainRide: TrainRide; layout: StationLayout; zombies: ArmorEnemy[]};
interface World { h: H; rt: PlayerTrainRuntime; ride: TrainRide; armor: TrainArmorSystem; p: TrainPlacement; kills: {z: unknown; dir: THREE.Vector3; point: THREE.Vector3}[]; impacts: number; icons: string[][] }

const live: World[] = [];
afterEach(() => {
  for (const w of live.splice(0)) {
    w.armor.dispose();
    if (w.rt.train) { w.rt.ride = null; teardown(w.h); }
  }
});

/** The station with the train, the ride and the armour (Game order: the armour after the train and the ride), built; models optional. */
function world(o: {models?: boolean; build?: boolean} = {}): World {
  const {h, rt, ride} = stationHost(SUBWAY(), {build: false}) as unknown as {h: H; rt: PlayerTrainRuntime; ride: TrainRide};
  const kills: World['kills'] = [], icons: string[][] = [];
  const w = {h, rt, ride, p: null as unknown as TrainPlacement, kills, impacts: 0, icons} as World;
  Object.assign(h, {
    blastKill: (z: unknown, dir: THREE.Vector3, point: THREE.Vector3) => { kills.push({z, dir: dir.clone(), point: point.clone()}); },
    fx: {impact: () => { w.impacts++; }},
  });
  const scene = (k: 'side' | 'end') => (o.models ? models[k].scene : null);
  w.armor = new TrainArmorSystem(h as never, {model: scene, refreshIcons: ids => { icons.push([...ids]); }, rendererReady: () => true}).install();
  live.push(w);
  if (o.build !== false) build(h, SUBWAY());
  w.p = h.trainPlacement!;
  return w;
}

/** A world point from train-local (x, z) on the ground there (the bed, or the platform beyond the edge). */
function ground(w: World, lx: number, lz: number): {x: number; y: number; z: number} {
  const a = trainToWorld(w.p, lx, 0, lz);
  const onPlatform = lz < -EDGE_TO_TRACK; // (the platform is the car's local -Z side)
  const y = onPlatform ? w.h.levels!.supportAt(a.x, a.z, w.p.floorY + 0.3)!.floor : w.p.railTopY - RAIL_TOP_ABOVE_BED;
  return {x: a.x, y, z: a.z};
}

/** A real zombie standing at train-local (x, z) on the ground, idle (its AI is not run: it stays exactly there). */
function zombie(w: World, lx: number, lz: number, type: 'shambler' | 'coated' = 'shambler'): ArmorEnemy & {brain: ZombieBrain} {
  const g = ground(w, lx, lz), b = new ZombieBrain(type, g.x, g.z, 0);
  b.y = g.y;
  const z = {brain: b, ragdolled: false};
  w.h.zombies.push(z);
  return z;
}

/** The body held right against a piece's blades: its circle `gap` m off the outer face, mid-piece (local x, z). */
function against(piece: ArmorPiece, r: number, gap = 0.05): [number, number] {
  if (piece.kind === 'side') return [(piece.box.x0 + piece.box.x1) / 2, piece.dir * (piece.outer + r + gap)];
  return [piece.dir * (piece.outer + r + gap), (piece.box.z0 + piece.box.z1) / 2];
}
const longest = (dir: -1 | 1) => sides(dir).reduce((a, b) => (b.box.x1 - b.box.x0 > a.box.x1 - a.box.x0 ? b : a));
const R = ZOMBIE_STATS.shambler.radius;

/**
 * A local x along one side's skirt with an open walk lane in front of it (no station prop — a two-track bed's centre columns stand 1.75
 * from the track — between 1.6 and 2.6 m out, the bed open there): [the piece, x].
 */
function openLane(w: World, dir: -1 | 1): [ArmorPiece, number] {
  const own = new Set(w.rt.train!.layoutBoxes);
  for (const p of sides(dir)) {
    for (let x = p.box.x0 + 0.45; x <= p.box.x1 - 0.45; x += 0.25) {
      const a = trainToWorld(w.p, x - 0.45, 0, dir * 1.6), b = trainToWorld(w.p, x + 0.45, 0, dir * 2.6);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
      if (w.h.layout.props.some(q => !own.has(q) && q.x + q.hx > x0 && q.x - q.hx < x1 && q.z + q.hz > z0 && q.z - q.hz < z1)) continue;
      const far = trainToWorld(w.p, x, 0, dir * 2.5);
      if (!w.h.levels!.isFree(far.x, w.p.railTopY, far.z)) continue;
      return [p, x];
    }
  }
  throw new Error(`no open lane beside the ${dir} side`);
}

/** Seconds of frames until `z` dies (cap: `max`), or null. */
function timeToDie(w: World, z: {brain: ZombieBrain}, max: number): number | null {
  let t = 0;
  for (; t < max - 1e-9; t += DT) { frame(w.h); if (!z.brain.alive) return t + DT; }
  return null;
}

// ---------------------------------------------------------------------------------------------
describe('train armour: the upgrades seam', () => {
  it('block / install / installed: no parked car -> refused; parked -> fitted once; an unknown id is refused', () => {
    const w = world({models: true, build: false});
    const {armor, h} = w;
    expect(armor.installed('armor')).toBe(false);
    expect(armor.block('armor')).toBe(ARMOR_TEXT.noTrain);
    expect(armor.install('armor')).toBe(false); // (the craft refunds)
    expect(armor.installed('armor')).toBe(false);
    build(h, SUBWAY());
    w.p = h.trainPlacement!;
    expect(armor.block('armor')).toBeNull();
    expect(armor.block('plough' as never)).toBe(ARMOR_TEXT.unknown);
    expect(armor.install('plough' as never)).toBe(false);
    expect(armor.install('armor')).toBe(true);
    expect(armor.installed('armor')).toBe(true);
    expect(h.playerTrain.upgrades.has('armor')).toBe(true);
    expect(armor.block('armor')).toBe(ARMOR_TEXT.fitted);
    expect(armor.install('armor')).toBe(false); // (once)
    expect(armor.counts).toMatchObject({installs: 1, refused: 3});
  });

  it('install() succeeding shows the kit and makes it solid AT ONCE (no frame): parked colliders, the riding model, the warm pool', () => {
    const w = world({models: true});
    const {armor, rt, ride, h} = w;
    expect(armor.shown).toBe(false);
    expect(rt.armorFitted()).toBe(false);
    expect(ride.model.cargo?.boxes.get('train-armor')).toBeUndefined();
    // the hidden kit is on the car and in its warm pool already (the warm-up compiles it before it is ever shown)
    expect(armor.group.parent).toBe(rt.view!.root);
    expect(h.pools['train-armor']()).toEqual([armor.group]);
    expect(armor.sideMesh!.count + armor.endMesh!.count).toBe(L.pieces.length);
    expect([armor.sideMesh!.visible, armor.endMesh!.visible]).toEqual([false, false]);
    const props0 = h.layout.props.length;
    expect(armor.install('armor')).toBe(true);
    expect(armor.shown).toBe(true);
    expect([armor.sideMesh!.visible, armor.endMesh!.visible]).toEqual([true, true]);
    expect(rt.armorFitted()).toBe(true);
    const col = rt.train!.col.armor;
    expect(col.collide).toHaveLength(L.pieces.length);
    for (const b of col.collide) expect(h.propIndex!.props).toContain(b);
    expect(h.layout.props.length).toBe(props0 + L.pieces.length);
    for (const b of col.shoot) expect(h.layout.props).toContain(b);
    expect(ride.model.cargo!.boxes.get('train-armor')).toHaveLength(L.pieces.length);
    // the kit's meshes carry the car's level; rays go to the boxes (the meshes never take a ray)
    armor.group.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.userData.level).toBe(w.p.level); });
    const hits: THREE.Intersection[] = [];
    armor.sideMesh!.raycast(new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1)), hits);
    expect(hits).toEqual([]);
  });

  it('every piece instance is the layout: the instance boxes are the collider boxes (the real models through the piece transforms)', () => {
    const w = world({models: true});
    w.armor.install('armor');
    const m = new THREE.Matrix4(), box = new THREE.Box3();
    for (const [mesh, kind] of [[w.armor.sideMesh!, 'side'], [w.armor.endMesh!, 'end']] as const) {
      mesh.geometry.computeBoundingBox();
      const pieces = L.pieces.filter(p => p.kind === kind);
      pieces.forEach((p, i) => {
        mesh.getMatrixAt(i, m);
        box.copy(mesh.geometry.boundingBox!).applyMatrix4(m);
        for (const [got, want] of [[box.min.x, p.box.x0], [box.max.x, p.box.x1], [box.min.y, p.box.y0], [box.max.y, p.box.y1], [box.min.z, p.box.z0], [box.max.z, p.box.z1]]) {
          expect(Math.abs(got - want), `${kind} ${i}`).toBeLessThan(0.01);
        }
        // never mirrored (no flipped winding / pipeline)
        expect(m.determinant(), `${kind} ${i}`).toBeGreaterThan(0);
      });
    }
  });

  it('refused while the train moves; a fitted record still reaches the riding model (the next frame)', () => {
    const w = world({models: true});
    const {armor, ride, h} = w;
    void ride.depart();
    expect(ride.riding).toBe(true);
    expect(armor.block('armor')).toBe(ARMOR_TEXT.moving);
    expect(armor.install('armor')).toBe(false);
    expect(armor.installed('armor')).toBe(false);
    expect(ride.model.cargo?.boxes.get('train-armor')).toBeUndefined();
    h.playerTrain.upgrades.fit('armor'); // (the record rules: e.g. loaded with the rest of the train record)
    frame(h);
    expect(ride.model.cargo!.boxes.get('train-armor')).toHaveLength(L.pieces.length);
    expect(armor.shown).toBe(true);
    expect(armor.block('armor')).toBe(ARMOR_TEXT.fitted); // (fitted wins)
  });

  it('a record load without it (Retry before the craft) takes the kit, the colliders and the riding boxes off; with it, back on', () => {
    const w = world({models: true});
    const {armor, rt, ride, h} = w;
    expect(armor.install('armor')).toBe(true);
    const shoot = [...rt.train!.col.armor.shoot];
    const part = h.playerTrain.participant(), saved = part.save() as Record<string, unknown>;
    const {upgrades: _u, ...entry} = saved;
    part.load(structuredClone(entry));
    frame(h);
    expect(armor.installed('armor')).toBe(false);
    expect(armor.shown).toBe(false);
    expect(rt.armorFitted()).toBe(false);
    for (const b of shoot) expect([b.hx, b.hz, b.h]).toEqual([0, 0, 0]); // (emptied in place: no later prop index moves)
    for (const b of rt.train!.col.armor.collide) expect(h.propIndex!.props).not.toContain(b);
    expect(ride.model.cargo?.boxes.get('train-armor')).toBeUndefined();
    // and the save with it fits it again on the next frame
    part.load(structuredClone(saved));
    frame(h);
    expect(armor.installed('armor')).toBe(true);
    expect(armor.shown && rt.armorFitted()).toBe(true);
  });

  it('a travel rebuild keeps it: the next build has the colliders from its first frame, the kit on the adopted view', () => {
    const w = world({models: true});
    w.armor.install('armor');
    teardown(w.h);
    expect(w.armor.group.parent).toBeNull();
    build(w.h, SUBWAY());
    expect(w.rt.armorFitted()).toBe(true);
    expect(w.armor.group.parent).toBe(w.rt.view!.root);
    expect(w.armor.shown).toBe(true);
  });

  it('no model loaded: nothing is drawn (never a stand-in) while the colliders and the damage follow the record', () => {
    const w = world({models: false});
    expect(w.armor.install('armor')).toBe(true);
    expect(w.armor.sideMesh).toBeNull();
    expect(w.armor.endMesh).toBeNull();
    expect(w.armor.shown).toBe(false);
    expect(w.armor.previewObject()).toBeNull();
    expect(w.rt.armorFitted()).toBe(true);
    run(w.h, 1);
    expect(w.icons).toEqual([]); // (no preview render without the real models)
  });

  it("the recipe row's preview 'upgrade:armor': the real plough + skirt once the models are there, rendered once", () => {
    const w = world({models: true});
    const obj = w.armor.previewObject()!;
    expect(obj).not.toBeNull();
    let meshes = 0;
    obj.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBe(2);
    run(w.h, 0.5);
    expect(w.icons).toEqual([[ARMOR_PREVIEW_ID]]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour: contact damage (zombies only, parked only)', () => {
  it('a regular zombie held against the blades dies after 5 s (+- 0.5 s), alive at 4 s; through Game.blastKill; a coated one lasts longer', () => {
    for (const [dir, label] of [[1, 'far side (bed)'], [-1, 'platform side']] as const) {
      const w = world();
      w.armor.install('armor');
      const [x, z] = against(longest(dir), R);
      const zb = zombie(w, x, z);
      run(w.h, 4);
      expect(zb.brain.alive, `${label}: alive at 4 s`).toBe(true);
      expect(zb.brain.hp).toBeCloseTo(100 - 4 * ARMOR_CONTACT.dps, 3);
      const t = timeToDie(w, zb, 2);
      expect(t, `${label}: dies`).not.toBeNull();
      expect(4 + t!, label).toBeGreaterThanOrEqual(4.5);
      expect(4 + t!, label).toBeLessThanOrEqual(5.5);
      expect(w.kills).toHaveLength(1);
      expect(w.kills[0].z).toBe(zb);
      expect(w.kills[0].dir.y).toBeGreaterThan(0); // (thrown off the blades, up and away)
      const out = trainToWorld(w.p, 0, 0, dir), o = trainToWorld(w.p, 0, 0, 0);
      expect(w.kills[0].dir.x * (out.x - o.x) + w.kills[0].dir.z * (out.z - o.z), label).toBeGreaterThan(0);
      expect(w.impacts, `${label}: a blood puff now and then`).toBeGreaterThanOrEqual(5);
      expect(w.impacts).toBeLessThanOrEqual(Math.ceil(5 / ARMOR_CONTACT.feedbackS) + 1);
      expect(w.armor.counts.kills).toBe(1);
      live.splice(live.indexOf(w), 1); w.armor.dispose(); teardown(w.h);
    }
    // a plough: the same rule; a coated zombie (165 hp) after 8.25 s
    const w = world();
    w.armor.install('armor');
    const plough = ends.find(e => e.dir > 0)!;
    const [x, z] = against(plough, ZOMBIE_STATS.coated.radius);
    const zc = zombie(w, x, z, 'coated');
    run(w.h, 7.5);
    expect(zc.brain.alive).toBe(true);
    const t = timeToDie(w, zc, 2);
    expect(7.5 + t!).toBeCloseTo(ZOMBIE_STATS.coated.hp / ARMOR_CONTACT.dps, 1);
  });

  it('nothing for a zombie 1 m away, in an open doorway or in front of a door, nor before the armour is fitted', () => {
    const w = world();
    const piece = longest(1);
    const [x, z] = against(piece, R, 0.05);
    const notYet = zombie(w, x, z);
    run(w.h, 1);
    expect(notYet.brain.hp).toBe(100); // (not fitted: no damage)
    w.h.zombies.length = 0;
    w.armor.install('armor');
    const away = zombie(w, x, piece.dir * (piece.outer + R + 1.0));
    const door = SPEC.doors.findIndex(d => d.side < 0);
    expect(w.rt.setDoor(door, true)).toBe('opening');
    run(w.h, 2);
    const d = SPEC.doors[door];
    const inDoor = zombie(w, d.x, -(outerHalf(SPEC) + 0.12)); // (on the bridge in the open doorway)
    const front = zombie(w, d.x + d.width / 2, -(EDGE_TO_TRACK + R + 0.02)); // (on the platform at the jamb)
    const farDoor = SPEC.doors.find(q => q.side > 0)!;
    const bedDoor = zombie(w, farDoor.x, outerHalf(SPEC) + R + 0.05); // (in the bed at a far-side door)
    run(w.h, 6);
    for (const [z0, label] of [[away, '1 m away'], [inDoor, 'in the doorway'], [front, 'in front of a door'], [bedDoor, 'at a far door']] as const) {
      expect(z0.brain.hp, label).toBe(100);
    }
    expect(w.armor.counts.contactFrames).toBe(0);
  });

  it('the player, a market person, a corpse, a ragdoll and a climbing zombie take nothing; nothing while the ride holds the car', async () => {
    const w = world();
    w.armor.install('armor');
    const piece = longest(1), [x, z] = against(piece, 0.3, 0.02);
    // the player in the bed against the blades
    const g = ground(w, x, z);
    w.h.player.spawn(g.x, g.z, 0, g.y);
    const hp0 = w.h.player.hp;
    // a market person there too (its own list: the armour never reads it), and the bodies that are not enemies any more
    const person = {actor: {x: g.x, y: g.y, z: g.z, hp: 60}, damage: vi.fn()};
    Object.assign(w.h, {marketPeople: {traders: [], residents: [person]}});
    const corpse = zombie(w, x, z); corpse.brain.damage(1e9, 0, 0);
    const rag = zombie(w, x, z); (rag as {ragdolled: boolean}).ragdolled = true;
    const climber = zombie(w, x, z); Object.defineProperty(climber.brain, 'climbing', {get: () => true});
    const spies = [corpse, rag, climber].map(q => vi.spyOn(q.brain, 'damage'));
    run(w.h, 6);
    expect(w.h.player.hp).toBe(hp0);
    expect(person.damage).not.toHaveBeenCalled();
    expect(person.actor.hp).toBe(60);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(w.armor.counts.contactFrames).toBe(0);
    expect(w.kills).toEqual([]);
    // riding: a zombie against the blades while the doors close (the car has not moved yet) takes nothing
    w.h.zombies.length = 0;
    const w2 = world();
    w2.armor.install('armor');
    const [x2, z2] = against(longest(1), R);
    void w2.ride.depart();
    expect(w2.ride.riding).toBe(true);
    const zr = zombie(w2, x2, z2);
    run(w2.h, 1.5);
    expect(zr.brain.hp).toBe(100);
    expect(w2.armor.parked()).toBe(false);
    expect(w2.armor.counts.contactFrames).toBe(0);
  });

  it('cost: O(zombies) — 300 zombies round the car, a box reject first; only the ones at the blades are hit', () => {
    const w = world();
    w.armor.install('armor');
    const near = sides(1).map(p => zombie(w, ...against(p, R)));
    for (let i = 0; i < 300; i++) zombie(w, -30 + (i % 30) * 2, 6 + Math.floor(i / 30)); // (far away: the cheap reject)
    const t0 = performance.now();
    run(w.h, 1);
    const ms = performance.now() - t0;
    for (const z of near) expect(z.brain.hp).toBeCloseTo(100 - ARMOR_CONTACT.dps, 3);
    expect(w.h.zombies.filter(z => (z.brain as ZombieBrain).hp < 100)).toHaveLength(near.length);
    expect(ms).toBeLessThan(2000); // (60 frames of the whole host; generous: CI runners)
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour: colliders stop bodies at the blades (parked)', () => {
  it('the real Player walking from the bed into the far side stops at the blade line (and at the skin without the armour)', () => {
    let piece: ArmorPiece | null = null;
    const stopAt = (fitted: boolean): number => {
      const w = world();
      if (fitted) w.armor.install('armor');
      const [pc, x] = openLane(w, 1), g = ground(w, x, pc.outer + 0.3 + 0.15);
      piece = pc;
      const P = w.h.player;
      P.spawn(g.x, g.z, 0, g.y);
      const toward = trainToWorld(w.p, x, 0, 0);
      P.yaw = Math.atan2(-(toward.x - g.x), -(toward.z - g.z));
      const keys = w.h.keys as Keys;
      keys.held.add('KeyW');
      run(w.h, 1.5);
      keys.held.delete('KeyW');
      const z = worldToTrain(w.p, P.x, P.y, P.z).z;
      live.splice(live.indexOf(w), 1); w.armor.dispose(); teardown(w.h);
      return z;
    };
    const bare = stopAt(false), armoured = stopAt(true), outer = piece!.outer;
    expect(armoured).toBeGreaterThanOrEqual(outer + 0.3 - 0.03);
    expect(armoured).toBeLessThan(outer + 0.3 + 0.1);
    expect(armoured - bare).toBeGreaterThan(0.15);
  });

  it("an enemy's motor (moveCircle on game.propIndex) stops at a plough and at a skirt; a shot from outside hits the armour box", () => {
    const w = world();
    w.armor.install('armor');
    // (the far side of a single bed leaves 0.8 m to its wall: start 0.12 m off the blades there; 0.6 m beyond a plough)
    const [lanePiece, laneX] = openLane(w, 1);
    for (const [piece, gap, shot] of [[ends.find(e => e.dir > 0)!, 0.6, 1.5], [lanePiece, 0.12, 0.4]] as const) {
      const [x0, z] = against(piece, R, gap), x = piece === lanePiece ? laneX : x0;
      const g = ground(w, x, z), at = trainToWorld(w.p, piece.kind === 'end' ? 0 : x, 0, piece.kind === 'end' ? z : 0);
      const dx = at.x - g.x, dz = at.z - g.z, d = Math.hypot(dx, dz);
      let px = g.x, pz = g.z;
      for (let i = 0; i < 120; i++) [px, pz] = moveCircle(w.h.levels!, w.h.propIndex, px, pz, (dx / d) * 0.03, (dz / d) * 0.03, R, g.y);
      const q = worldToTrain(w.p, px, g.y, pz);
      const reach = piece.kind === 'end' ? piece.dir * q.x : piece.dir * q.z;
      expect(reach, piece.kind).toBeGreaterThanOrEqual(piece.outer + R - 0.03);
      expect(reach, piece.kind).toBeLessThan(piece.outer + R + 0.05);
      // a level shot at the blades from `shot` m out stops on the armour's box
      const ly = (piece.box.y0 + piece.box.y1) / 2;
      const eye = trainToWorld(w.p, piece.kind === 'end' ? piece.dir * (piece.outer + shot) : x, ly, piece.kind === 'end' ? 0 : piece.dir * (piece.outer + shot));
      const n = Math.hypot(at.x - eye.x, at.z - eye.z);
      const hit = raycastWorld(w.h.levels!, w.h.layout.props, eye, {x: (at.x - eye.x) / n, y: 0, z: (at.z - eye.z) / n}, 10, w.h.layout.trench.floorY);
      expect(hit.kind, piece.kind).toBe('prop');
      expect(w.rt.train!.col.armor.shoot, piece.kind).toContain(w.h.layout.props[hit.prop!]);
      expect(Math.abs(hit.t - shot), piece.kind).toBeLessThan(0.05);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour: the layout keeps the car usable', () => {
  it('8 side segments (4 a side) + 2 ploughs; deterministic; the scales are the documented ones', () => {
    expect(sides(-1)).toHaveLength(4);
    expect(sides(1)).toHaveLength(4);
    expect(ends).toHaveLength(2);
    expect(armorLayout()).toEqual(L);
    for (const p of L.pieces) {
      if (p.kind === 'end') expect(p.scale).toEqual([TRAIN_ARMOR.end.scale, TRAIN_ARMOR.end.scale, TRAIN_ARMOR.end.scale]);
      else {
        expect(p.scale.slice(1)).toEqual([TRAIN_ARMOR.side.scale, TRAIN_ARMOR.side.scale]);
        expect(p.scale[0] / TRAIN_ARMOR.side.scale).toBeGreaterThanOrEqual(0.79); // (no visibly squashed / stretched saw disc)
        expect(p.scale[0] / TRAIN_ARMOR.side.scale).toBeLessThanOrEqual(1.1);
      }
    }
  });

  it('every door opening and both leaves fully open (the pockets) stay bare; the belt is otherwise continuous between them', () => {
    for (const d of SPEC.doors) {
      const a = leafSpan(d, 0, 1, SPEC.doorLeaf.width)[0], b = leafSpan(d, 1, 1, SPEC.doorLeaf.width)[1];
      for (const p of sides(d.side)) expect(p.box.x1 <= a - TRAIN_ARMOR.side.clear + 1e-6 || p.box.x0 >= b + TRAIN_ARMOR.side.clear - 1e-6, `door ${d.x}`).toBe(true);
    }
    for (const dir of [-1, 1] as const) {
      const covered = sides(dir).reduce((n, p) => n + p.box.x1 - p.box.x0, 0);
      const free = sideFreeSpans(SPEC, dir).reduce((n, [a, b]) => n + b - a, 0);
      expect(covered).toBeCloseTo(free, 6);
    }
  });

  it('windows and lamps stay clear: the belt under every side window, the ploughs under the end windows and every lamp', () => {
    for (const p of sides(-1).concat(sides(1))) {
      for (const win of SPEC.windows.side) {
        if (win.side !== p.dir || win.x1 <= p.box.x0 || win.x0 >= p.box.x1) continue;
        expect(p.box.y1, `window ${win.x0}`).toBeLessThan(win.y0 - 0.2);
      }
    }
    for (const e of ends) {
      for (const win of SPEC.windows.end.filter(q => q.end === e.dir)) expect(e.box.y1).toBeLessThan(win.y0 - 0.5);
      const lamps = [...(e.dir > 0 ? SPEC.lights.head : SPEC.lights.tail), ...(e.dir > 0 ? SPEC.lights.marker.front : SPEC.lights.marker.rear)];
      expect(lamps.length).toBeGreaterThan(0);
      for (const l of lamps) expect(e.box.y1, `lamp y ${l.y}`).toBeLessThan(l.y - SPEC.lights.lampRadius - 0.1);
      // the couplers (the shell's outer x extent) are inside the plough, its back plate just ahead of the end face
      expect(e.back).toBeLessThan(SPEC.length / 2);
      expect(e.outer).toBeGreaterThan(SPEC.length / 2);
    }
    for (const p of L.pieces.filter(q => q.kind === 'side')) {
      for (const l of [...SPEC.lights.head, ...SPEC.lights.tail]) expect(Math.abs(l.x) - Math.max(Math.abs(p.box.x0), Math.abs(p.box.x1))).toBeGreaterThan(0.3);
    }
  });

  it('inside the platform gap, the ride box clear of the open gate leaves, under the transit signals, over the third rail / coverboard', () => {
    const halfCar = SPEC.width / 2;
    for (const b of L.boxes) {
      const zMax = Math.max(Math.abs(b.z0), Math.abs(b.z1));
      expect(zMax).toBeLessThan(EDGE_TO_TRACK - 0.25); // (the platform edge; a zombie at the edge stands within reach)
      expect(zMax).toBeLessThan(RIDE_BOX.half);
      expect(zMax).toBeLessThan(halfCar + 0.25); // (the open gate leaves stay beyond it: tests/ride-portal-gates.test.ts)
      expect(b.y1).toBeLessThan(TRANSIT.signal.lensY - TRANSIT.signal.lensUp - TRANSIT.signal.housing[1] / 2);
      expect(b.y0).toBeGreaterThan(-RAIL_TOP_ABOVE_BED + TRANSIT.third.y + TRANSIT.third.h / 2); // (the transit's third rail)
      expect(b.y0).toBeGreaterThan(0.19); // (the station beds' third-rail coverboard top: 0.1825 above the rail top, measured)
    }
    // the platform side: a regular zombie at the edge is within reach of the blades (and the rule's reach is not more than that needs)
    for (const p of sides(-1)) expect(EDGE_TO_TRACK - p.outer).toBeLessThan(ARMOR_CONTACT.reach + R);
  });

  it('the contact rule: reach, along the piece, height, never through the hull, never at a door', () => {
    const p = longest(1), mx = (p.box.x0 + p.box.x1) / 2, bed = -RAIL_TOP_ABOVE_BED;
    expect(armorContact(L, mx, bed, p.outer + R + ARMOR_CONTACT.reach - 0.01, R)).not.toBeNull();
    expect(armorContact(L, mx, bed, p.outer + R + ARMOR_CONTACT.reach + 0.01, R)).toBeNull();
    expect(armorContact(L, mx, bed, 0.5, R)).toBeNull(); // (inside the car)
    expect(armorContact(L, mx, p.box.y1 + ARMOR_CONTACT.tolY + 0.01, p.outer + R, R)).toBeNull(); // (above: on the roof)
    expect(armorContact(L, p.box.x1 + ARMOR_CONTACT.tolX + 0.3, bed, p.outer + R, R)).toBeNull();
    for (const d of SPEC.doors) expect(armorContact(L, d.x, bed, d.side * (TRAIN_ARMOR.side.skinPos + 0.3 + R), R), `door ${d.x}`).toBeNull();
    const hit = armorContact(L, mx, bed, p.outer + R + 0.02, R)!;
    expect(hit.piece).toBe(p);
    expect([hit.nx, hit.nz]).toEqual([0, 1]);
    expect(hit.gap).toBeCloseTo(0.02, 6);
  });
});
