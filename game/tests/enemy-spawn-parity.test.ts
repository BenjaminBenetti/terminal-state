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
//  3. Track 2 — Beyond the Station (lane GEN, track extensions): tunnels past the bed ends + service annexes are planned on their
//     own rng fork and appended AFTER every core pass; when one reaches west / north of the station the finished core is re-framed
//     (translated) into the larger grid (gen/trackExt/index.ts finishExtensions). Every core decision is made in main's frame:
//     no spawn, count, area id, type or family changed — only absolute x / z of translated stations. Translation-normalised
//     proof (below, every run): the SAME hashes over gen/trackExt coreView(layout) (the core window, records translated back to
//     the core frame at their exact core-frame positions, extension records filtered) reproduce the main 932624e / stage-2 pins
//     (SUBWAY_GOLDEN / OFFICE_GOLDEN) byte for byte. The live layouts are pinned as SUBWAY_GOLDEN_TRACK2 (only the translated
//     seeds differ: see the helper) and OFFICE_GOLDEN (the Office never translates: it grows east / south — unchanged).

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {
  OFFICE_GOLDEN, OFFICE_PARITY, SUBWAY_GOLDEN, SUBWAY_GOLDEN_TRACK2, SUBWAY_PARITY, contextCounts, officeKey, pickupHash, spawnSpecHash, subwayKey,
} from './helpers/enemySpawnParity'; // the pinned hashes live in the helper (shared with enemy-spawn-tables.test.ts)
import {coreView} from '../src/gen/trackExt/index';
import type {StationLayout} from '../src/gen/stationTypes';

const triple = (l: StationLayout): [string, string, string] => [spawnSpecHash(l), pickupHash(l), contextCounts(l)];

describe('enemy spawn parity (pinned at main 932624e)', () => {
  it('Subway: spawn specs + downstream pickups byte-identical (the core view = main; the live layouts = stage 3)', () => {
    const core: Record<string, [string, string, string]> = {}, live: Record<string, [string, string, string]> = {};
    for (const c of SUBWAY_PARITY) {
      const l = generateStation(c.seed, {startWeapon: c.startWeapon, ...(c.archetype ? {archetype: c.archetype} : {})});
      core[subwayKey(c)] = triple(coreView(l));
      live[subwayKey(c)] = triple(l);
    }
    if (JSON.stringify(core) !== JSON.stringify(SUBWAY_GOLDEN)) console.info(`[enemy-spawn-parity] subway core ${JSON.stringify(core, null, 1)}`);
    if (JSON.stringify(live) !== JSON.stringify(SUBWAY_GOLDEN_TRACK2)) console.info(`[enemy-spawn-parity] subway live ${JSON.stringify(live, null, 1)}`);
    expect(core).toEqual(SUBWAY_GOLDEN);
    expect(live).toEqual(SUBWAY_GOLDEN_TRACK2);
  });

  it('Office: spawn specs (street, floors 2..8, roof) + downstream pickups byte-identical', () => {
    const core: Record<string, [string, string, string]> = {}, live: Record<string, [string, string, string]> = {};
    for (const c of OFFICE_PARITY) {
      const l = generateOfficeLevel({levelSeed: c.levelSeed, startWeapon: c.startWeapon});
      core[officeKey(c)] = triple(coreView(l));
      live[officeKey(c)] = triple(l);
    }
    if (JSON.stringify(live) !== JSON.stringify(OFFICE_GOLDEN)) console.info(`[enemy-spawn-parity] office ${JSON.stringify(live, null, 1)}`);
    expect(core).toEqual(OFFICE_GOLDEN);
    expect(live).toEqual(OFFICE_GOLDEN);
  });
});
