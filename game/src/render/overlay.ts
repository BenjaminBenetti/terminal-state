// Iteration 13 (CORE): the first-person overlay (viewmodel scene / camera) on WebGPURenderer.
//
// WebGLRenderer drew the viewmodel straight onto the canvas after `clearDepth()`, tone-mapping each material inline.
// WebGPURenderer instead tone-maps / encodes in a separate output pass over its internal framebuffer target, and a
// node RenderPipeline (the FOG lane's volumetric post-processing) writes the finished frame straight to the canvas,
// bypassing that target. Drawing the overlay through the framebuffer target would therefore composite a stale buffer
// over the fogged frame. So the overlay gets its own target:
//  1. the viewmodel scene renders into `target` (HDR half-float, MSAA like the canvas, own depth; cleared to
//     transparent), never fogged — the depth of the station is irrelevant to it, as with the old depth clear;
//  2. a fullscreen QuadMesh composites it over whatever the frame already holds on the canvas: ACES (the renderer's
//     exposure) + sRGB in its own node, as three's RenderPipeline does, with the renderer's output transform switched
//     off for that draw so no second output pass runs. Premultiplied: opaque / edge pixels are unpremultiplied before
//     tone mapping; light added over EMPTY pixels (the additive muzzle flash, alpha 0) is tone-mapped and added.
// Nothing is drawn (both steps skipped) while the overlay has nothing visible.

import * as THREE from 'three';
import {NodeMaterial, QuadMesh, RenderTarget, type WebGPURenderer} from 'three/webgpu';
import {acesFilmicToneMapping, float, max, sRGBTransferOETF, texture, toneMappingExposure, vec4} from 'three/tsl';

export class OverlayPass {
  readonly target: RenderTarget;
  readonly material: NodeMaterial;
  private readonly quad: QuadMesh;
  private readonly clear = new THREE.Color();
  /** Frames the overlay was composited (QA). */
  draws = 0;

  constructor(samples: number) {
    this.target = new RenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false,
      samples, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.target.texture.name = 'viewmodel-overlay';
    // (three's per-kind TSL typings reject the vec3/vec4 mixing of acesFilmicToneMapping's declared layout; checked at build)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type N = any;
    const s: N = texture(this.target.texture);
    const a: N = s.a.clamp(0, 1);
    const tm = (c: N): N => sRGBTransferOETF(acesFilmicToneMapping(c, toneMappingExposure) as N);
    // premultiplied out: covered pixels tone-map their straight colour (x alpha); empty pixels add their light as is
    const covered: N = tm(s.rgb.div(max(a, float(1e-4)))).mul(a);
    const added: N = tm(s.rgb);
    const m = new NodeMaterial();
    m.name = 'viewmodel-overlay-composite';
    m.fragmentNode = vec4(a.greaterThan(1e-4).select(covered, added), a);
    m.transparent = true;
    // The node output is ALREADY premultiplied (and carries alpha-0 added light): blend One / OneMinusSrcAlpha explicitly.
    // (`premultipliedAlpha = true` would make three multiply rgb by alpha again in the shader, dropping the added light.)
    m.premultipliedAlpha = false;
    m.blending = THREE.CustomBlending;
    m.blendEquation = m.blendEquationAlpha = THREE.AddEquation;
    m.blendSrc = m.blendSrcAlpha = THREE.OneFactor;
    m.blendDst = m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.depthTest = false;
    m.depthWrite = false;
    this.material = m;
    this.quad = new QuadMesh(m);
    this.quad.name = 'viewmodel-overlay';
  }

  /** Drawing-buffer size (renderer.getDrawingBufferSize). */
  setSize(w: number, h: number): void {
    this.target.setSize(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
  }

  /** True when `root` has any visible mesh (a hidden / holstered viewmodel costs nothing). */
  static hasVisible(root: THREE.Object3D): boolean {
    let any = false;
    root.traverseVisible(o => { if (!any && (o as THREE.Mesh).isMesh) any = true; });
    return any;
  }

  /** Render `scene` with `camera` into the overlay target and composite it over the current canvas frame. */
  render(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clear);
    const autoClear = renderer.autoClear;
    const toneMapping = renderer.toneMapping, colorSpace = renderer.outputColorSpace;
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true; // one pass: cleared to transparent + own depth
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.toneMapping = THREE.NoToneMapping; // the composite node tone-maps / encodes itself
      renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
      this.quad.render(renderer);
      this.draws++;
    } finally {
      renderer.toneMapping = toneMapping;
      renderer.outputColorSpace = colorSpace;
      renderer.autoClear = autoClear;
      renderer.setClearColor(this.clear, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    }
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
