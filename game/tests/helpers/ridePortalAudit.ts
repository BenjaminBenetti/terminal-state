// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane PORTAL): what the station DRAWS, triangle by triangle and instance by
// instance — honouring every mechanism the ride portal runtime (world/ridePortalRuntime.ts) hides with: `visible` up the parent chain,
// the geometry's draw range (in index units, or vertices without an index) and collapsed instance matrices. A snapshot of that state
// (bit-exact: index objects and contents, draw ranges, instance matrix bytes, visible flags) and an audit of a cut against it.
import * as THREE from 'three';
import {boxOverlaps, cutHides, type PortalCut} from '../../src/world/ridePortal';

/** Everything a cut may touch, as it is now (copies). */
export interface DrawSnapshot {
  visible: Map<THREE.Object3D, boolean>;
  index: Map<THREE.BufferGeometry, {attr: THREE.BufferAttribute | null; bytes: Uint8Array | null}>;
  range: Map<THREE.BufferGeometry, [number, number]>;
  instances: Map<THREE.InstancedMesh, {count: number; bytes: Uint8Array}>;
  /** World-space bounds of each mesh (non-instanced: geometry box x matrixWorld). */
  bounds: Map<THREE.Mesh, THREE.Box3>;
}

const skip = (o: THREE.Object3D): boolean => !!(o.userData.ridePortal || o.userData.trainTransit);

const bytesOf = (a: ArrayLike<number> & {buffer: ArrayBufferLike; byteOffset: number; byteLength: number}): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();

export function snapshot(roots: readonly THREE.Object3D[]): DrawSnapshot {
  const s: DrawSnapshot = {visible: new Map(), index: new Map(), range: new Map(), instances: new Map(), bounds: new Map()};
  for (const r of roots) r.traverse(o => {
    s.visible.set(o, o.visible);
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    if (!s.index.has(g)) s.index.set(g, {attr: g.index, bytes: g.index ? bytesOf(g.index.array as Uint32Array) : null});
    s.range.set(g, [g.drawRange.start, g.drawRange.count]);
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) s.instances.set(im, {count: im.count, bytes: bytesOf(im.instanceMatrix.array as Float32Array)});
    else {
      if (!g.boundingBox) g.computeBoundingBox();
      s.bounds.set(m, g.boundingBox!.clone().applyMatrix4(m.matrixWorld));
    }
  });
  return s;
}

