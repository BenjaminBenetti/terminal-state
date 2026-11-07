// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-A (B)): the Skyways DESTINATION anchor shops of the books / outfitter /
// music / hobby / design families (gen/skyways/destinations/shopsA.ts, the kit skywaysShopsAKit.ts, the kinds kindsShopsA.ts), on REAL
// generated layouts (LEVELS.skyways.generate):
//  - every kind is classified in both audits with live physics matching its row, its footprint / support heights from the kit table;
//  - each family's signature pieces are in its anchor (the two-level bookshop's READING ROOM, the outfitter's hung canoe over a clear
//    underside and its campsite, the music store's bins / guitars / stage corner / booths, the hobby shop's diorama with its viewing
//    ring and the robot at the entry, the design store's room sets);
//  - everything is inside the anchor's areas, supported (floor y, or a static host's measured support), hosted items inside their host
//    and never overlapping, floor props never overlapping;
//  - the reserved lanes (entry -> every door / zone / the stair mouth / the main aisle) stay clear and wide;
//  - the anchors' loot holders are present and roll finite loot; the level validates and regenerates identically.
// (task studio-alpha-skyways-shops-20261107-054512-01) these describe the GAME77 (layout version 2) dressers, frozen in gen/skyways/legacy77/:
// the layouts are generated at version 2 and the dress records / validation read from the frozen modules. Version 3's major stores: tests/skyways-store-*.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {skywaysIssues} from '../src/gen/skyways/legacy77/validate';
import {FLOOR} from '../src/gen/grid';
import {PROP_DEFS, SHELF_TIER_Y, SHOP_COUNTER_TOP_Y, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE, PHYS_MATS, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {dynamicKind} from '../src/physics/dynamicItems';
import {SKYWAYS_DEST_PROPS} from '../src/assets/skywaysDestProps.generated';
import {SHOPS_A_KINDS, SHOPS_A_MODEL, SHOPS_A_SPECS, bookTableTiers, bookcaseShelves, canoeHangY, destDims} from '../src/gen/skyways/destinations/kindsShopsA';
import {BOOK_STACK_BUDGET, CANOE_CLEAR, SHOPS_A_FAMILIES, skywaysShopsADressOf, type ShopsAResult} from '../src/gen/skyways/legacy77/destinations/shopsA';
import {SHOPS_A_LANE_HALF} from '../src/gen/skyways/legacy77/destinations/skywaysShopsAKit';
import {DEST_POSTER, DEST_POSTERS_OF} from '../src/gen/skyways/legacy77/destinations/art';
import {lootProfile} from '../src/items/lootTables';
import {layoutHolderDetails} from './helpers/lootEconomy';

// seeds where this lane's five families occur in every format they take (books hall / two-level, outfitter hall / double-height,
// music hall / multi-zone, hobby hall, design hall / two-level)
const SEEDS = [2, 3, 4, 5, 6, 9, 12];
const cache = new Map<number, StationLayout>();
// (task studio-skyways-rework-20261107-054512-01) these dressers' GAME77 output, on the stations entered before the rework: layout version 2
// through the frozen generator (gen/skyways/legacy77/). The reworked stores (layout version 3) are the store lanes' own tests.
const gen = (s: number): StationLayout => { let l = cache.get(s); if (!l) cache.set(s, (l = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol', layoutVersion: 2} as never))); return l; };
const anchorsOf = (l: StationLayout) => skywaysShopsADressOf(l).map(r => ({r, an: l.skyways!.anchors!.find(a => a.id === r.anchor)!}));
const all = () => SEEDS.flatMap(s => anchorsOf(gen(s)).map(x => ({...x, l: gen(s), seed: s})));
const kindsIn = (l: StationLayout, r: ShopsAResult) => { const m: Record<string, number> = {}; for (const i of r.props) m[l.props[i].kind] = (m[l.props[i].kind] ?? 0) + 1; return m; };
const EPS = 0.011;
const boxHit = (a: PropPlacement, b: PropPlacement) => Math.abs(a.x - b.x) < a.hx + b.hx - EPS && Math.abs(a.z - b.z) < a.hz + b.hz - EPS;

describe('Skyways destinations SHOPS-A: the kinds', () => {
  it('every kind is classified (damage, physics audit with the live body, openables) and sized from the kit table', () => {
    const open = new Map(OPENABLE_AUDIT.map(r => [r.kind, r]));
    for (const k of SHOPS_A_KINDS) {
      expect(k, k).toMatch(/^skyD[A-Za-z]+$/);
      const def = PROP_DEFS[k], spec = SHOPS_A_SPECS[k], m = SKYWAYS_DEST_PROPS[SHOPS_A_MODEL[k]];
      expect(def, k).toBe(spec.def);
      expect(m, k).toBeTruthy();
      expect(def.w, k).toBeCloseTo(m.w, 2);
      expect(def.d, k).toBeCloseTo(m.d, 2);
      // the tiered table's box stops at its top tier (its hollow column's lip is drawn by the model); every other kind is the model's
      expect(def.h, k).toBeCloseTo(k === 'skyDBookTable' ? bookTableTiers().at(-1)!.y : m.h, 2);
      expect(PROP_DAMAGE[k], k).toBeTruthy();
      const row = PROP_PHYSICS_AUDIT[k];
      expect(row, k).toBeTruthy();
      expect(row.how.length, k).toBeGreaterThan(20);
      expect(row.cls === 'dynamic', k).toBe(spec.phys.dynamic);
      expect(dynamicKind(k), k).toBe(spec.phys.dynamic);
      if (spec.phys.dynamic) {
        const ph = propPhysics(k);
        expect(ph.mass, k).toBe(spec.phys.mass);
        expect(ph.mass, k).toBeGreaterThan(0.5);
        expect(ph.mass, k).toBeLessThanOrEqual(30); // nothing heavy is shoved by a walker (the ~30 kg no-castor line)
        expect(Object.keys(PHYS_MATS), k).toContain(ph.mat);
        expect(ph.contact, k).toBe(true);
        expect(['pad', 'castor'], k).toContain(ph.mat); // floor-standing or on-host: the calibrated contact material
      } else expect(spec.phys.why, k).toBeTruthy();
      const o = open.get(k);
      expect(o, k).toBeTruthy();
      expect(['none', 'exception'], k).toContain(o!.cls);
      expect(o!.how.length, k).toBeGreaterThan(15);
    }
  });

  it('the support heights come from the measured kit rows (bookcase shelves, the table tiers, the canoe hanging point)', () => {
    const bc = destDims('skyDBookcase'), tb = destDims('skyDBookTable');
    if (bc.shelfY) expect(bookcaseShelves()).toEqual(bc.shelfY.map(v => Math.round(v * 1000) / 1000));
    if (tb.tierY) expect(bookTableTiers().map(t => t.y)).toEqual(tb.tierY.map(v => Math.round(v * 1000) / 1000));
    expect(canoeHangY()).toBeCloseTo(destDims('skyDCanoe').hangY ?? destDims('skyDCanoe').h, 3);
    // a book stack clears at least four of the six shelf bays, the bottom tier takes stacks, the lantern / kits fit their supports
    const s = bookcaseShelves(), st = PROP_DEFS.skyDBookStack;
    expect(s.filter((y, i) => (s[i + 1] ?? bc.h - 0.12) - y >= st.h + 0.03).length).toBeGreaterThanOrEqual(4);
    expect(PROP_DEFS.skyDModelKits.h).toBeLessThan(SHELF_TIER_Y[1] - SHELF_TIER_Y[0] - 0.03);
    expect(PROP_DEFS.skyDLantern.h).toBeLessThan(SHELF_TIER_Y[2] - SHELF_TIER_Y[1] - 0.03);
  });
});

describe('Skyways destinations SHOPS-A: the dressed anchors', () => {
  it('the sample covers every family and its formats; the levels validate', () => {
    const seen = new Set<string>();
    for (const s of SEEDS) {
      expect(skywaysIssues(gen(s)), `seed ${s}`).toEqual([]);
      for (const {r} of anchorsOf(gen(s))) seen.add(`${r.family}:${r.format}`);
    }
    for (const f of SHOPS_A_FAMILIES) expect([...seen].some(x => x.startsWith(f + ':')), f).toBe(true);
    for (const x of ['books:two-level', 'books:hall', 'outfitter:double-height', 'outfitter:hall', 'music:multi-zone', 'music:hall', 'design:two-level', 'design:hall']) expect(seen.has(x), x).toBe(true);
  });

  it("each family's signature pieces are in its anchor", () => {
    for (const {r, an, l, seed} of all()) {
      const k = kindsIn(l, r), tag = `seed ${seed} ${r.family} ${r.format}`;
      expect(k.shopCounter ?? 0, `${tag}: counter`).toBeGreaterThanOrEqual(1);
      expect(k.skyDPoster ?? 0, `${tag}: posters`).toBeGreaterThanOrEqual(2);
      for (const i of r.props) if (l.props[i].kind === 'skyDPoster') expect(DEST_POSTERS_OF[r.family], tag).toContain(l.props[i].variant);
      const other = an.upper !== undefined ? (l.areas[an.upper].level ?? 0) : null;
      const onOther = (kind: string) => r.props.filter(i => l.props[i].kind === kind && (l.props[i].level ?? 0) === other).length;
      switch (r.family) {
        case 'books':
          expect(k.skyDBookcase ?? 0, tag).toBeGreaterThanOrEqual(10);
          expect(k.skyDBookTable ?? 0, tag).toBeGreaterThanOrEqual(2);
          expect(k.skyDBookStack ?? 0, tag).toBeGreaterThanOrEqual(40);
          expect(k.skyDBookStack ?? 0, tag).toBeLessThanOrEqual(BOOK_STACK_BUDGET);
          expect(k.skyDWingbackChair ?? 0, tag).toBeGreaterThanOrEqual(2);
          if (other !== null) { expect(onOther('skyDWingbackChair'), `${tag}: the reading room`).toBeGreaterThanOrEqual(4); expect(onOther('skyDBookcase'), tag).toBeGreaterThanOrEqual(4); }
          break;
        case 'outfitter':
          expect(k.skyDTent, tag).toBe(1);
          expect(k.skyDCanoe, tag).toBe(1);
          expect(k.skyDCampChair ?? 0, tag).toBeGreaterThanOrEqual(2);
          expect(k.skyDLantern ?? 0, tag).toBeGreaterThanOrEqual(4);
          expect(k.skyDBackpack ?? 0, tag).toBeGreaterThanOrEqual(4);
          expect(r.canoe?.cable ?? -1, tag).toBeGreaterThanOrEqual(0);
          break;
        case 'music':
          expect(k.skyDRecordBins ?? 0, tag).toBeGreaterThanOrEqual(4);
          expect(k.skyDRecordCrate ?? 0, tag).toBeGreaterThanOrEqual(3);
          expect(k.skyDGuitar ?? 0, tag).toBeGreaterThanOrEqual(4);
          expect([k.skyDPiano, k.skyDAmpStack, k.skyDDrumKit], `${tag}: the stage corner`).toEqual([1, 1, 1]);
          for (const z of an.zones) expect(r.props.some(i => l.props[i].area === z && ['loungeArmchair', 'beanBag'].includes(l.props[i].kind)), `${tag}: booth ${z} seat`).toBe(true);
          break;
        case 'hobby':
          expect(k.skyDDiorama, tag).toBe(1);
          expect(k.skyDToyRobot, tag).toBe(1);
          expect(k.skyDModelKits ?? 0, tag).toBeGreaterThanOrEqual(8);
          expect((k.skyDAirshipModel ?? 0) + (k.shipModel ?? 0), `${tag}: sideboard exhibits`).toBeGreaterThanOrEqual(2);
          break;
        case 'design':
          for (const s of ['skyDSofa', 'skyDEggChair', 'skyDArcLamp', 'skyDDiningTable', 'skyDShowroomBed']) expect(k[s] ?? 0, `${tag}: ${s}`).toBeGreaterThanOrEqual(1);
          expect(k.cafeChair ?? 0, tag).toBeGreaterThanOrEqual(4);
          if (other !== null) expect(onOther('skyDSofa') + onOther('skyDShowroomBed') + onOther('skyDDiningTable'), `${tag}: room sets upstairs`).toBeGreaterThanOrEqual(2);
          break;
      }
      expect(r.skipped.filter(s => !s.startsWith('design: no') && !/booth|nook|corner|guitar wall|lane to/.test(s)), tag).toEqual([]);
    }
  });

  it('everything is inside the anchor, supported (floor / a static host support), and nothing overlaps', () => {
    const SUP: Record<string, () => number[]> = {
      skyDBookcase: bookcaseShelves, skyDBookTable: () => bookTableTiers().map(t => t.y), shopCounter: () => [SHOP_COUNTER_TOP_Y],
      shelf: () => SHELF_TIER_Y, cabinetLow: () => [PROP_DEFS.cabinetLow.h],
    };
    for (const {r, an, l, seed} of all()) {
      const tag = `seed ${seed} ${r.family}`;
      const own = new Set<number>([an.floor, ...an.zones, ...(an.upper !== undefined ? [an.upper] : [])]);
      for (const a of l.areas) if (a.parent !== undefined && (a.parent === an.floor || a.parent === an.upper) && a.type === 'shop') own.add(a.id);
      const floorProps: PropPlacement[] = [];
      const byHost = new Map<number, PropPlacement[]>();
      for (const i of r.props) {
        const p = l.props[i];
        expect(own.has(p.area), `${tag}: ${p.kind} area ${p.area}`).toBe(true);
        const lv = p.level ?? 0, g = l.levels[lv].grid, [cx, cy] = g.cellOf(p.x, p.z);
        expect(lv, `${tag}: ${p.kind} storey`).toBe(l.areas[p.area].level ?? 0);
        if (p.host !== undefined) {
          const h = l.props[p.host];
          expect(r.props.includes(p.host) || h.kind === 'shopCounter', `${tag}: ${p.kind} host`).toBe(true);
          expect(dynamicKind(h.kind), `${tag}: ${p.kind} on a dynamic ${h.kind}`).toBe(false);
          const tops = SUP[h.kind]?.() ?? [];
          expect(tops.some(t => Math.abs(p.y - (h.y + t)) < 0.002), `${tag}: ${p.kind} at ${p.y} on ${h.kind} (${h.y} + ${tops})`).toBe(true);
          expect(Math.abs(p.x - h.x) + 0.0 <= h.hx + 0.01 && Math.abs(p.z - h.z) <= h.hz + 0.01, `${tag}: ${p.kind} inside its host's top`).toBe(true);
          byHost.set(p.host, [...(byHost.get(p.host) ?? []), p]);
          continue;
        }
        if (p.kind === 'skyDCanoe') {
          // hung: a clear underside >= 2.3 m, nothing standing below reaching within CANOE_CLEAR, no cell over a stair
          const fl = g.floorOf(g.idx(cx, cy));
          expect(p.mounted, tag).toBe(true);
          expect(p.y - fl, `${tag}: canoe underside`).toBeGreaterThanOrEqual(2.3);
          for (const q of l.props) if (q !== p && (q.level ?? 0) === lv && !q.mounted && boxHit(p, q)) expect(q.y + q.h, `${tag}: ${q.kind} under the canoe`).toBeLessThanOrEqual(p.y - CANOE_CLEAR + 1e-6);
          continue;
        }
        if (p.kind === 'skyDPoster') {
          const fl = g.floorOf(g.idx(cx, cy));
          expect(p.mounted, tag).toBe(true);
          expect(p.y - fl + p.h / 2, `${tag}: poster centre height`).toBeCloseTo(DEST_POSTER.y, 2);
          continue;
        }
        expect(g.cells[g.idx(cx, cy)], `${tag}: ${p.kind} on floor`).toBe(FLOOR);
        expect(Math.abs(p.y - g.floorOf(g.idx(cx, cy))), `${tag}: ${p.kind} at y ${p.y}`).toBeLessThan(0.002);
        floorProps.push(p);
      }
      // floor props: no two overlap (and none overlaps another pass's floor prop on the anchor's storeys)
      for (let a = 0; a < floorProps.length; a++) for (let b = a + 1; b < floorProps.length; b++) {
        const p = floorProps[a], q = floorProps[b];
        if ((p.level ?? 0) === (q.level ?? 0)) expect(boxHit(p, q), `${tag}: ${p.kind} x ${q.kind} at ${p.x},${p.z}`).toBe(false);
      }
      const mine = new Set(floorProps);
      for (const q of l.props) if (!mine.has(q) && !q.mounted && q.host === undefined && own.has(q.area)) for (const p of floorProps) if ((p.level ?? 0) === (q.level ?? 0)) expect(boxHit(p, q), `${tag}: ${p.kind} x ${q.kind}`).toBe(false);
      // hosted items on one host never overlap each other
      for (const [, items] of byHost) for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
        const p = items[a], q = items[b];
        const yOver = p.y < q.y + q.h - EPS && q.y < p.y + p.h - EPS;
        expect(yOver && boxHit(p, q), `${tag}: ${p.kind} x ${q.kind} on one host`).toBe(false);
      }
    }
  });

  it('the lanes from the entry to every door / zone / the stair mouth stay clear and wide', () => {
    for (const {r, an, l, seed} of all()) {
      const tag = `seed ${seed} ${r.family}`;
      // a lane to every non-storefront door of the entrance storey and (two-level) to the stair mouth
      const doors = l.doors.filter(d => !d.shopfront && (d.a === an.floor || d.b === an.floor));
      expect(r.lanes.filter(q => q.to === 'door' || q.to === 'zone').length, `${tag}: door lanes`).toBe(doors.length);
      if (an.format === 'two-level') expect(r.lanes.some(q => q.to === 'stair'), `${tag}: stair lane`).toBe(true);
      for (const lane of r.lanes) {
        expect(lane.narrow, tag).toBeUndefined();
        expect(2 * lane.half).toBeGreaterThanOrEqual(1.2);
        expect(lane.half).toBe(SHOPS_A_LANE_HALF);
        // no standing prop (any pass) intrudes into the lane band
        for (const p of l.props) {
          if ((p.level ?? 0) !== lane.level || p.mounted || p.host !== undefined || p.kind === 'shopGlazing') continue;
          for (let k = 1; k < lane.pts.length; k++) {
            const [ax, az] = lane.pts[k - 1], [bx, bz] = lane.pts[k];
            // the prop box's nearest point to the segment
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
            for (let t = 0; t <= n; t++) {
              const x = ax + (bx - ax) * t / n, z = az + (bz - az) * t / n;
              const dx = Math.max(0, Math.abs(x - p.x) - p.hx), dz = Math.max(0, Math.abs(z - p.z) - p.hz);
              // (lane cells: every cell centre within the half width of the centre line; a prop box may reach 4 cm into a cell)
              expect(Math.hypot(dx, dz), `${tag}: ${p.kind} in the ${lane.to} lane at ${x.toFixed(2)},${z.toFixed(2)}`).toBeGreaterThan(0.65);
            }
          }
        }
      }
    }
  });

  it('the anchors hold loot holders (existing kinds, the family purpose) that roll finite loot', () => {
    const lots: Record<string, number> = {};
    for (const s of SEEDS) {
      const l = gen(s), holders = layoutHolderDetails(l, lootProfile('skyways'));
      for (const {r, an} of anchorsOf(l)) {
        const set = new Set(r.props.map(i => l.props[i]));
        const mine = holders.filter(h => set.has(h.prop));
        expect(mine.length, `seed ${s} ${r.family}: holders`).toBeGreaterThanOrEqual(2);
        for (const h of mine) {
          expect(h.lots.length, `${r.family} ${h.kind}`).toBeLessThanOrEqual(16);
          // they roll the family's base purpose (no new item lists)
          expect(h.areaType, `${r.family} ${h.kind}`).toBe(l.areas[an.floor].purpose);
        }
        lots[r.family] = (lots[r.family] ?? 0) + mine.reduce((n, h) => n + h.lots.length, 0);
      }
    }
    // the newsstand / convenience families (books, outfitter) stock food / drink on their counters / coolers / shelving
    expect(lots.books, 'books').toBeGreaterThan(0);
    expect(lots.outfitter, 'outfitter').toBeGreaterThan(0);
  });

  it('regenerates identically', () => {
    const s = 5, a = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol', layoutVersion: 2} as never);
    const pick = (l: StationLayout) => skywaysShopsADressOf(l).map(r => r.props.map(i => l.props[i]));
    expect(JSON.stringify(pick(a))).toBe(JSON.stringify(pick(gen(s))));
  });
});
