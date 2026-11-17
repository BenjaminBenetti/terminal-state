// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): what a VERSION-2 district shows at its edge. User: "Replace the
// visible perimeter wall with thickening outer fog and enough bounded filler blocks to hide the finite edge … Don't just make the old wall
// invisible." On GEN's REAL districts (LEVELS.subway.generate('surface') at version 2; version 1 alongside):
//  - NO perimeter wall drawn in v2 (no cordon / barricade faces, no wall coping, no wall in the daylight obstruction); v1 keeps all;
//  - the FILLER (world/surface/lookCity.ts): berms right outside the walkable edge on every side, collapsed blocks and the far city
//    behind — never standing on the walkable ground — inside the same triangle budget; the ground ring meets the edge;
//  - SIGHT LINES: from the drivable streets in clear, the pressure fog alone (the march's near term + its far term, CPU mirrors of the
//    shader's terms) leaves under 2 % of the light from anything at the edge, in every direction, on foot and from the truck's seat.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {lookFixture} from './helpers/surfaceLookFixture';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SRect} from '../src/gen/surface/surfaceTypes';
import {FOG_BOUNDARY} from '../src/gen/surface/fogFiller';
import {CELL} from '../src/gen/grid';
import type {BuiltFace} from '../src/world/levelGeometry';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {LOOK_TUNE, OWNER, surfaceLookPlan} from '../src/world/surface/archPlan';
import {obstructionTops} from '../src/world/surface/lookDaylight';
import {FAR_CITY, farCityPlan, farCityRect} from '../src/world/surface/lookCity';
import {buildSurfaceLookView, disposeSurfaceLookView} from '../src/world/surface/look';
import {SURFACE_KIT} from '../src/world/reactor/surfaceKit';
import {SURFACE_AIR, SURFACE_GAS_LOOK} from '../src/world/surface/airMask';
import {fogConcentration, fogThicken} from '../src/world/surface/fogAir';
import {fogPressureAt} from '../src/world/surface/fogPressure';
import {ATMOSPHERE} from '../src/render/atmosphere';
import {VF_FOG_FAR} from '../src/render/volumetricShaders';
import {TRUCK_ANCHORS} from '../src/world/surface/truckAnchors.generated';
import {SURFACE_FOG} from '../src/world/surface/airFog';
import {LOOK_SKY} from '../src/world/surface/lookSky';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const v2cache = new Map<number, StationLayout>();
const v2 = (seed: number) => { let L = v2cache.get(seed); if (!L) v2cache.set(seed, (L = LEVELS.subway.generate('surface', {levelSeed: seed, surfaceVersion: 2}))); return L; };
let built: {w: BuiltWorld; L: StationLayout} | null = null;
const v2World = () => (built ??= {L: v2(93), w: buildWorld(v2(93), mats(), {})});

const fakeModels = (): ((key: string) => GLTF | undefined) => {
  const cache = new Map<string, GLTF>();
  return key => {
    let g = cache.get(key);
    if (!g) {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 6, 4), new THREE.MeshStandardMaterial()));
      g = {scene, scenes: [scene], animations: [], cameras: [], asset: {}, parser: null, userData: {}} as unknown as GLTF;
      cache.set(key, g);
    }
    return g;
  };
};

