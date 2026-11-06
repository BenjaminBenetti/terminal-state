// Task studio-skyways-level-20261106-054448 (lane ADDON): the Skyways ADD-ON's section runtime, installed into Game like the glazing
// runtime (world/skywaysWindows.ts), inert without layout.skyways:
//  - preload (Game.sectionPreloads, behind the loading screen): the Codex art atlases the add-on's panels show (level-only
//    textures/skyways/*.jpg through LevelResources: released with the level) -> one SurfaceNodeMaterial per atlas, handed to the builder
//    (world/skywaysAddon.ts setSkywaysAddonArtMaterial) before the world is built; a failed / missing atlas leaves the plain board
//    stand-in (never substitute drawn art);
//  - build (sectionHooks): the prize car's TURNTABLE (a low dark disc under the car's spot: render only, no collision — the car drives
//    off it; lane CAR spawns the car itself) and the red velvet ROPES between neighbouring rope stanchions of the ring
//    (gen/skyways/addonPrize.ts: posts round the spot, by angle; a gap wider than SKYWAYS_ROPE.maxSpan — the exit lane — gets none):
//    one merged tube mesh, storey-culled, disposed on teardown;
//  - per frame: each rope hangs as a sagging curve between its posts' eye rings while both posts stand upright within the rope's
//    reach — following them when they are nudged (loose posts: physics/dynamicItems.ts propMatrix) — and DROPS to the floor for good
//    the moment a post tips over or is pushed out of reach (never floating, never stretched). Bounded: a dozen ropes, geometry rewritten
//    only when a post moved.

import * as THREE from 'three';
import type {PropPlacement} from '../gen/props';
import type {StationLayout} from '../gen/stationTypes';
import {SKYWAYS_ART, type SkywaysArtAtlasKey} from '../assets/skywaysArt.generated';
import {SKYWAYS_STANCHION} from '../gen/skyways/addonKinds';
import {SKYWAYS_ROPE, SKYWAYS_TURNTABLE_R} from '../gen/skyways/addonPrize';
import {SurfaceNodeMaterial} from './materials';
import {setSkywaysAddonArtMaterial, skywaysAddonAtlases} from './skywaysAddon';

/** Longest wait for the art atlases before the world is built (then: the plain boards). */
export const SKYWAYS_ADDON_ART_WAIT_MS = 6000;
/** Rope tube: radius, segments along, sides. */
export const ROPE_TUBE = {r: 0.02, seg: 12, sides: 6} as const;
/** A post leaning more than this (cos of the tilt) drops its ropes. */
const UPRIGHT_COS = Math.cos(0.35);

export interface SkywaysAddonHost {
  scene: THREE.Scene;
  levelResources: {load(level: string, url: string, spec: {srgb: boolean; repeat: boolean}): Promise<THREE.Texture | null>; own<T extends {dispose(): void}>(level: string, r: T): T};
  physics?: {dynamicItems: {propMatrix?(prop: PropPlacement, out: THREE.Matrix4): boolean}} | null;
  frameHooks: ((dt: number) => void)[];
  sectionHooks: {build?(layout: StationLayout): void; teardown?(): void}[];
  sectionPreloads?: ((layout: StationLayout) => Promise<void>)[];
  world?: {culler?: unknown} | null;
}

/** One velvet rope between two posts (by their placements). */
export interface Rope {
  a: PropPlacement;
  b: PropPlacement;
  /** Rope length (m): the rest span x slack. */
  len: number;
  /** Floor height under it (absolute). */
  floor: number;
  dropped: boolean;
  /** Last drawn ring points (change detection). */
  last: number[];
}

/** The ropes of a layout: neighbouring stanchions round the car's spot (by angle), gaps over maxSpan left open. */
export function planRopes(layout: StationLayout): Rope[] {
  const car = layout.skyways?.addon.car;
  if (!car) return [];
  const posts = layout.props.filter(p => p.kind === 'skywaysPrizeStanchion' && (p.level ?? 0) === car.level)
    .map(p => ({p, a: Math.atan2(p.x - car.x, p.z - car.z)})).sort((q, r) => q.a - r.a).map(q => q.p);
  const out: Rope[] = [];
  for (let i = 0; i < posts.length && posts.length > 1; i++) {
    const a = posts[i], b = posts[(i + 1) % posts.length];
    if (a === b || (posts.length === 2 && i === 1)) continue;
    const span = Math.hypot(a.x - b.x, a.z - b.z);
    if (span > SKYWAYS_ROPE.maxSpan) continue;
    out.push({a, b, len: span * SKYWAYS_ROPE.slack, floor: a.y, dropped: false, last: []});
  }
  return out;
}

const tmA = new THREE.Matrix4(), tmB = new THREE.Matrix4(), va = new THREE.Vector3(), vb = new THREE.Vector3();
const tq = new THREE.Quaternion(), tp = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);

/**
 * The rope's centre line (seg + 1 points, x y z) for its posts' current poses (`pose`: object -> world matrix of a post, filling
 * `out`); flips `rope.dropped` (for good) when a post is down or out of reach. Pure (tests drive it).
 */
