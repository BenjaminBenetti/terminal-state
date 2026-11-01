// Task mall-round3-20261031 (Studio Beta, lane FIX): focused tests for the two reported z-fighting defects.
//  - R1 "z-fighting appears on escalators where they connect slopped walls under them": on the real generated mall, around every
//    escalator of the scissor stack, no two drawn surfaces share a plane any more —
//      the soffit sides stand SOFFIT_INSET inside the flight's edge lines (they stood ON them, in the level geometry's sloped wall),
//      the mall escalator's outer cladding starts at the pitch line, outward face only (traversalBuilder buildEscalator, mall only),
//      glass balustrades are not drawn where they stood in an escalator's cladding / a wall plane or floated (MallArch.railPieces),
//      a lower open-well band no longer re-draws the faces of the band over it (levelGeometry extractWallFaces, OVERLAP_STATS);
//    the Subway / Office never take the new paths (no overlapping bands; the Office transit escalators keep their old geometry).
//  - R3 "bakery glass display cases have heavy z fighting issues with them selfs, internal mesh z-fight": bakeryCase (D38
//    office-bakery-case.glb) — both display shelves, their front lips and the band over the inner pane were coplanar / crossing double
//    sheets in the double-sided body material; one layer each now (tools/asset-pipeline/props/build-office-overhaul.mjs dedupe).
// Repo files only (raw masters stay outside Git): this runs in CI.
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {NodeIO} from '@gltf-transform/core';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {SOFFIT_INSET, mallEscalatorFlights} from '../src/world/mallArch';
import {escalatorExtent} from '../src/world/traversalBuilder';
import {OVERLAP_STATS} from '../src/world/levelGeometry';
import {CELL, rampHeight, type Ramp} from '../src/gen/grid';
import {generateStation, type StationLayout} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {COMPANY_ASSETS} from '../src/assets/companyAssets';
import {BAKERY_LEVELS, openableSpec} from '../src/world/openablesSpec';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

type V3 = [number, number, number];
interface Tri { p: V3[]; n: V3; area: number; mesh: string; transparent: boolean; ds: boolean }

/** World triangles of the non-instanced meshes under `root` with any vertex inside `inBox`. */
function worldTris(root: THREE.Object3D, inBox: (p: V3) => boolean): Tri[] {
  const out: Tri[] = [];
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const g = m.geometry as THREE.BufferGeometry, pos = g.getAttribute('position');
    if (!pos) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    const idx = g.index, n = idx ? idx.count : pos.count;
    const W = (i: number): V3 => { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); return [v.x, v.y, v.z]; };
    for (let t = 0; t < n; t += 3) {
      const p = [0, 1, 2].map(k => W(idx ? idx.getX(t + k) : t + k));
      if (!p.some(inBox)) continue;
      const e1 = [0, 1, 2].map(k => p[1][k] - p[0][k]), e2 = [0, 1, 2].map(k => p[2][k] - p[0][k]);
      const c: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...c);
      if (l < 1e-9) continue;
      out.push({p, n: c.map(x => x / l) as V3, area: l / 2, mesh: m.name, transparent: !!mat.transparent, ds: mat.side === THREE.DoubleSide});
    }
  });
  return out;
}

