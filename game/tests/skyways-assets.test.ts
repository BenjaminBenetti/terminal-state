// Task skyways-level-20261106-054448 (lane ASSET-A): the Skyways runtime derivatives of the user-supplied COMMUNITY Meshy sources
// (sky-ways.zip: food pickups, the sushi-mascot figurine, kitchen gear, street wrecks), cooked by
// tools/asset-pipeline/props/build-skyways-sources.mjs. Per file: the real-size fit (the row's reference measure ±1 cm), grounded /
// centred / baked pivot, the triangle budget, plain glTF with one PBR material and the expected map slots / sizes, the registry
// (SKYWAYS_PROP_MODELS) = the measured bounds, provenance <-> bytes, and the release allowlist entries.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {SKYWAYS_PROP_MODELS} from '../src/assets/skywaysProps.generated';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ALL_MAPS = ['baseColor', 'metallicRoughness', 'normal'];

type Fit = {x: number} | {y: number} | {maxXZ: number} | {rim: number};
interface Row { key: keyof typeof SKYWAYS_PROP_MODELS; id: string; fit: Fit; tris: number; base: number; other: number; maps: string[]; wreck?: boolean }
/** The brief's table (lane ASSET-A): target size, triangle budget, map sizes; the map slots are the source's. */
const ROWS: Row[] = [
  {key: 'item_ramen_bowl', id: 'item-ramen-bowl', fit: {rim: 0.20}, tris: 4000, base: 512, other: 512, maps: ['baseColor']},
  {key: 'item_ramen_chashu', id: 'item-ramen-chashu', fit: {rim: 0.22}, tris: 4000, base: 512, other: 512, maps: ALL_MAPS},
  {key: 'item_bubble_tea', id: 'item-bubble-tea', fit: {y: 0.24}, tris: 3000, base: 512, other: 512, maps: ['baseColor']},
  {key: 'item_sushi_bento', id: 'item-sushi-bento', fit: {maxXZ: 0.24}, tris: 3000, base: 512, other: 512, maps: ['baseColor']},
  {key: 'skyways_sushi_mascot', id: 'skyways-sushi-mascot', fit: {y: 0.32}, tris: 6000, base: 512, other: 512, maps: ['baseColor']},
  {key: 'skyways_stock_pot', id: 'skyways-stock-pot', fit: {x: 0.42}, tris: 3000, base: 512, other: 512, maps: ALL_MAPS},
  {key: 'skyways_saucepan', id: 'skyways-saucepan', fit: {x: 0.46}, tris: 2500, base: 512, other: 512, maps: ALL_MAPS},
  {key: 'skyways_commercial_range', id: 'skyways-commercial-range', fit: {x: 1.52}, tris: 12000, base: 1024, other: 512, maps: ALL_MAPS},
  {key: 'skyways_wreck_sedan_stripped', id: 'skyways-wreck-sedan-stripped', fit: {x: 4.6}, tris: 3512, base: 1024, other: 512, maps: ALL_MAPS, wreck: true},
  {key: 'skyways_wreck_sedan_rust', id: 'skyways-wreck-sedan-rust', fit: {x: 4.75}, tris: 12000, base: 1024, other: 512, maps: ALL_MAPS, wreck: true},
  {key: 'skyways_wreck_sedan_burnt', id: 'skyways-wreck-sedan-burnt', fit: {x: 4.75}, tris: 12000, base: 1024, other: 512, maps: ALL_MAPS, wreck: true},
  {key: 'skyways_wreck_army_truck', id: 'skyways-wreck-army-truck', fit: {x: 7.6}, tris: 15000, base: 1024, other: 512, maps: ALL_MAPS, wreck: true},
  {key: 'skyways_wreck_suv', id: 'skyways-wreck-suv', fit: {x: 4.9}, tris: 12000, base: 1024, other: 512, maps: ALL_MAPS, wreck: true},
];
const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));

