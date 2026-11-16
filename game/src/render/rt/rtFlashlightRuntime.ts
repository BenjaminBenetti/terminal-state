// Task studio-rt-flashlight-compute-20261115-233136-01: the RT FLASHLIGHT runtime — one per session on a WebGPU renderer whose probe
// passed (render/rt/rtGpu.ts). It owns the station's traced scene (render/rt/rtScene.ts: the two-level BVH of the station's real
// geometry, the moving props' current poses, the characters' capsules) and the device resources, and each frame (Game.drawFrame,
// inside the scene-matrix scope, before the glass mirror and the scene pass) turns the player's flashlight into this frame's traced
// bounce: rtKernels.ts' six dispatches, then rtBounceNode.ts' uniforms so the RT light variant's materials read it.
//
// Active only while a station's lighting uses the RT variant (StationLighting.rt) and the flashlight is lit: otherwise the gate
// (RTB.cam.w) is 0 — the materials' lookup adds exactly nothing — and nothing is dispatched. The history restarts (no reprojection)
// after a frame without a dispatch, a new station, a resize of the receiver grid, and a jump of the camera.
//
// Temporal blend floor (params2.x): RT_ALPHA.base, raised by how far the beam turned (rad) and the light moved (m) since the last frame,
// so a fast aim sweep follows within a frame or two; the history is also clamped to this frame's neighbourhood and rejected where the
// surface differs (rtKernels.ts TEMPORAL).

import * as THREE from 'three';
import {FB} from '../../world/flashBounce';
import {RT_TOLERANCE, RTB} from '../../world/rtBounceNode';
import {makeRtCone, type RtCone} from './rtCone';
import {RtGpu, rtFrameBlock, rtGridSize, type RtGpuStats, type RtProbe, type RtFrameBlock} from './rtGpu';
import type {RtScene} from './rtScene';
import {VPL_COUNT, VPL_GRID} from './rtKernels';

/** The temporal blend: the floor, its rise per radian the beam turned and per metre the light moved in one frame. */
export const RT_ALPHA = {base: 0.12, perRad: 8, perMetre: 1.5} as const;
/** A camera that moved farther than this (m) in one frame jumped (spawn, teleport, a load): the history restarts. */
export const RT_CAMERA_JUMP = 2.5;
/** Frames after a new scene whose device work is checked inside error scopes. */
export const RT_CHECKED_FRAMES = 3;
/** The primary rays' reach (m): beyond it no receiver (the bounce's own range window ends far nearer). */
export const RT_RECEIVER_REACH = 60;
/** The shadow ray's offset off the receiver (m), grown with the distance from the eye (rtKernels.ts GATHER). */
export const RT_RAY_EPS = 0.02;
/** The receivers' plane tolerance (m) for history and filtering, grown with the distance from the eye. */
export const RT_PLANE_TOL = 0.05;

/** The traced scene as the runtime drives it (render/rt/rtScene.ts RtScene). */
export type RtSceneLike = Pick<RtScene, 'sync' | 'buffers'>;

/** Main-thread ms a frame's scene sync may spend building the BLAS of meshes that appeared (render/rt/rtScene.ts). */
export const RT_SYNC_BUDGET_MS = 2;

export interface RtFlashlightStats {
  /** Frames dispatched this session / skipped (torch off, no scene). */
  dispatched: number;
  skipped: number;
  /** The receiver grid in use. */
  grid: {w: number; h: number};
  /** Rays per dispatched frame: light, primary, shadow (upper bound: two per receiver that a VPL reaches). */
  rays: {light: number; primary: number; shadowMax: number};
  /** The last frame's CPU time (ms): scene sync, upload + encode + submit. */
  syncMs: number;
  encodeMs: number;
  /** The last temporal floor and why the history last restarted. */
  alpha: number;
  historyReset: string | null;
  gpu: RtGpuStats;
}

const _v = new THREE.Vector3();

