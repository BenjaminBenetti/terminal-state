// Task studio-beta-campaign-polish-20261103-063841-01 (lane MENU): the queued menu / settings / loading / death polish.
//  1. the title camera opens at the framing its orbit reached ~25 s in, then keeps its slow motion;
//  3. the background building's black triangles / broken geometry: the cooked city GLBs' zero normals are repaired and their own
//     doubleSided flag is honoured (lit toward the eye);
//  2 / 4 / 5 / 6. no verbose copy; submenus in a centred dialog (the real MainMenuView on a small Node DOM); Controls = a top-level
//     item with the game's actual bindings; one grid row per save slot;
//  7. the Quality setting's label / help line match what it really changes (render/atmosphere.ts ATMOSPHERE_QUALITY + the DPR cap);
//  8. render resolution: a 25-100 % slider in 1 % steps, 1 / 0.5 / 0.25 -> 100 / 50 / 25 %, clamped, applied coalesced;
//  9. the loading screen shows only the location name (the real Game.showLoading / updateStationIntro on a fake DOM);
//  DEATH: "Load last save" restores the ACTIVE slot's persisted save through the main menu's Continue path (the real
//     Game.loadLastSave / continueCampaign on a minimal shell with the real save slots), never writes / erases, honest without a save.
import {describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {buildBoth} from './helpers/tslShaders';
import {buildExterior, modelParts, planExterior} from '../src/world/exterior';
import {MENU_SCENE, MenuScene, orbitPose, type MenuRenderer} from '../src/world/menuScene';
import {repairZeroNormals, zeroNormalVertices} from '../src/world/normalRepair';

installCanvasShim(false);

class FakeRenderer implements MenuRenderer {
  initialized = true;
  toneMappingExposure = 1;
  info = {reset() {}};
  getDrawingBufferSize(t: THREE.Vector2): THREE.Vector2 { return t.set(1920, 1080); }
  getRenderTarget(): unknown { return null; }
  setRenderTarget(): void {}
  render(): void {}
}

const withVisibleDocument = <T>(fn: () => T): T => {
  const g = globalThis as {document?: {hidden: boolean}};
  const had = g.document;
  g.document = {...(had ?? {}), hidden: false} as {hidden: boolean};
  try { return fn(); } finally { if (had) g.document = had; else delete g.document; }
};

describe('item 1: the title camera opens at the ~25 s framing and keeps moving slowly', () => {
  it('the opening phase is 25 s of the unchanged orbit', () => {
    expect(MENU_SCENE.orbit.startAt).toBe(25);
    const m = new MenuScene({});
    // posed at construction (the pipelines compile from this camera): exactly the orbit's 25 s pose, not its old t = 0 start
    expect(m.camera.position.distanceTo(orbitPose(25).pos)).toBeLessThan(1e-9);
    expect(m.camera.position.distanceTo(orbitPose(0).pos)).toBeGreaterThan(5);
    m.dispose();
  });

  it('the FIRST drawn frame is the 25 s framing however late the diorama appears (no fast-forward), then real time runs on', () => {
    withVisibleDocument(() => {
      for (const appearAt of [1800, 9_500, 93_000]) {
        const m = new MenuScene({});
        const r = new FakeRenderer();
        expect(m.render(r, appearAt)).toBe(true);
        expect(m.camera.position.distanceTo(orbitPose(25).pos), `appears at ${appearAt} ms`).toBeLessThan(1e-9);
        // 30 fps for 10 s: every step is a small continuous move (no jump), and it ends at the orbit's 35 s pose
        let prev = m.camera.position.clone(), maxStep = 0;
        for (let t = appearAt + 1000 / 30; t <= appearAt + 10_000 + 1e-6; t += 1000 / 30) {
          if (!m.render(r, t)) continue;
          maxStep = Math.max(maxStep, m.camera.position.distanceTo(prev));
          prev = m.camera.position.clone();
        }
        expect(maxStep).toBeGreaterThan(0); // it keeps moving
        expect(maxStep).toBeLessThan(0.08); // slowly (~1 m/s at most at the orbit's radius)
        expect(m.camera.position.distanceTo(orbitPose(m.orbitTime(appearAt + 10_000)).pos)).toBeLessThan(1e-6);
        expect(m.orbitTime(appearAt + 10_000)).toBeCloseTo(35, 6);
        m.dispose();
      }
    });
  });

  it('the QA timeOffset still shifts the clock on top of the opening phase', () => {
    const m = new MenuScene({});
    m.timeOffset = 40;
    expect(m.orbitTime(5000)).toBeCloseTo(65, 9);
    expect(m.orbitTime(7000)).toBeCloseTo(67, 9);
    m.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// item 3

/** POSITION / NORMAL / indices of the first primitive of an uncompressed cooked GLB (no three loader in Node). */
function readGlbGeometry(file: string): THREE.BufferGeometry {
  const f = fs.readFileSync(path.resolve(__dirname, '../public/assets/models', file));
  const jl = f.readUInt32LE(12);
  const j = JSON.parse(f.subarray(20, 20 + jl).toString('utf8'));
  const off = 20 + jl, bl = f.readUInt32LE(off), bin = f.subarray(off + 8, off + 8 + bl);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const acc = (i: number): number[] => {
    const a = j.accessors[i], bv = j.bufferViews[a.bufferView];
    const n = ({SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4} as Record<string, number>)[a.type];
    const es = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const stride = bv.byteStride ?? n * es, start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[] = [];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      const o = start + k * stride + c * es;
      out.push(a.componentType === 5126 ? dv.getFloat32(o, true) : es === 4 ? dv.getUint32(o, true) : es === 2 ? dv.getUint16(o, true) : dv.getUint8(o));
    }
    return out;
  };
  const p = j.meshes[0].primitives[0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc(p.attributes.POSITION), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc(p.attributes.NORMAL), 3));
  g.setIndex(acc(p.indices));
  return g;
}

/** Triangles whose three vertex normals are all zero (normalize(0) = NaN in the fragment: drawn black). */
function blackTriangles(g: THREE.BufferGeometry): number {
  const zero = new Set(zeroNormalVertices(g)), idx = g.getIndex()!;
  let n = 0;
  for (let t = 0; t < idx.count; t += 3) if (zero.has(idx.getX(t)) && zero.has(idx.getX(t + 1)) && zero.has(idx.getX(t + 2))) n++;
  return n;
}

describe('item 3: the background building\'s black triangles are repaired at the source (zero normals; the model\'s own side)', () => {
  it('ROOT CAUSE: the cooked ruined tower / mid-rise carry zero-length normals that shade as whole black triangles', () => {
    const tower = readGlbGeometry('office-ruined-tower.glb'), mid = readGlbGeometry('office-ruined-midrise.glb');
    expect(zeroNormalVertices(tower).length).toBe(254);
    expect(blackTriangles(tower)).toBe(54);
    expect(zeroNormalVertices(mid).length).toBe(262);
    expect(blackTriangles(mid)).toBe(24);
  });

  it('repairZeroNormals: every zero normal becomes a unit normal from its faces; every valid normal is left exactly as it was; idempotent', () => {
    for (const file of ['office-ruined-tower.glb', 'office-ruined-midrise.glb']) {
      const g = readGlbGeometry(file);
      const before = Float32Array.from(g.getAttribute('normal').array as Float32Array);
      const bad = new Set(zeroNormalVertices(g));
      expect(repairZeroNormals(g)).toBe(bad.size);
      expect(zeroNormalVertices(g)).toEqual([]);
      expect(blackTriangles(g)).toBe(0);
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) {
        if (bad.has(i)) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
        else expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([before[i * 3], before[i * 3 + 1], before[i * 3 + 2]]);
      }
      const after = Float32Array.from(n.array as Float32Array);
      expect(repairZeroNormals(g)).toBe(0);
      expect(Float32Array.from(n.array as Float32Array)).toEqual(after);
    }
  });

  it('a repaired normal follows its faces even when a neighbour is wound the other way (no cancellation)', () => {
    // two triangles sharing vertex 0, both in the y = 0 plane, the second wound the opposite way
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0, -1, 0, 0, 0, 0, 1], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 3, 4]);
    expect(repairZeroNormals(g)).toBe(1);
    const n = g.getAttribute('normal');
    expect(Math.abs(n.getY(0))).toBeCloseTo(1, 9);
    // an isolated zero-normal vertex (no face) gets +Y, never NaN
    const lone = new THREE.BufferGeometry();
    lone.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 5, 5, 5], 3));
    lone.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, Number.NaN, 0, 0], 3));
    lone.setIndex([0, 1, 2]);
    expect(repairZeroNormals(lone)).toBe(1);
    expect([lone.getAttribute('normal').getX(3), lone.getAttribute('normal').getY(3)]).toEqual([0, 1]);
  });

  const heroGltf = (side: THREE.Side, zeroNormals = false): GLTF => {
    const scene = new THREE.Group();
    const map = new THREE.DataTexture(new Uint8Array([120, 118, 110, 255]), 1, 1);
    map.needsUpdate = true;
    const g = new THREE.BoxGeometry(30, 60, 40).toNonIndexed();
    g.translate(0, 30, 0);
    if (zeroNormals) for (let i = 0; i < 3; i++) g.getAttribute('normal').setXYZ(i, 0, 0, 0);
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({map, side})));
    return {scene} as unknown as GLTF;
  };

  it('modelParts repairs a model\'s zero normals before any exterior instancing uses them', () => {
    const gltf = heroGltf(THREE.DoubleSide, true);
    const [part] = modelParts(gltf);
    expect(zeroNormalVertices(part.geometry)).toEqual([]);
  });

  it('the exterior keeps a model\'s glTF doubleSided (DoubleSide, eye-facing light) and front-side models front-side; both backends compile', () => {
    const C = MENU_SCENE.corridor;
    const plan = planExterior({foot: {x0: C.x0, z0: C.z0, x1: C.x1, z1: C.z1}, groundY: 0, eyeAbove: 5, seed: MENU_SCENE.seed});
    expect(plan.buildings.some(b => b.kind === 'tower')).toBe(true); // the diorama's plan places the ruined tower (behind the lead car)
    const two = buildExterior(plan, {tower: heroGltf(THREE.DoubleSide)});
    const towers = two.instanced.filter(m => m.name.startsWith('tower-ext-tower-'));
    expect(towers.length).toBeGreaterThan(0);
    for (const m of towers) expect((m.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const one = buildExterior(plan, {tower: heroGltf(THREE.FrontSide)});
    for (const m of one.instanced.filter(x => x.name.startsWith('tower-ext-tower-'))) expect((m.material as THREE.Material).side).toBe(THREE.FrontSide);
    for (const b of buildBoth(towers[0])) expect(b.errors, b.backend).toEqual([]);
  });

  it('the title diorama builds its city with the double-sided hero and stays within its draw budget', () => {
    const m = new MenuScene({exterior: {tower: heroGltf(THREE.DoubleSide), midrise: heroGltf(THREE.DoubleSide)}});
    expect(m.stats().source.heroes).toBe(true);
    expect(m.stats().meshes).toBeLessThanOrEqual(MENU_SCENE.maxDrawCalls);
    let sides = 0;
    m.scene.traverse(o => { const x = o as THREE.Mesh; if (x.isMesh && x.name.startsWith('tower-ext-tower-') && (x.material as THREE.Material).side === THREE.DoubleSide) sides++; });
    expect(sides).toBeGreaterThan(0);
    m.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// items 2 / 4 / 5 / 6 / 7 / 8: the menu and the settings form

import {MiniEl, MiniEvent, MiniText, installMiniDom} from './helpers/paperMapDom';
import {SAVE_SLOTS, STORAGE_KEYS, type SaveMeta} from '../src/campaign/types';
import {CONTROLS} from '../src/ui/hud';
import {ATMOSPHERE_QUALITY} from '../src/render/atmosphere';
import {DEV_CODES_HINT, MainMenuController, MainMenuView, mountSettingsForm, type ImportResult, type MenuHost, type SlotView} from '../src/ui/mainMenu';
import {
  CoalescedApply, QUALITY_LABEL, QUALITY_OPTIONS, RENDER_PERCENT, SETTINGS_DEFAULTS, SettingsStore, nativePixelRatio, parseStoredSettings,
  qualityDescription, renderPercent, renderPixelRatio, renderScaleFromPercent, type SettingsStorage,
} from '../src/ui/settingsStore';

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const meta = (slot: number, o: Partial<SaveMeta> = {}): SaveMeta => ({
  slot, savedAt: '2026-11-02T20:00:00.000Z', revision: 3, playtime: 3725, station: 'Calder Park', archetype: 'subway', stationsVisited: 4,
  networkSeed: 123456, won: false, reason: 'arrival', build: 'test', ...o,
});

class Host implements MenuHost {
  slots: SlotView[] = [0, 1, 2].map(slot => ({slot, empty: true, valid: false}));
  calls: string[] = [];
  listSlots(): SlotView[] { return this.slots.map(x => ({...x})); }
  lastSlot(): number | null { return null; }
  newGame(slot: number): Promise<void> { this.calls.push(`new:${slot}`); return Promise.resolve(); }
  continueGame(slot?: number): Promise<void> { this.calls.push(`continue:${slot}`); return Promise.resolve(); }
  exportSlot(slot: number): void { this.calls.push(`export:${slot}`); }
  importFile(): Promise<ImportResult> { return Promise.resolve({ok: true}); }
  deleteSlot(slot: number): void { this.calls.push(`delete:${slot}`); }
}

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

/** The bits of the DOM the menu view / settings form use that the shared mini DOM leaves out (patched for this file only). */
function patchMiniDom(): void {
  const P = MiniEl.prototype as unknown as Record<string, unknown>;
  const node = (n: unknown) => (typeof n === 'string' ? new MiniText(n) : n) as MiniEl | MiniText;
  P.append = function (this: MiniEl, ...ns: unknown[]) { for (const n of ns) this.appendChild(node(n)); };
  P.prepend = function (this: MiniEl, ...ns: unknown[]) {
    for (const n of ns.reverse()) { const c = node(n); if (c.parent) c.parent.removeChild(c); c.parent = this; this.children.unshift(c); }
  };
  P.replaceChildren = function (this: MiniEl, ...ns: unknown[]) { for (const c of this.children) c.parent = null; this.children = []; (this as unknown as {append(...x: unknown[]): void}).append(...ns); };
  const kebab = (k: string) => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
  Object.defineProperty(P, 'dataset', {configurable: true, get(this: MiniEl) {
    return new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? this.getAttribute(`data-${kebab(k)}`) ?? undefined : undefined),
      set: (_, k, v) => { this.setAttribute(`data-${kebab(String(k))}`, String(v)); return true; },
    });
  }});
  Object.defineProperty(P, 'htmlFor', {configurable: true, get() { return {add() {}}; }});
  Object.defineProperty(P, 'ownerDocument', {configurable: true, get(this: MiniEl) { return this.doc; }});
  Object.defineProperty(P, 'isConnected', {configurable: true, get(this: MiniEl) { let n: MiniEl = this; while (n.parent) n = n.parent; return n === this.doc?.documentElement; }});
}

/** The menu's DOM: #title > .mm-side > #mm-view, a real view + settings form over a controller. */
function mountMenu(host: MenuHost = new Host(), o: {store?: SettingsStore; timers?: {set(fn: () => void, ms: number): unknown; clear(h: unknown): void}} = {}) {
  patchMiniDom();
  const dom = installMiniDom(1920, 1080);
  dom.doc.body.innerHTML = '<section id="title" class="screen" data-mode="menu"><div class="mm-side" id="main-menu"><div id="mm-view"></div></div></section>';
  const title = dom.doc.querySelector('#title')!, side = dom.doc.querySelector('.mm-side')!, root = dom.doc.querySelector('#mm-view')!;
  const store = o.store ?? new SettingsStore(new MemStorage());
  const ctl = new MainMenuController(host, {controls: CONTROLS});
  ctl.setBoot(true, 1);
  const view = new MainMenuView(root as unknown as HTMLElement, ctl, {
    overlayHost: title as unknown as HTMLElement,
    settings: box => { mountSettingsForm(box, store, {idPrefix: 'mm-set-', viewport: () => ({w: 1920, h: 1080, dpr: 1}), qualityPresets: ATMOSPHERE_QUALITY, timers: o.timers}); },
  });
  const overlay = title.querySelector('.mm-overlay')!, dialog = title.querySelector('.mm-dialog')!;
  const btn = (id: string, inDialog = ctl.view !== 'main') => (inDialog ? dialog : root).querySelector(`[data-action="${id}"]`);
  // a browser click focuses the button first (focusin: the view tells the controller), then clicks it
  const press = (el: MiniEl | null) => { if (!el) throw new Error('no such button'); el.focus(); el.dispatchEvent(new MiniEvent('focusin')); dom.click(el); };
  return {dom, title, side, root, overlay, dialog, ctl, view, store, btn, press};
}

describe('item 2: no verbose explanatory copy', () => {
  it('the desktop / touch notice and the long menu note are gone (and nothing claims touch support instead)', () => {
    const html = SRC('index.html'), main = SRC('src/main.ts');
    expect(html).not.toMatch(/touch is not supported|Desktop keyboard and mouse only/i);
    expect(html).not.toContain('id="mm-note"');
    expect(main).not.toMatch(/Touch devices are not supported|mm-note|pointer: coarse/);
    expect(`${html}\n${main}\n${SRC('src/ui/mainMenu.ts')}`).not.toMatch(/touch (is|are) supported|supports touch/i);
  });

  it('submenus carry no explanatory paragraphs; confirmations stay short and honest', async () => {
    const h = new Host();
    h.slots[0] = {slot: 0, empty: false, valid: true, meta: meta(0)};
    const c = new MainMenuController(h);
    c.setBoot(true, 1);
    await c.activate('new-game');
    expect(c.model().text).toEqual([]);
    c.back();
    await c.activate('slots');
    expect(c.model().text).toEqual([]);
    c.back();
    await c.activate('new-game');
    await c.activate('new:0');
    const t = c.model().text;
    expect(t).toHaveLength(2);
    expect(t[1]).toBe('This save will be replaced and cannot be recovered.');
    expect(t.join(' ').length).toBeLessThan(160);
  });

  it('the settings form shows a note only when something is wrong', () => {
    const ok = mountMenu();
    try {
      expect(ok.dialog.querySelector('.set-note')!.textContent).toBe('');
    } finally { ok.dom.uninstall(); }
    const blocked = new SettingsStore({getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); }});
    const bad = mountMenu(new Host(), {store: blocked});
    try {
      expect(bad.dialog.querySelector('.set-note')!.textContent).toBe('Settings could not be saved in this browser: they apply for this session only.');
    } finally { bad.dom.uninstall(); }
  });
});

