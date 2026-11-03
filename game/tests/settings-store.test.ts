// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane MENU): the persisted settings store (ui/settingsStore.ts) —
// persistence across a "reload" (a new store on the same storage), invalid-storage fallbacks, session overrides that are never
// persisted, the render-resolution composition with the existing DPR cap / Quality (never a quality preset), volume mapping.
import {describe, expect, it} from 'vitest';
import {STORAGE_KEYS} from '../src/campaign/types';
import {
  RENDER_SCALES, SETTINGS_DEFAULTS, SettingsStore, copySettingsInto, drawingBufferSize, masterGain, nativePixelRatio, nativeRatioLabel, parseStoredSettings,
  renderPixelRatio, renderScaleReadout, sanitizeSettings, serializeSettings, volumeFromPercent, volumePercent,
  type SettingsStorage,
} from '../src/ui/settingsStore';

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.writes++; this.map.set(k, v); }
}
class BrokenStorage implements SettingsStorage {
  getItem(): string | null { throw new Error('SecurityError'); }
  setItem(): void { throw new Error('QuotaExceededError'); }
}

describe('settings store: persistence', () => {
  it('uses STORAGE_KEYS.settings, separate from the save slots', () => {
    const s = new SettingsStore(new MemStorage());
    expect(s.key).toBe(STORAGE_KEYS.settings);
    for (let n = 0; n < 3; n++) expect(s.key).not.toBe(STORAGE_KEYS.slot(n));
    expect(s.key).not.toBe(STORAGE_KEYS.lastSlot);
  });

  it('starts at the defaults with nothing stored and writes nothing until a change', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    expect(s.get()).toEqual(SETTINGS_DEFAULTS);
    expect(s.loadReport.source).toBe('defaults');
    expect(mem.writes).toBe(0);
  });

  it('every setting survives a reload (a new store over the same storage)', () => {
    const mem = new MemStorage();
    const a = new SettingsStore(mem);
    a.set({sens: 1.85, fov: 92, volume: 0.35, muted: true, invertY: true, quality: 'low', renderScale: 0.25});
    const b = new SettingsStore(mem);
    expect(b.get()).toEqual({sens: 1.85, fov: 92, volume: 0.35, muted: true, invertY: true, quality: 'low', renderScale: 0.25, trainSway: 1});
    expect(b.loadReport.source).toBe('stored');
    expect(JSON.parse(mem.map.get(STORAGE_KEYS.settings)!).v).toBe(1);
  });

  it('notifies listeners with exactly the changed keys (no event for a no-op)', () => {
    const s = new SettingsStore(new MemStorage());
    const seen: string[][] = [];
    const off = s.subscribe((_, changed) => seen.push([...changed]));
    s.set({fov: 90});
    s.set({fov: 90});
    s.set({muted: true, renderScale: 0.5});
    off();
    s.set({fov: 70});
    expect(seen).toEqual([['fov'], ['muted', 'renderScale']]);
  });

  it('a session override (?quality=low) applies but is never persisted; an explicit change persists and drops it', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    s.set({quality: 'high', fov: 80});
    s.sessionOverride({quality: 'low'});
    expect(s.get().quality).toBe('low');
    expect(s.stored().quality).toBe('high');
    s.set({fov: 85}); // another key: the override stays
    expect(s.get().quality).toBe('low');
    expect(new SettingsStore(mem).get()).toMatchObject({quality: 'high', fov: 85});
    s.set({quality: 'low'}); // chosen explicitly: now persisted
    expect(new SettingsStore(mem).get().quality).toBe('low');
    s.set({quality: 'high'});
    expect(s.get().quality).toBe('high'); // the override is gone
  });

  it('reload() picks up another tab\'s write', () => {
    const mem = new MemStorage();
    const a = new SettingsStore(mem), b = new SettingsStore(mem);
    const seen: string[][] = [];
    b.subscribe((_, c) => seen.push([...c]));
    a.set({volume: 0.2});
    b.reload();
    expect(b.get().volume).toBe(0.2);
    expect(seen).toEqual([['volume']]);
  });
});

