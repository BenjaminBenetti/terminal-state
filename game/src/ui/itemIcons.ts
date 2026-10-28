// Item icons rendered from the actual runtime 3D models (iteration 04, user feedback #6): the
// rifle / shotgun derivatives, the generated food & drink models (models.item_*), and the
// procedural ammo / med kit / bandage models — exactly the objects the world and the hands show
// (world/pickups.ts makeSupplyMesh, the gun GLTF scenes).
//
// Method: ONCE at load, reusing the game's WebGLRenderer (no extra WebGL context, no renderer per
// slot): one offscreen multisampled render target, one small icon scene with fixed product
// lighting, one camera at a consistent 3/4 product angle (guns: near side-on, muzzle right;
// items: front three-quarter from above). Each model is normalised, the projection is fitted to
// its projected vertices, rendered, read back with readRenderTargetPixels and converted to
// straight-alpha sRGB with the same ACES filmic curve as the game renderer, then cached as a PNG
// blob URL (transparent background). The render target is disposed afterwards; nothing renders
// per frame. Inventory slots, the HUD quick slots, the drag ghost and the pickup prompt all use
// these images; ui/icons.ts SVGs remain the fallback (e.g. if WebGL readback fails).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ITEMS} from '../items/items';
import {makeSupplyMesh} from '../world/pickups';
import {ICONS} from './icons';

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

/**
 * Render-target bytes (bottom-up rows, colour premultiplied by coverage; sRGB-encoded storage when
 * `srcSrgb`, else linear) -> top-down, straight-alpha sRGB RGBA with ACES filmic.
 */
export function encodeIconPixels(src: Uint8Array, w: number, h: number, srcSrgb: boolean, exposure = 1): Uint8ClampedArray {
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lin[i] = srcSrgb ? (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) : c;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((h - 1 - y) * w + x) * 4, di = (y * w + x) * 4;
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

/** Camera direction for an item: azimuth from +Z (front) toward +X, elevation above the horizon. */
function viewFor(itemId: string): {az: number; el: number} {
  const def = ITEMS[itemId];
  // Guns: camera on the detailed +X side (muzzle at -Z appears on the right), a touch from above/behind.
  if (def?.kind === 'weapon') return {az: 78 * DEG, el: 14 * DEG};
  // Flat goods (chocolate bar, ammo boxes, med kit, bandage) read better from higher up.
  if (['chocolate', 'ammo_rifle', 'ammo_shells', 'ammo_pistol', 'medkit', 'bandage'].includes(itemId)) return {az: 32 * DEG, el: 38 * DEG};
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

function renderShots(renderer: THREE.WebGLRenderer, ids: string[], guns: Record<string, GLTF | undefined>, srgbTarget: boolean, failed: string[]): Shot[] {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(18, ICON_W / ICON_H, 0.5, 30);
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
  const makeTarget = () => new THREE.WebGLRenderTarget(ICON_W, ICON_H, srgbTarget ? {samples: 4, colorSpace: THREE.SRGBColorSpace} : {samples: 0});
  let rt: THREE.WebGLRenderTarget | null = null;
  const buf = new Uint8Array(ICON_W * ICON_H * 4);
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
      buf.fill(0); // a refused readback (it only logs) must not reuse the previous icon's pixels
      renderer.readRenderTargetPixels(rt!, 0, 0, ICON_W, ICON_H, buf);
      scene.remove(wrap); // clones share geometry/materials with the live templates: nothing to dispose
      let covered = 0;
      for (let i = 3; i < buf.length; i += 4) if (buf[i]) covered++;
      if (covered < 20) { failed.push(id); continue; }
      shots.push({id, pixels: encodeIconPixels(buf, ICON_W, ICON_H, srgbTarget, 1)});
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
 */
export async function buildItemIcons(renderer: THREE.WebGLRenderer, guns: Record<string, GLTF | undefined>, ids: string[] = Object.keys(ITEMS)): Promise<IconStats> {
  const t0 = performance.now();
  let failed: string[] = [];
  let shots: Shot[] = [];
  let method = 'shared renderer · MSAA sRGB render target · readRenderTargetPixels';
  try {
    shots = renderShots(renderer, ids, guns, true, failed);
  } catch {
    shots = [];
  }
  if (shots.length === 0 && ids.length) {
    // Fallback target (no MSAA, linear 8-bit) for drivers that reject the first one.
    failed = [];
    method = 'shared renderer · linear render target · readRenderTargetPixels';
    try { shots = renderShots(renderer, ids, guns, false, failed); } catch { shots = []; }
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
