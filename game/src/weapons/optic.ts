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

import * as THREE from 'three';

export interface OpticSpec {
  /** Eye distance (m) behind the rear glass (OpticRear) at full ADS; the eye sits on the optic axis. */
  eyeRelief: number;
}

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

const VERT = /* glsl */ `
varying vec3 vView;
varying vec2 vLens;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vLens = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uClarity;
uniform float uLight;
uniform vec3 uDot;
varying vec3 vView;
varying vec2 vLens;
float band(float d, float halfW, float aa) { return 1.0 - smoothstep(halfW - aa, halfW + aa, d); }
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }
void main() {
  vec3 v = normalize(vView);
  float c = max(dot(v, uDir), 1e-3);
  vec2 t = vec2(dot(v, uRight), dot(v, uUp)) / c;
  float aa = max(fwidth(t.x), fwidth(t.y)) * 0.75 + 1e-6;
  float lr = length(vLens);
  float clr = uClarity;
  vec4 acc = vec4(0.0);
  // coated glass: faint tint inside the exit pupil, a dark lens outside it
  acc = over(acc, vec3(0.012, 0.016, 0.02), mix(0.92, 0.07, clr));
  // eyepiece edge shadow
  acc = over(acc, vec3(0.0), smoothstep(mix(0.55, 0.8, clr), 1.0, lr) * 0.9);
  // coating sheen (mostly off-axis)
  float s = vLens.x * 0.6 + vLens.y * 0.8 - 0.35;
  acc = over(acc, vec3(0.55, 0.62, 0.7) * (0.4 + uLight), exp(-s * s * 10.24) * mix(0.22, 0.035, clr));
  // collimated reticle: fine duplex (thick posts left/right/bottom) + illuminated dot
  float ax = abs(t.x), ay = abs(t.y);
  float ink = max(
    max(band(ay, THIN, aa) * smoothstep(GAP - aa, GAP + aa, ax), band(ax, THIN, aa) * smoothstep(GAP - aa, GAP + aa, ay)),
    max(band(ay, THICK, aa) * smoothstep(POST - aa, POST + aa, ax), band(ax, THICK, aa) * smoothstep(POST - aa, POST + aa, -t.y)));
  acc = over(acc, vec3(0.01), ink * 0.85 * clr);
  float r = length(t);
  float lit = max(band(r, DOT_R, aa), exp(-r * r / (2.0 * GLOW_R * GLOW_R)) * 0.45) * clr;
  acc = over(acc, uDot, lit);
  gl_FragColor = vec4(acc.rgb / max(acc.a, 1e-4), acc.a);
  #include <colorspace_fragment>
}`;

const f = (x: number) => x.toFixed(6);

/** The rear-lens material: transparent, no depth write, untone-mapped reticle colour. */
export function createOpticLensMaterial(): THREE.ShaderMaterial {
  const L = OPTIC_LOOK;
  return new THREE.ShaderMaterial({
    name: 'rifle-optic-lens',
    uniforms: {
      uDir: {value: new THREE.Vector3(0, 0, -1)},
      uRight: {value: new THREE.Vector3(1, 0, 0)},
      uUp: {value: new THREE.Vector3(0, 1, 0)},
      uClarity: {value: 0},
      uLight: {value: 0.5},
      uDot: {value: new THREE.Color().setRGB(...L.dotColor)},
    },
    defines: {THIN: f(L.thinHalf), THICK: f(L.thickHalf), GAP: f(L.gap), POST: f(L.post), DOT_R: f(L.dotRadius), GLOW_R: f(L.glowRadius)},
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.FrontSide,
  });
}

/** Depth-only mask: colour writes off, depth on; drawn before the gun (renderOrder -1). */
export function createOpticMaskMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({name: 'rifle-optic-mask', colorWrite: false, depthWrite: true, depthTest: true});
}

/** Runtime state for one held optic weapon (viewmodel clone). */
export class RifleOptic {
  readonly lens: THREE.ShaderMaterial;
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
    const glass = model.getObjectByName('OpticGlassRear') as THREE.Mesh | undefined;
    const anchor = model.getObjectByName('OpticRear');
    if (!glass?.isMesh || !anchor) return null;
    model.updateMatrixWorld(true);
    return {optic: new RifleOptic(glass, spec), rear: anchor.getWorldPosition(new THREE.Vector3())};
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
