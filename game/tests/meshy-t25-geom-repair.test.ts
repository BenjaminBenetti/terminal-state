// Model touch-ups (task studio-model-touchups-20261030-01, lane GEOM): two LOCAL geometry repairs of Meshy T2.5 derivatives, built
// by tools/asset-pipeline/props/build-meshy-t25.mjs (LOCAL_REPAIR -> lib/local-repair-geom.mjs) into NEW cache-busting files.
//  - supply cabinet (cabinetTall): "side face looks bad, sorta like accordion lines" — the 32 side fins / 13 top slats Meshy made
//    out of the plain panels are replaced by one flat panel per side and a flat cap; the doors still split and open;
//  - platform bench: "messed up back rest, lots of mangled triangles" — the torn backrest shells are rebuilt clean.
// Not new Meshy output (record.localRepair.notNewMeshyOutput); the unrepaired rebuild reproduces the shipped -t25 bytes.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {NodeIO} from '@gltf-transform/core';
import {MODEL_FILES} from '../src/assets/manifest';
import {PROP_DEFS} from '../src/gen/props';
import {CABINET_SPECS, cabinetInterior} from '../src/items/lootLayout';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped, openableModels, rowLayout} from './helpers/openablesFixture';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(GAME, '..');
const REPAIR_BASE = '69a6b22ec6e73fbd4e01b9bd73c5e648e05c451b';
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

interface Mesh { P: Float32Array; N: Float32Array; UV: Float32Array; I: Uint32Array }
interface Probe { rays: number; holes: number; hitsPerRay: Record<string, number>; firstHitDepthSpreadM: number; windingNormalRmsDeg: number; shadingNormalRmsDeg: number; distinctFirstHitFaces: number }
interface Quality { triangles: number; degenerate: number; sliver: number; thin: number; flipped: number; minAngleDeg: number }
interface Lib {
  cabinetMetrics(m: Mesh): {sideRight: Probe; sideLeft: Probe; top: Probe; triangles: number};
  benchMetrics(m: Mesh): {backrestTriangles: Quality; frontRays: Omit<Probe, 'distinctFirstHitFaces'>; backrestOpenEdges: number; triangles: number};
  triangleQuality(m: Mesh, pick?: (g: {c: number[]; n: number[]; area: number}, f: number) => boolean): Quality;
  bboxOf(P: Float32Array): {min: number[]; max: number[]};
}
interface Rec {
  id: string; runtimeKeys: string[];
  output: {path: string; url: string; sha256: string; bytes: number; triangles: number; dims: number[]; doubleSided: boolean; budget: {tris: number}};
  meshy: {taskId: string; nativeSha256: string};
  localRepair?: {task: string; lane: string; kind: string; suffix: string; notNewMeshyOutput: boolean; userFeedback: string; what: string; why: string;
    previousOutput: {path: string; sha256: string; baseCommit: string; restore: string};
    geometry: {version: string; rootCause: string; triangles: {before: number; after: number}; unrepairedRebuild: {sha256: string; matchesPreviousOutput: boolean};
      metrics: {before: Record<string, unknown>; after: Record<string, unknown>}}};
}
const PROV = JSON.parse(fs.readFileSync(path.join(GAME, 'public/assets/derivatives/meshy-t25-props-20261029.json'), 'utf8')) as {records: Rec[]};
const rec = (id: string) => PROV.records.find(r => r.id === id)!;
// the shipped T2.5 derivatives the repairs start from (pushed at REPAIR_BASE; the accepted Meshy natives are unchanged)
const BEFORE = {
  'base:cabinetTall': {path: 'game/public/assets/models/cabinet-tall-t25.glb', sha256: 'a56799dca9c02d32ac07b08a2b9f0ae35aeb25f3b7fde1a034637ee727bd83f8', triangles: 7324, task: '01a18995-7584-77b5-8a09-d75f1b2fef6b', native: '34001c6f6a2ab4f22cc9a3916a61109d962b49b10d0997c5eb5bf3a8ee9034c0'},
  'base:bench': {path: 'game/public/assets/models/bench-t25.glb', sha256: 'caad790696f9342d806753f0b8fb578ed50c032a481ee90f1d309b1c82054890', triangles: 7999, task: '01a18995-66cd-71c7-a016-0aaf08d18870', native: 'e0a7b7b6eaf655023efba11749a5614837f87f52a061779318a21005919b4b02'},
} as const;

