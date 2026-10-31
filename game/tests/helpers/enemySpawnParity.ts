// Task enemy-spawn-tables-20261030 (lane SPAWN): canonical hash of a generated layout's ENEMY SPAWN SPECS (shared by
// tests/enemy-spawn-parity.test.ts and tests/enemy-spawn-tables.test.ts).
//
// Every spawn in layout order: index, family (archetype), zombie type, exact x / y / z / yaw (full float repr: bit-identical, not
// rounded), area id, area key (purpose ?? type), level. Plus the per-context counts (Office: street = levels 0 + 1, floors 2..8,
// roof 9) and a separate hash of every layout pickup — the level-moved loose supplies are drawn on the SAME rng fork right after
// the Subway's level moves of the zombies (gen/levelGenDress.ts placeLevelSpawns), so they are downstream RNG state of the spawns.

import type {StationLayout} from '../../src/gen/stationTypes';
import {ROOF_FIND_KEY} from '../../src/items/lootTables';
import {isExtensionArea} from '../../src/gen/trackExt/index';

export function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** One spawn record, exact floats (String(number) round-trips the double). `maskFamily`: the family field reads '*'. */
export function spawnRecord(l: StationLayout, i: number, maskFamily = false): string {
  const z = l.zombies[i];
  const a = l.areas[z.area];
  return `${i}|${maskFamily ? '*' : z.archetype ?? '-'}|${z.type}|${z.x}|${z.y ?? '-'}|${z.z}|${z.yaw}|${z.area}|${a ? a.purpose ?? a.type : '?'}|${z.level ?? 0}`;
}

export function spawnSpecHash(l: StationLayout): string {
  let h = fnv(`${l.seed}|${l.attempt}|${l.zombies.length}`);
  for (let i = 0; i < l.zombies.length; i++) h = fnv(spawnRecord(l, i), h);
  return h.toString(16).padStart(8, '0');
}

/**
 * Task track1-siren-blightbelly-20261031 (lane SPAWN): the spawn spec hash with the FAMILY field masked — count, order, zombie type,
 * exact x / y / z / yaw, area id + key, level of every spawn. A family-composition change must leave it untouched.
 */
export function maskedSpawnSpecHash(l: StationLayout): string {
  let h = fnv(`${l.seed}|${l.attempt}|${l.zombies.length}`);
  for (let i = 0; i < l.zombies.length; i++) h = fnv(spawnRecord(l, i, true), h);
  return h.toString(16).padStart(8, '0');
}

/** Spawn indices of one family (absent archetype = zombie), in layout order. */
export function familyIndices(l: StationLayout, family: string): number[] {
  return l.zombies.flatMap((z, i) => ((z.archetype ?? 'zombie') === family ? [i] : []));
}

/**
 * The layout's downstream pickups. The Office roof FIND (task gas-mask-roof-feedback-20261030: PickupPlacement.reward =
 * ROOF_FIND_KEY, appended last) is left out: it is a deliberate new reward pinned in loot-golden.test.ts (officeRoofFind) and
 * office-roof-reward.test.ts, so every other pickup stays held to the same byte-identical parity.
 */
export function pickupHash(l: StationLayout): string {
  const list = l.pickups.filter(p => p.reward !== ROOF_FIND_KEY);
  let h = fnv(`${list.length}`);
  for (const p of list) h = fnv(`${p.itemId}|${p.count}|${p.x}|${p.y}|${p.z}|${p.area}|${p.level ?? 0}`, h);
  return h.toString(16).padStart(8, '0');
}

/**
 * Spawn counts per generation context: Subway 'station' (+ per storey); Office street / floors 2..8 / roof. Track 2 (lane CONTENT):
 * the service annexes' spawns (context 'service', in extension areas) are counted SEPARATELY (` + service N`, absent when none),
 * so the core contexts' counts read exactly as before.
 */
export function contextCounts(l: StationLayout): string {
  const by = new Map<number, number>();
  let service = 0;
  for (const z of l.zombies) {
    if (isExtensionArea(l.areas[z.area])) { service++; continue; }
    by.set(z.level ?? 0, (by.get(z.level ?? 0) ?? 0) + 1);
  }
  const svc = service ? ` + service ${service}` : '';
  if (!l.office) return `station ${l.zombies.length - service} (L0 ${by.get(0) ?? 0} L1 ${by.get(1) ?? 0} L2 ${by.get(2) ?? 0})${svc}`;
  const parts = [`street ${(by.get(0) ?? 0) + (by.get(1) ?? 0)}`];
  for (let n = 2; n <= 8; n++) parts.push(`f${n} ${by.get(n) ?? 0}`);
  parts.push(`roof ${by.get(9) ?? 0}`);
  return parts.join(' ') + svc;
}

