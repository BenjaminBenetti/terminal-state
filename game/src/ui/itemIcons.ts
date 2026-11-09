// Item icons rendered from the actual runtime 3D models (iteration 04, user feedback #6): the
// rifle / shotgun derivatives, the generated food & drink models (models.item_*), and the
// procedural ammo / med kit / bandage models — exactly the objects the world and the hands show
// (world/pickups.ts makeSupplyMesh, the gun GLTF scenes).
//
// Method: ONCE at load, reusing the game's renderer (no extra context / device, no renderer per
// slot): one offscreen multisampled render target, one small icon scene with fixed product
// lighting, one camera at a consistent 3/4 product angle (guns: near side-on, muzzle right;
// items: front three-quarter from above). Each model is normalised, the projection is fitted to
// its projected vertices, rendered, read back and converted to
// straight-alpha sRGB with the same ACES filmic curve as the game renderer, then cached as a PNG
// blob URL (transparent background). The render target is disposed afterwards; nothing renders
// per frame. Inventory slots, the HUD quick slots, the drag ghost and the pickup prompt all use
// these images; ui/icons.ts SVGs remain the fallback (e.g. if the readback fails).
//
// Iteration 13 (CORE): WebGPURenderer — a `RenderTarget` per icon (8-bit sRGB storage, 4x MSAA) and
// `readRenderTargetPixelsAsync`, all awaited before the title. Render targets are never tone-mapped by
// WebGPURenderer (output transform only on the canvas), so the CPU ACES + sRGB conversion stays. Row order
// follows the backend: WebGL 2 reads bottom-up, WebGPU top-down (rows padded to 256 bytes there).

import * as THREE from 'three';
import {RenderTarget, type WebGPURenderer} from 'three/webgpu';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ITEMS} from '../items/items';
import {makeSupplyMesh} from '../world/pickups';
import {ICONS} from './icons';
import {gearIconView, preloadGearModels} from '../gear/models'; // Iteration 16 (lane GEAR)
import {PANTRY_DIMS, isPantryItem} from '../items/pantryFood'; // task studio-food-shelf-production-20261109-002816-01 (lane ITEMS)
import {pantryGltf} from '../world/pantryModels';

/** Icon bitmap size (CSS shows them at roughly half size, so they stay sharp at DPR 1.5–2). */
export const ICON_W = 192;
export const ICON_H = 120;

export interface IconStats {
  method: string;
  count: number;
  failed: string[];
  ms: number;
  bytes: number;
  size: string;
  version: number;
}

const urls = new Map<string, string>();
const stats: IconStats = {method: 'pending', count: 0, failed: [], ms: 0, bytes: 0, size: `${ICON_W}x${ICON_H}`, version: 0};

export function itemIconUrl(itemId: string | undefined | null): string | null {
  return itemId ? urls.get(itemId) ?? null : null;
}

/** Bumped whenever the cache changes (HUD redraw key). */
export function itemIconsVersion(): number {
  return stats.version;
}

export function itemIconStats(): IconStats & {ids: string[]} {
  return {...stats, failed: [...stats.failed], ids: [...urls.keys()]};
}

/** `<img>` of the rendered model, or the SVG fallback when no render exists. */
export function itemIconHtml(itemId: string, cls = 'ico3d'): string {
  const u = urls.get(itemId);
  if (u) return `<img class="${cls}" src="${u}" alt="" draggable="false">`;
  const def = ITEMS[itemId];
  return def ? ICONS[def.icon] : '';
}

// ---------------------------------------------------------------------------------------------
// Pixel conversion (pure; unit-tested)

/** three.js ACESFilmicToneMapping (same constants as the shader chunk), linear in/out. */
export function acesFilmic(r: number, g: number, b: number, exposure = 1): [number, number, number] {
  const k = exposure / 0.6;
  r *= k; g *= k; b *= k;
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.076 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const fr = fit(ir), fg = fit(ig), fb = fit(ib);
  const c = (v: number) => Math.max(0, Math.min(1, v));
  return [c(1.60475 * fr - 0.53108 * fg - 0.07367 * fb), c(-0.10208 * fr + 1.10813 * fg - 0.00605 * fb), c(-0.00327 * fr - 0.07276 * fg + 1.07602 * fb)];
}

