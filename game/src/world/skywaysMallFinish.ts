// Task studio-skywalk-encounters-20261108-074144-01 (lane STORES): the Skywalk's MALL STORE FAMILIES (gen/skyways/skywaysMallStores.ts,
// layout version >= 5) on their Mall programme's own walls and floor. PURE DATA (no three.js).
//
// A Mall store's unit is a small storefront unit: its walls / floor would take its station shop use's palette (world/skywaysShopFinish.ts).
// Instead it takes the finish its programme has in the Mall itself (world/mallFinishes.ts PROGRAM_FINISH: the women's fashion store's
// blush plaster over a pale oak dado on pale planks, the jeweller's black marble on white marble, the toy shop's diamond paper on a blue
// checker …), written as rows of the SAME Mall finish table the small-shop palettes use, directly below their reserved rows — and drawn
// under the SAME keys' programs ('skyways-shop-wall|<row>' / 'skyways-shop-floor|<row>'): a Mall store's walls join the small shops'
// wall mesh of their 48 m chunk and its floor their floor mesh, so no draw call is added. Ceilings keep the small shops' rule (the
// pedway's plain plaster). Render only: no layout data. Impact classes per row: from the finish's pattern (damage/impactFinish.ts).

import type {DamageClass} from '../damage/materials';
import type {MallProgram} from '../gen/mall/mallTypes';
import type {StationLayout} from '../gen/stationTypes';
import {SKYWAYS_MALL_STORE_PROGRAMS, type SkywaysMallStoreProgram} from '../gen/skyways/skywaysMallPool';
import {FLOOR, PROGRAM_FINISH, WALL, type MallFloorFinish, type MallWallFinish} from './mallFinishes';
import {SKYWAYS_SHOP_FLOOR_KEY, SKYWAYS_SHOP_ROW0, SKYWAYS_SHOP_WALL_KEY} from './skywaysShopFinish';

/** The first row of the Mall stores' finishes: one wall + one floor row per pool programme, just below the small-shop palettes' rows. */
export const SKYWAYS_MALL_ROW0 = SKYWAYS_SHOP_ROW0 - 2 * SKYWAYS_MALL_STORE_PROGRAMS.length;

/** The finish-table rows of a Mall store programme's wall and floor. */
export function skywaysMallRows(p: SkywaysMallStoreProgram): {wall: number; floor: number} {
  const i = SKYWAYS_MALL_STORE_PROGRAMS.indexOf(p), n = SKYWAYS_MALL_STORE_PROGRAMS.length;
  return {wall: SKYWAYS_MALL_ROW0 + i, floor: SKYWAYS_MALL_ROW0 + n + i};
}
export const skywaysMallWallKey = (p: SkywaysMallStoreProgram): string => `${SKYWAYS_SHOP_WALL_KEY}|${skywaysMallRows(p).wall}`;
export const skywaysMallFloorKey = (p: SkywaysMallStoreProgram): string => `${SKYWAYS_SHOP_FLOOR_KEY}|${skywaysMallRows(p).floor}`;

/** The programme's Mall finish (its wall / floor rows' data). */
export function skywaysMallFinish(p: SkywaysMallStoreProgram): {wall: MallWallFinish; floor: MallFloorFinish} {
  const f = PROGRAM_FINISH[p];
  return {wall: f.wall, floor: f.floor};
}

/** The programme (and wall / floor) of a reserved Mall store row, or null. */
export function skywaysMallRowOf(row: number): {program: SkywaysMallStoreProgram; kind: 'wall' | 'floor'} | null {
  const n = SKYWAYS_MALL_STORE_PROGRAMS.length, i = row - SKYWAYS_MALL_ROW0;
  if (!Number.isInteger(i) || i < 0 || i >= 2 * n) return null;
  return {program: SKYWAYS_MALL_STORE_PROGRAMS[i % n], kind: i < n ? 'wall' : 'floor'};
}

const isPool = (p: string | undefined): p is SkywaysMallStoreProgram => !!p && (SKYWAYS_MALL_STORE_PROGRAMS as readonly string[]).includes(p);

/** The Mall store programme of an area (its storefront's `mall`, a piece of a unit: its parent's), or null — the small-shop rule stays. */
export function skywaysMallProgramOf(layout: StationLayout, areaId: number): SkywaysMallStoreProgram | null {
  let a = layout.areas[areaId];
  for (let k = 0; k < 4 && a && ((a.type as string) === 'shop' || (a.type as string) === 'eatery'); k++) {
    const sf = a.storefront !== undefined ? layout.storefronts[a.storefront] : undefined;
    if (sf) return isPool(sf.mall) ? sf.mall : null;
    if (a.parent === a.id) break;
    a = layout.areas[a.parent];
  }
  return null;
}

/** Bullet-impact class of a wall pattern (its upper finish: the bulk of a hit) / a floor pattern. */
const WALL_CLASS: Readonly<Record<number, DamageClass>> = {
  [WALL.plain]: 'plaster', [WALL.block]: 'concrete', [WALL.tile]: 'tile', [WALL.slat]: 'wood', [WALL.peg]: 'wood', [WALL.plank]: 'wood',
  [WALL.concrete]: 'concrete', [WALL.stone]: 'terrazzo', [WALL.brick]: 'concrete', [WALL.stripe]: 'plaster', [WALL.diamond]: 'plaster',
  [WALL.band]: 'plaster', [WALL.fascia]: 'plaster',
};
const FLOOR_CLASS: Readonly<Record<number, DamageClass>> = {
  [FLOOR.terrazzo]: 'terrazzo', [FLOOR.rings]: 'terrazzo', [FLOOR.stone]: 'terrazzo', [FLOOR.tile]: 'tile', [FLOOR.checker]: 'tile',
  [FLOOR.plank]: 'wood', [FLOOR.concrete]: 'concrete', [FLOOR.vinyl]: 'plastic', [FLOOR.carpet]: 'fabric',
};
/** Impact class of a Mall store programme's wall / floor. */
export function skywaysMallImpactOf(p: SkywaysMallStoreProgram, kind: 'wall' | 'floor'): DamageClass {
  const f = PROGRAM_FINISH[p as MallProgram];
  return kind === 'wall' ? WALL_CLASS[f.wall.upper] ?? 'plaster' : FLOOR_CLASS[f.floor.code] ?? 'tile';
}

/** The impact class of a Mall store row key ('skyways-shop-{wall|floor}|<row>' with a Mall store row), or null (not one of them). */
export function skywaysMallImpact(key: string): DamageClass | null {
  const m = /^skyways-shop-(wall|floor)\|(\d+)$/.exec(key);
  if (!m) return null;
  const r = skywaysMallRowOf(Number(m[2]));
  return r && r.kind === m[1] ? skywaysMallImpactOf(r.program, r.kind) : null;
}
