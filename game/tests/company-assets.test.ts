// Task office-overhaul-20261030 (Studio Beta, lane ASSETS): the company signature props (D01-D40, 20 companies x 2) and the
// supporting office-overhaul models (E01-E18) registered in src/assets/companyAssets.ts are real, allowlisted, provenance-backed
// Meshy T2.5 runtime derivatives at real-world scale; the three.js-free companyDims.generated.ts mirrors them. Only repo files are
// read (raw originals and the job ledger live outside Git), so this runs in CI.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {COMPANY_ASSETS, COMPANY_ASSET_IDS, COMPANY_MODEL_FILES, COMPANY_PART_ASSETS, COMPANY_PART_MODEL_FILES, companyAssetsReady, companySignatureAssets, loadCompanyAsset, type CompanyAssetId} from '../src/assets/companyAssets';
import {COMPANY_DIMS, COMPANY_ASSET_SPECS, COMPANY_PART_DIMS} from '../src/assets/companyDims.generated';
import {OFFICE_ASSETS, OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import type {CompanyId} from '../src/gen/office/overhaulTypes';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(GAME, '..');
const PUB = path.join(GAME, 'public');
const PROV_REL = 'assets/derivatives/office-overhaul-20261030.json';
const provPath = path.join(PUB, PROV_REL);
const provText = fs.existsSync(provPath) ? fs.readFileSync(provPath, 'utf8') : null;
const PROV = provText ? JSON.parse(provText) as {
  modelProof: {requested: {ai_model: string; model_type: string}};
  manifest: {assets: number; company: number; support: number; runCap: number};
  credits: {previews: number; refines: number; total: number};
  outputs: {id: string; code: string; company: string | null; model: string; modelType: string; tasks: {preview: string; refine: string};
    credits: {preview: number | null; refine: number | null}; source: {sha256: string}; output: {url: string; sha256: string; bytes: number; triangles: number; dims: number[]};
    targetTriangles: number; front: string; nativeFront: string}[];
} : null;
const ALLOW = new Map((JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
// The CI packager's accepted public paths (tools/release/package-ci.mjs publicPath): models must be FLAT under assets/models/.
const publicPath = (p: string) => /^assets\/models\/[\w-]+\.glb$/.test(p) || /^assets\/derivatives\/[\w-]+\.json$/.test(p);

// The finite manifest (reference/tasks/office-overhaul-20261030/assets/manifest.json, sha256 c55dd4bc...): code, company, real size
// (m) along the size axis, smart-topology triangle target.
const TABLE: Record<CompanyAssetId, [string, CompanyId | null, number, 'h' | 'w' | 'longest', number]> = {
  'gumball-machine': ['D01', 'bubblr', 1.35, 'h', 3500],
  'gumball-jar': ['D02', 'bubblr', 0.75, 'h', 2500],
  'arcade-cabinet': ['D03', 'pixelforge', 1.8, 'h', 4000],
  'console-station': ['D04', 'pixelforge', 1.4, 'w', 4000],
  'law-bookcase': ['D05', 'halden', 2.2, 'h', 4000],
  'justice-statue': ['D06', 'halden', 1.7, 'h', 4000],
  'trading-desk': ['D07', 'crestmark', 1.8, 'w', 4500],
  'bull-statue': ['D08', 'crestmark', 1.4, 'longest', 4000],
  'lab-bench': ['D09', 'verdant', 1.8, 'w', 4500],
  'biohazard-fridge': ['D10', 'verdant', 2, 'h', 3500],
  'architect-model': ['D11', 'arcline', 1.6, 'w', 4500],
  'drafting-table': ['D12', 'arcline', 1.3, 'w', 3500],
  'tv-camera': ['D13', 'metro9', 1.7, 'h', 4000],
  'news-desk': ['D14', 'metro9', 2.6, 'w', 4000],
  'espresso-machine': ['D15', 'ember', 1.4, 'w', 4000],
  'coffee-roaster': ['D16', 'ember', 1.8, 'h', 4500],
  'treadmill': ['D17', 'stride', 2, 'longest', 3500],
  'sneaker-wall': ['D18', 'stride', 2, 'h', 4500],
  'giant-teddy': ['D19', 'wonderbox', 1.2, 'h', 3500],
  'rocking-horse': ['D20', 'wonderbox', 1.2, 'longest', 3500],
  'jukebox': ['D21', 'lowtide', 1.6, 'h', 4000],
  'mixing-console': ['D22', 'lowtide', 2, 'w', 4500],
  'exam-table': ['D23', 'calloway', 1.9, 'longest', 3000],
  'vitals-monitor': ['D24', 'calloway', 1.6, 'h', 3000],
  'dress-form': ['D25', 'ardent', 1.7, 'h', 3500],
  'clothing-rack': ['D26', 'ardent', 1.5, 'w', 4500],
  'ship-model': ['D27', 'tidewater', 1.6, 'w', 4500],
  'parcel-pallet': ['D28', 'tidewater', 1.2, 'w', 3000],
  'nap-pod': ['D29', 'nimbus', 1.8, 'longest', 3500],
  'kegerator': ['D30', 'nimbus', 1.4, 'h', 3000],
  'cctv-console': ['D31', 'ironclad', 2, 'w', 4500],
  'metal-detector': ['D32', 'ironclad', 2.2, 'h', 2500],
  'vault-safe': ['D33', 'pemberton', 1.5, 'h', 3500],
  'archive-boxes': ['D34', 'pemberton', 1.3, 'h', 2500],
  'aquarium': ['D35', 'pawprint', 1.5, 'w', 3500],
  'cat-tree': ['D36', 'pawprint', 1.8, 'h', 3500],
  'dough-mixer': ['D37', 'goldencrust', 1.5, 'h', 3500],
  'bakery-case': ['D38', 'goldencrust', 1.6, 'w', 4500],
  'satellite-model': ['D39', 'orbital', 1.8, 'longest', 4000],
  'telescope': ['D40', 'orbital', 1.8, 'h', 3500],
  'executive-desk': ['E01', null, 2, 'w', 4000],
  'executive-chair': ['E02', null, 1.25, 'h', 3500],
  'chesterfield-sofa': ['E03', null, 2.1, 'w', 4000],
  'globe-bar': ['E04', null, 1, 'h', 4000],
  'server-cabinet': ['E05', null, 2, 'h', 3000],
  'crac-unit': ['E06', null, 1.9, 'h', 2500],
  'lobby-sofa': ['E07', null, 2.2, 'w', 3500],
  'planter-tree': ['E08', null, 2.2, 'h', 3500],
  'security-turnstile': ['E09', null, 1, 'h', 2500],
  'foosball-table': ['E10', null, 1.4, 'longest', 4000],
  'ping-pong-table': ['E11', null, 2.74, 'longest', 3000],
  'bean-bag': ['E12', null, 0.9, 'longest', 2000],
  'lounge-armchair': ['E13', null, 0.85, 'h', 3000],
  'potted-plant-small': ['E14', null, 0.6, 'h', 2000],
  'rooftop-hvac': ['E15', null, 2.4, 'longest', 3500],
  'water-tower': ['E16', null, 4.5, 'h', 4000],
  'satellite-dish': ['E17', null, 1.8, 'longest', 2500],
  'toilet': ['E18', null, 0.8, 'h', 2000],
};
// Task office-props-physics-scale-20261030 (lane FURN): FURNITURE-ONLY real size (tools/asset-pipeline/props/build-office-overhaul.mjs
// FURNITURE: the miniature lab bench / trading desk were sized by a width that included their baked beakers / monitors; the bakery case
// and the bean bag were toy-sized). The registry carries these; the manifest's sizeM / sizeAxis (TABLE) stay in the provenance.
const FURNITURE_ONLY: Partial<Record<CompanyAssetId, [number, 'h' | 'w' | 'longest']>> = {
  'lab-bench': [0.9, 'h'], 'trading-desk': [0.74, 'h'], 'bakery-case': [1.35, 'h'], 'bean-bag': [1.3, 'longest'],
};
type FurnitureProv = {manifestSizeM: number; manifestSizeAxis: string; sizeM: number; sizeAxis: string; removed: {tris: number; comps: number} | null};
const furnitureOf = (id: string) => (PROV?.outputs.find(o => o.id === id) as {furniture?: FurnitureProv} | undefined)?.furniture;
const COMPANIES: CompanyId[] = ['bubblr', 'pixelforge', 'halden', 'crestmark', 'verdant', 'arcline', 'metro9', 'ember', 'stride', 'wonderbox',
  'lowtide', 'calloway', 'ardent', 'tidewater', 'nimbus', 'ironclad', 'pemberton', 'pawprint', 'goldencrust', 'orbital'];
const ready = COMPANY_ASSET_IDS.filter(id => COMPANY_ASSETS[id].url !== null);
const isLarge = (id: CompanyAssetId) => COMPANY_ASSETS[id].sizeM >= 1.5;

describe('office overhaul company / supporting assets', () => {
  it('registry covers the 58-asset manifest: 40 company props (20 companies x 2) + 18 supporting models', () => {
    expect([...COMPANY_ASSET_IDS].sort()).toEqual((Object.keys(TABLE) as CompanyAssetId[]).sort());
    for (const id of COMPANY_ASSET_IDS) {
      const a = COMPANY_ASSETS[id], [code, company, manifestSizeM, manifestAxis, tris] = TABLE[id];
      const [sizeM, sizeAxis] = FURNITURE_ONLY[id] ?? [manifestSizeM, manifestAxis]; // lane FURN
      expect({code: a.code, company: a.company, sizeM: a.sizeM, sizeAxis: a.sizeAxis, targetTris: a.targetTris}, id).toEqual({code, company, sizeM, sizeAxis, targetTris: tris});
      expect(a.use).toBe(company ? 'company' : 'support');
      expect(code).toMatch(company ? /^D(0[1-9]|[1-3]\d|40)$/ : /^E(0[1-9]|1[0-8])$/);
    }
    expect(COMPANY_ASSET_IDS.filter(id => COMPANY_ASSETS[id].use === 'company')).toHaveLength(40);
    expect(COMPANY_ASSET_IDS.filter(id => COMPANY_ASSETS[id].use === 'support')).toHaveLength(18);
    for (const c of COMPANIES) expect(companySignatureAssets(c), c).toHaveLength(2);
    expect(new Set(COMPANY_ASSET_IDS.map(id => COMPANY_ASSETS[id].code)).size).toBe(58);
  });

  it('delivered entries are consistent: flat office-<id> urls, lazy-library map, no collision with the iteration-16 office assets', () => {
    for (const id of COMPANY_ASSET_IDS) {
      const a = COMPANY_ASSETS[id];
      if (a.url === null) { expect(a.bytes).toBe(0); expect(a.tris).toBe(0); expect(a.dims).toBeNull(); expect(COMPANY_MODEL_FILES[`office-${id}`]).toBeUndefined(); continue; }
      expect(a.url).toBe(`assets/models/office-${id}.glb`);
      expect(publicPath(a.url)).toBe(true);
      expect(COMPANY_MODEL_FILES[`office-${id}`]).toEqual({url: a.url, bytes: a.bytes});
      expect(OFFICE_MODEL_FILES[`office-${id}`], `${id} key collides with officeAssets`).toBeUndefined();
      expect(Object.values(OFFICE_ASSETS).some(o => o.url === a.url)).toBe(false);
    }
    expect(Object.keys(COMPANY_MODEL_FILES).length).toBe(ready.length);
    expect(companyAssetsReady().length).toBe(ready.length);
    expect(companyAssetsReady('company').length + companyAssetsReady('support').length).toBe(ready.length);
  });

  it('companyDims.generated (three.js-free) mirrors the registry dims and nominal specs', () => {
    expect(Object.keys(COMPANY_DIMS).sort()).toEqual([...COMPANY_ASSET_IDS].sort());
    expect(Object.keys(COMPANY_ASSET_SPECS).sort()).toEqual([...COMPANY_ASSET_IDS].sort());
    for (const id of COMPANY_ASSET_IDS) {
      const a = COMPANY_ASSETS[id];
      expect(COMPANY_DIMS[id], id).toEqual(a.dims);
      expect(COMPANY_ASSET_SPECS[id]).toEqual({code: a.code, company: a.company, use: a.use, sizeM: a.sizeM, sizeAxis: a.sizeAxis, placement: a.placement});
      if (a.url) expect(a.dims, `${id} dims present when delivered`).not.toBeNull();
    }
    const src = fs.readFileSync(path.join(GAME, 'src/assets/companyDims.generated.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
  });

  it('every delivered GLB exists, is allowlisted with matching sha256/bytes and is in the provenance as meshy-t2.5 / smart-topology', () => {
    if (!ready.length) return;
    expect(PROV, 'provenance written once anything is delivered').not.toBeNull();
    expect(PROV!.modelProof.requested).toMatchObject({ai_model: 'meshy-t2.5', model_type: 'smart-topology'});
    expect(PROV!.manifest).toMatchObject({assets: 58, company: 40, support: 18, runCap: 960});
    expect(PROV!.credits.total).toBeLessThanOrEqual(960);
    for (const id of ready) {
      const a = COMPANY_ASSETS[id];
      const buf = fs.readFileSync(path.join(PUB, a.url!));
      expect(buf.length, id).toBe(a.bytes);
      expect(ALLOW.get(a.url!), `${id} allowlisted`).toEqual({path: a.url, bytes: buf.length, sha256: sha(buf)});
      const o = PROV!.outputs.find(x => x.id === id);
      expect(o, `${id} provenance`).toBeDefined();
      expect(o!.code).toBe(a.code);
      expect(o!.company).toBe(a.company);
      expect(o!.model).toBe('meshy-t2.5');
      expect(o!.modelType).toBe('smart-topology');
      expect(o!.output).toMatchObject({url: a.url, sha256: sha(buf), bytes: buf.length, triangles: a.tris, dims: [...a.dims!]});
      expect(o!.tasks.refine).toMatch(/^[0-9a-f-]{36}$/);
      expect(o!.tasks.preview).toMatch(/^[0-9a-f-]{36}$/);
      expect(o!.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(o!.credits).toEqual({preview: 5, refine: 10});
      expect(o!.front).toBe('-Z');
      expect(['+Z', '-Z', '+X', '-X']).toContain(o!.nativeFront);
      expect(a.bytes, `${id} byte budget`).toBeLessThanOrEqual(isLarge(id) ? 600_000 : 400_000);
      // lane FURN: the furniture-only size is recorded against the manifest's
      if (FURNITURE_ONLY[id]) expect(furnitureOf(id), id).toMatchObject({manifestSizeM: TABLE[id][2], manifestSizeAxis: TABLE[id][3], sizeM: a.sizeM, sizeAxis: a.sizeAxis});
    }
    for (const o of PROV!.outputs) expect(COMPANY_ASSETS[o.id as CompanyAssetId]?.url).toBe(o.output.url);
  });

  it('every delivered GLB is at real size, grounded, centred, within its triangle budget and 1K textures', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const id of ready) {
      const a = COMPANY_ASSETS[id];
      const doc = await io.read(path.join(PUB, a.url!));
      const {min, max} = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
      const ext = [0, 1, 2].map(k => max[k] - min[k]);
      const measured = a.sizeAxis === 'h' ? ext[1] : a.sizeAxis === 'w' ? ext[0] : Math.max(...ext);
      expect(Math.abs(measured - a.sizeM) / a.sizeM, `${id} size`).toBeLessThan(0.01);
      expect(Math.max(...ext), `${id} not absurdly larger than its nominal size`).toBeLessThan((FURNITURE_ONLY[id] ? TABLE[id][2] : a.sizeM) * 3.2);
      expect(Math.abs(min[1]), `${id} grounded`).toBeLessThan(1e-3);
      expect(Math.abs(min[0] + max[0]) / a.sizeM, `${id} centred x`).toBeLessThan(0.01);
      expect(Math.abs(min[2] + max[2]) / a.sizeM, `${id} centred z`).toBeLessThan(0.01);
      for (let k = 0; k < 3; k++) expect(ext[k]).toBeCloseTo(a.dims![k], 3);
      let tris = 0;
      for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
      expect(tris).toBe(a.tris);
      // lane FURN: a separated body + the loose clutter cut out of it = the raw's triangles
      const cut = furnitureOf(id)?.removed?.tris ?? 0;
      expect(tris + cut, `${id} tris`).toBeLessThanOrEqual(a.targetTris * 1.2);
      expect(tris + cut, `${id} tris`).toBeGreaterThan(a.targetTris * 0.5);
      const mats = doc.getRoot().listMaterials();
      expect(mats.some(m => m.getBaseColorTexture()), `${id} base colour map`).toBe(true);
      expect(mats.some(m => m.getNormalTexture()), `${id} normal map (PBR kept)`).toBe(true);
      for (const t of doc.getRoot().listTextures()) expect(Math.max(...t.getSize()!), `${id} texture size`).toBeLessThanOrEqual(1024);
    }
  });

  it('public provenance carries no URLs, signed-URL tokens or credentials, and is itself allowlisted', () => {
    if (!provText) { expect(ready).toHaveLength(0); return; }
    expect(provText).not.toMatch(/https?:/i);
    expect(provText).not.toMatch(/Signature=|X-Amz|Key-Pair-Id|token=|api[_-]?key/i);
    const buf = fs.readFileSync(provPath);
    expect(ALLOW.get(PROV_REL)).toEqual({path: PROV_REL, bytes: buf.length, sha256: sha(buf)});
    // no stray office-<company id>.glb on disk that the registry does not list
    for (const id of COMPANY_ASSET_IDS) {
      const onDisk = fs.existsSync(path.join(PUB, `assets/models/office-${id}.glb`));
      expect(onDisk, `${id} file vs registry`).toBe(COMPANY_ASSETS[id].url !== null);
    }
  });

  it('lazy loader never throws: null outside a browser and for unknown ids', async () => {
    for (const id of COMPANY_ASSET_IDS.slice(0, 3)) await expect(loadCompanyAsset(id)).resolves.toBeNull();
    await expect(loadCompanyAsset('not-an-id' as CompanyAssetId)).resolves.toBeNull();
  });
});

// Task office-props-physics-scale-20261030 (lane FURN): the loose clutter separated from the lab bench / trading desk / bakery case.
describe('separated loose clutter (lane FURN)', () => {
  const PARTS = Object.entries(COMPANY_PART_ASSETS);
  type PartProv = {id: string; kind: string; sizeM: number; sizeAxis: string; output: {url: string; sha256: string; bytes: number; triangles: number; dims: number[]}};
  const provParts = (PROV?.outputs ?? []).flatMap(o => ((o as {parts?: PartProv[]}).parts ?? []).map(q => ({...q, from: o.id})));

  it('every part: own file at its own real size, grounded, centred, small own texture, in the provenance and the allowlist', async () => {
    expect(PARTS.map(([id]) => id).sort()).toEqual(['bread', 'lab-bottle', 'lab-bottle-rack', 'lab-flask', 'lab-flask-large', 'lab-microscope', 'lab-tube-rack', 'trading-keyboard', 'trading-monitor']);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const unlisted: string[] = [];
    for (const [id, p] of PARTS) {
      expect(publicPath(p.url), id).toBe(true);
      expect(p.url).toBe(p.kind === 'item' ? `assets/models/item-${id}-t25.glb` : `assets/models/office-${id}.glb`);
      expect(COMPANY_PART_DIMS[id], id).toEqual(p.dims);
      if (p.kind === 'prop') expect(COMPANY_PART_MODEL_FILES[`office-${id}`]).toEqual({url: p.url, bytes: p.bytes}); else expect(COMPANY_PART_MODEL_FILES[`office-${id}`]).toBeUndefined();
      const buf = fs.readFileSync(path.join(PUB, p.url));
      expect(buf.length, id).toBe(p.bytes);
      expect(p.bytes, `${id} small`).toBeLessThan(120_000);
      const q = provParts.find(x => x.id === id);
      expect(q, `${id} provenance`).toBeDefined();
      expect(q!.from).toBe(p.from);
      expect(q!.output).toMatchObject({url: p.url, sha256: sha(buf), bytes: buf.length, triangles: p.tris, dims: [...p.dims]});
      if (JSON.stringify(ALLOW.get(p.url)) !== JSON.stringify({path: p.url, bytes: buf.length, sha256: sha(buf)})) unlisted.push(id);
      const doc = await io.read(path.join(PUB, p.url));
      const {min, max} = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
      const ext = [0, 1, 2].map(k => max[k] - min[k]);
      const measured = p.sizeAxis === 'h' ? ext[1] : p.sizeAxis === 'w' ? ext[0] : p.sizeAxis === 'd' ? ext[2] : Math.max(...ext);
      expect(Math.abs(measured - p.sizeM), `${id} real size`).toBeLessThan(0.003);
      expect(Math.abs(min[1]), `${id} grounded`).toBeLessThan(1e-3);
      expect(Math.abs(min[0] + max[0]), `${id} centred x`).toBeLessThan(3e-3);
      expect(Math.abs(min[2] + max[2]), `${id} centred z`).toBeLessThan(3e-3);
      for (const t of doc.getRoot().listTextures()) expect(Math.max(...t.getSize()!), `${id} texture`).toBeLessThanOrEqual(256);
    }
    expect(unlisted, 'parts allowlisted (tools/release/public-inputs.json)').toEqual([]);
  });

  it('furniture-only bodies: no baked clutter left on the worktop / desk top / display shelves', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    // the lab bench and the trading desk: nothing rises above the worktop / desk top (their height IS the top: 0.9 / 0.74 m)
    for (const id of ['lab-bench', 'trading-desk'] as const) {
      expect(COMPANY_ASSETS[id].sizeAxis).toBe('h');
      expect(COMPANY_ASSETS[id].dims![1], id).toBeCloseTo(COMPANY_ASSETS[id].sizeM, 3);
      expect(furnitureOf(id)!.removed!.tris, id).toBeGreaterThan(1000);
    }
    // the bakery case: no free-standing piece left inside the display (only the case, its glass shelves and their rails)
    type Comp = {n: number; min: number[]; max: number[]; centre: number[]};
    const {components} = await import(pathToFileURL(path.join(ROOT, 'tools/asset-pipeline/props/lib/clutter-split.mjs')).href) as {components: (doc: unknown) => {comps: Comp[]}[]};
    const doc = await io.read(path.join(PUB, COMPANY_ASSETS['bakery-case'].url!));
    const k = COMPANY_ASSETS['bakery-case'].dims![1] / 1.1104;
    const inside = components(doc).flatMap(pc => pc.comps).filter(c => c.min[1] >= 0.46 * k && c.max[1] <= 0.97 * k && Math.abs(c.centre[0]) < 0.7 * k);
    expect(inside.every(c => c.max[0] - c.min[0] > 1.0 * k), JSON.stringify(inside.filter(c => c.max[0] - c.min[0] <= 1.0 * k).map(c => c.n))).toBe(true);
    expect(furnitureOf('bakery-case')!.removed!.tris).toBeGreaterThan(2000);
  });
});
