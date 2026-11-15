// Task studio-settings-menu-parity-20261115-191601-01: ONE Settings presentation (ui/settingsTabs.ts) for the main menu's Settings dialog
// and the pause menu's Settings view — the same tabs, groups, details toggle and Performance tab over the one settings form — and a tab
// strip that cannot overflow. The real MainMenuView / PauseMenu over the shared mini DOM (index.html's real #pause markup); the pixel
// sizes themselves were measured in a browser (the task's QA), these tests pin the structure and the CSS that produces them.

import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {MiniEl, MiniEvent, MiniText, installMiniDom} from './helpers/paperMapDom';
import {SETTINGS_TABS, SETTINGS_TAB_LABELS, SettingsTabs, buildSettingsTabs} from '../src/ui/settingsTabs';
import {MainMenuController, MainMenuView, mountControlsForm, mountSettingsForm, mountTutorialReset, type ImportResult, type MenuHost, type SlotView} from '../src/ui/mainMenu';
import {PauseMenu, leaveSummary} from '../src/ui/pauseMenu';
import {SettingsStore, type SettingsStorage} from '../src/ui/settingsStore';
import {CONTROLS} from '../src/ui/hud';

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const PAUSE_HTML = /<section id="pause"[\s\S]*?<\/section>/.exec(SRC('index.html'))![0];

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

class Host implements MenuHost {
  listSlots(): SlotView[] { return [0, 1, 2].map(slot => ({slot, empty: true, valid: false})); }
  lastSlot(): number | null { return null; }
  newGame(): Promise<void> { return Promise.resolve(); }
  continueGame(): Promise<void> { return Promise.resolve(); }
  exportSlot(): void {}
  importFile(): Promise<ImportResult> { return Promise.resolve({ok: true}); }
  deleteSlot(): void {}
}

/** The DOM bits the menu view / forms use that the shared mini DOM leaves out (as menu-polish.test.ts patches them). */
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

const shown = (el: MiniEl | null) => { for (let n = el; n; n = n.parent) if (n.classList.contains('hidden')) return false; return !!el; };

/** The main menu (#title > .mm-side > #mm-view) with the real view, settings form and tutorial reset; a stand-in recorder panel. */
function mountTitle(o: {performance?: boolean} = {}) {
  patchMiniDom();
  const dom = installMiniDom(1280, 720);
  dom.doc.body.innerHTML = '<section id="title" class="screen" data-mode="menu"><div class="mm-side" id="main-menu"><div id="mm-view"></div></div></section>';
  const title = dom.doc.querySelector('#title')!, root = dom.doc.querySelector('#mm-view')!;
  const store = new SettingsStore(new MemStorage());
  const ctl = new MainMenuController(new Host(), {controls: CONTROLS});
  ctl.setBoot(true, 1);
  const view = new MainMenuView(root as unknown as HTMLElement, ctl, {
    overlayHost: title as unknown as HTMLElement,
    settings: box => {
      mountSettingsForm(box, store, {idPrefix: 'mm-set-', viewport: () => ({w: 1280, h: 720, dpr: 1})});
      mountTutorialReset(box, {reset() {}, persistent: true}, {idPrefix: 'mm-set-'});
    },
    performance: o.performance === false ? undefined : box => { const p = dom.doc.createElement('div'); p.id = 'mm-perf-rec'; p.className = 'perf-rec'; (box as unknown as MiniEl).appendChild(p); },
    controlsForm: box => { mountControlsForm(box, store, {idPrefix: 'mm-set-'}); },
  });
  const dialog = title.querySelector('.mm-dialog')!;
  const btn = (id: string) => (ctl.view !== 'main' ? dialog : root).querySelector(`[data-action="${id}"]`);
  // a browser click focuses the button first (focusin: the view tells the controller), then clicks it
  const press = (el: MiniEl | null) => { if (!el) throw new Error('no such button'); el.focus(); el.dispatchEvent(new MiniEvent('focusin')); dom.click(el); };
  const q = (sel: string) => dialog.querySelector(sel)!;
  const active = () => dom.doc.activeElement;
  return {dom, title, root, dialog, ctl, view, store, btn, press, q, active};
}

