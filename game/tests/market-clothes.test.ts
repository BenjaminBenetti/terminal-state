// Task studio-market-bar-20261108-225231-01 (lane SHELVES; user: "Clothesline z-fighting / flat squares: hang existing actual clothing
// models instead."): the market's laundry lines (layout versions 2 / 3) hang REAL garments — the market cast's own wearables
// (market-human-cast.glb, read only) — instanced per type, pegged to the line, wholly over the open lane, above the catwalk walkers'
// heads, neighbours never overlapping (no z-fighting), no planes; seeded and deterministic; a bounded number of draw calls.
import {beforeAll, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {installCanvasShim} from './helpers/canvas2d';
import {generateMarketLevel} from '../src/gen/market/index';
import {settleLines, type MarketLine} from '../src/gen/market/v2/art';
import {SETTLE} from '../src/gen/market/v2/frame';
import type {StationLayout} from '../src/gen/stationTypes';
import {MARKET_HUMAN_KEY, MARKET_HUMAN_MODEL_FILES} from '../src/market/humanLooks';
import {LAUNDRY, LAUNDRY_GARMENTS, buildLaundry, garmentDims, garmentMesh, hungMatrix, laundryOpenAt, planLaundry, staticGarment, type GarmentDims} from '../src/world/marketClothes';
import {MarketVisuals, buildMarketView} from '../src/world/marketVisuals';

installCanvasShim(false);
const PUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
async function loadStripped(rel: string): Promise<GLTF> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path.join(PUB, rel));
  for (const t of doc.getRoot().listTextures()) t.dispose(); // (node has no image decoder)
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

const SEEDS = [1, 42, 77, 4242, 9001];
const layouts = new Map<number, StationLayout>();
const L = (seed: number) => { let x = layouts.get(seed); if (!x) layouts.set(seed, (x = generateMarketLevel({levelSeed: seed}))); return x; };
let gltf: GLTF;
let dims: GarmentDims[];
beforeAll(async () => {
  gltf = await loadStripped(MARKET_HUMAN_MODEL_FILES[MARKET_HUMAN_KEY].url);
  dims = LAUNDRY_GARMENTS.map(g => garmentDims(g, staticGarment(garmentMesh(gltf, g)!)));
});

const lineY = (l: MarketLine, t: number) => l.y - l.sag * 4 * t * (1 - t);
const fileHash = (g: GLTF) => {
  const h = createHash('sha256');
  g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && o.name.startsWith('Wear_')) { h.update(o.name); h.update(Buffer.from((m.geometry.attributes.position.array as Float32Array).buffer)); h.update(String((m.material as THREE.Material).side)); } });
  return h.digest('hex');
};

describe('market laundry: the garments', () => {
  it('ordinary garments of the market cast (tops and trousers: no coat, no headwear, nothing else), each a real 3D model', () => {
    const cast = gltf.scene.userData.marketHumans as {wearables: {id: string; slot: string}[]};
    for (const g of LAUNDRY_GARMENTS) {
      const w = cast.wearables.find(x => x.id === g.wearable)!;
      expect(w, g.id).toBeDefined();
      expect(['upper', 'lower']).toContain(w.slot);
      expect(g.hang).toBe(w.slot === 'upper' ? 'shoulders' : 'waist');
      expect(g.wearable).not.toBe('coat');
      const m = garmentMesh(gltf, g)!;
      expect(m, g.id).not.toBeNull();
      const geo = staticGarment(m);
      expect(geo.attributes.position.count, g.id).toBeGreaterThan(1500);
      const s = geo.boundingBox!.getSize(new THREE.Vector3());
      expect(Math.min(s.x, s.y, s.z), `${g.id}: not a plane`).toBeGreaterThan(0.2);
      expect(geo.getAttribute('skinIndex')).toBeUndefined(); // (a static copy: no skin)
      // a top hangs about 0.6-0.8 m below the line, trousers about a metre
      const d = dims.find(x => x.id === g.id)!;
      const drop = d.hang[1] - d.min[1];
      if (g.hang === 'shoulders') { expect(drop).toBeGreaterThan(0.5); expect(drop).toBeLessThan(0.85); } else { expect(drop).toBeGreaterThan(0.85); expect(drop).toBeLessThan(1.05); }
    }
  });
});

