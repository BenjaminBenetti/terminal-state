// Task enemy-spawn-tables-20261030 (lane SPAWN): per-level enemy spawn profiles (ai/spawnTables.ts) consumed by the REAL generators.
//  - coverage: every LevelId has a profile, every archetype-registry family is in every pool, the generators ask for exactly the
//    contexts a profile declares (a new level / family / context fails until it is added);
//  - neutral: every room key resolves to exactly 1 (the pool array itself), and an explicit all-1 entry for EVERY room key
//    reproduces the pinned parity hashes (tests/helpers/enemySpawnParity.ts) bit for bit;
//  - TEST-ONLY override profiles (never shipped): density 0 / 2 and weight 0 / 2 change only their room / family, caps hold, the
//    count roll and unrelated rooms / families / loot stay put;
//  - validation rejects bad values; persistence (Retry regeneration, killed indices) is unaffected.

import {describe, expect, it} from 'vitest';
import {generateStation, type StationLayout} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {lootProfile} from '../src/items/lootTables';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {ENEMY_ARCHETYPES} from '../src/ai/creatureArchetypes';
import {assignEnemyArchetypes, enemyRoll, pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {
  ALL_FAMILIES, ENEMY_FAMILY_IDS, SPAWN_CONTEXT_IDS, SPAWN_PROFILES, areaCap, hasRoomEntry, roomFamilyPool, roomIntensity, roomKey, roomModifier,
  spawnContext, spawnProfile, spawnRoomKeys, validateSpawnProfile, type RoomModifiers, type SpawnProfile,
} from '../src/ai/spawnTables';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import {OFFICE_GOLDEN, OFFICE_GOLDEN_TRACK2, SUBWAY_GOLDEN, SUBWAY_GOLDEN_RESERVE, SUBWAY_GOLDEN_TRACK2, contextCounts, pickupHash, spawnRecord, spawnSpecHash} from './helpers/enemySpawnParity';
import {TRACK_EXT_RESERVE_OFF} from './helpers/trackExtCore';
import {coreView} from '../src/gen/trackExt/index';
import {ROOM_LABEL} from '../src/gen/stationKit';

const SUBWAY = spawnProfile('subway'), OFFICE = spawnProfile('office');
const withRooms = (p: SpawnProfile, rooms: RoomModifiers): SpawnProfile => ({...p, rooms});

const cache = new Map<string, StationLayout>();
const station = (seed: number, p: SpawnProfile = SUBWAY, tag = 'neutral'): StationLayout => {
  const k = `${seed}:${tag}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = generateStation(seed, {spawns: p})));
  return l;
};
const office = (seed: number, p: SpawnProfile = OFFICE, tag = 'neutral'): StationLayout => {
  const k = `office:${seed}:${tag}`;
  let l = cache.get(k);
  if (!l) cache.set(k, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}, lootProfile('office'), p)));
  return l;
};
const keyOf = (l: StationLayout, z: StationLayout['zombies'][number]) => roomKey(l.areas[z.area]);
/** Spawn record without the family: position / type / area / level / order. */
const placement = (l: StationLayout) => l.zombies.map((_, i) => spawnRecord(l, i).split('|').filter((_, k) => k !== 1).join('|'));
const pickupItems = (l: StationLayout) => l.pickups.map(p => `${p.itemId}x${p.count}`).sort();
const propsJson = (l: StationLayout) => JSON.stringify(l.props);
const SEEDS = [1, 7, 42, 1234, 9001, 16920];

describe('spawn profiles: registry coverage', () => {
  it('every LevelId has a valid profile; the families are the archetype registry; every pool lists every family once', () => {
    expect(Object.keys(SPAWN_PROFILES).sort()).toEqual([...LEVEL_IDS].sort());
    expect([...ENEMY_FAMILY_IDS]).toEqual(Object.keys(ENEMY_ARCHETYPES));
    for (const id of LEVEL_IDS) {
      const p = spawnProfile(id);
      expect(p.id).toBe(id);
      expect(validateSpawnProfile(p), id).toEqual([]);
      expect(p.families.map(([f]) => f).sort()).toEqual([...ENEMY_FAMILY_IDS].sort());
      expect(Object.keys(p.contexts).every(c => (SPAWN_CONTEXT_IDS as readonly string[]).includes(c))).toBe(true);
    }
    // the shipped controls (moved verbatim): Subway 22-32 on the station, Office 5-8 / 3-6 per floor / 0-2 roof; 40 % coated
    expect(SUBWAY.contexts.station!.count).toEqual([22, 32]);
    expect([OFFICE.contexts.street!.count, OFFICE.contexts.floor!.count, OFFICE.contexts.roof!.count]).toEqual([[5, 8], [3, 6], [0, 2]]);
    // task track1-siren-blightbelly-20261031: Blightbelly 5 % on both, the Siren opted in on the Office only (draw weight 0.19)
    // task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): + the Strainer listed explicitly at 0 (service annexes only)
    expect(SUBWAY.families).toEqual([['zombie', 0.9], ['blightbelly', 0.05], ['siren', 0], ['ratdog', 0.05], ['strainer', 0]]);
    expect(OFFICE.families).toEqual([['zombie', 0.71], ['blightbelly', 0.05], ['siren', 0.19], ['ratdog', 0.05], ['strainer', 0]]);
    expect(SUBWAY.zombieTypes).toEqual({coatedChance: 0.4, atLeastOneEach: true});
  });

  it('the real generators ask for exactly the contexts their profile declares (a new context fails until declared)', () => {
    const watch = (p: SpawnProfile) => {
      const seen = new Set<string>();
      const contexts = new Proxy(p.contexts, {get: (t, k) => { if (typeof k === 'string') seen.add(k); return Reflect.get(t, k); }});
      return {profile: {...p, contexts} as SpawnProfile, seen};
    };
    const s = watch(SUBWAY);
    // (Track 2 GEN-2: the live Subway = the core with the reserve + its extensions: the stage-5 live pin)
    expect(spawnSpecHash(generateStation(7, {spawns: s.profile}))).toBe(SUBWAY_GOLDEN_TRACK2['7:rifle'][0]);
    expect([...s.seen].sort()).toEqual(Object.keys(SUBWAY.contexts).sort());
    const o = watch(OFFICE);
    expect(spawnSpecHash(generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'}, lootProfile('office'), o.profile))).toBe(OFFICE_GOLDEN['11:pistol'][0]);
    expect([...o.seen].sort()).toEqual(Object.keys(OFFICE.contexts).sort());
    // a profile without a context its generator runs is an error, not a silent default
    const rest = {...SUBWAY.contexts};
    delete rest.station;
    expect(() => generateStation(7, {spawns: {...SUBWAY, contexts: rest}})).toThrow(/no 'station' context/);
    // the registry generators use their own level's profile
    expect(spawnSpecHash(LEVELS.subway.generate('main', {levelSeed: 7, startWeapon: 'rifle'}))).toBe(SUBWAY_GOLDEN_TRACK2['7:rifle'][0]);
  });
});

describe('neutral room modifiers', () => {
  it('every known room key and family resolves to exactly 1 in the shipped profiles; the pool is the profile array itself', () => {
    const keys = spawnRoomKeys();
    expect(keys.size).toBeGreaterThan(Object.keys(ROOM_LABEL).length);
    for (const id of LEVEL_IDS) {
      const p = spawnProfile(id);
      expect(p.rooms, `${id} ships no room entries`).toEqual({});
      for (const k of keys) for (const area of [{purpose: k, type: 'concourse' as const}, {type: k as 'concourse'}]) {
        expect(hasRoomEntry(p, area)).toBe(false);
        expect(roomIntensity(p, area)).toBe(1);
        expect(roomFamilyPool(p, area)).toBe(p.families);
        for (const f of ENEMY_FAMILY_IDS) expect(roomModifier(p, area, f)).toEqual({density: 1, weight: 1});
      }
    }
  });

  it('an explicit 1 for EVERY room key and family is bit-identical to the pinned parity (x·1 and Σ/Σ are exact)', () => {
    const ones: RoomModifiers = Object.fromEntries([...spawnRoomKeys()].map(k => [k, {[ALL_FAMILIES]: {density: 1}, zombie: {density: 1, weight: 1}, ratdog: {density: 1, weight: 1}}]));
    const area = {purpose: 'stock-room', type: 'stock-room' as const};
    expect(roomIntensity(withRooms(SUBWAY, ones), area)).toBe(1);
    expect(roomFamilyPool(withRooms(SUBWAY, ones), area)).toEqual(SUBWAY.families);
    for (const seed of [1, 42, 1234]) {
      const l = generateStation(seed, {spawns: withRooms(SUBWAY, ones)});
      // Track 2: with the core reserve OFF the core view reproduces the stage-3 pins (GEN-2 proof); the live layout (reserve on)
      // its stage-5 pins and its core view the stage-5 reserve-core pins (helpers/enemySpawnParity.ts)
      const off = coreView(generateStation(seed, {spawns: withRooms(SUBWAY, ones), trackExtensions: TRACK_EXT_RESERVE_OFF}));
      expect([spawnSpecHash(off), pickupHash(off)], `${seed} core (reserve off)`).toEqual(SUBWAY_GOLDEN[`${seed}:rifle`].slice(0, 2));
      expect([spawnSpecHash(coreView(l)), pickupHash(coreView(l))], `${seed} core`).toEqual(SUBWAY_GOLDEN_RESERVE[`${seed}:rifle`].slice(0, 2));
      expect([spawnSpecHash(l), pickupHash(l)], `${seed}`).toEqual(SUBWAY_GOLDEN_TRACK2[`${seed}:rifle`].slice(0, 2));
    }
    const o = generateOfficeLevel({levelSeed: 222, startWeapon: 'pistol'}, lootProfile('office'), withRooms(OFFICE, ones));
    // Track 2 (lane CONTENT): an Office with service annexes: the core view = OFFICE_GOLDEN, the live layout = stage 7
    expect([spawnSpecHash(coreView(o)), pickupHash(coreView(o)), contextCounts(coreView(o))]).toEqual([...OFFICE_GOLDEN['222:pistol']]);
    expect([spawnSpecHash(o), pickupHash(o), contextCounts(o)]).toEqual([...OFFICE_GOLDEN_TRACK2['222:pistol']]);
  });
});

describe('room modifiers (TEST-ONLY profiles; the shipped profiles stay neutral)', () => {
  it('density 0 on a room: never a spawn there; count, attempt, types, families and loot unchanged', () => {
    const P0 = withRooms(SUBWAY, {'service-corridor': {all: {density: 0}}});
    let before = 0;
    for (const seed of SEEDS) {
      const n = station(seed), l = station(seed, P0, 'corr0');
      before += n.zombies.filter(z => keyOf(n, z) === 'service-corridor').length;
      expect(l.zombies.filter(z => keyOf(l, z) === 'service-corridor' || l.areas[z.area].type === 'service-corridor'), `${seed}`).toEqual([]);
      // the count roll comes first and is untouched; capacity elsewhere is ample: every spawn is still placed
      expect(l.attempt).toBe(n.attempt);
      expect(l.zombies.length).toBe(n.zombies.length);
      expect(l.zombies.map(z => z.type)).toEqual(n.zombies.map(z => z.type));
      // 'all' density does not change the room's family mix: the per-index family roll is identical
      expect(l.zombies.map(z => z.archetype)).toEqual(n.zombies.map(z => z.archetype));
      // unrelated loot: props / holders and the item multiset are identical (only the storey-moved loose supplies share the stream)
      expect(propsJson(l)).toBe(propsJson(n));
      expect(pickupItems(l)).toEqual(pickupItems(n));
    }
    expect(before, 'the neutral corpus has service-corridor spawns').toBeGreaterThan(10);
  });

  it('density 2 on a room: chosen earlier and more often over the seed set; caps hold; the total is unchanged', () => {
    const P2 = withRooms(SUBWAY, {'stock-room': {all: {density: 2}}});
    let n0 = 0, n2 = 0, idx0 = 0, idx2 = 0;
    for (const seed of SEEDS) {
      const n = station(seed), l = station(seed, P2, 'stock2');
      const inN = n.zombies.map((z, i) => ({z, i})).filter(e => keyOf(n, e.z) === 'stock-room');
      const inL = l.zombies.map((z, i) => ({z, i})).filter(e => keyOf(l, e.z) === 'stock-room');
      n0 += inN.length; n2 += inL.length;
      idx0 += inN.reduce((s, e) => s + e.i, 0); idx2 += inL.reduce((s, e) => s + e.i, 0);
      expect(l.zombies.length).toBe(n.zombies.length);
      // caps: no area above its third-pass cap (platforms + 1, closets / exits / storefronts 1)
      const per = new Map<number, number>();
      for (const z of l.zombies) per.set(z.area, (per.get(z.area) ?? 0) + 1);
      for (const [id, c] of per) expect(c, `area ${id}`).toBeLessThanOrEqual(areaCap(SUBWAY.contexts.station!.placement.caps, l.areas[id], 3));
    }
    process.stdout.write(`\n[enemy-spawn-tables] stock-room spawns over ${SEEDS.length} stations: neutral ${n0} (mean index ${(idx0 / n0).toFixed(1)}), density 2 ${n2} (mean index ${(idx2 / n2).toFixed(1)})\n`);
    expect(n2).toBeGreaterThan(n0);
    expect(idx2 / n2).toBeLessThan(idx0 / n0);
  });

  it('weight 0 for ratdog in a room: no ratdog there; positions, types and every other room\'s families identical', () => {
    const W0 = withRooms(SUBWAY, {platform: {ratdog: {weight: 0}}});
    let ratsBefore = 0, platformSpawns = 0;
    for (const seed of [...SEEDS, 24839, 32758]) {
      const n = station(seed), l = station(seed, W0, 'plat-rat0');
      expect(placement(l)).toEqual(placement(n)); // weights never touch an RNG stream
      expect(pickupHash(l)).toBe(pickupHash(n));
      l.zombies.forEach((z, i) => {
        if (keyOf(l, z) === 'platform') { platformSpawns++; expect(z.archetype).not.toBe('ratdog'); if (n.zombies[i].archetype === 'ratdog') ratsBefore++; }
        else expect(z.archetype).toBe(n.zombies[i].archetype);
      });
    }
    expect(platformSpawns).toBeGreaterThan(5);
    process.stdout.write(`\n[enemy-spawn-tables] platform spawns ${platformSpawns}, neutral rat/dogs among them ${ratsBefore} (now 0)\n`);
  });

  it('weight 0 / 2 on the exact roll: the family share changes in that room only (synthetic spawns, conditional share p·w / Σ)', () => {
    const N = 40000;
    const areas = [{purpose: undefined, type: 'platform' as const}, {purpose: undefined, type: 'concourse' as const}];
    const mk = () => ({seed: 123457, areas, zombies: Array.from({length: N}, (_, i) => ({area: i % 2} as {area: number; archetype?: 'zombie' | 'ratdog'}))});
    const neutral = mk(), w2 = mk(), w0 = mk();
    assignEnemyArchetypes(neutral, SUBWAY);
    assignEnemyArchetypes(w2, withRooms(SUBWAY, {platform: {ratdog: {weight: 2}}}));
    assignEnemyArchetypes(w0, withRooms(SUBWAY, {platform: {ratdog: {weight: 0}}}));
    const share = (l: ReturnType<typeof mk>, a: number) => l.zombies.filter(z => z.area === a && z.archetype === 'ratdog').length / (N / 2);
    expect(Math.abs(share(neutral, 0) - 0.05)).toBeLessThan(0.006);
    expect(Math.abs(share(w2, 0) - 0.1 / 1.05)).toBeLessThan(0.008);
    expect(share(w0, 0)).toBe(0);
    // the other room is untouched, index by index
    for (const l of [w2, w0]) expect(l.zombies.filter(z => z.area === 1).map(z => z.archetype)).toEqual(neutral.zombies.filter(z => z.area === 1).map(z => z.archetype));
    // the same roll walked over the room pool
    expect(pickEnemyArchetype(9, 4, roomFamilyPool(withRooms(SUBWAY, {platform: {zombie: {weight: 0}}}), areas[0]))).toBe(enemyRoll(9, 4) < 0.5 ? 'blightbelly' : 'ratdog');
  });

  it('per-family density: intensity D = Σ p·w·d / Σ p·w, the mix p·w·d; all.density multiplies D only', () => {
    const a = {type: 'platform' as const};
    const R0 = withRooms(SUBWAY, {platform: {ratdog: {density: 0}}});
    expect(roomIntensity(R0, a)).toBeCloseTo(0.95, 12);
    expect(roomFamilyPool(R0, a)).toEqual([['zombie', 0.9], ['blightbelly', 0.05], ['siren', 0], ['ratdog', 0], ['strainer', 0]]);
    const R2 = withRooms(SUBWAY, {platform: {ratdog: {density: 2}}});
    expect(roomIntensity(R2, a)).toBeCloseTo(1.05, 12);
    // family intensity in the room = D x its share of the room mix: zombies keep 0.9 (first order), rat/dogs double 0.05 -> 0.1
    const pool2 = roomFamilyPool(R2, a), mix = pool2.reduce((t, [, w]) => t + w, 0);
    expect(roomIntensity(R2, a) * pool2[0][1] / mix).toBeCloseTo(0.9, 12);
    expect(roomIntensity(R2, a) * pool2[3][1] / mix).toBeCloseTo(0.1, 12);
    const A = withRooms(SUBWAY, {platform: {all: {density: 3}, ratdog: {weight: 0}}});
    expect(roomIntensity(A, a)).toBe(3); // weight alone never changes the intensity
    expect(roomFamilyPool(A, a)).toEqual([['zombie', 0.9], ['blightbelly', 0.05], ['siren', 0], ['ratdog', 0], ['strainer', 0]]);
    expect(roomModifier(A, a, 'zombie')).toEqual({density: 3, weight: 1});
    // purpose entry first, then the room type, per field; missing = 1
    const F = withRooms(SUBWAY, {'first-aid-room': {ratdog: {weight: 0}}, 'stock-room': {ratdog: {weight: 4, density: 2}}});
    expect(roomModifier(F, {purpose: 'first-aid-room', type: 'stock-room'}, 'ratdog')).toEqual({density: 2, weight: 0});
    expect(roomModifier(F, {purpose: 'first-aid-room', type: 'stock-room'}, 'zombie')).toEqual({density: 1, weight: 1});
    // the Office roof deck carries the preset purpose 'office-stair': its room type 'office-roof' still reaches it
    expect(roomIntensity(withRooms(OFFICE, {'office-roof': {all: {density: 0}}}), {purpose: 'office-stair', type: 'office-roof'})).toBe(0);
  });

  it('Office: density 0 on the corridors: none there; every storey count, the attempt and all loot unchanged', () => {
    const P0 = withRooms(OFFICE, {'office-corridor': {all: {density: 0}}});
    let before = 0;
    for (const seed of [11, 222]) {
      const n = office(seed), l = office(seed, P0, 'corr0');
      before += n.zombies.filter(z => l.areas[z.area].type === 'office-corridor').length;
      expect(l.zombies.filter(z => l.areas[z.area].type === 'office-corridor'), `${seed}`).toEqual([]);
      expect(l.attempt).toBe(n.attempt);
      expect(contextCounts(l)).toBe(contextCounts(n));
      expect(l.zombies.map(z => z.type)).toEqual(n.zombies.map(z => z.type));
      expect(pickupHash(l)).toBe(pickupHash(n)); // every Office loot placement runs on its own fork
      expect(propsJson(l)).toBe(propsJson(n));
    }
    expect(before).toBeGreaterThan(3);
  });
});

describe('validation', () => {
  it('rejects bad values, unknown keys and knobs (and accepts the shipped profiles)', () => {
    for (const id of LEVEL_IDS) expect(validateSpawnProfile(spawnProfile(id))).toEqual([]);
    const st = SUBWAY.contexts.station!;
    const bad: [string, SpawnProfile][] = [
      ['NaN density', withRooms(SUBWAY, {platform: {zombie: {density: NaN}}})],
      ['negative weight', withRooms(SUBWAY, {platform: {ratdog: {weight: -1}}})],
      ['infinite density', withRooms(SUBWAY, {platform: {all: {density: Infinity}}})],
      ['unknown room key', withRooms(SUBWAY, {'no-such-room': {zombie: {weight: 2}}})],
      ['unknown family', withRooms(SUBWAY, {platform: {dragon: {weight: 2}} as never})],
      ['weight on all', withRooms(SUBWAY, {platform: {all: {weight: 2}} as never})],
      ['unknown modifier knob', withRooms(SUBWAY, {platform: {zombie: {chance: 2}} as never})],
      ['count lo > hi', {...SUBWAY, contexts: {station: {...st, count: [32, 22]}}}],
      ['fractional count', {...SUBWAY, contexts: {station: {...st, count: [2.5, 4]}}}],
      ['unknown context', {...SUBWAY, contexts: {...SUBWAY.contexts, cellar: st} as never}],
      ['coated chance > 1', {...SUBWAY, zombieTypes: {coatedChance: 1.5, atLeastOneEach: true}}],
      ['family missing', {...SUBWAY, families: [['zombie', 1]]}],
      ['family twice', {...SUBWAY, families: [['zombie', 1], ['ratdog', 0.1], ['zombie', 1]]}],
      ['negative pool weight', {...SUBWAY, families: [['zombie', 1], ['ratdog', -0.1]]}],
      ['all-zero pool with enemies', {...SUBWAY, families: [['zombie', 0], ['ratdog', 0]]}],
      ['zero tries', {...SUBWAY, contexts: {station: {...st, placement: {...st.placement, tries: 0}}}}],
      ['unknown room type in a rule', {...SUBWAY, contexts: {station: {...st, placement: {...st.placement, areaWeights: {...st.placement.areaWeights, rules: [{when: {type: ['ballroom' as never]}, weight: 1, why: ''}]}}}}}],
      ['unknown area kind in a cap', {...SUBWAY, contexts: {station: {...st, placement: {...st.placement, caps: {passes: [1], rules: [{when: {kind: ['attic' as never]}, fixed: 1, why: ''}]}}}}}],
      ['moves closer than the station', {...SUBWAY, levelMoves: {...SUBWAY.levelMoves!, startCells: 10}}],
      ['unknown profile knob', {...SUBWAY, density: 2} as never],
    ];
    for (const [what, p] of bad) expect(validateSpawnProfile(p).length, what).toBeGreaterThan(0);
    // explicit zeros ARE valid (the documented way to disable a room / a family there); an all-zero pool with count [0, 0] = no enemies
    expect(validateSpawnProfile(withRooms(SUBWAY, {platform: {all: {density: 0}, ratdog: {weight: 0, density: 0}}}))).toEqual([]);
    expect(validateSpawnProfile({...OFFICE, families: [['zombie', 0], ['blightbelly', 0], ['siren', 0], ['ratdog', 0], ['strainer', 0]],
      contexts: Object.fromEntries(Object.entries(OFFICE.contexts).map(([k, c]) => [k, {...c!, count: [0, 0] as const}]))})).toEqual([]);
  });
});

describe('persistence', () => {
  it('Retry / re-entry regenerate the identical spawns from the seed; killed indices keep naming the same spawns', () => {
    const a = station(42), b = generateStation(42, {spawns: SUBWAY});
    expect(spawnSpecHash(b)).toBe(spawnSpecHash(a));
    const mem = createMemory({level: 'subway', section: 'main'});
    mem.killed = [0, 3, 7];
    const alive = enemiesToSpawn(b.zombies.length, mem);
    expect(alive.length).toBe(b.zombies.length - 3);
    expect(alive.map(i => spawnRecord(b, i))).toEqual(alive.map(i => spawnRecord(a, i)));
    // the Office is ONE generation for every storey: the same level seed gives the same spawns on every floor (no per-floor reroll)
    const o1 = office(11), o2 = LEVELS.office.generate('main', {levelSeed: 11, startWeapon: 'pistol'});
    expect(spawnSpecHash(o2)).toBe(spawnSpecHash(o1));
    expect(spawnContext(OFFICE, 'floor')).toBe(OFFICE.contexts.floor);
  });
});
