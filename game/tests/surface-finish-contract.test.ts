import {describe, expect, it} from 'vitest';
import {Grid} from '../src/gen/grid';
import {finishClass} from '../src/damage/impactFinish';
import {finishResolver, isArchFinish} from '../src/world/finishAt';
import {finishFamily, RECIPES, treatmentOf} from '../src/world/wallDetailPlan';
import type {Level} from '../src/gen/levels';

describe('Surface architecture keeps the physical finish under damage and decay', () => {
  it.each([
    ['surface-wall-masonry@0', 'concrete'], ['surface-wall-paint@2', 'concrete'],
    ['surface-wall-plaster@3', 'plaster'], ['surface-wall-wet@1', 'tile'], ['surface-wall-wood@2', 'wood'],
    ['surface-floor-asphalt@0', 'concrete'], ['surface-floor-concrete@1', 'concrete'], ['surface-floor-carpet@2', 'fabric'],
    ['surface-floor-asphalt', 'concrete'], ['surface-floor-concrete', 'concrete'],
    ['surface-floor-vinyl@3', 'plastic'], ['surface-floor-tile@1', 'tile'], ['surface-floor-stone@0', 'terrazzo'],
    ['surface-floor-wood@3', 'wood'], ['surface-floor-server@2', 'laminate'],
    ['surface-ceil-grid', 'plaster'], ['surface-ceil-plain', 'plaster'], ['surface-ceil-raw', 'concrete'], ['surface-trim-steel', 'steel'],
  ])('%s produces the corresponding physical impact', (key, cls) => {
    expect(isArchFinish(key)).toBe(true);
    expect(finishClass(key)).toBe(cls);
  });

  it('resolves urban walls, asphalt and ceilings through the real structural-hit resolver', () => {
    const grid = new Grid(8, 8);
    const levels = [{id: 0, grid}] as Level[];
    const resolver = finishResolver(levels, [{level: 0, x0: 0, z0: 1, x1: 3, z1: 1, y0: 0, y1: 3,
      nx: 0, nz: 1, finish: 'surface-wall-plaster@2'}], {
      floorKey: () => 'surface-floor-asphalt@0', ceilKey: () => 'surface-ceil-raw',
    });
    const wall = resolver!('wall', 0, 1, 1.5, 1, 0, 1);
    expect(wall).toBe('surface-wall-plaster@2'); expect(finishClass(wall)).toBe('plaster');
    expect(finishClass(resolver!('floor', 0, 1, 0, 1, 0, 0))).toBe('concrete');
    expect(finishClass(resolver!('ceiling', 0, 1, 3, 1, 0, 0))).toBe('concrete');
    expect(resolver!('wall', 0, 1, 1.5, 1, 0, -1)).toBeNull();
    expect(finishResolver(levels, [], null)).toBeNull(); // Ordinary station behavior stays on its original resolver.
  });

  it('weathering urban finishes never adds station identity bands or tile-course cutting', () => {
    for (const finish of ['surface-wall-masonry@0', 'surface-wall-concrete@1', 'surface-wall-paint@2',
      'surface-wall-plaster@3', 'surface-wall-wet@1', 'surface-wall-wood@2']) {
      expect(finishFamily(finish)).toBe('office');
      const treatment = treatmentOf({zone: 'concourse', finish});
      expect(['officeRoof', 'officeWall']).toContain(treatment);
      expect(RECIPES[treatment].band).toBe('none'); expect(RECIPES[treatment].frieze).toBe(false);
    }
    expect(treatmentOf({zone: 'concourse', finish: 'tileLower'})).toBe('concourseTile');
    expect(finishFamily('tileLower')).toBe('tile');
  });

  it('unknown or malformed Surface keys do not invent a damage class', () => {
    for (const key of ['surface-wall-plaster@4', 'surface-wall-metal@0', 'surface-floor-lava@2', 'surface-ceil-mystery', 'surface-trim-wood']) {
      expect(finishClass(key)).toBeNull();
    }
  });
});
