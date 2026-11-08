// Task studio-survivor-market-20261108-005807-01 (lane HUMANS): the market humans' seeded looks and registry data (pure logic;
// market/humanLooks.ts). Determinism, trader distinctness, variety, fitted-only wearables, the lazy model key rule, the clip set.
import {describe, expect, it} from 'vitest';
import {HUMAN_CLIPS, HUMAN_SLOTS, MARKET_HUMAN_KEY, SPOT_CLIP, humanLookKey, marketCast, marketHumanModelKeys, pickHumanLook, type HumanAvailability, type HumanSlot} from '../src/market/humanLooks';
import type {MarketSpot} from '../src/gen/market/marketTypes';

const WEAR: Record<string, [string, HumanSlot][]> = {
  m1: [['flannel', 'upper'], ['hoodie', 'upper'], ['coat', 'upper'], ['cargo', 'lower'], ['jeans', 'lower'], ['cap', 'head'], ['beanie', 'head']],
  f1: [['hoodie', 'upper'], ['sweater', 'upper'], ['jeans', 'lower'], ['cap', 'head']],
  m2: [['coat', 'upper'], ['sweater', 'upper'], ['slacks', 'lower'], ['hardhat', 'head']],
  f2: [['sweater', 'upper'], ['trench', 'upper'], ['slacks', 'lower'], ['beanie', 'head']],
  m3: [['hoodie', 'upper'], ['hivis', 'upper'], ['jeans', 'lower'], ['beanie', 'head'], ['hardhat', 'head']],
};
/** A stand-in availability: the coat may never be worn over cargo on m1 (a per-body layering exclusion). */
const AV: HumanAvailability = {
  bodies: Object.keys(WEAR),
  wear: b => (WEAR[b] ?? []).map(([id, slot]) => ({id, slot})),
  compatible: (b, x, y) => !(b === 'm1' && [x, y].includes('coat') && [x, y].includes('cargo')),
};

describe('market human looks', () => {
  it('are deterministic per station seed and differ between seeds', () => {
    const a = marketCast(1234, 6, 10, AV), b = marketCast(1234, 6, 10, AV), c = marketCast(98765, 6, 10, AV);
    expect(a).toEqual(b);
    expect([...a.traders, ...a.residents].map(humanLookKey)).not.toEqual([...c.traders, ...c.residents].map(humanLookKey));
  });

  it('gives the six traders pairwise distinct looks, the first five on five different bodies', () => {
    for (const seed of [1, 2, 3, 77, 4242, 0x7fffffff]) {
      const {traders} = marketCast(seed, 6, 0, AV);
      expect(new Set(traders.map(humanLookKey)).size).toBe(6);
      expect(new Set(traders.slice(0, 5).map(t => t.body)).size).toBe(5);
    }
  });

  it('only uses fitted, compatible wearables of the right slot, and a stature scale within 0.95..1.05', () => {
    for (let seed = 1; seed < 40; seed++) {
      const {traders, residents} = marketCast(seed, 6, 12, AV);
      for (const l of [...traders, ...residents]) {
        expect(AV.bodies).toContain(l.body);
        const ids = Object.entries(l.wear).map(([slot, id]) => { expect(WEAR[l.body]).toContainEqual([id, slot]); return id!; });
        for (const x of ids) for (const y of ids) if (x !== y) expect(AV.compatible(l.body, x, y)).toBe(true);
        expect(l.scale).toBeGreaterThanOrEqual(0.95);
        expect(l.scale).toBeLessThanOrEqual(1.05);
      }
    }
  });

  it('varies the residents: every body, base-layer-only people and layered outfits all occur', () => {
    const looks = Array.from({length: 40}, (_, i) => marketCast(500 + i, 6, 12, AV).residents).flat();
    expect(new Set(looks.map(l => l.body))).toEqual(new Set(AV.bodies));
    expect(looks.some(l => !l.wear.upper)).toBe(true);
    expect(looks.some(l => l.wear.upper && l.wear.lower)).toBe(true);
    expect(looks.some(l => l.wear.head)).toBe(true);
    expect(new Set(looks.map(humanLookKey)).size).toBeGreaterThan(60);
  });

  it('never touches Math.random (own hash streams only)', () => {
    const orig = Math.random;
    Math.random = () => { throw new Error('Math.random used'); };
    try { marketCast(9, 6, 12, AV); pickHumanLook(9, 'resident', 3, AV); } finally { Math.random = orig; }
  });

  it('asks for the lazy cast model only on a layout with a market', () => {
    expect(marketHumanModelKeys({})).toEqual([]);
    expect(marketHumanModelKeys({market: undefined})).toEqual([]);
    expect(marketHumanModelKeys({market: {v: 1, stalls: [], spots: [], residents: 0}})).toEqual([MARKET_HUMAN_KEY]);
  });

  it('maps every resident spot kind to a HEALTHY clip (never a zombie clip)', () => {
    const kinds: MarketSpot['kind'][] = ['idle', 'sit', 'work', 'cook', 'sleep', 'chat'];
    for (const k of kinds) expect(HUMAN_CLIPS).toContain(SPOT_CLIP[k]);
    for (const z of ['Attack', 'Hit', 'Death', 'Run']) expect(HUMAN_CLIPS as readonly string[]).not.toContain(z);
    expect(HUMAN_SLOTS).not.toContain('face');
  });
});
