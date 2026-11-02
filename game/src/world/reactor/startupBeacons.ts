// Task reactor-playtest-round2-20261102 (lane STARTUP): THE ORANGE ROTATING BEACONS in the world — user: "spinning orange lights as the
// building comes to life!". Placement: world/reactor/startupBeaconPlan.ts (mounted on the pit walls on brackets, never floating).
//
// Bounded CPU submit (the Reactor's render-object budget, docs/reactor.md "CPU submission"):
//  - THREE InstancedMeshes for every beacon of the level (one draw each, one shared material each, built once per world): the BODY
//    (wall plate + arm + brace + pedestal + collar, the kit's painted steel look), the rotating DOME (an unlit orange lens whose hot spot
//    turns with the instance: the reflector) and the FLARE (an additive cone sweeping out of the dome: the beam seen in the air);
//  - per frame, only while a beacon is powered: 2 matrices per beacon (dome + flare turn about the head's vertical axis) — at most
//    BEACONS.perStorey x storeys (24) — and the instance colours only when a power moved;
//  - REAL moving light: BEACON_LIGHTS.count SpotLights created ONCE at install (boot: the light set never changes, intensity only —
//    docs/rendering-warmup.md), assigned every BEACON_LIGHTS.assignS to the powered beacons nearest the eye and swept with their head.
// No per-beacon material, no per-beacon object, no shader uniform array.

import * as THREE from 'three';
import {MeshBasicNodeMaterial, MeshStandardNodeMaterial} from 'three/webgpu';
import {abs, dot, float, max, normalize, positionGeometry, positionView, pow, normalView, vec2, vec3} from 'three/tsl';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BEACONS, type BeaconSpot} from './startupBeaconPlan';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

/** The beacons' look (linear colours; QA tunable through __LL.reactorStartup({beacon: {...}})). */
export const BEACON_LOOK = {
  /** Lens colour (linear orange), its glow unpowered / powered, the hot spot gain (the turning reflector). */
  color: [1, 0.36, 0.04] as readonly [number, number, number],
  off: 0.05, on: 1.5, hot: 3.2,
  /** The sweeping flare cone: length / end radius (m), gain. */
  flareLen: 2.4, flareR: 0.6, flare: 0.55,
} as const;

/** The real rotating lights (created once at boot; intensity-only changes). */
export const BEACON_LIGHTS = {
  count: 3, color: 0xff7a1c, candela: 150, distance: 16, angle: 0.34, penumbra: 0.45, decay: 1.6,
  /** Powered beacons within `reach` m of the eye take the lights (nearest first), re-assigned every assignS; a light fades in over
   *  fadeS after it moves to another beacon. The beam dips by `drop` (rise over run) below the horizontal. */
  reach: 32, assignS: 0.25, fadeS: 0.3, drop: 0.12,
} as const;

let bodyMat: MeshStandardNodeMaterial | null = null, domeMat: MeshBasicNodeMaterial | null = null, flareMat: MeshBasicNodeMaterial | null = null;

/** Painted steel (safety yellow, worn): one material for every beacon body. */
function beaconBodyMaterial(): MeshStandardNodeMaterial {
  return (bodyMat ??= new MeshStandardNodeMaterial({name: 'reactor-beacon-body', color: new THREE.Color(0.32, 0.22, 0.03), roughness: 0.62, metalness: 0.35}));
}

/** The lens: unlit orange x the instance colour (power), brightest where the turning reflector faces (local +X). */
function beaconDomeMaterial(): MeshBasicNodeMaterial {
  if (domeMat) return domeMat;
  const m = new MeshBasicNodeMaterial({name: 'reactor-beacon-dome'});
  const dir = n(normalize(n(vec2(positionGeometry.x, positionGeometry.z)).add(vec2(1e-4, 0))));
  const hot = n(pow(max(n(dir).x, 0), 6));
  m.colorNode = n(vec3(1, 1, 1)).mul(n(float(0.55)).add(n(hot).mul(BEACON_LOOK.hot))); // x instance colour (NodeMaterial.setupDiffuseColor)
  return (domeMat = m);
}

