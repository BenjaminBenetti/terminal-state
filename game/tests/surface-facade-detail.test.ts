// Task studio-surface-run-field-followup-20261116-211729-01 (lane FACADE; user: "Improve facades with the existing architectural assets /
// materials and coherent variety / detail, not blank box fronts"; "missing / see-through building faces"): the facade detail pass
// (world/surface/facadeDetail.ts) and the outdoor-lit finishes (lookSky.ts) —
//  - the far / rooftop models keep their authored face mode (the far city's ruins are double-sided: front-only showed the sky);
//  - the outdoor-lit facade (party walls over a lower roof) compiles with its tint attribute on both backends; every key the arch draws
//    has a material and a bullet-impact class;
//  - ROW REPAIR: no decorative opening is inverted any more (~600 a district were: the sheds' and garages' rows fell into the next
//    storey), a shed has its clerestory, a garage its open deck bays;
//  - CLOSED WINDOWS only on interior storeys and never over a live opening; awnings over glazed shop bays above head height; relief
//    never over an opening; the shaded finishes are real members of their tint family;
//  - the DRAW BUDGET: the detail adds at most a few draws per view and a few percent of the facade triangles;
//  - a reachable roof (v2 roofAccess: lane INTERIOR draws it) stays walkable with the detail drawn: nothing over its walk.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {buildBoth} from './helpers/tslShaders';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {SIDE_NORMAL, entranceFloor, surfaceLookPlan, topAt} from '../src/world/surface/archPlan';
import {AWNING_TINTS, EMPTY_FACADE_DETAIL, MIN_OPENING, facadeDetailMembers, shadeMemberKey} from '../src/world/surface/facadeDetail';
import {OUTFACADE} from '../src/world/surface/arch';
import {outdoorFacadeMaterial, outdoorModelMaterial} from '../src/world/surface/lookSky';
import {setSurfaceTexture, surfaceTintFamily, surfaceTintOf, type SurfaceTexSlot} from '../src/world/surface/archMaterials';
import {surfaceImpactClass} from '../src/world/surface/archStyles';
import {SURFACE_LOOK_MODEL_KEYS, surfaceQaPoses} from '../src/world/surface/look';
import {SURFACE_KIT} from '../src/world/reactor/surfaceKit';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES} from '../src/assets/companyAssets';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
/** A district of `host`: version 1 (the default the tests' hosts record) or the follow-up's version 2 (the fog-pressure boundary). */
const gen = (host: 'subway' | 'office' | 'mall', seed: number, v: 1 | 2 = 1): StationLayout => LEVELS[host].generate('surface', {levelSeed: seed, ...(v === 2 ? {surfaceVersion: 2} : {})});
const CASES = [['subway', 93, 1], ['office', 5, 1], ['mall', 11, 1], ['subway', 93, 2], ['mall', 11, 2]] as const;
const overlap = (a0: number, a1: number, b0: number, b1: number, m = 0) => a1 > b0 - m && a0 < b1 + m;

describe('Surface Run facades: the outdoor-lit finishes (lane FACADE)', () => {
  it("every far / rooftop model part keeps its authored face mode (double-sided ruins stay double-sided); the cache keys by it", async () => {
    const url = new Map<string, string>();
    for (const e of SURFACE_KIT) url.set(e.key, e.url);
    for (const [k, f] of Object.entries({...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES})) url.set(k, f.url);
    let parts = 0, dbl = 0;
    for (const k of SURFACE_LOOK_MODEL_KEYS) {
      if (!url.has(k)) continue;
      const g = await loadStripped(url.get(k)!);
      g.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.Material;
        for (const far of [true, false]) expect(outdoorModelMaterial(src, far).side, `${k} ${m.name}`).toBe(src.side);
        parts++;
        if (src.side === THREE.DoubleSide) dbl++;
      });
    }
    expect(parts).toBeGreaterThan(5);
    expect(dbl).toBeGreaterThan(0);
    const t = new THREE.Texture();
    const a = new THREE.MeshStandardMaterial({map: t, side: THREE.DoubleSide}), b = new THREE.MeshStandardMaterial({map: t, side: THREE.FrontSide});
    expect(outdoorModelMaterial(a, true)).not.toBe(outdoorModelMaterial(b, true));
    expect(outdoorModelMaterial(a, true)).toBe(outdoorModelMaterial(a.clone(), true));
    expect([outdoorModelMaterial(a, true).side, outdoorModelMaterial(b, true).side]).toEqual([THREE.DoubleSide, THREE.FrontSide]);
  }, 120_000);

  it('the outdoor-lit facade builds clean on both backends with its tint attribute (with and without its texture); cached per kind and map', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(0.8), 3));
    const map = new THREE.Texture();
    for (const [kind, m] of [['brick', map], ['concrete', map], ['rusted', map], ['flat', null]] as const) {
      const mat = outdoorFacadeMaterial(kind, m);
      expect(mat.name).toBe(`${OUTFACADE}${kind}`);
      expect(outdoorFacadeMaterial(kind, m)).toBe(mat);
      for (const sh of buildBoth(new THREE.Mesh(geo, mat))) {
        expect(sh.errors, `${kind} ${sh.backend}`).toEqual([]);
        expect(sh.fragment.length).toBeGreaterThan(100);
      }
      expect(surfaceImpactClass(`${OUTFACADE}${kind}`), kind).not.toBeNull();
    }
    geo.dispose();
  });
});

