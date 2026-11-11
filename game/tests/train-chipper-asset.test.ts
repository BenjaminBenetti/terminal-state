// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane ASSET): the train CHIPPER's runtime model (assets/models/train-chipper.glb) —
// a Meshy T2.5 image-to-3D derivative of one Codex design image (Codex -> Meshy; Meshy's own PBR maps kept, re-encoded), cooked by
// tools/asset-pipeline/props/build-train-chipper.mjs. Checks the contract the runtime builds on (world/chipperSpec.ts): the car-pocket
// size, grounded / centred pivot, one PBR material with all three maps, the triangle budget, the MEASURED anchors really sit on the
// mesh (open hopper floor under the mouth, the control box face under the panel, the spout ring around the outlet), the car's model
// catalogue carries it, and provenance / CREDITS / the release allowlist bind the exact bytes (raw master hash pinned; it stays
// outside Git).
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {TRAIN_CHIPPER, TRAIN_CHIPPER_ANCHORS, TRAIN_CHIPPER_MEASURED, TRAIN_CHIPPER_SIZE} from '../src/assets/trainChipper.generated';
import {CHIPPER_ANCHORS, CHIPPER_MODEL, CHIPPER_SIZE} from '../src/world/chipperSpec';
import {PLAYER_TRAIN_MODEL_FILES} from '../src/world/playerTrain';
import {levelOfAsset} from '../src/assets/levelAssets';

const MODEL = 'assets/models/train-chipper.glb', SIDECAR = 'assets/derivatives/train-chipper.json';
const RAW_SHA = '65cdc4b991f7f6928f6d021691f0b907836403ea89d1b42a422d7f7e6316237c'; // the accepted Meshy original (outside Git)
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

type V3 = [number, number, number];
async function load() {
  const bytes = readFileSync(pub(MODEL));
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
  const tris: V3[][] = [];
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const P = p.getAttribute('POSITION')!.getArray()!, I = p.getIndices()!.getArray()!;
    for (let t = 0; t < I.length; t += 3) tris.push([0, 1, 2].map(k => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]] as V3));
  }
  return {bytes, doc, tris};
}
/** Nearest hit distance of the ray o + t d (t > 0) against the triangles (Moller-Trumbore), or Infinity. */
function cast(tris: V3[][], o: V3, d: V3): number {
  let best = Infinity;
  for (const [a, b, c] of tris) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > 1e-6 && t < best) best = t;
  }
  return best;
}

