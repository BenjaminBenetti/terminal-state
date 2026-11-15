// Task baked-gi-visual-uplift-20261115-004324 (lane MIRROR): the LIVE GLASS MIRROR — a planar reflection of the real scene for
// the ONE glass plane the player faces (world/glassPanes.ts), so a storefront or the booth shows the room behind the player and the
// live flashlight's light on it; every other reflecting surface keeps the cached probes (world/reflectionNode.ts).
//
// HOW (three r186 WebGPURenderer, both backends):
//  - PANE-SPACE MIRROR. The real, un-mirrored scene is drawn once more from the MIRRORED EYE (the eye reflected in the glass),
//    looking along the plane's normal toward the viewer's side through an OFF-AXIS frustum whose near plane IS the glass and whose
//    window is the visible part of the plane. No reflection matrix (no flipped winding: the same programs and pipelines as the
//    scene pass), nothing behind the glass (the near plane cuts it), and the image lies in the pane's own coordinates: a fragment
//    of the glass finds its texel from its WORLD position alone — two lines of shader, no projection — so the picture is glued to
//    the pane wherever the eye stands.
//  - THE SCENE PASS'S OWN RENDER CONTEXT. The target has the scene pass's exact signature (colour type / format / colour space,
//    depth, samples, no MRT) and is drawn at the scene pass's render-context call depth (render/renderContextDepth.ts), under the
//    state the scene pass draws with. three keys render contexts by that signature and depth, and render objects, node builds and
//    pipelines by the context: the mirror draw therefore re-uses the station's render objects, programs and pipelines — after
//    warm-up it creates nothing (tests/glass-mirror-game.test.ts: the real Game, zero node builds / pipelines / render objects /
//    render contexts while the mirror draws). The target is CAP-sized (a fixed 29 MB at Standard, 66 MB at High with 4x MSAA,
//    whatever the display's resolution); the picture is a viewport of it. (`match`: a target of the scene target's size instead —
//    three's per-object change check includes the context's buffer size, so about 25 more objects per pass take the full refresh
//    path with the cap-sized target; measured in the real Game that costs nothing visible, while a matched 4x MSAA target is
//    116 MB at 1080p and 464 MB at 4K.)
//  - NO FEEDBACK, by construction: exactly the materials whose program can sample the mirror — the 'glass' reflect tag
//    (render/reflectTag.ts), the one class world/reflectionNode.ts builds the lookup into — are not drawn in the mirror pass (the
//    renderer's render-object function, restored in `finally`), so the target is never bound for sampling while it is the
//    attachment. No material flag is touched.
//  - NO SECOND SHADOW PASS: every shadow light's `shadow.autoUpdate` / `needsUpdate` is off for the draw (restored): the mirror
//    reads the flashlight shadow the previous frame left; the scene pass then draws this frame's as always. The light set, the
//    lights' `visible` / `castShadow` and the camera `layers` (the level culler's result for the MAIN camera) are never changed.
//  - GM: one texture node and three plain render-group vec4 uniforms (no uniform buffer of its own in any stage; no uniformArray).
//    Materials compile against a placeholder; the mirror's texture is bound once, when the target exists (and every render object
//    re-reads its bindings once: render/bindingRefresh.ts). Inactive = `GM.plane.w` 0: the lookup is skipped, the probes show.
//  - SELECTION (select, once per frame, allocation-free): the plane with the largest on-screen area of INTACT panes (clipped to
//    the main camera's frustum and to CAP metres) weighted by nearness; a current plane is kept until another is clearly better,
//    and a change fades out and in (no pop). No plane on screen -> nothing is drawn at all.
//
// LIMITS (by design): one plane at a time; no player body or held weapon (the viewmodel is its own overlay scene); no volumetric
// fog along the reflected path (the scene's own distance fog only); glass does not show in glass; the flashlight's shadow in the
// mirror is one frame late; what the level culler hid from the main camera (far fog cull; the eye-based occlusion of the Mall /
// Reactor / Skyways storeys) is missing in the mirror too.

import * as THREE from 'three';
import {If, abs, cameraPosition, float, min, normalWorld, renderGroup, smoothstep, texture, uniform, vec2, vec4} from 'three/tsl';
import type {Node} from 'three/webgpu';
import {refreshTextureBindings} from './bindingRefresh';
import {plainTexture} from './textureFetch';
import {renderAtDepthOffset} from './renderContextDepth';
import {reflectTagOf} from './reflectTag';
import type {GlassPane, GlassPlane} from '../world/glassPanes';

// TSL nodes are chained untyped here (three's TSL typings reject most mixed-type chains).
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (x: unknown): N => x;

// ---------------------------------------------------------------------------------------------
// Constants

