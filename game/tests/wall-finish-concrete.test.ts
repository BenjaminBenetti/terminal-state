// Task track2-round2 R1 (lane CONCRETE): focused checks of the Beyond-the-Station concrete set (world/trackExt/wallFinish.ts).
// User: "Wall texture looks low detail still, likely due to the distance, it just doesn't give that concrete vibe." The fix moves
// the set's structure into the scales that survive minification (0.2-1.5 m) without growing it: these tests pin the budget (same
// three maps, same sizes, mipmapped), the untouched anisotropy request path, and the mid-scale structure itself, measured on box-
// filtered mips of the painted maps (rasterizing canvas shim; the R1 before values in comments come from tests/r1-concrete-preview).
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {mipChain} from './helpers/meshPreview';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {SURFACE_ANISOTROPY, anisotropyApplies, ANISO_ROLE} from '../src/render/anisotropy';
import {architectureRole, requestArchitectureAnisotropy} from '../src/world/surfaceAnisotropy';
import {ANNEX_MACRO, BOARD_NORMAL_SCALE, BOARD_PX, BOARD_SPAN, annexWallMaterial, boardFormedSet, resetBoardFormedSet, tunnelShellMaterial} from '../src/world/trackExt/wallFinish';

installCanvasShim(true);
resetBoardFormedSet();
const set = boardFormedSet();
const maps = [set.map, set.roughnessMap!, set.normalMap!];
const size = (t: THREE.Texture) => [(t.image as {width: number}).width, (t.image as {height: number}).height];

/** Per-mip statistics of `t` (colour: linear luminance; rough: G; normal: |xy| tilt). Level whose texel is >= `m` metres. */
function at(t: THREE.Texture, kind: 'color' | 'rough' | 'normal', m: number) {
  const levels = mipChain(t)!.levels;
  const lv = levels.find(l => BOARD_SPAN / l.w >= m - 1e-9) ?? levels[levels.length - 1];
  let s = 0, s2 = 0, mn = Infinity, mx = -Infinity;
  const n = lv.w * lv.h;
  for (let i = 0; i < n; i++) {
    const r = lv.d[i * 4], g = lv.d[i * 4 + 1], b = lv.d[i * 4 + 2];
    const v = kind === 'color' ? 0.2126 * r + 0.7152 * g + 0.0722 * b : kind === 'rough' ? g : Math.hypot(r * 2 - 1, g * 2 - 1);
    s += v; s2 += v * v; mn = Math.min(mn, v); mx = Math.max(mx, v);
  }
  const mean = s / n, std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  return {mean, std, rel: std / mean, min: mn, max: mx};
}