let lib: Lib;
const meshes: Record<string, Mesh> = {};
beforeAll(async () => {
  lib = await import(pathToFileURL(path.join(REPO, 'tools/asset-pipeline/props/lib/local-repair-geom.mjs')).href) as Lib;
  for (const id of Object.keys(BEFORE)) {
    const doc = await new NodeIO().read(path.join(REPO, rec(id).output.path));
    const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    meshes[id] = {P: p.getAttribute('POSITION')!.getArray() as Float32Array, N: p.getAttribute('NORMAL')!.getArray() as Float32Array, UV: p.getAttribute('TEXCOORD_0')!.getArray() as Float32Array, I: Uint32Array.from(p.getIndices()!.getArray()!)};
  }
}, 120000);

describe('local geometry repairs: files, registry, provenance', () => {
  it('new cache-busting files, live in the manifest; logical keys, Meshy source and footprint unchanged', () => {
    for (const [id, b] of Object.entries(BEFORE)) {
      const r = rec(id), key = r.runtimeKeys[0] as keyof typeof MODEL_FILES;
      expect(r.output.path, id).toBe(b.path.replace(/-t25\.glb$/, '-t25r1.glb'));
      expect(MODEL_FILES[key].url, id).toBe(r.output.url);
      expect(sha(path.join(REPO, r.output.path)), id).toBe(r.output.sha256);
      expect(r.output.sha256, id).not.toBe(b.sha256);
      expect(r.meshy.taskId, id).toBe(b.task);
      expect(r.meshy.nativeSha256, id).toBe(b.native);
      const def = PROP_DEFS[key === 'cabinetTall' ? 'cabinetTall' : 'bench'];
      const bb = lib.bboxOf(meshes[id].P);
      expect(bb.max[0] - bb.min[0], id).toBeCloseTo(def.w, 4);
      expect(bb.max[1] - bb.min[1], id).toBeCloseTo(def.h, 4);
      expect(bb.max[2] - bb.min[2], id).toBeCloseTo(def.d, 4);
      expect(bb.min[1], `${id} floor contact`).toBeCloseTo(0, 5);
      expect(r.output.doubleSided, id).toBe(true);
      expect(r.output.triangles, `${id}: no triangle increase`).toBeLessThan(b.triangles);
      expect(r.output.triangles, id).toBeLessThanOrEqual(r.output.budget.tris);
    }
  });

  it('provenance: a documented local repair (not new Meshy output) on top of the exact shipped -t25 derivative', () => {
    for (const [id, b] of Object.entries(BEFORE)) {
      const L = rec(id).localRepair!;
      expect(L.notNewMeshyOutput, id).toBe(true);
      expect([L.task, L.lane, L.kind, L.suffix], id).toEqual(['studio-model-touchups-20261030-01', 'GEOM', 'geometry', 'r1']);
      expect(L.userFeedback.length + L.what.length + L.why.length + L.geometry.rootCause.length, id).toBeGreaterThan(400);
      expect(L.previousOutput, id).toMatchObject({path: b.path, sha256: b.sha256, baseCommit: REPAIR_BASE, restore: `git show ${REPAIR_BASE}:${b.path} > ${b.path}`});
      // the builder re-writes the unrepaired mesh like the shipped file: identical bytes, so the repair is the only change
      expect(L.geometry.unrepairedRebuild, id).toMatchObject({sha256: b.sha256, matchesPreviousOutput: true});
      expect(L.geometry.triangles, id).toEqual({...L.geometry.triangles, before: b.triangles, after: rec(id).output.triangles});
    }
  });
});