export const GLASS_MIRROR = {
  /** Farthest point of a pane (m from the eye) that still shows the mirror; it fades out over the last fifth. */
  cap: 12,
  /** Where the distance fade starts, as a fraction of `cap`. */
  fadeFrom: 0.8,
  /**
   * Length of the reflected path the mirror draws (m, from the eye to the glass and on to the thing): the flashlight's own
   * distance — nothing farther answers to it, and the scene's fog leaves under a fifth of anything beyond.
   */
  reach: 30,
  /** A glass fragment within this of the mirrored face (m) takes the mirror. */
  tolerance: 0.04,
  /** Soft edge of the rendered window (mirror texels) and the margin drawn around the visible panes (texels). */
  edgeTexels: 2.5,
  padTexels: 4,
  /** Mirror texels per screen pixel at the nearest visible pane point (1 = screen resolution). */
  density: 0.8,
  /** Smallest picture drawn (texels a side). */
  minTexels: 16,
  /**
   * A plane becomes the mirror when its intact panes cover this much of the screen (0..1; a whole storefront pane seen from the
   * front at about 11 m) ...
   */
  enter: 0.015,
  /** ... and stays it down to this. (The mirror is one more draw of the scene: slivers and far panes keep the probes.) */
  keep: 0.006,
  /** Another plane takes over only when its score is this many times the current one's. */
  switchGain: 1.3,
  /** Seconds a change of plane fades out / in. */
  fade: 0.18,
  /** The eye is never treated as closer to the glass than this (m): the mirror camera's near distance. */
  minDistance: 0.05,
  /**
   * The sight probes stand this far in front of the glass (m) — and, when none of them is seen from there, `standoff`: just past
   * one grid cell, for glass that lies inside its own prop's sight-blocking footprint (the ticket booth).
   */
  probe: 0.06, standoff: 0.6,
  /** The eye must be within this below / above a plane's panes (m): other storeys' glass is not a candidate. */
  below: 2, above: 2.5,
} as const;

/** Overall mirror brightness (1 = the scene's own radiance; QA / tuning). */
export const GLASS_MIRROR_TUNING = {gain: 1};

/** Picture caps (texels) of the Reflections setting's two tiers. */
export const GLASS_MIRROR_CAPS = {standard: [1024, 512], high: [1536, 768]} as const;

// ---------------------------------------------------------------------------------------------
// Global nodes

const PLACEHOLDER = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
PLACEHOLDER.name = 'glass-mirror-placeholder';
PLACEHOLDER.minFilter = PLACEHOLDER.magFilter = THREE.LinearFilter;
PLACEHOLDER.wrapS = PLACEHOLDER.wrapT = THREE.ClampToEdgeWrapping;
PLACEHOLDER.generateMipmaps = false; PLACEHOLDER.flipY = false; PLACEHOLDER.colorSpace = THREE.NoColorSpace;
PLACEHOLDER.needsUpdate = true;

/**
 * The mirror's global nodes (bound by the one GlassMirror that draws; placeholders otherwise).
 *  - tex: the mirror picture (scene-linear radiance), in the pane's own coordinates;
 *  - plane = (nx, nz, d, strength): the mirrored FACE of the glass is nx * x + nz * z = d, its normal toward the eye; strength 0..1
 *    (0 = inactive: the lookup is skipped);
 *  - rect = (a0, yTop, 1 / width, 1 / height) of the drawn window (m): a = nx * z - nz * x runs to the mirror camera's right;
 *  - params = (viewport width / target width, viewport height / target height, soft edge as a fraction of the window (edgeTexels of its LONGER side: never wider than the pad), gain).
 */
export const GM = {
  // (render/textureFetch.ts: no uv-transform uniform — the picture is looked up with its own uv)
  tex: plainTexture(texture(PLACEHOLDER)),
  plane: uniform(new THREE.Vector4(1, 0, 0, 0)).setGroup(renderGroup),
  rect: uniform(new THREE.Vector4(0, 0, 1, 1)).setGroup(renderGroup),
  params: uniform(new THREE.Vector4(0, 0, 1, 1)).setGroup(renderGroup),
};

/** Whether `t` is the mirror's placeholder (tests). */
export function isGlassMirrorPlaceholder(t: unknown): boolean {
  return t === PLACEHOLDER;
}

/**
 * The mirror at world point `positionWorld` of a glass fragment: rgb = the mirror's radiance (scene-linear, gain applied),
 * a = how much of it shows — 1 on the active plane inside the drawn window (a soft edge of a few texels, a fade toward CAP),
 * 0 anywhere else (another pane, no mirror). `normal`: the fragment's world normal (default: the material's). Declares vars and
 * branches: call inside a material / lighting stack.
 */
