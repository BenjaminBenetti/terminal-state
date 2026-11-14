// Task studio-baked-lighting-reflections-20261114-050258-01: the game-side runtime of ENHANCED LIGHTING (world/enhancedLighting.ts is
// the contract): what the live station was built with, the derived cache, and the status every surface shows. (Lead's stub: the bake,
// the probes and the cache wiring land in this file; the interface below is what the settings form / overlay / QA may rely on.)

import {ENHANCED_LIGHTING_DEFAULT, REFLECTIONS_DEFAULT, type EnhancedLightingActive, type EnhancedLightingRequest, type EnhancedLightingStatus} from './enhancedLighting';
import type {DerivedCacheStats} from '../core/derivedCache';

/** The two settings as the game holds them (game.ts Settings; optional: hosts / tests from before them read the defaults). */
export interface EnhancedLightingSettings { enhancedLighting?: EnhancedLightingRequest['lighting']; reflections?: EnhancedLightingRequest['reflections'] }

export class EnhancedLightingRuntime {
  private active: EnhancedLightingActive | null = null;
  constructor(private readonly settings: EnhancedLightingSettings) {}

  /** What the player asked for right now. */
  request(): EnhancedLightingRequest {
    return {lighting: this.settings.enhancedLighting ?? ENHANCED_LIGHTING_DEFAULT, reflections: this.settings.reflections ?? REFLECTIONS_DEFAULT};
  }

  /** What the live station uses, what was asked, and whether a change is waiting for the next station load. */
  status(): EnhancedLightingStatus {
    return {requested: this.request(), active: this.active, pending: false, cacheBackend: 'none'};
  }

  private readonly listeners = new Set<() => void>();
  /** Told whenever status() may have changed (a station was built, the cache was cleared). Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  protected changed(): void {
    for (const fn of [...this.listeners]) { try { fn(); } catch (err) { console.warn('enhanced lighting: a status listener failed', err); } }
  }

  /** The derived cache's numbers (null while it was never opened: enhanced lighting off all session). Never rejects. */
  async cacheStats(): Promise<DerivedCacheStats | null> { return null; }

  /** Delete every cached bake of this browser (they are rebuilt when next needed). Never rejects. */
  async clearCache(): Promise<void> { this.changed(); }
}
