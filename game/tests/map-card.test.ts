// Task studio-beta-campaign-polish-20261103-063841-01 (lane MAP), items 10-12 (+ the Maintenance Route / multi-hop on the map):
//  10 the selected station's details CARD sits beside its node (ui/paperMap.ts placeCard: right, else left / below / above, clamped
//     inside the viewport under the bar), follows the node through pan / zoom / resize, never moves the print; clicking inside the
//     card never deselects or pans;
//  11 distinct station TYPE ICONS (Subway dot / Office tower / Mall bag / Reactor trefoil / Maintenance Route hex nut — shapes, not
//     colour), a concise key, the discovery mask (unknown stations print nothing; the Reactor's mark / key only once known);
//  12 selecting / focusing never moves, wraps or hides a station NAME (the label layout ignores the selection) — long names, the four
//     types, a narrow viewport.
// Pure geometry + the overlay on the small Node DOM (helpers/paperMapDom.ts). Node only (no browser).

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {MAINTENANCE_ROUTE, generateNetwork, graphDistances, maintenanceRouteNode} from '../src/campaign/network';
import {arrive, enableCheat, neighbors, newCampaign, revealAround, travelPlan} from '../src/campaign/discovery';
import type {CampaignState, StationId, SubwayNetwork} from '../src/campaign/types';
import {PaperMap, buildMapModel, paperLayout, placeCard, renderInk, stationGlyph, stationKind} from '../src/ui/paperMap';
import {installCanvasShim} from './helpers/canvas2d';
import {installMiniDom, MiniEvent, type MiniDom} from './helpers/paperMapDom';

installCanvasShim(false);

const net = generateNetwork(424242);
const start = (n: SubwayNetwork = net) => revealAround(newCampaign(n), n.start);
const walk = (s: CampaignState, ids: StationId[]) => ids.reduce((st, id) => revealAround(arrive(st, id), id), s);
function pathTo(n: SubwayNetwork, to: StationId): StationId[] {
  const prev = new Map<string, string>([[n.start, '']]);
  const q = [n.start];
  for (let i = 0; i < q.length; i++) for (const nb of neighbors(n, q[i])) if (!prev.has(nb)) { prev.set(nb, q[i]); q.push(nb); }
  const out: string[] = [];
  for (let c = to; c; c = prev.get(c)!) out.unshift(c);
  return out;
}
/** A run standing next to the Reactor with the Maintenance Route on the map (walked to the bypass's approach). */
function nearReactor(n: SubwayNetwork): CampaignState {
  const m = maintenanceRouteNode(n)!.id, d = graphDistances(n, n.start), depth = d.get(n.reactor)!;
  const approach = neighbors(n, m).filter(x => d.get(x)! < depth).sort((a, b) => d.get(a)! - d.get(b)!)[0];
  return walk(start(n), pathTo(n, approach).slice(1));
}

describe('placeCard (pure)', () => {
  const card = {w: 300, h: 170};
  const inside = (c: {x: number; y: number}, v: {w: number; h: number; top: number}, m = 10) =>
    c.x >= m - 1e-9 && c.y >= v.top + m - 1e-9 && c.x + card.w <= v.w - m + 1e-9 && c.y + card.h <= v.h - m + 1e-9;

  it('beside the node: right by default, flipped left near the right edge, below / above when the screen is narrow', () => {
    const v = {w: 1280, h: 720, top: 46};
    expect(placeCard({x: 400, y: 300}, 20, card, v)).toEqual({x: 434, y: 215, side: 'right'});
    expect(placeCard({x: 1100, y: 300}, 20, card, v)).toMatchObject({x: 1100 - 20 - 14 - 300, side: 'left'});
    const narrow = {w: 360, h: 700, top: 46};
    expect(placeCard({x: 180, y: 200}, 18, card, narrow)).toMatchObject({side: 'below', y: 200 + 18 + 14});
    expect(placeCard({x: 180, y: 640}, 18, card, narrow)).toMatchObject({side: 'above', y: 640 - 18 - 14 - 170});
  });

  it('always inside the viewport (under the bar) and never over its node unless the screen is too small for any side', () => {
    for (const v of [{w: 1280, h: 720, top: 46}, {w: 800, h: 600, top: 46}, {w: 360, h: 640, top: 46}, {w: 2560, h: 1440, top: 46}]) {
      for (let x = -50; x <= v.w + 50; x += 37) for (let y = 0; y <= v.h + 40; y += 29) {
        const c = placeCard({x, y}, 16, card, v);
        expect([v.w, x, y, inside(c, v)]).toEqual([v.w, x, y, true]);
        const onScreen = x >= 0 && x <= v.w && y >= v.top && y <= v.h;
        if (c.side !== 'clamped' && onScreen) {
          // the node's marker circle (radius 16) stays outside the card
          const nx = Math.max(c.x, Math.min(x, c.x + card.w)), ny = Math.max(c.y, Math.min(y, c.y + card.h));
          expect(Math.hypot(nx - x, ny - y)).toBeGreaterThanOrEqual(16 - 1e-9);
        }
      }
    }
  });
});

