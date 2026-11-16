// Task rt-flashlight-compute-20261115-233136 (lane UI): the RT FLASHLIGHT setting — one Graphics choice, On / Off, that selects how the
// flashlight's bounce is made under Enhanced lighting's full shading (traced on the GPU by compute shaders where the renderer runs the
// compute path; else, and when Off, the standard virtual-light bounce). This file pins:
//  1. the contract leaf (world/rtFlashlight.ts): the exact label, the default, the choices, ?rt= parsing, the reason strings — and that
//     no player-facing copy over-claims;
//  2. the store (ui/settingsStore.ts): rtFlashlight default On, an explicit Off persists, bad values fall back (fixed), a record from
//     before it reads On (not fixed), a session override is never persisted, copied into the game's Settings; never part of a save;
//  3. the plan (world/enhancedLighting.ts): rt only with full shading + the WebGPU compute path + the choice; its reasons; the other
//     fields are untouched by it; the signature (and so `pending`) moves exactly when plan.rt does;
//  4. the runtime (world/enhancedLightingRuntime.ts): request / setRtCapability / bakeSteps' rt / rtInstalled / applied /
//     installedBaseline — and that a station that cannot take the traced bounce makes the choice moot (no pending churn);
//  5. the compact line's fragment and the help line (rtFlashlightHelp) for every case, with its detail flag;
//  6. the form row in both forms (ui/mainMenu.ts): ids, label, options, bound both ways, held while applying, disabled under Off;
//  7. the plumbing (main.ts source): ?rt=on|off is a session override; a change relights; the recorder's environment carries it.
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {MiniEl, MiniEvent, MiniText, installMiniDom} from './helpers/paperMapDom';
import {mountSettingsForm, type SettingsFormOptions} from '../src/ui/mainMenu';
import {SETTINGS_DEFAULTS, SETTINGS_KEYS, SETTINGS_VERSION, SettingsStore, copySettingsInto, parseStoredSettings, sanitizeSettings, serializeSettings, type SettingsStorage} from '../src/ui/settingsStore';
import {STORAGE_KEYS} from '../src/campaign/types';
import {
  APPLYING_NOTE, ENHANCED_LIGHTING_MODES, PENDING_NOTE, REACTOR_REASON, REFLECTION_QUALITIES, SOFTWARE_SHADING_REASON, applyFailedNote, baselinePlan,
  describeRtFlashlight, enhancedLightingLine, planEnhancedLighting, planSignature, rtCapability, rtFlashlightHelp,
  type EnhancedLightingActive, type EnhancedLightingRequest, type EnhancedLightingStatus, type LightingCapabilities,
} from '../src/world/enhancedLighting';
import {
  RT_FALLBACK_REASON, RT_FLASHLIGHT_DEFAULT, RT_FLASHLIGHT_LABEL, RT_FLASHLIGHT_OPTIONS, RT_NEEDS_LIGHTING, RT_NOT_INSTALLED_REASON, RT_NOT_READY_REASON, RT_UNSUPPORTED_REASON,
  isRtFlashlightChoice, rtBuildFailedReason, rtCount, rtFlashlightChoice, rtFlashlightParam, rtFlashlightSummary, rtLimitsReason, rtLineFragment, rtSceneText, rtStationText,
  rtUnavailableText, type RtCapability,
} from '../src/world/rtFlashlight';
import {EnhancedLightingRuntime, type EnhancedLightingSettings, type StationBakeInput} from '../src/world/enhancedLightingRuntime';
import {openDerivedCache} from '../src/core/derivedCache';
import {drainSync} from '../src/core/pacedBuild';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {DEFAULT_FIELD, MAX_GROUPS, fieldDepth, giDepth, type FieldSource} from '../src/world/lightField';
import {lightingEnvironment} from '../src/debug/perfRecorderHooks';

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
/** Copy that must never appear in this feature's player-facing text (the same guard as enhanced-lighting-settings.test.ts). */
const OVERCLAIM = /ray.?trac|real.?time|vram|\bfps\b|faster|frame rate/i;

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.writes++; this.map.set(k, v); }
}

const OK: RtCapability = {ok: true, reason: null};
const LIMITS: RtCapability = {ok: false, reason: rtLimitsReason('maxStorageBuffersPerShaderStage 4 < 8')};
/** A hardware WebGPU renderer whose compute probe passed / has not answered. */
const GPU: LightingCapabilities = {backend: 'webgpu', software: false, maxTextureSize: 8192, max3DTextureSize: 2048, halfFloatLinear: true, rt: OK};
const UNPROBED: LightingCapabilities = {...GPU, rt: undefined};
const RENDERERS: Record<string, LightingCapabilities> = {
  'webgpu, probe ok': GPU,
  'webgpu, not probed': UNPROBED,
  'webgpu, probe null': {...GPU, rt: null},
  'webgpu, limits too small': {...GPU, rt: LIMITS},
  'webgpu, not ok without a reason': {...GPU, rt: {ok: false, reason: null}},
  'webgl2 (even with an ok probe)': {...GPU, backend: 'webgl2'},
  'software webgpu, probe ok': {...GPU, software: true},
  'not ready': {...GPU, backend: null},
};

/** The live station of a hardware renderer with full shading (the flashlight's bounce exists). */
const ACTIVE: EnhancedLightingActive = {gi: 'standard', giReason: null, shading: 'full', shadingReason: null, mirror: true, reflections: 'standard', reflectionsReason: null, cache: 'hit', giMs: 0, probeMs: 0, probes: 42, probeBytes: 1_500_000};
const status = (o: Partial<EnhancedLightingStatus> = {}, a: Partial<EnhancedLightingActive> | null = {}): EnhancedLightingStatus => ({
  requested: {lighting: 'auto', reflections: 'standard', rt: true}, active: a === null ? null : {...ACTIVE, ...a}, pending: false, cacheBackend: 'indexeddb', rtCapability: OK, ...o});

