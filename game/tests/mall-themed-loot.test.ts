// Task mall-round3-20261031 (lane SHOPS, R6 — user: "clothing stores should have higher gear drop chance ... The same idea applies to
// all stores where the theme would reasonably boost spawn chance of associated loot"): THEMED RARE GEAR in the mall.
// The mall's ONE level-wide gear roll is unchanged (count / pieces: GEAR_LOOT); WHERE it lands follows the mall profile's placement
// bias (items/lootTables.ts MALL_GEAR_PLACE = LootTables.gearPlace, read by gen/gearLoot.ts placeGear via levels/registry.ts withGear):
//  - the bias table is valid, mall-only, keyed by real purposes / gear ids; the per-piece affinities hold (work boots -> shoe store,
//    hard hat -> hardware, daypack -> luggage, armour -> gun shop / security rather than boutiques);
//  - on generated malls, gear lands in the wearable-gear shops much more often than elsewhere (real placeGear, bounded sample) and
//    still only in allowed, core spots;
//  - the registry places the mall's gear with the bias; Subway / Office placements are identical with or without their profile.
// Bounded: 3 mall generations (2 sampled + 1 registry-with-gear), 1 Subway, 1 Office; ~200 placeGear calls. (ci-followup 20261101: the f5224bd sampling restored in full; the EXACT first-pick pool checks and the seed-222
// per-piece pools are EXTRA assertions.)

import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {gearAreaWeight, gearPlaceFactor, placeGear, placeSectionGear, type GearAssignment} from '../src/gen/gearLoot';
import {Rng, hashString} from '../src/core/rng';
import {BASE_TABLES, GEAR_WEIGHTS, MALL_GEAR_PLACE, MALL_PROFILE, PROFILES, lootProfile, validateLootProfile, type LootProfile} from '../src/items/lootTables';
import {GEAR_ITEMS} from '../src/items/gear';
import {purposeById} from '../src/gen/purposes';
import {isExtensionArea} from '../src/gen/trackExt/index';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const MALL = lootProfile('mall');
/** The wearable-gear shops the bias favours for every piece (sales floor + stock room). */
const GEAR_SHOPS = ['clothing', 'womenswear', 'outdoors', 'sports', 'shoes', 'department', 'luggage'];
const PIECES = Object.keys(GEAR_WEIGHTS);
const area = (purpose: string | undefined, type = 'shop'): Area =>
  ({id: 1, x: 0, y: 0, w: 8, h: 8, kind: 'room', type, label: type, ceil: 3, parent: 0, depth: 1, publicSpace: false, lighting: 'dim', ...(purpose ? {purpose} : {})}) as never;
const f = (purpose: string, piece: string) => gearPlaceFactor(MALL_GEAR_PLACE, area(purpose), piece);

const cache = new Map<number, StationLayout>();
const mall = (seed: number): StationLayout => {
  let l = cache.get(seed);
  if (!l) cache.set(seed, (l = LEVELS.mall.generate('main', {levelSeed: seed, startWeapon: 'pistol'})));
  return l;
};
/** layout area id -> its shop's program (sales floor and stock room). */
const programOf = (l: StationLayout): Map<number, string> => {
  const m = new Map<number, string>();
  for (const s of l.mall?.shops ?? []) { m.set(s.area, s.program); if (s.backroom !== undefined) m.set(s.backroom, s.program); }
  return m;
};

/** (extra, ci-followup) Exact first-pick pool shares of a mall: themed share (biased / unbiased, pieces equally likely), the per-store
 *  rate ratio themed vs other shops, and a piece's boutique share (clothing / womenswear / shoes / luggage / department). */
function exactPool(l: StationLayout) {
  const prog = programOf(l), shops = l.mall?.shops ?? [];
  const pool = l.areas.map(a => [a, gearAreaWeight(a)] as const).filter(e => e[1] > 0);
  const share = (piece: string, biased: boolean, pick: (p: string | undefined) => boolean): number => {
    let tot = 0, inP = 0;
    for (const [a, w] of pool) { const x = w * (biased ? gearPlaceFactor(MALL_GEAR_PLACE, a, piece) : 1); tot += x; if (pick(prog.get(a.id))) inP += x; }
    return inP / tot;
  };
  const mean = (biased: boolean, pick: (p: string | undefined) => boolean) => PIECES.reduce((t, k) => t + share(k, biased, pick), 0) / PIECES.length;
  const themed = (p: string | undefined) => !!p && GEAR_SHOPS.includes(p), other = (p: string | undefined) => !!p && !GEAR_SHOPS.includes(p);
  const nT = shops.filter(s => GEAR_SHOPS.includes(s.program)).length, nO = shops.filter(s => !GEAR_SHOPS.includes(s.program)).length;
  const themedB = mean(true, themed);
  return {themedB, themedU: mean(false, themed), storeRatio: (themedB / nT) / Math.max(1e-9, mean(true, other) / nO),
    boutique: (piece: string) => share(piece, true, p => !!p && ['clothing', 'womenswear', 'shoes', 'luggage', 'department'].includes(p))};
}

