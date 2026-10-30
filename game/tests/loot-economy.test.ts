// Iteration 12 (LOOT lane): the scarce-resource economy over a fixed seed corpus (tests/helpers/lootEconomy.ts: 18 stations, 3 per
// station family, pistol start) against the d632ce8 baseline measured with the SAME census code (git archive d632ce8 + this helper):
// ~20 % of the non-ammo resource units, ammo unchanged (+-10 %), weapon finds untouched, batteries / flares as rare finite finds
// (more in service / security rooms), soft room-purpose weights (on-theme > off-theme, off-theme > 0), deterministic and unique.
// LOOT_REPORT=1 also writes reference/tasks/atmosphere-light-survival-20261028/loot/economy.json.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {generateStation, type StationLayout} from '../src/gen/station';
import {holderFinds, isContainerKind, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {
  FLOOR_ECONOMY, GLOBAL_POOL, HANDFUL, HOLDER_ALLOW, OFF_THEME_WEIGHTS, RANDOM_HOLDERS, THEME_ECONOMY, THEME_OF_TYPE, econCat, holderTheme, lootTheme,
  type LootTheme,
} from '../src/items/lootEconomy';
import {ALL_PURPOSES} from '../src/gen/purposes';
import {ITEMS} from '../src/items/items';
import {canonicalItemId} from '../src/items/calibers';
import {openableActive} from '../src/world/openablesSpec';
import {ECONOMY_CORPUS, corpusTotals, generateCorpus, nonAmmo, stationEconomy, type EconTotals} from './helpers/lootEconomy';

/**
 * d632ce8 (iteration 11) census of the same 18-station corpus (tests/helpers/lootEconomy.ts, run on `git archive d632ce8` with
 * node_modules linked; 4895 loot holders). Units = item count (ammo: rounds).
 */
const BASELINE = {
  commit: 'd632ce89f9aab0a303fbc82a96b8a1091cd509bc',
  units: {food: 3010, drink: 3545, med: 933, ammo: 7409, battery: 0, flare: 0, weapon: 41},
  items: {water: 1745, chocolate: 900, cola: 1091, juice: 709, noodles: 572, chips: 896, beans: 642, bandage: 818, medkit: 115, ammo_rifle: 5126, ammo_shells: 1308, ammo_pistol: 975, shotgun: 21, rifle: 20},
  bySource: {holder: {food: 3010, drink: 3545, med: 863, ammo: 3590}, pickup: {med: 70, ammo: 3819, weapon: 41}},
  holders: 4895,
} as const;
const BASE_NON_AMMO = BASELINE.units.food + BASELINE.units.drink + BASELINE.units.med;

const ALL_MODELS = new Proxy({}, {get: () => ({}), has: () => true}) as Record<string, unknown>;

interface ThemedFind { theme: LootTheme; itemId: string; source: 'roll' | 'find' | 'pickup'; kind: string }
/** Every holder find (tagged roll / find, before placement) + every loose pickup of a station, with the theme it follows. */
function stationFinds(l: StationLayout): ThemedFind[] {
  const out: ThemedFind[] = [];
  let ci = 0, si = 0;
  const oi = new Map<string, number>();
  for (const p of l.props) {
    if (!isLootHolderKind(p.kind)) continue;
    const isC = isContainerKind(p.kind);
    let index: number;
    if (isC && openableActive(p.kind, ALL_MODELS)) { index = oi.get(p.kind) ?? 0; oi.set(p.kind, index + 1); } else index = isC ? ci++ : si++;
    const a = l.areas[p.area], key = p.purpose ?? a?.purpose ?? a?.type ?? 'default';
    for (const f of holderFinds(l.seed, index, p.kind as HolderKind, key, true)) out.push({theme: holderTheme(p.kind, key), itemId: f.itemId, source: f.source, kind: p.kind});
  }
  for (const q of l.pickups) { const a = l.areas[q.area]; out.push({theme: lootTheme(a?.purpose ?? a?.type ?? 'default'), itemId: q.itemId, source: 'pickup', kind: 'floor'}); }
  return out;
}

let corpus: StationLayout[] | null = null;
const CORPUS = () => (corpus ??= generateCorpus());
let totals: EconTotals | null = null;
const TOTALS = () => (totals ??= corpusTotals(CORPUS()));
const ratio = (now: number, base: number) => now / base;

describe('scarce resources over the fixed corpus (vs d632ce8)', () => {
  it('the corpus covers every station family with distinct seeds', () => {
    expect(ECONOMY_CORPUS.length).toBe(18);
    expect(new Set(ECONOMY_CORPUS.map(c => c.seed)).size).toBe(18);
    expect(new Set(CORPUS().map(l => l.archetype)).size).toBe(6);
  });

  it('non-ammo resources are ~20 % of the baseline (each category too); ammo is unchanged (+-10 %); weapon finds untouched', () => {
    const u = TOTALS().units;
    const r = ratio(nonAmmo(u), BASE_NON_AMMO);
    expect(r).toBeGreaterThan(0.15); expect(r).toBeLessThan(0.25);
    // the new light items included: still ~20 % of the old non-ammo amount
    const rl = ratio(nonAmmo(u, true), BASE_NON_AMMO);
    expect(rl).toBeGreaterThan(0.15); expect(rl).toBeLessThan(0.25);
    for (const c of ['food', 'drink', 'med'] as const) {
      expect(ratio(u[c], BASELINE.units[c]), c).toBeGreaterThan(0.15);
      expect(ratio(u[c], BASELINE.units[c]), c).toBeLessThan(0.26);
    }
    expect(ratio(u.ammo, BASELINE.units.ammo)).toBeGreaterThan(0.9);
    expect(ratio(u.ammo, BASELINE.units.ammo)).toBeLessThan(1.1);
    // no caliber starves as a side effect. Lane AMMO (knife-melee-20261030): the generic holder ammo is now ~1/3 each caliber (it
    // was rifle 1.4 : shells 1, no 9mm), so the 5.56 rounds move to the 9mm by design — every caliber keeps >= 0.75 of its
    // d632ce8 amount (old gun-specific ids map 1:1: items/calibers.ts LEGACY_AMMO_IDS) and the 9mm is no longer floor-only.
    const items = TOTALS().items;
    for (const id of ['ammo_rifle', 'ammo_shells', 'ammo_pistol'] as const) expect(ratio(items[canonicalItemId(id)] ?? 0, BASELINE.items[id]), id).toBeGreaterThan(0.75);
    expect(ratio(items.ammo_9mm ?? 0, BASELINE.items.ammo_pistol), 'more 9mm (holders too)').toBeGreaterThan(1.5);
    expect(u.weapon).toBe(BASELINE.units.weapon);
    expect(u.other).toBe(0);
    // loose floor ammo boxes are untouched; loose meds thin like the rest
    expect(TOTALS().bySource.pickup.ammo).toBe(BASELINE.bySource.pickup.ammo);
    expect(ratio(TOTALS().bySource.pickup.med, BASELINE.bySource.pickup.med)).toBeLessThan(0.4);
  });

  it('batteries and flares are rare finite finds: ~2-4 batteries and ~2-3 flares per station, every station has a battery', () => {
    const t = TOTALS();
    expect(t.units.battery / t.stations).toBeGreaterThanOrEqual(2);
    expect(t.units.battery / t.stations).toBeLessThanOrEqual(4);
    expect(t.units.flare / t.stations).toBeGreaterThanOrEqual(2);
    expect(t.units.flare / t.stations).toBeLessThanOrEqual(3);
    for (const l of CORPUS()) {
      const s = corpusTotals([l]).units;
      expect(s.battery, `${l.seed} battery`).toBeGreaterThanOrEqual(1);
      expect(s.battery + s.flare, `${l.seed} light finds`).toBeLessThanOrEqual(16);
    }
    // more in service / maintenance / security rooms: light finds per holder there vs everywhere else
    const per = {themed: {n: 0, h: 0}, other: {n: 0, h: 0}};
    for (const l of CORPUS()) {
      for (const p of l.props) {
        if (!isLootHolderKind(p.kind)) continue;
        const a = l.areas[p.area], th = holderTheme(p.kind, p.purpose ?? a?.purpose ?? a?.type ?? 'default');
        per[th === 'service' || th === 'security' ? 'themed' : 'other'].h++;
      }
      for (const f of stationFinds(l)) {
        if (f.itemId !== 'battery' && f.itemId !== 'flare') continue;
        per[f.theme === 'service' || f.theme === 'security' ? 'themed' : 'other'].n++;
      }
    }
    expect(per.themed.n / per.themed.h).toBeGreaterThan(4 * per.other.n / per.other.h);
    expect(per.other.n).toBeGreaterThan(0);
  });
});

describe('soft room-purpose weights', () => {
  it('every purpose declares a theme; room types map; tables reference real items', () => {
    for (const P of ALL_PURPOSES) expect(THEME_ECONOMY[P.theme], P.id).toBeDefined();
    for (const t of Object.values(THEME_OF_TYPE)) expect(THEME_ECONOMY[t]).toBeDefined();
    for (const rows of Object.values(GLOBAL_POOL)) for (const [id] of rows) expect(ITEMS[id], id).toBeDefined();
    for (const id of Object.keys(HANDFUL)) expect(ITEMS[id], id).toBeDefined();
    for (const T of Object.values(THEME_ECONOMY)) {
      expect(T.keep).toBeGreaterThan(0); expect(T.keep).toBeLessThan(0.35);
      for (const k of Object.keys(T.weights)) expect(T.cats).toContain(k);
    }
    // ammo is never hard-excluded: every theme can end up with it (on-theme in security, off-theme everywhere else)
    expect(OFF_THEME_WEIGHTS.ammo).toBeGreaterThan(0);
    expect(THEME_ECONOMY.security.cats).toContain('ammo');
    expect(lootTheme('security-office')).toBe('security');
    expect(lootTheme('pharmacy')).toBe('medical');
    expect(lootTheme('electrical-room')).toBe('service');
    expect(lootTheme('food-court')).toBe('food');
    expect(lootTheme('platform')).toBe('public');
    expect(holderTheme('bin', 'security-office')).toBe('public');
  });

  it('in every themed room type, on-theme finds outnumber off-theme ones, off-theme random finds exist (~15-25 % overall)', () => {
    const by = new Map<LootTheme, {on: number; all: number}>();
    let ammoSec = 0, ammoAll = 0, holdersSec = 0, holdersAll = 0;
    for (const l of CORPUS()) {
      for (const f of stationFinds(l)) {
        const c = econCat(f.itemId);
        if (c === 'ammo') { ammoAll += 1; if (f.theme === 'security') ammoSec += 1; }
        // the holders' original ammo rolls and the loose floor ammo boxes are exempt (unchanged); every scarce find counts
        if (f.source === 'roll' || f.theme === 'public' || c === null || (f.source === 'pickup' && c === 'ammo')) continue;
        const m = by.get(f.theme) ?? {on: 0, all: 0};
        by.set(f.theme, m);
        m.all++;
        if (THEME_ECONOMY[f.theme].cats.includes(c)) m.on++;
      }
      for (const p of l.props) {
        if (!isLootHolderKind(p.kind)) continue;
        holdersAll++;
        const a = l.areas[p.area];
        if (holderTheme(p.kind, p.purpose ?? a?.purpose ?? a?.type ?? 'default') === 'security') holdersSec++;
      }
    }
    let on = 0, all = 0;
    for (const [theme, m] of by) {
      on += m.on; all += m.all;
      if (m.all < 20) continue; // tiny samples (tech stores) only count toward the total
      expect(m.on / m.all, `${theme} on-theme share`).toBeGreaterThan(0.6);
      expect(m.all - m.on, `${theme} off-theme finds`).toBeGreaterThan(0);
    }
    expect(by.get('food')!.all).toBeGreaterThan(500);
    expect((all - on) / all, 'off-theme share overall').toBeGreaterThan(0.13);
    expect((all - on) / all, 'off-theme share overall').toBeLessThan(0.3);
    // security / agent offices are where the ammo is: ammo stacks per holder well above the station average
    expect(ammoSec / holdersSec).toBeGreaterThan(2 * ammoAll / holdersAll);
  });

  it('fixtures stay plausible: coolers hold drinks, first-aid cabinets dressings, gun lockers no food, bins no flares', () => {
    // scarce finds only: a holder's original ammo roll is untouched (a vending bank in a service corridor rolls its purpose's union
    // table, ammo included, exactly as at d632ce8)
    const seen = new Map<string, Set<string>>();
    for (const l of CORPUS()) for (const f of stationFinds(l)) {
      if (f.source !== 'find') continue;
      let s = seen.get(f.kind);
      if (!s) seen.set(f.kind, (s = new Set()));
      s.add(econCat(f.itemId) ?? 'x');
    }
    expect(seen.get('shopCooler')).toEqual(new Set(['drink']));
    expect(seen.get('medCabinet')).toEqual(new Set(['med']));
    for (const c of ['food', 'drink']) expect(seen.get('gunLocker')?.has(c) ?? false, `gun locker ${c}`).toBe(false);
    for (const c of ['ammo', 'med', 'flare']) expect(seen.get('vending')?.has(c) ?? false, `vending ${c}`).toBe(false);
    for (const k of RANDOM_HOLDERS) expect(seen.get(k)?.has('flare') ?? false, k).toBe(false);
    // what the re-pick may produce in a fixture is bounded by HOLDER_ALLOW (the rolled item itself always comes from the fixture's table)
    expect(HOLDER_ALLOW.shopCooler).toEqual(['drink']);
  });
});

describe('determinism, uniqueness, no rerolls', () => {
  it('same seed -> same pickups and holder finds; unique pickup spots; loose light finds sit in service / security rooms first', () => {
    const seed = ECONOMY_CORPUS[4].seed;
    const a = generateStation(seed, {startWeapon: 'pistol'}), b = generateStation(seed, {startWeapon: 'pistol'});
    expect(a.pickups).toEqual(b.pickups);
    expect(stationEconomy(a)).toEqual(stationEconomy(b));
    expect(stationFinds(a)).toEqual(stationFinds(b));
    let lightLoose = 0, lightThemed = 0;
    for (const l of CORPUS()) {
      const keys = l.pickups.map(p => `${p.level ?? 0}|${p.x.toFixed(2)}|${p.z.toFixed(2)}|${p.itemId}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(l.pickups.filter(p => p.itemId === 'battery').length).toBe(FLOOR_ECONOMY.batteryChance >= 1 ? 1 : l.pickups.filter(p => p.itemId === 'battery').length);
      for (const p of l.pickups.filter(q => q.itemId === 'battery' || q.itemId === 'flare')) {
        lightLoose++;
        const ar = l.areas[p.area], th = lootTheme(ar.purpose ?? ar.type);
        expect(ar.storefront, 'never in a store').toBeUndefined();
        if (th === 'service' || th === 'security') lightThemed++;
      }
    }
    expect(lightThemed / lightLoose).toBeGreaterThan(0.6);
  });

  it('holder lots: unique ids, finite counts, rolled once (a rebuild gives the same lots)', async () => {
    const {createHolderState} = await import('../src/items/loot');
    const {holderSurfaces} = await import('../src/items/lootLayout');
    const {PROP_DEFS} = await import('../src/gen/props');
    for (const l of CORPUS().slice(0, 6)) {
      let ci = 0, si = 0;
      const roll = () => { ci = 0; si = 0; return l.props.filter(p => isLootHolderKind(p.kind)).map(p => { const k = p.kind as HolderKind, a = l.areas[p.area]; return createHolderState(l.seed, isContainerKind(k) ? ci++ : si++, k, p.purpose ?? a.purpose ?? a.type, holderSurfaces(k, PROP_DEFS[k])); }); };
      const first = roll(), again = roll();
      expect(again.map(s => s.lots)).toEqual(first.map(s => s.lots));
      for (const s of first) {
        expect(new Set(s.lots.map(x => x.id)).size).toBe(s.lots.length);
        for (const lot of s.lots) { expect(lot.count).toBeGreaterThan(0); expect(Number.isInteger(lot.count)).toBe(true); }
        expect(s.rolled).toBe(s.lots.length);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------
// Opt-in report (LOOT_REPORT=1): baseline vs now, per category / source / theme, the weights table.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'reference/tasks/atmosphere-light-survival-20261028/loot');

describe.skipIf(process.env.LOOT_REPORT !== '1')('loot economy report', () => {
  it('writes economy.json', () => {
    const t = TOTALS();
    const S = t.stations;
    const per = (n: number) => Math.round(n / S * 100) / 100;
    const themes: Record<string, Record<string, number>> = {};
    for (const l of CORPUS()) for (const f of stationFinds(l)) {
      const c = econCat(f.itemId) ?? 'weapon';
      const m = (themes[f.theme] ??= {});
      m[c] = (m[c] ?? 0) + 1;
    }
    const perStation = CORPUS().map((l, i) => ({...ECONOMY_CORPUS[i], units: corpusTotals([l]).units}));
    const report = {
      task: 'studio-atmosphere-light-survival-20261028-01', lane: 'LOOT', generatedBy: 'game/tests/loot-economy.test.ts (LOOT_REPORT=1)',
      corpus: {stations: S, seeds: ECONOMY_CORPUS, startWeapon: 'pistol', census: 'game/tests/helpers/lootEconomy.ts (holder lots as world/containers.ts rolls them with every model loaded + every layout pickup)'},
      baseline: {commit: BASELINE.commit, units: BASELINE.units, perStation: Object.fromEntries(Object.entries(BASELINE.units).map(([k, v]) => [k, per(v)])), items: BASELINE.items, bySource: BASELINE.bySource, holders: BASELINE.holders},
      now: {units: t.units, perStation: Object.fromEntries(Object.entries(t.units).map(([k, v]) => [k, per(v)])), items: t.items, bySource: t.bySource, holders: t.holders},
      ratios: {
        nonAmmo: Math.round(nonAmmo(t.units) / BASE_NON_AMMO * 1000) / 1000,
        nonAmmoWithBatteriesFlares: Math.round(nonAmmo(t.units, true) / BASE_NON_AMMO * 1000) / 1000,
        food: Math.round(t.units.food / BASELINE.units.food * 1000) / 1000,
        drink: Math.round(t.units.drink / BASELINE.units.drink * 1000) / 1000,
        med: Math.round(t.units.med / BASELINE.units.med * 1000) / 1000,
        ammo: Math.round(t.units.ammo / BASELINE.units.ammo * 1000) / 1000,
        weapons: t.units.weapon / BASELINE.units.weapon,
      },
      batteriesFlares: {batteryPerStation: per(t.units.battery), flarePerStation: per(t.units.flare), perStation: perStation.map(p => ({seed: p.seed, battery: p.units.battery, flare: p.units.flare}))},
      findsByTheme: themes,
      weights: {themes: THEME_ECONOMY, offTheme: OFF_THEME_WEIGHTS, globalPool: GLOBAL_POOL, handful: HANDFUL, holderAllow: HOLDER_ALLOW, randomHolders: [...RANDOM_HOLDERS], themeOfRoomType: THEME_OF_TYPE,
        purposeThemes: Object.fromEntries(ALL_PURPOSES.map(p => [p.id, p.theme])), floor: FLOOR_ECONOMY},
      perStation,
      startLoadoutRecommendation: 'Keep the LIGHT lane start (flashlight at 80 %, drain 1/420 per s) with NO spare battery in the pack: every station places one loose battery (service / security rooms first) and ~2.3 more in holders (~3.3 total, min 1 per station). Give at most ONE starting flare (it teaches T-throw / the lure in the first minutes); the ~2.4 found flares per station stay the main supply. Do not add batteries / flares to the start beyond that or the scarcity is undone.',
    };
    fs.mkdirSync(OUT, {recursive: true});
    fs.writeFileSync(path.join(OUT, 'economy.json'), JSON.stringify(report, null, 1) + '\n');
  });
});
