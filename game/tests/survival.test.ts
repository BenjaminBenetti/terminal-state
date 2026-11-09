import {describe, expect, it} from 'vitest';
import {
  CRITICAL, EMPTY_MAX_HP_PER_MIN, EMPTY_PAIN_EVERY_S, HUNGER_DRAIN, LOW, SURVIVAL_MAX, SURVIVAL_RATE, SURVIVAL_START, Survival, THIRST_DRAIN,
  survivalTicks,
} from '../src/player/survival';
import {DRINK_IDS, FOOD_IDS, ITEMS, itemDef} from '../src/items/items';

/** Simulates the frame loop: 1/60 s steps, survival advances only in the 'playing' state. Returns the health lost (`pains`: grunts). */
function run(s: Survival, seconds: number, state = 'playing', out?: {pains: number[]}, maxHp = 100): number {
  let hp = 0;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const r = s.update(survivalTicks(state) ? 1 / 60 : 0, maxHp);
    hp += r.hpLoss;
    if (r.pain) out?.pains.push(s.time);
  }
  return hp;
}

describe('hunger and thirst', () => {
  it('starts at 80/80', () => {
    const s = new Survival();
    expect(SURVIVAL_START).toBe(80);
    expect([s.hunger, s.thirst]).toEqual([80, 80]);
  });

  // Task studio-alpha-survival-controls-20261107-060450-01 (user: 8x faster, about 20 active minutes from full to empty)
  it('drains 8x the former rates: food full -> empty in ~22.9 active minutes, water in ~15.6 (water still first)', () => {
    expect(SURVIVAL_RATE).toBe(8);
    expect(HUNGER_DRAIN).toBeCloseTo(8 / 110, 12);
    expect(THIRST_DRAIN).toBeCloseTo(8 / 75, 12);
    const s = new Survival();
    run(s, 60);
    expect(s.hunger).toBeCloseTo(80 - 60 * HUNGER_DRAIN, 3);
    expect(s.thirst).toBeCloseTo(80 - 60 * THIRST_DRAIN, 3);
    // full -> empty, in active minutes (the frame loop), and the 80 at spawn
    const full = (stat: 'hunger' | 'thirst') => {
      const t = new Survival();
      t.hunger = t.thirst = SURVIVAL_MAX;
      let sec = 0;
      while (t[stat] > 0 && sec < 3600) { t.update(1 / 60); sec += 1 / 60; }
      return sec / 60;
    };
    expect(full('hunger')).toBeCloseTo(110 * 100 / 8 / 60, 1); // 22.9 min
    expect(full('thirst')).toBeCloseTo(75 * 100 / 8 / 60, 1); // 15.6 min
    expect((full('hunger') + full('thirst')) / 2).toBeGreaterThan(18); // about 20 active minutes
    expect((full('hunger') + full('thirst')) / 2).toBeLessThan(22);
  });

  it('is frozen while paused, in the inventory, menus, death and win screens', () => {
    for (const state of ['paused', 'inventory', 'title', 'loading', 'dead', 'won', 'error']) {
      const s = new Survival();
      run(s, 120, state);
      expect([s.hunger, s.thirst, s.time]).toEqual([80, 80, 0]);
    }
    expect(survivalTicks('playing')).toBe(true);
  });

  it('consuming food/drink restores the right stat and clamps at 100', () => {
    const s = new Survival();
    expect(s.consume(itemDef('water'))).toEqual({hunger: 0, thirst: 20}); // 80 + 35 → clamped 100
    expect(s.thirst).toBe(100);
    const d = s.consume(itemDef('chips'));
    expect(d.hunger).toBe(14);
    expect(d.thirst).toBe(-4);
    expect(Survival.describe(d)).toBe('+14 food · −4 water');
    s.hunger = 95;
    s.consume(itemDef('beans'));
    expect(s.hunger).toBe(100);
    s.thirst = 2;
    s.consume(itemDef('noodles'));
    expect(s.thirst).toBe(0); // never negative
  });

  it('blocks only pointless uses (full stat / full health)', () => {
    const s = new Survival();
    expect(s.blockReason(itemDef('water'), 100, 100)).toBeNull();
    s.thirst = 100;
    expect(s.blockReason(itemDef('water'), 100, 100)).toMatch(/not thirsty/);
    expect(s.blockReason(itemDef('chocolate'), 100, 100)).toBeNull();
    s.hunger = 100;
    expect(s.blockReason(itemDef('chocolate'), 100, 100)).toMatch(/not hungry/);
    expect(s.blockReason(itemDef('bandage'), 100, 100)).toMatch(/full health/);
    expect(s.blockReason(itemDef('bandage'), 60, 100)).toBeNull();
  });

  it('warnings fire once per threshold', () => {
    const s = new Survival();
    s.thirst = 100; // (thirst stays above its thresholds for these steps)
    s.hunger = LOW + 0.0001;
    const w1 = s.update(0.01).warnings;
    expect(w1.map(w => w.text)).toEqual([expect.stringMatching(/hungry/)]);
    expect(s.update(0.01).warnings).toEqual([]);
    s.hunger = CRITICAL - 1;
    expect(s.update(0.01).warnings[0].warn).toBe(true);
  });

  // Task studio-alpha-survival-controls-20261107-060450-01: at 0, 5 % of MAX health per active minute — one shared rate (both empty is
  // NOT double), smooth (a little every frame), and the pain grunt on becoming empty then once a minute; nothing while frozen.
  it('empty food OR water: 5 % of max health per active minute, shared; smooth; never while frozen', () => {
    expect(EMPTY_MAX_HP_PER_MIN).toBe(0.05);
    const s = new Survival();
    s.thirst = 100;
    s.hunger = 0;
    expect(run(s, 60)).toBeCloseTo(5, 2); // 100 max HP -> 5 HP in a minute
    s.thirst = 0;
    expect(run(s, 60)).toBeCloseTo(5, 2); // both empty: still 5, not 10
    expect(run(s, 60, 'playing', undefined, 140)).toBeCloseTo(7, 2); // of MAX health (140 -> 7), not of what is left
    // smooth: a frame takes a frame's share, not a lump
    const r = s.update(1 / 60);
    expect(r.hpLoss).toBeCloseTo(5 / 60 / 60, 6);
    for (const state of ['paused', 'inventory', 'map', 'title', 'loading', 'dead', 'won']) expect(run(s, 30, state)).toBe(0);
    // recovered: no more loss
    s.consume({hunger: 30, thirst: 30});
    expect(run(s, 60)).toBe(0);
    // the empty empty-transition frame itself is not charged (as before): the loss starts once the stat stays at 0
    const t = new Survival();
    t.thirst = 100;
    t.hunger = HUNGER_DRAIN / 120; // empties during the next frame
    expect(t.update(1 / 60).hpLoss).toBe(0);
    expect(t.update(1 / 60).hpLoss).toBeGreaterThan(0);
  });

  it('the pain grunt: on becoming empty, then once per active minute while empty; frozen time and recovery reset it', () => {
    expect(EMPTY_PAIN_EVERY_S).toBe(60);
    const s = new Survival();
    s.thirst = 100;
    s.hunger = 0;
    const o = {pains: [] as number[]};
    run(s, 185, 'playing', o);
    expect(o.pains.length).toBe(4); // t ~0, 60, 120, 180
    for (let i = 1; i < o.pains.length; i++) expect(o.pains[i] - o.pains[i - 1]).toBeGreaterThanOrEqual(59.9);
    // paused / menus: no grunt and no catch-up afterwards
    const o2 = {pains: [] as number[]};
    run(s, 600, 'paused', o2);
    run(s, 1, 'playing', o2);
    expect(o2.pains).toEqual([]);
    // a long step (a hitch) is at most one grunt
    const big = {pains: 0};
    if (s.update(200).pain) big.pains++;
    expect(big.pains).toBeLessThanOrEqual(1);
    // recovered, then empty again: a fresh grunt at once
    s.hunger = 50;
    expect(s.update(1 / 60).pain).toBe(false);
    s.hunger = 0;
    s.update(1 / 60); // the frame it is found empty again: grunt
    const again = {pains: [] as number[]};
    s.hunger = 50; s.update(1 / 60); s.hunger = 0;
    run(s, 1, 'playing', again);
    expect(again.pains.length).toBe(1);
    // reset clears it
    s.reset();
    expect(s.update(1 / 60).pain).toBe(false);
  });

  it('resets to 80/80 for a new station or retry', () => {
    const s = new Survival();
    run(s, 300);
    s.consume({hunger: -50});
    s.reset();
    expect([s.hunger, s.thirst, s.time]).toEqual([80, 80, 0]);
  });

  // + bread (task office-props-physics-scale-20261030, lane FURN: the bakery case's loaves are a food item now)
  // + the Skyways ramen restaurant's NEW items (task studio-skyways-level-20261106-054448, lane FOOD: items/skywaysFood.ts): foods 5 -> 8
  //   (ramen, ramen_chashu, sushi_bento), drinks 3 -> 4 (bubble_tea) — a re-pin for added items, every existing row unchanged
  // + the 24 pantry items (task studio-food-shelf-production-20261109-002816-01, lane ITEMS: items/pantryFood.ts F01..F18, D01, D02, D04..D07):
  //   foods 8 -> 26, drinks 4 -> 10 — a re-pin for added items only (every existing item and the rule below unchanged)
  it('defines 10 drinks and 26 foods with effects, use times, stacks and icons', () => {
    expect(DRINK_IDS.length).toBe(10);
    expect(FOOD_IDS.length).toBe(26);
    for (const id of [...DRINK_IDS, ...FOOD_IDS]) {
      const d = ITEMS[id];
      expect(d.kind).toBe('consumable');
      expect(d.icon).toBe(id);
      expect(d.useTime).toBeGreaterThanOrEqual(1.2);
      expect(d.useTime).toBeLessThanOrEqual(2.5);
      expect(d.stackMax).toBeGreaterThan(1);
      expect((DRINK_IDS as readonly string[]).includes(id) ? d.thirst! > 0 && d.verb === 'drink' : d.hunger! > 0 && d.verb === 'eat').toBe(true);
    }
  });
});
