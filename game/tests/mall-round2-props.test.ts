// Task mall-round2-20261031 (Studio Beta, lane PROPS): focused tests for the three reported prop defects.
//  - M03 "the big multi screen security system thing, like with 20 screens, appears sitting on the floor": cctvConsole (D31
//    office-cctv-console.glb, the mall security room island + the Office ironclad rooms) — a 15-screen bank on a desk slab now lifted
//    onto a local steel console base (desk top ~0.75 m), collider / interaction / anchoring following the supported assembly.
//  - M04 "the back of the 'cooler' prop has some messed up geometry": multideckOpenCooler ('open cooler', M30) — inner back wall rebuilt
//    (holes + zero-thickness double sheet), warped shelf corner flattened, stacked deck / shelf / roof sheets deduped, the painted ghost
//    on the outer back cleaned; the glass-door shopCooler ('drinks cooler') is clean and untouched.
//  - M07 "shelving bay has a few flickering issues / triangle issues": wallBay ('shelving bay', M04 retail-wall-bay) — one layer on
//    the slatwall back panel's plane (was 1.30 m2 of stacked / opposite-facing coplanar layers).
// Local derivative recipes: tools/asset-pipeline/props/build-office-overhaul.mjs FURNITURE 'cctv-console' (lib/console-base.mjs) and
// build-mall-track3.mjs EDITS 'multideck-open-cooler' / 'retail-wall-bay' (lib/panel-repair.mjs, lib/coplanar-dedupe.mjs options).
// Repo files only (raw masters stay outside Git): this runs in CI.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Document, NodeIO} from '@gltf-transform/core';
import {COMPANY_ASSETS} from '../src/assets/companyAssets';
import {MALL_ASSETS} from '../src/assets/mallAssets';
import {MALL_DIMS} from '../src/assets/mallDims.generated';
import {PROP_DEFS} from '../src/gen/props';
import {MALL_KIND_ASSET, MALL_SURFACES} from '../src/gen/mall/kinds';
import {HOLDER_LABEL} from '../src/items/loot';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';

const REPO = path.resolve(__dirname, '../..');
const PUB = path.join(REPO, 'game/public');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const ALLOW = new Map((JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.map(f => [f.path, f]));
const MALL_PROV = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/derivatives/mall-track3-20261031.json'), 'utf8'));
const OFFICE_PROV = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/derivatives/office-overhaul-20261030.json'), 'utf8'));
const lib = async <T>(rel: string) => await import(pathToFileURL(path.join(REPO, 'tools/asset-pipeline/props/lib', rel)).href) as T;
const memo = <T>(f: () => Promise<T>) => { let p: Promise<T> | null = null; return () => (p ??= f()); };

type V3 = [number, number, number];
interface Tri { p: V3[]; n: V3; uv: [number, number][] | null; mat: string }
/** Triangles of a GLB (node transforms applied; derivative frame: front -Z), with unit normals from the winding. */
async function readTris(file: string): Promise<Tri[]> {
  const doc = await new NodeIO().read(file);
  const out: Tri[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const pr of mesh.listPrimitives()) {
      const pos = pr.getAttribute('POSITION')!, uv = pr.getAttribute('TEXCOORD_0'), idx = pr.getIndices()!;
      const W = (i: number): V3 => { const v = pos.getElement(i, [0, 0, 0]); return [M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]]; };
      for (let t = 0; t < idx.getCount(); t += 3) {
        const p = [0, 1, 2].map(k => W(idx.getScalar(t + k))) as V3[];
        const e1 = [0, 1, 2].map(k => p[1][k] - p[0][k]), e2 = [0, 1, 2].map(k => p[2][k] - p[0][k]);
        const c: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(...c) || 1;
        out.push({p, n: c.map(x => x / l) as V3, uv: uv ? [0, 1, 2].map(k => uv.getElement(idx.getScalar(t + k), [0, 0]) as [number, number]) : null, mat: pr.getMaterial()?.getName() ?? ''});
      }
    }
  }
  return out;
}
const AX = [[1, 2], [2, 0], [0, 1]] as const;
const inTri = (P: number[][], x: number, y: number) => { let s = 0; for (let i = 0; i < 3; i++) { const a = P[i], b = P[(i + 1) % 3]; const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (Math.abs(c) < 1e-12) continue; const g = Math.sign(c); if (s && g !== s) return false; s = g; } return true; };
/** Layer census of an axis-plane slab [lo, hi]: 1 cm grid over rect (the two in-plane axes in AX order), triangles within 14 deg of the axis. */
function slabCover(T: Tri[], axis: 0 | 1 | 2, lo: number, hi: number, rect: [number, number, number, number], step = 0.01) {
  const [ia, ib] = AX[axis];
  const S = T.filter(t => Math.abs(t.n[axis]) > 0.97 && t.p.every(q => q[axis] >= lo && q[axis] <= hi)).map(t => ({P: t.p.map(q => [q[ia], q[ib]]), f: Math.sign(t.n[axis])}));
  let samples = 0, covered = 0, multi = 0, plus = 0, minus = 0;
  for (let a = rect[0] + step / 2; a < rect[1]; a += step) for (let b = rect[2] + step / 2; b < rect[3]; b += step) {
    samples++;
    const h = S.filter(s => inTri(s.P, a, b));
    if (h.length) covered++; if (h.length > 1) multi++; if (h.some(s => s.f > 0)) plus++; if (h.some(s => s.f < 0)) minus++;
  }
  return {tris: S.length, samples, covered, multi, plus, minus};
}
/** Highest up-facing surface over (x, z) within [y0, y1] (derivative frame), or null. */
function topAt(T: Tri[], x: number, z: number, y0 = -1, y1 = 9): number | null {
  let best: number | null = null;
  for (const t of T) {
    if (t.n[1] < 0.9 || !inTri(t.p.map(q => [q[0], q[2]]), x, z)) continue;
    const [a, b, c] = t.p, d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-12) continue;
    const w1 = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d, w2 = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
    const y = a[1] + w1 * (b[1] - a[1]) + w2 * (c[1] - a[1]);
    if (y >= y0 && y <= y1 && (best === null || y > best)) best = y;
  }
  return best;
}
const bounds = (T: Tri[]) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const t of T) for (const q of t.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } return {lo, hi}; };
const allowMatches = (url: string) => { const buf = fs.readFileSync(path.join(PUB, url)); expect(ALLOW.get(url), `${url} allowlisted`).toEqual({path: url, bytes: buf.length, sha256: sha(buf)}); return buf; };

