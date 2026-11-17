// Task studio-subway-architecture-materials-rework-20261117-072826-01: a layout-version-3 grand hall's SECTION record (gen/stationHallV3.ts)
// in world coordinates — a leaf module (no generator imports) read by the hall's dresser, the hall light plan and tests / QA.

import {CELL} from './grid';
import type {Area, HallSection} from './stationTypes';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A version-3 hall's section in WORLD coordinates (along = x, across = z for a hall along X); null without one. */
export function hallSectionWorld(a: Area): HallSection | null {
  const S = a.hallSection;
  if (!S) return null;
  const al = (S.alongX ? a.x : a.y) * CELL, ac = (S.alongX ? a.y : a.x) * CELL;
  const A = (v: number) => r2(v + al), C = (v: number) => r2(v + ac);
  const span = (s: readonly [number, number], f: (v: number) => number): [number, number] => [f(s[0]), f(s[1])];
  return {
    ...S, nave: span(S.nave, C), aisles: S.aisles.map(s => span(s, C)), arcades: S.arcades.map(C), lines: S.lines.map(A),
    ...(S.transept ? {transept: span(S.transept, A)} : {}), spine: span(S.spine, C),
  };
}