describe('settings store: invalid storage falls back sanely', () => {
  it('invalid JSON / non-objects = all defaults', () => {
    for (const bad of ['{', 'null', '42', '"x"', '[1,2]']) {
      const r = parseStoredSettings(bad);
      expect(r.settings, bad).toEqual(SETTINGS_DEFAULTS);
      expect(r.source, bad).toBe('invalid');
    }
  });

  it('field by field: wrong types / NaN / unknown enums fall back, out-of-range numbers clamp, the rest is kept', () => {
    const mem = new MemStorage();
    // (task studio-beta-campaign-polish-20261103-063841-01, lane MENU: render scale is a 25-100 % slider now — 0.333 rounds to 33 %)
    mem.setItem(STORAGE_KEYS.settings, JSON.stringify({v: 1, sens: 'fast', fov: 500, volume: -3, muted: 'yes', invertY: true, quality: 'ultra', renderScale: 0.333}));
    const s = new SettingsStore(mem);
    expect(s.get()).toEqual({sens: SETTINGS_DEFAULTS.sens, fov: 100, volume: 0, muted: false, invertY: true, quality: 'high', renderScale: 0.33, trainSway: 1});
    expect(s.loadReport.source).toBe('invalid');
    expect([...s.loadReport.fixed].sort()).toEqual(['fov', 'muted', 'quality', 'renderScale', 'sens', 'volume']);
    // NaN / Infinity never survive (JSON has none, but a patch could carry them)
    expect(sanitizeSettings({fov: Number.NaN, sens: Infinity}).settings).toMatchObject({fov: 75, sens: 1});
  });

  it('an older / partial record keeps what it has and defaults the rest (missing = not "fixed")', () => {
    const r = parseStoredSettings(JSON.stringify({sens: 2, fov: 66, volume: 0.5, muted: true, invertY: false, quality: 'low'}));
    expect(r.settings).toEqual({sens: 2, fov: 66, volume: 0.5, muted: true, invertY: false, quality: 'low', renderScale: 1, trainSway: 1});
    expect(r.source).toBe('stored');
  });

  it('a patch is validated too (the UI can never store an invalid value)', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    s.set({fov: 12, renderScale: 3 as never, quality: 'x' as never});
    expect(s.get()).toMatchObject({fov: 60, renderScale: 1, quality: 'high'});
    expect(parseStoredSettings(mem.map.get(STORAGE_KEYS.settings)!).source).toBe('stored');
  });

  it('train sway (the moving car\'s jostle on the view): 0..1, clamped, 0 = off survives a reload, copied into the game', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    s.set({trainSway: 7});
    expect(s.get().trainSway).toBe(1);
    s.set({trainSway: -2});
    expect(s.get().trainSway).toBe(0);
    expect(new SettingsStore(mem).get().trainSway).toBe(0);
    expect(parseStoredSettings(JSON.stringify({trainSway: 'x'})).fixed).toEqual(['trainSway']);
    const target = {...SETTINGS_DEFAULTS};
    copySettingsInto(target, {...SETTINGS_DEFAULTS, trainSway: 0.35});
    expect(target.trainSway).toBe(0.35);
  });

  it('storage that throws: defaults, the settings still apply for the session, persistent = false, never throws', () => {
    const s = new SettingsStore(new BrokenStorage());
    expect(s.loadReport.source).toBe('unavailable');
    expect(() => s.set({fov: 88})).not.toThrow();
    expect(s.get().fov).toBe(88);
    expect(s.persistent).toBe(false);
    const none = new SettingsStore(null);
    none.set({volume: 0.1});
    expect(none.get().volume).toBe(0.1);
    expect(none.persistent).toBe(false);
  });

  it('serialize -> parse is the identity for every valid combination of the enums', () => {
    for (const q of ['low', 'high'] as const) for (const r of RENDER_SCALES) {
      const v = {...SETTINGS_DEFAULTS, quality: q, renderScale: r, sens: 0.45, fov: 99, volume: 0.07};
      expect(parseStoredSettings(serializeSettings(v)).settings).toEqual(v);
    }
  });
});