const same = (a: Uint8Array | null, b: Uint8Array | null): boolean => {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Differences between two snapshots of the same roots (empty: bit-exact). */
export function diff(a: DrawSnapshot, b: DrawSnapshot): string[] {
  const out: string[] = [];
  for (const [o, v] of a.visible) if (b.visible.get(o) !== v) out.push(`visible ${o.name || o.type} ${v} -> ${b.visible.get(o)}`);
  if (a.visible.size !== b.visible.size) out.push(`objects ${a.visible.size} -> ${b.visible.size}`);
  for (const [g, e] of a.index) { const f = b.index.get(g); if (!f || f.attr !== e.attr || !same(e.bytes, f.bytes)) out.push(`index of ${g.uuid.slice(0, 8)}`); }
  for (const [g, r] of a.range) { const q = b.range.get(g); if (!q || q[0] !== r[0] || q[1] !== r[1]) out.push(`drawRange ${r} -> ${q}`); }
  for (const [im, e] of a.instances) { const f = b.instances.get(im); if (!f || f.count !== e.count || !same(e.bytes, f.bytes)) out.push(`instances of ${im.name}`); }
  return out;
}

/** Effective visibility (the object and every ancestor). */
export function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

const _m = new THREE.Matrix4(), _b = new THREE.Box3();
export interface Tri { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

/** World bounds of triangle `t` of non-instanced mesh `m`. */
export function triBounds(m: THREE.Mesh, t: number, out: Tri): Tri {
  const g = m.geometry, idx = g.index, pos = g.attributes.position as THREE.BufferAttribute, e = m.matrixWorld.elements;
  out.x0 = out.y0 = out.z0 = Infinity; out.x1 = out.y1 = out.z1 = -Infinity;
  for (let k = 0; k < 3; k++) {
    const v = idx ? idx.getX(t * 3 + k) : t * 3 + k, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (X < out.x0) out.x0 = X; if (X > out.x1) out.x1 = X; if (Y < out.y0) out.y0 = Y; if (Y > out.y1) out.y1 = Y; if (Z < out.z0) out.z0 = Z; if (Z > out.z1) out.z1 = Z;
  }
  return out;
}

/** Is an instance matrix (16 floats at `o`) collapsed (its 3x3 zero: nothing drawn)? */
export function collapsed(a: ArrayLike<number>, o: number): boolean {
  let s = 0;
  for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) s += Math.abs(a[o + k]);
  return s < 1e-20;
}

/** World bounds of instance `i` of `im` with matrix bytes `arr`. */
export function instBounds(im: THREE.InstancedMesh, arr: Float32Array, i: number, out: THREE.Box3): THREE.Box3 {
  const g = im.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  _m.fromArray(arr, i * 16).premultiply(im.matrixWorld);
  return out.copy(g.boundingBox!).applyMatrix4(_m);
}

export interface CutAudit {
  /** Drawn now, though the cut rule hides them (must be 0). */
  violations: number;
  /** Drawn before, hidden now, though the cut rule keeps them (collateral: a whole object / instance reaching outside the box). */
  collateral: number;
  /** ... of which on the station side of a front plane (must be 0: nothing on the station side is ever hidden). */
  stationSide: number;
  hiddenTriangles: number; hiddenInstances: number; hiddenObjects: number;
  /** Kept drawn although they reach into a box: they straddle a front plane (the rule keeps them whole) — count, and how far beyond the PORTAL plane they reach. */
  straddlers: number; reach: number; far: string;
  /** Examples of each failure (name: bounds). */
  examples: string[];
}

/**
 * Audit what the roots draw now against `base` (their state before the cut) for the cuts in force (`planes`: each cut's portal plane
 * x, for the straddlers' reach). A triangle / instance is judged by its own world bounds.
 */
export function audit(roots: readonly THREE.Object3D[], base: DrawSnapshot, cuts: readonly PortalCut[], planes: readonly number[]): CutAudit {
  const r: CutAudit = {violations: 0, collateral: 0, stationSide: 0, hiddenTriangles: 0, hiddenInstances: 0, hiddenObjects: 0, straddlers: 0, reach: 0, far: '', examples: []};
  const hides = (b: Tri): boolean => cuts.some(c => cutHides(c, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1));
  const inAny = (b: Tri): number => cuts.findIndex(c => boxOverlaps(c.box, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1));
  const station = (b: Tri): boolean => cuts.some(c => (c.out > 0 ? b.x0 < c.front - 0.01 : b.x1 > c.front + 0.01) && boxOverlaps(c.box, b.x0 - 50, b.y0, b.z0, b.x1 + 50, b.y1, b.z1));
  const ex = (s: string) => { if (r.examples.length < 12) r.examples.push(s); };
  const t: Tri = {x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0};
  const shownAt = (o: THREE.Object3D, snap: DrawSnapshot | null): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!(snap ? snap.visible.get(p) ?? p.visible : p.visible)) return false;
    return true;
  };
  for (const root of roots) root.traverse(o => {
    if (skip(o)) return;
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.attributes.position) return;
    const was = shownAt(o, base), now = shownAt(o, null);
    if (!was && !now) return;
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      const b0 = base.instances.get(im);
      if (!b0) return;
      const A = new Float32Array(b0.bytes.buffer.slice(0)), B = im.instanceMatrix.array as Float32Array;
      let hid = false;
      for (let i = 0; i < Math.max(b0.count, im.count); i++) {
        const dw = was && i < b0.count && !collapsed(A, i * 16), dn = now && i < im.count && !collapsed(B, i * 16);
        if (dw && !dn) {
          instBounds(im, A, i, _b);
          const bb = {x0: _b.min.x, y0: _b.min.y, z0: _b.min.z, x1: _b.max.x, y1: _b.max.y, z1: _b.max.z};
          r.hiddenInstances++; hid = true;
          if (!hides(bb)) { r.collateral++; if (station(bb)) r.stationSide++; ex(`collateral instance ${im.name}#${i}`); }
        } else if (dn) {
          instBounds(im, B, i, _b);
          const bb = {x0: _b.min.x, y0: _b.min.y, z0: _b.min.z, x1: _b.max.x, y1: _b.max.y, z1: _b.max.z};
          if (hides(bb)) { r.violations++; ex(`drawn instance ${im.name}#${i} ${_b.min.x.toFixed(2)}..${_b.max.x.toFixed(2)}`); }
          else { const k = inAny(bb); if (k >= 0) { r.straddlers++; const d = cuts[k].out > 0 ? bb.x1 - planes[k] : planes[k] - bb.x0; if (d > r.reach) { r.reach = d; r.far = `${im.name}#${i}`; } } }
        }
      }
      void hid;
      return;
    }
    const g = m.geometry, nT = Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    const bw = base.bounds.get(m) ?? new THREE.Box3().setFromObject(m);
    const rangeNow = now ? [Math.floor(g.drawRange.start / 3), Math.min(nT, Math.floor((g.drawRange.start + Math.min(g.drawRange.count, nT * 3)) / 3))] : [0, 0];
    const br = base.range.get(g) ?? [0, Infinity];
    const rangeWas = was ? [Math.floor(br[0] / 3), Math.min(nT, Math.floor((br[0] + Math.min(br[1], nT * 3)) / 3))] : [0, 0];
    const overl = cuts.some(c => boxOverlaps(c.box, bw.min.x, bw.min.y, bw.min.z, bw.max.x, bw.max.y, bw.max.z));
    if (!overl && rangeNow[0] === rangeWas[0] && rangeNow[1] === rangeWas[1]) return;
    if (!now && was) r.hiddenObjects++;
    for (let k = rangeWas[0]; k < rangeWas[1]; k++) {
      const dn = k >= rangeNow[0] && k < rangeNow[1];
      triBounds(m, k, t);
      if (!dn) {
        r.hiddenTriangles++;
        if (!hides(t)) { r.collateral++; if (station(t)) r.stationSide++; ex(`collateral tri ${m.name}#${k}`); }
      } else if (hides(t)) { r.violations++; ex(`drawn tri ${m.name}#${k} x ${t.x0.toFixed(2)}..${t.x1.toFixed(2)} y ${t.y0.toFixed(2)}..${t.y1.toFixed(2)} z ${t.z0.toFixed(2)}..${t.z1.toFixed(2)}`); }
      else { const c = inAny(t); if (c >= 0) { r.straddlers++; const d = cuts[c].out > 0 ? t.x1 - planes[c] : planes[c] - t.x0; if (d > r.reach) { r.reach = d; r.far = `${m.name}#${k}`; } } }
    }
  });
  return r;
}
