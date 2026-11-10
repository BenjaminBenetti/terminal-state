// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane BUILD): the station builders Game.buildSection runs, on a REAL generated
// level of ANY kind (LEVEL_IDS) with the real (texture-stripped) models the game's lazy library would fetch for it — the world, the
// loot holders + display, the shelf stock, the light field bake and the fog density / air maps — plus FINGERPRINTS of what they
// built (every object in traversal order: type, name, flags, layers, matrices, userData, geometry attribute / index hashes, instance
// matrices / colours, a material key; holder lots; the field / map bytes). Two builds are identical when their fingerprints are.
// Timing stats (`ms` / `timing` / `*Ms` fields: wall-clock diagnostics) and object uuids / ids are left out.
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ShimContext, installCanvasShim} from './canvas2d';
import {fakeEnvTextures, loadStripped} from './openablesFixture';
import {LEVELS} from '../../src/levels/registry';
import type {LevelId} from '../../src/levels/types';
import type {StationLayout} from '../../src/gen/stationTypes';
import {WorldMaterials} from '../../src/world/materials';
import {p7ModelKeysFor, P7_FILES} from '../../src/gen/props07';
import {selectLevelKeys} from '../../src/assets/levelAssets';
import {MODEL_FILES} from '../../src/assets/manifest';
import {OFFICE_MODEL_FILES} from '../../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../../src/assets/mallAssets';
import {ANNEX_GENSET, gensetModelKeysFor} from '../../src/assets/annexGenset';
import {REACTOR_MODEL_FILES, reactorModelKeysFor} from '../../src/world/reactor/archAssets';
import {WASTE_MODEL_FILES, wasteModelKeysFor} from '../../src/world/reactor/wasteAssets';
import {minesModelKeysFor} from '../../src/world/reactor/minesAssets';
import {bunkerModelKeysFor} from '../../src/gen/reactor/complex/bunkerKinds';
import {LINGERIE_MODEL_FILES} from '../../src/ai/lingerie';
import {lingerieDisplayModelKeys} from '../../src/gen/mall/lingerieStore';
import {officeModelKeysFor} from '../../src/gen/office/index';
import {SKYWAYS_KITCHEN_MODEL_FILES, skywaysKitchenModelKeysFor} from '../../src/gen/skyways/kitchenKinds';
import {SKYWAYS_ADDON_MODEL_FILES, skywaysAddonModelKeysFor} from '../../src/gen/skyways/addonKinds';
import {SKYWAYS_DEST_MODEL_FILES, skywaysDestModelKeysFor} from '../../src/gen/skyways/destinations/skywaysDestModels';
import {skywaysGardenModelKeysFor} from '../../src/world/skywaysGardens';
import {SHELF_JUNK_KEY, SHELF_JUNK_MODEL_FILES, shelfJunkModelKeysFor} from '../../src/world/shelfStock';
import {BUNKER_KIT_MODEL_FILES, bunkerModelKindKeysFor} from '../../src/gen/bunker/bunkerKinds';

installCanvasShim(false);
for (const k of ['clip', 'rect']) (ShimContext.prototype as unknown as Record<string, unknown>)[k] ??= () => {};

/** The game's lazy model catalogue (game.ts propModels) minus the files no station builder reads (enemies, the train, people). */
const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...MALL_MODEL_FILES, [ANNEX_GENSET.key]: {url: ANNEX_GENSET.url, bytes: ANNEX_GENSET.bytes},
  ...REACTOR_MODEL_FILES, ...WASTE_MODEL_FILES, ...LINGERIE_MODEL_FILES, ...SKYWAYS_KITCHEN_MODEL_FILES, ...SKYWAYS_ADDON_MODEL_FILES, ...SKYWAYS_DEST_MODEL_FILES,
  ...SHELF_JUNK_MODEL_FILES, ...BUNKER_KIT_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const modelCache = new Map<string, Promise<GLTF>>();
const loadModel = (url: string) => { let m = modelCache.get(url); if (!m) modelCache.set(url, (m = loadStripped(url))); return m; };

