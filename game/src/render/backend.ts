// Iteration 13 (CORE): renderer backend selection, initialization, diagnostics and the backend indicator.
//
// The game renders through three r186's `WebGPURenderer` (three/webgpu). It targets the WebGPU backend whenever the
// browser exposes `navigator.gpu` AND yields an adapter + device; otherwise the SAME renderer falls back to its built-in
// WebGL 2 backend (three's WebGLBackend). `?renderer=webgl2` forces that fallback for testing.
//
// What actually runs is read from the initialized renderer's backend object (`backend.isWebGPUBackend` /
// `isWebGLBackend`), never inferred from `navigator.gpu`: a renderer that fell back is reported as
// `webgl2-fallback` with the reason (forced, no navigator.gpu, no adapter, device request failed). The indicator text
// ("Renderer: WebGPU" / "Renderer: WebGL2 (fallback — …)") is shown on the title / pause screens and as a tiny HUD tag,
// and is exposed to QA as `__LL.gpu()` / `__LL.snapshot().gpu`.
//
// Device loss and uncaptured GPU / shader errors are recorded (bounded) and surfaced, never swallowed: a lost device
// shows the error overlay (main.ts) and rendering stops.

import {WebGPURenderer} from 'three/webgpu';

export type GpuBackendKind = 'webgpu' | 'webgl2-fallback';

export interface GpuAdapterSummary {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  /** GPUAdapterInfo.isFallbackAdapter (a software / CPU WebGPU adapter); null when the browser does not report it. */
  isFallbackAdapter: boolean | null;
}

export interface GpuInfo {
  backend: GpuBackendKind;
  /** WebGPU adapter info of the device the renderer created (GPUDevice.adapterInfo); null on the WebGL 2 backend or when unreported. */
  adapter: GpuAdapterSummary | null;
  /** Why the WebGL 2 fallback runs (null on WebGPU). */
  reason: string | null;
  /** 'webgl2' with ?renderer=webgl2, else 'auto' (WebGPU first). */
  requested: 'auto' | 'webgl2';
  /** The browser exposes navigator.gpu (says nothing about whether an adapter exists). */
  webgpuApi: boolean;
  /** WebGL 2 backend: the (unmasked when exposed) GL renderer string; null on WebGPU. */
  glRenderer: string | null;
  /** WebGPU backend: the device lacks 'core-features-and-limits' (compatibility mode: no MSAA in three). */
  compatibilityMode: boolean | null;
  /** Indicator text, e.g. "Renderer: WebGPU" / "Renderer: WebGL2 (fallback — WebGPU unavailable: …)". */
  label: string;
  /** Device / context loss message once it happened (rendering stops). */
  deviceLost: string | null;
  /** Uncaptured GPU errors and shader compile/link errors seen so far (bounded, newest last). */
  errors: string[];
}

export interface RendererRequest {
  requested: 'auto' | 'webgl2';
  forceWebGL: boolean;
  webgpuApi: boolean;
  secure: boolean;
}

/** URL + environment -> what to ask the renderer for (`?renderer=webgl2` forces the fallback). */
export function rendererRequest(search: string, nav: {gpu?: unknown} | undefined, secure: boolean): RendererRequest {
  const v = new URLSearchParams(search).get('renderer')?.toLowerCase() ?? '';
  const forceWebGL = v === 'webgl2' || v === 'webgl';
  return {requested: forceWebGL ? 'webgl2' : 'auto', forceWebGL, webgpuApi: !!nav && nav.gpu !== undefined && nav.gpu !== null, secure};
}

const message = (e: unknown): string => String((e as {message?: unknown})?.message ?? e ?? '').trim();

/** Human reason for the WebGL 2 fallback (forced, no API, no adapter, device failure). */
export function fallbackReason(req: RendererRequest, error: unknown): string {
  if (req.forceWebGL) return 'forced by ?renderer=webgl2';
  if (!req.webgpuApi) return req.secure ? 'WebGPU unavailable: this browser exposes no navigator.gpu' : 'WebGPU unavailable: navigator.gpu needs a secure context (https or localhost)';
  const m = message(error);
  if (/unable to create webgpu adapter/i.test(m)) return 'WebGPU unavailable: no WebGPU adapter (requestAdapter returned null)';
  return `WebGPU unavailable: device initialization failed${m ? ` (${m.slice(0, 160)})` : ''}`;
}

/** The structural part of a three backend this module reads (WebGPUBackend / WebGLBackend). */
export interface BackendLike {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  compatibilityMode?: boolean;
  device?: {adapterInfo?: Partial<Record<'vendor' | 'architecture' | 'device' | 'description', string>> & {isFallbackAdapter?: boolean}; limits?: {maxTextureDimension3D?: number}} | null;
  gl?: WebGL2RenderingContext | null;
}

