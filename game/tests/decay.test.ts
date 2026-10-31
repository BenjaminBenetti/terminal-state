// Iteration 12 (ARCH), mandate A: "Age the station walls and floor about 30 years, 30 years of no upkeep ... Only do
// walls / floor / ceiling surfaces." world/decay.ts: a deterministic per-station decay field (traffic lanes,
// openness, wetness, neglect), a generated detail texture, per-material profiles and one shader hook on the
// architectural materials only; world/wallDetailPlan.ts: 30-year condition + rust bleed below wall-mounted steel.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {levelFixture} from './helpers/levelRenderFixture';
import {ARCHETYPES, generateStation, type StationLayout} from '../src/gen/station';
import {CELL, FLOOR} from '../src/gen/grid';
import {TEXTURE_FILES, type TextureKey} from '../src/assets/manifest';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {stationLevels} from '../src/world/levelGeometry';
import {shapeMaterial} from '../src/world/shapeMaterials';
import {hasNodeHook, nodeHookKeys} from '../src/render/nodeHooks';
import {compileNodeMaterial} from './helpers/nodeCompile';
import {SurfaceNodeMaterial, WM_HOOK, WM_ROUGH_HOOK} from '../src/world/materials';
import {
  DECAY_HOOK, DECAY_MAT_KEYS, DECAY_ORDER, DECAY_PROFILES, DECAY_ROUGH_HOOK, DECAY_SHOP_KEYS, DECAY_UNIFORMS, DETAIL_SIZE, LEVEL_WETNESS, WET_CAP,
  applyDecay, archShopMaterial, areaNeglect, buildDecayField, decayDetailData, decayDetailTexture, sampleDecay, type DecayField, type DecayProfile,
} from '../src/world/decay';
import type {NodeMaterial} from 'three/webgpu';

/** Iteration 13 (MAT-A): decay is a node-hook pair on node materials. */
const hasShaderHook = (m: THREE.Material, key: string) => hasNodeHook(m as NodeMaterial, key);
import {WALL_AGE_30Y, planWallDetail} from '../src/world/wallDetailPlan';

