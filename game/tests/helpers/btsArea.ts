// 2026-11-01 (lane AREA): seed selection for tests of the Beyond the Station AREA (the service annexes), which now exists on a
// generated level only when the level's ONE seeded roll succeeds (gen/trackExt/config.ts BTS_AREA_CHANCE = 0.2, btsAreaRoll(levelSeed)).
// Tests that inspect annexes keep their sample size of ANNEXES by choosing PRESENT levels with the REAL roll function (never a
// test-only override that forces the area); tests of the no-area case choose ABSENT levels the same way.
import {btsAreaPresent} from '../../src/gen/trackExt/index';

/**
 * The fresh New Game sample of the annex tests (the round 2 / 3 playtest seeds), re-chosen for the one-roll rule: every old seed rolls
 * the area ABSENT (btsAreaRoll: Subway 1043 0.66, 1002 0.33, 1037 0.96; Office 222 0.55; Mall 846932 0.61), so each role takes the
 * FIRST seed at or after the old one that rolls PRESENT and plays the same role (tests/bts-area.test.ts asserts both, every run).
 */
export const FRESH = {
  /** was 1043: one tunnel annex holding two survivor caches (and annex fans). */
  subwayTunnel: 1090,
  /** was 1002: a tunnel annex AND a bed-wall service-hatch annex. */
  subwayHatch: 1105,
  /** was 1037: an annex with generator sets (the genset model's runtime test). */
  subwayGenset: 1038,
  /** was 222: the Office street station's annex pair. */
  office: 224,
  /** was 846932: the Mall's one annex. */
  mall: 846934,
} as const;

/** The first `n` seeds seedAt(from), seedAt(from + 1), … whose level rolls the Beyond the Station area PRESENT (the real roll). */
export function presentSeeds(n: number, seedAt: (i: number) => number, from = 0): number[] {
  const out: number[] = [];
  for (let i = from; out.length < n; i++) { const s = seedAt(i) >>> 0; if (btsAreaPresent(s)) out.push(s); }
  return out;
}

/** The first `n` seeds seedAt(from), … whose level rolls the area ABSENT. */
export function absentSeeds(n: number, seedAt: (i: number) => number, from = 0): number[] {
  const out: number[] = [];
  for (let i = from; out.length < n; i++) { const s = seedAt(i) >>> 0; if (!btsAreaPresent(s)) out.push(s); }
  return out;
}
