// Task studio-pause-menu-cleanup-20261115-000847-01 (the user: the pause menu was "a massive grab bag of junk, too tall and full of
// explanations of system details"): a compact main list + submenus (ui/pauseMenu.ts) over the REAL #pause markup of index.html and the
// real settings / controls forms (ui/mainMenu.ts), in the shared mini DOM. Navigation only: the forms, the store, the lighting status and
// the runtime's apply paths are the existing ones (enhanced-lighting-settings / menu-polish / ambient-occlusion-settings cover them).

import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {MiniEl, MiniText, installMiniDom} from './helpers/paperMapDom';
import {PAUSE_TITLES, PauseMenu, SETTINGS_TABS, leaveSummary, type LeaveInfo} from '../src/ui/pauseMenu';
import {mountControlsForm, mountSettingsForm, mountTutorialReset} from '../src/ui/mainMenu';
import {SettingsStore, type SettingsStorage} from '../src/ui/settingsStore';
import {renderControls} from '../src/ui/hud';

const SRC = (rel: string) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const PAUSE_HTML = /<section id="pause"[\s\S]*?<\/section>/.exec(SRC('index.html'))![0];

class MemStorage implements SettingsStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

/** The DOM bits the forms use that the shared mini DOM leaves out (as menu-polish.test.ts patches them). */
function patchMiniDom(): void {
  const P = MiniEl.prototype as unknown as Record<string, unknown>;
  const node = (n: unknown) => (typeof n === 'string' ? new MiniText(n) : n) as MiniEl | MiniText;
  P.append = function (this: MiniEl, ...ns: unknown[]) { for (const n of ns) this.appendChild(node(n)); };
  P.replaceChildren = function (this: MiniEl, ...ns: unknown[]) { for (const c of this.children) c.parent = null; this.children = []; (this as unknown as {append(...x: unknown[]): void}).append(...ns); };
  Object.defineProperty(P, 'htmlFor', {configurable: true, get() { return {add() {}}; }});
  Object.defineProperty(P, 'ownerDocument', {configurable: true, get(this: MiniEl) { return this.doc; }});
}

type Btn = MiniEl & {disabled?: boolean; value?: string};

function mountPause(o: {campaign?: boolean; aoUnavailable?: string | null; info?: LeaveInfo} = {}) {
  patchMiniDom();
  const dom = installMiniDom(1280, 720);
  dom.doc.body.innerHTML = PAUSE_HTML;
  const root = dom.doc.querySelector('#pause')!;
  root.classList.remove('hidden'); // (game.setState('paused') shows the screen)
  const q = (sel: string) => root.querySelector(sel) as Btn;
  const store = new SettingsStore(new MemStorage());
  const box = q('#pause-settings') as unknown as HTMLElement;
  const offs = [
    mountSettingsForm(box, store, {idPrefix: 'set-', viewport: () => ({w: 1280, h: 720, dpr: 1}), aoUnavailable: () => o.aoUnavailable ?? null}),
    mountTutorialReset(box, {reset() {}, persistent: true}, {idPrefix: 'set-'}),
    mountControlsForm(q('#pause-controls-form') as unknown as HTMLElement, store, {idPrefix: 'set-'}),
  ];
  renderControls(q('#controls-pause') as unknown as HTMLElement);
  // a campaign run: main.ts hides the legacy travel / new-game buttons of a scratch run
  if (o.campaign !== false) for (const id of ['#btn-travel', '#btn-travel-2', '#btn-travel-3', '#btn-travel-4', '#btn-new-game']) q(id).classList.add('hidden');
  const calls: string[] = [];
  const menu = new PauseMenu(root as unknown as HTMLElement, {
    confirmLeave: () => o.campaign !== false,
    leaveInfo: () => o.info ?? leaveSummary({slot: 1, when: '11/15/2026, 12:42:10 AM', station: 'Calder Park', reason: 'arrival'}),
    leave: () => calls.push('leave'),
  });
  // the game's own window keydown listener (player/input.ts) stands here: what reaches it can be cancelled / acted on by the game
  const reached: string[] = [];
  dom.win.addEventListener('keydown', e => reached.push(String(e.code)));
  const active = () => dom.doc.activeElement as Btn | null;
  const shown = (el: MiniEl | null) => { for (let n = el; n && n !== root; n = n.parent) if (n.classList.contains('hidden')) return false; return !!el; };
  const listed = () => root.querySelector('.pause-list')!.querySelectorAll('button').filter(b => shown(b)).map(b => b.textContent);
  const key = (code: string, o2: Record<string, unknown> = {}) => dom.key(code, o2);
  return {dom, root, q, store, menu, calls, reached, active, shown, listed, key, off: () => { for (const f of offs) f(); dom.uninstall(); }};
}

