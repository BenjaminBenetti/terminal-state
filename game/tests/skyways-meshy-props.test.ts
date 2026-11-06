// Task skyways-level-20261106-054448 (lane ASSET-D): the runtime derivatives of the 7 NEW Skyways Meshy T2.5 props (Codex initial
// conditioning image -> Meshy image-to-3D; Meshy's own PBR maps kept, re-encoded / downsized only), cooked by
// tools/asset-pipeline/props/build-skyways-meshy-props.mjs. Per file: the real-size fit (the row's reference measure), grounded / centred /
// baked pivot, the triangle budget, plain glTF with one opaque material carrying all three Meshy maps at the listed sizes, the measured
// heights (stage deck, table top, stanchion eye ring), the registry (SKYWAYS_MESHY_PROPS) = the measured bounds, provenance <-> bytes
// (Meshy task id, ledger rows, input / raw sha256; no URLs or signatures), and the release allowlist entries.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {SKYWAYS_MESHY_PROPS} from '../src/assets/skywaysMeshyProps.generated';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

type Fit = {x: number} | {y: number} | {top: number};
interface Row { key: keyof typeof SKYWAYS_MESHY_PROPS; id: string; task: string; fit: Fit; tris: number | null; tex: [number, number, number] }
/** The brief's table (lane ASSET-D): real size, triangle budget (null = as delivered), map sizes [base, metallicRoughness, normal]. */
const ROWS: Row[] = [
  {key: 'skyways_car_dash', id: 'skyways-car-dash', task: '01a1afa4-8d4f-738a-8c31-5a194142b36e', fit: {x: 1.48}, tris: null, tex: [2048, 1024, 1024]},
  {key: 'skyways_car_seat', id: 'skyways-car-seat', task: '01a1afa4-ad71-77c7-a741-30910b08ce0c', fit: {y: 1.12}, tris: null, tex: [1024, 1024, 1024]},
  {key: 'skyways_con_stage', id: 'skyways-con-stage', task: '01a1afa4-cad1-77b0-a873-7430f1d1e4b6', fit: {x: 8.0}, tris: null, tex: [1024, 1024, 1024]},
  {key: 'skyways_con_merch_table', id: 'skyways-con-merch-table', task: '01a1afa4-e79c-746b-8d33-d9acd2ff2ddc', fit: {top: 1.83}, tris: 6000, tex: [512, 512, 512]},
  {key: 'skyways_con_figure_box', id: 'skyways-con-figure-box', task: '01a1afa5-06c1-74fe-a167-ec30f448c450', fit: {y: 0.24}, tris: 3000, tex: [512, 512, 512]},
  {key: 'skyways_con_plush', id: 'skyways-con-plush', task: '01a1afa5-24eb-77fc-afb6-408cedfbf538', fit: {y: 0.34}, tris: 5000, tex: [512, 512, 512]},
  {key: 'skyways_prize_stanchion', id: 'skyways-prize-stanchion', task: '01a1afa5-4191-7502-93db-8ea03873f740', fit: {y: 0.96}, tris: 2500, tex: [512, 512, 512]},
];
const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

async function load(url: string) {
  const bytes = readFileSync(pub(url));
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  return {bytes, root, prim, P: prim.getAttribute('POSITION')!.getArray()!, I: prim.getIndices()!.getArray()!};
}

/** Max y per 1 cm column (top-down height map) of the cells inside the x / z window: the flat top under the window. */
function topHeights(P: ArrayLike<number>, I: ArrayLike<number>, x: [number, number], z: [number, number], cell = 0.01) {
  const nx = Math.ceil((x[1] - x[0]) / cell), nz = Math.ceil((z[1] - z[0]) / cell), H = new Float32Array(nx * nz).fill(-Infinity);
  for (let f = 0; f < I.length; f += 3) {
    const [a, b, c] = [3 * I[f], 3 * I[f + 1], 3 * I[f + 2]];
    const area = (P[b] - P[a]) * (P[c + 2] - P[a + 2]) - (P[c] - P[a]) * (P[b + 2] - P[a + 2]);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(P[a], P[b], P[c]) - x[0]) / cell)), i1 = Math.min(nx - 1, Math.floor((Math.max(P[a], P[b], P[c]) - x[0]) / cell));
    const k0 = Math.max(0, Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z[0]) / cell)), k1 = Math.min(nz - 1, Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z[0]) / cell));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const px = x[0] + (i + 0.5) * cell, pz = z[0] + (k + 0.5) * cell;
      const w0 = ((P[b] - px) * (P[c + 2] - pz) - (P[c] - px) * (P[b + 2] - pz)) / area, w1 = ((P[c] - px) * (P[a + 2] - pz) - (P[a] - px) * (P[c + 2] - pz)) / area;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const y = w0 * P[a + 1] + w1 * P[b + 1] + (1 - w0 - w1) * P[c + 1];
      if (y > H[k * nx + i]) H[k * nx + i] = y;
    }
  }
  return [...H].filter(Number.isFinite).sort((p, q) => p - q);
}