function fakeEnvTextures(): Record<TextureKey, THREE.Texture> {
  const out = {} as Record<TextureKey, THREE.Texture>;
  for (const k of Object.keys(TEXTURE_FILES) as TextureKey[]) out[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
  return out;
}
const WALLS = ['tileLower', 'tileUpper', 'tileBase', 'tileShop', 'paint', 'tunnel', 'platformFace'] as const;
const FLOORS = ['terrazzo', 'concrete', 'platformSlab', 'safetyEdge', 'quarryTile', 'ballast'] as const;
const CEILINGS = ['ceiling', 'ceilingService'] as const;
const cache = new Map<string, StationLayout>();
const gen = (a: (typeof ARCHETYPES)[number], seed = 9001) => { const k = `${a}:${seed}`; if (!cache.has(k)) cache.set(k, generateStation(seed, {archetype: a})); return cache.get(k)!; };
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
const texel = (f: DecayField, L: number, i: number, c: number) => f.data[(L * f.w * f.h + i) * 4 + c] / 255;

describe('decay profiles: material-specific, bounded, purpose kept readable', () => {
  it('every architectural surface key has a profile in range; walls / floors / ceilings use their own vocabulary', () => {
    for (const k of [...DECAY_MAT_KEYS, ...DECAY_SHOP_KEYS]) expect(DECAY_PROFILES[k], k).toBeDefined();
    expect(new Set([...WALLS, ...FLOORS, ...CEILINGS])).toEqual(new Set([...DECAY_MAT_KEYS, ...DECAY_SHOP_KEYS]));
    for (const [k, p] of Object.entries(DECAY_PROFILES) as [string, DecayProfile][]) {
      for (const [n, v] of Object.entries(p)) {
        if (n === 'tint') { for (const c of v as number[]) { expect(c, `${k}.tint`).toBeGreaterThan(0.3); expect(c).toBeLessThan(1); } continue; }
        expect(v, `${k}.${n}`).toBeGreaterThanOrEqual(0);
        if (n !== 'tile') expect(v, `${k}.${n}`).toBeLessThanOrEqual(1);
      }
      // Colour aging stays bounded: tile stays cream, paint keeps its teal / cream, the safety edge stays mustard.
      expect(p.fade, k).toBeLessThanOrEqual(0.5);
    }
    for (const k of WALLS) { const p = DECAY_PROFILES[k]; expect(p.wear + p.dust + p.tile + p.tileLoss, k).toBe(0); expect(p.grime + p.streaks, k).toBeGreaterThan(0.8); }
    for (const k of FLOORS) { const p = DECAY_PROFILES[k]; expect(p.streaks + p.peel, k).toBe(0); expect(p.dust, k).toBeGreaterThan(0.2); }
    for (const k of CEILINGS) { const p = DECAY_PROFILES[k]; expect(p.wear + p.dust + p.streaks, k).toBe(0); expect(p.stains, k).toBeGreaterThan(0.5); }
    // Material identity: paint peels, tile does not; concrete blooms most; worn lanes only on floors; tiled floors lose tiles.
    expect(DECAY_PROFILES.paint.peel).toBeGreaterThan(0.5);
    expect(DECAY_PROFILES.tileLower.peel).toBe(0);
    expect(DECAY_PROFILES.tunnel.efflor).toBeGreaterThan(DECAY_PROFILES.tileLower.efflor);
    expect(DECAY_PROFILES.terrazzo.tile).toBe(1);
    expect(DECAY_PROFILES.safetyEdge.paintWear).toBe(1);
    expect(DECAY_PROFILES.concrete.tile).toBe(0);
  });

  it('zones: back of house, the lower level, dark rooms and the track bed decay more than platforms and halls', () => {
    const area = (o: object) => ({id: 0, x: 0, y: 0, w: 1, h: 1, kind: 'room', type: 'concourse', label: '', ceil: 3, parent: -1, depth: 0, publicSpace: true, lighting: 'lit', ...o}) as never;
    const platform = areaNeglect(area({kind: 'platform', type: 'platform'}), 'main', false);
    const hall = areaNeglect(area({}), 'main', false);
    const service = areaNeglect(area({type: 'service-corridor', publicSpace: false}), 'main', false);
    expect(service).toBeGreaterThan(platform + 0.15);
    expect(platform).toBeGreaterThan(hall - 0.01);
    expect(areaNeglect(area({}), 'lower', false)).toBeGreaterThan(hall);
    expect(areaNeglect(area({}), 'upper', false)).toBeLessThan(hall);
    expect(areaNeglect(area({lighting: 'dark'}), 'main', false)).toBeGreaterThan(hall);
    expect(areaNeglect(undefined, 'main', true)).toBeGreaterThanOrEqual(0.8);
    expect(LEVEL_WETNESS.lower).toBeGreaterThan(LEVEL_WETNESS.main);
    expect(LEVEL_WETNESS.main).toBeGreaterThan(LEVEL_WETNESS.upper);
  });
});

describe('decay field: deterministic per seed, coherent (lanes, edges, leaks, area patches) not uniform noise', () => {
  it('same seed -> identical field; another seed -> different', () => {
    const a = gen('island-ends'), lv = stationLevels(a);
    const f1 = buildDecayField(a, lv), f2 = buildDecayField(a, lv);
    expect(f1.data.length).toBe(f1.w * f1.h * f1.levels * 4);
    expect(Buffer.from(f1.data).equals(Buffer.from(f2.data))).toBe(true);
    const b = gen('island-ends', 1234), f3 = buildDecayField(b, stationLevels(b));
    expect(f3.w === f1.w && f3.h === f1.h && Buffer.from(f3.data).equals(Buffer.from(f1.data))).toBe(false);
    // The detail texture is deterministic too.
    expect(Buffer.from(decayDetailData(64, 7)).equals(Buffer.from(decayDetailData(64, 7)))).toBe(true);
  });

  it('every family: worn lanes at doorways, dust at the edges, wetter lower level, worse back of house, patchy', () => {
    const wetBy: Record<string, number[]> = {upper: [], main: [], lower: []};
    for (const fam of ARCHETYPES) {
      const l = gen(fam), lv = stationLevels(l), f = buildDecayField(l, lv);
      expect(f.levels).toBe(lv.length);
      const g = lv[0].grid, W = g.w;
      // Traffic: doorway thresholds vs floor cells far from any doorway.
      const doorCells = l.doors.filter(d => ((d as {level?: number}).level ?? 0) === 0).map(d => (d.y + (d.h >> 1)) * W + d.x + (d.w >> 1)).filter(i => g.cells[i] === FLOOR);
      const tDoor = mean(doorCells.map(i => texel(f, 0, i, 0)));
      const floors: number[] = [];
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && g.rampIdx[i] < 0) floors.push(i);
      const tAll = mean(floors.map(i => texel(f, 0, i, 0)));
      expect(tDoor, fam).toBeGreaterThan(tAll + 0.25);
      // Some floor is untouched (dust), some is a lane: not uniform.
      expect(floors.filter(i => texel(f, 0, i, 0) < 0.1).length / floors.length, fam).toBeGreaterThan(0.25);
      expect(floors.filter(i => texel(f, 0, i, 0) > 0.6).length / floors.length, fam).toBeGreaterThan(0.08);
      // Openness: cells against a wall are less open than the most open cells.
      const edge = floors.filter(i => [i - 1, i + 1, i - W, i + W].some(j => g.cells[j] !== FLOOR && g.cells[j] !== 2));
      expect(mean(edge.map(i => texel(f, 0, i, 1))), fam).toBeLessThan(0.75);
      // Neglect: back of house worse than platforms; spread across the floor (patches, not one value).
      const negOf = (pred: (a: StationLayout['areas'][number]) => boolean) => mean(floors.filter(i => g.area[i] >= 0 && pred(l.areas[g.area[i]])).map(i => texel(f, 0, i, 3)));
      expect(negOf(a => !a.publicSpace), fam).toBeGreaterThan(negOf(a => a.kind === 'platform') + 0.1);
      const neg = floors.map(i => texel(f, 0, i, 3)), m = mean(neg);
      expect(Math.sqrt(mean(neg.map(v => (v - m) ** 2))), fam).toBeGreaterThan(0.06);
      for (let L = 0; L < lv.length; L++) {
        const gl = lv[L].grid, cells: number[] = [];
        for (let i = 0; i < gl.cells.length; i++) if (gl.cells[i] === FLOOR) cells.push(i);
        wetBy[lv[L].role].push(mean(cells.map(i => texel(f, L, i, 2))));
      }
      // Wetness is capped (the lower level still reads as its finish with stains, not as a pattern).
      for (let L = 0; L < lv.length; L++) for (let i = 0; i < f.w * f.h; i++) expect(texel(f, L, i, 2)).toBeLessThanOrEqual(WET_CAP + 1 / 255);
      // Leaks exist but most of the floor is dry.
      const wetFloor = floors.filter(i => texel(f, 0, i, 2) > 0.3).length / floors.length;
      expect(wetFloor, fam).toBeGreaterThan(0.03);
      expect(wetFloor, fam).toBeLessThan(0.4);
    }
    expect(mean(wetBy.lower)).toBeGreaterThan(mean(wetBy.main));
    expect(mean(wetBy.main)).toBeGreaterThan(mean(wetBy.upper));
  });

  it('detail texture: no stamped shapes (smooth stain field, smooth grain), vertical runs only in A', () => {
    const N = 256, d = decayDetailData(N, 99);
    let maxR = 0, maxB = 0, runV = 0, runH = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4, r = (y * N + (x + 1) % N) * 4, u = (((y + 1) % N) * N + x) * 4;
      maxR = Math.max(maxR, Math.abs(d[i] - d[r]), Math.abs(d[i] - d[u]));
      maxB = Math.max(maxB, Math.abs(d[i + 2] - d[r + 2]), Math.abs(d[i + 2] - d[u + 2]));
      runV += Math.abs(d[i + 3] - d[u + 3]); runH += Math.abs(d[i + 3] - d[r + 3]);
    }
    // Stamped rings / dot splatter have hard edges (jumps of 100+ levels); the fBm fields change gradually.
    expect(maxR).toBeLessThan(60);
    expect(maxB).toBeLessThan(80);
    // Runs are vertical: they vary far more across x than along y.
    expect(runH).toBeGreaterThan(runV * 3);
  });

  it('sampleDecay reads the field like the shader (bilinear, per level)', () => {
    const l = gen('deep'), lv = stationLevels(l), f = buildDecayField(l, lv);
    const g = lv[0].grid;
    const i = [...g.cells.keys()].find(k => g.cells[k] === FLOOR)!;
    const x = (i % g.w + 0.5) * CELL, z = (Math.floor(i / g.w) + 0.5) * CELL;
    const s = sampleDecay(f, 0, x, z);
    expect(s.traffic).toBeCloseTo(texel(f, 0, i, 0), 6);
    expect(s.neglect).toBeCloseTo(texel(f, 0, i, 3), 6);
  });
});

