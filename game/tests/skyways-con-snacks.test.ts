// Task studio-skywalk-variety-20261107-231448-01 (lane DRESS; user: "need a little more loot in the anime convention area. Lets get some
// bubble teas on the tables, and perhaps other drinks and snacks, nothing crazy"): the convention's TABLE SNACKS
// (gen/skyways/skywaysConSnacks.ts, layout version 4), on real Skyways layouts with a convention (seeds FOUND by a scan, never pinned):
//  - modest and finite per venue (at most CON_SNACKS.total[1]; most tables bare), the registration desks / panel tables / vendor tables
//    each represented where the venue has them, at least one bubble tea;
//  - every snack an existing consumable of the items/lootTables.ts rows, one serving, standing on a convention table's REAL top (y = the
//    table's base + its top height, wholly over the top, on its staff / vendor / panelist side), clear of the table's own stock / banner
//    and of every other pickup, never on the floor;
//  - ordinary layout pickups: deterministic, and the section memory's taken state is by layout index (taken stays taken, no refill);
//  - the version gate: layout version 3 regenerates without them (the v1 / v2 / v3 fingerprints: tests/skyways-dest-layout-version.test.ts).
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {skywaysAddonDressOf} from '../src/gen/skyways/addon';
import {SKYWAYS_MERCH_TOP} from '../src/gen/skyways/addonKinds';
import {CON_SNACKS, skywaysConSnackResult, skywaysConSnacksOf, snackRadius} from '../src/gen/skyways/skywaysConSnacks';
import {CON_PANEL_DRINK_ROWS, CON_TABLE_SNACK_ROWS} from '../src/items/lootTables';
import {ITEMS} from '../src/items/items';
import {createMemory, pickupPlan, takenLayoutPickups} from '../src/run/memory';

const LOG = '/tmp/skyways-con-snacks.log';
const gen = (seed: number, layoutVersion?: number): StationLayout =>
  LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion ? {layoutVersion} : {})} as never);
/** World point -> host-local (x, z). */
function local(host: {x: number; z: number; rot: number}, x: number, z: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot), dx = x - host.x, dz = z - host.z;
  return [c * dx - s * dz, s * dx + c * dz];
}
/** Distance from a point to a prop's world AABB footprint (0 inside). */
const rectDist = (p: {x: number; z: number; hx: number; hz: number}, x: number, z: number) =>
  Math.hypot(Math.max(0, Math.abs(x - p.x) - p.hx), Math.max(0, Math.abs(z - p.z) - p.hz));

const ROW_ITEMS = new Set([...CON_TABLE_SNACK_ROWS, ...CON_PANEL_DRINK_ROWS].map(r => r[0]));
const found: {seed: number; L: StationLayout}[] = [];

beforeAll(() => {
  fs.writeFileSync(LOG, '');
  // the first four version-4 convention layouts with a venue floor (a scan: the carve decides which seeds hold a convention)
  for (let s = 1; s <= 80 && found.length < 4; s++) {
    const L = gen(s);
    if (L.skyways?.addon.id === 'convention' && L.skyways.addon.venue?.length) found.push({seed: s, L});
  }
});

