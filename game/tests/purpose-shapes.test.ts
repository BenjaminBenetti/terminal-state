import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {PROP_DEFS, PURPOSE_PROP_KINDS, PURPOSE_SURFACES, SHELF_TIER_Y, type PurposePropKind} from '../src/gen/props';
import {STORE_PURPOSES} from '../src/gen/purposes';
import {disposePurposeMaterials, purposeMaterial, purposeMenuMaterial} from '../src/world/purposeTextures';
import {SHAPE_MAT_KEYS} from '../src/gen/propShapes';
import {
  PURPOSE_ACCENT, PURPOSE_KINDS_AUTHORED, PURPOSE_MAT_KEYS, SHAPE_VARIANTS, STOCK_MAT, STOCK_THEMES,
  purposePropShape, stockShelfStock, type PurposePart,
} from '../src/gen/purposeShapes';

type V3 = [number, number, number];

/** World-ish AABB of a part after rotateX(rx), rotateY(ry), translate(p) (renderer order). */
function partBox(p: PurposePart): {min: V3; max: V3} {
  const [sx, sy, sz] = p.s.map(v => v / 2);
  const cx = Math.cos(p.rx ?? 0), snx = Math.sin(p.rx ?? 0), cy = Math.cos(p.ry ?? 0), sny = Math.sin(p.ry ?? 0);
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const a of [-sx, sx]) for (const b of [-sy, sy]) for (const c of [-sz, sz]) {
    // rotateX
    const y1 = b * cx - c * snx, z1 = b * snx + c * cx;
    // rotateY
    const x2 = a * cy + z1 * sny, z2 = -a * sny + z1 * cy;
    const v: V3 = [x2 + p.p[0], y1 + p.p[1], z2 + p.p[2]];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
  }
  return {min, max};
}

const variantsOf = (k: PurposePropKind) => Array.from({length: SHAPE_VARIANTS[k] ?? 1}, (_, i) => i);
const ALLOWED = new Set<string>([...SHAPE_MAT_KEYS, ...PURPOSE_MAT_KEYS]);

