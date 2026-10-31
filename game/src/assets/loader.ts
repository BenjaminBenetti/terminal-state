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

/**
 * Iteration 07 (Lane P2): LAZY, per-station prop models. The 100+ iteration-07 prop GLBs are NOT part of the boot preload: before a
 * station is revealed the game asks for exactly the models its generated layout placed (gen/props07.ts p7ModelKeysFor), fetched with
 * progress (relative URLs, at most `concurrency` in flight) and cached for later stations. A model that failed to load stays absent
 * (the station drops those placements; never a box stand-in). `trim` releases geometry/textures of models the current station does not
 * use beyond a small recently-used set, so GPU memory follows the station rather than the whole catalogue.
 */
export class PropModelLibrary {
  private readonly pending = new Map<string, Promise<GLTF | null>>();
  private readonly models = new Map<string, GLTF>();
  private readonly recent: string[] = [];
  private readonly geometries = new WeakSet<THREE.BufferGeometry>();
  readonly failures: {key: string; url: string; reason: string}[] = [];
  /**
   * Bytes fetched so far (catalogue sizes) and fetch count (tests/QA). Task track3-eaton-centre-20261031 (lane PACKAGE): `late`
   * counts fetches started while `sealed` (after a level was built: should stay 0 — a level's models load behind its loading screen).
   */
  stats = {fetched: 0, bytes: 0, released: 0, late: 0};
  /** Lane PACKAGE: set once a level is built (Game.buildSection), cleared when the next level is prepared (Game.prepareSection). */
  sealed = false;
  constructor(private readonly files: Readonly<Record<string, {url: string; bytes: number}>>, private readonly concurrency = 6,
    private readonly load: (url: string, onProgress: (f: number) => void) => Promise<GLTF> = defaultGltfLoad) {}

  has(key: string): boolean { return this.models.has(key); }
  /** Geometry belongs to a cached library model (station teardown must not dispose it). */
  ownsGeometry(g: THREE.BufferGeometry): boolean { return this.geometries.has(g); }
  get(key: string): GLTF | undefined { return this.models.get(key); }
  /** Loaded models as a plain record (merged into the station builder's model map). */
  record(): Record<string, GLTF> { return Object.fromEntries(this.models); }
  loadedKeys(): string[] { return [...this.models.keys()]; }
  /** Lane PACKAGE (track3): the lazy file map (assets/levelAssets.ts selects / reports on it). */
  get catalogue(): Readonly<Record<string, {url: string; bytes: number}>> { return this.files; }
  /** Lane PACKAGE (track3): catalogue bytes of the resident models (cooked GLB sizes; decoded GPU memory is larger). */
  residentBytes(): number { let s = 0; for (const k of this.models.keys()) s += this.files[k]?.bytes ?? 0; return s; }

  /** Fetches every listed model not yet cached; resolves when all settled (failures recorded, never thrown). */
  async ensure(keys: readonly string[], onProgress?: (frac: number, label: string) => void): Promise<{loaded: string[]; failed: string[]; fetchedBytes: number}> {
    const want = [...new Set(keys)].filter(k => this.files[k]);
    const todo = want.filter(k => !this.models.has(k));
    const total = todo.reduce((s, k) => s + this.files[k].bytes, 0) || 1;
    const part = new Map<string, number>();
    const report = (label: string) => { let s = 0; for (const v of part.values()) s += v; onProgress?.(Math.min(1, s / total), label); };
    let next = 0, fetchedBytes = 0;
    const worker = async () => {
      while (next < todo.length) {
        const key = todo[next++], f = this.files[key];
        let p = this.pending.get(key);
        if (!p) {
          if (this.sealed) { this.stats.late++; console.warn(`Lazy model fetched mid-level (not behind a loading screen): ${key}`); }
          p = this.load(assetUrl(f.url), fr => { part.set(key, f.bytes * fr * 0.98); report(f.url.split('/').pop() ?? key); })
            .then(g => { this.models.set(key, g); g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) this.geometries.add((o as THREE.Mesh).geometry); }); this.stats.fetched++; this.stats.bytes += f.bytes; fetchedBytes += f.bytes; return g; })
            .catch(err => { this.failures.push({key, url: f.url, reason: err instanceof Error ? err.message : String(err)}); return null; })
            .finally(() => this.pending.delete(key));
          this.pending.set(key, p);
        }
        await p;
        part.set(key, f.bytes);
        report(f.url.split('/').pop() ?? key);
      }
    };
    await Promise.all(Array.from({length: Math.min(this.concurrency, todo.length)}, worker));
    for (const k of want) { const i = this.recent.indexOf(k); if (i >= 0) this.recent.splice(i, 1); this.recent.push(k); }
    return {loaded: want.filter(k => this.models.has(k)), failed: want.filter(k => !this.models.has(k)), fetchedBytes};
  }

  /**
   * Disposes models outside `keep` beyond the `extra` most recently used ones (re-fetched from the HTTP cache if needed again).
   * Task track3-eaton-centre-20261031 (lane PACKAGE): models matching `evict` (assets/levelAssets.ts foreignTo: another level's
   * own art) are always released when outside `keep`, never kept as a recent extra — the resident set follows the level.
   */
  trim(keep: ReadonlySet<string>, extra = 16, evict?: (key: string) => boolean): string[] {
    const spare = this.recent.filter(k => !keep.has(k) && this.models.has(k));
    const forced = evict ? spare.filter(k => evict(k)) : [];
    const rest = forced.length ? spare.filter(k => !forced.includes(k)) : spare;
    const drop = [...forced, ...rest.slice(0, Math.max(0, rest.length - extra))];
    for (const k of drop) {
      const g = this.models.get(k)!;
      g.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
          mat.dispose();
        }
      });
      this.models.delete(k);
      this.recent.splice(this.recent.indexOf(k), 1);
      this.stats.released++;
    }
    return drop;
  }
}

function defaultGltfLoad(url: string, onProgress: (f: number) => void): Promise<GLTF> {
  return new Promise((resolve, reject) => new GLTFLoader().load(url, resolve, ev => { if (ev.lengthComputable && ev.total > 0) onProgress(ev.loaded / ev.total); }, reject));
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
