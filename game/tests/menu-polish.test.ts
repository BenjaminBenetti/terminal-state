// Task studio-beta-campaign-polish-20261103-063841-01 (lane MENU): the queued menu / settings / loading / death polish.
//  1. the title camera opens at the framing its orbit reached ~25 s in, then keeps its slow motion;
//  3. the background building's black triangles / broken geometry: the cooked city GLBs' zero normals are repaired and their own
//     doubleSided flag is honoured (lit toward the eye);
// (the remaining items are appended below by the later steps of the lane).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {buildBoth} from './helpers/tslShaders';
import {buildExterior, modelParts, planExterior} from '../src/world/exterior';
import {MENU_SCENE, MenuScene, orbitPose, type MenuRenderer} from '../src/world/menuScene';
import {repairZeroNormals, zeroNormalVertices} from '../src/world/normalRepair';

installCanvasShim(false);

class FakeRenderer implements MenuRenderer {
  initialized = true;
  toneMappingExposure = 1;
  info = {reset() {}};
  getDrawingBufferSize(t: THREE.Vector2): THREE.Vector2 { return t.set(1920, 1080); }
  getRenderTarget(): unknown { return null; }
  setRenderTarget(): void {}
  render(): void {}
}

const withVisibleDocument = <T>(fn: () => T): T => {
  const g = globalThis as {document?: {hidden: boolean}};
  const had = g.document;
  g.document = {...(had ?? {}), hidden: false} as {hidden: boolean};
  try { return fn(); } finally { if (had) g.document = had; else delete g.document; }
};

describe('item 1: the title camera opens at the ~25 s framing and keeps moving slowly', () => {
  it('the opening phase is 25 s of the unchanged orbit', () => {
    expect(MENU_SCENE.orbit.startAt).toBe(25);
    const m = new MenuScene({});
    // posed at construction (the pipelines compile from this camera): exactly the orbit's 25 s pose, not its old t = 0 start
    expect(m.camera.position.distanceTo(orbitPose(25).pos)).toBeLessThan(1e-9);
    expect(m.camera.position.distanceTo(orbitPose(0).pos)).toBeGreaterThan(5);
    m.dispose();
  });

  it('the FIRST drawn frame is the 25 s framing however late the diorama appears (no fast-forward), then real time runs on', () => {
    withVisibleDocument(() => {
      for (const appearAt of [1800, 9_500, 93_000]) {
        const m = new MenuScene({});
        const r = new FakeRenderer();
        expect(m.render(r, appearAt)).toBe(true);
        expect(m.camera.position.distanceTo(orbitPose(25).pos), `appears at ${appearAt} ms`).toBeLessThan(1e-9);
        // 30 fps for 10 s: every step is a small continuous move (no jump), and it ends at the orbit's 35 s pose
        let prev = m.camera.position.clone(), maxStep = 0;
        for (let t = appearAt + 1000 / 30; t <= appearAt + 10_000 + 1e-6; t += 1000 / 30) {
          if (!m.render(r, t)) continue;
          maxStep = Math.max(maxStep, m.camera.position.distanceTo(prev));
          prev = m.camera.position.clone();
        }
        expect(maxStep).toBeGreaterThan(0); // it keeps moving
        expect(maxStep).toBeLessThan(0.08); // slowly (~1 m/s at most at the orbit's radius)
        expect(m.camera.position.distanceTo(orbitPose(m.orbitTime(appearAt + 10_000)).pos)).toBeLessThan(1e-6);
        expect(m.orbitTime(appearAt + 10_000)).toBeCloseTo(35, 6);
        m.dispose();
      }
    });
  });

  it('the QA timeOffset still shifts the clock on top of the opening phase', () => {
    const m = new MenuScene({});
    m.timeOffset = 40;
    expect(m.orbitTime(5000)).toBeCloseTo(65, 9);
    expect(m.orbitTime(7000)).toBeCloseTo(67, 9);
    m.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// item 3

/** POSITION / NORMAL / indices of the first primitive of an uncompressed cooked GLB (no three loader in Node). */
function readGlbGeometry(file: string): THREE.BufferGeometry {
  const f = fs.readFileSync(path.resolve(__dirname, '../public/assets/models', file));
  const jl = f.readUInt32LE(12);
  const j = JSON.parse(f.subarray(20, 20 + jl).toString('utf8'));
  const off = 20 + jl, bl = f.readUInt32LE(off), bin = f.subarray(off + 8, off + 8 + bl);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const acc = (i: number): number[] => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView];
    const n = ({SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4} as Record<string, number>)[a.type];
    const es = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? n * es, start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[] = [];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = start + k * stride + c * es;
      out.push(a.componentType === 5126 ? dv.getFloat32(o, true) : es === 4 ? dv.getUint32(o, true) : es === 2 ? dv.getUint16(o, true) : dv.getUint8(o));
    }
    return out;
  };
  const p = j.meshes[0].primitives[0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc(p.attributes.POSITION), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc(p.attributes.NORMAL), 3));
  g.setIndex(acc(p.indices));
  return g;
}

/** Triangles whose three vertex normals are all zero (normalize(0) = NaN in the fragment: drawn black). */
function blackTriangles(g: THREE.BufferGeometry): number {
  const zero = new Set(zeroNormalVertices(g)), idx = g.getIndex()!;
  let n = 0;
  for (let t = 0; t < idx.count; t += 3) if (zero.has(idx.getX(t)) && zero.has(idx.getX(t + 1)) && zero.has(idx.getX(t + 2))) n++;
  return n;
}

