// Task track3-eaton-centre-20261031 (lane HORDE): ROAMING HORDE rules — pure data + validation (no three.js). The user: "a
// grouping of five to twenty zombies who generally move in a group throughout the mall … you kind of want to avoid that group …
// you can shoot them and fight them but it's a little bit scary".
//
// A level's spawn profile (ai/spawnTables.ts SpawnProfile.horde, PROFILES fills SPAWN_PROFILES.mall.horde) may declare hordes.
// Absent = no hordes (the Subway and Office Space: nothing changes there). The horde pool is a SEPARATE pool with its own budget:
//  - groups: ONE rng.int(lo, hi) draw = groups the level tries to place (seeded, once, at generation: ai/hordePlace.ts);
//  - size: ONE rng.int(lo, hi) per group = its initial members, always inside the user's 5..20 (HORDE_GROUP_SIZE; validation);
//  - families: the horde's OWN family pool. The ambient rat/dog / Blightbelly shares are NOT applied to hordes — a non-zombie
//    family joins a horde only when this list gives it a weight. Sirens never join a standard horde (validation rejects them);
//  - zombieTypes: the members' shambler / coated roll (appearance / outfits are the usual per-spawn wardrobe pick);
//  - budget: the horde pool's caps — total members in the level, members STARTING on one storey, groups starting on one storey.
//    The ambient pool (the profile's contexts) is counted separately; horde members never count against it or vice versa;
//  - placement: which storeys groups start on, how far from the player start (walking metres), group / member / ambient spacing;
//  - patrol: the roam pace, how often a leg takes a vertical link, pauses at patrol nodes.
// Placed ONCE at generation (members are layout.zombies entries tagged `horde`): no spawner, no kill top-up, no revisit respawn;
// kills persist through the run memory like every enemy (run/memory.ts); a group whose members all died stays dead.

import type {FamilyPool, ZombieTypeRule} from './spawnTables';

/** The user's initial group size range: every horde group starts with 5..20 members. */
export const HORDE_GROUP_SIZE = {min: 5, max: 20} as const;

/**
 * Families that never join a standard (ordinary-zombie) horde (final user decision: Sirens are rare ambient only). Task
 * studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): + the Strainer (a service-annex lurker only: spawnTables STRAINER_CONTEXTS).
 */
export const HORDE_FORBIDDEN_FAMILIES: readonly string[] = ['siren', 'strainer', 'screacher']; // (+ the Screacher: roster-only, task studio-screacher-production-20261110-221858-01)

export interface HordeBudget {
  /** Horde members in the whole level (all groups together). */
  readonly total: number;
  /** Members of the groups STARTING on one storey. */
  readonly perStorey: number;
  /** Groups starting on one storey. */
  readonly groupsPerStorey: number;
}

export interface HordePlacementRules {
  /** Storeys (layout.levels indices) a group may start on; 'rings' = every mall ring storey (layout.mall.storeys role 'ring'). */
  readonly storeys: 'rings' | readonly number[];
  /** Minimum walking distance (m) of a group's start node from the player start. */
  readonly startM: number;
  /** Minimum straight distance (m) between two groups' start nodes on one storey. */
  readonly groupSpacingM: number;
  /** Minimum distance (m) between two members, and the farthest (straight) a member starts from its group's start node. */
  readonly memberSpacingM: number;
  readonly clusterM: number;
  /** Members keep this far (m) from enemies already placed on the storey (the ambient pool). */
  readonly ambientSpacingM: number;
  /**
   * Task mall-playtest-revision-20261031 (lane PROFILES, D07): ROUTE CAPACITY — patrol-route metres per member. The groups starting
   * on a storey hold at most floor(R / routeMPerMember) members, R = the storey's walkable patrol route (the summed length of its
   * same-storey patrol edges, ai/hordePlace.ts patrolRouteM); a storey whose capacity is below a minimum group takes none. Absent =
   * no route bound (the budgets alone). It never changes a draw: it only clips a group's size / removes a storey option.
   */
  readonly routeMPerMember?: number;
  /**
   * Task mall-playtest-revision-20261031 (lane PROFILES, D07): minimum STRAIGHT 3D distance (m) of a group's start node from the player
   * start — out of an ordinary zombie's sight on arrival: shambler sight 18 m + the members' clusterM (7 m) + a 3 m margin = 28 in the
   * mall. The compact mall's atrium overlooks the station from every retail floor, so a 45-walking-metre start alone stood in plain
   * view of the platform (seed 32451: a floor-3 group 24.9 m from the start sent two members down to the player at once). Absent =
   * no such rule.
   */
  readonly startClearM?: number;
}