// =============================================================================================
describe('the contract: one choice named "RT Flashlight", On by default, two options', () => {
  it('label, default, options, the choice <-> boolean, ?rt= parsing', () => {
    expect(RT_FLASHLIGHT_LABEL).toBe('RT Flashlight');
    expect(RT_FLASHLIGHT_DEFAULT).toBe(true);
    expect(RT_FLASHLIGHT_OPTIONS.map(o => [o.value, o.label])).toEqual([['on', 'On'], ['off', 'Off']]);
    expect([rtFlashlightChoice(true), rtFlashlightChoice(false)]).toEqual(['on', 'off']);
    for (const v of ['on', 'off']) expect(isRtFlashlightChoice(v)).toBe(true);
    for (const v of ['ON', 'true', '', 1, true, null, undefined]) expect(isRtFlashlightChoice(v), String(v)).toBe(false);
    expect([rtFlashlightParam('on'), rtFlashlightParam('off')]).toEqual([true, false]);
    for (const v of [null, undefined, '', '1', '0', 'ON', 'Off', 'true', 'auto']) expect(rtFlashlightParam(v), String(v)).toBe(null);
  });

  it('the reasons complete "the standard flashlight bounce — …"; the lead\'s probe fills in its details; nothing over-claims', () => {
    expect(RT_NOT_READY_REASON).toBe('the renderer is not ready');
    expect(RT_FALLBACK_REASON).toBe('the WebGL 2 fallback renderer has no compute shaders');
    expect(rtLimitsReason('maxComputeWorkgroupStorageSize 8192 < 16384')).toBe('this GPU\'s limits are too small for it (maxComputeWorkgroupStorageSize 8192 < 16384)');
    expect(rtLimitsReason()).toBe('this GPU\'s limits are too small for it');
    expect(rtBuildFailedReason('WGSL validation error')).toBe('its compute shaders failed to build (WGSL validation error)');
    expect(rtBuildFailedReason(null)).toBe('its compute shaders failed to build');
    expect(RT_UNSUPPORTED_REASON).toBe('this renderer does not support it');
    expect(RT_NOT_INSTALLED_REASON).toBe('this station\'s traced scene could not be prepared');
    expect(RT_NEEDS_LIGHTING).toBe('Needs Enhanced lighting (it is off)');
    expect(rtFlashlightSummary(true)).toBe('On: the flashlight\'s bounce is traced on the GPU by compute shaders where this renderer supports it (else the standard bounce)');
    expect(rtFlashlightSummary(false)).toBe('Off: the standard flashlight bounce');
    expect(rtUnavailableText(RT_FALLBACK_REASON)).toBe('Unavailable here: the WebGL 2 fallback renderer has no compute shaders');
    for (const t of [RT_FLASHLIGHT_LABEL, RT_NOT_READY_REASON, RT_FALLBACK_REASON, rtLimitsReason('x'), rtBuildFailedReason('x'), RT_UNSUPPORTED_REASON, RT_NOT_INSTALLED_REASON, RT_NEEDS_LIGHTING, rtFlashlightSummary(true), rtFlashlightSummary(false)]) expect(t).not.toMatch(OVERCLAIM);
  });

  it('the traced scene in words: whole numbers with comma thousands, singular / plural, what was left out', () => {
    expect([rtCount(0), rtCount(7), rtCount(1234), rtCount(1234567.4), rtCount(-3), rtCount(Number.NaN)]).toEqual(['0', '7', '1,234', '1,234,567', '0', '0']);
    expect(rtSceneText({triangles: 182344, instances: 911})).toBe('182,344 triangles in 911 objects');
    expect(rtSceneText({triangles: 1, instances: 1})).toBe('1 triangle in 1 object');
    expect(rtSceneText({triangles: 5000, instances: 20, omitted: 3})).toBe('5,000 triangles in 20 objects; 3 left out');
    expect(rtSceneText({triangles: 5000, instances: 20, omitted: 0})).toBe('5,000 triangles in 20 objects');
  });
});

// =============================================================================================
describe('the store: rtFlashlight in the browser settings record only', () => {
  it('default On, a settings key, the record version unchanged; a record from before it reads On and is not "fixed"', () => {
    expect(SETTINGS_DEFAULTS.rtFlashlight).toBe(RT_FLASHLIGHT_DEFAULT);
    expect(SETTINGS_KEYS).toContain('rtFlashlight');
    expect(Object.keys(SETTINGS_DEFAULTS).sort()).toEqual([...SETTINGS_KEYS].sort());
    expect(SETTINGS_VERSION).toBe(1);
    expect(new SettingsStore(new MemStorage()).get().rtFlashlight).toBe(true);
    const old = parseStoredSettings(JSON.stringify({v: 1, fov: 80, ambientOcclusion: false, enhancedLighting: 'on', reflections: 'high'}));
    expect(old.settings).toMatchObject({rtFlashlight: true, fov: 80, ambientOcclusion: false, enhancedLighting: 'on', reflections: 'high'});
    expect([old.source, old.fixed]).toEqual(['stored', []]);
    const mem = new MemStorage();
    mem.map.set(STORAGE_KEYS.settings, JSON.stringify({v: 1, fov: 90}));
    const s = new SettingsStore(mem);
    expect([s.get().rtFlashlight, s.loadReport, mem.writes]).toEqual([true, {source: 'stored', fixed: []}, 0]);
  });

  it('an explicit Off persists across a reload and stays Off; On again persists; a change notifies exactly that key', () => {
    const mem = new MemStorage();
    const a = new SettingsStore(mem);
    const changes: string[][] = [];
    a.subscribe((_, ch) => changes.push([...ch]));
    a.set({rtFlashlight: false});
    a.set({rtFlashlight: false}); // a no-op: no event
    expect(JSON.parse(mem.getItem(STORAGE_KEYS.settings)!)).toMatchObject({v: 1, rtFlashlight: false});
    const b = new SettingsStore(mem);
    expect([b.get().rtFlashlight, b.loadReport.source]).toEqual([false, 'stored']);
    b.set({fov: 88}); // another key: Off is kept
    expect(new SettingsStore(mem).get()).toMatchObject({rtFlashlight: false, fov: 88});
    a.set({rtFlashlight: true});
    expect(new SettingsStore(mem).get().rtFlashlight).toBe(true);
    expect(changes).toEqual([['rtFlashlight'], ['rtFlashlight']]);
    for (const v of [true, false]) expect(parseStoredSettings(serializeSettings({...SETTINGS_DEFAULTS, rtFlashlight: v}))).toMatchObject({settings: {rtFlashlight: v}, source: 'stored', fixed: []});
  });

  it('a non-boolean falls back to On and IS "fixed" (like Ambient occlusion); a patch is validated too', () => {
    for (const bad of ['off', 'on', 'false', 0, 1, null, {}, ['off']]) {
      const r = sanitizeSettings({...SETTINGS_DEFAULTS, rtFlashlight: bad, fov: 90});
      expect(r.settings, String(bad)).toMatchObject({rtFlashlight: true, fov: 90});
      expect(r.fixed, String(bad)).toEqual(['rtFlashlight']);
    }
    const s = new SettingsStore(new MemStorage());
    s.set({rtFlashlight: false});
    s.set({rtFlashlight: 'off' as never});
    expect(s.get().rtFlashlight).toBe(true);
    expect(parseStoredSettings(JSON.stringify({v: 1, rtFlashlight: 'nope'}))).toMatchObject({source: 'invalid', fixed: ['rtFlashlight']});
  });

  it('a session override (?rt=) applies but is never persisted; an explicit change persists and drops it; reset = On', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    s.sessionOverride({rtFlashlight: false});
    expect([s.get().rtFlashlight, s.stored().rtFlashlight, mem.writes]).toEqual([false, true, 0]);
    s.set({fov: 85});
    expect(JSON.parse(mem.getItem(STORAGE_KEYS.settings)!)).toMatchObject({rtFlashlight: true, fov: 85});
    expect(s.get().rtFlashlight).toBe(false);
    s.set({rtFlashlight: false});
    expect(new SettingsStore(mem).get().rtFlashlight).toBe(false);
    s.reset();
    expect(s.get().rtFlashlight).toBe(true);
  });

  it('copied into the game\'s Settings (also a target from before it); the game\'s own default is On; never save content', () => {
    const target: Parameters<typeof copySettingsInto>[0] = {sens: 1, fov: 75, volume: 0.7, muted: false, invertX: false, invertY: false, quality: 'high', renderScale: 1, trainSway: 1}; // (no rtFlashlight field yet)
    expect(copySettingsInto(target, {...SETTINGS_DEFAULTS, rtFlashlight: false}).qualityChanged).toBe(false);
    expect(target).toMatchObject({rtFlashlight: false});
    const rt = new EnhancedLightingRuntime(target);
    expect(rt.request()).toEqual({lighting: 'auto', reflections: 'standard', rt: false});
    copySettingsInto(target, {...SETTINGS_DEFAULTS});
    expect(rt.status().requested.rt).toBe(true);
    const game = SRC('src/game.ts');
    expect(game).toMatch(/export interface Settings \{[^}]*rtFlashlight: boolean;[^}]*\}/);
    expect(game).toMatch(/readonly settings: Settings = \{[^}]*rtFlashlight: true,[^}]*\}/);
    const dir = path.resolve(__dirname, '../src/save');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.ts'))) expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/rtFlashlight/);
  });
});