describe('labels never move with the selection (pure)', () => {
  const sameLabels = (s: CampaignState, mode: 'travel' | 'view', scale: number) => {
    const base = JSON.stringify([...buildMapModel(s, mode, scale, null, null).labels]);
    const ids = s.cheat ? s.network.nodes.map(n => n.id) : s.known;
    for (const id of ids) {
      expect([id, JSON.stringify([...buildMapModel(s, mode, scale, id, null).labels])]).toEqual([id, base]);
      expect([id, JSON.stringify([...buildMapModel(s, mode, scale, null, id).labels])]).toEqual([id, base]);
      expect([id, JSON.stringify([...buildMapModel(s, mode, scale, id, id).labels])]).toEqual([id, base]);
    }
  };

  it('every station selected / focused in turn: the same label boxes, lines and line breaks (travel + view, two zooms)', () => {
    for (const seed of [424242, 31337]) {
      const n = generateNetwork(seed);
      const s = nearReactor(n);
      for (const scale of [0.8, 1.6]) { sameLabels(s, 'travel', scale); sameLabels(s, 'view', scale); }
      sameLabels(enableCheat(s), 'travel', 1.1);
    }
  });

  it('long names and the five types + the Maintenance Route: still independent of the selection', () => {
    const n = JSON.parse(JSON.stringify(net)) as SubwayNetwork;
    n.nodes.forEach((x, i) => { if (i % 3 === 0 && x.name !== MAINTENANCE_ROUTE.name) x.name = `${x.name} Interchange Upper Concourse`.slice(0, 44); });
    const s = enableCheat(start(n));
    const kinds = new Set(buildMapModel(s, 'travel', 1, null, null).stations.map(x => x.kind));
    expect([...kinds].sort()).toEqual(['bunker', 'maintenance', 'mall', 'market', 'office', 'reactor', 'skyways', 'subway']); // (+ market: task studio-survivor-market-20261108-005807-01; + bunker: task studio-bunker-level-20261109-072224-01)
    sameLabels(s, 'travel', 1);
    sameLabels(s, 'view', 0.7);
  });
});