/** The sweeping flare: additive, fading along the cone (local +X) and toward its silhouette. */
function beaconFlareMaterial(): MeshBasicNodeMaterial {
  if (flareMat) return flareMat;
  const m = new MeshBasicNodeMaterial({name: 'reactor-beacon-flare', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false});
  const along = n(float(1).sub(n(positionGeometry.x).div(BEACON_LOOK.flareLen)).clamp(0, 1));
  const facing = n(abs(dot(normalView, normalize(n(positionView).negate()))));
  m.colorNode = n(vec3(1, 1, 1)).mul(n(along).mul(along).mul(n(pow(facing, 1.5))).mul(BEACON_LOOK.flare));
  return (flareMat = m);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** The body in the beacon's local frame (origin on the wall face at the pedestal top, +Z out of the wall, +Y up). */
export function beaconBodyGeometry(): THREE.BufferGeometry {
  const B = BEACONS, p = B.plate, out = B.out;
  const parts = [
    box(p.w, p.h, p.d, 0, p.y, p.d / 2), // wall plate, bolted to the face
    box(B.arm.w, B.arm.h, out - p.d + 0.02, 0, -B.pedestal.h - B.arm.h / 2, p.d + (out - p.d + 0.02) / 2), // arm out under the pedestal
    new THREE.CylinderGeometry(B.pedestal.r, B.pedestal.r, B.pedestal.h, 16).translate(0, -B.pedestal.h / 2, out), // pedestal (top = 0)
    new THREE.CylinderGeometry(B.head.r + 0.012, B.head.r + 0.012, B.head.collar, 16).translate(0, B.head.collar / 2, out), // collar
  ];
  // the diagonal brace: from low on the plate (inside its height) up to the underside of the arm's end
  const yb = -B.pedestal.h - B.arm.h, z0 = p.d, z1 = out - 0.04, drop = 0.14;
  const brace = new THREE.BoxGeometry(B.brace.w, B.brace.w, Math.hypot(z1 - z0, drop));
  brace.rotateX(-Math.atan2(drop, z1 - z0)).translate(0, yb - drop / 2, (z0 + z1) / 2);
  parts.push(brace);
  const g = mergeGeometries(parts.map(q => q.index ? q.toNonIndexed() : q), false)!;
  for (const q of parts) q.dispose();
  g.computeBoundingSphere();
  return g;
}

/** The lens (cylinder + domed cap) around the head's axis, in the head frame (origin = the head centre). */
export function beaconDomeGeometry(): THREE.BufferGeometry {
  const H = BEACONS.head, base = -H.h / 2 + H.collar, cyl = H.h - H.collar - H.r;
  const parts = [
    new THREE.CylinderGeometry(H.r, H.r, cyl, 20, 1, true).translate(0, base + cyl / 2, 0),
    new THREE.SphereGeometry(H.r, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, base + cyl, 0),
  ];
  const g = mergeGeometries(parts.map(q => q.index ? q.toNonIndexed() : q), false)!;
  for (const q of parts) q.dispose();
  return g;
}

/** The flare cone: from the head centre out along +X. */
export function beaconFlareGeometry(): THREE.BufferGeometry {
  const L = BEACON_LOOK.flareLen;
  return new THREE.CylinderGeometry(BEACON_LOOK.flareR, 0.05, L, 14, 1, true).rotateZ(-Math.PI / 2).translate(L / 2, 0, 0); // narrow end at the head
}

export interface BeaconStats { beacons: number; meshes: number; lit: number }

/** The built beacons of one Reactor world (one group, three InstancedMeshes). */
export class BeaconVisuals {
  readonly group = new THREE.Group();
  readonly body: THREE.InstancedMesh;
  readonly dome: THREE.InstancedMesh;
  readonly flare: THREE.InstancedMesh;
  /** Per beacon: power 0..1 (as last shown) and the reflector angle (rad). */
  readonly power: Float32Array;
  readonly angle: Float32Array;
  private readonly geos: THREE.BufferGeometry[];
  private readonly m = new THREE.Matrix4();
  private readonly r = new THREE.Matrix4();
  private readonly col = new THREE.Color();
  private moving = false;

  constructor(readonly spots: readonly BeaconSpot[]) {
    const N = spots.length;
    this.group.name = 'reactor-beacons';
    this.power = new Float32Array(N);
    this.angle = Float32Array.from(spots, s => s.phase);
    const bg = beaconBodyGeometry(), dg = beaconDomeGeometry(), fg = beaconFlareGeometry();
    this.geos = [bg, dg, fg];
    this.body = new THREE.InstancedMesh(bg, beaconBodyMaterial(), N);
    this.dome = new THREE.InstancedMesh(dg, beaconDomeMaterial(), N);
    this.flare = new THREE.InstancedMesh(fg, beaconFlareMaterial(), N);
    this.body.name = 'reactor-beacon-body'; this.dome.name = 'reactor-beacon-dome'; this.flare.name = 'reactor-beacon-flare';
    const levels = [...new Set(spots.flatMap(s => [s.tier, s.level]))];
    spots.forEach((s, i) => {
      const yaw = Math.atan2(s.nx, s.nz); // local +Z -> the wall normal
      this.body.setMatrixAt(i, this.m.makeRotationY(yaw).setPosition(s.x, s.y, s.z));
    });
    for (const im of [this.body, this.dome, this.flare]) {
      im.userData.levels = levels;
      im.castShadow = false;
      im.receiveShadow = im === this.body;
      im.matrixAutoUpdate = false;
      im.updateMatrix();
      this.group.add(im);
    }
    this.dome.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flare.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.writeHeads();
    for (let i = 0; i < N; i++) this.paint(i, 0);
    for (const im of [this.body, this.dome, this.flare]) { im.computeBoundingBox(); im.computeBoundingSphere(); }
  }

  /** Dome + flare matrices: the head centre, turned by the reflector angle about the vertical. */
  private writeHeads(): void {
    const S = this.spots;
    for (let i = 0; i < S.length; i++) {
      const h = S[i].head;
      this.r.makeRotationY(this.angle[i]).setPosition(h.x, h.y, h.z);
      this.dome.setMatrixAt(i, this.r);
      this.flare.setMatrixAt(i, this.r);
    }
    this.dome.instanceMatrix.needsUpdate = true;
    this.flare.instanceMatrix.needsUpdate = true;
  }

  private paint(i: number, k: number): void {
    const L = BEACON_LOOK, g = L.off + (L.on - L.off) * k;
    this.dome.setColorAt(i, this.col.setRGB(L.color[0] * g, L.color[1] * g, L.color[2] * g));
    this.flare.setColorAt(i, this.col.setRGB(L.color[0] * k, L.color[1] * k, L.color[2] * k));
  }

  /**
   * Per frame: each beacon's power (0..1) from `powerOf(i)`; the powered ones turn (BEACON rev / s x power). Allocation-free; no
   * matrix writes while every beacon is dark and still. Returns the number of turning beacons.
   */
  update(dt: number, powerOf: (i: number) => number, revPerS: number): number {
    const N = this.spots.length;
    let turning = 0, recolour = false;
    for (let i = 0; i < N; i++) {
      const k = Math.max(0, Math.min(1, powerOf(i)));
      if (Math.abs(k - this.power[i]) > 0.004 || (k !== this.power[i] && (k === 0 || k === 1))) { this.power[i] = k; this.paint(i, k); recolour = true; }
      if (k > 0) { this.angle[i] = (this.angle[i] + dt * revPerS * Math.PI * 2 * k) % (Math.PI * 2); turning++; }
    }
    if (recolour) {
      if (this.dome.instanceColor) this.dome.instanceColor.needsUpdate = true;
      if (this.flare.instanceColor) this.flare.instanceColor.needsUpdate = true;
    }
    if (turning || this.moving) this.writeHeads();
    this.moving = turning > 0;
    return turning;
  }

  /** The world direction the beacon's reflector faces now (unit, horizontal). */
  facing(i: number, out: THREE.Vector3): THREE.Vector3 {
    const a = this.angle[i];
    return out.set(Math.cos(a), 0, -Math.sin(a));
  }

  stats(): BeaconStats {
    return {beacons: this.spots.length, meshes: 3, lit: [...this.power].filter(k => k > 0).length};
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const im of [this.body, this.dome, this.flare]) im.dispose();
  }
}

