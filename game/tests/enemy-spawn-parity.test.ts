// Task enemy-spawn-tables-20261030 (lane SPAWN): ENEMY SPAWN PARITY — golden hashes of the full seeded spawn specs (family /
// archetype, zombie type, count, exact x / y / z / yaw, area id + key, level, order; tests/helpers/enemySpawnParity.ts) of
// representative Subway seeds (rifle + pistol starts, one forced seed per multi-level archetype) and Office levels (station +
// lobby, floors 2..8, roof), plus the downstream pickup state (the Subway's level-moved loose supplies share the level-move rng).
//
// PIN HISTORY:
//  1. Captured at main 932624e BEFORE any lane SPAWN source change (the per-level spawn profiles of ai/spawnTables.ts), and
//     unchanged after the refactor: the neutral profiles (every room modifier 1.0 / absent) take the identical code path with the
//     identical floats and RNG draws. A deliberate tuning change WILL move them: explain what moved and why before re-pinning.
//     Never re-pin to make a refactor pass. The Subway fingerprints (office-gen.test.ts) and loot goldens (loot-golden.test.ts)
//     are the wider downstream guard and stay byte-identical too.
//  2. Task office-props-physics-scale-20261030 (Office only; the Subway entries are unchanged): the user-requested furniture
//     rescales (lab bench, trading desk, bean bag, bakery case, foosball / ping-pong, drafting table, espresso on a counter, mixing
//     console), the server rack r2 footprint, host-top clutter and a 1.5 m turning square kept free in small office rooms re-lay
//     the office props, so the seeded spawn POSITIONS / areas and the downstream pickups move. The spawn profiles and code are
//     unchanged and every per-context count (street, f2..f8, roof) is identical. Office spec / pickup hashes: 11:pistol 2f57fea3 /
//     6cfc51c0 -> 5d274546 / ef270423, 222 3f4ffaaa / 0183e6f5 -> 24f81c38 / 3e9001ac, 3333 49c5890e / 8290c0dd -> 73e3a9b0 /
//     bc96b5e2, 4242 c008ba55 / ef25f3cf -> 8f127b50 / ba008081, 11:rifle 2f57fea3 / 9e782ad4 -> 5d274546 / 7cb613ae.
//  (merge of task gas-mask-roof-feedback-20261030, no re-pin): the Office roof FIND's reward pickups (appended last, pinned in
//     loot-golden officeRoofFind) are left out of pickupHash (helpers/enemySpawnParity.ts); every hash above is reproduced as is.
//  3. Task track1-siren-blightbelly-20261031 (lane SPAWN), BOTH levels: the user-requested families Blightbelly (5 % on every level)
//     and Siren (Office only, ~2 per run) REPLACE shares of the zombie slots. CAUSE: the family field only — the pools became
//     Subway [zombie 0.9, blightbelly 0.05, siren 0, ratdog 0.05] and Office [zombie 0.71, blightbelly 0.05, siren 0.19 (draw
//     weight; ineligible draws stay zombies), ratdog 0.05] on the SAME per-spawn roll, the new families inserted before the
//     rat/dog. EVIDENCE (separated from the invariants, first test below): the family-masked spec hash (count, order, type, exact
//     x / y / z / yaw, area, level), the pickup hash and the context counts equal the values computed from the untouched main
//     dba90dd sources, the rat/dog indices are identical and every old zombie slot is a zombie / Blightbelly / Siren now (also over
//     40 + 40 extra seeds per level in the lane census). Spec hashes: 1 a71290f4 -> 52c57838, 7 f8281aad -> 9ffd5bd5, 42 4c817345
//     -> 1d09d867, 1234 e1e089f5 -> b1e955bd, 9001 689b3629 -> 9f96c951, 32758 9c1d3f5f -> 409a0efd, 40677 280e6a9b -> ea09047b,
//     48596 41e72df3 -> 8388ceeb (16920 / 24839 drew no Blightbelly: unchanged); Office 11 5d274546 -> 73536b5a, 222 24f81c38 ->
//     5e4e485b, 3333 73e3a9b0 -> 9720588a, 4242 8f127b50 -> 46b33d60. Every pickup hash and context count is unchanged.

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {
  OFFICE_GOLDEN, OFFICE_INVARIANT, OFFICE_PARITY, SUBWAY_GOLDEN, SUBWAY_INVARIANT, SUBWAY_PARITY, contextCounts, familyIndices,
  maskedSpawnSpecHash, officeKey, pickupHash, spawnSpecHash, subwayKey,
} from './helpers/enemySpawnParity'; // the pinned hashes live in the helper (shared with enemy-spawn-tables.test.ts)
import type {StationLayout} from '../src/gen/stationTypes';

