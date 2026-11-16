// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK, follow-up 2: the district's per-frame draws): the Surface Run
// district's see-through structure for the level culler (world/surface/lookOcclusion.ts: every column the culler may treat as an
// opaque wall either IS drawn opaque over the range or is passed as a see rect) and the look's per-instance culling
// (world/surface/look.ts: roofPieceHidden / cullSurfaceInstances; world/surface/lookOccluders.ts: the facade strips' conservative
// occlusion buffer) — conservative by construction: a piece is hidden only where a drawn facade really stands between it and the eye
// (checked against the built world's geometry by ray casts), the drawn instances are packed to the front of the buffer, and nothing
// changes off a district.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {lookFixture, plainLayout} from './helpers/surfaceLookFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {OCCL_TOP} from '../src/world/levelCulling';
import {GROUND, OWNER, SIDE_NORMAL, entranceFloor, surfaceLookPlan} from '../src/world/surface/archPlan';
import {surfaceOcclusionSee} from '../src/world/surface/lookOcclusion';
import {LookOcclusion, closedShell, facadeStrips, streetSide, type FacadeStrip} from '../src/world/surface/lookOccluders';
import {
  BOX, LOOK_HIDDEN_MASK, buildSurfaceLookView, cullSurfaceInstances, disposeSurfaceLookView, lookInstSet, lookShown, resetSurfaceInstances, roofPieceHidden, roofWalls,
  type RoofWalls, type SurfaceLookView,
} from '../src/world/surface/look';

installCanvasShim(false);

const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

/** A stand-in GLB per key (a box with a standard material). */
const fakeModels = (): ((key: string) => GLTF | undefined) => {
  const cache = new Map<string, GLTF>();
  return key => {
    let g = cache.get(key);
    if (!g) {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2.3, 2).translate(0, 1.15, 0), new THREE.MeshStandardMaterial({color: 0x887766})));
      g = {scene, scenes: [scene], animations: [], cameras: [], asset: {}, parser: null, userData: {}} as unknown as GLTF;
      cache.set(key, g);
    }
    return g;
  };
};