describe('the main menu\'s Settings = the pause menu\'s Settings presentation', () => {
  it('four tabs over the one form, the selected tab focused; the rows scroll under the tabs and Back stays pinned under them', () => {
    const m = mountTitle();
    try {
      m.press(m.btn('settings'));
      expect(m.ctl.view).toBe('settings');
      expect(m.dialog.getAttribute('data-view')).toBe('settings');
      expect(m.dialog.querySelector('h2')!.textContent).toBe('Settings');
      const tabs = m.dialog.querySelectorAll('[role="tab"]');
      expect(tabs.map(t => t.textContent)).toEqual(['Graphics', 'Audio', 'Gameplay', 'Performance']);
      expect(tabs.map(t => t.id)).toEqual(['mm-tab-graphics', 'mm-tab-audio', 'mm-tab-gameplay', 'mm-tab-performance']);
      expect(tabs.map(t => `${t.getAttribute('aria-selected')}/${t.getAttribute('tabindex')}`)).toEqual(['true/0', 'false/-1', 'false/-1', 'false/-1']);
      expect(m.active()).toBe(tabs[0]);
      const view = m.q('.set-tabbed'), form = m.q('#mm-settings');
      expect(shown(view)).toBe(true);
      expect(view.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Settings');
      expect(form.getAttribute('data-show')).toBe('graphics');
      expect(form.getAttribute('aria-labelledby')).toBe('mm-tab-graphics');
      expect(form.querySelector('#mm-set-quality')).not.toBe(null); // the real form, mounted into the tab panel
      expect(form.parentElement!.classList.contains('set-body')).toBe(true); // (the scroller)
      // the dialog: stripe, title, the Settings view, (hidden Controls boxes), then the Back row — outside the scroller
      expect(m.dialog.elements.map(e => e.className.split(' ')[0])).toEqual(['stripe', 'mm-view', 'set-tabbed', 'mm-settings', 'mm-controls', 'mm-body']);
      const back = m.btn('back')!;
      expect(back.closest('.mm-body')).toBe(m.dialog.elements[5]);
      expect(back.textContent).toBe('Back');
      expect(back.getAttribute('aria-keyshortcuts')).toBe('Escape');
      expect(back.parentElement!.querySelector('.mm-keyhint')!.textContent).toBe('Esc back');
      // the Controls view keeps its own layout (no tabs, no key hint)
      m.press(back);
      m.press(m.btn('controls'));
      expect(shown(m.q('.set-tabbed'))).toBe(false);
      expect(m.dialog.querySelector('.mm-keyhint')).toBe(null);
    } finally { m.dom.uninstall(); }
  });

  it('keyboard: Left / Right / Home / End switch the tab (wrapping), Up / Down stay on it; Esc goes back to Settings in the main list', () => {
    const m = mountTitle();
    try {
      m.press(m.btn('settings'));
      const tabs = m.dialog.querySelectorAll('[role="tab"]'), form = m.q('#mm-settings'), perf = m.q('#mm-perf');
      let e = m.dom.key('ArrowRight');
      expect(e.defaultPrevented).toBe(true);
      expect(m.view.settingsTabs.tab).toBe('audio');
      expect(m.active()).toBe(tabs[1]);
      expect(form.getAttribute('data-show')).toBe('audio');
      e = m.dom.key('ArrowDown'); // (never off to Back)
      expect(m.active()).toBe(tabs[1]);
      m.dom.key('End');
      expect(m.view.settingsTabs.tab).toBe('performance');
      expect(shown(form)).toBe(false);
      expect(shown(perf)).toBe(true);
      expect(perf.querySelector('#mm-perf-rec')).not.toBe(null); // the recorder panel lives on the Performance tab
      m.dom.key('ArrowRight'); // wraps
      expect(m.view.settingsTabs.tab).toBe('graphics');
      m.dom.key('ArrowLeft');
      expect(m.active()).toBe(tabs[3]);
      m.dom.key('Home');
      expect(m.active()).toBe(tabs[0]);
      m.dom.click(tabs[2]); // a mouse click selects too
      expect(m.view.settingsTabs.tab).toBe('gameplay');
      expect(form.getAttribute('data-show')).toBe('gameplay');
      // Esc: back to the main list, the focus on Settings; the tab is remembered for the next visit
      tabs[2].focus();
      expect(m.dom.key('Escape').defaultPrevented).toBe(true);
      expect(m.ctl.view).toBe('main');
      expect(m.active()?.getAttribute('data-action')).toBe('settings');
      m.press(m.btn('settings'));
      expect(m.active()).toBe(tabs[2]);
      // a control's own keys stay native; Esc from inside the form still steps back
      const sway = m.q('#mm-set-sway');
      sway.focus();
      expect(m.dom.key('ArrowLeft').defaultPrevented).toBe(false);
      expect(m.view.settingsTabs.tab).toBe('gameplay');
      m.dom.key('Escape');
      expect(m.ctl.view).toBe('main');
    } finally { m.dom.uninstall(); }
  });

  it('Graphics keeps the technical read-outs behind "Show details"; the live lighting status and warnings stay visible', () => {
    const m = mountTitle();
    try {
      m.press(m.btn('settings'));
      const form = m.q('#mm-settings'), toggle = m.q('#mm-details');
      const detail = (id: string) => form.querySelector(`#${id}`)!.classList.contains('set-detail');
      expect(['mm-set-quality-help', 'mm-set-res-readout', 'mm-set-ao-help', 'mm-set-lighting-cache'].every(detail)).toBe(true);
      for (const id of ['mm-set-lighting-help', 'mm-set-reflections-help']) expect(detail(id), id).toBe(false);
      expect([toggle.textContent, toggle.getAttribute('aria-expanded'), toggle.getAttribute('aria-controls'), form.classList.contains('show-details')]).toEqual(['Show details', 'false', 'mm-settings', false]);
      m.dom.click(toggle);
      expect([toggle.textContent, toggle.getAttribute('aria-expanded'), form.classList.contains('show-details')]).toEqual(['Hide details', 'true', true]);
      m.view.settingsTabs.setTab('audio');
      expect(shown(toggle)).toBe(false); // (only Graphics has details)
      m.view.settingsTabs.setTab('graphics');
      expect(shown(toggle)).toBe(true);
      // every row of the title's form sits on a tab: the store's note (untagged) is the only row shown on all of them
      expect(form.elements.filter(e => !e.getAttribute('data-group')).map(e => e.className)).toEqual(['set-note']);
    } finally { m.dom.uninstall(); }
  });

  it('without a Performance mount there is no Performance tab (End stops at Gameplay)', () => {
    const m = mountTitle({performance: false});
    try {
      m.press(m.btn('settings'));
      expect(m.dialog.querySelectorAll('[role="tab"]').map(t => t.textContent)).toEqual(['Graphics', 'Audio', 'Gameplay']);
      expect(m.dialog.querySelector('#mm-perf')).toBe(null);
      m.dom.key('End');
      expect(m.view.settingsTabs.tab).toBe('gameplay');
      m.view.settingsTabs.setTab('performance');
      expect(m.view.settingsTabs.tab).toBe('gameplay');
    } finally { m.dom.uninstall(); }
  });
});

describe('one presentation in both places', () => {
  /** The structure that matters (tags, ids, roles, aria, tab data, the shared classes, button text) in tree order. */
  const shape = (root: MiniEl, skip: (e: MiniEl) => boolean) => {
    const out: string[] = [];
    const walk = (e: MiniEl) => {
      for (const c of e.elements) {
        if (skip(c)) continue;
        const cls = c.className.split(/\s+/).filter(k => k === 'settings' || k.startsWith('set-')).sort().join('.');
        const at = ['id', 'type', 'role', 'data-tab', 'aria-label', 'aria-controls', 'aria-labelledby', 'aria-expanded'].map(k => (c.hasAttribute(k) ? `${k}=${c.getAttribute(k)}` : '')).filter(Boolean);
        out.push([c.tagName, cls, ...at, c.tagName === 'BUTTON' ? `"${c.textContent}"` : ''].join(' ').trim());
        walk(c);
      }
    };
    walk(root);
    return out;
  };

  it('buildSettingsTabs makes the pause view\'s markup (index.html) — the same tabs, panels, ids (by prefix) and aria', () => {
    patchMiniDom();
    const dom = installMiniDom();
    try {
      dom.doc.body.innerHTML = PAUSE_HTML;
      const pause = dom.doc.querySelector('[data-pause-view="settings"]')!;
      expect(pause.classList.contains('set-tabbed')).toBe(true);
      const built = buildSettingsTabs(dom.doc as unknown as Document, {idPrefix: 'pause-'});
      const box = dom.doc.createElement('div');
      box.appendChild(built.view as unknown as MiniEl);
      const want = shape(pause, e => e.id === 'seed-line'); // (the run codes: the pause's own Performance content)
      expect(shape(box, () => false).slice(1)).toEqual(want);
      expect(want.length).toBeGreaterThan(8);
      expect(SETTINGS_TABS.map(t => SETTINGS_TAB_LABELS[t])).toEqual(['Graphics', 'Audio', 'Gameplay', 'Performance']);
    } finally { dom.uninstall(); }
  });

  it('both screens drive their tabs with the one SettingsTabs and its one stylesheet; neither keeps a tab or form look of its own', () => {
    const t = mountTitle();
    try {
      t.dom.doc.body.appendChild((() => { const s = t.dom.doc.createElement('div'); s.innerHTML = PAUSE_HTML; return s; })());
      const pause = new PauseMenu(t.dom.doc.querySelector('#pause') as unknown as HTMLElement, {confirmLeave: () => true, leaveInfo: () => leaveSummary(null), leave: () => {}});
      expect(pause.settings).toBeInstanceOf(SettingsTabs);
      expect(t.view.settingsTabs).toBeInstanceOf(SettingsTabs);
      expect(t.dom.doc.head.querySelectorAll('#settings-tabs-css')).toHaveLength(1);
      // the two keep their own state (a tab chosen in the pause does not move the title's)
      pause.setTab('audio');
      expect(t.view.settingsTabs.tab).toBe('graphics');
    } finally { t.dom.uninstall(); }
    const pauseSrc = SRC('src/ui/pauseMenu.ts'), menuSrc = SRC('src/ui/mainMenu.ts');
    expect(pauseSrc).not.toMatch(/pause-tabs|pause-details|#pause \.settings|#pause-settings\[data-show/);
    expect(menuSrc).not.toMatch(/\.mm-settings\.settings/);
    // the pause's Controls form shares the form look (it lost its #pause .settings rules)
    expect(PAUSE_HTML).toMatch(/<div class="settings set-look" id="pause-controls-form"><\/div>/);
  });
});

describe('the tab strip cannot overflow (it showed a scrollbar)', () => {
  const css = () => {
    patchMiniDom();
    const dom = installMiniDom();
    try {
      dom.doc.body.innerHTML = '<div id="v"></div>';
      const v = dom.doc.querySelector('#v')!;
      v.appendChild(buildSettingsTabs(dom.doc as unknown as Document, {idPrefix: 'x-'}).view as unknown as MiniEl);
      new SettingsTabs(v as unknown as HTMLElement);
      return dom.doc.head.querySelector('#settings-tabs-css')!.textContent;
    } finally { dom.uninstall(); }
  };
  const rule = (text: string, sel: string) => { const i = text.indexOf(`${sel} {`); expect(i, sel).toBeGreaterThanOrEqual(0); return text.slice(i, text.indexOf('}', i)); };

  it('not a scroll container; the baseline is drawn inside the strip (no tab pokes 1 px out of it); narrow screens wrap the tabs', () => {
    const text = css();
    const strip = rule(text, '.set-tabbed .set-tabs'), tab = rule(text, '.set-tabbed .set-tabs [role="tab"]');
    expect(strip).not.toMatch(/overflow/);
    expect(strip).toMatch(/flex-wrap: wrap/);
    expect(strip).toMatch(/box-shadow: inset 0 -1px 0 #3a3f44/);
    expect(strip).not.toMatch(/border-bottom/);
    expect(tab).not.toMatch(/margin/); // (the old margin-bottom: -1px overlap made the content 1 px taller than the strip)
    expect(tab).toMatch(/white-space: nowrap/); // (whole labels: a tab never shrinks or clips its text)
    expect(rule(text, '.set-tabbed .set-tabs [role="tab"]:focus-visible')).toMatch(/outline-offset: -2px/); // the ring inside the tab
    expect(text).not.toMatch(/\.set-tabs[^{]*\{[^}]*overflow/);
    // the pause menu's id-scoped focus rule would put the ring outside: its own override keeps it inside
    expect(SRC('src/ui/pauseMenu.ts')).toMatch(/#pause \.set-tabs \[role="tab"\]:focus-visible \{ outline-offset: -2px; \}/);
  });

  it('the rows under the tabs never widen their column past the panel (a 360 px screen scrolled sideways by 1 px)', () => {
    const text = css();
    expect(rule(text, '.settings.set-look')).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
    expect(rule(text, '.settings.set-look input[type=range]')).toMatch(/min-width: 6em/); // (not its 160 px intrinsic minimum)
  });
});
