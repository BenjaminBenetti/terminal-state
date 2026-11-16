// Task rt-flashlight-compute-20261115-233136 (lane BVH): the traced scene (render/rt/rtScene.ts) — the inventory contract, the per-
// frame static / dynamic TLAS management, caps, the upload protocol's dirty spans, and its cost.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {RT_INSTANCE_VEC4, RT_INST_DISABLED, RT_INST_PROXY, type RtSceneBuffers} from '../src/render/rt/rtFormat';
import {RT_SCENE, RtScene, rtExcludeReason} from '../src/render/rt/rtScene';
import {traceAny, traceClosest} from '../src/render/rt/rtTrace';
import {drainSync} from '../src/core/pacedBuild';

const std = (c = 0x808080): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({color: c, metalness: 0, roughness: 1});
const DOWN = new THREE.Vector3(0, -1, 0);
const at = (x: number, z: number, y = 10): THREE.Vector3 => new THREE.Vector3(x, y, z);
/** What a straight-down ray at (x, z) hits first (null: nothing). */
const down = (b: RtSceneBuffers, x: number, z: number) => traceClosest(b, at(x, z), DOWN, 0, 100);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Every tlas vec4 that changed since `before` lies inside a dirty span (unless the layout was replaced). */
function expectDirtyCovers(b: RtSceneBuffers, before: Uint32Array, layoutVersion: number): number {
  if (b.layoutVersion !== layoutVersion) return -1;
  let changed = 0;
  const bad: number[] = [];
  for (let v = 0; v < b.layout.vec4Count; v++) {
    let diff = false;
    for (let k = 0; k < 4; k++) if (b.tlasU32[v * 4 + k] !== before[v * 4 + k]) diff = true;
    if (!diff) continue;
    changed++;
    let inside = false;
    for (let i = 0; i < b.tlasDirtyCount; i++) if (v >= b.tlasDirty[i * 2] && v < b.tlasDirty[i * 2 + 1]) inside = true;
    if (!inside && bad.length < 5) bad.push(v);
  }
  expect(bad).toEqual([]);
  return changed;
}

describe('rt scene inventory', () => {
  it('traces exactly the lit opaque, visible, unskinned meshes; prunes bones and skipped subtrees', () => {
    const scene = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1);
    const a = mesh(box, std(), 0, 0, 0);
    const transparent = mesh(box, new THREE.MeshStandardMaterial({transparent: true, opacity: 0.5}), 2);
    const basic = mesh(box, new THREE.MeshBasicMaterial(), 4);
    const noDepth = mesh(box, new THREE.MeshStandardMaterial({depthWrite: false}), 6);
    const mixed = mesh(box, [std(), new THREE.MeshStandardMaterial({transparent: true})], 8);
    const skinned = new THREE.SkinnedMesh(box, std());
    const displacedMat = std();
    (displacedMat as unknown as {positionNode: unknown}).positionNode = {};
    const displaced = mesh(box, displacedMat, 10);
    const morphGeo = box.clone();
    morphGeo.morphAttributes.position = [box.attributes.position.clone()];
    const morph = mesh(morphGeo, std(), 12);
    const hiddenGroup = new THREE.Group();
    hiddenGroup.visible = false;
    hiddenGroup.add(mesh(box, std(), 14));
    const hidden = mesh(box, std(), 16);
    hidden.visible = false;
    const bone = new THREE.Bone();
    bone.add(mesh(box, std(), 18)); // (a prop held by a skeleton: a character's)
    const fx = new THREE.Group();
    fx.name = 'fx';
    fx.add(mesh(box, std(), 20));
    const points = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), new THREE.PointsMaterial());
    const im = new THREE.InstancedMesh(box, std(), 10);
    im.count = 5;
    const d = new THREE.Object3D();
    for (let i = 0; i < 10; i++) { d.position.set(i * 2, 0, 30); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
    im.setMatrixAt(2, new THREE.Matrix4().makeScale(0, 0, 0)); // (a hidden instance)
    scene.add(a, transparent, basic, noDepth, mixed, skinned, displaced, morph, hiddenGroup, hidden, bone, fx, points, im);
    scene.updateMatrixWorld(true);

    const rt = new RtScene({skip: o => o.name === 'fx'});
    const st = rt.prepare([scene]);
    expect(st.excluded).toMatchObject({material: 4, skinned: 1, displaced: 1, morph: 1, character: 1, skipped: 1});
    expect(rt.debugEntries(a)).toEqual([{state: 'static', staticSlot: expect.any(Number), inst: -1}]);
    for (const o of [transparent, basic, noDepth, mixed, skinned, displaced, morph, hidden, hiddenGroup.children[0], bone.children[0], fx.children[0]]) expect(rt.debugEntries(o)).toBeNull();
    const ie = rt.debugEntries(im)!;
    expect(ie.map(e => e.state)).toEqual(['static', 'static', 'hidden', 'static', 'static']);
    expect(st.instances.static).toBe(5);
    expect(st.triangles).toBe(12); // (one shared box BLAS)
    expect(st.blasCount).toBe(1);
    // the traced ones are hit, the others not
    expect(down(rt.buffers, 0, 0)?.t).toBeCloseTo(9.5, 6);
    for (const x of [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]) expect(down(rt.buffers, x, 0)).toBeNull();
    expect(down(rt.buffers, 2, 30)?.t).toBeCloseTo(9.5, 6);
    expect(down(rt.buffers, 4, 30)).toBeNull(); // (the zero-scale instance)
    expect(down(rt.buffers, 12, 30)).toBeNull(); // (instance 6: past count)
    expect(rtExcludeReason(a)).toBeNull();
  });

  it('finds what is added later under the scene root, and shares BLAS across scenes through the session cache', () => {
    const geo = new THREE.TorusKnotGeometry(1, 0.3, 64, 8);
    const s1 = new THREE.Scene();
    s1.add(mesh(geo, std(), 0, 0, 0));
    const r1 = new RtScene();
    const st1 = r1.prepare([s1]);
    const s2 = new THREE.Scene();
    s2.add(mesh(geo, std(), 5, 0, 0));
    const r2 = new RtScene();
    const st2 = r2.prepare([s2]);
    expect(st1.blasBuilt + st1.blasReused).toBe(1);
    expect(st2.blasBuilt).toBe(0);
    expect(st2.blasReused).toBe(1);
    // a group added after the prepare: found by the next re-inventory (every RT_SCENE.inventoryInterval), traced from the dynamic
    // tree until the next static rebuild (at most RT_SCENE.staticInterval later) takes it in
    const dummy = mesh(new THREE.BoxGeometry(1, 1, 1), std(), -20, 0, 0);
    s2.add(dummy);
    s2.updateMatrixWorld(true);
    r2.sync(0, null, 0, 50); // (inventory at 0: the dummy; a static rebuild takes it at once)
    r2.sync(0.5, null, 0, 50); // (the next inventory)
    s2.remove(dummy);
    r2.sync(0.55, null, 0, 50); // (the dummy gone: a static rebuild at 0.55)
    const late = new THREE.Group();
    late.add(mesh(new THREE.BoxGeometry(2, 2, 2), std(), 20, 0, 0));
    s2.add(late);
    s2.updateMatrixWorld(true);
    r2.sync(0.9, null, 0, 50);
    expect(down(r2.buffers, 20, 0)).toBeNull(); // (not before the next inventory)
    r2.sync(1.0, null, 0, 50);
    expect(down(r2.buffers, 20, 0)?.t).toBeCloseTo(9, 6);
    expect(r2.debugEntries(late.children[0])![0].state).toBe('moving');
    r2.sync(1.1, null, 0, 50);
    expect(r2.debugEntries(late.children[0])![0].state).toBe('static');
    expect(down(r2.buffers, 20, 0)?.t).toBeCloseTo(9, 6);
  });
});

