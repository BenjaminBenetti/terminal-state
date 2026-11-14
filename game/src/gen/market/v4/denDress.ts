// Task studio-corpse-market-shop-20261114-031614-01 (lane LAYOUT): the FURNISHING of the corpse buyer's den (layout version 4; the carve:
// gen/market/v4/denCarve.ts) — appended after everything version 3 placed, on the den's own fork (no other stream draws).
//  - the den's two fixtures (gen/market/v4/denKinds.ts): the buyer's BOOTH standing in the booth wall's opening (it closes it: its box
//    spans the opening, its ends reaching into the jambs), front toward the customer; the floor CHUTE in the customer room, its open side
//    toward the way in, DEN.chuteGap in front of the booth, clear floor all round;
//  - light, grim dressing from kinds the market already loads (no new kind): trash bags, a hand truck and a mop bucket along the customer
//    room's far wall, empty steel shelving and bags in the back room — every one through the shared placement kit (blocked
//    cells, connectivity), kept off the way in, the chute's ring and mouth, the dealing floor in front of the booth and the buyer's post; every loot
//    holder carries the market's exact empty key (the market rule), movables keep their ordinary physics;
//  - low, moody light: a dim RED lamp in front of the booth, a faint red one over the buyer, one dim ordinary lamp in the passage;
//  - discoverable: painted boards over the door on the Back Lane ("BODIES BOUGHT", the price), a hanging board in front of the booth.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {isLootHolderKind} from '../../../items/loot';
import {cellsOfBox, makePlaceCtx, markCell, tryPlaceProp} from '../../placeKit';
import type {Area, LightPlacement, SignPlacement, SignStyle, StationLayout} from '../../stationTypes';
import {MARKET_EMPTY_KEY} from '../dress';
import {CORPSE_BOOTH_KIND, CORPSE_CHUTE_KIND} from './denKinds';
import {DEN, type DenCarve} from './denCarve';

/** The den's red lamps (LightPlacement.tint: linear RGB, ~unit luminance; world/lightField.ts fixtureTint) and their power. */
export const DEN_RED: readonly [number, number, number] = [2.4, 0.42, 0.3];
export const DEN_LIGHTS = {booth: 0.5, back: 0.3, passage: 0.4} as const;
/** The painted boards: the door's name and price (Back Lane side), the booth's terms (hanging in front of it); dried-blood on soot. */
export const DEN_SIGNS = {door: 'BODIES BOUGHT', price: '10 TIES', booth: 'DEAD ONES ONLY · 10 TIES'} as const;
export const DEN_SIGN_STYLE: SignStyle = {bg: 0x1c1412, fg: 0xe6dcc4, accent: 0x7a1a14, font: 'condensed'};

