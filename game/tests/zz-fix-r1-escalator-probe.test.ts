// SCRATCH (lane FIX, mall-round3 R1) — DELETE before finishing. Coplanar overlaps around the mall escalators in the built world.
import * as THREE from 'three';
import fs from 'node:fs';
import {describe, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {mallEscalatorFlights} from '../src/world/mallArch';
import {CELL} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/station';

installCanvasShim(false);
const LOG = '/tmp/fix-r1-probe.log';
const log = (s: string) => fs.appendFileSync(LOG, s + '\n');

type V3 = [number, number, number];
interface T { p: V3[]; n: V3; area: number; mesh: string; transparent: boolean; ds: boolean }

function tris(root: THREE.Object3D, inBox: (p: V3) => boolean): T[] {
  const out: T[] = [];
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const g = m.geometry as THREE.BufferGeometry, pos = g.getAttribute('position');
    if (!pos) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const v = new THREE.Vector3();
    const W = (i: number): V3 => { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); return [v.x, v.y, v.z]; };
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      const p = [W(a), W(b), W(c)];
      if (!p.some(inBox)) continue;
      const e1 = [0, 1, 2].map(k => p[1][k] - p[0][k]), e2 = [0, 1, 2].map(k => p[2][k] - p[0][k]);
      const cr: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...cr);
      if (l < 1e-9) continue;
      out.push({p, n: cr.map(x => x / l) as V3, area: l / 2, mesh: m.name || '(unnamed)', transparent: !!mat.transparent, ds: mat.side === THREE.DoubleSide});
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

function overlaps(T: T[], dTol: number, angTol = 0.0087) {
  const keyed = T.map(r => {
    const ax = [0, 1, 2].reduce((m, k) => (Math.abs(r.n[k]) > Math.abs(r.n[m]) ? k : m), 0);
    const s = Math.sign(r.n[ax]) || 1;
    const cn = r.n.map(x => x * s) as V3;
    return {r, cn, s, ax, d: cn[0] * r.p[0][0] + cn[1] * r.p[0][1] + cn[2] * r.p[0][2]};
  });
  const buckets = new Map<string, typeof keyed>();
  const q = (x: number) => Math.round(x / 0.02);
  for (const k of keyed) { const key = `${q(k.cn[0])},${q(k.cn[1])},${q(k.cn[2])}`; (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(k); }
  const res: {a: T; b: T; ov: number; opp: boolean; n: V3; d: number}[] = [];
  const cosTol = Math.cos(angTol);
  for (const list of buckets.values()) {
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < list.length; i++) {
      const A = list[i];
      for (let j = i + 1; j < list.length && list[j].d - A.d <= dTol; j++) {
        const B = list[j];
        if (A.cn[0] * B.cn[0] + A.cn[1] * B.cn[1] + A.cn[2] * B.cn[2] < cosTol) continue;
        if (B.r.p.some(p => Math.abs(A.cn[0] * p[0] + A.cn[1] * p[1] + A.cn[2] * p[2] - A.d) > dTol)) continue;
        const [ia, ib] = [[1, 2], [2, 0], [0, 1]][A.ax];
        const pa = ccw(A.r.p.map(p => [p[ia], p[ib]])), pb = ccw(B.r.p.map(p => [p[ia], p[ib]]));
        const inter = clip(pa, pb);
        const ov = inter.length >= 3 ? Math.abs(area2(inter)) / Math.abs(A.cn[A.ax]) : 0;
        if (ov < 1e-6) continue;
        res.push({a: A.r, b: B.r, ov, opp: A.s !== B.s, n: A.cn, d: A.d});
      }
    }
  }
  return res;
}