describe('rt scene per frame', () => {
  it('moves a mesh into the dynamic tree (static slot disabled) and back to the static tree once it rests', () => {
    const scene = new THREE.Scene();
    const m = mesh(new THREE.BoxGeometry(1, 1, 1), std(), 0, 0, 0);
    scene.add(m, mesh(new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2), std(), 0, -2, 0));
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    rt.sync(0, null, 0, 5);
    expect(down(B, 0, 0)!.t).toBeCloseTo(9.5, 6);
    const slot = rt.debugEntries(m)![0].staticSlot;
    B.markUploaded();
    const before = B.tlasU32.slice(), lv = B.layoutVersion;
    m.position.x = 5;
    scene.updateMatrixWorld(true);
    rt.sync(0.1, null, 0, 5);
    expect(rt.debugEntries(m)![0].state).toBe('moving');
    expect(B.tlasU32[(B.layout.instances + RT_INSTANCE_VEC4 * slot) * 4 + 14] & RT_INST_DISABLED).toBe(RT_INST_DISABLED);
    expect(B.layout.dynamicInstanceCount).toBe(1);
    expect(down(B, 0, 0)!.t).toBeCloseTo(12, 6); // (the floor: the box left)
    const h = down(B, 5, 0)!;
    expect(h.t).toBeCloseTo(9.5, 6);
    expect(h.instance).toBeGreaterThanOrEqual((B.layout.dynamicInstances - B.layout.instances) / RT_INSTANCE_VEC4);
    expect(expectDirtyCovers(B, before, lv)).toBeGreaterThan(0);
    // still moving for a while, at rest after RT_SCENE.restSeconds
    rt.sync(0.6, null, 0, 5);
    rt.sync(1.0, null, 0, 5);
    expect(rt.debugEntries(m)![0].state).toBe('moving');
    rt.sync(0.1 + RT_SCENE.restSeconds + 0.05, null, 0, 5);
    expect(rt.debugEntries(m)![0].state).toBe('static');
    expect(B.layout.dynamicInstanceCount).toBe(0);
    expect(down(B, 5, 0)!.t).toBeCloseTo(9.5, 6);
    expect(down(B, 5, 0)!.instance).toBeLessThan(B.layout.staticInstanceCount);
    expect(down(B, 0, 0)!.t).toBeCloseTo(12, 6);
  });

  it('moves one InstancedMesh instance (setMatrixAt + needsUpdate) and keeps the others static; follows instanceColor', () => {
    const scene = new THREE.Scene(), im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff), 4);
    const d = new THREE.Object3D();
    for (let i = 0; i < 4; i++) { d.position.set(i * 3, 0, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, new THREE.Color(1, 1, 1)); }
    scene.add(im);
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    d.position.set(3, 0, 10); d.updateMatrix();
    im.setMatrixAt(1, d.matrix);
    im.instanceMatrix.needsUpdate = true;
    im.setColorAt(2, new THREE.Color(0.5, 0.25, 1));
    im.instanceColor!.needsUpdate = true;
    rt.sync(0.1, null, 0, 5);
    expect(rt.debugEntries(im)!.map(e => e.state)).toEqual(['static', 'moving', 'static', 'static']);
    expect(down(B, 3, 0)).toBeNull();
    expect(down(B, 3, 10)!.t).toBeCloseTo(9.5, 6);
    const c = down(B, 6, 0)!;
    expect([c.r, c.g, c.b].map(v => +v.toFixed(4))).toEqual([0.4, 0.2, 0.8]); // (0.8 cap x tint)
  });

  it('drops hidden / removed meshes at once and forgets them at the next inventory and static rebuild', () => {
    const scene = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1);
    const a = mesh(box, std(), 0), b = mesh(box, std(), 3), group = new THREE.Group();
    group.add(b);
    scene.add(a, group);
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    rt.sync(0, null, 0, 5);
    expect(B.layout.staticInstanceCount).toBe(2);
    group.visible = false;
    rt.sync(0.1, null, 0, 5);
    expect(down(B, 3, 0)).toBeNull();
    group.visible = true;
    rt.sync(0.2, null, 0, 5);
    expect(down(B, 3, 0)!.t).toBeCloseTo(9.5, 6);
    scene.remove(a);
    rt.sync(0.3, null, 0, 5);
    expect(down(B, 0, 0)).toBeNull();
    rt.sync(0.9, null, 0, 5); // (inventory: gone; static rebuild drops it)
    expect(rt.debugEntries(a)).toBeNull();
    rt.sync(2.0, null, 0, 5);
    expect(B.layout.staticInstanceCount).toBe(1);
    expect(down(B, 3, 0)!.t).toBeCloseTo(9.5, 6);
    // a material that turns transparent leaves at once
    (b.material as THREE.Material) = new THREE.MeshStandardMaterial({transparent: true});
    rt.sync(2.1, null, 0, 5);
    expect(down(B, 3, 0)).toBeNull();
    expect(rt.debugEntries(b)).toBeNull();
  });

  it('leaves a few removed meshes as disabled slots, rebuilding for them alone once they are a staticGarbageShare', () => {
    const scene = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1), ms: THREE.Mesh[] = [];
    for (let i = 0; i < 40; i++) { const m = mesh(box, std(), i * 2, 0, 0); ms.push(m); scene.add(m); }
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    const r0 = rt.stats().staticRebuilds, need = Math.ceil(40 * RT_SCENE.staticGarbageShare);
    let t = 0;
    for (let k = 0; k < need; k++) {
      scene.remove(ms[k]);
      for (let f = 0; f < 90; f++, t += 1 / 60) rt.sync(t, null, 0, 5);
      expect(down(B, k * 2, 0)).toBeNull(); // (gone at once: its slot disabled)
      expect(rt.stats().staticRebuilds).toBe(k + 1 < need ? r0 : r0 + 1);
    }
    expect(B.layout.staticInstanceCount).toBe(40 - need);
    for (let i = need; i < 40; i++) expect(down(B, i * 2, 0)!.t).toBeCloseTo(9.5, 6);
  });

  it('builds the static rebuild across frames over a snapshot: what moves or goes meanwhile stays traced right', () => {
    const scene = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1), ms: THREE.Mesh[] = [];
    for (let i = 0; i < 600; i++) { const m = mesh(box, std(), (i % 30) * 3, 0, Math.floor(i / 30) * 3); ms.push(m); scene.add(m); }
    scene.updateMatrixWorld(true);
    const rt = new RtScene({staticBudgetMs: 0}), B = rt.buffers;
    rt.prepare([scene]);
    const [a, c, d, f] = [ms[0], ms[1], ms[2], ms[599]];
    a.position.z = -6; // (a: moves, then rests into the pending rebuild)
    scene.updateMatrixWorld(true);
    rt.sync(0.1, null, 0, 5);
    expect(rt.debugEntries(a)![0].state).toBe('moving');
    let t = 1.2;
    rt.sync(t, null, 0, 5); // (a has rested: a rebuild starts, one chunk a frame)
    expect(rt.stats().staticBuildPending).toBe(true);
    expect(rt.debugEntries(a)![0].state).toBe('moving'); // (still traced from the dynamic tree until the commit)
    // meanwhile c and f (one end of the recs is listed by the first chunk, the other later) move and d is removed
    c.position.z = -9;
    f.position.z = -12;
    scene.remove(d);
    scene.updateMatrixWorld(true);
    const rebuilds = rt.stats().staticRebuilds;
    let frames = 0;
    const check = (): void => {
      expect(down(B, 0, -6)?.t).toBeCloseTo(9.5, 6);
      expect(down(B, 3, -9)?.t).toBeCloseTo(9.5, 6);
      expect(down(B, 3, 0)).toBeNull();
      expect(down(B, 6, 0)).toBeNull();
      expect(down(B, 9, 0)?.t).toBeCloseTo(9.5, 6);
      expect(down(B, 87, -12)?.t).toBeCloseTo(9.5, 6);
      expect(down(B, 87, 57)).toBeNull();
    };
    while (rt.stats().staticBuildPending) { t += 0.01; rt.sync(t, null, 0, 5); check(); frames++; expect(frames).toBeLessThan(500); }
    expect(frames).toBeGreaterThan(2);
    expect(rt.stats().staticRebuilds).toBe(rebuilds + 1);
    expect(rt.debugEntries(a)![0].state).toBe('static');
    expect(rt.debugEntries(c)![0].state).toBe('moving');
    expect(rt.debugEntries(c)![0].staticSlot).toBe(-1);
    // (c, d, f: listed before they changed -> written DISABLED; listed after -> not taken. Live slots: the 597 others)
    const disabledSlots = (): number => {
      let k = 0;
      for (let i = 0; i < B.layout.staticInstanceCount; i++) if (B.tlasU32[(B.layout.instances + RT_INSTANCE_VEC4 * i) * 4 + 14] & RT_INST_DISABLED) k++;
      return k;
    };
    expect(B.layout.staticInstanceCount - disabledSlots()).toBe(597);
    expect(disabledSlots()).toBeGreaterThan(0);
    // c rests: the next rebuild takes it and drops the disabled slots
    for (t += 0.5; t < 4; t += 0.05) { rt.sync(t, null, 0, 5); check(); }
    expect(rt.stats().staticBuildPending).toBe(false);
    expect(rt.debugEntries(c)![0].state).toBe('static');
    expect(rt.debugEntries(f)![0].state).toBe('static');
    expect(B.layout.staticInstanceCount).toBe(599);
    expect(B.layout.dynamicInstanceCount).toBe(0);
    expect(disabledSlots()).toBe(0);
  });

  it('keeps tint / material changes made while a static rebuild is pending, and every write inside a dirty span', () => {
    const scene = new THREE.Scene(), n = 700, im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff), n);
    const d = new THREE.Object3D(), white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) { d.position.set((i % 35) * 3, 0, Math.floor(i / 35) * 3); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, white); }
    const p = mesh(new THREE.BoxGeometry(1, 1, 1), std(0x808080), -20, 0, 0);
    scene.add(im, p);
    scene.updateMatrixWorld(true);
    const rt = new RtScene({staticBudgetMs: 0}), B = rt.buffers;
    rt.prepare([scene]);
    rt.sync(0, null, 0, 5);
    d.position.set(0, 0, -6); d.updateMatrix();
    im.setMatrixAt(0, d.matrix);
    im.instanceMatrix.needsUpdate = true;
    rt.sync(0.1, null, 0, 5);
    let t = 1.2;
    rt.sync(t, null, 0, 5);
    expect(rt.stats().staticBuildPending).toBe(true);
    // while it is pending: instance 5 gets a tint, p a new (red) material
    im.setColorAt(5, new THREE.Color(0.5, 0.25, 1));
    im.instanceColor!.needsUpdate = true;
    p.material = std(0xff0000);
    const rgb = (x: number, z: number): number[] => { const h = down(B, x, z)!; return [h.r, h.g, h.b].map(v => +v.toFixed(4)); };
    let frames = 0;
    while (rt.stats().staticBuildPending || frames === 0) {
      t += 0.01;
      B.markUploaded();
      const before = B.tlasU32.slice(), lv = B.layoutVersion;
      rt.sync(t, null, 0, 5);
      expectDirtyCovers(B, before, lv);
      expect(rgb(15, 0)).toEqual([0.4, 0.2, 0.8]);
      expect(rgb(-20, 0)).toEqual([0.8, 0, 0]);
      expect(down(B, 0, -6)?.t).toBeCloseTo(9.5, 6);
      expect(down(B, 0, 0)).toBeNull();
      expect(++frames).toBeLessThan(500);
    }
    expect(frames).toBeGreaterThan(2);
    expect(rt.debugEntries(im)![0].state).toBe('static');
    expect(rt.debugEntries(im)![5].state).toBe('static');
    expect(rgb(15, 0)).toEqual([0.4, 0.2, 0.8]);
    expect(rgb(-20, 0)).toEqual([0.8, 0, 0]);
    expect(down(B, 15, 0)!.instance).toBeLessThan(B.layout.staticInstanceCount);
    // slots are unique and every static entry has one
    const slots = new Set<number>();
    for (const e of [...rt.debugEntries(im)!, ...rt.debugEntries(p)!]) { expect(e.staticSlot).toBeGreaterThanOrEqual(0); slots.add(e.staticSlot); }
    expect(slots.size).toBe(n + 1);
  });

  it('traces the bodies as PROXY capsules from the dynamic tree, frame by frame', () => {
    const rt = new RtScene({bodyAlbedo: [0.1, 0.2, 0.3]}), B = rt.buffers;
    rt.prepare([new THREE.Scene()]);
    const bodies = new Float32Array([0, 0, 0.3, 0, 1.7, 4, 0, 0.3, 0, 1.7, 0, 0, -1, 0, 1, /* bad */ 8, 0, 0.3, 2, 1]);
    rt.sync(0, bodies, 4, 1);
    expect(B.layout.dynamicInstanceCount).toBe(2);
    expect(rt.stats().instances.capsules).toBe(2);
    const h = down(B, 4, 0)!;
    expect(h.t).toBeCloseTo(8.3, 5);
    expect(h.flags & RT_INST_PROXY).toBe(RT_INST_PROXY);
    expect([h.r, h.g, h.b].map(v => +v.toFixed(5))).toEqual([0.1, 0.2, 0.3]);
    rt.sync(0.016, bodies, 0, 1);
    expect(B.layout.dynamicInstanceCount).toBe(0);
    expect(down(B, 4, 0)).toBeNull();
  });

  it('rebuilds a changed geometry (old shape kept until the new BLAS is ready) at most every rebuildInterval', () => {
    const scene = new THREE.Scene(), geo = new THREE.BoxGeometry(1, 1, 1), m = mesh(geo, std(), 0);
    scene.add(m);
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    rt.sync(0, null, 0, 5);
    geo.translate(0, 2, 0);
    geo.attributes.position.needsUpdate = true;
    rt.sync(0.1, null, 0, 50);
    expect(down(B, 0, 0)!.t).toBeCloseTo(7.5, 5);
    geo.translate(0, 2, 0);
    geo.attributes.position.needsUpdate = true;
    rt.sync(0.2, null, 0, 50); // (too soon: the previous shape stays)
    expect(down(B, 0, 0)!.t).toBeCloseTo(7.5, 5);
    rt.sync(0.1 + RT_SCENE.rebuildInterval + 0.01, null, 0, 50);
    expect(down(B, 0, 0)!.t).toBeCloseTo(5.5, 5);
  });

  it('builds a big new mesh across frames within the budget, never at budget 0', () => {
    const scene = new THREE.Scene();
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    const big = mesh(new THREE.SphereGeometry(1, 256, 160), std(), 0, 0, 0);
    scene.add(big);
    scene.updateMatrixWorld(true);
    rt.sync(0, null, 0, 0);
    expect(rt.stats().pendingBuilds).toBe(1);
    expect(down(B, 0, 0)).toBeNull();
    let frames = 0;
    while (rt.stats().pendingBuilds && frames < 2000) { rt.sync(0.01 * ++frames, null, 0, 0.5); }
    expect(frames).toBeGreaterThan(2);
    expect(frames).toBeLessThan(2000);
    expect(down(B, 0, 0)!.t).toBeCloseTo(9, 2);
    expect(rt.stats().triangles).toBeGreaterThan(80000);
  });
});

