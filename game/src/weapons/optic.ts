// Iteration 04 (Lane E): see-through rifle optic for the first-person viewmodel.
//
// rifle-optic.glb (derivatives/rifle-optic-iteration04.json) has the AI scope's opaque lens caps cut out and an
// authored hollow tube, retaining rings and front/rear glass on a bore-parallel axis, plus an `OpticRear` anchor at
// the rear glass centre. In the viewmodel the rear glass becomes the lens:
//  - a depth-only mask drawn first (1 mm behind the glass) stops the gun's own interior/front geometry from drawing
//    inside the eyepiece, so the already-rendered world pass shows through the whole eyepiece (a 1x optic image,
//    not a tunnel view and not a crosshair over an opaque block);
//  - the glass shader adds the coating tint/sheen, an eyepiece edge shadow, an eye-box "exit pupil" (dark lens when
//    the eye is off the axis, e.g. at the hip) and a collimated reticle (red dot + fine duplex) drawn at a fixed
//    angular size along the aim direction, so it sits exactly at screen centre (= the hitscan line) when sighted.

//
// Iteration 13 (CORE): the lens is a TSL node material (MeshBasicNodeMaterial) — the same math as the iteration-04 GLSL,
// compiled by WebGPURenderer to WGSL (WebGPU) or GLSL (its WebGL 2 backend). `lens.uniforms.<name>.value` stays the API.
// Limitation: the renderer tone-maps in its output pass over the whole frame, so `toneMapped = false` no longer exempts
// the reticle from ACES (the red dot reads a little deeper than the old untone-mapped GLSL).
//
// Iteration 15 (user: "the assault rifle the scope doesn't work anymore after we replaced the model ... I want the scope
// to work just like it worked in the original where you could see through it and have the dot"): the user's red-dot
// rifle (rifle-user.glb, ONE opaque mesh: the sight is a solid capped cylinder) gets the same optic at runtime — no asset
// change. `OpticSpec.aperture` (measured from the derivative: tests/optic.test.ts re-measures it) places a glass disk
// just eye-side of the sight's rear cap, on its axis; the depth mask behind it hides the cap / body inside the aperture
// (the viewmodel overlay stays transparent there, so the station shows through) and the lens draws the coated glass,
// fine duplex and the red dot, exactly as the iteration-04 optic. The rim of the housing stays around it. It only
// attaches when the model's `Sight` marker sits on that axis (the original rifle.glb keeps its legacy ADS,
// rifle-optic.glb its authored glass). The lens / mask live in the viewmodel scene under the rifle's holder, so the
// warm-up's viewmodel pass (render/warmup.ts) compiles them before the first ADS.

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {abs, dot, exp, float, fwidth, length, max, mix, normalize, positionView, smoothstep as tslSmoothstep, uniform, uv, vec2, vec3, vec4} from 'three/tsl';

export interface OpticSpec {
  /** Eye distance (m) behind the rear glass (OpticRear) at full ADS; the eye sits on the optic axis. */
  eyeRelief: number;
  /**
   * Iteration 15: for a model WITHOUT an authored see-through optic (no OpticGlassRear / OpticRear): a runtime rear
   * aperture — a glass disk of `radius` (m) at model-space (x, y, z), facing +Z (the eye), on a bore-parallel axis.
   */
  aperture?: {x: number; y: number; z: number; radius: number};
  /**
   * Task studio-weapon-variety-production-20261109-224355-01 (lane GUNS): a SCOPED gun whose model has no authored glass
   * (the Meshy-cooked Overwatch DMR): the runtime aperture is centred on the model's `Sight` marker — the scope's rear lens
   * centre on its axis — and sits just eye-side (APERTURE_GAP) of the scope's rear-most surface around that axis, measured
   * from the geometry within `radius` x 1.6 of the axis and ±SIGHT_APERTURE_DEPTH m of the marker (the marker's own z
   * without geometry). The main camera's narrow `aimFov` is the magnification the lens shows; the reticle is the optic's.
   */
  sightAperture?: {radius: number};
}

/** Lane GUNS: gap (m) between a scope's rear surface and the runtime glass (as the user rifle's 2.2 mm). */
export const APERTURE_GAP = 0.0022;
/** Lane GUNS: how far (m) along the axis from the `Sight` marker the scope's rear surface is searched. */
export const SIGHT_APERTURE_DEPTH = 0.12;

/** Iteration 15: the runtime aperture attaches only when the model's `Sight` marker is within this distance (m) of its axis. */
export const APERTURE_SIGHT_TOLERANCE = 0.01;