describe('Skyways community-source derivatives (lane ASSET-A)', () => {
  it('the registry lists exactly the brief rows', () => {
    expect(Object.keys(SKYWAYS_PROP_MODELS).sort()).toEqual(ROWS.map(r => r.key).sort());
  });

  for (const row of ROWS) {
    it(`${row.id}: real size, grounded / centred, budget, maps, registry, provenance and allowlist`, async () => {
      const url = `assets/models/${row.id}.glb`, provRel = `assets/derivatives/${row.id}.json`;
      const bytes = readFileSync(pub(url));
      const provBytes = readFileSync(pub(provRel));
      const prov = JSON.parse(provBytes.toString());
      const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
      const root = doc.getRoot();
      // plain glTF: one identity node / mesh / triangle primitive / opaque material; no Draco / meshopt / KTX2
      expect(root.listExtensionsUsed()).toEqual([]);
      expect(root.listNodes()).toHaveLength(1);
      expect(root.listNodes()[0].getMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      expect(root.listMeshes()).toHaveLength(1);
      const prims = root.listMeshes()[0].listPrimitives();
      expect(prims).toHaveLength(1);
      expect(prims[0].getMode()).toBe(4);
      expect(root.listMaterials()).toHaveLength(1);
      // bounds: grounded, centred, the reference measure at its real size (±1 cm)
      const b = getBounds(root.getDefaultScene()!);
      const dims = [0, 1, 2].map(k => b.max[k] - b.min[k]);
      expect(Math.abs(b.min[1])).toBeLessThan(1e-4);
      expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(1e-3);
      expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(1e-3);
      const f = row.fit;
      if ('x' in f) expect(Math.abs(dims[0] - f.x)).toBeLessThan(0.01);
      if ('y' in f) expect(Math.abs(dims[1] - f.y)).toBeLessThan(0.01);
      if ('maxXZ' in f) expect(Math.abs(Math.max(dims[0], dims[2]) - f.maxXZ)).toBeLessThan(0.01);
      if ('rim' in f) {
        // rim diameter = mean x / z extent of the geometry at or below the recorded rim band (food overhanging above it excluded)
        const top = prov.fit.rimBandTopY as number;
        expect(top).toBeGreaterThan(0.3 * dims[1]);
        const P = prims[0].getAttribute('POSITION')!.getArray()!;
        const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
        for (let i = 0; i < P.length; i += 3) if (P[i + 1] <= top + 1e-6) {
          lo[0] = Math.min(lo[0], P[i]); hi[0] = Math.max(hi[0], P[i]); lo[1] = Math.min(lo[1], P[i + 2]); hi[1] = Math.max(hi[1], P[i + 2]);
        }
        expect(Math.abs((hi[0] - lo[0] + hi[1] - lo[1]) / 2 - f.rim)).toBeLessThan(0.01);
      }
      if (row.wreck) {   // long along X, nose at +X
        expect(dims[0]).toBeGreaterThan(1.8 * dims[2]);
        expect(prov.convention).toMatch(/nose at \+X/);
      }
      expect(prov.convention).toMatch(/^metres at real size, \+Y up; /);
      // triangle budget
      const tris = prims[0].getIndices()!.getCount() / 3;
      expect(tris).toBeLessThanOrEqual(row.tris);
      expect(tris).toBeGreaterThan(0.9 * row.tris);
      // maps: the source's slots, JPEG, at the listed sizes
      const mat = root.listMaterials()[0];
      expect(mat.getAlphaMode()).toBe('OPAQUE');
      const slots: [string, ReturnType<typeof mat.getBaseColorTexture>][] = [['baseColor', mat.getBaseColorTexture()], ['metallicRoughness', mat.getMetallicRoughnessTexture()],
        ['normal', mat.getNormalTexture()], ['occlusion', mat.getOcclusionTexture()], ['emissive', mat.getEmissiveTexture()]];
      expect(slots.filter(([, t]) => t).map(([s]) => s)).toEqual(row.maps);
      for (const [slot, t] of slots) if (t) {
        expect(t.getMimeType()).toBe('image/jpeg');
        const px = slot === 'baseColor' ? row.base : row.other;
        expect(t.getSize()).toEqual([px, px]);
      }
      if (!mat.getEmissiveTexture()) expect(mat.getEmissiveFactor()).toEqual([0, 0, 0]);
      // registry = measured runtime bounds
      const reg = SKYWAYS_PROP_MODELS[row.key];
      expect(reg.url).toBe(url);
      expect(Math.abs(reg.w - dims[0])).toBeLessThan(1e-3);
      expect(Math.abs(reg.h - dims[1])).toBeLessThan(1e-3);
      expect(Math.abs(reg.d - dims[2])).toBeLessThan(1e-3);
      expect(reg.tris).toBe(tris);
      // provenance binds these bytes; community source statement; no URLs / tokens
      expect(prov).toMatchObject({id: row.id, key: row.key, output: {url, bytes: bytes.length, sha256: sha(bytes), triangles: tris}});
      expect(prov.licence).toMatch(/community-supplied source via the user \(sky-ways\.zip\); creator \/ license links pending; no license or authorship claim/);
      expect(prov.source.member).toMatch(/^sky-ways\/Meshy_AI_.+\.glb$/);
      expect(prov.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prov.source.triangles).toBeGreaterThanOrEqual(tris);
      expect(['source-uv', 'rebake']).toContain(prov.method);
      expect(provBytes.toString()).not.toMatch(/https?:|Signature|X-Amz|token=/i);
      // release allowlist
      expect(allow.get(url)).toEqual({path: url, bytes: bytes.length, sha256: sha(bytes)});
      expect(allow.get(provRel)).toEqual({path: provRel, bytes: provBytes.length, sha256: sha(provBytes)});
    });
  }
});
