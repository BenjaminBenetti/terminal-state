// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): the furnishing of THE SURVIVOR MARKET — its own pass (never the abandoned
// station dresser: no vending machines, bins or fare gates in a lived-in settlement). Existing kinds only (the prop library: stall
// counters, racks and shelving, the p7 workshop / kitchen kit, pallet beds, partitions, tents, chairs and tables); every placement
// through the shared placement kit (gen/placeKit.ts: blocked cells, access strips, connectivity), deterministic on the `dress` fork.
//
// THE MARKET RULE (calm settlement, no theft simulation): nothing placed here holds loot. Every loot-holder kind gets the exact empty
// purpose key (MARKET_EMPTY_KEY = items/lootTables.ts ANNEX_PICKED_KEY: `{empty: 1, exact: true}`) — openable storage still opens and
// is empty; the traders' goods are the trade stock (market/trade), never pickups. (The station's common fuel plan is the one exception
// the common rules place: world/fuelStations.ts lays it into the workshop's storage like at every station.)

import type {Rng} from '../../core/rng';
import {CELL, FLOOR} from '../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../props';
import {ANNEX_PICKED_KEY} from '../../items/lootTables';
import {isLootHolderKind} from '../../items/loot';
import {forceProp, makePlaceCtx, mountProp, tryPlaceProp, type PlaceCtx, type PlaceOpts} from '../placeKit';
import type {Area, LightPlacement, Rect, Side, SignPlacement, StationLayout} from '../stationTypes';
import {MARKET} from './frame';
import type {MarketCarve, StallCarve, UnderCarve} from './carve';
import {STALL_SIGNS} from './names';
import type {MarketStallId} from './marketTypes';

/** Required pieces that did not fit (QA / tests). */
export const MARKET_DRESS_FAILS: Record<string, number> = {};

/** The exact empty loot key every market holder carries (the market rule above). */
export const MARKET_EMPTY_KEY = ANNEX_PICKED_KEY;

