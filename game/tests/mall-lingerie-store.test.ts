// Task mall-lingerie-20261102 / store-polish-20261103 (lane STORE): the lingerie boutique — a LARGE-unit-only side program (a chance per
// mall, never guaranteed, never moving another shop's assignment), its changing SUITE carved into the shop with real walls and framed
// doorways (3-4 private rooms off a corridor; MallShop.changing rects for lane CONTEXT), a clothing-store sales floor (rails / round racks /
// clothing bays hung with lingerie, dressed female mannequins — no bare display mannequins, no box forms), its themed loot purposes, its
// fixtures' audits and the display / hanging-stock seam to lane FIT.
// Generated malls: a small fixed sample of real levels (natural + forced on large units) + the synthetic lot-family storey for the
// assignment-level properties over many seeds.
import {describe, expect, it} from 'vitest';
import {Rng} from '../src/core/rng';
import {CELL, FLOOR, SOLID, PathFinder} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {PROP_DEFS} from '../src/gen/props';
import {purposeById} from '../src/gen/purposes';
import type {StationLayout} from '../src/gen/stationTypes';
import type {MallProgram, MallShop} from '../src/gen/mall/mallTypes';
import {MALL_ALWAYS, MALL_ASSIGN_STATS, MALL_PROGRAMS, MALL_ROTATION, SIDE_PROGRAMS, assignMallPrograms, shopFit} from '../src/gen/mall/shops';
import {MALL_LOTS, MALL_LOT_IDS, lotSuits, lotsForProgram} from '../src/gen/mall/lots';
import {GARMENT_RAIL_Y, LINGERIE_RACK, LINGERIE_SET_KINDS, LINGERIE_SET_Y0, MALL_OPEN_AUDIT, MALL_PHYS, MALL_RIDER_KINDS} from '../src/gen/mall/kinds';
import {CHANGING_SUITE, LINGERIE_DESIGNS, LINGERIE_DISPLAY_SOURCE, lingerieDisplayModelKeys, rackCode, rackStock, suiteCols, suiteRows} from '../src/gen/mall/lingerieStore';
import {LINGERIE_HANG_SETS, LINGERIE_MANNEQUIN_MODEL, LINGERIE_MANNEQUIN_SETS, LINGERIE_MODEL_FILES} from '../src/ai/lingerie';
import {dressMallShops} from '../src/gen/mall/shopsDress';
import {generateMallLevel, mallIssues} from '../src/gen/mall/index';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {ridesHost} from '../src/damage/materials';
import {dynamicKind} from '../src/physics/dynamicItems';
import {mallLotsFixture} from './helpers/mallShopsFixture';

const LARGE = ['standard-line', 'end-unit'] as const;
const SMALL = ['kiosk-cell', 'food-counter', 'compact-square', 'narrow-boutique', 'recessed-arcade'] as const;
const NEW_KINDS = ['fittingBench', 'fittingMirror', ...Object.values(LINGERIE_SET_KINDS), 'lingerieRackRow', 'lingerieRackRing'] as const;
/** Kinds the polish deleted (the free-standing booth boxes and the box display form) — never in any layout. */
const GONE = ['fittingPartition', 'fittingBackPanel', 'fittingCurtain', 'lingerieBust'];
const SET_KINDS = Object.values(LINGERIE_SET_KINDS) as string[];
const STOCK = (k: string) => SET_KINDS.includes(k) || k === 'lingerieRackRow' || k === 'lingerieRackRing';

