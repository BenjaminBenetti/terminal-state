// Persistent structural chips (iteration 06, Lane D): every bullet into a wall / floor / ceiling /
// ledge face leaves a local crater — a depth-tested instanced decal whose procedural shader draws an
// irregular chipped outline, the exposed substrate (cement under tile glaze, grey block under paint,
// fresh concrete), flaked surface edges in the surface's own colour, a dark bullet core, ambient
// occlusion and a concave bowl normal so the flashlight / baked light field shade it as a hole.
// Repeated hits on the same spot deepen and widen the crater instead of stacking new decals.
//
// Honest scope: big structural surfaces only CHIP (craters + flying chunks). There is no voxel /
// structural destruction: walls, floors and ceilings never open voids or change collision.
// Bounded: one InstancedMesh (1 draw call), CRATER_CAP slots, the oldest recycled when full.

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {Discard, Fn, atan, attribute, clamp, cos, cross, dot, float, length, materialColor, materialNormal, max, mix, modelViewMatrix, normalize, select, sin, smoothstep, step, uv, varying, vec2, vec3, vec4} from 'three/tsl';
import {addNodeHook} from '../render/nodeHooks';
import {dmgNoise, memoNode, type TNode} from './tsl';

export const CRATER_CAP = 220;
/** Node-hook key prefix on the crater material (stages `.color` / `.normal`, order 300). */
export const CRATER_HOOK = 'damage-craters-v1';

export interface Crater {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  size: number;
  depth: number;
  maxSize: number;
  hits: number;
  serial: number;
  slot: number;
}

export interface CraterSpec {
  /** Radius of a fresh crater (m) and the cap repeated hits can grow it to. */
  size: number;
  maxSize: number;
  /** Depth added per hit (0..1 of full). */
  depth: number;
  /** Exposed substrate colour and the surface colour of the flaked rim (linear). */
  substrate: THREE.Color;
  surface: THREE.Color;
  /** 0 crater, 1 gravel scatter (ballast: disturbed stones, no bowl), 2 glazed tile (sharp flaked glaze edge). */
  style: 0 | 1 | 2;
}

// ---------------------------------------------------------------------------------------------
// Iteration 13 (MAT-B): the crater shading as TSL nodes (was GLSL onBeforeCompile). Per-instance attributes:
//   aCrater (depth, seed, style, alive), aRim (rim / surface colour), aSub (exposed substrate colour; was instanceColor,
//   which node materials multiply AFTER colorNode and would tint the gravel scatter), aCrT / aCrB (the instance's local
//   X / Y axes: the decal's tangent frame, was modelViewMatrix * instanceMatrix * axis in the vertex shader).
// Fragment work mirrors the GLSL line by line: irregular chipped outline, substrate + AO bowl, flaked rim, dark core,
// gravel scatter, concave bowl normal in the decal tangent frame.

const aCrater = attribute('aCrater', 'vec4') as TNode;
const aRim = attribute('aRim', 'vec3') as TNode;
const aSub = attribute('aSub', 'vec3') as TNode;
/** View-space tangent / bitangent of the decal plane (vertex stage). */
const vCrT = varying(modelViewMatrix.mul(vec4(attribute('aCrT', 'vec3'), 0)).xyz) as TNode;
const vCrB = varying(modelViewMatrix.mul(vec4(attribute('aCrB', 'vec3'), 0)).xyz) as TNode;

/** Shared crater fields (fragment): P (-1..1 across the decal), outline, R = |P| / outline, inside mask. */
function craterShape(): {P: TNode; seed: TNode; style: TNode; depth: TNode; outline: TNode; R: TNode; inside: TNode} {
  const P = (uv() as TNode).mul(2).sub(1);
  const depth = aCrater.x, seed = aCrater.y.mul(37), style = aCrater.z;
  const ang = atan(P.y, P.x);
  const ap = vec3(cos(ang).mul(1.6), sin(ang).mul(1.6), seed);
  // irregular chipped outline: low + high frequency around the rim; tile: angular flakes
  const o0 = float(0.68).add(dmgNoise(ap).mul(0.2)).add(dmgNoise(ap.mul(3.1).add(7)).mul(0.12));
  const outline = select(style.greaterThan(1.5), mix(o0, float(0.78).add(step(0.5, dmgNoise(ap.mul(1.7).add(3))).mul(0.16)), 0.6), o0);
  const R = length(P).div(outline);
  const inside = smoothstep(0.92, 1.02, R).oneMinus();
  return {P, seed, style, depth, outline, R, inside};
}