/** Reticle/lens look. Reticle sizes are angles (radians, tangent plane about the aim direction). */
export const OPTIC_LOOK = {
  dotRadius: 0.0032,
  glowRadius: 0.009,
  dotColor: [1.0, 0.025, 0.012] as [number, number, number], // linear; ~sRGB (255, 44, 28)
  thinHalf: 0.0007,
  thickHalf: 0.0028,
  gap: 0.018,
  post: 0.055,
  /** Exit pupil: full image while the eye is within `inner` (m) of the axis, dark lens beyond `outer`. */
  eyeBoxInner: 0.008,
  eyeBoxOuter: 0.026,
  /** Depth mask offset behind the glass (m, toward the muzzle). */
  maskOffset: 0.001,
};

/** At full ADS an optic weapon's visual kick is scaled down (fractions removed), so the eyepiece stays on the eye. */
export const OPTIC_ADS_KICK = {pos: 0.6, rot: 0.65};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Exit-pupil clarity 0..1 from the eye position in the optic frame (origin = rear glass centre, gun-model axes,
 * the eye sits at +Z behind the glass): 1 inside the eye box at a sensible distance, 0 off-axis (hip carry).
 */
export function opticClarity(eye: {x: number; y: number; z: number}, spec: OpticSpec): number {
  const lateral = Math.hypot(eye.x, eye.y);
  const lat = 1 - smoothstep(OPTIC_LOOK.eyeBoxInner, OPTIC_LOOK.eyeBoxOuter, lateral);
  const dist = smoothstep(0.012, 0.035, eye.z) * (1 - smoothstep(spec.eyeRelief * 2.2, spec.eyeRelief * 3.5, eye.z));
  return lat * dist;
}

/**
 * ADS pivot position (grip-relative holder in camera space) that puts the eye (camera origin) on the optic axis
 * `eyeRelief` behind the rear glass. `opticPoint` = OpticRear relative to the Grip pivot.
 */
export function opticAimPosition(opticPoint: THREE.Vector3, spec: OpticSpec, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, 0, -spec.eyeRelief).sub(opticPoint);
}

/**
 * Reticle frame in view space: the gun's bore direction (-Z of the gun) blended toward the camera's forward axis by
 * `aimBlend`, so at full ADS the reticle is exactly at screen centre — the hitscan direction — even while the
 * viewmodel kicks/sways; during the raise it rides with the gun.
 */
export function reticleFrame(gun: THREE.Quaternion, aimBlend: number, dir: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
  const k = Math.max(0, Math.min(1, aimBlend));
  dir.set(0, 0, -1).applyQuaternion(gun).lerp(_fwd, k).normalize();
  right.set(1, 0, 0).applyQuaternion(gun).lerp(_right, k);
  right.addScaledVector(dir, -right.dot(dir)).normalize();
  up.crossVectors(right, dir).normalize();
}
const _fwd = new THREE.Vector3(0, 0, -1);
const _right = new THREE.Vector3(1, 0, 0);

/** Lens uniforms (TSL uniform nodes; `.value` is live). */
export interface OpticLensUniforms {
  uDir: {value: THREE.Vector3};
  uRight: {value: THREE.Vector3};
  uUp: {value: THREE.Vector3};
  uClarity: {value: number};
  uLight: {value: number};
  uDot: {value: THREE.Color};
}

/** The rear-lens node material (+ its uniforms). */
export type OpticLensMaterial = MeshBasicNodeMaterial & {readonly uniforms: OpticLensUniforms};

// three's TSL typings are per node kind (float / vec2 / vec4 ...) and reject this graph's free mixing of them; the graph is
// checked by building it (tests/optic.test.ts) and by the renderer's shader compile instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/**
 * The lens colour (straight RGB + alpha) as a TSL node graph — the iteration-04 GLSL fragment, term for term:
 * coated-glass tint / dark lens outside the exit pupil, eyepiece edge shadow, coating sheen, the collimated fine duplex
 * reticle and the illuminated dot, accumulated front-to-back with `over`, then un-premultiplied.
 */