/** A mulberry32 stream. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('Surface Run district occlusion: the see-through structure', () => {
  it('nothing off a district', () => {
    expect(surfaceOcclusionSee(plainLayout())).toEqual([]);
  });

  it('the cordon and every non-building SOLID open on every height; low roof lines open from their top; AIR spans and boarded doorways open', () => {
    const layout = lookFixture().layout, S = layout.surface!, plan = surfaceLookPlan(layout)!, g = layout.grid;
    const see = surfaceOcclusionSee(layout);
    const inside = (x: number, z: number, y: number | null) => see.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && (y === null ? r.y0 === undefined && r.y1 === undefined : (r.y0 ?? -Infinity) <= y && y <= (r.y1 ?? Infinity)));
    let cordon = 0;
    for (let cz = 0; cz < g.h; cz++) for (let cx = 0; cx < g.w; cx++) {
      const i = cz * g.w + cx;
      if (g.cells[i] !== SOLID || plan.owner[i] >= 0) continue;
      cordon++;
      expect(inside((cx + 0.5) * CELL, (cz + 0.5) * CELL, null), `non-building SOLID ${cx},${cz}`).toBe(true);
    }
    expect(cordon).toBeGreaterThan(100);
    // buildings: a footprint rect from the lowest outer wall top when that is under the top storey's occlusion range, none otherwise
    const topHi = Math.max(0, ...(layout.levels ?? []).map(l => l.baseY)) + OCCL_TOP;
    let low = 0, high = 0;
    for (const bl of plan.buildings) {
      const f = bl.b.footprint, minTop = Math.min(...bl.sides.flatMap(sd => sd.tops.map(t => t.top)));
      const rect = see.find(r => r.x0 === f.x0 && r.z0 === f.z0 && r.x1 === f.x1 && r.z1 === f.z1);
      if (!bl.sides.length) { expect(rect && rect.y0 === undefined, `tent ${bl.id}`).toBe(true); continue; }
      if (minTop < topHi) { low++; expect(rect?.y0, `building ${bl.id}`).toBe(minTop); } else { high++; expect(rect, `building ${bl.id}`).toBeUndefined(); }
    }
    expect(low + high).toBe(plan.buildings.filter(b => b.sides.length).length);
    expect(high).toBeGreaterThan(0);
    // AIR's spans over sill .. head
    const base = (lv: number) => layout.levels?.[lv]?.baseY ?? 0;
    for (const w of S.windows) expect(see.some(r => r.x0 === w.x0 && r.z1 === w.z1 && r.y0 === base(w.level) + w.sill && r.y1 === base(w.level) + w.head), w.id).toBe(true);
    // boarded doorways: the doorway's wall cell, mid-height
    for (const b of S.buildings) for (const e of b.entrances) {
      if (e.door !== 'boarded') continue;
      const {alongX, n} = SIDE_NORMAL[e.side], fp = b.footprint;
      const plane = e.side === 'N' ? fp.z0 : e.side === 'S' ? fp.z1 : e.side === 'W' ? fp.x0 : fp.x1;
      const x = alongX ? e.x : plane - n * CELL / 2, z = alongX ? plane - n * CELL / 2 : e.z;
      expect(inside(x, z, base(e.level) + e.height / 2), `boarded ${b.id}`).toBe(true);
    }
  });
});

describe('Surface Run look: a roof piece behind its own walls', () => {
  const W = (top: [number, number, number, number]): RoofWalls => ({fp: {x0: 0, z0: 0, x1: 20, z1: 20}, x0: 0.5, z0: 0.5, x1: 19.5, z1: 19.5, top});
  const walls = W([13, 13, 13, 13]);

  it('hidden from the street below, shown from afar, from inside the footprint, over a party wall, or poking out of the inset', () => {
    // a 2 m plant box mid-roof, its top 2 m over the 12 m deck (the parapet tops 13 m)
    expect(roofPieceHidden(walls, 9, 9, 11, 11, 14, 10, 1.6, -5)).toBe(true);
    expect(roofPieceHidden(walls, 9, 9, 11, 11, 14, 10, 1.6, -300)).toBe(false); // the top peeks over the parapet
    expect(roofPieceHidden(walls, 9, 9, 11, 11, 14, 10, 1.6, 10)).toBe(false); // eye inside the footprint
    expect(roofPieceHidden(walls, 9, 9, 11, 11, 14, 10, 1.6, 20.02)).toBe(false); // eye on the face (a doorway)
    expect(roofPieceHidden(W([-Infinity, 13, 13, 13]), 9, 9, 11, 11, 14, 10, 1.6, -5)).toBe(false); // north side: no street facade
    expect(roofPieceHidden(walls, 0.2, 9, 2, 11, 14, 10, 1.6, -5)).toBe(false); // outside the inset footprint
    expect(roofPieceHidden(walls, 9, 9, 11, 11, 14, 10, 30, -5)).toBe(false); // eye above the roof
    // diagonal: the line leaves through the corner region (min of both sides)
    expect(roofPieceHidden(W([13, 13, 11, 13]), 1, 1, 3, 3, 14, -3, 1.6, -3)).toBe(false);
    expect(roofPieceHidden(W([13, 13, 13, 13]), 1, 1, 3, 3, 13.5, -3, 1.6, -3)).toBe(true);
  });

  it('conservative against an independent march: every point of a hidden box top sees a wall below its top', () => {
    const r = rng(7);
    let hidden = 0, tested = 0;
    for (let k = 0; k < 4000; k++) {
      const tops = [0, 1, 2, 3].map(() => (r() < 0.12 ? -Infinity : 12.3 + r() * 1.5)) as RoofWalls['top'];
      const w = W(tops);
      const bx = 0.5 + r() * 15, bz = 0.5 + r() * 15, bw = 0.5 + r() * 4, bd = 0.5 + r() * 4, q = 12.2 + r() * 4;
      const ang = r() * Math.PI * 2, dist = 10.5 + r() * 120, ey = r() < 0.8 ? 1.6 : 6.8;
      const ex = 10 + Math.cos(ang) * dist, ez = 10 + Math.sin(ang) * dist;
      const x1 = Math.min(19.5, bx + bw), z1 = Math.min(19.5, bz + bd);
      tested++;
      if (!roofPieceHidden(w, bx, bz, x1, z1, q, ex, ey, ez)) continue;
      hidden++;
      for (let a = 0; a <= 12; a++) for (let b = 0; b <= 12; b++) {
        const px = bx + (x1 - bx) * a / 12, pz = bz + (z1 - bz) * b / 12;
        // march from the point to the eye: the first step outside the inset rect, the side(s) it crossed
        let t = 0, side: number[] = [];
        for (let s = 1; s <= 20000; s++) {
          t = s / 20000;
          const x = px + (ex - px) * t, z = pz + (ez - pz) * t;
          side = [];
          if (z < w.z0) side.push(0); if (z > w.z1) side.push(1); if (x < w.x0) side.push(2); if (x > w.x1) side.push(3);
          if (side.length) break;
        }
        const h = q + (ey - q) * (t - 1 / 20000), top = Math.min(...side.map(i => w.top[i]));
        expect(h, `box ${bx.toFixed(2)},${bz.toFixed(2)} eye ${ex.toFixed(1)},${ey},${ez.toFixed(1)} point ${px.toFixed(2)},${pz.toFixed(2)}`).toBeLessThan(top);
      }
    }
    expect(tested).toBe(4000);
    expect(hidden).toBeGreaterThan(300);
  });
});

describe('Surface Run look: per-instance culling', () => {
  const view = (sets: SurfaceLookView['inst'], walls: RoofWalls[] = [], strips: FacadeStrip[] = []) => ({inst: sets, walls, strips}) as unknown as SurfaceLookView;
  const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

  it('frustum, fog depth and own walls decide each instance; the drawn ones packed to the front; a tile keeps its distance rule', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshBasicMaterial();
    const list = [at(0, 1, -20), at(0, 1, 20), at(0, 1, -400), at(0, 12, -40)];
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    // the 4th stands on a roof: a 20 x 20 footprint round it, its parapet at 13 m
    const walls: RoofWalls = {fp: {x0: -10, z0: -50, x1: 10, z1: -30}, x0: -9.5, z0: -49.5, x1: 9.5, z1: -30.5, top: [13, 13, 13, 13]};
    const set = lookInstSet(im, list, [-1, -1, -1, 0], null);
    const v = view([set], [walls]);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 500);
    cam.position.set(0, 1.6, 0);
    cam.updateMatrixWorld();
    const got = (): number[] => Array.from({length: im.count}, (_, j) => { const m = new THREE.Matrix4(); im.getMatrixAt(j, m); return m.elements[14]; });
    expect(cullSurfaceInstances(v, cam, 293)).toEqual({shown: 1, total: 4});
    expect([lookShown(im), got()]).toEqual([true, [-20]]);
    // the eye well over the roof (at 14 m its sight line still meets the parapet): the roof piece shows
    cam.position.set(0, 20, 0);
    cam.lookAt(0, 6, -30);
    cam.updateMatrixWorld();
    cullSurfaceInstances(v, cam, 293);
    expect(got()).toEqual([-20, -40]);
    // turned round: only the one behind before
    cam.position.set(0, 1.6, 0);
    cam.rotation.set(0, Math.PI, 0);
    cam.updateMatrixWorld();
    cullSurfaceInstances(v, cam, 293);
    expect(got()).toEqual([20]);
    // a fog distance past the far one (turned back): it shows
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld();
    cullSurfaceInstances(v, cam, 450);
    expect(got()).toEqual([-20, -400]);
    // looking straight up: nothing drawn, the piece hidden
    cam.rotation.set(Math.PI / 2, 0, 0);
    cam.updateMatrixWorld();
    expect(cullSurfaceInstances(v, cam, 293).shown).toBe(0);
    // (render only: the culler's hidden layer; `visible` stays — the traced flashlight scene keeps the piece)
    expect([lookShown(im), im.layers.mask, im.visible]).toEqual([false, LOOK_HIDDEN_MASK, true]);
    // reset: the full list back in build order, on its own layers
    resetSurfaceInstances(v);
    expect([lookShown(im), im.layers.mask, im.count, got()]).toEqual([true, 1, 4, [-20, 20, -400, -40]]);
    // a tile beyond its draw distance: hidden whole, as the former per-tile rule did
    const far = lookInstSet(im, list, null, {x: 0, z: -900, r: 90, near: 170});
    cam.rotation.set(0, 0, 0);
    cam.updateMatrixWorld();
    expect(cullSurfaceInstances(view([far]), cam, 293).shown).toBe(0);
    expect([lookShown(im), im.visible]).toEqual([false, true]);
  });

  it('the facade occlusion buffer: a box wholly behind a strip is hidden; above it, in front of it, or the strip seen from behind: shown', () => {
    // a 20 m wide strip 2..12 m high on the plane z = -30, facing +z (towards the eye)
    const strip: FacadeStrip = {alongX: true, plane: -30, n: 1, s0: -10, s1: 10, y0: 2, y1: 12};
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 500);
    cam.position.set(0, 1.6, 0);
    cam.lookAt(0, 5, -30);
    cam.updateMatrixWorld();
    const oc = new LookOcclusion();
    oc.build(cam, [strip], 293);
    expect(oc.stats.drawn).toBe(1);
    expect(oc.boxHidden(-1, 6, -45, 1, 8, -43)).toBe(true); // behind the strip, inside its shadow
    expect(oc.boxHidden(-1, 6, -45, 1, 30, -43)).toBe(false); // rises over its top
    expect(oc.boxHidden(-1, 6, -25, 1, 8, -23)).toBe(false); // in front of it
    expect(oc.boxHidden(-1, 0, -45, 1, 1, -43)).toBe(false); // under it (seen below its bottom)
    expect(oc.boxHidden(15, 6, -45, 17, 8, -43)).toBe(false); // beside it
    // seen from behind the plane: not drawn, nothing hidden
    cam.position.set(0, 1.6, -60);
    cam.lookAt(0, 5, -100);
    cam.updateMatrixWorld();
    oc.build(cam, [strip], 293);
    expect(oc.stats.drawn).toBe(0);
    // beyond the fog distance: not drawn
    cam.position.set(0, 1.6, 400);
    cam.lookAt(0, 5, -30);
    cam.updateMatrixWorld();
    oc.build(cam, [strip], 293);
    expect(oc.stats.drawn).toBe(0);
    // through cullSurfaceInstances: the box behind the strip drops out, the one over it stays
    const geo = new THREE.BoxGeometry(2, 2, 2), list = [new THREE.Matrix4().makeTranslation(0, 7, -44), new THREE.Matrix4().makeTranslation(0, 20, -44)];
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 2);
    const set = lookInstSet(im, list, null, null);
    cam.position.set(0, 1.6, 0);
    cam.lookAt(0, 5, -30);
    cam.updateMatrixWorld();
    expect(cullSurfaceInstances(view([set], [], [strip]), cam, 293, oc).shown).toBe(1);
    const m = new THREE.Matrix4();
    im.getMatrixAt(0, m);
    expect(m.elements[13]).toBe(20);
  });

  it('the facade strips: street sides of closed shells only, never across a live opening, under the lowest top', () => {
    const layout = lookFixture().layout, plan = surfaceLookPlan(layout)!;
    const strips = facadeStrips(layout, plan);
    expect(strips.length).toBeGreaterThan(40);
    expect(facadeStrips(plainLayout(), surfaceLookPlan(plainLayout()))).toEqual([]);
    for (const st of strips) {
      const bl = plan.buildings.find(b => b.sides.some(sd => sd.plane === st.plane && sd.alongX === st.alongX && sd.n === st.n && st.s0 >= sd.s0 && st.s1 <= sd.s1))!;
      expect(bl && closedShell(bl), `strip on ${st.plane}`).toBe(true);
      const sd = bl.sides.find(q => q.plane === st.plane && q.alongX === st.alongX && q.n === st.n)!;
      expect(streetSide(layout, plan, sd)).toBe(true);
      expect(st.y1).toBeLessThanOrEqual(Math.min(...sd.tops.map(t => t.top)));
      for (const h of bl.holes) if (h.side === sd.side && (h.kind === 'air' || h.kind === 'door-boarded')) expect(st.y1 <= h.y0 || st.y0 >= h.y1, `${bl.id} ${h.kind}`).toBe(true);
      for (const e of bl.b.entrances) if (e.side === sd.side) { const f = entranceFloor(layout, e); expect(st.y0 >= f + e.height || st.y1 <= f, `${bl.id} doorway`).toBe(true); }
    }
  });

  it("the district: every roof instance knows its walls, and nothing culled is visible in the built world's geometry", () => {
    const m = mats(), layout = lookFixture().layout, plan = surfaceLookPlan(layout)!, g = layout.grid;
    const v = buildSurfaceLookView(layout, m, fakeModels())!;
    const roof = v.inst.filter(s => s.tile);
    expect(roof.length).toBeGreaterThan(0);
    for (const s of roof) expect(Array.from(s.walls).every(w => w >= 0), s.im.name).toBe(true);
    expect(v.inst.filter(s => !s.tile).length).toBe(v.stats.farMeshes);
    expect(v.walls.some(w => w.top.every(t => t > 0))).toBe(true);
    for (let k = 0; k < plan.buildings.length; k++) for (const t of roofWalls(layout, plan, k).top) expect(Number.isNaN(t)).toBe(false);
    // the built world's opaque structure (props / loose items excluded: they move)
    const world = buildWorld(layout, m, {});
    world.group.updateMatrixWorld(true);
    const blockers: {mesh: THREE.Mesh; box: THREE.Box3}[] = [];
    world.group.traverse(o => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh || (mm as THREE.InstancedMesh).isInstancedMesh || /^(prop-|container|shelf|pickup|light-glow|openable|loot)/.test(mm.name)) return;
      const mt = (Array.isArray(mm.material) ? mm.material[0] : mm.material) as THREE.Material;
      if (!mt || mt.transparent || mt.opacity < 1 || /glass/.test(mt.name)) return;
      blockers.push({mesh: mm, box: new THREE.Box3().setFromObject(mm)});
    });
    expect(blockers.length).toBeGreaterThan(50);
    // street eyes (open street cells, deterministic picks) looking along a few headings
    const street: number[] = [];
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && plan.owner[i] === OWNER.none && (plan.ground[i] === GROUND.road || plan.ground[i] === GROUND.walk)) street.push(i);
    const r = rng(11), rc = new THREE.Raycaster(), dir = new THREE.Vector3(), p = new THREE.Vector3(), oc = new LookOcclusion();
    rc.layers.enableAll();
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 320);
    const fr = new THREE.Frustum(), sp = new THREE.Sphere();
    let culled = 0, rays = 0, walled = 0;
    const failures: string[] = [];
    for (let e = 0; e < 6; e++) {
      const i = street[Math.floor(r() * street.length)];
      for (const yaw of [r() * Math.PI * 2, r() * Math.PI * 2]) {
        cam.position.set((i % g.w + 0.5) * CELL, 1.6, (Math.floor(i / g.w) + 0.5) * CELL);
        cam.rotation.set(0.12, yaw, 0, 'YXZ');
        cam.updateMatrixWorld();
        resetSurfaceInstances(v);
        cullSurfaceInstances(v, cam, 293, oc);
        fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        // the culled instances the frustum / fog / tile rules alone would draw
        const cand: {s: typeof v.inst[number]; j: number; d: number}[] = [];
        for (const s of v.inst) {
          const t = s.tile;
          if (t && Math.hypot(t.x - cam.position.x, t.z - cam.position.z) - t.r >= t.near) continue;
          const shown = new Set(Array.from(s.shownIdx.subarray(0, s.shown)));
          for (let j = 0; j < s.n; j++) {
            if (shown.has(j)) continue;
            sp.center.set(s.sph[4 * j], s.sph[4 * j + 1], s.sph[4 * j + 2]); sp.radius = s.sph[4 * j + 3];
            if (!fr.intersectsSphere(sp) || sp.center.distanceTo(cam.position) - sp.radius > 293) continue;
            const b = s.top, o = BOX * j;
            if (s.walls[j] >= 0 && roofPieceHidden(v.walls[s.walls[j]], b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], cam.position.x, cam.position.y, cam.position.z)) walled++;
            cand.push({s, j, d: sp.center.distanceTo(cam.position)});
          }
        }
        culled += cand.length;
        cand.sort((a, b) => a.d - b.d);
        const pick = [...cand.slice(0, 6), ...cand.slice(6).filter(() => r() < 0.05).slice(0, 4)];
        for (const {s, j} of pick) {
          const b = s.top, o = BOX * j, lx = (b[o + 2] - b[o]) * 0.02, lz = (b[o + 3] - b[o + 1]) * 0.02, ly = (b[o + 4] - b[o + 5]) * 0.02;
          const xs = [b[o] + lx, b[o + 2] - lx], ys = [b[o + 5] + ly, b[o + 4] - ly], zs = [b[o + 1] + lz, b[o + 3] - lz];
          const pts = [...xs.flatMap(x => ys.flatMap(y => zs.map(z => [x, y, z]))), [(xs[0] + xs[1]) / 2, ys[1], (zs[0] + zs[1]) / 2]];
          for (const [x, y, z] of pts) {
            p.set(x, y, z);
            const len = p.distanceTo(cam.position);
            dir.subVectors(p, cam.position).normalize();
            rc.set(cam.position, dir);
            rc.far = len - 0.02;
            const objs = blockers.filter(q => rc.ray.intersectsBox(q.box)).map(q => q.mesh);
            rays++;
            if (!rc.intersectObjects(objs, false).length) failures.push(`${s.im.name}#${j} from ${cam.position.toArray().map(c => c.toFixed(1))} to ${[x, y, z].map(c => c.toFixed(2))}`);
          }
        }
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
    expect(rays).toBeGreaterThan(100);
    expect(culled).toBeGreaterThan(20);
    expect(walled).toBeGreaterThan(0);
    disposeSurfaceLookView(v);
  }, 600000);
});
