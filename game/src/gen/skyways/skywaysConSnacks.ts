// Task studio-skywalk-variety-20261107-231448-01 (lane DRESS; user: "need a little more loot in the anime convention area. Lets get some
// bubble teas on the tables, and perhaps other drinks and snacks, nothing crazy, just enough to make it feel a little bit more alive."):
// the convention's TABLE SNACKS — a modest, finite set of real consumables standing on the event's table tops (layout version 4 only:
// gen/skyways/addon.ts runs this when skywaysGenVersion(layout) >= 4, on its own rng fork, after the main hall and the venue floor are
// dressed and lifted):
//  - the REGISTRATION desks: the badge staff's drink / snack on the staff side of a desk or two (at most half the desks;
//    CON_TABLE_SNACK_ROWS);
//  - the PANEL tables: a drink at one or two of the panelists' places (CON_PANEL_DRINK_ROWS: mostly bottled water);
//  - the VENDOR tables (the main hall's merch rows and the artist alley): a bubble tea, a can, a bag of chips on the vendor's side of
//    at most about one table in three, clear of the table's stock.
// The first snack off a panel table is always a bubble tea (the user's ask); the rest are drawn from the items/lootTables.ts rows. Each is
// an ORDINARY layout pickup (existing items, models and consumption) standing on the table's real top — y = the table's base + its top
// height, its footprint (the radius of its w x d at any yaw) wholly over the top and clear of the table's own on-top props (merch,
// banners) and of every other pickup — so it never floats or overlaps, is remembered like every generated pickup (run/memory.ts:
// layout.pickups indices) and is never refilled. Most tables stay bare: CON_SNACKS.total per venue. Pure data; the rng is consumed only
// here.

import type {Rng} from '../../core/rng';
import {itemDims} from '../../items/items';
import {CON_PANEL_DRINK_ROWS, CON_TABLE_SNACK_ROWS} from '../../items/lootTables';
import {BUBBLE_TEA} from '../../items/skywaysFood';
import type {PropPlacement} from '../props';
import type {PickupPlacement, StationLayout} from '../stationTypes';
import {normYaw, r3, toWorld} from './addonFrame';
import {SKYWAYS_MERCH_TOP} from './addonKinds';
import type {ConventionResult} from './addonConvention';
import type {VenueResult} from './venueDress';

/** Snacks per convention (inclusive target), the share of vendor tables that may hold one, panel drinks per panel room (inclusive). */
export const CON_SNACKS = {total: [7, 12] as const, vendorShare: 0.35, perPanel: [1, 2] as const, perRegistration: [1, 2] as const};
/** Host-local depth (m, the table's -Z side: the vendor's / staff's / panelists' side) of the snacks on a table top. */
export const CON_SNACK_LZ = -0.24;
/** Clearance kept between a snack's footprint and the table edge / its stock / another pickup (m). */
export const CON_SNACK_GAP = 0.025;

export type ConSnackGroup = 'registration' | 'panel' | 'vendor';
export interface ConSnackResult {
  /** layout.pickups indices of the snacks (append order). */
  pickupIndex: number[];
  /** Per snack: the layout.props index of the table it stands on, and its group. */
  hosts: number[];
  groups: ConSnackGroup[];
  /** Tables considered per group (QA: most stay bare). */
  tables: Record<ConSnackGroup, number>;
  skipped: string[];
}

const RESULTS = new WeakMap<StationLayout, ConSnackResult>();
/** QA / tests: the snacks of a layout (resolved against its CURRENT pickups / props), or undefined (no convention / layout version < 4). */
export function skywaysConSnacksOf(layout: StationLayout): {pickup: PickupPlacement; host: PropPlacement; group: ConSnackGroup; index: number}[] | undefined {
  const r = RESULTS.get(layout);
  return r?.pickupIndex.map((index, k) => ({pickup: layout.pickups[index], host: layout.props[r.hosts[k]], group: r.groups[k], index}));
}
/** QA / tests: the raw result record. */
export const skywaysConSnackResult = (layout: StationLayout): ConSnackResult | undefined => RESULTS.get(layout);

/** A snack's footprint radius (its w x d at any yaw). */
export const snackRadius = (itemId: string): number => { const d = itemDims(itemId); return Math.hypot(d.w, d.d) / 2; };

