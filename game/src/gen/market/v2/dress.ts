// Task studio-market-rework-20261108-074144-01 (lane LAYOUT): the furnishing of THE SURVIVOR MARKET version 2 — its own pass (never the
// abandoned-station dresser), existing prop kinds only (the station / p7 / office / the mall's racks, plank shelving and tents the
// market may load), every placement through the shared placement kit (gen/placeKit.ts: blocked cells, access strips, connectivity),
// deterministic on the `dress` fork. User: "Shops need to feel more like shops, not just a guy standing in a very small room, they need
// to have props, and items to make them feel like the shop!"
//
//  - SHOPS (the six stalls): a walk-in container on the Market Lane (customers step in; side shelving, a counter across the back third,
//    the trader behind it, wall shelving / racks behind the trader) or a counter-fronted container on the Back Lane (the counter just
//    inside the wide opening, the trader behind it, shelving on the side and back walls). Every display surface a stall shows its real
//    stock on (counter tops, shelf tiers, planks, rack shelves, table tops) is recorded as a DISPLAY SOURCE (the prop + its surface; the
//    record turns them into layout.market.stalls[i].displays) — the WARES lane's real, owned stock stands there. Display fixtures carry
//    nothing else (no decor on their tops): the trade props (racks, cylinders, generators, crates, tools) stand on the floor beside them.
//  - THE COMMUNAL KITCHEN (opposite the yard), THE BUNK ROOM, THE WORKSHOP (scenery only: no recipes / crafting / conversion), the
//    services (water, latrine, generator shed, storage, a tea counter, a repair bench), homes on the ground and up on the catwalks;
//  - the lanes, the yard, the catwalks and the rooftops: lived-in dressing along the walls (crates, bins, bikes, chairs, plants, tents,
//    water tanks), lamps on the walls and from the roof, painted shop boards, blade signs over the lanes.
//
// THE MARKET RULE (unchanged): nothing placed here holds loot — every loot-holder kind gets the exact empty key (version 1's
// MARKET_EMPTY_KEY); openable storage still opens and is empty; the traders' goods are the trade stock, never pickups.

import type {Rng} from '../../../core/rng';
import {CELL} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {isLootHolderKind} from '../../../items/loot';
import {makePlaceCtx, mountProp, tryPlaceProp, type PlaceOpts} from '../../placeKit';
import type {Area, LightPlacement, Rect, Side, SignPlacement, StationLayout} from '../../stationTypes';
import {MARKET_EMPTY_KEY} from '../dress';
import {STALL_SIGNS} from '../names';
import type {MarketStallId} from '../marketTypes';
import {SETTLE} from './frame';
import type {ContainerCarve, SettleCarve} from './carve';

/** Required pieces that did not fit (QA / tests). */
export const SETTLE_DRESS_FAILS: Record<string, number> = {};

/** A display surface of a stall: the fixture (layout.props index) and which of its surfaces (gen/market/v2/record.ts displaySlotOf). */
export interface DisplaySource { prop: number; surface: number }
/** A stall's furnished record (world metres; the record adds storeys / heights). */
export interface StallDressed2 {
  id: MarketStallId;
  area: number;
  level: number;
  counter: {x0: number; z0: number; x1: number; z1: number};
  trader: {x: number; z: number; yaw: number};
  front: {x: number; z: number};
  displays: DisplaySource[];
}
export type UseKind = 'work' | 'cook' | 'sleep' | 'sit' | 'idle' | 'chat';
/** Anchors the record pass reads. */
export interface SettleAnchors {
  stalls: StallDressed2[];
  /** Resident posts beside the furniture they belong to (and idle / chat posts on open floor). */
  uses: {kind: UseKind; x: number; z: number; level: number; yaw: number; area: number}[];
}

/** Box-top display surface (a counter / table top) and the gun rack's lower cradle shelf (record.ts). */
export const SURF_TOP = -1, SURF_GUN_RACK = -2;

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const WALL_ROT: Record<Side, number> = {N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2};
const OPP: Record<Side, Side> = {N: 'S', S: 'N', E: 'W', W: 'E'};

/** Holder fixtures and their exposed display surfaces (indices into items/lootLayout.ts holderSurfaces) the stalls show stock on. */
const SHELF_SURFACES: Readonly<Partial<Record<PropKind, readonly number[]>>> = {
  shelf: [1, 2, 3], outdoorsPlankShelving: [0, 1, 2], medCabinet: [1, 2, 3], shopCounter: [0],
};

/** A container's local frame: u along its opening wall (world +x), v depth inward from the opening wall; world <-> local. */
interface Frame { c: ContainerCarve; U: number; V: number; x: (u: number) => number; z: (v: number) => number; back: Side; face: Side; out: number; base: number }
function frameOf(c: ContainerCarve, bases: readonly number[]): Frame {
  const r = c.rect, x0 = r.x * CELL, U = r.w * CELL, V = r.h * CELL;
  const zo = c.face === 'S' ? (r.y + r.h) * CELL : r.y * CELL, sgn = c.face === 'S' ? -1 : 1;
  return {c, U, V, x: u => x0 + u, z: v => zo + sgn * v, back: OPP[c.face], face: c.face, out: WALL_ROT[OPP[c.face]], base: bases[c.level]};
}