describe('decay node hooks: architectural materials only, bounded cost', () => {
  it('hooks every wall / floor / ceiling material and NOT trim steel, track, props, signs or the shared shop materials', () => {
    const un = installCanvasShim(false);
    try {
      const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
      const w = buildWorld(levelFixture().layout, mats, {});
      for (const k of DECAY_MAT_KEYS) expect(hasShaderHook(mats.get(k), DECAY_HOOK), k).toBe(true);
      for (const k of ['steel', 'rail', 'sleeper', 'coverboard', 'crate', 'bin', 'gate', 'tube'] as const) expect(hasShaderHook(mats.get(k), DECAY_HOOK), k).toBe(false);
      for (const k of ['tileShop', 'quarryTile', 'steelDark', 'accent', 'counter', 'wood']) expect(hasShaderHook(shapeMaterial(mats, k), DECAY_HOOK), k).toBe(false);
      let arch = 0;
      w.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material)) return;
        const hooked = hasShaderHook(m.material, DECAY_HOOK);
        if (/^arch-/.test(m.name)) { expect(hooked, m.name).toBe(true); arch++; }
        if (/^(prop-|sign-|light-|shop-|shopfront-|purpose-|traversal-steel|traversal-ladders|wall-detail)/.test(m.name)) expect(hooked, m.name).toBe(false);
      });
      expect(arch).toBeGreaterThan(20);
      // The station's field is bound to the shared uniforms.
      expect(DECAY_UNIFORMS.uDecayMap.value).toBeInstanceOf(THREE.DataTexture);
      expect(DECAY_UNIFORMS.uDecayGrid.value.z).toBe(3);
    } finally { un(); }
  });

  // Iteration 13 (MAT-A): the GLSL hook is a TSL node-hook pair; this checks the GENERATED shader (three r186 GLSLNodeBuilder,
  // the WebGL2-backend path of WebGPURenderer). tests/surface-nodes.test.ts covers ordering / determinism / sharing.
  it('colour + roughness hooks at order 200; bounded cost: 3 light-field fetches, 4 texture fetches, no loops, no branches', () => {
    const m = new SurfaceNodeMaterial({map: new THREE.DataTexture(new Uint8Array(4), 1, 1), roughness: 0.62});
    applyDecay(m, DECAY_PROFILES.terrazzo);
    expect(nodeHookKeys(m)).toEqual([DECAY_HOOK, DECAY_ROUGH_HOOK]);
    expect(DECAY_ORDER).toBe(200);
    expect(m.decayP0.toArray()).toEqual([0.4, 0, 0.25, 0.55]);
    expect(m.decayP2.x).toBe(1);
    const sh = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), m), [new THREE.PointLight()]);
    const plain = compileNodeMaterial(new THREE.Mesh(new THREE.BoxGeometry(), new SurfaceNodeMaterial({map: m.map, roughness: 0.62})), [new THREE.PointLight()]);
    const main = sh.fragmentMain;
    const count = (code: string, s: string) => code.split(s).length - 1;
    expect(sh.vertex).toContain('vDecayN = ');
    expect(main).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
    // Station light field (level slot: column header + the extended-column group texel, read only in a tower column -
    // task office-seamless-20261029; band header): three texel fetches.
    expect(count(main, 'texelFetch(') - count(plain.fragmentMain, 'texelFetch(')).toBe(3);
    // Decay field + two detail samples + the 1D along-wall edge lookup (the albedo map is still sampled once).
    expect(count(main, 'texture(') - count(plain.fragmentMain, 'texture(')).toBe(4);
    // The decay maths never branches around a texture sample (WGSL uniformity): samples are top-level statements.
    for (const line of main.split('\n').filter(l => /= texture\(/.test(l))) expect(line, line).toMatch(/^\t\w+ = texture\(/);
    expect(main).toContain('dcRough = ');
    expect(main).toMatch(/Roughness = .*clamp\( \( nodeUniform\d+ \+ dcRough \), 0\.04, 1\.0 \)/);
    const t = decayDetailTexture();
    expect(t.anisotropy).toBe(16); // task mall-playtest-revision-20261031 (lane FIX, U08): 16x requested (software GL still clamps to 1)
    expect(t.generateMipmaps).toBe(true);
    expect(t.image.width).toBe(DETAIL_SIZE);
    expect(DECAY_UNIFORMS.uDecayTex.value).toBe(t);
  });

  it('storefront-unit finishes keep the iteration-12 composition: decay below the world-mapping grime', () => {
    const un = installCanvasShim(false);
    try {
      const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
      const shared = shapeMaterial(mats, 'tileShop'), arch = archShopMaterial(mats, 'tileShop');
      expect(arch).not.toBe(shared);
      expect(nodeHookKeys(shared as NodeMaterial)).toEqual([WM_HOOK, WM_ROUGH_HOOK]);
      expect(nodeHookKeys(arch as NodeMaterial)).toEqual([DECAY_HOOK, DECAY_ROUGH_HOOK, WM_HOOK, WM_ROUGH_HOOK]);
      expect((arch as SurfaceNodeMaterial).wmMap.toArray()).toEqual((shared as SurfaceNodeMaterial).wmMap.toArray());
      expect(arch.userData.worldMapping).toEqual(shared.userData.worldMapping);
    } finally { un(); }
  });
});

