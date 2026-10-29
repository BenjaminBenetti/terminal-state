// Zombie flesh / clothing wounds (iteration 06, Lane D). Contract (lane-contracts.md, D <-> W):
//
//   installWounds(actor, opts) — called by game.ts right after each actor is built. Takes every
//   SkinnedMesh of the actor (body + each worn wearable), gives the actor its OWN material clones
//   (hitting one zombie never marks another; Lane F's chained shader hooks are carried over) and
//   patches them with a wound shader chunk that works in the meshes' BIND (rest) space: the
//   pre-skinning vertex position is passed to the fragment shader, so wounds stay glued to the
//   animated / ragdolled body and its clothing — no floating decals, no per-frame CPU work.
//
// A wound is a short segment along the bullet path in rest space (entry point found on the actual
// visible mesh surface, so the oversized hit capsules do not misplace it): fragments near the
// segment are eroded with a ragged, noise-modulated edge into torn dark flesh (exposed bone flecks
// on strong head / limb wounds), with a darkened blood-soaked halo; clothing tears fray and show
// skin then flesh underneath; vertices inside a wound are pushed inward (local loss of material).
// Thin limbs get exit wounds because the segment passes through. Wounds per zombie are bounded
// (WOUND_MAX) and nearby hits merge into one larger, deeper tear (shotgun = big tears).
//
// Bone-space conversion: the hit is mapped through the transform of the bone nearest to the hit
// point (the dominant influence there): rest = (M · B⁻¹ · bone.matrixWorld · boneInverse · B)⁻¹ · world.

import * as THREE from 'three';
import type {NodeMaterial} from 'three/webgpu';
import {Break, Fn, If, Loop, clamp, dot, float, int, length, materialColor as matColor, materialMetalness, materialNormal, materialRoughness, max, mix, normalLocal, positionGeometry, positionLocal, positionView, select, smoothstep, step, vec2, vec3, vec4} from 'three/tsl';
import {addNodeHook, nodeHookKeys} from '../render/nodeHooks';
import {DAMAGE_MATERIALS, zombieMeshClass, type DamageClass} from './materials';
import {dmgNoise, dmgPerturb, memoNode, objectData, toNodeMaterial, type TNode} from './tsl';

export const WOUND_MAX = 14;
export const WOUND_HOOK = 'zombie-wounds-v1';
const MODE: Record<string, number> = {flesh: 0, cloth: 1, rubber: 2, plastic: 2};

export interface WoundableActor {
  root: THREE.Object3D;
  /** Lane W: body + every worn wearable (SkinnedMeshes, or {mesh, slot, wearable} records). */
  meshes?: readonly (THREE.SkinnedMesh | {mesh: THREE.SkinnedMesh; slot?: string; wearable?: string | null})[];
}

export interface WoundOptions {
  /** Wounds kept per zombie (merging beyond). Default and maximum WOUND_MAX. */
  maxWounds?: number;
  /** Gore colour strength 0..1 (default 1; the user judges presentation). */
  gore?: number;
  /** Max inward displacement of the mesh at a wound (metres; default 0.03). */
  maxDepth?: number;
}

export interface WoundHit {
  /** World hit point (hit-capsule surface) and shot direction (unit). */
  point: THREE.Vector3;
  dir: THREE.Vector3;
  part?: 'head' | 'torso' | 'limb';
  /** Weapon damage of this pellet / bullet after falloff and part multiplier. */
  damage: number;
  /** Shotgun pellet (smaller each, merge into big tears). */
  pellet?: boolean;
}

export interface WoundResult {
  /** Layer the bullet entered first (outermost visible surface). */
  slot: string;
  cls: DamageClass;
  /** Entry point on that surface (world). */
  entry: THREE.Vector3;
  bone: string;
  merged: boolean;
  index: number;
  radius: number;
  strength: number;
  /** Average colour of the entered layer (cloth scraps / skin), linear. */
  color: THREE.Color;
  /** Iteration 07 (Lane K): index into `layers` of the entered layer, the entry / shot direction in its rest space and rest units per metre. */
  layer: number;
  restEntry: THREE.Vector3;
  restDir: THREE.Vector3;
  k: number;
}

