// Task studio-refinement-batch-20261113-035659-01 (lane ARMOR): the train armour in the game (world/trainArmor.ts runtime +
// world/trainArmorLayout.ts geometry) over a generated Subway station with the REAL train runtime, ride, Player and ZombieBrain
// (helpers/fuelCartsHost.ts stationHost: Game's install order and frame order — the lane frame hooks after the bodies moved):
//  - THE SEAM (Game.trainUpgrades): installed / block / install — refused without a parked car and while the train moves, once only;
//    a fitted kit shows, collides (parked: game.propIndex + layout.props; riding: the ride's local model) the moment install() succeeds;
//    a record load without it (Retry before the craft) takes all of that off again; a travel rebuild keeps it;
//  - THE CONTACT RULE (zombies only, parked only): a regular zombie (shambler) held against the blades dies after 5 s (+- 0.5) and is
//    alive after 4 s, through Game.blastKill; a coated one lasts longer; one 1 m away, one in an open doorway / in front of a door, the
//    player, a market person, a corpse, a ragdoll and a climbing one take nothing; nothing at all while the ride holds the car;
//  - THE LAYOUT: every door opening, every window and lamp stays clear; inside the platform gap, the ride box (clear of the open portal
//    gate leaves), clear of the transit signals and cable tray, over the third rail / coverboard; the couplers inside the ploughs; the
//    parked colliders stop the real Player and an enemy's motor at the blades.
// Task studio-train-armor-makeover-20261113-183146-01 (the kit's makeover: the same seam, record and contact rule over the heavier
// kit — its pieces, solids and boxes): re-pinned to the new geometry; the rule's numbers (5 s, 20 hp/s, reach, door clearance) are the
// old ones. The makeover's own checks (the kit's composition, its models, doors / carts / fuel cap / sentry with the kit fitted):
// tests/train-armor-makeover.test.ts. Corpus clearances on every level's placement: tests/train-armor-clearance.test.ts.
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {EDGE_TO_TRACK, RAIL_TOP_ABOVE_BED, TRAIN_CLEAR, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {ZombieBrain, ZOMBIE_STATS} from '../src/ai/brain';
import {moveCircle} from '../src/core/physics';
import {raycastWorld} from '../src/combat/hitscan';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {outerHalf} from '../src/world/playerTrainView';
import {RIDE_BOX} from '../src/world/ridePortal';
import {TRANSIT} from '../src/world/trainTransitTunnel';
import {ARMOR_CONTACT, ARMOR_MODELS, ARMOR_MODEL_IDS, TRAIN_ARMOR, armorContact, armorLayout, trainArmorLayout, type ArmorModelId, type ArmorSolid} from '../src/world/trainArmorLayout';
import {ARMOR_PREVIEW_ID, ARMOR_TEXT, TrainArmorSystem, armorMeshKey, type ArmorEnemy} from '../src/world/trainArmor';
import {DT, Keys, build, frame, run, stationHost, teardown, type CartTestHost} from './helpers/fuelCartsHost';
import type {PlayerTrainRuntime} from '../src/world/playerTrain';
import type {TrainRide} from '../src/world/trainRide';

installCanvasShim(false);

let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
const L = trainArmorLayout();
/** A side's solids along the body (skirt strips, bogie guards, plates). */
const sides = (dir: -1 | 1) => L.solids.filter(s => s.kind === 'side' && s.dir === dir && s.part !== 'tower');
const plates = (dir: -1 | 1) => sides(dir).filter(s => s.part === 'plate');
const prow = (end: -1 | 1) => L.solids.find(s => s.part === 'prow' && s.dir === end)!;
/** What collides: every box but the overhead ones (window pillars, roof-line rails: shots only); riding, what stands above the floor. */
const COLUMNS = L.boxes.filter(b => !b.overhead);
const RIDE_COLUMNS = COLUMNS.filter(b => b.y1 > SPEC.floorY + 0.02);
/** The kit's draws: one per model, one more for a model's mirrored pieces. */
const MESH_KEYS = [...new Set(L.pieces.map(p => armorMeshKey(p.model, p.mirror)))].sort();

let models: Record<ArmorModelId, GLTF>;
beforeAll(async () => {
  models = Object.fromEntries(await Promise.all(ARMOR_MODEL_IDS.map(async id => [id, await loadStripped(ARMOR_MODELS[id].url)]))) as Record<ArmorModelId, GLTF>;
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
function world(o: {models?: boolean | readonly ArmorModelId[]; build?: boolean} = {}): World {
  const {h, rt, ride} = stationHost(SUBWAY(), {build: false}) as unknown as {h: H; rt: PlayerTrainRuntime; ride: TrainRide};
  const kills: World['kills'] = [], icons: string[][] = [];
  const w = {h, rt, ride, p: null as unknown as TrainPlacement, kills, impacts: 0, icons} as World;
  Object.assign(h, {
    blastKill: (z: unknown, dir: THREE.Vector3, point: THREE.Vector3) => { kills.push({z, dir: dir.clone(), point: point.clone()}); },
    fx: {impact: () => { w.impacts++; }},
  });
  const scene = (id: ArmorModelId) => (o.models === true || (Array.isArray(o.models) && o.models.includes(id)) ? models[id].scene : null);
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

/** The body held right against a solid's blades: its circle `gap` m off the outer face, mid-solid (local x, z). */
function against(s: ArmorSolid, r: number, gap = 0.05): [number, number] {
  if (s.kind === 'side') return [(s.box.x0 + s.box.x1) / 2, s.dir * (s.outer + r + gap)];
  return [s.dir * (s.outer + r + gap), (s.box.z0 + s.box.z1) / 2];
}
const doorDist = (s: ArmorSolid) => Math.min(...SPEC.doors.filter(d => d.side === s.dir).map(d => Math.abs((s.box.x0 + s.box.x1) / 2 - d.x)));
const pick = (dir: -1 | 1, sign: 1 | -1) => plates(dir).reduce((a, b) => (sign * (b.outer - a.outer) > 1e-9 || (Math.abs(b.outer - a.outer) <= 1e-9 && doorDist(b) > doorDist(a)) ? b : a));
/** The plate of a side that stands out the furthest (a body walking at the side meets it first); of equals, the one furthest from a door. */
const proudest = (dir: -1 | 1) => pick(dir, 1);
/** The plate of a side that stands out the least. */
const flushest = (dir: -1 | 1) => pick(dir, -1);
const R = ZOMBIE_STATS.shambler.radius;

/**
 * A local x along one side's plates with an open walk lane in front of it (no station prop — a two-track bed's centre columns stand
 * 1.75 from the track — between 1.6 and 2.6 m out, the bed open there), at least 0.45 m inside the plate's ends: [the plate, x].
 */
function openLane(w: World, dir: -1 | 1): [ArmorSolid, number] {
  const own = new Set(w.rt.train!.layoutBoxes);
  for (const p of plates(dir)) {
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
    const meshes = [...armor.meshes.values()];
    expect([...armor.meshes.keys()].sort()).toEqual(MESH_KEYS);
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(L.pieces.length);
    expect(meshes.map(m => m.visible)).toEqual(meshes.map(() => false));
    const props0 = h.layout.props.length;
    expect(armor.install('armor')).toBe(true);
    expect(armor.shown).toBe(true);
    expect(meshes.map(m => m.visible)).toEqual(meshes.map(() => true));
    expect(rt.armorFitted()).toBe(true);
    const col = rt.train!.col.armor;
    // a grounded column per box a body can meet, an exact box per armour box for shots (the overhead ones: shots only)
    expect(col.collide).toHaveLength(COLUMNS.length);
    expect(col.shoot).toHaveLength(L.boxes.length);
    expect(COLUMNS.length).toBeLessThan(L.boxes.length);
    for (const b of col.collide) expect(h.propIndex!.props).toContain(b);
    expect(h.layout.props.length).toBe(props0 + L.boxes.length);
    for (const b of col.shoot) expect(h.layout.props).toContain(b);
    expect(ride.model.cargo!.boxes.get('train-armor')).toHaveLength(RIDE_COLUMNS.length);
    // the kit's meshes carry the car's level; rays go to the boxes (the meshes never take a ray)
    armor.group.traverse(o => { if ((o as THREE.Mesh).isMesh) expect(o.userData.level).toBe(w.p.level); });
    for (const m of meshes) {
      const hits: THREE.Intersection[] = [];
      m.raycast(new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1)), hits);
      expect(hits).toEqual([]);
    }
  });

  it('every piece instance is the layout: the instance boxes are the piece boxes (the real models through the piece transforms)', () => {
    const w = world({models: true});
    w.armor.install('armor');
    const m = new THREE.Matrix4(), box = new THREE.Box3();
    let seen = 0;
    for (const key of MESH_KEYS) {
      const mesh = w.armor.meshes.get(key)!;
      mesh.geometry.computeBoundingBox();
      const pieces = L.pieces.filter(p => armorMeshKey(p.model, p.mirror) === key);
      expect(mesh.count, key).toBe(pieces.length);
      pieces.forEach((p, i) => {
        mesh.getMatrixAt(i, m);
        box.copy(mesh.geometry.boundingBox!).applyMatrix4(m);
        for (const [got, want] of [[box.min.x, p.box.x0], [box.max.x, p.box.x1], [box.min.y, p.box.y0], [box.max.y, p.box.y1], [box.min.z, p.box.z0], [box.max.z, p.box.z1]]) {
          expect(Math.abs(got - want), `${key} ${i}`).toBeLessThan(0.01);
        }
        // never a negative scale (a mirrored piece's mirror is in its geometry: no flipped winding / pipeline)
        expect(m.determinant(), `${key} ${i}`).toBeGreaterThan(0);
        seen++;
      });
    }
    expect(seen).toBe(L.pieces.length);
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
    expect(ride.model.cargo!.boxes.get('train-armor')).toHaveLength(RIDE_COLUMNS.length);
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

  it('the head / tail beams start clear of the ploughs while the armour is fitted (no piece inside a cone), at the lamps without it', () => {
    // (these lights cast no shadow: a plough standing in a cone would only be lit point-blank from behind)
    const w = world({models: true});
    const {armor, rt, ride, h} = w;
    const local = (o: THREE.Object3D) => { const q = worldToTrain(w.p, o.position.x, o.position.y, o.position.z); return [q.x, q.y, q.z]; };
    const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
    const lamp = (list: readonly {x: number; y: number; z: number}[]) => [list.reduce((s, l) => s + l.x, 0) / list.length, list.reduce((s, l) => s + l.y, 0) / list.length, list.reduce((s, l) => s + l.z, 0) / list.length];
    const hl = lamp(SPEC.lights.head), tl = lamp(SPEC.lights.tail);
    const bare = {head: local(rt.lights.head), tail: local(rt.lights.tail), aimH: local(rt.lights.head.target), aimT: local(rt.lights.tail.target)};
    close(bare.head, [hl[0] + 0.05, hl[1], hl[2]]);
    close(bare.tail, [tl[0] - 0.05, tl[1], tl[2]]);
    const front = Math.max(...L.boxes.map(b => b.x1)), rear = Math.min(...L.boxes.map(b => b.x0));
    // (why: fitted, the ploughs stand ahead of the lamps, the prow on the beams' own axis)
    expect(front).toBeGreaterThan(bare.head[0] + 0.5);
    expect(rear).toBeLessThan(bare.tail[0] - 0.5);
    expect(armor.install('armor')).toBe(true);
    const fitted = () => {
      close(local(rt.lights.head), [front + 0.05, hl[1], hl[2]]);
      close(local(rt.lights.tail), [rear - 0.05, tl[1], tl[2]]);
      close(local(rt.lights.head.target), bare.aimH); // (aimed at the same points on the track)
      close(local(rt.lights.tail.target), bare.aimT);
    };
    fitted();
    const [hx] = local(rt.lights.head), [tx] = local(rt.lights.tail);
    for (const p of L.pieces) { expect(p.box.x1, p.part).toBeLessThan(hx); expect(p.box.x0, p.part).toBeGreaterThan(tx); }
    const lights = [rt.lights.head.intensity, rt.lights.tail.intensity];
    // a record load without it: back at the lamps; with it: clear of the ploughs again (the same light set, the same intensities)
    const part = h.playerTrain.participant(), saved = part.save() as Record<string, unknown>;
    const {upgrades: _u, ...entry} = saved;
    part.load(structuredClone(entry));
    frame(h);
    close(local(rt.lights.head), bare.head);
    close(local(rt.lights.tail), bare.tail);
    part.load(structuredClone(saved));
    frame(h);
    fitted();
    expect([rt.lights.head.intensity, rt.lights.tail.intensity]).toEqual(lights);
    // a travel rebuild and the riding car (the ride places the lights through the same rule every frame)
    teardown(h);
    build(h, SUBWAY());
    fitted();
    void ride.depart();
    for (let i = 0; i < 30; i++) frame(h);
    expect(ride.riding).toBe(true);
    const root = rt.view!.root;
    root.updateMatrixWorld(true);
    const inCar = (o: THREE.Object3D) => root.worldToLocal(o.position.clone());
    expect(inCar(rt.lights.head).x).toBeCloseTo(front + 0.05, 4);
    expect(inCar(rt.lights.tail).x).toBeCloseTo(rear - 0.05, 4);
  });

  it('no model loaded: nothing is drawn (never a stand-in) while the colliders and the damage follow the record', () => {
    const w = world({models: false});
    expect(w.armor.install('armor')).toBe(true);
    expect(w.armor.meshes.size).toBe(0);
    expect(w.armor.shown).toBe(false);
    expect(w.armor.previewObject()).toBeNull();
    expect(w.rt.armorFitted()).toBe(true);
    run(w.h, 1);
    expect(w.icons).toEqual([]); // (no preview render without the real models)
  });

  it('some models loaded: those pieces are drawn, the others are not (never a stand-in); no preview until every model is there', () => {
    const w = world({models: ['strip', 'plate']});
    expect(w.armor.install('armor')).toBe(true);
    expect([...w.armor.meshes.keys()].sort()).toEqual(MESH_KEYS.filter(k => k.startsWith('strip') || k.startsWith('plate')));
    expect(w.armor.shown).toBe(true);
    expect(w.armor.previewObject()).toBeNull();
    run(w.h, 1);
    expect(w.icons).toEqual([]);
    expect(w.rt.train!.col.armor.shoot).toHaveLength(L.boxes.length); // (the colliders are the record's, whatever is drawn)
  });

  it("the recipe row's preview 'upgrade:armor': the real front plough + the platform side's front once the models are there, rendered once", () => {
    const w = world({models: true});
    const pieces = w.armor.previewPieces();
    // the front end's whole plough (two corner towers, two wings, the prow) and the platform side ahead of the front door
    expect(pieces.filter(p => p.kind === 'end').map(p => p.part).sort()).toEqual(['prow', 'tower', 'tower', 'wing', 'wing']);
    for (const p of pieces) expect(p.kind === 'end' ? p.dir : -p.dir, p.part).toBe(1);
    expect(new Set(pieces.filter(p => p.kind === 'side').map(p => p.part))).toEqual(new Set(['guard', 'plate', 'pillar', 'rail']));
    const obj = w.armor.previewObject()!;
    expect(obj).not.toBeNull();
    let meshes = 0;
    obj.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBe(pieces.length);
    run(w.h, 0.5);
    expect(w.icons).toEqual([[ARMOR_PREVIEW_ID]]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour: contact damage (zombies only, parked only)', () => {
  it('a regular zombie held against the blades dies after 5 s (+- 0.5 s), alive at 4 s; through Game.blastKill; a coated one lasts longer', () => {
    // far side: in the bed, against the plate that stands out the furthest; platform side: pressed at the platform edge (the curb
    // stops its circle there) beside the plate that stands out the LEAST — the rule's reach covers the gap
    const cases: [-1 | 1, string, () => [number, number]][] = [
      [1, 'far side (bed)', () => against(proudest(1), R)],
      [-1, 'platform side (at the edge)', () => { const s = flushest(-1); return [(s.box.x0 + s.box.x1) / 2, -(EDGE_TO_TRACK + R + 0.005)]; }],
    ];
    for (const [dir, label, at] of cases) {
      const w = world();
      w.armor.install('armor');
      const [x, z] = at();
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
    // a plough: the same rule; a coated zombie (165 hp) against the prow after 8.25 s; a regular one against a wing loses 20 hp/s
    const w = world();
    w.armor.install('armor');
    const [x, z] = against(prow(1), ZOMBIE_STATS.coated.radius);
    const zc = zombie(w, x, z, 'coated');
    const wing = L.solids.filter(s => s.part === 'wing' && s.dir === 1 && s.box.z0 > 0)[2];
    const zw = zombie(w, ...against(wing, R));
    run(w.h, 1);
    expect(zw.brain.hp).toBeCloseTo(100 - ARMOR_CONTACT.dps, 3);
    w.h.zombies.splice(w.h.zombies.indexOf(zw), 1);
    run(w.h, 6.5);
    expect(zc.brain.alive).toBe(true);
    const t = timeToDie(w, zc, 2);
    expect(7.5 + t!).toBeCloseTo(ZOMBIE_STATS.coated.hp / ARMOR_CONTACT.dps, 1);
  });

  it('nothing for a zombie 1 m away, in an open doorway or in front of a door, nor before the armour is fitted', () => {
    const w = world();
    const s = proudest(1);
    const [x, z] = against(s, R, 0.05);
    const notYet = zombie(w, x, z);
    run(w.h, 1);
    expect(notYet.brain.hp).toBe(100); // (not fitted: no damage)
    w.h.zombies.length = 0;
    w.armor.install('armor');
    const away = zombie(w, x, s.dir * (s.outer + R + 1.0));
    const door = SPEC.doors.findIndex(d => d.side < 0);
    expect(w.rt.setDoor(door, true)).toBe('opening');
    run(w.h, 2);
    const d = SPEC.doors[door];
    const inDoor = zombie(w, d.x, -(outerHalf(SPEC) + 0.12)); // (on the bridge in the open doorway)
    const front = zombie(w, d.x + d.width / 2, -(EDGE_TO_TRACK + R + 0.02)); // (on the platform at the jamb)
    const farDoor = SPEC.doors.find(q => q.side > 0)!;
    const bedDoor = zombie(w, farDoor.x, outerHalf(SPEC) + R + 0.05); // (in the bed at a far-side door: the skirt runs on under it)
    run(w.h, 6);
    for (const [z0, label] of [[away, '1 m away'], [inDoor, 'in the doorway'], [front, 'in front of a door'], [bedDoor, 'at a far door']] as const) {
      expect(z0.brain.hp, label).toBe(100);
    }
    expect(w.armor.counts.contactFrames).toBe(0);
  });

  it('the player, a market person, a corpse, a ragdoll and a climbing zombie take nothing; nothing while the ride holds the car', async () => {
    const w = world();
    w.armor.install('armor');
    const [x, z] = against(proudest(1), 0.3, 0.02);
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
    const [x2, z2] = against(proudest(1), R);
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
    const near = plates(1).map(p => zombie(w, ...against(p, R)));
    expect(near.length).toBeGreaterThanOrEqual(6);
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
    let plate: ArmorSolid | null = null;
    const stopAt = (fitted: boolean): number => {
      const w = world();
      if (fitted) w.armor.install('armor');
      const [pc, x] = openLane(w, 1), g = ground(w, x, pc.outer + 0.3 + 0.15);
      plate = pc;
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
    const bare = stopAt(false), armoured = stopAt(true), outer = plate!.outer;
    expect(armoured).toBeGreaterThanOrEqual(outer + 0.3 - 0.03);
    expect(armoured).toBeLessThan(outer + 0.3 + 0.1);
    expect(armoured - bare).toBeGreaterThan(0.15);
  });

  it("an enemy's motor (moveCircle on game.propIndex) stops at the prow and at a plate; a shot from outside hits the armour box", () => {
    const w = world();
    w.armor.install('armor');
    // (the far side of a single bed leaves 0.8 m to its wall: start 0.12 m off the blades there; 0.6 m beyond the prow)
    const [lanePlate, laneX] = openLane(w, 1);
    for (const [s, gap, shot] of [[prow(1), 0.6, 1.5], [lanePlate, 0.12, 0.4]] as const) {
      const [x0, z] = against(s, R, gap), x = s === lanePlate ? laneX : x0;
      const g = ground(w, x, z), at = trainToWorld(w.p, s.kind === 'end' ? 0 : x, 0, s.kind === 'end' ? z : 0);
      const dx = at.x - g.x, dz = at.z - g.z, d = Math.hypot(dx, dz);
      let px = g.x, pz = g.z;
      for (let i = 0; i < 120; i++) [px, pz] = moveCircle(w.h.levels!, w.h.propIndex, px, pz, (dx / d) * 0.03, (dz / d) * 0.03, R, g.y);
      const q = worldToTrain(w.p, px, g.y, pz);
      const reach = s.kind === 'end' ? s.dir * q.x : s.dir * q.z;
      expect(reach, s.part).toBeGreaterThanOrEqual(s.outer + R - 0.03);
      expect(reach, s.part).toBeLessThan(s.outer + R + 0.05);
      // a level shot at the blades from `shot` m out stops on the armour's box
      const ly = (s.box.y0 + s.box.y1) / 2;
      const eye = trainToWorld(w.p, s.kind === 'end' ? s.dir * (s.outer + shot) : x, ly, s.kind === 'end' ? 0 : s.dir * (s.outer + shot));
      const n = Math.hypot(at.x - eye.x, at.z - eye.z);
      const hit = raycastWorld(w.h.levels!, w.h.layout.props, eye, {x: (at.x - eye.x) / n, y: 0, z: (at.z - eye.z) / n}, 10, w.h.layout.trench.floorY);
      expect(hit.kind, s.part).toBe('prop');
      expect(w.rt.train!.col.armor.shoot, s.part).toContain(w.h.layout.props[hit.prop!]);
      expect(Math.abs(hit.t - shot), s.part).toBeLessThan(0.05);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour: the layout keeps the car usable', () => {
  it('deterministic; every piece has its part on its side / end; no visibly squashed or stretched face', () => {
    expect(armorLayout()).toEqual(L);
    expect(L.pieces.filter(p => p.kind === 'side' && p.dir < 0).length).toBeGreaterThan(20);
    expect(L.pieces.filter(p => p.kind === 'side' && p.dir > 0).length).toBeGreaterThan(20);
    for (const end of [-1, 1] as const) expect(L.pieces.filter(p => p.kind === 'end' && p.dir === end).map(p => p.part).sort()).toEqual(['brow', 'prow', 'tower', 'tower', 'wing', 'wing']);
    for (const p of L.pieces) {
      // the face a viewer sees (the model's X / Y): its two scales within a third of each other, and neither far from the model's size
      const f = p.scale[0] / p.scale[1];
      expect(f, `${p.part} ${p.box.x0}`).toBeGreaterThan(0.75);
      expect(f, `${p.part} ${p.box.x0}`).toBeLessThan(1.36);
      for (const k of [0, 1]) { expect(p.scale[k], p.part).toBeGreaterThan(0.75); expect(p.scale[k], p.part).toBeLessThan(1.4); }
      expect(p.scale[2], p.part).toBeGreaterThan(0.4);
      expect(p.scale[2], p.part).toBeLessThan(1.8);
    }
  });

  it('every door opening stays bare: nothing of the belt or the window band within doorGap of its jambs, the skirt under its sill, the rail over its head', () => {
    const A = TRAIN_ARMOR;
    for (const d of SPEC.doors) {
      const a = d.x - d.width / 2, b = d.x + d.width / 2, sill = SPEC.floorY, head = SPEC.floorY + d.height;
      for (const p of L.pieces.filter(q => q.kind === 'side' && q.dir === d.side)) {
        const over = p.box.x1 > a - A.doorGap + 1e-5 && p.box.x0 < b + A.doorGap - 1e-5;
        if (!over) continue;
        expect(p.box.y1 <= sill - 0.05 || p.box.y0 >= head, `door ${d.x}: ${p.part}`).toBe(true);
        expect(['skirt', 'guard', 'rail'], `door ${d.x}`).toContain(p.part);
      }
    }
    // the leaves slide INSIDE the skin (pocket doors): a plate over a leaf pocket touches nothing
    expect(SPEC.doorLeaf.outerZ).toBeLessThan(Math.min(A.skinNeg, A.skinPos) - 0.05);
    // no column stands in a doorway's way: every column within a door's width + doorGap ends under the LOWEST platform a door can
    // open onto (the placement allows TRAIN_CLEAR.maxStep under the car floor; a prop blocks feet more than 2 cm under its top)
    let under = 0;
    for (const d of SPEC.doors) for (const c of COLUMNS) {
      const z = d.side > 0 ? c.z1 : -c.z0;
      if (z < 0 || c.x1 <= d.x - d.width / 2 - A.doorGap + 1e-5 || c.x0 >= d.x + d.width / 2 + A.doorGap - 1e-5) continue;
      under++;
      expect(c.colTop ?? c.y1, `door ${d.x}`).toBeLessThanOrEqual(SPEC.floorY - TRAIN_CLEAR.maxStep - 0.02);
    }
    expect(under).toBeGreaterThanOrEqual(SPEC.doors.length);
  });

  it('windows and lamps stay clear: no piece over a side window, an end window or a lamp; the ploughs under the lamps, outboard and between', () => {
    for (const win of SPEC.windows.side) for (const p of L.pieces) {
      const zOut = win.side > 0 ? p.box.z1 : -p.box.z0;
      if (zOut < win.skinZ - 0.05) continue; // (not on that side's skin)
      const over = p.box.x1 > win.x0 && p.box.x0 < win.x1 && p.box.y1 > win.y0 && p.box.y0 < win.y1;
      expect(over, `side window ${win.side} ${win.x0}: ${p.part}`).toBe(false);
    }
    for (const win of SPEC.windows.end) for (const p of L.pieces) {
      const xOut = win.end > 0 ? p.box.x1 : -p.box.x0;
      if (xOut < win.skinX - 0.05) continue; // (not on that end's skin)
      const over = p.box.z1 > win.z0 && p.box.z0 < win.z1 && p.box.y1 > win.y0 && p.box.y0 < win.y1;
      expect(over, `end window ${win.end} ${win.z0}: ${p.part}`).toBe(false);
    }
    const r = SPEC.lights.lampRadius + 0.04;
    let lamps = 0;
    for (const [end, list] of [[1, [...SPEC.lights.head, ...SPEC.lights.marker.front]], [-1, [...SPEC.lights.tail, ...SPEC.lights.marker.rear]]] as const) {
      for (const l of list) {
        lamps++;
        for (const p of L.pieces.filter(q => q.kind === 'end' && q.dir === end)) {
          const over = p.box.z1 > l.z - r && p.box.z0 < l.z + r && p.box.y1 > l.y - r && p.box.y0 < l.y + r;
          expect(over, `lamp ${end} ${l.y} ${l.z}: ${p.part}`).toBe(false);
        }
      }
    }
    expect(lamps).toBe(8);
    for (const end of [-1, 1] as const) {
      // the couplers (the shell's outer x extent) are inside the plough: its prow ahead of them, the wedge from behind the end face
      expect(prow(end).outer).toBeGreaterThan(SPEC.length / 2 + 0.3);
      expect(Math.min(...L.solids.filter(s => s.kind === 'end' && s.dir === end).map(s => s.back))).toBeLessThan(SPEC.length / 2 - 0.5);
    }
  });

  it('inside the platform gap, the ride box clear of the open gate leaves, clear of the transit signals and cable tray, over the third rail / coverboard', () => {
    const halfCar = SPEC.width / 2, S = TRANSIT.signal;
    const signalY0 = S.lensY - S.lensUp - S.housing[1] / 2, signalZ = TRANSIT.halfWidth - S.wallGap - S.housing[2];
    const trayY0 = -RAIL_TOP_ABOVE_BED + TRANSIT.tray.y, trayZ = TRANSIT.halfWidth - TRANSIT.tray.w - 0.04;
    expect([signalY0, signalZ, trayY0, trayZ].map(v => +v.toFixed(3))).toEqual([2.1, 1.72, 2.955, 1.71]);
    for (const b of L.boxes) {
      const zMax = Math.max(Math.abs(b.z0), Math.abs(b.z1));
      expect(zMax).toBeLessThan(EDGE_TO_TRACK - 0.25); // (the platform edge; a zombie at the edge stands within reach)
      expect(zMax).toBeLessThan(RIDE_BOX.half);
      expect(zMax).toBeLessThan(halfCar + 0.25); // (the open gate leaves stay beyond it: tests/ride-portal-gates.test.ts)
      // the transit tunnel's wall fixtures (either wall: the kit is the same both sides): whatever reaches their height stays inboard
      if (b.y1 > Math.min(signalY0, trayY0) - 0.04) expect(zMax).toBeLessThanOrEqual(Math.min(signalZ, trayZ) - 0.06);
      expect(b.y0).toBeGreaterThan(-RAIL_TOP_ABOVE_BED + TRANSIT.third.y + TRANSIT.third.h / 2); // (the transit's third rail)
      expect(b.y0).toBeGreaterThan(0.19); // (the station beds' third-rail coverboard top: 0.1825 above the rail top, measured)
      expect(b.y1).toBeLessThan(TRANSIT.ceil - RAIL_TOP_ABOVE_BED - 1);
    }
    // the platform side: a regular zombie pressed at the platform edge (its circle stopped by the curb) is within reach of every
    // bladed face along the body — and the rule's reach is not more than that needs
    for (const s of sides(-1)) {
      expect(EDGE_TO_TRACK - s.outer, s.part).toBeLessThanOrEqual(ARMOR_CONTACT.reach - 0.02);
      expect(EDGE_TO_TRACK - s.outer, s.part).toBeGreaterThan(ARMOR_CONTACT.reach - 0.1);
    }
  });

  it('the contact rule: reach, along the solid, height, never through the hull, never at a door', () => {
    const p = proudest(1), mx = (p.box.x0 + p.box.x1) / 2, bed = -RAIL_TOP_ABOVE_BED;
    expect(armorContact(L, mx, bed, p.outer + R + ARMOR_CONTACT.reach - 0.01, R)).not.toBeNull();
    expect(armorContact(L, mx, bed, p.outer + R + ARMOR_CONTACT.reach + 0.01, R)).toBeNull();
    expect(armorContact(L, mx, bed, 0.5, R)).toBeNull(); // (inside the car)
    expect(armorContact(L, mx, p.box.y1 + ARMOR_CONTACT.tolY + 0.01, p.outer + R, R)).toBeNull(); // (above the belt: the pillars / rails are no blades)
    expect(armorContact(L, SPEC.length / 2 + 1.5, bed, p.outer + R, R)).toBeNull(); // (beyond the car's end)
    for (const d of SPEC.doors) expect(armorContact(L, d.x, bed, d.side * (TRAIN_ARMOR.skinPos + 0.3 + R), R), `door ${d.x}`).toBeNull();
    const hit = armorContact(L, mx, bed, p.outer + R + 0.02, R)!;
    expect(hit.solid).toBe(p);
    expect([hit.nx, hit.nz]).toEqual([0, 1]);
    expect(hit.gap).toBeCloseTo(0.02, 6);
    // an end: the prow's face; the corner tower counts from the side too (a body beside the corner)
    const e = armorContact(L, prow(1).outer + R + 0.02, bed, 0, R)!;
    expect([e.solid.part, e.nx, e.nz]).toEqual(['prow', 1, 0]);
    const tower = L.solids.find(s => s.part === 'tower' && s.kind === 'side' && s.dir === 1 && s.box.x0 > 0)!;
    const c = armorContact(L, (tower.box.x0 + tower.box.x1) / 2, bed, tower.outer + R + 0.02, R)!;
    expect([c.solid.part, c.nz]).toEqual(['tower', 1]);
    // the rule's numbers are the first kit's (the makeover changed the geometry only)
    expect(ARMOR_CONTACT).toEqual({dps: 20, reach: 0.4, tolX: 0.1, tolY: 0.1, doorClear: 0.5, height: 1.7, feedbackS: 0.6, maxFx: 4});
  });
});
