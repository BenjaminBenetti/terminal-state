// Task studio-skywalk-variety-20261107-231448-01 (lane FACADE): the Skyways buildings' facade relief (world/skywaysFacade.ts, merged
// by world/skywaysExterior.ts into its existing meshes) on REAL Skyways layouts of every layout version (the exterior is runtime):
//  - plan: deterministic per seed; one facade per building; the station building civic, the hubs rotated so a complex shows several
//    characters; every building gets a base, corners, a cornice and a roof edge;
//  - keep-clear: no relief box in front of a window / entrance span (its outward prism and reveal), in a bridge tube (outer
//    cross-section, slab underside to roof apex), in an atrium vault, inside any footprint below its roof (parapets / plant stand on
//    roofs) or beyond the sidewalk; curtain-wall panels outside the footprints or above the roofs, never coplanar with a shell face;
//  - build: the SAME draw calls (mesh x material group) with and without the relief, triangles bounded, never a shadow caster.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SkywaysRect} from '../src/gen/skyways/skywaysTypes';
import {SKYWAYS_EXT, bridgeOuter, buildSkywaysExterior, planSkywaysExterior, type SkywaysExteriorPlan} from '../src/world/skywaysExterior';
import {FACADE_STYLES, type FacadeBox} from '../src/world/skywaysFacade';

installCanvasShim(false);
const LOG = '/tmp/skyways-facade.log';
fs.writeFileSync(LOG, '');
const log = (s: string) => fs.appendFileSync(LOG, s + '\n');

/** [seed, layout version]: the live generator and the frozen ones (the relief is runtime: every version gets it). */
const CASES: readonly [number, number][] = [[1, 4], [2, 4], [3, 4], [1, 3], [2, 1]];
const layouts = new Map<string, StationLayout>();
const layoutOf = (seed: number, v: number): StationLayout => {
  const k = `${seed}/${v}`;
  let L = layouts.get(k);
  if (!L) layouts.set(k, (L = LEVELS.skyways!.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: v} as never) as StationLayout));
  return L;
};

type Box3 = {x0: number; y0: number; z0: number; x1: number; y1: number; z1: number};
const E = 1e-4;
const hit = (a: Box3, b: Box3) => a.x0 < b.x1 - E && b.x0 < a.x1 - E && a.y0 < b.y1 - E && b.y0 < a.y1 - E && a.z0 < b.z1 - E && b.z0 < a.z1 - E;
const overXZ = (a: Box3, r: SkywaysRect) => a.x0 < r.x1 - E && r.x0 < a.x1 - E && a.z0 < r.z1 - E && r.z0 < a.z1 - E;
const desc = (b: FacadeBox) => `${b.part} [${b.x0.toFixed(2)},${b.y0.toFixed(2)},${b.z0.toFixed(2)}]..[${b.x1.toFixed(2)},${b.y1.toFixed(2)},${b.z1.toFixed(2)}]`;

/** The forbidden volumes of a layout, built independently of the planner from the layout records. */
function forbidden(L: StationLayout, plan: SkywaysExteriorPlan) {
  const info = L.skyways!, gy = info.groundY;
  const windows: (Box3 & {id: string})[] = info.windows.filter(w => 'building' in w.host).map((w, i) => {
    const y0 = w.baseY + w.sill, y1 = w.baseY + w.head, out = 6;
    // the wall cells (reveal) + the outward prism
    const box = w.side === 'N' ? {x0: w.x0, x1: w.x1, z0: w.z0 - out, z1: w.z1} : w.side === 'S' ? {x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1 + out}
      : w.side === 'W' ? {x0: w.x0 - out, x1: w.x1, z0: w.z0, z1: w.z1} : {x0: w.x0, x1: w.x1 + out, z0: w.z0, z1: w.z1};
    return {...box, y0, y1, id: `${w.kind}#${i}`};
  });
  const tubes: (Box3 & {id: string})[] = info.bridges.map(b => {
    const o = bridgeOuter(b), deck = info.storeys.find(s => s.level === b.level)!.baseY;
    const ceil = L.areas[b.area]?.ceil ?? deck + 3.5;
    return {x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1, y0: deck - SKYWAYS_EXT.deckDepth, y1: Math.max(b.roof?.apexY ?? 0, ceil + SKYWAYS_EXT.roofDepth), id: b.id};
  });
  const vaults: (Box3 & {id: string})[] = info.buildings.filter(b => b.atrium).map(b => {
    const r = b.atrium!.rect;
    return {x0: r.x0 - 0.3, x1: r.x1 + 0.3, z0: r.z0 - 0.3, z1: r.z1 + 0.3, y0: b.atrium!.roofY - 0.5, y1: b.atrium!.roofY + 4.5, id: b.id};
  });
  /** The roof over a point of a building's footprint (its tower's top over the tower, else the shell / podium top). */
  const roofAt = (id: string, box: Box3): number => {
    const s = plan.shells.find(q => q.building === id)!;
    return s.tower && overXZ(box, s.tower) ? s.top : s.podiumTop;
  };
  return {windows, tubes, vaults, roofAt, gy};
}

