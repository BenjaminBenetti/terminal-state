// Task studio-baked-lighting-reflections-20261114-050258-01: the Enhanced lighting POLICY (world/enhancedLighting.ts
// planEnhancedLighting) — what Off / Auto / On build from the renderer's real capabilities, and the reasons they report.
// - Off: nothing, no reason; the Reactor: the baseline under every setting, with its reason;
// - Auto: the standard bake everywhere; reflections only on the hardware WebGPU backend whose limits fit — a software renderer, the
//   WebGL 2 fallback, an unready renderer or one that cannot filter half floats get the bake alone, each with its own reason;
// - On: the high bake, and reflections on anything that can run them (software and the fallback included);
// - limits: High falls back to Standard when the atlas does not fit, and to none when Standard does not either — and says so;
// - nothing in the policy reads memory: the capabilities have no such field and the module reads no memory API.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  ENHANCED_LIGHTING_DEFAULT, ENHANCED_LIGHTING_MODES, FALLBACK_REASON, GI_TIERS, REACTOR_REASON, REFLECTIONS_DEFAULT, REFLECTION_QUALITIES, REFLECTION_TIERS, SOFTWARE_REASON,
  planEnhancedLighting, planSignature, reflectionAtlasEdge, type LightingCapabilities,
} from '../src/world/enhancedLighting';
import {PROBE_COLS, probeAtlasLayout} from '../src/world/reflectionProbes';

const GPU: LightingCapabilities = {backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};
const station = {reactor: false};

