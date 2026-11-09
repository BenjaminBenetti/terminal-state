// Task studio-bunker-level-20261109-072224-01 (lane LEVEL): the Bunker in the campaign — NEW networks hold 2 of the 39 ordinary stations
// as Bunkers, taken from the Subway's share ONLY (23 / 4 / 4 / 4 / 2 / 2 + the Reactor; start Subway, one Reactor); networks drawn before
// (the market's 25 / 4 / 4 / 4 / 2, the pre-market 27 / 4 / 4 / 4, the pre-Skyways 31 / 4 / 4) stay valid and are never regenerated or
// retrofitted (a save keeps its own network copy); a save written before the Bunker existed (no seeds.bunker) still loads with a
// deterministic default seed; a Bunker station records its layout version (lane 'bunker.layout' v1) for future generator changes.
import {describe, expect, it} from 'vitest';
import {generateNetwork, ordinaryCounts, validateNetwork} from '../src/campaign/network';
import {NETWORK_SIZE, ORDINARY_WEIGHTS, PRE_BUNKER_WEIGHTS, PRE_MARKET_WEIGHTS, PRE_SKYWAYS_WEIGHTS} from '../src/campaign/types';
import {hashString} from '../src/core/rng';
import {stationKind} from '../src/ui/paperMap';
import {stationFuelPlan} from '../src/fuel/fuel';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';
import {BUNKER_LAYOUT_LANE, BUNKER_LAYOUT_VERSION, bunkerLayoutVersionFor} from '../src/gen/bunker/layoutVersion';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;

const SEEDS = Array.from({length: 24}, (_, i) => (Math.imul(i + 3, 0x9e3779b1) >>> 0));
const count = (n: {nodes: {archetype: string}[]}) => n.nodes.reduce<Record<string, number>>((c, x) => ({...c, [x.archetype]: (c[x.archetype] ?? 0) + 1}), {});

