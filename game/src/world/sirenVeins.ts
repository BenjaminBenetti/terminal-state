// Task track1-siren-blightbelly-20261031 (lane SIREN): the Siren's GROUND CORRUPTION — a localized vein / growth patch on the floor
// where she lies dormant. User: "she should also when she spawns uh kind of corrupt the ground around her with perhaps a bit of a
// kind of uh vein kind of texture sort of growth ... somewhat dynamic ... not ... one static model ... maybe just a bit of a texture
// applied to the ground ... where she's kind of laying".
//
// Decal-like, visual only (no damage, no collision, no spreading simulation, no trails):
//  - FOOTPRINT (veinCells, pure): the 0.5 m floor cells of HER storey around her placement that the patch's visible organic edge can
//    reach (visibleRadius = radius 2.0 m x 1.19 <= maxRadius 2.5 m; cells by their nearest point, so open floor never cuts the edge),
//    flood-filled 4-connected from her cell, each cell kept only if all four inset corner points stand on the SAME level and floor
//    height (Levels.supportIn: no stairs / ramps / steps / track bed / stairwell openings / walls / the elevator cab) and a ray at
//    sightY over the floor from her reaches its centre (Levels.lineOfSight: a wall or sight-blocking prop between = no veins behind
//    it). So the patch never bleeds through a wall or down a storey. Capped at maxCells.
//  - MESH: one flat quad per kept cell at the floor + `lift`, merged into ONE indexed geometry per patch (one draw), drawn with ONE
//    shared node material (depth-tested, no depth write, polygon offset: no z-fighting with the floor). At most maxPatches at once.
//  - LOOK (TSL, the shared material): seeded domain-warped ridged value noise (damage/tsl.ts dmgNoise) -> dark wine-coloured veins
//    spreading radially out from under her plus branching loops and fine capillaries over a faint stain, thicker toward her,
//    irregular organic edge (7 noise evaluations per fragment, shared by the colour / roughness / emissive slots); SUBTLY ANIMATED from the global `time` node (cf. world/rackLeds.ts):
//    the vein width breathes slowly and a faint, dull crimson pulse travels outward along the veins (emissive ~0.06 at its peak:
//    a surface tint, not a light). Lit by the scene like the floor (the flashlight shows it).
//  - PER-PATCH DATA through damage/tsl.ts objectData (`mesh.userData.sirenVein`, 2 vec4: centre x / z, radius, seed; fade): one node
//    graph / pipeline for every patch; a mesh without data (the warm-up prototype) reads fade 0 and draws nothing.
//  - LIFECYCLE: built while she is dormant (section build / spawn), fades out over fadeOutS after she wakes or dies, then its
//    geometry is disposed; every patch is disposed at section teardown. A revisit rebuilds a patch only for a still-dormant Siren.
//  - WARM-UP: the hidden prototype quad (same material + attribute layout) is the game's warm pool 'siren-veins'.

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {Discard, Fn, abs, clamp, float, length, max, min, mix, positionWorld, sin, smoothstep, time, vec2, vec3, vec4} from 'three/tsl';
import {CELL} from '../gen/grid';
import type {Levels} from '../gen/levels';
import {dmgNoise, objectData, type TNode} from '../damage/tsl';

export const SIREN_VEINS = {
  /** Nominal patch radius (m) around her feet; the organic edge (edgeNoise) reaches visibleRadius() = radius x 1.19 <= maxRadius. */
  radius: 2.0,
  maxRadius: 2.5,
  /** Edge irregularity (in units of the radius) of the shader's organic border. */
  edgeNoise: 0.38,
  /** Patches alive at once (each Siren owns one). */
  maxPatches: 4,
  /** Cells per patch (0.5 m cells: a full open-floor patch is ~90). */
  maxCells: 120,
  /** Height over the floor (m) + polygon offset. */
  lift: 0.006,
  /** A cell's four inset corners must stand within this of her floor height (m) on her level. */
  flatTol: 0.02,
  /** Corner inset from the cell edge (m) for the support test. */
  inset: 0.06,
  /** Clip ray height over the floor (m): a wall / sight-blocking prop between her and a cell keeps the veins out of it. */
  sightY: 0.3,
  /** Fade-out (s) after she wakes / dies. */
  fadeOutS: 6,
  /** Pulse emissive peak (linear) and colours (linear RGB). */
  glow: 0.06,
  veinColor: [0.04, 0.008, 0.018] as const,
  stainColor: [0.03, 0.022, 0.024] as const,
  glowColor: [1.0, 0.16, 0.22] as const,
} as const;