/** The traced bounce of one renderer (see the module doc). */
export class RtFlashlight {
  readonly gpu: RtGpu;
  private scene: RtSceneLike | null = null;
  private cone: RtCone | null = null;
  private readonly block: RtFrameBlock = rtFrameBlock();
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly viewProj = new THREE.Matrix4();
  private prevValid = false;
  private prevGrid = {w: 0, h: 0};
  private readonly prevEye = new THREE.Vector3();
  private readonly prevLight = new THREE.Vector3();
  private readonly prevAxis = new THREE.Vector3(0, 0, -1);
  private frameIndex = 0;
  readonly stats: RtFlashlightStats;

  constructor(renderer: ConstructorParameters<typeof RtGpu>[0], probe: RtProbe) {
    this.gpu = new RtGpu(renderer, probe);
    this.stats = {dispatched: 0, skipped: 0, grid: {w: 0, h: 0}, rays: {light: 0, primary: 0, shadowMax: 0}, syncMs: 0, encodeMs: 0, alpha: RT_ALPHA.base, historyReset: 'start', gpu: this.gpu.stats};
  }

  /**
   * The station's traced scene (null: none — nothing is dispatched and every device resource is released, the materials' lookup back
   * on the zero placeholders). A new scene restarts the history; its first frames are dispatched inside error scopes (a device error
   * = the traced bounce fails: `failure`, `onFailure`).
   */
  setScene(scene: RtSceneLike | null): void {
    this.scene = scene;
    this.invalidate('scene');
    RTB.cam.value.w = 0;
    if (scene && !this.failure) { this.gpu.alloc(); this.checks = RT_CHECKED_FRAMES; } else this.gpu.free();
  }

  /** Why the traced bounce stopped for the session (a device error in its own work), null while it works. */
  failure: string | null = null;
  /** Told once when it fails (Game: the station falls back to the standard bounce at the next lighting change). */
  onFailure: ((reason: string) => void) | null = null;
  private checks = 0;

  /** Stop the traced bounce for the session (see `failure`). */
  failWith(reason: string): void {
    if (this.failure) return;
    this.failure = reason;
    this.scene = null;
    RTB.cam.value.w = 0;
    this.gpu.free();
    this.onFailure?.(reason);
  }

  get hasScene(): boolean { return this.scene !== null; }

  /** Forget the history (the next frame starts from its own samples). */
  invalidate(why: string): void {
    this.prevValid = false;
    this.stats.historyReset = why;
  }

  /** Nothing traced this frame: the gate closes (the materials add zero) and the history restarts at the next dispatch. */
  skip(why = 'off'): void {
    RTB.cam.value.w = 0;
    if (this.prevValid) this.invalidate(why);
    this.stats.skipped++;
  }

