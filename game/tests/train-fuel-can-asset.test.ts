// Task studio-train-fuel-can-asset-20261106-030724-01: the train FUEL CAN runtime model (assets/models/train-fuel-can.glb), delivered to
// Beta's train fuel system — a Meshy T2.5 image-to-3D derivative (Codex INITIAL concept -> Meshy; Meshy's own PBR maps kept, re-encoded),
// cooked by tools/asset-pipeline/props/build-train-fuel-can.mjs. Checks the runtime contract Beta integrates against: real size, grounded
// / centred pivot, front +Z, one PBR material, the triangle budget, provenance <-> release allowlist.
// Task studio-beta-fuel-feedback-20261106-064128-01 (lane ASSET), user feedback: "Smaller fuel cans roughly med-pack sized" -> a ~5 l
// can 0.2015 x 0.30 x 0.105 m (= ITEM_DIMS.fuel_can; the med kit is 0.32 x 0.22 x 0.14 m), and "Fuel spelled in reverse on the back
// side" -> the back (-Z) stencil un-mirrored by a deterministic texel mirror (lib/label-mirror.mjs): checked on the delivered base colour.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {NodeIO, type Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/functions';
import {itemDims} from '../src/items/items';
import {itemPhysics} from '../src/damage/materials';

const MODEL = 'assets/models/train-fuel-can.glb', SIDECAR = 'assets/derivatives/train-fuel-can.json';
const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const repo = (rel: string) => fileURLToPath(new URL('../../' + rel, import.meta.url));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const load = (bytes: Uint8Array) => new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);

/** Pearson correlation. */
function corr(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return ab / Math.sqrt(aa * bb);
}

/**
 * Base-colour luminance of the label band on both broad sides, sampled through the model's own UVs: back(x, y) = the outermost
 * -Z-facing surface at (x, y), front(x, y) likewise on +Z. Viewed from behind, screen-right is world -x, so the back reads like the
 * front exactly when back(x, y) ~ front(-x, y); a see-through copy of the front (the Meshy single-view defect: mirrored from behind)
 * has back(x, y) ~ front(x, y) instead. The band is in fractions of the bounds, so the same check runs on any delivered size.
 */
