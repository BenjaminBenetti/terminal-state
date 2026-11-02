// Task studio-beta-player-train-shell-20261101-202805-01 (lane ASSETS): the level-one player train's cooked runtime assets and the
// MEASURED train-local spec. Derivatives / allowlist / provenance / CREDITS agree (raw masters stay outside Git: the accepted raw
// hashes and Meshy task ids are pinned here), the spec meets every LANES.md fit constraint, doors / cab / console / lights sit
// inside the car, and the SHIPPED shell really is hollow where the spec says (no skin in the walkable box, every doorway open,
// wheels on the rails). Rebuild: node tools/asset-pipeline/train/build-player-train.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {NodeIO} from '@gltf-transform/core';
import {PLAYER_TRAIN_GLASS, PLAYER_TRAIN_MEASURED, PLAYER_TRAIN_MODELS, PLAYER_TRAIN_TEXTURES} from '../src/assets/playerTrain.generated';
import {levelOfAsset} from '../src/assets/levelAssets';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p: string) => path.join(GAME, 'public', p);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const PROV_REL = 'assets/derivatives/player-train-20261101.json';
const prov = JSON.parse(fs.readFileSync(pub(PROV_REL), 'utf8'));
// world: platform floor y 0, rail top -0.855, bed ceiling >= 4.2 above the platform (LANES.md)
const PLATFORM_ABOVE_RAIL = 0.855, BED_CEILING_ABOVE_RAIL = 4.2 + PLATFORM_ABOVE_RAIL;
const ACCEPTED = {
  'train-shell': {refine: '01a198d3-a2b4-70c5-a452-6084c8b0d0fd', preview: '01a198d2-7f79-7021-981f-3b63e0548d6f', sha256: 'bf82cd6e3907033c2b8a2e1c339742bbf83747360be1e0ec5dd875f9e5e9fc81'},
  'train-cab-console': {refine: '01a198d2-0957-7588-83fe-c959b740c1ef', preview: '01a198d0-a538-7332-9064-ada748d324d6', sha256: '62499045b27825f852dbbea84b04029ef18be66d730299e9b522c86812016f48'},
  'train-door-leaf': {refine: '01a198d2-0f84-7605-9343-24943ef4f4aa', preview: '01a198d0-ade7-7435-8dbe-13a82462028b', sha256: 'f75158963509c94a0b44973d218362e188d15d30665834395fe902a1a4a719e1'},
} as const;
const CODEX_SHA = {
  'train-int-wall': 'ef79149ff7be71b108885642936d117c9d259bc4bc988b1858336c37f4387ff2', 'train-int-floor': '473b39a42b81db37ef2fcec070b33a7a083e95c35c311d0b5bea9cb053cb8b3f',
  'train-int-ceiling': 'b32f741ef2dc92087c382d52e780989c76d9916b1f5cc86d0c7b8ccfdbc11a95', 'train-int-bulkhead': '94171e5aae6099dee5f28143b72052735ad28d3e0e51eb8787a866a1c44445a7',
} as const;

type V3 = [number, number, number];
type Box = {min: V3; max: V3};
async function triangles(url: string): Promise<V3[][]> {
  const doc = await new NodeIO().read(pub(url));
  const out: V3[][] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION')!.getArray()!, idx = p.getIndices()!.getArray()!;
      for (let t = 0; t < idx.length; t += 3) out.push([0, 1, 2].map(j => [pos[idx[t + j] * 3], pos[idx[t + j] * 3 + 1], pos[idx[t + j] * 3 + 2]] as V3));
    }
  }
  return out;
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Triangle / AABB overlap (separating axes). */
function triBox(box: Box, t: V3[]): boolean {
  const c: V3 = [0, 1, 2].map(k => (box.min[k] + box.max[k]) / 2) as V3, h: V3 = [0, 1, 2].map(k => (box.max[k] - box.min[k]) / 2) as V3;
  const v = t.map(p => sub(p, c));
  for (let k = 0; k < 3; k++) if (Math.min(v[0][k], v[1][k], v[2][k]) > h[k] || Math.max(v[0][k], v[1][k], v[2][k]) < -h[k]) return false;
  const sep = (ax: V3) => { const p = v.map(q => dot(q, ax)); const r = h[0] * Math.abs(ax[0]) + h[1] * Math.abs(ax[1]) + h[2] * Math.abs(ax[2]); return Math.min(...p) > r || Math.max(...p) < -r; };
  const e = [sub(v[1], v[0]), sub(v[2], v[1]), sub(v[0], v[2])];
  for (const ed of e) for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]) { const ax = cross(u, ed); if ((ax[0] || ax[1] || ax[2]) && sep(ax)) return false; }
  return !sep(cross(e[0], e[1]));
}
const boundsOf = (tris: V3[][]): Box => {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return {min, max};
};

/** Triangles with their vertex normals (for the defect census). */
async function trianglesWithNormals(url: string): Promise<{p: V3[]; n: V3[]}[]> {
  const doc = await new NodeIO().read(pub(url));
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION')!.getArray()!, nrm = prim.getAttribute('NORMAL')!.getArray()!, idx = prim.getIndices()!.getArray()!;
  const out: {p: V3[]; n: V3[]}[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const ids = [idx[t], idx[t + 1], idx[t + 2]];
    out.push({p: ids.map(i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]] as V3), n: ids.map(i => [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]] as V3)});
  }
  return out;
}
/**
 * Independent defect census (task train-shell-followup): degenerate faces, faces whose winding disagrees with their vertex normals
 * (they shade inside-out with DoubleSide), and coincident overlaps: near-parallel faces (|cos| >= 0.97) whose overlap region lies within
 * 3 mm of the other's plane (z-fighting / Meshy fold flaps lying on the skin).
 */
