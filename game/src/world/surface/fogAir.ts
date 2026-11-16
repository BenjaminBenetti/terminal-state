// Task studio-surface-run-field-followup-20261116-211729-01 (lane FOG): what the FOG PRESSURE of a version-2 district does to the outdoor
// air — ONE set of pure functions of the one field (world/surface/fogPressure.ts fogPressureAt) read by everything that hurts or shows
// (root CLAUDE.md "Toxic gas is always VISIBLE green volumetric fog": what looks gassy hurts, what hurts looks gassy). No three.js / DOM.
//
//  - THE AIR (exposure): the outdoor concentration rises with the pressure from the district's C (0.6) to 1 at pressure 1 (the normal
//    rules then read it: 4.4 -> 8 hp/s unprotected; mask / filter / Airtank stop that part as everywhere).
//  - ON FOOT (exposure): from FOG_PRESSURE.foot a PRESSURE term gas protection does NOT stop — fogPressureDps: 0 at foot, FOG_AIR.dps at
//    1, growing on past it toward the edge (nothing survives long out there); x the column's outdoor weight (a sealed interior keeps it
//    out, like the gas). The HUD says "Gas pressure too high".
//  - THE LOOK: the visible green fog THICKENS with the pressure — fogDensity = (c / C) x fogThicken: the march's outdoor extinction is
//    the base look x it (render/volumetricShaders.ts: the same constants as plain uniforms), beyond the march's reach its EXCESS over
//    the base continues to the visible surface (the far term: what lies out there is seen through the fog that is there), and with the
//    pass off the scene fog at the eye thickens by it (world/surface/airFog.ts: the in-engine fallback).
//  - THE BANK: all of it fades out high over the street (FOG_AIR.bank: a ground fog bank tens of metres deep, never a green sky dome);
//    every walkable height is far below it.

import {FOG_PRESSURE} from './fogPressure';

export const FOG_AIR = {
  /** Visual thickening: fogThicken(p) = 1 + gain · min(p, cap)^expo (x the bank). */
  gain: 8.25, expo: 1.25, cap: 1.6,
  /** On-foot pressure damage (hp/s) at pressure 1; the growth per unit of pressure beyond 1; the ceiling. */
  dps: 24, beyond: 2, dpsMax: 60,
  /** The fog bank's top ramp (absolute m): full below y0, gone above y1. */
  bank: {y0: 45, y1: 90},
  /** The in-engine fallback (pass off): the share of the march's thickening the scene fog takes at the eye; its green blend at pressure 1. */
  fallbackGain: 0.7, fallbackBlend: 0.85,
} as const;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The fog bank at height y: 1 at street level .. 0 above FOG_AIR.bank.y1. */
export function fogBank(y: number): number {
  return 1 - sstep(FOG_AIR.bank.y0, FOG_AIR.bank.y1, y);
}

/** The outdoor concentration at pressure p and height y for a district of base concentration c0 (before the column weight). */
export function fogConcentration(c0: number, p: number, y: number): number {
  if (!(c0 > 0)) return 0;
  return c0 + (1 - c0) * clamp01(p) * fogBank(y);
}

/** The visual thickening of the outdoor fog at pressure p and height y (1 = the base look). */
export function fogThicken(p: number, y: number): number {
  const q = Math.min(Math.max(0, p), FOG_AIR.cap);
  return 1 + FOG_AIR.gain * Math.pow(q, FOG_AIR.expo) * fogBank(y);
}

/** THE visual density of the outdoor air relative to the base look (c / c0 x thickening): 1 at pressure 0. */
export function fogDensity(c0: number, p: number, y: number): number {
  return c0 > 0 ? (fogConcentration(c0, p, y) / c0) * fogThicken(p, y) : 0;
}

/** The on-foot damage per second the pressure deals THROUGH gas protection (0 up to FOG_PRESSURE.foot). */
export function fogPressureDps(p: number): number {
  if (!(p > FOG_PRESSURE.foot)) return 0;
  if (p <= FOG_PRESSURE.full) { const s = (p - FOG_PRESSURE.foot) / (FOG_PRESSURE.full - FOG_PRESSURE.foot); return FOG_AIR.dps * s * s; }
  return Math.min(FOG_AIR.dpsMax, FOG_AIR.dps * (1 + FOG_AIR.beyond * (p - FOG_PRESSURE.full)));
}

/** Is the pressure past what gas protection can hold ("Gas pressure too high")? */
export const fogPressureHigh = (p: number): boolean => p > FOG_PRESSURE.foot;