describe('item 4: submenus open front and centre (the real view)', () => {
  it('the main list stays in the side column; a submenu opens as a centred dialog; the side is inert; Esc / Back return with focus', async () => {
    const m = mountMenu();
    try {
      expect(m.overlay.classList.contains('hidden')).toBe(true);
      expect(m.dialog.getAttribute('role')).toBe('dialog');
      expect(m.dialog.getAttribute('aria-modal')).toBe('true');
      expect(m.root.querySelectorAll('[data-action]').map(b => b.getAttribute('data-action'))).toEqual(['new-game', 'slots', 'settings', 'controls']);
      m.press(m.btn('slots'));
      expect(m.ctl.view).toBe('slots');
      expect(m.overlay.classList.contains('hidden')).toBe(false);
      expect(m.dialog.getAttribute('data-view')).toBe('slots');
      expect(m.side.hasAttribute('inert')).toBe(true);
      expect(m.side.classList.contains('mm-dimmed')).toBe(true);
      // the main list is still rendered (legible) beside the dialog; the dialog holds the slots, and the focus moved into it
      expect(m.root.querySelectorAll('[data-action]').map(b => b.getAttribute('data-action'))).toEqual(['new-game', 'slots', 'settings', 'controls']);
      expect(m.dialog.contains(m.dom.doc.activeElement)).toBe(true);
      expect(m.dialog.querySelector('h2')!.textContent).toBe('Save slots');
      // Esc from inside the dialog: back to the main list, the dialog hidden, the side live again, focus back on "Load save / slots"
      m.dom.key('Escape');
      expect(m.ctl.view).toBe('main');
      expect(m.overlay.classList.contains('hidden')).toBe(true);
      expect(m.side.hasAttribute('inert')).toBe(false);
      expect(m.dom.doc.activeElement?.getAttribute('data-action')).toBe('slots');
      // Esc with the focus lost to the page (a click on the dimmer) still steps back
      m.press(m.btn('settings'));
      expect(m.ctl.view).toBe('settings');
      m.dom.doc.activeElement = m.dom.doc.body;
      m.dom.key('Escape');
      expect(m.ctl.view).toBe('main');
      // a nested confirmation stays in the dialog and Back walks out one level at a time
      const h = new Host();
      h.slots[1] = {slot: 1, empty: false, valid: true, meta: meta(1)};
      const n = mountMenu(h);
      n.press(n.btn('new-game'));
      n.press(n.btn('new:1'));
      expect(n.ctl.view).toBe('confirm-overwrite');
      expect(n.dom.doc.activeElement?.getAttribute('data-action')).toBe('back'); // a destructive default never sits under Enter
      n.press(n.btn('back'));
      expect(n.ctl.view).toBe('new');
      expect(n.overlay.classList.contains('hidden')).toBe(false);
      n.dom.uninstall();
    } finally { m.dom.uninstall(); }
  });

  it('Settings opens on its first control, and a re-render (boot progress) never pulls the focus off it', () => {
    const m = mountMenu();
    try {
      m.press(m.btn('settings'));
      const first = m.dialog.querySelector('#mm-set-sens');
      expect(m.dom.doc.activeElement).toBe(first);
      m.ctl.setBoot(true, 1);
      m.ctl.refresh(); // a controller re-render
      expect(m.dom.doc.activeElement).toBe(first);
    } finally { m.dom.uninstall(); }
  });

  it('mainModel() is the main list whatever submenu is on top (the side column\'s content)', async () => {
    const c = new MainMenuController(new Host(), {controls: CONTROLS});
    c.setBoot(true, 1);
    await c.activate('settings');
    expect(c.view).toBe('settings');
    expect(MainMenuController.actions(c.mainModel()).map(a => a.id)).toEqual(['new-game', 'slots', 'settings', 'controls']);
    expect(c.view).toBe('settings'); // unchanged
    expect(MainMenuController.actions(c.model()).map(a => a.id)).toEqual(['back']);
  });
});