describe('surface fog look: no perimeter wall in v2', () => {
  it('the plan: v2 draws no wall (plan.wall false), v1 does', () => {
    expect(surfaceLookPlan(v2(93))!.wall).toBe(false);
    expect(surfaceLookPlan(lookFixture().layout)!.wall).toBe(true);
  }, 120_000);

  it('the built district: no cordon / barricade faces and no wall coping in v2 — its last-resort ring stays undrawn', () => {
    const {w, L} = v2World();
    const faces = w.drawn!.faces as BuiltFace[];
    expect(faces.length).toBeGreaterThan(1000);
    expect(faces.filter(f => f.finish === 'surface-cordon').length).toBe(0);
    expect(faces.filter(f => f.finish === 'surface-barricade').length).toBe(0);
    // no drawn face stands in the ring (beyond the walkable edge)
    const e = L.surface!.boundary!.edge;
    const inRing = (x: number, z: number) => x < e.x0 - 1e-6 || x > e.x1 + 1e-6 || z < e.z0 - 1e-6 || z > e.z1 + 1e-6;
    expect(faces.filter(f => inRing((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2)).length).toBe(0);
    // the wall's coping (a cap at the wall's height along the playable rect's rim) is not built
    const plan = w.surfaceArch!.plan, r = plan.inner, h = LOOK_TUNE.cordonH;
    let rim = 0;
    for (const m of w.surfaceArch!.meshes) {
      if (m.userData.surfaceArch !== 'surface-coping') continue;
      const p = (m as THREE.Mesh).geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const nearRim = Math.min(Math.abs(x - r.x0), Math.abs(x - r.x1), Math.abs(z - r.z0), Math.abs(z - r.z1)) < 0.6;
        if (nearRim && Math.abs(y - (h + 0.18)) < 1e-3) rim++;
      }
    }
    expect(rim).toBe(0);
  }, 300_000);

  it('the daylight: the undrawn ring casts nothing in v2; the v1 wall still does', () => {
    const L = v2(93), plan = surfaceLookPlan(L)!, tops = obstructionTops(L, plan);
    let ring = 0;
    for (let i = 0; i < plan.owner.length; i++) if (plan.owner[i] === OWNER.cordon) { ring++; expect(tops[i]).toBe(0); }
    expect(ring).toBeGreaterThan(0);
    const L1 = lookFixture().layout, p1 = surfaceLookPlan(L1)!, t1 = obstructionTops(L1, p1);
    const k = p1.owner.findIndex(o => o === OWNER.cordon);
    expect(t1[k]).toBeCloseTo(LOOK_TUNE.cordonH + 0.2, 6);
  }, 120_000);
});

describe('surface fog look: the filler hides the finite edge', () => {
  const half = (entry: string, s: number) => 0.5 * Math.hypot(...((e => [e.dims[0], e.dims[2]])(SURFACE_KIT.find(k => k.id === entry)!))) * s;
  const outsideE = (r: SRect, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

  it('berms right outside the walkable edge on every side, collapsed blocks and the far city behind; none on the walkable ground; the same budget', () => {
    for (const seed of [93, 7, 12]) {
      const S = v2(seed).surface!, e = S.boundary!.edge, P = farCityPlan(S);
      expect(farCityRect(S)).toEqual({x0: e.x0 - FOG_BOUNDARY.band * CELL, z0: e.z0 - FOG_BOUNDARY.band * CELL, x1: e.x1 + FOG_BOUNDARY.band * CELL, z1: e.z1 + FOG_BOUNDARY.band * CELL});
      expect(P.tris).toBeLessThanOrEqual(FAR_CITY.berm.tris + FAR_CITY.collapsed.tris + FAR_CITY.far.tris);
      expect(P.stats.berm).toBeGreaterThan(40);
      expect(P.stats.collapsed).toBeGreaterThan(10);
      expect(P.stats.far).toBeGreaterThan(10);
      // every piece's footprint (its half diagonal at its scale: any yaw) clear of the walkable ground
      for (const q of P.placements) expect(outsideE(e, q.x, q.z) - half(q.entry, q.s), `seed ${seed} ${q.band} ${q.entry} at ${q.x.toFixed(1)}, ${q.z.toFixed(1)}`).toBeGreaterThanOrEqual(0);
      // the edge is backed on every side: berms whose near foot is within a few metres of it, spaced along the whole side
      for (const side of ['N', 'S', 'W', 'E'] as const) {
        const b = P.placements.filter(q => q.band === 'berm' && (side === 'N' ? q.z < e.z0 : side === 'S' ? q.z > e.z1 : side === 'W' ? q.x < e.x0 : q.x > e.x1));
        expect(b.length, `seed ${seed} side ${side}`).toBeGreaterThan(6);
        const near = Math.min(...b.map(q => outsideE(e, q.x, q.z) - half(q.entry, q.s)));
        expect(near, `seed ${seed} side ${side}: the nearest berm's foot`).toBeLessThan(FAR_CITY.berm.to);
      }
      // the v1 surroundings keep their own rect
      expect(farCityRect(lookFixture().layout.surface!)).toEqual(lookFixture().layout.surface!.extent);
    }
  }, 300_000);

  it('the ground ring meets the walkable edge (never a second ground under the apron)', () => {
    const L = v2(93), e = L.surface!.boundary!.edge;
    const v = buildSurfaceLookView(L, mats(), fakeModels())!;
    let ring: THREE.Mesh | null = null;
    v.root.traverse(o => { if (o.name === 'surface-ground-ring') ring = o as THREE.Mesh; });
    expect(ring).not.toBe(null);
    const g = ring!.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let t = 0; t < n; t += 3) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t + k) : t + k; cx += p.getX(i) / 3; cz += p.getZ(i) / 3; }
      expect(cx > e.x0 + 1e-3 && cx < e.x1 - 1e-3 && cz > e.z0 + 1e-3 && cz < e.z1 - 1e-3, `ring triangle at ${cx.toFixed(1)}, ${cz.toFixed(1)}`).toBe(false);
    }
    disposeSurfaceLookView(v);
  }, 300_000);
});