interface Layer {
  mesh: THREE.SkinnedMesh;
  slot: string;
  cls: DamageClass;
  material: THREE.Material;
  color: THREE.Color;
}

interface Wound { c: THREE.Vector3; d: THREE.Vector3; r: number; len: number; back: number; strength: number; seed: number; depth: number; bone: string; age: number; torn?: boolean }

/** Visible-vertex rest positions + dominant bone per geometry (masked geometries share attributes). */
const vertCache = new WeakMap<THREE.BufferGeometry, {pos: Float32Array; bone: Int16Array}>();
function visibleVerts(g: THREE.BufferGeometry): {pos: Float32Array; bone: Int16Array} {
  let v = vertCache.get(g);
  if (v) return v;
  const p = g.attributes.position as THREE.BufferAttribute;
  const si = g.attributes.skinIndex as THREE.BufferAttribute | undefined, sw = g.attributes.skinWeight as THREE.BufferAttribute | undefined;
  const used = new Uint8Array(p.count);
  if (g.index) for (let i = 0; i < g.index.count; i++) used[g.index.getX(i)] = 1;
  else used.fill(1);
  let n = 0;
  for (let i = 0; i < used.length; i++) n += used[i];
  // ~6k samples max per layer keeps the per-hit entry search well under a millisecond
  const stride = Math.max(1, Math.ceil(n / 6000));
  const pos: number[] = [], bone: number[] = [];
  let k = 0;
  for (let i = 0; i < used.length; i++) {
    if (!used[i] || (k++ % stride)) continue;
    pos.push(p.getX(i), p.getY(i), p.getZ(i));
    let b = -1, bw = 0;
    if (si && sw) for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; b = si.getComponent(i, c); } }
    bone.push(b);
  }
  v = {pos: new Float32Array(pos), bone: new Int16Array(bone)};
  vertCache.set(g, v);
  return v;
}

/** Average (linear) base colour of a material: colour x texture mean (browser only; else the colour). */
const colorCache = new WeakMap<object, THREE.Color>();
export function materialColor(mat: THREE.Material | undefined, fallback = 0x6e6a5e): THREE.Color {
  const m = mat as THREE.MeshStandardMaterial | undefined;
  if (!m || !(m as THREE.MeshStandardMaterial).color) return new THREE.Color(fallback);
  const base = m.color.clone();
  const img = m.map?.image as (CanvasImageSource & {width?: number}) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return base;
  let avg = colorCache.get(img as object);
  if (!avg) {
    avg = new THREE.Color(1, 1, 1);
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const ctx = c.getContext('2d', {willReadFrequently: true})!;
      ctx.drawImage(img, 0, 0, 16, 16);
      const px = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 128 || px[i] + px[i + 1] + px[i + 2] < 12) continue; r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; }
      if (n) avg.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
    } catch { /* tainted / not drawable: plain colour */ }
    colorCache.set(img as object, avg);
  }
  return base.multiply(avg);
}

// ---------------------------------------------------------------------------------------------
// Iteration 13 (MAT-B): the wound shader as TSL node stages (was GLSL onBeforeCompile), order 300 (render/nodeHooks.ts).
// Bind (rest) space = the geometry's own `position` attribute (positionGeometry, before morphs / skinning), exactly the
// GLSL `transformed` at begin_vertex. The vertex dent moves the SKINNED position along the SKINNED (unnormalised)
// normal: skinning is affine per vertex, skin(p - n h) = skin(p) - L n h with L its linear part, and three's skinned
// normalLocal is exactly L n, so this equals the GLSL dent-before-skinning. The actor's wounds are per-object data
// (`mesh.userData.dmgWound`, shared by the actor's layers): one node graph per layer mode serves every zombie.
//
// Data (vec4): 0 (count, rest units per metre k, gore, 0) · 1.. A[WOUND_MAX] (centre, radius) · B[WOUND_MAX] (dir, length)
// · C[WOUND_MAX] (strength, seed, back, depth).
export const WOUND_DATA_KEY = 'dmgWound';
const W_A = 1, W_B = W_A + WOUND_MAX, W_C = W_B + WOUND_MAX;
/** vec4 per actor. */
export const WOUND_DATA = W_C + WOUND_MAX;

