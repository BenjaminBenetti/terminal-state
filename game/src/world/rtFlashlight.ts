// Task rt-flashlight-compute-20261115-233136 (lane UI): RT FLASHLIGHT — the contract of the one Graphics setting that chooses HOW the
// flashlight's bounce is made. The bounce exists only with Enhanced lighting's FULL shading (world/enhancedLighting.ts: the plan, its
// eligibility and the status text; world/enhancedLightingRuntime.ts: the live record):
//  - On (the default) where the renderer's device really runs the compute path (the WebGPU backend, its compute check passed, the
//    station's scene fits): the bounce is traced on the GPU by compute shaders (render/rt/*) INSTEAD of the virtual-light bounce
//    (world/flashBounce.ts) — the two never stack;
//  - Off, or not supported: the current virtual-light bounce, unchanged.
// It selects the bounce METHOD only: Enhanced lighting (and whether its shading is full) decides whether there is a bounce at all. No
// tuning: no sample counts, no sliders. An explicit Off stays Off (ui/settingsStore.ts keeps the boolean `rtFlashlight`).
// The player-facing copy says "traced on the GPU" / "compute" and makes no performance promise.
//
// This module is a LEAF: no three, no DOM and no runtime import (world/enhancedLighting.ts imports it; the reverse is type-only).

import type {EnhancedLightingActive} from './enhancedLighting';

/** The setting's name, exactly (title and pause Settings). */
export const RT_FLASHLIGHT_LABEL = 'RT Flashlight';
/** The default: On (a record from before the setting existed reads it). It is used only where it can run. */
export const RT_FLASHLIGHT_DEFAULT = true;

/** The two choices as the form shows them (stored as the boolean `rtFlashlight`). */
export type RtFlashlightChoice = 'on' | 'off';
export const RT_FLASHLIGHT_OPTIONS: readonly {value: RtFlashlightChoice; label: string}[] = [{value: 'on', label: 'On'}, {value: 'off', label: 'Off'}];
export const isRtFlashlightChoice = (v: unknown): v is RtFlashlightChoice => v === 'on' || v === 'off';
export const rtFlashlightChoice = (on: boolean): RtFlashlightChoice => (on ? 'on' : 'off');

/** The session override ?rt=on|off (main.ts; never persisted): the choice, or null for anything else (ignored). */
export function rtFlashlightParam(v: string | null | undefined): boolean | null {
  return v === 'on' ? true : v === 'off' ? false : null;
}

/**
 * What the renderer's device offers the compute path (LightingCapabilities.rt): `ok` with no reason, or not with the reason. Absent /
 * null = not probed yet (the probe finishes after the renderer is initialised: EnhancedLightingRuntime.setRtCapability).
 */
export interface RtCapability { ok: boolean; reason: string | null }

/** The traced scene of the live station (EnhancedLightingRuntime.rtInstalled): its triangles and instances, and what did not fit. */
export interface RtSceneInfo { triangles: number; instances: number; omitted?: number }

// ---------------------------------------------------------------------------------------------
// Reasons (each completes "the standard flashlight bounce — <reason>")

/** Not probed yet / no renderer (the same words as the plan's other "not ready" reasons). */
export const RT_NOT_READY_REASON = 'the renderer is not ready';
/** The WebGL 2 fallback backend: no compute shaders at all. */
export const RT_FALLBACK_REASON = 'the WebGL 2 fallback renderer has no compute shaders';
/** A capability that is not ok and gave no reason of its own. */
export const RT_UNSUPPORTED_REASON = 'this renderer does not support it';
/** The device's limits are too small for the compute path (the probe names what: `detail`). */
export const rtLimitsReason = (detail?: string | null): string => `this GPU's limits are too small for it${detail ? ` (${detail})` : ''}`;
/** The compute shaders did not build on this device (the probe's / the pipeline's message: `detail`). */
export const rtBuildFailedReason = (detail?: string | null): string => `its compute shaders failed to build${detail ? ` (${detail})` : ''}`;
/** The station's traced scene could not be prepared (rtInstalled without a reason of its own). */
export const RT_NOT_INSTALLED_REASON = 'this station\'s traced scene could not be prepared';
/** The help line while Enhanced lighting is Off (the choice is disabled; its stored value is kept) — as Reflections says it. */
export const RT_NEEDS_LIGHTING = 'Needs Enhanced lighting (it is off)';

// ---------------------------------------------------------------------------------------------
// Help-line pieces (world/enhancedLighting.ts describeRtFlashlight puts them together with the shared change notes)

/** What each choice means, without a station (or with one, when the choice is Off and there is nothing to explain). */
export function rtFlashlightSummary(on: boolean): string {
  return on ? 'On: the flashlight\'s bounce is traced on the GPU by compute shaders where this renderer supports it (else the standard bounce)'
    : 'Off: the standard flashlight bounce';
}

/** A capability that is known not to work here, before a station says more. */
export const rtUnavailableText = (reason: string): string => `Unavailable here: ${reason}`;

/** "12,345" (whole number, comma thousands; locale-independent). */
export function rtCount(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The traced scene in words: "12,345 triangles in 87 objects" (+ "; 3 left out" when some did not fit). */
export function rtSceneText(scene: RtSceneInfo): string {
  const left = scene.omitted && scene.omitted > 0 ? `; ${rtCount(scene.omitted)} left out` : '';
  return `${rtCount(scene.triangles)} triangle${Math.round(scene.triangles) === 1 ? '' : 's'} in ${rtCount(scene.instances)} object${Math.round(scene.instances) === 1 ? '' : 's'}${left}`;
}

/** The live station has the flashlight's bounce at all (full shading of an enhanced bake; a record without `shading` was plain). */
export const hasFlashBounce = (a: Pick<EnhancedLightingActive, 'gi' | 'shading'>): boolean => a.gi !== 'baseline' && a.shading === 'full';

/** Why the live station has no bounce: its RT reason when it gives one, else the reason the bake / its shading reported. */
function noBounceReason(a: EnhancedLightingActive): string | null {
  return a.rtReason ?? (a.gi === 'baseline' ? a.giReason : a.shadingReason ?? null);
}

/** What the live station's flashlight bounce really is: "This station: the flashlight's bounce is traced on the GPU (…)" / "…the standard flashlight bounce — why" / "…no flashlight bounce — why". */
export function rtStationText(a: EnhancedLightingActive): string {
  if (!hasFlashBounce(a)) { const why = noBounceReason(a); return `This station: no flashlight bounce${why ? ` — ${why}` : ''}`; }
  if (a.rt === true) return `This station: the flashlight's bounce is traced on the GPU${a.rtScene ? ` (${rtSceneText(a.rtScene)})` : ''}`;
  return `This station: the standard flashlight bounce${a.rtReason ? ` — ${a.rtReason}` : ''}`;
}

/**
 * The part of the compact line (world/enhancedLighting.ts enhancedLightingLine) that names the bounce's method: ' · bounce traced (…)' /
 * ' · bounce standard (why)'; '' for a station without the bounce and for a record from before the setting existed (no `rt` field).
 */
export function rtLineFragment(a: EnhancedLightingActive): string {
  if (a.rt === undefined || !hasFlashBounce(a)) return '';
  if (a.rt) return ` · bounce traced${a.rtScene ? ` (${Math.round(a.rtScene.triangles)} tris, ${Math.round(a.rtScene.instances)} obj${a.rtScene.omitted ? `, ${Math.round(a.rtScene.omitted)} left out` : ''})` : ''}`;
  return ` · bounce standard${a.rtReason ? ` (${a.rtReason})` : ''}`;
}