describe('mall rare-gear placement bias (data)', () => {
  it('is the mall tables\' gearPlace only, valid, keyed by real purposes and gear pieces', () => {
    expect(MALL_PROFILE.tables.gearPlace).toBe(MALL_GEAR_PLACE);
    expect(BASE_TABLES.gearPlace).toBeUndefined();
    for (const l of ['subway', 'office'] as const) expect(PROFILES[l].tables.gearPlace, l).toBeUndefined();
    expect(validateLootProfile(MALL)).toEqual([]);
    const keys = [...Object.keys(MALL_GEAR_PLACE.purposes), ...Object.values(MALL_GEAR_PLACE.items ?? {}).flatMap(m => Object.keys(m ?? {}))];
    for (const k of keys) expect(purposeById(k), `purpose ${k}`).toBeDefined();
    for (const id of Object.keys(MALL_GEAR_PLACE.items ?? {})) expect(GEAR_ITEMS[id], id).toBeDefined();
    for (const v of [...Object.values(MALL_GEAR_PLACE.purposes), ...Object.values(MALL_GEAR_PLACE.items ?? {}).flatMap(m => Object.values(m ?? {}))]) {
      expect(Number.isFinite(v) && v > 0 && v <= 12).toBe(true);
    }
    // every wearable-gear shop (both rooms) is favoured; the validation catches a bad knob / piece / multiplier
    for (const p of GEAR_SHOPS) for (const id of [`mall-${p}`, `mall-${p}-back`]) expect(MALL_GEAR_PLACE.purposes[id], id).toBeGreaterThan(1);
    const bad: LootProfile = {...MALL, tables: {...MALL.tables, gearPlace: {purposes: {'mall-clothing': -1}, items: {jetpack: {'mall-guns': 2}}, extra: 1} as never}};
    const issues = validateLootProfile(bad).join('\n');
    expect(issues).toMatch(/gearPlace\.purposes\.mall-clothing/);
    expect(issues).toMatch(/gearPlace\.items\.jetpack: unknown gear id/);
    expect(issues).toMatch(/gearPlace\.extra: unknown knob/);
  });

  it('per-piece affinities: boots -> shoes, hard hat -> hardware, daypack -> luggage, armour -> gun shop / security, not boutiques', () => {
    // no bias / no purpose / an unlisted purpose = 1 (the Subway / Office placement)
    expect(gearPlaceFactor(undefined, area('mall-clothing'), 'boots')).toBe(1);
    expect(gearPlaceFactor(MALL_GEAR_PLACE, area(undefined), 'boots')).toBe(1);
    expect(f('mall-books', 'boots')).toBe(1);
    expect(f('mall-shoes', 'boots')).toBeGreaterThan(f('mall-clothing', 'boots'));
    expect(f('mall-shoes', 'boots')).toBeGreaterThan(f('mall-shoes', 'helmet'));
    // a whole shop's effective spot weight (sales floor + stock room: gearAreaWeight x the bias) — hardware has no whole-store boost
    const shopW = (p: string, piece: string) => gearAreaWeight(area(`mall-${p}`, 'shop')) * f(`mall-${p}`, piece) + gearAreaWeight(area(`mall-${p}-back`, 'stock-room')) * f(`mall-${p}-back`, piece);
    expect(shopW('hardware', 'helmet')).toBeGreaterThan(shopW('outdoors', 'helmet'));
    expect(shopW('guns', 'armor_vest')).toBeGreaterThan(shopW('outdoors', 'armor_vest'));
    expect(shopW('shoes', 'boots')).toBeGreaterThan(shopW('clothing', 'boots'));
    expect(f('mall-clothing', 'helmet')).toBeLessThan(f('mall-clothing', 'gloves'));
    expect(f('mall-luggage', 'backpack')).toBeGreaterThan(f('mall-clothing', 'backpack'));
    expect(f('mall-womenswear', 'gloves')).toBeGreaterThan(f('mall-womenswear', 'armor_vest'));
    for (const piece of ['armor_vest', 'chest_rig']) {
      expect(f('mall-guns', piece), piece).toBeGreaterThan(f('mall-clothing', piece));
      expect(f('mall-security', piece), piece).toBeGreaterThan(1);
      for (const b of ['clothing', 'womenswear', 'shoes', 'luggage', 'department']) expect(f(`mall-${b}`, piece), `${b} ${piece}`).toBeLessThan(f(`mall-${b}`, 'backpack'));
    }
    // effective spot weight: a clothing store's sales floor / stock room now clearly outweighs an untouched shop's
    const w = (p: string, t: string, piece: string) => gearAreaWeight(area(p, t)) * f(p, piece);
    const clothing = (piece: string) => w('mall-clothing', 'shop', piece) + w('mall-clothing-back', 'stock-room', piece);
    const books = (piece: string) => w('mall-books', 'shop', piece) + w('mall-books-back', 'stock-room', piece);
    // the wearables: > 4x an untouched shop; the hard hat a little; body armour deliberately NOT a clothing-store find (~x1)
    for (const piece of ['backpack', 'boots', 'gloves']) expect(clothing(piece), piece).toBeGreaterThan(4 * books(piece));
    expect(clothing('helmet')).toBeGreaterThan(1.4 * books('helmet'));
    for (const piece of ['armor_vest', 'chest_rig']) {
      expect(clothing(piece), piece).toBeGreaterThan(0.8 * books(piece));
      expect(clothing(piece), piece).toBeLessThan(2 * books(piece));
    }
  });
});