/** Subway parity corpus: the office-gen fingerprint seeds with both start weapons + one forced seed per archetype. */
export const SUBWAY_PARITY = [
  ...[1, 7, 42, 1234].flatMap(seed => (['rifle', 'pistol'] as const).map(startWeapon => ({seed, startWeapon, archetype: undefined}))),
  ...(['side-mezzanine', 'island-ends', 'express', 'interchange', 'split', 'deep'] as const).map((archetype, k) => ({seed: 9001 + k * 7919, startWeapon: 'rifle' as const, archetype})),
];
export const subwayKey = (c: (typeof SUBWAY_PARITY)[number]) => `${c.seed}:${c.startWeapon}${c.archetype ? `:${c.archetype}` : ''}`;

/** Office parity corpus (station + lobby, floors 2..8, roof of the ONE level). */
export const OFFICE_PARITY = [
  {levelSeed: 11, startWeapon: 'pistol' as const}, {levelSeed: 222, startWeapon: 'pistol' as const},
  {levelSeed: 3333, startWeapon: 'pistol' as const}, {levelSeed: 4242, startWeapon: 'pistol' as const},
  {levelSeed: 11, startWeapon: 'rifle' as const},
];
export const officeKey = (c: (typeof OFFICE_PARITY)[number]) => `${c.levelSeed}:${c.startWeapon}`;

// PIN HISTORY: tests/enemy-spawn-parity.test.ts. Stage 3 (task track1-siren-blightbelly-20261031): the families Blightbelly (both
// levels) and Siren (Office) replace shares of the zombie slots — the spec hash moves ONLY through the family field: the masked
// hash, the pickup hash, the context counts and the rat/dog indices are the INVARIANT pins below, captured from the untouched
// main dba90dd sources.
/** [spawn spec hash, pickup hash, context counts] per corpus entry — stage 3 (task track1; pickups / counts as at main 932624e). */
export const SUBWAY_GOLDEN: Record<string, readonly [string, string, string]> = {
  '1:rifle': ['52c57838', '262ff5d8', 'station 28 (L0 22 L1 2 L2 4)'],
  '1:pistol': ['52c57838', '066f09e3', 'station 28 (L0 22 L1 2 L2 4)'],
  '7:rifle': ['9ffd5bd5', 'ff632831', 'station 23 (L0 18 L1 3 L2 2)'],
  '7:pistol': ['9ffd5bd5', '32b70455', 'station 23 (L0 18 L1 3 L2 2)'],
  '42:rifle': ['1d09d867', 'a7674cf5', 'station 30 (L0 24 L1 2 L2 4)'],
  '42:pistol': ['1d09d867', '569e091c', 'station 30 (L0 24 L1 2 L2 4)'],
  '1234:rifle': ['b1e955bd', '1c40b92a', 'station 31 (L0 21 L1 6 L2 4)'],
  '1234:pistol': ['b1e955bd', '344c2e2d', 'station 31 (L0 21 L1 6 L2 4)'],
  '9001:rifle:side-mezzanine': ['9f96c951', 'c8431649', 'station 30 (L0 23 L1 2 L2 5)'],
  '16920:rifle:island-ends': ['85de6292', 'c2c7277a', 'station 30 (L0 22 L1 5 L2 3)'],
  '24839:rifle:express': ['1c6c666f', '60427365', 'station 25 (L0 17 L1 4 L2 4)'],
  '32758:rifle:interchange': ['409a0efd', 'e4e49861', 'station 31 (L0 23 L1 3 L2 5)'],
  '40677:rifle:split': ['ea09047b', '314cffa5', 'station 23 (L0 18 L1 2 L2 3)'],
  '48596:rifle:deep': ['8388ceeb', 'ff5eebea', 'station 32 (L0 25 L1 2 L2 5)'],
};
/**
 * Stage 4 (Track 2, lane GEN — pin history in tests/enemy-spawn-parity.test.ts): the LIVE Subway layouts. Entries equal to
 * SUBWAY_GOLDEN are stations whose extensions never reach west / north (or that have none); the others are the same spawns and
 * pickups translated with the core (their core view reproduces SUBWAY_GOLDEN byte for byte, asserted every run).
 */
