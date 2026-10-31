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
//  5. Track 2 lane GEN-2, SUBWAY ONLY — CAUSE: "core reserve enabled (authorized incidence change)". The user wants service
//     annexes on basically every level with tracks; the primary authorized the Subway's TRACK_EXT.coreReserveM = 40: right
//     after the archetype skeleton, 40 m of rock stay free past every bed end that is still open (gen/trackExt/index.ts
//     reserveTunnelRoom, Kit.keepRock), so the station's later growth (exits, washrooms, storefronts, back-of-house) plans around
//     it. That is a LAYOUT change of the core station (rooms move, later rng draws follow the changed layout), not a family /
//     profile / spawn-code change: ai/spawnTables.ts, the family pools and every spawn pass are untouched, and every station
//     count stays in [22, 32]. EVIDENCE, every run: (i) generated with the reserve OFF ({...TRACK_EXT, coreReserveM: 0}, the
//     GEN-2 planner and hatches otherwise live), the core view still reproduces the stage-3 pins AND invariants byte for byte
//     (SUBWAY_GOLDEN / SUBWAY_INVARIANT): the extensions never touch the core; (ii) with the reserve ON the core view is pinned
//     as SUBWAY_GOLDEN_RESERVE + SUBWAY_INVARIANT_RESERVE (the new core layouts). The masked spec hash moved with the layout in
//     12 of 14 entries; 1234 (rifle / pistol: two bed-hatch annexes, no bed end left open by its skeleton, so the reserve kept
//     nothing) keeps every stage-3 value; EVERY rat/dog index list is identical to stage 3 (no family draw moved); station
//     counts: 42 L0 24 -> 23 / L2 4 -> 5, 48596 32 -> 31 (L0 25 -> 23, L1 2 -> 3), the rest unchanged. The live layouts
//     (+ extensions, translated cores) are re-pinned as SUBWAY_GOLDEN_TRACK2. Every Office pin is unchanged (the Office keeps
//     TRACK_EXT_OFFICE: no reserve, the original planner).
//  6. Track 2 integration — CAUSE: "openable wall mounts are never placed hidden behind a tall floor prop" (root CLAUDE.md prop
//     rule 1, found by openables.test on the re-laid seed 424242: a first-aid kit 0.45 m behind a 1.83 m grill line could not be
//     targeted from its stand spot). gen/props07Dress.ts tryWall now rejects a HIGH wall-mounted CONTAINER spot when a floor prop
//     of its area stands in the 0.9 m in front of it reaching up to the mount (tallInFront; no randomness consumed). EVIDENCE
//     (primary, one-off instrumented run, 194 generated layouts = this corpus, the 18-station economy corpus and GEN's 64-seed
//     corpus, reserve off and on): 19 layouts changed and EVERY changed layout contained at least one mount the old code had
//     placed at a flagged spot (23 hidden first-aid kits / AED cabinets in 21 layouts; no layout changed without one). Here only
//     16920 (reserve off) moves: spec 85de6292 -> 5dddd587, masked c76d28e8 (was 2dfe6845); its pickups, context counts and rat/dog
//     indices are unchanged, and its reserve-on core and live pins are unchanged. Every Office pin is unchanged.
//  7. Track 2 — Beyond the Station (lane CONTENT): the service annexes (off tunnels and service hatches) are populated
//     (gen/annexContent.ts, own rng fork `track-ext-content`, after finishExtensions): the profile's new 'service' context (a
//     per-annex zone budget, 3-5 spawns per annex) APPENDS its spawns after every core spawn (tagged markSpawnContext 'service'; y =
//     the trackbed floor; assignEnemyArchetypes still runs ONCE after every context — its per-index roll leaves the core's families
//     unchanged) and the per-annex floor program APPENDS its loose finds after every core pickup. contextCounts reports the service
//     spawns separately (" + service N"). Cause of the re-pin: ONLY the live layouts of corpus entries that grow an annex —
//     SUBWAY_GOLDEN_TRACK2 (7, 42, 1234, 16920, 24839, 32758, 40677, 48596; previous values in the helper) and the new
//     OFFICE_GOLDEN_TRACK2 (222 / 3333 / 4242). Proof, every run: coreView(layout) (now also filtering the extensions' appended
//     props / lights / signs / pickups / spawns) reproduces SUBWAY_GOLDEN_RESERVE / OFFICE_GOLDEN and the INVARIANT pins byte for
//     byte, and the reserve-off core view SUBWAY_GOLDEN; no core pin moved.
//  8. Task track2-playtest-revision-20261031 (lane ROOMS) — CAUSE: "annex machinery halls + room signatures" (user feedback 4 / 5):
//     gen/trackExt/carve.ts grows 2-3 larger, taller MACHINERY HALLS per annex inside the same area target (the annex rng draws
//     and the room graphs change; the crop / core translation follows), and gen/annexRooms.ts lays out the seven room signatures
//     (collision-only 'annexMachine' boxes, lean annex furniture), so every annex is re-laid: its service spawns and loose finds
//     land elsewhere. Moved: ONLY the live entries of annex levels — SUBWAY_GOLDEN_TRACK2 7 / 42 / 1234 / 16920 / 24839 / 32758 /
//     40677 / 48596 and OFFICE_GOLDEN_TRACK2 222 / 3333 / 4242 (old values beside them in the helper); every station / street /
//     floor / roof count and every service count is unchanged; the non-annex entries (Subway 1, 9001; Office 11) are unchanged.
//     PROOF, every run: the core views reproduce SUBWAY_GOLDEN_RESERVE / OFFICE_GOLDEN and the INVARIANT pins byte for byte, the
//     reserve-off core view SUBWAY_GOLDEN; no core pin moved.
//  9. Task studio-alpha-track2-playtest-revision-20261031-01 (primary) — CAUSE: "annexes had no findable loot / few enemies" (user
//     playtest): service budget 3-5 -> 5-7 over entry / middle / deep depth bands, out of station earshot where possible; annex
//     loot classes and one storage piece per bare annex room; the station invitation art. Moved: ONLY live annex entries (old
//     values in the helper); core views and invariants unchanged.
// 10. Same task, after merging main ce83b48 (mall revision) — CAUSE: "service budget 5-6 + O(1) earshot test": the registry
//     contract bounds every context's count hi by budgets.ambient.perStorey (the compact mall's is 6), and the earshot test is a
//     distance transform of 2 m core tiles (generation back at main's time; station.test's 400 ms budget failed at 406 ms on CI).
//     Moved: ONLY live annex entries' spawn hashes and service counts (old values in the helper); station / street / floor / roof
//     counts and every pickup hash unchanged; core views and invariants unchanged (asserted every run).

