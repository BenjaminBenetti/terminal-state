// Task studio-train-crafting-v1-20261111-225628-01 (lane SCANNER): THE ROUTE RADAR — a plugged radar makes the train console's map
// reveal stations TWO stops out instead of one. The mechanism is three small seams, each proven here on the real code:
//  (a) campaign/discovery.ts revealAround(state, id, radius) on REAL generated networks (generateNetwork, several seeds, every station):
//      radius 2 = exactly the stations within two track edges (checked against an independent walk over network.edges), ring by ring, a
//      superset of the console's own one-stop reveal, idempotent, never mutating, and never forgetting (radius back to 1 = the radar
//      unplugged). The printed map follows (visibleNodes / visibleEdges), a two-stop station the radar revealed is ONE journey of two
//      hops (travelPlan; never through an unvisited Reactor), and the existing fuel rules price it as two hops (fuel/fuel.ts; unchanged).
//  (b) the Game seam: the REAL Game.prototype.openTravelMap on a minimal shell (the pattern of campaign-journey.test.ts) with a
//      trainEquipment whose routeRadius() says 2 / 1 / is missing; the read-only 'view' map reveals nothing.
//  (c) world/trainEquipment.ts routeRadius(): 2 exactly while plugged('radar') holds a unit, for every equipment kind of the registry.
import {describe, expect, it} from 'vitest';
import {arrive, neighbors, newCampaign, revealAround, travelBlock, travelPlan, visibleEdges, visibleNodes} from '../src/campaign/discovery';
import {generateNetwork} from '../src/campaign/network';
import type {CampaignState, SubwayNetwork} from '../src/campaign/types';
import {EQUIPMENT_KINDS, type EquipmentKind} from '../src/craft/equipment';
import type {EquipmentUnit} from '../src/craft/equipmentApi';
import {FUEL, debitUnits, planDebit, routeCost} from '../src/fuel/fuel';
import {TrainEquipmentSystem} from '../src/world/trainEquipment';
import {installCanvasShim} from './helpers/canvas2d';
import {fixtureCampaign, sid} from './helpers/saveFixture';

const SEEDS = [1, 7, 99, 424242, 20261111];
const NETS: SubwayNetwork[] = SEEDS.map(seed => generateNetwork(seed));

/** Hops from `from` to every station within `hops` track edges — an independent walk over the raw edge list (never neighbors()). */
function within(net: SubwayNetwork, from: string, hops: number): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  let ring = new Set([from]);
  for (let h = 1; h <= hops; h++) {
    const next = new Set<string>();
    for (const [a, b] of net.edges) {
      if (ring.has(a) && !d.has(b)) next.add(b);
      if (ring.has(b) && !d.has(a)) next.add(a);
    }
    for (const id of next) d.set(id, h);
    ring = next;
  }
  return d;
}
const ringOf = (d: Map<string, number>, h: number): string[] => [...d].filter(([, k]) => k === h).map(([id]) => id).sort();
const joined = (net: SubwayNetwork, a: string, b: string): boolean => net.edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a));

