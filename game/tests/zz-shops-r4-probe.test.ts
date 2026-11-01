// TEMPORARY probe (lane SHOPS, mall round 3, R4) — deleted before the lane finishes.
import {it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {generateMallLevel, mallIssues} from '../src/gen/mall/index';
import {shopFit} from '../src/gen/mall/shops';

it('R4 probe: womenswear + female mannequins on generated malls', () => {
  const out: unknown[] = [];
  for (const seed of [0x7ea3c1, 4242, 11, 222, 3333, 99]) {
    const L = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'});
    const shops = L.mall!.shops;
    const prog = new Map<number, string>(), back = new Set<number>();
    for (const q of shops) { prog.set(q.area, q.program); if (q.backroom !== undefined) { prog.set(q.backroom, q.program); back.add(q.backroom); } }
    const fem = L.props.filter(p => p.kind === 'mannequinFemale');
    const where = fem.map(p => `${prog.get(p.area) ?? 'other'}${back.has(p.area) ? '-back' : ''}`);
    const ws = shops.filter(q => q.program === 'womenswear').map(q => ({id: q.id, lot: q.lot, brand: q.brand, m2: q.salesArea, level: q.level, shutter: shopFit(q)!.shutter,
      props: L.props.filter(p => p.area === q.area && p.kind !== 'shopGlazing').length,
      kinds: [...new Set(L.props.filter(p => p.area === q.area).map(p => p.kind))].sort().join(' ')}));
    out.push({seed, issues: mallIssues(L), units: shops.length, programs: [...new Set(shops.map(q => q.program))].sort().join(' '), womenswear: ws,
      female: fem.length, where, salon: L.props.filter(p => p.kind === 'salonChair').length, m07: L.props.filter(p => p.kind === 'mannequinFull').length});
  }
  writeFileSync('/tmp/shops-r4-probe.json', JSON.stringify(out, null, 1));
}, 120000);
