// Meshy T2.5 game-model replacement (task studio-meshy-game-replacement-20261029-01, lane PROPS): the reference-conditioned
// Meshy T2.5 derivatives of the locally generated props / consumable items / light fixture. Asset, provenance and restore-map
// integrity; registries point at the NEW (-t25) files; the derivative keeps the existing gameplay footprint, origin and budgets;
// openables re-cut from the new geometry; no live code path names a replaced file.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {MODEL_FILES} from '../src/assets/manifest';
import {P7_MODELS} from '../src/gen/props07.catalog';
import {P7_FILES, P7_PROP_DEFS} from '../src/gen/props07';
import {PROP_DEFS, type PropKind} from '../src/gen/props';
import {itemDims} from '../src/items/items';
import {OpenableSet} from '../src/world/openables';
import {openableSpec, type OpenableKind} from '../src/world/openablesSpec';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {loadStripped} from './helpers/openablesFixture';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(GAME, '..');
const BASE = 'a7a646a1dd62bf1c641fe3dd0d1187ab322afe87';
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/, HEX40 = /^[0-9a-f]{40}$/;

interface Rec {
  id: string; runtimeKeys: string[]; p7Key?: string; class: string;
  output: {path: string; url: string; sha256: string; bytes: number; triangles: number; textures: {slot: string; size: number[]; mime: string}[]; dims: number[]; bbox: {min: number[]; max: number[]}; doubleSided: boolean; budget: {tris: number; totalTris?: number; color: number; mr: number; normal: number; bytes: number}};
  meshy: {taskId: string; nativeSha256: string; nativeGlb: string; inputImage: {path: string; sha256: string}; review: string; usedDespiteFlag?: {reason: string}};
  transform: {anchor: 'bottom' | 'top'};
  hybrid?: {interiorSurfaces: unknown[]; nodes: string[]};
  replaces: {path: string; triangles: number; bbox: {size: number[]}};
  restore: {path: string; baseCommit: string; blobSha1: string; command: string};
}
const CLASSES = ['props', 'items', 'light'] as const;
const PROV = Object.fromEntries(CLASSES.map(c => {
  const f = path.join(GAME, `public/assets/derivatives/meshy-t25-${c}-20261029.json`);
  return [c, fs.existsSync(f) ? {text: fs.readFileSync(f, 'utf8'), doc: JSON.parse(fs.readFileSync(f, 'utf8')) as {task: string; baseCommit: string; records: Rec[]}} : null];
})) as Record<(typeof CLASSES)[number], {text: string; doc: {task: string; baseCommit: string; records: Rec[]}} | null>;
const RECORDS: (Rec & {cls: string})[] = CLASSES.flatMap(c => (PROV[c]?.doc.records ?? []).map(r => ({...r, cls: c})));
/** Earlier-prop runtime keys whose instancing fit is a PROP_DEFS kind (world/builder.ts MODEL_FOR, openables). */
const KIND_OF: Record<string, PropKind> = {trashCan: 'bin', bench: 'bench', cabinetTall: 'cabinetTall', cabinetLow: 'cabinetLow', stall: 'stall', vending: 'vending', shelf: 'shelf', crate: 'crate'};

