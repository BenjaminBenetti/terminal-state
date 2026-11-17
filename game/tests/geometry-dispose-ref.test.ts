// Task studio-surface-run-field-followup-20261116-211729-01 (lane ACCESS, resource teardown; render/geometryDisposeRef.ts):
// a disposed render object must not stay alive with its (shared, still used) geometry.
// three r186's REAL WebGPURenderer on the VALIDATING no-op device. A mesh draws a shared geometry FIRST (three's per-geometry dispose
// listener captures that render object), a second mesh keeps drawing the geometry, then the first mesh's material is disposed (its
// render object disposed — as a zombie's, a left world's instanced mesh or a re-keyed render object is):
//  - three alone: the disposed render object is still reachable (its released pipeline, bind groups and object with it);
//  - with installGeometryDisposeRef: it is collected; the live render objects are the renderer's own set;
//  - either way the geometries' dispose releases the same GPU buffers (three's own cleanup unchanged, node attributes included).
import * as THREE from 'three';
import v8 from 'node:v8';
import {afterAll, describe, expect, it, vi} from 'vitest';
import {stubValidatingWebgpu} from './helpers/validatingWebgpu';
import {geometryDisposeRefStats, installGeometryDisposeRef} from '../src/render/geometryDisposeRef';

afterAll(() => { vi.unstubAllGlobals(); });

/** A full GC (Node >= 22: v8.queryObjects collects before it counts; no --expose-gc needed). */
const fullGc = (ctor: unknown): void => { (v8 as unknown as {queryObjects(c: unknown, o: {format: 'count'}): number}).queryObjects(ctor, {format: 'count'}); };

async function run(fix: boolean) {
  const v = stubValidatingWebgpu();
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({canvas: v.canvas});
  await r.init();
  if (fix) expect(installGeometryDisposeRef(r)).toBe(true);
  const dev = (r.backend as unknown as {device: {createBuffer(d: {label?: string}): {destroyed?: boolean}}}).device;
  const buffers: {label: string; buf: {destroyed?: boolean}}[] = [];
  const cb = dev.createBuffer.bind(dev);
  dev.createBuffer = (d: {label?: string}) => { const buf = cb(d); buffers.push({label: d?.label ?? '', buf}); return buf; };
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  cam.position.set(0, 1.6, 6);
  cam.lookAt(0, 1, 0);
  scene.add(cam, new THREE.DirectionalLight(0xffffff, 1));
  const nodeFrame = (r as unknown as {_nodes: {nodeFrame: {update(): void}}})._nodes.nodeFrame;
  const frame = () => { nodeFrame.update(); r.render(scene, cam); };
  const RO = (r as unknown as {_objects: {_renderObjects: Set<object>; createRenderObject(...a: unknown[]): object}})._objects._renderObjects;
  // every render object this renderer creates, held weakly (reachable = not collected after a full GC in a later task)
  const refs: WeakRef<object>[] = [];
  const objects = (r as unknown as {_objects: {createRenderObject(...a: unknown[]): object}})._objects;
  const create = objects.createRenderObject.bind(objects);
  objects.createRenderObject = (...a: unknown[]) => { const ro = create(...a); refs.push(new WeakRef(ro)); return ro; };
  const reachable = async () => {
    await new Promise(res => setTimeout(res, 20)); // (a later task: the WeakRefs' keep-alive of their creating job is over)
    fullGc(ctor);
    let n = 0;
    for (const w of refs) { const o = w.deref(); if (o && !RO.has(o)) n++; }
    return n;
  };
  let ctor: unknown = null;

  const shared = new THREE.BoxGeometry(1, 1, 1);
  shared.getAttribute('position').name = 'shared-position';
  const goneMat = new THREE.MeshStandardMaterial({color: 0xaa4433, name: 'gone-material'});
  let gone: THREE.Mesh | null = new THREE.Mesh(shared, goneMat);
  gone.position.set(-1, 1, 0);
  scene.add(gone);
  frame(); // the first render object of `shared`: three's geometry listener captures this one
  const keep = new THREE.Mesh(shared, new THREE.MeshStandardMaterial({color: 0x8899aa, name: 'keep-material'}));
  keep.position.set(1, 1, 0);
  scene.add(keep);
  // an instanced mesh above the uniform-array limit: its instance matrix is a NODE attribute of its render object
  const instGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  instGeo.getAttribute('position').name = 'instanced-position';
  const inst = new THREE.InstancedMesh(instGeo, new THREE.MeshStandardMaterial({name: 'inst-material'}), 1200);
  for (let i = 0; i < inst.count; i++) inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation((i % 40) * 0.2 - 4, Math.floor(i / 40) * 0.2, -2));
  scene.add(inst);
  for (let i = 0; i < 3; i++) frame();
  ctor = ([...RO][0] as {constructor: unknown}).constructor;
  const before = {live: RO.size, disposedReachable: await reachable()};

  scene.remove(gone);
  goneMat.dispose(); // its render object disposed (shared geometry still drawn by `keep`)
  gone = null;
  for (let i = 0; i < 3; i++) frame();
  const after = {live: RO.size, disposedReachable: await reachable()};

  // the geometries' release: which GPU buffers three destroys
  const n0 = buffers.filter(b => b.buf.destroyed).length;
  scene.remove(keep, inst);
  shared.dispose();
  instGeo.dispose();
  const released = buffers.filter(b => b.buf.destroyed).length - n0;
  const labels = buffers.filter(b => b.buf.destroyed).map(b => b.label.replace(/\d+/g, '#')).filter(Boolean).sort(); // (three numbers binding buffers per page)
  return {before, after, released, labels, issues: v.log.issues, dropped: v.log.dropped};
}

describe('a disposed render object never stays alive with its geometry (render/geometryDisposeRef.ts)', () => {
  it('three alone: the shared geometry\'s dispose listener keeps the first, disposed render object reachable', async () => {
    const r = await run(false);
    expect(r.before.disposedReachable).toBe(0);
    expect(r.after.live).toBe(r.before.live - 1);
    expect(r.after.disposedReachable, 'the disposed render object is still reachable').toBe(1);
  }, 60_000);

  it('with installGeometryDisposeRef: it is collected; the geometries still release exactly three\'s GPU buffers', async () => {
    const base = await run(false);
    const weak = geometryDisposeRefStats.weak;
    const r = await run(true);
    expect(geometryDisposeRefStats.weak).toBeGreaterThan(weak);
    expect(r.after.live).toBe(r.before.live - 1);
    expect(r.after.disposedReachable, 'the disposed render object is collected').toBe(0);
    expect(r.released, 'the same GPU buffers released by the geometries\' dispose').toBe(base.released);
    expect(r.labels).toEqual(base.labels);
    expect(r.labels).toEqual(expect.arrayContaining(['shared-position', 'instanced-position']));
    expect(r.issues).toEqual([]);
    expect(r.dropped).toBe(0);
  }, 60_000);
});
