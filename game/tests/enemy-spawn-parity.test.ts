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
//  4. Track 2 — Beyond the Station (lane GEN, track extensions; merged after stage 3): tunnels past the bed ends + service annexes
//     are planned on their own rng fork and appended AFTER every core pass; when one reaches west / north of the station the
//     finished core is re-framed (translated) into the larger grid (gen/trackExt/index.ts finishExtensions). Every core decision
//     is made in main's frame: no spawn, count, area id, type or family changed — only absolute x / z of translated stations.
//     Translation-normalised proof (below, every run): the SAME hashes / invariants over gen/trackExt coreView(layout) (the core
//     window, records translated back to the core frame at their exact core-frame positions, extension records filtered)
//     reproduce the stage-3 pins (SUBWAY_GOLDEN / OFFICE_GOLDEN, SUBWAY_INVARIANT / OFFICE_INVARIANT) byte for byte. The live
//     layouts are pinned as SUBWAY_GOLDEN_TRACK2 (only the translated seeds differ: see the helper) and OFFICE_GOLDEN (the
//     Office never translates: it grows east / south — unchanged).
//  5. Track 2 — Beyond the Station (lane CONTENT): the service annexes are populated (gen/annexContent.ts, own rng fork
//     `track-ext-content`, after finishExtensions): the profile's new 'service' context (a per-annex zone budget, 3-5 spawns per
//     annex) APPENDS its spawns after every core spawn (tagged markSpawnContext 'service'; assignEnemyArchetypes still runs ONCE,
//     after every context — its per-index roll leaves the core's families unchanged) and the per-annex floor program APPENDS its
//     loose finds after every core pickup. contextCounts reports the service spawns separately (" + service N"). Cause of the
//     re-pin: ONLY the live layouts of corpus entries that grow an annex (Subway 42 / 9001 / 16920 / 48596; Office 222 / 3333 /
//     4242) — SUBWAY_GOLDEN_TRACK2 / OFFICE_GOLDEN_TRACK2 (helper). Proof, every run: coreView(layout) (now also filtering the
//     extensions' appended props / lights / signs / pickups / spawns) reproduces SUBWAY_GOLDEN / OFFICE_GOLDEN and the INVARIANT
//     pins byte for byte; no core pin moved.

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {
  OFFICE_GOLDEN, OFFICE_GOLDEN_TRACK2, OFFICE_INVARIANT, OFFICE_PARITY, SUBWAY_GOLDEN, SUBWAY_GOLDEN_TRACK2, SUBWAY_INVARIANT, SUBWAY_PARITY, contextCounts,
  familyIndices, maskedSpawnSpecHash, officeKey, pickupHash, spawnSpecHash, subwayKey,
} from './helpers/enemySpawnParity'; // the pinned hashes live in the helper (shared with enemy-spawn-tables.test.ts)
import {coreView} from '../src/gen/trackExt/index';
import type {StationLayout} from '../src/gen/stationTypes';

const triple = (l: StationLayout): [string, string, string] => [spawnSpecHash(l), pickupHash(l), contextCounts(l)];

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
      const key = subwayKey(c), core = coreView(l); // stage 4: the translation-normalised core view
      check(core, SUBWAY_INVARIANT[key], key);
      expect([pickupHash(core), contextCounts(core)], key).toEqual(SUBWAY_GOLDEN[key].slice(1));
      expect(familyIndices(l, 'siren'), `${key}: no Siren in the Subway (core + extensions)`).toEqual([]);
    }
  });
  it('Office: the same invariants for station + lobby, floors 2..8 and roof', () => {
    for (const c of OFFICE_PARITY) {
      const l = generateOfficeLevel({levelSeed: c.levelSeed, startWeapon: c.startWeapon});
      const key = officeKey(c), core = coreView(l);
      check(core, OFFICE_INVARIANT[key], key);
      expect([pickupHash(core), contextCounts(core)], key).toEqual(OFFICE_GOLDEN[key].slice(1));
    }
  });
});

describe('enemy spawn parity (full specs incl. family: pin stage 3, task track1)', () => {
  it('Subway: spawn specs + downstream pickups byte-identical (the core view = stage 3; the live layouts = stage 5)', () => {
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
    if (JSON.stringify(live) !== JSON.stringify(OFFICE_GOLDEN_TRACK2)) console.info(`[enemy-spawn-parity] office ${JSON.stringify(live, null, 1)}`);
    expect(core).toEqual(OFFICE_GOLDEN);
    expect(live).toEqual(OFFICE_GOLDEN_TRACK2); // stage 5 (Track 2, lane CONTENT): + the annexes' appended service spawns / finds
  });
});
