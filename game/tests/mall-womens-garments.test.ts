// Task studio-beta-mall-round4-20261101-01 (lane GARMENTS, sub-lane GARMENTS-ASSETS — user: "we need to generate female cloths for the
// female store (else it doesn't match up). genearte a few items"): the women's face-out garment kinds render the registered models
// M82 'womens-dresses-group', M83 'womens-blouses-group', M84 'womens-skirts-group' — the primary's three accepted Meshy T2.5 models (one
// ledger, keyed by asset; 45 credits), cooked by tools/asset-pipeline/props/build-mall-track3.mjs EXTRA (front -Z, uniform to the hanging
// length hook top -> hem, seam-locked meshopt decimation, normals / UVs quantized, lean textures; M82's detached hook curls lowered onto
// their hangers). Checks: registration / allowlist / provenance hashes and the raw / task records, runtime dims == PROP_DEFS, hanging
// length, triangle / byte budget (incl. the honestly recorded S-tier overrun of M84), one connected row (hooks reach the hangers: no
// floating bits), the hook rod on top, and the kinds' physics / openables classification. Repo files only: runs in CI.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MALL_ASSETS} from '../src/assets/mallAssets';
import {MALL_ASSET_SPECS, MALL_DIMS} from '../src/assets/mallDims.generated';
import {MALL_KIND_ASSET, MALL_OPEN_AUDIT, MALL_PHYS, MALL_RIDER_KINDS} from '../src/gen/mall/kinds';
import {PROP_DEFS} from '../src/gen/props';
import {propPhysics, ridesHost} from '../src/damage/materials';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(GAME, 'public');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
type Rec = {id: string; code: string; task: string; model: string; modelType: string; front: string; shopsKind: string; role: string; tasks: {preview: string; refine: string};
  credits: {preview: number; refine: number}; previewPrompt: string; texturePrompt: string; records: {ledger: string}; recipe: {rebuild: string};
  source: {file: string; sha256: string; triangles: number; previewSha256: string}; tier: string; budget: number; sizeM: number; sizeAxis: string;
  output: {url: string; sha256: string; bytes: number; triangles: number; dims: number[]; overBudget: boolean}; edits: {quantized?: {extension: string}; lowered?: {comps: number}}};