/** Colour stage: substrate bowl / gravel scatter, alpha = inside x alive (discarded outside the outline). */
export function craterColorNode(prev: TNode | null): TNode {
  return memoNode(prev, 'crater-color', () => Fn(() => {
    const {P, seed, style, depth, R, inside} = craterShape();
    Discard(inside.mul(aCrater.w).lessThan(0.004));
    const base = vec4(prev ?? materialColor);
    const grain = dmgNoise(vec3(P.mul(22), seed)).toVar();
    const sub = aSub.mul(base.rgb);
    // gravel scatter: darker disturbed stones, no bowl
    const gravel = mix(aRim.mul(0.55), aRim.mul(1.1), step(0.55, grain));
    // crater: AO bowl in the substrate, flaked surface finish at the edge, dark bullet core
    const bowl = R.mul(R).oneMinus();
    const ao = mix(float(1), float(0.32), clamp(depth.mul(bowl).mul(1.25), 0, 1));
    const c0 = sub.mul(ao).mul(grain.mul(0.36).add(0.82));
    const rim = smoothstep(0.6, 0.95, R).mul(step(float(0.42).sub(style.mul(0.2)), dmgNoise(vec3(P.mul(9), seed.add(3)))));
    const c1 = mix(c0, aRim.mul(grain.mul(0.25).add(0.8)), rim.mul(0.75));
    const core = smoothstep(0.06, depth.mul(0.22).add(0.16), R).oneMinus();
    const c2 = mix(c1, vec3(0.018, 0.016, 0.014), core.mul(depth.mul(0.3).add(0.65)));
    const isGravel = style.greaterThan(0.5).and(style.lessThan(1.5));
    const col: TNode = select(isGravel, gravel, c2);
    const a = base.a.mul(inside).mul(aCrater.w).mul(select(isGravel, float(0.75), float(1)));
    return vec4(col, a);
  })());
}

/** Normal stage: concave bowl (h = -depth (1 - r^2) -> slope 2 depth r) plus chip roughness, in the decal tangent frame. */
export function craterNormalNode(prev: TNode | null): TNode {
  return memoNode(prev, 'crater-normal', () => Fn(() => {
    const {P, style, depth, outline, R} = craterShape();
    const n = normalize(vec3(prev ?? materialNormal)).toVar();
    const k = depth.mul(1.6);
    const g0 = P.mul(k.mul(2)).div(max(0.25, outline.mul(outline)));
    const g = g0.add(vec2(dmgNoise(vec3(P.mul(14), 1)), dmgNoise(vec3(P.mul(14), 9))).sub(0.5).mul(depth.add(0.3).mul(0.9)));
    const inner = smoothstep(0.85, 1.0, R).oneMinus();
    const nT: TNode = normalize(vec3(g.mul(inner).negate() as TNode, 1));
    const T: TNode = normalize(vCrT.sub(n.mul(dot(vCrT, n))));
    const c: TNode = cross(n, T);
    const B = normalize(c).mul(select(dot(c, vCrB).lessThan(0), float(-1), float(1)));
    const bent = normalize(T.mul(nT.x).add(B.mul(nT.y)).add(n.mul(nT.z)));
    // gravel scatter keeps the surface normal
    return select(style.lessThan(0.5).or(style.greaterThan(1.5)), bent, n);
  })());
}

export class CraterField {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Crater[] = [];
  private readonly aCrater: THREE.InstancedBufferAttribute;
  private readonly aRim: THREE.InstancedBufferAttribute;
  /** Iteration 13 (MAT-B): substrate colour (was instanceColor) and the decal tangent frame (instance X / Y axes). */
  private readonly aSub: THREE.InstancedBufferAttribute;
  private readonly aCrT: THREE.InstancedBufferAttribute;
  private readonly aCrB: THREE.InstancedBufferAttribute;
  private serial = 0;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly ax = new THREE.Vector3();
  private static readonly Z = new THREE.Vector3(0, 0, 1);
  /** Hits that deepened an existing crater (QA/tests). */
  merges = 0;