// =============================================================================================
describe('the plan: the bounce is traced only with full shading, the WebGPU compute path and the choice', () => {
  const plan = (lighting: 'off' | 'auto' | 'on', caps: LightingCapabilities, rt?: boolean, reactor = false, reflections: 'off' | 'standard' | 'high' = 'standard') =>
    planEnhancedLighting({lighting, reflections, ...(rt === undefined ? {} : {rt})}, caps, {reactor});

  it('rt exactly where it can run and is asked for (absent = asked: the default); a reason only when asked and not given', () => {
    let traced = 0;
    for (const lighting of ENHANCED_LIGHTING_MODES) for (const [name, caps] of Object.entries(RENDERERS)) for (const rt of [undefined, true, false]) for (const reactor of [false, true]) for (const reflections of REFLECTION_QUALITIES) {
      const p = plan(lighting, caps, rt, reactor, reflections), at = `${lighting} ${name} rt=${rt} reactor=${reactor} ${reflections}`;
      const can = p.shading === 'full' && caps.backend === 'webgpu' && caps.rt?.ok === true;
      expect(p.rt, at).toBe(can && rt !== false);
      if (p.rt) { traced++; expect([p.gi !== null, p.shading, p.rtReason], at).toEqual([true, 'full', null]); }
      if (rt === false || lighting === 'off') expect(p.rtReason, at).toBe(null);
      if (p.rtReason !== null) expect(p.rt, at).toBe(false);
      if (!p.rt && rt !== false && lighting !== 'off') expect(p.rtReason, at).not.toBe(null); // asked and not given: always a reason
    }
    expect(traced).toBeGreaterThan(0);
  });

  it('the reasons: not probed, the WebGL 2 fallback, the probe\'s own, no bounce (the Reactor, plain shading); Off and an explicit Off give none', () => {
    expect(plan('auto', GPU)).toMatchObject({shading: 'full', rt: true, rtReason: null});
    expect(plan('auto', UNPROBED)).toMatchObject({shading: 'full', rt: false, rtReason: RT_NOT_READY_REASON});
    expect(plan('auto', {...GPU, rt: null})).toMatchObject({rt: false, rtReason: RT_NOT_READY_REASON});
    expect(plan('on', {...GPU, backend: 'webgl2'})).toMatchObject({shading: 'full', rt: false, rtReason: RT_FALLBACK_REASON});
    expect(plan('on', {...GPU, rt: LIMITS})).toMatchObject({shading: 'full', rt: false, rtReason: LIMITS.reason});
    expect(plan('on', {...GPU, rt: {ok: false, reason: null}})).toMatchObject({rt: false, rtReason: RT_UNSUPPORTED_REASON});
    expect(plan('on', {...GPU, rt: {ok: false, reason: rtBuildFailedReason('x')}})).toMatchObject({rt: false, rtReason: rtBuildFailedReason('x')});
    expect(plan('auto', {...GPU, software: true})).toMatchObject({shading: 'plain', rt: false, rtReason: SOFTWARE_SHADING_REASON}); // (no bounce under Auto there)
    expect(plan('on', {...GPU, software: true})).toMatchObject({shading: 'full', rt: true, rtReason: null}); // (On: full shading; the probe decides)
    expect(plan('auto', {...GPU, backend: null})).toMatchObject({shading: 'plain', rt: false, rtReason: RT_NOT_READY_REASON});
    expect(plan('auto', GPU, undefined, true)).toMatchObject({gi: null, rt: false, rtReason: REACTOR_REASON});
    expect(plan('auto', GPU, false, true)).toMatchObject({gi: null, rt: false, rtReason: null});
    expect(plan('off', GPU)).toEqual(baselinePlan());
    expect(baselinePlan()).toMatchObject({rt: false, rtReason: null});
    expect(baselinePlan('a', 'b', 'c')).toMatchObject({giReason: 'a', reflectionsReason: 'b', rt: false, rtReason: 'c'});
    for (const caps of Object.values(RENDERERS)) expect(plan('auto', caps, false)).toMatchObject({rt: false, rtReason: null});
  });

  it('it selects the bounce method only: every other field of the plan is the same with RT on or off', () => {
    for (const lighting of ENHANCED_LIGHTING_MODES) for (const caps of Object.values(RENDERERS)) for (const reactor of [false, true]) for (const reflections of REFLECTION_QUALITIES) {
      const {rt: _a, rtReason: _b, ...on} = plan(lighting, caps, true, reactor, reflections);
      const {rt: _c, rtReason: _d, ...off} = plan(lighting, caps, false, reactor, reflections);
      expect(on).toEqual(off);
    }
  });

  it('the signature: as before without the traced bounce, "|rt" with it — an RT change is pending exactly when it moves plan.rt', () => {
    expect(planSignature(plan('auto', GPU, false))).toBe('standard-full|standard+mirror');
    expect(planSignature(plan('auto', GPU))).toBe('standard-full|standard+mirror|rt');
    expect(planSignature(plan('auto', UNPROBED))).toBe('standard-full|standard+mirror');
    expect(planSignature(baselinePlan())).toBe('baseline|off');
    let moved = 0, moot = 0;
    for (const lighting of ENHANCED_LIGHTING_MODES) for (const caps of Object.values(RENDERERS)) for (const reactor of [false, true]) for (const reflections of REFLECTION_QUALITIES) {
      const on = plan(lighting, caps, true, reactor, reflections), off = plan(lighting, caps, false, reactor, reflections);
      const differs = planSignature(on) !== planSignature(off);
      expect(differs).toBe(on.rt !== off.rt);
      if (differs) moved++; else moot++;
      expect(planSignature(off)).not.toMatch(/\|rt$/); // (never traced when Off)
      // a reason alone rebuilds nothing
      expect(planSignature({...on, rtReason: 'x'})).toBe(planSignature(on));
    }
    expect(moved).toBeGreaterThan(0);
    expect(moot).toBeGreaterThan(moved); // (Off, the Reactor, plain shading, no compute path: moot)
  });

  it('rtCapability: what the renderer really offers (null before a renderer / an answer; never on the WebGL 2 fallback)', () => {
    expect(rtCapability({backend: null, rt: OK})).toBe(null);
    expect(rtCapability({backend: 'webgl2', rt: OK})).toEqual({ok: false, reason: RT_FALLBACK_REASON});
    expect(rtCapability({backend: 'webgpu'})).toBe(null);
    expect(rtCapability({backend: 'webgpu', rt: null})).toBe(null);
    expect(rtCapability({backend: 'webgpu', rt: OK})).toEqual(OK);
    expect(rtCapability({backend: 'webgpu', rt: {ok: true, reason: 'stray'}})).toEqual(OK);
    expect(rtCapability({backend: 'webgpu', rt: LIMITS})).toEqual(LIMITS);
    expect(rtCapability({backend: 'webgpu', rt: {ok: false, reason: null}})).toEqual({ok: false, reason: RT_UNSUPPORTED_REASON});
  });
});