describe('item 5: Controls is a top-level item showing the actual bindings', () => {
  it('the main list offers Controls; its dialog lists ui/hud.ts CONTROLS verbatim plus one optional dev-code hint', () => {
    const m = mountMenu();
    try {
      m.press(m.btn('controls'));
      expect(m.ctl.view).toBe('controls');
      const rows = m.dialog.querySelector('.mm-controls')!.elements;
      const want = CONTROLS.filter(([a]) => a);
      expect(rows.length).toBe(want.length);
      rows.forEach((r, k) => {
        expect(r.querySelector('span')!.textContent).toBe(want[k][0]);
        expect(r.querySelector('kbd')!.textContent).toBe(want[k][1]);
      });
      expect(m.dialog.querySelector('.mm-hint')!.textContent).toBe(DEV_CODES_HINT);
      expect(DEV_CODES_HINT).toMatch(/1337.*map.*Lockbox/);
      expect(m.dialog.querySelector('.mm-controls')!.classList.contains('hidden')).toBe(false);
      m.press(m.btn('back'));
      expect(m.ctl.view).toBe('main');
      expect(m.dialog.querySelector('.mm-controls')!.classList.contains('hidden')).toBe(true);
    } finally { m.dom.uninstall(); }
  });

  it('main.ts passes the central mapping; the old title-screen Controls dropdown is gone; the pause menu keeps its grid', () => {
    const main = SRC('src/main.ts'), html = SRC('index.html');
    expect(main).toMatch(/controls: CONTROLS/);
    expect(html).not.toMatch(/<summary>Controls<\/summary>|controls-title/);
    expect(html).toContain('id="controls-pause"');
    // the bindings it shows are the game's: e.g. crouch is C (player/input.ts CROUCH_KEYS), the melee slot the key left of 1
    expect(CONTROLS.find(([a]) => a.startsWith('Crouch'))![1]).toBe('C');
  });
});

