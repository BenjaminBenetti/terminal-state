// Task gameplay-feedback-20261111 (lane FUEL-LOOT): BUNKER LAYOUT VERSION 3 — on the platform / elevator storey S ONLY, half the ammo
// spawn opportunities become food / drink ones (gen/bunker/v2/stationRations.ts; lootTables BUNKER_STATION_RATIONS; the prop-level key
// BUNKER_PURPOSE.rations). User: "On platform/elevator level S ONLY, replace half the ammo spawn opportunities with increased food/drink
// spawns. Leave underground floors unchanged."
//  - the version policy: unvisited / new -> 3; an entered version-1 or version-2 station keeps its version (its lane record);
//  - storeys 1-5 are BYTE-IDENTICAL to version 2 (props, pickups, enemies, areas, lights, every holder's rolled lots), and S differs only
//    in the converted holders' loot key and the converted floor pickups' item;
//  - S: exactly floor(N / 2) of its N ammo opportunities converted; a converted holder rolls only the rations; gun lockers never convert;
//    the census (real ContainerManager.build, the bunker profile): S ammo about half, S food / drink up (before and after the natural half);
//  - version 2 is exactly the pre-change version 2 (a fingerprint of the generator output taken before this change).
// Bounded: 8 seeds x 2 versions (~1 s a layout + its holder roll); numbers to /tmp/bunker-s-food.log.

import {describe, expect, it} from 'vitest';
import {appendFileSync, writeFileSync} from 'node:fs';
import {hashString} from '../src/core/rng';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {BUNKER_LAYOUT_LANE, BUNKER_LAYOUT_VERSION, bunkerLayoutVersionFor} from '../src/gen/bunker/layoutVersion';
import {BUNKER_S_LEVEL, BUNKER_S_RATIONS_STATS, BUNKER_S_RATIONS_VERSION, isAmmoOpportunity, lootKeyOf, takesRations} from '../src/gen/bunker/v2/stationRations';
import {BUNKER_PURPOSE} from '../src/gen/reactor/complex/bunkerPurposes';
import {BUNKER_STATION_RATIONS, ANNEX_CACHE_PANTRY_ROWS, econCat, lootProfile} from '../src/items/lootTables';
import {compartmentTable, holderTable} from '../src/items/loot';
import {holderFoodOrigin, keepLayoutPickup, keepNaturalFood} from '../src/items/naturalFood';
import {ContainerManager} from '../src/world/containers';
import {WorldMaterials} from '../src/world/materials';
import {Inventory} from '../src/items/inventory';
import {holderKeyOf} from '../src/run/worldMemory';
import type {StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const LOG = '/tmp/bunker-s-food.log';
const log = (s: string) => appendFileSync(LOG, s + '\n');
const SEEDS = Array.from({length: 8}, (_, k) => 4401 + k * 7919);
const PROFILE = lootProfile('bunker');
const gen = (seed: number, v: number) => LEVELS.bunker.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: v});
const lv = (x: {level?: number}) => x.level ?? 0;
const J = (x: unknown) => JSON.stringify(x);
const foodish = (id: string) => { const c = econCat(id); return c === 'food' || c === 'drink'; };

/** Build v2 and v3 of a seed (+ the pass's record of v3) and roll both layouts' holders with the real ContainerManager. */
function pair(seed: number) {
  const a = gen(seed, 2);
  const b = gen(seed, BUNKER_S_RATIONS_VERSION);
  const rec = BUNKER_S_RATIONS_STATS.last!;
  const roll = (l: StationLayout) => { const cm = new ContainerManager({}, mats, () => new Inventory()); cm.build(l, {}, PROFILE); return cm.all; };
  return {a, b, rec, ha: roll(a), hb: roll(b)};
}
type Pair = ReturnType<typeof pair>;
const pairs = new Map<number, Pair>();
const get = (seed: number): Pair => { let p = pairs.get(seed); if (!p) pairs.set(seed, (p = pair(seed))); return p; };

