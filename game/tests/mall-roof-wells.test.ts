// Task mall-roof-stairwell-fix-20261117 (Studio Beta): the user's "massive hole in the roof with texture warping, most often above a
// stairwell on a lower floor" (screenshot: Atrium court · Level 3, looking up). Root cause: every public run of the mall (the escalator
// stack 0-1 / 1-2 / 2-3, the wing stairs 1-2 / 2-3) is an OPEN well (Ramp.headroom OPEN_HEADROOM = 40 m) meant to be capped by its
// cell ceiling (the upper storey's gallery ceiling: gen/levels.ts header). Collision capped it; the renderer (cellCeil / edgeBand /
// ceilingRuns), the per-grid rays (hitscan surfaceHit) and Grid.ceilAt cap a ramp's band only with Ramp.capCeil, which the mall never
// set. So on unchanged main every mall drew no ceiling over any well (the top floor's ceiling open over its 2-3 runs), extruded the
// wells' walls 40 m past the flight (faces up to ~55 m: ~2000 m2 standing over the ~25 m roof apex, stretched shaft walls) and hung the
// wells' 15 fixtures 41-55 m up (finishTraversal snaps a flight's fixture to Grid.ceilAt). gen/mall/carve.ts carveRun now marks its
// flights capCeil (the Skyways / Market open-well contract); the generated layout is otherwise unchanged (every other record, RNG draw
// and id: only those 15 fixtures' y moves onto the well ceilings). world/builder.ts draws the well ceiling with both storeys (the
// flight's chunk tag, like its side walls), so the level culler shows it from the upper storey it belongs to.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {generateMallLevel, MALL_ALL_VARIANTS, type MallVariant} from '../src/gen/mall/index';
import {OPEN_HEADROOM} from '../src/gen/mall/carve';
import {CLEAR} from '../src/gen/mall/frame';
import {CELL, FLOOR, VOID, type Ramp} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {surfaceHit} from '../src/combat/hitscan';
import {LevelColumns, ceilingRuns, cellCeil, extractWallFaces} from '../src/world/levelGeometry';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {fogCullDistance} from '../src/world/levelCulling';
import {MALL_FOG} from '../src/world/mallAtmosphere';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);

