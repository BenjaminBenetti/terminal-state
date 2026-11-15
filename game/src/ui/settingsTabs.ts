// Task studio-settings-menu-parity-20261115-191601-01: the Settings TABS — Graphics / Audio / Gameplay / Performance over the ONE settings
// form (ui/mainMenu.ts mountSettingsForm: each row carries its data-group). One presentation for both places Settings opens:
//  - the pause menu's Settings view (index.html #pause: static markup, ids pause-*; ui/pauseMenu.ts drives the views around it);
//  - the main menu's Settings dialog (ui/mainMenu.ts MainMenuView builds the same markup with buildSettingsTabs, ids mm-*).
// The first three tabs show the matching rows of the form (CSS filters by data-group: no remount, no second apply path); the store's
// note has no group and shows on all of them. Graphics keeps the technical read-outs (class set-detail) behind "Show details": the live
// lighting status lines and every warning stay visible. Performance = the recorder panel (and, in a run, the run codes).
//
// The tab strip is not a scroll container: its baseline is drawn inside its own box (an inset shadow the selected tab's underline
// covers), so no tab pokes out of it, and on a narrow screen the tabs wrap onto a second row instead of scrolling out of reach.
// (Before: overflow-x: auto made the strip scroll on both axes, and each tab's margin-bottom: -1px overlap of a border-bottom made its
// content 1 px taller than the strip — a scrollable strip; below ~460 px the fourth tab was cut off behind a scrollbar.)

/** The Settings tabs (the first three = the settings form's data-group values). */
export type SettingsTab = 'graphics' | 'audio' | 'gameplay' | 'performance';

export const SETTINGS_TABS: readonly SettingsTab[] = ['graphics', 'audio', 'gameplay', 'performance'];
export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {graphics: 'Graphics', audio: 'Audio', gameplay: 'Gameplay', performance: 'Performance'};

export const isSettingsTab = (v: unknown): v is SettingsTab => typeof v === 'string' && (SETTINGS_TABS as readonly string[]).includes(v);

const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

// The look of the tabs and of the settings rows under them. `.set-look` is the menus' form look (also the pause's Controls form): one
// column that never grows past the panel (minmax(0, 1fr); a slider may shrink to 6em — its 160 px intrinsic minimum made the Render
// resolution row 309 px wide in a 302 px column on a 360 px screen, a sideways scroll). The hosts own the focus outline colour; the
// tab's outline sits inside the tab.
const CSS = `
.set-tabbed { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.set-tabbed .set-tabs { display: flex; flex-wrap: wrap; flex: none; gap: 2px; margin: 14px 0 12px; box-shadow: inset 0 -1px 0 #3a3f44; }
.set-tabbed .set-tabs [role="tab"] { background: none; border: none; border-bottom: 3px solid transparent; padding: 9px 14px 8px; color: var(--cream-dim); white-space: nowrap; }
.set-tabbed .set-tabs [role="tab"]:hover:not(:disabled) { background: none; color: var(--cream); }
.set-tabbed .set-tabs [role="tab"][aria-selected="true"] { color: var(--cream); border-bottom-color: var(--mustard); }
.set-tabbed .set-tabs [role="tab"]:focus-visible { outline-offset: -2px; }
.set-tabbed .set-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 6px 2px 2px; }
.settings.set-look { grid-template-columns: minmax(0, 1fr); gap: 12px; margin: 2px 0 6px; font-size: 14px; }
.settings.set-look label { min-height: 30px; gap: 14px; }
.settings.set-look input[type=range] { min-width: 6em; }
.settings.set-look select { min-width: 10em; max-width: 60%; padding: 4px 6px; font-size: 14px; }
.settings.set-look .set-readout { font-size: 12.5px; margin-top: -8px; line-height: 1.4; }
.settings.set-look .set-note { font-size: 12.5px; }
.settings.set-look .set-tutorials button, .settings.set-look .set-actions button { font-size: 14px; }
.set-form[data-show="graphics"] [data-group]:not([data-group="graphics"]),
.set-form[data-show="audio"] [data-group]:not([data-group="audio"]),
.set-form[data-show="gameplay"] [data-group]:not([data-group="gameplay"]) { display: none; }
.set-form:not(.show-details) .set-detail { display: none; }
.set-tabbed .set-details { margin: 2px 0 4px; }
.set-tabbed .set-details button { padding: 6px 12px; font-size: 13.5px; background: none; color: var(--cream-dim); }
.set-tabbed .set-perf .perf-rec { margin-top: 0; }
.set-tabbed .set-perf .perf-rec > h3 { display: none; }
@media (max-width: 560px) {
  .settings.set-look select { max-width: 55%; min-width: 0; }
}
@media (max-height: 520px) {
  .set-tabbed .set-tabs { margin: 8px 0 8px; }
}
`;