/** Places the convention's table snacks (see the header). `src` = what the main hall's / venue's dressers placed (lifted: absolute y). */
export function dressConventionSnacks(layout: StationLayout, rng: Rng, src: {convention?: ConventionResult; venue?: VenueResult}): ConSnackResult {
  const res: ConSnackResult = {pickupIndex: [], hosts: [], groups: [], tables: {registration: 0, panel: 0, vendor: 0}, skipped: []};
  RESULTS.set(layout, res);
  const index = new Map(layout.props.map((p, i) => [p, i] as const));
  const hosted = new Map<number, PropPlacement[]>();
  for (const p of layout.props) if (p.host !== undefined) (hosted.get(p.host) ?? hosted.set(p.host, []).get(p.host)!).push(p);
  const level = layout.skyways?.addon.level ?? 0;
  const total = rng.int(CON_SNACKS.total[0], CON_SNACKS.total[1]);
  let tea = false;

  /** Puts `itemId` on table `t` at host-local (lx, lz) if it fits wholly on the top, clear of its stock and every pickup. */
  const tryPut = (t: PropPlacement, lx: number, lz: number, itemId: string, group: ConSnackGroup): boolean => {
    const hi = index.get(t);
    if (hi === undefined || t.kind !== 'skywaysConMerchTable') return false;
    const r = snackRadius(itemId), top = SKYWAYS_MERCH_TOP;
    if (Math.abs(lx) + r > top.x - CON_SNACK_GAP || Math.abs(lz) + r > top.z - CON_SNACK_GAP) return false;
    const [x, z] = toWorld(t, lx, lz), lv = t.level ?? level, y = r3(t.y + top.y);
    for (const p of hosted.get(hi) ?? []) if (Math.abs(p.x - x) < p.hx + r + CON_SNACK_GAP && Math.abs(p.z - z) < p.hz + r + CON_SNACK_GAP) return false;
    for (const q of layout.pickups) {
      if ((q.level ?? 0) !== lv || Math.abs(q.y - y) > 0.5) continue;
      if (Math.hypot(q.x - x, q.z - z) < snackRadius(q.itemId) + r + CON_SNACK_GAP) return false;
    }
    const pk: PickupPlacement = {itemId, count: 1, x: r3(x), y, z: r3(z), area: t.area, ...(lv ? {level: lv} : {}), yaw: r3(normYaw(t.rot + Math.PI + rng.range(-0.35, 0.35)))};
    res.pickupIndex.push(layout.pickups.length);
    layout.pickups.push(pk);
    res.hosts.push(hi);
    res.groups.push(group);
    if (itemId === BUBBLE_TEA) tea = true;
    return true;
  };
  /** One snack on table `t` at the first free spot of `lxs` (item: the first off a panel table is a bubble tea, else from `rows`). */
  const onTable = (t: PropPlacement, lxs: readonly number[], rows: typeof CON_TABLE_SNACK_ROWS, group: ConSnackGroup): boolean => {
    const itemId = !tea && group !== 'panel' ? BUBBLE_TEA : rng.weighted(rows);
    for (const lx of lxs) if (tryPut(t, lx, CON_SNACK_LZ + rng.range(-0.02, 0.02), itemId, group)) return true;
    return false;
  };
  const left = () => total - res.pickupIndex.length;
  const venue = src.venue;

  // --- the badge staff: a drink / snack on the staff side of a desk or two ----------------------------------------------------------
  const desks = venue?.desks ?? [];
  res.tables.registration = desks.length;
  if (desks.length) {
    let n = Math.min(rng.int(CON_SNACKS.perRegistration[0], CON_SNACKS.perRegistration[1]), Math.ceil(desks.length / 2)); // (most desks stay bare)
    for (const t of rng.shuffle(desks.slice())) {
      if (n <= 0 || left() <= 0) break;
      if (onTable(t, rng.shuffle([0.55, -0.55, 0.3, -0.3, 0.75, -0.75]), CON_TABLE_SNACK_ROWS, 'registration')) n--;
    }
  }
  // --- the panels: a drink at one or two panelists' places (on the table in front of their chairs) ------------------------------------
  for (const pn of venue?.panels ?? []) {
    res.tables.panel += pn.tables.length;
    if (!pn.tables.length || left() <= 0) continue;
    const seats: {t: PropPlacement; lx: number}[] = [];
    for (const c of pn.panelists) for (const t of pn.tables) {
      const [lx, lz] = local(t, c.x, c.z);
      if (lz < 0 && Math.abs(lx) <= SKYWAYS_MERCH_TOP.x - 0.12) seats.push({t, lx: r3(lx)});
    }
    if (!seats.length) for (const t of pn.tables) seats.push({t, lx: -0.45}, {t, lx: 0.45});
    let n = rng.int(CON_SNACKS.perPanel[0], CON_SNACKS.perPanel[1]);
    for (const s of rng.shuffle(seats)) {
      if (n <= 0 || left() <= 0) break;
      if (onTable(s.t, [s.lx, s.lx + 0.12, s.lx - 0.12], CON_PANEL_DRINK_ROWS, 'panel')) n--;
    }
  }
  // --- the vendors: at most about one table in three (the main hall's merch rows and the artist alley) -------------------------------------------
  const vendors = [...(src.convention?.tables ?? []), ...(venue?.tables ?? [])];
  res.tables.vendor = vendors.length;
  let cap = Math.max(1, Math.round(vendors.length * CON_SNACKS.vendorShare));
  for (const t of rng.shuffle(vendors.slice())) {
    if (cap <= 0 || left() <= 0) break;
    if (onTable(t, rng.shuffle([0.75, -0.75, 0.55, -0.55, 0.35, -0.35]), CON_TABLE_SNACK_ROWS, 'vendor')) cap--;
  }
  if (res.pickupIndex.length < CON_SNACKS.total[0]) res.skipped.push(`convention snacks: ${res.pickupIndex.length} placed (of ${total})`);
  return res;
}

/** World point -> host-local (x, z) (the inverse of addonFrame toWorld). */
function local(host: {x: number; z: number; rot: number}, x: number, z: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot), dx = x - host.x, dz = z - host.z;
  return [c * dx - s * dz, s * dx + c * dz];
}
