// Task track3-eaton-centre-20261031 (lane PACKAGE): level-scoped lazy assets — the selector / ownership rules
// (assets/levelAssets.ts), the library's level eviction + late-fetch accounting (assets/loader.ts PropModelLibrary), the
// level resource holder (assets/levelResources.ts), the agreement with the CI packager's path families, and the real Subway /
// Office layouts' working sets (mall-only art is never selected outside the mall).
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {assetAllowedIn, foreignTo, lazyCatalogue, levelOfAsset, levelWorkingSet, selectLevelKeys, type LazyFiles} from '../src/assets/levelAssets';
import {PropModelLibrary} from '../src/assets/loader';
import {LevelResources} from '../src/assets/levelResources';
import {P7_FILES, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {officeModelKeysFor} from '../src/gen/office/index';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';

(globalThis as {document?: unknown}).document ??= {baseURI: 'http://localhost/game/'};

/** The game's lazy library catalogue (game.ts propModels) — mall files join it once lane ASSETS delivers them. */
const GAME_FILES: LazyFiles = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES};
/** A mall-only file keyed the way lane SHOPS renders mall kinds (`office-<assetId>`, gen/mall/kinds.ts MALL_KIND_ASSET). */
const WITH_MALL: LazyFiles = {...GAME_FILES,
  'office-glass-counter': {url: 'assets/models/mall-glass-counter.glb', bytes: 300_000},
  'mall-fountain': {url: 'assets/models/mall-fountain.glb', bytes: 500_000}};

const fakeGltf = () => { const s = new THREE.Group(); s.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({map: new THREE.Texture()}))); return {scene: s} as unknown as GLTF; };

