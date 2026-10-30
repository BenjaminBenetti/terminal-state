// Per-INSTANCE prop damage (iteration 06, Lane D).
//
// Props are rendered shared: instanced per (kind, material) / per GLB mesh, or baked into merged
// chunk meshes (purpose props, shopfront blocks). Damaging one instance must never mark the others,
// so the first hit DETACHES that one prop: its instances are hidden (zero matrix) in every shared
// InstancedMesh, its triangles are cut out of merged chunk meshes (degenerated in the source), and
// it is re-drawn as its own meshes (same geometry / textures) with its OWN material clones (Lane F's
// chained shader hooks carried over: world-space texturing, light field). Those clones get a damage
// shader: up to DMG_MAX bullet LINES per part in the part's rest frame (start, direction, length,
// radius, strength). Fragments near a line are shaded per part material class — dents with paint
// chipped to bare metal and dark holes (sheet metal; exit holes on the far side of thin panels),
// splinters of raw wood, spiderweb cracks + frosting + see-through holes (glass), cracked dead
// pixels (screens), stress-whitened plastic, laminate chipped to particleboard, chip craters
// (stone / porcelain), frayed tears (fabric / cardboard / packaging) — with bump-mapped relief.
//
// Integrity per instance (materials.ts PROP_DAMAGE): staged damage (marked / heavy) and full breaks:
// glass parts shatter (hidden + shards), screens die, a vending front gives way (= pried open),
// wooden crates splinter apart, carton stacks collapse. Breaking updates visibility, collision
// (the prop box drops to rubble / plinth height) and interaction through PropDamageHooks
// (containers keep their FINITE contents: nothing is destroyed, duplicated or re-rolled).
// Bounded: at most MAX_DETACHED props are detached (further hits fall back to fx decals).

import * as THREE from 'three';
import type {NodeMaterial} from 'three/webgpu';
import {Break, Discard, Fn, If, Loop, abs, atan, clamp, cross, dot, float, floor, fract, int, length, mat4, materialColor, materialEmissive, materialMetalness, materialNormal, materialOpacity, materialRoughness, max, min, mix, normalize, positionGeometry, positionView, select, smoothstep, step, varying, vec2, vec3, vec4} from 'three/tsl';
import type {PropPlacement} from '../gen/props';
import {addNodeHook, nodeHookKeys} from '../render/nodeHooks';
import {DAMAGE_MATERIALS, SHADE_MODES, damageStage, partKeyClass, propDamageSpec, propHitDamage, type DamageClass, type PropDamageSpec} from './materials';
import {dmgHash, dmgNoise, dmgPerturb, isStandardLike, memoNode, objectData, toNodeMaterial, writeMat4, type TNode} from './tsl';
import {materialBaseColor} from './sample';

export const DMG_MAX = 10;
export const PROP_DAMAGE_HOOK = 'prop-damage-v1';
/** Props detached for per-instance damage (soft cap; breaking may exceed it up to HARD). */
export const MAX_DETACHED = 64;
const MAX_DETACHED_HARD = 96;

export interface PropDamageHooks {
  /** Meshes owned by one prop outside the shared/instanced ones (container doors, lid, interior). */
  ownMeshes?(prop: PropPlacement): THREE.Mesh[];
  /** A prop (or its glass) broke: update loot holder / collision / physics. */
  onBreak?(e: PropBreakEvent): void;
}

export type BreakKind = 'splinter' | 'collapse' | 'shatter' | 'dead' | 'open';
export interface PropBreakEvent { prop: PropPlacement; index: number; kind: BreakKind; boxes: THREE.Box3[]; color: THREE.Color }

export interface PropHit {
  prop: PropPlacement;
  index: number;
  point: THREE.Vector3;
  dir: THREE.Vector3;
  normal: THREE.Vector3;
  /** Weapon damage of this bullet / pellet after falloff. */
  damage: number;
  pellet?: boolean;
}

export interface PropHitResult {
  cls: DamageClass;
  glass: boolean;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Linear colour of the hit part (fragment palette). */
  color: THREE.Color;
  stage: 0 | 1 | 2 | 3;
  broke: BreakKind | null;
  boxes: THREE.Box3[];
  /** A persistent shader mark was placed (else the caller falls back to an fx decal). */
  marked: boolean;
  /** The prop was already broken (rubble): treat as the floor below. */
  rubble: boolean;
}

/**
 * Iteration 13 (MAT-B): one detached part's damage state as PER-OBJECT data (`mesh.userData.dmgProp`, PROP_DATA vec4),
 * read at every draw by the ONE shared prop-damage node graph (damage/tsl.ts objectData) — the WebGPU replacement for the
 * per-clone GLSL uniforms. Layout (vec4 index): 0 (lines, shade mode, dead screen, front on) · 1 (front broken, substrate
 * rgb) · 2 front region (x0, x1, y0, y1) · 3..6 rest matrix · 7..10 prop-local matrix · 11.. A[DMG_MAX] (start, radius) ·
 * B[DMG_MAX] (dir, length) · C[DMG_MAX] (strength, seed, crack, 0).
 */