// ---------------------------------------------------------------------------------------------------------------------------------
describe('M03 security console (cctvConsole, D31): a 15-screen bank on a supported desk, not on the floor', () => {
  const URL = COMPANY_ASSETS['cctv-console'].url!;
  const load = memo(async () => { const T = await readTris(path.join(PUB, URL)); return {T, base: T.filter(t => /plinth/.test(t.mat)), body: T.filter(t => !/plinth/.test(t.mat))}; });

  it('identity: kind cctvConsole -> asset cctv-console -> office-cctv-console.glb; its cabinet holds 15 screens (the "~20 screens"); the other monitor kinds are different objects', async () => {
    expect(URL).toBe('assets/models/office-cctv-console.glb');
    const {components} = await lib<{components: (d: Document) => {comps: {min: number[]; max: number[]}[]}[]}>('clutter-split.mjs');
    const doc = await new NodeIO().read(path.join(PUB, URL));
    const screens = components(doc).flatMap(pc => pc.comps).filter(c => { const e = c.max.map((x, k) => x - c.min[k]); return e[0] > 0.29 && e[0] < 0.34 && e[1] > 0.17 && e[1] < 0.25 && c.min[1] > 0.85; });
    expect(screens).toHaveLength(15); // 5 x 3 bezels, all above the desk
    expect(HOLDER_LABEL.monitorDesk).toBe('security desk'); // the 3-monitor procedural desk (gen/purposeShapes.ts monitorDesk): not this
    expect(MALL_KIND_ASSET.tvWall).toBe('tv-wall-bank'); // the 6-screen M41 electronics display bank: not this
  });

  it('support: desk top at desk height on a grounded steel base with a knee recess; no part of the console left on the floor', async () => {
    const {T, base, body} = await load();
    const all = bounds(T);
    expect(all.lo[1]).toBeCloseTo(0, 4); // grounded (the base's toe kick)
    expect(all.hi[1]).toBeCloseTo(1.6721, 3);
    expect(base.length).toBe(20); // body 6 faces + toe kick 4 faces
    const b = bounds(base), m = bounds(body);
    expect(b.lo[1]).toBeCloseTo(0, 4);
    expect(b.hi[1]).toBeCloseTo(0.65, 4);
    expect(m.lo[1], 'the slab and everything on it sit on the base top (gap < 1 cm), nothing floats or stays on the floor').toBeGreaterThanOrEqual(0.649);
    expect(m.lo[1]).toBeLessThan(0.66);
    // the base lies inside the slab's footprint (x -0.960..0.965, z +-0.613), recessed ~0.3 m at the operator front (-Z)
    expect(b.lo[0]).toBeGreaterThan(-0.96); expect(b.hi[0]).toBeLessThan(0.965); expect(b.hi[2]).toBeLessThan(0.613);
    expect(b.lo[2] - m.lo[2]).toBeGreaterThan(0.25);
    // desk top: median top surface over the work area in front of the cabinet (x +-0.85, z -0.55..0.05)
    const tops: number[] = [];
    for (let x = -0.85; x <= 0.85; x += 0.1) for (let z = -0.55; z <= 0.05; z += 0.1) { const y = topAt(body, x, z, 0, 1.2); if (y !== null) tops.push(y); }
    tops.sort((p, q) => p - q);
    expect(tops.length).toBeGreaterThan(80);
    expect(tops[tops.length >> 1]).toBeGreaterThan(0.72);
    expect(tops[tops.length >> 1]).toBeLessThan(0.78);
    // under the rear desk the base top supports it (a ray down from the slab meets the base at 0.65)
    for (const [x, z] of [[-0.8, 0.0], [0, 0.4], [0.8, -0.2]]) expect(topAt(base, x, z)).toBeCloseTo(0.65, 3);
  });

  it('collision / interaction / anchoring follow the supported assembly; footprint (layout, nav, placement) unchanged', () => {
    expect(COMPANY_ASSETS['cctv-console'].dims).toEqual([2, 1.6721, 1.2378]);
    // PROP_DEFS (= the AABB collider / bullet box via tryPlaceProp h = def.h) spans the base + monitor bank; w / d as before the fix
    expect(PROP_DEFS.cctvConsole).toMatchObject({w: 2, d: 1.238, h: 1.672, blocksSight: true});
    expect(OPENABLE_AUDIT.find(e => e.kind === 'cctvConsole')).toMatchObject({cls: 'none', role: 'equipment'});
    expect(PROP_PHYSICS_AUDIT.cctvConsole.cls).toBe('static');
  });

  it('local recipe + provenance + allowlist: raw master hash unchanged, consoleBase recorded', () => {
    const o = OFFICE_PROV.outputs.find((q: {id: string}) => q.id === 'cctv-console');
    expect(o.source.sha256).toBe('2b4baf89da8559bb11ba93b7823eb2e4e96fa3567c283e4ae571204fddcf8260');
    expect(o.furniture.edits.consoleBase).toMatchObject({dy: 0.65, tris: 20});
    expect(o.furniture.basis).toMatch(/rule-4 exception/);
    const buf = allowMatches(URL);
    expect(o.output).toMatchObject({sha256: sha(buf), bytes: buf.length, dims: [2, 1.6721, 1.2378]});
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('M04 "cooler" rear: the open multideck (M30) back wall / sheets repaired; the glass-door drinks cooler untouched', () => {
  const URL = MALL_ASSETS['multideck-open-cooler'].url!;
  const load = memo(() => readTris(path.join(PUB, URL)));

  it('identity: both kinds read "cooler"; the glass-door shopCooler file is the reviewed, unchanged one', () => {
    expect(HOLDER_LABEL.multideckOpenCooler).toBe('open cooler');
    expect(HOLDER_LABEL.shopCooler).toBe('drinks cooler');
    expect(MALL_KIND_ASSET.multideckOpenCooler).toBe('multideck-open-cooler');
    const sc = fs.readFileSync(path.join(PUB, 'assets/models/shop-cooler-open-t25r1.glb'));
    expect(sha(sc)).toBe('4e68c571d946cf890c4c4fd320b24bf24ec678d7d67b05d6f6f2d8902226e3f7');
  });

  it('inner back wall: ONE front-facing layer over the whole wall (no holes onto the outer shell, no double sheet)', async () => {
    const T = await load();
    const c = slabCover(T, 2, 0.3365, 0.3445, [-0.918, 0.918, 0.538, 1.866]);
    expect(c.covered).toBe(c.samples);
    expect(c.multi).toBe(0);
    expect(c.plus).toBe(0); // derivative front is -Z: the shopper-facing side
  });

  it('the warped 1.20 m shelf corner is flattened and every deck / shelf / roof level is a single sheet with its coverage kept', async () => {
    const T = await load();
    expect(T.some(t => t.p.some(q => q[0] > 0.02 && q[0] < 0.04 && q[1] > 1.25 && q[1] < 1.32 && q[2] > -0.29 && q[2] < -0.27))).toBe(false);
    // [slab lo, hi, covered samples of the ORIGINAL derivative 1366b95 (same 1 cm census)]
    const levels: [number, number, number][] = [[0.465, 0.482, 13163], [0.72, 0.742, 11255], [0.947, 0.96, 4531], [0.963, 0.98, 11222], [1.185, 1.21, 11262], [1.478, 1.5, 11222], [1.925, 1.945, 16080]];
    for (const [lo, hi, before] of levels) {
      const c = slabCover(T, 1, lo, hi, [-0.48, 0.48, -0.95, 0.95]);
      expect(c.covered, `${lo} coverage`).toBeGreaterThanOrEqual(before);
      // (residual, recorded: at the 0.955 underside level two DOWN-facing pieces still overlap on a 7 mm strip under the right bay's
      // shelf lip, ~0.003 m2 seen only from below — the dedupe keeps one up-facing layer and clips only that facing's layers)
      expect(c.multi, `${lo} stacked layers`).toBeLessThanOrEqual(Math.ceil((lo === 0.947 ? 0.01 : 0.005) * c.covered));
    }
  });

  it('loot decks unchanged: every MALL_SURFACES.multideckOpenCooler surface has its real deck under it (prop frame = half turn)', async () => {
    const T = await load();
    for (const s of MALL_SURFACES.multideckOpenCooler) {
      const y = topAt(T, -(s.x0 + s.x1) / 2, -(s.z0 + s.z1) / 2, s.y - 0.05, s.y + 0.05);
      expect(y, JSON.stringify(s)).not.toBeNull();
      expect(Math.abs(y! - s.y)).toBeLessThan(0.02);
    }
  });

  it('outer back: the painted ghost of the shelves (seen through the old V) is gone — the region matches the plain finish beside it', async () => {
    const T = await load();
    const sharp = (await import('sharp')).default;
    const doc = await new NodeIO().read(path.join(PUB, URL));
    const tex = doc.getRoot().listMaterials()[0].getBaseColorTexture()!;
    const {data, info} = await sharp(Buffer.from(tex.getImage()!)).removeAlpha().raw().toBuffer({resolveWithObject: true});
    const back = T.filter(t => t.n[2] > 0.9 && t.p.every(q => q[2] > 0.455));
    const lum = (x: number, y: number) => {
      for (const f of back) {
        const [a, b, c] = f.p, d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(d) < 1e-12) continue;
        const w1 = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / d, w2 = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / d, w0 = 1 - w1 - w2;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const u = w0 * f.uv![0][0] + w1 * f.uv![1][0] + w2 * f.uv![2][0], v = w0 * f.uv![0][1] + w1 * f.uv![1][1] + w2 * f.uv![2][1];
        const o = (Math.min(info.height - 1, Math.floor(v * info.height)) * info.width + Math.min(info.width - 1, Math.floor(u * info.width))) * 3;
        return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      }
      return null;
    };
    const stats = (pred: (x: number) => boolean) => { const a: number[] = []; for (let y = 0.56; y < 1.85; y += 0.02) for (let x = -0.9; x <= 0.9; x += 0.02) if (pred(x)) { const L = lum(x, y); if (L !== null) a.push(L); } const m = a.reduce((s, q) => s + q, 0) / a.length; return {n: a.length, m, sd: Math.sqrt(a.reduce((s, q) => s + (q - m) ** 2, 0) / a.length)}; };
    const inside = stats(x => Math.abs(x) < 0.38), outside = stats(x => Math.abs(x) > 0.5 && Math.abs(x) < 0.88);
    expect(inside.n).toBeGreaterThan(2000);
    expect(Math.abs(inside.m - outside.m)).toBeLessThan(1); // was 2.3 lower
    expect(inside.sd).toBeLessThan(1.2); // was 3.3 (the ghost shapes); the plain finish is 0.6
  });

  it('local recipe + provenance + allowlist: raw master hash and dims unchanged, edits recorded', () => {
    const o = MALL_PROV.outputs.find((q: {id: string}) => q.id === 'multideck-open-cooler');
    expect(o.source.sha256).toBe('002c6161fb1572b05195a8ed9ba5011301047ed74741477bb6cde0c94390ded0');
    expect(o.edits.panelRebuild[0]).toMatchObject({removed: {tris: 56}, added: 2});
    expect(o.edits.snapped[0].verts).toBeGreaterThan(0);
    expect(o.edits.coplanarDedupe).toHaveLength(7);
    expect(o.edits.panelGhosts[0]).toMatchObject({all: true, clone: {along: 0, by: 0.45}});
    expect(o.output.dims).toEqual([...MALL_DIMS['multideck-open-cooler']]);
    expect(MALL_DIMS['multideck-open-cooler']).toEqual([1.9, 1.9777, 0.9505]);
    const buf = allowMatches(URL);
    expect(o.output).toMatchObject({sha256: sha(buf), bytes: buf.length, triangles: MALL_ASSETS['multideck-open-cooler'].tris});
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('M07 shelving bay (wallBay, M04 retail-wall-bay): one layer on the slatwall back panel, decks / scale unchanged', () => {
  const URL = MALL_ASSETS['retail-wall-bay'].url!;
  const load = memo(() => readTris(path.join(PUB, URL)));

  it('identity: label "shelving bay" -> wallBay -> retail-wall-bay', () => {
    expect(HOLDER_LABEL.wallBay).toBe('shelving bay');
    expect(MALL_KIND_ASSET.wallBay).toBe('retail-wall-bay');
  });

  it('the slatwall plane (z +0.2357) carries exactly one shopper-facing layer (was a hidden +Z layer + a 3-5 layer diagonal band)', async () => {
    const T = await load();
    const c = slabCover(T, 2, 0.2337, 0.2377, [-0.6, 0.6, 0, 2.2]);
    expect(c.multi).toBe(0);
    expect(c.plus).toBe(0);
    expect(c.covered / c.samples).toBeGreaterThan(0.995); // the same coverage as before (52 / 26400 open samples are the upright slots)
  });

  it('decks unchanged under every MALL_SURFACES.wallBay surface; dims = MALL_DIMS; provenance / allowlist', async () => {
    const T = await load();
    for (const s of MALL_SURFACES.wallBay) {
      const y = topAt(T, -(s.x0 + s.x1) / 2, -(s.z0 + s.z1) / 2, s.y - 0.05, s.y + 0.05);
      expect(y, JSON.stringify(s)).not.toBeNull();
      expect(Math.abs(y! - s.y)).toBeLessThan(0.02);
    }
    const o = MALL_PROV.outputs.find((q: {id: string}) => q.id === 'retail-wall-bay');
    expect(o.source.sha256).toBe('5927ee762831b61363b3efb1dca0abe8e301c22134b914aa5c2170f50a759d79');
    expect(o.edits.coplanarDedupe[0].overlapRemovedM2).toBeGreaterThan(1);
    expect(o.output.dims).toEqual([1.2, 2.1998, 0.5002]);
    expect(MALL_DIMS['retail-wall-bay']).toEqual([1.2, 2.1998, 0.5002]);
    const buf = allowMatches(URL);
    expect(o.output).toMatchObject({sha256: sha(buf), bytes: buf.length});
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('M07 follow-up: the free-standing gondola ("gondola shelf", M03 retail-gondola) — stacked layers removed, visible faces / decks unchanged', () => {
  const URL = MALL_ASSETS['retail-gondola'].url!;
  const load = memo(() => readTris(path.join(PUB, URL)));

  it('identity: retailGondola -> retail-gondola', () => {
    expect(HOLDER_LABEL.retailGondola).toBe('gondola shelf');
    expect(MALL_KIND_ASSET.retailGondola).toBe('retail-gondola');
  });

  it('shelf front lips, the upright front and the internal shelf sheets carry one layer each, coverage kept (1 cm census of 1366b95)', async () => {
    const T = await load();
    const lip = slabCover(T, 2, -0.1325, -0.1277, [-0.98, 0.98, 0, 1.41]);
    expect(lip).toMatchObject({covered: 2053, multi: 0}); // was 129 stacked samples
    const upright = slabCover(T, 2, -0.0875, -0.0839, [-0.98, -0.93, 0, 1.41]);
    expect(upright).toMatchObject({covered: 278, multi: 0}); // was 91
    // the internal sheets inside the ~3 cm shelf slabs (hidden; were 1,696-6,794 stacked samples each)
    for (const [lo, hi, before] of [[0.597, 0.6005, 6798], [0.7765, 0.7805, 6792], [0.7905, 0.795, 6794], [0.9505, 0.956, 6798], [1.1565, 1.1625, 6807]] as const) {
      const c = slabCover(T, 1, lo, hi, [-0.14, 0.245, -0.98, 0.98]);
      expect(c.covered, `${lo}`).toBe(before);
      expect(c.multi, `${lo}`).toBeLessThanOrEqual(2);
    }
  });

  it('decks under every MALL_SURFACES.retailGondola surface; dims / raw / provenance / allowlist', async () => {
    const T = await load();
    for (const s of MALL_SURFACES.retailGondola) for (const x of [-0.45, 0.45]) { // both shelf halves (x 0 is the centre divider seam)
      const y = topAt(T, x, -(s.z0 + s.z1) / 2, s.y - 0.05, s.y + 0.05);
      expect(y, `${x} ${JSON.stringify(s)}`).not.toBeNull();
      expect(Math.abs(y! - s.y)).toBeLessThan(0.02);
    }
    const o = MALL_PROV.outputs.find((q: {id: string}) => q.id === 'retail-gondola');
    expect(o.source.sha256).toBe('76b541bbc177f3b94b5304355ba7fee74e046663f8def04633271d4021638f21');
    expect(o.edits.coplanarDedupe).toHaveLength(7);
    expect(o.textureStep).toBe(0); // the repair stays inside the byte budget: textures not stepped down
    expect(o.output.dims).toEqual([1.9496, 1.4, 0.4926]);
    expect(MALL_DIMS['retail-gondola']).toEqual([1.9496, 1.4, 0.4926]);
    const buf = allowMatches(URL);
    expect(o.output).toMatchObject({sha256: sha(buf), bytes: buf.length, triangles: MALL_ASSETS['retail-gondola'].tris});
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('local repair helpers (synthetic geometry)', () => {
  type Dedupe = {dedupeCoplanar: (d: Document, o: Record<string, unknown>) => {oppositeDropped: number; oppositeClipped?: number}};
  /** One primitive of quads [x0, x1, y0, y1, z, facing(+1 / -1 along Z)], with normals + UVs. */
  const quads = (list: number[][]) => {
    const doc = new Document(); const buf = doc.createBuffer();
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    for (const [x0, x1, y0, y1, z, f] of list) {
      const o = P.length / 3;
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { P.push(x, y, z); N.push(0, 0, f); U.push(x * 0.1, y * 0.1); }
      I.push(...(f > 0 ? [o, o + 1, o + 2, o, o + 2, o + 3] : [o, o + 2, o + 1, o, o + 3, o + 2]));
    }
    const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(P)).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(N)).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(U)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(I)).setBuffer(buf));
    doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
    return doc;
  };
  const areaFacing = (doc: Document, f: number) => {
    let a = 0;
    for (const pr of doc.getRoot().listMeshes()[0].listPrimitives()) {
      const pos = pr.getAttribute('POSITION')!, idx = pr.getIndices()!;
      for (let t = 0; t < idx.getCount(); t += 3) {
        const p = [0, 1, 2].map(k => pos.getElement(idx.getScalar(t + k), [0, 0, 0]));
        const nz = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
        if (Math.sign(nz) === f) a += Math.abs(nz) / 2;
      }
    }
    return a;
  };

  it('dedupeCoplanar: clipOpposite keeps the uncovered part of an opposite layer (default drops it whole); slab bounds the plane', async () => {
    const {dedupeCoplanar} = await lib<Dedupe>('coplanar-dedupe.mjs');
    const box = {min: [-1, -1, -0.01], max: [2, 2, 0.01]};
    // front -Z layer over x 0..1, an opposite +Z layer over x 0.5..1.5 in the same plane
    const a = quads([[0, 1, 0, 1, 0, -1], [0.5, 1.5, 0, 1, 0, 1]]);
    dedupeCoplanar(a, {box, axis: 2, facing: -1, tol: 0.001});
    expect(areaFacing(a, 1)).toBeCloseTo(0, 6); // default: the whole opposite quad went (x 1..1.5 opened)
    const b = quads([[0, 1, 0, 1, 0, -1], [0.5, 1.5, 0, 1, 0, 1]]);
    const r = dedupeCoplanar(b, {box, axis: 2, facing: -1, tol: 0.001, clipOpposite: true});
    expect(r.oppositeClipped).toBe(2);
    expect(areaFacing(b, 1)).toBeCloseTo(0.5, 5); // x 1..1.5 kept, facing +Z
    expect(areaFacing(b, -1)).toBeCloseTo(1, 5);
    // a second sheet 4 mm away is outside the strict slab even with a 1 cm plane tolerance
    const c = quads([[0, 1, 0, 1, 0, -1], [0, 1, 0, 1, 0.004, 1]]);
    dedupeCoplanar(c, {box, axis: 2, facing: -1, tol: 0.01, slab: [-0.001, 0.001], clipOpposite: true});
    expect(areaFacing(c, 1)).toBeCloseTo(1, 5);
  });

  it('rebuildPanel closes a holed double sheet with one clean quad (non-degenerate UVs); addConsoleBase lifts a model onto a closed base', async () => {
    const {rebuildPanel} = await lib<{rebuildPanel: (d: Document, o: Record<string, unknown>) => {removed: {tris: number}; added: number}}>('panel-repair.mjs');
    // a wall with a hole (two -Z strips + their +Z twins), rebuilt over x 0..1, y 0..1
    const d = quads([[0, 0.4, 0, 1, 0.3, -1], [0.6, 1, 0, 1, 0.3, -1], [0, 0.4, 0, 1, 0.3, 1], [0.6, 1, 0, 1, 0.3, 1]]);
    const r = rebuildPanel(d, {axis: 2, at: 0.3, tol: 0.002, facing: -1, rect: [0, 1, 0, 1], uv: {centre: [0.5, 0.5], perMetre: 0.01}});
    expect(r).toMatchObject({removed: {tris: 8}, added: 2});
    expect(areaFacing(d, -1)).toBeCloseTo(1, 6);
    expect(areaFacing(d, 1)).toBeCloseTo(0, 6);
    const uv = d.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('TEXCOORD_0')!;
    const us = Array.from({length: uv.getCount()}, (_, i) => uv.getElement(i, [0, 0])[0]);
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.005); // a real (tiny) UV chart, not a constant
    const {addConsoleBase} = await lib<{addConsoleBase: (d: Document, o: Record<string, unknown>) => {tris: number; frontOverhang: number}}>('console-base.mjs');
    // a 'slab' (its front / back faces, x +-1, y 0..0.1, z +-0.5) lifted 0.6 m onto a base recessed 0.3 m at the front
    const m = quads([[-1, 1, 0, 0.1, -0.5, -1], [-1, 1, 0, 0.1, 0.5, 1]]);
    const rec = addConsoleBase(m, {dy: 0.6, rect: {x: [-0.95, 0.95], z: [-0.2, 0.45]}, kick: {h: 0.08, inset: 0.05}});
    expect(rec.tris).toBe(20);
    expect(rec.frontOverhang).toBeCloseTo(0.3, 6);
    let lo = Infinity, slabLo = Infinity;
    for (const node of m.getRoot().listNodes()) { const pr = node.getMesh()?.listPrimitives()[0]; if (!pr) continue; const pos = pr.getAttribute('POSITION')!;
      for (let i = 0; i < pos.getCount(); i++) { const y = pos.getElement(i, [0, 0, 0])[1]; lo = Math.min(lo, y); if (node.getName() !== 'plinth') slabLo = Math.min(slabLo, y); } }
    expect(lo).toBe(0);
    expect(slabLo).toBeCloseTo(0.6, 6);
    expect(() => addConsoleBase(quads([[-1, 1, 0, 0.1, -0.5, -1], [-1, 1, 0, 0.1, 0.5, 1]]), {dy: 0.6, rect: {x: [-1.2, 0.9], z: [-0.2, 0.45]}})).toThrow();
  }, 30_000);
});