// =============================================================================================
/** A small two-room station (48 x 28 cells, a wall with a door, two fixtures): as enhanced-lighting-runtime.test.ts. */
function rooms(): StationBakeInput {
  const g = new Grid(48, 28);
  for (let y = 1; y < 27; y++) for (let x = 1; x < 47; x++) { g.set(x, y, FLOOR); g.ceil[y * 48 + x] = 4.4; g.area[y * 48 + x] = x < 24 ? 0 : 1; }
  for (let y = 0; y < 28; y++) if (y < 11 || y > 15) g.set(24, y, SOLID);
  const light = (x: number, z: number) => ({x, y: 4.35, z, rot: 0, area: 0, broken: false, flicker: false, warm: false, power: 1, dying: false});
  const source: FieldSource = {grid: g, lights: [light(6, 7), light(18, 7)], trenchFloorY: -1.15};
  return {source, params: {...DEFAULT_FIELD}, reactor: false, extra: ''};
}
function runtime(settings: EnhancedLightingSettings, caps: LightingCapabilities = GPU): {rt: EnhancedLightingRuntime; events: () => number} {
  const rt = new EnhancedLightingRuntime(settings, {openCache: () => openDerivedCache({indexedDB: null, compress: false})});
  rt.setCapabilities(caps);
  let events = 0;
  rt.subscribe(() => { events++; });
  return {rt, events: () => events};
}
const bake = (rt: EnhancedLightingRuntime, input = rooms(), max3D = 2048) => drainSync(rt.bakeSteps(input, null, {max3DTextureSize: max3D}));

describe('the runtime: request, capabilities, what a station is built with, and when a change is pending', () => {
  it('request() carries the choice (absent = On); setRtCapability updates only that capability, tells the listeners, and moves the plan', () => {
    expect(new EnhancedLightingRuntime({}).request().rt).toBe(true);
    expect(new EnhancedLightingRuntime({rtFlashlight: false}).request().rt).toBe(false);
    const r = runtime({}, UNPROBED);
    expect([r.rt.plan(false).rt, r.rt.status().rtCapability]).toEqual([false, null]);
    const before = r.events();
    r.rt.setRtCapability(OK);
    expect(r.events()).toBe(before + 1);
    expect([r.rt.plan(false).rt, r.rt.status().rtCapability, r.rt.capabilities().maxTextureSize]).toEqual([true, OK, GPU.maxTextureSize]);
    r.rt.setRtCapability({ok: true, reason: null}); // the same answer: no event
    expect(r.events()).toBe(before + 1);
    r.rt.setRtCapability(LIMITS);
    expect([r.rt.plan(false).rt, r.rt.plan(false).rtReason, r.events()]).toEqual([false, LIMITS.reason, before + 2]);
    // a new renderer (setCapabilities without rt): not probed again
    r.rt.setCapabilities(UNPROBED);
    expect([r.rt.plan(false).rtReason, r.rt.status().rtCapability]).toEqual([RT_NOT_READY_REASON, null]);
    // the WebGL 2 fallback: never, and the status says why before any station
    r.rt.setCapabilities({...GPU, backend: 'webgl2'});
    expect(r.rt.status().rtCapability).toEqual({ok: false, reason: RT_FALLBACK_REASON});
  });

  it('a station on the compute path: the bake hands rt on, the record says it, the traced scene arrives with rtInstalled; On / Off is a pending change', () => {
    const settings: EnhancedLightingSettings = {reflections: 'off'};
    const r = runtime(settings);
    const out = bake(r.rt);
    expect([out.shading, out.rt, out.rtReason, out.bounce !== null]).toEqual(['full', true, null, true]);
    expect(r.rt.status().active).toMatchObject({gi: 'standard', shading: 'full', rt: true, rtReason: null, rtScene: null});
    expect(describeRtFlashlight(r.rt.status())).toBe('This station: the flashlight\'s bounce is traced on the GPU');
    expect(enhancedLightingLine(r.rt.status())).toMatch(/^auto: bake standard full · refl off · bounce traced · cache /);
    r.rt.rtInstalled(true, null, {triangles: 182344, instances: 911});
    expect(r.rt.status().active!.rtScene).toEqual({triangles: 182344, instances: 911});
    expect(describeRtFlashlight(r.rt.status())).toBe('This station: the flashlight\'s bounce is traced on the GPU (182,344 triangles in 911 objects)');
    expect(enhancedLightingLine(r.rt.status())).toContain(' · bounce traced (182344 tris, 911 obj)');
    expect(r.rt.status().pending).toBe(false);
    const sig = r.rt.pendingSignature();
    settings.rtFlashlight = false;
    expect([r.rt.status().pending, r.rt.pendingSignature() !== sig]).toEqual([true, true]);
    expect(describeRtFlashlight(r.rt.status())).toBe(`This station: the flashlight's bounce is traced on the GPU (182,344 triangles in 911 objects). ${PENDING_NOTE}`);
    settings.rtFlashlight = true;
    expect(r.rt.status().pending).toBe(false);
    // the probe now says no (a lost / failed pipeline): the station would be built with the standard bounce — pending
    r.rt.setRtCapability({ok: false, reason: rtBuildFailedReason('device lost')});
    expect(r.rt.status().pending).toBe(true);
  });

  it('an explicit Off: the standard bounce, no reason; turning it On is pending (the station would be traced)', () => {
    const settings: EnhancedLightingSettings = {rtFlashlight: false};
    const r = runtime(settings);
    const out = bake(r.rt);
    expect([out.shading, out.rt, out.rtReason]).toEqual(['full', false, null]);
    expect(r.rt.status().active).toMatchObject({rt: false, rtReason: null, rtScene: null});
    expect(rtFlashlightHelp(r.rt.status())).toEqual({text: rtFlashlightSummary(false), detail: true});
    expect(enhancedLightingLine(r.rt.status())).toMatch(/ · bounce standard · cache /);
    r.rt.rtInstalled(true, null, {triangles: 10, instances: 1}); // nothing planned to trace: ignored, never claimed
    expect(r.rt.status().active).toMatchObject({rt: false, rtScene: null});
    settings.rtFlashlight = true;
    expect(r.rt.status().pending).toBe(true);
  });

  it('moot: Enhanced lighting Off, the Reactor, a renderer without the compute path — an RT change is never pending there', () => {
    for (const [s, caps, reactor] of [[{enhancedLighting: 'off'}, GPU, false], [{}, GPU, true], [{}, {...GPU, backend: 'webgl2'}, false], [{}, UNPROBED, false], [{}, {...GPU, software: true}, false]] as [EnhancedLightingSettings, LightingCapabilities, boolean][]) {
      const settings = {...s};
      const r = runtime(settings, caps);
      const out = bake(r.rt, {...rooms(), reactor});
      expect(out.rt).toBe(false);
      for (const v of [false, true, false]) { settings.rtFlashlight = v; expect(r.rt.status().pending, JSON.stringify([s, caps.backend, reactor, v])).toBe(false); }
    }
  });

  it('a station that cannot take the traced bounce whatever the choice (scene not prepared, shading plain after all): the reason is shown, the choice is moot', () => {
    // rtInstalled(false): too much geometry for this station
    const settings: EnhancedLightingSettings = {};
    const r = runtime(settings);
    bake(r.rt);
    r.rt.rtInstalled(false, 'this station has too much geometry for it (2,400,000 triangles; at most 2,000,000)', {triangles: 2_400_000, instances: 3000});
    expect(r.rt.status().active).toMatchObject({rt: false, rtReason: 'this station has too much geometry for it (2,400,000 triangles; at most 2,000,000)', rtScene: {triangles: 2_400_000, instances: 3000}});
    expect(describeRtFlashlight(r.rt.status())).toBe('This station: the standard flashlight bounce — this station has too much geometry for it (2,400,000 triangles; at most 2,000,000)');
    for (const v of [false, true]) { settings.rtFlashlight = v; expect(r.rt.status().pending).toBe(false); }
    r.rt.rtInstalled(true, null, {triangles: 1, instances: 1}); // (a late "ok" never turns a failed station back into a traced one)
    expect(r.rt.status().active!.rt).toBe(false);
    // without a reason of its own
    const q = runtime({});
    bake(q.rt);
    q.rt.rtInstalled(false, null);
    expect(q.rt.status().active!.rtReason).toBe(RT_NOT_INSTALLED_REASON);
    // a new station starts over (the choice counts again)
    const settings2: EnhancedLightingSettings = {};
    const n = runtime(settings2);
    bake(n.rt);
    n.rt.rtInstalled(false, 'x');
    bake(n.rt);
    expect(n.rt.status().active!.rt).toBe(true);
    settings2.rtFlashlight = false;
    expect(n.rt.status().pending).toBe(true);

    // the field with its cube does not fit this renderer's 3D textures: plain, no bounce, the reason why
    const depth = fieldDepth(1) + MAX_GROUPS + giDepth(1), max3D = depth - 1;
    const settings3: EnhancedLightingSettings = {reflections: 'off'};
    const p = runtime(settings3, {...GPU, max3DTextureSize: max3D});
    expect(p.rt.plan(false)).toMatchObject({shading: 'full', rt: true});
    const out = bake(p.rt, rooms(), max3D);
    const why = `this station's field with its cube (${depth} slices) is deeper than this renderer's 3D textures (${max3D})`;
    expect([out.shading, out.rt, out.rtReason, out.bounce]).toEqual(['plain', false, why, null]);
    expect(p.rt.status().active).toMatchObject({shading: 'plain', rt: false, rtReason: why});
    expect(describeRtFlashlight(p.rt.status())).toBe(`This station: no flashlight bounce — ${why}`);
    expect(enhancedLightingLine(p.rt.status())).not.toMatch(/bounce/);
    for (const v of [false, true]) { settings3.rtFlashlight = v; expect(p.rt.status().pending).toBe(false); }

    // the station lighting could not keep the cube on the GPU (applied's plainBecause): likewise
    const settings4: EnhancedLightingSettings = {};
    const a = runtime(settings4);
    bake(a.rt);
    a.rt.applied(null, 'the cube did not fit');
    expect(a.rt.status().active).toMatchObject({shading: 'plain', rt: false, rtReason: 'the cube did not fit', rtScene: null});
    for (const v of [false, true]) { settings4.rtFlashlight = v; expect(a.rt.status().pending).toBe(false); }
  });

  it('a rebuild that fell back to the baseline: no bounce, the same reason (asked) / none (Off)', () => {
    for (const rtFlashlight of [true, false]) {
      const r = runtime({rtFlashlight});
      bake(r.rt);
      r.rt.installedBaseline('the enhanced lighting could not be installed');
      expect(r.rt.status().active).toMatchObject({gi: 'baseline', rt: false, rtReason: rtFlashlight ? 'the enhanced lighting could not be installed' : null, rtScene: null});
      expect(describeRtFlashlight(r.rt.status())).toMatch(/^This station: no flashlight bounce — the enhanced lighting could not be installed/);
    }
  });

  it('a probe that answers after the first station: the station would now be traced — pending (applied at the next pause)', () => {
    const r = runtime({}, UNPROBED);
    const out = bake(r.rt);
    expect([out.rt, out.rtReason]).toEqual([false, RT_NOT_READY_REASON]);
    expect(describeRtFlashlight(r.rt.status())).toBe(`This station: the standard flashlight bounce — ${RT_NOT_READY_REASON}`);
    expect(r.rt.status().pending).toBe(false);
    r.rt.setRtCapability(OK);
    expect(r.rt.status().pending).toBe(true);
    r.rt.setRtCapability(LIMITS);
    expect(r.rt.status().pending).toBe(false);
  });
});