  constructor(readonly cap = CRATER_CAP) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const inst = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.aCrater = inst(4);
    this.aRim = inst(3);
    this.aSub = inst(3);
    this.aCrT = inst(3);
    this.aCrB = inst(3);
    geo.setAttribute('aCrater', this.aCrater);
    geo.setAttribute('aRim', this.aRim);
    geo.setAttribute('aSub', this.aSub);
    geo.setAttribute('aCrT', this.aCrT);
    geo.setAttribute('aCrB', this.aCrB);
    // Iteration 13 (MAT-B): node material + TSL stages (render/nodeHooks.ts, order 300 = damage)
    const mat = new MeshStandardNodeMaterial({color: 0xffffff, roughness: 0.96, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3});
    mat.name = 'damage-craters';
    addNodeHook(mat, {key: `${CRATER_HOOK}.color`, stage: 'color', order: 300, fn: prev => craterColorNode(prev)});
    addNodeHook(mat, {key: `${CRATER_HOOK}.normal`, stage: 'normal', order: 300, fn: prev => craterNormalNode(prev)});
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'damage-craters';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // stays visible at count 0: its pipeline builds with the station, not on the first hit
  }

  /**
   * A hit at `pos` on a face with `normal`: deepen / widen a crater already there (same face,
   * overlapping), else start a new one (recycling the oldest when full). Returns the crater.
   */
  hit(pos: THREE.Vector3, normal: THREE.Vector3, spec: CraterSpec, rand: () => number = Math.random): Crater {
    let best: Crater | null = null, bd = Infinity;
    for (const c of this.list) {
      if (c.normal.dot(normal) < 0.95) continue;
      const dx = pos.x - c.pos.x, dy = pos.y - c.pos.y, dz = pos.z - c.pos.z;
      const off = Math.abs(dx * normal.x + dy * normal.y + dz * normal.z);
      if (off > 0.03) continue;
      const d = Math.hypot(dx, dy, dz);
      if (d < c.size * 0.55 + spec.size * 0.35 && d < bd) { bd = d; best = c; }
    }
    if (best) {
      this.merges++;
      best.hits++;
      best.depth = Math.min(1, best.depth + spec.depth * (best.depth > 0.6 ? 0.5 : 1));
      best.size = Math.min(best.maxSize, best.size * 1.1 + spec.size * 0.18);
      best.pos.lerp(pos, 0.12);
      this.write(best, spec, rand, false);
      return best;
    }
    let slot: number;
    if (this.list.length < this.cap) slot = this.list.length;
    else {
      slot = this.next;
      this.next = (this.next + 1) % this.cap;
      const old = this.list.findIndex(c => c.slot === slot);
      if (old >= 0) this.list.splice(old, 1);
    }
    const c: Crater = {pos: pos.clone(), normal: normal.clone(), size: spec.size * (0.85 + rand() * 0.3), depth: Math.min(1, spec.depth * (0.8 + rand() * 0.4)), maxSize: spec.maxSize, hits: 1, serial: ++this.serial, slot};
    this.list.push(c);
    this.write(c, spec, rand, true);
    this.mesh.count = Math.max(this.mesh.count, slot + 1);
    return c;
  }

  private write(c: Crater, spec: CraterSpec, rand: () => number, fresh: boolean): void {
    this.q.setFromUnitVectors(CraterField.Z, c.normal);
    if (fresh) c.serial = c.serial || ++this.serial;
    // stable per-crater rotation from its serial
    this.q2.setFromAxisAngle(CraterField.Z, (c.serial * 2.399963) % (Math.PI * 2));
    this.q.multiply(this.q2);
    const d = c.size * 2;
    this.m.compose(new THREE.Vector3().copy(c.pos).addScaledVector(c.normal, 0.004), this.q, new THREE.Vector3(d, d, 1));
    this.mesh.setMatrixAt(c.slot, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    // Iteration 13 (MAT-B): the decal tangent frame for the bowl normal (instance-local axes, the mesh is not scaled)
    this.ax.set(1, 0, 0).applyQuaternion(this.q);
    this.aCrT.setXYZ(c.slot, this.ax.x, this.ax.y, this.ax.z);
    this.ax.set(0, 1, 0).applyQuaternion(this.q);
    this.aCrB.setXYZ(c.slot, this.ax.x, this.ax.y, this.ax.z);
    this.aCrT.needsUpdate = this.aCrB.needsUpdate = true;
    if (fresh) {
      this.aSub.setXYZ(c.slot, spec.substrate.r, spec.substrate.g, spec.substrate.b);
      this.aRim.setXYZ(c.slot, spec.surface.r, spec.surface.g, spec.surface.b);
      this.aSub.needsUpdate = this.aRim.needsUpdate = true;
    }
    this.aCrater.setXYZW(c.slot, c.depth, fresh ? rand() : this.aCrater.getY(c.slot), spec.style, 1);
    this.aCrater.needsUpdate = true;
  }

  get count(): number {
    return this.list.length;
  }

  clear(): void {
    this.list.length = 0;
    this.next = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