  /**
   * One frame: `spot` the player's flashlight as three shades it, `camera` the main camera (matrices current), the drawing buffer's
   * size (px), this frame's characters (render/../world/flashOccluders.ts StationFlashOccluders.bodies / bodyCount). Returns whether
   * the traced bounce is bound for this frame's draws.
   */
  frame(nowSeconds: number, spot: THREE.SpotLight, camera: THREE.PerspectiveCamera, drawW: number, drawH: number, bodies: Float32Array | null, bodyCount: number): boolean {
    const scene = this.scene;
    if (!scene || !this.gpu.allocated || !(spot.intensity > 0) || !spot.visible) { this.skip(!scene ? 'no scene' : 'flashlight off'); return false; }
    const t0 = performance.now();
    scene.sync(nowSeconds, bodies, bodyCount, RT_SYNC_BUDGET_MS);
    const t1 = performance.now();
    const checked = this.checks > 0;
    if (checked) { this.checks--; this.gpu.device.pushErrorScope('validation'); this.gpu.device.pushErrorScope('out-of-memory'); }
    this.gpu.upload(scene.buffers);
    if (!this.cone || this.cone.angle !== spot.angle || this.cone.penumbra !== spot.penumbra) this.cone = makeRtCone(spot.angle, spot.penumbra);
    // (written to every allocation: one made after a free — the next station, a relight back to RT — starts as zeros)
    if (this.gpu.coneTable !== this.cone.dirs) this.gpu.writeCone(this.cone.dirs);

    const f = this.block.f32, u = this.block.u32;
    // the camera: eye, the ray basis (x tan of the half fields, the projection's shift folded into the forward), the reach
    camera.updateMatrixWorld();
    const cm = camera.matrixWorld.elements, P = camera.projectionMatrix.elements;
    const ex = cm[12], ey = cm[13], ez = cm[14];
    const rx = cm[0], ry = cm[1], rz = cm[2], ux = cm[4], uy = cm[5], uz = cm[6], fx = -cm[8], fy = -cm[9], fz = -cm[10];
    const rl = Math.hypot(rx, ry, rz) || 1, ul = Math.hypot(ux, uy, uz) || 1, fl = Math.hypot(fx, fy, fz) || 1;
    const sx = 1 / (P[0] || 1), sy = 1 / (P[5] || 1), ox = -P[8] * sx, oy = -P[9] * sy;
    f[0] = ex; f[1] = ey; f[2] = ez; f[3] = 0;
    f[4] = rx / rl * sx; f[5] = ry / rl * sx; f[6] = rz / rl * sx; f[7] = 0;
    f[8] = ux / ul * sy; f[9] = uy / ul * sy; f[10] = uz / ul * sy; f[11] = 0;
    f[12] = fx / fl + rx / rl * ox + ux / ul * oy; f[13] = fy / fl + ry / rl * ox + uy / ul * oy; f[14] = fz / fl + rz / rl * ox + uz / ul * oy;
    f[15] = Math.min(camera.far, RT_RECEIVER_REACH);
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    // the light: origin, axis toward its target, the two axes across the beam (flashBounce.ts: the light's own world x, its y when
    // the beam runs along that), three's falloff and the ray's share
    spot.updateWorldMatrix(true, false);
    spot.target.updateWorldMatrix(true, false);
    const m = spot.matrixWorld.elements, tm = spot.target.matrixWorld.elements;
    const lx = m[12], ly = m[13], lz = m[14];
    const axis = _v.set(tm[12] - lx, tm[13] - ly, tm[14] - lz);
    if (!(axis.lengthSq() > 1e-18)) { this.skip('no beam'); return false; }
    axis.normalize();
    let bx = m[0], by = m[1], bz = m[2];
    let k = axis.x * bx + axis.y * by + axis.z * bz;
    bx -= axis.x * k; by -= axis.y * k; bz -= axis.z * k;
    let bl = Math.hypot(bx, by, bz);
    if (!(bl > 1e-4 * Math.hypot(m[0], m[1], m[2]))) {
      bx = m[4]; by = m[5]; bz = m[6];
      k = axis.x * bx + axis.y * by + axis.z * bz;
      bx -= axis.x * k; by -= axis.y * k; bz -= axis.z * k;
      bl = Math.hypot(bx, by, bz);
      if (!(bl > 0)) { this.skip('no beam'); return false; }
    }
    bx /= bl; by /= bl; bz /= bl;
    const vx = axis.y * bz - axis.z * by, vy = axis.z * bx - axis.x * bz, vz = axis.x * by - axis.y * bx;
    const near = Math.max(0.02, spot.shadow?.camera?.near ?? 0.2);
    const cutoff = spot.distance > 0 ? spot.distance : 0;
    const share = this.cone.weight / Math.PI;
    f[32] = lx; f[33] = ly; f[34] = lz; f[35] = near;
    f[36] = axis.x; f[37] = axis.y; f[38] = axis.z; f[39] = cutoff;
    f[40] = bx; f[41] = by; f[42] = bz; f[43] = spot.decay;
    f[44] = vx; f[45] = vy; f[46] = vz; f[47] = share;
    const I = spot.intensity, c = spot.color;
    f[48] = c.r * I; f[49] = c.g * I; f[50] = c.b * I; f[51] = cutoff > 0 ? cutoff : RT_RECEIVER_REACH;
    // the bounce's own constants are the virtual-light bounce's (FB.params: gain, r0min, range; flashBounce.ts soft = 1)
    const fb = FB.params.value;
    f[52] = fb.x; f[53] = fb.z; f[54] = fb.y * fb.y; f[55] = 1 / Math.PI;

    // the receiver grid, the history's validity and the temporal floor
    const grid = rtGridSize(drawW, drawH);
    if (grid.w !== this.prevGrid.w || grid.h !== this.prevGrid.h) { if (this.prevValid) this.invalidate('resize'); }
    if (this.prevValid && Math.hypot(ex - this.prevEye.x, ey - this.prevEye.y, ez - this.prevEye.z) > RT_CAMERA_JUMP) this.invalidate('camera jump');
    const turned = this.prevValid ? Math.acos(Math.min(1, Math.max(-1, this.prevAxis.dot(axis)))) : 0;
    const moved = this.prevValid ? Math.hypot(lx - this.prevLight.x, ly - this.prevLight.y, lz - this.prevLight.z) : 0;
    const alpha = Math.min(1, RT_ALPHA.base + RT_ALPHA.perRad * turned + RT_ALPHA.perMetre * moved);
    f[56] = alpha; f[57] = RT_RAY_EPS; f[58] = this.prevValid ? 1 : 0; f[59] = RT_PLANE_TOL;
    const prev = this.prevValid ? this.prevViewProj : this.viewProj;
    f.set(prev.elements, 16);

    const r = scene.buffers.layout;
    u[60] = r.staticNodes; u[61] = r.staticNodeCount; u[62] = r.dynamicNodes; u[63] = r.dynamicNodeCount;
    u[64] = r.instances; u[65] = r.materials; u[66] = 1; u[67] = VPL_COUNT;
    u[68] = grid.w; u[69] = grid.h; u[70] = this.prevValid ? this.prevGrid.w : grid.w; u[71] = this.prevValid ? this.prevGrid.h : grid.h;
    u[72] = this.frameIndex++ >>> 0; u[73] = this.frameIndex & 1; u[74] = 0; u[75] = 0;

    const sent = this.gpu.dispatch(this.block);
    if (checked) {
      const d = this.gpu.device;
      const report = (e: GPUError | null): void => { if (e) this.failWith(`its compute work failed on this device (${String(e.message).slice(0, 160)})`); };
      d.popErrorScope().then(report, () => undefined);
      d.popErrorScope().then(report, () => undefined);
    }
    if (!sent) { this.skip('not uploaded'); return false; }

    // what the materials read this frame
    RTB.viewProj.value.copy(this.viewProj);
    RTB.cam.value.set(ex, ey, ez, 1);
    RTB.grid.value.set(grid.w, grid.h, RT_TOLERANCE.base, RT_TOLERANCE.perMetre);

    this.prevViewProj.copy(this.viewProj);
    this.prevGrid = grid;
    this.prevEye.set(ex, ey, ez);
    this.prevLight.set(lx, ly, lz);
    this.prevAxis.copy(axis);
    this.prevValid = true;
    const st = this.stats;
    st.dispatched++;
    st.grid = grid;
    st.rays.light = VPL_COUNT; st.rays.primary = grid.w * grid.h; st.rays.shadowMax = 2 * grid.w * grid.h;
    st.syncMs = t1 - t0;
    st.encodeMs = performance.now() - t1;
    st.alpha = alpha;
    return true;
  }

  /** Release the device resources (the materials' lookup back on the zero placeholders). */
  dispose(): void {
    this.scene = null;
    RTB.cam.value.w = 0;
    this.gpu.free();
  }
}

/** The light grid's stratum of light ray i (rtKernels.ts GATHER: the split axis alternates per frame). */
export const rtStratum = (i: number, odd: boolean): number => odd ? (Math.floor(i / VPL_GRID) >= VPL_GRID / 2 ? 1 : 0) : (i % VPL_GRID >= VPL_GRID / 2 ? 1 : 0);