describe('market laundry: hung on the lines', () => {
  it('every laundry line carries garments; each over the open lane, below its line, above LAUNDRY.minY, its pegs on the line', () => {
    const geos = new Map(LAUNDRY_GARMENTS.map(g => [g.id, staticGarment(garmentMesh(gltf, g)!)] as const));
    let total = 0;
    for (const seed of SEEDS) {
      const lay = L(seed), lines = settleLines(lay), plan = planLaundry(lay, lines, dims);
      const withLaundry = lines.filter(l => l.laundry).length;
      const used = new Set(plan.map(p => p.line));
      expect(used.size, `seed ${seed}`).toBeGreaterThanOrEqual(Math.min(withLaundry, Math.ceil(withLaundry * 0.8)));
      total += plan.length;
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      for (const p of plan) {
        const l = lines[p.line], d = dims.find(x => x.id === p.garment)!, run = Math.hypot(l.x1 - l.x0, l.z1 - l.z0);
        expect(l.laundry).toBe(true);
        hungMatrix(p, d, m);
        // its box's corners over the open lane (open from the lane floor to the shed roof)
        for (const cx of [d.min[0], d.max[0]]) for (const cy of [d.min[1], d.max[1]]) for (const cz of [d.min[2], d.max[2]]) {
          v.set(cx, cy, cz).applyMatrix4(m);
          expect(laundryOpenAt(lay, v.x, v.z), `${seed} ${p.garment} corner over the open lane`).toBe(true);
        }
        // its real vertices: never below LAUNDRY.minY, never more than the collar above the line where they are
        const pos = geos.get(p.garment)!.attributes.position;
        let lo = Infinity, above = -Infinity;
        for (let i = 0; i < pos.count; i += 2) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          const s = ((v.x - l.x0) * (l.x1 - l.x0) + (v.z - l.z0) * (l.z1 - l.z0)) / run;
          lo = Math.min(lo, v.y); above = Math.max(above, v.y - lineY(l, Math.max(0, Math.min(1, s / run))));
        }
        expect(lo, `${seed} ${p.garment} bottom`).toBeGreaterThanOrEqual(LAUNDRY.minY - 1e-3);
        expect(lo).toBeGreaterThan(SETTLE.bases[1] + 1.2 - 1e-3); // (over a catwalk walker's head)
        expect(lo).toBeGreaterThanOrEqual(p.bottom - 1e-3);
        expect(above, `${seed} ${p.garment} above its line`).toBeLessThanOrEqual(LAUNDRY.shoulderDrop + 0.05); // (only the collar / waistband edge)
        expect(above, `${seed} ${p.garment} hangs from it`).toBeGreaterThan(0);
        // the hang point and both pegs on the sagging line
        expect(Math.abs(p.y - lineY(l, p.t))).toBeLessThan(1e-3);
        expect(p.pegs.length).toBe(2);
        for (const q of p.pegs) {
          const s = ((q.x - l.x0) * (l.x1 - l.x0) + (q.z - l.z0) * (l.z1 - l.z0)) / run, t = s / run;
          const off = Math.abs((q.x - l.x0) * (l.z1 - l.z0) - (q.z - l.z0) * (l.x1 - l.x0)) / run;
          expect(off, 'peg on the line (plan view)').toBeLessThan(1e-3);
          expect(Math.abs(q.y - lineY(l, t)), 'peg on the line (height)').toBeLessThan(0.01);
        }
      }
    }
    expect(total).toBeGreaterThanOrEqual(SEEDS.length * 8);
  });

  it('no z-fighting: neighbours on a line never overlap (their real vertices along the line stay LAUNDRY.gap apart); nothing coplanar', () => {
    const geos = new Map(LAUNDRY_GARMENTS.map(g => [g.id, staticGarment(garmentMesh(gltf, g)!)] as const));
    for (const seed of SEEDS.slice(0, 3)) {
      const lay = L(seed), lines = settleLines(lay), plan = planLaundry(lay, lines, dims);
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      const ext = plan.map(p => {
        const l = lines[p.line], run = Math.hypot(l.x1 - l.x0, l.z1 - l.z0), ux = (l.x1 - l.x0) / run, uz = (l.z1 - l.z0) / run;
        hungMatrix(p, dims.find(x => x.id === p.garment)!, m);
        const pos = geos.get(p.garment)!.attributes.position;
        let a = Infinity, b = -Infinity;
        for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i).applyMatrix4(m); const s = (v.x - l.x0) * ux + (v.z - l.z0) * uz; a = Math.min(a, s); b = Math.max(b, s); }
        return {p, a, b};
      });
      for (const li of new Set(plan.map(p => p.line))) {
        const row = ext.filter(e => e.p.line === li).sort((x, y) => x.a - y.a);
        for (let k = 1; k < row.length; k++) expect(row[k].a - row[k - 1].b, `${seed} line ${li}: ${row[k - 1].p.garment} / ${row[k].p.garment}`).toBeGreaterThan(LAUNDRY.gap - 0.02);
        for (const e of row) { expect(e.a).toBeGreaterThanOrEqual(e.p.s0 - 0.01); expect(e.b).toBeLessThanOrEqual(e.p.s1 + 0.01); }
      }
    }
  });

  it('seeded and deterministic: the same market hangs the same laundry; markets / lines differ', () => {
    const a = planLaundry(L(42), settleLines(L(42)), dims), b = planLaundry(L(42), settleLines(L(42)), dims);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = planLaundry(L(4242), settleLines(L(4242)), dims);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
    const kinds = new Set(SEEDS.flatMap(s => planLaundry(L(s), settleLines(L(s)), dims).map(p => p.garment)));
    expect(kinds.size).toBeGreaterThanOrEqual(6); // (a varied wash: most of the types appear across markets)
    expect([...kinds].some(k => LAUNDRY_GARMENTS.find(g => g.id === k)!.hang === 'waist')).toBe(true);
  });
});