describe('surface fog look: sight lines from the drivable streets toward the edge end in fog', () => {
  /**
   * Along a level ray from (x, y, z) in direction (dx, dz) to the walkable edge: the pressure fog's optical depth — the march's near term
   * (its whole outdoor extinction on open ground: vis x ext x c x thickening) over its reach, then the far term (the EXCESS over the base
   * air) on to the edge — and the distance to the edge (Infinity past the camera's far plane: never drawn).
   */
  const toEdge = (L: StationLayout, x: number, y: number, z: number, dx: number, dz: number): {tau: number; d: number} => {
    const B = L.surface!.boundary!, e = B.edge, k = SURFACE_GAS_LOOK.vis * SURFACE_GAS_LOOK.ext, C = SURFACE_AIR.C;
    let tau = 0;
    for (let t = 0.25; t <= LOOK_SKY.far; t += 0.5) {
      const px = x + dx * t, pz = z + dz * t;
      if (px <= e.x0 || px >= e.x1 || pz <= e.z0 || pz >= e.z1) return {tau, d: t};
      const p = fogPressureAt(B, px, pz), full = fogConcentration(C, p, y) * fogThicken(p, y);
      tau += k * (t <= ATMOSPHERE.maxDistance ? full : t <= VF_FOG_FAR.maxDist ? Math.max(0, full - C) : 0) * 0.5;
    }
    return {tau, d: Infinity};
  };

  it('every street point in clear, sixteen directions, on foot and from the truck seat: under 2 % of the edge shows', () => {
    const seat = TRUCK_ANCHORS.eye.y; // (the seated driver's eye over the street)
    const rho = SURFACE_FOG.density; // the scene fog at a street eye (the base outdoor air beyond the march)
    for (const seed of [93, 7]) {
      const L = v2(seed), S = L.surface!, B = S.boundary!, c = B.clear;
      const pts: [number, number][] = [];
      for (const st of S.streets) for (const t of [0, 0.5, 1]) {
        const x = st.ax + (st.bx - st.ax) * t, z = st.az + (st.bz - st.az) * t;
        if (fogPressureAt(B, x, z) === 0) pts.push([x, z]);
      }
      // and the worst case: standing ON the clear line, looking straight out
      pts.push([c.x0, (c.z0 + c.z1) / 2], [c.x1, (c.z0 + c.z1) / 2], [(c.x0 + c.x1) / 2, c.z0], [(c.x0 + c.x1) / 2, c.z1]);
      expect(pts.length).toBeGreaterThan(100);
      let worst = 0, worstNear = 0, near = 0;
      for (const [x, z] of pts) for (let a = 0; a < 16; a++) for (const y of [1.6, seat]) {
        const ang = (a / 16) * Math.PI * 2, r = toEdge(L, x, y, z, Math.cos(ang), Math.sin(ang));
        if (!Number.isFinite(r.d)) continue;
        worst = Math.max(worst, Math.exp(-r.tau - (rho * r.d) ** 2));
        // where the base air alone would still show the edge (it stands close), the pressure fog alone hides it
        if (Math.exp(-((rho * r.d) ** 2)) > 0.02) { near++; worstNear = Math.max(worstNear, Math.exp(-r.tau)); }
      }
      expect(near, `seed ${seed}: rays to a near edge`).toBeGreaterThan(20);
      expect(worst, `seed ${seed}: the clearest view of the edge (pressure fog + scene fog)`).toBeLessThan(0.02);
      expect(worstNear, `seed ${seed}: the clearest near view (the pressure fog alone)`).toBeLessThan(0.02);
    }
  }, 300_000);
});