export class PartData {
  readonly data = new Float32Array(PROP_DATA * 4);
  constructor(mode: number, sub: THREE.Color, rest: THREE.Matrix4) {
    this.data[1] = mode;
    this.data[5] = sub.r; this.data[6] = sub.g; this.data[7] = sub.b;
    writeMat4(this.data, 3, rest);
  }
  /** Damage lines in use. */
  get n(): number { return this.data[0]; }
  set n(v: number) { this.data[0] = v; }
  get mode(): number { return this.data[1]; }
  /** Screen died (emissive off). */
  get dead(): number { return this.data[2]; }
  set dead(v: number) { this.data[2] = v; }
  get frontOn(): number { return this.data[3]; }
  set frontOn(v: number) { this.data[3] = v; }
  get frontBroken(): number { return this.data[4]; }
  set frontBroken(v: number) { this.data[4] = v; }
  setFront(x0: number, x1: number, y0: number, y1: number): void { this.data.set([x0, x1, y0, y1], 8); }
  setLocal(m: THREE.Matrix4): void { writeMat4(this.data, 7, m); }
  setLine(i: number, l: Line): void {
    this.data.set([l.a.x, l.a.y, l.a.z, l.r], (DATA_A + i) * 4);
    this.data.set([l.d.x, l.d.y, l.d.z, l.len], (DATA_B + i) * 4);
    this.data.set([l.strength, l.seed, l.crack, 0], (DATA_C + i) * 4);
  }
}
const DATA_A = 11, DATA_B = DATA_A + DMG_MAX, DATA_C = DATA_B + DMG_MAX;
/** vec4 per part. */
export const PROP_DATA = DATA_C + DMG_MAX;
/** mesh.userData key of a part's PartData.data. */
export const PROP_DATA_KEY = 'dmgProp';

interface Line { a: THREE.Vector3; d: THREE.Vector3; len: number; r: number; strength: number; seed: number; crack: number }

interface Part {
  mesh: THREE.Mesh;
  cls: DamageClass;
  glass: boolean;
  u: PartData;
  /** World matrix at detach time (rest frame of the damage lines). */
  rest: THREE.Matrix4;
  /** Moving part (container door / lid): convert world hits through its current matrix. */
  moving: boolean;
  /** Created by us (removed on clear) / geometry created by us (disposed). */
  created: boolean;
  ownGeometry: boolean;
  mat: THREE.Material;
  /** Material the mesh had before (own meshes are restored to it on clear). */
  prevMat: THREE.Material | THREE.Material[] | null;
  color: THREE.Color;
  lines: Line[];
}

interface Hidden { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }
interface Cut { mesh: THREE.Mesh; tris: Uint32Array; saved: Uint32Array }

export interface PropState {
  prop: PropPlacement;
  index: number;
  spec: PropDamageSpec;
  hp: number;
  glassHp: number;
  hits: number;
  stage: 0 | 1 | 2 | 3;
  broken: boolean;
  glassBroken: boolean;
  parts: Part[] | null;
  hidden: Hidden[];
  cuts: Cut[];
}

// ---------------------------------------------------------------------------------------
// Shader — Iteration 13 (MAT-B): TSL node stages on the part's own node-material clone (was GLSL onBeforeCompile):
// colour / opacity / roughness / metalness / normal / emissive, order 300 (render/nodeHooks.ts). Same maths as the
// iteration-06 GLSL: damage lines in the part's rest frame, per shade mode dents / splinters / cracks / frost / chips /
// tears, punched holes, bump-mapped relief, vending front given way, dead screens. ONE graph per base node (memoNode):
// every clone of a shared material draws with the same pipeline; the per-part state is per-object data (PartData).

interface PropShared {
  /** Rest-frame position (vertex varying, GLSL vDmgP). */
  p: TNode;
  front: TNode; frontGone: TNode; frontBox: TNode; dLocal: TNode;
  isMode(k: number): TNode;
  /** x hole core, y damaged ring, z cracks, w strength (zero on a given-way front). */
  df: TNode;
  grain: TNode; sub: TNode; dead: TNode;
}
let propShared: PropShared | null = null;

function propNodes(): PropShared {
  if (propShared) return propShared;
  const D = objectData(PROP_DATA_KEY, PROP_DATA);
  const h0 = D.element(0), h1 = D.element(1), fr = D.element(2);
  const rest = mat4(D.element(3), D.element(4), D.element(5), D.element(6));
  const local = mat4(D.element(7), D.element(8), D.element(9), D.element(10));
  const p = varying(rest.mul(vec4(positionGeometry, 1)).xyz) as TNode;
  const lines = int(h0.x);
  const dLocal = local.mul(vec4(p, 1)).xyz.toVar();
  const front = h0.w.greaterThan(0.5).and(dLocal.z.greaterThan(0.42)).and(dLocal.x.greaterThan(fr.x)).and(dLocal.x.lessThan(fr.y))
    .and(dLocal.y.greaterThan(fr.z)).and(dLocal.y.lessThan(fr.w)).toVar();
  // the baked glass front of a vending machine shades as glass
  const mode = select(front, float(2), h0.y).toVar();
  const isMode = (k: number) => abs(mode.sub(k)).lessThan(0.5);
  const field = Fn(([P, cracks]: [TNode, TNode]) => {
    const acc = vec4(0).toVar();
    Loop(DMG_MAX, ({i}: {i: TNode}) => {
      If(i.greaterThanEqual(lines), () => { Break(); });
      const A = D.element(i.add(DATA_A)), B = D.element(i.add(DATA_B)), C = D.element(i.add(DATA_C));
      const rel = P.sub(A.xyz).toVar();
      const t = clamp(dot(rel, B.xyz), 0, B.w);
      const q = rel.sub(B.xyz.mul(t)).toVar();
      const d = length(q).toVar();
      const r = A.w.mul(dmgNoise(P.mul(55).add(C.y)).mul(0.5).add(0.75)).toVar();
      const ring = smoothstep(r.mul(0.4), r, d).oneMinus().toVar();
      acc.x.assign(max(acc.x, smoothstep(r.mul(0.28), r.mul(0.4), d).oneMinus()));
      acc.y.assign(max(acc.y, ring));
      acc.w.assign(max(acc.w, ring.mul(C.x)));
      If(cracks.and(d.lessThan(A.w.mul(C.z))), () => {
        // spiderweb: radial spokes + broken concentric rings around the line, in its cross-section plane
        const ax = select(abs(B.y).lessThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0));
        const u = normalize(cross(B.xyz, ax)).toVar();
        const v = cross(B.xyz, u);
        const pl = vec2(dot(q, u), dot(q, v)).toVar();
        const rad = length(pl).add(1e-5).toVar();
        const N = floor(C.y.mul(0.37)).add(9).toVar();
        const ang = atan(pl.y, pl.x).add(dmgNoise(vec3(rad.mul(40), C.y, 1)).sub(0.5).mul(0.35));
        const sector = ang.mul(N).div(6.2831853).add(C.y).toVar();
        const jit = dmgHash(vec3(floor(sector), C.y, 3)).toVar();
        const spoke = abs(fract(sector).sub(0.5).add(jit.sub(0.5).mul(0.5))).mul(6.2831853).div(N).mul(rad);
        const spacing = A.w.mul(jit.mul(0.5).add(0.75)).toVar();
        const ringc = abs(fract(rad.div(spacing)).sub(0.5)).mul(spacing);
        const ringOn = step(0.45, dmgHash(vec3(floor(rad.div(spacing)), floor(sector.mul(0.5)), C.y)));
        const fadeOut = smoothstep(A.w.mul(C.z).mul(0.55), A.w.mul(C.z), rad).oneMinus();
        const line = max(smoothstep(0.0006, 0.0018, spoke).oneMinus(), smoothstep(0.0005, 0.0015, ringc).oneMinus().mul(ringOn).mul(step(r.mul(0.6), rad)));
        acc.z.assign(max(acc.z, line.mul(fadeOut)));
      });
    });
    return acc;
  });
  const dfRaw = Fn(() => {
    const r = vec4(0).toVar();
    If(lines.greaterThan(0), () => { r.assign(field(p, isMode(2).or(isMode(3)))); });
    return r;
  })();
  const frontGone = front.and(h1.x.greaterThan(0.5));
  const df = select(frontGone, vec4(0), dfRaw).toVar();
  propShared = {p, front, frontGone, frontBox: fr, dLocal, isMode, df, grain: dmgNoise(p.mul(140)), sub: h1.yzw, dead: h0.z};
  return propShared;
}