const area2 = (P: number[][]) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function clip(P: number[][], C: number[][]): number[][] {
  let out = P;
  for (let i = 0; i < C.length && out.length; i++) {
    const a = C[i], b = C[(i + 1) % C.length], inp = out; out = [];
    const side = (p: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out;
}
const ccw = (T: number[][]) => (area2(T) >= 0 ? T : [T[0], T[2], T[1]]);

/** Coplanar overlapping triangle pairs (normals within angTol, every vertex within dTol of the plane), overlap area in m2. */
function coplanarPairs<T extends {p: V3[]; n: V3}>(tris: readonly T[], dTol: number, angTol = 0.0087): {a: T; b: T; ov: number; opp: boolean}[] {
  const keyed = tris.map(r => {
    const ax = [0, 1, 2].reduce((m, k) => (Math.abs(r.n[k]) > Math.abs(r.n[m]) ? k : m), 0);
    const s = Math.sign(r.n[ax]) || 1, cn = r.n.map(x => x * s) as V3;
    return {r, cn, s, ax, d: cn[0] * r.p[0][0] + cn[1] * r.p[0][1] + cn[2] * r.p[0][2]};
  });
  const buckets = new Map<string, typeof keyed>();
  for (const k of keyed) { const key = k.cn.map(x => Math.round(x / 0.02)).join(','); (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(k); }
  const res: {a: T; b: T; ov: number; opp: boolean}[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = i + 1; j < list.length && list[j].d - A.d <= dTol; j++) {
        const B = list[j];
        if (A.cn[0] * B.cn[0] + A.cn[1] * B.cn[1] + A.cn[2] * B.cn[2] < Math.cos(angTol)) continue;
        if (B.r.p.some(p => Math.abs(A.cn[0] * p[0] + A.cn[1] * p[1] + A.cn[2] * p[2] - A.d) > dTol)) continue;
        const [ia, ib] = [[1, 2], [2, 0], [0, 1]][A.ax];
        const inter = clip(ccw(A.r.p.map(p => [p[ia], p[ib]])), ccw(B.r.p.map(p => [p[ia], p[ib]])));
        const ov = inter.length >= 3 ? Math.abs(area2(inter)) / Math.abs(A.cn[A.ax]) : 0;
        if (ov >= 1e-6) res.push({a: A.r, b: B.r, ov, opp: A.s !== B.s});
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// R1: the escalator stack of the real generated mall

let real: {layout: StationLayout; w: BuiltWorld; subtracted: number} | null = null;
const getMall = async () => {
  if (!real) {
    const {generateMallLevel} = await import('../src/gen/mall/index');
    const layout = generateMallLevel({levelSeed: 12345, startWeapon: 'rifle'} as never) as StationLayout;
    OVERLAP_STATS.subtracted = 0;
    const w = buildWorld(layout, mats(), {});
    real = {layout, w, subtracted: OVERLAP_STATS.subtracted};
  }
  return real;
};
const flightsOf = (layout: StationLayout) => mallEscalatorFlights(layout).map(f => ({...f, r: layout.grid.ramps[f.flight.ramp] as Ramp}));
const boxOf = (r: Ramp) => ({x0: r.x * CELL - 0.6, x1: (r.x + r.w) * CELL + 0.6, z0: r.y * CELL - 0.6, z1: (r.y + r.h) * CELL + 0.6, y0: Math.min(r.h0, r.h1) - 1.5, y1: Math.max(r.h0, r.h1) + 1.5});
const inside = (b: ReturnType<typeof boxOf>) => (p: V3) => p[0] >= b.x0 && p[0] <= b.x1 && p[2] >= b.z0 && p[2] <= b.z1 && p[1] >= b.y0 && p[1] <= b.y1;
/** A mesh's family: the chunk key stripped (balustrade chunks of one material meet at their corners). */
const family = (m: string) => m.replace(/-\d+:[\d-]+,[\d-]+$/, '');

describe('R1 escalators meet the sloped walls under them without coplanar surfaces (real generated mall)', () => {
  it('around every escalator: no drawn surface shares a plane with another (was 24-43 m2 per flight)', async () => {
    const {layout, w} = await getMall();
    const flights = flightsOf(layout);
    expect(flights.length).toBe(3);
    for (const {r, lower, upper} of flights) {
      const T = worldTris(w.group, inside(boxOf(r)));
      // fightable: opposite faces of single-sided materials never draw together; two transparent (no depth write) never depth-fight;
      // the wall-treatment overlays (wall-detail-*) are another system; one family's own joints (a beam's segments, a rail's corner)
      // share its material — except the architecture, whose duplicated faces carried different texture bases
      const pairs = coplanarPairs(T, 0.001).filter(p => !(p.opp && !p.a.ds && !p.b.ds) && !(p.a.transparent && p.b.transparent)
        && !/^wall-detail/.test(p.a.mesh) && !/^wall-detail/.test(p.b.mesh) && !(family(p.a.mesh) === family(p.b.mesh) && !/^mall-arch/.test(p.a.mesh)));
      const m2 = pairs.reduce((s, p) => s + p.ov, 0);
      const worst = pairs.sort((a, b) => b.ov - a.ov).slice(0, 3).map(p => `${p.a.mesh} ~ ${p.b.mesh} ${p.ov.toFixed(4)}`);
      expect(m2, `escalator ${lower}->${upper}: ${worst.join('; ')}`).toBeLessThan(0.01);
    }
  });

  it('soffit sides stand SOFFIT_INSET inside the flight edge lines (the level geometry draws the wall ON the line)', async () => {
    const {layout, w} = await getMall();
    const soffit = w.group.getObjectByName('mall-escalator-soffits') as THREE.Mesh;
    expect(soffit).toBeTruthy();
    const T = worldTris(soffit, () => true);
    const sides = T.filter(t => Math.abs(t.n[2]) > 0.99);
    expect(sides.length).toBeGreaterThanOrEqual(12);
    const lines = flightsOf(layout).flatMap(f => [f.flight.a0 + SOFFIT_INSET, f.flight.a1 - SOFFIT_INSET]);
    const edges = flightsOf(layout).flatMap(f => [f.flight.a0, f.flight.a1]);
    for (const t of sides) {
      expect(lines.some(a => t.p.every(p => Math.abs(p[2] - a) < 1e-4))).toBe(true);
      expect(edges.some(a => t.p.every(p => Math.abs(p[2] - a) < 1e-3))).toBe(false);
    }
  });

  it('the mall escalator cladding: outward face only, from the pitch line up (no strip in the sloped wall below it)', async () => {
    const {layout, w} = await getMall();
    for (const {r, flight, lower, upper} of flightsOf(layout)) {
      const mesh = w.group.getObjectByName(`mall-escalators-${lower}-${upper}-stainless`) as THREE.Mesh;
      const T = worldTris(mesh, () => true);
      for (const [a, out] of [[flight.a0, -1], [flight.a1, 1]] as const) {
        const clad = T.filter(t => t.p.every(p => Math.abs(p[2] - a) < 1e-5) && Math.abs(t.n[2]) > 0.99);
        expect(clad.length, `cladding on ${a}`).toBeGreaterThan(0);
        for (const t of clad) {
          expect(Math.sign(t.n[2]), 'faces away from the steps').toBe(out);
          for (const p of t.p) expect(p[1]).toBeGreaterThanOrEqual(rampHeight(r, p[0]) - 1e-4);
        }
      }
    }
  });

  it('balustrade glass: never in an escalator cladding plane at its height; the trimmed metres are accounted', async () => {
    const {layout, w} = await getMall();
    const st = w.mallArch!.stats;
    expect(st.balustradeTrimmedM).toBeGreaterThan(20); // the buried / floating scissor-lane guards (~10 m each) + the escalator tops
    expect(st.balustradeTrimmedRuns).toBeGreaterThan(4);
    const owned = w.rails.filter(q => w.mallArch!.ownsRail(q) && !(q as {hidden?: boolean}).hidden);
    expect(st.balustradeM + st.balustradeTrimmedM).toBeLessThanOrEqual(owned.reduce((s, q) => s + Math.hypot(q.x1 - q.x0, q.z1 - q.z0), 0) + 1e-6);
    const glass: Tri[] = [];
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.name.startsWith('mall-balustrade-glass')) glass.push(...worldTris(o, () => true)); });
    for (const {r, flight} of flightsOf(layout)) {
      const {sTop, sBot} = escalatorExtent(r);
      const lo = Math.min(sTop, sBot) - 0.4, hi = Math.max(sTop, sBot) + 0.4;
      for (const a of [flight.a0, flight.a1]) {
        for (const t of glass) {
          if (!t.p.every(p => Math.abs(p[2] - a) < 0.02)) continue;
          const xs = t.p.map(p => p[0]), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          if (cx < lo || cx > hi) continue;
          const foot = Math.min(...t.p.map(p => p[1])) - 0.1, ph = rampHeight(r, cx);
          expect(ph <= foot - 0.25 + 0.06 || ph >= foot + 1.3 - 0.06, `glass on ${a} at x ${cx.toFixed(2)}: foot ${foot.toFixed(2)} pitch ${ph.toFixed(2)}`).toBe(true);
        }
      }
    }
  });

  it('level geometry: the open wells\' overlapping bands are subtracted in the mall, never in the Subway / Office', async () => {
    const {subtracted} = await getMall();
    expect(subtracted).toBeGreaterThan(0);
    for (const layout of [generateStation(24839), generateOfficeLevel({levelSeed: 777, startWeapon: 'pistol'} as never) as StationLayout]) {
      OVERLAP_STATS.subtracted = 0;
      const w = buildWorld(layout, mats(), {});
      expect(OVERLAP_STATS.subtracted).toBe(0);
      // the Office transit escalators keep their old geometry (both cladding faces, from 5 cm under the pitch)
      const transit = w.group.getObjectByName('transit-stainless');
      if (transit) {
        const t = (layout as {office?: {transit?: {escalators: {flights: number[]}[]}}}).office!.transit!.escalators[0];
        const q = layout.traversal.stairs[t.flights[0]], r = layout.grid.ramps[q.ramp];
        const T = worldTris(transit, () => true).filter(x => x.p.every(p => Math.abs(p[0] - q.a0) < 1e-5) && Math.abs(x.n[0]) > 0.99);
        expect(new Set(T.map(x => Math.sign(x.n[0]))).size).toBe(2);
        expect(T.some(x => x.p.some(p => p[1] < rampHeight(r, p[2]) - 0.04))).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// R3: the bakery display case (D38)

const REPO = path.resolve(__dirname, '../..');
const GLB = path.join(REPO, 'game/public/assets/models/office-bakery-case.glb');
async function glbTris(file: string): Promise<{p: V3[]; n: V3; area: number; node: string}[]> {
  const doc = await new NodeIO().read(file);
  const out: {p: V3[]; n: V3; area: number; node: string}[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    for (const pr of mesh.listPrimitives()) {
      const pos = pr.getAttribute('POSITION')!, idx = pr.getIndices()!;
      for (let t = 0; t < idx.getCount(); t += 3) {
        const p = [0, 1, 2].map(k => pos.getElement(idx.getScalar(t + k), [0, 0, 0]) as V3);
        const e1 = [0, 1, 2].map(k => p[1][k] - p[0][k]), e2 = [0, 1, 2].map(k => p[2][k] - p[0][k]);
        const c: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(...c);
        if (l > 1e-12) out.push({p, n: c.map(x => x / l) as V3, area: l / 2, node: node.getName()});
      }
    }
  }
  return out;
}

describe('R3 the bakery display case has one layer per shelf / lip / band (D38 office-bakery-case.glb)', () => {
  it('identity: the bakery recipe\'s case kind -> D38; registry, allowlist and provenance match the file', () => {
    expect(openableSpec('bakeryCase')?.model).toBe('office-bakery-case');
    const buf = fs.readFileSync(GLB), e = COMPANY_ASSETS['bakery-case'];
    expect(e.url).toBe('assets/models/office-bakery-case.glb');
    expect(e.bytes).toBe(buf.length);
    const allow = (JSON.parse(fs.readFileSync(path.join(REPO, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files.find(f => f.path === e.url)!;
    expect(allow.sha256).toBe(crypto.createHash('sha256').update(buf).digest('hex'));
    const prov = JSON.parse(fs.readFileSync(path.join(REPO, 'game/public/assets/derivatives/office-overhaul-20261030.json'), 'utf8'));
    const out = prov.outputs.find((o: {id: string}) => o.id === 'bakery-case');
    expect(out.output.sha256).toBe(allow.sha256);
    expect(out.output.triangles).toBe(e.tris);
    expect(out.output.dims).toEqual([1.9453, 1.35, 1.3841]); // unchanged: no scale-check due
    const dd = out.furniture.edits.coplanarDedupe as {overlapRemovedM2: number}[];
    expect(dd.length).toBe(5);
    expect(dd.reduce((s, q) => s + q.overlapRemovedM2, 0)).toBeGreaterThan(2.7);
    expect(BAKERY_LEVELS.map(y => +y.toFixed(3))).toEqual([0.584, 0.824, 1.041]); // tray / loot decks unchanged
  });

  it('shelves: up-facing layer only over the full 1.5 x 0.82 m; lips / band: the customer-facing layer only; overlap 2.48 -> < 0.03 m2', async () => {
    const T = (await glbTris(GLB)).filter(t => t.node !== 'glass');
    const inB = (t: {p: V3[]}, x: number, y0: number, y1: number, z0: number, z1: number) => t.p.every(p => Math.abs(p[0]) <= x && p[1] >= y0 && p[1] <= y1 && p[2] >= z0 && p[2] <= z1);
    for (const [y0, y1] of [[1.030, 1.0425], [0.819, 0.8255]]) {
      const S = T.filter(t => inB(t, 0.765, y0, y1, -0.25, 0.585) && Math.abs(t.n[1]) > 0.99);
      expect(S.filter(t => t.n[1] < 0).length, `shelf ${y0}: no down-facing sheet`).toBe(0);
      expect(S.reduce((s, t) => s + t.area, 0), `shelf ${y0}: coverage`).toBeGreaterThan(1.228);
    }
    for (const [y0, y1] of [[0.735, 0.829], [0.950, 1.0415]]) {
      const S = T.filter(t => inB(t, 0.785, y0, y1, -0.2145, -0.2085) && Math.abs(t.n[2]) > 0.99);
      expect(S.length).toBeGreaterThan(0);
      expect(S.every(t => t.n[2] < 0), `lip ${y0}: customer-facing (-Z native) only`).toBe(true);
    }
    const pairs = coplanarPairs(T, 0.002);
    expect(pairs.reduce((s, p) => s + p.ov, 0)).toBeLessThan(0.03);
  });
});