describe('wall treatment at 30 years: higher condition, rust bleed below wall-mounted steel', () => {
  it('rust runs start under wall sign plates / handrail brackets and stay on their face', () => {
    expect(WALL_AGE_30Y).toBeGreaterThan(0.05);
    let rust = 0, checked = 0;
    for (const fam of ['side-mezzanine', 'deep', 'express'] as const) {
      const l = gen(fam);
      const p = planWallDetail(l);
      for (const f of p.features) {
        if (f.kind !== 'streak' || !f.tint || Math.abs(f.tint[0] - 0.4) > 1e-9 || Math.abs(f.tint[1] - 0.22) > 1e-9) continue;
        rust++;
        const pf = p.faces[f.face];
        expect(f.y0).toBeGreaterThanOrEqual(pf.face.y0 - 1e-6);
        expect(f.y1).toBeLessThanOrEqual(pf.face.y1 + 1e-6);
        for (const o of pf.face.openings) expect(f.s1 <= o.s0 - 0.1 + 1e-6 || f.s0 >= o.s1 + 0.1 - 1e-6 || f.y0 >= o.top + 0.1 - 1e-6).toBe(true);
        checked++;
      }
    }
    expect(rust).toBeGreaterThan(10);
    expect(checked).toBe(rust);
  });
});
