// Task studio-pbr-material-pass-20261115-192427-01 (PBR material pass): surfaces behave like their intended substance. A material's
// `roughness` MULTIPLIES its surface set's roughness map, so finishes written as absolute values drew far glossier than meant
// (finishRoughness); glazed ceramics show the reflection probes like the station's wall tile ('gloss'); a plain clone keeps a
// loaded model's glass tag (the aim highlight); the player train's windows (and the glass lift) are lit glass, not an unlit film.
// Painted at full resolution through the canvas shim: the sets' real roughness maps.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {ROUGHNESS_MEAN, surface} from '../src/world/canvasTextures';
import {WorldMaterials, cloneSurfaceMaterial, finishRoughness, surfaceMaterial} from '../src/world/materials';
import {machineMaterial} from '../src/world/trackExt/machines';
import {MALL_DRESS_FINISH, mallDressMaterials} from '../src/world/mallArch';
import {LADDER_PAINT, ladderMaterial} from '../src/world/traversalBuilder';
import {shapeMaterial} from '../src/world/shapeMaterials';
import {archShopMaterial} from '../src/world/decay';
import {reflectClass} from '../src/world/reflectionNode';
import {reflectTagOf, tagReflect} from '../src/render/reflectTag';
import {materialKey} from '../src/render/runtimeVariants';
import {INTERIOR_DIELECTRIC, OpenableSet} from '../src/world/openables';
import {LENS_FINISH, controlSkin, lampSkin} from '../src/world/reactor/controlsSkin';
import {equipmentMaterials} from '../src/world/trainEquipmentModel';
import {cartMaterials} from '../src/world/fuelCartModel';
import {CAB_GLASS, cabGlassMaterial} from '../src/world/elevator';
import {TrainMaterials} from '../src/world/playerTrainView';
import {MODEL_MATERIAL_FIXES, applyModelMaterialFix} from '../src/assets/modelMaterialFixes';
import {MODEL_FILES} from '../src/assets/manifest';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {readFileSync} from 'node:fs';

installCanvasShim(true);

const fakeEnv = (): Record<TextureKey, THREE.Texture> => {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
};
const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
const meanOf = (m: THREE.Material): number => (m as THREE.MeshStandardMaterial).roughnessMap!.userData[ROUGHNESS_MEAN] as number;
/** The mean drawn roughness: three multiplies the material value by the map (clamped to 1 per texel; the means here stay below). */
const drawn = (m: THREE.Material): number => (m as THREE.MeshStandardMaterial).roughness * meanOf(m);

describe('surface sets: a measured roughness-map mean, and finishRoughness', () => {
  it('every set with a roughness map records its mean (the painted layer, 0..1)', () => {
    for (const [name, lo, hi] of [['paintedPanel', 0.45, 0.6], ['brushedSteel', 0.33, 0.45], ['black', 0.65, 0.8], ['porcelain', 0.1, 0.2], ['shopTile', 0.2, 0.4]] as const) {
      const s = surface(name);
      const mean = s.roughnessMap!.userData[ROUGHNESS_MEAN] as number;
      expect(mean, name).toBeGreaterThan(lo);
      expect(mean, name).toBeLessThan(hi);
    }
  });

  it('finishRoughness divides a finish by the map mean; without a measured map it is the finish itself', () => {
    const m = surfaceMaterial('paintedPanel');
    expect(finishRoughness(m, 0.9) * meanOf(m)).toBeCloseTo(0.9, 6);
    expect(finishRoughness(new THREE.MeshStandardMaterial(), 0.7)).toBe(0.7);
    const flat = new THREE.MeshStandardMaterial({roughnessMap: new THREE.Texture()});
    expect(finishRoughness(flat, 0.4)).toBe(0.4);
    // a clone of a set texture (thinTrim's anisotropy copies) keeps the mean
    expect(m.roughnessMap!.clone().userData[ROUGHNESS_MEAN]).toBe(meanOf(m));
  });
});

