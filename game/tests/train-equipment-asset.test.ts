// Task studio-train-crafting-v1-20261111-225628-01 (lane ASSET): the train crafting equipment's runtime models — the crafting bench
// (assets/models/train-bench.glb), the three device modules that stand on the existing hand truck (train-radar / train-sentry /
// train-scanner) and the sentry's roof turret (train-turret) — Meshy T2.5 image-to-3D derivatives of one Codex design image each
// (Codex -> Meshy; Meshy's own PBR maps kept, re-encoded), cooked by tools/asset-pipeline/props/build-train-equipment.mjs.
// Checks the contract the runtime builds on (assets/trainEquipment.generated.ts): the model frames (grounded, centred, baked), one PBR
// material with all three maps, the triangle / byte budgets, the measured constants really describe the meshes (the bench's worktop and
// free strip, each module's fit on the REAL hand truck inside the dolly's footprint circle, the turret's three nodes, tilt pivot and
// muzzle), the bench fits the car (craft/trainFixtures.ts benchPlacement), the car's model catalogue carries all five, and provenance /
// CREDITS / the release allowlist bind the exact bytes (raw master hashes pinned; the masters stay outside Git).
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {TRAIN_BENCH_MEASURED, TRAIN_EQUIPMENT_MODELS, TRAIN_MODULE_MEASURED, TRAIN_TURRET_MEASURED} from '../src/assets/trainEquipment.generated';
import {BENCH_AISLE_MIN, BENCH_CLEAR, benchFootprint, benchPlacement} from '../src/craft/trainFixtures';
import {EQUIPMENT} from '../src/craft/equipment';
import {PORT} from '../src/fuel/trainPort';
import {P7_MODELS} from '../src/gen/props07.catalog';
import {CART_LOOK} from '../src/world/fuelCartModel';
import {PLAYER_TRAIN_MODEL_FILES} from '../src/world/playerTrain';
import {PARTITION_HALF, PLAYER_TRAIN_SPEC} from '../src/world/playerTrainSpec';
import {levelOfAsset} from '../src/assets/levelAssets';