export function opticLensNode(u: OpticLensUniforms): N {
  const L = OPTIC_LOOK;
  const uDir: N = uniform(u.uDir.value), uRight: N = uniform(u.uRight.value), uUp: N = uniform(u.uUp.value);
  const uClarity: N = uniform(u.uClarity.value), uLight: N = uniform(u.uLight.value), uDot: N = uniform(u.uDot.value);
  // the material keeps these node uniforms as its `uniforms` (same objects -> `.value` edits reach the shader)
  Object.assign(u, {uDir, uRight, uUp, uClarity, uLight, uDot});
  const one: N = float(1);
  const band = (d: N, halfW: number, aa: N): N => one.sub(tslSmoothstep(float(halfW).sub(aa), float(halfW).add(aa), d));
  const step2 = (e: number, aa: N, x: N): N => tslSmoothstep(float(e).sub(aa), float(e).add(aa), x);
  const over = (dst: N, c: N, a: N): N => vec4(c.mul(a).add(dst.rgb.mul(one.sub(a))), a.add(dst.a.mul(one.sub(a))));
  const v: N = normalize(positionView);
  const c: N = max(dot(v, uDir), 1e-3);
  const t: N = vec2(dot(v, uRight), dot(v, uUp)).div(c);
  const aa: N = max(fwidth(t.x), fwidth(t.y)).mul(0.75).add(1e-6);
  const lens: N = uv().mul(2).sub(1);
  const lr: N = length(lens);
  const clr: N = uClarity;
  let acc: N = vec4(0);
  // coated glass: faint tint inside the exit pupil, a dark lens outside it
  acc = over(acc, vec3(0.012, 0.016, 0.02), mix(float(0.92), float(0.07), clr));
  // eyepiece edge shadow
  acc = over(acc, vec3(0), tslSmoothstep(mix(float(0.55), float(0.8), clr), one, lr).mul(0.9));
  // coating sheen (mostly off-axis)
  const s: N = lens.x.mul(0.6).add(lens.y.mul(0.8)).sub(0.35);
  acc = over(acc, vec3(0.55, 0.62, 0.7).mul(uLight.add(0.4)), exp(s.mul(s).mul(-10.24)).mul(mix(float(0.22), float(0.035), clr)));
  // collimated reticle: fine duplex (thick posts left/right/bottom) + illuminated dot
  const ax: N = abs(t.x), ay: N = abs(t.y);
  const ink: N = max(
    max(band(ay, L.thinHalf, aa).mul(step2(L.gap, aa, ax)), band(ax, L.thinHalf, aa).mul(step2(L.gap, aa, ay))),
    max(band(ay, L.thickHalf, aa).mul(step2(L.post, aa, ax)), band(ax, L.thickHalf, aa).mul(step2(L.post, aa, t.y.negate()))));
  acc = over(acc, vec3(0.01), ink.mul(0.85).mul(clr));
  const r: N = length(t);
  const lit: N = max(band(r, L.dotRadius, aa), exp(r.mul(r).div(-2 * L.glowRadius * L.glowRadius)).mul(0.45)).mul(clr);
  acc = over(acc, vec3(uDot), lit);
  return vec4(acc.rgb.div(max(acc.a, 1e-4)), acc.a);
}

/** The rear-lens material: transparent, no depth write, TSL lens + reticle (see the module header for tone mapping). */
export function createOpticLensMaterial(): OpticLensMaterial {
  const u: OpticLensUniforms = {
    uDir: {value: new THREE.Vector3(0, 0, -1)}, uRight: {value: new THREE.Vector3(1, 0, 0)}, uUp: {value: new THREE.Vector3(0, 1, 0)},
    uClarity: {value: 0}, uLight: {value: 0.5}, uDot: {value: new THREE.Color().setRGB(...OPTIC_LOOK.dotColor)},
  };
  const m = new MeshBasicNodeMaterial({transparent: true, depthWrite: false, depthTest: true, toneMapped: false, side: THREE.FrontSide, fog: false});
  m.name = 'rifle-optic-lens';
  m.colorNode = opticLensNode(u);
  return Object.assign(m, {uniforms: u}) as OpticLensMaterial;
}

/** Depth-only mask: colour writes off, depth on; drawn before the gun (renderOrder -1). */
export function createOpticMaskMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({name: 'rifle-optic-mask', colorWrite: false, depthWrite: true, depthTest: true});
}

/** Runtime state for one held optic weapon (viewmodel clone). */
export class RifleOptic {
  readonly lens: OpticLensMaterial;
  readonly mask: THREE.Mesh;
  /** Exit-pupil clarity and eye position in the optic frame from the last update. */
  clarity = 0;
  readonly eye = new THREE.Vector3();
  private readonly qInv = new THREE.Quaternion();

  private constructor(readonly glass: THREE.Mesh, readonly spec: OpticSpec) {
    this.lens = createOpticLensMaterial();
    glass.material = this.lens;
    glass.renderOrder = 3;
    this.mask = new THREE.Mesh(glass.geometry, createOpticMaskMaterial());
    this.mask.name = 'OpticLensMask';
    this.mask.position.z = -OPTIC_LOOK.maskOffset;
    this.mask.renderOrder = -1;
    this.mask.frustumCulled = false;
    glass.add(this.mask);
  }

