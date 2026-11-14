// Task studio-graphics-gpu-materials-toggle-20261114-212239-01 ("subway platform pillars must visibly read as metal"): the station
// columns are drawn with the brushed-steel 'pillar' material on every level that has a station storey (never the charcoal trim
// paint, which read as a black slab), still as one instanced mesh per column group, and nothing about the columns themselves moved
// (count, place, height: gen/stationDress.ts is untouched).
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {installCanvasShim} from './helpers/canvas2d';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {PILLAR_METALNESS, PILLAR_NORMAL, PILLAR_ROUGHNESS, WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import type {StationLayout} from '../src/gen/stationTypes';
import {reflectClass} from '../src/world/reflectionNode';

installCanvasShim(false);

const fakeEnv = (): Record<TextureKey, THREE.Texture> => {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
};

function columnsOf(layout: StationLayout): {mats: WorldMaterials; meshes: THREE.InstancedMesh[]; props: number} {
  const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const w = buildWorld(layout, mats, {});
  const meshes: THREE.InstancedMesh[] = [];
  w.group.traverse(o => { if (o.name === 'prop-column') meshes.push(o as THREE.InstancedMesh); });
  return {mats, meshes, props: layout.props.filter(p => p.kind === 'column').length};
}

describe('station columns: brushed-steel cladding', () => {
  it('a Subway station and the Office\'s station storey draw every column with the pillar material', () => {
    for (const [name, layout] of [['subway', generateStation(93)], ['office', generateOfficeLevel({levelSeed: 93, startWeapon: 'pistol'})]] as const) {
      const c = columnsOf(layout);
      expect(c.props, `${name}: the station has columns`).toBeGreaterThan(3);
      expect(c.meshes.length, name).toBeGreaterThan(0);
      expect(c.meshes.reduce((n, m) => n + m.count, 0), `${name}: one instance per column prop`).toBe(c.props);
      for (const m of c.meshes) {
        expect(m.isInstancedMesh, name).toBe(true);
        expect(m.material, name).toBe(c.mats.get('pillar'));
        expect(m.material, name).not.toBe(c.mats.get('steel'));
      }
    }
  });

  it('the pillar material: the existing brushed-steel set, world-mapped, a metal reflection candidate; the trim paint is unchanged', () => {
    const mats = new WorldMaterials(fakeEnv(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const pillar = mats.get('pillar') as THREE.MeshStandardMaterial, steel = mats.get('steel') as THREE.MeshStandardMaterial;
    expect([pillar.metalness, pillar.roughness]).toEqual([PILLAR_METALNESS, PILLAR_ROUGHNESS]);
    expect(pillar.normalScale.toArray()).toEqual([PILLAR_NORMAL, PILLAR_NORMAL]);
    expect(pillar.map && pillar.roughnessMap && pillar.normalMap).toBeTruthy();
    expect(pillar.transparent).toBe(false);
    expect(reflectClass(pillar)).toBe('metal');
    // (what the rails, railings and other trim are still drawn with)
    expect(steel.metalness).toBe(0.3);
    expect(steel.roughness).toBe(1);
    expect(mats.scale.pillar).toEqual({u: 1, v: 1});
    // no generated or new art: the set is the one the shelf decks and kitchen steel already use
    const src = readFileSync(new URL('../src/world/materials.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/this\.mats\.set\('pillar', surfaceMaterial\('brushedSteel', \{metalness: PILLAR_METALNESS, roughness: PILLAR_ROUGHNESS\}/);
    const builder = readFileSync(new URL('../src/world/builder.ts', import.meta.url), 'utf8');
    expect(builder).toMatch(/new THREE\.InstancedMesh\(geo, mats\.get\('pillar'\), list\.length\);/);
  });
});
