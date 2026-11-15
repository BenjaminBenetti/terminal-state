// Task studio-baked-lighting-reflections-20261114-050258-01: the Enhanced lighting POLICY (world/enhancedLighting.ts
// planEnhancedLighting) — what Off / Auto / On build from the renderer's real capabilities, and the reasons they report.
// - Off: nothing, no reason; the Reactor: the baseline under every setting, with its reason;
// - Auto: the standard bake everywhere; reflections only on the hardware WebGPU backend whose limits fit — a software renderer, the
//   WebGL 2 fallback, an unready renderer or one that cannot filter half floats get the bake alone, each with its own reason;
// - On: the high bake, and reflections on anything that can run them (software and the fallback included);
// - limits: High falls back to Standard when the atlas does not fit, and to none when Standard does not either — and says so;
// - nothing in the policy reads memory: the capabilities have no such field and the module reads no memory API.
// Task studio-baked-gi-visual-uplift-20261115-004324-01:
// - SHADING: an enhanced bake is shaded FULL (by the surface normal, from the field's ambient cube) on any hardware renderer under
//   Auto and on every ready renderer under On; a software renderer under Auto and an unready renderer keep the plain light node,
//   each with its reason. Never full without an enhanced bake;
// - the live glass MIRROR comes with a reflection tier only;
// - the signature tells plain from full and a mirror from none (so such a change is a pending change).
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  ENHANCED_LIGHTING_DEFAULT, ENHANCED_LIGHTING_MODES, FALLBACK_REASON, FIELD_CUBE_BYTES, GI_TIERS, MIRROR_TEXELS, REACTOR_REASON, REFLECTIONS_DEFAULT, REFLECTION_QUALITIES,
  REFLECTION_TIERS, SOFTWARE_REASON, SOFTWARE_SHADING_REASON,
  baselinePlan, planEnhancedLighting, planSignature, reflectionAtlasEdge, type EnhancedLightingPlan, type LightingCapabilities,
} from '../src/world/enhancedLighting';
import {PROBE_COLS, probeAtlasLayout} from '../src/world/reflectionProbes';

const GPU: LightingCapabilities = {backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true};
const station = {reactor: false};
/** The plan of a station that is not enhanced, written out (baselinePlan must be exactly this). */
const BASELINE: EnhancedLightingPlan = {gi: null, shading: 'plain', reflections: null, mirror: false, giReason: null, shadingReason: null, reflectionsReason: null};
/** Renderers the policy is asked about. */
const RENDERERS: Record<string, LightingCapabilities> = {
  'hardware webgpu': GPU,
  'hardware webgl2': {...GPU, backend: 'webgl2'},
  'software webgpu': {...GPU, software: true},
  'software webgl2': {...GPU, backend: 'webgl2', software: true},
  'not ready': {...GPU, backend: null},
  'no half-float filtering': {...GPU, halfFloatLinear: false},
  'small textures': {...GPU, maxTextureSize: 1024},
};