/** The real rotating lights: BEACON_LIGHTS.count SpotLights, created once (boot), swept with the nearest powered beacons. */
export class BeaconLights {
  readonly lights: THREE.SpotLight[] = [];
  /** Beacon index each light follows (-1 none) and its fade-in 0..1. */
  readonly assigned: Int32Array;
  readonly fade: Float32Array;
  private assignT = 0;
  private readonly d = new THREE.Vector3();
  private readonly order: number[] = [];

  constructor() {
    const L = BEACON_LIGHTS;
    for (let i = 0; i < L.count; i++) {
      const s = new THREE.SpotLight(L.color, 0, L.distance, L.angle, L.penumbra, L.decay);
      s.name = `reactor-beacon-light-${i}`;
      s.castShadow = false;
      s.position.set(0, -1000, 0);
      s.target.name = `reactor-beacon-light-${i}-target`;
      s.target.position.set(0, -1001, 0);
      this.lights.push(s);
    }
    this.assigned = new Int32Array(L.count).fill(-1);
    this.fade = new Float32Array(L.count);
  }

  /** Add the lights + targets to the scene (once, at boot: the light set never changes). */
  addTo(scene: THREE.Object3D): void {
    for (const s of this.lights) { scene.add(s); scene.add(s.target); }
  }

