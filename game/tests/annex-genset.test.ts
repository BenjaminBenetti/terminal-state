// Task studio-alpha-track2-round2-20261031-01 (R3): the ONE generated annex generator set (Meshy T2.5) — derivative, provenance,
// allowlist and its runtime integration on the real generator-room records: on the plinth, inside the record's collision body box
// (so the 1 m access ring / hall aisle stay clear), front +Z, procedural body replaced, plinth + exhaust kept, lazily keyed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ANNEX_GENSET, gensetModelKeysFor} from '../src/assets/annexGenset';
import {levelOfAsset} from '../src/assets/levelAssets';
import {buildWorld} from '../src/world/builder';
import {WorldMaterials} from '../src/world/materials';
import {gensetModelFit} from '../src/world/trackExt/machines';
import {machineBoxes} from '../src/gen/annexRooms';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {freshLayout} from './helpers/annexRoute';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {FRESH} from './helpers/btsArea';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p: string) => path.join(GAME, 'public', p);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
let gltf: GLTF;
beforeAll(async () => { gltf = await loadStripped(ANNEX_GENSET.url); }, 60000);

describe('R3: the generated annex genset', () => {
  it('derivative: shared path, real size, one mesh / material, bounded triangles + maps; provenance and allowlist agree', () => {
    expect(ANNEX_GENSET.url).toBe('assets/models/annex-genset.glb');
    expect(levelOfAsset(ANNEX_GENSET.url)).toBeNull(); // not a Mall-only file
    const glb = fs.readFileSync(pub(ANNEX_GENSET.url));
    expect(glb.length).toBe(ANNEX_GENSET.bytes);
    expect(ANNEX_GENSET.tris).toBeLessThanOrEqual(15000);
    expect(ANNEX_GENSET.dims[0]).toBeCloseTo(3.5, 3);
    const prov = JSON.parse(fs.readFileSync(pub('assets/derivatives/annex-genset-20261031.json'), 'utf8'));
    expect(prov.output).toEqual({url: ANNEX_GENSET.url, bytes: glb.length, sha256: sha(glb)});
    expect(prov.ledger).toMatchObject({attempts: 1, accepted: 1});
    expect(prov.ledger.credits.billed + prov.ledger.credits.reserved).toBeLessThanOrEqual(100);
    expect(prov.ledger.attemptedPOSTs).toBeLessThanOrEqual(40);
    expect(prov.modelProof.requested.ai_model).toBe('meshy-t2.5');
    expect(prov.derivative.meshes).toBe(1);
    expect(prov.derivative.materials).toBe(1);
    expect(prov.derivative.textures.map((t: {slot: string; size: number[]}) => `${t.slot} ${t.size.join('x')}`).sort()).toEqual(['baseColor 1024x1024', 'metallicRoughness 256x256', 'normal 512x512']);
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature=|token=/);
    const allow = JSON.parse(fs.readFileSync(path.join(GAME, '..', 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    for (const p of [ANNEX_GENSET.url, 'assets/derivatives/annex-genset-20261031.json']) {
      const f = allow.files.find(x => x.path === p)!;
      expect(f, p).toBeTruthy();
      const b = fs.readFileSync(pub(p));
      expect(f).toEqual({path: p, bytes: b.length, sha256: sha(b)});
    }
    // the GLB itself: grounded, centred, length along X (front +Z), as the provenance says
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(size.x).toBeCloseTo(ANNEX_GENSET.dims[0], 2);
    expect(size.y).toBeCloseTo(ANNEX_GENSET.dims[1], 2);
    expect(size.z).toBeCloseTo(ANNEX_GENSET.dims[2], 2);
  });

  it('fit on every real genset record: on the plinth, inside its collision body box, uniform scale', () => {
    let n = 0;
    // (2026-11-01, lane AREA: the area exists only where the level's one roll succeeds; the old playtest seeds roll it absent — FRESH,
    // tests/helpers/btsArea.ts, holds the first seeds at / after them rolling PRESENT in the same role.)
    for (const [level, seed] of [['subway', FRESH.subwayTunnel], ['subway', FRESH.subwayHatch], ['office', FRESH.office], ['mall', FRESH.mall], ['subway', FRESH.subwayGenset]] as const) {
      const L = freshLayout(level, seed);
      for (const m of (L.extensions?.machines ?? []).filter(q => q.kind === 'genset')) {
        n++;
        const f = gensetModelFit(m, ANNEX_GENSET.dims);
        expect(f.scale).toBeGreaterThan(0.85);
        expect(f.scale).toBeLessThanOrEqual(1.15);
        expect(f.size[0]).toBeLessThanOrEqual(m.w + 1e-6);
        expect(f.size[2]).toBeLessThanOrEqual(m.d - 0.2 + 1e-6);
        expect(0.15 + f.size[1]).toBeLessThanOrEqual(m.h + 1e-6);
        // the collision body (machineBoxes) covers the model's footprint: nothing of it pokes into the access ring
        const body = machineBoxes(m)[0];
        const p = new THREE.Vector3().setFromMatrixPosition(f.matrix);
        expect(Math.hypot(p.x - body.x, p.z - body.z)).toBeLessThan(1e-6);
        expect(p.y).toBeCloseTo(m.y + 0.15, 6);
        expect(Math.max(body.hx, body.hz) * 2).toBeGreaterThanOrEqual(Math.max(f.size[0], f.size[2]) - 1e-6);
      }
      expect(gensetModelKeysFor(L)).toEqual((L.extensions?.machines ?? []).some(q => q.kind === 'genset') ? [ANNEX_GENSET.key] : []);
    }
    expect(n).toBeGreaterThanOrEqual(4);
    expect(gensetModelKeysFor(freshLayout('subway', 1))).toEqual([]);
  }, 120000);

  it('runtime: instanced on each genset (procedural body replaced, plinth + exhaust kept); without the model the procedural set stands', () => {
    const L = freshLayout('subway', FRESH.subwayGenset);
    const gensets = L.extensions!.machines!.filter(m => m.kind === 'genset').length;
    expect(gensets).toBeGreaterThan(0);
    const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const plain = buildWorld(L, mats(), {});
    const withModel = buildWorld(L, mats(), {[ANNEX_GENSET.key]: gltf});
    expect(plain.trackExt?.gensets).toBeUndefined();
    const g = withModel.trackExt!.gensets!;
    expect(g.instances).toBe(gensets);
    expect(g.draws).toBeGreaterThan(0);
    expect(g.draws).toBeLessThanOrEqual(gensets); // one per mesh x chunk (one mesh), never more than the sets
    const inst: THREE.InstancedMesh[] = [];
    withModel.group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.name === `prop-${ANNEX_GENSET.key}`) inst.push(o as THREE.InstancedMesh); });
    expect(inst.reduce((s, m) => s + m.count, 0)).toBe(gensets);
    // the procedural genset body (its 'genset' paint) shrinks: radiator / engine / alternator boxes gone, the plinth / exhaust stay
    const tris = (w: typeof plain, mat: string) => {
      let t = 0;
      w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.name.startsWith('annex-machines-') && m.name.endsWith(`-${mat}`)) t += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; });
      return t;
    };
    expect(tris(withModel, 'genset')).toBeLessThan(tris(plain, 'genset'));
    expect(tris(withModel, 'concrete')).toBe(tris(plain, 'concrete')); // plinths
    expect(tris(withModel, 'lagging')).toBe(tris(plain, 'lagging')); // exhaust silencers
  }, 120000);
});
