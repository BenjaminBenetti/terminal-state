// Task studio-alpha-track2-round2-20261031 (lane MOTION, R2 + R4 visuals). User: "sweage area has no animation on the water." and
// "ventaliation fan should spin". Presentation only, on the GAME clock (Game.time: menus / pause / loading freeze it):
//
//  R2 WATER: the annex water and foam of world/trackExt/machines.ts (sewage channels + the water under their grated crossings,
//  overflow basins, stepped spillway chutes, the falls / landing foam / scum) keep their geometry and place (grates, curbs, rails,
//  parapets, collision and paths untouched) but draw with two animated node materials (one water, one foam) shared by every annex
//  of a level. Each vertex carries its FLOW (`flow` attribute: world direction + speed m/s; uv.x = turbulence 0..1) written by the
//  machinery builder: channels flow from their sluice gate toward their culvert (0.16-0.28 m/s, seeded), chute steps run toward
//  the low end (0.9 m/s), falls pour down (1.2-1.6 m/s), an overflow basin drifts slowly (0.03 m/s) and is stirred near its
//  inlet pour. The fragment shader works in world metres along / across the flow (coherent over quads, segments and steps):
//  two advected value-noise layers (streaks elongated along the flow, a finer chop; surfaces/surfaceNodes.ts wmNoise) slowly
//  morphing, plus two travelling ripple trains -> a height field whose screen-space slope bumps the normal (damage/tsl.ts
//  dmgPerturb), the albedo (scum / foam streaks) and the roughness. Glossy water + a moving bumped normal = moving glints under the
//  flashlight in the dark. No water physics, damage, swimming or gas; nothing changes height. flowHeightCpu mirrors the height
//  field (tests). Cost: 2 value-noise + 2 sin per water / foam fragment, no textures, no extra draws (still one water + one foam
//  mesh per annex).
//
//  R4 FANS: the wall fans' (fanWall) blades are no longer baked into the static machinery; ONE InstancedMesh per level holds one
//  instance per blade (same pitched-box blade as before: root 0.18 R, tip 0.98 R, 0.22 R wide, pitched 0.45 rad), drawn with one
//  plain steel material (no world mapping: a world-mapped texture would stay still while the blade turns). The hub, motor, shroud,
//  guard and supports stay in the static merged meshes (the hub is a plain cylinder: turning it would look identical). Each blade's
//  matrix = fan frame (hub centre on the blade plane, yaw) x Rz(angle + 2 pi k / n) x uniform scale R, about the fan's own hub axis
//  (local +Z = out of the wall into the room). Speed 1.6-2.6 rev/s, seeded per fan with its seeded start phase; the visible step per
//  update is capped at 0.42 of the blade spacing so a slow frame never strobes the rotor backwards (wagon-wheel). Blades are visual
//  only, inside the fan's collision box (gen/annexRooms.ts machineBoxes: the whole footprint); no collider follows them.
//  Inline fan units (fanUnit) keep no rotor: their casing and capped inlet bell show no blades (sound only, lane AUDIO).
//
// Materials and the time uniform are made once per WorldMaterials (like every machinery material) and reused by every level:
// a level rebuild adds no material, program or uniform. Per build: the rotor InstancedMesh + its blade geometry and the merged
// geometries (MachineBuild.dispose releases them). All are in the station group at build time: the loading-screen warm-up compiles
// them (docs/rendering-warmup.md).