describe('the plan', () => {
  it('defaults: Auto with Standard reflections — on a hardware WebGPU renderer the standard bake, full shading, probes and the mirror', () => {
    expect([ENHANCED_LIGHTING_DEFAULT, REFLECTIONS_DEFAULT]).toEqual(['auto', 'standard']);
    expect(planEnhancedLighting({lighting: ENHANCED_LIGHTING_DEFAULT, reflections: REFLECTIONS_DEFAULT}, GPU, station))
      .toEqual({gi: GI_TIERS.standard, shading: 'full', reflections: REFLECTION_TIERS.standard, mirror: true, giReason: null, shadingReason: null, reflectionsReason: null});
  });

  it('Off builds nothing and gives no reason, whatever the reflections choice or the renderer', () => {
    expect(baselinePlan()).toEqual(BASELINE);
    for (const reflections of REFLECTION_QUALITIES) for (const caps of Object.values(RENDERERS)) {
      expect(planEnhancedLighting({lighting: 'off', reflections}, caps, station)).toEqual(BASELINE);
      expect(planEnhancedLighting({lighting: 'off', reflections}, caps, {reactor: true})).toEqual(BASELINE);
    }
  });

  it('the Reactor keeps its lighting under Auto and On, and says why', () => {
    expect(baselinePlan('a', 'b')).toEqual({...BASELINE, giReason: 'a', reflectionsReason: 'b'});
    for (const lighting of ['auto', 'on'] as const) for (const caps of Object.values(RENDERERS)) {
      expect(planEnhancedLighting({lighting, reflections: 'high'}, caps, {reactor: true})).toEqual({...BASELINE, giReason: REACTOR_REASON, reflectionsReason: REACTOR_REASON});
      expect(planEnhancedLighting({lighting, reflections: 'off'}, caps, {reactor: true})).toEqual({...BASELINE, giReason: REACTOR_REASON});
    }
  });

  it('Auto: the standard bake everywhere; reflections only on the hardware WebGPU backend', () => {
    const auto = (caps: LightingCapabilities, reflections: 'standard' | 'high' | 'off' = 'standard') => planEnhancedLighting({lighting: 'auto', reflections}, caps, station);
    const full = {gi: GI_TIERS.standard, shading: 'full', giReason: null, shadingReason: null} as const;
    expect(auto(GPU, 'high')).toEqual({...full, reflections: REFLECTION_TIERS.high, mirror: true, reflectionsReason: null});
    expect(auto(GPU, 'off')).toEqual({...full, reflections: null, mirror: false, reflectionsReason: null});
    expect(auto({...GPU, software: true})).toEqual({gi: GI_TIERS.standard, shading: 'plain', reflections: null, mirror: false, giReason: null, shadingReason: SOFTWARE_SHADING_REASON, reflectionsReason: SOFTWARE_REASON});
    expect(auto({...GPU, backend: 'webgl2'})).toEqual({...full, reflections: null, mirror: false, reflectionsReason: FALLBACK_REASON});
    expect(auto({...GPU, backend: 'webgl2', software: true}).reflectionsReason).toBe(SOFTWARE_REASON);
    expect(auto({...GPU, backend: null})).toMatchObject({gi: GI_TIERS.standard, reflections: null, mirror: false, reflectionsReason: 'the renderer is not ready'});
    expect(auto({...GPU, halfFloatLinear: false})).toMatchObject({...full, reflections: null, mirror: false, reflectionsReason: 'this renderer cannot filter half-float textures'});
  });

  it('On: the high bake, and reflections on any renderer that can run them', () => {
    const on = (caps: LightingCapabilities, reflections: 'standard' | 'high' | 'off' = 'standard') => planEnhancedLighting({lighting: 'on', reflections}, caps, station);
    const full = {gi: GI_TIERS.high, shading: 'full', giReason: null, shadingReason: null} as const;
    expect(on(GPU)).toEqual({...full, reflections: REFLECTION_TIERS.standard, mirror: true, reflectionsReason: null});
    expect(on({...GPU, software: true})).toMatchObject({...full, reflections: REFLECTION_TIERS.standard, reflectionsReason: null});
    expect(on({...GPU, backend: 'webgl2'}, 'high')).toMatchObject({...full, reflections: REFLECTION_TIERS.high, reflectionsReason: null});
    expect(on(GPU, 'off')).toEqual({...full, reflections: null, mirror: false, reflectionsReason: null});
    expect(on({...GPU, backend: null})).toMatchObject({gi: GI_TIERS.high, reflections: null, mirror: false, reflectionsReason: 'the renderer is not ready'});
  });

  it('shading: full on any hardware renderer under Auto and on any ready renderer under On; plain with its reason otherwise', () => {
    const shading = (lighting: 'off' | 'auto' | 'on', caps: LightingCapabilities, reactor = false) => {
      const p = planEnhancedLighting({lighting, reflections: 'standard'}, caps, {reactor});
      return [p.gi?.id ?? null, p.shading, p.shadingReason];
    };
    const R = RENDERERS;
    // the rule, row by row: [setting, renderer] -> [bake, shading, why plain]
    expect(shading('off', R['hardware webgpu'])).toEqual([null, 'plain', null]);
    expect(shading('auto', R['hardware webgpu'], true)).toEqual([null, 'plain', null]); // the Reactor
    expect(shading('on', R['hardware webgpu'], true)).toEqual([null, 'plain', null]);
    expect(shading('auto', R['hardware webgpu'])).toEqual(['standard', 'full', null]);
    expect(shading('auto', R['hardware webgl2'])).toEqual(['standard', 'full', null]);
    expect(shading('auto', R['software webgpu'])).toEqual(['standard', 'plain', SOFTWARE_SHADING_REASON]);
    expect(shading('auto', R['software webgl2'])).toEqual(['standard', 'plain', SOFTWARE_SHADING_REASON]);
    expect(shading('on', R['hardware webgpu'])).toEqual(['high', 'full', null]);
    expect(shading('on', R['hardware webgl2'])).toEqual(['high', 'full', null]);
    expect(shading('on', R['software webgpu'])).toEqual(['high', 'full', null]);
    expect(shading('on', R['software webgl2'])).toEqual(['high', 'full', null]);
    expect(shading('auto', R['not ready'])).toEqual(['standard', 'plain', 'the renderer is not ready']);
    expect(shading('on', R['not ready'])).toEqual(['high', 'plain', 'the renderer is not ready']);
    // (a renderer that is not ready is asked about before one that is software)
    expect(shading('auto', {...R['not ready'], software: true})).toEqual(['standard', 'plain', 'the renderer is not ready']);
    // the two software reasons are two sentences: one for the shader, one for the reflections
    expect(SOFTWARE_SHADING_REASON).not.toBe(SOFTWARE_REASON);
    expect(SOFTWARE_SHADING_REASON).toMatch(/software renderer/);
    // the reflections choice and the limits reflections depend on do not move the shading
    for (const lighting of ['auto', 'on'] as const) for (const caps of [GPU, R['software webgpu'], R['hardware webgl2']]) {
      const want = shading(lighting, caps);
      for (const reflections of REFLECTION_QUALITIES) for (const over of [{}, {halfFloatLinear: false}, {maxTextureSize: 64}, {max3DTextureSize: 256}]) {
        const p = planEnhancedLighting({lighting, reflections}, {...caps, ...over}, station);
        expect([p.gi?.id ?? null, p.shading, p.shadingReason]).toEqual(want);
      }
    }
  });

  it('every plan is consistent: full shading only with an enhanced bake, a reason only for what was not given, the mirror only with a reflection tier', () => {
    let plans = 0, full = 0, mirrors = 0;
    for (const lighting of ENHANCED_LIGHTING_MODES) for (const reflections of REFLECTION_QUALITIES) for (const caps of Object.values(RENDERERS)) for (const reactor of [false, true]) {
      const p = planEnhancedLighting({lighting, reflections}, caps, {reactor});
      plans++;
      if (p.shading === 'full') { full++; expect(p.gi).not.toBeNull(); expect(p.shadingReason).toBeNull(); }
      if (p.shadingReason !== null) expect([p.gi !== null, p.shading]).toEqual([true, 'plain']);
      if (!p.gi) expect([p.shading, p.shadingReason, p.reflections, p.mirror]).toEqual(['plain', null, null, false]);
      if (p.giReason !== null) expect(p.gi).toBeNull();
      if (p.mirror) { mirrors++; expect(p.reflections).not.toBeNull(); }
      if (!p.reflections) expect(p.mirror).toBe(false);
      expect(['plain', 'full']).toContain(p.shading);
    }
    expect(plans).toBe(ENHANCED_LIGHTING_MODES.length * REFLECTION_QUALITIES.length * Object.keys(RENDERERS).length * 2);
    expect(full).toBeGreaterThan(0);
    expect(mirrors).toBeGreaterThan(0);
    // the hardware WebGPU renderer gets the mirror with either reflection quality, under Auto and On
    for (const lighting of ['auto', 'on'] as const) for (const reflections of ['standard', 'high'] as const) expect(planEnhancedLighting({lighting, reflections}, GPU, station).mirror).toBe(true);
  });

  it('a renderer whose largest texture is too small: High falls back to Standard, Standard to none, each with the size in its reason', () => {
    const need = {standard: reflectionAtlasEdge(REFLECTION_TIERS.standard), high: reflectionAtlasEdge(REFLECTION_TIERS.high)};
    expect(need.high).toBeGreaterThan(need.standard);
    const fitsStd = {...GPU, maxTextureSize: need.high - 1};
    expect(planEnhancedLighting({lighting: 'on', reflections: 'high'}, fitsStd, station))
      .toMatchObject({reflections: REFLECTION_TIERS.standard, mirror: true, reflectionsReason: `High needs a larger texture than this renderer allows (${need.high - 1} px): Standard is used`});
    expect(planEnhancedLighting({lighting: 'on', reflections: 'standard'}, fitsStd, station)).toMatchObject({reflections: REFLECTION_TIERS.standard, reflectionsReason: null});
    const tiny = {...GPU, maxTextureSize: need.standard - 1};
    for (const reflections of ['standard', 'high'] as const) {
      expect(planEnhancedLighting({lighting: 'on', reflections}, tiny, station))
        .toMatchObject({gi: GI_TIERS.high, shading: 'full', reflections: null, mirror: false, reflectionsReason: `this renderer's largest texture (${need.standard - 1} px) is too small for the probe atlas`});
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

  it('the signature tells plans apart (a pending settings change): the bake, plain from full, the reflections, a mirror from none', () => {
    const sig = new Set<string>();
    for (const lighting of ENHANCED_LIGHTING_MODES) for (const reflections of REFLECTION_QUALITIES) sig.add(planSignature(planEnhancedLighting({lighting, reflections}, GPU, station)));
    // off (x3 = one), auto / on x (off, standard, high)
    expect(sig.size).toBe(7);
    expect(planSignature(BASELINE)).toBe('baseline|off');
    // plain from full: the same bake and reflections on a software renderer (Auto: plain) and on a hardware one (full)
    const auto = (caps: LightingCapabilities) => planEnhancedLighting({lighting: 'auto', reflections: 'off'}, caps, station);
    expect(auto(GPU).shading).toBe('full');
    expect(auto({...GPU, software: true}).shading).toBe('plain');
    expect(planSignature(auto(GPU))).not.toBe(planSignature(auto({...GPU, software: true})));
    expect(planSignature(auto({...GPU, software: true}))).toBe('standard-plain|off');
    expect(planSignature(auto(GPU))).toBe('standard-full|off');
    // a mirror from none: the same plan with and without it
    const withMirror = planEnhancedLighting({lighting: 'auto', reflections: 'standard'}, GPU, station);
    expect(withMirror.mirror).toBe(true);
    expect(planSignature(withMirror)).not.toBe(planSignature({...withMirror, mirror: false}));
    // and each of the other fields on its own
    expect(planSignature(withMirror)).not.toBe(planSignature({...withMirror, shading: 'plain'}));
    expect(planSignature(withMirror)).not.toBe(planSignature({...withMirror, gi: GI_TIERS.high}));
    expect(planSignature(withMirror)).not.toBe(planSignature({...withMirror, reflections: REFLECTION_TIERS.high}));
    expect(planSignature(withMirror)).not.toBe(planSignature({...withMirror, reflections: null, mirror: false}));
    // the reasons are not part of it (a reason alone rebuilds nothing)
    expect(planSignature({...withMirror, reflectionsReason: 'x', shadingReason: 'y', giReason: 'z'})).toBe(planSignature(withMirror));
  });

  it('bounded: the tiers\' numbers, the feature\'s own texture bounds, and no guess about memory anywhere in the policy', () => {
    expect(GI_TIERS).toEqual({standard: {id: 'standard', rays: 16, stride: 2, bounces: 3}, high: {id: 'high', rays: 32, stride: 1, bounces: 3}});
    expect(REFLECTION_TIERS).toEqual({standard: {id: 'standard', tile: 32, maxProbes: 192, spacing: 9}, high: {id: 'high', tile: 64, maxProbes: 240, spacing: 7}});
    // the fullest atlas of each tier, RGBA16F: a bounded few MiB (the grid adds 8 bytes a cell and level)
    const bytes = (t: {tile: number; maxProbes: number}) => { const L = probeAtlasLayout(t.tile, t.maxProbes); return L.width * L.height * 8; };
    expect(bytes(REFLECTION_TIERS.standard)).toBeLessThan(4 * 1048576);
    expect(bytes(REFLECTION_TIERS.high)).toBeLessThan(16 * 1048576);
    // the field with its cube: one finite bound of its own (a station past it is shaded plain: enhanced-lighting-runtime.test.ts)
    expect(Number.isFinite(FIELD_CUBE_BYTES) && FIELD_CUBE_BYTES > 0).toBe(true);
    expect(FIELD_CUBE_BYTES).toBeLessThanOrEqual(256 * 1048576);
    // the mirror's target: one size per reflection tier, whole texels, High no smaller than Standard, each edge within the smallest
    // 2D limit either API guarantees (2048) and a bounded few megapixels
    expect(Object.keys(MIRROR_TEXELS).sort()).toEqual(Object.keys(REFLECTION_TIERS).sort());
    for (const [w, h] of Object.values(MIRROR_TEXELS)) {
      expect(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0).toBe(true);
      expect(Math.max(w, h)).toBeLessThanOrEqual(2048);
      expect(w * h).toBeLessThanOrEqual(2 * 1048576);
    }
    expect(MIRROR_TEXELS.high[0] * MIRROR_TEXELS.high[1]).toBeGreaterThanOrEqual(MIRROR_TEXELS.standard[0] * MIRROR_TEXELS.standard[1]);
    const code = readFileSync(new URL('../src/world/enhancedLighting.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/deviceMemory|navigator|VRAM|jsHeap|performance\.memory|requestAdapterInfo/i);
    expect(Object.keys(GPU).sort()).toEqual(['backend', 'halfFloatLinear', 'max3DTextureSize', 'maxTextureSize', 'software']);
  });
});
