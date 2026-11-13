// Task studio-train-armor-makeover-20261113-183146-01: the train armour's MAKEOVER (user: the first kit was lackluster — "really bulk up
// the armor… add more… make the train look really cool"): a heavy armoured car from the same one-time upgrade.
//  - THE KIT (world/trainArmorLayout.ts): its composition — a skirt end to end under both sides, a belt of overlapping plates between
//    the doors, a buttress post on the window pillars, a roof-line rail, and at each end a wedge plough with corner towers, a prow and
//    a brow; several times the first kit's cover; one box per bladed piece (the wedge: a staircase along the real slab);
//  - THE MODELS (assets/trainArmorKit.generated.ts; Codex design image -> Meshy T2.5 image-to-3D, Meshy's own maps kept): the frame
//    the layout builds on, the budget, provenance / CREDITS / the release allowlist, the car's model catalogue; the mirrored copies
//    (world/trainArmor.ts mirroredGeometry) keep their front faces;
//  - THE CAR STAYS USABLE with the kit fitted, on a generated station with the real train runtime: the real Player walks in and out
//    through every platform door (also hugging a jamb, also diagonally), a fuel cart is dragged aboard through a door, the fuel cap's
//    bay and its sight lines stay open, the sentry turret keeps every line of fire the bare car allowed, the riding car's collision
//    takes only what a body on its floor can meet;
//  - EXISTING SAVES: the record of a train armoured with the first kit ({v: 1, fitted: ['armor']}) shows the new kit on load — no
//    craft, no new field, the rest of the record untouched.
// (The seam, the contact rule and the layout's clearances: tests/train-armor.test.ts; every level's placement:
// tests/train-armor-clearance.test.ts.)
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {installCanvasShim} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {EDGE_TO_TRACK, RAIL_TOP_ABOVE_BED, TRAIN_CLEAR, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {Levels} from '../src/gen/levels';
import {PropIndex, moveCircle} from '../src/core/physics';
import {levelOfAsset} from '../src/assets/levelAssets';
import {TRAIN_ARMOR_MODELS} from '../src/assets/trainArmor.generated';
import {TRAIN_ARMOR_KIT_MODELS} from '../src/assets/trainArmorKit.generated';
import {SENTRY, barrelDir, hullExit, ownHullClear, turretPivot} from '../src/craft/sentry';
import {FUEL} from '../src/fuel/fuel';
import {PORT, cartAboard, fuelPortLocal} from '../src/fuel/trainPort';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {FUEL_CART, type FuelCarts} from '../src/world/fuelCarts';
import {FUEL_PORT} from '../src/world/fuelPort';
import {PLAYER_TRAIN_MODEL_FILES, armorColliders, type PlayerTrainRuntime} from '../src/world/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {buildRideLocalModel, setRideArmorBoxes} from '../src/world/trainRideLocal';
import {ARMOR_MODELS, ARMOR_MODEL_IDS, TRAIN_ARMOR, armorLayout, fuelBay, pillarSpans, plateSpans, trainArmorLayout, type ArmorBox, type ArmorModelId, type ArmorPart} from '../src/world/trainArmorLayout';
import {ARMOR_TEXT, TrainArmorSystem, armorMeshKey, mirroredGeometry} from '../src/world/trainArmor';
import {Keys, build, frame, holdE, lookAt, press, run, stationHost, teardown, type CartTestHost} from './helpers/fuelCartsHost';
import type {TrainRide} from '../src/world/trainRide';

installCanvasShim(false);

const L = trainArmorLayout(), A = TRAIN_ARMOR;
const parts = (part: ArmorPart, dir?: -1 | 1) => L.pieces.filter(p => p.part === part && (dir === undefined || p.dir === dir));
const KIT = TRAIN_ARMOR_KIT_MODELS;
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------
let layoutCache: StationLayout | null = null;
const SUBWAY = (): StationLayout => (layoutCache ??= LEVELS.subway.generate('main', {levelSeed: 4242}));
type H = CartTestHost & {trainRuntime: PlayerTrainRuntime; trainRide: TrainRide; layout: StationLayout};
interface World { h: H; rt: PlayerTrainRuntime; ride: TrainRide; armor: TrainArmorSystem; carts?: FuelCarts; p?: TrainPlacement }
const live: World[] = [];
afterEach(() => {
  for (const w of live.splice(0)) {
    w.armor.dispose();
    if (w.rt.train) { w.rt.ride = null; teardown(w.h); }
  }
});

let models: Record<ArmorModelId, GLTF>;
beforeAll(async () => {
  models = Object.fromEntries(await Promise.all(ARMOR_MODEL_IDS.map(async id => [id, await loadStripped(ARMOR_MODELS[id].url)]))) as Record<ArmorModelId, GLTF>;
});

/** The station with the train, the ride, the carts and the armour (Game order), built; the armour fitted unless `bare`. */
function world(o: {bare?: boolean; models?: boolean} = {}): Required<World> {
  const {h, rt, ride, carts} = stationHost(SUBWAY(), {build: false}) as unknown as {h: H; rt: PlayerTrainRuntime; ride: TrainRide; carts: FuelCarts};
  Object.assign(h, {blastKill: () => {}, fx: {impact: () => {}}});
  const armor = new TrainArmorSystem(h as never, {model: id => (o.models ? models[id].scene : null)}).install();
  const w = {h, rt, ride, armor, carts, p: null as unknown as TrainPlacement};
  live.push(w);
  build(h, SUBWAY());
  w.p = h.trainPlacement!;
  if (!o.bare) expect(armor.install('armor')).toBe(true);
  return w;
}

/** Ray o + d t, t in [t0, t1], against a box. */
function rayBox(o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, t0: number, t1: number, b: ArmorBox): boolean {
  let a = t0, e = t1;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) return false; continue; }
    let p = (lo - oo) / dd, q = (hi - oo) / dd;
    if (p > q) { const s = p; p = q; q = s; }
    if (p > a) a = p;
    if (q < e) e = q;
    if (a > e) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
