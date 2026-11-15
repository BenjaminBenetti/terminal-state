// Task studio-pause-menu-cleanup-20261115-000847-01: the in-game PAUSE menu (#pause, index.html) — a compact screen with submenus.
//
// The user: the pause menu was "a massive grab bag of junk, too tall and full of explanations of system details". It is now:
//  - Pause (the main list): the station, the status line, Resume / Settings / Controls / Fullscreen / Main menu (+ the legacy travel /
//    new-game buttons of a non-campaign scratch run; main.ts hides them in a campaign).
//  - Settings: Graphics / Audio / Gameplay / Performance tabs. The first three show the matching rows of the ONE settings form
//    (ui/mainMenu.ts mountSettingsForm, ids set-*: every row carries its data-group); Graphics keeps the technical read-outs (the
//    quality preset's numbers, the render buffer size, what ambient occlusion does, the lighting cache's numbers) behind "Show details"
//    — the live lighting status lines and every warning stay visible. Performance = the recorder panel and the run codes.
//  - Controls: the input preferences (mountControlsForm) and the key bindings.
//  - Leave: the Main menu confirmation of a campaign run (what the last save holds; what is lost).
// Navigation only: Esc / Back = one level up (never out of the pause from a submenu: Resume needs a click for the mouse capture), the
// arrow keys move through the button lists and the tabs, focus moves into a view and back to the button that opened it. The forms, the
// settings store, the lighting status and every apply path are untouched (the runtime holds Resume and the lighting choices while it
// rebuilds). The header's status line — the FIRST `#pause .fine`: game.ts writes warm-up / relight progress, a failed mouse capture or
// travel into it — shows in every view.
//
// Keyboard: player/input.ts cancels Tab / Space / the arrows on the window for the game, so keys meant for the menu (focus moves, a
// button press, a select or slider step) stop at the pause screen; everything else (M = mute, F8 / F9, Esc on the main list = the QA
// resume) still reaches the game.

/** The pause screen's views. */
export type PauseViewId = 'main' | 'settings' | 'controls' | 'leave';
/** The Settings view's tabs (the first three = the settings form's data-group values). */
export type SettingsTab = 'graphics' | 'audio' | 'gameplay' | 'performance';

export const SETTINGS_TABS: readonly SettingsTab[] = ['graphics', 'audio', 'gameplay', 'performance'];
export const PAUSE_TITLES: Record<PauseViewId, string> = {main: 'Paused', settings: 'Settings', controls: 'Controls', leave: 'Leave to the main menu?'};

/** The Main menu confirmation's lines (main.ts: the active slot's latest save). */
export interface LeaveInfo {
  /** What the last save holds (or that there is none). */
  save: string;
  /** What leaving loses. */
  warning: string;
  /** How to save first (optional). */
  hint?: string;
}

/** The save points (save/serialize.ts SaveReason) as the confirmation names them. */
const SAVE_WHY: Record<string, string> = {manual: 'Save terminal', 'new-game': 'new game', arrival: 'autosave on arrival', departure: 'autosave on departure', ending: 'ending', import: 'imported'};

/**
 * The Main menu confirmation of a campaign run from the active slot's latest save (null: none yet). Truthful and short: what the save
 * holds, that everything after it is lost, how to save first (the game autosaves at every departure / arrival; the train's Save
 * terminal saves on demand while the train is stopped).
 */
export function leaveSummary(last: {slot: number; when: string; station: string; reason: string} | null): LeaveInfo {
  if (!last) return {save: 'This run has no save yet.', warning: 'Leaving now loses it.'};
  return {
    save: `Last save: ${last.when} at ${last.station} (slot ${last.slot}, ${SAVE_WHY[last.reason] ?? last.reason}).`,
    warning: 'Progress since then will be lost.',
    hint: 'The game autosaves when the train departs and arrives; the Save terminal by the train\'s driving desk saves while the train is stopped.',
  };
}

