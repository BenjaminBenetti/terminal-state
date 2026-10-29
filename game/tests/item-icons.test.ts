// Iteration 13 (CORE): item icon readback (ui/itemIcons.ts) on WebGPURenderer — readRenderTargetPixelsAsync returns rows
// bottom-up on the WebGL 2 backend and top-down (rows padded to 256 bytes) on WebGPU; both must encode to the same image.
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';

vi.mock('../src/world/canvasTextures', () => ({canvasTexture: () => new THREE.Texture()}));
const {acesFilmic, encodeIconPixels, readbackStride} = await import('../src/ui/itemIcons');

/** A w x h test image (top-down): distinct opaque colour per row, a transparent column, a half-covered pixel. */
function image(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (x === 0) continue; // transparent
    px[i] = 40 + y * 30; px[i + 1] = 200 - y * 20; px[i + 2] = 90 + x * 10; px[i + 3] = x === 1 && y === 0 ? 128 : 255;
  }
  return px;
}
/** Store the image the way a backend returns it. */
function layout(img: Uint8Array, w: number, h: number, topDown: boolean, strideBytes: number): Uint8Array {
  const out = new Uint8Array((h - 1) * strideBytes + w * 4); // three's WebGPU readback size formula
  for (let y = 0; y < h; y++) out.set(img.subarray(y * w * 4, (y + 1) * w * 4), (topDown ? y : h - 1 - y) * strideBytes);
  return out;
}

describe('item icon readback layout', () => {
  const w = 5, h = 4, img = image(w, h);

  it('WebGL 2 (bottom-up, tight) and WebGPU (top-down, 256-byte rows) encode to the same top-down image', () => {
    const gl = layout(img, w, h, false, w * 4);
    const gpu = layout(img, w, h, true, 256);
    expect(readbackStride(gl.length, w, h)).toBe(w * 4);
    expect(readbackStride(gpu.length, w, h)).toBe(256);
    const a = encodeIconPixels(gl, w, h, true, 1);
    const b = encodeIconPixels(gpu, w, h, true, 1, {topDown: true, stride: readbackStride(gpu.length, w, h)});
    expect(Array.from(b)).toEqual(Array.from(a));
    // top row of the output = top row of the image (row 0 colour), transparent column stays empty, coverage kept
    expect(a[3]).toBe(0);
    expect(a[(0 * w + 1) * 4 + 3]).toBe(128);
    expect(a[(0 * w + 2) * 4 + 3]).toBe(255);
    expect(a[(3 * w + 2) * 4]).toBeGreaterThan(a[(0 * w + 2) * 4]); // the reddest row is the bottom one, as authored
  });

  it('ICON_W-wide RGBA8 rows are already 256-byte aligned (192 * 4 = 768)', () => {
    expect(readbackStride((120 - 1) * 768 + 768, 192, 120)).toBe(768);
  });

  it('un-premultiplies coverage before ACES (an edge pixel keeps the opaque pixel colour)', () => {
    const opaque = new Uint8Array([200, 120, 60, 255]);
    const half = new Uint8Array([Math.round(200 / 2), Math.round(120 / 2), Math.round(60 / 2), 128]); // linear storage, premultiplied
    const o = encodeIconPixels(opaque, 1, 1, false), e = encodeIconPixels(half, 1, 1, false);
    for (let c = 0; c < 3; c++) expect(Math.abs(o[c] - e[c])).toBeLessThanOrEqual(3);
    expect(e[3]).toBe(128);
    expect(acesFilmic(0, 0, 0)).toEqual([0, 0, 0]);
  });
});