describe('mall rare-gear placement bias (generated malls)', () => {
  it('lands in the wearable-gear shops much more often than elsewhere; only allowed core spots; deterministic', () => {
    let themedB = 0, themedU = 0, otherB = 0, otherU = 0, piecesB = 0, piecesU = 0, themedStores = 0, otherStores = 0;
    const perPiece: Record<string, Record<string, number>> = {};
    for (const seed of [11, 222]) {
      const l = mall(seed), prog = programOf(l), shops = l.mall?.shops ?? [];
      themedStores += shops.filter(s => GEAR_SHOPS.includes(s.program)).length;
      otherStores += shops.filter(s => !GEAR_SHOPS.includes(s.program)).length;
      const saved = l.pickups.length;
      let kB = 0, kU = 0; // (extra) this seed's themed landings, biased / unbiased
      for (let r = 0; r < 48; r++) {
        const items: GearAssignment[] = [{itemId: PIECES[r % PIECES.length]}];
        const rng = () => new Rng(hashString(`themed-gear:${r}`, seed));
        const b = placeGear(l, items, rng(), MALL);
        l.pickups.length = saved;
        const u = placeGear(l, items, rng());
        l.pickups.length = saved;
        // determinism: the same rng and profile give the same spot
        if (r < 6) { expect(placeGear(l, items, rng(), MALL)).toEqual(b); l.pickups.length = saved; }
        for (const [list, biased] of [[b, true], [u, false]] as const) for (const q of list) {
          const a = l.areas[q.area], p = prog.get(q.area);
          expect(gearAreaWeight(a), `${a.type}/${a.purpose}`).toBeGreaterThan(0);
          expect(isExtensionArea(a)).toBe(false);
          const themed = !!p && GEAR_SHOPS.includes(p);
          if (themed) { if (biased) kB++; else kU++; }
          if (biased) { piecesB++; if (themed) themedB++; else if (p) otherB++; (perPiece[q.itemId] ??= {})[p ?? '~'] = ((perPiece[q.itemId] ??= {})[p ?? '~'] ?? 0) + 1; }
          else { piecesU++; if (themed) themedU++; else if (p) otherU++; }
        }
      }
      expect(l.pickups.length).toBe(saved);
      // (extra, ci-followup) the EXACT first-pick pool of this mall (placeGearIn's weighted area pick, pieces equally likely) carries the
      // same contract with no sampling noise, and this seed's 48 real placements follow it (binomial 3-sigma band)
      const ex = exactPool(l);
      expect(ex.themedB, `seed ${seed} exact themed share`).toBeGreaterThan(0.33);
      expect(ex.themedB).toBeGreaterThan(1.6 * ex.themedU);
      expect(ex.storeRatio, `seed ${seed} exact per-store ratio`).toBeGreaterThan(2.5);
      for (const piece of ['armor_vest', 'chest_rig']) expect(ex.boutique(piece), `seed ${seed} ${piece} boutique share`).toBeLessThan(0.5);
      const band = (k: number, q: number, n = 48) => Math.abs(k - n * q) <= 3 * Math.sqrt(n * q * (1 - q)) + 1;
      expect(band(kB, ex.themedB), `seed ${seed} biased themed ${kB} / 48 vs exact ${ex.themedB.toFixed(3)}`).toBe(true);
      expect(band(kU, ex.themedU), `seed ${seed} unbiased themed ${kU} / 48 vs exact ${ex.themedU.toFixed(3)}`).toBe(true);
    }
    expect(piecesB).toBe(96);
    expect(piecesU).toBe(96);
    // the share of gear in the wearable-gear shops (measured on 10 malls: 21 % -> 50 %), and the per-store rate vs other shops
    expect(themedB / piecesB).toBeGreaterThan(0.33);
    expect(themedB / piecesB).toBeGreaterThan(1.6 * (themedU / piecesU));
    expect((themedB / themedStores) / Math.max(1e-9, otherB / otherStores)).toBeGreaterThan(2.5);
    // armour is not a boutique find: most body armour lands outside the clothing / womenswear / shoe / luggage / department stores
    const boutique = (m: Record<string, number> = {}) => ['clothing', 'womenswear', 'shoes', 'luggage', 'department'].reduce((s, k) => s + (m[k] ?? 0), 0);
    const armour = ['armor_vest', 'chest_rig'].reduce((s, k) => s + Object.values(perPiece[k] ?? {}).reduce((a, n) => a + n, 0), 0);
    const armourBoutique = boutique(perPiece.armor_vest) + boutique(perPiece.chest_rig);
    expect(armourBoutique).toBeLessThan(armour / 2);
  });

  it('per-piece pools of a real mall: boots favour shoe stores, the hard hat hardware, armour the gun shop (first-pick weights)', () => {
    // seed 11 (f5224bd) + seed 222 (extra, ci-followup: its luggage store's x4 daypack affinity once left the shoe store at 1.87x — the
    // shoe store now carries the same x1.5 bag affinity as its fashion peers: items/lootTables.ts MALL_GEAR_PLACE)
    for (const seed of [11, 222]) {
    const l = mall(seed), prog = programOf(l);
    const pool = l.areas.map(a => [a, gearAreaWeight(a)] as const).filter(e => e[1] > 0);
    /** Share of a piece's first-pick weight per store of program `p` (biased / unbiased) — exact, no sampling. */
    const perStore = (piece: string, p: string, biased: boolean): number => {
      let tot = 0, inP = 0;
      for (const [a, w] of pool) { const x = w * (biased ? gearPlaceFactor(MALL_GEAR_PLACE, a, piece) : 1); tot += x; if (prog.get(a.id) === p) inP += x; }
      const n = (l.mall?.shops ?? []).filter(s => s.program === p).length;
      return n ? inP / tot / n : NaN;
    };
    const has = (p: string) => (l.mall?.shops ?? []).some(s => s.program === p);
    for (const p of GEAR_SHOPS.filter(has)) for (const piece of ['backpack', 'boots', 'gloves']) {
      expect(perStore(piece, p, true), `seed ${seed} ${p} ${piece}`).toBeGreaterThan(2 * perStore(piece, p, false));
    }
    if (has('shoes') && has('clothing')) expect(perStore('boots', 'shoes', true)).toBeGreaterThan(perStore('boots', 'clothing', true));
    if (has('hardware')) expect(perStore('helmet', 'hardware', true)).toBeGreaterThan(4 * perStore('helmet', 'hardware', false));
    if (has('guns')) expect(perStore('armor_vest', 'guns', true)).toBeGreaterThan(4 * perStore('armor_vest', 'guns', false));
    if (has('clothing')) expect(perStore('armor_vest', 'clothing', true)).toBeLessThan(perStore('backpack', 'clothing', true) / 3);
    }
  });
});