export function glassMirrorSample(positionWorld: Node, normal: Node = normalWorld): Node {
  const P = n(positionWorld), Nw = n(normal), pl = n(GM.plane), rc = n(GM.rect), pr = n(GM.params);
  const out = n(vec4(0, 0, 0, 0)).toVar();
  If(n(pl.w).greaterThan(0.002), () => {
    const sd = n(pl.x).mul(P.x).add(n(pl.y).mul(P.z)).sub(pl.z);
    const a = n(pl.x).mul(P.z).sub(n(pl.y).mul(P.x));
    const u = n(n(a).sub(rc.x).mul(rc.z)).toVar(), v = n(n(rc.y).sub(P.y).mul(rc.w)).toVar();
    const facing = abs(n(pl.x).mul(Nw.x).add(n(pl.y).mul(Nw.z)));
    const edge = n(smoothstep(0, pr.z, min(u, float(1).sub(u)))).mul(smoothstep(0, pr.z, min(v, float(1).sub(v))));
    const dist = n(P).sub(cameraPosition).length();
    const far = float(1).sub(smoothstep(GLASS_MIRROR.cap * GLASS_MIRROR.fadeFrom, GLASS_MIRROR.cap, dist));
    const on = n(abs(sd)).lessThan(GLASS_MIRROR.tolerance).and(n(facing).greaterThan(0.5));
    const w = n(n(edge).mul(far).mul(pl.w)).toVar();
    If(n(on).and(n(w).greaterThan(0.003)), () => {
      const uv = vec2(n(u).mul(pr.x), n(v).mul(pr.y));
      out.assign(vec4(n(n(GM.tex).sample(uv).level(0)).rgb.mul(pr.w), w));
    });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Maths (pure; the tests check them against explicit reflection geometry)

/** The mirrored face of a plane as seen from an eye: which side, the face's normal (toward the eye) and its plane constant. */
export interface MirrorFace {
  /** +1: the eye is on the plane's positive side (larger x of an 'x' plane / larger z of a 'z' plane), -1: the other. */
  side: 1 | -1;
  nx: number; nz: number;
  /** nx * x + nz * z = d on the face. */
  d: number;
  /** Eye distance to the face (m, >= 0). */
  dist: number;
  /** +1 / -1: the along-coordinate a = nx * z - nz * x equals sigma * u (u: the plane's own along-coordinate). */
  sigma: 1 | -1;
}

/** The face of `plane` toward (ex, ez), into `out`. */
export function mirrorFace(plane: Pick<GlassPlane, 'axis' | 'coord' | 'half'>, ex: number, ez: number, out: MirrorFace): MirrorFace {
  const c = plane.axis === 'x' ? ex : ez;
  const side: 1 | -1 = c >= plane.coord ? 1 : -1;
  out.side = side;
  out.nx = plane.axis === 'x' ? side : 0;
  out.nz = plane.axis === 'x' ? 0 : side;
  out.d = side * plane.coord + plane.half;
  out.dist = Math.max(0, side * c - out.d);
  out.sigma = (plane.axis === 'x' ? side : -side) as 1 | -1;
  return out;
}

/** A drawn window of the glass: a0..a1 along a (the mirror camera's right), y0..y1 up; `texel` metres per mirror texel; w x h texels. */
export interface MirrorWindow { a0: number; a1: number; y0: number; y1: number; texel: number; w: number; h: number }

/**
 * The window drawn for the visible box (a0..a1, y0..y1) of a plane: padded by GLASS_MIRROR.padTexels, on a WORLD-ANCHORED texel
 * grid (edges at whole multiples of the texel; the texel a power of sqrt(2) — the picture does not swim while the eye moves) at
 * no more than `maxW` x `maxH` texels. `pixel`: the footprint of a screen pixel on the glass at the nearest visible point (m).
 */
export function mirrorWindow(a0: number, a1: number, y0: number, y1: number, pixel: number, maxW: number, maxH: number, out: MirrorWindow): MirrorWindow {
  const pad = GLASS_MIRROR.padTexels;
  const mw = Math.max(GLASS_MIRROR.minTexels, Math.floor(maxW)), mh = Math.max(GLASS_MIRROR.minTexels, Math.floor(maxH));
  const want = Math.max(1e-4, pixel / GLASS_MIRROR.density, (a1 - a0) / Math.max(1, mw - 2 * pad - 2), (y1 - y0) / Math.max(1, mh - 2 * pad - 2));
  let k = Math.ceil(Math.log2(want) * 2 - 1e-9);
  for (let i = 0; i < 6; i++, k++) {
    const s = Math.pow(2, k / 2);
    const lo = Math.floor(a0 / s) - pad, top = Math.ceil(y1 / s) + pad;
    const w = Math.max(GLASS_MIRROR.minTexels, Math.ceil(a1 / s) + pad - lo), h = Math.max(GLASS_MIRROR.minTexels, top - (Math.floor(y0 / s) - pad));
    out.texel = s; out.a0 = lo * s; out.a1 = (lo + w) * s; out.y1 = top * s; out.y0 = (top - h) * s; out.w = w; out.h = h;
    if (w <= mw && h <= mh) break;
  }
  return out;
}

/**
 * Pose and frustum of the mirror camera for an eye at (ex, ey, ez) and a window of the face: the camera sits at the mirrored eye,
 * looks along the face normal (toward the eye's side), its near plane on the glass. Writes `matrixWorld`, its inverse and the
 * frustum (left / right / top / bottom at the near distance, near, far) into `out`.
 */
export function mirrorCameraPose(face: MirrorFace, win: Pick<MirrorWindow, 'a0' | 'a1' | 'y0' | 'y1'>, ex: number, ey: number, ez: number, reach: number,
  out: {matrixWorld: THREE.Matrix4; matrixWorldInverse: THREE.Matrix4; left: number; right: number; top: number; bottom: number; near: number; far: number}): void {
  const {nx, nz} = face;
  const dEff = Math.max(face.dist, GLASS_MIRROR.minDistance);
  // the eye's foot point on the face, then dEff behind it
  const sd = nx * ex + nz * ez - face.d;
  const px = ex - nx * (sd + dEff), pz = ez - nz * (sd + dEff);
  // right = n x up = (-nz, 0, nx); up = +y; back = -n   (right x up = back: a proper rotation)
  out.matrixWorld.set(
    -nz, 0, -nx, px,
    0, 1, 0, ey,
    nx, 0, -nz, pz,
    0, 0, 0, 1);
  out.matrixWorldInverse.set(
    -nz, 0, nx, nz * px - nx * pz,
    0, 1, 0, -ey,
    -nx, 0, -nz, nx * px + nz * pz,
    0, 0, 0, 1);
  const aE = nx * ez - nz * ex;
  out.left = win.a0 - aE; out.right = win.a1 - aE;
  out.bottom = win.y0 - ey; out.top = win.y1 - ey;
  out.near = dEff; out.far = dEff + reach;
}

/** (u, v) of the mirror picture's window (0..1, v down) for a world point of the glass — the shader's mapping on the CPU. */
export function mirrorUv(face: MirrorFace, win: Pick<MirrorWindow, 'a0' | 'a1' | 'y0' | 'y1'>, x: number, y: number, z: number): [number, number] {
  const a = face.nx * z - face.nz * x;
  return [(a - win.a0) / (win.a1 - win.a0), (win.y1 - y) / (win.y1 - win.y0)];
}

/** How much of the mirror a glass fragment shows (glassMirrorSample's alpha on the CPU; `strength` = GM.plane.w). */
export function mirrorAlpha(face: MirrorFace, win: MirrorWindow, x: number, y: number, z: number, normal: readonly [number, number, number], eye: readonly [number, number, number], strength = 1): number {
  if (!(strength > 0.002)) return 0;
  const sd = face.nx * x + face.nz * z - face.d;
  if (!(Math.abs(sd) < GLASS_MIRROR.tolerance) || !(Math.abs(face.nx * normal[0] + face.nz * normal[2]) > 0.5)) return 0;
  const [u, v] = mirrorUv(face, win, x, y, z);
  const ss = (e0: number, e1: number, t: number): number => { const k = Math.min(1, Math.max(0, (t - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
  const e = GLASS_MIRROR.edgeTexels / Math.max(win.w, win.h);
  const edge = ss(0, e, Math.min(u, 1 - u)) * ss(0, e, Math.min(v, 1 - v));
  const dist = Math.hypot(x - eye[0], y - eye[1], z - eye[2]);
  const w = edge * (1 - ss(GLASS_MIRROR.cap * GLASS_MIRROR.fadeFrom, GLASS_MIRROR.cap, dist)) * strength;
  return w > 0.003 ? w : 0;
}

// --- clipping a pane against the main camera's frustum (clip space; fixed scratch, no allocation) ---

const STRIDE = 5; // clip x, y, w, then the pane's own (u, y)
const polyA = new Float64Array(STRIDE * 16), polyB = new Float64Array(STRIDE * 16);
/** Signed "inside" distance of vertex i of `p` for clip plane k: 0 w > eps, 1 x > -w, 2 x < w, 3 y > -w, 4 y < w. */
function inside(p: Float64Array, i: number, k: number): number {
  const x = p[i * STRIDE], y = p[i * STRIDE + 1], w = p[i * STRIDE + 2];
  return k === 0 ? w - 1e-4 : k === 1 ? w + x : k === 2 ? w - x : k === 3 ? w + y : w - y;
}

/** What is visible of a rectangle of the glass. */
export interface PaneView { area: number; u0: number; u1: number; y0: number; y1: number }

/**
 * The part of the rectangle (u0..u1, y0..y1) of a plane's face (at `face` along the plane's axis) inside the frustum of the
 * view-projection matrix `vp`: its area in normalised device coordinates (the whole screen is 4) and its box on the glass, added
 * to `out` (area summed, box grown). Returns the area of this rectangle.
 */
export function clipPane(axis: 'x' | 'z', face: number, u0: number, u1: number, y0: number, y1: number, vp: THREE.Matrix4, out: PaneView): number {
  const e = vp.elements;
  let p = polyA, q = polyB, count = 4;
  for (let i = 0; i < 4; i++) {
    const u = i === 0 || i === 3 ? u0 : u1, y = i < 2 ? y0 : y1;
    const x = axis === 'x' ? face : u, z = axis === 'x' ? u : face;
    const o = i * STRIDE;
    p[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
    p[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    p[o + 2] = e[3] * x + e[7] * y + e[11] * z + e[15];
    p[o + 3] = u; p[o + 4] = y;
  }
  for (let k = 0; k < 5 && count > 0; k++) {
    let m = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count, di = inside(p, i, k), dj = inside(p, j, k);
      if (di >= 0) { for (let c = 0; c < STRIDE; c++) q[m * STRIDE + c] = p[i * STRIDE + c]; m++; }
      if ((di >= 0) !== (dj >= 0)) {
        const t = di / (di - dj);
        for (let c = 0; c < STRIDE; c++) q[m * STRIDE + c] = p[i * STRIDE + c] + (p[j * STRIDE + c] - p[i * STRIDE + c]) * t;
        m++;
      }
    }
    count = m;
    const s = p; p = q; q = s;
  }
  if (count < 3) return 0;
  let area = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count, wi = p[i * STRIDE + 2], wj = p[j * STRIDE + 2];
    area += (p[i * STRIDE] / wi) * (p[j * STRIDE + 1] / wj) - (p[j * STRIDE] / wj) * (p[i * STRIDE + 1] / wi);
    const u = p[i * STRIDE + 3], y = p[i * STRIDE + 4];
    if (u < out.u0) out.u0 = u;
    if (u > out.u1) out.u1 = u;
    if (y < out.y0) out.y0 = y;
    if (y > out.y1) out.y1 = y;
  }
  area = Math.abs(area) * 0.5;
  out.area += area;
  return area;
}

// ---------------------------------------------------------------------------------------------
// The mirror camera

/** A camera whose projection is the off-axis frustum it was given (three re-derives a PerspectiveCamera's from fov / aspect). */
export class PaneCamera extends THREE.PerspectiveCamera {
  left = -1; right = 1; top = 1; bottom = -1;
  private readonly ready: boolean;
  constructor() {
    super();
    this.name = 'glass-mirror-camera';
    this.matrixAutoUpdate = false;
    this.matrixWorldAutoUpdate = false;
    this.ready = true;
    this.updateProjectionMatrix();
  }
  override updateProjectionMatrix(): void {
    if (!this.ready) return; // (the base constructor calls this before the fields exist)
    this.projectionMatrix.makePerspective(this.left, this.right, this.top, this.bottom, this.near, this.far, this.coordinateSystem, this.reversedDepth);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}

// ---------------------------------------------------------------------------------------------
// The mirror

/** The scene pass the mirror shares its render context with: its render target and the render-context call depth it draws at. */
export interface MirrorScenePass { target: THREE.RenderTarget; depth: number }

/** What the mirror needs of a renderer (three's WebGPURenderer; a fake in the unit tests). */
export interface MirrorRenderer {
  getRenderTarget(): THREE.RenderTarget | null;
  setRenderTarget(target: THREE.RenderTarget | null): void;
  getMRT(): unknown;
  setMRT(mrt: unknown): unknown;
  getRenderObjectFunction(): unknown;
  setRenderObjectFunction(fn: unknown): void;
  renderObject(...args: unknown[]): void;
  render(scene: THREE.Scene, camera: THREE.Camera): unknown;
  getDrawingBufferSize?(target: THREE.Vector2): THREE.Vector2;
  autoClear: boolean; autoClearColor: boolean; autoClearDepth: boolean; autoClearStencil: boolean;
  toneMapping: THREE.ToneMapping; outputColorSpace: string;
  transparent?: boolean; opaque?: boolean;
}

export interface GlassMirrorOptions {
  /** Largest picture (texels): GLASS_MIRROR_CAPS.standard / .high. */
  cap?: readonly [number, number];
  /**
   * The scene pass to share the render context with, asked every frame right before the draw (null: the frame is not drawn by the
   * volumetric pipeline, or its target / depth is not known yet -> the mirror does not draw).
   */
  scenePass: () => MirrorScenePass | null;
  /**
   * false (default): a target of exactly `cap`. true: the target has the scene target's size and the picture is a sub-viewport
   * of it (memory that grows with the display; see the module doc).
   */
  match?: boolean;
  /** Line of sight between two world points (walls); a plane none of whose probe points the eye can see is not selected. */
  sight?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => boolean;
}

type ShadowLight = THREE.Light & {shadow: THREE.LightShadow};
interface Candidate { plane: GlassPlane | null; score: number; coverage: number; u0: number; u1: number; y0: number; y1: number; near: number }
const emptyCandidate = (): Candidate => ({plane: null, score: 0, coverage: 0, u0: 0, u1: 0, y0: 0, y1: 0, near: 0});

const _vp = new THREE.Matrix4(), _eye = new THREE.Vector3(), _size = new THREE.Vector2();
const _view: PaneView = {area: 0, u0: 0, u1: 0, y0: 0, y1: 0};
const _face: MirrorFace = {side: 1, nx: 1, nz: 0, d: 0, dist: 0, sigma: 1};

export class GlassMirror {
  /** Largest picture (texels); may be changed between frames (the Reflections tier). */
  cap: readonly [number, number];
  private readonly match: boolean;
  private readonly scenePass: () => MirrorScenePass | null;
  private readonly sight: GlassMirrorOptions['sight'];
  private planes: readonly GlassPlane[] = [];
  private current: GlassPlane | null = null;
  private strength = 0;
  /** Scratch of select / render (no allocation per frame). */
  private readonly cur = emptyCandidate();
  private readonly best = emptyCandidate();
  private readonly tmp = emptyCandidate();
  private readonly win: MirrorWindow = {a0: 0, a1: 1, y0: 0, y1: 1, texel: 1, w: 1, h: 1};
  private readonly face: MirrorFace = {side: 1, nx: 1, nz: 0, d: 0, dist: 0, sigma: 1};
  readonly camera = new PaneCamera();
  private target: THREE.RenderTarget | null = null;
  private signature = '';
  private bound = false;
  private shadowLights: ShadowLight[] | null = null;
  private shadowScene: THREE.Scene | null = null;
  private readonly shadowFlags: boolean[] = [];
  private disposed = false;
  private primed = false;
  private failed: string | null = null;
  /** Counters (QA / tests): mirror draws, frames without one, objects drawn / glass objects left out in the last draw. */
  readonly stats = {renders: 0, idle: 0, drawn: 0, skipped: 0, targets: 0};
  private drawing = false;
  private readonly filter: (...a: unknown[]) => void;
  private filterRenderer: MirrorRenderer | null = null;

  constructor(opts: GlassMirrorOptions) {
    this.cap = opts.cap ?? GLASS_MIRROR_CAPS.standard;
    this.match = opts.match ?? false;
    this.scenePass = opts.scenePass;
    this.sight = opts.sight;
    // (one closure for the mirror's life: three calls it per object of the mirror draw)
    this.filter = (...a: unknown[]) => {
      if (reflectTagOf(a[4] as THREE.Material) === 'glass') { this.stats.skipped++; return; }
      // (an instanced pool with nothing in it draws nothing — three still walks it through the whole per-object path)
      const o = a[0] as {isInstancedMesh?: boolean; count?: number};
      if (o.isInstancedMesh === true && !((o.count as number) > 0)) return;
      this.stats.drawn++;
      this.filterRenderer!.renderObject(...a);
    };
  }

  /** The station's glass planes (world/glassPanes.ts collectGlassPlanes), or null: no mirror (transit gap, teardown). */
  setPlanes(planes: readonly GlassPlane[] | null): void {
    this.planes = planes ?? [];
    this.current = null;
    this.strength = 0;
    this.shadowLights = null;
    this.shadowScene = null;
    this.deactivate();
  }

  /**
   * Make the next draw happen even when no plane is in view (the nearest plane with an intact pane, at full strength for that one
   * draw): the loading warm-up's hidden frames call this so the target, its bindings and the mirror view's render list exist
   * before play.
   */
  prime(): void {
    this.primed = true;
  }

  /** The plane the mirror shows (null: none). */
  get plane(): GlassPlane | null {
    return this.current;
  }

  /**
   * Score `plane` for the camera whose view-projection is in _vp and whose position is in _eye, into `c` (score 0: not a
   * candidate). The visible box of its intact panes is left in c.u0.. (the plane's own along-coordinate).
   */
  private evaluate(plane: GlassPlane, c: Candidate): void {
    c.plane = plane; c.score = 0; c.coverage = 0;
    const cap = GLASS_MIRROR.cap;
    const f = mirrorFace(plane, _eye.x, _eye.z, _face);
    if (f.dist >= cap) return;
    if (_eye.y < plane.y0 - GLASS_MIRROR.below || _eye.y > plane.y1 + GLASS_MIRROR.above) return;
    const eu = plane.axis === 'x' ? _eye.z : _eye.x, ra = Math.sqrt(cap * cap - f.dist * f.dist);
    const face = plane.coord + f.side * plane.half;
    _view.area = 0; _view.u0 = Infinity; _view.u1 = -Infinity; _view.y0 = Infinity; _view.y1 = -Infinity;
    const panes = plane.panes;
    for (let i = 0; i < panes.length; i++) {
      const p: GlassPane = panes[i];
      const u0 = Math.max(p.u0, eu - ra), u1 = Math.min(p.u1, eu + ra);
      if (u1 - u0 < 0.02) continue;
      if (!p.intact()) continue;
      clipPane(plane.axis, face, u0, u1, p.y0, p.y1, _vp, _view);
    }
    if (!(_view.area > 0)) return;
    c.coverage = _view.area / 4;
    c.u0 = _view.u0; c.u1 = _view.u1; c.y0 = _view.y0; c.y1 = _view.y1;
    // nearest visible point of the box to the eye (for the picture's resolution)
    const du = eu < c.u0 ? c.u0 - eu : eu > c.u1 ? eu - c.u1 : 0, dy = _eye.y < c.y0 ? c.y0 - _eye.y : _eye.y > c.y1 ? _eye.y - c.y1 : 0;
    c.near = Math.hypot(f.dist, du, dy);
    c.score = c.coverage * (1 - f.dist / cap);
  }

  /** Whether the eye sees the candidate's box (three probe points on its face, pulled toward the eye). */
  private seen(c: Candidate): boolean {
    const sight = this.sight;
    if (!sight || !c.plane) return true;
    const plane = c.plane, f = mirrorFace(plane, _eye.x, _eye.z, _face);
    const y = Math.min(c.y1, Math.max(c.y0, _eye.y));
    // (second ring: glass inside a sight-blocking prop's own footprint cells — the ticket booth's panes — is probed a cell out)
    for (let ring = 0; ring < 2; ring++) {
      const off = ring === 0 ? GLASS_MIRROR.probe : Math.min(GLASS_MIRROR.standoff, f.dist * 0.9);
      if (ring === 1 && off <= GLASS_MIRROR.probe) break;
      const at = plane.coord + f.side * (plane.half + off);
      for (let k = 0; k < 3; k++) {
        const u = c.u0 + (c.u1 - c.u0) * (k === 0 ? 0.5 : k === 1 ? 0.15 : 0.85);
        const x = plane.axis === 'x' ? at : u, z = plane.axis === 'x' ? u : at;
        if (sight(_eye.x, _eye.y, _eye.z, x, y, z)) return true;
      }
    }
    return false;
  }

  private copy(from: Candidate, to: Candidate): void {
    to.plane = from.plane; to.score = from.score; to.coverage = from.coverage; to.u0 = from.u0; to.u1 = from.u1; to.y0 = from.y0; to.y1 = from.y1; to.near = from.near;
  }

  private loadCamera(camera: THREE.PerspectiveCamera): void {
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _eye.setFromMatrixPosition(camera.matrixWorld);
  }

  /**
   * Pick the plane for this frame (call once per frame after the camera moved; `dt` seconds drive the fade of a change). Returns
   * the plane the mirror shows now (null: none — render() then draws nothing).
   */
  select(camera: THREE.PerspectiveCamera, dt = 1 / 60): GlassPlane | null {
    if (this.disposed || this.failed || !this.planes.length) { this.current = null; this.strength = 0; return null; }
    camera.updateWorldMatrix(true, false);
    this.loadCamera(camera);
    const cur = this.cur, best = this.best, tmp = this.tmp;
    cur.plane = null; cur.score = 0; best.plane = null; best.score = 0;
    for (let i = 0; i < this.planes.length; i++) {
      const plane = this.planes[i];
      this.evaluate(plane, tmp);
      if (plane === this.current) { if (tmp.coverage >= GLASS_MIRROR.keep && this.seen(tmp)) this.copy(tmp, cur); continue; }
      if (tmp.coverage >= GLASS_MIRROR.enter && tmp.score > best.score && this.seen(tmp)) this.copy(tmp, best);
    }
    const stay = cur.plane !== null && !(best.plane !== null && best.score > cur.score * GLASS_MIRROR.switchGain);
    const step = Math.max(0, dt) / GLASS_MIRROR.fade;
    if (stay) {
      this.strength = Math.min(1, this.strength + step);
    } else if (this.current !== null && this.strength > 0 && cur.plane !== null) {
      // a better plane: fade the current one out first
      this.strength = Math.max(0, this.strength - step);
    } else {
      // nothing shown (or the current one left the view): take the best at once, and fade it in
      this.current = best.plane;
      this.strength = best.plane ? Math.min(1, step) : 0;
    }
    return this.current;
  }

  private deactivate(): void {
    GM.plane.value.w = 0;
  }

  /** The shadow lights of `scene` (found once per scene / plane set: the light set never changes during a session). */
  private lightsOf(scene: THREE.Scene): ShadowLight[] {
    if (this.shadowLights && this.shadowScene === scene) return this.shadowLights;
    const out: ShadowLight[] = [];
    scene.traverse(o => { const l = o as ShadowLight; if (l.isLight && l.shadow) out.push(l); });
    this.shadowLights = out;
    this.shadowScene = scene;
    return out;
  }

  /** The target for a scene pass (created / re-created only when the scene target's signature — or, matched, its size — changes). */
  private ensureTarget(pass: MirrorScenePass): THREE.RenderTarget {
    const src = pass.target, st = src.texture, sd = src.depthTexture;
    const W = this.match ? src.width : this.cap[0], H = this.match ? src.height : this.cap[1];
    const sig = `${W}x${H}|${st.type}|${st.format}|${st.colorSpace}|${src.samples}|${src.depthBuffer}|${src.stencilBuffer}|${sd ? `${sd.type}/${sd.format}` : '-'}`;
    if (this.target && this.signature === sig) return this.target;
    if (this.target) {
      // (bind the placeholder first: no render object may keep naming the old texture)
      if (GM.tex.value === this.target.texture) { GM.tex.value = PLACEHOLDER; refreshTextureBindings(); }
      this.bound = false;
      this.target.dispose();
    }
    const t = new THREE.RenderTarget(W, H, {
      type: st.type, format: st.format as THREE.PixelFormat, colorSpace: st.colorSpace as THREE.ColorSpace, samples: src.samples, depthBuffer: src.depthBuffer, stencilBuffer: src.stencilBuffer,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    t.texture.name = 'glass-mirror';
    if (sd) {
      const d = new THREE.DepthTexture(W, H);
      d.type = sd.type; d.format = sd.format;
      (d as unknown as {isRenderTargetTexture: boolean}).isRenderTargetTexture = true;
      d.name = 'glass-mirror-depth';
      t.depthTexture = d;
    }
    this.target = t;
    this.signature = sig;
    this.stats.targets++;
    return t;
  }

  /**
   * Draw the mirror for the selected plane (call inside the frame, right before the scene pass draws; only on frames the
   * volumetric pipeline draws). Returns false — and leaves the mirror inactive for this frame — when there is nothing to draw:
   * no plane, the plane out of view, no scene pass, or an earlier failure.
   */
  render(renderer: MirrorRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): boolean {
    if (this.disposed || this.failed || this.drawing) { this.deactivate(); return false; }
    const pass = this.scenePass();
    if (!pass || !(pass.target.width > 1) || !(pass.target.height > 1)) { this.deactivate(); this.stats.idle++; return false; }
    this.loadCamera(camera);
    const c = this.tmp;
    let strength = this.strength;
    c.plane = null; c.coverage = 0;
    if (this.current && strength > 0) this.evaluate(this.current, c);
    if (!(c.coverage > 0) && this.primed) {
      // the warm-up's draw: the nearest plane with an intact pane, its whole box, whether or not it is in view
      let pick: GlassPlane | null = null, dBest = Infinity;
      for (const plane of this.planes) {
        if (!plane.panes.some(p => p.intact())) continue;
        const eu = plane.axis === 'x' ? _eye.z : _eye.x, f = mirrorFace(plane, _eye.x, _eye.z, _face);
        const d = Math.hypot(f.dist, eu < plane.u0 ? plane.u0 - eu : eu > plane.u1 ? eu - plane.u1 : 0);
        if (d < dBest) { dBest = d; pick = plane; }
      }
      if (pick) {
        const eu = pick.axis === 'x' ? _eye.z : _eye.x, half = GLASS_MIRROR.cap * 0.5;
        c.plane = pick; c.coverage = 1; c.near = 2;
        c.u0 = Math.max(pick.u0, Math.min(eu, pick.u1) - half); c.u1 = Math.min(pick.u1, Math.max(eu, pick.u0) + half); c.y0 = pick.y0; c.y1 = pick.y1;
        strength = 0; // (drawn, never shown)
      }
    }
    const plane = c.plane;
    if (!plane || !(c.coverage > 0)) { this.deactivate(); this.stats.idle++; return false; }
    this.primed = false;

    // --- window, camera, uniforms ---
    const target = this.ensureTarget(pass);
    const face = mirrorFace(plane, _eye.x, _eye.z, this.face);
    const a0 = face.sigma > 0 ? c.u0 : -c.u1, a1 = face.sigma > 0 ? c.u1 : -c.u0;
    // a screen pixel's footprint on the glass at the nearest visible point (the main camera's vertical field of view)
    const tanHalf = 1 / Math.max(1e-6, Math.abs(camera.projectionMatrix.elements[5]));
    const pixel = 2 * Math.max(c.near, GLASS_MIRROR.minDistance) * tanHalf / Math.max(1, pass.target.height);
    const win = mirrorWindow(a0, a1, c.y0, c.y1, pixel, Math.min(this.cap[0], target.width), Math.min(this.cap[1], target.height), this.win);
    // (three takes a viewport equal to the drawing buffer's size for "no viewport" = the whole target: never that exact size on a
    // larger target — one more texel row, or column, instead)
    const screen = renderer.getDrawingBufferSize?.(_size);
    if (screen && win.w === screen.x && win.h === screen.y && (win.w < target.width || win.h < target.height)) {
      if (win.h < target.height) { win.h++; win.y0 -= win.texel; } else { win.w++; win.a1 += win.texel; }
    }
    const cam = this.camera;
    // (the reach is a length of the reflected path: the stretch from the eye to the glass is part of it)
    mirrorCameraPose(face, win, _eye.x, _eye.y, _eye.z, Math.max(1, GLASS_MIRROR.reach - face.dist), cam);
    cam.far = Math.min(cam.far, Math.max(cam.near + 1, camera.far));
    cam.layers.mask = camera.layers.mask;
    cam.updateProjectionMatrix();
    // (the pose as position / rotation too, for anything that reads the camera's own transform)
    cam.matrix.copy(cam.matrixWorld);
    cam.matrix.decompose(cam.position, cam.quaternion, cam.scale);
    target.viewport.set(0, 0, win.w, win.h);

    // --- the draw ---
    const lights = this.lightsOf(scene), flags = this.shadowFlags;
    const prevTarget = renderer.getRenderTarget(), prevMRT = renderer.getMRT(), prevFn = renderer.getRenderObjectFunction();
    const ac = renderer.autoClear, acc = renderer.autoClearColor, acd = renderer.autoClearDepth, acs = renderer.autoClearStencil;
    const tm = renderer.toneMapping, cs = renderer.outputColorSpace, tr = renderer.transparent, op = renderer.opaque;
    flags.length = 0;
    for (let i = 0; i < lights.length; i++) { const s = lights[i].shadow; flags.push(s.autoUpdate, s.needsUpdate); s.autoUpdate = false; s.needsUpdate = false; }
    this.stats.drawn = 0; this.stats.skipped = 0;
    this.drawing = true;
    this.filterRenderer = renderer;
    let ok = false;
    try {
      // (the state the real scene pass draws under: RenderPipeline.render sets these around its quad, the PassNode inside it)
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
      renderer.autoClear = true; renderer.autoClearColor = true; renderer.autoClearDepth = true; renderer.autoClearStencil = true;
      if (tr !== undefined) renderer.transparent = true;
      if (op !== undefined) renderer.opaque = true;
      renderer.setRenderObjectFunction(this.filter);
      renderer.setRenderTarget(target);
      renderer.setMRT(null);
      renderAtDepthOffset(renderer, pass.depth, () => renderer.render(scene, cam));
      ok = true;
    } catch (err) {
      this.failed = err instanceof Error ? err.message : String(err);
      console.error('glass mirror: the mirror draw failed; glass keeps the cached probes', err);
    } finally {
      this.drawing = false;
      this.filterRenderer = null;
      renderer.setRenderObjectFunction(prevFn);
      renderer.setRenderTarget(prevTarget);
      renderer.setMRT(prevMRT);
      renderer.toneMapping = tm; renderer.outputColorSpace = cs;
      renderer.autoClear = ac; renderer.autoClearColor = acc; renderer.autoClearDepth = acd; renderer.autoClearStencil = acs;
      if (tr !== undefined) renderer.transparent = tr;
      if (op !== undefined) renderer.opaque = op;
      for (let i = 0; i < lights.length; i++) { const s = lights[i].shadow; s.autoUpdate = flags[i * 2]; s.needsUpdate = flags[i * 2 + 1]; }
    }
    if (!ok) { this.deactivate(); return false; }
    this.stats.renders++;
    // the picture exists: bind it (once per target; every render object re-reads its texture bindings once)
    if (!this.bound || GM.tex.value !== target.texture) { GM.tex.value = target.texture; this.bound = true; refreshTextureBindings(); }
    GM.plane.value.set(face.nx, face.nz, face.d, strength);
    GM.rect.value.set(win.a0, win.y1, 1 / (win.a1 - win.a0), 1 / (win.y1 - win.y0));
    GM.params.value.set(win.w / target.width, win.h / target.height, GLASS_MIRROR.edgeTexels / Math.max(win.w, win.h), GLASS_MIRROR_TUNING.gain);
    return true;
  }

  /** Release the target; glass goes back to the probes (the placeholder is bound again). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.planes = [];
    this.current = null;
    this.strength = 0;
    if (this.target && GM.tex.value === this.target.texture) { this.deactivate(); GM.tex.value = PLACEHOLDER; refreshTextureBindings(); }
    this.bound = false;
    this.target?.dispose();
    this.target = null;
    this.shadowLights = null;
    this.shadowScene = null;
  }

  /** QA read-out. */
  debug(): Record<string, unknown> {
    const t = this.target, w = this.win, active = GM.plane.value.w > 0 && this.bound;
    return {
      planes: this.planes.length, plane: this.current?.id ?? null, strength: +this.strength.toFixed(3), active,
      window: active ? {a: [+w.a0.toFixed(3), +w.a1.toFixed(3)], y: [+w.y0.toFixed(3), +w.y1.toFixed(3)], texel: +w.texel.toFixed(4), size: [w.w, w.h]} : null,
      eyeDistance: active ? +this.face.dist.toFixed(3) : null,
      target: t ? {size: [t.width, t.height], samples: t.samples, matched: this.match} : null, cap: [this.cap[0], this.cap[1]],
      renders: this.stats.renders, idle: this.stats.idle, drawn: this.stats.drawn, skipped: this.stats.skipped, targets: this.stats.targets,
      failed: this.failed, disposed: this.disposed,
    };
  }
}