describe('finishes meant as absolute values draw as written', () => {
  it('annex machinery: canvas lagging matte, black parts matte, galvanised satin (not polished), paint satin', () => {
    const want = {lagging: 0.95, black: 0.95, galv: 0.55, boiler: 0.8, grey: 0.8, genset: 0.75, turbine: 0.7, yellow: 0.7} as const;
    for (const [k, f] of Object.entries(want) as [keyof typeof want, number][]) {
      const m = machineMaterial(mats, k);
      expect(drawn(m), k).toBeCloseTo(f, 5);
      // a roughness value only: it still shares its base material's program (lagging's own metalness 0 predates this pass)
      if (k !== 'lagging') expect(materialKey(m), k).toBe(materialKey(shapeMaterial(mats, k === 'black' ? 'black' : k === 'galv' ? 'steelBright' : k === 'grey' ? 'panel' : 'accent')));
    }
  });

  it('mall: matte roof membrane, honed stone coping, matte verdigris bronze', () => {
    const d = mallDressMaterials(mats);
    expect(drawn(d.membrane)).toBeCloseTo(MALL_DRESS_FINISH.membrane, 5);
    expect(drawn(d.fountainCoping)).toBeCloseTo(MALL_DRESS_FINISH.coping, 5);
    expect(drawn(d.fountainBronze)).toBeCloseTo(MALL_DRESS_FINISH.bronze, 5);
    expect(MALL_DRESS_FINISH.coping).toBeGreaterThan(0.4);
    expect(MALL_DRESS_FINISH.membrane).toBeGreaterThan(0.85);
    // the coping is stone, not a glaze: never a reflection candidate
    expect(reflectClass(d.fountainCoping)).toBe('none');
  });
});

describe('glazed ceramics show the reflection probes like the station wall tile', () => {
  it('shop tile (and its decayed arch copy), sanitary porcelain and the mall column tile are tagged gloss; quarry tile is not', () => {
    expect(reflectClass(mats.get('tileLower'))).toBe('gloss');
    for (const m of [shapeMaterial(mats, 'tileShop'), archShopMaterial(mats, 'tileShop'), shapeMaterial(mats, 'porcelain'), mallDressMaterials(mats).columnTile]) {
      expect(reflectClass(m), m.name).toBe('gloss');
      expect((m as THREE.MeshStandardMaterial).metalness, m.name).toBe(0);
    }
    expect(reflectClass(shapeMaterial(mats, 'quarryTile'))).toBe('none');
    expect(reflectClass(archShopMaterial(mats, 'quarryTile'))).toBe('none');
  });
});

describe('rescue ladders: safety-yellow paint, not brushed stainless', () => {
  it('a satin enamel finish and only a trace of the brushing', () => {
    const m = ladderMaterial(mats) as THREE.MeshStandardMaterial;
    expect(drawn(m)).toBeCloseTo(LADDER_PAINT.finish, 5);
    expect(m.normalScale.x).toBe(LADDER_PAINT.normal);
    expect(m.metalness).toBe(0.35);
    expect(m.color.getHex()).toBe(0xd6a020);
  });
});

describe('a plain clone keeps a loaded model\'s reflection tag', () => {
  it('cloneSurfaceMaterial of a classic (GLTFLoader) glass material is still glass: the aim highlight keeps its reflections', () => {
    const glass = tagReflect(new THREE.MeshStandardMaterial({transparent: true, opacity: 0.2, roughness: 0.06, metalness: 0}), 'glass');
    const c = cloneSurfaceMaterial(glass);
    expect(c).not.toBe(glass);
    expect(reflectTagOf(c)).toBe('glass');
    expect(reflectClass(c)).toBe('glass');
    // an untagged material stays untagged
    expect(reflectTagOf(cloneSurfaceMaterial(new THREE.MeshStandardMaterial()))).toBeUndefined();
  });
});

describe('the player train windows and the glass lift: lit glass on the station glass path', () => {
  it('one shared material: lit, tagged glass, clean, dielectric, the old tint, see-through, both faces, no depth write', () => {
    const g = cabGlassMaterial() as unknown as THREE.MeshStandardMaterial;
    expect(new TrainMaterials().glass()).toBe(g);
    expect(g.isMeshStandardMaterial).toBe(true); // lit: the field, its highlight and the flashlight's (no longer MeshBasic)
    expect(reflectTagOf(g)).toBe('glass');
    expect(reflectClass(g)).toBe('glass');
    expect(g.metalness).toBe(0);
    expect(g.roughness).toBe(CAB_GLASS.roughness);
    expect(g.roughness).toBeLessThan(0.15);
    expect(g.color.toArray()).toEqual([...CAB_GLASS.tint]);
    expect(g.transparent).toBe(true);
    expect(g.opacity).toBe(CAB_GLASS.opacity);
    expect(g.opacity).toBeLessThanOrEqual(0.25); // as clear as before face-on (0.14 rising toward a grazing view)
    expect(g.depthWrite).toBe(false);
    expect(g.side).toBe(THREE.DoubleSide);
    expect(g.name).toBe('tower-cab-glass');
    // no per-fragment opacity: the probe reflection's compensation divides by the material's opacity (world/reflectionNode.ts)
    expect((g as unknown as {opacityNode: unknown}).opacityNode ?? null).toBeNull();
  });
});

