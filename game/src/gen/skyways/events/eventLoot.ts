// Task studio-skywalk-loot-performance-20261116-022934-01 (lane LOOT; Skyways layout version 8; user: "Make Technology Expo, Mini-golf
// and Evacuation Centre feel properly supplied with useful, plausible existing loot, not just decorative furniture"): the new events'
// OWN SUPPLY HOLDERS. gen/skyways/index.ts calls this pass as the very last step of a version-8 attempt, on its own fork.
//
// Each event has places that match the venue. Each place gets a few existing, audited holder kinds keyed to the place's exact table
// (gen/skyways/events/eventLootPurposes.ts -> items/lootTables.ts EXPO_* / GOLF_* / EVAC_*):
//  - technology expo: an AV tool chest and a demo-stock carton in its storage room (else the staff room), a presenter's flight case in
//    each demo theatre, and a demo-stock carton and tote on the expo floor;
//  - mini-golf: a filing cabinet at the front desk (reception), a tool chest and a tall cupboard in the course storage (else the staff
//    room) for maintenance, and a drinks cooler and a snack rack in the clubhouse (else a party room) for concessions;
//  - evacuation centre: a medical cabinet and a tote of dressings in the medical bay, a crate and a carton of rations by the ration
//    line, and a tall cupboard and a crate in the supply store (else the shelter office).
//
// Save compatibility and RNG neutrality:
//  - the pass draws only from its own fork, and only when the add-on is a new event (a convention or prize-car layout stays
//    byte-identical);
//  - it runs after every other pass (enemies, hordes, the annex, the merchandise split, the cosplay crowds, the family roll) and only
//    APPENDS holders to layout.props;
//  - so every earlier prop, pickup, spawn and holder keeps its index, per-kind holder index, serial, contents and lot ids
//    (world/containers.ts), and the event draw does not change;
//  - versions 1-7 never come here (gen/skyways/layoutVersion.ts SKYWAYS_EVENT_LOOT_MIN_VERSION).
//
// Placement uses the venue's route-checked shared primitives (gen/skyways/venueDress.ts eventVenueContext / group, gen/placeKit.ts
// tryPlaceProp):
//  - every holder has its back to a solid wall, with no glazing or storefront opening behind it;
//  - it stands on the venue floor, inside a venue room, never in a door zone or a door strip;
//  - its lid, door or drawer strip stays open floor;
//  - it keeps clear of every earlier prop (and its front), pickup, enemy spawn and low sign;
//  - every 1.2 m route from the bridges to each opening is kept.
// Nothing goes in the golf course hall. A place with no fitting spot is skipped and recorded.

import type {Rng} from '../../../core/rng';
import {CELL, FLOOR} from '../../grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../../props';
import {OPENABLE_FRONT, backed, cellsOfBox, markCell, propBlocksDoorway, wallRange, wallSpot, type PlaceCtx} from '../../placeKit';
import type {Area, Side, StationLayout} from '../../stationTypes';
import {eventVenueContext, group, type VenueCtx} from '../venueDress';
import {isSkywaysEventAddon, type SkywaysEventAddonId, type SkywaysVenueRole} from '../skywaysTypes';
import {evacRationTablesOf} from './evacDress';
import {SKYWAYS_EVENT_LOOT_PURPOSE as P, type SkywaysEventLootKey} from './eventLootPurposes';

/** Where a set of supplies goes (per event). */
export type SkywaysEventSupplyPlace =
  | 'expo-storage' | 'expo-demo' | 'expo-floor'
  | 'golf-desk' | 'golf-maintenance' | 'golf-concessions'
  | 'evac-medical' | 'evac-rations' | 'evac-supplies';

export interface SkywaysEventSupplySet {
  place: SkywaysEventSupplyPlace;
  /** The holders in placement order, each an existing audited kind with its fallbacks (a smaller kind for a fuller room). */
  holders: readonly (readonly PropKind[])[];
  /** Their loot key (PropPlacement.purpose). */
  key: SkywaysEventLootKey;
  /** One set in every area of the place (the demo theatres), instead of one set for the whole place. */
  each?: boolean;
}

