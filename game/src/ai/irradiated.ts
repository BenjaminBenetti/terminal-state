// Task studio-reactor-glowing-zombies-20261115-013245-01: IRRADIATED ZOMBIES — the Reactor's lower storeys get MORE regular zombies, and
// every one of the extra zombies is irradiated. Pure (no three.js, no RNG stream): the rule, the integer count, the per-storey split and the
// stats. The placement lives with the level (gen/reactor/irradiated.ts); the look, light, dose and Geiger clicks with the runtime
// (world/irradiation.ts, ai/irradiatedSkin.ts, world/glowLights.ts).
//
// User: "keep ALL existing regular zombies, then add a 40% zombie-population boost on the lower levels. EVERY added zombie is a glowing
// irradiated regular zombie with 1.5x normal health. These are additions, not replacements ... do not convert specials, humans or animals."
//
// THE RULE (roster version IRRADIATED.since, run by the level registry right after the seeded roster — levels/registry.ts):
//  - R = the REGULAR zombies standing on the level's lower storeys in the FINISHED layout: every spawn of the ordinary infected family
//    (archetype absent / 'zombie': shambler or coated, sprinter or not) after every roster family has taken its slots. Specials (Siren,
//    Blightbelly, Strainer, Screacher, BB) and animals (rat/dog) are not regular and never count, convert or move;
//  - N = round(0.4 x R) = floor((2R + 2) / 5) (irradiatedAddCount). 0.4R is never exactly half an integer (4R is even), so there is no
//    tie rule to choose: R 1 -> 0, 2 -> 1, 3 -> 1, 4 -> 2, 5 -> 2, 10 -> 4, 20 -> 8, 26 -> 10, 27 -> 11;
//  - the N are split over the storeys in proportion to each storey's own regular count (largest remainder: splitAdditions), so the
//    depth grading keeps its shape; ties go to the deeper storey;
//  - they are APPENDED after every existing spawn: no existing spawn is changed, moved, removed or reordered, so the per-index kill
//    memory, every family, sprinter, look, loot and position keep their meaning; the appended indices are the additions' own;
//  - every placement decision comes from a hash of (level seed, key): no existing RNG stream is consumed;
//  - a station recorded at an older roster version regenerates without them (ai/enemyRoster.ts VERSION PIN): an old save's visited
//    Reactor keeps exactly its old enemies and kills; a Reactor first entered at this version gets them, once, the same on every revisit,
//    Continue, Retry and import — a killed one stays dead (killed indices), nothing ever refills or respawns.
//
// THE ZOMBIE: an ordinary zombie of its type with ONLY its hp raised: IRRADIATED.hpScale x the type's (shambler 100 -> 150, coated
// 165 -> 247.5). Speeds, reach, damage, swing, senses, turn rate, radius, clips, loot and look pick are the type's own. It is never a
// sprinter (that is a different variant: the user asked for the health change only).

import type {ZombieSpawn} from '../gen/stationTypes';

export const IRRADIATED = {
  /** The first roster version (ai/enemyRoster.ts ROSTER_VERSION) that appends them: older stations regenerate without them. */
  since: 4,
  /** Stable hash key (never rename: it IS the placement). */
  key: 'irradiated',
  /** Additions per regular zombie of the lower storeys (user: a 40 % boost). */
  boost: 0.4,
  /** Their hp: this x the ordinary type's (user: 1.5x normal health). */
  hpScale: 1.5,
} as const;

/** A spawn that is an irradiated zombie: tagged by the additions pass and of the ordinary family (never a special family). */
export function isIrradiated(s: Pick<ZombieSpawn, 'archetype' | 'irradiated'>): boolean {
  return s.irradiated === true && (s.archetype ?? 'zombie') === 'zombie';
}

/** A REGULAR zombie for the boost's base count: the ordinary infected family (either type, sprinter or not), never an addition itself. */
export function isRegularZombie(s: Pick<ZombieSpawn, 'archetype' | 'irradiated'>): boolean {
  return (s.archetype ?? 'zombie') === 'zombie' && s.irradiated !== true;
}

/** N = round(IRRADIATED.boost x regular) in integers: floor((2R + 2) / 5) (0.4R is never a half: no tie). */
export function irradiatedAddCount(regular: number): number {
  if (!Number.isInteger(regular) || regular <= 0) return 0;
  return Math.floor((2 * regular + 2) / 5);
}

/**
 * Split `total` additions over storeys in proportion to their regular counts (largest remainder / Hamilton): each storey gets
 * floor(total x R_s / R), the rest one each to the largest fractional parts; ties to the deeper (higher level index) storey. Sums to
 * `total` exactly (0 when there is no regular zombie at all).
 */
export function splitAdditions(total: number, storeys: readonly {level: number; regular: number}[]): Map<number, number> {
  const out = new Map<number, number>();
  const R = storeys.reduce((n, s) => n + Math.max(0, s.regular), 0);
  for (const s of storeys) out.set(s.level, 0);
  if (total <= 0 || R <= 0) return out;
  const rows = storeys.map(s => {
    const q = total * Math.max(0, s.regular) / R, base = Math.floor(q + 1e-9);
    return {level: s.level, base, frac: q - base};
  });
  let left = total - rows.reduce((n, r) => n + r.base, 0);
  for (const r of rows) out.set(r.level, r.base);
  for (const r of [...rows].sort((a, b) => b.frac - a.frac || b.level - a.level)) {
    if (left <= 0) break;
    out.set(r.level, out.get(r.level)! + 1);
    left--;
  }
  return out;
}

export interface IrradiatedStoreyReport {
  level: number;
  /** Regular zombies on the storey before the additions (the base). */
  regular: number;
  /** Additions the split gave this storey, and how many found a legal spot. */
  wanted: number;
  placed: number;
}
export interface IrradiatedReport {
  version: number;
  /** The storeys (layout.levels indices) that take additions; empty = this level has none. */
  storeys: number[];
  /** Σ regular, N = irradiatedAddCount(regular), placed (the spawn indices first .. first + placed - 1). */
  regular: number;
  wanted: number;
  placed: number;
  first: number;
  perStorey: IrradiatedStoreyReport[];
  /** Additions with no legal spot left on their storey even with the relaxed spacing (reported, never silent; 0 in the census). */
  short: number;
  /** The generator's spawn field was not available (a layout the Reactor generator did not make): nothing was added. */
  noField?: true;
}

const REPORTS = new WeakMap<object, IrradiatedReport>();
/** What the additions pass did on a layout (undefined: it did not run — another level, an older roster version, or no pass). */
export function irradiatedOf(layout: object): IrradiatedReport | undefined {
  return REPORTS.get(layout);
}
export function recordIrradiated(layout: object, r: IrradiatedReport): void {
  REPORTS.set(layout, r);
}