interface WoundShared { n: TNode; k: TNode; gore: TNode; disp(p: TNode): TNode; field(p: TNode): TNode; wf: TNode }
let woundShared: WoundShared | null = null;

function woundNodes(): WoundShared {
  if (woundShared) return woundShared;
  const D = objectData(WOUND_DATA_KEY, WOUND_DATA);
  const h = D.element(0);
  const n = int(h.x), k = h.y, gore = h.z;
  const each = (body: (A: TNode, B: TNode, C: TNode) => void) => Loop(WOUND_MAX, ({i}: {i: TNode}) => {
    If(i.greaterThanEqual(n), () => { Break(); });
    body(D.element(i.add(W_A)), D.element(i.add(W_B)), D.element(i.add(W_C)));
  });
  const disp = Fn(([p]: [TNode]) => {
    const acc = float(0).toVar();
    each((A, B, C) => {
      const rel = p.sub(A.xyz).toVar();
      const t = clamp(dot(rel, B.xyz), C.z.negate(), B.w);
      const d = length(rel.sub(B.xyz.mul(t)));
      acc.assign(max(acc, smoothstep(A.w.mul(0.2), A.w.mul(0.95), d).oneMinus().mul(C.w)));
    });
    return acc;
  }) as unknown as (p: TNode) => TNode;
  // x: torn core 0..1, y: blood halo, z: deep (dark cavity), w: strength-weighted core
  const field = Fn(([p]: [TNode]) => {
    const acc = vec4(0).toVar();
    each((A, B, C) => {
      const rel = p.sub(A.xyz).toVar();
      const t = clamp(dot(rel, B.xyz), C.z.negate(), B.w);
      const d = length(rel.sub(B.xyz.mul(t))).toVar();
      const q = p.mul(float(38).div(k)).add(C.y.mul(13)).toVar();
      const n1 = dmgNoise(q), n2 = dmgNoise(q.mul(2.7).add(5.1)).toVar();
      const rr = A.w.mul(float(0.7).add(n1.mul(0.42)).add(n2.mul(0.16))).toVar();
      const core = smoothstep(rr.mul(0.6), rr, d).oneMinus().toVar();
      const halo = smoothstep(rr, rr.mul(C.x.mul(0.5).add(1.55)).mul(n2.mul(0.3).add(0.85)), d).oneMinus();
      const deep = smoothstep(0, rr.mul(0.55), d).oneMinus();
      acc.x.assign(max(acc.x, core));
      acc.y.assign(max(acc.y, halo.mul(C.x.mul(0.55).add(0.45))));
      acc.z.assign(max(acc.z, deep.mul(C.x)));
      acc.w.assign(max(acc.w, core.mul(C.x)));
    });
    return acc;
  }) as unknown as (p: TNode) => TNode;
  const wf = Fn(() => {
    const r = vec4(0).toVar();
    If(n.greaterThan(0), () => { r.assign(field(positionGeometry)); });
    return r;
  })().toVar();
  woundShared = {n, k, gore, disp, field, wf};
  return woundShared;
}

/** Vertex stage: material lost inside a wound (pushed in along the skinned normal by the bind-space dent depth). */
export function woundPositionNode(prev: TNode | null): TNode {
  return memoNode(prev, 'wound-pos', () => {
    const S = woundNodes();
    const base = prev ?? positionLocal;
    return vec3(base).sub(normalLocal.mul(select(S.n.greaterThan(0), S.disp(positionGeometry), float(0))));
  });
}

