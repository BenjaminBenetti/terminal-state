// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LOOK): the Surface Run district's ARCHITECTURE on the real build path
// (world/builder.ts + world/surface/arch*.ts) — a shell for every building, AIR's live window spans cut and framed but never glazed,
// every facade style drawn, the cordon closed, the tent's flap seam, finish keys with materials and impact classes, and nothing of it
// anywhere outside a district layout.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {buildBoth} from './helpers/tslShaders';
import {lookFixture, plainLayout} from './helpers/surfaceLookFixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import type {BuiltFace} from '../src/world/levelGeometry';
import {SurfaceArch, coarsenSurfaceArch, cutFace} from '../src/world/surface/arch';
import {facadeDetailMembers} from '../src/world/surface/facadeDetail';
import {LOOK_TUNE, SIDE_NORMAL, entranceFloor, surfaceLookPlan, type FacadeSide} from '../src/world/surface/archPlan';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {FACADE_STYLES, LOOK_FACADE_IDS, surfaceImpactClass} from '../src/world/surface/archStyles';
import {SURFACE_TINT_HOOK, isSurfaceTintFamily, setSurfaceTexture, surfaceArchMaterial, surfaceTintFamily, type SurfaceTexSlot} from '../src/world/surface/archMaterials';
import type {SurfaceNodeMaterial} from '../src/world/materials';
import {nodeHookKeys} from '../src/render/nodeHooks';
import {reflectTagOf} from '../src/render/reflectTag';
import {lookSkyMaterial, outdoorFlatMaterial, outdoorModelMaterial} from '../src/world/surface/lookSky';
import {SURFACE_FACADE_IDS} from '../src/gen/surface/facades';
import {finishClass} from '../src/damage/impactFinish';
import {isArchFinish} from '../src/world/finishAt';
import {stationBakeInput, stationFieldSource} from '../src/world/lights';
import {surfaceDaylightDigest, surfaceSkyField} from '../src/world/surface/lookDaylight';
import {stationLevels} from '../src/world/levelGeometry';

installCanvasShim(false);

const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
let built: {w: BuiltWorld; m: WorldMaterials} | null = null;
const district = () => {
  if (!built) { const m = mats(); built = {w: buildWorld(lookFixture().layout, m, {}), m}; }
  return built;
};
const alongXOf = (f: BuiltFace) => Math.abs(f.z0 - f.z1) < 1e-9;
const onSide = (f: BuiltFace, sd: FacadeSide) => {
  if (alongXOf(f) !== sd.alongX) return false;
  const plane = sd.alongX ? f.z0 : f.x0, sign = Math.sign(sd.alongX ? f.nz : f.nx);
  const a = Math.min(sd.alongX ? f.x0 : f.z0, sd.alongX ? f.x1 : f.z1), b = Math.max(sd.alongX ? f.x0 : f.z0, sd.alongX ? f.x1 : f.z1);
  return Math.abs(plane - sd.plane) < 1e-4 && sign === sd.n && a >= sd.s0 - 1e-4 && b <= sd.s1 + 1e-4;
};
/** Vertex positions of a mesh in world space. */
const verts = (m: THREE.Mesh): THREE.Vector3[] => {
  const p = m.geometry.attributes.position, out: THREE.Vector3[] = [];
  m.updateMatrixWorld(true);
  for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld));
  return out;
};

describe('Surface Run look: the facade list', () => {
  it("LOOK draws exactly GEN's published facade ids (gen/surface/facades.ts), each with a style", () => {
    expect([...LOOK_FACADE_IDS].sort()).toEqual([...SURFACE_FACADE_IDS].sort());
    for (const id of LOOK_FACADE_IDS) expect(FACADE_STYLES[id]?.id).toBe(id);
  });
});