/** The level's generated layout (the game's generator; its current layout version). */
export function layoutFor(level: LevelId, seed: number): StationLayout {
  const def = LEVELS[level];
  return def.generate(def.entry, {levelSeed: seed, startWeapon: 'pistol'} as never) as StationLayout;
}

/** The lazy keys the game's model hooks ask for on this layout (Game.modelKeysFor's world-builder share), selected for the level. */
export function lazyKeysFor(level: LevelId, layout: StationLayout): string[] {
  const L = layout as never;
  const keys = [...p7ModelKeysFor(layout), ...officeModelKeysFor(L), ...gensetModelKeysFor(L), ...lingerieDisplayModelKeys(L), ...shelfJunkModelKeysFor(L), ...bunkerModelKindKeysFor(L),
    ...skywaysKitchenModelKeysFor(L), ...skywaysAddonModelKeysFor(L), ...skywaysDestModelKeysFor(L), ...skywaysGardenModelKeysFor(L),
    ...reactorModelKeysFor(L), ...minesModelKeysFor(L), ...((layout as {reactor?: unknown}).reactor || (layout as {bunker?: unknown}).bunker ? bunkerModelKeysFor(L) : []), ...wasteModelKeysFor(L)];
  return selectLevelKeys(level, [...new Set(keys)], CATALOGUE).keys.filter(k => CATALOGUE[k]);
}

export interface LevelModels {
  /** The boot models (Game.assets.models). */
  boot: Record<string, GLTF>;
  /** The lazy record (Game.propModels.record()). */
  lazy: Record<string, GLTF>;
  /** boot + lazy, as buildWorld gets them. */
  all: Record<string, GLTF>;
}

export async function modelsFor(level: LevelId, layout: StationLayout): Promise<LevelModels> {
  const boot: Record<string, GLTF> = {}, lazy: Record<string, GLTF> = {};
  for (const [k, f] of Object.entries(MODEL_FILES as Record<string, {url: string}>)) boot[k] = await loadModel(f.url);
  for (const k of lazyKeysFor(level, layout)) lazy[k] = await loadModel(CATALOGUE[k].url);
  return {boot, lazy, all: {...boot, ...lazy}};
}

/** WorldMaterials as the game makes them (fixture box from the light model). */
export function materialsFor(models: LevelModels): WorldMaterials {
  const lb = new THREE.Box3().setFromObject(models.boot.light.scene).getSize(new THREE.Vector3());
  return new WorldMaterials(fakeEnvTextures(), 20261025, {w: lb.x, h: lb.y, d: lb.z});
}

export {SHELF_JUNK_KEY};

// ---------------------------------------------------------------------------------------------------------------------------
// Fingerprints

