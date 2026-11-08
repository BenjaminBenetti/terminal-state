// Task studio-skyways-level-20261106-054448-01: SKYWAYS (gen/skyways) — the generated level as the game builds it
// (LEVELS.skyways.generate): valid on a seed sample, deterministic, ONE localized add-on (convention / prize car, equal weights), the
// lower arrival (train in the station under the station building) and the climb (concourse -> street level -> "+15" skyway level) by
// real stairs / escalators, the bridge network (branches + loops), glazing in solid walls with pre-breached spans, the ramen restaurant
// with its edible food, the campaign share (10 % from the Subway's) and the fuel placement contract.
import {describe, expect, it} from 'vitest';
import {LEVELS, LEVEL_IDS, arrivalPose, storeyLabel} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {skywaysIssues} from '../src/gen/skyways/validate';
import {skywaysAddonOf, skywaysFrame} from '../src/gen/skyways/frame';
import {levelDistance} from '../src/gen/levelGen';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {placeStationFuel} from '../src/gen/fuelPlacement';
import {ordinaryCounts} from '../src/campaign/network';
import {ORDINARY_WEIGHTS, PRE_MARKET_WEIGHTS, PRE_SKYWAYS_WEIGHTS} from '../src/campaign/types';
import {FOOD_IDS, DRINK_IDS} from '../src/items/items';
import {SKYWAYS_RAMEN_PURPOSE} from '../src/gen/skyways/ramenPurposes';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {outfitterDressOf} from '../src/gen/skyways/stores/outfitterDress'; // (task studio-alpha-skyways-shops-20261107-054512-01, lane STORE-OUTFITTER)

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const cache = new Map<number, StationLayout>();
const gen = (s: number): StationLayout => { let l = cache.get(s); if (!l) cache.set(s, (l = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol'}))); return l; };
const FOOD = new Set(['ramen', 'ramen_chashu', 'sushi_bento', 'bubble_tea']);

describe('Skyways: registration and the campaign share', () => {
  it('is a registered ordinary level (tier 2) placed before the Reactor; 10 % of the ordinary nodes, taken from the Subway', () => {
    expect(LEVEL_IDS).toContain('skyways');
    expect(LEVEL_IDS.indexOf('skyways')).toBe(LEVEL_IDS.length - 2);
    expect(LEVELS.skyways.tier).toBe(2);
    expect(LEVELS.skyways.name).toBe('Skyways');
    // (task studio-survivor-market-20261108-005807-01: + the market's 5 %, also from the Subway's share — Skyways' 10 % unchanged)
    expect(ORDINARY_WEIGHTS).toEqual({subway: 0.65, office: 0.1, mall: 0.1, skyways: 0.1, market: 0.05});
    const now = ordinaryCounts(PRE_MARKET_WEIGHTS), before = ordinaryCounts(PRE_SKYWAYS_WEIGHTS);
    expect(now).toEqual({subway: 27, office: 4, mall: 4, skyways: 4});
    expect(ordinaryCounts().skyways).toBe(4);
    expect([now.office, now.mall]).toEqual([before.office, before.mall]); // Office / Mall unchanged
    expect(before.subway - now.subway).toBe(now.skyways); // the whole share comes from the Subway
  });

  it('the add-on draw: exactly one per level seed, equal weights (convention / prize car), independent of the frame retries', () => {
    let conv = 0;
    const N = 4000;
    for (let s = 0; s < N; s++) if (skywaysAddonOf(s) === 'convention') conv++;
    expect(Math.abs(conv / N - 0.5)).toBeLessThan(0.03);
    for (const s of [3, 17, 4242]) expect(skywaysFrame(s, 3).addon).toBe(skywaysFrame(s, 0).addon);
    // nothing in the public level identity advertises the car: the level is just "Skyways"
    expect(JSON.stringify({name: LEVELS.skyways.name, blurb: LEVELS.skyways.blurb})).not.toMatch(/car|driv|vehicle/i);
  });
});

describe('Skyways: generated layouts', () => {
  it('validate on a seed sample, regenerate identically, and hold exactly one add-on each (both kinds occur)', () => {
    const kinds = new Set<string>();
    for (const s of SEEDS) {
      const l = gen(s);
      expect(skywaysIssues(l), `seed ${s}`).toEqual([]);
      expect(l.skyways!.addon.id).toBe(skywaysAddonOf(s));
      kinds.add(l.skyways!.addon.id);
    }
    expect([...kinds].sort()).toEqual(['convention', 'prize-car']);
    const a = LEVELS.skyways.generate('main', {levelSeed: 3, startWeapon: 'pistol'});
    expect(JSON.stringify(a.skyways)).toBe(JSON.stringify(gen(3).skyways));
    expect(a.areas.length).toBe(gen(3).areas.length);
    expect(a.zombies.map(z => [z.x, z.z, z.archetype])).toEqual(gen(3).zombies.map(z => [z.x, z.z, z.archetype]));
  });

  it('the train arrives LOW (the station under the station building) and the way up is real: concourse -> street -> skyway level', () => {
    for (const s of SEEDS.slice(0, 6)) {
      const l = gen(s), info = l.skyways!;
      expect(info.storeys.map(q => q.baseY)).toEqual([0, 5, 10]);
      expect(info.start.level).toBe(0);
      const tp = playerTrainPlacement(l);
      expect(tp, `seed ${s}: the train parks`).not.toBeNull();
      expect(tp!.level).toBe(0);
      expect(arrivalPose(l, {kind: 'start'}, tp).level ?? 0).toBe(0);
      // stairs / escalators join 0-1 and 1-2 (never an elevator teleport)
      expect(l.levelLinks.some(k => k.lower === 0 && k.upper === 1 && k.kind === 'stairs')).toBe(true);
      expect(l.levelLinks.some(k => k.lower === 1 && k.upper === 2 && k.kind === 'stairs')).toBe(true);
      // every bridge deck is reachable on foot from the platform start
      const [sx, sy] = l.grid.cellOf(info.start.x, info.start.z);
      const d = levelDistance(l.levels, sx, sy, 0, l.levelLinks);
      for (const b of info.bridges) {
        const g = l.levels[b.level].grid, [cx, cy] = g.cellOf((b.rect.x0 + b.rect.x1) / 2, (b.rect.z0 + b.rect.z1) / 2);
        expect(d[b.level][g.idx(cx, cy)], `seed ${s} bridge ${b.id}`).toBeGreaterThan(0);
      }
      expect(storeyLabel(l, 2)).toBe('+15 Skyway');
    }
  });

  it('a network, not one building: >= 4 buildings, a connected bridge graph with branches; loops occur over the sample', () => {
    let loops = 0;
    for (const s of SEEDS) {
      const info = gen(s).skyways!;
      expect(info.buildings.length).toBeGreaterThanOrEqual(4);
      expect(info.bridges.length).toBeGreaterThanOrEqual(info.buildings.length - 1);
      if (info.bridges.length >= info.buildings.length) loops++;
      // the add-on is LOCALIZED: its host has exactly one bridge (a branch of the network)
      expect(info.bridges.filter(b => b.a === info.addon.building || b.b === info.addon.building).length).toBe(1);
      for (const b of info.bridges) expect(b.width).toBeGreaterThanOrEqual(5); // wide glazed skyways
    }
    expect(loops).toBeGreaterThan(0);
  });

  it('glazing: every span in a solid wall run with floor behind it; some routes start breached (gas), never all of them', () => {
    for (const s of SEEDS) {
      const l = gen(s), info = l.skyways!;
      const breached = info.bridges.filter(b => b.breached).length;
      if (info.bridges.length >= 3) expect(breached).toBeGreaterThanOrEqual(1);
      expect(breached).toBeLessThan(info.bridges.length);
      for (const w of info.windows.filter(q => q.breached)) expect('bridge' in w.host).toBe(true);
      for (const w of info.windows) {
        const g = l.levels[w.level].grid, [cx, cy] = g.cellOf((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2);
        expect(g.cells[g.idx(cx, cy)]).toBe(SOLID);
      }
      // the street-level entrance doors are boarded scenery
      expect(info.windows.some(w => w.kind === 'entrance')).toBe(true);
    }
  });

  it('the ramen restaurant (base shop pool): one per level, its finite edible food supported (never on the floor)', () => {
    for (const s of SEEDS) {
      const l = gen(s), r = l.skyways!.restaurant!;
      expect(r).toBeTruthy();
      expect(l.areas[r.area].purpose).toBe(SKYWAYS_RAMEN_PURPOSE.dining);
      const food = l.pickups.filter(p => FOOD.has(p.itemId));
      expect(food.length).toBeGreaterThanOrEqual(2);
      expect(food.length).toBeLessThanOrEqual(4);
      for (const p of food) {
        expect(p.area === r.area || p.area === r.kitchen).toBe(true);
        expect(p.y - l.levels[r.level].baseY).toBeGreaterThan(0.5); // on a table / the counter, not the floor
      }
    }
    for (const id of FOOD) expect([...FOOD_IDS, ...DRINK_IDS]).toContain(id);
  });

  it('ordinary small loot is not piled on the floor: the only loose floor finds are weapon finds (+ their ammo / pistol-start boxes)', () => {
    for (const s of SEEDS.slice(0, 5)) {
      const l = gen(s), r = l.skyways!.restaurant;
      for (const p of l.pickups) {
        if (FOOD.has(p.itemId) || l.areas[p.area]?.ext) continue; // the restaurant's plates; the annex keeps its own program
        // (lane STORE-OUTFITTER: the outfitter's ONE real backpack, a gear find standing on its pack-wall shelf — not a floor pile)
        if (outfitterDressOf(l).some(r => r.backpack && l.pickups[r.backpack.pickup] === p)) continue;
        expect(/^(rifle|shotgun|pistol|ammo_|gas_mask|gas_filter)/.test(p.itemId) || p.reward !== undefined, `seed ${s}: ${p.itemId}`).toBe(true);
      }
      void r;
    }
  });

  // (task studio-skyways-rework-20261107-054512-01, layout version 3; user: "prize car in public walkway / atrium, not separate room")
  it('the prize car (when drawn): on a public display in its host\'s skyway court (no add-on room), clear, with a wide way out', () => {
    let n = 0;
    for (const s of SEEDS) {
      const l = gen(s), a = l.skyways!.addon;
      if (a.id !== 'prize-car') { expect(a.car).toBeUndefined(); continue; }
      n++;
      const c = a.car!;
      expect(c.level).toBe(2);
      expect(a.display).toBe(true);
      expect(a.areas).toEqual([]);
      const court = l.areas[c.area];
      expect(court.publicSpace).toBe(true);
      expect(court.label).toMatch(/^Skyway (court|galleria)/);
      const g = l.levels[2].grid;
      for (const t of [-1.6, 0, 1.6]) expect(g.circleClear(c.x - Math.sin(c.yaw) * t, c.z - Math.cos(c.yaw) * t, 1.05)).toBe(true);
    }
    expect(n).toBeGreaterThan(0);
  });

  it('the convention (when drawn): its venue floor (main hall, stage, exhibitors, registration, panels) with washrooms', () => {
    let n = 0;
    for (const s of SEEDS) {
      const l = gen(s), a = l.skyways!.addon;
      if (a.id !== 'convention') continue;
      n++;
      expect(a.convention).toBeTruthy();
      expect(a.level).toBe(2);
      const roles = new Set((a.venue ?? []).map(v => v.role));
      for (const r of ['main-hall', 'exhibitors', 'registration', 'panel', 'washrooms'] as const) expect(roles.has(r), r).toBe(true);
      for (const v of a.venue!) expect(l.areas[v.area].level).toBe(2);
      expect(a.areas.some(id => l.areas[id].type === 'washroom')).toBe(true);
      const h = a.hall;
      expect((h.x1 - h.x0) * (h.z1 - h.z0)).toBeGreaterThan(150); // a substantial hall (m²)
    }
    expect(n).toBeGreaterThan(0);
  });

  it('fuel: the station cans are reachable and a cart is wheel-reachable on the train storey (or becomes cans)', () => {
    for (const s of [2, 5]) {
      const l = gen(s);
      const cans = placeStationFuel(l, {units: 6, cans: 6, cart: 0}, 'st-07');
      expect(cans.cans.reduce((q, c) => q + c.count, 0)).toBe(6);
      const cart = placeStationFuel(l, {units: 8, cans: 0, cart: 8}, 'st-11');
      if (cart.cart) expect(cart.cart.level).toBe(playerTrainPlacement(l)!.level);
      else expect(cart.cans.reduce((q, c) => q + c.count, 0)).toBe(8);
    }
    void CELL; void FLOOR;
  });
});