// =============================================================================================
describe('the compact line and the help line', () => {
  it('the line names the method after the reflections — byte-identical for a record from before the setting; nothing without a bounce', () => {
    const old = status({}, {});
    expect(enhancedLightingLine(old)).toBe('auto: bake standard full · refl standard ×42 + mirror · cache hit');
    expect(enhancedLightingLine(status({}, {rt: true}))).toBe('auto: bake standard full · refl standard ×42 + mirror · bounce traced · cache hit');
    expect(enhancedLightingLine(status({}, {rt: true, rtScene: {triangles: 5000, instances: 20, omitted: 2}}))).toBe('auto: bake standard full · refl standard ×42 + mirror · bounce traced (5000 tris, 20 obj, 2 left out) · cache hit');
    expect(enhancedLightingLine(status({}, {rt: false, rtReason: RT_FALLBACK_REASON}))).toBe(`auto: bake standard full · refl standard ×42 + mirror · bounce standard (${RT_FALLBACK_REASON}) · cache hit`);
    expect(enhancedLightingLine(status({pending: true}, {rt: false, rtReason: null}))).toBe('auto: bake standard full · refl standard ×42 + mirror · bounce standard · cache hit · change pending');
    // no bounce: the bake part already says why (baseline / plain)
    expect(enhancedLightingLine(status({}, {shading: 'plain', shadingReason: SOFTWARE_SHADING_REASON, rt: false, rtReason: SOFTWARE_SHADING_REASON}))).toBe('auto: bake standard plain · refl standard ×42 + mirror · cache hit');
    expect(enhancedLightingLine(status({}, {gi: 'baseline', giReason: REACTOR_REASON, shading: 'plain', reflections: 'off', reflectionsReason: REACTOR_REASON, cache: 'none', rt: false, rtReason: REACTOR_REASON}))).toBe(`auto: baseline (${REACTOR_REASON}) · refl off (${REACTOR_REASON})`);
    expect(rtLineFragment({...ACTIVE})).toBe('');
  });

  it('help: Enhanced lighting Off; before a station what the choice means (a detail) or why it cannot run here (shown)', () => {
    const none = (o: Partial<EnhancedLightingStatus>, req: Partial<EnhancedLightingRequest> = {}) => status({...o, requested: {lighting: 'auto', reflections: 'standard', rt: true, ...req}}, null);
    expect(rtFlashlightHelp(none({}, {lighting: 'off'}))).toEqual({text: RT_NEEDS_LIGHTING, detail: false});
    expect(rtFlashlightHelp(none({}, {lighting: 'off', rt: false}))).toEqual({text: RT_NEEDS_LIGHTING, detail: false});
    expect(rtFlashlightHelp(none({}))).toEqual({text: rtFlashlightSummary(true), detail: true});
    expect(rtFlashlightHelp(none({}, {rt: false}))).toEqual({text: rtFlashlightSummary(false), detail: true});
    expect(rtFlashlightHelp(none({rtCapability: null}))).toEqual({text: rtFlashlightSummary(true), detail: true}); // (not probed yet: nothing claimed either way)
    expect(rtFlashlightHelp(none({rtCapability: undefined}, {rt: undefined}))).toEqual({text: rtFlashlightSummary(true), detail: true}); // (a status from before the setting)
    expect(rtFlashlightHelp(none({rtCapability: {ok: false, reason: RT_FALLBACK_REASON}}))).toEqual({text: 'Unavailable here: the WebGL 2 fallback renderer has no compute shaders', detail: false});
    expect(rtFlashlightHelp(none({rtCapability: LIMITS}, {rt: false}))).toEqual({text: `Unavailable here: ${LIMITS.reason}`, detail: false});
    expect(rtFlashlightHelp(none({rtCapability: {ok: false, reason: null}}))).toEqual({text: `Unavailable here: ${RT_UNSUPPORTED_REASON}`, detail: false});
  });

  it('help with a station: traced / standard and why / no bounce and why; then the shared change notes — never a pretended traced bounce', () => {
    const traced = status({}, {rt: true, rtScene: {triangles: 12345, instances: 87}});
    expect(rtFlashlightHelp(traced)).toEqual({text: 'This station: the flashlight\'s bounce is traced on the GPU (12,345 triangles in 87 objects)', detail: false});
    expect(describeRtFlashlight(status({}, {rt: true}))).toBe('This station: the flashlight\'s bounce is traced on the GPU');
    for (const why of [RT_NOT_READY_REASON, RT_FALLBACK_REASON, rtLimitsReason('maxStorageBuffersPerShaderStage 4 < 8'), rtBuildFailedReason('x'), RT_NOT_INSTALLED_REASON, 'this station has too much geometry for it']) {
      expect(rtFlashlightHelp(status({}, {rt: false, rtReason: why}))).toEqual({text: `This station: the standard flashlight bounce — ${why}`, detail: false});
    }
    expect(rtFlashlightHelp(status({}, {rt: false, rtReason: null}))).toEqual({text: 'This station: the standard flashlight bounce', detail: false}); // (On, no reason: an old record)
    expect(rtFlashlightHelp(status({requested: {lighting: 'auto', reflections: 'standard', rt: false}}, {rt: false, rtReason: null}))).toEqual({text: rtFlashlightSummary(false), detail: true});
    // no bounce at all: why (the RT reason, else what the bake / shading reported)
    expect(describeRtFlashlight(status({}, {shading: 'plain', shadingReason: SOFTWARE_SHADING_REASON, rt: false, rtReason: SOFTWARE_SHADING_REASON}))).toBe(`This station: no flashlight bounce — ${SOFTWARE_SHADING_REASON}`);
    expect(describeRtFlashlight(status({}, {gi: 'baseline', giReason: REACTOR_REASON, shading: 'plain', rt: false, rtReason: REACTOR_REASON}))).toBe(`This station: no flashlight bounce — ${REACTOR_REASON}`);
    expect(describeRtFlashlight(status({}, {gi: 'baseline', giReason: null, shading: 'plain'}))).toBe('This station: no flashlight bounce');
    expect(describeRtFlashlight(status({requested: {lighting: 'auto', reflections: 'standard', rt: false}}, {shading: 'plain', shadingReason: 'x'}))).toBe('This station: no flashlight bounce — x');
    // a record without `rt` (from before the setting) never claims a traced bounce
    expect(describeRtFlashlight(status({}, {}))).toBe('This station: the standard flashlight bounce');
    // the change notes (shared with the other two lines)
    expect(rtFlashlightHelp({...traced, pending: true})).toEqual({text: `${describeRtFlashlight(traced)}. ${PENDING_NOTE}`, detail: false});
    expect(rtFlashlightHelp({...traced, pending: true, applying: true})).toEqual({text: `${describeRtFlashlight(traced)}. ${APPLYING_NOTE}`, detail: false});
    expect(rtFlashlightHelp({...traced, pending: true, error: 'the bake ran out of memory'})).toEqual({text: `${describeRtFlashlight(traced)}. ${applyFailedNote('the bake ran out of memory')}`, detail: false});
    const offPending = status({requested: {lighting: 'auto', reflections: 'standard', rt: false}, pending: true}, {rt: true});
    expect(describeRtFlashlight(offPending)).toBe(`This station: the flashlight's bounce is traced on the GPU. ${PENDING_NOTE}`); // (what it uses NOW, and that Off is not applied yet)
  });

  it('no help line over-claims, whatever the case', () => {
    const texts: string[] = [];
    for (const rt of [true, false]) for (const lighting of ENHANCED_LIGHTING_MODES) for (const cap of [OK, LIMITS, null, {ok: false, reason: RT_FALLBACK_REASON}]) {
      for (const a of [null, {}, {rt: true}, {rt: true, rtScene: {triangles: 9, instances: 2}}, {rt: false, rtReason: RT_NOT_READY_REASON}, {shading: 'plain' as const, rt: false, rtReason: SOFTWARE_SHADING_REASON}]) {
        for (const o of [{}, {pending: true}, {applying: true, pending: true}, {error: 'x', pending: true}]) {
          const st = status({...o, requested: {lighting, reflections: 'standard', rt}, rtCapability: cap}, a);
          texts.push(describeRtFlashlight(st), enhancedLightingLine(st));
        }
      }
    }
    for (const t of texts) expect(t).not.toMatch(OVERCLAIM);
    expect(texts.join('\n')).not.toMatch(/ray/i);
  });
});

