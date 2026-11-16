// Task rt-flashlight-compute-20261115-233136 (lane BVH): the BVH builder's invariants, the BLAS records, and the CPU reference
// traversal (render/rt/rtTrace.ts) against brute force and against three's own Raycaster.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {BLAS_MAX_LEAF, BLAS_TRI_FLOATS, BVH_MAX_DEPTH, BVH_NODE_FLOATS, BvhBuilder, TLAS_MAX_LEAF, TRI_COLOR_NONE, blasFor, buildBlas, buildBvh, f32Down, f32Up} from '../src/render/rt/bvh';
import {RT_INSTANCE_VEC4, RT_INST_DISABLED, RT_INST_PROXY, RT_TYPE_CAPSULE, type RtSceneBuffers} from '../src/render/rt/rtFormat';
import {RtScene} from '../src/render/rt/rtScene';
import {newRtHit, rtCapsule, rtTriangle, traceAny, traceClosest} from '../src/render/rt/rtTrace';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random boxes: uniform, clustered, or degenerate (identical / exponentially spaced). */
function boxes(n: number, kind: 'uniform' | 'clusters' | 'same' | 'exp', seed = 1): Float32Array {
  const r = rng(seed), b = new Float32Array(n * 6);
  const centres = Array.from({length: 6}, () => [r() * 100, r() * 20, r() * 100]);
  for (let i = 0; i < n; i++) {
    let x: number, y: number, z: number, s: number;
    if (kind === 'uniform') { x = r() * 100; y = r() * 100; z = r() * 100; s = r() * 2; }
    else if (kind === 'clusters') { const c = centres[i % centres.length]; x = c[0] + r() * 3; y = c[1] + r() * 3; z = c[2] + r() * 3; s = r() * 0.3; }
    else if (kind === 'same') { x = 5; y = 5; z = 5; s = 1; }
    else { x = Math.pow(1.5, i % 60) * 1e-3; y = 0; z = 0; s = 1e-4; }
    b[i * 6] = x; b[i * 6 + 1] = y; b[i * 6 + 2] = z; b[i * 6 + 3] = x + s; b[i * 6 + 4] = y + s * 0.5; b[i * 6 + 5] = z + s;
  }
  return b;
}

interface TreeCheck { leaves: number; maxLeafSeen: number; depth: number; visited: number }

/** Every invariant of a built tree (see bvh.ts): returns what it saw. */
function checkTree(nodes: Float32Array, nodeCount: number, order: Uint32Array, bounds: Float32Array, count: number, maxLeaf: number): TreeCheck {
  const U = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
  const seenPrim = new Uint8Array(count), seenNode = new Uint8Array(nodeCount);
  const perm = new Uint8Array(count);
  for (let k = 0; k < count; k++) { expect(order[k]).toBeLessThan(count); expect(perm[order[k]]).toBe(0); perm[order[k]] = 1; }
  let leaves = 0, maxLeafSeen = 0, depth = 0, visited = 0;
  const stack: [number, number][] = [[0, 0]];
  while (stack.length) {
    const [n, d] = stack.pop()!;
    expect(n).toBeLessThan(nodeCount);
    expect(seenNode[n]).toBe(0);
    seenNode[n] = 1;
    visited++;
    depth = Math.max(depth, d);
    const f = n * BVH_NODE_FLOATS, A = U[f + 3], B = U[f + 7];
    for (let k = 0; k < 3; k++) expect(nodes[f + k]).toBeLessThanOrEqual(nodes[f + 4 + k]);
    if (B === 0) {
      expect(A + 1).toBeLessThan(nodeCount);
      for (const c of [A, A + 1]) {
        const g = c * BVH_NODE_FLOATS;
        for (let k = 0; k < 3; k++) { expect(nodes[g + k]).toBeGreaterThanOrEqual(nodes[f + k]); expect(nodes[g + 4 + k]).toBeLessThanOrEqual(nodes[f + 4 + k]); }
        stack.push([c, d + 1]);
      }
    } else {
      expect(B).toBeGreaterThanOrEqual(1);
      expect(B).toBeLessThanOrEqual(maxLeaf);
      leaves++;
      maxLeafSeen = Math.max(maxLeafSeen, B);
      for (let k = A; k < A + B; k++) {
        expect(seenPrim[k]).toBe(0);
        seenPrim[k] = 1;
        const p = order[k] * 6;
        for (let q = 0; q < 3; q++) { expect(bounds[p + q]).toBeGreaterThanOrEqual(nodes[f + q]); expect(bounds[p + 3 + q]).toBeLessThanOrEqual(nodes[f + 4 + q]); }
      }
    }
  }
  expect(visited).toBe(nodeCount);
  for (let k = 0; k < count; k++) expect(seenPrim[k]).toBe(1);
  return {leaves, maxLeafSeen, depth, visited};
}

