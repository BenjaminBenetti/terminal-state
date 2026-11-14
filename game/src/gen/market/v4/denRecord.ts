// Task studio-corpse-market-shop-20261114-031614-01 (lane LAYOUT): layout version 4's record — version 3's (gen/market/v3/barRecord.ts:
// the seven stalls, the residents' spots, unchanged: the den adds no stall, no spot, no resident) plus THE DEN (gen/market/marketTypes.ts
// MarketDen): its areas, its door's box, the chute (its prop, rim height), the booth (its prop, the payout spot on the floor in front of
// it), the buyer's post behind the booth and the customer's spot in front of it. Pure and deterministic.

import {CELL} from '../../grid';
import type {StationLayout} from '../../stationTypes';
import {CORPSE_SHOP_KIT, type CorpseShopKitModel} from '../../../assets/corpseShopKit.generated';
import type {MarketDen, MarketLayout, MarketPoint} from '../marketTypes';
import {CORPSE_CHUTE_KIND, CORPSE_DEN_PROP_DEFS} from './denKinds';
import type {DenCarve} from './denCarve';
import type {DenDressed} from './denDress';

/** The chute's hopper rim above its base (m): the cooked model's measured rim, else its box top. */
export const DEN_RIM_Y: number = (CORPSE_SHOP_KIT.chute as CorpseShopKitModel).rimY ?? CORPSE_DEN_PROP_DEFS[CORPSE_CHUTE_KIND].h;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pt = (x: number, z: number): MarketPoint => ({x: r3(x), z: r3(z), y: 0, level: 0});

/** The den's record (ground storey: y = the floor, 0). */
export function denRecord(layout: StationLayout, dc: DenCarve, dd: DenDressed): MarketDen {
  const d = dc.door, ch = layout.props[dd.chute], bo = layout.props[dd.booth];
  return {
    area: dc.room.id, back: dc.back.id,
    door: {x0: r3(d.x * CELL), z0: r3(d.y * CELL), x1: r3((d.x + d.w) * CELL), z1: r3((d.y + d.h) * CELL), ...pt((d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL)},
    chute: {...pt(ch.x, ch.z), prop: dd.chute, yaw: ch.rot, rimY: r3(ch.y + DEN_RIM_Y)},
    booth: {...pt(bo.x, bo.z), prop: dd.booth, yaw: bo.rot, tray: pt(dc.tray.x, dc.tray.z)},
    buyer: {...pt(dc.buyer.x, dc.buyer.z), yaw: dc.buyer.yaw},
    front: pt(dc.front.x, dc.front.z),
  };
}

/** Version 3's record made version 4: the same stalls / spots / residents, plus the den. */
export function withDen(m: MarketLayout, den: MarketDen): MarketLayout {
  return {...m, v: 4, den};
}