// =============================================================================================
/** The bits of the DOM the settings form uses that the shared mini DOM leaves out (as enhanced-lighting-settings.test.ts patches them). */
function patchMiniDom(): void {
  const P = MiniEl.prototype as unknown as Record<string, unknown>;
  const node = (n: unknown) => (typeof n === 'string' ? new MiniText(n) : n) as MiniEl | MiniText;
  P.append = function (this: MiniEl, ...ns: unknown[]) { for (const n of ns) this.appendChild(node(n)); };
  P.replaceChildren = function (this: MiniEl, ...ns: unknown[]) { for (const c of this.children) c.parent = null; this.children = []; (this as unknown as {append(...x: unknown[]): void}).append(...ns); };
  Object.defineProperty(P, 'htmlFor', {configurable: true, get() { return {add() {}}; }});
  Object.defineProperty(P, 'ownerDocument', {configurable: true, get(this: MiniEl) { return this.doc; }});
}

type Ctl = MiniEl & {value: string; disabled?: boolean};

function mountForm(prefix: 'mm-set-' | 'set-', o: Partial<SettingsFormOptions> & {store?: SettingsStore} = {}) {
  patchMiniDom();
  const dom = installMiniDom(1920, 1080);
  dom.doc.body.innerHTML = '<div id="box"></div>';
  const box = dom.doc.querySelector('#box')!;
  const {store: given, ...opts} = o;
  const store = given ?? new SettingsStore(new MemStorage());
  const off = mountSettingsForm(box as unknown as HTMLElement, store, {idPrefix: prefix, viewport: () => ({w: 1920, h: 1080, dpr: 1}), ...opts});
  const el = (id: string) => box.querySelector(`#${prefix}${id}`) as unknown as Ctl;
  const choose = (id: string, value: string) => { const sel = el(id); sel.value = value; sel.dispatchEvent(new MiniEvent('change')); };
  const help = () => el('rt-help').textContent;
  const isDetail = () => el('rt-help').classList.contains('set-detail');
  return {dom, box, store, off, el, choose, help, isDetail, done: () => { off(); dom.uninstall(); }};
}

