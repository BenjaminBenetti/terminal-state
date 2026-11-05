// Task studio-beta-mouse-axis-invert-20261105-005156-01 (user: "They want invert option on the X / Y axis of the mouse!"): separate
// "Invert mouse X" / "Invert mouse Y" settings, both off by default, applied to the player's mouse LOOK only (player/mouseLook.ts, used by
// both look paths in game.ts), after the unchanged sensitivity scaling; the pitch clamp and the yaw convention unchanged; persisted in
// the ordinary browser settings record (never a save slot); older records without invertX read false; malformed values fall back.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {LOOK_RAD_PER_COUNT, PITCH_LIMIT, applyMouseLook, lookSigns} from '../src/player/mouseLook';
import {SETTINGS_DEFAULTS, SETTINGS_KEYS, SettingsStore, copySettingsInto, parseStoredSettings, sanitizeSettings, serializeSettings, type SettingsStorage} from '../src/ui/settingsStore';
import {STORAGE_KEYS} from '../src/campaign/types';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

/** The former inline look code of game.ts (play path), verbatim, as the reference for "both off = unchanged". */
function formerLook(p: {yaw: number; pitch: number}, dx: number, dy: number, s: {sens: number; invertY: boolean}, aiming: boolean): void {
  const sens = s.sens * 0.0022 * (aiming ? 0.65 : 1);
  p.yaw -= dx * sens;
  p.pitch -= dy * sens * (s.invertY ? -1 : 1);
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
}

describe('mouse look: X and Y invert independently (all four combinations)', () => {
  const look = (invertX: boolean, invertY: boolean, dx: number, dy: number, sens = 1, scale = 1) => {
    const p = {yaw: 0.3, pitch: 0.1};
    applyMouseLook(p, dx, dy, {sens, invertX, invertY}, scale);
    return {dYaw: p.yaw - 0.3, dPitch: p.pitch - 0.1};
  };

  it('normal: mouse right turns right (yaw decreases), mouse up looks up (pitch increases); each invert flips only its own axis', () => {
    const k = 1 * LOOK_RAD_PER_COUNT;
    const base = look(false, false, 10, -10);
    expect(base.dYaw).toBeCloseTo(-10 * k, 12);
    expect(base.dPitch).toBeCloseTo(10 * k, 12);
    const x = look(true, false, 10, -10), y = look(false, true, 10, -10), xy = look(true, true, 10, -10);
    expect([x.dYaw, x.dPitch]).toEqual([-base.dYaw, base.dPitch]); // X only
    expect([y.dYaw, y.dPitch]).toEqual([base.dYaw, -base.dPitch]); // Y only
    expect([xy.dYaw, xy.dPitch]).toEqual([-base.dYaw, -base.dPitch]); // both
    expect(lookSigns({invertX: false, invertY: false})).toEqual({x: 1, y: 1});
    expect(lookSigns({invertX: true, invertY: false})).toEqual({x: -1, y: 1});
    expect(lookSigns({invertX: false, invertY: true})).toEqual({x: 1, y: -1});
    expect(lookSigns({invertX: true, invertY: true})).toEqual({x: -1, y: -1});
  });

  it('both off (and Y alone) are bit-identical to the former code, at any sensitivity, aiming or not, over a random walk', () => {
    let seed = 7;
    const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    for (const invertY of [false, true]) for (const aiming of [false, true]) for (const sens of [0.2, 1, 1.85, 3]) {
      const a = {yaw: 0, pitch: 0}, b = {yaw: 0, pitch: 0};
      for (let i = 0; i < 400; i++) {
        const dx = Math.round(r() * 80), dy = Math.round(r() * 80);
        formerLook(a, dx, dy, {sens, invertY}, aiming);
        applyMouseLook(b, dx, dy, {sens, invertX: false, invertY}, aiming ? 0.65 : 1);
        expect(b).toEqual(a);
      }
    }
  });

  it('sensitivity scaling (x sens, x 0.65 aiming) is applied the same with an axis inverted; the pitch clamp holds both ways', () => {
    for (const [inv, sign] of [[false, 1], [true, -1]] as const) {
      expect(look(inv, false, 100, 0, 2, 0.65).dYaw).toBeCloseTo(-100 * 2 * LOOK_RAD_PER_COUNT * 0.65 * sign, 12);
      expect(look(false, inv, 0, 100, 2, 0.65).dPitch).toBeCloseTo(-100 * 2 * LOOK_RAD_PER_COUNT * 0.65 * sign, 12);
    }
    for (const invertY of [false, true]) {
      const p = {yaw: 0, pitch: 0};
      applyMouseLook(p, 0, 1e6, {sens: 3, invertX: false, invertY}); // far past the limit
      expect(Math.abs(p.pitch)).toBe(PITCH_LIMIT);
      expect(p.pitch).toBe(invertY ? PITCH_LIMIT : -PITCH_LIMIT);
      applyMouseLook(p, 0, -2e6, {sens: 3, invertX: false, invertY});
      expect(p.pitch).toBe(invertY ? -PITCH_LIMIT : PITCH_LIMIT);
    }
    expect(PITCH_LIMIT).toBe(1.45);
    expect(LOOK_RAD_PER_COUNT).toBe(0.0022);
  });
});