// Real malls: seeds whose natural assignment has the boutique (lanes/STORE.done sample) + seeds without it.
const WITH = [1000, 8919, 24757, 32676];
const cache = new Map<string, StationLayout>();
function mall(seed: number, force?: Record<string, MallProgram>): StationLayout {
  const key = `${seed}:${JSON.stringify(force ?? {})}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = generateMallLevel({levelSeed: seed, startWeapon: 'rifle'}, force ? {shopForce: force} : {})));
  return L;
}
const lingerieShops = (L: StationLayout) => L.mall!.shops.filter(s => s.program === 'lingerie');

describe('catalogue: lingerie is a LARGE-unit side program, never guaranteed', () => {
  it('program record, fictional brands, purposes, large families only (appended last), not always / rotating, at most one per mall', () => {
    const d = MALL_PROGRAMS.lingerie;
    expect(d.recipe).toBe('lingerie');
    expect(d.purpose).toBe('mall-lingerie');
    expect(d.back).toBe('mall-lingerie-back');
    expect(d.weight).toBe(0.6);
    expect(d.count).toEqual([0, 1]);
    expect(d.units).toEqual(['store']);
    expect(d.brands.length).toBeGreaterThanOrEqual(3);
    expect(new Set(d.brands).size).toBe(d.brands.length);
    for (const p of Object.values(MALL_PROGRAMS)) if (p.id !== 'lingerie') for (const b of d.brands) expect(p.brands, b).not.toContain(b);
    expect(lotsForProgram('lingerie')).toEqual([...LARGE]);
    for (const id of SMALL) expect(lotSuits(id, 'lingerie'), id).toBe(false);
    for (const id of ['anchor-deep', 'wide-showroom', 'corner-double'] as const) expect(lotSuits(id, 'lingerie'), id).toBe(false);
    for (const id of LARGE) expect(MALL_LOTS[id].programs.at(-1), `${id}: appended last (no other program's typicality moved)`).toBe('lingerie');
    // the min size guarantees the changing area along the back wall: 4 booths + the opening along the wall, 3.5 m deep + >= 5 m in front
    // the min size takes the changing suite along the back wall: 3 rooms + the passage along the wall, its depth + >= 4.5 m in front
    expect(d.min.width).toBeGreaterThanOrEqual(suiteCols(CHANGING_SUITE.rooms) * CELL);
    expect(d.min.depth).toBeGreaterThanOrEqual(suiteRows(CHANGING_SUITE.corridorRowsShallow) * CELL + 4.5);
    for (const id of LARGE) expect(MALL_LOTS[id].width[0] * MALL_LOTS[id].depth[0], id).toBeGreaterThanOrEqual(d.min.area);
    // the always / rotating catalogue is untouched
    expect(MALL_ALWAYS).toEqual(['guns', 'clothing', 'womenswear', 'pharmacy', 'cafe']);
    expect(MALL_ROTATION).not.toContain('lingerie');
    expect(SIDE_PROGRAMS).toEqual(['lingerie']);
    for (const s of [purposeById('mall-lingerie'), purposeById('mall-lingerie-back')]) expect(s).toBeDefined();
    // the personal theme / tables of the women's fashion store (no economy change)
    expect(purposeById('mall-lingerie')!.theme).toBe('personal');
    expect(JSON.stringify(purposeById('mall-lingerie')!.loot)).toBe(JSON.stringify(purposeById('mall-womenswear')!.loot));
    expect(purposeById('mall-lingerie-back')!.theme).toBe(purposeById('mall-womenswear-back')!.theme);
  });

  it('many synthetic malls: only large units of the right size, never a small bay, at most one, a chance (not guaranteed), and no other shop moves', () => {
    let present = 0, absent = 0;
    const units = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const a = mallLotsFixture(seed).layout, b = mallLotsFixture(seed).layout;
      assignMallPrograms(a, new Rng(seed * 7919), {sidePrograms: false});
      assignMallPrograms(b, new Rng(seed * 7919));
      const side = MALL_ASSIGN_STATS.last!.side!;
      const ling = b.mall!.shops.filter(s => s.program === 'lingerie');
      expect(ling.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      ling.length ? present++ : absent++;
      for (const s of ling) {
        units.add(s.lot!);
        expect(LARGE as readonly string[], `seed ${seed} ${s.id} ${s.lot}`).toContain(s.lot);
        expect(s.kind).toBe('store');
        expect(s.width).toBeGreaterThanOrEqual(MALL_PROGRAMS.lingerie.min.width - 1e-6);
        expect(s.depth).toBeGreaterThanOrEqual(MALL_PROGRAMS.lingerie.min.depth - 1e-6);
        expect(s.salesArea).toBeGreaterThanOrEqual(MALL_PROGRAMS.lingerie.min.area - 1e-6);
        expect(side[0].unit).toBe(s.id);
        // the displaced program: a plain glazed store or a vacant unit, never a gun shop / anchor program / the last of an always-program
        const was = a.mall!.shops.find(q => q.id === s.id)!.program;
        expect(side[0].displaced).toBe(was);
        expect(['guns', 'department', 'grocery']).not.toContain(was);
        if (MALL_ALWAYS.includes(was)) expect(a.mall!.shops.filter(q => q.program === was).length, `${was} kept`).toBeGreaterThanOrEqual(2);
      }
      // every OTHER shop: identical program, kind, brand and fit (finish / sign / shutter / entry) with and without the side program
      for (const s of b.mall!.shops) {
        if (s.program === 'lingerie') continue;
        const o = a.mall!.shops.find(q => q.id === s.id)!;
        expect([s.program, s.kind, s.brand], `seed ${seed} ${s.id}`).toEqual([o.program, o.kind, o.brand]);
        expect(JSON.stringify(shopFit(s)), `seed ${seed} ${s.id} fit`).toBe(JSON.stringify(shopFit(o)));
      }
    }
    console.info(`[lingerie] synthetic malls: ${present} with / ${absent} without the boutique; families ${[...units].join(' ')}`);
    expect(present, 'appears in some malls').toBeGreaterThan(20);
    expect(absent, 'not guaranteed').toBeGreaterThan(10);
    for (const id of MALL_LOT_IDS.filter(q => !(LARGE as readonly string[]).includes(q))) expect(units.has(id), id).toBe(false);
  });
});