function census(tris: {p: V3[]; n: V3[]}[]): {degenerate: number; normalFlip: number; coincident: number} {
  const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
  const items: {p: V3[]; n: V3; a: number}[] = [];
  let degenerate = 0, normalFlip = 0, coincident = 0;
  for (const t of tris) {
    const fn = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])), a = len(fn) / 2;
    if (a < 1e-7) { degenerate++; continue; }
    const vn: V3 = [0, 1, 2].map(k => t.n[0][k] + t.n[1][k] + t.n[2][k]) as V3;
    if (dot(fn, vn) < 0) normalFlip++;
    items.push({p: t.p, n: fn.map(v => v / (2 * a)) as V3, a});
  }
  const cell = 0.3, grid = new Map<string, number[]>();
  items.forEach((it, k) => {
    const lo = [0, 1, 2].map(d => Math.floor(Math.min(...it.p.map(v => v[d])) / cell)), hi = [0, 1, 2].map(d => Math.floor(Math.max(...it.p.map(v => v[d])) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const g = `${x},${y},${z}`; grid.set(g, [...(grid.get(g) ?? []), k]); }
  });
  const seen = new Set<string>();
  for (const list of grid.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const key = list[i] < list[j] ? `${list[i]}|${list[j]}` : `${list[j]}|${list[i]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const A = items[list[i]], B = items[list[j]];
    if (Math.abs(dot(A.n, B.n)) < 0.97) continue;
    // B clipped to A's prism (A's edges, in A's plane): the overlap region
    const ax: V3 = Math.abs(A.n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0], u = cross(A.n, ax), ul = len(u), U: V3 = [u[0] / ul, u[1] / ul, u[2] / ul], W = cross(A.n, U);
    const a2 = A.p.map(q => [dot(q, U), dot(q, W)]);
    const ccw = (a2[1][0] - a2[0][0]) * (a2[2][1] - a2[0][1]) - (a2[2][0] - a2[0][0]) * (a2[1][1] - a2[0][1]) >= 0;
    let poly: V3[] = B.p;
    for (let e = 0; e < 3 && poly.length; e++) {
      const p0 = a2[e], p1 = a2[(e + 1) % 3];
      const side = (q: V3) => { const c = (p1[0] - p0[0]) * (dot(q, W) - p0[1]) - (p1[1] - p0[1]) * (dot(q, U) - p0[0]); return ccw ? c : -c; };
      const next: V3[] = [];
      for (let k = 0; k < poly.length; k++) {
        const P = poly[k], Q = poly[(k + 1) % poly.length], sp = side(P), sq = side(Q);
        if (sp >= 0) next.push(P);
        if ((sp >= 0) !== (sq >= 0)) { const tt = sp / (sp - sq); next.push([P[0] + (Q[0] - P[0]) * tt, P[1] + (Q[1] - P[1]) * tt, P[2] + (Q[2] - P[2]) * tt]); }
      }
      poly = next.length >= 3 ? next : [];
    }
    if (poly.length < 3 || !poly.every(q => Math.abs(dot(A.n, sub(q, A.p[0]))) <= 0.003)) continue;
    let area = 0;
    for (let k = 1; k + 1 < poly.length; k++) area += len(cross(sub(poly[k], poly[0]), sub(poly[k + 1], poly[0]))) / 2;
    if (area > 1e-4) coincident++;
  }
  return {degenerate, normalFlip, coincident};
}

describe('player train: cooked assets', () => {
  it('derivatives are shared files whose bytes, allowlist entries and provenance agree; provenance pins the raw hashes / task ids', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(GAME, '..', 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    const urls = [...Object.values(PLAYER_TRAIN_MODELS).map(m => m.url), ...Object.values(PLAYER_TRAIN_TEXTURES).map(t => t.url), PROV_REL];
    for (const url of urls) {
      expect(levelOfAsset(url), url).toBeNull(); // every station level parks the car
      const b = fs.readFileSync(pub(url));
      expect(allow.files.find(f => f.path === url), url).toEqual({path: url, bytes: b.length, sha256: sha(b)});
    }
    for (const m of Object.values(PLAYER_TRAIN_MODELS)) expect(fs.statSync(pub(m.url)).size).toBe(m.bytes);
    for (const t of Object.values(PLAYER_TRAIN_TEXTURES)) expect(fs.statSync(pub(t.url)).size).toBe(t.bytes);
    expect(prov.task).toBe('studio-beta-player-train-shell-20261101-202805-01');
    expect(prov.modelProof.requested).toMatchObject({ai_model: 'meshy-t2.5', model_type: 'smart-topology'});
    expect(prov.ledger).toMatchObject({accepted: 3, credits: {reserved: 0}});
    expect(prov.ledger.credits.billed).toBeLessThanOrEqual(300);
    const byPart = {'train-shell': PLAYER_TRAIN_MODELS['player-train-shell'], 'train-cab-console': PLAYER_TRAIN_MODELS['player-train-console'], 'train-door-leaf': PLAYER_TRAIN_MODELS['player-train-door-leaf']};
    for (const [part, a] of Object.entries(ACCEPTED)) {
      const m = prov.models[part];
      expect(m.tasks, part).toEqual({preview: a.preview, refine: a.refine});
      expect(m.source.sha256, part).toBe(a.sha256);
      const f = byPart[part as keyof typeof byPart];
      const b = fs.readFileSync(pub(f.url));
      expect(m.output).toEqual({url: f.url, bytes: b.length, sha256: sha(b)});
      expect(m.derivative.triangles).toBe(f.tris);
      expect(m.derivative.dims).toEqual([...f.dims]);
    }
    for (const t of prov.textures) {
      expect(t.source.sha256).toBe(CODEX_SHA[t.id as keyof typeof CODEX_SHA]);
      expect(t.codex.threadId).toMatch(/^[0-9a-f-]{36}$/);
      expect(t.output.url).toBe(PLAYER_TRAIN_TEXTURES[t.id as keyof typeof PLAYER_TRAIN_TEXTURES].url);
    }
    expect(prov.textures).toHaveLength(4);
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature=|token=|\/home\/|\/workspaces\//);
    expect(prov.measured).toEqual(JSON.parse(JSON.stringify(PLAYER_TRAIN_MEASURED)));
    const credits = fs.readFileSync(pub('assets/CREDITS.md'), 'utf8');
    for (const url of urls.slice(0, -1)) expect(credits).toContain(url);
    // runtime budgets: one mesh / material each, bounded triangles
    expect(PLAYER_TRAIN_MODELS['player-train-shell'].tris).toBeLessThanOrEqual(32000);
    expect(PLAYER_TRAIN_MODELS['player-train-console'].tris).toBeLessThanOrEqual(15000);
    expect(PLAYER_TRAIN_MODELS['player-train-door-leaf'].tris).toBeLessThanOrEqual(1200); // 12 leaves per car: a light LOD (re-baked planar UV)
    for (const part of Object.keys(ACCEPTED)) expect(prov.models[part].derivative).toMatchObject({meshes: 1, materials: 1});
  });

  it('the spec is measured and meets every LANES.md fit constraint', () => {
    expect(SPEC.provisional).toBe(false);
    expect(SPEC.width).toBeGreaterThanOrEqual(2.9);
    expect(SPEC.width).toBeLessThanOrEqual(3.1);
    expect(SPEC.length).toBeLessThanOrEqual(16.5);
    const step = SPEC.floorY - PLATFORM_ABOVE_RAIL;
    expect(step).toBeGreaterThanOrEqual(0.05);
    expect(step).toBeLessThanOrEqual(0.25);
    expect(SPEC.ceilingY - SPEC.floorY).toBeGreaterThanOrEqual(2.25);
    for (const d of SPEC.doors) expect(d.height).toBeGreaterThanOrEqual(1.95);
    expect(SPEC.roofY).toBeLessThan(BED_CEILING_ABOVE_RAIL - 0.5);
    expect(SPEC.roofY).toBeGreaterThan(SPEC.ceilingY);
    // the measured wheel treads sit on the running rails (+-0.72), the shell on the rail plane
    expect(prov.derivation.shell.fit.wheelTreadZ[0]).toBeCloseTo(0.72, 2);
    expect(prov.derivation.shell.fit.wheelTreadZ[1]).toBeCloseTo(0.72, 2);
    expect(prov.derivation.shell.fit.minY).toBeCloseTo(0, 3);
    expect(SPEC.width).toBeCloseTo(PLAYER_TRAIN_MODELS['player-train-shell'].dims[2], 3);
    expect(SPEC.length).toBeCloseTo(PLAYER_TRAIN_MODELS['player-train-shell'].dims[0], 3);
    expect(SPEC.models.shell.url).toBe(PLAYER_TRAIN_MODELS['player-train-shell'].url);
    expect(SPEC.textures.bulkhead).toBe(PLAYER_TRAIN_TEXTURES['train-int-bulkhead'].url);
  });

  it('doors, cab, console and lights sit inside the car', () => {
    const {interior: I, cab, doorLeaf: L} = SPEC;
    expect(I.halfWidth).toBeLessThan(SPEC.width / 2 - 0.1);
    expect(I.x1 - I.x0).toBeGreaterThan(12);
    expect(SPEC.length / 2).toBeGreaterThan(I.x1);
    for (const side of [-1, 1] as const) {
      const ds = SPEC.doors.filter(d => d.side === side).sort((a, b) => a.x - b.x);
      expect(ds).toHaveLength(3);
      for (const d of ds) {
        expect(d.width).toBeGreaterThan(1.0); // > a 0.6 m player plus margin
        // the opening and both leaves' open pockets stay within the walkable length
        expect(d.x - d.width / 2 - L.width).toBeGreaterThan(I.x0);
        expect(d.x + d.width / 2 + L.width).toBeLessThan(I.x1);
        // the leaf covers half the opening (+ jamb overlap) and the clear height
        expect(L.width).toBeGreaterThanOrEqual(d.width / 2);
        expect(L.height).toBeGreaterThanOrEqual(d.height);
      }
      for (let i = 1; i < ds.length; i++) expect(ds[i].x - ds[i].width / 2 - (ds[i - 1].x + ds[i - 1].width / 2)).toBeGreaterThan(2 * L.width); // pockets never meet
      // both sides open at the same stations (one car, mirrored doors)
      expect(ds.map(d => d.x)).toEqual(SPEC.doors.filter(d => d.side === -side).sort((a, b) => a.x - b.x).map(d => d.x));
    }
    // the leaf's sliding pocket lies between the interior lining and the skin
    expect(L.outerZ - L.thickness).toBeGreaterThan(I.halfWidth);
    expect(L.outerZ).toBeLessThan(SPEC.width / 2);
    // cab: the front of the walkable box, its partition clear of the front doorway, an open doorway inside the lining
    const front = Math.max(...SPEC.doors.map(d => d.x + d.width / 2));
    expect(cab.x1).toBe(I.x1);
    expect(cab.x0).toBeGreaterThan(front + 0.25);
    expect(cab.x1 - cab.x0).toBeGreaterThanOrEqual(1.8);
    expect(cab.doorway.z0).toBeGreaterThan(-I.halfWidth);
    expect(cab.doorway.z1).toBeLessThan(I.halfWidth);
    expect(cab.doorway.z1 - cab.doorway.z0).toBeGreaterThanOrEqual(0.8);
    expect(cab.doorway.height).toBeLessThanOrEqual(SPEC.ceilingY - SPEC.floorY);
    // console: baked at runtime size (scale 1, yaw 0: operator side -X), inside the cab with >= 1 m standing room behind it
    const [cd, ch, cw] = PLAYER_TRAIN_MODELS['player-train-console'].dims;
    expect(SPEC.console).toMatchObject({yaw: 0, scale: 1});
    expect(SPEC.console.x + cd / 2).toBeLessThanOrEqual(cab.x1);
    expect(SPEC.console.x - cd / 2 - cab.x0).toBeGreaterThanOrEqual(1.0);
    expect(Math.abs(SPEC.console.z) + cw / 2).toBeLessThanOrEqual(I.halfWidth);
    expect(ch).toBeLessThan(SPEC.ceilingY - SPEC.floorY);
    // lights: head at the front face, tail at the rear face, within the body outline; interior just under the ceiling, one in the cab
    const {head, tail, interior, marker} = SPEC.lights;
    expect(head).toHaveLength(2);
    expect(tail).toHaveLength(2);
    for (const [set, sgn] of [[head, 1], [tail, -1], [marker.front, 1], [marker.rear, -1]] as const) for (const p of set) {
      expect(sgn * p.x).toBeGreaterThan(I.x1);
      expect(sgn * p.x).toBeLessThanOrEqual(SPEC.length / 2 + 0.1);
      expect(p.y).toBeGreaterThan(SPEC.floorY);
      expect(p.y).toBeLessThan(SPEC.roofY);
      expect(Math.abs(p.z)).toBeLessThan(SPEC.width / 2);
    }
    expect(interior).toHaveLength(3);
    for (const p of interior) {
      expect(p.x).toBeGreaterThan(I.x0);
      expect(p.x).toBeLessThan(I.x1);
      expect(Math.abs(p.z)).toBeLessThan(I.halfWidth);
      expect(p.y).toBeLessThan(SPEC.ceilingY);
      expect(p.y).toBeGreaterThan(SPEC.ceilingY - 0.2);
    }
    expect(interior.some(p => p.x > cab.x0 && p.x < cab.x1)).toBe(true);
  });

  it('the shipped shell: no skin in the walkable box, every doorway open, grounded on the rail plane, wheels on the rails', async () => {
    const tris = await triangles(PLAYER_TRAIN_MODELS['player-train-shell'].url);
    expect(tris.length).toBe(PLAYER_TRAIN_MODELS['player-train-shell'].tris);
    const b = boundsOf(tris);
    expect(b.min[1]).toBeCloseTo(0, 3);
    expect(b.max[1]).toBeCloseTo(SPEC.roofY, 3);
    expect(b.max[2] - b.min[2]).toBeCloseTo(SPEC.width, 3);
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(0.02);
    const I = SPEC.interior;
    const hits = (box: Box) => tris.filter(t => triBox(box, t)).length;
    expect(hits({min: [I.x0, SPEC.floorY + 0.005, -I.halfWidth], max: [I.x1, SPEC.ceilingY, I.halfWidth]})).toBe(0);
    for (const d of SPEC.doors) {
      // the clear opening, from the lining out past the skin
      expect(hits({min: [d.x - d.width / 2 + 0.01, SPEC.floorY + 0.01, d.side < 0 ? -2 : I.halfWidth], max: [d.x + d.width / 2 - 0.01, SPEC.floorY + d.height - 0.01, d.side < 0 ? -I.halfWidth : 2]})).toBe(0);
      // the sliding pockets of both leaves (open or closed) inside the wall cavity
      const z0 = SPEC.doorLeaf.outerZ - SPEC.doorLeaf.thickness, z1 = SPEC.doorLeaf.outerZ - 0.003;
      expect(hits({min: [d.x - d.width / 2 - SPEC.doorLeaf.width, SPEC.floorY + 0.005, d.side < 0 ? -z1 : z0], max: [d.x + d.width / 2 + SPEC.doorLeaf.width, SPEC.floorY + d.height, d.side < 0 ? -z0 : z1]})).toBe(0);
    }
    // the door openings really are holes: the skin beside each doorway is still there
    for (const d of SPEC.doors) expect(hits({min: [d.x + d.width / 2 + 0.2, SPEC.floorY + 0.5, d.side < 0 ? -2 : I.halfWidth], max: [d.x + d.width / 2 + 0.3, SPEC.floorY + 1.0, d.side < 0 ? -I.halfWidth : 2]})).toBeGreaterThan(0);
    // wheel treads (the lowest geometry) centred on the running rails at +-0.72
    const low = tris.flat().filter(p => p[1] < 0.02);
    for (const sd of [-1, 1]) {
      const zs = low.filter(p => Math.sign(p[2]) === sd).map(p => Math.abs(p[2]));
      expect((Math.min(...zs) + Math.max(...zs)) / 2).toBeCloseTo(0.72, 2);
    }
  }, 60000);

  it('door leaf and console GLBs keep their documented frames', async () => {
    const leaf = await triangles(PLAYER_TRAIN_MODELS['player-train-door-leaf'].url);
    const lb = boundsOf(leaf);
    expect(lb.min[1]).toBeCloseTo(0, 3);
    expect(Math.abs(lb.min[0] + lb.max[0])).toBeLessThan(1e-3);
    expect(Math.abs(lb.min[2] + lb.max[2])).toBeLessThan(1e-3); // the two mirrored faces
    expect(lb.max[0] - lb.min[0]).toBeCloseTo(SPEC.doorLeaf.width, 3);
    expect(lb.max[1] - lb.min[1]).toBeCloseTo(SPEC.doorLeaf.height, 3);
    expect(lb.max[2] - lb.min[2]).toBeCloseTo(SPEC.doorLeaf.thickness, 3);
    // the T-handle (the outermost geometry on either face) is on the closing edge, +X
    const handle = leaf.flat().filter(p => Math.abs(p[2]) > lb.max[2] - 0.002);
    expect(handle.length).toBeGreaterThan(0);
    expect(handle.every(p => p[0] > 0)).toBe(true);
    const con = await triangles(PLAYER_TRAIN_MODELS['player-train-console'].url);
    const cb = boundsOf(con);
    expect(cb.min[1]).toBeCloseTo(0, 3);
    expect(Math.abs(cb.min[0] + cb.max[0])).toBeLessThan(1e-3);
    expect(Math.abs(cb.min[2] + cb.max[2])).toBeLessThan(1e-3);
    expect(cb.max[2] - cb.min[2]).toBeGreaterThan(cb.max[0] - cb.min[0]); // width along Z
    // the sloped control panel faces the operator (-X): area-weighted normals of the upper half point toward -X
    let nx = 0;
    for (const t of con) if (t.every(p => p[1] > 0.6)) nx += cross(sub(t[1], t[0]), sub(t[2], t[0]))[0];
    expect(nx).toBeLessThan(0);
  }, 60000);

  // task studio-beta-train-shell-followup-20261101-221246-01 (user: "messed up geometry / triangles", "see through the windows")
  it('the shipped shell is repaired: no degenerate faces, no inside-out normals, no coincident overlaps (folds / duplicate layers)', async () => {
    const tris = await trianglesWithNormals(PLAYER_TRAIN_MODELS['player-train-shell'].url);
    expect(census(tris)).toEqual({degenerate: 0, normalFlip: 0, coincident: 0});
    const rep = prov.derivation.shell.repair;
    expect(rep.census.after).toMatchObject({degenerate: 0, normalFlip: 0, foldOverlaps: 0, duplicateOverlaps: 0});
    expect(rep.census.before.foldOverlaps).toBeGreaterThan(0); // the Meshy folds the repair removed (documented, not silent)
  }, 120000);

  it('windows: every side window (cab / saloon / rear / nose) + both end faces + the leaf, on the faces, inside the body, pockets handled', () => {
    const {interior: I, cab, doorLeaf: L, windows: Wn} = SPEC;
    const zone = (z: string) => Wn.side.filter(w => w.zone === z);
    // task lockbox-windows (user: "The windows on the side of the train remain solid. Make them see through!"): all of them, both sides
    expect([zone('cab').length, zone('saloon').length, zone('rear').length, zone('nose').length]).toEqual([4, 6, 2, 4]);
    for (const side of [-1, 1] as const) expect(Wn.side.filter(w => w.side === side)).toHaveLength(8);
    const pocketsOf = (side: number) => SPEC.doors.filter(q => q.side === side).flatMap(d => [[d.x - d.width / 2 - 0.01 - L.width, d.x - d.width / 2 - 0.01], [d.x + d.width / 2 + 0.01, d.x + d.width / 2 + 0.01 + L.width]]);
    for (const w of Wn.side) {
      expect(w.x1 - w.x0).toBeGreaterThan(0.2);
      expect(w.y0).toBeGreaterThan(SPEC.floorY + 0.5);
      expect(w.y1).toBeLessThan(SPEC.ceilingY);
      expect(w.skinZ).toBeLessThanOrEqual(SPEC.width / 2);
      if (w.zone === 'cab') { expect(w.x0).toBeGreaterThanOrEqual(cab.x0 + 0.05); expect(w.x1).toBeLessThanOrEqual(I.x1); }
      if (w.zone === 'saloon') { expect(w.x0).toBeGreaterThan(I.x0); expect(w.x1).toBeLessThan(cab.x0); }
      if (w.zone === 'rear') { expect(w.x0).toBeGreaterThan(I.x0); expect(w.x1).toBeLessThan(SPEC.rear!.x1); }
      if (w.zone === 'nose') { expect(Math.min(Math.abs(w.x0), Math.abs(w.x1))).toBeGreaterThan(I.x1); expect(w.skinZ).toBeGreaterThan(1.2); } // beyond the bulkheads
      else expect(w.skinZ).toBeGreaterThan(L.outerZ); // the glass plane lies outside the leaf / lining zone, on the skin
      if (w.pocket) {
        // a pocket-door window (rear): the recorded span is the parked leaf behind it, and it really overlaps the window
        expect(w.zone).toBe('rear');
        expect(pocketsOf(w.side).some(([p0, p1]) => Math.abs(p0 - w.pocket!.x0) < 2e-3 && Math.abs(p1 - w.pocket!.x1) < 2e-3)).toBe(true);
        expect(w.pocket.x0 < w.x1 && w.pocket.x1 > w.x0).toBe(true);
      } else {
        // an open leaf parks at |z| outerZ - thickness .. outerZ beside its doorway: never behind a plain side window
        for (const [p0, p1] of pocketsOf(w.side)) expect(w.x1 <= p0 - 0.039 || w.x0 >= p1 + 0.039, `window ${w.x0}..${w.x1} vs pocket ${p0}..${p1}`).toBe(true);
      }
    }
    expect(zone('rear').every(w => w.pocket)).toBe(true);
    for (const end of [1, -1] as const) {
      const ws = Wn.end.filter(w => w.end === end).sort((a, b) => a.z0 - b.z0);
      expect(ws).toHaveLength(3);
      for (let i = 1; i < ws.length; i++) expect(ws[i].z0).toBeGreaterThan(ws[i - 1].z1);
      for (const w of ws) {
        expect(w.z0).toBeGreaterThanOrEqual(-I.halfWidth);
        expect(w.z1).toBeLessThanOrEqual(I.halfWidth);
        expect(w.y0).toBeGreaterThan(SPEC.floorY + 0.5);
        expect(w.y1).toBeLessThan(SPEC.ceilingY);
        expect(w.skinX).toBeGreaterThan(I.x1);
        expect(w.skinX).toBeLessThan(SPEC.length / 2);
      }
    }
    // the leaf window lies inside the leaf, the closing-edge stile (+X, the T-handle) kept
    const lw = Wn.leaf;
    expect(lw.x0).toBeGreaterThan(-L.width / 2);
    expect(lw.x1).toBeLessThan(L.width / 2 - 0.05);
    expect(lw.x0).toBeLessThan(lw.x1);
    expect(lw.y0).toBeGreaterThanOrEqual(0);
    expect(lw.y1).toBeLessThan(L.height);
    expect(lw.y1 - lw.y0).toBeGreaterThan(1.5);
  });

  it('the shipped models really are open at every window, with the skin / frame still around it', async () => {
    const tris = await triangles(PLAYER_TRAIN_MODELS['player-train-shell'].url);
    const I = SPEC.interior;
    const hits = (box: Box) => tris.filter(t => triBox(box, t)).length;
    for (const w of SPEC.windows.side) {
      const zIn = w.side < 0 ? -2 : I.halfWidth, zOut = w.side < 0 ? -I.halfWidth : 2;
      if (w.zone === 'nose') { // the corner wrap: open from the end-window hole's edge (|z| skinZ) out
        expect(hits({min: [w.x0 + 0.01, w.y0 + 0.01, w.side < 0 ? -2 : w.skinZ + 0.01], max: [w.x1 - 0.01, w.y1 - 0.01, w.side < 0 ? -(w.skinZ + 0.01) : 2]}), `nose window ${w.x0}`).toBe(0);
        continue;
      }
      expect(hits({min: [w.x0 + 0.01, w.y0 + 0.01, zIn], max: [w.x1 - 0.01, w.y1 - 0.01, zOut]}), `side window ${w.x0}`).toBe(0);
      expect(hits({min: [w.x0, w.y1 + 0.03, zIn], max: [w.x1, w.y1 + 0.08, zOut]}), `skin above ${w.x0}`).toBeGreaterThan(0);
    }
    for (const w of SPEC.windows.end) {
      const xIn = w.end > 0 ? I.x1 : -9, xOut = w.end > 0 ? 9 : -I.x1;
      expect(hits({min: [xIn, w.y0 + 0.01, w.z0 + 0.01], max: [xOut, w.y1 - 0.01, w.z1 - 0.01]}), `end window ${w.end} ${w.z0}`).toBe(0);
      expect(hits({min: [xIn, w.y1 + 0.03, w.z0], max: [xOut, w.y1 + 0.08, w.z1]}), `end skin above ${w.end} ${w.z0}`).toBeGreaterThan(0);
    }
    const leaf = await triangles(PLAYER_TRAIN_MODELS['player-train-door-leaf'].url);
    const lw = SPEC.windows.leaf;
    const leafHits = (box: Box) => leaf.filter(t => triBox(box, t)).length;
    expect(leafHits({min: [lw.x0 + 0.01, lw.y0 + 0.01, -0.005], max: [lw.x1 - 0.01, lw.y1 - 0.01, 0.005]})).toBe(0); // both glass faces gone
    expect(leafHits({min: [lw.x1 + 0.02, lw.y0 + 0.2, -0.03], max: [SPEC.doorLeaf.width / 2, lw.y1 - 0.2, 0.03]})).toBeGreaterThan(0); // the stile
    expect(leafHits({min: [-SPEC.doorLeaf.width / 2, lw.y0 + 0.2, -0.03], max: [lw.x0 - 0.005, lw.y1 - 0.2, 0.03]})).toBeGreaterThan(0); // the rim
  }, 60000);

  // task studio-beta-train-lockbox-windows-20261101-232156-01 (user: "I want to add a lock box in the back compartement of the train")
  it('lockbox: Meshy model with a body + hinged lid node, real size, grounded / centred, cavity inside the body, provenance pinned', async () => {
    const M = PLAYER_TRAIN_MODELS['player-train-lockbox'], LB = PLAYER_TRAIN_MEASURED.lockbox;
    expect(M.url).toBe('assets/models/player-train-lockbox.glb');
    expect(levelOfAsset(M.url)).toBeNull();
    expect(LB.length).toBeGreaterThanOrEqual(1.0);
    expect(LB.length).toBeLessThanOrEqual(1.05);
    expect([LB.length, LB.height, LB.depth]).toEqual([...M.dims]);
    const doc = await new NodeIO().read(pub(M.url));
    const nodes = doc.getRoot().listNodes().filter(n => n.getMesh());
    expect(nodes.map(n => n.getName()).sort()).toEqual(['lockbox-body', 'lockbox-lid']);
    const body = nodes.find(n => n.getName() === 'lockbox-body')!, lid = nodes.find(n => n.getName() === 'lockbox-lid')!;
    expect(body.getTranslation()).toEqual([0, 0, 0]);
    const lt = lid.getTranslation();
    expect(lt[0]).toBe(0);
    expect(lt[1]).toBeCloseTo(LB.hinge.y, 4);
    expect(lt[2]).toBeCloseTo(LB.hinge.z, 4);
    expect(LB.seamY).toBe(LB.hinge.y);
    const verts = (n: typeof body) => { const P = n.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getArray()!; const out: V3[] = []; for (let i = 0; i < P.length; i += 3) out.push([P[i], P[i + 1], P[i + 2]]); return out; };
    const bv = verts(body), lv = verts(lid);
    const bb = {min: [0, 1, 2].map(k => Math.min(...bv.map(v => v[k]))), max: [0, 1, 2].map(k => Math.max(...bv.map(v => v[k])))};
    // grounded / centred / front +Z: the whole box spans x / z symmetric about 0 and starts at y 0
    const all = [...bv, ...lv.map(v => [v[0] + lt[0], v[1] + lt[1], v[2] + lt[2]] as V3)];
    expect(Math.min(...all.map(v => v[1]))).toBeCloseTo(0, 3);
    expect(Math.abs(Math.min(...all.map(v => v[0])) + Math.max(...all.map(v => v[0])))).toBeLessThan(2e-3);
    expect(Math.abs(Math.min(...all.map(v => v[2])) + Math.max(...all.map(v => v[2])))).toBeLessThan(2e-3);
    // the hinge is the back-top edge: at the seam, at the back; the lid lies in front of / above it (hasps hang a little at the front)
    expect(LB.hinge.z).toBeLessThan(-0.45 * LB.depth);
    expect(LB.seamY).toBeGreaterThan(0.5 * LB.height);
    expect(Math.min(...lv.map(v => v[2]))).toBeGreaterThan(-0.01);
    expect(Math.min(...lv.map(v => v[1]))).toBeGreaterThan(-0.06);
    expect(Math.max(...lv.map(v => v[1])) + LB.hinge.y).toBeCloseTo(LB.height, 3);
    // the body stops at the seam (an open box: no top face; its catches peek a little above), the cavity sits inside it
    expect(bb.max[1]).toBeLessThan(LB.seamY + 0.02);
    const C = LB.cavity;
    expect(C.x0).toBeGreaterThan(bb.min[0]); expect(C.x1).toBeLessThan(bb.max[0]);
    expect(C.z0).toBeGreaterThan(bb.min[2]); expect(C.z1).toBeLessThan(bb.max[2]);
    expect(C.y0).toBeGreaterThan(0); expect(C.y1).toBe(LB.seamY);
    expect(bv.filter(v => v[1] > LB.seamY - 0.01 && Math.abs(v[0]) < C.x1 - 0.05 && v[2] > C.z0 + 0.05 && v[2] < C.z1 - 0.05)).toHaveLength(0); // open top
    // opened ~100 deg about the hinge (rotation.x = -angle), the lid swings up and back, clear of the cavity
    const a = -100 * Math.PI / 180;
    const opened = lv.map(v => [v[0], lt[1] + v[1] * Math.cos(a) - v[2] * Math.sin(a), lt[2] + v[1] * Math.sin(a) + v[2] * Math.cos(a)]);
    expect(Math.min(...opened.map(v => v[1]))).toBeGreaterThan(LB.seamY - 0.08);
    expect(Math.max(...opened.map(v => v[2]))).toBeLessThan(C.z0 + 0.1);
    // provenance: the ONE accepted lockbox refine, its raw hash and the lockbox ledger
    const m = prov.models['train-lockbox'];
    expect(m.tasks).toEqual({preview: '01a1996f-788c-73a8-b72f-b0cbf80a91ea', refine: '01a19970-d6a7-7150-ac6c-a68aa972b326'});
    expect(m.source.sha256).toBe('b6b9857fedeb64df69651d7cc47ce230146d577694b6548ee118668a27782f7d');
    const b = fs.readFileSync(pub(M.url));
    expect(m.output).toEqual({url: M.url, bytes: b.length, sha256: sha(b)});
    expect(m.derivative).toMatchObject({meshes: 2, materials: 1, triangles: M.tris});
    expect(prov.lockboxLedger).toMatchObject({accepted: 1, credits: {reserved: 0}});
    expect(prov.lockboxLedger.credits.billed).toBeLessThanOrEqual(50);
    expect(M.tris).toBeLessThanOrEqual(12000);
  }, 60000);

  // task studio-beta-train-window-fit-20261102-004022-01 (user: "front window is not curved to align with the body ... all windows need
  // to be better matched to car geometry. there is a seem between the the walls and the roof of the subway cab")
  it('the shell has no see-through cracks in lane TRAIN\'s probe bands (cove seam, door heads, crescent, roof)', async () => {
    const tris = await triangles(PLAYER_TRAIN_MODELS['player-train-shell'].url);
    const hitAlong = (u: number, v: number, ax: [number, number, number], pred: (n: number) => boolean) => tris.some(t => {
      const [a, b, c] = t, [iu, iv, inn] = ax;
      if (Math.max(a[iu], b[iu], c[iu]) < u || Math.min(a[iu], b[iu], c[iu]) > u || Math.max(a[iv], b[iv], c[iv]) < v || Math.min(a[iv], b[iv], c[iv]) > v) return false;
      const d = (b[iu] - a[iu]) * (c[iv] - a[iv]) - (c[iu] - a[iu]) * (b[iv] - a[iv]);
      if (Math.abs(d) < 1e-14) return false;
      const p = ((u - a[iu]) * (c[iv] - a[iv]) - (c[iu] - a[iu]) * (v - a[iv])) / d, q = ((b[iu] - a[iu]) * (v - a[iv]) - (u - a[iu]) * (b[iv] - a[iv])) / d;
      return p >= 0 && q >= 0 && p + q <= 1 && pred(a[inn] + p * (b[inn] - a[inn]) + q * (c[inn] - a[inn]));
    });
    const misses: string[] = [];
    for (let x = -4.4; x <= 6.9; x += 0.1) for (let y = 3.0; y <= 3.12; y += 0.005) if (!hitAlong(x, y, [0, 1, 2], z => z < -1.0)) misses.push(`seam ${x.toFixed(1)},${y.toFixed(3)}`);
    for (const d of SPEC.doors) for (let x = d.x - d.width / 2 + 0.01; x < d.x + d.width / 2 - 0.01; x += 0.02) for (let y = 2.983; y <= 2.995; y += 0.003) if (!hitAlong(x, y, [0, 1, 2], z => d.side * z > 1.0)) misses.push(`door head ${d.side} ${x.toFixed(2)},${y.toFixed(3)}`);
    for (let x = 0.8; x <= 3.5; x += 0.05) for (let y = 2.845; y <= 2.94; y += 0.005) if (!(x > 1.62 && x < 2.75 && y < 2.84) && !hitAlong(x, y, [0, 1, 2], z => z > 1.0)) misses.push(`crescent ${x.toFixed(2)},${y.toFixed(3)}`);
    for (const x of [-3, 0, 2.04, 4]) for (let z = -1.2; z <= 1.2; z += 0.005) if (!hitAlong(x, z, [0, 2, 1], y => y > 3.2)) misses.push(`roof ${x},${z.toFixed(3)}`);
    expect(misses).toEqual([]);
  }, 120000);

  it('conformal glass: one sheet per opening (wraps round the nose), local to its window, curved with the body, never through the skin, boxed', async () => {
    const G = PLAYER_TRAIN_GLASS, W = SPEC.windows;
    expect(G.url).toBe(PLAYER_TRAIN_MODELS['player-train-glass'].url);
    expect(fs.statSync(pub(G.url)).size).toBe(G.bytes);
    const doc = await new NodeIO().read(pub(G.url));
    const nodes = new Map(doc.getRoot().listNodes().map(n => [n.getName(), n]));
    // every window has glass: 12 side sheets (non-nose), 6 end sheets (4 of them wraps joined with their nose window), the leaf
    const side = G.sheets.filter(g => g.kind === 'side'), end = G.sheets.filter(g => g.kind === 'end'), leaf = G.sheets.filter(g => g.kind === 'leaf');
    expect([side.length, end.length, leaf.length]).toEqual([W.side.filter(w => w.zone !== 'nose').length, W.end.length, 1]);
    const joined = end.filter(g => 'joined' in g).map(g => (g as {joined: number}).joined).sort((a, b) => a - b);
    expect(joined).toEqual(W.side.map((w, i) => (w.zone === 'nose' ? i : -1)).filter(i => i >= 0));
    for (const n of [...G.sheets.map(g => g.node), ...G.reveals]) expect(nodes.has(n), n).toBe(true);
    const shell = await triangles(PLAYER_TRAIN_MODELS['player-train-shell'].url);
    const firstHit = (o: V3, d: V3) => { let best = Infinity; for (const [a, b, c] of shell) { const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p); if (Math.abs(det) < 1e-12) continue; const s2 = sub(o, a), u = dot(s2, p) / det; if (u < 0 || u > 1) continue; const q = cross(s2, e1), v = dot(d, q) / det; if (v < 0 || u + v > 1) continue; const t = dot(e2, q) / det; if (t > 0 && t < best) best = t; } return best; };
    for (const g of G.sheets) {
      if (g.kind === 'leaf') continue;
      const P = nodes.get(g.node)!.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getArray()!;
      const pts: V3[] = []; for (let i = 0; i < P.length; i += 3) pts.push([P[i], P[i + 1], P[i + 2]]);
      expect(g.fitError, g.node).toBeLessThanOrEqual(0.015); // follows the original pane surface
      expect(g.recess, g.node).toBeLessThanOrEqual(0.04);
      // local to its window: side sheets inside the rect (+ overlap) in x / y and on the skin side of the lining
      if (g.kind === 'side') {
        const w = W.side[g.window];
        for (const q of pts) { expect(q[0]).toBeGreaterThan(w.x0 - 0.03); expect(q[0]).toBeLessThan(w.x1 + 0.03); expect(q[1]).toBeGreaterThan(w.y0 - 0.03); expect(q[1]).toBeLessThan(w.y1 + 0.03); expect(w.side * q[2]).toBeGreaterThan(SPEC.interior.halfWidth); }
      } else {
        const w = W.end[g.window];
        // beyond the bulkhead, or (a wrap's corner band) beside the lining in the wall cavity: never inside the lining box
        for (const q of pts) { expect(w.end * q[0] > SPEC.interior.x1 || Math.abs(q[2]) > SPEC.interior.halfWidth, `${g.node} ${q}`).toBe(true); expect(q[1]).toBeGreaterThan(Math.min(w.y0, 1.8) - 0.05); }
        // the wraps follow the nose's plan curve (not a flat pane): their glass spans > 15 cm in x
        if ('joined' in g) expect(Math.max(...pts.map(q => q[0])) - Math.min(...pts.map(q => q[0])), g.node).toBeGreaterThan(0.15);
      }
      // never through the skin: no shell surface just outward of any sheet point (outward = away from the car core)
      for (let k = 0; k < pts.length; k += 3) {
        const q = pts[k], o: V3 = g.kind === 'side' ? [0, 0, Math.sign(q[2])] : (() => { const c: V3 = [Math.sign(q[0]) * 6.5, q[1], 0], d = sub(q, c), l = Math.hypot(d[0], d[2]); return [d[0] / l, 0, d[2] / l] as V3; })();
        expect(firstHit(q, o), `${g.node} point ${k}`).toBeGreaterThan(0.0005); // the build keeps >= 1 mm (float64); GLB positions are float32
      }
      // the hitscan slabs cover the sheet
      for (const q of pts) expect(g.boxes.some(b => [0, 1, 2].every(a => q[a] >= b.min[a] - 1e-3 && q[a] <= b.max[a] + 1e-3)), g.node).toBe(true);
    }
    // the leaf sheet spans the leaf window (leaf frame) at the mid-plane
    const lb = leaf[0].bounds;
    expect(lb.min[0]).toBeLessThan(W.leaf.x0); expect(lb.max[0]).toBeGreaterThan(W.leaf.x1);
    expect(lb.min[1]).toBeLessThan(W.leaf.y0); expect(lb.max[1]).toBeGreaterThan(W.leaf.y1);
    expect(lb.min[2]).toBe(0); expect(lb.max[2]).toBe(0);
  }, 180000);
});