/** The supply sets of each new event. */
export const SKYWAYS_EVENT_SUPPLIES: Readonly<Record<SkywaysEventAddonId, readonly SkywaysEventSupplySet[]>> = {
  'tech-expo': [
    {place: 'expo-storage', holders: [['rollingToolChest'], ['cardboardBoxFlaps', 'storageTote']], key: P.expoStorage},
    {place: 'expo-demo', holders: [['footlocker']], key: P.expoDemo, each: true},
    {place: 'expo-floor', holders: [['cardboardBoxFlaps'], ['storageTote']], key: P.expoDemo},
  ],
  'mini-golf': [
    {place: 'golf-desk', holders: [['filingCabinet']], key: P.golfDesk},
    {place: 'golf-maintenance', holders: [['rollingToolChest'], ['cabinetTall', 'storageTote']], key: P.golfMaintenance},
    {place: 'golf-concessions', holders: [['shopCooler'], ['snackRack']], key: P.golfConcessions},
  ],
  'evac-centre': [
    {place: 'evac-medical', holders: [['medCabinet'], ['storageTote']], key: P.evacMedical},
    {place: 'evac-rations', holders: [['crate'], ['cardboardBoxFlaps']], key: P.evacRations},
    {place: 'evac-supplies', holders: [['cabinetTall', 'crate'], ['crate', 'storageTote']], key: P.evacSupplies},
  ],
};

export const SKYWAYS_EVENT_LOOT = {
  /** Open floor kept in front of every new holder (m; an openable's own swing strip may be deeper: placeKit OPENABLE_FRONT). */
  front: 0.6,
  /** Clearances (m): around earlier props' boxes, pickups, enemy spawns and low signs; the strip kept in front of earlier floor props. */
  propGap: 0.05, propFront: 0.6, pickupClear: 0.9, spawnClear: 1.2, signClear: 0.1,
  /** Props / signs whose bottom is at least this far above the floor never meet a holder (m: over the tallest holder, 2.0 m). */
  overhead: 2.2,
  /** A storefront opening stays this far from a holder's back along the wall (m). */
  shopClear: 1.0,
  /** Route-checked placements tried per holder kind and area (spots that pass every cheap check first). */
  tries: 24,
  /** Candidate step along a wall (m). */
  step: 0.25,
} as const;

/** The context roles: every venue room a set may use (the washrooms keep the station's dressing). */
const ROLES: readonly SkywaysVenueRole[] = ['main-hall', 'registration', 'exhibitors', 'panel', 'photo-lounge', 'backstage', 'storage'];
const SIDES: readonly Side[] = ['N', 'S', 'W', 'E'];
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface SkywaysEventLootHolder { index: number; kind: string; place: SkywaysEventSupplyPlace; key: SkywaysEventLootKey; area: number }
interface Placed { prop: PropPlacement; place: SkywaysEventSupplyPlace; key: SkywaysEventLootKey }
const RESULTS = new WeakMap<StationLayout, {placed: Placed[]; skipped: string[]}>();

/** QA / tests: the event supply holders of a generated layout (layout.props indices, resolved now), and what was skipped. */
export function skywaysEventLootOf(layout: StationLayout): {holders: SkywaysEventLootHolder[]; skipped: readonly string[]} {
  const r = RESULTS.get(layout);
  if (!r) return {holders: [], skipped: []};
  const holders = r.placed.map(q => ({index: layout.props.indexOf(q.prop), kind: q.prop.kind as string, place: q.place, key: q.key, area: q.prop.area})).filter(h => h.index >= 0);
  return {holders, skipped: r.skipped};
}