export const SUBWAY_GOLDEN_TRACK2: Record<string, readonly [string, string, string]> = {
  ...SUBWAY_GOLDEN,
  // translated cores (same spawns / families / counts / areas; x / z shifted with the core)
  '32758:rifle:interchange': ['aae8c931', '27accbd0', 'station 31 (L0 23 L1 3 L2 5)'],
  // Stage 5 (Track 2, lane CONTENT): stations with a service annex APPEND its service spawns (context 'service', counted separately)
  // and its loose floor finds after every core record — the core view still reproduces SUBWAY_GOLDEN (asserted every run). Before
  // (stage 4, translated cores): 42 17f06a80 / 5b5d5bad (pistol 2b39a883), 9001 fe56616a / 294e2619, 48596 14b06df2 / fe055a49,
  // 16920 = SUBWAY_GOLDEN.
  '42:rifle': ['8321574e', '415337e2', 'station 30 (L0 24 L1 2 L2 4) + service 4'],
  '42:pistol': ['8321574e', 'c392434c', 'station 30 (L0 24 L1 2 L2 4) + service 4'],
  '9001:rifle:side-mezzanine': ['05ae2856', '01040514', 'station 30 (L0 23 L1 2 L2 5) + service 3'],
  '16920:rifle:island-ends': ['06a8cd42', '366aae1d', 'station 30 (L0 22 L1 5 L2 3) + service 5'],
  '48596:rifle:deep': ['5e7443ff', '0ac9c3da', 'station 32 (L0 25 L1 2 L2 5) + service 3'],
};
// Office: stage 3 (task track1-siren-blightbelly-20261031); pickups / counts as at stage 2 (task office-props-physics-scale-20261030).
export const OFFICE_GOLDEN: Record<string, readonly [string, string, string]> = {
  '11:pistol': ['73536b5a', 'ef270423', 'street 5 f2 5 f3 5 f4 5 f5 5 f6 6 f7 5 f8 6 roof 1'],
  '222:pistol': ['5e4e485b', '3e9001ac', 'street 7 f2 3 f3 3 f4 3 f5 3 f6 5 f7 4 f8 6 roof 1'],
  '3333:pistol': ['9720588a', 'bc96b5e2', 'street 5 f2 4 f3 4 f4 5 f5 4 f6 4 f7 4 f8 6 roof 2'],
  '4242:pistol': ['46b33d60', 'ba008081', 'street 8 f2 6 f3 4 f4 6 f5 4 f6 3 f7 5 f8 4 roof 0'],
  '11:rifle': ['73536b5a', '7cb613ae', 'street 5 f2 5 f3 5 f4 5 f5 5 f6 6 f7 5 f8 6 roof 1'],
};

/**
 * Stage 5 (Track 2, lane CONTENT): the LIVE Office layouts. Levels whose street station grew service annexes append their service
 * spawns (context 'service', counted separately) and loose floor finds after every core record; the core view still reproduces
 * OFFICE_GOLDEN byte for byte (asserted every run). Entries without an annex equal OFFICE_GOLDEN.
 */
export const OFFICE_GOLDEN_TRACK2: Record<string, readonly [string, string, string]> = {
  ...OFFICE_GOLDEN,
  '222:pistol': ['fc17be7a', 'e2d2d41d', 'street 7 f2 3 f3 3 f4 3 f5 3 f6 5 f7 4 f8 6 roof 1 + service 7'],
  '3333:pistol': ['66709f4c', 'adaf922a', 'street 5 f2 4 f3 4 f4 5 f5 4 f6 4 f7 4 f8 6 roof 2 + service 6'],
  '4242:pistol': ['b7048532', '36b424a5', 'street 8 f2 6 f3 4 f4 6 f5 4 f6 3 f7 5 f8 4 roof 0 + service 9'],
};

/**
 * INVARIANT pins (task track1-siren-blightbelly-20261031, lane SPAWN): [family-masked spec hash, rat/dog spawn indices] per corpus
 * entry, computed from the UNTOUCHED main dba90dd sources (`git archive dba90dd game/src`, before any task track1 change; their
 * full hashes reproduced the stage-1 / stage-2 goldens exactly). A family-composition change keeps these; only a layout / RNG
 * change may move them, and that needs its own cause + evidence.
 */
export const SUBWAY_INVARIANT: Record<string, readonly [string, readonly number[]]> = {
  '1:rifle': ['0495ad52', [9, 25]],
  '1:pistol': ['0495ad52', [9, 25]],
  '7:rifle': ['1c08827e', [15]],
  '7:pistol': ['1c08827e', [15]],
  '42:rifle': ['aadd0d6c', [1, 25, 28]],
  '42:pistol': ['aadd0d6c', [1, 25, 28]],
  '1234:rifle': ['b82e9831', [2, 4]],
  '1234:pistol': ['b82e9831', [2, 4]],
  '9001:rifle:side-mezzanine': ['8fcb9b7d', []],
  '16920:rifle:island-ends': ['2dfe6845', [6]],
  '24839:rifle:express': ['8942a3d1', []],
  '32758:rifle:interchange': ['ec69551c', [17]],
  '40677:rifle:split': ['ff8f1971', [6, 22]],
  '48596:rifle:deep': ['bf618337', [3, 15, 18, 19]],
};
export const OFFICE_INVARIANT: Record<string, readonly [string, readonly number[]]> = {
  '11:pistol': ['ada21f10', [6, 24, 26, 30]],
  '222:pistol': ['bb2a6a60', [20, 31]],
  '3333:pistol': ['3b92b59b', [10]],
  '4242:pistol': ['8b028dba', []],
  '11:rifle': ['ada21f10', [6, 24, 26, 30]],
};
