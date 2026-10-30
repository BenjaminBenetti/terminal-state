import {describe, expect, it} from 'vitest';
import {
  CRITICAL, EMPTY_HP_DRAIN, HUNGER_DRAIN, LOW, SURVIVAL_START, Survival, THIRST_DRAIN, survivalTicks,
} from '../src/player/survival';
import {DRINK_IDS, FOOD_IDS, ITEMS, itemDef} from '../src/items/items';

/** Simulates the frame loop: 1/60 s steps, survival advances only in the 'playing' state. */
function run(s: Survival, seconds: number, state = 'playing'): number {
  let hp = 0;
  for (let t = 0; t < seconds; t += 1 / 60) hp += s.update(survivalTicks(state) ? 1 / 60 : 0).hpLoss;
  return hp;
}

describe('hunger and thirst', () => {
  it('starts at 80/80', () => {
    const s = new Survival();
    expect(SURVIVAL_START).toBe(80);
    expect([s.hunger, s.thirst]).toEqual([80, 80]);
  });

  it('drains slowly: about 8 food and 12 water over a 15-minute session', () => {
    const s = new Survival();
    run(s, 60);
    expect(s.hunger).toBeCloseTo(80 - 60 * HUNGER_DRAIN, 3);
    expect(s.thirst).toBeCloseTo(80 - 60 * THIRST_DRAIN, 3);
    const t = new Survival();
    run(t, 15 * 60);
    expect(80 - t.hunger).toBeGreaterThan(6);
    expect(80 - t.hunger).toBeLessThan(10);
    expect(80 - t.thirst).toBeGreaterThan(10);
    expect(80 - t.thirst).toBeLessThan(14);
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

  it('at 0 health drains very slowly (per depleted stat) and warnings fire once per threshold', () => {
    const s = new Survival();
    s.hunger = LOW + 0.001;
    const w1 = s.update(1).warnings;
    expect(w1.map(w => w.text)).toEqual([expect.stringMatching(/hungry/)]);
    expect(s.update(1).warnings).toEqual([]);
    s.hunger = CRITICAL - 1;
    expect(s.update(1).warnings[0].warn).toBe(true);
    s.hunger = 0;
    const hp = run(s, 6);
    expect(hp).toBeCloseTo(6 * EMPTY_HP_DRAIN, 1);
    s.thirst = 0;
    expect(run(s, 6)).toBeCloseTo(12 * EMPTY_HP_DRAIN, 1);
  });

  it('resets to 80/80 for a new station or retry', () => {
    const s = new Survival();
    run(s, 300);
    s.consume({hunger: -50});
    s.reset();
    expect([s.hunger, s.thirst, s.time]).toEqual([80, 80, 0]);
  });

  // + bread (task office-props-physics-scale-20261030, lane FURN: the bakery case's loaves are a food item now)
  it('defines 3 drinks and 5 foods with effects, use times, stacks and icons', () => {
    expect(DRINK_IDS.length).toBe(3);
    expect(FOOD_IDS.length).toBe(5);
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