describe('Surface Run facades: the detail plan (lane FACADE)', () => {
  for (const [host, seed, v] of CASES) {
    it(`${host} district ${seed} (v${v}): no inverted opening; sheds and garages open; closed windows, awnings and relief where they belong`, () => {
      const layout = gen(host, seed, v), plan = surfaceLookPlan(layout)!;
      expect(plan.wall).toBe(v === 1);
      let blinds = 0, awnings = 0, piers = 0, plinths = 0, columns = 0, clerestory = 0, bays = 0;
      for (const bl of plan.buildings) {
        const d = bl.detail;
        const inInterior = (y0: number, y1: number) => bl.interiors.some(([a, c]) => y1 > a + 0.05 && y0 < c - 0.05);
        for (const h of bl.holes) if (h.kind !== 'air' && h.kind !== 'door-boarded') expect(h.y1 - h.y0, `b${bl.id} ${h.kind} ${h.side}`).toBeGreaterThanOrEqual(MIN_OPENING);
        if (bl.b.kind === 'parking') bays += bl.holes.filter(h => h.kind === 'dark').length;
        else if (bl.style.windows === 'high') clerestory += bl.holes.filter(h => h.kind !== 'air' && h.kind !== 'shutter' && h.kind !== 'door-boarded').length;
        const sideOf = (s: string) => bl.sides.find(q => q.side === s)!;
        for (const w of d.blinds) {
          blinds++;
          const sd = sideOf(w.side);
          expect(sd.open).toBe(true);
          expect(w.s0).toBeGreaterThanOrEqual(sd.s0 + 0.5 - 1e-6);
          expect(w.s1).toBeLessThanOrEqual(sd.s1 - 0.5 + 1e-6);
          expect(w.y1).toBeLessThanOrEqual(Math.min(topAt(sd, w.s0, bl.top), topAt(sd, w.s1, bl.top)) - 0.35 + 1e-6);
          if (w.kind === 'door') expect([bl.style.wall, w.storey]).toEqual(['metal', 0]);
          else expect(inInterior(w.y0, w.y1), `b${bl.id} closed window off an interior storey`).toBe(true);
          if (w.kind === 'panel') expect(bl.style.windows).toBe('curtain');
          for (const h of bl.holes) if (h.side === w.side) expect(overlap(w.s0, w.s1, h.s0, h.s1) && overlap(w.y0, w.y1, h.y0, h.y1), `b${bl.id} closed window over a ${h.kind}`).toBe(false);
          for (const e of bl.b.entrances) if (e.side === w.side) {
            const c = SIDE_NORMAL[e.side].alongX ? e.x : e.z, f = entranceFloor(layout, e);
            expect(overlap(w.s0, w.s1, c - e.width / 2, c + e.width / 2) && overlap(w.y0, w.y1, f, f + e.height)).toBe(false);
          }
        }
        for (const a of d.awnings) {
          awnings++;
          const sd = sideOf(a.side), base0 = bl.storeyY[0];
          expect(bl.holes.some(h => h.side === a.side && h.kind === 'shop' && h.storey === 0 && Math.abs(h.s0 - 0.12 - a.s0) < 1e-6)).toBe(true);
          expect(a.y - a.drop).toBeGreaterThanOrEqual(base0 + 2.25 - 1e-6);
          expect(a.y + 0.2).toBeLessThanOrEqual(topAt(sd, (a.s0 + a.s1) / 2, bl.top) + 1e-6);
          expect(AWNING_TINTS.map(t => `surface-facade-canvas-${t.toString(16).padStart(6, '0')}`)).toContain(a.key);
          expect(bl.b.condition === 'gutted' || bl.b.condition === 'collapsed').toBe(false);
        }
        for (const r of d.relief) {
          if (r.kind === 'pier') piers++; else if (r.kind === 'plinth') plinths++; else columns++;
          if (r.kind === 'column') expect(bl.style.wall).toBe('metal');
          else expect(['brick', 'stucco', 'stone', 'concrete']).toContain(bl.style.wall);
          expect(r.y1).toBeGreaterThan(r.y0);
          const sd = sideOf(r.side);
          expect(r.s0).toBeGreaterThanOrEqual(sd.s0 - 1e-6);
          expect(r.s1).toBeLessThanOrEqual(sd.s1 + 1e-6);
          // never across an opening or a doorway
          for (const h of bl.holes) if (h.side === r.side) expect(overlap(r.s0, r.s1, h.s0, h.s1) && overlap(r.y0, r.y1, h.y0, h.y1), `b${bl.id} ${r.kind} over a ${h.kind}`).toBe(false);
          for (const e of bl.b.entrances) if (e.side === r.side) {
            const c = SIDE_NORMAL[e.side].alongX ? e.x : e.z;
            expect(overlap(r.s0, r.s1, c - e.width / 2, c + e.width / 2)).toBe(false);
          }
        }
        // the shaded finishes: darker members of the facade's own tint family
        for (const k of facadeDetailMembers(d)) expect(surfaceTintFamily(k), k).not.toBeNull();
      }
      expect(clerestory).toBeGreaterThan(30);
      expect(bays).toBeGreaterThan(30);
      expect(blinds).toBeGreaterThan(20);
      expect(awnings).toBeGreaterThan(10);
      expect([piers, plinths, columns].every(v => v > 50)).toBe(true);
      // deterministic: a fresh layout of the same seed plans the same detail
      const again = surfaceLookPlan(gen(host, seed, v))!;
      expect(again.buildings.map(b => [b.holes.length, b.detail.blinds, b.detail.awnings, b.detail.relief])).toEqual(plan.buildings.map(b => [b.holes.length, b.detail.blinds, b.detail.awnings, b.detail.relief]));
    });
  }

  it('shadeMemberKey: a darker member of the same family (its colour scaled in linear light, with the district textures loaded); stucco / trims have none', () => {
    const slots: SurfaceTexSlot[] = ['concrete:color', 'rusted:color', 'brick'];
    try {
      for (const sl of slots) setSurfaceTexture(sl, new THREE.Texture({width: 4, height: 4} as unknown as HTMLImageElement));
      const m = mats();
      for (const key of ['surface-facade-brick-d8c2b4', 'surface-facade-concrete-e2e0da', 'surface-facade-stone-ece2d0', 'surface-facade-metal-b5c4ba', 'surface-facade-curtain-4a5258']) {
        const k = shadeMemberKey(key, 0.62)!;
        expect(surfaceTintFamily(k)).toBe(surfaceTintFamily(key));
        const a = surfaceTintOf(m, key)!, b = surfaceTintOf(m, k)!;
        for (const c of ['r', 'g', 'b'] as const) expect(b[c] / Math.max(a[c], 1e-4), `${key} ${c}`).toBeCloseTo(0.62, 1);
      }
    } finally { for (const sl of slots) setSurfaceTexture(sl, null); }
    expect(shadeMemberKey('surface-facade-stucco-d6c8a8', 0.6)).toBeNull();
    expect(shadeMemberKey('surface-trim-2f2b27', 0.6)).toBeNull();
  });
});