describe('zz R1 probe', () => {
  it('escalator junction overlaps', async () => {
    fs.writeFileSync(LOG, '');
    const {generateMallLevel} = await import('../src/gen/mall/index');
    for (const seed of [12345]) {
      const layout = generateMallLevel({levelSeed: seed, startWeapon: 'rifle'} as never) as StationLayout;
      const w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
      const flights = mallEscalatorFlights(layout);
      log(`seed ${seed}: ${flights.length} escalator flights`);
      for (const f of (w as unknown as {wallFaces: {level: number; area: number; x0: number; z0: number; x1: number; z1: number; nx: number; nz: number; y0: number; y1: number; finish: string; slope?: {b0: number; b1: number; t0: number; t1: number}}[]}).wallFaces) {
        if (!(f.z0 === f.z1 && [23, 24.5, 26, 23.5, 25, 26.5].includes(f.z0) && Math.max(f.x0, f.x1) > 48 && Math.min(f.x0, f.x1) < 60.5)) continue;
        log(`   face L${f.level} a${f.area} z ${f.z0} x ${f.x0}..${f.x1} n ${f.nx},${f.nz} y ${f.y0.toFixed(2)}..${f.y1.toFixed(2)} ${f.finish}${f.slope ? ` slope b ${f.slope.b0.toFixed(2)}->${f.slope.b1.toFixed(2)} t ${f.slope.t0.toFixed(2)}->${f.slope.t1.toFixed(2)}` : ''}`);
      }
      const {levelsOf} = await import('../src/gen/levels');
      const rails = levelsOf(layout as never).rails as unknown as {level: number; x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; nx: number; nz: number; kind?: string; hidden?: boolean}[];
      for (const {flight} of flights) {
        const r = layout.grid.ramps[flight.ramp];
        const X0 = r.x * CELL - 1, X1 = (r.x + r.w) * CELL + 1, Z0 = r.y * CELL - 1, Z1 = (r.y + r.h) * CELL + 1;
        for (const q of rails) if (Math.max(q.x0, q.x1) >= X0 && Math.min(q.x0, q.x1) <= X1 && Math.max(q.z0, q.z1) >= Z0 && Math.min(q.z0, q.z1) <= Z1)
          log(`   rail near ramp ${flight.ramp}: L${q.level} ${q.kind ?? ''}${q.hidden ? ' hidden' : ''} (${q.x0},${q.y0.toFixed(2)},${q.z0}) -> (${q.x1},${q.y1.toFixed(2)},${q.z1}) n ${q.nx},${q.nz}`);
      }
      for (const {flight, lower, upper} of flights) {
        const r = layout.grid.ramps[flight.ramp];
        const x0 = r.x * CELL - 0.6, x1 = (r.x + r.w) * CELL + 0.6, z0 = r.y * CELL - 0.6, z1 = (r.y + r.h) * CELL + 0.6;
        const ylo = Math.min(r.h0, r.h1) - 1.5, yhi = Math.max(r.h0, r.h1) + 1.5;
        const inBox = (p: V3) => p[0] >= x0 && p[0] <= x1 && p[2] >= z0 && p[2] <= z1 && p[1] >= ylo && p[1] <= yhi;
        const T = tris(w.group, inBox);
        log(`  flight ramp ${flight.ramp} ${lower}->${upper} axis ${r.axis} rect x ${r.x}..${r.x + r.w} y ${r.y}..${r.y + r.h} s ${r.s0.toFixed(2)}->${r.s1.toFixed(2)} h ${r.h0}->${r.h1} a ${flight.a0}..${flight.a1} tris ${T.length}`);
        for (const dTol of [0.001]) {
          // can they fight? opposite faces of single-sided materials never draw together; two transparent (no depth write) never depth-fight
          const ps = overlaps(T, dTol).filter(p => !(p.opp && !p.a.ds && !p.b.ds) && !(p.a.transparent && p.b.transparent));
          const by = new Map<string, {n: number; m2: number; bb: number[]}>();
          for (const p of ps) {
            const tag = (t: T) => `${t.mesh}${t.transparent ? '[T]' : ''}${t.ds ? '[2S]' : ''}`;
            const names = [tag(p.a), tag(p.b)].sort();
            const k = `${names.join(' ~ ')} | ${p.opp ? 'opp' : 'same'} | n ${p.n.map(x => x.toFixed(2)).join(',')} @ ${p.d.toFixed(3)}`;
            const e = by.get(k) ?? {n: 0, m2: 0, bb: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]};
            e.n++; e.m2 += p.ov;
            for (const t of [p.a, p.b]) for (const q of t.p) for (let i = 0; i < 3; i++) { e.bb[i] = Math.min(e.bb[i], q[i]); e.bb[i + 3] = Math.max(e.bb[i + 3], q[i]); }
            by.set(k, e);
          }
          log(`    dTol ${dTol}: ${ps.length} pairs ${ps.reduce((s, p) => s + p.ov, 0).toFixed(3)} m2`);
          for (const [k, e] of [...by].sort((a, b) => b[1].m2 - a[1].m2).slice(0, 25)) log(`      ${e.m2.toFixed(3)} m2 (${e.n})  ${k}  bb ${e.bb.map(x => x.toFixed(2)).join(',')}`);
        }
      }
    }
  }, 600000);
});