describe('train chipper model (asset for the corpse chipper fixture)', () => {
  it('fits the car pocket at runtime size, grounded and centred; one Meshy PBR material with all three maps; the cooked budget', async () => {
    const {bytes, doc, tris} = await load();
    const root = doc.getRoot();
    const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
    const dims = [0, 1, 2].map(k => b.max[k] - b.min[k]);
    expect(bytes.length).toBe(TRAIN_CHIPPER.bytes);
    expect(tris.length).toBe(TRAIN_CHIPPER.tris);
    expect(tris.length).toBeLessThan(20000); // Smart Topology's approved target; no simplification
    dims.forEach((v, k) => expect(v).toBeCloseTo(TRAIN_CHIPPER.dims[k], 4));
    expect([CHIPPER_SIZE.l, CHIPPER_SIZE.h, CHIPPER_SIZE.d]).toEqual([...TRAIN_CHIPPER.dims]);
    expect(TRAIN_CHIPPER_SIZE).toBe(CHIPPER_SIZE);
    // the car's bay pocket: <= 1.40 m long, <= 0.64 m deep, the top below the ~0.98 m window sill (about the spec's 1.36 x 0.83 x 0.62)
    expect(dims[0]).toBeLessThanOrEqual(1.40);
    expect(dims[2]).toBeLessThanOrEqual(0.64);
    expect(dims[1]).toBeLessThan(0.9);
    expect(dims[0]).toBeCloseTo(1.36, 3);
    expect(Math.abs(b.min[1])).toBeLessThan(1e-4); // grounded: the base frame's feet on y = 0
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(2e-3); // centred
    expect(Math.abs(b.min[2] + b.max[2])).toBeLessThan(2e-3);
    for (const n of root.listNodes()) expect(n.getMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // baked
    const mats = root.listMaterials();
    expect(mats).toHaveLength(1);
    expect(mats[0].getAlphaMode()).toBe('OPAQUE');
    const maps = {baseColor: mats[0].getBaseColorTexture(), metallicRoughness: mats[0].getMetallicRoughnessTexture(), normal: mats[0].getNormalTexture()};
    for (const [slot, t] of Object.entries(maps)) {
      expect(t, slot).not.toBeNull();
      expect(t!.getMimeType()).toBe('image/jpeg');
      expect(t!.getSize()).toEqual([...TRAIN_CHIPPER.textures[slot as keyof typeof maps]]);
    }
  });

  it('the measured anchors sit on the mesh: open hopper floor under the mouth, the control box face under the panel, the spout ring round the outlet', async () => {
    const {doc, tris} = await load();
    const root = doc.getRoot();
    const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
    const A = CHIPPER_ANCHORS, H = TRAIN_CHIPPER_MEASURED.hopper;
    expect(A).toBe(TRAIN_CHIPPER_ANCHORS);
    expect(CHIPPER_MODEL).toMatchObject({key: TRAIN_CHIPPER.key, url: TRAIN_CHIPPER.url, bytes: TRAIN_CHIPPER.bytes});
    expect(CHIPPER_MODEL).toMatchObject({key: 'train-chipper', url: MODEL});
    const inside = (p: {x: number; y: number; z: number}) => p.x > b.min[0] && p.x < b.max[0] && p.y > b.min[1] && p.y <= b.max[1] && p.z > b.min[2] && p.z < b.max[2];
    for (const k of ['hopper', 'outlet', 'panel'] as const) expect(inside(A[k]), k).toBe(true);
    // hopper: at the -X end, the rim near the top; the mouth rectangle inside the footprint
    expect(A.hopper.x).toBeLessThan(-0.3);
    expect(A.hopper.y).toBeCloseTo(H.rimY, 3);
    expect(A.hopper.y).toBeGreaterThan(0.85 * (b.max[1] - b.min[1]));
    expect(A.hopper.x - A.hopperMouth.x / 2).toBeGreaterThan(b.min[0]);
    expect(Math.abs(A.hopper.z) + A.hopperMouth.z / 2).toBeLessThan(b.max[2]);
    expect(A.hopperMouth.x).toBeGreaterThan(0.3);
    expect(A.hopperMouth.z).toBeGreaterThan(0.4);
    expect(H.floorY).toBeLessThan(H.lipY);
    expect(H.lipY).toBeLessThan(H.rimY);
    // looking straight down into the mouth (centre and around it between the rails) the first surface is the box floor, far below the rim
    for (const [dx, dz] of [[0, 0], [-0.12, 0], [0.12, 0], [0, -0.05], [0, 0.05]]) {
      const t = cast(tris, [A.hopper.x + dx, b.max[1] + 0.1, A.hopper.z + dz], [0, -1, 0]);
      expect(b.max[1] + 0.1 - t, `floor under (${dx}, ${dz})`).toBeCloseTo(H.floorY, 1);
    }
    // panel: on the front (+Z) side; a ray from the aisle at its height hits the control box face at the anchor's plane
    expect(A.panel.z).toBeGreaterThan(0.1);
    const tp = cast(tris, [A.panel.x, A.panel.y, b.max[2] + 0.5], [0, 0, -1]);
    expect(b.max[2] + 0.5 - tp).toBeCloseTo(A.panel.z, 1);
    // outlet: right of the rotor housing, on the machine's middle plane; it is inside the spout: the tube wall surrounds it closely
    expect(A.outlet.x).toBeGreaterThan(A.hopper.x);
    expect(Math.abs(A.outlet.z)).toBeLessThan(0.05);
    const r = TRAIN_CHIPPER_MEASURED.outlet;
    for (const d of [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V3[]) {
      const t = cast(tris, [A.outlet.x + 0.01, A.outlet.y, A.outlet.z], d);
      expect(t, `wall along ${d}`).toBeLessThan(Math.max(r.diameterY, r.diameterZ) / 2 + 0.02);
    }
  });

  it('is in the car\'s model catalogue (shared by every level that parks the train)', () => {
    expect(PLAYER_TRAIN_MODEL_FILES[TRAIN_CHIPPER.key]).toEqual({url: MODEL, bytes: TRAIN_CHIPPER.bytes});
    expect(levelOfAsset(MODEL)).toBeNull();
  });

  it('provenance, CREDITS and the release allowlist bind the exact bytes (hash-only, no prompts / URLs / private paths)', () => {
    const bytes = readFileSync(pub(MODEL)), side = readFileSync(pub(SIDECAR)), credits = readFileSync(pub('assets/CREDITS.md'));
    const prov = JSON.parse(side.toString());
    expect(prov).toMatchObject({id: 'train-chipper', accepted: true, lengthM: 1.36, output: {url: MODEL, bytes: bytes.length, sha256: sha(bytes), triangles: TRAIN_CHIPPER.tris}});
    expect(prov.output.dims).toEqual([...TRAIN_CHIPPER.dims]);
    expect(prov.source.sha256).toBe(RAW_SHA);
    expect(prov.anchors).toEqual(TRAIN_CHIPPER_ANCHORS);
    expect(prov.route).toMatch(/Codex .*-> Meshy T2\.5 image-to-3D.*keeps its own PBR maps/);
    expect(prov.convention).toMatch(/\+Z = the front/);
    expect(prov.meshy.request.file_path).toBeUndefined();
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature|X-Amz|token=|\/workspaces\/|\/home\/|prompt/i);
    expect(credits.toString()).toContain('`assets/models/train-chipper.glb`');
    const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    for (const [p, b] of [[MODEL, bytes], [SIDECAR, side], ['assets/CREDITS.md', credits]] as const)
      expect(allow.get(p), p).toEqual({path: p, bytes: b.length, sha256: sha(b)});
  });
});