const SEEDS = [12345, 777];
const cache = new Map<string, StationLayout>();
const mallOf = (v: MallVariant, seed: number) => {
  const k = `${v}:${seed}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = generateMallLevel({levelSeed: seed, startWeapon: 'rifle'} as never, {variant: v})));
  return l;
};

/** Every open well's ramp (one ramps list is shared by every storey grid) with its cap: the upper storey's gallery ceiling. */
function wells(l: StationLayout): {R: Ramp; lo: number; hi: number; cap: number}[] {
  const levels = l.levels!;
  return l.grid.ramps.filter(R => R.headroom === OPEN_HEADROOM).map(R => {
    const top = Math.max(R.h0, R.h1), bot = Math.min(R.h0, R.h1);
    const hi = levels.findIndex(L => Math.abs(L.baseY - top) < 1e-3), lo = levels.findIndex(L => Math.abs(L.baseY - bot) < 1e-3);
    return {R, lo, hi, cap: levels[hi].baseY + CLEAR.gallery};
  });
}
const cellsOf = (R: Ramp, W: number) => { const out: number[] = []; for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) out.push(y * W + x); return out; };

const pointInPoly = (poly: readonly {x: number; z: number}[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
};

// (task studio-mall-layout-variety-20261117-005520-01: every variant = MALL_ALL_VARIANTS — the atrium family + the version-2 plan families)
describe('mall open wells: capped at the upper storey\'s gallery ceiling (every variant)', () => {
  for (const v of MALL_ALL_VARIANTS as readonly MallVariant[]) it(`${v}: every public run is a capped open well — render, rays and Grid.ceilAt stop at its ceiling`, () => {
    for (const seed of SEEDS) {
      const l = mallOf(v, seed), levels = l.levels!, W = l.grid.w, LV = levelsOf(l);
      const ws = wells(l);
      // the escalator stack (0-1, 1-2, 2-3) + the two wing stairs (1-2, 2-3), one lane or more each
      const runs = l.mall!.verticals.filter(q => q.kind === 'escalator' || q.kind === 'stair');
      expect(runs.length, `${v} ${seed}`).toBeGreaterThanOrEqual(5);
      expect(new Set(runs.map(q => `${q.lower}-${q.upper}`))).toEqual(new Set(['0-1', '1-2', '2-3']));
      for (const q of runs) {
        const R = l.grid.ramps[l.traversal.stairs[l.levelLinks[q.link!].traversalId!].ramp];
        expect(R.headroom, `${v} ${seed} ${q.kind} ${q.lower}-${q.upper}`).toBe(OPEN_HEADROOM);
      }
      for (const {R, lo, hi, cap} of ws) {
        const tag = `${v} ${seed} well ${lo}-${hi} @${R.x},${R.y}`;
        expect(R.capCeil, tag).toBe(true);
        expect(hi, tag).toBe(lo + 1);
        for (const i of cellsOf(R, W)) for (const L of [lo, hi]) {
          const g = levels[L].grid;
          if (g.rampIdx[i] < 0 || g.ramps[g.rampIdx[i]] !== R) continue;
          expect(cellCeil(g, i), `${tag} cell ${i} (storey ${L})`).toBeCloseTo(cap, 3); // render band
          const x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
          expect(g.ceilAt(x, z), tag).toBeCloseTo(cap, 3); // Grid.ceilAt (fixtures, placement, runtime queries)
          // a ray straight up from the flight: the per-grid ray and the station's Levels ray both meet the well ceiling
          const y0 = g.floorAt(x, z) + 1.6;
          expect(surfaceHit(g, {x, y: y0, z}, {x: 0, y: 1, z: 0}, 80, l.trench.floorY)?.t ?? Infinity, tag).toBeCloseTo(cap - y0, 3);
          expect(LV.raycast({x, y: y0, z}, {x: 0, y: 1, z: 0}, 80).t, tag).toBeCloseTo(cap - y0, 3);
        }
      }
      // the shared ramps list carries no other open well, and the service cores keep their flight-following headroom
      expect(ws.length, `${v} ${seed}`).toBeGreaterThanOrEqual(runs.length);
    }
  });
});

describe('the top floor keeps its roof (the reported visual class)', () => {
  for (const v of MALL_ALL_VARIANTS as readonly MallVariant[]) it(`${v}: no band rises past the top floor's ceiling outside the glass roof; every well has its ceiling; nothing above the roof apex`, () => {
    for (const seed of SEEDS) {
      const l = mallOf(v, seed), levels = l.levels!, cols = new LevelColumns(levels), W = cols.W, n = W * cols.H;
      const top = levels[levels.length - 1].baseY, roofTop = top + CLEAR.gallery, apex = l.mall!.roof.apexY;
      const ro = l.mall!.roof.outline, rp = l.mall!.roof.polygon;
      const underRoof = (i: number) => {
        const x = (i % W + 0.5) * CELL, z = (Math.floor(i / W) + 0.5) * CELL;
        return x >= ro.x0 - 0.01 && x <= ro.x1 + 0.01 && z >= ro.z0 - 0.01 && z <= ro.z1 + 0.01 && (!rp || rp.length < 3 || pointInPoly(rp, x, z));
      };
      const tag = `${v} ${seed}`;
      let tall = 0, highest = -Infinity;
      for (let i = 0; i < n; i++) for (const b of cols.bands(i)) {
        highest = Math.max(highest, b.c);
        // a band open where one stands on the top floor rises no higher than its gallery ceiling (the atrium under the glass excepted)
        if (b.f <= top + 1.8 && b.c >= top + 1.8 && b.c > roofTop + 0.01 && !underRoof(i)) tall++;
      }
      expect(tall, `${tag}: top-floor columns open above its ceiling outside the glass roof`).toBe(0);
      expect(highest, `${tag}: highest band top vs the roof apex`).toBeLessThanOrEqual(apex + 0.01);
      // every well cell has its flat ceiling at the cap (it had none: the hole)
      const runs = ceilingRuns(levels, cols);
      const ceilY = new Map<number, number[]>();
      for (const r of runs) for (let x = r.x0; x < r.x1; x++) { const i = r.row * W + x; (ceilY.get(i) ?? ceilY.set(i, []).get(i)!).push(r.y); }
      for (const {R, cap, lo, hi} of wells(l)) for (const i of cellsOf(R, W)) {
        if (levels[lo].grid.rampIdx[i] < 0) continue;
        expect((ceilY.get(i) ?? []).some(y => Math.abs(y - cap) < 1e-3), `${tag} well ${lo}-${hi}: ceiling over cell ${i % W},${Math.floor(i / W)}`).toBe(true);
      }
      // wall faces end at the roof apex (the wells' shafts stood up to ~55 m) and every fixture hangs under it
      const faces = extractWallFaces(l, levels, cols, {tileLowerHeight: 1.2});
      expect(Math.max(...faces.map(f => f.y1)), `${tag}: highest wall face`).toBeLessThanOrEqual(apex + 0.01);
      expect(Math.max(...l.lights.map(q => q.y)), `${tag}: highest fixture`).toBeLessThanOrEqual(apex);
      // the wells' own fixtures hang at their well ceilings (finishTraversal: 2 cm under the capped Grid.ceilAt)
      // (the escalators 0-1 and 2-3 share one lane footprint: by the run's area)
      let wellFixtures = 0;
      for (const {R, cap, lo} of wells(l)) {
        const area = levels[lo].grid.area[R.y * W + R.x];
        for (const q of l.lights.filter(q => q.area === area)) { expect(q.y, `${tag}: well fixture`).toBeCloseTo(cap - 0.02, 2); wellFixtures++; }
      }
      expect(wellFixtures, tag).toBeGreaterThan(0);
    }
  });

  it('the well ceilings stay visible from the storey they belong to (level culler), and the built world has nothing over the roof', () => {
    for (const v of ['terrace-cross', 'offset-arcade'] as MallVariant[]) {
      const l = mallOf(v, SEEDS[0]), LV = levelsOf(l);
      const w = buildWorld(l, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
      w.culler.maxDistance = Math.min(fogCullDistance(MALL_FOG.density), MALL_FOG.far);
      w.group.updateMatrixWorld(true);
      const apex = l.mall!.roof.apexY;
      expect(Math.max(...w.wallFaces.map(f => f.y1)), `${v}: highest published wall face`).toBeLessThanOrEqual(apex + 0.01);
      const meshes: THREE.Mesh[] = [];
      w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      let looked = 0;
      for (const q of l.mall!.verticals.filter(k => k.kind === 'escalator' || k.kind === 'stair')) {
        const R = l.grid.ramps[l.traversal.stairs[l.levelLinks[q.link!].traversalId!].ramp];
        const x0 = R.x * CELL, z0 = R.y * CELL, x1 = (R.x + R.w) * CELL, z1 = (R.y + R.h) * CELL, cap = l.levels![q.upper].baseY + CLEAR.gallery;
        // the meshes holding a downward ceiling triangle at the cap over the flight: tagged with both storeys of the run
        const holders = meshes.filter(m => {
          const p = m.geometry.getAttribute('position'), nm = m.geometry.getAttribute('normal'), ix = m.geometry.getIndex();
          if (!p || !nm) return false;
          const tris = (ix ? ix.count : p.count) / 3, at = (t: number) => (ix ? ix.getX(t) : t);
          for (let t = 0; t < tris; t++) {
            const a = at(3 * t), b = at(3 * t + 1), c = at(3 * t + 2);
            const cx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, cy = (p.getY(a) + p.getY(b) + p.getY(c)) / 3, cz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
            if (Math.abs(cy - cap) < 0.02 && nm.getY(a) < -0.9 && cx > x0 && cx < x1 && cz > z0 && cz < z1) return true;
          }
          return false;
        });
        const tag = `${v} ${q.kind} ${q.lower}-${q.upper}`;
        expect(holders.length, `${tag}: well ceiling meshes`).toBeGreaterThan(0);
        for (const m of holders) expect([...(m.userData.levels ?? [])].sort(), tag).toEqual([q.lower, q.upper]);
        // eyes on the upper storey beyond the top mouth, looking at the well ceiling (level / steep look-up): drawn whenever in sight
        const ax = Math.sign(q.head.x - q.foot.x), az = Math.sign(q.head.z - q.foot.z), g = l.levels![q.upper].grid;
        for (const [d, into] of [[1.5, 4], [4, 4], [0.6, 1.5], [1.2, 1.5]] as const) {
          const ex = q.head.x + ax * d, ez = q.head.z + az * d, ey = l.levels![q.upper].baseY + 1.62;
          const [gx, gy] = g.cellOf(ex, ez);
          if (!g.inBounds(gx, gy) || !g.walkable(gx, gy)) continue;
          const lx = ax ? q.head.x - ax * into : (x0 + x1) / 2, lz = az ? q.head.z - az * into : (z0 + z1) / 2;
          if (!LV.lineOfSight({x: ex, y: ey, z: ez}, {x: lx, y: cap - 0.05, z: lz})) continue;
          const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, MALL_FOG.far);
          cam.position.set(ex, ey, ez);
          cam.lookAt(lx, cap, lz);
          cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
          w.culler.update(cam, true);
          for (const m of holders) expect(m.layers.test(cam.layers), `${tag}: eye ${d} m past the top mouth`).toBe(true);
          looked++;
        }
      }
      expect(looked, v).toBeGreaterThan(10);
      w.culler.reset();
    }
  });
});

describe('open cells and areas are untouched by the cap', () => {
  it('the wells keep their open cells and run areas on both storeys (traversal unchanged: links, mouths, flights)', () => {
    const l = mallOf('terrace-cross', SEEDS[0]), levels = l.levels!, W = l.grid.w;
    for (const {R, lo, hi} of wells(l)) for (const i of cellsOf(R, W)) for (const L of [lo, hi]) {
      const c = levels[L].grid.cells[i];
      expect(c === FLOOR || c === VOID).toBe(true);
    }
    for (const k of l.levelLinks.filter(k => k.kind === 'stairs')) {
      const lo = levels[k.lower].grid, hi = levels[k.upper].grid;
      expect(lo.floorAt(k.bottom.x, k.bottom.z)).toBeCloseTo(k.bottom.y, 3);
      expect(hi.floorAt(k.top.x, k.top.z)).toBeCloseTo(k.top.y, 3);
    }
  });
});