const SIDECAR = 'assets/derivatives/train-equipment.json';
const KEYS = ['bench', 'radar', 'sentry', 'scanner', 'turret'] as const;
const MODULES = ['radar', 'sentry', 'scanner'] as const;
type Key = typeof KEYS[number];
/** The accepted Meshy originals (outside Git). */
const RAW_SHA: Record<Key, string> = {
  bench: 'f29d3cfe98490d904f66bde93c99787ac3899594d61edf90f11895f59a7fcdce',
  radar: 'dcbd8a6176acb4be0dd781f832b0080557fe3b4398048beef068827763edcf5c',
  sentry: 'b43cda1dd459362e31f2074b9b913ecd00c4d4c99abc7df4b1b103e8f79f5ae0',
  scanner: '1cb62af770ac0b576f1fc09f4c673906f00ef7bda10ab97d59ae659b6c37f3d8',
  turret: '64e61b603f301d96c2b3b334af7e757b2303c3853787997b1609debb0fc4ecf0',
};
const APPROVAL = 'task-specific user generation approval (sha256 f25194e0c4819825aa43bc513c0f16203807df2da10c8026ccc5d558f1194a2e): the bench, three modules and roof turret, up to 150 Meshy credits';
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type V3 = [number, number, number];
type Tri = [V3, V3, V3];
/** A model's bytes, document and triangles in the scene frame (node transforms applied), all together and per mesh node. */
async function load(url: string) {
  const bytes = readFileSync(pub(url));
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
  const tris: Tri[] = [], parts = new Map<string, Tri[]>();
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const M = n.getWorldMatrix(), own: Tri[] = [];
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute('POSITION')!.getArray()!, I = p.getIndices()!.getArray()!;
      const at = (i: number): V3 => {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
      };
      for (let t = 0; t < I.length; t += 3) own.push([at(I[t]), at(I[t + 1]), at(I[t + 2])]);
    }
    parts.set(n.getName(), own);
    for (const t of own) tris.push(t);
  }
  const root = doc.getRoot(), b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
  return {bytes, doc, tris, parts, b, dims: [0, 1, 2].map(k => b.max[k] - b.min[k])};
}
/** Points on the triangles, no farther apart than `step` (corners included). */
function samples(tris: Tri[], step: number): V3[] {
  const out: V3[] = [];
  for (const [a, b, c] of tris) {
    const L = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
    const n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      out.push([a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v]);
    }
  }
  return out;
}
const lo = <T>(a: T[], f: (v: T) => number) => { let m = Infinity; for (const v of a) { const x = f(v); if (x < m) m = x; } return m; };
const hi = <T>(a: T[], f: (v: T) => number) => { let m = -Infinity; for (const v of a) { const x = f(v); if (x > m) m = x; } return m; };
/** Nearest hit distance of the ray o + t d (t > 0) against the triangles (Moller-Trumbore), or Infinity. */
function cast(tris: Tri[], o: V3, d: V3): number {
  let best = Infinity;
  for (const [a, b, c] of tris) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > 1e-6 && t < best) best = t;
  }
  return best;
}
type Loaded = Awaited<ReturnType<typeof load>>;
/** The shared model contract: the generated bytes / triangles / size, the budgets, grounded, one opaque PBR material with the three JPEG maps. */
function expectCooked(key: Key, m: Loaded) {
  const G = TRAIN_EQUIPMENT_MODELS[key];
  expect(G.url).toBe(`assets/models/train-${key}.glb`);
  expect(G.key).toBe(`train-${key}`);
  expect(m.bytes.length).toBe(G.bytes);
  expect(m.bytes.length).toBeLessThan(1.45e6); // the ~1.4 MB aim per model
  expect(m.tris.length).toBe(G.tris);
  expect(m.tris.length).toBeLessThan(20000); // Smart Topology's approved target; no simplification
  m.dims.forEach((v, k) => expect(v).toBeCloseTo(G.dims[k], 4));
  expect(Math.abs(m.b.min[1])).toBeLessThan(1e-4); // grounded: min y = 0
  const mats = m.doc.getRoot().listMaterials();
  expect(mats).toHaveLength(1);
  expect(mats[0].getAlphaMode()).toBe('OPAQUE');
  const maps = {baseColor: mats[0].getBaseColorTexture(), metallicRoughness: mats[0].getMetallicRoughnessTexture(), normal: mats[0].getNormalTexture()};
  for (const [slot, t] of Object.entries(maps)) {
    expect(t, `${key} ${slot}`).not.toBeNull();
    expect(t!.getMimeType()).toBe('image/jpeg');
    expect(t!.getSize()).toEqual([...G.textures[slot as keyof typeof maps]]);
  }
  for (const mesh of m.doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) expect(p.getMaterial()).toBe(mats[0]);
}