describe('supply cabinet: flat side panels and top, doors still split and open', () => {
  it('a viewer sees one flat plane on each side and on the top (was: fins at 2 depths, normals scattered ~37 deg)', () => {
    const m = lib.cabinetMetrics(meshes['base:cabinetTall']);
    for (const k of ['sideRight', 'sideLeft', 'top'] as const) {
      expect(m[k].holes, k).toBe(0);
      expect(m[k].firstHitDepthSpreadM, k).toBeLessThan(1e-4);
      expect(m[k].windingNormalRmsDeg, k).toBeLessThan(0.01);
      expect(m[k].shadingNormalRmsDeg, k).toBeLessThan(0.01);
      expect(m[k].distinctFirstHitFaces, k).toBeLessThanOrEqual(2);   // one quad
    }
    // the recorded before / after probes agree with the file
    const after = rec('base:cabinetTall').localRepair!.geometry.metrics.after as {sideRight: Probe};
    expect(after.sideRight.windingNormalRmsDeg).toBe(m.sideRight.windingNormalRmsDeg);
    const before = rec('base:cabinetTall').localRepair!.geometry.metrics.before as {sideRight: Probe; sideLeft: Probe; top: Probe};
    expect(before.sideRight.windingNormalRmsDeg).toBeGreaterThan(20);
    expect(before.sideRight.firstHitDepthSpreadM).toBeGreaterThan(0.02);
  });

  it('no fins / slats remain; the new faces are planar, outward-wound and non-degenerate; no coplanar cover over the posts', () => {
    const M = meshes['base:cabinetTall'];
    const bb = lib.bboxOf(M.P), W2 = bb.max[0];
    // new outer faces: side panels 1.5 mm inside the posts' outer faces (|x| 0.540), cap faces at the exact bounds
    const panel = (g: {c: number[]; n: number[]}) => Math.abs(Math.abs(g.c[0]) - (W2 - 0.0015)) < 1e-4 && Math.abs(g.n[0]) > 0.999;
    const cap = (g: {c: number[]; n: number[]}) => g.c[1] > 1.852 && (Math.abs(g.c[1] - bb.max[1]) < 1e-5 || Math.abs(Math.abs(g.c[0]) - W2) < 1e-5 || Math.abs(g.c[2] - bb.min[2]) < 1e-5 || Math.abs(g.c[2] - 0.27) < 1e-3);
    const q = lib.triangleQuality(M, (g, f) => (panel(g) || cap(g)) && f >= 0);
    expect(q.triangles).toBe(14);   // 2 side panels + top + 4 skirts, 2 triangles each
    expect([q.degenerate, q.sliver, q.flipped]).toEqual([0, 0, 0]);
    // nothing else between the inner wall and the side panel (the fins lived at |x| 0.510..0.541, y 0.083..1.866)
    let fins = 0;
    for (let f = 0; f < M.I.length / 3; f++) {
      const c = [0, 1, 2].map(k => (M.P[3 * M.I[3 * f] + k] + M.P[3 * M.I[3 * f + 1] + k] + M.P[3 * M.I[3 * f + 2] + k]) / 3);
      if (Math.abs(c[0]) > 0.514 && Math.abs(c[0]) < 0.5395 && c[1] > 0.1 && c[1] < 1.84 && Math.abs(c[2]) < 0.235) fins++;
    }
    expect(fins).toBe(0);
    // the cap's front skirt stays above the runtime door cut (CABINET_SPECS y1), so no sliver of it moves with a door
    expect(1.852).toBeGreaterThan(CABINET_SPECS.cabinetTall.y1 * PROP_DEFS.cabinetTall.h);
  });

  it('the runtime door split still yields two leaves inside the door region, and they open', async () => {
    const models: Record<string, GLTF> = await openableModels();
    for (const k of ['cabinetTall', 'shelf'] as const) models[k] = await loadStripped(MODEL_FILES[k].url);
    const cm = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => new Inventory());
    cm.build(rowLayout(['cabinetTall'], {seed: 5, gap: 1.2}));
    const h = cm.all.find(x => x.kind === 'cabinetTall')!;
    expect(h).toBeTruthy();
    expect(h.hinges.length).toBe(2);
    const def = PROP_DEFS.cabinetTall, it = cabinetInterior('cabinetTall', def);
    let tris = 0;
    h.hinges.forEach(({obj}, i) => {
      const box = new THREE.Box3();
      for (const m of obj.children as THREE.Mesh[]) {
        if (!h.leafMeshes.includes(m)) continue;
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox!.clone().translate(obj.position));
        tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
      }
      expect(box.min.x, `leaf ${i}`).toBeGreaterThanOrEqual(-it.hw - 1e-3);
      expect(box.max.x, `leaf ${i}`).toBeLessThanOrEqual(it.hw + 1e-3);
      expect(box.min.y, `leaf ${i}`).toBeGreaterThanOrEqual(it.y0 - 1e-3);
      expect(box.max.y, `leaf ${i}`).toBeLessThanOrEqual(it.y1 + 1e-3);
      expect(box.min.z, `leaf ${i}`).toBeGreaterThanOrEqual(it.zCut - 1e-3);
      expect(box.max.x - box.min.x, `leaf ${i} is a door, not a sliver`).toBeGreaterThan(0.45);
      expect(box.max.y - box.min.y, `leaf ${i}`).toBeGreaterThan(1.6);
    });
    expect(tris).toBeGreaterThan(500);   // the doors' own geometry (panels, handles, lock) moves with the leaves
    cm.interact(h);
    for (let t = 0; t < 1.5; t += 1 / 60) cm.update(1 / 60, t);
    for (const {obj, angle} of h.hinges) expect(Math.abs(obj.rotation.y - angle), 'door swung open').toBeLessThan(0.02);
  }, 120000);
});