/** The furnished den: its two fixtures (layout.props indices). */
export interface DenDressed { booth: number; chute: number }

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function dressDen(layout: StationLayout, dc: DenCarve, rng: Rng): DenDressed {
  const g = layout.grid, W = g.w, P = dc.plan;

  // --- the fixtures, placed directly (the booth stands IN the wall opening, its ends in the jambs: beyond the placement kit's own-area
  // rule); their floor cells blocked (nav / collision broadphase / the validators' floods)
  const fixture = (kind: PropKind, x: number, z: number, rot: number, area: number): number => {
    const def = PROP_DEFS[kind], {hx, hz} = footprint(kind, rot);
    const p: PropPlacement = {kind, x: r3(x), z: r3(z), y: 0, rot, area, hx, hz, h: def.h, blocksSight: def.blocksSight, variant: 0};
    const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR) continue;
      g.blocked[g.idx(cx, cy)] = 1;
      if (def.blocksSight) g.sightBlocked[g.idx(cx, cy)] = 1;
    }
    layout.props.push(p);
    return layout.props.length - 1;
  };
  const booth = fixture(CORPSE_BOOTH_KIND, dc.booth.x, dc.booth.z, dc.booth.rot, dc.room.id);
  const chute = fixture(CORPSE_CHUTE_KIND, dc.chute.x, dc.chute.z, dc.chute.rot, dc.room.id);

  // --- the decor: kept off every cell the den's use needs (canonical columns: mirror-free rules) -------------------------------------
  const ctx = makePlaceCtx(layout, rng, 0, {x0: Math.min(dc.passage.x, dc.back.x, dc.room.x) - 1, y0: dc.passage.y - 1, x1: Math.max(dc.passage.x + dc.passage.w, dc.back.x + dc.back.w, dc.room.x + dc.room.w), y1: dc.room.y + dc.room.h});
  const canonX = (x: number) => (dc.mirror ? W - 1 - x : x); // world column -> canonical column
  const cp = layout.props[chute], [kx0, ky0, kx1, ky1] = cellsOfBox(cp.x, cp.z, cp.hx, cp.hz);
  const chuteC0 = Math.min(canonX(kx0), canonX(kx1));
  const bandRows = Math.ceil(DEN.band / CELL - 1e-6);
  // the floor in front of the chute's open side (1 m deep, its width): where a body is tipped in
  const fx = Math.sin(cp.rot), fz = Math.cos(cp.rot), halfAlong = Math.abs(fx) * cp.hx + Math.abs(fz) * cp.hz, halfAcross = Math.abs(fz) * cp.hx + Math.abs(fx) * cp.hz;
  const mouth = (wx: number, wz: number) => {
    const along = (wx - cp.x) * fx + (wz - cp.z) * fz, across = Math.abs((wx - cp.x) * fz - (wz - cp.z) * fx);
    return along > 0 && along < halfAlong + 1.25 && across < halfAcross + 0.25;
  };
  for (const a of [dc.passage, dc.room, dc.back]) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.area[i] !== a.id) continue;
    const [wx, wz] = g.center(x, y), c = canonX(x);
    const keep = a === dc.passage // the passage: the way in
      || (a === dc.room && (y < dc.rows.r0 + bandRows // the way in north of the chute
        || (x >= kx0 - 1 && x <= kx1 + 1 && y >= ky0 - 1 && y <= ky1 + 1) // the chute's ring
        || mouth(wx, wz) // the floor in front of its open side
        || c >= chuteC0 - 1)) // the dealing floor between the chute and the booth (the tray, the customer's spot)
      || (a === dc.back && Math.hypot(wx - dc.buyer.x, wz - dc.buyer.z) < 0.85); // the buyer's post
    if (keep) markCell(ctx, ctx.keep, i);
  }
  const put = (a: Area, kind: PropKind, cx: number, cz: number, crot: number): PropPlacement | null => {
    const p = tryPlaceProp(ctx, a, kind, dc.wx(cx), r3(cz), dc.wr(crot), {checkZone: false});
    if (p && isLootHolderKind(kind)) p.purpose = MARKET_EMPTY_KEY;
    if (p) p.variant = rng.int(0, 11);
    return p;
  };
  // the customer room's far (south) wall, west to east from the passage side: bags, a hand truck, a mop bucket (facing the room), each
  // centred on its own run of cells (no two share a cell); what reaches the chute's ring is left out
  let c0 = DEN.passageX;
  for (const kind of ['trashBagPile', 'handTruck', 'mopBucketWringer'] as PropKind[]) {
    const {hx, hz} = footprint(kind, Math.PI), n = Math.max(1, Math.ceil((2 * hx - 0.08) / CELL - 1e-6));
    put(dc.room, kind, (c0 + n / 2) * CELL, P.z1 - hz - 0.03, Math.PI);
    c0 += n;
  }
  // the back room, against its far wall: empty steel shelving (north), a pile of bags (south)
  {
    const sh = footprint('shelf', -Math.PI / 2), bags = footprint('trashBagPile', -Math.PI / 2);
    put(dc.back, 'shelf', P.backX1 - sh.hx - 0.03, P.z0 + sh.hz + 0.05, -Math.PI / 2);
    put(dc.back, 'trashBagPile', P.backX1 - bags.hx - 0.03, P.z1 - bags.hz - 0.05, -Math.PI / 2);
  }

  // --- the lamps (hung under the container-height ceiling, tubes along z) -------------------------------------------------------------
  const lamp = (a: Area, cx: number, cz: number, o: Partial<LightPlacement>) => {
    layout.lights.push({x: dc.wx(cx), y: r3(DEN.ceil - 0.02), z: r3(cz), rot: dc.wr(Math.PI / 2), area: a.id, broken: false, flicker: false, warm: true, power: 0.45, dying: false, ...o});
  };
  lamp(dc.room, P.xf - 1.3, P.zb, {warm: false, power: DEN_LIGHTS.booth, tint: DEN_RED});
  lamp(dc.back, (DEN.divider + 1 + DEN.backW / 2) * CELL, P.zb, {warm: false, power: DEN_LIGHTS.back, tint: DEN_RED});
  lamp(dc.passage, (DEN.passageX + DEN.passageW / 2) * CELL, P.doorZ, {power: DEN_LIGHTS.passage});

  // --- the boards: over the door on the Back Lane's face of the shed wall (above the door head), hanging in front of the booth ----------
  const sign = (s: Omit<SignPlacement, 'kind' | 'style'>) => { layout.signs.push({kind: 'info', ...s, style: {...DEN_SIGN_STYLE}}); };
  sign({text: DEN_SIGNS.door, area: dc.lane, x: dc.wx(P.laneX + 0.02), z: r3(P.doorZ), y: 2.62, rot: dc.wr(Math.PI / 2), w: 1.9});
  sign({text: DEN_SIGNS.price, area: dc.lane, x: dc.wx(P.laneX + 0.02), z: r3(P.doorZ), y: 3.0, rot: dc.wr(Math.PI / 2), w: 1.0});
  sign({text: DEN_SIGNS.booth, area: dc.room.id, x: dc.wx(P.xf - 0.3), z: r3(P.zb), y: 2.28, rot: dc.wr(-Math.PI / 2), w: 1.8, hang: true});
  return {booth, chute};
}