/** Appends the new event's supply holders (version 8+; nothing for the convention / the prize car). Returns the holders placed. */
export function dressSkywaysEventLoot(layout: StationLayout, rng: Rng): PropPlacement[] {
  const addon = layout.skyways?.addon;
  if (!addon || !isSkywaysEventAddon(addon.id) || !addon.venue?.length) return [];
  const vc = eventVenueContext(layout, rng, ROLES);
  if (!vc) return [];
  const v = vc.v, placed: Placed[] = [], skipped: string[] = [];
  keepClear(layout, v.ctx);
  for (const set of SKYWAYS_EVENT_SUPPLIES[addon.id]) {
    const groups = placesOf(layout, vc, set.place);
    if (!groups.length) { skipped.push(`${set.place}: no room`); continue; }
    for (const g of set.each ? groups.map(q => [q]) : [groups]) {
      let anchor = g[0].anchor, prefer: Area | null = null;
      for (const kinds of set.holders) {
        const order = prefer ? [prefer, ...g.map(q => q.area).filter(a => a !== prefer)] : g.map(q => q.area);
        let p: PropPlacement | null = null;
        // the kind first in every room of the place, then its fallback
        for (const kind of kinds) {
          for (const a of order) if ((p = placeHolder(layout, vc, a, kind, anchor ?? g.find(q => q.area === a)?.anchor ?? null))) break;
          if (p) break;
        }
        if (!p) { skipped.push(`${set.place}: ${kinds.join(' / ')}`); continue; }
        placed.push({prop: p, place: set.place, key: set.key});
        // the set's next holders stand by the first one (one supply corner)
        anchor = {x: p.x, z: p.z};
        prefer = layout.areas[p.area];
      }
    }
  }
  v.lift();
  for (const q of placed) q.prop.purpose = q.key;
  RESULTS.set(layout, {placed, skipped});
  return placed.map(q => q.prop);
}

/** The areas of a place in preference order, each with an optional anchor (world m) its holders gather round. */
function placesOf(layout: StationLayout, vc: VenueCtx, place: SkywaysEventSupplyPlace): {area: Area; anchor: {x: number; z: number} | null}[] {
  const addon = layout.skyways!.addon;
  const pub = new Set(vc.walk.pub.map(a => a.id));
  const role = (r: SkywaysVenueRole) => (addon.venue ?? []).filter(q => q.role === r && pub.has(q.area)).map(q => layout.areas[q.area]);
  const bySize = (as: Area[]) => as.slice().sort((p, q) => q.w * q.h - p.w * p.h || p.id - q.id);
  const plain = (as: Area[]) => as.map(area => ({area, anchor: null}));
  const section = (r: string) => (addon.evac?.sections ?? []).filter(s => s.role === r && pub.has(s.area)).map(s => layout.areas[s.area]);
  const centre = (ps: readonly PropPlacement[]) => (ps.length ? {x: ps.reduce((s, p) => s + p.x, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length} : null);
  const uniq = (as: readonly {area: Area; anchor: {x: number; z: number} | null}[]) => as.filter((q, i) => q.area && as.findIndex(o => o.area === q.area) === i);
  // the back rooms: the venue's storage room, then its staff room (a full room hands the set on)
  const backRooms = () => plain([...role('storage'), ...role('backstage')]);
  switch (place) {
    case 'expo-storage': return [...backRooms(), ...plain(role('panel'))]; // (else by a demo theatre's stage)
    case 'expo-demo': return plain(role('panel'));
    case 'expo-floor': return plain(bySize(role('exhibitors')));
    case 'golf-desk': {
      const d = addon.golf?.desk;
      const at = d ? layout.areas[d.area] : undefined;
      return uniq([...(at && pub.has(at.id) ? [{area: at, anchor: {x: d!.x, z: d!.z}}] : []), ...plain(role('registration'))]);
    }
    case 'golf-maintenance': return backRooms();
    case 'golf-concessions': return plain([...bySize(role('exhibitors')), ...role('panel')]);
    case 'evac-medical': {
      // the medical bay (panel room A) first, then the commons' triage corner
      const bay = section('medical').sort((p, q) => Number(vc.roleOf(q.id) === 'panel') - Number(vc.roleOf(p.id) === 'panel'));
      return uniq(bay.map(area => ({area, anchor: centre(layout.props.filter(p => p.area === area.id && p.kind === 'medCabinet'))})));
    }
    case 'evac-rations': {
      const tables = evacRationTablesOf(layout).map(i => layout.props[i]).filter(Boolean);
      return uniq(section('rations').map(area => ({area, anchor: centre(tables.filter(t => t.area === area.id))})));
    }
    case 'evac-supplies': return uniq(plain([...section('supplies'), ...section('office')]));
  }
}

/** Marks the floor every new holder keeps off (ctx.keep): earlier props and their fronts, pickups, enemy spawns and low signs. */
function keepClear(layout: StationLayout, ctx: PlaceCtx): void {
  const g = ctx.g, R = SKYWAYS_EVENT_LOOT, lv = ctx.level;
  const box = (x: number, z: number, hx: number, hz: number) => {
    const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (g.inBounds(cx, cy)) markCell(ctx, ctx.keep, g.idx(cx, cy));
  };
  const floorAt = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && g.cells[g.idx(cx, cy)] === FLOOR ? g.floorOf(g.idx(cx, cy)) : layout.levels[lv]?.baseY ?? 0; };
  for (const p of layout.props) {
    if ((p.level ?? 0) !== lv || p.host !== undefined) continue;
    const above = p.y + (p.lift ?? 0) - floorAt(p.x, p.z);
    if (above >= R.overhead) continue;
    box(p.x, p.z, p.hx + R.propGap, p.hz + R.propGap);
    if (p.mounted || above > 0.3) continue;
    // the strip in front of a floor prop (its door / drawer / lid / seat side) stays open; a turned (non-quarter) prop keeps a ring
    const q = Math.round(p.rot / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(q - p.rot) > 0.01) { box(p.x, p.z, p.hx + 0.5, p.hz + 0.5); continue; }
    const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot)), f = Math.max(R.propFront, OPENABLE_FRONT[p.kind as string] ?? 0);
    const hd = fx ? p.hx : p.hz, hw = fx ? p.hz : p.hx;
    box(p.x + fx * (hd + f / 2), p.z + fz * (hd + f / 2), fx ? f / 2 : hw, fz ? f / 2 : hw);
  }
  for (const q of layout.pickups) if ((q.level ?? 0) === lv) box(q.x, q.z, R.pickupClear, R.pickupClear);
  for (const z of layout.zombies) if ((z.level ?? 0) === lv) box(z.x, z.z, R.spawnClear, R.spawnClear);
  for (const s of layout.signs) {
    if ((s.level ?? 0) !== lv || s.y - floorAt(s.x, s.z) >= R.overhead + 0.25) continue;
    const r = (s.w ?? 1.2) / 2 + R.signClear;
    box(s.x, s.z, r, r);
  }
}

