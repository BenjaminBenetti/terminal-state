// Task enemy-spawn-tables-20261030 (lane SPAWN): canonical hash of a generated layout's ENEMY SPAWN SPECS (shared by
// tests/enemy-spawn-parity.test.ts and tests/enemy-spawn-tables.test.ts).
//
// Every spawn in layout order: index, family (archetype), zombie type, exact x / y / z / yaw (full float repr: bit-identical, not
// rounded), area id, area key (purpose ?? type), level. Plus the per-context counts (Office: street = levels 0 + 1, floors 2..8,
// roof 9) and a separate hash of every layout pickup — the level-moved loose supplies are drawn on the SAME rng fork right after
// the Subway's level moves of the zombies (gen/levelGenDress.ts placeLevelSpawns), so they are downstream RNG state of the spawns.

import type {StationLayout} from '../../src/gen/stationTypes';
import {ROOF_FIND_KEY} from '../../src/items/lootTables';

export function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** One spawn record, exact floats (String(number) round-trips the double). */
export function spawnRecord(l: StationLayout, i: number): string {
  const z = l.zombies[i];
  const a = l.areas[z.area];
  return `${i}|${z.archetype ?? '-'}|${z.type}|${z.x}|${z.y ?? '-'}|${z.z}|${z.yaw}|${z.area}|${a ? a.purpose ?? a.type : '?'}|${z.level ?? 0}`;
}

export function spawnSpecHash(l: StationLayout): string {
  let h = fnv(`${l.seed}|${l.attempt}|${l.zombies.length}`);
  for (let i = 0; i < l.zombies.length; i++) h = fnv(spawnRecord(l, i), h);
  return h.toString(16).padStart(8, '0');
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

/** Spawn counts per generation context: Subway 'station' (+ per storey); Office street / floors 2..8 / roof. */
export function contextCounts(l: StationLayout): string {
  const by = new Map<number, number>();
  for (const z of l.zombies) by.set(z.level ?? 0, (by.get(z.level ?? 0) ?? 0) + 1);
  if (!l.office) return `station ${l.zombies.length} (L0 ${by.get(0) ?? 0} L1 ${by.get(1) ?? 0} L2 ${by.get(2) ?? 0})`;
  const parts = [`street ${(by.get(0) ?? 0) + (by.get(1) ?? 0)}`];
  for (let n = 2; n <= 8; n++) parts.push(`f${n} ${by.get(n) ?? 0}`);
  parts.push(`roof ${by.get(9) ?? 0}`);
  return parts.join(' ');
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

// PINNED at main 932624e before any lane SPAWN source change (pin history: tests/enemy-spawn-parity.test.ts).
/** [spawn spec hash, pickup hash, context counts] per corpus entry — main 932624e. */
export const SUBWAY_GOLDEN: Record<string, readonly [string, string, string]> = {
  '1:rifle': ['a71290f4', '262ff5d8', 'station 28 (L0 22 L1 2 L2 4)'],
  '1:pistol': ['a71290f4', '066f09e3', 'station 28 (L0 22 L1 2 L2 4)'],
  '7:rifle': ['f8281aad', 'ff632831', 'station 23 (L0 18 L1 3 L2 2)'],
  '7:pistol': ['f8281aad', '32b70455', 'station 23 (L0 18 L1 3 L2 2)'],
  '42:rifle': ['4c817345', 'a7674cf5', 'station 30 (L0 24 L1 2 L2 4)'],
  '42:pistol': ['4c817345', '569e091c', 'station 30 (L0 24 L1 2 L2 4)'],
  '1234:rifle': ['e1e089f5', '1c40b92a', 'station 31 (L0 21 L1 6 L2 4)'],
  '1234:pistol': ['e1e089f5', '344c2e2d', 'station 31 (L0 21 L1 6 L2 4)'],
  '9001:rifle:side-mezzanine': ['689b3629', 'c8431649', 'station 30 (L0 23 L1 2 L2 5)'],
  '16920:rifle:island-ends': ['85de6292', 'c2c7277a', 'station 30 (L0 22 L1 5 L2 3)'],
  '24839:rifle:express': ['1c6c666f', '60427365', 'station 25 (L0 17 L1 4 L2 4)'],
  '32758:rifle:interchange': ['9c1d3f5f', 'e4e49861', 'station 31 (L0 23 L1 3 L2 5)'],
  '40677:rifle:split': ['280e6a9b', '314cffa5', 'station 23 (L0 18 L1 2 L2 3)'],
  '48596:rifle:deep': ['41e72df3', 'ff5eebea', 'station 32 (L0 25 L1 2 L2 5)'],
};
// Office: stage 2 (task office-props-physics-scale-20261030) — see the pin history in tests/enemy-spawn-parity.test.ts.
export const OFFICE_GOLDEN: Record<string, readonly [string, string, string]> = {
  '11:pistol': ['5d274546', 'ef270423', 'street 5 f2 5 f3 5 f4 5 f5 5 f6 6 f7 5 f8 6 roof 1'],
  '222:pistol': ['24f81c38', '3e9001ac', 'street 7 f2 3 f3 3 f4 3 f5 3 f6 5 f7 4 f8 6 roof 1'],
  '3333:pistol': ['73e3a9b0', 'bc96b5e2', 'street 5 f2 4 f3 4 f4 5 f5 4 f6 4 f7 4 f8 6 roof 2'],
  '4242:pistol': ['8f127b50', 'ba008081', 'street 8 f2 6 f3 4 f4 6 f5 4 f6 3 f7 5 f8 4 roof 0'],
  '11:rifle': ['5d274546', '7cb613ae', 'street 5 f2 5 f3 5 f4 5 f5 5 f6 6 f7 5 f8 6 roof 1'],
};