/** Glass (non-front) fragments whose alpha the colour stage rewrote (the opacity stage then passes 1). */
const glassAlpha = (S: PropShared) => S.isMode(2).and(S.front.not()).and(S.df.x.add(S.df.y).add(S.df.z).greaterThan(0.001));

export function propColorNode(prev: TNode | null): TNode {
  return memoNode(prev, 'prop-color', () => Fn(() => {
    const S = propNodes(), df = S.df, g = S.grain, fr = S.frontBox, L = S.dLocal;
    const base = vec4(prev ?? materialColor).toVar();
    const rgb = vec3(base.rgb).toVar();
    const alpha = float(base.a).toVar();
    If(S.frontGone, () => {
      // vending front given way: dark interior behind jagged glass remains at the frame
      const edge = min(min(L.x.sub(fr.x), fr.y.sub(L.x)), min(L.y.sub(fr.z), fr.w.sub(L.y)));
      const jag = dmgNoise(S.p.mul(60)).mul(0.03).add(0.012);
      rgb.assign(select(edge.lessThan(jag), vec3(0.55, 0.6, 0.6), rgb.mul(0.08)));
    });
    If(df.x.add(df.y).add(df.z).greaterThan(0.001), () => {
      const dBase = vec3(rgb).toVar();
      const ring = df.y.mul(df.x.oneMinus()).toVar();
      const c = vec3(dBase).toVar();
      If(S.isMode(0), () => {
        // metal: dent shadow, paint chipped back to bare steel, dark punched hole
        const bare = vec3(0.5, 0.51, 0.5).mul(g.mul(0.5).add(0.75));
        c.assign(mix(dBase.mul(0.7), bare, step(0.35, dmgNoise(S.p.mul(70))).mul(smoothstep(0, 0.6, ring))));
      }).ElseIf(S.isMode(1).or(S.isMode(5)), () => {
        // wood / laminate: raw fibres (substrate) with grain streaks
        const streak = dmgNoise(vec3(S.p.x.mul(260), S.p.y.mul(30), S.p.z.mul(260)));
        c.assign(mix(dBase, S.sub.mul(streak.mul(0.5).add(0.7)), smoothstep(0.05, 0.5, ring).mul(select(S.isMode(5), step(0.3, g), float(1)))));
      }).ElseIf(S.isMode(2).or(S.isMode(3)), () => {
        // glass / screen: frosted crush ring + crack lines
        c.assign(mix(dBase, select(S.isMode(2), vec3(0.86, 0.9, 0.9), vec3(0.32, 0.34, 0.35)), clamp(ring.mul(0.8).add(df.z), 0, 1)));
      }).ElseIf(S.isMode(4), () => {
        c.assign(mix(dBase, mix(dBase, vec3(0.86, 0.85, 0.82), 0.6), smoothstep(0, 0.7, ring)));
      }).ElseIf(S.isMode(6), () => {
        c.assign(mix(dBase, S.sub.mul(g.mul(0.35).add(0.8)), smoothstep(0.05, 0.45, ring)));
      }).Else(() => {
        // soft: frayed fibres / torn card
        c.assign(mix(dBase, mix(dBase.mul(1.3).add(0.03), S.sub, 0.5).mul(g.mul(0.5).add(0.75)), smoothstep(0.1, 0.6, ring)));
      });
      // punched hole: near-black (glass: see-through)
      rgb.assign(mix(c, vec3(0.015, 0.014, 0.013), df.x));
      If(S.isMode(2).and(S.front.not()), () => {
        // GLSL: alpha here already carried the material opacity (the opacity stage passes 1 for these fragments)
        const a = max(alpha.mul(materialOpacity), clamp(ring.mul(0.75).add(df.z.mul(0.9)), 0, 0.92)).mul(df.x.oneMinus()).toVar();
        Discard(a.lessThan(0.015));
        alpha.assign(a);
      });
    });
    return vec4(rgb, alpha);
  })());
}

export function propOpacityNode(prev: TNode | null): TNode {
  return memoNode(prev, 'prop-opacity', () => select(glassAlpha(propNodes()), float(1), float(prev ?? materialOpacity)));
}