describe('market laundry: the build', () => {
  it('batched: one InstancedMesh per garment type (a two-sided clone of its own material), one pegs mesh — at most types + 1 draw calls; no planes', () => {
    for (const seed of [42, 77]) {
      const lay = L(seed), v = buildMarketView(lay, {garments: gltf})!;
      const lv = v.laundry!;
      expect(lv).not.toBeNull();
      expect(v.root.getObjectByName('market-laundry')).toBe(lv.group);
      expect(lv.meshes.length).toBeLessThanOrEqual(LAUNDRY_GARMENTS.length);
      const draws: THREE.Mesh[] = [];
      lv.group.traverse(o => { if ((o as THREE.Mesh).isMesh) draws.push(o as THREE.Mesh); });
      expect(draws.length).toBe(lv.meshes.length + 1);
      expect(draws.length).toBeLessThanOrEqual(LAUNDRY_GARMENTS.length + 1);
      expect(lv.meshes.reduce((n, m) => n + m.count, 0)).toBe(lv.plan.length);
      for (const m of lv.meshes) {
        const src = garmentMesh(gltf, LAUNDRY_GARMENTS.find(g => g.id === m.userData.laundry)!)!;
        expect(m.material).not.toBe(src.material);
        expect((m.material as THREE.Material).side).toBe(THREE.DoubleSide);
        expect(m.geometry).not.toBe(src.geometry);
        expect(m.geometry.attributes.position.count).toBe(src.geometry.attributes.position.count);
        expect(m.castShadow).toBe(false);
        expect(m.boundingSphere).not.toBeNull();
      }
      // nowhere a flat cloth square (the old PlaneGeometry laundry) or a vertex-coloured cloth sheet
      v.root.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        expect(m.geometry.type).not.toBe('PlaneGeometry');
        expect(m.geometry.getAttribute('color')).toBeUndefined();
      });
    }
  });

  it('read only: the cast file\'s garment meshes / materials are unchanged by building (and tearing down) the laundry', () => {
    const before = fileHash(gltf);
    const host = {scene: new THREE.Scene(), sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[],
      propModels: {get: (k: string) => (k === MARKET_HUMAN_KEY ? gltf : undefined)}};
    const sys = new MarketVisuals(host).install();
    sys.build(L(42));
    expect(sys.view!.laundry!.plan.length).toBeGreaterThan(0);
    let disposed = 0;
    for (const g of sys.view!.laundry!.geometries) g.addEventListener('dispose', () => { disposed++; });
    const n = sys.view!.laundry!.geometries.length;
    sys.teardown();
    expect(disposed).toBe(n);
    expect(fileHash(gltf)).toBe(before);
  });

  it('layout version 3 (the settlement + the bar) hangs laundry too; no cast loaded: bare lines, no laundry (never squares)', () => {
    const lay = generateMarketLevel({levelSeed: 42}); // (a fresh copy: marked version 3 below)
    lay.market!.v = 3;
    const v3 = buildMarketView(lay, {garments: gltf})!;
    expect(v3.lines).toBeGreaterThan(0);
    expect(v3.laundry?.plan.length).toBeGreaterThan(0);
    const bare = buildMarketView(L(42))!;
    expect(bare.lines).toBeGreaterThan(0);
    expect(bare.laundry).toBeNull();
    expect(bare.root.getObjectByName('market-lines')).toBeDefined();
    expect(bare.root.getObjectByName('market-laundry')).toBeUndefined();
    // (and the plan alone with no types: nothing)
    expect(planLaundry(L(42), settleLines(L(42)), [])).toEqual([]);
    expect(buildLaundry(L(42), settleLines(L(42)), null)).toBeNull();
  });
});