export function adapterSummary(backend: BackendLike): GpuAdapterSummary | null {
  const a = backend.isWebGPUBackend ? backend.device?.adapterInfo : undefined;
  if (!a) return null;
  return {vendor: a.vendor ?? '', architecture: a.architecture ?? '', device: a.device ?? '', description: a.description ?? '',
    isFallbackAdapter: typeof a.isFallbackAdapter === 'boolean' ? a.isFallbackAdapter : null};
}

/** Unmasked GL renderer string when exposed (WEBGL_debug_renderer_info), else RENDERER; '' when unreadable. */
export function glRendererString(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): string {
  if (!gl) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof s === 'string' ? s : '';
  } catch {
    return '';
  }
}

/** Indicator text for a backend (the same string the title / pause badge and HUD tag show). */
export function backendLabel(g: Pick<GpuInfo, 'backend' | 'reason' | 'adapter'>): string {
  if (g.backend === 'webgpu') return g.adapter?.isFallbackAdapter ? 'Renderer: WebGPU (software fallback adapter)' : 'Renderer: WebGPU';
  return `Renderer: WebGL2 (fallback — ${g.reason ?? 'WebGPU unavailable'})`;
}

/** Short HUD tag ("WebGPU" / "WebGL2 fallback"). */
export function backendTag(g: Pick<GpuInfo, 'backend' | 'adapter'>): string {
  return g.backend === 'webgpu' ? (g.adapter?.isFallbackAdapter ? 'WebGPU (sw)' : 'WebGPU') : 'WebGL2 fallback';
}

/** What the initialized renderer actually runs, read from its backend object. */
export function describeBackend(backend: BackendLike, req: RendererRequest, fallbackError: unknown): GpuInfo {
  const webgpu = backend.isWebGPUBackend === true;
  if (!webgpu && backend.isWebGLBackend !== true) throw new Error('renderer backend is neither WebGPU nor WebGL 2');
  const adapter = webgpu ? adapterSummary(backend) : null;
  const reason = webgpu ? null : fallbackReason(req, fallbackError);
  const g: GpuInfo = {
    backend: webgpu ? 'webgpu' : 'webgl2-fallback', adapter, reason, requested: req.requested, webgpuApi: req.webgpuApi,
    glRenderer: webgpu ? null : glRendererString(backend.gl) || null, compatibilityMode: webgpu ? backend.compatibilityMode === true : null,
    label: '', deviceLost: null, errors: [],
  };
  g.label = backendLabel(g);
  return g;
}

const MAX_ERRORS = 24;
export function recordGpuError(g: GpuInfo, text: string): void {
  g.errors.push(text.slice(0, 600));
  if (g.errors.length > MAX_ERRORS) g.errors.splice(0, g.errors.length - MAX_ERRORS);
}

/** Renderer + the error that made it fall back (captured from three's fallback hook). */
export interface GameRenderer {
  renderer: WebGPURenderer;
  request: RendererRequest;
  fallbackError(): unknown;
}

/** Same options as the WebGLRenderer before (antialias, high-performance); opaque canvas like WebGLRenderer's default. */
export function createGameRenderer(canvas: HTMLCanvasElement, req: RendererRequest): GameRenderer {
  const renderer = new WebGPURenderer({canvas, antialias: true, powerPreference: 'high-performance', alpha: false, forceWebGL: req.forceWebGL});
  // three's WebGPURenderer passes the WebGPU init error to its fallback hook (and only logs a generic warning); wrap the
  // hook so the actual reason (no adapter / device failure) reaches the indicator.
  let fallbackError: unknown = null;
  const r = renderer as unknown as {_getFallback: ((e: unknown) => unknown) | null};
  const inner = r._getFallback;
  if (typeof inner === 'function') r._getFallback = (e: unknown) => { fallbackError = e ?? new Error('unknown WebGPU init failure'); return inner(e); };
  return {renderer, request: req, fallbackError: () => fallbackError};
}

export interface DeviceWatch {
  /** Called once when the device / WebGL context is lost (after three marks the renderer lost). */
  onLost: (text: string) => void;
}