describe('level-only ownership (by file path, never by key)', () => {
  it('mall-*.glb and assets/textures/mall/** belong to the mall; everything else is shared', () => {
    for (const u of ['assets/models/mall-fountain.glb', './assets/models/mall-glass-counter.glb', 'assets/textures/mall/terrazzo.jpg', 'assets/textures/mall/shops/pharmacy-floor.png'])
      expect(levelOfAsset(u), u).toBe('mall');
    for (const u of ['assets/models/office-office-desk.glb', 'assets/models/shelf-t25.glb', 'assets/models/mall.glb', 'assets/models/sub/mall-x.glb',
      'assets/textures/office/office-carpet.jpg', 'assets/textures/wall-working-face-color.jpg', 'assets/audio/mall-ambience.mp3'])
      expect(levelOfAsset(u), u).toBeNull();
    expect(assetAllowedIn('mall', 'assets/models/mall-fountain.glb')).toBe(true);
    expect(assetAllowedIn('subway', 'assets/models/mall-fountain.glb')).toBe(false);
    expect(assetAllowedIn('office', 'assets/textures/mall/terrazzo.jpg')).toBe(false);
    expect(assetAllowedIn('office', 'assets/models/office-office-desk.glb')).toBe(true);
    expect(assetAllowedIn('mall', 'assets/models/office-office-desk.glb')).toBe(true); // the mall may reuse office / company props
  });

  it('agrees with the CI packager path families (tools/release/package-ci.mjs sizeReport)', async () => {
    type Fam = Record<string, {files: number}>;
    const {sizeReport} = await import(pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/release/package-ci.mjs')).href) as
      {sizeReport: (e: {path: string; bytes: number; sha256: string}[]) => {levelFamilies: {models: Fam; textures: Fam}}};
    const paths = ['assets/models/mall-fountain.glb', 'assets/models/office-office-desk.glb', 'assets/models/shelf-t25.glb',
      'assets/textures/mall/terrazzo.jpg', 'assets/textures/office/office-carpet.jpg', 'assets/textures/ceiling-working-face-color.jpg'];
    for (const p of paths) {
      const r = sizeReport([{path: p, bytes: 7, sha256: ''}]);
      const fam = p.startsWith('assets/models/') ? r.levelFamilies.models : r.levelFamilies.textures;
      expect(fam.mall.files === 1, p).toBe(levelOfAsset(p) === 'mall');
    }
  });

  it('selects per level: another level\'s own art is foreign (never fetched), shared / unknown keys pass, duplicates collapse', () => {
    const p7 = Object.keys(P7_FILES)[0]; // a real shared p7 model key
    const keys = [p7, 'office-glass-counter', 'office-office-desk', 'mall-fountain', 'office-not-delivered', p7];
    const sub = selectLevelKeys('subway', keys, WITH_MALL);
    expect(sub.foreign).toEqual(['office-glass-counter', 'mall-fountain']);
    expect(sub.keys).toEqual([p7, 'office-office-desk', 'office-not-delivered']);
    const mall = selectLevelKeys('mall', keys, WITH_MALL);
    expect(mall.foreign).toEqual([]);
    expect(mall.keys).toEqual([p7, 'office-glass-counter', 'office-office-desk', 'mall-fountain', 'office-not-delivered']);
    const ws = levelWorkingSet('mall', keys, WITH_MALL);
    expect(ws.levelOnly).toEqual({files: 2, bytes: 800_000});
    expect(ws.undelivered).toEqual(['office-not-delivered']);
    expect(ws.total.bytes).toBe(ws.levelOnly.bytes + ws.shared.bytes);
    const cat = lazyCatalogue(WITH_MALL);
    expect(cat.mall).toEqual({files: 2, bytes: 800_000});
    expect(lazyCatalogue(GAME_FILES).mall).toEqual({files: 0, bytes: 0}); // no mall file is delivered yet in this checkout's catalogue
  });
});

describe('PropModelLibrary level eviction and late-fetch accounting', () => {
  const files = {p7_a: {url: 'assets/models/p7-a.glb', bytes: 100}, 'office-desk': {url: 'assets/models/office-desk.glb', bytes: 200},
    'office-glass-counter': {url: 'assets/models/mall-glass-counter.glb', bytes: 300}, 'mall-fountain': {url: 'assets/models/mall-fountain.glb', bytes: 400}};

  it('trim releases another level\'s models at once (never kept as recent extras); shared extras keep the 16-recent rule', async () => {
    const lib = new PropModelLibrary(files, 2, async () => fakeGltf());
    await lib.ensure(Object.keys(files));
    expect(lib.residentBytes()).toBe(1000);
    expect(lib.catalogue).toBe(files);
    // travelling mall -> subway: the subway layout uses only p7_a
    const dropped = lib.trim(new Set(['p7_a']), 16, foreignTo('subway', files));
    expect(dropped.sort()).toEqual(['mall-fountain', 'office-glass-counter']);
    expect(lib.loadedKeys().sort()).toEqual(['office-desk', 'p7_a']); // the shared office model stays as a recent extra
    expect(lib.residentBytes()).toBe(300);
    expect(lib.stats.released).toBe(2);
    // a mall model the CURRENT layout uses is never evicted, and the old two-argument call is unchanged
    await lib.ensure(['office-glass-counter']);
    expect(lib.trim(new Set(['office-glass-counter']), 16, foreignTo('mall', files))).toEqual([]);
    expect(lib.trim(new Set(['office-glass-counter']), 0).sort()).toEqual(['office-desk', 'p7_a']);
  });

  it('counts a fetch started after the level was built (sealed) as late; cached keys are not fetches', async () => {
    const lib = new PropModelLibrary(files, 2, async () => fakeGltf());
    await lib.ensure(['p7_a']);
    lib.sealed = true;
    await lib.ensure(['p7_a']);
    expect(lib.stats.late).toBe(0);
    const warn = console.warn; const msgs: string[] = []; console.warn = (m: string) => { msgs.push(m); };
    try { await lib.ensure(['office-desk']); } finally { console.warn = warn; }
    expect(lib.stats.late).toBe(1);
    expect(msgs[0]).toContain('office-desk');
  });
});

describe('LevelResources (level textures / owned GPU resources)', () => {
  const quiet = async <T>(f: () => Promise<T> | T): Promise<T> => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };

  it('loads a level\'s textures once, refuses another level\'s files, releases on level change (textures now, owned via retire)', async () => {
    const fetched: string[] = [];
    const res = new LevelResources(async url => { fetched.push(url); return new THREE.Texture(); });
    const terrazzo = await res.load('mall', 'assets/textures/mall/terrazzo.jpg', {srgb: true, repeat: true});
    expect(terrazzo).toBeInstanceOf(THREE.Texture);
    expect(terrazzo!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(terrazzo!.wrapS).toBe(THREE.RepeatWrapping);
    expect(await res.load('mall', 'assets/textures/mall/terrazzo.jpg', {srgb: true, repeat: true})).toBe(terrazzo);
    expect(res.get('mall', 'assets/textures/mall/terrazzo.jpg')).toBe(terrazzo);
    expect(await quiet(() => res.load('office', 'assets/textures/mall/terrazzo.jpg', {srgb: true, repeat: true}))).toBeNull();
    expect(res.stats.refused).toBe(1);
    expect(fetched).toEqual(['assets/textures/mall/terrazzo.jpg']);
    let disposedTex = 0, disposedMat = 0;
    terrazzo!.addEventListener('dispose', () => { disposedTex++; });
    const mat = res.own('mall', new THREE.MeshStandardMaterial());
    mat.addEventListener('dispose', () => { disposedMat++; });
    expect(res.summary()).toEqual({mall: {textures: 1, owned: 1}});
    expect(res.retainOnly('mall')).toBe(0); // Retry / NewGame in the same level keeps everything
    const queued: (() => void)[] = [];
    expect(res.retainOnly('office', fn => queued.push(fn))).toBe(2);
    expect(disposedTex).toBe(1); // textures at once
    expect(disposedMat).toBe(0); // owned resources after the next warm-up
    queued.forEach(fn => fn());
    expect(disposedMat).toBe(1);
    expect(res.summary()).toEqual({});
    expect(res.get('mall', 'assets/textures/mall/terrazzo.jpg')).toBeUndefined();
    expect(res.stats.released).toBe(2);
  });

  it('a load still pending when its level is released is disposed on arrival; failures resolve null; late loads are counted', async () => {
    let resolve!: (t: THREE.Texture) => void;
    const res = new LevelResources(url => url.endsWith('bad.jpg') ? Promise.reject(new Error('404')) : new Promise(r => { resolve = r; }));
    const p = res.load('mall', 'assets/textures/mall/slow.jpg', {srgb: false, repeat: false});
    res.retainOnly('subway');
    const t = new THREE.Texture(); let disposed = 0; t.addEventListener('dispose', () => { disposed++; });
    resolve(t);
    expect(await p).toBeNull();
    expect(disposed).toBe(1);
    expect(await res.load('mall', 'assets/textures/mall/bad.jpg', {srgb: true, repeat: true})).toBeNull();
    expect(res.stats.failed).toBe(1);
    res.sealed = true;
    void quiet(() => res.load('mall', 'assets/textures/mall/late.jpg', {srgb: true, repeat: 's'}));
    expect(res.stats.late).toBe(1);
  });
});

describe('real level layouts: working sets and isolation', () => {
  const layoutsOf = (level: 'subway' | 'office', seeds: number[]): StationLayout[] => seeds.map(levelSeed => LEVELS[level].generate('main', {levelSeed, startWeapon: 'pistol'}));
  const keysOf = (l: StationLayout) => [...new Set([...p7ModelKeysFor(l), ...officeModelKeysFor(l)])];

  it('Subway and Office layouts never select mall-only art; their lazy working sets are a fraction of the catalogue', () => {
    const cat = lazyCatalogue(GAME_FILES);
    for (const [level, seeds] of [['subway', [11, 20261031]], ['office', [11, 20261031]]] as const) {
      for (const l of layoutsOf(level, [...seeds])) {
        const keys = keysOf(l);
        expect(selectLevelKeys(level, keys, WITH_MALL).foreign, `${level} ${l.seed}`).toEqual([]);
        const ws = levelWorkingSet(level, keys, GAME_FILES);
        expect(ws.levelOnly.files).toBe(0);
        expect(ws.total.bytes).toBeGreaterThan(0);
        expect(ws.total.bytes).toBeLessThan(cat.shared.bytes);
        console.info(`[level-assets] ${level} seed ${l.seed}: lazy working set ${ws.total.files} models / ${ws.total.bytes} B of a ${cat.shared.files}-model / ${cat.shared.bytes} B lazy catalogue`);
      }
    }
  });
});