/** Furnishes the whole settlement (props, lights, signs); null when a required piece (a stall's counter) does not fit. */
export function dressSettlement(layout: StationLayout, sc: SettleCarve, rng: Rng, names: Record<MarketStallId, string>): SettleAnchors | null {
  const ctxs = [0, 1, 2].map(L => makePlaceCtx(layout, rng, L));
  const area = (id: number) => layout.areas[id];
  const ctxOf = (a: Area) => ctxs[a.level ?? 0];
  const anchors: SettleAnchors = {stalls: [], uses: []};
  const S = SETTLE;
  const fail = (why: string): null => { SETTLE_DRESS_FAILS[why] = (SETTLE_DRESS_FAILS[why] ?? 0) + 1; return null; };

  // --- primitives ---------------------------------------------------------------------------------------------------------------
  /** One placement (door zones allowed: the settlement places round its own openings); holders get the market's empty key. */
  const put = (a: Area, kind: PropKind, x: number, z: number, rot: number, o: PlaceOpts = {}): PropPlacement | null => {
    const p = tryPlaceProp(ctxOf(a), a, kind, r3(x), r3(z), rot, {checkZone: false, ...o});
    if (p && isLootHolderKind(kind)) p.purpose = MARKET_EMPTY_KEY;
    if (p) p.variant = o.variant ?? rng.int(0, 11);
    return p;
  };
  /** A loose thing standing on a host's top (host-local lx, lz; never blocks cells: it moves / is taken off the host). */
  const onHost = (host: PropPlacement, kind: PropKind, lx: number, lz: number, top?: number): PropPlacement | null => {
    const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
    if (Math.abs(lx) + def.w / 2 > hd.w / 2 || Math.abs(lz) + def.d / 2 > hd.d / 2) return null;
    const c = Math.cos(host.rot), s = Math.sin(host.rot);
    const {hx, hz} = footprint(kind, host.rot);
    const p: PropPlacement = {kind, x: r3(host.x + lx * c + lz * s), z: r3(host.z - lx * s + lz * c), y: host.y + (top ?? host.h), rot: host.rot, area: host.area, hx, hz, h: def.h, blocksSight: false, variant: rng.int(0, 11), host: layout.props.indexOf(host)};
    if (host.level) p.level = host.level;
    (host.cut ??= []).push({y: top ?? host.h, x0: r3(lx - def.w / 2 - 0.02), x1: r3(lx + def.w / 2 + 0.02)});
    layout.props.push(p);
    return p;
  };
  const use = (kind: UseKind, x: number, z: number, a: Area, lx: number, lz: number) => {
    anchors.uses.push({kind, x: r3(x), z: r3(z), level: a.level ?? 0, yaw: r3(Math.atan2(-(lx - x), -(lz - z))), area: a.id});
  };
  const light = (a: Area, x: number, z: number, y: number, o: Partial<LightPlacement> = {}) => {
    const l: LightPlacement = {x: r3(x), y: r3(y), z: r3(z), rot: 0, area: a.id, broken: false, flicker: false, warm: true, power: 0.85, dying: false, ...o};
    if (a.level) l.level = a.level;
    layout.lights.push(l);
  };
  const sign = (s: Omit<SignPlacement, 'x' | 'z' | 'y'> & {x: number; z: number; y: number}) => { layout.signs.push({...s, x: r3(s.x), y: r3(s.y), z: r3(s.z)}); };
  /** Props against a container's back wall, left to right (or right to left), `gap` m apart, until they no longer fit. */
  const backRow = (F: Frame, a: Area, kinds: PropKind[], u0: number, u1: number, gap = 0.12, fromRight = false): PropPlacement[] => {
    const out: PropPlacement[] = [];
    let u = fromRight ? u1 : u0;
    for (const kind of kinds) {
      const w = PROP_DEFS[kind].w, d = PROP_DEFS[kind].d;
      let p: PropPlacement | null = null;
      for (let t = 0; t < 4 && !p; t++) {
        const cu = fromRight ? u - w / 2 : u + w / 2;
        if (cu - w / 2 < u0 - 1e-6 || cu + w / 2 > u1 + 1e-6) break;
        p = put(a, kind, F.x(cu), F.z(F.V - d / 2 - 0.03), F.out);
        if (!p) u += fromRight ? -0.25 : 0.25;
      }
      if (p) out.push(p);
      u += (fromRight ? -1 : 1) * (w + gap);
    }
    return out;
  };
  /** A fixture with its back to a side wall of the container (side 'L' = u 0, 'R' = u U), centred at depth v. */
  const sideProp = (F: Frame, a: Area, kind: PropKind, side: 'L' | 'R', v: number, o: PlaceOpts = {}): PropPlacement | null => {
    const d = PROP_DEFS[kind].d;
    return put(a, kind, F.x(side === 'L' ? d / 2 + 0.03 : F.U - d / 2 - 0.03), F.z(v), side === 'L' ? WALL_ROT.W : WALL_ROT.E, o);
  };
  const displaysOf = (p: PropPlacement | null, out: DisplaySource[]) => {
    if (!p) return;
    const idx = layout.props.indexOf(p);
    const sh = SHELF_SURFACES[p.kind];
    if (sh) for (const s of sh) out.push({prop: idx, surface: s});
    else if (p.kind === 'gunRack') out.push({prop: idx, surface: SURF_GUN_RACK});
    else out.push({prop: idx, surface: SURF_TOP});
  };
  const W = (r: Rect) => ({x0: r.x * CELL, z0: r.y * CELL, x1: (r.x + r.w) * CELL, z1: (r.y + r.h) * CELL});
  /** The lane-side sign / awning band over an opening (world, the wall face toward the lane) at height y above the storey floor. */
  const boardOver = (c: ContainerCarve, text: string, style: SignPlacement['style'], onto: Area, y: number) => {
    const d = W(c.door), zf = c.face === 'S' ? d.z1 + 0.02 : d.z0 - 0.02;
    sign({kind: 'info', text, area: onto.id, x: (d.x0 + d.x1) / 2, z: zf, y: y + (c.level ? S.bases[c.level] : 0), rot: c.face === 'S' ? 0 : Math.PI, w: Math.min(3.4, d.x1 - d.x0 + 0.4), ...(style ? {style} : {}), ...(c.level ? {level: c.level} : {})});
  };
  const ontoOf = (c: ContainerCarve): Area => area(layout.doors.find(d => d.b === c.area)?.a ?? c.area);

  // --- 1. The six stalls ------------------------------------------------------------------------------------------------------------
  let why = ''; // (QA: why the last shop did not fit)
  for (const c of sc.containers) {
    if (c.use !== 'shop' || !c.stall) continue;
    const a = area(c.area), F = frameOf(c, sc.bases);
    a.label = names[c.stall];
    a.noFloorLoot = true;
    const d = c.row === 'front' ? walkIn(F, a, c.stall) : counterFront(F, a, c.stall);
    if (!d) return fail(`${c.stall} ${c.row} shop ${why}`);
    anchors.stalls.push(d);
    light(a, F.x(F.U / 2), F.z(F.V * 0.55), S.cont - 0.02, {power: 0.9});
    if (F.U > 5.2) light(a, F.x(F.U * 0.2), F.z(F.V * 0.3), S.cont - 0.02, {power: 0.6});
    boardOver(c, names[c.stall].split(' — ')[0], STALL_SIGNS[c.stall].style, ontoOf(c), 2.42);
  }

  /** Counter run along u at depth v (front toward the opening), flush with one side, the trader's >= 1.5 m way in at the other end. */
  function counterRun(F: Frame, a: Area, v: number, modules: number, gapLeft: boolean): {props: PropPlacement[]; x0: number; x1: number; u0: number; u1: number} | null {
    const cw = PROP_DEFS.shopCounter.w, runW = modules * cw;
    if (F.U - runW < 1.5 - 1e-6) return null;
    const u0 = gapLeft ? F.U - runW : 0;
    const props: PropPlacement[] = [];
    for (let k = 0; k < modules; k++) {
      const p = put(a, 'shopCounter', F.x(u0 + cw / 2 + k * cw), F.z(v), F.out, {doorOk: true});
      if (!p) { why = `module ${k}`; return null; }
      props.push(p);
    }
    return {props, x0: F.x(u0), x1: F.x(u0 + runW), u0, u1: u0 + runW};
  }
  function stallRecord(F: Frame, a: Area, id: MarketStallId, run: NonNullable<ReturnType<typeof counterRun>>, vCounter: number, vTrader: number, vFront: number, displays: DisplaySource[]): StallDressed2 {
    const cd = PROP_DEFS.shopCounter.d, uc = (run.u0 + run.u1) / 2;
    const za = F.z(vCounter - cd / 2), zb = F.z(vCounter + cd / 2);
    // the trader faces the opening (the customer): forward (-sin yaw, -cos yaw) points out of the container
    const yaw = F.face === 'S' ? Math.PI : 0;
    return {
      id, area: a.id, level: F.c.level, counter: {x0: r3(run.x0), z0: r3(Math.min(za, zb)), x1: r3(run.x1), z1: r3(Math.max(za, zb))},
      trader: {x: r3(F.x(uc)), z: r3(F.z(vTrader)), yaw: r3(yaw)}, front: {x: r3(F.x(uc)), z: r3(F.z(vFront))}, displays,
    };
  }
  /** The trade's fixtures and props: back-wall run, side fixtures, floor props (none of them carries anything but wares). */
  function tradeKit(id: MarketStallId): {back: PropKind[]; side: PropKind; extra: PropKind[]} {
    switch (id) {
      // (back-wall kinds are all <= 0.5 m deep: one cell row, the trader's two rows in front of it stay clear)
      case 'gun': return {back: ['gunRack', 'outdoorsPlankShelving'], side: 'outdoorsPlankShelving', extra: ['crate', 'handToolbox']};
      case 'medical': return {back: ['medCabinet', 'shelf', 'medCabinet'], side: 'shelf', extra: ['ivPole', 'oxygenCart']};
      case 'fuel': return {back: ['outdoorsPlankShelving', 'shelf', 'outdoorsPlankShelving'], side: 'outdoorsPlankShelving', extra: ['gasCylinderCart', 'portableGenerator']};
      case 'general': return {back: ['outdoorsPlankShelving', 'outdoorsPlankShelving', 'outdoorsPlankShelving'], side: 'outdoorsPlankShelving', extra: ['basketStack', 'newspaperBundles']};
      case 'gear': return {back: ['outdoorsPlankShelving', 'coatRack', 'outdoorsPlankShelving'], side: 'outdoorsPlankShelving', extra: ['rollingSuitcase', 'coatRack']};
      case 'scrap': return {back: ['outdoorsPlankShelving', 'shelf', 'outdoorsPlankShelving'], side: 'shelf', extra: ['airCompressor', 'crate']};
    }
  }
  /** A walk-in shop (Market Lane, 4 m deep): customers 0-1.5 m (side shelving), counter 1.5-2.5 m, trader 2.5-3.5 m, back wall 3.5-4 m. */
  function walkIn(F: Frame, a: Area, id: MarketStallId): StallDressed2 | null {
    const kit = tradeKit(id), displays: DisplaySource[] = [];
    const vCounter = 2.0, vTrader = 3.0, vFront = 1.1;
    const gapLeft = rng.chance(0.5);
    const run = counterRun(F, a, vCounter, 2, gapLeft);
    if (!run) { why = `counter (${F.U} m) ${why}`; return null; }
    for (const p of run.props) displaysOf(p, displays);
    for (const p of backRow(F, a, kit.back, 0.05, F.U - 0.05, 0.1, rng.chance(0.5))) if (p.kind !== 'coatRack') displaysOf(p, displays);
    // side shelving in the customer zone (both side walls), then the trade's floor props in the trader zone's free end
    for (const side of ['L', 'R'] as const) displaysOf(sideProp(F, a, kit.side, side, 0.78), displays);
    const free = gapLeft ? [0.1, run.u0 - 0.1] : [run.u1 + 0.1, F.U - 0.1];
    for (const k of kit.extra.slice(0, 1)) {
      const w = PROP_DEFS[k].w;
      if (free[1] - free[0] >= w + 1.0) put(a, k, F.x(gapLeft ? free[0] + w / 2 + 0.05 : free[1] - w / 2 - 0.05), F.z(vTrader + 0.1), F.out);
    }
    if (id === 'medical') mountProp(ctxOf(a), a, F.face, F.x(gapLeft ? F.U - 0.6 : 0.6), 'firstAidWallKit', 1.35, F.base);
    if (displays.length < 4) { why = `${displays.length} displays (${F.U} m)`; return null; }
    return stallRecord(F, a, id, run, vCounter, vTrader, vFront, displays);
  }
  /** A counter-fronted shop (Back Lane): entry 0-1 m, counter 1.1-1.9 m, trader 2-3 m, side shelving 2-3.4 m, back wall 3.5-4 m. */
  function counterFront(F: Frame, a: Area, id: MarketStallId): StallDressed2 | null {
    const kit = tradeKit(id), displays: DisplaySource[] = [];
    const vCounter = 1.5, vTrader = 2.5, vFront = 0.6;
    const modules = F.U >= 6.0 ? 3 : 2;
    const gapLeft = rng.chance(0.5);
    const run = counterRun(F, a, vCounter, modules, gapLeft) ?? counterRun(F, a, vCounter, 2, gapLeft);
    if (!run) { why = `counter (${F.U} m) ${why}`; return null; }
    for (const p of run.props) displaysOf(p, displays);
    for (const p of backRow(F, a, kit.back, 0.05, F.U - 0.05, 0.1, rng.chance(0.5))) if (p.kind !== 'coatRack') displaysOf(p, displays);
    // side fixture on the far side from the trader's way in (in the trader zone), the trade's floor prop by the other wall
    displaysOf(sideProp(F, a, kit.side, gapLeft ? 'R' : 'L', 2.75), displays);
    const k = kit.extra[0], w = PROP_DEFS[k].d;
    put(a, k, F.x(gapLeft ? w / 2 + 0.05 : F.U - w / 2 - 0.05), F.z(3.0), gapLeft ? WALL_ROT.W : WALL_ROT.E);
    if (displays.length < 4) { why = `${displays.length} displays (${F.U} m)`; return null; }
    return stallRecord(F, a, id, run, vCounter, vTrader, vFront, displays);
  }

  // --- 2. The other containers ----------------------------------------------------------------------------------------------------
  for (const c of sc.containers) {
    if (c.use === 'shop') continue;
    const a = area(c.area), F = frameOf(c, sc.bases);
    if (c.use !== 'workshop') a.noFloorLoot = true;
    const yLamp = S.cont - 0.02;
    switch (c.use) {
      case 'kitchen': dressKitchen(F, a); break;
      case 'bunks': dressBunks(F, a); break;
      case 'workshop': dressWorkshop(F, a); break;
      case 'water': {
        a.label = 'Water point';
        backRow(F, a, ['waterPumpSkid', 'waterHeaterTank', 'waterCooler'], 0.1, F.U - 0.1, 0.15, rng.chance(0.5));
        put(a, 'mopBucketWringer', F.x(F.U * 0.5), F.z(F.V * 0.45), F.out);
        break;
      }
      case 'latrine': {
        a.label = 'Latrine';
        backRow(F, a, ['toiletStall', 'toiletStall', 'mopSink'], 0.1, F.U - 0.1, 0.05, rng.chance(0.5));
        break;
      }
      case 'generator': {
        a.label = 'Generator shed';
        backRow(F, a, ['portableGenerator', 'gasCylinderCart', 'portableGenerator'], 0.15, F.U - 0.15, 0.3, rng.chance(0.5));
        put(a, 'drumFan', F.x(F.U * 0.7), F.z(F.V * 0.4), F.out + Math.PI);
        break;
      }
      case 'storage': {
        a.label = 'Storage';
        const kinds: PropKind[] = rng.shuffle(['crate', 'cartonStack', 'crate', 'shelf', 'footlocker', 'crate']);
        backRow(F, a, kinds.slice(0, 4), 0.05, F.U - 0.05, 0.1, rng.chance(0.5));
        sideProp(F, a, 'crate', rng.chance(0.5) ? 'L' : 'R', F.V * 0.35);
        break;
      }
      case 'tea': dressTea(F, a); break;
      case 'repair': {
        a.label = 'Repair counter';
        const bench = backRow(F, a, ['repairBench'], F.U * 0.5 - 0.8, F.U * 0.5 + 0.8)[0];
        if (bench) { use('work', bench.x, F.z(F.V - 1.0), a, bench.x, bench.z); onHost(bench, 'solderingStation', -0.4, 0.05, 0.9); }
        put(a, 'plasticStackChair', F.x(F.U * 0.5 + 0.9), F.z(F.V - 1.0), F.out + Math.PI);
        break;
      }
      case 'home': dressHome(F, a, c); break;
    }
    if (c.use !== 'kitchen' && c.use !== 'workshop') light(a, F.x(F.U / 2), F.z(F.V / 2), (c.level ? S.bases[c.level] : 0) + yLamp, {power: c.use === 'home' ? 0.55 : 0.7});
  }

  function dressKitchen(F: Frame, a: Area): void {
    a.label = 'Communal kitchen';
    // the serving counter at the opening (the trader's rule: a way in at one end), the cooking lines along the back wall
    const run = counterRun(F, a, 1.5, 3, rng.chance(0.5)) ?? counterRun(F, a, 1.5, 2, true);
    if (run) onHost(run.props[Math.floor(run.props.length / 2)], 'campLantern', 0, -0.15);
    const line = backRow(F, a, ['wokLine', 'grillLine', 'shopBackbar', 'ingredientBin', 'ingredientBin', 'waterCooler'], 0.1, F.U - 0.1, 0.1, rng.chance(0.5));
    for (const p of line) {
      if (p.kind === 'wokLine' || p.kind === 'grillLine') use('cook', p.x, F.z(2.5), a, p.x, p.z);
      if (p.kind === 'shopBackbar') { onHost(p, 'riceCooker', -0.55, 0.05, 0.914); onHost(p, 'deepFryer', 0.45, 0.05, 0.914); }
    }
    for (const u of [0.25, 0.6, 0.85]) light(a, F.x(F.U * u), F.z(2.4), S.cont - 0.02, {power: 0.95});
  }
  function dressBunks(F: Frame, a: Area): void {
    a.label = 'Bunk room';
    const beds = backRow(F, a, ['palletBed', 'palletBed', 'palletBed'], 0.1, F.U - 0.1, 0.55, rng.chance(0.5));
    let n = 0;
    for (const b of beds) if (n++ < 2) use('sleep', b.x, F.z(F.V - 1.35), a, b.x, b.z);
    sideProp(F, a, 'palletBed', rng.chance(0.5) ? 'L' : 'R', 1.4);
    put(a, 'coatRack', F.x(F.U - 0.35), F.z(0.9), F.out);
    put(a, 'footlocker', F.x(0.5), F.z(2.6), F.out);
  }
  function dressWorkshop(F: Frame, a: Area): void {
    a.label = 'Workshop';
    const row = backRow(F, a, ['repairBench', 'benchGrinderStand', 'repairBench', 'rollingToolChest'], 0.1, F.U - 0.1, 0.2, rng.chance(0.5));
    for (const p of row) if (p.kind === 'repairBench') use('work', p.x, F.z(F.V - 1.4), a, p.x, p.z);
    mountProp(ctxOf(a), a, 'W', F.c.rect.y * CELL + F.V * 0.45, 'toolPegboard', 1.05, F.base);
    mountProp(ctxOf(a), a, 'E', F.c.rect.y * CELL + F.V * 0.45, 'partsBinRack', 1.15, F.base);
    // the floor props in the corners by the opening (the middle stays clear: the station's common fuel plan stores its cans here)
    put(a, 'airCompressor', F.x(0.45), F.z(0.3), F.out + Math.PI);
    put(a, 'portableGenerator', F.x(F.U - 0.4), F.z(0.42), F.out + Math.PI);
    put(a, 'tripodWorkLight', F.x(F.U - 0.6), F.z(F.V - 1.5), WALL_ROT.E);
    for (const u of [0.3, 0.75]) light(a, F.x(F.U * u), F.z(2.5), S.cont - 0.02, {power: 0.9});
  }
  function dressTea(F: Frame, a: Area): void {
    a.label = 'Tea counter';
    const run = counterRun(F, a, 1.0, F.U >= 4.6 ? 2 : 1, rng.chance(0.5));
    const t = put(a, 'campTable', F.x(F.U * 0.5), F.z(F.V - 0.35), F.out);
    if (t) { onHost(t, 'campStove', -0.3, 0); onHost(t, 'riceCooker', 0.32, 0); }
    if (run) use('work', (run.x0 + run.x1) / 2, F.z(1.75), a, (run.x0 + run.x1) / 2, F.z(1.0));
  }
  function dressHome(F: Frame, a: Area, c: ContainerCarve): void {
    a.label = c.level ? 'Home' : 'Ground-floor home';
    const bedKind: PropKind = rng.chance(0.65) ? 'palletBed' : 'bedroll';
    const fromRight = rng.chance(0.5);
    const bed = backRow(F, a, [bedKind], 0.1, F.U - 0.1, 0, fromRight)[0];
    if (bed) use('sleep', bed.x, F.z(F.V - 1.25), a, bed.x, bed.z);
    // a table and a chair by the far side wall, a coat rack / footlocker / bike / TV in the corners
    const side = fromRight ? 'L' : 'R';
    const t = sideProp(F, a, 'campTable', side, F.V * 0.42);
    if (t) {
      onHost(t, 'campLantern', 0.3, 0);
      const ox = side === 'L' ? 0.75 : -0.75;
      const ch = put(a, rng.chance(0.5) ? 'plasticStackChair' : 'foldingChair', t.x + ox, t.z, side === 'L' ? WALL_ROT.E : WALL_ROT.W);
      if (ch) use('sit', ch.x, ch.z, a, t.x, t.z);
    }
    const extras: PropKind[] = rng.shuffle(['coatRack', 'footlocker', 'crtTvCart', 'crate', 'bicycle', 'drumFan']);
    for (const k of extras.slice(0, 2)) put(a, k, F.x(side === 'L' ? F.U - 0.45 : 0.45), F.z(0.75 + rng.range(0, 0.3)), F.out);
  }

  // --- 3. Lanes, alleys, the yard ---------------------------------------------------------------------------------------------------
  const L = sc.lanes;
  for (const a of [L.market, L.back, L.west, L.cross, L.yard, L.east]) a.noFloorLoot = true;
  const g0 = layout.grid;
  /** Clutter against a lane wall at (x, z) facing (fx, fz) away from the wall. */
  const laneThings: PropKind[] = ['crate', 'wheelieBin', 'trashBagPile', 'bicycle', 'plasticStackChair', 'crate', 'deadPlant', 'handTruck', 'bench', 'drumFan', 'crate', 'plasticStackChair'];
  /** Walks a lane's long wall (the row just inside it) and drops clutter between the openings (never in front of a door / stair). */
  const dressLaneWall = (a: Area, row: number, dirZ: 1 | -1, x0: number, x1: number, every: number) => {
    let x = x0 + 1.0 + rng.range(0, every);
    while (x < x1 - 1.0) {
      const kind = laneThings[rng.int(0, laneThings.length - 1)];
      const along = kind === 'bicycle' || kind === 'bench' || kind === 'handTruck' ? 'along' : 'face';
      const rot = along === 'along' ? (kind === 'bicycle' ? Math.PI / 2 : dirZ > 0 ? 0 : Math.PI) : dirZ > 0 ? 0 : Math.PI;
      const {hz} = footprint(kind, rot);
      const z = row * CELL + (dirZ > 0 ? hz + 0.04 : CELL - hz - 0.04);
      put(a, kind, x, z, rot);
      x += every * rng.range(0.6, 1.4);
    }
  };
  const ML = W(L.market), BL = W(L.back);
  dressLaneWall(L.market, L.market.y, 1, ML.x0, ML.x1, 3.2);
  dressLaneWall(L.market, L.market.y + L.market.h - 1, -1, ML.x0, ML.x1, 3.6);
  dressLaneWall(L.back, L.back.y, 1, BL.x0, BL.x1, 3.6);
  dressLaneWall(L.back, L.back.y + L.back.h - 1, -1, BL.x0, BL.x1, 3.2);
  // the tea counter's chairs out in the lane, idle / chat posts down the lanes
  for (const c of sc.containers) if (c.use === 'tea') {
    const d = W(c.door), zl = c.face === 'S' ? d.z1 + 0.9 : d.z0 - 0.9, onto = ontoOf(c);
    for (const dx of [-0.6, 0.6]) {
      const ch = put(onto, 'plasticStackChair', (d.x0 + d.x1) / 2 + dx, zl, c.face === 'S' ? Math.PI : 0);
      if (ch) use('sit', ch.x, ch.z, onto, (d.x0 + d.x1) / 2, c.face === 'S' ? d.z1 : d.z0);
    }
  }
  for (const [a, R] of [[L.market, ML], [L.back, BL]] as const) {
    for (const t of [0.18, 0.42, 0.66, 0.88]) {
      const x = R.x0 + (R.x1 - R.x0) * t + rng.range(-1, 1), z = (R.z0 + R.z1) / 2 + rng.range(-0.3, 0.3);
      if (rng.chance(0.5)) { use('chat', x - 0.55, z, a, x + 0.55, z); use('chat', x + 0.55, z, a, x - 0.55, z); } else use('idle', x, z, a, x, R.z0);
    }
  }
  // the yard: communal tables under the roof, a notice board, a cooking camp table, lamps
  {
    const a = L.yard, R = W(a);
    const n = 3;
    for (let k = 0; k < n; k++) {
      const x = R.x0 + 2.4 + (R.x1 - R.x0 - 4.8) * (k + 0.5) / n + rng.range(-0.4, 0.4), z = R.z0 + (R.z1 - R.z0) * (k % 2 ? 0.62 : 0.4);
      const t = put(a, 'table', x, z, rng.chance(0.5) ? 0 : Math.PI / 2, {ring: 0.6});
      if (t) {
        use('sit', t.x + t.hx + 0.5, t.z, a, t.x, t.z);
        use('sit', t.x - t.hx - 0.5, t.z, a, t.x, t.z);
        if (k === 1) onHost(t, 'campLantern', 0, 0);
      }
    }
    const ct = put(a, 'campTable', R.x0 + (R.x1 - R.x0) * 0.78, R.z0 + 1.2, 0, {ring: 0.4});
    if (ct) { onHost(ct, 'campStove', -0.3, 0); onHost(ct, 'riceCooker', 0.3, 0); use('cook', ct.x, ct.z + 0.75, a, ct.x, ct.z); }
    use('idle', R.x0 + (R.x1 - R.x0) * 0.3, R.z1 - 1.2, a, R.x0 + (R.x1 - R.x0) * 0.6, R.z0);
    for (const x of [R.x0 + 2.5, (R.x0 + R.x1) / 2, R.x1 - 2.5]) for (const z of [R.z0 + 1.8, R.z1 - 1.8]) light(a, x, z, S.roofY - 1.6, {power: 0.95});
  }
  // lane lamps: pendants hung from the shed roof down the middle of the lanes every ~6.5 m (2 m rods); the alleys' own
  const underBridge = (x: number, z: number) => g0.ceilAt(x, z) < S.cont + 0.05;
  for (const [a, R] of [[L.market, ML], [L.back, BL]] as const) for (let x = R.x0 + 3; x < R.x1 - 2; x += 6.5) {
    const lx = x + rng.range(-0.5, 0.5), lz = (R.z0 + R.z1) / 2;
    if (!underBridge(lx, lz)) light(a, lx, lz, S.roofY - 1.9, {power: 0.85});
  }
  for (const a of [L.west, L.cross, L.east]) { const R = W(a); light(a, (R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2, S.roofY - 2.0, {power: 0.75}); }
  for (const g of sc.gates) { const a = area(g.area), R = W(g.rect); a.noFloorLoot = true; light(a, (R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2, S.cont - 0.02, {power: 0.85}); }
  // under each bridge a lamp; the alleys' names on the bridge fascia are the stall boards' job, not here
  for (const id of sc.bridges) { const a = area(id), R = W(a); a.noFloorLoot = true; if ((a.level ?? 0) === 1) light(area(g0.area[g0.idx(a.x + 1, a.y + 1)]) ?? a, (R.x0 + R.x1) / 2, (R.z0 + R.z1) / 2, S.cont - 0.05, {power: 0.7}); }

  // --- 4. The platform (version 1's): benches between the gates, the station name plates, MARKET boards over the gates, lamps ----------
  {
    const a = sc.platform, R = W(a);
    a.noFloorLoot = true;
    const gx = sc.gates.map(g => W(g.platformDoor));
    const busy = (x: number, half: number) => gx.some(q => x + half > q.x0 - 0.6 && x - half < q.x1 + 0.6);
    let benches = 0;
    for (let x = R.x0 + 3; x < R.x1 - 3 && benches < 3; x += 0.5) {
      if (busy(x, PROP_DEFS.bench.w / 2)) continue;
      if (put(a, 'bench', x, R.z1 - PROP_DEFS.bench.d / 2 - 0.05, Math.PI)) { benches++; x += 6; }
    }
    const pc = (R.x0 + R.x1) / 2, g = gx.slice().sort((p, q) => Math.abs((p.x0 + p.x1) / 2 - pc) - Math.abs((q.x0 + q.x1) / 2 - pc))[0];
    for (const sx of [g.x0 - 1.6, g.x1 + 1.6]) sign({kind: 'station', text: layout.name, area: a.id, x: sx, z: R.z1 - 0.02, y: 3.4, rot: Math.PI});
    for (const pd of gx) sign({kind: 'exit', text: 'MARKET', arrow: 'up', area: a.id, x: (pd.x0 + pd.x1) / 2, z: pd.z0 - 0.02, y: S.gateH + 0.3, rot: Math.PI});
    for (let x = R.x0 + 3; x < R.x1 - 2; x += 6) light(a, x, (R.z0 + R.z1) / 2, 4.5, {warm: false, power: 0.75});
    // idle posts at the platform ends (watching the track)
    use('idle', R.x0 + 1.5, R.z0 + 2.2, a, R.x0 + 1.5, R.z0);
    use('idle', R.x1 - 1.5, R.z0 + 2.2, a, R.x1 - 1.5, R.z0);
  }

  // --- 5. Storey 1: the catwalks (chairs, plants, crates against the upper containers), lamps hung from the roof ----------------------
  // each catwalk strip: its area, x span, the upper containers' wall line (z) and the direction the strip lies from it (+1: south)
  const R0 = sc.rows;
  const xs = (a: Area) => ({x0: a.x * CELL, x1: (a.x + a.w) * CELL});
  const strips: {a: Area; x0: number; x1: number; wall: number; dir: 1 | -1}[] = [
    {a: sc.frontDeck.catwalk, ...xs(sc.frontDeck.catwalk), wall: (R0.pw + S.rowD - S.cat) * CELL, dir: 1},
    {a: sc.backDeck.catwalk, ...xs(sc.backDeck.catwalk), wall: (R0.b0 + S.cat) * CELL, dir: -1},
  ];
  for (const b of sc.blocks) {
    const a = area(b.ring), u = b.upper;
    strips.push({a, x0: u.x * CELL, x1: (u.x + u.w) * CELL, wall: u.y * CELL, dir: -1}, {a, x0: u.x * CELL, x1: (u.x + u.w) * CELL, wall: (u.y + u.h) * CELL, dir: 1});
  }
  const catThings: PropKind[] = ['plasticStackChair', 'deadPlant', 'crate', 'foldingChair', 'bicycle', 'deadPlant', 'crate'];
  for (const st of strips) {
    st.a.noFloorLoot = true;
    const n = Math.max(1, Math.round((st.x1 - st.x0) / 7));
    const zMid = st.wall + st.dir * S.cat * CELL / 2;
    for (let k = 0; k < n; k++) {
      const x = st.x0 + (st.x1 - st.x0) * (k + 0.5) / n + rng.range(-1, 1);
      const kind = catThings[rng.int(0, catThings.length - 1)];
      const rot = kind === 'bicycle' ? Math.PI / 2 : st.dir > 0 ? 0 : Math.PI;
      const {hz} = footprint(kind, rot);
      const p = put(st.a, kind, x, st.wall + st.dir * (hz + 0.04), rot);
      if (p && (kind === 'plasticStackChair' || kind === 'foldingChair')) use('sit', p.x, p.z, st.a, p.x, p.z + st.dir);
      light(st.a, Math.min(st.x1 - 0.5, x + 2.5), zMid, S.roofY - 1.3, {power: 0.6});
    }
    use('idle', st.x0 + (st.x1 - st.x0) * rng.range(0.25, 0.75), st.wall + st.dir * 1.0, st.a, st.x0, st.wall + st.dir * 5);
  }

  // --- 6. Storey 2: the rooftops (tents, bedrolls, water tanks, a camp table), lamps hanging from the roof --------------------------
  const roofs: Area[] = [sc.frontDeck.roof, sc.backDeck.roof, ...sc.blocks.map(b => area(b.roof))];
  const roofThings: PropKind[] = ['tentDisplay', 'waterHeaterTank', 'bedroll', 'crate', 'campTable', 'deadPlant', 'waterHeaterTank', 'bedroll', 'drumFan'];
  for (const a of roofs) {
    a.noFloorLoot = true;
    const R = W(a);
    const n = Math.max(1, Math.round((R.x1 - R.x0) / 6.5));
    for (let k = 0; k < n; k++) {
      const x = R.x0 + (R.x1 - R.x0) * (k + 0.5) / n + rng.range(-1.2, 1.2), z = (R.z0 + R.z1) / 2 + rng.range(-0.3, 0.3);
      const kind = roofThings[rng.int(0, roofThings.length - 1)];
      const p = put(a, kind, x, z, rng.chance(0.5) ? 0 : Math.PI, {ring: 0.5});
      if (p?.kind === 'campTable') { onHost(p, 'campLantern', 0.3, 0); put(a, 'foldingChair', p.x - 0.45, p.z + 0.7, Math.PI); }
      light(a, x, z, S.roofY - 0.45, {power: 0.55});
    }
  }

  // --- 7. Blade signs over the lanes (the Tokyo street look): the stall's name on a board standing out from the catwalk edge ---------
  for (const st of anchors.stalls) {
    const c = sc.containers.find(q => q.area === st.area)!;
    const d = W(c.door), onto = ontoOf(c);
    const x = (d.x0 + d.x1) / 2 + (rng.chance(0.5) ? -1 : 1) * Math.min(1.2, (d.x1 - d.x0) / 2 + 0.6);
    const zWall = c.face === 'S' ? d.z1 : d.z0, nz = c.face === 'S' ? 1 : -1;
    for (const flip of [0, Math.PI]) sign({kind: 'info', text: names[st.id].split(' — ')[0], area: onto.id, x: x + (flip ? 0.012 : -0.012), z: zWall + nz * 0.75, y: 3.75, rot: Math.PI / 2 + flip, w: 1.25, style: STALL_SIGNS[st.id].style});
  }
  return anchors;
}