describe('Surface Run look: the district architecture', () => {
  it('a shell for every building: facade faces in its own finish on every open side, clipped to its roof line, a roof deck', () => {
    const {w} = district(), plan = surfaceLookPlan(lookFixture().layout)!;
    const faces = w.drawn!.faces as BuiltFace[];
    expect(w.surfaceArch).toBeDefined();
    let shells = 0;
    for (const bl of plan.buildings) {
      if (!bl.sides.length) continue; // the tent: drawn by the tent build
      const open = bl.sides.filter(s => s.open);
      expect(open.length, `building ${bl.id} has an open side`).toBeGreaterThan(0);
      for (const sd of open) {
        const mine = faces.filter(f => f.finish === bl.key && onSide(f, sd));
        expect(mine.length, `building ${bl.id} side ${sd.side}`).toBeGreaterThan(0);
        const maxTop = Math.max(...sd.tops.map(t => t.top));
        for (const f of mine) expect(Math.max(f.y0, f.y1)).toBeLessThanOrEqual(maxTop + 1e-3);
        // the drawn facade reaches its roof line somewhere (not a stub)
        expect(Math.max(...mine.map(f => f.y1))).toBeGreaterThan(Math.min(...sd.tops.map(t => t.top)) - 1e-3);
      }
      expect(bl.decks.length, `building ${bl.id} deck`).toBeGreaterThan(0);
      shells++;
    }
    expect(shells).toBe(plan.buildings.filter(b => b.sides.length).length);
    expect(shells).toBeGreaterThan(40);
    const keys = new Set(w.surfaceArch!.meshes.map(m => m.userData.surfaceArch as string | undefined));
    for (const k of ['surface-roof', 'surface-coping']) expect(keys.has(k), k).toBe(true);
  });

  it("the builder's own district architecture is merged into 96 m cells (draw calls); level tags kept", () => {
    const {w} = district(), st = w.surfaceArch!.stats;
    expect(st.builderMeshesBefore).toBeGreaterThan(500);
    expect(st.builderMeshes).toBeLessThan(st.builderMeshesBefore * 0.75);
    const arch = w.group.children.filter(o => (o as THREE.Mesh).isMesh && o.name.startsWith('surface-arch-') && o.userData.surfaceArch === undefined) as THREE.Mesh[];
    expect(arch.length).toBe(st.builderMeshes);
    for (const m of arch) {
      expect(typeof m.userData.level, m.name).toBe('number');
      expect(m.geometry.boundingSphere, m.name).toBeTruthy();
    }
  });

  it('coarsenSurfaceArch: same material / level / cell pieces merge, triangles kept, originals released, other meshes untouched', () => {
    const g = new THREE.Group(), A = new THREE.MeshBasicMaterial(), B = new THREE.MeshBasicMaterial();
    let released = 0;
    const piece = (x: number, z: number, mat: THREE.Material, level = 0, name = 'surface-arch-surface-road') => {
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(x, 0, z);
      geo.clearGroups();
      geo.addEventListener('dispose', () => { released++; });
      const m = new THREE.Mesh(geo, mat);
      m.name = name; m.userData.level = level; m.matrixAutoUpdate = false;
      g.add(m);
      return m;
    };
    piece(10, 10, A); piece(60, 10, A); piece(10, 60, A); // one 96 m cell, one material, one level: one mesh
    piece(20, 20, B); piece(110, 10, A); piece(10, 10, A, 1); // another material / cell / level: each its own
    const prop = piece(12, 12, A, 0, 'prop-crate');
    const mine = piece(14, 14, A, 0, 'surface-arch-surface-roof@0,0');
    mine.userData.surfaceArch = 'surface-roof';
    const tris = () => g.children.reduce((a, o) => a + ((o as THREE.Mesh).geometry.index!.count / 3), 0);
    const t0 = tris();
    expect(coarsenSurfaceArch(g)).toEqual({before: 6, after: 4, tinted: 0});
    expect(g.children).toHaveLength(6);
    expect(tris()).toBe(t0);
    expect(released).toBe(3);
    expect(g.children).toContain(prop);
    expect(g.children).toContain(mine);
    const merged = g.children.find(o => (o as THREE.Mesh).geometry.index!.count === 3 * 36) as THREE.Mesh;
    expect(merged.material).toBe(A);
    expect(merged.userData.level).toBe(0);
    merged.geometry.computeBoundingBox();
    expect(merged.geometry.boundingBox!.min.x).toBeCloseTo(9.5, 5);
    expect(merged.geometry.boundingBox!.max.z).toBeCloseTo(60.5, 5);
  });

  it('coarsenSurfaceArch with a tint: family members move onto the shared material, their exact colour in a Float32 colour attribute, and merge', () => {
    const g = new THREE.Group(), shared = new THREE.MeshBasicMaterial(), other = new THREE.MeshBasicMaterial();
    const red = new THREE.MeshBasicMaterial({color: new THREE.Color(0.7123456789, 0.2, 0.1)}), blue = new THREE.MeshBasicMaterial({color: new THREE.Color(0.1, 0.3, 0.9)});
    for (const [x, mat] of [[10, red], [30, blue], [50, other]] as const) {
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(x, 0, 10);
      geo.clearGroups();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'surface-arch-k'; mesh.userData.level = 0; mesh.matrixAutoUpdate = false;
      g.add(mesh);
    }
    const r = coarsenSurfaceArch(g, 96, mm => (mm === red || mm === blue ? {material: shared, color: (mm as THREE.MeshBasicMaterial).color} : null));
    expect(r).toEqual({before: 3, after: 2, tinted: 2});
    const merged = g.children.find(o => (o as THREE.Mesh).material === shared) as THREE.Mesh;
    const C = merged.geometry.attributes.color as THREE.BufferAttribute;
    expect(C.array).toBeInstanceOf(Float32Array);
    expect(C.count).toBe(48);
    const want = new Set([red, blue].map(mm => mm.color.toArray().map(Math.fround).join(',')));
    const got = new Set<string>();
    for (let i = 0; i < C.count; i++) got.add([C.getX(i), C.getY(i), C.getZ(i)].join(','));
    expect(got).toEqual(want);
    expect((g.children.find(o => (o as THREE.Mesh).material === other) as THREE.Mesh).geometry.attributes.color).toBeUndefined();
  });

  it('the facade wall families and the trims draw through ONE shared material each, the building tint per vertex: the same PBR material otherwise', () => {
    const {w, m} = district();
    // what differs between a member key's own material and its family's shared one: the colour (1 there: the tint is the vertex's),
    // and the tint stage FIRST in the colour chain; everything else (maps, their sampling, roughness / metalness, normal scale, world
    // mapping, decay profile, polygon offset, reflections, the albedo the bake reads) is identical
    const tex = (t: THREE.Texture | null) => (t ? [t.source.uuid, t.wrapS, t.wrapT, t.repeat.toArray(), t.offset.toArray(), t.colorSpace, t.anisotropy, t.flipY, t.channel] : null);
    const sig = (x: THREE.Material) => {
      const q = x as SurfaceNodeMaterial;
      return JSON.stringify({
        type: q.type, rough: q.roughness, metal: q.metalness, map: tex(q.map), normal: tex(q.normalMap), rmap: tex(q.roughnessMap), mmap: tex(q.metalnessMap),
        ns: q.normalScale.toArray(), side: q.side, shadowSide: q.shadowSide, transparent: q.transparent, opacity: q.opacity, alphaTest: q.alphaTest,
        po: [q.polygonOffset, q.polygonOffsetFactor, q.polygonOffsetUnits], wm: q.wmMap.toArray(), grime: q.wmGrime.toArray(),
        decay: [q.decayP0.toArray(), q.decayP1.toArray(), q.decayP2.toArray(), q.decayTint.toArray()], ctx: q.contextNode?.uuid ?? null, nrm: q.normalNode?.uuid ?? null,
        emissive: q.emissive.getHex(), flat: q.flatShading, depth: [q.depthTest, q.depthWrite], vc: q.vertexColors, reflect: reflectTagOf(q) ?? null, albedo: q.userData.lightAlbedo ?? null,
      });
    };
    const check = (mm: WorldMaterials, key: string) => {
      const fam = surfaceTintFamily(key)!, F = surfaceArchMaterial(mm, fam) as SurfaceNodeMaterial, M = surfaceArchMaterial(mm, key) as SurfaceNodeMaterial;
      expect(F, fam).toBeDefined();
      expect(sig(F), `${key} vs ${fam}`).toBe(sig(M));
      expect(F.color.toArray()).toEqual([1, 1, 1]);
      expect(F.vertexColors).toBe(false); // (three's own vertex colours would multiply AFTER decay's grime)
      expect(nodeHookKeys(F), key).toEqual([SURFACE_TINT_HOOK, ...nodeHookKeys(M)]);
    };
    const members = new Set<string>();
    for (const f of w.drawn!.faces as BuiltFace[]) if (surfaceTintFamily(f.finish)) members.add(f.finish);
    for (const bl of surfaceLookPlan(lookFixture().layout)!.buildings) {
      if (surfaceTintFamily(bl.key)) members.add(bl.key);
      members.add(bl.trimKey);
      for (const k of facadeDetailMembers(bl.detail)) members.add(k); // (the facade detail's darker finishes and awnings: facadeDetail.ts)
    }
    for (const k of ['surface-trim-2f3133', 'surface-trim-3a3a2c']) members.add(k); // (door frames outside a building; the tent's ropes)
    expect(members.size).toBeGreaterThan(20);
    for (const k of members) check(m, k);
    // with the district's own texture sets loaded (stand-ins): the PBR / UV-mapped branches of every wall family match the same way
    const slots: SurfaceTexSlot[] = ['concrete:color', 'concrete:normal', 'concrete:orm', 'rusted:color', 'rusted:normal', 'rusted:orm', 'brick', 'fabric'];
    try {
      for (const sl of slots) setSurfaceTexture(sl, new THREE.Texture({width: 4, height: 4} as unknown as HTMLImageElement));
      const m2 = mats();
      for (const k of ['surface-facade-brick-8f5545', 'surface-facade-concrete-a8a49b', 'surface-facade-stone-d8ccb4', 'surface-facade-metal-5a6a60', 'surface-facade-curtain-445566', 'surface-facade-canvas-6b6a4a', 'surface-trim-2f3133']) {
        check(m2, k);
        // the same image (trims sample anisotropy-1 clones of the shared set: world/materials.ts thinTrim)
        expect((surfaceArchMaterial(m2, surfaceTintFamily(k)!) as SurfaceNodeMaterial).map?.source, k).toBe((surfaceArchMaterial(m2, k) as SurfaceNodeMaterial).map?.source);
      }
    } finally { for (const sl of slots) setSurfaceTexture(sl, null); }
    // nothing drawn uses a member's own material any more; every family mesh carries its tint per vertex, and only its members' tints
    const tintsOf = new Map<string, Set<string>>();
    for (const k of members) {
      const c = (surfaceArchMaterial(m, k) as SurfaceNodeMaterial).color, fam = surfaceTintFamily(k)!;
      (tintsOf.get(fam) ?? tintsOf.set(fam, new Set()).get(fam)!).add(c.toArray().map(Math.fround).join(','));
    }
    const drawnMembers: string[] = [], fams = new Set<string>();
    let tintedVerts = 0;
    w.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const k = String((mesh.material as THREE.Material).userData?.surfaceArch ?? '');
      if (surfaceTintFamily(k)) drawnMembers.push(`${mesh.name} ${k}`);
      if (!isSurfaceTintFamily(k)) return;
      fams.add(k);
      const C = mesh.geometry.attributes.color as THREE.BufferAttribute;
      expect(C?.itemSize, mesh.name).toBe(3);
      expect(C.array, mesh.name).toBeInstanceOf(Float32Array);
      expect(C.count, mesh.name).toBe(mesh.geometry.attributes.position.count);
      const ok = tintsOf.get(k) ?? new Set<string>();
      for (let i = 0; i < C.count; i++) { const t = [C.getX(i), C.getY(i), C.getZ(i)].join(','); if (!ok.has(t)) expect.fail(`${mesh.name}: tint ${t} is no ${k} member's`); }
      tintedVerts += C.count;
    });
    expect(drawnMembers).toEqual([]);
    expect(fams.has('surface-trim-tint')).toBe(true);
    expect([...fams].filter(f => f.startsWith('surface-facade-')).length).toBeGreaterThanOrEqual(4);
    expect(tintedVerts).toBeGreaterThan(1000);
    // a building's wall face carries ITS tint: the vertices at its corners in the builder's family meshes have its member's colour
    const at = new Map<string, Set<string>>();
    const P = (x: number, y: number, z: number) => `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`;
    for (const o of w.group.children) {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.surfaceArch !== undefined || !isSurfaceTintFamily(String((mesh.material as THREE.Material).userData?.surfaceArch ?? ''))) continue;
      const p = mesh.geometry.attributes.position, C = mesh.geometry.attributes.color;
      for (let i = 0; i < p.count; i++) { const k = P(p.getX(i), p.getY(i), p.getZ(i)); (at.get(k) ?? at.set(k, new Set()).get(k)!).add([C.getX(i), C.getY(i), C.getZ(i)].join(',')); }
    }
    let faces = 0;
    for (const f of w.drawn!.faces as BuiltFace[]) {
      if (!surfaceTintFamily(f.finish) || f.slope) continue;
      const want = (surfaceArchMaterial(m, f.finish) as SurfaceNodeMaterial).color.toArray().map(Math.fround).join(',');
      const corners = [P(f.x0, f.y0, f.z0), P(f.x1, f.y0, f.z1), P(f.x1, f.y1, f.z1), P(f.x0, f.y1, f.z0)].filter(k => at.has(k));
      expect(corners.length, `${f.finish} face corners drawn`).toBeGreaterThan(0);
      for (const k of corners) expect(at.get(k)!.has(want), `${f.finish} face at ${k}`).toBe(true);
      faces++;
    }
    expect(faces).toBeGreaterThan(100);
  });

  it("AIR's live window spans: cut through both wall planes and framed, never glazed by LOOK", () => {
    const {w} = district(), fx = lookFixture(), S = fx.layout.surface!;
    expect(fx.spans.length).toBeGreaterThan(4);
    const faces = w.drawn!.faces as BuiltFace[];
    const glass = w.surfaceArch!.meshes.filter(m => /glass/.test(String(m.userData.surfaceArch ?? '')) || /glass/i.test((m.material as THREE.Material).name));
    const trims = w.surfaceArch!.meshes.filter(m => String(m.userData.surfaceArch ?? '').startsWith('surface-trim-'));
    for (const id of fx.spans) {
      const sp = S.windows.find(s => s.id === id)!;
      const {alongX, n} = SIDE_NORMAL[sp.side];
      // sill / head above the storey's floor (lane AIR's rule: surface.storeys, else the level's base)
      const base = S.storeys.find(q => q.level === sp.level)?.y ?? fx.layout.levels[sp.level]?.baseY ?? 0;
      const a0 = (alongX ? sp.x0 : sp.z0) + 0.03, a1 = (alongX ? sp.x1 : sp.z1) - 0.03, y0 = base + sp.sill + 0.03, y1 = base + sp.head - 0.03;
      const outer = alongX ? (n > 0 ? sp.z1 : sp.z0) : (n > 0 ? sp.x1 : sp.x0), inner = alongX ? (n > 0 ? sp.z0 : sp.z1) : (n > 0 ? sp.x0 : sp.x1);
      // no wall face covers the opening on either plane
      for (const f of faces) {
        if (f.slope || alongXOf(f) !== alongX) continue;
        const plane = alongX ? f.z0 : f.x0;
        if (Math.abs(plane - outer) > 1e-4 && Math.abs(plane - inner) > 1e-4) continue;
        const fa = Math.min(alongX ? f.x0 : f.z0, alongX ? f.x1 : f.z1), fb = Math.max(alongX ? f.x0 : f.z0, alongX ? f.x1 : f.z1);
        const covers = fa < a1 && fb > a0 && f.y0 < y1 && f.y1 > y0;
        expect(covers, `span ${id}: face ${f.finish} [${fa.toFixed(2)}, ${fb.toFixed(2)}] x [${f.y0.toFixed(2)}, ${f.y1.toFixed(2)}] covers the opening`).toBe(false);
      }
      // no LOOK glass inside the opening's box
      const inBox = (v: THREE.Vector3) => (alongX ? v.x : v.z) > a0 && (alongX ? v.x : v.z) < a1 && v.y > y0 && v.y < y1 && Math.abs((alongX ? v.z : v.x) - (outer + inner) / 2) < 0.6;
      for (const m of glass) expect(verts(m).some(inBox), `glass ${m.name} in span ${id}`).toBe(false);
      // framed: trim vertices round the opening
      const near = (v: THREE.Vector3) => (alongX ? v.x : v.z) > a0 - 0.3 && (alongX ? v.x : v.z) < a1 + 0.3 && v.y > y0 - 0.3 && v.y < y1 + 0.3 && Math.abs((alongX ? v.z : v.x) - outer) < 0.4;
      expect(trims.some(m => verts(m).some(near)), `span ${id} framed`).toBe(true);
    }
    expect(w.surfaceArch!.stats.airHoles).toBe(fx.spans.length);
  });

  it('every facade style is drawn with its own wall family, ground treatment, window rule and finish material', () => {
    const {m} = district(), fx = lookFixture(), plan = surfaceLookPlan(fx.layout)!;
    const seen = new Set<string>();
    for (const bl of plan.buildings) {
      if (!bl.sides.length) continue;
      const st = FACADE_STYLES[bl.b.facade as keyof typeof FACADE_STYLES];
      expect(bl.style.id, `building ${bl.id}`).toBe(st.id);
      expect(bl.key.startsWith(`surface-facade-${st.wall}-`)).toBe(true);
      expect(surfaceArchMaterial(m, bl.key), bl.key).toBeDefined();
      seen.add(st.id);
      const deco = bl.holes.filter(h => h.kind !== 'air' && h.kind !== 'door-boarded');
      if (st.windows === 'none' && st.ground === 'none') expect(deco.length).toBe(0);
      if (st.ground === 'shopfront' && bl.sides.some(s => s.frontage && s.open) && !bl.interiors.length) expect(deco.some(h => h.kind === 'shop' || h.kind === 'shutter'), `${st.id} shopfront`).toBe(true);
      if (!st.fireEscape) expect(bl.escapes.length).toBe(0);
    }
    for (const id of LOOK_FACADE_IDS.filter(i => i !== 'tent-canvas')) expect(seen.has(id), id).toBe(true);
  });

  it('the cordon reads closed: a concrete wall to its height, steel-plate barricades where streets would run on, a coping', () => {
    const {w} = district();
    const faces = w.drawn!.faces as BuiltFace[];
    const cordon = faces.filter(f => f.finish === 'surface-cordon'), bar = faces.filter(f => f.finish === 'surface-barricade');
    expect(cordon.length).toBeGreaterThan(8);
    expect(bar.length).toBeGreaterThan(0);
    // capped from the floor in front of it (the street, a kerb, a mound), every band of the builder's face included
    const g = lookFixture().layout.grid;
    const floorBefore = (f: BuiltFace) => {
      const ax = alongXOf(f), plane = ax ? f.z0 : f.x0, sign = Math.sign(ax ? f.nz : f.nx), mid = ax ? (f.x0 + f.x1) / 2 : (f.z0 + f.z1) / 2;
      const x = ax ? mid : plane + sign * CELL / 2, z = ax ? plane + sign * CELL / 2 : mid;
      return g.floor[Math.floor(z / CELL) * g.w + Math.floor(x / CELL)];
    };
    for (const f of [...cordon, ...bar]) expect(f.y1 - floorBefore(f), `${f.finish} ${f.y0}-${f.y1}`).toBeLessThanOrEqual(LOOK_TUNE.cordonH + 1e-3);
    expect(Math.max(...cordon.map(f => f.y1 - floorBefore(f)))).toBeCloseTo(LOOK_TUNE.cordonH, 3);
    expect(w.surfaceArch!.meshes.some(m => m.userData.surfaceArch === 'surface-coping')).toBe(true);
  });

  it("the checkpoint tent: canvas, a pitched roof, guy lines and a flap on its own pivot (AIR's open / closed seam)", () => {
    const {w} = district(), arch = w.surfaceArch!;
    expect(arch.plan.tent).not.toBeNull();
    const names = new Set(arch.meshes.map(m => m.name));
    for (const n of ['surface-tent', 'surface-tent-ropes', 'surface-tent-flap-leaf']) expect(names.has(n), n).toBe(true);
    const leaf = arch.meshes.find(m => m.name === 'surface-tent-flap-leaf')!;
    arch.setTentFlap(0);
    const closed = verts(leaf).map(v => v.y);
    arch.setTentFlap(1);
    const open = verts(leaf).map(v => v.y);
    expect(Math.min(...open)).toBeGreaterThan(Math.min(...closed) + 1);
    arch.setTentFlap(0);
    expect(Math.min(...verts(leaf).map(v => v.y))).toBeCloseTo(Math.min(...closed), 5);
  });

  it('every district finish key has a material and a bullet-impact class', () => {
    const {w} = district(), arch = w.surfaceArch!;
    const keys = new Set<string>();
    for (const f of w.drawn!.faces as BuiltFace[]) if (f.finish.startsWith('surface-')) keys.add(f.finish);
    for (const m of arch.meshes) { const k = m.userData.surfaceArch as string | undefined; if (k) keys.add(k); }
    for (const k of w.drawn!.keys) if (k.startsWith('surface-')) keys.add(k.split('|')[0]);
    expect(keys.size).toBeGreaterThan(15);
    for (const k of keys) {
      expect(isArchFinish(k), k).toBe(true);
      expect(arch.material(k), k).toBeDefined();
      if (k === 'surface-sign' || k === 'surface-void') continue;
      expect(finishClass(k), k).not.toBeNull();
      expect(surfaceImpactClass(k), k).toBe(finishClass(k));
    }
  });

  it("GEN's shape record: storeys stand on the kerb (roofY - their heights), fire escapes land on storey floors, the roof line is absolute", () => {
    const d = lookFixture().layout, plan = surfaceLookPlan(d)!;
    type Shaped = {storeyHeights?: number[]; roofY?: number};
    const shaped = plan.buildings.filter(bl => bl && (bl.b as Shaped).storeyHeights?.length && bl.sides.length);
    expect(shaped.length).toBeGreaterThan(1);
    for (const bl of shaped) {
      const g = bl.b as Shaped, sh = g.storeyHeights!;
      expect(bl.storeyY[0]).toBeCloseTo(0.15, 6);
      let y = 0.15;
      sh.forEach((h, k) => { expect(bl.storeyY[k]).toBeCloseTo(y, 6); y += h; });
      expect(bl.deck).toBeCloseTo(g.roofY!, 6);
      expect(bl.top).toBeCloseTo(bl.b.height, 6);
      for (const fe of bl.escapes) fe.levels.forEach((k, i) => expect(fe.ys[i]).toBeCloseTo(bl.storeyY[k], 6));
      // decorative windows sit inside their storey (from its floor, not from 0)
      for (const h of bl.holes) if (h.kind !== 'air' && h.kind !== 'door-boarded') expect(h.y0).toBeGreaterThanOrEqual(bl.storeyY[h.storey] - 1e-6);
    }
    // a shell without the record: storeys from 0
    const bare = plan.buildings.find(bl => bl && !(bl.b as Shaped).storeyHeights);
    if (bare) expect(bare.storeyY[0]).toBe(0);
  });

  it("an entrance stands on its doorway cell's grid floor (AIR hangs its leaves there); a boarded one on the sidewalk outside", () => {
    // a 6 x 6-cell patch: the doorway cell (2, 2) at the kerb 0.15, a SOLID wall row z = 2 elsewhere, the sidewalk (z > 2) at 0.15
    const w = 6, cells = new Uint8Array(w * w).fill(FLOOR), floor = new Float32Array(w * w);
    for (let x = 0; x < w; x++) { cells[2 * w + x] = SOLID; for (let z = 3; z < w; z++) floor[z * w + x] = 0.15; }
    cells[2 * w + 2] = FLOOR; floor[2 * w + 2] = 0.15;
    const grid = {w, h: w, cells, floor} as unknown as StationLayout['grid'];
    const layout = {grid, levels: [{id: 0, grid, baseY: 0}]} as unknown as StationLayout;
    expect(entranceFloor(layout, {level: 0, side: 'S', x: 2.5 * CELL, z: 2.5 * CELL})).toBeCloseTo(0.15, 6);
    // boarded: the doorway cell stays SOLID -> the sidewalk outside (S of it)
    cells[2 * w + 2] = SOLID;
    expect(entranceFloor(layout, {level: 0, side: 'S', x: 2.5 * CELL, z: 2.5 * CELL})).toBeCloseTo(0.15, 6);
    // nothing open round it: the level's base
    cells.fill(SOLID);
    expect(entranceFloor(layout, {level: 0, side: 'S', x: 2.5 * CELL, z: 2.5 * CELL})).toBe(0);
  });

  it('cutFace splits a face round holes and a stepped roof line, and passes an uncut face through unchanged', () => {
    const f = {level: 0, area: 0, areaType: 'street', zone: 0, x0: 0, z0: 5, x1: 10, z1: 5, nx: 0, nz: 1, y0: 0, y1: 12, finish: 'x', openings: [], seed: 1, kind: 'wall', vb0: 0, vb1: 0} as unknown as BuiltFace;
    expect(cutFace(f, [], null, Infinity)).toEqual([f]);
    const parts = cutFace(f, [{s0: 2, s1: 4, y0: 1, y1: 2}], [{s0: 0, s1: 5, top: 10}, {s0: 5, s1: 10, top: 7}], 7);
    const area = parts.reduce((a, p) => a + Math.abs(p.x1 - p.x0) * (p.y1 - p.y0), 0);
    expect(area).toBeCloseTo(5 * 10 + 5 * 7 - 2, 6);
    for (const p of parts) expect(p.y1).toBeLessThanOrEqual(p.x0 < 5 - 1e-9 ? 10 + 1e-9 : 7 + 1e-9);
  });

  it("LOOK's TSL graphs build cleanly on WGSL and GLSL (sky dome, outdoor flats, outdoor models, district finishes)", () => {
    const m = mats();
    const tex = new THREE.Texture({width: 4, height: 4} as unknown as HTMLImageElement);
    const std = new THREE.MeshStandardMaterial({map: tex});
    const list: THREE.Material[] = [lookSkyMaterial(), outdoorFlatMaterial('roof'), outdoorFlatMaterial('steel'), outdoorModelMaterial(std), outdoorModelMaterial(std, true)];
    for (const k of ['surface-road', 'surface-paint-white', 'surface-facade-brick-ffffff', 'surface-facade-concrete-ffffff', 'surface-barricade', 'surface-canvas', 'surface-in-wall-shop']) list.push(surfaceArchMaterial(m, k)!);
    for (const mat of list) {
      for (const sh of buildBoth(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat), {lights: [new THREE.SpotLight(0xffffff, 1)]})) {
        expect(sh.errors, `${mat.name} ${sh.backend}`).toEqual([]);
      }
    }
    // the shared tinted families (follow-up 1) read their tint from the geometry's 'color' attribute
    for (const k of ['surface-facade-brick-tint', 'surface-facade-metal-tint', 'surface-facade-curtain-tint', 'surface-trim-tint']) {
      const mat = surfaceArchMaterial(m, k)!, geo = new THREE.BoxGeometry(1, 1, 1);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(0.5), 3));
      for (const sh of buildBoth(new THREE.Mesh(geo, mat), {lights: [new THREE.SpotLight(0xffffff, 1)]})) {
        expect(sh.errors, `${k} ${sh.backend}`).toEqual([]);
        expect(/\bcolor\b/.test(sh.vertex), `${k} ${sh.backend}: the colour attribute is read`).toBe(true);
      }
    }
  });
});