describe('the pause screen: a short main list, the status line in every view', () => {
  it('every pause opens on Paused + where + five buttons in a campaign; Resume has the focus; no explanatory copy', () => {
    const m = mountPause();
    try {
      m.menu.open();
      expect(m.menu.view).toBe('main');
      expect(m.q('#pause-title').textContent).toBe(PAUSE_TITLES.main);
      expect(m.listed()).toEqual(['Resume', 'Settings', 'Controls', 'Fullscreen', 'Main menu']);
      expect(m.active()).toBe(m.q('#btn-resume'));
      for (const v of ['settings', 'controls', 'leave']) expect(m.shown(m.q(`[data-pause-view="${v}"]`)), v).toBe(false);
      expect(m.shown(m.q('.pause-foot'))).toBe(false);
      // the main view carries no paragraphs of its own text: only the (empty) fullscreen refusal line and the hidden scratch-run confirms
      const main = m.q('[data-pause-view="main"]');
      const texts = main.querySelectorAll('p').filter(p => m.shown(p)).map(p => p.textContent);
      expect(texts).toEqual(['']);
      // the settings, the controls, the recorder and the bindings are NOT on this screen any more
      for (const sel of ['#pause-settings', '#pause-controls-form', '#controls-pause', '#pause-perf']) expect(m.shown(m.q(sel)), sel).toBe(false);
    } finally { m.off(); }
  });

  it('the header status line is the FIRST `#pause .fine` (game.ts writes warm-up / relight / mouse-capture lines there) and no view hides it', () => {
    const m = mountPause();
    try {
      const status = m.q('.pause-status');
      expect(m.root.querySelector('.fine')).toBe(status);
      expect(status.closest('[data-pause-view]')).toBe(null);
      expect(status.getAttribute('role')).toBe('status');
      for (const v of ['main', 'settings', 'controls', 'leave'] as const) {
        if (v === 'main') m.menu.open(); else m.menu.show(v);
        expect(m.shown(status), v).toBe(true);
      }
      // Resume keeps its id (game.ts holds it while a warm-up / relight runs) and is the main list's first button
      expect(m.root.querySelector('.pause-list button')).toBe(m.q('#btn-resume'));
    } finally { m.off(); }
  });

  it('the main list: arrows move through the SHOWN, enabled buttons (wrapping; Home / End); a held Resume is skipped', () => {
    const m = mountPause();
    try {
      m.menu.open();
      const seq: string[] = [];
      for (let i = 0; i < 6; i++) { const e = m.key('ArrowDown'); expect(e.defaultPrevented).toBe(true); seq.push(m.active()!.textContent); }
      expect(seq).toEqual(['Settings', 'Controls', 'Fullscreen', 'Main menu', 'Resume', 'Settings']);
      m.key('ArrowUp'); m.key('ArrowUp');
      expect(m.active()!.textContent).toBe('Main menu');
      m.key('Home');
      expect(m.active()).toBe(m.q('#btn-resume'));
      m.key('End');
      expect(m.active()).toBe(m.q('#btn-main-menu'));
      expect(m.reached).toEqual([]); // none of these reached the game's listener (it cancels arrows for the game)
      // a warm-up holds Resume (game.ts disables it): a fresh pause starts on Settings, the arrows skip Resume
      m.q('#btn-resume').disabled = true;
      m.menu.open();
      expect(m.active()).toBe(m.q('#btn-pause-settings'));
      m.key('ArrowUp');
      expect(m.active()).toBe(m.q('#btn-main-menu'));
    } finally { m.off(); }
  });

  it('a scratch (non-campaign) run keeps its travel / new-game buttons in the list and leaves at once (never saved)', () => {
    const m = mountPause({campaign: false});
    try {
      m.menu.open();
      expect(m.listed()).toEqual(['Resume', 'Settings', 'Controls', 'Fullscreen', 'Travel to Office Space', 'Travel to the Shopping Center', 'Travel to the Reactor', 'Travel to Skyways', 'New game', 'Main menu']);
      m.dom.click(m.q('#btn-main-menu'));
      expect(m.calls).toEqual(['leave']);
      expect(m.menu.view).toBe('main');
    } finally { m.off(); }
  });
});