/** Colour stage per layer mode (0 skin, 1 cloth, 2 rubber / plastic). */
export function woundColorNode(prev: TNode | null, mode: number): TNode {
  return memoNode(prev, `wound-color-${mode}`, () => Fn(() => {
    const S = woundNodes(), wf = S.wf, gore = S.gore;
    const base = vec4(prev ?? matColor).toVar();
    const rgb = vec3(base.rgb).toVar();
    If(wf.y.add(wf.x).greaterThan(0.002), () => {
      const fib = dmgNoise(positionGeometry.mul(float(150).div(S.k))).toVar();
      const wBase = vec3(rgb).toVar();
      // blood-soaked halo: darker, browner, a little wetter
      rgb.assign(mix(wBase, wBase.mul(vec3(0.42, 0.2, 0.17)), wf.y.mul(0.85).mul(gore)));
      const flesh = mix(vec3(0.26, 0.05, 0.04), vec3(0.42, 0.1, 0.075), fib);
      const cav = mix(flesh, vec3(0.06, 0.012, 0.01), smoothstep(0.25, 0.9, wf.z)).toVar();
      const lip = clamp(wf.x.mul(wf.x.oneMinus()).mul(4), 0, 1);
      if (mode === 0) {
        // skin: torn lip darker, raw flesh inside, bone flecks deep in strong wounds
        const wc = mix(cav.mul(lip.mul(0.3).oneMinus()), vec3(0.58, 0.54, 0.46), step(0.8, fib).mul(smoothstep(0.6, 0.95, wf.z)));
        rgb.assign(mix(rgb, wc, wf.x.mul(gore)));
      } else {
        // clothing / rubber: frayed (cloth: lighter threads, rubber: dark torn edge), skin ring, flesh core
        const fray = mode === 1 ? wBase.mul(1.35).add(fib.mul(0.035)) : wBase.mul(0.45);
        const wc = mix(mix(fray, vec3(0.36, 0.36, 0.3), smoothstep(0.18, 0.55, wf.x)), cav, smoothstep(0.55, 0.95, wf.x).mul(gore));
        rgb.assign(mix(rgb, wc, smoothstep(0.02, 0.2, wf.x)));
      }
    });
    return vec4(rgb, base.a);
  })());
}

export function woundRoughnessNode(prev: TNode | null): TNode {
  return memoNode(prev, 'wound-rough', () => {
    const wf = woundNodes().wf;
    return mix(float(prev ?? materialRoughness), 0.34, clamp(wf.x.mul(0.9).add(wf.y.mul(0.25)), 0, 1));
  });
}

export function woundMetalnessNode(prev: TNode | null): TNode {
  return memoNode(prev, 'wound-metal', () => float(prev ?? materialMetalness).mul(woundNodes().wf.x.oneMinus()));
}

export function woundNormalNode(prev: TNode | null): TNode {
  return memoNode(prev, 'wound-normal', () => Fn(() => {
    const S = woundNodes(), wf = S.wf;
    const nrm = vec3(prev ?? materialNormal).toVar();
    const fib = dmgNoise(positionGeometry.mul(float(150).div(S.k)));
    const h = wf.x.mul(0.6).add(wf.z.mul(0.4)).mul(fib.mul(0.4).add(0.6)).negate().toVar();
    const bumped = dmgPerturb(positionView, nrm, vec2(h.dFdx(), h.dFdy()).mul(0.9));
    return select(wf.x.greaterThan(0.001), bumped, nrm);
  })());
}