describe('settings: invertX next to invertY, off by default, persisted in the browser settings record only', () => {
  it('defaults off; a record from before invertX (and a missing record) reads false without being "fixed"', () => {
    expect(SETTINGS_DEFAULTS).toMatchObject({invertX: false, invertY: false});
    expect(SETTINGS_KEYS).toContain('invertX');
    const old = parseStoredSettings(JSON.stringify({v: 1, sens: 1.4, fov: 80, volume: 0.5, muted: false, invertY: true, quality: 'high', renderScale: 1, trainSway: 1}));
    expect(old.settings).toMatchObject({invertX: false, invertY: true, sens: 1.4});
    expect([old.source, old.fixed]).toEqual(['stored', []]);
    expect(parseStoredSettings(null).settings).toMatchObject({invertX: false, invertY: false});
  });

  it('malformed values fall back to off (flagged), the other fields keep their stored values', () => {
    for (const bad of ['yes', 1, 0, null, {}, [true]]) {
      const r = sanitizeSettings({...SETTINGS_DEFAULTS, invertX: bad, invertY: bad, sens: 2});
      expect(r.settings).toMatchObject({invertX: false, invertY: false, sens: 2});
      expect(r.fixed).toEqual(expect.arrayContaining(['invertX', 'invertY']));
    }
    expect(parseStoredSettings('{not json').settings).toMatchObject({invertX: false, invertY: false});
  });

  it('each toggle persists on its own across a reload (a new store over the same storage); FOV / sensitivity / quality untouched', () => {
    const mem = new MemStorage();
    const a = new SettingsStore(mem);
    a.set({sens: 1.6, fov: 90, quality: 'low', renderScale: 0.5});
    const changes: string[][] = [];
    a.subscribe((_, ch) => changes.push([...ch]));
    a.set({invertX: true});
    expect(changes.at(-1)).toEqual(['invertX']); // only that key changed: main.ts re-applies nothing render-related for it
    expect(JSON.parse(mem.getItem(STORAGE_KEYS.settings)!)).toMatchObject({invertX: true, invertY: false});
    const b = new SettingsStore(mem);
    expect(b.get()).toMatchObject({invertX: true, invertY: false, sens: 1.6, fov: 90, quality: 'low', renderScale: 0.5});
    b.set({invertY: true});
    b.set({invertX: false});
    expect(new SettingsStore(mem).get()).toMatchObject({invertX: false, invertY: true, sens: 1.6, fov: 90});
    expect(serializeSettings(b.stored())).toMatch(/"invertX":false,"invertY":true/);
  });

  it('copySettingsInto hands both to the game\'s Settings (read every frame: applies on the next frame, no renderer work)', () => {
    const target = {sens: 1, fov: 75, volume: 0.7, muted: false, invertX: false, invertY: false, quality: 'high' as 'low' | 'high', renderScale: 1, trainSway: 1};
    expect(copySettingsInto(target, {...SETTINGS_DEFAULTS, invertX: true}).qualityChanged).toBe(false);
    expect([target.invertX, target.invertY]).toEqual([true, false]);
    copySettingsInto(target, {...SETTINGS_DEFAULTS, invertY: true});
    expect([target.invertX, target.invertY]).toEqual([false, true]);
    // main.ts: a mouse setting re-applies nothing (no resize / re-warm / camera change), only the copy
    expect(src('../src/main.ts')).toMatch(/if \(changed\.some\(k => k === 'quality' \|\| k === 'renderScale' \|\| k === 'fov'\)\) game\.applySettings\(\);/);
  });

  it('not save content: the save serializer / validator never mention the invert settings', () => {
    for (const f of ['../src/save/serialize.ts', '../src/save/validate.ts', '../src/save/slots.ts']) expect(src(f)).not.toMatch(/invert[XY]/);
  });
});

describe('only the player LOOK reads them (game.ts both look paths + the sway), nothing else', () => {
  it('both look paths go through applyMouseLook (no inline look math left); the sway follows the effective turn', () => {
    const g = src('../src/game.ts');
    expect(g.match(/applyMouseLook\(p, inp\.dx, inp\.dy, this\.settings(, this\.aiming \? 0\.65 : 1)?\)/g)).toHaveLength(2);
    expect(g).not.toMatch(/p\.yaw -= inp\.dx/);
    expect(g).not.toMatch(/inp\.dy \* sens/);
    expect(g).toMatch(/lookDX: inp\.dx \* lookSigns\(this\.settings\)\.x, lookDY: inp\.dy \* lookSigns\(this\.settings\)\.y/);
  });

  it('no menu / map / scroll / drag / keyboard code reads invertX / invertY', () => {
    const allowed = ['../src/game.ts', '../src/player/mouseLook.ts', '../src/ui/settingsStore.ts', '../src/ui/mainMenu.ts'];
    for (const f of ['../src/ui/paperMap.ts', '../src/ui/inventoryUI.ts', '../src/ui/bagView.ts', '../src/ui/lockboxView.ts', '../src/player/input.ts', '../src/ui/hud.ts']) {
      let text = '';
      try { text = src(f); } catch { continue; }
      expect(text, f).not.toMatch(/invert[XY]/);
    }
    // in game.ts only the Settings type / defaults and the look / sway lines
    const hits = src('../src/game.ts').split('\n').filter(l => /invert[XY]/.test(l));
    expect(hits.length).toBeLessThanOrEqual(2);
    for (const h of hits) expect(h).toMatch(/interface Settings|readonly settings: Settings/);
    expect(allowed).toHaveLength(4);
  });
});
