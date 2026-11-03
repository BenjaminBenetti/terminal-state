// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane MENU): the MAIN MENU — shown on every load (dev deep links
// included: they only pre-fill a menu-side "Dev start" picker, nothing auto-enters a game), a side panel beside the real-time
// diorama (world/menuScene.ts).
//
// Split for testability (Node tests have no DOM):
//  - MainMenuController: the whole menu as data — the view stack (Esc = back), the items of each view, focus (arrow keys), the
//    New Game slot choice with an explicit overwrite confirmation, Continue (only when a valid save exists: the last-used valid
//    slot, else the newest valid one), the Load Save / Slots list (metadata; per slot Load / Export / Import into THAT slot with an
//    explicit replace confirmation / Delete with confirmation), Settings, the dev picker and the QA start. Storage is NOT here:
//    every slot operation goes through the MenuHost (implemented by the primary + lane SAVE; main.ts has a session fallback).
//  - MainMenuView: renders the controller's model into the DOM (createElement + textContent only: save metadata can come from an
//    imported file, nothing is ever parsed as HTML), wires clicks / keys back, keeps focus visible and on the controller's item.
//  - mountSettingsForm: ONE settings form bound to the settings store (ui/settingsStore.ts), used by the menu AND the pause menu.

import {SAVE_SLOTS, type SaveMeta} from '../campaign/types';
import type {LevelId} from '../levels/types';
import {seedToCode} from '../core/rng';
import {
  SETTINGS_BOUNDS, renderScaleOptions, renderScaleReadout, volumeFromPercent, volumePercent,
  type GameSettings, type RenderScale, type SettingsStore,
} from './settingsStore';

// ---------------------------------------------------------------------------------------------
// The host contract (primary + lane SAVE implement it; tests use a fake)

/** A developer start (URL dev params ?level= / ?seed= / ?officeSeed= / ?mallSeed= / ?reactorSeed=, or ?qa=1): a NORMAL new game there. */
export interface DevStart {
  level: LevelId;
  /** Level seeds from the URL (missing = a fresh seed). */
  seeds: Partial<Record<LevelId, number>>;
}

/** One save slot as the menu shows it. */
export interface SlotView {
  slot: number;
  /** Nothing stored in the slot. */
  empty: boolean;
  /** A readable, checksum-valid save (Load / Continue allowed). */
  valid: boolean;
  meta?: SaveMeta;
  /** Why a non-empty slot is not valid (shown; the slot can still be exported, overwritten, replaced or deleted). */
  error?: string;
}

export type ImportResult = {ok: true} | {ok: false; error: string};

export interface MenuHost {
  /** The SAVE_SLOTS slots (index 0..SAVE_SLOTS-1), fresh from storage on every call. */
  listSlots(): SlotView[];
  /** The last-used slot (STORAGE_KEYS.lastSlot), null when none. Continue takes it when valid, else the newest valid save. */
  lastSlot(): number | null;
  /** A new run written to `slot` (the menu confirmed any overwrite); `dev` = the dev picker's level / seeds. Resolves once started. */
  newGame(slot: number, dev?: DevStart): Promise<void>;
  /** Load `slot` (default: the host's own Continue choice). Resolves once started; rejects with a message when it cannot. */
  continueGame(slot?: number): Promise<void>;
  /** Download the slot's save file (.json). */
  exportSlot(slot: number): void;
  /** Validate `file` and write it into `slot` (the menu confirmed replacing an occupied slot). Never throws: errors are returned. */
  importFile(slot: number, file: File): Promise<ImportResult>;
  /** Remove the slot's save (the menu confirmed). */
  deleteSlot(slot: number): void;
}

// ---------------------------------------------------------------------------------------------
// Formatting (pure)

const DEFAULT_LEVEL_NAMES: Record<LevelId, string> = {subway: 'Subway', office: 'Office Space', mall: 'Shopping Center', reactor: 'Reactor'};

/** "45 s", "12 min", "1 h 05 min". */
export function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Local "YYYY-MM-DD HH:MM" (or the raw text when it is not a date). */
export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return String(iso ?? '').slice(0, 32) || 'unknown time';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Slot heading + detail lines (plain text; the view sets it as textContent). */
export function slotSummary(v: SlotView, levelName: (l: LevelId) => string = l => DEFAULT_LEVEL_NAMES[l] ?? String(l)): {heading: string; lines: string[]; tone: 'empty' | 'valid' | 'invalid'} {
  const heading = `Slot ${v.slot + 1}`;
  if (v.empty) return {heading, lines: ['Empty'], tone: 'empty'};
  const m = v.meta;
  if (!v.valid || !m) return {heading, lines: [`Unreadable save${v.error ? ` — ${v.error}` : ''}`], tone: 'invalid'};
  const arche = levelName(m.archetype);
  const where = m.station && m.station !== arche ? `${m.station} (${arche})` : (m.station || arche);
  return {
    heading,
    lines: [
      `${where} · ${formatPlaytime(m.playtime)} played`,
      `Saved ${formatSavedAt(m.savedAt)} · seed ${seedToCode(m.networkSeed)} · ${m.stationsVisited} station${m.stationsVisited === 1 ? '' : 's'} visited${m.won ? ' · WON' : ''}`,
    ],
    tone: 'valid',
  };
}

