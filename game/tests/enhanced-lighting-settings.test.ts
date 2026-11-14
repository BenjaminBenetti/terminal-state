// Task studio-baked-lighting-reflections-20261114-050258-01 (lane SETTINGS): the two ENHANCED LIGHTING settings, their form rows, their
// truthful status lines and the diagnostics surfaces. The contract (world/enhancedLighting.ts: modes, defaults, validators, labels,
// options, the describe functions) and the runtime (world/enhancedLightingRuntime.ts) are the lead's; this file pins what the lane adds.
//  1. the store (ui/settingsStore.ts): enhancedLighting (default Auto) and reflections (default Standard) in the browser settings
//     record — a record from before them reads the defaults without being "fixed"; any other value falls back (fixed); a change
//     persists across a reload and notifies exactly that key; a session override is never persisted; copied into the game's Settings;
//     never part of a save slot;
//  2. the cache line's wording (lightingCacheLine) from the derived cache's own numbers;
//  3. the settings form (ui/mainMenu.ts, menu AND pause menu): "Enhanced lighting" and "Reflections" after Ambient occlusion — ids,
//     options and their order from the contract, help lines equal to the contract's describe functions for (a) no status, (b) an active
//     enhanced station, (c) a pending change, (d) a fallback reason; Reflections disabled while Enhanced lighting is Off (its value
//     kept); the cache line for the IndexedDB / session-only / unopened cases, the Clear button, and that late or failed async answers
//     never reach a replaced form or throw;
//  4. the plumbing (main.ts source text): both forms get the runtime's status / cache / clear / change signal; ?lighting= and
//     ?reflections= are session overrides; a change re-applies nothing;
//  5. diagnostics: the perf overlay's Lighting row, the recorder's environment value, the QA hooks.
import {describe, expect, it, vi} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {MiniEl, MiniEvent, MiniText, installMiniDom} from './helpers/paperMapDom';
import {mountSettingsForm, type SettingsFormOptions} from '../src/ui/mainMenu';
import {
  SETTINGS_DEFAULTS, SETTINGS_KEYS, SETTINGS_VERSION, SettingsStore, copySettingsInto, lightingCacheLine, megabytes, parseStoredSettings, sanitizeSettings,
  serializeSettings, type SettingsStorage,
} from '../src/ui/settingsStore';
import {STORAGE_KEYS} from '../src/campaign/types';
import {
  ENHANCED_LIGHTING_DEFAULT, ENHANCED_LIGHTING_LABEL, ENHANCED_LIGHTING_MODES, ENHANCED_LIGHTING_OPTIONS, REACTOR_REASON, REFLECTIONS_DEFAULT, REFLECTIONS_LABEL,
  REFLECTION_OPTIONS, REFLECTION_QUALITIES, SOFTWARE_REASON, describeEnhancedLighting, describeReflections, enhancedLightingLine, enhancedLightingSummary,
  isEnhancedLightingMode, isReflectionQuality, reflectionsSummary,
  type EnhancedLightingActive, type EnhancedLightingStatus,
} from '../src/world/enhancedLighting';
import {EnhancedLightingRuntime} from '../src/world/enhancedLightingRuntime';
import type {DerivedCacheStats} from '../src/core/derivedCache';
import {PerfOverlay, type PerfHost} from '../src/debug/overlay';
import {lightingEnvironment} from '../src/debug/perfRecorderHooks';
import {PERF_SCHEMA_MINOR} from '../src/debug/perfRecorder';

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.writes++; this.map.set(k, v); }
}

const MIB = 1048576;
const ACTIVE: EnhancedLightingActive = {gi: 'standard', giReason: null, reflections: 'standard', reflectionsReason: null, cache: 'hit', giMs: 0, probeMs: 0, probes: 42, probeBytes: 1_500_000};
/** A runtime status: `a` overrides the live station's fields (null = no station built yet). */
const status = (o: Partial<EnhancedLightingStatus> = {}, a: Partial<EnhancedLightingActive> | null = {}): EnhancedLightingStatus => ({
  requested: {lighting: 'auto', reflections: 'standard'}, active: a === null ? null : {...ACTIVE, ...a}, pending: false, cacheBackend: 'indexeddb', ...o});
const stats = (o: Partial<DerivedCacheStats> = {}): DerivedCacheStats => ({
  backend: 'indexeddb', reason: null, entries: 3, bytes: Math.round(12.4 * MIB), maxEntries: 48, maxBytes: 96 * MIB, hits: 0, misses: 0, puts: 0, failedPuts: 0, evictions: 0, corrupt: 0, ...o});
/** Every pending promise callback (the form's cache reads / clears) has run. */
const settle = () => new Promise<void>(r => setTimeout(r, 0));
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
}
/** Copy that must never appear in this feature's player-facing text: no performance / memory promises, no wrong technique names. */
const OVERCLAIM = /ray.?trac|real.?time|vram|\bfps\b|faster|frame rate/i;