describe('train crafting equipment models (bench, device modules, roof turret)', () => {
  it('bench: the cooked frame and size, a real worktop at the measured height with a free strip, bolted fixtures only, the lower shelf', async () => {
    const m = await load(TRAIN_EQUIPMENT_MODELS.bench.url);
    expectCooked('bench', m);
    const B = TRAIN_BENCH_MEASURED, {b, dims, tris} = m;
    expect(B.size).toEqual({l: r3(dims[0]), h: r3(dims[1]), d: r3(dims[2])});
    expect(B.size.l).toBeCloseTo(1.02, 3); // the rear compartment's bench pocket
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(2e-3); // centred
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(2e-3);
    for (const n of m.doc.getRoot().listNodes()) expect(n.getMatrix()).toEqual(IDENTITY); // baked
    expect(m.doc.getRoot().listMeshes()).toHaveLength(1);
    // a standing-height work surface (prop rule 5: bench tops 0.78-0.95 m; fixtures on top stay under ~1.4 m)
    expect(B.worktopY).toBeGreaterThanOrEqual(0.78);
    expect(B.worktopY).toBeLessThanOrEqual(0.95);
    expect(B.size.h).toBeLessThanOrEqual(1.4);
    // the free strip is inside the worktop, a usable size, at the front (+Z: the side the player stands at)
    const F = B.free, W = B.worktop;
    expect(F.x0).toBeGreaterThanOrEqual(W.x0); expect(F.x1).toBeLessThanOrEqual(W.x1);
    expect(F.z0).toBeGreaterThanOrEqual(W.z0); expect(F.z1).toBeLessThanOrEqual(W.z1);
    expect(F.x1 - F.x0).toBeGreaterThan(0.5);
    expect(F.z1 - F.z0).toBeGreaterThan(0.2);
    expect((F.z0 + F.z1) / 2).toBeGreaterThan(0);
    expect(W.x0).toBeGreaterThan(b.min[0] - 1e-3); expect(W.x1).toBeLessThan(b.max[0] + 1e-3);
    // looking straight down anywhere in the free strip the first surface is the worktop: nothing stands (or is baked) there
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      const x = F.x0 + 0.02 + (F.x1 - F.x0 - 0.04) * i / 5, z = F.z0 + 0.02 + (F.z1 - F.z0 - 0.04) * j / 2;
      const y = b.max[1] + 0.1 - cast(tris, [x, b.max[1] + 0.1, z], [0, -1, 0]);
      expect(Math.abs(y - B.worktopY), `worktop under (${r3(x)}, ${r3(z)})`).toBeLessThan(0.008);
    }
    // the bolted-down fixtures rise over it: the vise at the -X end is the model's top, the grinder / gauge box behind the free strip
    const top = (x: number, z: number) => b.max[1] + 0.1 - cast(tris, [x, b.max[1] + 0.1, z], [0, -1, 0]);
    expect(hi(tris.flat().filter(q => q[0] < F.x0), q => q[1])).toBeCloseTo(B.size.h, 3);
    expect(top(0.08, -0.06)).toBeGreaterThan(B.worktopY + 0.1); // the grinder
    expect(top(0.3, -0.03)).toBeGreaterThan(B.worktopY + 0.1); // the gauge box
    // the lower shelf under the top
    expect(B.shelfY).toBeGreaterThan(0.1);
    expect(B.shelfY).toBeLessThan(B.worktopY - 0.4);
    const shelf = [-0.25, 0, 0.25].flatMap(x => [-0.12, 0, 0.12].map(z => B.worktopY - 0.15 - cast(tris, [x, B.worktopY - 0.15, z], [0, -1, 0])));
    expect(shelf.filter(y => Math.abs(y - B.shelfY) < 0.012).length, `shelf hits ${shelf.map(r3)}`).toBeGreaterThanOrEqual(7);
  }, 60_000);

  it('bench: fits the car\'s rear compartment at the cooked size (craft/trainFixtures.ts benchPlacement)', () => {
    const spec = PLAYER_TRAIN_SPEC, p = benchPlacement(spec), B = TRAIN_BENCH_MEASURED;
    expect(p).not.toBeNull();
    expect(p).toMatchObject({length: B.size.l, height: B.size.h, depth: B.size.d, worktopY: B.worktopY, floorY: spec.floorY});
    const f = benchFootprint(p!), hw = spec.interior.halfWidth, rear = spec.rear!;
    expect(f.x0).toBeGreaterThanOrEqual(rear.x0 + BENCH_CLEAR - 1e-6);
    expect(f.x1).toBeLessThanOrEqual(rear.x1 - PARTITION_HALF - BENCH_CLEAR + 1e-6);
    expect(Math.max(Math.abs(f.z0), Math.abs(f.z1))).toBeLessThanOrEqual(hw - BENCH_CLEAR + 1e-6);
    // the aisle between the bench's front and the Lockbox's front
    const lockFront = spec.lockbox ? Math.abs(spec.lockbox.z) - spec.lockbox.depth / 2 : hw;
    expect(Math.min(Math.abs(f.z0), Math.abs(f.z1)) + lockFront).toBeGreaterThanOrEqual(BENCH_AISLE_MIN);
    // under the car's ceiling with the fixtures on top
    expect(spec.floorY + B.size.h).toBeLessThan(spec.ceilingY - 0.3);
  });

  it('device modules: cooked frames, and each one stands on the REAL hand truck — clear of its uprights, inside the dolly\'s footprint circle and clear height', async () => {
    // the dolly frame the cook measured against (world/fuelCartModel.ts places the truck model at (0, 0, truckZ); fuel/trainPort.ts)
    expect(CART_LOOK.truckZ).toBeCloseTo(-0.071268, 6);
    expect(CART_LOOK.plateTop).toBe(0.073);
    expect(CART_LOOK.urls.truck).toBe(P7_MODELS.handTruck.url);
    expect(PORT.cartRadius).toBe(0.36);
    const truck = await load(CART_LOOK.urls.truck);
    const tS = samples(truck.tris, 0.002).map(q => [q[0], q[1], q[2] + CART_LOOK.truckZ] as V3);
    const CELL = 0.004, cell = (q: V3) => `${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`;
    const truckFront = new Map<string, number>(); // the truck's frontmost z per (x, y) cell above its nose plate
    for (const q of tS) if (q[1] > CART_LOOK.plateTop + 0.003) { const k = cell(q); if (q[2] > (truckFront.get(k) ?? -Infinity)) truckFront.set(k, q[2]); }
    const truckRadius = hi(tS, q => Math.hypot(q[0], q[2]));
    expect(truckRadius).toBeLessThan(0.4); // (the existing truck's wheels alone reach past the 0.36 m circle; not this cook's to change)
    for (const kind of MODULES) {
      const m = await load(TRAIN_EQUIPMENT_MODELS[kind].url);
      expectCooked(kind, m);
      const M = TRAIN_MODULE_MEASURED[kind], {b, dims, tris} = m, E = EQUIPMENT[kind];
      for (const n of m.doc.getRoot().listNodes()) expect(n.getMatrix()).toEqual(IDENTITY); // baked
      expect(m.doc.getRoot().listMeshes()).toHaveLength(1);
      expect(M.size, kind).toEqual({w: r3(dims[0]), h: r3(dims[1]), d: r3(dims[2])});
      expect(M.bounds, kind).toEqual({x0: r3(b.min[0]), x1: r3(b.max[0]), z0: r3(b.min[2]), z1: r3(b.max[2])});
      const S = samples(tris, 0.002);
      // origin = the bottom centre of the CABINET's footprint (handles, leads, antenna bars reach past it)
      const foot = S.filter(q => q[1] <= 0.05 * dims[1]);
      const fx0 = lo(foot, q => q[0]), fx1 = hi(foot, q => q[0]), fz0 = lo(foot, q => q[2]), fz1 = hi(foot, q => q[2]);
      expect(Math.abs(fx0 + fx1) / 2, `${kind} footprint centre x`).toBeLessThan(2e-3);
      expect(Math.abs(fz0 + fz1) / 2, `${kind} footprint centre z`).toBeLessThan(2e-3);
      expect(fx1 - fx0).toBeCloseTo(M.footprint.w, 2);
      expect(fz1 - fz0).toBeCloseTo(M.footprint.d, 2);
      // mounted: origin at (0, plate top, mountZ) in the dolly frame
      const D = S.map(q => [q[0], q[1] + CART_LOOK.plateTop, q[2] + M.mountZ] as V3);
      const back = new Map<string, number>(); // the module's rearmost z per (x, y) cell
      for (const q of D) { const k = cell(q); if (q[2] < (back.get(k) ?? Infinity)) back.set(k, q[2]); }
      let gap = Infinity;
      for (const [k, z] of back) {
        const [i, j] = k.split(',').map(Number);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const t = truckFront.get(`${i + di},${j + dj}`); if (t !== undefined && z - t < gap) gap = z - t; }
      }
      expect(gap, `${kind}: clearance in front of the truck's uprights`).toBeGreaterThanOrEqual(0.003); // never through the truck
      expect(gap, `${kind}: stands against the uprights`).toBeLessThan(0.008); // ... and not floating out on the plate
      // inside the footprint circle the fuel dolly uses (a whip aerial may reach 0.40 m), and the dolly's body height
      const radius = hi(D.filter(q => q[1] - CART_LOOK.plateTop <= M.bodyTop + 1e-6), q => Math.hypot(q[0], q[2]));
      expect(radius).toBeCloseTo(M.radius, 2);
      expect(radius, `${kind}: plan radius`).toBeLessThanOrEqual(PORT.cartRadius);
      expect(E.radius).toBe(PORT.cartRadius);
      expect(hi(D, q => Math.hypot(q[0], q[2])), `${kind}: plan radius with the whip`).toBeLessThanOrEqual(0.4);
      expect(M.bodyTop).toBeLessThanOrEqual(M.size.h);
      expect(CART_LOOK.plateTop + M.bodyTop, `${kind}: body under the truck's handle`).toBeLessThanOrEqual(CART_LOOK.height);
      expect(CART_LOOK.plateTop + M.size.h, `${kind}: inside the device's clear height`).toBeLessThanOrEqual(E.height);
      expect(CART_LOOK.plateTop + M.size.h, `${kind}: a hip-to-chest-high cabinet`).toBeGreaterThan(0.9);
      // the module's base stands on the plate (its front edge may overhang the plate's nose like the fuel drum does)
      expect(M.mountZ - M.footprint.d / 2).toBeGreaterThan(CART_LOOK.truckZ + P7_MODELS.handTruck.surfaces[0].z0 - 1e-3);
      expect(M.mountZ + M.footprint.d / 2 - (CART_LOOK.truckZ + P7_MODELS.handTruck.surfaces[0].z1)).toBeLessThan(0.06);
      // the console face: a band on the +Z front the player aims at
      expect(M.face.y0).toBeGreaterThanOrEqual(0);
      expect(M.face.y1).toBeLessThanOrEqual(M.bodyTop);
      expect(M.face.y1 - M.face.y0).toBeGreaterThan(0.4);
      for (const f of [0.25, 0.5, 0.75]) {
        const y = M.face.y0 + (M.face.y1 - M.face.y0) * f, z = b.max[2] + 0.5 - cast(tris, [0, y, b.max[2] + 0.5], [0, 0, -1]);
        expect(z, `${kind}: face at y ${r3(y)}`).toBeGreaterThan(M.footprint.d / 2 - 0.06);
      }
    }
  }, 120_000);

  it('turret: three nodes (fixed base, yawing yoke, tilting head at the pivot) sharing one material; the muzzle and the tilt convention', async () => {
    const m = await load(TRAIN_EQUIPMENT_MODELS.turret.url);
    expectCooked('turret', m);
    const T = TRAIN_TURRET_MEASURED, root = m.doc.getRoot(), {b, dims} = m;
    const node = (name: string) => root.listNodes().find(n => n.getName() === name)!;
    expect(root.listNodes().map(n => n.getName()).sort()).toEqual(['turret-base', 'turret-head', 'turret-yoke']);
    const base = node('turret-base'), yoke = node('turret-yoke'), head = node('turret-head');
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    expect(scene.listChildren().map(n => n.getName()).sort()).toEqual(['turret-base', 'turret-yoke']);
    expect(yoke.listChildren().map(n => n.getName())).toEqual(['turret-head']);
    expect(head.listChildren()).toHaveLength(0);
    expect(base.getMatrix()).toEqual(IDENTITY); // the yaw axis is the origin's +Y
    expect(yoke.getMatrix()).toEqual(IDENTITY);
    expect(T.pitch).toBe(true);
    expect(head.getTranslation().map(r3)).toEqual([T.pitchPivot.x, T.pitchPivot.y, T.pitchPivot.z]);
    expect(head.getRotation()).toEqual([0, 0, 0, 1]);
    expect(head.getScale()).toEqual([1, 1, 1]);
    for (const n of [base, yoke, head]) expect(n.getMesh()!.listPrimitives()).toHaveLength(1);
    expect(T.size).toEqual({l: r3(dims[2]), h: r3(dims[1]), w: r3(dims[0])});
    // every shell of the raw mesh is in exactly one part (+ the two caps on the yoke's rear arm plates)
    const prov = JSON.parse(readFileSync(pub(SIDECAR), 'utf8')).models.find((e: {id: string}) => e.id === 'train-turret');
    const split = prov.measured.split, caps = prov.measured.caps;
    const P = {base: m.parts.get('turret-base')!, yoke: m.parts.get('turret-yoke')!, head: m.parts.get('turret-head')!};
    expect([P.base.length, P.yoke.length, P.head.length]).toEqual([split.base[1], split.yoke[1] + caps.triangles, split.head[1]]);
    expect(split.base[0] + split.yoke[0] + split.head[0]).toBe(split.shells);
    expect(split.mirrorMismatch).toBe(0);
    expect(prov.source.triangles + caps.triangles).toBe(m.tris.length);
    expect(caps.triangles).toBeLessThan(100);
    // the base ring: on the mounting plane, centred on the yaw axis, under everything that turns
    const pb = P.base.flat(), py = P.yoke.flat(), ph = P.head.flat();
    expect(Math.abs(lo(pb, q => q[1]))).toBeLessThan(1e-4);
    expect(Math.abs(lo(pb, q => q[0]) + hi(pb, q => q[0])) / 2).toBeLessThan(2e-3);
    expect(Math.abs(lo(pb, q => q[2]) + hi(pb, q => q[2])) / 2).toBeLessThan(2e-3);
    expect(hi(pb, q => Math.hypot(q[0], q[2]))).toBeCloseTo(T.baseRadius, 3);
    expect(hi([...py, ...ph], q => Math.hypot(q[0], q[2]))).toBeCloseTo(T.swingRadius, 3);
    expect(lo(ph, q => q[1])).toBeGreaterThan(hi(pb, q => q[1])); // the gun rides over the base ring
    // the muzzle: the barrel tip's centre, the model's +Z end, on the middle plane, in front of and above the tilt axis
    const tip = ph.filter(q => q[2] > b.max[2] - 0.004);
    expect(T.muzzle.z).toBeCloseTo(b.max[2], 3);
    expect(T.muzzle.z).toBeCloseTo(hi(ph, q => q[2]), 3);
    expect((lo(tip, q => q[0]) + hi(tip, q => q[0])) / 2).toBeCloseTo(T.muzzle.x, 2);
    expect((lo(tip, q => q[1]) + hi(tip, q => q[1])) / 2).toBeCloseTo(T.muzzle.y, 2);
    expect(Math.abs(T.muzzle.x)).toBeLessThan(0.005);
    expect(T.muzzle.z - T.pitchPivot.z).toBeGreaterThan(0.5);
    expect(T.muzzle.y).toBeGreaterThan(T.pitchPivot.y);
    // the convention the runtime uses, on real three.js nodes: yoke.rotation.y = yaw, head.rotation.x = tilt, POSITIVE = muzzle DOWN
    const gy = new THREE.Group(), gh = new THREE.Group();
    gh.position.set(T.pitchPivot.x, T.pitchPivot.y, T.pitchPivot.z);
    gy.add(gh);
    const at = (yaw: number, tilt: number, q: {x: number; y: number; z: number}) => {
      gy.rotation.y = yaw; gh.rotation.x = tilt; gy.updateMatrixWorld(true);
      return new THREE.Vector3(q.x - T.pitchPivot.x, q.y - T.pitchPivot.y, q.z - T.pitchPivot.z).applyMatrix4(gh.matrixWorld);
    };
    const rest = at(0, 0, T.muzzle), down = at(0, 20 * Math.PI / 180, T.muzzle), turned = at(Math.PI / 2, 0, T.muzzle);
    expect(rest.x).toBeCloseTo(T.muzzle.x, 6); expect(rest.y).toBeCloseTo(T.muzzle.y, 6); expect(rest.z).toBeCloseTo(T.muzzle.z, 6);
    expect(down.y).toBeLessThan(rest.y - 0.15);
    expect(turned.x).toBeCloseTo(T.muzzle.z, 3); // yaw +90 deg: the muzzle points along +X
    // the measured tilt range: the head clears the yoke down to pitchClear.down; over a flat mounting plane the barrel tip stays above it
    // down to pitchClear.overPlane
    expect(T.pitchClear.down).toBeGreaterThanOrEqual(30);
    expect(T.pitchClear.up).toBeGreaterThanOrEqual(0);
    expect(T.pitchClear.overPlane).toBeGreaterThanOrEqual(20);
    expect(T.pitchClear.overPlane).toBeLessThanOrEqual(T.pitchClear.down);
    const lowest = (deg: number) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return lo(ph, q => T.pitchPivot.y + (q[1] - T.pitchPivot.y) * c - (q[2] - T.pitchPivot.z) * s); };
    expect(lowest(T.pitchClear.overPlane)).toBeGreaterThanOrEqual(0.01 - 1e-6);
    expect(lowest(0)).toBeCloseTo(lo(ph, q => q[1]), 9);
  }, 60_000);

  it('all five are in the car\'s model catalogue (shared by every level that parks the train)', () => {
    for (const key of KEYS) {
      const G = TRAIN_EQUIPMENT_MODELS[key];
      expect(PLAYER_TRAIN_MODEL_FILES[G.key], key).toEqual({url: G.url, bytes: G.bytes});
      expect(levelOfAsset(G.url), key).toBeNull();
    }
  });

  it('provenance, CREDITS and the release allowlist bind the exact bytes (hash-only, no prompts / URLs / private paths)', () => {
    const side = readFileSync(pub(SIDECAR)), credits = readFileSync(pub('assets/CREDITS.md'));
    const prov = JSON.parse(side.toString());
    expect(prov).toMatchObject({
      schema: 'terminal-state-derivative-v1', id: 'train-equipment', accepted: true, approval: APPROVAL,
      budget: {generations: 5, paidRequests: 5, billedCredits: 75, creditsPerModel: 15, caps: {credits: 150}},
    });
    expect(prov.route).toMatch(/Codex .*-> Meshy T2\.5 image-to-3D.*own PBR maps kept/);
    expect(prov.texturePolicy).toMatch(/no reprojection \/ retexture \/ repaint/);
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature|X-Amz|token=|\/workspaces\/|\/home\/|prompt/i);
    expect(prov.models.map((e: {id: string}) => e.id)).toEqual(KEYS.map(k => `train-${k}`));
    const truck = readFileSync(pub(P7_MODELS.handTruck.url));
    expect(prov.handTruck).toMatchObject({url: P7_MODELS.handTruck.url, bytes: truck.length, sha256: sha(truck), dollyFrame: {plateTop: CART_LOOK.plateTop, footprintRadius: PORT.cartRadius}});
    expect(prov.handTruck.dollyFrame.truckZ).toBeCloseTo(CART_LOOK.truckZ, 6);
    const files: [string, Buffer][] = [[SIDECAR, side], ['assets/CREDITS.md', credits]];
    for (const key of KEYS) {
      const G = TRAIN_EQUIPMENT_MODELS[key], bytes = readFileSync(pub(G.url)), e = prov.models.find((x: {id: string}) => x.id === G.key);
      files.push([G.url, bytes]);
      expect(e.output, key).toMatchObject({url: G.url, bytes: bytes.length, sha256: sha(bytes), triangles: G.tris});
      expect(e.output.dims).toEqual([...G.dims]);
      expect(e.source.sha256, key).toBe(RAW_SHA[key]);
      expect(e.conditioningImage.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.meshy, key).toMatchObject({status: 'SUCCEEDED', billedCredits: 15, attempt: 1, request: {ai_model: 'meshy-t2.5', should_texture: true, enable_pbr: true}});
      expect(e.meshy.request.file_path).toBeUndefined();
      expect(e.textures.map((t: {slot: string}) => t.slot)).toEqual(['baseColor', 'metallicRoughness', 'normal']);
      for (const t of e.textures as {slot: 'baseColor' | 'metallicRoughness' | 'normal'; size: number[]; mime: string}[]) {
        expect(t.size).toEqual([...G.textures[t.slot]]);
        expect(t.mime).toBe('image/jpeg');
      }
      expect(e.convention).toMatch(key === 'turret' ? /\+Z = the muzzle at rest/ : key === 'bench' ? /\+Z = the front/ : /\+Z = the console face/);
      expect(credits.toString()).toContain(`\`${G.url}\``);
    }
    // the generated constants are the provenance's measurements
    const of = (key: Key) => prov.models.find((x: {id: string}) => x.id === `train-${key}`).measured;
    expect(of('bench')).toMatchObject(TRAIN_BENCH_MEASURED);
    expect(of('bench').looseItems).toMatchObject({found: 0, strayRaisedCm2: 0}); // prop rule 4: nothing loose is baked into the bench
    for (const kind of MODULES) expect(of(kind), kind).toMatchObject(TRAIN_MODULE_MEASURED[kind]);
    expect(of('turret')).toMatchObject(TRAIN_TURRET_MEASURED);
    expect(credits.toString()).toContain('<!-- BEGIN train-equipment-models (build-train-equipment.mjs) -->');
    expect(credits.toString()).toContain('<!-- END train-equipment-models -->');
    const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    for (const [p, b] of files) expect(allow.get(p), p).toEqual({path: p, bytes: b.length, sha256: sha(b)});
  });
});