export function propRoughnessNode(prev: TNode | null): TNode {
  return memoNode(prev, 'prop-rough', () => {
    const S = propNodes(), df = S.df, r = float(prev ?? materialRoughness);
    const dented = select(S.isMode(0), mix(r, 0.38, df.y.mul(df.x.oneMinus())), select(S.isMode(2), r, mix(r, 0.95, df.y)));
    return select(df.y.greaterThan(0.001), dented, r);
  });
}

export function propMetalnessNode(prev: TNode | null): TNode {
  return memoNode(prev, 'prop-metal', () => {
    const S = propNodes(), df = S.df, m = float(prev ?? materialMetalness);
    return select(S.isMode(0).and(df.y.greaterThan(0.001)), mix(m, 0.75, df.y.mul(df.x.oneMinus()).mul(0.8)), m);
  });
}

export function propNormalNode(prev: TNode | null): TNode {
  return memoNode(prev, 'prop-normal', () => Fn(() => {
    const S = propNodes(), df = S.df;
    const n = vec3(prev ?? materialNormal).toVar();
    const dH = df.y.mul(select(S.isMode(0), float(0.9), float(0.45))).add(df.x.mul(0.8)).mul(S.grain.mul(0.3).add(0.7)).negate().toVar();
    const bumped = dmgPerturb(positionView, n, vec2(dH.dFdx(), dH.dFdy()).mul(1.4));
    return select(df.y.greaterThan(0.001), bumped, n);
  })());
}

export function propEmissiveNode(prev: TNode | null): TNode {
  return memoNode(prev, 'prop-emissive', () => {
    const S = propNodes(), df = S.df;
    const e = vec3(prev ?? materialEmissive);
    return e.mul(S.dead.oneMinus()).mul(clamp(df.y.mul(1.2).add(df.z), 0, 1).mul(select(S.isMode(3), float(1), float(0.6))).oneMinus());
  });
}

const PROP_STAGES = [
  ['color', propColorNode], ['opacity', propOpacityNode], ['roughness', propRoughnessNode], ['metalness', propMetalnessNode], ['normal', propNormalNode], ['emissive', propEmissiveNode],
] as const;

/** Adds the prop-damage stages (keys `prop-damage-v1.<stage>`, order 300) to a part's own node material. */
export function addPropDamageHooks(mat: NodeMaterial): void {
  for (const [stage, make] of PROP_STAGES) addNodeHook(mat, {key: `${PROP_DAMAGE_HOOK}.${stage}`, stage, order: 300, fn: prev => make(prev)});
}

/** True when `mat` carries the prop-damage node stages. */
export function hasPropDamage(mat: THREE.Material | null | undefined): boolean {
  return !!mat && (mat as unknown as NodeMaterial).isNodeMaterial === true && nodeHookKeys(mat as unknown as NodeMaterial).some(k => k.startsWith(`${PROP_DAMAGE_HOOK}.`));
}

const MODE_INDEX: Record<string, number> = {metal: 0, wood: 1, glass: 2, screen: 3, plastic: 4, laminate: 5, stone: 6, soft: 7};
export const shadeIndex = (cls: DamageClass): number => MODE_INDEX[DAMAGE_MATERIALS[cls].shade] ?? 7;
void SHADE_MODES;

// ---------------------------------------------------------------------------------------
// Render index: which shared instances / merged triangles draw which prop

const NAME_RE = /^(?:prop|shop|container-body)-([A-Za-z]+)(?:-(.+))?$/;
interface InstEntry { mesh: THREE.InstancedMesh; index: number; key: string }
interface MergedEntry { mesh: THREE.Mesh; key: string; box: THREE.Box3; blockersOnly: boolean }

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpC = new THREE.Color();

function distToBox(p: THREE.Vector3, q: PropPlacement): number {
  const dx = Math.max(0, Math.abs(p.x - q.x) - q.hx), dz = Math.max(0, Math.abs(p.z - q.z) - q.hz);
  const dy = Math.max(0, q.y - p.y, p.y - (q.y + q.h));
  return Math.hypot(dx, dy, dz);
}

export class RenderIndex {
  readonly inst = new Map<PropPlacement, InstEntry[]>();
  readonly merged: MergedEntry[] = [];
  build(roots: readonly THREE.Object3D[], props: readonly PropPlacement[], blockerKinds: ReadonlySet<string>): void {
    this.inst.clear();
    this.merged.length = 0;
    const byKind = new Map<string, Map<string, PropPlacement[]>>();
    const B = 4;
    for (const p of props) {
      let m = byKind.get(p.kind);
      if (!m) byKind.set(p.kind, (m = new Map()));
      const k = `${Math.floor(p.x / B)},${Math.floor(p.z / B)}`;
      let l = m.get(k);
      if (!l) m.set(k, (l = []));
      l.push(p);
    }
    const nearest = (kind: string, c: THREE.Vector3): PropPlacement | null => {
      const m = byKind.get(kind);
      if (!m) return null;
      const bx = Math.floor(c.x / B), bz = Math.floor(c.z / B);
      let best: PropPlacement | null = null, bd = 0.9;
      for (let z = bz - 1; z <= bz + 1; z++) for (let x = bx - 1; x <= bx + 1; x++) {
        for (const p of m.get(`${x},${z}`) ?? []) { const d = distToBox(c, p); if (d < bd) { bd = d; best = p; } }
      }
      return best;
    };
    for (const root of roots) {
      root.updateMatrixWorld(true);
      root.traverse(o => {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) {
          const m = NAME_RE.exec(im.name);
          if (!m || !byKind.has(m[1])) return;
          const g = im.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const c0 = g.boundingBox!.getCenter(new THREE.Vector3());
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, tmpM);
            const c = tmpV.copy(c0).applyMatrix4(tmpM).applyMatrix4(im.matrixWorld);
            const p = nearest(m[1], c);
            if (!p) continue;
            let l = this.inst.get(p);
            if (!l) this.inst.set(p, (l = []));
            l.push({mesh: im, index: i, key: m[2] ?? ''});
          }
          return;
        }
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry.index) return;
        const purpose = mesh.name.startsWith('purpose-'), shopfront = mesh.name.startsWith('shopfront-');
        if (!purpose && !shopfront) return;
        const g = mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        this.merged.push({mesh, key: purpose ? mesh.name.slice(mesh.name.indexOf('|') + 1) : mesh.name.slice('shopfront-'.length), box: g.boundingBox!.clone().applyMatrix4(mesh.matrixWorld), blockersOnly: shopfront});
      });
    }
    void blockerKinds;
  }
}

