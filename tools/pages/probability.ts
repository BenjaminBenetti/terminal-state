// Task loot-reference-pages-20261030 (lane DATA): the probability helpers of the loot reference — pure maths, no game imports.
//
// Every function here is EXACT under the roll's stated distribution with ideal uniform draws (the game's mulberry32 streams are
// the empirical stand-in; game/tests/loot-reference.test.ts checks the composed results against the real roll functions).
// Definitions (docs/loot-reference.md "Probability definitions"):
//  - a row's SHARE is weight / Σ weights of its table (the conditional selection chance given one draw from that table);
//  - a lot count n ~ U{lo..hi} has E[n] = (lo + hi) / 2;
//  - with i.i.d. per-lot outcomes, P(>= 1 lot of X | rolled) = 1 - E_n[(1 - y)^n] where y = P(one lot is X).

/** Significant digits of DERIVED values (shares, expectations, chances). Raw source values (weights, chances) are never rounded. */
export const DERIVED_DIGITS = 8;
/** Rounds a DERIVED value to DERIVED_DIGITS significant digits (compact, stable JSON across engines). Throws on non-finite values. */
export function rd(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`non-finite derived value ${x}`);
  return x === 0 ? 0 : +x.toPrecision(DERIVED_DIGITS);
}

/** Σ of the weights (the share denominator). Negative / non-finite weights are a data error. */
export function denominator(weights: readonly number[]): number {
  let s = 0;
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) throw new Error(`invalid weight ${w}`);
    s += w;
  }
  return s;
}

/** Conditional shares weight / Σ (all 0 for an empty / zero-weight table: nothing can be drawn). */
export function shares(weights: readonly number[]): number[] {
  const d = denominator(weights);
  return weights.map(w => (d > 0 ? w / d : 0));
}

/**
 * What the game's pick walk (items/loot.ts pick, items/lootEconomy.ts pickRow, core/rng.ts Rng.weighted: `x = r() * total`, subtract
 * each weight, first row where x < 0, else the LAST row) actually draws: row i with weight_i / Σ when Σ > 0; when every weight is 0
 * (but rows exist) x stays 0 and the walk returns the LAST row every time. Empty list: nothing (callers skip it).
 */
export function pickProbs(weights: readonly number[]): number[] {
  const d = denominator(weights);
  if (d > 0) return weights.map(w => w / d);
  return weights.map((_, i) => (i === weights.length - 1 ? 1 : 0));
}
export const ZERO_SUM_NOTE = 'every weight is 0: the pick walk returns the LAST row every time (items/loot.ts pick)';

/** Uniform integer range U{lo..hi}: P(n) for each n. */
export function uniformInt(lo: number, hi: number): {n: number; p: number}[] {
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new Error(`bad range [${lo}, ${hi}]`);
  const k = hi - lo + 1;
  return Array.from({length: k}, (_, i) => ({n: lo + i, p: 1 / k}));
}

/** E[n] of U{lo..hi}. */
export function meanInt(lo: number, hi: number): number {
  if (hi < lo) throw new Error(`bad range [${lo}, ${hi}]`);
  return (lo + hi) / 2;
}

/** E_n[(1 - y)^n] for n ~ U{lo..hi}: the chance that none of n i.i.d. lots is X when each is X with probability y. */
export function noneOfN(lo: number, hi: number, y: number): number {
  let s = 0;
  for (const {n, p} of uniformInt(lo, hi)) s += p * Math.pow(1 - y, n);
  return s;
}

/**
 * P(>= 1 lot of X) for a holder roll: not empty with probability `pRoll`, then n ~ U{lo..hi} i.i.d. lots each X with probability
 * `y` (y = the per-lot probability after every per-lot stage).
 */
export function atLeastOne(pRoll: number, lo: number, hi: number, y: number): number {
  return pRoll * (1 - noneOfN(lo, hi, y));
}

/** P(k) of gen/gearLoot.ts gearCountFor: inverse-CDF Poisson(mean) capped at `cap` (all tail mass lands on cap). */
export function cappedPoisson(mean: number, cap: number): {k: number; p: number}[] {
  if (!(mean >= 0) || !Number.isInteger(cap) || cap < 0) throw new Error(`bad Poisson(${mean}) cap ${cap}`);
  const out: {k: number; p: number}[] = [];
  let p = Math.exp(-mean), cdf = 0;
  for (let k = 0; k < cap; k++) {
    out.push({k, p});
    cdf += p;
    p *= mean / (k + 1);
  }
  out.push({k: cap, p: Math.max(0, 1 - cdf)});
  return out;
}

/** Σ k P(k). */
export function expectation(dist: readonly {k: number; p: number}[]): number {
  return dist.reduce((s, d) => s + d.k * d.p, 0);
}

/**
 * Weighted draws WITHOUT removal where each pick halves the picked item's weight (gen/gearLoot.ts rollLevelGear: `w[id] *= 0.5`),
 * `n` picks: exact per-item P(>= 1 copy) and E[copies], by dynamic programming over the copy-count states. `factor` = the weight
 * multiplier applied to a picked item (0.5 in the game).
 */
export function halvingPicks(weights: readonly (readonly [string, number])[], n: number, factor = 0.5): {id: string; pAny: number; mean: number}[] {
  const ids = weights.map(w => w[0]);
  let states = new Map<string, {c: number[]; p: number}>([['', {c: ids.map(() => 0), p: 1}]]);
  for (let step = 0; step < n; step++) {
    const next = new Map<string, {c: number[]; p: number}>();
    for (const {c, p} of states.values()) {
      const w = weights.map(([, x], i) => x * Math.pow(factor, c[i]));
      const total = w.reduce((a, b) => a + b, 0);
      if (!(total > 0)) { const key = c.join(','); const e = next.get(key); if (e) e.p += p; else next.set(key, {c, p}); continue; }
      w.forEach((x, i) => {
        if (!(x > 0)) return;
        const c2 = c.slice();
        c2[i]++;
        const key = c2.join(',');
        const e = next.get(key);
        if (e) e.p += p * x / total; else next.set(key, {c: c2, p: p * x / total});
      });
    }
    states = next;
  }
  return ids.map((id, i) => {
    let pAny = 0, mean = 0;
    for (const {c, p} of states.values()) { if (c[i] > 0) pAny += p; mean += p * c[i]; }
    return {id, pAny, mean};
  });
}

/**
 * gen/office/spawns.ts placeOfficeSupplies tower box: one uniform r, `findIndex((t, k) => r < t'_k)` over the (override-scaled)
 * cumulative thresholds: P(box i) = max(0, min(1, t'_i) - max(0, max_{k<i} t'_k)); P(none) = the rest.
 */
export function thresholdBands(thresholds: readonly number[]): {probs: number[]; none: number} {
  const probs: number[] = [];
  let floor = 0, used = 0;
  for (const t of thresholds) {
    const p = Math.max(0, Math.min(1, t) - floor);
    probs.push(p);
    used += p;
    floor = Math.max(floor, Math.min(1, t));
  }
  return {probs, none: Math.max(0, 1 - used)};
}