describe('item 6: one clean grid row per save slot', () => {
  it('every slot row has exactly three cells (slot | name + metadata | actions); long names are kept whole for the tooltip', () => {
    const h = new Host();
    const long = 'Thistlecombe Quay Interchange and Maintenance Yard North '.repeat(3).trim();
    h.slots = [
      {slot: 0, empty: false, valid: true, meta: meta(0, {station: long, won: true})},
      {slot: 1, empty: false, valid: false, error: 'checksum mismatch'},
      {slot: 2, empty: true, valid: false},
    ];
    const m = mountMenu(h);
    try {
      m.press(m.btn('slots'));
      const rows = m.dialog.querySelectorAll('.mm-row.slot');
      expect(rows).toHaveLength(SAVE_SLOTS);
      for (const r of rows) {
        expect(r.elements.map(e => e.className)).toEqual(['mm-head', 'mm-info', 'mm-acts']);
        for (const l of r.querySelectorAll('.mm-line')) expect(l.getAttribute('title') ?? (l as unknown as {title: string}).title).toBe(l.textContent);
      }
      expect(m.dialog.querySelector('.mm-rows')!.classList.contains('mm-slots')).toBe(true);
      const name = rows[0].querySelector('.mm-line.mm-name')!;
      expect(name.textContent).toBe(`${long} (Subway)`);
      expect(rows[0].querySelectorAll('.mm-line')[1].textContent).toMatch(/1 h 02 min played · saved .* · seed .* · 4 stations · WON/);
      // export / import / overwrite confirm / back all still there
      expect(rows[0].querySelectorAll('button').map(b => b.getAttribute('data-action'))).toEqual(['load:0', 'export:0', 'import:0', 'delete:0']);
      expect(rows[2].querySelectorAll('button').map(b => b.getAttribute('data-action'))).toEqual(['import:2']);
      expect(m.btn('back')).toBeTruthy();
    } finally { m.dom.uninstall(); }
  });

  it('the CSS: fixed columns with an ellipsized middle, a fixed action column, a deliberate stack under 760 px', () => {
    const src = SRC('src/ui/mainMenu.ts');
    expect(src).toMatch(/\.mm-row\.slot \{ display: grid; grid-template-columns: 4\.4em minmax\(0, 1fr\) var\(--mm-acts\)/);
    expect(src).toMatch(/\.mm-row \.mm-line \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis/);
    expect(src).toMatch(/\.mm-row\.slot \.mm-acts \{ flex-wrap: nowrap; justify-content: flex-end; \}/);
    expect(src).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.mm-row\.slot \{ grid-template-columns: 4em minmax\(0, 1fr\); \}[\s\S]*\.mm-row\.slot \.mm-acts \{ grid-column: 1 \/ -1;/);
  });
});

describe('item 7: the Quality setting is named and described by what it really changes', () => {
  it('its real effects: the volumetric fog preset (march resolution / pixel cap / steps), the flashlight shadow map, MSAA, the DPR cap', () => {
    for (const q of ['high', 'low'] as const) {
      const p = ATMOSPHERE_QUALITY[q], line = qualityDescription(q, p);
      expect(line).toContain(`${p.steps} steps`);
      expect(line).toContain(`${p.shadowMapSize} px flashlight shadow`);
      expect(line).toContain(p.msaa > 0 ? `${p.msaa}× MSAA` : 'no MSAA');
      expect(line).toContain(p.scale === 0.5 ? '½ resolution' : '¼ resolution');
      const w = Math.round(Math.sqrt(p.maxPixels * 16 / 9));
      expect(line).toContain(`≤ ${w}×${Math.round(w * 9 / 16)}`);
      expect(line).toContain(`${nativePixelRatio(1e9, q)}×`);
    }
    expect(qualityDescription('high', ATMOSPHERE_QUALITY.high)).toBe('Fog at ½ resolution (≤ 960×540), 24 steps · 1024 px flashlight shadow · 4× MSAA · pixel ratio up to 1.5×');
    expect(qualityDescription('low', ATMOSPHERE_QUALITY.low)).toBe('Fog at ¼ resolution (≤ 480×270), 14 steps · 512 px flashlight shadow · no MSAA · pixel ratio capped at 0.85×');
    expect(QUALITY_LABEL).toBe('Fog, shadows & anti-aliasing');
    expect(QUALITY_OPTIONS.map(o => o.value)).toEqual(['high', 'low']); // semantics (stored values) unchanged
  });

  it('the label never claims to be render resolution, and the render scale never changes quality (they coexist)', () => {
    expect(QUALITY_LABEL).not.toMatch(/resolution/i);
    const s = new SettingsStore(new MemStorage());
    s.set({quality: 'low', renderScale: 0.6});
    expect(s.get()).toMatchObject({quality: 'low', renderScale: 0.6});
    expect(renderPixelRatio(2, 'low', 0.6)).toBeCloseTo(0.85 * 0.6, 10);
    s.set({renderScale: 0.9});
    expect(s.get().quality).toBe('low');
  });

  it('the form shows the label, the two options and the live help line from the injected presets', () => {
    const m = mountMenu();
    try {
      m.press(m.btn('settings'));
      const sel = m.dialog.querySelector('#mm-set-quality')! as unknown as {value: string; dispatchEvent(e: MiniEvent): void};
      const label = (sel as unknown as MiniEl).parentElement!;
      expect(label.textContent).toContain(QUALITY_LABEL);
      expect((sel as unknown as MiniEl).querySelectorAll('option').map(o => o.textContent)).toEqual(['High', 'Low (faster)']);
      const help = m.dialog.querySelector('#mm-set-quality-help')!;
      expect(help.textContent).toBe(qualityDescription('high', ATMOSPHERE_QUALITY.high));
      sel.value = 'low';
      sel.dispatchEvent(new MiniEvent('change'));
      expect(m.store.get().quality).toBe('low');
      expect(help.textContent).toBe(qualityDescription('low', ATMOSPHERE_QUALITY.low));
    } finally { m.dom.uninstall(); }
  });
});

describe('item 8: render resolution is a 25-100 % slider (1 % steps), migrated, clamped, applied coalesced', () => {
  it('persisted Native / Half / Quarter (1 / 0.5 / 0.25) read as exactly 100 / 50 / 25 % — untouched, not "fixed"', () => {
    for (const [old, pct] of [[1, 100], [0.5, 50], [0.25, 25]] as const) {
      const r = parseStoredSettings(JSON.stringify({v: 1, ...SETTINGS_DEFAULTS, renderScale: old}));
      expect(r.settings.renderScale).toBe(old);
      expect(renderPercent(r.settings.renderScale)).toBe(pct);
      expect(r.fixed).toEqual([]);
      expect(r.source).toBe('stored');
    }
  });

  it('every whole percent 25..100 round-trips exactly; out-of-range / fractional / invalid values clamp, round or fall back', () => {
    for (let p = RENDER_PERCENT.min; p <= RENDER_PERCENT.max; p++) {
      const v = renderScaleFromPercent(p);
      expect(renderPercent(v)).toBe(p);
      expect(parseStoredSettings(JSON.stringify({renderScale: v})).settings.renderScale).toBe(v);
    }
    expect(RENDER_PERCENT).toEqual({min: 25, max: 100, step: 1});
    expect(renderScaleFromPercent(10)).toBe(0.25);
    expect(renderScaleFromPercent(140)).toBe(1);
    expect(renderScaleFromPercent(72.6)).toBe(0.73);
    expect(renderScaleFromPercent(Number.NaN)).toBe(1);
    expect(renderScaleFromPercent('80' as unknown as number)).toBe(1);
    const fixed = (raw: unknown) => parseStoredSettings(JSON.stringify({renderScale: raw}));
    expect(fixed(0.1).settings.renderScale).toBe(0.25);
    expect(fixed(0.1).fixed).toEqual(['renderScale']);
    expect(fixed(7).settings.renderScale).toBe(1);
    expect(fixed(0.4567).settings.renderScale).toBe(0.46);
    expect(fixed('half').settings.renderScale).toBe(1);
    expect(fixed(null).settings.renderScale).toBe(1);
    const s = new SettingsStore(new MemStorage());
    s.set({renderScale: Number.POSITIVE_INFINITY});
    expect(s.get().renderScale).toBe(1);
    expect(renderPixelRatio(1, 'high', 0.0001)).toBeCloseTo(0.25, 10); // never below 25 % even unsanitized
  });

  it('CoalescedApply: a burst of drag values applies ONCE with the last value (timer or change), never per input event', () => {
    const timers: (() => void)[] = [];
    const t = {set: (fn: () => void) => { timers.push(fn); return timers.length; }, clear: (h: unknown) => { timers[(h as number) - 1] = () => {}; }};
    const seen: number[] = [];
    const c = new CoalescedApply<number>(v => seen.push(v), 160, t);
    for (let p = 100; p >= 30; p--) c.push(p);
    expect(seen).toEqual([]);
    expect(c.busy).toBe(true);
    for (const fn of [...timers]) fn(); // only the last timer is live
    expect(seen).toEqual([30]);
    c.push(55); c.push(56);
    c.flush(); // the change event (release / a keyboard step)
    expect(seen).toEqual([30, 56]);
    c.flush();
    expect(seen).toEqual([30, 56]); // nothing pending: no-op
    c.push(70); c.cancel();
    for (const fn of [...timers]) fn();
    expect(seen).toEqual([30, 56]);
  });

  it('the slider: 25-100, step 1, the percent + buffer shown live; the store (renderer resize) changes once per drag', () => {
    const timers: (() => void)[] = [];
    const t = {set: (fn: () => void) => { timers.push(fn); return timers.length; }, clear: (h: unknown) => { timers[(h as number) - 1] = () => {}; }};
    const store = new SettingsStore(new MemStorage());
    const applied: number[] = [];
    store.subscribe((s, changed) => { if (changed.includes('renderScale')) applied.push(s.renderScale); });
    const m = mountMenu(new Host(), {store, timers: t});
    try {
      m.press(m.btn('settings'));
      const i = m.dialog.querySelector('#mm-set-res')! as unknown as MiniEl & {value: string; min: string; max: string; step: string};
      expect([i.min, i.max, i.step]).toEqual(['25', '100', '1']);
      expect(i.value).toBe('100');
      const out = i.parentElement!.querySelector('output')!, readout = m.dialog.querySelector('#mm-set-res-readout')!;
      expect(out.textContent).toBe('100 %');
      expect(readout.textContent).toBe('Renders 1920 × 1080 (native) · 100 % = 1× pixel ratio');
      for (const v of [99, 90, 80, 73]) { i.value = String(v); i.dispatchEvent(new MiniEvent('input')); }
      expect(out.textContent).toBe('73 %');
      expect(readout.textContent).toBe('Renders 1401 × 788 (native 1920 × 1080) · 100 % = 1× pixel ratio');
      expect(i.getAttribute('aria-valuetext')).toMatch(/^73 percent\. Renders 1401 × 788/);
      expect(applied).toEqual([]); // nothing applied mid-drag
      i.dispatchEvent(new MiniEvent('change')); // release
      expect(applied).toEqual([0.73]);
      for (const fn of [...timers]) fn();
      expect(applied).toEqual([0.73]); // the pending timer was cleared: still once
      // a keyboard step (input + change) applies at once; a stored value from elsewhere moves the slider
      i.value = '74'; i.dispatchEvent(new MiniEvent('input')); i.dispatchEvent(new MiniEvent('change'));
      expect(applied).toEqual([0.73, 0.74]);
      store.set({renderScale: 0.5});
      expect(i.value).toBe('50');
      expect(out.textContent).toBe('50 %');
    } finally { m.dom.uninstall(); }
  });

  it('the game and the menu share the renderer\'s pixel ratio from it (game.ts resize -> renderPixelRatio); FOV / volume bounds unchanged', () => {
    expect(SRC('src/game.ts')).toMatch(/setPixelRatio\(renderPixelRatio\(window\.devicePixelRatio \|\| 1, this\.settings\.quality, this\.settings\.renderScale\)\)/);
    expect(SRC('src/main.ts')).toMatch(/changed\.some\(k => k === 'quality' \|\| k === 'renderScale' \|\| k === 'fov'\)\) game\.applySettings\(\)/);
    const s = new SettingsStore(new MemStorage());
    s.set({fov: 300, volume: 4});
    expect(s.get()).toMatchObject({fov: 100, volume: 1});
  });
});

