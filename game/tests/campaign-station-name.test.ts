// Task studio-alpha-campaign-foundation-20261102-230708-01 (primary): a campaign station shows the network node's printed name on its
// signs / HUD (the generator's own seeded name replaced after generation; nothing else in the layout changes).
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {adoptStationName} from '../src/campaign/stationName';

describe('campaign station name', async () => {
  installCanvasShim(false);
  const {LEVELS} = await import('../src/levels/registry');
  const gen = (level: 'subway' | 'mall' | 'reactor') => LEVELS[level].generate('main', {levelSeed: 12345, startWeapon: 'pistol', gear: []});

  it('every sign that printed the generated name prints the node name; the rest of the layout is untouched', () => {
    const a = gen('subway'), b = gen('subway');
    const old = a.name, stationSigns = a.signs.filter(s => s.text === old).length;
    expect(stationSigns).toBeGreaterThan(0);
    expect(adoptStationName(a, 'Thistlecombe Quay')).toBe(stationSigns);
    expect(a.name).toBe('Thistlecombe Quay');
    expect(a.signs.filter(s => s.text === old)).toEqual([]);
    expect(a.signs.filter(s => s.text === 'Thistlecombe Quay').length).toBe(stationSigns);
    // the same generated layout otherwise (seeded stream untouched: the generator ran exactly as before)
    const strip = (l: typeof a) => JSON.stringify({...l, name: '', signs: l.signs.map(s => ({...s, text: s.text === l.name ? '' : s.text}))});
    expect(strip(a)).toBe(strip(b));
    expect(adoptStationName(a, 'Thistlecombe Quay')).toBe(0); // idempotent
  });

  it('the mall / reactor own names follow; area labels that only contain a word of it stay', () => {
    const m = gen('mall');
    adoptStationName(m, 'Ivelton Galleria');
    expect(m.name).toBe('Ivelton Galleria');
    expect(m.mall!.name).toBe('Ivelton Galleria');
    const r = gen('reactor'), labels = r.areas.map(x => x.label);
    adoptStationName(r, 'Carrowmere Works');
    expect(r.reactor!.name).toBe('Carrowmere Works');
    expect(r.areas.map(x => x.label)).toEqual(labels);
  });
});