/** Triangles of a merged mesh whose centroid lies inside the prop box (world). */
function trianglesIn(mesh: THREE.Mesh, p: PropPlacement, eps = 0.012): number[] {
  const g = mesh.geometry, idx = g.index!, pos = g.attributes.position as THREE.BufferAttribute;
  const e = mesh.matrixWorld.elements, ident = mesh.matrixWorld.equals(IDENT);
  const out: number[] = [];
  const x0 = p.x - p.hx - eps, x1 = p.x + p.hx + eps, z0 = p.z - p.hz - eps, z1 = p.z + p.hz + eps, y0 = p.y - eps, y1 = p.y + p.h + eps;
  for (let t = 0; t < idx.count / 3; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    if (a === b && b === c) continue; // already cut
    let x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (!ident) { const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14]; x = X; y = Y; z = Z; }
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) out.push(t);
  }
  return out;
}
const IDENT = new THREE.Matrix4();

/** New non-indexed geometry holding the given triangles of `src` (all its attributes). */
function extract(src: THREE.BufferGeometry, tris: readonly number[]): THREE.BufferGeometry {
  const idx = src.index!;
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const attr = a as THREE.BufferAttribute;
    const n = attr.itemSize, out = new Float32Array(tris.length * 3 * n);
    let o = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) { const vi = idx.getX(t * 3 + k); for (let c = 0; c < n; c++) out[o++] = attr.getComponent(vi, c); }
    g.setAttribute(name, new THREE.BufferAttribute(out, n));
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------------------------------

export class PropDamage {
  readonly group = new THREE.Group();
  readonly states = new Map<PropPlacement, PropState>();
  readonly index = new RenderIndex();
  hooks: PropDamageHooks = {};
  private props: readonly PropPlacement[] = [];
  private seed = 7;
  private readonly ray = new THREE.Raycaster();
  /** Shared materials cloned per detached prop (clone count, QA/tests). */
  clones = 0;

  constructor() {
    this.group.name = 'damaged-props';
  }

  build(props: readonly PropPlacement[], roots: readonly THREE.Object3D[], blockerKinds: ReadonlySet<string> = new Set(['shopGlazing', 'shopShutter'])): void {
    this.clear();
    this.props = props;
    this.index.build(roots, props, blockerKinds);
    this.blockers = blockerKinds;
  }