describe('rt scene caps, dirty spans, cost', () => {
  it('leaves out what exceeds the caps and counts it by reason', () => {
    const scene = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1), sphere = new THREE.SphereGeometry(1, 16, 12);
    scene.add(mesh(box, std(), 0), mesh(box, std(), 3), mesh(sphere, std(), 6));
    scene.updateMatrixWorld(true);
    const rt = new RtScene({maxTriangles: 30, dynamicInstanceCap: 2});
    const st = rt.prepare([scene]);
    expect(st.triangles).toBe(12);
    expect(st.omitted.meshes.triangles).toBe(1);
    expect(st.omitted.triangles.triangles).toBe(sphere.index!.count / 3);
    expect(down(rt.buffers, 6, 0)).toBeNull();
    rt.sync(0, new Float32Array([10, 0, 0.3, 0, 2, 11, 0, 0.3, 0, 2, 12, 0, 0.3, 0, 2]), 3, 1);
    expect(rt.buffers.layout.dynamicInstanceCount).toBe(2);
    expect(rt.stats().omitted.dynamic).toBe(1);
    const small = new RtScene({maxBlasTriBytes: 100 * 48});
    expect(small.prepare([scene]).omitted.meshes.blasTriBytes).toBe(1);
  });

  it('reports what changed through versions and dirty spans; nothing in a steady frame', () => {
    const scene = new THREE.Scene();
    for (let i = 0; i < 50; i++) scene.add(mesh(new THREE.BoxGeometry(1, 1 + i * 0.01, 1), std(0x102030 * (i % 7)), i * 2, 0, 0));
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    rt.sync(0, null, 0, 5);
    B.markUploaded();
    const bv = B.blasVersion, tv = B.tlasVersion;
    for (let f = 1; f <= 20; f++) rt.sync(f * 0.016, null, 0, 5);
    expect(B.blasVersion).toBe(bv);
    expect(B.tlasVersion).toBe(tv);
    expect(B.tlasDirtyCount).toBe(0);
    // a new mesh: appended BLAS span, dirty tlas covering every change
    const nodes0 = B.blasNodeCount, tris0 = B.blasTriCount, before = B.tlasU32.slice(), lv = B.layoutVersion, av = B.blasArrayVersion;
    scene.add(mesh(new THREE.ConeGeometry(1, 2, 12), std(), 0, 0, 10));
    scene.updateMatrixWorld(true);
    rt.sync(1, null, 0, 50);
    expect(B.blasVersion).toBeGreaterThan(bv);
    if (B.blasArrayVersion === av) {
      expect(B.blasDirtyNodeStart).toBe(nodes0);
      expect(B.blasDirtyNodeEnd).toBe(B.blasNodeCount);
      expect(B.blasDirtyTriStart).toBe(tris0);
      expect(B.blasDirtyTriEnd).toBe(B.blasTriCount);
    }
    expectDirtyCovers(B, before, lv);
    expect(down(B, 0, 10)).not.toBeNull();
    expect(rt.stats().instances.static).toBe(51);
    // a move, then the static rebuild that takes it back: every change inside a dirty span
    B.markUploaded();
    let snap = B.tlasU32.slice(), lvs = B.layoutVersion;
    scene.children[3].position.y += 1;
    scene.updateMatrixWorld(true);
    rt.sync(1.7, null, 0, 50);
    expect(expectDirtyCovers(B, snap, lvs)).toBeGreaterThan(0);
    B.markUploaded();
    snap = B.tlasU32.slice(); lvs = B.layoutVersion;
    rt.sync(1.7 + RT_SCENE.restSeconds + 0.1, null, 0, 50);
    expect(rt.stats().staticRebuilds).toBeGreaterThan(2);
    expect(expectDirtyCovers(B, snap, lvs)).toBeGreaterThan(0);
    expect(rt.stats().instances.dynamic).toBe(0);
  });

  it('compacts the BLAS streams once removed geometry wastes a quarter of them, still tracing what is left', () => {
    const scene = new THREE.Scene(), ms: THREE.Mesh[] = [];
    for (let i = 0; i < 30; i++) { const m = mesh(new THREE.SphereGeometry(0.5, 48, 28), std(), i * 2, 0, 0); ms.push(m); scene.add(m); }
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    const per = rt.stats().triangles / 30;
    for (let i = 0; i < 26; i++) scene.remove(ms[i]);
    rt.sync(0, null, 0, 5); // (inventory: 26 gone, their BLAS dead — sync never compacts: a copy of every live BLAS)
    expect(rt.stats()).toMatchObject({compactions: 0, deadTriangles: 26 * per, triangles: 30 * per});
    for (let t = 0.1; t < 2; t += 0.1) rt.sync(t, null, 0, 5);
    expect(rt.stats().compactions).toBe(0);
    for (let i = 0; i < 30; i++) expect(down(B, i * 2, 0) !== null).toBe(i >= 26);
    B.markUploaded();
    const st = rt.settle(); // (a loading step: compacts)
    expect(st.compactions).toBe(1);
    expect(st.triangles).toBe(4 * per);
    expect(st.deadTriangles).toBe(0);
    expect(B.blasDirtyTriStart).toBe(0);
    expect(B.blasDirtyTriEnd).toBe(4 * per);
    for (let i = 0; i < 30; i++) expect(down(B, i * 2, 0) !== null).toBe(i >= 26);
  });

  it('prepares as labelled paced steps and clears', () => {
    const scene = new THREE.Scene();
    for (let i = 0; i < 400; i++) scene.add(mesh(new THREE.SphereGeometry(0.5, 24, 16), std(), i % 20, 0, Math.floor(i / 20)));
    scene.updateMatrixWorld(true);
    const rt = new RtScene();
    const labels = new Set<string>();
    let yields = 0, longest = 0;
    const g = rt.prepareSteps([scene]);
    for (;;) {
      const t = performance.now(), r = g.next();
      longest = Math.max(longest, performance.now() - t);
      if (r.done) break;
      yields++;
      if (typeof r.value === 'string') labels.add(r.value);
    }
    expect([...labels]).toEqual(['rt-inventory', 'rt-blas', 'rt-tlas']);
    expect(yields).toBeGreaterThan(6);
    expect(longest, 'paced: no step much longer than RT_SCENE.stepMs').toBeLessThan(60);
    const st = rt.stats();
    expect(st.instances.static).toBe(400);
    expect(st.prepareMs).toBeGreaterThan(0);
    expect(st.prepareBlasMs).toBeLessThanOrEqual(st.prepareMs);
    expect(drainSync(new RtScene().prepareSteps([scene])).triangles).toBe(st.triangles);
    rt.clear();
    expect(rt.buffers.layout.staticInstanceCount).toBe(0);
    expect(rt.buffers.blasTriCount).toBe(0);
    expect(traceAny(rt.buffers, at(0, 0), DOWN, 0, 100)).toBe(false);
    rt.sync(0, null, 0, 5); // (not prepared: nothing)
    expect(rt.stats().inventories).toBe(0);
  });

  it('keeps a steady frame cheap over a few thousand entries', () => {
    const scene = new THREE.Scene(), geos = [new THREE.BoxGeometry(1, 1, 1), new THREE.SphereGeometry(0.5, 8, 6), new THREE.CylinderGeometry(0.3, 0.3, 1, 8)];
    for (let i = 0; i < 1500; i++) {
      const g = new THREE.Group();
      g.position.set(i % 40, 0, Math.floor(i / 40));
      g.add(mesh(geos[i % 3], std(), 0, 0, 0));
      scene.add(g);
    }
    const im = new THREE.InstancedMesh(geos[0], std(), 1000);
    scene.add(im);
    scene.updateMatrixWorld(true);
    const rt = new RtScene();
    rt.prepare([scene]);
    const bodies = new Float32Array(32 * 5);
    for (let i = 0; i < 32; i++) bodies.set([i, -5, 0.3, 0, 1.7], i * 5);
    const us: number[] = [];
    for (let f = 0; f < 120; f++) { rt.sync(f / 60, bodies, 32, 2); us.push(rt.stats().lastSyncUs); }
    us.sort((a, b) => a - b);
    const median = us[us.length >> 1];
    expect(rt.stats().entries).toBe(2500);
    expect(rt.stats().instances.capsules).toBe(32);
    expect(median).toBeLessThan(5000); // (Node, CI: generous; typically a few hundred µs — see the lane's measurement)
  });
});