/** Every cell centre inside a rect (world m) on the shop's level grid. */
function rectCells(L: StationLayout, s: MallShop, r: {x0: number; z0: number; x1: number; z1: number}): number[] {
  const g = L.levels[L.areas[s.area].level ?? 0].grid, out: number[] = [];
  for (let z = r.z0 + CELL / 2; z < r.z1; z += CELL) for (let x = r.x0 + CELL / 2; x < r.x1; x += CELL) { const [cx, cy] = g.cellOf(x, z); out.push(g.idx(cx, cy)); }
  return out;
}

function checkSuite(L: StationLayout, s: MallShop, tag: string): void {
  const a = L.areas[s.area], lv = a.level ?? 0, g = L.levels[lv].grid, base = a.floorY ?? L.levels[lv].baseY;
  expect(s.changing, `${tag}: changing suite recorded`).toBeDefined();
  const rects = s.changing!, rooms = rects.slice(0, -1), corridor = rects[rects.length - 1];
  expect(rooms.length, `${tag}: rooms`).toBeGreaterThanOrEqual(3);
  expect(rooms.length).toBeLessThanOrEqual(4);
  // a room's free floor 1.0 x 1.5 m (in front of its bench, beside its mirror strip; the room is 1.5 x 2.0 m inside), the corridor >= 1.0 m
  for (const r of rooms) expect([r.x1 - r.x0, r.z1 - r.z0].sort()).toEqual([1.0, 1.5]);
  expect(Math.min(corridor.x1 - corridor.x0, corridor.z1 - corridor.z0), `${tag}: corridor width`).toBeGreaterThanOrEqual(1.0);
  // inside the shop, every rect cell walkable floor of the sales area (nothing else landed in the suite)
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  for (const r of rects) {
    expect(r.x0 >= ax0 - 1e-6 && r.z0 >= az0 - 1e-6 && r.x1 <= ax1 + 1e-6 && r.z1 <= az1 + 1e-6, `${tag}: rect inside the shop`).toBe(true);
    for (const i of rectCells(L, s, r)) {
      expect(g.cells[i], `${tag}: floor`).toBe(FLOOR);
      expect(g.area[i], `${tag}: the shop's sales floor`).toBe(s.area);
      expect(g.blocked[i], `${tag}: walkable`).toBe(0);
    }
  }
  // REAL ROOMS: each room's free floor is enclosed by SOLID wall cells, its own bench and ONE 2-cell doorway (a framed door record with
  // its lowered lintel ceiling) onto the corridor; no two rooms touch
  const roomCells = rooms.map(r => new Set(rectCells(L, s, r))), corridorCells = new Set(rectCells(L, s, corridor));
  const suiteDoors = L.doors.filter(d => d.a === s.area && d.b === s.area);
  expect(suiteDoors.length, `${tag}: room doorways + the suite doorway`).toBe(rooms.length + 1);
  const doorCells = new Set<number>();
  for (const d of suiteDoors) {
    expect(d.w === 1 || d.h === 1).toBe(true);
    for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
      const i = g.idx(x, y);
      doorCells.add(i);
      expect(g.cells[i]).toBe(FLOOR);
      expect(g.ceil[i], `${tag}: doorway lintel`).toBeCloseTo(base + d.height, 3);
      expect(d.height).toBeGreaterThanOrEqual(2.0);
    }
  }
  let walls = 0;
  roomCells.forEach((cells, k) => {
    // the room = every walkable cell reachable from its rect without passing a doorway: small, holding no other room / corridor cell
    const room = new Set(cells), stack = [...cells];
    while (stack.length) {
      const c = stack.pop()!;
      for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!room.has(n) && !doorCells.has(n) && g.cells[n] === FLOOR && g.area[n] === s.area && !g.blocked[n]) { room.add(n); stack.push(n); }
    }
    expect(room.size, `${tag}: room ${k} enclosed`).toBeLessThanOrEqual(CHANGING_SUITE.roomCols * CHANGING_SUITE.roomRows);
    for (const i of room) { expect(corridorCells.has(i), `${tag}: room ${k} open to the corridor`).toBe(false); for (let j = 0; j < roomCells.length; j++) if (j !== k) expect(roomCells[j].has(i)).toBe(false); }
    // its only ways out: its 2-cell framed doorway, opening onto the corridor
    const out = new Set<number>();
    for (const i of room) for (const n of [i - 1, i + 1, i - g.w, i + g.w]) {
      if (room.has(n)) continue;
      if (g.cells[n] === SOLID) { walls++; continue; }
      if (doorCells.has(n)) out.add(n);
    }
    expect(out.size, `${tag}: room ${k} has one 2-cell doorway`).toBe(CHANGING_SUITE.roomDoor);
    for (const n of out) expect([n - 1, n + 1, n - g.w, n + g.w].some(q => corridorCells.has(q)), `${tag}: room ${k} doorway opens onto the corridor`).toBe(true);
    // its bench and its mirror inside (the mirror on the side wall, the bench on the back wall)
    const near = (kind: string) => L.props.some(p => p.kind === kind && p.area === s.area && [...room].some(i => Math.hypot(g.center(i % g.w, Math.floor(i / g.w))[0] - p.x, g.center(i % g.w, Math.floor(i / g.w))[1] - p.z) < 0.8));
    expect(near('fittingBench'), `${tag}: room ${k} bench`).toBe(true);
    expect(near('fittingMirror'), `${tag}: room ${k} mirror`).toBe(true);
    // no ambient-size 3 x 3 clear floor in a room: the rooms are the store-local variants' (lane CONTEXT)
    for (const i of room) {
      const x = i % g.w, y = Math.floor(i / g.w);
      let clear = true;
      for (let oy = -1; oy <= 1 && clear; oy++) for (let ox = -1; ox <= 1; ox++) if (!g.walkable(x + ox, y + oy)) { clear = false; break; }
      expect(clear, `${tag}: room ${k} 3 x 3 clear cell`).toBe(false);
    }
  });
  expect(walls, `${tag}: rooms walled`).toBeGreaterThanOrEqual(rooms.length * 4);
  // furniture: a built-in bench and a mirror per room; the deleted booth boxes / box forms nowhere
  const mine = L.props.filter(p => p.area === s.area);
  expect(mine.filter(p => p.kind === 'fittingBench').length).toBe(rooms.length);
  expect(mine.filter(p => p.kind === 'fittingMirror').length).toBeGreaterThanOrEqual(rooms.length);
  for (const p of L.props) expect(GONE, `${tag}: deleted kind ${p.kind}`).not.toContain(p.kind);
  // the layout validates (no retry caused by the suite: lights stay out of the carved walls, doorways clear)
  expect(mallIssues(L), `${tag}: mall issues`).toEqual([]);
  // reachable for the player and the enemy nav: from the suite doorway into every room and down the corridor
  const pf = new PathFinder(levelsOf(L));
  const [ex, ez] = [s.changingEntry!.x, s.changingEntry!.z];
  for (const t of [...rooms, corridor]) {
    const path = pf.find(ex, ez, (t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, 0.34, 60000, {ay: base + 0.05, by: base + 0.05});
    expect(path, `${tag}: enemy path from the suite doorway into ${t === corridor ? 'the corridor' : 'a room'}`).not.toBeNull();
  }
  // at the back of the store: every changing cell >= 4 m deep from the shopfront line
  const f = s.frontage, along = f.side === 'N' || f.side === 'S', line = along ? (f.z0 + f.z1) / 2 : (f.x0 + f.x1) / 2;
  for (const r of rects) expect(Math.min(Math.abs((along ? r.z0 : r.x0) - line), Math.abs((along ? r.z1 : r.x1) - line)), `${tag}: off the shopfront`).toBeGreaterThanOrEqual(4 - 1e-6);
}