import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {
  OFFICE_GOLDEN, OFFICE_GOLDEN_TRACK2, OFFICE_INVARIANT, OFFICE_PARITY, SUBWAY_GOLDEN, SUBWAY_GOLDEN_TRACK2, SUBWAY_INVARIANT, SUBWAY_PARITY, contextCounts,
  familyIndices, maskedSpawnSpecHash, officeKey, pickupHash, spawnSpecHash, subwayKey,
} from './helpers/enemySpawnParity'; // the pinned hashes live in the helper (shared with enemy-spawn-tables.test.ts)
import {SUBWAY_GOLDEN_RESERVE, SUBWAY_INVARIANT_RESERVE} from './helpers/enemySpawnParity';
import {coreView} from '../src/gen/trackExt/index';
import {TRACK_EXT_RESERVE_OFF} from './helpers/trackExtCore';
import type {StationLayout} from '../src/gen/stationTypes';
import type {TrackExtConfig} from '../src/gen/trackExt/types';

/** A Subway parity layout: the live config (reserve on), or `cfg` (the reserve-off proof). */
const subwayAt = (c: (typeof SUBWAY_PARITY)[number], cfg?: TrackExtConfig) =>
  generateStation(c.seed, {startWeapon: c.startWeapon, ...(c.archetype ? {archetype: c.archetype} : {}), ...(cfg ? {trackExtensions: cfg} : {})});

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
      // stage 5 proof: the core RESERVE OFF reproduces the stage-3 invariants (stage 4: the translation-normalised core view)
      const key = subwayKey(c), off = coreView(subwayAt(c, TRACK_EXT_RESERVE_OFF));
      check(off, SUBWAY_INVARIANT[key], key);
      expect([pickupHash(off), contextCounts(off)], key).toEqual(SUBWAY_GOLDEN[key].slice(1));
      // stage 5 (core reserve on: a layout change): the new core's invariants; the same family rules, counts in [22, 32]
      const l = subwayAt(c), core = coreView(l);
      check(core, SUBWAY_INVARIANT_RESERVE[key], `${key} (reserve)`);
      expect(core.zombies.length, key).toBeGreaterThanOrEqual(22);
      expect(core.zombies.length, key).toBeLessThanOrEqual(32);
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
  it('Subway: spawn specs + downstream pickups byte-identical (reserve-off core view = stage 3; reserve-on core = stage 5; live = stage 5)', () => {
    const off: Record<string, [string, string, string]> = {}, core: Record<string, [string, string, string]> = {}, live: Record<string, [string, string, string]> = {};
    for (const c of SUBWAY_PARITY) {
      off[subwayKey(c)] = triple(coreView(subwayAt(c, TRACK_EXT_RESERVE_OFF)));
      const l = subwayAt(c);
      core[subwayKey(c)] = triple(coreView(l));
      live[subwayKey(c)] = triple(l);
    }
    if (JSON.stringify(off) !== JSON.stringify(SUBWAY_GOLDEN)) console.info(`[enemy-spawn-parity] subway reserve-off core ${JSON.stringify(off, null, 1)}`);
    if (JSON.stringify(core) !== JSON.stringify(SUBWAY_GOLDEN_RESERVE)) console.info(`[enemy-spawn-parity] subway core ${JSON.stringify(core, null, 1)}`);
    if (JSON.stringify(live) !== JSON.stringify(SUBWAY_GOLDEN_TRACK2)) console.info(`[enemy-spawn-parity] subway live ${JSON.stringify(live, null, 1)}`);
    expect(off).toEqual(SUBWAY_GOLDEN);
    expect(core).toEqual(SUBWAY_GOLDEN_RESERVE);
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
    expect(live).toEqual(OFFICE_GOLDEN_TRACK2); // stage 7 (Track 2, lane CONTENT): + the annexes' appended service spawns / finds
  });
});
