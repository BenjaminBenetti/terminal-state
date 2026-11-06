// Task studio-beta-train-fuel-system-20261106-024923-01: the paper map's fuel figures (ui/paperMap.ts): a bar per KNOWN station (two
// segments = two tanks, quarters fill, "+" beyond), planned (ochre, faded) vs remaining / live (green), labels kept clear of the bars,
// no figures without a provider (non-campaign maps unchanged) and nothing shown for stations the map does not reveal.
import {describe, expect, it} from 'vitest';
import {FUEL_BAR, PaperMap, buildMapModel, fuelBarSvg, renderInk, type MapFuel} from '../src/ui/paperMap';
import {fixtureCampaign, sid} from './helpers/saveFixture';
import {visibleNodes} from '../src/campaign/discovery';

const fuel: MapFuel = {
  node: id => (id === sid(0) ? {units: 2, source: 'live'} : {units: id === sid(1) ? 9 : 4, source: id === sid(1) ? 'remaining' : 'planned'}),
  aboard: () => ({tank: 1, chest: 2, carts: 0, total: 3}),
  cost: hops => hops * 4,
};

describe('station fuel bars', () => {
  it('two segments filled by quarter units; more than two tanks adds a "+"; planned vs remaining colours', () => {
    const half = fuelBarSvg({x: 100, y: 100}, 6, 2, 'live');
    expect(half.match(/<rect /g)).toHaveLength(3); // two outlines + one fill (half of the first tank)
    expect(half).toContain('data-units="2"');
    expect(half).not.toContain('>+<');
    const many = fuelBarSvg({x: 100, y: 100}, 6, 9, 'remaining');
    expect(many.match(/<rect /g)).toHaveLength(4);
    expect(many).toContain('>+</text>');
    expect(fuelBarSvg({x: 0, y: 0}, 6, 4, 'planned')).toContain('opacity="0.7"');
    expect(fuelBarSvg({x: 0, y: 0}, 6, 0, 'remaining').match(/<rect /g)).toHaveLength(2); // empty: outlines only
  });

  it('the map draws a bar for every KNOWN station only, with a key entry; without a provider nothing changes', () => {
    const st = fixtureCampaign({current: sid(0), known: [sid(0), sid(1), sid(2)], visited: [sid(0), sid(1)]});
    const plain = buildMapModel(st, 'travel', 1, null, null);
    const withFuel = buildMapModel(st, 'travel', 1, null, null, undefined, true);
    const inkPlain = renderInk(plain, st.network, 'travel', null, null);
    expect(inkPlain).not.toContain('pm-fuel');
    const ink = renderInk(withFuel, st.network, 'travel', null, null, fuel);
    const shown = visibleNodes(st).length;
    expect((ink.match(/class="pm-fuel pm-fuel-/g) ?? []).length).toBe(shown + 1); // + the key's sample bar
    expect(ink).toContain('Fuel (tanks)');
    expect(ink).toContain(`pm-fuel-live" data-units="2"`);
  });

  it('labels stay clear of the bars: a marker box reaches over its bar only when fuel is shown', () => {
    const st = fixtureCampaign({current: sid(0), known: [sid(0), sid(1), sid(2)], visited: [sid(0)]});
    const a = buildMapModel(st, 'travel', 1, null, null), b = buildMapModel(st, 'travel', 1, null, null, undefined, true);
    for (const s of b.stations) {
      const lab = b.labels.get(s.node.id);
      if (!lab) continue;
      const bar = {x0: s.p.x - FUEL_BAR.w / 2, y0: s.p.y + s.r + FUEL_BAR.gap, x1: s.p.x + FUEL_BAR.w / 2, y1: s.p.y + s.r + FUEL_BAR.gap + FUEL_BAR.h};
      const overlap = lab.box.x0 < bar.x1 && bar.x0 < lab.box.x1 && lab.box.y0 < bar.y1 && bar.y0 < lab.box.y1;
      expect(overlap, s.node.id).toBe(false);
    }
    expect([...a.labels.keys()].sort()).toEqual([...b.labels.keys()].sort());
  });
});

describe('the details card: the station\'s fuel and the trip (stops, cost, reserves aboard)', () => {
  it('names the station fuel and a trip that is short; Depart stays (the engine stalls audibly when short)', () => {
    const pm = new PaperMap() as unknown as {args: {fuel: MapFuel}; mode: string; fuelLines(id: string, plan: {hops: number} | null): string};
    pm.args = {fuel};
    pm.mode = 'travel';
    const html = pm.fuelLines(sid(1), {hops: 3});
    expect(html).toContain('Fuel here: 2¼ tanks (left here)');
    expect(html).toContain('Trip: 3 stops · needs 3 tanks · aboard ¾ tank (tank ¼ tank, chest ½ tank, carts empty) — NOT ENOUGH');
    expect(html).toContain('pm-p-short');
    expect(pm.fuelLines(sid(2), {hops: 1})).toContain('Fuel here: 1 tank (not visited — untouched)');
    const rich: MapFuel = {...fuel, aboard: () => ({tank: 4, chest: 0, carts: 0, total: 4})};
    pm.args = {fuel: rich};
    expect(pm.fuelLines(sid(2), {hops: 1})).toContain('Trip: 1 stop · needs 1 tank · aboard 1 tank</div>');
    pm.args = {fuel: {...fuel, cost: () => 0}};
    expect(pm.fuelLines(sid(2), {hops: 5})).toContain('no fuel used (cheat)');
  });
});
