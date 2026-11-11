// Task gameplay-feedback-20261111 (lane TRAVEL; user: "Fix map travel beyond adjacent nodes: allow connected multi-hop routes whenever
// the existing fuel rules can pay the complete route cost"). Before: a known station was a destination only one stop away (or, when
// VISITED, over visited stations) — a known, never-visited station two stops away was refused even with the fuel for both stops. Now
// (campaign/discovery.ts travelPlan / knownRoute):
//  - any KNOWN station over KNOWN TRACK (the edges the map prints) is a destination; the route is the cheapest (fewest hops = fewest
//    standard tanks at one tank per hop; a tie prefers stations already visited, then the smallest ids); never over unknown track; the
//    Reactor is never passed before it was visited; one hop and the 1337 cheat are unchanged;
//  - the departure pays the COMPLETE route (Game.fuelCheck: hops x FUEL.hopUnits from tank -> carts -> chest) or refuses it with the
//    numbers, nothing moving; passing a station is no visit (only the destination is prepared / built / visited; no reveal on the way);
//  - the map card names the route, traces it and shows one tank per stop; the route record validates on load (old visited-only routes
//    too) and a departure save over a never-visited station resumes once.
// Node only (no browser): the real discovery / paper map (mini DOM) / Game.travelToStation on a recorded shell / real save slots.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {generateNetwork} from '../src/campaign/network';
import {
  arrive, canTravel, knownRoute, neighbors, newCampaign, revealAround, revealStations, transitOf, transitRouteProblem, travelBlock, travelPlan,
  validateCampaign, visibleEdges, visitedRoute,
} from '../src/campaign/discovery';
import type {CampaignState, StationId, SubwayNetwork} from '../src/campaign/types';
import {FUEL, planDebit, routeCost} from '../src/fuel/fuel';
import {PaperMap, buildMapModel, type MapFuel} from '../src/ui/paperMap';
import {parseSaveText} from '../src/save/validate';
import {saveFileText} from '../src/save/serialize';
import {createRun} from '../src/run/runState';
import {SingleFlight} from '../src/run/travelGate';
import {SaveSlots} from '../src/save/slots';
import {Inventory} from '../src/items/inventory';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import {Survival} from '../src/player/survival';
import type {SectionKey} from '../src/levels/types';
import {installCanvasShim} from './helpers/canvas2d';
import {installMiniDom, type MiniDom} from './helpers/paperMapDom';
import {FakeStorage, Harness, SEEDS, fixtureCampaign, sid} from './helpers/saveFixture';

installCanvasShim(false);

/** A tiny hand-made graph: ids, undirected pairs; the LAST id is the Reactor. */
function tiny(ids: string[], pairs: [string, string][], reactor = ids[ids.length - 1]): SubwayNetwork {
  const edges = pairs.map(([a, b]) => (a < b ? [a, b] : [b, a]) as [string, string]).sort((x, y) => (x[0] + x[1] < y[0] + y[1] ? -1 : 1));
  return {v: 1, seed: 1, nodes: ids.map((id, i) => ({id, name: `N${i}`, archetype: id === reactor ? 'reactor' : 'subway', levelSeed: i, x: i, y: 0, lines: ['l']})), edges, lines: [], start: ids[0], reactor};
}
const state = (net: SubwayNetwork, o: Partial<CampaignState>): CampaignState => ({...newCampaign(net), ...o});

