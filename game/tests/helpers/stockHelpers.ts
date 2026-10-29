// Iteration 08 (Lane S): shared helpers for the shelf-stock tests — load a runtime GLB in Node
// (textures dropped: geometry only), and a few holder fixtures.
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {generateStation, type StationLayout} from '../../src/gen/station';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../src/gen/props';
import {ContainerManager} from '../../src/world/containers';
import {placementBox} from '../../src/items/lootLayout';
import {ShelfStock} from '../../src/world/shelfStock';
import type {OBB, V3} from '../../src/world/shelfStockLayout';
import {MODEL_FILES} from '../../src/assets/manifest';

const cache = new Map<string, Promise<GLTF>>();
/**
 * Logical model files the shelf-stock tests ask for by their historical name -> the LIVE runtime file of that manifest key
 * (Meshy T2.5 replacement 2026-10-29: shelf.glb -> shelf-t25.glb, tech-display.glb -> tech-display-t25.glb).
 */
const LIVE: Record<string, string> = {'shelf.glb': MODEL_FILES.shelf.url, 'tech-display.glb': MODEL_FILES.techDisplay.url};

/** A model from public/assets/models (geometry only; textures disposed so Node can parse it). */
export function loadModel(file: string): Promise<GLTF> {
  let p = cache.get(file);
  if (!p) {
    p = (async () => {
      const io = new NodeIO();
      const rel = LIVE[file] ?? `assets/models/${file}`;
      const doc = await io.read(fileURLToPath(new URL(`../../public/${rel}`, import.meta.url)));
      for (const t of doc.getRoot().listTextures()) t.dispose();
      const bin = await io.writeBinary(doc);
      return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
    })();
    cache.set(file, p);
  }
  return p;
}

/**
 * Canvas shim (tests/helpers/canvas2d.ts) plus the one call it lacks that the item-label atlas uses
 * (clip; a no-op is fine for structural tests). Returns the uninstall function.
 */
export async function installStockCanvas(rasterize: boolean): Promise<() => void> {
  const {installCanvasShim} = await import('./canvas2d');
  const un = installCanvasShim(rasterize);
  const doc = (globalThis as unknown as {document: {createElement(t: string): {getContext(k: string): object}}}).document;
  const proto = Object.getPrototypeOf(doc.createElement('canvas').getContext('2d')) as {clip?: () => void};
  if (!proto.clip) proto.clip = () => {};
  return un;
}

// ---------------------------------------------------------------------------------------
// Station / holder fixtures


/** A prop placement like the generator makes (quarter-turn yaw, footprint from PROP_DEFS). */
export function stockProp(kind: PropKind, x: number, z: number, o: {variant?: number; rot?: number; y?: number; level?: number; area?: number} = {}): PropPlacement {
  const def = PROP_DEFS[kind];
  const rot = o.rot ?? 0;
  const {hx, hz} = footprint(kind, rot);
  const p = {kind, x, y: o.y ?? 0, z, rot, area: o.area ?? 0, hx, hz, h: def.h, blocksSight: def.blocksSight, variant: o.variant ?? 0} as PropPlacement;
  if (o.level) p.level = o.level;
  return p;
}

const stubMats = {get: () => new THREE.MeshStandardMaterial(), scale: {}} as unknown as ConstructorParameters<typeof ContainerManager>[1];

/** A generated station with its real loot holders (ContainerManager) and its dressed stock (real shelf.glb decks). */
export async function stockedStation(seed: number): Promise<{layout: StationLayout; cm: ContainerManager; stock: ShelfStock}> {
  const shelf = await loadModel('shelf.glb'), techDisplay = await loadModel('tech-display.glb');
  const layout = generateStation(seed);
  const cm = new ContainerManager({}, stubMats, () => null as never);
  cm.build(layout);
  const stock = new ShelfStock();
  stock.build(layout, {models: {shelf, techDisplay}, lotsOf: p => cm.holderFor(p)?.state.lots.map(l => placementBox(l.itemId, l)) ?? []});
  return {layout, cm, stock};
}

// ---------------------------------------------------------------------------------------
// Geometry tests

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Triangle vs oriented box (separating axis test, Akenine-Möller): true when they intersect. */
export function triangleHitsOBB(t0: V3, t1: V3, t2: V3, o: OBB): boolean {
  // triangle in the box frame
  const loc = (p: V3): V3 => { const d = sub(p, o.c); return [dot(d, o.ax[0]), dot(d, o.ax[1]), dot(d, o.ax[2])]; };
  const v = [loc(t0), loc(t1), loc(t2)];
  const h = o.h;
  const e = [sub(v[1], v[0]), sub(v[2], v[1]), sub(v[0], v[2])];
  const axes: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], cross(e[0], e[1])];
  for (const ei of e) for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]) axes.push(cross(u, ei));
  for (const a of axes) {
    if (dot(a, a) < 1e-14) continue;
    const p = v.map(x => dot(x, a));
    const r = h[0] * Math.abs(a[0]) + h[1] * Math.abs(a[1]) + h[2] * Math.abs(a[2]);
    if (Math.min(...p) > r || Math.max(...p) < -r) return false;
  }
  return true;
}