// =============================================================================================
describe('the store: enhancedLighting / reflections in the browser settings record only', () => {
  it('defaults are the contract\'s (Auto / Standard); both are settings keys; the record version is unchanged', () => {
    expect([SETTINGS_DEFAULTS.enhancedLighting, SETTINGS_DEFAULTS.reflections]).toEqual([ENHANCED_LIGHTING_DEFAULT, REFLECTIONS_DEFAULT]);
    expect([SETTINGS_DEFAULTS.enhancedLighting, SETTINGS_DEFAULTS.reflections]).toEqual(['auto', 'standard']);
    expect(SETTINGS_KEYS).toEqual(expect.arrayContaining(['enhancedLighting', 'reflections']));
    expect(new Set(SETTINGS_KEYS).size).toBe(SETTINGS_KEYS.length);
    expect(Object.keys(SETTINGS_DEFAULTS).sort()).toEqual([...SETTINGS_KEYS].sort());
    expect(SETTINGS_VERSION).toBe(1);
    const fresh = new SettingsStore(new MemStorage());
    expect(fresh.get()).toMatchObject({enhancedLighting: 'auto', reflections: 'standard'});
    expect(parseStoredSettings(null).settings).toMatchObject({enhancedLighting: 'auto', reflections: 'standard'});
  });

  it('a record from before the settings existed reads the defaults and is not "fixed"; everything else in it is kept', () => {
    const old = parseStoredSettings(JSON.stringify({v: 1, sens: 1.4, fov: 80, volume: 0.5, muted: false, invertX: false, invertY: true, quality: 'low', renderScale: 0.5, trainSway: 1, ambientOcclusion: false}));
    expect(old.settings).toEqual({sens: 1.4, fov: 80, volume: 0.5, muted: false, invertX: false, invertY: true, quality: 'low', renderScale: 0.5, trainSway: 1, ambientOcclusion: false, enhancedLighting: 'auto', reflections: 'standard'});
    expect([old.source, old.fixed]).toEqual(['stored', []]);
    // one of the two present: the other is defaulted, still nothing "fixed"
    const half = parseStoredSettings(JSON.stringify({v: 1, reflections: 'high'}));
    expect(half.settings).toMatchObject({enhancedLighting: 'auto', reflections: 'high'});
    expect([half.source, half.fixed]).toEqual(['stored', []]);
    // a store over such a record: loads clean and writes nothing until a change
    const mem = new MemStorage();
    mem.map.set(STORAGE_KEYS.settings, JSON.stringify({v: 1, fov: 90}));
    const s = new SettingsStore(mem);
    expect(s.loadReport).toEqual({source: 'stored', fixed: []});
    expect(s.get()).toMatchObject({fov: 90, enhancedLighting: 'auto', reflections: 'standard'});
    expect(mem.writes).toBe(0);
  });

  it('any other value falls back to the default and IS "fixed" (like quality); the other fields are untouched', () => {
    for (const bad of ['ultra', 'AUTO', 'standard', 'high', '', 0, 1, true, false, null, {}, ['on']]) {
      const r = sanitizeSettings({...SETTINGS_DEFAULTS, enhancedLighting: bad, reflections: 'high', fov: 90});
      expect(r.settings, String(bad)).toMatchObject({enhancedLighting: 'auto', reflections: 'high', fov: 90});
      expect(r.fixed, String(bad)).toEqual(['enhancedLighting']);
    }
    for (const bad of ['ultra', 'Standard', 'on', 'auto', 'low', '', 0, 2, true, null, {}, ['high']]) {
      const r = sanitizeSettings({...SETTINGS_DEFAULTS, enhancedLighting: 'on', reflections: bad, quality: 'low'});
      expect(r.settings, String(bad)).toMatchObject({enhancedLighting: 'on', reflections: 'standard', quality: 'low'});
      expect(r.fixed, String(bad)).toEqual(['reflections']);
    }
    const both = parseStoredSettings(JSON.stringify({v: 1, enhancedLighting: 'max', reflections: 7, sens: 2}));
    expect(both.settings).toMatchObject({enhancedLighting: 'auto', reflections: 'standard', sens: 2});
    expect([both.source, [...both.fixed].sort()]).toEqual(['invalid', ['enhancedLighting', 'reflections']]);
    // the store's validation is the contract's: the same values are accepted by both
    for (const v of ['off', 'auto', 'on', 'standard', 'high', 'x', null]) {
      expect(sanitizeSettings({enhancedLighting: v}).fixed.includes('enhancedLighting'), String(v)).toBe(!isEnhancedLightingMode(v));
      expect(sanitizeSettings({reflections: v}).fixed.includes('reflections'), String(v)).toBe(!isReflectionQuality(v));
    }
  });

  it('round trip: every pair survives a reload (a new store on the same storage); a change notifies exactly its key', () => {
    for (const enhancedLighting of ENHANCED_LIGHTING_MODES) for (const reflections of REFLECTION_QUALITIES) {
      const mem = new MemStorage();
      new SettingsStore(mem).set({enhancedLighting, reflections});
      const b = new SettingsStore(mem);
      expect(b.get()).toEqual({...SETTINGS_DEFAULTS, enhancedLighting, reflections});
      expect(b.loadReport).toEqual({source: 'stored', fixed: []});
    }
    const mem = new MemStorage();
    const a = new SettingsStore(mem);
    a.set({quality: 'low', renderScale: 0.5, ambientOcclusion: false});
    const changes: string[][] = [];
    a.subscribe((_, ch) => changes.push([...ch]));
    a.set({enhancedLighting: 'on'});
    a.set({reflections: 'high'});
    a.set({reflections: 'high'}); // a no-op: no event
    a.set({enhancedLighting: 'off', reflections: 'off'});
    expect(changes).toEqual([['enhancedLighting'], ['reflections'], ['enhancedLighting', 'reflections']]);
    const record = JSON.parse(mem.getItem(STORAGE_KEYS.settings)!);
    expect(record).toMatchObject({v: 1, enhancedLighting: 'off', reflections: 'off', quality: 'low', renderScale: 0.5, ambientOcclusion: false});
    expect(serializeSettings(a.stored())).toMatch(/"enhancedLighting":"off"/);
    expect(serializeSettings(a.stored())).toMatch(/"reflections":"off"/);
    // a patch is validated too: the UI can never store an invalid value
    a.set({enhancedLighting: 'max' as never, reflections: 'ultra' as never});
    expect(a.get()).toMatchObject({enhancedLighting: 'auto', reflections: 'standard'});
    expect(parseStoredSettings(mem.getItem(STORAGE_KEYS.settings)).source).toBe('stored');
  });

  it('turning Enhanced lighting off keeps the stored Reflections choice (and back)', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    s.set({reflections: 'high'});
    s.set({enhancedLighting: 'off'});
    expect(new SettingsStore(mem).get()).toMatchObject({enhancedLighting: 'off', reflections: 'high'});
    s.set({enhancedLighting: 'on'});
    expect(s.get().reflections).toBe('high');
  });

  it('a session override (?lighting= / ?reflections=) applies but is never persisted; an explicit change persists and drops it', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    s.sessionOverride({enhancedLighting: 'off', reflections: 'high'});
    expect(s.get()).toMatchObject({enhancedLighting: 'off', reflections: 'high'});
    expect(s.stored()).toMatchObject({enhancedLighting: 'auto', reflections: 'standard'});
    expect(mem.writes).toBe(0); // nothing written by the override
    s.set({fov: 85}); // another key: the overrides stay, and the record written holds the STORED choices
    expect(s.get()).toMatchObject({enhancedLighting: 'off', reflections: 'high', fov: 85});
    expect(JSON.parse(mem.getItem(STORAGE_KEYS.settings)!)).toMatchObject({enhancedLighting: 'auto', reflections: 'standard', fov: 85});
    expect(new SettingsStore(mem).get()).toMatchObject({enhancedLighting: 'auto', reflections: 'standard', fov: 85});
    s.set({enhancedLighting: 'on'}); // chosen explicitly: persisted, that override gone; the other one stays
    expect(s.get()).toMatchObject({enhancedLighting: 'on', reflections: 'high'});
    expect(new SettingsStore(mem).get()).toMatchObject({enhancedLighting: 'on', reflections: 'standard'});
    s.reset();
    expect(s.get()).toMatchObject({enhancedLighting: 'auto', reflections: 'standard'});
  });

  it('copySettingsInto hands both to the game\'s Settings; a target from before them (the fields are optional) still gets them; no quality change', () => {
    const target = {sens: 1, fov: 75, volume: 0.7, muted: false, invertX: false, invertY: false, quality: 'high' as 'low' | 'high', renderScale: 1, trainSway: 1, ambientOcclusion: true,
      enhancedLighting: 'auto' as 'off' | 'auto' | 'on', reflections: 'standard' as 'off' | 'standard' | 'high'};
    expect(copySettingsInto(target, {...SETTINGS_DEFAULTS, enhancedLighting: 'on', reflections: 'off'}).qualityChanged).toBe(false);
    expect([target.enhancedLighting, target.reflections]).toEqual(['on', 'off']);
    const older = {sens: 1, fov: 75, volume: 0.7, muted: false, invertX: false, invertY: false, quality: 'high' as 'low' | 'high', renderScale: 1, trainSway: 1};
    expect(copySettingsInto(older, {...SETTINGS_DEFAULTS, enhancedLighting: 'off', reflections: 'high'}).qualityChanged).toBe(false);
    expect(older).toMatchObject({enhancedLighting: 'off', reflections: 'high'});
    // the runtime reads the game's live Settings object: what the store copied in is what it reports as requested
    const rt = new EnhancedLightingRuntime(target);
    expect(rt.request()).toEqual({lighting: 'on', reflections: 'off'});
    copySettingsInto(target, {...SETTINGS_DEFAULTS, enhancedLighting: 'auto', reflections: 'high'});
    expect(rt.status().requested).toEqual({lighting: 'auto', reflections: 'high'});
  });

  it('not save content: no save source mentions the two settings; the settings module opens no cache', () => {
    const dir = path.resolve(__dirname, '../src/save');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
    expect(files).toEqual(expect.arrayContaining(['serialize.ts', 'validate.ts', 'slots.ts']));
    for (const f of files) expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/enhancedLighting|reflections/);
    const store = SRC('src/ui/settingsStore.ts');
    expect(store).toMatch(/import type \{DerivedCacheStats\} from '\.\.\/core\/derivedCache';/); // the numbers' type only
    expect(store).not.toMatch(/openDerivedCache|indexedDB\b|DERIVED_DB_NAME/);
    expect(store).toMatch(/export const SETTINGS_VERSION = 1;/);
  });
});