describe('the premise and the fix on a generated network (the real one-hop console reveal)', () => {
  const net = generateNetwork(424242);
  it('at a fork, one branch taken: the other branch (known, never visited, two stops back) was refused; now a 2-hop trip the fuel pays', () => {
    for (const seed of [424242, 7, 99]) {
      const n = generateNetwork(seed);
      let s = revealAround(newCampaign(n), n.start);
      // walk on until the train stands at a fork (two never-visited known neighbours), then take one branch
      for (let i = 0; i < 20 && neighbors(n, s.current).filter(x => !s.visited.includes(x)).length < 2; i++) {
        const next = neighbors(n, s.current).find(x => !s.visited.includes(x) && x !== n.reactor)!;
        s = revealAround(arrive(s, next), next);
      }
      const fork = s.current;
      const [b1, b2] = neighbors(n, fork).filter(x => !s.visited.includes(x) && s.known.includes(x));
      expect([seed, typeof b2]).toEqual([seed, 'string']);
      s = revealAround(arrive(s, b1), b1);
      expect(neighbors(n, b1)).not.toContain(b2);
      // the rule before this task (one hop, or visited-only multi-hop): no trip — the bug report (verified on the unchanged module too)
      expect(visitedRoute(s, b2)).toBeNull();
      // now: back through the fork over the known track, two stops = two standard tanks, payable from the old two-tank tank alone
      const plan = travelPlan(s, b2)!;
      expect(plan).toEqual({to: b2, route: [b1, fork, b2], hops: 2, cheat: false});
      expect(routeCost(plan.hops)).toBe(2 * FUEL.tankUnits);
      expect(planDebit(routeCost(plan.hops), 2 * FUEL.tankUnits, [], [])).toEqual({tank: 8, carts: [], chest: []});
      expect(travelBlock(s, b2)).toBeNull();
    }
  });

  it('every known station the console revealed is a destination; every route runs over printed track, known stations only', () => {
    let s = revealAround(newCampaign(net), net.start);
    const walked: StationId[] = [net.start];
    for (let i = 0; i < 7; i++) {
      const next = neighbors(net, s.current).find(n => !walked.includes(n) && s.known.includes(n) && n !== net.reactor);
      if (!next) break;
      s = revealAround(arrive(s, next), next);
      walked.push(next);
    }
    const printed = new Set(visibleEdges(s).map(([x, y]) => `${x}|${y}`));
    for (const k of s.known) {
      if (k === s.current) { expect(travelBlock(s, k)).toBe('here'); continue; }
      const p = travelPlan(s, k)!;
      expect([k, p !== null]).toEqual([k, true]);
      expect(p.route[0]).toBe(s.current);
      expect(p.route.at(-1)).toBe(k);
      for (const x of p.route) expect(s.known).toContain(x);
      for (let i = 1; i < p.route.length; i++) expect(printed.has([p.route[i - 1], p.route[i]].sort().join('|'))).toBe(true);
      // the cheapest: no shorter path over known stations exists (a breadth-first count over the known subgraph)
      const d = new Map([[s.current, 0]]), q = [s.current];
      for (let i = 0; i < q.length; i++) for (const n of neighbors(net, q[i])) if (s.known.includes(n) && !d.has(n) && (n === k || n !== net.reactor || s.visited.includes(n))) { d.set(n, d.get(q[i])! + 1); q.push(n); }
      expect(p.hops).toBe(d.get(k));
    }
    // a station not on the map is never a destination (no unknown track)
    for (const n of net.nodes) if (!s.known.includes(n.id)) expect(canTravel(s, n.id)).toBe(false);
  });

  it('where the visited-only rule found a shortest route, the new rule picks the very same one (existing trips unchanged)', () => {
    for (const seed of [424242, 7, 99, 2026]) {
      const n = generateNetwork(seed);
      let s = revealAround(newCampaign(n), n.start);
      for (let i = 0; i < 10; i++) {
        const next = neighbors(n, s.current).filter(x => s.known.includes(x) && x !== n.reactor).sort().at(i % 2 ? -1 : 0);
        if (!next) break;
        s = revealAround(arrive(s, next), next);
      }
      for (const v of s.visited) {
        if (v === s.current) continue;
        const old = visitedRoute(s, v)!, now = knownRoute(s, v)!;
        if (old.length === now.length) expect([seed, v, now]).toEqual([seed, v, old]);
        else expect(now.length).toBeLessThan(old.length); // a shorter route over known (unvisited) stations: cheaper
      }
    }
  });
});