describe('the Bunker in the campaign network', () => {
  it('the weights: 5 % appended last, all of it from the Subway (60 / 10 / 10 / 10 / 5 / 5); largest remainder 23 / 4 / 4 / 4 / 2 / 2', () => {
    expect(ORDINARY_WEIGHTS).toEqual({subway: 0.6, office: 0.1, mall: 0.1, skyways: 0.1, market: 0.05, bunker: 0.05});
    expect(Object.keys(ORDINARY_WEIGHTS).at(-1)).toBe('bunker'); // appended last: the earlier archetypes' placement draws are unchanged
    expect(PRE_BUNKER_WEIGHTS).toEqual({subway: 0.65, office: 0.1, mall: 0.1, skyways: 0.1, market: 0.05});
    const now = ordinaryCounts(), before = ordinaryCounts(PRE_BUNKER_WEIGHTS);
    expect(now).toEqual({subway: 23, office: 4, mall: 4, skyways: 4, market: 2, bunker: 2});
    expect(before).toEqual({subway: 25, office: 4, mall: 4, skyways: 4, market: 2});
    expect([now.office, now.mall, now.skyways, now.market]).toEqual([before.office, before.mall, before.skyways, before.market]);
    expect(before.subway - now.subway).toBe(now.bunker); // the whole share comes from the Subway
    expect(Object.values(now).reduce((a, b) => a + b, 0)).toBe(NETWORK_SIZE.ordinary);
  });

  it('new networks: 2 Bunker nodes (never the start), their map kind, the common fuel plan; 23 / 4 / 4 / 4 / 2 / 2 + 1 Reactor', () => {
    for (const s of SEEDS) {
      const net = generateNetwork(s);
      expect([s, validateNetwork(net)]).toEqual([s, []]);
      expect(count(net)).toEqual({subway: 23, office: 4, mall: 4, skyways: 4, market: 2, bunker: 2, reactor: 1});
      expect(net.nodes.length).toBe(NETWORK_SIZE.ordinary + NETWORK_SIZE.reactor);
      expect(net.nodes.find(n => n.id === net.start)!.archetype).toBe('subway');
      for (const b of net.nodes.filter(n => n.archetype === 'bunker')) {
        expect(stationKind(b, net)).toBe('bunker');
        expect(b.id).not.toBe(net.start);
        expect(b.id).not.toBe(net.reactor);
        expect(stationFuelPlan(net.seed, b.id).units).toBeGreaterThan(0); // the shared station fuel plan, unchanged
      }
    }
  });

  it('appended last: for a network seed every Office / Mall / Skyways / Market node of the pre-Bunker draw keeps its station, two Subway nodes became Bunkers', () => {
    for (const s of SEEDS.slice(0, 12)) {
      const now = generateNetwork(s), old = generateNetwork(s, {weights: PRE_BUNKER_WEIGHTS});
      const arch = (n: typeof now, id: string) => n.nodes.find(x => x.id === id)?.archetype;
      // the graph (ids, positions, lines) is the same board; the archetypes differ only where a Subway became a Bunker
      expect(now.nodes.map(n => n.id)).toEqual(old.nodes.map(n => n.id));
      const changed = now.nodes.filter(n => arch(old, n.id) !== n.archetype);
      expect(changed.map(n => [arch(old, n.id), n.archetype])).toEqual([['subway', 'bunker'], ['subway', 'bunker']]);
    }
  });

  it('old networks stay valid as they are (never regenerated, never retrofitted): the pre-Bunker, pre-market and pre-Skyways censuses', () => {
    for (const s of SEEDS.slice(0, 8)) {
      const old = generateNetwork(s, {weights: PRE_BUNKER_WEIGHTS});
      expect(count(old).bunker).toBeUndefined();
      expect([s, validateNetwork(old)]).toEqual([s, []]);
      expect([s, validateNetwork(generateNetwork(s, {weights: PRE_MARKET_WEIGHTS}))]).toEqual([s, []]);
      expect([s, validateNetwork(generateNetwork(s, {weights: PRE_SKYWAYS_WEIGHTS, maintenanceRoute: false}))]).toEqual([s, []]);
      // the census check still bites: a network with Bunkers in the wrong numbers is rejected
      const bad = structuredClone(generateNetwork(s));
      bad.nodes.find(n => n.archetype === 'subway' && n.id !== bad.start)!.archetype = 'bunker';
      expect(validateNetwork(bad).some(e => /bunker nodes|subway nodes/.test(e))).toBe(true);
    }
  });

  it('a save carrying a pre-Bunker network loads with exactly that network (no Bunker injected)', () => {
    const net = generateNetwork(SEEDS[0], {weights: PRE_BUNKER_WEIGHTS});
    const h = new Harness(fixtureCampaign({network: net, current: net.start, known: [net.start], visited: [net.start]}));
    h.takeEntry();
    const r = validateSaveFile(h.file('arrival', 1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const loaded = (r.value.run as Any).campaign.network;
    expect(loaded.nodes.map((n: {archetype: string}) => n.archetype)).toEqual(net.nodes.map(n => n.archetype));
    expect(count(loaded).bunker).toBeUndefined();
  });
});

describe('saves from before the Bunker', () => {
  const h = new Harness(fixtureCampaign({current: sid(1), known: [sid(0), sid(1)], visited: [sid(0), sid(1)]}));
  h.takeEntry();
  const BASE = h.file('arrival', 1) as Any;

  it('a run without seeds.bunker (also without seeds.market / seeds.skyways) loads with a deterministic default from its Subway seed; with one it is kept', () => {
    for (const drop of [['bunker'], ['bunker', 'market'], ['bunker', 'market', 'skyways']]) {
      const f = structuredClone(BASE);
      for (const k of drop) delete f.run.seeds[k];
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok, drop.join('+')).toBe(true);
      if (r.ok) expect((r.value.run.seeds as Any).bunker).toBe(hashString('terminal-state:bunker-seed', f.run.seeds.subway >>> 0));
    }
    const kept = validateSaveFile(structuredClone(BASE));
    expect(kept.ok).toBe(true);
    if (kept.ok) expect((kept.value.run.seeds as Any).bunker).toBe(BASE.run.seeds.bunker);
  });
});

describe('the Bunker layout version lane (bunker.layout)', () => {
  it('v1 from the first release; a recorded version is kept; a never-entered station builds the current one', () => {
    expect(BUNKER_LAYOUT_LANE).toBe('bunker.layout');
    expect(BUNKER_LAYOUT_VERSION).toBe(1);
    expect(bunkerLayoutVersionFor(undefined)).toBe(BUNKER_LAYOUT_VERSION);
    expect(bunkerLayoutVersionFor({visits: 0, lanes: {}})).toBe(BUNKER_LAYOUT_VERSION);
    expect(bunkerLayoutVersionFor({visits: 3, lanes: {[BUNKER_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    expect(bunkerLayoutVersionFor({visits: 2, lanes: {}})).toBe(1); // (entered without a record: the first build, forever)
    for (const v of [0, 1.5, 99, '1', null]) expect(bunkerLayoutVersionFor({visits: 0, lanes: {[BUNKER_LAYOUT_LANE]: {v}}})).toBe(BUNKER_LAYOUT_VERSION);
  });
});
