// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane MENU): the player's SETTINGS, persisted locally (this browser +
// origin) under STORAGE_KEYS.settings — separate from the save slots — and the ONE source of truth for the main menu's Settings
// panel, the pause menu's settings and the game (Game.settings is a copy the store keeps in step: main.ts applyToGame).
//
//  - Validation: whatever is stored (another build, a hand edit, a corrupt value) is read field by field; a missing / wrong-typed /
//    non-finite field falls back to its default, an out-of-range number is clamped into its bounds, an unknown render scale or
//    quality falls back. Invalid JSON = all defaults. Storage that throws (private mode, quota, disabled) = the settings still
//    apply for this session (`persistent` false; the UI says so).
//  - Session overrides (?quality=low for slow software renderers) apply on top WITHOUT being persisted; changing that setting
//    explicitly persists the new choice and drops the override.
//  - Render resolution: Native / Half / Quarter = a LINEAR scale (1 / 0.5 / 0.25) of the drawing buffer's width AND height,
//    relative to the native buffer of the EXISTING DPR cap design (game.ts resize(): min(devicePixelRatio, 1.5) on High;
//    min(devicePixelRatio, 1, 0.85) on Low). It is not a quality preset: no geometry / light / fog / detail change. Quality keeps
//    only its own documented effects (that DPR cap, render/atmosphere.ts ATMOSPHERE_QUALITY: fog march scale / steps / shadow
//    map / MSAA) and never overrides the scale: pixel ratio = nativePixelRatio(dpr, quality) x renderScale.
//  - Master volume 0..1 (shown as 0-100 %) is what Sfx.setVolume takes; mute is separate and respected (Sfx.setMuted).

import {STORAGE_KEYS} from '../campaign/types';

export type Quality = 'low' | 'high';
/** Linear render-resolution scale of width and height (1 = native, 0.5 = half, 0.25 = quarter). */
export type RenderScale = 1 | 0.5 | 0.25;
export const RENDER_SCALES: readonly RenderScale[] = [1, 0.5, 0.25];

export interface GameSettings {
  /** Mouse sensitivity multiplier. */
  sens: number;
  /** Vertical field of view (degrees). */
  fov: number;
  /** Master volume 0..1 (Sfx.setVolume; shown as a percentage). */
  volume: number;
  muted: boolean;
  invertY: boolean;
  quality: Quality;
  renderScale: RenderScale;
}

/** The game's historical defaults (game.ts Settings) + native resolution. */
export const SETTINGS_DEFAULTS: Readonly<GameSettings> = Object.freeze({sens: 1, fov: 75, volume: 0.7, muted: false, invertY: false, quality: 'high', renderScale: 1});

/** The existing UI bounds (index.html ranges): sensitivity 0.2-3, FOV 60-100 degrees, volume 0-100 %. */
export const SETTINGS_BOUNDS = {
  sens: {min: 0.2, max: 3, step: 0.05},
  fov: {min: 60, max: 100, step: 1},
  volume: {min: 0, max: 1, step: 0.01},
} as const;

/** Stored record version (a future incompatible layout bumps it; unknown versions are read field by field all the same). */
export const SETTINGS_VERSION = 1;