/** Device-lost + uncaptured-error + shader-error reporting into `g` (logged as three does; never silenced). */
export function watchDevice(renderer: WebGPURenderer, g: GpuInfo, w: DeviceWatch): void {
  const r = renderer as unknown as {
    onDeviceLost: (info: {api: string; message: string; reason?: string | null}) => void;
    _onDeviceLost: (info: {api: string; message: string; reason?: string | null}) => void;
    onError: (info: {api?: string; type?: string; message?: string} | string) => void;
    _onError: (info: unknown) => void;
    debug: {onShaderError: ((gl: WebGL2RenderingContext, program: WebGLProgram, vs: WebGLShader, fs: WebGLShader) => void) | null};
  };
  r.onDeviceLost = info => {
    r._onDeviceLost.call(renderer, info); // logs + sets _isDeviceLost (no further rendering)
    if (g.deviceLost) return;
    g.deviceLost = `${info.api} device lost: ${info.message}${info.reason ? ` (${info.reason})` : ''}`;
    w.onLost(g.deviceLost);
  };
  r.onError = info => {
    r._onError.call(renderer, info);
    recordGpuError(g, typeof info === 'string' ? info : `${info.api ?? 'GPU'} ${info.type ?? 'error'}: ${info.message ?? ''}`);
  };
  if (g.backend === 'webgl2-fallback' && !r.debug.onShaderError) {
    // three's WebGL backend logs program errors itself only when no handler is set: log the same and record them.
    r.debug.onShaderError = (gl, program, vs, fs) => {
      const text = `WebGL2 program error: ${gl.getProgramInfoLog(program) ?? ''} ${gl.getShaderInfoLog(vs) ?? ''} ${gl.getShaderInfoLog(fs) ?? ''}`.replace(/\s+/g, ' ').trim();
      console.error('THREE.WebGLBackend: shader error', gl.getProgramInfoLog(program), '\nvertex:', gl.getShaderInfoLog(vs), '\nfragment:', gl.getShaderInfoLog(fs));
      recordGpuError(g, text);
    };
  }
}

/** Largest 3D texture edge the backend supports (light field / volumes); conservative 256 when unreadable. */
export function maxTexture3DSize(backend: BackendLike): number {
  if (backend.isWebGPUBackend) return backend.device?.limits?.maxTextureDimension3D ?? 256;
  const gl = backend.gl;
  try {
    const v = gl ? gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) : null;
    return typeof v === 'number' && v > 0 ? v : 256;
  } catch {
    return 256;
  }
}

/** renderer.info.render in the pre-WebGPU QA shape: `calls` = draw calls this frame (three r186: `drawCalls`). */
export function renderStats(info: {render: {calls: number; frameCalls: number; drawCalls: number; triangles: number; points: number; lines: number}}) {
  const r = info.render;
  return {calls: r.drawCalls, drawCalls: r.drawCalls, triangles: r.triangles, points: r.points, lines: r.lines, passes: r.frameCalls, renderCallsTotal: r.calls};
}

// ---------------------------------------------------------------------------------------------
// Indicator (DOM)

const BADGE_CSS = `
.gpu-badge { position: absolute; left: 14px; bottom: 10px; max-width: min(720px, 70vw); font-size: 11px; line-height: 1.35; letter-spacing: 0.04em; color: var(--cream-dim, #b9b19c); background: rgba(12, 13, 14, 0.66); border-left: 3px solid var(--teal, #4f8a87); padding: 4px 9px; pointer-events: auto; z-index: 21; }
.gpu-badge.fallback { border-left-color: var(--mustard, #d9a520); }
.gpu-badge.lost { border-left-color: var(--red, #c2463a); color: var(--cream, #ece4cf); }
#gpu-tag { position: absolute; left: 22px; bottom: 5px; font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cream-dim, #b9b19c); opacity: 0.7; pointer-events: none; }
#gpu-tag.fallback { color: var(--mustard, #d9a520); }
`;

function adapterTitle(g: GpuInfo): string {
  const a = g.adapter;
  const parts = g.backend === 'webgpu'
    ? [a ? [a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' · ') || 'adapter info not reported' : 'adapter info not reported', a?.isFallbackAdapter ? 'software (fallback) adapter' : '', g.compatibilityMode ? 'compatibility mode' : '']
    : [g.glRenderer ?? 'GL renderer string not exposed'];
  return parts.filter(Boolean).join(' — ');
}

/** Title / pause badge (bottom-left) + tiny HUD tag; idempotent (updates the text when called again, e.g. after a loss). */
export function installBackendIndicator(doc: Document, g: GpuInfo): void {
  if (!doc.getElementById('gpu-badge-css')) {
    const st = doc.createElement('style');
    st.id = 'gpu-badge-css';
    st.textContent = BADGE_CSS;
    doc.head.appendChild(st);
  }
  const text = g.deviceLost ? `${g.label} — DEVICE LOST` : g.label;
  const cls = g.deviceLost ? 'lost' : g.backend === 'webgpu' ? 'webgpu' : 'fallback';
  for (const id of ['title', 'pause']) {
    const host = doc.getElementById(id);
    if (!host) continue;
    let el = host.querySelector<HTMLElement>(':scope > .gpu-badge');
    if (!el) { el = doc.createElement('div'); host.appendChild(el); }
    el.className = `gpu-badge ${cls}`;
    el.dataset.backend = g.backend;
    el.textContent = text;
    el.title = adapterTitle(g);
  }
  const hud = doc.getElementById('hud');
  if (hud) {
    let tag = doc.getElementById('gpu-tag');
    if (!tag) { tag = doc.createElement('div'); tag.id = 'gpu-tag'; hud.appendChild(tag); }
    tag.className = cls;
    tag.dataset.backend = g.backend;
    tag.textContent = backendTag(g);
  }
}