describe('the changing SUITE (generated malls): real rooms with walls and doorways', () => {
  it('natural boutiques: 3-4 walled rooms with framed doorways off a corridor, walkable / connected, validated, rects inside the shop', () => {
    for (const seed of WITH) {
      const L = mall(seed), ls = lingerieShops(L);
      expect(ls.length, `seed ${seed}`).toBe(1);
      checkSuite(L, ls[0], `seed ${seed} ${ls[0].id}`);
    }
  });

  it('forced on standard-line / end units of other malls: the suite always fits (the min size guarantee)', () => {
    let n = 0;
    for (const seed of [40595, 111866]) {
      const base = mall(seed);
      for (const s of base.mall!.shops.filter(q => (LARGE as readonly string[]).includes(q.lot!) && q.program !== 'lingerie').slice(0, 2)) {
        const L = mall(seed, {[s.id]: 'lingerie'});
        const sh = L.mall!.shops.find(q => q.id === s.id)!;
        expect(sh.program).toBe('lingerie');
        checkSuite(L, sh, `seed ${seed} forced ${s.id} (${s.lot} ${s.width} x ${s.depth})`);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('a clothing-store sales floor: rails / round racks / clothing bays hung with lingerie, every mannequin dressed, till, drawers; stock only there', () => {
    for (const seed of WITH) {
      const L = mall(seed), s = lingerieShops(L)[0], mine = L.props.filter(p => p.area === s.area);
      expect(L.areas[s.area].purpose).toBe('mall-lingerie');
      if (s.backroom !== undefined) expect(L.areas[s.backroom].purpose).toBe('mall-lingerie-back');
      expect(L.areas[s.area].label.startsWith(s.brand)).toBe(true);
      expect(MALL_PROGRAMS.lingerie.brands).toContain(s.brand);
      // every female mannequin of the boutique wears a set (no bare display mannequins), a set rides exactly one mannequin
      const mannequins = mine.filter(p => p.kind === 'mannequinFemale');
      expect(mannequins.length, `seed ${seed} mannequins`).toBeGreaterThanOrEqual(2);
      const sets = mine.filter(p => SET_KINDS.includes(p.kind));
      for (const m of mannequins) expect(sets.filter(p => L.props[p.host!] === m).length, `seed ${seed} mannequin dressed`).toBe(1);
      for (const p of sets) {
        const host = L.props[p.host!];
        expect(host.kind).toBe('mannequinFemale');
        expect(p.y).toBeCloseTo(host.y + LINGERIE_SET_Y0, 6);
        expect([p.x, p.z, p.rot]).toEqual([host.x, host.z, host.rot]);
      }
      expect(new Set(sets.map(p => p.kind)).size, `seed ${seed} designs shown`).toBeGreaterThanOrEqual(Math.min(3, sets.length));
      // hanging stock: on rails / round racks / clothing bays, its top on the host's rail, the hem clear of the floor
      const stock = mine.filter(p => p.kind === 'lingerieRackRow' || p.kind === 'lingerieRackRing');
      expect(stock.length, `seed ${seed} hung rails`).toBeGreaterThanOrEqual(1);
      for (const p of stock) {
        const host = L.props[p.host!];
        expect(p.kind === 'lingerieRackRing' ? ['garmentRailRound'] : ['garmentRail', 'clothingWallUnit']).toContain(host.kind);
        const rail = GARMENT_RAIL_Y[host.kind as keyof typeof GARMENT_RAIL_Y]!;
        expect(p.y + p.h).toBeCloseTo(host.y + rail, 6);
        expect(p.y - host.y, `seed ${seed} hem clearance`).toBeGreaterThanOrEqual(0.15);
        expect([p.x, p.z, p.rot]).toEqual([host.x, host.z, host.rot]);
        const st = rackStock(p.variant);
        expect(LINGERIE_DESIGNS).toContain(st.a);
        expect(LINGERIE_DESIGNS).toContain(st.b);
      }
      expect(mine.filter(p => p.kind === 'garmentRail' || p.kind === 'garmentRailRound' || p.kind === 'clothingWallUnit').length, `seed ${seed} racks`).toBeGreaterThanOrEqual(2);
      expect(mine.some(p => p.kind === 'shopCounter'), `seed ${seed} till`).toBe(true);
      // no M06 / women's garment groups in the boutique: its racks carry lingerie
      for (const p of mine) expect(['garmentHangingGroup', 'womensDressesGroup', 'womensBlousesGroup', 'womensSkirtsGroup']).not.toContain(p.kind);
      // a clear way from the entry to the suite doorway: the walk is short (no maze)
      const a = L.areas[s.area], g = L.levels[a.level ?? 0].grid, base = a.floorY ?? 0;
      const f = s.frontage, fx = (f.x0 + f.x1) / 2, fz = (f.z0 + f.z1) / 2;
      const inX = f.side === 'E' ? -1.5 : f.side === 'W' ? 1.5 : 0, inZ = f.side === 'S' ? -1.5 : f.side === 'N' ? 1.5 : 0;
      const sx = fx + inX, sz = fz + inZ;
      void g;
      const path = new PathFinder(levelsOf(L)).find(sx, sz, s.changingEntry!.x, s.changingEntry!.z, 0.34, 60000, {ay: base + 0.05, by: base + 0.05});
      expect(path, `seed ${seed} entry -> suite`).not.toBeNull();
      let len = 0;
      for (let k = 1; k < path!.length; k++) len += Math.hypot(path![k][0] - path![k - 1][0], path![k][1] - path![k - 1][1]);
      expect(len, `seed ${seed} entry -> suite walk`).toBeLessThanOrEqual(Math.abs(sx - s.changingEntry!.x) + Math.abs(sz - s.changingEntry!.z) + 2);
      // the display stock stays in the boutique
      for (const p of L.props) if (STOCK(p.kind)) expect(L.areas[p.area].purpose).toBe('mall-lingerie');
    }
  });
});

describe('fixtures: audits, physics, the display / hanging-stock seam', () => {
  it('every new kind is classified in both audits with an honest reason; booth boxes / box forms deleted; stock rides its host', () => {
    for (const k of NEW_KINDS) {
      expect(OPENABLE_AUDIT.filter(e => e.kind === k).length, `${k} openables audit`).toBe(1);
      expect(PROP_PHYSICS_AUDIT[k], `${k} physics audit`).toBeDefined();
      expect(MALL_OPEN_AUDIT[k].cls).toBe('none');
      expect(MALL_OPEN_AUDIT[k].how.length).toBeGreaterThan(20);
    }
    for (const k of GONE) expect((PROP_DEFS as Record<string, unknown>)[k], k).toBeUndefined();
    expect(MALL_PHYS.fittingBench).toMatchObject({dynamic: false, why: 'built-in'});
    expect(MALL_PHYS.fittingMirror).toMatchObject({dynamic: false, why: 'mounted'});
    expect(dynamicKind('mannequinFemale')).toBe(true);
    for (const k of [...SET_KINDS, 'lingerieRackRow', 'lingerieRackRing'] as const) {
      expect(MALL_PHYS[k as keyof typeof MALL_PHYS]).toMatchObject({dynamic: false, why: 'host decor'});
      expect(MALL_RIDER_KINDS).toContain(k);
      expect(ridesHost(k)).toBe(true);
    }
    // real-world sizes: the bench seat 0.45 m, the mirror to 1.97 m, the stock's longest drop 0.62 m under a rail
    expect(PROP_DEFS.fittingBench.h).toBe(0.45);
    expect(PROP_DEFS.fittingMirror.h).toBe(1.97);
    expect(LINGERIE_RACK.drop).toBeLessThanOrEqual(GARMENT_RAIL_Y.garmentRailRound! - 0.15);
    expect(rackStock(rackCode(4, 1, 777))).toEqual({a: 'red', b: 'purple', seed: 777});
  });

  it('display / hanging stock loads lane FIT\'s outfit files by key (only the designs placed) — none for a mall without the boutique', () => {
    expect(LINGERIE_DESIGNS).toEqual(['green', 'purple', 'blush', 'black', 'red', 'ivory']);
    expect(LINGERIE_DISPLAY_SOURCE.modelKey('red')).toBe('outfit_lingerie_red');
    expect(LINGERIE_DISPLAY_SOURCE.mannequinNodes('blush')).toEqual(['LingerieMannequin_blush_top', 'LingerieMannequin_blush_bottom']);
    // the keys / nodes are exactly lane FIT's exported stock tables (the same files the store-local zombies wear)
    for (const d of LINGERIE_DESIGNS) {
      expect(LINGERIE_MODEL_FILES[LINGERIE_DISPLAY_SOURCE.modelKey(d)], d).toBeDefined();
      const m = LINGERIE_MANNEQUIN_SETS.find(q => q.design === d)!, h = LINGERIE_HANG_SETS.find(q => q.design === d)!;
      expect(LINGERIE_DISPLAY_SOURCE.modelKey(d)).toBe(m.model);
      expect(LINGERIE_DISPLAY_SOURCE.mannequinNodes(d)).toEqual([m.nodes.top, m.nodes.bottom]);
      expect(LINGERIE_DISPLAY_SOURCE.hangItems(d).map(q => q.node)).toEqual(h.items.map(q => q.node));
      // every hung item clears the floor on the lowest rail (the round rack's ring) and fits the rider box
      for (const q of h.items) { expect(q.dropM).toBeLessThanOrEqual(LINGERIE_RACK.drop); expect(GARMENT_RAIL_Y.garmentRailRound! - q.dropM).toBeGreaterThan(0.6); }
    }
    expect(LINGERIE_MANNEQUIN_MODEL).toBe('mannequin-female');
    expect(LINGERIE_DISPLAY_SOURCE.mannequinModelKey).toBe(`office-${LINGERIE_MANNEQUIN_MODEL}`);
    const L = mall(WITH[0]);
    const keys = lingerieDisplayModelKeys(L);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^outfit_lingerie_(green|purple|blush|black|red|ivory)$/);
    const used = new Set<string>();
    for (const p of L.props) {
      if (SET_KINDS.includes(p.kind)) used.add(LINGERIE_DESIGNS[SET_KINDS.indexOf(p.kind)]);
      if (p.kind === 'lingerieRackRow' || p.kind === 'lingerieRackRing') { const r = rackStock(p.variant); used.add(r.a); used.add(r.b); }
    }
    expect(keys).toEqual([...used].map(d => LINGERIE_DISPLAY_SOURCE.modelKey(d)).sort());
    const none = mallLotsFixture(3).layout;
    assignMallPrograms(none, new Rng(3 * 7919), {sidePrograms: false});
    dressMallShops(none, new Rng(3 ^ 0x5eed), {frame: 'absolute'});
    expect(lingerieDisplayModelKeys(none)).toEqual([]);
  });
});