describe('station type icons and the key (pure)', () => {
  it('a distinct SHAPE per type (not colour only); filled = visited', () => {
    const p = {x: 50, y: 50};
    const tag = (k: Parameters<typeof stationGlyph>[0]) => stationGlyph(k, p, 6, true).match(/^<(\w+)/)![1];
    expect([tag('subway'), tag('office'), tag('mall'), tag('maintenance')]).toEqual(['circle', 'rect', 'path', 'polygon']);
    expect(stationGlyph('reactor', p, 12, true)).toMatch(/<path d="M/); // the trefoil blades
    expect(stationGlyph('office', p, 6, true)).toContain('fill="#221d18"');
    expect(stationGlyph('office', p, 6, false)).toContain('fill="#ffffff"');
    const m = maintenanceRouteNode(net)!;
    expect(stationKind(m, net)).toBe('maintenance');
    expect(stationKind(net.nodes.find(x => x.id === net.reactor)!, net)).toBe('reactor');
    expect(net.nodes.filter(x => stationKind(x, net) === 'office')).toHaveLength(4);
  });

  it('the discovery mask: only known stations print an icon; the Reactor / Maintenance Route marks and key entries wait until known', () => {
    const s0 = start();
    const m0 = buildMapModel(s0, 'travel', 1, null, null);
    const ink0 = renderInk(m0, net, 'travel', null, null);
    expect((ink0.match(/class="pm-stop /g) ?? []).length).toBe(s0.known.length);
    expect(ink0).not.toContain('pm-kind-reactor');
    expect(ink0).not.toContain('pm-key-reactor');
    expect(ink0).not.toContain('pm-key-maintenance');
    expect(ink0).toContain('pm-key-subway');
    expect(ink0).toContain('pm-key-office');
    expect(ink0).toContain('pm-key-mall');
    for (const n of net.nodes) if (!s0.known.includes(n.id)) expect(ink0).not.toContain(`data-id="${n.id}"`);
    const s1 = nearReactor(net);
    const ink1 = renderInk(buildMapModel(s1, 'travel', 1, null, null), net, 'travel', null, null);
    expect(ink1).toContain('pm-kind-maintenance');
    expect(ink1).toContain('pm-key-maintenance');
    expect(ink1).toContain('pm-service'); // the dashed service track
    expect(ink1.includes('pm-kind-reactor')).toBe(s1.known.includes(net.reactor));
  });

  it('the Maintenance Route\'s service line is not an interchange ink and not in the line legend', () => {
    const s = enableCheat(start());
    const model = buildMapModel(s, 'travel', 1, null, null);
    expect(model.legend.some(e => e.color === MAINTENANCE_ROUTE.color)).toBe(false);
    expect(model.runs.filter(r => r.service).length).toBeGreaterThan(0);
    const m = maintenanceRouteNode(net)!;
    const approach = neighbors(net, m.id)[0];
    const lineInks = new Set(net.nodes.find(x => x.id === approach)!.lines.filter(l => !l.startsWith('ln-maint')).map(l => net.lines.find(x => x.id === l)!.color));
    expect(model.stations.find(x => x.node.id === approach)!.hub).toBe(lineInks.size > 1);
  });
});

describe('the card on the overlay', () => {
  let dom: MiniDom;
  let map: PaperMap;
  beforeEach(() => { dom = installMiniDom(1280, 720); map = new PaperMap(); });
  afterEach(() => { map.destroy(); dom.uninstall(); });
  const panel = () => dom.doc.querySelector('.pm-panel')!;
  const hit = (id: string) => dom.doc.querySelector(`.pm-hit[data-station="${id}"]`);
  const labels = () => dom.doc.querySelector('.pm-labels')!.innerHTML;
  const screenOf = (id: string) => { const p = paperLayout(net).get(id)!, v = map.viewState; return {x: p.x * v.s + v.tx, y: p.y * v.s + v.ty}; };

  it('sits beside the clicked node and follows it through pan / zoom / resize; the print never moves', () => {
    const s = nearReactor(net);
    map.open({state: s, mode: 'travel'});
    const target = neighbors(net, s.current).find(x => s.known.includes(x))!;
    const before = labels();
    dom.click(hit(target));
    expect(map.selected).toBe(target);
    expect(labels()).toBe(before); // selecting never re-lays a name
    const c0 = map.card!;
    const a0 = screenOf(target);
    expect(c0.side === 'right' ? c0.x > a0.x : c0.side === 'left' ? c0.x + c0.w < a0.x : true).toBe(true);
    expect(Math.abs(c0.y + c0.h / 2 - a0.y) < c0.h || c0.side === 'below' || c0.side === 'above').toBe(true);
    expect(String(panel().style.transform)).toBe(`translate(${Math.round(c0.x)}px, ${Math.round(c0.y)}px)`);
    // pan: the card moves with its node
    map.panBy(-60, 25);
    const c1 = map.card!, a1 = screenOf(target);
    expect(Math.abs((c1.x - a1.x) - (c0.x - a0.x)) <= 1 || c1.side !== c0.side).toBe(true);
    // zoom and resize: re-placed, still inside the viewport
    map.zoomBy(1.6);
    for (const [w, h] of [[1280, 720], [700, 900], [360, 640]]) {
      dom.win.innerWidth = w; dom.win.innerHeight = h;
      dom.win.dispatchEvent(new MiniEvent('resize'));
      const c = map.card!;
      expect([w, c.x >= 9, c.y >= 46 + 9, c.x + c.w <= w - 9, c.y + c.h <= h - 9]).toEqual([w, true, true, true, true]);
    }
    expect(map.selected).toBe(target);
    map.cancel();
    expect(map.card).toBeNull();
    expect(labels()).toBe(dom.doc.querySelector('.pm-labels')!.innerHTML);
  });

  it('clicking or dragging inside the card never deselects or pans the map', () => {
    const s = nearReactor(net);
    map.open({state: s, mode: 'travel'});
    const target = neighbors(net, s.current).find(x => s.known.includes(x))!;
    dom.click(hit(target));
    const v = map.viewState;
    dom.click(panel().querySelector('.pm-p-name'));
    dom.click(panel().querySelector('.pm-p-state'));
    panel().dispatchEvent(new MiniEvent('pointerdown', {button: 0, pointerId: 3, clientX: 900, clientY: 300}));
    dom.win.dispatchEvent(new MiniEvent('pointermove', {pointerId: 3, clientX: 960, clientY: 340}));
    dom.win.dispatchEvent(new MiniEvent('pointerup', {pointerId: 3, clientX: 960, clientY: 340}));
    expect([map.selected, map.viewState]).toEqual([target, v]);
  });

  it('a visited station far away: the card names the route over known stations; a cut-off one says "not available"', () => {
    const n = net;
    const s = nearReactor(n);
    const far = s.visited.find(v => v !== s.current && !neighbors(n, s.current).includes(v))!;
    map.open({state: s, mode: 'travel'});
    dom.click(hit(far));
    const plan = travelPlan(s, far)!;
    expect(map.selected).toBe(far);
    expect(panel().textContent).toContain(`${plan.hops} stops via`);
    expect(panel().querySelector('.pm-depart')).not.toBeNull();
    expect(dom.doc.querySelector('.pm-route')).not.toBeNull();
    expect(map.qa().route).toEqual(plan.route);
    // the same station when the track there is not on the map (the stations in between unknown): not available, no fake path
    // (task gameplay-feedback lane TRAVEL: known but unvisited stations in between no longer cut it off — only unknown track does)
    map.cancel();
    const only = [s.current, far, n.start].filter((x, i, a) => a.indexOf(x) === i);
    const cut: CampaignState = {...s, visited: only, known: only};
    expect(travelPlan(cut, far)).toBeNull();
    map.update(cut);
    dom.click(hit(far));
    expect(map.selected).toBeNull();
    expect(map.note).toMatch(/not available/);
  });

  it('the Maintenance Route card: its icon, its type and the bypass note; the Reactor card no longer says "end of the line"', () => {
    const s = nearReactor(net);
    const m = maintenanceRouteNode(net)!;
    map.open({state: s, mode: 'travel'});
    dom.click(hit(m.id));
    expect(map.selected).toBe(m.id);
    expect(panel().textContent).toContain('Maintenance Route · Subway station');
    expect(panel().textContent).toMatch(/bypass/);
    expect(panel().querySelector('svg polygon')).not.toBeNull();
    map.update(enableCheat(s));
    dom.click(hit(net.reactor));
    expect(map.selected).toBe(net.reactor);
    expect(panel().textContent).toContain('Reactor');
    expect(panel().textContent).not.toMatch(/end of the line/);
  });
});