export type SettingsKey = keyof GameSettings;
export const SETTINGS_KEYS: readonly SettingsKey[] = ['sens', 'fov', 'volume', 'muted', 'invertY', 'quality', 'renderScale'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One field, validated: the value to use and whether it had to be fixed (missing fields are not "fixed", just defaulted). */
function field<K extends SettingsKey>(k: K, raw: unknown): {value: GameSettings[K]; fixed: boolean} {
  const d = SETTINGS_DEFAULTS[k];
  if (raw === undefined) return {value: d, fixed: false};
  switch (k) {
    case 'sens': case 'fov': case 'volume': {
      const n = num(raw);
      if (n === null) return {value: d, fixed: true};
      const b = SETTINGS_BOUNDS[k as 'sens' | 'fov' | 'volume'];
      const c = clamp(n, b.min, b.max);
      return {value: c as GameSettings[K], fixed: c !== n};
    }
    case 'muted': case 'invertY':
      return typeof raw === 'boolean' ? {value: raw as GameSettings[K], fixed: false} : {value: d, fixed: true};
    case 'quality':
      return raw === 'low' || raw === 'high' ? {value: raw as GameSettings[K], fixed: false} : {value: d, fixed: true};
    case 'renderScale':
      return RENDER_SCALES.includes(raw as RenderScale) ? {value: raw as GameSettings[K], fixed: false} : {value: d, fixed: true};
  }
  return {value: d, fixed: true};
}

/** Validate any value (parsed storage, an import, a patch) into complete settings; `fixed` names the fields that fell back / were clamped. */
export function sanitizeSettings(raw: unknown): {settings: GameSettings; fixed: SettingsKey[]} {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out = {...SETTINGS_DEFAULTS} as GameSettings;
  const fixed: SettingsKey[] = [];
  for (const k of SETTINGS_KEYS) {
    const f = field(k, src[k]);
    (out as unknown as Record<string, unknown>)[k] = f.value;
    if (f.fixed) fixed.push(k);
  }
  return {settings: out, fixed};
}

/** Parse the stored string (null = nothing stored). */
export function parseStoredSettings(text: string | null): {settings: GameSettings; source: 'defaults' | 'stored' | 'invalid'; fixed: SettingsKey[]} {
  if (text === null) return {settings: {...SETTINGS_DEFAULTS}, source: 'defaults', fixed: []};
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return {settings: {...SETTINGS_DEFAULTS}, source: 'invalid', fixed: [...SETTINGS_KEYS]}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {settings: {...SETTINGS_DEFAULTS}, source: 'invalid', fixed: [...SETTINGS_KEYS]};
  const {settings, fixed} = sanitizeSettings(parsed);
  return {settings, source: fixed.length ? 'invalid' : 'stored', fixed};
}

/** The stored JSON (data only). */
export function serializeSettings(s: GameSettings): string {
  return JSON.stringify({v: SETTINGS_VERSION, ...s});
}

// ---------------------------------------------------------------------------------------------
// Render resolution (composition with the existing DPR cap and Quality)

/**
 * The NATIVE pixel ratio of the existing design (game.ts resize()): min(devicePixelRatio, 1.5) on High; on Low
 * min(devicePixelRatio, 1) further capped at 0.85 (Low's own documented resolution effect).
 */
export function nativePixelRatio(dpr: number, quality: Quality): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const capped = Math.min(d, quality === 'high' ? 1.5 : 1);
  return quality === 'high' ? capped : Math.min(capped, 0.85);
}

/** The renderer pixel ratio: native (DPR cap x Quality) x the linear render scale. */
export function renderPixelRatio(dpr: number, quality: Quality, scale: RenderScale): number {
  return nativePixelRatio(dpr, quality) * (RENDER_SCALES.includes(scale) ? scale : 1);
}

/** Drawing-buffer size (device pixels, rounded like three's setSize) for a CSS viewport. */
export function drawingBufferSize(cssW: number, cssH: number, dpr: number, quality: Quality, scale: RenderScale): {w: number; h: number} {
  const pr = renderPixelRatio(dpr, quality, scale);
  return {w: Math.max(1, Math.floor(cssW * pr)), h: Math.max(1, Math.floor(cssH * pr))};
}

const fmtRatio = (r: number) => `${Number(r.toFixed(2))}×`;

/** Option labels for the render-resolution select (the Native label says when the DPR / Low cap applies). */
export function renderScaleOptions(dpr: number, quality: Quality): {value: RenderScale; label: string}[] {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const nat = nativePixelRatio(d, quality);
  const native = nat < d - 1e-6
    ? (quality === 'low' ? `Native (capped ${fmtRatio(nat)} by Low quality)` : `Native (DPR-capped ${fmtRatio(nat)})`)
    : `Native (${fmtRatio(nat)})`;
  return [
    {value: 1, label: native},
    {value: 0.5, label: 'Half (½ width and height)'},
    {value: 0.25, label: 'Quarter (¼ width and height)'},
  ];
}

/** "Renders 960 × 540 (of 1920 × 1080 native)". */
export function renderScaleReadout(cssW: number, cssH: number, dpr: number, quality: Quality, scale: RenderScale): string {
  const cur = drawingBufferSize(cssW, cssH, dpr, quality, scale), nat = drawingBufferSize(cssW, cssH, dpr, quality, 1);
  return scale === 1 ? `Renders ${nat.w} × ${nat.h}` : `Renders ${cur.w} × ${cur.h} (native ${nat.w} × ${nat.h})`;
}

// ---------------------------------------------------------------------------------------------
// Volume

/** Volume 0..1 -> the percentage shown (0-100, whole numbers). */
export const volumePercent = (v: number): number => Math.round(clamp(num(v) ?? SETTINGS_DEFAULTS.volume, 0, 1) * 100);
/** A percentage (slider value) -> volume 0..1 (Sfx.setVolume). */
export const volumeFromPercent = (p: number): number => clamp(Math.round(num(p) ?? volumePercent(SETTINGS_DEFAULTS.volume)), 0, 100) / 100;
/** The master gain the audio graph ends up with (Sfx: muted -> 0, else the volume). */
export const masterGain = (s: Pick<GameSettings, 'volume' | 'muted'>): number => (s.muted ? 0 : clamp(s.volume, 0, 1));