describe('registry wiring and old levels', () => {
  it('the registry places the mall\'s gear with the bias; Subway / Office placements are unchanged by their profiles', () => {
    const gear: GearAssignment[] = PIECES.map(itemId => ({itemId}));
    // mall: LEVELS.mall.generate with gear == the same layout + placeSectionGear under the mall profile (not the unbiased one)
    const withGear = LEVELS.mall.generate('main', {levelSeed: 222, startWeapon: 'pistol', gear});
    const base = mall(222), saved = base.pickups.length;
    const biased = placeSectionGear(base, gear, MALL);
    base.pickups.length = saved;
    const plain = placeSectionGear(base, gear);
    base.pickups.length = saved;
    expect(withGear.pickups.slice(saved)).toEqual(biased);
    expect(biased).not.toEqual(plain);
    // Subway / Office: their profiles carry no bias -> the very same placements as the unbiased call (loot-golden pins them too)
    const s1 = generateStation(4242, {startWeapon: 'pistol'}), s2 = generateStation(4242, {startWeapon: 'pistol'});
    expect(placeSectionGear(s1, gear, lootProfile('subway'))).toEqual(placeSectionGear(s2, gear));
    const o1 = generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'}), o2 = generateOfficeLevel({levelSeed: 11, startWeapon: 'pistol'});
    expect(placeSectionGear(o1, gear, lootProfile('office'))).toEqual(placeSectionGear(o2, gear));
    expect(o1.pickups).toEqual(o2.pickups);
  });
});