export interface PauseMenuOptions {
  /** Whether Main menu asks first (a campaign run: progress since the last save is lost); false = leave at once. */
  confirmLeave: () => boolean;
  leaveInfo: () => LeaveInfo;
  /** Back to the main menu (main.ts: Game.returnToMenu, or the title for a scratch run). */
  leave: () => void;
}

/** Keys the menu keeps from the game's window listener (their browser default is what the menu needs). */
const MENU_KEYS = new Set(['Tab', 'Space', 'Enter', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
const STEP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

const CSS = `
#pause.screen { padding: 16px 16px 44px; }
#pause .pause-panel { display: flex; flex-direction: column; width: min(440px, 100%); max-height: 100%; padding: 26px 30px 18px; }
#pause .pause-panel[data-view="settings"], #pause .pause-panel[data-view="controls"] { width: min(780px, 100%); }
#pause .pause-panel[data-view="leave"] { width: min(540px, 100%); }
#pause .pause-head { flex: none; }
#pause .pause-head h2 { margin: 4px 0 2px; }
#pause .pause-where { margin: 0; color: var(--cream-dim); font-size: 15px; overflow-wrap: anywhere; }
#pause .pause-where:empty { display: none; }
#pause .pause-status { margin: 8px 0 0; color: var(--mustard); font-size: 13.5px; line-height: 1.4; }
#pause .pause-status:empty { display: none; }
#pause .pause-view { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
#pause .pause-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 6px 2px 2px; }
#pause .pause-list { flex-direction: column; flex-wrap: nowrap; gap: 8px; margin: 18px 0 4px; flex: 0 1 auto; min-height: 0; overflow-y: auto; padding: 2px; }
#pause .pause-list > button { width: 100%; text-align: left; }
#pause .fs-status { min-height: 0; margin: 6px 0 0; }
#pause .fs-status:empty { display: none; }
#pause button.danger { border-color: var(--red); color: #f1c0b8; }
#pause button.danger:hover:not(:disabled) { background: #3a2321; }
#pause button:focus { outline: none; }
#pause button:focus-visible, #pause input:focus-visible, #pause select:focus-visible { outline: 2px solid var(--mustard); outline-offset: 2px; }
#pause .pause-tabs { display: flex; flex: none; gap: 2px; margin: 14px 0 12px; border-bottom: 1px solid #3a3f44; overflow-x: auto; }
#pause .pause-tabs [role="tab"] { background: none; border: none; border-bottom: 3px solid transparent; margin-bottom: -1px; padding: 9px 14px 8px; color: var(--cream-dim); white-space: nowrap; }
#pause .pause-tabs [role="tab"]:hover:not(:disabled) { background: none; color: var(--cream); }
#pause .pause-tabs [role="tab"][aria-selected="true"] { color: var(--cream); border-bottom-color: var(--mustard); }
#pause .pause-tabs [role="tab"]:focus-visible { outline-offset: -2px; }
#pause .settings { grid-template-columns: 1fr; gap: 12px; margin: 2px 0 6px; font-size: 14px; }
#pause .settings label { min-height: 30px; gap: 14px; }
#pause .settings select { min-width: 10em; max-width: 60%; padding: 4px 6px; font-size: 14px; }
#pause .settings .set-readout { font-size: 12.5px; margin-top: -8px; line-height: 1.4; }
#pause .settings .set-note { font-size: 12.5px; }
#pause .settings .set-tutorials button, #pause .settings .set-actions button { font-size: 14px; }
#pause-settings[data-show="graphics"] [data-group]:not([data-group="graphics"]),
#pause-settings[data-show="audio"] [data-group]:not([data-group="audio"]),
#pause-settings[data-show="gameplay"] [data-group]:not([data-group="gameplay"]) { display: none; }
#pause-settings:not(.show-details) .set-detail { display: none; }
#pause .pause-details { margin: 2px 0 4px; }
#pause .pause-details button { padding: 6px 12px; font-size: 13.5px; background: none; color: var(--cream-dim); }
#pause .pause-perf .perf-rec { margin-top: 0; }
#pause .pause-perf .perf-rec > h3 { display: none; }
#pause .pause-perf #seed-line { margin: 14px 0 0; overflow-wrap: anywhere; }
#pause #pause-controls-form { margin-top: 12px; }
#pause .controls-grid { margin-top: 14px; font-size: 13.5px; }
#pause .controls-grid div { align-items: baseline; }
#pause .controls-grid kbd { flex: none; font-size: 13px; white-space: nowrap; text-align: right; }
#pause .pause-leave-save { margin: 14px 0 6px; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
#pause .pause-leave-warn { margin: 0 0 8px; font-size: 15px; font-weight: 700; color: #f0a497; }
#pause .pause-leave-warn:empty, #pause #pause-leave-hint:empty { display: none; }
#pause .pause-confirm { flex: none; margin: 14px 0 4px; }
#pause .pause-foot { flex: none; display: flex; align-items: center; gap: 14px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #3a3f44; }
#pause .pause-keyhint { font-size: 13px; color: var(--cream-dim); }
#pause .pause-keyhint kbd { font-family: var(--font); color: var(--mustard); }
@media (max-width: 560px) {
  #pause.screen { padding: 8px 8px 40px; }
  #pause .pause-panel { padding: 20px 16px 14px; }
  #pause .controls-grid { grid-template-columns: 1fr; }
  #pause .settings select { max-width: 55%; min-width: 0; }
}
@media (max-height: 520px) {
  #pause.screen { padding-top: 8px; }
  #pause .pause-panel { padding-top: 16px; padding-bottom: 12px; }
  #pause .pause-head h2 { font-size: 24px; margin-top: 2px; }
  #pause .pause-list { gap: 6px; margin-top: 10px; }
  #pause .pause-list > button { padding: 8px 18px; }
  #pause .pause-tabs { margin: 8px 0 8px; }
  #pause .pause-foot { margin-top: 8px; padding-top: 8px; }
  #pause .pause-foot button { padding: 8px 18px; }
}
`;

function injectCss(doc: Document): void {
  if (doc.getElementById('pause-menu-css')) return;
  const st = doc.createElement('style');
  st.id = 'pause-menu-css';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

const isTab = (v: unknown): v is SettingsTab => typeof v === 'string' && (SETTINGS_TABS as readonly string[]).includes(v);

/**
 * The pause screen's navigation over the static markup in index.html (#pause): the views ([data-pause-view]), the buttons that open
 * them ([data-pause-open] / [data-pause-leave] / [data-pause-back]), the Settings tabs ([role=tab][data-tab]) and the details toggle.
 * main.ts calls open() whenever the game enters the pause.
 */
export class PauseMenu {
  private viewId: PauseViewId = 'main';
  private tabId: SettingsTab = 'graphics';
  private detailsOn = false;
  private opener: HTMLElement | null = null;
  private readonly doc: Document;
  private readonly panel: HTMLElement;

  constructor(readonly root: HTMLElement, private readonly o: PauseMenuOptions) {
    this.doc = root.ownerDocument;
    injectCss(this.doc);
    this.panel = root.querySelector<HTMLElement>('.pause-panel') ?? root;
    for (const b of root.querySelectorAll<HTMLElement>('[data-pause-open]')) {
      b.addEventListener('click', () => { const v = b.getAttribute('data-pause-open'); if (v === 'settings' || v === 'controls') this.show(v); });
    }
    for (const b of root.querySelectorAll<HTMLElement>('[data-pause-back]')) b.addEventListener('click', () => { this.back(); });
    for (const b of root.querySelectorAll<HTMLElement>('[data-pause-leave]')) b.addEventListener('click', () => this.leaveRequested());
    this.el('#btn-leave-go')?.addEventListener('click', () => { if (this.viewId === 'leave') this.o.leave(); });
    for (const t of this.tabs()) t.addEventListener('click', () => { const v = t.getAttribute('data-tab'); if (isTab(v)) this.setTab(v); });
    this.el('#pause-details')?.addEventListener('click', () => { this.detailsOn = !this.detailsOn; this.render(); });
    root.addEventListener('keydown', e => this.onKey(e as KeyboardEvent));
    // a click on the dimmed backdrop leaves the focus on the page: the menu's keys still work from there
    this.doc.addEventListener('keydown', e => this.onPageKey(e as KeyboardEvent));
    this.render();
  }

  get view(): PauseViewId { return this.viewId; }
  get tab(): SettingsTab { return this.tabId; }
  get details(): boolean { return this.detailsOn; }

  /** A fresh pause: the main list, focus on its first enabled button (Resume). The Settings tab and the details choice are kept. */
  open(): void {
    this.viewId = 'main';
    this.opener = null;
    this.render();
    this.focusDefault();
  }

  /** Open a submenu (from the main list). */
  show(view: Exclude<PauseViewId, 'main'>): void {
    const ae = this.doc.activeElement as HTMLElement | null;
    if (this.viewId === 'main') this.opener = ae && this.panel.contains(ae) ? ae : null;
    if (view === 'leave') this.fillLeave();
    this.viewId = view;
    this.render();
    this.focusDefault();
  }

  /** Esc / Back: one level up. False on the main list (nothing to go back to: Resume needs a click). */
  back(): boolean {
    if (this.viewId === 'main') return false;
    this.viewId = 'main';
    this.render();
    const o = this.opener;
    this.opener = null;
    if (o && this.usable(o)) this.focus(o); else this.focusDefault();
    return true;
  }

  /** Switch the Settings tab (focus = move the focus to the tab). */
  setTab(tab: SettingsTab, focus = false): void {
    this.tabId = tab;
    this.render();
    if (focus) { const t = this.tabs().find(x => x.getAttribute('data-tab') === tab); if (t) this.focus(t); }
  }

  private leaveRequested(): void {
    if (this.o.confirmLeave()) this.show('leave');
    else this.o.leave();
  }

  private fillLeave(): void {
    const info = this.o.leaveInfo();
    const set = (sel: string, text: string) => { const e = this.el(sel); if (e) e.textContent = text; };
    set('#pause-leave-save', info.save);
    set('#pause-leave-warn', info.warning);
    set('#pause-leave-hint', info.hint ?? '');
  }

  private el(sel: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(sel);
  }

  private tabs(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('[role="tab"]')];
  }

  private viewEl(v: PauseViewId): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`[data-pause-view="${v}"]`);
  }

  render(): void {
    const v = this.viewId, tab = this.tabId;
    this.panel.setAttribute('data-view', v);
    for (const id of ['main', 'settings', 'controls', 'leave'] as const) this.viewEl(id)?.classList.toggle('hidden', id !== v);
    const title = this.el('#pause-title');
    if (title) title.textContent = PAUSE_TITLES[v];
    this.el('#pause-run')?.classList.toggle('hidden', v !== 'main');
    this.el('.pause-foot')?.classList.toggle('hidden', v !== 'settings' && v !== 'controls');
    for (const t of this.tabs()) {
      const on = t.getAttribute('data-tab') === tab;
      t.setAttribute('aria-selected', String(on));
      t.setAttribute('tabindex', on ? '0' : '-1');
    }
    const form = this.el('#pause-settings'), perf = this.el('#pause-perf');
    const formTab = tab !== 'performance';
    if (form) {
      form.classList.toggle('hidden', !formTab);
      form.setAttribute('data-show', formTab ? tab : '');
      form.setAttribute('aria-labelledby', `pause-tab-${formTab ? tab : 'graphics'}`);
      form.classList.toggle('show-details', this.detailsOn);
    }
    perf?.classList.toggle('hidden', formTab);
    const details = this.el('#pause-details');
    if (details) {
      details.parentElement?.classList.toggle('hidden', tab !== 'graphics');
      details.textContent = this.detailsOn ? 'Hide details' : 'Show details';
      details.setAttribute('aria-expanded', String(this.detailsOn));
    }
  }

  /** Whether an element can take the focus: connected to this screen, not hidden (itself or a container) and not disabled. */
  private usable(e: HTMLElement): boolean {
    if ((e as HTMLButtonElement).disabled || e.hidden) return false;
    for (let n: HTMLElement | null = e; n && n !== this.root; n = n.parentElement) if (n.classList.contains('hidden')) return false;
    return this.root.contains(e);
  }

  private focus(e: HTMLElement): void {
    e.focus({preventScroll: false});
  }

  /** The current view's starting point: the first usable main-list button / the selected tab / the first input / Cancel. */
  private focusDefault(): void {
    const v = this.viewId;
    let target: HTMLElement | undefined;
    if (v === 'main') target = this.listButtons(this.el('.pause-list')).find(b => this.usable(b));
    else if (v === 'settings') target = this.tabs().find(t => t.getAttribute('data-tab') === this.tabId);
    else if (v === 'controls') target = [...(this.viewEl('controls')?.querySelectorAll<HTMLElement>('input, select, button') ?? [])].find(b => this.usable(b));
    else target = [...(this.viewEl('leave')?.querySelectorAll<HTMLElement>('[data-pause-back]') ?? [])].find(b => this.usable(b));
    target ??= [...this.panel.querySelectorAll<HTMLElement>('button')].find(b => this.usable(b));
    if (target) this.focus(target);
  }

  private listButtons(list: Element | null): HTMLElement[] {
    return list ? [...list.querySelectorAll<HTMLElement>('button')] : [];
  }

  /** Arrow / Home / End through a vertical button list (wrapping); false when `code` is not a step. */
  private step(list: HTMLElement[], from: HTMLElement, code: string): boolean {
    const usable = list.filter(b => this.usable(b));
    if (!usable.length) return false;
    const i = Math.max(0, usable.indexOf(from));
    const n = usable.length;
    const next = code === 'Home' ? 0 : code === 'End' ? n - 1
      : code === 'ArrowDown' || code === 'ArrowRight' ? (i + 1) % n : code === 'ArrowUp' || code === 'ArrowLeft' ? (i - 1 + n) % n : -1;
    if (next < 0) return false;
    this.focus(usable[next]);
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (!t || !this.panel.contains(t)) return; // (the backdrop: onPageKey)
    if (e.code === 'Escape') {
      if (this.back()) { e.preventDefault(); e.stopPropagation(); }
      return; // on the main list Esc goes on to the game (QA: Esc resumes)
    }
    if (!MENU_KEYS.has(e.code)) return;
    e.stopPropagation(); // the menu's keys: the game's window listener would cancel their default (focus moves, presses, steps)
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; // native controls keep their own keys
    if (!STEP_KEYS.has(e.code)) return;
    if (t.getAttribute('role') === 'tab') {
      const tabs = this.tabs(), i = tabs.indexOf(t);
      const next = e.code === 'Home' ? 0 : e.code === 'End' ? tabs.length - 1
        : e.code === 'ArrowRight' ? (i + 1) % tabs.length : e.code === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : -1;
      if (next >= 0) {
        e.preventDefault();
        const v = tabs[next].getAttribute('data-tab');
        if (isTab(v)) this.setTab(v, true);
      }
      return;
    }
    const list = t.closest<HTMLElement>('.pause-list, .pause-confirm');
    if (list && tag === 'BUTTON' && this.step(this.listButtons(list), t, e.code)) e.preventDefault();
  }

  private onPageKey(e: KeyboardEvent): void {
    if (this.root.classList.contains('hidden')) return;
    const t = e.target as Node | null;
    if (t && this.panel.contains(t)) return; // handled by onKey (or meant for the game)
    if (e.code === 'Escape') {
      if (this.back()) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (e.code === 'Tab' || STEP_KEYS.has(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      this.focusDefault();
    }
  }
}
