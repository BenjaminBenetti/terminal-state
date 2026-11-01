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
import {PLAYER_TRAIN_MEASURED, PLAYER_TRAIN_MODELS, PLAYER_TRAIN_TEXTURES} from '../src/assets/playerTrain.generated';
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
    expect(PLAYER_TRAIN_MODELS['player-train-door-leaf'].tris).toBeLessThanOrEqual(10000);
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
});