export interface HordePatrolRules {
  /** The group's roam pace (m/s): below a coated zombie's wander speed (0.55) so stragglers catch up — a slow, visible drift. */
  readonly speed: number;
  /** Chance a patrol leg takes a vertical link (escalator / stair edge) when one leaves the node. */
  readonly storeyChange: number;
  /** Chance of a pause at a patrol node, and its duration range (s). */
  readonly pauseChance: number;
  readonly pause: readonly [number, number];
}

export interface HordeRules {
  readonly label: string;
  readonly groups: readonly [number, number];
  readonly size: readonly [number, number];
  readonly families: FamilyPool;
  readonly zombieTypes: ZombieTypeRule;
  readonly budget: HordeBudget;
  readonly placement: HordePlacementRules;
  readonly patrol: HordePatrolRules;
}

/**
 * One placed horde group (layout.hordes[id]; written once by ai/hordePlace.ts). Its members are layout.zombies entries tagged
 * `horde: id` — `members` lists their indices (the initial roster; the run memory's kills remove them, nothing ever adds).
 */
export interface HordeGroupSpec {
  id: number;
  /** Storey the group starts on (layout.levels index). */
  level: number;
  /** layout.zombies indices of the initial members (5..20). */
  members: number[];
  /** Patrol node the group starts at (layout.mall.patrol id) and the start point itself (absolute y). */
  startNode: number;
  start: {x: number; y: number; z: number};
  /** Seed of the group's patrol choices at runtime (deterministic per layout; never the game's shared random stream). */
  seed: number;
}

/**
 * The mall's hordes (lane HORDE's model; lane PROFILES owns SPAWN_PROFILES.mall.horde and these numbers). Task
 * mall-playtest-revision-20261031 (lane PROFILES, D07): re-proportioned for the COMPACT mall (station + 3 retail floors, ~5,200 m² of
 * retail floor with 150-500 m of patrol route per floor; was 6 rings / ~40,000 m²): 1..2 groups (was 3..5) of 5..20 ordinary zombies
 * (the user's range), at most 32 horde members in the mall (was 64), one group (<= 20) starting per retail floor, a group never larger
 * than its start floor's route holds (18 route metres per member: a big floor-1 loop takes 20, a short top-floor court ~8-16), never
 * within 45 walking metres of the subway start nor within 28 m (straight 3D) of it — out of sight on arrival across the atrium. Ordinary zombies only (rat/dog listed with weight 0: excluded).
 */
export const MALL_HORDE_RULES: HordeRules = {
  label: 'Roaming hordes',
  groups: [1, 2],
  size: [HORDE_GROUP_SIZE.min, HORDE_GROUP_SIZE.max],
  families: [['zombie', 1], ['ratdog', 0]],
  zombieTypes: {coatedChance: 0.4, atLeastOneEach: false},
  budget: {total: 32, perStorey: 20, groupsPerStorey: 1},
  placement: {storeys: 'rings', startM: 45, groupSpacingM: 30, memberSpacingM: 1.1, clusterM: 7, ambientSpacingM: 2.5, routeMPerMember: 18, startClearM: 28},
  patrol: {speed: 0.45, storeyChange: 0.3, pauseChance: 0.35, pause: [2, 7]},
};

const finiteNonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Problems with horde rules (empty = valid). `familyIds` = the live enemy family registry (ENEMY_FAMILY_IDS). Checks: known
 * knobs only, integer ranges 0 <= lo <= hi, sizes inside 5..20, a pool of known families listed once with at least one positive
 * weight (no Siren, ever), chances in [0, 1], budgets that can hold at least one minimum group, finite non-negative distances.
 */
export function validateHordeRules(h: HordeRules, familyIds: readonly string[], path = 'horde'): string[] {
  const issues: string[] = [];
  const bad = (p: string, msg: string) => issues.push(`${path}${p ? '.' + p : ''}: ${msg}`);
  const known = (p: string, o: object, keys: readonly string[]) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(p ? `${p}.${k}` : k, 'unknown knob'); };
  const num = (p: string, v: unknown) => { if (!finiteNonNeg(v)) bad(p, `${String(v)} is not a finite number >= 0`); };
  const range = (p: string, r: unknown): r is readonly [number, number] => {
    const ok = Array.isArray(r) && r.length === 2 && nonNegInt(r[0]) && nonNegInt(r[1]) && r[0] <= r[1];
    if (!ok) bad(p, `range ${JSON.stringify(r)} is not integers 0 <= lo <= hi`);
    return ok;
  };
  if (!h || typeof h !== 'object') { bad('', 'not horde rules'); return issues; }
  known('', h, ['label', 'groups', 'size', 'families', 'zombieTypes', 'budget', 'placement', 'patrol']);
  range('groups', h.groups);
  if (range('size', h.size) && (h.size[0] < HORDE_GROUP_SIZE.min || h.size[1] > HORDE_GROUP_SIZE.max)) {
    bad('size', `${JSON.stringify(h.size)} leaves the initial group range ${HORDE_GROUP_SIZE.min}..${HORDE_GROUP_SIZE.max}`);
  }
  // families: the horde's own explicit pool
  const seen = new Set<string>();
  let sum = 0;
  if (!Array.isArray(h.families)) bad('families', 'not a pool');
  else h.families.forEach((row, i) => {
    const [f, w] = Array.isArray(row) ? row : [undefined, undefined];
    if (typeof f !== 'string' || !familyIds.includes(f)) bad(`families[${i}]`, `unknown family ${String(f)}`);
    else if (HORDE_FORBIDDEN_FAMILIES.includes(f) && finiteNonNeg(w) && w > 0) bad(`families[${i}]`, `${f} never joins a standard horde`);
    else if (seen.has(f)) bad(`families[${i}]`, `family ${f} listed twice`);
    else seen.add(f);
    num(`families[${i}].weight`, w);
    if (finiteNonNeg(w)) sum += w;
  });
  if (Array.isArray(h.families) && !(sum > 0)) bad('families', 'no family has a positive weight');
  const zt = h.zombieTypes;
  if (!zt || typeof zt !== 'object') bad('zombieTypes', 'missing');
  else {
    known('zombieTypes', zt, ['coatedChance', 'atLeastOneEach']);
    if (!(finiteNonNeg(zt.coatedChance) && zt.coatedChance <= 1)) bad('zombieTypes.coatedChance', `${String(zt.coatedChance)} is outside [0, 1]`);
    if (typeof zt.atLeastOneEach !== 'boolean') bad('zombieTypes.atLeastOneEach', 'not a boolean');
  }
  const b = h.budget;
  if (!b || typeof b !== 'object') bad('budget', 'missing');
  else {
    known('budget', b, ['total', 'perStorey', 'groupsPerStorey']);
    for (const k of ['total', 'perStorey', 'groupsPerStorey'] as const) if (!nonNegInt(b[k])) bad(`budget.${k}`, `${String(b[k])} is not an integer >= 0`);
    const hi = Array.isArray(h.groups) ? h.groups[1] : 0;
    if (nonNegInt(hi) && hi > 0 && nonNegInt(b.total) && nonNegInt(b.perStorey) && Array.isArray(h.size) && nonNegInt(h.size[0])) {
      if (b.total < h.size[0]) bad('budget.total', `${b.total} cannot hold one group of ${h.size[0]}`);
      if (b.perStorey < h.size[0]) bad('budget.perStorey', `${b.perStorey} cannot hold one group of ${h.size[0]}`);
      if (b.groupsPerStorey < 1) bad('budget.groupsPerStorey', 'groups are declared but no storey may hold one');
    }
  }
  const p = h.placement;
  if (!p || typeof p !== 'object') bad('placement', 'missing');
  else {
    known('placement', p, ['storeys', 'startM', 'groupSpacingM', 'memberSpacingM', 'clusterM', 'ambientSpacingM', 'routeMPerMember', 'startClearM']);
    if (p.storeys !== 'rings' && !(Array.isArray(p.storeys) && p.storeys.every(nonNegInt))) bad('placement.storeys', `${JSON.stringify(p.storeys)} is not 'rings' or storey indices`);
    for (const k of ['startM', 'groupSpacingM', 'memberSpacingM', 'clusterM', 'ambientSpacingM'] as const) num(`placement.${k}`, p[k]);
    if (p.routeMPerMember !== undefined && !(finiteNonNeg(p.routeMPerMember) && p.routeMPerMember > 0)) bad('placement.routeMPerMember', `${String(p.routeMPerMember)} is not a finite length > 0`);
    if (p.startClearM !== undefined && !finiteNonNeg(p.startClearM)) bad('placement.startClearM', `${String(p.startClearM)} is not a finite distance >= 0`);
    if (finiteNonNeg(p.memberSpacingM) && p.memberSpacingM < 0.8) bad('placement.memberSpacingM', 'members would overlap (bodies are ~0.7 m wide)');
  }
  const q = h.patrol;
  if (!q || typeof q !== 'object') bad('patrol', 'missing');
  else {
    known('patrol', q, ['speed', 'storeyChange', 'pauseChance', 'pause']);
    num('patrol.speed', q.speed);
    if (finiteNonNeg(q.speed) && (q.speed <= 0 || q.speed > 0.65)) bad('patrol.speed', `${q.speed} m/s is not a slow roam in (0, 0.65]`);
    for (const k of ['storeyChange', 'pauseChance'] as const) if (!(finiteNonNeg(q[k]) && q[k] <= 1)) bad(`patrol.${k}`, `${String(q[k])} is outside [0, 1]`);
    if (!(Array.isArray(q.pause) && q.pause.length === 2 && finiteNonNeg(q.pause[0]) && finiteNonNeg(q.pause[1]) && q.pause[0] <= q.pause[1])) bad('patrol.pause', `${JSON.stringify(q.pause)} is not 0 <= lo <= hi`);
  }
  if (own(h, 'label') && typeof h.label !== 'string') bad('label', 'not a string');
  return issues;
}

/** Deterministic weighted family pick for horde member `member` of group `group` (its own hash: never the ambient roll). */
export function hordeFamilyRoll(seed: number, group: number, member: number): number {
  let h = (Math.imul((seed >>> 0) ^ 0x68d0e5a3, 0x9e3779b1) ^ Math.imul(group + 1, 0x85ebca6b) ^ Math.imul(member + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function pickHordeFamily<F extends string>(pool: readonly (readonly [F, number])[], roll: number): F {
  let total = 0;
  for (const [, w] of pool) total += Math.max(0, w);
  let r = roll * total;
  for (const [f, w] of pool) {
    if (!(w > 0)) continue;
    r -= w;
    if (r < 0) return f;
  }
  for (let i = pool.length - 1; i >= 0; i--) if (pool[i][1] > 0) return pool[i][0];
  return pool[0][0];
}