describe('the route rules (tiny graphs)', () => {
  //   a - b - d - f - g
  //    \     /
  //     c - e
  const net = tiny(['st-a', 'st-b', 'st-c', 'st-d', 'st-e', 'st-f', 'st-g', 'st-r'], [['st-a', 'st-b'], ['st-b', 'st-d'], ['st-a', 'st-c'], ['st-c', 'st-e'], ['st-e', 'st-d'], ['st-d', 'st-f'], ['st-f', 'st-g']]);

  it('a known station several stops away over never-visited known stations: the cheapest route; unknown track never', () => {
    const s = state(net, {current: 'st-a', visited: ['st-a'], known: ['st-a', 'st-b', 'st-c', 'st-d', 'st-e', 'st-f']});
    expect(travelPlan(s, 'st-f')).toEqual({to: 'st-f', route: ['st-a', 'st-b', 'st-d', 'st-f'], hops: 3, cheat: false});
    expect(travelPlan(s, 'st-e')).toEqual({to: 'st-e', route: ['st-a', 'st-c', 'st-e'], hops: 2, cheat: false});
    // g is not on the map: no trip (and no route through it)
    expect(travelPlan(s, 'st-g')).toBeNull();
    expect(travelBlock(s, 'st-g')).toBe('unknown');
    // b unknown: d is reached the other way round (the only known track), never across b
    const noB = state(net, {current: 'st-a', visited: ['st-a'], known: ['st-a', 'st-c', 'st-d', 'st-e']});
    expect(travelPlan(noB, 'st-d')?.route).toEqual(['st-a', 'st-c', 'st-e', 'st-d']);
    // a known station no known track reaches (map intel): on the map, not a destination
    const intel = revealStations(state(net, {current: 'st-a', visited: ['st-a'], known: ['st-a', 'st-b', 'st-c']}), ['st-g']);
    expect(intel.known).toContain('st-g');
    expect(travelPlan(intel, 'st-g')).toBeNull();
    expect(travelBlock(intel, 'st-g')).toBe('no-route');
  });

  it('ties: an explored route wins over an unexplored one of the same length, then the smallest ids', () => {
    const diamond = tiny(['st-1', 'st-2', 'st-3', 'st-4', 'st-9'], [['st-1', 'st-2'], ['st-1', 'st-3'], ['st-2', 'st-4'], ['st-3', 'st-4']]);
    const all = ['st-1', 'st-2', 'st-3', 'st-4'];
    expect(knownRoute(state(diamond, {current: 'st-1', visited: ['st-1'], known: all}), 'st-4')).toEqual(['st-1', 'st-2', 'st-4']);
    expect(knownRoute(state(diamond, {current: 'st-1', visited: ['st-1', 'st-3'], known: all}), 'st-4')).toEqual(['st-1', 'st-3', 'st-4']);
    expect(knownRoute(state(diamond, {current: 'st-1', visited: all, known: all}), 'st-4')).toEqual(['st-1', 'st-2', 'st-4']);
    // never longer to stay on explored track: the shorter unexplored route is cheaper (fewer tanks)
    const s = state(net, {current: 'st-a', visited: ['st-a', 'st-c', 'st-e', 'st-d', 'st-f'], known: ['st-a', 'st-b', 'st-c', 'st-d', 'st-e', 'st-f']});
    expect(travelPlan(s, 'st-f')?.route).toEqual(['st-a', 'st-b', 'st-d', 'st-f']);
  });

  it('the Reactor is never passed before it was visited (the Maintenance Route is the way past it); it may be the destination', () => {
    //  a - r - b ;  a - m - x - b
    const rn = tiny(['st-a', 'st-b', 'st-m', 'st-x', 'st-r'], [['st-a', 'st-r'], ['st-r', 'st-b'], ['st-a', 'st-m'], ['st-m', 'st-x'], ['st-x', 'st-b']]);
    const known = ['st-a', 'st-b', 'st-m', 'st-x', 'st-r'];
    const s = state(rn, {current: 'st-a', visited: ['st-a'], known});
    expect(travelPlan(s, 'st-b')?.route).toEqual(['st-a', 'st-m', 'st-x', 'st-b']);
    expect(travelPlan(s, 'st-r')).toEqual({to: 'st-r', route: ['st-a', 'st-r'], hops: 1, cheat: false});
    const after = state(rn, {current: 'st-a', visited: ['st-a', 'st-r'], known});
    expect(travelPlan(after, 'st-b')?.route).toEqual(['st-a', 'st-r', 'st-b']);
    // only route: through the unvisited Reactor -> not available
    const only = state(rn, {current: 'st-a', visited: ['st-a'], known: ['st-a', 'st-r', 'st-b']});
    expect(travelPlan(only, 'st-b')).toBeNull();
    expect(travelBlock(only, 'st-b')).toBe('no-route');
    expect(transitRouteProblem(rn, {from: 'st-a', to: 'st-b', cheat: false, route: ['st-a', 'st-r', 'st-b']}, new Set(known), new Set(['st-a']))).toMatch(/passes the Reactor st-r before it was visited/);
  });

  it('one hop is unchanged: a known neighbour, never an unknown one, never the current station; the cheat is its own permission', () => {
    const s = state(net, {current: 'st-d', visited: ['st-a', 'st-d'], known: ['st-a', 'st-d', 'st-f']});
    expect(travelPlan(s, 'st-f')).toEqual({to: 'st-f', route: ['st-d', 'st-f'], hops: 1, cheat: false});
    expect(travelPlan(s, 'st-e')).toBeNull(); // adjacent, not on the map
    expect(travelPlan(s, 'st-a')).toBeNull(); // known, but b (between) is not: no known track
    expect(travelPlan(s, 'st-d')).toBeNull();
    expect(travelBlock(s, 'st-d')).toBe('here');
    const c = {...s, cheat: true, known: net.nodes.map(n => n.id)};
    expect(travelPlan(c, 'st-g')).toEqual({to: 'st-g', route: ['st-d', 'st-g'], hops: 1, cheat: true});
    expect(transitOf(c, travelPlan(c, 'st-g')!)).toEqual({from: 'st-d', to: 'st-g', phase: 'departing', cheat: true});
  });

  it('the trip record: a multi-hop trip carries its route; the validators take known stations (and every older visited route)', () => {
    const s = state(net, {current: 'st-a', visited: ['st-a'], known: ['st-a', 'st-b', 'st-d', 'st-f']});
    const t = transitOf(s, travelPlan(s, 'st-f')!);
    expect(t).toEqual({from: 'st-a', to: 'st-f', phase: 'departing', cheat: false, route: ['st-a', 'st-b', 'st-d', 'st-f']});
    // (the campaign validator needs a real generated network: a route back to the start past a never-visited known station)
    const g = generateNetwork(424242);
    const path = [g.start];
    for (let i = 0; i < 3; i++) path.push(neighbors(g, path.at(-1)!).find(x => !path.includes(x))!);
    const f: CampaignState = {...revealAround(newCampaign(g), g.start), current: path[3], visited: [g.start, path[3]], known: [...new Set([...path, ...neighbors(g, g.start)])]};
    const ft = transitOf(f, travelPlan(f, g.start)!);
    expect(ft.route).toEqual([path[3], path[2], path[1], g.start]);
    expect(validateCampaign({...f, transit: ft})).toEqual([]);
    const beyond = neighbors(g, path[3]).find(x => !f.known.includes(x))!;
    expect(validateCampaign({...f, transit: {from: path[3], to: beyond, phase: 'departing', cheat: false, route: [path[3], path[2], path[3], beyond]}}).join()).toMatch(/repeats/);
    expect(validateCampaign({...f, transit: {...ft, route: [path[3], path[2], path[1], beyond]}}).join()).toMatch(/start to its destination|no track/);
    const off = neighbors(g, path[1]).find(x => !f.known.includes(x));
    if (off) expect(validateCampaign({...f, transit: {from: path[3], to: off, phase: 'departing', cheat: false, route: [path[3], path[2], path[1], off]}}).join()).toMatch(new RegExp(`ends at ${off}, which is not on the map`));
    const known = new Set(s.known), visited = new Set(s.visited);
    expect(transitRouteProblem(net, t, known, visited)).toBeNull();
    expect(transitRouteProblem(net, {...t, route: ['st-a', 'st-c', 'st-e', 'st-d', 'st-f']}, known, visited)).toMatch(/passes st-c, which is not on the map/);
    expect(transitRouteProblem(net, {...t, to: 'st-g', route: ['st-a', 'st-b', 'st-d', 'st-f', 'st-g']}, known, visited)).toMatch(/ends at st-g, which is not on the map/);
    // an older save's route over visited stations stays valid (visited stations count as known)
    expect(transitRouteProblem(net, t, new Set(['st-a']), new Set(['st-a', 'st-b', 'st-d', 'st-f']))).toBeNull();
  });
});

