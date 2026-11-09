// Task studio-bunker-level-20261109-072224-01 (lane OBJECTIVE): the Bunker objective's PURE core (world/bunker/objectiveState.ts) — the strict
// 'bunker.state' validator (and its registration in the save validator), the record loader, the intel choice (unknown Reactor -> unknown
// Market -> unknown other node -> charted; deterministic per Bunker station), campaign/discovery.ts revealStations (map knowledge only),
// the intel wording, and the core screen's drawing / redraw key (world/bunker/coreScreen.ts) on the canvas shim.
import {describe, expect, it} from 'vitest';
import {
  BUNKER_LANE, bunkerIntelText, bunkerStateProblem, chooseBunkerIntel, coreAlive, freshBunkerState, loadBunkerState, onlineCount,
  type BunkerStateJSON, type BunkerStateV1JSON,
} from '../src/world/bunker/objectiveState';
import {CORE_SCREEN_PX, coreScreenKey, drawCoreScreen, type CoreScreenModel} from '../src/world/bunker/coreScreen';
import {revealStations, validateCampaign, visibleNodes} from '../src/campaign/discovery';
import type {CampaignState} from '../src/campaign/types';
import {checksumOf} from '../src/save/checksum';
import {saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {parseSaveText, validateSaveFile} from '../src/save/validate';
import {Harness, fixtureCampaign, sid} from './helpers/saveFixture';
import {installCanvasShim} from './helpers/canvas2d';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- (test mutation of untrusted data)
type Any = any;

const IDS = ['gen-0', 'gen-1', 'gen-2'];
const AT = '2026-11-09T08:15:00.000Z';
// (task studio-bunker-rework-20261109-205115-01: version-1 records stay valid in saves — they migrate on load — and version 2 stores the
// paid fuel quantity per generator + the cargo lift's stop)
const good: unknown[] = [
  freshBunkerState(IDS),
  {v: 2, gens: {'gen-0': 'online', 'gen-1': 'fuelled', 'gen-2': 'off'}, fuel: {'gen-0': 1, 'gen-1': 1, 'gen-2': 0}},
  {v: 2, gens: {'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'}, fuel: {'gen-0': 1, 'gen-1': 1, 'gen-2': 1}, intel: {claimedAt: AT, kind: 'reactor', nodeId: 'st-39'}, lift: {stop: 3}},
  {v: 2, gens: {}, fuel: {}},
  {v: 1, gens: {'gen-0': 'online', 'gen-1': 'fuelled', 'gen-2': 'off'}},
  {v: 1, gens: {'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'}, intel: {claimedAt: AT, kind: 'reactor', nodeId: 'st-39'}},
  {v: 1, gens: {'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'}, intel: {claimedAt: AT, kind: 'market', nodeId: 'st-07'}},
  {v: 1, gens: {'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'}, intel: {claimedAt: AT, kind: 'node', nodeId: 'st-21'}},
  {v: 1, gens: {'gen-0': 'off', 'gen-1': 'off', 'gen-2': 'off'}, intel: {claimedAt: AT, kind: 'charted'}}, // (a Retry after a claim: the entry's generators + the claim)
  {v: 1, gens: {}},
];

/** A campaign on the fixture network with Survivor Markets at st-07 / st-14 / st-30 (the save fixture network has none). */
function marketCampaign(o: Partial<CampaignState> = {}): CampaignState {
  const c = fixtureCampaign({current: sid(3), known: [sid(0), sid(1), sid(2), sid(3), sid(4)], visited: [sid(0), sid(1), sid(2), sid(3)], ...o});
  for (const n of c.network.nodes) if ([7, 14, 30].map(sid).includes(n.id)) n.archetype = 'market';
  return c;
}

describe('bunker.state: the strict validator and the loader', () => {
  it('accepts every well-formed record', () => {
    for (const r of good) expect(bunkerStateProblem(r), JSON.stringify(r)).toBeNull();
    expect(BUNKER_LANE).toBe('bunker.state');
  });

  it('refuses malformed records with a reason', () => {
    const bad: [unknown, RegExp][] = [
      [null, /must be an object/], [[], /must be an object/], ['x', /must be an object/],
      [{v: 1, gens: {}, extra: 1}, /unexpected bunker objective field 'extra'/],
      [{v: 3, gens: {}}, /unsupported bunker objective version/],
      [{v: 2, gens: {}}, /fuel must be an object/],
      [{v: 2, gens: {'gen-0': 'off'}, fuel: {}}, /gen-0 has a malformed fuel quantity/],
      [{v: 2, gens: {'gen-0': 'off'}, fuel: {'gen-0': 0.5}}, /gen-0 has a malformed fuel quantity/],
      [{v: 2, gens: {'gen-0': 'off'}, fuel: {'gen-0': 2}}, /gen-0 has a malformed fuel quantity/],
      [{v: 2, gens: {'gen-0': 'fuelled'}, fuel: {'gen-0': 0}}, /gen-0: state and fuel disagree/],
      [{v: 2, gens: {'gen-0': 'online'}, fuel: {'gen-0': 0}}, /gen-0: state and fuel disagree/],
      [{v: 2, gens: {'gen-0': 'off'}, fuel: {'gen-0': 1}}, /gen-0: state and fuel disagree/],
      [{v: 2, gens: {}, fuel: {'gen-5': 0}}, /fuel for an unknown generator/],
      [{v: 2, gens: {}, fuel: {}, lift: {stop: -1}}, /lift stop/],
      [{v: 2, gens: {}, fuel: {}, lift: {stop: 2, y: 3}}, /lift record/],
      [{v: 2, gens: {}, fuel: {}, cans: 3}, /unexpected bunker objective field 'cans'/],
      [{v: 1, gens: {}, fuel: {}}, /unexpected bunker objective field 'fuel'/],
      [{v: 1}, /generators must be an object/], [{v: 1, gens: []}, /generators must be an object/],
      [{v: 1, gens: {'gen-x': 'off'}}, /malformed bunker generator id/], [{v: 1, gens: {reactor: 'off'}}, /malformed bunker generator id/],
      [{v: 1, gens: {'gen-0': 'running'}}, /unknown state/], [{v: 1, gens: {'gen-0': 1}}, /unknown state/],
      [{v: 1, gens: Object.fromEntries(Array.from({length: 9}, (_, i) => [`gen-${i}`, 'off']))}, /at most 8/],
      [{v: 1, gens: {}, intel: 'reactor'}, /intel must be an object/],
      [{v: 1, gens: {}, intel: {claimedAt: AT, kind: 'reactor', nodeId: 'st-39', fuel: 4}}, /unexpected bunker intel field 'fuel'/],
      [{v: 1, gens: {}, intel: {kind: 'reactor', nodeId: 'st-39'}}, /claim time/],
      [{v: 1, gens: {}, intel: {claimedAt: 'yesterday', kind: 'reactor', nodeId: 'st-39'}}, /claim time/],
      [{v: 1, gens: {}, intel: {claimedAt: AT, kind: 'loot', nodeId: 'st-39'}}, /unknown kind/],
      [{v: 1, gens: {}, intel: {claimedAt: AT, kind: 'charted', nodeId: 'st-39'}}, /charted bunker intel names no station/],
      [{v: 1, gens: {}, intel: {claimedAt: AT, kind: 'node'}}, /must name the revealed station/],
      [{v: 1, gens: {}, intel: {claimedAt: AT, kind: 'market', nodeId: 'st 07; drop'}}, /must name the revealed station/],
    ];
    for (const [v, re] of bad) expect(bunkerStateProblem(v), JSON.stringify(v)).toMatch(re);
  });

  it('loads a copy of a valid record (missing generators off, never aliased); a malformed / absent one is fresh', () => {
    const stored: BunkerStateV1JSON = {v: 1, gens: {'gen-0': 'online', 'gen-2': 'fuelled'}, intel: {claimedAt: AT, kind: 'reactor', nodeId: 'st-39'}};
    const st = loadBunkerState(stored, IDS);
    // version 1 -> 2: fuelled / online were PAID in full (their can was poured), off paid nothing; the states and the claim unchanged
    expect(st).toEqual({v: 2, gens: {'gen-0': 'online', 'gen-1': 'off', 'gen-2': 'fuelled'}, fuel: {'gen-0': 1, 'gen-1': 0, 'gen-2': 1}, intel: stored.intel});
    st.gens['gen-1'] = 'fuelled';
    st.intel!.kind = 'charted';
    expect(stored.gens['gen-1']).toBeUndefined();
    expect(stored.intel!.kind).toBe('reactor');
    expect(loadBunkerState(undefined, IDS)).toEqual(freshBunkerState(IDS));
    expect(loadBunkerState({v: 9, gens: {'gen-0': 'online'}}, IDS)).toEqual(freshBunkerState(IDS));
    expect(onlineCount(st, IDS)).toBe(1);
    expect(coreAlive(st, IDS)).toBe(false);
    expect(coreAlive({v: 2, gens: {'gen-0': 'online', 'gen-1': 'online', 'gen-2': 'online'}, fuel: {'gen-0': 1, 'gen-1': 1, 'gen-2': 1}}, IDS)).toBe(true);
    expect(coreAlive({v: 2, gens: {}, fuel: {}}, [])).toBe(false); // no generators: never "alive"
  });

  it('is registered in the save validator: a good lane round-trips through the save text, a malformed one is refused', () => {
    const h = new Harness(fixtureCampaign({current: sid(3), known: [sid(0), sid(1), sid(2), sid(3), sid(4)], visited: [sid(0), sid(1), sid(2), sid(3)]}));
    h.run.memory().visits = 1;
    const rec = good[2];
    h.run.setLaneStore(BUNKER_LANE, rec);
    const file = h.file('arrival', 1) as Any;
    const p = parseSaveText(saveFileText(file));
    expect(p.ok, p.ok ? '' : p.error).toBe(true);
    expect((p as {value: SaveFileV1Like}).value.run.memories[`${sid(3)}:main`].lanes[BUNKER_LANE]).toEqual(rec);
    const rejects = (mut: (f: Any) => void, re: RegExp) => {
      const f = structuredClone(file);
      mut(f);
      f.checksum = checksumOf(f.run);
      const r = validateSaveFile(f);
      expect(r.ok).toBe(false);
      expect((r as {error: string}).error).toMatch(re);
    };
    rejects(f => { f.run.memories[`${sid(3)}:main`].lanes[BUNKER_LANE].gens['gen-1'] = 'refunded'; }, /bunker generator gen-1 has an unknown state/);
    rejects(f => { f.run.memories[`${sid(3)}:main`].lanes[BUNKER_LANE].intel.kind = 'loot'; }, /bunker intel has an unknown kind/);
    rejects(f => { f.run.memories[`${sid(3)}:main`].lanes[BUNKER_LANE] = {v: 1, gens: {}, cans: 3}; }, /unexpected bunker objective field 'cans'/);
  });
});

describe('the intel choice (at claim time, from the current knowledge)', () => {
  it('priority: the unknown Reactor, then an unknown Market, then an unknown other node, then charted', () => {
    let c = marketCampaign();
    const net = c.network;
    expect(c.known.includes(net.reactor)).toBe(false);
    expect(chooseBunkerIntel(c, sid(3))).toEqual({kind: 'reactor', nodeId: net.reactor});
    c = revealStations(c, [net.reactor]);
    const m1 = chooseBunkerIntel(c, sid(3));
    expect(m1.kind).toBe('market');
    expect([7, 14, 30].map(sid)).toContain(m1.nodeId);
    // every market known -> an unknown other node (never the Bunker itself, never a known one)
    c = revealStations(c, [7, 14, 30].map(sid));
    const n1 = chooseBunkerIntel(c, sid(3));
    expect(n1.kind).toBe('node');
    expect(c.known.includes(n1.nodeId!)).toBe(false);
    expect(n1.nodeId).not.toBe(sid(3));
    // everything known -> charted (no invented reward); the 1337 cheat knows everything too
    c = revealStations(c, net.nodes.map(n => n.id));
    expect(chooseBunkerIntel(c, sid(3))).toEqual({kind: 'charted'});
    expect(chooseBunkerIntel({...marketCampaign(), cheat: true}, sid(3))).toEqual({kind: 'charted'});
  });

  it('a known market is never chosen; with one unknown market left, that one', () => {
    const c = revealStations(marketCampaign(), [sid(39), sid(7), sid(30)]);
    expect(chooseBunkerIntel(c, sid(3))).toEqual({kind: 'market', nodeId: sid(14)});
  });

  it('old networks without Markets fall back to an unknown other node', () => {
    const c = revealStations(fixtureCampaign({current: sid(3), known: [sid(0), sid(3)], visited: [sid(0), sid(3)]}), [sid(39)]);
    expect(c.network.nodes.some(n => n.archetype === 'market')).toBe(false);
    const r = chooseBunkerIntel(c, sid(3));
    expect(r.kind).toBe('node');
    expect(c.known.includes(r.nodeId!)).toBe(false);
  });

  it('deterministic and station-owned: the same station and knowledge -> the same node (known order irrelevant); stations differ', () => {
    const c = revealStations(marketCampaign(), [sid(39)]);
    const a = chooseBunkerIntel(c, sid(3));
    expect(chooseBunkerIntel(structuredClone(c), sid(3))).toEqual(a);
    expect(chooseBunkerIntel({...c, known: [...c.known].reverse()}, sid(3))).toEqual(a);
    // across several Bunker stations the station-owned hash spreads the choice (not always the first id)
    const picks = new Set(Array.from({length: 12}, (_, i) => chooseBunkerIntel({...c, known: [...c.known, sid(i + 15)]}, sid(i + 15)).nodeId));
    expect(picks.size).toBeGreaterThan(1);
    const nodes = new Set(Array.from({length: 12}, (_, i) => chooseBunkerIntel(revealStations(c, [7, 14, 30].map(sid)), sid(i + 15)).nodeId));
    expect(nodes.size).toBeGreaterThan(1);
  });
});

describe('revealStations: map knowledge only', () => {
  it('known ∪ ids (unknown ids ignored); visited / current / transit / cheat untouched; idempotent (same object)', () => {
    const c = fixtureCampaign({current: sid(3), known: [sid(0), sid(1), sid(3)], visited: [sid(0), sid(3)]});
    const r = revealStations(c, [sid(39), 'st-99', sid(1)]);
    expect(r.known).toEqual([sid(0), sid(1), sid(3), sid(39)]);
    expect(r.visited).toBe(c.visited);
    expect(r.current).toBe(c.current);
    expect(r.transit).toBe(c.transit);
    expect(r.cheat).toBe(false);
    expect(c.known).toEqual([sid(0), sid(1), sid(3)]); // the input is never mutated
    expect(revealStations(r, [sid(39)])).toBe(r);
    expect(revealStations(r, [])).toBe(r);
    expect(validateCampaign(r).filter(e => !/levelSeed/.test(e))).toEqual([]); // (the save fixture's seeds are not hashNodeSeed: that check only)
    expect(visibleNodes(r).map(n => n.id)).toContain(sid(39));
  });
});

describe('the intel wording and the core screen', () => {
  it('names the type and the station only (no fuel / loot figures)', () => {
    const net = marketCampaign().network;
    const r = bunkerIntelText({kind: 'reactor', nodeId: net.reactor}, net), m = bunkerIntelText({kind: 'market', nodeId: sid(7)}, net);
    const n = bunkerIntelText({kind: 'node', nodeId: sid(20)}, net), ch = bunkerIntelText({kind: 'charted'}, net);
    expect(r.toast).toBe(`Map intel retrieved — Reactor located: ${net.nodes[39].name} is now on your map`);
    expect(m.head).toBe('SURVIVOR MARKET LOCATED');
    expect(n.line).toBe(`${net.nodes[20].name} — Office tower`);
    expect(ch.toast).toMatch(/already charted/);
    for (const t of [r, m, n, ch]) for (const s of [t.head, t.line, t.toast]) { expect(s).not.toMatch(/\d/); expect(s.toLowerCase()).not.toMatch(/fuel|tank|loot|can\b/); }
  });

  it('draws the low-power diagnostic and the alive core display; the key changes only with the state / the animation frame', () => {
    const restore = installCanvasShim(false);
    try {
      const canvas = document.createElement('canvas') as HTMLCanvasElement;
      canvas.width = CORE_SCREEN_PX.w; canvas.height = CORE_SCREEN_PX.h;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const low: CoreScreenModel = {gens: [{letter: 'A', label: 'Habitation plant room', state: 'online'}, {letter: 'B', label: 'Services workshop', state: 'fuelled'}, {letter: 'C', label: 'Maintenance plant', state: 'off'}],
        online: 1, total: 3, alive: false, uplink: true, intel: null, map: null};
      expect(() => drawCoreScreen(ctx, low, CORE_SCREEN_PX.w, CORE_SCREEN_PX.h, 0)).not.toThrow();
      const alive: CoreScreenModel = {...low, gens: low.gens.map(g => ({...g, state: 'online' as const})), online: 3, alive: true,
        map: {nodes: [{x: 0, y: 0}, {x: 10, y: 5}, {x: 20, y: 0}], edges: [[0, 1], [1, 2]], hi: 2}, intel: {kind: 'reactor', head: 'REACTOR LOCATED', line: 'Ashgrove Gardens — Reactor'}};
      expect(() => drawCoreScreen(ctx, alive, CORE_SCREEN_PX.w, CORE_SCREEN_PX.h, 7)).not.toThrow();
      expect(() => drawCoreScreen(ctx, {...alive, uplink: false, map: null, intel: null}, CORE_SCREEN_PX.w, CORE_SCREEN_PX.h, 3)).not.toThrow();
      // low power: only the cursor blink (frame parity) changes the key; alive: every frame
      expect(coreScreenKey(low, 0)).toBe(coreScreenKey(low, 2));
      expect(coreScreenKey(low, 0)).not.toBe(coreScreenKey(low, 1));
      expect(coreScreenKey(alive, 4)).not.toBe(coreScreenKey(alive, 5));
      expect(coreScreenKey({...low, gens: [low.gens[0], {...low.gens[1], state: 'online'}, low.gens[2]]}, 0)).not.toBe(coreScreenKey(low, 0));
    } finally { restore(); }
  });
});