/** Continue's slot: the last-used slot when it holds a valid save, else the newest valid save (null: no valid save -> no Continue). */
export function continueTarget(slots: readonly SlotView[], last: number | null): number | null {
  const valid = slots.filter(s => s.valid && !s.empty);
  if (!valid.length) return null;
  if (last !== null && valid.some(s => s.slot === last)) return last;
  const t = (s: SlotView) => { const n = Date.parse(s.meta?.savedAt ?? ''); return Number.isFinite(n) ? n : -Infinity; };
  return [...valid].sort((a, b) => t(b) - t(a) || a.slot - b.slot)[0].slot;
}

// ---------------------------------------------------------------------------------------------
// The controller (pure state machine)

export type MenuViewKind = 'main' | 'new' | 'confirm-overwrite' | 'slots' | 'confirm-import' | 'confirm-delete' | 'settings' | 'dev';

type View =
  | {kind: 'main'}
  | {kind: 'new'; dev?: DevStart}
  | {kind: 'confirm-overwrite'; slot: number; dev?: DevStart}
  | {kind: 'slots'}
  | {kind: 'confirm-import'; slot: number; file: File}
  | {kind: 'confirm-delete'; slot: number}
  | {kind: 'settings'}
  | {kind: 'dev'};

export interface MenuAction {
  id: string;
  label: string;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
  /** Toggle buttons (the dev picker's level choice): aria-pressed. */
  pressed?: boolean;
  /** Short reason shown when disabled (e.g. waiting for the game files). */
  hint?: string;
}

export interface MenuRow {
  /** Slot rows: the slot (data-slot). */
  slot?: number;
  heading?: string;
  lines?: string[];
  tone?: 'empty' | 'valid' | 'invalid';
  actions: MenuAction[];
}

export interface MenuModel {
  view: MenuViewKind;
  title: string;
  /** Plain-text paragraphs under the title. */
  text: string[];
  rows: MenuRow[];
  status: {text: string; tone: 'info' | 'ok' | 'error'} | null;
  busy: boolean;
  /** The focused action id (null: none focusable). */
  focus: string | null;
}

export interface MainMenuOptions {
  /** The dev picker's initial choice (URL dev params / ?qa=1); null = no Dev start entry. */
  dev?: DevStart | null;
  /** Levels the dev picker offers. */
  devLevels?: readonly LevelId[];
  /** ?qa=1: the QA quick start (#btn-start; a scratch run, never saved); `ready` = the scratch level is prepared. */
  qa?: {label: string; start(): void; ready(): boolean} | null;
  /** Opens a file chooser INSIDE the click (user gesture); resolves null when cancelled. */
  pickFile?: () => Promise<File | null>;
  levelName?: (l: LevelId) => string;
}

const START_IDS = new Set(['continue', 'overwrite-go', 'qa-start']);
const isStart = (id: string) => START_IDS.has(id) || id.startsWith('load:') || id.startsWith('new:');

export class MainMenuController {
  private stack: {view: View; focus: string | null}[] = [{view: {kind: 'main'}, focus: null}];
  private focusId: string | null = null;
  private status: MenuModel['status'] = null;
  private busyFlag = false;
  private boot = {ready: false, progress: 0, label: 'Loading game files…'};
  private dev: DevStart | null;
  private slotCache: SlotView[] | null = null;
  private readonly listeners: (() => void)[] = [];
  readonly levelName: (l: LevelId) => string;

  constructor(private readonly host: MenuHost, private readonly opts: MainMenuOptions = {}) {
    this.dev = opts.dev ? {level: opts.dev.level, seeds: {...opts.dev.seeds}} : null;
    this.levelName = opts.levelName ?? (l => DEFAULT_LEVEL_NAMES[l] ?? String(l));
  }