const NEW_FAMILIES = ['blightbelly', 'siren'] as const;

describe('enemy spawn INVARIANTS across the task-track1 family change (pinned from the untouched main dba90dd sources)', () => {
  const check = (l: StationLayout, inv: readonly [string, readonly number[]], key: string) => {
    expect(maskedSpawnSpecHash(l), `${key} masked spec`).toBe(inv[0]);
    expect(familyIndices(l, 'ratdog'), `${key} rat/dog indices`).toEqual([...inv[1]]);
    // every non-rat/dog slot (the old zombie slots) is a zombie or one of the new families
    for (const z of l.zombies) expect(['zombie', 'ratdog', ...NEW_FAMILIES], key).toContain(z.archetype ?? 'zombie');
  };
  it('Subway: positions / count / order / types / areas / levels, rat/dog draws and pickups identical; only zombie slots changed family', () => {
    for (const c of SUBWAY_PARITY) {
      const l = generateStation(c.seed, {startWeapon: c.startWeapon, ...(c.archetype ? {archetype: c.archetype} : {})});
      const key = subwayKey(c);
      check(l, SUBWAY_INVARIANT[key], key);
      expect([pickupHash(l), contextCounts(l)], key).toEqual(SUBWAY_GOLDEN[key].slice(1));
      expect(familyIndices(l, 'siren'), `${key}: no Siren in the Subway`).toEqual([]);
    }
  });
  it('Office: the same invariants for station + lobby, floors 2..8 and roof', () => {
    for (const c of OFFICE_PARITY) {
      const l = generateOfficeLevel({levelSeed: c.levelSeed, startWeapon: c.startWeapon});
      const key = officeKey(c);
      check(l, OFFICE_INVARIANT[key], key);
      expect([pickupHash(l), contextCounts(l)], key).toEqual(OFFICE_GOLDEN[key].slice(1));
    }
  });
});

describe('enemy spawn parity (full specs incl. family: pin stage 3, task track1)', () => {
  it('Subway: spawn specs + downstream pickups byte-identical', () => {
    const got: Record<string, [string, string, string]> = {};
    for (const c of SUBWAY_PARITY) {
      const l = generateStation(c.seed, {startWeapon: c.startWeapon, ...(c.archetype ? {archetype: c.archetype} : {})});
      got[subwayKey(c)] = [spawnSpecHash(l), pickupHash(l), contextCounts(l)];
    }
    if (JSON.stringify(got) !== JSON.stringify(SUBWAY_GOLDEN)) console.info(`[enemy-spawn-parity] subway ${JSON.stringify(got, null, 1)}`);
    expect(got).toEqual(SUBWAY_GOLDEN);
  });

  it('Office: spawn specs (street, floors 2..8, roof) + downstream pickups byte-identical', () => {
    const got: Record<string, [string, string, string]> = {};
    for (const c of OFFICE_PARITY) {
      const l = generateOfficeLevel({levelSeed: c.levelSeed, startWeapon: c.startWeapon});
      got[officeKey(c)] = [spawnSpecHash(l), pickupHash(l), contextCounts(l)];
    }
    if (JSON.stringify(got) !== JSON.stringify(OFFICE_GOLDEN)) console.info(`[enemy-spawn-parity] office ${JSON.stringify(got, null, 1)}`);
    expect(got).toEqual(OFFICE_GOLDEN);
  });
});