function injectCss(doc: Document): void {
  if (doc.getElementById('settings-tabs-css')) return;
  const st = doc.createElement('style');
  st.id = 'settings-tabs-css';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

export interface SettingsTabsMarkup {
  /** The view (.set-tabbed): the tab strip, then .set-body with the form, the details toggle and the Performance panel. */
  view: HTMLElement;
  /** Where the settings form mounts (P + 'settings'). */
  form: HTMLElement;
  /** Where the Performance tab's content mounts (P + 'perf'); null without that tab. */
  perf: HTMLElement | null;
}

/**
 * The Settings tabs' markup — the same structure as the pause menu's static markup in index.html (ids P + 'tab-<tab>' / 'settings' /
 * 'details' / 'perf'). `performance: false` leaves out the Performance tab and its panel. `formClass` adds the host's own classes.
 */
export function buildSettingsTabs(doc: Document, o: {idPrefix: string; performance?: boolean; formClass?: string}): SettingsTabsMarkup {
  const P = o.idPrefix;
  const el = (tag: string, cls: string, attrs: Record<string, string> = {}) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const tabs = SETTINGS_TABS.filter(t => t !== 'performance' || o.performance !== false);
  const view = el('div', 'set-tabbed');
  const strip = el('div', 'set-tabs', {role: 'tablist', 'aria-label': 'Settings'});
  for (const t of tabs) {
    const b = el('button', '', {type: 'button', role: 'tab', id: `${P}tab-${t}`, 'data-tab': t, 'aria-controls': t === 'performance' ? `${P}perf` : `${P}settings`});
    b.textContent = SETTINGS_TAB_LABELS[t];
    strip.appendChild(b);
  }
  const body = el('div', 'set-body');
  const form = el('div', `settings set-look set-form${o.formClass ? ` ${o.formClass}` : ''}`, {id: `${P}settings`, role: 'tabpanel'});
  const details = el('div', 'set-details');
  const toggle = el('button', '', {type: 'button', id: `${P}details`, 'aria-controls': `${P}settings`, 'aria-expanded': 'false'});
  toggle.textContent = 'Show details';
  details.appendChild(toggle);
  body.append(form, details);
  let perf: HTMLElement | null = null;
  if (tabs.includes('performance')) {
    perf = el('div', 'set-perf hidden', {id: `${P}perf`, role: 'tabpanel', 'aria-labelledby': `${P}tab-performance`});
    body.appendChild(perf);
  }
  view.append(strip, body);
  return {view, form, perf};
}

/**
 * The Settings tabs over their markup (index.html's pause view, or buildSettingsTabs): the selected tab (roving tabindex), which rows
 * of the form show (data-show), the details toggle (Show / Hide details: kept while the page lives) and the Performance panel. The tab
 * and the details choice are remembered across visits; the host decides when the view shows and where the focus goes.
 */
export class SettingsTabs {
  private tabId: SettingsTab = 'graphics';
  private detailsOn = false;
  /** The tab buttons in order. */
  readonly tabs: HTMLElement[];
  private readonly form: HTMLElement | null;
  private readonly perf: HTMLElement | null;
  private readonly toggle: HTMLElement | null;

  constructor(readonly root: HTMLElement) {
    injectCss(root.ownerDocument);
    this.tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"][data-tab]')];
    this.form = root.querySelector<HTMLElement>('.set-form');
    this.perf = root.querySelector<HTMLElement>('.set-perf');
    this.toggle = root.querySelector<HTMLElement>('.set-details button');
    for (const t of this.tabs) t.addEventListener('click', () => { const v = t.getAttribute('data-tab'); if (isSettingsTab(v)) this.setTab(v); });
    this.toggle?.addEventListener('click', () => this.setDetails(!this.detailsOn));
    this.render();
  }

  get tab(): SettingsTab { return this.tabId; }
  get details(): boolean { return this.detailsOn; }
  /** The selected tab's button (the view's starting focus). */
  get selected(): HTMLElement | undefined { return this.tabOf(this.tabId); }

  private tabOf(tab: SettingsTab): HTMLElement | undefined {
    return this.tabs.find(t => t.getAttribute('data-tab') === tab);
  }

  /** Switch the tab (a tab the markup does not have is ignored); focus = move the focus to it. */
  setTab(tab: SettingsTab, focus = false): void {
    if (!this.tabOf(tab)) return;
    this.tabId = tab;
    this.render();
    if (focus) this.selected?.focus();
  }

  setDetails(on: boolean): void {
    this.detailsOn = on;
    this.render();
  }

  /**
   * A key on a tab: ArrowRight / ArrowLeft / Home / End select and focus the next / previous / first / last tab (wrapping). True =
   * handled (the host cancels the default); false for any other key or target.
   */
  key(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    const i = t ? this.tabs.indexOf(t) : -1;
    if (i < 0 || !STEP_KEYS.has(e.code)) return false;
    const n = this.tabs.length;
    const next = e.code === 'Home' ? 0 : e.code === 'End' ? n - 1 : e.code === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
    const v = this.tabs[next].getAttribute('data-tab');
    if (isSettingsTab(v)) this.setTab(v, true);
    return true;
  }

  render(): void {
    const tab = this.tabId;
    for (const t of this.tabs) {
      const on = t.getAttribute('data-tab') === tab;
      t.setAttribute('aria-selected', String(on));
      t.setAttribute('tabindex', on ? '0' : '-1');
    }
    const formTab = tab !== 'performance';
    if (this.form) {
      this.form.classList.toggle('hidden', !formTab);
      this.form.setAttribute('data-show', formTab ? tab : '');
      const by = this.tabOf(formTab ? tab : 'graphics')?.id;
      if (by) this.form.setAttribute('aria-labelledby', by);
      this.form.classList.toggle('show-details', this.detailsOn);
    }
    this.perf?.classList.toggle('hidden', formTab);
    if (this.toggle) {
      this.toggle.parentElement?.classList.toggle('hidden', tab !== 'graphics');
      this.toggle.textContent = this.detailsOn ? 'Hide details' : 'Show details';
      this.toggle.setAttribute('aria-expanded', String(this.detailsOn));
    }
  }
}