/** Adds the wound stages (keys `zombie-wounds-v1.<stage>`, order 300) to one of an actor's own node materials. */
export function addWoundHooks(mat: NodeMaterial, mode: number): void {
  const key = (stage: string) => `${WOUND_HOOK}.${stage}`;
  addNodeHook(mat, {key: key('position'), stage: 'position', order: 300, fn: prev => woundPositionNode(prev)});
  addNodeHook(mat, {key: key('color'), stage: 'color', order: 300, fn: prev => woundColorNode(prev, mode)});
  addNodeHook(mat, {key: key('roughness'), stage: 'roughness', order: 300, fn: prev => woundRoughnessNode(prev)});
  addNodeHook(mat, {key: key('metalness'), stage: 'metalness', order: 300, fn: prev => woundMetalnessNode(prev)});
  addNodeHook(mat, {key: key('normal'), stage: 'normal', order: 300, fn: prev => woundNormalNode(prev)});
}

/** True when `mat` carries the wound node stages. */
export function hasWounds(mat: THREE.Material | null | undefined): boolean {
  return !!mat && (mat as unknown as NodeMaterial).isNodeMaterial === true && nodeHookKeys(mat as unknown as NodeMaterial).some(x => x.startsWith(`${WOUND_HOOK}.`));
}

/** One actor's wound data (shared by every layer mesh of that actor). */
export class WoundData {
  readonly data = new Float32Array(WOUND_DATA * 4);
  constructor(gore: number) { this.data[2] = gore; }
  get n(): number { return this.data[0]; }
  set n(v: number) { this.data[0] = v; }
  /** Rest units per world metre. */
  get k(): number { return this.data[1]; }
  set k(v: number) { this.data[1] = v; }
  get gore(): number { return this.data[2]; }
  set gore(v: number) { this.data[2] = v; }
  set(i: number, w: {c: THREE.Vector3; r: number; d: THREE.Vector3; len: number; strength: number; seed: number; back: number; depth: number}): void {
    this.data.set([w.c.x, w.c.y, w.c.z, w.r], (W_A + i) * 4);
    this.data.set([w.d.x, w.d.y, w.d.z, w.len], (W_B + i) * 4);
    this.data.set([w.strength, w.seed, w.back, w.depth], (W_C + i) * 4);
  }
  /** vec4 j of wound i: 0 A (centre, radius), 1 B (dir, length), 2 C (strength, seed, back, depth). */
  get4(i: number, j: 0 | 1 | 2): number[] {
    const at = ([W_A, W_B, W_C][j] + i) * 4;
    return Array.from(this.data.subarray(at, at + 4));
  }
}

const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

export class WoundController {
  readonly wounds: Wound[] = [];
  readonly layers: Layer[] = [];
  /** Iteration 13 (MAT-B): per-actor wound data (every layer mesh's userData.dmgWound points at it). */
  readonly uniforms: WoundData;
  readonly max: number;
  private readonly maxDepth: number;
  private seed = 1;
  /** Hits applied (incl. merged). */
  hits = 0;
  private skeleton: THREE.Skeleton | null = null;
  private boneIndex = new Map<THREE.Object3D, number>();

  constructor(readonly actor: WoundableActor, opts: WoundOptions = {}) {
    this.max = Math.max(1, Math.min(WOUND_MAX, opts.maxWounds ?? WOUND_MAX));
    this.maxDepth = opts.maxDepth ?? 0.03;
    this.uniforms = new WoundData(opts.gore ?? 1);
    this.uniforms.k = 1;
  }

