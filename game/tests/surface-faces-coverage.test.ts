// Task studio-surface-run-field-followup-20261116-211729-01 (lane FACADE; user: "Diagnose and fix missing / see-through building faces:
// actual geometry / normals / culling correctness, not globally double-sided materials or disabling culling"): THE FACE COVERAGE AUDIT of
// real districts on the real build path (buildWorld + the surface arch). Every exposed stretch of every building wall — from the street
// (or the lower neighbour's roof line / the cordon's coping) up to its own roof line — is covered by a FRONT face seen from outside
// (culled exactly as the GPU culls: a face shows only toward its normal unless its material is double-sided), above the outdoor band
// (SKY_CEIL, 40 m: the Office host tower) too; decorative openings show their dark room behind, AIR's spans and doorways stay open; the
// step between a collapsed corner's decks is closed; every roof is drawn. Before the fix: ~15,000 m² of party wall a district had no
// face (the sky through the building), the tower's top 8 m none, a collapsed corner's step none.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {LEVELS} from '../src/levels/registry';
import {CELL, FLOOR} from '../src/gen/grid';
import {SKY_CEIL} from '../src/gen/surface/cityCarve';
import type {Side, StationLayout} from '../src/gen/stationTypes';
import {LOOK_TUNE, OWNER, SIDE_NORMAL, bareRuns, deckSteps, entranceFloor, surfaceLookPlan, topAt, type BuildingLook, type SurfaceLookPlan} from '../src/world/surface/archPlan';

installCanvasShim(false);

const OPP: Readonly<Record<Side, Side>> = {N: 'S', S: 'N', W: 'E', E: 'W'};
/** A vertical axis-aligned triangle in plane space (s along the plane, y up), its plane coordinate and its facing. */
interface PT { s0: number; s1: number; y0: number; y1: number; d: number; out: boolean; dbl: boolean; p: number[][] }
/** Bucket size along the plane (m): a lookup only scans the triangles of its own stretch. */
const SB = 8;

/** The built district's vertical triangles per axis, by plane (cm) and stretch; the up-facing ones on a 4 m grid. */
function triangles(group: THREE.Object3D) {
  const byPlane = {x: new Map<string, PT[]>(), z: new Map<string, PT[]>()};
  const ups = new Map<string, {x0: number; x1: number; z0: number; z1: number; y: number; p: number[][]}[]>();
  const v = new THREE.Vector3();
  group.updateMatrixWorld(true);
  const put = <T>(m: Map<string, T[]>, k: string, t: T) => { let l = m.get(k); if (!l) m.set(k, (l = [])); l.push(t); };
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || !m.geometry.attributes.position) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    if (mat.transparent && (mat as THREE.MeshStandardMaterial).opacity < 0.9) return; // glazing: see-through by design
    const g = m.geometry, pos = g.attributes.position, idx = g.index, dbl = mat.side === THREE.DoubleSide;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const p = [0, 1, 2].map(j => { v.fromBufferAttribute(pos, idx ? idx.getX(t + j) : t + j).applyMatrix4(m.matrixWorld); return [v.x, v.y, v.z]; });
      const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], L = Math.hypot(nx, ny, nz);
      if (L < 1e-9) continue;
      const vert = (axis: 'x' | 'z', P: number, out: boolean, si: 0 | 2) => {
        const s0 = Math.min(p[0][si], p[1][si], p[2][si]), s1 = Math.max(p[0][si], p[1][si], p[2][si]);
        const tri: PT = {s0, s1, y0: Math.min(p[0][1], p[1][1], p[2][1]), y1: Math.max(p[0][1], p[1][1], p[2][1]), d: P, out, dbl, p: p.map(q => [q[si], q[1]])};
        for (let b = Math.floor(s0 / SB); b <= Math.floor(s1 / SB); b++) put(byPlane[axis], `${Math.round(P * 100)}|${b}`, tri);
      };
      if (Math.abs(nx) / L > 0.999) vert('x', p[0][0], nx > 0, 2);
      else if (Math.abs(nz) / L > 0.999) vert('z', p[0][2], nz > 0, 0);
      else if (ny / L > 0.999) {
        const u = {x0: Math.min(p[0][0], p[1][0], p[2][0]), x1: Math.max(p[0][0], p[1][0], p[2][0]), z0: Math.min(p[0][2], p[1][2], p[2][2]), z1: Math.max(p[0][2], p[1][2], p[2][2]), y: p[0][1], p: p.map(q => [q[0], q[2]])};
        for (let cx = Math.floor(u.x0 / 4); cx <= Math.floor(u.x1 / 4); cx++) for (let cz = Math.floor(u.z0 / 4); cz <= Math.floor(u.z1 / 4); cz++) put(ups, `${cx},${cz}`, u);
      }
    }
  });
  return {byPlane, ups};
}

const inTri = (p: number[][], s: number, y: number) => {
  const [a, b, c] = p;
  const d1 = (s - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]), d2 = (s - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]), d3 = (s - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
  return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
};

interface Gap { b: number; side: Side; s: number; y: number; why: string }