describe('skyways facade relief: the plan', () => {
  for (const [seed, v] of CASES) {
    it(`seed ${seed} (layout v${v}): deterministic, one varied facade per building, every keep-clear rule holds`, () => {
      const L = layoutOf(seed, v), info = L.skyways!;
      const p = planSkywaysExterior(L), p2 = planSkywaysExterior(L);
      expect(JSON.stringify(p2.facades)).toBe(JSON.stringify(p.facades));
      expect(p.facades.map(f => f.building)).toEqual(info.buildings.map(b => b.id));
      // characters: the station building civic; the hubs rotate through the other styles (a complex shows several)
      for (const f of p.facades) {
        const b = info.buildings.find(q => q.id === f.building)!;
        if (b.role === 'station') expect(f.style).toBe('civic');
        expect(Object.keys(FACADE_STYLES)).toContain(f.style);
      }
      const styles = new Set(p.facades.map(f => f.style));
      expect(styles.size).toBeGreaterThanOrEqual(Math.min(3, info.buildings.length));
      const hubs = p.facades.filter(f => info.buildings.find(b => b.id === f.building)!.role === 'hub');
      expect(new Set(hubs.map(f => f.style)).size).toBeGreaterThanOrEqual(Math.min(3, hubs.length));
      // every building: a base (plinth / piers / band), corners, a cornice and a roof edge (parapet), a real amount of relief
      for (const f of p.facades) {
        const parts = new Set(f.boxes.map(b => b.part));
        for (const part of ['corner', 'cornice', 'parapet', 'band'] as const) expect(parts.has(part), `${f.building} ${part}`).toBe(true);
        expect(parts.has('plinth') || parts.has('base-pier'), `${f.building} base`).toBe(true);
        expect(f.boxes.length, f.building).toBeGreaterThanOrEqual(30);
        expect(f.peak).toBeGreaterThan(p.shells.find(s => s.building === f.building)!.top);
        for (const b of f.boxes) {
          expect(b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0, desc(b)).toBe(true);
          for (const c of b.color) expect(c >= 0 && c <= 1).toBe(true);
        }
      }
      // keep-clear (forbidden volumes built from the layout records, independently of the planner)
      const F = forbidden(L, p);
      let checked = 0;
      for (const f of p.facades) for (const b of f.boxes) {
        checked++;
        for (const w of F.windows) expect(hit(b, w), `${f.building} ${desc(b)} in front of window ${w.id}`).toBe(false);
        for (const t of F.tubes) expect(hit(b, t), `${f.building} ${desc(b)} in bridge ${t.id}`).toBe(false);
        for (const a of F.vaults) expect(hit(b, a), `${f.building} ${desc(b)} in the atrium vault of ${a.id}`).toBe(false);
        for (const o of info.buildings) {
          if (!overXZ(b, o.rect)) continue;
          expect(o.id, `${f.building} ${desc(b)} inside ${o.id}`).toBe(f.building);
          expect(b.y0, `${f.building} ${desc(b)} below its roof`).toBeGreaterThanOrEqual(F.roofAt(o.id, b) - 1e-6);
        }
        // never past the sidewalk (the curbs / road / wrecks)
        const r = info.buildings.find(q => q.id === f.building)!.rect, reach = SKYWAYS_EXT.sidewalk - SKYWAYS_EXT.curb.w - 0.2;
        expect(Math.max(r.x0 - b.x0, b.x1 - r.x1, r.z0 - b.z0, b.z1 - r.z1), `${f.building} ${desc(b)} past the sidewalk`).toBeLessThanOrEqual(reach);
        expect(b.y0).toBeGreaterThanOrEqual(F.gy - 1e-6);
      }
      expect(checked).toBeGreaterThan(200);
      // curtain-wall panels: outside the footprints (bay fronts) or above the roofs (setback walls), never coplanar with a shell face
      for (const f of p.facades) for (const q of f.panels) {
        expect(q.axis === 'x' || q.axis === 'z').toBe(true);
        const pb: Box3 = q.axis === 'z' ? {x0: q.s0, x1: q.s1, y0: q.t0, y1: q.t1, z0: q.c, z1: q.c} : {x0: q.c, x1: q.c, y0: q.t0, y1: q.t1, z0: q.s0, z1: q.s1};
        for (const o of info.buildings) {
          const r = o.rect, inside = q.axis === 'z' ? q.c > r.z0 + E && q.c < r.z1 - E && q.s0 < r.x1 - E && r.x0 < q.s1 - E : q.c > r.x0 + E && q.c < r.x1 - E && q.s0 < r.z1 - E && r.z0 < q.s1 - E;
          if (!inside) continue;
          expect(o.id, `${f.building} panel inside ${o.id}`).toBe(f.building);
          expect(q.t0, `${f.building} panel inside the footprint below its roof`).toBeGreaterThanOrEqual(F.roofAt(o.id, pb) - 1e-6);
        }
        for (const s of p.shells) for (const sf of s.faces) {
          if (sf.axis !== q.axis || Math.abs(sf.c - q.c) > 1e-3 || sf.n !== q.n) continue;
          const os = Math.min(sf.s1, q.s1) - Math.max(sf.s0, q.s0), ot = Math.min(sf.t1, q.t1) - Math.max(sf.t0, q.t0);
          expect(os > 1e-3 && ot > 1e-3, `${f.building} panel coplanar with the shell of ${s.building}`).toBe(false);
        }
      }
      log(`seed ${seed} v${v}: ${p.facades.map(f => `${f.building}:${info.buildings.find(b => b.id === f.building)!.role}/${f.style}/${f.crown} ${f.boxes.length} boxes ${f.panels.length} panels peak ${f.peak}`).join(' | ')}`);
    });
  }
});