describe('train armour makeover: the kit on the car', () => {
  it('a heavy kit: skirt, belt plates, window pillars, roof-line rails on both sides; a wedge plough with corner towers, a prow and a brow at both ends', () => {
    const count = (dir?: -1 | 1) => Object.fromEntries((['guard', 'skirt', 'plate', 'pillar', 'rail', 'tower', 'wing', 'prow', 'brow'] as const).map(k => [k, parts(k, dir).length]));
    expect(count()).toEqual({guard: 4, skirt: 6, plate: 16, pillar: 11, rail: 18, tower: 4, wing: 4, prow: 2, brow: 2});
    expect(L.pieces).toHaveLength(67);
    // the models: the first kit's blade strip and fin grille reused (skirt / bogie guards), the makeover's four new ones for the rest
    const by = (m: ArmorModelId) => [...new Set(L.pieces.filter(p => p.model === m).map(p => p.part))].sort();
    expect({strip: by('strip'), grille: by('grille'), plate: by('plate'), post: by('post'), wing: by('wing'), rail: by('rail')})
      .toEqual({strip: ['skirt'], grille: ['guard'], plate: ['plate'], post: ['pillar', 'prow', 'tower'], wing: ['wing'], rail: ['brow', 'rail']});
    expect(ARMOR_MODELS.strip).toBe(TRAIN_ARMOR_MODELS.side);
    expect(ARMOR_MODELS.grille).toBe(TRAIN_ARMOR_MODELS.end);
    // nine draws: a model's mirrored pieces are one more (plates, wings, rails)
    expect([...new Set(L.pieces.map(p => armorMeshKey(p.model, p.mirror)))].sort()).toEqual(['grille', 'plate', 'plate-mirror', 'post', 'rail', 'rail-mirror', 'strip', 'wing', 'wing-mirror']);
    // triangles drawn: instanced, under 400k for the whole kit
    const tris = L.pieces.reduce((n, p) => n + ARMOR_MODELS[p.model].tris, 0);
    expect(tris).toBeGreaterThan(300_000);
    expect(tris).toBeLessThan(400_000);
  });

  it('substantially heavier than the first kit: the cover of each side and each end, the depth of the belt, the reach of the ploughs', () => {
    const face = (ps: typeof L.pieces, k: 'x' | 'z') => ps.reduce((n, p) => n + (k === 'x' ? p.box.x1 - p.box.x0 : p.box.z1 - p.box.z0) * (p.box.y1 - p.box.y0), 0);
    for (const dir of [-1, 1] as const) {
      // (the first kit: four 0.40 m strips a side — under 4 m2 of a 16 m body side)
      const side = face(L.pieces.filter(p => p.kind === 'side' && p.dir === dir), 'x');
      expect(side, `side ${dir}`).toBeGreaterThan(20);
      // (the first kit: one 2.86 x 0.75 m plough — 2.1 m2 an end)
      const end = face(L.pieces.filter(p => p.kind === 'end' && p.dir === dir), 'z');
      expect(end, `end ${dir}`).toBeGreaterThan(4.5);
      // the plough: from corner to corner, well ahead of the coupler, its towers up to the window sills
      const zs = L.pieces.filter(p => p.kind === 'end' && p.dir === dir).flatMap(p => [p.box.z0, p.box.z1]);
      expect(Math.min(...zs)).toBeLessThan(-1.6);
      expect(Math.max(...zs)).toBeGreaterThan(1.6);
      expect(Math.max(...parts('prow', dir).map(p => Math.max(Math.abs(p.box.x0), Math.abs(p.box.x1))))).toBeGreaterThan(SPEC.length / 2 + 0.4);
      for (const t of parts('tower', dir)) { expect(t.box.y1).toBeGreaterThan(1.8); expect(t.box.y1).toBeLessThan(Math.min(...SPEC.windows.end.map(w => w.y0)) - 0.03); }
    }
    // the belt stands 0.19 .. 0.215 m proud of the skin, the skirt 0.225 .. 0.25 m
    for (const p of parts('plate')) expect(Math.abs(p.box.z1 - p.box.z0)).toBeGreaterThanOrEqual(0.19 - 1e-6);
    for (const p of [...parts('skirt'), ...parts('guard')]) expect(Math.abs(p.box.z1 - p.box.z0)).toBeGreaterThanOrEqual(0.225 - 1e-6);
  });

  it('the skirt runs end to end under both sides; the belt covers everything but the doors and the fuel bay, its plates lapped and alternately mirrored', () => {
    for (const dir of [-1, 1] as const) {
      const low = [...parts('guard', dir), ...parts('skirt', dir)].sort((a, b) => a.box.x0 - b.box.x0);
      expect(low[0].box.x0).toBeCloseTo(-A.sideEnd, 5);
      expect(low[low.length - 1].box.x1).toBeCloseTo(A.sideEnd, 5);
      for (let i = 1; i < low.length; i++) expect(low[i].box.x0, `skirt joint ${i}`).toBeCloseTo(low[i - 1].box.x1, 5);
      expect([low[0].part, low[low.length - 1].part]).toEqual(['guard', 'guard']); // (a deeper guard over each bogie)
      for (const p of low) { expect(p.box.y0).toBeCloseTo(A.skirt.y0, 5); expect(p.box.y1).toBeLessThan(SPEC.floorY - 0.05); }
      // the belt: every free span of the side is covered edge to edge
      const belt = parts('plate', dir).sort((a, b) => a.box.x0 - b.box.x0), spans = plateSpans(SPEC, dir);
      const covered = (x: number) => belt.some(p => p.box.x0 <= x + 1e-6 && p.box.x1 >= x - 1e-6);
      let free = 0;
      for (const [a, b] of spans) {
        free += b - a;
        for (let x = a; x <= b + 1e-9; x += (b - a) / 40) expect(covered(x), `belt at ${x.toFixed(2)} (side ${dir})`).toBe(true);
        expect(belt.some(p => Math.abs(p.box.x0 - a) < 1e-5), `span start ${a}`).toBe(true);
        expect(belt.some(p => Math.abs(p.box.x1 - b) < 1e-5), `span end ${b}`).toBe(true);
      }
      // (16 m of body: 14.84 m between the corners, three doors + their gaps off — and the fuel bay on the platform side)
      expect(free).toBeGreaterThan(dir < 0 ? 9.8 : 10.4);
      for (const p of belt) expect(spans.some(([a, b]) => p.box.x0 >= a - 1e-5 && p.box.x1 <= b + 1e-5), `plate ${p.box.x0}`).toBe(true);
      // alternately flush / proud (the proud ones mirrored, a little lower, lapping over a neighbour in the same span)
      belt.forEach((p, i) => {
        const proud = i % 2 === 1, depth = Math.abs(p.box.z1 - p.box.z0);
        expect(p.mirror, `plate ${i}`).toBe(proud);
        expect(depth, `plate ${i}`).toBeCloseTo(proud ? A.plate.proud : A.plate.depth, 5);
        expect(p.box.y0, `plate ${i}`).toBeCloseTo(A.plate.y0 - (proud ? A.plate.drop : 0), 5);
      });
      let laps = 0;
      for (let i = 1; i < belt.length; i++) {
        const lap = belt[i - 1].box.x1 - belt[i].box.x0;
        if (lap > 1e-5) { laps++; expect(lap).toBeCloseTo(A.plate.lap, 4); }
      }
      expect(laps).toBeGreaterThanOrEqual(3);
      // the pillars: one per solid span of the window band, centred in it; the rail: one unbroken run
      const posts = parts('pillar', dir), solid = pillarSpans(SPEC, dir);
      expect(posts).toHaveLength(solid.length);
      for (const p of posts) expect(solid.some(([a, b]) => p.box.x0 >= a + A.pillar.edge - 1e-5 && p.box.x1 <= b - A.pillar.edge + 1e-5 && Math.abs((p.box.x0 + p.box.x1) / 2 - (a + b) / 2) < 1e-5)).toBe(true);
      const rails = parts('rail', dir).sort((a, b) => a.box.x0 - b.box.x0);
      expect(rails[0].box.x0).toBeCloseTo(-A.rail.end, 5);
      expect(rails[rails.length - 1].box.x1).toBeCloseTo(A.rail.end, 5);
      for (let i = 1; i < rails.length; i++) expect(rails[i].box.x0).toBeCloseTo(rails[i - 1].box.x1, 5);
      expect(rails.every(p => p.mirror === dir < 0)).toBe(true); // (the fins rake the same way down both sides)
    }
  });

  it('boxes and solids: one box per bladed piece; the wedge as a staircase within a few centimetres of the real slab; pillars and rails overhead', () => {
    const boxed = L.pieces.filter(p => ['plate', 'pillar', 'prow'].includes(p.part));
    for (const p of boxed) expect(L.boxes.some(b => (['x0', 'x1', 'y0', 'y1', 'z0', 'z1'] as const).every(k => b[k] === p.box[k])), `${p.part} ${p.box.x0}`).toBe(true);
    // a skirt piece: its box cut at the doors — the pieces tile it exactly; under a door (+ doorGap) the movement column is LOW (it
    // stops a body in the bed, never one at the height of the lowest platform a door can open onto)
    const lowPlatform = SPEC.floorY - TRAIN_CLEAR.maxStep;
    let under = 0;
    for (const p of [...parts('guard'), ...parts('skirt')]) {
      const tiles = L.boxes.filter(b => !b.overhead && b.y0 === p.box.y0 && b.y1 === p.box.y1 && b.z0 === p.box.z0 && b.z1 === p.box.z1 && b.x0 >= p.box.x0 - 1e-6 && b.x1 <= p.box.x1 + 1e-6).sort((a, b) => a.x0 - b.x0);
      expect(tiles[0].x0, p.part).toBeCloseTo(p.box.x0, 5);
      expect(tiles[tiles.length - 1].x1, p.part).toBeCloseTo(p.box.x1, 5);
      for (let i = 1; i < tiles.length; i++) expect(tiles[i].x0, p.part).toBeCloseTo(tiles[i - 1].x1, 5);
      for (const b of tiles) {
        const door = SPEC.doors.find(d => d.side === p.dir && b.x1 > d.x - d.width / 2 - A.doorGap + 1e-5 && b.x0 < d.x + d.width / 2 + A.doorGap - 1e-5);
        expect(b.colTop !== undefined, `${p.part} ${b.x0}`).toBe(!!door);
        if (!door) continue;
        under++;
        expect(b.colTop!).toBeLessThanOrEqual(lowPlatform + 0.02 - 0.04); // (a prop blocks a body whose feet are more than 2 cm under its top)
        expect(b.colTop!).toBeGreaterThan(b.y0 + 0.2); // (and it does stand in the way of a body in the bed)
      }
    }
    expect(under).toBeGreaterThanOrEqual(SPEC.doors.length);
    expect(L.boxes.filter(b => b.colTop !== undefined)).toHaveLength(under);
    const overhead = L.boxes.filter(b => b.overhead);
    expect(overhead).toHaveLength(parts('pillar').length + 2); // (one box per pillar, one per side for the rail's run)
    for (const b of overhead) expect(b.y0).toBeGreaterThan(1.85); // (over the belt: nothing a walking body meets)
    for (const dir of [-1, 1] as const) {
      const run1 = overhead.find(b => b.x1 - b.x0 > 14 && (dir > 0 ? b.z0 > 0 : b.z1 < 0))!;
      for (const p of parts('rail', dir)) expect(p.box.x0 >= run1.x0 - 1e-5 && p.box.x1 <= run1.x1 + 1e-5 && p.box.y0 >= run1.y0 - 1e-5 && p.box.y1 <= run1.y1 + 1e-5 && p.box.z0 >= run1.z0 - 1e-5 && p.box.z1 <= run1.z1 + 1e-5).toBe(true);
    }
    // contact solids: the bladed faces only (never an overhead piece, never the brow)
    expect(new Set(L.solids.map(s => s.part))).toEqual(new Set(['guard', 'skirt', 'plate', 'tower', 'wing', 'prow']));
    for (const s of L.solids) if (s.part === 'plate' || s.kind === 'end') expect(L.boxes.includes(s.box), s.part).toBe(true); // (the prow is an end solid)
    // the wedge: every slice's box contains its slice of the slab (from behind its back face to its outer face), and the staircase
    // stands nowhere more than 7 cm proud of the real outer face
    const G = A.plough, len = Math.hypot(G.tipX - G.cornerX, G.cornerZ), ux = (G.tipX - G.cornerX) / len, uz = -G.cornerZ / len, nx = -uz, nz = ux;
    const off = (x: number, z: number) => (x - G.cornerX) * nx + (z - G.cornerZ) * nz; // distance in front of the slab's back plane (+X end, +Z wing)
    const slices = L.solids.filter(s => s.kind === 'end' && s.dir === 1 && (s.part === 'wing' || s.part === 'tower') && s.box.z1 > 1e-6 && s.box.z0 >= -1e-6);
    expect(slices).toHaveLength(G.towerSlices + G.wingSlices);
    for (const s of slices) {
      expect(off(s.box.x1, s.box.z1)).toBeGreaterThanOrEqual(G.depth - 1e-5); // (the outermost corner: at or beyond the slab's outer face)
      expect(off(s.box.x1, s.box.z1) - G.depth).toBeLessThan(0.075);
      expect(off(s.box.x0, s.box.z0)).toBeLessThanOrEqual(1e-5); // (the innermost corner: at or behind its back face)
      expect(off(s.box.x1, s.box.z0)).toBeLessThan(G.depth + 0.07);
      expect(off(s.box.x1, s.box.z0)).toBeGreaterThan(G.depth - 0.12);
    }
    // the four wedges are mirror images: the same boxes through x -> -x and z -> -z
    const key = (b: ArmorBox) => [b.x0, b.x1, b.y0, b.y1, b.z0, b.z1].map(v => (Math.abs(v) < 5e-6 ? 0 : v).toFixed(5)).join(' ');
    const all = new Set(L.boxes.map(key));
    const ends = L.boxes.filter(b => Math.min(Math.abs(b.x0), Math.abs(b.x1)) >= G.cornerX - 1e-6);
    expect(ends).toHaveLength(2 * (2 * (G.towerSlices + G.wingSlices) + 1));
    for (const b of ends) {
      expect(all.has(key({...b, x0: -b.x1, x1: -b.x0})), 'front / rear').toBe(true);
      expect(all.has(key({...b, z0: -b.z1, z1: -b.z0})), 'left / right').toBe(true);
    }
  });

  it('a body walking into a plough wing stops at the staircase: never inside the real blade face, at most 9 cm short of it', () => {
    const {h, rt, ride} = stationHost(SUBWAY(), {build: false}) as unknown as {h: H; rt: PlayerTrainRuntime; ride: TrainRide};
    Object.assign(h, {blastKill: () => {}, fx: {impact: () => {}}});
    const armor = new TrainArmorSystem(h as never, {model: () => null}).install();
    live.push({h, rt, ride, armor});
    build(h, SUBWAY());
    armor.install('armor');
    const p = h.trainPlacement!, G = A.plough, len = Math.hypot(G.tipX - G.cornerX, G.cornerZ), ux = (G.tipX - G.cornerX) / len, uz = -G.cornerZ / len, nx = -uz, nz = ux;
    const r = 0.33, bedY = rt.train!.col.bedY;
    let n = 0;
    for (const d of [0.25, 0.7, 1.0, 1.3]) {
      // from 1 m in front of the slab's outer face, straight at it along its normal (the +X end's +Z wing)
      const fx = G.cornerX + d * ux + (G.depth + 1) * nx, fz = G.cornerZ + d * uz + (G.depth + 1) * nz;
      const a = trainToWorld(p, fx, 0, fz), b = trainToWorld(p, fx - nx, 0, fz - nz);
      const dx = b.x - a.x, dz = b.z - a.z;
      if (!h.levels!.isFree(a.x, p.railTopY, a.z)) continue; // (a narrow bed: the start is in its wall)
      let px = a.x, pz = a.z;
      for (let i = 0; i < 80; i++) [px, pz] = moveCircle(h.levels!, h.propIndex, px, pz, dx * 0.025, dz * 0.025, r, bedY);
      const q = worldToTrain(p, px, bedY, pz);
      const gap = (q.x - G.cornerX) * nx + (q.z - G.cornerZ) * nz - G.depth - r; // the circle's distance from the slab's real outer face
      expect(gap, `at ${d} m along the wing`).toBeGreaterThan(-0.02);
      expect(gap, `at ${d} m along the wing`).toBeLessThan(0.09);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour makeover: the cooked models', () => {
  const SIDECAR = 'assets/derivatives/train-armor-makeover-20261113.json';
  const IDS = ['plate', 'post', 'wing', 'rail'] as const;

  it('each model: one mesh in the layout\'s frame (width along X, grounded, the back face on z = 0), one Meshy PBR material with its three maps, the budget', async () => {
    for (const id of IDS) {
      const M = KIT[id], bytes = readFileSync(pub(M.url));
      const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
      const root = doc.getRoot(), b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
      expect(bytes.length, id).toBe(M.bytes);
      // (task train-armor-palette: the graded base colour's steel / rust contrast costs its JPEG 3-9 % of a file — the wing 864 -> 920 kB;
      // the mesh and the other two maps are byte for byte the same: tests/train-armor-palette.test.ts)
      expect(bytes.length, id).toBeLessThan(950_000);
      const prims = root.listMeshes().flatMap(m => m.listPrimitives());
      expect([root.listMeshes().length, prims.length], id).toEqual([1, 1]);
      expect(prims[0].getIndices()!.getCount() / 3, id).toBe(M.tris);
      expect(M.tris, id).toBeLessThan(8000); // (Smart Topology's own count: no simplification)
      [0, 1, 2].forEach(k => expect(b.max[k] - b.min[k], `${id} dim ${k}`).toBeCloseTo(M.dims[k], 3));
      expect(Math.abs(b.min[0] + b.max[0]), id).toBeLessThan(2e-3); // centred along its width
      expect(Math.abs(b.min[1]), id).toBeLessThan(1e-4); // grounded
      expect(Math.abs(b.min[2]), id).toBeLessThan(1e-4); // the back (mounting) face on z = 0, the fins toward +Z
      for (const n of root.listNodes()) expect(n.getMatrix(), id).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // baked
      const mats = root.listMaterials();
      expect(mats, id).toHaveLength(1);
      expect(mats[0].getAlphaMode(), id).toBe('OPAQUE');
      const maps = {baseColor: mats[0].getBaseColorTexture(), metallicRoughness: mats[0].getMetallicRoughnessTexture(), normal: mats[0].getNormalTexture()};
      for (const [slot, t] of Object.entries(maps)) {
        expect(t, `${id} ${slot}`).not.toBeNull();
        expect(t!.getMimeType(), `${id} ${slot}`).toBe('image/jpeg');
        expect(t!.getSize(), `${id} ${slot}`).toEqual([...M.textures[slot as keyof typeof maps]]);
      }
      expect(prims[0].getAttribute('TANGENT'), id).toBeNull(); // (the mirrored copies rely on it: no stored tangent frame to flip)
    }
  });

  it('they are in the car\'s model catalogue (fetched with the car: the upgrade shows the moment it is fitted), shared by every level', () => {
    for (const id of ARMOR_MODEL_IDS) {
      const M = ARMOR_MODELS[id];
      expect(PLAYER_TRAIN_MODEL_FILES[M.key], id).toEqual({url: M.url, bytes: M.bytes});
      expect(levelOfAsset(M.url), id).toBeNull();
    }
    expect(IDS.map(id => KIT[id].key)).toEqual(['train-armor-plate', 'train-armor-post', 'train-armor-wing', 'train-armor-rail']);
  });

  it('provenance, CREDITS and the release allowlist bind the exact bytes; first attempts only, inside the task\'s 75-credit cap; hash-only', () => {
    const side = readFileSync(pub(SIDECAR)), credits = readFileSync(pub('assets/CREDITS.md'));
    const prov = JSON.parse(side.toString());
    expect(prov).toMatchObject({id: 'train-armor-makeover-20261113', accepted: true, budget: {generations: 4, billedCredits: 60, capCredits: 75, creditsPerModel: 15}});
    expect(prov.route).toMatch(/Codex .*INITIAL.* -> Meshy T2\.5 image-to-3D, own PBR maps kept/);
    expect(prov.models.map((m: {id: string}) => m.id)).toEqual(IDS.map(id => KIT[id].key));
    const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    const raws = new Set<string>(), images = new Set<string>(), tasks = new Set<string>();
    for (const id of IDS) {
      const M = KIT[id], bytes = readFileSync(pub(M.url)), m = prov.models.find((q: {id: string}) => q.id === M.key);
      expect(m.output, id).toMatchObject({url: M.url, bytes: bytes.length, sha256: sha(bytes), triangles: M.tris});
      expect(m.output.dims, id).toEqual([...M.dims]);
      expect(m.meshy, id).toMatchObject({status: 'SUCCEEDED', billedCredits: 15, attempt: 1, request: {ai_model: 'meshy-t2.5', should_texture: true, enable_pbr: true}});
      expect(m.conditioningImage.codexAttempt, id).toBe(1);
      expect(m.source.triangles, id).toBe(M.tris); // (the cook never simplifies)
      expect(m.source.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(m.conditioningImage.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      // the fin side really is the +Z side: it stands far prouder of its extreme plane than the back does
      expect(m.finSideProud.front, id).toBeGreaterThan(5 * m.finSideProud.back + 0.005);
      expect(m.texturePolicy, id).toMatch(/Meshy maps kept/);
      raws.add(m.source.sha256); images.add(m.conditioningImage.sha256); tasks.add(m.meshy.task);
      expect(credits.toString(), id).toContain('`' + M.url + '`');
      expect(allow.get(M.url), id).toEqual({path: M.url, bytes: bytes.length, sha256: sha(bytes)});
    }
    expect([raws.size, images.size, tasks.size]).toEqual([4, 4, 4]); // (one design image, one Meshy task, one raw original each)
    for (const [p, b] of [[SIDECAR, side], ['assets/CREDITS.md', credits]] as const) expect(allow.get(p), p).toEqual({path: p, bytes: b.length, sha256: sha(b)});
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature|X-Amz|token=|\/workspaces\/|\/home\/|prompt/i);
  });

  it('a mirrored copy is the model reflected in its own X with its front faces kept (winding reversed with the reflection); the model itself untouched', async () => {
    for (const id of ['plate', 'wing', 'rail'] as const) {
      const gltf: GLTF = await loadStripped(KIT[id].url);
      let mesh: THREE.Mesh | null = null;
      gltf.scene.traverse(o => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
      const g = mesh!.geometry as THREE.BufferGeometry, x0 = Array.from(g.getAttribute('position').array.slice(0, 30));
      const m = mirroredGeometry(g);
      expect(Array.from(g.getAttribute('position').array.slice(0, 30)), id).toEqual(x0); // (a copy: the library's geometry is not edited)
      const P = g.getAttribute('position'), Q = m.getAttribute('position');
      expect(Q.count, id).toBe(P.count);
      for (const i of [0, 1, 2, Math.floor(P.count / 2), P.count - 1]) expect([Q.getX(i), Q.getY(i), Q.getZ(i)], id).toEqual([-P.getX(i), P.getY(i), P.getZ(i)]);
      g.computeBoundingBox();
      expect([m.boundingBox!.min.x, m.boundingBox!.max.x].map(v => +v.toFixed(5)), id).toEqual([-g.boundingBox!.max.x, -g.boundingBox!.min.x].map(v => +v.toFixed(5)));
      /** Triangles whose winding agrees / disagrees with their vertex normals (front faces / back faces). */
      const facing = (geo: THREE.BufferGeometry): [number, number] => {
        const p = geo.getAttribute('position'), nr = geo.getAttribute('normal'), ix = geo.getIndex()!;
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
        let front = 0, back = 0;
        for (let t = 0; t < ix.count; t += 3) {
          const i = ix.getX(t), j = ix.getX(t + 1), k = ix.getX(t + 2);
          a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j); c.fromBufferAttribute(p, k);
          n.copy(b).sub(a).cross(v.copy(c).sub(a));
          v.fromBufferAttribute(nr, i).add(a.fromBufferAttribute(nr, j)).add(b.fromBufferAttribute(nr, k));
          const d = n.dot(v);
          if (d > 0) front++; else if (d < 0) back++;
        }
        return [front, back];
      };
      const f0 = facing(g), f1 = facing(m);
      expect(f1, id).toEqual(f0);
      // (the cooked model's own winding: outward — but for the rail's folded rear half, flat on its back plane against the car)
      expect(f0[0] / (f0[0] + f0[1]), id).toBeGreaterThan(id === 'rail' ? 0.9 : 0.98);
      m.dispose();
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour makeover: the car stays usable with the kit fitted', () => {
  it('the real Player walks in and out through every platform door: centred, hugging either jamb, and diagonally past the plates — as on the bare car', () => {
    const HW = SPEC.interior.halfWidth;
    /** Walk from the platform toward the car through door `di` (start `off` m beside its middle, heading `lean` m sideways per 2.5 m): seconds until inside, or null. */
    const walkIn = (w: Required<World>, di: number, off: number, lean: number): number | null => {
      const {h, rt, p} = w, d = rt.train!.doors[di].col.door, P = h.player, keys = h.keys as Keys;
      const s = trainToWorld(p, d.x + off, SPEC.floorY, -3.0), to = trainToWorld(p, d.x + off + lean, SPEC.floorY, -0.5);
      P.place(s.x, s.z, Math.atan2(-(to.x - s.x), -(to.z - s.z)), h.levels!.floorAt(s.x, s.z, p.floorY + 0.3));
      keys.held.add('KeyW');
      let inside = false;
      const t = run(h, 6, () => { const q = worldToTrain(p, P.x, P.y, P.z); return (inside = Math.abs(q.z) < HW - 0.31 && Math.abs(q.x - d.x) < d.width / 2 + 1.5); });
      keys.held.clear();
      return inside ? t : null;
    };
    /** Walk from the car's aisle at door `di` out onto the platform: seconds until past the platform edge, or null. */
    const walkOut = (w: Required<World>, di: number, off: number): number | null => {
      const {h, rt, p} = w, d = rt.train!.doors[di].col.door, P = h.player, keys = h.keys as Keys;
      const s = trainToWorld(p, d.x + off, SPEC.floorY, 0), to = trainToWorld(p, d.x + off, SPEC.floorY, -3);
      P.place(s.x, s.z, Math.atan2(-(to.x - s.x), -(to.z - s.z)), p.floorY);
      keys.held.add('KeyW');
      let out = false;
      const t = run(h, 6, () => (out = worldToTrain(p, P.x, P.y, P.z).z < -(EDGE_TO_TRACK + 0.35)));
      keys.held.clear();
      return out ? t : null;
    };
    const results = (bare: boolean) => {
      const w = world({bare});
      const out: Record<string, number | null> = {};
      const platform = w.rt.train!.doors.map((dc, i) => [dc, i] as const).filter(([dc]) => dc.col.door.side === -1);
      expect(platform).toHaveLength(3);
      for (const [dc, di] of platform) {
        expect(w.rt.setDoor(di, true)).toBe('opening');
        run(w.h, 2);
        const d = dc.col.door, hug = d.width / 2 - 0.3 - 0.02;
        for (const [name, off, lean] of [['centre', 0, 0], ['jamb-', -hug, 0], ['jamb+', hug, 0], ['diag-', -1.1, 1.1], ['diag+', 1.1, -1.1]] as const) out[`in ${d.x} ${name}`] = walkIn(w, di, off, lean);
        for (const [name, off] of [['centre', 0], ['jamb-', -hug], ['jamb+', hug]] as const) out[`out ${d.x} ${name}`] = walkOut(w, di, off);
      }
      live.splice(live.indexOf(w), 1); w.armor.dispose(); teardown(w.h);
      return out;
    };
    const bare = results(true), armoured = results(false);
    expect(Object.keys(armoured)).toHaveLength(24);
    for (const [k, t] of Object.entries(armoured)) {
      expect(t, `armoured: ${k}`).not.toBeNull();
      expect(bare[k], `bare: ${k}`).not.toBeNull();
      // exactly as on the bare car, frame for frame — also diagonally past the plates' corners (measured: every one of the 24 equal)
      expect(Math.abs(t! - bare[k]!), k).toBeLessThanOrEqual(1e-9);
    }
  }, 120000);

  it('the skirt under a door: a wide body at the height of the LOWEST platform a door can open onto reaches the doorway; one in the bed is stopped at its blades', () => {
    // (the armour's own columns alone, in an open hall: the car's walls / curbs / bridges are world/playerTrain.ts')
    const W = 60, D = 24, grid = new Grid(W, D);
    for (let cy = 0; cy < D; cy++) for (let cx = 0; cx < W; cx++) {
      const i = grid.idx(cx, cy);
      if (cx === 0 || cy === 0 || cx === W - 1 || cy === D - 1) { grid.cells[i] = SOLID; continue; }
      grid.cells[i] = FLOOR; grid.area[i] = 0; grid.floor[i] = 0; grid.ceil[i] = 6;
    }
    const levels = new Levels([{id: 0, role: 'main', grid, baseY: 0}], [], []);
    const pose = {x: 15, z: 6, railTopY: RAIL_TOP_ABOVE_BED, front: 1 as const, level: 0}; // (the hall's floor = the bed)
    const col = armorColliders(pose, L.boxes, 0, 0), index = new PropIndex(levels, col.collide);
    const r = 0.45, K = A.skirt;
    /** From 3.2 m out, 2 m straight at the car on the line x (train-local), feet at `feet` over the rail top: [pushed sideways, the |z| it gets to]. */
    const walk = (x: number, side: -1 | 1, feet: number): [number, number] => {
      let wx = pose.x + x, wz = pose.z + side * 3.2;
      for (let i = 0; i < 100; i++) [wx, wz] = moveCircle(levels, index, wx, wz, 0, -side * 0.02, r, pose.railTopY + feet);
      return [Math.abs(wx - pose.x - x), Math.abs(wz - pose.z)];
    };
    const lowPlatform = SPEC.floorY - TRAIN_CLEAR.maxStep;
    for (const d of SPEC.doors) {
      for (const feet of [lowPlatform, (lowPlatform + SPEC.floorY) / 2, SPEC.floorY]) {
        const [dx, z] = walk(d.x, d.side, feet);
        expect(z, `door ${d.x} side ${d.side}, feet ${feet}`).toBeCloseTo(1.2, 6); // (all the way: nothing of the armour in its way)
        expect(dx, `door ${d.x} side ${d.side}, feet ${feet}`).toBeLessThan(1e-9); // (nor beside it: a body 0.9 m wide in a 1.08 m door)
      }
      // in the bed: stopped at the skirt's blade line under the door
      const [, bed] = walk(d.x, d.side, -RAIL_TOP_ABOVE_BED);
      expect(bed, `door ${d.x}: bed`).toBeGreaterThan(K.back + K.depth + r - 0.01);
      expect(bed, `door ${d.x}: bed`).toBeLessThan(K.back + K.guardDepth + r + 0.01);
      // beside the door, at any platform height: stopped at the plates
      const [, beside] = walk(d.x + d.width / 2 + A.doorGap + 0.5, d.side, lowPlatform);
      expect(beside, `door ${d.x}: beside`).toBeGreaterThan((d.side < 0 ? A.skinNeg : A.skinPos) + A.plate.depth + r - 0.01);
    }
  });

  it('a fuel cart is dragged aboard through a platform door and out again (the plates stand clear of the doorway)', () => {
    const w = world();
    const {h, rt, carts, p} = w;
    const di = rt.train!.doors.findIndex(d => d.col.door.side === -1 && Math.abs(d.col.door.x - 0.182) < 0.01);
    const door = rt.train!.doors[di].col.door;
    const at = trainToWorld(p, door.x, SPEC.floorY, -2.6);
    carts.spawn({uid: 'cart:A', units: FUEL.cartUnits, x: at.x, y: h.levels!.floorAt(at.x, at.z, p.floorY + 0.3), z: at.z, yaw: Math.atan2(0, -p.platformSide), level: p.level});
    rt.setDoor(di, true);
    run(h, 2);
    const stand = trainToWorld(p, door.x, SPEC.floorY, -3.75);
    h.player.place(stand.x, stand.z, Math.atan2(0, -p.front), h.levels!.floorAt(stand.x, stand.z, p.floorY + 0.3));
    frame(h);
    const b = carts.bodyOf('cart:A')!;
    const grab = () => { lookAt(h, b.x + Math.sin(b.yaw) * CART_LOOK.handle.z, b.y + CART_LOOK.handle.y, b.z + Math.cos(b.yaw) * CART_LOOK.handle.z); holdE(h); expect(carts.grab).not.toBeNull(); h.player.pitch = 0; };
    grab();
    h.keys.held.add('KeyW');
    run(h, 4);
    h.keys.held.clear();
    press(h, 'KeyE'); // let go
    const q = worldToTrain(p, b.x, b.y, b.z);
    expect(cartAboard(q.x, q.z, FUEL_CART.ownRadius)).toBe(true);
    expect(b.y).toBeCloseTo(p.floorY, 4);
    expect(carts.cargo().map(c => c.uid)).toEqual(['cart:A']);
    expect(carts.departBlock()).toBeNull();
    grab();
    h.keys.held.add('KeyS');
    run(h, 4);
    h.keys.held.clear();
    press(h, 'KeyE');
    expect(worldToTrain(p, b.x, b.y, b.z).z).toBeLessThan(-SPEC.width / 2 - PORT.cartRadius); // wholly out on the platform
    expect(carts.cargo()).toEqual([]);
  }, 60000);

  it('the fuel cap: its bay stays bare from the floor line to the roof-line rail, and every sight line to it from the platform is open', () => {
    const cap = fuelPortLocal(SPEC), bay = fuelBay(SPEC, -1)!, AIM = FUEL_PORT.aim;
    expect(fuelBay(SPEC, 1)).toBeNull();
    expect(bay).toEqual([cap.x - A.plate.fuelBay, cap.x + A.plate.fuelBay]);
    expect(A.plate.fuelBay).toBeGreaterThanOrEqual(AIM.hx + 0.15);
    for (const p of L.pieces.filter(q => q.kind === 'side' && q.dir === -1 && q.box.x1 > bay[0] + 1e-5 && q.box.x0 < bay[1] - 1e-5)) {
      expect(['skirt', 'guard', 'rail'], `${p.part} in the bay`).toContain(p.part);
      expect(p.box.y1 < SPEC.floorY || p.box.y0 > cap.y + 1, p.part).toBe(true);
    }
    // the eye of a standing / crouching player along the platform edge, up to 1.2 m either side of the cap, to the cap and to the front
    // of its aim box: no armour box in the way (the armour's boxes are what a ray meets)
    let lines = 0;
    for (const ex of [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2]) for (const ez of [EDGE_TO_TRACK + 0.3, EDGE_TO_TRACK + 0.9]) for (const ey of [1.05, 1.62]) {
      const eye = {x: cap.x + ex, y: SPEC.floorY + ey, z: -ez};
      for (const tz of [cap.z, cap.z - AIM.out]) for (const tx of [cap.x - AIM.hx, cap.x, cap.x + AIM.hx]) {
        const d = {x: tx - eye.x, y: cap.y - eye.y, z: tz - eye.z};
        lines++;
        for (const b of L.boxes) expect(rayBox(eye, d, 0, 1, b), `eye ${ex} ${ez} ${ey} -> ${tx.toFixed(2)} ${tz.toFixed(2)}`).toBe(false);
      }
    }
    expect(lines).toBe(168);
    expect(Math.hypot(1.2, EDGE_TO_TRACK + 0.3 + cap.z, 0.72)).toBeLessThan(PORT.reach); // (the widest of them is within the cap's reach)
  });

  it('the sentry turret keeps every line of fire the bare car allowed: no armour box in any line that clears the roof, at every yaw and elevation', () => {
    const DEG = Math.PI / 180, o = {x: 0, y: 0, z: 0}, d = {x: 0, y: 0, z: 0}, RANGE = 40;
    let lines = 0, blocked = 0, first = '', lowest = Infinity;
    const zRail = Math.max(...parts('rail').map(p => Math.max(Math.abs(p.box.z0), Math.abs(p.box.z1))));
    for (let yd = 0; yd < 360; yd += 0.5) {
      const yaw = yd * DEG;
      turretPivot(yaw, SPEC, o);
      // (the elevation stops widened by the cone: a draw at the trigger may leave an aim line at a stop by SENTRY.spread)
      for (let pitch = SENTRY.pitchMin - SENTRY.spread; pitch <= SENTRY.pitchMax + SENTRY.spread + 1e-9; pitch += 0.1 * DEG) {
        barrelDir(yaw, pitch, d);
        // (margin 0: the cone's draws at the trigger — world/sentryTurret.ts fire — the weakest own-roof rule)
        if (!ownHullClear(o, d, RANGE, SPEC, 0)) continue;
        const tx = hullExit(o, d, RANGE, SPEC);
        if (tx === null) continue;
        lines++;
        for (const b of L.boxes) if (rayBox(o, d, tx, RANGE, b)) { blocked++; first ||= `yaw ${yd} pitch ${(pitch / DEG).toFixed(1)} box ${JSON.stringify(b)}`; }
        if (Math.abs(d.z) > 1e-9) {
          const t = ((d.z > 0 ? zRail : -zRail) - o.z) / d.z;
          if (t >= tx && Math.abs(o.x + d.x * t) <= A.rail.end) lowest = Math.min(lowest, o.y + d.y * t);
        }
      }
    }
    expect(lines).toBeGreaterThan(150_000);
    expect(first).toBe('');
    expect(blocked).toBe(0);
    // the lowest line over the roof-line rail's fin tips clears its top (measured: about 2 cm), and the pillars' tops are lower still
    expect(lowest - A.rail.y1).toBeGreaterThan(0.01);
    expect(A.pillar.y1).toBeLessThanOrEqual(A.rail.y1);
    // the brow lies inside the car's plan (no box): under every line over the end
    for (const p of parts('brow')) { expect(Math.max(Math.abs(p.box.x0), Math.abs(p.box.x1))).toBeLessThan(SPEC.length / 2); expect(p.box.y1).toBeLessThan(3.5); }
  });

  it('riding: the car-local collision takes the columns a body on the car floor can meet — never the skirt under the doors, never an overhead box', () => {
    const model = buildRideLocalModel(SPEC);
    setRideArmorBoxes(model, L.boxes);
    const cols = model.cargo!.boxes.get('train-armor')!;
    const want = L.boxes.filter(b => !b.overhead && b.y1 > SPEC.floorY + 0.02);
    expect(cols).toHaveLength(want.length);
    expect(want.length).toBe(parts('plate').length + 2 * (2 * (A.plough.towerSlices + A.plough.wingSlices) + 1));
    setRideArmorBoxes(model, null);
    expect(model.cargo?.boxes.get('train-armor')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
describe('train armour makeover: existing armoured saves', () => {
  it('the record of a train armoured with the first kit shows the new kit on load: no craft, no new field, the rest of the record untouched', () => {
    const w = world({bare: true, models: true});
    const {h, rt, armor} = w;
    const part = h.playerTrain.participant(), bareSave = part.save() as Record<string, unknown>;
    expect(bareSave.upgrades).toBeUndefined();
    expect(armor.shown).toBe(false);
    // what the first kit saved for an armoured train: the same record + the upgrades key (run/trainUpgrades.ts, version 1)
    const old = {...structuredClone(bareSave), upgrades: {v: 1, fitted: ['armor']}};
    part.load(structuredClone(old));
    frame(h);
    expect(armor.installed('armor')).toBe(true);
    expect(armor.counts.installs).toBe(0); // (not crafted: the record brought it)
    expect(armor.shown).toBe(true);
    expect([...armor.meshes.values()].reduce((n, m) => n + (m.visible ? m.count : 0), 0)).toBe(L.pieces.length);
    expect(armor.meshes.size).toBe(9);
    expect(rt.armorFitted()).toBe(true);
    expect(rt.train!.col.armor.shoot).toHaveLength(L.boxes.length);
    expect(armor.block('armor')).toBe(ARMOR_TEXT.fitted); // (nothing to craft again)
    // and it saves back exactly what was loaded
    expect(part.save()).toEqual(old);
    expect(armorLayout(SPEC)).toEqual(L);
  });
});
