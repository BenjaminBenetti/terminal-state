// 2026-11-01 (lane AREA): seed selection for tests of the Beyond the Station AREA (the service annexes), which now exists on a
// generated level only when the level's ONE seeded roll succeeds (gen/trackExt/config.ts BTS_AREA_CHANCE = 0.2, btsAreaRoll(levelSeed)).
// Tests that inspect annexes keep their sample size of ANNEXES by choosing PRESENT levels with the REAL roll function (never a
// test-only override that forces the area); tests of the no-area case choose ABSENT levels the same way.
import {btsAreaPresent} from '../../src/gen/trackExt/index';

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