/** One holder against a wall of `a`, nearest the anchor first (else in a random order of the fork). */
function placeHolder(layout: StationLayout, vc: VenueCtx, a: Area, kind: PropKind, anchor: {x: number; z: number} | null): PropPlacement | null {
  const v = vc.v, g = v.g, rng = v.rng, R = SKYWAYS_EVENT_LOOT, def = PROP_DEFS[kind], hw = def.w / 2;
  if (vc.roleOf(a.id) === 'main-hall' && a.noFloorLoot) return null; // (the golf course hall)
  const cands: {x: number; z: number; rot: number; side: Side; t: number; s: number}[] = [];
  for (const side of SIDES) {
    const [lo, hi] = wallRange(a, side);
    for (let t = lo + hw + 0.15; t <= hi - hw - 0.15 + 1e-6; t += R.step) {
      const s = wallSpot(a, side, r3(t), kind);
      const d = anchor ? Math.hypot(s.x - anchor.x, s.z - anchor.z) : 0;
      cands.push({...s, side, t: r3(t), s: d + rng.range(0, anchor ? 1.5 : 100)});
    }
  }
  cands.sort((p, q) => p.s - q.s || p.x - q.x || p.z - q.z);
  const wins = (layout.skyways?.windows ?? []).filter(w => w.level === v.level);
  let tries = 0;
  for (const c of cands) {
    if (tries >= R.tries) break;
    const [cx, cy] = g.cellOf(c.x, c.z);
    if (!g.inBounds(cx, cy) || g.cells[g.idx(cx, cy)] !== FLOOR || g.area[g.idx(cx, cy)] !== a.id) continue;
    if (!cellsFree(v.ctx, a, kind, c.x, c.z, c.rot)) continue;
    const base = g.floorOf(g.idx(cx, cy));
    // a solid wall behind its whole back (at the foot and the top), no glazing, no storefront opening, no door's clear volume
    if (!backed(v.ctx, a, c.side, c.t - hw, c.t + hw, base + 0.1) || !backed(v.ctx, a, c.side, c.t - hw, c.t + hw, base + def.h - 0.05)) continue;
    if (glazedBehind(a, c.side, c.t, hw, def.h, wins) || shopfrontNear(layout, a, c.side, c.t, hw)) continue;
    const along = c.side === 'N' || c.side === 'S', hx = along ? hw : def.d / 2, hz = along ? def.d / 2 : hw;
    if (propBlocksDoorway(layout, c.x, c.z, hx, hz, base, def.h)) continue;
    tries++;
    const p = group(vc, [a], () => v.put(kind, c.x, c.z, c.rot, {area: a, front: R.front}));
    if (p) return p;
  }
  return null;
}