export function ropeLine(rope: Rope, pose: (p: PropPlacement, out: THREE.Matrix4) => THREE.Matrix4, out: number[] = []): number[] {
  const n = ROPE_TUBE.seg;
  out.length = 0;
  const ma = pose(rope.a, tmA), mb = pose(rope.b, tmB);
  va.set(0, SKYWAYS_STANCHION.ringY, 0).applyMatrix4(ma);
  vb.set(0, SKYWAYS_STANCHION.ringY, 0).applyMatrix4(mb);
  const span = va.distanceTo(vb);
  if (!rope.dropped && (ma.elements[5] < UPRIGHT_COS || mb.elements[5] < UPRIGHT_COS || span > rope.len)) rope.dropped = true;
  if (!rope.dropped) {
    // a hanging cable: parabolic sag for its length (s = sqrt(3 L (S - L) / 8)), ends on the eye rings
    const sag = Math.sqrt(Math.max(0, 3 * span * (rope.len - span) / 8));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push(va.x + (vb.x - va.x) * t, va.y + (vb.y - va.y) * t - 4 * sag * t * (1 - t), va.z + (vb.z - va.z) * t);
    }
    return out;
  }
  // dropped: lying on the floor from under one ring toward the other (never longer than itself), a slack wiggle
  const y = rope.floor + ROPE_TUBE.r;
  let dx = vb.x - va.x, dz = vb.z - va.z;
  const L = Math.hypot(dx, dz) || 1;
  const reach = Math.min(L, rope.len * 0.97);
  dx /= L; dz /= L;
  for (let i = 0; i <= n; i++) {
    const t = i / n, w = Math.sin(t * Math.PI * 2) * 0.06 * Math.min(1, rope.len - reach + 0.3);
    out.push(va.x + dx * reach * t - dz * w, y, va.z + dz * reach * t + dx * w);
  }
  return out;
}

/** Writes a tube round a centre line into position / normal arrays at vertex offset `v0`. */
function writeTube(line: readonly number[], pos: Float32Array, nrm: Float32Array, v0: number): void {
  const n = ROPE_TUBE.seg, k = ROPE_TUBE.sides, r = ROPE_TUBE.r;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n, i + 1);
    T.set(line[i1 * 3] - line[i0 * 3], line[i1 * 3 + 1] - line[i0 * 3 + 1], line[i1 * 3 + 2] - line[i0 * 3 + 2]).normalize();
    N.crossVectors(T, up);
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0);
    N.normalize();
    B.crossVectors(N, T).normalize();
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
      const o = (v0 + i * k + j) * 3;
      pos[o] = line[i * 3] + nx * r; pos[o + 1] = line[i * 3 + 1] + ny * r; pos[o + 2] = line[i * 3 + 2] + nz * r;
      nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
    }
  }
}

export class SkywaysAddonRuntime {
  /** The current world's turntable / ropes (null without a Skyways add-on / between worlds). */
  root: THREE.Group | null = null;
  ropes: Rope[] = [];
  private ropeMesh: THREE.Mesh | null = null;
  private readonly owned: {dispose(): void}[] = [];
  /** Counters (QA / tests). */
  readonly counts = {builds: 0, ropeWrites: 0, drops: 0, artLoaded: 0};
  private readonly line: number[] = [];
  /** Atlas material per loaded texture (released with the level by LevelResources). */
  private readonly artMats = new WeakMap<THREE.Texture, THREE.Material>();

  constructor(readonly host: SkywaysAddonHost) {}

  install(): this {
    const h = this.host;
    h.sectionPreloads?.push(layout => (layout.skyways ? Promise.race([this.preload(layout), new Promise<void>(r => setTimeout(r, SKYWAYS_ADDON_ART_WAIT_MS))]) : Promise.resolve()));
    h.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    h.frameHooks.push(() => this.frame());
    return this;
  }

  /** The atlases this layout's add-on panels show -> one material each (released with the level). Never rejects. */
  async preload(layout: StationLayout): Promise<void> {
    const atlases = skywaysAddonAtlases(new Set(layout.props.map(p => p.kind)));
    await Promise.all(atlases.map(async (atlas: SkywaysArtAtlasKey) => {
      const tex = await this.host.levelResources.load('skyways', SKYWAYS_ART[atlas].url, {srgb: true, repeat: false}).catch(() => null);
      if (!tex) { setSkywaysAddonArtMaterial(atlas, null); return; }
      // the same texture (a Retry of the level keeps its resources): the same material
      let m = this.artMats.get(tex);
      if (!m) {
        m = this.host.levelResources.own('skyways', new SurfaceNodeMaterial({map: tex, roughness: 0.78, metalness: 0}));
        m.name = `skyways-addon-art-${atlas}`;
        this.artMats.set(tex, m);
      }
      setSkywaysAddonArtMaterial(atlas, m);
      this.counts.artLoaded++;
    }));
  }