/** SAH cost of a tree (traversal = intersection = 1, relative to the root's area). */
function sahCost(nodes: Float32Array, nodeCount: number): number {
  const U = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
  const area = (f: number): number => { const dx = nodes[f + 4] - nodes[f], dy = nodes[f + 5] - nodes[f + 1], dz = nodes[f + 6] - nodes[f + 2]; return dx * dy + dy * dz + dz * dx; };
  const root = area(0);
  let c = 0;
  for (let n = 0; n < nodeCount; n++) {
    const f = n * BVH_NODE_FLOATS, a = area(f) / root;
    c += U[f + 7] === 0 ? a : a * U[f + 7];
  }
  return c;
}

/** A median-split tree (object median along the widest axis) in the same encoding: the SAH builder must beat it. */
function medianTree(bounds: Float32Array, count: number, maxLeaf: number): {nodes: Float32Array; nodeCount: number} {
  const nodes = new Float32Array(Math.max(1, 2 * count) * BVH_NODE_FLOATS), U = new Uint32Array(nodes.buffer);
  const order = Array.from({length: count}, (_, i) => i);
  let nodeCount = 1;
  const fill = (n: number, s: number, e: number): void => {
    const f = n * BVH_NODE_FLOATS;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = s; i < e; i++) { const p = order[i] * 6; x0 = Math.min(x0, bounds[p]); y0 = Math.min(y0, bounds[p + 1]); z0 = Math.min(z0, bounds[p + 2]); x1 = Math.max(x1, bounds[p + 3]); y1 = Math.max(y1, bounds[p + 4]); z1 = Math.max(z1, bounds[p + 5]); }
    nodes[f] = x0; nodes[f + 1] = y0; nodes[f + 2] = z0; nodes[f + 4] = x1; nodes[f + 5] = y1; nodes[f + 6] = z1;
    if (e - s <= maxLeaf) { U[f + 3] = s; U[f + 7] = e - s; return; }
    const ax = x1 - x0 >= y1 - y0 && x1 - x0 >= z1 - z0 ? 0 : y1 - y0 >= z1 - z0 ? 1 : 2;
    const sub = order.slice(s, e).sort((a, b) => (bounds[a * 6 + ax] + bounds[a * 6 + 3 + ax]) - (bounds[b * 6 + ax] + bounds[b * 6 + 3 + ax]));
    for (let i = s; i < e; i++) order[i] = sub[i - s];
    const L = nodeCount;
    nodeCount += 2;
    U[f + 3] = L; U[f + 7] = 0;
    const m = (s + e) >> 1;
    fill(L, s, m); fill(L + 1, m, e);
  };
  fill(0, 0, count);
  return {nodes, nodeCount};
}

