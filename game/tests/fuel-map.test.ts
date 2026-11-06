// Task studio-beta-train-fuel-system-20261106-024923-01: the paper map's fuel (ui/paperMap.ts): a bar per KNOWN station, planned (ochre,
// faded) vs remaining / live (green), labels kept clear of the bars, nothing without a provider (non-campaign maps unchanged) and nothing
// for stations the map does not reveal. Task studio-beta-fuel-feedback-20261106-064128-01: six tank segments (stations hold ~4 tanks
// now) and VISUAL ONLY (user: "no need to tell the player the exact fuel amount in text on the map. Just use the visual indicators"):
// no fuel figures in the card text — a destination shows a trip gauge (a tank per hop, filled by the fuel aboard, red where short).
import {describe, expect, it} from 'vitest';
import {FUEL_BAR, PaperMap, buildMapModel, fuelBarSvg, renderInk, tripGaugeSvg, type MapFuel} from '../src/ui/paperMap';
import {fixtureCampaign, sid} from './helpers/saveFixture';
import {visibleNodes} from '../src/campaign/discovery';

const fuel: MapFuel = {
  node: id => (id === sid(0) ? {units: 2, source: 'live'} : {units: id === sid(1) ? 9 : 4, source: id === sid(1) ? 'remaining' : 'planned'}),
  aboard: () => ({tank: 1, chest: 2, carts: 0, total: 3}),
  cost: hops => hops * 4,
};

describe('station fuel bars', () => {
  it('six tank segments filled by quarter units; more than six tanks adds a "+"; planned vs remaining colours', () => {
    expect(FUEL_BAR.tanks).toBe(6);
    const half = fuelBarSvg({x: 100, y: 100}, 6, 2, 'live');
    expect(half.match(/<rect /g)).toHaveLength(7); // six outlines + one fill (half of the first tank)
    expect(half).toContain('data-units="2"');
    expect(half).not.toContain('>+<');
    const four = fuelBarSvg({x: 100, y: 100}, 6, 16, 'remaining');
    expect(four.match(/<rect /g)).toHaveLength(10); // an average station: four of six tanks full — not every station "full"
    expect(four).not.toContain('>+<');
    const many = fuelBarSvg({x: 100, y: 100}, 6, 25, 'remaining');
    expect(many.match(/<rect /g)).toHaveLength(12);
    expect(many).toContain('>+</text>');
    expect(fuelBarSvg({x: 0, y: 0}, 6, 4, 'planned')).toContain('opacity="0.7"');
    expect(fuelBarSvg({x: 0, y: 0}, 6, 0, 'remaining').match(/<rect /g)).toHaveLength(6); // empty: outlines only
    for (const u of [0, 3, 16, 30]) expect(fuelBarSvg({x: 0, y: 0}, 6, u, 'live').replace(/<[^>]*>/g, '').replace('+', '')).toBe(''); // no figures
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

describe('the details card: fuel shown visually only (a trip gauge), no fuel figures in text', () => {
  const card = (f: MapFuel, mode = 'travel') => {
    const pm = new PaperMap() as unknown as {args: {fuel: MapFuel}; mode: string; fuelLines(id: string, plan: {hops: number} | null): string};
    pm.args = {fuel: f};
    pm.mode = mode;
    return pm;
  };
  const text = (html: string) => html.replace(/<[^>]*>/g, '').trim();

  it('a destination: one tank outline per hop, filled by the fuel aboard, red where short — and only the word "Fuel" as text', () => {
    const html = card(fuel).fuelLines(sid(1), {hops: 3});
    expect(text(html)).toBe('Fuel');
    expect(html).toContain('pm-trip-gauge');
    expect(html).toContain('pm-p-short'); // 3 units aboard < 12
    expect((html.match(/rx="1.5"/g) ?? []).length).toBe(3); // three tank outlines (three hops)
    expect((html.match(/fill="#6f9a5c"/g) ?? []).length).toBe(1); // ¾ of the first tank
    expect(html).not.toMatch(/tank|needs|aboard|Fuel here|NOT ENOUGH|\d+ stop/);
    const rich = card({...fuel, aboard: () => ({tank: 4, chest: 4, carts: 0, total: 8})}).fuelLines(sid(2), {hops: 2});
    expect(rich).not.toContain('pm-p-short');
    expect((rich.match(/fill="#6f9a5c"/g) ?? []).length).toBe(2);
    expect(rich).not.toContain('#e0574b');
    expect(tripGaugeSvg(4, 3)!.short).toBe(true);
    expect(tripGaugeSvg(4, 4)!.short).toBe(false);
  });

  it('nothing in the card for a station (its bar is on the map), in view mode, or with the cheat (free)', () => {
    expect(card(fuel).fuelLines(sid(2), null)).toBe('');
    expect(card(fuel, 'view').fuelLines(sid(2), {hops: 1})).toBe('');
    expect(card({...fuel, cost: () => 0}).fuelLines(sid(2), {hops: 5})).toBe('');
    expect(tripGaugeSvg(0, 3)).toBeNull();
  });
});
