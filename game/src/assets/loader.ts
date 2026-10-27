// Loads every runtime derivative up front with progress; failures are collected and surfaced
// as an actionable error screen (no silent placeholder substitution).

import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MODEL_FILES, TEXTURE_FILES, type ModelKey, type TextureKey} from './manifest';

export interface AssetBundle {
  models: Record<ModelKey, GLTF>;
  textures: Record<TextureKey, THREE.Texture>;
}

export class AssetLoadError extends Error {
  constructor(readonly failures: {url: string; reason: string}[]) {
    super(`Failed to load ${failures.length} asset file(s)`);
  }
}

export function assetUrl(rel: string): string {
  return new URL(rel, document.baseURI).href;
}

export async function loadAssets(onProgress: (frac: number, label: string) => void): Promise<AssetBundle> {
  const gltf = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const entries: {key: string; url: string; weight: number; kind: 'model' | 'texture'}[] = [
    ...Object.entries(MODEL_FILES).map(([key, f]) => ({key, url: f.url, weight: f.bytes, kind: 'model' as const})),
    ...Object.entries(TEXTURE_FILES).map(([key, f]) => ({key, url: f.url, weight: f.bytes, kind: 'texture' as const})),
  ];
  const total = entries.reduce((s, e) => s + e.weight, 0);
  const loaded = new Map<string, number>();
  const report = (label: string) => {
    let sum = 0;
    for (const v of loaded.values()) sum += v;
    onProgress(Math.min(1, sum / total), label);
  };
  const failures: {url: string; reason: string}[] = [];
  const models = {} as Record<ModelKey, GLTF>;
  const textures = {} as Record<TextureKey, THREE.Texture>;
  await Promise.all(entries.map(e => new Promise<void>(resolve => {
    const url = assetUrl(e.url);
    const done = () => { loaded.set(e.key, e.weight); report(e.url.split('/').pop() ?? e.url); resolve(); };
    const fail = (err: unknown) => {
      const reason = err instanceof Error ? err.message : (err as {target?: XMLHttpRequest})?.target?.status ? `HTTP ${(err as {target: XMLHttpRequest}).target.status}` : String(err);
      failures.push({url: e.url, reason});
      done();
    };
    if (e.kind === 'model') {
      gltf.load(url, g => { models[e.key as ModelKey] = g; done(); }, ev => {
        if (ev.lengthComputable && ev.total > 0) { loaded.set(e.key, e.weight * (ev.loaded / ev.total) * 0.98); report(e.url.split('/').pop() ?? ''); }
      }, fail);
    } else {
      texLoader.load(url, t => {
        const spec = TEXTURE_FILES[e.key as TextureKey];
        t.colorSpace = spec.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        textures[e.key as TextureKey] = t;
        done();
      }, undefined, fail);
    }
  })));
  if (failures.length) throw new AssetLoadError(failures);
  return {models, textures};
}