describe('rt bvh builder', () => {
  it('keeps every invariant on uniform, clustered, identical and pathological inputs', () => {
    for (const kind of ['uniform', 'clusters', 'same', 'exp'] as const) {
      for (const n of [1, 2, 3, 5, 17, 300, 4000]) {
        for (const ml of [BLAS_MAX_LEAF, TLAS_MAX_LEAF]) {
          const b = boxes(n, kind, n * 7 + ml);
          const t = buildBvh(b, n, ml);
          const c = checkTree(t.nodes, t.nodeCount, t.order, b, n, ml);
          expect(c.depth).toBeLessThanOrEqual(BVH_MAX_DEPTH);
          expect(t.nodeCount).toBeLessThanOrEqual(2 * n - 1);
          expect(c.maxLeafSeen).toBeLessThanOrEqual(ml);
        }
      }
    }
  });

  it('holds the depth limit with a balanced fallback when the SAH would go deeper', () => {
    const n = 3000, b = boxes(n, 'exp', 3);
    const builder = new BvhBuilder(1, 12, 14);
    builder.begin(b, n);
    builder.run();
    expect(builder.depth).toBeLessThanOrEqual(14);
    expect(builder.forcedMedians).toBeGreaterThan(0);
    checkTree(builder.nodes, builder.nodeCount, builder.order, b, n, 1);
  });

  it('encodes nodes as [min, A, max, B] with u32 bit patterns', () => {
    // three far apart unit boxes on x: the SAH puts the two near ones under one child
    const b = new Float32Array([0, 0, 0, 1, 1, 1, 10, 0, 0, 11, 1, 1, 100, 0, 0, 101, 1, 1]);
    const t = buildBvh(b, 3, 1);
    const U = new Uint32Array(t.nodes.buffer);
    expect(t.nodeCount).toBe(5);
    // root: interior, B bits 0, A = 1 (children 1, 2), box = the union
    expect(U[7]).toBe(0);
    expect(U[3]).toBe(1);
    expect([...t.nodes.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect([...t.nodes.subarray(4, 7)]).toEqual([101, 1, 1]);
    // leaves: B = 1 as an integer bit pattern (not 1.0f), A = the position in the reordered array
    const leafB = [...Array(t.nodeCount).keys()].filter(n => U[n * 8 + 7] !== 0).map(n => U[n * 8 + 7]);
    expect(leafB).toEqual([1, 1, 1]);
    expect(t.nodes[7]).not.toBe(1); // (the float view of the bits is a denormal, never 1.0)
    const leafA = [...Array(t.nodeCount).keys()].filter(n => U[n * 8 + 7] !== 0).map(n => U[n * 8 + 3]).sort();
    expect(leafA).toEqual([0, 1, 2]);
  });

  it('beats a median split on the SAH and is deterministic and resumable', () => {
    for (const kind of ['clusters', 'uniform'] as const) {
      const n = 6000, b = boxes(n, kind, 11);
      const t = buildBvh(b, n, BLAS_MAX_LEAF);
      const med = medianTree(b, n, BLAS_MAX_LEAF);
      const sah = sahCost(t.nodes, t.nodeCount), mc = sahCost(med.nodes, med.nodeCount);
      expect(sah).toBeLessThan(mc * (kind === 'clusters' ? 0.9 : 1.0));
      const t2 = buildBvh(b, n, BLAS_MAX_LEAF);
      expect(Buffer.from(t2.nodes.buffer).equals(Buffer.from(t.nodes.buffer))).toBe(true);
      expect([...t2.order]).toEqual([...t.order]);
      // resumable in small steps: the same tree
      const s = new BvhBuilder(BLAS_MAX_LEAF);
      s.begin(b, n);
      let steps = 0;
      while (!s.run(500)) steps++;
      expect(steps).toBeGreaterThan(10);
      expect(Buffer.from(s.nodes.buffer, 0, s.nodeCount * 32).equals(Buffer.from(t.nodes.buffer))).toBe(true);
    }
  });

  it('rounds conservatively to f32', () => {
    for (const v of [0.1, -0.1, 1e-40, -1e-40, 123.456789, -98765.4321, 0]) {
      expect(f32Down(v)).toBeLessThanOrEqual(v);
      expect(f32Up(v)).toBeGreaterThanOrEqual(v);
      expect(Math.fround(f32Down(v))).toBe(f32Down(v));
      expect(f32Up(v) - f32Down(v)).toBeLessThanOrEqual(Math.abs(v) * 3e-7 + 3e-45);
    }
  });
});

/** The triangles of a geometry as three draws them (world-free), as sorted keys. */
function triKeys(tris: Float32Array, n: number): string[] {
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const f = k * BLAS_TRI_FLOATS;
    const v = [[tris[f], tris[f + 1], tris[f + 2]], [tris[f + 4], tris[f + 5], tris[f + 6]], [tris[f + 8], tris[f + 9], tris[f + 10]]].map(p => p.map(x => x.toFixed(4)).join(','));
    out.push(v.sort().join('|'));
  }
  return out.sort();
}

function geoKeys(g: THREE.BufferGeometry, start = 0, count = Infinity): string[] {
  const p = g.attributes.position, idx = g.index, out: string[] = [];
  const total = idx ? idx.count : p.count, e = Math.min(total, start + count);
  for (let i = start; i + 2 < e + 0.5 && i + 3 <= e; i += 3) {
    const vs = [0, 1, 2].map(k => { const v = idx ? idx.getX(i + k) : i + k; return [p.getX(v), p.getY(v), p.getZ(v)].map(x => x.toFixed(4)).join(','); });
    out.push(vs.sort().join('|'));
  }
  return out.sort();
}

describe('rt BLAS', () => {
  it('builds indexed, non-indexed, draw-ranged and interleaved geometry into the same triangles', () => {
    const box = new THREE.BoxGeometry(1, 2, 3, 2, 1, 1);
    const a = buildBlas(box, 1);
    expect(a.triCount).toBe(box.index!.count / 3);
    expect(triKeys(a.tris, a.triCount)).toEqual(geoKeys(box));
    checkTree(a.nodes, a.nodeCount, new Uint32Array(a.triCount).map((_, i) => i), (() => {
      const bb = new Float32Array(a.triCount * 6);
      for (let k = 0; k < a.triCount; k++) {
        const f = k * 12;
        for (let q = 0; q < 3; q++) { bb[k * 6 + q] = Math.min(a.tris[f + q], a.tris[f + 4 + q], a.tris[f + 8 + q]); bb[k * 6 + 3 + q] = Math.max(a.tris[f + q], a.tris[f + 4 + q], a.tris[f + 8 + q]); }
      }
      return bb;
    })(), a.triCount, BLAS_MAX_LEAF);
    const U = new Uint32Array(a.tris.buffer);
    for (let k = 0; k < a.triCount; k++) { expect(U[k * 12 + 3]).toBe(0); expect(U[k * 12 + 7]).toBe(TRI_COLOR_NONE); expect(U[k * 12 + 11]).toBe(0); }

    const flat = box.toNonIndexed();
    const b = buildBlas(flat, 1);
    expect(triKeys(b.tris, b.triCount)).toEqual(geoKeys(box));

    const ranged = box.clone();
    ranged.setDrawRange(6, 13); // (13: a partial triangle at the end is not drawn)
    const c = buildBlas(ranged, 1);
    expect(c.triCount).toBe(4);
    expect(triKeys(c.tris, c.triCount)).toEqual(geoKeys(box, 6, 12));

    // interleaved positions (stride 6: position + a dummy normal)
    const src = flat.attributes.position;
    const data = new Float32Array(src.count * 6);
    for (let i = 0; i < src.count; i++) { data[i * 6] = src.getX(i); data[i * 6 + 1] = src.getY(i); data[i * 6 + 2] = src.getZ(i); data[i * 6 + 3] = 9; }
    const ib = new THREE.InterleavedBuffer(data, 6);
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    const d = buildBlas(ig, 1);
    expect(triKeys(d.tris, d.triCount)).toEqual(geoKeys(box));
  });

  it('takes material slots from the groups (clamped), only for material arrays', () => {
    const box = new THREE.BoxGeometry(1, 1, 1); // 6 groups, materialIndex 0..5, 2 triangles each
    const slots = (g: THREE.BufferGeometry, mc: number, groups?: boolean): number[] => {
      const b = buildBlas(g, mc, {groups});
      const U = new Uint32Array(b.tris.buffer), s: number[] = [];
      for (let k = 0; k < b.triCount; k++) s.push(U[k * 12 + 3]);
      return s.sort((x, y) => x - y);
    };
    expect(slots(box, 6)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(slots(box, 3)).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(slots(box, 1)).toEqual(new Array(12).fill(0));
    expect(slots(box, 6, false)).toEqual(new Array(12).fill(0));
    // groups clipped by the draw range
    const g = box.clone();
    g.setDrawRange(0, 12);
    expect(slots(g, 6)).toEqual([0, 0, 1, 1]);
  });

  it('packs per-triangle mean vertex colours as linear RGBA8 and drops degenerate triangles', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, /* degenerate: */ 0, 0, 0, 1, 1, 1, 2, 2, 2, /* NaN: */ 0, 0, 0, NaN, 0, 0, 0, 0, 1], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const b = buildBlas(g, 1);
    expect(b.triCount).toBe(1);
    expect(b.dropped).toBe(2);
    const c = new Uint32Array(b.tris.buffer)[7];
    expect(c & 255).toBe(85); expect((c >>> 8) & 255).toBe(85); expect((c >>> 16) & 255).toBe(85); expect(c >>> 24).toBe(255);
    // a normalized Uint8 RGBA colour attribute
    const h = new THREE.BufferGeometry();
    h.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    h.setAttribute('color', new THREE.BufferAttribute(new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0]), 4, true));
    const c2 = new Uint32Array(buildBlas(h, 1).tris.buffer)[7];
    expect(c2 & 255).toBe(255); expect((c2 >>> 8) & 255).toBe(0); expect(c2 >>> 24).toBe(170);
  });

  it('caches per geometry until the positions change', () => {
    const g = new THREE.SphereGeometry(1, 8, 6);
    const a = blasFor(g, 1), b = blasFor(g, 1);
    expect(b).toBe(a);
    g.attributes.position.needsUpdate = true;
    const c = blasFor(g, 1);
    expect(c).not.toBe(a);
    expect(blasFor(g, 1)).toBe(c);
    g.setDrawRange(0, 30);
    const d = blasFor(g, 1);
    expect(d).not.toBe(c);
    expect(d.triCount).toBe(10);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------
// traversal

/** Brute force over every enabled instance and every triangle of its BLAS (leaves found by walking all nodes, no box tests). */
function brute(buf: RtSceneBuffers, o: THREE.Vector3, d: THREE.Vector3, tmin: number, tmax: number): {t: number; inst: number; tri: number} {
  const L = buf.layout, A = buf.tlas, AU = buf.tlasU32, NU = buf.blasNodesU32;
  let best = tmax, inst = -1, tri = -1;
  const all: number[] = [];
  for (let k = 0; k < L.staticInstanceCount; k++) all.push(k);
  const dynBase = (L.dynamicInstances - L.instances) / RT_INSTANCE_VEC4;
  for (let k = 0; k < L.dynamicInstanceCount; k++) all.push(dynBase + k);
  for (const k of all) {
    const v = (L.instances + RT_INSTANCE_VEC4 * k) * 4;
    if (AU[v + 14] & RT_INST_DISABLED) continue;
    if (AU[v + 15] === RT_TYPE_CAPSULE) {
      const t = rtCapsule(A, v, o.x, o.y, o.z, d.x, d.y, d.z, tmin, best);
      if (t < best) { best = t; inst = k; tri = -1; }
      continue;
    }
    const qx = A[v] * o.x + A[v + 1] * o.y + A[v + 2] * o.z + A[v + 3], qy = A[v + 4] * o.x + A[v + 5] * o.y + A[v + 6] * o.z + A[v + 7], qz = A[v + 8] * o.x + A[v + 9] * o.y + A[v + 10] * o.z + A[v + 11];
    const ex = A[v] * d.x + A[v + 1] * d.y + A[v + 2] * d.z, ey = A[v + 4] * d.x + A[v + 5] * d.y + A[v + 6] * d.z, ez = A[v + 8] * d.x + A[v + 9] * d.y + A[v + 10] * d.z;
    const stack = [AU[v + 12]];
    while (stack.length) {
      const n = stack.pop()!, f = n * 8;
      if (NU[f + 7] === 0) { stack.push(NU[f + 3], NU[f + 3] + 1); continue; }
      for (let t0 = NU[f + 3]; t0 < NU[f + 3] + NU[f + 7]; t0++) {
        const t = rtTriangle(buf.blasTris, t0 * 12, qx, qy, qz, ex, ey, ez, tmin, best);
        if (t < best) { best = t; inst = k; tri = t0; }
      }
    }
  }
  return {t: best, inst, tri};
}

/** A random scene: meshes of a few shared geometries under random transforms (incl. mirrored, non-uniform), instanced meshes. */
function randomScene(seed: number, opts: {instanced?: boolean; meshes?: number} = {}): {scene: THREE.Scene; meshes: THREE.Mesh[]} {
  const r = rng(seed), scene = new THREE.Scene(), meshes: THREE.Mesh[] = [];
  const geos: THREE.BufferGeometry[] = [new THREE.BoxGeometry(1, 1, 1), new THREE.SphereGeometry(0.6, 10, 8), new THREE.TorusKnotGeometry(0.5, 0.15, 48, 6), new THREE.PlaneGeometry(2, 2, 3, 3), new THREE.ConeGeometry(0.5, 1, 9).toNonIndexed()];
  // a random triangle soup
  const soup = new THREE.BufferGeometry(), sp: number[] = [];
  for (let i = 0; i < 300; i++) { const cx = r() * 4 - 2, cy = r() * 4 - 2, cz = r() * 4 - 2; for (let k = 0; k < 3; k++) sp.push(cx + r() * 0.6 - 0.3, cy + r() * 0.6 - 0.3, cz + r() * 0.6 - 0.3); }
  soup.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  geos.push(soup);
  const mats = [0.2, 0.5, 0.8].map(c => new THREE.MeshStandardMaterial({color: new THREE.Color(c, c * 0.5, 1 - c), metalness: 0, roughness: 1}));
  const group = new THREE.Group();
  group.position.set(1, 2, -3);
  group.rotation.set(0.3, 0.7, -0.2);
  scene.add(group);
  const place = (o: THREE.Object3D): void => {
    o.position.set(r() * 30 - 15, r() * 8, r() * 30 - 15);
    o.rotation.set(r() * 6, r() * 6, r() * 6);
    o.scale.set(0.5 + r() * 2, 0.5 + r() * 2, 0.5 + r() * 2);
    if (r() < 0.2) o.scale.x *= -1; // (mirrored)
  };
  const n = opts.meshes ?? 40;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geos[i % geos.length], mats[i % 3]);
    place(m);
    (i % 4 === 0 ? group : scene).add(m);
    meshes.push(m);
  }
  if (opts.instanced !== false) {
    for (let j = 0; j < 3; j++) {
      const im = new THREE.InstancedMesh(geos[j + 1], mats[j], 25);
      const d = new THREE.Object3D();
      for (let i = 0; i < 25; i++) {
        place(d);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        im.setColorAt(i, new THREE.Color(r(), r(), r()));
      }
      place(im);
      scene.add(im);
      meshes.push(im);
    }
  }
  scene.updateMatrixWorld(true);
  return {scene, meshes};
}