describe('Bunker layout v3: storey S trades half its ammo opportunities for food / drink', () => {
  writeFileSync(LOG, '');

  it('the version policy: unvisited / new -> 3; an entered version-1 or version-2 station keeps its version', () => {
    expect(BUNKER_LAYOUT_VERSION).toBe(BUNKER_S_RATIONS_VERSION);
    expect(BUNKER_S_RATIONS_VERSION).toBe(3);
    expect(bunkerLayoutVersionFor(undefined)).toBe(3);
    expect(bunkerLayoutVersionFor({visits: 0, lanes: {}})).toBe(3);
    expect(bunkerLayoutVersionFor({visits: 3, lanes: {[BUNKER_LAYOUT_LANE]: {v: 2}}})).toBe(2);
    expect(bunkerLayoutVersionFor({visits: 3, lanes: {[BUNKER_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    expect(bunkerLayoutVersionFor({visits: 2, lanes: {}})).toBe(1);
    // the rations key + table: food / drink rows of the named survivor pantry, exact (no scarcity cut / salvage)
    expect(BUNKER_STATION_RATIONS.items).toBe(ANNEX_CACHE_PANTRY_ROWS);
    expect(BUNKER_STATION_RATIONS.items.every(([id]) => foodish(id))).toBe(true);
    expect(BUNKER_STATION_RATIONS.exact).toBe(true);
    // gun lockers keep their arms (no food / drink allowed); a cabinet / crate / footlocker / filing cabinet / desk takes the rations
    expect(takesRations('gunLocker', PROFILE)).toBe(false);
    for (const k of ['cabinetTall', 'cabinetLow', 'crate', 'shelf', 'footlocker', 'filingCabinet', 'safe', 'desk', 'monitorDesk']) expect(takesRations(k, PROFILE), k).toBe(true);
    expect(isAmmoOpportunity('cabinetTall', BUNKER_PURPOSE.rations, PROFILE)).toBe(false);
  });

  it('version 2 is the pre-change version 2 exactly (generator fingerprint taken before this change), and has no rations key', () => {
    const l = gen(SEEDS[0], 2);
    const fp = hashString(J({props: l.props, pickups: l.pickups, zombies: l.zombies, areas: l.areas.length, lights: l.lights.length}));
    log(`v2 fingerprint seed ${SEEDS[0]}: ${fp >>> 0}`);
    expect(fp >>> 0).toBe(V2_FINGERPRINT);
    expect(l.props.some(p => p.purpose === BUNKER_PURPOSE.rations)).toBe(false);
  });

  it('storeys 1-5 are byte-identical to version 2; S differs only in the converted holders\' key and the converted floor pickups', () => {
    for (const seed of SEEDS) {
      const {a, b, rec, ha, hb} = get(seed);
      expect(rec.holders.every(i => b.props[i].purpose === BUNKER_PURPOSE.rations), `seed ${seed} record`).toBe(true);
      // layout: the same areas / lights / doors / links / enemies / record, the same props (S: + the key) and pickups (S: + the item)
      expect(J(b.areas)).toBe(J(a.areas));
      expect(J(b.lights)).toBe(J(a.lights));
      expect(J(b.doors)).toBe(J(a.doors));
      expect(J(b.levelLinks)).toBe(J(a.levelLinks));
      expect(J(b.zombies)).toBe(J(a.zombies));
      expect(J(b.bunker)).toBe(J(a.bunker));
      expect(b.props.length).toBe(a.props.length);
      const conv = new Set(rec.holders), convP = new Set(rec.pickups);
      b.props.forEach((p, i) => {
        if (!conv.has(i)) { expect(J(p), `seed ${seed} prop ${i}`).toBe(J(a.props[i])); return; }
        expect(lv(p)).toBe(BUNKER_S_LEVEL);
        const {purpose: _k, ...rest} = p, {purpose: _k2, ...was} = a.props[i];
        expect(J(rest)).toBe(J(was));
      });
      expect(b.pickups.length).toBe(a.pickups.length);
      b.pickups.forEach((q, i) => {
        if (!convP.has(i)) { expect(J(q), `seed ${seed} pickup ${i}`).toBe(J(a.pickups[i])); return; }
        const w = a.pickups[i];
        expect(lv(q)).toBe(BUNKER_S_LEVEL);
        expect(econCat(w.itemId)).toBe('ammo');
        expect(foodish(q.itemId)).toBe(true);
        expect(q.count).toBe(1);
        expect([q.x, q.y, q.z, q.area, q.level]).toEqual([w.x, w.y, w.z, w.area, w.level]);
      });
      // every holder's rolled lots: identical below S, and on S except the converted holders
      expect(hb.length).toBe(ha.length);
      let below = 0;
      for (const [k, h] of hb.entries()) {
        const w = ha[k];
        expect(holderKeyOf(h)).toBe(holderKeyOf(w));
        expect(h.index).toBe(w.index);
        if (conv.has(layoutIndexOf(b, h.prop))) continue;
        expect(J(h.state.lots), `seed ${seed} holder ${holderKeyOf(h)}`).toBe(J(w.state.lots));
        if (lv(h.prop) !== BUNKER_S_LEVEL) below++;
      }
      expect(below).toBeGreaterThan(50);
    }
  });

  it('S: floor(N / 2) of N ammo opportunities converted; converted holders roll only rations; S ammo ~half, food / drink up (census)', () => {
    const t = {v2: {ammoLots: 0, ammoRounds: 0, floorAmmo: 0, food: 0, foodKept: 0, med: 0, battery: 0, flare: 0, material: 0, holders: 0},
      v3: {ammoLots: 0, ammoRounds: 0, floorAmmo: 0, food: 0, foodKept: 0, med: 0, battery: 0, flare: 0, material: 0, holders: 0}};
    let opps = 0, conv = 0;
    for (const seed of SEEDS) {
      const {a, b, rec, ha, hb} = get(seed);
      // the opportunities: v2's S holders that can spawn ammo + the S floor program's ammo pickups (the record's N)
      const holderOpps = a.props.filter(p => lv(p) === BUNKER_S_LEVEL && isAmmoOpportunity(p.kind, lootKeyOf(a, p), PROFILE)).length;
      expect(rec.opportunities, `seed ${seed}`).toBeGreaterThanOrEqual(holderOpps);
      expect(rec.holders.length + rec.pickups.length, `seed ${seed} converted`).toBe(Math.floor(rec.opportunities / 2));
      // after: the remaining opportunities are exactly N - floor(N / 2)
      const left = b.props.filter(p => lv(p) === BUNKER_S_LEVEL && isAmmoOpportunity(p.kind, lootKeyOf(b, p), PROFILE)).length + (rec.opportunities - holderOpps - rec.pickups.length);
      expect(left).toBe(rec.opportunities - Math.floor(rec.opportunities / 2));
      opps += rec.opportunities; conv += rec.holders.length + rec.pickups.length;
      for (const i of rec.holders) {
        const p = b.props[i];
        expect(p.kind).not.toBe('gunLocker');
        expect(isAmmoOpportunity(p.kind, lootKeyOf(a, a.props[i]), PROFILE)).toBe(true);
        expect(holderTable(p.kind as never, BUNKER_PURPOSE.rations, PROFILE).exact).toBe(true);
      }
      // a converted holder's own roll is the rations (food / drink only); a desk-style holder's drawers keep their separate compartment
      // roll, now themed by the rations key (food), with the economy's rare off-theme finds
      const convIdx = new Set(rec.holders);
      for (const h of hb) {
        if (!convIdx.has(layoutIndexOf(b, h.prop))) continue;
        const inside = compartmentTable(h.kind, BUNKER_PURPOSE.rations, PROFILE) !== null;
        for (const x of h.state.lots) if (!inside || x.part === undefined) expect(foodish(x.itemId), `${holderKeyOf(h)} ${x.itemId}`).toBe(true);
      }
      const census = (l: StationLayout, hs: Pair['ha'], s: typeof t.v2) => {
        for (const h of hs) {
          if (lv(h.prop) !== BUNKER_S_LEVEL) continue;
          s.holders++;
          for (const x of h.state.lots) {
            const c = econCat(x.itemId);
            if (c === 'ammo') { s.ammoLots++; s.ammoRounds += x.count; }
            else if (c === 'food' || c === 'drink') { s.food++; if (keepNaturalFood(l.seed, holderFoodOrigin('bunker-s-food', holderKeyOf(h), x.id))) s.foodKept++; }
            else if (c === 'med' || c === 'battery' || c === 'flare' || c === 'material') s[c]++;
          }
        }
        l.pickups.forEach((q, i) => {
          if (lv(q) !== BUNKER_S_LEVEL) return;
          const c = econCat(q.itemId);
          if (c === 'ammo') { s.floorAmmo++; s.ammoRounds += q.count; }
          else if (c === 'food' || c === 'drink') { s.food++; if (keepLayoutPickup(l.seed, 'bunker-s-food', i, q)) s.foodKept++; }
        });
      };
      census(a, ha, t.v2);
      census(b, hb, t.v3);
    }
    const per = (s: typeof t.v2) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v / SEEDS.length * 100) / 100]));
    log(`S per level over ${SEEDS.length} seeds: v2 ${J(per(t.v2))}`);
    log(`S per level over ${SEEDS.length} seeds: v3 ${J(per(t.v3))}`);
    log(`opportunities ${opps / SEEDS.length} / level, converted ${conv / SEEDS.length} / level`);
    const ammo2 = t.v2.ammoLots + t.v2.floorAmmo, ammo3 = t.v3.ammoLots + t.v3.floorAmmo;
    log(`S ammo finds v3 / v2 = ${(ammo3 / ammo2).toFixed(3)} (rounds ${(t.v3.ammoRounds / t.v2.ammoRounds).toFixed(3)}); food / drink ${(t.v3.food / t.v2.food).toFixed(2)}x (kept ${(t.v3.foodKept / t.v2.foodKept).toFixed(2)}x)`);
    expect(conv / opps).toBeGreaterThan(0.45);
    expect(conv / opps).toBeLessThanOrEqual(0.5);
    // S ammo finds / rounds well down (measured 0.64 / 0.65 on these 8 seeds, 0.60 / 0.60 on 24): the gun lockers (the armoury's racks, no
    // food allowed) keep their ~3.5 ammo lots a level, so the ammo cut is a little under the opportunities' half
    expect(ammo3 / ammo2).toBeGreaterThan(0.45);
    expect(ammo3 / ammo2).toBeLessThan(0.75);
    expect(t.v3.ammoRounds / t.v2.ammoRounds).toBeGreaterThan(0.45);
    expect(t.v3.ammoRounds / t.v2.ammoRounds).toBeLessThan(0.75);
    // food / drink up: about one food / drink lot per converted opportunity (before the natural half), at least doubled on S
    expect(t.v3.food - t.v2.food).toBeGreaterThan(0.5 * conv);
    expect(t.v3.food).toBeGreaterThan(2 * t.v2.food);
    expect(t.v3.foodKept).toBeGreaterThan(1.6 * t.v2.foodKept); // (measured 1.91x: the natural half is a per-find hash)
    expect(t.v3.holders).toBe(t.v2.holders);
  });
});

/** The layout prop index of a holder's prop. */
function layoutIndexOf(l: StationLayout, prop: StationLayout['props'][number]): number {
  return l.props.indexOf(prop);
}

/** hashString of version 2's generator output for seed 4401 (props / pickups / enemies / area + light counts), taken on commit 268a2354 (before this change). */
const V2_FINGERPRINT = 121849353;