describe('props and equipment: dielectric parts are not metal', () => {
  it('holder interiors (plates, liners, cavities, knobs, white liners) are dielectric; the drawn diffuse tone is the old one', () => {
    const set = new OpenableSet() as unknown as {roleMat(role: string, paint: THREE.Color): THREE.MeshStandardMaterial; cavityMat(spec: {cavityRole?: string}, paint: THREE.Color): THREE.MeshStandardMaterial};
    const paint = new THREE.Color(0x6a7a70);
    for (const [role, k, oldMetal] of [['body', 0.62, 0.2], ['inner', 0.5, 0.2]] as const) {
      const m = set.roleMat(role, paint);
      expect(m.metalness, role).toBe(0);
      expect(reflectClass(m), role).toBe('none');
      // diffuse = albedo x (1 - metalness): the same as before for every channel
      expect(m.color.r, role).toBeCloseTo(paint.r * k * (1 - oldMetal), 6);
    }
    const cav = set.cavityMat({}, paint);
    expect(cav.metalness).toBe(0);
    expect(cav.color.g).toBeCloseTo(paint.g * 0.42 * (1 - 0.15), 6);
    for (const role of ['black', 'white']) expect(set.roleMat(role, paint).metalness, role).toBe(0);
    // painted / bare steel roles keep the house's partly-metal convention
    expect(set.roleMat('steelDark', paint).metalness).toBe(0.35);
    expect(set.roleMat('steelBright', paint).metalness).toBe(0.7);
    expect(INTERIOR_DIELECTRIC).toEqual({body: 0.8, cavity: 0.85});
  });

  it('reactor: an off signal lens is a glossy dielectric, phenolic parts are moulded resin (no paint chips, no metalness)', () => {
    const lens = lampSkin('lens') as THREE.MeshStandardMaterial;
    expect(lens.metalness).toBe(0);
    expect(drawn(lens)).toBeCloseTo(LENS_FINISH, 5);
    expect(lens.map).toBe(surface('black').map);
    const ph = controlSkin('phenolic') as THREE.MeshStandardMaterial;
    expect(ph.metalness).toBe(0);
    expect(ph.map).toBe(surface('black').map);
    expect(ph.name).toBe('reactor-ctl-phenolic');
  });

  it('plastic / rubber factory defaults: train plug sockets and lamps, the fuel hose (every train cable), gauges, tyres', () => {
    const E = equipmentMaterials();
    for (const k of ['plugSocket', 'standInFace', 'lampFree', 'lampOn'] as const) expect(E[k].metalness, k).toBe(0);
    expect(E.plugSteel.metalness).toBe(0.55);
    const C = cartMaterials();
    for (const k of ['hose', 'gaugeBack', 'gaugeFull', 'gaugeLow', 'gaugeMark', 'standTyre'] as const) expect(C[k].metalness, k).toBe(0);
    expect(C.standSteel.metalness).toBe(0.5);
  });
});

describe('a loaded model whose maps contradict its one plain substance: factor correction at load', () => {
  it('the chashu ramen (food in a glazed bowl) loads with metalness 0; its maps stay bound', () => {
    const tex = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({metalness: 1, roughness: 1, metalnessMap: tex, roughnessMap: tex});
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), mat), new THREE.Mesh(new THREE.BufferGeometry(), mat));
    expect(applyModelMaterialFix('item_ramen_chashu', {scene} as unknown as GLTF)).toBe(1);
    expect(mat.metalness).toBe(0);
    expect(mat.metalnessMap).toBe(tex);
    expect(mat.roughness).toBe(1);
    // any other model is untouched
    const other = new THREE.MeshStandardMaterial({metalness: 1});
    const s2 = new THREE.Group(); s2.add(new THREE.Mesh(new THREE.BufferGeometry(), other));
    expect(applyModelMaterialFix('item_ramen_bowl', {scene: s2} as unknown as GLTF)).toBe(0);
    expect(other.metalness).toBe(1);
  });

  it('every listed model is a real model key, and its cooked file still has what the fix corrects (metal factor 1 over a metal map)', () => {
    for (const [key, fix] of Object.entries(MODEL_MATERIAL_FIXES)) {
      const f = (MODEL_FILES as Record<string, {url: string}>)[key];
      expect(f, key).toBeTruthy();
      expect(fix.why.length, key).toBeGreaterThan(40);
      const buf = readFileSync(new URL(`../public/${f.url}`, import.meta.url));
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as {materials: {pbrMetallicRoughness?: {metallicFactor?: number; metallicRoughnessTexture?: unknown}}[]};
      for (const m of json.materials) {
        expect(m.pbrMetallicRoughness?.metallicFactor ?? 1, key).toBeGreaterThan(fix.metalness);
        expect(m.pbrMetallicRoughness?.metallicRoughnessTexture, key).toBeTruthy();
      }
    }
  });
});