describe('platform bench: clean backrest', () => {
  it('backrest panels: no degenerate / sliver / thin / flipped triangles, no holes or shards (every ray: front + back)', () => {
    const m = lib.benchMetrics(meshes['base:bench']);
    expect(m.backrestTriangles.triangles).toBeGreaterThan(100);
    expect([m.backrestTriangles.degenerate, m.backrestTriangles.sliver, m.backrestTriangles.thin, m.backrestTriangles.flipped]).toEqual([0, 0, 0, 0]);
    expect(m.backrestTriangles.minAngleDeg).toBeGreaterThan(5);
    expect(m.frontRays.holes).toBe(0);
    expect(m.frontRays.hitsPerRay).toEqual({2: m.frontRays.rays});
    expect(m.frontRays.windingNormalRmsDeg).toBeLessThan(3);
    expect(m.backrestOpenEdges).toBe(0);   // the rebuilt surfaces are welded to the kept seat / rail / corner edges
    const before = rec('base:bench').localRepair!.geometry.metrics.before as {backrestTriangles: Quality; frontRays: {holes: number}; backrestOpenEdges: number};
    expect(before.backrestTriangles.sliver + before.backrestTriangles.flipped + before.frontRays.holes).toBeGreaterThan(100);
    expect(before.backrestOpenEdges).toBeGreaterThan(100);
  });

  it('seat, rail, plates, legs untouched: outside the rebuilt backrest zone every vertex is original (or a clip point on an original edge)', async () => {
    const {execFileSync} = await import('node:child_process');
    const old = execFileSync('git', ['-C', REPO, 'show', `${REPAIR_BASE}:${BEFORE['base:bench'].path}`], {maxBuffer: 1 << 28});
    const p0 = (await new NodeIO().readBinary(new Uint8Array(old))).getRoot().listMeshes()[0].listPrimitives()[0];
    const P0 = p0.getAttribute('POSITION')!.getArray()!, I0 = p0.getIndices()!.getArray()!;
    const key = (P: ArrayLike<number>, i: number) => `${P[3 * i].toFixed(4)},${P[3 * i + 1].toFixed(4)},${P[3 * i + 2].toFixed(4)}`;
    const orig = new Set<string>(); for (let i = 0; i < P0.length / 3; i++) orig.add(key(P0, i));
    const onOldEdge = (q: number[]) => {
      for (let t = 0; t < I0.length; t += 3) for (const [a, b] of [[I0[t], I0[t + 1]], [I0[t + 1], I0[t + 2]], [I0[t + 2], I0[t]]]) {
        const A = [P0[3 * a], P0[3 * a + 1], P0[3 * a + 2]], d = [P0[3 * b] - A[0], P0[3 * b + 1] - A[1], P0[3 * b + 2] - A[2]], l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
        if (!l2) continue;
        const u = Math.max(0, Math.min(1, ((q[0] - A[0]) * d[0] + (q[1] - A[1]) * d[1] + (q[2] - A[2]) * d[2]) / l2));
        if (Math.hypot(A[0] + u * d[0] - q[0], A[1] + u * d[1] - q[1], A[2] + u * d[2] - q[2]) < 2e-5) return true;
      }
      return false;
    };
    const M = meshes['base:bench'];
    let outside = 0, clipPoints = 0;
    for (let i = 0; i < M.P.length / 3; i++) {
      const q = [M.P[3 * i], M.P[3 * i + 1], M.P[3 * i + 2]];
      if (q[1] > 0.32 && q[1] < 0.735 && q[2] < -0.08 && q[2] > -0.26) continue;   // the backrest zone (rebuilt / cut)
      outside++;
      if (orig.has(key(M.P, i))) continue;
      clipPoints++;
      expect(onOldEdge(q), `vertex ${q.map(v => v.toFixed(4))} lies on an original edge`).toBe(true);
    }
    expect(outside).toBeGreaterThan(3000);
    expect(clipPoints).toBeLessThan(20);
  });
});