describe('Meshy T2.5 prop / item / light derivatives: files, budgets, provenance', () => {
  it('at least the pilot set is integrated', () => {
    for (const id of ['base:trashCan', 'p7:filingCabinet', 'base:item_water', 'base:light']) expect(RECORDS.some(r => r.id === id), id).toBe(true);
  });

  it('every record: file hash / size, plain glTF, one primitive, identity node, budgets, measured dims and origin', async () => {
    const io = new NodeIO();
    for (const r of RECORDS) {
      const file = path.join(REPO, r.output.path);
      expect(fs.existsSync(file), r.id).toBe(true);
      expect(sha(file), r.id).toBe(r.output.sha256);
      expect(fs.statSync(file).size, r.id).toBe(r.output.bytes);
      expect(r.output.path, r.id).toBe(`game/public/${r.output.url}`);
      expect(path.basename(r.output.path), r.id).toBe(path.basename(r.restore.path, '.glb') + '-t25.glb');
      const json = JSON.parse(Buffer.from(fs.readFileSync(file)).subarray(20, 20 + fs.readFileSync(file).readUInt32LE(12)).toString('utf8'));
      expect(json.extensionsUsed ?? [], `${r.id} plain glTF (loader has no Draco / meshopt / KTX2)`).toEqual([]);
      const doc = await io.read(file);
      const prims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
      for (const n of doc.getRoot().listNodes()) expect(n.getMatrix(), r.id).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      expect(prims.reduce((t, q) => t + q.getIndices()!.getCount() / 3, 0), r.id).toBe(r.output.triangles);
      expect(r.output.triangles, r.id).toBeLessThanOrEqual(r.output.budget.totalTris ?? r.output.budget.tris);
      if (r.hybrid) {
        // open-front hybrid: T2.5 body + authored interior + transparent glass (BLEND), exactly three nodes / materials
        expect(doc.getRoot().listNodes().filter(n => n.getMesh()).map(n => n.getName()).sort(), r.id).toEqual(r.hybrid.nodes.slice().sort());
        expect(r.hybrid.nodes.slice(0, 3), r.id).toEqual(['body', 'interior', 'glass']);
        const glass = doc.getRoot().listNodes().find(n => n.getName() === 'glass')!.getMesh()!.listPrimitives()[0].getMaterial()!;
        expect(glass.getAlphaMode(), r.id).toBe('BLEND');
        if (r.runtimeKeys.includes('shopCooler') || r.runtimeKeys.includes('shopDisplay')) expect(r.hybrid.interiorSurfaces.length, r.id).toBeGreaterThan(1);
        continue;
      }
      expect(prims.length, r.id).toBe(1);
      const p = prims[0];
      expect(r.output.bytes, r.id).toBeLessThanOrEqual(r.output.budget.bytes);
      const m = p.getMaterial()!;
      expect(m.getBaseColorTexture()?.getSize(), r.id).toEqual([r.output.budget.color, r.output.budget.color]);
      expect(m.getMetallicRoughnessTexture()?.getSize(), r.id).toEqual([r.output.budget.mr, r.output.budget.mr]);
      if (m.getNormalTexture()) expect(m.getNormalTexture()!.getSize(), r.id).toEqual([r.output.budget.normal, r.output.budget.normal]);
      expect(m.getAlphaMode()).toBe('OPAQUE');
      expect(m.getDoubleSided(), r.id).toBe(r.output.doubleSided);
      const pos = p.getAttribute('POSITION')!, mn = pos.getMin([]), mx = pos.getMax([]);
      for (let k = 0; k < 3; k++) expect(Math.abs(mx[k] - mn[k] - r.output.dims[k]), `${r.id} dim ${k}`).toBeLessThan(0.001);
      expect(Math.abs(mx[0] + mn[0]), `${r.id} centred x`).toBeLessThan(0.001);
      expect(Math.abs(mx[2] + mn[2]), `${r.id} centred z`).toBeLessThan(0.001);
      if (r.transform.anchor === 'top') expect(Math.abs(mx[1]), `${r.id} top at 0`).toBeLessThan(1e-4);
      else expect(Math.abs(mn[1]), `${r.id} bottom at 0`).toBeLessThan(1e-4);
      // Meshy UVs kept intact: inside the atlas
      const uv = p.getAttribute('TEXCOORD_0')!, umn = uv.getMin([]), umx = uv.getMax([]);
      expect(Math.min(...umn), r.id).toBeGreaterThanOrEqual(-1e-4);
      expect(Math.max(...umx), r.id).toBeLessThanOrEqual(1 + 1e-4);
    }
  });

  it('provenance: Meshy task, native + ORIGINAL input image hashes, restore map at the pushed base; no URLs / secrets', () => {
    for (const c of CLASSES) {
      const p = PROV[c];
      if (!p) continue;
      expect(p.doc.task).toBe('studio-meshy-game-replacement-20261029-01');
      expect(p.doc.baseCommit).toBe(BASE);
      expect(p.text, c).not.toMatch(/https?:\/\/|X-Amz|Signature=|token|api[_-]?key/i);
    }
    for (const r of RECORDS) {
      expect(r.meshy.taskId, r.id).toMatch(/^[0-9a-f-]{36}$/);
      // accepted by lane MESHY, or a flagged delivery the primary allowed with a documented local fix (e.g. the beans label)
      if (r.meshy.review !== 'accepted') { expect(r.meshy.review, r.id).toMatch(/^flagged/); expect(r.meshy.usedDespiteFlag?.reason?.length, r.id).toBeGreaterThan(20); }
      expect(r.meshy.nativeSha256, r.id).toMatch(HEX64);
      expect(r.meshy.nativeGlb, r.id).toMatch(/^reference\/tasks\/meshy-game-replacement-20261029\/assets\/raw\/.+\/native\.glb$/);
      expect(r.meshy.inputImage.sha256, r.id).toMatch(HEX64);
      expect(r.meshy.inputImage.path, r.id).toMatch(/^(reference|public\/vision-board)\//);
      expect(r.restore.baseCommit).toBe(BASE);
      expect(r.restore.blobSha1, r.id).toMatch(HEX40);
      expect(r.restore.command, r.id).toBe(`git show ${BASE}:${r.restore.path} > ${r.restore.path}`);
      expect(r.restore.path, r.id).toBe(r.replaces.path);
    }
  });
});

describe('registries use the new files; the gameplay footprint is unchanged', () => {
  it('every runtime key resolves to the T2.5 file (manifest / lazy p7 catalog)', () => {
    for (const r of RECORDS) for (const key of r.runtimeKeys) {
      if (r.p7Key) {
        const m = (P7_MODELS as Record<string, {url: string; mode: string; bytes: number}>)[r.p7Key];
        expect(m.url, r.id).toBe(r.output.url);
        expect(m.mode, r.id).toBe('T25');
        expect(P7_FILES[key].url, r.id).toBe(r.output.url);
      } else {
        expect((MODEL_FILES as Record<string, {url: string; bytes: number}>)[key]?.url, `${r.id} ${key}`).toBe(r.output.url);
        expect(Math.abs(MODEL_FILES[key as keyof typeof MODEL_FILES].bytes - r.output.bytes) / r.output.bytes, `${r.id} progress weight`).toBeLessThan(0.05);
      }
    }
  });

  it('props keep their footprint (PROP_DEFS / P7_PROP_DEFS / old runtime box); items keep their height; the light keeps 1.2 m', () => {
    for (const r of RECORDS) {
      if (r.cls === 'props') {
        const def = r.p7Key ? (P7_PROP_DEFS as Record<string, {w: number; h: number; d: number}>)[r.p7Key] : KIND_OF[r.runtimeKeys[0]] ? PROP_DEFS[KIND_OF[r.runtimeKeys[0]]] : null;
        const want = def ? [def.w, def.h, def.d] : r.replaces.bbox.size;
        for (let k = 0; k < 3; k++) expect(Math.abs(r.output.dims[k] - want[k]), `${r.id} dim ${k}`).toBeLessThan(def ? 0.0011 : 0.002);
      } else if (r.cls === 'items') {
        expect(Math.abs(r.output.dims[1] - r.replaces.bbox.size[1]), r.id).toBeLessThan(0.001);
        // world/pickups.ts fitItemModel: uniform scale min(h, 1.25 w, 1.25 d) — the model must not be squeezed by its width
        const d = itemDims(r.runtimeKeys[0].replace(/^item_/, ''));
        expect(r.output.dims[0] * d.h / r.output.dims[1], r.id).toBeLessThanOrEqual(1.25 * d.w + 1e-6);
      } else {
        expect(r.output.dims[0]).toBeCloseTo(1.2, 3);
        expect(r.output.dims[1]).toBeGreaterThan(0.17);
        expect(r.output.dims[1]).toBeLessThan(0.21);
      }
    }
  });

  it('no live code path names a replaced runtime file', () => {
    const src: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|js|mjs|html|json)$/.test(e.name)) src.push(f); } };
    walk(path.join(GAME, 'src'));
    const text = src.map(f => fs.readFileSync(f, 'utf8')).join('\n');
    for (const r of RECORDS) {
      const old = r.restore.path.replace(/^game\/public\//, '');
      expect(text.includes(old), `${r.id}: game/src still names ${old}`).toBe(false);
    }
  });
});

