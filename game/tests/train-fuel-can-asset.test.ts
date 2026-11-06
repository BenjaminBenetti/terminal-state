// Task studio-train-fuel-can-asset-20261106-030724-01: the train FUEL CAN runtime model (assets/models/train-fuel-can.glb), delivered to
// Beta's train fuel system — a Meshy T2.5 image-to-3D derivative (Codex INITIAL concept -> Meshy; Meshy's own PBR maps kept, re-encoded),
// cooked by tools/asset-pipeline/props/build-train-fuel-can.mjs. Checks the runtime contract Beta integrates against: real size (a
// 20-litre jerrycan), grounded / centred pivot, front +Z, one PBR material, the triangle budget, provenance <-> release allowlist.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';

const MODEL = 'assets/models/train-fuel-can.glb', SIDECAR = 'assets/derivatives/train-fuel-can.json';
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('train fuel can model (asset handoff to the train fuel system)', () => {
  it('real size, grounded and centred, one Meshy PBR material, ~4k triangles; provenance and allowlist match the bytes', async () => {
    const bytes = readFileSync(pub(MODEL));
    const prov = JSON.parse(readFileSync(pub(SIDECAR), 'utf8'));
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
    const root = doc.getRoot();
    const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
    const dims = [0, 1, 2].map(k => b.max[k] - b.min[k]);
    expect(dims[1]).toBeCloseTo(0.47, 3); // a 20-litre jerrycan, handle and spout included
    expect(dims[2]).toBeCloseTo(0.165, 3); // the depth fit
    expect(dims[0]).toBeGreaterThan(0.28);
    expect(dims[0]).toBeLessThan(0.36);
    expect(Math.abs(b.min[1])).toBeLessThan(1e-4); // grounded
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(1e-3); // centred
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(1e-3);
    const tris = root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3, 0), 0);
    expect(tris).toBe(prov.output.triangles);
    expect(tris).toBeLessThan(6000);
    const mats = root.listMaterials();
    expect(mats).toHaveLength(1);
    expect(mats[0].getBaseColorTexture()).not.toBeNull();
    expect(mats[0].getMetallicRoughnessTexture()).not.toBeNull();
    expect(mats[0].getNormalTexture()).not.toBeNull();
    expect(mats[0].getAlphaMode()).toBe('OPAQUE');
    for (const n of root.listNodes()) expect(n.getMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // baked
    // provenance + release allowlist bind these exact bytes
    expect(prov).toMatchObject({id: 'train-fuel-can', accepted: true, output: {url: MODEL, bytes: bytes.length, sha256: sha(bytes)}});
    expect(prov.convention).toMatch(/front \+Z/);
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature|X-Amz|token=/i);
    const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    const side = readFileSync(pub(SIDECAR));
    expect(allow.get(MODEL)).toEqual({path: MODEL, bytes: bytes.length, sha256: sha(bytes)});
    expect(allow.get(SIDECAR)).toEqual({path: SIDECAR, bytes: side.length, sha256: sha(side)});
  });
});