describe('Skyways Meshy T2.5 props (lane ASSET-D)', () => {
  it('the registry lists exactly the brief rows', () => {
    expect(Object.keys(SKYWAYS_MESHY_PROPS).sort()).toEqual(ROWS.map(r => r.key).sort());
  });

  for (const row of ROWS) {
    it(`${row.id}: real size, grounded / centred, budget, Meshy maps kept, registry, provenance and allowlist`, async () => {
      const url = `assets/models/${row.id}.glb`, provRel = `assets/derivatives/${row.id}-model.json`;
      const {bytes, root, prim, P} = await load(url);
      const provBytes = readFileSync(pub(provRel));
      const prov = JSON.parse(provBytes.toString());
      // plain glTF: one identity node / mesh / triangle primitive / opaque material; no Draco / meshopt / KTX2
      expect(root.listExtensionsUsed()).toEqual([]);
      expect(root.listNodes()).toHaveLength(1);
      expect(root.listNodes()[0].getMatrix()).toEqual(IDENTITY);
      expect(root.listMeshes()).toHaveLength(1);
      expect(root.listMeshes()[0].listPrimitives()).toHaveLength(1);
      expect(prim.getMode()).toBe(4);
      expect(prim.listSemantics().sort()).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
      // bounds: grounded, centred, the reference measure at its real size
      const b = getBounds(root.getDefaultScene()!);
      const dims = [0, 1, 2].map(k => b.max[k] - b.min[k]);
      expect(Math.abs(b.min[1])).toBeLessThan(1e-4);
      expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(1e-3);
      expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(1e-3);
      const f = row.fit;
      if ('x' in f) expect(dims[0]).toBeCloseTo(f.x, 3);
      if ('y' in f) expect(dims[1]).toBeCloseTo(f.y, 3);
      if ('top' in f) {
        // the 6-ft table itself: the x extent of the geometry in the recorded top band (the cloth flares wider at the floor)
        let x0 = Infinity, x1 = -Infinity;
        for (let i = 0; i < P.length; i += 3) if (P[i + 1] >= prov.fit.topBandY - 1e-6) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); }
        expect(x1 - x0).toBeCloseTo(f.top, 2);
        expect(dims[0]).toBeGreaterThan(f.top);
      }
      // triangle budget (as delivered when the brief keeps the model's count)
      const tris = prim.getIndices()!.getCount() / 3;
      if (row.tris == null) expect(tris).toBe(prov.source.triangles - prov.weld.degenerateTrianglesDropped);
      else {
        expect(tris).toBeLessThanOrEqual(row.tris);
        if (prov.simplify.applied) expect(tris).toBeGreaterThan(0.9 * row.tris);
      }
      // the material: Meshy's base colour / metallic-roughness / normal maps kept (JPEG at the listed sizes), opaque
      const mats = root.listMaterials();
      expect(mats).toHaveLength(1);
      const mat = mats[0];
      expect(mat.getAlphaMode()).toBe('OPAQUE');
      expect(mat.getOcclusionTexture()).toBeNull();
      expect(mat.getEmissiveTexture()).toBeNull();
      const maps = [mat.getBaseColorTexture(), mat.getMetallicRoughnessTexture(), mat.getNormalTexture()];
      maps.forEach((t, i) => {
        expect(t).not.toBeNull();
        expect(t!.getMimeType()).toBe('image/jpeg');
        expect(t!.getSize()).toEqual([row.tex[i], row.tex[i]]);
      });
      expect(root.listTextures()).toHaveLength(3);
      expect(prov.source.maps.map((m: {slot: string}) => m.slot)).toEqual(['baseColor', 'metallicRoughness', 'normal']);
      expect(prov.texturePolicy).toMatch(/Meshy's own maps kept/);
      // registry = measured runtime bounds
      const reg = SKYWAYS_MESHY_PROPS[row.key];
      expect(reg.url).toBe(url);
      expect(Math.abs(reg.w - dims[0])).toBeLessThan(1e-3);
      expect(Math.abs(reg.h - dims[1])).toBeLessThan(1e-3);
      expect(Math.abs(reg.d - dims[2])).toBeLessThan(1e-3);
      expect(reg.tris).toBe(tris);
      // provenance binds these bytes: Meshy T2.5 task, the accepted ledger rows, Codex input + raw sha256; no URLs / signatures / tokens
      expect(prov).toMatchObject({id: row.id, key: row.key, accepted: true, output: {url, bytes: bytes.length, sha256: sha(bytes), triangles: tris}});
      expect(prov.meshy).toMatchObject({task: row.task, status: 'SUCCEEDED', consumedCredits: 15, request: {ai_model: 'meshy-t2.5', model_type: 'smart-topology', enable_pbr: true}});
      expect(prov.meshy.ledger.lines.accept).toBeGreaterThan(prov.meshy.ledger.lines.raw);
      expect(prov.source.file).toContain(row.task);
      expect(prov.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prov.conditioningImage.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prov.route).toMatch(/^Codex native image_gen INITIAL .* -> Meshy T2\.5 image-to-3D/);
      expect(prov.convention).toMatch(/^metres at real size, \+Y up; front \+Z/);
      expect(prov.licence).toMatch(/no blanket licence or commercial clearance implied/);
      expect(provBytes.toString()).not.toMatch(/https?:|Signature|X-Amz|Key-Pair|token=/i);
      expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/https?:\/\/|X-Amz|Signature=/);
      // release allowlist
      expect(allow.get(url)).toEqual({path: url, bytes: bytes.length, sha256: sha(bytes)});
      expect(allow.get(provRel)).toEqual({path: provRel, bytes: provBytes.length, sha256: sha(provBytes)});
    });
  }

  it('measured heights: the stage deck, the merch table top (real 0.76 m) and the stanchion eye ring sit where the mesh is', async () => {
    const {skyways_con_stage: stage, skyways_con_merch_table: table, skyways_prize_stanchion: stanchion} = SKYWAYS_MESHY_PROPS;
    // stage: a broad deck plateau at deckY (a 2 x 2 m window at the deck centre is flat within 2.5 cm of it), well below the truss top
    {
      const {P, I} = await load(stage.url);
      expect(stage.deckY).toBeGreaterThan(0.6);
      expect(stage.deckY).toBeLessThan(1.3);
      const hs = topHeights(P, I, [-1, 1], [-1.4, 0.6]);
      expect(hs.length).toBeGreaterThan(0.95 * 200 * 200);
      expect(Math.abs(hs[hs.length >> 1] - stage.deckY)).toBeLessThan(0.01);
      expect(hs.filter(y => Math.abs(y - stage.deckY) < 0.025).length).toBeGreaterThan(0.9 * hs.length);
    }
    // table: the cloth top at the real 0.76 m (± 1 cm) across the middle of the table
    {
      const {P, I} = await load(table.url);
      expect(Math.abs(table.topY - 0.76)).toBeLessThan(0.01);
      const hs = topHeights(P, I, [-0.7, 0.7], [-0.25, 0.25]);
      expect(Math.abs(hs[hs.length >> 1] - table.topY)).toBeLessThan(0.006);
      expect(hs.filter(y => Math.abs(y - table.topY) < 0.01).length).toBeGreaterThan(0.9 * hs.length);
    }
    // stanchion: the eye ring below the cap on the +Z side, geometry present at ringY in front of the column, and the rope below it
    {
      const {P} = await load(stanchion.url);
      expect(stanchion.ringY).toBeGreaterThan(0.8);
      expect(stanchion.ringY).toBeLessThan(stanchion.h - 0.05);
      let ringPts = 0, below = 0;
      for (let i = 0; i < P.length; i += 3) {
        if (Math.abs(P[i + 1] - stanchion.ringY) < 0.025 && P[i + 2] > 0.045 && Math.abs(P[i]) < 0.03) ringPts++;
        if (P[i + 1] < stanchion.ringY - 0.03 && P[i + 1] > 0.3 && P[i + 2] > 0.05) below++;
      }
      expect(ringPts).toBeGreaterThan(20);
      expect(below).toBeGreaterThan(50);
    }
  });
});