describe('the paper map: a multi-hop destination shows its route and its cost', () => {
  let dom: MiniDom;
  let map: PaperMap;
  beforeEach(() => { dom = installMiniDom(1280, 720); map = new PaperMap(); });
  afterEach(() => { map.destroy(); dom.uninstall(); });
  const panel = () => dom.doc.querySelector('.pm-panel')!;
  const hit = (id: string) => dom.doc.querySelector(`.pm-hit[data-station="${id}"]`);
  const fuel = (total: number): MapFuel => ({node: () => null, aboard: () => ({tank: total, chest: 0, carts: 0, total}), cost: hops => routeCost(hops)});

  // fixture red line st-00 - st-01 - st-02 - st-03 ...: the train at st-00; st-01 visited, st-02 / st-03 known (st-03 never visited)
  const s = fixtureCampaign({current: sid(0), visited: [sid(0), sid(1), sid(2)], known: [sid(0), sid(1), sid(2), sid(3)]});

  it('a known, never-visited station three stops away: selectable, "3 stops via", the pencil route, a three-tank gauge, Depart', () => {
    const calls: string[] = [];
    map.open({state: s, mode: 'travel', fuel: fuel(12), onConfirm: to => calls.push(to)});
    expect(hit(sid(3))!.classList.contains('pm-can')).toBe(true);
    expect(hit(sid(3))!.getAttribute('aria-label')).toMatch(/3 stops away/);
    dom.click(hit(sid(3)));
    expect(map.selected).toBe(sid(3));
    const text = panel().textContent;
    expect(text).toMatch(/Not visited yet · 3 stops via /);
    expect(map.qa().route).toEqual([sid(0), sid(1), sid(2), sid(3)]);
    expect(dom.doc.querySelector('.pm-route')).not.toBeNull();
    expect(panel().querySelector('.pm-trip-gauge')).not.toBeNull();
    expect((panel().innerHTML.match(/rx="1.5"/g) ?? []).length).toBe(3); // one tank outline per stop
    expect(panel().innerHTML).not.toContain('pm-p-short'); // 12 aboard pays 12
    expect(dom.doc.querySelector('.pm-mode')!.textContent).toMatch(/pick a station on the known track \(one tank per stop\)/);
    dom.click(panel().querySelector('.pm-depart'));
    expect(calls).toEqual([sid(3)]);
  });

  it('short of fuel the gauge shows it (red, visual only) and Depart still asks the engine; an unreachable station says so', () => {
    map.open({state: s, mode: 'travel', fuel: fuel(7)});
    dom.click(hit(sid(3)));
    expect(panel().innerHTML).toContain('pm-p-short');
    map.cancel();
    const intel = revealStations(fixtureCampaign({current: sid(0), visited: [sid(0)], known: [sid(0), sid(1)]}), [sid(5)]);
    map.update(intel);
    expect(hit(sid(5))!.classList.contains('pm-can')).toBe(false);
    dom.click(hit(sid(5)));
    expect(map.selected).toBeNull();
    expect(map.note).toMatch(/not available — no known track from here/);
  });

  it('the model: every reachable known station is selectable with its hop count; one-stop ones keep their ring', () => {
    const m = buildMapModel(s, 'travel', 1, null, null);
    const by = new Map(m.stations.map(x => [x.node.id, x]));
    expect([by.get(sid(1))!.adjacent, by.get(sid(1))!.hops]).toEqual([true, 1]);
    expect([by.get(sid(2))!.can, by.get(sid(2))!.adjacent, by.get(sid(2))!.hops]).toEqual([true, false, 2]);
    expect([by.get(sid(3))!.can, by.get(sid(3))!.hops]).toEqual([true, 3]);
    expect([by.get(sid(0))!.can, by.get(sid(0))!.hops]).toEqual([false, 0]);
  });
});

