// World materials: authored procedural-kit textures (wall, platform, ceiling, tunnel) mapped
// in real meters, plus procedural canvas materials for simple trim. See assets/manifest.ts.

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshBasicNodeMaterial, MeshStandardNodeMaterial, type MeshStandardNodeMaterialParameters, type Node, type NodeMaterial} from 'three/webgpu';
import {Fn, float, materialColor, materialRoughness, min, positionWorld, smoothstep, vec4} from 'three/tsl';
import type {TextureKey} from '../assets/manifest';
import {ENV_TEXTURE_LAYOUT} from '../assets/manifest';
import {addNodeHook, copyNodeHooks, hasNodeHook} from '../render/nodeHooks';
import {ballast, concreteFloor, crateWood, paintedBlock, signPlate, terrazzo, canvasTexture, surface, type SurfaceName} from './canvasTextures';
import {WM_CONTEXT, WM_NORMAL, asColor, isNodeMaterial, lfFloorAtNode, matRef, sharedStage, skipInShadowPass, wmNoise, wmUp} from './surfaceNodes';

/**
 * World-space box mapping for procedural geometry whose own UVs are 0..1 per face (BoxGeometry
 * trim, columns scaled per instance, prop/storefront parts). Each face is projected along its
 * dominant world axis in metres (vertical faces: u horizontal, v = world height), so textures keep
 * real scale at any size/instance scale and never stretch. Also adds a grime gradient toward the
 * floor (vertical faces only, world y = 0 is the station floor) and low-frequency world-space tone
 * variation so repeated props and long runs do not look identical. One shader variant shared by
 * every world-mapped material (per-material values are uniforms).
 */
export interface WorldMapping {
  /** Texture span in metres (u, v). */
  span: [number, number];
  /** Darkening toward the floor on vertical faces: [strength 0..1, height in m]. */
  grime?: [number, number];
  /** Low-frequency world-space tone variation, 0..1. */
  macro?: number;
  /** Map tops/bottoms with u along world Z (parts long in Z, e.g. track ties). */
  topAlongZ?: boolean;
}

// Iteration 13 (MAT-A): the iteration-04 GLSL hook (WM_VERTEX / WM_FRAGMENT_*, onBeforeCompile) is now TSL on node
// materials (world/surfaceNodes.ts): the same per-vertex projection (instance + model matrices, dominant world axis,
// span, topAlongZ) feeds every material map through the material context; the normal map's tangent frame follows the
// world coordinate; floor grime / macro tone are the 'world-mapped' colour + roughness hooks (render/nodeHooks.ts,
// order 100). Every world-mapped material still shares ONE program per map set (singleton graphs; per-material values
// are SurfaceNodeMaterial properties read through materialReference).

/**
 * Standard node material of the surface factories: per-material values of the shared surface graphs live here as
 * properties (copied by clone(); read per draw through materialReference), so materials differing only in values
 * share one program. Classic MeshStandardMaterial properties (map, color, roughness, normalScale, side, shadowSide,
 * vertexColors ...) behave as before.
 */
export class SurfaceNodeMaterial extends MeshStandardNodeMaterial {
  /** World mapping: (1 / span u, 1 / span v, unused, topAlongZ 0 / 1). */
  readonly wmMap = new THREE.Vector4(1, 1, 0, 0);
  /** World-mapping grime: (floor grime strength, grime height m, macro tone variation). */
  readonly wmGrime = new THREE.Vector3(0, 0.5, 0);
  /** 30-year decay profile (world/decay.ts applyDecay): grime, streaks, efflorescence, stains. */
  readonly decayP0 = new THREE.Vector4(0, 0, 0, 0);
  /** Decay: wear, dust, cracks, peel. */
  readonly decayP1 = new THREE.Vector4(0, 0, 0, 0);
  /** Decay: tile grid (m), tile loss, fade, paint wear. */
  readonly decayP2 = new THREE.Vector4(0, 0, 0, 0);
  /** Decay grime / water tint. */
  readonly decayTint = new THREE.Vector3(1, 1, 1);

  /** three r186 NodeMaterial.copy() drops alphaTest (its accessor lives on Material.prototype, `_alphaTest` is skipped). */
  copy(source: this): this {
    super.copy(source);
    this.alphaTest = source.alphaTest;
    return this;
  }
}

/** World-mapping hook keys (colour / roughness) and their stage order (render/nodeHooks.ts: surface mapping = 100). */
export const WM_HOOK = 'world-mapped';
export const WM_ROUGH_HOOK = 'world-mapped-roughness';
export const WM_ORDER = 100;