/** The audit of one district: wall gaps, deck-step gaps, roof misses, and how many samples stood above the outdoor band. */
function audit(layout: StationLayout, plan: SurfaceLookPlan, T: ReturnType<typeof triangles>) {
  /** Looking from outside (+n) at (s, y) on `plane`: the outermost FRONT face's depth below the plane (-Infinity: none). */
  const probe = (alongX: boolean, n: number, plane: number, s: number, y: number, near = 1.5, far = 3.2) => {
    const map = alongX ? T.byPlane.z : T.byPlane.x, b = Math.floor(s / SB);
    let vis = -Infinity, back = -Infinity;
    for (let c = Math.round((plane - n * far) * 100), e = Math.round((plane + n * near) * 100), st = n > 0 ? 1 : -1; n > 0 ? c <= e : c >= e; c += st) {
      for (const t of map.get(`${c}|${b}`) ?? []) {
        if (s < t.s0 - 1e-6 || s > t.s1 + 1e-6 || y < t.y0 - 1e-6 || y > t.y1 + 1e-6 || !inTri(t.p, s, y)) continue;
        const d = (t.d - plane) * n;
        if (t.dbl || (t.out ? n > 0 : n < 0)) vis = Math.max(vis, d); else back = Math.max(back, d);
      }
    }
    return {vis, back};
  };
  const g = layout.grid, W = g.w;
  const cellAt = (x: number, z: number) => { const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); return cx < 0 || cz < 0 || cx >= W || cz >= g.h ? -1 : cz * W + cx; };
  const walls: Gap[] = [], steps: Gap[] = [], roofs: Gap[] = [];
  let samples = 0, high = 0;
  const why = (r: {vis: number; back: number}) => (r.vis === -Infinity ? (r.back > -Infinity ? 'back face only' : 'nothing') : `deep ${r.vis.toFixed(2)}`);
  for (const bl of plan.buildings) {
    if (!bl.sides.length) continue;
    for (const sd of bl.sides) {
      const {alongX, n} = SIDE_NORMAL[sd.side];
      for (let s = sd.s0 + 0.25; s < sd.s1 - 0.2; s += 1) {
        const top = topAt(sd, s, bl.top), oi = alongX ? cellAt(s, sd.plane + n * 0.3) : cellAt(sd.plane + n * 0.3, s);
        // where the exposure starts: the open cell's floor, a neighbour's roof line, the cordon's / debris' / tent's top
        let from: number;
        if (oi < 0) from = 0;
        else if (g.cells[oi] === FLOOR) from = g.floor[oi];
        else {
          const own = plan.owner[oi];
          if (own === bl.id) continue;
          if (own >= 0) { const nb = plan.buildings[own], os = nb.sides.find(q => q.side === OPP[sd.side]); from = os ? topAt(os, s, nb.top) : nb.top; }
          else if (own === OWNER.cordon) from = plan.wall ? LOOK_TUNE.cordonH : 0; // (a v2 district's last-resort ring is not drawn)
          else if (own === OWNER.debris) from = LOOK_TUNE.debrisH;
          else if (own === OWNER.tent) from = LOOK_TUNE.tentRidge + 0.6;
          else from = 0;
        }
        for (let y = from + 0.25; y < top - 0.1; y += 1) {
          let open: string | null = null;
          for (const h of bl.holes) if (h.side === sd.side && s > h.s0 - 0.05 && s < h.s1 + 0.05 && y > h.y0 - 0.1 && y < h.y1 + 0.1) open = h.kind;
          for (const e of bl.b.entrances) if (e.side === sd.side) { const c = alongX ? e.x : e.z; if (Math.abs(s - c) < e.width / 2 + 0.15 && y < entranceFloor(layout, e) + e.height + 0.2) open = 'door'; }
          if (open === 'air' || open === 'door') continue;
          samples++;
          if (y > SKY_CEIL) high++;
          const r = probe(alongX, n, sd.plane, s, y);
          // a wall: its face at the plane (or proud of it); a decorative opening: its dark room within the building
          if (r.vis < (open ? -LOOK_TUNE.room - 0.85 : -0.2)) walls.push({b: bl.id, side: sd.side, s, y, why: why(r)});
        }
      }
    }
    for (const st of deckSteps(bl)) {
      for (let s = st.s0 + 0.25; s < st.s1 - 0.2; s += 1) for (let y = st.y0 + 0.2; y < st.y1 - 0.1; y += 1) {
        samples++;
        const r = probe(st.alongX, st.n, st.plane, s, y, 1.5, 1.5);
        if (r.vis < -0.2) steps.push({b: bl.id, side: 'N', s, y, why: why(r)});
      }
    }
    const f = bl.b.footprint;
    for (let x = f.x0 + 0.45; x < f.x1 - 0.4; x += 2) for (let z = f.z0 + 0.45; z < f.z1 - 0.4; z += 2) {
      let best = -Infinity;
      for (const u of T.ups.get(`${Math.floor(x / 4)},${Math.floor(z / 4)}`) ?? []) if (x >= u.x0 && x <= u.x1 && z >= u.z0 && z <= u.z1 && u.y <= bl.top + 0.3 && u.y > best && inTri(u.p, x, z)) best = u.y;
      samples++;
      if (best < Math.max(bl.ceilTop + 0.05, 1.5)) roofs.push({b: bl.id, side: 'N', s: x, y: z, why: `roof ${best}`});
    }
  }
  return {walls, steps, roofs, samples, high};
}