/** objectData key / layout on the patch mesh: vec4(cx, cz, radius, seed), vec4(fade, 0, 0, 0). */
export const VEIN_DATA_KEY = 'sirenVein';

export interface VeinFootprint {
  level: number;
  floor: number;
  /** Kept cells (main-grid cell x / y). */
  cells: [number, number][];
}

/**
 * The floor cells a patch may cover around (x, y = her feet, z): see the header. null when she does not stand on a grid floor
 * (inside the elevator cab, unsupported).
 */
/** Outermost radius (m) the shader's organic edge can show veins / stain at for a nominal radius (never above maxRadius). */
export function visibleRadius(radius: number = SIREN_VEINS.radius): number {
  return Math.min(SIREN_VEINS.maxRadius, Math.max(0, radius) * (1 + SIREN_VEINS.edgeNoise / 2));
}

export function veinCells(L: Pick<Levels, 'supportIn' | 'lineOfSight' | 'main'>, x: number, y: number, z: number, radius: number = SIREN_VEINS.radius): VeinFootprint | null {
  const V = SIREN_VEINS;
  const s0 = L.supportIn(x, z, y + 0.05);
  if (!s0 || s0.volume) return null;
  const level = s0.level, floor = s0.floor, g = L.main;
  // every cell the visible edge can reach (nearest point of the cell): on open floor the organic border is never cut by a cell edge
  const reach = visibleRadius(radius);
  const c0x = Math.floor(x / CELL), c0y = Math.floor(z / CELL);
  const flat = (px: number, pz: number) => {
    const s = L.supportIn(px, pz, floor + 0.05);
    return !!s && !s.volume && s.level === level && Math.abs(s.floor - floor) <= V.flatTol;
  };
  const eye = {x, y: floor + V.sightY, z};
  const ok = (cx: number, cy: number) => {
    if (!g.inBounds(cx, cy)) return false;
    const wx = (cx + 0.5) * CELL, wz = (cy + 0.5) * CELL;
    const nx = Math.max(cx * CELL, Math.min(x, (cx + 1) * CELL)), nz = Math.max(cy * CELL, Math.min(z, (cy + 1) * CELL));
    if (Math.hypot(nx - x, nz - z) > reach) return false;
    const a = cx * CELL + V.inset, b = (cx + 1) * CELL - V.inset, c = cy * CELL + V.inset, d = (cy + 1) * CELL - V.inset;
    if (!flat(a, c) || !flat(b, c) || !flat(a, d) || !flat(b, d)) return false;
    return (cx === c0x && cy === c0y) || L.lineOfSight(eye, {x: wx, y: floor + V.sightY, z: wz}, {slack: 0.05});
  };
  const cells: [number, number][] = [];
  if (!ok(c0x, c0y)) return {level, floor, cells};
  const seen = new Set<number>([c0y * g.w + c0x]);
  const queue: [number, number][] = [[c0x, c0y]];
  while (queue.length && cells.length < V.maxCells) {
    const [cx, cy] = queue.shift()!;
    cells.push([cx, cy]);
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
      const k = ny * g.w + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      if (ok(nx, ny)) queue.push([nx, ny]);
    }
  }
  return {level, floor, cells};
}