const wmGrime = matRef('wmGrime', 'vec3');
/** Floor grime weight: height above the local level floor (station light field) on vertical faces only. */
const WM_FLOOR = (Fn(() => {
  const local = positionWorld.y.sub(lfFloorAtNode(positionWorld));
  return float(1).sub(smoothstep(0.0, wmGrime.y, local)).mul(float(1).sub(smoothstep(0.5, 0.8, wmUp)));
}, 'float')() as unknown as Node<'float'>).toVar('wmFloor');
/** Albedo factor: floor grime and low-frequency world-space tone variation (GLSL WM_FRAGMENT_MAP). */
const WM_SHADE = float(1).sub(wmGrime.x.mul(WM_FLOOR)).mul(float(1).add(wmGrime.z.mul(wmNoise(positionWorld.mul(0.7)).sub(0.5)).mul(2.0)));
const wmColorStage = sharedStage(prev => {
  const c = asColor(prev, materialColor);
  return skipInShadowPass(vec4(c.rgb.mul(WM_SHADE), c.a), c, 'vec4');
});
const wmRoughStage = sharedStage(prev => min(1.0, float((prev ?? materialRoughness) as Node<'float'>).add(wmGrime.x.mul(0.3).mul(WM_FLOOR))));

export function worldMapped<M extends SurfaceNodeMaterial>(m: M, o: WorldMapping, order = WM_ORDER): M {
  m.wmMap.set(1 / o.span[0], 1 / o.span[1], 0, o.topAlongZ ? 1 : 0);
  m.wmGrime.set(o.grime?.[0] ?? 0, Math.max(0.01, o.grime?.[1] ?? 0.5), o.macro ?? 0);
  m.userData.worldMapping = o;
  m.contextNode = WM_CONTEXT;
  m.normalNode = WM_NORMAL;
  addNodeHook(m, {key: WM_HOOK, stage: 'color', order, fn: wmColorStage});
  addNodeHook(m, {key: WM_ROUGH_HOOK, stage: 'roughness', order, fn: wmRoughStage});
  return m;
}

/** Whether `m` is a world-mapped surface material. */
export const isWorldMapped = (m: THREE.Material): boolean => hasNodeHook(m as NodeMaterial, WM_HOOK);

/** A shared generated surface set as a (world-mapped unless `face`) standard material. */
export function surfaceMaterial(name: SurfaceName, params: MeshStandardNodeMaterialParameters = {}, mapping: Omit<WorldMapping, 'span'> & {normal?: number} = {}): SurfaceNodeMaterial {
  const s = surface(name);
  const m = new SurfaceNodeMaterial({map: s.map, roughnessMap: s.roughnessMap, normalMap: s.normalMap, roughness: 1, metalness: 0, ...params});
  if (s.normalMap) m.normalScale.set(mapping.normal ?? 1, mapping.normal ?? 1);
  return worldMapped(m, {span: s.span, ...mapping});
}

/**
 * Iteration 08 (primary): world-mapped trim on THIN geometry (railings, handrails, rods, conduits, pipes, rails)
 * samples its shared surface maps without anisotropic filtering. World mapping switches projection plane around a
 * thin cylinder/box, so UV derivatives across it are extreme; with 8x anisotropy Mesa llvmpipe spent ~110 s drawing
 * one 10k-triangle conduit mesh (25 ms at 1x) and a station view with railings stalled the browser. Texture clones
 * share the canvas image; only this material's GPU copies differ. Broad surfaces keep the 8x shared maps.
 */
export function thinTrim<M extends MeshStandardNodeMaterial>(m: M): M {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'] as const) {
    const t = m[k];
    if (!t || t.anisotropy <= 1) continue;
    const c = t.clone();
    c.anisotropy = 1;
    c.needsUpdate = true;
    m[k] = c;
  }
  return m;
}

/**
 * Iteration 13 (MAT-A): clone a (node) material with its node hooks: Material.clone() copies the folded node slots and
 * SurfaceNodeMaterial values, copyNodeHooks the hook chain (so later hooks on the clone fold over the same stages).
 * Replaces render/shaderHooks.ts cloneWithShaderHooks for surface materials.
 */
export function cloneSurfaceMaterial<M extends THREE.Material>(m: M): M {
  const c = m.clone() as M;
  // three r186 NodeMaterial.copy() drops alphaTest (side / shadowSide / transparent / depthWrite / polygon offset survive).
  c.alphaTest = m.alphaTest;
  if (isNodeMaterial(m)) copyNodeHooks(m, c as unknown as NodeMaterial);
  return c;
}

export type MatKey =
  | 'tileLower' | 'tileUpper' | 'tileBase' | 'paint' | 'terrazzo' | 'concrete' | 'platformSlab' | 'safetyEdge' | 'platformFace'
  | 'ceiling' | 'ceilingService' | 'tunnel' | 'ballast' | 'steel' | 'rail' | 'sleeper' | 'coverboard'
  | 'crate' | 'bin' | 'gate' | 'tube';