describe('Skyways convention table snacks (layout version 4)', () => {
  it('a modest, finite set per venue: most tables bare, every table group represented, at least one bubble tea', () => {
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const {seed, L} of found) {
      const sn = skywaysConSnacksOf(L)!, r = skywaysConSnackResult(L)!;
      expect(sn, `seed ${seed}`).toBeDefined();
      const tables = r.tables.registration + r.tables.panel + r.tables.vendor;
      const hosts = new Set(sn.map(q => q.host));
      fs.appendFileSync(LOG, `seed ${seed}: ${sn.length} snacks on ${hosts.size} of ${tables} tables ${JSON.stringify(r.tables)}; ${sn.map(q => `${q.group}:${q.pickup.itemId}`).join(' ')}\n`);
      expect(sn.length, `seed ${seed}`).toBeLessThanOrEqual(CON_SNACKS.total[1]);
      expect(sn.length, `seed ${seed}`).toBeGreaterThanOrEqual(r.tables.vendor >= 10 ? 5 : 3);
      expect(hosts.size / tables, `seed ${seed}: most tables stay bare`).toBeLessThan(0.5);
      expect(new Set(sn.filter(q => q.group === 'vendor').map(q => q.host)).size, `seed ${seed}: vendor tables`).toBeLessThanOrEqual(Math.max(1, Math.round(r.tables.vendor * CON_SNACKS.vendorShare)));
      expect(new Set(sn.filter(q => q.group === 'registration').map(q => q.host)).size, `seed ${seed}: badge desks`).toBeLessThanOrEqual(Math.ceil(r.tables.registration / 2));
      for (const g of ['registration', 'panel', 'vendor'] as const) if (r.tables[g] > 0) expect(sn.some(q => q.group === g), `seed ${seed}: ${g}`).toBe(true);
      expect(sn.some(q => q.pickup.itemId === 'bubble_tea'), `seed ${seed}: a bubble tea`).toBe(true);
    }
  });

  it('each one serving of an existing consumable, standing on a table\'s real top on its back side, clear of its stock and every pickup', () => {
    for (const {seed, L} of found) {
      const sn = skywaysConSnacksOf(L)!;
      const venue = new Set((L.skyways!.addon.venue ?? []).map(v => v.area).concat(L.skyways!.addon.areas));
      for (const {pickup: p, host: t, index} of sn) {
        expect(L.pickups[index]).toBe(p);
        expect(ROW_ITEMS.has(p.itemId), p.itemId).toBe(true);
        expect(ITEMS[p.itemId]?.kind, p.itemId).toBe('consumable');
        expect(p.count).toBe(1);
        expect(t.kind).toBe('skywaysConMerchTable');
        expect(venue.has(t.area), `seed ${seed}: a convention table`).toBe(true);
        expect(p.area).toBe(t.area);
        expect(p.level ?? 0).toBe(t.level ?? 0);
        // on the real top: the table's base + its top height, well above the floor
        expect(Math.abs(p.y - (t.y + SKYWAYS_MERCH_TOP.y)), `seed ${seed}: ${p.itemId} y`).toBeLessThan(2e-3);
        expect(p.y - L.levels[t.level ?? 0].baseY).toBeGreaterThan(0.7);
        const [lx, lz] = local(t, p.x, p.z), r = snackRadius(p.itemId);
        expect(Math.abs(lx) + r, `seed ${seed}: ${p.itemId} over the top (x)`).toBeLessThanOrEqual(SKYWAYS_MERCH_TOP.x + 1e-3);
        expect(Math.abs(lz) + r, `seed ${seed}: ${p.itemId} over the top (z)`).toBeLessThanOrEqual(SKYWAYS_MERCH_TOP.z + 1e-3);
        expect(lz, 'the staff / vendor / panelist side').toBeLessThan(0);
        // clear of the table's own on-top props (merch, banner)
        const hi = L.props.indexOf(t);
        for (const q of L.props) if (q.host === hi) expect(rectDist(q, p.x, p.z), `seed ${seed}: ${p.itemId} vs ${q.kind}`).toBeGreaterThanOrEqual(r);
      }
      // never overlapping any other pickup at its height
      for (const {pickup: a} of sn) for (const b of L.pickups) {
        if (a === b || (a.level ?? 0) !== (b.level ?? 0) || Math.abs(a.y - b.y) > 0.3) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `seed ${seed}: ${a.itemId} / ${b.itemId}`).toBeGreaterThanOrEqual(snackRadius(a.itemId) + snackRadius(b.itemId));
      }
    }
  });

  it('ordinary layout pickups: deterministic; taken stays taken by layout index (never refilled)', () => {
    const {seed, L} = found[0];
    const again = gen(seed);
    expect(JSON.stringify(skywaysConSnacksOf(again)!.map(q => [q.index, q.pickup]))).toBe(JSON.stringify(skywaysConSnacksOf(L)!.map(q => [q.index, q.pickup])));
    const snack = skywaysConSnacksOf(L)![0];
    // the section was left once with that snack taken: the memory lists what is left (every other generated pickup)
    const mem = createMemory({level: 'skyways', section: 'main'} as never);
    mem.visits = 1;
    mem.pickups = L.pickups.map((p, i) => ({stack: {itemId: p.itemId, count: p.count}, pose: {p: [p.x, p.y, p.z] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number]},
      anchor: [p.x, p.y, p.z] as [number, number, number], layoutIndex: i})).filter(q => q.layoutIndex !== snack.index);
    expect(takenLayoutPickups(L.pickups.length, mem)).toEqual([snack.index]);
    const plan = pickupPlan(L.pickups.length, mem);
    expect(plan.fromLayout).toEqual([]);
    expect(plan.restored.some(q => q.layoutIndex === snack.index)).toBe(false);
    // the dresser's record agrees with the add-on result
    expect(skywaysAddonDressOf(L)!.snacks!.pickupIndex).toEqual(skywaysConSnacksOf(L)!.map(q => q.index));
  });

  it('version gate: a station entered at layout version 3 regenerates without the snacks', () => {
    for (const {seed} of found.slice(0, 2)) {
      const L3 = gen(seed, 3);
      expect(skywaysConSnacksOf(L3), `seed ${seed} v3`).toBeUndefined();
      expect(skywaysAddonDressOf(L3)?.snacks).toBeUndefined();
      // no convention-table pickups at all on version 3 (the only edible loose finds are the ramen restaurant's)
      const tables = new Set(L3.props.map((p, i) => (p.kind === 'skywaysConMerchTable' ? i : -1)).filter(i => i >= 0));
      for (const p of L3.pickups) for (const i of tables) {
        const t = L3.props[i];
        expect(Math.abs(p.x - t.x) <= t.hx && Math.abs(p.z - t.z) <= t.hz && Math.abs(p.y - (t.y + SKYWAYS_MERCH_TOP.y)) < 0.05, `seed ${seed} v3: ${p.itemId} on a table`).toBe(false);
      }
    }
  });
});