describe('Surface Run look: inert elsewhere', () => {
  it('a non-district layout gets no plan, no arch, no daylight term, no digest and no surface finishes', () => {
    const plain = plainLayout();
    expect(surfaceLookPlan(plain)).toBeNull();
    expect(SurfaceArch.for(plain, mats(), stationLevels(plain))).toBeNull();
    expect(surfaceSkyField(plain)).toEqual({});
    expect(surfaceDaylightDigest(plain)).toBe('');
    expect(stationFieldSource(plain).extraDirect).toBeUndefined();
    expect(stationFieldSource(plain).extraDirectSteps).toBeUndefined();
    expect(stationBakeInput(plain).extra).toBe('');
    const w = buildWorld(plain, mats(), {});
    expect(w.surfaceArch).toBeUndefined();
    expect((w.drawn!.faces as BuiltFace[]).some(f => f.finish.startsWith('surface-'))).toBe(false);
    let named = 0;
    w.group.traverse(o => { if (o.name.startsWith('surface-')) named++; });
    expect(named).toBe(0);
    // the shared impact table answers as before for other levels' keys
    expect(finishClass('office-wall')).toBe('plaster');
    expect(finishClass('annexWall')).toBe('concrete');
  });

  it('the district does get its daylight term and a digest that follows its seed', () => {
    const d = lookFixture().layout;
    expect(typeof surfaceSkyField(d).extraDirectSteps).toBe('function');
    expect(stationFieldSource(d).extraDirectSteps).toBeTypeOf('function');
    const dig = surfaceDaylightDigest(d);
    expect(dig.length).toBeGreaterThan(10);
    expect(stationBakeInput(d).extra).toContain('surface-daylight');
    expect(surfaceDaylightDigest(lookFixture(94).layout)).not.toBe(dig);
  });
});