  build(layout: StationLayout): void {
    if (this.root) this.teardown();
    const car = layout.skyways?.addon.car;
    if (!car) return;
    const root = new THREE.Group();
    root.name = 'skyways-addon';
    // --- the turntable: a dark lacquered disc 2.5 cm high with a brushed rim stripe (render only) ---
    const discMat = new SurfaceNodeMaterial({color: 0x15171a, roughness: 0.32, metalness: 0.35});
    const rimMat = new SurfaceNodeMaterial({color: 0x9aa0a8, roughness: 0.38, metalness: 0.8});
    const disc = new THREE.CylinderGeometry(SKYWAYS_TURNTABLE_R, SKYWAYS_TURNTABLE_R + 0.02, 0.025, 72);
    disc.translate(0, 0.0125, 0);
    const rim = new THREE.RingGeometry(SKYWAYS_TURNTABLE_R - 0.16, SKYWAYS_TURNTABLE_R - 0.1, 72);
    rim.rotateX(-Math.PI / 2);
    rim.translate(0, 0.0255, 0);
    const discMesh = new THREE.Mesh(disc, discMat), rimMesh = new THREE.Mesh(rim, rimMat);
    for (const m of [discMesh, rimMesh]) { m.position.set(car.x, car.y, car.z); m.name = 'skyways-turntable'; m.userData.level = car.level; m.castShadow = false; m.receiveShadow = true; root.add(m); }
    this.owned.push(disc, rim, discMat, rimMat);
    // --- the ropes: one merged tube mesh ---
    this.ropes = planRopes(layout);
    if (this.ropes.length) {
      const per = (ROPE_TUBE.seg + 1) * ROPE_TUBE.sides, n = this.ropes.length;
      const pos = new Float32Array(n * per * 3), nrm = new Float32Array(n * per * 3), idx: number[] = [];
      for (let r = 0; r < n; r++) for (let i = 0; i < ROPE_TUBE.seg; i++) for (let j = 0; j < ROPE_TUBE.sides; j++) {
        const a = r * per + i * ROPE_TUBE.sides + j, b = r * per + i * ROPE_TUBE.sides + (j + 1) % ROPE_TUBE.sides, c = a + ROPE_TUBE.sides, d = b + ROPE_TUBE.sides;
        idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setIndex(idx);
      // fixed bounds: the ropes never leave the ring's neighbourhood (dropped ones lie where they fell)
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(car.x, car.y + 0.5, car.z), 9);
      const mat = new SurfaceNodeMaterial({color: 0x6a0d16, roughness: 0.9, metalness: 0});
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'skyways-velvet-ropes';
      mesh.userData.level = car.level;
      mesh.castShadow = false;
      root.add(mesh);
      this.ropeMesh = mesh;
      this.owned.push(geo, mat);
      this.writeRopes(true);
    }
    // static transforms (the rope mesh changes its geometry, never its transform)
    root.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    this.host.scene.add(root);
    root.updateMatrixWorld(true);
    this.root = root;
    this.counts.builds++;
    const culler = this.host.world?.culler as {register?(root: THREE.Object3D): void} | undefined;
    if (culler && typeof culler.register === 'function') culler.register(root);
  }

  teardown(): void {
    const r = this.root;
    this.root = null;
    this.ropeMesh = null;
    this.ropes = [];
    if (r) this.host.scene.remove(r);
    for (const o of this.owned.splice(0)) o.dispose();
  }

  /** A post's object -> world matrix: its loose body's pose, else its placement. */
  private readonly pose = (p: PropPlacement, out: THREE.Matrix4): THREE.Matrix4 => {
    if (this.host.physics?.dynamicItems.propMatrix?.(p, out)) return out;
    return out.compose(tp.set(p.x, p.y, p.z), tq.setFromAxisAngle(Y, p.rot), ONE);
  };

  /** Rewrites the ropes whose posts moved (all with `force`). */
  private writeRopes(force = false): void {
    const mesh = this.ropeMesh;
    if (!mesh) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute, nrm = mesh.geometry.attributes.normal as THREE.BufferAttribute;
    const per = (ROPE_TUBE.seg + 1) * ROPE_TUBE.sides;
    let changed = false;
    this.ropes.forEach((rope, r) => {
      if (rope.dropped && rope.last.length && !force) return; // lies where it fell
      const was = rope.dropped;
      const line = ropeLine(rope, this.pose, this.line);
      if (rope.dropped && !was) this.counts.drops++;
      if (!force && rope.last.length === line.length && rope.dropped === was && line.every((v, i) => Math.abs(v - rope.last[i]) < 1e-3)) return;
      rope.last = line.slice();
      writeTube(line, pos.array as Float32Array, nrm.array as Float32Array, r * per);
      changed = true;
    });
    if (changed) { pos.needsUpdate = true; nrm.needsUpdate = true; this.counts.ropeWrites++; }
  }

  frame(): void {
    if (this.ropeMesh) this.writeRopes(false);
  }
}

/** Installs the add-on runtime into a Game (one call in the Game constructor). */
export function installSkywaysAddon(host: SkywaysAddonHost): SkywaysAddonRuntime {
  return new SkywaysAddonRuntime(host).install();
}
