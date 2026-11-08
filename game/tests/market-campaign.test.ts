// Task studio-survivor-market-20261108-005807-01 (lane LEVEL): the Survivor Market in the campaign — NEW networks hold 2 of the 39
// ordinary stations as markets, taken from the Subway only (25 / 4 / 4 / 4 / 2 + the Reactor; start Subway, one Reactor); networks
// drawn before (27 / 4 / 4 / 4 and the pre-Skyways 31 / 4 / 4) stay valid and are never regenerated (saves keep their own copy); a
// save written before the market existed (no seeds.market) still loads with a deterministic default seed.
import {describe, expect, it} from 'vitest';
import {generateNetwork, ordinaryCounts, validateNetwork} from '../src/campaign/network';
import {NETWORK_SIZE, ORDINARY_WEIGHTS, PRE_MARKET_WEIGHTS, PRE_SKYWAYS_WEIGHTS} from '../src/campaign/types';
import {hashString} from '../src/core/rng';
import {stationKind} from '../src/ui/paperMap';
import {stationFuelPlan} from '../src/fuel/fuel';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;

const SEEDS = Array.from({length: 24}, (_, i) => (Math.imul(i + 1, 0x9e3779b1) >>> 0));
const count = (n: {nodes: {archetype: string}[]}) => n.nodes.reduce<Record<string, number>>((c, x) => ({...c, [x.archetype]: (c[x.archetype] ?? 0) + 1}), {});

describe('the Survivor Market in the campaign network', () => {
  it('new networks: 2 of 39 ordinary nodes are markets, all from the Subway share (25 / 4 / 4 / 4 / 2 + 1 Reactor)', () => {
    expect(ORDINARY_WEIGHTS.market).toBe(0.05);
    expect(ORDINARY_WEIGHTS.subway).toBe(0.65);
    const now = ordinaryCounts(), before = ordinaryCounts(PRE_MARKET_WEIGHTS);
    expect(now).toEqual({subway: 25, office: 4, mall: 4, skyways: 4, market: 2});
    expect([now.office, now.mall, now.skyways]).toEqual([before.office, before.mall, before.skyways]);
    expect(before.subway - now.subway).toBe(now.market);
    for (const s of SEEDS) {
      const net = generateNetwork(s);
      expect([s, validateNetwork(net)]).toEqual([s, []]);
      expect(count(net)).toEqual({subway: 25, office: 4, mall: 4, skyways: 4, market: 2, reactor: 1});
      expect(net.nodes.length).toBe(NETWORK_SIZE.ordinary + NETWORK_SIZE.reactor);
      const start = net.nodes.find(n => n.id === net.start)!;
      expect(start.archetype).toBe('subway');
      for (const m of net.nodes.filter(n => n.archetype === 'market')) {
        expect(stationKind(m, net)).toBe('market');
        expect(m.id).not.toBe(net.start);
        // the common station-fuel plan applies to a market node unchanged (a plan from the network seed + station id only)
        expect(stationFuelPlan(net.seed, m.id).units).toBeGreaterThan(0);
      }
    }
  });

  it('old networks stay valid as they are (no regeneration): the pre-market and pre-Skyways censuses', () => {
    for (const s of SEEDS.slice(0, 8)) {
      const old = generateNetwork(s, {weights: PRE_MARKET_WEIGHTS});
      expect(count(old).market).toBeUndefined();
      expect([s, validateNetwork(old)]).toEqual([s, []]);
      const older = generateNetwork(s, {weights: PRE_SKYWAYS_WEIGHTS, maintenanceRoute: false});
      expect([s, validateNetwork(older)]).toEqual([s, []]);
      // the census check still bites: a network with markets in the wrong numbers is rejected
      const bad = structuredClone(generateNetwork(s));
      bad.nodes.find(n => n.archetype === 'subway' && n.id !== bad.start)!.archetype = 'market';
      expect(validateNetwork(bad).some(e => /market nodes|subway nodes/.test(e))).toBe(true);
    }
  });
});

describe('saves from before the Survivor Market', () => {
  const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
  h.takeEntry();
  const BASE = h.file('arrival', 1) as Any;

  it('a run without seeds.market loads with a deterministic default (from its Subway seed); with one it is kept', () => {
    for (const drop of [['market'], ['market', 'skyways']]) {
      const f = structuredClone(BASE);
      for (const k of drop) delete f.run.seeds[k];
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok, drop.join('+')).toBe(true);
      if (r.ok) expect((r.value.run.seeds as Any).market).toBe(hashString('terminal-state:market-seed', f.run.seeds.subway >>> 0));
    }
    const kept = validateSaveFile(structuredClone(BASE));
    expect(kept.ok).toBe(true);
    if (kept.ok) expect((kept.value.run.seeds as Any).market).toBe(BASE.run.seeds.market);
  });
});