/** The game's runtime as main.ts wires it: its status follows the store (the game copies the settings in first). */
function liveRuntime(store: SettingsStore, live: {active: EnhancedLightingActive | null; pending?: boolean; applying?: boolean; error?: string | null; cap?: RtCapability | null}) {
  const listeners = new Set<() => void>();
  return {
    live,
    status: (): EnhancedLightingStatus => {
      const s = store.get();
      return {requested: {lighting: s.enhancedLighting, reflections: s.reflections, rt: s.rtFlashlight}, active: live.active, pending: live.pending ?? false, cacheBackend: 'indexeddb',
        applying: live.applying ?? false, error: live.error ?? null, rtCapability: live.cap === undefined ? OK : live.cap};
    },
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    changed: () => { for (const fn of [...listeners]) fn(); },
  };
}

describe('the form: "RT Flashlight" right after Reflections, in both forms', () => {
  it('ids, the exact label, On / Off, the help line wired; right after the Reflections row; a Graphics row', () => {
    for (const prefix of ['mm-set-', 'set-'] as const) {
      const m = mountForm(prefix);
      try {
        const sel = m.el('rt');
        expect(sel.tagName).toBe('SELECT');
        expect(sel.parentElement!.textContent!.trim()).toBe(`${RT_FLASHLIGHT_LABEL} OnOff`);
        expect(sel.parentElement!.textContent).toContain('RT Flashlight');
        expect(sel.querySelectorAll('option').map(op => [(op as unknown as {value: string}).value, op.textContent])).toEqual([['on', 'On'], ['off', 'Off']]);
        expect(sel.value).toBe('on');
        expect(sel.getAttribute('aria-describedby')).toBe(`${prefix}rt-help`);
        const kids = m.box.elements.map(e => e.id || e.className);
        const at = (id: string) => kids.indexOf(`${prefix}${id}`);
        expect(at('rt-help')).toBe(at('reflections-help') + 2);
        expect(m.box.elements[at('rt-help') - 1]).toBe(sel.parentElement);
        expect([sel.parentElement!.getAttribute('data-group'), m.el('rt-help').getAttribute('data-group')]).toEqual(['graphics', 'graphics']);
        expect(m.box.querySelectorAll('select').map(e => e.id).slice(-3)).toEqual([`${prefix}lighting`, `${prefix}reflections`, `${prefix}rt`]);
        // no status: what the choice means, behind "Show details"; the class line is the help lines' own
        expect([m.help(), m.isDetail(), m.el('rt-help').classList.contains('set-help')]).toEqual([rtFlashlightSummary(true), true, true]);
      } finally { m.done(); }
    }
  });

  it('bound both ways: a choice stores the boolean (nothing else), another form\'s change shows here, an unknown value is ignored', () => {
    const mem = new MemStorage();
    const store = new SettingsStore(mem);
    const m = mountForm('mm-set-', {store});
    try {
      const changes: string[][] = [];
      store.subscribe((_, ch) => changes.push([...ch]));
      m.choose('rt', 'off');
      expect([store.get().rtFlashlight, JSON.parse(mem.getItem(STORAGE_KEYS.settings)!).rtFlashlight]).toEqual([false, false]);
      expect([m.help(), m.isDetail()]).toEqual([rtFlashlightSummary(false), true]);
      store.set({rtFlashlight: true}); // the pause menu's form changed it
      expect(m.el('rt').value).toBe('on');
      m.choose('rt', 'maybe');
      expect(store.get().rtFlashlight).toBe(true);
      expect(changes).toEqual([['rtFlashlight'], ['rtFlashlight']]);
      // a stored Off mounts as Off
      store.set({rtFlashlight: false});
      const n = mountForm('set-', {store});
      try { expect(n.el('rt').value).toBe('off'); } finally { n.off(); }
    } finally { m.done(); }
  });

  it('disabled while Enhanced lighting is Off (its stored value kept, the line says why); held while a change is applied', () => {
    const store = new SettingsStore(new MemStorage());
    store.set({rtFlashlight: false});
    const rt = liveRuntime(store, {active: null});
    const m = mountForm('mm-set-', {store, lightingStatus: rt.status, lightingChanged: rt.subscribe});
    try {
      expect(m.el('rt').disabled).toBe(false);
      m.choose('lighting', 'off');
      expect([m.el('rt').disabled, m.el('rt').value, store.get().rtFlashlight]).toEqual([true, 'off', false]);
      expect([m.help(), m.isDetail()]).toEqual([RT_NEEDS_LIGHTING, false]);
      m.choose('lighting', 'on');
      expect([m.el('rt').disabled, m.el('rt').value]).toEqual([false, 'off']);
      // a change being applied: all three lighting choices held, the line says so; afterwards free again
      rt.live.active = {...ACTIVE, rt: true};
      rt.live.pending = true; rt.live.applying = true;
      rt.changed();
      expect([m.el('lighting').disabled, m.el('reflections').disabled, m.el('rt').disabled]).toEqual([true, true, true]);
      expect([m.help(), m.isDetail()]).toEqual([`This station: the flashlight's bounce is traced on the GPU. ${APPLYING_NOTE}`, false]);
      rt.live.applying = false; rt.live.error = 'the bake ran out of memory';
      rt.changed();
      expect(m.el('rt').disabled).toBe(false);
      expect(m.help()).toBe(`This station: the flashlight's bounce is traced on the GPU. ${applyFailedNote('the bake ran out of memory')}`);
      rt.live.pending = false; rt.live.error = null; rt.live.active = {...ACTIVE, rt: false, rtReason: null};
      rt.changed();
      expect([m.help(), m.isDetail()]).toEqual([rtFlashlightSummary(false), true]); // Off applied: what Off means
      // a form mounted while Enhanced lighting is already off starts disabled
      const off = new SettingsStore(new MemStorage());
      off.sessionOverride({enhancedLighting: 'off'});
      const n = mountForm('set-', {store: off});
      try { expect([n.el('rt').disabled, n.help()]).toEqual([true, RT_NEEDS_LIGHTING]); } finally { n.off(); }
    } finally { m.done(); }
  });

  it('the help line follows the live status: unavailable before a station, traced with its scene, standard with each reason, no bounce, pending', () => {
    const store = new SettingsStore(new MemStorage());
    const rt = liveRuntime(store, {active: null, cap: {ok: false, reason: RT_FALLBACK_REASON}});
    const m = mountForm('set-', {store, lightingStatus: rt.status, lightingChanged: rt.subscribe});
    try {
      const shows = (text: string, detail = false) => { rt.changed(); expect([m.help(), m.isDetail()]).toEqual([text, detail]); expect(m.help()).not.toMatch(OVERCLAIM); };
      shows(rtUnavailableText(RT_FALLBACK_REASON));
      rt.live.cap = null; shows(rtFlashlightSummary(true), true);
      rt.live.cap = OK; shows(rtFlashlightSummary(true), true);
      rt.live.active = {...ACTIVE, rt: true, rtScene: null}; shows('This station: the flashlight\'s bounce is traced on the GPU');
      rt.live.active = {...ACTIVE, rt: true, rtScene: {triangles: 182344, instances: 911}}; shows(rtStationText(rt.live.active));
      expect(m.help()).toBe('This station: the flashlight\'s bounce is traced on the GPU (182,344 triangles in 911 objects)');
      for (const why of [RT_NOT_READY_REASON, RT_FALLBACK_REASON, rtLimitsReason('maxStorageBuffersPerShaderStage 4 < 8'), rtBuildFailedReason('x'), RT_NOT_INSTALLED_REASON]) {
        rt.live.active = {...ACTIVE, rt: false, rtReason: why}; shows(`This station: the standard flashlight bounce — ${why}`);
      }
      rt.live.active = {...ACTIVE, shading: 'plain', shadingReason: SOFTWARE_SHADING_REASON, rt: false, rtReason: SOFTWARE_SHADING_REASON}; shows(`This station: no flashlight bounce — ${SOFTWARE_SHADING_REASON}`);
      rt.live.active = {...ACTIVE, gi: 'baseline', giReason: REACTOR_REASON, shading: 'plain', rt: false, rtReason: REACTOR_REASON}; shows(`This station: no flashlight bounce — ${REACTOR_REASON}`);
      rt.live.active = {...ACTIVE, rt: true}; rt.live.pending = true;
      m.choose('rt', 'off'); // (the store event re-reads the status too)
      expect(m.help()).toBe(`This station: the flashlight's bounce is traced on the GPU. ${PENDING_NOTE}`);
    } finally { m.done(); }
  });

  it('with the real runtime as main.ts wires it: the line says what the station is built with, and an On / Off change is pending', () => {
    const settings: EnhancedLightingSettings = {};
    const r = runtime(settings);
    const store = new SettingsStore(new MemStorage());
    store.subscribe(s => { copySettingsInto(settings as never, s); }); // main.ts: the copy runs before the forms' own
    copySettingsInto(settings as never, store.get());
    const m = mountForm('mm-set-', {store, lightingStatus: () => r.rt.status(), lightingChanged: fn => r.rt.subscribe(fn)});
    try {
      expect([m.help(), m.isDetail()]).toEqual([rtFlashlightSummary(true), true]);
      bake(r.rt);
      expect(m.help()).toBe('This station: the flashlight\'s bounce is traced on the GPU');
      r.rt.rtInstalled(true, null, {triangles: 2500, instances: 12});
      expect(m.help()).toBe('This station: the flashlight\'s bounce is traced on the GPU (2,500 triangles in 12 objects)');
      m.choose('rt', 'off');
      expect(r.rt.status().pending).toBe(true);
      expect(m.help()).toBe(`This station: the flashlight's bounce is traced on the GPU (2,500 triangles in 12 objects). ${PENDING_NOTE}`);
      m.choose('rt', 'on');
      expect(m.help()).toBe('This station: the flashlight\'s bounce is traced on the GPU (2,500 triangles in 12 objects)');
    } finally { m.done(); }
  });
});