describe('the journey: the complete route is paid at departure, only the destination is visited', async () => {
  const {Game} = await import('../src/game');
  const {FlashlightBattery} = await import('../src/player/flashlight');
  const {LEVELS} = await import('../src/levels/registry');
  const key = (i: number): SectionKey => ({level: 'subway', section: 'main', station: sid(i)});

  /** The real Game.travelToStation / continueCampaign on a recorded shell (as campaign-journey.test.ts), with the train's fuel set. */
  function shell(fuelSetup: {tank: number; chestCans: number}, campaign: CampaignState) {
    const storage = new FakeStorage();
    const battery = new FlashlightBattery();
    const saveValidate = {};
    const log: string[] = [];
    const commits: {reason: string; campaign: CampaignState}[] = [];
    const prepared: string[] = [];
    const journeys: (readonly string[] | null)[] = [];
    const s: Record<string, unknown> = {
      inv: new Inventory(), playerTrain: new PlayerTrainRecord(), runParticipants: [], arrival: {kind: 'start'}, startWeapon: 'pistol', bagStoreWired: false,
      survival: new Survival(), torch: {battery, reset: (c?: number, ro?: {on?: boolean}) => battery.reset(c, ro)},
      player: {hp: 100, stamina: 100, damageTaken: 0, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0.1, crouched: false},
      stats: {shots: 0, hits: 0, kills: 0, time: 0, headshots: 0, healed: 0, itemsUsed: 0}, time: 10, trainPlacement: null,
      run: createRun({seeds: SEEDS, start: key(0), levels: LEVELS, campaign}),
      saveValidate, saves: new SaveSlots({storage, validate: saveValidate, listen: false}), currentSlot: null, saveRevision: 0, saveRunId: -1,
      lifecycle: new SingleFlight(), warmRun: Promise.resolve(), campaignListeners: [], transitGap: false, mapBack: null, retired: [],
      hud: {toast: (t: string) => log.push(`toast:${t}`)},
      sfx: {engineStall: () => log.push('stall'), denied: () => log.push('denied')},
      trainRide: {
        riding: false,
        depart: async (j?: {route: readonly string[]}) => { log.push('depart'); journeys.push(j?.route ?? null); return {status: 'in-tunnel', via: 'tunnel', end: 'x1', dir: 1}; },
        state: () => ({local: {x: 1.5, z: -0.4, yaw: 0.3}}),
        transitFailed: (r: string) => log.push(`transitFailed:${r.slice(0, 20)}`),
        arrive: async () => { log.push('arrive'); return {status: 'stopped', via: 'tunnel', end: 'x0', reversed: false}; },
        reset: () => log.push('rideReset'),
      },
      leaveSection(this: {run: ReturnType<typeof createRun>}, save: boolean) { log.push(`leave:${save}:${this.run.current.station}`); if (save) this.run.memory().visits += 1; },
      async prepareSection(k: SectionKey) { prepared.push(k.station!); log.push(`prepare:${k.station}`); return {station: k.station}; },
      buildSection(this: {run: ReturnType<typeof createRun>}, k: SectionKey) { log.push(`build:${k.station}`); this.run.current = {...k}; },
      *buildSectionSteps(this: {buildSection(k: SectionKey): void}, k: SectionKey) { yield; this.buildSection(k); yield; },
      pregenerateSection: () => {},
      updateStationIntro: () => {},
      lifecycleFailed: () => log.push('lifecycleFailed'),
      beginGesture: () => Promise.resolve(true),
      showLoading: () => ({bar: null, label: {textContent: ''}, button: null}),
      progressTo: () => () => {},
      prepareGraphics: async () => ({status: 'done'}),
      readyLine: () => {},
      enterPlay: () => { log.push('enterPlay'); return Promise.resolve(); },
    };
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as InstanceType<typeof Game> & {run: ReturnType<typeof createRun>; saves: SaveSlots};
    const realCommit = g.saves.commit.bind(g.saves);
    g.saves.commit = ((slot: number, file: {run: {campaign: CampaignState}; meta: {reason: string}}, opt?: object) => {
      commits.push({reason: file.meta.reason, campaign: structuredClone(file.run.campaign)});
      log.push(`save:${file.meta.reason}`);
      return realCommit(slot, file as never, opt as never);
    }) as typeof g.saves.commit;
    (g as unknown as {wireRunLanes(): void}).wireRunLanes();
    (g as unknown as {resetCarry(): void}).resetCarry();
    const train = (g as unknown as {playerTrain: PlayerTrainRecord}).playerTrain;
    train.fuel.tank = fuelSetup.tank;
    for (let k = 0, left = fuelSetup.chestCans; left > 0; k++) { const st = (g as unknown as {inv: Inventory}).inv.makeStack('fuel_can', 2); st.count = Math.min(2, left); left -= st.count; train.lockbox.slots[k] = st; }
    expect(g.commitSave('new-game', {slot: 1})).toMatchObject({ok: true});
    log.length = 0;
    commits.length = 0;
    prepared.length = 0;
    return {g, log, commits, prepared, journeys, train};
  }
  const fuelOf = (t: PlayerTrainRecord) => ({tank: t.fuel.tank, chest: t.lockbox.slots.reduce((n, x) => n + (x?.itemId === 'fuel_can' ? x.count : 0), 0)});

  // the run walked st-00 -> st-01 and saw st-02 / st-03 / st-04 on the map; the train is back at st-00 (st-02.. never visited)
  const far = () => fixtureCampaign({current: sid(0), visited: [sid(0), sid(1)], known: [sid(0), sid(1), sid(2), sid(3), sid(4)]});

  it('three stops over never-visited known stations: 3 tanks burnt from a 3-tank tank (more than the old two-tank capacity), one journey', async () => {
    const {g, log, commits, prepared, journeys, train} = shell({tank: 12, chestCans: 2}, far());
    expect(await g.travelToStation(sid(3))).toEqual({ok: true});
    expect(fuelOf(train)).toEqual({tank: 0, chest: 2}); // the tank first; the chest untouched
    expect(journeys).toEqual([[sid(0), sid(1), sid(2), sid(3)]]);
    expect(prepared).toEqual([sid(3)]); // nothing on the way loaded / looted
    expect(log.filter(l => !l.startsWith('toast'))).toEqual(['depart', 'leave:true:st-00', 'save:departure', 'prepare:st-03', 'build:st-03', 'arrive', 'save:arrival']);
    expect(log).toContain('toast:3 stops: 3 tanks of fuel burnt');
    expect(commits[0].campaign.transit).toEqual({from: sid(0), to: sid(3), phase: 'departing', cheat: false, route: [sid(0), sid(1), sid(2), sid(3)], fuel: {cost: 12, debit: {tank: 12, carts: [], chest: []}}});
    const c = g.run.campaign!;
    expect([c.current, c.transit]).toEqual([sid(3), null]);
    expect(c.visited).toEqual([sid(0), sid(1), sid(3)]); // the destination only: st-02 was passed, not visited
    expect(c.known).toEqual([sid(0), sid(1), sid(2), sid(3), sid(4)]); // no reveal on the way
    expect(g.run.peekMemory(key(2))).toBeUndefined(); // st-02's world never created
  });

  it('the complete route or nothing: short reserves stall with the numbers, nothing moves; exactly enough (tank + chest) goes', async () => {
    const a = shell({tank: 4, chestCans: 3}, far());
    const before = JSON.stringify(a.g.run.campaign);
    const r = await a.g.travelToStation(sid(3));
    expect(r.ok).toBe(false);
    expect(log0(a.log)).toEqual(['stall']); // no depart, no teardown, no save
    expect(a.log.find(l => l.startsWith('toast:'))).toMatch(/^toast:Not enough fuel — 3 stops need 3 tanks, the train has 1¾ tanks\./);
    expect(fuelOf(a.train)).toEqual({tank: 4, chest: 3});
    expect(JSON.stringify(a.g.run.campaign)).toBe(before);
    // 4 in the tank + 4 chest cans = 2 tanks: the 2-stop trip to st-02 (never visited, passing visited st-01) goes, drawing all of it
    const b = shell({tank: 4, chestCans: 4}, far());
    expect(await b.g.travelToStation(sid(2))).toEqual({ok: true});
    expect(fuelOf(b.train)).toEqual({tank: 0, chest: 0});
    expect(b.commits[0].campaign.transit).toMatchObject({route: [sid(0), sid(1), sid(2)], fuel: {cost: 8}});
    // a FOUR-stop route from a full four-tank tank alone
    const c = shell({tank: FUEL.trainTankUnits, chestCans: 0}, far());
    expect(await c.g.travelToStation(sid(4))).toEqual({ok: true});
    expect(fuelOf(c.train)).toEqual({tank: 0, chest: 0});
    expect(c.commits[0].campaign.transit).toMatchObject({route: [sid(0), sid(1), sid(2), sid(3), sid(4)], fuel: {cost: 16, debit: {tank: 16}}});
  });

  it('single hop unchanged: one stop burns one tank; a station off the known track is refused before anything moves', async () => {
    const a = shell({tank: 6, chestCans: 0}, far());
    expect(await a.g.travelToStation(sid(1))).toEqual({ok: true});
    expect(fuelOf(a.train)).toEqual({tank: 2, chest: 0});
    expect(a.commits[0].campaign.transit).toEqual({from: sid(0), to: sid(1), phase: 'departing', cheat: false, fuel: {cost: 4, debit: {tank: 4, carts: [], chest: []}}});
    const b = shell({tank: 16, chestCans: 0}, fixtureCampaign({current: sid(0), visited: [sid(0)], known: [sid(0), sid(1), sid(5)]}));
    expect(await b.g.travelToStation(sid(5))).toEqual({ok: false, error: 'That station cannot be reached from here.'});
    expect(b.log).toEqual([]);
    expect(fuelOf(b.train)).toEqual({tank: 16, chest: 0});
  });

  it('a departure save over a never-visited station validates and resumes once on Continue (arriving, not charging again)', async () => {
    const a = shell({tank: 12, chestCans: 0}, far());
    const f = a.g.fuelCheck(3);
    expect(f.ok).toBe(true);
    a.train.fuel.tank = 0;
    const plan = travelPlan(a.g.run.campaign!, sid(3))!;
    a.g.run.campaign = {...a.g.run.campaign!, transit: {...transitOf(a.g.run.campaign!, plan), fuel: {cost: 12, debit: (f as unknown as {debit: never}).debit}}};
    expect(a.g.commitSave('departure', {pose: {x: 1, z: 0, yaw: 0, pitch: 0, crouched: false}})).toMatchObject({ok: true});
    const file = new Harness(a.g.run.campaign!).file('departure');
    const parsed = parseSaveText(saveFileText(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.run.campaign.transit).toMatchObject({route: [sid(0), sid(1), sid(2), sid(3)]});
    const b = shell({tank: 9, chestCans: 9}, far());
    (b.g as unknown as {saves: SaveSlots}).saves = a.g.saves;
    expect(await b.g.continueCampaign(1)).toEqual({ok: true});
    expect(b.g.run.campaign).toMatchObject({current: sid(3), transit: null, visited: [sid(0), sid(1), sid(3)]});
    expect(fuelOf((b.g as unknown as {playerTrain: PlayerTrainRecord}).playerTrain)).toEqual({tank: 0, chest: 0}); // the save's own fuel
    expect(b.prepared).toEqual([sid(3)]);
  });

  it('an older save: its visited-only route still validates', () => {
    const c = fixtureCampaign({current: sid(3), visited: [sid(0), sid(1), sid(2), sid(3)], known: [sid(0), sid(1), sid(2), sid(3), sid(4)],
      transit: {from: sid(3), to: sid(0), phase: 'departing', cheat: false, route: [sid(3), sid(2), sid(1), sid(0)]}});
    const r = parseSaveText(saveFileText(new Harness(c).file('departure')));
    expect(r.ok).toBe(true);
    // a tampered route over a station not on the map is refused with a clear message
    const bad = parseSaveText(saveFileText(new Harness({...c, transit: {...c.transit!, to: sid(6), route: [sid(3), sid(4), sid(5), sid(6)]}}).file('departure')));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/passes st-05, which is not on the map/);
  });
});

const log0 = (log: string[]) => log.filter(l => !l.startsWith('toast'));