/** The holder's own cells are free floor of `a` (tryPlaceProp's cell rules: the cheap test before a route-checked placement). */
function cellsFree(ctx: PlaceCtx, a: Area, kind: PropKind, x: number, z: number, rot: number): boolean {
  const g = ctx.g, {hx, hz} = footprint(kind, rot);
  const [x0, y0, x1, y1] = cellsOfBox(x, z, hx, hz);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (!g.inBounds(cx, cy)) return false;
    const i = g.idx(cx, cy);
    if (g.cells[i] !== FLOOR || g.area[i] !== a.id || g.blocked[i] || ctx.keep[i] || ctx.edge[i] || ctx.doorCell[i] || ctx.zone[i]) return false;
  }
  return true;
}

/** Glazing in the wall behind the span (a window's sill below the holder's top). */
function glazedBehind(a: Area, side: Side, t: number, hw: number, h: number, wins: readonly {x0: number; z0: number; x1: number; z1: number; sill: number; head: number}[]): boolean {
  const along = side === 'N' || side === 'S';
  const wall = side === 'N' ? a.y * CELL - CELL / 2 : side === 'S' ? (a.y + a.h) * CELL + CELL / 2 : side === 'W' ? a.x * CELL - CELL / 2 : (a.x + a.w) * CELL + CELL / 2;
  const sx0 = along ? t - hw : wall - CELL / 2, sx1 = along ? t + hw : wall + CELL / 2, sz0 = along ? wall - CELL / 2 : t - hw, sz1 = along ? wall + CELL / 2 : t + hw;
  return wins.some(w => w.x0 < sx1 + 0.05 && w.x1 > sx0 - 0.05 && w.z0 < sz1 + 0.05 && w.z1 > sz0 - 0.05 && w.sill < h + 0.1 && w.head > -0.1);
}

/** A storefront opening on the same wall of `a` within shopClear of the holder's back span. */
function shopfrontNear(layout: StationLayout, a: Area, side: Side, t: number, hw: number): boolean {
  const along = side === 'N' || side === 'S', R = SKYWAYS_EVENT_LOOT;
  for (const sf of layout.storefronts) {
    if (sf.hall !== a.id && sf.unit !== a.id) continue;
    const s0 = (along ? sf.ox : sf.oy) * CELL, s1 = (along ? sf.ox + sf.ow : sf.oy + sf.oh) * CELL;
    // the opening lies on this wall of the area (one cell thick, just outside or on its edge)
    const w0 = (along ? sf.oy : sf.ox) * CELL, w1 = (along ? sf.oy + sf.oh : sf.ox + sf.ow) * CELL;
    const wall = side === 'N' ? a.y * CELL : side === 'S' ? (a.y + a.h) * CELL : side === 'W' ? a.x * CELL : (a.x + a.w) * CELL;
    if (w1 < wall - CELL - 0.01 || w0 > wall + CELL + 0.01) continue;
    if (t + hw + R.shopClear > s0 && t - hw - R.shopClear < s1) return true;
  }
  return false;
}
