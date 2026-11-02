// Task studio-alpha-campaign-foundation-20261102-230708-01 (lane SAVE): the THREE named save slots in localStorage (this browser +
// origin; campaign/types.ts SAVE_SLOTS / STORAGE_KEYS). Slots are numbered 1..3. No upload / telemetry: saves leave the browser
// only as a file the player downloads.
//
// - list(): per slot {empty, valid, meta, error, last, chars} (the menu's slot list; a damaged slot says why).
// - commit(slot, file, o): the ONLY write. The full envelope is validated first, then written to the slot key with ONE setItem
//   (atomic per key: a slot is never cleared first, so any failure leaves the previous save exactly as it was). Overwrites are
//   explicit: `overwrite: true` (a confirmed New Game / Load save) or `expectRevision` (an autosave of the run that owns the slot).
//   Revisions are monotonic per slot; a stored revision other than the expected one means another tab wrote (or deleted) the slot
//   -> {ok: false, code: 'conflict', error: 'Not saved — newer save in another tab …'} and the game decides. A full quota
//   (QuotaExceededError) / blocked storage (SecurityError) is a clear error result, never "Saved"; other slots and the settings key
//   are never touched.
// - lastSlot pointer (Continue = the last-used VALID slot, else the newest valid one), delete(slot) (that slot only),
//   exportFile(slot) -> {filename 'terminal-state-slotN-<date>.json', blob} (the menu triggers the download), importFile(slot,
//   file) -> full validation, then (replacing a used slot only with confirmReplace) a commit with meta re-derived from the run and
//   reason 'import'.
// The storage is a small adapter interface (tests use a fake Storage with a quota). Pure apart from it.

import {SAVE_SLOTS, STORAGE_KEYS, type SaveMeta} from '../campaign/types';
import {deriveMeta, saveFileText, type SaveFileV1Like} from './serialize';
import {SAVE_LIMITS, parseSaveText, type ValidateOptions} from './validate';

/** The subset of the Web Storage API the slots use (localStorage, or a fake in tests). */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

/** Chrome / Firefox count ~5 Mi UTF-16 code units of keys + values per origin. */
export const STORAGE_BUDGET_CHARS = 5 * 1024 * 1024;

