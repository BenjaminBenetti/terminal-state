// Task mall-lingerie-20261102 (lane STORE): the lingerie boutique — a LARGE-unit-only side program (a chance per mall, never guaranteed,
// never moving another shop's assignment), its walk-in changing area (>= 4 curtained booths along a 1.5 m aisle, entered through a 1.5 m
// opening; MallShop.changing rects for lane CONTEXT), its themed loot purposes, its fixtures' audits and the display-set seam to lane FIT.
// Generated malls: a small fixed sample of real levels (natural + forced on large units) + the synthetic lot-family storey for the
// assignment-level properties over many seeds.
import {describe, expect, it} from 'vitest';
import {Rng} from '../src/core/rng';
import {CELL, FLOOR, PathFinder} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {PROP_DEFS} from '../src/gen/props';
import {purposeById} from '../src/gen/purposes';
import type {StationLayout} from '../src/gen/stationTypes';
import type {MallProgram, MallShop} from '../src/gen/mall/mallTypes';
import {MALL_ALWAYS, MALL_ASSIGN_STATS, MALL_PROGRAMS, MALL_ROTATION, SIDE_PROGRAMS, assignMallPrograms, shopFit} from '../src/gen/mall/shops';
import {MALL_LOTS, MALL_LOT_IDS, lotSuits, lotsForProgram} from '../src/gen/mall/lots';
import {LINGERIE_SET_KINDS, LINGERIE_SET_Y0, MALL_OPEN_AUDIT, MALL_PHYS, MALL_RIDER_KINDS} from '../src/gen/mall/kinds';
import {CHANGING, LINGERIE_DESIGNS, LINGERIE_DISPLAY_SOURCE, lingerieDisplayModelKeys} from '../src/gen/mall/lingerieStore';
import {dressMallShops} from '../src/gen/mall/shopsDress';
import {generateMallLevel} from '../src/gen/mall/index';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {ridesHost} from '../src/damage/materials';
import {dynamicKind} from '../src/physics/dynamicItems';
import {mallLotsFixture} from './helpers/mallShopsFixture';

const LARGE = ['standard-line', 'end-unit'] as const;
const SMALL = ['kiosk-cell', 'food-counter', 'compact-square', 'narrow-boutique', 'recessed-arcade'] as const;
const NEW_KINDS = ['fittingPartition', 'fittingBackPanel', 'fittingBench', 'fittingMirror', 'fittingCurtain', 'lingerieBust', ...Object.values(LINGERIE_SET_KINDS)] as const;
const BOOTH_KINDS = ['fittingPartition', 'fittingBackPanel', 'fittingBench', 'fittingMirror', 'fittingCurtain'] as const;

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
    expect(d.min.width).toBeGreaterThanOrEqual((CHANGING.pitch * CHANGING.minBooths + 1 + CHANGING.entryCols) * CELL);
    expect(d.min.depth).toBeGreaterThanOrEqual(3.5 + 5);
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