// ---------------------------------------------------------------------------------------------
// item 9 + DEATH: the real Game methods on a minimal shell (the campaign-journey pattern)

import {createRun} from '../src/run/runState';
import {SingleFlight} from '../src/run/travelGate';
import {SaveSlots} from '../src/save/slots';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Survival} from '../src/player/survival';
import {FakeStorage, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';
import {lastSaveNote, loadingPlaceName} from '../src/ui/loadingScreen';
import type {SectionKey} from '../src/levels/types';

describe('item 9 / DEATH (real Game methods, recorded fakes)', async () => {
  const {Game} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  const key = (i: number): SectionKey => ({level: 'subway', section: 'main', station: sid(i)});

  /** A fake page: the loading card's elements (game.ts $ = document.querySelector). */
  function fakePage() {
    const els = new Map<string, {textContent: string; style: Record<string, string>; dataset: Record<string, string>; disabled: boolean}>();
    const el = (sel: string) => { let e = els.get(sel); if (!e) els.set(sel, (e = {textContent: '', style: {}, dataset: {}, disabled: false})); return e; };
    const g = globalThis as {document?: unknown};
    const had = g.document;
    g.document = {querySelector: el, hidden: false};
    return {el, restore: () => { if (had) g.document = had; else delete g.document; }};
  }

  function shell(storage = new FakeStorage(), o: {realLoading?: boolean} = {}) {
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const log: string[] = [];
    const s: Record<string, unknown> = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number) => battery.reset(c)},
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0.1, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 10, trainPlacement: null,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign: fixtureCampaign()}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
      lifecycle: new SingleFlight(), warmRun: Promise.resolve(), campaignListeners: [], transitGap: false, mapBack: null, retired: [],
      lifecycleCounts: {generate: 0, prepare: 0, build: 0, leave: 0, travel: 0, warmup: 0, loading: 0},
      layout: null, state: 'playing',
      hud: {toast: (t: string) => log.push(`toast:${t}`)},
      trainRide: {riding: false, reset: () => log.push('rideReset')},
      leaveSection(this: {run: ReturnType<typeof createRun>}, save: boolean) { log.push(`leave:${save}:${this.run.current.station}`); },
      async prepareSection(k: SectionKey) { log.push(`prepare:${k.station}`); return {station: k.station}; },
      buildSection(this: {run: ReturnType<typeof createRun>; layout: unknown}, k: SectionKey) {
        log.push(`build:${k.station}`); this.run.current = {...k}; this.layout = {name: this.run.node(k.station)?.name ?? 'x', areas: []};
      },
      setState(this: {state: string}, st: string) { this.state = st; log.push(`state:${st}`); },
      lifecycleFailed: () => log.push('lifecycleFailed'),
      beginGesture: () => Promise.resolve(true),
      progressTo: () => () => {},
      prepareGraphics: async () => ({status: 'complete'}),
      readyLine: () => {},
      enterPlay(this: {state: string}) { log.push('enterPlay'); this.state = 'playing'; return Promise.resolve(); },
    };
    if (!o.realLoading) { s.updateStationIntro = () => {}; s.showLoading = () => ({bar: null, label: {textContent: ''}, button: null}); }
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as InstanceType<typeof Game> & {run: ReturnType<typeof createRun>; saves: SaveSlots; player: {hp: number; alive: boolean}; state: string};
    (g as unknown as {wireRunLanes(): void}).wireRunLanes();
    (g as unknown as {resetCarry(): void}).resetCarry();
    return {g, log, storage};
  }

  it('item 9: the loading screen shows ONLY the destination\'s location name (Continue: the node name; never the infected / objective text)', async () => {
    const page = fakePage();
    try {
      const {g, log} = shell(new FakeStorage(), {realLoading: true});
      expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
      g.run.campaign = {...g.run.campaign!, current: sid(1), visited: [sid(0), sid(1)]};
      g.run.current = key(1);
      expect(g.commitSave('arrival')).toMatchObject({ok: true});
      const loadsBefore = (g as unknown as {lifecycleCounts: {loading: number}}).lifecycleCounts.loading;
      expect(await g.continueCampaign(1)).toEqual({ok: true});
      const name = g.run.node(sid(1))!.name;
      expect(page.el('#station-intro').textContent).toBe(name);
      expect(page.el('#station-intro').textContent).not.toMatch(/infected|clear them out|reported|Continue/i);
      expect(page.el('#title').dataset.mode).toBe('loading'); // the progress bar's card was shown
      expect(page.el('#load .label').textContent).toMatch(/Preparing/); // the progress line is still written (hooks)
      expect((g as unknown as {lifecycleCounts: {loading: number}}).lifecycleCounts.loading).toBe(loadsBefore + 1); // perf / lifecycle hook kept
      expect(log).toContain('state:loading');
      // updateStationIntro (after the build) writes the same single line
      page.el('#station-intro').textContent = '';
      g.updateStationIntro();
      expect(page.el('#station-intro').textContent).toBe(name);
    } finally { page.restore(); }
  });

  it('item 9: loadingPlaceName — node name first, then the mall\'s / layout\'s name, then the level name', () => {
    expect(loadingPlaceName({node: {name: 'Maintenance Route'}, level: 'subway', layoutName: 'Other', levelName: 'Subway'})).toBe('Maintenance Route');
    expect(loadingPlaceName({level: 'mall', mallName: 'Harbourfront Centre', layoutName: 'Union', levelName: 'Shopping Center'})).toBe('Harbourfront Centre');
    expect(loadingPlaceName({level: 'subway', layoutName: 'Calder Park', levelName: 'Subway'})).toBe('Calder Park');
    expect(loadingPlaceName({level: 'reactor', levelName: 'Reactor'})).toBe('Reactor');
    const src = SRC('src/game.ts');
    expect(src).not.toMatch(/infected reported|Clear them out/);
  });

  /** A run saved in slot 2 (another run in slot 1, slot 3 empty), then played on and killed after the save. */
  async function savedThenDead() {
    const storage = new FakeStorage();
    const other = shell(storage);
    expect(other.g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    const {g, log} = shell(storage);
    expect(g.commitSave('new-game', {slot: 2})).toMatchObject({ok: true});
    g.run.campaign = {...g.run.campaign!, current: sid(1), visited: [sid(0), sid(1)]};
    g.run.current = key(1);
    g.player.hp = 64;
    expect(g.commitSave('arrival')).toMatchObject({ok: true});
    // progress AFTER the save (not saved), then death
    g.run.campaign = {...g.run.campaign!, current: sid(2), visited: [sid(0), sid(1), sid(2)]};
    g.run.current = key(2);
    g.player.hp = 0; g.player.alive = false; g.state = 'dead';
    log.length = 0;
    const snap = new Map(storage.map);
    return {g, log, storage, snap};
  }

  it('DEATH: "Load last save" restores the ACTIVE slot\'s latest persisted save through the main menu\'s Continue path', async () => {
    const {g, log, storage, snap} = await savedThenDead();
    const st = g.lastSaveStatus();
    expect(st).toMatchObject({ok: true, slot: 2, meta: {reason: 'arrival', station: g.run.node(sid(1))!.name}});
    expect(lastSaveNote(st)).toMatch(/^Last save: .* \(slot 2\)\.$/);
    const spy = vi.spyOn(Game.prototype, 'continueCampaign');
    try {
      expect(await g.loadLastSave()).toEqual({ok: true});
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(2); // the same code path as the menu's Continue (MenuHost.continueGame -> continueCampaign)
    } finally { spy.mockRestore(); }
    // the SAVED point is back: station, visited set, health (alive again); the post-save progress is gone
    expect(g.run.campaign).toMatchObject({current: sid(1), transit: null});
    expect(g.run.campaign!.visited).not.toContain(sid(2));
    expect(g.player.hp).toBe(64);
    expect(g.player.alive).toBe(true);
    expect(g.currentSlot).toBe(2);
    expect(log.filter(l => /^(prepare|leave|build)/.test(l))).toEqual(['prepare:st-01', 'leave:false:st-02', 'build:st-01']);
    expect(log).toContain('enterPlay');
    // nothing was written over or erased: every slot byte-identical (the dead state was never saved); only the Continue pointer
    for (let n = 1; n <= SAVE_SLOTS; n++) expect(storage.map.get(STORAGE_KEYS.slot(n))).toBe(snap.get(STORAGE_KEYS.slot(n)));
    expect(storage.map.get(STORAGE_KEYS.slot(3))).toBeUndefined();
    expect(storage.map.get(STORAGE_KEYS.lastSlot)).toBe('2');
  });

  it('DEATH: no valid save -> an honest refusal, nothing loaded, nothing written; never a New Game', async () => {
    const spy = vi.spyOn(Game.prototype, 'continueCampaign');
    const newGame = vi.spyOn(Game.prototype, 'newGame');
    try {
      // a run never bound to a slot
      const a = shell();
      expect(a.g.lastSaveStatus()).toMatchObject({ok: false, reason: 'no-slot'});
      expect(await a.g.loadLastSave()).toEqual({ok: false, error: 'This run has no save to load.'});
      expect(a.storage.writes).toBe(0);
      // the active slot corrupted (another tab / a damaged write): short, accurate, the slot left as it is
      const b = await savedThenDead();
      b.storage.map.set(STORAGE_KEYS.slot(2), '{"broken":');
      const st = b.g.lastSaveStatus();
      expect(st).toMatchObject({ok: false, reason: 'invalid'});
      expect((st as {message: string}).message).toMatch(/^The save in slot 2 cannot be loaded/);
      expect((await b.g.loadLastSave()).ok).toBe(false);
      expect(b.storage.map.get(STORAGE_KEYS.slot(2))).toBe('{"broken":');
      expect(b.storage.map.get(STORAGE_KEYS.slot(1))).toBe(b.snap.get(STORAGE_KEYS.slot(1)));
      // the slot deleted meanwhile
      const c = await savedThenDead();
      c.storage.map.delete(STORAGE_KEYS.slot(2));
      expect(c.g.lastSaveStatus()).toMatchObject({ok: false, reason: 'empty', message: 'Save slot 2 is empty.'});
      // storage blocked
      const d = await savedThenDead();
      d.storage.disabled = true;
      expect(d.g.lastSaveStatus()).toMatchObject({ok: false, reason: 'unavailable', message: 'Saves are unavailable in this browser.'});
      // not a campaign run (a QA scratch run): nothing to load
      const e = shell();
      e.g.run.campaign = null;
      expect(e.g.lastSaveStatus()).toMatchObject({ok: false, reason: 'no-campaign'});
      expect(spy).not.toHaveBeenCalled();
      expect(newGame).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); newGame.mockRestore(); }
  });

  it('DEATH: the death screen says "Load last save", wires it to Game.loadLastSave, never to the in-memory Retry snapshot', () => {
    const html = SRC('index.html'), main = SRC('src/main.ts');
    expect(html).toMatch(/<button id="btn-death-load" class="primary" type="button">Load last save<\/button>/);
    expect(html).not.toMatch(/Retry level/);
    expect(main).toMatch(/\$\('#btn-death-load'\)/);
    expect(main).toMatch(/game\.loadLastSave\(\)/);
    expect(main).not.toMatch(/retryLevel\(/);
    expect(main).not.toMatch(/btn-death-retry/);
    // no hardcore / permadeath crept in
    expect(`${main}\n${SRC('src/game.ts')}`).not.toMatch(/permadeath|hardcore/i);
  });
});