  /** Re-render requests (the view subscribes). */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); };
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  get view(): MenuViewKind { return this.top.kind; }
  get busy(): boolean { return this.busyFlag; }
  get ready(): boolean { return this.boot.ready; }
  get devStart(): DevStart | null { return this.dev ? {level: this.dev.level, seeds: {...this.dev.seeds}} : null; }
  private get top(): View { return this.stack[this.stack.length - 1].view; }

  /** The heavy game boot assets' progress (game.load in the background); start actions wait for ready. */
  setBoot(ready: boolean, progress: number, label?: string): void {
    const was = this.boot.ready, bucket = Math.floor(this.boot.progress * 20);
    this.boot = {ready, progress: Math.max(0, Math.min(1, progress)), label: label ?? this.boot.label};
    if (!was && ready && this.status?.text.startsWith('Waiting')) this.status = null;
    // re-render on the ready flip and every 5 % (the smooth bar is the boot line's own element)
    if (was !== ready || Math.floor(this.boot.progress * 20) !== bucket) this.changed();
  }

  /** Slots re-read (another tab / an import): call when storage may have changed. */
  refresh(): void {
    this.slotCache = null;
    this.changed();
  }

  private slots(): SlotView[] {
    if (!this.slotCache) {
      try {
        const list = this.host.listSlots();
        this.slotCache = Array.from({length: SAVE_SLOTS}, (_, i) => list.find(s => s.slot === i) ?? {slot: i, empty: true, valid: false});
      } catch (err) {
        this.slotCache = Array.from({length: SAVE_SLOTS}, (_, i) => ({slot: i, empty: false, valid: false, error: `storage unavailable (${String((err as Error)?.message ?? err).slice(0, 80)})`}));
      }
    }
    return this.slotCache;
  }

  /** Continue's target slot (null = Continue hidden). */
  continueSlot(): number | null {
    let last: number | null = null;
    try { last = this.host.lastSlot(); } catch { last = null; }
    return continueTarget(this.slots(), last);
  }

  private waitHint(): string {
    return `Waiting for the game files · ${Math.round(this.boot.progress * 100)} %`;
  }

  private start(id: string, label: string, tone?: 'primary' | 'danger'): MenuAction {
    const off = !this.boot.ready;
    return {id, label, tone, disabled: off || this.busyFlag, hint: off ? this.waitHint() : undefined};
  }

  private nav(id: string, label: string, tone?: 'primary' | 'danger'): MenuAction {
    return {id, label, tone, disabled: this.busyFlag};
  }

  /** The current view as data. */
  model(): MenuModel {
    const v = this.top;
    const name = this.levelName;
    let title = '', text: string[] = [];
    const rows: MenuRow[] = [];
    switch (v.kind) {
      case 'main': {
        title = 'Main menu';
        if (this.opts.qa) {
          const qa = this.start('qa-start', this.opts.qa.label, 'primary');
          if (!this.opts.qa.ready()) { qa.disabled = true; qa.hint = 'Preparing the QA level…'; }
          rows.push({actions: [qa]});
        }
        const c = this.continueSlot();
        if (c !== null) {
          const s = this.slots()[c];
          const sum = slotSummary(s, name);
          rows.push({slot: c, lines: [`${sum.heading} · ${sum.lines[0]}`], actions: [this.start('continue', 'Continue', this.opts.qa ? undefined : 'primary')]});
        }
        rows.push({actions: [this.nav('new-game', 'New game', c === null && !this.opts.qa ? 'primary' : undefined)]});
        rows.push({actions: [this.nav('slots', 'Load save / slots')]});
        rows.push({actions: [this.nav('settings', 'Settings')]});
        if (this.dev) rows.push({lines: [`Dev: ${name(this.dev.level)}${devSeedText(this.dev)}`], actions: [this.nav('dev', 'Dev start')]});
        break;
      }
      case 'new': {
        title = v.dev ? `New game · dev start ${name(v.dev.level)}` : 'New game — choose a slot';
        text = ['The run is saved to this slot (on this device, in this browser). An occupied slot asks before it is overwritten.'];
        for (const s of this.slots()) {
          const sum = slotSummary(s, name);
          rows.push({slot: s.slot, heading: sum.heading, lines: sum.lines, tone: sum.tone,
            actions: [s.empty ? this.start(`new:${s.slot}`, 'Start here', 'primary') : this.nav(`new:${s.slot}`, 'Overwrite…', 'danger')]});
        }
        rows.push({actions: [this.nav('back', 'Back')]});
        break;
      }
      case 'confirm-overwrite': {
        const s = this.slots()[v.slot];
        const sum = slotSummary(s, name);
        title = `Overwrite slot ${v.slot + 1}?`;
        text = [`${sum.lines.join(' — ')}`, 'This save is replaced by the new run and cannot be recovered (export it first to keep a copy).'];
        rows.push({actions: [this.start('overwrite-go', `Overwrite slot ${v.slot + 1} and start`, 'danger'), this.nav('back', 'Cancel')]});
        break;
      }
      case 'slots': {
        title = 'Save slots';
        text = ['Saves live in this browser on this device. Export a slot to keep a file; import a file into the slot you choose.'];
        for (const s of this.slots()) {
          const sum = slotSummary(s, name);
          const actions: MenuAction[] = [];
          if (s.valid && !s.empty) actions.push(this.start(`load:${s.slot}`, 'Load', 'primary'));
          if (!s.empty) actions.push(this.nav(`export:${s.slot}`, 'Export'));
          actions.push(this.nav(`import:${s.slot}`, 'Import…'));
          if (!s.empty) actions.push(this.nav(`delete:${s.slot}`, 'Delete', 'danger'));
          rows.push({slot: s.slot, heading: sum.heading, lines: sum.lines, tone: sum.tone, actions});
        }
        rows.push({actions: [this.nav('back', 'Back')]});
        break;
      }
      case 'confirm-import': {
        const s = this.slots()[v.slot];
        const sum = slotSummary(s, name);
        title = `Replace slot ${v.slot + 1}?`;
        text = [`Import “${v.file.name.slice(0, 80)}” into slot ${v.slot + 1}, replacing: ${sum.lines.join(' — ')}`, 'The current save in this slot cannot be recovered (export it first to keep a copy).'];
        rows.push({actions: [this.nav('import-go', `Replace slot ${v.slot + 1}`, 'danger'), this.nav('back', 'Cancel')]});
        break;
      }
      case 'confirm-delete': {
        const s = this.slots()[v.slot];
        const sum = slotSummary(s, name);
        title = `Delete slot ${v.slot + 1}?`;
        text = [sum.lines.join(' — '), 'The save is removed from this browser and cannot be recovered.'];
        rows.push({actions: [this.nav('delete-go', `Delete slot ${v.slot + 1}`, 'danger'), this.nav('back', 'Cancel')]});
        break;
      }
      case 'settings': {
        title = 'Settings';
        text = [];
        rows.push({actions: [this.nav('back', 'Back')]});
        break;
      }
      case 'dev': {
        title = 'Dev start';
        const d = this.dev!;
        text = [`From the URL: ${name(d.level)}${devSeedText(d)}. Starts a normal new game at the chosen level (pick its slot next).`];
        rows.push({actions: (this.opts.devLevels ?? (['subway', 'office', 'mall', 'reactor'] as LevelId[])).map(l => ({...this.nav(`dev-level:${l}`, name(l)), pressed: d.level === l}))});
        rows.push({actions: [this.nav('dev-go', `Start ${name(d.level)} · choose slot…`, 'primary'), this.nav('back', 'Back')]});
        break;
      }
    }
    const status = this.status ?? (!this.boot.ready && rows.some(r => r.actions.some(a => isStart(a.id))) ? {text: this.waitHint(), tone: 'info' as const} : null);
    const model: MenuModel = {view: v.kind, title, text, rows, status, busy: this.busyFlag, focus: null};
    model.focus = this.validFocus(model);
    return model;
  }

  /** Flat action list (render / focus order). */
  static actions(m: Pick<MenuModel, 'rows'>): MenuAction[] {
    return m.rows.flatMap(r => r.actions);
  }

  private validFocus(m: MenuModel): string | null {
    const all = MainMenuController.actions(m);
    const cur = this.focusId !== null ? all.find(a => a.id === this.focusId && !a.disabled) : undefined;
    if (cur) return cur.id;
    // the default: confirmations focus Cancel (a destructive default never sits under Enter), else the first enabled action
    if (m.view.startsWith('confirm-')) return all.find(a => a.id === 'back')?.id ?? null;
    return all.find(a => !a.disabled)?.id ?? all[0]?.id ?? null;
  }

  /** The focused action. */
  get focus(): string | null { return this.validFocus(this.model()); }

  /** The view moved focus (mouse / Tab): keep the controller in step. */
  setFocus(id: string | null): void {
    this.focusId = id;
  }

  private push(view: View): void {
    this.stack[this.stack.length - 1].focus = this.focusId;
    this.stack.push({view, focus: null});
    this.status = null;
    this.focusId = null; // the new view's default focus
    this.changed();
  }

  /** Esc / Back: one level up. False at the main view (nothing to go back to). */
  back(): boolean {
    if (this.busyFlag || this.stack.length <= 1) return false;
    this.stack.pop();
    this.focusId = this.stack[this.stack.length - 1].focus;
    this.changed();
    return true;
  }

  /** Back to the main view (e.g. when the menu is shown again). */
  home(): void {
    this.stack = [{view: {kind: 'main'}, focus: null}];
    this.status = null;
    this.busyFlag = false;
    this.slotCache = null;
    this.focusId = null;
    this.changed();
  }

  /**
   * Keyboard: Escape = back; ArrowDown / ArrowUp (ArrowRight / ArrowLeft too) = next / previous enabled action (wrapping); Home /
   * End = first / last; Enter / Space = activate (the DOM view leaves Enter / Space to the focused native button). True = handled.
   */
  key(code: string): boolean {
    if (code === 'Escape') return this.back();
    const all = MainMenuController.actions(this.model()).filter(a => !a.disabled);
    if (!all.length) return false;
    const i = Math.max(0, all.findIndex(a => a.id === this.focus));
    let next: number | null = null;
    if (code === 'ArrowDown' || code === 'ArrowRight') next = (i + 1) % all.length;
    else if (code === 'ArrowUp' || code === 'ArrowLeft') next = (i - 1 + all.length) % all.length;
    else if (code === 'Home') next = 0;
    else if (code === 'End') next = all.length - 1;
    else if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') { this.activate(all[i].id); return true; }
    if (next === null) return false;
    this.focusId = all[next].id;
    this.changed();
    return true;
  }

  /**
   * Activate an action (a click / Enter). Synchronous up to the host call, so a file chooser or the game's pointer-lock / audio
   * start happen inside the user gesture. Returns the started operation (tests await it).
   */
  activate(id: string): Promise<void> {
    const a = MainMenuController.actions(this.model()).find(x => x.id === id);
    if (!a || a.disabled) return Promise.resolve();
    const v = this.top;
    const [verb, arg] = id.split(':');
    const slot = arg !== undefined ? Number(arg) : -1;
    switch (verb) {
      case 'back': this.back(); return Promise.resolve();
      case 'qa-start': this.opts.qa?.start(); return Promise.resolve();
      case 'continue': { const c = this.continueSlot(); return c === null ? Promise.resolve() : this.run(() => this.host.continueGame(c), 'Loading your save…'); }
      case 'new-game': this.push({kind: 'new'}); return Promise.resolve();
      case 'slots': this.slotCache = null; this.push({kind: 'slots'}); return Promise.resolve();
      case 'settings': this.push({kind: 'settings'}); return Promise.resolve();
      case 'dev': this.push({kind: 'dev'}); return Promise.resolve();
      case 'dev-level': if (this.dev && arg) { this.dev = {...this.dev, level: arg as LevelId}; this.changed(); } return Promise.resolve();
      case 'dev-go': if (this.dev) this.push({kind: 'new', dev: this.devStart!}); return Promise.resolve();
      case 'new': {
        const dev = v.kind === 'new' ? v.dev : undefined;
        const s = this.slots()[slot];
        if (!s) return Promise.resolve();
        if (s.empty) return this.run(() => this.host.newGame(slot, dev), 'Starting a new run…');
        this.push({kind: 'confirm-overwrite', slot, dev});
        return Promise.resolve();
      }
      case 'overwrite-go': {
        if (v.kind !== 'confirm-overwrite') return Promise.resolve();
        return this.run(() => this.host.newGame(v.slot, v.dev), 'Starting a new run…');
      }
      case 'load': return slot >= 0 ? this.run(() => this.host.continueGame(slot), `Loading slot ${slot + 1}…`) : Promise.resolve();
      case 'export': {
        try { this.host.exportSlot(slot); this.status = {text: `Slot ${slot + 1} exported (check your downloads).`, tone: 'ok'}; }
        catch (err) { this.status = {text: `Export failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`, tone: 'error'}; }
        this.changed();
        return Promise.resolve();
      }
      case 'import': return this.chooseImport(slot);
      case 'import-go': {
        if (v.kind !== 'confirm-import') return Promise.resolve();
        return this.doImport(v.slot, v.file, true);
      }
      case 'delete': this.push({kind: 'confirm-delete', slot}); return Promise.resolve();
      case 'delete-go': {
        if (v.kind !== 'confirm-delete') return Promise.resolve();
        try { this.host.deleteSlot(v.slot); this.status = null; } catch (err) { this.status = {text: `Delete failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`, tone: 'error'}; }
        this.slotCache = null;
        const msg = this.status;
        this.back();
        this.status = msg ?? {text: `Slot ${v.slot + 1} deleted.`, tone: 'ok'};
        this.changed();
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }

  private chooseImport(slot: number): Promise<void> {
    const pick = this.opts.pickFile;
    if (!pick) { this.status = {text: 'Importing needs a file chooser (not available here).', tone: 'error'}; this.changed(); return Promise.resolve(); }
    let picking: Promise<File | null>;
    try { picking = pick(); } catch { picking = Promise.resolve(null); }
    return picking.then(file => {
      if (!file || this.top.kind !== 'slots') return;
      const s = this.slots()[slot];
      if (!s) return;
      if (s.empty) return this.doImport(slot, file, false);
      this.push({kind: 'confirm-import', slot, file});
    }, () => undefined);
  }

  private async doImport(slot: number, file: File, confirmed: boolean): Promise<void> {
    this.busyFlag = true;
    this.status = {text: `Importing “${file.name.slice(0, 80)}”…`, tone: 'info'};
    this.changed();
    let r: ImportResult;
    try { r = await this.host.importFile(slot, file); } catch (err) { r = {ok: false, error: String((err as Error)?.message ?? err)}; }
    this.busyFlag = false;
    this.slotCache = null;
    if (confirmed) this.back();
    this.status = r.ok ? {text: `Imported into slot ${slot + 1}.`, tone: 'ok'} : {text: `Import failed — slot ${slot + 1} unchanged: ${r.error.slice(0, 160)}`, tone: 'error'};
    this.changed();
  }

  private async run(op: () => Promise<void>, label: string): Promise<void> {
    this.busyFlag = true;
    this.status = {text: label, tone: 'info'};
    this.changed();
    let p: Promise<void>;
    try { p = op(); } catch (err) { p = Promise.reject(err); }
    try {
      await p;
      this.status = null;
    } catch (err) {
      this.status = {text: `Could not start: ${String((err as Error)?.message ?? err).slice(0, 160)}`, tone: 'error'};
    } finally {
      this.busyFlag = false;
      this.slotCache = null;
        this.changed();
    }
  }
}

function devSeedText(d: DevStart): string {
  const parts = (Object.entries(d.seeds) as [LevelId, number | undefined][]).filter(([, v]) => typeof v === 'number').map(([l, v]) => `${l} seed ${seedToCode(v!)}`);
  return parts.length ? ` · ${parts.join(', ')}` : '';
}

// ---------------------------------------------------------------------------------------------
// The DOM view

const CSS = `
#title.screen[data-mode="menu"] { background: none; backdrop-filter: none; justify-content: flex-start; align-items: stretch; padding: 0; }
#title[data-mode="menu"] .loading-card { display: none; }
#title[data-mode="loading"] .mm-side { display: none; }
#title[data-mode="loading"].screen { background: rgba(6, 8, 7, 0.55); }
#title-backdrop { position: absolute; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(ellipse at 68% 55%, #1d2a1b 0%, #0d130d 55%, #060806 100%); transition: opacity 1.4s ease; }
#title-backdrop.faded { opacity: 0; }
.mm-side { position: relative; z-index: 1; display: flex; flex-direction: column; width: min(440px, 100%); min-height: 100%; padding: 34px 30px 20px; overflow: auto;
  background: linear-gradient(90deg, rgba(10, 12, 11, 0.9) 0%, rgba(10, 12, 11, 0.78) 72%, rgba(10, 12, 11, 0) 100%); }
.mm-side .stripe { position: absolute; left: 30px; top: 0; width: 72px; height: 6px; background: var(--mustard); }
.mm-side h1 { font-size: 44px; line-height: 1.02; margin: 10px 0 4px; }
.mm-side .subtitle { margin-bottom: 18px; }
.mm-view h2 { font-size: 15px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cream-dim); margin: 4px 0 10px; font-weight: 700; }
.mm-view p.mm-text { margin: 0 0 10px; font-size: 13.5px; line-height: 1.45; color: var(--cream-dim); }
.mm-rows { display: flex; flex-direction: column; gap: 8px; }
.mm-row { display: flex; flex-direction: column; gap: 6px; }
.mm-row.slot { padding: 8px 10px 9px; background: rgba(21, 23, 26, 0.86); border-left: 3px solid #3a3f44; }
.mm-row.slot.valid { border-left-color: var(--teal); }
.mm-row.slot.invalid { border-left-color: var(--red); }
.mm-row .mm-head { font-weight: 700; font-size: 14px; letter-spacing: 0.04em; }
.mm-row .mm-line { font-size: 12.5px; color: var(--cream-dim); line-height: 1.4; overflow-wrap: anywhere; }
.mm-row.slot.invalid .mm-line { color: #e3a197; }
.mm-acts { display: flex; flex-wrap: wrap; gap: 6px; }
.mm-row:not(.slot) > .mm-acts > button { flex: 1 1 auto; text-align: left; }
.mm-side button { padding: 9px 16px; }
.mm-side button.danger { border-color: var(--red); color: #f1c0b8; }
.mm-side button.danger:hover:not(:disabled) { background: #3a2321; }
.mm-side button[aria-pressed="true"] { border-color: var(--mustard); color: var(--mustard); box-shadow: inset 0 0 0 1px var(--mustard); }
.mm-side button:focus { outline: none; }
.mm-side button:focus-visible, .mm-side input:focus-visible, .mm-side select:focus-visible, #pause .settings :focus-visible { outline: 2px solid var(--mustard); outline-offset: 2px; }
.mm-side .mm-status { min-height: 1.3em; margin: 10px 0 0; font-size: 13px; color: var(--cream-dim); }
.mm-side .mm-status.ok { color: #9fd3a8; }
.mm-side .mm-status.error { color: #f0a497; }
.mm-boot { margin-top: auto; padding-top: 14px; font-size: 11.5px; color: var(--cream-dim); letter-spacing: 0.03em; }
.mm-boot .track { height: 3px; background: #111315; margin-top: 4px; }
.mm-boot .fill { height: 100%; width: 0; background: var(--teal); transition: width 0.2s linear; }
.mm-boot.done .track { display: none; }
.mm-extras { margin-top: 12px; }
.mm-extras details { margin-top: 8px; }
.mm-extras summary { cursor: pointer; font-size: 12.5px; color: var(--cream-dim); letter-spacing: 0.06em; }
.mm-extras .controls-grid { grid-template-columns: 1fr; font-size: 12px; }
.mm-settings.settings { grid-template-columns: 1fr; gap: 9px; margin: 4px 0 12px; }
.settings .set-note { grid-column: 1 / -1; font-size: 12px; color: var(--cream-dim); }
.settings select { max-width: 62%; }
.settings .set-readout { grid-column: 1 / -1; font-size: 11.5px; color: var(--cream-dim); margin-top: -4px; text-align: right; }
.loading-card { position: relative; z-index: 1; margin: auto; }
@media (max-width: 760px) { .mm-side { width: 100%; background: rgba(10, 12, 11, 0.86); } }
`;

function injectCss(doc: Document): void {
  if (doc.getElementById('main-menu-css')) return;
  const st = doc.createElement('style');
  st.id = 'main-menu-css';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

export interface MainMenuViewOptions {
  /** The settings form for the Settings view (mounted once, shown only there). */
  settings?: (container: HTMLElement) => void;
  /** Extra element (the QA #btn-start) adopted as the qa-start action button. */
  qaButton?: HTMLButtonElement | null;
}

/** Renders a MainMenuController into `root` (#mm-view) and keeps focus on the controller's item. */
export class MainMenuView {
  private readonly doc: Document;
  private readonly settingsBox: HTMLElement;
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private lastFocus: string | null = null;
  private visibleFlag = true;
  private programmatic = false;

  constructor(private readonly root: HTMLElement, readonly ctl: MainMenuController, private readonly o: MainMenuViewOptions = {}) {
    this.doc = root.ownerDocument;
    injectCss(this.doc);
    this.head = this.doc.createElement('div');
    this.head.className = 'mm-view mm-head-box';
    this.body = this.doc.createElement('div');
    this.body.className = 'mm-body';
    this.settingsBox = this.doc.createElement('div');
    this.settingsBox.className = 'mm-settings settings hidden'; // (the class, not [hidden]: .settings sets display: grid)
    root.append(this.head, this.settingsBox, this.body);
    o.settings?.(this.settingsBox);
    ctl.onChange(() => this.render());
    root.addEventListener('keydown', e => this.onKey(e));
    root.addEventListener('focusin', e => {
      const id = (e.target as HTMLElement)?.dataset?.action;
      if (!id) return;
      this.lastFocus = id;
      if (!this.programmatic) this.ctl.setFocus(id); // a user's Tab / click (the view's own focus() keeps the default focus)
    });
    this.render();
  }

  set visible(v: boolean) {
    this.visibleFlag = v;
    if (v) this.render();
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    const tag = t?.tagName;
    // native controls keep their own keys (range / select use the arrows; Enter / Space click the focused button)
    if (e.code === 'Escape') { if (this.ctl.key('Escape')) { e.preventDefault(); e.stopPropagation(); } return; }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.code)) {
      if (this.ctl.key(e.code)) { e.preventDefault(); this.focusCurrent(true); }
    }
  }

  /** Focus the controller's item (keyboard navigation, view changes). */
  focusCurrent(force = false): void {
    const id = this.ctl.focus;
    if (!id || !this.visibleFlag) return;
    if (!force && id === this.lastFocus && this.doc.activeElement && this.root.contains(this.doc.activeElement)) return;
    const el = this.root.querySelector<HTMLElement>(`[data-action="${cssEscape(id)}"]`);
    if (el && this.doc.activeElement !== el) {
      this.programmatic = true;
      try { el.focus({preventScroll: false}); } finally { this.programmatic = false; }
    }
    this.lastFocus = id;
  }

  render(): void {
    const m = this.ctl.model();
    const d = this.doc;
    this.settingsBox.classList.toggle('hidden', m.view !== 'settings');
    const body = this.body;
    // keep the adopted QA button alive across renders
    if (this.o.qaButton?.parentElement) this.o.qaButton.remove();
    // heading + text above the (persistent, never re-rendered) settings form; the actions and the status below it
    const head = this.head;
    head.replaceChildren();
    head.dataset.view = m.view;
    const h2 = d.createElement('h2');
    h2.textContent = m.title;
    head.append(h2);
    for (const t of m.text) { const p = d.createElement('p'); p.className = 'mm-text'; p.textContent = t; head.append(p); }
    body.replaceChildren();
    const view = d.createElement('div');
    view.className = 'mm-view';
    view.dataset.view = m.view;
    const rows = d.createElement('div');
    rows.className = 'mm-rows';
    rows.setAttribute('role', 'group');
    rows.setAttribute('aria-label', m.title);
    for (const r of m.rows) {
      const row = d.createElement('div');
      row.className = `mm-row${r.slot !== undefined && r.heading ? ` slot ${r.tone ?? ''}` : ''}`;
      if (r.slot !== undefined) row.dataset.slot = String(r.slot);
      if (r.heading) { const h = d.createElement('div'); h.className = 'mm-head'; h.textContent = r.heading; row.append(h); }
      for (const l of r.lines ?? []) { const p = d.createElement('div'); p.className = 'mm-line'; p.textContent = l; row.append(p); }
      const acts = d.createElement('div');
      acts.className = 'mm-acts';
      for (const a of r.actions) acts.append(this.button(a));
      row.append(acts);
      rows.append(row);
    }
    view.append(rows);
    const st = d.createElement('p');
    st.className = `mm-status${m.status ? ` ${m.status.tone}` : ''}`;
    st.setAttribute('role', 'status');
    st.setAttribute('aria-live', 'polite');
    st.textContent = m.status?.text ?? '';
    view.append(st);
    body.append(view);
    this.root.setAttribute('aria-busy', String(m.busy));
    this.focusCurrent(m.focus !== this.lastFocus);
  }

  private button(a: MenuAction): HTMLButtonElement {
    const d = this.doc;
    const qa = a.id === 'qa-start' ? this.o.qaButton ?? null : null;
    const b = qa ?? d.createElement('button');
    b.type = 'button';
    b.dataset.action = a.id;
    b.textContent = a.label;
    b.className = a.tone ?? '';
    b.disabled = !!a.disabled;
    b.hidden = false;
    b.title = a.hint ?? '';
    if (a.pressed !== undefined) b.setAttribute('aria-pressed', String(a.pressed));
    if (!qa) b.addEventListener('click', () => { void this.ctl.activate(a.id); });
    return b;
  }
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** The boot progress line under the menu (the heavy game files loading in the background). */
export function bootLine(el: HTMLElement | null): (frac: number, label: string, done: boolean) => void {
  if (!el) return () => {};
  const d = el.ownerDocument;
  el.replaceChildren();
  const t = d.createElement('div');
  const track = d.createElement('div');
  track.className = 'track';
  const fill = d.createElement('div');
  fill.className = 'fill';
  track.append(fill);
  el.append(t, track);
  return (frac, label, done) => {
    t.textContent = label;
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    el.classList.toggle('done', done);
  };
}

// ---------------------------------------------------------------------------------------------
// The settings form (menu + pause menu; one store)

export interface SettingsFormOptions {
  /** Element id prefix: 'set-' keeps the pause menu's historical ids (#set-mute / #set-quality are read by game.ts). */
  idPrefix: string;
  /** The current CSS viewport + device pixel ratio (the render-resolution labels / readout). */
  viewport?: () => {w: number; h: number; dpr: number};
}

/** Builds the settings controls into `box` (replacing its children), bound both ways to `store`. Returns an unsubscribe. */
export function mountSettingsForm(box: HTMLElement, store: SettingsStore, o: SettingsFormOptions): () => void {
  const d = box.ownerDocument;
  const P = o.idPrefix;
  const vp = o.viewport ?? (() => ({w: globalThis.innerWidth ?? 1280, h: globalThis.innerHeight ?? 720, dpr: globalThis.devicePixelRatio ?? 1}));
  box.replaceChildren();
  const label = (text: string, cls?: string) => { const l = d.createElement('label'); if (cls) l.className = cls; l.append(text, ' '); return l; };
  const range = (id: string, text: string, min: number, max: number, step: number, fmt: (v: number) => string, get: (s: Readonly<GameSettings>) => number, set: (v: number) => Partial<GameSettings>) => {
    const l = label(text);
    const i = d.createElement('input');
    i.id = P + id; i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step);
    const out = d.createElement('output');
    out.htmlFor.add?.(i.id);
    l.append(i, out);
    i.addEventListener('input', () => store.set(set(Number(i.value))));
    box.append(l);
    return (s: Readonly<GameSettings>) => { const v = get(s); if (Number(i.value) !== v) i.value = String(v); out.textContent = fmt(v); };
  };
  const check = (id: string, text: string, key: 'muted' | 'invertY') => {
    const l = d.createElement('label');
    l.className = 'check';
    const i = d.createElement('input');
    i.id = P + id; i.type = 'checkbox';
    i.addEventListener('change', () => store.set({[key]: i.checked} as Partial<GameSettings>));
    l.append(i, ' ', text);
    box.append(l);
    return (s: Readonly<GameSettings>) => { if (i.checked !== s[key]) i.checked = s[key]; };
  };
  const sync: ((s: Readonly<GameSettings>) => void)[] = [];
  const B = SETTINGS_BOUNDS;
  sync.push(range('sens', 'Mouse sensitivity', B.sens.min, B.sens.max, B.sens.step, v => v.toFixed(2), s => s.sens, v => ({sens: v})));
  sync.push(check('invert', 'Invert mouse Y', 'invertY'));
  sync.push(range('fov', 'Field of view', B.fov.min, B.fov.max, B.fov.step, v => `${v.toFixed(0)}°`, s => s.fov, v => ({fov: v})));
  sync.push(range('vol', 'Master volume', 0, 100, 1, v => `${v} %`, s => volumePercent(s.volume), v => ({volume: volumeFromPercent(v)})));
  sync.push(check('mute', 'Mute audio (M)', 'muted'));
  // quality (its own documented effects only)
  {
    const l = label('Quality');
    const sel = d.createElement('select');
    sel.id = P + 'quality';
    for (const [v, t] of [['low', 'Low (faster)'], ['high', 'High']] as const) { const op = d.createElement('option'); op.value = v; op.textContent = t; sel.append(op); }
    sel.addEventListener('change', () => store.set({quality: sel.value === 'low' ? 'low' : 'high'}));
    l.append(sel);
    box.append(l);
    sync.push(s => { if (sel.value !== s.quality) sel.value = s.quality; });
  }
  // render resolution (a linear scale; not a preset)
  {
    const l = label('Render resolution');
    const sel = d.createElement('select');
    sel.id = P + 'res';
    sel.title = 'A linear scale of the render width and height (Native = the device-pixel-ratio-capped drawing buffer). Nothing else changes: Quality keeps its own settings.';
    sel.addEventListener('change', () => store.set({renderScale: Number(sel.value) as RenderScale}));
    l.append(sel);
    const readout = d.createElement('div');
    readout.className = 'set-readout';
    readout.id = P + 'res-readout';
    box.append(l, readout);
    const fill = (s: Readonly<GameSettings>) => {
      const {w, h, dpr} = vp();
      const opts = renderScaleOptions(dpr, s.quality);
      if (sel.options.length !== opts.length || opts.some((op, k) => sel.options[k].textContent !== op.label)) {
        sel.replaceChildren(...opts.map(op => { const e = d.createElement('option'); e.value = String(op.value); e.textContent = op.label; return e; }));
      }
      if (sel.value !== String(s.renderScale)) sel.value = String(s.renderScale);
      readout.textContent = renderScaleReadout(w, h, dpr, s.quality, s.renderScale);
    };
    sync.push(fill);
  }
  const note = d.createElement('p');
  note.className = 'set-note';
  box.append(note);
  sync.push(() => {
    const r = store.loadReport;
    note.textContent = !store.persistent
      ? 'This browser refused to store settings: they apply for this session only.'
      : r.source === 'invalid' ? 'Settings are saved on this device. Some stored values were invalid and were reset to their defaults.'
        : 'Settings are saved on this device (this browser) and apply in the menu and in game.';
  });
  const all = (s: Readonly<GameSettings>) => { for (const f of sync) f(s); };
  all(store.get());
  const off = store.subscribe(s => all(s));
  const onResize = () => all(store.get());
  globalThis.addEventListener?.('resize', onResize);
  return () => { off(); globalThis.removeEventListener?.('resize', onResize); };
}