/** window.localStorage when reachable (private modes / sandboxed frames may throw on access), else null. */
export function defaultSaveStorage(): SaveStorage | null {
  try {
    const s = (globalThis as {localStorage?: SaveStorage}).localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' && typeof s.removeItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

export type SlotErrorCode = 'bad-slot' | 'unavailable' | 'empty' | 'invalid' | 'too-large' | 'quota' | 'conflict' | 'occupied' | 'write-failed';
export type SlotFailure = {ok: false; code: SlotErrorCode; error: string};

export interface SlotView {
  slot: number;
  empty: boolean;
  valid: boolean;
  /** The validated metadata (null when empty or invalid). */
  meta: SaveMeta | null;
  /** Why the slot cannot be loaded (null when empty or valid). */
  error: string | null;
  /** The Continue pointer names this slot. */
  last: boolean;
  /** Stored size in UTF-16 code units (what the browser quota counts), key included. */
  chars: number;
}

export type CommitResult = {ok: true; slot: number; meta: SaveMeta; chars: number; warning?: string} | SlotFailure;
export type ReadResult = {ok: true; file: SaveFileV1Like; chars: number} | SlotFailure;
export type ExportResult = {ok: true; filename: string; blob: Blob; text: string; meta: SaveMeta} | SlotFailure;

export interface CommitOptions {
  /** Autosave of the run that owns the slot: the revision it last wrote / loaded there (anything else stored = refused). */
  expectRevision?: number;
  /** An explicitly CONFIRMED overwrite (New Game into a used slot / Load save replacing a slot). */
  overwrite?: boolean;
  /** meta.reason to record (default: the file's own). */
  reason?: string;
}

export interface SlotChange { slot: number | null; external: boolean }

export interface SaveSlotsOptions {
  /** Default: window.localStorage (null = storage unavailable: every operation reports it). */
  storage?: SaveStorage | null;
  validate?: ValidateOptions;
  now?: () => Date;
  /** Listen to `storage` events of other tabs (default: when a window exists). */
  listen?: boolean;
}

const failure = (code: SlotErrorCode, error: string): SlotFailure => ({ok: false, code, error});

const errName = (e: unknown): string => String((e as {name?: unknown})?.name ?? '');
const errCode = (e: unknown): number => Number((e as {code?: unknown})?.code ?? 0);
export const isQuotaError = (e: unknown): boolean => {
  const n = errName(e);
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || errCode(e) === 22 || errCode(e) === 1014;
};
export const isSecurityError = (e: unknown): boolean => errName(e) === 'SecurityError' || errCode(e) === 18;

const UNAVAILABLE = 'Saving is unavailable: this browser blocks site storage here (private mode or a privacy setting). Nothing was saved.';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 'terminal-state-slot2-2026-11-02-2330.json' (UTC time of the save). */
export function exportFilename(slot: number, savedAt: string): string {
  const d = new Date(savedAt);
  const stamp = Number.isFinite(d.getTime())
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
    : 'undated';
  return `terminal-state-slot${slot}-${stamp}.json`;
}

/** A JSON download of save text (for a slot, or a live capture when storage is off). */
export function saveBlob(text: string): Blob {
  return new Blob([text], {type: 'application/json'});
}

/** A `storage` event's fields used here. */
interface StorageEventLike { key: string | null; newValue?: string | null }
interface EventHost {
  window?: unknown;
  addEventListener?(type: 'storage', f: (e: StorageEventLike) => void): void;
  removeEventListener?(type: 'storage', f: (e: StorageEventLike) => void): void;
}
const eventHost = (): EventHost => globalThis as unknown as EventHost;

export class SaveSlots {
  readonly count = SAVE_SLOTS;
  private readonly storage: SaveStorage | null;
  private readonly opts: ValidateOptions;
  private readonly now: () => Date;
  private readonly cache = new Map<number, {text: string; result: ReturnType<typeof parseSaveText>}>();
  private readonly listeners = new Set<(c: SlotChange) => void>();
  private readonly onStorage = (e: StorageEventLike): void => this.handleStorageEvent(e);
  private listening = false;

  constructor(o: SaveSlotsOptions = {}) {
    this.storage = o.storage === undefined ? defaultSaveStorage() : o.storage;
    this.opts = o.validate ?? {};
    this.now = o.now ?? (() => new Date());
    const g = eventHost();
    if ((o.listen ?? true) && typeof g.addEventListener === 'function' && typeof g.window !== 'undefined') {
      g.addEventListener('storage', this.onStorage);
      this.listening = true;
    }
  }

  /** Storage is reachable (a write can still fail on quota). */
  get available(): boolean {
    return this.storage !== null;
  }

  dispose(): void {
    if (this.listening) eventHost().removeEventListener?.('storage', this.onStorage);
    this.listening = false;
    this.listeners.clear();
  }

  /** Slot list / Continue / revisions changed (this instance's writes, or another tab's `storage` event). Returns unsubscribe. */
  onChange(cb: (c: SlotChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** A `storage` event (another tab of this origin wrote / removed a key). Public for tests. */
  handleStorageEvent(e: {key: string | null; newValue?: string | null}): void {
    const slot = e.key === null ? null : this.slotOfKey(e.key);
    if (e.key !== null && slot === null && e.key !== STORAGE_KEYS.lastSlot) return;
    if (slot === null) this.cache.clear(); else this.cache.delete(slot);
    this.emit({slot, external: true});
  }

  private emit(c: SlotChange): void {
    for (const cb of [...this.listeners]) { try { cb(c); } catch (err) { console.warn('save slots: a change listener failed', err); } }
  }

  private slotOfKey(key: string): number | null {
    for (let s = 1; s <= SAVE_SLOTS; s++) if (STORAGE_KEYS.slot(s) === key) return s;
    return null;
  }

  private validSlot(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 1 && slot <= SAVE_SLOTS;
  }

  private badSlot(slot: number): SlotFailure {
    return failure('bad-slot', `There is no save slot ${String(slot)} (slots are 1 to ${SAVE_SLOTS}).`);
  }

  private storageFailure(e: unknown, slot: number, chars?: number): SlotFailure {
    if (isQuotaError(e)) {
      const need = chars ? ` (this save needs about ${Math.ceil(chars / 1024)} K characters)` : '';
      return failure('quota', `Not saved: this browser's storage for the game is full${need}. Slot ${slot} still holds its previous save. Delete or export another slot to make room.`);
    }
    if (isSecurityError(e)) return failure('unavailable', UNAVAILABLE);
    return failure('write-failed', `Not saved: the browser refused to store the save (${errName(e) || 'storage error'}). Slot ${slot} still holds its previous save.`);
  }

  /** The raw stored text of a slot (null = empty), or a failure when storage cannot be read. */
  private raw(slot: number): {ok: true; text: string | null} | SlotFailure {
    if (!this.storage) return failure('unavailable', UNAVAILABLE);
    try { return {ok: true, text: this.storage.getItem(STORAGE_KEYS.slot(slot))}; } catch (e) { return isSecurityError(e) ? failure('unavailable', UNAVAILABLE) : failure('write-failed', `The browser could not read save slot ${slot} (${errName(e) || 'storage error'}).`); }
  }

  /** Validate stored text (cached per slot while the text is unchanged). */
  private parsed(slot: number, text: string): ReturnType<typeof parseSaveText> {
    const c = this.cache.get(slot);
    if (c && c.text === text) return c.result;
    const result = parseSaveText(text, this.opts);
    this.cache.set(slot, {text, result});
    return result;
  }

  /** The stored revision of a slot: 0 = empty, -1 = unreadable / invalid (only an explicit overwrite replaces it). */
  revision(slot: number): number {
    if (!this.validSlot(slot)) return -1;
    const r = this.raw(slot);
    if (!r.ok) return -1;
    if (r.text === null) return 0;
    const p = this.parsed(slot, r.text);
    return p.ok ? p.value.meta.revision : -1;
  }

  list(): SlotView[] {
    const last = this.lastSlot();
    const out: SlotView[] = [];
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const r = this.raw(slot), key = STORAGE_KEYS.slot(slot);
      if (!r.ok) { out.push({slot, empty: true, valid: false, meta: null, error: r.error, last: false, chars: 0}); continue; }
      if (r.text === null) { out.push({slot, empty: true, valid: false, meta: null, error: null, last: false, chars: 0}); continue; }
      const p = this.parsed(slot, r.text);
      out.push({slot, empty: false, valid: p.ok, meta: p.ok ? p.value.meta : null, error: p.ok ? null : p.error, last: last === slot, chars: key.length + r.text.length});
    }
    return out;
  }

  /** A slot's validated save. */
  read(slot: number): ReadResult {
    if (!this.validSlot(slot)) return this.badSlot(slot);
    const r = this.raw(slot);
    if (!r.ok) return r;
    if (r.text === null) return failure('empty', `Save slot ${slot} is empty.`);
    const p = this.parsed(slot, r.text);
    if (!p.ok) return failure('invalid', p.error);
    return {ok: true, file: structuredClone(p.value), chars: STORAGE_KEYS.slot(slot).length + r.text.length};
  }

  /**
   * Write a save into a slot (see the header): validated first, one setItem, verified; the previous value survives any failure.
   * meta.slot / revision / savedAt are assigned here.
   */
  commit(slot: number, file: SaveFileV1Like, o: CommitOptions = {}): CommitResult {
    if (!this.validSlot(slot)) return this.badSlot(slot);
    if (!this.storage) return failure('unavailable', UNAVAILABLE);
    const key = STORAGE_KEYS.slot(slot);
    const r = this.raw(slot);
    if (!r.ok) return r;
    const stored = r.text === null ? null : this.parsed(slot, r.text);
    const prev = stored === null ? 0 : stored.ok ? stored.value.meta.revision : -1;
    if (o.overwrite !== true) {
      if (o.expectRevision !== undefined) {
        if (r.text === null && o.expectRevision > 0) return failure('conflict', `Not saved — slot ${slot} was deleted in another tab. Choose a slot to save this run again.`);
        if (prev !== o.expectRevision) {
          return failure('conflict', prev > o.expectRevision
            ? `Not saved — newer save in another tab (slot ${slot} is at revision ${prev}; this game last saw revision ${o.expectRevision}).`
            : `Not saved — slot ${slot} was changed by another tab or is damaged.`);
        }
      } else if (r.text !== null) return failure('occupied', `Slot ${slot} already holds a save. Confirm to overwrite it.`);
    }
    const revision = Math.max(prev, o.expectRevision ?? 0, 0) + 1;
    const meta: SaveMeta = {...file.meta, slot, revision, savedAt: this.now().toISOString(), reason: o.reason ?? file.meta.reason};
    const text = saveFileText({...file, meta});
    const v = parseSaveText(text, this.opts);
    if (!v.ok) return failure(text.length > SAVE_LIMITS.fileBytes ? 'too-large' : 'invalid', `Not saved: ${v.error}`);
    try { this.storage.setItem(key, text); } catch (e) { return this.storageFailure(e, slot, key.length + text.length); }
    let back: string | null = null;
    try { back = this.storage.getItem(key); } catch { /* reported below */ }
    if (back !== text) return failure('write-failed', `The browser did not keep the save in slot ${slot} (another tab may have written it at the same moment).`);
    this.cache.set(slot, {text, result: v});
    let warning: string | undefined;
    try { this.storage.setItem(STORAGE_KEYS.lastSlot, String(slot)); } catch { warning = 'Saved, but the Continue pointer could not be updated.'; }
    this.emit({slot, external: false});
    return {ok: true, slot, meta: v.value.meta, chars: key.length + text.length, ...(warning ? {warning} : {})};
  }

  /** Remove ONE slot (and the Continue pointer if it named that slot). */
  delete(slot: number): {ok: true} | SlotFailure {
    if (!this.validSlot(slot)) return this.badSlot(slot);
    if (!this.storage) return failure('unavailable', UNAVAILABLE);
    try {
      this.storage.removeItem(STORAGE_KEYS.slot(slot));
      if (this.lastSlot() === slot) this.storage.removeItem(STORAGE_KEYS.lastSlot);
    } catch (e) { return this.storageFailure(e, slot); }
    this.cache.delete(slot);
    this.emit({slot, external: false});
    return {ok: true};
  }

  /** The Continue pointer (null: none / unreadable). */
  lastSlot(): number | null {
    if (!this.storage) return null;
    try {
      const n = Number(this.storage.getItem(STORAGE_KEYS.lastSlot));
      return this.validSlot(n) ? n : null;
    } catch { return null; }
  }

  /** Remember a slot as last used (a load: Continue resumes it). Best effort. */
  setLastSlot(slot: number): boolean {
    if (!this.validSlot(slot) || !this.storage) return false;
    try { this.storage.setItem(STORAGE_KEYS.lastSlot, String(slot)); return true; } catch { return false; }
  }

  /** Continue: the last-used slot if it holds a valid save, else the most recently saved valid slot, else null. */
  continueSlot(): number | null {
    const views = this.list().filter(v => v.valid && v.meta);
    const last = this.lastSlot();
    if (last !== null && views.some(v => v.slot === last)) return last;
    views.sort((a, b) => Date.parse(b.meta!.savedAt) - Date.parse(a.meta!.savedAt));
    return views[0]?.slot ?? null;
  }

  /** A slot's save as a download (the exact stored text, validated). The menu triggers the download. */
  exportFile(slot: number): ExportResult {
    if (!this.validSlot(slot)) return this.badSlot(slot);
    const r = this.raw(slot);
    if (!r.ok) return r;
    if (r.text === null) return failure('empty', `Save slot ${slot} is empty — nothing to export.`);
    const p = this.parsed(slot, r.text);
    if (!p.ok) return failure('invalid', p.error);
    return {ok: true, filename: exportFilename(slot, p.value.meta.savedAt), blob: saveBlob(r.text), text: r.text, meta: p.value.meta};
  }

  /** Validate an import candidate without writing (the menu shows its metadata in the replace confirmation). */
  async inspectFile(input: Blob | string): Promise<{ok: true; file: SaveFileV1Like} | SlotFailure> {
    const t = await readInput(input);
    if (!t.ok) return t;
    const p = parseSaveText(t.text, this.opts);
    return p.ok ? {ok: true, file: p.value} : failure(t.text.length > SAVE_LIMITS.fileBytes ? 'too-large' : 'invalid', p.error);
  }

  /**
   * LOAD SAVE: import an exported file into the CHOSEN slot. Fully validated first; a slot that holds a save is replaced only with
   * `confirmReplace`. The stored metadata is re-derived from the run (never trusted from the file), reason 'import'.
   */
  async importFile(slot: number, input: Blob | string, o: {confirmReplace?: boolean} = {}): Promise<CommitResult> {
    if (!this.validSlot(slot)) return this.badSlot(slot);
    const f = await this.inspectFile(input);
    if (!f.ok) return f;
    const r = this.raw(slot);
    if (!r.ok) return r;
    if (r.text !== null && o.confirmReplace !== true) return failure('occupied', `Slot ${slot} already holds a save. Confirm to replace it with the imported save.`);
    const file = f.file;
    const meta = deriveMeta(file.run, {slot, revision: 0, savedAt: file.meta.savedAt, reason: 'import', build: file.meta.build});
    return this.commit(slot, {...file, meta}, {overwrite: true, reason: 'import'});
  }

  /** Storage use (UTF-16 code units of keys + values) against the ~5 Mi per-origin budget. */
  usage(): {slots: number[]; saves: number; total: number | null; budget: number} {
    const slots = this.list().map(v => v.chars);
    const saves = slots.reduce((a, b) => a + b, 0);
    let total: number | null = null;
    const st = this.storage;
    if (st && typeof st.length === 'number' && typeof st.key === 'function') {
      try {
        total = 0;
        for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k !== null) total += k.length + (st.getItem(k) ?? '').length; }
      } catch { total = null; }
    }
    return {slots, saves, total, budget: STORAGE_BUDGET_CHARS};
  }
}

async function readInput(input: Blob | string): Promise<{ok: true; text: string} | SlotFailure> {
  const limit = SAVE_LIMITS.fileBytes;
  if (typeof input === 'string') return {ok: true, text: input};
  if (!input || typeof (input as Blob).text !== 'function') return failure('invalid', 'This is not a Terminal State save file.');
  if (input.size > limit) return failure('too-large', `This save file is too large (${(input.size / 1048576).toFixed(1)} MiB; the limit is ${limit / 1048576} MiB).`);
  try { return {ok: true, text: await input.text()}; } catch { return failure('invalid', 'The file could not be read.'); }
}