describe('rt scene loading: settle, and bounded frames after it', () => {
  it('settles what the station added after the prepare as labelled paced steps, leaving nothing for sync', () => {
    const scene = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1);
    const floor = mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), std(), 0, -2, 0);
    const keep = mesh(box, std(), 0, 0, 0), gone = mesh(new THREE.BoxGeometry(1, 1, 1), std(), 4, 0, 0), mover = mesh(box, std(), 8, 0, 0);
    const reshaped = mesh(new THREE.BoxGeometry(1, 1, 1), std(), 40, 0, 0);
    scene.add(floor, keep, gone, mover, reshaped);
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    expect(rt.settle().inventories).toBe(0); // (before a prepare: nothing)
    rt.prepare([scene]);
    // what the station adds once its lighting is made: a group with a big uncached mesh, a cached one and an InstancedMesh; a prop
    // goes, one moves, one changes shape (rebuilt now, whatever its rebuildInterval)
    const late = new THREE.Group();
    const big = mesh(new THREE.SphereGeometry(1, 200, 120), std(), 20, 0, 0);
    const cached = mesh(box, std(0x404040), 12, 0, 0);
    const im = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1, 10), std(), 6);
    const d = new THREE.Object3D();
    for (let i = 0; i < 6; i++) { d.position.set(30 + i * 2, 0, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
    late.add(big, cached, im);
    scene.add(late);
    scene.remove(gone);
    mover.position.z = 5;
    reshaped.geometry.translate(0, 2, 0);
    reshaped.geometry.attributes.position.needsUpdate = true;
    const built0 = rt.stats().blasBuilt;
    const labels: string[] = [];
    let yields = 0, longest = 0;
    const g = rt.settleSteps();
    for (;;) {
      const t = performance.now(), r = g.next();
      longest = Math.max(longest, performance.now() - t);
      if (r.done) break;
      yields++;
      if (typeof r.value === 'string') labels.push(r.value);
    }
    expect(labels).toEqual(['rt-settle']);
    expect(yields).toBeGreaterThan(3);
    expect(longest, 'paced: no step much longer than RT_SCENE.stepMs').toBeLessThan(60);
    const st = rt.stats();
    expect(st).toMatchObject({pendingBuilds: 0, staticBuildPending: false, blasBuilt: built0 + 3}); // (sphere, cone, the new box shape)
    expect(st.instances).toMatchObject({static: 12, dynamic: 0, moving: 0, hidden: 0});
    expect(st.settleMs).toBeGreaterThan(0);
    for (const o of [floor, keep, mover, reshaped, big, cached, im]) {
      for (const e of rt.debugEntries(o)!) { expect(e.state).toBe('static'); expect(e.staticSlot).toBeGreaterThanOrEqual(0); }
    }
    expect(rt.debugEntries(gone)).toBeNull();
    expect(down(B, 0, 0)!.t).toBeCloseTo(9.5, 6);
    expect(down(B, 4, 0)!.t).toBeCloseTo(12, 6); // (gone: the floor)
    expect(down(B, 8, 0)!.t).toBeCloseTo(12, 6);
    expect(down(B, 8, 5)!.t).toBeCloseTo(9.5, 6);
    expect(down(B, 40, 0)!.t).toBeCloseTo(7.5, 5);
    expect(down(B, 20, 0)!.t).toBeCloseTo(9, 2);
    expect(down(B, 12, 0)!.t).toBeCloseTo(9.5, 6);
    for (let i = 0; i < 6; i++) expect(down(B, 30.1 + i * 2, 0)!.t).toBeLessThan(11);
    // the first frames (sync's game clock): no walk at once (settle walked it all) — one an interval later, finding nothing new; no
    // build, rebuild or upload follows
    B.markUploaded();
    const bv = B.blasVersion, tv = B.tlasVersion, av = B.blasArrayVersion, inv = st.inventories;
    for (let f = 0; f < 40; f++) {
      rt.sync(123.4 + f / 60, null, 0, 2);
      const s1 = rt.stats();
      expect(s1).toMatchObject({blasBuilt: st.blasBuilt, staticRebuilds: st.staticRebuilds, pendingBuilds: 0, staticBuildPending: false, compactions: st.compactions});
      expect(s1.instances.moving).toBe(0);
      expect(s1.inventories).toBe(f / 60 < RT_SCENE.inventoryInterval ? inv : inv + 1);
    }
    expect([B.blasVersion, B.tlasVersion, B.blasArrayVersion, B.tlasDirtyCount]).toEqual([bv, tv, av, 0]);
  });

  it('finds a late small mesh (a dropped pickup) within the inventory interval of play', () => {
    const scene = new THREE.Scene();
    scene.add(mesh(new THREE.BoxGeometry(1, 1, 1), std(), 0, 0, 0));
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    rt.settle();
    let now = 50;
    for (let f = 0; f < 15; f++) { rt.sync(now, null, 0, 2); now += 1 / 60; }
    const pickup = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 12), std(), 3, 0, 0);
    scene.add(pickup);
    scene.updateMatrixWorld(true);
    const dropped = now;
    while (!down(B, 3, 0) && now < dropped + 2) { rt.sync(now, null, 0, 2); now += 1 / 60; }
    expect(down(B, 3, 0)!.t).toBeCloseTo(9.85, 5);
    expect(now - dropped).toBeLessThanOrEqual(RT_SCENE.inventoryInterval + 2 / 60);
  });

  it('keeps every frame bounded while a big late mesh is built and packed and the streams grow, and when a cached one is packed', () => {
    const geo = new THREE.SphereGeometry(1, 600, 256); // (306 k triangles)
    const run = (): {frames: number; worst: number; median: number; grew: boolean; built: number} => {
      const scene = new THREE.Scene();
      scene.add(mesh(new THREE.BoxGeometry(1, 1, 1), std(), 0, 0, 0));
      scene.updateMatrixWorld(true);
      const rt = new RtScene(), B = rt.buffers;
      rt.prepare([scene]);
      rt.settle();
      const built0 = rt.stats().blasBuilt;
      let now = 10;
      for (let f = 0; f < 3; f++) { rt.sync(now, null, 0, 1); now += 1 / 60; }
      const big = mesh(geo, std(), 10, 0, 0);
      scene.add(big);
      scene.updateMatrixWorld(true);
      const av = B.blasArrayVersion, ms: number[] = [];
      while (ms.length < 20000) {
        rt.sync(now, null, 0, 1);
        now += 1 / 60;
        ms.push(rt.stats().lastSyncUs / 1000);
        expect(down(B, 0, 0)?.t).toBeCloseTo(9.5, 6); // (what was there stays traced throughout)
        if (rt.stats().pendingBuilds === 0 && down(B, 10, 0)) break;
      }
      expect(down(B, 10, 0)!.t).toBeCloseTo(9, 2);
      ms.sort((a, b) => a - b);
      return {frames: ms.length, worst: ms[ms.length - 1], median: ms[ms.length >> 1], grew: B.blasArrayVersion > av, built: rt.stats().blasBuilt - built0};
    };
    const fresh = run(), cached = run();
    expect(fresh.built).toBe(1);
    expect(cached.built).toBe(0);
    for (const r of [fresh, cached]) {
      expect(r.grew).toBe(true);
      // (budget 1 ms a frame + at most a chunk past it; Node / CI: generous — a whole build, packing or growth in one frame is far more)
      expect(r.worst).toBeLessThan(25);
      expect(r.median).toBeLessThan(5);
    }
    expect(fresh.frames).toBeGreaterThan(30);
  });

  it('reads a new material texture mean in the budgeted work, not in the frame whose walk finds it', () => {
    const scene = new THREE.Scene();
    scene.add(mesh(new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2), std(0xffffff), 0, -1, 0));
    scene.updateMatrixWorld(true);
    const rt = new RtScene(), B = rt.buffers;
    rt.prepare([scene]);
    rt.sync(0, null, 0, 2);
    const G = globalThis as {document?: unknown}, had = 'document' in G, old = G.document;
    let draws = 0;
    const px = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = 255; px[i + 1] = 128; px[i + 2] = 64; px[i + 3] = 255; }
    // (a stand-in 2D canvas: what damage/sample.ts draws a decoded image into)
    G.document = {createElement: () => ({width: 0, height: 0, getContext: () => ({drawImage: () => { draws++; }, getImageData: () => ({data: px})})})};
    try {
      const mat = new THREE.MeshStandardMaterial({color: 0xffffff, map: new THREE.Texture({width: 64, height: 64}), metalness: 0, roughness: 1});
      scene.add(mesh(new THREE.BoxGeometry(1, 1, 1), mat, 5, 0, 0));
      scene.updateMatrixWorld(true);
      rt.sync(0.5, null, 0, 0); // (the walk finds it; no budget: nothing read, nothing packed)
      expect(draws).toBe(0);
      expect(down(B, 5, 0)!.t).toBeCloseTo(11, 5); // (the floor)
      rt.sync(0.52, null, 0, 5);
      expect(draws).toBe(1);
      const h = down(B, 5, 0)!;
      expect(h.t).toBeCloseTo(9.5, 6);
      expect(h.r).toBeCloseTo(0.8, 5); // (white x the mean, capped)
      expect(h.g).toBeCloseTo(new THREE.Color().setRGB(0, 128 / 255, 0, THREE.SRGBColorSpace).g, 3);
      expect(h.b).toBeLessThan(0.1);
      // a loading step reads at once
      const mat2 = new THREE.MeshStandardMaterial({color: 0xffffff, map: new THREE.Texture({width: 64, height: 64}), metalness: 0, roughness: 1});
      scene.add(mesh(new THREE.BoxGeometry(1, 1, 1), mat2, 8, 0, 0));
      rt.settle();
      expect(draws).toBe(2);
      expect(down(B, 8, 0)!.g).toBeLessThan(0.3);
    } finally {
      if (had) G.document = old; else delete G.document;
    }
  });
});