describe('extension concrete set (R1): budget, sampler path, mid-scale structure', () => {
  it('the same three maps at the same sizes, mipmapped and repeating; ~8 MiB resident with mips', () => {
    expect(size(set.map)).toEqual([BOARD_PX.color, BOARD_PX.color]);
    expect(size(set.roughnessMap!)).toEqual([BOARD_PX.detail, BOARD_PX.detail]);
    expect(size(set.normalMap!)).toEqual([BOARD_PX.detail, BOARD_PX.detail]);
    expect([BOARD_PX.color, BOARD_PX.detail]).toEqual([1024, 512]);
    for (const t of maps) {
      expect(t.generateMipmaps).toBe(true);
      expect([t.minFilter, t.magFilter]).toEqual([THREE.LinearMipmapLinearFilter, THREE.LinearFilter]);
      expect([t.wrapS, t.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping]);
    }
    expect(set.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect([set.roughnessMap!.colorSpace, set.normalMap!.colorSpace]).toEqual([THREE.NoColorSpace, THREE.NoColorSpace]);
    const mib = maps.reduce((a, t) => { const [w, h] = size(t); return a + (w * h * 4 * 4) / 3; }, 0) / 2 ** 20;
    expect(mib).toBeLessThanOrEqual(8.01);
  });

  it('anisotropy: created like every canvas surface set (8), the build-time architecture request lands 16 as "wall"', () => {
    // creation value: the normal map (built from the float relief field) matches the painter's maps exactly
    expect(maps.map(t => t.anisotropy)).toEqual([8, 8, 8]);
    const restore = installCanvasShim(false); // the station's own canvas sets need no pixels here (the concrete set is painted)
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    restore();
    const annex = annexWallMaterial(mats), shell = tunnelShellMaterial(mats);
    expect([architectureRole(annex), architectureRole(shell)]).toEqual(['wall', 'wall']);
    const g = new THREE.Group();
    for (const m of [annex, shell]) g.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m));
    requestArchitectureAnisotropy(g);
    for (const t of maps) {
      expect(t.anisotropy).toBe(SURFACE_ANISOTROPY);
      expect(t.userData[ANISO_ROLE]).toBe('wall');
      expect(anisotropyApplies(t)).toBe(true);
    }
    // material values (uniforms only: same programs as before)
    for (const m of [annex, shell] as THREE.MeshStandardMaterial[]) expect(m.normalScale.x).toBe(BOARD_NORMAL_SCALE);
    expect((annex.userData.worldMapping as {macro: number}).macro).toBe(ANNEX_MACRO);
  });

  it('mid-scale structure survives minification; no regular plank stripe; mean albedo kept', () => {
    // linear luminance, relative std at 0.3 m / 0.6 m texels (R1 before: 0.035 / 0.027) and mean (before 0.274)
    const c03 = at(set.map, 'color', 0.3), c06 = at(set.map, 'color', 0.6), c0 = at(set.map, 'color', 0);
    expect(c03.rel).toBeGreaterThan(0.07);
    expect(c06.rel).toBeGreaterThan(0.05);
    expect(c0.mean).toBeGreaterThan(0.26);
    expect(c0.mean).toBeLessThan(0.3);
    // roughness: a real range and mid-scale variation (before 0.75-1.0, std 0.026 at 7.5 cm, 0.020 at 0.3 m)
    const r0 = at(set.roughnessMap!, 'rough', 0), r75 = at(set.roughnessMap!, 'rough', 0.075), r3 = at(set.roughnessMap!, 'rough', 0.3);
    expect(r0.min).toBeLessThan(0.7);
    expect(r0.mean).toBeGreaterThan(0.75);
    expect(r0.mean).toBeLessThan(0.85);
    expect(r75.std).toBeGreaterThan(0.035);
    expect(r3.std).toBeGreaterThan(0.028);
    // relief present at the close-up and at the 7.5 cm mip (the normals do not mip to flat)
    expect(at(set.normalMap!, 'normal', 0).mean).toBeGreaterThan(0.05);
    expect(at(set.normalMap!, 'normal', 0.075).mean).toBeGreaterThan(0.02);
    // the vertical tone profile is not a 0.15 m periodic stripe (before: 67 % of its variance folded on 64 px; now ~2 %)
    const m = mipChain(set.map)!.levels[0], P = new Float64Array(m.h);
    for (let y = 0; y < m.h; y++) { let s = 0; for (let x = 0; x < m.w; x++) { const i = (y * m.w + x) * 4; s += 0.2126 * m.d[i] + 0.7152 * m.d[i + 1] + 0.0722 * m.d[i + 2]; } P[y] = s / m.w; }
    const mean = P.reduce((a, b) => a + b, 0) / m.h, per = Math.round(0.15 * m.h / BOARD_SPAN);
    let tot = 0;
    const f = new Float64Array(per), n = new Float64Array(per);
    for (let y = 0; y < m.h; y++) { tot += (P[y] - mean) ** 2; f[y % per] += P[y] - mean; n[y % per]++; }
    let v = 0;
    for (let k = 0; k < per; k++) v += (f[k] / n[k]) ** 2;
    expect((v / per) / (tot / m.h)).toBeLessThan(0.2);
  });
});