describe('purpose prop shapes (authored parts)', () => {
  it('every purpose kind has a non-empty shape for every variant, with known material keys', () => {
    expect([...PURPOSE_KINDS_AUTHORED].sort()).toEqual([...PURPOSE_PROP_KINDS].sort());
    for (const k of PURPOSE_PROP_KINDS) {
      for (const v of variantsOf(k)) {
        const parts = purposePropShape(k, v);
        expect(parts, `${k}/${v}`).not.toBeNull();
        expect(parts!.length, `${k}/${v}`).toBeGreaterThan(2);
        expect(parts!.length, `${k}/${v} part budget`).toBeLessThanOrEqual(48);
        for (const p of parts!) {
          expect(ALLOWED.has(p.m), `${k} material ${p.m}`).toBe(true);
          expect(p.s.every(x => x > 0), `${k} positive size`).toBe(true);
        }
      }
    }
  });

  it('parts stay inside the PROP_DEFS footprint and height (1 cm tolerance)', () => {
    const tol = 0.01;
    for (const k of PURPOSE_PROP_KINDS) {
      const {w, d, h} = PROP_DEFS[k];
      for (const v of variantsOf(k)) {
        for (const p of purposePropShape(k, v)!) {
          const b = partBox(p);
          const tag = `${k}/${v} ${p.m} at ${p.p.map(x => x.toFixed(3)).join(',')}`;
          expect(b.min[0], tag).toBeGreaterThanOrEqual(-w / 2 - tol);
          expect(b.max[0], tag).toBeLessThanOrEqual(w / 2 + tol);
          expect(b.min[1], tag).toBeGreaterThanOrEqual(-tol);
          expect(b.max[1], tag).toBeLessThanOrEqual(h + tol);
          expect(b.min[2], tag).toBeGreaterThanOrEqual(-d / 2 - tol);
          expect(b.max[2], tag).toBeLessThanOrEqual(d / 2 + tol);
        }
      }
    }
  });

  it('holders keep their loot volumes free (supporting boards sit just below each surface)', () => {
    const e = 0.005;
    for (const [k, surfaces] of Object.entries(PURPOSE_SURFACES) as [PurposePropKind, typeof PURPOSE_SURFACES[keyof typeof PURPOSE_SURFACES]][]) {
      for (const v of variantsOf(k)) {
        for (const p of purposePropShape(k, v)!) {
          const b = partBox(p);
          surfaces.forEach((s, i) => {
            const hit = b.min[0] < s.x1 - e && b.max[0] > s.x0 + e && b.min[1] < s.y + s.clear - e && b.max[1] > s.y + e && b.min[2] < s.z1 - e && b.max[2] > s.z0 + e;
            expect(hit, `${k}/${v} ${p.m} at ${p.p.map(x => x.toFixed(3)).join(',')} intrudes surface ${i}`).toBe(false);
          });
        }
        // Each surface is supported: some part's top face lies at the surface height under it.
        surfaces.forEach((s, i) => {
          const support = purposePropShape(k, v)!.some(p => {
            const b = partBox(p);
            return Math.abs(b.max[1] - s.y) < 0.006 && b.min[0] <= s.x0 + 0.05 && b.max[0] >= s.x1 - 0.05 && b.min[2] <= s.z0 + 0.05 && b.max[2] >= s.z1 - 0.05;
          });
          expect(support, `${k}/${v} surface ${i} at ${s.y} has a deck under it`).toBe(true);
        });
      }
    }
  });

  it('stock shelves: themed back stock per variant, behind the loot band', () => {
    const front = PURPOSE_SURFACES.stockShelf;
    STOCK_THEMES.forEach((theme, v) => {
      const stock = stockShelfStock(v);
      expect(stock.length).toBe(3);
      stock.forEach((p, i) => {
        expect(p.m).toBe(STOCK_MAT[theme]);
        const b = partBox(p);
        expect(b.max[2]).toBeLessThanOrEqual(front[i].z0);
        expect(b.min[1]).toBeCloseTo(SHELF_TIER_Y[i], 6);
        expect(b.max[1]).toBeLessThan(SHELF_TIER_Y[i + 1] - 0.05);
        // ~3.6:1 front face (the stock textures are drawn for that aspect).
        expect(p.s[0] / p.s[1]).toBeGreaterThan(3);
      });
      const full = purposePropShape('stockShelf', v)!;
      for (const p of stock) expect(full.some(q => q.m === p.m && q.p.every((x, j) => x === p.p[j]))).toBe(true);
    });
  });

  it('every purpose material key draws a textured, cached material; menus per store purpose', () => {
    const uninstall = installCanvasShim(false);
    try {
      for (const k of PURPOSE_MAT_KEYS) {
        const m = purposeMaterial(k) as THREE.MeshStandardMaterial;
        expect(m.isMeshStandardMaterial, k).toBe(true);
        expect(m.map, k).toBeInstanceOf(THREE.Texture);
        expect(purposeMaterial(k), `${k} cached`).toBe(m);
        const world = k.startsWith('paint') || k === 'vinyl' || k === 'cardboard';
        if (world) expect(m.userData.worldMapping?.span?.length, k).toBe(2);
        if (k === 'deviceScreen' || k === 'cctv') expect(m.emissiveMap, k).toBe(m.map);
      }
      for (const p of Object.values(STORE_PURPOSES)) {
        if (!p.menu) continue;
        const m = purposeMenuMaterial(p.menu, p.id) as THREE.MeshStandardMaterial;
        expect(m.map, p.id).toBeInstanceOf(THREE.Texture);
        expect(m.emissiveMap).toBe(m.map);
        expect(purposeMenuMaterial(p.menu, p.id)).toBe(m);
      }
      disposePurposeMaterials();
      expect(purposeMaterial('stockSnacks')).not.toBeNull();
      disposePurposeMaterials();
    } finally {
      uninstall();
    }
  });

  it('accent palettes only for kinds that use the accent material', () => {
    for (const [k, pal] of Object.entries(PURPOSE_ACCENT) as [PurposePropKind, number[]][]) {
      expect(pal.length).toBeGreaterThan(0);
      expect(variantsOf(k).some(v => purposePropShape(k, v)!.some(p => p.m === 'accent')), k).toBe(true);
    }
  });
});