describe('openables re-cut from the T2.5 geometry', () => {
  let models: Record<string, GLTF> = {};
  beforeAll(async () => {
    for (const r of RECORDS) for (const k of r.runtimeKeys) if (['trashCan', 'p7_filingCabinet', 'p7_fireExtinguisherCabinet'].includes(k)) models[k] = await loadStripped(r.output.url);
  }, 60000);

  it('trash can: the hood (above the band) lifts as the lid; the body keeps band, slats and drum', () => {
    const set = new OpenableSet();
    set.setModels(models);
    const m = set.model('bin' as OpenableKind);
    expect(m.source).toMatch(/runtime split/);
    const lid = m.parts[0].bounds;
    expect(lid.min.y).toBeGreaterThanOrEqual(0.746 - 1e-3);
    expect(lid.max.y).toBeGreaterThan(0.93);
    expect(lid.max.x - lid.min.x).toBeGreaterThan(0.48); // the whole hood (r 0.257), not a fragment
    const body = new THREE.Box3();
    for (const b of m.body) { b.geo.computeBoundingBox(); body.union(b.geo.boundingBox!); }
    expect(body.max.y).toBeLessThan(0.75);
    expect(body.max.x - body.min.x).toBeGreaterThan(0.53);
  });

  it('fire-extinguisher cabinet: the glazed door frame swings away; the liner, bracket and the real extinguisher stay inside', () => {
    if (!models.p7_fireExtinguisherCabinet) return;
    const set = new OpenableSet();
    set.setModels(models);
    const m = set.model('fireExtinguisherCabinet' as OpenableKind);
    const door = m.parts[0];
    expect(door.moving.map(q => q.mat.name).sort()).toEqual(['fireExtinguisherCabinet-open-baked', 'fireExtinguisherCabinet-open-glass']);
    expect(door.bounds.min.z).toBeGreaterThanOrEqual(0.14 - 1e-4);   // only the door frame + glass: no solid baked front left behind
    const bodyMats = m.body.map(b => b.mat.name);
    expect(bodyMats).toContain('fireExtinguisherCabinet-open-authored');   // inward liner (no emissive cell)
    expect(bodyMats).toContain('fireExtinguisherCabinet-extinguisher');
    const ext = m.body.find(b => b.mat.name === 'fireExtinguisherCabinet-extinguisher')!.geo;
    ext.computeBoundingBox();
    const bb = ext.boundingBox!;
    expect(bb.max.z).toBeLessThan(0.135);   // fully inside the liner, behind the door
    expect(bb.max.y - bb.min.y).toBeGreaterThan(0.45);
  });

  it('filing cabinet: each drawer front (z 0.292, handles to 0.32) is cut whole within its seam band', () => {
    const set = new OpenableSet();
    set.setModels(models);
    const m = set.model('filingCabinet' as OpenableKind);
    const spec = openableSpec('filingCabinet')!;
    m.parts.forEach((pm, i) => {
      const b = pm.bounds, r = spec.parts[i].region![0];
      expect(b.max.z, `drawer ${i} front`).toBeGreaterThan(0.315);
      expect(b.min.z, `drawer ${i} cut`).toBeGreaterThanOrEqual(r[2] - 1e-4);
      expect(b.max.x - b.min.x, `drawer ${i} width`).toBeGreaterThan(0.4);
      expect(b.max.y - b.min.y, `drawer ${i} height`).toBeGreaterThan(0.27);
      const verts = pm.moving.reduce((n, q) => n + q.geo.attributes.position.count, 0);
      expect(verts, `drawer ${i}`).toBeGreaterThan(60);
    });
  });
});