function randomRay(r: () => number, o: THREE.Vector3, d: THREE.Vector3): void {
  o.set(r() * 40 - 20, r() * 12 - 2, r() * 40 - 20);
  d.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
  if (r() < 0.1) d.set(0, r() < 0.5 ? 1 : -1, 0); // (axis-aligned: zero components)
  if (r() < 0.05) d.set(1, 0, 0);
  d.normalize();
}

describe('rt traversal', () => {
  it('equals brute force (closest + any hit) on random instanced, transformed scenes with capsules', () => {
    for (const seed of [1, 2, 3]) {
      const {scene} = randomScene(seed);
      const rt = new RtScene();
      rt.prepare([scene]);
      // some capsules through the dynamic tree, one instance moved into it, one disabled
      const r = rng(seed * 99);
      const bodies = new Float32Array(5 * 12);
      for (let i = 0; i < 12; i++) bodies.set([r() * 30 - 15, r() * 30 - 15, 0.2 + r() * 0.4, r() * 2, 2 + r() * 2], i * 5);
      const mover = scene.children.find(c => (c as THREE.Mesh).isMesh)!;
      mover.position.x += 0.5;
      scene.updateMatrixWorld(true);
      rt.sync(0.1, bodies, 12, 1000);
      const L = rt.buffers.layout;
      expect(L.dynamicInstanceCount).toBe(13);
      expect(L.staticInstanceCount).toBeGreaterThan(100);
      const o = new THREE.Vector3(), d = new THREE.Vector3(), hit = newRtHit();
      let hits = 0, capsuleHits = 0;
      for (let i = 0; i < 2500; i++) {
        randomRay(r, o, d);
        const tmax = r() < 0.3 ? 5 + r() * 20 : Infinity;
        const tmin = r() < 0.5 ? 0 : 0.05;
        const b = brute(rt.buffers, o, d, tmin, tmax);
        const h = traceClosest(rt.buffers, o, d, tmin, tmax, hit);
        if (b.inst < 0) { expect(h).toBeNull(); expect(traceAny(rt.buffers, o, d, tmin, tmax)).toBe(false); continue; }
        expect(h).not.toBeNull();
        expect(h!.t).toBe(b.t);
        expect(traceAny(rt.buffers, o, d, tmin, tmax)).toBe(true);
        // just short of the hit: nothing in between
        expect(traceAny(rt.buffers, o, d, tmin, b.t * (1 - 1e-9))).toBe(brute(rt.buffers, o, d, tmin, b.t * (1 - 1e-9)).inst >= 0);
        hits++;
        if (h!.triangle < 0) { capsuleHits++; expect(h!.flags & RT_INST_PROXY).toBe(RT_INST_PROXY); }
        expect(Math.hypot(h!.nx, h!.ny, h!.nz)).toBeCloseTo(1, 6);
      }
      expect(hits).toBeGreaterThan(400);
      expect(capsuleHits).toBeGreaterThan(3);
    }
  });

  it('agrees with three.js raycasting (transforms, instancing, mirrored), with geometric normals and albedo x tint', () => {
    const {scene, meshes} = randomScene(7, {meshes: 30});
    for (const m of meshes) for (const mat of [m.material].flat()) (mat as THREE.Material).side = THREE.DoubleSide;
    const rt = new RtScene();
    rt.prepare([scene]);
    const rc = new THREE.Raycaster();
    const r = rng(5), o = new THREE.Vector3(), d = new THREE.Vector3();
    let agree = 0, both = 0, total = 0;
    for (let i = 0; i < 3000; i++) {
      randomRay(r, o, d);
      rc.set(o, d);
      rc.near = 0; rc.far = Infinity;
      const ih = rc.intersectObjects(scene.children, true)[0];
      const h = traceClosest(rt.buffers, o, d, 0, Infinity);
      total++;
      if (!ih && !h) { agree++; continue; }
      if (!ih || !h) continue;
      if (Math.abs(ih.distance - h.t) < 1e-3 * Math.max(1, h.t)) {
        agree++;
        both++;
        // the geometric world normal, not face-forwarded: sign(det M) * normalize(cross(M e1, M e2))
        const obj = ih.object as THREE.Mesh, face = ih.face!;
        const world = new THREE.Matrix4().copy(obj.matrixWorld);
        if ((obj as THREE.InstancedMesh).isInstancedMesh) { const im = new THREE.Matrix4(); (obj as THREE.InstancedMesh).getMatrixAt(ih.instanceId!, im); world.multiply(im); }
        const p = obj.geometry.attributes.position;
        const a = new THREE.Vector3().fromBufferAttribute(p, face.a).applyMatrix4(world);
        const b = new THREE.Vector3().fromBufferAttribute(p, face.b).applyMatrix4(world);
        const c = new THREE.Vector3().fromBufferAttribute(p, face.c).applyMatrix4(world);
        const n = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).normalize().multiplyScalar(Math.sign(world.determinant()));
        expect(Math.abs(n.x - h.nx) + Math.abs(n.y - h.ny) + Math.abs(n.z - h.nz)).toBeLessThan(2e-3);
        // albedo: material colour (capped / diffuse share = colour here) x the instance colour
        const mat = obj.material as THREE.MeshStandardMaterial;
        const tint = new THREE.Color(1, 1, 1);
        if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).getColorAt(ih.instanceId!, tint);
        expect(h.r).toBeCloseTo(Math.min(0.8, mat.color.r) * tint.r, 5);
        expect(h.g).toBeCloseTo(Math.min(0.8, mat.color.g) * tint.g, 5);
        expect(h.b).toBeCloseTo(Math.min(0.8, mat.color.b) * tint.b, 5);
      }
    }
    expect(both).toBeGreaterThan(400);
    expect(agree / total).toBeGreaterThan(0.995);
  });

  it('traces capsules: origin inside skips, side and caps with outward normals, the body albedo', () => {
    const rt = new RtScene({bodyAlbedo: [0.3, 0.2, 0.1]});
    rt.prepare([new THREE.Scene()]);
    rt.sync(0, new Float32Array([2, 0, 0.5, 0, 1.8]), 1, 1);
    const B = rt.buffers;
    const side = traceClosest(B, new THREE.Vector3(-5, 1, 0), new THREE.Vector3(1, 0, 0), 0, 100)!;
    expect(side.t).toBeCloseTo(6.5, 6);
    expect([side.nx, side.ny, side.nz].map(v => +v.toFixed(6))).toEqual([-1, 0, 0]);
    expect([side.r, side.g, side.b].map(v => +v.toFixed(6))).toEqual([0.3, 0.2, 0.1]);
    expect(side.triangle).toBe(-1);
    const top = traceClosest(B, new THREE.Vector3(2.1, 5, 0.1), new THREE.Vector3(0, -1, 0), 0, 100)!;
    expect(top.t).toBeCloseTo(3.2, 5);
    expect(top.ny).toBe(1);
    const bottom = traceClosest(B, new THREE.Vector3(2, -3, 0), new THREE.Vector3(0, 1, 0), 0, 100)!;
    expect(bottom.t).toBeCloseTo(3, 6);
    expect(bottom.ny).toBe(-1);
    // the origin inside: skipped
    expect(traceClosest(B, new THREE.Vector3(2, 1, 0), new THREE.Vector3(1, 0, 0), 0, 100)).toBeNull();
    // tmin / tmax are strict
    expect(traceAny(B, new THREE.Vector3(-5, 1, 0), new THREE.Vector3(1, 0, 0), 0, 6.5)).toBe(false);
    expect(traceAny(B, new THREE.Vector3(-5, 1, 0), new THREE.Vector3(1, 0, 0), 0, 6.51)).toBe(true);
    // passing above / below
    expect(traceAny(B, new THREE.Vector3(-5, 1.9, 0), new THREE.Vector3(1, 0, 0), 0, 100)).toBe(false);
  });
});