import * as THREE from 'three';
import {MeshStandardNodeMaterial} from 'three/webgpu';
import {
  attribute, cross, dot, float, materialColor, materialRoughness, min, mix, modelWorldMatrix, normalize, normalView, normalWorldGeometry,
  positionView, positionWorld, sin, smoothstep, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import type {AnnexMachine} from '../../gen/annexRooms';
import {dmgPerturb, type TNode} from '../../damage/tsl';
import {skipInShadowPass, wmNoise, wmNoiseCpu} from '../surfaceNodes';
import type {WorldMaterials} from '../materials';
import {Acc, hashOf, prng} from './mesh';

/** Flow speeds (m/s), turbulence (0..1) and the wall-fan rotor (rev/s, blade, anti-strobe cap). */
export const MOTION = {
  channel: {speed: [0.16, 0.28] as const, turb: 0.55, scumTurb: 0.3},
  chute: {speed: 0.9, turb: 0.95},
  basin: {drift: 0.03, turb: [0.25, 1] as const, stirR: 2.5, grid: 1.0, scumTurb: 0.2},
  fall: {inlet: 1.6, chute: 1.5, weir: 1.2},
  landing: {basin: 0.3},
  rotor: {
    rps: [1.6, 2.6] as const,
    /** Largest visible step per update, as a fraction of the blade spacing (< 0.5: never reads as turning backwards). */
    maxStep: 0.42,
    /** Blade in units of the fan radius R: centre 0.58, half length 0.40 (root 0.18, tip 0.98), half width 0.11, half thickness 0.012, pitch (rad). */
    blade: {at: 0.58, hl: 0.4, hw: 0.11, ht: 0.012, pitch: 0.45},
    /** Fan frame: hub height = lift + R; blade plane local z = -d / 2 + plane (the fan's motor / hub sit at -d / 2 + 0.25 .. 0.47). */
    lift: 0.3, plane: 0.38,
  },
} as const;

/**
 * Height-field constants (shared by the TSL graph and flowHeightCpu): noise scales along / across the flow, morph rate
 * (base + per m/s), amplitudes (m) per material, two ripple trains (k along, k across, omega).
 */
const HF = {
  n1: [1.3, 4.2] as const, n2: [2.6, 7.0] as const, morph: [0.12, 0.35] as const, n2z: [1.7, 5.3] as const,
  amp: {water: [0.02, 0.008, 0.008] as const, foam: [0.032, 0.013, 0.01] as const},
  waves: [[7.3, 2.9, 1.9], [-3.1, 6.7, 2.6]] as const,
};

export type FlowKind = 'water' | 'foam';

// ---------------------------------------------------------------------------------------------------------------------------------
// Geometry: an Acc whose vertices also carry the current flow

/** Flow state written on every vertex of a FlowAcc: world direction (unit), speed (m/s), turbulence 0..1. */
export interface FlowState { dx: number; dy: number; dz: number; speed: number; turb: number }

/** Triangle accumulator for water / foam: + a `flow` vec4 (dir, speed) per vertex and uv = (turbulence, 0). */
export class FlowAcc extends Acc {
  readonly flow: number[] = [];
  constructor(readonly state: FlowState) { super(); }
  override v(p: readonly number[], n: readonly number[], _u: number, _w: number, c?: readonly number[]): number {
    const s = this.state;
    this.flow.push(s.dx, s.dy, s.dz, s.speed);
    return super.v(p, n, s.turb, 0, c);
  }
  override geometry(): THREE.BufferGeometry | null {
    const g = super.geometry();
    if (g) g.setAttribute('flow', new THREE.Float32BufferAttribute(this.flow, 4));
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Materials (one set per WorldMaterials) and the game-clock uniform

interface MotionSet { time: TNode; flow: Partial<Record<FlowKind, THREE.Material>>; rotor?: THREE.Material }
const sets = new WeakMap<WorldMaterials, MotionSet>();
function setOf(mats: WorldMaterials): MotionSet {
  let s = sets.get(mats);
  if (!s) {
    const time = uniform(0);
    time.setName('annexMotionTime');
    sets.set(mats, (s = {time, flow: {}}));
  }
  return s;
}

/** The game-clock uniform (s) of the animated machinery materials of `mats` (one per WorldMaterials; MachineBuild.update sets it). */
export function motionClock(mats: WorldMaterials): {value: number} {
  return setOf(mats).time as unknown as {value: number};
}

/** The flow height field (and its two noise layers) of a fragment: TSL graph over the flow varyings and the clock. */
function flowField(time: TNode, kind: FlowKind): {h: TNode; n1: TNode; n2: TNode} {
  const flow: TNode = attribute('flow', 'vec4');
  const dir: TNode = varying(flow.xyz.transformDirection(modelWorldMatrix), 'vFlowDir');
  const speed: TNode = varying(flow.w, 'vFlowSpeed');
  const turb: TNode = varying(uv().x, 'vFlowTurb');
  const N: TNode = normalWorldGeometry;
  const D: TNode = normalize(dir);
  // in-plane flow axis (falls: down the face); N.yzx keeps the axis defined where the flow is along the normal (scum box ends)
  const T: TNode = normalize(D.sub(N.mul(dot(D, N))).add(N.yzx.mul(1e-3)));
  const B: TNode = cross(N, T);
  const p: TNode = positionWorld;
  const s: TNode = dot(p, T), q: TNode = dot(p, B);
  const a: TNode = s.sub(speed.mul(time)); // advected: the pattern travels downstream at the flow speed
  const tz: TNode = time.mul(speed.mul(HF.morph[1]).add(HF.morph[0]));
  const n1: TNode = wmNoise(vec3(a.mul(HF.n1[0]), q.mul(HF.n1[1]), tz) as never);
  const n2: TNode = wmNoise(vec3(a.mul(HF.n2[0]), q.mul(HF.n2[1]), tz.mul(HF.n2z[0]).add(HF.n2z[1])) as never);
  const [w1, w2] = HF.waves;
  const waves: TNode = sin(s.mul(w1[0]).add(q.mul(w1[1])).sub(time.mul(w1[2]))).add(sin(s.mul(w2[0]).add(q.mul(w2[1])).sub(time.mul(w2[2])))).mul(0.5);
  const A = HF.amp[kind];
  const h: TNode = turb.mul(n1.sub(0.5).mul(A[0]).add(n2.sub(0.5).mul(A[1])).add(waves.mul(A[2])));
  return {h, n1, n2};
}

/** Base look of the two flow materials (colour / roughness / metalness as the old static machinery values). */
export interface FlowLook { color?: number; rough?: number; metal?: number }

/** The animated water or foam material of `mats` (made once; every annex and level shares it). */
export function flowMaterial(mats: WorldMaterials, kind: FlowKind, look: FlowLook): THREE.Material {
  const set = setOf(mats);
  const have = set.flow[kind];
  if (have) return have;
  const m = new MeshStandardNodeMaterial({color: look.color ?? 0xffffff, roughness: look.rough ?? 0.5, metalness: look.metal ?? 0});
  m.name = `annex-machine-${kind}-flow`;
  const {h, n1, n2} = flowField(set.time, kind);
  const base: TNode = materialColor;
  if (kind === 'water') {
    // dark water, faint streaks along the flow, greenish-grey scum flecks drifting with it (rougher where the scum is)
    const scum: TNode = smoothstep(0.66, 0.86, n1.mul(0.6).add(n2.mul(0.4))).mul(0.45);
    const albedo: TNode = mix(base.mul(n1.mul(0.44).add(0.78)), vec3(0.16, 0.19, 0.15), scum);
    m.colorNode = skipInShadowPass(vec4(albedo, 1), vec4(base, 1), 'vec4') as never;
    m.roughnessNode = mix(float(materialRoughness), float(0.45), scum) as never;
  } else {
    // white water: streaks travelling with the flow (down the falls), rougher in the troughs
    const foam: TNode = n1.mul(0.65).add(n2.mul(0.35));
    m.colorNode = skipInShadowPass(vec4(base.mul(foam.mul(0.7).add(0.5)), 1), vec4(base, 1), 'vec4') as never;
    m.roughnessNode = min(float(materialRoughness).add(n1.oneMinus().mul(0.4)), 1) as never;
  }
  m.normalNode = dmgPerturb(positionView, normalView, vec2(h.dFdx(), h.dFdy()));
  m.userData.motion = {kind, clock: 'game'};
  set.flow[kind] = m;
  return m;
}

/** The fan rotor material of `mats` (plain galvanised steel like the old blades, no world mapping; made once). */
export function rotorMaterial(mats: WorldMaterials): THREE.Material {
  const set = setOf(mats);
  if (!set.rotor) {
    const m = new MeshStandardNodeMaterial({color: 0xb4b8ba, roughness: 0.55, metalness: 0.55});
    m.name = 'annex-fan-rotor';
    m.userData.motion = {kind: 'rotor', clock: 'game'};
    set.rotor = m;
  }
  return set.rotor;
}

/**
 * CPU mirror of the shader's flow height field (tests / previews): world point `p`, world surface normal `n`, world flow
 * direction `dir`, speed (m/s), turbulence, game time `t` (s). Returns the height (m) and the two noise layers.
 */
export function flowHeightCpu(kind: FlowKind, p: readonly number[], n: readonly number[], dir: readonly number[], speed: number, turb: number, t: number): {h: number; n1: number; n2: number} {
  const nl = Math.hypot(n[0], n[1], n[2]) || 1, N = [n[0] / nl, n[1] / nl, n[2] / nl];
  const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1, D = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  const dn = D[0] * N[0] + D[1] * N[1] + D[2] * N[2];
  const T0 = [D[0] - N[0] * dn + N[1] * 1e-3, D[1] - N[1] * dn + N[2] * 1e-3, D[2] - N[2] * dn + N[0] * 1e-3];
  const tl = Math.hypot(T0[0], T0[1], T0[2]) || 1, T = [T0[0] / tl, T0[1] / tl, T0[2] / tl];
  const B = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]];
  const s = p[0] * T[0] + p[1] * T[1] + p[2] * T[2], q = p[0] * B[0] + p[1] * B[1] + p[2] * B[2];
  const a = s - speed * t, tz = t * (speed * HF.morph[1] + HF.morph[0]);
  const n1 = wmNoiseCpu(a * HF.n1[0], q * HF.n1[1], tz), n2 = wmNoiseCpu(a * HF.n2[0], q * HF.n2[1], tz * HF.n2z[0] + HF.n2z[1]);
  const [w1, w2] = HF.waves;
  const waves = (Math.sin(s * w1[0] + q * w1[1] - t * w1[2]) + Math.sin(s * w2[0] + q * w2[1] - t * w2[2])) * 0.5;
  const A = HF.amp[kind];
  return {h: turb * ((n1 - 0.5) * A[0] + (n2 - 0.5) * A[1] + waves * A[2]), n1, n2};
}

// ---------------------------------------------------------------------------------------------------------------------------------
// R4: wall-fan rotors

/** A wall fan's rotor: hub centre on the blade plane (world), hub axis (world unit: local +Z, out of the wall), size and motion. */
export interface RotorSpec {
  hub: [number, number, number];
  axis: [number, number, number];
  /** Record yaw (rad) and floor (world y). */
  rot: number; floorY: number;
  /** Fan radius (m), blade count, start phase (rad) and speed (rev/s). */
  R: number; blades: number; phase: number; rps: number;
  seed: number;
}

/**
 * The rotor of a fanWall record (pure): diameter p[0] (default 1.6 m), hub height 0.30 + R above the floor, blade plane at local
 * z = -d / 2 + 0.38, hub axis local +Z (the record's front, (sin rot, 0, cos rot)). Blade count / start phase: the same seeded draws
 * the static fan used (5-7 blades); speed: its own seeded draw in MOTION.rotor.rps.
 */
export function wallFanRotor(m: AnnexMachine): RotorSpec {
  const R = (m.p?.[0] ?? 1.6) / 2, c = Math.cos(m.rot), s = Math.sin(m.rot), F = MOTION.rotor;
  const ly = F.lift + R, lz = -m.d / 2 + F.plane;
  const r = prng(m.seed), blades = 5 + Math.floor(r() * 3), phase = r() * Math.PI;
  const v = prng(hashOf('fan-rotor', m.seed))();
  return {
    hub: [m.x + lz * s, m.y + ly, m.z + lz * c], axis: [s, 0, c], rot: m.rot, floorY: m.y,
    R, blades, phase, rps: F.rps[0] + v * (F.rps[1] - F.rps[0]), seed: m.seed,
  };
}

/** The unit-radius blade (rotor frame: hub at the origin, axis +Z, blade along +X, pitched about its long axis): 12 triangles. */
export function bladeGeometry(): THREE.BufferGeometry {
  const B = MOTION.rotor.blade, ct = Math.cos(B.pitch), st = Math.sin(B.pitch), a = new Acc();
  a.box([B.at, 0, 0], [B.hl, B.hw, B.ht], [1, 0, 0], [0, ct, st], [0, -st, ct]);
  return a.geometry()!;
}

const TAU = Math.PI * 2;

/**
 * Every wall-fan rotor of a level in ONE InstancedMesh (one instance per blade). update(t) turns each rotor by its speed over
 * the game-time step since the last update (capped per update: MOTION.rotor.maxStep x blade spacing), so a repeated t (pause)
 * leaves it still. Visual only.
 */
export class RotorSet {
  readonly mesh: THREE.InstancedMesh;
  readonly blades: number;
  private readonly base: THREE.Matrix4[];
  private readonly angle: number[];
  private last: number | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly o = new THREE.Matrix4();
  private readonly sc = new THREE.Vector3();

  constructor(readonly specs: readonly RotorSpec[], material: THREE.Material) {
    this.blades = specs.reduce((n, f) => n + f.blades, 0);
    this.mesh = new THREE.InstancedMesh(bladeGeometry(), material, this.blades);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.base = specs.map(f => new THREE.Matrix4().makeRotationY(f.rot).setPosition(f.hub[0], f.hub[1], f.hub[2]));
    this.angle = specs.map(f => f.phase);
    this.write();
    // bound: every fan disc (blades never leave it), so the frustum test holds at any angle
    const box = new THREE.Box3();
    for (const f of specs) box.union(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...f.hub), new THREE.Vector3(2 * f.R, 2 * f.R, 2 * f.R)));
    this.mesh.boundingBox = box;
    this.mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  }

  /** Current angle (rad, [0, 2 pi)) of rotor i. */
  angleOf(i: number): number { return this.angle[i]; }

  /** Advance to game time `t` (s). */
  update(t: number): void {
    const dt = this.last === null ? 0 : t - this.last;
    this.last = t;
    if (!(dt > 0)) return;
    for (let i = 0; i < this.specs.length; i++) {
      const f = this.specs[i], step = Math.min(TAU * f.rps * dt, MOTION.rotor.maxStep * TAU / f.blades);
      this.angle[i] = (this.angle[i] + step) % TAU;
    }
    this.write();
  }

  private write(): void {
    let k = 0;
    for (let i = 0; i < this.specs.length; i++) {
      const f = this.specs[i];
      this.sc.set(f.R, f.R, f.R);
      for (let b = 0; b < f.blades; b++) {
        this.m.makeRotationZ(this.angle[i] + (b / f.blades) * TAU).scale(this.sc);
        this.mesh.setMatrixAt(k++, this.o.multiplyMatrices(this.base[i], this.m));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