// =============================================================================================
describe('the cache line: the derived cache\'s own numbers, worded honestly', () => {
  it('IndexedDB: stations, stored size of the limit, in this browser, rebuildable and never part of a save', () => {
    expect(lightingCacheLine(stats())).toBe('Lighting cache: 3 stations · 12.4 MB of 96 MB in this browser (rebuilt when missing; never part of a save)');
    expect(lightingCacheLine(stats({entries: 1, bytes: 4 * MIB}))).toBe('Lighting cache: 1 station · 4 MB of 96 MB in this browser (rebuilt when missing; never part of a save)');
    expect(lightingCacheLine(stats({entries: 0, bytes: 0}))).toBe('Lighting cache: 0 stations · 0 MB of 96 MB in this browser (rebuilt when missing; never part of a save)');
    expect(lightingCacheLine(stats({entries: 2, bytes: 30_000, maxBytes: 32 * MIB}))).toBe('Lighting cache: 2 stations · <0.1 MB of 32 MB in this browser (rebuilt when missing; never part of a save)');
  });

  it('session only (storage unavailable): says so with the cache\'s reason; no backend: not available; never opened: no line', () => {
    expect(lightingCacheLine(stats({backend: 'memory', reason: 'IndexedDB is not available here'}))).toBe('Lighting cache: this session only — IndexedDB is not available here');
    expect(lightingCacheLine(stats({backend: 'memory', reason: null}))).toBe('Lighting cache: this session only');
    expect(lightingCacheLine(stats({backend: 'none', reason: 'storage is blocked'}))).toBe('Lighting cache: not available — storage is blocked');
    expect(lightingCacheLine(stats({backend: 'none', reason: null}))).toBe('Lighting cache: not available');
    expect(lightingCacheLine(null)).toBe(null);
    expect(lightingCacheLine(undefined)).toBe(null);
  });

  it('megabytes: binary MB, one decimal at most, never negative / NaN; no line makes a performance or memory promise', () => {
    expect([megabytes(0), megabytes(96 * MIB), megabytes(12.44 * MIB), megabytes(0.26 * MIB), megabytes(1), megabytes(-5), megabytes(Number.NaN)])
      .toEqual(['0 MB', '96 MB', '12.4 MB', '0.3 MB', '<0.1 MB', '0 MB', '0 MB']);
    for (const s of [stats(), stats({backend: 'memory', reason: 'x'}), stats({backend: 'none'})]) expect(lightingCacheLine(s)).not.toMatch(OVERCLAIM);
  });
});

// =============================================================================================
/** The bits of the DOM the settings form / the perf overlay use that the shared mini DOM leaves out (patched for this file only). */
function patchMiniDom(): void {
  const P = MiniEl.prototype as unknown as Record<string, unknown>;
  const node = (n: unknown) => (typeof n === 'string' ? new MiniText(n) : n) as MiniEl | MiniText;
  P.append = function (this: MiniEl, ...ns: unknown[]) { for (const n of ns) this.appendChild(node(n)); };
  P.replaceChildren = function (this: MiniEl, ...ns: unknown[]) { for (const c of this.children) c.parent = null; this.children = []; (this as unknown as {append(...x: unknown[]): void}).append(...ns); };
  P.getContext = () => null; // (the overlay's graph canvas: no 2D context here, the graph is skipped)
  Object.defineProperty(P, 'htmlFor', {configurable: true, get() { return {add() {}}; }});
  Object.defineProperty(P, 'ownerDocument', {configurable: true, get(this: MiniEl) { return this.doc; }});
}

type Ctl = MiniEl & {value: string; disabled?: boolean; hidden?: boolean};

function mountForm(o: Partial<SettingsFormOptions> & {store?: SettingsStore} = {}) {
  patchMiniDom();
  const dom = installMiniDom(1920, 1080);
  dom.doc.body.innerHTML = '<div id="box"></div>';
  const box = dom.doc.querySelector('#box')!;
  const {store: given, ...opts} = o;
  const store = given ?? new SettingsStore(new MemStorage());
  const mount = (extra: Partial<SettingsFormOptions> = opts) => mountSettingsForm(box as unknown as HTMLElement, store, {idPrefix: 'mm-set-', viewport: () => ({w: 1920, h: 1080, dpr: 1}), ...extra});
  const off = mount();
  const el = (id: string) => box.querySelector(`#mm-set-${id}`) as unknown as Ctl;
  const choose = (id: string, value: string) => { const sel = el(id); sel.value = value; sel.dispatchEvent(new MiniEvent('change')); };
  /** Everything this lane shows: the two rows (label + choices), their help lines, the cache line and the button. */
  const copy = () => ['lighting', 'reflections'].map(id => `${el(id).parentElement!.textContent} ${el(`${id}-help`).textContent}`).concat(el('lighting-cache').textContent, el('lighting-cache-clear').textContent).join(' | ');
  return {dom, box, store, off, el, choose, mount, copy};
}

/** A stand-in for the game's runtime as main.ts wires it: the status follows the store (the game copies the settings in first). */
function fakeRuntime(store: SettingsStore, live: {active: EnhancedLightingActive | null; pending: boolean} = {active: null, pending: false}) {
  const listeners = new Set<() => void>();
  let reads = 0;
  return {
    live,
    get reads() { return reads; },
    listeners,
    status: (): EnhancedLightingStatus => { reads++; const s = store.get(); return {requested: {lighting: s.enhancedLighting, reflections: s.reflections}, active: live.active, pending: live.pending, cacheBackend: 'indexeddb'}; },
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    changed: () => { for (const fn of [...listeners]) fn(); },
  };
}