describe('item 3: the background building\'s black triangles are repaired at the source (zero normals; the model\'s own side)', () => {
  it('ROOT CAUSE: the cooked ruined tower / mid-rise carry zero-length normals that shade as whole black triangles', () => {
    const tower = readGlbGeometry('office-ruined-tower.glb'), mid = readGlbGeometry('office-ruined-midrise.glb');
    expect(zeroNormalVertices(tower).length).toBe(254);
    expect(blackTriangles(tower)).toBe(54);
    expect(zeroNormalVertices(mid).length).toBe(262);
    expect(blackTriangles(mid)).toBe(24);
  });

  it('repairZeroNormals: every zero normal becomes a unit normal from its faces; every valid normal is left exactly as it was; idempotent', () => {
    for (const file of ['office-ruined-tower.glb', 'office-ruined-midrise.glb']) {
      const g = readGlbGeometry(file);
      const before = Float32Array.from(g.getAttribute('normal').array as Float32Array);
      const bad = new Set(zeroNormalVertices(g));
      expect(repairZeroNormals(g)).toBe(bad.size);
      expect(zeroNormalVertices(g)).toEqual([]);
      expect(blackTriangles(g)).toBe(0);
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) {
        if (bad.has(i)) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
        else expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([before[i * 3], before[i * 3 + 1], before[i * 3 + 2]]);
      }
      const after = Float32Array.from(n.array as Float32Array);
      expect(repairZeroNormals(g)).toBe(0);
      expect(Float32Array.from(n.array as Float32Array)).toEqual(after);
    }
  });

  it('a repaired normal follows its faces even when a neighbour is wound the other way (no cancellation)', () => {
    // two triangles sharing vertex 0, both in the y = 0 plane, the second wound the opposite way
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0, -1, 0, 0, 0, 0, 1], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 3, 4]);
    expect(repairZeroNormals(g)).toBe(1);
    const n = g.getAttribute('normal');
    expect(Math.abs(n.getY(0))).toBeCloseTo(1, 9);
    // an isolated zero-normal vertex (no face) gets +Y, never NaN
    const lone = new THREE.BufferGeometry();
    lone.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 5, 5], 3));
    lone.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, Number.NaN, 0, 0], 3));
    lone.setIndex([0, 1, 2]);
    expect(repairZeroNormals(lone)).toBe(1);
    expect([lone.getAttribute('normal').getX(3), lone.getAttribute('normal').getY(3)]).toEqual([0, 1]);
  });

  const heroGltf = (side: THREE.Side, zeroNormals = false): GLTF => {
    const scene = new THREE.Group();
    const map = new THREE.DataTexture(new Uint8Array([120, 118, 110, 255]), 1, 1);
    map.needsUpdate = true;
    const g = new THREE.BoxGeometry(30, 60, 40).toNonIndexed();
    g.translate(0, 30, 0);
    if (zeroNormals) for (let i = 0; i < 3; i++) g.getAttribute('normal').setXYZ(i, 0, 0, 0);
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({map, side})));
    return {scene} as unknown as GLTF;
  };

  it('modelParts repairs a model\'s zero normals before any exterior instancing uses them', () => {
    const gltf = heroGltf(THREE.DoubleSide, true);
    const [part] = modelParts(gltf);
    expect(zeroNormalVertices(part.geometry)).toEqual([]);
  });

  it('the exterior keeps a model\'s glTF doubleSided (DoubleSide, eye-facing light) and front-side models front-side; both backends compile', () => {
    const C = MENU_SCENE.corridor;
    const plan = planExterior({foot: {x0: C.x0, z0: C.z0, x1: C.x1, z1: C.z1}, groundY: 0, eyeAbove: 5, seed: MENU_SCENE.seed});
    expect(plan.buildings.some(b => b.kind === 'tower')).toBe(true); // the diorama's plan places the ruined tower (behind the lead car)
    const two = buildExterior(plan, {tower: heroGltf(THREE.DoubleSide)});
    const towers = two.instanced.filter(m => m.name.startsWith('tower-ext-tower-'));
    expect(towers.length).toBeGreaterThan(0);
    for (const m of towers) expect((m.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const one = buildExterior(plan, {tower: heroGltf(THREE.FrontSide)});
    for (const m of one.instanced.filter(x => x.name.startsWith('tower-ext-tower-'))) expect((m.material as THREE.Material).side).toBe(THREE.FrontSide);
    for (const b of buildBoth(towers[0])) expect(b.errors, b.backend).toEqual([]);
  });

  it('the title diorama builds its city with the double-sided hero and stays within its draw budget', () => {
    const m = new MenuScene({exterior: {tower: heroGltf(THREE.DoubleSide), midrise: heroGltf(THREE.DoubleSide)}});
    expect(m.stats().source.heroes).toBe(true);
    expect(m.stats().meshes).toBeLessThanOrEqual(MENU_SCENE.maxDrawCalls);
    let sides = 0;
    m.scene.traverse(o => { const x = o as THREE.Mesh; if (x.isMesh && x.name.startsWith('tower-ext-tower-') && (x.material as THREE.Material).side === THREE.DoubleSide) sides++; });
    expect(sides).toBeGreaterThan(0);
    m.dispose();
  });
});
