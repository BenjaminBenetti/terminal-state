// Task studio-beta-mall-round3-20261031-01 (lane SHOPS, sub-lane SHOPS-MANNEQUIN, R4 — user: "no female clothing store ... Make sure to
// make a female maniqune. This asset will be handy in other spots, because it will be spooooky!"): the female mannequin kind
// `mannequinFemale` renders the registered model 'mannequin-female' (M81) — the primary's accepted Meshy T2.5 model (task
// studio-beta-mall-round3-recovery01-20261101-01, 15 credits), cooked by tools/asset-pipeline/props/build-mall-track3.mjs EXTRA (rotate to
// front -Z, uniform 1.75 m, meshopt decimation to ~3k tris, lean textures). Checks: registration / allowlist / provenance hashes and the
// raw / task records, runtime dims == PROP_DEFS, real height, triangle / byte budgets, one connected figure + base (no loose parts), and
// the kind's physics / openables classification. Repo files only (the raw master stays outside Git): runs in CI.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MALL_ASSETS} from '../src/assets/mallAssets';
import {MALL_ASSET_SPECS, MALL_DIMS} from '../src/assets/mallDims.generated';
import {MALL_KIND_ASSET, MALL_OPEN_AUDIT, MALL_PHYS} from '../src/gen/mall/kinds';
import {PROP_DEFS} from '../src/gen/props';
import {propPhysics} from '../src/damage/materials';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(GAME, 'public');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const PROV = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/derivatives/mall-track3-20261031.json'), 'utf8')) as {
  outputs: {id: string}[];
  extraOutputs: {id: string; code: string; task: string; model: string; front: string; tasks: {preview: string; refine: string}; credits: {preview: number; refine: number};
    previewPrompt: string; source: {file: string; sha256: string; triangles: number; previewSha256: string}; recipe: {rebuild: string};
    output: {url: string; sha256: string; bytes: number; triangles: number; dims: number[]; overBudget: boolean}; budget: number}[];
};
const ALLOW = new Map((JSON.parse(fs.readFileSync(path.join(GAME, '../tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]})
  .files.map(f => [f.path, f]));
const ID = 'mannequin-female';
const REC = PROV.extraOutputs?.find(o => o.id === ID);

describe('R4 female mannequin (mannequinFemale -> mannequin-female, Meshy M81)', () => {
  it('is registered, allowlisted and provenance-backed (file == allowlist == provenance; raw / task records)', () => {
    expect(MALL_KIND_ASSET.mannequinFemale).toBe(ID);
    const a = MALL_ASSETS[ID];
    expect(a).toMatchObject({url: `assets/models/mall-${ID}.glb`, code: 'M81', key: `office-${ID}`});
    const buf = fs.readFileSync(path.join(PUB, a.url!));
    expect(buf.length).toBe(a.bytes);
    expect(ALLOW.get(a.url!)).toEqual({path: a.url, bytes: buf.length, sha256: sha(buf)});
    expect(REC, 'extraOutputs record').toBeTruthy();
    expect(REC!.output).toMatchObject({url: a.url, sha256: sha(buf), bytes: buf.length, triangles: a.tris});
    expect(PROV.outputs.some(o => o.id === ID)).toBe(false); // one record, one female mannequin file
    expect(REC!.task).toBe('studio-beta-mall-round3-recovery01-20261101-01');
    expect(REC!.model).toBe('meshy-t2.5');
    expect(REC!.tasks).toEqual({preview: '01a194a9-c952-7340-b132-c041398af9bf', refine: '01a194aa-df73-77e5-9f7f-76471ce0adf7'});
    expect(REC!.credits).toEqual({preview: 5, refine: 10});
    expect(REC!.source.sha256).toBe('45667bd25a8d44977566cf9b7f141246ad7d76c1b61a82e95498397890c4ff0f'); // the accepted raw refine (outside Git)
    expect(REC!.source.file).toContain('mall-round3-recovery01-20261101/meshy/raw/a1-refine-01a194aa.glb');
    expect(REC!.previewPrompt).toMatch(/female/i);
    expect(REC!.front).toBe('-Z');
    expect(REC!.recipe.rebuild).toContain('--only M81');
  });

  it('runtime dims == PROP_DEFS (collider = visual), real height incl. the base, triangle / byte budget', () => {
    const d = MALL_DIMS[ID], def = PROP_DEFS.mannequinFemale;
    expect(d).toEqual(REC!.output.dims);
    expect(def.w).toBeCloseTo(d[0], 3); expect(def.h).toBeCloseTo(d[1], 3); expect(def.d).toBeCloseTo(d[2], 3);
    expect(d[1]).toBeGreaterThanOrEqual(1.72); expect(d[1]).toBeLessThanOrEqual(1.78);
    expect(MALL_ASSET_SPECS[ID]).toMatchObject({code: 'M81', sizeM: d[1], sizeAxis: 'h', shopsKind: 'mannequinFemale'});
    expect(Math.max(d[0], d[2])).toBeLessThan(0.6); // a narrow standing figure on its round base
    expect(MALL_ASSETS[ID].tris).toBeLessThanOrEqual(3200); // decimated from the raw's ~10.5k to the M07 class (~3k)
    expect(REC!.source.triangles).toBeGreaterThan(MALL_ASSETS[ID].tris);
    expect(REC!.output.overBudget).toBe(false);
    expect(MALL_ASSETS[ID].bytes).toBeLessThanOrEqual(REC!.budget);
  });

  it('kind classification: dynamic light pad body (~9 kg), nothing to open (audited)', () => {
    expect(MALL_PHYS.mannequinFemale).toMatchObject({dynamic: true, mat: 'pad'});
    const ph = propPhysics('mannequinFemale');
    expect(ph.dynamic).toBe(true);
    expect(ph.mass).toBeGreaterThanOrEqual(6); expect(ph.mass).toBeLessThanOrEqual(12);
    expect(MALL_OPEN_AUDIT.mannequinFemale).toMatchObject({role: 'decor', cls: 'none'});
    expect(OPENABLE_AUDIT.find(e => e.kind === 'mannequinFemale')).toMatchObject({cls: 'none'});
  });

  it('one connected figure + base plate + rod (no loose parts), grounded on the plate, one material', async () => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(PUB, MALL_ASSETS[ID].url!));
    const V: number[][] = [], T: number[][] = [], key = new Map<string, number>();
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const P = p.getAttribute('POSITION')!, I = p.getIndices()!.getArray()!, map: number[] = [], v = [0, 0, 0];
      for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); const k = v.map(c => Math.round(c * 1e5)).join(','); if (!key.has(k)) { key.set(k, V.length); V.push([...v]); } map.push(key.get(k)!); }
      for (let t = 0; t < I.length; t += 3) T.push([map[I[t]], map[I[t + 1]], map[I[t + 2]]]);
    }
    expect(doc.getRoot().listMaterials().map(m => m.getName())).toEqual([`mall-${ID}`]);
    // connected components, then their bounding boxes must chain into ONE cluster (touching within 5 mm)
    const par = V.map((_, i) => i), f = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (const [a, b, c] of T) { par[f(b)] = f(a); par[f(c)] = f(a); }
    const boxes = new Map<number, {min: number[]; max: number[]}>();
    V.forEach((v, i) => { const r = f(i), bb = boxes.get(r) ?? {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}; for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], v[k]); bb.max[k] = Math.max(bb.max[k], v[k]); } boxes.set(r, bb); });
    const bs = [...boxes.values()], q = bs.map((_, i) => i), g = (x: number): number => { while (q[x] !== x) x = q[x]; return x; };
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if ([0, 1, 2].every(k => bs[i].min[k] <= bs[j].max[k] + 0.005 && bs[j].min[k] <= bs[i].max[k] + 0.005)) q[g(j)] = g(i);
    expect(new Set(bs.map((_, i) => g(i))).size, `${bs.length} components`).toBe(1);
    // grounded on the base plate: the lowest geometry is a broad disc (not a toe / the rod)
    expect(Math.min(...V.map(v => v[1]))).toBeCloseTo(0, 4);
    const low = V.filter(v => v[1] < 0.01), span = (k: number) => Math.max(...low.map(v => v[k])) - Math.min(...low.map(v => v[k]));
    expect(span(0)).toBeGreaterThan(0.3); expect(span(2)).toBeGreaterThan(0.3);
  });
});