/** The train standing at `id` knowing nothing else (a fresh run's shape, at any station). */
const standingAt = (net: SubwayNetwork, id: string): CampaignState => ({...newCampaign(net), current: id, known: [id], visited: [id]});
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('the route radar on real generated networks (revealAround radius 2)', () => {
  it('the networks are real ones: connected, and the radar has something to show from the start', () => {
    for (const net of NETS) {
      expect(net.nodes.length).toBeGreaterThanOrEqual(20);
      expect(within(net, net.start, net.nodes.length).size).toBe(net.nodes.length);
      expect(ringOf(within(net, net.start, 2), 2).length).toBeGreaterThan(0);
    }
  });

  it('radius 2 reveals exactly the stations within two edges: the station, its neighbours, then theirs (each ring in id order)', () => {
    let stations = 0;
    for (const net of NETS) {
      for (const {id} of net.nodes) {
        const d = within(net, id, 2);
        const s = revealAround(standingAt(net, id), id, 2);
        expect(s.known).toEqual([id, ...ringOf(d, 1), ...ringOf(d, 2)]);
        expect(new Set(s.known).size).toBe(d.size); // no duplicates, nothing beyond two edges
        for (const n of net.nodes) expect(s.known.includes(n.id)).toBe(d.has(n.id));
        // only what is known changed: the train has not moved, nothing was visited
        expect({...s, known: null}).toEqual({...standingAt(net, id), known: null});
        stations++;
      }
    }
    expect(stations).toBeGreaterThanOrEqual(100);
  });

  it('a superset of the console alone, and the same picture whether the console looked first or not', () => {
    for (const net of NETS) {
      for (const {id} of net.nodes) {
        const base = standingAt(net, id);
        const one = revealAround(base, id, 1), two = revealAround(base, id, 2);
        expect(revealAround(base, id).known).toEqual(one.known); // the default radius is the console's
        expect(one.known).toEqual([id, ...sorted(neighbors(net, id))]); // radius 1 = the old one-hop reveal exactly
        expect(two.known.slice(0, one.known.length)).toEqual(one.known);
        expect(revealAround(one, id, 2).known).toEqual(two.known);
      }
    }
  });

  it('idempotent (the same object back) and never mutates its input', () => {
    for (const net of NETS) {
      Object.freeze(net.nodes); Object.freeze(net.edges); Object.freeze(net.lines);
      for (const {id} of net.nodes) {
        const base = standingAt(net, id);
        Object.freeze(base); Object.freeze(base.known); Object.freeze(base.visited);
        const before = JSON.stringify(base.known);
        const two = revealAround(base, id, 2);
        expect(JSON.stringify(base.known)).toBe(before);
        expect(two).not.toBe(base);
        Object.freeze(two); Object.freeze(two.known);
        expect(revealAround(two, id, 2)).toBe(two);
        expect(revealAround(two, id, 1)).toBe(two);
      }
    }
  });

  it('known is never forgotten: the radar unplugged (radius back to 1) keeps the second ring, here and after the next trip', () => {
    for (const net of NETS) {
      const plugged = revealAround(newCampaign(net), net.start, 2);
      // unplugged at the same station: the console's one-stop reveal adds nothing and removes nothing
      expect(revealAround(plugged, net.start, 1)).toBe(plugged);
      // unplugged after a trip to every neighbour in turn: what the radar showed stays, the console adds the new station's neighbours
      for (const to of neighbors(net, net.start)) {
        const there = revealAround(arrive(plugged, to), to, 1);
        for (const id of plugged.known) expect(there.known).toContain(id);
        expect(there.known.slice(0, plugged.known.length)).toEqual(plugged.known);
        for (const n of neighbors(net, to)) expect(there.known).toContain(n);
      }
    }
  });

  it('radii other than 1 and 2 stay sane: below one is the console, fractions round down', () => {
    for (const net of NETS) {
      const base = newCampaign(net);
      const one = revealAround(base, net.start, 1).known, two = revealAround(base, net.start, 2).known;
      expect(revealAround(base, net.start, 0).known).toEqual(one);
      expect(revealAround(base, net.start, -3).known).toEqual(one);
      expect(revealAround(base, net.start, 1.9).known).toEqual(one);
      expect(revealAround(base, net.start, 2.9).known).toEqual(two);
      expect(revealAround(base, 'st-nowhere', 2)).toBe(base);
    }
  });

  it('the printed map follows: the known stations, and every track edge between two of them', () => {
    for (const net of NETS) {
      for (const {id} of net.nodes) {
        const d = within(net, id, 2);
        const one = revealAround(standingAt(net, id), id, 1), two = revealAround(one, id, 2);
        expect(visibleNodes(two).map(n => n.id)).toEqual(net.nodes.map(n => n.id).filter(n => d.has(n)));
        const edges = visibleEdges(two);
        expect(edges).toEqual(net.edges.filter(([a, b]) => d.has(a) && d.has(b)));
        // every second-ring station is drawn CONNECTED: at least one printed edge reaches it from the first ring
        for (const far of ringOf(d, 2)) expect(edges.some(([a, b]) => (a === far && d.get(b) === 1) || (b === far && d.get(a) === 1))).toBe(true);
        // and it is more map than the console alone printed (wherever a second ring exists)
        if (ringOf(d, 2).length) {
          expect(visibleNodes(two).length).toBeGreaterThan(visibleNodes(one).length);
          expect(edges.length).toBeGreaterThan(visibleEdges(one).length);
        }
      }
    }
  });

  it('a two-stop station the radar revealed is one journey of 2 hops — and not a destination at all without the radar', () => {
    let direct = 0, gated = 0;
    for (const net of NETS) {
      for (const {id} of net.nodes) {
        const d = within(net, id, 2);
        const one = revealAround(standingAt(net, id), id, 1), two = revealAround(one, id, 2);
        for (const far of ringOf(d, 2)) {
          // the console alone: not on the map
          expect(travelPlan(one, far)).toBeNull();
          expect(travelBlock(one, far)).toBe('unknown');
          // the radar: the stations between (independent of the rules: a neighbour of both)
          const between = ringOf(d, 1).filter(mid => joined(net, mid, far));
          expect(between.length).toBeGreaterThan(0);
          const open = between.filter(mid => mid !== net.reactor); // an unvisited Reactor is never passed
          const plan = travelPlan(two, far);
          if (open.length) {
            expect(plan).toEqual({to: far, route: [id, open[0], far], hops: 2, cheat: false}); // ties: the smallest id
            direct++;
          } else {
            // the only way is through the Reactor: no two-hop journey (a longer known way round, or none)
            if (plan) {
              expect(plan.hops).toBeGreaterThan(2);
              expect(plan.route.slice(1, -1)).not.toContain(net.reactor);
              for (const st of plan.route) expect(two.known).toContain(st);
            } else expect(travelBlock(two, far)).toBe('no-route');
            gated++;
          }
        }
        // the one-stop trips are what they were
        for (const near of ringOf(d, 1)) expect(travelPlan(two, near)).toEqual({to: near, route: [id, near], hops: 1, cheat: false});
      }
    }
    expect(direct).toBeGreaterThan(200);
    expect(direct + gated).toBe(NETS.reduce((n, net) => n + net.nodes.reduce((k, {id}) => k + ringOf(within(net, id, 2), 2).length, 0), 0));
  });

  it('the Reactor between (a hand-made loop): the radar shows the far side, the journey goes the long way round until the Reactor was visited', () => {
    // a - R - b and a - c - d - b: from `a` the station `b` is two stops away through the Reactor only
    const node = (id: string) => ({id, name: id, archetype: 'subway', levelSeed: 1, x: 0, y: 0, lines: ['loop']});
    const net = {
      v: 1, seed: 5, start: 'a', reactor: 'R', nodes: ['a', 'R', 'b', 'c', 'd'].map(node),
      edges: [['a', 'R'], ['R', 'b'], ['a', 'c'], ['c', 'd'], ['d', 'b']], lines: [{id: 'loop', name: 'Loop', color: '#b3262e', stations: ['a', 'R', 'b', 'd', 'c'], loop: true}],
    } as unknown as SubwayNetwork;
    const one = revealAround(newCampaign(net), 'a', 1), two = revealAround(one, 'a', 2);
    expect(one.known).toEqual(['a', 'R', 'c']);
    expect(two.known).toEqual(['a', 'R', 'c', 'b', 'd']);
    expect(travelPlan(one, 'b')).toBeNull();
    expect(travelPlan(two, 'b')).toEqual({to: 'b', route: ['a', 'c', 'd', 'b'], hops: 3, cheat: false}); // never through the unvisited Reactor
    expect(travelPlan(two, 'R')).toEqual({to: 'R', route: ['a', 'R'], hops: 1, cheat: false}); // the Reactor as the destination is fine
    expect(travelPlan(two, 'd')).toEqual({to: 'd', route: ['a', 'c', 'd'], hops: 2, cheat: false});
    const been = {...two, visited: ['a', 'R']};
    expect(travelPlan(been, 'b')).toEqual({to: 'b', route: ['a', 'R', 'b'], hops: 2, cheat: false}); // once visited it is ordinary track
  });

  it('the Reactor itself may be the two-stop destination, and is never the stop between', () => {
    let seen = 0;
    for (const net of NETS) {
      for (const {id} of net.nodes) {
        const d = within(net, id, 2);
        if (d.get(net.reactor) !== 2) continue;
        const plan = travelPlan(revealAround(standingAt(net, id), id, 2), net.reactor);
        expect(plan).toMatchObject({to: net.reactor, hops: 2, cheat: false});
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('fuel (the existing rules, unchanged): the two-stop trip costs two hops = two tanks, paid in full at departure or refused', () => {
    expect(FUEL.hopUnits).toBe(FUEL.tankUnits); // one hop = one tank
    const cost = routeCost(2);
    expect(cost).toBe(2 * FUEL.hopUnits);
    expect(cost).toBe(2 * routeCost(1)); // no discount, no surcharge for a radar destination
    expect(cost).toBeLessThanOrEqual(FUEL.trainTankUnits); // the built-in tank alone can pay it
    expect(planDebit(cost, FUEL.tankUnits, [], [])).toBeNull(); // one tank aboard: refused
    const paid = planDebit(cost, FUEL.trainTankUnits, [], []);
    expect(paid).toEqual({tank: cost, carts: [], chest: []});
    expect(debitUnits(paid!)).toBe(cost);
  });
});

describe('the Game seam: the console map reveals routeRadius() stops (the real Game.openTravelMap on a shell)', async () => {
  installCanvasShim(false);
  const {Game} = await import('../src/game');
  const {buildMapModel} = await import('../src/ui/paperMap');

  interface Opened { state: CampaignState; mode: string; heldKeys: string[]; onClose(key?: string): void; fuel: {cost(hops: number): number} }
  interface Radius { routeRadius(): number }
  /** The members of Game this suite reads (mapBack / state are private on the class: a structural view of the shell). */
  interface MapShell { run: {campaign: CampaignState | null}; mapBack: string | null; state: string; openTravelMap(mode?: 'travel' | 'view'): boolean }

  /** Just what openTravelMap touches: the run's campaign, the map-return state, the held keys, the state switch and the map overlay. */
  function shell(campaign: CampaignState | null, equipment?: Radius) {
    const opened: Opened[] = [];
    const states: string[] = [];
    const s: Record<string, unknown> = {
      run: {campaign}, mapBack: null, state: 'playing',
      input: {down: () => false, suppressUntilRelease: () => {}},
      setState(this: {state: string}, to: string) { states.push(to); this.state = to; },
      enterPlay(this: {state: string}) { states.push('playing'); this.state = 'playing'; return Promise.resolve(); },
      paperMapUi: {isOpen: false, open(this: {isOpen: boolean}, o: Opened) { opened.push(o); this.isOpen = true; }, close(this: {isOpen: boolean}) { this.isOpen = false; }},
      ...(equipment ? {trainEquipment: equipment} : {}),
    };
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as MapShell;
    return {g, opened, states};
  }
  /** A radar that counts how often the console asked. */
  const radar = (radius: number) => { const r = {asked: 0, radius, routeRadius(): number { this.asked++; return this.radius; }}; return r; };

  // the fixture network's interchange st-10: red st-09 / st-11 and green st-25 one stop away; st-08, st-12, st-24, st-26 two stops away
  const atHub = (): CampaignState => fixtureCampaign({current: sid(10), known: [sid(10)], visited: [sid(10)]});
  const RING1 = [sid(9), sid(11), sid(25)], RING2 = [sid(8), sid(12), sid(24), sid(26)];

  it('the fixture is what the comments say (an independent walk)', () => {
    const d = within(atHub().network, sid(10), 2);
    expect(ringOf(d, 1)).toEqual(RING1);
    expect(ringOf(d, 2)).toEqual(RING2);
  });

  it('routeRadius() 2: known grows by the second ring, and the map opens on that state', () => {
    const start = atHub();
    const eq = radar(2);
    const {g, opened, states} = shell(start, eq);
    expect(g.openTravelMap()).toBe(true);
    expect(eq.asked).toBe(1);
    expect(g.run.campaign!.known).toEqual([sid(10), ...RING1, ...RING2]);
    expect(g.run.campaign).toEqual(revealAround(start, sid(10), 2));
    expect(start.known).toEqual([sid(10)]); // the old state object was replaced, not edited
    expect(opened).toHaveLength(1);
    expect(opened[0].state).toBe(g.run.campaign);
    expect(opened[0].mode).toBe('travel');
    expect([g.state, g.mapBack, states]).toEqual(['map', 'playing', ['map']]);
    // nothing but the knowledge changed
    expect({...g.run.campaign!, known: null}).toEqual({...start, known: null});
  });

  it('the opened map offers the two-stop stations as 2-hop destinations at the existing per-hop price', () => {
    const {g, opened} = shell(atHub(), radar(2));
    g.openTravelMap();
    const by = new Map(buildMapModel(opened[0].state, 'travel', 1, null, null).stations.map(st => [st.node.id, st]));
    expect([...by.keys()].sort()).toEqual([sid(10), ...RING1, ...RING2].sort());
    for (const id of RING1) expect([id, by.get(id)!.can, by.get(id)!.hops, by.get(id)!.adjacent]).toEqual([id, true, 1, true]);
    for (const id of RING2) expect([id, by.get(id)!.can, by.get(id)!.hops, by.get(id)!.adjacent]).toEqual([id, true, 2, false]);
    expect(opened[0].fuel.cost(2)).toBe(routeCost(2));
    expect(opened[0].fuel.cost(1)).toBe(routeCost(1));
  });

  it('routeRadius() 1 (no radar plugged): the old one-hop reveal exactly', () => {
    const start = atHub();
    const eq = radar(1);
    const {g, opened} = shell(start, eq);
    expect(g.openTravelMap()).toBe(true);
    expect(eq.asked).toBe(1);
    expect(g.run.campaign!.known).toEqual([sid(10), ...RING1]);
    expect(g.run.campaign).toEqual(revealAround(start, sid(10)));
    expect(opened[0].state).toBe(g.run.campaign);
    const by = new Map(buildMapModel(opened[0].state, 'travel', 1, null, null).stations.map(st => [st.node.id, st]));
    for (const id of RING2) expect(by.has(id)).toBe(false);
  });

  it('no trainEquipment member at all (an older shell): the old one-hop reveal exactly', () => {
    const start = atHub();
    const {g, opened} = shell(start);
    expect('trainEquipment' in g).toBe(false);
    expect(g.openTravelMap()).toBe(true);
    expect(g.run.campaign).toEqual(revealAround(start, sid(10), 1));
    expect(opened[0].state.known).toEqual([sid(10), ...RING1]);
  });

  it("the read-only 'view' map reveals nothing, radar or not", () => {
    for (const eq of [radar(2), radar(1), undefined]) {
      const start = atHub();
      const {g, opened} = shell(start, eq);
      expect(g.openTravelMap('view')).toBe(true);
      expect(g.run.campaign).toBe(start);
      expect(start.known).toEqual([sid(10)]);
      expect(opened[0].state).toBe(start);
      expect(opened[0].mode).toBe('view');
      expect(eq?.asked ?? 0).toBe(0);
    }
  });

  it('an open map is not opened (or revealed) twice; no campaign, no map', () => {
    const eq = radar(1);
    const {g, opened} = shell(atHub(), eq);
    expect(g.openTravelMap()).toBe(true);
    const shown = g.run.campaign;
    eq.radius = 2; // the radar plugged while the map is up changes nothing until the console is used again
    expect(g.openTravelMap()).toBe(false);
    expect(g.run.campaign).toBe(shown);
    expect([opened.length, eq.asked]).toEqual([1, 1]);

    const none = radar(2);
    const bare = shell(null, none);
    expect(bare.g.openTravelMap()).toBe(false);
    expect([bare.opened.length, none.asked, bare.g.state, bare.g.mapBack]).toEqual([0, 0, 'playing', null]);
  });

  it('plug, look, unplug, look again: the second ring stays on the map (the real close path between the two)', () => {
    const eq = radar(2);
    const {g, opened} = shell(atHub(), eq);
    g.openTravelMap();
    const seen = g.run.campaign!;
    opened[0].onClose(); // the map's own close: back to play
    expect([g.state, g.mapBack]).toEqual(['playing', null]);
    eq.radius = 1; // the radar is unplugged
    expect(g.openTravelMap()).toBe(true);
    expect(g.run.campaign).toBe(seen); // nothing new one stop out, nothing forgotten: the very same state
    expect(opened[1].state.known).toEqual([sid(10), ...RING1, ...RING2]);
    expect(eq.asked).toBe(2);
  });

  it('on a real generated network: the console with a radar shows the start, its neighbours and theirs', () => {
    for (const net of NETS) {
      const d = within(net, net.start, 2);
      const withRadar = shell(newCampaign(net), radar(2)), without = shell(newCampaign(net), radar(1));
      withRadar.g.openTravelMap();
      without.g.openTravelMap();
      expect(withRadar.g.run.campaign!.known).toEqual([net.start, ...ringOf(d, 1), ...ringOf(d, 2)]);
      expect(without.g.run.campaign!.known).toEqual([net.start, ...ringOf(d, 1)]);
      expect(withRadar.g.run.campaign!.known.length).toBeGreaterThan(without.g.run.campaign!.known.length);
    }
  });

  it('end to end with the equipment system: a plugged radar is what makes the console look two stops out', () => {
    const plugged: {kind: EquipmentKind | null} = {kind: null};
    const eq = Object.create(TrainEquipmentSystem.prototype) as TrainEquipmentSystem;
    Object.defineProperty(eq, 'plugged', {value: (kind: EquipmentKind) => (kind === plugged.kind ? ({kind} as EquipmentUnit) : null)});
    const off = shell(atHub(), eq);
    off.g.openTravelMap();
    expect(off.g.run.campaign!.known).toEqual([sid(10), ...RING1]);
    plugged.kind = 'radar';
    const on = shell(atHub(), eq);
    on.g.openTravelMap();
    expect(on.g.run.campaign!.known).toEqual([sid(10), ...RING1, ...RING2]);
  });
});

describe('TrainEquipmentSystem.routeRadius(): 2 exactly while a route radar is plugged in', () => {
  /** The system with only `plugged` replaced (no constructor: nothing else is read). */
  function system(pluggedKinds: readonly EquipmentKind[]) {
    const asked: EquipmentKind[] = [];
    const eq = Object.create(TrainEquipmentSystem.prototype) as TrainEquipmentSystem;
    Object.defineProperty(eq, 'plugged', {value: (kind: EquipmentKind) => { asked.push(kind); return pluggedKinds.includes(kind) ? ({uid: `eq-${kind}`, kind, plug: 0} as EquipmentUnit) : null; }});
    return {eq, asked};
  }

  it('the registry has a radar', () => {
    expect(EQUIPMENT_KINDS).toContain('radar');
  });

  it('nothing plugged: 1 (the console alone)', () => {
    const {eq, asked} = system([]);
    expect(eq.routeRadius()).toBe(1);
    expect(asked).toEqual(['radar']); // it asks about the radar, and only the radar
  });

  it('the radar plugged: 2', () => {
    expect(system(['radar']).eq.routeRadius()).toBe(2);
  });

  it('every other kind plugged, alone or all together: still 1 — and every set with the radar: 2', () => {
    const others = EQUIPMENT_KINDS.filter(k => k !== 'radar');
    expect(others.length).toBeGreaterThan(0);
    for (const kind of others) expect([kind, system([kind]).eq.routeRadius()]).toEqual([kind, 1]);
    expect(system(others).eq.routeRadius()).toBe(1);
    for (const kind of others) expect([kind, system([kind, 'radar']).eq.routeRadius()]).toEqual([kind, 2]);
    expect(system(EQUIPMENT_KINDS).eq.routeRadius()).toBe(2);
  });

  it('a subclass that answers plugged() drives it too (the shape the real system has)', () => {
    class Plugged extends TrainEquipmentSystem {
      on = false;
      override plugged(kind: EquipmentKind): EquipmentUnit | null { return this.on && kind === 'radar' ? ({kind} as EquipmentUnit) : null; }
    }
    const eq = Object.create(Plugged.prototype) as Plugged;
    eq.on = false;
    expect(eq.routeRadius()).toBe(1);
    eq.on = true;
    expect(eq.routeRadius()).toBe(2);
    eq.on = false;
    expect(eq.routeRadius()).toBe(1); // unplugged again: the console alone (what was revealed stays known: the suites above)
  });
});