describe('the settings form: "Enhanced lighting" and "Reflections" after Ambient occlusion', () => {
  it('ids, labels, the contract\'s options in its order, help lines wired; in the graphics part after Ambient occlusion', () => {
    const m = mountForm();
    try {
      const light = m.el('lighting'), refl = m.el('reflections');
      expect(light.tagName).toBe('SELECT');
      expect(refl.tagName).toBe('SELECT');
      expect(light.parentElement!.textContent).toContain(ENHANCED_LIGHTING_LABEL);
      expect(refl.parentElement!.textContent).toContain(REFLECTIONS_LABEL);
      expect([ENHANCED_LIGHTING_LABEL, REFLECTIONS_LABEL]).toEqual(['Enhanced lighting', 'Reflections']);
      const opts = (sel: MiniEl) => sel.querySelectorAll('option').map(op => [(op as unknown as {value: string}).value, op.textContent]);
      expect(opts(light)).toEqual(ENHANCED_LIGHTING_OPTIONS.map(q => [q.value, q.label]));
      expect(opts(refl)).toEqual(REFLECTION_OPTIONS.map(q => [q.value, q.label]));
      expect(opts(light)).toEqual([['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]);
      expect(opts(refl)).toEqual([['standard', 'Standard'], ['high', 'High'], ['off', 'Off']]);
      expect([light.value, refl.value]).toEqual(['auto', 'standard']);
      expect(light.getAttribute('aria-describedby')).toBe('mm-set-lighting-help');
      expect(refl.getAttribute('aria-describedby')).toBe('mm-set-reflections-help');
      expect(m.el('lighting-help')).not.toBe(null);
      expect(m.el('reflections-help')).not.toBe(null);
      // the whole form's controls, in order: view / audio, then the graphics choices — the two new ones after Ambient occlusion
      expect(m.box.querySelectorAll('select, input').map(e => e.id)).toEqual(['mm-set-fov', 'mm-set-vol', 'mm-set-mute', 'mm-set-sway', 'mm-set-quality', 'mm-set-res', 'mm-set-ao', 'mm-set-lighting', 'mm-set-reflections']);
      expect(m.box.querySelectorAll('button').map(e => e.id)).toEqual(['mm-set-lighting-cache-clear']);
      // each help line directly follows its own row; the cache line and the button come after the form's (first) note
      const kids = m.box.elements.map(e => e.id || e.className);
      const at = (id: string) => kids.indexOf(id);
      expect(at('mm-set-ao-help')).toBeGreaterThan(0);
      expect(at('mm-set-lighting-help')).toBe(at('mm-set-ao-help') + 2);
      expect(at('mm-set-reflections-help')).toBe(at('mm-set-lighting-help') + 2);
      expect(kids[at('mm-set-reflections-help') + 1]).toBe('set-note'); // the store's own note: still the first .set-note
      expect(at('mm-set-lighting-cache')).toBe(at('mm-set-reflections-help') + 2);
      expect(m.box.querySelector('.set-note')!.id).toBe('');
      expect(m.el('lighting-cache-clear').parentElement!.parentElement).toBe(m.box);
      expect(m.el('lighting-cache-clear').textContent).toBe('Clear lighting cache');
      expect(m.el('lighting-cache-clear').getAttribute('aria-describedby')).toBe('mm-set-lighting-cache');
      m.off();
    } finally { m.dom.uninstall(); }
  });

  it('the pause menu\'s form (prefix set-) has the same rows under its own ids', () => {
    patchMiniDom();
    const dom = installMiniDom();
    try {
      dom.doc.body.innerHTML = '<div id="pause-settings"></div>';
      const box = dom.doc.querySelector('#pause-settings')!;
      const off = mountSettingsForm(box as unknown as HTMLElement, new SettingsStore(new MemStorage()), {idPrefix: 'set-'});
      for (const id of ['set-lighting', 'set-lighting-help', 'set-reflections', 'set-reflections-help', 'set-lighting-cache', 'set-lighting-cache-clear']) expect(box.querySelector(`#${id}`), id).not.toBe(null);
      off();
    } finally { dom.uninstall(); }
  });

  it('(a) no status (no option, or it returns null): the help lines say what the stored choices mean', async () => {
    for (const lightingStatus of [undefined, () => null]) {
      const m = mountForm({lightingStatus});
      try {
        const none = (lighting: 'off' | 'auto' | 'on', reflections: 'off' | 'standard' | 'high'): EnhancedLightingStatus => ({requested: {lighting, reflections}, active: null, pending: false, cacheBackend: 'none'});
        expect(m.el('lighting-help').textContent).toBe(describeEnhancedLighting(none('auto', 'standard')));
        expect(m.el('lighting-help').textContent).toBe(enhancedLightingSummary('auto'));
        expect(m.el('reflections-help').textContent).toBe(reflectionsSummary('standard'));
        for (const lighting of ENHANCED_LIGHTING_MODES) for (const reflections of REFLECTION_QUALITIES) {
          m.store.set({enhancedLighting: lighting, reflections});
          expect(m.el('lighting-help').textContent).toBe(describeEnhancedLighting(none(lighting, reflections)));
          expect(m.el('reflections-help').textContent).toBe(describeReflections(none(lighting, reflections)));
          expect(m.copy()).not.toMatch(OVERCLAIM);
        }
        m.off();
        await settle();
      } finally { m.dom.uninstall(); }
    }
  });

  it('(b) an active enhanced station: the lines say what the live station really uses', () => {
    const st = status();
    const m = mountForm({lightingStatus: () => st});
    try {
      expect(m.el('lighting-help').textContent).toBe(describeEnhancedLighting(st));
      expect(m.el('reflections-help').textContent).toBe(describeReflections(st));
      expect(m.el('lighting-help').textContent).toBe('This station: enhanced bake (standard), from the cache');
      expect(m.el('reflections-help').textContent).toBe('This station: 42 probes (standard)');
      m.off();
    } finally { m.dom.uninstall(); }
  });

  it('(c) a pending change: what the live station uses now, and that the change applies when a station next loads', () => {
    const st = status({requested: {lighting: 'on', reflections: 'high'}, pending: true}, {cache: 'miss'});
    const m = mountForm({lightingStatus: () => st});
    try {
      expect(m.el('lighting-help').textContent).toBe(describeEnhancedLighting(st));
      expect(m.el('reflections-help').textContent).toBe(describeReflections(st));
      expect(m.el('lighting-help').textContent).toBe('This station: enhanced bake (standard), baked and cached. Applies when a station next loads.');
      expect(m.el('reflections-help').textContent).toMatch(/^This station: 42 probes \(standard\)\. Applies when a station next loads\.$/);
      m.off();
    } finally { m.dom.uninstall(); }
  });

  it('(d) a fallback: the reason the live station does not use what was asked is shown, never hidden', () => {
    const soft = status({}, {reflections: 'off', reflectionsReason: SOFTWARE_REASON, probes: 0, probeBytes: 0});
    const a = mountForm({lightingStatus: () => soft});
    try {
      expect(a.el('lighting-help').textContent).toBe(describeEnhancedLighting(soft));
      expect(a.el('reflections-help').textContent).toBe(describeReflections(soft));
      expect(a.el('reflections-help').textContent).toBe(`This station: no reflections — ${SOFTWARE_REASON}`);
      a.off();
    } finally { a.dom.uninstall(); }
    const reactor = status({cacheBackend: 'none'}, {gi: 'baseline', giReason: REACTOR_REASON, reflections: 'off', reflectionsReason: REACTOR_REASON, cache: 'none', probes: 0, probeBytes: 0});
    const b = mountForm({lightingStatus: () => reactor});
    try {
      expect(b.el('lighting-help').textContent).toBe(describeEnhancedLighting(reactor));
      expect(b.el('lighting-help').textContent).toBe(`This station: baseline lighting — ${REACTOR_REASON}`);
      expect(b.el('reflections-help').textContent).toBe(describeReflections(reactor));
      b.off();
    } finally { b.dom.uninstall(); }
    const unstored = status({cacheBackend: 'memory'}, {cache: 'unavailable'});
    const c = mountForm({lightingStatus: () => unstored});
    try {
      expect(c.el('lighting-help').textContent).toBe(describeEnhancedLighting(unstored));
      expect(c.el('lighting-help').textContent).toMatch(/browser storage is unavailable/);
      c.off();
    } finally { c.dom.uninstall(); }
  });

  it('bound both ways: a choice is stored (nothing else changes), another form\'s change shows here, an unknown value is ignored', () => {
    const mem = new MemStorage();
    const store = new SettingsStore(mem);
    const rt = fakeRuntime(store);
    const m = mountForm({store, lightingStatus: rt.status});
    try {
      const changes: string[][] = [];
      store.subscribe((_, ch) => changes.push([...ch]));
      m.choose('lighting', 'on');
      expect(store.get().enhancedLighting).toBe('on');
      expect(m.el('lighting-help').textContent).toBe(enhancedLightingSummary('on'));
      m.choose('reflections', 'high');
      expect(store.get().reflections).toBe('high');
      expect(m.el('reflections-help').textContent).toBe(reflectionsSummary('high'));
      expect(changes).toEqual([['enhancedLighting'], ['reflections']]);
      expect(JSON.parse(mem.getItem(STORAGE_KEYS.settings)!)).toMatchObject({enhancedLighting: 'on', reflections: 'high'});
      store.set({enhancedLighting: 'auto', reflections: 'off'}); // another form (the pause menu) changed them
      expect([m.el('lighting').value, m.el('reflections').value]).toEqual(['auto', 'off']);
      expect(m.el('reflections-help').textContent).toBe(reflectionsSummary('off'));
      m.choose('lighting', 'ultra'); // not a mode: nothing stored
      m.choose('reflections', 'on');
      expect(store.get()).toMatchObject({enhancedLighting: 'auto', reflections: 'off'});
      expect(changes).toHaveLength(3);
      m.off();
    } finally { m.dom.uninstall(); }
  });

  it('Reflections is disabled while Enhanced lighting is Off — its stored value kept — and says why', () => {
    const store = new SettingsStore(new MemStorage());
    store.set({reflections: 'high'});
    const rt = fakeRuntime(store);
    const m = mountForm({store, lightingStatus: rt.status});
    try {
      expect(m.el('reflections').disabled).toBe(false);
      m.choose('lighting', 'off');
      expect(m.el('reflections').disabled).toBe(true);
      expect(m.el('reflections').value).toBe('high');
      expect(store.get()).toMatchObject({enhancedLighting: 'off', reflections: 'high'});
      expect(m.el('reflections-help').textContent).toBe('Needs Enhanced lighting (it is off)');
      expect(m.el('lighting-help').textContent).toBe(enhancedLightingSummary('off'));
      expect(m.el('lighting').disabled).not.toBe(true);
      m.choose('lighting', 'auto');
      expect(m.el('reflections').disabled).toBe(false);
      expect(m.el('reflections').value).toBe('high');
      expect(m.el('reflections-help').textContent).toBe(reflectionsSummary('high'));
      m.off();
    } finally { m.dom.uninstall(); }
    // a form mounted while it is already off (a stored Off, or ?lighting=off) starts disabled
    const off = new SettingsStore(new MemStorage());
    off.sessionOverride({enhancedLighting: 'off'});
    const n = mountForm({store: off});
    try {
      expect([n.el('lighting').value, n.el('reflections').disabled]).toEqual(['off', true]);
      n.off();
    } finally { n.dom.uninstall(); }
  });

  it('the status signal: the form hands its refresh over once; a station built later updates the lines without a settings change; unmount unsubscribes', async () => {
    const store = new SettingsStore(new MemStorage());
    const rt = fakeRuntime(store);
    let handed = 0;
    const m = mountForm({store, lightingStatus: rt.status, lightingChanged: fn => { handed++; return rt.subscribe(fn); }});
    try {
      expect(handed).toBe(1);
      expect(rt.listeners.size).toBe(1);
      expect(m.el('lighting-help').textContent).toBe(enhancedLightingSummary('auto'));
      rt.live.active = {...ACTIVE, cache: 'miss', giMs: 840, probeMs: 310}; // the first station of the session was built
      rt.changed();
      expect(m.el('lighting-help').textContent).toBe('This station: enhanced bake (standard), baked and cached');
      expect(m.el('reflections-help').textContent).toBe('This station: 42 probes (standard)');
      m.choose('lighting', 'on'); // the runtime now reports the change as pending
      rt.live.pending = true;
      rt.changed();
      expect(m.el('lighting-help').textContent).toBe(`This station: enhanced bake (standard), baked and cached. Applies when a station next loads.`);
      // the store events refresh the lines too (any setting: the status is re-read)
      rt.live.pending = false;
      store.set({fov: 90});
      expect(m.el('lighting-help').textContent).toBe('This station: enhanced bake (standard), baked and cached');
      m.off();
      expect(rt.listeners.size).toBe(0);
      const reads = rt.reads;
      rt.changed();
      store.set({fov: 91});
      expect(rt.reads).toBe(reads); // unmounted: nothing is read any more
      await settle();
    } finally { m.dom.uninstall(); }
  });

  it('a status source that throws, or a signal hook that throws, never breaks the form', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const m = mountForm({lightingStatus: () => { throw new Error('boom'); }, lightingChanged: () => { throw new Error('no signal'); }});
      try {
        expect(m.el('lighting-help').textContent).toBe(enhancedLightingSummary('auto'));
        expect(m.el('reflections-help').textContent).toBe(reflectionsSummary('standard'));
        m.choose('lighting', 'off');
        expect(m.store.get().enhancedLighting).toBe('off');
        expect(warn).toHaveBeenCalled();
        expect(() => m.off()).not.toThrow();
        await settle();
      } finally { m.dom.uninstall(); }
    } finally { warn.mockRestore(); }
  });
});

// =============================================================================================
describe('the settings form: the lighting cache line and "Clear lighting cache"', () => {
  it('IndexedDB: the line shows the numbers, the button is there; clearing awaits the clear, then shows the new numbers', async () => {
    let now = stats();
    const gate = deferred<void>();
    let clears = 0;
    const m = mountForm({lightingCache: async () => now, clearLightingCache: () => { clears++; return gate.promise.then(() => { now = stats({entries: 0, bytes: 0}); }); }});
    try {
      const line = m.el('lighting-cache'), btn = m.el('lighting-cache-clear');
      expect(line.classList.contains('set-note')).toBe(true);
      expect([line.textContent, line.classList.contains('hidden'), btn.hidden]).toEqual(['', true, true]); // nothing claimed before the numbers arrive
      await settle();
      expect(line.textContent).toBe(lightingCacheLine(stats()));
      expect(line.textContent).toBe('Lighting cache: 3 stations · 12.4 MB of 96 MB in this browser (rebuilt when missing; never part of a save)');
      expect([line.classList.contains('hidden'), btn.hidden, btn.parentElement!.classList.contains('hidden'), btn.disabled]).toEqual([false, false, false, undefined]);
      m.dom.click(btn);
      m.dom.click(btn); // a second click while it runs does nothing
      await settle();
      expect([clears, btn.disabled]).toEqual([1, true]);
      expect(line.textContent).toBe(lightingCacheLine(stats())); // not claimed empty before the clear finished
      gate.resolve();
      await settle();
      expect(btn.disabled).toBe(false);
      expect(line.textContent).toBe('Lighting cache: 0 stations · 0 MB of 96 MB in this browser (rebuilt when missing; never part of a save)');
      expect(btn.hidden).toBe(false);
      m.dom.click(btn);
      await settle();
      expect(clears).toBe(2);
      expect(m.copy()).toContain('Clear lighting cache');
      expect(m.copy()).not.toMatch(OVERCLAIM);
      m.off();
    } finally { m.dom.uninstall(); }
  });

  it('session only: the line says so with the reason; never opened (null) or no cache option: no line and no button', async () => {
    const mem = mountForm({lightingCache: async () => stats({backend: 'memory', reason: 'IndexedDB is not available here', entries: 1}), clearLightingCache: async () => {}});
    try {
      await settle();
      expect(mem.el('lighting-cache').textContent).toBe('Lighting cache: this session only — IndexedDB is not available here');
      expect(mem.el('lighting-cache-clear').hidden).toBe(false);
      mem.off();
    } finally { mem.dom.uninstall(); }
    for (const o of [{lightingCache: async () => null, clearLightingCache: async () => {}}, {clearLightingCache: async () => {}}, {}] as Partial<SettingsFormOptions>[]) {
      const m = mountForm(o);
      try {
        await settle();
        const line = m.el('lighting-cache'), btn = m.el('lighting-cache-clear');
        expect([line.textContent, line.classList.contains('hidden'), btn.hidden, btn.parentElement!.classList.contains('hidden')]).toEqual(['', true, true, true]);
        m.off();
      } finally { m.dom.uninstall(); }
    }
    // numbers but no way to clear: the line alone
    const ro = mountForm({lightingCache: async () => stats()});
    try {
      await settle();
      expect(ro.el('lighting-cache').classList.contains('hidden')).toBe(false);
      expect(ro.el('lighting-cache-clear').hidden).toBe(true);
      ro.dom.click(ro.el('lighting-cache-clear')); // (hidden; a stray click does nothing)
      await settle();
      ro.off();
    } finally { ro.dom.uninstall(); }
  });

  it('the numbers are re-read on the status signal and when a lighting choice changes — not on every other setting', async () => {
    const store = new SettingsStore(new MemStorage());
    const rt = fakeRuntime(store);
    let now: DerivedCacheStats | null = null, reads = 0;
    const m = mountForm({store, lightingStatus: rt.status, lightingChanged: rt.subscribe, lightingCache: async () => { reads++; return now; }, clearLightingCache: async () => {}});
    try {
      await settle();
      expect([reads, m.el('lighting-cache').textContent]).toEqual([1, '']); // enhanced lighting never ran this session: no line
      now = stats({entries: 1, bytes: 5 * MIB}); // a station was built and stored
      rt.changed();
      await settle();
      expect([reads, m.el('lighting-cache').textContent]).toEqual([2, 'Lighting cache: 1 station · 5 MB of 96 MB in this browser (rebuilt when missing; never part of a save)']);
      store.set({fov: 90});
      store.set({volume: 0.2});
      store.set({ambientOcclusion: false, quality: 'low'});
      await settle();
      expect(reads).toBe(2);
      m.choose('reflections', 'high');
      await settle();
      expect(reads).toBe(3);
      m.off();
      rt.changed();
      await settle();
      expect(reads).toBe(3);
    } finally { m.dom.uninstall(); }
  });

  it('only the newest answer is shown; a failed read or clear is reported to the console, never thrown into the UI', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = deferred<DerivedCacheStats | null>(), second = deferred<DerivedCacheStats | null>();
      const queue = [first, second];
      let refresh: () => void = () => {};
      const m = mountForm({lightingCache: () => (queue.shift() ?? second).promise, lightingChanged: fn => { refresh = fn; }});
      try {
        refresh(); // a second read while the first is still out
        second.resolve(stats({entries: 2}));
        await settle();
        expect(m.el('lighting-cache').textContent).toMatch(/^Lighting cache: 2 stations/);
        first.resolve(stats({entries: 9})); // the older answer arrives late: dropped
        await settle();
        expect(m.el('lighting-cache').textContent).toMatch(/^Lighting cache: 2 stations/);
        m.off();
      } finally { m.dom.uninstall(); }
      // a read that rejects / throws: no line, no throw; a clear that rejects: the button comes back and the line is re-read
      let fail = true, clears = 0;
      const bad = mountForm({
        lightingCache: () => { if (fail) throw new Error('blocked'); return Promise.resolve(stats({entries: 4})); },
        clearLightingCache: () => { clears++; return Promise.reject(new Error('aborted')); },
        lightingChanged: fn => { refresh = fn; },
      });
      try {
        await settle();
        expect([bad.el('lighting-cache').textContent, bad.el('lighting-cache-clear').hidden]).toEqual(['', true]);
        fail = false;
        refresh();
        await settle();
        expect(bad.el('lighting-cache').textContent).toMatch(/^Lighting cache: 4 stations/);
        bad.dom.click(bad.el('lighting-cache-clear'));
        await settle();
        expect([clears, bad.el('lighting-cache-clear').disabled]).toEqual([1, false]);
        expect(bad.el('lighting-cache').textContent).toMatch(/^Lighting cache: 4 stations/); // nothing was cleared: nothing claimed
        expect(warn).toHaveBeenCalled();
        bad.off();
      } finally { bad.dom.uninstall(); }
      const rejecting = mountForm({lightingCache: () => Promise.reject(new Error('gone'))});
      try {
        await settle();
        expect(rejecting.el('lighting-cache').textContent).toBe('');
        rejecting.off();
      } finally { rejecting.dom.uninstall(); }
    } finally { warn.mockRestore(); }
  });

  it('a form replaced meanwhile (mounted again into the same box) never gets the old form\'s late answers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const late = deferred<DerivedCacheStats | null>(), lateClear = deferred<void>();
      let oldRefresh: () => void = () => {}, oldStatusReads = 0;
      const m = mountForm({
        lightingStatus: () => { oldStatusReads++; return null; },
        lightingCache: () => late.promise, clearLightingCache: () => lateClear.promise, lightingChanged: fn => { oldRefresh = fn; },
      });
      try {
        const oldLine = m.el('lighting-cache'), oldBtn = m.el('lighting-cache-clear');
        // the replacement: the old form's cleanup never ran (its box was simply re-used)
        const off2 = m.mount({lightingCache: async () => stats({entries: 7}), clearLightingCache: async () => {}});
        await settle();
        const line = m.el('lighting-cache');
        expect(line).not.toBe(oldLine);
        expect(line.textContent).toMatch(/^Lighting cache: 7 stations/);
        expect(m.box.querySelectorAll('#mm-set-lighting')).toHaveLength(1);
        const reads = oldStatusReads;
        late.resolve(stats({entries: 99}));
        oldRefresh(); // the runtime still holds the old form's refresh: a no-op now
        m.dom.click(oldBtn); // a click on the detached button: nothing
        lateClear.resolve();
        await settle();
        expect(oldStatusReads).toBe(reads);
        expect([oldLine.textContent, oldBtn.hidden]).toEqual(['', true]);
        expect(line.textContent).toMatch(/^Lighting cache: 7 stations/);
        off2();
        expect(() => m.off()).not.toThrow();
      } finally { m.dom.uninstall(); }
      // an answer that arrives after the unmount is dropped too
      const slow = deferred<DerivedCacheStats | null>();
      const n = mountForm({lightingCache: () => slow.promise});
      try {
        const line = n.el('lighting-cache');
        n.off();
        slow.resolve(stats());
        await settle();
        expect(line.textContent).toBe('');
      } finally { n.dom.uninstall(); }
    } finally { warn.mockRestore(); }
  });

  it('with the lead\'s runtime as it is wired in main.ts: status, cache numbers, clear and the change signal all go through its interface', async () => {
    const settings = {enhancedLighting: 'auto' as 'off' | 'auto' | 'on', reflections: 'standard' as 'off' | 'standard' | 'high'};
    const rt = new EnhancedLightingRuntime(settings);
    const statusSpy = vi.spyOn(rt, 'status'), cacheSpy = vi.spyOn(rt, 'cacheStats'), clearSpy = vi.spyOn(rt, 'clearCache');
    const store = new SettingsStore(new MemStorage());
    store.subscribe(s => { settings.enhancedLighting = s.enhancedLighting; settings.reflections = s.reflections; }); // main.ts: the copy runs before the forms
    const m = mountForm({store, lightingStatus: () => rt.status(), lightingCache: () => rt.cacheStats(), clearLightingCache: () => rt.clearCache(), lightingChanged: fn => rt.subscribe(fn)});
    try {
      await settle();
      expect(statusSpy).toHaveBeenCalled();
      expect(cacheSpy).toHaveBeenCalledTimes(1);
      expect(m.el('lighting-help').textContent).toBe(describeEnhancedLighting(rt.status()));
      expect(m.el('reflections-help').textContent).toBe(describeReflections(rt.status()));
      const line = m.el('lighting-cache');
      expect(line.textContent).toBe(lightingCacheLine(await rt.cacheStats()) ?? '');
      m.choose('lighting', 'off');
      expect(rt.request()).toEqual({lighting: 'off', reflections: 'standard'});
      expect(m.el('reflections-help').textContent).toBe(describeReflections(rt.status()));
      if (!m.el('lighting-cache-clear').hidden) { m.dom.click(m.el('lighting-cache-clear')); await settle(); expect(clearSpy).toHaveBeenCalledTimes(1); }
      const reads = cacheSpy.mock.calls.length;
      await rt.clearCache(); // the runtime tells its subscribers: the form re-reads
      await settle();
      expect(cacheSpy.mock.calls.length).toBeGreaterThan(reads);
      m.off();
    } finally { m.dom.uninstall(); }
  });
});