describe('the plan', () => {
  it('defaults: Auto with Standard reflections', () => {
    expect([ENHANCED_LIGHTING_DEFAULT, REFLECTIONS_DEFAULT]).toEqual(['auto', 'standard']);
    expect(planEnhancedLighting({lighting: ENHANCED_LIGHTING_DEFAULT, reflections: REFLECTIONS_DEFAULT}, GPU, station))
      .toEqual({gi: GI_TIERS.standard, reflections: REFLECTION_TIERS.standard, giReason: null, reflectionsReason: null});
  });

  it('Off builds nothing and gives no reason, whatever the reflections choice or the renderer', () => {
    for (const reflections of REFLECTION_QUALITIES) for (const caps of [GPU, {...GPU, software: true}, {...GPU, backend: null}] as LightingCapabilities[]) {
      expect(planEnhancedLighting({lighting: 'off', reflections}, caps, station)).toEqual({gi: null, reflections: null, giReason: null, reflectionsReason: null});
      expect(planEnhancedLighting({lighting: 'off', reflections}, caps, {reactor: true})).toEqual({gi: null, reflections: null, giReason: null, reflectionsReason: null});
    }
  });

  it('the Reactor keeps its lighting under Auto and On, and says why', () => {
    for (const lighting of ['auto', 'on'] as const) {
      expect(planEnhancedLighting({lighting, reflections: 'high'}, GPU, {reactor: true})).toEqual({gi: null, reflections: null, giReason: REACTOR_REASON, reflectionsReason: REACTOR_REASON});
      expect(planEnhancedLighting({lighting, reflections: 'off'}, GPU, {reactor: true})).toEqual({gi: null, reflections: null, giReason: REACTOR_REASON, reflectionsReason: null});
    }
  });

  it('Auto: the standard bake everywhere; reflections only on the hardware WebGPU backend', () => {
    const auto = (caps: LightingCapabilities, reflections: 'standard' | 'high' | 'off' = 'standard') => planEnhancedLighting({lighting: 'auto', reflections}, caps, station);
    expect(auto(GPU, 'high')).toMatchObject({gi: GI_TIERS.standard, reflections: REFLECTION_TIERS.high, reflectionsReason: null});
    expect(auto(GPU, 'off')).toEqual({gi: GI_TIERS.standard, reflections: null, giReason: null, reflectionsReason: null});
    expect(auto({...GPU, software: true})).toEqual({gi: GI_TIERS.standard, reflections: null, giReason: null, reflectionsReason: SOFTWARE_REASON});
    expect(auto({...GPU, backend: 'webgl2'})).toEqual({gi: GI_TIERS.standard, reflections: null, giReason: null, reflectionsReason: FALLBACK_REASON});
    expect(auto({...GPU, backend: 'webgl2', software: true}).reflectionsReason).toBe(SOFTWARE_REASON);
    expect(auto({...GPU, backend: null})).toMatchObject({gi: GI_TIERS.standard, reflections: null, reflectionsReason: 'the renderer is not ready'});
    expect(auto({...GPU, halfFloatLinear: false})).toMatchObject({reflections: null, reflectionsReason: 'this renderer cannot filter half-float textures'});
  });

  it('On: the high bake, and reflections on any renderer that can run them', () => {
    const on = (caps: LightingCapabilities, reflections: 'standard' | 'high' | 'off' = 'standard') => planEnhancedLighting({lighting: 'on', reflections}, caps, station);
    expect(on(GPU)).toEqual({gi: GI_TIERS.high, reflections: REFLECTION_TIERS.standard, giReason: null, reflectionsReason: null});
    expect(on({...GPU, software: true})).toMatchObject({gi: GI_TIERS.high, reflections: REFLECTION_TIERS.standard, reflectionsReason: null});
    expect(on({...GPU, backend: 'webgl2'}, 'high')).toMatchObject({gi: GI_TIERS.high, reflections: REFLECTION_TIERS.high, reflectionsReason: null});
    expect(on(GPU, 'off')).toEqual({gi: GI_TIERS.high, reflections: null, giReason: null, reflectionsReason: null});
    expect(on({...GPU, backend: null})).toMatchObject({gi: GI_TIERS.high, reflections: null, reflectionsReason: 'the renderer is not ready'});
  });

  it('a renderer whose largest texture is too small: High falls back to Standard, Standard to none, each with the size in its reason', () => {
    const need = {standard: reflectionAtlasEdge(REFLECTION_TIERS.standard), high: reflectionAtlasEdge(REFLECTION_TIERS.high)};
    expect(need.high).toBeGreaterThan(need.standard);
    const fitsStd = {...GPU, maxTextureSize: need.high - 1};
    expect(planEnhancedLighting({lighting: 'on', reflections: 'high'}, fitsStd, station))
      .toMatchObject({reflections: REFLECTION_TIERS.standard, reflectionsReason: `High needs a larger texture than this renderer allows (${need.high - 1} px): Standard is used`});
    expect(planEnhancedLighting({lighting: 'on', reflections: 'standard'}, fitsStd, station)).toMatchObject({reflections: REFLECTION_TIERS.standard, reflectionsReason: null});
    const tiny = {...GPU, maxTextureSize: need.standard - 1};
    for (const reflections of ['standard', 'high'] as const) {
      expect(planEnhancedLighting({lighting: 'on', reflections}, tiny, station))
        .toMatchObject({gi: GI_TIERS.high, reflections: null, reflectionsReason: `this renderer's largest texture (${need.standard - 1} px) is too small for the probe atlas`});
    }
    // the edge the policy asks for really holds the tier's fullest atlas (world/reflectionProbes.ts probeAtlasLayout)
    for (const t of Object.values(REFLECTION_TIERS)) {
      const L = probeAtlasLayout(t.tile, t.maxProbes);
      expect(L.cols).toBe(PROBE_COLS);
      expect(Math.max(L.width, L.height)).toBeLessThanOrEqual(reflectionAtlasEdge(t));
      expect(t.maxProbes).toBeLessThanOrEqual(255); // ids are one byte
    }
    // both tiers fit the smallest limit either API guarantees (WebGPU core: 8192; WebGL 2: 2048)
    expect(need.high).toBeLessThanOrEqual(2048);
  });

  it('the signature tells plans apart (a pending settings change)', () => {
    const sig = new Set<string>();
    for (const lighting of ENHANCED_LIGHTING_MODES) for (const reflections of REFLECTION_QUALITIES) sig.add(planSignature(planEnhancedLighting({lighting, reflections}, GPU, station)));
    // off (x3 = one), auto / on x (off, standard, high)
    expect(sig.size).toBe(7);
    expect(planSignature(planEnhancedLighting({lighting: 'auto', reflections: 'standard'}, {...GPU, software: true}, station))).toBe('standard|off');
  });

  it('bounded: the tiers\' numbers, and no guess about memory anywhere in the policy', () => {
    expect(GI_TIERS).toEqual({standard: {id: 'standard', rays: 16, stride: 2, bounces: 3}, high: {id: 'high', rays: 32, stride: 1, bounces: 3}});
    expect(REFLECTION_TIERS).toEqual({standard: {id: 'standard', tile: 32, maxProbes: 192, spacing: 9}, high: {id: 'high', tile: 64, maxProbes: 240, spacing: 7}});
    // the fullest atlas of each tier, RGBA16F: a bounded few MiB (the grid adds 8 bytes a cell and level)
    const bytes = (t: {tile: number; maxProbes: number}) => { const L = probeAtlasLayout(t.tile, t.maxProbes); return L.width * L.height * 8; };
    expect(bytes(REFLECTION_TIERS.standard)).toBeLessThan(4 * 1048576);
    expect(bytes(REFLECTION_TIERS.high)).toBeLessThan(16 * 1048576);
    const code = readFileSync(new URL('../src/world/enhancedLighting.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/deviceMemory|navigator|VRAM|jsHeap|performance\.memory|requestAdapterInfo/i);
    expect(Object.keys(GPU).sort()).toEqual(['backend', 'halfFloatLinear', 'max3DTextureSize', 'maxTextureSize', 'software']);
  });
});
