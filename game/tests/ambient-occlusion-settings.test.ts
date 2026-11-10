// Task studio-perf-ao-train-continuity-20261110-022206-01 (lane AO; user: "add AO"): the Ambient occlusion SETTING.
//  1. the store (ui/settingsStore.ts): default on; a record from before the setting existed reads it as on (not "fixed"); a non-boolean
//     falls back to on (fixed); a change persists across a reload, notifies exactly that key, is copied into the game's Settings;
//     never part of a save slot;
//  2. the settings form (ui/mainMenu.ts, menu AND pause menu): an "Ambient occlusion" On / Off choice next to Quality / Render
//     resolution, bound both ways; its help line says what AO does — or, where the atmosphere pass cannot run, that it is unavailable;
//  3. the plumbing: main.ts re-applies through game.applySettings (which sets the atmosphere's AO gate) and hands both forms the
//     atmosphere's honest availability; ?ao=off|on is a session override (QA) that wins over the setting;
//  4. VolumetricAtmosphere.aoUnavailable / debug().ao.reason on the capability cases (no renderer, fog off, unsupported backend).
import {describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import {MiniEl, MiniEvent, MiniText, installMiniDom} from './helpers/paperMapDom';
import {mountSettingsForm} from '../src/ui/mainMenu';
import {
  AO_LABEL, SETTINGS_DEFAULTS, SETTINGS_KEYS, SettingsStore, aoDescription, copySettingsInto, parseStoredSettings, sanitizeSettings, serializeSettings,
  type SettingsStorage,
} from '../src/ui/settingsStore';
import {STORAGE_KEYS} from '../src/campaign/types';
import {ATMOSPHERE_QUALITY} from '../src/render/atmosphere';
import {aoOverrideFromUrl} from '../src/render/ambientOcclusion';
import {VolumetricAtmosphere} from '../src/render/volumetric';
import {generateStation} from '../src/gen/station';

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

describe('the store: ambientOcclusion, default on, persisted in the browser settings record only', () => {
  it('defaults on; an older record (and a missing record) reads on without being "fixed"; a non-boolean falls back to on', () => {
    expect(SETTINGS_DEFAULTS.ambientOcclusion).toBe(true);
    expect(SETTINGS_KEYS).toContain('ambientOcclusion');
    const old = parseStoredSettings(JSON.stringify({v: 1, sens: 1.4, fov: 80, volume: 0.5, muted: false, invertX: false, invertY: true, quality: 'high', renderScale: 1, trainSway: 1}));
    expect(old.settings).toMatchObject({ambientOcclusion: true, sens: 1.4, invertY: true});
    expect([old.source, old.fixed]).toEqual(['stored', []]);
    expect(parseStoredSettings(null).settings.ambientOcclusion).toBe(true);
    for (const bad of ['no', 0, 1, null, {}, [false]]) {
      const r = sanitizeSettings({...SETTINGS_DEFAULTS, ambientOcclusion: bad, fov: 90});
      expect(r.settings).toMatchObject({ambientOcclusion: true, fov: 90});
      expect(r.fixed).toEqual(['ambientOcclusion']);
    }
  });

  it('off survives a reload; only that key changes (no quality / resolution change); copied into the game\'s Settings', () => {
    const mem = new MemStorage();
    const a = new SettingsStore(mem);
    a.set({quality: 'low', renderScale: 0.5});
    const changes: string[][] = [];
    a.subscribe((_, ch) => changes.push([...ch]));
    a.set({ambientOcclusion: false});
    expect(changes).toEqual([['ambientOcclusion']]);
    expect(JSON.parse(mem.getItem(STORAGE_KEYS.settings)!)).toMatchObject({ambientOcclusion: false, quality: 'low'});
    const b = new SettingsStore(mem);
    expect(b.get()).toMatchObject({ambientOcclusion: false, quality: 'low', renderScale: 0.5});
    expect(serializeSettings(b.stored())).toMatch(/"ambientOcclusion":false/);
    const target = {sens: 1, fov: 75, volume: 0.7, muted: false, invertX: false, invertY: false, quality: 'low' as 'low' | 'high', renderScale: 0.5, trainSway: 1, ambientOcclusion: true};
    expect(copySettingsInto(target, b.get()).qualityChanged).toBe(false);
    expect(target.ambientOcclusion).toBe(false);
  });

  it('not save content: the save serializer / validator never mention it', () => {
    for (const f of ['src/save/serialize.ts', 'src/save/validate.ts', 'src/save/slots.ts']) {
      let text = '';
      try { text = SRC(f); } catch { continue; }
      expect(text, f).not.toMatch(/ambientOcclusion/);
    }
  });
});

/** The bits of the DOM the settings form uses that the shared mini DOM leaves out (patched for this file only). */
function patchMiniDom(): void {
  const P = MiniEl.prototype as unknown as Record<string, unknown>;
  const node = (n: unknown) => (typeof n === 'string' ? new MiniText(n) : n) as MiniEl | MiniText;
  P.append = function (this: MiniEl, ...ns: unknown[]) { for (const n of ns) this.appendChild(node(n)); };
  P.replaceChildren = function (this: MiniEl, ...ns: unknown[]) { for (const c of this.children) c.parent = null; this.children = []; (this as unknown as {append(...x: unknown[]): void}).append(...ns); };
  Object.defineProperty(P, 'htmlFor', {configurable: true, get() { return {add() {}}; }});
  Object.defineProperty(P, 'ownerDocument', {configurable: true, get(this: MiniEl) { return this.doc; }});
}

function mountForm(o: {store?: SettingsStore; unavailable?: () => string | null} = {}) {
  patchMiniDom();
  const dom = installMiniDom(1920, 1080);
  dom.doc.body.innerHTML = '<div id="box"></div>';
  const box = dom.doc.querySelector('#box')!;
  const store = o.store ?? new SettingsStore(new MemStorage());
  const off = mountSettingsForm(box as unknown as HTMLElement, store, {idPrefix: 'mm-set-', viewport: () => ({w: 1920, h: 1080, dpr: 1}), qualityPresets: ATMOSPHERE_QUALITY, aoUnavailable: o.unavailable});
  return {dom, box, store, off};
}

describe('the settings form: "Ambient occlusion" On / Off next to Quality / Render resolution', () => {
  it('label, the two choices, bound both ways; the help line says what it does', () => {
    const m = mountForm();
    try {
      const sel = m.box.querySelector('#mm-set-ao')! as unknown as MiniEl & {value: string};
      expect(sel).not.toBe(null);
      expect(sel.parentElement!.textContent).toContain(AO_LABEL);
      expect(sel.querySelectorAll('option').map(op => op.textContent)).toEqual(['On', 'Off']);
      expect(sel.value).toBe('on');
      const help = m.box.querySelector('#mm-set-ao-help')!;
      expect(sel.getAttribute('aria-describedby')).toBe('mm-set-ao-help');
      expect(help.textContent).toBe(aoDescription(true, null));
      expect(help.textContent).toMatch(/contact shadows/i);
      // the graphics part: after Quality and Render resolution
      const ids = m.box.querySelectorAll('select, input').map(e => e.id);
      expect(ids.indexOf('mm-set-ao')).toBeGreaterThan(ids.indexOf('mm-set-quality'));
      expect(ids.indexOf('mm-set-ao')).toBeGreaterThan(ids.indexOf('mm-set-res'));
      sel.value = 'off';
      sel.dispatchEvent(new MiniEvent('change'));
      expect(m.store.get().ambientOcclusion).toBe(false);
      expect(help.textContent).toBe(aoDescription(false, null));
      m.store.set({ambientOcclusion: true}); // another form (the pause menu) changed it
      expect(sel.value).toBe('on');
      m.off();
    } finally { m.dom.uninstall(); }
  });

  it('where the atmosphere pass cannot run, the help line says AO is unavailable (and why) instead of pretending', () => {
    let why: string | null = 'needs the volumetric fog pass (off)';
    const m = mountForm({unavailable: () => why});
    try {
      const help = m.box.querySelector('#mm-set-ao-help')!;
      expect(help.textContent).toBe('Unavailable here: needs the volumetric fog pass (off)');
      why = null;
      m.store.set({ambientOcclusion: false});
      expect(help.textContent).toBe(aoDescription(false, null));
      m.off();
    } finally { m.dom.uninstall(); }
  });
});

describe('the plumbing: main.ts -> game.applySettings -> the atmosphere; ?ao= override; availability', () => {
  it('main.ts re-applies an AO change through game.applySettings and gives both forms the atmosphere\'s availability; game.ts sets the gate', () => {
    const main = SRC('src/main.ts'), game = SRC('src/game.ts');
    expect(main).toMatch(/else if \(changed\.includes\('ambientOcclusion'\)\) game\.applySettings\(\);/);
    expect(main).toMatch(/const aoUnavailable = \(\) => game\.atmosphere\.aoUnavailable\(\);/);
    expect(main.match(/qualityPresets: ATMOSPHERE_QUALITY, aoUnavailable\}/g)).toHaveLength(2); // the pause menu's and the main menu's form
    const apply = game.slice(game.indexOf('  applySettings(): void {'), game.indexOf('  applySettings(): void {') + 900);
    expect(apply).toMatch(/this\.atmosphere\.setAmbientOcclusion\(this\.settings\.ambientOcclusion\);/);
    expect(game).toMatch(/readonly settings: Settings = \{[^}]*ambientOcclusion: true\}/);
    // an AO change never triggers the quality re-warm (no existing program is rebuilt)
    expect(main).toMatch(/if \(qualityChanged\) void game\.rewarmAfterSettings\(\);/);
  });

  it('?ao=off|on wins over the setting for the session; anything else is no override', () => {
    expect(aoOverrideFromUrl('?ao=off')).toBe(false);
    expect(aoOverrideFromUrl('?qa=1&ao=on')).toBe(true);
    expect(aoOverrideFromUrl('?ao=1')).toBe(null);
    expect(aoOverrideFromUrl('')).toBe(null);
    const a = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
    a.occlusion.override = false;
    a.setAmbientOcclusion(true);
    expect(a.occlusion.wanted).toBe(false);
    expect(a.debug().ao).toMatchObject({setting: true, override: false, active: false, reason: 'off (?ao=off)'});
    a.occlusion.override = true;
    a.setAmbientOcclusion(false);
    expect(a.occlusion.wanted).toBe(true);
    a.dispose();
  });

  it('aoUnavailable: honest per capability (no renderer, fog quality off, no float colour targets); a supported pass says null', () => {
    const fake = (floatRT: boolean) => ({
      initialized: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, toneMappingExposure: 1, xr: {enabled: false},
      debug: {onShaderError: null}, shadowMap: {enabled: true, type: THREE.PCFShadowMap},
      backend: {isWebGLBackend: true, extensions: {has: (nm: string) => floatRT && nm === 'EXT_color_buffer_float'}},
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280, 720), setRenderTarget: () => {}, render: () => {},
    });
    const none = new VolumetricAtmosphere(null, {flashlight: new THREE.SpotLight()}, 'high');
    expect(none.aoUnavailable()).toBe('needs the renderer');
    const ok = new VolumetricAtmosphere(fake(true) as never, {flashlight: new THREE.SpotLight()}, 'high');
    ok.override = null;
    ok.setQuality('high');
    expect(ok.aoUnavailable()).toBe(null);
    expect(ok.debug().ao.reason, 'before a station').toBe('no station yet');
    ok.setStation(generateStation(5), null);
    expect(ok.debug().ao.reason).toBe(null); // the pass would run on the next frame
    ok.setQuality('off');
    expect(ok.aoUnavailable()).toBe('needs the volumetric fog pass (off)');
    expect(ok.debug().ao.reason).toBe('atmosphere quality off');
    const unsupported = new VolumetricAtmosphere(fake(false) as never, {flashlight: new THREE.SpotLight()}, 'high');
    expect(unsupported.aoUnavailable()).toBe('needs the volumetric fog pass (not available here)');
    for (const a of [none, ok, unsupported]) a.dispose();
  });
});