/** FNV-1a over the bytes of a typed array / number list (hex). */
export function hashBytes(a: ArrayLike<number> | ArrayBufferView | null | undefined): string {
  if (!a) return '-';
  let bytes: Uint8Array;
  if (ArrayBuffer.isView(a)) bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  else bytes = new Uint8Array(Float64Array.from(a as ArrayLike<number>).buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(16)}:${bytes.length}`;
}

/** Wall-clock diagnostics kept in data (e.g. world.group.userData.wallDetail.timing): never part of a fingerprint. */
const isTimingKey = (k: string) => k === 'ms' || k === 'timing' || /Ms$/.test(k);

/** userData / plain data as stable text: functions, objects of three and cycles by kind only; timing fields (isTimingKey) left out. */
export function stableText(v: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : String(v);
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'function') return 'fn';
  if (typeof v !== 'object') return typeof v;
  if (ArrayBuffer.isView(v)) return `typed(${hashBytes(v as ArrayBufferView)})`;
  if ((v as THREE.Object3D).isObject3D) return `obj(${(v as THREE.Object3D).type}:${(v as THREE.Object3D).name})`;
  if ((v as THREE.Material).isMaterial) return `mat(${(v as THREE.Material).type}:${(v as THREE.Material).name})`;
  if ((v as THREE.BufferGeometry).isBufferGeometry) return 'geo';
  if ((v as THREE.Texture).isTexture) return `tex(${(v as THREE.Texture).name})`;
  if (seen.has(v as object) || depth > 6) return 'ref';
  seen.add(v as object);
  if (Array.isArray(v)) return `[${v.map(x => stableText(x, depth + 1, seen)).join(',')}]`;
  if (v instanceof Map) return `map{${[...v.entries()].map(([k, x]) => `${stableText(k, depth + 1, seen)}=>${stableText(x, depth + 1, seen)}`).join(',')}}`;
  if (v instanceof Set) return `set{${[...v].map(x => stableText(x, depth + 1, seen)).join(',')}}`;
  return `{${Object.keys(v as object).filter(k => !isTimingKey(k)).sort().map(k => `${k}:${stableText((v as Record<string, unknown>)[k], depth + 1, seen)}`).join(',')}}`;
}

function geometryText(g: THREE.BufferGeometry): string {
  const attrs = Object.keys(g.attributes).sort().map(n => {
    const a = g.attributes[n] as THREE.BufferAttribute;
    return `${n}/${a.itemSize}/${a.count}/${a.normalized ? 'n' : ''}=${hashBytes(a.array as ArrayBufferView)}`;
  });
  return `${attrs.join(';')} idx=${hashBytes(g.index?.array as ArrayBufferView | undefined)} groups=${g.groups.map(x => `${x.start}+${x.count}@${x.materialIndex}`).join(',')} dr=${g.drawRange.start}+${g.drawRange.count} ud=${stableText(g.userData)}`;
}

/** A material's key: shared objects by first-seen order of identity is not portable across builds, so its own visible properties. */
function materialText(m: THREE.Material): string {
  const r = m as unknown as Record<string, unknown>;
  const col = (c: unknown) => ((c as THREE.Color)?.isColor ? (c as THREE.Color).getHexString() : '-');
  const tex = (t: unknown) => { const x = t as THREE.Texture | null, im = x?.image as {width?: number; height?: number} | undefined; return x?.isTexture ? `${x.name}|${im?.width ?? '?'}x${im?.height ?? '?'}` : '-'; };
  const nodes = Object.keys(r).filter(k => k.endsWith('Node') && r[k]).sort().join(',');
  return `${m.type}|${m.name}|c${col(r.color)}|e${col(r.emissive)}|o${m.opacity}|t${m.transparent}|s${m.side}|dw${m.depthWrite}|dt${m.depthTest}|vc${m.vertexColors}|map=${tex(r.map)}|n=${nodes}|ud=${stableText(m.userData)}`;
}

/** Every object under `root` (traversal order) as one line each. */
export function objectLines(root: THREE.Object3D): string[] {
  const out: string[] = [];
  const walk = (o: THREE.Object3D, depth: number) => {
    let s = `${depth} ${o.type} ${o.name} v${o.visible ? 1 : 0} l${o.layers.mask} cs${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0} ro${o.renderOrder} fc${o.frustumCulled ? 1 : 0} mau${o.matrixAutoUpdate ? 1 : 0}`
      + ` m=${hashBytes(Float64Array.from(o.matrix.elements))} ud=${stableText(o.userData)}`;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) {
      s += ` geo=${geometryText(mesh.geometry)}`;
      const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      s += ` mat=${ms.map(m => (m ? materialText(m) : '-')).join('+')}`;
    }
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) s += ` n=${im.count} im=${hashBytes(im.instanceMatrix.array as ArrayBufferView)} ic=${hashBytes(im.instanceColor?.array as ArrayBufferView | undefined)}`;
    const L = o as THREE.Light;
    if (L.isLight) s += ` light=${col3(L.color)}/${L.intensity}`;
    out.push(s);
    for (const c of o.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}
const col3 = (c: THREE.Color) => c.getHexString();

/** One hash over many lines (plus the count), for compact equality / evidence. */
export function linesHash(lines: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const l of lines) for (let i = 0; i < l.length; i++) { h ^= l.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(16)}:${lines.length}`;
}
