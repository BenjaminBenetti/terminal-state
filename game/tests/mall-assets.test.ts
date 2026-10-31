// Task track3-eaton-centre-20261031 (Studio Beta, lane ASSETS): the NEW mall-art models registered in src/assets/mallAssets.ts
// (rewritten by tools/asset-pipeline/props/build-mall-track3.mjs) are real, allowlisted, provenance-backed Meshy T2.5 runtime
// derivatives at real-world scale, level-only by path, under library keys that never collide with the office / company models; the
// three-free mallDims.generated.ts mirrors them. Only repo files are read (raw masters, frozen batches and the job ledger live outside
// Git), so this runs in CI — and holds both before any delivery (empty registry) and after.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {MALL_ASSETS, MALL_ASSET_IDS, MALL_MODEL_FILES, MALL_PART_ASSETS, mallAssetsReady, mallModelKey} from '../src/assets/mallAssets';
import {MALL_ASSET_SPECS, MALL_DIMS} from '../src/assets/mallDims.generated';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const PUB = path.join(GAME, 'public');
const PROV_REL = 'assets/derivatives/mall-track3-20261031.json';
const provPath = path.join(PUB, PROV_REL);
const PROV = fs.existsSync(provPath) ? JSON.parse(fs.readFileSync(provPath, 'utf8')) as {
  modelProof: {requested: {ai_model: string; model_type: string}};
  outputs: {id: string; code: string; model: string; modelType: string; tasks: {preview: string; refine: string}; credits: {preview: number | null; refine: number | null};
    output: {url: string; sha256: string; bytes: number; triangles: number; dims: number[]}; sizeM: number; sizeAxis: 'h' | 'w' | 'longest'; front: string}[];
} : null;
const ALLOW = new Map((JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const ready = mallAssetsReady();

describe('mall assets registry (lane ASSETS)', () => {
  it('lists a url only for a delivered, allowlisted, flat level-only model with provenance', () => {
    for (const id of MALL_ASSET_IDS) {
      const a = MALL_ASSETS[id];
      expect(a.key).toBe(mallModelKey(id));
      if (a.url === null) { expect(a.bytes).toBe(0); continue; }
      expect(a.url).toBe(`assets/models/mall-${id}.glb`); // package-ci publicPath + levelAssets mall rule
      const buf = fs.readFileSync(path.join(PUB, a.url));
      expect(buf.length).toBe(a.bytes);
      expect(ALLOW.get(a.url)).toEqual({path: a.url, bytes: buf.length, sha256: sha(buf)});
      const o = PROV?.outputs.find(x => x.id === id);
      expect(o, `${id} provenance`).toBeTruthy();
      expect(o!.output.sha256).toBe(sha(buf));
      expect(o!.model).toBe('meshy-t2.5');
      expect(o!.modelType).toBe('smart-topology');
      expect(o!.credits).toEqual({preview: 5, refine: 10});
    }
    if (ready.length) {
      expect(PROV!.modelProof.requested).toMatchObject({ai_model: 'meshy-t2.5', model_type: 'smart-topology'});
      const p = fs.readFileSync(provPath);
      expect(ALLOW.get(PROV_REL)).toEqual({path: PROV_REL, bytes: p.length, sha256: sha(p)});
      expect(p.toString()).not.toMatch(/https?:|Signature=|X-Amz|Key-Pair-Id|token=/i);
    } else {
      expect(PROV).toBeNull(); // no provenance before the first delivery
    }
  });

  it('mirrors dims / specs and never collides with office or company library keys', () => {
    expect(Object.keys(MALL_DIMS).sort()).toEqual([...ready].sort());
    for (const id of MALL_ASSET_IDS) expect(MALL_ASSET_SPECS[id], `${id} spec`).toBeTruthy();
    for (const id of Object.keys(MALL_ASSET_SPECS)) expect(MALL_ASSETS[id], `${id} registry`).toBeTruthy();
    const foreign = new Set([...Object.keys(OFFICE_MODEL_FILES), ...Object.keys(COMPANY_MODEL_FILES), ...Object.keys(COMPANY_PART_MODEL_FILES)]);
    for (const [key, f] of Object.entries(MALL_MODEL_FILES)) {
      expect(foreign.has(key), `${key} collides with an office / company key`).toBe(false);
      expect(f.url).toMatch(/^assets\/models\/mall-[\w-]+\.glb$/);
    }
    expect(Object.keys(MALL_MODEL_FILES).length).toBe(ready.length + Object.keys(MALL_PART_ASSETS).length);
  });

  it('delivered models are grounded, centred, front -Z, at their real size', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const id of ready) {
      const doc = await io.read(path.join(PUB, MALL_ASSETS[id].url!));
      const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
      const dims = [0, 1, 2].map(k => b.max[k] - b.min[k]);
      const spec = MALL_ASSET_SPECS[id];
      expect(Math.abs(b.min[1])).toBeLessThan(1e-3);
      expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(2e-3 * spec.sizeM + 1e-4);
      expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(2e-3 * spec.sizeM + 1e-4);
      const along = spec.sizeAxis === 'h' ? dims[1] : spec.sizeAxis === 'w' ? dims[0] : Math.max(...dims);
      expect(Math.abs(along - spec.sizeM)).toBeLessThan(3e-3);
      MALL_DIMS[id].forEach((v, k) => expect(Math.abs(v - dims[k])).toBeLessThan(1e-3));
      expect(PROV!.outputs.find(o => o.id === id)!.front).toBe('-Z');
    }
  });
});