  /**
   * Program pre-warm: one zero-scale, never-visible-in-practice mesh per distinct shared material
   * (with the damage hook) so the renderer compiles the damage shader variants during the first
   * frames after a station loads instead of stalling on the first hit. The warm materials are kept
   * for the page (programs stay cached across stations); the meshes are dropped by dropWarmup().
   * Iteration 13 (MAT-B): the warm clone shares its node graph with every later damage clone of the
   * same source (memoNode), so the node build + pipeline it triggers is the one the first hit uses.
   * It carries no PartData (reads zeros: no damage).
   */
  warmup(): number {
    const seen = new Set<THREE.Material>();
    const add = (geo: THREE.BufferGeometry, src: THREE.Material | THREE.Material[]) => {
      const m = (Array.isArray(src) ? src[0] : src) as THREE.Material;
      if (seen.has(m) || PropDamage.warmMats.has(m) || !isStandardLike(m)) return;
      seen.add(m);
      const c = toNodeMaterial(m);
      if (!c) return;
      addPropDamageHooks(c);
      PropDamage.warmMats.set(m, c as unknown as THREE.Material);
      const mesh = new THREE.Mesh(geo, c as unknown as THREE.Material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(ZERO);
      mesh.frustumCulled = false;
      mesh.name = 'damage-warmup';
      this.warm.push(mesh);
      this.group.add(mesh);
    };
    for (const list of this.index.inst.values()) for (const e of list) add(e.mesh.geometry, e.mesh.material);
    for (const m of this.index.merged) add(m.mesh.geometry, m.mesh.material);
    return this.warm.length;
  }
  private static readonly warmMats = new Map<THREE.Material, THREE.Material>();
  private warm: THREE.Mesh[] = [];

  /** Remove the pre-warm meshes (call once the first frames have rendered). */
  dropWarmup(): void {
    for (const m of this.warm) this.group.remove(m);
    this.warm.length = 0;
  }

  get warming(): number {
    return this.warm.length;
  }
  private blockers: ReadonlySet<string> = new Set();

  state(prop: PropPlacement, index = this.props.indexOf(prop)): PropState {
    let s = this.states.get(prop);
    if (!s) {
      const spec = propDamageSpec(prop.kind);
      s = {prop, index, spec, hp: spec.integrity, glassHp: spec.glass?.integrity ?? 0, hits: 0, stage: 0, broken: false, glassBroken: false, parts: null, hidden: [], cuts: []};
      this.states.set(prop, s);
    }
    return s;
  }

  get detachedCount(): number {
    let n = 0;
    for (const s of this.states.values()) if (s.parts) n++;
    return n;
  }

  /** Detach the prop into its own meshes + material clones (idempotent). False when capped / nothing found. */
  detach(s: PropState, force = false): boolean {
    if (s.parts) return true;
    const n = this.detachedCount;
    if (n >= (force ? MAX_DETACHED_HARD : MAX_DETACHED)) return false;
    const p = s.prop;
    const parts: Part[] = [];
    const add = (mesh: THREE.Mesh, key: string, created: boolean, ownGeometry: boolean, moving: boolean, tint: THREE.Color | null) => {
      // own meshes may be wearing the containers.ts highlight clone right now: start from the real base material
      const cur = !created && mesh.userData.baseMat ? mesh.userData.baseMat as THREE.Material : mesh.material;
      const src = (Array.isArray(cur) ? cur[0] : cur) as THREE.Material;
      const cls = partKeyClass(key || src.name || '', partKeyClass(src.name || '', s.spec.cls));
      const glass = cls === 'glass' || cls === 'screen' || (!!(src as THREE.MeshStandardMaterial).transparent && cls !== 'plastic' && /glass/i.test(src.name || key));
      // Iteration 13 (MAT-B): own node-material copy + the prop-damage node stages; the part's state is per-object data
      const nodeMat = toNodeMaterial(src);
      if (nodeMat) addPropDamageHooks(nodeMat);
      const mat = (nodeMat as unknown as THREE.Material | null) ?? src.clone(); // no node counterpart: drawn as before, unmarked
      this.clones++;
      if (tint && (mat as THREE.MeshStandardMaterial).color) (mat as THREE.MeshStandardMaterial).color.multiply(tint);
      mesh.updateMatrixWorld(true);
      const u = new PartData(shadeIndex(glass && cls !== 'screen' ? 'glass' : cls), new THREE.Color(DAMAGE_MATERIALS[cls].substrate), mesh.matrixWorld);
      mesh.userData[PROP_DATA_KEY] = u.data;
      const prevMat = created ? null : cur;
      mesh.material = mat;
      if (!created && mesh.userData.baseMat) mesh.userData.baseMat = mat; // containers.ts highlight restores this
      parts.push({mesh, cls, glass, u, rest: mesh.matrixWorld.clone(), moving, created, ownGeometry, mat, prevMat, color: materialBaseColor(src, tint), lines: []});
    };
    // shared instances
    for (const e of this.index.inst.get(p) ?? []) {
      e.mesh.getMatrixAt(e.index, tmpM);
      const world = tmpM.clone().premultiply(e.mesh.matrixWorld);
      const tint = e.mesh.instanceColor ? new THREE.Color().fromArray(e.mesh.instanceColor.array as Float32Array, e.index * 3) : null;
      s.hidden.push({mesh: e.mesh, index: e.index, matrix: tmpM.clone()});
      e.mesh.setMatrixAt(e.index, ZERO);
      e.mesh.instanceMatrix.needsUpdate = true;
      const mesh = new THREE.Mesh(e.mesh.geometry, e.mesh.material as THREE.Material);
      mesh.name = `damaged-${p.kind}-${s.index}`;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(world);
      mesh.renderOrder = e.mesh.renderOrder;
      mesh.castShadow = e.mesh.castShadow; // Lane F flashlight shadow casters stay casters
      mesh.receiveShadow = e.mesh.receiveShadow;
      this.group.add(mesh);
      add(mesh, e.key, true, false, false, tint);
    }
    // merged chunk meshes (purpose props; shopfront blocks for glazing / shutters)
    const box = new THREE.Box3(new THREE.Vector3(p.x - p.hx, p.y, p.z - p.hz), new THREE.Vector3(p.x + p.hx, p.y + p.h, p.z + p.hz));
    for (const m of this.index.merged) {
      if (m.blockersOnly !== this.blockers.has(p.kind)) continue;
      if (!m.box.intersectsBox(box)) continue;
      const tris = trianglesIn(m.mesh, p);
      if (!tris.length) continue;
      const geo = extract(m.mesh.geometry, tris);
      const idx = m.mesh.geometry.index!;
      const arr = idx.array as Uint32Array | Uint16Array;
      const saved = new Uint32Array(tris.length * 3), tri = new Uint32Array(tris);
      tris.forEach((t, k) => { saved[k * 3] = arr[t * 3]; saved[k * 3 + 1] = arr[t * 3 + 1]; saved[k * 3 + 2] = arr[t * 3 + 2]; arr[t * 3 + 1] = arr[t * 3 + 2] = arr[t * 3]; });
      idx.needsUpdate = true;
      s.cuts.push({mesh: m.mesh, tris: tri, saved});
      const mesh = new THREE.Mesh(geo, m.mesh.material as THREE.Material);
      mesh.name = `damaged-${p.kind}-${s.index}-${m.key}`;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m.mesh.matrixWorld);
      mesh.renderOrder = m.mesh.renderOrder;
      mesh.castShadow = m.mesh.castShadow;
      mesh.receiveShadow = m.mesh.receiveShadow;
      this.group.add(mesh);
      add(mesh, m.key, true, true, false, null);
    }
    // meshes owned by this prop alone (container doors / lid / interior)
    for (const mesh of this.hooks.ownMeshes?.(p) ?? []) add(mesh, '', false, false, true, null);
    if (!parts.length) return false;
    this.group.updateMatrixWorld(true);
    s.parts = parts;
    // vending-style baked glass front region (prop-local fractions)
    if (s.spec.glassFront) {
      const local = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1)).invert();
      const quarter = Math.round(p.rot / (Math.PI / 2)) & 1;
      const w = quarter ? p.hz * 2 : p.hx * 2, d = quarter ? p.hx * 2 : p.hz * 2;
      local.premultiply(new THREE.Matrix4().makeScale(1 / w, 1 / p.h, 1 / d));
      const [x0, x1, y0, y1] = s.spec.glassFront;
      for (const part of parts) { part.u.setLocal(local); part.u.setFront(x0, x1, y0, y1); part.u.frontOn = 1; }
    }
    return true;
  }

  /**
   * Iteration 07 (Lane K): a light prop becomes a rigid body (physics/dynamicItems.ts). Detach it
   * (forced past the soft cap) and mark its parts MOVING, so later bullet marks convert through the
   * part's current matrix into its rest frame. Returns the meshes drawn for it alone (their
   * `matrix` = world; the caller drives them), or null when nothing could be detached.
   */
  detachForPhysics(prop: PropPlacement, index: number): THREE.Mesh[] | null {
    const s = this.state(prop, index);
    if (!this.detach(s, true) || !s.parts) return null;
    for (const q of s.parts) q.moving = true;
    return s.parts.filter(q => q.created).map(q => q.mesh);
  }

  /**
   * Task office-interactions-layout-20261030 (lane PHYS): soft-cap detach slots left. Office furniture woken by walking into it
   * (physics/dynamicItems.ts contact wake) stops while fewer than CONTACT_RESERVE remain, so bullet marks keep their headroom.
   */
  detachRoom(): number {
    return MAX_DETACHED - this.detachedCount;
  }

  /** Whether another prop rests on top of this one (it then never fully breaks: no floating stacks). */
  private supports(p: PropPlacement): boolean {
    const top = p.y + p.h;
    return this.props.some(q => q !== p && Math.abs(q.y - top) < 0.06 && Math.abs(q.x - p.x) < q.hx + p.hx - 0.05 && Math.abs(q.z - p.z) < q.hz + p.hz - 0.05);
  }

  hit(h: PropHit): PropHitResult {
    const s = this.state(h.prop, h.index);
    const res: PropHitResult = {cls: s.spec.cls, glass: false, point: h.point.clone(), normal: h.normal.clone(), color: new THREE.Color(DAMAGE_MATERIALS[s.spec.cls].palette[0]), stage: s.stage, broke: null, boxes: [], marked: false, rubble: s.broken};
    if (s.broken) return res;
    // glass / breakable props may exceed the soft detach cap (their break needs their own meshes)
    this.detach(s, !!s.spec.glass || s.spec.breaks !== 'never');
    // refine onto the real surface: first detached part along the shot (inside the prop box)
    let part: Part | null = null;
    if (s.parts) {
      const back = 0.35;
      this.ray.set(tmpV.copy(h.point).addScaledVector(h.dir, -back), h.dir);
      this.ray.near = 0;
      this.ray.far = back + Math.hypot(h.prop.hx * 2, h.prop.h, h.prop.hz * 2);
      const vis = s.parts.filter(q => q.mesh.visible);
      const hits = this.ray.intersectObjects(vis.map(q => q.mesh), false);
      if (hits.length) {
        const first = hits[0];
        part = vis.find(q => q.mesh === first.object) ?? null;
        res.point.copy(first.point);
        if (first.face) res.normal.copy(first.face.normal).transformDirection(first.object.matrixWorld);
        if (res.normal.dot(h.dir) > 0) res.normal.negate();
      } else part = vis.find(q => !q.glass) ?? vis[0] ?? null;
    }
    // baked glass front (vending): front-face hits inside the region
    let frontGlass = false;
    if (s.spec.glassFront && s.spec.glass && !s.glassBroken) {
      const l = tmpV.copy(res.point).sub(new THREE.Vector3(h.prop.x, h.prop.y, h.prop.z)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -h.prop.rot);
      const quarter = Math.round(h.prop.rot / (Math.PI / 2)) & 1;
      const w = quarter ? h.prop.hz * 2 : h.prop.hx * 2, d = quarter ? h.prop.hx * 2 : h.prop.hz * 2;
      const [x0, x1, y0, y1] = s.spec.glassFront;
      frontGlass = l.z / d > 0.4 && l.x / w > x0 && l.x / w < x1 && l.y / h.prop.h > y0 && l.y / h.prop.h < y1;
    }
    const glassHit = !!s.spec.glass && (frontGlass || !!part?.glass) && !s.glassBroken;
    const cls: DamageClass = glassHit ? (frontGlass ? 'glass' : part!.cls) : part && !part.glass ? part.cls : s.spec.cls;
    res.cls = cls;
    res.glass = glassHit || !!part?.glass;
    if (part) res.color.copy(part.color);
    s.hits++;
    const dmg = propHitDamage(cls, h.damage);
    if (glassHit && s.spec.glass) {
      s.glassHp -= dmg;
      if (s.glassHp <= 0) {
        s.glassBroken = true;
        res.broke = s.spec.glass.on;
        this.breakGlass(s, res);
      }
    } else if (Number.isFinite(s.hp)) {
      s.hp -= dmg;
      if (s.hp <= 0 && s.spec.breaks !== 'never') {
        if (this.supports(s.prop)) s.hp = 1; // something stands on it: heavily damaged, not collapsed
        else {
          s.broken = true;
          res.broke = s.spec.breaks;
          this.breakBody(s, res);
        }
      }
    }
    s.stage = damageStage(s.hp, s.spec.integrity, s.hits);
    if (s.broken) s.stage = 3;
    res.stage = s.stage;
    if (s.parts && !s.broken) {
      res.marked = true;
      const spec = DAMAGE_MATERIALS[cls];
      const r = spec.markSize * (h.pellet ? 0.7 : 1) * (0.85 + 0.3 * Math.min(1.5, h.damage / 24));
      const strength = Math.min(1, (h.pellet ? 0.25 : 0.5) * (1 - spec.hardness * 0.5) + s.hits * 0.04);
      const crack = glassHit || part?.glass ? Math.min(7, 3 + (s.spec.glass ? (1 - Math.max(0, s.glassHp) / s.spec.glass.integrity) * 4 : 2)) : 0;
      const start = res.point.clone().addScaledVector(h.dir, -0.03);
      for (const q of s.parts) this.addLine(q, start, h.dir, spec.pierce + 0.03, r, strength, crack);
    }
    return res;
  }

  private addLine(q: Part, a: THREE.Vector3, d: THREE.Vector3, len: number, r: number, strength: number, crack: number): void {
    let A = a, D = d;
    if (q.moving) {
      // world -> the part's rest frame (door / lid may have swung since detach)
      q.mesh.updateWorldMatrix(true, false);
      const m = tmpM.copy(q.mesh.matrixWorld).invert().premultiply(q.rest);
      A = a.clone().applyMatrix4(m);
      D = d.clone().transformDirection(m);
    }
    // merge into a line that already passes here (repeated hits widen / strengthen it)
    for (const l of q.lines) {
      if (l.a.distanceTo(A) < l.r * 0.6 + r * 0.3 && l.d.dot(D) > 0.8) {
        l.r = Math.min(DAMAGE_MATERIALS[q.cls].markMax, Math.sqrt(l.r * l.r + r * r * 0.5));
        l.strength = Math.min(1, l.strength + strength * 0.5);
        l.crack = Math.min(9, Math.max(l.crack, crack) + (crack > 0 ? 0.6 : 0));
        this.upload(q);
        return;
      }
    }
    const line: Line = {a: A.clone(), d: D.clone().normalize(), len, r, strength, seed: (this.seed = (this.seed * 16807) % 2147483647) / 2147483647 * 40, crack};
    if (q.lines.length >= DMG_MAX) {
      // full: fold into the nearest line
      let best = q.lines[0], bd = Infinity;
      for (const l of q.lines) { const dd = l.a.distanceTo(A); if (dd < bd) { bd = dd; best = l; } }
      best.r = Math.min(DAMAGE_MATERIALS[q.cls].markMax, best.r * 1.08);
      best.strength = Math.min(1, best.strength + strength * 0.3);
    } else q.lines.push(line);
    this.upload(q);
  }

  private upload(q: Part): void {
    q.lines.forEach((l, i) => q.u.setLine(i, l));
    q.u.n = q.lines.length;
  }

  private breakGlass(s: PropState, res: PropHitResult): void {
    this.detach(s, true);
    const g = s.spec.glass!;
    const parts = s.parts ?? [];
    if (g.on === 'shatter') {
      for (const q of parts) if (q.glass) { q.mesh.visible = false; res.boxes.push(new THREE.Box3().setFromObject(q.mesh)); }
      if (s.prop.kind === 'shopGlazing') { s.prop.h = Math.min(s.prop.h, 0.3); }
    } else if (g.on === 'dead') {
      for (const q of parts) if (q.cls === 'screen') { q.u.dead = 1; res.boxes.push(new THREE.Box3().setFromObject(q.mesh)); }
    } else if (g.on === 'open') {
      for (const q of parts) q.u.frontBroken = 1;
      const p = s.prop, quarter = Math.round(p.rot / (Math.PI / 2)) & 1;
      const fx = Math.sin(p.rot), fz = Math.cos(p.rot), dHalf = quarter ? p.hx : p.hz;
      const c = new THREE.Vector3(p.x + fx * dHalf, p.y + p.h * 0.6, p.z + fz * dHalf);
      res.boxes.push(new THREE.Box3().setFromCenterAndSize(c, new THREE.Vector3(quarter ? 0.05 : p.hx * 1.2, p.h * 0.55, quarter ? p.hz * 1.2 : 0.05)));
    }
    if (!res.boxes.length) res.boxes.push(new THREE.Box3(new THREE.Vector3(s.prop.x - s.prop.hx, s.prop.y, s.prop.z - s.prop.hz), new THREE.Vector3(s.prop.x + s.prop.hx, s.prop.y + s.prop.h, s.prop.z + s.prop.hz)));
    this.hooks.onBreak?.({prop: s.prop, index: s.index, kind: g.on, boxes: res.boxes, color: res.color});
  }

  private breakBody(s: PropState, res: PropHitResult): void {
    this.detach(s, true);
    const p = s.prop;
    res.boxes.push(new THREE.Box3(new THREE.Vector3(p.x - p.hx, p.y, p.z - p.hz), new THREE.Vector3(p.x + p.hx, p.y + p.h, p.z + p.hz)));
    for (const q of s.parts ?? []) q.mesh.visible = false;
    // rubble: collision / bullets / sight no longer stopped by the box
    p.h = 0.02;
    p.blocksSight = false;
    this.hooks.onBreak?.({prop: p, index: s.index, kind: s.spec.breaks as BreakKind, boxes: res.boxes, color: res.color});
  }

  /** Remove detached copies, restore shared instances / merged triangles / own-mesh materials. */
  clear(): void {
    this.dropWarmup();
    for (const s of this.states.values()) {
      for (const hd of s.hidden) { hd.mesh.setMatrixAt(hd.index, hd.matrix); hd.mesh.instanceMatrix.needsUpdate = true; }
      for (const c of s.cuts) {
        const arr = c.mesh.geometry.index?.array as Uint32Array | undefined;
        if (arr) { c.tris.forEach((t, k) => { arr[t * 3] = c.saved[k * 3]; arr[t * 3 + 1] = c.saved[k * 3 + 1]; arr[t * 3 + 2] = c.saved[k * 3 + 2]; }); c.mesh.geometry.index!.needsUpdate = true; }
      }
      for (const q of s.parts ?? []) {
        if (q.created) this.group.remove(q.mesh);
        else if (q.prevMat) { q.mesh.material = q.prevMat; if (q.mesh.userData.baseMat === q.mat) q.mesh.userData.baseMat = q.prevMat; }
        if (!q.created) delete q.mesh.userData[PROP_DATA_KEY]; // Iteration 13 (MAT-B)
        if (q.ownGeometry) q.mesh.geometry.dispose();
        q.mat.dispose();
      }
    }
    this.states.clear();
    this.clones = 0;
  }

  stats(): {damaged: number; detached: number; broken: number; glassBroken: number; lines: number; clones: number} {
    let damaged = 0, broken = 0, glass = 0, lines = 0;
    for (const s of this.states.values()) {
      if (s.hits) damaged++;
      if (s.broken) broken++;
      if (s.glassBroken) glass++;
      for (const q of s.parts ?? []) lines += q.lines.length;
    }
    return {damaged, detached: this.detachedCount, broken, glassBroken: glass, lines, clones: this.clones};
  }
}

/** Colour helper for fragment palettes (exported for the system). */
export function partColor(r: PropHitResult): THREE.Color {
  return tmpC.copy(r.color);
}