async function labelCorrelations(doc: Document) {
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const tex = root.listMaterials()[0].getBaseColorTexture()!;
  const {data, info} = await sharp(Buffer.from(tex.getImage()!)).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
  const W = b.max[0] - b.min[0], H = b.max[1] - b.min[1];
  const y0 = 0.635 * H, y1 = 0.775 * H, xh = 0.29 * W;
  const pos = prim.getAttribute('POSITION')!, uv = prim.getAttribute('TEXCOORD_0')!, idx = prim.getIndices()!;
  type Tri = {p: number[][]; t: number[][]; nz: number};
  const tris: Tri[] = [];
  for (let i = 0; i < idx.getCount(); i += 3) {
    const I = [0, 1, 2].map(k => idx.getScalar(i + k));
    const p = I.map(j => pos.getElement(j, [0, 0, 0]) as number[]), t = I.map(j => uv.getElement(j, [0, 0]) as number[]);
    if (Math.max(p[0][1], p[1][1], p[2][1]) < y0 || Math.min(p[0][1], p[1][1], p[2][1]) > y1) continue;
    const ex = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], ey = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    const l = Math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2);
    if (l > 0) tris.push({p, t, nz: n[2] / l});
  }
  const lum = (x: number, y: number, side: 1 | -1): number | null => {
    let best: {t: Tri; w: number[]; z: number} | null = null;
    for (const t of tris) {
      if (t.nz * side < 0.05) continue;
      const [a, bb, c] = t.p, d = (bb[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (bb[1] - a[1]);
      if (Math.abs(d) < 1e-14) continue;
      const w1 = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / d, w2 = ((bb[0] - a[0]) * (y - a[1]) - (x - a[0]) * (bb[1] - a[1])) / d;
      const w = [1 - w1 - w2, w1, w2];
      if (w.some(v => v < 0)) continue;
      const z = (w[0] * a[2] + w[1] * bb[2] + w[2] * c[2]) * side;
      if (!best || z > best.z) best = {t, w, z};
    }
    if (!best) return null;
    const u = best.w.reduce((s, v, k) => s + v * best!.t.t[k][0], 0), v = best.w.reduce((s, q, k) => s + q * best!.t.t[k][1], 0);
    const fx = Math.min(info.width - 1, Math.max(0, u * info.width - 0.5)), fy = Math.min(info.height - 1, Math.max(0, v * info.height - 0.5));
    const x0 = Math.floor(fx), yy0 = Math.floor(fy), x1 = Math.min(info.width - 1, x0 + 1), yy1 = Math.min(info.height - 1, yy0 + 1), ax = fx - x0, ay = fy - yy0;
    const L = (px: number, py: number) => { const o = (py * info.width + px) * 3; return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; };
    return (L(x0, yy0) * (1 - ax) + L(x1, yy0) * ax) * (1 - ay) + (L(x0, yy1) * (1 - ax) + L(x1, yy1) * ax) * ay;
  };
  const back: number[] = [], front: number[] = [], frontMirror: number[] = [];
  const step = 0.0035 * H;
  for (let y = y0; y <= y1; y += step) for (let x = -xh; x <= xh; x += step) {
    const bk = lum(x, y, -1), f = lum(x, y, 1), fm = lum(-x, y, 1);
    if (bk === null || f === null || fm === null) continue;
    back.push(bk); front.push(f); frontMirror.push(fm);
  }
  return {samples: back.length, readableFromBehind: corr(back, frontMirror), seeThrough: corr(back, front)};
}

describe('train fuel can model (asset handoff to the train fuel system)', () => {
  it('real size (med-kit sized ~5 l can), grounded and centred, one Meshy PBR material, ~4k triangles; provenance and allowlist match the bytes', async () => {
    const bytes = readFileSync(pub(MODEL));
    const prov = JSON.parse(readFileSync(pub(SIDECAR), 'utf8'));
    const doc = await load(new Uint8Array(bytes));
    const root = doc.getRoot();
    const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
    const dims = [0, 1, 2].map(k => b.max[k] - b.min[k]);
    expect(dims[1]).toBeCloseTo(0.30, 3); // user feedback: med-kit sized, handle and spout included
    expect(dims[2]).toBeCloseTo(0.105, 3); // the depth fit
    expect(dims[0]).toBeGreaterThan(0.19);
    expect(dims[0]).toBeLessThan(0.21);
    // the item frame follows the delivered bounds (pickups / fallback box / physics footprint), and the mass follows the size
    const D = itemDims('fuel_can');
    expect(D.shape).toBe('box');
    expect(D.w).toBeCloseTo(dims[0], 3); expect(D.h).toBeCloseTo(dims[1], 3); expect(D.d).toBeCloseTo(dims[2], 3);
    expect(itemPhysics('fuel_can').mass).toBeGreaterThan(3);
    expect(itemPhysics('fuel_can').mass).toBeLessThan(6);
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
    expect(prov).toMatchObject({id: 'train-fuel-can', accepted: true, heightM: 0.3, depthM: 0.105, output: {url: MODEL, bytes: bytes.length, sha256: sha(bytes)}});
    expect(prov.output.dims).toEqual(dims.map(v => +v.toFixed(4)));
    expect(prov.convention).toMatch(/front \+Z/);
    expect(prov.labelRepair.method).toMatch(/^deterministic texel mirror of the back label; Meshy maps otherwise kept/);
    expect(prov.labelRepair.maps).toEqual(['baseColor', 'metallicRoughness', 'normal']);
    expect(JSON.stringify(prov)).not.toMatch(/https?:|Signature|X-Amz|token=/i);
    const allow = new Map((JSON.parse(readFileSync(repo('tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
    const side = readFileSync(pub(SIDECAR));
    expect(allow.get(MODEL)).toEqual({path: MODEL, bytes: bytes.length, sha256: sha(bytes)});
    expect(allow.get(SIDECAR)).toEqual({path: SIDECAR, bytes: side.length, sha256: sha(side)});
  });

  it('FUEL reads correctly on BOTH broad sides: the back label matches the front as seen from behind, not as seen through the can', async () => {
    const c = await labelCorrelations(await load(new Uint8Array(readFileSync(pub(MODEL)))));
    expect(c.samples).toBeGreaterThan(2000);
    // measured: readable 0.90 / see-through 0.39 after the repair; the unrepaired Meshy texture gave readable 0.38 / see-through 0.88
    expect(c.readableFromBehind).toBeGreaterThan(0.75);
    expect(c.seeThrough).toBeLessThan(0.6);
    expect(c.readableFromBehind - c.seeThrough).toBeGreaterThan(0.3);
  });
});
