// Iteration 08 (primary): world-mapped THIN trim (railings, handrails, rods, conduits, pipes, rails, ladders) samples
// its surface maps without anisotropic filtering. In the iteration-08 browser QA (Firefox + Mesa llvmpipe) one
// 10k-triangle conduit mesh on the shared steel material took ~110 s to draw with 8x anisotropy and 25 ms at 1x,
// stalling the page at a stair foot. Broad surfaces keep the shared 8x maps.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials, isWorldMapped, surfaceMaterial, thinTrim} from '../src/world/materials';
import {surface} from '../src/world/canvasTextures';

installCanvasShim(false);

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
const maps = (m: THREE.MeshStandardMaterial) => [m.map, m.normalMap, m.roughnessMap, m.metalnessMap].filter((t): t is THREE.Texture => !!t);

describe('thin trim materials', () => {
  it('steel and rail trim sample without anisotropy; the shared surface maps keep 8x', () => {
    const mats = new WorldMaterials(fakeEnvTextures(), 7);
    for (const key of ['steel', 'rail'] as const) {
      const m = mats.get(key) as THREE.MeshStandardMaterial;
      expect(maps(m).length).toBeGreaterThan(0);
      for (const t of maps(m)) expect(t.anisotropy).toBe(1);
      expect(m.userData.worldMapping).toBeTruthy(); // still world-mapped (hooks kept)
      expect(isWorldMapped(m)).toBe(true);
    }
    for (const t of [surface('paintedSteel').map, surface('railSteel').map]) expect(t!.anisotropy).toBe(8);
  });
  it('thinTrim clones maps (same image) and keeps the world-mapping nodes (same program)', () => {
    const m = surfaceMaterial('brushedSteel', {metalness: 0.4});
    // Iteration 13 (MAT-A): node material; the world mapping is its context / normal / hook nodes.
    const nodes = [m.contextNode, m.normalNode, m.colorNode, m.roughnessNode], key = m.customProgramCacheKey();
    const src = m.map!;
    thinTrim(m);
    expect(m.map).not.toBe(src);
    expect(m.map!.image).toBe(src.image);
    expect(m.map!.anisotropy).toBe(1);
    expect(src.anisotropy).toBe(8);
    expect([m.contextNode, m.normalNode, m.colorNode, m.roughnessNode]).toEqual(nodes);
    expect(nodes.every(n => n !== null)).toBe(true);
    expect(m.customProgramCacheKey()).toBe(key);
  });
});

describe('wall detail thin fittings', () => {
  it('cable / steel / rust fittings use anisotropy-free trim materials', async () => {
    const {generateStation} = await import('../src/gen/station');
    const {buildWorld} = await import('../src/world/builder');
    const {codeToSeed} = await import('../src/core/rng');
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const world = buildWorld(generateStation(codeToSeed('1A2B3C')!), mats, {});
    const fit: THREE.Mesh[] = [];
    world.group.traverse(o => { if ((o as THREE.Mesh).isMesh && /^wall-detail-(cable|steel|rust)$/.test(o.name)) fit.push(o as THREE.Mesh); });
    expect(fit.length).toBeGreaterThan(0);
    for (const m of fit) for (const t of maps(m.material as THREE.MeshStandardMaterial)) expect(t.anisotropy, m.name).toBe(1);
  });
});
