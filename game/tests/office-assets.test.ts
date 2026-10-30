// Iteration 16 (lane ASSETS): the Office Space Meshy T2.5 models and Codex textures registered in src/assets/officeAssets.ts are
// real, allowlisted, provenance-backed runtime derivatives at real-world scale. Only repo files are read (the raw originals and the
// job ledger live outside Git), so this runs in CI.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {OFFICE_ASSETS, OFFICE_ASSET_IDS, OFFICE_TEXTURES, OFFICE_TEXTURE_IDS, OFFICE_MODEL_FILES, loadOfficeAsset, loadOfficeTexture, officeAssetsReady, type OfficeAssetId} from '../src/assets/officeAssets';
import {OFFICE_LOCAL_MODELS} from '../src/assets/officeAssets'; // lane RACK (office-props-physics-scale-20261030): local rebuilds
import {COMPANY_ASSETS, COMPANY_PART_ASSETS} from '../src/assets/companyAssets';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const PUB = path.join(GAME, 'public');
const PROV_REL = 'assets/derivatives/office-space-20261029.json';
const provText = fs.readFileSync(path.join(PUB, PROV_REL), 'utf8');
const PROV = JSON.parse(provText) as {
  modelProof: {requested: {ai_model: string; model_type: string}};
  outputs: {id: string; code: string; model: string; modelType: string; tasks: {preview: string | null; refine: string}; credits: {preview: number | null; refine: number | null};
    source: {sha256: string}; output: {url: string; sha256: string; bytes: number; triangles: number}; targetTriangles: number; front: string}[];
  textures: {id: string; tool: string; source: {sha256: string}; output: {url: string; sha256: string; bytes: number; size: number[]}}[];
};
const ALLOW = new Map((JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
// The CI packager's accepted public paths (tools/release/package-ci.mjs publicPath): models must be FLAT under assets/models/.
const publicPath = (p: string) => /^assets\/models\/[\w-]+\.glb$/.test(p) || /^assets\/derivatives\/[\w-]+\.json$/.test(p) || /^assets\/textures\/[\w/-]+\.(png|jpg)$/.test(p);

// design.md Part 1 manifest: target triangles + real size (metres) along the size axis.
const TABLE: Record<OfficeAssetId, [number, number]> = {
  'gear-armor-vest': [4000, 0.62], 'gear-chest-rig': [4000, 0.55], 'gear-backpack': [4000, 0.52], 'gear-helmet': [3000, 0.30], 'gear-boots': [3500, 0.32],
  'gear-gloves': [2500, 0.26], 'med-leg-splint': [2000, 0.24], 'med-arm-sling': [2000, 0.20], 'office-desk': [5000, 1.50], 'office-chair': [4000, 1.00],
  'filing-cabinet': [3000, 1.32], 'office-monitor': [3000, 0.55], 'photocopier': [5000, 1.10], 'water-cooler': [3000, 1.30], 'conference-table': [4000, 3.00],
  'dead-plant': [3000, 1.10], 'reception-desk': [6000, 2.60], 'server-rack': [5000, 2.00], 'whiteboard': [2000, 1.80], 'office-shelf': [4000, 1.80],
  'car-wreck': [8000, 4.60], 'rubble-pile': [6000, 5.00], 'ruined-tower': [20000, 60], 'ruined-midrise': [20000, 30], 'bus-wreck': [10000, 12.0],
};
const ready = OFFICE_ASSET_IDS.filter(id => OFFICE_ASSETS[id].url !== null);

describe('iteration16 office assets', () => {
  it('registry covers the 25-asset manifest with the table sizes; ready entries are consistent', () => {
    expect([...OFFICE_ASSET_IDS].sort()).toEqual((Object.keys(TABLE) as OfficeAssetId[]).sort());
    for (const id of OFFICE_ASSET_IDS) {
      const a = OFFICE_ASSETS[id];
      expect(a.sizeM).toBe(TABLE[id][1]);
      if (a.url === null) { expect(a.bytes).toBe(0); expect(a.dims).toBeNull(); continue; }
      expect(a.url).toBe(`assets/models/office-${id}.glb`);
      expect(publicPath(a.url)).toBe(true);
      expect(OFFICE_MODEL_FILES[`office-${id}`]).toEqual({url: a.url, bytes: a.bytes});
    }
    expect(officeAssetsReady().length).toBe(ready.length);
    expect(ready.length).toBeGreaterThan(0);
  });

  it('every delivered GLB exists, is allowlisted with matching sha256/bytes and is in the provenance as meshy-t2.5 / smart-topology', () => {
    expect(PROV.modelProof.requested).toMatchObject({ai_model: 'meshy-t2.5', model_type: 'smart-topology'});
    for (const id of ready) {
      const a = OFFICE_ASSETS[id];
      const buf = fs.readFileSync(path.join(PUB, a.url!));
      expect(buf.length, id).toBe(a.bytes);
      expect(ALLOW.get(a.url!), `${id} allowlisted`).toEqual({path: a.url, bytes: buf.length, sha256: sha(buf)});
      const o = PROV.outputs.find(x => x.id === id);
      expect(o, `${id} provenance`).toBeDefined();
      expect(o!.model).toBe('meshy-t2.5');
      expect(o!.modelType).toBe('smart-topology');
      expect(o!.output).toMatchObject({url: a.url, sha256: sha(buf), bytes: buf.length, triangles: a.tris});
      expect(o!.tasks.refine).toMatch(/^[0-9a-f-]{36}$/);
      expect(o!.tasks.preview).toMatch(/^[0-9a-f-]{36}$/);
      expect(o!.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(o!.credits).toEqual({preview: 5, refine: 10});
      expect(o!.front).toBe('-Z');
      expect(a.bytes).toBeLessThanOrEqual(id === 'ruined-tower' || id === 'ruined-midrise' ? 3_000_000 : 1_500_000);
    }
    // nothing in the provenance that is not in the registry
    for (const o of PROV.outputs) expect(OFFICE_ASSETS[o.id as OfficeAssetId]?.url).toBe(o.output.url);
  });

  it('every delivered GLB is at real size, grounded, centred, and within 1.2x the target triangle count', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const id of ready) {
      const a = OFFICE_ASSETS[id];
      const doc = await io.read(path.join(PUB, a.url!));
      const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
      const {min, max} = getBounds(scene);
      const ext = [0, 1, 2].map(k => max[k] - min[k]);
      const measured = a.sizeAxis === 'h' ? ext[1] : a.sizeAxis === 'w' ? ext[0] : Math.max(...ext);
      expect(Math.abs(measured - a.sizeM) / a.sizeM, `${id} size`).toBeLessThan(0.01);
      expect(Math.max(...ext), `${id} not absurdly larger than its table size`).toBeLessThan(a.sizeM * 3.2);
      expect(Math.abs(min[1]), `${id} grounded`).toBeLessThan(1e-3);
      expect(Math.abs(min[0] + max[0]) / a.sizeM, `${id} centred x`).toBeLessThan(0.01);
      expect(Math.abs(min[2] + max[2]) / a.sizeM, `${id} centred z`).toBeLessThan(0.01);
      for (let k = 0; k < 3; k++) expect(ext[k]).toBeCloseTo(a.dims![k], 3);
      let tris = 0;
      for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
      expect(tris).toBe(a.tris);
      expect(tris, `${id} tris`).toBeLessThanOrEqual(TABLE[id][0] * 1.2);
      for (const t of doc.getRoot().listTextures()) expect(Math.max(...t.getSize()!), `${id} texture size`).toBeLessThanOrEqual(1024);
    }
  });

  it('every delivered texture exists, is allowlisted and provenance-backed', () => {
    for (const id of OFFICE_TEXTURE_IDS) {
      const t = OFFICE_TEXTURES[id];
      if (t.url === null) continue;
      expect(publicPath(t.url)).toBe(true);
      expect(t.url.startsWith('assets/textures/office/')).toBe(true);
      const buf = fs.readFileSync(path.join(PUB, t.url));
      expect(buf.length).toBe(t.bytes);
      expect(ALLOW.get(t.url)).toEqual({path: t.url, bytes: buf.length, sha256: sha(buf)});
      const o = PROV.textures.find(x => x.id === id);
      expect(o?.output).toMatchObject({url: t.url, sha256: sha(buf), bytes: buf.length});
      expect(o!.output.size).toEqual(t.size);
      expect(Math.min(...t.size!)).toBeGreaterThanOrEqual(id === 'skyline' ? 512 : 1024);
      expect(o!.tool).toMatch(/Codex/);
    }
  });

  it('public provenance carries no URLs, signed-URL tokens or credentials, and is itself allowlisted', () => {
    expect(provText).not.toMatch(/https?:/i);
    expect(provText).not.toMatch(/Signature|X-Amz|Key-Pair-Id|token=|api[_-]?key/i);
    const buf = fs.readFileSync(path.join(PUB, PROV_REL));
    expect(ALLOW.get(PROV_REL)).toEqual({path: PROV_REL, bytes: buf.length, sha256: sha(buf)});
    // only delivered office files exist on disk (no stray, unallowlisted office outputs). The office-overhaul company / supporting
    // models share the flat office-<id>.glb naming and are covered by company-assets.test.ts, so they are excluded here.
    const companyUrls = new Set(Object.values(COMPANY_ASSETS).map(a => a.url).filter(Boolean));
    const localUrls = new Set<string>(Object.values(OFFICE_LOCAL_MODELS).map(a => a.url)); // lane RACK: covered by the local-rebuild test below
    const partUrls = new Set<string>(Object.values(COMPANY_PART_ASSETS).map(a => a.url)); // lane FURN: separated clutter (company-assets.test.ts)
    const onDisk = fs.readdirSync(path.join(PUB, 'assets/models')).filter(f => f.startsWith('office-')).map(f => `assets/models/${f}`)
      .filter(p => !companyUrls.has(p) && !localUrls.has(p) && !partUrls.has(p));
    expect(onDisk.sort()).toEqual(ready.map(id => OFFICE_ASSETS[id].url!).sort());
    for (const p of onDisk) expect(ALLOW.has(p)).toBe(true);
  });

  // Task office-props-physics-scale-20261030 (lane RACK): LOCAL rebuilds (procedural, no generation) registered next to the Meshy set.
  it('local rebuilt derivatives: on disk, allowlisted, sidecar-backed (sha / bytes / tris / dims), real size, library keys', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const [id, a] of Object.entries(OFFICE_LOCAL_MODELS)) {
      expect(a.url).toBe(`assets/models/office-${id}.glb`);
      expect(publicPath(a.url) && publicPath(a.provenance)).toBe(true);
      expect(OFFICE_MODEL_FILES[`office-${id}`]).toEqual({url: a.url, bytes: a.bytes});
      expect(OFFICE_ASSETS[a.replaces], `${id} replaces a registered asset`).toBeDefined();
      expect(fs.existsSync(path.join(ROOT, a.script)), `${id} rebuild script`).toBe(true);
      const buf = fs.readFileSync(path.join(PUB, a.url));
      expect(buf.length).toBe(a.bytes);
      const side = JSON.parse(fs.readFileSync(path.join(PUB, a.provenance), 'utf8')) as {generation: {provider: unknown; credits: number}; output: {url: string; sha256: string; bytes: number; triangles: number; dims: number[]}};
      expect(side.generation).toMatchObject({provider: null, credits: 0});
      expect(side.output).toMatchObject({url: a.url, sha256: sha(buf), bytes: buf.length, triangles: a.tris, dims: [...a.dims]});
      expect(fs.readFileSync(path.join(PUB, a.provenance), 'utf8')).not.toMatch(/https?:/i);
      // the primary regenerates tools/release/public-inputs.json at integration (lanes never edit it)
      expect(ALLOW.get(a.url), `${id} allowlisted`).toEqual({path: a.url, bytes: buf.length, sha256: sha(buf)});
      const doc = await io.read(path.join(PUB, a.url));
      const {min, max} = getBounds(doc.getRoot().getDefaultScene()!);
      for (let k = 0; k < 3; k++) expect(max[k] - min[k], `${id} dims ${k}`).toBeCloseTo(a.dims[k], 3);
      expect(Math.abs(min[1])).toBeLessThan(1e-4);
      let tris = 0;
      for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices()!.getCount() / 3;
      expect(tris).toBe(a.tris);
      for (const t of doc.getRoot().listTextures()) expect(Math.max(...t.getSize()!), `${id} texture size`).toBeLessThanOrEqual(1024);
    }
  });

  it('lazy loaders never throw: null for undelivered ids and outside a browser', async () => {
    for (const id of OFFICE_ASSET_IDS.slice(0, 3)) await expect(loadOfficeAsset(id)).resolves.toBeNull();   // node: no document/fetch base
    await expect(loadOfficeTexture('skyline')).resolves.toBeNull();
    await expect(loadOfficeAsset('not-an-id' as OfficeAssetId)).resolves.toBeNull();
  });
});