const srgbEncode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Iteration 13 (CORE): readback layout — row order and row stride (elements; WebGPU pads rows to 256 bytes). */
export interface PixelLayout { topDown?: boolean; stride?: number }

/** Row stride (elements) of a readback buffer of `len` RGBA8 elements for a w x h copy (three's WebGPU size formula). */
export function readbackStride(len: number, w: number, h: number): number {
  return h > 1 ? Math.max(w * 4, Math.round((len - w * 4) / (h - 1))) : w * 4;
}

/**
 * Render-target bytes (bottom-up rows unless `layout.topDown`, colour premultiplied by coverage; sRGB-encoded storage when
 * `srcSrgb`, else linear) -> top-down, straight-alpha sRGB RGBA with ACES filmic.
 */
export function encodeIconPixels(src: Uint8Array, w: number, h: number, srcSrgb: boolean, exposure = 1, layout: PixelLayout = {}): Uint8ClampedArray {
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lin[i] = srcSrgb ? (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) : c;
  }
  const stride = layout.stride ?? w * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = (layout.topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const si = row + x * 4, di = (y * w + x) * 4;
      const a8 = src[si + 3];
      if (a8 === 0) continue;
      const a = a8 / 255;
      const [r, g, b] = acesFilmic(lin[src[si]] / a, lin[src[si + 1]] / a, lin[src[si + 2]] / a, exposure);
      out[di] = Math.round(srgbEncode(r) * 255);
      out[di + 1] = Math.round(srgbEncode(g) * 255);
      out[di + 2] = Math.round(srgbEncode(b) * 255);
      out[di + 3] = a8;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rendering

const DEG = Math.PI / 180;

/**
 * Lane AMMO (knife-melee-20261030): icon camera (degrees) per caliber box — the Meshy T2.5 models (world/ammoModels.ts) show their
 * caliber print on the front (+Z) face: 9mm carton end, 5.56 ammo-can stencil, 12-gauge carton front with the open top.
 */
const AMMO_ICON_VIEW: Record<string, {az: number; el: number}> = {ammo_9mm: {az: 28, el: 26}, ammo_556: {az: 26, el: 14}, ammo_12ga: {az: 24, el: 30}};

/** Camera direction for an item: azimuth from +Z (front) toward +X, elevation above the horizon. */
function viewFor(itemId: string): {az: number; el: number} {
  const def = ITEMS[itemId];
  // Guns: camera on the detailed +X side (muzzle at -Z appears on the right), a touch from above/behind.
  if (def?.kind === 'weapon') return {az: 78 * DEG, el: 14 * DEG};
  // Flat goods (chocolate bar, ammo boxes, med kit, bandage) read better from higher up.
  if (['chocolate', 'medkit', 'bandage', 'arm_sling', 'trauma_kit', 'leg_splint'].includes(itemId)) return {az: 32 * DEG, el: 38 * DEG}; // + Iteration 16 treatments
  if (itemId === 'electrical_parts' || itemId === 'scrap_metal') return {az: 24 * DEG, el: 42 * DEG}; // lane RACK (office-props-physics-scale-20261030): flat salvage
  if (itemId === 'rail_ties') return {az: 34 * DEG, el: 28 * DEG}; // task studio-market-rework-20261108-074144-01 (lane TRADE): the tie bundle's sawn ends + top
  const ammo = AMMO_ICON_VIEW[itemId];
  if (ammo) return {az: ammo.az * DEG, el: ammo.el * DEG}; // lane AMMO: the caliber's printed face / stencil toward the camera
  if (itemId === 'flare') return {az: 12 * DEG, el: 30 * DEG}; // Iteration 12 (LIGHT): the tube lies along X, printed band to the front
  if (isPantryItem(itemId) && PANTRY_DIMS[itemId].shape === 'flat') return {az: 30 * DEG, el: 36 * DEG}; // (lane ITEMS: flat tins / rounds / packs from higher up)
  if (def?.kind === 'gear') return gearIconView(itemId); // Iteration 16 (lane GEAR): per-piece angles (front three-quarter; the flat gloves from above)
  return {az: 30 * DEG, el: 18 * DEG};
}

/** Post-multiplies the projection so the projected vertices fill `fill` of the frame, centred. */
function fitProjection(cam: THREE.PerspectiveCamera, root: THREE.Object3D, fill = 0.86): boolean {
  const v = new THREE.Vector3();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const pos = m.geometry.attributes.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(cam);
      if (v.x < x0) x0 = v.x;
      if (v.x > x1) x1 = v.x;
      if (v.y < y0) y0 = v.y;
      if (v.y > y1) y1 = v.y;
    }
  });
  if (!Number.isFinite(x0) || x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return false;
  const s = Math.min(2 * fill / (x1 - x0), 2 * fill / (y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  cam.projectionMatrix.premultiply(new THREE.Matrix4().set(s, 0, 0, -s * cx, 0, s, 0, -s * cy, 0, 0, 1, 0, 0, 0, 0, 1));
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  return true;
}

function modelFor(itemId: string, guns: Record<string, GLTF | undefined>): THREE.Object3D | null {
  const def = ITEMS[itemId];
  if (!def) return null;
  if (def.kind === 'weapon') return guns[itemId]?.scene.clone(true) ?? null;
  return makeSupplyMesh(itemId);
}

async function toUrl(canvas: HTMLCanvasElement): Promise<{url: string; bytes: number}> {
  const blob = await new Promise<Blob | null>(res => { try { canvas.toBlob(res, 'image/png'); } catch { res(null); } });
  if (blob) return {url: URL.createObjectURL(blob), bytes: blob.size};
  const url = canvas.toDataURL('image/png');
  return {url, bytes: url.length};
}

interface Shot { id: string; pixels: Uint8ClampedArray }

async function renderShots(renderer: WebGPURenderer, ids: string[], guns: Record<string, GLTF | undefined>, srgbTarget: boolean, failed: string[]): Promise<Shot[]> {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(18, ICON_W / ICON_H, 0.5, 30);
  // Iteration 13 (CORE): match the backend's clip-space convention up front — on a mismatch WebGPURenderer re-derives the
  // projection at render time, which would discard the per-icon fit below.
  cam.coordinateSystem = renderer.coordinateSystem;
  scene.add(cam, new THREE.HemisphereLight(0xf2e8d6, 0x3a352e, 2.1));
  // Lights ride on the camera, so every icon gets the same key (upper left), fill and rim.
  const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
  key.position.set(-3, 4, 2);
  const fill = new THREE.DirectionalLight(0xe6edf5, 0.55);
  fill.position.set(4, 0.5, 3);
  const rim = new THREE.PointLight(0xdfe7ff, 42, 0, 2);
  rim.position.set(3.5, 2.2, -12); // behind the object (it sits 8 units in front of the camera)
  cam.add(key, fill, rim);
  // One small target PER ICON: reusing a single multisampled target returned the first icon's
  // resolved pixels for every later readback in Firefox (all 13 icons showed the rifle).
  // Iteration 13 (CORE): three/webgpu RenderTarget, 8-bit (sRGB storage = hardware encode on write, as before).
  const makeTarget = () => new RenderTarget(ICON_W, ICON_H, {type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: false, depthBuffer: true,
    ...(srgbTarget ? {samples: renderer.samples ? 4 : 0, colorSpace: THREE.SRGBColorSpace} : {samples: 0, colorSpace: THREE.NoColorSpace})});
  const topDown = (renderer.backend as {isWebGPUBackend?: boolean}).isWebGPUBackend === true; // WebGPU copies rows from the top
  let rt: RenderTarget | null = null;
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const shots: Shot[] = [];
  try {
    renderer.setClearColor(0x000000, 0);
    for (const id of ids) {
      const obj = modelFor(id, guns);
      if (!obj) { failed.push(id); continue; }
      rt?.dispose();
      rt = makeTarget();
      renderer.setRenderTarget(rt);
      const wrap = new THREE.Group();
      wrap.add(obj);
      scene.add(wrap);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const r = box.isEmpty() ? 1 : Math.max(1e-4, box.getSize(new THREE.Vector3()).length() / 2);
      const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
      wrap.scale.setScalar(1 / r);
      wrap.position.copy(c).multiplyScalar(-1 / r);
      wrap.updateMatrixWorld(true);
      const {az, el} = viewFor(id);
      cam.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(8);
      cam.up.set(0, 1, 0);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      fitProjection(cam, wrap);
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
      // Iteration 13 (CORE): async readback (a fresh buffer per icon, so a failed one never reuses the previous pixels)
      let buf: Uint8Array | null = null;
      try {
        const px = await renderer.readRenderTargetPixelsAsync(rt!, 0, 0, ICON_W, ICON_H);
        buf = px instanceof Uint8Array ? px : null;
      } catch (err) {
        console.warn(`item icon readback failed for ${id}:`, err);
      }
      scene.remove(wrap); // clones share geometry/materials with the live templates: nothing to dispose
      const stride = buf ? readbackStride(buf.length, ICON_W, ICON_H) : 0;
      let covered = 0;
      if (buf) for (let y = 0; y < ICON_H; y++) for (let x = 0; x < ICON_W; x++) if (buf[y * stride + x * 4 + 3]) covered++;
      if (!buf || covered < 20) { failed.push(id); continue; }
      shots.push({id, pixels: encodeIconPixels(buf, ICON_W, ICON_H, srgbTarget, 1, {topDown, stride})});
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    rt?.dispose();
  }
  return shots;
}

/**
 * Renders every catalogue item once (call after assets load and registerItemModels()). Safe to
 * await before the title screen; on any failure the affected items keep their SVG icon.
 * (Task studio-food-shelf-production-20261109-002816-01, lane ITEMS: a pantry food / drink whose lazy model is not loaded yet keeps its
 * SVG glyph — never an icon of its fallback primitive; refreshItemIcons renders it once world/pantryModels.ts delivered the model.)
 */
export async function buildItemIcons(renderer: WebGPURenderer, guns: Record<string, GLTF | undefined>, ids: string[] = Object.keys(ITEMS).filter(id => !isPantryItem(id) || !!pantryGltf(id))): Promise<IconStats> {
  const t0 = performance.now();
  await preloadGearModels(); // Iteration 16 (lane GEAR): the delivered Meshy gear models before their first template (icons, pickups, bags)
  let failed: string[] = [];
  let shots: Shot[] = [];
  const api = (renderer.backend as {isWebGPUBackend?: boolean}).isWebGPUBackend ? 'WebGPU' : 'WebGL2'; // Iteration 13 (CORE)
  let method = `shared renderer (${api}) · MSAA sRGB RenderTarget · readRenderTargetPixelsAsync`;
  try {
    shots = await renderShots(renderer, ids, guns, true, failed);
  } catch (err) {
    console.warn('item icons: sRGB render target failed', err);
    shots = [];
  }
  if (shots.length === 0 && ids.length) {
    // Fallback target (no MSAA, linear 8-bit) for drivers that reject the first one.
    failed = [];
    method = `shared renderer (${api}) · linear RenderTarget · readRenderTargetPixelsAsync`;
    try { shots = await renderShots(renderer, ids, guns, false, failed); } catch (err) { console.warn('item icons: linear render target failed', err); shots = []; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = ICON_W;
  canvas.height = ICON_H;
  const ctx = canvas.getContext('2d');
  let bytes = 0;
  if (ctx) {
    for (const s of shots) {
      const img = ctx.createImageData(ICON_W, ICON_H);
      img.data.set(s.pixels);
      ctx.clearRect(0, 0, ICON_W, ICON_H);
      ctx.putImageData(img, 0, 0);
      const r = await toUrl(canvas);
      const old = urls.get(s.id);
      if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
      urls.set(s.id, r.url);
      bytes += r.bytes;
    }
  }
  for (const id of ids) if (!urls.has(id) && !failed.includes(id)) failed.push(id);
  stats.method = shots.length ? method : 'svg fallback (render failed)';
  stats.count = urls.size;
  stats.failed = failed;
  stats.ms = Math.round(performance.now() - t0);
  stats.bytes = bytes;
  stats.version++;
  return itemIconStats();
}

/**
 * Task studio-food-shelf-production-20261109-002816-01 (lane ITEMS): re-render the icons of `ids` only (their lazily loaded models
 * arrived: world/pantryModels.ts) — the other icons and the boot render's failure list are kept; the cache version bumps (HUD redraw).
 */
export async function refreshItemIcons(renderer: WebGPURenderer, ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const keep = stats.failed.filter(id => !ids.includes(id)), method = stats.method;
  try { await buildItemIcons(renderer, {}, [...ids]); } catch (err) { console.warn('item icons: refresh failed', err); }
  stats.failed = [...keep, ...stats.failed.filter(id => ids.includes(id))];
  if (method !== 'pending') stats.method = method;
}