// =============================================================================================
describe('the plumbing: main.ts hands both forms the runtime; ?lighting= / ?reflections= are session overrides; nothing is re-applied', () => {
  const main = SRC('src/main.ts');

  it('both mounts (the pause menu\'s and the main menu\'s form) get the status, the cache numbers, the clear and the change signal', () => {
    expect(main).toMatch(/const lightingStatus = \(\) => game\.enhancedLighting\.status\(\);/);
    expect(main).toMatch(/const lightingCache = \(\) => game\.enhancedLighting\.cacheStats\(\);/);
    expect(main).toMatch(/const clearLightingCache = \(\) => game\.enhancedLighting\.clearCache\(\);/);
    expect(main).toMatch(/const lightingChanged = \(refresh: \(\) => void\) => game\.enhancedLighting\.subscribe\(refresh\);/);
    expect(main.match(/mountSettingsForm\(/g)).toHaveLength(2);
    expect(main.match(/lightingStatus, lightingCache, clearLightingCache, lightingChanged, qualityPresets: ATMOSPHERE_QUALITY, aoUnavailable\}\)/g)).toHaveLength(2);
    expect(main).toMatch(/mountSettingsForm\(\$\('#pause-settings'\), settings, \{idPrefix: 'set-', lightingStatus, /);
    expect(main).toMatch(/mountSettingsForm\(box, settings, \{idPrefix: 'mm-set-', lightingStatus, /);
    // the game's copy of the settings is updated BEFORE the forms' own subscriptions run (the status a form reads is current)
    const copy = main.indexOf('settings.subscribe((s, changed) => {'), firstMount = main.indexOf('mountSettingsForm($(');
    expect(copy).toBeGreaterThan(0);
    expect(firstMount).toBeGreaterThan(copy);
    expect(main.slice(copy, copy + 200)).toMatch(/copySettingsInto\(game\.settings, s\)/);
  });

  it('?lighting=off|auto|on and ?reflections=off|standard|high: validated by the contract, session overrides, before the first copy into the game', () => {
    expect(main).toMatch(/const urlLighting = params\.get\('lighting'\), urlReflections = params\.get\('reflections'\);/);
    expect(main).toMatch(/if \(isEnhancedLightingMode\(urlLighting\)\) settings\.sessionOverride\(\{enhancedLighting: urlLighting\}\);/);
    expect(main).toMatch(/if \(isReflectionQuality\(urlReflections\)\) settings\.sessionOverride\(\{reflections: urlReflections\}\);/);
    expect(main.indexOf('settings.sessionOverride({reflections: urlReflections})')).toBeLessThan(main.indexOf('copySettingsInto(game.settings, settings.get());'));
    expect(main.indexOf('settings.sessionOverride({enhancedLighting: urlLighting})')).toBeGreaterThan(main.indexOf("settings.sessionOverride({quality: 'low'})"));
    expect(main).not.toMatch(/settings\.set\(\{(enhancedLighting|reflections)/); // the URL never persists a choice
    // the same two lines against a real store: valid values apply for the session, anything else is ignored, nothing is written
    const run = (query: string) => {
      const mem = new MemStorage(), settings = new SettingsStore(mem), params = new URLSearchParams(query);
      const urlLighting = params.get('lighting'), urlReflections = params.get('reflections');
      if (isEnhancedLightingMode(urlLighting)) settings.sessionOverride({enhancedLighting: urlLighting});
      if (isReflectionQuality(urlReflections)) settings.sessionOverride({reflections: urlReflections});
      return {got: [settings.get().enhancedLighting, settings.get().reflections], stored: [settings.stored().enhancedLighting, settings.stored().reflections], writes: mem.writes};
    };
    expect(run('?lighting=off').got).toEqual(['off', 'standard']);
    expect(run('?qa=1&lighting=on&reflections=high').got).toEqual(['on', 'high']);
    expect(run('?reflections=off').got).toEqual(['auto', 'off']);
    expect(run('?lighting=auto&reflections=standard').got).toEqual(['auto', 'standard']);
    for (const q of ['', '?lighting=', '?lighting=1', '?lighting=ON', '?lighting=standard', '?reflections=on', '?reflections=auto', '?reflections=ultra', '?light=off']) expect(run(q).got, q).toEqual(['auto', 'standard']);
    for (const q of ['?lighting=off&reflections=high', '?lighting=bogus']) expect([run(q).stored, run(q).writes], q).toEqual([['auto', 'standard'], 0]);
  });

  it('a change of either setting re-applies nothing: no applySettings, no resize, no re-warm (the game reads them when a station is built)', () => {
    const at = main.indexOf('settings.subscribe((s, changed) => {');
    const handler = main.slice(at, main.indexOf('game.onSettingsChanged', at));
    expect(handler).toMatch(/if \(qualityChanged\) void game\.rewarmAfterSettings\(\);/);
    expect(handler).not.toMatch(/enhancedLighting|reflections|lighting/i);
    expect(main).not.toMatch(/changed\.(includes|some)\([^)]*(enhancedLighting|reflections)/);
    // what the handler does for them, replayed: only the copy (the two keys match none of its branches)
    const applied: string[] = [];
    const store = new SettingsStore(new MemStorage());
    const game = {settings: {...SETTINGS_DEFAULTS}};
    store.subscribe((s, changed) => {
      const {qualityChanged} = copySettingsInto(game.settings, s);
      if (changed.some(k => k === 'quality' || k === 'renderScale' || k === 'fov')) applied.push('applySettings');
      else if (changed.includes('ambientOcclusion')) applied.push('applySettings');
      else if (changed.some(k => k === 'volume' || k === 'muted')) applied.push('audio');
      if (qualityChanged) applied.push('rewarm');
    });
    store.set({enhancedLighting: 'on'});
    store.set({reflections: 'off'});
    store.set({enhancedLighting: 'off', reflections: 'high'});
    expect(applied).toEqual([]);
    expect(game.settings).toMatchObject({enhancedLighting: 'off', reflections: 'high'});
  });
});

// =============================================================================================
describe('diagnostics: the perf overlay\'s Lighting row, the recorder\'s environment value, the QA hooks', () => {
  function overlayHost(extra: Partial<PerfHost> = {}): PerfHost {
    return {
      state: 'playing', warming: false, frameCpu: {updateMs: 2, renderMs: 3, rendered: true}, gpu: null, settings: {quality: 'high'}, canvas: {width: 1280, height: 720},
      renderer: {initialized: true, getPixelRatio: () => 1, backend: {isWebGLBackend: true, disjoint: null, timestampQueryPool: {render: {timestamps: new Map<string, number>()}}},
        info: {frame: 0, render: {drawCalls: 4, frameCalls: 2, triangles: 300, points: 0, lines: 0}, memory: {total: 0, textures: 1, geometries: 1, programs: 1}}},
      ...extra,
    };
  }

  it('the Lighting row shows the contract\'s status line of the live station and follows it; a host without the runtime has no such row', () => {
    patchMiniDom();
    const dom = installMiniDom();
    try {
      let st = status({}, null);
      const o = new PerfOverlay(overlayHost({enhancedLighting: {status: () => st}}), dom.doc as unknown as Document);
      o.show();
      expect(o.failed).toBe(null);
      expect(o.snapshot().text.light).toBe(enhancedLightingLine(st));
      expect(o.snapshot().text.light).toBe('auto (no station)');
      const labels = dom.doc.querySelectorAll('dt').map(e => e.textContent);
      expect(labels.slice(labels.indexOf('Output'))).toEqual(['Output', 'Lighting', 'State']);
      st = status({requested: {lighting: 'on', reflections: 'high'}, pending: true}, {cache: 'miss'});
      o.frame(1000, 5);
      expect(o.snapshot().text.light).toBe(enhancedLightingLine(st));
      expect(o.snapshot().text.light).toBe('on: bake standard · refl standard ×42 · cache miss · change pending');
      expect(o.snapshot().text.output).toBe('1280×720 · DPR 1.00 · quality high');
      o.hide();
    } finally { dom.uninstall(); }
    const dom2 = installMiniDom();
    try {
      const bare = new PerfOverlay(overlayHost(), dom2.doc as unknown as Document);
      bare.show();
      expect(bare.failed).toBe(null);
      expect(Object.keys(bare.snapshot().text)).not.toContain('light');
      expect(dom2.doc.querySelectorAll('dt').map(e => e.textContent)).not.toContain('Lighting');
      expect(bare.snapshot().text.state).toBe('playing');
      bare.hide();
    } finally { dom2.uninstall(); }
    const dom3 = installMiniDom();
    try {
      const broken = new PerfOverlay(overlayHost({enhancedLighting: {status: () => { throw new Error('x'); }}}), dom3.doc as unknown as Document);
      broken.show();
      expect([broken.failed, broken.visible, broken.snapshot().text.light]).toEqual([null, true, 'n/a — status unavailable']);
      broken.hide();
    } finally { dom3.uninstall(); }
  });

  it('the overlay reads the status only while shown (hidden: one sample per frame, nothing else)', () => {
    patchMiniDom();
    const dom = installMiniDom();
    try {
      let reads = 0;
      const o = new PerfOverlay(overlayHost({enhancedLighting: {status: () => { reads++; return status(); }}}), dom.doc as unknown as Document);
      for (let k = 0; k < 120; k++) o.frame(k * 16, 4);
      expect(reads).toBe(0);
      o.show();
      expect(reads).toBe(1);
      o.hide();
      for (let k = 0; k < 120; k++) o.frame(4000 + k * 16, 4);
      expect(reads).toBe(1);
    } finally { dom.uninstall(); }
  });

  it('the recorder\'s environment value: the status as plain copies + its one-line summary; null without a runtime; additive (schemaMinor unchanged)', () => {
    expect(lightingEnvironment(null)).toBe(null);
    expect(lightingEnvironment(undefined)).toBe(null);
    expect(lightingEnvironment({status: () => { throw new Error('x'); }})).toBe(null);
    const st = status({requested: {lighting: 'on', reflections: 'high'}, pending: true}, {cache: 'stale', giMs: 512.5, probeMs: 220});
    const env = lightingEnvironment({status: () => st})!;
    expect(env).toEqual({line: enhancedLightingLine(st), requested: {lighting: 'on', reflections: 'high'}, active: {...ACTIVE, cache: 'stale', giMs: 512.5, probeMs: 220}, pending: true, cacheBackend: 'indexeddb'});
    expect(env.requested).not.toBe(st.requested);
    expect(env.active).not.toBe(st.active);
    expect(JSON.parse(JSON.stringify(env))).toEqual(env); // plain data
    expect(lightingEnvironment({status: () => status({}, null)})).toMatchObject({line: 'auto (no station)', active: null, pending: false});
    expect(PERF_SCHEMA_MINOR).toBe(5);
    const hooks = SRC('src/debug/perfRecorderHooks.ts');
    expect(hooks).toMatch(/enhancedLighting: lightingEnvironment\(x\.enhancedLighting\),/);
    expect(hooks).toMatch(/enhancedLighting\?: \{status\(\): EnhancedLightingStatus\} \| null;/); // an optional extra: a game without it still records
  });

  it('QA: snapshot().enhancedLighting is the status; __LL.lighting() adds the derived cache\'s numbers', () => {
    const qa = SRC('src/qa.ts');
    expect(qa).toMatch(/\n {8}enhancedLighting: game\.enhancedLighting\.status\(\),/);
    expect(qa).toMatch(/\n {4}lighting: async \(\) => \{\s*const status = game\.enhancedLighting\.status\(\);\s*return \{status, line: enhancedLightingLine\(status\), cache: await game\.enhancedLighting\.cacheStats\(\)\};\s*\},/);
    expect(qa.match(/\n {4}lighting: /g)).toHaveLength(1);
  });
});