describe('render resolution: a linear scale over the existing DPR cap, composed with Quality (never a preset)', () => {
  it('native = the game.ts resize() design: min(dpr, 1.5) on High; min(dpr, 1, 0.85) on Low', () => {
    expect(nativePixelRatio(1, 'high')).toBe(1);
    expect(nativePixelRatio(1.25, 'high')).toBe(1.25);
    expect(nativePixelRatio(2, 'high')).toBe(1.5);
    expect(nativePixelRatio(3, 'high')).toBe(1.5);
    expect(nativePixelRatio(1, 'low')).toBe(0.85);
    expect(nativePixelRatio(2, 'low')).toBe(0.85);
    expect(nativePixelRatio(0.5, 'low')).toBe(0.5);
    expect(nativePixelRatio(Number.NaN, 'high')).toBe(1);
  });

  it('pixel ratio = native x scale, for every DPR / quality / scale (Quality never overrides the scale)', () => {
    for (const dpr of [0.75, 1, 1.25, 1.5, 2, 3]) for (const q of ['low', 'high'] as const) for (const s of RENDER_SCALES) {
      expect(renderPixelRatio(dpr, q, s)).toBeCloseTo(nativePixelRatio(dpr, q) * s, 10);
    }
    // the scale is linear in width AND height: half = a quarter of the pixels
    const nat = drawingBufferSize(1920, 1080, 1, 'high', 1), half = drawingBufferSize(1920, 1080, 1, 'high', 0.5), q = drawingBufferSize(1920, 1080, 1, 'high', 0.25);
    expect(nat).toEqual({w: 1920, h: 1080});
    expect(half).toEqual({w: 960, h: 540});
    expect(q).toEqual({w: 480, h: 270});
    expect(drawingBufferSize(1920, 1080, 2, 'high', 0.5)).toEqual({w: 1440, h: 810}); // 1.5 cap x 0.5
  });

  it('the native label says when the cap applies (what 100 % means)', () => {
    expect(nativeRatioLabel(2, 'high')).toBe('1.5×, DPR-capped');
    expect(nativeRatioLabel(1, 'high')).toBe('1×');
    expect(nativeRatioLabel(1, 'low')).toBe('0.85×, Low quality cap');
    expect(renderScaleReadout(1920, 1080, 1, 'high', 0.5)).toBe('Renders 960 × 540 (native 1920 × 1080)');
    expect(renderScaleReadout(1920, 1080, 1, 'high', 1)).toBe('Renders 1920 × 1080 (native)');
  });

  it('render scale is not a quality preset: changing it leaves quality (and everything else) untouched', () => {
    const s = new SettingsStore(new MemStorage());
    s.set({quality: 'high'});
    s.set({renderScale: 0.25});
    expect(s.get()).toEqual({...SETTINGS_DEFAULTS, quality: 'high', renderScale: 0.25});
    s.set({quality: 'low'});
    expect(s.get().renderScale).toBe(0.25);
  });

  it('copySettingsInto fills the game\'s Settings object and reports a quality change', () => {
    const target = {sens: 1, fov: 75, volume: 0.7, muted: false, invertY: false, quality: 'high' as const, renderScale: 1 as const, trainSway: 1} as {sens: number; fov: number; volume: number; muted: boolean; invertY: boolean; quality: 'low' | 'high'; renderScale: 1 | 0.5 | 0.25; trainSway: number};
    expect(copySettingsInto(target, {...SETTINGS_DEFAULTS, fov: 90, renderScale: 0.5}).qualityChanged).toBe(false);
    expect(target).toMatchObject({fov: 90, renderScale: 0.5});
    expect(copySettingsInto(target, {...SETTINGS_DEFAULTS, quality: 'low'}).qualityChanged).toBe(true);
  });
});

describe('master volume mapping', () => {
  it('0-100 % <-> Sfx.setVolume 0..1, whole percent steps, clamped', () => {
    expect(volumePercent(0.7)).toBe(70);
    expect(volumeFromPercent(70)).toBe(0.7);
    expect(volumeFromPercent(0)).toBe(0);
    expect(volumeFromPercent(100)).toBe(1);
    expect(volumeFromPercent(140)).toBe(1);
    expect(volumeFromPercent(-5)).toBe(0);
    expect(volumeFromPercent(33.4)).toBe(0.33);
    for (let p = 0; p <= 100; p++) expect(volumePercent(volumeFromPercent(p))).toBe(p);
  });

  it('mute is respected (gain 0), else the volume', () => {
    expect(masterGain({volume: 0.6, muted: true})).toBe(0);
    expect(masterGain({volume: 0.6, muted: false})).toBe(0.6);
  });
});
