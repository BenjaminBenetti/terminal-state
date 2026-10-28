// Iteration 08 (Lane I): node fixtures for the openable holders — the runtime derivatives (textures stripped: node has no image
// decoder) and a small walled test hall that places any prop kinds in a row against its back wall.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {FLOOR, Grid, SOLID} from '../../src/gen/grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../src/gen/props';
import {MODEL_FILES, TEXTURE_FILES, type TextureKey} from '../../src/assets/manifest';
import {P7_FILES} from '../../src/gen/props07';
import {OPENABLE_SPECS} from '../../src/world/openablesSpec';
import type {StationLayout} from '../../src/gen/station';

const pub = (rel: string) => fileURLToPath(new URL('../../public/' + rel, import.meta.url));

export async function loadStripped(url: string): Promise<GLTF> {
  const io = new NodeIO();
  const doc = await io.read(pub(url));
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const bin = await io.writeBinary(doc);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
}

/** Every model an openable spec splits, keyed like the game's model record (assets/manifest keys + lazy p7_<kind> keys). */
export async function openableModels(): Promise<Record<string, GLTF>> {
  const out: Record<string, GLTF> = {};
  for (const spec of Object.values(OPENABLE_SPECS)) {
    const key = spec.model;
    if (!key || out[key]) continue;
    const file = (MODEL_FILES as Record<string, {url: string}>)[key] ?? P7_FILES[key];
    if (!file) throw new Error(`no model file for ${key}`);
    out[key] = await loadStripped(file.url);
  }
  return out;
}

export function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}

/**
 * A 40 x 15 m hall (cells 0.5 m) with a back wall at z = 1.5 m: the given kinds stand in a row, backs 3 cm off that wall (wall
 * cabinets at their mount height / lift), 0.6 m apart. `gap` = extra spacing (0 packs them side by side).
 */
export function rowLayout(kinds: readonly string[], o: {gap?: number; seed?: number; back?: number} = {}): StationLayout {
  const W = 120, H = 30;
  const g = new Grid(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g.set(x, y, y < 3 || x < 1 || x > W - 2 || y > H - 2 ? SOLID : FLOOR);
    g.ceil[g.idx(x, y)] = 4.2; // a real ceiling (unset ceilings read as 0)
  }
  const props: PropPlacement[] = [];
  let x = 1.0;
  const back = o.back ?? 1.53;
  for (const k of kinds) {
    const def = PROP_DEFS[k as PropKind];
    const {hx, hz} = footprint(k as PropKind, 0);
    const mountY = k === 'firstAidWallKit' ? 1.3 : k === 'aedWallCabinet' ? 1.2 : 0;
    const lift = k === 'fireExtinguisherCabinet' ? 0.6 : 0;
    const p: PropPlacement = {kind: k as PropKind, x: x + hx, z: back + hz, y: mountY, rot: 0, area: 0, hx, hz, h: def.h + lift, blocksSight: false, variant: props.length};
    if (lift) p.lift = lift;
    if (mountY) p.mounted = true;
    props.push(p);
    x += hx * 2 + (o.gap ?? 0.6);
  }
  return {
    seed: o.seed ?? 7, name: 'openables test hall', props, grid: g, areas: [{id: 0, type: 'storage', kind: 'room', x: 1, y: 3, w: W - 2, h: H - 4, label: 'Test hall'}], doors: [],
    playerSpawn: {x: 2, z: 6, yaw: 0}, lights: [], signs: [], pickups: [], zombies: [], decor: [], storefronts: [],
    trench: {floorY: -1.15}, trenches: [],
  } as unknown as StationLayout;
}

export const readJson = (rel: string) => JSON.parse(readFileSync(pub(rel), 'utf8'));
