// Iteration 05 (Lane R): Node smoke test of the storefront / purpose-prop renderer (no WebGL):
// builds a whole generated station's storefront group with stub shape materials and checks the
// merged purpose meshes, per-purpose menu boards and vertex-coloured accents.
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {generateStation} from '../src/gen/station';
import {PURPOSE_PROP_KINDS} from '../src/gen/props';
import {buildStorefronts} from '../src/world/storefrontBuilder';

describe('purpose prop rendering (Node, stub materials)', () => {
  it('bakes purpose props into chunk meshes with per-cuisine menus and tinted accents', () => {
    const uninstall = installCanvasShim(false);
    try {
      for (const seed of [9001, 424242]) {
        const layout = generateStation(seed);
        const group = new THREE.Group();
        const stub = new Map<string, THREE.Material>();
        const n = buildStorefronts(group, layout, {
          mat: k => { let m = stub.get(k); if (!m) stub.set(k, (m = new THREE.MeshStandardMaterial({name: `stub-${k}`}))); return m; },
          models: {},
          instanceModel: () => 0,
        });
        expect(n).toBeGreaterThan(0);
        const meshes: THREE.Mesh[] = [];
        group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
        const purpose = meshes.filter(m => m.name.startsWith('purpose-'));
        const placed = layout.props.filter(p => (PURPOSE_PROP_KINDS as readonly string[]).includes(p.kind)).length;
        expect(placed).toBeGreaterThan(20);
        expect(purpose.length).toBeGreaterThan(5);
        // Fewer meshes than placed fixtures × materials: parts are merged per chunk and material.
        expect(purpose.length).toBeLessThan(placed * 4);
        for (const m of purpose) {
          const pos = m.geometry.attributes.position.array as Float32Array;
          expect(pos.length).toBeGreaterThan(0);
          for (let i = 0; i < pos.length; i += 97) expect(Number.isFinite(pos[i])).toBe(true);
          if (m.name.endsWith('|accent')) {
            expect(m.geometry.attributes.color, m.name).toBeDefined();
            expect((m.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
          }
        }
        // Open food units get their own cuisine's menu board material.
        const menus = meshes.filter(m => m.name.startsWith('shopfront-menuBoard:'));
        const foodOpen = layout.storefronts.filter(s => s.food && s.unit >= 0);
        expect(new Set(menus.map(m => m.name)).size).toBe(new Set(foodOpen.map(s => s.use)).size);
        for (const m of menus) expect((m.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.Texture);
      }
    } finally {
      uninstall();
    }
  });
});