// =============================================================================================
describe('the plumbing: ?rt= is a session override; a change relights the live station; the recorder carries it', () => {
  const main = SRC('src/main.ts');

  it('?rt=on|off: parsed by the contract, a session override after the other two and before the first copy into the game; never persisted', () => {
    expect(main).toMatch(/import \{rtFlashlightParam\} from '\.\/world\/rtFlashlight';/);
    expect(main).toMatch(/const urlRt = rtFlashlightParam\(params\.get\('rt'\)\);\n\s*if \(urlRt !== null\) settings\.sessionOverride\(\{rtFlashlight: urlRt\}\);/);
    expect(main.indexOf('settings.sessionOverride({rtFlashlight: urlRt})')).toBeGreaterThan(main.indexOf('settings.sessionOverride({reflections: urlReflections})'));
    expect(main.indexOf('settings.sessionOverride({rtFlashlight: urlRt})')).toBeLessThan(main.indexOf('copySettingsInto(game.settings, settings.get());'));
    expect(main).not.toMatch(/settings\.set\(\{rtFlashlight/);
    const run = (query: string) => {
      const mem = new MemStorage(), settings = new SettingsStore(mem), params = new URLSearchParams(query);
      const urlRt = rtFlashlightParam(params.get('rt'));
      if (urlRt !== null) settings.sessionOverride({rtFlashlight: urlRt});
      return {got: settings.get().rtFlashlight, stored: settings.stored().rtFlashlight, writes: mem.writes};
    };
    expect(run('?rt=off')).toEqual({got: false, stored: true, writes: 0});
    expect(run('?qa=1&rt=on')).toEqual({got: true, stored: true, writes: 0});
    for (const q of ['', '?rt=', '?rt=1', '?rt=OFF', '?rt=false', '?rtx=off']) expect(run(q), q).toEqual({got: true, stored: true, writes: 0});
  });

  it('a change asks the game to relight the live station (the same line as Enhanced lighting / Reflections), nothing else', () => {
    const at = main.indexOf('settings.subscribe((s, changed) => {');
    const handler = main.slice(at, main.indexOf('game.onSettingsChanged', at));
    expect(handler).toMatch(/if \(changed\.some\(k => k === 'enhancedLighting' \|\| k === 'reflections' \|\| k === 'rtFlashlight'\)\) void game\.relightAfterSettings\(\);/);
    expect(handler.match(/rtFlashlight/g)).toHaveLength(1);
    expect(handler.indexOf('copySettingsInto(game.settings, s)')).toBeLessThan(handler.indexOf("k === 'rtFlashlight'"));
  });

  it('the recorder\'s environment: requested.rt, the record\'s rt fields and the capability, as plain copies (additive)', () => {
    const st = status({requested: {lighting: 'on', reflections: 'high', rt: true}, rtCapability: OK}, {rt: true, rtReason: null, rtScene: {triangles: 9, instances: 2}});
    const env = lightingEnvironment({status: () => st})!;
    expect(env).toEqual({line: enhancedLightingLine(st), requested: {lighting: 'on', reflections: 'high', rt: true}, active: st.active, pending: false, cacheBackend: 'indexeddb', rtCapability: OK});
    expect((env.active as EnhancedLightingActive).rtScene).not.toBe(st.active!.rtScene);
    expect(env.rtCapability).not.toBe(st.rtCapability);
    expect(JSON.parse(JSON.stringify(env))).toEqual(env);
    expect(String(env.line)).toContain(' · bounce traced (9 tris, 2 obj)');
    // a status without the capability (from before the setting): no such key
    const {rtCapability: _c, ...older} = st;
    expect(Object.keys(lightingEnvironment({status: () => older})!)).toEqual(['line', 'requested', 'active', 'pending', 'cacheBackend']);
    expect(lightingEnvironment({status: () => status({rtCapability: null}, null)})).toMatchObject({rtCapability: null, active: null});
  });
});