describe('skyways facade relief: the build', () => {
  it('the same draw calls with and without the relief; triangles bounded; one material per mesh; never a shadow caster', () => {
    for (const [seed, v] of CASES) {
      const L = layoutOf(seed, v);
      const plan = planSkywaysExterior(L);
      const draws = (root: THREE.Object3D) => {
        const out: string[] = [];
        root.traverse(o => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const n = Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1;
          for (let i = 0; i < n; i++) out.push(m.name);
        });
        return out;
      };
      const before = buildSkywaysExterior({...plan, facades: []}), after = buildSkywaysExterior(plan);
      const db = draws(before.root), da = draws(after.root);
      expect(da, `seed ${seed} v${v}`).toEqual(db);
      expect(after.stats.draws).toBe(before.stats.draws);
      expect(after.stats.meshes).toBe(before.stats.meshes);
      // the relief's triangles: counted, bounded per building and per complex, and exactly the shells / bridges meshes' growth
      const tri = (v2: typeof after, n: string) => { const m = v2.root.getObjectByName(n) as THREE.Mesh; return m.geometry.index!.count / 3; };
      const grown = tri(after, 'skyways-ext-shells') - tri(before, 'skyways-ext-shells') + tri(after, 'skyways-ext-bridges') - tri(before, 'skyways-ext-bridges');
      expect(grown).toBe(after.stats.facadeTris);
      expect(after.stats.facadeBoxes).toBe(plan.facades.reduce((s, f) => s + f.boxes.length, 0));
      expect(after.stats.facadeTris).toBeGreaterThan(400 * plan.facades.length);
      expect(after.stats.facadeTris).toBeLessThan(3500 * plan.facades.length);
      expect(after.stats.facadeTris).toBeLessThan(20_000);
      expect(after.stats.triangles - after.stats.cityTris).toBeLessThan(25_000);
      // the merged meshes keep one material each, a colour per vertex where vertex-coloured, and never cast / receive shadows
      for (const n of ['skyways-ext-shells', 'skyways-ext-bridges']) {
        const m = after.root.getObjectByName(n) as THREE.Mesh;
        expect(Array.isArray(m.material)).toBe(false);
        expect(m.geometry.groups.length).toBe(0);
        expect(m.castShadow || m.receiveShadow).toBe(false);
        const c = m.geometry.attributes.color;
        if (c) expect(c.count).toBe(m.geometry.attributes.position.count);
      }
      after.root.traverse(o => expect(o.castShadow).toBe(false));
      log(`seed ${seed} v${v}: draws ${after.stats.draws} (unchanged), facade ${after.stats.facadeBoxes} boxes / ${after.stats.facadeTris} tris, exterior own tris ${before.stats.triangles - before.stats.cityTris} -> ${after.stats.triangles - after.stats.cityTris}`);
      for (const g of [...before.geometries, ...after.geometries]) g.dispose();
    }
  });
});