const show = (l: Gap[]) => l.slice(0, 6).map(q => `b${q.b} ${q.side} s=${q.s.toFixed(2)} y=${q.y.toFixed(2)} ${q.why}`).join(' | ');

describe('Surface Run facades: every exposed building wall is covered (lane FACADE)', () => {
  for (const [host, seed, v] of [['subway', 93, 1], ['office', 5, 1], ['subway', 93, 2]] as const) {
    it(`${host} district ${seed} (v${v}): walls street -> roof line front-faced from outside (party walls and the tower above the outdoor band too), deck steps closed, roofs drawn`, () => {
      const layout = (LEVELS as Record<string, {generate(s: string, c: object): StationLayout}>)[host].generate('surface', {levelSeed: seed, ...(v === 2 ? {surfaceVersion: 2} : {})});
      const w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
      const plan = surfaceLookPlan(layout)!;
      expect(plan.wall).toBe(v === 1);
      const a = audit(layout, plan, triangles(w.group));
      expect(a.samples).toBeGreaterThan(60_000);
      expect(a.walls.length, show(a.walls)).toBe(0);
      expect(a.steps.length, show(a.steps)).toBe(0);
      expect(a.roofs.length, show(a.roofs)).toBe(0);
      // the Office host tower rises above the outdoor band: its top storeys were sampled (and covered)
      if (host === 'office') expect(a.high).toBeGreaterThan(50);
      // the fix is in play: party walls drawn where no builder face stood, collapsed corners' steps closed
      expect(w.surfaceArch!.stats.bare).toBeGreaterThan(100);
      expect(w.surfaceArch!.stats.bareM2).toBeGreaterThan(5_000);
      expect(plan.buildings.some(bl => deckSteps(bl).length > 0)).toBe(true);
    }, 300_000);
  }

  it('bareRuns: party walls over a lower neighbour start at its roof line (outdoor-lit), the tower above the outdoor band at SKY_CEIL (field-lit); never below a covering face', () => {
    const layout = LEVELS.office.generate('surface', {levelSeed: 5});
    const plan = surfaceLookPlan(layout)!;
    const g = layout.grid;
    let outdoor = 0, field = 0;
    const tower = plan.buildings.find(b => (b.b as {host?: string}).host === 'office') as BuildingLook;
    expect(tower).toBeDefined();
    expect(tower.top).toBeGreaterThan(SKY_CEIL + 4);
    for (const bl of plan.buildings) for (const sd of bl.sides) {
      for (const r of sd.bare) {
        expect(r.s1).toBeGreaterThan(r.s0);
        expect(r.s0).toBeGreaterThanOrEqual(sd.s0 - 1e-6);
        expect(r.s1).toBeLessThanOrEqual(sd.s1 + 1e-6);
        const s = (r.s0 + r.s1) / 2, {alongX, n} = SIDE_NORMAL[sd.side];
        const cx = Math.floor((alongX ? s : sd.plane + n * CELL / 2) / CELL), cz = Math.floor((alongX ? sd.plane + n * CELL / 2 : s) / CELL), i = cz * g.w + cx;
        if (r.lit === 'outdoor') {
          outdoor++;
          // outdoor-lit: the column outside is closed (a neighbour's mass / the cordon / debris): no light-field slot there
          expect(g.cells[i] === FLOOR && plan.owner[i] < 0, `b${bl.id} ${sd.side} outdoor run over an open street cell`).toBe(false);
          const own = plan.owner[i];
          if (own >= 0 && own !== bl.id) { const nb = plan.buildings[own], os = nb.sides.find(q => q.side === OPP[sd.side]); expect(r.y0).toBeCloseTo(os ? topAt(os, s, nb.top) : nb.top, 6); }
        } else {
          field++;
          // field-lit: an open street cell outside whose band ends under the roof line (the outdoor band's ceiling)
          expect(g.cells[i]).toBe(FLOOR);
          expect(r.y0).toBeGreaterThan(SKY_CEIL - 1e-6);
        }
        expect(topAt(sd, s, bl.top)).toBeGreaterThan(r.y0);
      }
    }
    expect(outdoor).toBeGreaterThan(50);
    expect(field).toBeGreaterThan(0);
    expect(tower.sides.some(sd => sd.bare.some(r => r.lit === 'field'))).toBe(true);
    // recomputing a side gives the same runs (pure)
    const any = plan.buildings.find(b => b.sides.some(s => s.bare.length))!, sd = any.sides.find(s => s.bare.length)!;
    expect(bareRuns(layout, plan.owner, plan.buildings, plan.tent, any, sd)).toEqual(sd.bare);
  });
});
