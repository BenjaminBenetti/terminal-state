// Task studio-first-player-onboarding-20261111-234657-01: the player's TUTORIAL / ONBOARDING state, persisted locally (this browser +
// origin) under STORAGE_KEYS.onboarding. It is BROWSER-GLOBAL: one record shared by every save slot and campaign in this browser, never
// part of a save file (save/serialize.ts never reads it, so an exported / imported save carries none of it), so a finished tutorial
// stays finished across visits, reloads and new saves.
//
//  - The record: {v: 1, done: {<tutorial id>: ISO time it was completed}}. Only the known ids are read; anything else stored (another
//    build, a hand edit, garbage) reads as "not done" for that id. Invalid JSON = nothing done.
//  - complete(id) writes the record once (a second call keeps the first time). reset() ("Reset tutorials": main-menu Settings and the
//    pause menu) removes ONLY this key: the save slots, the last-slot pointer, the settings and the milestones are never touched.
//  - Storage that throws (private mode, quota, disabled) = the state still applies for this session (`persistent` false).
//  - Listeners hear 'complete' / 'reset' / 'reload' (another tab changed the record: the window 'storage' event -> reload()), so the
//    train's markers (world/trainOnboarding.ts) re-arm or hide at once.

import {STORAGE_KEYS} from '../campaign/types';

/** The tutorials that exist (the train's first-player markers; future tutorials add ids here). */
export type TutorialId = 'train';
export const TUTORIAL_IDS: readonly TutorialId[] = ['train'];

/** Stored record version. */
export const ONBOARDING_VERSION = 1;

/** The subset of the Web Storage API used here (tests pass a fake; removeItem is optional: without it a reset writes an empty record). */
export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Completion time (ISO) per finished tutorial. */
export type OnboardingDone = Partial<Record<TutorialId, string>>;

export type OnboardingEvent = {kind: 'complete'; id: TutorialId} | {kind: 'reset'} | {kind: 'reload'};
export type OnboardingListener = (e: OnboardingEvent, store: OnboardingStore) => void;

/** Parse the stored string: the known ids with a valid ISO time (null / garbage = nothing done). */
export function parseOnboarding(text: string | null): OnboardingDone {
  if (!text) return {};
  let j: unknown;
  try { j = JSON.parse(text); } catch { return {}; }
  const done = j && typeof j === 'object' && !Array.isArray(j) ? (j as {done?: unknown}).done : null;
  if (!done || typeof done !== 'object' || Array.isArray(done)) return {};
  const out: OnboardingDone = {};
  for (const id of TUTORIAL_IDS) {
    const at = (done as Record<string, unknown>)[id];
    if (typeof at === 'string' && !Number.isNaN(Date.parse(at))) out[id] = at;
  }
  return out;
}

/** The stored JSON (data only). */
export function serializeOnboarding(done: OnboardingDone): string {
  return JSON.stringify({v: ONBOARDING_VERSION, done});
}

export class OnboardingStore {
  private done: OnboardingDone;
  private readonly listeners: OnboardingListener[] = [];
  /** False once storage refused a read / write: the state still applies, for this session only. */
  persistent = true;

  constructor(private readonly storage: OnboardingStorage | null, readonly key: string = STORAGE_KEYS.onboarding) {
    this.done = this.read();
  }

  private read(): OnboardingDone {
    if (!this.storage) { this.persistent = false; return {}; }
    try { return parseOnboarding(this.storage.getItem(this.key)); } catch { this.persistent = false; return {}; }
  }

  /** True when this tutorial was completed in this browser (any save, any campaign). */
  isDone(id: TutorialId): boolean {
    return this.done[id] !== undefined;
  }

  /** When it was completed (ISO), else null. */
  completedAt(id: TutorialId): string | null {
    return this.done[id] ?? null;
  }

  /** Mark a tutorial completed (persisted). True when it was newly completed now; false when it already was. */
  complete(id: TutorialId, now: Date = new Date()): boolean {
    if (this.isDone(id)) return false;
    this.done = {...this.done, [id]: now.toISOString()};
    this.write();
    this.emit({kind: 'complete', id});
    return true;
  }

  /** "Reset tutorials": forget every completed tutorial — removes this record's key only. */
  reset(): void {
    this.done = {};
    if (!this.storage) { this.persistent = false; }
    else {
      try {
        if (typeof this.storage.removeItem === 'function') this.storage.removeItem(this.key);
        else this.storage.setItem(this.key, serializeOnboarding({}));
        this.persistent = true;
      } catch { this.persistent = false; }
    }
    this.emit({kind: 'reset'});
  }

  /** Re-read storage (another tab changed it). */
  reload(): void {
    if (!this.storage) return;
    this.done = this.read();
    this.emit({kind: 'reload'});
  }

  subscribe(fn: OnboardingListener): () => void {
    this.listeners.push(fn);
    return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); };
  }

  private write(): void {
    if (!this.storage) { this.persistent = false; return; }
    try { this.storage.setItem(this.key, serializeOnboarding(this.done)); this.persistent = true; } catch { this.persistent = false; }
  }

  private emit(e: OnboardingEvent): void {
    for (const fn of [...this.listeners]) { try { fn(e, this); } catch (err) { console.warn('onboarding listener failed', err); } }
  }
}

/** localStorage when the browser allows it (null: none / access throws). */
export function browserOnboardingStorage(): OnboardingStorage | null {
  try {
    const s = (globalThis as {localStorage?: Storage}).localStorage;
    return s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null;
  } catch {
    return null;
  }
}