function checkChanging(L: StationLayout, s: MallShop, tag: string): void {
  const a = L.areas[s.area], lv = a.level ?? 0, g = L.levels[lv].grid;
  expect(s.changing, `${tag}: changing area recorded`).toBeDefined();
  const rects = s.changing!, booths = rects.slice(0, -1), aisle = rects[rects.length - 1];
  expect(booths.length, `${tag}: booths`).toBeGreaterThanOrEqual(CHANGING.minBooths);
  expect(booths.length).toBeLessThanOrEqual(CHANGING.maxBooths);
  // aisle >= 1.2 m clear across, a booth 1.0 m (nav) x 1.5 m of free floor
  expect(Math.min(aisle.x1 - aisle.x0, aisle.z1 - aisle.z0), `${tag}: aisle width`).toBeGreaterThanOrEqual(1.2);
  for (const b of booths) expect([Math.min(b.x1 - b.x0, b.z1 - b.z0), Math.max(b.x1 - b.x0, b.z1 - b.z0)]).toEqual([1.0, 1.5]);
  // inside the shop's sales floor, every cell walkable (nothing else landed in the changing area)
  const ax0 = a.x * CELL, az0 = a.y * CELL, ax1 = (a.x + a.w) * CELL, az1 = (a.y + a.h) * CELL;
  for (const r of rects) {
    expect(r.x0 >= ax0 - 1e-6 && r.z0 >= az0 - 1e-6 && r.x1 <= ax1 + 1e-6 && r.z1 <= az1 + 1e-6, `${tag}: rect inside the shop`).toBe(true);
    for (const i of rectCells(L, s, r)) {
      expect(g.cells[i], `${tag}: floor`).toBe(FLOOR);
      expect(g.area[i], `${tag}: the shop's sales floor`).toBe(s.area);
      expect(g.blocked[i], `${tag}: walkable`).toBe(0);
    }
  }
  // booths are SEPARATE: a booth's free cells touch no other booth's (a partition between them), each opens onto the aisle
  const cellsOf = booths.map(b => new Set(rectCells(L, s, b)));
  const aisleCells = new Set(rectCells(L, s, aisle));
  for (let k = 0; k < cellsOf.length; k++) {
    let opens = 0;
    for (const i of cellsOf[k]) for (const n of [i - 1, i + 1, i - g.w, i + g.w]) {
      for (let j = 0; j < cellsOf.length; j++) if (j !== k) expect(cellsOf[j].has(n), `${tag}: booth ${k} touches booth ${j}`).toBe(false);
      if (aisleCells.has(n)) opens++;
    }
    expect(opens, `${tag}: booth ${k} opening cells`).toBeGreaterThanOrEqual(1);
    expect(opens, `${tag}: booth ${k} opening <= 4 cells`).toBeLessThanOrEqual(4);
  }
  // the fixtures: n + 1 partitions, a back panel / bench / mirror / curtain per booth, all static
  const mine = L.props.filter(p => p.area === s.area);
  const n = booths.length;
  expect(mine.filter(p => p.kind === 'fittingPartition').length).toBe(n + 1);
  for (const k of ['fittingBackPanel', 'fittingBench', 'fittingCurtain'] as const) expect(mine.filter(p => p.kind === k).length, `${tag}: ${k}`).toBe(n);
  // a mirror inside every booth (on its partition face); the sales floor may hang more full-length mirrors on its walls
  const booth = (p: {x: number; z: number}, b: {x0: number; z0: number; x1: number; z1: number}) => p.x > b.x0 - 0.3 && p.x < b.x1 + 0.3 && p.z > b.z0 - 0.3 && p.z < b.z1 + 0.3;
  for (const b of booths) expect(mine.filter(p => p.kind === 'fittingMirror' && booth(p, b)).length, `${tag}: booth mirror`).toBeGreaterThanOrEqual(1);
  for (const p of mine.filter(p => (BOOTH_KINDS as readonly string[]).includes(p.kind))) {
    expect(dynamicKind(p.kind)).toBe(false);
    expect(p.y).toBeCloseTo(a.floorY ?? 0, 3);
    expect(p.h).toBeCloseTo(PROP_DEFS[p.kind].h, 6);
  }
  // reachable for the player and the enemy nav: from the opening (sales-floor side) to every booth and along the aisle
  const [ex, ez] = [s.changingEntry!.x, s.changingEntry!.z];
  const [ecx, ecy] = g.cellOf(ex, ez);
  expect(g.walkable(ecx, ecy) || g.walkable(...g.cellOf(ex, ez + CELL / 2)) || g.walkable(...g.cellOf(ex, ez - CELL / 2)) || g.walkable(...g.cellOf(ex + CELL / 2, ez))
    || g.walkable(...g.cellOf(ex - CELL / 2, ez)), `${tag}: opening walkable`).toBe(true);
  const seen = new Uint8Array(g.w * g.h), stack: number[] = [];
  for (let i = 0; i < g.w * g.h; i++) if (g.area[i] === s.area && g.cells[i] === FLOOR && !g.blocked[i]) { stack.push(i); seen[i] = 1; break; }
  while (stack.length) {
    const c = stack.pop()!;
    for (const n2 of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n2] && g.area[n2] === s.area && g.cells[n2] === FLOOR && !g.blocked[n2]) { seen[n2] = 1; stack.push(n2); }
  }
  for (const r of rects) for (const i of rectCells(L, s, r)) expect(seen[i], `${tag}: changing cell connected to the sales floor`).toBe(1);
  const pf = new PathFinder(levelsOf(L)), fy = a.floorY ?? L.levels[lv].baseY;
  // an enemy route (radius 0.34 like the mall AI tests) from the sales floor in front of the opening into every booth and down the aisle
  const [sx, sz] = [ex, ez];
  for (const t of [...booths, aisle]) {
    const path = pf.find(sx, sz, (t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2, 0.34, 60000, {ay: fy + 0.05, by: fy + 0.05});
    expect(path, `${tag}: enemy path from the opening into ${t === aisle ? 'the aisle' : 'a booth'}`).not.toBeNull();
  }
  // at the back of the store: every changing cell >= 4 m deep from the shopfront line
  const f = s.frontage, along = f.side === 'N' || f.side === 'S', line = along ? (f.z0 + f.z1) / 2 : (f.x0 + f.x1) / 2;
  for (const r of rects) expect(Math.min(Math.abs((along ? r.z0 : r.x0) - line), Math.abs((along ? r.z1 : r.x1) - line)), `${tag}: off the shopfront`).toBeGreaterThanOrEqual(4 - 1e-6);
}