  /**
   * Hook the optic up on a viewmodel clone of rifle-optic.glb. Returns null (caller keeps the legacy over-the-top
   * ADS) when the model has no see-through optic — e.g. the original rifle.glb.
   */
  static attach(model: THREE.Object3D, spec: OpticSpec): {optic: RifleOptic; rear: THREE.Vector3} | null {
    let glass = model.getObjectByName('OpticGlassRear') as THREE.Mesh | undefined;
    let anchor = model.getObjectByName('OpticRear');
    if ((!glass?.isMesh || !anchor) && spec.aperture) {
      // Iteration 15: no authored optic (the user's red-dot rifle) -> runtime aperture on the sight's axis
      const made = RifleOptic.runtimeAperture(model, spec.aperture);
      if (made) ({glass, anchor} = made);
    }
    if ((!glass?.isMesh || !anchor) && spec.sightAperture) {
      // lane GUNS: a scope on the `Sight` axis (weapon variety)
      const a = RifleOptic.sightApertureSpec(model, spec.sightAperture.radius);
      const made = a ? RifleOptic.runtimeAperture(model, a) : null;
      if (made) ({glass, anchor} = made);
    }
    if (!glass?.isMesh || !anchor) return null;
    model.updateMatrixWorld(true);
    return {optic: new RifleOptic(glass, spec), rear: anchor.getWorldPosition(new THREE.Vector3())};
  }

  /** Iteration 15: glass disk + OpticRear anchor at the spec'd aperture, if the model's `Sight` marker is on its axis. */
  private static runtimeAperture(model: THREE.Object3D, a: NonNullable<OpticSpec['aperture']>): {glass: THREE.Mesh; anchor: THREE.Object3D} | null {
    model.updateMatrixWorld(true);
    const sight = model.getObjectByName('Sight');
    if (!sight) return null;
    const s = sight.getWorldPosition(new THREE.Vector3());
    if (Math.hypot(s.x - a.x, s.y - a.y) > APERTURE_SIGHT_TOLERANCE) return null;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(a.radius, 48));
    glass.name = 'OpticGlassRear';
    glass.position.set(a.x, a.y, a.z);
    const anchor = new THREE.Object3D();
    anchor.name = 'OpticRear';
    anchor.position.set(a.x, a.y, a.z);
    model.add(glass, anchor);
    return {glass, anchor};
  }

  /**
   * Lane GUNS: the runtime aperture of a scope on the model's `Sight` axis (OpticSpec.sightAperture): x / y = the marker,
   * z = the rear-most vertex within radius x 1.6 of that axis and ±SIGHT_APERTURE_DEPTH of the marker, + APERTURE_GAP.
   * Null without a `Sight` marker.
   */
  static sightApertureSpec(model: THREE.Object3D, radius: number): NonNullable<OpticSpec['aperture']> | null {
    model.updateMatrixWorld(true);
    const sight = model.getObjectByName('Sight');
    if (!sight) return null;
    const s = sight.getWorldPosition(new THREE.Vector3());
    const r2 = (radius * 1.6) ** 2, v = new THREE.Vector3();
    let zRear = s.z;
    model.traverse(o => {
      const m = o as THREE.Mesh;
      const pos = m.isMesh ? m.geometry?.getAttribute('position') : undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if ((v.x - s.x) ** 2 + (v.y - s.y) ** 2 <= r2 && Math.abs(v.z - s.z) <= SIGHT_APERTURE_DEPTH && v.z > zRear) zRear = v.z;
      }
    });
    return {x: s.x, y: s.y, z: zRear + APERTURE_GAP, radius};
  }

  /**
   * Per frame, after the viewmodel pose is final. `pos`/`q`: pivot (Grip) position/rotation in camera space;
   * `opticPoint`: OpticRear relative to the Grip. The camera sits at the origin of camera space.
   */
  update(pos: THREE.Vector3, q: THREE.Quaternion, opticPoint: THREE.Vector3, aimBlend: number, light: number): void {
    this.qInv.copy(q).invert();
    this.eye.copy(pos).negate().applyQuaternion(this.qInv).sub(opticPoint);
    this.clarity = opticClarity(this.eye, this.spec);
    const u = this.lens.uniforms;
    reticleFrame(q, aimBlend, u.uDir.value, u.uRight.value, u.uUp.value);
    u.uClarity.value = this.clarity;
    u.uLight.value = light;
  }
}
