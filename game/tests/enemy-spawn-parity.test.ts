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

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {
  OFFICE_GOLDEN, OFFICE_PARITY, SUBWAY_GOLDEN, SUBWAY_PARITY, contextCounts, officeKey, pickupHash, spawnSpecHash, subwayKey,
} from './helpers/enemySpawnParity'; // the pinned hashes live in the helper (shared with enemy-spawn-tables.test.ts)

describe('enemy spawn parity (pinned at main 932624e)', () => {
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