describe('Settings: four tabs over the one settings form', () => {
  it('opens on the last tab with the focus on it; arrows / Home / End switch tabs (roving tabindex); Performance swaps the panel', () => {
    const m = mountPause();
    try {
      m.menu.open();
      m.q('#btn-pause-settings').focus();
      m.dom.click(m.q('#btn-pause-settings'));
      expect(m.menu.view).toBe('settings');
      expect(m.q('#pause-title').textContent).toBe('Settings');
      expect(m.shown(m.q('#pause-run'))).toBe(false); // (the station line belongs to the main list)
      expect(m.shown(m.q('.pause-foot'))).toBe(true);
      const tabs = m.root.querySelectorAll('[role="tab"]');
      expect(tabs.map(t => t.textContent)).toEqual(['Graphics', 'Audio', 'Gameplay', 'Performance']);
      expect(tabs.map(t => t.getAttribute('data-tab'))).toEqual([...SETTINGS_TABS]);
      expect(m.active()).toBe(tabs[0]);
      const state = () => tabs.map(t => `${t.getAttribute('aria-selected')}/${t.getAttribute('tabindex')}`);
      expect(state()).toEqual(['true/0', 'false/-1', 'false/-1', 'false/-1']);
      expect(m.q('#pause-settings').getAttribute('data-show')).toBe('graphics');
      m.key('ArrowRight');
      expect(m.menu.tab).toBe('audio');
      expect(m.active()).toBe(tabs[1]);
      expect(m.q('#pause-settings').getAttribute('data-show')).toBe('audio');
      expect(m.shown(m.q('.pause-details'))).toBe(false); // (only Graphics has details)
      m.key('End');
      expect(m.menu.tab).toBe('performance');
      expect(m.shown(m.q('#pause-settings'))).toBe(false);
      expect(m.shown(m.q('#pause-perf'))).toBe(true);
      expect(m.q('#pause-perf').querySelector('#seed-line')).not.toBe(null); // the run codes moved here
      m.key('ArrowRight'); // wraps
      expect(m.menu.tab).toBe('graphics');
      m.key('ArrowLeft');
      expect(m.menu.tab).toBe('performance');
      m.dom.click(tabs[2]);
      expect(m.menu.tab).toBe('gameplay');
      expect(state()).toEqual(['false/-1', 'false/-1', 'true/0', 'false/-1']);
      expect(m.reached).toEqual([]);
      // Esc: back to the main list, focus on Settings; the tab is remembered for the next visit (also across a new pause)
      const e = m.key('Escape');
      expect(e.defaultPrevented).toBe(true);
      expect(m.menu.view).toBe('main');
      expect(m.active()).toBe(m.q('#btn-pause-settings'));
      expect(m.reached).toEqual([]); // (QA: Esc on the main list resumes — a submenu's Esc must not)
      m.menu.open();
      m.menu.show('settings');
      expect(m.menu.tab).toBe('gameplay');
      expect(m.active()).toBe(tabs[2]);
    } finally { m.off(); }
  });

  it('every row of the form sits on exactly one tab (data-group); the store note shows on all of them', () => {
    const m = mountPause();
    try {
      const want: Record<string, string> = {
        'set-fov': 'gameplay', 'set-sway': 'gameplay', 'set-reset-tutorials': 'gameplay', 'set-tutorials-note': 'gameplay',
        'set-vol': 'audio', 'set-mute': 'audio',
        'set-quality': 'graphics', 'set-quality-help': 'graphics', 'set-res': 'graphics', 'set-res-readout': 'graphics', 'set-ao': 'graphics', 'set-ao-help': 'graphics',
        'set-lighting': 'graphics', 'set-lighting-help': 'graphics', 'set-reflections': 'graphics', 'set-reflections-help': 'graphics',
        'set-lighting-cache': 'graphics', 'set-lighting-cache-clear': 'graphics',
      };
      const box = m.q('#pause-settings');
      const rowOf = (el: MiniEl) => { let n = el; while (n.parent && n.parent !== box) n = n.parent; return n; };
      for (const [id, group] of Object.entries(want)) {
        const el = box.querySelector(`#${id}`);
        expect(el, id).not.toBe(null);
        expect(rowOf(el!).getAttribute('data-group'), id).toBe(group);
      }
      const untagged = box.elements.filter(e => !e.getAttribute('data-group'));
      expect(untagged.map(e => e.className)).toEqual(['set-note']); // the store's "could not be saved / were reset" note only
      expect(new Set(box.elements.map(e => e.getAttribute('data-group')).filter(Boolean))).toEqual(new Set(['graphics', 'audio', 'gameplay']));
      // the Controls form is not split (its own view)
      expect(m.q('#pause-controls-form').elements.some(e => e.getAttribute('data-group'))).toBe(false);
    } finally { m.off(); }
  });

  it('Graphics: technical read-outs wait behind "Show details"; the live lighting status and every warning stay visible', () => {
    const m = mountPause();
    try {
      const box = m.q('#pause-settings');
      const detail = (id: string) => box.querySelector(`#${id}`)!.classList.contains('set-detail');
      expect(['set-quality-help', 'set-res-readout', 'set-ao-help', 'set-lighting-cache'].filter(detail)).toEqual(['set-quality-help', 'set-res-readout', 'set-ao-help', 'set-lighting-cache']);
      for (const id of ['set-lighting-help', 'set-reflections-help']) expect(detail(id), id).toBe(false); // requested / effective / pending / applying / error
      expect(box.querySelectorAll('.set-note').filter(n => !n.id).every(n => !n.classList.contains('set-detail'))).toBe(true);
      expect(box.querySelector('#set-lighting-cache-clear')!.parentElement!.classList.contains('set-detail')).toBe(false); // the button stays
      m.menu.show('settings');
      m.menu.setTab('graphics');
      const toggle = m.q('#pause-details');
      expect([toggle.textContent, toggle.getAttribute('aria-expanded'), box.classList.contains('show-details')]).toEqual(['Show details', 'false', false]);
      m.dom.click(toggle);
      expect([toggle.textContent, toggle.getAttribute('aria-expanded'), box.classList.contains('show-details')]).toEqual(['Hide details', 'true', true]);
      expect(m.menu.details).toBe(true);
      m.menu.back(); m.menu.open(); m.menu.show('settings');
      expect(box.classList.contains('show-details')).toBe(true); // (kept for the session)
      m.dom.click(toggle);
      expect(box.classList.contains('show-details')).toBe(false);
    } finally { m.off(); }
  });

  it('an ambient occlusion that cannot run here is a warning, not a detail', () => {
    const m = mountPause({aoUnavailable: 'the fog pass is off'});
    try {
      const help = m.q('#set-ao-help');
      expect(help.textContent).toBe('Unavailable here: the fog pass is off');
      expect(help.classList.contains('set-detail')).toBe(false);
    } finally { m.off(); }
  });

  it('keys inside the menu keep their native job (Tab, Space, a slider / select step) and never reach the game listener; M still does', () => {
    const m = mountPause();
    try {
      m.menu.show('settings');
      m.menu.setTab('graphics', true);
      for (const code of ['Tab', 'Space', 'Enter']) expect(m.key(code).defaultPrevented, code).toBe(false);
      const res = m.q('#set-res'), quality = m.q('#set-quality');
      res.focus();
      for (const code of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp']) expect(m.key(code).defaultPrevented, code).toBe(false);
      quality.focus();
      for (const code of ['ArrowDown', 'ArrowUp', 'Space']) expect(m.key(code).defaultPrevented, code).toBe(false);
      expect(m.reached).toEqual([]);
      m.key('KeyM'); // (the mute key works in the pause, as before)
      expect(m.reached).toEqual(['KeyM']);
      // Esc from a control inside the form: back to the main list
      quality.focus();
      expect(m.key('Escape').defaultPrevented).toBe(true);
      expect(m.menu.view).toBe('main');
      expect(m.reached).toEqual(['KeyM']);
    } finally { m.off(); }
  });
});

describe('Controls, Leave and the backdrop', () => {
  it('Controls: the input preferences first (focus on the sensitivity slider), then the bindings; Back returns to Controls', () => {
    const m = mountPause();
    try {
      m.menu.open();
      m.q('#btn-pause-controls').focus();
      m.dom.click(m.q('#btn-pause-controls'));
      expect(m.menu.view).toBe('controls');
      expect(m.q('#pause-title').textContent).toBe('Controls');
      expect(m.active()).toBe(m.q('#set-sens'));
      expect(m.shown(m.q('#controls-pause'))).toBe(true);
      expect(m.q('#controls-pause').elements.length).toBeGreaterThan(10);
      const back = m.q('.pause-foot [data-pause-back]');
      expect(back.textContent).toBe('Back');
      expect(back.getAttribute('aria-keyshortcuts')).toBe('Escape');
      m.dom.click(back);
      expect(m.menu.view).toBe('main');
      expect(m.active()).toBe(m.q('#btn-pause-controls'));
    } finally { m.off(); }
  });

  it('Main menu in a campaign asks first: what the last save holds, what is lost; Cancel has the focus; Leave leaves', () => {
    const m = mountPause();
    try {
      m.menu.open();
      m.q('#btn-main-menu').focus();
      m.dom.click(m.q('#btn-main-menu'));
      expect(m.calls).toEqual([]);
      expect(m.menu.view).toBe('leave');
      expect(m.q('#pause-title').textContent).toBe('Leave to the main menu?');
      expect(m.q('#pause-leave-save').textContent).toBe('Last save: 11/15/2026, 12:42:10 AM at Calder Park (slot 1, autosave on arrival).');
      expect(m.q('#pause-leave-warn').textContent).toBe('Progress since then will be lost.');
      expect(m.q('#pause-leave-hint').textContent).toMatch(/autosaves when the train departs and arrives; the Save terminal/);
      expect(m.active()!.textContent).toBe('Cancel'); // (a destructive default never sits under Enter)
      expect(m.shown(m.q('.pause-foot'))).toBe(false);
      m.key('ArrowLeft');
      expect(m.active()).toBe(m.q('#btn-leave-go'));
      m.key('Escape');
      expect(m.menu.view).toBe('main');
      expect(m.active()).toBe(m.q('#btn-main-menu'));
      expect(m.calls).toEqual([]);
      m.dom.click(m.q('#btn-main-menu'));
      m.dom.click(m.q('#btn-leave-go'));
      expect(m.calls).toEqual(['leave']);
    } finally { m.off(); }
  });

  it('the confirmation copy is truthful with and without a save', () => {
    expect(leaveSummary(null)).toEqual({save: 'This run has no save yet.', warning: 'Leaving now loses it.'});
    expect(leaveSummary({slot: 2, when: 'W', station: 'S', reason: 'manual'}).save).toBe('Last save: W at S (slot 2, Save terminal).');
    expect(leaveSummary({slot: 3, when: 'W', station: 'S', reason: 'departure'}).save).toBe('Last save: W at S (slot 3, autosave on departure).');
    expect(leaveSummary({slot: 3, when: 'W', station: 'S', reason: 'odd'}).save).toBe('Last save: W at S (slot 3, odd).');
    for (const l of [leaveSummary(null), leaveSummary({slot: 1, when: 'W', station: 'S', reason: 'arrival'})]) expect(l.warning).toMatch(/lose|lost/);
  });

  it('a fresh pause always opens on the main list, whatever submenu was open', () => {
    const m = mountPause();
    try {
      for (const v of ['settings', 'controls', 'leave'] as const) {
        m.menu.show(v);
        m.menu.open();
        expect(m.menu.view).toBe('main');
        expect(m.active()).toBe(m.q('#btn-resume'));
      }
      expect(m.menu.back()).toBe(false); // nothing above the main list
    } finally { m.off(); }
  });

  it('focus left on the page (a click on the backdrop): Esc still goes back, Tab / arrows bring the focus back into the menu', () => {
    const m = mountPause();
    try {
      m.menu.open();
      m.menu.show('controls');
      m.dom.doc.body.focus();
      m.dom.doc.activeElement = m.dom.doc.body;
      expect(m.key('Tab').defaultPrevented).toBe(true);
      expect(m.active()).toBe(m.q('#set-sens'));
      m.dom.doc.activeElement = m.dom.doc.body;
      m.key('Escape');
      expect(m.menu.view).toBe('main');
      expect(m.reached).toEqual([]);
      // on the main list Esc goes on to the game (the QA resume); with the screen hidden the menu takes no keys at all
      m.dom.doc.activeElement = m.dom.doc.body;
      m.key('Escape');
      expect(m.reached).toEqual(['Escape']);
      m.root.classList.add('hidden');
      m.key('Tab');
      expect(m.reached).toEqual(['Escape', 'Tab']);
    } finally { m.off(); }
  });
});

describe('wiring (main.ts / game.ts / index.html)', () => {
  const main = SRC('src/main.ts'), game = SRC('src/game.ts'), html = SRC('index.html');

  it('main.ts opens the main list on every new pause and leaves through Game.returnToMenu in a campaign', () => {
    expect(main).toMatch(/const pauseMenu = new PauseMenu\(\$\('#pause'\), \{/);
    expect(main).toMatch(/game\.stateListeners\.push\(\(s: GameState, prev: GameState\) => \{ if \(s === 'paused' && prev !== 'paused'\) pauseMenu\.open\(\); \}\);/);
    expect(main).toMatch(/confirmLeave: \(\) => !!game\.run\.campaign,/);
    expect(main).toMatch(/if \(game\.run\.campaign\) game\.returnToMenu\(\); else game\.setState\('title'\);/);
    expect(main).not.toMatch(/mainMenuButton\('#pause'/); // (the pause's Main menu is static markup now; the death screen keeps its own)
    expect(main).toMatch(/toMenu\(mainMenuButton\('#death', 'btn-death-menu'\)\);/);
    expect(main).toMatch(/recorder\.mountPanel\(document\.querySelector<HTMLElement>\('#pause-perf'\), \{idPrefix: 'pause-', before: document\.getElementById\('seed-line'\)\}\);/);
  });

  it('game.ts: the status line is empty unless something needs saying; warm-ups still report there and hold Resume', () => {
    expect(game).toMatch(/\$\('#pause \.fine'\)\.textContent = ok \? '' : 'The browser did not capture the mouse — click Resume to try again\.';/);
    expect(game).not.toMatch(/Combat is frozen/);
    expect(game).toMatch(/const line = \$\('#pause \.fine'\), resume = \$\('#btn-resume'\) as HTMLButtonElement;/);
    expect(game).not.toMatch(/reloading the page always starts a new run/); // (untrue since the campaign saves)
  });

  it('index.html: one Main menu button, the views in order, ids kept for the game and the QA scripts', () => {
    expect(html.match(/id="btn-main-menu"/g)).toHaveLength(1);
    const at = (s: string) => html.indexOf(s);
    expect(at('data-pause-view="main"')).toBeLessThan(at('data-pause-view="settings"'));
    expect(at('data-pause-view="settings"')).toBeLessThan(at('data-pause-view="controls"'));
    expect(at('data-pause-view="controls"')).toBeLessThan(at('data-pause-view="leave"'));
    for (const id of ['btn-resume', 'pause-run', 'pause-settings', 'pause-controls-form', 'controls-pause', 'seed-line', 'confirm-travel', 'confirm-new']) expect(PAUSE_HTML, id).toContain(`id="${id}"`);
    expect(PAUSE_HTML).not.toMatch(/Combat is frozen|<h3 class="pause-sub">/);
  });
});