describe('Surface Run facades: built (lane FACADE)', () => {
  /** The arch's own meshes in view of a pose (frustum within the fog's cull distance): draws and triangles. */
  const inView = (w: BuiltWorld, layout: StationLayout) => {
    const out: {draws: number; tris: number}[] = [];
    w.group.updateMatrixWorld(true);
    const arch = w.surfaceArch!.meshes;
    for (const p of surfaceQaPoses(layout)) {
      const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 300);
      const y = (layout.levels?.[p.level]?.baseY ?? 0) + 1.7;
      cam.position.set(p.x, y, p.z);
      cam.lookAt(p.look.x, p.look.y, p.look.z);
      cam.updateMatrixWorld(true);
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let draws = 0, tris = 0;
      for (const m of arch) {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const s = m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
        if (!fr.intersectsSphere(s)) continue;
        draws++;
        tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
      }
      out.push({draws, tris});
    }
    return out;
  };

  for (const v of [1, 2] as const) it(`the draw budget (subway 93, v${v}): the detail adds at most 3 draws in any QA view and under 4 % of the district's triangles; every drawn key has a material and an impact class`, () => {
    const layout = gen('subway', 93, v), A = buildWorld(layout, mats(), {});
    const bare = gen('subway', 93, v), plan = surfaceLookPlan(bare)!;
    for (const bl of plan.buildings) bl.detail = EMPTY_FACADE_DETAIL;
    const B = buildWorld(bare, mats(), {});
    const sa = A.surfaceArch!.stats, sb = B.surfaceArch!.stats;
    expect(sa.blinds + sa.awnings + sa.relief).toBeGreaterThan(1000);
    expect(sb.blinds + sb.awnings + sb.relief).toBe(0);
    // the detail joins the meshes already standing near it (arch.ts detailSink): one mesh more, the district-wide awning canvas
    expect(sa.meshes - sb.meshes).toBeLessThanOrEqual(2);
    // triangles: under 4 % of the district's built architecture (~0.6 M; the district view budget is ~1.8 M with its models)
    const tris = (w: BuiltWorld) => { let t = 0; w.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) t += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; }); return t; };
    const ta = tris(A), tb = tris(B);
    expect(ta - tb).toBeGreaterThan(5_000);
    console.log(`facade detail v${v}: ${sa.meshes - sb.meshes} meshes, +${ta - tb} tris on ${tb} (${(100 * (ta - tb) / tb).toFixed(2)} %)`);
    expect((ta - tb) / tb).toBeLessThan(0.04);
    const va = inView(A, layout), vb = inView(B, bare);
    expect(va.length).toBeGreaterThan(3);
    va.forEach((v, i) => expect(v.draws - vb[i].draws, `view ${i}`).toBeLessThanOrEqual(3));
    for (const m of A.surfaceArch!.meshes) {
      // (the part meshes carry their key; the tent's own meshes their material's)
      const key = String(m.userData.surfaceArch ?? (m.material as THREE.Material).userData?.surfaceArch ?? '');
      expect(m.material, m.name).toBeTruthy();
      expect(key, m.name).not.toBe('');
      if (key === 'surface-sign' || key === 'surface-void') continue; // (no surface of their own: as surface-look-arch.test.ts)
      expect(surfaceImpactClass(key), key).not.toBeNull();
    }
  }, 240_000);

  it("a reachable roof (v2 roofAccess, lane INTERIOR's) stays walkable with the detail drawn: nothing of the facade over its walk, no look-only clutter on it", () => {
    const layout = gen('subway', 93, 2), plan = surfaceLookPlan(layout)!;
    const roofs = plan.buildings.filter(bl => bl.b.roofAccess);
    expect(roofs.length).toBeGreaterThan(0);
    const w = buildWorld(layout, mats(), {});
    w.group.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    let over = 0, walkTris = 0;
    for (const bl of roofs) {
      const ra = bl.b.roofAccess!, W = ra.walk, B = ra.bulkhead;
      const inWalk = (x: number, z: number) => x > W.x0 + 0.05 && x < W.x1 - 0.05 && z > W.z0 + 0.05 && z < W.z1 - 0.05 && !(x > B.x0 - 0.05 && x < B.x1 + 0.05 && z > B.z0 - 0.05 && z < B.z1 + 0.05);
      // the detail stands on the side walls, outside the footprint: nothing of it reaches over the walk
      for (const r of [...bl.detail.relief, ...bl.detail.blinds, ...bl.detail.awnings]) expect(bl.sides.some(sd => sd.side === r.side), `b${bl.id}`).toBe(true);
      expect(plan.placements.some(p => inWalk(p.x, p.z)), `b${bl.id}: look-only clutter on the walk`).toBe(false);
      // no horizontal arch triangle over the walk within head room (the walk itself is the builder's floor, at ra.y)
      for (const m of w.surfaceArch!.meshes) {
        const pos = m.geometry.attributes.position, idx = m.geometry.index;
        const n = idx ? idx.count : pos.count;
        for (let t = 0; t < n; t += 3) {
          const p = [0, 1, 2].map(j => v.fromBufferAttribute(pos, idx ? idx.getX(t + j) : t + j).applyMatrix4(m.matrixWorld).clone());
          if (Math.abs(p[0].y - p[1].y) > 1e-4 || Math.abs(p[0].y - p[2].y) > 1e-4) continue;
          const cx = (p[0].x + p[1].x + p[2].x) / 3, cz = (p[0].z + p[1].z + p[2].z) / 3;
          if (!inWalk(cx, cz)) continue;
          if (Math.abs(p[0].y - ra.y) < 0.02) walkTris++;
          else if (p[0].y > ra.y + 0.02 && p[0].y < ra.y + 2.1) over++;
        }
      }
    }
    expect(over).toBe(0);
    expect(walkTris).toBe(0); // (the walk's floor is the builder's, not a LOOK deck over it: no z-fight)
  }, 240_000);
});
