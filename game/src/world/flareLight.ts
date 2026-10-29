// Iteration 15 (primary): the burning flare's light, occluded like its fog glow.
//
// User: "for the flare I really want the flare to have a very strong red light ... really light up an area". A plain
// unshadowed PointLight lights every surface within its cutoff, walls and slabs included, so a strong flare would paint
// the next room red. The fog march already knows where a flare can see: the atmosphere computes, per scatter light, a
// 24 m occlusion window (render/smoke.ts computeVisWindow: 2D line of sight on the flare's storey grid + its floor /
// ceiling band), uploaded as one layer of a shared DataArrayTexture. FlareLight carries that window; FlareLightNode (a
// three r186 PointLightNode registered for FlareLight in the renderer's node library) multiplies the light's direct
// colour by the SAME lookup the march uses, so surfaces behind a wall / on another storey stay dark while everything the
// flare sees is lit. No shadow map (a point shadow is six extra passes per flare). A FlareLight without a window yet
// (layer -1: atmosphere off / not computed) lights like a plain PointLight, as before.
//
// The pooled flare lights stay in the scene at intensity 0 when free (the light set never changes: no recompiles), and the
// node is registered before the first compile (Game.initRenderer), so the loading-screen warm-up builds it.

import * as THREE from 'three';
import {PointLightNode, type Node, type NodeBuilder, type NodeFrame} from 'three/webgpu';
import {clamp, float, int, max, positionWorld, renderGroup, select, smoothstep, texture, uniform} from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const n = (x: unknown): N => x;

/** A flare's light: a PointLight plus the occlusion window the atmosphere computes for it each time it moves. */
export class FlareLight extends THREE.PointLight {
  readonly isFlareLight = true;
  /** (x0, z0, 1 / window size in m, texture layer); layer < 0 = no window (unoccluded). */
  readonly window = new THREE.Vector4(0, 0, 1, -1);
  /** (floor, ceil) of the flare's storey band. */
  readonly band = new THREE.Vector2(-1e3, 1e3);

  /** Window lost (atmosphere inactive, flare out): light without occlusion, as a plain PointLight. */
  clearWindow(): void {
    this.window.set(0, 0, 1, -1);
    this.band.set(-1e3, 1e3);
  }
}

export const isFlareLight = (l: unknown): l is FlareLight => !!(l as {isFlareLight?: boolean} | null)?.isFlareLight;

const placeholder = (() => {
  const t = new THREE.DataArrayTexture(new Uint8Array([255]), 1, 1, 1);
  t.format = THREE.RedFormat;
  t.needsUpdate = true;
  return t;
})();

/** The shared occlusion-window texture (the atmosphere binds its own; a 1x1 'visible' placeholder before). */
export const FLARE_VIS = texture(placeholder);

/** Bind the atmosphere's window texture (render/volumetric.ts); null restores the placeholder. */
export function bindFlareVisibility(tex: THREE.DataArrayTexture | null): void {
  (FLARE_VIS as unknown as {value: THREE.Texture}).value = tex ?? placeholder;
}

/**
 * The march's window lookup (render/volumetricShaders.ts createMarchMaterial windowAt), for one window: 1 without a
 * window, the line-of-sight cell x the storey band inside it, 0 outside it.
 */
export function flareVisibility(p: Node, win: Node, band: Node): Node {
  const wn = n(win), wy = n(band);
  const wuv = n(p).xz.sub(wn.xy).mul(wn.z).toVar();
  const inside = wuv.x.greaterThanEqual(0).and(wuv.y.greaterThanEqual(0)).and(wuv.x.lessThanEqual(1)).and(wuv.y.lessThanEqual(1));
  const bandK = smoothstep(wy.x.sub(0.35), wy.x.add(0.05), n(p).y).mul(float(1).sub(smoothstep(wy.y.sub(0.05), wy.y.add(0.35), n(p).y)));
  const v = n(n(FLARE_VIS).sample(clamp(wuv, 0, 1)).depth(int(max(wn.w, 0))).level(0)).r;
  // materialised (GLSL ternary precedence inside uniformFlow, see lanes/mata.notes)
  return select(wn.w.lessThan(0), float(1), select(inside, n(v).mul(bandK), float(0))).toVar() as unknown as Node;
}

/** CPU mirror of flareVisibility for tests / QA (`vis(i, j)` = the window cell, 0..1). */
export function flareVisibilityCpu(p: readonly [number, number, number], win: THREE.Vector4, band: THREE.Vector2, vis: (u: number, v: number) => number): number {
  if (win.w < 0) return 1;
  const u = (p[0] - win.x) * win.z, v = (p[2] - win.y) * win.z;
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const k = ss(band.x - 0.35, band.x + 0.05, p[1]) * (1 - ss(band.y - 0.05, band.y + 0.35, p[1]));
  return vis(u, v) * k;
}

interface DirectLight { lightDirection: Node; lightColor: Node }

/** PointLightNode whose direct colour is multiplied by the flare's occlusion window. */
export class FlareLightNode extends PointLightNode {
  static get type(): string {
    return 'FlareLightNode';
  }

  readonly winNode = uniform(new THREE.Vector4(0, 0, 1, -1)).setGroup(renderGroup);
  readonly bandNode = uniform(new THREE.Vector2(-1e3, 1e3)).setGroup(renderGroup);

  update(frame: NodeFrame): boolean | undefined {
    const r = (PointLightNode.prototype as unknown as {update(f: NodeFrame): boolean | undefined}).update.call(this, frame);
    const l = (this as unknown as {light: FlareLight}).light;
    (this.winNode.value as THREE.Vector4).copy(l.window);
    (this.bandNode.value as THREE.Vector2).copy(l.band);
    return r;
  }

  setupDirect(builder: NodeBuilder): DirectLight {
    const d = (PointLightNode.prototype as unknown as {setupDirect(b: NodeBuilder): DirectLight}).setupDirect.call(this, builder);
    return {lightDirection: d.lightDirection, lightColor: n(d.lightColor).mul(flareVisibility(positionWorld, this.winNode as unknown as Node, this.bandNode as unknown as Node))};
  }
}

interface NodeLibraryLike { getLightNodeClass(light: unknown): unknown; addLight(node: unknown, light: unknown): void }

/** Register FlareLightNode for FlareLight in a WebGPURenderer's node library (idempotent). False without one. */
export function installFlareLightNode(renderer: {library?: unknown} | null | undefined): boolean {
  const lib = renderer?.library as NodeLibraryLike | undefined;
  if (!lib || typeof lib.addLight !== 'function' || typeof lib.getLightNodeClass !== 'function') return false;
  if (lib.getLightNodeClass(FlareLight) === FlareLightNode) return true;
  lib.addLight(FlareLightNode, FlareLight);
  return true;
}