const PROV = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/derivatives/mall-track3-20261031.json'), 'utf8')) as {outputs: {id: string}[]; extraOutputs: Rec[]};
const ALLOW = new Map((JSON.parse(fs.readFileSync(path.join(GAME, '../tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]})
  .files.map(f => [f.path, f]));

/** kind, asset id, code, ledger asset, accepted Meshy tasks, raw refine sha256 (outside Git), hanging length (m), lean tier, garment word. */
const G = [
  {kind: 'womensDressesGroup', id: 'womens-dresses-group', code: 'M82', asset: 'womens-dresses-hanging-group', tasks: {preview: '01a195bf-36a2-766b-aba7-dccd447eaf35', refine: '01a195c0-f43c-7777-8c97-4fd3c9a8c249'},
    raw: 'dresses-a1-refine-01a195c0-f43c.glb', rawSha: 'e80dc3d64b53d0245711ce534bb8184d7ae24032b9ec44d356b426a65e2de76b', hang: 1.05, tier: 'M', word: /dress/},
  {kind: 'womensBlousesGroup', id: 'womens-blouses-group', code: 'M83', asset: 'womens-blouses-hanging-group', tasks: {preview: '01a195bf-4031-76cb-b793-fb06d2d33f1b', refine: '01a195c0-fc0b-776f-aa88-f2c0a10c8649'},
    raw: 'blouses-a1-refine-01a195c0-fc0b.glb', rawSha: '8b11af00ffe747be387e09392fe62d92949db9d921d4536533f84dd194f13c92', hang: 0.65, tier: 'M', word: /blouse/},
  {kind: 'womensSkirtsGroup', id: 'womens-skirts-group', code: 'M84', asset: 'womens-skirts-hanging-group', tasks: {preview: '01a195bf-48cc-74b2-8209-ee9b2286a61e', refine: '01a195c1-02a6-774f-9e3b-21fa039448ed'},
    raw: 'skirts-a1-refine-01a195c1-02a6.glb', rawSha: '8f352da4f22d1f91ebc953077fec5f5834636eebe038f0cd9d9618e34ebf904a', hang: 0.76, tier: 'S', word: /skirt/},
] as const;
const recOf = (id: string) => PROV.extraOutputs.find(o => o.id === id);

describe('round 4 women\'s garment groups (Meshy M82-M84, face-out riders)', () => {
  it('registered, allowlisted, provenance-backed (file == allowlist == provenance; raw / task / ledger records)', () => {
    for (const g of G) {
      expect(MALL_KIND_ASSET[g.kind], g.kind).toBe(g.id);
      const a = MALL_ASSETS[g.id];
      expect(a, g.id).toMatchObject({url: `assets/models/mall-${g.id}.glb`, code: g.code, key: `office-${g.id}`});
      const buf = fs.readFileSync(path.join(PUB, a.url!));
      expect(buf.length).toBe(a.bytes);
      expect(ALLOW.get(a.url!)).toEqual({path: a.url, bytes: buf.length, sha256: sha(buf)});
      const r = recOf(g.id)!;
      expect(r, `${g.id} extraOutputs record`).toBeTruthy();
      expect(PROV.outputs.some(o => o.id === g.id)).toBe(false);
      expect(r.output).toMatchObject({url: a.url, sha256: sha(buf), bytes: buf.length, triangles: a.tris});
      expect(r).toMatchObject({code: g.code, task: 'studio-beta-mall-round4-20261101-01', model: 'meshy-t2.5', modelType: 'smart-topology', front: '-Z', shopsKind: g.kind, role: 'loose-stock'});
      expect(r.tasks).toEqual(g.tasks);
      expect(r.credits).toEqual({preview: 5, refine: 10});
      expect(r.source.sha256).toBe(g.rawSha);
      expect(r.source.file).toContain(`mall-round4-20261101/meshy/raw/${g.raw}`);
      expect(r.records.ledger).toContain(`'${g.asset}'`);
      expect(r.previewPrompt).toMatch(/women's/);
      expect(r.previewPrompt).toMatch(g.word);
      expect(r.texturePrompt).toMatch(g.word);
      expect(r.recipe.rebuild).toContain(`--only ${g.code}`);
    }
  });

  it('runtime dims == PROP_DEFS (collider = visual), hanging length (hook top -> hem) within 2 cm, face-out row, triangle / byte budget', () => {
    for (const g of G) {
      const d = MALL_DIMS[g.id], def = PROP_DEFS[g.kind], r = recOf(g.id)!;
      expect(d).toEqual(r.output.dims);
      expect(def.w).toBeCloseTo(d[0], 3); expect(def.h).toBeCloseTo(d[1], 3); expect(def.d).toBeCloseTo(d[2], 3);
      expect(Math.abs(d[1] - g.hang), `${g.id} hanging length`).toBeLessThanOrEqual(0.02);
      expect(MALL_ASSET_SPECS[g.id]).toMatchObject({code: g.code, sizeM: g.hang, sizeAxis: 'h', shopsKind: g.kind, role: 'loose-stock'});
      expect(d[2], `${g.id} thin face-out row`).toBeLessThan(0.25);
      expect(d[0], `${g.id} garments side by side`).toBeGreaterThan(0.6);
      // the raw's UV-fragmented atlas floors the seam-locked decimation at ~4.1-4.5k (target 3k, M06 class 2.7k)
      expect(MALL_ASSETS[g.id].tris).toBeLessThanOrEqual(4600);
      expect(MALL_ASSETS[g.id].tris).toBeLessThan(r.source.triangles * 0.6); // raw 7.6-9.7k
      expect(r.tier).toBe(g.tier);
      expect(r.output.overBudget).toBe(r.output.bytes > r.budget);
      if (g.tier === 'M') expect(r.output.bytes, `${g.id} within the lean M budget`).toBeLessThanOrEqual(r.budget);
      else expect(r.output.bytes, `${g.id}: S-tier overrun recorded, capped`).toBeLessThanOrEqual(r.budget * 1.2);
    }
  });

  it('classification: static host decor that rides its rail (MALL_RIDER_KINDS), nothing to open (audited)', () => {
    for (const g of G) {
      expect(MALL_PHYS[g.kind], g.kind).toMatchObject({dynamic: false, why: 'host decor'});
      expect(propPhysics(g.kind).dynamic, g.kind).toBe(false);
      expect(MALL_RIDER_KINDS, g.kind).toContain(g.kind);
      expect(ridesHost(g.kind), g.kind).toBe(true);
      expect(MALL_OPEN_AUDIT[g.kind], g.kind).toMatchObject({role: 'decor', cls: 'none'});
      expect(OPENABLE_AUDIT.find(e => e.kind === g.kind), g.kind).toMatchObject({cls: 'none'});
    }
  });

  it('one connected row (hooks reach their hangers: no floating bits), hook rod on top, hem grounded, plain nodes + quantized normals / UVs', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const g of G) {
      const file = path.join(PUB, MALL_ASSETS[g.id].url!);
      const json = JSON.parse(fs.readFileSync(file).subarray(20, 20 + fs.readFileSync(file).readUInt32LE(12)).toString('utf8'));
      expect(json.extensionsUsed, g.id).toEqual(['KHR_mesh_quantization']); // three.js GLTFLoader decodes it natively (zombies ship it)
      expect(recOf(g.id)!.edits.quantized?.extension).toMatch(/KHR_mesh_quantization/);
      const doc = await io.read(file);
      for (const n of doc.getRoot().listNodes()) expect(n.getMatrix(), g.id).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      expect(doc.getRoot().listMaterials().map(m => m.getName())).toEqual([`mall-${g.id}`]);
      const V: number[][] = [], T: number[][] = [], key = new Map<string, number>();
      for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
        expect(p.getAttribute('POSITION')!.getArray()).toBeInstanceOf(Float32Array);
        expect(p.getAttribute('NORMAL')!.getNormalized()).toBe(true);
        const P = p.getAttribute('POSITION')!, I = p.getIndices()!.getArray()!, map: number[] = [], v = [0, 0, 0];
        for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); const k = v.map(c => Math.round(c * 1e4)).join(','); if (!key.has(k)) { key.set(k, V.length); V.push([...v]); } map.push(key.get(k)!); }
        for (let t = 0; t < I.length; t += 3) T.push([map[I[t]], map[I[t + 1]], map[I[t + 2]]]);
      }
      const par = V.map((_, i) => i), f = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (const [a, b, c] of T) { par[f(b)] = f(a); par[f(c)] = f(a); }
      const boxes = new Map<number, {min: number[]; max: number[]}>();
      for (const [a, b, c] of T) for (const i of [a, b, c]) {
        const r = f(i), bb = boxes.get(r) ?? {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
        for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], V[i][k]); bb.max[k] = Math.max(bb.max[k], V[i][k]); }
        boxes.set(r, bb);
      }
      // connected components chain into ONE cluster (boxes touching within 5 mm): no hook / hanger / garment floating apart
      const bs = [...boxes.values()], q = bs.map((_, i) => i), gq = (x: number): number => { while (q[x] !== x) x = q[x]; return x; };
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if ([0, 1, 2].every(k => bs[i].min[k] <= bs[j].max[k] + 0.005 && bs[j].min[k] <= bs[i].max[k] + 0.005)) q[gq(j)] = gq(i);
      expect(new Set(bs.map((_, i) => gq(i))).size, `${g.id}: ${bs.length} components`).toBe(1);
      const h = MALL_DIMS[g.id][1], w = MALL_DIMS[g.id][0];
      expect(Math.min(...V.map(v => v[1]))).toBeCloseTo(0, 4); // the longest hem at y 0
      expect(Math.max(...V.map(v => v[1]))).toBeCloseTo(h, 3); // the hook tops at y = h (rider at host rail height - h)
      // the hooks' rod spans the row within the top 3 cm
      expect(bs.some(b => b.min[1] > h - 0.03 && b.max[0] - b.min[0] > 0.9 * w), `${g.id} hook rod`).toBe(true);
    }
    expect(recOf('womens-dresses-group')!.edits.lowered?.comps).toBeGreaterThanOrEqual(6); // M82: 5 hook curls (+ pieces) and the rod lowered
  });
});