/** A stall's furnished record (the counter run, the trader's / customer's points) for layout.market. */
export interface StallDressed { id: MarketStallId; counter: {x0: number; z0: number; x1: number; z1: number}; trader: {x: number; z: number}; front: {x: number; z: number} }
/** Anchors the spots pass reads (world metres, storey). */
export interface DressAnchors {
  stalls: StallDressed[];
  /** Work / cook / sleep / sit stand points beside the furniture they belong to. */
  uses: {kind: 'work' | 'cook' | 'sleep' | 'sit'; x: number; z: number; level: number; yaw: number; area: number}[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Furnishes the whole settlement (props, lights, signs); null when a required piece (a stall counter) does not fit. */
export function dressMarket(layout: StationLayout, mc: MarketCarve, rng: Rng, names: Record<MarketStallId, string>): DressAnchors | null {
  const ctx0 = makePlaceCtx(layout, rng, 0), ctx1 = makePlaceCtx(layout, rng, 1);
  const ctxOf = (a: Area) => ((a.level ?? 0) === 1 ? ctx1 : ctx0);
  const area = (id: number) => layout.areas[id];
  const anchors: DressAnchors = {stalls: [], uses: []};
  /** One placement (door zones allowed: the settlement places round its own openings); holders get the market's empty key. */
  const put = (a: Area, kind: PropKind, x: number, z: number, rot: number, o: PlaceOpts = {}): PropPlacement | null => {
    const p = tryPlaceProp(ctxOf(a), a, kind, r3(x), r3(z), rot, {checkZone: false, ...o});
    if (p && isLootHolderKind(kind)) p.purpose = MARKET_EMPTY_KEY;
    return p;
  };
  /** A loose thing standing on a host's top (host-local lx, lz; never blocks cells: it moves / is taken off the host). */
  const onHost = (host: PropPlacement, kind: PropKind, lx: number, lz: number): PropPlacement | null => {
    const def = PROP_DEFS[kind], hd = PROP_DEFS[host.kind];
    if (Math.abs(lx) + def.w / 2 > hd.w / 2 || Math.abs(lz) + def.d / 2 > hd.d / 2) return null;
    const c = Math.cos(host.rot), s = Math.sin(host.rot);
    const {hx, hz} = footprint(kind, host.rot);
    const p: PropPlacement = {kind, x: r3(host.x + lx * c + lz * s), z: r3(host.z - lx * s + lz * c), y: host.y + host.h, rot: host.rot, area: host.area, hx, hz, h: def.h, blocksSight: false, variant: rng.int(0, 11), host: layout.props.indexOf(host)};
    if (host.level) p.level = host.level;
    (host.cut ??= []).push({y: host.h, x0: r3(lx - def.w / 2 - 0.02), x1: r3(lx + def.w / 2 + 0.02)});
    layout.props.push(p);
    return p;
  };
  /** A resident's use point at (x, z) facing (lx, lz) (yaw: three.js rotation.y, forward = (-sin yaw, -cos yaw)). */
  const use = (kind: DressAnchors['uses'][number]['kind'], x: number, z: number, a: Area, lx: number, lz: number) => {
    anchors.uses.push({kind, x: r3(x), z: r3(z), level: a.level ?? 0, yaw: r3(Math.atan2(-(lx - x), -(lz - z))), area: a.id});
  };
  const light = (a: Area, x: number, z: number, y: number, o: Partial<LightPlacement> = {}) => {
    const l: LightPlacement = {x: r3(x), y: r3(y), z: r3(z), rot: 0, area: a.id, broken: false, flicker: false, warm: true, power: 0.9, dying: false, ...o};
    if (a.level) l.level = a.level;
    layout.lights.push(l);
  };
  const sign = (s: Omit<SignPlacement, 'x' | 'z' | 'y'> & {x: number; z: number; y: number}) => { layout.signs.push({...s, x: r3(s.x), y: r3(s.y), z: r3(s.z)}); };
  const W = (r: Rect) => ({x0: r.x * CELL, z0: r.y * CELL, x1: (r.x + r.w) * CELL, z1: (r.y + r.h) * CELL});
  const keepRect = (ctx: PlaceCtx, x0: number, z0: number, x1: number, z1: number) => {
    const g = ctx.g;
    for (let y = Math.floor(z0 / CELL); y < Math.ceil(z1 / CELL); y++) for (let x = Math.floor(x0 / CELL); x < Math.ceil(x1 / CELL); x++) if (g.inBounds(x, y)) ctx.keep[g.idx(x, y)] = 1;
  };
  /** World x toward the canonical WEST (the stair / workshop end) — +1 or -1 in world x. */
  const west = -mc.westSign;

  // --- 1. The six stalls: counter run at the front, the trader behind it, the back fixtures, a lantern, the painted board ----------
  for (const s of mc.stalls) {
    const a = area(s.area), r = W(s.rect);
    const d = dressStall(s, a, r);
    if (!d) return null;
    anchors.stalls.push(d);
  }
  function dressStall(s: StallCarve, a: Area, r: ReturnType<typeof W>): StallDressed | null {
    a.label = names[s.id];
    a.noFloorLoot = true;
    const cw = PROP_DEFS.shopCounter.w, cd = PROP_DEFS.shopCounter.d;
    const gapWest = rng.chance(0.5);
    // the counter run stands 0.55 m inside the opening (its doorway approach strip stays clear: gen/doorways.ts DOOR_CLEAR)
    const runW = 2 * cw, cz = r.z1 - cd / 2 - 0.55;
    // the trader's way in: a >= 1.2 m gap at one end of the counter run (inside the alcove); the run flush with the other side wall, on
    // whole cells (two 1.5 m modules = 3 + 3 cells: an offset run would claim a shared cell twice)
    const x0 = gapWest ? r.x1 - runW : r.x0;
    const counters: PropPlacement[] = [];
    for (let k = 0; k < 2; k++) {
      const p = put(a, 'shopCounter', x0 + cw / 2 + k * cw, cz, 0, {doorOk: true});
      if (!p) { MARKET_DRESS_FAILS[`${s.id} counter`] = (MARKET_DRESS_FAILS[`${s.id} counter`] ?? 0) + 1; return null; }
      counters.push(p);
    }
    const counter = {x0: r3(x0), z0: r3(cz - cd / 2), x1: r3(x0 + runW), z1: r3(cz + cd / 2)};
    const tx = (counter.x0 + counter.x1) / 2, tz = counter.z0 - 0.6;
    // back fixtures against the back wall (front +Z toward the counter), left to right, centred
    const backs: PropKind[] = {
      gun: ['gunRack'], medical: ['medCabinet', 'shelf'], fuel: ['gasCylinderCart', 'shelf', 'portableGenerator'],
      general: ['outdoorsPlankShelving', 'outdoorsPlankShelving'], gear: ['outdoorsPlankShelving', 'coatRack'], scrap: ['cartonStack', 'airCompressor'],
    }[s.id] as PropKind[];
    const widths = backs.map(k => PROP_DEFS[k].w), total = widths.reduce((n, w) => n + w, 0) + 0.15 * (backs.length - 1);
    let bx = (r.x0 + r.x1) / 2 - total / 2;
    backs.forEach((k, i) => {
      put(a, k, bx + widths[i] / 2, r.z0 + PROP_DEFS[k].d / 2 + 0.03, 0);
      bx += widths[i] + 0.15;
    });
    if (s.id === 'scrap') mountProp(ctx0, a, 'N', (r.x0 + r.x1) / 2, 'partsBinRack', 1.15, 0);
    // a lantern on the counter (dynamic: knocked off, it rolls), the stall's warm light; the trade's tools on the scrap / gun counters
    onHost(counters[gapWest ? 1 : 0], 'campLantern', 0.45 * (gapWest ? 1 : -1), 0);
    if (s.id === 'scrap' || s.id === 'gun') onHost(counters[gapWest ? 0 : 1], 'handToolbox', 0, -0.05);
    light(a, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, MARKET.stallCeil - 0.02, {power: 0.85});
    // the painted board over the opening, on the square side
    const o = W(s.opening);
    sign({kind: 'info', text: names[s.id].toUpperCase(), area: mc.square.id, x: (o.x0 + o.x1) / 2, z: o.z1 + 0.02, y: MARKET.stallHead + 0.45, rot: 0, w: Math.min(3.6, (o.x1 - o.x0) + 0.6), style: STALL_SIGNS[s.id].style});
    return {id: s.id, counter, trader: {x: r3(tx), z: r3(tz)}, front: {x: r3(tx), z: r3(counter.z1 + 0.4)}};
  }

  // --- 2. Market gates: a lamp each, a MARKET board on the platform side --------------------------------------------------------------
  for (const gt of mc.gates) {
    const a = area(gt.area), r = W(gt.rect), pd = W(gt.platformDoor);
    a.noFloorLoot = true;
    light(a, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, MARKET.gateCeil - 0.02, {power: 0.8});
    sign({kind: 'exit', text: 'MARKET', arrow: 'up', area: mc.platform.id, x: (pd.x0 + pd.x1) / 2, z: pd.z0 - 0.02, y: MARKET.gateHead + 0.3, rot: Math.PI});
  }

  // --- 3. The platform: benches against the back wall between the gates, the station name plates, a line of lamps ---------------------
  {
    const a = mc.platform, r = W(a);
    a.noFloorLoot = true;
    const gx = mc.gates.map(gt => W(gt.platformDoor));
    const busy = (x: number, half: number) => gx.some(q => x + half > q.x0 - 0.6 && x - half < q.x1 + 0.6);
    let benches = 0;
    for (let x = r.x0 + 3; x < r.x1 - 3 && benches < 3; x += 0.5) {
      if (busy(x, PROP_DEFS.bench.w / 2)) continue;
      if (put(a, 'bench', x, r.z1 - PROP_DEFS.bench.d / 2 - 0.05, Math.PI)) { benches++; x += 6; }
    }
    // name plates on the back wall, either side of the gate nearer the platform's middle (the one the parked train opens onto)
    const pc = (r.x0 + r.x1) / 2, g = gx.slice().sort((p, q) => Math.abs((p.x0 + p.x1) / 2 - pc) - Math.abs((q.x0 + q.x1) / 2 - pc))[0];
    for (const sx of [g.x0 - 1.6, g.x1 + 1.6]) sign({kind: 'station', text: layout.name, area: a.id, x: sx, z: r.z1 - 0.02, y: 2.6, rot: Math.PI});
    for (let x = r.x0 + 3; x < r.x1 - 2; x += 6) light(a, x, (r.z0 + r.z1) / 2, 4.5, {warm: false, power: 0.75});
  }

  // --- 4. The square: communal tables down the middle, fans on the floor by the kitchen, pendant lamps --------------------------------
  const sq = mc.square, sr = W(mc.squareRect);
  sq.noFloorLoot = true;
  // the stall aisle stays clear (3 m in front of the stall row) and so does the deck front (1.5 m: the under-deck rooms open onto it)
  keepRect(ctx0, sr.x0, sr.z0, sr.x1, sr.z0 + 3.0);
  keepRect(ctx0, sr.x0, sr.z1 - 1.5, sr.x1, sr.z1);
  const stairR = W(mc.stair.rect);
  keepRect(ctx0, Math.min(stairR.x0, stairR.x1) - 1.5, stairR.z0 - 2.0, Math.max(stairR.x0, stairR.x1) + 1.5, stairR.z1);
  {
    const midZ = (sr.z0 + 3.0 + sr.z1 - 1.5) / 2, len = sr.x1 - sr.x0;
    const n = 3;
    for (let k = 0; k < n; k++) {
      const x = sr.x0 + len * (k + 1) / (n + 1) + rng.range(-0.8, 0.8);
      const t = put(sq, 'table', x, midZ + rng.range(-0.6, 0.6), rng.chance(0.5) ? 0 : Math.PI / 2, {ring: 0.7});
      if (t) {
        use('sit', t.x + t.hx + 0.55, t.z, sq, t.x, t.z);
        if (k === 1) onHost(t, 'campLantern', 0, 0);
      }
    }
    // a couple of camp tables with folding chairs nearer the kitchen side, a drum fan and a pedestal fan
    const east = -west;
    const ex = east > 0 ? sr.x1 - 5 : sr.x0 + 5;
    const ct = put(sq, 'campTable', ex, midZ - 2.2, 0, {ring: 0.5});
    if (ct) {
      put(sq, 'foldingChair', ct.x - 0.4, ct.z - 0.75, Math.PI);
      put(sq, 'foldingChair', ct.x + 0.4, ct.z + 0.75, 0);
      onHost(ct, 'campStove', -0.3, 0);
      use('sit', ct.x, ct.z - 1.0, sq, ct.x, ct.z);
    }
    put(sq, 'drumFan', ex - east * 2.5, midZ + 2.0, east > 0 ? -Math.PI / 2 : Math.PI / 2);
    put(sq, 'pedestalFan', sr.x0 + len / 2 + rng.range(-2, 2), midZ + 2.6, Math.PI);
    for (let x = sr.x0 + 4; x < sr.x1 - 2; x += 7) for (const z of [sr.z0 + 3.5, sr.z1 - 4.0]) light(sq, x + rng.range(-0.5, 0.5), z, 4.5, {power: 0.95});
  }

  // --- 5. Under the deck: the workshop (scenery only), the bunk room, the communal kitchen --------------------------------------------
  for (const u of mc.under) {
    const a = area(u.area);
    if (u.use === 'workshop') dressWorkshop(u, a); else if (u.use === 'bunks') dressBunks(u, a); else dressKitchen(u, a);
    if (u.use !== 'workshop') a.noFloorLoot = true;
    const r = W(u.rect), ceil = MARKET.deckY - 0.35;
    for (let x = r.x0 + 2.5; x < r.x1 - 1; x += 4.5) light(a, x, (r.z0 + r.z1) / 2, ceil - 0.02, {power: u.use === 'bunks' ? 0.55 : 0.85});
    sign({kind: 'info', text: u.use === 'workshop' ? 'WORKSHOP' : u.use === 'bunks' ? 'BUNKS · QUIET PLEASE' : 'KITCHEN · EVERYONE EATS', area: a.id, x: (r.x0 + r.x1) / 2, z: r.z0 + 0.6, y: ceil - 0.45, rot: 0, hang: true, w: 2.2});
  }
  /** Props against the room's back (south) wall, front north (rot PI), left to right from `from` (world x), `step` between them. */
  function backRow(a: Area, r: ReturnType<typeof W>, kinds: PropKind[], dir: 1 | -1): PropPlacement[] {
    const out: PropPlacement[] = [];
    let x = dir > 0 ? r.x0 + 0.4 : r.x1 - 0.4;
    for (const k of kinds) {
      const w = PROP_DEFS[k].w;
      let p: PropPlacement | null = null;
      for (let tries = 0; tries < 6 && !p; tries++) {
        p = put(a, k, x + dir * w / 2, r.z1 - PROP_DEFS[k].d / 2 - 0.03, Math.PI);
        if (!p) x += dir * 0.5;
      }
      if (p) out.push(p);
      x += dir * (w + 0.25);
    }
    return out;
  }
  function dressWorkshop(u: UnderCarve, a: Area): void {
    const r = W(u.rect);
    // from the outer (canonical west) wall inward: benches, the grinder, the tool chest, salvaged shelving, crates
    const dir = (west > 0 ? -1 : 1) as 1 | -1;
    const row = backRow(a, r, ['repairBench', 'benchGrinderStand', 'repairBench', 'rollingToolChest', 'outdoorsPlankShelving', 'crate', 'crate'], dir);
    for (const p of row) if (p.kind === 'repairBench') use('work', p.x, p.z - 1.0, a, p.x, p.z);
    // on the outer wall: the pegboard and the parts bins; on the floor: a work light, the generator, the compressor
    const outer: Side = west > 0 ? 'E' : 'W';
    const zc = (r.z0 + r.z1) / 2;
    mountProp(ctx0, a, outer, zc - 0.2, 'toolPegboard', 1.05, 0);
    mountProp(ctx0, a, outer, zc + 1.2, 'partsBinRack', 1.2, 0);
    const xin = west > 0 ? r.x1 - 1.8 : r.x0 + 1.8;
    put(a, 'portableGenerator', xin, r.z0 + 1.6, west > 0 ? -Math.PI / 2 : Math.PI / 2);
    put(a, 'tripodWorkLight', xin + (west > 0 ? -1.4 : 1.4), r.z0 + 2.2, Math.PI);
    put(a, 'airCompressor', (r.x0 + r.x1) / 2, r.z0 + 1.2, 0);
    put(a, 'stepLadder', (r.x0 + r.x1) / 2 + 2.2, r.z0 + 1.2, 0);
  }
  function dressBunks(u: UnderCarve, a: Area): void {
    const r = W(u.rect);
    // pallet beds along the back wall, a fabric screen between neighbours (a little privacy), a chair or a crate as a night stand
    const bw = PROP_DEFS.palletBed.w;
    let x = r.x0 + 0.5, n = 0;
    while (x + bw < r.x1 - 0.4) {
      const bed = put(a, 'palletBed', x + bw / 2, r.z1 - PROP_DEFS.palletBed.d / 2 - 0.03, Math.PI);
      if (bed) {
        n++;
        if (n <= 3) use('sleep', bed.x, bed.z - bed.hz - 0.45, a, bed.x, bed.z);
        // the screen beside it: 1.5 m out from the back wall (three 0.5 m fabric panels)
        const sx = x + bw + 0.3;
        if (sx < r.x1 - 0.6) {
          const g = ctx0.g, [cx] = g.cellOf(sx, r.z1 - 0.1);
          const cz0 = Math.floor((r.z1 - 1.5) / CELL), cz1 = Math.floor((r.z1 - 0.01) / CELL);
          let free = true;
          for (let y = cz0; y <= cz1; y++) if (g.blocked[g.idx(cx, y)] || g.cells[g.idx(cx, y)] !== FLOOR) free = false;
          if (free) forceProp(ctx0, a, 'cubiclePartition', (cx + 0.5) * CELL, (cz0 + cz1 + 1) / 2 * CELL, 0.04, (cz1 - cz0 + 1) * CELL / 2, PROP_DEFS.cubiclePartition.h, false).variant = rng.int(0, 2);
        }
      }
      x += bw + 0.75;
    }
    put(a, 'coatRack', r.x0 + 0.5, r.z0 + 0.6, 0);
    put(a, 'plasticStackChair', (r.x0 + r.x1) / 2, r.z0 + 1.0, Math.PI);
    use('sit', (r.x0 + r.x1) / 2 + 0.8, r.z0 + 1.0, a, (r.x0 + r.x1) / 2, r.z1);
  }
  function dressKitchen(u: UnderCarve, a: Area): void {
    const r = W(u.rect);
    const dir = (west > 0 ? -1 : 1) as 1 | -1; // from the bunk-room wall outward
    const row = backRow(a, r, ['wokLine', 'grillLine', 'shopBackbar', 'ingredientBin', 'ingredientBin', 'waterCooler', 'gasCylinderCart'], dir);
    for (const p of row) {
      if (p.kind === 'wokLine' || p.kind === 'grillLine') use('cook', p.x, p.z - 0.95, a, p.x, p.z);
      if (p.kind === 'shopBackbar') { onHost(p, 'riceCooker', -0.55, 0.05); onHost(p, 'deepFryer', 0.5, 0.05); }
    }
    const t = put(a, 'table', (r.x0 + r.x1) / 2 + dir * 1.5, r.z0 + 1.6, Math.PI / 2, {ring: 0.55});
    if (t) use('sit', t.x, t.z - t.hz - 0.5, a, t.x, t.z);
    put(a, 'plasticStackChair', (r.x0 + r.x1) / 2 - dir * 2.2, r.z0 + 1.1, 0);
  }

  // --- 6. The housing deck (storey 1): beds, tents and screens along the back wall, a camp table, string lamps -------------------------
  {
    const a = mc.deck, r = W(a);
    a.noFloorLoot = true;
    // the stair's head stays clear (its landing + 1.5 m either side); the camp table first, the beds round it
    const st = W(mc.stair.rect), sx0 = st.x0 - 1.5, sx1 = st.x1 + 1.5;
    const ct = put(a, 'campTable', (r.x0 + r.x1) / 2 + rng.range(-3, 3), r.z1 - 2.7, 0, {ring: 0.4});
    if (ct) {
      onHost(ct, 'campLantern', 0.35, 0);
      put(a, 'plasticStackChair', ct.x - 0.3, ct.z - 0.75, Math.PI);
      use('sit', ct.x + 0.7, ct.z - 0.8, a, ct.x, ct.z);
    }
    const clear = (x0: number, x1: number) => (x1 <= sx0 || x0 >= sx1) && (!ct || x1 <= ct.x - 1.2 || x0 >= ct.x + 1.2);
    const kinds: PropKind[] = ['tentDisplay', 'palletBed', 'bedroll', 'palletBed', 'tentDisplay', 'bedroll', 'palletBed', 'palletBed', 'tentDisplay', 'bedroll', 'palletBed'];
    let x = r.x0 + 0.6, k = 0;
    while (k < kinds.length && x < r.x1 - 0.6) {
      const kind = kinds[k], w = PROP_DEFS[kind].w;
      if (x + w > r.x1 - 0.6) break;
      if (!clear(x, x + w)) { x += 0.5; continue; }
      const p = put(a, kind, x + w / 2, r.z1 - PROP_DEFS[kind].d / 2 - 0.05, Math.PI);
      if (p) {
        if (kind !== 'tentDisplay' && anchors.uses.filter(q => q.level === 1 && q.kind === 'sleep').length < 2) use('sleep', p.x, p.z - p.hz - 0.45, a, p.x, p.z);
        x += w + 0.9;
        k++;
      } else x += 0.5;
    }
    for (let xx = r.x0 + 3; xx < r.x1 - 2; xx += 5) light(a, xx, (r.z0 + r.z1) / 2, MARKET.deckY + 2.6, {power: 0.7});
  }
  return anchors;
}