/**
 * Iteration 12 (ARCH): the wall texture's two charcoal base courses (0-0.3 m of ENV_TEXTURE_LAYOUT.wall, the same
 * 85 px / 0.2989 m crop height as the plain upper courses), tiling vertically every two courses: the raked skirting
 * of stair-flight side walls (levelGeometry.stairWallZones), coursed level in world height.
 */
export const TILE_BASE_CROP = {v0: 0.0012 / 1.8, v1: 0.3001 / 1.8};

/** Crop a sub-rectangle of a loaded texture image into a new tiling texture. */
function cropTexture(src: THREE.Texture, u0: number, v0: number, u1: number, v1: number, srgb: boolean): THREE.Texture {
  const img = src.image as HTMLImageElement | ImageBitmap;
  const w = img.width, h = img.height;
  // UV v=0 is the image bottom.
  const sx = Math.round(u0 * w), sw = Math.max(1, Math.round((u1 - u0) * w));
  const sy = Math.round((1 - v1) * h), sh = Math.max(1, Math.round((v1 - v0) * h));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  c.getContext('2d')!.drawImage(img as CanvasImageSource, sx, sy, sw, sh, 0, 0, sw, sh);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export class WorldMaterials {
  readonly scale: Record<MatKey, {u: number; v: number}>;
  readonly tileLowerHeight: number;
  readonly fixture = {w: 1.2, h: 0.19, d: 0.18};
  private readonly mats = new Map<MatKey, THREE.Material>();
  private readonly signCache = new Map<string, THREE.Texture>();

  constructor(tex: Record<TextureKey, THREE.Texture>, seed: number, fixtureDims?: {w: number; h: number; d: number}) {
    if (fixtureDims) Object.assign(this.fixture, fixtureDims);
    const L = ENV_TEXTURE_LAYOUT;
    this.tileLowerHeight = L.wall.h;
    const c = L.wall.upperCrop;
    const upperW = (c.u1 - c.u0) * L.wall.w, upperH = (c.v1 - c.v0) * L.wall.h;
    const bc = TILE_BASE_CROP, baseH = (bc.v1 - bc.v0) * L.wall.h;
    this.scale = {
      tileLower: {u: L.wall.w, v: L.wall.h},
      tileUpper: {u: upperW, v: upperH},
      tileBase: {u: L.wall.w, v: baseH},
      paint: {u: 2.4, v: 3.0},
      terrazzo: {u: 2, v: 2},
      concrete: {u: 2, v: 2},
      platformSlab: {u: L.platform.w, v: L.platform.h},
      safetyEdge: {u: L.edge.w, v: L.edge.h},
      platformFace: {u: L.backing.w, v: L.backing.h},
      ceiling: {u: L.ceiling.w, v: L.ceiling.h},
      ceilingService: {u: L.ceiling.w, v: L.ceiling.h},
      tunnel: {u: L.tunnel.w, v: L.tunnel.h},
      ballast: {u: 2, v: 2},
      steel: {u: 1, v: 1}, rail: {u: 1, v: 1}, sleeper: {u: 1, v: 1}, coverboard: {u: 1, v: 1},
      crate: {u: 1, v: 1}, bin: {u: 1, v: 1}, gate: {u: 1, v: 1}, tube: {u: 1, v: 1},
    };
    // Iteration 13 (MAT-A): node materials (decay and other lanes' hooks layer onto them).
    const std = (o: MeshStandardNodeMaterialParameters) => new SurfaceNodeMaterial({roughness: 0.85, metalness: 0, ...o});
    const pbr = (color: THREE.Texture, orm: THREE.Texture, normal: THREE.Texture, extra: MeshStandardNodeMaterialParameters = {}) =>
      std({map: color, roughnessMap: orm, metalnessMap: orm, normalMap: normal, normalScale: new THREE.Vector2(L.normalScale, L.normalScale), roughness: 1, metalness: 1, ...extra});

    this.mats.set('tileLower', pbr(tex.wallColor, tex.wallOrm, tex.wallNormal));
    this.mats.set('tileUpper', pbr(
      cropTexture(tex.wallColor, c.u0, c.v0, c.u1, c.v1, true),
      cropTexture(tex.wallOrm, c.u0, c.v0, c.u1, c.v1, false),
      cropTexture(tex.wallNormal, c.u0, c.v0, c.u1, c.v1, false)));
    // Iteration 12 (ARCH): the two charcoal base courses alone, for the raked skirting of stair-flight walls.
    this.mats.set('tileBase', pbr(
      cropTexture(tex.wallColor, 0, bc.v0, 1, bc.v1, true),
      cropTexture(tex.wallOrm, 0, bc.v0, 1, bc.v1, false),
      cropTexture(tex.wallNormal, 0, bc.v0, 1, bc.v1, false)));
    this.mats.set('platformSlab', pbr(tex.platformColor, tex.platformOrm, tex.platformNormal));
    this.mats.set('safetyEdge', pbr(tex.edgeColor, tex.edgeOrm, tex.edgeNormal));
    this.mats.set('ceiling', pbr(tex.ceilingColor, tex.ceilingOrm, tex.ceilingNormal));
    this.mats.set('ceilingService', pbr(tex.ceilingColor, tex.ceilingOrm, tex.ceilingNormal, {color: 0xb8b4aa}));
    this.mats.set('tunnel', pbr(tex.tunnelColor, tex.tunnelOrm, tex.tunnelNormal));
    this.mats.set('platformFace', pbr(tex.backingColor, tex.backingOrm, tex.backingNormal, {color: 0xa8a49b}));
    this.mats.set('paint', std({map: paintedBlock(seed + 1), roughness: 0.9}));
    this.mats.set('terrazzo', std({map: terrazzo(seed + 2), roughness: 0.62}));
    this.mats.set('concrete', std({map: concreteFloor(seed + 3), roughness: 0.92}));
    this.mats.set('ballast', std({map: ballast(seed + 4), roughness: 1}));
    // Iteration 04: trim/columns/track use shared world-mapped surface sets (real-scale, no stretching
    // on instance-scaled columns or long boxes), consistent with the procedural prop materials.
    this.mats.set('steel', thinTrim(surfaceMaterial('paintedSteel', {metalness: 0.3}, {grime: [0.3, 0.45], macro: 0.15})));
    this.mats.set('rail', thinTrim(surfaceMaterial('railSteel', {metalness: 0.45}, {grime: [0.12, 0.4], macro: 0.12})));
    this.mats.set('sleeper', surfaceMaterial('timberTie', {}, {topAlongZ: true, macro: 0.2}));
    this.mats.set('coverboard', surfaceMaterial('coverboard', {}, {macro: 0.2}));
    this.mats.set('crate', std({map: crateWood(seed + 6), roughness: 0.9}));
    const binTex = canvasTexture(128, 128, seed + 7, (ctx, w, h) => {
      ctx.fillStyle = '#2a2d30'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9971f'; ctx.fillRect(0, h * 0.18, w, h * 0.1);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; for (let x = 0; x < w; x += 8) ctx.fillRect(x, 0, 2, h);
    });
    this.mats.set('bin', std({map: binTex, roughness: 0.6, metalness: 0.3}));
    const gateTex = canvasTexture(128, 256, seed + 8, (ctx, w, h) => {
      ctx.fillStyle = '#34393d'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d9a520'; ctx.fillRect(0, 0, w, h * 0.07);
      ctx.fillStyle = '#4f8a87'; ctx.fillRect(w * 0.2, h * 0.25, w * 0.6, h * 0.08);
    });
    this.mats.set('gate', std({map: gateTex, roughness: 0.5, metalness: 0.4}));
    this.mats.set('tube', new MeshBasicNodeMaterial({color: 0xfff4dc}));
  }

  get(k: MatKey): THREE.Material {
    const m = this.mats.get(k);
    if (!m) throw new Error(`material ${k}`);
    return m;
  }

  makeSign(kind: 'station' | 'exit' | 'service', text: string, signModel?: GLTF): THREE.Object3D {
    const key = kind + ':' + text;
    let tex = this.signCache.get(key);
    if (!tex) { tex = signPlate(text.toUpperCase(), kind, text.length * 31 + kind.length); this.signCache.set(key, tex); }
    const group = new THREE.Group();
    const w = kind === 'station' ? 1.8 : 1.2, h = kind === 'station' ? 0.38 : 0.26;
    if (kind === 'station' && signModel) {
      // Authored sign plate derivative as the frame/backing; the station name is a decal.
      const s = signModel.scene.clone(true);
      const box = new THREE.Box3().setFromObject(s);
      const size = box.getSize(new THREE.Vector3());
      s.scale.set(w / size.x, h / size.y, 1);
      const center = box.getCenter(new THREE.Vector3());
      s.position.set(-center.x * s.scale.x, -center.y * s.scale.y, -box.min.z);
      group.add(s);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, h * 0.8), new MeshStandardNodeMaterial({map: tex, roughness: 0.6}));
      face.position.z = size.z + 0.004;
      group.add(face);
    } else {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), [
        this.get('steel'), this.get('steel'), this.get('steel'), this.get('steel'),
        new MeshStandardNodeMaterial({map: tex, roughness: 0.6}), this.get('steel'),
      ]);
      plate.position.z = 0.012;
      group.add(plate);
    }
    return group;
  }
}