  /** Every light dark (another level / no beacons). */
  off(): void {
    for (const s of this.lights) s.intensity = 0;
    this.assigned.fill(-1);
    this.fade.fill(0);
  }

  /**
   * Per frame: (re)assign the lights to the powered beacons nearest the eye (within reach) every assignS, then sweep each with its
   * beacon's reflector; intensity = candela x power x fade-in. Returns the number of lit lights.
   */
  update(dt: number, v: BeaconVisuals | null, eye: {x: number; y: number; z: number}, gain = 1): number {
    const L = BEACON_LIGHTS, ls = this.lights;
    if (!v) { if (ls.some(s => s.intensity > 0)) this.off(); return 0; }
    this.assignT -= dt;
    if (this.assignT <= 0) {
      this.assignT = L.assignS;
      const S = v.spots, o = this.order;
      o.length = 0;
      for (let i = 0; i < S.length; i++) if (v.power[i] > 0.02 && Math.hypot(S[i].head.x - eye.x, S[i].head.y - eye.y, S[i].head.z - eye.z) <= L.reach) o.push(i);
      const dist = (i: number) => Math.hypot(S[i].head.x - eye.x, S[i].head.y - eye.y, S[i].head.z - eye.z);
      o.sort((a, b) => dist(a) - dist(b));
      const want = o.slice(0, ls.length);
      // keep a light on a beacon still wanted (no pop), hand the free ones to the new beacons
      for (let k = 0; k < ls.length; k++) if (this.assigned[k] >= 0 && !want.includes(this.assigned[k])) { this.assigned[k] = -1; this.fade[k] = 0; }
      for (const b of want) {
        if (this.assigned.includes(b)) continue;
        const k = this.assigned.indexOf(-1);
        if (k < 0) break;
        this.assigned[k] = b; this.fade[k] = 0;
      }
    }
    let lit = 0;
    for (let k = 0; k < ls.length; k++) {
      const s = ls[k], b = this.assigned[k];
      if (b < 0) { s.intensity = 0; continue; }
      this.fade[k] = Math.min(1, this.fade[k] + dt / L.fadeS);
      const h = v.spots[b].head;
      v.facing(b, this.d);
      s.position.set(h.x, h.y, h.z);
      s.target.position.set(h.x + this.d.x * 6, h.y - L.drop * 6, h.z + this.d.z * 6);
      s.updateMatrixWorld();
      s.target.updateMatrixWorld();
      s.intensity = L.candela * v.power[b] * this.fade[k] * gain;
      if (s.intensity > 0) lit++;
    }
    return lit;
  }
}