// ---------------------------------------------------------------------------------------------
// The store

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SettingsListener = (settings: Readonly<GameSettings>, changed: readonly SettingsKey[]) => void;

export class SettingsStore {
  private saved: GameSettings;
  private override: Partial<GameSettings> = {};
  private readonly listeners: SettingsListener[] = [];
  /** How the stored value read at construction / the last reload (QA / tests; the UI shows a note when invalid). */
  loadReport: {source: 'defaults' | 'stored' | 'invalid' | 'unavailable'; fixed: SettingsKey[]};
  /** False once storage refused a read / write: the settings still apply, for this session only. */
  persistent = true;

  constructor(private readonly storage: SettingsStorage | null, readonly key: string = STORAGE_KEYS.settings) {
    const r = this.read();
    this.saved = r.settings;
    this.loadReport = {source: r.source, fixed: r.fixed};
  }

  private read(): {settings: GameSettings; source: 'defaults' | 'stored' | 'invalid' | 'unavailable'; fixed: SettingsKey[]} {
    if (!this.storage) { this.persistent = false; return {settings: {...SETTINGS_DEFAULTS}, source: 'unavailable', fixed: []}; }
    let text: string | null;
    try { text = this.storage.getItem(this.key); } catch { this.persistent = false; return {settings: {...SETTINGS_DEFAULTS}, source: 'unavailable', fixed: []}; }
    return parseStoredSettings(text);
  }

  /** The effective settings (stored + session overrides). */
  get(): Readonly<GameSettings> {
    return {...this.saved, ...this.override};
  }

  /** The persisted settings alone (no session overrides). */
  stored(): Readonly<GameSettings> {
    return {...this.saved};
  }

  /** Session-only values on top of the stored ones (never persisted), e.g. ?quality=low. */
  sessionOverride(patch: Partial<GameSettings>): void {
    const before = this.get();
    const {settings} = sanitizeSettings({...this.get(), ...patch});
    for (const k of Object.keys(patch) as SettingsKey[]) if (SETTINGS_KEYS.includes(k)) (this.override as Record<string, unknown>)[k] = settings[k];
    this.emit(before);
  }

  /** An explicit change: validated, persisted, overrides of these keys dropped, listeners told. Returns the effective settings. */
  set(patch: Partial<GameSettings>): Readonly<GameSettings> {
    const before = this.get();
    const keys = (Object.keys(patch) as SettingsKey[]).filter(k => SETTINGS_KEYS.includes(k));
    const {settings} = sanitizeSettings({...this.saved, ...patch});
    this.saved = settings;
    for (const k of keys) delete (this.override as Record<string, unknown>)[k];
    this.write();
    this.emit(before);
    return this.get();
  }

  /** Back to the defaults (persisted). */
  reset(): Readonly<GameSettings> {
    const before = this.get();
    this.saved = {...SETTINGS_DEFAULTS};
    this.override = {};
    this.write();
    this.emit(before);
    return this.get();
  }

  /** Re-read storage (another tab changed it: the window 'storage' event). */
  reload(): void {
    const before = this.get();
    const r = this.read();
    this.saved = r.settings;
    this.loadReport = {source: r.source, fixed: r.fixed};
    this.emit(before);
  }

  subscribe(fn: SettingsListener): () => void {
    this.listeners.push(fn);
    return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); };
  }

  private write(): void {
    if (!this.storage) { this.persistent = false; return; }
    try { this.storage.setItem(this.key, serializeSettings(this.saved)); this.persistent = true; } catch { this.persistent = false; }
  }

  private emit(before: Readonly<GameSettings>): void {
    const now = this.get();
    const changed = SETTINGS_KEYS.filter(k => before[k] !== now[k]);
    if (!changed.length) return;
    for (const fn of [...this.listeners]) { try { fn(now, changed); } catch (err) { console.warn('settings listener failed', err); } }
  }
}

/** localStorage when the browser allows it (null: none / access throws). */
export function browserSettingsStorage(): SettingsStorage | null {
  try {
    const s = (globalThis as {localStorage?: Storage}).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** Copy the effective settings into the game's Settings object (game.ts reads `game.settings.*`); true when render-affecting quality changed. */
export function copySettingsInto(target: {sens: number; fov: number; volume: number; muted: boolean; invertY: boolean; quality: Quality; renderScale: RenderScale}, s: Readonly<GameSettings>): {qualityChanged: boolean} {
  const qualityChanged = target.quality !== s.quality;
  target.sens = s.sens; target.fov = s.fov; target.volume = s.volume; target.muted = s.muted;
  target.invertY = s.invertY; target.quality = s.quality; target.renderScale = s.renderScale;
  return {qualityChanged};
}