describe('the walk-in changing area (generated malls)', () => {
  it('natural boutiques: >= 4 separate curtained booths along a >= 1.2 m aisle, walkable / connected, rects inside the shop', () => {
    for (const seed of WITH) {
      const L = mall(seed), ls = lingerieShops(L);
      expect(ls.length, `seed ${seed}`).toBe(1);
      checkChanging(L, ls[0], `seed ${seed} ${ls[0].id}`);
    }
  });

  it('forced on standard-line / end units of other malls: the changing area always fits (the min size guarantee)', () => {
    let n = 0;
    for (const seed of [40595, 111866]) {
      const base = mall(seed);
      for (const s of base.mall!.shops.filter(q => (LARGE as readonly string[]).includes(q.lot!) && q.program !== 'lingerie').slice(0, 2)) {
        const L = mall(seed, {[s.id]: 'lingerie'});
        const sh = L.mall!.shops.find(q => q.id === s.id)!;
        expect(sh.program).toBe('lingerie');
        checkChanging(L, sh, `seed ${seed} forced ${s.id} (${s.lot} ${s.width} x ${s.depth})`);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('a coherent boutique: themed purposes, window / floor display forms dressed in the six sets, till, drawer chests, mirrors; sets only there', () => {
    for (const seed of WITH) {
      const L = mall(seed), s = lingerieShops(L)[0], mine = L.props.filter(p => p.area === s.area);
      expect(L.areas[s.area].purpose).toBe('mall-lingerie');
      if (s.backroom !== undefined) expect(L.areas[s.backroom].purpose).toBe('mall-lingerie-back');
      expect(L.areas[s.area].label.startsWith(s.brand)).toBe(true);
      expect(MALL_PROGRAMS.lingerie.brands).toContain(s.brand);
      const busts = mine.filter(p => p.kind === 'lingerieBust');
      expect(busts.length, `seed ${seed} display forms`).toBeGreaterThanOrEqual(3);
      const sets = mine.filter(p => (Object.values(LINGERIE_SET_KINDS) as string[]).includes(p.kind));
      expect(sets.length).toBe(busts.length);
      for (const p of sets) {
        const host = L.props[p.host!];
        expect(host.kind).toBe('lingerieBust');
        expect(p.y).toBeCloseTo(host.y + LINGERIE_SET_Y0, 6);
        expect([p.x, p.z, p.rot]).toEqual([host.x, host.z, host.rot]);
      }
      expect(new Set(sets.map(p => p.kind)).size, `seed ${seed} designs shown`).toBeGreaterThanOrEqual(Math.min(3, sets.length));
      expect(mine.some(p => p.kind === 'shopCounter'), `seed ${seed} till`).toBe(true);
      expect(mine.filter(p => p.kind === 'dresserDrawers').length, `seed ${seed} drawer chests`).toBeGreaterThanOrEqual(1);
      expect(mine.filter(p => p.kind === 'fittingMirror').length).toBeGreaterThan(s.changing!.length - 1);
      // the display stock stays in the boutique
      for (const p of L.props) if (p.kind === 'lingerieBust' || (Object.values(LINGERIE_SET_KINDS) as string[]).includes(p.kind)) expect(L.areas[p.area].purpose).toBe('mall-lingerie');
    }
  });
});

describe('fixtures: audits, physics, the display-set seam', () => {
  it('every new kind is classified in both audits with an honest reason; booth pieces static, the form dynamic, the sets ride it', () => {
    for (const k of NEW_KINDS) {
      expect(OPENABLE_AUDIT.filter(e => e.kind === k).length, `${k} openables audit`).toBe(1);
      expect(PROP_PHYSICS_AUDIT[k], `${k} physics audit`).toBeDefined();
      expect(MALL_OPEN_AUDIT[k].cls).toBe('none');
      expect(MALL_OPEN_AUDIT[k].how.length).toBeGreaterThan(20);
    }
    expect(MALL_PHYS.fittingPartition).toMatchObject({dynamic: false, why: 'partition'});
    expect(MALL_PHYS.fittingBackPanel).toMatchObject({dynamic: false, why: 'partition'});
    expect(MALL_PHYS.fittingBench).toMatchObject({dynamic: false, why: 'built-in'});
    expect(MALL_PHYS.fittingMirror).toMatchObject({dynamic: false, why: 'mounted'});
    expect(MALL_PHYS.fittingCurtain).toMatchObject({dynamic: false, why: 'mounted'});
    expect(dynamicKind('lingerieBust')).toBe(true);
    for (const k of Object.values(LINGERIE_SET_KINDS)) {
      expect(MALL_PHYS[k]).toMatchObject({dynamic: false, why: 'host decor'});
      expect(MALL_RIDER_KINDS).toContain(k);
      expect(ridesHost(k)).toBe(true);
    }
    // real-world sizes: panels 2.1 m tall, the bench seat 0.45 m, the mirror glass to 1.85 m, a 1.48 m display form
    expect(PROP_DEFS.fittingPartition.h).toBe(2.1);
    expect(PROP_DEFS.fittingBench.h).toBe(0.45);
    expect(PROP_DEFS.fittingMirror.h).toBe(1.85);
    expect(PROP_DEFS.lingerieBust.h).toBe(1.48);
  });

  it('display sets load lane FIT\'s outfit files by key (only the designs placed) — none for a mall without the boutique', () => {
    expect(LINGERIE_DESIGNS).toEqual(['green', 'purple', 'blush', 'black', 'red', 'ivory']);
    expect(LINGERIE_DISPLAY_SOURCE.modelKey('red')).toBe('outfit_lingerie_red');
    expect(LINGERIE_DISPLAY_SOURCE.nodes('blush')).toEqual(['LingerieDisplay_blush_top', 'LingerieDisplay_blush_bottom']);
    const L = mall(WITH[0]);
    const keys = lingerieDisplayModelKeys(L);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).toMatch(/^outfit_lingerie_(green|purple|blush|black|red|ivory)$/);
    const placed = new Set(L.props.filter(p => (Object.values(LINGERIE_SET_KINDS) as string[]).includes(p.kind)).map(p => p.kind));
    expect(keys.length).toBe(placed.size);
    const none = mallLotsFixture(3).layout;
    assignMallPrograms(none, new Rng(3 * 7919), {sidePrograms: false});
    dressMallShops(none, new Rng(3 ^ 0x5eed), {frame: 'absolute'});
    expect(lingerieDisplayModelKeys(none)).toEqual([]);
  });
});