  /** Clone + patch every mesh's material (called once by installWounds). */
  install(): void {
    const recs: {mesh: THREE.SkinnedMesh; slot?: string; wearable?: string | null}[] = [];
    if (this.actor.meshes?.length) {
      for (const m of this.actor.meshes) recs.push((m as THREE.SkinnedMesh).isSkinnedMesh ? {mesh: m as THREE.SkinnedMesh} : m as {mesh: THREE.SkinnedMesh; slot?: string; wearable?: string | null});
    } else {
      this.actor.root.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) recs.push({mesh: o as THREE.SkinnedMesh}); });
    }
    const replaced = new Map<THREE.Material, THREE.Material>();
    for (const r of recs) {
      const mesh = r.mesh;
      const slot = r.slot ?? (mesh.userData.slot as string | undefined) ?? (/ZombieBody/i.test(mesh.name) ? 'body' : 'upper');
      const wearable = r.wearable ?? (mesh.userData.wearable as string | null | undefined) ?? (mesh.userData.outfit as string | undefined) ?? null;
      const cls = zombieMeshClass(slot, wearable, mesh.name);
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
      let mat = replaced.get(src);
      if (!mat) {
        // Iteration 13 (MAT-B): own node-material copy (GLTF standard -> MeshStandardNodeMaterial) + the wound node stages
        const nm = toNodeMaterial(src);
        if (nm) addWoundHooks(nm, MODE[DAMAGE_MATERIALS[cls].shade] ?? MODE[cls] ?? 1);
        mat = (nm as unknown as THREE.Material | null) ?? src.clone();
        replaced.set(src, mat);
      }
      mesh.material = mat;
      mesh.userData[WOUND_DATA_KEY] = this.uniforms.data;
      this.layers.push({mesh, slot, cls, material: mat, color: materialColor(src)});
      if (!this.skeleton && mesh.skeleton) this.skeleton = mesh.skeleton;
    }
    // Keep the actor's own per-actor material list (hit flash emissive, dispose) pointing at our clones.
    const own = (this.actor as unknown as {mats?: THREE.Material[]}).mats;
    if (Array.isArray(own)) for (let i = 0; i < own.length; i++) { const r = replaced.get(own[i]); if (r) own[i] = r; }
    if (this.skeleton) this.skeleton.bones.forEach((b, i) => this.boneIndex.set(b, i));
    this.syncScale();
  }

  /** Rest units per world metre (bind space may not be metres; actor scale applies too). */
  private syncScale(): void {
    const l = this.layers[0];
    if (!l || !this.skeleton) return;
    this.actor.root.updateMatrixWorld(true);
    this.restMatrix(l.mesh, 0, tmpM).setPosition(0, 0, 0);
    this.uniforms.k = tmpV.set(1, 0, 0).applyMatrix4(tmpM).length() || 1;
  }

  /** World -> rest-space matrix of `mesh` through bone j (inverse of the skinning transform). */
  private restMatrix(mesh: THREE.SkinnedMesh, j: number, out: THREE.Matrix4): THREE.Matrix4 {
    const sk = mesh.skeleton;
    const bone = sk.bones[j];
    // F = M · Binv · bone.matrixWorld · boneInverse · B ; rest = F^-1 · world
    out.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(bone.matrixWorld).multiply(sk.boneInverses[j]).multiply(mesh.bindMatrix);
    return out.invert();
  }

  /** Bone whose segment (to its child bones) is nearest the world point. */
  private nearestBone(p: THREE.Vector3): number {
    const sk = this.skeleton;
    if (!sk) return 0;
    let best = 0, bd = Infinity;
    const a = tmpV, b = tmpV2;
    sk.bones.forEach((bone, i) => {
      a.setFromMatrixPosition(bone.matrixWorld);
      const kids = bone.children.filter(c => (c as THREE.Bone).isBone);
      const test = (q: THREE.Vector3 | null) => {
        let d: number;
        if (!q) d = a.distanceToSquared(p);
        else {
          const ab = tmpV3.subVectors(q, a), t = Math.max(0, Math.min(1, ab.dot(tmpV4.subVectors(p, a)) / Math.max(1e-9, ab.lengthSq())));
          d = tmpV4.copy(a).addScaledVector(ab, t).distanceToSquared(p);
        }
        if (d < bd) { bd = d; best = i; }
      };
      if (!kids.length) test(null);
      for (const k of kids) test(b.setFromMatrixPosition(k.matrixWorld));
    });
    return best;
  }

  /**
   * Apply a bullet hit. Finds the bone and the first visible surface along the shot (rest space),
   * then adds (or merges into) a wound segment. Returns null when the actor has no skinned layers.
   */
  add(hit: WoundHit): WoundResult | null {
    if (!this.layers.length || !this.skeleton) return null;
    this.hits++;
    const j = this.nearestBone(hit.point);
    const boneName = this.skeleton.bones[j]?.name ?? '';
    const sk = this.skeleton;
    const near = new Set<number>([j]);
    const bone = sk.bones[j];
    const parent = bone.parent as THREE.Bone | null;
    if (parent?.isBone) near.add(this.boneIndex.get(parent) ?? -1);
    for (const c of bone.children) if ((c as THREE.Bone).isBone) near.add(this.boneIndex.get(c) ?? -1);
    // Layers share the body skeleton + bind matrix (Lane W binds wearables to it), so one rest frame.
    const restM = this.restMatrix(this.layers[0].mesh, j, new THREE.Matrix4());
    const lin = new THREE.Matrix4().copy(restM).setPosition(0, 0, 0);
    const k = new THREE.Vector3().copy(hit.dir).applyMatrix4(lin).length() || 1; // rest units per metre
    const c0 = hit.point.clone().applyMatrix4(restM);
    const d = hit.dir.clone().applyMatrix4(lin).normalize();
    // first visible vertex near the shot line (search a little before/after the capsule surface)
    const searchR = 0.055 * k, r2 = searchR * searchR;
    let bestT = Infinity, bestLayer = 0;
    this.layers.forEach((l, li) => {
      if (!l.mesh.visible) return;
      const v = visibleVerts(l.mesh.geometry);
      const P = v.pos;
      for (let i = 0, n = P.length / 3; i < n; i++) {
        if (v.bone[i] >= 0 && !near.has(v.bone[i])) continue;
        const rx = P[i * 3] - c0.x, ry = P[i * 3 + 1] - c0.y, rz = P[i * 3 + 2] - c0.z;
        const t = rx * d.x + ry * d.y + rz * d.z;
        if (t < -0.3 * k || t > 0.35 * k || t >= bestT) continue;
        const qx = rx - d.x * t, qy = ry - d.y * t, qz = rz - d.z * t;
        if (qx * qx + qy * qy + qz * qz > r2) continue;
        bestT = t; bestLayer = li;
      }
    });
    const found = Number.isFinite(bestT);
    const entryRest = c0.clone().addScaledVector(d, found ? bestT : 0);
    const layer = this.layers[bestLayer];
    const spec = DAMAGE_MATERIALS[layer.cls];
    // size / strength from the hit: rifle bigger per hit, pellets small but merge; head / limbs lose more
    const partK = hit.part === 'head' ? 1.1 : hit.part === 'limb' ? 1.15 : 1;
    const dmgK = Math.min(1.6, Math.max(0.35, hit.damage / 24));
    const rNew = spec.markSize * (hit.pellet ? 0.72 : 1) * partK * (0.85 + 0.3 * dmgK) * k;
    const sNew = Math.min(1, (hit.pellet ? 0.22 : 0.42) * dmgK * partK);
    const len = (hit.part === 'limb' ? 0.2 : hit.part === 'head' ? 0.12 : spec.pierce) * k;
    // merge with a nearby wound
    let merged = -1, md = Infinity;
    for (let i = 0; i < this.wounds.length; i++) {
      const w = this.wounds[i];
      const dd = w.c.distanceTo(entryRest);
      if (dd < w.r * 0.9 + rNew * 0.5 && dd < md) { md = dd; merged = i; }
    }
    if (merged < 0 && this.wounds.length >= this.max) {
      // full: grow the nearest wound instead of dropping the hit
      for (let i = 0; i < this.wounds.length; i++) { const dd = this.wounds[i].c.distanceTo(entryRest); if (dd < md) { md = dd; merged = i; } }
    }
    const maxR = spec.markMax * partK * k;
    let w: Wound;
    if (merged >= 0) {
      w = this.wounds[merged];
      w.c.lerp(entryRest, 0.25);
      w.r = Math.min(maxR, Math.sqrt(w.r * w.r + rNew * rNew * 0.65));
      w.strength = Math.min(1, w.strength + sNew * 0.7);
      w.d.lerp(d, 0.3).normalize();
      w.len = Math.max(w.len, len);
    } else {
      w = {c: entryRest, d, r: rNew, len, back: 0.035 * k, strength: sNew, seed: (this.seed = (this.seed * 16807) % 2147483647) / 2147483647 * 10, depth: 0, bone: boneName, age: 0};
      this.wounds.push(w);
    }
    const partD = hit.part === 'torso' ? 1 : 1.35;
    w.depth = Math.max(w.torn ? w.depth : 0, Math.min(this.maxDepth * partD, (0.006 + 0.022 * w.strength) * partD) * k);
    this.upload();
    // entry point back to world through the same bone transform
    const entry = entryRest.clone().applyMatrix4(tmpM.copy(restM).invert());
    return {slot: layer.slot, cls: layer.cls, entry, bone: boneName, merged: merged >= 0, index: this.wounds.indexOf(w), radius: w.r / k, strength: w.strength, color: layer.color.clone(),
      layer: bestLayer, restEntry: entryRest.clone(), restDir: d.clone(), k};
  }

  /**
   * Iteration 07 (Lane K): a piece was torn OFF the actor at wound `index` (physics chunk cut from the
   * posed layer, damage/fleshPatch.ts): the wound becomes a persistent MISSING area of that size —
   * radius grown to cover the taken patch, full strength (dark cavity / torn-open garment showing
   * skin then flesh), deeper inward displacement. `restRadius` in rest units.
   */
  tear(index: number, restRadius: number, restCenter?: THREE.Vector3): void {
    const w = this.wounds[index];
    if (!w) return;
    const cap = DAMAGE_MATERIALS.flesh.markMax * 1.5 * this.uniforms.k;
    if (restCenter) w.c.lerp(restCenter, 0.5);
    w.r = Math.min(cap, Math.max(w.r, restRadius * 1.05));
    w.strength = 1;
    w.len = Math.max(w.len, w.r * 1.6);
    w.depth = Math.max(w.depth, this.maxDepth * 1.5 * this.uniforms.k);
    w.torn = true;
    this.tears++;
    this.upload();
  }
  /** Pieces torn off this actor (iteration 07). */
  tears = 0;

  private upload(): void {
    const u = this.uniforms;
    this.wounds.forEach((w, i) => u.set(i, w));
    u.n = this.wounds.length;
  }

  get count(): number {
    return this.wounds.length;
  }

  /** Dispose the per-actor wound material clones (idempotent; the actor may dispose them too). */
  dispose(): void {
    for (const m of new Set(this.layers.map(l => l.material))) m.dispose();
  }

  stats(): {wounds: number; hits: number; layers: {slot: string; cls: DamageClass}[]; maxStrength: number} {
    return {wounds: this.wounds.length, hits: this.hits, layers: this.layers.map(l => ({slot: l.slot, cls: l.cls})), maxStrength: this.wounds.reduce((m, w) => Math.max(m, w.strength), 0)};
  }
}

const tmpV3 = new THREE.Vector3(), tmpV4 = new THREE.Vector3();
const controllers = new WeakMap<object, WoundController>();

/**
 * Give `actor` its own wound-patched material clones (body + every worn wearable). Idempotent:
 * a second call returns the existing controller.
 */
export function installWounds(actor: WoundableActor, opts: WoundOptions = {}): WoundController {
  let c = controllers.get(actor);
  if (c) return c;
  c = new WoundController(actor, opts);
  c.install();
  controllers.set(actor, c);
  return c;
}

export function woundsOf(actor: object): WoundController | undefined {
  return controllers.get(actor);
}