/** One merged flat geometry for a footprint (world-space vertices, +Y normals, one quad per cell). */
export function veinGeometry(fp: VeinFootprint): THREE.BufferGeometry {
  const n = fp.cells.length, y = fp.floor + SIREN_VEINS.lift;
  const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), idx = new Uint16Array(n * 6);
  fp.cells.forEach(([cx, cy], i) => {
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cy * CELL, z1 = z0 + CELL;
    pos.set([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0], i * 12);
    for (let k = 0; k < 4; k++) nor[i * 12 + k * 3 + 1] = 1;
    const v = i * 4;
    idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6); // counter-clockwise seen from above (+Y)
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** The shared vein material (one TSL graph for every patch; per-patch data via objectData). */
export function sirenVeinMaterial(): MeshStandardNodeMaterial {
  const V = SIREN_VEINS;
  const mat = new MeshStandardNodeMaterial({color: 0xffffff, roughness: 0.8, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
  mat.name = 'siren-veins';
  const data = objectData(VEIN_DATA_KEY, 2);
  // shared fields (fragment; built once, referenced by the colour / roughness / emissive slots): vein mask, stain, edge, pulse
  const d0 = data.element(0) as TNode, d1 = data.element(1) as TNode;
  const seed = d0.w as TNode, R = max(d0.z, 0.05) as TNode, fade = clamp(d1.x, 0, 1) as TNode;
  const p = (positionWorld as TNode).xz as TNode;
  const rel = p.sub(d0.xy) as TNode;
  const dist = length(rel) as TNode;
  const edgeN = dmgNoise(vec3(rel.mul(1.3), seed.add(11))) as TNode;
  const edge = smoothstep(1.0, 0.5, dist.div(R).add(edgeN.sub(0.5).mul(V.edgeNoise))) as TNode; // 1 near her, 0 past the organic border (<= visibleRadius)
  const warp = vec2(dmgNoise(vec3(p.mul(0.9), seed)), dmgNoise(vec3(p.mul(0.9).add(5.2), seed.add(3)))).sub(0.5).mul(0.9) as TNode;
  const q = p.add(warp) as TNode;
  const ridge1 = abs(dmgNoise(vec3(q.mul(2.6), seed.add(1.7))).sub(0.5)).mul(2) as TNode;
  const ridge2 = abs(dmgNoise(vec3(q.mul(6.1), seed.add(4.3))).sub(0.5)).mul(2) as TNode;
  // subtle animation: the vein width breathes (~7 s period), a faint pulse runs outward along the veins
  const breathe = sin((time as TNode).mul(0.9).add(seed.mul(6.2832))).mul(0.5).add(0.5) as TNode;
  const w = mix(float(0.05), float(0.12), edge).mul(breathe.mul(0.22).add(0.9)) as TNode;
  const loops = smoothstep(w, w.mul(0.35), ridge1).mul(edge).mul(0.8) as TNode;
  const fine = smoothstep(w.mul(0.55), w.mul(0.15), ridge2).mul(0.7).mul(edge).mul(edge) as TNode;
  // radial veins spreading out from under her: noise on the unit circle of the (warped) direction, drifting slowly with distance;
  // the ridge width is divided by the distance so the veins keep ~3-5 cm and taper toward the edge
  const qr = rel.add(warp) as TNode;
  const u = qr.div(max(length(qr), 1e-4)) as TNode;
  const ridge3 = abs(dmgNoise(vec3(u.x.mul(2.4).add(7.1), u.y.mul(2.4).sub(3.3), dist.mul(0.7).add(seed).add(21))).sub(0.5)).mul(2) as TNode;
  const wr = min(float(0.1).div(max(dist, 0.3)), 0.35).mul(mix(float(0.25), float(1), edge)).mul(breathe.mul(0.22).add(0.9)) as TNode;
  const radial = smoothstep(wr, wr.mul(0.3), ridge3).mul(edge) as TNode;
  const main = max(loops, radial) as TNode;
  const vein = max(main, fine) as TNode;
  const blot = smoothstep(0.25, 0.8, dmgNoise(vec3(p.mul(3.3), seed.add(9)))) as TNode;
  const stain = edge.mul(blot.mul(0.5).add(0.5)).mul(0.3) as TNode;
  const wave = sin((time as TNode).mul(1.4).sub(dist.mul(3.2)).add(seed.mul(6.2832))).mul(0.5).add(0.5) as TNode;
  const pulse = smoothstep(0.7, 1.0, wave) as TNode;
  mat.colorNode = Fn(() => {
    const a = max(vein, stain).mul(fade) as TNode;
    Discard(a.lessThan(0.01));
    const col = mix(vec3(...V.stainColor), vec3(...V.veinColor), clamp(vein.mul(1.6), 0, 1));
    return vec4(col, a);
  })();
  mat.roughnessNode = mix(float(0.85), float(0.35), clamp(vein, 0, 1)); // wet sheen on the veins
  mat.emissiveNode = vec3(...V.glowColor).mul(main.mul(pulse).mul(fade).mul(V.glow));
  return mat;
}

export interface VeinPatch {
  readonly id: object;
  readonly mesh: THREE.Mesh;
  readonly footprint: VeinFootprint;
  readonly x: number; readonly z: number; readonly radius: number; readonly seed: number;
  /** 0..1 (1 = fully shown). */
  fade: number;
  /** Fading out (woke / died); disposed when fade reaches 0. */
  fading: boolean;
}

/** Every Siren patch of the live section (one group in the scene, one shared material, bounded count). */
export class SirenVeinField {
  readonly group = new THREE.Group();
  readonly material: MeshStandardNodeMaterial;
  /** Hidden warm-up quad (same material / attribute layout; no data = draws nothing). */
  readonly prototype: THREE.Mesh;
  private readonly patches = new Map<object, VeinPatch>();
  readonly stats = {built: 0, disposed: 0, rejected: 0};

  constructor() {
    this.group.name = 'siren-veins';
    this.material = sirenVeinMaterial();
    this.prototype = new THREE.Mesh(veinGeometry({level: 0, floor: -500, cells: [[0, 0]]}), this.material);
    this.prototype.name = 'siren-veins-warm';
    this.prototype.visible = false;
    this.prototype.frustumCulled = false;
    this.group.add(this.prototype);
  }

  get count(): number { return this.patches.size; }
  get list(): VeinPatch[] { return [...this.patches.values()]; }
  get(id: object): VeinPatch | undefined { return this.patches.get(id); }

  /** Build the patch of one dormant Siren (null: no floor / cap reached / nothing kept). `seed` 0..1. */
  add(id: object, L: Pick<Levels, 'supportIn' | 'lineOfSight' | 'main'>, x: number, y: number, z: number, seed: number): VeinPatch | null {
    if (this.patches.has(id)) return this.patches.get(id)!;
    if (this.patches.size >= SIREN_VEINS.maxPatches) { this.stats.rejected++; return null; }
    const fp = veinCells(L, x, y, z);
    if (!fp || !fp.cells.length) { this.stats.rejected++; return null; }
    const mesh = new THREE.Mesh(veinGeometry(fp), this.material);
    mesh.name = 'siren-veins-patch';
    mesh.renderOrder = 1;
    mesh.castShadow = mesh.receiveShadow = false;
    const radius = SIREN_VEINS.radius;
    const data = new Float32Array([x, z, radius, seed * 97.3, 1, 0, 0, 0]);
    mesh.userData[VEIN_DATA_KEY] = data;
    this.group.add(mesh);
    const patch: VeinPatch = {id, mesh, footprint: fp, x, z, radius, seed, fade: 1, fading: false};
    this.patches.set(id, patch);
    this.stats.built++;
    return patch;
  }

  /** She woke / died: fade the patch out (then dispose); `now` = dispose at once. */
  release(id: object, now = false): void {
    const p = this.patches.get(id);
    if (!p) return;
    if (now) { this.drop(p); return; }
    p.fading = true;
  }

  /** Advance fades (cheap; patches only). */
  update(dt: number): void {
    for (const p of this.patches.values()) {
      if (!p.fading) continue;
      p.fade = Math.max(0, p.fade - dt / SIREN_VEINS.fadeOutS);
      (p.mesh.userData[VEIN_DATA_KEY] as Float32Array)[4] = p.fade;
      if (p.fade <= 0) this.drop(p);
    }
  }

  private drop(p: VeinPatch): void {
    this.group.remove(p.mesh);
    p.mesh.geometry.dispose();
    this.patches.delete(p.id);
    this.stats.disposed++;
  }

  /** Section teardown: every patch goes now (the shared material and the prototype stay). */
  clear(): void {
    for (const p of [...this.patches.values()]) this.drop(p);
  }

  dispose(): void {
    this.clear();
    this.prototype.geometry.dispose();
    this.material.dispose();
  }
}
